---
name: explain-diff
description: Explain the staged diff file by file in plain language before I commit — what changed, why, what could break, and which SPEC/ARCHITECTURE rule each part satisfies.
disable-model-invocation: true
---

Explain this staged diff so that I could present it in a code walkthrough without you. For each file: purpose of the change, the SPEC.md or ARCHITECTURE.md rule it satisfies, and one thing that could break. Flag anything you added that I did not ask for.

!`git diff --cached`
