# PLAN — Sunday 20 Sep → submit Monday night 21 Sep (due Tue 22)

Rules for the whole build: Claude Code in **plan mode** for every task; approve the plan before any edit; one task = one prompt = one reviewed commit; you run the tests, not the agent's word; every correction goes in `docs/agent-log.md`. If a task runs past its box, cut scope, don't extend the day.

## Sunday morning — setup and skeleton (3 h)

**S1. Repo and agent setup (30 min, no agent).**
`git init`, copy `CLAUDE.md`, `.claude/`, `SPEC.md`, `ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/agent-log.md` from this folder. `claude mcp add` Playwright and Context7 (see `claude-code-setup/README.md`). Start Claude Code, run `/init` only to compare, keep our CLAUDE.md.

**S2. Scaffold + compose (1 h).** Prompt:
> Read CLAUDE.md, SPEC.md and ARCHITECTURE.md. Plan, then scaffold the monorepo exactly as ARCHITECTURE.md lays out: pnpm workspaces with `server/` (Express 5, TypeScript strict, zod config) and `web/` (Vite + React + TS). Add docker-compose.yml with postgres, minio (pinned tag, no host ports), minio-init, migrate, app; a multi-stage Dockerfile; `.env.example`. Wire `pnpm dev`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Do not write any business code yet. Stop after `docker compose up` serves a health endpoint at /api/health and the built web app at /.

Review: does `docker compose up` on a clean clone reach `/api/health`? Are MinIO ports absent from the host? Commit `chore: scaffold`.

**S3. Schema + migrations (45 min).** Prompt:
> Implement `server/src/db/schema.ts` exactly per the SQL in ARCHITECTURE.md (citext, enums, partial unique indexes, cursor index). Generate the Drizzle migration and show me the .sql before committing. Add the `migrate` compose service and confirm migrations apply on `docker compose up`.

Review the SQL by eye: partial indexes present, `on delete restrict` on documents→workspaces, `bytea` hashes. Commit `feat(db): schema and initial migration`.

**S4. Storage abstraction + contract test (45 min).** Prompt:
> Implement `StorageProvider` with S3StorageProvider (MinIO via @aws-sdk/client-s3 and lib-storage Upload, streaming) and LocalDiskStorageProvider (path-traversal safe). Add a contract test suite in tests/storage.contract.test.ts that runs the same cases against both, using Testcontainers MinIO in globalSetup. Do not add any presigned URL code.

Review: path traversal guard on local provider; `Upload` with partSize ≥ 5 MiB; tests green. Commit.

## Sunday afternoon — auth, workspaces, members (4 h)

**S5. Sessions + signup/login (1 h).** Prompt:
> Implement auth per SPEC §1 and ARCHITECTURE "Sessions": argon2id with OWASP params, sessions table, cookie `id.secret`, timingSafeEqual on the hash, sliding 10-day expiry, Sec-Fetch-Site CSRF middleware, login rate limit. Expose /api/auth/*. Implement auth as middleware: `attachUser` sets `req.user` from the cookie, `requireUser` guards routes. Mount express-rate-limit on login/signup. Routes must not touch db directly.

Review: no JWT crept in; cookie flags; `timingSafeEqual`; rate limiter mounted (agents often define and forget to mount). Commit.

**S6. authz + workspaces + memberships (1.5 h).** Prompt:
> Implement `services/authz.ts` as the single `can(user, action, resource)` function encoding the SPEC §2 role table. Then workspaces and memberships services, repositories, and routes per ARCHITECTURE. Every miss is a 404. Owner uniqueness is enforced by the partial index and by the transfer flow.

Review: open `authz.ts` — it should read like the table. Grep routes for `db.` imports (must be none). Commit.

**S7. Invitations (1 h).** Prompt:
> Implement invitations per SPEC §6: hashed token, 7-day expiry, one pending per (workspace,email), preview endpoint, accept in one transaction bound to the logged-in user's email, wrong email → 404, already member → accepted no-op. Return the invite URL once on creation.

Review: the email-binding check; the transaction. Commit.

**S8. Authorization tests, first pass (30 min).** Prompt to the `test-writer` agent:
> Write tests/authz.test.ts covering ARCHITECTURE "Tests" items 1, 2 and 4 using supertest against buildApp(). Two workspaces, four roles. Every negative case asserts 404 or 403 exactly as SPEC says.

Run them yourself. Anything red is a real bug — fix before moving on. Commit.

## Sunday evening — documents and links (3 h)

**S9. Upload/list/download/delete/trash (1.5 h).** Prompt:
> Implement documents per SPEC §3–4: streamed multipart upload via busboy with size limit (`limit` event → abort storage upload, 413), magic-byte MIME sniffing (file-type) with text allow-list, sanitised display name, app-generated storage key, sha256 while streaming, row insert after storage success with object cleanup on failure; cursor-paginated list; proxied download with attachment + nosniff; soft delete; trash + restore; purge service as a CLI script.

Review: grep for `formData()` or buffering into memory (must be streams); `Content-Disposition`; the cleanup-on-failure branch. Commit.

**S10. Share links (1 h).** Prompt:
> Implement share links per SPEC §5 and the "Download (share link)" flow: randomBytes(32) base64url, sha256 at rest, URL returned once, revoke, expiry, max_downloads with the atomic UPDATE … RETURNING increment, uniform 404 for every failure including deleted document/workspace. Public routes under /api/s/:token. No presigned URLs.

Review: the atomic increment SQL; identical 404 bodies; `Math.random` must not appear anywhere (`grep -r Math.random server/`). Commit.

**S11. Link and document tests (30 min).** `test-writer`: items 3, 5, 6. The concurrency test for `max_downloads` is the one that catches real bugs. Commit.

## Monday morning — UI (3.5 h)

**S12. UI (3 h).** Prompt:
> Build the React UI per SPEC §7, functional over pretty. Pages: auth, workspace list, workspace page (documents table with upload, members panel, invitations with copy-URL, trash for owner/admin), share dialog showing the URL once, public /s/:token page with unlock form, accept-invitation page. Fetch `/api/auth/me` and the membership role, and render only the actions the role permits; the server still enforces. No secrets in VITE_ vars. Keep components plain.

Review in the browser yourself (or the `browser-tester` agent with Playwright MCP): sign up two users, two workspaces, invite, upload, share, open the link in an incognito window, revoke, confirm 404. Commit.

**S13. Improvement: password + expiry + max downloads in the UI (30 min).** Backend already supports it from S10; add the argon2id password field, `/unlock`, the signed per-link cookie, the UI fields, and two tests (wrong password 404; unlock then download succeeds). Commit `feat: password-protected links`.

## Monday afternoon — hardening, README, clean clone (3.5 h)

**S14. Security review (45 min).** Run `/review-security` (custom skill) and the `security-reviewer` agent against the full diff. Fix real findings only; log the ones you rejected and why.

**S15. README (1.5 h, you write it, agent formats).** Use `README-TEMPLATE.md`. The "Assumptions and decisions" section is SPEC.md condensed into "what we chose and why". The agent section comes from `docs/agent-log.md`: name three concrete corrections, one rejected output, the test that caught a bug. Add "weakest part" honestly (likely: in-process rate limiting, no email delivery, proxied downloads at scale).

**S16. Clean-clone run (30 min).** `git clone` into a fresh directory, `cp .env.example .env`, `docker compose up`, run the full browser flow, `pnpm test`. Time it; it must be under 5 minutes. Fix anything, commit.

**S17. Walkthrough rehearsal (30 min).** Close the agent. Open the repo cold and explain out loud: where is the download authorization check; what happens when a member is removed; why 404 not 403; why proxy not presign; why hashed tokens; what the partial unique indexes enforce; what you'd change with more time. If you can't answer one from the code, that's the thing to reread.

Submit Monday night. Tuesday is buffer, not build time.

## Cut list (in order, if behind)

1. Trash restore UI (keep the API + test).
2. Transfer ownership endpoint (keep the constraint; document).
3. Max-downloads UI field (keep backend).
4. Password-protected links → ship as the one-page design note instead.

Never cut: authorization tests, hashed tokens, proxied downloads, clean-clone check, README decisions section.
