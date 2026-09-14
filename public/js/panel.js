// Integration log renderer, shared by checkout and result pages.
// Entries: [{ label, at (Date|string), envelope }]. Envelopes come from the server with secrets already redacted.
function pretty(obj) {
  return JSON.stringify(obj, null, 2).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function renderIntegrationLog(entries, { badgeEl, listEl }) {
  const calls = entries.filter((c) => c.envelope);
  const mode = calls.length ? calls[0].envelope.mode : null;
  badgeEl.textContent = mode ? mode.toUpperCase() : "—";
  badgeEl.className = `mode-badge ${mode || ""}`;

  listEl.innerHTML = calls.length ? calls.map((c, i) => {
    const e = c.envelope;
    const status = e.error ? `error · ${e.error}` : `HTTP ${e.status}`;
    const at = c.at instanceof Date ? c.at : new Date(c.at);
    const idem = e.request.headers["x-idempotency-key"];
    return `
    <details class="call" ${i === 0 ? "open" : ""}>
      <summary>
        <span class="call-label">${c.label}</span>
        <code>${e.request.method} ${e.request.url.replace(/^https?:\/\/[^/]+/, "")}</code>
        <span class="call-status ${e.ok || e.status === 409 ? "ok" : "fail"}">${status}</span>
        ${idem ? `<span class="idem small">x-idempotency-key <code>${idem}</code></span>` : ""}
        <span class="muted small">${e.elapsed_ms} ms · ${e.mode} · ${at.toLocaleTimeString()}</span>
      </summary>
      <div class="call-body">
        <div>
          <h4>Request</h4>
          <pre>${pretty({ url: e.request.url, headers: e.request.headers })}</pre>
          ${e.request.body ? `<pre>${pretty(e.request.body)}</pre>` : '<pre>(no body)</pre>'}
        </div>
        <div>
          <h4>Response ${e.mode === "fixture" ? '<span class="small muted">(fixture — not from XCover)</span>' : ""}</h4>
          <pre>${e.error ? pretty({ error: e.error }) : e.status === 204 ? "(204 No Content)" : pretty(e.response)}</pre>
        </div>
      </div>
    </details>`;
  }).join("") : '<p class="muted small">No calls yet.</p>';
}
