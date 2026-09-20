#!/usr/bin/env bash
#
# End-to-end smoke test against a running stack. This is the "does it actually
# work" check a reviewer can run in one command:
#
#   docker compose up --build -d && ./scripts/smoke.sh
#
# It uses only curl, sed and mktemp — no jq, no node, no python. Every step
# prints its status; the first mismatch exits non-zero.
#
# Override the target with BASE_URL=http://host:port ./scripts/smoke.sh

set -uo pipefail

BASE="${BASE_URL:-http://localhost:3000}"

JAR_A="$(mktemp)"        # user A, the owner
JAR_B="$(mktemp)"        # user B, invited as a viewer
BODY="$(mktemp)"         # response body of the current request
UPLOAD="$(mktemp)"       # the file we upload
DOWNLOAD="$(mktemp)"     # what the share link gives back
cleanup() { rm -f "$JAR_A" "$JAR_B" "$BODY" "$UPLOAD" "$DOWNLOAD"; }
trap cleanup EXIT

STEP=0
FAILED=0

# Unique per run so the script can be run repeatedly against the same stack.
STAMP="$(date +%s)-$$"
EMAIL_A="smoke-a-${STAMP}@example.com"
EMAIL_B="smoke-b-${STAMP}@example.com"
PASSWORD="correct-horse-battery-staple"
CONTENT="smoke test payload ${STAMP}"

printf '%s\n' "$CONTENT" > "$UPLOAD"

# --- helpers -----------------------------------------------------------------

# check <label> <actual> <expected...>  — passes if actual matches any expected
check() {
  local label="$1" actual="$2"
  shift 2
  STEP=$((STEP + 1))

  local want
  for want in "$@"; do
    if [ "$actual" = "$want" ]; then
      printf '  %2d. %-46s %s\n' "$STEP" "$label" "$actual"
      return 0
    fi
  done

  printf '  %2d. %-46s %s  (expected %s)\n' "$STEP" "$label" "$actual" "$*"
  printf '      response body: %s\n' "$(head -c 400 "$BODY")"
  FAILED=1
  exit 1
}

# First value of a "key":"value" pair.
#
# grep -o, not sed: sed's .* is greedy, so a sed-based extractor returns the
# LAST match on the line. These bodies nest objects that reuse "id"
# (document.uploadedBy.id, link.createdBy.id), so greedy matching silently
# hands back a user id where a document id was wanted.
field() {
  grep -o "\"$1\":\"[^\"]*\"" "$BODY" | head -1 | sed 's/^"[^"]*":"//; s/"$//'
}

# Authenticated request. Sec-Fetch-Site is required by the CSRF middleware on
# every mutating method, exactly as a browser sends it.
api() {
  local method="$1" path="$2" jar="$3"
  shift 3
  curl -sS -o "$BODY" -w '%{http_code}' \
    -X "$method" \
    -H 'Sec-Fetch-Site: same-origin' \
    -b "$jar" -c "$jar" \
    "$@" \
    "${BASE}${path}"
}

# Anonymous request: no cookie jar at all. This is how a share-link recipient
# arrives, and proves the link needs no session.
anon() {
  local method="$1" path="$2"
  shift 2
  curl -sS -o "$BODY" -w '%{http_code}' -X "$method" "$@" "${BASE}${path}"
}

# --- run ---------------------------------------------------------------------

echo "smoke: ${BASE}"
echo

status="$(anon GET /api/health)"
check "health" "$status" "200"

# 1. User A signs up and gets a session cookie.
status="$(api POST /api/auth/signup "$JAR_A" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL_A}\",\"displayName\":\"Smoke A\",\"password\":\"${PASSWORD}\"}")"
check "signup A" "$status" "201"

# 2. A creates a workspace and is its owner.
status="$(api POST /api/workspaces "$JAR_A" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Workspace"}')"
check "create workspace" "$status" "201"
WID="$(field id)"
[ -n "$WID" ] || { echo "could not read workspace id"; exit 1; }

# 3. A uploads a file. The type is sniffed, not taken from this header.
status="$(api POST "/api/workspaces/${WID}/documents" "$JAR_A" \
  -F "file=@${UPLOAD};filename=smoke.txt;type=application/x-lies")"
check "upload document" "$status" "201"
DID="$(field id)"
MIME="$(field mimeType)"
[ -n "$DID" ] || { echo "could not read document id"; exit 1; }
check "mime sniffed, client header ignored" "$MIME" "text/plain"

# 4. A creates a share link. The URL is returned exactly once.
status="$(api POST "/api/workspaces/${WID}/documents/${DID}/links" "$JAR_A" \
  -H 'Content-Type: application/json' \
  -d '{}')"
check "create share link" "$status" "201"
LID="$(field id)"
SHARE_URL="$(field url)"
TOKEN="${SHARE_URL##*/s/}"
[ -n "$TOKEN" ] || { echo "could not read share token"; exit 1; }

# 5. Anyone with the link can download it, with no session at all.
status="$(curl -sS -o "$DOWNLOAD" -w '%{http_code}' "${BASE}/api/s/${TOKEN}/download")"
check "download via link, no cookies" "$status" "200"

if cmp -s "$UPLOAD" "$DOWNLOAD"; then
  check "downloaded bytes match upload" "identical" "identical"
else
  check "downloaded bytes match upload" "differ" "identical"
fi

# 6. A revokes the link.
status="$(api DELETE "/api/workspaces/${WID}/links/${LID}" "$JAR_A")"
check "revoke link" "$status" "204"

# 7. The revoked link is indistinguishable from one that never existed.
status="$(anon GET "/api/s/${TOKEN}/download")"
check "revoked link is 404" "$status" "404"

status="$(anon GET "/api/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/download")"
check "unknown link is also 404" "$status" "404"

# 8. User B signs up.
status="$(api POST /api/auth/signup "$JAR_B" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL_B}\",\"displayName\":\"Smoke B\",\"password\":\"${PASSWORD}\"}")"
check "signup B" "$status" "201"

# Before the invitation, B cannot even tell the workspace exists.
status="$(api GET "/api/workspaces/${WID}" "$JAR_B")"
check "B sees 404 before invite (not 403)" "$status" "404"

# 9. A invites B as a viewer.
status="$(api POST "/api/workspaces/${WID}/invitations" "$JAR_A" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${EMAIL_B}\",\"role\":\"viewer\"}")"
check "invite B as viewer" "$status" "201"
INVITE_URL="$(field inviteUrl)"
INVITE_TOKEN="${INVITE_URL##*/invite/}"
[ -n "$INVITE_TOKEN" ] || { echo "could not read invite token"; exit 1; }

# 10. B accepts.
status="$(api POST "/api/invitations/${INVITE_TOKEN}/accept" "$JAR_B")"
check "B accepts invitation" "$status" "200"

status="$(api GET "/api/workspaces/${WID}" "$JAR_B")"
check "B can now see the workspace" "$status" "200"

# 11. A viewer may read but not write. This is the role table being enforced
#     by the server, not merely hidden in the UI.
status="$(api GET "/api/workspaces/${WID}/documents" "$JAR_B")"
check "B can list documents" "$status" "200"

status="$(api POST "/api/workspaces/${WID}/documents" "$JAR_B" \
  -F "file=@${UPLOAD};filename=nope.txt")"
check "B (viewer) upload is 403, not 404" "$status" "403"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "smoke passed: ${STEP} checks"
  exit 0
fi
exit 1
