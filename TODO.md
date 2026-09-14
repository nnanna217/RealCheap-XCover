# TODO / decisions deferred

Decisions raised during the build that are deliberately *not* being done yet, with the reasoning, so the Q&A answer is "considered, chose not to — here's why" rather than "didn't think of it".

## Won't do (unless time remains after the deck is rehearsed)

- **Relational DB for the catalog.** Raised after P3 (price/category are looked up server-side). Decided against: three SKUs, a 12-hour cap, nothing on the rubric scores persistence, and `products.js` already makes the point that the client never supplies a price. Demo line: "in production this lookup is RealCheap's catalog service / OMS; here it's a module." If time is left: SQLite (`better-sqlite3`) seeded from `products.js`, ~30 min, one file.
- **Re-add Adyen as the PSP behind the Pay button.** XCover's payment guide makes RealCheap the merchant of record under Single Payment, so a real PSP would only ever sit behind the simulated "Pay" step. Out of scope until the protection flow is complete (P1 note).

## Done — the order store landed with confirm (P7)

- `lib/orders.js` is the idempotency ledger and now also the webhook target (P10). Only the `orders.html` *view* remains.

## Done — P11 orders view (was P8 in the plan)

- **Orders view (`orders.html` + in-memory store).** Built 2026-09-13. Original note kept below for the reasoning.
- *(original)* **Orders view (`orders.html` + in-memory store).** Raised after P3: the brief's tech stack is a proprietary OMS, and considerations #4 (cancellation → no duplicate compensation) and #6 (webhook claim status) currently have nowhere to *appear* except server logs. One page listing each order with its line items — product line, protection-plan line carrying the XCover offer / quote / booking ids — and a status that moves: offer created → confirmed → policy active → cancelled / claim status from the webhook. Home for the "Refund order" button. **Also the place idempotency becomes visible:** a `Map` keyed by `partner.transaction_id`, so a re-sent confirm returns the existing order rather than issuing a second policy. Not an OMS — a Map and a table. ~1 h.
