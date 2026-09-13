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
1. "No `adyen` in `git grep`" was read as *code and config* — `README.md`, `BUILD_LOG.md`, `CLAUDE.md` deliberately keep the word because they document the repo's origin. `package-lock.json` regenerated clean.
2. The webhook handler could not be "kept" literally: its HMAC validator *was* the Adyen library. Kept the route and its shape (verify → process → 200; 500 on error so the sender retries) and replaced the validator with XCover's documented webhook scheme — HMAC over `date: <Date>` with the algorithm named in the `Authorization` header, timing-safe compare. Added as `verifyXcoverWebhook()` in `lib/xcover-auth.js` next to the outbound signer, since it is the same scheme reversed.
3. The verify criterion forced two files beyond the two named: `public/checkout.html` (Adyen CSS/JS tags) and `test-webhook.js` (an Adyen sample-payload script, now orphaned — deleted).

**Removed:** Adyen lazy-loader, `getCheckoutAPI`, `/api/config` (only served Adyen keys), `/api/sessions`, the CORS middleware (its own comment said it existed for Adyen's hosted Drop-in; this app is same-origin), Drop-in mount + tags, `@adyen/api-library` dependency.
**Kept untouched:** `/` redirect and the `product.html` page (catalog is P2), `/api/status`, static serving.
**Added:** `XCOVER_WEBHOOK_KEY` / `XCOVER_WEBHOOK_SECRET` to `.env.example`; `verifyXcoverWebhook`.

**Verified:** `npm start` boots; `GET /` serves (express.static answers with `index.html` before the redirect route — pre-existing behaviour, left alone); `GET /api/status` 200; `POST /api/webhooks` with a correctly signed request → 200 `[accepted]`, with a tampered signature → 401. `git grep -i adyen -- ':!*.md' ':!package-lock.json'` → none; lockfile → 0 matches.

**Manual:** *(candidate to fill after reviewing the diff — what you changed or would change, and why.)*

**Re-add later?** Yes, possible: payment collection is Single Payment on RealCheap's side per the XCover payment guide, so Adyen would only ever be the mock PSP behind the "Pay" button. Deliberately out of scope until the protection flow is complete.

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

**Manual:** *(candidate to fill after reviewing the diff.)*
