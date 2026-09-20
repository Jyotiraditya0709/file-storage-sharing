---
name: review-security
description: Security review of the current branch diff against the take-home rubric. Manual only.
disable-model-invocation: true
---

Use the `security-reviewer` agent on this diff. Then summarise its findings for me as: must-fix / should-fix / rejected-with-reason.

Diff:
!`git diff main --stat`

!`git diff main -- server/`
