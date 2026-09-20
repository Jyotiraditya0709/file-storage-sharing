---
name: decision-log
description: Append a dated decision entry to docs/DECISIONS.md. Usage: /decision-log <title> — <decision> — <why> — <alternative rejected>
disable-model-invocation: true
---

Append to `docs/DECISIONS.md` a new entry in this exact shape, using today's date and the text in $ARGUMENTS split on " — ":

```
## YYYY-MM-DD — <title>
**Decision:** <decision>
**Why:** <why>
**Rejected:** <alternative>
```

Do not rewrite earlier entries. Show me the appended entry.
