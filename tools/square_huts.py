"""List the low solids that stand in a city's pedestrian squares (Overture land_use, subtype pedestrian): the
PLATEAU solids that read as huts where a square's bench, planter or vent was measured as a building
(issue 211). Prints each with its source, size and the square it stands in; hidden solids are left out.

    python tools/square_huts.py --city shinjuku [--max-m 4.5]
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import json

import shapely

import archkit as ak
import japankit as jk
from cityctx import city_args


def candidates(C, max_m=4.5):
    sq = [(r["name"] or r["class"], r["geom"]) for r in jk.overture(C, "land_use", "subtype = 'pedestrian'")
          if r["geom"].geom_type in ("Polygon", "MultiPolygon")]
    tree = shapely.STRtree([g for _, g in sq])
    B = json.load(open(os.path.join(C.out, "buildings.json"), encoding="utf8"))
    S = json.load(open(os.path.join(C.out, "scene.json"), encoding="utf8"))
    hidden = set(S.get("hidden_solids", []))
    lp = os.path.join(C.out, "landmarks.json")
    if os.path.exists(lp):
        hidden |= set(json.load(open(lp, encoding="utf8")).get("hidden", []))
    out = []
    for sd in ak.load_solids(C.id):
        if sd["si"] in hidden or sd["top"] - sd["base"] > max_m or sd["base"] > 0.5:
            continue
        g = shapely.Polygon(sd["ring"])
        hit = [sq[k][0] for k in tree.query(g.centroid) if sq[k][1].contains(g.centroid)]
        if not hit:
            continue
        b = B["b"][B["s"][sd["si"]][0]]
        out.append({"si": sd["si"], "osm": sd["osm"], "name": sd["name"], "class": b[1], "src": b[4], "fp": b[5], "top": sd["top"],
                    "m2": round(g.area, 1), "at": [round(g.centroid.x, 1), round(g.centroid.y, 1)], "square": hit[0]})
    return out


def main():
    C, a = city_args(__doc__.splitlines()[0], lambda ap: ap.add_argument("--max-m", type=float, default=4.5))
    for r in candidates(C, a.max_m):
        print(f"{r['si']:6d} {r['osm'] or '-':14s} {r['src']:9s} {r['fp']} {r['top']:4.1f} m {r['m2']:7.1f} m2 at {r['at']}  "
              f"{r['class'] or ''} {r['name'] or ''} | {r['square']}")


if __name__ == "__main__":
    main()
