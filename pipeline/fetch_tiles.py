"""Aerial imagery and terrain for a city, from the providers in its city.json.

  imagery  "xyz": any slippy-map tile service ({z}, {x}, {y} in the URL), Web Mercator
           "stac_cog": a STAC collection of RGB(A) Cloud-Optimized GeoTIFFs (`collection`, `crs`),
                       read from the overview nearest the tile size and cut into Web Mercator tiles
                       at `zoom`, so the rest of the build reads them as it does "xyz" (LINZ's
                       aerial photos, nz-imagery on AWS); `fallback` is a coarser collection for
                       what the first leaves blank
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
                  and non-finite values are filled from their neighbours. With `pixel_m`
                  the coverage is read in a projected `crs` instead, in tiles (the
                  Netherlands' AHN in RD New, EPSG:28992)
           "tile_index": a GeoJSON index of zipped GeoTIFF tiles in a projected CRS
                         (`index`, `url_field`, `crs`), mosaicked at `pixel_m`; Hong
                         Kong's 2020 LiDAR terrain is published this way
           "wms_bil": an OGC WMS GetMap of float32 BIL rasters (`layer`, a projected `crs`,
                      `pixel_m`), e.g. IGN's LiDAR HD bare earth in Lambert-93 (France)
           "stac_cog": a STAC collection of Cloud-Optimized GeoTIFFs in a projected `crs`
                       (`collection`: the collection.json's URL), read over the bbox at
                       `pixel_m` from the overviews; nodata (water, which LINZ leaves blank)
                       is filled from the nearest valid pixel, or set to `water_m` (a level
                       just under a lake's surface). New Zealand's LiDAR (LINZ,
                       nz-elevation on AWS) is published this way, DEM and DSM alike
           "terrarium": AWS Terrain Tiles (Mapzen Terrarium PNG). This is a global
                        fallback, and in city centres it is a surface model that
                        includes buildings (Sydney: median 37 m too high), so use a
                        bare-earth source wherever one is open.

Terrarium tiles are always downloaded as well: analysis/radar_check.py uses them
as an independent check of building mass.

    python pipeline/fetch_tiles.py --city sydney
    python pipeline/fetch_tiles.py --city paris --only dem   # the terrain alone (pipeline/refresh_terrain.py)

Writes data/raw/<city>/imagery/<z>/<x>_<y>.<ext>, terrarium/15/..., dem.tif and dem.json.
"""
import io
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


def wcs_get(cfg, bbox, size, fmt="GeoTIFF"):
    """One WCS 1.0.0 GetCoverage of `cfg`'s coverage over bbox (in its `crs`) as a float array."""
    r = requests.get(cfg["url"], timeout=300, headers=UA, params=dict(
        SERVICE="WCS", VERSION="1.0.0", REQUEST="GetCoverage", COVERAGE=cfg.get("coverage", "1"), CRS=cfg.get("crs", "EPSG:4283"),
        BBOX=",".join(f"{v:.6f}" for v in bbox), WIDTH=size[0], HEIGHT=size[1], FORMAT=cfg.get("format", fmt)))
    r.raise_for_status()
    if not r.headers.get("content-type", "").startswith("image/tiff"):
        raise SystemExit(f"WCS returned {r.headers.get('content-type')}: {r.text[:300]}")
    return np.asarray(Image.open(io.BytesIO(r.content)), dtype=np.float32)


def wcs_tiled(cfg, bbox, px, tile=2000):
    """A float raster over bbox (projected `crs` units) at px per pixel, read in tiles of at most
    `tile` pixels. Returns (array, bbox actually covered)."""
    x0, y0, x1, y1 = bbox
    w, h = int(math.ceil((x1 - x0) / px)), int(math.ceil((y1 - y0) / px))
    x1, y1 = x0 + w * px, y0 + h * px
    a = np.zeros((h, w), np.float32)

    def one(job):
        c, r = job
        tw, th = min(tile, w - c), min(tile, h - r)
        bx0, by1 = x0 + c * px, y1 - r * px
        a[r:r + th, c:c + tw] = wcs_get(cfg, (bx0, by1 - th * px, bx0 + tw * px, by1), (tw, th))

    with ThreadPoolExecutor(4) as ex:
        list(ex.map(one, [(c, r) for r in range(0, h, tile) for c in range(0, w, tile)]))
    return a, [x0, y0, x1, y1]


def dem_wcs(bbox, cfg, raw):
    """One float32 GeoTIFF over the bbox, voids filled: in geographic coordinates at `pixel_deg`,
    or with `pixel_m` in the projected `crs`, read in tiles."""
    path = os.path.join(raw, "dem.tif")
    if "pixel_m" in cfg:
        from fetch_ign import lambert_bbox
        a, mbbox = wcs_tiled(cfg, lambert_bbox(bbox, crs=cfg["crs"]), cfg["pixel_m"])
        size = (a.shape[1], a.shape[0])
    else:
        w, s, e, n = mbbox = [bbox[0] - 0.002, bbox[1] - 0.002, bbox[2] + 0.002, bbox[3] + 0.002]
        px = cfg.get("pixel_deg", 5.5e-5)
        size = (round((e - w) / px), round((n - s) / px))
        a = wcs_get(cfg, mbbox, size).copy()
    Image.fromarray(a).save(path)
    # voids: pits below fill_below_m, spikes above fill_above_m (no-data values the service
    # passes through at the edge of its coverage) and anything not finite
    bad = ~np.isfinite(a) | (a < cfg.get("fill_below_m", -1e9)) | (a > cfg.get("fill_above_m", 1e9))
    if bad.any():
        from scipy.ndimage import distance_transform_edt
        idx = distance_transform_edt(bad, return_distances=False, return_indices=True)
        a = a[tuple(idx)]
        Image.fromarray(a).save(path)
    print(f"dem: {bad.sum()} void pixels filled, range {a.min():.1f} to {a.max():.1f} m")
    return mbbox, size


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


def stac_items(collection, bbox):
    """The COG URLs of a STAC collection's items whose bbox (WGS84) meets bbox."""
    base = collection.rsplit("/", 1)[0]
    c = requests.get(collection, timeout=60, headers=UA).json()
    cb = c.get("extent", {}).get("spatial", {}).get("bbox", [[-180, -90, 180, 90]])[0]
    if not (cb[2] > bbox[0] and cb[0] < bbox[2] and cb[3] > bbox[1] and cb[1] < bbox[3]):
        print(f"stac: {collection} does not reach the bbox")
        return []
    hrefs = [l["href"] for l in c["links"] if l["rel"] == "item"]

    def one(h):
        u = h if h.startswith("http") else base + "/" + h.lstrip("./")
        it = requests.get(u, timeout=60, headers=UA).json()
        b = it["bbox"]
        if b[2] > bbox[0] and b[0] < bbox[2] and b[3] > bbox[1] and b[1] < bbox[3]:
            a = next(iter(it["assets"].values()))["href"]
            return a if a.startswith("http") else u.rsplit("/", 1)[0] + "/" + a.lstrip("./")

    with ThreadPoolExecutor(16) as ex:
        return [u for u in ex.map(one, hrefs) if u]


def _gdal_env():
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.tiff")
    os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "5")
    os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")
    if os.path.exists("/root/.ccr/ca-bundle.crt"):  # a proxied environment's CA bundle, for GDAL's curl
        os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")


def stac_mosaic(collection, bbox, crs, px, bands=1, frame="EPSG:4326", pad_m=200):
    """Every item of a STAC COG collection over bbox, read at px metres in `crs` (a decimated read
    takes the overviews) into one mosaic. Returns (array [bands, h, w], valid mask, [x0, y0, x1, y1])."""
    _gdal_env()
    import rasterio
    from pyproj import Transformer
    from rasterio.windows import from_bounds
    from rasterio.enums import Resampling as Rs
    t = Transformer.from_crs(frame, crs, always_xy=True)
    xs, ys = t.transform([bbox[0], bbox[2], bbox[0], bbox[2]], [bbox[1], bbox[1], bbox[3], bbox[3]])
    X0, Y0 = math.floor((min(xs) - pad_m) / px) * px, math.floor((min(ys) - pad_m) / px) * px
    X1, Y1 = math.ceil((max(xs) + pad_m) / px) * px, math.ceil((max(ys) + pad_m) / px) * px
    W, H = int(round((X1 - X0) / px)), int(round((Y1 - Y0) / px))
    out = np.zeros((bands, H, W), np.float32)
    ok = np.zeros((H, W), bool)
    urls = stac_items(collection, bbox)

    def one(u):
        with rasterio.open("/vsicurl/" + u) as d:
            b = d.bounds
            ix0, iy0, ix1, iy1 = max(b.left, X0), max(b.bottom, Y0), min(b.right, X1), min(b.top, Y1)
            if ix1 <= ix0 or iy1 <= iy0:
                return None
            # snap the intersection to the output grid
            c0, c1 = int(round((ix0 - X0) / px)), int(round((ix1 - X0) / px))
            r0, r1 = int(round((Y1 - iy1) / px)), int(round((Y1 - iy0) / px))
            win = from_bounds(X0 + c0 * px, Y1 - r1 * px, X0 + c1 * px, Y1 - r0 * px, d.transform)
            n = min(bands, d.count)
            # (not boundless: a boundless read goes through a VRT that ignores the overviews)
            a = d.read(list(range(1, n + 1)), window=win, out_shape=(n, r1 - r0, c1 - c0), resampling=Rs.average).astype(np.float32)
            if d.count == 4 and bands == 3:  # RGBA: the alpha band says where the photo is
                m = d.read(4, window=win, out_shape=(r1 - r0, c1 - c0), resampling=Rs.nearest) > 0
            elif d.nodata is not None:
                m = (a[0] != d.nodata) & (a[0] > -1000)
            else:
                m = a.sum(axis=0) > 0
            return r0, r1, c0, c1, a, m

    with ThreadPoolExecutor(6) as ex:
        for res in ex.map(one, urls):
            if res is None:
                continue
            r0, r1, c0, c1, a, m = res
            new = m & ~ok[r0:r1, c0:c1]
            for k in range(bands):
                out[k, r0:r1, c0:c1][new] = a[min(k, a.shape[0] - 1)][new]
            ok[r0:r1, c0:c1] |= m
    print(f"stac: {len(urls)} items of {collection.rsplit('/', 3)[-3]} at {px} m, {ok.mean() * 100:.1f}% covered")
    return out, ok, [X0, Y0, X1, Y1]


def dem_stac(bbox, cfg, raw, name="dem"):
    """A float32 GeoTIFF over the bbox in the collection's projected CRS, its nodata (water) filled
    from the nearest valid pixel."""
    a, ok, mbbox = stac_mosaic(cfg["collection"], bbox, cfg["crs"], cfg.get("pixel_m", 1.0), frame=cfg.get("frame_crs", "EPSG:4326"),
                               pad_m=cfg.get("pad_m", 300))
    a = a[0]
    if not ok.all() and "water_m" in cfg:  # the survey's blank is the lake: a level just under its surface
        a[~ok] = cfg["water_m"]
    elif not ok.all():
        from scipy.ndimage import distance_transform_edt
        a = a[tuple(distance_transform_edt(~ok, return_distances=False, return_indices=True))]
    Image.fromarray(a.astype(np.float32)).save(os.path.join(raw, f"{name}.tif"))
    np.save(os.path.join(raw, f"{name}_valid.npy"), np.packbits(ok))  # where the survey has ground (not water)
    print(f"{name}: {a.shape[1]} x {a.shape[0]} px, {(~ok).mean() * 100:.1f}% filled, range {a.min():.1f} to {a.max():.1f} m")
    return mbbox, (a.shape[1], a.shape[0])


def imagery_stac(bbox, im, out):
    """Web Mercator tiles at im["zoom"] cut from a STAC collection of aerial photos, so that the
    build reads them as an "xyz" service's tiles."""
    from pyproj import Transformer
    from scipy.ndimage import map_coordinates
    z = im["zoom"]
    os.makedirs(out, exist_ok=True)
    xs, ys = tile_range(bbox, z)
    lat = (bbox[1] + bbox[3]) / 2
    tile_m = 2 * E / 2 ** z / 256 * math.cos(math.radians(lat))  # a tile pixel on the ground
    px = im.get("pixel_m", round(tile_m, 2))
    w, s = mlonlat(xs[0] * 256, (ys[-1] + 1) * 256, z)
    e, n = mlonlat((xs[-1] + 1) * 256, ys[0] * 256, z)
    rgb, ok, (X0, Y0, X1, Y1) = stac_mosaic(im["collection"], [w, s, e, n], im["crs"], px, bands=3, pad_m=50)
    if im.get("fallback") and not ok.all():
        fb = im["fallback"]
        a2, ok2, b2 = stac_mosaic(fb["collection"], [w, s, e, n], im["crs"], fb.get("pixel_m", 10.0), bands=3, pad_m=200)
        gy, gx = np.nonzero(~ok)  # only the holes (a full grid of indices would not fit in memory)
        cx = ((X0 + (gx + 0.5) * px - b2[0]) / fb.get("pixel_m", 10.0) - 0.5).astype(np.float32)
        cy = ((b2[3] - (Y1 - (gy + 0.5) * px)) / fb.get("pixel_m", 10.0) - 0.5).astype(np.float32)
        for k in range(3):
            rgb[k][gy, gx] = map_coordinates(a2[k], [cy, cx], order=1, mode="nearest")
        del gy, gx, cx, cy, a2
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    t = Transformer.from_crs("EPSG:4326", im["crs"], always_xy=True)
    ext = im.get("format", "jpg")
    n = 0
    for tx in xs:
        for ty in ys:
            gx, gy = np.meshgrid(tx * 256 + np.arange(256) + 0.5, ty * 256 + np.arange(256) + 0.5)
            lon, la = mlonlat(gx, gy, z)
            mx, my = t.transform(lon.ravel(), la.ravel())
            c = (np.asarray(mx) - X0) / px - 0.5
            r = (Y1 - np.asarray(my)) / px - 0.5
            tile = np.stack([map_coordinates(rgb[k], [r, c], order=1, mode="nearest").reshape(256, 256) for k in range(3)], -1)
            Image.fromarray(tile).save(os.path.join(out, f"{tx}_{ty}.{ext}"), quality=90)
            n += 1
    return n, n, (xs, ys)


def mlonlat(px, py, z):
    """Longitude and latitude of global pixel coordinates at zoom z (256 px tiles)."""
    nn = 2 ** z * 256
    lon = np.asarray(px) / nn * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * np.asarray(py) / nn))))
    return lon, lat


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
    city, a = city_args(__doc__.splitlines()[0], lambda ap: ap.add_argument("--only", choices=["dem"], help="fetch the terrain alone"))
    city.ensure_dirs()
    bbox, cfg = city.cfg["bbox"], city.cfg
    im = cfg["imagery"]
    t = time.time()
    xs = ys = []
    if a.only == "dem":
        print("imagery and terrarium: skipped (--only dem)")
    elif im["type"] == "stac_cog":
        ok, n, _ = imagery_stac(bbox, im, os.path.join(city.raw, "imagery", str(im["zoom"])))
        print(f"imagery: stac z{im['zoom']}, {n} tiles in {time.time() - t:.0f} s")
    elif im["type"] == "xyz":
        ok, n, _ = fetch_xyz(bbox, im["url"], im["zoom"], im.get("format", "jpg"), os.path.join(city.raw, "imagery", str(im["zoom"])))
        print(f"imagery: z{im['zoom']}, {ok}/{n} tiles in {time.time() - t:.0f} s")
    else:
        print(f"imagery: {im['type']}, nothing to download")
    if a.only != "dem" or cfg["terrain"]["type"] == "terrarium":
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
    elif tc["type"] == "tile_index":
        mbbox, size = dem_tile_index(bbox, tc, city.raw)
    elif tc["type"] == "stac_cog":
        mbbox, size = dem_stac(bbox, tc, city.raw)
    elif tc["type"] == "wms_bil":
        from fetch_ign import lambert_bbox, wms_bil
        mbbox, size = wms_bil(tc["layer"], tc["crs"], lambert_bbox(bbox, crs=tc["crs"]), tc.get("pixel_m", 2.0), os.path.join(city.raw, "dem.tif"), url=tc["url"])
    else:
        raise SystemExit(f"unknown terrain type {tc['type']}")
    # frame_crs: the datum the local frame's longitudes and latitudes are taken in when converting to
    # the DEM's CRS (GDA2020 for the Australian cities, within 0.5 m of WGS84 there; WGS84 for IGN's)
    crs = tc.get("crs", "EPSG:4283") if tc["type"] in ("wcs", "tile_index", "wms_bil", "stac_cog") else "EPSG:3857"
    frame = tc.get("frame_crs", "EPSG:4326" if tc["type"] in ("wms_bil", "stac_cog") else "EPSG:7844")
    json.dump({"crs": crs, "frame_crs": frame, "bbox": mbbox, "size": list(size), "source": tc["type"], "bare_earth": tc.get("bare_earth", False)},
              open(os.path.join(city.raw, "dem.json"), "w"))
    print(f"dem: {tc['type']}, {size[0]} x {size[1]} px")
    sc = cfg.get("surface_check")  # a LiDAR surface model, for analysis/lidar_heights.py
    if sc and sc["type"] in ("tile_index", "stac_cog") and a.only != "dem":
        mbbox, size = (dem_tile_index if sc["type"] == "tile_index" else dem_stac)(bbox, sc, city.raw, "dsm")
        json.dump({"crs": sc["crs"], "frame_crs": sc.get("frame_crs", "EPSG:7844" if sc["type"] == "tile_index" else "EPSG:4326"), "bbox": mbbox, "size": list(size), "source": sc["type"]},
                  open(os.path.join(city.raw, "dsm.json"), "w"))


if __name__ == "__main__":
    main()
