# Prompt Log

Every prompt given to the coding agent, verbatim, in order. Pairs with `BUILD_LOG.md` (what happened) — this file is only *what was asked*. Entry numbers match between the two files.

Stages are separated by `==================` lines. Entry numbers stay unique across stages (P-numbers for the build, T-numbers for testing) and match `BUILD_LOG.md`.

## Plan → prompts

The build was planned as seven goal-driven steps (each with a verify criterion) before any prompt was written, plus a second block for the brief's six technical considerations. This is how the plan mapped onto what was actually prompted, in order, with the deviations.

| Planned step | Verify criterion (as planned) | Became | Deviation |
|---|---|---|---|
| 1. Strip Adyen | `npm start` boots, `/` serves, no `adyen` in `git grep` | **P1** | Webhook handler couldn't be kept literally (its validator *was* Adyen) — replaced with XCover's scheme |
| 2. Catalog | `index.html` lists three SKUs; `product.html?sku=` shows one | **P2** | — |
| 3. Offer proxy, fixture mode | `curl -X POST /api/offers` returns the fixture with `mode: 'fixture'` | **P3** | Verify as written returns 400 (no body); needs a `sku` |
| 4. Checkout page | Changing quantity or country re-fetches | **P4**, then **P4b · P5b · P5c · P5d** | Plan referenced `product_rules[0].initial_state` — not in the retail response; four layout follow-ups were unplanned |
| 5. Payload panel | Badge matches `XCOVER_MODE` | **P5** | Built as a log of every call, not a single panel |
| 6. Decline path (opt-out) | Panel shows the opt-out request | **P9** | Deferred behind confirm so the ledger existed first |
| 7. Fail-open | Unreachable host in live mode → checkout still completes | **P6** (ineligible vs. unavailable messaging) + **T11** (3 s budget) | Split: the message half landed with eligibility, the timeout half in the red team |
| Block 2 — #1 eligibility | Sleeve → no offer, handled gracefully | **P6** | Only built after the candidate caught it was still quoting (P3 had deferred it) |
| Block 2 — #2 confirm-offer, idempotent | Same cart confirmed twice → one policy | **P7** | Preceded by a status check: only idempotency rule 1 existed |
| Block 2 — #4 cancellation | Refund → `bookings/{id}/cancel`, no duplicate compensation | **P8** | Cancel has no idempotency key in the docs — ledger is the sole guard (rule 5 amended) |
| Block 2 — #6 webhook | Signed inbound event updates the order | **P10** | Plan assumed a claim-status event; the Offers API documents `BOOKING_*` only |
| Orders view (planned as "P8" in TODO.md) | One row per order, refund home, idempotency visible | **P11** | Numbered P11 because P8 had been taken by cancel |
| Block 2 — #3 quantity, #5 currency | — | **P4** | Landed inside the checkout step rather than as separate steps |

Not in the plan at all, prompted as they surfaced: the retail-schema correction, the idempotency-rules finding, the schema-identifier decision, and all of Stage 2 (testing, T1–T11).

==================
# Stage 1 — Build prompts (2026-09-12 → 2026-09-13)
==================

## P1 — 2026-09-13 — Strip Adyen

> Remove @adyen/api-library and the Drop-in session flow from server.js and public/js/checkout.js. Keep the Express setup, static serving, and the /api/webhooks HMAC handler. Verify: npm start boots, / serves, no adyen string remains in git grep.
>
> Note — even though I am deciding to strip Adyen for now, if I have time I would re-add it.

## P2 — 2026-09-13 — Catalog

> Replace the products with three RealCheap SKUs in a products.js module: 2 unbranded laptops at $349 and $549, 1 $4 laptop sleeve. Each has sku, name, category, price, image. Verify: index.html lists all three. Also, let product.html?sku= navigate to the respective product.

## P3 — 2026-09-13 — Offer proxy, fixture mode

> Add POST /api/offers that builds an XCover create-offer request from the cart (customer{currency, language, country}, context{…}, partner{transaction_id}) and, when XCOVER_MODE=fixture, returns fixtures/offer-response.json. When XCOVER_MODE=live, POST to ${XCOVER_BASE_URL}/${XCOVER_PARTNER_CODE}/offers/ with headers from lib/xcover-auth.js. Verify: curl -X POST localhost:3000/api/offers returns the fixture with mode: 'fixture' in the envelope.

## P4 — 2026-09-13 — Checkout page

> Proceed with P4. *(From the plan: on checkout, show quantity and a country/currency selector (US, CA, GB, IT, FR, ES, DE), call `/api/offers`, render the offer's content, price and PDS link; buttons use `content.positive_cta` / `negative_cta`. Verify: changing quantity or country re-fetches. Plus CLAUDE.md → Idempotency rule 1: one `transaction_id` per cart, reused across re-quotes and reloads.)*

## P4b — 2026-09-13 — Checkout explainability

> I want to edit the Checkout page to ensure more explainability. Make the Order summary larger — let it take 3/4 of the page, and the protection plan 1/4. Adjust the text font and buttons to suit this. Include a badge "Recommended" in the protection plan section. Create a table with the different line items (product and premiums, qty and price) to give the user a one-look view of how the prices stack up.

## P5 — 2026-09-13 — Payload panel

> Proceed with P5 — Payload panel. *(From the plan: below the checkout, a collapsible panel showing the exact request sent and response received as pretty JSON, with `Authorization` / `X-Api-Key` redacted to `***`, and a badge reading `fixture` or `live`. Verify: the badge matches `XCOVER_MODE`.)*

## P5b — 2026-09-13 — Equal-height columns

> Modify the front end again. I want the base of the Order Summary and the Protection Plan to always be the same, so that they are both in the same row.

## P5c — 2026-09-13 — 60/40 columns

> Modify the frontend again. Instead of 75%–25% for the Order Summary to Protection Plan, do 60%–40% instead.

## P5d — 2026-09-13 — Offer buttons and badge

> The Yes and No buttons are not aligned — make both adjust to the same row, and make it responsive. The Recommended badge is taking real estate that pushes the screen down — make it exist on the border of the Protection Plan layout.

## P6 — 2026-09-13 — Eligibility (consideration #1)

> It seems #1 SKU / category eligibility has not been done correctly or built. Reverify the sleeve SKU → no offer. It seems this was not handled gracefully, as this product item still generates a quote.

## P7 — 2026-09-13 — Confirm + ledger (idempotency rules 2–4)

> Confirm if the idempotency and transaction id UUID v5 generation rule was implemented. → Only rule 1 was. → Yes, proceed with confirm + ledger.

## P8 — 2026-09-13 — Cancel path (consideration #4, idempotency rule 5)

> Yes, proceed with cancel i.e. the Cancel path.

## P9 — 2026-09-13 — Opt-out on decline

> Proceed with opt-out on decline.

## P10 — 2026-09-13 — BOOKING_* webhooks

> Build out the BOOKING_* webhooks logic. Build out the routing of BOOKING_CREATED / BOOKING_CANCELLED by partner_transaction_id into the ledger. Also build a way to simulate an inbound event, and document a step-by-step approach to do this.

## P11 — 2026-09-13 — Orders view (P8 in the plan)

> Proceed with the Orders view (`orders.html` + in-memory store) — a Map and a table. The brief's tech stack is a proprietary OMS, and considerations #4 and #6 currently have nowhere to appear except server logs. One page listing each order with its line items (product line, protection-plan line carrying the XCover offer / quote / booking ids) and a status that moves: offer created → confirmed → policy active → cancelled / claim status from the webhook. Home for the "Refund order" button. Also where idempotency becomes visible: a Map keyed by partner.transaction_id, so a re-sent confirm returns the existing order rather than issuing a second policy.

==================
# Stage 2 — Testing prompts (from 2026-09-14)
==================

Prompts the candidate gives after exercising the whole system end to end. Each is logged verbatim as `T<n>`, with the finding that prompted it, and answered in `BUILD_LOG.md` under the same number.

## T1 — 2026-09-14 — Test Case 1a: SKU / category eligibility (sleeve)

**Findings reported:** ledger empty on start — PASS · ineligible sleeve shows "XCover did not return a plan for this product" — PASS · fixture tag — PASS · panel shows request and HTTP 422 `validation_error` — PASS · **request body does not match the documented payload format** (product-retail create-offer page) — FAIL · response payload partially matches — PARTIAL · OMS shows the order with correct transaction id, Refund greyed out, XCover ids blank — PASS.

> Ground the response payload using the error-versioning page. There seem to be separate 422 structures for Confirm Offer (`booking_quotes_unsuccessful`) and Create Offer (`offer_quote_generation_failed`). Explain which 422 approach you took and which best matches this eligibility case, then add it as an assumption.

## T2 — 2026-09-14 — Test Case 1b-i: offer generation (laptop, qty, country)

**Findings reported:** laptop qty 1 → plan shown with description, price, policies, CTAs — PASS; OMS shows Offer created, offer + quote ids, booking blank — PASS · qty 2 → plan, quantity and line items update; OMS quantity/amount correct; same order ref — PASS; **one line item, amount and quantity change in the UI** — flagged (\*\*\*) · **Germany → one line item, currency remains USD; if "three quotes in the log, same order ref" was the expectation — FAIL** · Continue greyed out until a decision — PASS · **unsure whether offer/quote ids are the same across quantity changes — the ids flicker but are masked.**

## T3 — 2026-09-14 — Test Case 1b-ii: decline → opt-out

**Findings reported:** payment succeeded with the premium at 0.00 in the Order Summary — PASS · **OMS flickered between "Protection Plan — declined" and "— undecided"** — FAIL, fix · Integration log (result page) shows the opt-out call: `POST …/offers/{id}/opt_out/` → HTTP 204 No Content, request had no body — observed.

## T4 — 2026-09-14 — Test Case 2: accept → pay → confirm

> Pass.

## T5 — 2026-09-14 — Test Case 2b: retry confirm

> Pass. Ground this using the Confirm Offer guide. The confirm returned HTTP 200 — based on the documentation, shouldn't a conflict return HTTP 409 instead? The request body seems different from what is described; reconfirm the request and response fields expected.

## T6 — 2026-09-14 — Test Case 2 revisited: confirm not called after payment

> Something I missed in Test Case 2: after collection of payment, the Confirm endpoint was not called, and it does not show in the integration log either. Also, in the Confirm Offer guide, what does "You must make a request to the Confirm Offer endpoint to provision the product and distribute confirmation to the customer" mean?

## T7 — 2026-09-14 — Test Case 2 retest + 2b

> Retested Test Case 2 after restart: on payment the confirm endpoint now runs and shows in the Integration log — PASS. Noticed the response's `policyholder` differs from the request's; assume that's because the response comes from the fixture — confirm. Test Case 2b passes on both the ledger and the bypass calls.

## T8 — 2026-09-14 — Test Case 3: webhooks

> BOOKING_CANCELLED, both boxes unchecked → routed via partner_transaction_id, outcome applied. Bad signature → signature mismatch, HTTP 401. Null partner_transaction_id only → signature passed, outcome duplicate, "same event already applied; acknowledged, not re-applied". Does the duplicate occur because of the routing done via the booking id? I believe yes.

## T9 — 2026-09-14 — Test Case 4: refund

> On the result page a fixed US-dollar amount is used for the premium refund instead of the GBP equivalent that was paid: "Refunded $747.99 — product US$698.00 + premium US$49.99". Demo: re-send the same refund — PASS.

## T10 — 2026-09-14 — Test Case 5: restart; Test Case 4 retest

> Test Case 5 (restart → order gone) — PASS. Test Case 4 (refund, after the T9 fix) — works as well.

## T11 — 2026-09-14 — Red team

> Red team the solution and highlight fixes or considerations to improve further. Synthesize this to next steps or future improvements in the README.

## T12 — 2026-09-16 — Live API (VPN)

> Staging is reachable with the VPN on. Consolidate the other chat's findings here, make any corrections, and test the live credentials. *(Other session's findings pasted: auth works; schema default `cse-interview-retail`; two plans; superset response; real copy; 3-year cheaper than 2-year; ~47% premium; VPN resolver broken; `products[0]` only; sub-heading "N/A".)*

## T13 — 2026-09-16 — Decline → opt-out timing (fixture mode)

> "No thanks" doesn't seem to call the opt-out endpoint — I didn't see an opt-out call in the Integration log when I clicked it. *(cites the retail Opt-out Offer page)*
