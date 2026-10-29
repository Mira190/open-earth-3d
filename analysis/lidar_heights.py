"""How good are the model's heights, measured against an airborne LiDAR surface model?

Where a city publishes a LiDAR surface model (city.json `surface_check`; Hong Kong's
2020 survey covers the whole territory at 0.5 m), every roof in the model can be
checked against a sensor that knows nothing about the height ladder. For each
building, the roof level the laser saw is the median surface inside the outline
drawn 1 m in (walls, eaves and overhanging trees drop out), and the model's roof
level is its tallest solid's top above the datum. Rooftop plant and parapets sit
above most roofs, so the comparison is made on the building's largest solid.

Three results:
  * the model against the LiDAR, by height source (survey, LiDAR fallback, floors,
    estimate...): median and 90th-percentile error in metres, and the bias;
  * the open data against the survey, where a mapping agency's survey exists:
    OpenStreetMap height tags and floor counts times the storey height, both
    scored against the surveyed heights, which shows what a city without a survey
    would get;
  * the worst disagreements between survey and LiDAR, to read one by one (a
    building finished or demolished since the 2020 flight, a block outline that
    misses a tower).

    python analysis/lidar_heights.py --city hong-kong   # -> cities/<city>/analysis/lidar_heights.json
"""
import json
import os
import sys
from collections import defaultdict

import duckdb
import numpy as np
from shapely import wkb as swkb
from shapely.geometry import Polygon

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))
from build_scene import DEM_CELL, LIDAR_CELL, Heights, load_dem, sample  # noqa: E402
from cityctx import city_args, polygons  # noqa: E402
from survey import Survey  # noqa: E402


def stats(err):
    e = np.asarray(err, float)
    if not len(e):
        return None
    return {"n": int(len(e)), "median_abs_m": round(float(np.median(np.abs(e))), 2), "p90_abs_m": round(float(np.percentile(np.abs(e), 90)), 2),
            "bias_m": round(float(np.median(e)), 2), "within_2m_pct": round(float(np.mean(np.abs(e) <= 2.0) * 100), 1)}


def rel_stats(model, truth):
    m, t = np.asarray(model, float), np.asarray(truth, float)
    if not len(m):
        return None
    r = (m - t) / t * 100
    return {"n": int(len(m)), "median_abs_error_pct": round(float(np.median(np.abs(r))), 1), "bias_pct": round(float(np.median(r)), 1),
            "within_10pct": round(float(np.mean(np.abs(r) <= 10) * 100), 1), "over_40pct_short": int(np.sum(r < -40))}


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    if not os.path.exists(os.path.join(C.raw, "dsm.json")):
        raise SystemExit(f"{C.id} has no LiDAR surface model (city.json surface_check; run pipeline/fetch_tiles.py)")
    dsm = load_dem(C, LIDAR_CELL, "dsm")
    dem = load_dem(C, DEM_CELL)
    B = json.load(open(os.path.join(C.out, "buildings.json")))
    sv = Survey(C, lambda x, y: sample(C, dem, x, y), dsm, LIDAR_CELL)

    # the model against the LiDAR: each building's largest solid
    largest = {}
    for s in B["s"]:
        q = Polygon(np.asarray(s[4], float).reshape(-1, 2) / 10)
        if s[0] not in largest or q.area > largest[s[0]][1].area:
            largest[s[0]] = (s, q)
    by_src, rows = defaultdict(list), []
    for bi, (s, q) in largest.items():
        m = B["b"][bi]
        if q.area < 30 or m[4] == "parametric":
            continue
        v = sv.surface(q)
        if len(v) < 8:
            continue
        lidar_roof, model_roof = float(np.median(v)), (s[1] + s[3]) / 10
        if lidar_roof - s[1] / 10 < 2.0:  # bare ground under the footprint: built after the flight
            rows.append({"name": m[0], "osm_id": m[6], "source": m[4], "model_m": round(model_roof, 1), "lidar_m": round(lidar_roof, 1), "note": "no roof in the 2020 LiDAR"})
            continue
        e = model_roof - lidar_roof
        by_src[m[4]].append(e)
        rows.append({"name": m[0], "osm_id": m[6], "source": m[4], "height_m": m[2], "model_m": round(model_roof, 1), "lidar_m": round(lidar_roof, 1),
                     "error_m": round(e, 1)})
    model_vs_lidar = {k: stats(v) for k, v in sorted(by_src.items())}
    print("model roof vs LiDAR roof, by height source:")
    for k, v in model_vs_lidar.items():
        print(f"  {k:10s} {v}")

    # the open data against the survey: OSM height tags and floor counts on surveyed buildings
    out = {"city": C.id, "lidar": C.cfg["surface_check"].get("name"), "model_vs_lidar_m": model_vs_lidar}
    if sv.tree is not None:
        H = Heights(C.cfg)
        con = duckdb.connect()
        con.execute("LOAD spatial")
        tags, floors = [[], []], [[], []]
        for b in con.execute(f"SELECT class, subtype, height, num_floors, height_src, has_parts, is_underground, wkb FROM '{C.raw}/overture_building.parquet'").fetchall():
            cls, sub, h, nf, hsrc, parts, under, w = b
            if under or parts or not (h or nf):
                continue
            g = C.to_local(swkb.loads(bytes(w)))
            if not C.x0 < g.centroid.x < C.x1 or not C.y0 < g.centroid.y < C.y1:
                continue
            pc = sv.pieces(max(polygons(g), key=lambda p: p.area)) if polygons(g) else None
            if not pc:
                continue
            truth = max(h_ for _, h_, _ in pc)  # the surveyed height of the tallest block on the footprint
            if truth < 3:
                continue
            if h and hsrc == "OpenStreetMap":
                tags[0].append(float(h))
                tags[1].append(truth)
            if nf:
                floors[0].append(H.storey_height(cls or sub or "", nf))
                floors[1].append(truth)
        out["open_data_vs_survey"] = {"osm_height_tags": rel_stats(*tags), "osm_floor_counts": rel_stats(*floors),
                                      "storey": {k: list(v) for k, v in H.storey.items()},
                                      "note": "OpenStreetMap heights on buildings the survey covers, scored against the surveyed height of the tallest block on the footprint."}
        print("open data vs survey:", json.dumps(out["open_data_vs_survey"]))
    surveyed = [r for r in rows if r["source"] == "survey" and "error_m" in r]
    out["worst_survey_vs_lidar"] = sorted(surveyed, key=lambda r: -abs(r["error_m"]))[:25]
    out["no_roof_in_lidar"] = [r for r in rows if "note" in r][:40]
    out["no_roof_in_lidar_n"] = sum(1 for r in rows if "note" in r)
    tall = [r for r in surveyed if r["height_m"] >= 100]
    out["towers_100m_vs_lidar"] = stats([r["error_m"] for r in tall])
    print("towers of 100 m and more:", out["towers_100m_vs_lidar"])
    os.makedirs(C.analysis, exist_ok=True)
    json.dump(out, open(os.path.join(C.analysis, "lidar_heights.json"), "w", encoding="utf8"), indent=1, ensure_ascii=False)
    print(f"-> {os.path.join(C.analysis, 'lidar_heights.json')}")


if __name__ == "__main__":
    main()
