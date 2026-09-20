import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SAME_ORIGIN, app, signUp, uniqueEmail } from './helpers.js';

describe('signup, login, session, logout', () => {
  it('signs up, sets an HttpOnly SameSite=Lax cookie, and /me returns the user', async () => {
    const email = uniqueEmail();
    const agent = request.agent(app);

    const signup = await agent
      .post('/api/auth/signup')
      .set(SAME_ORIGIN)
      .send({ email, displayName: 'Ada', password: 'correct-horse-battery' });

    expect(signup.status).toBe(201);
    expect(signup.body.user).toMatchObject({ email, displayName: 'Ada' });
    expect(signup.body.user.passwordHash).toBeUndefined();

    const setCookie = signup.headers['set-cookie'] as string[] | undefined;
    const cookie = setCookie?.[0];
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/^sid=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    // APP_URL is http:// in tests, so Secure must be absent or the browser
    // would drop the cookie on localhost.
    expect(cookie).not.toContain('Secure');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('rejects a password shorter than 10 characters', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .set(SAME_ORIGIN)
      .send({ email: uniqueEmail(), displayName: 'Short', password: 'nine char' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('treats email as case-insensitive for both uniqueness and login', async () => {
    const email = uniqueEmail();
    const password = 'correct-horse-battery';

    await request(app)
      .post('/api/auth/signup')
      .set(SAME_ORIGIN)
      .send({ email, displayName: 'Ada', password })
      .expect(201);

    const duplicate = await request(app)
      .post('/api/auth/signup')
      .set(SAME_ORIGIN)
      .send({ email: email.toUpperCase(), displayName: 'Impostor', password });
    expect(duplicate.status).toBe(409);

    const login = await request(app)
      .post('/api/auth/login')
      .set(SAME_ORIGIN)
      .send({ email: email.toUpperCase(), password });
    expect(login.status).toBe(200);
  });

  it('gives the same 401 for an unknown address and a wrong password', async () => {
    const email = uniqueEmail();
    await request(app)
      .post('/api/auth/signup')
      .set(SAME_ORIGIN)
      .send({ email, displayName: 'Ada', password: 'correct-horse-battery' })
      .expect(201);

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .set(SAME_ORIGIN)
      .send({ email, password: 'wrong-password-here' });

    const unknownUser = await request(app)
      .post('/api/auth/login')
      .set(SAME_ORIGIN)
      .send({ email: uniqueEmail(), password: 'wrong-password-here' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.text).toBe(unknownUser.text);
  });

  it('/me is 401 without a session', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('logout deletes the session server-side, so the cookie stops working', async () => {
    const user = await signUp();

    await user.agent.get('/api/auth/me').expect(200);
    await user.agent.post('/api/auth/logout').set(SAME_ORIGIN).expect(204);

    const after = await user.agent.get('/api/auth/me');
    expect(after.status).toBe(401);
  });

  it('a tampered session secret is rejected', async () => {
    const user = await signUp();
    const me = await user.agent.get('/api/auth/me').expect(200);
    expect(me.body.user.id).toBe(user.id);

    const forged = await request(app)
      .get('/api/auth/me')
      .set('Cookie', 'sid=deadbeef.notthesecret');

    expect(forged.status).toBe(401);
  });
});

describe('CSRF (Sec-Fetch-Site)', () => {
  const credentials = { email: 'x@example.com', password: 'correct-horse-battery' };

  it('allows same-origin and none', async () => {
    for (const site of ['same-origin', 'none']) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Sec-Fetch-Site', site)
        .send(credentials);
      expect(res.status).not.toBe(403);
    }
  });

  it('blocks cross-site and same-site with CSRF_REJECTED, not FORBIDDEN', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Sec-Fetch-Site', site)
        .send(credentials);
      expect(res.status).toBe(403);
      // A rejected cross-site request and a role denial share the 403 but not
      // the code: SPEC §2 reserves FORBIDDEN for "a member acting beyond their
      // role", and conflating the two sends a caller hunting a permissions bug
      // when the real fix is to resend the request properly.
      expect(res.body.error.code).toBe('CSRF_REJECTED');
      expect(res.body.error.code).not.toBe('FORBIDDEN');
    }
  });

  it('allows a non-browser client that sends neither header', async () => {
    const res = await request(app).post('/api/auth/login').send(credentials);
    expect(res.status).not.toBe(403);
  });

  it('blocks an Origin without Sec-Fetch-Site', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send(credentials);
    expect(res.status).toBe(403);
  });

  it('never blocks a GET', async () => {
    const res = await request(app).get('/api/auth/me').set('Sec-Fetch-Site', 'cross-site');
    expect(res.status).toBe(401);
  });
});
