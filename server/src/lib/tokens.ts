import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 bytes of CSPRNG, base64url. Never Math.random. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as their sha256; the plaintext is shown once. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Last 6 characters, for identifying a link in the UI without revealing it. */
export function tokenTail(token: string): string {
  return token.slice(-6);
}
