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

/** Body parsing at the route boundary. Failures are 400 VALIDATION_ERROR. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  return schema.parse(body);
}
