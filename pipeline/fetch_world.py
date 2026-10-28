"""The globe's base map: Natural Earth land, lakes and country borders (public
domain), simplified and quantised to 0.02 degrees. Land and lakes are polygons
(lists of rings, holes after the outer ring); borders are lines.

    python pipeline/fetch_world.py      # -> web/data/world.json
"""
import json
import os

import requests
from shapely.geometry import shape

from cityctx import ROOT

NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/{}.geojson"
LAYERS = {"land": ("ne_50m_land", 0.04, 0.1), "lakes": ("ne_50m_lakes", 0.04, 0.5), "borders": ("ne_110m_admin_0_boundary_lines_land", 0.04, 0)}
Q = 50  # 1 / 0.02 degrees


def flat(coords):
    out, last = [], None
    for x, y in coords:
        p = (round(x * Q), round(y * Q))
        if p != last:
            out += p
            last = p
    return out


def main():
    world = {"q": 1 / Q, "source": "Natural Earth (public domain): 1:50m land and lakes, 1:110m country borders"}
    for key, (name, tol, min_area) in LAYERS.items():
        fc = requests.get(NE.format(name), timeout=120).json()
        parts = []
        for f in fc["features"]:
            g = shape(f["geometry"]).simplify(tol, preserve_topology=True)
            for p in getattr(g, "geoms", [g]):
                if p.geom_type == "Polygon":
                    if p.area >= min_area:
                        parts.append([flat(p.exterior.coords)] + [flat(r.coords) for r in p.interiors if len(r.coords) > 3])
                elif p.geom_type == "LineString":
                    parts.append(flat(p.coords))
        world[key] = [r for r in parts if (len(r) >= 4 if isinstance(r[0], int) else len(r[0]) >= 6)]
        pts = sum(len(r) if isinstance(r[0], int) else sum(map(len, r)) for r in world[key]) // 2
        print(f"{key}: {len(world[key])} parts, {pts} points")
    path = os.path.join(ROOT, "web", "data", "world.json")
    json.dump(world, open(path, "w"), separators=(",", ":"))
    print(f"{path}: {os.path.getsize(path) / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
