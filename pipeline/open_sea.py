"""The open water past the model's frame, for the edge haze (web/world.js edgeHaze, OE_SEA).

Past the frame the city is only haze, but where there is real open water the sea carries on to
the horizon. sea.jpg says where: a land and water mask SEA_HALF_M either side of the frame's
centre (north up, x east), from Overture's base water theme (OpenStreetMap-derived, ODbL): its
ocean polygons (OSM's coastline), bays and straits, less the islands mapped in them; and, for a
city that draws its own rivers or lakes (city.json water.classes), the rivers, lakes, reservoirs
and canals of at least FLOW_MIN_M2 (mapped in many short pieces, which together reach the frame)
and the lakes, reservoirs and other standing water of at least STILL_MIN_M2 (a pond a kilometre
past the frame, crisp in the haze over land, reads as a dark blob floating there). Water narrower
than NARROW_M is left out the same way: a creek reads as a crack across the haze. A city that leaves its water to the aerial photo
(Kyoto, Shibuya) stands well above the water plane, and its inland water past the frame is
mostly hidden behind hills the model does not have (Lake Biwa behind Higashiyama).

  r  water, blurred by SOFT_M[0] (about 1.5 pixels: no stair steps seen from above)
  g  the same blurred by SOFT_M[1]
  b  the same blurred by SOFT_M[2]

The shader blends from r at the frame toward b far out, so near the frame the water past it
follows the real shore and far out the sea and the haze over land meet in a soft gradient
rather than a line.

    python pipeline/open_sea.py --city sydney      # -> web/data/sydney/sea.jpg
    python pipeline/open_sea.py --all              # every built city with a shore.png

If your environment injects AWS credentials, unset them first (see fetch_overture.py).
"""
import argparse
import json
import os
import time

import numpy as np
import shapely
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely import wkb as swkb

from cityctx import ROOT, City, polygons

SEA_HALF_M = 40000  # web/world.js SEA_HALF
SEA_PX = 2048
SOFT_M = (60, 450, 2200)  # Gaussian sigma of r, g and b, metres
SEA_CLASSES = {"ocean", "sea", "bay", "strait"}
FLOW_CLASSES = {"river", "canal"}
STILL_CLASSES = {"water", "lake", "lagoon", "reservoir"}
INLAND_CLASSES = FLOW_CLASSES | STILL_CLASSES
FLOW_MIN_M2, STILL_MIN_M2 = 20000, 1e6
NARROW_M = 160  # water narrower than this is left out
RELEASE_KEY = "overture_release"


def fetch(C, path):
    """Overture's water and islands in the mask's box, to data/raw/<id>/overture_open_sea.parquet."""
    import duckdb
    cx, cy = (C.x0 + C.x1) / 2, (C.y0 + C.y1) / 2
    xs = [cx - SEA_HALF_M, cx + SEA_HALF_M, cx + SEA_HALF_M, cx - SEA_HALF_M]
    ys = [cy - SEA_HALF_M, cy - SEA_HALF_M, cy + SEA_HALF_M, cy + SEA_HALF_M]
    lon, lat = C.inv.transform(xs, ys)
    w, e, s, n = min(lon), max(lon), min(lat), max(lat)
    root = f"s3://overturemaps-us-west-2/release/{C.cfg[RELEASE_KEY]}"
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET enable_progress_bar=false;")
    con.execute("CREATE OR REPLACE SECRET anon (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2');")
    box = f"bbox.xmax > {w} AND bbox.xmin < {e} AND bbox.ymax > {s} AND bbox.ymin < {n}"
    poly = "ST_GeometryType(geometry) IN ('POLYGON', 'MULTIPOLYGON')"
    wc = ", ".join(f"'{c}'" for c in sorted(SEA_CLASSES | INLAND_CLASSES))
    q = f"""SELECT 'water' AS kind, class, ST_AsWKB(geometry) AS wkb
              FROM read_parquet('{root}/theme=base/type=water/*', hive_partitioning=1) WHERE {box} AND {poly} AND class IN ({wc})
            UNION ALL
            SELECT 'isle' AS kind, class, ST_AsWKB(geometry) AS wkb
              FROM read_parquet('{root}/theme=base/type=land/*', hive_partitioning=1) WHERE {box} AND {poly} AND class IN ('island', 'islet')"""
    con.execute(f"COPY ({q}) TO '{path}' (FORMAT parquet)")
    return con.execute(f"SELECT kind, class, wkb FROM '{path}'").fetchall()


def mask(C, rows):
    """The water as a SEA_PX square boolean grid, row 0 at the north."""
    cx, cy = (C.x0 + C.x1) / 2, (C.y0 + C.y1) / 2
    box = shapely.box(cx - SEA_HALF_M, cy - SEA_HALF_M, cx + SEA_HALF_M, cy + SEA_HALF_M)
    inland = bool(set(C.cfg.get("water", {}).get("classes", [])) & (INLAND_CLASSES | {"moat", "pond", "stream", "drain", "ditch"}))
    water, isles = [], []
    for kind, cls, wkb in rows:
        g = C.to_local(swkb.loads(bytes(wkb))).intersection(box)
        for p in polygons(g):
            if kind == "isle":
                isles.append(p)
            elif cls in SEA_CLASSES or (inland and p.area >= (FLOW_MIN_M2 if cls in FLOW_CLASSES else STILL_MIN_M2)):
                water.append(p)
    # Lakes and rivers drawn over the sea add nothing; islands cut out of it (a river or a bay can enclose them)
    wet = shapely.union_all(water) if water else shapely.Polygon()
    if isles:
        land = shapely.union_all([p for p in isles if p.area < 0.5 * box.area])  # not the landmass the city stands on
        wet = wet.difference(land)
    # rasterised at 4x and averaged down, for antialiasing
    S = 4
    n = SEA_PX * S
    img = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(img)
    k = n / (2 * SEA_HALF_M)
    px = lambda cs: [((x - box.bounds[0]) * k, (box.bounds[3] - y) * k) for x, y in cs]
    for p in polygons(wet):
        d.polygon(px(p.exterior.coords), fill=255)
        for r in p.interiors:
            d.polygon(px(r.coords), fill=0)
    a = np.asarray(img, dtype=np.float32) / 255
    a = a.reshape(SEA_PX, S, SEA_PX, S).mean(axis=(1, 3))
    # water narrower than about NARROW_M left out: a creek or a canal, crisp through the haze over
    # land, reads as a dark crack across it (Osaka's rivers past the frame)
    r = int(round(NARROW_M / 2 / (2 * SEA_HALF_M / SEA_PX)))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    disk = xx * xx + yy * yy <= r * r
    wide = ndimage.binary_opening(a > 0.5, disk)
    # and what that leaves in pieces under STILL_MIN_M2 / 2 (the wider reaches of a river cut up)
    lab, n = ndimage.label(wide)
    size = ndimage.sum(wide, lab, np.arange(1, n + 1)) * (2 * SEA_HALF_M / SEA_PX) ** 2
    wide = np.isin(lab, 1 + np.flatnonzero(size >= STILL_MIN_M2 / 2))
    return a * ndimage.binary_dilation(wide, np.ones((3, 3), bool))


def bake(C, a):
    cell = 2 * SEA_HALF_M / SEA_PX
    chans = [ndimage.gaussian_filter(a, s / cell, mode="nearest") for s in SOFT_M]
    out = np.stack([np.clip(np.round(c * 255), 0, 255).astype(np.uint8) for c in chans], axis=-1)
    path = os.path.join(C.out, "sea.jpg")
    # smooth, so a JPEG without chroma subsampling holds it to a level or two at half a PNG's size
    Image.fromarray(out, "RGB").save(path, quality=90, subsampling=0, optimize=True)
    return path


def run(cid, refetch=False):
    C = City(cid)
    C.ensure_dirs()
    raw = os.path.join(C.raw, "overture_open_sea.parquet")
    t = time.time()
    if os.path.exists(raw) and not refetch:
        import duckdb
        rows = duckdb.connect().execute(f"SELECT kind, class, wkb FROM '{raw}'").fetchall()
    else:
        rows = fetch(C, raw)
    a = mask(C, rows)
    path = bake(C, a)
    print(f"{cid}: {len(rows)} polygons, {100 * a.mean():.1f}% water, {os.path.getsize(path) // 1024} KB in {time.time() - t:.0f} s -> {path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--city", help="city id, a folder in cities/")
    ap.add_argument("--all", action="store_true", help="every built city with a shore.png")
    ap.add_argument("--refetch", action="store_true", help="download again even if the raw file is there")
    a = ap.parse_args()
    ids = [c["id"] for c in json.load(open(os.path.join(ROOT, "cities", "index.json")))["cities"]
           if os.path.exists(os.path.join(ROOT, "web", "data", c["id"], "shore.png"))] if a.all else [a.city or "sydney"]
    for cid in ids:
        run(cid, a.refetch)


if __name__ == "__main__":
    main()
