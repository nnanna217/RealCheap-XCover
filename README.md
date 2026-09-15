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

## Red team — what a production review would flag

A self-review done before submission, from the standpoint of someone who has seen partner integrations fail. Five findings were cheap enough to fix immediately; the rest are the honest next steps.

### Fixed before submission

| Finding | Why it matters | Fix |
|---|---|---|
| Webhook replay: the signature covers only the `Date` header, and nothing checked freshness | A captured valid webhook could be replayed indefinitely | Reject if `Date` is outside ±5 min; verify `keyId` matches the registered key |
| Demo endpoints were reachable in live mode | `/api/demo/webhook` signs with the real secret — a forged-event vector; `simulate` / `force_xcover` could reach XCover | All demo paths return 404 / are ignored unless `XCOVER_MODE=fixture` |
| Stored XSS via policyholder name | Result and OMS pages interpolated shopper input unescaped; the OMS is viewed by staff | Escaped at render |
| `security_token` shown in the Integration log | A real token is a bearer for customer-facing policy links | Scrubbed from every JSON response; the ledger keeps it |
| 8 s fail-open budget on create-offer | A checkout that waits 8 s for the insurance call isn't failing open, it's slow | 3 s for create-offer (`XCOVER_OFFER_TIMEOUT_MS`); confirm/cancel keep 8 s |

### Next steps — in the order I'd do them

1. **Persist the ledger and make it the unique index it stands in for.** The `Map` is per-process: a restart loses orders, and two concurrent confirms can both pass the ledger check (XCover's 423/409 is the only thing stopping a double issue today). A single `orders` table with `transaction_id` unique and a conditional update on `booking_id IS NULL` replaces both the Map and the race.
2. **Automatic retry of a pending confirm.** A paid-but-unconfirmed plan is a liability (`confirm_error`). It's visible and manually retryable; it should also be retried on a schedule with backoff, and alerted on after N failures.
3. **Cancel is not idempotent on XCover's side.** If a cancel call times out *after* XCover processed it, the retry gets a 422 ("already cancelled") and the refund is never written. Treat that 422 as success and proceed to the refund.
4. **Authentication on the OMS and order endpoints.** `/api/orders` lists every order (policyholder email, phone) and `/refund` can be called by anyone who knows an order ref. These are internal OMS operations; in production they sit behind staff auth, and order refs should not be the only key.
5. **Webhook dedup is by status, not by content.** Two `BOOKING_UPDATED` events with the same statuses but different prices would be deduped. Ask Cover Genius for an event id or sequence number on the payload; until then, include a content hash in the key.
6. **Reconciliation job.** Duplicate issuance throws no errors — everything returns 200/201. A nightly diff of the ledger against XCover bookings (by `partner_transaction_id`), plus the `UNMATCHED-*` queue, is the only thing that catches what the guards miss.
7. **Multiple products per offer** (assumption A9): render a choice, confirm the chosen quote ids.
8. **Live capture replaces fixtures.** Every fixture is a placeholder shaped from the spec; the first live 200 for each endpoint should be saved and become the fixture, so fixture mode stops being a model of the API and becomes a recording of it.
9. **Regional price lists.** Product prices are USD list prices; a real RealCheap has per-storefront pricing, which is why the checkout shows two currencies rather than converting.
10. **Smaller things:** validate `country`/`currency` server-side against the seven supported markets; index orders by booking id instead of scanning; stop logging full webhook bodies (PII) to the console; rate-limit `/api/offers`.

## Origin

Scaffolded from a prior Adyen payments checkout demo. Embedded insurance has the same integration shape as embedded payments — server-side secret, quote-or-session, webhook.
