// Checkout: quote the XCover protection offer for the cart, let the shopper opt in or decline,
// keep the order total honest. Everything shown about the offer comes from the XCover response.

const CURRENCY_BY_COUNTRY = { US: "USD", CA: "CAD", GB: "GBP", IT: "EUR", FR: "EUR", ES: "EUR", DE: "EUR" };
const LANGUAGE_BY_COUNTRY = { US: "en", CA: "en", GB: "en", IT: "it", FR: "fr", ES: "es", DE: "de" };

const state = {
  product: null,
  qty: 1,
  country: "US",
  transactionId: null, // one per cart — see CLAUDE.md → Idempotency rule 1
  offer: null,         // the XCover offer response, or null when none is available
  envelope: null,      // most recent request/response envelope
  calls: [],           // every envelope this page produced, for the integration log
  protection: "undecided", // undecided | accepted | declined
  noOfferReason: null, // null | "ineligible" (XCover answered no) | "unavailable" (XCover unreachable)
  quoting: false,      // true while a create-offer call is in flight
};

const $ = (id) => document.getElementById(id);

function money(amount, currency) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

function txnKey() { return `rc.txn.${state.product.sku}`; }

async function quote() {
  state.quoting = true;
  state.offer = null;
  state.protection = "undecided";
  render();

  const res = await fetch("/api/offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sku: state.product.sku,
      qty: state.qty,
      country: state.country,
      currency: CURRENCY_BY_COUNTRY[state.country],
      language: LANGUAGE_BY_COUNTRY[state.country],
      transaction_id: state.transactionId,
    }),
  });
  const envelope = await res.json();
  state.envelope = envelope;
  logCall("create offer", envelope);

  // The server mints the order reference once; keep it for this cart across re-quotes and reloads.
  if (envelope.transaction_id && envelope.transaction_id !== state.transactionId) {
    state.transactionId = envelope.transaction_id;
    sessionStorage.setItem(txnKey(), state.transactionId);
  }

  const products = envelope.ok && envelope.response && Array.isArray(envelope.response.products) ? envelope.response.products : [];
  state.offer = products.length ? envelope.response : null;
  // Why there is no offer matters: "XCover said no" (a 4xx answer) is eligibility; "XCover didn't answer"
  // (timeout / network / 5xx) is an outage we fail open on. Both let the shopper continue; the message differs.
  state.noOfferReason = state.offer ? null
    : envelope.status >= 400 && envelope.status < 500 ? "ineligible"
    : "unavailable";
  state.quoting = false;
  render();
}

// ---- Integration log (shared renderer in panel.js) ----
function logCall(label, envelope) {
  state.calls.unshift({ label, at: new Date(), envelope });
  renderIntegrationLog(state.calls, { badgeEl: $("modeBadge"), listEl: $("payloadEntries") });
}

function renderOffer() {
  const el = $("offer");
  if (state.quoting) {
    el.innerHTML = '<span class="badge">Recommended</span><p class="loading">Checking protection options…</p>';
    return;
  }
  if (!state.offer) {
    el.innerHTML = state.noOfferReason === "ineligible"
      ? '<h2>Protection Plan</h2><p class="muted">Not available for this item.</p><p class="small muted">XCover did not return a plan for this product.</p>'
      : '<h2>Protection Plan</h2><p class="muted">Protection is temporarily unavailable.</p><p class="small muted">You can still complete your purchase without it.</p>';
    return;
  }
  const { content = {}, products } = state.offer;
  const p = products[0];
  const price = p.details.finance.price;
  const benefits = (p.details.benefits || [])
    .map((b) => `<li><strong>${b.title || ""}</strong>${b.description ? " — " + b.description : ""}</li>`)
    .join("");
  const pds = p.details.pds_url ? `<a href="${p.details.pds_url}" target="_blank" rel="noopener">Policy Disclosure Statement</a>` : "";

  el.innerHTML = `
    <span class="badge">Recommended</span>
    <h2>${content.heading || "Protection Plan"}</h2>
    <p class="offer-sub">${content.sub_heading || p.name || ""}</p>
    <p>${content.description || ""}</p>
    <ul class="offer-benefits">${benefits}</ul>
    <p class="offer-price"><strong>${price.total_amount_formatted}</strong> <span class="muted">${content.price_unit || ""}</span></p>
    <div class="offer-actions">
      <button type="button" id="acceptBtn" class="buy-now-btn ${state.protection === "accepted" ? "selected" : ""}">${content.positive_cta || "Add protection"}</button>
      <button type="button" id="declineBtn" class="btn-secondary ${state.protection === "declined" ? "selected" : ""}">${content.negative_cta || "No thanks"}</button>
    </div>
    ${state.protection === "declined" && content.negative_cta_warning ? `<p class="offer-warning">${content.negative_cta_warning}</p>` : ""}
    <p class="muted small">${content.credibility_message || ""} ${pds}</p>
    <p class="muted small">${content.disclaimer || ""}</p>`;

  $("acceptBtn").addEventListener("click", () => { state.protection = "accepted"; render(); });
  $("declineBtn").addEventListener("click", () => { state.protection = "declined"; render(); });
}

function render() {
  // RealCheap's list prices are USD (products.js). Only the OFFER is priced in the shopper's currency —
  // by XCover, in the response. Never relabel a USD amount with another symbol.
  const itemTotal = state.product.price * state.qty;
  $("txn").textContent = state.transactionId || "—";

  const rows = [
    { item: state.product.name, meta: `SKU ${state.product.sku}`, qty: state.qty, unit: money(state.product.price, "USD"), total: money(itemTotal, "USD") },
  ];
  let totalText = money(itemTotal, "USD");

  if (state.offer && state.protection === "accepted") {
    const p = state.offer.products[0];
    const unit = p.details.finance.price.total_amount;
    const offerCurrency = state.offer.currency || "USD";
    // Assumption 3 (see the assumptions slide): per-unit premium × quantity, one policy per unit.
    const protectionTotal = unit * state.qty;
    rows.push({ item: p.name || "Protection Plan", meta: "Premium · XCover", qty: state.qty, unit: money(unit, offerCurrency), total: money(protectionTotal, offerCurrency), premium: true });
    totalText = offerCurrency === "USD"
      ? money(itemTotal + protectionTotal, "USD")
      // Assumption 5: two currencies means two settlements; don't invent an FX rate to add them.
      : `${money(itemTotal, "USD")} + ${money(protectionTotal, offerCurrency)}`;
  } else if (state.offer && state.protection === "declined") {
    rows.push({ item: "Protection Plan", meta: "Declined", qty: "—", unit: "—", total: money(0, "USD"), muted: true });
  } else if (!state.quoting && state.noOfferReason) {
    rows.push({ item: "Protection Plan", meta: state.noOfferReason === "ineligible" ? "Not available for this item" : "Temporarily unavailable", qty: "—", unit: "—", total: money(0, "USD"), muted: true });
  }

  $("lineItemsBody").innerHTML = rows.map((r) => `
    <tr class="${r.premium ? "premium" : ""} ${r.muted ? "muted" : ""}">
      <td>${r.item}<br><span class="small muted">${r.meta}</span></td>
      <td class="num">${r.qty}</td>
      <td class="num">${r.unit}</td>
      <td class="num">${r.total}</td>
    </tr>`).join("");
  $("total").textContent = totalText;

  // Shopper can continue once they've decided — or immediately if there was nothing to decide.
  $("continueBtn").disabled = !!state.offer && state.protection === "undecided";

  renderOffer();
}

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  state.product = findProduct(params.get("sku"));
  if (!state.product) {
    document.querySelector(".checkout-container").innerHTML =
      '<p class="error-message">Nothing in your cart. <a href="/">Back to catalog</a></p>';
    return;
  }
  state.qty = Math.min(5, Math.max(1, parseInt(params.get("qty"), 10) || 1));
  state.transactionId = sessionStorage.getItem(txnKey());
  $("qty").value = String(state.qty);
  $("country").value = state.country;

  $("qty").addEventListener("change", (e) => { state.qty = parseInt(e.target.value, 10); quote(); });
  $("country").addEventListener("change", (e) => { state.country = e.target.value; quote(); });

  // Continue → payment step. The cart is frozen from here; changing it means a new quote.
  $("continueBtn").addEventListener("click", async () => {
    $("qty").disabled = true; $("country").disabled = true; $("continueBtn").hidden = true;
    $("phCountry").value = state.country;
    $("paymentStep").hidden = false;
    $("payBtn").textContent = `Pay ${$("total").textContent} (simulated)`;
    // The decision is frozen here. A decline is reported to XCover now (conversion tracking) — not on the click,
    // because the shopper could still have changed their mind before this point.
    if (state.offer && state.protection === "declined") {
      const res = await fetch(`/api/orders/${state.transactionId}/opt-out`, { method: "POST" });
      const r = await res.json();
      if (r.envelope) logCall("opt out", r.envelope);
    }
  });

  $("payBtn").addEventListener("click", pay);
  quote();
});

// Payment (simulated) → then, and only then, confirm the offer. Order of operations is the invariant.
async function pay() {
  const ph = { first_name: $("phFirst").value.trim(), last_name: $("phLast").value.trim(), email: $("phEmail").value.trim(), phone: $("phPhone").value.trim(), country: $("phCountry").value };
  if (state.offer && state.protection === "accepted" && (!ph.first_name || !ph.last_name || !ph.email || !ph.phone)) {
    $("payMsg").textContent = "Policyholder name, email and phone are required for the protection plan.";
    return;
  }
  $("payBtn").disabled = true; $("payMsg").textContent = "Processing payment…";

  const paid = await fetch(`/api/orders/${state.transactionId}/pay`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ protection: state.offer ? state.protection : "none" }),
  });
  if (!paid.ok) { $("payMsg").textContent = "Payment failed (simulated)."; $("payBtn").disabled = false; return; }

  if (state.offer && state.protection === "accepted") {
    $("payMsg").textContent = "Payment received. Confirming your protection plan…";
    const res = await fetch(`/api/orders/${state.transactionId}/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer_id: state.offer.id, quote_ids: [state.offer.products[0].id], policyholder: ph }),
    });
    const r = await res.json();
    if (r.envelope) logCall("confirm offer", r.envelope);
    if (!res.ok || r.error || (r.order && !r.order.booking_id)) {
      // Fail open, never silent: the shopper keeps their order, but a paid-for plan that isn't confirmed is
      // recorded on the order (confirm_error) and retried from the result page / OMS.
      $("payMsg").textContent = `Payment received. The protection plan could not be confirmed yet (${r.error || "XCover did not confirm"}) — it will be retried.`;
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  }
  window.location.href = `/result.html?txn=${encodeURIComponent(state.transactionId)}`;
}
