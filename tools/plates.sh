#!/usr/bin/env bash
# The stills behind the title screen's destination cards (web/title.js showPlate): each live map as it is
# played now, from the view named in web/plates/index.json, at day, dusk and night, through the game's own
# sky and post stack at the desktop tier. Run it again when a map's hero level changes.
#   tools/plates.sh [map ...]          # every map in the index, or the ones named
# Views: tools/views/plates/<map>.json (tools/scramble_shot.js). Writes web/plates/<map>-<time>.webp, 1920x1080.
# VIEWS=1 shoots every view in the file into OUT (default /tmp/oe-plates) for choosing one, and writes nothing.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8800}"; OUT="${OUT:-/tmp/oe-plates}"
curl -s -o /dev/null "http://localhost:$PORT/index.html" || { python3 -m http.server "$PORT" --directory web >/dev/null 2>&1 & sleep 1; }
maps=("$@"); [ ${#maps[@]} -gt 0 ] || mapfile -t maps < <(python3 -I -c "import json; print('\n'.join(json.load(open('web/plates/index.json'))))")
for m in "${maps[@]}"; do
  view=$(python3 -I -c "import json,sys; print(json.load(open('web/plates/index.json')).get(sys.argv[1], {}).get('view', ''))" "$m")
  mkdir -p "$OUT/$m"
  if [ -n "${VIEWS:-}" ] || [ -z "$view" ]; then
    PORT=$PORT xvfb-run -a node tools/scramble_shot.js "$m" "tools/views/plates/$m.json" "$OUT/$m" 1920x1080
    continue
  fi
  PORT=$PORT ONLY="$view" xvfb-run -a node tools/scramble_shot.js "$m" "tools/views/plates/$m.json" "$OUT/$m" 1920x1080
  for t in day dusk night; do
    python3 -I -c "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGB').save(sys.argv[2], 'WEBP', quality=84, method=6)" "$OUT/$m/$view-$t.png" "web/plates/$m-$t.webp"
  done
done
