#!/usr/bin/env bash
# Run tools/cluster_probe.js at several game times at once and print each run's summary (#330/#331):
#   tools/cluster_sweep.sh shinjuku [T=500] [times="08:00 10:00 13:00 18:00"] [jids] [R] [x,y]
cd "$(dirname "$0")/.."
city=${1:-shinjuku}; T=${2:-500}; times=${3:-"08:00 10:00 13:00 18:00"}; jids=${4:-1103,1105,1106,1108,1120}; R=${5:-300}; at=${6:-}
out=$(mktemp -d)
for t in $times; do GAME_TIME=$t xvfb-run -a node tools/cluster_probe.js "$city" "$T" "$jids" "$R" 100000 $at >"$out/$t.log" 2>&1 & done
wait
for t in $times; do echo "== $city $t"; grep -A6 "by the head" "$out/$t.log" | tail -n +2; grep "^cars let in" "$out/$t.log"; grep -A8 "on green, by why" "$out/$t.log"; grep "^longest\|^car-seconds" "$out/$t.log" | cut -c1-260; done
rm -rf "$out"
