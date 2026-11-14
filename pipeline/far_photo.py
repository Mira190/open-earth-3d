"""The aerial photograph of the land just past the model's frame.

Past the frame the land is drawn from its land cover (far_land.py: far.jpg, a colour per 78 m cell), which is what
it should be 10 km off and is not a place seen from 300 m: from the helicopter or a tower by the map's edge every
road stopped at the frame and the city beyond was a grey plain with a grain. This step fetches the city's own
aerial photograph (cities/<id>/city.json "imagery", the source the ground inside the frame is made from) for a ring
RING_M wide round the frame, at PX_M metres a pixel, in the map's local frame, and web/farland.js lays it on the far
land there, feathered out into the land cover's colour at its outer edge. It is looked at, never walked on: the
streets run on, the blocks and parks are the real ones, and nothing past the frame is built.

Inside the frame, less a margin, the picture is the photo's mean colour: the model's own ground covers it, and a
flat fill costs the file nothing.

Writes web/data/<id>/far_photo.jpg and far.json "photo": {file, box [x0, y0, x1, y1] in local metres, px_m, source}.

    python pipeline/far_land.py --city sydney     first (far.json)
    python pipeline/far_photo.py --city sydney
    python pipeline/far_photo.py --live           every live city with an "xyz" imagery source
"""
import argparse
import io
import json
import math
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cityctx import City, ROOT  # noqa: E402

RING_M = 2000.0     # how far past the frame the photograph reaches
PX_M = 5.0          # metres a pixel: a street reads as a street from 300 m up, and the file stays under a megabyte
KEEP_IN_M = 150.0   # the photo is kept this far inside the frame, under the model's ground and its edge haze
SOFTEN_PX = 0.8     # a little blur: the ground inside the frame is softened too (city.json imagery.soften)
UA = {"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"}


def tile(url):
    for _ in range(4):
        try:
            r = requests.get(url, timeout=60, headers=UA)
            if r.status_code == 200:
                return Image.open(io.BytesIO(r.content)).convert("RGB")
            if r.status_code == 404:
                return None
        except requests.RequestException:
            pass
    return None


def run(cid):
    C = City(cid)
    im = C.cfg.get("imagery") or {}
    if im.get("type") != "xyz":
        print(f"{cid}: no xyz imagery source, no photograph past the frame")
        return False
    meta_p = os.path.join(C.out, "far.json")
    if not os.path.exists(meta_p):
        raise SystemExit(f"{cid}: no far.json; run pipeline/far_land.py --city {cid} first")
    x0, x1, y0, y1 = C.x0 - RING_M, C.x1 + RING_M, C.y0 - RING_M, C.y1 + RING_M
    w, h = int(round((x1 - x0) / PX_M)), int(round((y1 - y0) / PX_M))
    # the zoom whose pixels are just finer than PX_M at this latitude
    z = min(im.get("zoom", 17), math.ceil(math.log2(156543.034 * math.cos(math.radians(C.lat0)) / PX_M)))
    n = 2 ** z
    # every output pixel's place in the tile pyramid (row 0 north)
    X, Y = np.meshgrid(x0 + (np.arange(w) + 0.5) * PX_M, y1 - (np.arange(h) + 0.5) * PX_M)
    lon, lat = C.inv.transform(X.ravel(), Y.ravel())
    tx = (np.asarray(lon) + 180) / 360 * n
    ty = (1 - np.arcsinh(np.tan(np.radians(np.asarray(lat)))) / math.pi) / 2 * n
    tx0, ty0 = int(tx.min()), int(ty.min())
    nx, ny = int(tx.max()) - tx0 + 1, int(ty.max()) - ty0 + 1
    mosaic = np.zeros((ny * 256, nx * 256, 3), np.uint8)
    jobs = [(i, j, im["url"].format(z=z, x=tx0 + i, y=ty0 + j)) for i in range(nx) for j in range(ny)]
    got = 0
    with ThreadPoolExecutor(8) as ex:
        for (i, j, _), t in zip(jobs, ex.map(lambda q: tile(q[2]), jobs)):
            if t is not None:
                mosaic[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = np.asarray(t.resize((256, 256)))
                got += 1
    if got < 0.9 * len(jobs):
        raise SystemExit(f"{cid}: only {got} of {len(jobs)} tiles at zoom {z}")
    px = np.clip(((tx - tx0) * 256).astype(np.int32), 0, nx * 256 - 1)
    py = np.clip(((ty - ty0) * 256).astype(np.int32), 0, ny * 256 - 1)
    out = mosaic[py, px].reshape(h, w, 3)
    img = Image.fromarray(out, "RGB").filter(ImageFilter.GaussianBlur(SOFTEN_PX))
    a = np.asarray(img).copy()
    # in the tone of the ground inside the frame: that ground is the same photograph cleaned and graded by the build
    # (ground_lo.jpg), so each channel's mean and spread over the frame are matched to it. Left as fetched, the ring
    # stood a shade paler than the city it surrounds
    lo_p = os.path.join(C.out, "ground_lo.jpg")
    if os.path.exists(lo_p):
        fc0, fc1 = int((C.x0 - x0) / PX_M), int((C.x1 - x0) / PX_M)
        fr0, fr1 = int((y1 - C.y1) / PX_M), int((y1 - C.y0) / PX_M)
        mine = a[fr0:fr1, fc0:fc1].astype(np.float32)
        ref = np.asarray(Image.open(lo_p).convert("RGB").resize((fc1 - fc0, fr1 - fr0), Image.BILINEAR), np.float32)
        ok = (ref.max(axis=2) > 6) & (mine.max(axis=2) > 6)
        if ok.sum() > 1000:
            g = np.clip(ref[ok].std(axis=0) / np.maximum(mine[ok].std(axis=0), 1.0), 0.6, 1.6)
            b = ref[ok].mean(axis=0) - g * mine[ok].mean(axis=0)
            a = np.clip(a.astype(np.float32) * g + b, 0, 255).astype(np.uint8)
            print(f"{cid}: tone matched to the ground inside the frame: gain {np.round(g, 2).tolist()}, offset {np.round(b, 1).tolist()}")
    # under the model's own ground: the photo's mean colour
    c0, c1 = int((C.x0 + KEEP_IN_M - x0) / PX_M), int((C.x1 - KEEP_IN_M - x0) / PX_M)
    r0, r1 = int((y1 - (C.y1 - KEEP_IN_M)) / PX_M), int((y1 - (C.y0 + KEEP_IN_M)) / PX_M)
    ring = np.ones((h, w), bool)
    ring[r0:r1, c0:c1] = False
    a[r0:r1, c0:c1] = a[ring].mean(axis=0).astype(np.uint8)
    name = "far_photo.jpg"
    Image.fromarray(a, "RGB").save(os.path.join(C.out, name), quality=82, optimize=True, progressive=True)
    meta = json.load(open(meta_p, encoding="utf8"))
    meta["photo"] = {"file": name, "box": [x0, y0, x1, y1], "px_m": PX_M, "w": w, "h": h, "zoom": z,
                     "source": im.get("attribution", "")}
    json.dump(meta, open(meta_p, "w", encoding="utf8"), indent=1, ensure_ascii=False)
    kb = os.path.getsize(os.path.join(C.out, name)) // 1024
    print(f"{cid}: {w} x {h} px at {PX_M} m, zoom {z}, {got} tiles -> {name} ({kb} KB)")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--city")
    ap.add_argument("--live", action="store_true")
    a = ap.parse_args()
    if a.live:
        ids = subprocess.run([os.path.join(ROOT, "tools", "live_cities.sh")], capture_output=True, text=True, check=True).stdout.split()
    elif a.city:
        ids = [a.city]
    else:
        ap.error("--city <id> or --live")
    for cid in ids:
        run(cid)


if __name__ == "__main__":
    main()
