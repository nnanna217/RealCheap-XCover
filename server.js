const express = require("express");
const path = require("path");
require("dotenv").config();
const { verifyXcoverWebhook } = require("./lib/xcover-auth");
const xcover = require("./lib/xcover-client");
const orders = require("./lib/orders");
const { confirmKey } = require("./lib/idempotency");
const { findProduct } = require("./public/js/products");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.get("/", (req, res) => {
  // Redirect to product page for MakeupShop
});

// API example route
app.get("/api/status", (req, res) => {
  res.json({ status: "Server is running", timestamp: new Date() });
});

// POST /api/offers - create an XCover offer for the cart
// Body: { sku, qty, country, currency, language }. Price and category come from the catalog, never the client.
app.post("/api/offers", async (req, res) => {
  const { sku, qty = 1, country = "US", currency = "USD", language = "en", transaction_id } = req.body || {};
  const product = findProduct(sku);
  if (!product) return res.status(400).json({ error: "unknown or missing sku", sku });
  const quantity = Math.max(1, parseInt(qty, 10) || 1);
  // Idempotency rule 1: one order reference per cart. The browser sends back the one it was given;
  // a new one is minted only when the cart has none yet. Never regenerate on re-quote, reload or retry.
  const txn = /^RC-[A-Z0-9-]{6,}$/.test(transaction_id || "")
    ? transaction_id
    : `RC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

  // Request shape: partner-docs.covergenius.com/offers/vertical-examples/product-retail/create-offer
  // (the schema Cover Genius pointed to). `schema` names server-side config on the partner; if omitted the
  // partner's default schema is used, so it is only sent when XCOVER_SCHEMA is set. A 422
  // `offer_validation_schema_required` from staging is the signal to ask the CSE for the identifier.
  const offerRequest = {
    ...(process.env.XCOVER_SCHEMA ? { schema: process.env.XCOVER_SCHEMA } : {}),
    customer: { language, currency, country },
    context: {
      purchase_date: new Date().toISOString(),
      product: {
        sku: product.sku,
        title: product.name,
        category: product.category,
        quantity,
        condition: "new",
        description: product.description,
        retail_value: product.price,
      },
    },
    // RealCheap's own order reference — the natural key a retry must reuse so a re-sent request can't double-issue.
    partner: { transaction_id: txn },
  };

  // Eligibility is XCover's decision (their catalog classification), never this server's. In live mode the
  // request goes up regardless of category and XCover answers. In fixture mode the only thing we choose is
  // WHICH recorded answer stands in: an offer for electronics, the documented 422 for anything else.
  const fixture = product.category.startsWith("electronics/") ? "offer-response.json" : "offer-response-ineligible.json";
  const envelope = await xcover.call("POST", "offers/", offerRequest, fixture);

  // Ledger: remember what was quoted for this order, so confirm can be checked against it.
  const offer = envelope.ok && envelope.response && Array.isArray(envelope.response.products) ? envelope.response : null;
  orders.upsert(txn, {
    sku: product.sku, product_name: product.name, unit_price: product.price, quantity, country, currency,
    offer_id: offer ? offer.id : null,
    quote_ids: offer ? offer.products.map((p) => p.id) : [],
    offer_currency: offer ? offer.currency : null,
    premium_unit: offer ? offer.products[0].details.finance.price.total_amount : null,
    status: offer ? "quoted" : "no_offer",
  }, { event: "create offer", status: envelope.status, mode: envelope.mode, envelope });

  // Our own status reflects reachability only: XCover answered (any status) → 200 with the envelope; unreachable → 502.
  res.status(envelope.status === 0 ? 502 : 200).json({ ...envelope, transaction_id: txn });
});

// GET /api/orders/:txn — the ledger entry for one order (result page, orders view)
app.get("/api/orders/:txn", (req, res) => {
  const order = orders.get(req.params.txn);
  if (!order) return res.status(404).json({ error: "unknown order", transaction_id: req.params.txn });
  res.json(order);
});

// GET /api/orders — every order this process has seen, newest first
app.get("/api/orders", (req, res) => res.json(orders.list()));

// POST /api/orders/:txn/confirm — payment has succeeded; confirm the selected quote(s) with XCover.
// Body: { offer_id, quote_ids, policyholder{first_name,last_name,email,country}, simulate? }
//   simulate: "409" | "423" — fixture mode only; stands in for XCover's duplicate replies so rule 4 can be shown.
app.post("/api/orders/:txn/confirm", async (req, res) => {
  const txn = req.params.txn;
  const { offer_id, quote_ids = [], policyholder = {}, simulate } = req.body || {};
  const order = orders.get(txn);
  if (!order) return res.status(404).json({ error: "unknown order", transaction_id: txn });

  // Rule 3 — the ledger is checked BEFORE XCover is called. A booking that already exists is returned as-is;
  // XCover is not contacted, so a retried confirm cannot issue a second policy even if the key were wrong.
  if (order.booking_id) {
    return res.json({ served_from: "ledger", order, envelope: null,
      note: `Order ${txn} already has booking ${order.booking_id}; XCover was not called.` });
  }
  if (order.offer_id !== offer_id || !quote_ids.length || !quote_ids.every((q) => order.quote_ids.includes(q))) {
    return res.status(409).json({ error: "offer/quotes do not match what was quoted for this order", order });
  }
  for (const f of ["first_name", "last_name", "email", "country"]) {
    if (!policyholder[f]) return res.status(400).json({ error: `policyholder.${f} is required` });
  }

  // Rule 2 — the key is derived from the natural key of this operation, never minted per attempt.
  const key = confirmKey(txn, offer_id, quote_ids);
  const body = { quotes: quote_ids.map((id) => ({ id })), policyholder };
  let fixture = simulate === "409" ? "confirm-response-409.json" : simulate === "423" ? "confirm-response-423.json" : "confirm-response.json";

  // Rule 4 — 409 = XCover already processed this key; the body is the cached original result → success.
  //          423 = still processing → back off and retry (3 attempts). Neither is surfaced as a failure.
  const attempts = [];
  let envelope;
  for (let attempt = 1; attempt <= 3; attempt++) {
    envelope = await xcover.call("POST", `offers/${offer_id}/confirm/`, body, fixture, { "x-idempotency-key": key });
    attempts.push({ attempt, status: envelope.status, elapsed_ms: envelope.elapsed_ms });
    if (envelope.status !== 423) break;
    await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    if (simulate === "423" && attempt === 2) fixture = "confirm-response.json"; // fixture: the lock clears
  }

  const booking = envelope.status === 200 || envelope.status === 409 ? envelope.response : null;
  const updated = orders.upsert(txn, {
    idempotency_key: key,
    policyholder,
    booking_id: booking ? booking.id : order.booking_id || null,
    booking: booking || null,
    status: booking ? "confirmed" : order.status,
  }, { event: "confirm offer", status: envelope.status, mode: envelope.mode, idempotency_key: key, attempts, envelope });

  res.status(envelope.status === 0 ? 502 : 200).json({
    served_from: "xcover",
    treated_as_success: !!booking,
    replayed: envelope.status === 409,
    attempts,
    order: updated,
    envelope,
  });
});

// POST /api/orders/:txn/refund — RealCheap refund event (a product return). Consideration #4.
// XCover calculates the premium refund but never moves money; RealCheap refunds the customer. So the duplicate-
// compensation risk is RealCheap's, and the guard is the ledger: cancel ONCE, refund ONCE, product + premium in a
// single record. The cancel endpoint documents no idempotency key and is irreversible — rule 5 lives here.
app.post("/api/orders/:txn/refund", async (req, res) => {
  const txn = req.params.txn;
  const { reason = "Product returned" } = req.body || {};
  const order = orders.get(txn);
  if (!order) return res.status(404).json({ error: "unknown order", transaction_id: txn });
  if (!order.payment) return res.status(409).json({ error: "order was never paid; nothing to refund", order });

  // Rule 5 — already refunded: answer from the ledger, call nothing, pay nothing again.
  if (order.refund) {
    return res.json({ served_from: "ledger", order, envelopes: [],
      note: `Order ${txn} was already refunded ${order.refund.total_formatted} on ${order.refund.at}; XCover was not called and no second refund was issued.` });
  }

  const productRefund = order.unit_price * order.quantity;
  const envelopes = [];
  let premiumRefund = 0, cancelBody = null;

  if (order.booking_id && order.status === "confirmed") {
    const body = { reason_for_cancellation: reason, quotes: order.quote_ids.map((id) => ({ id })) };
    // Guide: "always preview the cancellation to show the customer the refund amount before processing".
    const preview = await xcover.call("POST", `bookings/${order.booking_id}/cancel`, { ...body, preview: true }, "cancel-preview.json");
    envelopes.push({ event: "cancel booking (preview)", envelope: preview });
    if (preview.ok) {
      const cancel = await xcover.call("POST", `bookings/${order.booking_id}/cancel`, { ...body, preview: false }, "cancel-response.json");
      envelopes.push({ event: "cancel booking", envelope: cancel });
      if (cancel.ok) { cancelBody = cancel.response; premiumRefund = Number((cancelBody.refund && cancelBody.refund.amount) || 0); }
      else return res.status(cancel.status === 0 ? 502 : 200).json({ served_from: "xcover", cancelled: false, order, envelopes, error: "XCover did not cancel the booking; no refund issued — retry later" });
    } else {
      return res.status(preview.status === 0 ? 502 : 200).json({ served_from: "xcover", cancelled: false, order, envelopes, error: "cancellation preview failed; no refund issued — retry later" });
    }
  }

  // ONE refund record, product + premium, written once.
  const refund = {
    product_amount: productRefund, premium_amount: premiumRefund, total: productRefund + premiumRefund,
    total_formatted: `$${(productRefund + premiumRefund).toFixed(2)}`, currency: "USD", reason, at: new Date().toISOString(),
    xcover_cancellation: cancelBody ? { booking_id: cancelBody.id, status: cancelBody.status, cancelled_at: cancelBody.cancelled_at, refund: cancelBody.refund } : null,
  };
  let updated = order;
  for (const e of envelopes) updated = orders.upsert(txn, {}, { event: e.event, status: e.envelope.status, mode: e.envelope.mode, envelope: e.envelope });
  // Overlay the cancellation onto the stored booking per quote — the cancel reply is slimmer than the confirm reply,
  // and replacing the quotes array wholesale would drop policy details the result page still shows.
  const booking = cancelBody && order.booking ? {
    ...order.booking, status: cancelBody.status, cancelled_at: cancelBody.cancelled_at,
    quotes: (order.booking.quotes || []).map((q) => ({ ...q, ...((cancelBody.quotes || []).find((c) => c.id === q.id) || {}) })),
  } : order.booking;
  updated = orders.upsert(txn, { refund, booking, status: cancelBody ? "cancelled" : "refunded" },
    { event: "refund (simulated)", status: 200, refund });
  res.json({ served_from: "xcover", cancelled: !!cancelBody, order: updated, envelopes });
});

// POST /api/orders/:txn/pay — SIMULATED payment. RealCheap is merchant of record (XCover Single Payment):
// the premium is a line item in RealCheap's own checkout, collected by RealCheap's PSP, which is out of scope here.
app.post("/api/orders/:txn/pay", async (req, res) => {
  const order = orders.get(req.params.txn);
  if (!order) return res.status(404).json({ error: "unknown order" });
  const { protection } = req.body || {};
  await new Promise((r) => setTimeout(r, 600));
  const premium = protection === "accepted" && order.premium_unit ? order.premium_unit * order.quantity : 0;
  const updated = orders.upsert(order.transaction_id, {
    protection: protection || "undecided",
    payment: { status: "simulated_success", amount: order.unit_price * order.quantity + premium, at: new Date().toISOString() },
    status: protection === "accepted" ? "paid" : "paid_no_protection",
  }, { event: "payment (simulated)", status: 200 });
  res.json({ order: updated });
});

// POST /api/webhooks - XCover webhook endpoint
// XCover signs each delivery with the key/secret pair the partner registers via their CSE,
// and retries up to 3 times on a non-200 response.
app.post("/api/webhooks", async (req, res) => {
  console.log("\n=== WEBHOOK RECEIVED ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Request body:", JSON.stringify(req.body, null, 2));

  try {
    // Signature validation (Important for production!)
    // XCOVER_WEBHOOK_KEY / XCOVER_WEBHOOK_SECRET are the pair you give your CSE when registering the listener URL.
    if (process.env.XCOVER_WEBHOOK_SECRET) {
      const result = verifyXcoverWebhook(
        req.headers,
        process.env.XCOVER_WEBHOOK_SECRET,
      );
      if (!result.ok) {
        console.error("Signature validation failed:", result.reason);
        return res.status(401).send("Signature validation failed");
      }
      console.log("Signature validation: PASSED ✓");
    } else {
      console.warn(
        "⚠️  WARNING: XCOVER_WEBHOOK_SECRET not set - signature validation skipped",
      );
      console.warn("⚠️  Add XCOVER_WEBHOOK_SECRET to .env for production use");
    }

    // Here you would typically:
    // 1. Update order / policy status in your database
    // 2. Notify the customer
    // Example:
    // await updatePolicyStatus(req.body);

    console.log("========================\n");

    // Always return 200 to acknowledge receipt
    // This tells XCover to stop retrying this webhook
    res.status(200).send("[accepted]");
  } catch (error) {
    console.error("Error processing webhook:", error);
    // Return 500 so XCover will retry the webhook
    res.status(500).send("Error processing webhook");
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
