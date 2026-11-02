"""Find land drawn under water: places where a city's built water mask (web/data/<id>/game.json)
covers things that stand on solid ground in the newest Overture data (roads at ground level,
buildings that do not float, helipads, aprons and car parks). That is the sign of a coastline
drawn before a reclamation, or of a platform the water theme runs over (issue 50).

Needs the city's Overture layers in data/raw/<id>/ (fetch_overture.py --only building segment
infrastructure water land). Prints the clusters, largest first, in the local frame.

    python tools/stale_shore.py hong-kong sydney ...
    python tools/stale_shore.py --all
"""
import argparse
import base64
import json
import os
import sys

import duckdb
import numpy as np
import shapely
from scipy import ndimage
from shapely import wkb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from cityctx import City, polygons  # noqa: E402

SOLID = {"helipad", "heliport", "apron", "parking", "parking_space", "taxiway", "runway"}
STEP = 2.0  # metres between the points sampled along a road


def mask_of(C):
    g = json.load(open(os.path.join(C.out, "game.json")))
    w = g["water"]
    nx, ny = w["nx"], w["ny"]
    m = np.unpackbits(np.frombuffer(base64.b64decode(w["bits"]), np.uint8))[:nx * ny].reshape(ny, nx).astype(bool)
    return m, w["cell"]


def scan(cid, min_cells):
    C = City(cid)
    if not os.path.exists(os.path.join(C.out, "game.json")):
        return []
    water, cell = mask_of(C)
    ny, nx = water.shape
    # a cell of open water: every neighbour is water too (the 5 m waterline is a cell either way)
    deep = ndimage.binary_erosion(water, iterations=1, border_value=1)
    hit = np.zeros(water.shape, np.uint8)  # bit 1 road, 2 building, 4 solid infrastructure
    con = duckdb.connect()
    raw = lambda n: os.path.join(C.raw, f"overture_{n}.parquet")
    floating = set(C.cfg.get("water", {}).get("floating", []))

    def mark_pts(xs, ys, bit):
        c = ((np.asarray(xs) - C.x0) / cell).astype(int)
        r = ((C.y1 - np.asarray(ys)) / cell).astype(int)
        ok = (c >= 0) & (c < nx) & (r >= 0) & (r < ny)
        r, c = r[ok], c[ok]
        on = deep[r, c]
        hit[r[on], c[on]] |= bit

    def mark_poly(g, bit):
        for p in polygons(g):
            if p.is_empty:
                continue
            x0, y0, x1, y1 = p.bounds
            xs, ys = np.meshgrid(np.arange(x0 + cell / 2, x1, cell), np.arange(y0 + cell / 2, y1, cell))
            pts = shapely.points(xs.ravel(), ys.ravel())
            inside = shapely.contains(p, pts)
            mark_pts(xs.ravel()[inside], ys.ravel()[inside], bit)


    piers = []
    if os.path.exists(raw("infrastructure")):
        for cls, b in con.execute(f"SELECT class, wkb FROM '{raw('infrastructure')}'").fetchall():
            g = C.to_local(wkb.loads(bytes(b)))
            if cls == "pier":
                piers += polygons(g)
            elif cls in SOLID:
                mark_poly(g, 4)
    if os.path.exists(raw("segment")):
        for flags, levels, b in con.execute(f"SELECT road_flags, level_rules, wkb FROM '{raw('segment')}' WHERE subtype = 'road'").fetchall():
            if any(set(f.get("values") or []) & {"is_bridge", "is_tunnel", "is_covered", "is_indoor"} for f in flags or []):
                continue
            if any((lv.get("value") or 0) != 0 for lv in levels or []):
                continue
            g = C.to_local(wkb.loads(bytes(b)))
            for line in getattr(g, "geoms", [g]):
                if line.length < STEP:
                    continue
                pts = [line.interpolate(d) for d in np.arange(0, line.length, STEP)]
                mark_pts([p.x for p in pts], [p.y for p in pts], 1)
    if os.path.exists(raw("building")):
        for cls, under, b in con.execute(f"SELECT class, is_underground, wkb FROM '{raw('building')}'").fetchall():
            if cls in floating or under:
                continue
            mark_poly(C.to_local(wkb.loads(bytes(b))), 2)
    # a building or a road on a pier stands on its deck, which the scene draws (places.json: the
    # mapped piers and the decks pipeline/shore.py adds)
    pp = os.path.join(C.out, "places.json")
    if os.path.exists(pp):
        from shapely.geometry import Polygon
        piers += [Polygon(np.asarray(r, float).reshape(-1, 2) / 10) for r in json.load(open(pp))["piers"] if len(r) >= 6]
    if piers:
        from build_scene import raster_mask
        pm = raster_mask(piers, nx, ny, cell, C.x0, C.y1)
        hit[ndimage.binary_dilation(pm, iterations=1)] = 0
    lab, n = ndimage.label(ndimage.binary_closing(hit > 0, iterations=2) & water)
    out = []
    for k in range(1, n + 1):
        sel = lab == k
        cnt = int((hit[sel] > 0).sum())
        if cnt < min_cells:
            continue
        r, c = np.nonzero(sel)
        kinds = [name for bit, name in ((1, "road"), (2, "building"), (4, "pad/apron/parking")) if (hit[sel] & bit).any()]
        out.append({"city": cid, "cells": cnt, "x": round(C.x0 + (c.mean() + 0.5) * cell), "y": round(C.y1 - (r.mean() + 0.5) * cell),
                    "box": [round(C.x0 + c.min() * cell), round(C.y1 - (r.max() + 1) * cell), round(C.x0 + (c.max() + 1) * cell), round(C.y1 - r.min() * cell)],
                    "kinds": kinds})
    return sorted(out, key=lambda o: -o["cells"])


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cities", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--min-cells", type=int, default=4)
    a = ap.parse_args()
    ids = a.cities or ([e["id"] for e in json.load(open(os.path.join(ROOT, "cities", "index.json")))["cities"]] if a.all else [])
    total = 0
    for cid in ids:
        found = scan(cid, a.min_cells)
        total += len(found)
        print(f"{cid}: {len(found)} cluster(s) of land under water")
        for f in found:
            print(f"  {f['cells']:4d} cells at ({f['x']}, {f['y']}) box {f['box']}: {', '.join(f['kinds'])}")
    return total


if __name__ == "__main__":
    main()
