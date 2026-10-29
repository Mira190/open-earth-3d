"""How good is open data where a laser has measured every roof? For a city with IGN's LiDAR
HD (city.json "ign"), compare each Overture building's open-data height with its LiDAR top
(the 95th percentile inside the footprint, pipeline/measured.py): OpenStreetMap height tags,
floor counts times the city's storey height, Microsoft ML heights and BD TOPO's surveyed
eaves. Then score the LiDAR roof classifier against the roof shapes mappers recorded.

    python analysis/lidar_check.py --city paris     # -> cities/<city>/analysis/lidar_check.json

Ratios are open data / LiDAR; "median_factor" is exp(median |log ratio|), so 1.10 means
half the buildings are within 10%.
"""
import collections
import json
import math
import os
import sys

import duckdb
import numpy as np
from shapely import wkb as swkb
from shapely.geometry import box

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))
from build_scene import Heights  # noqa: E402
from cityctx import city_args  # noqa: E402
from measured import IGNHeights  # noqa: E402

FAMILY = {"flat": "flat", "mansard": "broken", "gambrel": "broken"}


def stat(r):
    r = np.asarray(r)
    if not len(r):
        return None
    return {"n": int(len(r)), "median_factor": round(float(np.exp(np.median(np.abs(r)))), 3),
            "p90_factor": round(float(np.exp(np.percentile(np.abs(r), 90))), 3), "median_ratio": round(float(np.exp(np.median(r))), 3),
            "within_10pct": round(float(np.mean(np.abs(r) <= math.log(1.1))), 3)}


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    if not C.cfg.get("ign"):
        raise SystemExit(f"{C.id}: no 'ign' block in city.json")
    M, H = IGNHeights(C), Heights(C.cfg)
    con = duckdb.connect()
    con.execute("LOAD spatial")
    ext = box(C.x0, C.y0, C.x1, C.y1)
    res = collections.defaultdict(list)
    roof_eaves, conf = [], collections.Counter()
    q = f"SELECT class, height, height_src, num_floors, roof_shape, has_parts, is_underground, wkb FROM '{C.raw}/overture_building.parquet'"
    for cls, h, hsrc, floors, rshape, parts, under, w in con.execute(q).fetchall():
        g = C.to_local(swkb.loads(bytes(w)))
        if under or parts or not ext.contains(g.centroid) or g.geom_type != "Polygon" or g.area < 20:
            continue
        L = M.lidar(g)
        if L is None or L["top"] < 2.0:
            continue
        top = L["top"]
        if h and hsrc == "OpenStreetMap":
            res["osm_height"].append(math.log(h / top))
        elif h:
            res["ml_height"].append(math.log(h / top))
        if floors:
            res["osm_floors"].append(math.log(H.storey_height(cls or "", floors) / top))
        rec = M.match(g)
        if rec:
            if rec.get("eaves_m"):
                res["bdtopo_eaves"].append(math.log(rec["eaves_m"] / top))
                roof_eaves.append(top - rec["eaves_m"])
            if rec.get("storeys") and not floors:
                res["bdtopo_floors"].append(math.log(H.storey_height(rec.get("class") or "", rec["storeys"]) / top))
        if rshape:
            r = M.roof(g, rec, 0.0, top)
            pred = r[0] if r else "flat"
            conf[(FAMILY.get(rshape, "pitched"), FAMILY.get(pred, "pitched"))] += 1
    n = sum(conf.values())
    fam = ["flat", "broken", "pitched"]
    out = {"note": __doc__.split("\n\n")[0].replace("\n", " "),
           "lidar": "IGN LiDAR HD MNH, 0.5 m; the top is the 95th percentile inside the footprint inset 0.6 m",
           "vs_lidar": {k: stat(v) for k, v in res.items()},
           "roof_over_eaves_m": {"n": len(roof_eaves), "p10": round(float(np.percentile(roof_eaves, 10)), 2),
                                 "median": round(float(np.median(roof_eaves)), 2), "p90": round(float(np.percentile(roof_eaves, 90)), 2)} if roof_eaves else None,
           "roof_classifier": {"n": n, "families": "flat; broken (mansard, gambrel); other pitched",
                               "family_accuracy": round(sum(conf[(f, f)] for f in fam) / n, 3) if n else None,
                               "flat_vs_pitched_accuracy": round(sum(v for (a, b), v in conf.items() if (a == "flat") == (b == "flat")) / n, 3) if n else None,
                               "confusion": {f"{a} -> {b}": conf[(a, b)] for a in fam for b in fam}}}
    os.makedirs(C.analysis, exist_ok=True)
    json.dump(out, open(os.path.join(C.analysis, "lidar_check.json"), "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
