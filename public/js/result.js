// Result page: the order as the ledger knows it — line items, payment, and the XCover booking if there is one.

const $ = (id) => document.getElementById(id);
const money = (n, c) => new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n);
const txn = new URLSearchParams(window.location.search).get("txn");

async function load() {
  const res = await fetch(`/api/orders/${encodeURIComponent(txn)}`);
  if (!res.ok) { $("result").innerHTML = `<p class="error-message">Order not found. <a href="/">Back to catalog</a></p>`; return; }
  render(await res.json());
}

function render(o) {
  const b = o.booking;
  const q = b && b.quotes && b.quotes[0];
  const premium = o.protection === "accepted" && o.premium_unit ? o.premium_unit * o.quantity : 0;
  $("result").innerHTML = `
    <h2>${o.refund ? "Order returned and refunded" : b && b.status === "CANCELLED" ? "Order confirmed — protection plan cancelled" : b ? "Order confirmed — your laptop is protected" : "Order confirmed"}</h2>
    <p class="muted">Order ref <code>${o.transaction_id}</code> · ${o.payment ? `paid ${money(o.payment.amount, "USD")} (simulated)` : "unpaid"}</p>

    <table class="line-items">
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Total</th></tr></thead>
      <tbody>
        <tr><td>${o.product_name}<br><span class="small muted">SKU ${o.sku}</span></td><td class="num">${o.quantity}</td><td class="num">${money(o.unit_price, "USD")}</td><td class="num">${money(o.unit_price * o.quantity, "USD")}</td></tr>
        ${o.protection === "accepted" && o.premium_unit ? `<tr class="premium"><td>Protection Plan<br><span class="small muted">Premium · XCover</span></td><td class="num">${o.quantity}</td><td class="num">${money(o.premium_unit, o.offer_currency || "USD")}</td><td class="num">${money(premium, o.offer_currency || "USD")}</td></tr>` : ""}
      </tbody>
    </table>

    ${b ? `
    <section class="policy-card">
      <h3>Protection plan <span class="call-status ${b.status === "CANCELLED" ? "fail" : "ok"}">${b.status}</span></h3>
      <dl class="policy-facts">
        <dt>Booking</dt><dd><code>${b.id}</code></dd>
        <dt>Policy</dt><dd>${q && q.policy ? q.policy.policy_name : ""}</dd>
        <dt>Cover period</dt><dd>${q ? new Date(q.policy_start_date).toLocaleDateString() + " → " + new Date(q.policy_end_date).toLocaleDateString() : ""}</dd>
        <dt>Policyholder</dt><dd>${b.policyholder.first_name} ${b.policyholder.last_name} · ${b.policyholder.email}${o.policyholder && o.policyholder.phone ? " · " + o.policyholder.phone : ""}</dd>
        <dt>Partner ref</dt><dd><code>${b.partner_transaction_id || "—"}</code> <span class="small muted">(echoed by XCover; routes BOOKING_* webhooks)</span></dd>
        <dt>Premium</dt><dd>${b.total_premium_formatted} <span class="small muted">(tax ${b.total_tax_formatted})</span></dd>
        <dt>Documents</dt><dd><a href="${b.coi.url}" target="_blank" rel="noopener">Certificate of insurance</a> · <a href="${b.pds_url}" target="_blank" rel="noopener">PDS</a></dd>
        <dt>Claims</dt><dd><a href="${b.fnol_link}" target="_blank" rel="noopener">Make a claim</a> <span class="small muted">(first notice of loss — handled by XClaim)</span></dd>
        <dt>Idempotency key</dt><dd><code class="small">${o.idempotency_key}</code></dd>
      </dl>
      ${o.needs_review ? `<p class="offer-warning"><strong>Needs review:</strong> ${o.needs_review.map((r) => `${r.code} — ${typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail)}`).join("; ")}</p>` : ""}
      <div class="demo-tools">
        <button type="button" id="retryBtn" class="btn-secondary">Demo: re-send the same confirm</button>
        <label class="small muted"><input type="checkbox" id="retryBypass"> bypass the ledger — let XCover answer</label>
        <span class="small muted" id="retryMsg">Simulates a retried request after a timeout. Unticked: the ledger answers, XCover is not called. Ticked: the same key reaches XCover, which replies 409 with the cached original — treated as success.</span>
      </div>
    </section>` : o.protection === "declined" ? `<p class="muted">Protection plan declined.</p>` : `<p class="muted">No protection plan on this order.</p>`}

    ${b ? `
    <section class="webhook-card">
      <h3>Webhooks from XCover <span class="small muted">— consideration #6</span></h3>
      ${(o.history || []).filter((h) => h.webhook).length ? `
      <table class="line-items small">
        <thead><tr><th>Received</th><th>Event</th><th>Routed by</th><th>Outcome</th></tr></thead>
        <tbody>${o.history.filter((h) => h.webhook).map((h) => `<tr><td>${new Date(h.at).toLocaleTimeString()}</td><td><code>${h.webhook.body.event}</code> <span class="muted">(${h.webhook.source})</span></td><td>${h.webhook.matched_by || "—"}</td><td><span class="call-status ${h.outcome === "applied" ? "ok" : ""}">${h.outcome}</span></td></tr>`).join("")}</tbody>
      </table>` : `<p class="small muted">None yet. XCover sends <code>BOOKING_CREATED</code> on confirm and <code>BOOKING_CANCELLED</code> on cancel; each is signed, verified, deduped, and routed to this order by <code>partner_transaction_id</code>.</p>`}
      ${o.refund_due ? `<p class="offer-warning">XCover reports this booking cancelled and no RealCheap refund is on record — premium refund of ${money(o.refund_due.premium, o.refund_due.currency || "USD")} is <strong>due</strong> to the customer.</p>` : ""}
      <div class="demo-tools">
        <select id="whEvent" class="small"><option>BOOKING_CREATED</option><option>BOOKING_UPDATED</option><option selected>BOOKING_CANCELLED</option></select>
        <button type="button" id="whBtn" class="btn-secondary">Demo: simulate this webhook</button>
        <label class="small muted"><input type="checkbox" id="whTamper"> bad signature</label>
        <label class="small muted"><input type="checkbox" id="whNoTxn"> null partner_transaction_id</label>
        <span class="small muted" id="whMsg">Signed as XCover would, delivered to this server's /api/webhooks.</span>
      </div>
    </section>` : ""}

    ${o.payment ? `
    <section class="refund-card">
      <h3>Returns</h3>
      ${o.refund ? `
        <p><strong>Refunded ${o.refund.total_formatted}</strong> on ${new Date(o.refund.at).toLocaleString()} — product ${money(o.refund.product_amount, "USD")}${o.refund.premium_amount ? ` + premium ${money(o.refund.premium_amount, "USD")} (XCover-calculated${o.refund.xcover_cancellation && o.refund.xcover_cancellation.refund && o.refund.xcover_cancellation.refund.within_cooling_off_period ? ", within cooling-off" : ""})` : ""}. One refund, recorded once.</p>
        ${b && b.status === "CANCELLED" ? `<p class="small muted">Booking <code>${b.id}</code> is CANCELLED with XCover.</p>` : ""}` : `
        <p class="small muted">Returning the item refunds the product and, if a plan was bought, cancels it with XCover and refunds the premium XCover calculates — as one refund.</p>`}
      <div class="demo-tools">
        <button type="button" id="refundBtn" class="btn-secondary">${o.refund ? "Demo: re-send the same refund" : "Return item & refund"}</button>
        <span class="small muted" id="refundMsg">${o.refund ? "Simulates a duplicate refund event (e.g. the OMS retries). The ledger answers; nothing is paid twice." : ""}</span>
      </div>
    </section>` : ""}

    <div class="result-actions"><a href="/" class="btn-secondary">Back to shop</a></div>`;

  const entries = [...o.history].reverse().map((h) => ({ label: h.event, at: h.at, envelope: h.envelope, webhook: h.webhook, outcome: h.outcome }));
  renderIntegrationLog(entries, { badgeEl: $("modeBadge"), listEl: $("payloadEntries") });

  const whBtn = $("whBtn");
  if (whBtn) whBtn.addEventListener("click", async () => {
    whBtn.disabled = true; $("whMsg").textContent = "Sending…";
    const res = await fetch("/api/demo/webhook", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_id: txn, event: $("whEvent").value, tamper: $("whTamper").checked, omit_partner_txn: $("whNoTxn").checked }) });
    const r = await res.json();
    if (r.error) { $("whMsg").textContent = r.error; whBtn.disabled = false; return; }
    $("whMsg").innerHTML = `handler answered <strong>HTTP ${r.received.status}</strong> — ${typeof r.received.body === "object" ? `outcome <strong>${r.received.body.outcome}</strong>${r.received.body.note ? " · " + r.received.body.note : ""}` : r.received.body}`;
    if (r.received.status === 200) setTimeout(() => render(r.order), 900); else whBtn.disabled = false;
  });

  const refundBtn = $("refundBtn");
  if (refundBtn) refundBtn.addEventListener("click", async () => {
    refundBtn.disabled = true; $("refundMsg").textContent = "Processing return…";
    const res = await fetch(`/api/orders/${encodeURIComponent(txn)}/refund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Product returned" }) });
    const r = await res.json();
    if (r.served_from === "ledger") { $("refundMsg").innerHTML = `<strong>served_from: ledger</strong> — ${r.note}`; refundBtn.disabled = false; return; }
    if (r.error) { $("refundMsg").textContent = r.error; refundBtn.disabled = false; return; }
    render(r.order);
  });

  const retry = $("retryBtn");
  if (retry) retry.addEventListener("click", async () => {
    retry.disabled = true;
    const res = await fetch(`/api/orders/${encodeURIComponent(txn)}/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer_id: o.offer_id, quote_ids: o.quote_ids, policyholder: o.policyholder || b.policyholder, force_xcover: $("retryBypass").checked }),
    });
    const r = await res.json();
    $("retryMsg").innerHTML = r.served_from === "ledger"
      ? `<strong>served_from: ledger</strong> — ${r.note || ""} Booking is still <code>${r.order.booking_id}</code>; still one policy.`
      : `<strong>served_from: xcover — HTTP ${r.envelope.status}${r.replayed ? " (replay: cached original result, treated as success)" : ""}</strong>. Booking is still <code>${r.order.booking_id}</code>; still one policy. See the new entry in the integration log.`;
    if (r.served_from !== "ledger") setTimeout(load, 800);
    retry.disabled = false;
  });
}

load();
