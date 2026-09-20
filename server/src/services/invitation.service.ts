import { config } from '../config.js';
import { db } from '../db/client.js';
import { isUniqueViolation } from '../db/pg-errors.js';
import * as invitationsRepo from '../db/repositories/invitations.repo.js';
import * as membershipsRepo from '../db/repositories/memberships.repo.js';
import type { Role } from '../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { hashToken, randomToken } from '../lib/tokens.js';
import type { AuthUser } from './auth.service.js';
import { can } from './authz.js';
import { requireMembership } from './membership.service.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InvitationDto {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  createdAt: Date;
}

export interface InvitationPreview {
  workspaceName: string;
  role: Role;
  /**
   * The full invited address, not a masked hint: SPEC §6 requires the signup
   * form to be prefilled with it, and the token holder is the intended
   * recipient anyway.
   */
  email: string;
}

function toDto(row: invitationsRepo.InvitationRow): InvitationDto {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export async function create(
  user: AuthUser,
  workspaceId: string,
  input: { email: string; role: Role },
): Promise<{ invitation: InvitationDto; inviteUrl: string }> {
  const { role } = await requireMembership(user.id, workspaceId);

  // newRole makes can() enforce "role <= own role" and "never owner".
  if (!can({ userId: user.id, role }, 'member:invite', { newRole: input.role })) {
    throw new ForbiddenError();
  }

  const token = randomToken(32);

  try {
    const row = await invitationsRepo.insert({
      workspaceId,
      email: input.email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedBy: user.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    });

    // Shown once. Only the hash is stored, so this cannot be recovered later.
    return { invitation: toDto(row), inviteUrl: `${config.appUrl}/invite/${token}` };
  } catch (err) {
    if (isUniqueViolation(err, 'one_pending_invite')) {
      throw new ConflictError('An invitation for this email is already pending');
    }
    throw err;
  }
}

export async function listPending(user: AuthUser, workspaceId: string): Promise<InvitationDto[]> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'member:invite')) throw new ForbiddenError();

  return (await invitationsRepo.listPending(workspaceId)).map(toDto);
}

export async function revoke(
  user: AuthUser,
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'member:invite')) throw new ForbiddenError();

  const invitation = await invitationsRepo.findById(workspaceId, invitationId);
  if (!invitation || invitation.status !== 'pending') throw new NotFoundError();

  await invitationsRepo.setStatus(workspaceId, invitationId, 'revoked');
}

/**
 * Every failure here is the same 404: unknown token, revoked, already
 * accepted, expired, or a workspace that has since been deleted.
 */
async function loadUsable(token: string) {
  const found = await invitationsRepo.findByTokenHash(hashToken(token));
  if (!found) throw new NotFoundError();

  const { invitation, workspace } = found;
  if (workspace.deletedAt) throw new NotFoundError();
  if (invitation.status !== 'pending') throw new NotFoundError();
  if (invitation.expiresAt.getTime() <= Date.now()) throw new NotFoundError();

  return { invitation, workspace };
}

export async function preview(token: string): Promise<InvitationPreview> {
  const { invitation, workspace } = await loadUsable(token);
  return { workspaceName: workspace.name, role: invitation.role, email: invitation.email };
}

export async function accept(
  user: AuthUser,
  token: string,
): Promise<{ workspaceId: string; role: Role }> {
  const { invitation } = await loadUsable(token);

  // The invitation is bound to an address, not to whoever holds the link.
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new NotFoundError();
  }

  const existingRole = await membershipsRepo.findRole(invitation.workspaceId, user.id);
  if (existingRole) {
    // Already a member: consume the invitation, leave the role alone, no error.
    await invitationsRepo.markAccepted(invitation.workspaceId, invitation.id, user.id);
    return { workspaceId: invitation.workspaceId, role: existingRole };
  }

  try {
    await db.transaction(async (tx) => {
      await membershipsRepo.insert(
        { workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role },
        tx,
      );
      await invitationsRepo.markAccepted(invitation.workspaceId, invitation.id, user.id, tx);
    });
  } catch (err) {
    // Two simultaneous accepts both clear the membership check above; the
    // loser hits the memberships primary key. That is the already-a-member
    // case, which SPEC §6 says is a success, not an error.
    if (!isUniqueViolation(err)) throw err;

    const role = await membershipsRepo.findRole(invitation.workspaceId, user.id);
    return { workspaceId: invitation.workspaceId, role: role ?? invitation.role };
  }

  return { workspaceId: invitation.workspaceId, role: invitation.role };
}
