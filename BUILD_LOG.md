# Build Log

Chronological record of how this prototype was built with an LLM coding harness (Claude Code), kept as it happened. Each entry: what was asked, what came back, what was wrong, what was changed by hand.

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

**Manual:** _(candidate to fill after reviewing the diff — what you changed or would change, and why.)_

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

**Manual:** _(candidate to fill after reviewing the diff.)_

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

**Manual:** *(candidate to fill after reviewing the diff.)*

## 2026-09-13 — Correction: fixture and request rebuilt from the RETAIL schema (manual + agent)

Cover Genius replied: the schema is at `partner-docs.covergenius.com/offers/vertical-examples/product-retail/create-offer`, and the staging restriction is on their side, being resolved. Asked the agent to confirm the fixture had been built from that page. **It had not** — it came from the generic Offers API spec embedded in the docs corpus. Diffed the two:

**Request — `context` is no longer provisional.** Retail schema: `purchase_date`, `estimated_shipping_date`, `estimated_delivery_date`, `product{ sku*, title*, quantity*, retail_value*, brand, model, variant, category, category_id, condition, description, wholesale_value, term }`, `warranty{ manufacturer_duration, term, benefit }`. One `product` object per offer — quantity is a field on it (that settles consideration #3's shape). My `items[]/order_total` guess replaced with the real fields; sending the four required plus `category`, `condition`, `description`. **`schema` is required at the top level** in the retail spec; the identifier value is not on the page ("the CSE will provide") — wired as `XCOVER_SCHEMA`, currently `TODO-from-CSE`. Query params worth knowing: `include_content` (default true), `extra_fields=tax,commission,benefits,surcharge`, `exclude_offer_ids`.

**Response — fixture rebuilt.** Retail response has **no** `session_id`, `product_rules`, `content.products[]`, `content.credibility*`, `metadata`, or `tax.breakdown` — all of which the old fixture carried. It **does** have `products[].name`, `products[].details.benefits[]`, `extra_fields.{appliance, benefit_type, partner_commission, retail_ex_tax, retail_inc_tax, tax_rate, taxes, variant, pricing_matrix}`, `files[].{name,url,type}`, `price.total_amount_min/max`, `content.extras`. The offer-level `content` block with `positive_cta` / `negative_cta` / `negative_cta_warning` / `credibility_message` survives — so the "XCover supplies the CTA copy" point stands; the "XCover supplies selection rules via `product_rules`" point **does not** for retail and is withdrawn from the pitch.

**Verified:** fixture parses; `/api/offers` builds the retail-shaped request (`schema`, `customer`, `context.purchase_date`, `context.product{…quantity:2, retail_value:549}`, `partner.transaction_id`) and returns the rebuilt fixture (`products[0].name`, three `benefits`, `content.positive_cta`).

**Manual:** the check was worth asking for — an agent-built fixture against the wrong spec would have surfaced as a broken demo the moment staging opened. Open item: get the schema identifier from the CSE.
