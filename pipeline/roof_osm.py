"""OpenStreetMap tags for a city's open roofs and gates, and the precincts they stand in.

    python pipeline/roof_osm.py --city tetsugaku     # after arcades.py has opened them; or --city all

pipeline/arcades.py colours a roof on posts or a gate by what it is: a vermilion shrine pavilion, a
temple gate in bare or dark timber, a station canopy in painted steel. It needs two things the scene's
buildings.json does not keep: a building's own OSM tags (building:colour, roof:colour, building=*,
amenity, religion) and the precinct it stands in (amenity=place_of_worship or landuse=religious, with
its religion and name). This fetches both from the OpenStreetMap API (the Overpass mirrors refuse this
environment) and keeps them in cities/<id>/roofs_osm.json, so arcades.py runs offline:

- the tags: /api/0.6/ways.json and relations.json, 100 ids a call;
- the precincts: /api/0.6/map on a 300 m tile round each roof that has a religious building
  (class shrine, temple or religious, or a name ending in 寺, 社, 宮, 院, 堂 or 門) within 150 m. The
  map call returns every way with a node in the tile, so a precinct is found whenever a corner of it
  lies within 150 m of the roof; a relation is kept when its outer ways all came back.

One request at a time, with the project's User-Agent, and a back-off on 429 and 5xx.
Data (c) OpenStreetMap contributors, ODbL.
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

import shapely
from shapely.geometry import Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cityctx import City  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.openstreetmap.org/api/0.6"
UA = {"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"}
KEEP = ("name", "building", "building:colour", "roof:colour", "building:material", "roof:material", "amenity",
        "religion", "denomination", "historic", "shelter_type", "building:levels", "height", "roof:shape")
TILE_DEG = 0.003
RELIGIOUS_CLASSES = {"shrine", "temple", "religious", "church", "cathedral", "chapel"}
RELIGIOUS_ENDINGS = ("寺", "社", "宮", "院", "堂", "門", "殿", "閣")


def get(url, tries=6):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404 or e.code == 410:
                return {"elements": []}
            if e.code not in (429, 500, 502, 503, 504) or k == tries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if k == tries - 1:
                raise
        time.sleep(5 * 2 ** k)
    return {"elements": []}


def open_roofs(B):
    """(solid index, osm id) of every solid lifted onto posts or opened as a gate (class roof, off the ground)."""
    out = []
    for si, s in enumerate(B["s"]):
        m = B["b"][s[0]]
        if m[1] == "roof" and s[2] > 0:
            out.append((si, m[6] or ""))
    return out


def centroid(s):
    r = s[4]
    xs, ys = r[0::2], r[1::2]
    return sum(xs) / len(xs) / 10, sum(ys) / len(ys) / 10


def fetch_city(cid):
    C = City(cid)
    B = json.load(open(os.path.join(C.out, "buildings.json"), encoding="utf8"))
    roofs = open_roofs(B)
    path = C.file("roofs_osm.json")
    old = json.load(open(path, encoding="utf8")) if os.path.exists(path) else {}
    tags = dict(old.get("tags", {}))
    want = sorted({oid for _, oid in roofs if oid and oid not in tags})
    for kind, letter in (("ways", "w"), ("relations", "r")):
        ids = [o[1:] for o in want if o[0] == letter]
        for i in range(0, len(ids), 100):
            got = get(f"{API}/{kind}.json?{kind}={','.join(ids[i:i + 100])}")
            for e in got.get("elements", []):
                tags[letter + str(e["id"])] = {k: v for k, v in e.get("tags", {}).items() if k in KEEP}
            time.sleep(1)
        for o in ids:
            tags.setdefault(letter + o, {})
    print(f"{cid}: tags for {len(want)} roofs ({len(tags)} kept)")

    precincts = {p["id"]: p for p in old.get("precincts", [])} if C.cfg.get("country_code", "").upper() == "JP" or old.get("precincts") else {}
    tiles_done = set(map(tuple, old.get("tiles", [])))
    if C.cfg.get("country_code", "").upper() == "JP":
        # the religious buildings: where a roof may stand in a precinct
        rel = []
        for s in B["s"]:
            m = B["b"][s[0]]
            if m[1] in RELIGIOUS_CLASSES or (m[0] or "").strip().endswith(RELIGIOUS_ENDINGS):
                rel.append(shapely.Point(*centroid(s)))
        rtree = shapely.STRtree(rel) if rel else None
        tiles = set()
        for si, _ in roofs:
            x, y = centroid(B["s"][si])
            if rtree is None or not len(rtree.query(shapely.Point(x, y).buffer(150))):
                continue
            lon, lat = C.inv.transform(x, y)
            tiles.add((math.floor(lon / TILE_DEG), math.floor(lat / TILE_DEG)))
        todo = sorted(tiles - tiles_done)
        print(f"{cid}: {len(tiles)} precinct tiles, {len(todo)} to fetch")
        for n, (i, j) in enumerate(todo):
            # the tile round the roof's own tile: a third of a tile out on each side
            b = ((i - 0.34) * TILE_DEG, (j - 0.34) * TILE_DEG, (i + 1.34) * TILE_DEG, (j + 1.34) * TILE_DEG)
            got = get(f"{API}/map.json?bbox={b[0]:.6f},{b[1]:.6f},{b[2]:.6f},{b[3]:.6f}")
            nodes = {e["id"]: (e["lon"], e["lat"]) for e in got["elements"] if e["type"] == "node" and "lon" in e}
            ways = {e["id"]: e for e in got["elements"] if e["type"] == "way"}

            def ring(nids):
                pts = [nodes[k] for k in nids if k in nodes]
                if len(pts) < 4 or len(pts) < len(nids):
                    return None
                xs, ys = C.fwd.transform([p[0] for p in pts], [p[1] for p in pts])
                return [[round(a, 1), round(b_, 1)] for a, b_ in zip(xs, ys)]

            def is_precinct(t):
                return t.get("amenity") == "place_of_worship" or t.get("landuse") == "religious"

            for w in ways.values():
                t = w.get("tags", {})
                if is_precinct(t) and w["nodes"][0] == w["nodes"][-1] and ("w%d" % w["id"]) not in precincts:
                    r = ring(w["nodes"])
                    if r and Polygon(r).area > 300:
                        precincts["w%d" % w["id"]] = {"id": "w%d" % w["id"], "name": t.get("name", ""), "religion": t.get("religion", ""),
                                                      "ring": r}
            for e in got["elements"]:
                t = e.get("tags", {})
                if e["type"] != "relation" or not is_precinct(t) or ("r%d" % e["id"]) in precincts:
                    continue
                outers = [ways.get(m["ref"]) for m in e["members"] if m["type"] == "way" and m.get("role") in ("outer", "")]
                if not outers or any(w is None for w in outers):
                    continue
                lines = [shapely.LineString([nodes[k] for k in w["nodes"]]) for w in outers if all(k in nodes for k in w["nodes"])]
                if len(lines) < len(outers):
                    continue
                polys = list(shapely.ops.polygonize(shapely.ops.linemerge(lines))) if lines else []
                if not polys:
                    continue
                P = max(polys, key=lambda p: p.area)
                xs, ys = C.fwd.transform(*P.exterior.coords.xy)
                r = [[round(a, 1), round(b_, 1)] for a, b_ in zip(xs, ys)]
                if Polygon(r).area > 300:
                    precincts["r%d" % e["id"]] = {"id": "r%d" % e["id"], "name": t.get("name", ""), "religion": t.get("religion", ""), "ring": r}
            tiles_done.add((i, j))
            print(f"  tile {n + 1}/{len(todo)}: {len(precincts)} precincts", flush=True)
            time.sleep(1)
    out = {"source": "OpenStreetMap contributors (ODbL), API 0.6 (ways, relations, map), fetched by pipeline/roof_osm.py; "
                     "precinct rings in the city's local metres",
           "tags": dict(sorted(tags.items())), "tiles": sorted(tiles_done),
           "precincts": sorted(precincts.values(), key=lambda p: p["id"])}
    with open(path, "w", encoding="utf8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{cid}: wrote {os.path.relpath(path, ROOT)} ({len(out['precincts'])} precincts)")


def main():
    import shapely.ops  # noqa: F401  (polygonize, linemerge)
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--city", required=True, help="a city id, or all (the live cities with a game)")
    a = ap.parse_args()
    if a.city == "all":
        import subprocess
        ids = subprocess.run([os.path.join(ROOT, "tools", "live_cities.sh")], capture_output=True, text=True).stdout.split()
    else:
        ids = [a.city]
    for cid in ids:
        fetch_city(cid)


if __name__ == "__main__":
    main()
