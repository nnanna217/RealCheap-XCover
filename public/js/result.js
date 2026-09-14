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
    <h2>${b ? "Order confirmed — your laptop is protected" : "Order confirmed"}</h2>
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
      <h3>Protection plan <span class="call-status ok">${b.status}</span></h3>
      <dl class="policy-facts">
        <dt>Booking</dt><dd><code>${b.id}</code></dd>
        <dt>Policy</dt><dd>${q ? q.policy.policy_name : ""}</dd>
        <dt>Cover period</dt><dd>${q ? new Date(q.policy_start_date).toLocaleDateString() + " → " + new Date(q.policy_end_date).toLocaleDateString() : ""}</dd>
        <dt>Policyholder</dt><dd>${b.policyholder.first_name} ${b.policyholder.last_name} · ${b.policyholder.email}</dd>
        <dt>Premium</dt><dd>${b.total_premium_formatted} <span class="small muted">(tax ${b.total_tax_formatted})</span></dd>
        <dt>Documents</dt><dd><a href="${b.coi.url}" target="_blank" rel="noopener">Certificate of insurance</a> · <a href="${b.pds_url}" target="_blank" rel="noopener">PDS</a></dd>
        <dt>Claims</dt><dd><a href="${b.fnol_link}" target="_blank" rel="noopener">Make a claim</a> <span class="small muted">(first notice of loss — handled by XClaim)</span></dd>
        <dt>Idempotency key</dt><dd><code class="small">${o.idempotency_key}</code></dd>
      </dl>
      <div class="demo-tools">
        <button type="button" id="retryBtn" class="btn-secondary">Demo: re-send the same confirm</button>
        <span class="small muted" id="retryMsg">Simulates a retried request after a timeout. The ledger answers; XCover is not called.</span>
      </div>
    </section>` : o.protection === "declined" ? `<p class="muted">Protection plan declined.</p>` : `<p class="muted">No protection plan on this order.</p>`}

    <div class="result-actions"><a href="/" class="btn-secondary">Back to shop</a></div>`;

  const entries = [...o.history].reverse().map((h) => ({ label: h.event, at: h.at, envelope: h.envelope }));
  renderIntegrationLog(entries, { badgeEl: $("modeBadge"), listEl: $("payloadEntries") });

  const retry = $("retryBtn");
  if (retry) retry.addEventListener("click", async () => {
    retry.disabled = true;
    const res = await fetch(`/api/orders/${encodeURIComponent(txn)}/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ offer_id: o.offer_id, quote_ids: o.quote_ids, policyholder: b.policyholder }),
    });
    const r = await res.json();
    $("retryMsg").innerHTML = `<strong>served_from: ${r.served_from}</strong> — ${r.note || ""} Booking is still <code>${r.order.booking_id}</code>; still one policy.`;
    retry.disabled = false;
  });
}

load();
