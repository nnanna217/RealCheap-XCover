# RealCheap × XCover — protection-plan checkout prototype

Mock RealCheap checkout with an embedded XCover (Cover Genius) protection-plan offer against the XCover staging API. Built for the Cover Genius Senior Client Solutions Engineer case study.

## Run locally

```bash
cp .env.example .env
npm install
npm start                # http://localhost:3000
```

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

## Simulating an inbound XCover webhook (consideration #6)

XCover signs each webhook with the key/secret pair you register through your CSE and retries up to 3 times on a non-200. Registering a real listener needs a public URL, so the prototype ships a simulator that builds the **documented** `BOOKING_*` payload from the ledger, signs it **exactly as XCover would** (HMAC over the `Date` header, secret from `.env`), and delivers it to this server's own `/api/webhooks` — the request genuinely traverses signature verification and routing.

1. Put a shared secret in `.env` (any string — it stands in for the pair you'd register with the CSE):
   ```
   XCOVER_WEBHOOK_KEY=realcheap-demo-key
   XCOVER_WEBHOOK_SECRET=realcheap-demo-webhook-secret
   ```
   and restart `npm start`. Without a secret the handler skips verification (with a warning) and the simulator refuses to run.
2. Create a booking: catalog → laptop → checkout → **Yes, protect my laptop** → Continue → Pay. Note the order ref (`RC-…`) on the result page.
3. **From the result page:** in "Webhooks from XCover", pick an event and click **Demo: simulate this webhook**. The table shows what was received, how it was routed (`partner_transaction_id` or `booking_id`) and the outcome; the integration log below shows the raw event. Tick **bad signature** to see a 401; tick **null partner_transaction_id** (the docs' own examples send null) to see routing fall back to the booking id.
4. **Or from a terminal:**
   ```bash
   scripts/send-webhook.sh RC-XXXXXXXX-XXXXXX BOOKING_CANCELLED
   scripts/send-webhook.sh RC-XXXXXXXX-XXXXXX BOOKING_CREATED --no-txn   # route by booking id
   scripts/send-webhook.sh RC-XXXXXXXX-XXXXXX BOOKING_CANCELLED --tamper  # expect 401
   ```
5. **Or hand-roll one** against `POST /api/webhooks` with headers `Date` (RFC 1123), `X-Api-Key`, and `Authorization: Signature keyId="…",algorithm="hmac-sha256",signature="<urlencoded base64 HMAC of 'date: <Date>'>"` — the body is `{ "event": "BOOKING_CANCELLED", "payload": { "id": "<booking>", "status": "CANCELLED", "partner_transaction_id": "<order ref>", "quotes": [...] } }`.

What the handler does with an event (`lib/webhooks.js`): verify signature → route by `partner_transaction_id`, falling back to booking id → **dedup** on a key derived from (event, booking, status, quote statuses), because the documented payload carries no event id → **never regress** `CANCELLED` to `CONFIRMED` if events arrive out of order → apply. `BOOKING_CANCELLED` with no RealCheap refund on record flags a **premium refund due** (XCover calculates, RealCheap pays — it is never auto-paid). Events for unknown bookings are acknowledged (so XCover stops retrying) and parked for reconciliation; undocumented events are stored on the order without guessing. Always 200 once verified — a non-200 only makes XCover retry, which is right for transient failures, not for "I don't recognise this".

Claim status: the Offers API documents no claim event (claims are XClaim's surface); the handler stores any such event on the order without applying it, pending confirmation from Cover Genius of where claim status actually arrives.

## Layout

- `server.js` — Express: serves `public/`, proxies XCover calls (secrets stay server-side), receives XCover webhooks
- `lib/xcover-auth.js` — request signing (HMAC-SHA512 over the `Date` header, per the XCover docs) and inbound webhook verification
- `lib/xcover-client.js` — one `call()` for every XCover endpoint; fixture/live switch, timeout, and the request/response envelope the UI shows (secrets redacted)
- `lib/idempotency.js` — derived `x-idempotency-key` (UUID v5 of the natural key) for confirm / cancel
- `lib/orders.js` — the in-memory order ledger keyed by `transaction_id`; every XCover call and webhook is appended to the order's history
- `lib/webhooks.js` — inbound `BOOKING_*` routing, dedup, ordering guard
- `scripts/send-webhook.sh` — simulate a signed inbound webhook for an order
- `public/` — catalog (`index.html`), product, checkout, result pages; plain HTML/JS, no build step
- `public/js/products.js` — the three-SKU catalog, shared by browser and server
- `fixtures/` — offer response used in fixture mode
- `CLAUDE.md` — the guidelines the coding agent worked under, plus the brief's goals, the six technical considerations as verifiable goals, non-goals, invariants, and the idempotency rules
- `PROMPTS.md` — every prompt given to the agent, verbatim, in order
- `BUILD_LOG.md` — what each prompt produced, what was wrong, what was fixed by hand
- `TODO.md` — decisions deliberately deferred, with reasons

## Origin

Scaffolded from a prior Adyen payments checkout demo. Embedded insurance has the same integration shape as embedded payments — server-side secret, quote-or-session, webhook.
