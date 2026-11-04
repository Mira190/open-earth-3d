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


def _sibling(name):
    """A module next to this one (this folder is not on sys.path): streets.py, the streets off the scramble."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(f"shibuya_{name}", os.path.join(HERE, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


streets = _sibling("streets")

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
    "x_tactile": {"color": "#e1b20f", "roughness": 0.7, "metalness": 0.0, "pattern": "granite", "joints_m": [0.3, 0.1], "decal": True},
    "x_tactile_dot": {"color": "#e8b711", "roughness": 0.7, "metalness": 0.0, "pattern": "granite", "joints_m": [0.075, 0.075], "decal": True},
    "x_rail": {"color": "#b7bcc0", "roughness": 0.3, "metalness": 0.8},
    "x_guard": {"color": "#eeeeea", "roughness": 0.45, "metalness": 0.2},
    "x_light": {"color": "#f3f1ea", "roughness": 0.5, "metalness": 0.0, "emissive": "#fff4e0", "glow": 2.4},
    # the drawn signs (this module's own atlas, scramble.jpg), lit after dark
    # the JR lines' bed: retaining walls of concrete, the girder bridge's steel (painted grey), ballast, rails
    "x_jr_wall": {"color": "#a7a39a", "roughness": 0.9, "metalness": 0.0, "pattern": "granite", "joints_m": [5.0, 0.0]},
    "x_jr_concrete": {"color": "#bab6ad", "roughness": 0.9, "metalness": 0.0},
    "x_jr_steel": {"color": "#727a80", "roughness": 0.55, "metalness": 0.45},
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
    # SHIBUYA109's aluminium panels: horizontal joints every 0.9 m, vertical every 1.8 m (photographs)
    "x_alu": {"color": "#b9bdc1", "roughness": 0.38, "metalness": 0.6, "pattern": "granite", "joints_m": [1.8, 0.9]},
    # printed adverts lit from outside by lamps: dimmer after dark than a lit box
    "x_print": {"color": "#ffffff", "roughness": 0.7, "metalness": 0.0, "map": ATLAS_FILE, "emissive_map": True, "glow": 0.5},
    "x_station": {"color": "#c9ccce", "roughness": 0.6, "metalness": 0.2, "pattern": "granite", "joints_m": [1.5, 3.6]},
    "x_koban": {"color": "#d8d4cb", "roughness": 0.7, "metalness": 0.0, "pattern": "granite", "joints_m": [0.3, 0.6]},
    "x_red_lamp": {"color": "#d0201a", "roughness": 0.3, "metalness": 0.0, "emissive": "#ff2010", "glow": 3.0},
    # a white grid of mullions and floor bands over a building's glass (city windows lit behind it after dark)
    "x_skin": {"color": "#3a4650", "roughness": 0.15, "metalness": 0.3, "pattern": "curtain_wall", "bay_m": 1.7, "storey_m": 3.4, "spandrel": 0.3,
               "mullion_m": 0.22, "frame": "#ecebe6", "lit_share": 0.6, "lit_k": 0.9, "warm_share": 0.5},
    "x_gate": {"color": "#7c8086", "roughness": 0.5, "metalness": 0.55},
    "x_fence": {"color": "#6f757b", "roughness": 0.5, "metalness": 0.6, "pattern": "railing", "bar_m": 0.1, "rails_m": [0.05, 1.75]},
    "x_tyre": {"color": "#1b1b1c", "roughness": 0.8, "metalness": 0.0},
    "x_bike_silver": {"color": "#b4b8bc", "roughness": 0.35, "metalness": 0.7},
    "x_bike_black": {"color": "#26282b", "roughness": 0.5, "metalness": 0.3},
    "x_bike_white": {"color": "#e8e8e4", "roughness": 0.45, "metalness": 0.2},
    "x_bike_red": {"color": "#a8262a", "roughness": 0.45, "metalness": 0.3},
    "x_atlas": {"color": "#ffffff", "roughness": 0.6, "metalness": 0.0, "map": ATLAS_FILE, "emissive_map": True, "glow": 1.3},
    # the bookshop on Center Gai's corner: white clapboard, its blue awning and trim, the sign box's white sides
    "x_clap": {"color": "#ecebe6", "roughness": 0.7, "metalness": 0.0, "pattern": "granite", "joints_m": [0.0, 0.2]},
    "x_bk_blue": {"color": "#1f45a8", "roughness": 0.65, "metalness": 0.0},
    "x_bk_box": {"color": "#f1f1ee", "roughness": 0.5, "metalness": 0.1},
}
MATERIALS.update(streets.MATERIALS)
LIT = {"x_light", "x_atlas", "x_print", "x_shop", "x_red_lamp"}


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
    area = junction_area(D)
    ground_polygon(asphalt, area, gz, 0.03)
    tactile(K, D, np.asarray(node, float), area)
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
            lanes = [back + (f if f @ drv_left > 0 else -f) * (L / 2 - 1.6 - 3.1 * k) for k in range(int(L // 3.1))]
        else:
            p, q = back + drv_left * 0.15, back + drv_left * L / 2
            lanes = [back + drv_left * (1.6 + 3.1 * k) for k in range(int((L / 2) // 3.1))]
        paint_strip(paint, gz, p, q, STOP_W)
        # the diamonds that warn of the crosswalk ahead (横断歩道又は自転車横断帯あり), 30 m and 50 m back, one per lane
        bands = road_bands(D)
        for c0 in lanes:
            for d in (30.0, 50.0):
                cc = c0 + o * d
                if not bands.contains(Point(*cc).buffer(1.0)):
                    continue
                pts = [cc + o * 2.5, cc + drv_left * 0.75, cc - o * 2.5, cc - drv_left * 0.75]
                for k in range(4):
                    paint_strip(paint, gz, pts[k], pts[(k + 1) % 4], 0.2, n=2)
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
    guard_rails(K, D, area, centre)


def road_bands(D):
    if not hasattr(D, "_bands"):
        from shapely.ops import unary_union
        D._bands = unary_union([LineString([p[:2] for p in pts]).buffer(ROADW.get(c, 7) / 2, cap_style=2) for c, pts in D.roads
                                if len(pts) > 1 and min(p[2] - D.ground(p[0], p[1]) for p in pts) < 3])
    return D._bands


def guard_rails(K, D, area, centre, near=40.0):
    """Along the scramble's kerbs, between the crosswalks: white guard pipes (ガードパイプ, 0.8 m, posts every
    2 m) on the Hachiko and station side, and short stainless bollards along QFRONT's forecourt, where the
    photographs show them; none across a crosswalk's end, a road or a doorway."""
    bands = road_bands(D)
    ends = []
    for c in CROSSWALKS:
        a, b = np.asarray(c["a"], float), np.asarray(c["b"], float)
        ends += [Point(*a).buffer(c["width"] / 2 + 0.8), Point(*b).buffer(c["width"] / 2 + 0.8)]
    from shapely.ops import unary_union
    skip = unary_union(ends)
    ring = np.asarray(area.exterior.coords)
    white, steel = K["x_guard"], K["x_rail"]
    gz = lambda p: D.ground(*p)
    from shapely.geometry.polygon import orient
    ring = np.asarray(orient(area, 1.0).exterior.coords)
    for a, b in zip(ring[:-1], ring[1:]):
        L = float(np.linalg.norm(b - a))
        if L < 0.5:
            continue
        f = (b - a) / L
        out = np.array([f[1], -f[0]])
        n = max(1, int(L // 2.0))
        for k in range(n):
            p, q = a + f * L * k / n, a + f * L * (k + 1) / n
            m = (p + q) / 2
            o = m + out * 0.45
            if np.linalg.norm(m - centre) > near or skip.contains(Point(*m)) or bands.contains(Point(*(m + out * 1.2))):
                continue
            if any(Polygon(s_["ring"]).contains(Point(*(m + out * 0.6))) for s_ in D.solids if abs(s_["ring"][0][0] - m[0]) < 25 and abs(s_["ring"][0][1] - m[1]) < 25):
                continue
            if m[1] > -992.0 and m[0] < 372.0:             # QFRONT's forecourt: bollards
                c = o
                lathe = [(gz(c), 0.09), (gz(c) + 0.75, 0.09), (gz(c) + 0.8, 0.06), (gz(c) + 0.82, 0.0)]
                steel.lathe([(float(z), float(r)) for z, r in lathe], (float(c[0]), float(c[1])), 10)
                continue
            po, qo = p + out * 0.45, q + out * 0.45
            for c in (po,):
                white.tube([np.array([*c, gz(c)]), np.array([*c, gz(c) + 0.8])], 0.035, 6)
            for h in (0.42, 0.78):
                white.tube([np.array([*po, gz(po) + h]), np.array([*qo, gz(qo) + h])], 0.025, 6)


# ---------------------------------------------------------------- tactile paving

def tactile(K, D, node, road, radius=125.0):
    """The yellow tactile blocks (点字ブロック, 30 cm square) along the footways OSM tags tactile_paving=yes
    round the scramble: guide blocks along the line, warning blocks (dots) where it meets a kerb or turns,
    on the pavement only (not on the road, not under a building)."""
    from shapely.ops import unary_union
    from shapely import STRtree
    blds = [Polygon(s["ring"]) for s in D.solids if len(s["ring"]) >= 3 and np.linalg.norm(np.asarray(s["ring"][0]) - node) < radius + 60]
    blocked = unary_union([b.buffer(0.3) for b in blds if b.is_valid] + [road.buffer(0.2)])
    m = K["x_tactile"]
    gz = lambda p: D.ground(*p)
    ends = []
    for w in D.ways:
        t = w["tags"]
        if t.get("tactile_paving") != "yes" or not t.get("highway") or t.get("highway") in ("steps", "elevator"):
            continue
        if str(t.get("layer", "0")) != "0" or str(t.get("level", "0"))[:1] in "-123" or t.get("bridge"):
            continue
        pts = [p for p in w["xy"]]
        if min(np.linalg.norm(p - node) for p in pts) > radius:
            continue
        line = LineString([tuple(p) for p in pts]).difference(blocked)
        for piece in getattr(line, "geoms", [line]):
            if piece.geom_type != "LineString" or piece.length < 0.6:
                continue
            cs = np.asarray(piece.coords)
            for a, b in zip(cs[:-1], cs[1:]):
                L = float(np.linalg.norm(b - a))
                if L < 0.05:
                    continue
                f = (b - a) / L
                l = np.array([-f[1], f[0]]) * 0.15
                for k in range(max(1, int(L // 2.0) + 1)):
                    p, q = a + f * L * k / max(1, int(L // 2.0) + 1), a + f * L * (k + 1) / max(1, int(L // 2.0) + 1)
                    u0, u1 = L * k / max(1, int(L // 2.0) + 1), L * (k + 1) / max(1, int(L // 2.0) + 1)
                    m.quad(*[np.array([*x, gz(x) + 0.12]) for x in (p - l, q - l, q + l, p + l)], [[u0, 0], [u1, 0], [u1, 0.3], [u0, 0.3]])
            ends += [cs[0], cs[-1]]
    dots = K["x_tactile_dot"]
    for e in ends:
        if road.distance(Point(*e)) < 1.5 or blocked.distance(Point(*e)) > 0.8:   # at a kerb, or at a door
            for i in (-1, 0):
                for j in (-1, 0):
                    q = [e + np.array([i * 0.3 + a, j * 0.3 + b]) for a, b in ((0, 0), (0.3, 0), (0.3, 0.3), (0, 0.3))]
                    dots.quad(*[np.array([*x, gz(x) + 0.125]) for x in q], [list(x) for x in q])


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
            if g.area < 200 and g.distance(p) < 0.5:
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
        kiosk = Poly(best["ring"]).area > 150       # Shibuchika's pavilion on Hachiko Square: open toward the crossing
        if kiosk:
            f = unit(near - c)
            up = None
            down = c - f
        # the stairs go down away from the open end: the end the street footway comes in at
        if up is not None and abs((up - c) @ f) > 0.3:
            sgn = 1.0 if (up - c) @ f > 0 else -1.0
        elif down is not None:
            sgn = -1.0 if (down - c) @ f > 0 else 1.0
        else:
            sgn = 1.0 if (n["xy"] - c) @ f >= 0 else -1.0
        out.append({"ref": t.get("ref") or "", "name": "しぶちか" if kiosk else (t.get("name") or "渋谷駅"), "kiosk": kiosk, "si": best["si"], "c": c, "f": f * sgn, "L": L, "W": W,
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
    """An exit's sign: navy, the exit's code white on a yellow square at the left, then the station;
    Shibuchika's pavilion carries its own name, white on charcoal."""
    from PIL import ImageDraw
    x, y, w, h = rect
    d = ImageDraw.Draw(img)
    if name == "しぶちか":
        d.rectangle([x, y, x + w, y + h], fill=(38, 40, 44))
        f = ad.font("rounded", int(h * 0.5))
        d.text((x + w * 0.4, y + h * 0.48), "しぶちか", font=f, fill=(255, 255, 255), anchor="mm")
        f = ad.font("bebas", int(h * 0.28))
        d.text((x + w * 0.78, y + h * 0.52), "SHIBUCHIKA  " + ref, font=f, fill=(220, 222, 226), anchor="mm")
        return
    d.rectangle([x, y, x + w, y + h], fill=(22, 34, 72))
    s = h - 16
    if ref:
        d.rectangle([x + 8, y + 8, x + 8 + s * (1.5 if len(ref) > 2 else 1.2), y + 8 + s], fill=(255, 209, 0))
    if ref:
        f = ad.font("zen", int(s * 0.62))
        d.text((x + 8 + s * (0.75 if len(ref) > 2 else 0.6), y + 8 + s / 2), ref, font=f, fill=(20, 20, 20), anchor="mm")
    f = ad.font("zen", int(h * 0.34))
    f2 = ad.font("bebas", int(h * 0.3))
    x1 = x + 16 + (s * (1.5 if len(ref) > 2 else 1.2) if ref else 0)
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
JR = {"y0": -1016.0, "y1": -860.0, "bridge": (-1012.5, -987.5), "rail_m": 7.4, "girder_m": 2.0, "clear_m": 4.9, "margin_m": 2.4,
      "lines": ("山手線", "山手貨物線"), "mast_every_m": 46.0}


JR_LOT = (422.5, -908.0, 447.5, -898.8)   # ハチ公口自転車等駐輪場 under the tracks (OSM): x0, y0, x1, y1


def bicycle_model(colour, basket):
    """A city bicycle (mamachari), pointing along +x, its wheels on the ground at x = -0.55 and 0.5."""
    from meshkit import Mesh
    tyre, frm, black, steel = (Mesh(f"bike_{n}", m, False) for n, m in (("tyre", "x_tyre"), ("frame", colour), ("saddle", "x_bike_black"), ("bars", "x_rail")))
    P = lambda u, v, z: np.array([u, v, z])
    r = 0.33
    for u in (-0.55, 0.5):
        tyre.tube([P(u + r * math.cos(t), 0, r + r * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 13)], 0.022, 4)
    frm.tube([P(-0.55, 0, r), P(-0.12, 0, 0.78), P(0.38, 0, 0.8), P(0.5, 0, r)], 0.022, 4)
    frm.tube([P(-0.12, 0, 0.78), P(0.0, 0, r), P(0.38, 0, 0.8)], 0.02, 4)
    black.tube([P(-0.17, 0, 0.92), P(-0.02, 0, 0.92)], 0.045, 5)
    steel.tube([P(0.42, -0.26, 1.0), P(0.42, 0.26, 1.0)], 0.015, 4)
    if basket:
        box(steel, frame((0, 0), (1, 0)), 0.48, 0.78, -0.15, 0.15, 0.72, 0.92)
    return [m for m in (tyre, frm, black, steel) if m.v]


def bicycles(D, lot, every=0.62):
    """The bicycle lot under the tracks: two rows of city bicycles in their racks, in a few colours,
    instanced (landmarks.json props)."""
    x0, y0, x1, y1 = lot
    rng = np.random.default_rng(1105)
    kinds = {f"bicycle_{c}_{b}": (f"x_bike_{c}", b) for c in ("silver", "black", "white", "red") for b in (0, 1)}
    at = {k: [] for k in kinds}
    for row_y, face in ((y0 + 1.2, 1), (y1 - 1.2, -1)):
        for x in np.arange(x0 + 0.6, x1 - 0.4, every):
            if rng.random() < 0.15:
                continue                                   # a free space
            k = list(kinds)[int(rng.integers(len(kinds)))]
            yy = row_y - face * 0.5                        # the bicycle's middle, pointing into the rack
            at[k].append([round(float(x), 2), round(float(yy), 2), round(D.ground(x, yy), 2), round(face * math.pi / 2, 3)])
    return [dict(name=k, at=v, parts=[m.dump() for m in bicycle_model(*kinds[k])], far=250) for k, v in at.items() if v]


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
        viaduct = (y + y2) / 2 > b1 + 1.2          # north of the bridge the tracks are on a viaduct (the bicycle lot is under it)
        q = [(west[k], y), (east[k], y), (east[k + 1], y2), (west[k + 1], y2)]
        ballast.quad(*[np.array([x, yy, zb]) for x, yy in q], [[x, yy] for x, yy in q])
        if viaduct:
            conc.quad(*[np.array([x, yy, zb - JR["girder_m"] + 0.3]) for x, yy in (q[1], q[0], q[3], q[2])])   # its soffit
        for xs, side in ((west, -1), (east, 1)):
            a, b = np.array([xs[k], y]), np.array([xs[k + 1], y2])
            g0 = min(D.ground(*a), D.ground(*b))
            zlow = zb - JR["girder_m"] if (on_bridge or viaduct) else g0 - 0.3
            mat = steel if on_bridge else (conc if viaduct else wall)
            p0, p1 = (a, b) if side > 0 else (b, a)    # wound to face out
            mat.quad(np.array([*p0, zlow]), np.array([*p1, zlow]), np.array([*p1, zb + 1.15]), np.array([*p0, zb + 1.15]),
                     [[0, zlow], [np.linalg.norm(b - a), zlow], [np.linalg.norm(b - a), zb + 1.15], [0, zb + 1.15]])
            conc.quad(np.array([*p0, zb + 1.15]), np.array([*p1, zb + 1.15]), np.array([*p1 + np.array([-side * 0.3, 0]), zb + 1.25]),
                      np.array([*p0 + np.array([-side * 0.3, 0]), zb + 1.25]))  # the parapet's coping
            if on_bridge:   # the girder's underside
                steel.quad(np.array([*p1, zlow]), np.array([*p0, zlow]), np.array([*p0 + np.array([-side * 1.2, 0]), zlow]),
                           np.array([*p1 + np.array([-side * 1.2, 0]), zlow]))
    # the bridge's plate girders: vertical stiffeners every 1.2 m and a flange top and bottom, on both faces,
    # and the clearance sign over the road on the scramble's side (高さ制限; its figure is an estimate)
    for xs, side in ((west, -1), (east, 1)):
        for yy in np.arange(b0 + 0.4, b1 - 0.2, 1.2):
            x = np.interp(yy, ys, xs)
            box(steel, frame((x, yy), (side, 0)), 0.0, 0.12, -0.06, 0.06, zb - JR["girder_m"], zb + 1.15)
        for z in (zb - JR["girder_m"], zb + 1.0):
            x0_, x1_ = np.interp(b0, ys, xs), np.interp(b1, ys, xs)
            box(steel, frame((x0_, b0), (x1_ - x0_, b1 - b0)), 0.0, b1 - b0, -0.25 * side - 0.0, 0.25 * side, z, z + 0.15)
    xw0 = np.interp((b0 + b1) / 2, ys, west)
    Pw = frame((xw0 - 0.15, (b0 + b1) / 2), (-1, 0))
    A.quad(K["x_atlas"], Pw(0, 1.6, zb - JR["girder_m"] + 0.25), Pw(0, -1.6, zb - JR["girder_m"] + 0.25), Pw(0, -1.6, zb - JR["girder_m"] + 1.05),
           Pw(0, 1.6, zb - JR["girder_m"] + 1.05), "jr_clear")
    # the viaduct's columns, in three rows, and the fence between the western ones (open at the bicycle lot)
    lot = JR_LOT
    for yy in np.arange(b1 + 6.0, JR["y1"], 7.5):
        xa, xb = np.interp(yy, ys, west), np.interp(yy, ys, east)
        g = D.ground((xa + xb) / 2, yy)
        for x in (xa + 0.6, (xa + xb) / 2, xb - 0.6):
            box(conc, frame((x, yy), (1, 0)), -0.45, 0.45, -0.45, 0.45, g - 0.2, zb - JR["girder_m"] + 0.3, uvm=True)
        y2 = yy + 7.5
        if y2 < JR["y1"] and not (lot[1] - 1 < yy + 3.75 < lot[3] + 1):
            xa2 = np.interp(y2, ys, west)
            K["x_fence"].quad(np.array([xa + 0.15, yy, g]), np.array([xa2 + 0.15, y2, g]), np.array([xa2 + 0.15, y2, g + 1.8]), np.array([xa + 0.15, yy, g + 1.8]),
                              [[0, 0], [7.5, 0], [7.5, 1.8], [0, 1.8]])
    D.props = getattr(D, "props", []) + bicycles(D, lot)
    for row_y, face in ((lot[1] + 1.2, 1), (lot[3] - 1.2, -1)):     # the racks' rails
        K["x_rail"].tube([np.array([lot[0] + 0.5, row_y + face * 0.6, D.ground(lot[0], row_y) + 0.3]),
                          np.array([lot[2] - 0.5, row_y + face * 0.6, D.ground(lot[2], row_y) + 0.3])], 0.025, 4)
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


# ---------------------------------------------------------------- the Ginza line's viaduct

# The Ginza line, Tokyo's first underground (1927), comes out into the air at Shibuya: from its depot in
# the Mark City block it runs east on a concrete viaduct at about the third floor, over the street and the
# old Toyoko site, to the station over Meiji-dori (since January 2020). OSM's line (bridge=viaduct, layer
# 2); the rails' height (12 m over the street), the deck and the piers are estimates. It takes its power
# from a third rail, so no wires run over it.
GINZA = {"name": "東京メトロ銀座線", "rail_m": 12.0, "width_m": 9.0, "deck_m": 2.2, "pier_every_m": 24.0, "x1": 418.0}


def ginza_viaduct(K, D):
    ways = [w for w in D.ways if w["tags"].get("name") == GINZA["name"] and w["tags"].get("bridge") == "viaduct" and w["tags"].get("layer") == "2"
            and len(w["xy"]) > 3]
    if not ways:
        return
    from shapely.geometry import box as sbox
    ln = LineString([tuple(p) for p in max(ways, key=lambda w: len(w["xy"]))["xy"]]).intersection(sbox(300, -1200, GINZA["x1"], -1000))
    if ln.is_empty or ln.geom_type != "LineString":
        return
    g0 = D.ground(360.0, -1090.0)
    zr = g0 + GINZA["rail_m"]
    zt, zb = zr - 0.5, zr - 0.5 - GINZA["deck_m"]
    hw = GINZA["width_m"] / 2
    conc, dark = K["x_jr_concrete"], K["x_jr_wall"]
    bands = road_bands(D)
    pts = [np.asarray(ln.interpolate(s_).coords[0]) for s_ in np.arange(0, ln.length, 3.0)] + [np.asarray(ln.coords[-1])]
    for a, b in zip(pts[:-1], pts[1:]):
        f = unit(b - a)
        l = np.array([-f[1], f[0]])
        L = float(np.linalg.norm(b - a))
        for side in (-1, 1):
            p, q = a + l * hw * side, b + l * hw * side
            p0, q0 = (p, q) if side < 0 else (q, p)
            dark.quad(np.array([*p0, zb]), np.array([*q0, zb]), np.array([*q0, zt + 1.1]), np.array([*p0, zt + 1.1]), [[0, zb], [L, zb], [L, zt + 1.1], [0, zt + 1.1]])
            conc.quad(np.array([*p0, zt + 1.1]), np.array([*q0, zt + 1.1]), np.array([*(q0 - l * side * 0.25), zt + 1.2]), np.array([*(p0 - l * side * 0.25), zt + 1.2]))
        conc.quad(np.array([*(b - l * hw), zb]), np.array([*(a - l * hw), zb]), np.array([*(a + l * hw), zb]), np.array([*(b + l * hw), zb]))     # the soffit
        K["x_ballast"].quad(*[np.array([*x, zt]) for x in (a - l * hw, b - l * hw, b + l * hw, a + l * hw)], [list(x) for x in (a - l * hw, b - l * hw, b + l * hw, a + l * hw)])
    # the two tracks with their third rail; piers where they stand clear of the roads
    for off in (-1.9, 1.9):
        for r in (-0.7175, 0.7175, 1.25 * np.sign(off)):
            path = [np.array([*(p + np.array([-unit(np.asarray(ln.coords[-1]) - np.asarray(ln.coords[0]))[1], unit(np.asarray(ln.coords[-1]) - np.asarray(ln.coords[0]))[0]]) * (off + r)), zt + 0.25])
                    for p in pts]
            K["x_rail_steel"].tube(path, 0.04 if abs(r) < 1 else 0.06, 4)
    for s_ in np.arange(6.0, ln.length, GINZA["pier_every_m"]):
        c = np.asarray(ln.interpolate(s_).coords[0])
        if bands.buffer(1.5).contains(Point(*c)):
            continue
        q = np.asarray(ln.interpolate(min(ln.length, s_ + 1.0)).coords[0])
        P = frame(c, q - c)
        g = D.ground(*c)
        box(conc, P, -0.7, 0.7, -hw + 1.0, hw - 1.0, g, zb, uvm=True)


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
    d.text((w * 0.34, h * 0.46), "FIZZLE", font=f, fill=(255, 255, 255), anchor="mm")
    f = ad.font("zen", int(h * 0.16))
    d.text((w * 0.83, h * 0.5), "爽快、ひと口。", font=f, fill=(255, 236, 236), anchor="mm")
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


# ---------------------------------------------------------------- SHIBUYA109

# SHIBUYA109 (1979, Minoru Takeyama; 8 floors over the ground): an aluminium-clad block in the fork of
# Dogenzaka and Bunkamura-dori, and at its point, facing the scramble, the cylinder (its lift tower),
# which rises over the roof to carry the name. PLATEAU: 33.6 m measured; the cylinder 49.7 m to its top,
# about 11.5 m across in its generalised model; OSM's footprint rounds its point on a 13.7 m circle. It is
# drawn 13 m across, on the footprint's circle. Its front carries a printed advert over most of its height (estimated 23 m
# tall, invented here). The panels' joints and the shopfronts are from photographs (estimates).
S109 = {"osm": "w55895868", "centre": (229.6, -993.0), "r": 6.5, "top_m": 49.7, "roof_m": 33.6, "toward": (369.0, -1000.0),
        "wrap": (13.0, 31.0, 120.0), "crown": (38.5, 48.4)}


def cyl_strip(m, c, r, a0, a1, z0, z1, segs, uv=None, out=True):
    """A band of a cylinder from angle a0 to a1 (radians, counter-clockwise), facing out; uv: (u0, v0, u1, v1) over it, else metres."""
    for k in range(segs):
        t0, t1 = a0 + (a1 - a0) * k / segs, a0 + (a1 - a0) * (k + 1) / segs
        p = lambda a, z: np.array([c[0] + r * math.cos(a), c[1] + r * math.sin(a), z])
        if uv:
            u0, v0, u1, v1 = uv
            q = [[u0 + (u1 - u0) * k / segs, v0], [u0 + (u1 - u0) * (k + 1) / segs, v0], [u0 + (u1 - u0) * (k + 1) / segs, v1], [u0 + (u1 - u0) * k / segs, v1]]
        else:
            q = [[r * t0, z0], [r * t1, z0], [r * t1, z1], [r * t0, z1]]
        if out:
            m.quad(p(t0, z0), p(t1, z0), p(t1, z1), p(t0, z1), q)
        else:
            m.quad(p(t1, z0), p(t0, z0), p(t0, z1), p(t1, z1), q)


def shibuya109(K, A, D):
    sol = [s for s in D.solids if s["osm"] == S109["osm"]]
    if not sol:
        return []
    from shapely.ops import unary_union
    g = min(s["ground"] for s in sol)
    c = np.asarray(S109["centre"])
    r = S109["r"]
    body = unary_union([Polygon(s["ring"]).buffer(0) for s in sol]).buffer(0.2).buffer(-0.2)
    body = max(getattr(body, "geoms", [body]), key=lambda q: q.area)
    body = body.difference(Point(*c).buffer(r - 0.4, 32))   # the block stops at the cylinder
    body = max(getattr(body, "geoms", [body]), key=lambda q: q.area)
    zr = g + S109["roof_m"]
    alu, shop, panel = K["x_alu"], K["x_shop"], K["x_qf_panel"]
    toward = np.asarray(S109["toward"])
    # the block: aluminium walls, shopfronts at the foot of the street faces, a parapet; the roof
    for a, b, n, L in ring_edges(body):
        mid = (a + b) / 2
        if Point(*mid).distance(Point(*c)) < r + 0.3:
            continue                                     # (the cylinder stands there)
        street = len(ring_edges(body)) and L > 2.0
        gz0 = min(D.ground(*a), D.ground(*b))
        z_shop = gz0 + 4.2 if street else gz0
        if street:
            shop.quad(np.array([*a, gz0 - 0.2]), np.array([*b, gz0 - 0.2]), np.array([*b, z_shop]), np.array([*a, z_shop]), [[0, 0], [L, 0], [L, 4.4], [0, 4.4]])
            box(K["x_fin"], frame(a, b - a), 0, L, 0, 0.6, z_shop, z_shop + 0.5)   # the fascia over the shops
        alu.quad(np.array([*a, z_shop]), np.array([*b, z_shop]), np.array([*b, zr + 1.0]), np.array([*a, zr + 1.0]), [[0, z_shop], [L, z_shop], [L, zr + 1.0], [0, zr + 1.0]])
    ak.cap(K["x_qf_roof"], ak.WORLD, [tuple(p) for p in list(body.exterior.coords)[:-1]], zr + 0.2)
    # the cylinder: panels all round, the advert on the face toward the scramble, the crown with the name
    face = math.atan2(*(toward - c)[::-1])
    w0, w1, span = S109["wrap"]
    half = math.radians(span) / 2
    zt = g + S109["top_m"]
    cyl_strip(alu, c, r, face + half, face - half + 2 * math.pi, g + 4.2, zt, 36)
    cyl_strip(alu, c, r, face - half, face + half, g + 4.2, g + w0, 16)
    cyl_strip(alu, c, r, face - half, face + half, g + w1, zt, 16)
    cyl_strip(shop, c, r, 0, 2 * math.pi, g - 0.2, g + 4.2, 32)
    cyl_strip(K["x_fin"], c, r + 0.35, 0, 2 * math.pi, g + 4.2, g + 4.7, 32)
    u0, v0, u1, v1 = A.uv("s109_wrap")
    cyl_strip(K["x_print"], c, r + 0.12, face - half, face + half, g + w0, g + w1, 20, uv=(u0, v0, u1, v1))
    # the frame round the advert, and the lamps that light it from below
    for z in (g + w0 - 0.25, g + w1):
        cyl_strip(K["x_fin"], c, r + 0.3, face - half - 0.03, face + half + 0.03, z, z + 0.25, 20)
    for k in range(9):
        a = face - half + 2 * half * (k + 0.5) / 9
        p = c + (r + 1.0) * np.array([math.cos(a), math.sin(a)])
        box(K["x_light"], frame(p, (math.cos(a), math.sin(a))), -0.2, 0.2, -0.25, 0.25, g + w0 - 0.9, g + w0 - 0.6)
    z0c, z1c = (g + x for x in S109["crown"])
    u0, v0, u1, v1 = A.uv("s109_name")
    cyl_strip(K["x_atlas"], c, r + 0.15, face - 1.0, face + 1.0, z0c, z1c, 16, uv=(u0, v0, u1, v1))
    ak.cap(K["x_qf_roof"], ak.WORLD, [tuple(c + r * np.array([math.cos(a), math.sin(a)])) for a in np.linspace(0, 2 * math.pi, 24, endpoint=False)], zt)
    cyl_strip(K["x_fin"], c, r + 0.2, 0, 2 * math.pi, zt - 0.5, zt + 0.3, 32)
    return [s["si"] for s in sol]


def draw_109(img, rects):
    from PIL import ImageDraw
    x, y, w, h = rects["s109_wrap"]   # an invented fashion campaign: a gradient, a figure, the season's words
    sub = Image_new(w, h, (255, 120, 180))
    ad.gradient(sub, "#ff4fa0", "#ffd0e4", angle=90.0)
    ad.figure(sub, w * 0.5, h * 0.18, h * 0.62, "#3a1c3a", coat=True)
    ad.text(sub, (w * 0.5, h * 0.1), "AW 2026", "anton", int(h * 0.07), fill="#ffffff")
    ad.text(sub, (w * 0.5, h * 0.88), "LUMIÈRE", "bebas", int(h * 0.09), fill="#ffffff")
    ad.text(sub, (w * 0.5, h * 0.95), "ルミエール 新作入荷", "zen", int(h * 0.035), fill="#4a0d2e")
    img.paste(sub, (x, y))
    x, y, w, h = rects["s109_name"]   # the name on the cylinder's silver: a pink 109 in a ring, in words, not its logo
    sub = Image_new(w, h, (186, 190, 195))
    d = ImageDraw.Draw(sub)
    for k in range(0, h, 12):
        d.line([(0, k), (w, k)], fill=(170, 174, 180), width=1)
    r = h * 0.42
    d.ellipse([w / 2 - r, h / 2 - r, w / 2 + r, h / 2 + r], outline=(236, 72, 150), width=int(h * 0.05))
    ad.text(sub, (w / 2, h / 2), "109", "anton", int(h * 0.42), fill="#ec4896", max_w=r * 1.5)
    img.paste(sub, (x, y))


# ---------------------------------------------------------------- Center Gai's gate

# The gate at Center Gai's mouth (since the old arcade sign fell in the typhoon of 1997): a grey steel
# post each side of the street that bends over at the top like a shepherd's crook, a disc lamp at its
# tip, センター街 on the posts, and a banner hung between them (in 2024-25 the street's basketball
# banner: it has been "Basketball Street" since 2011). No dimensions are published: the height and the
# span are estimates from photographs (5.5 m posts, the street's 9 m); the banner is drawn for the model.
def center_gai_gate(K, A, D, c):
    P = frame(c["at"], c["axis"])
    z0, hs = c["z"], c["span_m"] / 2
    grey = K["x_gate"]
    for side in (-1, 1):
        v = side * hs
        grey.tube([P(0, v, z0), P(0, v, z0 + 5.2)], 0.22, 12)
        arc = [P(0, v - side * (1.0 - math.cos(t)) * 1.1, z0 + 5.2 + math.sin(t) * 1.1) for t in np.linspace(0, math.pi * 0.95, 10)]
        grey.tube(arc, 0.18, 10)
        tip = arc[-1]
        K["x_gate"].lathe([(float(tip[2] - 0.35), 0.0), (float(tip[2] - 0.3), 0.5), (float(tip[2] - 0.15), 0.55), (float(tip[2] - 0.05), 0.2)],
                          (float(tip[0]), float(tip[1])), 16)
        K["x_light"].lathe([(float(tip[2] - 0.36), 0.0), (float(tip[2] - 0.355), 0.42)], (float(tip[0]), float(tip[1])), 16)
        # the street's name down each post, on both faces
        for u in (-0.23, 0.23):
            a, b = (P(u, v - 0.16, z0 + 2.6), P(u, v + 0.16, z0 + 2.6)) if u > 0 else (P(u, v + 0.16, z0 + 2.6), P(u, v - 0.16, z0 + 2.6))
            A.quad(K["x_atlas"], a, b, b + [0, 0, 2.2], a + [0, 0, 2.2], "cg_name")
    # the banner on a bar between the posts, each face on the side it faces
    grey.tube([P(0, -hs + 0.2, z0 + 4.75), P(0, hs - 0.2, z0 + 4.75)], 0.05, 6)
    w = 2 * hs - 2.6
    for side in (-1, 1):
        u = side * 0.03
        a, b = (P(u, -w / 2, z0 + 3.55), P(u, w / 2, z0 + 3.55)) if side > 0 else (P(u, w / 2, z0 + 3.55), P(u, -w / 2, z0 + 3.55))
        A.quad(K["x_print"], a, b, b + [0, 0, 1.15], a + [0, 0, 1.15], "cg_banner")


def draw_gate(img, rects):
    from PIL import ImageDraw
    x, y, w, h = rects["cg_banner"]
    sub = Image_new(w, h, (250, 206, 0))
    d = ImageDraw.Draw(sub)
    d.rectangle([0, h * 0.72, w, h], fill=(20, 20, 22))
    ad.text(sub, (w * 0.5, h * 0.38), "BASKETBALL STREET", "anton", int(h * 0.42), fill="#141416", max_w=w * 0.9)
    ad.text(sub, (w * 0.5, h * 0.86), "渋谷センター街  SHIBUYA CENTER-GAI", "zen", int(h * 0.17), fill="#ffd200", max_w=w * 0.9)
    img.paste(sub, (x, y))
    x, y, w, h = rects["cg_name"]
    sub = Image_new(w, h, (118, 122, 128))
    ad.vtext(sub, (w / 2, h * 0.1), "センター街", "zen", int(w * 0.62), fill="#ffffff")
    img.paste(sub, (x, y))


# ---------------------------------------------------------------- the west side's rooftop billboards and sign bands

# What makes the west side read as Shibuya from the scramble is its billboards: box signs stacked on
# steel towers over the roofs and bands of tenants' signs floor over floor. Their places and sizes are
# from photographs (2024-26; the Taiseido block's sign tower is in PLATEAU's LOD2, 5.5 x 5.6 m to 39.4 m
# over the street); the brands are invented, in the kinds the real ones are (a pharmaceutical's two
# boxes, a card company, a furniture store, throat lozenges, a karaoke chain).
BILLBOARDS = [
    # the Taiseido block's tower: three boxes stacked tight (15 cm apart) up to the tower's top at 39.4 m
    {"at": (324.7, -971.6), "face": (372.0, -1030.0), "roof_m": 24.1, "boxes": [("bb_hikari", 11.0, 3.6), ("bb_hikari2", 11.0, 6.2), ("bb_lens", 11.0, 4.0)],
     "gap": 0.15, "lift": 1.0},
    {"at": (306.5, -951.0), "face": (372.0, -1030.0), "roof_m": 24.1, "boxes": [("bb_card", 8.0, 8.0)], "lift": 3.0},
    {"at": (281.0, -952.0), "face": (372.0, -1020.0), "roof_m": 37.8, "boxes": [("bb_home", 10.5, 4.8)], "lift": 2.0},
    {"at": (274.0, -968.0), "face": (372.0, -1020.0), "roof_m": 52.1, "boxes": [("bb_nodo", 12.0, 5.6)], "lift": 1.5},
]
# bands of tenants' signs across a building's face toward the scramble: (building, floors' heights above
# the street, art) -- the Oto building's restaurants and opticians (the bookshop on the corner: BOOKSHOP)
BANDS = [
    {"building": "渋谷駅前ビル", "near": (320.0, -1045.0), "toward": (372.0, -1010.0), "rows": [(8.2, "band_shabu"), (11.6, "band_cafe"), (15.0, "band_megane"),
                                                                                       (18.4, "band_price"), (21.8, "band_clinic")], "w": 0.8},
    {"building": "渋谷駅前ビル", "near": (310.0, -1015.0), "toward": (305.0, -980.0), "rows": [(4.6, "band_karaoke"), (8.2, "band_cafe"), (11.6, "band_shabu"),
                                                                                    (15.0, "band_megane"), (18.4, "band_clinic")], "w": 0.85},
]
# the station-front building's faces on the scramble and on Dogenzaka: a white grid of mullions and
# floor bands over its glass (photographs; its windows' red frames are not drawn)
SKINS = [{"building": "渋谷駅前ビル", "near": (320.0, -1045.0), "toward": (372.0, -1010.0)},
         {"building": "渋谷駅前ビル", "near": (310.0, -1015.0), "toward": (305.0, -980.0)},
         {"building": "渋谷駅前ビル", "near": (310.0, -1015.0), "toward": (350.0, -995.0)}]
BB_ART = {
    "bb_hikari": ("#1d4fa8", "HIKARIDO", "bebas", "#ffffff", None),
    "bb_hikari2": ("#1f9a4c", "ヒカリパス", "zen", "#ffffff", "貼る、すっきり。"),
    "bb_card": ("#ffffff", "NC", "anton", "#1d3c9a", "NOVA CARD"),
    "bb_home": ("#f2c400", "HOMELY", "anton", "#164aa8", "家具と雑貨"),
    "bb_nodo": ("#f06aa0", "のどにハッカ", "zen", "#ffffff", "ハッカ散 ダイレクト"),
    "bb_lens": ("#0b2a6f", "1DAY CLEAR", "anton", "#ffffff", "コンタクト レンズ"),
    "band_shabu": ("#f07a1a", "しゃぶしゃぶ 葉山", "zen", "#ffffff", None),
    "band_cafe": ("#d7262b", "Cafeレストラン ガロ", "zen", "#ffffff", None),
    "band_megane": ("#d42f2f", "メガネ・コンタクト", "zen", "#fff3a0", None),
    "band_price": ("#ffde2a", "チケット プライス", "zen", "#c0141c", None),
    "band_clinic": ("#ffffff", "渋谷駅前クリニック", "zen", "#1d4fa8", None),
    "band_karaoke": ("#e01f26", "カラオケ ONE  2F", "zen", "#ffffff", None),
}


def lit_box(K, A, P, w, h, d, z0, key, frame_mat="x_jr_steel"):
    """A box sign, its face toward +u in frame P, lit from inside; steel at the back and sides."""
    box(K[frame_mat], P, -d, 0.0, -w / 2, w / 2, z0, z0 + h)
    A.quad(K["x_atlas"], P(0.02, -w / 2, z0), P(0.02, w / 2, z0), P(0.02, w / 2, z0 + h), P(0.02, -w / 2, z0 + h), key)


def billboards(K, A, D):
    steel = K["x_jr_steel"]
    for b in BILLBOARDS:
        at, face = np.asarray(b["at"]), np.asarray(b["face"])
        P = frame(at, face - at)
        g = D.ground(*at)
        z = g + b["roof_m"] + b.get("lift", 0.0)
        hs = sum(h for _, _, h in b["boxes"]) + b.get("gap", 0.0) * (len(b["boxes"]) - 1)
        w = max(w for _, w, _ in b["boxes"])
        # the tower: legs, cross-bracing, a catwalk under the lowest box
        for v in (-w * 0.35, w * 0.35):
            for u in (-1.6, -0.5):
                steel.tube([P(u, v, g + b["roof_m"]), P(u, v, z + hs)], 0.09, 6)
            steel.tube([P(-1.6, v, g + b["roof_m"]), P(-0.5, v, z + hs * 0.5)], 0.05, 4)
        box(steel, P, -1.8, 0.6, -w / 2, w / 2, z - 0.15, z - 0.05)
        K["x_wire"].tube([P(0.6, -w / 2, z + 1.0), P(0.6, w / 2, z + 1.0)], 0.02, 4)   # the catwalk's rail
        zz = z + hs
        for key, bw, bh in b["boxes"]:
            zz -= bh
            lit_box(K, A, P, bw, bh, 0.6, zz, key)
            zz -= b.get("gap", 0.0)


def skins(K, D):
    import screens as sc_
    for b in SKINS:
        mid, n, L, z0, z1 = sc_.facade("shibuya", b["building"], b["toward"], near=b.get("near"))
        t = np.array([-n[1], n[0]])
        a, c = mid - t * L / 2 + n * 0.12, mid + t * L / 2 + n * 0.12
        zt = z1 - 0.3
        K["x_skin"].quad(np.array([*a, z0 + 4.0]), np.array([*c, z0 + 4.0]), np.array([*c, zt]), np.array([*a, zt]), [[0, 4.0], [L, 4.0], [L, zt - z0], [0, zt - z0]])


def sign_bands(K, A, D):
    import screens as sc_
    for b in BANDS:
        mid, n, L, z0, z1 = sc_.facade("shibuya", b["building"], b["toward"], near=b.get("near"))
        P = frame(mid + n * 0.5, n)        # (standing out from the wall, in front of its skin)
        w = L * b["w"]
        for z, key in b["rows"]:
            if z0 + z + 1.2 > z1:
                continue
            lit_box(K, A, P, w, 1.15, 0.35, z0 + z, key)


def draw_billboards(img, rects):
    from PIL import ImageDraw
    for key, (bg, word, face, fg, sub_) in BB_ART.items():
        x, y, w, h = rects[key]
        im = Image_new(w, h, ad.rgb(bg))
        d = ImageDraw.Draw(im)
        d.rectangle([3, 3, w - 4, h - 4], outline=tuple(max(0, c - 40) for c in ad.rgb(bg)), width=4)
        if key == "bb_card":
            d.ellipse([w * 0.18, h * 0.1, w * 0.82, h * 0.74], fill=(29, 60, 154))
            ad.text(im, (w / 2, h * 0.42), word, face, int(h * 0.34), fill="#ffffff")
            ad.text(im, (w / 2, h * 0.87), sub_, "bebas", int(h * 0.16), fill=fg)
        elif sub_:
            ad.text(im, (w / 2, h * 0.4), word, face, int(h * 0.44), fill=fg, max_w=w * 0.9)
            ad.text(im, (w / 2, h * 0.8), sub_, "zen", int(h * 0.18), fill=fg, max_w=w * 0.9)
        else:
            ad.text(im, (w / 2, h * 0.52), word, face, int(h * 0.62), fill=fg, max_w=w * 0.92)
        img.paste(im, (x, y))


# ---------------------------------------------------------------- MAGNET by SHIBUYA109's front

# MAGNET's corner on the scramble (1987, as 109-2; MAGNET since 2018): a glazed shopfront under a silver
# fascia that slopes out over the pavement, its name on it in red serif letters (photographs, 2025). The
# fascia's height and slope are estimates.
MAGNET = {"name": "MAGNET SHIBUYA", "faces": [((387.8, -979.0), (394.9, -988.2)), ((394.9, -988.2), (405.0, -988.7)), ((390.6, -965.0), (387.8, -979.0))],
          "z": (4.4, 6.9), "out": 1.3}


def magnet_front(K, A, D):
    panel = K["x_qf_panel"]
    for k, (a, b) in enumerate(MAGNET["faces"]):
        a, b = np.asarray(a, float), np.asarray(b, float)
        L = float(np.linalg.norm(b - a))
        f = (b - a) / L
        n = np.array([-f[1], f[0]])                     # out, toward the street (the faces run clockwise round the corner)
        if n @ (np.array([368.7, -1000.6]) - (a + b) / 2) < 0:
            n = -n
        g = min(D.ground(*a), D.ground(*b))
        z0, z1 = g + MAGNET["z"][0], g + MAGNET["z"][1]
        o = MAGNET["out"]
        K["x_shop"].quad(np.array([*(a + n * 0.05), g - 0.1]), np.array([*(b + n * 0.05), g - 0.1]), np.array([*(b + n * 0.05), z0]), np.array([*(a + n * 0.05), z0]),
                         [[0, 0], [L, 0], [L, z0 - g + 0.1], [0, z0 - g + 0.1]])
        # the sloping fascia: from its foot out over the pavement up to the wall, its soffit lit
        lo_a, lo_b = a + n * o, b + n * o
        if n @ np.array([-f[1], f[0]]) > 0:
            quad = (np.array([*lo_a, z0]), np.array([*lo_b, z0]), np.array([*b, z1]), np.array([*a, z1]))
        else:
            quad = (np.array([*lo_b, z0]), np.array([*lo_a, z0]), np.array([*a, z1]), np.array([*b, z1]))
        panel.quad(*quad)
        panel.quad(np.array([*a, z0 - 0.02]), np.array([*b, z0 - 0.02]), np.array([*lo_b, z0 - 0.02]), np.array([*lo_a, z0 - 0.02]))
        K["x_light"].quad(np.array([*(a + n * (o - 0.3)), z0 - 0.03]), np.array([*(b + n * (o - 0.3)), z0 - 0.03]), np.array([*(b + n * (o - 0.45)), z0 - 0.03]),
                          np.array([*(a + n * (o - 0.45)), z0 - 0.03]))
        if k == 0:   # the name on the corner's fascia, read from the scramble
            c0, c1 = (lo_a + a) / 2, (lo_b + b) / 2
            t = c1 - c0
            m0, m1 = c0 + t * 0.08 + n * 0.03, c0 + t * 0.92 + n * 0.03
            p0, p1 = m0 + n * 0.4, m1 + n * 0.4
            pts = (np.array([*p0, z0 + 0.55]), np.array([*p1, z0 + 0.55]), np.array([*(m1 - n * 0.4), z1 - 0.45]), np.array([*(m0 - n * 0.4), z1 - 0.45]))
            nrm = np.cross(pts[1] - pts[0], pts[3] - pts[0])
            if nrm @ np.array([*n, 0.5]) < 0:              # face it out, so it reads left to right from the street
                pts = (pts[1], pts[0], pts[3], pts[2])
            A.quad(K["x_atlas"], *pts, "magnet_name")


def draw_magnet(img, rects):
    x, y, w, h = rects["magnet_name"]
    im = Image_new(w, h, (206, 210, 214))
    ad.text(im, (w * 0.42, h * 0.5), "MAGNET", "mincho", int(h * 0.7), fill="#d01e2a")
    ad.text(im, (w * 0.86, h * 0.56), "by SHIBUYA109", "mincho", int(h * 0.2), fill="#d01e2a")
    img.paste(im, (x, y))


# ---------------------------------------------------------------- the bookshop on Center Gai's corner

# On the corner where Center Gai meets the scramble stands a bookshop that has been there since 1912, in a
# narrow building at the south-east corner of the block (OSM's w136690966 is the whole block). Its front
# is the corner's chamfer, facing the crossing, and a few metres of the side on the street to the south:
# white clapboard to the first floor, the shop window and door on the chamfer under a blue awning with the
# shop's name in white, and over them a big white box sign, lit from inside, wrapping round the corner:
# the name in heavy blue characters inside a red outline of an open book, the romanised name in red
# under it, a blue edge along its foot (photographs 2021-24). The name is invented in the real one's
# pattern -- five characters, □□堂書店, set the same way in the same colours -- not the real shop's.
# Sizes from photographs, scaled from the door: the awning at 3.0-3.45 m, the sign 3.6-6.9 m.
BOOKSHOP = {"a": (323.6, -975.2), "b": (329.9, -969.4), "south_from": (295.4, -978.2), "return_m": 3.4,
            "name": ("大昇", "堂書店"), "roman": "BOOKS TAISHODO", "awning": "TAISHODO",
            "sign_z": (3.6, 6.9), "sign_off": 0.75, "awning_z": (3.0, 3.45), "awning_out": 1.15}


def _offset_corner(a, n1, f1, n2, f2, off):
    """Where the two faces' lines, each moved `off` out along its normal, meet (the sign's mitre)."""
    p, q = a + n1 * off, a + n2 * off
    M = np.array([f1, -f2]).T
    t = np.linalg.solve(M, q - p)
    return p + f1 * t[0]


def bookshop(K, A, D):
    """The corner bookshop: clapboard, shop window, awning and the wrapping box sign (BOOKSHOP)."""
    B = BOOKSHOP
    a, b, s0 = (np.asarray(B[k], float) for k in ("a", "b", "south_from"))
    f1 = unit(b - a)                       # along the chamfer, from the south corner to Center Gai's
    n1 = np.array([f1[1], -f1[0]])         # its outward normal (the crossing)
    f2 = unit(a - s0)                      # along the south face, toward the corner
    n2 = np.array([f2[1], -f2[0]])         # its outward normal (the street to the south)
    Lc, Lr = float(np.linalg.norm(b - a)), B["return_m"]
    r0 = a - f2 * Lr                       # where the shop's front starts on the south face
    g = min(D.ground(*a), D.ground(*b), D.ground(*r0))

    def face(p, q, n, off, z0, z1, m, uvm=True):
        p, q = p + n * off, q + n * off
        L = float(np.linalg.norm(q - p))
        m.quad(np.array([*p, z0]), np.array([*q, z0]), np.array([*q, z1]), np.array([*p, z1]),
               [[0, z0 - g], [L, z0 - g], [L, z1 - g], [0, z1 - g]] if uvm else None)

    za0, za1 = (g + z for z in B["awning_z"])
    # the ground floor: clapboard, the window and door on the chamfer, a display window on the side
    face(r0, a, n2, 0.12, g, za1, K["x_clap"])
    face(a, b, n1, 0.12, g, za1, K["x_clap"])
    for p, q, n, inset in ((a, b, n1, 1.1), (r0, a, n2, 0.6)):
        ff = unit(q - p)
        pp, qq = p + ff * inset, q - ff * (inset if n is n1 else 1.4)
        face(pp, qq, n, 0.14, g + (0.03 if n is n1 else 0.7), g + 2.55, K["x_shop"])
        P = frame(pp + n * 0.14, n)
        Lw = float(np.linalg.norm(qq - pp))
        for v in np.linspace(0, Lw, max(2, int(Lw / 1.5)) + 1):     # mullions
            box(K["x_frame"], P, 0.0, 0.05, v - 0.03, v + 0.03, g + (0.03 if n is n1 else 0.7), g + 2.55)
        box(K["x_frame"], P, 0.0, 0.05, 0.0, Lw, g + 2.55, g + 2.66)
    # the awning: sloping out from the wall, its front valance carrying the name in white
    for p, q, n in ((r0, a, n2), (a, b, n1)):
        out = B["awning_out"]
        pa, qa = p + n * 0.12, q + n * 0.12
        po, qo = pa + n * out, qa + n * out
        K["x_bk_blue"].quad(np.array([*pa, za1]), np.array([*po, za0 + 0.25]), np.array([*qo, za0 + 0.25]), np.array([*qa, za1]))
        K["x_bk_blue"].quad(np.array([*qa, za1 - 0.02]), np.array([*qo, za0 + 0.23]), np.array([*po, za0 + 0.23]), np.array([*pa, za1 - 0.02]))
        if n is n1:
            A.quad(K["x_atlas"], np.array([*po, za0]), np.array([*qo, za0]), np.array([*qo, za0 + 0.25]), np.array([*po, za0 + 0.25]), "bk_awning")
        else:
            K["x_bk_blue"].quad(np.array([*po, za0]), np.array([*qo, za0]), np.array([*qo, za0 + 0.25]), np.array([*po, za0 + 0.25]))
    # the sign box round the corner: its face (one image across both faces), top, foot and ends
    zs0, zs1 = (g + z for z in B["sign_z"])
    off = B["sign_off"]
    c = _offset_corner(a, n1, f1, n2, f2, off)
    s_start, s_end = r0 + n2 * off, b + n1 * off + f1 * 0.2
    L1, L2 = float(np.linalg.norm(c - s_start)), float(np.linalg.norm(s_end - c))
    u0, v0, u1, v1 = A.uv("bk_sign")
    um = u0 + (u1 - u0) * L1 / (L1 + L2)
    zb = zs0 + 0.16                         # (the blue edge along its foot)
    K["x_atlas"].quad(np.array([*s_start, zb]), np.array([*c, zb]), np.array([*c, zs1]), np.array([*s_start, zs1]), [[u0, v0], [um, v0], [um, v1], [u0, v1]])
    K["x_atlas"].quad(np.array([*c, zb]), np.array([*s_end, zb]), np.array([*s_end, zs1]), np.array([*c, zs1]), [[um, v0], [u1, v0], [u1, v1], [um, v1]])
    for p, q in ((s_start, c), (c, s_end)):
        K["x_bk_blue"].quad(np.array([*p, zs0]), np.array([*q, zs0]), np.array([*q, zb]), np.array([*p, zb]))
    wall_s, wall_e = r0 + n2 * 0.1, b + n1 * 0.1 + f1 * 0.2
    wall_c = _offset_corner(a, n1, f1, n2, f2, 0.1)
    for z, up in ((zs1, True), (zs0, False)):      # its top and its underside: a band bent round the corner
        for quad in ((wall_s, s_start, c, wall_c), (wall_c, c, s_end, wall_e)):
            for tri in ((quad[0], quad[1], quad[2]), (quad[0], quad[2], quad[3])):
                pts = [np.array([*p, z]) for p in tri]
                nz = np.cross(pts[1] - pts[0], pts[2] - pts[0])[2]
                K["x_bk_box"].tri(*(pts if (nz > 0) == up else pts[::-1]))
    for p, q in ((wall_s, s_start), (s_end, wall_e)):  # its ends
        K["x_bk_box"].quad(np.array([*p, zs0]), np.array([*q, zs0]), np.array([*q, zs1]), np.array([*p, zs1]))
        K["x_bk_box"].quad(np.array([*q, zs0]), np.array([*p, zs0]), np.array([*p, zs1]), np.array([*q, zs1]))


def draw_bookshop(img, rects):
    from PIL import ImageDraw
    x, y, w, h = rects["bk_sign"]
    B = BOOKSHOP
    a, b, s0 = (np.asarray(B[k], float) for k in ("a", "b", "south_from"))
    Lc = float(np.linalg.norm(b - a)) + 0.2 + 0.5
    split = int(w * (B["return_m"] + 0.5) / (B["return_m"] + 0.5 + Lc))
    im = Image_new(w, h, (250, 250, 247))
    d = ImageDraw.Draw(im)
    red, blue = (214, 40, 40), (24, 56, 190)
    # the open book: a red outline, its pages' top edges dipping to the spine at the corner (the side face
    # carries its left page, the front its right)
    lw = max(6, h // 40)
    top, bot = h * 0.1, h * 0.86
    spine = split                           # at the corner, where the box turns
    pts_top = [(lw, top + h * 0.06), (spine * 0.5, top), (spine, top + h * 0.1), (spine + (w - spine) * 0.5, top), (w - lw, top + h * 0.06)]
    d.line(pts_top, fill=red, width=lw, joint="curve")
    d.line([(lw, top + h * 0.06), (lw, bot)], fill=red, width=lw)
    d.line([(lw, bot), (spine, bot + h * 0.04), (w * 0.74, bot)], fill=red, width=lw)
    d.line([(spine, top + h * 0.1), (spine, bot + h * 0.04)], fill=red, width=max(3, lw // 2))
    # the name: two characters on the side, three on the front
    left, right = B["name"]
    sz = int(h * 0.62)
    for k, ch in enumerate(left):
        ad.text(im, (split * (k + 0.5) / len(left), h * 0.5), ch, "zen", min(sz, int(split / len(left) * 0.92)), fill="#1838be")
    span = (w - split) * 0.96
    for k, ch in enumerate(right):
        ad.text(im, (split + span * (k + 0.42) / len(right), h * 0.44), ch, "zen", sz, fill="#1838be")
    ad.text(im, (w * 0.86, h * 0.8), B["roman"], "anton", int(h * 0.13), fill="#d42a2a")
    img.paste(im, (x, y))
    x, y, w, h = rects["bk_awning"]
    im = Image_new(w, h, (31, 69, 168))
    ad.text(im, (w * 0.5, h * 0.52), B["awning"], "anton", int(h * 0.74), fill="#ffffff", spacing=int(h * 0.1))
    img.paste(im, (x, y))


# ---------------------------------------------------------------- the JR station's Hachiko side

# OSM maps JR Shibuya station's whole outline as one 15 m building, which the generic styles drew as a
# yellow stone palace. Its Hachiko side is a works site in 2024-26 (the station's rebuilding): pale
# panel walls over the concourse, hoardings at the foot, and over them steel scaffolds that carry huge
# adverts facing the square (photographs 2024-25). Drawn so on OSM's outline, its height kept, with the
# koban's corner left open; the advert is invented.
STATION = {"osm": "w904652357", "billboard": {"a": (407.9, -1022.5), "b": (411.4, -1052.0), "z": (8.0, 19.5), "lift": 1.5}}


def station(K, A, D, koban_box):
    sol = [s for s in D.solids if s["osm"] == STATION["osm"]]
    if not sol:
        return []
    wall, hoard = K["x_station"], K["x_print"]
    for q in sol:
        O = Polygon(q["ring"]).buffer(0)
        if koban_box is not None:
            O = O.difference(koban_box.buffer(0.4, join_style=2))
        if O.is_empty:
            continue
        O = max(getattr(O, "geoms", [O]), key=lambda p_: p_.area)
        zt = q["ground"] + q["base"] + q["top"] if q["base"] < q["top"] else q["ground"] + q["top"]
        zt = q["ground"] + q["top"]
        for a, b, n, L in ring_edges(O):
            g = min(D.ground(*a), D.ground(*b))
            wall.quad(np.array([*a, g]), np.array([*b, g]), np.array([*b, zt]), np.array([*a, zt]), [[0, g], [L, g], [L, zt], [0, zt]])
            if n[0] < -0.5 and L > 3.0 and q["top"] < 16:      # the side on Hachiko Square: a hoarding along its foot
                off = a + n * 0.08, b + n * 0.08
                u0, v0, u1, v1 = A.uv("st_hoarding")
                reps = max(1, int(round(L / 9.0)))
                for k in range(reps):
                    p, r_ = off[0] + (off[1] - off[0]) * k / reps, off[0] + (off[1] - off[0]) * (k + 1) / reps
                    hoard.quad(np.array([*p, g]), np.array([*r_, g]), np.array([*r_, g + 3.0]), np.array([*p, g + 3.0]), [[u0, v0], [u1, v0], [u1, v1], [u0, v1]])
        ak.cap(K["x_qf_roof"], ak.WORLD, [tuple(p) for p in list(O.exterior.coords)[:-1]], zt)
    # the scaffold over the square and its advert
    bb = STATION["billboard"]
    a, b = np.asarray(bb["a"]), np.asarray(bb["b"])
    f = unit(b - a)
    n = np.array([-f[1], f[0]])
    if n[0] > 0:
        n = -n
    g = D.ground(*a)
    z0, z1 = g + bb["z"][0], g + bb["z"][1]
    lift = bb["lift"]
    steel = K["x_jr_steel"]
    L = float(np.linalg.norm(b - a))
    for k in range(int(L // 3.0) + 1):
        p = a + f * min(L, k * 3.0)
        for d in (0.3, 1.5):
            q = p + n * d
            steel.tube([np.array([*q, g + 3.0]), np.array([*q, z1 + 0.6])], 0.05, 4)
    for z in np.arange(g + 3.0, z1 + 0.7, 2.0):
        for d in (0.3, 1.5):
            steel.tube([np.array([*(a + n * d), z]), np.array([*(b + n * d), z])], 0.04, 4)
    q0, q1 = a + n * (lift + 0.05), b + n * (lift + 0.05)
    pts = [np.array([*q0, z0]), np.array([*q1, z0]), np.array([*q1, z1]), np.array([*q0, z1])]
    if np.cross(pts[1] - pts[0], pts[3] - pts[0]) @ np.array([*n, 0]) < 0:
        pts = [pts[1], pts[0], pts[3], pts[2]]
    A.quad(K["x_print"], *pts, "st_billboard")
    for k in range(6):      # its lamps, on arms over the top
        p = a + f * L * (k + 0.5) / 6 + n * (lift + 1.4)
        box(K["x_light"], frame(p, n), -0.25, 0.25, -0.3, 0.3, z1 + 0.4, z1 + 0.7)
    return [q["si"] for q in sol]


def draw_jr(img, rects):
    from PIL import ImageDraw
    x, y, w, h = rects["jr_clear"]
    im = Image_new(w, h, (245, 245, 240))
    d = ImageDraw.Draw(im)
    d.rectangle([3, 3, w - 4, h - 4], outline=(30, 60, 150), width=5)
    ad.text(im, (w * 0.3, h * 0.5), "高さ制限", "zen", int(h * 0.36), fill="#1e3c96")
    ad.text(im, (w * 0.74, h * 0.52), "4.5m", "anton", int(h * 0.6), fill="#1e3c96")
    img.paste(im, (x, y))


def draw_station(img, rects):
    from PIL import ImageDraw
    x, y, w, h = rects["st_billboard"]          # an invented game, in the way the station's scaffold adverts run
    im = Image_new(w, h, (90, 170, 235))
    ad.gradient(im, "#3a8fe0", "#bfe6ff", angle=90.0)
    d = ImageDraw.Draw(im)
    d.ellipse([w * 0.52, h * 0.12, w * 0.92, h * 1.15], fill=(255, 150, 40))
    d.ellipse([w * 0.62, h * 0.25, w * 0.72, h * 0.4], fill=(255, 255, 255))
    ad.text(im, (w * 0.28, h * 0.36), "SKYTAIL", "anton", int(h * 0.26), fill="#ffffff")
    ad.text(im, (w * 0.28, h * 0.62), "LEGENDS", "bebas", int(h * 0.16), fill="#0d2b55")
    ad.text(im, (w * 0.28, h * 0.84), "新作 好評発売中", "zen", int(h * 0.1), fill="#0d2b55")
    img.paste(im, (x, y))
    x, y, w, h = rects["st_hoarding"]
    im = Image_new(w, h, (238, 240, 242))
    d = ImageDraw.Draw(im)
    d.rectangle([0, h * 0.82, w, h], fill=(22, 90, 60))
    ad.text(im, (w * 0.5, h * 0.35), "渋谷駅 改良工事", "zen", int(h * 0.2), fill="#1a3c2a")
    ad.text(im, (w * 0.5, h * 0.6), "ご不便をおかけしております  Station works in progress", "zen", int(h * 0.08), fill="#4a5560", max_w=w * 0.9)
    img.paste(im, (x, y))


# ---------------------------------------------------------------- the koban

# 渋谷警察署渋谷駅前交番, the police box on Hachiko Square's north edge (OSM's node), facing the scramble.
# (The owl-eyed koban of 1985 is Udagawa's, at Center Gai's far end.) Its form here is a Tokyo koban's: two
# storeys of pale tile, a glazed front under a canopy, KOBAN and its name over the door and the red lamp
# that burns all night; the size is an estimate from photographs (6.4 x 4.6 m, 6.6 m high).
KOBAN = {"name": "渋谷警察署渋谷駅前交番", "w": 6.4, "d": 4.6, "h": 6.6}


def koban(K, A, D, node):
    n = next((n for n in D.nodes if n["tags"].get("amenity") == "police" and n["tags"].get("name") == KOBAN["name"]), None)
    if n is None:
        return None
    at = n["xy"]
    f = unit(np.asarray(node) - at)
    P = frame(at, f)
    g = D.ground(*at)
    hw, hd, h = KOBAN["w"] / 2, KOBAN["d"] / 2, KOBAN["h"]
    tile, glass, dark = K["x_koban"], K["x_qf_glass"], K["x_frame"]
    box(tile, P, -hd, hd - 0.6, -hw, hw, g, g + h, uvm=True)                     # the body, its front set back under the canopy
    box(dark, P, hd - 0.6, hd - 0.55, -hw + 0.4, hw - 0.4, g, g + 2.9)            # the glazed front's frame
    box(K["x_shop"], P, hd - 0.56, hd - 0.5, -hw + 0.5, hw - 0.5, g + 0.05, g + 2.8, uvm=True)
    box(tile, P, hd - 0.6, hd + 0.5, -hw - 0.2, hw + 0.2, g + 3.0, g + 3.35)    # the canopy
    K["x_light"].quad(P(hd + 0.2, hw - 0.3, g + 2.99), P(hd + 0.2, -hw + 0.3, g + 2.99), P(hd - 0.2, -hw + 0.3, g + 2.99), P(hd - 0.2, hw - 0.3, g + 2.99))
    A.quad(K["x_atlas"], P(hd + 0.51, -2.4, g + 3.4), P(hd + 0.51, 2.4, g + 3.4), P(hd + 0.51, 2.4, g + 4.35), P(hd + 0.51, -2.4, g + 4.35), "koban_sign")
    K["x_red_lamp"].lathe([(g + 4.55, 0.0), (g + 4.6, 0.2), (g + 4.85, 0.24), (g + 5.1, 0.2), (g + 5.15, 0.0)], (float(P(hd - 0.3, 0, 0)[0]), float(P(hd - 0.3, 0, 0)[1])), 14)
    for v in (-1.6, 1.6):                                                        # windows on the upper floor
        box(glass, P, hd - 0.62, hd - 0.58, v - 1.0, v + 1.0, g + 4.4, g + 5.8)
    ak.cap(K["x_qf_roof"], ak.WORLD, [tuple(P(u, v, 0)[:2]) for u, v in ((-hd, -hw), (hd - 0.6, -hw), (hd - 0.6, hw), (-hd, hw))], g + h + 0.01)
    return Polygon([tuple(P(u, v, 0)[:2]) for u, v in ((-hd, -hw), (hd + 0.5, -hw), (hd + 0.5, hw), (-hd, hw))])


def draw_koban(img, rects):
    x, y, w, h = rects["koban_sign"]
    im = Image_new(w, h, (246, 246, 242))
    ad.text(im, (w / 2, h * 0.36), "KOBAN", "bebas", int(h * 0.5), fill="#1a2a6a")
    ad.text(im, (w / 2, h * 0.8), "渋谷駅前交番", "zen", int(h * 0.26), fill="#1a2a6a")
    img.paste(im, (x, y))


# ---------------------------------------------------------------- the module's hooks (city.py)

class Build:
    """What the scramble adds to the Shibuya map's landmarks: meshes, solids it draws instead, ground clips."""

    def __init__(self, city_id, node, lm=None):
        self.lm = lm or {}
        self.D = Data(city_id)
        self.node = np.asarray(node, float)
        self.entrances = entrance_sites(self.D, self.node)
        items = [(f"exit_{e['ref']}", 512, 96) for e in self.entrances] + [("exit_side", 1024, 64)]
        for b in BILLBOARDS:
            items += [(k, int(min(512, 96 * w / h)) if w >= h else 128, 96 if w >= h else int(128 * h / w)) for k, w, h in b["boxes"]]
        items += [(k, 768, 76) for b in BANDS for _, k in b["rows"]]
        items += [("jr_clear", 384, 96), ("st_billboard", 1024, 480), ("st_hoarding", 512, 160), ("magnet_name", 768, 112), ("koban_sign", 384, 76), ("s109_wrap", 512, 768), ("s109_name", 512, 384), ("cg_banner", 768, 160), ("cg_name", 64, 384)]
        items += [("qf_crown", 1024, 320), ("qf_name", 384, 52), ("qf_starbucks", 768, 92), ("qf_tsutaya", 512, 84)]
        items += [("bk_sign", 1600, 400), ("bk_awning", 768, 48)]
        items += streets.atlas_items()
        self.A = Atlas(list(dict.fromkeys(items)), width=2048)

    def meshes(self):
        K = ak.Kit("scramble", floodlit=LIT, uv={k for k, m in MATERIALS.items() if "map" in m or "pattern" in m})
        clip, hidden = [], []
        crosswalks(K, self.D, self.node)
        jr_lines(K, self.A, self.D)
        ginza_viaduct(K, self.D)
        hidden += qfront(K, self.A, self.D)
        hidden += shibuya109(K, self.A, self.D)
        billboards(K, self.A, self.D)
        kb = koban(K, self.A, self.D, self.node)
        hidden += station(K, self.A, self.D, kb)
        magnet_front(K, self.A, self.D)
        skins(K, self.D)
        sign_bands(K, self.A, self.D)
        bookshop(K, self.A, self.D)
        streets.build(K, self.A, self.D)
        if "center_gai" in self.lm:
            center_gai_gate(K, self.A, self.D, self.lm["center_gai"])
        for e in self.entrances:
            clip.append({"ring": entrance(K, self.A, e)})
            hidden.append(e["si"])
        return K.out(), hidden, clip, getattr(self.D, "props", [])

    def draw(self, out_dir):
        from PIL import Image
        img = Image.new("RGB", (self.A.W, self.A.H), (30, 32, 36))
        for e in self.entrances:
            draw_exit(img, self.A.rects[f"exit_{e['ref']}"], e["ref"], e["name"])
        draw_side(img, self.A.rects["exit_side"])
        draw_qfront(img, self.A.rects)
        draw_109(img, self.A.rects)
        draw_gate(img, self.A.rects)
        draw_billboards(img, self.A.rects)
        draw_koban(img, self.A.rects)
        draw_magnet(img, self.A.rects)
        draw_bookshop(img, self.A.rects)
        streets.draw(img, self.A.rects)
        draw_station(img, self.A.rects)
        draw_jr(img, self.A.rects)
        img.save(os.path.join(out_dir, ATLAS_FILE), quality=90)
        return ATLAS_FILE
