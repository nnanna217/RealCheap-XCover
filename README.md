# RealCheap × XCover — protection-plan checkout prototype

Mock RealCheap checkout with an embedded XCover (Cover Genius) protection-plan offer against the XCover staging API. Built for the Cover Genius Senior Client Solutions Engineer case study.

## Run locally

```bash
cp .env.example .env
npm install
npm start                # http://localhost:3000
```

`npm start` does not watch for file changes — restart it after pulling.

**No credentials needed to run it.** `XCOVER_MODE` defaults to `fixture`: every XCover call is built and signed exactly as it would be, but the response comes from `fixtures/` — scrubbed live captures from XCover staging — and the page labels it `fixture`.

To hit the staging API, set in `.env`:

```
XCOVER_MODE=live
XCOVER_API_KEY=…            # from Cover Genius
XCOVER_API_SECRET=…
XCOVER_SCHEMA=…             # retail offer schema identifier, from the CSE
```

The page then labels responses `live`. Nothing else changes — the request shape, the signing, and the UI are identical in both modes.

**Live status (2026-09-16):** the full path has run against staging — create offer (4 currencies), confirm, replay (409), opt-out (204), cancel preview, cancel, repeat cancel (422). Every fixture is now a scrubbed live capture. Staging needed a VPN from this network and its prices are randomised test rates.

Optional knobs: `RC_ELIGIBLE_CATEGORIES=electronics/` makes RealCheap decline to ask XCover for other categories (staging's `E3CCM` has no eligibility rule of its own and will quote a $4 sleeve); `XCOVER_PAYMENT_PROVIDER=stripe` sends `payment_details` (unset = omitted; payment is simulated here).

Manual signed calls: `scripts/xcover-curl.sh POST offers/ '<json>'` (reads `.env`).

## Layout

**The app** — Express + plain HTML/JS, no build step.

| Path | What it is |
|---|---|
| `server.js` | Routes: serves `public/`, proxies every XCover call (secrets stay server-side), receives XCover webhooks, hosts the order ledger endpoints |
| `public/index.html` → `product.html` → `checkout.html` → `result.html` | The RealCheap storefront: catalog, product, checkout with the protection offer, confirmation |
| `public/orders.html` | The OMS view of the ledger: one row per order, plan as a line item, status lifecycle, attempts vs. XCover calls, Refund / retry actions |
| `public/js/products.js` | The three-SKU catalog, shared by browser and server |
| `public/js/panel.js` | The Integration log shown on checkout and result pages |

**The XCover integration** — `lib/`.

| File | Responsibility |
|---|---|
| `xcover-auth.js` | Request signing (HMAC-SHA512 over the `Date` header, per the docs) and inbound webhook verification (signature, freshness window, `keyId`) |
| `xcover-client.js` | One `call()` for every endpoint: fixture/live switch, per-call timeout, the redacted request/response envelope |
| `idempotency.js` | `x-idempotency-key` derived as UUID v5 of the natural key, for confirm and cancel |
| `orders.js` | The in-memory order ledger keyed by `transaction_id`; every XCover call and webhook is appended to the order's history |
| `webhooks.js` | Inbound `BOOKING_*` routing (by `partner_transaction_id`, fallback booking id), dedup, ordering guard, refund-due flag |
| `fixtures/` | **Live captures from XCover staging (2026-09-16), `security_token` scrubbed**: offers per currency, confirm 200 / 409 (replay) / 422 (new key on a booked offer), cancel preview / cancel / 422 (already cancelled), opt-out 204. Two hand-written exceptions, labelled: the ineligible 422 (staging never produces one) and the 423. In fixture mode the client re-mints ids and echoes request values per call, as the real API does |
| `scripts/` | `xcover-curl.sh` (signed manual call), `send-webhook.sh` (signed simulated webhook) |

**How it was built** — the record for the AI-methodology discussion.

| File | Contents |
|---|---|
| `CLAUDE.md` | The guidelines the agent worked under, the brief's goals, the six considerations as verifiable goals, assumptions A1–A9, invariants, idempotency rules |
| `PROMPTS.md` | Every prompt given to the agent, verbatim, in order — build stage and test stage |
| `BUILD_LOG.md` | What each prompt produced, what was wrong, what was fixed by hand; test findings; a summary table |
| `TODO.md` | Decisions deliberately deferred, with reasons; known limitations |

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
