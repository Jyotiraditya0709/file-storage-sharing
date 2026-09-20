# Claude Code setup for this take-home

Copy everything in this folder into the root of the new repo, then run the commands below once. This is what makes "agent direction" visible: the rules live in files the reviewer can read, the log is produced automatically, and the human owns the decisions.

## What's here

| File | Purpose |
|---|---|
| `CLAUDE.md` | ~60 lines: commands, layering rules, the "never" list. Loaded every session. |
| `.claude/settings.json` | Plan mode by default; allow/deny list (no `.env` reads, no hand-edits to migrations, no `git push`); plugins; hooks. |
| `.claude/rules/server-security.md`, `web.md` | Path-scoped rules that load only when Claude touches `server/src/**` or `web/src/**`. |
| `.claude/agents/security-reviewer.md` | Read-only; hunts the exact failures the rubric names. |
| `.claude/agents/code-reviewer.md` | Read-only; layering violations and scope creep. |
| `.claude/agents/test-writer.md` | Writes the "embarrassing if broken" tests via supertest + Testcontainers. |
| `.claude/agents/browser-tester.md` | Drives the UI with Playwright MCP (defined inline, so it never bloats the main context). |
| `.claude/skills/review-security` | `/review-security` — runs the reviewer on the branch diff and triages. |
| `.claude/skills/decision-log` | `/decision-log Title — decision — why — rejected` → appends to `docs/DECISIONS.md`. |
| `.claude/skills/explain-diff` | `/explain-diff` — plain-language explanation of the staged diff before every commit. |
| `.claude/hooks/*.sh` | Block human-owned files; typecheck after every edit; log every prompt and response to `docs/agent-log.jsonl`. |

## One-time commands

```bash
chmod +x .claude/hooks/*.sh
git add -A && git commit -m "chore: agent rules, spec, architecture"

# MCP servers worth having (skip GitHub/Postgres/filesystem MCPs — gh, psql and native tools are leaner)
claude mcp add --scope project --transport stdio playwright -- npx -y @playwright/mcp@latest
npx ctx7 setup --claude            # Context7: current docs for Express 5/Drizzle/AWS SDK when Claude needs them

# plugins (run inside a Claude Code session)
/plugin install security-guidance@claude-plugins-official
/plugin install typescript-lsp@claude-plugins-official   # needs: npm i -g typescript-language-server typescript

# start every work session like this
claude --permission-mode plan
```

Add to `.gitignore`: `.env`, `.claude/settings.local.json`, `.claude/worktrees/`, `CLAUDE.local.md`. Keep `docs/agent-log.jsonl` committed — it is evidence.

## Session habits (this is the part they grade)

1. One task from PLAN.md per prompt. Paste the prompt as written; add context, don't add scope.
2. Read the plan Claude proposes. Edit it (`Ctrl+G`) if it drifts from SPEC/ARCHITECTURE. Approve with "manually approve edits" for anything touching auth, storage, or the schema.
3. When it says done: run `pnpm typecheck && pnpm test` yourself. Then `/explain-diff`. Then commit with a message that names the SPEC section.
4. When it does something wrong, don't patch by hand silently. Tell it what's wrong and why, let it fix, then write two lines in `docs/agent-log.md`: what it did, how you caught it. Three of these become the README's agent section.
5. After every feature: `/review-security`. Log rejected findings with the reason.
6. `/rename day1-scaffold` etc. so `claude --resume` works; `/export docs/transcripts/day1.txt` at the end of each day.
7. Never let it `git push`; never let it read `.env`. Both are denied in settings; keep it that way.

## docs/ files to create on day one

`docs/DECISIONS.md` (seed with the five decisions from 00-THINKING.md via `/decision-log`), `docs/agent-log.md` (hand-written corrections), `docs/agent-log.jsonl` (auto), `docs/transcripts/` (exports).
