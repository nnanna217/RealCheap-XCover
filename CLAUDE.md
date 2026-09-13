# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Project: RealCheap × XCover prototype

Guidelines above: Karpathy-inspired, packaged by [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills). Not written here.

- **What this is:** a mock RealCheap (discount consumer-goods marketplace) checkout with an embedded XCover protection-plan offer, against the XCover **staging** API. Functional integrity over aesthetics.
- **Starting point:** scaffolded from a prior Adyen payments checkout demo (Express + plain HTML/JS). The swap from Adyen to XCover is done surgically — see `BUILD_LOG.md`.
- **Secrets:** `XCOVER_API_KEY` / `XCOVER_API_SECRET` live in `.env` (gitignored), read only in `server.js`. The browser never sees them; the on-page payload panel redacts auth headers.
- **Log every session** in `BUILD_LOG.md`: the prompt, what was produced, what was wrong, what was fixed by hand.

## Goals — quoted from the case-study brief

The application **should**:

- Retrieve and visualize coverage for a sample electronic product (e.g. laptop) within a mock RealCheap checkout page, including insurance product details and coverage.
- Enable interactive elements for users to opt-in or decline protection during the mock transaction.
- Expose the underlying API request and response data on the frontend to allow stakeholders to validate the live integration.

*"Functional integrity is prioritized over aesthetic design; a transparent, working integration using realistic data is the objective."*

## Scope — the brief's six technical considerations, as verifiable goals

Quoted list from the brief: *"Real-time SKU and category eligibility, coverage and pricing calculation at checkout, quantity-based rating for multi-unit orders, cancellation API integration to prevent duplicate compensation when RealCheap also issues refunds, multi-currency/multi-region settlement (US, Canada, UK, Italy, France, Spain, Germany), and webhook-based claim status."*

| # | Consideration | Build | Verify |
|---|---|---|---|
| 1 | Real-time SKU and category eligibility | **Yes** | The sleeve SKU (`accessories/bags`) produces no offer and checkout handles it gracefully; laptops produce one |
| 2 | Coverage and pricing calculation at checkout | **Yes** | Offer price and coverage are rendered from the XCover response — never computed or hard-coded locally |
| 3 | Quantity-based rating for multi-unit orders | **Yes** | Changing quantity changes `context.product.quantity` and triggers a re-quote |
| 4 | Cancellation API — no duplicate compensation when RealCheap also refunds | **Yes** | A refund on an order calls `bookings/{id}/cancel`; the call is idempotent on the order reference (a repeat cannot cancel or refund twice) |
| 5 | Multi-currency / multi-region settlement (US, CA, GB, IT, FR, ES, DE) | **Selector only** | Switching country/currency re-quotes with a new `customer{}` block; settlement itself is narrative, not code |
| 6 | Webhook-based claim status | **Yes** | A correctly signed inbound event updates the order's status; a badly signed one is rejected with 401 |

## Idempotency — rules that bind every write to XCover

Source: the retail confirm-offer spec (`partner-docs.covergenius.com/offers/vertical-examples/product-retail/confirm-offer`) supports an `x-idempotency-key` header. A duplicate returns **409 Conflict with the cached original result — handle as success**; an in-flight duplicate returns **423 Locked — retry after a short delay**. The docs suggest "a unique identifier (e.g., UUID)". A UUID minted per attempt defeats the purpose: a retry from a restarted worker gets a new UUID and issues a second policy. So:

1. **One order reference per cart, created once, reused forever.** `partner.transaction_id` (`RC-…`) is generated the first time a cart quotes and is returned to the browser, which keeps it in `sessionStorage` and sends it back on every later call (re-quote, confirm, cancel). A reload or retry must never mint a new one. *(P3 got this wrong — it minted one per `/api/offers` call. Fix in P4.)*
2. **The idempotency key is derived, never random.** `x-idempotency-key` = UUID v5 of the natural key: `confirm:${transaction_id}:${offer_id}:${sorted quote ids}`; for cancel, `cancel:${transaction_id}:${booking_id}`. Same operation → same key, across retries, reloads, and processes. It is still a valid UUID, which is what the API asks for.
3. **Track it server-side, keyed by the natural key.** `lib/orders.js` holds a `Map` keyed by `transaction_id` → `{ idempotency_key, offer_id, quote_ids, booking_id, status, history[] }`. Before calling confirm, look the order up: if it already has a `booking_id`, return it without calling XCover at all. The Map stands in for a unique constraint — say so in the demo ("in production this is a unique index on the orders table, not a cache").
4. **Handle XCover's replies as documented.** 409 → read the cached result from the body, treat as success, store the booking. 423 → wait, retry with backoff (3 attempts). Never surface either to the customer as a failure.
5. **Cancel follows the same rules.** A refund event on an order with no `booking_id` is a no-op; on an order already `cancelled` it is a no-op; otherwise it cancels once with a derived key. This is how "no duplicate compensation when RealCheap also refunds" is actually enforced, not just described.

The payload panel shows the derived key on every confirm/cancel request so the panel can see it is stable across a retry.

## Non-goals (decided — see TODO.md)

- No database. The catalog is a module; "in production this is RealCheap's catalog service."
- No real PSP. Payment is a simulated step; RealCheap is merchant of record under XCover's Single Payment model.
- No framework, no build step. Express + plain HTML/JS.
- Aesthetics are secondary to a working, transparent integration.

## Invariants — must hold in every commit

- Secrets never reach the browser. `XCOVER_API_KEY` / `XCOVER_API_SECRET` are read only in server code.
- The payload panel redacts `Authorization` and `X-Api-Key`, and always shows whether a response is `fixture` or `live`. Never let a cached or fixture response pass as live.
- The confirm call fires only after payment succeeds — never before — and carries a derived `x-idempotency-key` (see Idempotency above).
- Checkout completes even if XCover is unreachable (fail-open): the customer can buy the laptop without protection; they are never blocked by the insurance call.
