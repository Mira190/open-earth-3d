"""How tall is the model where it matters most? Match the published heights of a
city's tallest buildings (cities/<city>/reference_heights.csv: name, height_m,
floors, year, address, exclude, and optionally lon and lat) to the scene
footprints and score the height pipeline.

Matching is by street address, independent of names: the address is located
with Overture's address points, and the model building is the tallest one within
30 m of that point. Where the list gives coordinates (lon, lat) instead, they are
the point. Rows with a reason in the "exclude" column (an address the
point data cannot resolve) are kept in the output and left out of the summary.

    python analysis/heights.py --city sydney      # -> cities/<city>/analysis/heights.json

The open-data height is scored even on a corrected build, so the result does not
depend on the corrections it feeds: build_scene.py uses the name matches to
correct towers whose open-data height is grossly short.
"""
import csv
import json
import os
import re
import statistics as st
import sys

import duckdb
import numpy as np
from shapely import STRtree
from shapely import wkb as swkb
from shapely.geometry import Point, Polygon

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))
from cityctx import city_args  # noqa: E402

SEARCH_M = 30.0
AT_M = 8.0  # buildings this close to the point count as at it: the tallest of them is the match
STOP = {"the", "street", "st", "tower", "centre", "building", "place"}


def street_key(s):
    s = s.upper().replace("STREET", "ST").replace("AVENUE", "AVE").replace("PLACE", "PL").replace("SQUARE", "SQ")
    return re.sub(r"\s+", " ", s).strip()


def name_words(s, stop):
    w = set(re.findall(r"[a-z0-9]+", s.lower().replace("one", "1").replace("two", "2").replace("three", "3")))
    w = {{"i": "1", "ii": "2", "iii": "3"}.get(x, x) for x in w}
    return w - stop | ({"tower"} & w)


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    stop = STOP | set(re.findall(r"[a-z]+", C.cfg["name"].lower()))
    B = json.load(open(os.path.join(C.out, "buildings.json")))
    polys, owner = [], []
    for s in B["s"]:
        polys.append(Polygon(np.asarray(s[4], float).reshape(-1, 2) / 10))
        owner.append(s[0])
    tree = STRtree(polys)

    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial")
    addr = {}
    for num, street, w in con.execute(f"SELECT number, street, wkb FROM '{C.raw}/overture_address.parquet'").fetchall():
        if num and street:
            addr.setdefault((num.split("-")[0].strip(), street_key(street)), []).append(swkb.loads(bytes(w)))

    rows = []
    ref = C.cfg.get("reference_heights", {}).get("file", "reference_heights.csv")
    for r in csv.DictReader(open(C.file(ref), encoding="utf8")):
        m = re.match(r"(\d+)(?:-\d+)?\s+(.*)", r["address"])
        row = {"name": r["name"], "ref_m": float(r["height_m"]), "ref_floors": int(r["floors"]) if r["floors"] else None,
               "year": r["year"], "address": r["address"]}
        if r.get("lon") and r.get("lat"):  # the list's own coordinates, where it gives them instead of an address
            pts = [Point(float(r["lon"]), float(r["lat"]))]
        else:
            pts = addr.get((m.group(1), street_key(m.group(2)))) if m else None
        if not pts:
            row["match"] = "address not found"
            rows.append(row)
            continue
        x, y = C.fwd.transform(np.mean([p.x for p in pts]), np.mean([p.y for p in pts]))
        row["xy"] = [round(x, 1), round(y, 1)]
        if not (C.x0 < x < C.x1 and C.y0 < y < C.y1):
            row["match"] = "outside scene"
            rows.append(row)
            continue
        cand = {owner[i] for i in tree.query(Point(x, y).buffer(SEARCH_M), predicate="intersects")}
        if not cand:
            row["match"] = "no footprint"
            rows.append(row)
            continue
        # prefer a name match, then the footprint holding the address point, then the nearest
        here = Point(x, y)
        dist = {i: min(polys[k].distance(here) for k in range(len(polys)) if owner[k] == i) for i in cand}
        words = name_words(r["name"], stop)
        named = [i for i in cand if words and words <= name_words(B["b"][i][0], stop) | {"tower"}]
        how = "name" if named else ("inside" if min(dist.values()) == 0 else "nearest")
        # among the named buildings, or else all of them: the tallest at the point (a tower over its
        # podium, mapped as two), and failing that the nearest
        pool = named or cand
        at = [i for i in pool if dist[i] <= AT_M]
        bi = max(at, key=lambda i: B["b"][i][9]) if at else min(pool, key=lambda i: dist[i])
        meta = list(B["b"][bi])
        meta[2] = meta[9]  # score the open-data height, before any reference correction
        if meta[4] in ("reference", "verified"):
            meta[4] = "floors" if meta[3] else "estimate"
        row.update({"match": "address", "how": how, "building": bi, "model_name": meta[0], "model_m": meta[2], "model_floors": meta[3],
                    "height_src": meta[4], "osm_id": meta[6]})
        row["error_m"] = round(meta[2] - row["ref_m"], 1)
        row["error_pct"] = round(100 * (meta[2] - row["ref_m"]) / row["ref_m"], 1)
        if r.get("exclude"):
            row["match"], row["why"] = "ambiguous", r["exclude"]
        rows.append(row)

    ok = [r for r in rows if r["match"] == "address"]
    err = [abs(r["error_pct"]) for r in ok]
    summary = {
        "reference": len(rows), "matched": len(ok),
        "median_abs_error_pct": round(st.median(err), 1) if err else None,
        "median_error_m": round(st.median([r["error_m"] for r in ok]), 1) if ok else None,
        "within_10pct": sum(e <= 10 for e in err), "within_20pct": sum(e <= 20 for e in err),
        "gross_short": sum(r["error_pct"] < -40 for r in ok),
        "by_source": {s: {"n": len(v), "median_abs_error_pct": round(st.median(v), 1)}
                      for s in {r["height_src"] for r in ok}
                      for v in [[abs(r["error_pct"]) for r in ok if r["height_src"] == s]]},
    }
    out = {"note": "Reference heights are architectural (incl. spires); model heights are roof/top of the tallest solid.",
           "summary": summary, "rows": rows}
    os.makedirs(C.analysis, exist_ok=True)
    json.dump(out, open(os.path.join(C.analysis, "heights.json"), "w"), indent=1)
    print(json.dumps(summary, indent=1))
    for r in rows:
        print(f"{r['name'][:28]:28s} ref {r['ref_m']:5.0f}  ", end="")
        if r["match"] in ("address", "ambiguous"):
            print(r["match"][:3], f"model {r['model_m']:6.1f} {r['height_src']:8s} {r['error_pct']:+6.1f}%  {r['how']:7s} [{r['model_name'][:26]}] fl {r['model_floors']}")
        else:
            print(r["match"])


if __name__ == "__main__":
    main()
