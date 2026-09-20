# How we read this assignment

Written before any code. This is the reasoning behind every other file in this folder.

## What they say they want vs. what they will actually grade

The brief asks for upload, share-by-link, and workspaces with invitations. An agent can produce that in an hour, and the reviewers know it. Section 5 of the brief is the real rubric, and it lines up with what hiring managers say in public about take-homes:

1. **Problem framing.** The brief is "intentionally incomplete." Every gap is a question they already have an answer to; they want to see whether you notice the gap, make a defensible product call, and write it down. The README's "Assumptions and decisions" section is called out as the most important part. Reviewers repeatedly say the same: a submission that only builds what was literally written loses to one that scoped deliberately and explained what it left out.
2. **Security and authorization.** They name three checks: can one user reach another's files, are share links guessable, is the storage backend exposed. These are the exact failures found in real pentests of file-sharing apps (BOLA/IDOR on document IDs, presigned URLs that authenticate but don't authorize, MinIO with default credentials reachable from the host). Each one gets a test, not just a sentence.
3. **Data modelling that handles deletion and membership cleanly.** They will look at what happens to documents when a member is removed, what a share link does when its document is deleted, and whether a removed member's session still works.
4. **Layering.** Storage and auth must not live in request handlers. This is checked in the code walkthrough by asking "where is the ownership check for download?" and expecting one answer.
5. **Agent direction.** They want evidence that a human made the decisions and the agent carried them out: bounded prompts, corrections, a rejected output, a test that caught a mistake. Companies that grade agent-assisted take-homes say the strongest signal is a candidate who set the design before the agent sprinted, verified by running tests rather than trusting the model, and can explain every line.

They explicitly do **not** grade visual design, cloud deployment, or coverage percentage. So no time goes there.

## What gets people rejected (from reviewer write-ups)

- Doesn't run from a clean clone. Missing env vars, migrations not applied on `docker-compose up`, a dependency installed globally on the author's machine.
- Any get/list/delete by ID without a membership check. Client-supplied storage keys.
- Short or plaintext share tokens, no expiry, no revocation. MinIO reachable with `minioadmin`.
- Over-building past the brief while core paths are half-done. One hiring manager scored an 8-hour resubmission lower than the same person's 3-hour version.
- A README that reads like model output: no decisions, no rough edges, nothing the author would defend live.

## What impresses

- Explicit assumptions, an out-of-scope list, and prioritised next steps.
- Authorization tests that attempt cross-workspace access and assert denial; expired/revoked link tests.
- A storage interface with two implementations and one contract test suite run against both.
- An agent log that names concrete misfires: what it got wrong, how a test caught it, what was rejected.
- Logical commits and an honest "weakest part" paragraph.

## Our strategy, in one paragraph

Decide everything first (SPEC.md), design the schema and the layers (ARCHITECTURE.md), then hand the agent one bounded task at a time in plan mode, review the plan before it edits, run the tests ourselves, commit per prompt, and log every correction. Build the three core flows end to end before touching the improvement. Spend the last day on tests aimed at the authorization matrix, the README, and a clean-clone run. The improvement is password-and-expiry on share links because it is small, it sits exactly on the security axis they grade, and it produces two more tests.

## The five product decisions that matter most

These are the gaps they planted. Full detail is in SPEC.md; this is the shape of each call.

- **What a link can do:** view metadata and download one document. Nothing else. A link never grants workspace access. Token shown once, stored hashed, revocable, optional expiry.
- **Who can do what in a workspace:** four roles. Owner (one per workspace), admin, member, viewer. Documents belong to the workspace, not the uploader.
- **Deletion:** soft delete with a 30-day trash. A deleted document disappears everywhere immediately, including its share links (404). Purge removes the object and the row.
- **Invitations for people without an account:** invite by email with a 7-day token; the invite is bound to that email; signing up with the matching email lets you accept. A forwarded invite can't be used by someone else.
- **Removing a member:** their documents stay (workspace-owned). Their access ends on the next request because authorization is checked per request, not per session. Their share links stay valid; admins can see and revoke them.

## Sources we relied on

- Anthropic, "AI-resistant technical evaluations" and the Propel playbook derived from it (what agent-assisted take-homes score).
- OWASP API Security: Broken Object Level Authorization; Multi-Tenant Security Cheat Sheet; File Upload Cheat Sheet; Password Storage Cheat Sheet.
- iVision research on presigned URL authorization failures; Pulse Security on "unguessable URL" leakage.
- BigPanda and Block engineering posts on what reviewers look for and how to structure the README.
- Express 5 release notes (async error handling); Drizzle Kit migration docs; MinIO issues on presigned-URL hostnames in Docker; Pilcrow's post-Lucia session guidance.
- Claude Code docs: memory (CLAUDE.md), permission modes, sub-agents, hooks, skills, MCP.
