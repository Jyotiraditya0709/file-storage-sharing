import * as membershipsRepo from '../db/repositories/memberships.repo.js';
import type { MembershipContext, MemberRow } from '../db/repositories/memberships.repo.js';
import type { Role } from '../db/schema.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import type { AuthUser } from './auth.service.js';
import { can } from './authz.js';

/**
 * Opens every workspace-scoped service method.
 *
 * No membership, unknown workspace, or a soft-deleted one are all the same
 * 404: an outsider must never be able to tell them apart. A member whose role
 * is too low gets a 403 afterwards, from can().
 */
export async function requireMembership(
  userId: string,
  workspaceId: string,
): Promise<MembershipContext> {
  const context = await membershipsRepo.findMembership(workspaceId, userId);
  if (!context) throw new NotFoundError();
  return context;
}

export async function list(user: AuthUser, workspaceId: string): Promise<MemberRow[]> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'member:list')) throw new ForbiddenError();

  return membershipsRepo.listMembers(workspaceId);
}

export async function updateRole(
  user: AuthUser,
  workspaceId: string,
  targetUserId: string,
  newRole: Role,
): Promise<void> {
  const { role } = await requireMembership(user.id, workspaceId);

  const targetRole = await membershipsRepo.findRole(workspaceId, targetUserId);
  if (!targetRole) throw new NotFoundError();

  if (!can({ userId: user.id, role }, 'member:update', { targetRole, newRole })) {
    throw new ForbiddenError();
  }

  await membershipsRepo.updateRole(workspaceId, targetUserId, newRole);
}

export async function remove(
  user: AuthUser,
  workspaceId: string,
  targetUserId: string,
): Promise<void> {
  const { role } = await requireMembership(user.id, workspaceId);

  const targetRole = await membershipsRepo.findRole(workspaceId, targetUserId);
  if (!targetRole) throw new NotFoundError();

  if (!can({ userId: user.id, role }, 'member:remove', { targetRole })) {
    throw new ForbiddenError();
  }

  // Share links this member created survive: they belong to the document.
  await membershipsRepo.remove(workspaceId, targetUserId);
}
