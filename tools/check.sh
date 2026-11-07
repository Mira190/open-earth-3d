#!/usr/bin/env bash
# The checks to pass before work lands on main, in one command. It serves web/ on its own port
# and, for what the branch changed against origin/main (or for the targets named):
#   - plays each city's game headless (tools/game_check.js: walk, talk, helicopter, ferries,
#     your car, a taxi and a ride),
#     three cities at a time, under xvfb-run (llvmpipe) when it is installed; and then measures
#     what passes through what there (tools/clip_check.js: street furniture in the roads, cars
#     inside each other and inside posts, people inside cars and walls, ferries, seated heads);
#   - plays each city's guided tour in the model viewer (tools/tour_check.js: every stop in order,
#     an end card instead of a loop, no NaN or runaway highlight, no flat or flickering frame);
#   - checks that every city's buildings.bin, and each live city's other packs (landmarks, game, terrain, places, scene), is packed
#     from its JSON as it is now and decodes to the same values (pipeline/pack.py --check, tools/pack_check.js);
#   - checks that every shared model in web/assets is meshopt-compressed (pipeline/meshopt_glb.mjs --check);
#   - looks for signs whose words read mirrored in each city's built landmarks (tools/sign_check.py);
#   - reads every line the games' characters say, in every city and reef site, for talk about the
#     data or how the map was built (tools/voice_check.py: open data, PLATEAU, LiDAR, "rebuilt from"...);
#   - runs each reef site's scripted test (reef/index.html?gametest=1);
#   - runs the title screen on a tablet, a phone and a desktop and with WebGL faults injected
#     (tools/title_check.js), and fails a frame that ends black or a page that throws;
#   - opens Sydney's game and model and checks the hand-over from the loading screen
#     (tools/load_check.js): the 3D view must be drawn, not black, when the loader starts to fade.
# Prints one line per check and exits 1 if any failed. Logs and screenshots go to $CHECK_OUT.
# The games play at a pinned local hour (GAME_TIME, default 10:00 in each city's own time zone,
# tools/pin_clock.js), so that a run does not depend on the hour it is started at:
#   GAME_TIME=22:40 tools/check.sh osaka    # at another hour; GAME_TIME=live: the real clock
#   tools/check.sh                      # what this branch changed (committed or not); after a
#                                       # pass, only what changed since it (CHECK_FULL=1: all of it)
#   tools/check.sh sydney hardy-reef    # these cities and reef sites
#   tools/check.sh title                # the title screen only
#   tools/check.sh voice                # what the characters say only (it runs with every target)
#   tools/check.sh loader               # the loading screen's hand-over only
#   tools/check.sh telemetry            # the visitor and SLO events, and the game's save, only
#   tools/check.sh all                  # every city, every reef site and the title
# Parked cities (cities/index.json "parked", tools/live_cities.sh) are left out of every run, even
# when they changed or the shared code did; name one to check it anyway: tools/check.sh amsterdam
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-8870}
OUT=${CHECK_OUT:-/tmp/oe-check}
JOBS=${CHECK_JOBS:-3}
mkdir -p "$OUT"
export NODE_PATH=${NODE_PATH:-$(npm root -g 2>/dev/null)}

STAMP="$(git rev-parse --git-dir)/oe-check-pass"   # the commit of the last full pass, in this clone only
stamp() { [ $# -eq 0 ] && [ -z "$(git status --porcelain)" ] && git rev-parse HEAD >"$STAMP"; return 0; }
CITIES=$(tools/live_cities.sh)
PARKED=$(tools/live_cities.sh --parked)
REEFS=$(for d in web/data/*/; do d=$(basename "$d"); [ -f "web/data/$d/game.json" ] || [ ! -f "web/data/$d/scene.json" ] || echo "$d"; done)   # a reef site: its scene built, no city game
is_in() { printf '%s\n' $2 | grep -qx "$1"; }

cities=() reefs=() title=0 loader=0 voice=0 telemetry=0
add_city() { is_in "$1" "${cities[*]:-}" || cities+=("$1"); }
add_reef() { is_in "$1" "${reefs[*]:-}" || reefs+=("$1"); }
all_cities() { for c in $CITIES; do add_city "$c"; done; }
all_reefs() { for r in $REEFS; do add_reef "$r"; done; }

if [ $# -gt 0 ]; then
  for t in "$@"; do
    case "$t" in
      all) all_cities; all_reefs; title=1; loader=1; telemetry=1 ;;
      voice) voice=1 ;;
      title) title=1 ;;
      loader) loader=1 ;;
      telemetry) telemetry=1 ;;
      *) if is_in "$t" "$CITIES" || is_in "$t" "$PARKED"; then add_city "$t"
         elif is_in "$t" "$REEFS"; then add_reef "$t"
         else echo "unknown target: $t (cities: $(echo $CITIES); reef sites: $(echo $REEFS))"; exit 2; fi ;;
    esac
  done
else
  base=$(git merge-base origin/main HEAD 2>/dev/null) || { echo "no origin/main to compare with: git fetch origin main"; exit 2; }
  # After a pass, only what changed since then. A run with no targets that passes on a clean tree
  # stamps HEAD in $STAMP. When main moves on and is merged in again, the commit checked last is
  # still an ancestor of HEAD, and everything not yet checked (main's new commits, conflict fixes,
  # later work of the branch) is in the diff from it: a merge of main that only brought other
  # cities checks those cities, not all twenty. CHECK_FULL=1 compares with main as before.
  last=$(cat "$STAMP" 2>/dev/null)
  if [ -z "${CHECK_FULL:-}" ] && [ -n "$last" ] && git merge-base --is-ancestor "$last" HEAD 2>/dev/null \
     && ! git merge-base --is-ancestor "$last" "$base"; then
    echo "checking what changed since the last pass, $(git log -1 --format='%h %s' "$last" | cut -c1-70) (CHECK_FULL=1 for the whole branch)"
    base=$last
  fi
  changed=$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)
  for f in $changed; do
    case "$f" in
      cities/index.json|web/data/cities.json) title=1 ;;   # the globe's list of cities
      cities/*/*|web/data/*/*)
        id=${f#web/data/}; id=${id#cities/}; id=${id%%/*}   # the city or reef site: cities/<id>/..., web/data/<id>/...
        if is_in "$id" "$CITIES"; then add_city "$id"; elif is_in "$id" "$REEFS"; then add_reef "$id"; fi ;;
      web/reef/*) all_reefs ;;
      web/title.*|tools/title_*|web/earth.js|web/score.js|web/film.*|web/fonts.css) title=1 ;;
      web/telemetry.js|tools/telemetry_*|tools/slo_report.py) title=1; telemetry=1 ;;   # watches every page, sends nothing
      web/index.html|web/quality.js) all_cities; title=1; loader=1; telemetry=1 ;;
      web/plate.js|web/city.js|web/game/game.js|tools/load_check.js) all_cities; loader=1; telemetry=1 ;;
      web/game/*|web/assets/*|web/vendor/*|web/*.js|tools/game_check.js|tools/close_step.js|tools/clip_check.js|tools/tour_check.js|tools/sign_check.py|pipeline/kerbside.py|pipeline/japankit.py) all_cities ;;
      tools/voice_check.py|pipeline/game_text.py) voice=1 ;;   # the voice check alone (it runs with any target)
    esac
  done
fi

if [ ${#cities[@]} -eq 0 ] && [ ${#reefs[@]} -eq 0 ] && [ $title -eq 0 ] && [ $loader -eq 0 ] && [ $voice -eq 0 ] && [ $telemetry -eq 0 ]; then
  echo "nothing to check: no change to a city, a reef site, the game, the renderer or the title"
  stamp "$@"
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
export GAME_TIME=${GAME_TIME:-10:00}
X=; command -v xvfb-run >/dev/null && X="xvfb-run -a"

# The game's and the clip check's timing and traffic steps can miss under three cities' load at once
# on a software renderer (a taxi's drive-off, a ride's ETA, the brightness after a lost context, a car
# into a post), and pass when run alone (issue 84). Run in parallel (pass=load), a failure is put off
# to a rerun alone after the others (pass=alone), and only a failure alone fails; the run under load
# keeps its log as <city>-load.log
RETRY="$OUT/retry.txt"
: >"$RETRY"
game_step() {
  local c=$1 pass=$2 rc
  # (a big city's game, every step, takes up to about 35 minutes alone on a software renderer: Shibuya)
  timeout 2700 $X node tools/game_check.js "$c" "$OUT/$c" >"$OUT/$c.log" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then
    echo "ok   game   $c$([ "$pass" = alone ] && echo "   (alone, after failing under load: see $OUT/$c-load.log)")"
  elif [ "$pass" = load ]; then cp "$OUT/$c.log" "$OUT/$c-load.log"; echo "game $c" >>"$RETRY"
  elif [ $rc -eq 124 ]; then echo "FAIL game   $c   (timed out after 2700 s alone; see $OUT/$c.log)"
  else echo "FAIL game   $c   (see $OUT/$c.log; under load $OUT/$c-load.log)"; fi
}
clip_step() {
  local c=$1 pass=$2
  if timeout 1800 $X node tools/clip_check.js "$c" 40 "$OUT/$c-clip.json" >"$OUT/$c-clip.log" 2>&1; then
    echo "ok   clip   $c   ($(grep -c '^ok' "$OUT/$c-clip.log") measures within tolerance$([ "$pass" = alone ] && echo "; alone, after failing under load: see $OUT/$c-clip-load.log"))"
  elif [ "$pass" = load ]; then cp "$OUT/$c-clip.log" "$OUT/$c-clip-load.log"; echo "clip $c" >>"$RETRY"
  else echo "FAIL clip   $c   ($(grep '^FAIL' "$OUT/$c-clip.log" | head -2 | cut -c6-90 | paste -sd ';' -); see $OUT/$c-clip.log)"; fi
}
run_city() {
  local c=$1
  game_step "$c" load
  clip_step "$c" load
  # a big model's tour under a software renderer, three cities at a time, can take 20 minutes (Paris)
  timeout 1800 $X node tools/tour_check.js "$c" "$OUT/tour-$c" >"$OUT/tour-$c.log" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then echo "ok   tour   $c: $(tail -1 "$OUT/tour-$c.log" | sed 's/^[^:]*: //')"
  elif [ $rc -eq 124 ]; then echo "FAIL tour   $c   (timed out after 1800 s; see $OUT/tour-$c.log)"
  else echo "FAIL tour   $c   ($(grep -m1 '^FAIL' "$OUT/tour-$c.log" || tail -1 "$OUT/tour-$c.log"); see $OUT/tour-$c.log)"; fi
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
run_loader() {
  local m
  for m in play model; do
    if timeout 1200 $X node tools/load_check.js sydney "$OUT/load-$m" $m 1440x900 400 >"$OUT/load-$m.log" 2>&1; then
      echo "ok   loader $m: $(grep -o 'opened after [0-9.]* s' "$OUT/load-$m.log"), the view drawn as the loader fades"
    else echo "FAIL loader $m   ($(grep '^FAIL' "$OUT/load-$m.log" | head -1); see $OUT/load-$m.log)"; fi
  done
}
run_telemetry() {   # the visitor and SLO events end to end, and the game's save on leaving (tools/telemetry_check.js)
  if TPORT=$((PORT + 21)) timeout 1500 $X node tools/telemetry_check.js sydney "$OUT/telemetry" >"$OUT/telemetry.log" 2>&1; then
    echo "ok   telemetry  $(grep -c '^ok' "$OUT/telemetry.log") steps: views, loads, play time, frame rate, tour, spots, exit, crash, the SLO report, the save"
  else echo "FAIL telemetry  $(grep '^FAIL' "$OUT/telemetry.log" | head -2 | cut -c6-140 | paste -sd ';' -)   (see $OUT/telemetry.log)"; fi
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
  # a click opens a destination's card and a second goes in; Tokyo goes in only from its subway map
  if timeout 900 $X node tools/title_pick_check.js >"$OUT/title-pick.log" 2>&1; then
    echo "ok   title picks  $(grep -c ': ' "$OUT/title-pick.log") steps: card first, in on the second click, districts from the map"
  else echo "FAIL title picks  $(grep -E 'FAIL|Error' "$OUT/title-pick.log" | head -2 | cut -c1-140 | paste -sd ';' -)   (see $OUT/title-pick.log)"; fi
}

{
  # what the characters say, everywhere (tools/voice_check.py): locals, not the map's credits. A second or so.
  if python3 tools/voice_check.py >"$OUT/voice.log" 2>&1; then tail -1 "$OUT/voice.log"
  else echo "FAIL voice  $(grep '^FAIL' "$OUT/voice.log" | head -2 | cut -c6-140 | paste -sd ';' -)   (see $OUT/voice.log)"; fi
  # each city's packed buildings (buildings.bin, pipeline/pack.py) against its buildings.json: up to date,
  # and decoded by the browser's decoder (web/pack.js) to the same values. Ten seconds or so.
  if python3 pipeline/pack.py --check >"$OUT/pack.log" 2>&1 && node tools/pack_check.js >>"$OUT/pack.log" 2>&1; then
    echo "ok   pack   $(grep -c ' MB packed' "$OUT/pack.log") packs (buildings, landmarks, game, terrain, places, scene) up to date and decoded to their JSON"
  else echo "FAIL pack   $(grep '^FAIL' "$OUT/pack.log" | head -2 | cut -c6-140 | paste -sd ';' -)   (see $OUT/pack.log)"; fi
  # every shared model meshopt-compressed (pipeline/meshopt_glb.mjs, issue 148): a rebuilt one that missed the step
  if node pipeline/meshopt_glb.mjs --check web/assets/*/*.glb >"$OUT/meshopt.log" 2>&1; then tail -1 "$OUT/meshopt.log"
  else echo "FAIL meshopt $(grep '^FAIL' "$OUT/meshopt.log" | head -2 | cut -c6-140 | paste -sd ';' -)   (see $OUT/meshopt.log)"; fi
  # signs that read mirrored, in the built landmarks of the cities checked (tools/sign_check.py)
  if [ ${#cities[@]} -gt 0 ]; then
    if python3 tools/sign_check.py "${cities[@]}" >"$OUT/signs.log" 2>&1; then echo "ok   signs  ${#cities[@]} cities, every sign reads the right way round"
    else echo "FAIL signs  $(grep -v '^ok' "$OUT/signs.log" | head -2 | paste -sd ';' -)   (see $OUT/signs.log)"; fi
  fi
  for c in "${cities[@]}"; do
    while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n; done
    run_city "$c" &
  done
  wait
  while read -r step c; do "${step}_step" "$c" alone; done <"$RETRY"
  for r in "${reefs[@]}"; do run_reef "$r"; done
  [ $loader -eq 1 ] && run_loader
  [ $title -eq 1 ] && run_title
  [ $telemetry -eq 1 ] && run_telemetry
} | tee "$OUT/summary.txt"
grep -q '^FAIL' "$OUT/summary.txt" && exit 1
stamp "$@"
