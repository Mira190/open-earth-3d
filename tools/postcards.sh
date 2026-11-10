#!/usr/bin/env bash
# The postcards' stills (docs/POSTCARDS.md): for each city named (every live city with spots, if none is),
# the views of cities/<id>/postcards.json through tools/game_shot.js at four lights, packed as WebP into
# web/data/<id>/postcards/, and then the index the pages read (web/data/postcards.json).
#   tools/postcards.sh              # every live city
#   tools/postcards.sh kyoto tokyo  # these
# About five minutes a city on a software renderer. Serves web/ on its own port.
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-8874}
OUT=${POSTCARDS_OUT:-/tmp/oe-postcards}
export PORT NODE_PATH=${NODE_PATH:-$(npm root -g 2>/dev/null)}
X=""; command -v xvfb-run >/dev/null && X="xvfb-run -a"
python3 -m http.server "$PORT" --directory web >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null' EXIT
for i in $(seq 50); do curl -s -o /dev/null "localhost:$PORT/" && break; sleep 0.2; done
cities=("$@")
[ ${#cities[@]} -eq 0 ] && for c in $(tools/live_cities.sh); do [ -f "cities/$c/postcards.json" ] && cities+=("$c"); done
rc=0
for c in "${cities[@]}"; do
  mkdir -p "$OUT/$c"
  find "$OUT/$c" -name '*.png' -delete
  python3 pipeline/postcards.py views "$c" >"$OUT/$c.json" || { rc=1; continue; }
  timeout 3000 $X node tools/game_shot.js "$c" "$OUT/$c.json" "$OUT/$c" 960x640 >"$OUT/$c.log" 2>&1
  grep -E 'still black|pageerror|nowhere to stand' "$OUT/$c.log" && rc=1
  python3 pipeline/postcards.py pack "$c" "$OUT/$c" || rc=1
done
python3 pipeline/postcards.py index || rc=1
exit $rc
