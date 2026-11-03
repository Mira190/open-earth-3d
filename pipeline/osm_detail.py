"""OpenStreetMap's fine detail round a landmark, which Overture's layers leave out: the street furniture,
entrances, railways and their bridges, barriers, signals and crossings, building parts, trees and
artworks, mapped there by hand. Read from the OSM API's map call for each box in city.json
`osm_detail` ({"<name>": {"bbox": [lon0, lat0, lon1, lat1]}}) and written, in longitude and
latitude with each feature's tags, to cities/<id>/<name>_osm.json, which city.py reads.

    python pipeline/osm_detail.py --city shibuya

OpenStreetMap contributors, ODbL.
"""
import datetime
import json
import os
import urllib.request

from cityctx import city_args

API = "https://api.openstreetmap.org/api/0.6/map.json?bbox={},{},{},{}"
UA = "open-earth-3d (https://github.com/Mira190/open-earth-3d)"
# the tags that make a node or a way worth keeping (any value), and those kept only for some values
KEEP = ("railway", "entrance", "barrier", "man_made", "tourism", "historic", "advertising", "emergency", "natural",
        "bridge", "building:part", "area:highway", "crossing", "kerb", "tactile_paving", "street_lamp", "bench",
        "covered", "highway", "building", "amenity", "shop", "leisure", "layer", "level", "name", "ref", "height",
        "min_height", "building:levels", "building:min_level", "colour", "material", "operator", "brand", "direction",
        "oneway", "lanes", "lanes:forward", "lanes:backward", "turn:lanes", "width", "surface", "support", "lamp_type", "vending")
WANT_NODE = {"railway", "entrance", "barrier", "man_made", "tourism", "historic", "advertising", "emergency", "natural",
             "crossing", "highway", "amenity", "kerb", "tactile_paving"}
WANT_WAY = {"railway", "bridge", "barrier", "man_made", "building:part", "area:highway", "highway", "building", "amenity",
            "tactile_paving", "covered"}
SKIP_AMENITY = {"restaurant", "cafe", "bar", "pub", "fast_food", "bank", "atm", "pharmacy", "clinic", "doctors", "dentist",
                "karaoke_box", "gambling", "nightclub", "cinema", "theatre", "college", "library", "hospital", "bureau_de_change",
                "ice_cream", "events_venue", "vacant", "food_court"}


def keep(e, want):
    t = e.get("tags") or {}
    if not any(k in t for k in want):
        return False
    return t.get("amenity") not in SKIP_AMENITY or any(k in t for k in want - {"amenity"})


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    for name, spec in city.cfg.get("osm_detail", {}).items():
        x0, y0, x1, y1 = spec["bbox"]
        req = urllib.request.Request(API.format(x0, y0, x1, y1), headers={"User-Agent": UA})
        data = json.load(urllib.request.urlopen(req, timeout=180))
        els = data["elements"]
        nodes = {e["id"]: e for e in els if e["type"] == "node"}
        inside = lambda lon, lat: x0 <= lon <= x1 and y0 <= lat <= y1
        out_n, out_w = [], []
        for e in els:
            if e["type"] == "node" and inside(e["lon"], e["lat"]) and keep(e, WANT_NODE):
                out_n.append({"id": e["id"], "ll": [round(e["lon"], 7), round(e["lat"], 7)],
                              "tags": {k: v for k, v in e["tags"].items() if k in KEEP or k.startswith("name:en")}})
            elif e["type"] == "way" and keep(e, WANT_WAY):
                pts = [nodes[n] for n in e["nodes"] if n in nodes]
                if not pts or not any(inside(p["lon"], p["lat"]) for p in pts):
                    continue
                out_w.append({"id": e["id"], "ll": [[round(p["lon"], 7), round(p["lat"], 7)] for p in pts],
                              "nodes": e["nodes"], "tags": {k: v for k, v in e["tags"].items() if k in KEEP or k.startswith("name:en")}})
        # the nodes on the kept ways that carry tags of their own (a crossing's signals, a kerb)
        out = {"source": f"OpenStreetMap contributors (ODbL), API map call {spec['bbox']}, fetched {datetime.date.today().isoformat()}; lon/lat",
               "nodes": out_n, "ways": out_w}
        path = city.file(f"{name}_osm.json")
        with open(path, "w", encoding="utf8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{name}: {len(out_n)} nodes, {len(out_w)} ways -> {path} ({os.path.getsize(path) / 1e3:.0f} kB)")


if __name__ == "__main__":
    main()
