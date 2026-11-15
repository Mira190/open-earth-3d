"""A hero level's drawn ground as the ground the game walks and drives on (docs/HERO.md).

A hero level is drawn over the game's own ground, a few centimetres over it (game.json hero[].lift), but where its
builder laid its own levels (a carriageway on the road's own band, a quay's paving rising to its coping) or the game's
ground moved after it was built, the two parted: in Shibuya's Scramble the road by the station is drawn 0.29 m over the
ground walked, in Sydney's Circular Quay West the paving by the water 0.41 m. Feet sank into what is drawn, or stood on
air, and the cars' wheels with them.

tools/hero_ground_probe.js samples each level's drawn ground (its "ground" materials) every metre, in the game, and
writes it to cities/<id>/hero_floor.json; this turns that into one smooth patch per level in game.json "patches"
(nav.js: a surface read between its cells' middles, "smooth": 1, marked with the level's "hero" id), at the drawn
height less the level's lift (floorAt adds the lift back), so that whoever stands in the level stands on the paving
drawn, within the centimetre. The city's own patches (Sydney's Lower Concourse) are kept, and win where they overlap.
A second run writes the same.

    xvfb-run -a node tools/hero_ground_probe.js shibuya 1 export cities/shibuya/hero_floor.json
    python pipeline/hero_floor.py --city shibuya

Run it after game_data.py and street_ground.py (game_data.py writes the patches again), then pipeline/pack.py. Run
the probe again when the level is rebuilt.
"""
import base64
import json
import math
import os

import numpy as np

from cityctx import city_args


def lift_at(h, x, y):
    """The level's lift at (x, y), as nav.js lift() has it: full inside, down to nothing over its last 2 m."""
    d = h["r"] - math.hypot(x - h["at"][0], y - h["at"][1])
    return h.get("lift", 0) * min(1.0, d / 2) if d > 0 else 0.0


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    src = C.file("hero_floor.json")
    grids = json.load(open(src, encoding="utf8"))
    gp = os.path.join(C.out, "game.json")
    game = json.load(open(gp, encoding="utf8"))
    heroes = {h["id"]: h for h in game.get("hero", [])}
    own = [p for p in game.get("patches", []) if not p.get("hero")]
    made = []
    for g in grids:
        h = heroes.get(g["id"])
        if not h:
            print(f"{C.id}: no hero level {g['id']} in game.json, left out")
            continue
        nx, ny, cell = g["nx"], g["ny"], g["cell"]
        z = np.full(nx * ny, -32768, np.int16)
        n = 0
        for k, v in enumerate(g["z"]):
            if v is None:
                continue
            i, j = k % nx, k // nx
            x, y = g["x0"] + i * cell, g["y0"] + j * cell
            z[k] = int(round(v - lift_at(h, x, y) * 100))
            n += 1
        made.append({"hero": g["id"], "smooth": 1, "x0": round(g["x0"] - cell / 2, 2), "y0": round(g["y0"] - cell / 2, 2), "cell": cell, "nx": nx, "ny": ny,
                     "data": base64.b64encode(z.astype("<i2").tobytes()).decode()})
        print(f"{C.id}: {g['id']}: {n} of {nx * ny} cells of drawn ground, every {cell} m")
    # (the city's own first: nav.js takes the first patch that has the place)
    game["patches"] = own + made
    json.dump(game, open(gp, "w", encoding="utf8"), separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    main()
