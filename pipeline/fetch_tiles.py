"""Aerial imagery and terrain for a city, from the providers in its city.json.

  imagery  "xyz": any slippy-map tile service ({z}, {x}, {y} in the URL), Web Mercator
           "synth": none; build_scene.py draws the ground from the vector data instead
           (for cities with no openly licensed aerial imagery)
  terrain  "arcgis_image": an ArcGIS ImageServer exportImage of float elevations
           "gsi_dem_png": GSI (Japan) DEM tiles: 5 m airborne-LiDAR bare earth (dem5a_png, zoom 15),
                        with an optional coarser "fallback" tile set (dem_png, zoom 14) for gaps;
                        "holes": "sea_level" where a cell neither set covers is the sea (Tokyo Bay),
                        else it takes the nearest valid cell
           "wcs": an OGC WCS 1.0.0 GetCoverage of float elevations in geographic
                  coordinates (`crs`, e.g. EPSG:4283 for GDA94); pits deeper than
                  `fill_below_m`, spikes higher than `fill_above_m` (voids in the source)
                  and non-finite values are filled from their neighbours
           "wms_bil": an OGC WMS GetMap of float32 BIL rasters (`layer`, a projected `crs`,
                      `pixel_m`), e.g. IGN's LiDAR HD bare earth in Lambert-93 (France)
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
    # voids: pits below fill_below_m, spikes above fill_above_m (no-data values the service
    # passes through at the edge of its coverage) and anything not finite
    bad = ~np.isfinite(a) | (a < cfg.get("fill_below_m", -1e9)) | (a > cfg.get("fill_above_m", 1e9))
    if bad.any():
        from scipy.ndimage import distance_transform_edt
        idx = distance_transform_edt(bad, return_distances=False, return_indices=True)
        a = a[tuple(idx)]
        Image.fromarray(a).save(path)
    print(f"dem: {bad.sum()} void pixels filled, range {a.min():.1f} to {a.max():.1f} m")
    return [w, s, e, n], size


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


def gsi_decode(path):
    """GSI PNG elevation tiles: x = 65536 R + 256 G + B; 2^23 is no data; metres = x / 100."""
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.int64)
    x = a[..., 0] * 65536 + a[..., 1] * 256 + a[..., 2]
    h = np.where(x < 2 ** 23, x, x - 2 ** 24) * 0.01
    h[x == 2 ** 23] = np.nan
    return h.astype(np.float32)


def dem_gsi(bbox, cfg, raw):
    """Stitch GSI elevation tiles into a float32 Web Mercator grid; gaps come from the
    fallback tiles (bilinear), then the nearest valid cell, or sea level with "holes": "sea_level"."""
    from scipy.ndimage import distance_transform_edt, zoom as ndzoom
    z = cfg["zoom"]
    d1 = os.path.join(raw, "gsi_dem", str(z))
    ok, n, (xs, ys) = fetch_xyz(bbox, cfg["url"], z, "png", d1)
    xs, ys = list(xs), list(ys)
    fb = cfg.get("fallback")
    sea = cfg.get("holes") == "sea_level"
    a = np.full(((ys[-1] - ys[0] + 1) * 256, (xs[-1] - xs[0] + 1) * 256), np.nan, np.float32)
    filled = 0
    for tx in xs:
        for ty in ys:
            p = os.path.join(d1, f"{tx}_{ty}.png")
            t = gsi_decode(p) if os.path.exists(p) else np.full((256, 256), np.nan, np.float32)
            if fb and np.isnan(t).any():
                f = 2 ** (z - fb["zoom"])
                q = os.path.join(raw, "gsi_dem", f"fb{fb['zoom']}", f"{tx // f}_{ty // f}.png")
                os.makedirs(os.path.dirname(q), exist_ok=True)
                if get(fb["url"].format(z=fb["zoom"], x=tx // f, y=ty // f), q):
                    c = gsi_decode(q)
                    if not sea:  # a gap in both is a gap in the survey, not the sea
                        c = np.where(np.isnan(c), np.nanmedian(c) if (~np.isnan(c)).any() else 0, c)
                    s = 256 // f
                    sub = c[(ty % f) * s:(ty % f + 1) * s, (tx % f) * s:(tx % f + 1) * s]
                    up = ndzoom(sub, f, order=1)
                    m = np.isnan(t)
                    t[m] = up[m]
                    filled += int(m.sum())
            a[(ty - ys[0]) * 256:(ty - ys[0] + 1) * 256, (tx - xs[0]) * 256:(tx - xs[0] + 1) * 256] = t
    bad = np.isnan(a)
    if bad.any() and sea:
        a[bad] = 0.0
    elif bad.any():
        idx = distance_transform_edt(bad, return_distances=False, return_indices=True)
        a = a[tuple(idx)]
    print(f"gsi dem: {ok}/{n} tiles, {filled} gap px from the fallback, {int(bad.sum())} px filled by {'sea level' if sea else 'nearest'}")
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
    elif tc["type"] == "gsi_dem_png":
        mbbox, size = dem_gsi(bbox, tc, city.raw)
    elif tc["type"] == "terrarium":
        mbbox, size = dem_terrarium(city.raw, 15, list(xs), list(ys))
    elif tc["type"] == "wcs":
        mbbox, size = dem_wcs(bbox, tc, city.raw)
    elif tc["type"] == "wms_bil":
        from fetch_ign import lambert_bbox, wms_bil
        mbbox, size = wms_bil(tc["layer"], tc["crs"], lambert_bbox(bbox, crs=tc["crs"]), tc.get("pixel_m", 2.0), os.path.join(city.raw, "dem.tif"), url=tc["url"])
    else:
        raise SystemExit(f"unknown terrain type {tc['type']}")
    crs = tc.get("crs", "EPSG:4283") if tc["type"] in ("wcs", "wms_bil") else "EPSG:3857"
    json.dump({"crs": crs, "bbox": mbbox, "size": list(size), "source": tc["type"], "bare_earth": tc.get("bare_earth", False)}
              | ({"frame_crs": "EPSG:4326"} if tc["type"] == "wms_bil" else {}),
              open(os.path.join(city.raw, "dem.json"), "w"))
    print(f"dem: {tc['type']}, {size[0]} x {size[1]} px")


if __name__ == "__main__":
    main()
