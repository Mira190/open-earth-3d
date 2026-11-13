#!/usr/bin/env bash
# Stills of the reef and alpine sites through a day and a night, beside each site's first person (gameshot=npc), on a
# desktop and a phone: day, dusk, night with the moon up and night with no moon (docs/NIGHT.md). For before/after
# comparisons of the night look.
#   tools/reef_night.sh <out-dir> [site ...]        # default: lake-pukaki lake-tekapo milford-sound whitsundays
# The times are UTC; each site's night is its own (the moon's place follows the date and the site).
set -u
cd "$(dirname "$0")/.."
OUT=${1:?out dir}; shift
SITES=${*:-lake-pukaki lake-tekapo milford-sound whitsundays}
PORT=${PORT:-8800}
JOBS=${JOBS:-3}
export NODE_PATH=${NODE_PATH:-$(npm root -g)} PORT
mkdir -p "$OUT"
curl -s -o /dev/null "http://localhost:$PORT/reef/index.html" || { python3 -m http.server "$PORT" --directory web >/dev/null 2>&1 & sleep 1; }
# name and UTC time, by the site's longitude: NZ (UTC+13 in November) or Queensland (UTC+10)
times() {
  case "$1" in
    whitsundays|heron-island|green-island|hardy-reef|lady-elliot-island) off=3 ;;   # Queensland is 3 hours behind NZDT
    *) off=0 ;;
  esac
  sh() { date -u -d "$1 $off hours" +%Y-%m-%dT%H:%M:00Z; }
  echo "day $(sh '2026-11-12 23:00')"          # local noon-ish
  echo "dusk $(sh '2026-11-13 08:35')"
  echo "moon $(sh '2026-11-24 12:00')"         # the full moon high in the sky
  echo "nomoon $(sh '2026-11-12 12:22')"       # 01:22 NZDT, a thin moon long set
}
jobs_list=()
for s in $SITES; do
  while read -r name t; do
    for dev in desktop phone; do jobs_list+=("$s $name $t $dev"); done
  done < <(times "$s")
done
run() {
  set -- $1
  local s=$1 name=$2 t=$3 dev=$4 f="$OUT/$1-$2-$4.png"
  if [ "$dev" = phone ]; then W=390 H=844 DPR=1 MOBILE=1; else W=1440 H=900 DPR=1 MOBILE=; fi
  W=$W H=$H DPR=$DPR MOBILE=$MOBILE xvfb-run -a node tools/reef_shot.js "city=$s&still=1&gl=1&gameshot=npc&mute=1&time=$t${EXTRA:-}" "$f" 1500 0 >"$f.log" 2>&1
  echo "$f"
}
export -f run; export OUT
printf '%s\n' "${jobs_list[@]}" | xargs -P "$JOBS" -I{} bash -c 'run "{}"'
