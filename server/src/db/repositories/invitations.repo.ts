import { and, eq } from 'drizzle-orm';
import { db, type Executor } from '../client.js';
import { invitations, workspaces } from '../schema.js';
import type { InvitationStatus, Role } from '../schema.js';
import type { WorkspaceRow } from './workspaces.repo.js';

export interface InvitationRow {
  id: string;
  workspaceId: string;
  email: string;
  role: Role;
  tokenHash: Buffer;
  invitedBy: string;
  status: InvitationStatus;
  expiresAt: Date;
  acceptedBy: string | null;
  createdAt: Date;
}

export async function insert(
  input: {
    workspaceId: string;
    email: string;
    role: Role;
    tokenHash: Buffer;
    invitedBy: string;
    expiresAt: Date;
  },
  exec: Executor = db,
): Promise<InvitationRow> {
  const [row] = await exec.insert(invitations).values(input).returning();
  return row!;
}

export async function listPending(workspaceId: string): Promise<InvitationRow[]> {
  return db
    .select()
    .from(invitations)
    .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.status, 'pending')))
    .orderBy(invitations.createdAt);
}

/** Workspace-scoped: an invitation id alone is never enough to address a row. */
export async function findById(
  workspaceId: string,
  id: string,
): Promise<InvitationRow | undefined> {
  const [row] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.id, id)))
    .limit(1);
  return row;
}

/**
 * Token lookup is by sha256 through a unique index, so there is no string
 * comparison of a secret and nothing to time.
 */
export async function findByTokenHash(
  tokenHash: Buffer,
): Promise<{ invitation: InvitationRow; workspace: WorkspaceRow } | undefined> {
  const [row] = await db
    .select({ invitation: invitations, workspace: workspaces })
    .from(invitations)
    .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
    .where(eq(invitations.tokenHash, tokenHash))
    .limit(1);
  return row;
}

export async function setStatus(
  workspaceId: string,
  id: string,
  status: InvitationStatus,
): Promise<void> {
  await db
    .update(invitations)
    .set({ status })
    .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.id, id)));
}

export async function markAccepted(
  workspaceId: string,
  id: string,
  acceptedBy: string,
  exec: Executor = db,
): Promise<void> {
  await exec
    .update(invitations)
    .set({ status: 'accepted', acceptedBy })
    .where(and(eq(invitations.workspaceId, workspaceId), eq(invitations.id, id)));
}
