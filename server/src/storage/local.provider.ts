import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { ObjectNotFoundError, type PutMeta, type PutResult, type StorageProvider } from './StorageProvider.js';

/**
 * Disk-backed provider, used to prove the abstraction is real and as the
 * fallback when no object store is configured.
 */
export class LocalDiskStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /**
   * Keys are app-generated, but this is the layer where a traversal would
   * become arbitrary filesystem access, so it is checked here regardless.
   */
  private resolveKey(key: string): string {
    if (key.length === 0 || path.isAbsolute(key)) {
      throw new Error(`invalid storage key: ${key}`);
    }
    const full = path.resolve(this.root, key);
    const prefix = this.root + path.sep;
    if (full !== this.root && !full.startsWith(prefix)) {
      throw new Error(`invalid storage key escapes storage root: ${key}`);
    }
    return full;
  }

  async put(key: string, body: Readable, _meta: PutMeta): Promise<PutResult> {
    const full = this.resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true });

    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        size += chunk.length;
        cb(null, chunk);
      },
    });

    // Write to a temp name and rename, so a failed upload never leaves a
    // half-written object under the real key.
    const tmp = `${full}.${randomUUID()}.part`;
    try {
      await pipeline(body, meter, createWriteStream(tmp));
      await rename(tmp, full);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }

    return { size, sha256: hash.digest() };
  }

  async getStream(key: string): Promise<Readable> {
    const full = this.resolveKey(key);
    if (!(await this.exists(key))) throw new ObjectNotFoundError(key);
    return createReadStream(full);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    // resolveKey stays outside the try: an invalid key is a caller error and
    // must surface, not be reported as "no such object".
    const full = this.resolveKey(key);
    try {
      return (await stat(full)).isFile();
    } catch {
      return false;
    }
  }
}
