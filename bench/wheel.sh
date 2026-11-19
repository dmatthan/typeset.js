#!/usr/bin/env bash
# Plays wheel patterns through a virtual hi-res mouse (uinput) into the desktop app and
# records what WebKitGTK delivers and where the reader goes. Linux + Hyprland; needs the
# dev server, a debug build, write access to /dev/uinput and python-evdev.
#   bench/wheel.sh [pattern,pattern…] [python]
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${2:-python3}"
OUT=$(mktemp)
VOLUMEN_SELFTEST=wheel timeout 90 ./target/debug/volumen >"$OUT" 2>/dev/null &
APP=$!
for _ in $(seq 1 80); do grep -q "SELFTEST ready" "$OUT" && break; sleep 0.25; done
grep -q "SELFTEST ready" "$OUT" || { echo "the app never became ready"; kill $APP; exit 1; }
# the app's own window, found by its process id (the child of `timeout`)
WIN=$(pgrep -P $APP volumen | head -1)
read -r X Y < <(hyprctl clients -j | python3 -c "
import sys, json
pid = $WIN
for c in json.load(sys.stdin):
    if c['pid'] == pid: print(c['at'][0] + c['size'][0] // 2, c['at'][1] + c['size'][1] // 2)")
hyprctl dispatch "hl.dsp.window.focus({ window = \"pid:$WIN\" })" >/dev/null || true
hyprctl dispatch "hl.dsp.cursor.move({ x = $X, y = $Y })" >/dev/null
"$PY" -I bench/wheel_inject.py "${1:-all}"
for _ in $(seq 1 60); do grep -q '"events"' "$OUT" && break; sleep 0.5; done
grep '"events"' "$OUT" | sed 's/^SELFTEST //'
wait $APP || true
rm -f "$OUT"
