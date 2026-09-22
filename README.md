# File Storage & Sharing

A small full-stack app for a team to keep documents in workspaces, invite colleagues, and share single documents externally by link. Built for the BLKBOX.ai take-home.

## Run it

```bash
git clone https://github.com/Jyotiraditya0709/file-storage-sharing.git && cd file-storage-sharing
cp .env.example .env          # works unedited; dev-only credentials, flagged in the file
docker compose up --build     # postgres → minio → bucket init → migrations → app on http://localhost:3000
```

First run takes ~2–3 minutes (image build). Then: sign up, create a workspace, upload, share.

`.env.example` is complete and runs as-is — the credentials in it are obvious non-production values (`localdev`), each marked with a "change in any real deployment" comment. Nothing needs editing to see the app work. `DATABASE_URL`, `S3_ACCESS_KEY` and `S3_SECRET_KEY` are deliberately **not** in the file: compose derives them from `POSTGRES_*` and `MINIO_ROOT_*`, so a changed password can't leave the stack half-working.

**End-to-end check against the running stack:**

```bash
./scripts/smoke.sh            # 18 checks: signup → workspace → upload → share → revoke → invite → viewer 403
```

curl, sed and grep only — no jq, no node. One line per check with its status, non-zero exit on the first mismatch. Override the target with `BASE_URL=http://host:port ./scripts/smoke.sh`.

**Tests:**

```bash
pnpm install && pnpm test     # needs Docker: spins up Postgres + MinIO via Testcontainers
```

87 tests against a real database and a real object store. Also `pnpm typecheck`, `pnpm lint`, `pnpm build`.

**Ports.** The app is on `:3000`. MinIO is deliberately not published to the host at all — `docker compose ps` shows no port mapping for it.

## Architecture in one screen

| Layer | Choice | Why, in one line |
|---|---|---|
| Language | TypeScript strict, Node 22 | Brief prefers it; `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` on. |
| API | Express 5 | Async errors forwarded natively, so no wrapper library; auth and CSRF are middleware, not handler code. |
| DB | Postgres 16 + Drizzle ORM / Drizzle Kit | Migrations are plain `.sql` a reviewer can read; schema is TypeScript; no generated client. |
| Storage | `StorageProvider` → S3 (MinIO) and local disk | Two implementations plus one shared contract test suite, so the abstraction is demonstrated rather than asserted. |
| Auth | Server-side DB sessions + argon2id | Revocation and "member removed" need server state anyway, so a JWT would buy nothing. |
| UI | React 18 + Vite, built to static files, served by the same Express process | One container. Functional over pretty: no design system, no state library. |
| Tests | Vitest + Testcontainers + supertest against `buildApp()` | Real Postgres and real MinIO; no mocks for the parts that matter. No port is ever bound in tests. |

### Layering

```
web/                     React + Vite (static in prod, served by Express)
server/src/
  app.ts                 buildApp() → the Express app. Never listens.
  routes/                parse + validate (zod) → call ONE service → map the result
  services/              all authorization and orchestration
    authz.ts             can(user, action, resource) — the single place a permission is decided
  db/repositories/       thin queries; every workspace-scoped query carries its workspaceId
  storage/               StorageProvider; only services call it
  lib/                   tokens, password, files, multipart, cursor, cookies, errors
```

Three rules, all enforced mechanically rather than by good intentions:

- **Routes never import `db/` or `storage/`.** An ESLint `no-restricted-imports` rule fails `pnpm lint` if one does.
- **Services never read `req`/`res`.** The upload route hands the service a `Readable`; the share-download service takes an `isUnlocked(linkId)` callback rather than a cookie jar.
- **Repositories never take a bare resource id.** A document, link or member id always arrives with the id that scopes it.

### Request paths

**Upload** — `POST /api/workspaces/:wid/documents`

```
route: busboy → one "file" part (limits: 50 MB, 1 file, bounded fields/parts)
  → service: requireMembership(404) → can('document:create')(403)
  → peek first 4100 bytes → sniff MIME from magic bytes (client Content-Type discarded)
  → documentId generated → key = ws/{wid}/doc/{documentId} (never from user input)
  → pipeline(body → sha256+size meter → storage) — streamed, nothing buffered
  → oversize? busboy truncates → delete the object → 413, no row
  → insert row; if the insert throws, delete the object and rethrow
```

**Member download** — `GET /api/workspaces/:wid/documents/:did/download`

```
requireMembership(404) → can('document:read')(403)
  → findLive(workspaceId, documentId) — mismatched ids simply miss → 404
  → storage.getStream(key) piped to the response
  → Content-Disposition: attachment · X-Content-Type-Options: nosniff · Content-Length
```

**Share-link download** — `GET /api/s/:token` (no session)

```
sha256(token) → one indexed lookup joining link → document → workspace
  → revoked? expired? exhausted? document deleted? workspace deleted? → the SAME 404
  → password set? require the per-link unlock cookie (HMAC over linkId|exp)
  → UPDATE share_links SET download_count = download_count + 1
     WHERE id = $1 AND (max_downloads IS NULL OR download_count < max_downloads)
     RETURNING id                       ← atomic; zero rows → 404
  → stream with attachment + nosniff
```

That last `UPDATE` is the whole exhaustion rule in one statement: ten concurrent requests against `max_downloads = 5` yield exactly five downloads and a stored count of five. There is a test for precisely that.

## Assumptions and decisions

### Product shape (the gaps in the brief)

- **A share link grants one document's metadata and download, never workspace access.** — If a link leaks, one file leaks, not the whole team's folder. Only the hash of the token is stored, so even a copy of the database doesn't give anyone a working link.
- **Four roles — owner / admin / member / viewer — per the SPEC §2 table.** — Two roles can't say "you can read but not write", and that case is real (a client, an auditor). Per-document permissions would have been a lot of work nobody asked for.
- **Documents belong to the workspace; the uploader is metadata.** — When someone leaves, their files should stay. If files belonged to the uploader, every offboarding would mean moving files around.
- **Soft delete with a 30-day trash and an explicit purge; deleting a document kills its links instantly.** — Delete has to take effect everywhere at once, including links that are already out there, and a deleted_at check does that in one place. Trash gives you undo. Purge deletes the object first and the row second, so a failed purge leaves something you can see instead of an orphan you can't.
- **Invitations are bound to an email address, expire in 7 days, and no email is sent — the inviter copies the URL.** — Tying the invite to an address means a forwarded link is useless to anyone else. Sending email would mean a provider account and a secret the reviewer can't run, so the inviter copies the link instead, and the UI says so plainly.
- **Removing a member ends access on the next request; their documents and links stay with the workspace.** — Permissions are checked on every request, not stored in the session, so there's nothing to invalidate. Their files and links stay with the workspace and admins can revoke the links.
- **404, not 403, for anything in a workspace you are not a member of; 403 only for an insider whose role is too low.** — If you're not in the workspace you shouldn't learn that it exists. If you are in it, you should be told the rule. Both come from the same two lines: check membership first, then check the role.
- **Every download is proxied through the API; no presigned URLs reach the browser.** — In docker-compose a presigned URL is signed for minio:9000, which a browser can't reach, and you can't just rewrite the host because the signature covers it. Proxying also means every byte passes the permission check and link rules apply to the download itself. At real scale I'd presign member downloads with short TTLs and keep proxying share links.
- **Server-side DB sessions instead of JWT.** — I need server state anyway to kick out a removed member, so a JWT would only add a revocation problem. The session code is about 150 lines and I can explain all of it.
- **50 MB upload limit, MIME from magic bytes, filename sanitised to a display name only.** — 50 MB covers documents and caps memory and disk. The client's Content-Type is whatever the client says, so I ignore it and read the magic bytes. The filename is only ever displayed, never used in a path.
- **Deliberately left out: folders, versioning, search, quotas, email delivery, virus scanning, 2FA, password reset.** — Each is its own subsystem, the brief said not to build a production system, and three flows that fully work beat seven that half work.

### Decisions taken during the build

*Contract and API*

- **Error codes beyond the two in the brief: `UNAUTHORIZED`, `VALIDATION_ERROR`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `CSRF_REJECTED`, `INTERNAL`.** — The UI has to tell "log in" (401) from "gone" (404) from "not allowed" (403) from "bad input" (400). A fixed vocabulary keeps the error middleware the only exit.
- **A rejected cross-site request is `CSRF_REJECTED`, not `FORBIDDEN`, though both are 403.** — A role denial is a product rule; a CSRF rejection is a browser or client problem. Both are 403, and during the browser test the shared code made them indistinguishable in logs.
- **No session at all is 401; a valid session that is not a member is 404.** — A blanket 404 when logged out would send a share-link visitor to nowhere. The UI needs to know when to show the login page.
- **A malformed UUID or an over-long token in a path is a 404, never a 400 or a Postgres cast error.** — Otherwise Postgres throws a cast error, which becomes a 500 and lets an outsider probe id formats. The outsider story stays uniform.
- **CSRF: allow `Sec-Fetch-Site: same-origin` or `none`; allow a request carrying neither that header nor `Origin` (a non-browser client); refuse everything else.** — The first version of the spec said "header absent → 403". That breaks curl, Postman and every non-browser client, and a reviewer would read it as a broken API. Browsers always send `Sec-Fetch-Site` or `Origin` on a cross-site request, so allowing a request with neither admits only non-browser clients, which cannot be used for CSRF. I changed the spec mid-build and recorded it.
- **The API returns server-computed `capabilities` per workspace and `canEdit`/`canShare`/`canRevoke` per row, so the browser holds no role table.** — The interface has to reflect permissions. Mirroring the role table in the browser would be a second source of truth that drifts. Now `authz.ts` is the only place a rule exists and the UI has no authorization logic at all.
- **Cursor pagination is an opaque base64url of `created_at|id`, fixed at 50 per page and not client-controllable.** — Offset pagination scans and discards rows and skips or repeats items when rows are inserted. A cursor on `(created_at, id)` matches the partial index exactly. A fixed page size keeps the API surface small.
- **The invitation preview returns the full invited email rather than a masked hint.** — The spec requires prefilling signup with it, which a masked hint cannot do. Whoever holds the token is the intended recipient.
- **A password-protected link reveals nothing — not even the filename — until it is unlocked.** — A filename can itself be sensitive. This is stricter than a literal reading of the spec and costs nothing.
- **The download count increments before streaming starts, not on completion.** — It is the only way to make the cap atomic under concurrent requests. A dropped download costs one count, which is acceptable.
- **Workspace soft-delete is not cascaded onto document rows; every query joins and filters on the workspace being live.** — Restore stays possible and there is no mass `UPDATE`. The cost is one join on every query, so there is a test that a deleted workspace's documents and links all return 404.
- **`invitation_status = 'expired'` is never written; expiry is computed from `expires_at`.** — Deriving it from `expires_at` avoids a background job whose only purpose is keeping a column honest.
- **Share-link passwords have an 8-character minimum (account passwords are 10).** — The password is a second factor on top of an unguessable token, not the only barrier.
- **Members and above may list a document's links; viewers may not. Viewers and above may list members.** — Members need to see what they can revoke. The member list is read-only information inside a workspace you are already in.
- **Transfer of ownership exists in the API but has no UI; self-transfer is a 400 rather than a silent success.** — Transfer is the rarest action; the API and the transaction test exist. A self-transfer as a silent no-op would hide a client bug.
- **Workspace rename and delete are in the UI; there is no way to undo a workspace delete from the app.** — Deletion is what a reviewer clicks. Restore is on the "next" list.
- **The share-link unlock endpoint is rate-limited, which SPEC §1 did not ask for.** — A password endpoint with no throttle is a guessing oracle. It is the same limiter with one more mount.

*Data and storage*

- **`share_links.token_tail` stores the last 6 characters of the token, because SPEC §5 shows them and a sha256 cannot produce them.** — The spec shows the last six characters of a link after creation. A hash cannot produce them. Six of 43 characters leaves about 220 bits of entropy.
- **Two migrations before any schema: `citext` needs a hand-written `--custom` migration because drizzle-kit does not emit extension statements.** — drizzle-kit does not emit `CREATE EXTENSION`. A hand-written SQL file is readable and runs first.
- **`drizzle/meta/_journal.json` is seeded so `drizzle-kit migrate` is a genuine no-op on an empty migration folder.** — `drizzle-kit migrate` errors on an empty folder. Seeding the journal let the compose migrate → app chain be proven before any schema existed.
- **The text-format allow-list is `.txt/.log/.csv/.md/.json/.xml` only; HTML and SVG fall through to `application/octet-stream`.** — Magic bytes cannot distinguish text formats, so a short extension list covers the honest cases. HTML and SVG are XSS vectors and get the safest type; `attachment` plus `nosniff` makes it moot anyway.
- **`SESSION_SECRET` is required whenever `APP_URL` is https or `NODE_ENV=production`, because it also keys the unlock-cookie HMAC.** — The demo must run unedited; anything real must set it. It also keys the unlock-cookie HMAC.
- **The session cookie's `Secure` flag comes from the `APP_URL` scheme, never from `NODE_ENV`.** — `NODE_ENV=production` over `http://localhost` would make the browser drop the cookie silently. That trap is why the demo container runs with `NODE_ENV=development`.
- **Session refresh extends the expiry but does not rotate the secret.** — Revocation is a row delete; rotation would add complexity for little gain.
- **The purge is a CLI entry point with no scheduler.** — The spec allows manual purge, and a scheduler is a deployment decision.

*Build, tooling and tests*

- **`DATABASE_URL` and the S3 credentials are derived, not repeated: `docker compose` builds them from `POSTGRES_*` and `MINIO_ROOT_*`, and `config.ts` derives `DATABASE_URL` the same way when it is unset.** — One source of truth for each password. Changing one value cannot leave the stack half-working.
- **The `migrate` service runs from the Dockerfile's `build` stage, because the runtime stage is pruned of drizzle-kit.** — drizzle-kit is a devDependency and `pnpm deploy --prod` prunes it from the runtime image. The runtime image stays small; the migrate step uses the image that still has the tool.
- **MinIO images are pinned to `quay.io`, not Docker Hub.** — Docker Hub's tags API returned 404 when I tried to pin the minio/minio tag, so the images are pinned on quay.io where the tags resolve.
- **`minio-init` passes credentials via `MC_HOST_local` so they never appear in process arguments.** — Keeps the root password out of `docker compose ps` and process arguments.
- **The layering rule is an ESLint rule, not a review convention.** — A rule that fails `pnpm lint` is stronger than a rule in a document.
- **Testcontainers `globalSetup` starts one Postgres and one MinIO for the whole run, with no truncation between files.** — Faster, and every test runs against a non-empty database, which is where cross-workspace leaks would show up.
- **The rate limiter runs in every test with a raised ceiling, and one test lowers it to 2 to prove it enforces.** — "Configured but untested" is the classic failure. When I removed the test-mode skip, four unrelated tests failed with real 429s, which is the proof the limiter was in the request path.
- **Smaller calls.** — Tooling is declared once at the workspace root; zero-byte uploads are accepted and a second file part is rejected; dependency versions come from the registry because the agent's first guesses did not exist; `scripts/smoke.sh` uses only curl, sed and grep so there is nothing to install to verify the app.

### Findings raised in review and deliberately **not** acted on

- **Per-link password-failure counter (share-link brute force is throttled per-IP only).** — Per-IP throttling plus argon2id plus a token nobody can guess means an attacker needs the token first. A per-link lockout would let anyone holding the link lock out the legitimate recipient.
- **Aborting the storage upload the moment busboy signals `limit`, rather than deleting the object afterwards.** — Busboy truncates and the object is deleted afterwards; the difference is a few megabytes of wasted transfer versus a second cleanup path to get wrong. The cleanup is tested.
- **Setting `trust proxy`.** — Unset is correct for the compose demo, where there is no proxy. Setting it blindly lets clients spoof `X-Forwarded-For` and bypass the rate limit. It is a deployment setting and is documented as such.
- **An absolute ceiling on sliding session lifetime.** — Sliding 10-day expiry with server-side revocation covers this product. An absolute ceiling is a policy choice for a real deployment.

## Security

**Addressed.**

- **Cross-user access.** Every service method that touches workspace data opens with `requireMembership()` — a 404 for a non-member, an unknown workspace and a soft-deleted one alike — and then `authz.can()`, which is a 403. That single ordering is what produces "404 hides existence, 403 states the rule" everywhere. Repositories are workspace-scoped, so a document id from another workspace simply misses. `authz.test.ts` drives every one of these across two workspaces and four roles, including the nasty variant of workspace A's id in the path with workspace B's document id.
- **Share links.** 32 CSPRNG bytes, base64url, stored only as sha256 and looked up through a unique index, so no secret is ever string-compared. Unknown, revoked, expired, exhausted, wrong-password, deleted-document and deleted-workspace all return a **byte-identical** 404 — asserted by comparing raw response bodies, not just status codes. Revocable; optional expiry; optional download cap enforced by an atomic `UPDATE`.
- **Storage exposure.** The bucket is private (`mc anonymous set none`), MinIO publishes no host port, credentials come from the environment, storage keys are app-generated and never contain client input, and every byte is proxied through an authorization check. There is no presigned-URL code anywhere in the repository.
- **Uploads.** Streamed end to end — never buffered. Size limit enforced by busboy with the file deleted and no row written on overflow (413). MIME from magic bytes with a narrow text fallback; the client's `Content-Type` is discarded. Filenames are reduced to a sanitised basename used only for display. `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` on every download, so an uploaded HTML or SVG cannot execute in our origin.
- **Sessions and CSRF.** argon2id at OWASP parameters. Cookie is `id.secret`; only sha256(secret) is stored and compared with `timingSafeEqual`. HttpOnly, SameSite=Lax, and `Secure` derived from the `APP_URL` scheme rather than `NODE_ENV`. Mutating requests are checked against Fetch Metadata. Login, signup and share-link unlock are rate-limited at 10 per 15 minutes per IP, and a test drives that to a real 429.
- **Error surface.** One error middleware is the only exit; stack traces never reach a client, and unknown throws become a fixed `INTERNAL` body.

**Verified, not just claimed.** 87 tests, a curl smoke script, a scripted browser pass over the real UI, and two read-only review agents over the full diff. The browser pass confirmed the important half of role enforcement directly: a viewer sees no upload control *and* the API refuses the same upload with `FORBIDDEN` when driven by curl with the viewer's cookie.

**Knowingly left.**

- No email verification, password reset or 2FA.
- Rate limiting is in-process, so it is per API instance. Redis would replace the store without touching call sites.
- Share-link password guessing is throttled per IP only; there is no per-link lockout.
- No virus scanning, no audit log, no per-workspace quotas.
- `trust proxy` is unset, so behind an ingress every client would share one rate-limit bucket.
- Sliding sessions have no absolute lifetime ceiling.
- The app and the bucket-init container share the same MinIO root credentials.
- A deleted workspace cannot be restored from the app.

## Product improvement: password-protected links

I picked this because it is what a team asks for the week after they share their first sensitive file with someone outside, and because it sits exactly on the axis this app is judged on. It cost one column (`password_hash`), the `/unlock` endpoint, a short-lived HMAC cookie scoped to `/api/s`, and two tests. The password is argon2id-hashed on the link; a correct unlock sets a 15-minute cookie tied to the link id, and the download checks that cookie. A locked link reveals nothing, not even the filename. The unlock endpoint is rate-limited so it cannot be used to guess. What I would add next is expiry and download-cap defaults in the share dialog, since both already work in the API.

## How I worked with the coding agent

Agent: Claude Code. Rules in `CLAUDE.md` and `.claude/`; every prompt and response is in `docs/agent-log.jsonl`; hand-written corrections in `docs/agent-log.md`.

I wrote `SPEC.md`, `ARCHITECTURE.md` and the plan before the first prompt, and committed them. Claude Code worked in plan mode: it proposed, I approved or changed, it implemented one bounded task at a time, and each task ended with one commit; the agent ran typecheck, lint and tests after every task and pasted the real output; before submitting I ran the full suite three times, the smoke script, and a clean-clone build myself. Rules that had to hold were made mechanical rather than advisory: hooks block edits to migrations and `.env`, ESLint fails the build on a layering violation, and every prompt and response is logged to `docs/agent-log.jsonl`.

What I delegated: scaffolding, the schema from my SQL, route and service boilerplate, tests from my case list, the UI plumbing. What I did not: every product decision, the proxy-versus-presign call, the choice to have the server compute capabilities instead of duplicating the role table in the client, and this README.

Where it went wrong, and what caught it. The runtime Docker image did not copy `server/package.json`, so Node would have loaded the built files as CommonJS and died on the first `import`; I caught that reading the Dockerfile before it was written. The pagination tests derived every expectation from the `PAGE_SIZE` constant, so the suite passed with the constant changed from 50 to 25; a deliberate mutation caught it, and the subagent's report had claimed an assertion that was not there. The rate limiter was mounted but skipped under `NODE_ENV=test`, so nothing proved it worked; making it configurable and adding a 429 test fixed that, and removing the skip immediately broke four unrelated tests with real 429s, which was the evidence. Its first dependency versions were invented and did not exist; `pnpm install` caught that in seconds.

What I rejected: a role table mirrored in the browser, and four review findings listed above with reasons. In the S2 plan interview I rejected the agent's recommended no-op placeholder for the migrate service and had it run the real drizzle-kit command against an empty migrations folder, so the compose dependency chain was proven before any schema existed.

**Corrections I made to the agent**

| What happened | How it was caught |
|---|---|
| Rejected the agent's first S2 plan: it repeated credentials in `.env.example`. Told it to derive `DATABASE_URL` and the S3 keys inside compose instead. | Reading the plan |
| **Real bug I caught in review:** the Dockerfile runtime stage never copied `server/package.json`, so Node would have loaded `server/dist/*.js` as CommonJS and died on the first `import`. | Reading the Dockerfile |
| Told it to move every comment in `.env.example` onto its own line, because Node's `--env-file` and dotenv disagree about trailing `# ...`. | Reading the file |
| Challenged its claim that `drizzle-kit migrate` exits 0 on an empty migration folder. It didn't — it needed a seeded `_journal.json`. | Asking it to prove the claim |
| Rejected its plan to mirror the role table in the React client; required the server to return `capabilities` instead. | Reading the plan |
| Caught the rate limiter being skipped under `NODE_ENV=test` — configured but unverified. Required a real 429 test. | Reading the deviations list |
| Required CSRF rejections to stop sharing the `FORBIDDEN` code with role denials. | Browser-test report |

**Things the agent got wrong and the check that caught it**

| What went wrong | Caught by |
|---|---|
| Invented dependency versions from memory; `@types/react-dom@^18.3.9` does not exist and the install failed. | `pnpm install` |
| `LocalDiskStorageProvider.exists()` swallowed a path-traversal rejection and reported "no such object". | `storage.contract.test.ts` |
| Duplicate-invitation handling returned 500, not 409: Drizzle wraps driver errors, so the pg code is on the cause. | A smoke test before commit |
| Piped gate commands to `tail`, which masked a failing `typecheck` and let a red commit land. | Re-running the gate unpiped; fixed by a gate script |
| `scripts/smoke.sh` used a greedy `sed` that returned the *last* `"id"` in a body — a user id where a document id was wanted. | First live run of the script |
| Test suite passed with `PAGE_SIZE` mutated 50 → 25: the pagination tests derived every expectation from the constant. | A deliberate mutation check |
| `s3.provider.put` used `pipe()`, which does not forward errors — an aborted upload would hang the request forever. | `security-reviewer` agent |
| `purge.service` was the only service querying the database directly, bypassing the repositories. | `code-reviewer` agent |
| Transfer of ownership — the subtlest ordering in the codebase — had only a negative test. | `code-reviewer` agent |

**Output I rejected**

- Four review findings rejected with reasons (per-link brute-force counter, abort-on-limit restructure, `trust proxy`, absolute session lifetime) — commit `1cfb3d7`.
- A subagent's report claimed the pagination test asserted "page 1 has 50"; it did not. The claim was checked rather than taken at face value.

## Weakest part

Rate limiting is in-process and per instance, so it does not survive a second replica and `trust proxy` is unset, which means behind an ingress every client would share one bucket. Invitations are copy-a-link rather than email. All downloads go through the API, which is the right call for share links but would become a bandwidth cost for member downloads at scale. And the meeting-the-spec cost of `token_tail` is 36 bits of entropy, which I accepted but would rather have designed away with a separate display id.

## What I'd do next

1. Presigned member downloads with a public signing endpoint and short TTL, keeping proxying for share links.
2. Redis-backed rate limiting and a proper purge scheduler.
3. Email delivery for invitations; email verification.
4. Versioning.
5. Audit log per workspace.

## Time spent

About 14 hours across three sittings.

- Sat 19 Sep, ~3 h: read the brief, decided the product gaps, wrote SPEC.md, ARCHITECTURE.md and the plan. No code.
- Sun 20 Sep, ~7 h: scaffold, backend, tests, UI, review pass. Almost all of it with the agent in plan mode; every step committed with the gate green.
- Tue 22 Sep, ~4 h: ran the whole thing myself in the browser and from a clean clone, wrote the README and the agent log, submitted.

No work on Monday.
