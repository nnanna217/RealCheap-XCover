// XCover Offers API client. Every call returns an "envelope" the UI can show verbatim:
//   { mode, ok, status, elapsed_ms, request: { method, url, headers, body }, response: <body>, error? }
// Secrets never leave this process: Authorization / X-Api-Key are redacted in the envelope.
const fs = require("fs");
const path = require("path");
const { xcoverAuthHeaders } = require("./xcover-auth");

const MODE = (process.env.XCOVER_MODE || "fixture").toLowerCase(); // fixture | live
const TIMEOUT_MS = Number(process.env.XCOVER_TIMEOUT_MS || 8000);
const FIXTURES = path.join(__dirname, "..", "fixtures");

function redact(headers) {
  const out = { ...headers };
  for (const k of Object.keys(out)) if (/^(authorization|x-api-key)$/i.test(k)) out[k] = "***";
  return out;
}

async function call(method, relPath, body, fixtureFile, extraHeaders = {}) {
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
    const response = JSON.parse(fs.readFileSync(path.join(FIXTURES, fixtureFile), "utf8"));
    const status = response._status || 200; // a fixture can stand in for a non-2xx reply (e.g. a documented 422)
    return { ...envelope, ok: status < 400, status, elapsed_ms: Date.now() - started, response: status === 204 ? null : response };
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
