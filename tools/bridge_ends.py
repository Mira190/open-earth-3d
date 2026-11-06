"""Compare a city's bridge decks' end heights (scene.json water_bridges z_ends, or "banks" where clear()
raised them) with the ground read along the road each deck carries: the Overture road segments that run
along the deck's axis across its end, sampled 3 to 8 m beyond the end on the game's walking ground.

    python tools/bridge_ends.py --city tokyo
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import json

import numpy as np

import districtkit as dk
import japankit as jk
import refresh_bridges as rb
from build_scene import sample
from cityctx import city_args


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    G = rb.walking_ground(C)
    ground = lambda x, y: float(sample(C, G, x, y)[0])
    roads = [r["geom"] for r in jk.overture(C, "segment", "subtype = 'road'") if r["geom"].geom_type == "LineString"]
    scene = json.load(open(os.path.join(C.out, "scene.json"), encoding="utf8"))
    for b in scene["landmarks"]["water_bridges"]:
        c, ax, L = np.asarray(b["centre"]), np.asarray(b["axis"]), b["length_m"]
        ends = b.get("banks", b["z_ends"])
        out = []
        for k, s in enumerate((-1, 1)):
            z, n = dk.road_bank(ground, roads, c, ax * s, L, b["width_m"])
            out.append(f"{ends[k]:5.1f} beyond {ground(*(c + s * ax * (L / 2 + 3))):5.1f} road {'  -  ' if z is None else f'{z:5.1f}'} ({n})")
        print(f"{b['name'] or '(no name)':22s} {b['form']:10s} | " + " | ".join(out))


if __name__ == "__main__":
    main()
