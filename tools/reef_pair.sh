#!/usr/bin/env bash
# Stills of a reef or alpine site from two builds side by side, for a change that should not alter the picture:
# the same shots (each site's city.json "shots", or its start), at day and dusk, on a desktop and a phone, from this
# tree (port $PORT, default 8800) and another (port $BASE_PORT, e.g. a worktree of origin/main served on 8802), and the
# share of pixels that differ by more than 8 of 255. WebGL2 (gl=1) unless GPU=1 (WebGPU on SwiftShader, slower).
#   tools/reef_pair.sh out_dir milford-sound:postcard lake-pukaki:lookout whitsundays: ...
set -u
OUT=$1; shift; mkdir -p "$OUT"
export NODE_PATH=${NODE_PATH:-$(npm root -g)}
for spec in "$@"; do
  site=${spec%%:*}; shot=${spec#*:}
  pose=$(python3 - "$site" "$shot" <<'P'
import json, sys
c = json.load(open(f'cities/{sys.argv[1]}/city.json')); s = next((v for v in c.get('shots', []) if v['id'] == sys.argv[2]), None) or c.get('start') or {}
print('&'.join(f'{k}={s[k]}' for k in ('x', 'y', 'z', 'yaw', 'pitch', 'fov') if s.get(k) is not None))
P
)
  for tod in day dusk; do
    # day: 11:30 local; dusk: the sun a few degrees down (the site's own clock: Sun.site in main.js; NZ and QLD offsets)
    case "$site" in lake-*|milford-*) off=13 ;; *) off=10 ;; esac
    if [ $tod = day ]; then h=$(( (11 - off + 24) % 24 )); else h=$(( (20 - off + 24) % 24 )); fi
    time=$(printf '2026-11-06T%02d:30:00Z' $h)
    for dev in desktop phone; do
      if [ $dev = desktop ]; then sz="W=1440 H=900"; else sz="W=390 H=844 DPR=2 MOBILE=1"; fi
      q="still=1&freeze=5&mute=1&city=$site&$pose&time=$time&mods=$( [ -f web/data/$site/far.json ] && grep -q alpine cities/$site/city.json && echo alpine/flora,alpine/landmarks,boats || echo life,boats)$( [ "${GPU:-0}" = 1 ] || echo '&gl=1')"
      n="$OUT/$site-${shot:-start}-$tod-$dev"
      env $sz PORT=${PORT:-8800} xvfb-run -a node tools/reef_shot.js "$q" "$n.png" 1500 "${GPU:-0}" >/dev/null 2>&1
      env $sz PORT=${BASE_PORT:-8802} xvfb-run -a node tools/reef_shot.js "$q" "$n.base.png" 1500 "${GPU:-0}" >/dev/null 2>&1
      python3 - "$n.png" "$n.base.png" <<'P'
import sys
from PIL import Image, ImageChops
import numpy as np
a, b = (np.asarray(Image.open(f).convert('RGB')).astype(int) for f in sys.argv[1:3])
d = np.abs(a - b).max(axis=2) if a.shape == b.shape else None
print(sys.argv[1].rsplit('/', 1)[-1][:-4], 'differs' if d is None else f'{(d > 8).mean() * 100:.2f}% of pixels differ by more than 8, mean {np.abs(a - b).mean():.2f}')
P
    done
  done
done
