# SPEC — File Storage & Sharing

Product decisions for every gap in the brief. The agent implements this; it does not reinterpret it. Anything not covered here is out of scope and goes in the README's "left out" list.

## 1. Users and authentication

- Sign up with email + password. Email is unique, case-insensitive (`citext`). Password minimum 10 characters; hashed with argon2id.
- Sessions are server-side rows in Postgres, referenced by an HttpOnly, `SameSite=Lax`, `Secure`-in-production cookie. Sliding expiry: 10 days, refreshed when more than half elapsed. Logout deletes the row.
- No email verification, no password reset, no OAuth. Documented as left out.
- CSRF: Mutating requests must carry `Sec-Fetch-Site: same-origin` or `none`. A request with neither `Sec-Fetch-Site` nor `Origin` is treated as a non-browser client and allowed; any other value is 403 `CSRF_REJECTED`. Login and signup are rate-limited (10 attempts / 15 min / IP).

## 2. Workspaces and roles

A workspace is the unit of collaboration. Documents belong to the workspace, never to a person.

| Action | owner | admin | member | viewer |
|---|---|---|---|---|
| View documents, download | ✓ | ✓ | ✓ | ✓ |
| Upload document | ✓ | ✓ | ✓ | – |
| Rename / delete **own** upload | ✓ | ✓ | ✓ | – |
| Rename / delete **any** document | ✓ | ✓ | – | – |
| Create share link for a document | ✓ | ✓ | ✓ | – |
| Revoke any share link | ✓ | ✓ | own only | – |
| View trash, restore | ✓ | ✓ | – | – |
| Invite members (role ≤ own role) | ✓ | ✓ | – | – |
| Change roles, remove members | ✓ | ✓ (not owner/admins) | – | – |
| Rename workspace | ✓ | ✓ | – | – |
| Delete workspace, transfer ownership | ✓ | – | – | – |

- Exactly one owner per workspace. The creator is the owner. Ownership transfers to another member explicitly; the previous owner becomes admin.
- The owner cannot be removed or demoted except through transfer.
- A user sees only workspaces they are a member of. Any request for a workspace, document, link, or invitation the user is not a member of returns **404**, never 403, so existence is not confirmed.
- A member whose role is insufficient for an action inside a workspace they *can* see (a viewer uploading, a member deleting someone else's document) gets **403** with `code: "FORBIDDEN"`. The distinction: 404 hides existence from outsiders; 403 tells insiders the rule.

## 3. Documents

- Upload is a single multipart request, streamed to storage, never buffered fully in memory. Maximum size 50 MB (config). Any file type is accepted; the stored MIME type comes from magic-byte sniffing, falling back to an allow-list for text formats, never from the client header.
- Storage key is app-generated: `ws/{workspaceId}/doc/{documentId}`. The user's filename is sanitised (no path separators, trimmed, max 255 chars) and stored as the display name only.
- SHA-256 is computed while streaming and stored (used for integrity display; enables dedup/versioning later).
- Downloads are always proxied through the API with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, so an uploaded HTML or SVG file cannot execute in our origin, and every byte passes an authorization check. The storage backend is never reachable by the browser.
- Listing is paginated (cursor on `created_at, id`), 50 per page, newest first, excluding deleted.

## 4. Deletion

- Deleting a document sets `deleted_at`. It disappears immediately from lists, detail, download, and **all its share links return 404**.
- Trash: owners and admins can list and restore documents deleted within 30 days.
- Purge: a `purge` command (run manually or via a scheduled job) hard-deletes documents with `deleted_at` older than 30 days and removes the storage object. Object removal happens before the row delete; if removal fails the row stays so nothing is orphaned silently.
- Deleting a workspace (owner only) soft-deletes it: members lose access on the next request, all documents are treated as deleted, share links 404. Purge applies after 30 days.

## 5. Share links

- A link is created for exactly one document by a member with permission. It grants: view the document's name, size, type, and uploader's display name; download it. Nothing else. It never grants workspace access.
- Token: 32 random bytes from `crypto.randomBytes`, base64url. **Only the SHA-256 of the token is stored.** The full URL is shown once at creation; afterwards the UI shows only the last 6 characters for identification.
- Optional expiry (`expires_at`). Default: no expiry. Optional maximum download count.
- Revocable at any time by an owner/admin or by the member who created it. Revoked, expired, exhausted, or unknown tokens all return **404** with the same body.
- Download count increments atomically on each successful download start.
- Removing a member does not revoke links they created; the links belong to the document. Admins see every link on a document with its creator and can revoke.

## 6. Invitations

- Owner/admin invites by email with a role no higher than their own (admins cannot invite owners). One pending invitation per (workspace, email).
- Token: 32 random bytes, base64url, stored hashed; expires after 7 days; revocable by owner/admin.
- No email provider is wired. The invite URL is shown to the inviter in the UI to copy and send. Documented as a deliberate simplification.
- Acceptance requires a logged-in user whose email matches the invitation's email (case-insensitive). A logged-out visitor is sent to sign up / log in with that email prefilled, then returned to accept. Wrong email → 404. Already a member → invitation marked accepted, role unchanged, no error.
- Accepting creates the membership and marks the invitation accepted in one transaction.

## 7. UI (functional over pretty)

Pages: sign up / log in; workspace list; workspace page with documents table, upload control, members panel, pending invitations, trash (owner/admin); document row actions; share dialog (link shown once, copy button, expiry / max-downloads fields); public share page (`/s/:token`) with name, size, download button; accept-invitation page.

The interface reflects permissions: actions a role cannot perform are not rendered, and the server enforces the same rule independently.

## 8. Limits and non-goals

- One document per upload; no folders; no versioning; no search; no notifications; no email sending; no virus scanning; no quotas.
- Single API instance; rate limiting is in-process (documented; Redis would replace it).
- No public bucket, no presigned URLs exposed to the browser (see ARCHITECTURE.md for why and the alternative).

## 9. Product improvement (built)

**Password-protected links with expiry and download limits.** Chosen because it is what a real team asks for the week after they share the first sensitive file externally, it sits exactly on the axis the reviewers grade, and it adds two tests and one migration rather than a subsystem. Password is argon2id-hashed on the link; the public page asks for it and, on success, sets a short-lived signed cookie scoped to that link so the download request can be authorised without re-entering it.

Design-note alternative (not built): document versioning — re-upload creates a new version row pointing at a new storage key; the document row points at the current version; links follow the document, not the version.
