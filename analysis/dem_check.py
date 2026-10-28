"""Is the terrain right? Compare the city's DEM with an independent elevation
source (city.json "terrain_check") at open land points: an ArcGIS identify endpoint
sampled on a grid ("arcgis_identify"), surveyed spot heights from an ArcGIS
feature layer ("arcgis_points", e.g. Vicmap Elevation for Melbourne), GSI PNG
tiles ("gsi_dem_png", a coarser, older Japanese DEM) or GSI's elevation lookup
("gsi_elevation_api", the 1 m laser DEM where flown). Photogrammetric DEMs can be
biased in street canyons, which would mis-set every building base and every shadow
on the ground.

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
from build_scene import DEM_CELL, load_dem, sample  # noqa: E402
from cityctx import city_args  # noqa: E402
from fetch_tiles import gsi_decode  # noqa: E402


def identify(cfg, lon, lat):
    if cfg["type"] == "gsi_elevation_api":  # GSI's own lookup, best source at each point (1 m laser where flown)
        for _ in range(3):
            try:
                v = requests.get(cfg["url"], params=dict(lon=lon, lat=lat, outtype="JSON"), timeout=60).json().get("elevation")
                return float(v) if isinstance(v, (int, float)) else None
            except (requests.RequestException, ValueError):
                continue
        return None
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


def spot_heights(cfg, bbox):
    """All points of a feature layer in the bbox: [(lon, lat, height)], paged."""
    out, offset = [], 0
    while True:
        r = requests.get(cfg["url"], timeout=120, params=dict(
            where="1=1", geometry=",".join(map(str, bbox)), geometryType="esriGeometryEnvelope", inSR=4326, spatialRel="esriSpatialRelIntersects",
            outFields=cfg["field"], outSR=4326, returnGeometry="true", resultOffset=offset, resultRecordCount=1000, f="json")).json()
        fs = r.get("features", [])
        out += [(f["geometry"]["x"], f["geometry"]["y"], float(f["attributes"][cfg["field"]])) for f in fs
                if f.get("geometry") and f["attributes"].get(cfg["field"]) is not None]
        if not r.get("exceededTransferLimit") or not fs:
            return out
        offset += len(fs)


_tiles = {}


def gsi_value(cfg, lon, lat):
    """Elevation from GSI PNG tiles (a different, coarser dataset than the city's DEM): bilinear in the tile."""
    import io
    import math
    z = cfg["zoom"]
    n = 2 ** z
    fx, fy = (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    tx, ty = int(fx), int(fy)
    if (tx, ty) not in _tiles:
        r = requests.get(cfg["url"].format(z=z, x=tx, y=ty), timeout=60)
        _tiles[(tx, ty)] = gsi_decode(io.BytesIO(r.content)) if r.status_code == 200 else None
    t = _tiles[(tx, ty)]
    if t is None:
        return None
    px, py = (fx - tx) * 256 - 0.5, (fy - ty) * 256 - 0.5
    x0, y0 = int(np.clip(math.floor(px), 0, 254)), int(np.clip(math.floor(py), 0, 254))
    wx, wy = min(max(px - x0, 0), 1), min(max(py - y0, 0), 1)
    v = (t[y0, x0] * (1 - wx) * (1 - wy) + t[y0, x0 + 1] * wx * (1 - wy) + t[y0 + 1, x0] * (1 - wx) * wy + t[y0 + 1, x0 + 1] * wx * wy)
    return None if np.isnan(v) else float(v)


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    chk = C.cfg.get("terrain_check")
    if not chk or chk.get("type") not in ("arcgis_identify", "arcgis_points", "gsi_dem_png", "gsi_elevation_api"):
        raise SystemExit(f"{C.id}: no terrain_check of type arcgis_identify, arcgis_points, gsi_dem_png or gsi_elevation_api in city.json")
    dem = load_dem(C)
    B = json.load(open(os.path.join(C.out, "buildings.json")))
    img = Image.new("L", (dem.shape[1], dem.shape[0]), 0)
    d = ImageDraw.Draw(img)
    for s in B["s"]:
        pts = [((s[4][k] / 10 - C.x0) / DEM_CELL, (C.y1 - s[4][k + 1] / 10) / DEM_CELL) for k in range(0, len(s[4]), 2)]
        if len(pts) >= 3:
            d.polygon(pts, fill=1)
    built = np.asarray(img, bool)
    if chk["type"] == "arcgis_points":
        diffs, out = [], []
        for lon, lat, v in spot_heights(chk, C.cfg["bbox"]):
            x, y = C.fwd.transform(lon, lat)
            r, c = int((C.y1 - y) / DEM_CELL), int((x - C.x0) / DEM_CELL)
            if not (0 <= r < dem.shape[0] and 0 <= c < dem.shape[1]) or built[r, c] or dem[r, c] < 0.5:
                continue  # outside, on a footprint, or on water
            z = float(sample(C, dem, x, y)[0])
            diffs.append(z - v)
            out.append([round(x), round(y), round(z, 2), round(v, 2)])
        report(C, chk, diffs, out)
        return
    rows, cols = np.mgrid[10:dem.shape[0] - 10:24, 10:dem.shape[1] - 10:24]  # every 120 m
    pts = [(r, c) for r, c in zip(rows.ravel(), cols.ravel()) if dem[r, c] > 1.0 and not built[r, c]]
    xy = [(C.x0 + c * DEM_CELL, C.y1 - r * DEM_CELL) for r, c in pts]
    lonlat = [C.inv.transform(x, y) for x, y in xy]
    if chk["type"] == "gsi_dem_png":
        vals = [gsi_value(chk, *ll) for ll in lonlat]   # tiles are cached, so no threads
    else:
        with ThreadPoolExecutor(4) as ex:
            vals = list(ex.map(lambda ll: identify(chk, *ll), lonlat))
    diffs, out = [], []
    for (r, c), (x, y), v in zip(pts, xy, vals):
        if v is None:
            continue
        diffs.append(float(dem[r, c]) - v)
        out.append([round(x), round(y), round(float(dem[r, c]), 2), round(v, 2)])
    report(C, chk, diffs, out)


def report(C, chk, diffs, out):
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
