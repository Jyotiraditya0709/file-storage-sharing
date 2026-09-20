import { z } from 'zod';
import { NotFoundError } from './errors.js';

const uuid = z.string().uuid();

/**
 * A malformed id in a path is indistinguishable, to an outsider, from an id
 * that simply does not exist — so it is a 404, never a 400 and never a 500
 * from Postgres rejecting the cast. Keeps the outsider story uniform.
 */
export function parseUuidParam(value: unknown): string {
  const result = uuid.safeParse(value);
  if (!result.success) throw new NotFoundError();
  return result.data;
}

/**
 * A share or invitation token from the path. Anything that cannot be a token —
 * wrong type, empty, absurdly long — is the same 404 as a token that simply
 * does not exist, so the uniform-404 story has no seam. A 400 here would tell
 * a prober that their input was merely malformed.
 */
export function parseTokenParam(value: unknown): string {
  const result = z.string().min(1).max(512).safeParse(value);
  if (!result.success) throw new NotFoundError();
  return result.data;
}
