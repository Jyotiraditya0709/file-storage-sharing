# File Storage & Sharing

A small full-stack app for a team to keep documents in workspaces, invite colleagues, and share single documents externally by link. Built for the BLKBOX.ai take-home.

## Run it

```bash
git clone <repo> && cd <repo>
cp .env.example .env          # set MINIO_ROOT_USER / MINIO_ROOT_PASSWORD / SESSION_SECRET
docker compose up --build     # postgres → minio → bucket init → migrations → app on http://localhost:3000
```

First run takes ~2–3 minutes (image build). Then: sign up, create a workspace, upload, share.

Tests: `pnpm install && pnpm test` (needs Docker; spins up Postgres + MinIO via Testcontainers).

## Architecture in one screen

<!-- Stack table, the layering diagram, and the request path for upload / download / share-link download. Copy from ARCHITECTURE.md, condensed. -->

## Assumptions and decisions

<!-- THE most important section. One paragraph per gap in the brief: what we chose, why, and what we rejected. Order: -->
- What a share link can do
- Roles inside a workspace, and why four
- Documents belong to the workspace, not the uploader
- Deletion: soft delete, trash, purge, and what happens to links
- Invitations for people without an account; email binding; no email provider
- Removing a member: access ends on next request; their documents and links stay
- 404 instead of 403 everywhere
- Proxied downloads instead of presigned URLs (and when we'd flip that)
- Session cookies instead of JWT
- Upload limits and MIME sniffing
- What we deliberately left out (folders, versioning, search, quotas, email, virus scan, 2FA)

## Security

**Addressed:** authorization in one place (`services/authz.ts`) and tested across workspaces and roles; 256-bit hashed share tokens with uniform 404s; private bucket with no host ports and no presigned URLs; app-generated storage keys; streamed uploads with size limit and magic-byte MIME; `attachment` + `nosniff` on every download; argon2id; HttpOnly/SameSite cookies; Sec-Fetch-Site CSRF check; login rate limit.

**Knowingly left:** no email verification or password reset; rate limiting is in-process (single instance); no virus scanning; no audit log; no quotas; MinIO console not exposed but root credentials are shared by app and init container.

## Product improvement: password-protected links

<!-- Why this one (a real team asks for it the week after the first external share; sits on the axis the app is judged on; small). How it works (argon2id on the link, /unlock sets a short-lived signed cookie scoped to the link, download checks it). What it cost (one migration, ~80 lines, two tests). -->

## How I worked with the coding agent

Agent: Claude Code. Rules in `CLAUDE.md` and `.claude/`; every prompt and response is in `docs/agent-log.jsonl`; hand-written corrections in `docs/agent-log.md`.

<!-- Be concrete. Suggested shape: -->
- **What I decided before prompting:** SPEC.md and ARCHITECTURE.md were written first; the agent implemented, it did not design.
- **What I delegated:** scaffolding, schema from my SQL, route/service boilerplate, tests from my case list, UI plumbing.
- **Where it went wrong and how I caught it:** three specific examples with the test or review that caught each. (e.g., defined the rate limiter but never registered the plugin — caught by the security-reviewer agent; returned 403 on a cross-workspace document — caught by `authz.test.ts`; used `formData()` buffering — caught reading the diff.)
- **What I rejected:** one plan or output I turned down and why.
- **What I could not delegate:** the decisions in SPEC.md; deciding proxy vs presign; the README.

## Weakest part

<!-- One honest paragraph. -->

## What I'd do next

1. Presigned member downloads with a public signing endpoint and short TTL, keeping proxying for share links.
2. Redis-backed rate limiting and a proper purge scheduler.
3. Email delivery for invitations; email verification.
4. Versioning (design in docs/DESIGN-versioning.md).
5. Audit log per workspace.

## Time spent

<!-- Honest hours per day. -->
