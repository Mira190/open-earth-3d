"""How well do PLATEAU's surveyed heights agree with an independent source?

Project PLATEAU gives most Tokyo buildings a measured height. Heights that
OpenStreetMap contributors have mapped (a `height` tag on the footprint, mostly for towers)
are an independent measurement, so each building that has both is a test of the pipeline's
height source. Both are roof heights above ground, and both can carry a spire or a plant
room, so a few percent of disagreement is expected.

    python analysis/plateau_check.py --city tokyo      # -> cities/<city>/analysis/heights.json

The output has the same shape as analysis/heights.py's, so the viewer's accuracy panel
and the game's {acc:...} tokens work unchanged.
"""
import json
import os
import statistics as st
import sys

import duckdb
from shapely import wkb as swkb

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))
from build_scene import Plateau  # noqa: E402
from cityctx import city_args  # noqa: E402


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    P = Plateau(C)
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial")
    rows = []
    q = f"""SELECT name, height, wkb FROM '{C.raw}/overture_building.parquet'
            WHERE height_src = 'OpenStreetMap' AND height >= 20 AND NOT has_parts AND NOT is_underground"""
    for name, h, w in con.execute(q).fetchall():
        g = C.to_local(swkb.loads(bytes(w)))
        if not (C.x0 < g.centroid.x < C.x1 and C.y0 < g.centroid.y < C.y1) or g.geom_type != "Polygon":
            continue
        pc = P.pieces(g)
        if not pc:
            continue
        m = max(hh for _, hh, _ in pc)
        rows.append({"name": name or "(unnamed)", "ref_m": float(h), "model_m": round(m, 1), "match": "address", "how": "osm",
                     "error_m": round(m - h, 1), "error_pct": round(100 * (m - h) / h, 1), "height_src": "plateau"})
    rows.sort(key=lambda r: -r["ref_m"])
    err = [abs(r["error_pct"]) for r in rows]
    summary = {"reference": len(rows), "matched": len(rows), "median_abs_error_pct": round(st.median(err), 1),
               "median_error_m": round(st.median([r["error_m"] for r in rows]), 1),
               "within_10pct": sum(e <= 10 for e in err), "within_20pct": sum(e <= 20 for e in err),
               "gross_short": sum(r["error_pct"] < -40 for r in rows),
               "gross_tall": sum(r["error_pct"] > 40 for r in rows),
               "by_source": {"plateau": {"n": len(rows), "median_abs_error_pct": round(st.median(err), 1)}}}
    out = {"note": "PLATEAU's surveyed roof heights against heights mapped in OpenStreetMap, for buildings of 20 m and taller that carry both.",
           "method": "that carry both a PLATEAU height and a height tag in OpenStreetMap (an independent source), 20 m and taller",
           "summary": summary, "rows": rows}
    os.makedirs(C.analysis, exist_ok=True)
    json.dump(out, open(os.path.join(C.analysis, "heights.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps(summary, indent=1))
    for r in sorted(rows, key=lambda r: -abs(r["error_pct"]))[:12]:
        print(f"{r['name'][:30]:30s} osm {r['ref_m']:6.1f}  plateau {r['model_m']:6.1f}  {r['error_pct']:+6.1f}%")


if __name__ == "__main__":
    main()
