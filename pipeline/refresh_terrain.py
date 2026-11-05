"""Level a built city's ground where its city.json terrain.level says (or where its adjust_terrain hook
moves it, with --hook), without the full rebuild:
the viewer's terrain grid (web/data/<id>/terrain.json), the game's walking ground (game.json
"terrain"), the paths and street furniture that lay on the old ground there (game.json "paths",
"props") and the ground of the landmarks standing in a levelled area (scene.json "landmarks").
Each levelled cell is set from the city's DEM exactly as build_scene.py and game_data.py set it
(load_dem applies terrain.level), so running it again changes nothing, and the next full build
gives the same ground. Water cells and everything outside the rings are left as built.

With --hook the city's adjust_terrain hook is taken as new or changed: every cell it moves is refreshed
too (Tokyo's palace moats, brought down to their water). A city with a game_ponds hook (water above the
sea, at its own level) has those cells made water to the game, at a metre under their level, as
game_data.py makes them.

Run pipeline/landmarks.py and pipeline/game_extras.py after it: a landmark mesh and a thing to
walk up to take their heights from scene.json and terrain.json.

Needs data/raw/<id>/dem.tif and dem.json (fetch_tiles.py --only dem).

    python pipeline/refresh_terrain.py --city paris
    python pipeline/refresh_terrain.py --city tokyo --hook
"""
import base64
import json
import os

import numpy as np
from shapely.geometry import Point, Polygon

from build_scene import DEM_CELL, TERRAIN_CELL, load_dem, raster_mask, sample
from cityctx import city_args


def grid(block):
    return np.frombuffer(base64.b64decode(block["data"]), "<i2").reshape(block["ny"], block["nx"]).astype(np.int16)


def encode(a):
    return base64.b64encode(a.astype("<i2").tobytes()).decode()


def main():
    C, a = city_args(__doc__.splitlines()[0], lambda ap: ap.add_argument(
        "--hook", action="store_true", help="refresh every cell the city's adjust_terrain hook moves"))
    rules = C.cfg.get("terrain", {}).get("level", [])
    if not rules and not (a.hook and C.hook("adjust_terrain")):
        raise SystemExit(f"{C.id}: no terrain.level in city.json (nor --hook with an adjust_terrain hook), nothing to level")
    rings = [C.to_local(Polygon(r["ring"])) for r in rules]
    dem = load_dem(C)  # with terrain.level (and the city's adjust_terrain cuts)
    C.cfg = dict(C.cfg, terrain=dict(C.cfg["terrain"], level=[]))
    hooks = C.hooks
    if a.hook:
        C.hooks = None
    before = load_dem(C)  # the ground as built before the levelling (and before the hook, with --hook)
    C.hooks = hooks
    ny, nx = dem.shape
    inside = raster_mask(rings, nx, ny, DEM_CELL, C.x0, C.y1) if rings else np.zeros((ny, nx), bool)
    if a.hook:
        inside |= np.abs(dem - before) > 0.005

    # the game's walking ground: the DEM on land (game_data.py), at the DEM's own cell
    gpath = os.path.join(C.out, "game.json")
    game = json.load(open(gpath))
    gt, gw = game["terrain"], game["water"]
    assert (gt["nx"], gt["ny"]) == (nx, ny), "game.json's grid is not the DEM's: rebuild with game_data.py"
    water = np.unpackbits(np.frombuffer(base64.b64decode(gw["bits"]), np.uint8))[:nx * ny].reshape(ny, nx).astype(bool)
    g = grid(gt)
    cells = inside & ~water
    new = np.round(dem * 10).astype(np.int16)
    # water above the sea at its own level (the city's game_ponds): water to the game, its basin a metre
    # under that level (game_data.py)
    ponds = C.hook("game_ponds")(json.load(open(os.path.join(C.out, "scene.json")))) if C.hook("game_ponds") else []
    pond = np.zeros((ny, nx), bool)
    for p in ponds:
        m = raster_mask([Polygon(p["ring"], p.get("holes") or [])], nx, ny, DEM_CELL, C.x0, C.y1)
        new[m] = round((p["z"] - 1.0) * 10)
        pond |= m
    newly_wet = int((pond & ~water).sum())
    water |= pond
    cells |= pond
    gw["bits"] = base64.b64encode(np.packbits(water.ravel()).tobytes()).decode()
    gchanged = int((g[cells] != new[cells]).sum())
    g[cells] = new[cells]
    gt["data"] = encode(g)
    # the points of the paths and the props that were laid on the old ground (game_data.py: ground(x, y)),
    # within a decimetre's rounding, inside a ring: onto the new one. A bridge or a raised level over it stays
    moved_pts = 0

    def reground(flat):
        nonlocal moved_pts
        for i in range(0, len(flat) - 2, 3):
            x, y, z = flat[i] / 10, flat[i + 1] / 10, flat[i + 2] / 10
            r_, c_ = int(round((C.y1 - y) / DEM_CELL)), int(round((x - C.x0) / DEM_CELL))
            if 0 <= r_ < ny and 0 <= c_ < nx and inside[r_, c_] and not pond[r_, c_] and abs(z - float(sample(C, before, x, y)[0])) < 0.15:
                nz = round(float(sample(C, dem, x, y)[0]) * 10)
                moved_pts += nz != flat[i + 2]
                flat[i + 2] = nz
    for kind in game.get("paths", {}).values():
        for e in kind:
            reground(e["p"])
    for flat in game.get("props", {}).values():
        reground(flat)
    if C.hook("game_ground"):
        print("note: the city has a game_ground hook; its levels inside the rings are not re-applied")

    # the viewer's grid: every other DEM cell (build_scene.py), with the city's cuts again at its resolution
    tpath = os.path.join(C.out, "terrain.json")
    T = json.load(open(tpath))
    step = int(TERRAIN_CELL / DEM_CELL)
    tg = dem[::step, ::step]
    if C.hook("adjust_terrain"):
        tg = C.hook("adjust_terrain")(tg.copy(), C, TERRAIN_CELL)
    t = grid(T)
    tcells = (inside & ~water | inside & pond)[::step, ::step]
    tnew = np.round(tg * 10).astype(np.int16)
    tchanged = int((t[tcells] != tnew[tcells]).sum())
    t[tcells] = tnew[tcells]
    T["data"] = encode(t)

    # the landmarks in a levelled area stand on its level
    spath = os.path.join(C.out, "scene.json")
    scene = json.load(open(spath))
    moved = []
    for key, lm in scene.get("landmarks", {}).items():
        if isinstance(lm, dict) and "centre" in lm and "ground_m" in lm:
            for ring, rule in zip(rings, rules):
                if ring.contains(Point(*lm["centre"][:2])) and lm["ground_m"] != rule["z_m"]:
                    moved.append(f"{key} {lm['ground_m']} -> {rule['z_m']} m")
                    lm["ground_m"] = rule["z_m"]

    json.dump(game, open(gpath, "w"), separators=(",", ":"))
    json.dump(T, open(tpath, "w"))
    json.dump(scene, open(spath, "w"), separators=(",", ":"))
    print(f"{C.id}: {len(rules)} levelled areas; {newly_wet} cells made water; {gchanged} game cells, {tchanged} viewer cells and {moved_pts} path and prop points changed; "
          f"landmarks: {', '.join(moved) or 'none moved'}")


if __name__ == "__main__":
    main()
