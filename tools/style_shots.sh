#!/usr/bin/env bash
# Stills of every city's facade styles (tools/style_views.py) on a desktop (1440x900) and a phone
# (390x844), at day, dusk and night, for a before/after comparison of a change to the buildings.
#   tools/style_shots.sh out_dir [city ...]     # serves web/ on $PORT (default 8800) if nothing does
#   TIMES=night tools/style_shots.sh out_dir    # only the night views
# Writes out_dir/<city>/{desktop,phone}/<view>.png and out_dir/<city>/{desktop,phone}.log.
set -u
cd "$(dirname "$0")/.."
OUT=${1:?out_dir}; shift
PORT=${PORT:-8800}; export PORT
JOBS=${JOBS:-2}
export NODE_PATH=${NODE_PATH:-$(npm root -g 2>/dev/null)}
CITIES=${*:-$(tools/live_cities.sh)}
curl -s -o /dev/null "http://localhost:$PORT/" || { python3 -m http.server "$PORT" --directory web >/dev/null 2>&1 & sleep 1; }
shoot() {
  c=$1; mkdir -p "$OUT/$c"
  python3 tools/style_views.py "$c" --n "${STYLES_N:-2}" --times "${TIMES:-day,dusk,night}" > "$OUT/$c/views.json"
  xvfb-run -a node tools/city_shot.js "$c" "$OUT/$c/views.json" "$OUT/$c/desktop" 1440 900 > "$OUT/$c/desktop.log" 2>&1
  xvfb-run -a node tools/city_shot.js "$c" "$OUT/$c/views.json" "$OUT/$c/phone" 390 844 > "$OUT/$c/phone.log" 2>&1
  echo "$c done"
}
export -f shoot; export OUT
printf '%s\n' $CITIES | xargs -P "$JOBS" -I{} bash -c 'shoot {}'
