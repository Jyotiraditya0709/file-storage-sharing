#!/usr/bin/env bash
# PreToolUse hook: block edits to files the human owns. Exit 2 = block, stderr goes back to Claude.
input=$(cat)
path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')
[ -z "$path" ] && exit 0
case "$path" in
  *"/.env"|*"/drizzle/"*.sql|*"/SPEC.md"|*"/ARCHITECTURE.md")
    echo "Blocked: $path is human-owned. Propose the change in chat and I will apply it." >&2
    exit 2 ;;
esac
exit 0
