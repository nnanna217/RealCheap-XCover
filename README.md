# RealCheap × XCover — protection-plan checkout prototype

Mock RealCheap checkout with an embedded XCover (Cover Genius) protection-plan offer against the XCover staging API. Built for the Cover Genius Senior Client Solutions Engineer case study.

## Run locally

```bash
cp .env.example .env
npm install
npm start                # http://localhost:3000
```

`npm start` does not watch for file changes — restart it after pulling.

**No credentials needed to run it.** `XCOVER_MODE` defaults to `fixture`: every XCover call is built and signed exactly as it would be, but the response comes from `fixtures/offer-response.json` (hand-written from the retail Offers API schema) and the page labels it `fixture`.

To hit the staging API, set in `.env`:

```
XCOVER_MODE=live
XCOVER_API_KEY=…            # from Cover Genius
XCOVER_API_SECRET=…
XCOVER_SCHEMA=…             # retail offer schema identifier, from the CSE
```

The page then labels responses `live`. Nothing else changes — the request shape, the signing, and the UI are identical in both modes.

Manual signed calls: `scripts/xcover-curl.sh POST offers/ '<json>'` (reads `.env`).

## Layout

- `server.js` — Express: serves `public/`, proxies XCover calls (secrets stay server-side), receives XCover webhooks
- `lib/xcover-auth.js` — request signing (HMAC-SHA512 over the `Date` header, per the XCover docs) and inbound webhook verification
- `lib/xcover-client.js` — one `call()` for every XCover endpoint; fixture/live switch, timeout, and the request/response envelope the UI shows (secrets redacted)
- `lib/idempotency.js` — derived `x-idempotency-key` (UUID v5 of the natural key) for confirm / cancel
- `lib/orders.js` — the in-memory order ledger keyed by `transaction_id`; every XCover call and webhook is appended to the order's history
- `lib/webhooks.js` — inbound `BOOKING_*` routing, dedup, ordering guard
- `scripts/send-webhook.sh` — simulate a signed inbound webhook for an order
- `public/` — catalog (`index.html`), product, checkout, result pages, and `orders.html` (the OMS view of the ledger: one row per order, plan as a line item, status lifecycle, attempts vs. XCover calls, Refund / re-send-confirm actions); plain HTML/JS, no build step
- `public/js/products.js` — the three-SKU catalog, shared by browser and server
- `fixtures/` — recorded XCover replies used in fixture mode: offer responses per currency (`offer-response.<CUR>.json`), the documented 422 for an ineligible SKU, confirm (200 / 409 / 423), cancel preview and cancel, opt-out. Structure follows the specs; values are placeholders. In fixture mode the client mints fresh offer/quote ids per call and echoes request ids on confirm/cancel, as the real API does
- `CLAUDE.md` — the guidelines the coding agent worked under, plus the brief's goals, the six technical considerations as verifiable goals, non-goals, invariants, and the idempotency rules
- `PROMPTS.md` — every prompt given to the agent, verbatim, in order
- `BUILD_LOG.md` — what each prompt produced, what was wrong, what was fixed by hand
- `TODO.md` — decisions deliberately deferred, with reasons

## Simulating an inbound XCover webhook (consideration #6)

XCover signs each webhook with a key/secret pair registered through your CSE and retries up to 3× on a non-200. Registering a real listener needs a public URL, so the prototype ships a simulator: it builds the documented `BOOKING_*` payload from the ledger, signs it exactly as XCover would (HMAC over the `Date` header), and posts it to this server's own `/api/webhooks` — the request goes through real verification and routing.

1. `.env.example` already carries a demo key/secret pair; any value works because the simulator signs and the handler verifies with the same one.
2. Create a booking: catalog → laptop → checkout → **Yes, protect my laptop** → Continue → Pay.
3. On the result page, under "Webhooks from XCover", pick an event and click **Demo: simulate this webhook**. Tick **bad signature** for a 401; tick **null partner_transaction_id** (the docs' examples send null) to see routing fall back to the booking id — run that one first on a fresh order to see `applied` rather than `duplicate`.
4. Or from a terminal: `scripts/send-webhook.sh <ORDER_REF> BOOKING_CANCELLED [--tamper] [--no-txn]`.

What the handler does (`lib/webhooks.js`): verify signature → route by `partner_transaction_id`, falling back to booking id → dedup on a key derived from (event, booking, status, quote statuses) — the documented payload has no event id → never regress `CANCELLED` to `CONFIRMED` → apply. `BOOKING_CANCELLED` with no RealCheap refund on record flags a premium refund due (XCover calculates, RealCheap pays). Unknown bookings are acknowledged and parked for reconciliation; undocumented events are stored without guessing. Claim status: no claim event is documented on the Offers API (claims are XClaim's surface) — asked Cover Genius where it arrives.

## Origin

Scaffolded from a prior Adyen payments checkout demo. Embedded insurance has the same integration shape as embedded payments — server-side secret, quote-or-session, webhook.
