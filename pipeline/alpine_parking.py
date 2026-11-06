"""The parking stalls of an alpine site's car parks, for the parked cars (web/reef/alpine/parked.js).

The aerial photographs have the cars of the day they were flown printed in them; pipeline/aerial_clean.py fills most
of them from the tarmac round them, but a few remain, and an empty car park is not how Tekapo's looks. OpenStreetMap
maps many car parks stall by stall (amenity=parking_space: Tekapo's township has some 300), so a parked car can stand
in a real stall, along its long side, nose in. From Overture's infrastructure theme (OpenStreetMap; ODbL), class
parking_space, over the site's bbox; each stall's oriented rectangle as [x, y, heading in degrees (its long side's
bearing, clockwise from north), length, width] in metres in the site's local frame.

    python pipeline/alpine_parking.py --city lake-tekapo     # -> web/data/<id>/parking.json

If your environment injects AWS credentials, unset them first (see fetch_overture.py).
"""
import json
import math
import os

import numpy as np
from shapely import wkb as swkb

from cityctx import city_args


def fetch(C):
    path = os.path.join(C.raw, "overture_parking_space.parquet")
    if not os.path.exists(path):
        import duckdb
        os.makedirs(C.raw, exist_ok=True)
        con = duckdb.connect()
        con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
        con.execute("CREATE OR REPLACE SECRET anon (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2');")
        root = f"s3://overturemaps-us-west-2/release/{C.cfg['overture_release']}"
        w, s, e, n = C.cfg["bbox"]
        con.execute(f"""COPY (SELECT id, class, ST_AsWKB(geometry) AS wkb FROM read_parquet('{root}/theme=base/type=infrastructure/*', hive_partitioning=1)
            WHERE bbox.xmax > {w} AND bbox.xmin < {e} AND bbox.ymax > {s} AND bbox.ymin < {n} AND class = 'parking_space') TO '{path}' (FORMAT parquet)""")
    import duckdb
    return [C.to_local(swkb.loads(bytes(r[0]))) for r in duckdb.connect().execute(f"SELECT wkb FROM '{path}'").fetchall()]


def stalls(geoms):
    out = []
    for g in geoms:
        if g.geom_type != "Polygon" or not (6 <= g.area <= 60):   # a car's stall (a coach's bay or a mapping slip left out)
            continue
        r = g.minimum_rotated_rectangle
        cs = np.array(r.exterior.coords[:4])
        e1, e2 = cs[1] - cs[0], cs[2] - cs[1]
        long_, short = (e1, e2) if np.linalg.norm(e1) >= np.linalg.norm(e2) else (e2, e1)
        L, W = float(np.linalg.norm(long_)), float(np.linalg.norm(short))
        if L < 3.8 or W < 1.8 or L > 9:
            continue
        c = r.centroid
        out.append([round(c.x, 2), round(c.y, 2), round(math.degrees(math.atan2(long_[0], long_[1])) % 180, 1), round(L, 2), round(W, 2)])
    return out


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    S = stalls(fetch(C))
    path = os.path.join(C.out, "parking.json")
    json.dump({"source": f"Overture Maps {C.cfg['overture_release']} infrastructure, class parking_space (OpenStreetMap; ODbL)",
               "fields": ["x", "y", "heading_deg", "length_m", "width_m"], "stalls": S}, open(path, "w"), separators=(",", ":"))
    print(f"{path}: {len(S)} stalls")


if __name__ == "__main__":
    main()
