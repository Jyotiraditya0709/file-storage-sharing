import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { buildApp } from '../src/app.js';
import type { Role } from '../src/db/schema.js';

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

export async function createWorkspace(owner: TestUser, name = 'Workspace'): Promise<string> {
  const res = await owner.agent.post('/api/workspaces').set(SAME_ORIGIN).send({ name });
  if (res.status !== 201) {
    throw new Error(`createWorkspace failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.workspace.id;
}

/**
 * Invitation is the only path to membership, so seeding a role exercises the
 * real flow rather than writing a row behind the API's back.
 */
export async function addMember(
  inviter: TestUser,
  workspaceId: string,
  invitee: TestUser,
  role: Exclude<Role, 'owner'>,
): Promise<void> {
  const invite = await inviter.agent
    .post(`/api/workspaces/${workspaceId}/invitations`)
    .set(SAME_ORIGIN)
    .send({ email: invitee.email, role });

  if (invite.status !== 201) {
    throw new Error(`invite failed: ${invite.status} ${JSON.stringify(invite.body)}`);
  }

  const token = String(invite.body.inviteUrl).split('/invite/')[1];
  const accepted = await invitee.agent.post(`/api/invitations/${token}/accept`).set(SAME_ORIGIN);

  if (accepted.status !== 200) {
    throw new Error(`accept failed: ${accepted.status} ${JSON.stringify(accepted.body)}`);
  }
}

export interface UploadedDoc {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export async function uploadDocument(
  user: TestUser,
  workspaceId: string,
  content: Buffer | string = 'hello world',
  filename = 'note.txt',
  contentType?: string,
): Promise<UploadedDoc> {
  const body = typeof content === 'string' ? Buffer.from(content) : content;
  const attachOptions = contentType ? { filename, contentType } : { filename };

  const res = await user.agent
    .post(`/api/workspaces/${workspaceId}/documents`)
    .set(SAME_ORIGIN)
    .attach('file', body, attachOptions);

  if (res.status !== 201) {
    throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.document;
}

/** Creates a share link and returns both the bare token and the link id. */
export async function createShareLink(
  user: TestUser,
  workspaceId: string,
  documentId: string,
  options: { expiresAt?: string; maxDownloads?: number; password?: string } = {},
): Promise<{ token: string; linkId: string }> {
  const res = await user.agent
    .post(`/api/workspaces/${workspaceId}/documents/${documentId}/links`)
    .set(SAME_ORIGIN)
    .send(options);

  if (res.status !== 201) {
    throw new Error(`createShareLink failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: String(res.body.url).split('/s/')[1]!, linkId: res.body.link.id };
}

/** The one body every "does not exist, as far as you are concerned" reply has. */
export const UNIFORM_NOT_FOUND = JSON.stringify({
  error: { code: 'NOT_FOUND', message: 'Not found' },
});
