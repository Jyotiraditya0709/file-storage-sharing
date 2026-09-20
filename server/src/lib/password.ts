import argon2 from 'argon2';

/** OWASP argon2id minimums: 19 MiB, 2 iterations, 1 lane. */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed stored hash is a verification failure, not a 500.
    return false;
  }
}
