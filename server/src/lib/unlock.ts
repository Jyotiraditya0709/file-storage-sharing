import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export const UNLOCK_TTL_MS = 15 * 60 * 1000;

/**
 * One cookie per link, named by the link id. The id is not a secret; the
 * token is, and it never goes into a cookie.
 */
export function unlockCookieName(linkId: string): string {
  return `slk_${linkId}`;
}

function sign(linkId: string, expiresAt: number): string {
  return createHmac('sha256', config.sessionSecret)
    .update(`${linkId}|${expiresAt}`)
    .digest('base64url');
}

/** `expiry.signature` — stateless, so unlocking costs no database row. */
export function issueUnlockToken(linkId: string, now: number = Date.now()): string {
  const expiresAt = now + UNLOCK_TTL_MS;
  return `${expiresAt}.${sign(linkId, expiresAt)}`;
}

export function verifyUnlockToken(linkId: string, raw: unknown, now: number = Date.now()): boolean {
  if (typeof raw !== 'string') return false;

  const separator = raw.indexOf('.');
  if (separator <= 0) return false;

  const expiresAt = Number(raw.slice(0, separator));
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;

  const provided = Buffer.from(raw.slice(separator + 1), 'utf8');
  const expected = Buffer.from(sign(linkId, expiresAt), 'utf8');

  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
