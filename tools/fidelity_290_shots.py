"""Stills for #290: each view of tools/views/fidelity-290.json at day, dusk and night, on a desktop (1440 x 900)
and a phone (390 x 844), through tools/city_shot.js; and a sheet per city.
    python3 tools/fidelity_290_shots.py OUT_DIR [city ...]
"""
import json
import os
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIMES = {"day": "13:00", "dusk": "sunset+20", "night": "21:00"}
SIZES = {"desktop": (1440, 900), "phone": (390, 844)}


def main():
    out = sys.argv[1]
    V = json.load(open(os.path.join(ROOT, "tools", "views", "fidelity-290.json")))
    for city in sys.argv[2:] or list(V):
        views = [dict(v, name=f"{v['name']}-{t}", date=[10, 30], time=tm) for v in V[city] for t, tm in TIMES.items()]
        vf = os.path.join(out, f"{city}-views.json")
        os.makedirs(out, exist_ok=True)
        json.dump(views, open(vf, "w"))
        for size, (w, h) in SIZES.items():
            d = os.path.join(out, city, size)
            subprocess.run(["xvfb-run", "-a", "node", os.path.join(ROOT, "tools", "city_shot.js"), city, vf, d, str(w), str(h)], check=True)
        for size in SIZES:
            ims = [[Image.open(os.path.join(out, city, size, f"{v['name']}-{t}.png")).convert("RGB") for t in TIMES] for v in V[city]]
            cw = 480 if size == "desktop" else 200
            ims = [[im.resize((cw, int(cw * im.height / im.width))) for im in row] for row in ims]
            ch = ims[0][0].height
            S = Image.new("RGB", (cw * 3, ch * len(ims)))
            for r, row in enumerate(ims):
                for c, im in enumerate(row):
                    S.paste(im, (c * cw, r * ch))
            S.save(os.path.join(out, f"{city}-{size}.jpg"), quality=88)


if __name__ == "__main__":
    main()
