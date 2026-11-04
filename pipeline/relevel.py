"""Apply a city's ground levels (city.json terrain.level) to its built terrain, without the raw DEM.

pipeline/build_scene.py and pipeline/game_data.py level the DEM as they read it (build_scene.level_areas),
so a rule added to city.json lands in a city's ground at its next full build, which needs the raw
downloads. This applies the named rules to what is built instead: the game's 5 m walking ground
(game.json "terrain") on land, and the viewer's 10 m grid (terrain.json, every other cell of the 5 m
DEM) by the same change, so both match what a full build will give. Water cells are left alone.
A rule is applied once: levelling is a blend at the feathered edge, so run it once per new rule.

    python pipeline/relevel.py --city hong-kong --rule "Peak Tower's forecourt"     # report
    python pipeline/relevel.py --city hong-kong --rule "Peak Tower's forecourt" --write
"""
import base64
import json
import os

import numpy as np

from build_scene import DEM_CELL, TERRAIN_CELL, level_areas
from cityctx import city_args


def main():
    C, a = city_args(__doc__.splitlines()[0], lambda ap: (
        ap.add_argument("--rule", action="append", default=[], help="a terrain.level rule's name, or the start of it (repeatable)"),
        ap.add_argument("--write", action="store_true", help="write game.json and terrain.json")))
    rules = [r for r in C.cfg.get("terrain", {}).get("level", []) if any(r["name"].startswith(n) for n in a.rule)]
    if not rules:
        raise SystemExit(f"{C.id}: no terrain.level rule named {a.rule}")
    gpath, tpath = os.path.join(C.out, "game.json"), os.path.join(C.out, "terrain.json")
    G, T = json.load(open(gpath)), json.load(open(tpath))
    g, w = G["terrain"], G["water"]
    assert g["cell"] == DEM_CELL and TERRAIN_CELL % DEM_CELL == 0
    ny, nx = g["ny"], g["nx"]
    have = np.frombuffer(base64.b64decode(g["data"]), "<i2").reshape(ny, nx).astype(float) * g["scale"]
    water = np.unpackbits(np.frombuffer(base64.b64decode(w["bits"]), np.uint8))[:nx * ny].reshape(ny, nx).astype(bool)
    cfg = dict(C.cfg, terrain=dict(C.cfg["terrain"], level=rules))
    C.cfg, keep = cfg, C.cfg
    want = np.where(water, have, level_areas(C, have.copy(), DEM_CELL))
    C.cfg = keep
    dz = np.round(want * 10) / 10 - np.round(have * 10) / 10
    for r in rules:
        print(f"{C.id}: {r['name']}: to {r['z_m']} m")
    moved = np.abs(dz) >= 0.05
    print(f"  game.json: {int(moved.sum())} cells of {DEM_CELL:g} m, up to {dz.max():+.1f} / {dz.min():+.1f} m")
    step = int(TERRAIN_CELL / DEM_CELL)
    tq = np.frombuffer(base64.b64decode(T["data"]), "<i2").reshape(T["ny"], T["nx"]).astype(np.int32)
    tdz = np.round(dz[::step, ::step][:T["ny"], :T["nx"]] * 10).astype(np.int32)
    print(f"  terrain.json: {int((tdz != 0).sum())} cells of {TERRAIN_CELL:g} m")
    if a.write:
        g["data"] = base64.b64encode(np.round(want * 10).astype("<i2").tobytes()).decode()
        json.dump(G, open(gpath, "w"), separators=(",", ":"))   # as game_data.py writes it
        T["data"] = base64.b64encode((tq + tdz).astype("<i2").tobytes()).decode()
        json.dump(T, open(tpath, "w"))                          # as build_scene.py writes it
        print(f"  wrote {gpath} and {tpath}")


if __name__ == "__main__":
    main()
