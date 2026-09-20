import { z } from 'zod';

/**
 * Every variable the server reads, validated once at boot. `.env.example`
 * carries the full set; compose passes the composed values explicitly.
 *
 * DATABASE_URL is derived from POSTGRES_* when it is not set, so the password
 * has exactly one source of truth: compose passes an explicit URL, and a
 * host-side `pnpm dev` builds the same URL from the same .env.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    WEB_DIST_PATH: z.string().min(1).default('../web/dist'),

    DATABASE_URL: z.string().min(1).optional(),
    POSTGRES_USER: z.string().min(1).optional(),
    POSTGRES_PASSWORD: z.string().min(1).optional(),
    POSTGRES_DB: z.string().min(1).optional(),
    POSTGRES_HOST: z.string().min(1).default('localhost'),
    POSTGRES_PORT: z.coerce.number().int().positive().max(65535).default(5432),

    APP_URL: z.string().url().default('http://localhost:3000'),
    SESSION_SECRET: z.string().min(1).optional(),

    STORAGE_DRIVER: z.enum(['s3', 'local']).default('s3'),
    LOCAL_STORAGE_PATH: z.string().min(1).default('./var/storage'),
    S3_ENDPOINT: z.string().min(1).default('http://localhost:9000'),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(1).default('blkbox-docs'),
    S3_ACCESS_KEY: z.string().min(1).optional(),
    S3_SECRET_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),

    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(50 * 1024 * 1024),
  })
  .transform((env, ctx) => {
    const databaseUrl =
      env.DATABASE_URL ??
      (env.POSTGRES_USER && env.POSTGRES_PASSWORD && env.POSTGRES_DB
        ? `postgres://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(
            env.POSTGRES_PASSWORD,
          )}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`
        : undefined);

    if (!databaseUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'set DATABASE_URL, or POSTGRES_USER + POSTGRES_PASSWORD + POSTGRES_DB',
      });
      return z.NEVER;
    }

    // SESSION_SECRET also keys the share-link unlock HMAC, so a fallback is a
    // convenience for local work and a signing key everywhere else. Required
    // whenever this looks like a real deployment: NODE_ENV=production, or an
    // https APP_URL (which is also what turns on Secure cookies).
    const looksDeployed =
      env.NODE_ENV === 'production' || env.APP_URL.startsWith('https://');

    if (looksDeployed && !env.SESSION_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'required when NODE_ENV=production or APP_URL is https',
      });
      return z.NEVER;
    }
    const sessionSecret = env.SESSION_SECRET ?? 'insecure-development-session-secret';

    return { ...env, DATABASE_URL: databaseUrl, SESSION_SECRET: sessionSecret };
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment:\n${issues}`);
}

const env = parsed.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  webDistPath: env.WEB_DIST_PATH,

  databaseUrl: env.DATABASE_URL,

  appUrl: env.APP_URL,
  sessionSecret: env.SESSION_SECRET,
  /**
   * Derived from the APP_URL scheme, never from NODE_ENV: a Secure cookie is
   * silently dropped by the browser over http://localhost, which is exactly
   * how the local demo runs.
   */
  cookieSecure: new URL(env.APP_URL).protocol === 'https:',

  storageDriver: env.STORAGE_DRIVER,
  localStoragePath: env.LOCAL_STORAGE_PATH,
  s3: {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  },

  maxUploadBytes: env.MAX_UPLOAD_BYTES,
  /** Attempts per 15 minutes per IP on login, signup and share-link unlock. */
  rateLimitMax: env.RATE_LIMIT_MAX,
} as const;

export type Config = typeof config;
