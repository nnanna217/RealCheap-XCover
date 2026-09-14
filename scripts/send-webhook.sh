#!/usr/bin/env bash
# Simulate an inbound XCover webhook, signed exactly as XCover signs (HMAC over the Date header with the
# registered secret), delivered to this server's /api/webhooks. Reads .env for the secret and port.
#
#   scripts/send-webhook.sh <ORDER_REF> [BOOKING_CREATED|BOOKING_UPDATED|BOOKING_CANCELLED] [--tamper] [--no-txn]
#
#   --tamper   sign with the wrong secret → expect 401
#   --no-txn   send partner_transaction_id: null (as the docs' examples do) → routing falls back to booking id
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
TXN="${1:?order ref (RC-…) required}"; EVENT="${2:-BOOKING_CANCELLED}"; TAMPER=false; NOTXN=false
for a in "${@:3}"; do [ "$a" = "--tamper" ] && TAMPER=true; [ "$a" = "--no-txn" ] && NOTXN=true; done
curl -sS -X POST "http://localhost:${PORT:-3000}/api/demo/webhook" -H 'Content-Type: application/json' \
  -d "{\"transaction_id\":\"$TXN\",\"event\":\"$EVENT\",\"tamper\":$TAMPER,\"omit_partner_txn\":$NOTXN}" | node -e '
const r=JSON.parse(require("fs").readFileSync(0,"utf8"));
if (r.error) { console.log("ERROR:", r.error); process.exit(1); }
console.log(`sent    ${r.sent.body.event} for booking ${r.sent.body.payload.id} (partner_transaction_id=${r.sent.body.payload.partner_transaction_id})`);
console.log(`handler HTTP ${r.received.status} →`, JSON.stringify(r.received.body));
console.log(`order   status=${r.order.status} booking=${r.order.booking && r.order.booking.status}${r.order.refund_due ? " refund_due="+JSON.stringify(r.order.refund_due) : ""}`);'
