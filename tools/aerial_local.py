"""GSI's seamless aerial photo (zoom 18, about 0.5 m a pixel) resampled into a city's local frame round a
point, with the landmarks' crossings and any points given drawn over it: to measure road markings,
kerbs and street furniture against the photo. Tiles are cached in data/raw/<city>/gsi18/.
  python3 tools/aerial_local.py shibuya 368 -1000 [half_m=80] [out.png] [x,y ...]
Photo: Geospatial Information Authority of Japan (GSI), seamless photos; GSI terms of use (attribution).
"""
import json
import math
import os
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import cityctx  # noqa: E402

Z = 18
URL = "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg"


def tile_xy(lon, lat):
    n = 2 ** Z
    return (lon + 180) / 360 * n, (1 - np.arcsinh(np.tan(np.radians(lat))) / math.pi) / 2 * n


def get(C, x, y):
    d = os.path.join(C.raw, "gsi18")
    os.makedirs(d, exist_ok=True)
    f = os.path.join(d, f"{x}_{y}.jpg")
    if not os.path.exists(f):
        req = urllib.request.Request(URL.format(z=Z, x=x, y=y), headers={"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"})
        open(f, "wb").write(urllib.request.urlopen(req, timeout=30).read())
    return Image.open(f).convert("RGB")


def main():
    a = sys.argv[1:]
    C = cityctx.City(a[0])
    cx, cy = float(a[1]), float(a[2])
    half = float(a[3]) if len(a) > 3 else 80.0
    out = a[4] if len(a) > 4 else "aerial.png"
    res = float(os.environ.get("RES", "0.2"))
    n = int(2 * half / res)
    xs = cx - half + (np.arange(n) + 0.5) * res
    ys = cy + half - (np.arange(n) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    lon, lat = C.inv.transform(X.ravel(), Y.ravel())
    tx, ty = tile_xy(np.asarray(lon), np.asarray(lat))
    tiles = {}
    outpx = np.zeros((n * n, 3), np.uint8)
    for k in set(zip(np.floor(tx).astype(int), np.floor(ty).astype(int))):
        tiles[k] = np.asarray(get(C, *k))
    ix, iy = np.floor(tx).astype(int), np.floor(ty).astype(int)
    px, py = np.clip(((tx - ix) * 256).astype(int), 0, 255), np.clip(((ty - iy) * 256).astype(int), 0, 255)
    for k, arr in tiles.items():
        m = (ix == k[0]) & (iy == k[1])
        outpx[m] = arr[py[m], px[m]]
    img = Image.fromarray(outpx.reshape(n, n, 3))
    d = ImageDraw.Draw(img)
    P = lambda x, y: ((x - cx + half) / res, (cy + half - y) / res)
    for k in range(-int(half) // 10 * 10, int(half) + 1, 10):
        c = (255, 255, 0) if k % 50 == 0 else (120, 120, 120)
        d.line([P(cx + k, cy - half), P(cx + k, cy + half)], fill=c, width=1)
        d.line([P(cx - half, cy + k), P(cx + half, cy + k)], fill=c, width=1)
    S = json.load(open(os.path.join(C.out, "scene.json")))
    for ab in S.get("landmarks", {}).get("scramble", {}).get("lines", []):
        d.line([P(*ab[0]), P(*ab[1])], fill=(0, 120, 255), width=2)
    for pt in a[5:]:
        x, y = P(*map(float, pt.split(",")))
        d.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 0, 255), width=2)
    img.save(out)
    print(out, img.size, f"{res} m/px, origin ({cx - half}, {cy + half}) top-left")


if __name__ == "__main__":
    main()
