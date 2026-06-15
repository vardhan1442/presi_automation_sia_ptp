# presi_automation_sia_ptp
Consists autmation related bundle to be used by SIA PTP EMULATION
# Verification BW Dashboard

This repo contains a modular static dashboard for viewing:
- IDI BW
- DDR BW
- loop timing
- opcode stats
- platform mapping
- scenario traffic
- configuration and debug logs

## Structure

- `sections/` : HTML partials
- `styles/` : CSS
- `scripts/` : JavaScript logic
- `tools/build.py` : combines partials into final `dist/index.html`

## Build

```bash
python tools/build.py
