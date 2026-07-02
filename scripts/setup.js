// @ts-nocheck
let setupLogs = [];
let executionInProgress = false;

function logSetup(message) {
  const ts = new Date().toLocaleTimeString();
  setupLogs.push("[" + ts + "] " + message);
  const logEl = document.getElementById("setupActionLog");
  if (logEl) {
    logEl.textContent = setupLogs.join("\n");
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function sshParams() {
  const c = typeof connLoad === "function" ? connLoad() : null;
  if (!c || !c.host) return null;
  const params = { host: c.host, port: Number(c.port) || 22, user: c.user || "", key_path: c.key_path || "~/.ssh/id_ed25519", timeout: 45 };
  const pass = sessionStorage.getItem("ptp_ssh_pass") || "";
  if (pass) params.password = pass;
  return params;
}

async function sshExec(command, outputEl, statusEl) {
  const params = sshParams();
  if (!params) {
    const msg = "No SSH credentials - configure connection on Home page.";
    if (outputEl) outputEl.textContent = "\u26a0  " + msg;
    if (statusEl) statusEl.textContent = msg;
    logSetup("SSH not configured");
    return null;
  }
  if (outputEl) outputEl.textContent = "Connecting to " + params.host + "...";
  if (statusEl) statusEl.textContent = "Running...";

  const stdoutLines = [];
  const stderrLines = [];
  let exitCode = null;

  try {
    const apiBase = (typeof SSH_BRIDGE_URL !== "undefined" ? SSH_BRIDGE_URL : "http://127.0.0.1:5000");
    const res = await fetch(apiBase + "/api/exec-command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({}, params, { command: command }))
    });

    if (!res.ok || !res.body) {
      throw new Error("HTTP " + res.status + " " + res.statusText);
    }

    // Consume the SSE stream line-by-line (same pattern as run-verification)
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = "";

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      // Process complete SSE "data: ..." lines
      const lines = buf.split("\n");
      buf = lines.pop();   // keep incomplete last line in buffer
      lines.forEach(function(line) {
        if (!line.startsWith("data: ")) return;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.type === "stdout") {
            stdoutLines.push(evt.line);
            // Show output in real-time
            if (outputEl) outputEl.textContent = stdoutLines.join("\n");
          } else if (evt.type === "stderr") {
            stderrLines.push(evt.line);
          } else if (evt.type === "done") {
            exitCode = evt.rc;
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        } catch (parseErr) { /* ignore malformed events */ }
      });
    }

    const out  = stdoutLines.join("\n").trim();
    const err  = stderrLines.join("\n").trim();
    const full = (out || "(no stdout)")
      + (err ? "\n\n--- stderr ---\n" + err : "")
      + (exitCode !== null ? "\n\n[exit code: " + exitCode + "]" : "");

    if (outputEl) outputEl.textContent = full;
    if (statusEl) statusEl.textContent = "Done" + (exitCode !== null ? " (exit " + exitCode + ")" : "");
    logSetup("SSH done [exit " + exitCode + "] on " + params.host);

    return { stdout: out, stderr: err, exit_code: exitCode };

  } catch (e) {
    const msg = "Error: " + e.message;
    if (outputEl) outputEl.textContent = "\u26a0  " + msg;
    if (statusEl) statusEl.textContent = msg;
    logSetup("SSH error: " + e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run Directory browser (SSH-backed)
// ---------------------------------------------------------------------------
let _browserCurrentPath = "/nfs/site/disks";

async function browseDir(path) {
  const box    = document.getElementById("dirBrowserBox");
  const pathEl = document.getElementById("browserPath");
  const stat   = document.getElementById("browserStatus");
  if (!path) path = _browserCurrentPath;
  path = path.trim().replace(/\/+$/, "") || "/";
  if (pathEl) pathEl.value = path;
  if (stat)  stat.textContent = "Loading " + path + " ...";
  if (box)   box.innerHTML = "<div style='color:#6b7280;'>Loading...</div>";

  const apiBase = (typeof SSH_BRIDGE_URL !== "undefined" ? SSH_BRIDGE_URL : "http://127.0.0.1:5000");
  const params  = sshParams();
  if (!params) {
    if (box) box.innerHTML = "<div style='color:#fca5a5;'>No SSH credentials — configure on Home page.</div>";
    return;
  }
  try {
    const res  = await fetch(apiBase + "/api/list-dir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({}, params, { path: path }))
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);

    _browserCurrentPath = data.path || path;
    if (pathEl) pathEl.value = _browserCurrentPath;
    if (stat)  stat.textContent = _browserCurrentPath;

    const entries = data.entries || [];
    if (!entries.length) {
      if (box) box.innerHTML = "<div style='color:#6b7280;font-size:0.82rem;'>Empty directory</div>";
      return;
    }
    const dirs  = entries.filter(function(e) { return e.is_dir; }).sort(function(a,b){ return a.name.localeCompare(b.name); });
    const files = entries.filter(function(e) { return !e.is_dir; }).sort(function(a,b){ return a.name.localeCompare(b.name); });

    var html = "";
    dirs.forEach(function(e) {
      var full = _browserCurrentPath + "/" + e.name;
      html += "<div style='display:flex;align-items:center;gap:6px;padding:3px 2px;border-bottom:1px solid #1e293b;'>" +
        "<button onclick=\"browseDir('" + full.replace(/'/g,"\\'") + "')\" " +
        "style='flex:1;text-align:left;background:none;border:none;color:#60a5fa;font-size:0.82rem;cursor:pointer;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>&#128193; " + e.name + "/</button>" +
        "<button onclick=\"selectRunDir('" + full.replace(/'/g,"\\'") + "')\" " +
        "style='padding:1px 6px;background:#059669;color:#fff;border:none;border-radius:4px;font-size:0.72rem;cursor:pointer;flex-shrink:0;' title='Select as run directory'>&#10003;</button>" +
        "</div>";
    });
    files.slice(0, 20).forEach(function(e) {
      html += "<div style='padding:2px 2px;color:#6b7280;font-size:0.78rem;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'>&#128196; " + e.name + "</div>";
    });
    if (files.length > 20) html += "<div style='color:#6b7280;font-size:0.75rem;'>... and " + (files.length - 20) + " more files</div>";
    if (box) box.innerHTML = html;
    logSetup("Browsed: " + _browserCurrentPath + " (" + dirs.length + " dirs, " + files.length + " files)");
  } catch (err) {
    if (box)  box.innerHTML = "<div style='color:#fca5a5;'>Error: " + err.message + "</div>";
    if (stat) stat.textContent = "Error";
    logSetup("Browse error: " + err.message);
  }
}

function browserUp() {
  const parts = _browserCurrentPath.split("/").filter(Boolean);
  parts.pop();
  const parent = "/" + parts.join("/");
  browseDir(parent || "/");
}

function selectRunDir(path) {
  const inputEl  = document.getElementById("runDirInput");
  const summaryEl = document.getElementById("sessionSummaryList");
  if (inputEl) inputEl.value = path;
  if (summaryEl) {
    summaryEl.innerHTML = "<div class='summary-item'>" +
      "<div class='summary-item-title'>Selected Run Directory</div>" +
      "<div class='summary-item-value' style='font-family:monospace;font-size:0.82rem;word-break:break-all;'>" + path + "</div>" +
      "</div>";
  }
  logSetup("Run directory selected: " + path);
}

function loadRunDirInAnalysis() {
  const pathEl = document.getElementById("runDirInput");
  const path   = pathEl ? pathEl.value.trim() : "";
  if (!path) { alert("Browse and select a run directory first."); return; }
  const conn = typeof connLoad === "function" ? connLoad() : {};
  try {
    localStorage.setItem("ptp_setup_rundir", JSON.stringify({ path: path, host: conn.host, user: conn.user }));
  } catch (e) { /* ignore */ }
  logSetup("Opening Analysis with run_dir: " + path);
  alert("Analysis page will open.\nPaste this path into the SSH Run Directory field:\n\n" + path);
  window.open("analysis.html", "_blank");
}

window.browseDir           = browseDir;
window.browserUp           = browserUp;
window.selectRunDir        = selectRunDir;
window.loadRunDirInAnalysis = loadRunDirInAnalysis;
// Keep legacy exports for unused functions
window.validateRunDir  = function() {};
window.listRemoteDir   = function() {};

// ---------------------------------------------------------------------------
// (Legacy VNC session listing — kept for reference)
// ---------------------------------------------------------------------------
async function listVncSessions() {
  const statusEl = document.getElementById("vncStatusText");
  const tableWrap = document.getElementById("vncSessionTable");
  const tbody = document.getElementById("vncTableBody");
  const rawOut = document.getElementById("vncRawOutput");
  const execBtn = document.getElementById("vncExecBtn");
  const summaryEl = document.getElementById("sessionSummaryList");
  if (execBtn) execBtn.disabled = true;
  logSetup("Step 1: listing VNC sessions");
  const cmdEl = document.getElementById("cmdVncList");
  const cmd = (cmdEl ? cmdEl.innerText.trim() : "")
    || "ps aux | grep -E '(Xvnc-core|vncserver-virtual)[[:space:]]+:[0-9]' | grep -v grep | awk '{print $1, $2, $12, $11}'";
  const data = await sshExec(cmd, rawOut, statusEl);
  if (data) {
    const stdout = (data.stdout || "").trim();
    const conn = typeof connLoad === "function" ? connLoad() : {};
    const rows = [];
    var inX11Section = false;
    // Parse output from the multi-section command
    stdout.split("\n").forEach(function(line) {
      line = line.trim();
      if (!line || line.startsWith("===")) {
        inX11Section = /X11 Sockets/.test(line);
        return;
      }
      if (inX11Section) {
        // /tmp/.X11-unix/ listing: "X49" or "X33" etc.
        var m = line.match(/^X(\d+)$/);
        if (m) rows.push({ display: ":" + m[1], pid: "-", user: "-", status: "X11 socket", isMe: false });
        return;
      }
      // VNC process lines: "user PID /path/binary :display_or_flag"
      const parts = line.split(/\s+/);
      if (parts.length < 4) return;
      const user   = parts[0];
      const pid    = parts[1];
      const binary = parts[2].split("/").pop();
      const field4 = parts[3];
      if (!/^:\d+$/.test(field4)) return;
      const isMe = user === (conn.user || "");
      rows.push({ display: field4, pid: pid, user: user, status: binary, isMe: isMe });
    });
    if (tbody && rows.length) {
      tbody.innerHTML = rows.map(function(r) {
        var userStyle = r.isMe ? "color:#fbbf24;font-weight:700;" : "color:#e2e8f0;";
        var rowStyle  = r.isMe ? "background:#1e3a5f;" : "";
        return "<tr style='" + rowStyle + "'>" +
          "<td style='font-family:monospace;color:#60a5fa;font-weight:600;'>" + r.display + "</td>" +
          "<td style='font-family:monospace;'>" + r.pid + "</td>" +
          "<td style='" + userStyle + "'>" + r.user + (r.isMe ? " \u2b50" : "") + "</td>" +
          "<td style='color:#34d399;font-size:0.8rem;'>" + r.status + "</td>" +
          "</tr>";
      }).join("");
      if (tableWrap) tableWrap.style.display = "block";
    } else if (tableWrap) { tableWrap.style.display = "none"; }
    if (summaryEl) {
      summaryEl.innerHTML = rows.length
        ? rows.map(function(r) {
            return "<div class='summary-item" + (r.isMe ? " summary-item-highlight" : "") + "'>" +
              "<div class='summary-item-title'>" + r.user + " \u2014 Display " + r.display + "</div>" +
              "<div class='summary-item-value'>PID " + r.pid + " | " + r.status + "</div></div>";
          }).join("")
        : "<div class='summary-item'><div class='summary-item-value'>No VNC sessions found on " + (conn.host || "host") + "</div></div>";
    }
    logSetup("Step 1 done - " + rows.length + " active VNC session(s)");
  }
  if (execBtn) execBtn.disabled = false;
}

async function executeStep(stepName, commandElementId, statusElementId) {
  const cmdEl = document.getElementById(commandElementId);
  const statusEl = document.getElementById(statusElementId);
  if (!cmdEl || !statusEl) return;
  const command = cmdEl.innerText.trim();
  if (!command) { statusEl.textContent = "No command"; return; }
  logSetup(stepName + ": executing via SSH (tcsh)");
  // Use pre-existing output div, or create one dynamically if not found
  let outEl = document.getElementById(commandElementId + "_output");
  if (!outEl) {
    outEl = document.createElement("div");
    outEl.id = commandElementId + "_output";
    outEl.className = "cmd-box";
    outEl.style.cssText = "margin-top:10px;min-height:60px;max-height:280px;overflow-y:auto;font-size:0.82rem;color:#86efac;white-space:pre-wrap;";
    cmdEl.parentNode.insertBefore(outEl, cmdEl.nextSibling);
  }
  outEl.style.display = "block";
  await sshExec(command, outEl, statusEl);
}

async function executeAllSteps() {
  if (executionInProgress) return;
  executionInProgress = true;
  logSetup("Execute all steps started");
  await listVncSessions();
  await executeStep("Step 2", "cmdStep2", "step2Status");
  await executeStep("Step 3", "cmdStep3", "step3Status");
  await executeStep("Trigger Run", "triggerCmd", "triggerStatus");
  executionInProgress = false;
  logSetup("All steps done");
}

async function copyCommand(id) {
  const el = document.getElementById(id);
  if (!el) return;
  try { await navigator.clipboard.writeText(el.innerText.trim()); logSetup("Copied " + id); alert("Copied."); }
  catch (e) { alert("Copy failed: " + e.message); }
}

function resetCommand(id, value) {
  const el = document.getElementById(id);
  if (el) { el.innerText = value; logSetup("Reset " + id); }
}

function generateCombinedScript() {
  const get = function(id) { const e = document.getElementById(id); return e ? e.innerText.trim() : ""; };
  const combined = ["# Step 1: List VNC Sessions", get("cmdVncList"), "", "# Step 2: Wash required groups", get("cmdStep2"), "", "# Step 3: Model environment setup", get("cmdStep3"), "", "# Trigger run", get("triggerCmd")].join("\n");
  const el = document.getElementById("combinedScript");
  if (el) el.innerText = combined;
  logSetup("Generated combined script");
}

function placeholderAction(msg) { logSetup(msg); alert(msg); }
function setStepStatus(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

window.listVncSessions = listVncSessions;
window.executeStep = executeStep;
window.executeAllSteps = executeAllSteps;
window.copyCommand = copyCommand;
window.resetCommand = resetCommand;
window.generateCombinedScript = generateCombinedScript;
window.placeholderAction = placeholderAction;
