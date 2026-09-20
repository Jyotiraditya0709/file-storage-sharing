export type ErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
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

/** For a member inside a workspace acting beyond their role. Never for outsiders. */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
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
