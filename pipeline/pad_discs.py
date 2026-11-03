"""Check, and repair without a rebuild, the ground under the water in a city's game.json.

pipeline/game_data.py writes the game's terrain grid with the modelled bottom under the water
(shore.py, from shore.png) and raises the water cells round each floating helipad to the pad's
height (an apron, a disc 14 m round it; none for a pad on land). A pad a city later leaves out (as Osaka and
Kyoto left out their mapped rooftop pads, "helipads_from_data": false) would keep its disc until
the next full game_data.py run, which needs the raw Overture data and the DEM. This rebuilds the
water cells exactly as game_data.py does, from shore.png, the pads game.json lists now and the
city's game_ground hook (the same functions), and reports every water cell that differs: a disc left by a pad that is gone,
or an apron a listed pad lacks. With --write it puts those cells back and rewrites game.json the
way game_data.py writes it. Land cells are never touched.

    python pipeline/pad_discs.py --city osaka           # report
    python pipeline/pad_discs.py --city osaka --write   # and repair web/data/osaka/game.json
    python pipeline/pad_discs.py --all
"""
import base64
import json
import os

import numpy as np

from cityctx import ROOT, City, city_args
from shore import from_png, pad_aprons, water_floor


def grids(G):
    """The terrain (m) and the water mask from a game.json."""
    t, w = G["terrain"], G["water"]
    nx, ny = t["nx"], t["ny"]
    terrain = np.frombuffer(base64.b64decode(t["data"]), "<i2").reshape(ny, nx).astype(float) * t["scale"]
    water = np.unpackbits(np.frombuffer(base64.b64decode(w["bits"]), np.uint8))[:nx * ny].reshape(ny, nx).astype(bool)
    return terrain, water


def check(C, write=False):
    path, shore = os.path.join(C.out, "game.json"), os.path.join(C.out, "shore.png")
    if not (os.path.exists(path) and os.path.exists(shore)):
        print(f"{C.id}: no game.json or shore.png")
        return 0
    G = json.load(open(path))
    t = G["terrain"]
    terrain, water = grids(G)
    ny, nx = terrain.shape
    gy, gx = np.mgrid[0:ny, 0:nx]
    gx, gy = C.x0 + (gx + 0.5) * t["cell"], C.y1 - (gy + 0.5) * t["cell"]
    want = np.where(water, water_floor(from_png(shore, C.x0, C.y1, C.cfg), water, gx, gy, C.x0, C.y1), terrain)
    pad_aprons(want, water, gx, gy, G["helipads"])
    if C.hook("game_ground"):  # the city's own levels, as game_data.py applies them (Sydney's seawall foot)
        want = C.hook("game_ground")(want, gx, gy, water, json.load(open(os.path.join(C.out, "scene.json"))))
    q_have, q_want = np.round(terrain / t["scale"]).astype("<i2"), np.round(want / t["scale"]).astype("<i2")
    off = water & (q_have != q_want)
    high, low = off & (q_have > q_want), off & (q_have < q_want)
    print(f"{C.id}: {int(water.sum())} water cells, {len(G['helipads'])} helipads; "
          f"{int(high.sum())} raised above the bottom with no floating pad listed, {int(low.sum())} below a listed pad's apron")
    for name, m in (("raised", high), ("low", low)):
        if m.any():
            r, c = np.nonzero(m)
            print(f"  {name}: x {gx[0, c.min()]:.0f}..{gx[0, c.max()]:.0f}, y {gy[r.max(), 0]:.0f}..{gy[r.min(), 0]:.0f}, "
                  f"up to {np.abs(q_have - q_want)[m].max() * t['scale']:.1f} m off")
    if write and off.any():
        q_have[off] = q_want[off]
        G["terrain"]["data"] = base64.b64encode(q_have.tobytes()).decode()
        json.dump(G, open(path, "w"), separators=(",", ":"))  # as game_data.py writes it
        print(f"  wrote {os.path.relpath(path, ROOT)}")
    return int(off.sum())


def main():
    C, a = city_args(__doc__.splitlines()[0], lambda ap: (
        ap.add_argument("--write", action="store_true", help="put the cells back in game.json"),
        ap.add_argument("--all", action="store_true", help="every city with a game.json")))
    cities = sorted(d for d in os.listdir(os.path.join(ROOT, "cities")) if os.path.exists(os.path.join(ROOT, "cities", d, "city.json"))) if a.all else [C.id]
    for cid in cities:
        check(City(cid), a.write)


if __name__ == "__main__":
    main()
