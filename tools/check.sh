#!/usr/bin/env bash
# The checks to pass before work lands on main, in one command. It serves web/ on its own port
# and, for what the branch changed against origin/main (or for the targets named):
#   - plays each city's game headless (tools/game_check.js: walk, talk, helicopter, ferries,
#     your car, a taxi and a ride),
#   - plays each city's game on a phone's low tier (an iPhone emulated) and fails it over a memory budget
#     (tools/mem_check.js: the peak GPU memory and the settled JS heap, so an iPhone's tab is not killed),
#     three cities at a time, under xvfb-run (llvmpipe) when it is installed; and then measures
#     what passes through what there (tools/clip_check.js: street furniture in the roads, cars
#     inside each other and inside posts, people inside cars and walls, ferries, seated heads);
#   - plays each city's guided tour in the model viewer (tools/tour_check.js: every stop in order,
#     an end card instead of a loop, no NaN or runaway highlight, no flat or flickering frame);
#   - checks that every city's buildings.bin, and each live city's other packs (landmarks, game, terrain, places, scene), is packed
#     from its JSON as it is now and decodes to the same values (pipeline/pack.py --check, tools/pack_check.js);
#   - checks the visibility sweep against exact rays in every live city (tools/vis_unit.js), and that each one's
#     occluder raster (vis.bin, pipeline/visibility.py) is made from its buildings as they are (with the packs);
#   - checks that every live city's building solids are valid polygons on their decimetre grid (pipeline/solid_rings.py --check);
#   - checks that every shared model in web/assets is meshopt-compressed (pipeline/meshopt_glb.mjs --check);
#   - checks each fishing water's data against its city.json and plays its fights for balance
#     (pipeline/fishing.py --check, tools/fishing_sim.js; the game check fishes each spot);
#   - looks for signs whose words read mirrored in each city's built landmarks (tools/sign_check.py);
#   - checks each map's daily life (pipeline/life.py --check: people, ranks, places, sourced events, built);
#   - prices rides by each map's fares (tools/fares_check.js: the rules, and every live table stop to stop);
#   - reads every line the games' characters say, in every city and reef site, for talk about the
#     data or how the map was built (tools/voice_check.py: open data, PLATEAU, LiDAR, "rebuilt from"...);
#   - runs each reef site's scripted test (reef/index.html?gametest=1);
#   - runs the title screen on a tablet, a phone and a desktop and with WebGL faults injected
#     (tools/title_check.js), and fails a frame that ends black or a page that throws;
#   - checks the title's postcards (tools/postcards_check.js): the journey, every still and line, a menu
#     without them, and a postcard's link into the game;
#   - opens Sydney's game and model and checks the hand-over from the loading screen
#     (tools/load_check.js): the 3D view must be drawn, not black, when the loader starts to fade.
# Prints one line per check and exits 1 if any failed. Logs and screenshots go to $CHECK_OUT.
# The games play at a pinned local date and hour (GAME_TIME, default 2026-11-02T10:00 in each city's own time
# zone, tools/pin_clock.js), so that a run does not depend on the day or the hour it is started at:
#   GAME_TIME=22:40 tools/check.sh osaka    # at another hour; GAME_TIME=live: the real clock
#   tools/check.sh                      # what this branch changed (committed or not); after a
#                                       # pass, only what changed since it (CHECK_FULL=1: all of it)
#   tools/check.sh sydney hardy-reef    # these cities and reef sites
#   tools/check.sh title                # the title screen only
#   tools/check.sh voice                # what the characters say only (it runs with every target)
#   tools/check.sh loader               # the loading screen's hand-over only
#   tools/check.sh telemetry            # the visitor and SLO events, and the game's save, only
#   tools/check.sh all                  # every city, every reef site and the title
#   tools/check.sh static               # the checks that open no browser only (packs, voice, life, rings...)
#   tools/check.sh sydney:game          # one kind of a city's checks (game, clip, mem, tour; sydney:clip,mem)
#   tools/check.sh --plan               # print the targets a run would check, one a line, and stop
# Two tiers (docs/CHECKS.md). Before landing, the fast tier: a change to the shared code (the game, the
# renderer, the shared assets) plays the smoke cities ($CHECK_SMOKE) instead of every live city, and a
# change to a city's own files still checks that city in full. After landing, the full tier
# (CHECK_TIER=full) runs on main in GitHub Actions (.github/workflows/checks.yml), one city and kind
# a runner, and opens an issue labelled main-red when one fails:
#   CHECK_TIER=full tools/check.sh      # every live city for a change to the shared code, as before
#   CHECK_BASE=<commit> tools/check.sh  # what changed since that commit, not since origin/main
#   CHECK_STATIC=0 tools/check.sh ...   # without the checks that open no browser (a runner's shard)
# Parked cities (cities/index.json "parked", tools/live_cities.sh) are left out of every run, even
# when they changed or the shared code did; name one to check it anyway: tools/check.sh amsterdam
set -u
cd "$(dirname "$0")/.."
PORT=${PORT:-8870}
OUT=${CHECK_OUT:-/tmp/oe-check}
JOBS=${CHECK_JOBS:-3}
TIER=${CHECK_TIER:-fast}
KINDS="game clip mem tour"              # a city's checks, in the order they run
# the fast tier's cities for a change to the shared code, and what is played in each: of the live maps (AGENTS.md,
# "Tokyo and Sydney first"), Sydney's game and its tour in the viewer, and Shibuya, the heaviest one on a phone, for its
# memory; Shibuya's and Tokyo's games, half an hour each, play on main after landing
SMOKE=${CHECK_SMOKE:-sydney:game,tour shibuya:mem}
plan=0; [ "${1:-}" = --plan ] && { plan=1; shift; }
mkdir -p "$OUT"
export NODE_PATH=${NODE_PATH:-$(npm root -g 2>/dev/null)}

STAMP="$(git rev-parse --git-dir)/oe-check-pass$([ "$TIER" = full ] && echo -full)"   # the commit of this tier's last pass, in this clone only
stamp() { [ $# -eq 0 ] && [ -z "${CHECK_BASE:-}" ] && [ -z "$(git status --porcelain)" ] && git rev-parse HEAD >"$STAMP"; return 0; }
CITIES=$(tools/live_cities.sh)
PARKED=$(tools/live_cities.sh --parked)
REEFS=$(for d in web/data/*/; do d=$(basename "$d"); [ -f "web/data/$d/game.json" ] || [ ! -f "web/data/$d/scene.json" ] || echo "$d"; done)   # a reef site: its scene built, no city game
is_in() { printf '%s\n' $2 | grep -qx "$1"; }

cities=() reefs=() title=0 loader=0 voice=0 telemetry=0 shared= fish=0
declare -A want=()   # the kinds to run for each city
add_city() {   # a city, and the kinds of its checks to run (all of them when none is named)
  local c=$1 k
  is_in "$c" "${cities[*]:-}" || cities+=("$c")
  for k in ${2:-$KINDS}; do is_in "$k" "${want[$c]:-}" || want[$c]="${want[$c]:-} $k"; done
}
add_kinds() {   # city:kind,kind
  local c=${1%%:*} k
  for k in $(echo "${1#*:}" | tr ',' ' '); do is_in "$k" "$KINDS" || { echo "unknown kind: $k (kinds: $KINDS)"; exit 2; }; done
  is_in "$c" "$CITIES" || is_in "$c" "$PARKED" || { echo "unknown city: $c"; exit 2; }
  add_city "$c" "$(echo "${1#*:}" | tr ',' ' ')"
}
# a change to the shared code, and the kinds of checks it can break (all of them when none is named): every live
# city's in the full tier, the smoke cities' in the fast one (added after the loop)
shared_change() {
  local c k
  if [ "$TIER" = full ]; then for c in $CITIES; do add_city "$c" "${1:-}"; done
  else for k in ${1:-$KINDS}; do is_in "$k" "$shared" || shared="$shared $k"; done; fi
}
add_reef() { is_in "$1" "${reefs[*]:-}" || reefs+=("$1"); }
all_cities() { for c in $CITIES; do add_city "$c"; done; }
all_reefs() { for r in $REEFS; do add_reef "$r"; done; }

if [ $# -gt 0 ]; then
  for t in "$@"; do
    case "$t" in
      all) all_cities; all_reefs; title=1; loader=1; telemetry=1 ;;
      voice|static) voice=1 ;;
      *:*) add_kinds "$t" ;;
      title) title=1 ;;
      loader) loader=1 ;;
      telemetry) telemetry=1 ;;
      *) if is_in "$t" "$CITIES" || is_in "$t" "$PARKED"; then add_city "$t"
         elif is_in "$t" "$REEFS"; then add_reef "$t"
         else echo "unknown target: $t (cities: $(echo $CITIES); reef sites: $(echo $REEFS))"; exit 2; fi ;;
    esac
  done
else
  if [ -n "${CHECK_BASE:-}" ]; then base=$(git rev-parse --verify -q "$CHECK_BASE^{commit}") || { echo "CHECK_BASE=$CHECK_BASE is not a commit here"; exit 2; }
  else base=$(git merge-base origin/main HEAD 2>/dev/null) || { echo "no origin/main to compare with: git fetch origin main"; exit 2; }; fi
  # After a pass, only what changed since then. A run with no targets that passes on a clean tree
  # stamps HEAD in $STAMP. When main moves on and is merged in again, the commit checked last is
  # still an ancestor of HEAD, and everything not yet checked (main's new commits, conflict fixes,
  # later work of the branch) is in the diff from it: a merge of main that only brought other
  # cities checks those cities, not all twenty. CHECK_FULL=1 compares with main as before.
  last=$(cat "$STAMP" 2>/dev/null)
  if [ -z "${CHECK_FULL:-}" ] && [ -z "${CHECK_BASE:-}" ] && [ -n "$last" ] && git merge-base --is-ancestor "$last" HEAD 2>/dev/null \
     && ! git merge-base --is-ancestor "$last" "$base"; then
    echo "checking what changed since the last pass, $(git log -1 --format='%h %s' "$last" | cut -c1-70) (CHECK_FULL=1 for the whole branch)"
    base=$last
  fi
  changed=$( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)
  for f in $changed; do
    case "$f" in
      cities/index.json|web/data/cities.json) title=1 ;;   # the globe's list of cities
      cities/*/postcards.json|web/data/*/postcards/*|web/data/postcards.json|web/postcards.js|tools/postcards_*|tools/postcards.sh|pipeline/postcards.py) title=1 ;;   # the title's postcards (tools/postcards_check.js), not the cities' games
      cities/*/*|web/data/*/*)
        id=${f#web/data/}; id=${id#cities/}; id=${id%%/*}   # the city or reef site: cities/<id>/..., web/data/<id>/...
        if is_in "$id" "$CITIES"; then add_city "$id"; elif is_in "$id" "$REEFS"; then add_reef "$id"; fi ;;
      web/reef/*) all_reefs ;;
      web/title.js|web/earth.js) title=1; telemetry=1 ;;   # (the title screen's load stages: tools/telemetry_check.js)
      web/title.*|tools/title_*|web/score.js|web/film.*|web/fonts.css) title=1 ;;
      web/telemetry.js|tools/telemetry_*|tools/slo_*) title=1; telemetry=1 ;;   # watches every page, sends nothing
      web/index.html|web/quality.js) shared_change; title=1; loader=1; telemetry=1 ;;
      web/plate.js|web/city.js|web/game/game.js|tools/load_check.js) shared_change; loader=1; telemetry=1 ;;
      web/game/fishing.js|tools/fishing_*|pipeline/fishing.py)   # the cities with fishing spots only (docs/FISHING.md)
        if [ "$TIER" = full ]; then for id in $CITIES; do [ -f "web/data/$id/fishing.json" ] && add_city "$id"; done; else fish=1; fi ;;
      tools/game_check.js|tools/*_step.js|tools/*_walk.js|tools/npc_night.js|tools/ride_queue.js) shared_change game ;;   # a check's own script: that kind of check
      tools/clip_check.js) shared_change clip ;;
      tools/mem_check.js|tools/lean_check.js) shared_change mem ;;
      tools/tour_check.js) shared_change tour ;;
      tools/pin_clock.js) shared_change "game clip" ;;
      web/game/*|web/assets/*|web/vendor/*|web/*.js|tools/sign_check.py|pipeline/kerbside.py|pipeline/japankit.py) shared_change ;;
      tools/check.sh|tools/live_cities.sh|.github/workflows/checks.yml) voice=1 ;;   # the checks' own plumbing: the static ones, and the run itself
      tools/voice_check.py|pipeline/game_text.py) voice=1 ;;   # the voice check alone (it runs with any target)
    esac
  done
  if [ -n "$shared" ]; then   # of the smoke cities' kinds, those the change can break
    for t in $SMOKE; do
      k=$(for k in $(echo "${t#*:}" | tr ',' ' '); do is_in "$k" "$shared" && echo "$k"; done | paste -sd, -)
      [ -n "$k" ] && { add_kinds "${t%%:*}:$k"; smoked=1; }
    done
    # (when the smoke cities play none of the kinds changed, the first of them plays those)
    [ -n "${smoked:-}" ] || add_city "${SMOKE%%:*}" "$shared"
    echo "fast tier: the shared code changed, so the smoke cities play ($SMOKE); every live city plays on main after landing (CHECK_TIER=full for all of them here)" >&2
  fi
  if [ $fish -eq 1 ]; then   # the fast tier fishes one water
    for id in $CITIES; do [ -f "web/data/$id/fishing.json" ] && { add_city "$id" game; break; }; done
  fi
fi

if [ $plan -eq 1 ]; then   # the targets of this run, each one an argument to this script: a runner's shard
  [ "${CHECK_STATIC:-1}" != 0 ] && echo static
  for c in "${cities[@]}"; do
    rest=$(for k in $KINDS; do [ "$k" != game ] && is_in "$k" "${want[$c]}" && echo "$k"; done | paste -sd, -)
    is_in game "${want[$c]}" && echo "$c:game"
    [ -n "$rest" ] && echo "$c:$rest"
  done
  for r in "${reefs[@]}"; do echo "$r"; done
  [ $title -eq 1 ] && echo title; [ $loader -eq 1 ] && echo loader; [ $telemetry -eq 1 ] && echo telemetry
  exit 0
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
# the game's clock pinned to a date and an hour, not only an hour: the weather (weather.js, a hash of the date), the
# day's life and the traffic's trips all follow the date, so a pinned hour alone played another game each day (#420)
export GAME_TIME=${GAME_TIME:-2026-11-02T10:00}
X=; command -v xvfb-run >/dev/null && X="xvfb-run -a"

# The game's and the clip check's timing and traffic steps can miss under three cities' load at once
# on a software renderer (a taxi's drive-off, a ride's ETA, the brightness after a lost context, a car
# into a post), and pass when run alone (issue 84). Run in parallel (pass=load), a failure is put off
# to a rerun alone after the others (pass=alone), and only a failure alone fails; the run under load
# keeps its log as <city>-load.log
# A step that fails in one run and another step in the next is the check's own unsteadiness, not the change's: a
# change that breaks something breaks the same step both times. So a run fails on a step that failed twice (or on a
# run that ended without naming one: a crash, a timeout), and two runs with no failed step in common print FLAKY,
# pass, and are listed in $OUT/flaky.txt (on main, .github/workflows/checks.yml adds them to the issue labelled check-flaky)
RETRY="$OUT/retry.txt"
: >"$RETRY"
: >"$OUT/flaky.txt"
fails_of() { grep '^FAIL' "$1" 2>/dev/null | cut -c6- | sed 's/ *[(:].*//' | sort -u; }   # the failed steps' names, without their numbers
twice() {   # <kind> <city> <log under load> <log alone>: the verdict of the second run
  local same one two
  one=$(fails_of "$3"); two=$(fails_of "$4")
  same=$(comm -12 <(echo "$one") <(echo "$two") | grep . | head -3 | cut -c1-110 | paste -sd ';' -)
  if [ -n "$one" ] && [ -n "$two" ] && [ -z "$same" ]; then
    echo "FLAKY $1   $2   (no step failed twice; first: $(echo "$one" | head -2 | cut -c1-90 | paste -sd ';' -); then: $(echo "$two" | head -2 | cut -c1-90 | paste -sd ';' -))" | tee -a "$OUT/flaky.txt"
  else echo "FAIL $1   $2   (${same:-$(echo "$two" | head -2 | cut -c1-110 | paste -sd ';' -)}; see $4; the first run $3)"; fi
}
game_step() {
  local c=$1 pass=$2 rc
  # (a big city's game, every step, takes up to about 35 minutes alone on a software renderer: Shibuya)
  timeout 2700 $X node tools/game_check.js "$c" "$OUT/$c" >"$OUT/$c.log" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then
    echo "ok   game   $c$([ "$pass" = alone ] && echo "   (alone, after failing under load: see $OUT/$c-load.log)")"
  elif [ "$pass" = load ]; then cp "$OUT/$c.log" "$OUT/$c-load.log"; echo "game $c" >>"$RETRY"
  elif [ $rc -eq 124 ]; then echo "FAIL game   $c   (timed out after 2700 s alone; see $OUT/$c.log)"
  else twice game "$c" "$OUT/$c-load.log" "$OUT/$c.log"; fi
}
clip_step() {
  local c=$1 pass=$2
  if timeout 1800 $X node tools/clip_check.js "$c" 40 "$OUT/$c-clip.json" >"$OUT/$c-clip.log" 2>&1; then
    echo "ok   clip   $c   ($(grep -c '^ok' "$OUT/$c-clip.log") measures within tolerance$([ "$pass" = alone ] && echo "; alone, after failing under load: see $OUT/$c-clip-load.log"))"
  elif [ "$pass" = load ]; then cp "$OUT/$c-clip.log" "$OUT/$c-clip-load.log"; echo "clip $c" >>"$RETRY"
  else twice clip "$c" "$OUT/$c-clip-load.log" "$OUT/$c-clip.log"; fi
}
# the game on a phone's low tier (an iPhone emulated, quality.js lean) must stay inside the memory budget, so an
# iPhone's tab is not killed (issue: Shibuya's "A problem repeatedly occurred", docs/PERFORMANCE.md "On a phone").
# tools/mem_check.js opens #play-<city> as an iPhone, plays, and reads the peak GPU memory and the settled JS heap
mem_step() {
  local c=$1
  if timeout 1800 $X node tools/mem_check.js "$c" >"$OUT/$c-mem.log" 2>&1; then
    echo "ok   mem    $c   ($(grep -o 'GPU peak [0-9]* MB' "$OUT/$c-mem.log" | head -1), $(grep -o '[0-9]* at the end after a collection' "$OUT/$c-mem.log" | head -1) heap)"
  else echo "FAIL mem    $c   ($(grep -o 'over [0-9]*' "$OUT/$c-mem.log" | paste -sd ';' - | head -c120); see $OUT/$c-mem.log)"; fi
  # and a phone whose load died comes back one level lighter, to its first frame (tools/lean_check.js, issue 443)
  if timeout 1200 $X node tools/lean_check.js "$c" >"$OUT/$c-lean.log" 2>&1; then
    echo "ok   lean   $c   (a load after a death is one level lighter, twice, and reaches its first frame)"
  else echo "FAIL lean   $c   ($(grep -m1 '^FAIL' "$OUT/$c-lean.log" | cut -c1-140); see $OUT/$c-lean.log)"; fi
}
tour_step() {
  local c=$1 rc
  # a big model's tour under a software renderer, three cities at a time, can take 20 minutes (Paris)
  timeout 1800 $X node tools/tour_check.js "$c" "$OUT/tour-$c" >"$OUT/tour-$c.log" 2>&1; rc=$?
  if [ $rc -eq 0 ]; then echo "ok   tour   $c: $(tail -1 "$OUT/tour-$c.log" | sed 's/^[^:]*: //')"
  elif [ $rc -eq 124 ]; then echo "FAIL tour   $c   (timed out after 1800 s; see $OUT/tour-$c.log)"
  else echo "FAIL tour   $c   ($(grep -m1 '^FAIL' "$OUT/tour-$c.log" || tail -1 "$OUT/tour-$c.log"); see $OUT/tour-$c.log)"; fi
}
run_city() {   # the kinds wanted of this city's checks, one after the other
  local c=$1 k
  for k in $KINDS; do
    is_in "$k" "${want[$c]}" || continue
    case $k in game) game_step "$c" load ;; clip) clip_step "$c" load ;; mem) mem_step "$c" ;; tour) tour_step "$c" ;; esac
  done
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
  # the postcards: the journey over six weeks, the stills and the index, then a menu without them and a card's link
  if timeout 1500 $X node tools/postcards_check.js >"$OUT/postcards.log" 2>&1; then
    echo "ok   postcards  $(grep -c ': ok' "$OUT/postcards.log") steps: the journey, the stills, none on the menu, a card's link into the game"
  else echo "FAIL postcards  $(grep -E 'FAIL|Error' "$OUT/postcards.log" | head -2 | cut -c1-140 | paste -sd ';' -)   (see $OUT/postcards.log)"; fi
}

{
  if [ "${CHECK_STATIC:-1}" != 0 ]; then
  # what the characters say, everywhere (tools/voice_check.py): locals, not the map's credits. A second or so.
  if python3 tools/voice_check.py >"$OUT/voice.log" 2>&1; then tail -1 "$OUT/voice.log"
  else echo "FAIL voice  $(grep '^FAIL' "$OUT/voice.log" | head -2 | cut -c6-140 | paste -sd ';' -)   (see $OUT/voice.log)"; fi
  # each live map's daily life (cities/<id>/life.json, pipeline/life.py): its people are the map's, five ranks each with a
  # fact, its places inside the map, its events sourced, and web/data/<id>/life.json built from it as it is now
  if python3 pipeline/life.py --check >"$OUT/life.log" 2>&1; then echo "ok   life   $(ls cities/*/life.json | wc -l) maps' daily life checked and built"
  else echo "FAIL life   $(grep -v '^FAIL' "$OUT/life.log" | head -2 | cut -c1-140 | paste -sd ';' -)   (see $OUT/life.log)"; fi
  # what a ride costs (web/game/fares.js): the rules on trips with known answers, and each live map's table priced
  # between every pair of its stops. A second.
  if node tools/fares_check.js >"$OUT/fares.log" 2>&1; then tail -1 "$OUT/fares.log"
  else echo "FAIL fares  $(grep '^FAIL' "$OUT/fares.log" | head -2 | cut -c6-140 | paste -sd ';' -)   (see $OUT/fares.log)"; fi
  # each city's packed buildings (buildings.bin, pipeline/pack.py) against its buildings.json: up to date,
  # and decoded by the browser's decoder (web/pack.js) to the same values. Ten seconds or so.
  if python3 pipeline/pack.py --check >"$OUT/pack.log" 2>&1 && node tools/pack_check.js >>"$OUT/pack.log" 2>&1; then
    echo "ok   pack   $(grep -c ' MB packed' "$OUT/pack.log") packs (buildings, landmarks, game, terrain, places, scene) up to date and decoded to their JSON"
  else echo "FAIL pack   $(grep '^FAIL' "$OUT/pack.log" | head -2 | cut -c6-140 | paste -sd ';' -)   (see $OUT/pack.log)"; fi
  # fishing (docs/FISHING.md): each city's fishing.json and game.json pointer as pipeline/fishing.py writes them
  # from city.json now, and the rules' balance (tools/fishing_sim.js: three players against every species). Seconds.
  if python3 pipeline/fishing.py --check >"$OUT/fishing.log" 2>&1 && node tools/fishing_sim.js >>"$OUT/fishing.log" 2>&1; then
    echo "ok   fishing  $(ls web/data/*/fishing.json | wc -l | tr -d ' ') waters' data up to date, and the fights balanced"
  else echo "FAIL fishing  $(grep -E 'FAIL|stale' "$OUT/fishing.log" | head -2 | cut -c1-140 | paste -sd ';' -)   (see $OUT/fishing.log)"; fi
  # the visibility sweep (web/visibility-sweep.js over each live city's vis.bin, issue 358) against exact rays:
  # nothing a ray reaches may be reported hidden. Half a minute.
  if EYES=12 node tools/vis_unit.js >"$OUT/vis.log" 2>&1; then echo "ok   vis    $(grep -c '^ok' "$OUT/vis.log") live cities: the sweep hides nothing an exact ray reaches"
  else echo "FAIL vis    $(grep -E '^FAIL|Error' "$OUT/vis.log" | head -2 | cut -c6-160 | paste -sd ';' -)   (see $OUT/vis.log)"; fi
  # every live city's solids valid on the decimetre grid they are stored on (pipeline/solid_rings.py): else the browser
  # draws one shape and the collision tests another, and a walker or a helicopter stands inside a drawn block
  if python3 pipeline/solid_rings.py --check $(bash tools/live_cities.sh) >"$OUT/rings.log" 2>&1; then
    echo "ok   rings  $(grep -c '^ok' "$OUT/rings.log") live cities' solids valid on their grid"
  else echo "FAIL rings  $(grep '^FAIL' "$OUT/rings.log" | head -2 | cut -c6-140 | paste -sd ';' -)   (see $OUT/rings.log)"; fi
  # every shared model meshopt-compressed (pipeline/meshopt_glb.mjs, issue 148): a rebuilt one that missed the step
  if node pipeline/meshopt_glb.mjs --check web/assets/*/*.glb >"$OUT/meshopt.log" 2>&1; then tail -1 "$OUT/meshopt.log"
  else echo "FAIL meshopt $(grep '^FAIL' "$OUT/meshopt.log" | head -2 | cut -c6-140 | paste -sd ';' -)   (see $OUT/meshopt.log)"; fi
  # the parts of the shared models loaded before playable and after (pipeline/split_glb.mjs, issue 335): as their model
  # splits now, so a rebuilt model can't leave the pages loading old parts of it
  mkdir -p "$OUT/parts"
  if python3 pipeline/meshopt.py split web/assets/vehicles/cars.glb web/assets/trees/trees.glb --out "$OUT/parts" >"$OUT/parts.log" 2>&1 \
    && for p in "$OUT"/parts/*.glb; do cmp -s "$p" "web/assets/$(case $(basename "$p") in cars*) echo vehicles;; *) echo trees;; esac)/$(basename "$p")" || { echo "FAIL $(basename "$p") is not its model's part: python3 pipeline/meshopt.py split web/assets/*/<model>.glb" >>"$OUT/parts.log"; false; }; done; then
    echo "ok   parts  $(ls "$OUT"/parts/*.glb | wc -l) parts of the shared models up to date"
  else echo "FAIL parts  $(grep '^FAIL' "$OUT/parts.log" | head -2 | cut -c6-140 | paste -sd ';' -)   (see $OUT/parts.log)"; fi
  # signs that read mirrored, in the built landmarks of the cities checked (tools/sign_check.py): every live city's
  # when no city is named (the static checks alone)
  signs=("${cities[@]}"); [ ${#signs[@]} -eq 0 ] && signs=($CITIES)
  if python3 tools/sign_check.py "${signs[@]}" >"$OUT/signs.log" 2>&1; then echo "ok   signs  ${#signs[@]} cities, every sign reads the right way round"
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
