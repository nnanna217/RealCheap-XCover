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
