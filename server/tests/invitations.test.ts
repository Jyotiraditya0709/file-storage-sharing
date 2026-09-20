import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { invitations } from '../src/db/schema.js';
import {
  SAME_ORIGIN,
  UNIFORM_NOT_FOUND,
  addMember,
  app,
  createWorkspace,
  signUp,
  uniqueEmail,
  type TestUser,
} from './helpers.js';

interface Invite {
  id: string;
  token: string;
}

async function invite(
  inviter: TestUser,
  workspaceId: string,
  email: string,
  role: 'admin' | 'member' | 'viewer',
): Promise<Invite> {
  const res = await inviter.agent
    .post(`/api/workspaces/${workspaceId}/invitations`)
    .set(SAME_ORIGIN)
    .send({ email, role });

  expect(res.status).toBe(201);
  return { id: res.body.invitation.id, token: String(res.body.inviteUrl).split('/invite/')[1]! };
}

/** The 7-day TTL is enforced on read, so ageing the row is the only way to
 *  reach the expired branch without waiting a week. */
async function expireInvitation(id: string): Promise<void> {
  await db
    .update(invitations)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(invitations.id, id));
}

async function roleOf(
  reader: TestUser,
  workspaceId: string,
  userId: string,
): Promise<string | undefined> {
  const res = await reader.agent.get(`/api/workspaces/${workspaceId}/members`);
  expect(res.status).toBe(200);
  return res.body.members.find((m: { userId: string }) => m.userId === userId)?.role;
}

/** ARCHITECTURE #4. */
describe('invitation acceptance is bound to the invited address (ARCHITECTURE #4)', () => {
  let owner: TestUser;
  let wid: string;

  beforeAll(async () => {
    owner = await signUp('Owner');
    wid = await createWorkspace(owner, 'Invites');
  });

  it('a logged-in user with a different email cannot accept, even holding the token', async () => {
    const intended = await signUp('Intended');
    const interloper = await signUp('Interloper');
    const { token } = await invite(owner, wid, intended.email, 'admin');

    const stolen = await interloper.agent.post(`/api/invitations/${token}/accept`).set(SAME_ORIGIN);
    expect(stolen.status).toBe(404);
    expect(stolen.text).toBe(UNIFORM_NOT_FOUND);

    // No membership was created for the interloper, and the invitation still works.
    expect(await roleOf(owner, wid, interloper.id)).toBeUndefined();

    const accepted = await intended.agent.post(`/api/invitations/${token}/accept`).set(SAME_ORIGIN);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ workspaceId: wid, role: 'admin' });
  });

  it('accepting creates the membership with exactly the invited role', async () => {
    const invitee = await signUp('Viewer To Be');
    const { token } = await invite(owner, wid, invitee.email, 'viewer');

    const accepted = await invitee.agent.post(`/api/invitations/${token}/accept`).set(SAME_ORIGIN);
    expect(accepted.status).toBe(200);
    expect(accepted.body.role).toBe('viewer');

    expect(await roleOf(owner, wid, invitee.id)).toBe('viewer');

    // The role is real, not decorative: a viewer still cannot upload.
    const upload = await invitee.agent
      .post(`/api/workspaces/${wid}/documents`)
      .set(SAME_ORIGIN)
      .attach('file', Buffer.from('x'), { filename: 'x.txt' });
    expect(upload.status).toBe(403);
  });

  it('the email match is case-insensitive, per SPEC §6', async () => {
    const user = await signUp('Mixed Case');
    // The account owns the lower-case address; the invitation names it in upper case.
    const { token } = await invite(owner, wid, user.email.toUpperCase(), 'member');

    const accepted = await user.agent.post(`/api/invitations/${token}/accept`).set(SAME_ORIGIN);
    expect(accepted.status).toBe(200);
    expect(accepted.body.role).toBe('member');
  });

  it('an invitation cannot be accepted twice', async () => {
    const invitee = await signUp('Once');
    const { token } = await invite(owner, wid, invitee.email, 'member');

    const first = await invitee.agent.post(`/api/invitations/${token}/accept`).set(SAME_ORIGIN);
    expect(first.status).toBe(200);

    const second = await invitee.agent.post(`/api/invitations/${token}/accept`).set(SAME_ORIGIN);
    expect(second.status).toBe(404);
    expect(second.text).toBe(UNIFORM_NOT_FOUND);

    // The preview is dead too, so the link cannot even be inspected again.
    const preview = await request(app).get(`/api/invitations/${token}`);
    expect(preview.status).toBe(404);
  });

  it('an expired invitation cannot be accepted or previewed', async () => {
    const invitee = await signUp('Too Late');
    const { id, token } = await invite(owner, wid, invitee.email, 'admin');

    const previewBefore = await request(app).get(`/api/invitations/${token}`);
    expect(previewBefore.status).toBe(200);
    expect(previewBefore.body.invitation).toEqual({
      workspaceName: 'Invites',
      role: 'admin',
      email: invitee.email,
    });

    await expireInvitation(id);

    const accepted = await invitee.agent.post(`/api/invitations/${token}/accept`).set(SAME_ORIGIN);
    expect(accepted.status).toBe(404);
    expect(accepted.text).toBe(UNIFORM_NOT_FOUND);
    expect(await roleOf(owner, wid, invitee.id)).toBeUndefined();

    const preview = await request(app).get(`/api/invitations/${token}`);
    expect(preview.status).toBe(404);
    expect(preview.text).toBe(UNIFORM_NOT_FOUND);
  });

  it('a revoked invitation cannot be accepted and its preview is 404', async () => {
    const invitee = await signUp('Rescinded');
    const { id, token } = await invite(owner, wid, invitee.email, 'member');

    const revoke = await owner.agent
      .delete(`/api/workspaces/${wid}/invitations/${id}`)
      .set(SAME_ORIGIN);
    expect(revoke.status).toBe(204);

    const preview = await request(app).get(`/api/invitations/${token}`);
    expect(preview.status).toBe(404);
    expect(preview.text).toBe(UNIFORM_NOT_FOUND);

    const accepted = await invitee.agent.post(`/api/invitations/${token}/accept`).set(SAME_ORIGIN);
    expect(accepted.status).toBe(404);
    expect(accepted.text).toBe(UNIFORM_NOT_FOUND);
    expect(await roleOf(owner, wid, invitee.id)).toBeUndefined();

    // Revoking twice is still 404: the row is no longer pending.
    const again = await owner.agent
      .delete(`/api/workspaces/${wid}/invitations/${id}`)
      .set(SAME_ORIGIN);
    expect(again.status).toBe(404);
  });

  it('every invitation-token failure shares one body', async () => {
    const invitee = await signUp('Uniform');
    const stranger = await signUp('Stranger');

    const accepted = await invite(owner, wid, invitee.email, 'member');
    await invitee.agent.post(`/api/invitations/${accepted.token}/accept`).set(SAME_ORIGIN).expect(200);

    const revokedInvite = await invite(owner, wid, uniqueEmail('revoked'), 'member');
    await owner.agent
      .delete(`/api/workspaces/${wid}/invitations/${revokedInvite.id}`)
      .set(SAME_ORIGIN)
      .expect(204);

    const expiredInvite = await invite(owner, wid, stranger.email, 'member');
    await expireInvitation(expiredInvite.id);

    const wrongEmail = await invite(owner, wid, uniqueEmail('nobody'), 'member');

    const bodies = [
      (await request(app).get(`/api/invitations/${'B'.repeat(43)}`)).text,
      (await request(app).get(`/api/invitations/${accepted.token}`)).text,
      (await request(app).get(`/api/invitations/${revokedInvite.token}`)).text,
      (await request(app).get(`/api/invitations/${expiredInvite.token}`)).text,
      (await stranger.agent.post(`/api/invitations/${wrongEmail.token}/accept`).set(SAME_ORIGIN))
        .text,
      (await stranger.agent.post(`/api/invitations/${expiredInvite.token}/accept`).set(SAME_ORIGIN))
        .text,
      (await stranger.agent.post(`/api/invitations/${'C'.repeat(43)}/accept`).set(SAME_ORIGIN)).text,
    ];

    for (const body of bodies) expect(body).toBe(UNIFORM_NOT_FOUND);
    expect(new Set(bodies).size).toBe(1);
  });
});

describe('invitation bookkeeping (SPEC §6)', () => {
  it('allows only one pending invitation per (workspace, email); the second is 409', async () => {
    const owner = await signUp('Owner');
    const wid = await createWorkspace(owner, 'Pending');
    const email = uniqueEmail('duplicate');

    const first = await invite(owner, wid, email, 'member');

    const second = await owner.agent
      .post(`/api/workspaces/${wid}/invitations`)
      .set(SAME_ORIGIN)
      .send({ email, role: 'admin' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CONFLICT');

    const pending = await owner.agent.get(`/api/workspaces/${wid}/invitations`);
    expect(pending.body.invitations).toHaveLength(1);
    expect(pending.body.invitations[0].id).toBe(first.id);

    // Once the first is out of "pending", the address can be invited again.
    await owner.agent
      .delete(`/api/workspaces/${wid}/invitations/${first.id}`)
      .set(SAME_ORIGIN)
      .expect(204);

    const third = await owner.agent
      .post(`/api/workspaces/${wid}/invitations`)
      .set(SAME_ORIGIN)
      .send({ email, role: 'admin' });
    expect(third.status).toBe(201);
  });

  it('accepting as an existing member succeeds without changing the role', async () => {
    const owner = await signUp('Owner');
    const member = await signUp('Already In');
    const wid = await createWorkspace(owner, 'Already');
    await addMember(owner, wid, member, 'member');
    expect(await roleOf(owner, wid, member.id)).toBe('member');

    // A second invitation, deliberately for a lower role.
    const { token } = await invite(owner, wid, member.email, 'viewer');

    const accepted = await member.agent.post(`/api/invitations/${token}/accept`).set(SAME_ORIGIN);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ workspaceId: wid, role: 'member' });

    // The existing role survives: an invitation never downgrades a member.
    expect(await roleOf(owner, wid, member.id)).toBe('member');

    // And the invitation is consumed, not left pending.
    const pending = await owner.agent.get(`/api/workspaces/${wid}/invitations`);
    expect(pending.body.invitations).toHaveLength(0);
  });

  it('an admin may invite an admin but never an owner, and a member may not invite at all', async () => {
    const owner = await signUp('Owner');
    const admin = await signUp('Admin');
    const member = await signUp('Member');
    const wid = await createWorkspace(owner, 'Grants');
    await addMember(owner, wid, admin, 'admin');
    await addMember(owner, wid, member, 'member');

    const peer = await admin.agent
      .post(`/api/workspaces/${wid}/invitations`)
      .set(SAME_ORIGIN)
      .send({ email: uniqueEmail('peer'), role: 'admin' });
    expect(peer.status).toBe(201);

    const asOwner = await admin.agent
      .post(`/api/workspaces/${wid}/invitations`)
      .set(SAME_ORIGIN)
      .send({ email: uniqueEmail('boss'), role: 'owner' });
    expect(asOwner.status).toBe(400);
    expect(asOwner.body.error.code).toBe('VALIDATION_ERROR');

    const byMember = await member.agent
      .post(`/api/workspaces/${wid}/invitations`)
      .set(SAME_ORIGIN)
      .send({ email: uniqueEmail('friend'), role: 'viewer' });
    expect(byMember.status).toBe(403);
    expect(byMember.body.error.code).toBe('FORBIDDEN');

    const byMemberList = await member.agent.get(`/api/workspaces/${wid}/invitations`);
    expect(byMemberList.status).toBe(403);
  });

  it('an invitation to a deleted workspace is 404 for preview and accept', async () => {
    const owner = await signUp('Owner');
    const invitee = await signUp('Never Joins');
    const wid = await createWorkspace(owner, 'Doomed');
    const { token } = await invite(owner, wid, invitee.email, 'member');

    await owner.agent.delete(`/api/workspaces/${wid}`).set(SAME_ORIGIN).expect(204);

    const preview = await request(app).get(`/api/invitations/${token}`);
    expect(preview.status).toBe(404);
    expect(preview.text).toBe(UNIFORM_NOT_FOUND);

    const accepted = await invitee.agent.post(`/api/invitations/${token}/accept`).set(SAME_ORIGIN);
    expect(accepted.status).toBe(404);
    expect(accepted.text).toBe(UNIFORM_NOT_FOUND);
  });
});
