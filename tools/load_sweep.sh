#!/usr/bin/env bash
# The loader and the press of Play in every live city, one after another (issue 299): each city's time to
# playable and longest loader frames (tools/start_profile.js LOAD=1), then the shaders compiled in the 14 s
# after Play (tools/walk_hitch.js PLAY=1 STACK=1), split into those the warm-up compiled and those a draw
# compiled (render-time: a stall), with the worst frame. One line a city.
#   python3 -m http.server 8800 --directory web &
#   tools/load_sweep.sh [city ...]        (PORT=8801 for another tree's server; OUT=dir keeps the raw output)
cd "$(dirname "$0")/.."
cities=("$@"); [ ${#cities[@]} -eq 0 ] && mapfile -t cities < <(bash tools/live_cities.sh)
out=${OUT:-$(mktemp -d)}; mkdir -p "$out"
for c in "${cities[@]}"; do
  LOAD=1 timeout 600 xvfb-run -a node tools/start_profile.js "$c" 960x600 > "$out/$c.load.txt" 2>&1
  PLAY=1 STACK=1 timeout 900 xvfb-run -a node tools/walk_hitch.js "$c" 14 > "$out/$c.play.json" 2>&1
  python3 - "$c" "$out" <<'PY'
import json, re, sys
c, out = sys.argv[1], sys.argv[2]
load = open(f'{out}/{c}.load.txt').read()
m = re.search(r'playable after ([\d.]+) s; longest frames \(s\): ([\d. ]+);', load)
try:
    d = json.load(open(f'{out}/{c}.play.json'))
    sh = [s for s in d.get('shaders') or [] if ' (fs)' in s]
    warm = [s for s in sh if re.search(r'compile|warm|Depth', s.split('<=')[-1] if '<=' in s else '')]
    worst = d['worst'][0]['ms'] if d.get('worst') else 0
    play = f"programs after Play {len(sh)} ({len(sh) - len(warm)} at a draw, {len(warm)} warmed), worst frame {worst / 1000:.1f} s"
    draws = [s.split(' @ ')[-1][:90] for s in sh if s not in warm]
    if draws: play += ' | at a draw: ' + '; '.join(draws[:4])
except Exception as e:
    play = f'play: {e}'
print(f"{c}: playable {m.group(1) if m else '?'} s, longest loader frame {m.group(2).split()[0] if m else '?'} s; {play}", flush=True)
PY
done
