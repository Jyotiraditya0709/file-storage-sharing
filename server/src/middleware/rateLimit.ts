import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { RateLimitedError } from '../lib/errors.js';

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * In-process and per-IP, per SPEC §1. A single API instance is a documented
 * limit; a Redis store would replace this without touching call sites.
 *
 * Built per app instance rather than as a module singleton so the counters
 * are fresh for each buildApp() and the ceiling can be lowered in a test that
 * actually drives the limiter to 429.
 */
export function createLimiter(max: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new RateLimitedError()),
  });
}

export interface Limiters {
  login: RateLimitRequestHandler;
  signup: RateLimitRequestHandler;
  unlock: RateLimitRequestHandler;
}

/** Separate buckets: exhausting login must not lock a visitor out of signup. */
export function createLimiters(max: number): Limiters {
  return { login: createLimiter(max), signup: createLimiter(max), unlock: createLimiter(max) };
}
