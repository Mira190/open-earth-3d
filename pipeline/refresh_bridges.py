"""Find a built city's bridges over the water again (pipeline/bridges.py), without rebuilding the scene:
scene.json's landmarks "water_bridges", as build_scene.py finds them after the city's finalize hook. The
banks' heights come from the game's walking ground (game.json "terrain", the DEM's land on the same 5 m
grid), or from the DEM where it has been fetched, so the next full build gives the same decks.

Then run pipeline/landmarks.py (the bridges' meshes) and pipeline/game_extras.py (their decks in the game's
surfaces); in the game the roads and footways over the water are laid on the decks (web/game/decks.js).

Needs data/raw/<id>/overture_{water,infrastructure,segment}.parquet
(fetch_overture.py --only water infrastructure segment).

    python pipeline/refresh_bridges.py --city asakusa
"""
import base64
import json
import os

import numpy as np

import bridges
from build_scene import DEM_CELL, sample
from cityctx import city_args


class Ctx:
    def __init__(self, C, grid, landmarks):
        self.city, self.grid, self.landmarks = C, grid, landmarks

    def ground(self, x, y):
        return float(sample(self.city, self.grid, x, y)[0])


def walking_ground(C):
    if os.path.exists(os.path.join(C.raw, "dem.tif")):
        from build_scene import load_dem
        return load_dem(C)
    t = json.load(open(os.path.join(C.out, "game.json"), encoding="utf8"))["terrain"]
    assert t["cell"] == DEM_CELL
    return np.frombuffer(base64.b64decode(t["data"]), "<i2").reshape(t["ny"], t["nx"]).astype(np.float32) * t["scale"]


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    path = os.path.join(C.out, "scene.json")
    scene = json.load(open(path, encoding="utf8"))
    lm = scene.setdefault("landmarks", {})
    lm["water_bridges"] = bridges.find(Ctx(C, walking_ground(C), lm), scene)
    json.dump(scene, open(path, "w"), separators=(",", ":"))   # as build_scene.py writes it
    for b in lm["water_bridges"]:
        print(f"  {b['name'] or '(no name)':24s} {b['form']:12s} {b['length_m']:6.1f} x {b['width_m']:4.1f} m, deck {b['z_ends'][0]:.1f}-{b['z_ends'][1]:.1f} m")


if __name__ == "__main__":
    main()
