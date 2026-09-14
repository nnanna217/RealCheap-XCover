// Orders view: the ledger as RealCheap's OMS would show it. Status is derived from the ledger, never guessed.

const $ = (id) => document.getElementById(id);
const money = (n, c) => new Intl.NumberFormat(undefined, { style: "currency", currency: c || "USD" }).format(n);

// Lifecycle labels, in the order the brief describes: offer created → confirmed → policy active → cancelled.
const STATUS = {
  new: ["Started", ""], no_offer: ["No offer", ""], quoted: ["Offer created", "quoted"], declined: ["Offer declined", ""],
  paid: ["Paid · confirming", "paid"], paid_no_protection: ["Paid · no plan", ""], confirmed: ["Policy active", "ok"],
  cancelled: ["Cancelled", "fail"], refunded: ["Refunded · no plan", ""], unmatched_webhook: ["Unmatched webhook", "warn"],
};

function pill(o) {
  const [label, cls] = STATUS[o.status] || [o.status, ""];
  const wh = o.booking && o.booking.last_webhook ? `<br><span class="small muted">via webhook ${o.booking.last_webhook.event}</span>` : "";
  const due = o.refund_due ? `<br><span class="call-status fail small">refund due ${money(o.refund_due.premium, o.refund_due.currency)}</span>` : "";
  return `<span class="call-status ${cls}">${label}</span>${wh}${due}`;
}

function attempts(o) {
  const h = o.history || [];
  const n = (re) => h.filter((e) => re.test(e.event)).length;
  const row = (label, total, xc) => total ? `<div>${label}: <strong>${total}</strong> <span class="muted small">(XCover called ${xc}, ledger ${total - xc})</span></div>` : "";
  return [
    o.quote_count ? `<div>quote: <strong>${o.quote_count}</strong> <span class="muted small">(XCover called ${o.quote_count}${o.superseded_offer_ids && o.superseded_offer_ids.length ? `; ${o.superseded_offer_ids.length} earlier offer${o.superseded_offer_ids.length > 1 ? "s" : ""} superseded` : ""})</span></div>` : "",
    row("confirm", n(/^confirm offer/), n(/^confirm offer$/)),
    row("refund", n(/^refund/), n(/^refund \(simulated\)$/) ? h.filter((e) => /^cancel booking$/.test(e.event)).length : 0),
    row("opt-out", n(/^opt out/), n(/^opt out$/)),
  ].join("") || '<span class="muted small">—</span>';
}

function lineItems(o) {
  const product = `<div>${o.product_name || "—"} <span class="muted">× ${o.quantity || 1}</span><br><span class="small muted">SKU ${o.sku} · ${money((o.unit_price || 0) * (o.quantity || 1))}</span></div>`;
  let plan;
  if (o.premium_unit && (o.protection === "accepted" || o.booking_id)) {
    plan = `<div class="plan-line">Protection Plan <span class="muted">× ${o.quantity}</span><br><span class="small muted">Premium · XCover · ${money(o.premium_unit * o.quantity, o.offer_currency)}</span></div>`;
  } else if (o.status === "declined") plan = `<div class="plan-line muted small">Protection Plan — declined (opt-out sent)</div>`;
  else if (o.status === "no_offer") plan = `<div class="plan-line muted small">Protection Plan — not offered</div>`;
  else plan = `<div class="plan-line muted small">Protection Plan — undecided</div>`;
  return product + plan;
}

function ids(o) {
  const c = (v) => (v ? `<code title="${v}">${v.length > 14 ? v.slice(0, 8) + "…" + v.slice(-4) : v}</code>` : '<span class="muted">—</span>');
  return `<div class="ids small"><div>offer ${c(o.offer_id)}${o.superseded_offer_ids && o.superseded_offer_ids.length ? ' <span class="muted">(latest)</span>' : ""}</div><div>quote ${c(o.quote_ids && o.quote_ids[0])}</div><div>booking ${c(o.booking_id)}</div>${o.idempotency_key ? `<div>idem-key ${c(o.idempotency_key)}</div>` : ""}</div>`;
}

function actions(o) {
  const btn = (act, label, enabled, cls = "btn-secondary") => `<button type="button" class="${cls} small-btn" data-act="${act}" data-txn="${o.transaction_id}" ${enabled ? "" : "disabled"}>${label}</button>`;
  const canRefund = !!o.payment && !o.refund;
  return `<div class="actions">
    <a class="btn-secondary small-btn" href="/result.html?txn=${encodeURIComponent(o.transaction_id)}">View</a>
    ${btn("refund", o.refund ? "Refund again (demo)" : "Refund order", canRefund || !!o.refund, o.refund ? "btn-secondary" : "buy-now-btn")}
    ${o.booking_id ? btn("confirm", "Re-send confirm (demo)", true) : ""}
    <div class="small muted act-msg" id="msg-${o.transaction_id}"></div>
  </div>`;
}

function row(o) {
  const when = new Date(o.updated_at || Date.now());
  return `<tr>
    <td><code>${o.transaction_id}</code><br><span class="small muted">${when.toLocaleDateString()} ${when.toLocaleTimeString()}</span></td>
    <td>${lineItems(o)}</td>
    <td>${ids(o)}</td>
    <td>${pill(o)}</td>
    <td class="small">${attempts(o)}</td>
    <td>${actions(o)}</td>
  </tr>`;
}

async function load() {
  const all = await (await fetch("/api/orders")).json();
  const orders = all.filter((o) => o.status !== "unmatched_webhook");
  const unmatched = all.filter((o) => o.status === "unmatched_webhook");
  $("ordersBody").innerHTML = orders.length ? orders.map(row).join("") : '<tr><td colspan="6" class="muted">No orders yet — buy something from the <a href="/">catalog</a>.</td></tr>';
  $("unmatched").hidden = !unmatched.length;
  $("unmatchedList").innerHTML = unmatched.map((u) => `<li>booking <code>${u.booking_id}</code> — ${u.history.length} event(s), last ${u.history[u.history.length - 1].webhook.body.event} at ${new Date(u.updated_at).toLocaleTimeString()}</li>`).join("");
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const txn = b.dataset.txn, msg = $(`msg-${txn}`);
  b.disabled = true; msg.textContent = "…";
  const url = b.dataset.act === "refund" ? `/api/orders/${txn}/refund` : `/api/orders/${txn}/confirm`;
  let body = { reason: "Product returned" };
  if (b.dataset.act === "confirm") {
    const o = await (await fetch(`/api/orders/${txn}`)).json();
    body = { offer_id: o.offer_id, quote_ids: o.quote_ids, policyholder: o.policyholder || o.booking.policyholder };
  }
  const r = await (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  msg.innerHTML = r.served_from === "ledger" ? `<strong>served_from: ledger</strong> — ${r.note}` : r.error ? r.error : `served_from: xcover — ${r.cancelled ? "cancelled with XCover, one refund recorded" : "done"}`;
  await load();
  const again = $(`msg-${txn}`); if (again) again.innerHTML = msg.innerHTML;
});

$("refreshBtn").addEventListener("click", load);
setInterval(() => { if ($("autoRefresh").checked && !document.querySelector(".act-msg strong")) load(); }, 5000);
load();
