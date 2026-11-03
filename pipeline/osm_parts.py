"""A building's parts from OpenStreetMap (building:part ways inside its outline), with their levels, in a
city's local frame: for a landmark whose parts the open-data heights flatten. PLATEAU, for one, gives
Namba Parks' whole complex the 155 m of its tower, and Overture's parts came without their levels;
OpenStreetMap maps each of its terraces as a part with building:levels (and building:min_level for the
bridges over the canyon). Reads the OpenStreetMap API (ODbL), a box round the outline.

    python pipeline/osm_parts.py --city osaka --way 451572345 --out cities/osaka/namba_parks.json
"""
import json
import urllib.request
import xml.etree.ElementTree as ET

from shapely.geometry import Polygon

from cityctx import city_args

API = "https://api.openstreetmap.org/api/0.6"
UA = {"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"}


def get(url):
    return ET.fromstring(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read())


def main():
    def extra(ap):
        ap.add_argument("--way", required=True, help="the building's outline (an OSM way id)")
        ap.add_argument("--out", required=True)
    city, a = city_args(__doc__.splitlines()[0], extra)
    full = get(f"{API}/way/{a.way}/full")
    nodes = {n.get("id"): (float(n.get("lon")), float(n.get("lat"))) for n in full.findall("node")}
    w = full.find("way")
    ring = [nodes[nd.get("ref")] for nd in w.findall("nd")]
    lons, lats = [p[0] for p in ring], [p[1] for p in ring]
    pad = 0.0003
    m = get(f"{API}/map?bbox={min(lons) - pad},{min(lats) - pad},{max(lons) + pad},{max(lats) + pad}")
    nodes = {n.get("id"): (float(n.get("lon")), float(n.get("lat"))) for n in m.findall("node")}
    local = lambda pts: [city.fwd.transform(x, y) for x, y in pts]
    outline = Polygon(local(ring)).buffer(1.0)
    parts = []
    for w in m.findall("way"):
        tags = {t.get("k"): t.get("v") for t in w.findall("tag")}
        if "building:part" not in tags or "building:levels" not in tags:
            continue
        refs = [nd.get("ref") for nd in w.findall("nd")]
        if any(r not in nodes for r in refs) or len(refs) < 4:
            continue
        pts = local([nodes[r] for r in refs])
        p = Polygon(pts)
        if not p.is_valid or p.area < 1.0 or not outline.contains(p.representative_point()):
            continue
        parts.append({"osm": f"w{w.get('id')}", "levels": float(tags["building:levels"]), "min_level": float(tags.get("building:min_level", 0)),
                      **({"height_m": float(tags["height"])} if "height" in tags else {}),
                      "ring": [[round(x, 2), round(y, 2)] for x, y in pts]})
    parts.sort(key=lambda q: q["osm"])
    json.dump({"source": f"OpenStreetMap contributors (ODbL), building:part ways inside way {a.way}", "outline": f"w{a.way}", "parts": parts},
              open(a.out, "w"), indent=1)
    print(f"{len(parts)} parts -> {a.out}")


if __name__ == "__main__":
    main()
