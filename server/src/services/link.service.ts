import type { Readable } from 'node:stream';
import { config } from '../config.js';
import * as documentsRepo from '../db/repositories/documents.repo.js';
import * as linksRepo from '../db/repositories/links.repo.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { hashToken, randomToken, tokenTail } from '../lib/tokens.js';
import { issueUnlockToken } from '../lib/unlock.js';
import { ObjectNotFoundError } from '../storage/StorageProvider.js';
import { storage } from '../storage/index.js';
import type { AuthUser } from './auth.service.js';
import { type Subject, can } from './authz.js';
import { requireMembership } from './membership.service.js';

export interface ShareLinkDto {
  id: string;
  tokenTail: string;
  createdBy: { id: string | null; displayName: string | null };
  hasPassword: boolean;
  expiresAt: Date | null;
  maxDownloads: number | null;
  downloadCount: number;
  revokedAt: Date | null;
  createdAt: Date;
  /** Owners and admins revoke anything; a member only their own. */
  canRevoke: boolean;
}

export interface PublicLinkView {
  requiresPassword: boolean;
  document?: {
    name: string;
    sizeBytes: number;
    mimeType: string;
    uploadedBy: string | null;
  };
}

function toDto(
  link: linksRepo.ShareLinkRow,
  creatorDisplayName: string | null,
  subject: Subject,
): ShareLinkDto {
  return {
    id: link.id,
    tokenTail: link.tokenTail,
    createdBy: { id: link.createdBy, displayName: creatorDisplayName },
    hasPassword: link.passwordHash !== null,
    expiresAt: link.expiresAt,
    maxDownloads: link.maxDownloads,
    downloadCount: link.downloadCount,
    revokedAt: link.revokedAt,
    createdAt: link.createdAt,
    canRevoke: can(subject, 'link:revoke', { ownerId: link.createdBy }),
  };
}

export async function create(
  user: AuthUser,
  workspaceId: string,
  documentId: string,
  input: { expiresAt?: Date | undefined; maxDownloads?: number | undefined; password?: string | undefined },
): Promise<{ link: ShareLinkDto; url: string }> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'link:create')) throw new ForbiddenError();

  const document = await documentsRepo.findLive(workspaceId, documentId);
  if (!document) throw new NotFoundError();

  const token = randomToken(32);

  const row = await linksRepo.insert({
    documentId,
    createdBy: user.id,
    tokenHash: hashToken(token),
    tokenTail: tokenTail(token),
    passwordHash: input.password ? await hashPassword(input.password) : null,
    expiresAt: input.expiresAt ?? null,
    maxDownloads: input.maxDownloads ?? null,
  });

  // Shown once. Only the sha256 is stored, so this URL cannot be recovered.
  return {
    link: toDto(row, user.displayName, { userId: user.id, role }),
    url: `${config.appUrl}/s/${token}`,
  };
}

export async function listForDocument(
  user: AuthUser,
  workspaceId: string,
  documentId: string,
): Promise<ShareLinkDto[]> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'link:list')) throw new ForbiddenError();

  const document = await documentsRepo.findLive(workspaceId, documentId);
  if (!document) throw new NotFoundError();

  const subject: Subject = { userId: user.id, role };
  const rows = await linksRepo.listForDocument(workspaceId, documentId);
  return rows.map(({ link, creatorDisplayName }) => toDto(link, creatorDisplayName, subject));
}

export async function revoke(
  user: AuthUser,
  workspaceId: string,
  linkId: string,
): Promise<void> {
  const { role } = await requireMembership(user.id, workspaceId);

  const link = await linksRepo.findById(workspaceId, linkId);
  if (!link) throw new NotFoundError();

  // Owners and admins revoke anything; a member revokes only their own.
  if (!can({ userId: user.id, role }, 'link:revoke', { ownerId: link.createdBy })) {
    throw new ForbiddenError();
  }

  await linksRepo.revoke(workspaceId, linkId, new Date());
}

/**
 * Loads a link that is usable right now.
 *
 * Unknown token, revoked, expired, exhausted, deleted document and deleted
 * workspace are one indistinguishable NotFoundError, so a holder cannot
 * probe a token for which of those it is.
 */
async function loadUsable(token: string) {
  const found = await linksRepo.findByTokenHash(hashToken(token));
  if (!found) throw new NotFoundError();

  const { link, document, workspace } = found;

  if (link.revokedAt) throw new NotFoundError();
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) throw new NotFoundError();
  if (link.maxDownloads !== null && link.downloadCount >= link.maxDownloads) {
    throw new NotFoundError();
  }
  if (document.deletedAt) throw new NotFoundError();
  if (workspace.deletedAt) throw new NotFoundError();

  return found;
}

/**
 * A password-protected link reveals nothing — not even the filename — until
 * it is unlocked. SPEC §5 grants metadata to the link holder, and holding a
 * protected link means knowing the password.
 */
export async function publicGet(
  token: string,
  isUnlocked: (linkId: string) => boolean,
): Promise<PublicLinkView> {
  const { link, document, uploaderDisplayName } = await loadUsable(token);

  if (link.passwordHash && !isUnlocked(link.id)) {
    return { requiresPassword: true };
  }

  return {
    requiresPassword: link.passwordHash !== null,
    document: {
      name: document.name,
      sizeBytes: document.sizeBytes,
      mimeType: document.mimeType,
      uploadedBy: uploaderDisplayName,
    },
  };
}

export async function unlock(
  token: string,
  password: string,
): Promise<{ linkId: string; unlockToken: string }> {
  const { link } = await loadUsable(token);

  // A link without a password cannot be unlocked, and a wrong password is
  // the same 404 as an unknown token.
  if (!link.passwordHash) throw new NotFoundError();
  if (!(await verifyPassword(link.passwordHash, password))) throw new NotFoundError();

  return { linkId: link.id, unlockToken: issueUnlockToken(link.id) };
}

export async function publicDownload(
  token: string,
  isUnlocked: (linkId: string) => boolean,
): Promise<{
  stream: Readable;
  name: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const { link, document } = await loadUsable(token);

  if (link.passwordHash && !isUnlocked(link.id)) throw new NotFoundError();

  // Atomic: the count and the limit are evaluated in one statement, so ten
  // concurrent requests against max_downloads = 5 yield exactly five.
  if (!(await linksRepo.incrementDownload(document.id, link.id))) throw new NotFoundError();

  try {
    return {
      stream: await storage.getStream(document.storageKey),
      name: document.name,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
    };
  } catch (err) {
    if (err instanceof ObjectNotFoundError) throw new NotFoundError();
    throw err;
  }
}
