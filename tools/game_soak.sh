#!/usr/bin/env bash
# Whether the game check is deterministic (#420): runs tools/game_check.js for each city ROUNDS times, JOBS at a
# time (as tools/check.sh runs them, so under the same load), with DIGEST=1, and prints for each city its pass
# rate, the steps that failed, and whether every run played the same game: the digest of the traffic, the crowd,
# the lights, the ride, the weather and you at each screenshot, the same in every run. A city whose runs part
# names the first screenshot where they did, the place to look for what still reads the machine's clock or an
# unseeded random. The game's own result then depends on the simulation alone: a failure is the same in every
# run, a real one, and a pass passes on every machine.
#   tools/game_soak.sh                       # every live city, 3 rounds, 3 at a time
#   ROUNDS=5 JOBS=4 tools/game_soak.sh kyoto shibuya
#   PORT=8801 tools/game_soak.sh             # against a server of another tree (a worktree of main, for a before)
# Logs in $SOAK_OUT (default /tmp/oe-soak): <city>-<round>.log. GAME_TIME as tools/check.sh pins it.
set -u
cd "$(dirname "$0")/.."
ROUNDS=${ROUNDS:-3}
JOBS=${JOBS:-3}
PORT=${PORT:-8872}
OUT=${SOAK_OUT:-/tmp/oe-soak}
export GAME_TIME=${GAME_TIME:-2026-11-02T10:00}
export NODE_PATH=${NODE_PATH:-$(npm root -g 2>/dev/null)}
mkdir -p "$OUT"
CITIES=${*:-$(tools/live_cities.sh)}
started=
if ! curl -s -o /dev/null "http://localhost:$PORT/index.html"; then
  python3 -m http.server "$PORT" --directory web >"$OUT/server.log" 2>&1 &
  started=$!
  for _ in $(seq 50); do curl -s -o /dev/null "http://localhost:$PORT/index.html" && break; sleep 0.2; done
fi
trap '[ -n "$started" ] && kill $started 2>/dev/null' EXIT
export PORT
X=; command -v xvfb-run >/dev/null && X="xvfb-run -a"
one() { # city round
  DIGEST=1 timeout 2700 $X node tools/game_check.js "$1" "$OUT/$1-$2" >"$OUT/$1-$2.log" 2>&1
  echo "$1 $2 $?" >>"$OUT/rc.txt"
}
: >"$OUT/rc.txt"
# round by round, the cities of a round JOBS at a time
for r in $(seq "$ROUNDS"); do
  for c in $CITIES; do
    while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n; done
    one "$c" "$r" &
  done
done
wait
python3 -I - "$OUT" "$ROUNDS" $CITIES <<'PY'
import os, re, sys
out, rounds, cities = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
rc = {}
for line in open(os.path.join(out, 'rc.txt')):
    c, r, code = line.split(); rc[(c, int(r))] = int(code)
total_ok = total = 0
for c in cities:
    runs, fails, digs = [], {}, []
    for r in range(1, rounds + 1):
        try: log = open(os.path.join(out, f'{c}-{r}.log'), encoding='utf8', errors='replace').read()
        except OSError: log = ''
        code = rc.get((c, r), -1)
        runs.append(code == 0)
        for f in re.findall(r'^FAIL (.*)$', log, re.M): fails.setdefault(f[:90], set()).add(r)
        if code == 124: fails.setdefault('timed out', set()).add(r)
        digs.append(re.findall(r'^digest ([^:]+): (.*)$', log, re.M))
    n = sum(runs); total_ok += n; total += len(runs)
    parted = None
    for i in range(max(len(d) for d in digs)):
        row = [d[i] if i < len(d) else None for d in digs]
        if any(x != row[0] for x in row): parted = (row[0] or row[1] or ('?',))[0]; break
    lens = {len(d) for d in digs}
    same = 'the same game in every run' if parted is None and len(lens) == 1 else f'runs part at {parted}' if parted else 'runs stop at different steps'
    print(f"{c:14s} {n}/{len(runs)} passed; {same}")
    for f, rs in sorted(fails.items()): print(f"    FAIL in run {','.join(map(str, sorted(rs)))}: {f}")
print(f"all: {total_ok}/{total} runs passed")
PY
