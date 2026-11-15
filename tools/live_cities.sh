#!/usr/bin/env bash
# The maps with a game, less any parked one (cities/index.json "parked"): what the sweeps run over. There is
# one, shibuya. With --parked, the parked ones that have a game instead.
cd "$(dirname "$0")/.."
python3 -I - "${1:-}" <<'PY'
import glob, json, os, sys
parked = set(json.load(open('cities/index.json', encoding='utf8')).get('parked', []))
games = sorted(os.path.basename(os.path.dirname(f)) for f in glob.glob('web/data/*/game.json'))
want_parked = sys.argv[1] == '--parked'
print('\n'.join(c for c in games if (c in parked) == want_parked))
PY
