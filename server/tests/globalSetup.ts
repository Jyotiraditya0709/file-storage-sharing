import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const POSTGRES_IMAGE = 'postgres:16';
const MINIO_IMAGE = 'quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z';
const BUCKET = 'test-docs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '../../drizzle');

let postgres: StartedPostgreSqlContainer;
let minio: StartedMinioContainer;

/**
 * Real Postgres and real MinIO for the whole run. Environment set here is
 * visible in the test workers (verified against vitest 5), which is how the
 * app's module-level config picks up the container endpoints.
 */
export async function setup() {
  [postgres, minio] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase('blkbox_test')
      .withUsername('blkbox')
      .withPassword('blkbox')
      .start(),
    new MinioContainer(MINIO_IMAGE).withUsername('testkey').withPassword('testsecret').start(),
  ]);

  const databaseUrl = postgres.getConnectionUri();
  const s3Endpoint = `http://${minio.getHost()}:${minio.getPort()}`;

  // Migrations run against the same files compose applies, so the tests and
  // the deployed stack can never drift.
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }

  const s3 = new S3Client({
    endpoint: s3Endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'testkey', secretAccessKey: 'testsecret' },
  });
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  s3.destroy();

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_URL = 'http://localhost:3000';
  process.env.SESSION_SECRET = 'test-session-secret';
  process.env.STORAGE_DRIVER = 's3';
  process.env.S3_ENDPOINT = s3Endpoint;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_BUCKET = BUCKET;
  process.env.S3_ACCESS_KEY = 'testkey';
  process.env.S3_SECRET_KEY = 'testsecret';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  process.env.MAX_UPLOAD_BYTES = String(1024 * 1024);
  // The limiter still runs for every request in the suite; the ceiling is just
  // lifted above what the suite generates from one address. rateLimit.test.ts
  // builds its own app with a ceiling of 2 to prove the limiter actually bites.
  process.env.RATE_LIMIT_MAX = String(100_000);
}

export async function teardown() {
  await Promise.all([postgres?.stop(), minio?.stop()]);
}
