// XCover API request signing.
// Source: partner-docs.covergenius.com → Authentication (matches their Python and Postman reference code).
//
//   signing string : `date: <RFC 1123 date, zero-padded day>`   e.g. "date: Thu, 04 Nov 2021 18:07:11 GMT"
//   signature      : HMAC-SHA512(secret, signing string) → base64 (strict RFC 4648, NOT url-safe) → URL-encode
//   headers        : Date, X-Api-Key, Authorization: Signature keyId="<key>",algorithm="hmac-sha512",signature="<sig>"
//
// Only the Date header is signed — not the method, path, or body — so a fresh Date per request is what defeats replay.
const crypto = require('crypto');

function xcoverAuthHeaders(apiKey, apiSecret, date = new Date().toUTCString()) {
  if (!apiKey || !apiSecret) throw new Error('XCOVER_API_KEY / XCOVER_API_SECRET missing');
  const raw = `date: ${date}`;
  const b64 = crypto.createHmac('sha512', apiSecret).update(raw, 'utf8').digest('base64');
  return {
    Date: date,
    'X-Api-Key': apiKey,
    Authorization: `Signature keyId="${apiKey}",algorithm="hmac-sha512",signature="${encodeURIComponent(b64)}"`,
  };
}

module.exports = { xcoverAuthHeaders };

// Inbound webhook verification — the same scheme in reverse.
// XCover signs `date: <Date header>` with the secret you registered, sends
//   Authorization: Signature keyId="<key>",algorithm="hmac-<sha256|sha384|sha512>",signature="<urlencoded b64>"
// Source: partner-docs.covergenius.com → Webhooks → Authentication (Python/JS reference code).
function verifyXcoverWebhook(headers, secret, opts = {}) {
  const { expectedKeyId = null, maxSkewMs = 5 * 60 * 1000 } = opts;
  const auth = headers['authorization'] || '';
  if (!auth.startsWith('Signature ')) return { ok: false, reason: 'missing Signature header' };
  const parts = {};
  for (const part of auth.slice('Signature '.length).split(',')) {
    const i = part.indexOf('=');
    if (i > 0) parts[part.slice(0, i).trim()] = part.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  const date = headers['date'];
  if (!date) return { ok: false, reason: 'missing Date header' };
  // The signature covers only the Date header, so freshness is the only replay defence: a captured valid request
  // must not verify forever. Reject anything outside the skew window.
  const ts = Date.parse(date);
  if (Number.isNaN(ts)) return { ok: false, reason: 'unparseable Date header' };
  if (Math.abs(Date.now() - ts) > maxSkewMs) return { ok: false, reason: `Date header outside ±${maxSkewMs / 60000} min window (replay?)` };
  if (expectedKeyId && parts.keyId !== expectedKeyId) return { ok: false, reason: 'keyId does not match the registered webhook key' };
  const algo = (parts.algorithm || 'hmac-sha256').replace(/^hmac-/, '');
  if (!['sha256', 'sha384', 'sha512'].includes(algo)) return { ok: false, reason: `unsupported algorithm ${parts.algorithm}` };
  const expected = crypto.createHmac(algo, secret).update(`date: ${date}`, 'utf8').digest();
  let received;
  try { received = Buffer.from(decodeURIComponent(parts.signature || ''), 'base64'); } catch { return { ok: false, reason: 'undecodable signature' }; }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return { ok: false, reason: 'signature mismatch' };
  return { ok: true, keyId: parts.keyId };
}

module.exports.verifyXcoverWebhook = verifyXcoverWebhook;
