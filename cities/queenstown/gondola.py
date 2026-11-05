"""The Skyline Gondola's line, measured: where its towers and stations stand and how high, from
OpenStreetMap's aerialway (via Overture) and LINZ's 2021 LiDAR, written to gondola.json for the
landmarks (city.py) and the game's cabins (game_rail).

    python cities/queenstown/gondola.py      # needs data/raw/queenstown (fetch_overture, fetch_tiles)

The line is straight in plan from the Brecon Street station to the top station on Bob's Peak;
OpenStreetMap maps six towers on it. The LiDAR surface model catches the taller lattice tops
(the laser's highest return within 4 m of a mapped tower); where it does not, a tower stands as
high as the cable needs to keep the cabins clear of the ground under it. (The surface model along
the line itself is no guide to the trees: it caught the cable and the cabins, and the corridor
through the forest is kept clear.) The cable
between supports sags as a parabola (SAG of the span), and the cabins hang HANG_M under it.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

SAG = 0.025          # the cable's sag at mid-span, as a share of the span
HANG_M = 4.65        # grip to the cabin's floor: hanger 2.6 m and the cabin 2.05 m
CLEAR_M = 5.0        # the cabin's floor over the ground under it, at least (the corridor through the trees is kept clear)
STATION_GRIP_M = 4.65 + 0.4  # the cable in a station: the platform (0.4 m over the ground) plus the cabin and its hanger
TOWER_MIN_M, TOWER_MAX_M = 8.0, 32.0
STATION_M = 18.0     # the cable's run inside a station building, from the line's end


def measure():
    import duckdb
    import shapely.wkb as swkb
    from PIL import Image
    from pyproj import Transformer
    from cityctx import City
    C = City("queenstown")
    rows = duckdb.connect().execute(f"SELECT class, name, wkb FROM '{C.raw}/overture_infrastructure.parquet' WHERE subtype = 'aerialway'").fetchall()
    line = next(swkb.loads(bytes(w)) for c, n, w in rows if c == "gondola")
    pylons = [swkb.loads(bytes(w)) for c, n, w in rows if c == "pylon"]
    cs = list(line.coords)
    t2193 = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
    rasters = {}
    for name in ("dem", "dsm"):
        meta = json.load(open(os.path.join(C.raw, f"{name}.json")))
        rasters[name] = (np.asarray(Image.open(os.path.join(C.raw, f"{name}.tif")), np.float32), meta["bbox"])
    off = C.cfg.get("datum_offset_m", 0.0)

    def rc(lon, lat, name):
        a, (x0, y0, x1, y1) = rasters[name]
        X, Y = t2193.transform(lon, lat)
        return a, int(round(y1 - Y - 0.5)), int(round(X - x0 - 0.5))

    def ground(lon, lat):
        a, r, c = rc(lon, lat, "dem")
        return float(a[r, c]) - off

    def top_near(lon, lat, rad=4):
        a, r, c = rc(lon, lat, "dsm")
        return float(a[r - rad:r + rad + 1, c - rad:c + rad + 1].max()) - off

    # bottom station first (the line is mapped from the top down)
    if ground(*cs[0]) > ground(*cs[-1]):
        cs = cs[::-1]
    xy = [C.fwd.transform(lo, la) for lo, la in cs]
    on_pylon = [any(math.hypot(p.x - lo, p.y - la) < 2e-6 for p in pylons) for lo, la in cs]
    supports = []
    for k, ((lo, la), (x, y)) in enumerate(zip(cs, xy)):
        g = ground(lo, la)
        if k in (0, len(cs) - 1):
            supports.append({"kind": "station", "x": x, "y": y, "ground": g, "cable": g + STATION_GRIP_M, "lonlat": [lo, la]})
        elif on_pylon[k]:
            lidar = top_near(lo, la) - g
            supports.append({"kind": "tower", "x": x, "y": y, "ground": g, "lidar_m": round(lidar, 1), "lonlat": [lo, la],
                             "cable": g + min(max(lidar, TOWER_MIN_M), TOWER_MAX_M) if lidar > TOWER_MIN_M else None})
    # the distance along the line, and the ground and canopy under it every metre
    s = [0.0]
    for a, b in zip(xy, xy[1:]):
        s.append(s[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    for sp, sv in zip(supports, [s[k] for k in range(len(cs)) if k in (0, len(cs) - 1) or on_pylon[k]]):
        sp["s"] = sv
    L = s[-1]
    lo0, la0 = cs[0]
    lo1, la1 = cs[-1]
    under = []
    for d in np.arange(STATION_M, L - STATION_M + 0.01, 1.0):  # inside a station the laser saw its roof
        f = d / L
        lo, la = lo0 + (lo1 - lo0) * f, la0 + (la1 - la0) * f
        under.append((d, ground(lo, la), ground(lo, la)))

    def cable_at(d, sup):
        for a, b in zip(sup, sup[1:]):
            if a["s"] <= d <= b["s"]:
                f = (d - a["s"]) / max(b["s"] - a["s"], 1e-6)
                return a["cable"] + (b["cable"] - a["cable"]) * f - 4 * SAG * (b["s"] - a["s"]) * f * (1 - f)
        return sup[-1]["cable"]

    # towers the laser missed: start at the lowest and raise each until every span next to it clears
    for sp in supports:
        if sp["cable"] is None:
            sp["cable"] = sp["ground"] + TOWER_MIN_M
    for _ in range(200):
        worst = min(under, key=lambda u: cable_at(u[0], supports) - HANG_M - u[2])
        gap = cable_at(worst[0], supports) - HANG_M - worst[2]
        if gap >= CLEAR_M:
            break
        # raise the nearer tower of the span (not a station)
        span = next((a, b) for a, b in zip(supports, supports[1:]) if a["s"] <= worst[0] <= b["s"])
        cand = [t for t in span if t["kind"] == "tower" and t["cable"] - t["ground"] < TOWER_MAX_M]
        if not cand:
            break
        t = min(cand, key=lambda t: abs(t["s"] - worst[0]))
        t["cable"] += 0.5
    clear = min(cable_at(u[0], supports) - HANG_M - u[2] for u in under)
    prof = [[round(d, 1), round(cable_at(d, supports), 2)] for d in np.arange(0, L + 0.01, 4.0)]
    out = {
        "note": __doc__.strip().splitlines()[0],
        "sources": "OpenStreetMap aerialway=gondola and its pylons (via Overture 2026-10-21.0); LINZ Otago - Queenstown LiDAR 1m DEM and DSM (2021)",
        "length_m": round(L, 1), "rise_m": round(supports[-1]["ground"] - supports[0]["ground"], 1),
        "start": [round(xy[0][0], 2), round(xy[0][1], 2)], "end": [round(xy[-1][0], 2), round(xy[-1][1], 2)],
        "hang_m": HANG_M, "sag": SAG, "min_clearance_m": round(clear, 1),
        "supports": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in sp.items()} | {"height_m": round(sp["cable"] - sp["ground"], 1)} for sp in supports],
        "profile": prof,
    }
    json.dump(out, open(os.path.join(HERE, "gondola.json"), "w"), indent=1)
    print(f"gondola: {L:.0f} m along, rise {out['rise_m']} m, towers {[s['height_m'] for s in out['supports'] if s['kind'] == 'tower']}, "
          f"min clearance {clear:.1f} m")


def massing(names=("Skyline Luge Queenstown",), cell=3.0, step=1.5):
    """Buildings on a steep slope whose single block (the roof's median over the lowest ground under
    it) would stand far too tall: the roof levels the LiDAR surface model shows inside the footprint,
    in cells of `cell` m quantised to `step` m, joined into terraces, each with the ground under it.
    Writes massing.json for city.py (the Skyline complex on Bob's Peak steps down the hill)."""
    import duckdb
    import shapely
    import shapely.wkb as swkb
    from PIL import Image
    from pyproj import Transformer
    from shapely.geometry import box
    from cityctx import City
    C = City("queenstown")
    off = C.cfg.get("datum_offset_m", 0.0)
    rasters = {}
    for name in ("dem", "dsm"):
        meta = json.load(open(os.path.join(C.raw, f"{name}.json")))
        rasters[name] = (np.asarray(Image.open(os.path.join(C.raw, f"{name}.tif")), np.float32), meta["bbox"])
    to2193 = Transformer.from_crs(C.proj, "EPSG:2193", always_xy=True)

    def sample(name, x, y, agg):
        a, (x0, y0, x1, y1) = rasters[name]
        X, Y = to2193.transform(x, y)
        r, c = int(y1 - Y), int(X - x0)
        h = int(cell / 2)
        return float(agg(a[r - h:r + h + 1, c - h:c + h + 1])) - off

    out = {}
    con = duckdb.connect()
    for nm in names:
        rows = con.execute(f"SELECT wkb FROM '{C.raw}/overture_building.parquet' WHERE name = ?", [nm]).fetchall()
        if not rows:
            continue
        g = C.to_local(swkb.loads(bytes(rows[0][0])))
        x0, y0, x1, y1 = g.bounds
        levels = {}
        for x in np.arange(x0, x1, cell):
            for y in np.arange(y0, y1, cell):
                b = box(x, y, x + cell, y + cell)
                if g.intersection(b).area < 0.5 * cell * cell:
                    continue
                cx, cy = x + cell / 2, y + cell / 2
                roof = sample("dsm", cx, cy, lambda v: np.percentile(v, 60))
                ground = sample("dem", cx, cy, np.min)
                if roof - ground < 2.0:
                    continue  # open ground or a terrace at grade
                levels.setdefault(round(roof / step) * step, []).append(b.intersection(g))
        tiers = []
        for z, parts in sorted(levels.items()):
            u = shapely.union_all(parts).buffer(0.01).buffer(-0.01)
            for q in getattr(u, "geoms", [u]):
                if q.area < 2 * cell * cell:
                    continue
                q = q.simplify(0.5)
                cs = np.asarray(q.exterior.coords)
                gz = min(sample("dem", x, y, np.min) for x, y in cs[::max(1, len(cs) // 12)])
                tiers.append({"top": round(z, 1), "ground": round(gz, 1), "ring": [[round(x, 2), round(y, 2)] for x, y in cs[:-1]]})
        out[nm] = {"cell_m": cell, "step_m": step, "tiers": tiers}
        print(f"massing: {nm}: {len(tiers)} terraces, roofs {min(t['top'] for t in tiers)} to {max(t['top'] for t in tiers)} m")
    json.dump({"note": massing.__doc__.strip().splitlines()[0], "sources": "LINZ Otago - Queenstown LiDAR 1m DEM and DSM (2021); OpenStreetMap outline via Overture",
               "buildings": out}, open(os.path.join(HERE, "massing.json"), "w"), indent=1)


if __name__ == "__main__":
    measure()
    massing()
