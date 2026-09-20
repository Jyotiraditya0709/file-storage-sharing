import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskStorageProvider } from '../src/storage/local.provider.js';
import { S3StorageProvider } from '../src/storage/s3.provider.js';
import { ObjectNotFoundError, type StorageProvider } from '../src/storage/StorageProvider.js';

function s3FromEnv(): S3StorageProvider {
  return new S3StorageProvider({
    endpoint: process.env.S3_ENDPOINT!,
    region: process.env.S3_REGION!,
    bucket: process.env.S3_BUCKET!,
    accessKey: process.env.S3_ACCESS_KEY!,
    secretKey: process.env.S3_SECRET_KEY!,
    forcePathStyle: true,
  });
}

const providers: { name: string; make: () => Promise<StorageProvider> }[] = [
  { name: 'S3StorageProvider (MinIO)', make: async () => s3FromEnv() },
  {
    name: 'LocalDiskStorageProvider',
    make: async () => new LocalDiskStorageProvider(await mkdtemp(path.join(tmpdir(), 'blkbox-'))),
  },
];

// One suite, both implementations. If the two ever diverge, this fails.
describe.each(providers)('StorageProvider contract: $name', ({ make }) => {
  let storage: StorageProvider;

  beforeAll(async () => {
    storage = await make();
  });

  it('put -> exists -> getStream bytes equal -> delete -> exists false', async () => {
    const key = `ws/${randomUUID()}/doc/${randomUUID()}`;
    const payload = Buffer.from('the quick brown fox jumps over the lazy dog\n'.repeat(100));

    const result = await storage.put(key, Readable.from(payload), {
      contentType: 'text/plain',
    });

    expect(result.size).toBe(payload.byteLength);
    expect(result.sha256.equals(createHash('sha256').update(payload).digest())).toBe(true);

    expect(await storage.exists(key)).toBe(true);

    const roundTripped = await buffer(await storage.getStream(key));
    expect(roundTripped.equals(payload)).toBe(true);

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  });

  it('exists is false for a key that was never written', async () => {
    expect(await storage.exists(`ws/${randomUUID()}/doc/${randomUUID()}`)).toBe(false);
  });

  it('getStream on a missing key rejects with ObjectNotFoundError', async () => {
    await expect(storage.getStream(`ws/${randomUUID()}/doc/${randomUUID()}`)).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });

  it('delete is idempotent', async () => {
    const key = `ws/${randomUUID()}/doc/${randomUUID()}`;
    await expect(storage.delete(key)).resolves.toBeUndefined();
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it('handles an object larger than one multipart chunk', async () => {
    const key = `ws/${randomUUID()}/doc/${randomUUID()}`;
    const payload = Buffer.alloc(6 * 1024 * 1024, 'a');

    const result = await storage.put(key, Readable.from(payload), {
      contentType: 'application/octet-stream',
    });

    expect(result.size).toBe(payload.byteLength);
    expect((await buffer(await storage.getStream(key))).equals(payload)).toBe(true);
    await storage.delete(key);
  });
});

describe('LocalDiskStorageProvider path safety', () => {
  it('refuses keys that escape the storage root', async () => {
    const storage = new LocalDiskStorageProvider(await mkdtemp(path.join(tmpdir(), 'blkbox-')));

    for (const key of ['../escape', 'ws/../../escape', '/etc/passwd', '']) {
      await expect(storage.exists(key)).rejects.toThrow(/invalid storage key/);
    }
  });
});
