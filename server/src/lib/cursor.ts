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

  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw new ValidationError('Invalid cursor');
  }
  return { createdAt, id };
}
