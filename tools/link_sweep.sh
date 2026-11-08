#!/usr/bin/env bash
# The loader of every live city, one after another, profiled (tools/start_profile.js LOAD=1 PROFILE=1):
# its time to playable, its longest frames, and the blocking GL work in the load (the waits on shader
# links, the buffer and texture uploads). One line a city; the raw output stays in SWEEP_DIR. For a
# before and after of a change to the shaders or the uploads (issue 313): run it on both trees.
#   python3 -m http.server 8800 --directory web &
#   tools/link_sweep.sh [city ...]        (PORT=8801 for another tree's server, SWEEP_DIR=dir, TIER=high)
cd "$(dirname "$0")/.."
cities=("$@"); [ ${#cities[@]} -eq 0 ] && mapfile -t cities < <(bash tools/live_cities.sh)
out=${SWEEP_DIR:-$(mktemp -d)}; unset OUT; mkdir -p "$out"
for c in "${cities[@]}"; do
  LOAD=1 PROFILE=1 timeout 900 xvfb-run -a node tools/start_profile.js "$c" 960x600 > "$out/$c.txt" 2>&1
  python3 - "$c" "$out/$c.txt" <<'PY'
import re, sys
c, t = sys.argv[1], open(sys.argv[2]).read()
m = re.search(r'playable after ([\d.]+) s; longest frames \(s\): ([\d. ]+);.*?(\d+) frames over 1 s, ([\d.]+) s', t)
g = dict((k, (int(n), int(ms), int(mx))) for k, n, ms, mx in re.findall(r'(\w+) (\d+)x (\d+) ms max (\d+)', (re.search(r'GL in the load.*', t) or [''])[0]))
f = lambda k: f"{g[k][1] / 1000:.1f} s (max {g[k][2] / 1000:.1f})" if k in g else '-'
print(f"{c}: playable {m.group(1) if m else '?'} s, longest frame {m.group(2).split()[0] if m else '?'} s, {m.group(3) if m else '?'} frames over 1 s ({m.group(4) if m else '?'} s); "
      f"link waits {f('getProgramInfoLog')}, bufferData {f('bufferData')}, texSubImage2D {f('texSubImage2D')}", flush=True)
PY
done
