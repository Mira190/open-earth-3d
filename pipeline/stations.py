"""Japan's stations as they are built, and a building that stands wholly off the ground stood on piers.

    python pipeline/stations.py --city shibuya        # then: python pipeline/pack.py

Two things a buildings.json written before typology.facade_style() learned them still has wrong:

- a station (class train_station) took the heritage style, brick with arched windows a storey and a half
  tall, as a European terminus would. A station in Japan is concrete, metal panel and glass unless its
  record says brick or stone: it takes the office style, a pale panel colour, and storeys counted again.
- a building none of whose solids touches the ground (Shibuya station's concourses over the streets
  east of the tracks: its min_height is 3.9 to 6.6 m) was drawn as walls hanging in the air with nothing
  under them. Each such solid gets piers (buildings.json "piers", by solid: [x_dm, y_dm, ...]) on a grid
  under it, kept off the carriageways and the footways mapped beneath it (game.json paths), and not under
  a lower solid of the same building. web/buildings-geo.js draws the piers and the solid's underside;
  web/game/nav.js makes them solid.

Rewrites web/data/<city>/buildings.json in place; running it again changes nothing.
"""
import argparse
import json
import os
from collections import defaultdict

from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

import typology
from restorey import wall_height

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL = ["#cfd2d2", "#c3c8cb", "#d8d8d3", "#b9bec2"]  # metal panel and fair-faced concrete
GRID, INSET, PIER = 9.0, 1.0, 0.9                      # the piers' spacing, how far they stand in from the edge, a pier's side (m)
HALF = {"motorway": 8.0, "trunk": 8.0, "primary": 7.0, "secondary": 6.0, "tertiary": 4.5}  # a carriageway's half-width where its lanes are not given


def restyle(B, japan):
    if not japan or "office" not in B["styles"] or "heritage" not in B["styles"]:
        return 0
    office, heritage = B["styles"].index("office"), B["styles"].index("heritage")
    by_b = defaultdict(list)
    for k, s in enumerate(B["s"]):
        by_b[s[0]].append(k)
    eaves = {r[0]: r[2] for r in B.get("r", [])}
    fronted = {B["s"][r[0]][0] for r in B.get("f", [])}
    n = 0
    for bi, m in enumerate(B["b"]):
        if m[1] != "train_station" or m[10] != heritage or not by_b.get(bi):
            continue
        m[10] = office
        m[7] = typology.jitter(PANEL[m[14] % len(PANEL)], m[14])
        m[11], m[12] = typology.storeys("office", wall_height(B, by_b[bi], eaves), m[3], bi in fronted)
        n += 1
    return n


def piers(B, game):
    by_b = defaultdict(list)
    for k, s in enumerate(B["s"]):
        by_b[s[0]].append(k)
    ways = []
    for r in game.get("paths", {}).get("road", []):
        p = r["p"]
        half = r["nl"] * 1.75 + 0.8 if r.get("nl") else HALF.get(r["c"], 3.5)
        ways.append(LineString([(p[i] / 10, p[i + 1] / 10) for i in range(0, len(p), 3)]).buffer(half + PIER))
    for r in game.get("paths", {}).get("foot", []):
        p = r["p"]
        ways.append(LineString([(p[i] / 10, p[i + 1] / 10) for i in range(0, len(p), 3)]).buffer(1.2 + PIER))
    out = {}
    for bi, ks in by_b.items():
        if B["b"][bi][1] == "roof" or any(B["s"][k][2] <= 0 for k in ks):
            continue  # (a canopy has its posts already: pipeline/arcades.py; a building with a foot on the ground stands on it)
        polys = {k: Polygon([(B["s"][k][4][i] / 10, B["s"][k][4][i + 1] / 10) for i in range(0, len(B["s"][k][4]), 2)]).buffer(0) for k in ks}
        hull = unary_union(list(polys.values()))
        clear = unary_union([w for w in ways if w.intersects(hull)]) if ways else None
        for k in ks:
            lower = [polys[j] for j in ks if j != k and (B["s"][j][2] < B["s"][k][2] or (B["s"][j][2] == B["s"][k][2] and j < k))]
            area = polys[k].buffer(-INSET)
            if lower:
                area = area.difference(unary_union(lower).buffer(INSET))
            if clear is not None:
                area = area.difference(clear)
            if area.is_empty:
                continue
            x0, y0, x1, y1 = polys[k].bounds
            nx, ny = max(1, round((x1 - x0 - 2 * INSET) / GRID)), max(1, round((y1 - y0 - 2 * INSET) / GRID))
            pts = []
            for i in range(nx + 1):
                for j in range(ny + 1):
                    x, y = x0 + INSET + (x1 - x0 - 2 * INSET) * i / nx, y0 + INSET + (y1 - y0 - 2 * INSET) * j / ny
                    if area.contains(Point(x, y)):
                        pts += [round(x * 10), round(y * 10)]
            if not pts:  # (too small or too crooked for the grid: one pier where there is most room)
                c = area.representative_point()
                pts = [round(c.x * 10), round(c.y * 10)]
            out[str(k)] = pts
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--city", required=True)
    a = ap.parse_args()
    d = os.path.join(ROOT, "web", "data", a.city)
    path = os.path.join(d, "buildings.json")
    B = json.load(open(path, encoding="utf8"))
    cfg = json.load(open(os.path.join(ROOT, "cities", a.city, "city.json"), encoding="utf8"))
    game = json.load(open(os.path.join(d, "game.json"), encoding="utf8")) if os.path.exists(os.path.join(d, "game.json")) else {}
    n = restyle(B, typology.region_name(cfg) == "japan")
    P = piers(B, game)
    changed = n or P != B.get("piers", {})
    if P:
        B["piers"] = P
    else:
        B.pop("piers", None)
    if changed:
        with open(path, "w") as f:
            json.dump(B, f, separators=(",", ":"))
    print(f"{a.city}: {n} stations restyled, {sum(len(v) // 2 for v in P.values())} piers under {len(P)} solids{'' if changed else ' (nothing changed)'}")


if __name__ == "__main__":
    main()
