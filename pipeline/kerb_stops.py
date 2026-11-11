"""The kerb's fixed places for a city's traffic, from Overture Maps (OpenStreetMap, ODbL): where the
bus stops and the taxi ranks are.

Written into web/data/<id>/game.json as props, points in decimetres like the benches, the lamps and
the signals (pipeline/road_rules.py): "bus_stop" (OSM highway=bus_stop, Overture's infrastructure
class bus_stop: the pole at the kerb) and "taxi_rank" (amenity=taxi, class taxi). Only stops within
14 m of a road piece the game has are kept (a stop on a road left out of the game, or inside a
bus station, serves nobody there), one per 25 m of kerb. The game's buses stop and dwell at them
(web/game/actors.js). This adds them to a game.json already built, without touching the rest:

    python pipeline/fetch_overture.py --city sydney --only infrastructure
    python pipeline/kerb_stops.py sydney tokyo      # these cities
    python pipeline/kerb_stops.py                   # every city with roads and the download
    python pipeline/pack.py                         # then repack game.bin
"""
import json
import os
import sys

import duckdb
import numpy as np
from shapely import wkb as swkb
from shapely.geometry import box

from cityctx import City

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KINDS = {"bus_stop": "bus_stop", "taxi": "taxi_rank"}
NEAR = 14.0   # a stop's pole to the road it serves (m)
APART = 25.0  # stops of one kind nearer than this are one (the two poles of one stop, a mapped platform and its pole)


def main(cities):
    con = duckdb.connect()
    for cid in cities or sorted(os.listdir(os.path.join(ROOT, "cities"))):
        out = os.path.join(ROOT, "web", "data", cid, "game.json")
        if not os.path.exists(out):
            continue
        C = City(cid)
        path = os.path.join(C.raw, "overture_infrastructure.parquet")
        if not os.path.exists(path):
            if cities:
                print(f"{cid}: no {path} (python pipeline/fetch_overture.py --city {cid} --only infrastructure)")
            continue
        game = json.load(open(out, encoding="utf8"))
        roads = (game.get("paths") or {}).get("road") or []
        if not roads:
            continue
        pts = np.concatenate([np.array(o["p"], dtype=float).reshape(-1, 3) for o in roads]) / 10
        extent = box(C.x0, C.y0, C.x1, C.y1)
        found = {k: [] for k in KINDS.values()}
        cur = con.execute(f"SELECT class, wkb FROM '{path}' WHERE class IN ({', '.join(repr(k) for k in KINDS)})")
        for cls, blob in cur.fetchall():
            q = C.to_local(swkb.loads(bytes(blob))).centroid
            if not extent.contains(q):
                continue
            d2 = (pts[:, 0] - q.x) ** 2 + (pts[:, 1] - q.y) ** 2
            i = int(np.argmin(d2))
            if d2[i] > (NEAR + 8) ** 2:  # (the road's points are up to 16 m apart: its line is nearer than its nearest point)
                continue
            keep = found[KINDS[cls]]
            if any((x - q.x) ** 2 + (y - q.y) ** 2 < APART ** 2 for x, y, _ in keep):
                continue
            keep.append((q.x, q.y, pts[i, 2]))
        props = game.setdefault("props", {})
        for k, xyz in found.items():
            props[k] = [round(v * 10) for p in sorted(xyz) for v in p]
        json.dump(game, open(out, "w"), separators=(",", ":"))   # as game_data.py writes it
        print(f"{cid}: " + ", ".join(f"{len(v)} {k}" for k, v in found.items()))


if __name__ == "__main__":
    main(sys.argv[1:])
