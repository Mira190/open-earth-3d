"""Rewrite a built city's piers (web/data/<id>/places.json "piers") from its Overture layers,
without rebuilding the scene: the mapped pier polygons and the decks shore.decks finds over the
water (issue 50). Run pipeline/game_data.py after it, which keeps the ferries clear of them.

Needs data/raw/<id>/overture_{water,land,infrastructure,segment}.parquet
(fetch_overture.py --only water land infrastructure segment).

    python pipeline/refresh_piers.py --city tokyo
"""
import json
import os

import duckdb
from shapely.geometry import box

from build_scene import pier_rings, water_polygons
from cityctx import city_args


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    path = os.path.join(C.out, "places.json")
    places = json.load(open(path, encoding="utf8"))
    con = duckdb.connect()
    raw = lambda name: os.path.join(C.raw, f"overture_{name}.parquet")
    extent = box(C.x0, C.y0, C.x1, C.y1)
    sea = water_polygons(C, con, raw, extent)
    before = len(places.get("piers", []))
    places["piers"] = pier_rings(C, con, raw, sea, extent)
    json.dump(places, open(path, "w"), separators=(",", ":"))
    print(f"{C.id}: {before} -> {len(places['piers'])} piers in {path}")


if __name__ == "__main__":
    main()
