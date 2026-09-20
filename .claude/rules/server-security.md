---
paths: ["server/src/**"]
---

When touching server code:
- Any function that returns or mutates workspace data calls `authz.can()` before the query, with the caller's user and the loaded resource. A missing check is a bug, not a TODO.
- IDs from the URL are untrusted. Load the resource, then verify it belongs to the workspace in the path AND the caller is a member. Mismatch → 404.
- Tokens: `lib/tokens.ts` only. Compare hashes, never raw tokens.
- Downloads: always `Content-Disposition: attachment; filename*=UTF-8''<encoded>` and `X-Content-Type-Options: nosniff`.
- Uploads: stream with busboy; enforce `limits.fileSize`; handle the `limit` event (abort upload, 413); `sniffMime()`; `sanitiseFilename()`; app-generated key.
- Errors: throw `AppError(code, status)` (Express 5 forwards async rejections); the errors middleware maps them. Never `res.send` an Error object or a stack.
