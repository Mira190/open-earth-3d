#!/usr/bin/env bash
# The checks to pass before work lands on main, in one command (docs/CHECKS.md). The project is one story on
# one map (Blue Hour, at the Shibuya Scramble), so there is one page to check. For what the branch changed
# against origin/main (or for the targets named) it runs:
#   static  the checks that open no browser, a minute or two together:
#           - what the characters and the story say (tools/voice_check.py: locals, not the map's credits);
#           - the map's lines and quests played to the last stamp without a browser (tools/goals_check.js);
#           - the packs (buildings, landmarks, game, terrain, places, scene .bin, vis.bin, skyvis.webp and the phone's
#             district d/) made from their JSON as it is now and decoded to the same values
#             (pipeline/pack.py --check, tools/pack_check.js);
#           - the visibility sweep against exact rays (tools/vis_unit.js);
#           - the frame-time governor on modelled devices (tools/governor_unit.js);
#           - the building solids valid polygons on their decimetre grid (pipeline/solid_rings.py --check);
#           - no landmark hanging in the air (tools/float_check.py), no sign or screen behind another landmark
#             (tools/sign_clear.py), no sign reading mirrored (tools/sign_check.py);
#           - the far crowd's copy of the cast (pipeline/crowd_cast.py --check);
#           - every shared model meshopt-compressed and its parts up to date (pipeline/meshopt_glb.mjs, meshopt.py split);
#   story   the episode played frame by frame to its last card in a browser (tools/story_play.js): the street runs, the Stop
#           comes, the afterimage speaks, the photograph is taken, the world runs on, the last card;
#   mem     the page as an iPhone on the low tier, inside the memory budget (tools/mem_check.js);
#   clip    what passes through what in the free game, ?walk=1 (tools/clip_check.js);
#   gl      the map as an ordinary device opens it: no WebGL call refused, and every material drawn on a GPU with
#           sixteen texture units (tools/gl_error_probe.js, tools/sampler_probe.js);
#   touch   the free game played by touch on a phone's page (tools/touch_check.js);
#   astc    the device-side ASTC encoder against a real decoder (tools/astc_check.js);
#   game    the free game's long scenario (tools/game_check.js: walk, talk, helicopter, car, taxi, trains). It was
#           written for the game before the story and has not been run since the cut-back, so it runs by name only.
# Prints one line per check and exits 1 if any failed. Logs and stills go to $CHECK_OUT.
#   tools/check.sh                      # the fast tier: static, and story and mem when the page or the map changed;
#                                       # after a pass, only what changed since it (CHECK_FULL=1: the whole branch)
#   tools/check.sh static               # the checks that open no browser only
#   tools/check.sh story                # the story only (story mem, shibuya:clip,mem ...: several)
#   tools/check.sh all                  # static story mem clip gl touch astc
#   tools/check.sh --plan               # print the targets a run would check, one a line, and stop
#   CHECK_TIER=full tools/check.sh      # as main runs it after landing (.github/workflows/checks.yml): clip, gl and touch too
#   CHECK_BASE=<commit> tools/check.sh  # what changed since that commit, not since origin/main
#   CHECK_STATIC=0 tools/check.sh ...   # without the static checks (a runner's shard)
#   GAME_TIME=22:40 tools/check.sh clip # the free game's clock pinned to another hour (tools/pin_clock.js; live: the real clock)
set -u
cd "$(dirname "$0")/.."
MAP=shibuya
PORT=${PORT:-8870}
OUT=${CHECK_OUT:-/tmp/oe-check}
TIER=${CHECK_TIER:-fast}
KINDS="story mem clip gl touch astc game"   # the browser checks, in the order they run
ALL="story mem clip gl touch astc"          # "all", and the most the full tier selects: not the game check (see above)
plan=0; [ "${1:-}" = --plan ] && { plan=1; shift; }
mkdir -p "$OUT"
export NODE_PATH=${NODE_PATH:-$(npm root -g 2>/dev/null)}
# (macOS has no timeout: there a check runs for as long as it takes)
command -v timeout >/dev/null || timeout() { shift; "$@"; }

STAMP="$(git rev-parse --git-dir)/oe-check-pass$([ "$TIER" = full ] && echo -full)"   # the commit of this tier's last pass, in this clone only
stamp() { [ $# -eq 0 ] && [ -z "${CHECK_BASE:-}" ] && [ -z "$(git status --porcelain)" ] && git rev-parse HEAD >"$STAMP"; return 0; }
is_in() { printf '%s\n' $2 | grep -qx "$1"; }

static=0 want=
add() { local k; for k in "$@"; do is_in "$k" "$KINDS" || { echo "unknown target: $k (targets: static $KINDS all)"; exit 2; }; is_in "$k" "$want" || want="$want $k"; done; }

if [ $# -gt 0 ]; then
  for t in "$@"; do
    case "$t" in
      all) static=1; add $ALL ;;
      static|voice) static=1 ;;
      "$MAP") add story mem clip ;;
      "$MAP":*) add $(echo "${t#*:}" | tr ',' ' ') ;;   # (the map's name before a kind, as the shards were named: shibuya:clip,mem)
      *) add $(echo "$t" | tr ',' ' ') ;;
    esac
  done
else
  if [ -n "${CHECK_BASE:-}" ]; then base=$(git rev-parse --verify -q "$CHECK_BASE^{commit}") || { echo "CHECK_BASE=$CHECK_BASE is not a commit here"; exit 2; }
  else base=$(git merge-base origin/main HEAD 2>/dev/null) || { echo "no origin/main to compare with: git fetch origin main"; exit 2; }; fi
  # After a pass, only what changed since then. A run with no targets that passes on a clean tree stamps HEAD in
  # $STAMP; when main moves on and is merged in again, everything not yet checked is in the diff from that commit.
  last=$(cat "$STAMP" 2>/dev/null)
  if [ -z "${CHECK_FULL:-}" ] && [ -z "${CHECK_BASE:-}" ] && [ -n "$last" ] && git merge-base --is-ancestor "$last" HEAD 2>/dev/null \
     && ! git merge-base --is-ancestor "$last" "$base"; then
    echo "checking what changed since the last pass, $(git log -1 --format='%h %s' "$last" | cut -c1-70) (CHECK_FULL=1 for the whole branch)" >&2
    base=$last
  fi
  page() { add story mem; [ "$TIER" = full ] && add clip gl touch; return 0; }   # the page or the map changed
  for f in $( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u); do
    case "$f" in
      web/astc.js|web/astc-worker.js|tools/astc_check.js) static=1; add astc ;;
      web/data/$MAP/d/*|pipeline/district.py|tools/mem_check.js) static=1; add mem ;;   # what a phone loads
      tools/story_play.js|tools/story_play.js|tools/start_play.js) static=1; add story ;;
      tools/clip_check.js|tools/pin_clock.js) static=1; add clip ;;
      tools/touch_check.js) static=1; add touch ;;
      tools/gl_error_probe.js|tools/sampler_probe.js) static=1; add gl ;;
      web/*|cities/*) static=1; page ;;
      tools/*|pipeline/*|blender/*|.github/*|requirements.txt) static=1 ;;   # the checks' own plumbing and the build: the static ones
    esac
  done
fi

if [ $plan -eq 1 ]; then   # the targets of this run, each one an argument to this script: a runner's shard
  [ $static -eq 1 ] && [ "${CHECK_STATIC:-1}" != 0 ] && echo static
  for k in $want; do echo "$k"; done
  exit 0
fi

if [ $static -eq 0 ] && [ -z "$want" ]; then
  echo "nothing to check: no change to the page, the map, the build or the checks"
  stamp "$@"
  exit 0
fi

started=
if [ -n "$want" ] && ! curl -s -o /dev/null "http://localhost:$PORT/index.html"; then
  python3 -m http.server "$PORT" --directory web >"$OUT/server.log" 2>&1 &
  started=$!
  for _ in $(seq 50); do curl -s -o /dev/null "http://localhost:$PORT/index.html" && break; sleep 0.2; done
fi
trap '[ -n "$started" ] && kill $started 2>/dev/null' EXIT
export PORT
# the free game's clock pinned to a date and an hour (tools/pin_clock.js): the weather is a hash of the date and the
# traffic follows the hour, so a run does not depend on when it is started
export GAME_TIME=${GAME_TIME:-2026-11-02T10:00}
X=; command -v xvfb-run >/dev/null && X="xvfb-run -a"

# A change that breaks something breaks the same step every time. So when the clip or the game check fails it is run
# a second time, and the run fails only on a step that failed both times (or on a run that named none: a crash, a
# timeout). Two runs with no failed step in common print FLAKY, pass, and are listed in $OUT/flaky.txt (on main,
# .github/workflows/checks.yml adds them to the issue labelled check-flaky)
: >"$OUT/flaky.txt"
fails_of() { grep '^FAIL' "$1" 2>/dev/null | cut -c6- | sed 's/ *[(:].*//' | sort -u; }   # the failed steps' names, without their numbers
twice() {   # <kind> <first log> <second log>: the verdict of the second run
  local same one two
  one=$(fails_of "$2"); two=$(fails_of "$3")
  same=$(comm -12 <(echo "$one") <(echo "$two") | grep . | head -3 | cut -c1-110 | paste -sd ';' -)
  if [ -n "$one" ] && [ -n "$two" ] && [ -z "$same" ]; then
    echo "FLAKY $1   (no step failed twice; first: $(echo "$one" | head -2 | cut -c1-90 | paste -sd ';' -); then: $(echo "$two" | head -2 | cut -c1-90 | paste -sd ';' -))" | tee -a "$OUT/flaky.txt"
  else echo "FAIL $1   (${same:-$(echo "$two" | head -2 | cut -c1-110 | paste -sd ';' -)}; see $3; the first run $2)"; fi
}
run_story() {   # on a small page: a software renderer draws the stopped world's grade slowly
  if LIMIT=3000 timeout 3600 $X node tools/story_play.js "$OUT/story" 800x500 >"$OUT/story.log" 2>&1; then echo "ok   story  the episode plays through its seven frames to the last card"
  else echo "FAIL story  $(grep '^FAIL\|pageerror' "$OUT/story.log" | head -2 | cut -c1-160 | paste -sd ';' -)   (see $OUT/story.log)"; fi
}
# the page on a phone's low tier (an iPhone emulated, quality.js lean) must stay inside the memory budget, so that
# an iPhone's tab is not killed (docs/PERFORMANCE.md, "On a phone")
run_mem() {
  if timeout 1800 $X node tools/mem_check.js "$MAP" >"$OUT/mem.log" 2>&1; then
    echo "ok   mem    $(grep -o 'GPU peak [0-9]* MB' "$OUT/mem.log" | head -1), $(grep -o '[0-9]* at the end after a collection' "$OUT/mem.log" | head -1) heap"
  else echo "FAIL mem    $(grep -o 'over [0-9]*' "$OUT/mem.log" | paste -sd ';' - | head -c120)   (see $OUT/mem.log)"; fi
}
run_clip() {
  if timeout 1800 $X node tools/clip_check.js "$MAP" 40 "$OUT/clip.json" >"$OUT/clip.log" 2>&1; then echo "ok   clip   $(grep -c '^ok' "$OUT/clip.log") measures within tolerance"; return; fi
  cp "$OUT/clip.log" "$OUT/clip-first.log"
  if timeout 1800 $X node tools/clip_check.js "$MAP" 40 "$OUT/clip.json" >"$OUT/clip.log" 2>&1; then echo "ok   clip   $(grep -c '^ok' "$OUT/clip.log") measures within tolerance   (the second run; the first: $OUT/clip-first.log)"
  else twice clip "$OUT/clip-first.log" "$OUT/clip.log"; fi
}
run_game() {   # (every step takes about half an hour on a software renderer)
  if timeout 2700 $X node tools/game_check.js "$MAP" "$OUT/game" >"$OUT/game.log" 2>&1; then echo "ok   game   $(grep -c '^ok' "$OUT/game.log") steps of the free game"; return; fi
  cp "$OUT/game.log" "$OUT/game-first.log"
  if timeout 2700 $X node tools/game_check.js "$MAP" "$OUT/game" >"$OUT/game.log" 2>&1; then echo "ok   game   $(grep -c '^ok' "$OUT/game.log") steps of the free game   (the second run; the first: $OUT/game-first.log)"
  else twice game "$OUT/game-first.log" "$OUT/game.log"; fi
}
run_gl() {   # the governor's extras shed from the first frame, the scene multisampled, the ladder walked, every WebGL call asked for its error
  if START=0.8/0.5 Q=msaa=on WALK=1 timeout 1800 $X node tools/gl_error_probe.js "$MAP" >"$OUT/gl.log" 2>&1; then
    echo "ok   gl     opened with the extras shed and multisampling on, the ladder walked: WebGL refused no call"
  else echo "FAIL gl     $(grep -o '"call":"[^"]*"' "$OUT/gl.log" | head -2 | cut -c9-160 | paste -sd ';' -)   (see $OUT/gl.log)"; fi
  # the same map as a GPU with sixteen texture units in a fragment shader (Apple's, most phones'; the software
  # renderer has 32): every program that does not link there is compiled again with less until it does
  if Q=units=16 timeout 1800 $X node tools/sampler_probe.js "$MAP" >"$OUT/units.log" 2>&1; then
    echo "ok   gl     as a 16-unit GPU every material drawn$(grep -o 'goes without: .*' "$OUT/units.log" | sed 's/^/, /')"
  else echo "FAIL gl     as a 16-unit GPU a material is left undrawn: $(tail -3 "$OUT/units.log" | head -1 | cut -c1-200)   (see $OUT/units.log)"; fi
}
run_touch() {
  if timeout 1500 $X node tools/touch_check.js "$MAP" "$OUT/touch" >"$OUT/touch.log" 2>&1; then
    echo "ok   touch  $(grep -c '^ok' "$OUT/touch.log") steps on a phone's page"
  else echo "FAIL touch  $(grep '^FAIL' "$OUT/touch.log" | head -2 | cut -c6-140 | paste -sd ';' -)   (see $OUT/touch.log)"; fi
}
run_astc() {   # SwiftShader decodes ASTC; Mesa's llvmpipe offers none, so without a display
  if timeout 600 env -u DISPLAY node tools/astc_check.js >"$OUT/astc.log" 2>&1; then
    echo "ok   astc   $(grep -c '^ok' "$OUT/astc.log") pictures encoded on the page and decoded by the GPU, none under the floor"
  else echo "FAIL astc   $(grep '^FAIL' "$OUT/astc.log" | head -2 | cut -c6-140 | paste -sd ';' -)   (see $OUT/astc.log)"; fi
}
# one static check: <name> <log> <what a pass says, or - for the log's last line> <the lines of a failure to show> <command...>
st() {
  local name=$1 log="$OUT/$2.log" ok=$3 pat=$4; shift 4
  if "$@" >"$log" 2>&1; then [ "$ok" = - ] && tail -1 "$log" || printf 'ok   %-8s %s\n' "$name" "$ok"
  else printf 'FAIL %-8s %s   (see %s)\n' "$name" "$(grep -E "$pat" "$log" | head -2 | cut -c1-150 | paste -sd ';' -)" "$log"; fi
}
parts() {   # the parts of the shared models loaded before playable and after, as their model splits now
  local p dir
  rm -rf "$OUT/parts"; mkdir -p "$OUT/parts"
  python3 pipeline/meshopt.py split web/assets/vehicles/cars.glb web/assets/trees/trees.glb --out "$OUT/parts" || return 1
  for p in "$OUT"/parts/*.glb; do
    case $(basename "$p") in cars*) dir=vehicles ;; *) dir=trees ;; esac
    cmp -s "$p" "web/assets/$dir/$(basename "$p")" || { echo "FAIL $(basename "$p") is not its model's part: python3 pipeline/meshopt.py split web/assets/$dir/<model>.glb"; return 1; }
  done
}

{
  if [ $static -eq 1 ] && [ "${CHECK_STATIC:-1}" != 0 ]; then
    st voice voice - '^FAIL' python3 tools/voice_check.py
    st goals goals - '^FAIL' node tools/goals_check.js
    st pack pack "the packs up to date" '^FAIL' python3 pipeline/pack.py --check
    st pack pack_decode "the packs decode to their JSON" '^FAIL|Error' node tools/pack_check.js
    st vis vis "the sweep hides nothing an exact ray reaches" '^FAIL|Error' env EYES=12 node tools/vis_unit.js
    st governor governor "a device at its limit settles, gives way and comes back" '^FAIL' node tools/governor_unit.js
    st rings rings "the solids valid on their grid" '^FAIL|Error' python3 pipeline/solid_rings.py --check "$MAP"
    st float float "every landmark stands on something" '^FLOATS|Error' python3 tools/float_check.py "$MAP"
    st signs signclear "no sign or screen behind another landmark" '^COVERED|Error' python3 tools/sign_clear.py "$MAP"
    st signs signs "every sign reads the right way round" '^[^o]' python3 tools/sign_check.py "$MAP"
    st crowd crowd_cast - '^FAIL|Error' python3 pipeline/crowd_cast.py --check
    st meshopt meshopt - '^FAIL|Error' node pipeline/meshopt_glb.mjs --check web/assets/*/*.glb
    st parts parts "the parts of the shared models up to date" '^FAIL|Error' parts
  fi
  for k in $KINDS; do is_in "$k" "$want" && "run_$k"; done
} | tee "$OUT/summary.txt"
grep -q '^FAIL' "$OUT/summary.txt" && exit 1
stamp "$@"
