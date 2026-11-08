"""Measured heights for the mapped street trees, from a tree survey: Project PLATEAU's vegetation
models, or a council's tree inventory.

OpenStreetMap maps a street tree as a point, rarely with its height, so build_scene.py gives each
mapped tree a height drawn between 7 and 14 m. PLATEAU (MLIT Japan, CC BY 4.0) surveys some wards'
trees one by one: each `veg:SolitaryVegetationObject` carries `veg:height`, the crown's top above
its root ball, and a modelled crown whose foot gives its position. For a city whose `plateau.veg`
lists CityGML zips (city.json), this reads the 1 km mesh files of their `udx/veg/` folder that
cover the bbox (HTTP range requests, pipeline/rangezip.py), caches the trees in
data/raw/<id>/plateau_veg.json, and then rewrites places.json's mapped trees:

  - a mapped tree within MATCH_M of a surveyed tree takes the survey's height;
  - the other street trees (within STREET_M of a road) take a height drawn from the surveyed trees'
    distribution (their quantiles, the same draw for the same spot), where at least MIN_SURVEYED
    were surveyed; a map with too few borrows a neighbour's (`plateau.veg_from`: Shinjuku takes
    Tokyo's, Higashiyama and Fushimi Kyoto's). Trees in parks and precincts keep theirs.

A city outside Japan names a council's tree inventory in `trees.survey` (city.json): an ArcGIS
feature layer of tree points with a height field, read anonymously, page by page, over the bbox, and
cached in data/raw/<id>/survey_trees.json. Sydney takes the City of Sydney's "Trees" (CC BY 4.0:
species, height, canopy spread and age of each street and park tree in the council's area, about
11,800 in the map). The same matching and drawing then apply, and since OpenStreetMap maps only a
fifth of the council's trees, an inventory with `"add": true` also plants each surveyed tree that no
mapped tree stands within ADD_CLEAR_M of, with its measured height, on the ground of terrain.json,
moved out of the carriageways like the mapped ones (kerbside.py); the canopy trees woods.py
planted within WOODS_CLEAR_M of one are dropped (on a rebuild woods.py keeps clear of them itself).
The canopy height models were checked against the inventory too (tools/chm_check.py): Meta and
WRI's v1 and v2 see a half of Sydney's surveyed trees, with a correlation of 0.2 and 0.3.

A city with an open LiDAR surface model and a bare-earth model of the same flight (city.json
`surface_check` and `terrain`, both STAC collections, as LINZ's Queenstown 2021 1 m DSM and DEM) and
`"lidar": true` in `trees` takes each mapped tree's height from them instead: the highest return
within LIDAR_R_M of the trunk over the ground there, where it lies between MIN_H and LIDAR_MAX_M
(a tree felled since the flight, or a roof beside it, keeps the height it had).

PLATEAU surveys trees in its LOD3 road pilot areas, so the survey is of street trees. Only tall
trees (class 1) of 3 m and more count; hedges and shrubs are PlantCover. The canopy height model
woods.py plants from was tried too, and sees almost none of them (in Tokyo none of 216; in Kyoto
half, with a correlation of 0.4, reading the taller canopy round them).

    python pipeline/plateau_veg.py --city tokyo
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cityctx import City, city_args  # noqa: E402
from rangezip import RangeFile  # noqa: E402

MATCH_M = 3.0      # a mapped tree this close to a surveyed one is that tree
MIN_SURVEYED = 30  # trees surveyed in the map before their heights stand for the rest
MIN_H = 3.0
ADD_CLEAR_M = 4.0  # a surveyed tree no mapped tree stands this close to is planted
WOODS_CLEAR_M = 3.0  # a canopy tree (woods.py) this close to a planted surveyed tree is that tree
LIDAR_R_M = 2.0    # a mapped tree's crown top: the highest return this close to its point
LIDAR_MAX_M = 40.0
STREET_M = 9.0     # a mapped tree this close to a road's centreline is a street tree
SOURCE = ("Project PLATEAU vegetation models (MLIT, CC BY 4.0): veg:SolitaryVegetationObject heights "
          "for the mapped street trees")


def mesh_box(code):
    """A JIS X 0410 third-level (1 km) mesh code's (w, s, e, n) in degrees."""
    c = str(code)
    lat = int(c[0:2]) / 1.5 + int(c[4]) * 5 / 60 + int(c[6]) * 0.5 / 60
    lon = int(c[2:4]) + 100 + int(c[5]) * 7.5 / 60 + int(c[7]) * 0.75 / 60
    return lon, lat, lon + 0.75 / 60, lat + 0.5 / 60


def parse(text):
    """The trees of a veg GML: (lon, lat, height, class) per SolitaryVegetationObject."""
    out = []
    for part in text.split("<veg:SolitaryVegetationObject ")[1:]:
        part = part.split("</veg:SolitaryVegetationObject>")[0]
        h = re.search(r"<veg:height[^>]*>([\d.]+)<", part)
        cls = re.search(r"<veg:class[^>]*>(\d+)<", part)
        pos = re.findall(r"<gml:pos(?:List)?[^>]*>([^<]+)<", part)
        if not h or not pos:
            continue
        xyz = np.array([float(v) for p in pos for v in p.split()]).reshape(-1, 3)  # lat, lon, height
        foot = xyz[xyz[:, 2] <= xyz[:, 2].min() + 0.5]  # the crown model's foot: the trunk
        out.append([round(float(foot[:, 1].mean()), 7), round(float(foot[:, 0].mean()), 7), float(h.group(1)),
                    int(cls.group(1)) if cls else 0])
    return out


def fetch(C):
    cache = os.path.join(C.raw, "plateau_veg.json")
    if os.path.exists(cache):
        return json.load(open(cache))
    w, s, e, n = C.cfg["bbox"]
    trees = []
    for url in C.cfg.get("plateau", {}).get("veg", []):
        z = zipfile.ZipFile(RangeFile(url))
        for info in z.infolist():
            if "/veg/" not in info.filename or not info.filename.endswith(".gml"):
                continue
            a = mesh_box(os.path.basename(info.filename)[:8])
            if a[0] < e and a[2] > w and a[1] < n and a[3] > s:
                got = parse(z.read(info.filename).decode("utf8"))
                print(f"  {os.path.basename(info.filename)}: {len(got)} trees", flush=True)
                trees += got
    trees = [t for t in trees if w <= t[0] <= e and s <= t[1] <= n]
    os.makedirs(C.raw, exist_ok=True)
    json.dump(trees, open(cache, "w"), separators=(",", ":"))
    return trees


UA = {"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"}


def council_trees(C):
    """A council's tree inventory over the bbox (city.json trees.survey): (lon, lat, height, 1) per tree."""
    sv = C.cfg.get("trees", {}).get("survey", {})
    cache = os.path.join(C.raw, "survey_trees.json")
    if os.path.exists(cache):
        return json.load(open(cache))
    w, s, e, n = C.cfg["bbox"]
    trees, off = [], 0
    while True:
        q = {"where": "1=1", "geometry": f"{w},{s},{e},{n}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
             "spatialRel": "esriSpatialRelIntersects", "outFields": sv["height"], "outSR": 4326, "orderByFields": "OBJECTID",
             "resultOffset": off, "resultRecordCount": 2000, "f": "json"}
        with urllib.request.urlopen(urllib.request.Request(sv["arcgis"] + "/query?" + urllib.parse.urlencode(q), headers=UA), timeout=120) as r:
            d = json.loads(r.read())
        feats = d.get("features", [])
        for f in feats:
            g, h = f.get("geometry") or {}, f["attributes"].get(sv["height"])
            if "x" in g and isinstance(h, (int, float)) and 0 < h < 80:
                trees.append([round(g["x"], 7), round(g["y"], 7), float(h), 1])
        off += len(feats)
        if not feats or not d.get("exceededTransferLimit"):
            break
        time.sleep(0.5)
    print(f"  {sv['arcgis']}: {len(trees)} trees", flush=True)
    os.makedirs(C.raw, exist_ok=True)
    json.dump(trees, open(cache, "w"), separators=(",", ":"))
    return trees


def surveyed_trees(C):
    """The city's surveyed tall trees, once each (two wards' files repeat the trees of a mesh they share)."""
    if C.cfg.get("trees", {}).get("survey"):
        return sorted({(round(t[0], 6), round(t[1], 6)): t for t in council_trees(C) if t[2] >= MIN_H}.values())
    if not C.cfg.get("plateau", {}).get("veg"):
        return []
    return sorted({(round(t[0], 6), round(t[1], 6)): t for t in fetch(C) if t[3] in (0, 1) and t[2] >= MIN_H}.values())


def ground_z(C, x, y):
    """The bare ground (m) at frame points x, y, from terrain.json."""
    import base64
    from scipy import ndimage
    scene = json.load(open(os.path.join(C.out, "scene.json")))
    T, F = scene["terrain"], scene["frame"]
    tz = np.frombuffer(base64.b64decode(json.load(open(os.path.join(C.out, T["file"])))["data"]), "<i2").reshape(T["ny"], T["nx"]) * T.get("scale", 0.1)
    return ndimage.map_coordinates(tz, [(F["y"][1] - np.asarray(y)) / T["cell"], (np.asarray(x) - F["x"][0]) / T["cell"]], order=1, mode="nearest")


def kerbed(C, surveyed):
    """The surveyed trees inside the frame as places.json rows, moved out of the carriageways (kerbside.py)."""
    import kerbside
    S = np.array(surveyed, np.float64)
    sx, sy = C.fwd.transform(S[:, 0], S[:, 1])
    F = json.load(open(os.path.join(C.out, "scene.json")))["frame"]
    k = (sx > F["x"][0]) & (sx < F["x"][1]) & (sy > F["y"][0]) & (sy < F["y"][1])
    z = ground_z(C, sx[k], sy[k])
    rows = np.c_[np.round(sx[k] * 10), np.round(sy[k] * 10), np.round(z * 10), np.round(S[k, 2] * 10)].astype(np.int64).ravel().tolist()
    rows, moved, dropped = kerbside.tidy_trees(rows, json.load(open(os.path.join(C.out, "game.json")))["paths"]["road"], kerbside.tree_room(os.path.basename(os.path.normpath(C.out))))
    return np.array(rows, np.int64).reshape(-1, 4), moved, dropped


def plant_unmapped(C, places, K, moved, dropped):
    """Each surveyed tree (K, kerbed) no mapped tree stands near, planted into places (trees), the canopy trees round it dropped."""
    T = np.array(places.get("trees", []), np.int64).reshape(-1, 4)
    N = K[~np.isfinite(cKDTree(T[:, :2] / 10).query(K[:, :2] / 10, distance_upper_bound=ADD_CLEAR_M)[0])] if len(T) else K
    if not len(N):
        return 0
    W = np.array(places.get("woods", []), np.int64).reshape(-1, 4)
    if len(W):
        near = np.isfinite(cKDTree(N[:, :2] / 10).query(W[:, :2] / 10, distance_upper_bound=WOODS_CLEAR_M)[0])
        places["woods"] = W[~near].ravel().tolist()
        print(f"  {int(near.sum())} canopy trees (woods.py) dropped for the surveyed trees beside them")
    print(f"  {len(N)} surveyed trees planted (of {len(K)} in the frame: {moved} moved to the kerb, {dropped} left out in a carriageway)")
    places["trees"] = T.ravel().tolist() + N.ravel().tolist()
    return len(N)


def lidar_heights(C, write=True):
    """Each mapped tree's height from the LiDAR surface model over the bare earth (trees.lidar)."""
    from fetch_tiles import stac_mosaic
    from pyproj import Transformer
    path = os.path.join(C.out, "places.json")
    places = json.load(open(path))
    T = np.array(places.get("trees", []), np.int64).reshape(-1, 4)
    if not len(T):
        return None
    lon, lat = C.inv.transform(T[:, 0] / 10, T[:, 1] / 10)
    bb = [min(lon) - 0.0005, min(lat) - 0.0005, max(lon) + 0.0005, max(lat) + 0.0005]
    crs = C.cfg["surface_check"]["crs"]
    X, Y = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform(lon, lat)
    got = {}
    for k in ("surface_check", "terrain"):
        a, ok, (x0, y0, x1, y1) = stac_mosaic(C.cfg[k]["collection"], bb, crs, 1.0, pad_m=0)
        got[k] = (np.where(ok, a[0], np.nan), x0, y1)
    h = T[:, 3].astype(np.float64) / 10
    r = int(np.ceil(LIDAR_R_M))
    took = 0
    for i in range(len(T)):
        (s_, x0, y1), (g, gx0, gy1) = got["surface_check"], got["terrain"]
        rr, cc = int(y1 - Y[i]), int(X[i] - x0)
        top = s_[max(0, rr - r):rr + r + 1, max(0, cc - r):cc + r + 1]
        base = g[int(gy1 - Y[i]), int(X[i] - gx0)] if 0 <= int(gy1 - Y[i]) < g.shape[0] and 0 <= int(X[i] - gx0) < g.shape[1] else np.nan
        if top.size and np.isfinite(top).any() and np.isfinite(base):
            v = float(np.nanmax(top) - base)
            if MIN_H <= v <= LIDAR_MAX_M:
                h[i] = v
                took += 1
    print(f"{C.id}: {took} of {len(T)} mapped trees measured by {C.cfg['surface_check'].get('name', 'the LiDAR')} "
          f"(median {np.median(h):.1f} m, 90th percentile {np.percentile(h, 90):.1f} m)")
    if write:
        T[:, 3] = np.round(h * 10).astype(np.int64)
        places["trees"] = T.ravel().tolist()
        json.dump(places, open(path, "w"), separators=(",", ":"))  # as build_scene.py writes it
    return took, len(T)


def calibrate(C, write=True):
    if C.cfg.get("trees", {}).get("lidar") and C.cfg.get("surface_check"):
        return lidar_heights(C, write)
    cfg = C.cfg.get("plateau", {})
    if not cfg.get("veg") and not cfg.get("veg_from") and not C.cfg.get("trees", {}).get("survey"):
        return None
    surveyed = surveyed_trees(C)
    pool = surveyed if len(surveyed) >= MIN_SURVEYED or not cfg.get("veg_from") else surveyed_trees(City(cfg["veg_from"]))
    path = os.path.join(C.out, "places.json")
    places = json.load(open(path))
    council = C.cfg.get("trees", {}).get("survey", {})
    K = kerbed(C, surveyed) if council and surveyed else None
    added = plant_unmapped(C, places, *K) if K is not None and council.get("add") else 0
    T = np.array(places.get("trees", []), np.int64).reshape(-1, 4)
    if not len(T):
        return None
    h = T[:, 3].astype(np.float64) / 10
    hit = np.zeros(len(T), bool)
    if surveyed:
        S = np.array(surveyed, np.float64)
        sx, sy = C.fwd.transform(S[:, 0], S[:, 1])
        d, j = cKDTree(np.c_[sx, sy]).query(T[:, :2] / 10, distance_upper_bound=MATCH_M)
        hit = np.isfinite(d)
        h[hit] = S[j[hit], 2]
    if K is not None and len(K[0]):  # a tree where the kerb put a surveyed one (one planted here) is that tree
        d, j = cKDTree(K[0][:, :2] / 10).query(T[:, :2] / 10, distance_upper_bound=0.5)
        on = np.isfinite(d)
        hit |= on
        h[on] = K[0][j[on], 3] / 10
    street = np.zeros(len(T), bool)
    G = json.load(open(os.path.join(C.out, "game.json"))) if os.path.exists(os.path.join(C.out, "game.json")) else {}
    pts = []
    for r in G.get("paths", {}).get("road", []):
        p = np.array(r["p"], np.float64).reshape(-1, 3)[:, :2] / 10
        for a, b in zip(p[:-1], p[1:]):  # the centreline every 2 m
            k = max(1, int(np.hypot(*(b - a)) / 2))
            pts += list(a + (b - a) * (np.arange(k) / k)[:, None])
    if pts:
        street = np.isfinite(cKDTree(np.array(pts)).query(T[:, :2] / 10, distance_upper_bound=STREET_M)[0])
    spread = len(pool) >= MIN_SURVEYED
    rest = street & ~hit
    if spread:  # the rest of the street trees: the surveyed heights' quantile at a fraction fixed by the spot
        q = ((T[:, 0] * 73856093) ^ (T[:, 1] * 19349663)) % 10007 / 10007.0
        h[rest] = np.quantile(np.array(pool, np.float64)[:, 2], q[rest])
    T[:, 3] = np.round(h * 10).astype(np.int64)
    P = np.array(pool, np.float64)[:, 2] if pool else np.zeros(1)
    print(f"{C.id}: {len(surveyed)} surveyed trees in the map, {len(pool)} in the pool (median {np.median(P):.1f} m, "
          f"90th percentile {np.percentile(P, 90):.1f} m); {int(hit.sum())} of {len(T)} mapped trees matched, "
          + (f"{int(rest.sum())} other street trees drawn from the pool" if spread else "too few to stand for the rest")
          + (f"; {added} surveyed trees the map lacks planted" if added else ""))
    if write:
        places["trees"] = T.ravel().tolist()
        json.dump(places, open(path, "w"), separators=(",", ":"))  # as build_scene.py writes it
        if council.get("attribution"):  # the inventory credited where the page lists its sources
            sp = os.path.join(C.out, "scene.json")
            scene = json.load(open(sp))
            if scene.setdefault("sources", {}).get("tree_heights") != council["attribution"]:
                scene["sources"]["tree_heights"] = council["attribution"]
                json.dump(scene, open(sp, "w"), separators=(",", ":"))
    return int(hit.sum()), len(surveyed)


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    calibrate(C)


if __name__ == "__main__":
    main()
