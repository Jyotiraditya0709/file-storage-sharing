import { db } from '../db/client.js';
import * as membershipsRepo from '../db/repositories/memberships.repo.js';
import * as workspacesRepo from '../db/repositories/workspaces.repo.js';
import type { Role } from '../db/schema.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import type { AuthUser } from './auth.service.js';
import { type WorkspaceCapabilities, can, capabilitiesFor } from './authz.js';
import { requireMembership } from './membership.service.js';

export interface WorkspaceDto {
  id: string;
  name: string;
  role: Role;
  createdAt: Date;
  /** What this caller may do here. The UI renders from these; the server still enforces. */
  capabilities: WorkspaceCapabilities;
}

function toDto(
  workspace: { id: string; name: string; createdAt: Date },
  userId: string,
  role: Role,
): WorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name,
    role,
    createdAt: workspace.createdAt,
    capabilities: capabilitiesFor({ userId, role }),
  };
}

export async function create(user: AuthUser, name: string): Promise<WorkspaceDto> {
  // The creator is the owner, and the pair is written atomically so a
  // workspace can never exist without one.
  return db.transaction(async (tx) => {
    const workspace = await workspacesRepo.insert({ name, createdBy: user.id }, tx);
    await membershipsRepo.insert({ workspaceId: workspace.id, userId: user.id, role: 'owner' }, tx);
    return toDto(workspace, user.id, 'owner');
  });
}

export async function listForUser(user: AuthUser): Promise<WorkspaceDto[]> {
  const rows = await workspacesRepo.listForUser(user.id);
  return rows.map(({ workspace, role }) => toDto(workspace, user.id, role));
}

export async function get(user: AuthUser, workspaceId: string): Promise<WorkspaceDto> {
  const { role, workspace } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'workspace:view')) throw new ForbiddenError();

  return toDto(workspace, user.id, role);
}

export async function rename(
  user: AuthUser,
  workspaceId: string,
  name: string,
): Promise<WorkspaceDto> {
  const { role, workspace } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'workspace:rename')) throw new ForbiddenError();

  await workspacesRepo.updateName(workspaceId, name);
  return toDto({ ...workspace, name }, user.id, role);
}

export async function softDelete(user: AuthUser, workspaceId: string): Promise<void> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'workspace:delete')) throw new ForbiddenError();

  // Soft delete only. Documents keep their rows and objects; every query
  // filters on the workspace being live, and purge cleans up after 30 days.
  await workspacesRepo.softDelete(workspaceId, new Date());
}

export async function transferOwnership(
  user: AuthUser,
  workspaceId: string,
  targetUserId: string,
): Promise<void> {
  const { role } = await requireMembership(user.id, workspaceId);
  if (!can({ userId: user.id, role }, 'workspace:transfer')) throw new ForbiddenError();

  if (targetUserId === user.id) return;

  const targetRole = await membershipsRepo.findRole(workspaceId, targetUserId);
  if (!targetRole) throw new NotFoundError();

  // Demote first, then promote: one_owner_per_workspace is a plain unique
  // index, checked per statement, so the reverse order would collide.
  await db.transaction(async (tx) => {
    await membershipsRepo.updateRole(workspaceId, user.id, 'admin', tx);
    await membershipsRepo.updateRole(workspaceId, targetUserId, 'owner', tx);
  });
}
