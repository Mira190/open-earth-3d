"""Is the terrain right? Compare the city's DEM with an independent elevation
service (city.json "terrain_check", an ArcGIS identify endpoint) at a grid of
open land points. Photogrammetric DEMs can be biased in street canyons, which
would mis-set every building base and every shadow on the ground.

    python analysis/dem_check.py --city sydney      # -> cities/<city>/analysis/dem_check.json
"""
import json
import os
import statistics as st
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))
from build_scene import DEM_CELL, load_dem  # noqa: E402
from cityctx import city_args  # noqa: E402


def identify(cfg, lon, lat):
    p = dict(geometry=f"{lon},{lat}", geometryType="esriGeometryPoint", sr=4326, layers="all", tolerance=0,
             mapExtent=f"{lon - 0.001},{lat - 0.001},{lon + 0.001},{lat + 0.001}", imageDisplay="100,100,96", returnGeometry="false", f="json")
    for _ in range(3):
        try:
            r = requests.get(cfg["url"], params=p, timeout=60).json()["results"]
            v = r[0]["attributes"][cfg.get("field", "Pixel Value")] if r else None
            return float(v) if v not in (None, "NoData") else None
        except (requests.RequestException, ValueError, KeyError):
            continue
    return None


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    chk = C.cfg.get("terrain_check")
    if not chk or chk.get("type") != "arcgis_identify":
        raise SystemExit(f"{C.id}: no terrain_check of type arcgis_identify in city.json")
    dem = load_dem(C)
    B = json.load(open(os.path.join(C.out, "buildings.json")))
    img = Image.new("L", (dem.shape[1], dem.shape[0]), 0)
    d = ImageDraw.Draw(img)
    for s in B["s"]:
        pts = [((s[4][k] / 10 - C.x0) / DEM_CELL, (C.y1 - s[4][k + 1] / 10) / DEM_CELL) for k in range(0, len(s[4]), 2)]
        if len(pts) >= 3:
            d.polygon(pts, fill=1)
    built = np.asarray(img, bool)
    rows, cols = np.mgrid[10:dem.shape[0] - 10:24, 10:dem.shape[1] - 10:24]  # every 120 m
    pts = [(r, c) for r, c in zip(rows.ravel(), cols.ravel()) if dem[r, c] > 1.0 and not built[r, c]]
    xy = [(C.x0 + c * DEM_CELL, C.y1 - r * DEM_CELL) for r, c in pts]
    lonlat = [C.inv.transform(x, y) for x, y in xy]
    with ThreadPoolExecutor(4) as ex:
        vals = list(ex.map(lambda ll: identify(chk, *ll), lonlat))
    diffs, out = [], []
    for (r, c), (x, y), v in zip(pts, xy, vals):
        if v is None:
            continue
        diffs.append(float(dem[r, c]) - v)
        out.append([round(x), round(y), round(float(dem[r, c]), 2), round(v, 2)])
    if not diffs:
        raise SystemExit("the check service returned no values")
    a = np.abs(diffs)
    res = {"check": chk.get("name", chk["url"]), "points": len(diffs), "median_diff_m": round(st.median(diffs), 2),
           "mean_diff_m": round(float(np.mean(diffs)), 2), "median_abs_m": round(float(np.median(a)), 2),
           "p90_abs_m": round(float(np.percentile(a, 90)), 2), "share_within_1m": round(float((a <= 1).mean()), 3),
           "max_abs_m": round(float(a.max()), 2), "samples": out}
    json.dump(res, open(os.path.join(C.analysis, "dem_check.json"), "w"))
    print({k: v for k, v in res.items() if k != "samples"})


if __name__ == "__main__":
    main()
