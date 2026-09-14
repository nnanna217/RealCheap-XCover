# Prompt Log

Every prompt given to the coding agent, verbatim, in order. Pairs with `BUILD_LOG.md` (what happened) — this file is only *what was asked*. Entry numbers match between the two files.

Stages are separated by `==================` lines. Entry numbers stay unique across stages (P-numbers for the build, T-numbers for testing) and match `BUILD_LOG.md`.

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
