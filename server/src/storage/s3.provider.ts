import { createHash } from 'node:crypto';
import { PassThrough, Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { ObjectNotFoundError, type PutMeta, type PutResult, type StorageProvider } from './StorageProvider.js';

/** S3 multipart minimum. Anything smaller is rejected by the API. */
const PART_SIZE = 5 * 1024 * 1024;

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

export interface S3ProviderOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
}

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: S3ProviderOptions) {
    this.bucket = opts.bucket;
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: opts.forcePathStyle,
      credentials: { accessKeyId: opts.accessKey, secretAccessKey: opts.secretKey },
    });
  }

  async put(key: string, body: Readable, meta: PutMeta): Promise<PutResult> {
    const hash = createHash('sha256');
    let size = 0;

    // Hash and count in a Transform, then pipeline into the stream S3 reads.
    // pipeline (not pipe) because pipe does not forward errors: if the client
    // aborts mid-upload, pipe would leave this PassThrough open forever and
    // upload.done() would never settle, hanging the request and leaving the
    // multipart upload open. pipeline destroys the destination instead, so
    // done() rejects and the caller's cleanup runs.
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        size += chunk.length;
        callback(null, chunk);
      },
    });
    const tee = new PassThrough();
    const pumped = pipeline(body, meter, tee);

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: tee,
        ContentType: meta.contentType,
      },
      partSize: PART_SIZE,
      queueSize: 4,
    });

    await Promise.all([upload.done(), pumped]);

    return { size, sha256: hash.digest() };
  }

  async getStream(key: string): Promise<Readable> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!res.Body) throw new ObjectNotFoundError(key);
      return res.Body as Readable;
    } catch (err) {
      if (isNotFound(err)) throw new ObjectNotFoundError(key);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}
