#!/usr/bin/env bash
# The cities with a game, less the parked ones (cities/index.json "parked"): what tools/check.sh and
# the sweeps run over. With --parked, the parked ones that have a game instead.
cd "$(dirname "$0")/.."
python3 -I - "${1:-}" <<'PY'
import glob, json, os, sys
parked = set(json.load(open('cities/index.json', encoding='utf8')).get('parked', []))
games = sorted(os.path.basename(os.path.dirname(f)) for f in glob.glob('web/data/*/game.json'))
want_parked = sys.argv[1] == '--parked'
print('\n'.join(c for c in games if (c in parked) == want_parked))
PY
