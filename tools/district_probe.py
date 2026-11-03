"""Where a district's named features stand in its local frame: their centre, size and the ground under
them, from the raw Overture layers and the built terrain. For placing landmarks, NPCs and travel points.

    python tools/district_probe.py ueno 弁天堂 東照宮 --layer building
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
from cityctx import City  # noqa: E402
import japankit as jk  # noqa: E402


def ground_fn(C):
    t = json.load(open(os.path.join(C.out, "terrain.json")))
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("city")
    ap.add_argument("names", nargs="+")
    ap.add_argument("--layer", default="building")
    a = ap.parse_args()
    C = City(a.city)
    for n in a.names:
        rows = jk.overture(C, a.layer, f"name LIKE '%{n}%'")
        for r in rows:
            g = r["geom"]
            c = g.centroid
            x0, y0, x1, y1 = g.bounds
            print(f"{r['name']:<30} {r.get('class')!s:<12} c=({c.x:7.1f},{c.y:7.1f}) size={x1 - x0:6.1f}x{y1 - y0:6.1f} area={g.area:8.0f} h={r.get('height')}")


if __name__ == "__main__":
    main()
