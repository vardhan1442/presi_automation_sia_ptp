from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
template_path = ROOT / "index.html"
sections_dir = ROOT / "sections"
dist_dir = ROOT / "dist"
dist_dir.mkdir(exist_ok=True)

template = template_path.read_text(encoding="utf-8")

section_files = [
    "01_header.html",
    "02_primary_input.html",
    "03_graph_override.html",
    "04_meta_summary.html",
    "05_idi_metrics.html",
    "06_ddr_metrics.html",
    "07_loop_info.html",
    "08_charts.html",
    "09_opcode_platform_scenario.html",
    "10_config.html",
    "11_debug_log.html",
    "12_footer.html",
]

output = template
for file_name in section_files:
    key = file_name.replace(".html", "")
    content = (sections_dir / file_name).read_text(encoding="utf-8")
    output = output.replace("{{" + key + "}}", content)

(dist_dir / "index.html").write_text(output, encoding="utf-8")
print("Built dist/index.html")
