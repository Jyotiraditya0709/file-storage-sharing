#!/usr/bin/env bash
# UserPromptSubmit: append every prompt to docs/agent-log.jsonl (raw material for the README's agent section).
mkdir -p "$CLAUDE_PROJECT_DIR/docs"
jq -c '{ts: (now|todate), type: "prompt", text: .prompt}' >> "$CLAUDE_PROJECT_DIR/docs/agent-log.jsonl"
exit 0
