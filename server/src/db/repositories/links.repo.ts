import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { documents, shareLinks, users, workspaces } from '../schema.js';
import type { DocumentRow } from './documents.repo.js';
import type { WorkspaceRow } from './workspaces.repo.js';

export interface ShareLinkRow {
  id: string;
  documentId: string;
  createdBy: string | null;
  tokenHash: Buffer;
  tokenTail: string;
  passwordHash: string | null;
  expiresAt: Date | null;
  maxDownloads: number | null;
  downloadCount: number;
  revokedAt: Date | null;
  createdAt: Date;
}

export async function insert(input: {
  documentId: string;
  createdBy: string;
  tokenHash: Buffer;
  tokenTail: string;
  passwordHash: string | null;
  expiresAt: Date | null;
  maxDownloads: number | null;
}): Promise<ShareLinkRow> {
  const [row] = await db.insert(shareLinks).values(input).returning();
  return row!;
}

/** Scoped through the document, so a link id from another workspace misses. */
export async function listForDocument(
  workspaceId: string,
  documentId: string,
): Promise<{ link: ShareLinkRow; creatorDisplayName: string | null }[]> {
  return db
    .select({ link: shareLinks, creatorDisplayName: users.displayName })
    .from(shareLinks)
    .innerJoin(documents, eq(documents.id, shareLinks.documentId))
    .leftJoin(users, eq(users.id, shareLinks.createdBy))
    .where(and(eq(shareLinks.documentId, documentId), eq(documents.workspaceId, workspaceId)))
    .orderBy(desc(shareLinks.createdAt));
}

export async function findById(
  workspaceId: string,
  linkId: string,
): Promise<ShareLinkRow | undefined> {
  const [row] = await db
    .select({ link: shareLinks })
    .from(shareLinks)
    .innerJoin(documents, eq(documents.id, shareLinks.documentId))
    .where(and(eq(shareLinks.id, linkId), eq(documents.workspaceId, workspaceId)))
    .limit(1);
  return row?.link;
}

export async function revoke(workspaceId: string, linkId: string, now: Date): Promise<void> {
  // The subquery keeps the workspace scope on a plain UPDATE.
  await db
    .update(shareLinks)
    .set({ revokedAt: now })
    .where(
      and(
        eq(shareLinks.id, linkId),
        isNull(shareLinks.revokedAt),
        sql`${shareLinks.documentId} in (select ${documents.id} from ${documents} where ${documents.workspaceId} = ${workspaceId})`,
      ),
    );
}

export async function findByTokenHash(tokenHash: Buffer): Promise<
  | {
      link: ShareLinkRow;
      document: DocumentRow;
      workspace: WorkspaceRow;
      uploaderDisplayName: string | null;
    }
  | undefined
> {
  const [row] = await db
    .select({
      link: shareLinks,
      document: documents,
      workspace: workspaces,
      uploaderDisplayName: users.displayName,
    })
    .from(shareLinks)
    .innerJoin(documents, eq(documents.id, shareLinks.documentId))
    .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
    .leftJoin(users, eq(users.id, documents.uploadedBy))
    .where(eq(shareLinks.tokenHash, tokenHash))
    .limit(1);
  return row;
}

/**
 * The whole exhaustion rule in one statement, per ARCHITECTURE. Concurrent
 * downloads cannot both read the same count and both pass: zero rows back
 * means the limit was already reached.
 */
export async function incrementDownload(linkId: string): Promise<boolean> {
  const rows = await db
    .update(shareLinks)
    .set({ downloadCount: sql`${shareLinks.downloadCount} + 1` })
    .where(
      and(
        eq(shareLinks.id, linkId),
        sql`(${shareLinks.maxDownloads} is null or ${shareLinks.downloadCount} < ${shareLinks.maxDownloads})`,
      ),
    )
    .returning({ id: shareLinks.id });

  return rows.length === 1;
}
