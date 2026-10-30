#!/usr/bin/env bash
# The checks to pass before work lands on main, in one command. It serves web/ on its own port
# and, for what the branch changed against origin/main (or for the targets named):
#   - plays each city's game headless (tools/game_check.js: walk, talk, helicopter, ferries,
#     your car, a taxi and a ride),
#     three cities at a time, under xvfb-run (llvmpipe) when it is installed;
#   - runs each reef site's scripted test (reef/index.html?gametest=1);
#   - runs the title screen on a tablet, a phone and a desktop and with WebGL faults injected
#     (tools/title_check.js), and fails a frame that ends black or a page that throws.
# Prints one line per check and exits 1 if any failed. Logs and screenshots go to $CHECK_OUT.
#   tools/check.sh                      # what this branch changed (committed or not)
#   tools/check.sh sydney hardy-reef    # these cities and reef sites
#   tools/check.sh title                # the title screen only
#   tools/check.sh all                  # every city, every reef site and the title
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-8870}
OUT=${CHECK_OUT:-/tmp/oe-check}
JOBS=${CHECK_JOBS:-3}
mkdir -p "$OUT"
export NODE_PATH=${NODE_PATH:-$(npm root -g 2>/dev/null)}

CITIES=$(for f in web/data/*/game.json; do basename "$(dirname "$f")"; done)
REEFS=$(for d in web/data/*/; do d=$(basename "$d"); [ -f "web/data/$d/game.json" ] || echo "$d"; done)
is_in() { printf '%s\n' $2 | grep -qx "$1"; }

cities=() reefs=() title=0
add_city() { is_in "$1" "${cities[*]:-}" || cities+=("$1"); }
add_reef() { is_in "$1" "${reefs[*]:-}" || reefs+=("$1"); }
all_cities() { for c in $CITIES; do add_city "$c"; done; }
all_reefs() { for r in $REEFS; do add_reef "$r"; done; }

if [ $# -gt 0 ]; then
  for t in "$@"; do
    case "$t" in
      all) all_cities; all_reefs; title=1 ;;
      title) title=1 ;;
      *) if is_in "$t" "$CITIES"; then add_city "$t"
         elif is_in "$t" "$REEFS"; then add_reef "$t"
         else echo "unknown target: $t (cities: $(echo $CITIES); reef sites: $(echo $REEFS))"; exit 2; fi ;;
    esac
  done
else
  base=$(git merge-base origin/main HEAD 2>/dev/null) || { echo "no origin/main to compare with: git fetch origin main"; exit 2; }
  changed=$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)
  for f in $changed; do
    case "$f" in
      cities/*/*|web/data/*/*)
        id=${f#*/}; id=${id%%/*}
        if is_in "$id" "$CITIES"; then add_city "$id"; elif is_in "$id" "$REEFS"; then add_reef "$id"; fi ;;
      web/reef/*) all_reefs ;;
      web/title.*|web/earth.js|web/score.js|web/film.*|web/fonts.css) title=1 ;;
      web/index.html|web/quality.js) all_cities; title=1 ;;
      web/game/*|web/assets/*|web/vendor/*|web/*.js|tools/game_check.js) all_cities ;;
    esac
  done
fi

if [ ${#cities[@]} -eq 0 ] && [ ${#reefs[@]} -eq 0 ] && [ $title -eq 0 ]; then
  echo "nothing to check: no change to a city, a reef site, the game, the renderer or the title"
  exit 0
fi

started=
if ! curl -s -o /dev/null "http://localhost:$PORT/index.html"; then
  python3 -m http.server "$PORT" --directory web >"$OUT/server.log" 2>&1 &
  started=$!
  for _ in $(seq 50); do curl -s -o /dev/null "http://localhost:$PORT/index.html" && break; sleep 0.2; done
fi
trap '[ -n "$started" ] && kill $started 2>/dev/null' EXIT
export PORT
X=; command -v xvfb-run >/dev/null && X="xvfb-run -a"

run_city() {
  local c=$1
  if timeout 900 $X node tools/game_check.js "$c" "$OUT/$c" >"$OUT/$c.log" 2>&1; then echo "ok   game   $c"
  else echo "FAIL game   $c   (see $OUT/$c.log)"; fi
}
run_reef() {
  local r=$1 res
  res=$(timeout 600 node tools/page_eval.js "reef/index.html?city=$r&still=1&gl=1&gametest=1&mute=1" \
    "window.__gametest && [window.__gametest.pass, window.__gametest.fail]" 2>"$OUT/$r.log" | tail -1)
  case "$res" in
    \[*,0\]) echo "ok   reef   $r ${res}" ;;
    *) echo "FAIL reef   $r ${res:-no result}   (see $OUT/$r.log)" ;;
  esac
}
run_title() {
  timeout 1800 node tools/title_check.js "$OUT/title" >"$OUT/title.log" 2>&1
  python3 -I - "$OUT/title.log" <<'EOF'
import json, sys
bad, seen = [], 0
for line in open(sys.argv[1]):
    name, _, rest = line.strip().partition(' ')
    rest = rest.strip()
    if not rest.startswith('{'): continue
    seen += 1
    res, _, errs = rest.partition('} errors:')
    if errs: bad.append(f'{name}: page errors:{errs}'); res += '}'
    for frame, m in json.loads(res).items():
        if not m.get('still') and m.get('litPct', 0) < 5: bad.append(f'{name} {frame}: black frame ({m.get("litPct")}% lit)')
if not seen: bad.append('no scenario ran')
print('FAIL title   ' + '; '.join(bad) if bad else f'ok   title  {seen} devices and faults, none black')
EOF
}

{
  for c in "${cities[@]}"; do
    while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n; done
    run_city "$c" &
  done
  wait
  for r in "${reefs[@]}"; do run_reef "$r"; done
  [ $title -eq 1 ] && run_title
} | tee "$OUT/summary.txt"
! grep -q '^FAIL' "$OUT/summary.txt"
