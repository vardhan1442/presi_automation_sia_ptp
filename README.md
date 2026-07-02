# presi_automation_sia_ptp — SIA PTP Verification BW Dashboard

A modular browser dashboard for viewing emulation test results produced by
`verification.py` / `pons_verification.py`. It connects to the remote emulation
host over SSH through a local Python bridge server, pulls result files, and
renders interactive charts and tables.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Project Structure](#2-project-structure)
3. [Starting the Bridge Server](#3-starting-the-bridge-server)
4. [Opening the Dashboard](#4-opening-the-dashboard)
5. [Setting Up the SSH Connection](#5-setting-up-the-ssh-connection)
6. [Loading Existing Run Data](#6-loading-existing-run-data)
7. [Triggering the Verification Script Remotely](#7-triggering-the-verification-script-remotely)
8. [Using Local Folder Mode (no SSH)](#8-using-local-folder-mode-no-ssh)
9. [Dashboard Sections at a Glance](#9-dashboard-sections-at-a-glance)
10. [pons_verification.py vs verification.py](#10-pons_verificationpy-vs-verificationpy)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

Install the Python dependencies into a virtual environment:

```bash
# From the repo root
python -m venv .venv

# Windows
.venv\Scripts\Activate.ps1

# Linux / macOS
source .venv/bin/activate

pip install fastapi uvicorn asyncssh
```

The dashboard front-end is pure HTML/CSS/JavaScript — no Node.js build step needed.

---

## 2. Project Structure

```
presi_automation_sia_ptp/
├── analysis.html               ← Main dashboard page
├── index.html                  ← Home / connection setup page
├── setup.html                  ← SSH setup page
├── dashboard.html              ← Quick dashboard overview
├── pons_verification.py        ← Full verification script (NVL/pkgch/pkggh/…)
├── verification.py             ← Older verification script
├── sections/                   ← HTML partial sections (included at load time)
│   ├── 01_header.html
│   ├── 02_primary_input.html   ← SSH / local / demo load panel
│   ├── 04_meta_summary.html    ← Run metadata, test start/end
│   ├── 05_idi_metrics.html     ← IDI BW stats cards
│   ├── 06_ddr_metrics.html     ← DDR BW stats cards
│   ├── 07_loop_info.html       ← Loop timing + per-loop BW table
│   ├── 08_charts.html          ← IDI and DDR BW line charts
│   ├── 09_opcode_platform_scenario.html  ← Opcodes, platform threads, traffic
│   ├── 10_config.html          ← BIOS, DDR, cache, fuse info
│   ├── 13_peripheral_metrics.html  ← GT/Media/VPU/PCIe/Display counts (pons)
│   ├── 14_dbp_clock_metrics.html   ← DBP stats + clock frequency (pons)
│   ├── 15_cbo_tracker.html         ← CBO tracker opcode distribution (pons)
│   ├── 16_xmon_latency.html        ← Xmon counters + SOC latency (pons)
│   └── 11_debug_log.html       ← Operation log
├── scripts/
│   ├── app.js                  ← All dashboard rendering logic
│   ├── connection.js           ← SSH connection helpers / badge
│   ├── includes.js             ← HTML partial loader
│   └── setup.js                ← Setup/connection page logic
├── styles/
│   └── dashboard.css
└── tools/
    ├── server.py               ← Local SSH bridge server (FastAPI + asyncssh)
    ├── build.py                ← Optional: combine partials into dist/
    └── extract_ptp_data.py     ← Data extraction helper
```

---

## 3. Starting the Bridge Server

The bridge server is a lightweight FastAPI process that runs **locally** on your
Windows PC. It forwards SSH commands to the remote emulation host and serves the
static dashboard files.

```powershell
# Activate your virtual environment first
.venv\Scripts\Activate.ps1

# Start the server
python tools/server.py
```

Expected output:

```
============================================================
  PTP Dashboard SSH Bridge — server running
  Open dashboard at:  http://127.0.0.1:5000/analysis.html
============================================================

INFO:     Started server process [XXXXX]
INFO:     Uvicorn running on http://127.0.0.1:5000 (Press CTRL+C to quit)
```

The server **only binds to 127.0.0.1** — it is not reachable from the network.

To stop the server: press **Ctrl+C** in the terminal.

---

## 4. Opening the Dashboard

With the server running, navigate to:

```
http://127.0.0.1:5000/analysis.html
```

All pages are served from the same local server:

| URL | Purpose |
|-----|---------|
| `http://127.0.0.1:5000/analysis.html` | Main analysis dashboard |
| `http://127.0.0.1:5000/index.html` | Home / connection config |
| `http://127.0.0.1:5000/setup.html` | SSH setup helper |
| `http://127.0.0.1:5000/dashboard.html` | Quick overview |

---

## 5. Setting Up the SSH Connection

The SSH connection fields are in the **Load Data** panel on `analysis.html`
(and also on `index.html`). They are persisted to browser `localStorage` so you
only configure them once.

### Connection fields

| Field | Example | Notes |
|-------|---------|-------|
| **Host** | `10.x.x.x` | IP or hostname of the VNC/emulation host |
| **Port** | `22` | Default SSH port |
| **User** | `jbponsci` | Your Unix username on the remote host |
| **Password** | ••••• | Stored in `sessionStorage` only — cleared on browser close |
| **Private Key Path** | `~/.ssh/id_ed25519` | Path on the **local** PC; used if no password supplied |

### Authentication priority

1. **Password** — if typed, used first.  
2. **Key content** — if you paste a raw private key (Setup page).  
3. **Key path** — file on your local PC (`~/.ssh/id_ed25519` → `id_rsa` → `id_ecdsa` fallback).

### Testing the connection

Click **▶ Test Connection** in the Load Data panel. A green badge confirms
a successful handshake. The **Browse…** button becomes active only after a
successful test.

### VNC host notes

- The remote host is typically accessed over VPN. Ensure your VPN is connected
  before clicking Test Connection.
- If the emulation host uses a non-standard SSH port, update the **Port** field.
- If your SSH key requires a passphrase, enter it in the **Password** field for
  the session.

---

## 6. Loading Existing Run Data

Once connected, enter (or browse to) the **remote run directory** — this is the
folder that contains `dashboard_data.json` and the BW sample CSVs generated by
`verification.py`.

### Files the dashboard looks for

| File | Location in run dir | Purpose |
|------|---------------------|---------|
| `dashboard_data.json` | root of run dir | All analysis metadata (opcodes, loops, DDR counts, etc.) |
| `overall_bw_samples.txt` | `chainsaw_tmp/` | IDI bandwidth time-series |
| `overall_bw_samples.txt` | `chainsaw_lpddr/` | DDR bandwidth time-series |

### Steps

1. Fill in the connection fields and click **▶ Test Connection**.
2. Type the run directory path in **Remote Run Directory**, or click **Browse…**
   to navigate the remote filesystem.
3. Click **📂 Load** — the bridge server fetches the three files via SSH/SFTP and
   the dashboard renders immediately.

### Directory browser

After a successful connection test, click **📁 Browse…** next to the run
directory field. Navigate by clicking folder names; click **↥ Up** to go up
one level. When you reach the run directory, click **▶ Select & Run**.

---

## 7. Triggering the Verification Script Remotely

If `dashboard_data.json` does not exist yet (or you want to regenerate it), click
**▶ Run Verification Script**. This executes `verification.py` (or
`pons_verification.py`) on the **remote** host inside the run directory and
streams all console output live into the dashboard.

### Advanced settings (expand the panel)

| Field | Default | Notes |
|-------|---------|-------|
| **verification.py path** | `/nfs/site/…/pons_verification.py` | Absolute path on the remote host, or relative to run dir |
| **Python interpreter** | *(auto-detect)* | Leave blank to auto-detect `python3.11.1`; or set e.g. `/usr/bin/python3` |

### Workflow

```
1. Fill Host / User / Password
2. Click ▶ Test Connection  →  green badge
3. Browse to (or type) the run directory path
4. (Optional) Edit verification.py path in Advanced section
5. Click ▶ Run Verification Script
6. Watch the console output stream in the panel below
7. When the script finishes, click 📂 Load to pull the results
```

The verification script will:
- Decompress tracker files in the run directory
- Collect all metrics (IDI opcodes, DDR counts, fuses, loops, latency, xmon, …)
- Write `dashboard_data.json` to the run directory
- Re-compress files

---

## 8. Using Local Folder Mode (no SSH)

If the run directory is already on your local PC (or mapped as a network drive),
use **Local Folder** mode — no SSH or bridge server communication is needed.

1. Click **📁 Local Folder** tab in the Load Data panel.
2. Click **Choose Directory** and pick the run directory.
3. The browser reads `dashboard_data.json` and the BW sample files directly.

### Demo mode

Click **▶ Demo Data** to load synthetic data without any files. Useful for
testing the UI when no real run is available.

---

## 9. Dashboard Sections at a Glance

| Section | What it shows |
|---------|--------------|
| **Run Summary / Metadata** | Run dir, timestamps, threads, cores, Lsz (r10), Loops (r13), cmd line, kind_model |
| **IDI Metrics** | Visible-range avg/max/min BW for read and write |
| **DDR Metrics** | Same for DDR read and write |
| **IDI Loops Information** | Per-loop duration, BW, timeline chart, LIP boundaries |
| **IDI BW / DDR BW charts** | Interactive Plotly line charts with loop overlays |
| **BW Preview** | Tabular view of raw BW sample rows |
| **IDI Opcode Stats** | Pivot table (source × opcode), per-loop pagination, SOC CFI opcodes |
| **DDR Read / Write / Opcode Stats** | DDR transaction counts + opcode bar chart |
| **Platform Thread Mapping** | Thread → APIC ID → cluster/core/kind table |
| **Scenario Traffic Per Thread** | Traffic type per thread from JSON |
| **Run Configuration** | BIOS info, DDR config, cache sizes, fuse registers |
| **SOC Peripheral Metrics** *(pons)* | GT / Media / VPU / PCIe / Display transaction totals + info tables + R vs W chart |
| **DBP Stats + Clock Frequency** *(pons)* | DBP opcode distribution @ IDI and SOC_CFI; clock frequency change events |
| **CBO Tracker Opcode Distribution** *(pons)* | Per-tracker opcode counts + aggregate bar chart |
| **Xmon Performance Counters + SOC Latency** *(pons)* | Xmon register address/value table + bar chart; SOC_ICELAND MSC hit/miss latencies |

Sections marked *(pons)* are only populated when `pons_verification.py` was used.

---

## 10. pons_verification.py vs verification.py

`pons_verification.py` is the newer, more capable script. Key additions:

| Feature | `pons_verification.py` | `verification.py` |
|---------|------------------------|-------------------|
| **Xmon performance counters** | ✅ `get_xmon_info()` from `xmon.log` | ✗ |
| **GT memory detail** | ✅ `data_gtMem()` from `cfi_trk.log` | ✗ |
| **SOC latency** | ✅ from `cfi_latency_mufasa_hit_miss/` | ✗ |
| **Model types** | cdie, pkgch, **pkggh**, hubs, gt, media, vpu, pcie, display, simics, trace, pin | cdie, pkgch, pkgcn, gt, media, vpu, pcie, display |
| **Run Model info** | EMU model + cdie/hub model + CRIF paths + RTL versions | EMU model only |
| **Fuse domains** | Ring, eCore, pCore, CCLK, NCLK, GT, Media, Display, VPU, SA, QCLK, Noc | Ring, Atom, GT, Media, Display, VPU, SA, QCLK, Noc |
| **CBO tracker** | Multi-tracker with per-tracker counts | Single tracker |
| **pcd_pcie_xtor data** | ✅ `pcd_pcie_xtor_*` | `pch_pcie_xtor_*` |
| **Backup / restore** | ✅ clusters saved to JSON for incremental re-runs | ✅ same |

Use `pons_verification.py` for NVL / pkgch / pkggh runs to get all dashboard sections populated.

---

## 11. Troubleshooting

### "No SSH connection configured"
→ Fill in Host, User, and Password/Key on the Load Data panel, then click **▶ Test Connection**.

### "Bridge server must be running"
→ Start it: `python tools/server.py`. Keep that terminal open.

### Test Connection fails with "Connection refused"
→ Check VPN connectivity. Verify the host IP and port 22 is open.

### "No private key found"
→ Either enter a password, or ensure `~/.ssh/id_ed25519` (or `id_rsa`) exists on your local PC.

### dashboard_data.json not found after Load
→ The run has not been processed yet. Use **▶ Run Verification Script** to generate it.

### Charts are blank after loading
→ The `chainsaw_tmp/` or `chainsaw_lpddr/` BW sample files may not exist. The
dashboard still shows metadata from `dashboard_data.json`; BW charts require
the chainsaw output files.

### Peripheral / Xmon / Latency sections show "No data"
→ These sections require `pons_verification.py` (not `verification.py`). Re-run
with `pons_verification.py` on a GT, Media, VPU, PCIe, or Display test.

### Page auto-restores stale data on refresh
→ The dashboard caches the last loaded data in `localStorage`. Click the
**Clear Cache & Reload** button in the blue banner at the top of the page.

---

## Build (optional)

To produce a single self-contained `dist/index.html` with all partials inlined:

```bash
python tools/build.py
```
