#!/usr/bin/env bash
# The waits at a red in every city (tools/traffic_check.js), a few cities at a time, each city's
# figures appended as a line of JSON to $1 under the label $2 (before, after...):
#   tools/wait_sweep.sh /tmp/waits.jsonl before [seconds per place] [places]
# (CITIES="sydney osaka" for those only; PORT for another server)
set -u
cd "$(dirname "$0")/.."
OUTF=$1 LABEL=$2 SECS=${3:-150} PLACES=${4:-5} JOBS=${SWEEP_JOBS:-3}
export NODE_PATH=${NODE_PATH:-$(npm root -g 2>/dev/null)} WAITS_JSON=$OUTF WAITS_LABEL=$LABEL
LOG=$(dirname "$OUTF")
{ if [ -n "${CITIES:-}" ]; then printf "%s\n" $CITIES; else for f in web/data/*/game.json; do basename "$(dirname "$f")"; done; fi; } | \
  xargs -P "$JOBS" -I{} sh -c "xvfb-run -a node tools/traffic_check.js {} $SECS $PLACES > '$LOG/{}-$LABEL.log' 2>&1; echo {} \$(tail -1 '$LOG/{}-$LABEL.log')"
