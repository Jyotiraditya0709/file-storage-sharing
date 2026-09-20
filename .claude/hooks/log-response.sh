#!/usr/bin/env bash
# Stop: append Claude's final message for the turn to docs/agent-log.jsonl.
mkdir -p "$CLAUDE_PROJECT_DIR/docs"
jq -c '{ts: (now|todate), type: "response", text: (.last_assistant_message // "")}' >> "$CLAUDE_PROJECT_DIR/docs/agent-log.jsonl"
exit 0
