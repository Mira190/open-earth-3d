"""The land past the model's frame: its relief, its land cover and its lights after dark.

Past the frame the city is haze (web/world.js edgeHaze) and the sea carries on where there is
open water (open_sea.py, sea.jpg). This bakes what the land there is like, for a low far terrain
drawn under that haze (web/world.js farLand, web/reef/world.js for the reef sites): the hills
rise into the haze, the forests are darker than the suburbs and the farmland, and after dark the
built-up land glows as it does in a night photograph from the air.

Sources (measured open data, newest releases; see docs/ARCHITECTURE.md "Past the frame"):
  relief      Copernicus DEM GLO-30 (ESA / Airbus, Copernicus DEM licence, free for any use with
              attribution), Cloud-Optimized GeoTIFFs on the AWS open data registry. It is a
              surface model, so the trees' and the buildings' share is taken back out of it
              (CANOPY_M, BUILT_M x their share of the cell) to stand for the bare ground.
  land cover  ESA WorldCover 10 m 2021 v200 (CC BY 4.0), its 40 m overview, as each class's share
              of a cell.
  lights      NASA Black Marble 2016 (VIIRS day/night band, public domain) via NASA GIBS, about
              500 m, sharpened by WorldCover's built-up share.

The land cover's colours are measured too: each class's colour is solved (least squares, held
toward a default) from the city's own aerial photo inside the frame against the classes' shares
there, so the land past the frame takes up where the photo leaves off.

Writes web/data/<id>/
  far.png   HALF_M either side of the frame's centre, north up, NH x NH, RGB:
            r, g  height, (r * 256 + g) / 4 - 100 m; water at sea level is pushed under it
            b     night lights, sqrt-encoded (0..1)
  far.jpg   NC x NC, the land cover's colour (sRGB) from the classes' shares and palette
  far.json  the box, the encoding and the sources

    python pipeline/far_land.py --city kyoto
    python pipeline/far_land.py --all          # every built city and reef site
"""
import argparse
import io
import json
import math
import os
import time

import numpy as np
import requests
from PIL import Image
from scipy import ndimage

from cityctx import ROOT, City

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
if os.path.exists("/root/.ccr/ca-bundle.crt"):  # a proxied environment's CA bundle, for GDAL's curl
    os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")

import rasterio  # noqa: E402  (after GDAL's environment)
import rasterio.windows  # noqa: E402
from rasterio.transform import from_origin  # noqa: E402
from rasterio.warp import Resampling, reproject  # noqa: E402

HALF_M = {"city": 40000, "marine": 60000}  # web/world.js reads it from far.json
NH = 512   # the height grid (156 m in a city, 234 m at a reef site)
NC = 1024  # the colour grid
DEM_URL = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif"
WC_URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{ns}{lat:02d}{ew}{lon:03d}_Map.tif"
BM_WMS = ("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
          "&LAYERS=VIIRS_Black_Marble&STYLES=&CRS=EPSG:4326&BBOX={s},{w},{n},{e}&WIDTH={W}&HEIGHT={H}&FORMAT=image/png&TIME=2016-01-01")
UA = {"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"}
# WorldCover's classes, and a default colour for each (sRGB, as Sentinel-2 true colour shows them)
CLASSES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100]
NAMES = {10: "tree cover", 20: "shrubland", 30: "grassland", 40: "cropland", 50: "built-up", 60: "bare or sparse",
         70: "snow and ice", 80: "water", 90: "herbaceous wetland", 95: "mangroves", 100: "moss and lichen"}
DEFAULT = {10: (52, 72, 44), 20: (92, 98, 66), 30: (124, 132, 88), 40: (136, 134, 96), 50: (138, 132, 126), 60: (166, 152, 126),
           70: (236, 238, 240), 80: (34, 56, 70), 90: (82, 96, 70), 95: (44, 64, 48), 100: (120, 120, 96)}
BUILT_SHADE = 0.72  # palette(): the drawn city's tone against its photo's
CANOPY_M, BUILT_M = 10.0, 6.0  # what the surface model's trees and buildings add, averaged over the cell
# a reef site's habitat.png land classes, as WorldCover's (fetch_sentinel / build_marine)
HABITAT_WC = {10: 10, 11: 20, 12: 30, 13: 60, 14: 95, 15: 50, 16: 90}


def tiles(w, s, e, n, step):
    out = []
    for la in range(math.floor(s / step) * step, math.ceil(n / step) * step, step):
        for lo in range(math.floor(w / step) * step, math.ceil(e / step) * step, step):
            out.append((la, lo))
    return out


def tile_url(tmpl, la, lo):
    return tmpl.format(ns="N" if la >= 0 else "S", lat=abs(la), ew="E" if lo >= 0 else "W", lon=abs(lo))


class Box:
    def __init__(self, C, half):
        self.C, self.half = C, half
        self.cx, self.cy = (C.x0 + C.x1) / 2, (C.y0 + C.y1) / 2
        xs = np.linspace(self.cx - half, self.cx + half, 21)
        ys = np.linspace(self.cy - half, self.cy + half, 21)
        X, Y = np.meshgrid(xs, ys)
        lon, lat = C.inv.transform(X.ravel(), Y.ravel())
        self.w, self.e, self.s, self.n = min(lon) - 0.01, max(lon) + 0.01, min(lat) - 0.01, max(lat) + 0.01

    def grid(self, n):
        cell = 2 * self.half / n
        return from_origin(self.cx - self.half, self.cy + self.half, cell, cell), (n, n)


def warp(box, url_tmpl, step, n, resampling, overview, fill, dtype=np.float32, band_fn=None):
    """Every tile of a 1 or 3 degree grid that the box touches, warped into the box's n x n grid."""
    tr, shape = box.grid(n)
    out = np.full(shape, np.nan, np.float32)
    for la, lo in tiles(box.w, box.s, box.e, box.n, step):
        url = tile_url(url_tmpl, la, lo)
        if requests.head(url, headers=UA, timeout=60).status_code != 200:
            continue  # the sea (GLO-30 has no ocean tiles; WorldCover none far out)
        with rasterio.open("/vsicurl/" + url, overview_level=overview) as src:
            win = rasterio.windows.from_bounds(max(box.w, src.bounds.left), max(box.s, src.bounds.bottom),
                                               min(box.e, src.bounds.right), min(box.n, src.bounds.top), src.transform)
            win = win.round_offsets().round_lengths()
            a = src.read(1, window=win)
            wtr = src.window_transform(win)
            crs = src.crs
        layers = band_fn(a) if band_fn else [a.astype(np.float32)]
        res = []
        for lay in layers:
            dst = np.full(shape, np.nan, np.float32)
            reproject(lay.astype(np.float32), dst, src_transform=wtr, src_crs=crs, dst_transform=tr, dst_crs=box.C.proj,
                      resampling=resampling, src_nodata=np.nan, dst_nodata=np.nan)
            res.append(dst)
        if band_fn:
            if out.ndim == 2:
                out = np.full((len(res),) + shape, np.nan, np.float32)
            for k, d in enumerate(res):
                m = ~np.isnan(d)
                out[k][m] = d[m]
        else:
            m = ~np.isnan(res[0])
            out[m] = res[0][m]
    return np.nan_to_num(out, nan=fill)


def landcover(box):
    """Each WorldCover class's share of a cell, (len(CLASSES), NC, NC); 0 where there is none (open sea)."""
    split = lambda a: [(a == c).astype(np.float32) for c in CLASSES]
    fr = warp(box, WC_URL, 3, NC, Resampling.average, 1, 0.0, band_fn=split)
    if fr.ndim == 2:  # nothing at all
        fr = np.zeros((len(CLASSES), NC, NC), np.float32)
    s = fr.sum(axis=0)
    # no class: open water past WorldCover's coverage
    fr[CLASSES.index(80)] += np.clip(1 - s, 0, 1)
    return fr / np.maximum(fr.sum(axis=0), 1e-6)


def photo_samples(C, box):
    """The city's own photo inside the frame on the colour grid: (mask, rgb), or a reef site's
    Sentinel-2 ground over its land classes (with those classes' shares from habitat.png)."""
    tr, shape = box.grid(NC)
    cell = tr.a
    rgb = np.zeros(shape + (3,), np.float32)
    n = np.zeros(shape, np.float32)
    scene = json.load(open(os.path.join(C.out, "scene.json")))
    ground = scene.get("ground")
    pieces = []
    if isinstance(ground, list):
        pieces = [(g["file"], g["x0"], g["x1"], g["y0"], g["y1"]) for g in ground]
    elif isinstance(ground, dict):
        w, h, px = ground["w"], ground["h"], ground["px_m"]
        x0, y1 = C.x0, C.y1
        pieces = [(ground["file"], x0, x0 + w * px, y1 - h * px, y1)]
    for f, x0, x1, y0, y1 in pieces:
        p = os.path.join(C.out, f)
        if not os.path.exists(p):
            continue
        c0, c1 = int(round((x0 - (box.cx - box.half)) / cell)), int(round((x1 - (box.cx - box.half)) / cell))
        r0, r1 = int(round(((box.cy + box.half) - y1) / cell)), int(round(((box.cy + box.half) - y0) / cell))
        if c1 <= c0 or r1 <= r0:
            continue
        im = Image.open(p).convert("RGB").resize((c1 - c0, r1 - r0), Image.BOX)
        a = np.asarray(im, np.float32)
        ok = a.max(axis=2) > 6  # no data
        rgb[r0:r1, c0:c1][ok] += a[ok]
        n[r0:r1, c0:c1][ok] += 1
    m = n > 0
    rgb[m] /= n[m][:, None]
    return m, rgb


def palette(C, box, fr):
    """Each class's colour, solved from the photo inside the frame against the classes' shares there."""
    m, rgb = photo_samples(C, box)
    pal = {c: np.array(DEFAULT[c], np.float32) for c in CLASSES}
    if m.sum() < 200:
        return pal, 0
    A = fr[:, m].T  # (samples, classes)
    lam = 4.0 * len(A) / 1000  # held toward the default where a class is rare
    D = np.array([DEFAULT[c] for c in CLASSES], np.float32)
    share = A.sum(axis=0)
    W = lam * np.diag(1 + 50 * (share < 0.002 * len(A)))
    for ch in range(3):
        b = rgb[m][:, ch]
        x = np.linalg.solve(A.T @ A + W, A.T @ b + W @ D[:, ch])
        for k, c in enumerate(CLASSES):
            pal[c][ch] = np.clip(x[k], 8, 245)
    # an aerial photo's shadows under a canopy are skylight blue (world.js woodsFloor): each class keeps
    # the solved brightness, with its hue mostly the default's
    lum = lambda v: float(0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2])
    for c in CLASSES:
        d = np.array(DEFAULT[c], np.float32)
        k = float(np.clip(lum(pal[c]) / lum(d), 0.6, 1.4))  # a photo's haze or shade, not a different land
        pal[c] = np.clip(0.35 * pal[c] * k * lum(d) / max(lum(pal[c]), 1) + 0.65 * d * k, 8, 245)
    # the drawn city is darker than the photo under it: its buildings stand up, shade one another
    # and have dark roofs and windows the ortho photo flattens. The built-up land past it takes that.
    pal[50] = pal[50] * BUILT_SHADE
    # the water inside the frame is the city's own rendered water, not a class colour for the land; keep the default
    pal[80] = np.array(DEFAULT[80], np.float32)
    return pal, int(m.sum())


def lights(box, built):
    """Night lights on the height grid, 0..1: Black Marble's brightness, shared out within its
    500 m pixel by the built-up land at 156 m (its visual product saturates over a city;
    the share of built-up land is what tells a dense core from a suburb)."""
    tr, shape = box.grid(NH)
    W = max(64, int((box.e - box.w) * 111000 * math.cos(math.radians((box.s + box.n) / 2)) / 500))
    H = max(64, int((box.n - box.s) * 111000 / 500))
    r = requests.get(BM_WMS.format(s=box.s, w=box.w, n=box.n, e=box.e, W=W, H=H), headers=UA, timeout=120)
    r.raise_for_status()
    im = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"), np.float32) / 255
    lum = (0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]) ** 2.2  # to linear
    src_tr = from_origin(box.w, box.n, (box.e - box.w) / W, (box.n - box.s) / H)
    dst = np.zeros(shape, np.float32)
    reproject(lum, dst, src_transform=src_tr, src_crs="EPSG:4326", dst_transform=tr, dst_crs=box.C.proj, resampling=Resampling.bilinear)
    b = ndimage.zoom(built, NH / built.shape[0], order=1)
    return np.clip(dst * (0.2 + 0.8 * np.clip(b, 0, 1)), 0, 1), {"black_marble_px": [W, H]}


def run(cid):
    t = time.time()
    C = City(cid)
    kind = "marine" if C.cfg.get("kind") == "marine" else "city"
    box = Box(C, HALF_M[kind])
    fr = landcover(box)
    dem = warp(box, DEM_URL, 1, NH, Resampling.average, 0, 0.0)
    small = lambda a: a.reshape(NH, NC // NH, NH, NC // NH).mean(axis=(1, 3))
    tree, built, water = small(fr[CLASSES.index(10)] + fr[CLASSES.index(95)]), small(fr[CLASSES.index(50)]), small(fr[CLASSES.index(80)])
    h = dem - CANOPY_M * tree - BUILT_M * built
    # water at sea level goes under the sea (the city's water plane); a lake up in the hills stays,
    # flat, in the water's colour (Lake Biwa behind Higashiyama)
    sea = (water > 0.5) & (dem < 3)
    h = np.where(sea, -6.0, np.maximum(h, 1.5 * (dem > 0)))
    h = np.where((dem <= 0) & ~sea & (water > 0.2), -6.0, h)
    q = np.clip(np.round((h + 100) * 4), 0, 65535).astype(np.uint16)
    glow, bm = lights(box, fr[CLASSES.index(50)])
    png = np.stack([(q >> 8).astype(np.uint8), (q & 255).astype(np.uint8), np.round(np.sqrt(glow) * 255).astype(np.uint8)], axis=-1)
    Image.fromarray(png, "RGB").save(os.path.join(C.out, "far.png"), optimize=True)
    pal, nsamp = palette(C, box, fr)
    P = np.stack([pal[c] for c in CLASSES])  # (classes, 3)
    col = np.einsum("khw,kc->hwc", fr, P)
    Image.fromarray(np.clip(np.round(col), 0, 255).astype(np.uint8), "RGB").save(os.path.join(C.out, "far.jpg"), quality=86, optimize=True)
    meta = {
        "half_m": box.half, "cx": box.cx, "cy": box.cy, "nh": NH, "nc": NC,
        "height": "(r * 256 + g) / 4 - 100 m, north up; under the sea at -6", "lights": "b = sqrt(lights 0..1)",
        "palette": {NAMES[c]: "#%02x%02x%02x" % tuple(int(v) for v in pal[c]) for c in CLASSES},
        "palette_samples": nsamp,
        "land_share": round(float(1 - fr[CLASSES.index(80)].mean()), 3),
        "relief_m": [round(float(h[~sea].min()), 1) if (~sea).any() else 0, round(float(h.max()), 1)],
        "sources": {
            "relief": "Copernicus DEM GLO-30 (ESA, Airbus; Copernicus DEM licence), AWS open data registry; surface model less trees and buildings",
            "land_cover": "ESA WorldCover 10 m 2021 v200 (CC BY 4.0)",
            "lights": "NASA Black Marble 2016, VIIRS day/night band (public domain), via NASA GIBS",
        },
        "black_marble": bm,
    }
    with open(os.path.join(C.out, "far.json"), "w") as f:
        json.dump(meta, f, indent=1)
    sz = sum(os.path.getsize(os.path.join(C.out, x)) for x in ("far.png", "far.jpg", "far.json")) // 1024
    print(f"{cid}: land {100 * meta['land_share']:.0f}%, relief {meta['relief_m']} m, palette from {nsamp} cells, {sz} KB in {time.time() - t:.0f} s")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--city", help="city id, a folder in cities/")
    ap.add_argument("--all", action="store_true", help="every built city and reef site")
    a = ap.parse_args()
    ids = [c["id"] for c in json.load(open(os.path.join(ROOT, "cities", "index.json")))["cities"]
           if os.path.exists(os.path.join(ROOT, "web", "data", c["id"], "scene.json"))] if a.all else [a.city or "sydney"]
    for cid in ids:
        run(cid)


if __name__ == "__main__":
    main()
