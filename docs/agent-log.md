# Agent log (hand-written)

The raw prompt/response stream is in `agent-log.jsonl` (written by hooks). This file is the human record: what I asked, what it did wrong, how I caught it, what I rejected. Two lines per entry is enough. Three of these become the README.

Format:

```
### <date> · <task from PLAN.md>
Asked: …
It did: …
Caught by: (test name | review | reading the diff | running it)
Fix: …
```

<!-- Entries start below. Write them the moment they happen, not at the end. -->
