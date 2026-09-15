# TODO / decisions deferred

Decisions raised during the build that are deliberately *not* being done yet, with the reasoning, so the Q&A answer is "considered, chose not to — here's why" rather than "didn't think of it".

## Won't do (unless time remains after the deck is rehearsed)

- **Relational DB for the catalog.** Raised after P3 (price/category are looked up server-side). Decided against: three SKUs, a 12-hour cap, nothing on the rubric scores persistence, and `products.js` already makes the point that the client never supplies a price. Demo line: "in production this lookup is RealCheap's catalog service / OMS; here it's a module." If time is left: SQLite (`better-sqlite3`) seeded from `products.js`, ~30 min, one file.
- **Real payment collection.** Payment is a simulated step on purpose: XCover's payment guide makes RealCheap the merchant of record under Single Payment, so a PSP would sit entirely on RealCheap's side and add a third-party dependency (keys, a sandbox, a webhook) that isn't what the brief evaluates. The invariant that matters — confirm fires only after payment succeeds — is enforced server-side regardless of how payment is collected.
- **Email / text to the customer.** Not built. After Confirm Offer, XCover itself "distributes confirmation to the customer" — the policy documents email comes from XCover, not the partner. RealCheap's own order-confirmation email/SMS is ordinary OMS work outside the brief; sending real messages from a prototype would also mean a third-party dependency (SendGrid/Twilio) for no scored benefit.
- **Re-add Adyen as the PSP behind the Pay button.** XCover's payment guide makes RealCheap the merchant of record under Single Payment, so a real PSP would only ever sit behind the simulated "Pay" step. Out of scope until the protection flow is complete (P1 note).

## Done — the order store landed with confirm (P7)

- `lib/orders.js` is the idempotency ledger and now also the webhook target (P10). Only the `orders.html` *view* remains.

## Done — P11 orders view (was P8 in the plan)

- **Orders view (`orders.html` + in-memory store).** Built 2026-09-13. Original note kept below for the reasoning.
- *(original)* **Orders view (`orders.html` + in-memory store).** Raised after P3: the brief's tech stack is a proprietary OMS, and considerations #4 (cancellation → no duplicate compensation) and #6 (webhook claim status) currently have nowhere to *appear* except server logs. One page listing each order with its line items — product line, protection-plan line carrying the XCover offer / quote / booking ids — and a status that moves: offer created → confirmed → policy active → cancelled / claim status from the webhook. Home for the "Refund order" button. **Also the place idempotency becomes visible:** a `Map` keyed by `partner.transaction_id`, so a re-sent confirm returns the existing order rather than issuing a second policy. Not an OMS — a Map and a table. ~1 h.

## Known limitations (pending live data)

- **Only `products[0]` is rendered.** If `E3CCM` returns several plans in one offer (see `CLAUDE.md` A9 — e.g. 1y vs 2y, or accidental damage vs extended warranty as separate products), the checkout shows the first and confirms only that one. Next iteration: render one option per product with its own price and copy, let the shopper pick, and send the chosen quote id(s) to confirm. Surfaced during Test 1b-i (2026-09-14) from a reasonable misreading of "three quotes in the log" as three products in one response.
- **Restart the server after pulling changes** — `npm start` does not watch files. Surfaced during testing when a stale process showed USD for Germany after the per-currency fixtures had landed.
