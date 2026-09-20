import { and, asc, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db, type Executor } from '../client.js';
import { documents, users, workspaces } from '../schema.js';
import type { Cursor } from '../../lib/cursor.js';

export interface DocumentRow {
  id: string;
  workspaceId: string;
  uploadedBy: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: Buffer;
  storageKey: string;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface DocumentWithUploader {
  document: DocumentRow;
  uploaderDisplayName: string | null;
}

const withUploader = {
  document: documents,
  uploaderDisplayName: users.displayName,
};

export async function insert(
  input: {
    id: string;
    workspaceId: string;
    uploadedBy: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    sha256: Buffer;
    storageKey: string;
  },
  exec: Executor = db,
): Promise<DocumentRow> {
  const [row] = await exec.insert(documents).values(input).returning();
  return row!;
}

/**
 * Live document in a live workspace. Taking workspaceId alongside the id is
 * what makes a cross-workspace id a 404 instead of a leak, and the workspace
 * join is what makes a soft-deleted workspace hide its documents.
 */
export async function findLive(
  workspaceId: string,
  documentId: string,
): Promise<DocumentWithUploader | undefined> {
  const [row] = await db
    .select(withUploader)
    .from(documents)
    .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
    .leftJoin(users, eq(users.id, documents.uploadedBy))
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        eq(documents.id, documentId),
        isNull(documents.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

/** Soft-deleted document in a live workspace, for trash and restore. */
export async function findDeleted(
  workspaceId: string,
  documentId: string,
): Promise<DocumentWithUploader | undefined> {
  const [row] = await db
    .select(withUploader)
    .from(documents)
    .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
    .leftJoin(users, eq(users.id, documents.uploadedBy))
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        eq(documents.id, documentId),
        isNotNull(documents.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

/** Matches the documents_live index: (workspace_id, created_at desc, id). */
export async function listLive(
  workspaceId: string,
  cursor: Cursor | null,
  limit: number,
): Promise<DocumentWithUploader[]> {
  const where = [
    eq(documents.workspaceId, workspaceId),
    isNull(documents.deletedAt),
    isNull(workspaces.deletedAt),
  ];

  if (cursor) {
    const after = or(
      lt(documents.createdAt, cursor.createdAt),
      and(eq(documents.createdAt, cursor.createdAt), sql`${documents.id} > ${cursor.id}`),
    );
    if (after) where.push(after);
  }

  return db
    .select(withUploader)
    .from(documents)
    .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
    .leftJoin(users, eq(users.id, documents.uploadedBy))
    .where(and(...where))
    .orderBy(desc(documents.createdAt), asc(documents.id))
    .limit(limit);
}

export async function listTrash(
  workspaceId: string,
  deletedSince: Date,
  limit: number,
): Promise<DocumentWithUploader[]> {
  return db
    .select(withUploader)
    .from(documents)
    .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
    .leftJoin(users, eq(users.id, documents.uploadedBy))
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        isNotNull(documents.deletedAt),
        sql`${documents.deletedAt} >= ${deletedSince}`,
        isNull(workspaces.deletedAt),
      ),
    )
    .orderBy(desc(documents.deletedAt))
    .limit(limit);
}

export async function rename(
  workspaceId: string,
  documentId: string,
  name: string,
): Promise<void> {
  await db
    .update(documents)
    .set({ name })
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        eq(documents.id, documentId),
        isNull(documents.deletedAt),
      ),
    );
}

export async function softDelete(
  workspaceId: string,
  documentId: string,
  now: Date,
): Promise<void> {
  await db
    .update(documents)
    .set({ deletedAt: now })
    .where(
      and(
        eq(documents.workspaceId, workspaceId),
        eq(documents.id, documentId),
        isNull(documents.deletedAt),
      ),
    );
}

export async function restore(workspaceId: string, documentId: string): Promise<void> {
  await db
    .update(documents)
    .set({ deletedAt: null })
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId)));
}

export async function hardDelete(documentId: string): Promise<void> {
  await db.delete(documents).where(eq(documents.id, documentId));
}

/**
 * Purge candidates: documents deleted before the cutoff, plus every document
 * belonging to a workspace that was deleted before the cutoff.
 */
export async function listPurgeable(cutoff: Date): Promise<DocumentRow[]> {
  return db
    .select({ document: documents })
    .from(documents)
    .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
    .where(
      or(
        and(isNotNull(documents.deletedAt), lt(documents.deletedAt, cutoff)),
        and(isNotNull(workspaces.deletedAt), lt(workspaces.deletedAt, cutoff)),
      ),
    )
    .then((rows) => rows.map((row) => row.document));
}
