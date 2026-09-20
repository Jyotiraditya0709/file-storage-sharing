import type { CookieOptions } from 'express';
import { config } from '../config.js';

export const SESSION_COOKIE = 'sid';

/**
 * Secure comes from the APP_URL scheme, never from NODE_ENV: a Secure cookie
 * is silently dropped over http://localhost, which is how the demo runs.
 */
export function sessionCookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function clearedSessionCookieOptions(): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/' };
}
