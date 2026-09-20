/**
 * The one place the browser talks to the server.
 *
 * Note what is deliberately absent: any notion of what a role may do. The
 * server sends `capabilities` on the workspace and `canEdit`/`canShare`/
 * `canRevoke` on rows, and the UI renders from those. There is no permission
 * logic in this client to drift out of step with services/authz.ts.
 */

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

let onUnauthorized: (() => void) | null = null;

/** Wired by AuthProvider so a 401 anywhere sends the user to the login page. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  body?: unknown;
  /** Multipart upload: passed straight through, no Content-Type set. */
  form?: FormData;
  /** /api/auth/me opts out, so public pages can stay anonymous. */
  skipUnauthorizedRedirect?: boolean;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.form) {
    // Let the browser set the multipart boundary.
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  // Sec-Fetch-Site is deliberately NOT set here. It is a forbidden header
  // name: script cannot set it, and the browser attaches `same-origin` to our
  // own requests by itself. That is exactly what the CSRF middleware wants,
  // and it is why a cross-site page cannot forge it either.
  const response = await fetch(path, {
    method,
    headers,
    // null, not undefined: exactOptionalPropertyTypes distinguishes them.
    body: body ?? null,
    credentials: 'same-origin',
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text.length > 0 ? safeJson(text) : undefined;

  if (!response.ok) {
    const { code, message } = errorFrom(parsed, response.status);

    if (response.status === 401 && !options.skipUnauthorizedRedirect) {
      onUnauthorized?.();
    }
    throw new AppError(response.status, code, message);
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Maps the server's uniform { error: { code, message } } body. */
function errorFrom(parsed: unknown, status: number): { code: string; message: string } {
  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    const error = (parsed as { error: unknown }).error;
    if (error && typeof error === 'object') {
      const { code, message } = error as { code?: unknown; message?: unknown };
      if (typeof code === 'string' && typeof message === 'string') return { code, message };
    }
  }
  return { code: 'INTERNAL', message: `Request failed (${status})` };
}

// --- types mirroring the API responses ---------------------------------------

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface Capabilities {
  canUpload: boolean;
  canInvite: boolean;
  canManageMembers: boolean;
  canSeeTrash: boolean;
  canRename: boolean;
  canDelete: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
  capabilities: Capabilities;
}

export interface Doc {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  deletedAt: string | null;
  uploadedBy: { id: string | null; displayName: string | null };
  canEdit: boolean;
  canShare: boolean;
}

export interface Member {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
}

export interface ShareLink {
  id: string;
  tokenTail: string;
  createdBy: { id: string | null; displayName: string | null };
  hasPassword: boolean;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  revokedAt: string | null;
  createdAt: string;
  canRevoke: boolean;
}

export interface PublicLinkView {
  requiresPassword: boolean;
  document?: {
    name: string;
    sizeBytes: number;
    mimeType: string;
    uploadedBy: string | null;
  };
}

export interface InvitationPreview {
  workspaceName: string;
  role: Role;
  email: string;
}

// --- calls -------------------------------------------------------------------

export const api = {
  signup: (input: { email: string; displayName: string; password: string }) =>
    request<{ user: User }>('POST', '/api/auth/signup', { body: input }),

  login: (input: { email: string; password: string }) =>
    request<{ user: User }>('POST', '/api/auth/login', { body: input }),

  logout: () => request<void>('POST', '/api/auth/logout'),

  me: () =>
    request<{ user: User }>('GET', '/api/auth/me', { skipUnauthorizedRedirect: true }),

  listWorkspaces: () => request<{ workspaces: Workspace[] }>('GET', '/api/workspaces'),

  createWorkspace: (name: string) =>
    request<{ workspace: Workspace }>('POST', '/api/workspaces', { body: { name } }),

  getWorkspace: (wid: string) =>
    request<{ workspace: Workspace }>('GET', `/api/workspaces/${wid}`),

  renameWorkspace: (wid: string, name: string) =>
    request<{ workspace: Workspace }>('PATCH', `/api/workspaces/${wid}`, { body: { name } }),

  deleteWorkspace: (wid: string) => request<void>('DELETE', `/api/workspaces/${wid}`),

  listDocuments: (wid: string, cursor?: string) =>
    request<{ documents: Doc[]; nextCursor: string | null }>(
      'GET',
      `/api/workspaces/${wid}/documents${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  uploadDocument: (wid: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ document: Doc }>('POST', `/api/workspaces/${wid}/documents`, { form });
  },

  renameDocument: (wid: string, did: string, name: string) =>
    request<{ document: Doc }>('PATCH', `/api/workspaces/${wid}/documents/${did}`, {
      body: { name },
    }),

  deleteDocument: (wid: string, did: string) =>
    request<void>('DELETE', `/api/workspaces/${wid}/documents/${did}`),

  listTrash: (wid: string) =>
    request<{ documents: Doc[] }>('GET', `/api/workspaces/${wid}/trash`),

  restoreDocument: (wid: string, did: string) =>
    request<{ document: Doc }>('POST', `/api/workspaces/${wid}/trash/${did}/restore`),

  listMembers: (wid: string) => request<{ members: Member[] }>('GET', `/api/workspaces/${wid}/members`),

  updateMemberRole: (wid: string, uid: string, role: Role) =>
    request<void>('PATCH', `/api/workspaces/${wid}/members/${uid}`, { body: { role } }),

  removeMember: (wid: string, uid: string) =>
    request<void>('DELETE', `/api/workspaces/${wid}/members/${uid}`),

  listInvitations: (wid: string) =>
    request<{ invitations: Invitation[] }>('GET', `/api/workspaces/${wid}/invitations`),

  createInvitation: (wid: string, input: { email: string; role: Role }) =>
    request<{ invitation: Invitation; inviteUrl: string }>(
      'POST',
      `/api/workspaces/${wid}/invitations`,
      { body: input },
    ),

  revokeInvitation: (wid: string, iid: string) =>
    request<void>('DELETE', `/api/workspaces/${wid}/invitations/${iid}`),

  previewInvitation: (token: string) =>
    request<{ invitation: InvitationPreview }>('GET', `/api/invitations/${token}`),

  acceptInvitation: (token: string) =>
    request<{ workspaceId: string; role: Role }>('POST', `/api/invitations/${token}/accept`),

  listLinks: (wid: string, did: string) =>
    request<{ links: ShareLink[] }>('GET', `/api/workspaces/${wid}/documents/${did}/links`),

  createLink: (
    wid: string,
    did: string,
    input: { expiresAt?: string; maxDownloads?: number; password?: string },
  ) =>
    request<{ link: ShareLink; url: string }>(
      'POST',
      `/api/workspaces/${wid}/documents/${did}/links`,
      { body: input },
    ),

  revokeLink: (wid: string, lid: string) =>
    request<void>('DELETE', `/api/workspaces/${wid}/links/${lid}`),

  publicLink: (token: string) => request<PublicLinkView>('GET', `/api/s/${token}`),

  unlockLink: (token: string, password: string) =>
    request<void>('POST', `/api/s/${token}/unlock`, { body: { password } }),
};

/** Downloads go through the browser, never fetch: the server sends attachment. */
export function documentDownloadUrl(wid: string, did: string): string {
  return `/api/workspaces/${wid}/documents/${did}/download`;
}

export function shareDownloadUrl(token: string): string {
  return `/api/s/${token}/download`;
}
