const UNIQUE_VIOLATION = '23505';

interface PgErrorish {
  code?: string;
  constraint?: string;
}

/**
 * Drizzle wraps driver errors, so the pg error code sits on the cause rather
 * than the thrown error. Walk the chain rather than guessing a depth.
 */
function pgError(err: unknown): PgErrorish | undefined {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as PgErrorish & { cause?: unknown };
    if (typeof candidate.code === 'string') return candidate;
    current = candidate.cause;
  }
  return undefined;
}

/** True for a unique-constraint violation, optionally a named one. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = pgError(err);
  if (pg?.code !== UNIQUE_VIOLATION) return false;
  return constraint === undefined || pg.constraint === constraint;
}
