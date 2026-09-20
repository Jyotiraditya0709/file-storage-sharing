import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { config } from '../config.js';
import { RateLimitedError } from '../lib/errors.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

/**
 * In-process and per-IP, per SPEC §1. Single API instance is a documented
 * limit; Redis would replace the store without touching call sites.
 *
 * Disabled under NODE_ENV=test: the suite creates far more than ten accounts
 * from one address, and a shared counter would make unrelated tests flaky.
 */
function limiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: MAX_ATTEMPTS,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.nodeEnv === 'test',
    handler: (_req, _res, next) => next(new RateLimitedError()),
  });
}

export const loginLimiter = limiter();
export const signupLimiter = limiter();
export const unlockLimiter = limiter();
