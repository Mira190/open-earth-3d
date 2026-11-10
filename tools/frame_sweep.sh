#!/bin/bash
# One line of tools/frame_cost.js for every live city on each tier, on foot with the clock held, for the tables in
# docs/PERFORMANCE.md: full-screen passes, draws, triangles (millions), pixels shaded (millions), megabytes the
# full-screen passes write and the main thread's milliseconds a frame.
#   python3 -m http.server 8800 --directory web &
#   tools/frame_sweep.sh [WxH] [city ...]      TIERS="high medium low", JOBS=3, PORT=8800, NIGHT=1
cd "$(dirname "$0")/.." || exit 1
size=${1:-1440x900}; shift
cities=${*:-$(tools/live_cities.sh)}
echo "| city | tier | full-screen passes | draws | triangles (M) | shaded (Mpx) | passes write (MB) | main thread (ms) |"
echo "|---|---|---|---|---|---|---|---|"
for c in $cities; do for t in ${TIERS:-high medium low}; do echo "$c $t"; done; done |
  xargs -P "${JOBS:-3}" -L 1 bash -c 'ROW=1 FOOT=1 FREEZE=1 TIER=$1 xvfb-run -a node tools/frame_cost.js $0 '"$size"' 5 2>&1 | grep "^ROW" | cut -c5- || echo "| $0 | $1 | failed |"' | sort
