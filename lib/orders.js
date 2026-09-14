// Order ledger — CLAUDE.md → Idempotency, rule 3.
// In-memory Map keyed by RealCheap's transaction_id. This is the prototype's stand-in for a unique index on an
// orders table: before any write to XCover, the order is looked up here, and a write that already happened is
// answered from the ledger without calling XCover again. Lost on restart — by design for a demo, and said so.
const orders = new Map();

function get(transactionId) {
  return orders.get(transactionId) || null;
}

function upsert(transactionId, patch, event) {
  const existing = orders.get(transactionId) || {
    transaction_id: transactionId,
    status: "new", // new → quoted → (declined | paid → confirmed → cancelled)
    history: [],
  };
  const next = { ...existing, ...patch, updated_at: new Date().toISOString() };
  if (event) next.history = [...existing.history, { at: next.updated_at, ...event }];
  orders.set(transactionId, next);
  return next;
}

function list() {
  return [...orders.values()].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
}

module.exports = { get, upsert, list };
