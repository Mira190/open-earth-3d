#!/usr/bin/env bash
# The traffic's soak (#355): every live city's traffic run for half an hour of the game's clock at 08:00, 10:00,
# 18:00 and 23:00 (the hour held: CLOCK_HOLD), from the start, with tools/traffic_check.js; one line a run, as a
# row of a Markdown table: the share of the cars' time standing, the share jammed (still 30 s or more), the cars
# jammed at the end, the longest any stood, the mean speed, the cars at the kerb, and the update's cost a frame.
# A run is free of gridlock when the jammed share stays under 5% and no more than a handful stand at the end.
# Serve web/ first, on $PORT (8800 by default).
#   tools/traffic_soak.sh [seconds] [hours...]      # 1800 s; 08:00 10:00 18:00 23:00; logs in $OUT (/tmp/oe-soak)
#   JOBS=3 CITIES="sydney tokyo" tools/traffic_soak.sh 600 08:00
set -u
cd "$(dirname "$0")/.."
SECS=${1:-1800}; shift || true
HOURS=${*:-08:00 10:00 18:00 23:00}
OUT=${OUT:-/tmp/oe-soak} JOBS=${JOBS:-2}
export NODE_PATH=${NODE_PATH:-$(npm root -g 2>/dev/null)}
mkdir -p "$OUT"
cities=${CITIES:-$(tools/live_cities.sh)}
run() { GAME_TIME=$2 CLOCK_HOLD=1 xvfb-run -a node tools/traffic_check.js "$1" "$SECS" 1 > "$OUT/$1-${2/:/}.log" 2>&1; }
n=0
for h in $HOURS; do for c in $cities; do run "$c" "$h" & n=$((n + 1)); if [ $n -ge "$JOBS" ]; then wait -n; n=$((n - 1)); fi; done; done
wait
echo "| city | hour | standing | jammed | jammed at the end | longest still | km/h | at the kerb | update |"
echo "|---|---|---|---|---|---|---|---|---|"
for c in $cities; do for h in $HOURS; do
  f="$OUT/$c-${h/:/}.log"
  all=$(grep '^all places: standing' "$f")
  st=$(echo "$all" | sed -n 's/.*standing still \([0-9]*\)%.*/\1/p'); jm=$(echo "$all" | sed -n 's/.*jammed \([0-9.]*\)%.*/\1/p'); kmh=$(echo "$all" | sed -n 's/.* \([0-9]*\) km\/h.*/\1/p')
  ls=$(echo "$all" | sed -n 's/.*longest still \([0-9]*\) s.*/\1/p'); up=$(echo "$all" | sed -n 's/.*update \([0-9.]*\) ms.*/\1/p')
  end=$(grep -o '[0-9]* at the end' "$f" | head -1 | cut -d' ' -f1); kerb=$(grep -o 'at the kerb: [0-9]*' "$f" | head -1 | cut -d' ' -f4)
  echo "| $c | $h | ${st:-?}% | ${jm:-?}% | ${end:-?} | ${ls:-?} s | ${kmh:-?} | ${kerb:-0} | ${up:-?} ms |"
done; done
