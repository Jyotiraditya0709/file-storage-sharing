# Decisions

## 2026-09-20 — Share links grant one document, nothing else
**Decision:** A link exposes one document's metadata and download. It never grants workspace access. Token is 256-bit CSPRNG, stored as SHA-256, shown once, revocable, optional expiry and download cap.
**Why:** The rubric asks "are share links guessable"; hashing at rest means a DB leak doesn't leak live links. One-document scope keeps the blast radius of a leaked link small.
**Rejected:** Workspace-level share links (too much exposure for a first version); UUIDv4 tokens (fine entropy, but hashing a random token is the cleaner story).

## 2026-09-20 — Four roles, documents owned by the workspace
**Decision:** owner / admin / member / viewer with the SPEC §2 table. Documents belong to the workspace; uploader is metadata.
**Why:** Removing a member must not orphan files; "member" needs to delete their own uploads without deleting others'; "viewer" is what an outside stakeholder inside the team looks like.
**Rejected:** Two roles (admin/member) — can't express read-only; per-document ACLs — scope creep.

## 2026-09-20 — Soft delete with 30-day trash and explicit purge
**Decision:** `deleted_at` on documents and workspaces; everything (lists, downloads, share links) treats deleted as gone immediately; purge removes the object before the row.
**Why:** The rubric asks whether the schema handles deletion cleanly; soft delete makes links fail closed instantly and gives restore for free; object-before-row means a failed purge never leaves an orphaned object.
**Rejected:** Hard delete with FK cascade (orphans objects silently; no undo).

## 2026-09-20 — Invitations bound to email, 7-day token, no email sending
**Decision:** Invite by email; hashed token; acceptance requires a logged-in user with that email; the inviter copies the URL from the UI.
**Why:** Email binding stops a forwarded invite being used by someone else. Wiring an email provider adds a secret and a dependency the reviewer can't run.
**Rejected:** Open invite links (anyone with the link joins); auto-creating accounts on accept.

## 2026-09-20 — Proxy every download through the API; no presigned URLs
**Decision:** The API streams bytes from MinIO to the client with `attachment` + `nosniff`; MinIO has no host ports; bucket is private.
**Why:** Inside compose a presigned URL is signed over `minio:9000`, which the browser cannot resolve or rewrite. Proxying also puts every byte behind the authorization check and lets share-link rules apply to the download itself. Answers "is the storage backend exposed" with a plain no.
**Rejected:** Second S3 client with a public endpoint for signing (works; kept as the production path for member downloads in "what's next").

## 2026-09-20 — Express 5 + Drizzle, DB sessions, no JWT
**Decision:** Express 5 with routes → services → repositories/storage; Drizzle SQL migrations; hand-rolled DB sessions with argon2id.
**Why:** Express is what I run in production, so I can defend every line; Express 5 handles async errors natively; layering is enforced by convention and review, tested with supertest; migrations are readable SQL; sessions need server state anyway for membership removal, so JWT adds nothing but revocation problems.
**Rejected:** Fastify (better encapsulation and `inject()` tests, but I'd be learning it under a deadline); Next.js route handlers (no body-size control, buffers uploads); Better Auth (magic the reviewer can't see); JWT.
