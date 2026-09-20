import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '../lib/errors.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence via Fetch Metadata.
 *
 * Allowed: Sec-Fetch-Site of `same-origin` (our own fetch) or `none` (direct
 * navigation), and requests carrying neither Sec-Fetch-Site nor Origin, which
 * is a non-browser client such as curl and cannot be a CSRF vector. Anything
 * else — `cross-site`, `same-site`, or an Origin without Sec-Fetch-Site — is
 * refused. Every browser capable of mounting the attack sends one of them.
 */
export function csrf(req: Request, _res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }

  const site = req.get('sec-fetch-site');
  if (site === 'same-origin' || site === 'none') {
    next();
    return;
  }

  if (site === undefined && req.get('origin') === undefined) {
    next();
    return;
  }

  throw new ForbiddenError('Cross-site request blocked');
}
