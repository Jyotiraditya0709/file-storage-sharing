import { ConflictError, UnauthorizedError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { hashToken, randomToken, safeEqual } from '../lib/tokens.js';
import * as sessionsRepo from '../db/repositories/sessions.repo.js';
import * as usersRepo from '../db/repositories/users.repo.js';

export const SESSION_TTL_MS = 10 * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface SessionIssued {
  user: AuthUser;
  /** Cookie value `id.secret`. The secret is never stored, only its sha256. */
  cookieValue: string;
  maxAgeMs: number;
}

export interface ResolvedSession {
  user: AuthUser;
  sessionId: string;
  /** Set when the sliding window was extended and the cookie must be re-sent. */
  renewed?: { cookieValue: string; maxAgeMs: number };
}

function toAuthUser(row: usersRepo.UserRow): AuthUser {
  return { id: row.id, email: row.email, displayName: row.displayName };
}

async function createSession(userId: string): Promise<{ cookieValue: string; maxAgeMs: number }> {
  const id = randomToken(16);
  const secret = randomToken(32);
  await sessionsRepo.insert({
    id,
    userId,
    secretHash: hashToken(secret),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return { cookieValue: `${id}.${secret}`, maxAgeMs: SESSION_TTL_MS };
}

export async function signup(input: {
  email: string;
  displayName: string;
  password: string;
}): Promise<SessionIssued> {
  const existing = await usersRepo.findByEmail(input.email);
  if (existing) throw new ConflictError('Email already registered');

  const user = await usersRepo.insert({
    email: input.email,
    displayName: input.displayName,
    passwordHash: await hashPassword(input.password),
  });

  const session = await createSession(user.id);
  return { user: toAuthUser(user), ...session };
}

export async function login(input: { email: string; password: string }): Promise<SessionIssued> {
  const user = await usersRepo.findByEmail(input.email);

  // Same error and roughly the same work whether the address exists or not.
  if (!user) {
    await hashPassword(input.password);
    throw new UnauthorizedError('Invalid email or password');
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const session = await createSession(user.id);
  return { user: toAuthUser(user), ...session };
}

export async function logout(sessionId: string): Promise<void> {
  await sessionsRepo.deleteById(sessionId);
}

/**
 * Cookie value is `id.secret`. Look up by id, compare sha256(secret) to the
 * stored hash in constant time, and slide the expiry once more than half the
 * window has elapsed. Membership is checked per request elsewhere, so a
 * removed member loses access immediately without touching sessions.
 */
export async function resolveSession(cookieValue: string): Promise<ResolvedSession | null> {
  const separator = cookieValue.indexOf('.');
  if (separator <= 0) return null;

  const id = cookieValue.slice(0, separator);
  const secret = cookieValue.slice(separator + 1);
  if (secret.length === 0) return null;

  const session = await sessionsRepo.findById(id);
  if (!session) return null;

  if (!safeEqual(hashToken(secret), session.secretHash)) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await sessionsRepo.deleteById(id);
    return null;
  }

  const user = await usersRepo.findById(session.userId);
  if (!user) {
    await sessionsRepo.deleteById(id);
    return null;
  }

  const resolved: ResolvedSession = { user: toAuthUser(user), sessionId: id };

  if (session.expiresAt.getTime() - now < SESSION_TTL_MS / 2) {
    const expiresAt = new Date(now + SESSION_TTL_MS);
    await sessionsRepo.updateExpiry(id, expiresAt);
    resolved.renewed = { cookieValue, maxAgeMs: SESSION_TTL_MS };
  }

  return resolved;
}
