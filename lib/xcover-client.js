// XCover Offers API client. Every call returns an "envelope" the UI can show verbatim:
//   { mode, ok, status, elapsed_ms, request: { method, url, headers, body }, response: <body>, error? }
// Secrets never leave this process: Authorization / X-Api-Key are redacted in the envelope.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { xcoverAuthHeaders } = require("./xcover-auth");

const MODE = (process.env.XCOVER_MODE || "fixture").toLowerCase(); // fixture | live
const TIMEOUT_MS = Number(process.env.XCOVER_TIMEOUT_MS || 8000);
const FIXTURES = path.join(__dirname, "..", "fixtures");

function redact(headers) {
  const out = { ...headers };
  for (const k of Object.keys(out)) if (/^(authorization|x-api-key)$/i.test(k)) out[k] = "***";
  return out;
}

// Fixture adaptations — the two ways a static file misrepresents the real API, corrected in fixture mode:
//   freshIds:  a real create-offer returns NEW offer/quote ids every call (the docs say never cache offers).
//   echoQuoteIds / echoTxn: a real confirm/cancel echoes the ids you sent. Values only; structure stays the file's.
function adaptFixture(response, adapt, body) {
  if (!response || !adapt) return response;
  const r = JSON.parse(JSON.stringify(response));
  if (adapt.freshIds && Array.isArray(r.products)) {
    r.id = crypto.randomUUID();
    if (r.session_id) r.session_id = crypto.randomUUID();
    for (const p of r.products) {
      const fresh = crypto.randomUUID();
      // content.products[] is matched to products[] by id (live shape) — keep them in step.
      for (const c of (r.content && r.content.products) || []) if (c.id === p.id) c.id = fresh;
      p.id = fresh;
    }
  }
  if (adapt.echoQuoteIds && Array.isArray(r.quotes) && body && Array.isArray(body.quotes)) {
    body.quotes.forEach((q, i) => { if (r.quotes[i]) r.quotes[i].id = q.id; });
  }
  if (adapt.echoTxn && "partner_transaction_id" in r) r.partner_transaction_id = adapt.echoTxn;
  // A real confirm returns the policyholder that was sent, not a placeholder.
  if (adapt.echoPolicyholder && body && body.policyholder) {
    const { first_name, last_name, email, country } = body.policyholder; // the documented response fields
    r.policyholder = { first_name, last_name, email, country };
  }
  if (adapt.echoPrice && Array.isArray(r.quotes)) {
    // A real confirm returns the price that was quoted, and a real cancel refunds what was charged; the static file
    // can't know either, so echo the ledger's quote (currency, unit × quantity).
    const { currency } = adapt.echoPrice, sym = { USD: "US$", CAD: "CA$", GBP: "£", EUR: "€" }[currency] || "";
    const total = Number((adapt.echoPrice.total || 0).toFixed(2)), tax = Number((adapt.echoPrice.tax || 0).toFixed(2)), unit = total, fmt = (n) => `${sym}${n.toFixed(2)}`;
    r.currency = currency;
    // Live shape: total_price is inc-tax (= the quote's total_amount); total_premium is ex-tax; total_tax is the difference.
    if ("total_premium" in r) { r.total_price = total; r.total_price_formatted = fmt(total); r.total_tax = tax; r.total_tax_formatted = fmt(tax); r.total_premium = Number((total - tax).toFixed(2)); r.total_premium_formatted = fmt(total - tax); }
    for (const q of r.quotes) { q.price = unit; q.price_formatted = fmt(unit); if (q.policy) q.policy.policy_currency = currency; if ("refund_value" in q) q.refund_value = unit;
      if (q.tax) { q.tax.total_tax = tax; q.tax.total_tax_formatted = fmt(tax); q.tax.total_amount_without_tax = Number((total - tax).toFixed(2)); q.tax.total_amount_without_tax_formatted = fmt(total - tax); if (Array.isArray(q.tax.taxes) && q.tax.taxes[0]) { q.tax.taxes[0].tax_amount = tax; q.tax.taxes[0].tax_amount_formatted = fmt(tax); } } }
    if ("refund_amount" in r) { r.refund_amount = total; r.refund_amount_formatted = fmt(total); }
    if ("total_refund" in r) { r.total_refund = total; r.total_refund_formatted = fmt(total); }
    if ("total_price" in r) { r.total_price = total; r.total_price_formatted = fmt(total); }
  }
  return r;
}

async function call(method, relPath, body, fixtureFile, extraHeaders = {}, adapt = null) {
  const url = `${(process.env.XCOVER_BASE_URL || "").replace(/\/$/, "")}/${process.env.XCOVER_PARTNER_CODE}/${relPath}`;
  const headers = {
    ...xcoverAuthHeaders(process.env.XCOVER_API_KEY || "unset", process.env.XCOVER_API_SECRET || "unset"),
    "Content-Type": "application/json",
    "X-API-Error-Version": "v2",
    ...extraHeaders, // e.g. x-idempotency-key — shown unredacted in the envelope on purpose
  };
  const envelope = { mode: MODE, request: { method, url, headers: redact(headers), body } };
  const started = Date.now();

  if (MODE === "fixture") {
    let file = fixtureFile;
    if (!fs.existsSync(path.join(FIXTURES, file)) && adapt && adapt.fallbackFile) file = adapt.fallbackFile;
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
    const status = raw._status || 200; // a fixture can stand in for a non-2xx reply (e.g. a documented 422)
    const response = status === 204 ? null : adaptFixture(raw, adapt, body);
    return { ...envelope, ok: status < 400, status, elapsed_ms: Date.now() - started, response };
  }

  const timeoutMs = (adapt && adapt.timeoutMs) || TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    let response; try { response = JSON.parse(text); } catch { response = text; }
    return { ...envelope, ok: res.ok, status: res.status, elapsed_ms: Date.now() - started, response };
  } catch (err) {
    const error = err.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err.message;
    return { ...envelope, ok: false, status: 0, elapsed_ms: Date.now() - started, response: null, error };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { call, MODE };
