let rawAnalysis = null;
let idiGraphData = [];
let ddrGraphData = [];
let loopRanges = [];
let selectedFiles = [];
let operationLogs = [];

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

const demoDdr = [
  { x: 0, y: 120 }, { x: 1, y: 128 }, { x: 2, y: 133 }, { x: 3, y: 129 }, { x: 4, y: 140 },
  { x: 5, y: 145 }, { x: 6, y: 141 }, { x: 7, y: 150 }, { x: 8, y: 144 }, { x: 9, y: 139 }
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

function setLoadButtonState(isLoading) {
  const btn = document.getElementById("loadDirBtn");
  if (!btn) return;
  btn.disabled = isLoading;
  if (isLoading) {
    btn.classList.add("btn-disabled");
    btn.textContent = "Loading...";
  } else {
    btn.classList.remove("btn-disabled");
    btn.textContent = "Load Directory";
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

function updateMetricBlock(prefix, data) {
  const ys = data.map(d => d.y);
  const xs = data.map(d => d.x);

  document.getElementById(prefix + "Samples").textContent = data.length || "-";
  document.getElementById(prefix + "Start").textContent = xs.length ? xs[0] : "-";
  document.getElementById(prefix + "End").textContent = xs.length ? xs[xs.length - 1] : "-";
  document.getElementById(prefix + "Avg").textContent = avg(ys) !== null ? avg(ys).toFixed(2) : "-";
  document.getElementById(prefix + "Max").textContent = maxVal(ys) !== null ? maxVal(ys).toFixed(2) : "-";
  document.getElementById(prefix + "Min").textContent = minVal(ys) !== null ? minVal(ys).toFixed(2) : "-";
}

function updateLoopInfoCards() {
  const sorted = [...loopRanges].sort((a, b) => a.start - b.start);
  const durations = sorted.map(r => r.end - r.start);

  document.getElementById("loopInfoCount").textContent = sorted.length || "-";
  document.getElementById("loopInfoFirstStart").textContent = sorted.length ? sorted[0].start : "-";
  document.getElementById("loopInfoLastEnd").textContent = sorted.length ? sorted[sorted.length - 1].end : "-";
  document.getElementById("loopInfoAvgDuration").textContent = durations.length ? avg(durations).toFixed(2) : "-";
  document.getElementById("loopInfoMaxDuration").textContent = durations.length ? maxVal(durations).toFixed(2) : "-";
  document.getElementById("loopInfoMinDuration").textContent = durations.length ? minVal(durations).toFixed(2) : "-";
  document.getElementById("loopDebugBlock").textContent = rawAnalysis ? JSON.stringify({
    idi_loops: rawAnalysis?.idi_loops ?? null,
    rangeLoops: rawAnalysis?.rangeLoops ?? null,
    loop_ranges: rawAnalysis?.loop_ranges ?? null,
    loops: rawAnalysis?.loops ?? null,
    Loops: rawAnalysis?.Loops ?? null,
    StarttimeStamp: rawAnalysis?.StarttimeStamp ?? null,
    endtimeStamp: rawAnalysis?.endtimeStamp ?? null
  }, null, 2) : "-";
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
  document.getElementById("testEndId").textContent = rawAnalysis?.testEnd ?? "-";
  document.getElementById("testStartDdr").textContent = rawAnalysis?.testStartDDR ?? "-";
  document.getElementById("testEndDdr").textContent = rawAnalysis?.testEndDDR ?? "-";
  document.getElementById("threadsValue").textContent = rawAnalysis?.Threads ?? rawAnalysis?.platform?.threads?.length ?? "-";
  document.getElementById("coresValue").textContent = rawAnalysis?.Cores ?? "-";
  document.getElementById("cmdLineBlock").textContent = stringifyAny(rawAnalysis?.test_cmd_line || "-");
  document.getElementById("runModelBlock").textContent = stringifyAny(rawAnalysis?.kind_model || "-");
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

function renderIdiChart() {
  const traces = idiGraphData.length ? [{
    x: idiGraphData.map(d => d.x),
    y: idiGraphData.map(d => d.y),
    mode: "lines+markers",
    name: "IDI BW",
    line: { color: "#2563eb", width: 3 },
    marker: { size: 5 }
  }] : [];

  Plotly.newPlot("idiChart", traces, {
    margin: { t: 20, r: 20, b: 50, l: 60 },
    xaxis: { title: "Time" },
    yaxis: { title: "IDI BW" },
    shapes: [...buildLoopShapes(), ...buildLoopBoundaryLines()]
  }, { responsive: true });
}

function renderDdrChart() {
  const traces = ddrGraphData.length ? [{
    x: ddrGraphData.map(d => d.x),
    y: ddrGraphData.map(d => d.y),
    mode: "lines+markers",
    name: "DDR BW",
    line: { color: "#7c3aed", width: 3 },
    marker: { size: 5 }
  }] : [];

  Plotly.newPlot("ddrChart", traces, {
    margin: { t: 20, r: 20, b: 50, l: 60 },
    xaxis: { title: "Time" },
    yaxis: { title: "DDR BW" },
    shapes: [...buildLoopShapes(), ...buildLoopBoundaryLines()]
  }, { responsive: true });
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
  updateMetricBlock("idi", getVisibleData(idiGraphData, start, end));
  updateMetricBlock("ddr", getVisibleData(ddrGraphData, start, end));
}

function renderLoopTable() {
  const body = document.getElementById("loopTableBody");
  body.innerHTML = "";
  const sorted = [...loopRanges].sort((a, b) => a.start - b.start);

  sorted.forEach((r, idx) => {
    const duration = r.end - r.start;
    const tr = document.createElement("tr");
    tr.className = "clickable";
    tr.innerHTML = `<td>${r.loop ?? (idx + 1)}</td><td>${r.start}</td><td>${r.end}</td><td>${duration.toFixed(2)}</td>`;
    tr.addEventListener("click", () => zoomChartsToRange(r.start, r.end));
    body.appendChild(tr);
  });
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

function renderIdiOpcodeSection() {
  const pairs = toPairs(rawAnalysis?.opcodes || {});
  renderKeyValueTable("idiOpcodeBody", pairs);
  const top = pairs.slice(0, 20);
  const trace = top.length ? [{
    type: "bar",
    x: top.map(x => x.key),
    y: top.map(x => Number(x.value) || 0),
    marker: { color: "#2563eb" }
  }] : [];

  Plotly.newPlot("idiOpcodeChart", trace, {
    margin: { t: 20, r: 20, b: 80, l: 50 },
    xaxis: { title: "Opcode", tickangle: -30 },
    yaxis: { title: "Value" }
  }, { responsive: true });
}

function renderDdrSection() {
  document.getElementById("ddrReadCount").textContent = rawAnalysis?.DDR_info ?? "-";
  document.getElementById("ddrWriteCount").textContent = rawAnalysis?.DDR_infoW ?? "-";

  const pairs = toPairs(rawAnalysis?.DDR_infoS || {});
  renderKeyValueTable("ddrOpcodeBody", pairs);

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

  const memBody = document.getElementById("memoryJsonBody");
  memBody.innerHTML = "";
  const memory = rawAnalysis?.scenario?.memory_json || [];
  memory.forEach((m, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${idx + 1}</td><td>${stringifyAny(m)}</td>`;
    memBody.appendChild(tr);
  });
}

function renderConfigSection() {
  document.getElementById("biosInfoBlock").textContent = stringifyAny(rawAnalysis?.BiosInfo || "-");
  document.getElementById("ddrInfoBlock").textContent = stringifyAny(rawAnalysis?.DDRInfo || "-");
  document.getElementById("cacheInfoBlock").textContent = stringifyAny(rawAnalysis?.test_CacheInfo || "-");
  document.getElementById("fuseInfoBlock").textContent = stringifyAny(rawAnalysis?.fusesInfo || "-");
}

function renderDashboard() {
  appendLog("Rendering dashboard");
  updateMetaCards();
  updateRunSummary();
  updateMetricBlock("idi", idiGraphData);
  updateMetricBlock("ddr", ddrGraphData);
  updateLoopInfoCards();
  renderIdiChart();
  renderDdrChart();
  renderLoopChart();
  renderLoopTable();
  renderIdiOpcodeSection();
  renderDdrSection();
  renderPlatformSection();
  renderScenarioSection();
  renderConfigSection();
  appendLog("Dashboard render complete");
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
  selectedFiles = Array.from(document.getElementById("runFolder").files || []);
  clearLog();
  appendLog("Load Directory clicked");

  if (!selectedFiles.length) {
    setStatus("Please select a run directory or results directory.", true);
    return;
  }

  setLoadButtonState(true);

  try {
    const jsonFile = selectedFiles.find(f => f.name === "dashboard_data.json");
    const idiFile = selectedFiles.find(f => f.name.includes("overall_bw_samples") && f.webkitRelativePath.includes("chainsaw_tmp"));
    const ddrFile = selectedFiles.find(f => f.name.includes("overall_bw_samples") && f.webkitRelativePath.includes("chainsaw_lpddr"));

    rawAnalysis = {};

    if (jsonFile) {
      const jsonText = await readFileAsText(jsonFile);
      rawAnalysis = JSON.parse(jsonText);
      appendLog("dashboard_data.json parsed successfully");
    }

    if (idiFile) {
      const idiText = await readFileAsText(idiFile);
      idiGraphData = extractNumericPairs(idiText);
      rawAnalysis.graph1_file = idiFile.name;
    } else {
      idiGraphData = [];
    }

    if (ddrFile) {
      const ddrText = await readFileAsText(ddrFile);
      ddrGraphData = extractNumericPairs(ddrText);
      rawAnalysis.graph2_file = ddrFile.name;
    } else {
      ddrGraphData = [];
    }

    loopRanges = normalizeLoopRanges(rawAnalysis);

    if (!rawAnalysis.run_info) {
      rawAnalysis.run_info = {
        run_dir: selectedFiles[0]?.webkitRelativePath?.split("/")[0] || "-",
        run_name: selectedFiles[0]?.webkitRelativePath?.split("/")[0] || "-",
        generated_at: "-"
      };
    }

    renderDashboard();
    setStatus(`Directory loaded successfully.\nFiles selected: ${selectedFiles.length}`, false);
  } catch (e) {
    console.error(e);
    appendLog(`Load failed: ${e.message}`, "ERROR");
    setStatus(`Load failed:\n${e.message}`, true);
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
      idiGraphData = extractNumericPairs(txt1);
      rawAnalysis.graph1_file = graph1File.name;
    }

    if (graph2File) {
      const txt2 = await readFileAsText(graph2File);
      ddrGraphData = extractNumericPairs(txt2);
      rawAnalysis.graph2_file = graph2File.name;
    }

    renderDashboard();
    setStatus("Manual graph overrides applied successfully.");
  } catch (e) {
    setStatus(`Failed to apply graph overrides:\n${e.message}`, true);
  }
}

function loadDemoData() {
  clearLog();
  rawAnalysis = JSON.parse(JSON.stringify(demoData));
  idiGraphData = JSON.parse(JSON.stringify(demoIdi));
  ddrGraphData = JSON.parse(JSON.stringify(demoDdr));
  loopRanges = normalizeLoopRanges(rawAnalysis);
  rawAnalysis.graph1_file = "output.overall_bw_samples.txt";
  rawAnalysis.graph2_file = "output.overall_bw_samples.txt";
  renderDashboard();
  setStatus("Demo data loaded successfully.");
}

function clearDashboard() {
  rawAnalysis = null;
  idiGraphData = [];
  ddrGraphData = [];
  loopRanges = [];
  selectedFiles = [];
  operationLogs = [];
  location.reload();
}
