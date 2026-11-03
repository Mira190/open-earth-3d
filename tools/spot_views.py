"""Views for tools/city_shot.js from a city's game spots: from each spot (open ground, where a player stands
to look), 2.5 m above the ground, towards what it looks at (the spot's `look` in game.json if given, else the
nearest landmark label), by day and after dark. Prints the JSON to stdout.

    python tools/spot_views.py jinbocho > /tmp/views.json
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    city = sys.argv[1]
    day, night = (sys.argv[2:4] + ["13:00", "19:00"][len(sys.argv[2:4]):])
    G = json.load(open(os.path.join(ROOT, "web", "data", city, "game.json")))
    S = json.load(open(os.path.join(ROOT, "web", "data", city, "scene.json")))
    labels = S.get("labels") or {}
    out = []
    for s in G.get("spots", []):
        x, y = s["at"][:2]
        near = min(labels.values(), key=lambda p: math.hypot(p[0] - x, p[1] - y), default=None)
        tx, ty = (near[0], near[1]) if near and math.hypot(near[0] - x, near[1] - y) < 120 else (x + 20, y)
        d = math.hypot(tx - x, ty - y) or 1
        cam = [x, y, 2.5]
        for name, t in ((s["id"], day), (s["id"] + "_night", night)):
            out.append({"name": name, "cam": [round(c, 1) for c in cam], "tgt": [tx, ty, 6.0], "agl": True, "date": [11, 3], "time": t})
    print(json.dumps(out))


if __name__ == "__main__":
    main()
