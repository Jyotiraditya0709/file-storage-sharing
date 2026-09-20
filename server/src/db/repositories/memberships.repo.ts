import { and, eq, isNull } from 'drizzle-orm';
import { db, type Executor } from '../client.js';
import { memberships, users, workspaces } from '../schema.js';
import type { Role } from '../schema.js';
import type { WorkspaceRow } from './workspaces.repo.js';

export interface MembershipContext {
  role: Role;
  workspace: WorkspaceRow;
}

export interface MemberRow {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: Date;
}

/**
 * The gate every workspace-scoped service opens with: the caller's role plus
 * the live workspace, or nothing. A soft-deleted workspace returns undefined,
 * so members lose access on the very next request.
 */
export async function findMembership(
  workspaceId: string,
  userId: string,
  exec: Executor = db,
): Promise<MembershipContext | undefined> {
  const [row] = await exec
    .select({ role: memberships.role, workspace: workspaces })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.userId, userId),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

export async function findRole(
  workspaceId: string,
  userId: string,
  exec: Executor = db,
): Promise<Role | undefined> {
  const [row] = await exec
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);
  return row?.role;
}

export async function listMembers(workspaceId: string): Promise<MemberRow[]> {
  return db
    .select({
      userId: memberships.userId,
      email: users.email,
      displayName: users.displayName,
      role: memberships.role,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId))
    .orderBy(memberships.createdAt);
}

export async function insert(
  input: { workspaceId: string; userId: string; role: Role },
  exec: Executor = db,
): Promise<void> {
  await exec.insert(memberships).values(input);
}

export async function updateRole(
  workspaceId: string,
  userId: string,
  role: Role,
  exec: Executor = db,
): Promise<void> {
  await exec
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
}

export async function remove(workspaceId: string, userId: string): Promise<void> {
  await db
    .delete(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
}
