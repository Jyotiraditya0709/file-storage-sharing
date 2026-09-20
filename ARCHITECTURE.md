# ARCHITECTURE

## Stack and why

| Layer | Choice | Why (and the alternative we rejected) |
|---|---|---|
| Language | TypeScript, Node 22 | Brief prefers it; JD prefers it. |
| API | **Express 5** | The framework I run in production, so every line is explainable in the walkthrough. Express 5 awaits async handlers and forwards rejections to the error middleware, so no wrapper library. Auth and CSRF are middleware, not handler code; uploads stream through `busboy` with a per-request size limit. Next.js route handlers were rejected: no body-size control and `formData()` buffers files in memory. Fastify was considered (`inject()` testing, plugin encapsulation) and rejected only because I'd be learning it under a deadline instead of defending it. |
| DB access | **Drizzle ORM + Drizzle Kit** | Migrations are plain `.sql` files a reviewer can read; schema is TypeScript; no generated client or shadow DB. |
| Storage | `StorageProvider` interface → `S3StorageProvider` (MinIO via `@aws-sdk/client-s3` + `lib-storage`) and `LocalDiskStorageProvider` | The brief asks for a swappable abstraction; two implementations plus one contract test suite proves it. |
| Auth | Hand-rolled DB sessions (~150 lines, following the post-Lucia guidance) + argon2id | Least magic to defend in a walkthrough; revocation and "member removed" semantics need server state anyway, so JWT buys nothing. |
| UI | React + Vite, built to static files and served by the same Express process (`express.static`) | One app container; Vite dev proxy in development. Functional over pretty: plain components, no design system. |
| Tests | Vitest + Testcontainers (Postgres, MinIO) via `globalSetup`, `supertest` against the app instance (no port) | Real DB and real object store; no mocks for the parts that matter. |
| Run | `docker compose up`: `postgres`, `minio`, `minio-init` (creates private bucket), `migrate` (one-shot), `app` | Under 5 minutes from clone; migrations run before the app starts. |

## Layering (the rule the reviewers check)

```
web/                      React + Vite (static in prod)
server/src/
  app.ts                  buildApp() returns the Express app (used by tests); server.ts listens
  config.ts               zod-validated env
  middleware/
    auth.ts               session cookie → req.user; requireUser guard
    csrf.ts               Sec-Fetch-Site check on mutating methods
    rateLimit.ts          express-rate-limit on /api/auth/login and /signup
    errors.ts             AppError → HTTP mapping; uniform error body (last middleware)
  routes/                 parse + validate (zod) → call service → map result. NO business rules here.
    auth.routes.ts  workspaces.routes.ts  members.routes.ts  invitations.routes.ts
    documents.routes.ts  links.routes.ts  public.routes.ts (/s/:token)
  services/               all authorization + orchestration lives here
    authz.ts              can(user, action, resource) — the single place permissions are decided
    auth.service.ts  workspace.service.ts  membership.service.ts  invitation.service.ts
    document.service.ts  link.service.ts  purge.service.ts
  storage/
    StorageProvider.ts    interface: put(key, stream, meta) / getStream(key) / delete(key) / exists(key)
    s3.provider.ts  local.provider.ts  index.ts (factory from config)
  db/
    schema.ts             Drizzle schema
    client.ts             pool + drizzle instance
    repositories/         thin query modules; every query that touches workspace data takes workspaceId
  lib/
    tokens.ts             randomToken(), hashToken() — crypto.randomBytes(32) base64url, sha256
    password.ts           argon2id hash/verify with OWASP params
    files.ts              sanitiseFilename(), sniffMime()
drizzle/                  generated .sql migrations (committed, copied into image)
tests/
  authz.test.ts  links.test.ts  invitations.test.ts  documents.test.ts  storage.contract.test.ts
```

Rules: routes never import `db/` or `storage/`; services never read `req`/`res`; `authz.can()` is called at the top of every service method that touches workspace data; repositories never accept a resource ID without the workspace ID that scopes it.

## Data model

```sql
create extension if not exists citext;

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  id text primary key,                    -- public id in cookie
  user_id uuid not null references users(id) on delete cascade,
  secret_hash bytea not null,             -- sha256(secret); cookie carries id.secret
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on sessions(user_id);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create type workspace_role as enum ('owner','admin','member','viewer');

create table memberships (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role workspace_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on memberships(user_id);
create unique index one_owner_per_workspace on memberships(workspace_id) where role = 'owner';

create type invitation_status as enum ('pending','accepted','revoked','expired');

create table invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email citext not null,
  role workspace_role not null check (role <> 'owner'),
  token_hash bytea not null unique,
  invited_by uuid not null references users(id),
  status invitation_status not null default 'pending',
  expires_at timestamptz not null,
  accepted_by uuid references users(id),
  created_at timestamptz not null default now()
);
create unique index one_pending_invite on invitations(workspace_id, email) where status = 'pending';

create table documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete restrict,
  uploaded_by uuid references users(id) on delete set null,
  name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 bytea not null,
  storage_key text not null unique,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index documents_live on documents(workspace_id, created_at desc, id) where deleted_at is null;
create index documents_trash on documents(workspace_id, deleted_at) where deleted_at is not null;

create table share_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  token_hash bytea not null unique,
  password_hash text,                     -- improvement
  expires_at timestamptz,
  max_downloads int check (max_downloads > 0),
  download_count int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on share_links(document_id);
```

Why these choices: `on delete restrict` on documents → workspaces forces workspace deletion through the service (soft delete, then purge), never a silent cascade that orphans objects. `on delete cascade` on share_links → documents is safe because a document row is only hard-deleted by purge after its object is gone. Partial unique indexes encode "one owner" and "one pending invite" in the database, not just in code. Cursor index `(workspace_id, created_at desc, id)` matches the list query exactly.

## API

Uniform error body: `{ "error": { "code": "NOT_FOUND", "message": "…" } }`. Any resource in a workspace the caller is not a member of is 404. A member acting beyond their role inside a workspace they can see is 403 `FORBIDDEN`. Share-link and invitation token failures are always 404.

```
POST   /api/auth/signup            {email, displayName, password}
POST   /api/auth/login             {email, password}
POST   /api/auth/logout
GET    /api/auth/me

GET    /api/workspaces
POST   /api/workspaces             {name}
GET    /api/workspaces/:wid
PATCH  /api/workspaces/:wid        {name}
DELETE /api/workspaces/:wid        owner only → soft delete
POST   /api/workspaces/:wid/transfer  {userId}

GET    /api/workspaces/:wid/members
PATCH  /api/workspaces/:wid/members/:uid   {role}
DELETE /api/workspaces/:wid/members/:uid

GET    /api/workspaces/:wid/invitations
POST   /api/workspaces/:wid/invitations    {email, role} → {inviteUrl}   (shown once)
DELETE /api/workspaces/:wid/invitations/:iid
GET    /api/invitations/:token             preview (workspace name, role, email hint)
POST   /api/invitations/:token/accept

GET    /api/workspaces/:wid/documents?cursor=   paginated, live only
POST   /api/workspaces/:wid/documents           multipart, field "file"
GET    /api/workspaces/:wid/documents/:did
GET    /api/workspaces/:wid/documents/:did/download   proxied stream
PATCH  /api/workspaces/:wid/documents/:did     {name}
DELETE /api/workspaces/:wid/documents/:did     soft delete
GET    /api/workspaces/:wid/trash
POST   /api/workspaces/:wid/trash/:did/restore

GET    /api/workspaces/:wid/documents/:did/links
POST   /api/workspaces/:wid/documents/:did/links   {expiresAt?, maxDownloads?, password?} → {url}  (shown once)
DELETE /api/workspaces/:wid/links/:lid            revoke

GET    /api/s/:token                 public metadata (404 if invalid/expired/revoked/exhausted/deleted)
POST   /api/s/:token/unlock          {password} → sets short-lived signed cookie for this link
GET    /api/s/:token/download        proxied stream; increments count atomically
```

Note that document and link routes are nested under the workspace. The workspace ID in the path is not trusted; the service loads the document and checks `document.workspaceId === wid` *and* the caller's membership. Two mismatched IDs → 404.

## Key flows

**Upload.** Route validates membership via service → `busboy` file stream (limit from config; on `limit` event abort the storage upload and respond 413) → `sniffMime()` peeks the first 4100 bytes → `documentId` generated → `storage.put(key, stream)` while hashing → on success insert row; on insert failure delete the object. The client's `Content-Type` is ignored.

**Download (member).** `authz.can(user, 'document:read', doc)` → `storage.getStream(key)` piped to reply with `attachment`, `nosniff`, `Content-Length`.

**Download (share link).** Hash the token → load link + document → check `revoked_at`, `expires_at`, `max_downloads`, `document.deleted_at`, `workspace.deleted_at` → if `password_hash`, require the unlock cookie → `UPDATE share_links SET download_count = download_count + 1 WHERE id = $1 AND (max_downloads IS NULL OR download_count < max_downloads) RETURNING id` (atomic; zero rows → 404) → stream.

**Why proxy instead of presigned URLs.** Inside docker-compose the API reaches MinIO at `minio:9000`, but a presigned URL is signed over that `Host`, so the browser can neither resolve it nor rewrite it (SigV4 → `SignatureDoesNotMatch`). The clean fixes are a second S3 client configured with a public endpoint purely for signing, or proxying through the API. We proxy: every byte passes the authorization check, the bucket stays private and unreachable from the browser, and share-link rules (expiry, count, password) are enforced on the download itself. Cost: API bandwidth. In production at scale we would presign with a public endpoint and short TTLs for member downloads and keep proxying for share links. Documented in the README as a trade-off.

**Sessions.** Cookie value `id.secret`. Lookup by `id`, compare `sha256(secret)` to `secret_hash` with `timingSafeEqual`. Expired → delete row, treat as anonymous. Membership is checked per request, so removing a member takes effect immediately without touching sessions.

## Security controls (map to the rubric)

- **Cross-user access:** every service method calls `authz.can()`; repositories are workspace-scoped; 404 on any miss. Tested by `authz.test.ts`.
- **Guessable links:** 256-bit CSPRNG tokens, hashed at rest, constant-time lookup by hash, uniform 404. Tested by `links.test.ts`.
- **Storage exposed:** bucket private (`mc anonymous set none`), MinIO ports not published to the host in the default compose (console optional behind a profile), non-default credentials from `.env`, storage keys app-generated, no client-supplied paths, all bytes proxied.
- **Uploads:** size limit, MIME sniffing, filename sanitisation, `attachment` + `nosniff` on every download.
- **Sessions/CSRF:** HttpOnly + SameSite=Lax cookies, `Sec-Fetch-Site` check, login rate limit, argon2id.
- **Knowingly left:** no email verification, no 2FA, in-process rate limiting, no virus scanning, no audit log, no per-workspace quotas.

## Tests aimed at what would embarrass us

1. Member of workspace A cannot list, get, download, rename, delete a document of workspace B by ID (each returns 404), including with A's workspace ID in the path.
2. Viewer cannot upload, create links, or invite; member cannot delete another member's document; admin cannot remove the owner.
3. Share link: unknown token, revoked, expired, exhausted, wrong password, and document-deleted all return 404 with identical bodies; a valid one downloads and increments exactly once under 10 concurrent requests with `max_downloads = 5`.
4. Invitation: wrong email cannot accept; cannot accept twice; expired cannot accept; accepting creates membership with the invited role.
5. Storage contract: `put` → `exists` → `getStream` bytes equal → `delete` → `exists` false, run against both providers.
6. Upload: oversize → 413 and no row/object left behind; client `Content-Type` ignored.

## docker-compose shape

```yaml
services:
  postgres:   image: postgres:16        healthcheck: pg_isready
  minio:      image: minio/minio:<pinned tag>   command: server /data   env from .env   (no host ports by default)
  minio-init: image: minio/mc   depends_on minio healthy
              entrypoint: mc alias set local http://minio:9000 $U $P && mc mb --ignore-existing local/$BUCKET && mc anonymous set none local/$BUCKET
  migrate:    build: .   command: npx drizzle-kit migrate   depends_on postgres healthy
  app:        build: .   ports: 3000:3000   depends_on: migrate completed, minio-init completed
```

`.env.example` carries every variable with a safe default except credentials, which are placeholders that `docker compose` refuses to start without.
