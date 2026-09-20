import { eq, lt } from 'drizzle-orm';
import { db } from '../client.js';
import { sessions } from '../schema.js';

export interface SessionRow {
  id: string;
  userId: string;
  secretHash: Buffer;
  expiresAt: Date;
  createdAt: Date;
}

export async function insert(row: {
  id: string;
  userId: string;
  secretHash: Buffer;
  expiresAt: Date;
}): Promise<void> {
  await db.insert(sessions).values(row);
}

export async function findById(id: string): Promise<SessionRow | undefined> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return row;
}

export async function updateExpiry(id: string, expiresAt: Date): Promise<void> {
  await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
}

export async function deleteById(id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function deleteExpired(now: Date): Promise<number> {
  const rows = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({
    id: sessions.id,
  });
  return rows.length;
}
