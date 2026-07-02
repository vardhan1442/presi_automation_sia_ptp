#!/usr/bin/env python3
"""
PTP Lightweight Data Extractor
================================
Replicates the data-collection logic from verification.py using only stdlib.
No openpyxl or other heavy dependencies — just subprocess shell commands
(zgrep / awk / zcat) that are already on the remote Linux host.

Usage:
    python3 extract_ptp_data.py -r /path/to/run_dir

Output:
    Single JSON object written to stdout.
    The server captures this and returns it to the browser dashboard.
"""

import getopt
import glob
import gzip
import json
import os
import subprocess
import sys
import traceback


# ─── Helpers ────────────────────────────────────────────────────────────────

def run(cmd: str) -> str:
    """Run a shell command; return stripped stdout, '' on any error."""
    try:
        return subprocess.check_output(
            cmd, shell=True, stderr=subprocess.DEVNULL
        ).decode("utf-8", errors="replace").strip()
    except Exception:
        return ""


def runs(cmd: str) -> list:
    """Run a shell command; return list of non-empty output lines."""
    out = run(cmd)
    return [l for l in out.splitlines() if l.strip()] if out else []


# ─── Global state (mirrors verification.py globals) ─────────────────────────

typeModel = "cdie"
soc_cdie  = "cdie"
workload  = "mlc"


# ─── Detection helpers ───────────────────────────────────────────────────────

def kind_model() -> list:
    """Detect typeModel / workload — mirrors kind_model() in verification.py."""
    global typeModel, soc_cdie, workload

    workload = "mlc" if glob.glob("do_MLC*env*") else "stream"

    # GT variants
    if run("zgrep -i 'model_target' tri*env*"):
        typeModel = "gt"
    gt_do  = run("zgrep -i 'model_target' *.env* | grep -i 'c[1-4].*ug' | head -1")
    gt_do1 = run("zgrep -i 'GT_TEST=1' logbook.log* | head -1")
    if gt_do and gt_do1:
        typeModel = "gt"

    # Media
    media_do  = run("zgrep -i 'model_target' *.env* | grep -i 'c[1-4].*ur' | head -1")
    media_do1 = run("zgrep -i 'GFX_FC_MEDIA_TEST=1' logbook.log* | head -1")
    if media_do and media_do1:
        typeModel = "media"

    # VPU
    vpu_do  = run("zgrep -i 'model_target' *.env* | head -1")
    vpu_do1 = run("zgrep -i 'VPU_TEST=1' logbook.log* | head -1")
    if vpu_do and vpu_do1:
        typeModel = "vpu"

    # PCIe
    pcie_do  = run("zgrep -i 'model_target' *.env* | head -1")
    pcie_do1 = run("zgrep -i 'pcie_testcard' logbook.log* | head -1")
    if pcie_do and pcie_do1:
        typeModel = "pcie"

    # Display
    disp_do  = run("zgrep -i 'model_target' *.env* | grep -i 'c1.*ugr' | head -1")
    disp_do1 = run("zgrep -i 'EMU_DISPLAY_TEST=1' logbook.log* | head -1")
    if disp_do and disp_do1:
        typeModel = "display"

    # MLC workload variants
    if workload == "mlc":
        if run("zgrep -i 'model_target' do_MLC*env*"):
            typeModel = "cdie"
        if run("zgrep -i 'model_target' do*env* | grep -i 'cdie_'"):
            typeModel = "cdie"
        if run('zgrep -i "model_target" do*env* | grep -i "pkg_cn"'):
            typeModel = "pkgcn"
            soc_cdie  = "cdie"

    # Stream workload
    if run("zgrep -i 'model_target' stream*env* | grep -i 'cdie_.*616'"):
        typeModel = "cdie"
    if run('zgrep -i "model_target" stream*env* | grep -i "pkg_cn.*ps616"'):
        typeModel = "pkgcn"
        soc_cdie  = "cdie"

    # Module roots from gecco debug
    modules = [
        "CORE_ROOT", "ATOM_ROOT", "CCF_ROOT", "DISPLAY_ROOT", "GT_ROOT",
        "MC_ROOT", "HBO_ROOT", "C2C_ROOT", "NOC_MEMSS_ROOT", "MC0_EN", "MC1_EN",
    ]
    result = [f"typeModel={typeModel} workload={workload}"]
    for m in modules:
        val = run(f"zgrep -i '{m}' gecco*debug* | awk -F '=' '{{print$2}}'")
        result.append(f"{m}={val}" if val else f"{m}=None")

    return result


# ─── Data extraction functions ────────────────────────────────────────────────

def get_loops() -> str:
    return run("zgrep 'mov r13, 0x' *lst* | tail -1 | awk '{print $11}'")


def get_lsz() -> str:
    return run("zgrep 'mov r10, 0x' *lst* | tail -1 | awk '{print $11}'")


def test_cmd_line() -> str:
    return run("zgrep -i 'TEST CMD-LINE:' logbook.log* | awk -F ':' '{print $2}'")


def bios_info() -> str:
    return run("zgrep -i 'fc_te: Copying /p' logbook.log* | awk -F 'Copying' '{print $2}'")


def ddr_info() -> str:
    return run(r"zgrep -i 'Setting EMU_MEM_CFG\|ECT_CFG_MRC_CFG' logbook.log.gz | awk -F ' ' '{print $NF}'")


def get_opcodes() -> list:
    if typeModel in ("pkgcn", "cdie"):
        cmd = (
            r"zcat idi* | awk -F '|' '{print $2 \"..\" $7 \"..\" $19}' | sed -e 's/\.\./ /g' "
            r"| awk '$2 != \"\" {print $0}' | grep -v '-' | grep -v 'Unit' "
            r"| awk -F ' ' '{print $1 \", \" $2 \", \" $3}' | sed -e 's/ //g' "
            r"| sort | uniq -c | sort -nr | grep -i '[0-9]\{4\}[0-9]*' "
            r"| awk -F ',' '{print $1 \" \" $2 \" \" $3}' "
            r"| awk -F ' ' '{print $1 \", \" $2 \", \" $3 \", \" $4}' | head -50"
        )
    else:
        cmd = (
            r"zcat idi* | awk -F '|' '{print $2 \"..\" $7 \"..\" $19}' | sed -e 's/\.\./ /g' "
            r"| awk '$2 != \"\" {print $0}' | grep -v '-' | grep -v 'Unit' "
            r"| awk -F ' ' '{print $1 \", \" $2 \", \" $3}' | sed -e 's/ //g' "
            r"| sort | uniq -c | sort -nr | grep -i '[0-9]\{3\}[0-9]*' "
            r"| awk -F ',' '{print $1 \" \" $2 \" \" $3}' "
            r"| awk -F ' ' '{print $1 \", \" $2 \", \" $3 \", \" $4}' | head -50"
        )
    return runs(cmd)


def get_processor_info() -> list:
    """Read Platform*.csv (plain or .gz) — mirrors get_enabled_threads_from_csv."""
    platforms = sorted(glob.glob("Platform*csv") + glob.glob("Platform*csv.gz"))
    if not platforms:
        return []

    config_file = platforms[0]
    try:
        if config_file.endswith(".gz"):
            raw = gzip.open(config_file, "rb").read().decode("utf-8", errors="replace")
            lines = raw.splitlines()
        else:
            with open(config_file, "r", errors="replace") as fh:
                lines = fh.readlines()
    except Exception:
        return []

    enabled_threads = []
    start_index = -1
    idx_tag = idx_enabled = idx_kind = idx_apic = idx_cluster = idx_ring = -1

    for raw_line in lines:
        line = raw_line.strip().split(",")
        if any("Processor Info" in x for x in line):
            start_index = len(enabled_threads)

        if start_index >= 0 and "#tag" in line:
            try:
                idx_tag     = line.index("#tag")
                idx_enabled = line.index(" #enabled")
                idx_kind    = line.index("  #kind")
                idx_apic    = line.index(" #apic_id")
                idx_cluster = line.index(" #cluster_id")
                for rn in ("#ring", " #ring"):
                    if rn in line:
                        idx_ring = line.index(rn)
                        break
                enabled_threads.append([
                    line[idx_tag], line[idx_enabled], line[idx_kind],
                    line[idx_apic], line[idx_cluster],
                ])
            except (ValueError, IndexError):
                pass
        elif start_index >= 0 and idx_enabled >= 0 and len(line) > max(idx_enabled, idx_tag, 0):
            if idx_enabled < len(line) and "TRUE" in line[idx_enabled] and line[0].strip().startswith("thread"):
                row = [
                    line[idx_tag]     if idx_tag     < len(line) else "",
                    line[idx_enabled] if idx_enabled < len(line) else "",
                    line[idx_kind]    if idx_kind    < len(line) else "",
                    line[idx_apic]    if idx_apic    < len(line) else "",
                    line[idx_cluster] if idx_cluster < len(line) else "",
                ]
                enabled_threads.append(row)

    return enabled_threads


def get_clock() -> list:
    return runs("zgrep -i 'mhz' logbook.log* | grep -i inter")


def get_fuses() -> list:
    if typeModel in ("gt",):
        pat = r"QCLK_F\|F_QCLK\|QCLK_GV\|SA_QCLK_RATIO\|gt_p._ratio\|gt_min\|nocpll_ratio\|fuses_RING_P.*_RATIO\|fuses_IA_P.*_RATIO\|BOOT_IA_RATIO"
    elif typeModel == "media":
        pat = r"QCLK_F\|F_QCLK\|QCLK_GV\|SA_QCLK_RATIO\|media_p._ratio\|media_min\|nocpll_ratio"
    elif typeModel == "display":
        pat = r"QCLK_F\|F_QCLK\|QCLK_GV\|SA_QCLK_RATIO\|dnc_p._ratio\|dnc_min\|nocpll_ratio"
    else:
        pat = (
            r"QCLK_F\|F_QCLK\|QCLK_GV\|SA_QCLK_RATIO"
            r"\|fuses_IA_P0_RATIO_.*_ATOM_DELTA\|atom.*fused_\|nocpll_ratio"
            r"\|fuses_RING_P.*_RATIO\|fuses_IA_P0_RATIO_.*_BIGCORE_DELTA"
            r"\|fuses_IA_P.*_RATIO\|BOOT_IA_RATIO"
        )
    return runs(f"zgrep -i '{pat}' fuseinfo.log*")


def get_memory_json() -> list:
    """Read perspec_scenario_*.json (plain or .gz) — mirrors Get_Memory_json."""
    jfiles = sorted(
        glob.glob("perspec_scenario_*.json") + glob.glob("perspec_scenario_*.json.gz")
    )
    if not jfiles:
        return []
    jf = jfiles[0]
    try:
        if jf.endswith(".gz"):
            data = json.loads(gzip.open(jf, "rb").read().decode("utf-8"))
        else:
            with open(jf) as fh:
                data = json.load(fh)
        tokens  = data.get("sln-solution", {}).get("tokens", {})
        num     = len(tokens) + 2
        actions = data.get("sln-solution", {}).get("actions", [])
        skip_cols = {0, 3, 5, 6, 7, 11, 12, 13, 14, 15, 16, 17}
        lookout = []
        for i in range(min(num, len(actions))):
            vals     = actions[i].get("values", [])
            filtered = [v for j, v in enumerate(vals) if j not in skip_cols]
            lookout.append(filtered)
        lookout = lookout[2:]
        lookout_sort = sorted(
            lookout,
            key=lambda x: int("".join(filter(str.isdigit, str(x[1])))) if len(x) > 1 and x[1] else 0
        )
        return lookout_sort
    except Exception:
        return []


def test_start_end() -> tuple:
    if soc_cdie == "cdie" and typeModel == "pkgcn":
        s = r"zgrep -i '[0]*0[234][0-9a-f]\{8\} ' trackers_cdie/idi_jem_tracker.log* | grep -i 'c2u_req' | head -1"
        e = r"zgrep -i '[0]*0[234][0-9a-f]\{8\} ' trackers_cdie/idi_jem_tracker.log* | grep -i 'c2u_req' | grep -iv 'wb.fto.' | tail -1"
    elif soc_cdie == "cdie" and typeModel == "cdie":
        s = r"zgrep -i '[0]*0[234][0-9a-f]\{8\} ' idi_bridge.log* | grep -i 'c2u_req' | head -1"
        e = r"zgrep -i '[0]*0[234][0-9a-f]\{8\} ' idi*.log* | grep -i 'c2u_req' | grep -iv 'wb.fto.' | tail -1"
    else:
        s = r"zgrep -i '[0]*0[234][0-9a-f]\{8\} ' idi_bridge.log* | grep -i 'c2u_req' | head -1"
        e = r"zgrep -i '[0]*0[234][0-9a-f]\{8\} ' idi*.log* | grep -i 'c2u_req' | grep -iv 'wb.fto.' | tail -1"
    return run(s), run(e)


def get_range_loops() -> list:
    """Compute loop time ranges from lip_tracker files — mirrors timestamp()."""
    # Step 1 — find the loop-end instruction address in the lst file
    loop_lip = run(r"zgrep -i 00abcde do*.lst* | awk -F ':' '{print $1}' | awk -F 'x' '{print $2}'")
    if not loop_lip:
        return []

    # Step 2 — find the test-start instruction address
    start_lip_addr = run(r"zgrep -i 'mov.*xmm.*[[rsdcxi]]' do*.lst* | head -1 | awk -F ':' '{print $1}' | awk -F 'x' '{print $2}'")
    if not start_lip_addr:
        start_lip_addr = run(r"zgrep -i 'mov r8, rax' do*.lst* | head -1 | awk -F ':' '{print $1}' | awk -F 'x' '{print $2}'")
    if not start_lip_addr:
        return []

    lp = loop_lip.strip()
    sl = start_lip_addr.strip()

    # Step 3 — get timestamps from log files based on model type
    if soc_cdie == "cdie" and typeModel == "pkgcn":
        end_cmd   = f"zgrep -i {lp} trackers_cdie/lip*tracker[A-Z0-9]*[A-Z0-9].log* | awk -F ':' '{{print $2}}' | awk -F '|' '{{print $1}}'"
        start_cmd = f"zgrep -i {sl} trackers_cdie/lip*tracker[A-Z0-9]*[A-Z0-9].log* | grep -iv 'E-No' | awk -F ':' '{{print $2}}' | awk -F '|' '{{print $1}}'"
    elif soc_cdie == "cdie" and typeModel == "cdie":
        end_cmd   = f"zgrep -i '{lp}' guop*log* | awk -F ':' '{{print $2}}' | awk -F '|' '{{print $1}}'"
        start_cmd = f"zgrep -i '{sl}' guop*log* | awk -F ':' '{{print $2}}' | awk -F '|' '{{print $1}}'"
    else:
        # Fallback: try generic lip_tracker files
        end_cmd   = f"zgrep -i '{lp}' lip*tracker*.log* | awk -F ':' '{{print $2}}' | awk -F '|' '{{print $1}}'"
        start_cmd = f"zgrep -i '{sl}' lip*tracker*.log* | head -1 | awk -F ':' '{{print $2}}' | awk -F '|' '{{print $1}}'"

    end_times   = [t.strip() for t in runs(end_cmd)   if t.strip().lstrip("-").isdigit()]
    start_times = [t.strip() for t in runs(start_cmd) if t.strip().lstrip("-").isdigit()]

    if not end_times or not start_times:
        return []

    num_cores = len(start_times)
    loops     = len(end_times) // num_cores
    if loops < 2:
        return []

    try:
        # Build aux matrix: aux[ma] = list of timestamps for that loop boundary
        aux = []
        for ma in range(loops + 1):
            group = []
            for aa in range(num_cores):
                if ma == 0:
                    group.append(int(start_times[aa]))
                else:
                    idx = loops * aa + (ma - 1)
                    if idx < len(end_times):
                        group.append(int(end_times[idx]))
            aux.append(group)

        rangeLoops = []
        first = True
        for cc in range(loops):
            lo = min(aux[cc])
            if first:
                hi    = max(aux[cc + 1])
                first = False
            else:
                min_time = max(aux[cc])
                sorted_next = sorted(aux[cc + 1])
                hi = next((v for v in sorted_next if v > min_time), sorted_next[-1])
            rangeLoops.append([str(lo), str(hi)])

        return rangeLoops
    except Exception:
        return []


def get_lip_inst_count() -> list:
    lipgrep = runs(
        r"rg -iz -A50 'OUTTERLOOP.*:' do*lst* | grep -i 'add r[scd][xi], *' "
        r"| awk -F ':' '{print $1}' | awk -F 'x' '{print $2}' | head -1"
    )
    tmp = lipgrep[0].strip() if lipgrep else ""
    if not tmp:
        tmp = run(r"zgrep -i 'add r[ba]x, 0x40' do*lst* | awk -F ':' '{print $1}' | awk -F 'x' '{print $2}' | tail -1")
    if not tmp:
        return []
    cmd = (
        f"zgrep -ic {tmp} lip*tracker*[A-Z0-9][A-Z0-9].log* "
        r"| grep -iv 'annotated' | grep -iv ':0' | tail -100"
    )
    return runs(cmd)


def get_start_lip() -> list:
    start_addr = run(r"zgrep -i 'mov.*xmm.*[[rsdcxi]]' do*.lst* | head -1 | awk -F ':' '{print $1}' | awk -F 'x' '{print $2}'")
    if not start_addr:
        start_addr = run(r"zgrep -i 'mov r8, rax' do*.lst* | head -1 | awk -F ':' '{print $1}' | awk -F 'x' '{print $2}'")
    end_addr = run(r"zgrep -i 'mov.*, 0x.*abcde' do*.lst* | head -1 | awk -F ':' '{print $1}' | awk -F 'x' '{print $2}'")

    if not start_addr:
        return ["none", "none", "none", "none"]

    sa = start_addr.strip()
    ea = (end_addr.strip() if end_addr else "none")

    if soc_cdie == "cdie" and typeModel == "pkgcn":
        s_raw = run(f"zgrep -i {sa} trackers_cdie/lip*tracker[A-Z0-9]*[A-Z0-9].log*")
        e_raw = run(f"zgrep -i {ea} trackers_cdie/lip*tracker[A-Z0-9]*[A-Z0-9].log*") if ea != "none" else "none"
    else:
        s_raw = run(f"zgrep -i {sa} lip*tracker*.log* | head -1")
        e_raw = run(f"zgrep -i {ea} lip*tracker*.log* | head -1") if ea != "none" else "none"

    return ["### Start ###", s_raw or "none", "### End ###", e_raw or "none"]


def run_model() -> list:
    return [
        run("zgrep -i 'maestro.*compile.*pass' logbook*"),
        run("zgrep -i 'started: ' logbook* | head -1"),
        run("zgrep -i 'date/time end' logbook* | head -1"),
        run("zgrep -i 'job [0-9][0-9].* has started' logbook*"),
        run("zgrep -i 'job .* has finished' logbook*"),
        run(r"zgrep -i 'Setting.*cfg.*BclkRatio.*' logbook*"),
    ]


def get_num_instructions() -> list:
    results = []
    for suffix, pat in [
        ("total", r"grep -i c2u_req | grep -iv 'wbefto.\|llcprefdata' | awk -F '|' '{print $6}' | sed -e 's/ //g' | sort | wc -l"),
        ("cl64",  r"grep -i c2u_req | grep -iv 'wbefto.\|llcprefdata' | awk -F '|' '{print $6}' | sed -e 's/ //g' | sort | grep -ic '[048c]0$'"),
        ("other", r"grep -i c2u_req | grep -iv 'wbefto.\|llcprefdata' | awk -F '|' '{print $6}' | sed -e 's/ //g' | sort | grep -ivc '[048c]0$'"),
    ]:
        if soc_cdie == "cdie" and typeModel == "pkgcn":
            src = "trackers_cdie/idi_jem_tracker.log*"
        elif soc_cdie == "cdie" and typeModel == "cdie":
            src = "idi_bridge*.log*"
        else:
            src = "idi*.log*"
        val = run(f"zgrep -i '[0]*[234][0-9a-f]{{8}} | ' {src} | {pat}")
        results.append(val or "no data")
    return results


# ─── Entry point ─────────────────────────────────────────────────────────────

def main():
    global typeModel, soc_cdie, workload

    try:
        opts, _ = getopt.getopt(sys.argv[1:], "r:", ["run_dir="])
    except getopt.GetoptError:
        sys.exit(1)

    run_dir = os.getcwd()
    for opt, arg in opts:
        if opt in ("-r", "--run_dir"):
            run_dir = arg

    os.chdir(run_dir)

    data: dict = {}

    # ── Model / workload detection ────────────────────────────────────────
    data["kind_model"]          = kind_model()
    data["typeModel"]           = typeModel
    data["workload"]            = workload
    data["soc_cdie"]            = soc_cdie
    data["Test Execution Path"] = run_dir

    # ── Logbook fields ────────────────────────────────────────────────────
    data["test_cmd_line"] = test_cmd_line()
    data["BiosInfo"]      = bios_info()
    data["DDRInfo"]       = ddr_info()
    data["RunModel"]      = run_model()

    # ── LST-file fields ───────────────────────────────────────────────────
    data["Loops"] = get_loops()
    data["Lsz"]   = get_lsz()

    # ── Platform / config ─────────────────────────────────────────────────
    data["Platform_Config"] = get_processor_info()
    data["Clock"]           = get_clock()
    data["Fuses"]           = get_fuses()

    # ── Scenario JSON (Memory_json) ───────────────────────────────────────
    data["Memory_json"] = get_memory_json()

    # ── IDI opcodes ───────────────────────────────────────────────────────
    data["opcodes"]         = get_opcodes()
    data["opcodes_soc_cfi"] = runs(
        r"zcat SOC_CFI_trk*.log* 2>/dev/null | awk -F '|' "
        r"'{print $2 \"..\" $6 \"..\" $7 \"..\" $10 \"..\" $11 \"..\" $13 \"..\" $(NF)}' "
        r"| sed -e 's/ //g' | sed -e 's/\.\./ /g' | sort | uniq -c | sort -nr "
        r"| awk '$3 != \"\" {print $0}' | grep -v 'VC_NAME' | head -50"
    )

    # ── Test timestamps ───────────────────────────────────────────────────
    ts, te = test_start_end()
    data["testStart"] = ts
    data["testEnd"]   = te

    # ── Latency ───────────────────────────────────────────────────────────
    data["latency"] = runs("zgrep -i 'Avg lat' cfi_latency_mufasa_hit_miss/tmp_idi_lat.txt*")

    # ── Loop tracking ─────────────────────────────────────────────────────
    data["rangeLoops"] = get_range_loops()
    data["start_lip"]  = get_start_lip()

    if workload == "mlc":
        data["numberlipinst"] = get_lip_inst_count()
        data["num_instructions"] = get_num_instructions()

    # ── DDR test window ───────────────────────────────────────────────────
    data["testStartDDR"] = run(r"zgrep -i 'MEM_READ' trackers_socn/cmi_bw/cmi_jem_tracker.log* 2>/dev/null | head -1")
    data["testEndDDR"]   = run(r"zgrep -i 'MEM_READ' trackers_socn/cmi_bw/cmi_jem_tracker.log* 2>/dev/null | tail -1")

    # ── DDR transaction counts ────────────────────────────────────────────
    data["DDR_info"]  = run(r"zgrep -ic 'Rd\|_RD' MC*.log* 2>/dev/null")
    data["DDR_infoW"] = run(r"zgrep -ic 'Wr\|_WR' MC*.log* 2>/dev/null")

    # Output JSON to stdout for the server to capture
    sys.stdout.write(json.dumps(data))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
