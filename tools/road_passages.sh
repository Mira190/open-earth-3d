#!/usr/bin/env bash
# The roads the data runs into a building, given a way through (pipeline/road_passages.py), for a
# city or every city with a game: tools/road_walls.js measures where the game cuts a road or a car
# doesn't fit along it, road_passages.py carves the buildings and canopy posts in the way, again
# until nothing changes (a carved footprint can leave the next one in the way, a road at a second
# level through a building is carved on the next pass), and road_walls.js measures again.
# Serve web/ first, on $PORT (8800 by default).
#   tools/road_passages.sh osaka        # or all; logs and the measured stretches in $OUT (/tmp/oe-walls)
set -u
cd "$(dirname "$0")/.."
OUT=${OUT:-/tmp/oe-walls}
mkdir -p "$OUT"
if [ "${1:-all}" = all ]; then cities=$(tools/live_cities.sh); else cities="$*"; fi
for c in $cities; do
  for pass in 1 2 3 4 5 6; do
    xvfb-run -a node tools/road_walls.js "$c" --json "$OUT/$c.$pass.json" > "$OUT/$c.$pass.log" 2>&1 || { echo "$c: road_walls.js failed (see $OUT/$c.$pass.log)"; continue 2; }
    res=$(python3 pipeline/road_passages.py --city "$c" --walls "$OUT/$c.$pass.json" | tail -1)
    echo "$c pass $pass: ${res# *}"
    case "$res" in *"nothing to change"*) break;; esac
  done
  xvfb-run -a node tools/road_walls.js "$c" > "$OUT/$c.after.log" 2>&1
  tail -2 "$OUT/$c.after.log" | sed "s/^/  after: /"
done
