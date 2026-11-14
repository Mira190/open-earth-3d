"""The railway through a city as OpenStreetMap maps it track by track: every running line above the
ground (no tunnels; with "below": true, the tracks a layer under a bridge too), the platforms beside them and the stopping points, for the lines named in
city.json `rail_osm` ({"bbox": [lon0, lat0, lon1, lat1], "lines": ["山手線", ...]}: a line is a track's
name, or its ref where the tracks are named that way, as Sydney's "City Inner"). Overture's
segments keep a track's class but not its line's name, its gauge or its platforms, which is what a
station is built from. Written in longitude and latitude to cities/<id>/rail_osm.json, which the
city's hooks read (cities/tokyo/rail.py).

    python pipeline/rail_osm.py --city tokyo

The OSM API's map call answers for at most 50,000 nodes, so the box is read in bands from south to
north. OpenStreetMap contributors, ODbL.
"""
import datetime
import json
import os
import time
import urllib.request

from cityctx import city_args

API = "https://api.openstreetmap.org/api/0.6/map.json?bbox={},{},{},{}"
UA = "open-earth-3d (https://github.com/Mira190/open-earth-3d)"
BAND = 0.004   # degrees of latitude a call


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    spec = city.cfg.get("rail_osm")
    if not spec:
        raise SystemExit(f"{city.id}: no rail_osm in city.json")
    x0, y0, x1, y1 = spec["bbox"]
    lines = set(spec["lines"])
    nodes, ways = {}, {}
    y = y0
    while y < y1:
        req = urllib.request.Request(API.format(x0, round(y, 5), x1, round(min(y1, y + BAND), 5)), headers={"User-Agent": UA})
        for e in json.load(urllib.request.urlopen(req, timeout=180))["elements"]:
            (nodes if e["type"] == "node" else ways if e["type"] == "way" else {})[e["id"]] = e
        y += BAND
        time.sleep(1)
    ll = lambda w: [[round(nodes[n]["lon"], 7), round(nodes[n]["lat"], 7)] for n in w["nodes"] if n in nodes]
    # (a city's "below": true keeps a track a layer under the ground that is not a tunnel: a line under a road's bridge,
    # as the Yamanote's under Jingu-bashi between Harajuku and Shibuya)
    below = bool(spec.get("below"))
    above = lambda t: t.get("tunnel") != "yes" and t.get("tunnel") != "building_passage" and (below or int(float(t.get("layer", 0) or 0)) >= 0)
    tracks, platforms, edges, stops = [], [], [], []
    for w in ways.values():
        t = w.get("tags") or {}
        line = t.get("name") if t.get("name") in lines else t.get("ref")
        if t.get("railway") == "rail" and line in lines and above(t) and t.get("usage") == "main":
            tracks.append({"id": w["id"], "line": line, "gauge": int(t.get("gauge", 1067)), "layer": int(t.get("layer", 0)),
                           **({"bridge": t["bridge"]} if t.get("bridge") else {}), "ll": ll(w)})
        elif t.get("railway") == "platform" and above(t) and w["nodes"][0] == w["nodes"][-1]:
            platforms.append({"id": w["id"], **({"ref": t["ref"]} if t.get("ref") else {}), "layer": int(float(t.get("layer", 0) or 0)), "ll": ll(w)})
        elif t.get("railway") == "platform_edge" and above(t) and t.get("ref"):   # a platform mapped by its edge alone
            edges.append({"id": w["id"], "ref": t["ref"], "ll": ll(w)})
    for n in nodes.values():
        t = n.get("tags") or {}
        if t.get("railway") == "stop" and t.get("local_ref") and t.get("station") != "subway" and x0 <= n["lon"] <= x1 and y0 <= n["lat"] <= y1:
            stops.append({"name": t.get("name"), **({"en": t["name:en"]} if t.get("name:en") else {}), "ref": t.get("ref"),
                          "platform": t["local_ref"], "ll": [round(n["lon"], 7), round(n["lat"], 7)]})
    out = {"source": f"OpenStreetMap contributors (ODbL), fetched {datetime.date.today().isoformat()}: railway=rail (usage=main, above ground) of "
                     + ", ".join(sorted(lines)) + "; railway=platform areas and platform_edge lines; railway=stop nodes with a platform number; lon/lat",
           "tracks": sorted(tracks, key=lambda w: w["id"]), "platforms": sorted(platforms, key=lambda w: w["id"]), **({"edges": sorted(edges, key=lambda w: w["id"])} if edges else {}),
           "stops": sorted(stops, key=lambda s: (s["name"] or "", s["platform"]))}
    path = city.file("rail_osm.json")
    json.dump(out, open(path, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{city.id}: {len(tracks)} track pieces, {len(platforms)} platforms, {len(edges)} platform edges, {len(stops)} stops -> {path} ({os.path.getsize(path) // 1024} kB)")


if __name__ == "__main__":
    main()
