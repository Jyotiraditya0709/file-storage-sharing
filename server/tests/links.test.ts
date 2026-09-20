import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { shareLinks } from '../src/db/schema.js';
import {
  SAME_ORIGIN,
  UNIFORM_NOT_FOUND,
  addMember,
  app,
  createShareLink,
  createWorkspace,
  signUp,
  uploadDocument,
  type TestUser,
} from './helpers.js';

async function storedLink(linkId: string) {
  const [row] = await db.select().from(shareLinks).where(eq(shareLinks.id, linkId)).limit(1);
  if (!row) throw new Error(`link ${linkId} not found`);
  return row;
}

/** Ages a link past its expiry. The API refuses a past expiresAt, so the row
 *  is edited directly: the point of the test is the read path, not the write. */
async function expire(linkId: string): Promise<void> {
  await db
    .update(shareLinks)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(shareLinks.id, linkId));
}

/**
 * ARCHITECTURE #3. Six different reasons a token does not work, one answer.
 * The bodies are compared byte for byte, because a holder who can tell
 * "revoked" from "unknown" learns that the token was once real.
 */
describe('every share-link failure is the same 404 (ARCHITECTURE #3)', () => {
  let owner: TestUser;
  let wid: string;
  const replies: Record<string, { status: number; text: string }> = {};

  beforeAll(async () => {
    owner = await signUp('Owner');
    wid = await createWorkspace(owner, 'Links');

    const doc = await uploadDocument(owner, wid, 'secret bytes', 'secret.txt');

    const record = async (
      reason: string,
      run: () => Promise<{ status: number; text: string }>,
    ) => {
      const res = await run();
      replies[reason] = { status: res.status, text: res.text };
    };

    // 1. unknown token — a well-formed base64url string that was never issued.
    await record('unknown', async () => request(app).get(`/api/s/${'A'.repeat(43)}/download`));

    // 2. revoked
    const revoked = await createShareLink(owner, wid, doc.id);
    await owner.agent
      .delete(`/api/workspaces/${wid}/links/${revoked.linkId}`)
      .set(SAME_ORIGIN)
      .expect(204);
    await record('revoked', async () => request(app).get(`/api/s/${revoked.token}/download`));

    // 3. expired
    const expired = await createShareLink(owner, wid, doc.id);
    await expire(expired.linkId);
    await record('expired', async () => request(app).get(`/api/s/${expired.token}/download`));

    // 4. exhausted — one download allowed, spent.
    const exhausted = await createShareLink(owner, wid, doc.id, { maxDownloads: 1 });
    await request(app).get(`/api/s/${exhausted.token}/download`).expect(200);
    await record('exhausted', async () => request(app).get(`/api/s/${exhausted.token}/download`));

    // 5. wrong password — both the unlock attempt and the still-locked download.
    const locked = await createShareLink(owner, wid, doc.id, { password: 'correct-password' });
    await record('wrongPassword', async () =>
      request(app)
        .post(`/api/s/${locked.token}/unlock`)
        .set(SAME_ORIGIN)
        .send({ password: 'not-the-password' }),
    );
    await record('lockedDownload', async () =>
      request(app).get(`/api/s/${locked.token}/download`),
    );

    // 6. document deleted after the link was made.
    const orphaned = await createShareLink(owner, wid, doc.id);
    await owner.agent
      .delete(`/api/workspaces/${wid}/documents/${doc.id}`)
      .set(SAME_ORIGIN)
      .expect(204);
    await record('documentDeleted', async () =>
      request(app).get(`/api/s/${orphaned.token}/download`),
    );
    await record('documentDeletedMetadata', async () =>
      request(app).get(`/api/s/${orphaned.token}`),
    );
  });

  it('unknown, revoked, expired, exhausted, wrong-password and deleted are indistinguishable', async () => {
    expect(Object.keys(replies)).toEqual([
      'unknown',
      'revoked',
      'expired',
      'exhausted',
      'wrongPassword',
      'lockedDownload',
      'documentDeleted',
      'documentDeletedMetadata',
    ]);

    for (const [reason, res] of Object.entries(replies)) {
      expect(`${reason}:${res.status}`).toBe(`${reason}:404`);
      expect(`${reason}:${res.text}`).toBe(`${reason}:${UNIFORM_NOT_FOUND}`);
    }

    // Byte-identical to each other, not merely "all 404": a holder cannot
    // learn which of the six reasons applies.
    expect(new Set(Object.values(replies).map((r) => r.text)).size).toBe(1);
  });
});

describe('a valid share link downloads exactly the stored bytes', () => {
  it('serves the content as an attachment with nosniff, and grants nothing else', async () => {
    const owner = await signUp('Owner');
    const outsider = await signUp('Outsider');
    const wid = await createWorkspace(owner, 'Valid link');
    const content = 'the bytes behind the link\n';
    const doc = await uploadDocument(owner, wid, content, 'shared.txt');
    const { token } = await createShareLink(owner, wid, doc.id);

    const meta = await request(app).get(`/api/s/${token}`);
    expect(meta.status).toBe(200);
    expect(meta.body).toEqual({
      requiresPassword: false,
      document: {
        name: 'shared.txt',
        sizeBytes: content.length,
        mimeType: 'text/plain',
        uploadedBy: owner.displayName,
      },
    });

    const download = await request(app).get(`/api/s/${token}/download`);
    expect(download.status).toBe(200);
    expect(download.text).toBe(content);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['content-disposition']).toContain('shared.txt');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['content-length']).toBe(String(content.length));

    // SPEC §5: a link never grants workspace access. Anonymous is 401 on the
    // workspace API; a logged-in stranger holding the token is 404.
    const anonymous = await request(app).get(`/api/workspaces/${wid}/documents/${doc.id}`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHORIZED');

    const stranger = await outsider.agent.get(`/api/workspaces/${wid}/documents/${doc.id}`);
    expect(stranger.status).toBe(404);
    expect(stranger.text).toBe(UNIFORM_NOT_FOUND);

    const strangerList = await outsider.agent.get(`/api/workspaces/${wid}/documents`);
    expect(strangerList.status).toBe(404);
  });
});

/**
 * ARCHITECTURE #3, the part that only a real database can prove: the limit is
 * applied in the same statement as the increment, so ten racing requests
 * cannot each read "4 so far".
 */
describe('max_downloads is enforced atomically under concurrency', () => {
  it('10 concurrent downloads against max_downloads = 5 yield exactly 5 successes', async () => {
    const owner = await signUp('Owner');
    const wid = await createWorkspace(owner, 'Race');
    const content = 'racing bytes\n';
    const doc = await uploadDocument(owner, wid, content, 'race.txt');
    const { token, linkId } = await createShareLink(owner, wid, doc.id, { maxDownloads: 5 });

    const results = await Promise.all(
      Array.from({ length: 10 }, async () => request(app).get(`/api/s/${token}/download`)),
    );

    const ok = results.filter((r) => r.status === 200);
    const notFound = results.filter((r) => r.status === 404);

    expect(ok).toHaveLength(5);
    expect(notFound).toHaveLength(5);
    expect(results).toHaveLength(ok.length + notFound.length);

    for (const success of ok) expect(success.text).toBe(content);
    for (const miss of notFound) expect(miss.text).toBe(UNIFORM_NOT_FOUND);

    // The stored counter is the real assertion: no double count, no overshoot.
    expect((await storedLink(linkId)).downloadCount).toBe(5);

    // And the link stays dead afterwards.
    const after = await request(app).get(`/api/s/${token}/download`);
    expect(after.status).toBe(404);
    expect((await storedLink(linkId)).downloadCount).toBe(5);
  });
});

/** SPEC §9: the password gate hides the metadata too, not just the bytes. */
describe('password-protected links (SPEC §9)', () => {
  let wid: string;
  let token: string;
  let owner: TestUser;

  beforeAll(async () => {
    owner = await signUp('Owner');
    wid = await createWorkspace(owner, 'Protected link');
    const doc = await uploadDocument(owner, wid, 'locked bytes\n', 'payroll.txt');
    ({ token } = await createShareLink(owner, wid, doc.id, { password: 'open-sesame-please' }));
  });

  it('leaks no filename before unlock and works after the right password', async () => {
    const holder = request.agent(app);

    const locked = await holder.get(`/api/s/${token}`);
    expect(locked.status).toBe(200);
    expect(locked.body).toEqual({ requiresPassword: true });
    expect(locked.text).not.toContain('payroll');

    const lockedDownload = await holder.get(`/api/s/${token}/download`);
    expect(lockedDownload.status).toBe(404);
    expect(lockedDownload.text).toBe(UNIFORM_NOT_FOUND);

    const wrong = await holder
      .post(`/api/s/${token}/unlock`)
      .set(SAME_ORIGIN)
      .send({ password: 'wrong-password-x' });
    expect(wrong.status).toBe(404);
    expect(wrong.text).toBe(UNIFORM_NOT_FOUND);

    const unlock = await holder
      .post(`/api/s/${token}/unlock`)
      .set(SAME_ORIGIN)
      .send({ password: 'open-sesame-please' });
    expect(unlock.status).toBe(204);

    const unlocked = await holder.get(`/api/s/${token}`);
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.requiresPassword).toBe(true);
    expect(unlocked.body.document.name).toBe('payroll.txt');

    const download = await holder.get(`/api/s/${token}/download`);
    expect(download.status).toBe(200);
    expect(download.text).toBe('locked bytes\n');
    expect(download.headers['x-content-type-options']).toBe('nosniff');

    // The unlock cookie is scoped to this link: a different visitor is still
    // locked out.
    const other = request.agent(app);
    expect((await other.get(`/api/s/${token}`)).body).toEqual({ requiresPassword: true });
    expect((await other.get(`/api/s/${token}/download`)).status).toBe(404);
  });
});

describe('who may revoke a share link (SPEC §5)', () => {
  it('a member revokes only their own link; an admin revokes anyone\'s', async () => {
    const owner = await signUp('Owner');
    const member = await signUp('Member');
    const otherMember = await signUp('Other');
    const wid = await createWorkspace(owner, 'Revoke');
    await addMember(owner, wid, member, 'member');
    await addMember(owner, wid, otherMember, 'member');

    const doc = await uploadDocument(member, wid, 'bytes', 'doc.txt');
    const mine = await createShareLink(member, wid, doc.id);

    const byPeer = await otherMember.agent
      .delete(`/api/workspaces/${wid}/links/${mine.linkId}`)
      .set(SAME_ORIGIN);
    expect(byPeer.status).toBe(403);
    expect(byPeer.body.error.code).toBe('FORBIDDEN');
    expect((await request(app).get(`/api/s/${mine.token}`)).status).toBe(200);

    const byCreator = await member.agent
      .delete(`/api/workspaces/${wid}/links/${mine.linkId}`)
      .set(SAME_ORIGIN);
    expect(byCreator.status).toBe(204);
    expect((await request(app).get(`/api/s/${mine.token}`)).status).toBe(404);

    const theirs = await createShareLink(member, wid, doc.id);
    const byOwner = await owner.agent
      .delete(`/api/workspaces/${wid}/links/${theirs.linkId}`)
      .set(SAME_ORIGIN);
    expect(byOwner.status).toBe(204);
    expect((await request(app).get(`/api/s/${theirs.token}/download`)).status).toBe(404);
  });
});
