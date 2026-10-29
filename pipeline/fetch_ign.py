"""France's national open geodata from IGN's Géoplateforme (data.geopf.fr, Licence
Ouverte / Etalab 2.0), for a city whose city.json has an "ign" block:

  bdtopo  BD TOPO buildings (WFS layer BDTOPO_V3:batiment): cadastral footprints
          with a measured eaves height ("hauteur", from photogrammetry or LiDAR),
          ground and roof altitudes, floor counts, construction dates, use and
          wall and roof materials (from the Fichiers fonciers)
  lidar   LiDAR HD rasters (WMS-R, float32 BIL): the normalised surface model
          (MNH: every return's height above the bare earth, 0.5 m native) and
          the bare-earth model (MNT), in Lambert-93 (EPSG:2154)

    python pipeline/fetch_ign.py --city paris

Writes data/raw/<city>/bdtopo_batiment.json and lidar_<layer>.tif with a .json
sidecar (crs, bbox, size). The terrain itself goes through fetch_tiles.py (its
"wms_bil" terrain type uses the same WMS-R reader as this file).
"""
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image
from pyproj import Transformer

from cityctx import city_args

WFS = "https://data.geopf.fr/wfs/ows"
WMSR = "https://data.geopf.fr/wms-r/wms"
UA = {"User-Agent": "open-earth-3d research prototype"}
MAX_PX = 2500  # the service allows 5010; smaller requests retry faster
LIDAR = {"mnh": "IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93",
         "mnt": "IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93",
         "mns": "IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93"}
KEEP = ("cleabs", "nature", "usage_1", "usage_2", "construction_legere", "date_d_apparition", "methode_d_acquisition_altimetrique",
        "precision_altimetrique", "nombre_de_logements", "nombre_d_etages", "materiaux_des_murs", "materiaux_de_la_toiture", "hauteur",
        "altitude_minimale_sol", "altitude_maximale_sol", "altitude_minimale_toit", "altitude_maximale_toit", "origine_du_batiment",
        "identifiants_rnb")


def _get(url, params, timeout=180):
    for attempt in range(6):
        try:
            r = requests.get(url, params=params, timeout=timeout, headers=UA)
            if r.status_code == 200:
                return r
            print(f"  {r.status_code}: {r.text[:200]}")
        except requests.RequestException as e:
            print(f"  {type(e).__name__}, retrying")
        time.sleep(2 ** attempt)
    raise RuntimeError(f"failed: {url} {params}")


def wms_bil(layer, crs, bbox, px, path, url=WMSR):
    """A float32 raster over bbox (in crs units) at px units per pixel, from an OGC WMS
    that serves image/x-bil;bits=32, in tiles of at most MAX_PX; saved as a float TIFF.
    Returns (bbox actually covered, (width, height))."""
    x0, y0, x1, y1 = bbox
    w, h = int(np.ceil((x1 - x0) / px)), int(np.ceil((y1 - y0) / px))
    x1, y1 = x0 + w * px, y0 + h * px
    a = np.zeros((h, w), np.float32)
    jobs = [(c, r) for r in range(0, h, MAX_PX) for c in range(0, w, MAX_PX)]

    def one(job):
        c, r = job
        tw, th = min(MAX_PX, w - c), min(MAX_PX, h - r)
        bx0, by1 = x0 + c * px, y1 - r * px
        b = (bx0, by1 - th * px, bx0 + tw * px, by1)
        # WMS 1.3.0 takes EPSG:4326 as lat, lon; projected CRSs as x, y
        bb = (b[1], b[0], b[3], b[2]) if crs == "EPSG:4326" else b
        res = _get(url, dict(SERVICE="WMS", VERSION="1.3.0", REQUEST="GetMap", LAYERS=layer, STYLES="", CRS=crs,
                             BBOX=",".join(f"{v:.3f}" if crs != "EPSG:4326" else f"{v:.8f}" for v in bb), WIDTH=tw, HEIGHT=th,
                             FORMAT="image/x-bil;bits=32"))
        if len(res.content) != tw * th * 4:
            raise RuntimeError(f"{layer}: {res.headers.get('content-type')} {res.text[:300]}")
        a[r:r + th, c:c + tw] = np.frombuffer(res.content, "<f4").reshape(th, tw)

    with ThreadPoolExecutor(4) as ex:
        list(ex.map(one, jobs))
    Image.fromarray(a).save(path)
    return [x0, y0, x1, y1], (w, h)


def lambert_bbox(bbox, pad_deg=0.002, crs="EPSG:2154"):
    """The rectangle in a projected CRS (Lambert-93 by default) that covers a lon/lat bbox."""
    w, s, e, n = bbox[0] - pad_deg, bbox[1] - pad_deg, bbox[2] + pad_deg, bbox[3] + pad_deg
    t = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    xs, ys = t.transform([w, e, w, e], [s, s, n, n])
    return [min(xs), min(ys), max(xs), max(ys)]


def fetch_bdtopo(C, cfg):
    """Every BD TOPO building intersecting the bbox, paged 5,000 at a time, as compact rows."""
    w, s, e, n = C.cfg["bbox"]
    out, start = [], 0
    while True:
        r = _get(WFS, dict(SERVICE="WFS", VERSION="2.0.0", REQUEST="GetFeature", TYPENAMES=cfg.get("layer", "BDTOPO_V3:batiment"),
                           OUTPUTFORMAT="application/json", COUNT=5000, STARTINDEX=start, SORTBY="cleabs",
                           BBOX=f"{s},{w},{n},{e},urn:ogc:def:crs:EPSG::4326"), timeout=300)
        fs = r.json()["features"]
        for f in fs:
            g = f["geometry"]
            if not g:
                continue
            polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
            # rings as lon, lat (the z of each vertex is its eaves altitude; the attributes carry it)
            rings = [[[round(v[0], 7), round(v[1], 7)] for v in ring] for p in polys for ring in p[:1]]
            holes = [[[round(v[0], 7), round(v[1], 7)] for v in ring] for p in polys for ring in p[1:]]
            out.append({k: f["properties"].get(k) for k in KEEP} | {"rings": rings, "holes": holes})
        print(f"  bdtopo: {start + len(fs)} buildings")
        if len(fs) < 5000:
            break
        start += 5000
    path = os.path.join(C.raw, "bdtopo_batiment.json")
    json.dump({"source": "IGN BD TOPO (WFS BDTOPO_V3:batiment), Licence Ouverte 2.0", "fetched": time.strftime("%Y-%m-%d"),
               "buildings": out}, open(path, "w"), separators=(",", ":"))
    print(f"bdtopo: {len(out)} buildings -> {path}")


def fetch_lidar(C, cfg):
    bb = lambert_bbox(C.cfg["bbox"])
    for key in cfg.get("layers", ["mnh"]):
        t = time.time()
        px = cfg.get("pixel_m", {}).get(key, 1.0)
        path = os.path.join(C.raw, f"lidar_{key}.tif")
        got, size = wms_bil(LIDAR[key], "EPSG:2154", bb, px, path)
        a = np.asarray(Image.open(path))
        json.dump({"crs": "EPSG:2154", "frame_crs": "EPSG:4326", "bbox": got, "size": list(size), "layer": LIDAR[key], "pixel_m": px},
                  open(path.replace(".tif", ".json"), "w"))
        print(f"lidar {key}: {size[0]} x {size[1]} px at {px} m, {a.min():.1f} to {a.max():.1f} m, in {time.time() - t:.0f} s")


def main():
    C, a = city_args(__doc__.splitlines()[0], lambda ap: ap.add_argument("--only", nargs="+", choices=["bdtopo", "lidar"]))
    C.ensure_dirs()
    ign = C.cfg.get("ign")
    if not ign:
        raise SystemExit(f"{C.id}: no 'ign' block in city.json")
    if "bdtopo" in ign and (not a.only or "bdtopo" in a.only):
        fetch_bdtopo(C, ign["bdtopo"])
    if "lidar" in ign and (not a.only or "lidar" in a.only):
        fetch_lidar(C, ign["lidar"])


if __name__ == "__main__":
    main()
