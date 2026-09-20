import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { config } from '../config.js';
import * as documentsRepo from '../db/repositories/documents.repo.js';
import type { DocumentWithUploader } from '../db/repositories/documents.repo.js';
import { type Cursor, encodeCursor } from '../lib/cursor.js';
import { ForbiddenError, NotFoundError, PayloadTooLargeError } from '../lib/errors.js';
import { SNIFF_BYTES, peekHead, sanitiseFilename, sniffMime } from '../lib/files.js';
import { storage } from '../storage/index.js';
import type { AuthUser } from './auth.service.js';
import { can } from './authz.js';
import { requireMembership } from './membership.service.js';

export const PAGE_SIZE = 50;
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface DocumentDto {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
  deletedAt: Date | null;
  uploadedBy: { id: string | null; displayName: string | null };
}

export interface UploadSource {
  filename: string;
  stream: Readable;
  limitReached: () => boolean;
}

function toDto({ document, uploaderDisplayName }: DocumentWithUploader): DocumentDto {
  return {
    id: document.id,
    name: document.name,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    sha256: document.sha256.toString('hex'),
    createdAt: document.createdAt,
    deletedAt: document.deletedAt,
    uploadedBy: { id: document.uploadedBy, displayName: uploaderDisplayName },
  };
}

function storageKey(workspaceId: string, documentId: string): string {
  return `ws/${workspaceId}/doc/${documentId}`;
}

/**
 * Streamed end to end: the bytes go from the request to the object store
 * while being hashed, and are never collected in memory.
 */
export async function upload(
  user: AuthUser,
  workspaceId: string,
  source: UploadSource,
): Promise<DocumentDto> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'document:create')) throw new ForbiddenError();

  const name = sanitiseFilename(source.filename);
  const documentId = randomUUID();
  const key = storageKey(workspaceId, documentId);

  // The client's Content-Type is ignored entirely; the type comes from the
  // leading bytes, with a text allow-list as the only fallback.
  const { head, body } = await peekHead(source.stream, SNIFF_BYTES);
  const mimeType = await sniffMime(head, name);

  const { size, sha256 } = await storage.put(key, body, { contentType: mimeType });

  // busboy truncates at the limit rather than erroring, so this is checked
  // after the stream has drained. Nothing was committed, so remove the object
  // and leave no row behind.
  if (source.limitReached()) {
    await storage.delete(key);
    throw new PayloadTooLargeError(
      `File exceeds the ${config.maxUploadBytes} byte limit`,
    );
  }

  try {
    const row = await documentsRepo.insert({
      id: documentId,
      workspaceId,
      uploadedBy: user.id,
      name,
      mimeType,
      sizeBytes: size,
      sha256,
      storageKey: key,
    });
    return toDto({ document: row, uploaderDisplayName: user.displayName });
  } catch (err) {
    // The object exists but the row does not: clean up rather than orphan it.
    await storage.delete(key).catch(() => undefined);
    throw err;
  }
}

export async function list(
  user: AuthUser,
  workspaceId: string,
  cursor: Cursor | null,
): Promise<{ documents: DocumentDto[]; nextCursor: string | null }> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'document:read')) throw new ForbiddenError();

  // One extra row tells us whether another page exists without a count query.
  const rows = await documentsRepo.listLive(workspaceId, cursor, PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);

  return {
    documents: page.map(toDto),
    nextCursor:
      rows.length > PAGE_SIZE && last
        ? encodeCursor({ createdAt: last.document.createdAt, id: last.document.id })
        : null,
  };
}

export async function get(
  user: AuthUser,
  workspaceId: string,
  documentId: string,
): Promise<DocumentDto> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'document:read')) throw new ForbiddenError();

  const found = await documentsRepo.findLive(workspaceId, documentId);
  if (!found) throw new NotFoundError();

  return toDto(found);
}

export async function download(
  user: AuthUser,
  workspaceId: string,
  documentId: string,
): Promise<{ document: DocumentDto; stream: Readable }> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'document:read')) throw new ForbiddenError();

  const found = await documentsRepo.findLive(workspaceId, documentId);
  if (!found) throw new NotFoundError();

  // Every byte is proxied, so every byte passed the checks above.
  return { document: toDto(found), stream: await storage.getStream(found.document.storageKey) };
}

export async function rename(
  user: AuthUser,
  workspaceId: string,
  documentId: string,
  rawName: string,
): Promise<DocumentDto> {
  const { role } = await requireMembership(user.id, workspaceId);

  const found = await documentsRepo.findLive(workspaceId, documentId);
  if (!found) throw new NotFoundError();

  if (
    !can({ userId: user.id, role }, 'document:rename', { ownerId: found.document.uploadedBy })
  ) {
    throw new ForbiddenError();
  }

  const name = sanitiseFilename(rawName);
  await documentsRepo.rename(workspaceId, documentId, name);

  return toDto({ ...found, document: { ...found.document, name } });
}

export async function softDelete(
  user: AuthUser,
  workspaceId: string,
  documentId: string,
): Promise<void> {
  const { role } = await requireMembership(user.id, workspaceId);

  const found = await documentsRepo.findLive(workspaceId, documentId);
  if (!found) throw new NotFoundError();

  if (
    !can({ userId: user.id, role }, 'document:delete', { ownerId: found.document.uploadedBy })
  ) {
    throw new ForbiddenError();
  }

  // Soft delete: lists, detail, download and every share link 404 at once.
  await documentsRepo.softDelete(workspaceId, documentId, new Date());
}

export async function listTrash(user: AuthUser, workspaceId: string): Promise<DocumentDto[]> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'trash:view')) throw new ForbiddenError();

  // Anything older than the retention window is purge-eligible, so it is not
  // offered for restore.
  const since = new Date(Date.now() - TRASH_RETENTION_MS);
  return (await documentsRepo.listTrash(workspaceId, since, PAGE_SIZE)).map(toDto);
}

export async function restore(
  user: AuthUser,
  workspaceId: string,
  documentId: string,
): Promise<DocumentDto> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'trash:restore')) throw new ForbiddenError();

  const found = await documentsRepo.findDeleted(workspaceId, documentId);
  if (!found) throw new NotFoundError();

  const deletedAt = found.document.deletedAt;
  if (!deletedAt || deletedAt.getTime() < Date.now() - TRASH_RETENTION_MS) {
    throw new NotFoundError();
  }

  await documentsRepo.restore(workspaceId, documentId);
  return toDto({ ...found, document: { ...found.document, deletedAt: null } });
}
