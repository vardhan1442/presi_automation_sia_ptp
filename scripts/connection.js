/**
 * connection.js — shared SSH connection config helpers.
 *
 * Connection params are stored in localStorage under "ptp_ssh_conn" so any
 * page can read them.  index.html is the single place to configure them.
 */

const CONN_KEY        = "ptp_ssh_conn";
const SSH_BRIDGE_URL  = "http://127.0.0.1:5000";

// ── Save / load ────────────────────────────────────────────────────────────

function connSave(cfg) {
  localStorage.setItem(CONN_KEY, JSON.stringify(cfg));
}

function connLoad() {
  try { return JSON.parse(localStorage.getItem(CONN_KEY) || "null"); }
  catch { return null; }
}

/** Returns params object ready to POST to the bridge server, or null if not configured. */
function connParams() {
  const c = connLoad();
  if (!c || !c.host) return null;
  const params = {
    host:     c.host,
    port:     Number(c.port) || 22,
    user:     c.user     || "",
    key_path: c.key_path || "~/.ssh/id_ed25519",
  };
  // Password lives in sessionStorage only (not persisted to localStorage)
  const pass = sessionStorage.getItem("ptp_ssh_pass") || "";
  if (pass) params.password = pass;
  return params;
}

// ── Test connection (used from multiple pages) ─────────────────────────────

async function connTest(params) {
  const p = params || connParams();
  if (!p || !p.host) throw new Error("No connection configured. Set it up on the Home page.");
  const res  = await fetch(`${SSH_BRIDGE_URL}/api/connect-test`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(p),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || res.statusText);
  return data;   // { ok, hostname, user }
}

// ── Render a connection status bar on any page ────────────────────────────
// Targets an element with id="connBadge" if present.

function connRenderBadge() {
  const el = document.getElementById("connBadge");
  if (!el) return;
  const c = connLoad();

  el.style.cssText =
    "display:flex;align-items:center;flex-wrap:wrap;gap:10px;" +
    "padding:7px 14px;border-radius:10px;font-size:0.84rem;" +
    "background:#1e293b;border:1px solid #334155;margin-bottom:12px;";

  if (!c || !c.host) {
    el.innerHTML =
      `<span style="color:#fca5a5;">&#9888; No SSH connection configured</span>` +
      `<a href="index.html" style="margin-left:auto;padding:4px 10px;background:#2563eb;color:#fff;border-radius:6px;font-size:0.8rem;font-weight:700;text-decoration:none;">Configure on Home &#8594;</a>`;
  } else {
    el.innerHTML =
      `<span id="connDot" style="width:9px;height:9px;border-radius:50%;background:#6b7280;display:inline-block;flex-shrink:0;"></span>` +
      `<span style="color:#e2e8f0;font-weight:700;">${c.user || "?"}@${c.host}</span>` +
      `<span style="color:#94a3b8;">port ${c.port || 22}</span>` +
      `<span id="connStatusText" style="color:#94a3b8;font-size:0.8rem;"></span>` +
      `<button id="connTestBtn" onclick="connTestBadge()" ` +
        `style="margin-left:auto;padding:3px 10px;background:#334155;color:#e2e8f0;border:1px solid #475569;border-radius:6px;font-size:0.78rem;cursor:pointer;">` +
        `&#9654; Test</button>` +
      `<a href="index.html" style="padding:3px 10px;background:#1d4ed8;color:#fff;border-radius:6px;font-size:0.78rem;font-weight:700;text-decoration:none;">Edit</a>`;
  }
}

async function connTestBadge() {
  const dot    = document.getElementById("connDot");
  const status = document.getElementById("connStatusText");
  const btn    = document.getElementById("connTestBtn");
  if (!dot || !status) return;
  if (btn) btn.disabled = true;
  dot.style.background    = "#f59e0b";
  status.textContent      = "Testing…";
  status.style.color      = "#fbbf24";
  try {
    const data = await connTest();
    dot.style.background  = "#22c55e";
    status.textContent    = `Connected — ${data.hostname || ""}`;
    status.style.color    = "#86efac";
  } catch (err) {
    dot.style.background  = "#ef4444";
    status.textContent    = "Failed: " + err.message;
    status.style.color    = "#fca5a5";
  } finally {
    if (btn) btn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", connRenderBadge);

// Expose for inline onclick handlers
window.connTestBadge = connTestBadge;
window.connRenderBadge = connRenderBadge;
