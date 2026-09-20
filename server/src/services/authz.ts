import type { Role } from '../db/schema.js';

export type { Role };

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export type Action =
  | 'workspace:view'
  | 'workspace:rename'
  | 'workspace:delete'
  | 'workspace:transfer'
  | 'member:list'
  | 'member:invite'
  | 'member:update'
  | 'member:remove'
  | 'document:read'
  | 'document:create'
  | 'document:rename'
  | 'document:delete'
  | 'trash:view'
  | 'trash:restore'
  | 'link:list'
  | 'link:create'
  | 'link:revoke';

interface Rule {
  /** Role needed to perform the action on anything in the workspace. */
  min: Role;
  /** Lower bar when the resource belongs to the actor ("own upload"). */
  ownMin?: Role;
  /** The action targets another member, so the target's role constrains it. */
  targetGuard?: boolean;
}

/**
 * The SPEC §2 role table, transcribed. This is the only place a permission is
 * decided; services ask, routes never do.
 *
 *  | Action                        | owner | admin | member   | viewer |
 *  | View documents, download      |   x   |   x   |    x     |   x    |
 *  | Upload document               |   x   |   x   |    x     |   -    |
 *  | Rename / delete own upload    |   x   |   x   |    x     |   -    |
 *  | Rename / delete any document  |   x   |   x   |    -     |   -    |
 *  | Create share link             |   x   |   x   |    x     |   -    |
 *  | Revoke any share link         |   x   |   x   | own only |   -    |
 *  | View trash, restore           |   x   |   x   |    -     |   -    |
 *  | Invite members (role <= own)  |   x   |   x   |    -     |   -    |
 *  | Change roles, remove members  |   x   |  x*   |    -     |   -    |
 *  | Rename workspace              |   x   |   x   |    -     |   -    |
 *  | Delete workspace, transfer    |   x   |   -   |    -     |   -    |
 *
 *  * admins may not act on the owner or on other admins.
 */
const RULES: Record<Action, Rule> = {
  'workspace:view': { min: 'viewer' },
  'workspace:rename': { min: 'admin' },
  'workspace:delete': { min: 'owner' },
  'workspace:transfer': { min: 'owner' },

  'member:list': { min: 'viewer' },
  'member:invite': { min: 'admin' },
  'member:update': { min: 'admin', targetGuard: true },
  'member:remove': { min: 'admin', targetGuard: true },

  'document:read': { min: 'viewer' },
  'document:create': { min: 'member' },
  'document:rename': { min: 'admin', ownMin: 'member' },
  'document:delete': { min: 'admin', ownMin: 'member' },

  'trash:view': { min: 'admin' },
  'trash:restore': { min: 'admin' },

  'link:list': { min: 'member' },
  'link:create': { min: 'member' },
  'link:revoke': { min: 'admin', ownMin: 'member' },
};

export interface Subject {
  userId: string;
  role: Role;
}

export interface Resource {
  /** Who created the document or link, for the "own" rules. */
  ownerId?: string | null;
  /** Current role of the member being acted on. */
  targetRole?: Role;
  /** Role being granted, when inviting or changing a role. */
  newRole?: Role;
}

export function can(subject: Subject, action: Action, resource: Resource = {}): boolean {
  const rule = RULES[action];

  if (rule.targetGuard && resource.targetRole) {
    // The owner is untouchable except through an explicit transfer, and an
    // admin may not act on a peer admin.
    if (resource.targetRole === 'owner') return false;
    if (subject.role === 'admin' && resource.targetRole === 'admin') return false;
  }

  if (resource.newRole) {
    // Ownership only moves by transfer, and nobody grants above their own role.
    if (resource.newRole === 'owner') return false;
    if (RANK[resource.newRole] > RANK[subject.role]) return false;
  }

  if (RANK[subject.role] >= RANK[rule.min]) return true;

  if (rule.ownMin && resource.ownerId != null && resource.ownerId === subject.userId) {
    return RANK[subject.role] >= RANK[rule.ownMin];
  }

  return false;
}

/**
 * What the current member may do in this workspace, as booleans.
 *
 * The API hands this to the UI so the browser renders actions without owning
 * any authorization logic of its own: there is no role table in the client to
 * drift out of step with this file. The server still enforces every one of
 * these independently on the actual request — these flags decide what is
 * rendered, never what is allowed.
 */
export interface WorkspaceCapabilities {
  canUpload: boolean;
  canInvite: boolean;
  canManageMembers: boolean;
  canSeeTrash: boolean;
  canRename: boolean;
  canDelete: boolean;
}

export function capabilitiesFor(subject: Subject): WorkspaceCapabilities {
  return {
    canUpload: can(subject, 'document:create'),
    canInvite: can(subject, 'member:invite'),
    canManageMembers: can(subject, 'member:update'),
    canSeeTrash: can(subject, 'trash:view'),
    canRename: can(subject, 'workspace:rename'),
    canDelete: can(subject, 'workspace:delete'),
  };
}
