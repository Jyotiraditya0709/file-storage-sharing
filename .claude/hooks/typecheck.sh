#!/usr/bin/env bash
# PostToolUse (async): typecheck after every edit; surface errors to Claude on the next turn.
cd "$CLAUDE_PROJECT_DIR" || exit 0
out=$(pnpm -s typecheck 2>&1)
if [ $? -ne 0 ]; then
  jq -n --arg out "$(printf '%s' "$out" | tail -n 40)" \
    '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":("Typecheck failed:\n" + $out)}}'
fi
exit 0
