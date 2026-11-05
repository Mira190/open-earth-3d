"""LiDAR terrain and imagery for an alpine site from Toitū Te Whenua LINZ's open data on AWS.

LINZ publishes New Zealand's elevation and aerial imagery as Cloud-Optimized GeoTIFFs in NZTM2000
(EPSG:2193), one file per 1:50k map sheet, in two public buckets (CC BY 4.0, no key):

  s3://nz-elevation  the national LiDAR 1 m DEM (a composite of every capture, newest on top), the
                     contour-interpolated 8 m DEM, and each regional capture on its own
  s3://nz-imagery    rural and urban aerial photos (7.5 cm to 0.4 m) and the yearly 10 m
                     satellite mosaics (Sentinel-2, colour balanced, summer)

Every COG carries internal overviews (2x, 4x, 8x ...), so a read at a coarser resolution than the
file's fetches only that overview: the whole Pukaki frame at 16 m is a few tens of MB, where the
1 m data would be gigabytes.

    python pipeline/fetch_linz.py --city lake-pukaki
    python pipeline/fetch_linz.py --city lake-pukaki --only imagery

city.json:
  "terrain": {"type": "linz_cog", "url": ".../{sheet}.tiff", "fallback": ".../{sheet}.tiff",
              "sheets": [...], "read_m": 16}
  "imagery": {"type": "linz_cog", "url": ".../{sheet}.tiff", "sheets": [...], "pixel_m": 10}
  "detail":  [{"id", "url", "read_m", "nztm": [e0, n0, e1, n1]}]   optional finer windows

writes data/raw/<id>/linz/<kind>_<sheet>.tif (GeoTIFF, EPSG:2193), skipping files already there.
"""
import os
import time

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.windows import from_bounds

from cityctx import city_args

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "6")
os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")
for ca in ("/root/.ccr/ca-bundle.crt",):
    if os.path.exists(ca):
        os.environ.setdefault("CURL_CA_BUNDLE", ca)


def read_sheet(url, read_m, bands=None, window_nztm=None):
    """One sheet (or a window of it) at read_m metres a pixel, as (array, transform, crs, nodata)."""
    with rasterio.open("/vsicurl/" + url) as r:
        res = r.res[0]
        f = max(1, int(round(read_m / res)))
        win = from_bounds(*window_nztm, r.transform).round_offsets().round_lengths() if window_nztm else None
        if win is not None:
            win = win.intersection(rasterio.windows.Window(0, 0, r.width, r.height))
        w = (win.width if win is not None else r.width) // f
        h = (win.height if win is not None else r.height) // f
        idx = bands or list(range(1, r.count + 1))
        data = r.read(idx, out_shape=(len(idx), h, w), window=win, resampling=Resampling.average)
        t0 = r.window_transform(win) if win is not None else r.transform
        tf = t0 * Affine.scale((win.width if win is not None else r.width) / w, (win.height if win is not None else r.height) / h)
        return data, tf, r.crs, r.nodata


def save(path, data, tf, crs, nodata):
    prof = dict(driver="GTiff", width=data.shape[2], height=data.shape[1], count=data.shape[0], dtype=data.dtype,
                crs=crs, transform=tf, compress="deflate", tiled=True, nodata=nodata)
    if data.dtype == np.float32:
        prof["predictor"] = 3
    with rasterio.open(path + ".part", "w", **prof) as o:
        o.write(data)
    os.replace(path + ".part", path)


def fetch(kind, url, sheets, read_m, out, bands=None):
    for s in sheets:
        path = os.path.join(out, f"{kind}_{s}.tif")
        if os.path.exists(path):
            continue
        for k in range(5):
            try:
                t = time.time()
                data, tf, crs, nd = read_sheet(url.format(sheet=s), read_m, bands)
                save(path, data, tf, crs, nd)
                print(f"{kind} {s}: {data.shape[2]} x {data.shape[1]} at {tf.a:.1f} m in {time.time() - t:.0f} s", flush=True)
                break
            except Exception as e:      # a dropped connection mid-read: try again
                print(f"{kind} {s}: {e}; retrying", flush=True)
                time.sleep(4 * (k + 1))
        else:
            raise SystemExit(f"could not read {kind} {s}")


def main():
    city, a = city_args(__doc__.splitlines()[0], lambda ap: ap.add_argument("--only", nargs="+", help="terrain, fallback, imagery, detail"))
    out = os.path.join(city.raw, "linz")
    os.makedirs(out, exist_ok=True)
    cfg = city.cfg
    want = lambda k: not a.only or k in a.only
    T = cfg["terrain"]
    if want("terrain"):
        fetch("dem", T["url"], T["sheets"], T.get("read_m", 16), out)
    if want("fallback") and T.get("fallback"):
        fetch("dem8", T["fallback"], T["sheets"], max(8, T.get("read_m", 16)), out)
    I = cfg["imagery"]
    if want("imagery"):
        fetch("img", I["url"], I["sheets"], I.get("pixel_m", 10), out, bands=[1, 2, 3])
    if want("detail"):
        for d in cfg.get("detail", []):
            for s in d["sheets"]:
                path = os.path.join(out, f"detail_{d['id']}_{s}.tif")
                if os.path.exists(path):
                    continue
                try:
                    data, tf, crs, nd = read_sheet(d["url"].format(sheet=s), d["read_m"], d.get("bands"), d["nztm"])
                except Exception as e:
                    print(f"detail {d['id']} {s}: {e}")
                    continue
                if data.size:
                    save(path, data, tf, crs, nd)
                    print(f"detail {d['id']} {s}: {data.shape[2]} x {data.shape[1]} at {tf.a:.2f} m", flush=True)


if __name__ == "__main__":
    main()
