import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SAME_ORIGIN, UNIFORM_NOT_FOUND, uniqueEmail } from './helpers.js';

/**
 * SPEC §1 rate-limits login and signup. The suite as a whole runs with a high
 * ceiling so unrelated tests are not throttled, so this is the test that
 * proves the limiter is mounted and enforcing rather than merely configured.
 */
describe('login rate limiting (SPEC §1)', () => {
  it('returns 429 with the uniform body once the ceiling is passed', async () => {
    const app = buildApp({ rateLimitMax: 2 });
    const credentials = { email: uniqueEmail(), password: 'correct-horse-battery' };

    const post = () => request(app).post('/api/auth/login').set(SAME_ORIGIN).send(credentials);

    // Under the ceiling the limiter is transparent: these fail on credentials.
    expect((await post()).status).toBe(401);
    expect((await post()).status).toBe(401);

    const third = await post();
    expect(third.status).toBe(429);
    expect(third.body).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    });
    expect(third.text).not.toBe(UNIFORM_NOT_FOUND);
  });

  it('counts per limiter, so exhausting login does not block signup', async () => {
    const app = buildApp({ rateLimitMax: 2 });
    const credentials = { email: uniqueEmail(), password: 'correct-horse-battery' };

    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/api/auth/login').set(SAME_ORIGIN).send(credentials);
    }
    expect(
      (await request(app).post('/api/auth/login').set(SAME_ORIGIN).send(credentials)).status,
    ).toBe(429);

    const signup = await request(app)
      .post('/api/auth/signup')
      .set(SAME_ORIGIN)
      .send({ email: uniqueEmail(), displayName: 'Fresh', password: 'correct-horse-battery' });

    expect(signup.status).toBe(201);
  });

  it('a fresh app has fresh counters, so limits do not leak between instances', async () => {
    const credentials = { email: uniqueEmail(), password: 'correct-horse-battery' };

    const first = buildApp({ rateLimitMax: 1 });
    await request(first).post('/api/auth/login').set(SAME_ORIGIN).send(credentials);
    expect(
      (await request(first).post('/api/auth/login').set(SAME_ORIGIN).send(credentials)).status,
    ).toBe(429);

    const second = buildApp({ rateLimitMax: 1 });
    expect(
      (await request(second).post('/api/auth/login').set(SAME_ORIGIN).send(credentials)).status,
    ).toBe(401);
  });
});
