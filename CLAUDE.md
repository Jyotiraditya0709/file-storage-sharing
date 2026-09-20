# File Storage & Sharing — agent rules

Read SPEC.md (product decisions) and ARCHITECTURE.md (stack, layers, schema, API) before any task. They are the source of truth; do not reinterpret them. If a task needs a decision they don't cover, stop and ask.

## Commands
- `pnpm install` · `pnpm dev` (server + Vite proxy) · `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build`
- `docker compose up --build` brings up postgres, minio, minio-init, migrate, app on :3000
- `pnpm --filter server drizzle-kit generate` → review the .sql → `drizzle-kit migrate`

## Stack
TypeScript strict, Node 22, pnpm workspaces. `server/`: Express 5, Drizzle + drizzle-kit, zod, argon2, cookie-parser, express-rate-limit, busboy, @aws-sdk/client-s3 + lib-storage, file-type. `web/`: Vite + React 18 + TS. Tests: Vitest + Testcontainers + supertest against `buildApp()` (never `listen()` in tests).

## Layering (enforced in review)
- `routes/` parse + validate + call one service + map result. Never import `db/` or `storage/`.
- `services/` own all authorization and orchestration. Call `authz.can(user, action, resource)` first in every method that touches workspace data. Never read `req`/`res`.
- `db/repositories/` are workspace-scoped: no query takes a document/link/member ID without the workspace ID.
- `storage/` is behind `StorageProvider`. Only services call it.

## Never
- Never generate tokens or IDs with `Math.random`; use `lib/tokens.ts` (crypto.randomBytes, base64url) and store only the sha256.
- Never confirm existence to a non-member: anything in a workspace the caller isn't in is 404 with the uniform error body. 403 is only for a member acting beyond their role.
- Never expose MinIO to the browser: no presigned URLs, no host ports, no public bucket. All bytes go through the API with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- Never trust the client's Content-Type or filename; sniff MIME, sanitise names, app-generated storage keys.
- Never buffer an upload into memory; stream it.
- Never put secrets in `VITE_*` or commit `.env`.
- Never edit files under `drizzle/` by hand after generation; regenerate.
- Never mark a task done without running `pnpm typecheck && pnpm test` and reporting the actual output.

## Working agreement
- Plan first; wait for approval before editing. One task per prompt. Small diffs.
- Before committing, explain the diff in plain language: what changed, why, what could break.
- When you are unsure whether something is in scope, it isn't.
- On compaction, preserve: modified file list, failing tests, open decisions.
