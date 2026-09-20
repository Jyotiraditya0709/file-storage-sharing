import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { buildApp } from '../src/app.js';

export const app = buildApp();

/** Every mutating request needs this, exactly as a browser would send it. */
export const SAME_ORIGIN = { 'Sec-Fetch-Site': 'same-origin' } as const;

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

export interface TestUser {
  agent: TestAgent;
  id: string;
  email: string;
  displayName: string;
}

/** Signs up a fresh user and returns a cookie-carrying agent for them. */
export async function signUp(displayName = 'Test User'): Promise<TestUser> {
  const agent = request.agent(app);
  const email = uniqueEmail();

  const res = await agent
    .post('/api/auth/signup')
    .set(SAME_ORIGIN)
    .send({ email, displayName, password: 'correct-horse-battery' });

  if (res.status !== 201) {
    throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return { agent, id: res.body.user.id, email, displayName };
}
