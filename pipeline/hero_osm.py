"""The measured things a hero level is built on (docs/HERO.md): OpenStreetMap's map of a small rectangle,
through its own API (the Overpass mirrors are often unreachable from a build machine), kept as local metres.

    python pipeline/hero_osm.py --city sydney --box -262 150 -128 322

writes cities/<id>/hero_osm.json: {"nodes": [{"xy", "tags"}], "ways": [{"id", "xy", "tags", "closed"}]}
of every tagged node and way that touches the box (x0 y0 x1 y1, local metres), without the routes and
railways that only pass through. (c) OpenStreetMap contributors, ODbL.
"""
import argparse
import json
import os
import urllib.request

from pyproj import Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"}
SKIP = ("route", "railway", "boundary", "type", "public_transport")
DROP = ("source", "created_by", "wikidata", "wikipedia", "ref:", "addr:", "check_date", "survey:", "website", "phone", "opening_hours", "contact:", "operator", "brand", "payment:", "note", "fixme", "start_date:")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--city", required=True)
    ap.add_argument("--box", nargs=4, type=float, required=True, metavar=("X0", "Y0", "X1", "Y1"))
    ap.add_argument("--out", default="hero_osm.json")
    a = ap.parse_args()
    city = json.load(open(os.path.join(ROOT, "cities", a.city, "city.json")))
    lon0, lat0 = city["origin"]
    proj = f"+proj=tmerc +lat_0={lat0} +lon_0={lon0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs"
    fwd = Transformer.from_crs("EPSG:4326", proj, always_xy=True)
    inv = Transformer.from_crs(proj, "EPSG:4326", always_xy=True)
    x0, y0, x1, y1 = a.box
    (w, s), (e, n) = inv.transform(x0, y0), inv.transform(x1, y1)
    url = f"https://api.openstreetmap.org/api/0.6/map.json?bbox={w:.6f},{s:.6f},{e:.6f},{n:.6f}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
        d = json.load(r)
    N = {el["id"]: el for el in d["elements"] if el["type"] == "node"}

    def xy(nd):
        x, y = fwd.transform(nd["lon"], nd["lat"])
        return [round(x, 2), round(y, 2)]

    def tags(el):
        return {k: v for k, v in (el.get("tags") or {}).items() if not k.startswith(DROP)}

    inside = lambda p: x0 <= p[0] <= x1 and y0 <= p[1] <= y1
    nodes, ways = [], []
    for el in d["elements"]:
        t = tags(el)
        if not t:
            continue
        if el["type"] == "node":
            p = xy(el)
            if inside(p):
                nodes.append({"xy": p, "tags": t})
        elif el["type"] == "way" and not any(k in t for k in SKIP):
            pts = [xy(N[i]) for i in el["nodes"] if i in N]
            if any(inside(p) for p in pts):
                ways.append({"id": el["id"], "xy": pts, "tags": t, "closed": el["nodes"][0] == el["nodes"][-1]})
    out = os.path.join(ROOT, "cities", a.city, a.out)
    json.dump({"source": "OpenStreetMap contributors (ODbL), api.openstreetmap.org map call", "box": a.box,
               "nodes": nodes, "ways": ways}, open(out, "w"), ensure_ascii=False, separators=(",", ":"))
    print(f"{out}: {len(nodes)} nodes, {len(ways)} ways ({os.path.getsize(out) / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
