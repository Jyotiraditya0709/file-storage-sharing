import { z } from 'zod';

/**
 * S2 validates only the variables the scaffold actually reads. `.env.example`
 * carries the full set the finished app needs; S4/S5/S7/S9/S10 extend this
 * schema as they wire each one in. A variable that is not in this schema is
 * ignored, never silently trusted.
 *
 * Every entry has a default, so `pnpm dev` and `vitest` work with no .env at
 * all. Compose passes the real values explicitly.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  WEB_DIST_PATH: z.string().min(1).default('../web/dist'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment:\n${issues}`);
}

export const config = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  webDistPath: parsed.data.WEB_DIST_PATH,
} as const;

export type Config = typeof config;
