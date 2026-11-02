"""Woods and park canopy: the trees the canopy itself shows, and the ground under it.

An aerial photograph of a wood is a photograph of the tops of its trees. Draped on the
terrain and seen from a walker's eye, that dark canopy reads as a lumpy teal sea, and far
fewer trees stand on it than the photo shows (OpenStreetMap maps street trees one by one,
but a wood only as an outline). So inside every mapped wood, forest, scrub, park, garden,
cemetery and temple ground:

  - the trees are planted from an open canopy height model: Meta and the World Resources
    Institute's High Resolution Canopy Height Maps (Tolan et al. 2024, about 1 m, CC BY 4.0,
    s3://dataforgood-fb-data/forests/v1/alsgedi_global_v6_float/). Each tree stands at a
    local maximum of the smoothed canopy (the usual individual-tree detection), with that
    height, kept apart from its neighbours by a distance that grows with its height, and off
    the buildings, roads, footways and water, and clear of the trees OSM already maps.
  - the ground under that canopy is marked in a mask (woods.png), from which the ground
    shader draws a ground cover (moss, bare earth, leaf litter, and gravel or earth where a
    mapped footway runs under the trees) instead of the photo's canopy, near the camera.
    Where the photo says the ground is open (pale gravel, roofs), the canopy model is not
    trusted.

Writes web/data/<id>/woods.png (r: ground-cover weight, g: canopy height x 8 m, b: footway
under the canopy; 2 m cells, north-west origin), "woods" in places.json (x, y, ground,
height in decimetres, as "trees") and "woods" in scene.json. Needs Overture land and land
use (fetch_overture.py --only land land_use) and game.json's paths; game_data.py calls it
at its end. To do it to a city as it stands:

    python pipeline/woods.py --city kyoto
    python pipeline/woods.py --all
"""
import base64
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.spatial import cKDTree

from cityctx import ROOT, City, polygons

CHM_URL = "https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/{}.tif"
CHM_SOURCE = ("Meta and World Resources Institute High Resolution Canopy Height Maps "
              "(Tolan et al. 2024, CC BY 4.0): trees planted from the canopy in mapped woods and parks")
CELL = 2.0   # the mask's cell (m)
FINE = 1.0   # the working grid (m), the canopy model's own resolution
MIN_TREE_M = 4.0   # a canopy peak lower than this is a shrub
CANOPY_M = 2.5     # canopy over the ground from this height
LAND = {"forest", "wood", "scrub", "shrubbery", "shrub"}
LAND_USE = {"park", "village_green", "recreation_ground", "garden", "cemetery", "grave_yard", "religious",
            "nature_reserve", "zoo", "grass", "meadow", "dog_park", "golf_course"}
FOOTW = {"footway": 2.5, "pedestrian": 4, "path": 2, "steps": 3, "cycleway": 2, "track": 3, "bridleway": 2}
ROADW = {"motorway": 14, "trunk": 12, "primary": 12, "secondary": 10, "tertiary": 9, "residential": 7,
         "unclassified": 6, "living_street": 5, "service": 4}


def quadkey(lon, lat, z=9):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return "".join(str(((x >> (i - 1)) & 1) + 2 * ((y >> (i - 1)) & 1)) for i in range(z, 0, -1))


def canopy_model(C, gx, gy):
    """Canopy height (m) at the frame's 1 m cell centres gx (columns) and gy (rows), from the
    tiles of the canopy height model over the city, read once into data/raw/<id>/chm.npz."""
    import rasterio
    from pyproj import Transformer
    from rasterio.windows import from_bounds
    from scipy.ndimage import map_coordinates
    w, s, e, n = C.cfg["bbox"]
    cache = os.path.join(C.raw, "chm.npz")
    to3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    if not os.path.exists(cache):
        X0, Y0 = to3857.transform(w - 0.002, s - 0.002)
        X1, Y1 = to3857.transform(e + 0.002, n + 0.002)
        res = None
        keys = sorted({quadkey(lo, la) for lo in (w - 0.002, e + 0.002) for la in (s - 0.002, n + 0.002)})
        for k in keys:
            with rasterio.open("/vsicurl/" + CHM_URL.format(k)) as r:
                if res is None:
                    rx, ry = r.res
                    nx, ny = int((X1 - X0) / rx) + 1, int((Y1 - Y0) / ry) + 1
                    res = np.zeros((ny, nx), np.uint8)
                win = from_bounds(X0, Y0, X1, Y1, r.transform).round_offsets().round_lengths()
                a = r.read(1, window=win, boundless=True, fill_value=0)
                res = np.maximum(res, a[:ny, :nx] if a.shape[0] >= ny and a.shape[1] >= nx else np.pad(a, ((0, max(0, ny - a.shape[0])), (0, max(0, nx - a.shape[1]))))[:ny, :nx])
        os.makedirs(C.raw, exist_ok=True)
        np.savez_compressed(cache, chm=res, box=np.array([X0, Y0, X1, Y1]), res=np.array([rx, ry]), keys=np.array(keys))
    z = np.load(cache)
    chm, (X0, Y0, X1, Y1), (rx, ry) = z["chm"], z["box"], z["res"]
    out = np.zeros((len(gy), len(gx)), np.float32)
    for i in range(0, len(gy), 256):  # in bands of rows: the frame -> lon, lat -> web mercator pixels
        yy, xx = np.meshgrid(gy[i:i + 256], gx, indexing="ij")
        lon, lat = C.inv.transform(xx.ravel(), yy.ravel())
        X, Y = to3857.transform(lon, lat)
        col = (np.asarray(X) - X0) / rx - 0.5
        row = (Y1 - np.asarray(Y)) / ry - 0.5
        out[i:i + 256] = map_coordinates(chm.astype(np.float32), [row, col], order=1, mode="constant", cval=0).reshape(xx.shape)
    return out


def raster(nx, ny, cell, x0, y1):
    img = Image.new("L", (nx, ny), 0)
    return img, ImageDraw.Draw(img), (lambda cs: [((x - x0) / cell, (y1 - y) / cell) for x, y in cs])


def wood_polygons(C):
    import duckdb
    from shapely import wkb as swkb
    con, out = duckdb.connect(), []
    for name, keep in (("land", LAND), ("land_use", LAND_USE)):
        path = os.path.join(C.raw, f"overture_{name}.parquet")
        if not os.path.exists(path):
            raise SystemExit(f"{path} is missing: python pipeline/fetch_overture.py --city {C.id} --only land land_use")
        for cls, g in con.execute(f"SELECT class, wkb FROM '{path}'").fetchall():
            if cls in keep:
                out += [p for p in polygons(C.to_local(swkb.loads(bytes(g)))) if p.area > 150]
    return out


def photo(C, scene, nx, ny, x0, y1):
    """The ground tiles as one RGB array on the 1 m grid, or None where the ground is drawn
    from the map (no open aerial photo)."""
    if "No open" in scene.get("sources", {}).get("imagery", "") or "No openly" in scene.get("sources", {}).get("imagery", ""):
        return None
    out = np.zeros((ny, nx, 3), np.uint8)
    for t in scene["ground"]:
        im = Image.open(os.path.join(C.out, t["file"])).convert("RGB")
        w, h = round((t["x1"] - t["x0"]) / FINE), round((t["y1"] - t["y0"]) / FINE)
        a = np.asarray(im.resize((w, h), Image.BILINEAR) if im.size != (w, h) else im)
        c0, r0 = round((t["x0"] - x0) / FINE), round((y1 - t["y1"]) / FINE)
        rr, cc = slice(max(r0, 0), min(r0 + h, ny)), slice(max(c0, 0), min(c0 + w, nx))
        out[rr, cc] = a[rr.start - r0:rr.stop - r0, cc.start - c0:cc.stop - c0]
    return out


def build(C, write=True):
    scene_path, places_path, game_path = (os.path.join(C.out, f) for f in ("scene.json", "places.json", "game.json"))
    scene, places = json.load(open(scene_path)), json.load(open(places_path))
    G = json.load(open(game_path)) if os.path.exists(game_path) else {}
    x0, x1 = scene["frame"]["x"]
    y0, y1 = scene["frame"]["y"]
    nx, ny = int((x1 - x0) / FINE), int((y1 - y0) / FINE)
    gx, gy = x0 + (np.arange(nx) + 0.5) * FINE, y1 - (np.arange(ny) + 0.5) * FINE

    # the woods and parks
    img, d, P = raster(nx, ny, FINE, x0, y1)
    for p in wood_polygons(C):
        d.polygon(P(p.exterior.coords), fill=1)
        for r in p.interiors:
            d.polygon(P(r.coords), fill=0)
    wood = np.asarray(img, bool)

    # what nothing grows on: buildings, water, roads; footways, kept apart
    img, d, P = raster(nx, ny, FINE, x0, y1)
    B = json.load(open(os.path.join(C.out, "buildings.json")))
    for s in B["s"]:
        ring = s[4]
        if len(ring) >= 6:
            d.polygon(P(zip(np.array(ring[0::2]) / 10, np.array(ring[1::2]) / 10)), fill=1)
    built = np.asarray(img, bool)
    img, d, P = raster(nx, ny, FINE, x0, y1)
    for r in G.get("paths", {}).get("road", []):
        p = np.array(r["p"]).reshape(-1, 3) / 10
        d.line(P(p[:, :2]), fill=1, width=max(1, round((ROADW.get(r["c"], 7) + 1) / FINE)), joint="curve")
    road = np.asarray(img, bool)
    img, d, P = raster(nx, ny, FINE, x0, y1)
    for r in G.get("paths", {}).get("foot", []):
        p = np.array(r["p"]).reshape(-1, 3) / 10
        d.line(P(p[:, :2]), fill=1, width=max(1, round(FOOTW.get(r["c"], 2.5) / FINE)), joint="curve")
    foot = np.asarray(img, bool)
    water = np.zeros((ny, nx), bool)
    if "water" in G and "bits" in G["water"]:
        wm = G["water"]
        bits = np.unpackbits(np.frombuffer(base64.b64decode(wm["bits"]), np.uint8))[:wm["nx"] * wm["ny"]].reshape(wm["ny"], wm["nx"]).astype(bool)
        r = np.clip(((y1 - gy) / wm["cell"]).astype(int), 0, wm["ny"] - 1)
        c = np.clip(((gx - x0) / wm["cell"]).astype(int), 0, wm["nx"] - 1)
        water = bits[np.ix_(r, c)]

    # the canopy: the height model, where the photo does not show open ground (a pale grey
    # patch of gravel, paving or roof wider than about 7 m; sunlit crowns are greener)
    chm = canopy_model(C, gx, gy)
    sm = ndimage.gaussian_filter(chm, 1.0)
    canopy = sm >= CANOPY_M
    ph = photo(C, scene, nx, ny, x0, y1)
    if ph is not None:
        f = ndimage.uniform_filter(ph.astype(np.float32) / 255, size=(3, 3, 1))
        lum = f @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        exg = f[..., 1] - np.maximum(f[..., 0], f[..., 2])  # how much greener than red or blue (sRGB)
        open_ground = ((exg < 0.015) & (lum > 0.5)) | (lum > 0.72)
        canopy &= ~ndimage.binary_opening(open_ground, iterations=3)
    ok = wood & ~built & ~water
    under = canopy & ok
    under = ndimage.binary_closing(under, iterations=2) & ok
    lab, n = ndimage.label(~under & ok)  # the gaps between crowns smaller than a small room, filled
    if n:
        size = ndimage.sum(np.ones_like(lab), lab, np.arange(1, n + 1))
        under |= np.isin(lab, np.nonzero(size < 40)[0] + 1)
    lab, n = ndimage.label(under)  # and stray specks of canopy left out
    if n:
        size = ndimage.sum(np.ones_like(lab), lab, np.arange(1, n + 1))
        under &= np.isin(lab, np.nonzero(size >= 25)[0] + 1)
    cover = ndimage.binary_dilation(under, iterations=1) & ok & ~road  # over the photo crowns' edge

    # the trees: the canopy's peaks first, tallest first (individual-tree detection), then the
    # rest of the canopy filled at random (a Poisson-disc fill), each kept apart from the
    # trees already planted by a distance that grows with its height, and clear of the paths
    # and of the trees OSM maps
    free = under & ~road & ~ndimage.binary_dilation(foot, iterations=1) & (sm >= MIN_TREE_M)
    peak = (sm == ndimage.maximum_filter(sm, size=5)) & free
    pr, pc = np.nonzero(peak)
    o = np.argsort(-sm[pr, pc])
    rng = np.random.default_rng(54)
    fr, fc = np.nonzero(free)
    pick = rng.permutation(len(fr))[:max(1, len(fr) // 6)]
    cand = np.concatenate([np.stack([pr[o], pc[o]], 1), np.stack([fr[pick], fc[pick]], 1)])
    mapped = np.array(places.get("trees", []), np.float64).reshape(-1, 4)[:, :2] / 10
    old = cKDTree(mapped) if len(mapped) else None
    top = ndimage.maximum_filter(sm, size=7)  # a tree in the fill is as tall as the canopy top around it
    GC_ = 8.0
    grid, keep = {}, []
    for r, c in cand:
        x, y, h = gx[c] + rng.uniform(-0.4, 0.4), gy[r] + rng.uniform(-0.4, 0.4), float(top[r, c]) * rng.uniform(0.85, 1.0)
        sep = min(6.5, max(3.6, 0.17 * h + 2.4))
        if old is not None and old.query_ball_point((x, y), 3.5):
            continue
        cx, cy = int(x // GC_), int(y // GC_)
        if any((qx - x) ** 2 + (qy - y) ** 2 < (0.5 * (sep + qs)) ** 2
               for i in range(cx - 1, cx + 2) for j in range(cy - 1, cy + 2) for (qx, qy, qs) in grid.get((i, j), ())):
            continue
        grid.setdefault((cx, cy), []).append((x, y, sep))
        keep.append((x, y, h))
    T = scene["terrain"]
    tz = np.frombuffer(base64.b64decode(json.load(open(os.path.join(C.out, T["file"])))["data"]), "<i2").reshape(T["ny"], T["nx"]) * T.get("scale", 0.1)
    trees = []
    for x, y, h in keep:
        c, r = (x - x0) / T["cell"], (y1 - y) / T["cell"]
        z = float(ndimage.map_coordinates(tz, [[r], [c]], order=1, mode="nearest")[0])
        trees += [round(x * 10), round(y * 10), round(z * 10), round(h * 10)]

    # the mask at 2 m: cover weight, canopy height, footway under the canopy
    k = int(CELL / FINE)
    H, W = ny // k, nx // k
    down = lambda a: a[:H * k, :W * k].reshape(H, k, W, k).mean((1, 3))
    rch = ndimage.gaussian_filter(down(cover.astype(np.float32)), 0.6)
    gch = np.clip(down(sm * under) * 8, 0, 255)
    bch = ndimage.gaussian_filter(down((foot & cover).astype(np.float32)), 0.5)
    rgb = np.stack([np.clip(rch * 255, 0, 255), gch, np.clip(bch * 255 * 1.4, 0, 255)], -1).round().astype(np.uint8)
    n_cover = int(cover.sum())
    print(f"{C.id}: woods and parks {wood.sum() / 1e4:.0f} ha, canopy over them {n_cover / 1e4:.0f} ha; "
          f"{len(trees) // 4} trees from the canopy (OSM maps {len(mapped)})")
    if not write:
        return rgb, trees
    Image.fromarray(rgb).save(os.path.join(C.out, "woods.png"), optimize=True)
    places["woods"] = trees
    json.dump(places, open(places_path, "w"), separators=(",", ":"))
    scene["woods"] = {"file": "woods.png", "cell": CELL, "nx": W, "ny": H, "x0": x0, "y1": y1, "trees": len(trees) // 4,
                      "encoding": "r: ground cover under the canopy (0-255), g: canopy height x 8 (m), b: a footway under the canopy",
                      "source": CHM_SOURCE}
    scene.setdefault("sources", {})["canopy"] = CHM_SOURCE
    json.dump(scene, open(scene_path, "w"), separators=(",", ":"))  # as build_scene.py writes it
    return rgb, trees


def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--city", nargs="+", default=[])
    ap.add_argument("--all", action="store_true", help="every city with an aerial or drawn ground and Overture land use")
    a = ap.parse_args()
    ids = a.city
    if a.all:
        ids = [c for c in sorted(os.listdir(os.path.join(ROOT, "cities")))
               if os.path.exists(os.path.join(ROOT, "data", "raw", c, "overture_land_use.parquet"))
               and os.path.exists(os.path.join(ROOT, "web", "data", c, "game.json"))]
    for cid in ids:
        build(City(cid))


if __name__ == "__main__":
    main()
