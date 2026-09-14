// Inbound XCover webhook routing — consideration #6.
// Documented events (partner-docs → Webhooks): BOOKING_CREATED, BOOKING_UPDATED, BOOKING_CANCELLED, RENEWAL_*.
// Payload shape: { event, payload: { id (booking), status, currency, total_price, partner_transaction_id, quotes[] } }.
// The documented payload carries NO event id and NO sequence number, so:
//   - dedup is derived: a key from (event, booking id, status, quote statuses) — a redelivery of the same event is
//     acknowledged but not re-applied;
//   - ordering is guarded by precedence, not timestamps: CANCELLED never regresses to CONFIRMED.
const orders = require("./orders");
const { uuidv5 } = require("./idempotency");

const STATUS_RANK = { CONFIRMED: 1, CANCELLED: 2 }; // higher never yields to lower
const HANDLED = new Set(["BOOKING_CREATED", "BOOKING_UPDATED", "BOOKING_CANCELLED"]);

function eventKey(event, payload) {
  const quoteStates = (payload.quotes || []).map((q) => `${q.id}:${q.status}`).sort().join("|");
  return uuidv5(`webhook:${event}:${payload.id}:${payload.status}:${quoteStates}`);
}

// Route by partner_transaction_id first (our natural key), then by booking id.
function findOrder(payload) {
  if (payload.partner_transaction_id) {
    const o = orders.get(payload.partner_transaction_id);
    if (o) return { order: o, matched_by: "partner_transaction_id" };
  }
  const byBooking = orders.list().find((o) => o.booking_id === payload.id);
  if (byBooking) return { order: byBooking, matched_by: "booking_id" };
  return { order: null, matched_by: null };
}

function applyEvent(body, meta = {}) {
  const { event, payload } = body || {};
  if (!event || !payload || !payload.id) return { outcome: "rejected", reason: "malformed: need event and payload.id" };

  const { order, matched_by } = findOrder(payload);
  const key = eventKey(event, payload);
  const record = { event: `webhook ${event}`, status: 200, webhook: { key, matched_by, source: meta.source || "xcover", received_at: new Date().toISOString(), body } };

  if (!order) {
    // Acknowledge (so XCover stops retrying) but keep it: an event for an order we don't know is a reconciliation item.
    orders.upsert(`UNMATCHED-${payload.id}`, { status: "unmatched_webhook", booking_id: payload.id }, { ...record, outcome: "unmatched" });
    return { outcome: "unmatched", key, note: `no order for partner_transaction_id=${payload.partner_transaction_id} or booking ${payload.id}; stored for reconciliation` };
  }

  const seen = new Set(order.webhook_keys || []);
  if (seen.has(key)) {
    orders.upsert(order.transaction_id, {}, { ...record, outcome: "duplicate" });
    return { outcome: "duplicate", key, order: orders.get(order.transaction_id), note: "same event already applied; acknowledged, not re-applied" };
  }

  if (!HANDLED.has(event)) {
    // Not one of the documented booking events (e.g. RENEWAL_*, or a claim event if one ever arrives): keep it on
    // the order, don't guess what it means.
    const updated = orders.upsert(order.transaction_id, { webhook_keys: [...seen, key] }, { ...record, outcome: "stored_unhandled" });
    return { outcome: "stored_unhandled", key, order: updated, note: `${event} stored on the order; no state change applied` };
  }

  const incoming = payload.status;
  const current = (order.booking && order.booking.status) || null;
  if (current && STATUS_RANK[incoming] < STATUS_RANK[current]) {
    // Out-of-order delivery (e.g. BOOKING_CREATED arriving after BOOKING_CANCELLED): never regress.
    const updated = orders.upsert(order.transaction_id, { webhook_keys: [...seen, key] }, { ...record, outcome: "stale" });
    return { outcome: "stale", key, order: updated, note: `${event} (${incoming}) arrived after ${current}; ignored` };
  }

  const booking = {
    ...(order.booking || {}),
    id: payload.id, status: incoming, currency: payload.currency,
    total_price: payload.total_price, total_price_formatted: payload.total_price_formatted,
    quotes: (payload.quotes || []).map((q) => ({ ...((order.booking && (order.booking.quotes || []).find((x) => x.id === q.id)) || {}), ...q })),
    last_webhook: { event, at: record.webhook.received_at },
  };
  const patch = { booking, booking_id: payload.id, webhook_keys: [...seen, key] };
  if (event === "BOOKING_CANCELLED") {
    patch.status = "cancelled";
    // XCover says the policy is cancelled. If RealCheap hasn't refunded (e.g. the customer cancelled with XCover
    // directly), the premium refund XCover calculated is now DUE from RealCheap — flagged, not auto-paid.
    const refundValue = (payload.quotes || []).reduce((s, q) => s + Number(q.refund_value || 0), 0);
    if (!order.refund) patch.refund_due = { premium: refundValue, currency: payload.currency, reason: "BOOKING_CANCELLED received; no RealCheap refund on record" };
  } else if (!order.status || ["quoted", "paid", "declined", "no_offer"].includes(order.status)) {
    patch.status = "confirmed";
  }
  const updated = orders.upsert(order.transaction_id, patch, { ...record, outcome: "applied" });
  return { outcome: "applied", key, order: updated };
}

module.exports = { applyEvent, eventKey, findOrder };
