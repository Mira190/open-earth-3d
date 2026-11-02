"""Draw a city's water polygons (Overture, the classes the build keeps) and its helipads over the
aerial imagery the city configures, in a local-frame box, with the built water mask
(web/data/<id>/game.json) as red cell edges,, to check the coastline against a photograph.

    python tools/coast_overlay.py hong-kong 700 -400 1500 100 out.png [--zoom 18]
"""
import argparse
import io
import math
import os
import sys
import urllib.request

import duckdb
from PIL import Image, ImageDraw
from shapely import wkb
from shapely.geometry import box

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))
from cityctx import City, polygons  # noqa: E402

UA = "open-earth-3d (https://github.com/Mira190/open-earth-3d)"


def tile(url, z, x, y, cache):
    p = os.path.join(cache, f"{z}_{x}_{y}.img")
    if not os.path.exists(p):
        req = urllib.request.Request(url.format(z=z, x=x, y=y), headers={"User-Agent": UA})
        open(p, "wb").write(urllib.request.urlopen(req, timeout=60).read())
    return Image.open(p).convert("RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("city")
    ap.add_argument("x0", type=float); ap.add_argument("y0", type=float)
    ap.add_argument("x1", type=float); ap.add_argument("y1", type=float)
    ap.add_argument("out")
    ap.add_argument("--zoom", type=int, default=18)
    ap.add_argument("--px", type=float, default=0.6, help="metres per output pixel")
    ap.add_argument("--imagery", help="an XYZ tile URL to use instead of the city's own (for a city drawn from its land use)")
    ap.add_argument("--decks", action="store_true", help="also outline the decks pipeline/shore.py adds over the water (green)")
    a = ap.parse_args()
    C = City(a.city)
    url = a.imagery or C.cfg["imagery"].get("url")  # none for a city drawn from its land use: a plain background
    cache = os.path.join(C.raw, "overlay_tiles" if not a.imagery else "overlay_tiles_alt"); os.makedirs(cache, exist_ok=True)
    W, H = int((a.x1 - a.x0) / a.px), int((a.y1 - a.y0) / a.px)
    img = Image.new("RGB", (W, H), (70, 70, 70))
    n = 2 ** a.zoom
    def lonlat_to_tile(lon, lat):
        return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    # resample: for each output pixel, its tile pixel (nearest)
    tiles = {}
    px = img.load()
    for j in range(H if url else 0):
        ys = [a.y1 - (j + 0.5) * a.px] * W
        xs = [a.x0 + (i + 0.5) * a.px for i in range(W)]
        lons, lats = C.inv.transform(xs, ys)
        for i in range(W):
            tx, ty = lonlat_to_tile(lons[i], lats[i])
            k = (int(tx), int(ty))
            if k not in tiles:
                tiles[k] = tile(url, a.zoom, k[0], k[1], cache)
            t = tiles[k]
            px[i, j] = t.getpixel((min(int((tx - k[0]) * t.width), t.width - 1), min(int((ty - k[1]) * t.height), t.height - 1)))
    d = ImageDraw.Draw(img, "RGBA")
    to_px = lambda c: [((p[0] - a.x0) / a.px, (a.y1 - p[1]) / a.px) for p in c]
    con = duckdb.connect()
    classes = set(C.cfg.get("water", {}).get("classes", ["ocean", "bay", "water"]))
    b = box(a.x0, a.y0, a.x1, a.y1)
    for r in con.execute(f"SELECT class, wkb FROM '{C.raw}/overture_water.parquet'").fetchall():
        if r[0] not in classes:
            continue
        g = C.to_local(wkb.loads(bytes(r[1]))).intersection(b)
        for p in polygons(g):
            if p.is_empty or len(p.exterior.coords) < 3:
                continue
            d.polygon(to_px(p.exterior.coords), fill=(0, 120, 255, 50), outline=(0, 160, 255, 255))
            for h in p.interiors:
                d.line(to_px(h.coords), fill=(255, 220, 0, 255), width=2)
    for r in con.execute(f"SELECT class, wkb FROM '{C.raw}/overture_infrastructure.parquet' WHERE class IN ('helipad','heliport')").fetchall():
        for p in polygons(C.to_local(wkb.loads(bytes(r[1]))).intersection(b)):
            if p.is_empty:
                continue
            d.polygon(to_px(p.exterior.coords), outline=(255, 40, 40, 255))
    if a.decks:
        from build_scene import rows, water_polygons
        from shore import decks
        raw = lambda n: os.path.join(C.raw, f"overture_{n}.parquet")
        sea = water_polygons(C, con, raw, box(C.x0, C.y0, C.x1, C.y1))
        for p in decks(C, con, raw, rows, sea):
            for q in polygons(p.intersection(b)):
                if not q.is_empty:
                    d.polygon(to_px(q.exterior.coords), fill=(60, 255, 60, 60), outline=(60, 255, 60, 255))
    # the built water mask (game.json) as red cell edges where it meets land
    gp = os.path.join(C.out, "game.json")
    if os.path.exists(gp):
        import base64
        import json
        import numpy as np
        w = json.load(open(gp))["water"]
        m = np.unpackbits(np.frombuffer(base64.b64decode(w["bits"]), np.uint8))[:w["nx"] * w["ny"]].reshape(w["ny"], w["nx"]).astype(bool)
        cs = w["cell"]
        for r in range(max(0, int((C.y1 - a.y1) / cs)), min(w["ny"] - 1, int((C.y1 - a.y0) / cs) + 1)):
            for c in range(max(0, int((a.x0 - C.x0) / cs)), min(w["nx"] - 1, int((a.x1 - C.x0) / cs) + 1)):
                x, y = C.x0 + c * cs, C.y1 - r * cs
                if m[r, c] != m[r, c + 1]:
                    d.line(to_px([(x + cs, y), (x + cs, y - cs)]), fill=(255, 0, 0, 255), width=2)
                if m[r, c] != m[r + 1, c]:
                    d.line(to_px([(x, y - cs), (x + cs, y - cs)]), fill=(255, 0, 0, 255), width=2)
    img.save(a.out)
    print(a.out, W, H)


if __name__ == "__main__":
    main()
