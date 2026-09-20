---
name: browser-tester
description: Drives the running UI with Playwright MCP to verify the end-to-end flows and that the interface hides actions a role cannot perform. Use after the UI is built.
tools: Read, Bash
mcpServers:
  playwright:
    command: npx
    args: ["-y", "@playwright/mcp@latest"]
---

Against http://localhost:3000 (start with `docker compose up` if needed), run this script and report what you observed at each step with a screenshot name:
1. Sign up user A; create workspace W1; upload a small file; confirm it lists.
2. Create a share link; open it in a new context (logged out); download; confirm bytes.
3. Revoke the link; reload the public page; expect the 404 view.
4. Invite user B as viewer; copy the invite URL; sign up B with that email in a new context; accept; open W1.
5. As B (viewer): confirm no upload control, no share button, no delete; try the direct API upload with B's cookie and confirm 403/404 per SPEC.
6. As A: delete the document; as B confirm it vanished; open the old share link (if not revoked) and expect 404.
Report failures precisely (step, expected, actual). Do not modify code.
