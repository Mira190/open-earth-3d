"""Measured heights for the mapped street trees, from Project PLATEAU's vegetation models.

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
import zipfile

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cityctx import City, city_args  # noqa: E402
from rangezip import RangeFile  # noqa: E402

MATCH_M = 3.0      # a mapped tree this close to a surveyed one is that tree
MIN_SURVEYED = 30  # trees surveyed in the map before their heights stand for the rest
MIN_H = 3.0
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


def surveyed_trees(C):
    """The city's surveyed tall trees, once each (two wards' files repeat the trees of a mesh they share)."""
    if not C.cfg.get("plateau", {}).get("veg"):
        return []
    return sorted({(round(t[0], 6), round(t[1], 6)): t for t in fetch(C) if t[3] in (0, 1) and t[2] >= MIN_H}.values())


def calibrate(C, write=True):
    cfg = C.cfg.get("plateau", {})
    if not cfg.get("veg") and not cfg.get("veg_from"):
        return None
    surveyed = surveyed_trees(C)
    pool = surveyed if len(surveyed) >= MIN_SURVEYED or not cfg.get("veg_from") else surveyed_trees(City(cfg["veg_from"]))
    path = os.path.join(C.out, "places.json")
    places = json.load(open(path))
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
          + (f"{int(rest.sum())} other street trees drawn from the pool" if spread else "too few to stand for the rest"))
    if write:
        places["trees"] = T.ravel().tolist()
        json.dump(places, open(path, "w"), separators=(",", ":"))  # as build_scene.py writes it
    return int(hit.sum()), len(surveyed)


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    calibrate(C)


if __name__ == "__main__":
    main()
