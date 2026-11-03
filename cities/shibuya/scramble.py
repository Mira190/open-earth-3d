"""Shibuya's scramble at street level (#111): the street and the things on it, at their measured sizes.

cities/shibuya/city.py builds the crossing's landmarks; this module adds what a walker sees round the
scramble, from OpenStreetMap's hand-mapped detail (cities/shibuya/scramble_osm.json,
pipeline/osm_detail.py), GSI's aerial photo (zoom 18, tools/aerial_local.py) and photographs:

  * the crosswalks at their real widths and positions, read off the aerial photo (OSM's lines are
    the walkers' paths, not the paint), with 45 cm bars and 45 cm gaps; the stop lines in front of
    them; the junction's asphalt laid over the game's street texture, so no lane line runs through
    the scramble;
  * the underground's entrances (A5a ... A7b, 8): stairs going down under a flat roof on steel and
    glass, each with its exit's sign, where OSM maps the entrance and its little building;

Everything is built in the city's local frame (x east, y north, z up, metres). Sizes that are not
published are estimates from photographs and are marked so.
"""
import json
import math
import os

import numpy as np
from shapely.geometry import LineString, Point, Polygon

import adkit as ad
import archkit as ak
from japankit import Atlas

HERE = os.path.dirname(os.path.abspath(__file__))
ATLAS_FILE = "scramble.jpg"

MATERIALS = {
    # the junction's asphalt, laid over the ground (dark, a little worn; the game's street texture under it)
    "x_asphalt": {"color": "#4b4e52", "roughness": 0.93, "metalness": 0.0, "pattern": "granite", "joints_m": [0, 0], "decal": True, "street_lit": True},
    # road paint: thermoplastic, a little glass bead in it (paler and rougher than a sign)
    "x_paint": {"color": "#e4e2da", "roughness": 0.62, "metalness": 0.0, "decal": True, "street_lit": True},
    # the entrances: aluminium panels, the steel frame, the glass, the stairs' granite and the well's tiles
    "x_panel": {"color": "#c4c7ca", "roughness": 0.42, "metalness": 0.55},
    "x_frame": {"color": "#55595e", "roughness": 0.45, "metalness": 0.6},
    "x_glass": {"color": "#a9c3cc", "roughness": 0.04, "metalness": 0.2, "opacity": 0.3},
    "x_tread": {"color": "#8e8a84", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [0.6, 0.0], "stair": "tread"},
    "x_riser": {"color": "#7d7a75", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [0.6, 0.0], "stair": "riser"},
    "x_tile": {"color": "#d9d6cf", "roughness": 0.5, "metalness": 0.0, "pattern": "granite", "joints_m": [0.3, 0.15]},
    "x_dark": {"color": "#1d1e20", "roughness": 0.9, "metalness": 0.0},
    "x_tactile": {"color": "#e8b711", "roughness": 0.7, "metalness": 0.0},
    "x_rail": {"color": "#b7bcc0", "roughness": 0.3, "metalness": 0.8},
    "x_light": {"color": "#f3f1ea", "roughness": 0.5, "metalness": 0.0, "emissive": "#fff4e0", "glow": 2.4},
    # the drawn signs (this module's own atlas, scramble.jpg), lit after dark
    # the JR lines' bed: retaining walls of concrete, the girder bridge's steel (painted grey), ballast, rails
    "x_jr_wall": {"color": "#a7a39a", "roughness": 0.9, "metalness": 0.0, "pattern": "granite", "joints_m": [5.0, 0.0]},
    "x_jr_concrete": {"color": "#bab6ad", "roughness": 0.9, "metalness": 0.0},
    "x_jr_steel": {"color": "#8e959a", "roughness": 0.55, "metalness": 0.45},
    "x_ballast": {"color": "#6f6a63", "roughness": 1.0, "metalness": 0.0, "pattern": "granite", "joints_m": [0, 0]},
    "x_sleeper": {"color": "#9a968e", "roughness": 0.9, "metalness": 0.0},
    "x_rail_steel": {"color": "#8a8580", "roughness": 0.35, "metalness": 0.85},
    "x_wire": {"color": "#26292c", "roughness": 0.6, "metalness": 0.4},
    # QFRONT: its silver fins and panels, the shopfronts lit from inside, the crown's roof
    "x_fin": {"color": "#a9afb5", "roughness": 0.35, "metalness": 0.7},
    "x_qf_glass": {"color": "#40505b", "roughness": 0.05, "metalness": 0.3, "opacity": 0.22},
    "x_qf_panel": {"color": "#cfd2d5", "roughness": 0.45, "metalness": 0.5},
    "x_qf_roof": {"color": "#6d7176", "roughness": 0.8, "metalness": 0.2},
    "x_shop": {"color": "#59616a", "roughness": 0.12, "metalness": 0.3, "pattern": "curtain_wall", "bay_m": 2.4, "storey_m": 4.8, "spandrel": 0.04,
               "mullion_m": 0.08, "frame": "#30343a", "lit_share": 1.0, "lit_k": 1.1, "warm_share": 0.8},
    # QFRONT's floors behind the outer skin (as city.py's qfront_glass)
    "qfront_glass": {"color": "#2b3741", "roughness": 0.12, "metalness": 0.35, "pattern": "curtain_wall", "bay_m": 1.8, "storey_m": 4.6,
                     "spandrel": 0.1, "mullion_m": 0.09, "frame": "#a9b3bb", "lit_share": 0.55, "lit_k": 0.6},
    "x_atlas": {"color": "#ffffff", "roughness": 0.6, "metalness": 0.0, "map": ATLAS_FILE, "emissive_map": True, "glow": 1.3},
}
LIT = {"x_light", "x_atlas"}


# ---------------------------------------------------------------- data

class Data:
    """OSM's detail round the scramble in the local frame, and the built city's solids."""

    def __init__(self, city_id):
        import cityctx
        self.C = cityctx.City(city_id)
        self.T = ak.Terrain(city_id)
        self.solids = ak.load_solids(city_id)
        raw = json.load(open(os.path.join(HERE, "scramble_osm.json"), encoding="utf8"))
        fwd = self.C.fwd.transform
        self.nodes = [dict(n, xy=np.array(fwd(*n["ll"]))) for n in raw["nodes"]]
        self.ways = [dict(w, xy=[np.array(fwd(*p)) for p in w["ll"]]) for w in raw["ways"]]
        self.by_id = {n["id"]: n for n in self.nodes}
        G = json.load(open(os.path.join(self.C.out, "game.json")))
        self.roads = [(r["c"], [(r["p"][k] / 10, r["p"][k + 1] / 10, r["p"][k + 2] / 10) for k in range(0, len(r["p"]), 3)]) for r in G["paths"]["road"]]

    def ground(self, x, y):
        return self.T(x, y)


def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) or 1.0)


def frame(o, f):
    """(u, v, z) -> local point: u along f from o, v to its left, z absolute."""
    o, f = np.asarray(o, float)[:2], unit(f)[:2]
    l = np.array([-f[1], f[0]])
    return lambda u, v, z: np.array([o[0] + f[0] * u + l[0] * v, o[1] + f[1] * u + l[1] * v, z])


def box(m, P, u0, u1, v0, v1, z0, z1, uvm=False):
    """A box in frame P, faces wound outward; with uvm, texture coordinates in metres along each face."""
    c = [P(u, v, z) for z in (z0, z1) for v in (v0, v1) for u in (u0, u1)]
    du, dv, dz = u1 - u0, v1 - v0, z1 - z0
    faces = ((0, 2, 3, 1, du, dv), (4, 5, 7, 6, du, dv), (0, 1, 5, 4, du, dz), (2, 6, 7, 3, dz, du), (0, 4, 6, 2, dz, dv), (1, 3, 7, 5, dv, dz))
    for a, b, cc, d, w, h in faces:
        m.quad(c[a], c[b], c[cc], c[d], [[0, 0], [w, 0], [w, h], [0, h]] if uvm else None)


def flat(m, pts, z, uvm=True):
    """A flat polygon (convex or star-shaped from its first vertex) at height z, facing up."""
    pts = [np.asarray(p, float) for p in pts]
    for k in range(1, len(pts) - 1):
        a, b, c = pts[0], pts[k], pts[k + 1]
        m.tri(np.array([*a, z]), np.array([*b, z]), np.array([*c, z]), [list(a), list(b), list(c)] if uvm else None)


# ---------------------------------------------------------------- the crosswalks

# Each crosswalk as the paint lies, measured on GSI's aerial photo (zoom 18) in the local frame: the
# walkers' line across the road (from, to) and the band's width across it. OSM's footway crossings
# run along their middles, but the scramble's are wider than the 4 m minimum: the diagonal and the
# two on the station side about 9 m, Dogenzaka's and Center Gai's 7 to 8 m. OSM's short crossing
# north of Center Gai's mouth is not painted. Bars 45 cm wide with 45 cm gaps (the national standard,
# 道路標示 横断歩道: 45 cm bars, gaps of 45 to 90 cm), parallel to the traffic, so you step over them.
CROSSWALKS = [
    {"id": "diagonal", "a": [358.4, -985.9], "b": [376.0, -1012.6], "width": 9.4},   # QFRONT and Tsutaya to Hachiko
    {"id": "north", "a": [366.9, -979.5], "b": [381.6, -982.5], "width": 9.2},       # QFRONT to MAGNET, across Bunkamura-dori's end
    {"id": "east", "a": [385.2, -1011.1], "b": [387.6, -994.8], "width": 9.0},       # MAGNET to Hachiko, across the road under the tracks
    {"id": "south", "a": [343.8, -1013.7], "b": [368.9, -1018.9], "width": 7.8},     # Hachiko to the Ekimae building, across Dogenzaka's foot
    {"id": "west", "a": [338.9, -987.1], "b": [335.5, -1004.5], "width": 7.2},       # Center Gai's corner to the Ekimae building
]
# Where traffic comes in and stops before a crosswalk (OSM's one-way tags): the half of the road the
# traffic coming in keeps to (Japan keeps left), or all of it on a one-way street
STOPS = {"west": "half", "north": "half", "east": "half", "south": "full"}   # Dogenzaka, Jingu-dori, under the tracks, Jingu-dori from the south
BAR, GAP = 0.45, 0.45
STOP_W, STOP_BACK = 0.45, 2.0   # the stop line: 45 cm wide (30 to 45 cm), about 2 m before the crosswalk (estimate)


def crosswalk_poly(c):
    a, b = np.asarray(c["a"], float), np.asarray(c["b"], float)
    f = unit(b - a)
    l = np.array([-f[1], f[0]]) * c["width"] / 2
    return [a - l, b - l, b + l, a + l]


ROADW = {"motorway": 14, "trunk": 12, "primary": 12, "secondary": 10, "tertiary": 9, "residential": 7, "unclassified": 6, "living_street": 5}  # as web/game/game.js


def junction_area(D):
    """The scramble's floor: the carriageways (the game's road bands) inside the hull of the crosswalks,
    which the asphalt covers over the game's street texture (so no lane line runs through it)."""
    from shapely.ops import unary_union
    pts = [p for c in CROSSWALKS for p in crosswalk_poly(c)]
    hull = Polygon(pts).convex_hull
    bands = [LineString([p[:2] for p in pts]).buffer(ROADW.get(c, 7) / 2 + 0.5, cap_style=2) for c, pts in D.roads
             if len(pts) > 1 and LineString([p[:2] for p in pts]).distance(hull) < 1 and min(p[2] - D.ground(p[0], p[1]) for p in pts) < 3]
    # the middle: the crosswalks' sides toward the junction, joined round it
    node = np.mean([np.asarray(c["a"]) + np.asarray(c["b"]) for c in CROSSWALKS], axis=0) / 2
    inner = []
    for c in CROSSWALKS:
        q = crosswalk_poly(c)
        side = (q[0] + q[1]) / 2, (q[2] + q[3]) / 2
        k = 0 if np.linalg.norm(side[0] - node) < np.linalg.norm(side[1] - node) else 1
        inner += [q[0], q[1]] if k == 0 else [q[2], q[3]]
    inner.sort(key=lambda p: math.atan2(p[1] - node[1], p[0] - node[0]))
    middle = Polygon(inner).convex_hull
    area = unary_union(bands + [middle] + [Polygon(crosswalk_poly(c)) for c in CROSSWALKS]).intersection(hull.buffer(0.3, join_style=2))
    # each crosswalk ends at a kerb: beyond its ends is the pavement, for 3 m at least
    kerbs = []
    for c in CROSSWALKS:
        a, b = np.asarray(c["a"], float), np.asarray(c["b"], float)
        f = unit(b - a)
        l = np.array([-f[1], f[0]]) * (c["width"] / 2 + 1.0)
        for e, d in ((a, -f), (b, f)):
            kerbs.append(Polygon([e - l + d * 0.02, e + l + d * 0.02, e + l + d * 3.0, e - l + d * 3.0]))
    area = area.difference(unary_union(kerbs))
    return max(getattr(area, "geoms", [area]), key=lambda g: g.area)   # (slivers left between kerbs dropped)


def ground_polygon(m, area, gz, z_off, cell=2.0):
    """A polygon laid on the ground: cut into a grid of cells, each triangulated, every vertex on the ground."""
    from shapely.geometry import box as sbox
    from shapely.ops import triangulate
    x0, y0, x1, y1 = area.bounds
    for gx in np.arange(x0, x1, cell):
        for gy in np.arange(y0, y1, cell):
            piece = area.intersection(sbox(gx, gy, gx + cell, gy + cell))
            if piece.is_empty:
                continue
            for poly in getattr(piece, "geoms", [piece]):
                if poly.geom_type != "Polygon" or poly.area < 1e-4:
                    continue
                for tri in triangulate(poly):
                    if not poly.buffer(1e-6).contains(tri.centroid):
                        continue
                    q = list(tri.exterior.coords)[:3]
                    a, b, c = (np.array([x, y, gz((x, y)) + z_off]) for x, y in q)
                    if np.cross(b - a, c - a)[2] < 0:
                        b, c = c, b
                    m.tri(a, b, c, [list(a[:2]), list(b[:2]), list(c[:2])])


def paint_strip(m, gz, a, b, w, z_off=0.045, n=None):
    """A painted strip from a to b, w wide, in pieces that follow the ground."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    f = unit(b - a)
    l = np.array([-f[1], f[0]]) * w / 2
    n = n or max(1, int(np.linalg.norm(b - a) // 2.5) + 1)
    for k in range(n):
        p, q = a + (b - a) * k / n, a + (b - a) * (k + 1) / n
        pts = [p - l, q - l, q + l, p + l]
        m.quad(*[np.array([*x, gz(x) + z_off]) for x in pts])


def crosswalks(K, D, node):
    paint, asphalt = K["x_paint"], K["x_asphalt"]
    gz = lambda p: D.ground(*p)
    ground_polygon(asphalt, junction_area(D), gz, 0.03)
    centre = np.mean([np.asarray(c["a"]) + np.asarray(c["b"]) for c in CROSSWALKS], axis=0) / 2
    for cw in CROSSWALKS:
        mode = STOPS.get(cw["id"])
        if not mode:
            continue
        a, b = np.asarray(cw["a"], float), np.asarray(cw["b"], float)
        f = unit(b - a)
        o = np.array([-f[1], f[0]])
        mid = (a + b) / 2
        if (mid - centre) @ o < 0:
            o = -o                                   # outward, away from the junction
        back = mid + o * (cw["width"] / 2 + STOP_BACK + STOP_W / 2)
        L = float(np.linalg.norm(b - a)) - 0.6
        drv_left = -np.array([-o[1], o[0]])          # the left of a driver coming in (heading -o)
        if mode == "full":
            p, q = back - f * L / 2, back + f * L / 2
        else:
            p, q = back + drv_left * 0.15, back + drv_left * L / 2
        paint_strip(paint, gz, p, q, STOP_W)
    # the bars: along the traffic (across the walk), one every 90 cm across the walk's length
    for cw in CROSSWALKS:
        a, b = np.asarray(cw["a"], float), np.asarray(cw["b"], float)
        f = unit(b - a)
        L = float(np.linalg.norm(b - a))
        l = np.array([-f[1], f[0]])
        hw = cw["width"] / 2
        n = int((L - 0.6) // (BAR + GAP))
        u0 = (L - (n * (BAR + GAP) - GAP)) / 2
        for k in range(n):
            u = u0 + k * (BAR + GAP)
            q = [a + f * u - l * hw, a + f * (u + BAR) - l * hw, a + f * (u + BAR) + l * hw, a + f * u + l * hw]
            seg = [q[0] + (q[3] - q[0]) * t for t in np.linspace(0, 1, 4)]
            seg2 = [q[1] + (q[2] - q[1]) * t for t in np.linspace(0, 1, 4)]
            for j in range(3):
                pts = [seg[j], seg2[j], seg2[j + 1], seg[j + 1]]
                paint.quad(*[np.array([*p, gz(p) + 0.045]) for p in pts])


# ---------------------------------------------------------------- the underground's entrances

def entrance_sites(D, near, radius=150.0):
    """The entrances OSM maps as a subway entrance on a little building: the building's solid, the
    direction the stairs go down (toward the underground footway from the entrance), the exit's ref."""
    from shapely.geometry import Polygon as Poly
    out = []
    for n in D.nodes:
        t = n["tags"]
        if t.get("railway") != "subway_entrance" or np.linalg.norm(n["xy"] - near) > radius:
            continue
        p = Point(*n["xy"])
        best = None
        for s in D.solids:
            if s["top"] > 5 or len(s["ring"]) < 4 or abs(s["ring"][0][0] - n["xy"][0]) > 30 or abs(s["ring"][0][1] - n["xy"][1]) > 30:
                continue
            g = Poly(s["ring"])
            if g.area < 150 and g.distance(p) < 0.5:
                best = s
        if not best:
            continue
        down, up = None, None
        for w in D.ways:
            if n["id"] not in w["nodes"] or w["tags"].get("building"):
                continue
            k = w["nodes"].index(n["id"])
            for j in (k - 1, k + 1):
                if 0 <= j < len(w["xy"]):
                    under = str(w["tags"].get("layer", "0")).startswith("-") or str(w["tags"].get("level", "0")).startswith("-")
                    if under:
                        down = w["xy"][j]
                    else:
                        up = w["xy"][j]
        cx, cy, ax, L, W = ak.oriented(best["ring"])
        f = np.array([math.cos(math.radians(ax)), math.sin(math.radians(ax))])
        c = np.array([cx, cy])
        # the stairs go down away from the open end: the end the street footway comes in at
        if up is not None and abs((up - c) @ f) > 0.3:
            sgn = 1.0 if (up - c) @ f > 0 else -1.0
        elif down is not None:
            sgn = -1.0 if (down - c) @ f > 0 else 1.0
        else:
            sgn = 1.0 if (n["xy"] - c) @ f >= 0 else -1.0
        out.append({"ref": t.get("ref") or "", "name": t.get("name") or "渋谷駅", "si": best["si"], "c": c, "f": f * sgn, "L": L, "W": W,
                    "g": min(D.ground(*q) for q in best["ring"]), "top": best["top"]})
    return out


def entrance(K, A, e):
    """A covered stair down to the underground: a flat roof on a steel frame, aluminium panels to waist
    height and glass above on three sides, the stair (30 cm treads, 16.5 cm risers) going down between
    tiled walls, a handrail each side, tactile paving at its head and a lit sign over the open end:
    the exit's code in yellow (as Tokyo's underground signs its exits) and the station's name. The
    roof's height is OSM's; the rest is from photographs (estimates)."""
    P = frame(e["c"], e["f"])
    hl, hw, g = e["L"] / 2, e["W"] / 2, e["g"]
    zr = g + min(max(e["top"], 3.0), 3.9) - 0.32      # the roof's underside
    panel, fr, gl = K["x_panel"], K["x_frame"], K["x_glass"]
    t = 0.07                                          # the walls' thickness
    # the roof: a slab with a deeper fascia over the open end, cantilevered 0.6 m past it
    box(panel, P, -hl - 0.12, hl + 0.6, -hw - 0.12, hw + 0.12, zr, zr + 0.32)
    box(fr, P, hl + 0.6, hl + 0.66, -hw - 0.12, hw + 0.12, zr - 0.38, zr + 0.4)    # the fascia's edge
    # posts at the corners and every 1.8 m along the sides
    n = max(2, int(round(2 * hl / 1.8)) + 1)
    for v in (-hw + t / 2, hw - t / 2):
        for u in np.linspace(-hl + 0.05, hl - 0.05, n):
            box(fr, P, u - 0.05, u + 0.05, v - 0.05, v + 0.05, g, zr)
        box(panel, P, -hl, hl, v - t / 2, v + t / 2, g, g + 1.05)                 # waist panels
        box(fr, P, -hl, hl, v - 0.04, v + 0.04, g + 1.05, g + 1.12)               # their capping
        box(gl, P, -hl, hl, v - 0.012, v + 0.012, g + 1.12, zr)                   # glass to the roof
    box(panel, P, -hl, -hl + t, -hw, hw, g, zr)                                   # the back wall
    # the stair: from the open end down toward the back, under the ground
    rise, tread = 0.165, 0.30
    w0, w1 = -hw + t + 0.02, hw - t - 0.02
    u = hl - 0.35
    z = g
    tr, ri, tile = K["x_tread"], K["x_riser"], K["x_tile"]
    box(tile, P, hl - 0.35, hl, w0, w1, g - 0.3, g + 0.012, uvm=True)            # the landing at the top
    k = 0
    while u - tread > -hl + 0.2 and k < 40:
        z1 = z - rise
        box(ri, P, u - 0.02, u, w0, w1, z1, z, uvm=True)
        tr.quad(P(u - tread, w0, z1), P(u, w0, z1), P(u, w1, z1), P(u - tread, w1, z1), [[0, 0], [0, 1], [w1 - w0, 1], [w1 - w0, 0]])
        u -= tread
        z = z1
        k += 1
    zb = z - 0.05
    # the well's walls, tiled, from the bottom of the stair to the ground, and the dark beyond it
    for v in (w0, w1):
        P2 = lambda uu, zz, v=v: P(uu, v, zz)
        tile.quad(P2(-hl, zb), P2(hl - 0.35, zb), P2(hl - 0.35, g), P2(-hl, g), [[0, zb], [2 * hl, zb], [2 * hl, g], [0, g]])
    K["x_dark"].quad(P(-hl + 0.2, w1, zb), P(-hl + 0.2, w0, zb), P(-hl + 0.2, w0, g + 0.02), P(-hl + 0.2, w1, g + 0.02))
    K["x_dark"].quad(P(-hl + 0.2, w0, zb), P(-hl + 0.2, w1, zb), P(u, w1, zb), P(u, w0, zb))
    # handrails, 85 cm over the nosings, each side
    for v in (w0 + 0.06, w1 - 0.06):
        K["x_rail"].tube([P(hl - 0.2, v, g + 0.85), P(hl - 0.35, v, g + 0.85), P(-hl + 0.4 + 0.3, v, z + 0.85 + 0.3 * rise / tread), P(-hl + 0.3, v, z + 0.85)], 0.022, 6)
    # tactile warning blocks across the head of the stair (30 cm, dots)
    K["x_tactile"].quad(P(hl, w0, g + 0.02), P(hl, w1, g + 0.02), P(hl + 0.3, w1, g + 0.02), P(hl + 0.3, w0, g + 0.02))
    # the strip light under the roof and the sign over the open end, each side facing out
    box(K["x_light"], P, -hl + 0.4, hl - 0.2, -0.06, 0.06, zr - 0.05, zr)
    A.quad(K["x_atlas"], P(hl + 0.67, -hw, zr - 0.36), P(hl + 0.67, hw, zr - 0.36), P(hl + 0.67, hw, zr + 0.38), P(hl + 0.67, -hw, zr + 0.38), f"exit_{e['ref']}")
    for side in (-1, 1):
        v = side * (hw + 0.125)
        a, b = (P(-hl + 0.2, v, zr + 0.02), P(hl - 0.2, v, zr + 0.02)) if side < 0 else (P(hl - 0.2, v, zr + 0.02), P(-hl + 0.2, v, zr + 0.02))
        A.quad(K["x_atlas"], a, b, b + [0, 0, 0.28], a + [0, 0, 0.28], "exit_side")
    # where the ground is not drawn: over the stair's well
    well = [P(hl - 0.35, w0, 0), P(hl - 0.35, w1, 0), P(-hl + 0.2, w1, 0), P(-hl + 0.2, w0, 0)]
    return [[round(float(p[0]), 2), round(float(p[1]), 2)] for p in well]


def draw_exit(img, rect, ref, name):
    """An exit's sign: navy, the exit's code white on a yellow square at the left, then the station."""
    from PIL import ImageDraw
    x, y, w, h = rect
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(22, 34, 72))
    s = h - 16
    d.rectangle([x + 8, y + 8, x + 8 + s * (1.5 if len(ref) > 2 else 1.2), y + 8 + s], fill=(255, 209, 0))
    if ref:
        f = ad.font("zen", int(s * 0.62))
        d.text((x + 8 + s * (0.75 if len(ref) > 2 else 0.6), y + 8 + s / 2), ref, font=f, fill=(20, 20, 20), anchor="mm")
    f = ad.font("zen", int(h * 0.34))
    f2 = ad.font("bebas", int(h * 0.3))
    x1 = x + 16 + s * (1.5 if len(ref) > 2 else 1.2)
    d.text((x1 + 8, y + h * 0.36), "渋谷駅", font=f, fill=(255, 255, 255), anchor="lm")
    d.text((x1 + 8, y + h * 0.76), "SHIBUYA STATION", font=f2, fill=(220, 226, 240), anchor="lm")


def draw_side(img, rect):
    from PIL import ImageDraw
    x, y, w, h = rect
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(22, 34, 72))
    f = ad.font("zen", int(h * 0.55))
    d.text((x + w / 2, y + h / 2), "地下鉄・東急線  渋谷駅  Subway / Tokyu Lines", font=f, fill=(235, 238, 245), anchor="mm")


# ---------------------------------------------------------------- the JR lines east of the scramble

# The Yamanote Line's two tracks and the two of the freight line (Saikyo and Shonan-Shinjuku trains)
# run north-south past the scramble on a raised bed, and cross the road under them on a steel girder
# bridge (OSM: bridge=yes, layer 1, level 2). The rails' height over the road, the girder's depth and
# the walls are estimates from photographs: the road under it is signed for about 4.5 m.
JR = {"y0": -1045.0, "y1": -860.0, "bridge": (-1012.5, -987.5), "rail_m": 7.4, "girder_m": 2.0, "clear_m": 4.9, "margin_m": 2.4,
      "lines": ("山手線", "山手貨物線"), "mast_every_m": 46.0}


def jr_tracks(D):
    """Each track's centre line, south to north, clipped to the corridor drawn (OSM, the surface lines)."""
    from shapely.ops import linemerge
    segs = []
    for w in D.ways:
        t = w["tags"]
        if t.get("railway") == "rail" and t.get("name") in JR["lines"] and not str(t.get("layer", "0")).startswith("-"):
            segs.append(LineString([tuple(p) for p in w["xy"]]))
    merged = linemerge(segs)
    out = []
    from shapely.geometry import box as sbox
    clipbox = sbox(380, JR["y0"], 520, JR["y1"])
    for ln in getattr(merged, "geoms", [merged]):
        c = ln.intersection(clipbox)
        for piece in getattr(c, "geoms", [c]):
            if piece.geom_type == "LineString" and piece.length > 30:
                pts = np.asarray(piece.coords)
                if pts[0][1] > pts[-1][1]:
                    pts = pts[::-1]
                out.append(pts)
    return out


def x_at(pts, y):
    """A south-to-north line's x where it crosses y (extrapolated past its ends)."""
    ys = pts[:, 1]
    if y <= ys[0]:
        i = 0
    elif y >= ys[-1]:
        i = len(ys) - 2
    else:
        i = int(np.searchsorted(ys, y)) - 1
    a, b = pts[i], pts[i + 1]
    return float(a[0] + (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) or 1e-6))


def jr_lines(K, A, D):
    tracks = jr_tracks(D)
    if not tracks:
        return
    ys = np.arange(JR["y0"], JR["y1"] + 0.01, 2.5)
    west = np.array([min(x_at(t, y) for t in tracks) - JR["margin_m"] for y in ys])
    east = np.array([max(x_at(t, y) for t in tracks) + JR["margin_m"] for y in ys])
    road_g = D.ground(430.0, -1000.0)
    zr = road_g + JR["rail_m"]                 # rail top
    zb = zr - 0.55                             # the ballast's top
    b0, b1 = JR["bridge"]
    wall, conc, ballast, steel = K["x_jr_wall"], K["x_jr_concrete"], K["x_ballast"], K["x_jr_steel"]
    # the bed: ballast between the walls, the walls down to the ground, a parapet on each side
    for k in range(len(ys) - 1):
        y, y2 = ys[k], ys[k + 1]
        on_bridge = b0 <= (y + y2) / 2 <= b1
        q = [(west[k], y), (east[k], y), (east[k + 1], y2), (west[k + 1], y2)]
        ballast.quad(*[np.array([x, yy, zb]) for x, yy in q], [[x, yy] for x, yy in q])
        for xs, side in ((west, -1), (east, 1)):
            a, b = np.array([xs[k], y]), np.array([xs[k + 1], y2])
            g0 = min(D.ground(*a), D.ground(*b))
            zlow = zb - JR["girder_m"] if on_bridge else g0 - 0.3
            mat = steel if on_bridge else wall
            p0, p1 = (a, b) if side > 0 else (b, a)    # wound to face out
            mat.quad(np.array([*p0, zlow]), np.array([*p1, zlow]), np.array([*p1, zb + 1.15]), np.array([*p0, zb + 1.15]),
                     [[0, zlow], [np.linalg.norm(b - a), zlow], [np.linalg.norm(b - a), zb + 1.15], [0, zb + 1.15]])
            conc.quad(np.array([*p0, zb + 1.15]), np.array([*p1, zb + 1.15]), np.array([*p1 + np.array([-side * 0.3, 0]), zb + 1.25]),
                      np.array([*p0 + np.array([-side * 0.3, 0]), zb + 1.25]))  # the parapet's coping
            if on_bridge:   # the girder's underside
                steel.quad(np.array([*p1, zlow]), np.array([*p0, zlow]), np.array([*p0 + np.array([-side * 1.2, 0]), zlow]),
                           np.array([*p1 + np.array([-side * 1.2, 0]), zlow]))
    # under the bridge: the deck's soffit with its cross girders, and the abutments each side of the road
    xw, xe = np.interp(b0, ys, west), np.interp(b0, ys, east)
    xw2, xe2 = np.interp(b1, ys, west), np.interp(b1, ys, east)
    soffit = zb - JR["girder_m"] + 0.6
    K["x_jr_steel"].quad(np.array([xe, b0, soffit]), np.array([xw, b0, soffit]), np.array([xw2, b1, soffit]), np.array([xe2, b1, soffit]))
    for yy in np.arange(b0 + 1.5, b1 - 1.0, 2.2):
        xa, xb = np.interp(yy, ys, west), np.interp(yy, ys, east)
        box(steel, frame((xa, yy), (xb - xa, 0)), 0, xb - xa, -0.12, 0.12, soffit - 0.9, soffit)
    for yy, s_ in ((b0, -1), (b1, 1)):
        xa, xb = np.interp(yy, ys, west), np.interp(yy, ys, east)
        g = D.ground((xa + xb) / 2, yy)
        box(conc, frame((xa, yy), (xb - xa, 0)), 0, xb - xa, (-1.2 if s_ < 0 else 0.0), (0.0 if s_ < 0 else 1.2), g - 0.3, zb - JR["girder_m"] + 0.2, uvm=True)
    # the rails on their sleepers (1,067 mm gauge, a sleeper every 0.6 m)
    rail, sleeper = K["x_rail_steel"], K["x_sleeper"]
    for t in tracks:
        y = JR["y0"]
        while y < JR["y1"]:
            x = x_at(t, y)
            sleeper.quad(np.array([x - 1.0, y - 0.1, zb + 0.14]), np.array([x + 1.0, y - 0.1, zb + 0.14]), np.array([x + 1.0, y + 0.1, zb + 0.14]),
                         np.array([x - 1.0, y + 0.1, zb + 0.14]))   # (only their tops: the bed is seen from below or from afar)
            y += 0.6
        for off in (-0.5335, 0.5335):
            path = [np.array([x_at(t, yy) + off, yy, zr - 0.08]) for yy in np.arange(JR["y0"], JR["y1"] + 0.1, 5.0)]
            rail.tube(path, 0.04, 4)
    # the overhead line: a portal mast every 46 m across all four tracks, and a contact wire over each
    xs_all = lambda y: [x_at(t, y) for t in tracks]
    for y in np.arange(JR["y0"] + 12.0, JR["y1"], JR["mast_every_m"]):
        if b0 - 3 < y < b1 + 3:
            continue
        xa, xb = np.interp(y, ys, west) + 0.5, np.interp(y, ys, east) - 0.5
        for x in (xa, xb):
            box(steel, frame((x, y), (1, 0)), -0.15, 0.15, -0.15, 0.15, zb, zr + 6.2)
        box(steel, frame((xa, y), (1, 0)), 0, xb - xa, -0.12, 0.12, zr + 5.9, zr + 6.25)
        for x in xs_all(y):
            K["x_wire"].tube([np.array([x, y, zr + 5.9]), np.array([x, y, zr + 5.2])], 0.012, 4)
    for t in tracks:
        for h, r in ((5.1, 0.008), (6.0, 0.01)):
            K["x_wire"].tube([np.array([x_at(t, yy), yy, zr + h]) for yy in np.arange(JR["y0"], JR["y1"] + 0.1, 10.0)], r, 4)


# ---------------------------------------------------------------- QFRONT

# QFRONT (1999, Tokyu; 8 floors over the ground, PLATEAU's 52.2 m to the top of its crown): the glass
# front over the scramble, curved round its two corners, is a double skin, an outer glass wall on dense
# silver fins in front of the floors, with Q'S EYE built into it; the fins run up through the crown, a
# glass box at the top with a roof advert inside it, and the building's name under it. At the foot, a
# canopy over the shopfronts carries STARBUCKS COFFEE (2F) and SHIBUYA TSUTAYA. From photographs
# (Wikimedia Commons, 2024-25: docs/cities/shibuya.md); the fins' spacing (0.9 m), the skins' gap
# (1.2 m), the storeys and the canopy are estimates. The advert in the crown is invented.
QFRONT = {"osm": "w136691386", "round_m": 5.5, "fin_m": 0.9, "gap_m": 1.2, "shop_m": 4.8, "storey_m": 4.6, "crown_m": 8.6,
          "canopy_m": 1.4, "toward": (369.0, -1000.0)}


def ring_edges(poly):
    """A polygon's outer edges as (a, b, outward normal, length), counter-clockwise."""
    from shapely.geometry.polygon import orient
    cs = np.asarray(orient(poly, 1.0).exterior.coords)
    out = []
    for a, b in zip(cs[:-1], cs[1:]):
        e = b - a
        L = float(np.linalg.norm(e))
        if L > 1e-3:
            out.append((a, b, np.array([e[1], -e[0]]) / L, L))
    return out


def qfront(K, A, D):
    s = next((s for s in D.solids if s["osm"] == QFRONT["osm"] and s["top"] > 40), None)
    if not s:
        return []
    g, zt = s["ground"], s["ground"] + s["top"]
    zc = zt - QFRONT["crown_m"]                          # the crown's foot: the top of the floors
    zs = g + QFRONT["shop_m"]                            # the canopy: the shopfronts under it
    R = QFRONT["round_m"]
    O = Polygon(s["ring"]).buffer(-R, join_style=2).buffer(R, resolution=6)   # the rounded corners
    toward = np.asarray(QFRONT["toward"])
    cen = np.array(O.centroid.coords[0])
    front = lambda mid, n: (toward - cen) @ n / np.linalg.norm(toward - cen) > -0.25 and (mid - cen) @ (toward - cen) > -8.0
    inner = O.buffer(-QFRONT["gap_m"], join_style=2)
    fin, panel, cw, glass = K["x_fin"], K["x_qf_panel"], K["qfront_glass"], K["x_qf_glass"]
    # the floors behind the outer skin (lit after dark), and the plain walls at the back
    for a, b, n, L in ring_edges(inner):
        mid = (a + b) / 2
        mat = cw if front(mid, n) else panel
        mat.quad(np.array([*a, g]), np.array([*b, g]), np.array([*b, zc]), np.array([*a, zc]), [[0, 0], [L, 0], [L, zc - g], [0, zc - g]])
    ak.cap(panel, ak.WORLD, [tuple(p) for p in list(inner.exterior.coords)[:-1]], zc)
    # the crown's plant room, dark behind the glass, a little smaller
    crown = O.buffer(-QFRONT["gap_m"] - 0.6, join_style=2)
    for a, b, n, L in ring_edges(crown):
        K["x_dark"].quad(np.array([*a, zc]), np.array([*b, zc]), np.array([*b, zt - 0.4]), np.array([*a, zt - 0.4]))
    ak.cap(K["x_qf_roof"], ak.WORLD, [tuple(p) for p in list(crown.exterior.coords)[:-1]], zt - 0.4)
    # the outer skin: glass on the front from the canopy to the top, fins every 0.9 m, a transom at each floor
    edges = ring_edges(O)
    is_front = [front((a + b) / 2, n) for a, b, n, L in edges]
    fronts = [e for e, f in zip(edges, is_front) if f]
    for (a, b, n, L), f in zip(edges, is_front):
        if f:
            glass.quad(np.array([*a, zs]), np.array([*b, zs]), np.array([*b, zt]), np.array([*a, zt]))
        else:
            panel.quad(np.array([*a, g]), np.array([*b, g]), np.array([*b, zt]), np.array([*a, zt]), [[0, 0], [L, 0], [L, zt - g], [0, zt - g]])
    # the fins and transoms, walking the front at an even spacing
    path = []
    for a, b, n, L in fronts:
        k = max(1, int(round(L / 0.3)))
        path += [(a + (b - a) * t, n) for t in np.linspace(0, 1, k, endpoint=False)]
    if fronts:
        path.append((fronts[-1][1], fronts[-1][2]))
    acc, last = 0.0, None
    fins = []
    for p, n in path:
        if last is not None:
            acc += float(np.linalg.norm(p - last))
        if last is None or acc >= QFRONT["fin_m"]:
            fins.append((p, n))
            acc = 0.0
        last = p
    for p, n in fins:
        t = np.array([-n[1], n[0]])
        box(fin, frame(p, n), -0.05, 0.42, -0.04, 0.04, zs, zt + 0.2)
    for z in list(np.arange(zs + QFRONT["storey_m"], zc, QFRONT["storey_m"])) + [zc, zs]:
        for (p, n), (q, n2) in zip(fins, fins[1:]):
            if np.linalg.norm(q - p) > 2.0:
                continue
            o, o2 = p + n * 0.42, q + n2 * 0.42
            fin.quad(np.array([*o, z - 0.08]), np.array([*o2, z - 0.08]), np.array([*o2, z + 0.08]), np.array([*o, z + 0.08]))
    # the crown's advert inside the glass, and the name under it, on the front's middle
    mid_edge = max(fronts, key=lambda e: e[3]) if fronts else None
    if mid_edge is not None:
        a, b, n, L = mid_edge
        # the longest stretch of the front faces the crossing: its chord, from the first front edge to the last
        fa, fb = fronts[0][0], fronts[-1][1]
        ch = fb - fa
        nf = np.array([ch[1], -ch[0]]) / np.linalg.norm(ch)
        c = (fa + fb) / 2 + nf * 0.0
        # the point of the outline furthest out along nf: the front's face
        depth = max((np.asarray(q) - c) @ nf for q in O.exterior.coords)
        c = c + nf * (depth - QFRONT["gap_m"] - 0.4)
        t = np.array([-nf[1], nf[0]])
        w = np.linalg.norm(ch) * 0.62
        A.quad(K["x_atlas"], np.array([*(c - t * w / 2), zc + 1.0]), np.array([*(c + t * w / 2), zc + 1.0]),
               np.array([*(c + t * w / 2), zt - 1.2]), np.array([*(c - t * w / 2), zt - 1.2]), "qf_crown")
        cl = c + nf * (QFRONT["gap_m"] + 0.25)
        A.quad(K["x_atlas"], np.array([*(cl - t * 2.6), zc - 1.55]), np.array([*(cl + t * 2.6), zc - 1.55]),
               np.array([*(cl + t * 2.6), zc - 0.85]), np.array([*(cl - t * 2.6), zc - 0.85]), "qf_name")
    # the shopfronts under the canopy, set back, lit; the canopy and its signs
    shop = O.buffer(-1.0, join_style=2)
    for a, b, n, L in ring_edges(shop):
        mid = (a + b) / 2
        if front(mid, n):
            K["x_shop"].quad(np.array([*a, g]), np.array([*b, g]), np.array([*b, zs]), np.array([*a, zs]), [[0, 0], [L, 0], [L, zs - g], [0, zs - g]])
    can = O.buffer(QFRONT["canopy_m"], join_style=2)
    cedges = [(a, b, n, L) for a, b, n, L in ring_edges(can) if front((a + b) / 2, n)]
    for a, b, n, L in cedges:
        ai, bi = a - n * (QFRONT["canopy_m"] + 1.0), b - n * (QFRONT["canopy_m"] + 1.0)
        panel.quad(np.array([*bi, zs - 0.55]), np.array([*b, zs - 0.55]), np.array([*a, zs - 0.55]), np.array([*ai, zs - 0.55]))   # its soffit
        panel.quad(np.array([*a, zs - 0.55]), np.array([*b, zs - 0.55]), np.array([*b, zs + 0.35]), np.array([*a, zs + 0.35]))     # its fascia
        panel.quad(np.array([*ai, zs + 0.35]), np.array([*a, zs + 0.35]), np.array([*b, zs + 0.35]), np.array([*bi, zs + 0.35]))
        K["x_light"].quad(np.array([*(b - n * 0.4), zs - 0.56]), np.array([*(a - n * 0.4), zs - 0.56]), np.array([*(a - n * 0.55), zs - 0.56]), np.array([*(b - n * 0.55), zs - 0.56]))
    # STARBUCKS COFFEE over the canopy on the left of the front, SHIBUYA TSUTAYA on the right (as seen from the crossing)
    if fronts:
        ch = fronts[-1][1] - fronts[0][0]
        nf = np.array([ch[1], -ch[0]]) / np.linalg.norm(ch)
        t = np.array([-nf[1], nf[0]])
        c = (fronts[0][0] + fronts[-1][1]) / 2
        depth = max((np.asarray(q) - c) @ nf for q in O.exterior.coords)
        c = c + nf * (depth + 0.35)
        for along, w, h, z0, key in ((-5.2, 8.0, 0.95, zs + 1.4, "qf_starbucks"), (6.0, 5.6, 0.9, zs + 0.45, "qf_tsutaya")):
            q = c + t * along
            A.quad(K["x_atlas"], np.array([*(q - t * w / 2), z0]), np.array([*(q + t * w / 2), z0]), np.array([*(q + t * w / 2), z0 + h]),
                   np.array([*(q - t * w / 2), z0 + h]), key)
    return [s["si"] for s in D.solids if s["osm"] == QFRONT["osm"]]


def draw_qfront(img, rects):
    from PIL import ImageDraw, ImageFilter
    x, y, w, h = rects["qf_crown"]        # the roof advert: an invented soda, red, white swash
    sub = Image_new(w, h, (196, 18, 30))
    d = ImageDraw.Draw(sub)
    for k in range(6):
        d.arc([-w * 0.2, h * (0.25 + 0.1 * k), w * 1.2, h * (1.6 + 0.1 * k)], 190, 350, fill=(255, 255, 255), width=3)
    f = ad.font("reggae", int(h * 0.52))
    d.text((w * 0.36, h * 0.46), "FIZZLE", font=f, fill=(255, 255, 255), anchor="mm")
    f = ad.font("zen", int(h * 0.2))
    d.text((w * 0.78, h * 0.5), "爽快、ひと口。", font=f, fill=(255, 236, 236), anchor="mm")
    img.paste(sub, (x, y))
    x, y, w, h = rects["qf_name"]
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(40, 44, 50))
    f = ad.font("bebas", int(h * 0.8))
    d.text((x + w / 2, y + h / 2 + 2), "Q FRONT", font=f, fill=(240, 242, 244), anchor="mm")
    x, y, w, h = rects["qf_starbucks"]
    d.rectangle([x, y, x + w, y + h], fill=(28, 30, 32))
    f = ad.font("bebas", int(h * 0.78))
    d.text((x + w / 2, y + h / 2 + 2), "STARBUCKS COFFEE", font=f, fill=(245, 245, 240), anchor="mm")
    x, y, w, h = rects["qf_tsutaya"]
    d.rectangle([x, y, x + w, y + h], fill=(20, 24, 40))
    d.rectangle([x + 10, y + 14, x + 10 + h - 28, y + h - 14], fill=(255, 205, 0))
    f = ad.font("bebas", int(h * 0.7))
    d.text((x + h + (w - h) / 2, y + h / 2 + 2), "SHIBUYA TSUTAYA", font=f, fill=(255, 255, 255), anchor="mm")


def Image_new(w, h, c):
    from PIL import Image
    return Image.new("RGB", (w, h), c)


# ---------------------------------------------------------------- the module's hooks (city.py)

class Build:
    """What the scramble adds to the Shibuya map's landmarks: meshes, solids it draws instead, ground clips."""

    def __init__(self, city_id, node):
        self.D = Data(city_id)
        self.node = np.asarray(node, float)
        self.entrances = entrance_sites(self.D, self.node)
        items = [(f"exit_{e['ref']}", 512, 96) for e in self.entrances] + [("exit_side", 1024, 64)]
        items += [("qf_crown", 1024, 320), ("qf_name", 384, 52), ("qf_starbucks", 768, 92), ("qf_tsutaya", 512, 84)]
        self.A = Atlas(list(dict.fromkeys(items)), width=2048)

    def meshes(self):
        K = ak.Kit("scramble", floodlit=LIT, uv={k for k, m in MATERIALS.items() if "map" in m or "pattern" in m})
        clip, hidden = [], []
        crosswalks(K, self.D, self.node)
        jr_lines(K, self.A, self.D)
        hidden += qfront(K, self.A, self.D)
        for e in self.entrances:
            clip.append({"ring": entrance(K, self.A, e)})
            hidden.append(e["si"])
        return K.out(), hidden, clip

    def draw(self, out_dir):
        from PIL import Image
        img = Image.new("RGB", (self.A.W, self.A.H), (30, 32, 36))
        for e in self.entrances:
            draw_exit(img, self.A.rects[f"exit_{e['ref']}"], e["ref"], e["name"])
        draw_side(img, self.A.rects["exit_side"])
        draw_qfront(img, self.A.rects)
        img.save(os.path.join(out_dir, ATLAS_FILE), quality=90)
        return ATLAS_FILE
