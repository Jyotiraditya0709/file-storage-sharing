import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE, sessionCookieOptions } from '../lib/cookies.js';
import { UnauthorizedError } from '../lib/errors.js';
import { resolveSession } from '../services/auth.service.js';

/** Turns the session cookie into req.user, or leaves the request anonymous. */
export async function attachUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof raw !== 'string' || raw.length === 0) {
    next();
    return;
  }

  const session = await resolveSession(raw);
  if (!session) {
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(0));
    next();
    return;
  }

  req.user = session.user;
  req.sessionId = session.sessionId;

  if (session.renewed) {
    res.cookie(
      SESSION_COOKIE,
      session.renewed.cookieValue,
      sessionCookieOptions(session.renewed.maxAgeMs),
    );
  }

  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new UnauthorizedError();
  next();
}
