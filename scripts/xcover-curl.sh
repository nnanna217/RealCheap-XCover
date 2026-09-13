#!/usr/bin/env bash
# Signed curl against the XCover staging API. Reads .env. Usage:
#   scripts/xcover-curl.sh POST offers/ '{"customer":{"language":"en","currency":"USD","country":"US"},"context":{}}'
#   scripts/xcover-curl.sh GET  offers/<offer_id>/
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
METHOD="${1:-POST}"; PATH_="${2:-offers/}"; BODY="${3:-}"
URL="${XCOVER_BASE_URL%/}/${XCOVER_PARTNER_CODE}/${PATH_}"
HEADERS=$(node -e '
  const { xcoverAuthHeaders } = require("./lib/xcover-auth");
  const h = xcoverAuthHeaders(process.env.XCOVER_API_KEY, process.env.XCOVER_API_SECRET);
  process.stdout.write(Object.entries(h).map(([k,v]) => `-H\n${k}: ${v}\n`).join(""));
')
args=(); while IFS= read -r line; do args+=("$line"); done <<< "$HEADERS"
echo ">>> $METHOD $URL" >&2
curl -sS --max-time 20 -w '\nHTTP %{http_code}\n' -X "$METHOD" "$URL" "${args[@]}" \
  -H 'Content-Type: application/json' -H 'X-API-Error-Version: v2' ${BODY:+-d "$BODY"}
