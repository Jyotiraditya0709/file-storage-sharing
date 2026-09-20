import { z } from 'zod';
import { ValidationError } from './errors.js';

export interface Cursor {
  createdAt: Date;
  id: string;
}

/** Opaque to the client, so the pagination key can change without an API break. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  if (separator <= 0) throw new ValidationError('Invalid cursor');

  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);

  // The id goes into a comparison against a uuid column, so a non-uuid would
  // reach Postgres and come back as a 500 rather than a client error.
  if (Number.isNaN(createdAt.getTime()) || !z.string().uuid().safeParse(id).success) {
    throw new ValidationError('Invalid cursor');
  }
  return { createdAt, id };
}
