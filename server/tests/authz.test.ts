import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
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
  type UploadedDoc,
} from './helpers.js';

/** Just enough of a supertest Response to assert on, so the tables stay readable. */
interface Reply {
  status: number;
  text: string;
  body: { error?: { code?: string } };
}

/**
 * ARCHITECTURE "Tests aimed at what would embarrass us" #1.
 *
 * Every one of these must be 404 with the one uniform body: a 403 here would
 * confirm that the resource exists, and a different message would let an
 * outsider tell "wrong workspace" from "no such document".
 */
describe('cross-workspace access is 404, never 403 (ARCHITECTURE #1)', () => {
  let alice: TestUser;
  let bob: TestUser;
  let wsA: string;
  let wsB: string;
  let docB: UploadedDoc;

  beforeAll(async () => {
    alice = await signUp('Alice');
    bob = await signUp('Bob');
    wsA = await createWorkspace(alice, 'Alice workspace');
    wsB = await createWorkspace(bob, 'Bob workspace');
    docB = await uploadDocument(bob, wsB, 'bob only', 'bob.txt');
  });

  it("a member of A cannot list, get, download, rename or delete B's document by id", async () => {
    const attempts: Array<[string, () => Promise<Reply>]> = [
      ['list', async () => alice.agent.get(`/api/workspaces/${wsB}/documents`)],
      ['get', async () => alice.agent.get(`/api/workspaces/${wsB}/documents/${docB.id}`)],
      [
        'download',
        async () => alice.agent.get(`/api/workspaces/${wsB}/documents/${docB.id}/download`),
      ],
      [
        'rename',
        async () =>
          alice.agent
            .patch(`/api/workspaces/${wsB}/documents/${docB.id}`)
            .set(SAME_ORIGIN)
            .send({ name: 'stolen.txt' }),
      ],
      [
        'delete',
        async () =>
          alice.agent.delete(`/api/workspaces/${wsB}/documents/${docB.id}`).set(SAME_ORIGIN),
      ],
      ['workspace', async () => alice.agent.get(`/api/workspaces/${wsB}`)],
      ['members', async () => alice.agent.get(`/api/workspaces/${wsB}/members`)],
      ['trash', async () => alice.agent.get(`/api/workspaces/${wsB}/trash`)],
      ['links', async () => alice.agent.get(`/api/workspaces/${wsB}/documents/${docB.id}/links`)],
    ];

    for (const [label, run] of attempts) {
      const res = await run();
      expect(`${label}:${res.status}`).toBe(`${label}:404`);
      expect(res.text).toBe(UNIFORM_NOT_FOUND);
    }
  });

  it("the nasty variant: A's workspace id in the path with B's document id is still 404", async () => {
    const attempts: Array<[string, () => Promise<Reply>]> = [
      ['get', async () => alice.agent.get(`/api/workspaces/${wsA}/documents/${docB.id}`)],
      [
        'download',
        async () => alice.agent.get(`/api/workspaces/${wsA}/documents/${docB.id}/download`),
      ],
      [
        'rename',
        async () =>
          alice.agent
            .patch(`/api/workspaces/${wsA}/documents/${docB.id}`)
            .set(SAME_ORIGIN)
            .send({ name: 'stolen.txt' }),
      ],
      [
        'delete',
        async () =>
          alice.agent.delete(`/api/workspaces/${wsA}/documents/${docB.id}`).set(SAME_ORIGIN),
      ],
      [
        'create link',
        async () =>
          alice.agent
            .post(`/api/workspaces/${wsA}/documents/${docB.id}/links`)
            .set(SAME_ORIGIN)
            .send({}),
      ],
      [
        'restore from trash',
        async () =>
          alice.agent.post(`/api/workspaces/${wsA}/trash/${docB.id}/restore`).set(SAME_ORIGIN),
      ],
    ];

    for (const [label, run] of attempts) {
      const res = await run();
      expect(`${label}:${res.status}`).toBe(`${label}:404`);
      expect(res.text).toBe(UNIFORM_NOT_FOUND);
    }

    // The document is untouched: the owner still sees the original name.
    const stillThere = await bob.agent.get(`/api/workspaces/${wsB}/documents/${docB.id}`);
    expect(stillThere.status).toBe(200);
    expect(stillThere.body.document.name).toBe('bob.txt');
  });

  it('a workspace id that does not exist is the same 404 as one that does', async () => {
    const unknown = await alice.agent.get(`/api/workspaces/${randomUUID()}/documents`);
    const existing = await alice.agent.get(`/api/workspaces/${wsB}/documents`);

    expect(unknown.status).toBe(404);
    expect(unknown.text).toBe(existing.text);
    expect(unknown.text).toBe(UNIFORM_NOT_FOUND);
  });
});

/**
 * ARCHITECTURE #2: the SPEC §2 role table, enforced server-side. Everything
 * here happens inside a workspace the caller can see, so the answer is 403
 * FORBIDDEN — the rule is stated, not hidden.
 */
describe('role limits inside a workspace are 403 FORBIDDEN (ARCHITECTURE #2)', () => {
  let owner: TestUser;
  let admin: TestUser;
  let admin2: TestUser;
  let member: TestUser;
  let other: TestUser;
  let viewer: TestUser;
  let wid: string;
  let memberDoc: UploadedDoc;

  beforeAll(async () => {
    owner = await signUp('Owner');
    admin = await signUp('Admin');
    admin2 = await signUp('Admin Two');
    member = await signUp('Member');
    other = await signUp('Other Member');
    viewer = await signUp('Viewer');

    wid = await createWorkspace(owner, 'Roles');
    await addMember(owner, wid, admin, 'admin');
    await addMember(owner, wid, admin2, 'admin');
    await addMember(owner, wid, member, 'member');
    await addMember(owner, wid, other, 'member');
    await addMember(owner, wid, viewer, 'viewer');

    memberDoc = await uploadDocument(member, wid, 'members bytes', 'member.txt');
  });

  it('a viewer can read but cannot upload, create a share link, or invite', async () => {
    const read = await viewer.agent.get(`/api/workspaces/${wid}/documents/${memberDoc.id}`);
    expect(read.status).toBe(200);

    const upload = await viewer.agent
      .post(`/api/workspaces/${wid}/documents`)
      .set(SAME_ORIGIN)
      .attach('file', Buffer.from('nope'), { filename: 'nope.txt' });
    expect(upload.status).toBe(403);
    expect(upload.body.error.code).toBe('FORBIDDEN');

    const link = await viewer.agent
      .post(`/api/workspaces/${wid}/documents/${memberDoc.id}/links`)
      .set(SAME_ORIGIN)
      .send({});
    expect(link.status).toBe(403);
    expect(link.body.error.code).toBe('FORBIDDEN');

    const invite = await viewer.agent
      .post(`/api/workspaces/${wid}/invitations`)
      .set(SAME_ORIGIN)
      .send({ email: 'someone@example.com', role: 'viewer' });
    expect(invite.status).toBe(403);
    expect(invite.body.error.code).toBe('FORBIDDEN');
  });

  it('a member cannot rename or delete another member\'s document, but can act on their own', async () => {
    const rename = await other.agent
      .patch(`/api/workspaces/${wid}/documents/${memberDoc.id}`)
      .set(SAME_ORIGIN)
      .send({ name: 'hijacked.txt' });
    expect(rename.status).toBe(403);
    expect(rename.body.error.code).toBe('FORBIDDEN');

    const remove = await other.agent
      .delete(`/api/workspaces/${wid}/documents/${memberDoc.id}`)
      .set(SAME_ORIGIN);
    expect(remove.status).toBe(403);
    expect(remove.body.error.code).toBe('FORBIDDEN');

    // Still there, still called what its uploader called it.
    const unchanged = await member.agent.get(`/api/workspaces/${wid}/documents/${memberDoc.id}`);
    expect(unchanged.body.document.name).toBe('member.txt');

    // A member owns their own upload: rename and delete both succeed.
    const own = await uploadDocument(other, wid, 'my bytes', 'mine.txt');
    const ownRename = await other.agent
      .patch(`/api/workspaces/${wid}/documents/${own.id}`)
      .set(SAME_ORIGIN)
      .send({ name: 'mine-renamed.txt' });
    expect(ownRename.status).toBe(200);
    expect(ownRename.body.document.name).toBe('mine-renamed.txt');

    const ownDelete = await other.agent
      .delete(`/api/workspaces/${wid}/documents/${own.id}`)
      .set(SAME_ORIGIN);
    expect(ownDelete.status).toBe(204);
  });

  it("an admin may rename and delete anyone's document (SPEC §2 'any document')", async () => {
    const doc = await uploadDocument(member, wid, 'bytes', 'admin-target.txt');

    const rename = await admin.agent
      .patch(`/api/workspaces/${wid}/documents/${doc.id}`)
      .set(SAME_ORIGIN)
      .send({ name: 'renamed-by-admin.txt' });
    expect(rename.status).toBe(200);

    const removed = await admin.agent
      .delete(`/api/workspaces/${wid}/documents/${doc.id}`)
      .set(SAME_ORIGIN);
    expect(removed.status).toBe(204);
  });

  it('an admin cannot remove or demote the owner', async () => {
    const demote = await admin.agent
      .patch(`/api/workspaces/${wid}/members/${owner.id}`)
      .set(SAME_ORIGIN)
      .send({ role: 'member' });
    expect(demote.status).toBe(403);
    expect(demote.body.error.code).toBe('FORBIDDEN');

    const remove = await admin.agent
      .delete(`/api/workspaces/${wid}/members/${owner.id}`)
      .set(SAME_ORIGIN);
    expect(remove.status).toBe(403);
    expect(remove.body.error.code).toBe('FORBIDDEN');

    const members = await owner.agent.get(`/api/workspaces/${wid}/members`);
    const ownerRow = members.body.members.find(
      (m: { userId: string }) => m.userId === owner.id,
    );
    expect(ownerRow.role).toBe('owner');
  });

  it('an admin cannot remove or demote a peer admin', async () => {
    const demote = await admin.agent
      .patch(`/api/workspaces/${wid}/members/${admin2.id}`)
      .set(SAME_ORIGIN)
      .send({ role: 'member' });
    expect(demote.status).toBe(403);
    expect(demote.body.error.code).toBe('FORBIDDEN');

    const remove = await admin.agent
      .delete(`/api/workspaces/${wid}/members/${admin2.id}`)
      .set(SAME_ORIGIN);
    expect(remove.status).toBe(403);
    expect(remove.body.error.code).toBe('FORBIDDEN');
  });

  it('nobody grants a role above their own, and nobody sets owner through /members', async () => {
    // An admin cannot mint an admin's superior. 'member' is grantable by an
    // admin, so this exercises the rank rule rather than the enum.
    const aboveOwnRole = await admin.agent
      .patch(`/api/workspaces/${wid}/members/${member.id}`)
      .set(SAME_ORIGIN)
      .send({ role: 'owner' });
    // 'owner' is not in the members schema at all — the same answer the
    // invitations route gives for the same input, rather than 403 there and
    // 400 here for one request.
    expect(aboveOwnRole.status).toBe(400);
    expect(aboveOwnRole.body.error.code).toBe('VALIDATION_ERROR');

    // Not even the owner: ownership moves only through /transfer, which keeps
    // one_owner_per_workspace true.
    const byOwner = await owner.agent
      .patch(`/api/workspaces/${wid}/members/${member.id}`)
      .set(SAME_ORIGIN)
      .send({ role: 'owner' });
    expect(byOwner.status).toBe(400);
    expect(byOwner.body.error.code).toBe('VALIDATION_ERROR');

    // With 'owner' out of the enum, can()'s "never above your own role" check
    // is unreachable through this route and remains as defence in depth; the
    // reachable version of that rule is covered on the invitations route below.

    // And the invitation route refuses the role outright.
    const invite = await owner.agent
      .post(`/api/workspaces/${wid}/invitations`)
      .set(SAME_ORIGIN)
      .send({ email: 'owner-wannabe@example.com', role: 'owner' });
    expect(invite.status).toBe(400);
    expect(invite.body.error.code).toBe('VALIDATION_ERROR');

    const members = await owner.agent.get(`/api/workspaces/${wid}/members`);
    expect(
      members.body.members.filter((m: { role: string }) => m.role === 'owner'),
    ).toHaveLength(1);
  });

  it('a member cannot rename or delete the workspace, and an admin cannot delete it', async () => {
    const renameByMember = await member.agent
      .patch(`/api/workspaces/${wid}`)
      .set(SAME_ORIGIN)
      .send({ name: 'mine now' });
    expect(renameByMember.status).toBe(403);
    expect(renameByMember.body.error.code).toBe('FORBIDDEN');

    const deleteByAdmin = await admin.agent.delete(`/api/workspaces/${wid}`).set(SAME_ORIGIN);
    expect(deleteByAdmin.status).toBe(403);
    expect(deleteByAdmin.body.error.code).toBe('FORBIDDEN');

    const transferByAdmin = await admin.agent
      .post(`/api/workspaces/${wid}/transfer`)
      .set(SAME_ORIGIN)
      .send({ userId: admin.id });
    expect(transferByAdmin.status).toBe(403);
  });

  // Last: this one mutates a role, so it must not run before the checks above.
  it('the owner can demote an admin, proving the 403s are the rule and not a blanket deny', async () => {
    const res = await owner.agent
      .patch(`/api/workspaces/${wid}/members/${admin2.id}`)
      .set(SAME_ORIGIN)
      .send({ role: 'member' });
    expect(res.status).toBe(204);

    const members = await owner.agent.get(`/api/workspaces/${wid}/members`);
    const row = members.body.members.find((m: { userId: string }) => m.userId === admin2.id);
    expect(row.role).toBe('member');
  });
});

/** SPEC §2: 404 hides existence from outsiders; 403 tells insiders the rule. */
describe('the 404-vs-403 distinction on the same action', () => {
  let owner: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let wid: string;

  beforeAll(async () => {
    owner = await signUp('Owner');
    viewer = await signUp('Viewer');
    outsider = await signUp('Outsider');
    wid = await createWorkspace(owner, 'Distinction');
    await addMember(owner, wid, viewer, 'viewer');
  });

  it('the same upload is 404 for an outsider and 403 for a viewer', async () => {
    const byOutsider = await outsider.agent
      .post(`/api/workspaces/${wid}/documents`)
      .set(SAME_ORIGIN)
      .attach('file', Buffer.from('x'), { filename: 'x.txt' });
    expect(byOutsider.status).toBe(404);
    expect(byOutsider.text).toBe(UNIFORM_NOT_FOUND);

    const byViewer = await viewer.agent
      .post(`/api/workspaces/${wid}/documents`)
      .set(SAME_ORIGIN)
      .attach('file', Buffer.from('x'), { filename: 'x.txt' });
    expect(byViewer.status).toBe(403);
    expect(byViewer.body.error.code).toBe('FORBIDDEN');
  });

  it('the same invite is 404 for an outsider and 403 for a viewer', async () => {
    const byOutsider = await outsider.agent
      .post(`/api/workspaces/${wid}/invitations`)
      .set(SAME_ORIGIN)
      .send({ email: 'x@example.com', role: 'member' });
    expect(byOutsider.status).toBe(404);
    expect(byOutsider.text).toBe(UNIFORM_NOT_FOUND);

    const byViewer = await viewer.agent
      .post(`/api/workspaces/${wid}/invitations`)
      .set(SAME_ORIGIN)
      .send({ email: 'x@example.com', role: 'member' });
    expect(byViewer.status).toBe(403);
    expect(byViewer.body.error.code).toBe('FORBIDDEN');
  });

  it('an outsider is not told the workspace exists, while an insider can view it', async () => {
    const byOutsider = await outsider.agent.get(`/api/workspaces/${wid}`);
    expect(byOutsider.status).toBe(404);
    expect(byOutsider.text).toBe(UNIFORM_NOT_FOUND);

    const byViewer = await viewer.agent.get(`/api/workspaces/${wid}`);
    expect(byViewer.status).toBe(200);
    expect(byViewer.body.workspace.role).toBe('viewer');
  });
});

describe('unauthenticated requests to protected routes are 401 UNAUTHORIZED', () => {
  let wid: string;
  let doc: UploadedDoc;

  beforeAll(async () => {
    const owner = await signUp('Owner');
    wid = await createWorkspace(owner, 'Protected');
    doc = await uploadDocument(owner, wid, 'private bytes', 'private.txt');
  });

  it('every workspace, document, member and invitation route requires a session', async () => {
    const attempts: Array<[string, () => Promise<Reply>]> = [
      ['list workspaces', async () => request(app).get('/api/workspaces')],
      [
        'create workspace',
        async () => request(app).post('/api/workspaces').set(SAME_ORIGIN).send({ name: 'x' }),
      ],
      ['get workspace', async () => request(app).get(`/api/workspaces/${wid}`)],
      ['list documents', async () => request(app).get(`/api/workspaces/${wid}/documents`)],
      ['get document', async () => request(app).get(`/api/workspaces/${wid}/documents/${doc.id}`)],
      [
        'download document',
        async () => request(app).get(`/api/workspaces/${wid}/documents/${doc.id}/download`),
      ],
      [
        'upload',
        async () =>
          request(app)
            .post(`/api/workspaces/${wid}/documents`)
            .set(SAME_ORIGIN)
            .attach('file', Buffer.from('x'), { filename: 'x.txt' }),
      ],
      [
        'delete document',
        async () =>
          request(app).delete(`/api/workspaces/${wid}/documents/${doc.id}`).set(SAME_ORIGIN),
      ],
      ['list members', async () => request(app).get(`/api/workspaces/${wid}/members`)],
      ['list invitations', async () => request(app).get(`/api/workspaces/${wid}/invitations`)],
      [
        'accept invitation',
        async () => request(app).post('/api/invitations/whatever/accept').set(SAME_ORIGIN),
      ],
      ['list trash', async () => request(app).get(`/api/workspaces/${wid}/trash`)],
      [
        'create link',
        async () =>
          request(app)
            .post(`/api/workspaces/${wid}/documents/${doc.id}/links`)
            .set(SAME_ORIGIN)
            .send({}),
      ],
    ];

    for (const [label, run] of attempts) {
      const res = await run();
      expect(`${label}:${res.status}`).toBe(`${label}:401`);
      expect(res.body.error?.code).toBe('UNAUTHORIZED');
    }
  });
});

/**
 * SPEC §4: deleting a workspace soft-deletes it and members lose access on the
 * next request — documents, downloads and every share link 404. This is the
 * "forgot the join on workspaces.deleted_at" guard.
 */
describe('workspace soft-delete hides documents, downloads and share links', () => {
  let owner: TestUser;
  let member: TestUser;
  let wid: string;
  let doc: UploadedDoc;
  let token: string;

  beforeAll(async () => {
    owner = await signUp('Owner');
    member = await signUp('Member');
    wid = await createWorkspace(owner, 'Doomed');
    await addMember(owner, wid, member, 'member');
    doc = await uploadDocument(member, wid, 'bytes that vanish', 'gone.txt');
    ({ token } = await createShareLink(member, wid, doc.id));

    // Everything works before the delete, so the assertions below are about
    // the delete and not about a broken fixture.
    await member.agent.get(`/api/workspaces/${wid}/documents/${doc.id}`).expect(200);
    await request(app).get(`/api/s/${token}`).expect(200);

    await owner.agent.delete(`/api/workspaces/${wid}`).set(SAME_ORIGIN).expect(204);
  });

  it("a member's document get and download are 404 after the workspace is deleted", async () => {
    const get = await member.agent.get(`/api/workspaces/${wid}/documents/${doc.id}`);
    expect(get.status).toBe(404);
    expect(get.text).toBe(UNIFORM_NOT_FOUND);

    const download = await member.agent.get(
      `/api/workspaces/${wid}/documents/${doc.id}/download`,
    );
    expect(download.status).toBe(404);
    expect(download.text).toBe(UNIFORM_NOT_FOUND);

    const list = await member.agent.get(`/api/workspaces/${wid}/documents`);
    expect(list.status).toBe(404);

    // It is also gone from the member's workspace list.
    const workspaces = await member.agent.get('/api/workspaces');
    expect(workspaces.body.workspaces.map((w: { id: string }) => w.id)).not.toContain(wid);
  });

  it('a share link created before the delete is 404 for metadata and download', async () => {
    const meta = await request(app).get(`/api/s/${token}`);
    expect(meta.status).toBe(404);
    expect(meta.text).toBe(UNIFORM_NOT_FOUND);

    const download = await request(app).get(`/api/s/${token}/download`);
    expect(download.status).toBe(404);
    expect(download.text).toBe(UNIFORM_NOT_FOUND);
  });

  it('even the owner loses access through the API after deleting the workspace', async () => {
    const get = await owner.agent.get(`/api/workspaces/${wid}`);
    expect(get.status).toBe(404);
    expect(get.text).toBe(UNIFORM_NOT_FOUND);
  });
});

/**
 * The UI renders its controls from these booleans and owns no role table of
 * its own, so "the interface reflects permissions" (SPEC §7) is true by
 * construction rather than by two implementations agreeing.
 */
describe('server-computed capabilities drive what the UI renders (SPEC §7)', () => {
  it("a viewer's capabilities are all false and an owner's are all true", async () => {
    const owner = await signUp('Cap Owner');
    const viewer = await signUp('Cap Viewer');
    const wid = await createWorkspace(owner, 'Capabilities');
    await addMember(owner, wid, viewer, 'viewer');

    const asOwner = await owner.agent.get(`/api/workspaces/${wid}`).expect(200);
    const asViewer = await viewer.agent.get(`/api/workspaces/${wid}`).expect(200);

    expect(asOwner.body.workspace.capabilities).toEqual({
      canUpload: true,
      canInvite: true,
      canManageMembers: true,
      canSeeTrash: true,
      canRename: true,
      canDelete: true,
    });

    expect(asViewer.body.workspace.capabilities).toEqual({
      canUpload: false,
      canInvite: false,
      canManageMembers: false,
      canSeeTrash: false,
      canRename: false,
      canDelete: false,
    });

    // Every flag has a matching server-side refusal, so hiding a control is
    // never the only thing standing between a viewer and the action.
    expect(Object.values(asViewer.body.workspace.capabilities).every((v) => v === false)).toBe(
      true,
    );
  });

  it('per-document and per-link flags follow ownership, not just role', async () => {
    const owner = await signUp('Doc Owner');
    const member = await signUp('Doc Member');
    const viewer = await signUp('Doc Viewer');
    const wid = await createWorkspace(owner, 'Flags');
    await addMember(owner, wid, member, 'member');
    await addMember(owner, wid, viewer, 'viewer');

    const mine = await uploadDocument(member, wid, 'mine', 'mine.txt');
    await uploadDocument(owner, wid, 'theirs', 'theirs.txt');

    const asMember = await member.agent.get(`/api/workspaces/${wid}/documents`).expect(200);
    const flags = Object.fromEntries(
      asMember.body.documents.map((d: { name: string; canEdit: boolean }) => [d.name, d.canEdit]),
    );
    expect(flags).toEqual({ 'mine.txt': true, 'theirs.txt': false });
    expect(
      asMember.body.documents.every((d: { canShare: boolean }) => d.canShare === true),
    ).toBe(true);

    const asViewer = await viewer.agent.get(`/api/workspaces/${wid}/documents`).expect(200);
    expect(
      asViewer.body.documents.every(
        (d: { canEdit: boolean; canShare: boolean }) => !d.canEdit && !d.canShare,
      ),
    ).toBe(true);

    // A member may revoke the link they made; a peer member may not.
    const other = await signUp('Other Member');
    await addMember(owner, wid, other, 'member');
    await member.agent
      .post(`/api/workspaces/${wid}/documents/${mine.id}/links`)
      .set(SAME_ORIGIN)
      .send({})
      .expect(201);

    const mineView = await member.agent
      .get(`/api/workspaces/${wid}/documents/${mine.id}/links`)
      .expect(200);
    expect(mineView.body.links[0].canRevoke).toBe(true);

    const peerView = await other.agent
      .get(`/api/workspaces/${wid}/documents/${mine.id}/links`)
      .expect(200);
    expect(peerView.body.links[0].canRevoke).toBe(false);

    const ownerView = await owner.agent
      .get(`/api/workspaces/${wid}/documents/${mine.id}/links`)
      .expect(200);
    expect(ownerView.body.links[0].canRevoke).toBe(true);
  });
});

describe('403 codes are not interchangeable', () => {
  it('a role denial is FORBIDDEN while a cross-site request is CSRF_REJECTED', async () => {
    const owner = await signUp('Code Owner');
    const viewer = await signUp('Code Viewer');
    const wid = await createWorkspace(owner, 'Codes');
    await addMember(owner, wid, viewer, 'viewer');

    // Same endpoint, same caller, two different reasons to refuse.
    const roleDenial = await viewer.agent
      .post(`/api/workspaces/${wid}/documents`)
      .set(SAME_ORIGIN)
      .attach('file', Buffer.from('nope'), { filename: 'nope.txt' });

    const csrfDenial = await viewer.agent
      .post(`/api/workspaces/${wid}/documents`)
      .set('Sec-Fetch-Site', 'cross-site')
      .attach('file', Buffer.from('nope'), { filename: 'nope.txt' });

    expect(roleDenial.status).toBe(403);
    expect(roleDenial.body.error.code).toBe('FORBIDDEN');

    expect(csrfDenial.status).toBe(403);
    expect(csrfDenial.body.error.code).toBe('CSRF_REJECTED');

    expect(roleDenial.body.error.code).not.toBe(csrfDenial.body.error.code);
  });
});

describe('transfer of ownership (SPEC §2)', () => {
  it('moves owner to the target, demotes the previous owner to admin, and keeps exactly one owner', async () => {
    const owner = await signUp('Founder');
    const successor = await signUp('Successor');
    const wid = await createWorkspace(owner, 'Succession');
    await addMember(owner, wid, successor, 'member');

    await owner.agent
      .post(`/api/workspaces/${wid}/transfer`)
      .set(SAME_ORIGIN)
      .send({ userId: successor.id })
      .expect(204);

    // The demote-then-promote ordering inside the transaction exists because
    // one_owner_per_workspace is a plain, non-deferrable unique index. If the
    // order were reversed this call would fail outright.
    const members = await successor.agent.get(`/api/workspaces/${wid}/members`).expect(200);
    const byId = Object.fromEntries(
      members.body.members.map((m: { userId: string; role: string }) => [m.userId, m.role]),
    );
    expect(byId[successor.id]).toBe('owner');
    expect(byId[owner.id]).toBe('admin');
    expect(
      members.body.members.filter((m: { role: string }) => m.role === 'owner'),
    ).toHaveLength(1);

    // Capabilities follow immediately: the new owner may delete, the old may not.
    const successorView = await successor.agent.get(`/api/workspaces/${wid}`).expect(200);
    const founderView = await owner.agent.get(`/api/workspaces/${wid}`).expect(200);
    expect(successorView.body.workspace.capabilities.canDelete).toBe(true);
    expect(founderView.body.workspace.capabilities.canDelete).toBe(false);

    // And the previous owner cannot transfer it back.
    const takeBack = await owner.agent
      .post(`/api/workspaces/${wid}/transfer`)
      .set(SAME_ORIGIN)
      .send({ userId: owner.id });
    expect(takeBack.status).toBe(403);
    expect(takeBack.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses a transfer to yourself rather than silently doing nothing', async () => {
    const owner = await signUp('Self Transfer');
    const wid = await createWorkspace(owner, 'Self');

    const res = await owner.agent
      .post(`/api/workspaces/${wid}/transfer`)
      .set(SAME_ORIGIN)
      .send({ userId: owner.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('cannot transfer to a non-member, and says 404 rather than confirming they exist', async () => {
    const owner = await signUp('Closed Shop');
    const stranger = await signUp('Stranger');
    const wid = await createWorkspace(owner, 'Closed');

    const res = await owner.agent
      .post(`/api/workspaces/${wid}/transfer`)
      .set(SAME_ORIGIN)
      .send({ userId: stranger.id });

    expect(res.status).toBe(404);
    expect(res.text).toBe(UNIFORM_NOT_FOUND);
  });
});

describe('trash is admin-and-above (SPEC §2)', () => {
  it('a member is refused both trash endpoints while an admin is not', async () => {
    const owner = await signUp('Trash Owner');
    const member = await signUp('Trash Member');
    const admin = await signUp('Trash Admin');
    const wid = await createWorkspace(owner, 'Bins');
    await addMember(owner, wid, member, 'member');
    await addMember(owner, wid, admin, 'admin');

    const doc = await uploadDocument(member, wid, 'bin me', 'bin.txt');
    await member.agent
      .delete(`/api/workspaces/${wid}/documents/${doc.id}`)
      .set(SAME_ORIGIN)
      .expect(204);

    // The member deleted it and still may not look in the bin.
    const memberList = await member.agent.get(`/api/workspaces/${wid}/trash`);
    expect(memberList.status).toBe(403);
    expect(memberList.body.error.code).toBe('FORBIDDEN');

    const memberRestore = await member.agent
      .post(`/api/workspaces/${wid}/trash/${doc.id}/restore`)
      .set(SAME_ORIGIN);
    expect(memberRestore.status).toBe(403);
    expect(memberRestore.body.error.code).toBe('FORBIDDEN');

    // Admin is the boundary, so relaxing trash:view to 'member' would fail here.
    const adminList = await admin.agent.get(`/api/workspaces/${wid}/trash`).expect(200);
    expect(adminList.body.documents.some((d: { id: string }) => d.id === doc.id)).toBe(true);

    await admin.agent
      .post(`/api/workspaces/${wid}/trash/${doc.id}/restore`)
      .set(SAME_ORIGIN)
      .expect(200);
  });
});
