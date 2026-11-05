#!/usr/bin/env bash
# tools/traffic_check.js over every city with a game, a few at a time, and one summary line each
# (the jams, the longest still, cars caught up in one another, cars over their line, crossing
# movements let in at once). Serve web/ first, on $PORT (8800 by default).
#   tools/traffic_all.sh [seconds per place] [places]     # logs in $OUT (/tmp/oe-traffic)
set -u
cd "$(dirname "$0")/.."
SECS=${1:-150} PLACES=${2:-3} OUT=${OUT:-/tmp/oe-traffic} JOBS=${JOBS:-2}
export NODE_PATH=${NODE_PATH:-$(npm root -g 2>/dev/null)}
mkdir -p "$OUT"
cities=$(tools/live_cities.sh)
run() { xvfb-run -a node tools/traffic_check.js "$1" "$SECS" "$PLACES" > "$OUT/$1.log" 2>&1; }
n=0
for c in $cities; do run "$c" & n=$((n + 1)); if [ $n -ge "$JOBS" ]; then wait -n; n=$((n - 1)); fi; done
wait
fail=0
for c in $cities; do
  f="$OUT/$c.log"
  all=$(grep '^all places' "$f" | sed 's/^all places: //')
  caught=$(grep -o 'caught up in another car: [0-9.]*' "$f" | awk '{s += $NF} END {printf "%.2f", s / (NR ? NR : 1)}')
  over=$(grep -o 'cars found over a line: [0-9]*' "$f" | awk '{s += $NF} END {print s + 0}')
  cross=$(grep -o 'let into one junction at once: [0-9]*' "$f" | awk '{s += $NF} END {print s + 0}')
  res=$(tail -1 "$f")
  [ "$res" = ok ] || fail=1
  printf '%-18s %s; caught %s pairs/s; over a line %s; crossing let in %s: %s\n' "$c" "$all" "$caught" "$over" "$cross" "$res"
done
exit $fail
