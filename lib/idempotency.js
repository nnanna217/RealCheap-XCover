// Idempotency keys — CLAUDE.md → Idempotency, rule 2.
// The key is DERIVED from the natural key of the operation, never minted per attempt. Same order, same offer,
// same quotes → same key on every retry, reload or worker. It is still a valid UUID (v5), which is what the
// x-idempotency-key header asks for; the point is that a retry can't accidentally produce a new one.
const crypto = require("crypto");

// Fixed namespace for RealCheap-derived keys. Changing it would change every key, so it never changes.
const REALCHEAP_NAMESPACE = "d2c7b3e4-6a1f-4c9d-8e5b-3f0a1c2d4e6f";

function uuidv5(name, namespace = REALCHEAP_NAMESPACE) {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = crypto.createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function confirmKey(transactionId, offerId, quoteIds) {
  return uuidv5(`confirm:${transactionId}:${offerId}:${[...quoteIds].sort().join(",")}`);
}

function cancelKey(transactionId, bookingId) {
  return uuidv5(`cancel:${transactionId}:${bookingId}`);
}

module.exports = { uuidv5, confirmKey, cancelKey, REALCHEAP_NAMESPACE };
