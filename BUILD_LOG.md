# Build Log

Chronological record of how this prototype was built with an LLM coding harness (Claude Code), kept as it happened. Each entry: what was asked, what came back, what was wrong, what was changed by hand.

Stages are separated by `==================` lines and mirror `PROMPTS.md`: Stage 1 entries answer P-prompts, Stage 2 entries answer T-prompts.

==================
# Stage 1 — Build (2026-09-12 → 2026-09-13)
==================

## 2026-09-12 — Scaffold

- Copied a prior Adyen payments checkout demo (Express + plain HTML/JS: product → checkout → result, server-side API proxy, HMAC-verified webhook handler) into a fresh repo. No Adyen code removed yet — the first commit is the honest starting point so the Adyen → XCover swap is visible in the diffs.
- Added `CLAUDE.md` (Karpathy-inspired guidelines + project context), `.env.example`, this log.
- Manual: nothing generated yet.

## 2026-09-12 — Auth + first call attempt (manual, no agent)

- **Auth scheme confirmed from the official docs** (partner-docs.covergenius.com → Authentication): sign only the string `date: <RFC 1123 date>` with HMAC-SHA512, base64 (strict, not url-safe), URL-encode, send as `Authorization: Signature keyId="…",algorithm="hmac-sha512",signature="…"` plus `Date` and `X-Api-Key`. The OpenAPI blurb says "e.g. HMAC-SHA256 of method, path and date" — the reference implementations sign **date only, SHA-512**. Followed the code, not the blurb.
- Wrote `lib/xcover-auth.js` by hand, verified byte-for-byte against the docs' Python/Postman examples. `scripts/xcover-curl.sh` wraps it for manual calls.
- **Blocked:** `https://api.xcover-staging.com` accepts the TCP connection, then never answers the TLS Client Hello (curl 28/35, openssl s_client silent). DNS fine (18.204.152.241), port 80 answers 204, prod `api.xcover.com` and the docs host reachable from the same machine. Reproduced with the tool sandbox disabled. Reads as an IP allowlist on staging — public IP at the time: 24.89.124.89. Asked Cover Genius.
- Request shape learned: schema-driven (`schema`, `customer{language,currency,country}`, `context{…partner schema…}`, optional `partner{}`); response carries offer `id`, `session_id`, `products[]` each with quote `id`, finance breakdown, PDS URL; confirm at `offers/{id}/confirm/`, decline at `offers/{id}/opt_out/`, cancel via `bookings/{id}/cancel`. The retail page says sample requests for this vertical come from the CSE — the `E3CCM` schema has to be asked for.

## 2026-09-13 — Decision: build on a fixture while staging is blocked (manual)

- Emailed Cover Genius Sunday morning (IP allowlist + `E3CCM` retail schema). Rather than wait, extracted the create-offer response schema from the Offers API OpenAPI spec and wrote `fixtures/offer-response.json`; the front end is built against that, and `server.js` will swap fixture → live with one env var when the sandbox opens.

## P1 — 2026-09-13 — Strip Adyen (agent: Claude Code)

**Asked:** see `PROMPTS.md` P1.

**Assumptions surfaced before coding:**

1. "No `adyen` in `git grep`" was read as _code and config_ — `README.md`, `BUILD_LOG.md`, `CLAUDE.md` deliberately keep the word because they document the repo's origin. `package-lock.json` regenerated clean.
2. The webhook handler could not be "kept" literally: its HMAC validator _was_ the Adyen library. Kept the route and its shape (verify → process → 200; 500 on error so the sender retries) and replaced the validator with XCover's documented webhook scheme — HMAC over `date: <Date>` with the algorithm named in the `Authorization` header, timing-safe compare. Added as `verifyXcoverWebhook()` in `lib/xcover-auth.js` next to the outbound signer, since it is the same scheme reversed.
3. The verify criterion forced two files beyond the two named: `public/checkout.html` (Adyen CSS/JS tags) and `test-webhook.js` (an Adyen sample-payload script, now orphaned — deleted).

**Removed:** Adyen lazy-loader, `getCheckoutAPI`, `/api/config` (only served Adyen keys), `/api/sessions`, the CORS middleware (its own comment said it existed for Adyen's hosted Drop-in; this app is same-origin), Drop-in mount + tags, `@adyen/api-library` dependency.
**Kept untouched:** `/` redirect and the `product.html` page (catalog is P2), `/api/status`, static serving.
**Added:** `XCOVER_WEBHOOK_KEY` / `XCOVER_WEBHOOK_SECRET` to `.env.example`; `verifyXcoverWebhook`.

**Verified:** `npm start` boots; `GET /` serves (express.static answers with `index.html` before the redirect route — pre-existing behaviour, left alone); `GET /api/status` 200; `POST /api/webhooks` with a correctly signed request → 200 `[accepted]`, with a tampered signature → 401. `git grep -i adyen -- ':!*.md' ':!package-lock.json'` → none; lockfile → 0 matches.

**Manual:** Chose to start from my own Adyen checkout demo and to strip Adyen rather than keep it dormant; kept the option to re-add it later as the PSP behind the Pay step. Accepted the three assumptions (webhook verifier swapped to XCover's scheme, two extra files touched, CORS shim removed).

**Re-add Adyen later?** Yes, possible: payment collection is Single Payment on RealCheap's side per the XCover payment guide, so Adyen would only ever be the mock PSP behind the "Pay" button. Deliberately out of scope until the protection flow is complete.

## P2 — 2026-09-13 — Catalog (agent: Claude Code)

**Asked:** see `PROMPTS.md` P2.

**Assumptions surfaced before coding:**

1. `products.js` has to serve two consumers — the browser now, and `server.js` in P3 (to build the offer `context` from the SKU). Put it at `public/js/products.js` as a browser global with a two-line CommonJS tail, rather than two copies of the same list.
2. No laptop images exist yet (the candidate will generate them). Shipped three labelled SVG placeholders under `public/images/laptops/<sku>.svg` so nothing renders broken; swapping in PNGs later is a one-field change per product. The makeup image folder was orphaned by the change and removed.
3. The old product page was a six-image carousel hard-wired to the makeup photos. With one image per SKU a carousel is dead weight — replaced with a single image; the carousel CSS is left in place (pre-existing, not mine to prune).
4. `description` was added beyond the five fields asked for — the product page needs body copy and inventing it at render time would be worse.

**Changed:** `index.html` is now the catalog (the old "check server status" demo content is gone); `product.html` renders from `?sku=` and 404s inline on an unknown SKU; **Buy Now hands `sku` and `qty=1` to `checkout.html`** so P4 has what it needs. Categories: `electronics/laptops` ×2, `accessories/bags` — the split eligibility will key on in P3.
**Left alone:** the unreachable `/` → `/product.html` redirect in `server.js` (express.static answers first; pre-existing) and `checkout.html`'s MakeupShop title — both are P4.

**Verified in a browser:** catalog shows three cards with the right prices; clicking the sleeve opens `product.html?sku=RC-SL-004` with its details; Buy Now lands on `checkout.html?sku=RC-SL-004&qty=1`; `?sku=DOES-NOT-EXIST` shows the inline error with a link back. Module loads under Node too (`findProduct` returns the product / `null`).

**Manual:** Specified the SKU mix myself — two unbranded laptops at $349/$549 and a $4 sleeve — so eligibility would be demonstrable, not a checkbox; deferred laptop image generation and accepted SVG placeholders.

## P3 — 2026-09-13 — Offer proxy, fixture mode (agent: Claude Code)

**Asked:** see `PROMPTS.md` P3.

**Assumptions surfaced before coding:**
1. **The verify command as written returns 400, not the fixture.** `curl -X POST localhost:3000/api/offers` sends no body, and the route needs a `sku` to build a request. Defaulting to a demo product silently would hide a real client bug, so the route validates and the verify becomes `curl -X POST localhost:3000/api/offers -H 'Content-Type: application/json' -d '{"sku":"RC-LT-549"}'`.
2. **The client never sends a price.** Body is `{ sku, qty, country, currency, language }`; price and category are looked up server-side from `products.js`. A client-supplied price is the first thing a partner's engineer would flag.
3. **`context` is provisional.** The real field names come from the `E3CCM` offer schema (asked the CSE). Shape carries what any retail rating needs — `items[{sku,name,category,unit_price,quantity}]`, `order_total` — and is labelled PROVISIONAL in the code. Expect to rename fields, not restructure, when the schema arrives.
4. **`partner.transaction_id` is generated per cart** (`RC-…`). It is RealCheap's natural order key — the thing a retry must reuse so a re-sent create/confirm can't double-issue. Nothing enforces that yet; it's the hook for it.
5. **Envelope, not raw response.** `/api/offers` returns `{ mode, ok, status, elapsed_ms, request:{method,url,headers,body}, response, error? }` so the P5 payload panel can show exactly what was sent and received. `Authorization` and `X-Api-Key` are redacted to `***` before the envelope leaves the server. In fixture mode the request (and the signed headers) are still built, so the panel shows the real shape.
6. `XCOVER_MODE` defaults to `fixture` when unset — safe default, live needs credentials. Timeout is `XCOVER_TIMEOUT_MS` (8000 default); a timeout or network error comes back as `ok:false, status:0, error:"…"` with HTTP 502, which is what P7's fail-open will key on.

**Added:** `lib/xcover-client.js` (`call(method, path, body, fixtureFile)` — one function for every XCover endpoint, so confirm / opt-out / cancel reuse it), `POST /api/offers`, `XCOVER_MODE` + `XCOVER_TIMEOUT_MS` in `.env.example`. Node 21's global `fetch` — no HTTP dependency added.

**Verified:** fixture mode → 200, `mode:"fixture"`, request body shows `customer{CA/CAD}`, `context.items[0].quantity:2`, `order_total:1098`, headers redacted, fixture offer id and `$49.99` in the response. Missing sku → 400. **Live mode against the still-blocked staging** → 502 with `error:"timeout after 4000ms"`, `elapsed_ms:4002`, envelope intact — the failure path works before the success path has ever been seen.

**Manual:** Raised two design questions on this step — a relational store for the catalog (decided no: not on the rubric) and an OMS-style orders view (decided yes: it's where #4 and #6 become visible) — both recorded in TODO.md before moving on.

## 2026-09-13 — Correction: fixture and request rebuilt from the RETAIL schema (manual + agent)

Cover Genius replied: the schema is at `partner-docs.covergenius.com/offers/vertical-examples/product-retail/create-offer`, and the staging restriction is on their side, being resolved. Asked the agent to confirm the fixture had been built from that page. **It had not** — it came from the generic Offers API spec embedded in the docs corpus. Diffed the two:

**Request — `context` is no longer provisional.** Retail schema: `purchase_date`, `estimated_shipping_date`, `estimated_delivery_date`, `product{ sku*, title*, quantity*, retail_value*, brand, model, variant, category, category_id, condition, description, wholesale_value, term }`, `warranty{ manufacturer_duration, term, benefit }`. One `product` object per offer — quantity is a field on it (that settles consideration #3's shape). My `items[]/order_total` guess replaced with the real fields; sending the four required plus `category`, `condition`, `description`. **`schema` is required at the top level** in the retail spec; the identifier value is not on the page ("the CSE will provide") — wired as `XCOVER_SCHEMA`, currently `TODO-from-CSE`. Query params worth knowing: `include_content` (default true), `extra_fields=tax,commission,benefits,surcharge`, `exclude_offer_ids`.

**Response — fixture rebuilt.** Retail response has **no** `session_id`, `product_rules`, `content.products[]`, `content.credibility*`, `metadata`, or `tax.breakdown` — all of which the old fixture carried. It **does** have `products[].name`, `products[].details.benefits[]`, `extra_fields.{appliance, benefit_type, partner_commission, retail_ex_tax, retail_inc_tax, tax_rate, taxes, variant, pricing_matrix}`, `files[].{name,url,type}`, `price.total_amount_min/max`, `content.extras`. The offer-level `content` block with `positive_cta` / `negative_cta` / `negative_cta_warning` / `credibility_message` survives — so the "XCover supplies the CTA copy" point stands; the "XCover supplies selection rules via `product_rules`" point **does not** for retail and is withdrawn from the pitch.

**Verified:** fixture parses; `/api/offers` builds the retail-shaped request (`schema`, `customer`, `context.purchase_date`, `context.product{…quantity:2, retail_value:549}`, `partner.transaction_id`) and returns the rebuilt fixture (`products[0].name`, three `benefits`, `content.positive_cta`).

**Manual:** the check was worth asking for — an agent-built fixture against the wrong spec would have surfaced as a broken demo the moment staging opened. Open item: get the schema identifier from the CSE.

## 2026-09-13 — Finding: idempotency was only on cancel, and P3 had the United Capital bug (manual)

Candidate flagged that the scope table put idempotency on the refund/cancel step only, while duplicate *issuance* happens at confirm. Checked the retail confirm-offer spec: `x-idempotency-key` is supported, 409 = cached result (treat as success), 423 = in progress (retry). Then noticed the agent's P3 `/api/offers` mints a fresh `partner.transaction_id` on every call — a reload creates a new order reference, which is precisely the client-generated-key-per-attempt failure that produced the $60K United Capital invoice. Rules written into `CLAUDE.md` → Idempotency (one order ref per cart, key derived by UUID v5 from the natural key, server-side ledger keyed by `transaction_id`, 409/423 handling, cancel under the same rules). P4 fixes the `transaction_id` lifecycle; the ledger lands with confirm.

**Manual:** entirely the candidate's catch. The agent built the endpoint correctly against the spec and still reproduced the exact production bug the design is meant to prevent — the spec says "e.g., UUID", and a UUID is what it reached for.

## 2026-09-13 — Schema identifier: omit rather than guess (manual)

The retail create-offer doc says the CSE provides the identifier *and* that the partner default is used when the field is omitted; its `acme-schema-v1` is an example value, not a real default. Changed `/api/offers` to send `schema` only when `XCOVER_SCHEMA` is set. First live call goes without it; a 422 `offer_validation_schema_required` is the trigger to ask. Removed the question from the email. Webhook finding recorded alongside: the Offers API documents `BOOKING_CREATED/UPDATED/CANCELLED` and `RENEWAL_*` events only — no claim-status event; claims are XClaim's surface. Asking the CSE which webhook carries claim status, and whether a staging listener can be registered.

## P4 — 2026-09-13 — Checkout page (agent: Claude Code)

**Asked:** see `PROMPTS.md` P4.

**Assumptions surfaced before coding:**
1. The plan's "initial state from `product_rules[0].initial_state`" no longer applies — the retail response has no `product_rules` (see the 09-13 correction). The offer starts *undecided*; Continue is disabled until the shopper accepts or declines, and enabled immediately when there is no offer to decide on.
2. Rendered from the retail shape: `content.heading/sub_heading/description/price_unit/positive_cta/negative_cta/negative_cta_warning/credibility_message/disclaimer`, `products[0].name`, `products[0].details.benefits[]`, `finance.price.total_amount_formatted`, `pds_url`. Nothing about the offer is hard-coded in the page.
3. Country drives `customer{country, currency, language}` (US/CA/GB→en, IT→it, FR→fr, ES→es, DE→de). Changing quantity or country re-quotes and **resets the opt-in decision** — a new quote is a new offer and the price may differ.
4. **Idempotency rule 1 implemented.** `/api/offers` now accepts `transaction_id`, validates its shape, mints one only when the cart has none, and returns it in the envelope; the page stores it in `sessionStorage` under `rc.txn.<sku>` and sends it on every call. This fixes the P3 bug.
5. Decline is UI state only in P4; the opt-out API call is P6. Payment and confirm are later steps — Continue is wired but inert, and the page says so.

**Found while verifying, fixed before commit:** the first version formatted RealCheap's USD list price with the selected country's currency symbol — `$549 × 3` displayed as `€1,647.00`. A relabel, not a conversion. Fixed: the product line is always USD (its list currency), the offer line uses the currency XCover returns, and the total only sums when both are USD; otherwise it shows the two amounts side by side rather than inventing an FX rate. That is consideration #5 surfacing as a real design question — settlement per currency — instead of being hidden by a symbol swap.

**Verified in a browser:** offer renders from the fixture with the API-supplied CTAs; accept adds the protection line and enables Continue (`$549 + $49.99 = $598.99`); qty 1→3 re-fetches and resets the decision; country US→DE re-fetches with `customer{de,EUR,DE}`; qty 2 → `$49.99 × 2 = $99.98`; three `POST /api/offers` observed for load/qty/country; **order ref identical across all re-quotes and a full page reload** (`sessionStorage`); server rejects a malformed `transaction_id` and mints a fresh one.

**Manual:** Directed the checkout's shape over four follow-ups: order summary as a line-items table, 60/40 column split, equal-height columns, Recommended badge on the card border, accept/decline on one row. Clicked through the Germany case and saw the currency relabel before it was fixed.

## P4b — 2026-09-13 — Checkout explainability (agent: Claude Code)

**Asked:** see `PROMPTS.md` P4b.

**Changed:** grid is now `3fr 1fr` (summary / offer), collapsing to one column under 768px. The summary's two `span` lines became a proper line-items table — Item (with SKU / "Premium · XCover" sub-label), Qty, Unit price, Line total — with the premium row tinted and a grand-total footer. A declined offer shows as its own row ("Protection Plan — Declined — $0.00") so the shopper sees the decision, not just its absence. The offer column got a "Recommended" pill (survives re-render), smaller type, stacked full-width buttons.
**Decision:** the badge text is hard-coded; the offer copy itself still comes from the response. If XCover ever supplies a badge (`content.extras` exists in the retail schema for this kind of thing), it should replace the literal.

**Verified in a browser:** qty 2 accepted → rows `2 × $549.00 = $1,098.00` and `2 × $49.99 = $99.98`, total `$1,197.98`; declined → declined row, total `$1,098.00`, the API's `negative_cta_warning` shown; badge visible at the top of the offer column; layout holds at 1024px.

**Manual:** My change request — the table and badge were for explainability in the room, so a panelist can read the price stack at a glance.

## P5 — 2026-09-13 — Payload panel (agent: Claude Code)

**Asked:** see `PROMPTS.md` P5.

**Assumptions surfaced before coding:**
1. Built it as an **integration log**, not a single panel: the page makes several XCover calls (load, each re-quote, and later opt-out / confirm / cancel), and a stakeholder validating the integration wants to see all of them, newest first, each collapsible (`<details>`, most recent open). One panel showing only the last call would hide the re-quote on quantity change — which is consideration #3's proof.
2. Redaction stays server-side (P3). The browser never held the secrets, so the panel can't leak what it never had; verified no key/secret substring anywhere in the DOM.
3. Fixture responses are labelled twice — the mode badge, and "(fixture — not from XCover)" on the response heading — per the invariant that a fixture must never pass as live.

**Found while verifying, fixed before commit:**
- The two-column request/response grid overflowed the container (long JSON lines forced the columns wider than the page; the response column was cut off). `min-width: 0` on the grid children.
- **Real bug from P4:** after a *failed* live call the offer column stayed on "Checking protection options…" indefinitely — `render()` skipped `renderOffer()` when there was no offer and the loading text was still present. Replaced the DOM-sniffing with an explicit `state.quoting` flag; `renderOffer()` now always runs. A failed quote resolves to "No protection plan is available" and Continue is enabled — fail-open in effect, though P7 still owes the distinction between "XCover said no" and "XCover was unreachable" and the timeout tuning.

**Verified in a browser:** fixture mode → badge `FIXTURE` (amber), entry `create offer · POST /xcover/partners/E3CCM/offers/ · HTTP 200 · 0 ms · fixture`, request headers show `X-Api-Key: "***"`, `Authorization: "***"`, request body and fixture response side by side, response column inside the panel bounds. Live mode against the still-blocked staging → badge `LIVE` (green), entry shows `error · timeout after 3000ms · 3003 ms`, offer column resolves, Continue enabled.

**Manual:** Asked for the panel per the brief's third must-have; later verified in testing that headers were redacted and the FIXTURE badge shown (T1).

## P5b — 2026-09-13 — Equal-height columns (agent: Claude Code)

**Asked:** see `PROMPTS.md` P5b.
**Changed:** four CSS lines. The order summary had `height: fit-content` from the original template, which opted it out of the grid's default stretch; removed for the checkout grid, and the offer column made a flex column so the offer card fills to the shared bottom edge.
**Verified in a browser:** both columns top 246 / bottom 1201 at 1024px.
**Manual:** My change request.

## P5c — 2026-09-13 — 60/40 columns (agent: Claude Code)

**Asked:** see `PROMPTS.md` P5c. **Changed:** `3fr 1fr` → `3fr 2fr`, one line. **Verified:** measured 60% / 40% at 1024px; both columns still share a bottom edge (942). The offer column's stacked buttons and benefit list now have room; the line-items table wraps the product name at this width, which reads fine.

## P5d — 2026-09-13 — Offer buttons and badge (agent: Claude Code)

**Asked:** see `PROMPTS.md` P5d.
**Changed:** buttons are a single flex row, equal width (`flex: 1 1 0; min-width: 0`), text allowed to wrap inside them; they stack only under 480px. Badge is absolutely positioned straddling the card's top border, so it no longer occupies a line.
**First attempt was wrong:** I kept `white-space: nowrap` on the buttons, and the API's own CTA copy ("No thanks, I'll take the risk") is wider than half the column at 40% — so the row still wrapped. The copy comes from XCover, not from us, so the buttons have to accommodate whatever length it is; letting the text wrap was the fix, not shortening it.
**Verified in a browser:** desktop — same top, same height, 157px each; badge straddles the border; 375px mobile — stacked.

## P6 — 2026-09-13 — Eligibility, consideration #1 (agent: Claude Code)

**Asked:** see `PROMPTS.md` P6. **Candidate's catch:** P3 deferred eligibility to "Block 2" and nothing picked it up — the sleeve quoted a $49.99 plan. Reproduced with curl before touching anything (`RC-SL-004 → 200, products: 1`).

**Design decision — who decides eligibility.** In live mode, XCover. The request goes up for every SKU and XCover's catalog classification answers; this server never filters by category, because that would be RealCheap re-implementing the thing Cover Genius sells. In fixture mode something must stand in for that answer, so the only rule here is *which recorded reply* to return: `offer-response.json` for `electronics/*`, `offer-response-ineligible.json` for everything else. The rule is in one line, commented as a stand-in.

**The ineligible fixture is the documented 422**, copied from the Create Offer guide's error example: `code: offer_quote_generation_failed`, per-product `offer_quote_pricing_error` / "No rate available for the supplied parameters". A fixture may now carry `_status`, and the client honours it (`ok` = status < 400).

**Our own status vs XCover's.** `/api/offers` previously returned 502 whenever `ok` was false — which would have turned an eligibility "no" into a gateway error. Now: XCover answered (any status) → 200 with the envelope; XCover unreachable → 502. The envelope carries XCover's real status.

**Three outcomes on the page, not two.** `noOfferReason` distinguishes *ineligible* (a 4xx answer — "Not available for this item · XCover did not return a plan for this product") from *unavailable* (timeout / network / 5xx — "Protection is temporarily unavailable · You can still complete your purchase without it"). Both enable Continue; the line-items table shows a $0.00 row with the reason. This also closes the message half of P7 (fail-open) — the timeout tuning remains.

**Verified in a browser:** sleeve → integration log `HTTP 422`, offer column "Not available for this item", table row "Protection Plan — Not available for this item — $0.00", total $4.00, Continue enabled. Laptop → offer as before. Live mode against blocked staging → "temporarily unavailable" wording, row "Temporarily unavailable", Continue enabled, log `error · timeout`.

**Manual:** My catch: re-tested the sleeve after P5 and found it still quoted a plan; asked for it to be built properly rather than accepting the deferral.

## P7 — 2026-09-13 — Confirm + ledger, idempotency rules 2–4 (agent: Claude Code)

**Asked:** see `PROMPTS.md` P7. Candidate asked for a status check first; answer was that only rule 1 (transaction_id lifecycle) existed — rules 2–5 all attach to confirm/cancel, which didn't exist yet.

**Built:**
- `lib/idempotency.js` — UUID v5 (SHA-1 over a fixed RealCheap namespace + name, version/variant bits set) with `confirmKey(txn, offer_id, quote_ids)` and `cancelKey(txn, booking_id)`. Same inputs → same key; different order → different key; output validates as v5. **Rule 2.**
- `lib/orders.js` — in-memory `Map` keyed by `transaction_id`, `upsert` with an append-only `history[]` that stores every XCover envelope. Stand-in for a unique index; lost on restart, by design. **Rule 3.**
- `POST /api/orders/:txn/confirm` — looks the order up **before** calling XCover: an existing `booking_id` is returned with `served_from: "ledger"` and no call is made. Otherwise derives the key, sends it as `x-idempotency-key`, and handles the documented replies: **409 → body is the cached original → treated as success; 423 → exponential backoff (500 ms, 1 s), up to 3 attempts.** Neither reaches the shopper as a failure. **Rule 4.** Guards: offer/quotes must match what the ledger quoted (409 from us), policyholder fields required (400), unknown order (404).
- `POST /api/orders/:txn/pay` — **simulated** payment; RealCheap is merchant of record under XCover's Single Payment model, so a real PSP is out of scope and said so on the page. The invariant "confirm only after payment succeeds" is the client-side order of operations in `pay()`.
- Fixtures from the retail Confirm Offer 200 schema (`confirm-response.json`, incl. `coi`, `fnol_link`, `security_token`, `can_be_cancelled`), plus `-409` and `-423` variants with `_status`. A `simulate: "409" | "423"` body field (fixture mode only) selects them so rule 4 can be shown without a real duplicate.
- Checkout: Continue freezes the cart and reveals policyholder fields + Pay; on success it confirms (if protection was accepted) and redirects. Result page renders the ledger entry — line items, payment, booking id, policy, cover period, policyholder, COI/PDS links, **"Make a claim" via `fnol_link`** (XClaim), the idempotency key, and the order's full integration log from `history[]`. A **"Demo: re-send the same confirm"** button re-posts the identical confirm and prints `served_from: ledger … XCover was not called … still one policy` — rule 3 demonstrable in the room.
- `public/js/panel.js` — integration-log renderer shared by checkout and result; shows `x-idempotency-key` in the summary line when present (unredacted on purpose — it is not a secret, it is the proof).

**Verified (curl script + browser):** pay → `paid`, 598.99; confirm #1 → `served_from xcover`, key `6596de52-…` sent as the header, booking `8AMKH-KQ8NR-INS`, status `confirmed`; confirm #2 identical → `served_from ledger`, XCover not called; simulated 409 → `replayed true, treated_as_success true`, booking stored; simulated 423 → attempts `[423, 423, 200]`; wrong `offer_id` → 409; unknown order → 404. Browser: accept → Continue → Pay → result page with booking and both log entries; retry button → ledger answer, log count unchanged (no new XCover call). The candidate's own `sessionStorage` order ref from an earlier session survived a server restart because the quote re-registered it — worth knowing: the ledger is per-process, the order ref is per-browser.

**Not done here:** rule 5 (cancel) and the opt-out call on decline — next.
**Manual:** Before letting the build move on, asked whether the idempotency and UUID v5 rules were actually implemented — only rule 1 was. This step exists because of that check.

## P8 — 2026-09-13 — Cancel path, consideration #4 / rule 5 (agent: Claude Code)

**Asked:** see `PROMPTS.md` P8.

**Read the Cancel Booking guide first.** Two facts shaped the design: (1) *"XCover calculates the refund amount but does not process the payment. The partner must process refunds to the customer"* — so the duplicate-compensation risk in the brief is entirely RealCheap-side; (2) the cancel endpoint documents **no idempotency key** and is **irreversible**, with a `preview: true` step the guide says to always run first. `CLAUDE.md` rule 5 amended to say so: the ledger is the sole guard on cancel.

**Built:** `POST /api/orders/:txn/refund` — RealCheap's return event. Order must have been paid (else 409). If already refunded → `served_from: "ledger"`, no XCover call, no second refund. Otherwise, if a booking exists: `bookings/{id}/cancel` with `preview: true`, then with `preview: false`, both envelopes logged; then **one** refund record — `product_amount + premium_amount` (premium from XCover's `refund.amount`) — written once. A paid order with no plan refunds the product only and never touches XCover. Result page: "Return item & refund" → cancelled state (booking `CANCELLED`, refund breakdown, "One refund, recorded once"); the button becomes "Demo: re-send the same refund" → ledger answer.

**Fixtures:** `cancel-preview.json` / `cancel-response.json` hand-written from the guide's *prose* — that page has no response schema, so field names are the guide's terms arranged plausibly, and the file says so.

**Found while verifying, fixed before commit:** after cancelling, I merged XCover's cancel reply over the stored booking; the cancel reply's slimmer `quotes[]` replaced the confirm reply's, dropping `policy`, and the result page threw. Now the cancellation is overlaid per quote by id; the page is also defensive on `q.policy`.

**Honest wrinkle, not hidden:** with qty 2 the order paid `$1,197.98` but the fixture refunded `$1,147.99` — the fixture's cancel reply carries one quote at $49.99 and a fixture can't recompute. Live, XCover returns the real figure. It also re-opens **assumption 3** (one policy per unit vs. one policy for N units) as a genuine question for the panel — the confirm request sends one quote id regardless of quantity.

**Verified (script + browser):** return → preview 200, cancel 200, refund `$398.99 = 349.00 + 49.99`, status `cancelled`, booking `CANCELLED`; duplicate return → `served_from: ledger`, zero XCover calls, log count unchanged; unpaid order → 409; paid-no-plan → product-only refund, zero XCover calls. History reads `create offer → payment → confirm offer → cancel booking (preview) → cancel booking → refund`.

**Manual:** Asked what consideration #4 actually meant in context before accepting the design; then confirmed the refund/repeat behaviour by clicking through in testing (T9, T10).

## P9 — 2026-09-13 — Opt-out on decline (agent: Claude Code)

**Asked:** see `PROMPTS.md` P9.

**Spec (retail Opt-out Offer):** `POST /offers/{offer_id}/opt_out/`, no body, **204 No Content**. Exists so XCover can track conversion; most integrations skip it.

**Design decision — when is a decline final?** Not on the click: the shopper can flip back to "Yes" before paying. The call fires when the decision is frozen — at Continue to payment, where the cart locks. An abandoned checkout sends nothing (abandonment ≠ decline). Idempotent via the ledger: a repeat is answered without a call; an order with no offer (ineligible) or an already-confirmed offer refuses with 409.

**Verified (script + browser):** opt-out → `204`, status `declined`; repeat → `served_from: ledger`; ineligible order → 409. Browser: decline → Continue → integration log shows `opt out … HTTP 204` beneath the create-offer entry; Pay button reads `$549.00`; table row "Protection Plan — Declined — $0.00". The panel now prints "(no body)" / "(204 No Content)" instead of `null` for body-less calls.

**Manual:** Accepted the decision that a decline is reported when frozen at Continue, not on the click; verified the 204 in testing (T3).

## P10 — 2026-09-13 — BOOKING_* webhooks, consideration #6 (agent: Claude Code)

**Asked:** see `PROMPTS.md` P10.

**Read the documented payloads first** (Webhooks page): `{ event, payload: { id, status, currency, total_price, partner_transaction_id, quotes[] } }` for `BOOKING_CREATED` / `UPDATED` / `CANCELLED`; `BOOKING_CANCELLED` quotes carry `refund_value`. Two things the docs' own examples show that shaped the design: **`partner_transaction_id` is `null` in every example**, so routing needs a fallback; and **there is no event id and no sequence number**, so dedup and ordering have to be derived. Both are worth raising with Cover Genius — the second is the "carry a version per aggregate" point from the Round 2 prep, now with evidence.

**Built (`lib/webhooks.js`, wired into the existing verified `/api/webhooks`):**
- **Route** by `partner_transaction_id` → ledger; fallback by booking id (`payload.id`).
- **Dedup** on a UUID v5 of (event, booking id, status, sorted quote statuses): a redelivery is acknowledged 200 but not re-applied.
- **Ordering guard** by status precedence (`CANCELLED` > `CONFIRMED`): a `CONFIRMED` event arriving after `CANCELLED` is marked `stale` and ignored. Timestamps aren't trusted for this; precedence is.
- **Apply:** `BOOKING_CREATED`/`UPDATED` merge the booking (per quote by id) and mark the order confirmed; `BOOKING_CANCELLED` marks it cancelled and, if RealCheap has no refund on record, **flags `refund_due`** with the summed `refund_value` — XCover calculates, RealCheap pays, so it is flagged, never auto-paid. Consideration #4 from the other direction.
- **Unknown booking** → 200 (so XCover stops retrying) and parked under `UNMATCHED-<booking>` for reconciliation. **Undocumented event** (e.g. a future `CLAIM_*`) → stored on the order, no state change — nothing invented. **Bad signature** → 401 (P1's verifier, unchanged).
- Every event, with outcome, is appended to the order's history; the integration log now renders inbound entries (`← POST /api/webhooks`, routed-by, dedup key, outcome) alongside outbound calls, so the whole conversation reads in one place.

**Simulator:** `POST /api/demo/webhook` builds the documented payload for an order from the ledger, **signs it exactly as XCover would** (HMAC over `date: <Date>` with `XCOVER_WEBHOOK_SECRET`), and POSTs to this server's own `/api/webhooks` — so the request genuinely traverses verification and routing. Options: `tamper` (wrong secret → 401), `omit_partner_txn` (null, as in the docs → booking-id fallback). Reachable from the result page ("Demo: simulate this webhook" with an event picker and the two checkboxes) and from `scripts/send-webhook.sh <ref> <event> [--tamper] [--no-txn]`. **Step-by-step documented in README → "Simulating an inbound XCover webhook".** Demo key/secret set in `.env`; `.env.example` says the simulator needs one.

**Found while verifying, fixed before commit:**
- Pressing Back from the result page re-quoted the completed order under the same ref and `/api/offers` reset its status to `quoted`. A completed order is not a cart: if the ref belongs to a paid/confirmed/refunded/opted-out order, a fresh ref is minted. Verified: re-quote before paying keeps the ref; after paying mints a new one and the old order is untouched.
- Result heading said "your laptop is protected" after a webhook cancellation; now "protection plan cancelled".

**Verified (script, 8 cases + browser):** applied / duplicate / cancelled+refund_due / stale / null-txn fallback / 401 / unmatched / stored_unhandled; history reads `… confirm offer → webhook BOOKING_CREATED(applied) → …(duplicate) → webhook BOOKING_CANCELLED(applied) → …(stale) → webhook CLAIM_STATUS_UPDATED(stored_unhandled)`. Browser: result page → simulate `BOOKING_CANCELLED` → table row `BOOKING_CANCELLED (simulated) · partner_transaction_id · applied`, policy pill `CANCELLED`, refund-due banner `US$49.99`, inbound entry in the integration log.

**Manual:** Specified the scope myself — route BOOKING_CREATED/CANCELLED by partner_transaction_id into the ledger, a way to simulate an inbound event, and a step-by-step doc — and later ran all three simulator cases (T8).

## P11 — 2026-09-13 — Orders view (agent: Claude Code)

**Asked:** see `PROMPTS.md` P11.

**Built:** `orders.html` + `orders.js` over the existing `GET /api/orders`. One row per order: order ref + time · line items (product, and the plan as its own tinted line with premium · XCover) · XCover ids (offer, quote, booking, idempotency key — truncated, full on hover) · **status pill in the brief's lifecycle vocabulary** (Offer created → Paid · confirming → Policy active → Cancelled; plus Offer declined / No offer / Refunded · no plan), with "via webhook BOOKING_*" when a webhook moved it and a red **refund due** chip when `BOOKING_CANCELLED` arrived with no RealCheap refund on record · **Attempts** — confirm / refund / opt-out counts split into *XCover called* vs *ledger* · actions: View, **Refund order** (re-labels to "Refund again (demo)" once refunded), Re-send confirm (demo). Unmatched webhooks get their own reconciliation list. Auto-refresh every 5 s (pauses while an action message is showing) so webhook-driven changes appear live. Linked from every storefront footer as "Orders (OMS view)".

**Idempotency made visible.** Ledger-served answers now write a history event (`confirm offer (repeat)`, `refund (repeat)`, `opt out (repeat)`, outcome `served_from_ledger`) so the Attempts column can say, e.g., `confirm: 2 (XCover called 1, ledger 1)` — the count is evidence, not a claim.

**Found while verifying, fixed before commit:** the server allowed confirm on an order that was never paid — the "confirm only after payment" invariant lived only in the page's order of operations. Now enforced server-side (409). The two 409/423 test orders had exposed it by having a booking with no payment (and therefore a disabled Refund button).

**Verified in a browser:** six seeded orders render in five distinct states including one moved by webhook; on a paid+confirmed order, Re-send confirm → *served_from: ledger*, attempts `2 (XCover 1, ledger 1)`; Refund → cancelled with XCover, one refund, status Cancelled; Refund again → *served_from: ledger*, `refund: 2 (XCover 1, ledger 1)`; unmatched booking listed in the reconciliation section; unpaid confirm → 409.

**Manual:** Specified the scope myself — a Map and a table, plan as a line item, status that moves, home for Refund, idempotency visible — and required the whole system be tested end to end before submission.

==================
# Stage 2 — Testing (from 2026-09-14)
==================

The build is feature-complete against the brief's six considerations. This stage records what end-to-end testing found, what was changed in response, and what was deliberately left alone. Same format as Stage 1: asked → assumptions → changed → verified → manual.

**Stage 1 exit state (commit `fb0fc89`, 24 commits):** catalog · checkout with quote / opt-in / decline / quantity / country · eligibility (fixture 422) · payload panel → integration log · simulated payment · confirm with derived `x-idempotency-key`, ledger, 409/423 handling · opt-out · cancel with preview + single refund record · `BOOKING_*` webhooks with signed simulator · orders view. Build time ≈ 12 h.

## T1 — 2026-09-14 — Test Case 1a: eligibility (agent: Claude Code)

**Asked:** see `PROMPTS.md` T1.

**Which 422, and why.** Three codes on the error-versioning page could express "not eligible": (1) create-offer `offer_quote_generation_failed` / item `offer_quote_pricing_error` — an offer matched but nothing could be priced, "No rate available"; (2) create-offer `offer_not_found_no_match_context` — no offer matches the request context; (3) confirm-offer `booking_quotes_unsuccessful` / `booking_quote_failed` — the shape the candidate pasted. The fixture uses (1): eligibility has to be answered at *quote* time, before the shopper sees a plan, and an unrated category is literally "no rate available". (2) is equally plausible depending on whether Cover Genius configures `E3CCM`'s eligibility as rating or as offer-matching — not RealCheap's choice — and the checkout already treats any create-offer 4xx as ineligible, so both render identically. (3) is the wrong *stage*: it fires after the shopper accepted and paid, so reaching it means XCover quoted a plan it then couldn't book — a fail-open case (refund the premium line, keep the order), not an eligibility case. Recorded as **A1** in the new `CLAUDE.md` → Assumptions section.

**Request body — fixed.** We sent only the required fields; valid, but not the documented shape. Now sent per the example: `partner.metadata { merchant_id, merchant_name, sales_channel, device (from User-Agent) }`, `context.estimated_shipping_date` / `estimated_delivery_date`, `product { brand, model, variant, category_id, term }`, and the `warranty {}` block. Three fields are **omitted on purpose** and say so in the code: `customer.region` (only country is collected), `partner.customer_id` (guest checkout), `product.wholesale_value` (OMS-side data). `products.js` gained `brand` ("Unbranded" — true for RealCheap), `model`, `category_id`.

**Two new assumptions this surfaced, both worth a discovery question:** **A7** — the requested plan is 2-year accidental damage + extended warranty, and factory-direct goods carry a 1-year manufacturer warranty (the docs' example values). The second half is shaky: unbranded goods may carry little or no manufacturer warranty — which is the pitch. **A8** — ships ~7 days / delivers ~14 days after purchase; these likely drive the policy start date, and RealCheap's OMS knows the real dates.

**Verified:** sleeve on a mobile UA from Canada → request shows the full documented shape (`device: "mobile"`, `merchant_id: REALCHEAP-ONLINE-CA`, `warranty{}`), XCover fixture still answers `422 offer_quote_generation_failed`.

**Manual:** My test and my grounding: ran the sleeve case, compared the request body against the product-retail create-offer page and the 422 against error-versioning, and asked which 422 applied and why.

## T2 — 2026-09-14 — Test Case 1b-i: offer generation (agent: Claude Code)

**Asked:** see `PROMPTS.md` T2.

**Sorted:**
- **One line item × 2 — by design (A3).** The retail schema has one `product` with a `quantity` field; the request carries `quantity: 2` and the plan is one line × 2. Whether XCover rates that as one policy or two is the open CSE question already recorded.
- **Germany stayed USD — a fixture limitation that hid A5.** The product line is USD on purpose (list prices don't convert), but the *premium* should have come back in EUR and didn't, because there was one USD fixture. Added `offer-response.{CAD,GBP,EUR}.json` (same structure, placeholder amounts per currency; USD default). Germany now shows `€45.99 per item`, a `€91.98` premium line, and total `US$1,098.00 + €91.98` — two settlements, no invented FX rate, which is A5 demonstrated rather than papered over.
- **"Three quotes in the log" — the log is on the checkout page**, not the OMS (which is one row per order, correctly). Not the tester's job to know that: the OMS Attempts column now shows `quote: 3 (XCover called 3; 2 earlier offers superseded)` and the ids column marks the offer id `(latest)`.
- **The flicker — the ids were identical, and that was the wrong behaviour.** One fixture file → same offer and quote ids on every call. Live, every create-offer returns fresh ids, and the docs say never to cache offers. Fixture mode now mints fresh `id` / `products[].id` per call (`adaptFixture`, values only — structure stays the file's), and confirm/cancel fixtures echo the request's quote ids and `partner_transaction_id` the way the real replies do. Consequence worth saying in the room: **a re-quote is a new offer; confirm must send the latest offer/quote ids.** The ledger stores them on every re-quote, and a confirm with a stale offer id is refused (409).

**Verified (script + browser):** three quotes under one order ref; offer id differs per quote; Germany premium `EUR €45.99` vs USD `$49.99`; ledger `quote_count 3, superseded 2`; confirm with the first (stale) offer id → 409, with the latest → booking whose quotes echo our quote id and whose `partner_transaction_id` is ours. Browser: Germany row `2 × €45.99 = €91.98`, total `US$1,098.00 + €91.98`, two log entries with different offer ids.

**Manual:** My test: noticed the offer/quote ids flickering behind the mask and asked whether they were the same across re-quotes — they were, and that turned out to be the fixture misleading us. Also flagged the Germany currency and the one-line-item reading.

## T3 — 2026-09-14 — Test Case 1b-ii: decline → opt-out (agent: Claude Code)

**Asked:** see `PROMPTS.md` T3.

**204 / no body — correct.** That is the retail Opt-out Offer spec exactly (`POST /offers/{offer_id}/opt_out/`, no body, 204 No Content). Nothing to record beyond the status.

**The flicker — real bug, fixed.** The OMS derived the plan line from `order.status`. Opt-out sets status `declined`; Pay then overwrites it with `paid_no_protection`; so after payment the row no longer matched "declined" and fell through to "undecided", and the 5-second auto-refresh showed both in turn. The decision is stored separately — `protection: "declined"` and the `opt_out` record — and the line now reads from those. The status pill also gains `Paid · plan declined` for that combination, instead of the ambiguous `Paid · no plan`. **Lesson:** status is a lifecycle position; the shopper's decision is a fact about the order — deriving one from the other is where the flicker came from.

**Verified:** ledger after opt-out → `declined / protection declined / opt_out true`; after pay → `paid_no_protection / protection declined / opt_out true`; OMS row reads "Protection Plan — declined (opt-out sent)", pill "Paid · plan declined", Attempts `opt-out: 1 (XCover called 1, ledger 0)`; unchanged across an auto-refresh cycle.

**Manual:** My test: caught the declined/undecided flicker in the OMS on auto-refresh.

## T4 — 2026-09-14 — Test Case 2: accept → pay → confirm — PASS (no change)

Candidate reports the accept → Continue → policyholder → Pay (simulated) → confirm → result page path passes end to end. Nothing changed. For the record, what this case exercises: payment recorded before confirm (server-enforced), derived `x-idempotency-key` visible in the Integration log, booking on the result page with cover period, COI / PDS / claim links, and the OMS row moving to "Policy active" with the booking id filled.

## T5 — 2026-09-14 — Test Case 2b: retry confirm (agent: Claude Code)

**Asked:** see `PROMPTS.md` T5.

**200 vs 409 — both are right, at different layers.** Two things guard a repeat confirm. The **ledger** (rule 3) answers first: the order already has a booking, so RealCheap returns it and never calls XCover — that is the 200 with `served_from: ledger` the candidate saw. **XCover** is the second line: if the call does go up, the guide says 409 "Offer already confirmed" (with the idempotency key, the cached original result), and the code treats that as success. The demo button could only ever show layer one, so the interesting half was invisible. Added a **"bypass the ledger — let XCover answer"** checkbox to the result-page demo (`force_xcover`, fixture mode only): the same derived key reaches XCover, which replies 409, and the booking is unchanged. `CLAUDE.md` rule 4 now states the layering explicitly.

**Request body — the guide adds fields the retail OpenAPI spec didn't show; fixed:**
- `policyholder.phone` — **required** in the guide (absent from the retail spec's required list). Added to the checkout form and validated server-side (400 without it).
- `partner_transaction_id` — top-level, optional — **and it is the field XCover echoes back on `BOOKING_*` webhooks.** Their examples show `null` because they never sent one. Our webhook routing had been relying on a value we weren't populating; live, every webhook would have fallen back to booking-id routing. Now sent on every confirm; the result page shows it as "Partner ref (echoed by XCover; routes BOOKING_* webhooks)".
- `payment_details { provider, transaction_id }` — optional; the simulated payment now carries an id (`PAY-…`) and provider, and both are sent.
- `quotes[].insured / instalment_plan / first_instalment_paid`, `booking_agent` — optional, not applicable to a retail plan; omitted.

**Response — two checks the guide asks the partner to perform, now performed:** (1) an `errors` object present on a success "indicates an important logic error during booking that should be investigated" → flagged `booking_errors_present`; (2) **price validation** — the confirmed `total_premium` must match the Create Offer price → flagged `price_mismatch` with both figures. Either sets `needs_review` on the order and a banner on the result page. To make (2) testable, confirm fixtures now echo the ledger's quoted currency and unit price × quantity (a real confirm returns the quoted price; a static file couldn't).

**Verified:** no phone → 400; body keys `quotes, policyholder, partner_transaction_id, payment_details`, `partner_transaction_id` = our order ref, `payment_details.transaction_id = PAY-…`; Germany qty 2 → confirmed `EUR 91.98` = quoted `€45.99 × 2`, `needs_review: none`; repeat → `ledger`, XCover not called; repeat with bypass → XCover `409`, `replayed true`, `treated_as_success true`, same booking, **same `x-idempotency-key` as the first call**.

**Manual:** My test and my grounding: questioned why a retry returned 200 when the guide says 409, and asked for the request/response fields to be re-checked against the Confirm Offer guide — which surfaced phone, partner_transaction_id and payment_details.

## T6 — 2026-09-14 — Test Case 2 revisited: confirm silently not called (agent: Claude Code)

**Asked:** see `PROMPTS.md` T6.

**What the guide's sentence means.** Create Offer is a quote; nothing binding exists after it. Confirm Offer is the sale: XCover *provisions* the product (issues the policy, creates the `…-INS` booking, generates the certificate) and *distributes confirmation* (emails the customer the policy documents — the partner doesn't). Collect payment, then confirm; if confirm never happens, **the customer has paid for a policy that does not exist.** Which is what the candidate observed.

**Most likely trigger:** T5 made `policyholder.phone` required server-side; a browser still holding the pre-T5 `checkout.js` (no phone field) sent a confirm the server rejected with 400. Reproduced exactly that way.

**The real bug — fixed:** `pay()` swallowed the failed confirm. The comment even said so ("RealCheap's problem to retry — the shopper is never blocked"). Fail-open was right; *silent* was wrong: the order was never flagged, the result page said "Order confirmed / no protection plan", nothing prompted a retry. Now:
- A confirm the server rejects itself (400/409) is **recorded on the order** (`confirm_error`, history `confirm offer (rejected locally)`), not just returned. An XCover failure or timeout sets `confirm_error` too; a later success clears it.
- The checkout tells the shopper ("Payment received. The protection plan could not be confirmed yet — it will be retried") before moving on.
- The result page shows **"Order confirmed — protection plan pending"** with a *PENDING CONFIRMATION* card, the reason, and a real **Retry confirm now** button. The OMS pill shows *confirm failed* with the reason and a **Retry confirm** action.
- `Cache-Control: no-store` on `/js` and `/css`, so a restarted server can no longer run against a cached front end. New invariant in `CLAUDE.md`: *fail open, never silent.*

**Verified (script + browser):** stale-client confirm (no phone) → 400, `confirm_error` on the order, history `payment → confirm offer (rejected locally)`, OMS row *Paid · confirming / confirm failed / policyholder.phone is required* with Retry confirm; retry with phone → 200, booking, `confirm_error` cleared, OMS *Policy active*; `/js/checkout.js` served with `cache-control: no-store`.

**Manual:** My catch, and the most important one: noticed after payment that the confirm call was missing from the Integration log, and asked what the guide's 'provision the product' sentence meant. The agent had written the silent path on purpose.

## T7 — 2026-09-14 — Test Case 2 retest + 2b — PASS, one fixture fix (agent: Claude Code)

**Asked:** see `PROMPTS.md` T7.

**Correct assumption.** The confirm fixture carries a placeholder `policyholder`; the adaptation echoed quote ids, `partner_transaction_id` and price but not the policyholder, so the response showed the fixture's name regardless of what was typed at checkout. A real confirm returns the policyholder that was sent. Fixed (`echoPolicyholder`, the four documented response fields). Consequence worth noting: the result page reads the policyholder from the booking, so before this fix the confirmation card would have named the placeholder even if the shopper had entered their own details.

**Verified:** sent `Nnanna Eze · nnanna@example.com · CA` → booking `policyholder` returns the same four fields. 2b confirmed by the candidate on both layers (ledger 200 / bypass 409).

**Manual:** My test: spotted the response policyholder not matching the request and asked whether it was the fixture — it was.

## T8 — 2026-09-14 — Test Case 3: webhooks — PASS, explanation + clarity fix (agent: Claude Code)

**Asked:** see `PROMPTS.md` T8. All three outcomes as designed.

**The candidate's read is correct.** With `partner_transaction_id` null the event was routed by **booking id** to the same order; the dedup key is derived from `(event, booking id, status, quote statuses)` and deliberately **excludes** `partner_transaction_id` — a `BOOKING_CANCELLED` for a booking is the same event whether or not XCover filled that field — so it matched the first test's key and was deduped. Two mechanisms, in sequence: fallback routing found the order, dedup refused to apply it twice. The evidence of the fallback was in the table's *Routed by* column (`booking_id` vs `partner_transaction_id`), not in the outcome.

**Changed for clarity, not behaviour:** the handler's response and every outcome note now say `routed by <field>` explicitly, so the demo message reads "routed by booking_id; same event already applied…" without needing the table. README step 3 says to run the null-txn case first on a fresh order to see `applied`, and why it otherwise reads `duplicate`.

**Manual:** My test: ran all three webhook cases and correctly diagnosed that the null-partner_transaction_id run came back 'duplicate' because it had been routed by booking id to an order that already had the event.

## T9 — 2026-09-14 — Test Case 4: refund (agent: Claude Code)

**Asked:** see `PROMPTS.md` T9.

**Two defects, same root as the checkout's currency bug (P4).** (1) The cancel fixture carried a fixed `refund.amount: 49.99` USD, so a GBP order (premium £39.99 × 2) was "refunded" $49.99. Cancel calls now use the same `echoPrice` adaptation as confirm — a real cancel refunds what was charged, in the currency it was charged in. (2) The refund record *summed* the USD product refund with the premium refund regardless of currency. It now keeps `product_currency` (USD, RealCheap's list price) and `premium_currency` (the offer currency) apart; `total` is only computed when they match, otherwise `total_formatted` reads e.g. `$698.00 + £79.98` — two currencies, two settlements, no invented rate (A5), and the result page says so.

**Verified:** GBP order, qty 2 → cancel reply `GBP £79.98`; refund record `$698.00 + £79.98`, `total: null`; USD order → `$398.99`, `total: 398.99`. Re-send refund confirmed by the candidate → ledger.

**Manual:** My test: caught the refund showing a fixed US-dollar premium on a GBP order.

## T10 — 2026-09-14 — Test Case 5 + Test Case 4 retest — PASS (no change)

Restart clears the ledger (in-memory, by design and documented); the refund now shows the premium in the currency it was charged in. **End of the end-to-end test stage.**

### Test stage summary

| Case | Scope | Result | Changes made |
|---|---|---|---|
| 1a | Eligibility (sleeve) | PASS | T1 — documented create-offer request shape; A1, A7, A8 |
| 1b-i | Offer generation (laptop, qty, country) | PASS | T2 — per-currency fixtures, fresh ids per quote, echoed ids on confirm/cancel, quote count in OMS; A9 |
| 1b-ii | Decline → opt-out | PASS | T3 — OMS plan line reads the decision, not the status (flicker) |
| 2 | Accept → pay → confirm | PASS | T4 none; **T6 — a failed confirm is recorded, shown as pending, retryable (was silent)**; T7 — fixture echoes policyholder |
| 2b | Retry confirm | PASS | T5 — confirm body per the guide (phone, `partner_transaction_id`, `payment_details`), price/errors validation, bypass-ledger demo |
| 3 | Webhooks (applied / 401 / routed by booking id) | PASS | T8 — outcomes state how the event was routed |
| 4 | Refund + repeat | PASS | T9 — cancel fixtures refund the quoted premium in its currency; record never sums across currencies |
| 5 | Restart | PASS | — |

**Two patterns across the ten entries, for the presentation:**
1. **Four findings were the fixtures hiding reality** — identical ids on every quote (T2), one currency (T2), a placeholder policyholder (T7), a fixed refund amount (T9). Each was fixed by making fixture mode behave like the real API on that one axis (fresh ids, echoed request values, per-currency files), never by inventing pricing. Building against mocks is only as honest as the mocks.
2. **Two findings came from reading the *guide* pages, not the OpenAPI blocks** — the create-offer request shape (T1) and the confirm body with `phone` / `partner_transaction_id` / `payment_details` (T5). The spec and the guides disagree in places; the second of those gaps would have broken webhook routing in production.

And one that was neither: **T6**, the silent failed confirm — written on purpose, commented as resilience, found by noticing a log entry that wasn't there.
