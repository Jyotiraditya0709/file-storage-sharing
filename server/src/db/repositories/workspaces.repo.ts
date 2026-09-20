import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm';
import { db, type Executor } from '../client.js';
import { memberships, workspaces } from '../schema.js';
import type { Role } from '../schema.js';

export interface WorkspaceRow {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export async function insert(
  input: { name: string; createdBy: string },
  exec: Executor = db,
): Promise<WorkspaceRow> {
  const [row] = await exec.insert(workspaces).values(input).returning();
  return row!;
}

export async function listForUser(
  userId: string,
): Promise<{ workspace: WorkspaceRow; role: Role }[]> {
  const rows = await db
    .select({ workspace: workspaces, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(memberships.userId, userId), isNull(workspaces.deletedAt)))
    .orderBy(desc(workspaces.createdAt));
  return rows;
}

export async function updateName(id: string, name: string): Promise<void> {
  await db
    .update(workspaces)
    .set({ name })
    .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)));
}

export async function softDelete(id: string, now: Date): Promise<void> {
  await db
    .update(workspaces)
    .set({ deletedAt: now })
    .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)));
}

/** Workspaces soft-deleted before the cutoff, for the purge job. */
export async function listPurgeable(cutoff: Date): Promise<{ id: string }[]> {
  return db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(isNotNull(workspaces.deletedAt), lt(workspaces.deletedAt, cutoff)));
}

/**
 * Hard delete. Documents reference workspaces with ON DELETE RESTRICT, so this
 * throws while any document row survives — which is the point: a workspace can
 * never be removed out from under an object that is still in storage.
 */
export async function hardDelete(id: string): Promise<void> {
  await db.delete(workspaces).where(eq(workspaces.id, id));
}
