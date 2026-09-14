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
    for (const p of r.products) p.id = crypto.randomUUID();
  }
  if (adapt.echoQuoteIds && Array.isArray(r.quotes) && body && Array.isArray(body.quotes)) {
    body.quotes.forEach((q, i) => { if (r.quotes[i]) r.quotes[i].id = q.id; });
  }
  if (adapt.echoTxn && "partner_transaction_id" in r) r.partner_transaction_id = adapt.echoTxn;
  if (adapt.echoPrice && Array.isArray(r.quotes)) {
    // A real confirm returns the price that was quoted; the static file can't know it, so echo the ledger's quote.
    const { currency, unit, quantity } = adapt.echoPrice, sym = { USD: "$", CAD: "CA$", GBP: "£", EUR: "€" }[currency] || "";
    const total = Number((unit * quantity).toFixed(2)), fmt = (n) => `${sym}${n.toFixed(2)}`;
    r.currency = currency; r.total_price = total; r.total_price_formatted = fmt(total); r.total_premium = total; r.total_premium_formatted = fmt(total);
    for (const q of r.quotes) { q.price = unit; q.price_formatted = fmt(unit); if (q.policy) q.policy.policy_currency = currency; }
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    let response; try { response = JSON.parse(text); } catch { response = text; }
    return { ...envelope, ok: res.ok, status: res.status, elapsed_ms: Date.now() - started, response };
  } catch (err) {
    const error = err.name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : err.message;
    return { ...envelope, ok: false, status: 0, elapsed_ms: Date.now() - started, response: null, error };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { call, MODE };
