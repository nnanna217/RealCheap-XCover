const express = require("express");
const path = require("path");
require("dotenv").config();
const { verifyXcoverWebhook } = require("./lib/xcover-auth");
const xcover = require("./lib/xcover-client");
const orders = require("./lib/orders");
const { confirmKey } = require("./lib/idempotency");
const webhooks = require("./lib/webhooks");
const crypto = require("crypto");
const { findProduct } = require("./public/js/products");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
// Scrub secrets from anything that leaves the server as JSON (route responses and ledger history alike); the ledger itself is untouched.
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => json(scrubSecrets(body));
  next();
});
function scrubSecrets(v) {
  if (Array.isArray(v)) return v.map(scrubSecrets);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = k === "security_token" ? "***" : scrubSecrets(val);
    return out;
  }
  // Live finding: COI / FNOL / payout links carry the token as a query parameter.
  if (typeof v === "string") return v.replace(/([?&]security_token=)[^&#\s"]+/gi, "$1***");
  return v;
}
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => { if (/\.(js|css)$/.test(req.path)) res.set("Cache-Control", "no-store"); next(); });
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
  // …and a completed order is no longer a cart: if the ref already belongs to a paid/confirmed/refunded order
  // (the shopper pressed Back after checkout), start a new order rather than mutate the finished one.
  const prior = /^RC-[A-Z0-9-]{6,}$/.test(transaction_id || "") ? orders.get(transaction_id) : null;
  const reusable = prior ? !(prior.payment || prior.booking_id || prior.refund || prior.opt_out) : /^RC-[A-Z0-9-]{6,}$/.test(transaction_id || "");
  const txn = reusable ? transaction_id : `RC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();

  // Request shape: partner-docs.covergenius.com/offers/vertical-examples/product-retail/create-offer
  // (the schema Cover Genius pointed to). `schema` names server-side config on the partner; if omitted the
  // partner's default schema is used, so it is only sent when XCOVER_SCHEMA is set. A 422
  // `offer_validation_schema_required` from staging is the signal to ask the CSE for the identifier.
  // Plan requested and shipping assumptions — see CLAUDE.md → Assumptions (A7, A8).
  const PLAN_TERM = "2y";
  const purchase = new Date();
  const plusDays = (d) => new Date(purchase.getTime() + d * 86400000).toISOString();
  const device = /Mobi|Android|iPhone/i.test(req.get("User-Agent") || "") ? "mobile" : "desktop";

  const offerRequest = {
    ...(process.env.XCOVER_SCHEMA ? { schema: process.env.XCOVER_SCHEMA } : {}),
    customer: { currency, country, language },
    // customer.region omitted: the checkout collects country only. customer_id omitted: guest checkout, no login.
    // RealCheap's own order reference — the natural key a retry must reuse so a re-sent request can't double-issue.
    partner: {
      transaction_id: txn,
      metadata: { merchant_id: `REALCHEAP-ONLINE-${country}`, merchant_name: "RealCheap", sales_channel: "online", device },
    },
    context: {
      purchase_date: purchase.toISOString(),
      estimated_shipping_date: plusDays(7),   // A8: factory-direct — ships ~7 days, delivers ~14 days after purchase
      estimated_delivery_date: plusDays(14),
      product: {
        sku: product.sku,
        brand: product.brand,
        model: product.model,
        title: product.name,
        variant: PLAN_TERM,
        category: product.category,
        category_id: product.category_id,
        quantity,
        condition: "new",
        description: product.description,
        retail_value: product.price,
        // wholesale_value omitted: known to RealCheap's OMS, not to the storefront
        term: PLAN_TERM,
      },
      warranty: { manufacturer_duration: "1y", term: PLAN_TERM, benefit: "accidental damage and extended warranty" }, // A7
    },
  };

  // Optional partner-side guard (RC_ELIGIBLE_CATEGORIES, comma-separated prefixes). OFF by default. Live finding:
  // E3CCM on staging quotes any SKU — a $4 sleeve gets a plan — because no eligibility rule is configured on the
  // partner; in production that rule lives in the offer schema / catalog classification. This guard is RealCheap
  // choosing not to ask, recorded as a LOCAL decision (no XCover call), never dressed up as an XCover answer.
  const allow = (process.env.RC_ELIGIBLE_CATEGORIES || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (allow.length && !allow.some((pre) => product.category.startsWith(pre))) {
    orders.upsert(txn, { sku: product.sku, product_name: product.name, unit_price: product.price, quantity, country, currency, offer_id: null, quote_ids: [], status: "no_offer", local_rule: `category ${product.category} not in RC_ELIGIBLE_CATEGORIES` },
      { event: "eligibility (RealCheap rule, no XCover call)", status: 0, outcome: "not_offered" });
    return res.json({ mode: xcover.MODE, ok: false, status: 0, local_rule: true, elapsed_ms: 0, request: null, response: { code: "realcheap_category_not_eligible", message: `RealCheap does not offer protection on ${product.category}` }, transaction_id: txn });
  }
  // Eligibility is XCover's decision (their catalog classification), never this server's. In live mode the
  // request goes up regardless of category and XCover answers. In fixture mode the only thing we choose is
  // WHICH recorded answer stands in: an offer for electronics, the documented 422 for anything else.
  // Fixture file by category (eligibility stand-in) and by requested currency (offer-response.<CUR>.json, USD default);
  // fresh offer/quote ids per call, as the real API returns.
  const fixture = product.category.startsWith("electronics/") ? `offer-response.${currency}.json` : "offer-response-ineligible.json";
  const envelope = await xcover.call("POST", "offers/", offerRequest, fixture, {}, { fallbackFile: "offer-response.json", freshIds: true, timeoutMs: Number(process.env.XCOVER_OFFER_TIMEOUT_MS || 3000) });

  // Ledger: remember what was quoted for this order, so confirm can be checked against it.
  const offer = envelope.ok && envelope.response && Array.isArray(envelope.response.products) ? envelope.response : null;
  orders.upsert(txn, {
    sku: product.sku, product_name: product.name, unit_price: product.price, quantity, country, currency,
    offer_id: offer ? offer.id : null,
    quote_ids: offer ? offer.products.map((p) => p.id) : [],
    quote_count: ((orders.get(txn) || {}).quote_count || 0) + 1,
    superseded_offer_ids: (() => { const prev = orders.get(txn); return prev && prev.offer_id && offer && prev.offer_id !== offer.id ? [...(prev.superseded_offer_ids || []), prev.offer_id] : (prev && prev.superseded_offer_ids) || []; })(),
    offer_currency: offer ? offer.currency : null,
    // Live finding: total_amount is the rated TOTAL for context.product.quantity, not a unit price (A3 settled).
    premium_total: offer ? offer.products[0].details.finance.price.total_amount : null,
    premium_unit: offer ? Number((offer.products[0].details.finance.price.total_amount / quantity).toFixed(2)) : null,
    plans: offer ? offer.products.map((p) => ({ quote_id: p.id, title: ((offer.content && offer.content.products) || []).find((c) => c.id === p.id)?.title || p.name, total: p.details.finance.price.total_amount, total_formatted: p.details.finance.price.total_amount_formatted, tax: Number((p.details.finance.tax && p.details.finance.tax.total_amount) || 0) })) : [],
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
  const { offer_id, quote_ids = [], policyholder = {} } = req.body || {};
  // `simulate` / `force_xcover` are demo hooks; ignored outright outside fixture mode.
  const simulate = xcover.MODE === "fixture" ? (req.body || {}).simulate : undefined;
  const force_xcover = xcover.MODE === "fixture" ? !!(req.body || {}).force_xcover : false;
  const order = orders.get(txn);
  if (!order) return res.status(404).json({ error: "unknown order", transaction_id: txn });

  // Rule 3 — the ledger is checked BEFORE XCover is called. A booking that already exists is returned as-is;
  // XCover is not contacted, so a retried confirm cannot issue a second policy even if the key were wrong.
  // `force_xcover` (fixture mode, demo only) skips this guard so the panel can see XCover's own 409 on a repeat.
  const bypass = force_xcover && xcover.MODE === "fixture" && order.booking_id;
  if (order.booking_id && !bypass) {
    const note = `Order ${txn} already has booking ${order.booking_id}; XCover was not called.`;
    const updated = orders.upsert(txn, {}, { event: "confirm offer (repeat)", status: 200, outcome: "served_from_ledger", note });
    return res.json({ served_from: "ledger", order: updated, envelope: null, note });
  }
  // Invariant: confirm fires only after payment succeeded. Enforced here, not just by the page's order of operations.
  if (!order.payment) return res.status(409).json({ error: "order has not been paid; confirm is only sent after payment succeeds", order });
  // A confirm we refuse ourselves still gets recorded: after payment, an unconfirmed plan is a liability the
  // OMS must see and retry — never a silent no-op.
  const reject = (status, error) => {
    const updated = orders.upsert(txn, { confirm_error: { error, at: new Date().toISOString() } }, { event: "confirm offer (rejected locally)", status, outcome: "rejected", note: error });
    return res.status(status).json({ error, order: updated });
  };
  if (order.offer_id !== offer_id || !quote_ids.length || !quote_ids.every((q) => order.quote_ids.includes(q)))
    return reject(409, "offer/quotes do not match what was quoted for this order");
  // Confirm Offer guide: policyholder email, phone, first_name, last_name, country are required.
  for (const f of ["first_name", "last_name", "email", "phone", "country"])
    if (!policyholder[f]) return reject(400, `policyholder.${f} is required`);

  // Rule 2 — the key is derived from the natural key of this operation, never minted per attempt.
  const key = confirmKey(txn, offer_id, quote_ids);
  // Request body per the Confirm Offer guide. partner_transaction_id here is what XCover echoes back on
  // BOOKING_* webhooks (their examples show null because they never sent one) — it is how webhooks route to us.
  const body = {
    quotes: quote_ids.map((id) => ({ id })),
    policyholder,
    partner_transaction_id: txn,
    // payment_details is optional and XCover validates `provider` against real PSP names (staging rejected a
    // made-up one with offer_validation_request_invalid). Sent only when a real provider is configured.
    ...(process.env.XCOVER_PAYMENT_PROVIDER ? { payment_details: { provider: process.env.XCOVER_PAYMENT_PROVIDER, transaction_id: order.payment.id } } : {}),
  };
  const sim = bypass ? "409" : simulate;
  let fixture = sim === "409" ? "confirm-response-409.json" : sim === "423" ? "confirm-response-423.json" : "confirm-response.json";

  // Rule 4 — 409 = XCover already processed this key; the body is the cached original result → success.
  //          423 = still processing → back off and retry (3 attempts). Neither is surfaced as a failure.
  const attempts = [];
  let envelope;
  for (let attempt = 1; attempt <= 3; attempt++) {
    envelope = await xcover.call("POST", `offers/${offer_id}/confirm/`, body, fixture, { "x-idempotency-key": key },
      { echoQuoteIds: true, echoTxn: txn, echoPolicyholder: true, echoPrice: (() => { const cp = (order.plans || []).find((p) => quote_ids.includes(p.quote_id)); return { currency: order.offer_currency || "USD", total: cp ? cp.total : order.premium_total || 0, tax: cp ? cp.tax : 0 }; })() });
    attempts.push({ attempt, status: envelope.status, elapsed_ms: envelope.elapsed_ms });
    if (envelope.status !== 423) break;
    await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    if (simulate === "423" && attempt === 2) fixture = "confirm-response.json"; // fixture: the lock clears
  }

  const booking = envelope.status === 200 || envelope.status === 409 ? envelope.response : null;
  // Post-response validations the guide asks the partner to perform:
  //  - an `errors` object on a success "indicates an important logic error during booking that should be investigated";
  //  - the confirmed price must match the price quoted at Create Offer.
  const review = [];
  if (booking && booking.errors && Object.keys(booking.errors).length) review.push({ code: "booking_errors_present", detail: booking.errors });
  // Live finding: booking.total_price is the inc-tax total and equals the quote's total_amount; total_premium is EX-tax.
  const chosenPlan = (order.plans || []).find((p) => quote_ids.includes(p.quote_id));
  const quotedTotal = Number(((chosenPlan ? chosenPlan.total : order.premium_total) || 0).toFixed(2));
  const confirmedTotal = typeof booking?.total_price === "number" ? booking.total_price : (booking?.quotes || []).reduce((s, q) => s + Number(q.price || 0), 0);
  if (booking && confirmedTotal && Math.abs(confirmedTotal - quotedTotal) > 0.005)
    review.push({ code: "price_mismatch", detail: `quoted ${order.offer_currency} ${quotedTotal}, confirmed ${booking.currency} ${confirmedTotal}` });
  const chosen = (order.plans || []).find((p) => quote_ids.includes(p.quote_id));
  const updated = orders.upsert(txn, {
    idempotency_key: key,
    policyholder,
    confirmed_quote_ids: booking ? quote_ids : order.confirmed_quote_ids || null,
    plan_title: chosen ? chosen.title : order.plan_title || null,
    ...(chosen && booking ? { premium_total: chosen.total } : {}),
    booking_id: booking ? booking.id : order.booking_id || null,
    booking: booking || order.booking || null,
    status: booking ? "confirmed" : order.status,
    confirm_error: booking ? null : { error: envelope.error || `XCover replied HTTP ${envelope.status}${envelope.response && envelope.response.code ? " " + envelope.response.code : ""}`, at: new Date().toISOString() },
    ...(review.length ? { needs_review: review } : {}),
  }, { event: bypass ? "confirm offer (forced past ledger)" : "confirm offer", status: envelope.status, mode: envelope.mode, idempotency_key: key, attempts, envelope, ...(review.length ? { review } : {}) });

  res.status(envelope.status === 0 ? 502 : 200).json({
    served_from: "xcover",
    treated_as_success: !!booking,
    replayed: envelope.status === 409,
    attempts,
    review,
    order: updated,
    envelope,
  });
});

// POST /api/orders/:txn/opt-out — the shopper declined the offer. XCover records it for conversion tracking
// (204 No Content). Fired when the decision is frozen (Continue to payment), not on the click — a shopper
// can change their mind. Idempotent via the ledger; a repeat is answered without a call.
app.post("/api/orders/:txn/opt-out", async (req, res) => {
  const txn = req.params.txn;
  const order = orders.get(txn);
  if (!order) return res.status(404).json({ error: "unknown order", transaction_id: txn });
  if (!order.offer_id) return res.status(409).json({ error: "no offer was made on this order; nothing to opt out of", order });
  if (order.booking_id) return res.status(409).json({ error: "offer was confirmed; opt-out no longer applies", order });
  if (order.opt_out) {
    const note = `Opt-out for ${txn} already recorded at ${order.opt_out.at}; XCover was not called.`;
    const updated = orders.upsert(txn, {}, { event: "opt out (repeat)", status: 200, outcome: "served_from_ledger", note });
    return res.json({ served_from: "ledger", order: updated, envelope: null, note });
  }

  const envelope = await xcover.call("POST", `offers/${order.offer_id}/opt_out/`, null, "opt-out-response.json");
  const updated = orders.upsert(txn, envelope.ok ? { opt_out: { at: new Date().toISOString() }, protection: "declined", status: "declined" } : {},
    { event: "opt out", status: envelope.status, mode: envelope.mode, envelope });
  res.status(envelope.status === 0 ? 502 : 200).json({ served_from: "xcover", recorded: envelope.ok, order: updated, envelope });
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
    const note = `Order ${txn} was already refunded ${order.refund.total_formatted} on ${order.refund.at}; XCover was not called and no second refund was issued.`;
    const updated = orders.upsert(txn, {}, { event: "refund (repeat)", status: 200, outcome: "served_from_ledger", note });
    return res.json({ served_from: "ledger", order: updated, envelopes: [], note });
  }

  const productRefund = order.unit_price * order.quantity;
  const envelopes = [];
  let premiumRefund = 0, cancelBody = null;

  if (order.booking_id && order.status === "confirmed") {
    // Live finding: the API rejects `reason_for_cancellation` ("Unexpected field") despite the guide; body is preview + quotes.
    const body = { quotes: (order.confirmed_quote_ids || order.quote_ids).map((id) => ({ id })) };
    // Guide: "always preview the cancellation to show the customer the refund amount before processing".
    const echo = { echoQuoteIds: true, echoPrice: { currency: order.offer_currency || "USD", total: order.premium_total || 0 } };
    const alreadyCancelled = (e) => e.status === 422 && JSON.stringify(e.response || "").includes("in status CANCELLED");
    const preview = await xcover.call("POST", `bookings/${order.booking_id}/cancel`, { ...body, preview: true }, "cancel-preview.json", {}, echo);
    envelopes.push({ event: "cancel booking (preview)", envelope: preview });
    if (preview.ok) {
      const cancel = await xcover.call("POST", `bookings/${order.booking_id}/cancel`, { ...body, preview: false }, "cancel-response.json", {}, echo);
      envelopes.push({ event: "cancel booking", envelope: cancel });
      if (cancel.ok || alreadyCancelled(cancel)) {
        // Refund per the live shape: top-level refund_amount when present, else the sum of quotes[].refund_value.
        cancelBody = cancel.ok ? cancel.response : { ...preview.response, status: "CANCELLED", _note: "already cancelled on a previous attempt; refund figures from the preview" };
        premiumRefund = typeof cancelBody.refund_amount === "number" ? cancelBody.refund_amount : (cancelBody.quotes || []).reduce((s, q) => s + Number(q.refund_value || 0), 0);
      }
      else return res.status(cancel.status === 0 ? 502 : 200).json({ served_from: "xcover", cancelled: false, order, envelopes, error: "XCover did not cancel the booking; no refund issued — retry later" });
    } else {
      return res.status(preview.status === 0 ? 502 : 200).json({ served_from: "xcover", cancelled: false, order, envelopes, error: "cancellation preview failed; no refund issued — retry later" });
    }
  }

  // ONE refund record, product + premium, written once. Product is USD (RealCheap list price); premium is in the
  // offer currency (what XCover charged). Two currencies are two amounts — never summed with an invented rate (A5).
  const premiumCurrency = (cancelBody && cancelBody.currency) || order.offer_currency || "USD";
  const fmt = (n, c) => new Intl.NumberFormat("en", { style: "currency", currency: c }).format(n);
  const sameCurrency = premiumCurrency === "USD";
  const refund = {
    product_amount: productRefund, product_currency: "USD",
    premium_amount: premiumRefund, premium_currency: premiumCurrency,
    total: sameCurrency ? Number((productRefund + premiumRefund).toFixed(2)) : null,
    total_formatted: sameCurrency ? fmt(productRefund + premiumRefund, "USD") : `${fmt(productRefund, "USD")} + ${fmt(premiumRefund, premiumCurrency)}`,
    reason, at: new Date().toISOString(),
    xcover_cancellation: cancelBody ? { booking_id: cancelBody.id, status: cancelBody.status, cancellation_id: cancelBody.cancellation_id || null, cancelled_at: (cancelBody.quotes || [])[0]?.policy_cancellation_date || null, cooling_off_until: (cancelBody.quotes || [])[0]?.policy_coolingoff_date || null, adjustment_fee: (cancelBody.quotes || [])[0]?.adjustment_fee ?? null, refund_amount: premiumRefund } : null,
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

// POST /api/demo/webhook — SIMULATE an inbound XCover webhook for an order.
// Builds the documented payload for the event from the ledger, signs it EXACTLY as XCover would (HMAC over the
// Date header with XCOVER_WEBHOOK_SECRET), and POSTs it to this server's own /api/webhooks — so the request
// genuinely traverses signature verification and routing. Body: { event: "BOOKING_CREATED"|"BOOKING_UPDATED"|
// "BOOKING_CANCELLED", tamper?: true, omit_partner_txn?: true }. Also reachable from scripts/send-webhook.sh.
app.post("/api/demo/webhook", async (req, res) => {
  // Demo only. In live mode this endpoint must not exist: it signs with the real webhook secret and could inject
  // a BOOKING_CANCELLED for any order — a forged-event vector, not a feature.
  if (xcover.MODE !== "fixture") return res.status(404).json({ error: "demo endpoints are only available in XCOVER_MODE=fixture" });
  const { transaction_id, event = "BOOKING_CANCELLED", tamper = false, omit_partner_txn = false } = req.body || {};
  const order = orders.get(transaction_id);
  if (!order) return res.status(404).json({ error: "unknown order" });
  if (!order.booking_id) return res.status(409).json({ error: "order has no booking; XCover would not send a booking event" });
  const secret = process.env.XCOVER_WEBHOOK_SECRET;
  if (!secret) return res.status(409).json({ error: "XCOVER_WEBHOOK_SECRET is not set in .env — the simulator signs exactly as XCover would, so it needs the shared secret" });

  const status = event === "BOOKING_CANCELLED" ? "CANCELLED" : "CONFIRMED";
  const quotes = (order.booking && order.booking.quotes || []).map((q) => ({
    id: q.id, policy_start_date: q.policy_start_date, policy_end_date: q.policy_end_date, status,
    price: q.price, price_formatted: q.price_formatted, policy: q.policy, total_renewed_times: 0,
    ...(status === "CANCELLED" ? { refund_value: q.price } : {}),
  }));
  const body = { event, payload: {
    id: order.booking_id, status, currency: order.booking.currency || "USD",
    total_price: status === "CANCELLED" ? 0 : order.booking.total_price, total_price_formatted: status === "CANCELLED" ? "US$0.00" : order.booking.total_price_formatted,
    partner_transaction_id: omit_partner_txn ? null : order.transaction_id, quotes,
  } };

  // Sign like XCover: HMAC-SHA256 over `date: <Date>` (their JS reference), base64, URL-encoded.
  const date = new Date().toUTCString();
  const sig = encodeURIComponent(crypto.createHmac("sha256", tamper ? "wrong-secret" : secret).update(`date: ${date}`, "utf8").digest("base64"));
  const headers = { "Content-Type": "application/json", Date: date, "X-Api-Key": process.env.XCOVER_WEBHOOK_KEY || "demo-key",
    Authorization: `Signature keyId="${process.env.XCOVER_WEBHOOK_KEY || "demo-key"}",algorithm="hmac-sha256",signature="${sig}"`, "X-RealCheap-Simulated": "1" };
  const r = await fetch(`http://localhost:${PORT}/api/webhooks`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  res.json({ sent: { url: "/api/webhooks", headers: { ...headers, Authorization: headers.Authorization.replace(/signature="[^"]+"/, 'signature="***"') }, body }, received: { status: r.status, body: json }, order: orders.get(transaction_id) });
});

// POST /api/orders/:txn/pay — SIMULATED payment. RealCheap is merchant of record (XCover Single Payment):
// the premium is a line item in RealCheap's own checkout, collected by RealCheap's PSP, which is out of scope here.
app.post("/api/orders/:txn/pay", async (req, res) => {
  const order = orders.get(req.params.txn);
  if (!order) return res.status(404).json({ error: "unknown order" });
  const { protection } = req.body || {};
  await new Promise((r) => setTimeout(r, 600));
  const premium = protection === "accepted" && order.premium_total ? order.premium_total : 0;
  const updated = orders.upsert(order.transaction_id, {
    protection: protection || "undecided",
    payment: { id: `PAY-${Date.now().toString(36).toUpperCase()}`, provider: "realcheap-psp (simulated)", status: "simulated_success", amount: order.unit_price * order.quantity + premium, at: new Date().toISOString() },
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
      const result = verifyXcoverWebhook(req.headers, process.env.XCOVER_WEBHOOK_SECRET, { expectedKeyId: process.env.XCOVER_WEBHOOK_KEY || null });
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

    // Route the event into the ledger by partner_transaction_id (fallback: booking id). See lib/webhooks.js.
    const result = webhooks.applyEvent(req.body, { source: req.get("X-RealCheap-Simulated") ? "simulated" : "xcover" });
    console.log("Outcome:", result.outcome, result.note || "");
    if (result.outcome === "rejected") return res.status(400).json({ error: result.reason });

    // Always return 200 to acknowledge receipt
    // This tells XCover to stop retrying this webhook
    res.status(200).json({ accepted: true, outcome: result.outcome, routed_by: result.matched_by || null, key: result.key, note: result.note });
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
