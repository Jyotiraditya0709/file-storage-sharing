---
paths: ["web/src/**"]
---

When touching web code:
- No secrets or storage endpoints in `VITE_*`. The browser talks only to `/api/*`.
- Render actions based on the role from `/api/auth/me` + workspace membership, but never rely on hiding for security; the server enforces.
- Share and invite URLs are shown once; do not store tokens in localStorage.
- Plain React, fetch wrapper in `web/src/api.ts`, no state library, no UI kit. Functional over pretty.
