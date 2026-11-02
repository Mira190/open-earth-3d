"""Precinct walls drawn as walls, not as long thin office blocks.

    python pipeline/walls.py --city kyoto        # after game_data.py (it runs this too); or --city all

An earthen precinct wall (a tsuiji-bei, 築地塀) round a palace or a temple comes in the open data
as a building: OpenStreetMap maps the walls round the Kyoto Gosho and the Sento Gosho as
building=yes, about 3 m wide and several hundred metres long, and the height model gives them an
estimate from the houses nearby (8.7 m). Drawn like any other building, they were a three-storey
facade with rows of windows running round the gardens.

A solid is taken for a wall when its building is one solid standing on the ground, unnamed and of
no use class ("", "yes", "wall"), its footprint is thin (twice its area over its perimeter, its
mean width, at most 3.5 m) and long (half its perimeter at least 80 m), and no mapped footway runs
inside it along more than 30% of its length (that would be an arcade: pipeline/arcades.py). Then:

- a height that was only estimated becomes a wall's (walls.height_m, 4 m); a measured one stands
  when it is at most 6 m and the wall at least 1.5 m thick (taller or thinner measured solids are
  platform canopies and noise barriers, left as they are);
- it is drawn in the "wall" style (web/buildings.js): no windows or storeys, a stone plinth, and
  the white lines of a suji-bei (筋塀) where walls.lines names them (meta field ground_floor_m
  holds the number of lines, storey_m the height of the wall under its coping);
- with walls.coping "kawara" (and a wall at least 1.2 m thick) it gets a hipped coping of glazed
  tiles over a 0.35 m overhang; otherwise a flat top.

City settings, all optional (cities/<id>/city.json "walls"):
    {"height_m": 4.0, "coping": "kawara", "colour": "#d9c79c",
     "lines": [{"name": "...", "box": [x0, y0, x1, y1], "n": 5}]}   # local metres, by centroid

Rewrites web/data/<city>/buildings.json in place; running it again changes nothing.
"""
import argparse
import json
import os

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon

import roofs
from build_scene import pack_roof

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDTH_M, LONG_M, ALONG = 3.5, 80.0, 0.3
MEASURED_MAX_M, MEASURED_MIN_W = 6.0, 1.5
GENERIC = {"", "yes", "wall"}
ESTIMATED = {"estimate", "default", "ml"}
COPING_PITCH, COPING_OVERHANG, COPING_MIN_W = 28.0, 0.35, 1.2


def config(cid):
    path = os.path.join(ROOT, "cities", cid, "city.json")
    if not os.path.exists(path):
        return {}
    return json.load(open(path, encoding="utf8")).get("walls", {})


def polygon(s):
    rings = [[(r[k] / 10, r[k + 1] / 10) for k in range(0, len(r), 2)] for r in s[4:]]
    P = Polygon(rings[0], [h for h in rings[1:] if len(h) >= 3])
    return P if P.is_valid else P.buffer(0)


def coping(P, eave_m):
    """a hipped coping of tiles over the wall's outline: (roof mesh, built shape, height) or None"""
    if P.geom_type != "Polygon":
        return None
    ext = shapely.geometry.polygon.orient(P, 1.0)
    for tol in (0.0, 0.3, 0.6):
        Q = ext.simplify(tol) if tol else ext
        if Q.geom_type != "Polygon" or Q.is_empty:
            continue
        Q = shapely.geometry.polygon.orient(Q, 1.0)
        rings = [np.asarray(Q.exterior.coords)[:-1]] + [np.asarray(h.coords)[:-1] for h in Q.interiors if len(h.coords) > 3]
        m, built, rh = roofs.roof_mesh(rings, "hipped", pitch=COPING_PITCH, cap=1.2,
                                       overhang=COPING_OVERHANG if len(rings) == 1 else 0.0)
        if m is not None and built == "hipped" and rh >= 0.3 and roofs.check(m, rings, rh, built):
            return m, rh
    return None


def mark(out_dir, cid=None):
    bpath, gpath = os.path.join(out_dir, "buildings.json"), os.path.join(out_dir, "game.json")
    if not os.path.exists(bpath):
        return 0
    cid = cid or os.path.basename(os.path.normpath(out_dir))
    W = config(cid)
    B = json.load(open(bpath, encoding="utf8"))
    G = json.load(open(gpath, encoding="utf8")) if os.path.exists(gpath) else {}
    foot = []
    for o in G.get("paths", {}).get("foot", []):
        p = o["p"]
        if len(p) >= 6:
            foot.append(LineString([(p[i] / 10, p[i + 1] / 10) for i in range(0, len(p), 3)]))
    tree = shapely.STRtree(foot) if foot else None
    styles = B.setdefault("styles", [])
    if "wall" not in styles:
        styles.append("wall")
    wall_i = styles.index("wall")
    mats, shapes, srcs = B.get("roof_materials", []), B.get("roof_shapes", []), B.get("roof_sources", [])
    count = {}
    for s in B["s"]:
        count[s[0]] = count.get(s[0], 0) + 1
    roof_at = {r[0]: i for i, r in enumerate(B.get("r", []))}
    drop_roof, drop_solid, new_roofs, n = set(), set(), [], 0
    for k, s in enumerate(B["s"]):
        bi = s[0]
        meta = B["b"][bi]
        if len(meta) < 17 or meta[10] == wall_i:
            continue  # already a wall (a second run), or a file without styles
        if count[bi] != 1 or s[2] != 0 or (meta[0] or "").strip() or (meta[1] or "") not in GENERIC:
            continue
        try:
            P = polygon(s)
        except ValueError:
            continue
        if P.is_empty or P.length < 2 * LONG_M:
            continue
        width, height = 2 * P.area / P.length, (s[3] - s[2]) / 10
        if width > WIDTH_M:
            continue
        estimated = meta[4] in ESTIMATED
        if not estimated and (height > MEASURED_MAX_M or width < MEASURED_MIN_W):
            continue
        if tree is not None and sum(foot[i].intersection(P).length for i in tree.query(P)) > ALONG * P.length / 2:
            continue
        top = float(W.get("height_m", 4.0)) if estimated else height
        cop = coping(P, top) if W.get("coping") == "kawara" and width >= COPING_MIN_W and "kawara" in mats else None
        eave = top - cop[1] if cop else top
        cx, cy = P.centroid.x, P.centroid.y
        lines = 0
        for rule in W.get("lines", []):
            x0, y0, x1, y1 = rule["box"]
            if x0 <= cx <= x1 and y0 <= cy <= y1:
                lines = int(rule.get("n", 5))
        s[3] = round(top * 10)
        meta[2] = round(top, 1)
        meta[3] = 0
        if W.get("colour"):
            meta[7] = W["colour"]
        meta[10], meta[11], meta[12] = wall_i, round(eave, 2), lines
        if k in roof_at:
            drop_roof.add(roof_at[k])
        drop_solid.add(k)
        if cop:
            m = cop[0]
            v = np.asarray(m.v)
            q = np.c_[np.round(v[:, :2] * 10), np.round((eave + v[:, 2]) * 10)].astype(int)
            uniq, remap = {}, []
            for p_ in q.tolist():
                remap.append(uniq.setdefault(tuple(p_), len(uniq)))
            pos = [c for p_ in uniq for c in p_]
            idx = [remap[i] for t in m.roof + m.wall for i in t]
            new_roofs.append([k, s[3], round(eave * 10), roofs.CODES["hipped"]] + pack_roof(pos, idx) + [len(m.roof)])
            meta[8] = W.get("coping_colour", "#46494c")
            meta[13] = mats.index("kawara")
            meta[15] = shapes.index("hipped") if "hipped" in shapes else meta[15]
        else:
            meta[15] = shapes.index("flat") if "flat" in shapes else meta[15]
        if "rule" in srcs:
            meta[16] = srcs.index("rule")
        n += 1
    if n:
        B["r"] = [r for i, r in enumerate(B.get("r", [])) if i not in drop_roof] + new_roofs
        for key in ("f", "p"):  # no shopfronts or rooftop plant on a wall
            if key in B:
                B[key] = [row for row in B[key] if row[0] not in drop_solid]
        with open(bpath, "w") as f:
            json.dump(B, f, separators=(",", ":"))
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--city", required=True, help="a city id, or all")
    a = ap.parse_args()
    data = os.path.join(ROOT, "web", "data")
    ids = sorted(d for d in os.listdir(data) if os.path.exists(os.path.join(data, d, "buildings.json"))) if a.city == "all" else [a.city]
    for cid in ids:
        print(f"{cid}: {mark(os.path.join(data, cid), cid)} precinct walls drawn as walls")


if __name__ == "__main__":
    main()
