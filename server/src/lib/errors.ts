export type ErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CSRF_REJECTED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The single 404. The message is deliberately fixed: outsiders, unknown share
 * tokens, revoked links and deleted documents must all produce a byte-identical
 * body, so nothing can be distinguished by probing.
 */
export class NotFoundError extends AppError {
  constructor() {
    super(404, 'NOT_FOUND', 'Not found');
  }
}

/**
 * For a member inside a workspace acting beyond their role. Never for
 * outsiders, and never for a rejected cross-site request: FORBIDDEN means
 * "you are who you say you are, and the answer is still no".
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

/**
 * A mutating request that failed the Fetch Metadata check. Shares the 403
 * status with ForbiddenError but carries its own code, because the two mean
 * completely different things: this one says "resend this request properly",
 * FORBIDDEN says "your role does not permit this". A caller debugging by
 * status alone would otherwise conflate a CSRF rejection with a role denial.
 */
export class CsrfError extends AppError {
  constructor(message = 'Cross-site request blocked') {
    super(403, 'CSRF_REJECTED', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request') {
    super(400, 'VALIDATION_ERROR', message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(409, 'CONFLICT', message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'File too large') {
    super(413, 'PAYLOAD_TOO_LARGE', message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests') {
    super(429, 'RATE_LIMITED', message);
  }
}
