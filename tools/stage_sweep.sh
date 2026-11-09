#!/usr/bin/env bash
# The load's stages for every live city's game, one line each (issue 327): the time to playable and when the data
# was fetched and decoded, the scene built and the first frame drawn (telemetry.js's stages), from
# tools/start_profile.js LOAD=1. For a before and after, run it on both trees (PORT=8801 for another tree's server).
#   python3 -m http.server 8800 --directory web &
#   tools/stage_sweep.sh [city ...]        (RUNS=2 runs each, the line has their median; SWEEP_DIR=dir keeps the output)
cd "$(dirname "$0")/.."
cities=("$@"); [ ${#cities[@]} -eq 0 ] && mapfile -t cities < <(bash tools/live_cities.sh)
out=${SWEEP_DIR:-$(mktemp -d)}; mkdir -p "$out"
for c in "${cities[@]}"; do
  for r in $(seq 1 "${RUNS:-1}"); do
    LOAD=1 timeout 900 xvfb-run -a node tools/start_profile.js "$c" 960x600 > "$out/$c.$r.txt" 2>&1
  done
  python3 - "$c" "$out" "${RUNS:-1}" <<'PY'
import re, sys, statistics as st
c, d, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
rows = []
for r in range(1, n + 1):
    t = open(f'{d}/{c}.{r}.txt').read()
    m = re.search(r'playable after ([\d.]+) s', t)
    s = dict(re.findall(r'(\w+) ([\d.]+)', (re.search(r'stages \(s\): (.*)', t) or [None, ''])[1]))
    if m: rows.append({'playable': float(m.group(1)), **{k: float(v) for k, v in s.items()}})
med = lambda k: f"{st.median([r[k] for r in rows if k in r]):.1f}" if any(k in r for r in rows) else '-'
bld = f"{st.median([r['built'] - r['decoded'] for r in rows if 'built' in r and 'decoded' in r]):.1f}" if rows else '-'
print(f"{c}: playable {med('playable')} s; fetched {med('fetched')}, decoded {med('decoded')}, built {med('built')} (build {bld}), frame {med('frame')}", flush=True)
PY
done
