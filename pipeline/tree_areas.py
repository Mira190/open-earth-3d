"""The outlines of the places whose trees take a mix of their own (city.json trees.areas).

A city's mix of the shared trees (web/assets/trees/, blender/build_trees.py) is one guess for all its
streets and parks. Some places are known for their own: the black pines on the Kyoto Gyoen's and the
Kokyo Gaien's lawns, the camphors and evergreen oaks of Meiji Jingu's wood, the ginkgo rows of Jingu
Gaien. An area in city.json names its place by its OpenStreetMap element ("osm": "W123" or "R123") or by
a search ("find": "Kyoto Gyoen"), and gives a mix for every tree inside it ("mix") and, if they
differ, for the trees planted from its canopy ("woods"). This writes each place's outline, in the
city's local metres and simplified to about 4 m, with the element it found, to
cities/<id>/tree_areas.json, then refreshes scene.json (pipeline/scene_config.py), whose trees.areas
carry them as "xy" (cityctx.trees_cfg). web/trees.js tests each tree against it.

The outlines come from OpenStreetMap (ODbL) through Nominatim's lookup (one request a second, as its
usage policy asks).

    python pipeline/tree_areas.py --city kyoto
"""
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import shapely
from shapely.geometry import shape

from cityctx import ROOT, city_args

UA = "open-earth-3d (https://github.com/Mira190/open-earth-3d)"
NOMINATIM = "https://nominatim.openstreetmap.org"
_last = [0.0]


def get(path, **q):
    wait = 1.1 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    req = urllib.request.Request(f"{NOMINATIM}/{path}?{urllib.parse.urlencode(q)}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def outline(city, area):
    """The area's polygon in local metres, and its OSM element."""
    if area.get("osm"):
        hits = get("lookup", osm_ids=area["osm"], format="json", polygon_geojson=1)
    else:
        lon0, lat0, lon1, lat1 = city.cfg["bbox"]
        hits = get("search", q=area["find"], format="json", polygon_geojson=1, limit=10, bounded=1,
                   viewbox=f"{lon0},{lat1},{lon1},{lat0}")
    for h in hits:
        g = shape(h.get("geojson") or {"type": "Point", "coordinates": [0, 0]})
        if g.geom_type not in ("Polygon", "MultiPolygon"):
            continue
        local = city.to_local(g)
        if local.geom_type == "MultiPolygon":       # the largest part: an area is one place
            local = max(local.geoms, key=lambda p: p.area)
        local = shapely.simplify(local, 4.0)
        return [[round(x), round(y)] for x, y in list(local.exterior.coords)[:-1]], h["osm_type"][0].upper() + str(h["osm_id"])
    raise SystemExit(f"{city.id}: no outline for {area.get('osm') or area.get('find')!r}")


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    areas = (city.cfg.get("trees") or {}).get("areas") or []
    out = {}
    for a in areas:
        if not (a.get("osm") or a.get("find")):
            continue
        xy, osm = outline(city, a)
        out[a["name"]] = {"osm": osm, "xy": xy}
        print(f"  {a['name']}: {osm}, {len(xy)} points")
    path = city.file("tree_areas.json")
    with open(path, "w", encoding="utf8") as f:
        json.dump({"note": "Outlines of city.json trees.areas, by pipeline/tree_areas.py from OpenStreetMap (ODbL) via Nominatim; "
                   "local metres, simplified to about 4 m.", "areas": out}, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(path)
    subprocess.run([sys.executable, os.path.join(ROOT, "pipeline", "scene_config.py"), "--city", city.id], check=True)


if __name__ == "__main__":
    main()
