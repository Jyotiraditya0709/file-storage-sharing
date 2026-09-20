import { defineConfig } from 'drizzle-kit';

// The schema file lands in S3; drizzle-kit only reads it for `generate`.
// `migrate` reads the generated SQL in ../drizzle and the DATABASE_URL below.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: '../drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
