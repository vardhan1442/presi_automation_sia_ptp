let rawAnalysis = null;
let idiGraphData = [];
let ddrGraphData = [];
let idiWriteData = [];
let ddrWriteData = [];
let loopRanges = [];
let selectedFiles = [];
let operationLogs = [];
let dirHandle = null; // FileSystemDirectoryHandle — set by showDirectoryPicker fast path

// ---------------------------------------------------------------------------
// File System Access API helpers
// Lets us fetch specific files by name without enumerating the full directory.
// Falls back gracefully to the legacy webkitdirectory input on unsupported browsers.
// ---------------------------------------------------------------------------

async function pickDirectory() {
  if (!window.showDirectoryPicker) {
    // Browser doesn't support FSA — fall through to the hidden file input
    document.getElementById("runFolder").click();
    return;
  }
  try {
    dirHandle = await window.showDirectoryPicker({ mode: "read" });
    document.getElementById("dirPickerLabel").textContent = dirHandle.name;
    appendLog(`Folder selected: ${dirHandle.name}`);
  } catch (e) {
    if (e.name !== "AbortError") {
      setStatus(`Failed to open folder: ${e.message}`, true);
    }
  }
}

// Read a FileSystemFileHandle into a string
async function readFileHandleAsText(fileHandle) {
  const file = await fileHandle.getFile();
  return file.text();
}

// Enumerate only ONE subdirectory looking for a file whose name contains `nameIncludes`.
// Vastly faster than scanning the whole tree — only touches the specific subdir.
async function findFileInSubdir(parentHandle, subdirName, nameIncludes) {
  try {
    const subdir = await parentHandle.getDirectoryHandle(subdirName);
    for await (const [name, handle] of subdir.entries()) {
      if (handle.kind === "file" && name.includes(nameIncludes)) return handle;
    }
  } catch { /* subdir doesn't exist — not an error */ }
  return null;
}

const demoData = {
  run_info: { run_dir: "/demo/run_001", run_name: "run_001", generated_at: "2026-06-12 10:00:00" },
  testStart: "100",
  testEnd: "900",
  testStartDDR: "120",
  testEndDDR: "880",
  Threads: "8",
  Cores: "4",
  test_cmd_line: "python verification.py -r /demo/run_001",
  kind_model: "DEMO_KIND_MODEL",
  Loops: 3,
  StarttimeStamp: 1,
  endtimeStamp: 9,
  idi_loops: {
    ranges: [
      { loop: 1, start: 1, end: 3.5 },
      { loop: 2, start: 4, end: 6.5 },
      { loop: 3, start: 7, end: 9 }
    ]
  },
  opcodes: { LOAD: 120, STORE: 90, PREFETCH: 40, CLFLUSH: 12 },
  DDR_info: 345,
  DDR_infoW: 287,
  DDR_infoS: { RD: 220, WR: 180, ACT: 50, PRE: 30 },
  platform: {
    threads: [
      { tag: "thread0", apic_id: "0", cluster: "A", cluster_id: "0", core_id: "0", enabled: "TRUE", kind: "P", package_id: "0" },
      { tag: "thread1", apic_id: "1", cluster: "A", cluster_id: "0", core_id: "1", enabled: "TRUE", kind: "P", package_id: "0" }
    ]
  },
  scenario: {
    traffic_by_thread: [
      { thread: "thread0", traffic: "READ_HEAVY" },
      { thread: "thread1", traffic: "WRITE_HEAVY" }
    ],
    memory_json: [
      ["mem0", "thread0", "64B", "READ"],
      ["mem1", "thread1", "64B", "WRITE"]
    ]
  },
  BiosInfo: "Demo BIOS version 1.0",
  DDRInfo: "LPDDR5 6400 demo configuration",
  test_CacheInfo: "LLC enabled, L2 enabled",
  fusesInfo: "FuseA=1\nFuseB=0"
};

const demoIdi = [
  { x: 0, y: 42 }, { x: 1, y: 48 }, { x: 2, y: 55 }, { x: 3, y: 58 }, { x: 4, y: 54 },
  { x: 5, y: 62 }, { x: 6, y: 64 }, { x: 7, y: 59 }, { x: 8, y: 52 }, { x: 9, y: 47 }
];
const demoIdiWrite = [
  { x: 0, y: 18 }, { x: 1, y: 22 }, { x: 2, y: 25 }, { x: 3, y: 27 }, { x: 4, y: 24 },
  { x: 5, y: 29 }, { x: 6, y: 31 }, { x: 7, y: 28 }, { x: 8, y: 23 }, { x: 9, y: 20 }
];

const demoDdr = [
  { x: 0, y: 120 }, { x: 1, y: 128 }, { x: 2, y: 133 }, { x: 3, y: 129 }, { x: 4, y: 140 },
  { x: 5, y: 145 }, { x: 6, y: 141 }, { x: 7, y: 150 }, { x: 8, y: 144 }, { x: 9, y: 139 }
];
const demoDdrWrite = [
  { x: 0, y: 72 }, { x: 1, y: 78 }, { x: 2, y: 82 }, { x: 3, y: 79 }, { x: 4, y: 86 },
  { x: 5, y: 90 }, { x: 6, y: 88 }, { x: 7, y: 94 }, { x: 8, y: 89 }, { x: 9, y: 84 }
];

function timestampNow() {
  return new Date().toLocaleTimeString();
}

function appendLog(message, type = "INFO") {
  const line = `[${timestampNow()}] [${type}] ${message}`;
  operationLogs.push(line);
  const block = document.getElementById("operationLogBlock");
  if (block) {
    block.textContent = operationLogs.join("\n");
    block.scrollTop = block.scrollHeight;
  }
  console.log(line);
}

function clearLog() {
  operationLogs = [];
  const block = document.getElementById("operationLogBlock");
  if (block) block.textContent = "-";
}

function setProgress(pct, label) {
  const wrap  = document.getElementById("loadProgressWrap");
  const bar   = document.getElementById("loadProgressBar");
  const lbl   = document.getElementById("loadProgressLabel");
  const pctEl = document.getElementById("loadProgressPct");
  const steps = document.getElementById("loadProgressSteps");
  if (!wrap) return;
  wrap.style.display = "block";
  if (bar)   bar.style.width    = `${pct}%`;
  if (lbl)   lbl.textContent    = label;
  if (pctEl) pctEl.textContent  = `${pct}%`;
  if (steps) steps.textContent += (steps.textContent ? "  ›  " : "") + label;
}

function hideProgress() {
  const wrap  = document.getElementById("loadProgressWrap");
  const steps = document.getElementById("loadProgressSteps");
  if (wrap)  wrap.style.display = "none";
  if (steps) steps.textContent  = "";
}

function setLoadButtonState(isLoading) {
  const btn = document.getElementById("loadDirBtn");
  if (!btn) return;
  btn.disabled = isLoading;
  if (isLoading) {
    btn.classList.add("btn-disabled");
    btn.innerHTML = `<span style="display:inline-block;animation:spin 0.8s linear infinite;">&#9696;</span>&nbsp; Loading…`;
  } else {
    btn.classList.remove("btn-disabled");
    btn.textContent = "Load Directory";
    hideProgress();
  }
}

function setStatus(message, isError = false) {
  const box = document.getElementById("statusBox");
  if (!box) return;
  box.textContent = message;
  box.style.background = isError ? "#fef2f2" : "#eff6ff";
  box.style.color = isError ? "#b91c1c" : "#1d4ed8";
  box.style.borderColor = isError ? "#fecaca" : "#bfdbfe";
}

function baseName(path) {
  if (!path) return "-";
  const normalized = String(path).replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function stringifyAny(v) {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v, null, 2); }
  catch { return String(v); }
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function minVal(arr) {
  if (!arr.length) return null;
  return Math.min(...arr);
}

function maxVal(arr) {
  if (!arr.length) return null;
  return Math.max(...arr);
}

function stdDev(arr) {
  if (arr.length < 2) return null;
  const mean = avg(arr);
  const variance = arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function getVisibleData(data, x0, x1) {
  if (x0 === null || x1 === null || x0 === undefined || x1 === undefined) return [...data];
  return data.filter(d => d.x >= Number(x0) && d.x <= Number(x1));
}

function splitLineAuto(line) {
  if (line.includes(",")) return line.split(",").map(x => x.trim());
  return line.trim().split(/\s+/).map(x => x.trim());
}

function extractNumericPairs(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const data = [];
  for (const line of lines) {
    const parts = splitLineAuto(line);
    const nums = parts.map(x => Number(x)).filter(x => !Number.isNaN(x));
    if (nums.length >= 2) data.push({ x: nums[0], y: nums[1] });
  }
  return data;
}

// Returns { readData: [{x,y}], writeData: [{x,y}] } from a BW sample text file.
// Detects header row to find rd/wr columns; falls back to cols 1 and 2.
function extractBWPairs(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  let rdIdx = 1, wrIdx = 2;
  const readData = [], writeData = [];

  for (const line of lines) {
    const parts = splitLineAuto(line);
    // Check if this is a header row (contains non-numeric values)
    const nums = parts.map(x => Number(x));
    const hasNaN = nums.some(x => Number.isNaN(x));
    if (hasNaN) {
      // Try to locate rd and wr columns by header name
      const lower = parts.map(s => s.toLowerCase());
      const rd = lower.findIndex(s => s.includes('_rd') || s === 'rd' || s.includes('read'));
      const wr = lower.findIndex(s => s.includes('_wr') || s === 'wr' || s.includes('write'));
      if (rd !== -1) rdIdx = rd;
      if (wr !== -1) wrIdx = wr;
      continue;
    }
    const t = nums[0];
    if (Number.isNaN(t)) continue;
    if (!Number.isNaN(nums[rdIdx])) readData.push({ x: t, y: nums[rdIdx] });
    if (!Number.isNaN(nums[wrIdx])) writeData.push({ x: t, y: nums[wrIdx] });
  }
  return { readData, writeData };
}

function toPairs(objOrArray) {
  if (!objOrArray) return [];
  if (Array.isArray(objOrArray)) {
    const out = [];
    objOrArray.forEach((v, i) => {
      if (Array.isArray(v) && v.length >= 2) {
        out.push({ key: String(v[0]), value: String(v[1]) });
      } else if (typeof v === "object" && v !== null) {
        Object.entries(v).forEach(([k, val]) => out.push({ key: String(k), value: String(val) }));
      } else {
        out.push({ key: String(i + 1), value: String(v) });
      }
    });
    return out;
  }
  if (typeof objOrArray === "object") {
    return Object.entries(objOrArray).map(([k, v]) => ({ key: String(k), value: String(v) }));
  }
  return [{ key: "value", value: String(objOrArray) }];
}

function normalizeLoopRanges(obj) {
  const candidates = [
    obj?.idi_loops?.ranges,
    obj?.idi_loops?.loop_ranges,
    obj?.rangeLoops,
    obj?.loop_ranges,
    obj?.loops
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length) {
      const normalized = c.map((item, idx) => {
        if (Array.isArray(item) && item.length >= 2) {
          return { loop: idx + 1, start: Number(item[0]), end: Number(item[1]) };
        }
        if (typeof item === "object" && item !== null) {
          return {
            loop: item.loop ?? item.id ?? (idx + 1),
            start: Number(item.start ?? item.Start ?? item.begin ?? item.x0),
            end: Number(item.end ?? item.End ?? item.stop ?? item.x1)
          };
        }
        return null;
      }).filter(x => x && !Number.isNaN(x.start) && !Number.isNaN(x.end));
      if (normalized.length) return normalized;
    }
  }

  return [];
}

// Parse the number of loops from a run directory name, e.g. "...3L..." → 3
function _loopCountFromRunName(name) {
  if (!name) return null;
  const m = String(name).match(/[_\-](\d+)L[_\-]/i);
  return m ? parseInt(m[1], 10) : null;
}

// Build N synthetic loop ranges by dividing the BW time axis into equal windows
function _inferLoopRangesFromBW(n) {
  const data = idiGraphData.length ? idiGraphData : ddrGraphData;
  if (!data.length || n < 1) return [];
  const xs   = data.map(d => d.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const step = (xMax - xMin) / n;
  if (step <= 0) return [];
  const ranges = [];
  for (let i = 0; i < n; i++) {
    ranges.push({ loop: i + 1, start: xMin + i * step, end: xMin + (i + 1) * step });
  }
  return ranges;
}

// Extend normalizeLoopRanges result: if still empty, try to infer from BW data
function _augmentLoopRanges(obj, currentRanges) {
  const bwData = idiGraphData.length ? idiGraphData : ddrGraphData;

  if (currentRanges.length && bwData.length) {
    // Check scale: LIP timestamps (hardware cycles) are typically 20-30x larger than
    // chainsaw BW timestamps. If ratio > 5, the scales don't match — infer from BW.
    const bwMax   = Math.max(...bwData.map(d => d.x));
    const lipMax  = Math.max(...currentRanges.map(r => r.end));
    const ratio   = lipMax / bwMax;
    if (ratio > 5) {
      // Preserve raw LIP ranges for loop metadata (actual durations/timestamps)
      if (obj) obj._rawLoopRanges = currentRanges;
      const n       = currentRanges.length;
      const inferred = _inferLoopRangesFromBW(n);
      if (inferred.length) {
        console.log(`[loops] LIP↔BW scale mismatch (ratio ×${ratio.toFixed(1)}), using BW-inferred ranges for charts`);
        return inferred;
      }
    }
    return currentRanges;   // scales already match
  }

  // No real ranges → try to infer from run name + BW data
  if (!currentRanges.length) {
    const runName = obj?.run_info?.run_name || obj?.run_info?.run_dir || "";
    const n       = _loopCountFromRunName(runName);
    if (!n) return [];
    const inferred = _inferLoopRangesFromBW(n);
    if (inferred.length) {
      console.log(`[loops] inferred ${n} loop ranges from run name "${runName}" + BW data`);
    }
    return inferred;
  }

  return currentRanges;
}

function updateMetricBlock(prefix, data, writeData) {
  const ys = data.map(d => d.y);
  const xs = data.map(d => d.x);

  document.getElementById(prefix + "Samples").textContent = data.length || "-";
  document.getElementById(prefix + "Start").textContent = xs.length ? xs[0] : "-";
  document.getElementById(prefix + "End").textContent = xs.length ? xs[xs.length - 1] : "-";
  document.getElementById(prefix + "Avg").textContent = avg(ys) !== null ? avg(ys).toFixed(2) : "-";
  document.getElementById(prefix + "Max").textContent = maxVal(ys) !== null ? maxVal(ys).toFixed(2) : "-";
  document.getElementById(prefix + "Min").textContent = minVal(ys) !== null ? minVal(ys).toFixed(2) : "-";

  const wys = (writeData || []).map(d => d.y);
  const wAvgEl = document.getElementById(prefix + "WriteAvg");
  const wMaxEl = document.getElementById(prefix + "WriteMax");
  const wMinEl = document.getElementById(prefix + "WriteMin");
  if (wAvgEl) wAvgEl.textContent = avg(wys) !== null ? avg(wys).toFixed(2) : "-";
  if (wMaxEl) wMaxEl.textContent = maxVal(wys) !== null ? maxVal(wys).toFixed(2) : "-";
  if (wMinEl) wMinEl.textContent = minVal(wys) !== null ? minVal(wys).toFixed(2) : "-";
}

function updateLoopInfoCards() {
  // Prefer raw LIP ranges (actual hardware timestamps) for metadata display.
  // If scale mismatch was detected, _rawLoopRanges holds the original LIP values.
  const rawLip = rawAnalysis?._rawLoopRanges;
  const displayRanges = (rawLip && rawLip.length) ? rawLip : loopRanges;
  const sorted = [...displayRanges].sort((a, b) => a.start - b.start);
  const durations = sorted.map(r => r.end - r.start);

  // Core stats
  document.getElementById("loopInfoCount").textContent = sorted.length || "-";
  document.getElementById("loopInfoFirstStart").textContent = sorted.length ? sorted[0].start : "-";
  document.getElementById("loopInfoLastEnd").textContent = sorted.length ? sorted[sorted.length - 1].end : "-";
  document.getElementById("loopInfoTotalSpan").textContent =
    sorted.length ? (sorted[sorted.length - 1].end - sorted[0].start).toFixed(2) : "-";
  document.getElementById("loopInfoAvgDuration").textContent = durations.length ? avg(durations).toFixed(2) : "-";
  document.getElementById("loopInfoMaxDuration").textContent = durations.length ? maxVal(durations).toFixed(2) : "-";
  document.getElementById("loopInfoMinDuration").textContent = durations.length ? minVal(durations).toFixed(2) : "-";

  // Consistency: StdDev and CV of loop durations
  const sd = durations.length >= 2 ? stdDev(durations) : null;
  const mn = durations.length ? avg(durations) : null;
  const cv = (sd !== null && mn && mn !== 0) ? (sd / mn * 100) : null;
  const sdEl = document.getElementById("loopInfoDurStdDev");
  const cvEl = document.getElementById("loopInfoDurCV");
  if (sdEl) sdEl.textContent = sd !== null ? sd.toFixed(3) : "-";
  if (cvEl) cvEl.textContent = cv !== null ? cv.toFixed(1) + " %" : "-";

  // Loop size / count from verification.py registers (Lsz = r10, Loops = r13)
  document.getElementById("loopInfoLsz").textContent = stringifyAny(rawAnalysis?.Lsz ?? "-").trim() || "-";
  document.getElementById("loopInfoLoopsReg").textContent = stringifyAny(rawAnalysis?.Loops ?? "-").trim() || "-";

  // LIP instruction count (MLC workload: numberlipinst)
  const lipInst = rawAnalysis?.numberlipinst;
  document.getElementById("loopInfoLipInst").textContent =
    lipInst !== undefined && lipInst !== null ? stringifyAny(lipInst).trim() : "-";

  // Instruction details: num_instructions = [total, aligned, unaligned]
  const numInst = rawAnalysis?.num_instructions;
  if (Array.isArray(numInst)) {
    document.getElementById("loopInstTotal").textContent = String(numInst[0] ?? "-").trim() || "-";
    document.getElementById("loopInstAligned").textContent = String(numInst[1] ?? "-").trim() || "-";
    document.getElementById("loopInstUnaligned").textContent = String(numInst[2] ?? "-").trim() || "-";
  } else {
    document.getElementById("loopInstTotal").textContent = "-";
    document.getElementById("loopInstAligned").textContent = "-";
    document.getElementById("loopInstUnaligned").textContent = "-";
  }

  // LIP test boundaries — rendered by renderLipBoundaryTable()
  renderLipBoundaryTable();

  // Raw debug block
  document.getElementById("loopDebugBlock").textContent = rawAnalysis ? JSON.stringify({
    idi_loops: rawAnalysis?.idi_loops ?? null,
    rangeLoops: rawAnalysis?.rangeLoops ?? null,
    loop_ranges: rawAnalysis?.loop_ranges ?? null,
    loops: rawAnalysis?.loops ?? null,
    Loops: rawAnalysis?.Loops ?? null,
    Lsz: rawAnalysis?.Lsz ?? null,
    num_instructions: rawAnalysis?.num_instructions ?? null,
    numberlipinst: rawAnalysis?.numberlipinst ?? null,
    start_lip: rawAnalysis?.start_lip ?? null,
    StarttimeStamp: rawAnalysis?.StarttimeStamp ?? null,
    endtimeStamp: rawAnalysis?.endtimeStamp ?? null
  }, null, 2) : "-";
}

// ---------------------------------------------------------------------------
// Directory-timeline helpers
// ---------------------------------------------------------------------------

// Apply dir_times (from server) and ls_output to rawAnalysis + DOM
function applyDirTimes(dirTimes, lsOutput) {
  console.log("[applyDirTimes] received:", dirTimes, "ls length:", (lsOutput || "").length);
  if (!dirTimes || typeof dirTimes !== "object") return;
  if (!rawAnalysis) rawAnalysis = {};
  if (!rawAnalysis.run_info) rawAnalysis.run_info = {};

  // Each key in dirTimes is a basename; each value is { create, modify }
  const get = (key, field) => (dirTimes[key] || {})[field] || "";

  const idiKey  = Object.keys(dirTimes).find(k => k.includes("chainsaw_tmp"))    || null;
  const ddrKey  = Object.keys(dirTimes).find(k => k.includes("chainsaw_lpddr")) || null;
  const jsonKey = Object.keys(dirTimes).find(k => k.endsWith(".json"))            || null;

  // Always overwrite with real filesystem timestamps so the UI shows wall-clock
  // times instead of JSON sample-index numbers.
  if (idiKey) {
    rawAnalysis.testStart = get(idiKey, "create") || get(idiKey, "modify");
    rawAnalysis.testEnd   = get(idiKey, "modify")  || get(idiKey, "create");
  }
  if (ddrKey) {
    rawAnalysis.testStartDDR = get(ddrKey, "create") || get(ddrKey, "modify");
    rawAnalysis.testEndDDR   = get(ddrKey, "modify")  || get(ddrKey, "create");
  }

  // generated_at: use dashboard_data.json mtime, fall back to what JSON already has
  if (jsonKey && get(jsonKey, "modify")) {
    rawAnalysis.run_info.generated_at = get(jsonKey, "modify");
  }

  rawAnalysis._dir_times = dirTimes;
  rawAnalysis._ls_output = lsOutput || "";
}

function renderDirTimeline() {
  const panel = document.getElementById("dirTimelinePanel");
  if (!panel) return;

  const dt  = rawAnalysis?._dir_times || {};
  const ls  = rawAnalysis?._ls_output || "";

  const tbody = document.getElementById("dirTimesBody");
  if (tbody) {
    tbody.innerHTML = "";
    Object.entries(dt).forEach(([name, v]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-family:monospace;font-size:0.85rem;">${name}</td>
        <td style="font-family:monospace;font-size:0.85rem;color:#059669;">${v.create || "-"}</td>
        <td style="font-family:monospace;font-size:0.85rem;color:#2563eb;">${v.modify || "-"}</td>`;
      tbody.appendChild(tr);
    });
  }

  const lsBlock = document.getElementById("lsOutputBlock");
  if (lsBlock) lsBlock.textContent = ls || "(no output)";

  if (Object.keys(dt).length || ls) panel.style.display = "";
}

function updateMetaCards() {
  const runInfo = rawAnalysis?.run_info || {};
  document.getElementById("runDirValue").textContent = runInfo.run_dir || "-";
  document.getElementById("runNameValue").textContent = runInfo.run_name || "-";
  document.getElementById("generatedAtValue").textContent = runInfo.generated_at || "-";
  document.getElementById("graph1SourceValue").textContent = baseName(rawAnalysis?.graph1_file || "Not found");
  document.getElementById("graph2SourceValue").textContent = baseName(rawAnalysis?.graph2_file || "Not found");
  document.getElementById("loopCountValue").textContent = loopRanges.length || "-";
}

function updateRunSummary() {
  document.getElementById("testStartId").textContent = rawAnalysis?.testStart ?? "-";
  document.getElementById("testEndId").textContent   = rawAnalysis?.testEnd   ?? "-";
  document.getElementById("testStartDdr").textContent = rawAnalysis?.testStartDDR ?? "-";
  document.getElementById("testEndDdr").textContent   = rawAnalysis?.testEndDDR   ?? "-";
  document.getElementById("threadsValue").textContent = rawAnalysis?.Threads ?? rawAnalysis?.platform?.threads?.length ?? "-";
  document.getElementById("coresValue").textContent   = rawAnalysis?.Cores   ?? "-";
  document.getElementById("lszValue").textContent     = stringifyAny(rawAnalysis?.Lsz   || "-").trim() || "-";
  document.getElementById("loopsValue").textContent   = stringifyAny(rawAnalysis?.Loops || "-").trim() || "-";
  document.getElementById("cmdLineBlock").textContent = stringifyAny(rawAnalysis?.test_cmd_line || "-");
  document.getElementById("runModelBlock").textContent = stringifyAny(rawAnalysis?.kind_model || "-");

  // Parse IDI tracker raw line into field columns
  // Format: Timestamp | Source | f2 | f3 | f4 | Address | Opcode | Type | ...
  const IDI_FIELDS = ["Timestamp", "Source", "Entry1", "Entry2", "Entry3",
                       "Address", "Opcode", "Type", "f8", "f9"];
  function renderIdiLine(rawLine, headId, rowId) {
    const headEl = document.getElementById(headId);
    const rowEl  = document.getElementById(rowId);
    if (!headEl || !rowEl) return;
    const line = String(rawLine || "").trim();
    if (!line || line === "-") {
      headEl.innerHTML = ""; rowEl.innerHTML = `<td style="color:#6b7280;">Not available</td>`;
      return;
    }
    const parts = line.split("|").map(p => p.trim()).slice(0, 10);
    headEl.innerHTML = IDI_FIELDS.slice(0, parts.length)
      .map(f => `<th style="white-space:nowrap;">${f}</th>`).join("");
    rowEl.innerHTML = parts.map((p, i) => {
      const color = i === 6 ? "color:#60a5fa;" : i === 5 ? "color:#34d399;font-family:monospace;" : "";
      return `<td style="${color}white-space:nowrap;">${p || "-"}</td>`;
    }).join("");
  }
  renderIdiLine(rawAnalysis?.testStart, "testStartParsedHead", "testStartParsedRow");
  renderIdiLine(rawAnalysis?.testEnd,   "testEndParsedHead",   "testEndParsedRow");
}

function buildLoopShapes() {
  const colors = ["rgba(37,99,235,0.10)", "rgba(5,150,105,0.10)", "rgba(220,38,38,0.10)", "rgba(124,58,237,0.10)"];
  return loopRanges.map((r, idx) => ({
    type: "rect",
    xref: "x",
    yref: "paper",
    x0: r.start,
    x1: r.end,
    y0: 0,
    y1: 1,
    fillcolor: colors[idx % colors.length],
    line: { width: 0 }
  }));
}

function buildLoopBoundaryLines() {
  const lines = [];
  loopRanges.forEach(r => {
    lines.push({ type: "line", xref: "x", yref: "paper", x0: r.start, x1: r.start, y0: 0, y1: 1, line: { color: "#ef4444", width: 1, dash: "dot" } });
    lines.push({ type: "line", xref: "x", yref: "paper", x0: r.end, x1: r.end, y0: 0, y1: 1, line: { color: "#10b981", width: 1, dash: "dot" } });
  });
  return lines;
}

function getCtrl(id, fallback) {
  const el = document.getElementById(id);
  return el ? el.value : fallback;
}

function applyAnalysisControls() {
  const idiRd = _applyRange(idiGraphData);
  const idiWr = _applyRange(idiWriteData);
  const ddrRd = _applyRange(ddrGraphData);
  const ddrWr = _applyRange(ddrWriteData);
  renderIdiChart();
  renderDdrChart();
  renderBWPreviewTables();
  updateMetricBlock("idi", idiRd, idiWr);
  updateMetricBlock("ddr", ddrRd, ddrWr);
  _setVisibleRangeInfo(
    (idiRd.length < idiGraphData.length || ddrRd.length < ddrGraphData.length)
      ? `Range filter active — IDI: ${idiRd.length}/${idiGraphData.length} pts · DDR: ${ddrRd.length}/${ddrGraphData.length} pts`
      : "Visible range metrics are based on the full graph range."
  );
}

function resetAnalysisControls() {
  const ids = ["xMode", "rangeStart", "rangeEnd", "showIdiRead", "showIdiWrite", "showDdrRead", "showDdrWrite"];
  const defaults = ["time", "", "", "on", "on", "on", "on"];
  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.value = defaults[i];
  });
  renderIdiChart();
  renderDdrChart();
  renderBWPreviewTables();
  updateMetricBlock("idi", idiGraphData, idiWriteData);
  updateMetricBlock("ddr", ddrGraphData, ddrWriteData);
  _setVisibleRangeInfo("Visible range metrics are based on the full graph range.");
}

function _applyRange(data) {
  const start = document.getElementById("rangeStart")?.value.trim();
  const end   = document.getElementById("rangeEnd")?.value.trim();
  if (!start && !end) return data;
  const filtered = data.filter(d => {
    const x = d.x;
    const okS = start === "" ? true : x >= Number(start);
    const okE = end   === "" ? true : x <= Number(end);
    return okS && okE;
  });
  // Safety: if the range filter removes ALL points, ignore it and return full data
  // (prevents blank charts when range was set for a different dataset)
  if (filtered.length === 0 && data.length > 0) {
    console.warn("[_applyRange] range filter removed all data — ignoring filter and showing full dataset");
    return data;
  }
  return filtered;
}

function _clearRangeFilter() {
  const rs = document.getElementById("rangeStart");
  const re = document.getElementById("rangeEnd");
  if (rs) rs.value = "";
  if (re) re.value = "";
}

function _xAxisTitle() {
  return getCtrl("xMode", "time") === "time" ? "Time" : "Sample Index";
}

function renderBWPreviewTables(idiRange, ddrRange) {
  const readData  = idiRange  ?? _applyRange(idiGraphData);
  const writeData = ddrRange  ?? _applyRange(idiWriteData);
  const ddrRead   = _applyRange(ddrGraphData);
  const ddrWrite  = _applyRange(ddrWriteData);

  const xLabel = getCtrl("xMode", "time") === "time" ? "Time" : "Index";
  const idiHeader = document.getElementById("idiPreviewXHeader");
  if (idiHeader) idiHeader.textContent = xLabel;

  function fillTable(bodyId, pillId, rdArr, wrArr) {
    const body = document.getElementById(bodyId);
    const pill = document.getElementById(pillId);
    if (!body) return;
    body.innerHTML = "";
    const maxLen = Math.max(rdArr.length, wrArr.length);
    const count  = Math.min(maxLen, 200);
    if (pill) pill.textContent = `${count} rows`;
    for (let i = 0; i < count; i++) {
      const rd = rdArr[i];
      const wr = wrArr[i];
      const x  = rd ? rd.x : (wr ? wr.x : "-");
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${i + 1}</td><td>${x}</td><td>${rd ? rd.y.toFixed(2) : "-"}</td><td>${wr ? wr.y.toFixed(2) : "-"}</td>`;
      body.appendChild(tr);
    }
  }

  fillTable("idiPreviewBody", "idiPreviewCountPill", readData, writeData);
  fillTable("ddrPreviewBody", "ddrPreviewCountPill", ddrRead, ddrWrite);
}

function _setVisibleRangeInfo(text) {
  const el = document.getElementById("visibleRangeInfo");
  if (el) el.textContent = text;
}

function renderIdiChart() {
  const showRead  = getCtrl("showIdiRead",  "on") === "on";
  const showWrite = getCtrl("showIdiWrite", "on") === "on";
  const xLabel    = _xAxisTitle();
  const traces    = [];

  const rdData = _applyRange(idiGraphData);
  const wrData = _applyRange(idiWriteData);

  if (showRead && rdData.length) {
    traces.push({
      x: rdData.map(d => d.x),
      y: rdData.map(d => d.y),
      mode: "lines+markers",
      name: "IDI Read BW",
      line: { color: "#2563eb", width: 2 },
      marker: { size: 4 }
    });
  }
  if (showWrite && wrData.length) {
    traces.push({
      x: wrData.map(d => d.x),
      y: wrData.map(d => d.y),
      mode: "lines+markers",
      name: "IDI Write BW",
      line: { color: "#f59e0b", width: 2, dash: "dash" },
      marker: { size: 4 }
    });
  }

  Plotly.newPlot("idiChart", traces, {
    margin: { t: 20, r: 20, b: 50, l: 60 },
    xaxis: { title: xLabel },
    yaxis: { title: "IDI BW" },
    legend: { orientation: "h", y: 1.08 },
    shapes: [...buildLoopShapes(), ...buildLoopBoundaryLines()]
  }, { responsive: true });

  const el = document.getElementById("idiChart");
  if (el) {
    el.on("plotly_relayout", eventData => {
      const x0 = eventData["xaxis.range[0]"];
      const x1 = eventData["xaxis.range[1]"];
      if (x0 !== undefined && x1 !== undefined) {
        const visRd = rdData.filter(d => d.x >= Number(x0) && d.x <= Number(x1));
        const visWr = wrData.filter(d => d.x >= Number(x0) && d.x <= Number(x1));
        updateMetricBlock("idi", visRd, visWr);
        renderBWPreviewTables(visRd, visWr);
        _setVisibleRangeInfo(`Visible IDI range: ${Number(x0).toFixed(2)} – ${Number(x1).toFixed(2)}`);
      } else if (eventData["xaxis.autorange"]) {
        updateMetricBlock("idi", rdData, wrData);
        renderBWPreviewTables(rdData, wrData);
        _setVisibleRangeInfo("Visible range metrics are based on the full graph range.");
      }
    });
  }
}

function renderDdrChart() {
  const showRead  = getCtrl("showDdrRead",  "on") === "on";
  const showWrite = getCtrl("showDdrWrite", "on") === "on";
  const xLabel    = _xAxisTitle();
  const traces    = [];

  const rdData = _applyRange(ddrGraphData);
  const wrData = _applyRange(ddrWriteData);

  if (showRead && rdData.length) {
    traces.push({
      x: rdData.map(d => d.x),
      y: rdData.map(d => d.y),
      mode: "lines+markers",
      name: "DDR Read BW",
      line: { color: "#7c3aed", width: 2 },
      marker: { size: 4 }
    });
  }
  if (showWrite && wrData.length) {
    traces.push({
      x: wrData.map(d => d.x),
      y: wrData.map(d => d.y),
      mode: "lines+markers",
      name: "DDR Write BW",
      line: { color: "#ec4899", width: 2, dash: "dash" },
      marker: { size: 4 }
    });
  }

  Plotly.newPlot("ddrChart", traces, {
    margin: { t: 20, r: 20, b: 50, l: 60 },
    xaxis: { title: xLabel },
    yaxis: { title: "DDR BW" },
    legend: { orientation: "h", y: 1.08 },
    shapes: [...buildLoopShapes(), ...buildLoopBoundaryLines()]
  }, { responsive: true });

  const el = document.getElementById("ddrChart");
  if (el) {
    el.on("plotly_relayout", eventData => {
      const x0 = eventData["xaxis.range[0]"];
      const x1 = eventData["xaxis.range[1]"];
      if (x0 !== undefined && x1 !== undefined) {
        const visRd = rdData.filter(d => d.x >= Number(x0) && d.x <= Number(x1));
        const visWr = wrData.filter(d => d.x >= Number(x0) && d.x <= Number(x1));
        updateMetricBlock("ddr", visRd, visWr);
      } else if (eventData["xaxis.autorange"]) {
        updateMetricBlock("ddr", rdData, wrData);
      }
    });
  }
}

function renderLoopChart() {
  const sorted = [...loopRanges].sort((a, b) => a.start - b.start);
  const trace = sorted.length ? [{
    type: "bar",
    orientation: "h",
    x: sorted.map(r => r.end - r.start),
    y: sorted.map(r => `Loop ${r.loop}`),
    base: sorted.map(r => r.start),
    marker: { color: "#2563eb" }
  }] : [];

  Plotly.newPlot("loopChart", trace, {
    margin: { t: 20, r: 20, b: 50, l: 90 },
    xaxis: { title: "Time" },
    yaxis: { title: "Loops", autorange: "reversed" }
  }, { responsive: true });
}

function zoomChartsToRange(start, end) {
  Plotly.relayout("idiChart", { "xaxis.range[0]": start, "xaxis.range[1]": end });
  Plotly.relayout("ddrChart", { "xaxis.range[0]": start, "xaxis.range[1]": end });
  updateMetricBlock("idi", getVisibleData(idiGraphData, start, end), getVisibleData(idiWriteData, start, end));
  updateMetricBlock("ddr", getVisibleData(ddrGraphData, start, end), getVisibleData(ddrWriteData, start, end));
}

function renderLoopTable() {
  const body = document.getElementById("loopMetricsBody");
  if (!body) return;
  body.innerHTML = "";
  const sorted = [...loopRanges].sort((a, b) => a.start - b.start);
  if (!sorted.length) return;

  const fmt = v => (v !== null && v !== undefined && !isNaN(v)) ? v.toFixed(2) : "-";

  sorted.forEach((r, idx) => {
    const duration = r.end - r.start;

    const iRd = getVisibleData(idiGraphData,  r.start, r.end).map(d => d.y);
    const iWr = getVisibleData(idiWriteData,  r.start, r.end).map(d => d.y);
    const dRd = getVisibleData(ddrGraphData,  r.start, r.end).map(d => d.y);
    const dWr = getVisibleData(ddrWriteData,  r.start, r.end).map(d => d.y);

    const tr = document.createElement("tr");
    tr.className = "clickable";
    tr.innerHTML = `
      <td style="font-weight:600; text-align:center;">${r.loop ?? (idx + 1)}</td>
      <td style="text-align:center;">${duration.toFixed(3)}</td>
      <td style="color:#2563eb;">${fmt(avg(iRd))}</td>
      <td style="color:#2563eb;">${fmt(minVal(iRd))}</td>
      <td style="color:#2563eb;">${fmt(maxVal(iRd))}</td>
      <td style="color:#f59e0b;">${fmt(avg(iWr))}</td>
      <td style="color:#f59e0b;">${fmt(minVal(iWr))}</td>
      <td style="color:#f59e0b;">${fmt(maxVal(iWr))}</td>
      <td style="color:#10b981;">${fmt(avg(dRd))}</td>
      <td style="color:#10b981;">${fmt(minVal(dRd))}</td>
      <td style="color:#10b981;">${fmt(maxVal(dRd))}</td>
      <td style="color:#a855f7;">${fmt(avg(dWr))}</td>
      <td style="color:#a855f7;">${fmt(minVal(dWr))}</td>
      <td style="color:#a855f7;">${fmt(maxVal(dWr))}</td>`;
    tr.addEventListener("click", () => zoomChartsToRange(r.start, r.end));
    body.appendChild(tr);
  });
}

function renderLipBoundaryTable() {
  const head = document.getElementById("lipBoundaryHead");
  const body = document.getElementById("lipBoundaryBody");
  const note = document.getElementById("lipBoundaryNote");
  if (!head || !body) return;

  function parseTrackerLine(raw) {
    if (!raw || raw.trim() === "-" || raw.trim().toLowerCase() === "none") return null;
    const line = raw.trim();
    const colonIdx = line.indexOf(":");
    const ts   = colonIdx >= 0 ? line.substring(0, colonIdx).trim() : "";
    const rest = colonIdx >= 0 ? line.substring(colonIdx + 1) : line;
    const parts = rest.split("|").map(p => p.trim());
    const addr   = parts[0] || "";
    const fields = parts.slice(1);
    return { ts, addr, fields, raw: line };
  }

  const startLip = rawAnalysis?.start_lip;

  if (Array.isArray(startLip) && (startLip[1] || startLip[3])) {
    // Real LIP tracker lines from extractor/shell fallback
    const s = parseTrackerLine(String(startLip[1] ?? ""));
    const e = parseTrackerLine(String(startLip[3] ?? ""));
    const maxF = Math.max(s?.fields.length ?? 0, e?.fields.length ?? 0);

    let hRow = "<tr><th>Event</th><th>Timestamp</th><th>Address</th>";
    for (let i = 1; i <= maxF; i++) hRow += `<th>Field ${i}</th>`;
    hRow += "</tr>";
    head.innerHTML = hRow;

    const makeRow = (label, p, color) => {
      if (!p) return `<tr><td style="font-weight:600;color:${color};">${label}</td><td>-</td><td>-</td>${"<td>-</td>".repeat(maxF)}</tr>`;
      let row = `<tr><td style="font-weight:600;color:${color};">${label}</td>`;
      row += `<td style="font-family:monospace;">${p.ts || "-"}</td>`;
      row += `<td style="font-family:monospace;color:${color};">${p.addr || "-"}</td>`;
      for (let i = 0; i < maxF; i++) row += `<td>${p.fields[i] ?? "-"}</td>`;
      row += "</tr>";
      return row;
    };
    body.innerHTML = makeRow("LIP Start", s, "#60a5fa") + makeRow("LIP End", e, "#34d399");
    if (note) note.textContent = "";

  } else if (idiGraphData.length > 0) {
    // Fallback: derive from IDI BW sample timestamps
    const firstTs = idiGraphData[0].x;
    const lastTs  = idiGraphData[idiGraphData.length - 1].x;
    head.innerHTML = "<tr><th>Event</th><th>Timestamp</th><th>Address</th><th>Source</th></tr>";
    body.innerHTML = `
      <tr>
        <td style="font-weight:600;color:#60a5fa;">LIP Start</td>
        <td style="font-family:monospace;">${firstTs}</td>
        <td>-</td>
        <td style="color:#6b7280;font-size:0.82rem;">IDI BW first sample</td>
      </tr>
      <tr>
        <td style="font-weight:600;color:#34d399;">LIP End</td>
        <td style="font-family:monospace;">${lastTs}</td>
        <td>-</td>
        <td style="color:#6b7280;font-size:0.82rem;">IDI BW last sample</td>
      </tr>`;
    if (note) note.textContent = "Timestamps derived from IDI BW samples — run Verification Script for full LIP tracker data";

  } else {
    head.innerHTML = "<tr><th>Event</th><th>Timestamp</th><th>Address</th></tr>";
    body.innerHTML = "<tr><td>LIP Start</td><td>-</td><td>-</td></tr><tr><td>LIP End</td><td>-</td><td>-</td></tr>";
    if (note) note.textContent = "";
  }
}

function renderLoopBwChart() {
  const chartEl = document.getElementById("loopBwChart");
  if (!chartEl) return;
  const sorted = [...loopRanges].sort((a, b) => a.start - b.start);
  if (!sorted.length || !idiGraphData.length) {
    Plotly.newPlot("loopBwChart", [], { margin: { t:10, r:10, b:30, l:50 } }, { responsive: true });
    return;
  }
  const labels  = sorted.map(r => `Loop ${r.loop}`);
  const rdAvgs  = sorted.map(r => { const ys = getVisibleData(idiGraphData, r.start, r.end).map(d => d.y); return avg(ys) ?? 0; });
  const wrAvgs  = sorted.map(r => { const ys = getVisibleData(idiWriteData, r.start, r.end).map(d => d.y); return avg(ys) ?? 0; });
  const rdMaxes = sorted.map(r => { const ys = getVisibleData(idiGraphData, r.start, r.end).map(d => d.y); return maxVal(ys) ?? 0; });
  const wrMaxes = sorted.map(r => { const ys = getVisibleData(idiWriteData, r.start, r.end).map(d => d.y); return maxVal(ys) ?? 0; });

  Plotly.newPlot("loopBwChart", [
    { name: "Avg Read BW",  x: labels, y: rdAvgs,  type: "bar", marker: { color: "#2563eb" } },
    { name: "Avg Write BW", x: labels, y: wrAvgs,  type: "bar", marker: { color: "#f59e0b" } },
    { name: "Max Read BW",  x: labels, y: rdMaxes, type: "bar", marker: { color: "#93c5fd" } },
    { name: "Max Write BW", x: labels, y: wrMaxes, type: "bar", marker: { color: "#fcd34d" } }
  ], {
    barmode: "group",
    margin: { t: 20, r: 20, b: 60, l: 60 },
    xaxis: { title: "Loop" },
    yaxis: { title: "IDI BW" },
    legend: { orientation: "h", y: 1.12 }
  }, { responsive: true });
}

function renderKeyValueTable(bodyId, pairs) {
  const body = document.getElementById(bodyId);
  body.innerHTML = "";
  pairs.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${p.key}</td><td>${p.value}</td>`;
    body.appendChild(tr);
  });
}

// Opcode loop pagination state
let _opcodeLoops = [];   // parsed per-loop data: [{loopIdx, totalInstr, entries}]
let _opcodeLoopPage = 0;
let _renderPivotTable = function() {}; // assigned inside renderIdiOpcodeSection

function opcodeLoopPage(delta) {
  _opcodeLoopPage = Math.max(0, Math.min(_opcodeLoops.length - 1, _opcodeLoopPage + delta));
  _renderOpcodeLoopPage();
}

function _renderOpcodeLoopPage() {
  const container = document.getElementById("opcodeLoopContainer");
  const label     = document.getElementById("olPageLabel");
  const prevBtn   = document.getElementById("olPrevBtn");
  const nextBtn   = document.getElementById("olNextBtn");
  if (!container || !_opcodeLoops.length) return;

  const item = _opcodeLoops[_opcodeLoopPage];
  if (label)   label.textContent = `Loop ${item.loopIdx + 1} of ${_opcodeLoops.length}`;
  if (prevBtn) prevBtn.disabled  = _opcodeLoopPage === 0;
  if (nextBtn) nextBtn.disabled  = _opcodeLoopPage === _opcodeLoops.length - 1;

  // Pull timestamp range — prefer raw LIP timestamps if available
  const rawLip = rawAnalysis?._rawLoopRanges;
  const displayRanges = (rawLip && rawLip.length) ? rawLip : loopRanges;
  const lr  = displayRanges[item.loopIdx] || null;
  const tsStart = lr?.start ?? null;
  const tsEnd   = lr?.end   ?? null;

  // totalInstr may be a count (number) or a shell command string
  const totalRaw = item.totalInstr;
  const isCmd    = typeof totalRaw === "string" && totalRaw.includes("zcat");
  const totalNum = !isCmd && totalRaw ? Number(totalRaw) : null;

  let metaHtml = "";
  if (tsStart !== null && tsEnd !== null) {
    metaHtml += `
      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:8px;">
        <div>
          <span style="font-size:0.72rem;color:#6b7280;">Start Timestamp</span><br>
          <span style="font-family:monospace;font-size:0.95rem;">${tsStart.toLocaleString()}</span>
        </div>
        <div>
          <span style="font-size:0.72rem;color:#6b7280;">End Timestamp</span><br>
          <span style="font-family:monospace;font-size:0.95rem;">${tsEnd.toLocaleString()}</span>
        </div>
        <div>
          <span style="font-size:0.72rem;color:#6b7280;">Duration</span><br>
          <span style="font-family:monospace;font-size:0.95rem;">${(tsEnd - tsStart).toLocaleString()}</span>
        </div>
        ${totalNum ? `<div><span style="font-size:0.72rem;color:#6b7280;">Total Instructions</span><br>
          <span style="font-family:monospace;font-size:0.95rem;">${totalNum.toLocaleString()}</span></div>` : ""}
      </div>`;
  } else if (totalNum) {
    metaHtml += `<div style="margin-bottom:6px;font-size:0.82rem;color:#9ca3af;">Total instructions: ${totalNum.toLocaleString()}</div>`;
  }

  // Show shell command in collapsible if present
  const cmdHtml = isCmd ? `
    <details style="margin-bottom:8px;">
      <summary style="cursor:pointer;font-size:0.75rem;color:#6b7280;user-select:none;">&#9654; Shell command (line range)</summary>
      <pre style="font-size:0.72rem;white-space:pre-wrap;word-break:break-all;margin-top:4px;color:#93c5fd;">${totalRaw}</pre>
    </details>` : "";

  container.innerHTML = `
    <div style="font-size:0.84rem;font-weight:600;color:#60a5fa;padding:4px 0 6px 0;">
      Loop ${item.loopIdx + 1}
    </div>
    ${metaHtml}
    ${cmdHtml}
    <div class="table-wrap" style="overflow-x:auto;">
      <table><thead id="olHeadPage"></thead><tbody id="olBodyPage"></tbody></table>
    </div>`;

  _renderPivotTable(
    document.getElementById("olHeadPage"),
    document.getElementById("olBodyPage"),
    item.entries
  );
}

function renderIdiOpcodeSection() {
  // Parse flat opcode data into [{count, src, opcode, misc}, ...]
  // Format from verification.py: [count, src (e.g. AT_IDI_0), opcode (e.g. IDI_GO), misc]
  function parseOpcodeEntries(raw) {
    const entries = [];
    if (!Array.isArray(raw)) return entries;
    raw.forEach(item => {
      let parts;
      if (Array.isArray(item)) parts = item.map(x => String(x).trim());
      else parts = String(item).split(",").map(s => s.trim());
      const cnt = parseInt(parts[0]);
      if (parts.length >= 3 && !isNaN(cnt) && cnt > 0)
        entries.push({ count: cnt, src: parts[1] || "", opcode: parts[2] || "", misc: parts[3] || "" });
    });
    return entries;
  }

  // Build pivot: { src → { opcode → count } }, sorted opcodes by total desc
  function buildPivot(entries) {
    const pivot = {}, seen = new Set();
    entries.forEach(e => {
      if (!pivot[e.src]) pivot[e.src] = {};
      pivot[e.src][e.opcode] = (pivot[e.src][e.opcode] || 0) + e.count;
      if (e.opcode) seen.add(e.opcode);
    });
    const opcodes = [...seen];
    const totals = {};
    opcodes.forEach(op => {
      totals[op] = Object.values(pivot).reduce((s, m) => s + (m[op] || 0), 0);
    });
    opcodes.sort((a, b) => (totals[b] || 0) - (totals[a] || 0));
    return { pivot, opcodes, totals };
  }

  // Render a pivot table into given thead/tbody elements (module-level so pagination can call it)
  _renderPivotTable = function(headEl, bodyEl, entries) {
    if (!headEl || !bodyEl) return;
    const { pivot, opcodes, totals } = buildPivot(entries);
    if (!opcodes.length) {
      headEl.innerHTML = "";
      bodyEl.innerHTML = "<tr><td style='color:#6b7280;'>No data</td></tr>";
      return;
    }
    headEl.innerHTML = `<tr><th style="white-space:nowrap;">Source</th>${opcodes.map(op =>
      `<th style="white-space:nowrap;color:#93c5fd;">${op}</th>`).join("")}</tr>`;
    bodyEl.innerHTML =
      Object.entries(pivot).map(([src, m]) =>
        `<tr><td style="font-weight:600;white-space:nowrap;color:#60a5fa;">${src}</td>
         ${opcodes.map(op => `<td style="text-align:right;">${(m[op] || 0).toLocaleString()}</td>`).join("")}
         </tr>`).join("") +
      `<tr style="background:#1e3a5f;">
         <td style="font-weight:600;color:#fff;">SUMMARY</td>
         ${opcodes.map(op => `<td style="text-align:right;font-weight:600;color:#fff;">${(totals[op] || 0).toLocaleString()}</td>`).join("")}
       </tr>`;
  };

  // ── Total opcodes ────────────────────────────────────────────────────────
  const entries = parseOpcodeEntries(rawAnalysis?.opcodes);
  _renderPivotTable(
    document.getElementById("idiOpcodeHead"),
    document.getElementById("idiOpcodeBody"),
    entries
  );

  // ── Per-loop opcode pagination ───────────────────────────────────────────
  const ol    = rawAnalysis?.OpcodeLoop;
  const olWrap = document.getElementById("opcodeLoopWrap");

  if (Array.isArray(ol) && ol.length === 2 && Array.isArray(ol[0]) && ol[0].length > 0) {
    _opcodeLoops = ol[0].map((loopData, idx) => ({
      loopIdx:    idx,
      totalInstr: ol[1]?.[idx],
      entries:    parseOpcodeEntries(loopData)
    }));
    _opcodeLoopPage = 0;
    if (olWrap) olWrap.style.display = "";
    _renderOpcodeLoopPage();
  } else {
    _opcodeLoops = [];
    if (olWrap) olWrap.style.display = "none";
  }

  // ── SOC CFI opcodes ──────────────────────────────────────────────────────
  const cfi     = rawAnalysis?.opcodes_soc_cfi;
  const cfiWrap = document.getElementById("socCfiWrap");
  const cfiHead = document.getElementById("socCfiHead");
  const cfiBody = document.getElementById("socCfiBody");
  if (Array.isArray(cfi) && cfi.length > 0) {
    if (cfiWrap) cfiWrap.style.display = "";
    const headers = ["Count","VC_NAME","INTERFACE","PROTOCOL_ID","RSPID","DSTID","OPCODE","Misc1","Misc2"];
    if (cfiHead) cfiHead.innerHTML = headers.map(h => `<th>${h}</th>`).join("");
    if (cfiBody) {
      cfiBody.innerHTML = cfi.map(line => {
        const cols = String(line).split(",").map(s => s.trim());
        return `<tr>${cols.map((c, i) => i === 0
          ? `<td style="text-align:right;font-weight:600;">${c}</td>`
          : `<td>${c}</td>`).join("")}</tr>`;
      }).join("");
    }
  } else if (cfiWrap) cfiWrap.style.display = "none";
}

function renderDdrSection() {
  document.getElementById("ddrReadCount").textContent  = rawAnalysis?.DDR_info  ?? "-";
  document.getElementById("ddrWriteCount").textContent = rawAnalysis?.DDR_infoW ?? "-";

  // DDR_infoS: list of "count, opcode" strings from lpddr5_xtor*tracker*
  const raw = rawAnalysis?.DDR_infoS;
  const rows = [];
  if (Array.isArray(raw)) {
    raw.forEach(item => {
      const parts = String(item).split(",").map(s => s.trim());
      if (parts.length >= 2 && parts[0]) rows.push(parts);
    });
  }
  const body = document.getElementById("ddrOpcodeBody");
  if (body) {
    body.innerHTML = rows.map(p =>
      `<tr><td style="text-align:right;font-weight:600;">${p[0]}</td>
           <td style="color:#a855f7;">${p[1] ?? "-"}</td></tr>`
    ).join("") || `<tr><td colspan="2" style="color:#6b7280;">No DDR opcode data</td></tr>`;
  }

  Plotly.newPlot("ddrRwChart", [{
    type: "bar",
    x: ["Read", "Write"],
    y: [Number(rawAnalysis?.DDR_info ?? 0), Number(rawAnalysis?.DDR_infoW ?? 0)],
    marker: { color: ["#2563eb", "#7c3aed"] }
  }], {
    margin: { t: 20, r: 20, b: 50, l: 50 },
    yaxis: { title: "Count" }
  }, { responsive: true });
}

function renderPlatformSection() {
  const body = document.getElementById("platformBody");
  body.innerHTML = "";
  const threads = rawAnalysis?.platform?.threads || [];
  threads.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.tag ?? "-"}</td>
      <td>${t.apic_id ?? "-"}</td>
      <td>${t.cluster ?? "-"}</td>
      <td>${t.cluster_id ?? "-"}</td>
      <td>${t.core_id ?? "-"}</td>
      <td>${t.enabled ?? "-"}</td>
      <td>${t.kind ?? "-"}</td>
      <td>${t.package_id ?? "-"}</td>
    `;
    body.appendChild(tr);
  });
}

function renderScenarioSection() {
  const trafficBody = document.getElementById("trafficBody");
  trafficBody.innerHTML = "";
  const traffic = rawAnalysis?.scenario?.traffic_by_thread || [];
  traffic.forEach(t => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${t.thread ?? "-"}</td><td>${t.traffic ?? "-"}</td>`;
    trafficBody.appendChild(tr);
  });

  // Memory_json: [[thread, cluster, bufsize_kb, localbuff, localbuff2, writebuff], ...]
  const memBody = document.getElementById("memoryJsonBody");
  memBody.innerHTML = "";
  const memory = rawAnalysis?.Memory_json || rawAnalysis?.scenario?.memory_json || [];
  if (Array.isArray(memory) && memory.length) {
    memory.forEach(row => {
      const r = Array.isArray(row) ? row : [row];
      const fmtHex = v => {
        const n = Number(v);
        return (!isNaN(n) && n > 0xFFFF) ? "0x" + n.toString(16).toUpperCase() : String(v ?? "-");
      };
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="color:#60a5fa;">${r[0] ?? "-"}</td>
        <td style="font-family:monospace;">${r[1] ?? "-"}</td>
        <td style="text-align:right;">${r[2] ?? "-"}</td>
        <td style="font-family:monospace;color:#34d399;">${fmtHex(r[3])}</td>
        <td style="font-family:monospace;color:#34d399;">${fmtHex(r[4])}</td>
        <td style="font-family:monospace;color:#34d399;">${fmtHex(r[5])}</td>`;
      memBody.appendChild(tr);
    });
  } else {
    memBody.innerHTML = `<tr><td colspan="6" style="color:#6b7280;">No Memory JSON data (requires verification.py run)</td></tr>`;
  }
}

function renderConfigSection() {
  document.getElementById("biosInfoBlock").textContent = stringifyAny(rawAnalysis?.BiosInfo || "-");
  document.getElementById("ddrInfoBlock").textContent = stringifyAny(rawAnalysis?.DDRInfo || "-");
  document.getElementById("cacheInfoBlock").textContent = stringifyAny(rawAnalysis?.test_CacheInfo || "-");
  document.getElementById("fuseInfoBlock").textContent = stringifyAny(rawAnalysis?.fusesInfo || "-");
}

// ---------------------------------------------------------------------------
// Peripheral Metrics — GT / Media / VPU / PCIe / Display (pons_verification.py)
// ---------------------------------------------------------------------------
function renderPeripheralMetrics() {
  const r = rawAnalysis || {};
  const CFI_HEADERS = ["Count","NAP","INT","PROTOCOL","PKT","DSTID","RSPID","OPCODE","Misc"];

  function fillInfoTable(bodyId, headId, rows, headers) {
    const body = document.getElementById(bodyId);
    const head = document.getElementById(headId);
    if (!body) return;
    if (head && headers) {
      head.innerHTML = headers.map(h => `<th style="white-space:nowrap;">${h}</th>`).join("");
    }
    if (!Array.isArray(rows) || !rows.length) {
      body.innerHTML = `<tr><td colspan="${(headers||[]).length || 4}" style="color:#6b7280;">No detail data</td></tr>`;
      return;
    }
    body.innerHTML = rows.map(row => {
      const cols = Array.isArray(row) ? row : String(row).split(",").map(s => s.trim());
      return `<tr>${cols.map((c, i) => i === 0
        ? `<td style="text-align:right;font-weight:600;">${c}</td>`
        : `<td style="white-space:nowrap;">${c}</td>`).join("")}</tr>`;
    }).join("");
  }

  const hasGT      = r.GT_total      != null;
  const hasMedia   = r.MEDIA_total   != null;
  const hasVPU     = r.VPU_total     != null;
  const hasPCIE    = r.PCIE_total    != null;
  const hasDisplay = r.DISPLAY_total != null;
  const hasAny     = hasGT || hasMedia || hasVPU || hasPCIE || hasDisplay;

  const noMsg = document.getElementById("peripheralNoDataMsg");
  if (noMsg) noMsg.style.display = hasAny ? "none" : "";

  // ── GT ──────────────────────────────────────────────────────────────────
  const gtSec = document.getElementById("gtSection");
  if (hasGT && gtSec) {
    gtSec.style.display = "";
    document.getElementById("gtTotal").textContent  = String(r.GT_total  ?? "-").trim() || "-";
    document.getElementById("gtRead").textContent   = String(r.GT_dataR  ?? "-").trim() || "-";
    document.getElementById("gtWrite").textContent  = String(r.GT_dataW  ?? "-").trim() || "-";

    // GT_memory: [[title, count], ...]
    const gtMem = r.GT_memory;
    const gtMemWrap = document.getElementById("gtMemoryWrap");
    const gtMemBody = document.getElementById("gtMemoryBody");
    if (Array.isArray(gtMem) && gtMem.length && gtMemBody) {
      if (gtMemWrap) gtMemWrap.style.display = "";
      gtMemBody.innerHTML = gtMem.map(item => {
        const row = Array.isArray(item) ? item : [item];
        return `<tr><td style="color:#93c5fd;">${row[0] ?? "-"}</td><td style="text-align:right;font-weight:600;">${String(row[1] ?? "-").trim()}</td></tr>`;
      }).join("");
    }

    const gtInfoWrap = document.getElementById("gtInfoWrap");
    if (Array.isArray(r.GT_info) && r.GT_info.length) {
      if (gtInfoWrap) gtInfoWrap.style.display = "";
      fillInfoTable("gtInfoBody", "gtInfoHead", r.GT_info, CFI_HEADERS);
    }
  } else if (gtSec) gtSec.style.display = "none";

  // ── Media ────────────────────────────────────────────────────────────────
  const mediaSec = document.getElementById("mediaSection");
  if (hasMedia && mediaSec) {
    mediaSec.style.display = "";
    document.getElementById("mediaTotal").textContent = String(r.MEDIA_total ?? "-").trim() || "-";
    document.getElementById("mediaRead").textContent  = String(r.MEDIA_dataR ?? "-").trim() || "-";
    document.getElementById("mediaWrite").textContent = String(r.MEDIA_dataW ?? "-").trim() || "-";
    const mediaInfoWrap = document.getElementById("mediaInfoWrap");
    if (Array.isArray(r.MEDIA_info) && r.MEDIA_info.length) {
      if (mediaInfoWrap) mediaInfoWrap.style.display = "";
      fillInfoTable("mediaInfoBody", "mediaInfoHead", r.MEDIA_info, CFI_HEADERS);
    }
  } else if (mediaSec) mediaSec.style.display = "none";

  // ── VPU ──────────────────────────────────────────────────────────────────
  const vpuSec = document.getElementById("vpuSection");
  if (hasVPU && vpuSec) {
    vpuSec.style.display = "";
    document.getElementById("vpuTotal").textContent = String(r.VPU_total ?? "-").trim() || "-";
    document.getElementById("vpuRead").textContent  = String(r.VPU_dataR ?? "-").trim() || "-";
    document.getElementById("vpuWrite").textContent = String(r.VPU_dataW ?? "-").trim() || "-";
    const vpuInfoWrap = document.getElementById("vpuInfoWrap");
    if (Array.isArray(r.VPU_info) && r.VPU_info.length) {
      if (vpuInfoWrap) vpuInfoWrap.style.display = "";
      fillInfoTable("vpuInfoBody", "vpuInfoHead", r.VPU_info, CFI_HEADERS);
    }
  } else if (vpuSec) vpuSec.style.display = "none";

  // ── PCIe ─────────────────────────────────────────────────────────────────
  const pcieSec = document.getElementById("pcieSection");
  if (hasPCIE && pcieSec) {
    pcieSec.style.display = "";
    document.getElementById("pcieTotal").textContent = String(r.PCIE_total ?? "-").trim() || "-";
    document.getElementById("pcieRead").textContent  = String(r.PCIE_dataR ?? "-").trim() || "-";
    document.getElementById("pcieWrite").textContent = String(r.PCIE_dataW ?? "-").trim() || "-";
    document.getElementById("pcdTotal").textContent  = String(r.pcd_pcie_xtor_total ?? "-").trim() || "-";
    document.getElementById("pcdRead").textContent   = String(r.pcd_pcie_xtor_dataR ?? "-").trim() || "-";
    document.getElementById("pcdWrite").textContent  = String(r.pcd_pcie_xtor_dataW ?? "-").trim() || "-";

    const PCIE_HDR = ["Count","Dir","Command","Len/Index"];
    const pcieInfoWrap = document.getElementById("pcieInfoWrap");
    if (Array.isArray(r.PCIE_info) && r.PCIE_info.length) {
      if (pcieInfoWrap) pcieInfoWrap.style.display = "";
      fillInfoTable("pcieInfoBody", null, r.PCIE_info, PCIE_HDR);
    }
    const pcdInfoWrap = document.getElementById("pcdInfoWrap");
    const pcdData = r.pcd_pcie_xtor_info || r.pch_pcie_xtor_info;
    if (Array.isArray(pcdData) && pcdData.length) {
      if (pcdInfoWrap) pcdInfoWrap.style.display = "";
      fillInfoTable("pcdInfoBody", null, pcdData, PCIE_HDR);
    }
  } else if (pcieSec) pcieSec.style.display = "none";

  // ── Display ───────────────────────────────────────────────────────────────
  const dispSec = document.getElementById("displaySection");
  if (hasDisplay && dispSec) {
    dispSec.style.display = "";
    document.getElementById("displayTotal").textContent = String(r.DISPLAY_total ?? "-").trim() || "-";
    document.getElementById("displayRead").textContent  = String(r.DISPLAY_dataR ?? "-").trim() || "-";
    document.getElementById("displayWrite").textContent = String(r.DISPLAY_dataW ?? "-").trim() || "-";
    const dispInfoWrap = document.getElementById("displayInfoWrap");
    if (Array.isArray(r.DISPLAY_info) && r.DISPLAY_info.length) {
      if (dispInfoWrap) dispInfoWrap.style.display = "";
      fillInfoTable("displayInfoBody", "displayInfoHead", r.DISPLAY_info, CFI_HEADERS);
    }
  } else if (dispSec) dispSec.style.display = "none";

  // ── Combined R vs W bar chart ─────────────────────────────────────────────
  const rwWrap = document.getElementById("peripheralRwChart");
  if (!document.getElementById("peripheralRwChartEl")) return;
  const labels = [], reads = [], writes = [];
  if (hasGT)      { labels.push("GT");      reads.push(Number(r.GT_dataR)??0);      writes.push(Number(r.GT_dataW)??0); }
  if (hasMedia)   { labels.push("Media");   reads.push(Number(r.MEDIA_dataR)??0);   writes.push(Number(r.MEDIA_dataW)??0); }
  if (hasVPU)     { labels.push("VPU");     reads.push(Number(r.VPU_dataR)??0);     writes.push(Number(r.VPU_dataW)??0); }
  if (hasPCIE)    { labels.push("PCIe");    reads.push(Number(r.PCIE_dataR)??0);    writes.push(Number(r.PCIE_dataW)??0); }
  if (hasDisplay) { labels.push("Display"); reads.push(Number(r.DISPLAY_dataR)??0); writes.push(Number(r.DISPLAY_dataW)??0); }

  if (labels.length && rwWrap) {
    rwWrap.style.display = "";
    Plotly.newPlot("peripheralRwChartEl", [
      { name: "Read",  x: labels, y: reads,  type: "bar", marker: { color: "#2563eb" } },
      { name: "Write", x: labels, y: writes, type: "bar", marker: { color: "#f59e0b" } }
    ], {
      barmode: "group",
      margin: { t: 20, r: 20, b: 50, l: 60 },
      xaxis: { title: "Peripheral" },
      yaxis: { title: "Transaction Count" },
      legend: { orientation: "h", y: 1.1 }
    }, { responsive: true });
  }
}

// ---------------------------------------------------------------------------
// DBP + Clock section (pons_verification.py / verification.py)
// ---------------------------------------------------------------------------
function renderDbpClockSection() {
  const r = rawAnalysis || {};

  function fillDbpTable(bodyId, data, chartId) {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="4" style="color:#6b7280;">No data</td></tr>`;
      return;
    }
    const labels = [], counts = [];
    body.innerHTML = rows.map(row => {
      const cols = String(row).split(",").map(s => s.trim());
      const cnt = parseInt(cols[0]);
      if (!isNaN(cnt) && cols[1]) { labels.push(cols[1]); counts.push(cnt); }
      return `<tr>${cols.map((c, i) => i === 0
        ? `<td style="text-align:right;font-weight:600;">${c}</td>`
        : `<td>${c}</td>`).join("")}</tr>`;
    }).join("");

    if (labels.length && document.getElementById(chartId)) {
      Plotly.newPlot(chartId, [{
        type: "bar",
        orientation: "h",
        x: counts.slice(0, 20).reverse(),
        y: labels.slice(0, 20).reverse(),
        marker: { color: "#6366f1" }
      }], {
        margin: { t: 10, r: 20, b: 30, l: 180 },
        xaxis: { title: "Count" }
      }, { responsive: true });
    }
  }

  fillDbpTable("dbpIdiBody", r.DBP_infoS, "dbpIdiChart");
  fillDbpTable("dbpSocBody", r.DBP_infoS_SOC, "dbpSocChart");

  // ── Clock ──────────────────────────────────────────────────────────────
  const clockBody = document.getElementById("clockBody");
  const clockRaw  = document.getElementById("clockRawBlock");
  const clockData = r.Clock;

  if (!clockBody) return;
  if (!Array.isArray(clockData) || !clockData.length) {
    clockBody.innerHTML = `<tr><td colspan="3" style="color:#6b7280;">No clock data</td></tr>`;
    if (clockRaw) clockRaw.textContent = "-";
    return;
  }

  const freqLabels = [], freqCounts = [];
  let rawLines = [];
  clockBody.innerHTML = "";

  clockData.forEach((group, idx) => {
    const entries = Array.isArray(group) ? group : [group];
    if (!entries.length) return;
    const freqKey = String(entries[0] ?? "").trim();
    if (freqKey) {
      freqLabels.push(freqKey.substring(0, 40));
      freqCounts.push(entries.length - 1);
    }
    entries.forEach((line, i) => {
      rawLines.push(String(line));
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="text-align:center;color:#6b7280;">${i === 0 ? idx + 1 : ""}</td>
        <td style="${i === 0 ? "font-weight:600;color:#93c5fd;" : "font-size:0.82rem;"}">${freqKey}</td>
        <td style="font-size:0.82rem;word-break:break-all;">${i > 0 ? String(line) : ""}</td>`;
      clockBody.appendChild(tr);
    });
  });

  if (clockRaw) clockRaw.textContent = rawLines.join("\n");

  if (freqLabels.length && document.getElementById("clockChart")) {
    Plotly.newPlot("clockChart", [{
      type: "bar",
      x: freqLabels,
      y: freqCounts,
      marker: { color: "#10b981" },
      text: freqCounts.map(String),
      textposition: "outside"
    }], {
      margin: { t: 20, r: 20, b: 80, l: 60 },
      xaxis: { title: "Frequency", tickangle: -30 },
      yaxis: { title: "# of Events" }
    }, { responsive: true });
  }
}

// ---------------------------------------------------------------------------
// CBO Tracker section (pons_verification.py)
// ---------------------------------------------------------------------------
function renderCboTrackerSection() {
  const cboData = rawAnalysis?.GetCbo_tracker;
  const wrap    = document.getElementById("cboTrackersWrap");
  const noData  = document.getElementById("cboNoDataMsg");
  const aggEl   = document.getElementById("cboAggChart");

  if (!wrap) return;

  const isEmpty = !cboData || typeof cboData !== "object" ||
    !Object.values(cboData).some(v => Array.isArray(v) && v.length);

  if (noData) noData.style.display = isEmpty ? "" : "none";
  if (isEmpty) {
    if (aggEl) Plotly.newPlot("cboAggChart", [], { margin: { t:10,r:10,b:10,l:10 } }, { responsive: true });
    return;
  }

  // Build aggregate: opcode → total count across all trackers
  const aggregate = {};
  const trackerNames = Object.keys(cboData);

  trackerNames.forEach(name => {
    const entries = cboData[name];
    if (!Array.isArray(entries)) return;
    entries.forEach(item => {
      const arr = Array.isArray(item) ? item : String(item).split(/\s+/);
      const cnt = parseInt(arr[0]);
      const op  = String(arr[1] || "").trim();
      if (!isNaN(cnt) && op) aggregate[op] = (aggregate[op] || 0) + cnt;
    });
  });

  // Aggregate bar chart
  const sortedOps = Object.entries(aggregate).sort((a, b) => b[1] - a[1]).slice(0, 30);
  if (sortedOps.length && aggEl) {
    Plotly.newPlot("cboAggChart", [{
      type: "bar",
      orientation: "h",
      x: sortedOps.map(e => e[1]).reverse(),
      y: sortedOps.map(e => e[0]).reverse(),
      marker: { color: "#f97316" }
    }], {
      margin: { t: 10, r: 30, b: 40, l: 160 },
      xaxis: { title: "Total Count (all trackers)" }
    }, { responsive: true });
  }

  // Per-tracker tables
  // Remove old tracker cards (keep noData msg)
  const existing = wrap.querySelectorAll(".cbo-tracker-card");
  existing.forEach(el => el.remove());

  trackerNames.forEach(name => {
    const entries = cboData[name];
    if (!Array.isArray(entries) || !entries.length) return;

    const card = document.createElement("div");
    card.className = "cbo-tracker-card table-card";
    card.style.cssText = "margin-top:12px;";
    card.innerHTML = `
      <div class="section-title" style="font-size:0.88rem;margin-bottom:6px;color:#f97316;">${name}</div>
      <div class="table-wrap" style="overflow-x:auto;">
        <table>
          <thead><tr><th>Count</th><th>Opcode</th></tr></thead>
          <tbody>
            ${entries.map(item => {
              const arr = Array.isArray(item) ? item : String(item).split(/\s+/);
              const cnt = arr[0] ?? "-";
              const op  = String(arr[1] || "").trim() || "-";
              return `<tr>
                <td style="text-align:right;font-weight:600;">${cnt}</td>
                <td style="color:#93c5fd;">${op}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
    wrap.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// Xmon + Latency section (pons_verification.py)
// ---------------------------------------------------------------------------
function renderXmonLatencySection() {
  // ── Xmon ────────────────────────────────────────────────────────────────
  const xmonRaw  = rawAnalysis?.xmon;
  const xmonBody = document.getElementById("xmonBody");
  const xmonNoData = document.getElementById("xmonNoData");

  const xmonHasData = Array.isArray(xmonRaw) && xmonRaw.length > 0;
  if (xmonNoData) xmonNoData.style.display = xmonHasData ? "none" : "";

  if (xmonBody) {
    if (xmonHasData) {
      const parsed = [];
      xmonRaw.forEach((line, idx) => {
        const s = String(line).trim();
        if (!s) return;
        // format: "value,address" or "address, value" — split on comma
        const parts = s.split(",").map(p => p.trim());
        const addr  = parts[0] || s;
        const val   = parts[1] || "-";
        parsed.push({ addr, val });
      });
      xmonBody.innerHTML = parsed.map((p, i) =>
        `<tr>
          <td style="text-align:center;color:#6b7280;">${i + 1}</td>
          <td style="font-family:monospace;color:#34d399;">${p.addr}</td>
          <td style="font-family:monospace;color:#60a5fa;text-align:right;">${p.val}</td>
        </tr>`).join("");

      // Bar chart if numeric values present
      const numParsed = parsed.filter(p => !isNaN(Number(p.val)));
      const fullPanel = document.getElementById("xmonFullChartPanel");
      if (numParsed.length >= 2) {
        if (fullPanel) fullPanel.style.display = "";
        if (document.getElementById("xmonFullChart")) {
          Plotly.newPlot("xmonFullChart", [{
            type: "bar",
            x: numParsed.map(p => p.addr),
            y: numParsed.map(p => Number(p.val)),
            marker: { color: "#22d3ee" },
            text: numParsed.map(p => p.val),
            textposition: "outside"
          }], {
            margin: { t: 20, r: 20, b: 100, l: 60 },
            xaxis: { title: "Register Address", tickangle: -35 },
            yaxis: { title: "Value" }
          }, { responsive: true });
        }
      }
    } else {
      xmonBody.innerHTML = "";
    }
  }

  // ── Latency ─────────────────────────────────────────────────────────────
  const LATENCY_LABELS = [
    "SOC_ICELAND_UNCORE_REQ_LAT MSC hit",
    "SOC_ICELAND_UNCORE_REQ_LAT MSC miss",
    "SOC_ICELAND_HBO_Latency MSC miss",
    "SOC_ICELAND_UNCORE_DATA_LAT MSC hit",
    "SOC_ICELAND_UNCORE_DATA_LAT MSC miss",
    "SOC_ICELAND_Total_Req_Lat MSC hit",
    "SOC_ICELAND_Total_Req_Lat MSC miss"
  ];

  const latRaw   = rawAnalysis?.latency;
  const latBody  = document.getElementById("latencyBody");
  const latNoData = document.getElementById("latencyNoData");

  const latHasData = Array.isArray(latRaw) && latRaw.some(v => v && String(v).trim() && String(v).trim() !== "no data");
  if (latNoData) latNoData.style.display = latHasData ? "none" : "";

  if (latBody) {
    if (latHasData) {
      const labels = [], values = [];
      latBody.innerHTML = latRaw.map((val, i) => {
        const label = LATENCY_LABELS[i] || `Latency metric ${i + 1}`;
        const v = String(val ?? "-").trim();
        const num = parseFloat(v);
        if (!isNaN(num)) { labels.push(label.split(" ").pop()); values.push(num); }
        return `<tr>
          <td style="color:#9ca3af;font-size:0.82rem;">${label}</td>
          <td style="font-family:monospace;color:#60a5fa;text-align:right;font-weight:600;">${v || "-"}</td>
        </tr>`;
      }).join("");

      // Latency chart
      const latChartWrap = document.getElementById("latencyChartWrap");
      if (values.length >= 2 && latChartWrap) {
        latChartWrap.style.display = "";
        Plotly.newPlot("latencyChartWrap", [{
          type: "bar",
          x: labels,
          y: values,
          marker: { color: "#a855f7" },
          text: values.map(String),
          textposition: "outside"
        }], {
          margin: { t: 20, r: 20, b: 80, l: 60 },
          xaxis: { title: "Metric", tickangle: -25 },
          yaxis: { title: "Avg Latency" }
        }, { responsive: true });
      }
    } else {
      latBody.innerHTML = "";
    }
  }
}

function renderDashboard() {
  appendLog("Rendering dashboard");
  updateMetaCards();
  updateRunSummary();
  updateMetricBlock("idi", _applyRange(idiGraphData), _applyRange(idiWriteData));
  updateMetricBlock("ddr", _applyRange(ddrGraphData), _applyRange(ddrWriteData));
  updateLoopInfoCards();
  renderIdiChart();
  renderDdrChart();
  renderLoopChart();
  renderLoopBwChart();
  renderLoopTable();
  renderIdiOpcodeSection();
  renderDdrSection();
  renderPlatformSection();
  renderScenarioSection();
  renderConfigSection();
  renderBWPreviewTables();
  renderDirTimeline();
  // pons_verification.py — additional sections
  renderPeripheralMetrics();
  renderDbpClockSection();
  renderCboTrackerSection();
  renderXmonLatencySection();
  appendLog("Dashboard render complete");
  _saveCache();   // persist so next refresh auto-restores
}

// ---------------------------------------------------------------------------
// Session cache  — save/restore data to localStorage so F5 re-renders instantly
// ---------------------------------------------------------------------------
const _CACHE_KEY = "ptp_dash_cache";

function _saveCache() {
  try {
    const payload = {
      ts:          Date.now(),
      rawAnalysis, idiGraphData, ddrGraphData, idiWriteData, ddrWriteData, loopRanges
    };
    localStorage.setItem(_CACHE_KEY, JSON.stringify(payload));
    _showCacheBanner(payload.ts, false);
  } catch (e) {
    console.warn("[cache] save failed:", e.message);
  }
}

function _clearCache() {
  localStorage.removeItem(_CACHE_KEY);
  _hideCacheBanner();
}

function _showCacheBanner(ts, fromRestore) {
  let banner = document.getElementById("cacheBanner");
  if (!banner) return;
  const ago = Math.round((Date.now() - ts) / 1000);
  const time = ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.round(ago/60)}m ago` : `${Math.round(ago/3600)}h ago`;
  banner.style.display = "flex";
  banner.innerHTML = `
    <span style="flex:1;font-size:0.78rem;">
      ${fromRestore ? "&#9889; Data auto-restored from cache" : "&#128190; Cached"} &mdash; saved ${time}
      <span style="color:#9ca3af;margin-left:6px;">(refreshing the page will restore this data automatically)</span>
    </span>
    <button onclick="_clearCache()" style="padding:2px 8px;font-size:0.75rem;background:#374151;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-left:8px;">
      Clear Cache &amp; Reload
    </button>`;
  if (fromRestore) {
    const rerender = document.createElement("button");
    rerender.textContent = "Re-render";
    rerender.title = "Re-run all rendering with current in-memory data (no SSH call)";
    rerender.style.cssText = "padding:2px 8px;font-size:0.75rem;background:#1d4ed8;color:#fff;border:none;border-radius:4px;cursor:pointer;margin-left:4px;";
    rerender.onclick = () => renderDashboard();
    banner.appendChild(rerender);
  }
}

function _hideCacheBanner() {
  const b = document.getElementById("cacheBanner");
  if (b) b.style.display = "none";
}

function _tryRestoreCache() {
  try {
    const raw = localStorage.getItem(_CACHE_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw);
    if (!p.rawAnalysis && !p.idiGraphData?.length) return false;
    rawAnalysis  = p.rawAnalysis  || null;
    idiGraphData = p.idiGraphData || [];
    ddrGraphData = p.ddrGraphData || [];
    idiWriteData = p.idiWriteData || [];
    ddrWriteData = p.ddrWriteData || [];
    loopRanges   = p.loopRanges   || [];
    // Restore run dir field
    const runDir = rawAnalysis?.run_info?.run_dir || "";
    const rdEl = document.getElementById("sshRunDir");
    if (rdEl && runDir) rdEl.value = runDir;
    renderDashboard();
    _showCacheBanner(p.ts, true);
    appendLog(`Cache restored (saved ${new Date(p.ts).toLocaleTimeString()})`);
    return true;
  } catch (e) {
    console.warn("[cache] restore failed:", e.message);
    localStorage.removeItem(_CACHE_KEY);
    return false;
  }
}

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = () => reject(new Error("Failed to read file: " + file.name));
    r.readAsText(file);
  });
}

async function loadSelectedDirectory() {
  clearLog();
  appendLog("Load Directory clicked");

  // Determine which loading path to use
  const useFSA = !!(dirHandle && window.showDirectoryPicker);

  if (!useFSA) {
    selectedFiles = Array.from(document.getElementById("runFolder").files || []);
    if (!selectedFiles.length) {
      setStatus("Please select a run directory or results directory.", true);
      return;
    }
  }

  setLoadButtonState(true);
  setProgress(5, "Starting…");

  try {
    let jsonText = null, idiText = null, ddrText = null;
    let idiName = null, ddrName = null, runName = "-";

    if (useFSA) {
      // ── Fast path: File System Access API ──────────────────────────────────
      appendLog("Using File System Access API — fetching targeted files only");
      setProgress(20, "Locating files…");

      const [jsonHandle, idiHandle, ddrHandle] = await Promise.all([
        dirHandle.getFileHandle("dashboard_data.json").catch(() => null),
        findFileInSubdir(dirHandle, "chainsaw_tmp",    "overall_bw_samples"),
        findFileInSubdir(dirHandle, "chainsaw_lpddr",  "overall_bw_samples")
      ]);

      setProgress(45, "Reading files…");
      const [jt, it, dt] = await Promise.all([
        jsonHandle ? readFileHandleAsText(jsonHandle) : Promise.resolve(null),
        idiHandle  ? readFileHandleAsText(idiHandle)  : Promise.resolve(null),
        ddrHandle  ? readFileHandleAsText(ddrHandle)  : Promise.resolve(null)
      ]);

      jsonText = jt; idiText = it; ddrText = dt;
      if (idiHandle) idiName = (await idiHandle.getFile()).name;
      if (ddrHandle) ddrName = (await ddrHandle.getFile()).name;
      runName = dirHandle.name;

    } else {
      // ── Legacy path: webkitdirectory input ─────────────────────────────────
      appendLog("Using legacy webkitdirectory input");
      setProgress(20, `Scanning ${selectedFiles.length} files…`);

      let jsonFile, idiFile, ddrFile;
      for (const f of selectedFiles) {
        if      (!jsonFile && f.name === "dashboard_data.json")                                                        { jsonFile = f; }
        else if (!idiFile  && f.name.includes("overall_bw_samples") && f.webkitRelativePath.includes("chainsaw_tmp")) { idiFile  = f; }
        else if (!ddrFile  && f.name.includes("overall_bw_samples") && f.webkitRelativePath.includes("chainsaw_lpddr")){ ddrFile  = f; }
        if (jsonFile && idiFile && ddrFile) break;
      }

      setProgress(45, "Reading files…");
      const [jt, it, dt] = await Promise.all([
        jsonFile ? readFileAsText(jsonFile) : Promise.resolve(null),
        idiFile  ? readFileAsText(idiFile)  : Promise.resolve(null),
        ddrFile  ? readFileAsText(ddrFile)  : Promise.resolve(null)
      ]);

      jsonText = jt; idiText = it; ddrText = dt;
      if (idiFile) idiName = idiFile.name;
      if (ddrFile) ddrName = ddrFile.name;
      runName = selectedFiles[0]?.webkitRelativePath?.split("/")[0] || "-";
    }

    setProgress(70, "Parsing data…");
    rawAnalysis = {};

    if (jsonText) {
      rawAnalysis = JSON.parse(jsonText);
      appendLog("dashboard_data.json parsed successfully");
    }

    if (idiText) {
      const idiBW = extractBWPairs(idiText);
      idiGraphData = idiBW.readData.length ? idiBW.readData : extractNumericPairs(idiText);
      idiWriteData = idiBW.writeData;
      rawAnalysis.graph1_file = idiName;
    } else {
      idiGraphData = [];
      idiWriteData = [];
    }

    if (ddrText) {
      const ddrBW = extractBWPairs(ddrText);
      ddrGraphData = ddrBW.readData.length ? ddrBW.readData : extractNumericPairs(ddrText);
      ddrWriteData = ddrBW.writeData;
      rawAnalysis.graph2_file = ddrName;
    } else {
      ddrGraphData = [];
      ddrWriteData = [];
    }

    loopRanges = normalizeLoopRanges(rawAnalysis);
    if (!rawAnalysis.run_info) rawAnalysis.run_info = {};
    if (!rawAnalysis.run_info.run_dir)  rawAnalysis.run_info.run_dir  = runName;
    if (!rawAnalysis.run_info.run_name) rawAnalysis.run_info.run_name = runName;
    if (!rawAnalysis.run_info.generated_at) rawAnalysis.run_info.generated_at = "-";
    loopRanges = _augmentLoopRanges(rawAnalysis, loopRanges);
    renderDashboard();
    setProgress(100, "Complete ✓");
    setStatus(`Directory loaded successfully.${useFSA ? " (File System Access)" : ` Files scanned: ${selectedFiles.length}`}`, false);
  } catch (e) {
    console.error(e);
    appendLog(`Load failed: ${e.message}`, "ERROR");
    setStatus(`Load failed:\n${e.message}`, true);
    hideProgress();
  } finally {
    setLoadButtonState(false);
  }
}

async function applyGraphFiles() {
  if (!rawAnalysis) {
    setStatus("Load a directory or demo first.", true);
    return;
  }

  try {
    const graph1File = document.getElementById("graph1File").files[0];
    const graph2File = document.getElementById("graph2File").files[0];

    if (graph1File) {
      const txt1 = await readFileAsText(graph1File);
      const bw1 = extractBWPairs(txt1);
      idiGraphData = bw1.readData.length ? bw1.readData : extractNumericPairs(txt1);
      idiWriteData = bw1.writeData;
      rawAnalysis.graph1_file = graph1File.name;
    }

    if (graph2File) {
      const txt2 = await readFileAsText(graph2File);
      const bw2 = extractBWPairs(txt2);
      ddrGraphData = bw2.readData.length ? bw2.readData : extractNumericPairs(txt2);
      ddrWriteData = bw2.writeData;
      rawAnalysis.graph2_file = graph2File.name;
    }

    _clearRangeFilter();
    renderDashboard();
    setStatus("Manual graph overrides applied successfully.");
  } catch (e) {
    setStatus(`Failed to apply graph overrides:\n${e.message}`, true);
  }
}

function _setGraphSshStatus(graph, msg, state) {
  const el = document.getElementById(`graph${graph}SshStatus`);
  if (!el) return;
  el.style.display = "inline-block";
  const s = { ok: { bg:"#dcfce7", color:"#166534" }, error: { bg:"#fef2f2", color:"#b91c1c" },
               loading: { bg:"#eff6ff", color:"#1d4ed8" } }[state] || { bg:"#f3f4f6", color:"#374151" };
  el.style.background = s.bg; el.style.color = s.color;
  el.textContent = msg;
}

async function applyGraphFilesSSH() {
  const p = sshParams();
  if (!p.host || !p.user) { setSshStatus("No SSH connection configured.", "error"); return; }

  const path1 = document.getElementById("graph1SshPath")?.value.trim();
  const path2 = document.getElementById("graph2SshPath")?.value.trim();
  if (!path1 && !path2) { setSshStatus("Enter at least one graph file path.", "error"); return; }

  let loaded = 0;
  if (path1) { await _loadGraphFileSSH(1, path1); loaded++; }
  if (path2) { await _loadGraphFileSSH(2, path2); loaded++; }
  if (loaded > 0) { _clearRangeFilter(); renderDashboard(); setStatus(`${loaded} graph override(s) loaded from SSH.`); }
}

async function _loadGraphFileSSH(graphNum, filePath) {
  const p = sshParams();
  _setGraphSshStatus(graphNum, "Loading\u2026", "loading");
  try {
    const res  = await fetch(`${SSH_BRIDGE}/api/read-file`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...p, path: filePath }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);
    const bwPairs = extractBWPairs(data.content);
    const pairs = bwPairs.readData.length ? bwPairs.readData : extractNumericPairs(data.content);
    if (!rawAnalysis) rawAnalysis = {};
    if (graphNum === 1) { idiGraphData = pairs; idiWriteData = bwPairs.writeData; rawAnalysis.graph1_file = filePath.split("/").pop(); }
    else               { ddrGraphData = pairs; ddrWriteData = bwPairs.writeData; rawAnalysis.graph2_file = filePath.split("/").pop(); }
    _setGraphSshStatus(graphNum, "\u2713 Loaded", "ok");
    _clearRangeFilter();
    renderDashboard();
    setStatus(`Graph ${graphNum} loaded from ${filePath.split("/").pop()}`);
  } catch (e) {
    _setGraphSshStatus(graphNum, `\u2717 ${e.message}`, "error");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSH Remote Load  (requires local bridge server: python tools/server.py)
// ─────────────────────────────────────────────────────────────────────────────

const SSH_BRIDGE = "http://127.0.0.1:5000";

function sshParams() {
  // Read from the inline Load Data panel fields
  const host = document.getElementById("loadSshHost")?.value.trim()     || "";
  const port = Number(document.getElementById("loadSshPort")?.value)    || 22;
  const user = document.getElementById("loadSshUser")?.value.trim()     || "";
  const key  = document.getElementById("loadSshKey")?.value.trim()      || "~/.ssh/id_ed25519";
  const pass = document.getElementById("loadSshPassword")?.value        || "";

  // Persist password to sessionStorage whenever it's read
  if (pass) sessionStorage.setItem("ptp_ssh_pass", pass);
  else sessionStorage.removeItem("ptp_ssh_pass");

  // If the form fields are empty, fall back to localStorage (set from index.html)
  if (!host && typeof connLoad === "function") {
    const saved = connLoad();
    if (saved && saved.host) {
      const savedPass = sessionStorage.getItem("ptp_ssh_pass") || "";
      const p = {
        host:     saved.host,
        port:     Number(saved.port) || 22,
        user:     saved.user     || "",
        key_path: saved.key_path || "~/.ssh/id_ed25519",
      };
      if (savedPass) p.password = savedPass;
      return p;
    }
  }

  const params = { host, port, user, key_path: key };
  if (pass) params.password = pass;
  return params;
}

// ── Remote directory browser ──────────────────────────────────────────────
// Shared by both the SSH panel and the station form.
// targetInputId  — the <input> whose value gets set when a folder is selected
// browserId      — the id of the browser panel div

let _dirBrowserState = {}; // keyed by browserId: { targetInputId, onSelect }

async function sshOpenDirBrowser(targetInputId, browserId, onSelectFn) {
  const p = _buildBrowseParams(browserId);
  if (!p.host || !p.user) {
    alert("Fill in Host and User before browsing.");
    return;
  }
  const startPath = document.getElementById(targetInputId)?.value.trim() || "~";
  document.getElementById(browserId).style.display = "";
  _dirBrowserState[browserId] = { targetInputId, onSelect: onSelectFn || null };
  await _dirBrowserLoad(browserId, startPath);
}

function sshCloseDirBrowser(browserId) {
  document.getElementById(browserId).style.display = "none";
  delete _dirBrowserState[browserId];
}

async function sshDirUp(targetInputId, browserId) {
  const pathEl = document.getElementById(browserId + "Path") ||
                 document.getElementById(browserId.replace("Browser","BrowserPath"));
  const current = pathEl?.textContent?.trim() || "~";
  const parent = current.includes("/") ? current.replace(/\/[^/]+\/?$/, "") || "/" : "~";
  await _dirBrowserLoad(browserId, parent);
}

async function _dirBrowserLoad(browserId, path) {
  const listEl    = document.getElementById(browserId + "List");
  const pathLabel = document.getElementById(browserId + "Path");
  if (!listEl) return;

  listEl.innerHTML = `<div style="color:#6b7280; padding:8px;">Loading…</div>`;
  if (pathLabel) pathLabel.textContent = path;

  const p = { ..._buildBrowseParams(browserId), path };

  try {
    const res  = await fetch(`${SSH_BRIDGE}/api/list-dir`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(p),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);

    if (pathLabel) pathLabel.textContent = data.path;

    if (!data.entries.length) {
      listEl.innerHTML = `<div style="color:#9ca3af; padding:8px; font-style:italic;">Empty directory</div>`;
      return;
    }

    listEl.innerHTML = "";
    // "Select this folder" row at the top
    const selectRow = document.createElement("div");
    selectRow.style.cssText = "padding:7px 10px; margin-bottom:6px; background:#eff6ff; border-radius:8px; display:flex; align-items:center; gap:8px; cursor:pointer;";
    selectRow.innerHTML = `<span style="color:#2563eb; font-weight:700; font-size:0.85rem;">&#10003; Select &ldquo;${escHtml(data.path)}&rdquo;</span>`;
    selectRow.addEventListener("click", () => {
      const state = _dirBrowserState[browserId];
      if (state?.targetInputId) document.getElementById(state.targetInputId).value = data.path;
      sshCloseDirBrowser(browserId);
      if (state?.onSelect) state.onSelect(data.path);
    });
    listEl.appendChild(selectRow);

    data.entries.forEach(entry => {
      const row = document.createElement("div");
      const isFile = !entry.is_dir;
      row.style.cssText = `padding:5px 10px; border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:8px; color:${entry.is_dir ? "#111827" : "#374151"};`;
      row.innerHTML = `<span>${entry.is_dir ? "&#128193;" : "&#128196;"}</span><span style="font-family:monospace; font-size:0.85rem;">${escHtml(entry.name)}</span>`;
      row.addEventListener("mouseover", () => row.style.background = entry.is_dir ? "#f1f5f9" : "#fef9c3");
      row.addEventListener("mouseout",  () => row.style.background = "");
      if (entry.is_dir) {
        row.addEventListener("click", () => _dirBrowserLoad(browserId, `${data.path}/${entry.name}`));
      } else {
        // File — select it directly and trigger callback
        row.addEventListener("click", () => {
          const filePath = `${data.path}/${entry.name}`;
          const state = _dirBrowserState[browserId];
          if (state?.targetInputId) document.getElementById(state.targetInputId).value = filePath;
          sshCloseDirBrowser(browserId);
          if (state?.onSelect) state.onSelect(filePath);
        });
      }
      listEl.appendChild(row);
    });
  } catch (e) {
    listEl.innerHTML = `<div style="color:#b91c1c; padding:8px;">&#10007; ${escHtml(e.message)}</div>`;
  }
}

function _buildBrowseParams(browserId) {
  // Graph file browsers and main SSH browser all use the Load Data panel credentials
  if (browserId === "sshDirBrowser" ||
      browserId === "graph1DirBrowser" ||
      browserId === "graph2DirBrowser") {
    return sshParams();
  }
  // Station form — reads its own inline fields
  const pass = document.getElementById("stationSshPassword")?.value || "";
  const params = {
    host:     document.getElementById("stationSshHost")?.value.trim()  || "",
    port:     Number(document.getElementById("stationSshPort")?.value) || 22,
    user:     document.getElementById("stationSshUser")?.value.trim()  || "",
    key_path: document.getElementById("stationSshKey")?.value.trim()   || "~/.ssh/id_ed25519",
  };
  if (pass) params.password = pass;
  return params;
}

function setSshStatus(message, state = "idle") {
  const el = document.getElementById("sshConnStatus");
  if (!el) return;
  el.style.display = "inline-block";
  const styles = {
    ok:      { bg: "#dcfce7", color: "#166534", border: "#86efac" },
    error:   { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
    loading: { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
    idle:    { bg: "#f3f4f6", color: "#374151", border: "#e5e7eb" },
  }[state] || {};
  el.style.background   = styles.bg    || "";
  el.style.color        = styles.color || "";
  el.style.border       = `1px solid ${styles.border || "#e5e7eb"}`;
  el.textContent = message;
}

function sshAppendRunLog(line) {
  const wrap = document.getElementById("sshRunLogWrap");
  const log  = document.getElementById("sshRunLog");
  if (wrap) wrap.style.display = "block";
  if (log) {
    if (log.textContent === "—") log.textContent = "";
    log.textContent += line + "\n";
    log.scrollTop = log.scrollHeight;
  }
}

function sshClearRunLog() {
  const log = document.getElementById("sshRunLog");
  if (log) log.textContent = "—";
  const wrap = document.getElementById("sshRunLogWrap");
  if (wrap) wrap.style.display = "none";
}

function _setBrowseEnabled(btnId, enabled) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? "1" : "0.45";
  btn.style.cursor  = enabled ? "pointer" : "not-allowed";
  btn.title = enabled ? "" : "Test connection first";
}

async function sshTestConnection() {
  const p = sshParams();
  if (!p.host || !p.user) { setSshStatus("Host and User are required.", "error"); return; }
  setSshStatus("Connecting\u2026", "loading");
  _setBrowseEnabled("sshBrowseBtn", false);
  try {
    let res;
    try {
      res = await fetch(`${SSH_BRIDGE}/api/connect-test`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(p),
      });
    } catch (_netErr) {
      throw new Error(`Bridge server unreachable at ${SSH_BRIDGE} — is server.py running?`);
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);
    setSshStatus(`\u2713  Connected \u2014 ${data.hostname} (${data.user})`, "ok");
    _setBrowseEnabled("sshBrowseBtn", true);
    // Save successful connection to localStorage so other pages can reuse it
    if (typeof connSave === "function") {
      connSave({ host: p.host, port: p.port, user: p.user, key_path: p.key_path });
    }
  } catch (e) {
    setSshStatus(`\u2717  ${e.message}`, "error");
    _setBrowseEnabled("sshBrowseBtn", false);
  }
}

async function stationTestConnection() {
  const p = _buildBrowseParams("stationDirBrowser");
  const statusEl = document.getElementById("stationConnStatus");
  _setBrowseEnabled("stationBrowseBtn", false);

  function setStationConnStatus(msg, state) {
    if (!statusEl) return;
    statusEl.style.display = "inline-block";
    const styles = {
      ok:      { bg: "#dcfce7", color: "#166534" },
      error:   { bg: "#fef2f2", color: "#b91c1c" },
      loading: { bg: "#eff6ff", color: "#1d4ed8" },
    }[state] || { bg: "#f3f4f6", color: "#374151" };
    statusEl.style.background = styles.bg;
    statusEl.style.color      = styles.color;
    statusEl.textContent = msg;
  }

  if (!p.host || !p.user) { setStationConnStatus("Host and User are required.", "error"); return; }
  setStationConnStatus("Connecting\u2026", "loading");
  try {
    let res;
    try {
      res = await fetch(`${SSH_BRIDGE}/api/connect-test`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(p),
      });
    } catch (_netErr) {
      throw new Error(`Bridge server unreachable at ${SSH_BRIDGE} — is server.py running?`);
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);
    setStationConnStatus(`\u2713  ${data.hostname} (${data.user})`, "ok");
    _setBrowseEnabled("stationBrowseBtn", true);
  } catch (e) {
    setStationConnStatus(`\u2717  ${e.message}`, "error");
    _setBrowseEnabled("stationBrowseBtn", false);
  }
}

async function loadOpcodes() {
  const runDir = document.getElementById("sshRunDir")?.value.trim();
  if (!runDir) { alert("Load a remote directory first."); return; }
  const btn    = document.getElementById("loadOpcodesBtn");
  const status = document.getElementById("opcodeLoadStatus");
  if (btn)    btn.disabled = true;
  if (status) status.textContent = "Loading\u2026 (may take 1\u20132 min)";

  try {
    const payload = { ...sshParams(), run_dir: runDir };
    const res = await fetch("/api/load-opcodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    let data;
    try {
      data = await res.json();
    } catch (_) {
      if (status) status.textContent = "\u26a0 Server returned empty response — tracker read timed out. Try running Verification Script instead.";
      return;
    }

    if (!res.ok) throw new Error(data?.detail || res.statusText);

    if (data._warning) {
      if (status) status.textContent = "\u26a0 " + data._warning;
    } else {
      if (!rawAnalysis) rawAnalysis = {};
      if (data.opcodes)         rawAnalysis.opcodes         = data.opcodes;
      if (data.DDR_info)        rawAnalysis.DDR_info         = data.DDR_info;
      if (data.DDR_infoW)       rawAnalysis.DDR_infoW        = data.DDR_infoW;
      if (data.DDR_infoS)       rawAnalysis.DDR_infoS        = data.DDR_infoS;
      if (data.opcodes_soc_cfi) rawAnalysis.opcodes_soc_cfi  = data.opcodes_soc_cfi;
      renderIdiOpcodeSection();
      renderDdrSection();
      const cnt = (data.opcodes || []).length;
      const src = data._source === "backup_json"    ? " (from verification backup JSON)"
                : data._source === "xlsx"           ? " (from verification xlsx)"
                : data._source === "dashboard_json" ? " (from dashboard_data.json)"
                : data._source === "tracker_sample" ? " (sampled from tracker files)"
                : "";
      if (status) status.textContent = cnt > 0 ? `\u2713 ${cnt} opcodes loaded${src}` : `No opcodes found${src}`;
    }
  } catch (err) {
    if (status) status.textContent = "Error: " + err.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function sshLoadFiles() {
  const runDir = document.getElementById("sshRunDir")?.value.trim();
  if (!runDir) { setSshStatus("Remote run directory is required.", "error"); return; }
  const payload = { ...sshParams(), run_dir: runDir };
  setSshStatus("Fetching files…", "loading");
  setProgress(10, "SSH: connecting…");
  setLoadButtonState(true);
  try {
    const res  = await fetch(`${SSH_BRIDGE}/api/load-files`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);

    setProgress(60, "SSH: parsing data…");
    rawAnalysis  = data.json_text ? JSON.parse(data.json_text) : {};
    if (data.idi_text) { const b = extractBWPairs(data.idi_text); idiGraphData = b.readData.length ? b.readData : extractNumericPairs(data.idi_text); idiWriteData = b.writeData; } else { idiGraphData = []; idiWriteData = []; }
    if (data.ddr_text) { const b = extractBWPairs(data.ddr_text); ddrGraphData = b.readData.length ? b.readData : extractNumericPairs(data.ddr_text); ddrWriteData = b.writeData; } else { ddrGraphData = []; ddrWriteData = []; }
    if (data.idi_file) rawAnalysis.graph1_file = data.idi_file;
    if (data.ddr_file) rawAnalysis.graph2_file = data.ddr_file;
    applyDirTimes(data.dir_times, data.ls_output);
    if (!rawAnalysis.run_info) rawAnalysis.run_info = {};
    if (!rawAnalysis.run_info.run_dir)  rawAnalysis.run_info.run_dir  = runDir;
    if (!rawAnalysis.run_info.run_name) rawAnalysis.run_info.run_name = runDir.split("/").pop();
    if (!rawAnalysis.run_info.generated_at) rawAnalysis.run_info.generated_at = "-";
    loopRanges = _augmentLoopRanges(rawAnalysis, normalizeLoopRanges(rawAnalysis));
    setProgress(90, "SSH: rendering…");
    renderDashboard();
    setProgress(100, "Complete ✓");
    setSshStatus("✓  Files loaded successfully", "ok");
    setStatus(`Loaded from ${payload.host}:${runDir} via SSH`, false);
  } catch (e) {
    setSshStatus(`✗  ${e.message}`, "error");
    setStatus(`SSH load failed: ${e.message}`, true);
    hideProgress();
  } finally {
    setLoadButtonState(false);
  }
}

async function sshRunAndLoad() {
  const runDir    = document.getElementById("sshRunDir")?.value.trim();
  const vpyRel    = document.getElementById("sshVpyPath")?.value.trim()   || "verification.py";
  const pythonBin = document.getElementById("sshPythonBin")?.value.trim() || "";
  if (!runDir) { setSshStatus("Remote run directory is required.", "error"); return; }

  sshClearRunLog();
  const payload = { ...sshParams(), run_dir: runDir, verification_py: vpyRel, python_bin: pythonBin };
  setSshStatus("Starting verification.py…", "loading");
  setProgress(5, "SSH: launching verification.py…");
  setLoadButtonState(true);

  try {
    const res = await fetch(`${SSH_BRIDGE}/api/run-verification`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }

    // Stream SSE events
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop(); // keep incomplete last chunk

      for (const block of events) {
        const dataLine = block.split("\n").find(l => l.startsWith("data: "));
        if (!dataLine) continue;
        try {
          const evt = JSON.parse(dataLine.slice(6));
          if (evt.type === "start") {
            sshAppendRunLog(`$ ${evt.cmd}`);
            setProgress(15, "SSH: verification.py running…");
          } else if (evt.type === "stdout") {
            sshAppendRunLog(evt.line);
          } else if (evt.type === "stderr") {
            sshAppendRunLog(`[ERR] ${evt.line}`);
          } else if (evt.type === "done") {
            if (evt.rc === 0) {
              sshAppendRunLog("\n✓ verification.py finished (rc=0). Loading results…");
              setProgress(75, "SSH: loading output files…");
              setSshStatus("verification.py done — loading files…", "loading");
              // Now pull the freshly generated output
              await sshLoadFiles();
            } else {
              throw new Error(`verification.py exited with rc=${evt.rc}`);
            }
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        } catch (parseErr) { /* malformed SSE line — skip */ }
      }
    }
  } catch (e) {
    sshAppendRunLog(`\n✗ Error: ${e.message}`);
    setSshStatus(`✗  ${e.message}`, "error");
    setStatus(`SSH run failed: ${e.message}`, true);
    hideProgress();
    setLoadButtonState(false);
  }
}

// Toggle chevron icon when SSH panel opens/closes
document.addEventListener("DOMContentLoaded", () => {
  const details = document.getElementById("sshPanelDetails");
  const icon    = document.getElementById("sshPanelToggleIcon");
  if (details && icon) {
    details.addEventListener("toggle", () => {
      icon.innerHTML = details.open ? "&#9660;" : "&#9654;";
    });
  }
});

function loadDemoData() {
  clearLog();
  rawAnalysis = JSON.parse(JSON.stringify(demoData));
  idiGraphData = JSON.parse(JSON.stringify(demoIdi));
  idiWriteData = JSON.parse(JSON.stringify(demoIdiWrite));
  ddrGraphData = JSON.parse(JSON.stringify(demoDdr));
  ddrWriteData = JSON.parse(JSON.stringify(demoDdrWrite));
  loopRanges = _augmentLoopRanges(rawAnalysis, normalizeLoopRanges(rawAnalysis));
  rawAnalysis.graph1_file = "output.overall_bw_samples.txt";
  rawAnalysis.graph2_file = "output.overall_bw_samples.txt";
  renderDashboard();
  setStatus("Demo data loaded successfully.");
}

function clearDashboard() {
  rawAnalysis = null;
  idiGraphData = [];
  ddrGraphData = [];
  idiWriteData = [];
  ddrWriteData = [];
  loopRanges = [];
  selectedFiles = [];
  operationLogs = [];
  dirHandle = null;
  _clearCache();
  location.reload();
}

// Detect File System Access API support on load.
// If supported, show the fast-path picker and hide the legacy file input.
document.addEventListener("DOMContentLoaded", () => {
  if (window.showDirectoryPicker) {
    const fsaRow    = document.getElementById("fsaPickerRow");
    const legacyRow = document.getElementById("legacyInputRow");
    if (fsaRow)    fsaRow.style.display    = "block";
    if (legacyRow) legacyRow.style.display = "none";
  }
  // Auto-restore cached data so JS/CSS changes are visible after F5 without reloading SSH data
  _tryRestoreCache();
});

// ─────────────────────────────────────────────────────────────────────────────
// Stations Manager
// Stations are persisted in localStorage under "ptp_stations".
// Each station: { id, name, source: "local"|"ssh"|"demo", config: {...} }
// ─────────────────────────────────────────────────────────────────────────────

const STATIONS_KEY = "ptp_stations";
let   stationEditId = null;        // non-null while editing an existing station
let   stationCurrentSrc = "local"; // active source tab in the form

function stationsLoad() {
  try { return JSON.parse(localStorage.getItem(STATIONS_KEY) || "[]"); }
  catch { return []; }
}

function stationsSave(list) {
  localStorage.setItem(STATIONS_KEY, JSON.stringify(list));
}

function stationSourceLabel(station) {
  if (station.source === "ssh")  return `SSH — ${station.config.host || "?"}:${station.config.runDir || "?"}`;
  if (station.source === "demo") return "Demo data";
  return station.config.path ? `Local — ${station.config.path}` : "Local folder";
}

function stationSourceIcon(src) {
  return { local: "&#128193;", ssh: "&#128279;", demo: "&#9654;" }[src] || "";
}

// ── Rendering ─────────────────────────────────────────────────────────────

function stationRenderList() {
  const list    = stationsLoad();
  const wrap    = document.getElementById("stationList");
  const empty   = document.getElementById("stationListEmpty");
  if (!wrap) return;

  wrap.innerHTML = "";
  if (!list.length) {
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  list.forEach(st => {
    const card = document.createElement("div");
    card.className = "station-card";
    card.id = `stationCard_${st.id}`;

    const sshExtra = st.source === "ssh"
      ? `<button class="btn-secondary" style="font-size:0.8rem; padding:5px 12px;" onclick="stationRunAndLoad('${st.id}')">&#9654;&nbsp;Run + Load</button>`
      : "";

    card.innerHTML = `
      <div class="station-card-info">
        <div class="station-card-name">${stationSourceIcon(st.source)}&nbsp; ${escHtml(st.name)}</div>
        <div class="station-card-meta">${escHtml(stationSourceLabel(st))}</div>
      </div>
      <span class="station-card-status station-status-idle" id="stationStatus_${st.id}">Idle</span>
      <div class="station-card-actions">
        <button class="btn-primary"   style="font-size:0.8rem; padding:5px 12px;" onclick="stationLoadData('${st.id}')">&#8659;&nbsp; Load</button>
        ${sshExtra}
        <button class="btn-secondary" style="font-size:0.8rem; padding:5px 12px;" onclick="stationEdit('${st.id}')">Edit</button>
        <button class="btn-secondary" style="font-size:0.8rem; padding:5px 12px; color:#b91c1c; border-color:#fecaca;" onclick="stationDelete('${st.id}')">&#x2715;</button>
      </div>
    `;
    wrap.appendChild(card);
  });
}

function stationSetStatus(id, text, state) {
  const el = document.getElementById(`stationStatus_${id}`);
  if (!el) return;
  el.textContent = text;
  el.className = `station-card-status station-status-${state}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Form helpers ──────────────────────────────────────────────────────────

function stationSelectSource(src) {
  stationCurrentSrc = src;
  document.querySelectorAll(".station-src-btn").forEach(btn => {
    btn.classList.toggle("station-src-active", btn.dataset.src === src);
  });
  document.getElementById("stationSrcLocal").style.display = src === "local" ? "" : "none";
  document.getElementById("stationSrcSsh").style.display   = src === "ssh"   ? "" : "none";
  document.getElementById("stationSrcDemo").style.display  = src === "demo"  ? "" : "none";
}

function stationOpenAddForm() {
  stationEditId = null;
  document.getElementById("stationFormTitle").textContent = "Add Station";
  document.getElementById("stationName").value         = "";
  document.getElementById("stationLocalPath").value    = "";
  document.getElementById("stationSshHost").value      = "";
  document.getElementById("stationSshPort").value      = "22";
  document.getElementById("stationSshUser").value      = "";
  document.getElementById("stationSshKey").value       = "~/.ssh/id_rsa";
  document.getElementById("stationSshRunDir").value    = "";
  document.getElementById("stationSshVpy").value       = "verification.py";
  stationSelectSource("local");
  document.getElementById("stationFormWrap").style.display = "";
  document.getElementById("stationName").focus();
}

function stationEdit(id) {
  const list = stationsLoad();
  const st   = list.find(s => s.id === id);
  if (!st) return;
  stationEditId = id;

  document.getElementById("stationFormTitle").textContent = "Edit Station";
  document.getElementById("stationName").value = st.name;

  if (st.source === "local") {
    document.getElementById("stationLocalPath").value = st.config.path || "";
  } else if (st.source === "ssh") {
    document.getElementById("stationSshHost").value   = st.config.host   || "";
    document.getElementById("stationSshPort").value   = st.config.port   || 22;
    document.getElementById("stationSshUser").value   = st.config.user   || "";
    document.getElementById("stationSshKey").value    = st.config.keyPath || "~/.ssh/id_ed25519";
    document.getElementById("stationSshRunDir").value = st.config.runDir || "";
    document.getElementById("stationSshVpy").value    = st.config.vpyPath || "verification.py";
  }

  stationSelectSource(st.source);
  document.getElementById("stationFormWrap").style.display = "";
  document.getElementById("stationName").focus();
}

function stationCancelForm() {
  stationEditId = null;
  document.getElementById("stationFormWrap").style.display = "none";
}

function stationSaveForm() {
  const name = document.getElementById("stationName").value.trim();
  if (!name) { alert("Please enter a station name."); return; }

  let config = {};
  if (stationCurrentSrc === "local") {
    config.path = document.getElementById("stationLocalPath").value.trim();
  } else if (stationCurrentSrc === "ssh") {
    const host = document.getElementById("stationSshHost").value.trim();
    if (!host) { alert("SSH host is required."); return; }
    config = {
      host:    host,
      port:    Number(document.getElementById("stationSshPort").value) || 22,
      user:    document.getElementById("stationSshUser").value.trim(),
      keyPath: document.getElementById("stationSshKey").value.trim() || "~/.ssh/id_ed25519",
      runDir:  document.getElementById("stationSshRunDir").value.trim(),
      vpyPath: document.getElementById("stationSshVpy").value.trim()  || "verification.py",
    };
  }

  const list = stationsLoad();
  if (stationEditId) {
    const idx = list.findIndex(s => s.id === stationEditId);
    if (idx !== -1) { list[idx] = { ...list[idx], name, source: stationCurrentSrc, config }; }
  } else {
    list.push({ id: `st_${Date.now()}`, name, source: stationCurrentSrc, config });
  }
  stationsSave(list);
  stationEditId = null;
  document.getElementById("stationFormWrap").style.display = "none";
  stationRenderList();
}

function stationDelete(id) {
  const list    = stationsLoad();
  const station = list.find(s => s.id === id);
  if (!station) return;
  if (!confirm(`Remove station "${station.name}"?`)) return;
  stationsSave(list.filter(s => s.id !== id));
  stationRenderList();
}

// ── Data loading per station ──────────────────────────────────────────────

async function stationLoadData(id) {
  const list = stationsLoad();
  const st   = list.find(s => s.id === id);
  if (!st) return;

  stationSetStatus(id, "Loading…", "loading");
  appendLog(`[Station: ${st.name}] Loading via ${st.source}`);

  try {
    if (st.source === "demo") {
      loadDemoData();
      stationSetStatus(id, "Loaded ✓", "ok");
      return;
    }

    if (st.source === "local") {
      // Use the FSA picker (or legacy fallback); fill the directory label if we have a path hint
      if (st.config.path) {
        const lbl = document.getElementById("dirPickerLabel");
        if (lbl) lbl.textContent = st.config.path;
      }
      await pickDirectory();
      if (dirHandle) {
        await loadSelectedDirectory();
        stationSetStatus(id, "Loaded ✓", "ok");
      } else {
        stationSetStatus(id, "Cancelled", "idle");
      }
      return;
    }

    if (st.source === "ssh") {
      if (!st.config.runDir) { throw new Error("Remote run directory not configured."); }
      const payload = {
        host:     st.config.host,
        port:     st.config.port || 22,
        user:     st.config.user,
        key_path: st.config.keyPath || "~/.ssh/id_ed25519",
        run_dir:  st.config.runDir,
      };
      setLoadButtonState(true);
      setProgress(10, `Station [${st.name}]: connecting…`);
      const res  = await fetch(`${SSH_BRIDGE}/api/load-files`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || res.statusText);

      setProgress(70, `Station [${st.name}]: parsing…`);
      rawAnalysis  = data.json_text ? JSON.parse(data.json_text) : {};
      if (data.idi_text) { const b = extractBWPairs(data.idi_text); idiGraphData = b.readData.length ? b.readData : extractNumericPairs(data.idi_text); idiWriteData = b.writeData; } else { idiGraphData = []; idiWriteData = []; }
      if (data.ddr_text) { const b = extractBWPairs(data.ddr_text); ddrGraphData = b.readData.length ? b.readData : extractNumericPairs(data.ddr_text); ddrWriteData = b.writeData; } else { ddrGraphData = []; ddrWriteData = []; }
      if (data.idi_file) rawAnalysis.graph1_file = data.idi_file;
      if (data.ddr_file) rawAnalysis.graph2_file = data.ddr_file;
      applyDirTimes(data.dir_times, data.ls_output);
      if (!rawAnalysis.run_info) {
        rawAnalysis.run_info = {
          run_dir:      st.config.runDir,
          run_name:     st.config.runDir.split("/").pop(),
          generated_at: "-",
        };
      }
      loopRanges = _augmentLoopRanges(rawAnalysis, normalizeLoopRanges(rawAnalysis));
      setProgress(95, "Rendering…");
      renderDashboard();
      setProgress(100, "Complete ✓");
      setStatus(`Loaded from station "${st.name}" (${st.config.host}:${st.config.runDir})`);
      stationSetStatus(id, "Loaded ✓", "ok");
      return;
    }
  } catch (e) {
    stationSetStatus(id, "Error", "error");
    setStatus(`Station "${st.name}" load failed: ${e.message}`, true);
    appendLog(`[Station: ${st.name}] Error: ${e.message}`, "ERROR");
  } finally {
    setLoadButtonState(false);
  }
}

async function stationRunAndLoad(id) {
  const list = stationsLoad();
  const st   = list.find(s => s.id === id);
  if (!st || st.source !== "ssh") return;
  if (!st.config.runDir) { alert("Remote run directory not configured."); return; }

  stationSetStatus(id, "Running…", "loading");
  appendLog(`[Station: ${st.name}] Run + Load via SSH`);

  const payload = {
    host:            st.config.host,
    port:            st.config.port || 22,
    user:            st.config.user,
    key_path:        st.config.keyPath || "~/.ssh/id_ed25519",
    run_dir:         st.config.runDir,
    verification_py: st.config.vpyPath || "verification.py",
  };

  setLoadButtonState(true);
  setProgress(5, `Station [${st.name}]: launching verification.py…`);

  try {
    const res = await fetch(`${SSH_BRIDGE}/api/run-verification`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop();
      for (const block of events) {
        const dataLine = block.split("\n").find(l => l.startsWith("data: "));
        if (!dataLine) continue;
        try {
          const evt = JSON.parse(dataLine.slice(6));
          if (evt.type === "done") {
            if (evt.rc === 0) {
              setProgress(75, `Station [${st.name}]: loading output…`);
              await stationLoadData(id);
            } else {
              throw new Error(`verification.py exited with rc=${evt.rc}`);
            }
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        } catch { /* skip malformed events */ }
      }
    }
  } catch (e) {
    stationSetStatus(id, "Error", "error");
    setStatus(`Station "${st.name}" run failed: ${e.message}`, true);
    appendLog(`[Station: ${st.name}] Error: ${e.message}`, "ERROR");
    hideProgress();
  } finally {
    setLoadButtonState(false);
  }
}

// Render station list on initial page load
document.addEventListener("DOMContentLoaded", stationRenderList);
