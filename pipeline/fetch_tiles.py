"""Aerial imagery and terrain for a city, from the providers in its city.json.

  imagery  "xyz": any slippy-map tile service ({z}, {x}, {y} in the URL), Web Mercator
           "synth": none; build_scene.py draws the ground from the vector data instead
           (for cities with no openly licensed aerial imagery)
  terrain  "arcgis_image": an ArcGIS ImageServer exportImage of float elevations
           "wcs": an OGC WCS 1.0.0 GetCoverage of float elevations in geographic
                  coordinates (`crs`, e.g. EPSG:4283 for GDA94); pits deeper than
                  `fill_below_m` (voids in the source) are filled from their neighbours
           "tile_index": a GeoJSON index of zipped GeoTIFF tiles in a projected CRS
                         (`index`, `url_field`, `crs`), mosaicked at `pixel_m`; Hong
                         Kong's 2020 LiDAR terrain is published this way
           "terrarium": AWS Terrain Tiles (Mapzen Terrarium PNG). This is a global
                        fallback, and in city centres it is a surface model that
                        includes buildings (Sydney: median 37 m too high), so use a
                        bare-earth source wherever one is open.

Terrarium tiles are always downloaded as well: analysis/radar_check.py uses them
as an independent check of building mass.

    python pipeline/fetch_tiles.py --city sydney

Writes data/raw/<city>/imagery/<z>/<x>_<y>.<ext>, terrarium/15/..., dem.tif and dem.json.
"""
import json
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image

from cityctx import city_args

E = 20037508.342789
TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
UA = {"User-Agent": "open-earth-3d research prototype"}


def tile_xy(lon, lat, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def merc(lon, lat):
    return lon * E / 180, math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137


def tile_range(bbox, z, pad=1):
    w, s, e, n = bbox
    x0, y0 = tile_xy(w, n, z)
    x1, y1 = tile_xy(e, s, z)
    return range(int(x0) - pad, int(x1) + pad + 1), range(int(y0) - pad, int(y1) + pad + 1)


def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return True
    for attempt in range(5):
        try:
            r = requests.get(url, timeout=60, headers=UA)
            if r.status_code == 200:
                with open(path, "wb") as f:
                    f.write(r.content)
                return True
            if r.status_code == 404:
                return False
        except requests.RequestException:
            pass
        time.sleep(2 ** attempt)
    raise RuntimeError(f"failed: {url}")


def fetch_xyz(bbox, tmpl, z, ext, out):
    os.makedirs(out, exist_ok=True)
    xs, ys = tile_range(bbox, z)
    jobs = [(tmpl.format(z=z, x=x, y=y), os.path.join(out, f"{x}_{y}.{ext}")) for x in xs for y in ys]
    with ThreadPoolExecutor(8) as ex:
        ok = sum(ex.map(lambda j: get(*j), jobs))
    return ok, len(jobs), (xs, ys)


def dem_arcgis(bbox, cfg, raw):
    """One float32 GeoTIFF over the bbox in Web Mercator."""
    w, s, e, n = bbox
    x0, y0 = merc(w - 0.002, s - 0.002)
    x1, y1 = merc(e + 0.002, n + 0.002)
    px = cfg.get("pixel_m", 4.0)
    size = (round((x1 - x0) / px), round((y1 - y0) / px))
    r = requests.get(cfg["url"], timeout=300, headers=UA, params=dict(
        bbox=f"{x0},{y0},{x1},{y1}", bboxSR=3857, imageSR=3857, size=f"{size[0]},{size[1]}", format="tiff",
        pixelType="F32", interpolation="RSP_BilinearInterpolation", f="image"))
    r.raise_for_status()
    with open(os.path.join(raw, "dem.tif"), "wb") as f:
        f.write(r.content)
    return [x0, y0, x1, y1], size


def dem_wcs(bbox, cfg, raw):
    """One float32 GeoTIFF over the bbox in geographic coordinates, voids filled."""
    w, s, e, n = bbox[0] - 0.002, bbox[1] - 0.002, bbox[2] + 0.002, bbox[3] + 0.002
    px = cfg.get("pixel_deg", 5.5e-5)
    size = (round((e - w) / px), round((n - s) / px))
    r = requests.get(cfg["url"], timeout=300, headers=UA, params=dict(
        SERVICE="WCS", VERSION="1.0.0", REQUEST="GetCoverage", COVERAGE=cfg.get("coverage", "1"), CRS=cfg.get("crs", "EPSG:4283"),
        BBOX=f"{w},{s},{e},{n}", WIDTH=size[0], HEIGHT=size[1], FORMAT="GeoTIFF"))
    r.raise_for_status()
    if not r.headers.get("content-type", "").startswith("image/tiff"):
        raise SystemExit(f"WCS returned {r.headers.get('content-type')}: {r.text[:300]}")
    path = os.path.join(raw, "dem.tif")
    with open(path, "wb") as f:
        f.write(r.content)
    a = np.asarray(Image.open(path), dtype=np.float32).copy()
    bad = a < cfg.get("fill_below_m", -1e9)
    if bad.any():
        from scipy.ndimage import distance_transform_edt
        idx = distance_transform_edt(bad, return_distances=False, return_indices=True)
        a = a[tuple(idx)]
        Image.fromarray(a).save(path)
    print(f"dem: {bad.sum()} void pixels filled, range {a.min():.1f} to {a.max():.1f} m")
    return [w, s, e, n], size


def read_geotiff(path):
    """A single-band float GeoTIFF in a projected CRS: (array, x0, y1, pixel) from its tie point and
    pixel scale tags; nodata becomes NaN."""
    im = Image.open(path)
    tie, scale = im.tag_v2[33922], im.tag_v2[33550]
    a = np.asarray(im, dtype=np.float32).copy()
    nodata = im.tag_v2.get(42113)
    if nodata is not None:
        a[a == float(str(nodata).strip("\x00"))] = np.nan
    a[a < -1000] = np.nan
    return a, tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1], scale[0]


def dem_tile_index(bbox, cfg, raw, name="dem"):
    """Tiles listed in a GeoJSON index, each a zipped GeoTIFF in a projected CRS (`crs`), downloaded
    once into data/raw/<city>/<name>_tiles/ and mosaicked at `pixel_m` by block means. Holes
    (voids, water the survey left blank) are filled from the nearest valid pixel."""
    import io
    import zipfile
    w, s, e, n = bbox[0] - 0.002, bbox[1] - 0.002, bbox[2] + 0.002, bbox[3] + 0.002
    idx = requests.get(cfg["index"], timeout=300, headers=UA).json()
    urls = []
    for f in idx["features"]:
        cs = [c for ring in f["geometry"]["coordinates"] for c in ring]
        if max(c[0] for c in cs) > w and min(c[0] for c in cs) < e and max(c[1] for c in cs) > s and min(c[1] for c in cs) < n:
            urls.append(f["properties"][cfg.get("url_field", "URL")])
    d = os.path.join(raw, f"{name}_tiles")
    os.makedirs(d, exist_ok=True)
    jobs = [(u, os.path.join(d, u.rsplit("/", 1)[-1])) for u in urls]
    with ThreadPoolExecutor(6) as ex:
        list(ex.map(lambda j: get(*j), jobs))
    tiles = []
    for _, p in jobs:
        with zipfile.ZipFile(p) as z:
            tif = next(m for m in z.namelist() if m.lower().endswith((".tif", ".tiff")))
            tiles.append(read_geotiff(io.BytesIO(z.read(tif))))
    px = cfg.get("pixel_m", 1.0)
    X0 = min(t[1] for t in tiles)
    Y1 = max(t[2] for t in tiles)
    X1 = max(t[1] + t[0].shape[1] * t[3] for t in tiles)
    Y0 = min(t[2] - t[0].shape[0] * t[3] for t in tiles)
    W, Hh = int(round((X1 - X0) / px)), int(round((Y1 - Y0) / px))
    acc, cnt = np.zeros((Hh, W), np.float64), np.zeros((Hh, W), np.int32)
    for a, x0, y1, sc in tiles:
        f = int(round(px / sc))
        h, ww = a.shape[0] // f * f, a.shape[1] // f * f
        b = a[:h, :ww].reshape(h // f, f, ww // f, f)
        ok = np.isfinite(b)
        sm, ct = np.where(ok, b, 0).sum(axis=(1, 3)), ok.sum(axis=(1, 3))
        r0, c0 = int(round((Y1 - y1) / px)), int(round((x0 - X0) / px))
        acc[r0:r0 + sm.shape[0], c0:c0 + sm.shape[1]] += sm
        cnt[r0:r0 + sm.shape[0], c0:c0 + sm.shape[1]] += ct
    out = np.where(cnt > 0, acc / np.maximum(cnt, 1), np.nan).astype(np.float32)
    bad = ~np.isfinite(out)
    if bad.any():
        from scipy.ndimage import distance_transform_edt
        out = out[tuple(distance_transform_edt(bad, return_distances=False, return_indices=True))]
    Image.fromarray(out).save(os.path.join(raw, f"{name}.tif"))
    print(f"{name}: {len(tiles)} tiles at {px} m, {bad.mean() * 100:.1f}% filled, range {out.min():.1f} to {out.max():.1f} m")
    return [X0, Y0, X1, Y1], (W, Hh)


def dem_terrarium(raw, z, xs, ys):
    """Stitch Terrarium tiles into a float32 Web Mercator grid."""
    tiles = os.path.join(raw, "terrarium", str(z))
    a = np.zeros(((ys[-1] - ys[0] + 1) * 256, (xs[-1] - xs[0] + 1) * 256), np.float32)
    for tx in xs:
        for ty in ys:
            p = os.path.join(tiles, f"{tx}_{ty}.png")
            if os.path.exists(p):
                rgb = np.asarray(Image.open(p).convert("RGB")).astype(np.float32)
                a[(ty - ys[0]) * 256:(ty - ys[0] + 1) * 256, (tx - xs[0]) * 256:(tx - xs[0] + 1) * 256] = \
                    rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768
    Image.fromarray(a).save(os.path.join(raw, "dem.tif"))
    span = 2 * E / 2 ** z
    return [xs[0] * span - E, E - (ys[-1] + 1) * span, (xs[-1] + 1) * span - E, E - ys[0] * span], (a.shape[1], a.shape[0])


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    city.ensure_dirs()
    bbox, cfg = city.cfg["bbox"], city.cfg
    im = cfg["imagery"]
    t = time.time()
    if im["type"] == "xyz":
        ok, n, _ = fetch_xyz(bbox, im["url"], im["zoom"], im.get("format", "jpg"), os.path.join(city.raw, "imagery", str(im["zoom"])))
        print(f"imagery: z{im['zoom']}, {ok}/{n} tiles in {time.time() - t:.0f} s")
    else:
        print(f"imagery: {im['type']}, nothing to download")
    ok, n, (xs, ys) = fetch_xyz(bbox, TERRARIUM, 15, "png", os.path.join(city.raw, "terrarium", "15"))
    print(f"terrarium: z15, {ok}/{n} tiles")
    tc = cfg["terrain"]
    if tc["type"] == "arcgis_image":
        mbbox, size = dem_arcgis(bbox, tc, city.raw)
    elif tc["type"] == "terrarium":
        mbbox, size = dem_terrarium(city.raw, 15, list(xs), list(ys))
    elif tc["type"] == "wcs":
        mbbox, size = dem_wcs(bbox, tc, city.raw)
    elif tc["type"] == "tile_index":
        mbbox, size = dem_tile_index(bbox, tc, city.raw)
    else:
        raise SystemExit(f"unknown terrain type {tc['type']}")
    # frame_crs: the datum the local frame's longitudes and latitudes are taken in when converting to
    # the DEM's CRS (GDA2020 for the Australian cities, within 0.5 m of WGS84 there)
    json.dump({"crs": tc.get("crs", "EPSG:4283") if tc["type"] in ("wcs", "tile_index") else "EPSG:3857", "frame_crs": tc.get("frame_crs", "EPSG:7844"),
               "bbox": mbbox, "size": list(size), "source": tc["type"], "bare_earth": tc.get("bare_earth", False)},
              open(os.path.join(city.raw, "dem.json"), "w"))
    print(f"dem: {tc['type']}, {size[0]} x {size[1]} px")
    sc = cfg.get("surface_check")  # a LiDAR surface model, for analysis/lidar_heights.py
    if sc and sc["type"] == "tile_index":
        mbbox, size = dem_tile_index(bbox, sc, city.raw, "dsm")
        json.dump({"crs": sc["crs"], "frame_crs": sc.get("frame_crs", "EPSG:7844"), "bbox": mbbox, "size": list(size), "source": sc["type"]},
                  open(os.path.join(city.raw, "dsm.json"), "w"))


if __name__ == "__main__":
    main()
