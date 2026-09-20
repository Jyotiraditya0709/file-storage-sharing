import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { users } from '../schema.js';

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: Date;
}

export async function findByEmail(email: string): Promise<UserRow | undefined> {
  // citext: the comparison is case-insensitive in the database.
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row;
}

export async function findById(id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export async function insert(input: {
  email: string;
  displayName: string;
  passwordHash: string;
}): Promise<UserRow> {
  const [row] = await db.insert(users).values(input).returning();
  return row!;
}
