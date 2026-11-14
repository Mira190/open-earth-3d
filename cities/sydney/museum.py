"""The Museum of Contemporary Art's missing volumes, added to Sydney's built data (issue 426).

    python cities/sydney/museum.py        # then: python pipeline/pack.py

OpenStreetMap maps the museum (way 16599528) as an outline and four building:part ways, and the parts cover
only the old Maritime Services Board building's main block and tower. The pipeline draws a building's parts
where it has them, so the outline's remainder was missing from the city: the two end pavilions of the harbour
front, the Mordant Wing (2012) north of it, and the lower range along George Street. The hero level
(cities/sydney/hero.py) drew the pavilions and the wing as shells over nothing, with no collision, no shadow
from far off and nothing in the visibility raster.

This adds them as solids of the same building, cut from the outline (cities/sydney/hero_osm.json) in the
front's own frame (u along the harbour face from its south corner, o out towards the water, as hero.py's):

  * each pavilion, 9.3 m forward and 14 m wide, 21.2 m over the forecourt (hero.py's, from photographs);
  * the Mordant Wing as the hero level builds it: the link to the old building, the block behind the entrance
    hall, the storeys over the hall (from 7.4 m up), the white wall's block north of it and the dark storeys
    set back on that; the way through under the dark box stays open;
  * the entrance hall itself is left open under them: the level draws it as a room behind glass. What stops a
    walker at the glass is a wall that is not drawn, among the city's landmark meshes (hall_walls, which
    city.py's landmark_meshes lays: a material of no opacity that is never a floor);
  * the George Street range, five storeys by estimate (not seen from the quay).

Every face the level draws again stands 0.3 m behind the level's, so the two never share a plane. Writes
web/data/sydney/buildings.json in place; run again, it changes nothing. build_scene.py reaches
the same volumes through city.py's adjust_building (museum_parts), so a rebuilt scene keeps them.
"""
import json
import os

import numpy as np
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "web", "data", "sydney")

OSM = "w16599528"
OUTLINE, PARTS = 16599528, (570569172, 570569174, 570569175, 570569177)
A0, B0 = (-225.79, 173.13), (-219.54, 248.95)    # the wings' harbour face, south to north (hero.py's frame)
FLOOR = 4.0                                      # the museum's ground floor (m AHD), which the heights below are over
IN = 0.3                                         # how far behind the hero level's faces these stand
HALL_TOP = 7.4

_t = np.subtract(B0, A0) / np.linalg.norm(np.subtract(B0, A0))
_n = np.array([_t[1], -_t[0]])


def frame(u0, u1, o0, o1):
    """A rectangle of the front's frame, in local metres."""
    P = lambda u, o: tuple(np.asarray(A0) + _t * u + _n * o)
    return Polygon([P(u0, o0), P(u1, o0), P(u1, o1), P(u0, o1)])


def volumes():
    """[(name, polygon, min_m, top_m over FLOOR, drawn)]: the outline's remainder, cut as the level builds it."""
    osm = json.load(open(os.path.join(HERE, "hero_osm.json")))
    ways = {w["id"]: Polygon(w["xy"]) for w in osm["ways"] if w.get("id") in (OUTLINE,) + PARTS}
    rest = ways[OUTLINE].difference(unary_union([ways[i] for i in PARTS]).buffer(0.05))
    big = lambda g: max(getattr(g, "geoms", [g]), key=lambda q: q.area)
    out = []
    for name, (ua, ub) in (("south pavilion", (1.5, 15.6)), ("north pavilion", (62.0, 76.0))):
        out.append((name, frame(ua + 0.6, ub - 0.6, 0.0, 9.3 - 0.6), 0.0, 21.2, True))      # (0.6: behind the recesses of its bays)
    # the Mordant Wing, as hero.py stacks it on the outline (its MORDANT: entrance block u 81.6-95.0, face at 20.8;
    # north block to 112.7, face at 14.9; the glass at 17.4 under a 7.2 m head; the hall's back wall at 9.5)
    north = rest.intersection(frame(76.2, 140.0, -60.0, 40.0))
    out.append(("Mordant Wing, the link to the old building", big(north.intersection(frame(76.2, 81.6, -60.0, 6.2))), 0.0, 14.0, True))
    out.append(("Mordant Wing, behind the hall", big(north.intersection(frame(81.6, 95.0, -60.0, 9.3))), 0.0, 25.2, True))
    out.append(("Mordant Wing, over the hall", frame(84.8, 94.7, 9.3, 19.0), HALL_TOP, 19.6, True))
    out.append(("Mordant Wing, north", big(north.intersection(frame(95.0, 112.7 - IN, -60.0, 14.9 - IN))), 0.0, 16.8, True))
    out.append(("Mordant Wing, north, upper", big(north.intersection(frame(96.5 + IN, 112.7 - IN, -60.0, 12.9 - IN))), 16.8, 22.4, True))
    west = big(rest.intersection(frame(-10.0, 76.2, -60.0, -5.0)))
    out.append(("George Street range", west, 0.0, 16.5, True))
    return [(n, orient(p.simplify(0.15), 1.0), a, b, d) for n, p, a, b, d in out]


def hall_walls():
    """[(a, b, thickness, height)]: the entrance hall's glass and its south side, as walls a walker stops at
    (local metres, from FLOOR - 1): hero.py's glass line at 17.4 m out, its head at 7.2 m."""
    P = lambda u, o: tuple(np.asarray(A0) + _t * u + _n * o)
    return [(P(81.6, 17.3), P(95.0, 17.3), 0.24, 8.2), (P(81.7, 9.3), P(81.7, 17.3), 0.24, 8.2)]


def museum_parts(ground):
    """For city.py adjust_building: [[polygon, min_m, top_m, source, name, drawn]] over the ground at each."""
    out = []
    for name, p, a, b, drawn in volumes():
        g0 = ground(p.centroid.x, p.centroid.y)
        out.append([p, max(0.0, FLOOR + a - g0) if a else 0.0, FLOOR + b - g0, "floors", None, drawn])
    return out


def main():
    bpath, spath = os.path.join(OUT, "buildings.json"), os.path.join(OUT, "scene.json")
    B = json.load(open(bpath))
    bi = next(i for i, b in enumerate(B["b"]) if (b[6] or "").split("@")[0] == OSM)
    mine = [s for s in B["s"] if s[0] == bi]
    have = unary_union([Polygon(np.reshape(s[4], (-1, 2)) / 10.0) for s in mine])
    base = min(s[1] for s in mine)       # (the building's foot, as its other solids have it: dm)
    scene = json.load(open(spath))
    hidden, added = set(scene.get("hidden_solids", [])), 0
    for name, p, a, b, drawn in volumes():
        if p.intersection(have).area > 0.5 * p.area and not a:
            continue                     # (already there)
        if a and any(s[2] == round(FLOOR * 10 + a * 10) - base and Polygon(np.reshape(s[4], (-1, 2)) / 10.0).intersection(p).area > 0.5 * p.area for s in mine):
            continue
        ring = [int(round(v * 10)) for xy in list(p.exterior.coords)[:-1] for v in xy]
        B["s"].append([bi, base, int(round(FLOOR * 10 + a * 10)) - base if a else 0, int(round(FLOOR * 10 + b * 10)) - base, ring])
        mine.append(B["s"][-1])
        if not drawn:
            hidden.add(len(B["s"]) - 1)
        added += 1
        print(f"  + {name}: {p.area:.0f} m2, {a:.1f}-{b:.1f} m over the floor{'' if drawn else ' (not drawn)'}")
    if added:
        json.dump(B, open(bpath, "w"), separators=(",", ":"))
        scene["hidden_solids"] = sorted(hidden)
        json.dump(scene, open(spath, "w"), separators=(",", ":"))
    print(f"{bpath}: {added} solids added to the museum ({len(mine)} now)")


if __name__ == "__main__":
    main()
