import type { Readable } from 'node:stream';

export interface PutMeta {
  contentType: string;
}

export interface PutResult {
  /** Bytes actually written. */
  size: number;
  /** sha256 of the bytes, computed while streaming. */
  sha256: Buffer;
}

/**
 * The storage seam. Only services call this; routes never import it.
 *
 * Implementations must stream: no method may collect a whole object in
 * memory. Keys are always app-generated (`ws/{workspaceId}/doc/{documentId}`)
 * and never contain client-supplied path components.
 */
export interface StorageProvider {
  /** Streams `body` to `key`, hashing as it goes. Overwrites if present. */
  put(key: string, body: Readable, meta: PutMeta): Promise<PutResult>;
  getStream(key: string): Promise<Readable>;
  /** Idempotent: deleting a key that is not there resolves. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** Thrown by getStream when the object is not in the backend. */
export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`storage object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}
