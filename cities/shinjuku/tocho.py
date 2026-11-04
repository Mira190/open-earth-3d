"""The Tokyo Metropolitan Government Building No. 1 (東京都庁第一本庁舎; Kenzo Tange, 1991): 48 storeys,
243 m, splitting into two towers above the 33rd floor, each of which steps in twice, the top stage turned
45 degrees (the observatories on the 45th floor, 202 m, Tokyo Metropolitan Government).

PLATEAU draws it as its six OpenStreetMap parts all at the top's 243 m, so the towers stood as two
flat-topped slabs the full width of their bases, with no body between them. OpenStreetMap gives each
part its own height (cities/shinjuku/tocho_osm.json, pipeline/osm_parts.py): the outline 133 m (the body
under the split), the towers' notched bases 176 m, their second stages 207 m and the turned tops 243 m.
retop() (pipeline/retop.py) re-heights the solids to them; meshes() draws the building on its outline and
parts, which it hides: the granite grid of the facades (a curtain wall of narrow windows between broad
granite piers and spandrels, its storey and bay from photographs), the observatories' glass band, the
copings, and the masts on the roofs.
"""
import json
import math
import os

import numpy as np
from shapely.geometry import Polygon

import archkit as ak

OSM = "w89877471"
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tocho_osm.json")
OBSERVATORY_M = 202.0  # the 45th floor's observatories
MATERIALS = {
    # the granite grid: pale grey granite piers and spandrels, the windows dark blue-grey glass, lit after dark
    "tocho_granite": {"color": "#46525e", "roughness": 0.4, "metalness": 0.35, "pattern": "curtain_wall", "bay_m": 1.6, "storey_m": 4.0,
                      "spandrel": 0.5, "mullion_m": 0.62, "frame": "#cdcfcf", "lit_share": 0.35, "lit_k": 0.9},
    "tocho_stone": {"color": "#cfcec8", "roughness": 0.7, "metalness": 0.0},
    "tocho_glass": {"color": "#3a4652", "roughness": 0.12, "metalness": 0.6, "emissive": "#ffe2bd", "glow": 0.9},
    "tocho_roof": {"color": "#a9aaa6", "roughness": 0.85, "metalness": 0.0},
    "tocho_mast": {"color": "#c9ccce", "roughness": 0.4, "metalness": 0.7},
}
_D = {}


def data():
    if not _D:
        d = json.load(open(DATA))
        _D["outline"] = Polygon(d["outline_ring"]).buffer(0)
        _D["body_m"] = float(d["outline_height"])
        _D["parts"] = [(Polygon(q["ring"]).buffer(0), q["height_m"]) for q in d["parts"]]
    return _D


def part_height(poly):
    """The OpenStreetMap part a solid stands on (the best overlap, at least 80% of both): its height, or None."""
    best, got = 0.8, None
    for q, h in data()["parts"]:
        if q.intersects(poly):
            iou = q.intersection(poly).area / max(q.union(poly).area, 1e-6)
            if iou > best:
                best, got = iou, h
    return got


def retop(sd):
    if sd["osm"] != OSM:
        return None
    h = part_height(Polygon(sd["ring"], sd["holes"]).buffer(0))
    return (0.0, h) if h else None


def building(b, geoms, ctx):
    """build_scene.py (adjust_building): each part at its own height, and the body under the split
    (the outline at its 133 m, which the parts replaced)."""
    if (b.get("record_id") or "").split("@")[0] != OSM or not geoms:
        return geoms
    out = []
    for q in geoms:
        h = part_height(q[0])
        out.append([q[0], q[1], h, "mapped", q[4]] if h else q)
    return out + [[p, 0.0, data()["body_m"], "mapped", None] for p in ctx.polygons(data()["outline"])]


def _ring(poly):
    pts = ak.simplify(list(poly.exterior.coords), 0.25)
    return pts if ak.ring_area(pts) > 0 else pts[::-1]


def meshes(city_id):
    """The building on its outline and parts, and the solids it hides."""
    solids = [s for s in ak.load_solids(city_id) if s["osm"] == OSM]
    if not solids:
        return [], []
    d = data()
    g0 = min(s["ground"] for s in solids)
    K = ak.Kit("tmg", floodlit={"tocho_glass"}, uv={"tocho_granite"})
    grid, stone, glass, roof, mast = (K[m] for m in ("tocho_granite", "tocho_stone", "tocho_glass", "tocho_roof", "tocho_mast"))

    def stage(ring, z0, z1, cap=True):
        s = 0.0
        for a, b in zip(ring, ring[1:] + ring[:1]):
            s += ak.wall(grid, ak.WORLD, a[0], a[1], b[0], b[1], z0, z1, s)
            ak.edge_band(stone, a, b, z1 - 1.2, 0.35, 1.2)  # the coping
        if cap:
            ak.cap(roof, ak.WORLD, ring, z1)

    # the body under the split, from below the plaza to 133 m
    body = _ring(d["outline"])
    stage(body, g0 - 1.0, g0 + d["body_m"])
    for a, b in zip(body, body[1:] + body[:1]):  # the entrance storeys: a band of glass behind the piers
        ak.edge_band(glass, a, b, g0 + 0.5, -0.4, 7.5)
    # each tower: its notched base to 176 m, the second stage to 207 m, the turned top to 243 m
    towers = {}
    for q, h in d["parts"]:
        c = q.centroid
        towers.setdefault(round(c.y / 20), []).append((h, q))
    for parts in towers.values():
        parts.sort(key=lambda t: t[0])
        z = g0 + d["body_m"]
        for h, q in parts:
            ring = _ring(q)
            stage(ring, z - 0.05, g0 + h)
            if z - g0 < OBSERVATORY_M < h:  # the observatory's glass, round the stage
                for a, b in zip(ring, ring[1:] + ring[:1]):
                    ak.edge_band(glass, a, b, g0 + OBSERVATORY_M - 1.5, 0.05, 3.0)
            z = g0 + h
        # masts on the turned top
        top = parts[-1][1]
        c = top.centroid
        for k, (dx, dy, hm) in enumerate(((0, 0, 14.0), (5.5, 3.0, 8.0), (-5.0, -3.5, 9.5), (3.0, -6.0, 6.0))):
            x, y = c.x + dx, c.y + dy
            mast.box((x, y, z), (x, y, z + hm), 0.35, 0.35, up=(1, 0, 0))
            if k == 0:
                for zz in np.arange(z + 4.0, z + hm, 3.0):
                    mast.box((x - 1.2, y, zz), (x + 1.2, y, zz), 0.12, 0.12)
    return K.out(), sorted(s["si"] for s in solids)
