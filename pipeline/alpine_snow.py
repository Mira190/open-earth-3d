"""The season's snow on an alpine site, from the latest clear Sentinel-2 pass: the ground imagery is a summer
mosaic, so in spring the snow it shows is the end of summer's, far higher than the real snowline.

    python pipeline/alpine_snow.py --city lake-pukaki [--before 2026-11-05]

Finds the clearest Sentinel-2 L2A scene of the last six weeks over the site (Earth Search on AWS; Copernicus open
licence), and maps snow by the normalised difference snow index, NDSI = (B03 - B11) / (B03 + B11) > 0.4, with
B08 > 0.11 to keep dark water out (Dozier 1989; the MODIS and Sentinel-2 snow products' test). Cloud is taken out
by the scene classification layer (SCL 8, 9, 10: cloud, cirrus), where the summer mosaic's snow is kept.
Writes web/data/<id>/snow.png (snow cover 0..255 on a 20 m grid in the site's frame) and scene.json "snow":
{file, w, h, px_m, date, scene}. The viewer lays it over the summer colour from winter into early summer
(web/reef/alpine/terrain.js).
"""
import datetime as dt
import json
import os

import numpy as np
import rasterio
import requests
from PIL import Image
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds
from scipy import ndimage

from cityctx import city_args

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
if os.path.exists("/root/.ccr/ca-bundle.crt"):
    os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")
STAC = "https://earth-search.aws.element84.com/v1/search"


def band(href, proj, tf, shape, bounds, resampling=Resampling.average):
    out = np.full(shape, np.nan, np.float32)
    with rasterio.open(href) as r:
        b = transform_bounds(proj, r.crs, *bounds)
        win = from_bounds(*b, r.transform).intersection(rasterio.windows.Window(0, 0, r.width, r.height))
        data = r.read(1, window=win).astype(np.float32)
        nod = r.nodata
        if nod is not None:
            data[data == nod] = np.nan
        reproject(data, out, src_transform=r.window_transform(win), src_crs=r.crs, src_nodata=np.nan,
                  dst_transform=tf, dst_crs=proj, dst_nodata=np.nan, resampling=resampling)
    return out


def main():
    city, a = city_args(__doc__.splitlines()[0], lambda ap: ap.add_argument("--before", help="latest date to consider (YYYY-MM-DD), default today"))
    before = dt.date.fromisoformat(a.before) if a.before else dt.date.today()
    after = before - dt.timedelta(days=42)
    q = {"collections": ["sentinel-2-l2a"], "bbox": city.cfg["bbox"], "datetime": f"{after}T00:00:00Z/{before}T23:59:59Z", "limit": 100,
         "query": {"eo:cloud_cover": {"lt": 15}}}
    feats = requests.post(STAC, json=q, timeout=60).json()["features"]
    if not feats:
        raise SystemExit("no clear Sentinel-2 scene in the last six weeks")
    # a site wider than one orbit's swath needs two passes (two relative orbits, ten minutes apart): for each, the
    # newest of the clearest (the lowest cloud within 5 points of that orbit's best, then the latest); the newest
    # pass first, the other filling what its swath misses
    orbits = {}
    for f in feats:
        orbits.setdefault(f["properties"].get("sat:relative_orbit") or f["properties"]["datetime"][11:16], []).append(f)
    picks = []
    for fs in orbits.values():
        best = min(f["properties"]["eo:cloud_cover"] for f in fs)
        picks.append(max((f for f in fs if f["properties"]["eo:cloud_cover"] <= best + 5), key=lambda f: f["properties"]["datetime"]))
    picks.sort(key=lambda f: f["properties"]["datetime"], reverse=True)
    px = 20
    W, H = round((city.x1 - city.x0) / px), round((city.y1 - city.y0) / px)
    tf = from_origin(city.x0, city.y1, px, px)
    bounds = (city.x0, city.y0, city.x1, city.y1)
    g, sw, nir, scl = (np.full((H, W), np.nan, np.float32) for _ in range(4))
    used = []
    for f in picks:
        P = f["properties"]
        A = f["assets"]
        off = float(P.get("earthsearch:boa_offset_applied") is False) * 0.1   # L2A baseline 04.00 adds 1000 unless removed
        bg = band(A["green"]["href"], city.proj, tf, (H, W), bounds) * 1e-4 - off
        need = ~np.isfinite(g) & np.isfinite(bg)
        if need.mean() < 0.01:
            continue
        bs = band(A["swir16"]["href"], city.proj, tf, (H, W), bounds) * 1e-4 - off
        bn = band(A["nir"]["href"], city.proj, tf, (H, W), bounds) * 1e-4 - off
        bc = band(A["scl"]["href"], city.proj, tf, (H, W), bounds, Resampling.nearest)
        g[need], sw[need], nir[need], scl[need] = bg[need], bs[need], bn[need], bc[need]
        used.append(f)
        print(f"{f['id']}: {P['datetime'][:10]}, cloud {P['eo:cloud_cover']:.1f}%, fills {100 * need.mean():.0f}% of the frame")
    f, P = used[0], used[0]["properties"]
    ndsi = (g - sw) / np.maximum(g + sw, 1e-4)
    snow = ((ndsi > 0.4) & (nir > 0.11)).astype(np.float32)
    # a soft edge (two cells), so the snowline is not a 20 m staircase
    soft = ndimage.gaussian_filter(snow, 1.0)
    cloud = np.isin(scl, [8, 9, 10]) | ~np.isfinite(g)
    out = np.where(cloud, 255, np.clip(soft * 254, 0, 254)).astype(np.uint8)   # 255: no reading (cloud), the summer colour stays
    Image.fromarray(out).save(os.path.join(city.out, "snow.png"), optimize=True)
    sc_path = os.path.join(city.out, "scene.json")
    scene = json.load(open(sc_path))
    scene["snow"] = {"file": "snow.png", "w": W, "h": H, "px_m": px, "date": P["datetime"][:10], "scene": f["id"], "scenes": [u["id"] for u in used],
                     "src": "Copernicus Sentinel-2 L2A via Earth Search on AWS (Copernicus open licence); NDSI > 0.4 and B08 > 0.11; 255 = cloud"}
    json.dump(scene, open(sc_path, "w"), indent=1)
    land = ~cloud
    print(f"snow over {100 * snow[land].mean():.1f}% of the cloud-free frame, {100 * cloud.mean():.1f}% cloud; snow.png {os.path.getsize(os.path.join(city.out, 'snow.png')) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
