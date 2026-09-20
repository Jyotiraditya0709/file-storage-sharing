import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../config.js';
import { AppError, type ErrorCode } from '../lib/errors.js';

function body(code: ErrorCode, message: string) {
  return { error: { code, message } };
}

/** Unknown /api/* path. Registered before the SPA fallback. */
export function apiNotFound(_req: Request, res: Response): void {
  res.status(404).json(body('NOT_FOUND', 'Not found'));
}

/** Last middleware. Every error leaves the app through here. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json(body(err.code, err.message));
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json(body('VALIDATION_ERROR', 'Invalid request'));
    return;
  }

  // An oversize JSON body is a client error, not a crash.
  if (err instanceof Error && 'type' in err && err.type === 'entity.too.large') {
    res.status(413).json(body('PAYLOAD_TOO_LARGE', 'Request body too large'));
    return;
  }

  if (config.nodeEnv !== 'test') {
    console.error('unhandled error', err);
  }
  res.status(500).json(body('INTERNAL', 'Internal server error'));
}
