"""Interiors you walk into in Queenstown (issue 315, from 286): St Peter's Anglican Church, Williams Cottage and the
Skyline restaurant on Bob's Peak.

Each is drawn inside its landmark's shell (heritage.py, city.py) in the same frame, with the shell's walls opened
where its door is. The game walks each room's floor as a strip (game_surfaces), its walls and furniture stop a
walker as any landmark mesh does (web/game/nav.js), its door's leaves open as someone comes up (game.json "doors",
web/game/doors.js; the leaves are not walls), and its name shows as you step in ("interiors"). The furnishings are
drawn within FAR metres of the camera (nearer on a small device, web/world.js), the shell and its lit windows at
every distance. Inside, what the open sky lights is cut to a share (Mesh.sky) with the warm floor's colour coming
back up, and after dark the walls, the floors and the lamps glow warm (floodlit materials): night.js's pools are the
street's, and on a room's floor they read as orange floodlight.

  St Peter's  (J. McDowall Smith, 1932) a nave and a narrower chancel up two steps, the walls lined in pale
              lime plaster with the lancets' freestone reveals, an open boarded roof on arch-braced rimu trusses,
              two blocks of rimu pews on a red runner, a stone font by the door, the pulpit and the brass lectern
              at the chancel arch, choir stalls, the communion rail and the altar under the east window (the Call
              of St Peter). The plan, the windows and the levels are the shell's (LiDAR and the Heritage NZ
              listing); the fittings are as a parish church of its date has them and as visitors' photographs show
              the arrangement (the pews either side of a middle aisle, the timber roof, the altar under the east
              window): no measured survey of the inside is published, so the fittings' sizes are typical ones.
  Williams Cottage  (1864) the front room under the high gable, a shop now, and the lean-to behind: boarded
              floor, a painted board dado with paper above, a matchlined ceiling, the schist fireplace in the
              chimney between them, shelves and display tables, the counter at the lean-to's door.
  Skyline restaurant  the dining room behind the deck, at the deck's level (474.6 m): floor-to-ceiling glass to
              the deck and the lake (Skyline's own description: floor-to-ceiling windows over Queenstown, the lake
              and the Remarkables), automatic sliding doors onto the deck, oak floor, a slatted timber ceiling with
              pendants, tables for four along the glass and round tables behind, the buffet and the bar at the
              back against a schist wall. Its size is the deck's span and the LiDAR's terrace behind it (massing.json
              tier 14, its roof at 478.5 m); the layout is a typical one, as no plan of the room is published.
"""
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), "pipeline"))
import archkit as ak  # noqa: E402
from meshkit import Mesh  # noqa: E402

FAR = 110   # the furnishings are drawn within this many metres (a pew at 110 m is a pixel or two)

MATERIALS = {
    # inside the church: lime plaster (warm after dark: the pendants on it), rimu, boards, the chancel's tiles
    "int_plaster": {"color": "#e9e1cf", "roughness": 0.92, "metalness": 0.0, "emissive": "#ffd6a0", "glow": 0.16},
    "int_rimu": {"color": "#6a3920", "roughness": 0.55, "metalness": 0.0, "emissive": "#ffc98a", "glow": 0.07},
    "int_rimu_board": {"color": "#7a4a2e", "roughness": 0.6, "metalness": 0.0, "pattern": "granite", "joints_m": [4.8, 0.14],
                       "emissive": "#ffc98a", "glow": 0.08},
    "int_boards": {"color": "#94653f", "roughness": 0.62, "metalness": 0.0, "pattern": "granite", "joints_m": [3.6, 0.15], "emissive": "#ffcf98", "glow": 0.07},
    "int_tiles": {"color": "#9a4a33", "roughness": 0.45, "metalness": 0.0, "pattern": "granite", "joints_m": [0.15, 0.15], "emissive": "#ffcf98", "glow": 0.07},
    "int_runner": {"color": "#7c2226", "roughness": 1.0, "metalness": 0.0, "emissive": "#ffcf98", "glow": 0.07},
    "int_stone": {"color": "#cdbf9c", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffd6a0", "glow": 0.12},
    "int_brass": {"color": "#c09347", "roughness": 0.3, "metalness": 0.9},
    "int_linen": {"color": "#f0ebe0", "roughness": 0.9, "metalness": 0.0},
    "int_kneeler": {"color": "#3c4d3a", "roughness": 1.0, "metalness": 0.0},
    # what lights a room: the lamps' glass, warm and on by day as well (glow_day), the stained glass lit from outside
    "int_lamp": {"color": "#f6e7c8", "roughness": 0.4, "metalness": 0.0, "emissive": "#ffcf8f", "glow": 2.0, "glow_day": 0.6},
    "stp_glass_in": {"color": "#c69a5a", "roughness": 0.2, "metalness": 0.0, "emissive": "#ffd28e", "glow": 0.55, "glow_day": 1.25},
    "stp_glass_blue": {"color": "#4f6d9a", "roughness": 0.2, "metalness": 0.0, "emissive": "#9db8ff", "glow": 0.35, "glow_day": 1.1},
    "int_ember": {"color": "#3a1a0c", "roughness": 0.9, "metalness": 0.0, "emissive": "#ff7a2a", "glow": 1.4, "glow_day": 0.9},
    "int_soot": {"color": "#1b1714", "roughness": 0.95, "metalness": 0.0},
    # what opens: the doors' leaves are not walls (web/game/nav.js), the doorway is
    "stp_door": {"color": "#5b3a24", "roughness": 0.7, "metalness": 0.0, "solid": False, "pattern": "granite", "joints_m": [0.16, 0]},
    "stp_door_iron": {"color": "#202224", "roughness": 0.5, "metalness": 0.6, "solid": False},
    "will_door": {"color": "#6a2c24", "roughness": 0.6, "metalness": 0.0, "solid": False},
    "will_door_brass": {"color": "#c09347", "roughness": 0.3, "metalness": 0.9, "solid": False},
    "sky_door_glass": {"color": "#46606a", "roughness": 0.03, "metalness": 0.0, "opacity": 0.14, "solid": False},
    "sky_door_frame": {"color": "#2a2e31", "roughness": 0.42, "metalness": 0.55, "solid": False},
    # the cottage
    "will_paper": {"color": "#cdd2b6", "roughness": 0.9, "metalness": 0.0, "pattern": "granite", "joints_m": [0.53, 0],
                   "emissive": "#ffd6a0", "glow": 0.14},
    "will_dado": {"color": "#6b4330", "roughness": 0.6, "metalness": 0.0, "pattern": "granite", "joints_m": [0.11, 0]},
    "will_ceiling": {"color": "#efe6d2", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [0, 0.1],
                     "emissive": "#ffd6a0", "glow": 0.12},
    "will_shelf": {"color": "#8e6a48", "roughness": 0.65, "metalness": 0.0},
    "will_goods": {"color": "#b77e52", "roughness": 0.7, "metalness": 0.0},
    "will_goods2": {"color": "#56707a", "roughness": 0.6, "metalness": 0.0},
    "will_goods3": {"color": "#d9c9a4", "roughness": 0.8, "metalness": 0.0},
    # the restaurant
    "sky_oak": {"color": "#a98260", "roughness": 0.4, "metalness": 0.0, "pattern": "granite", "joints_m": [2.2, 0.19], "emissive": "#ffcf98", "glow": 0.07},
    "sky_slats": {"color": "#9a7656", "roughness": 0.65, "metalness": 0.0, "pattern": "granite", "joints_m": [0, 0.12],
                  "emissive": "#ffc98a", "glow": 0.1},
    "sky_schist": {"color": "#7c756a", "roughness": 0.95, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.12, "block_m": 0.42,
                   "emissive": "#ffd6a0", "glow": 0.12},
    "sky_lining": {"color": "#d9d2c4", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffd6a0", "glow": 0.12},
    "sky_glass_in": {"color": "#3d5158", "roughness": 0.03, "metalness": 0.0, "opacity": 0.1},
    "sky_mullion": {"color": "#2a2e31", "roughness": 0.42, "metalness": 0.55},
    "sky_table": {"color": "#4a3628", "roughness": 0.4, "metalness": 0.0},
    "sky_cloth": {"color": "#efeae0", "roughness": 0.9, "metalness": 0.0},
    "sky_chair": {"color": "#3b3f43", "roughness": 0.85, "metalness": 0.0},
    "sky_steel": {"color": "#26292c", "roughness": 0.45, "metalness": 0.7},
    "sky_counter": {"color": "#d8d2c6", "roughness": 0.3, "metalness": 0.0},
    "sky_food": {"color": "#b8763e", "roughness": 0.6, "metalness": 0.0, "emissive": "#ffb46a", "glow": 0.5, "glow_day": 0.35},
    "sky_bottles": {"color": "#3c5a3a", "roughness": 0.15, "metalness": 0.2, "emissive": "#ffcf8f", "glow": 0.4, "glow_day": 0.2},
}

FLOODLIT = {"int_boards", "int_tiles", "int_runner", "sky_oak", "int_stone", "int_rimu", "int_plaster", "int_rimu_board", "int_lamp", "stp_glass_in", "stp_glass_blue", "int_ember", "will_paper", "will_ceiling",
            "sky_slats", "sky_schist", "sky_lining", "sky_food", "sky_bottles"}
UV = {"int_rimu_board", "int_boards", "int_tiles", "stp_door", "will_paper", "will_dado", "will_ceiling", "sky_oak", "sky_slats", "sky_schist"}
BOUNCE = {"stp": "#b48a5e", "will": "#a0754c", "sky": "#9a7553"}   # the floors' colours, that light the rooms from below


class Room:
    """One interior's meshes by material (as archkit.Kit), sheltered (Mesh.sky) and, the furnishings, drawn near."""

    def __init__(self, prefix, sky):
        self.prefix, self.sky, self.meshes = prefix, sky, {}

    def m(self, mat, part="shell"):
        key = (mat, part)
        if key not in self.meshes:
            me = Mesh(f"{self.prefix}_{part}_{mat}", mat, False, floodlit=mat in FLOODLIT, uv=mat in UV)
            me.sky, me.bounce = self.sky, BOUNCE.get(self.prefix.split("_")[0])
            if part == "fit":
                me.far = FAR
            self.meshes[key] = me
        return self.meshes[key]

    def f(self, mat):
        return self.m(mat, "fit")

    def outside(self, mat):
        """A mesh of the shell's outside, in the open (not sheltered)."""
        key = (mat, "out")
        if key not in self.meshes:
            self.meshes[key] = Mesh(f"{self.prefix}_out_{mat}", mat, False, floodlit=mat in FLOODLIT, uv=mat in UV or mat == "skyline_glass")
        return self.meshes[key]

    def door(self, name, mat):
        key = (mat, name)
        if key not in self.meshes:
            me = Mesh(f"{self.prefix}_{name}_{mat}", mat, False, uv=mat in UV)
            me.sky, me.bounce = min(1.0, self.sky + 0.3), BOUNCE.get(self.prefix.split("_")[0])
            self.meshes[key] = me
        return self.meshes[key]

    def out(self):
        return [m for m in self.meshes.values() if m.i]


def cuboid(m, P, u0, u1, v0, v1, z0, z1, top=True, bottom=False):
    ak.block(m, P, u0, u1, v0, v1, z0, z1, top=top, bottom=bottom)


def strip(name, P, u0, u1, v0, v1, z, along_u=True, z1=None, label=None):
    """A walkable rectangle for the game (game.json surfaces, a strip): u0..u1 x v0..v1 in the frame P at local
    height z (rising to z1 at its far end), along u or along v."""
    if along_u:
        o = P((u0 + u1) / 2, (v0 + v1) / 2, 0)
        e = np.array(P(1, 0, 0)[:2]) - np.array(P(0, 0, 0)[:2])
        half, a, b = (v1 - v0) / 2, u0 - (u0 + u1) / 2, u1 - (u0 + u1) / 2
    else:
        o = P((u0 + u1) / 2, (v0 + v1) / 2, 0)
        e = np.array(P(0, 1, 0)[:2]) - np.array(P(0, 0, 0)[:2])
        half, a, b = (u1 - u0) / 2, v0 - (v0 + v1) / 2, v1 - (v0 + v1) / 2
    g = P(0, 0, 0)[2]
    return {"name": name, "type": "strip", "origin": [round(o[0], 2), round(o[1], 2)], "axis": [round(float(e[0]), 5), round(float(e[1]), 5)],
            "half_width": round(half, 2), "profile": [[round(a, 2), round(g + z, 2)], [round(b, 2), round(g + (z if z1 is None else z1), 2)]],
            "thickness": 0.3, "mesh": name, "drape": False, "fly_under": False, "label": label or name}


def ring_of(P, pts):
    out = []
    for u, v in pts:
        x, y, _ = P(u, v, 0)
        out += [round(x, 2), round(y, 2)]
    return out


def pendant(R, P, u, v, z_top, z_lamp, r=0.18, kind="lantern"):
    """A lamp hung from z_top to z_lamp: its rod or chain, a canopy, the shade and the lit glass."""
    x, y, g = P(u, v, 0)
    R.f("int_brass").tube([(x, y, g + z_top), (x, y, g + z_lamp + r * 1.2)], 0.012, sides=5)
    if kind == "lantern":     # a church's hexagonal lantern
        R.f("int_lamp").lathe([(g + z_lamp - r * 0.9, 0.0), (g + z_lamp - r * 0.9, r * 0.55), (g + z_lamp, r), (g + z_lamp + r * 0.8, r * 0.7),
                               (g + z_lamp + r * 0.8, 0.0)], (x, y), segs=6)
        R.f("int_brass").lathe([(g + z_lamp + r * 0.8, 0.0), (g + z_lamp + r * 0.8, r * 0.8), (g + z_lamp + r * 1.2, r * 0.25), (g + z_lamp + r * 1.2, 0.0)], (x, y), segs=6)
    elif kind == "globe":     # a cottage's glass shade
        R.f("int_lamp").lathe([(g + z_lamp - r, 0.0)] + [(g + z_lamp + r * math.sin(a), r * math.cos(a)) for a in np.linspace(-1.2, 1.3, 7)] + [(g + z_lamp + r, 0.0)],
                              (x, y), segs=10)
    else:                     # a restaurant's drum pendant: a dark shade, lit beneath
        R.f("sky_steel").lathe([(g + z_lamp, r * 0.98), (g + z_lamp + r * 0.9, r), (g + z_lamp + r * 0.9, 0.0)], (x, y), segs=14)
        R.f("int_lamp").lathe([(g + z_lamp - 0.01, 0.0), (g + z_lamp - 0.01, r * 0.92), (g + z_lamp + 0.02, r * 0.92)], (x, y), segs=14)


def chair(R, P, u, v, z, face, mat="sky_chair", leg="sky_steel"):
    """A dining chair at (u, v) with its seat facing face (unit (du, dv)): seat 0.46 m, back to 0.9 m."""
    fu, fv = face
    su, sv = -fv, fu
    Q = lambda a, b, h: P(u + fu * a + su * b, v + fv * a + sv * b, z + h)
    for a in (-0.19, 0.19):
        for b in (-0.19, 0.19):
            R.f(leg).box(Q(a, b, 0.0), Q(a, b, 0.44), 0.025, 0.025)
    m = R.f(mat)
    zw = P(u, v, z)[2]
    pts = [(-0.22, -0.22), (0.22, -0.22), (0.22, 0.22), (-0.22, 0.22)]
    _prism_world(m, [Q(a, b, 0)[:2] for a, b in pts], zw + 0.42, zw + 0.48)
    back = [Q(-0.24, -0.21, 0)[:2], Q(-0.2, -0.21, 0)[:2], Q(-0.2, 0.21, 0)[:2], Q(-0.24, 0.21, 0)[:2]]
    _prism_world(m, back, zw + 0.48, zw + 0.9)


def soft_jambs(R, P, a, b, c, w_vis, w_clear, z0, z1, layers):
    """The strips of a wall a->b either side of a doorway centred c along it, between its drawn width w_vis and the
    width open to walkers w_clear, in layers [(material, z0, z1)] (materials that are not walls: solid False)."""
    A, B = np.asarray(a, float), np.asarray(b, float)
    t = (B - A) / np.linalg.norm(B - A)
    Q = lambda s, z: P(*(A + t * s), z)
    for s0, s1 in ((c - w_clear / 2, c - w_vis / 2), (c + w_vis / 2, c + w_clear / 2)):
        for mat, za, zb in layers:
            R.m(mat).quad(Q(s0, za), Q(s1, za), Q(s1, zb), Q(s0, zb), [[s0, za], [s1, za], [s1, zb], [s0, zb]])


def _prism_world(m, ring, z0, z1):
    I = lambda u, v, zz: (u, v, zz)
    ak.prism(m, I, ring, z0, z1)


# ---------------------------------------------------------------- St Peter's

def st_peters(heritage, ground):
    H = heritage
    cx, cy = H.ST_PETERS["at"]
    P0 = ak.Frame(cx, cy, H.ST_PETERS["axis"], 0.0)
    gs = [ground(*P0(u, v, 0)[:2]) for u in (-10.5, 0, 10) for v in (-4.4, 4.4)]
    g, rise = min(gs), max(gs) - min(gs)
    P = ak.Frame(cx, cy, H.ST_PETERS["axis"], g)
    D = stp_dims(rise)
    F, FC = D["F"], D["F"] + 0.3
    NU0, NU1, NV, CU1, CV, T = D["NU0"], D["NU1"], D["NV"], D["CU1"], D["CV"], D["T"]
    iu0, inv, icu1, icv = NU0 + T, NV - T, CU1 - T, CV - T
    E_N, R_N, E_C, R_C = D["E_N"], D["R_N"], D["E_C"], D["R_C"]
    R = Room("stp_int", 0.5)
    pl, rimu, board = R.m("int_plaster"), R.m("int_rimu"), R.m("int_rimu_board")
    # the floors: boards in the nave, the chancel's red tiles up two steps, the red runner down the aisle
    R.m("int_boards", "floor_nave").quad(P(iu0, -inv, F), P(NU1 - 0.3, -inv, F), P(NU1 - 0.3, inv, F), P(iu0, inv, F),
                                         [[iu0, -inv], [NU1, -inv], [NU1, inv], [iu0, inv]])
    R.m("int_tiles", "floor_chancel").quad(P(NU1 + 0.3, -icv, FC), P(icu1, -icv, FC), P(icu1, icv, FC), P(NU1 + 0.3, icv, FC),
                                           [[NU1, -icv], [icu1, -icv], [icu1, icv], [NU1, icv]])
    for k, (u0, u1, z) in enumerate(((NU1 - 0.3, NU1, F + 0.15), (NU1, NU1 + 0.3, FC))):   # the steps under the chancel arch
        cuboid(R.m("int_stone"), P, u0, u1, -1.9, 1.9, F - 0.3, z)
    R.m("int_runner").quad(P(iu0 + 1.2, -0.6, F + 0.01), P(NU1 - 0.35, -0.6, F + 0.01), P(NU1 - 0.35, 0.6, F + 0.01), P(iu0 + 1.2, 0.6, F + 0.01))
    # the walls' plaster, with the lancets' reveals splayed back to the glass, the inner door to the porch
    def lancets(edge_u0, edge_v0, edge_u1, edge_v1, items):
        return [(c, w, z0, z0 + h, True) for c, w, z0, h in items]
    pair = lambda c, z0=1.6, w=0.48, h=2.2: [(c - (w / 2 + 0.09), w, z0, h), (c + (w / 2 + 0.09), w, z0, h)]
    dp = D["porch_u"]
    walls = [   # (a, b, z_top at a, at b, the openings: (centre along a->b, w, bottom, top, pointed)), anticlockwise round the room
        ((iu0, -inv), (NU1 - 0.3, -inv), None, [(c - iu0, w, z0, z0 + h, True) for u in (-8.5, -4.5, -0.5) for c, w, z0, h in pair(u)]),
        ((NU1 - 0.3, inv), (iu0, inv), None, [((NU1 - 0.3) - c, w, z0, z0 + h, True) for u in (-4.5, -0.5) for c, w, z0, h in pair(u)]
         + [((NU1 - 0.3) - dp, D["inner_w"], F, F + D["inner_h"], True)]),
        ((iu0, inv), (iu0, -inv), None, [(inv - c, 0.6 - abs(c) * 0.0, 2.0 - abs(c) * 0.4, 2.0 - abs(c) * 0.4 + 3.4 - abs(c) * 0.8, True) for c in (-1.1, 0.0, 1.1)]),
        ((NU1 + 0.3, -icv), (icu1, -icv), None, [(3.7 - (NU1 + 0.3), 0.42, 1.7, 3.7, True)]),
        ((icu1, icv), (NU1 + 0.3, icv), None, [(icu1 - 4.2, 0.42, 1.7, 3.7, True)]),
        ((icu1, -icv), (icu1, icv), None, [(icv + c, 0.55, 1.9 - abs(c) * 0.4, 1.9 - abs(c) * 0.4 + 3.0 - abs(c) * 0.7, True) for c in (-1.1, 0.0, 1.1)]),
    ]
    kN, kC = (R_N - E_N) / NV, (R_C - E_C) / CV
    top_n = E_N + T * kN - 0.12      # where the nave's lining meets its ceiling
    top_c = E_C + T * kC - 0.12
    for a, b, _, holes in walls:
        nave = a[0] < NU1
        zt = top_n if nave else top_c
        z0 = F if nave else FC
        if abs(a[0] - b[0]) < 1e-6:   # an end wall: up into its gable, to the ceiling's ridge
            ridge = (R_N if nave else R_C) - 0.3   # the gable over the wall's top, up to the boarded roof's ridge
            outl = ak.holed_wall(pl, P, a, b, z0 - 0.05, zt, holes)
            pl.tri(P(a[0], a[1], zt), P(b[0], b[1], zt), P(a[0], 0, ridge))
        else:
            outl = ak.holed_wall(pl, P, a, b, z0 - 0.05, zt, holes)
        for o, (c, w, zb, zt_, pt) in zip(outl, holes):
            door = zb <= F + 1e-6
            ak.reveal(R.m("int_stone" if not door else "int_plaster"), P, a, b, o, 0.0, T - (0.0 if door else 0.12))
            if not door:   # the leaded glass at the outer face, the sill a sloped stone
                glass = R.m("stp_glass_blue" if (abs(a[0] - b[0]) < 1e-6 and abs(c - (abs(a[1] - b[1]) / 2)) < 0.2) else "stp_glass_in")
                ak.pane(glass, P, a, b, o, T - 0.14)
    # the chancel arch: the wall between nave and chancel, both its faces, a pointed arch 3.6 m wide
    arch_holes = [(inv, 3.6, F, F + 4.7, True)]
    ak.holed_wall(pl, P, (NU1 - 0.3, -inv), (NU1 - 0.3, inv), F, top_n, arch_holes)
    pl.tri(P(NU1 - 0.3, -inv, top_n), P(NU1 - 0.3, inv, top_n), P(NU1 - 0.3, 0, R_N - 0.3))
    o = ak.holed_wall(pl, P, (NU1 + 0.3, icv), (NU1 + 0.3, -icv), FC, top_c, [(icv, 3.6, FC, F + 4.7, True)])
    pl.tri(P(NU1 + 0.3, icv, top_c), P(NU1 + 0.3, -icv, top_c), P(NU1 + 0.3, 0, R_C - 0.3))
    ak.reveal(R.m("int_stone"), P, (NU1 - 0.3, -inv), (NU1 - 0.3, inv), ak.holed_wall(_Null(), P, (NU1 - 0.3, -inv), (NU1 - 0.3, inv), F, top_n, arch_holes)[0], 0.0, 0.6)
    # the open roof: boards on the rafters, from the walls' tops to the ridge, both slopes, nave and chancel
    for (u0, u1, vt, zt, ridge) in ((iu0, NU1 - 0.3, inv, top_n, R_N - 0.3), (NU1 + 0.3, icu1, icv, top_c, R_C - 0.3)):
        L = u1 - u0
        s = math.hypot(vt, ridge - zt)
        board.quad(P(u0, -vt, zt), P(u1, -vt, zt), P(u1, 0, ridge), P(u0, 0, ridge), [[0, 0], [L, 0], [L, s], [0, s]])
        board.quad(P(u1, vt, zt), P(u0, vt, zt), P(u0, 0, ridge), P(u1, 0, ridge), [[0, 0], [L, 0], [L, s], [0, s]])
        for sgn in (-1, 1):   # the wall plate and a moulded cornice under it
            rimu.box(P(u0, sgn * (vt - 0.06), zt - 0.06), P(u1, sgn * (vt - 0.06), zt - 0.06), 0.14, 0.18)
        rimu.box(P(u0, 0, ridge - 0.08), P(u1, 0, ridge - 0.08), 0.12, 0.22)   # the ridge piece
    # the nave's arch-braced trusses: principals under the boards, the collar, the curved braces down to wall posts
    # on stone corbels; the chancel's lighter ones
    for u, (vt, zt, ridge, big) in [(u, (inv, top_n, R_N - 0.3, True)) for u in (-8.2, -5.0, -1.8)] + [(u, (icv, top_c, R_C - 0.3, False)) for u in (4.4, 7.2)]:
        w = 0.2 if big else 0.15
        zc = zt + (ridge - zt) * 0.62
        vc = vt * (1 - 0.62)
        for sgn in (-1, 1):
            rimu.box(P(u, sgn * (vt - 0.1), zt - 0.1), P(u, 0, ridge - 0.12), w, 0.24)
            rimu.box(P(u, sgn * (vt - 0.1), zt - 1.5), P(u, sgn * (vt - 0.1), zt - 0.05), w, 0.18)           # the wall post
            cuboid(R.m("int_stone"), P, u - 0.18, u + 0.18, sgn * (vt - 0.22), sgn * vt, zt - 1.75, zt - 1.45)  # its corbel
            arc = [P(u, sgn * (vt - 0.1 - (vt - 0.1 - vc) * (1 - math.cos(a))), zt - 1.5 + (zc - (zt - 1.5)) * math.sin(a)) for a in np.linspace(0, math.pi / 2, 9)]
            rimu.tube(arc, 0.08 if big else 0.06, sides=6)
        rimu.box(P(u, -vc, zc), P(u, vc, zc), w, 0.2)                                                       # the collar
    # the pews: two blocks either side of the aisle, facing east; rimu ends, a seat, a sloped back with its
    # book ledge, a kneeler
    rows = np.arange(-6.9, -1.9, 0.95)
    for u in rows:
        for sgn in (-1, 1):
            v0, v1 = sgn * 0.78, sgn * (inv - 0.28)
            va, vb = min(v0, v1), max(v0, v1)
            cuboid(R.f("int_rimu"), P, u - 0.2, u + 0.2, va, vb, F + 0.42, F + 0.47)                       # the seat
            back = R.f("int_rimu")
            back.quad(P(u - 0.22, va, F + 0.47), P(u - 0.22, vb, F + 0.47), P(u - 0.3, vb, F + 0.95), P(u - 0.3, va, F + 0.95))
            back.quad(P(u - 0.26, vb, F + 0.47), P(u - 0.26, va, F + 0.47), P(u - 0.34, va, F + 0.95), P(u - 0.34, vb, F + 0.95))
            cuboid(back, P, u - 0.4, u - 0.26, va, vb, F + 0.9, F + 0.96)                                    # the ledge behind
            cuboid(back, P, u - 0.33, u - 0.26, va, vb, F + 0.1, F + 0.47)                                   # the back's skirt
            cuboid(R.f("int_kneeler"), P, u + 0.38, u + 0.5, va + 0.1, vb - 0.1, F, F + 0.1)
            for ve in (va, vb - 0.06):                                                                       # the bench ends
                cuboid(back, P, u - 0.4, u + 0.22, ve, ve + 0.06, F, F + 0.95)
    # the font by the door: an octagonal stone bowl on a stem, a timber cover
    fx, fy, _ = P(-9.1, -2.5, 0)
    R.f("int_stone").lathe([(g + F, 0.0), (g + F, 0.42), (g + F + 0.15, 0.42), (g + F + 0.2, 0.2), (g + F + 0.7, 0.18), (g + F + 0.78, 0.38),
                           (g + F + 0.98, 0.42), (g + F + 1.0, 0.0)], (fx, fy), segs=8)
    R.f("int_rimu").lathe([(g + F + 1.0, 0.0), (g + F + 1.0, 0.36), (g + F + 1.12, 0.3), (g + F + 1.4, 0.04), (g + F + 1.5, 0.0)], (fx, fy), segs=8)
    # the pulpit at the arch on the north, up three steps; the brass lectern on the south
    px, py, _ = P(0.4, 2.6, 0)
    R.f("int_rimu").lathe([(g + F, 0.0), (g + F, 0.3), (g + F + 0.85, 0.3), (g + F + 0.95, 0.55), (g + F + 1.95, 0.58), (g + F + 2.05, 0.62),
                          (g + F + 2.05, 0.0)], (px, py), segs=8)
    for k in range(3):
        cuboid(R.f("int_rimu"), P, -0.6 + k * 0.25, -0.35 + k * 0.25, 3.15, 3.65, F, F + 0.22 * (k + 1))
    lx, ly, _ = P(0.4, -2.3, 0)
    R.f("int_brass").lathe([(g + F, 0.0), (g + F, 0.22), (g + F + 0.06, 0.08), (g + F + 1.05, 0.045), (g + F + 1.1, 0.0)], (lx, ly), segs=10)
    R.f("int_brass").quad(P(0.15, -2.55, F + 1.05), P(0.15, -2.05, F + 1.05), P(0.55, -2.05, F + 1.25), P(0.55, -2.55, F + 1.25))
    # the chancel: choir stalls each side, the communion rail, the altar with its frontal, cross and candles
    for sgn in (-1, 1):
        vs, vd = sgn * (icv - 0.35), sgn * (icv - 0.95)
        cuboid(R.f("int_rimu"), P, 2.4, 5.6, min(vs, sgn * icv) , max(vs, sgn * icv), FC, FC + 0.45)
        cuboid(R.f("int_rimu"), P, 2.4, 5.6, min(sgn * icv, sgn * (icv - 0.05)), max(sgn * icv, sgn * (icv - 0.05)), FC, FC + 1.1)
        cuboid(R.f("int_rimu"), P, 2.4, 5.6, min(vd, vd + sgn * 0.3), max(vd, vd + sgn * 0.3), FC, FC + 0.85)
        R.f("int_rimu").box(P(6.9, sgn * 0.55, FC + 0.85), P(6.9, sgn * (icv - 0.05), FC + 0.85), 0.1, 0.07)       # the rail, open in the middle
        for v in np.linspace(sgn * 0.6, sgn * (icv - 0.15), 6):
            R.f("int_rimu").box(P(6.9, v, FC), P(6.9, v, FC + 0.85), 0.05, 0.05)
    cuboid(R.f("int_rimu"), P, 8.25, 8.85, -0.8, 0.8, FC, FC + 0.92)
    cuboid(R.f("int_linen"), P, 8.2, 8.9, -0.85, 0.85, FC + 0.6, FC + 0.95)
    R.f("int_brass").box(P(8.6, 0, FC + 0.95), P(8.6, 0, FC + 1.55), 0.035, 0.035)
    R.f("int_brass").box(P(8.6, -0.16, FC + 1.4), P(8.6, 0.16, FC + 1.4), 0.03, 0.035)
    for v in (-0.6, 0.6):
        x, y, _ = P(8.6, v, 0)
        R.f("int_brass").lathe([(g + FC + 0.95, 0.06), (g + FC + 1.0, 0.02), (g + FC + 1.3, 0.015), (g + FC + 1.32, 0.04)], (x, y), segs=8)
        R.f("int_lamp").tube([(x, y, g + FC + 1.32), (x, y, g + FC + 1.52)], 0.012, sides=6)
    # the lanterns: two rows down the nave from the collars, one in the chancel
    lamps = [(u, v) for u in (-8.2, -5.0, -1.8) for v in (-1.9, 1.9)] + [(5.8, 0.0)]
    for u, v in lamps:
        zt = top_n + (R_N - 0.3 - top_n) * (1 - abs(v) / inv) if u < NU1 else top_c + (R_C - 0.3 - top_c) * (1 - abs(v) / icv)
        pendant(R, P, u, v, zt - 0.05, (F if u < NU1 else FC) + 3.0)
    # the porch: flagstones, plaster, and the oak door in its pointed opening (it swings in, towards the nave)
    pu0, pu1, pv1 = D["pu0"], D["pu1"], D["pv1"]
    R.m("int_stone", "floor_porch").quad(P(pu0 + 0.3, NV - T, F), P(pu1 - 0.3, NV - T, F), P(pu1 - 0.3, pv1 - 0.3, F), P(pu0 + 0.3, pv1 - 0.3, F))
    for a, b in (((pu0 + 0.3, pv1 - 0.3), (pu0 + 0.3, NV)), ((pu1 - 0.3, NV), (pu1 - 0.3, pv1 - 0.3))):
        ak.holed_wall(pl, P, a, b, F, 2.5, [])
    cuboid(R.f("int_rimu"), P, pu0 + 0.3, pu0 + 0.7, NV + 0.3, pv1 - 0.6, F, F + 0.45)        # a bench along its wall
    door = D["door"]
    c0, w = door["c"], door["w"]
    zs, right = ak.lancet_head(w - 0.04, F, door["h"] - 0.02)
    dv = pv1 - 0.18
    arch = [(c0 + p[0], p[1]) for p in right]                              # the head's right half, jamb to apex
    leaves = []
    for side, sgn in (("w", -1), ("e", 1)):                                # a pair of leaves meeting under the apex
        leaf, iron = R.door(f"door_{side}", "stp_door"), R.door(f"door_{side}", "stp_door_iron")
        half = [(c0 + sgn * abs(p[0] - c0), p[1]) for p in arch]
        outline = [(c0, F), (c0 + sgn * (w / 2 - 0.02), F)] + half + [(c0, F + door["h"] - 0.02)]
        cs, czz = c0 + sgn * w / 4, F + door["h"] * 0.4
        for d in (-0.03, 0.03):
            for (sa, za), (sb, zb) in zip(outline, outline[1:] + outline[:1]):
                leaf.tri(P(cs, dv + d, czz), P(sa, dv + d, za), P(sb, dv + d, zb), [[cs, czz], [sa, za], [sb, zb]])
        for (sa, za), (sb, zb) in zip(outline, outline[1:] + outline[:1]):
            leaf.quad(P(sa, dv - 0.03, za), P(sb, dv - 0.03, zb), P(sb, dv + 0.03, zb), P(sa, dv + 0.03, za))
        jamb = c0 + sgn * w / 2
        for z in (F + 0.4, F + 1.8):   # the strap hinges, and the ring handle by the meeting stiles
            for d in (0.04, -0.04):
                iron.box(P(jamb - sgn * 0.02, dv + d, z), P(jamb - sgn * 0.6, dv + d, z), 0.06, 0.012)
        iron.tube([P(c0 + sgn * 0.12 + 0.07 * math.cos(a), dv + 0.05, F + 1.05 + 0.07 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 9)], 0.01, sides=4)
        hx, hy, _ = P(jamb - sgn * 0.03, dv, 0)
        leaves.append({"meshes": [leaf.name, iron.name], "hinge": [round(hx, 2), round(hy, 2)], "deg": 100 * sgn})   # (in, towards the nave)
    doors = [{"id": "st-peters", "name": "St Peter's porch doors", "at": [round(P(c0, pv1, 0)[0], 2), round(P(c0, pv1, 0)[1], 2), round(g + F, 2)],
              "reach": 3.2, "time": 0.9, "leaves": leaves}]
    # the strips: the nave, the chancel, the porch, the steps down from its door
    surfaces = [strip("stp_int_floor_nave_int_boards", P, iu0, NU1, -inv, inv, F, label="St Peter's nave"),
                strip("stp_int_floor_chancel_int_tiles", P, NU1, icu1, -icv, icv, FC, label="St Peter's chancel"),
                strip("stp_int_floor_porch_int_stone", P, pu0 + 0.3, pu1 - 0.3, NV - T - 0.2, pv1 + 0.02, F, along_u=False, label="St Peter's porch")]
    gst = ground(*P(door["c"], pv1 + 1.4, 0)[:2]) - g
    surfaces.append(strip("stp_int_steps_int_stone", P, door["c"] - 0.9, door["c"] + 0.9, pv1, pv1 + 1.3, F, along_u=False, z1=max(gst, F - 1.0), label="St Peter's steps"))
    for k in range(4):   # the steps' stone treads, falling from the door to the path
        za = F - (F - gst) * (k + 1) / 4
        cuboid(R.m("int_stone", "steps"), P, door["c"] - 0.95, door["c"] + 0.95, pv1 + 0.32 * k, pv1 + 0.32 * (k + 1), gst - 0.3, za + (F - gst) / 4)
    rooms = [{"id": "st-peters", "name": "St Peter's Anglican Church", "note": "J. McDowall Smith, 1932: greywacke from the lake edge, the east window the Call of St Peter",
              "floor": round(g + F, 2), "height": 6.0, "door": "st-peters",
              "ring": ring_of(P, [(iu0, -inv), (NU1, -inv), (NU1, -icv), (icu1, -icv), (icu1, icv), (NU1, icv), (NU1, inv), (pu1 - 0.3, inv), (pu1 - 0.3, pv1 - 0.3),
                                  (pu0 + 0.3, pv1 - 0.3), (pu0 + 0.3, inv), (iu0, inv)]),
              "way": [[round(c, 2) for c in P(door["c"], pv1 + 4.0, 0)[:2]], [round(c, 2) for c in P(door["c"], pv1 - 1.2, 0)[:2]],
                      [round(c, 2) for c in P(door["c"], 0.0, 0)[:2]], [round(c, 2) for c in P(-1.0, 0.0, 0)[:2]]]}]
    glows = []   # (the floors take the lamps' light as a glow of their own: night.js's pools are the street's)
    return R.out(), doors, rooms, surfaces, glows


def stp_dims(rise):
    """St Peter's shell, as heritage.st_peters draws it, and the inside's levels: F, the nave's floor over the frame's
    ground (the lowest under the church), a little over the highest ground under the nave; T, the walls' thickness."""
    return {"NU0": -10.5, "NU1": 1.5, "NV": 4.4, "CU1": 9.8, "CV": 3.4, "T": 0.55, "F": round(min(rise, 0.6) + 0.05, 2),
            "E_N": 4.8 + rise, "R_N": 8.5 + rise * 0.5, "E_C": 4.5 + rise, "R_C": 7.7 + rise * 0.5,
            "pu0": -9.7, "pu1": -6.7, "pv1": 4.4 + 3.0, "porch_u": -8.2, "inner_w": 1.6, "inner_h": 3.4,
            # the porch's doors: a pair of oak leaves 1.5 m across under a pointed head springing at 1.9 m (a walker's
            # capsule, 0.7 m, and the collision world's quarter-metre cells pass it, web/game/nav.js)
            "door": {"c": -8.2, "w": 1.5, "h": 3.2}}


class _Null:
    """A mesh that draws nothing (to measure an opening's outline without drawing the wall twice)."""

    def tri(self, *a, **k):
        pass

    def quad(self, *a, **k):
        pass


# ---------------------------------------------------------------- Williams Cottage

def williams(heritage, ground):
    H = heritage
    cx, cy = H.WILLIAMS["at"]
    g = ground(cx, cy)
    P = ak.Frame(cx, cy, H.WILLIAMS["axis"], g)
    D = will_dims()
    U0, U1, V0, V1, LU1, F, T = D["U0"], D["U1"], D["V0"], D["V1"], D["LU1"], D["F"], D["T"]
    R = Room("will_int", 0.5)
    iu0, iu1, iv0, iv1, ilu1 = U0 + T, U1 - T / 2, V0 + T, V1 - T, LU1 - T
    paper, dado, ceil = R.m("will_paper"), R.m("will_dado"), R.m("will_ceiling")
    R.m("int_boards", "floor").quad(P(iu0, iv0, F), P(ilu1, iv0, F), P(ilu1, iv1, F), P(iu0, iv1, F), [[iu0, iv0], [ilu1, iv0], [ilu1, iv1], [iu0, iv1]])
    door = D["door"]
    CW, LW0, LW1 = 2.45, 2.8, 2.05   # the front room's ceiling, the lean-to's at its front and its back (over the floor)
    # the front room's walls and the lean-to's, anticlockwise, each with its windows and doors: the dado to 0.95 m,
    # the paper over it to the ceiling
    win = lambda c, w, z0, h: (c, w, z0, z0 + h, False)
    front = [(iv1 - 0.8, 1.0, 0.6, 1.4), (iv1 - (-3.2), 1.0, 0.6, 1.4)]
    rooms_walls = [
        ((iu0, iv0), (iu1, iv0), [win(-5.0 - iu0, 0.85, 0.75, 1.35), win(-2.6 - iu0, 0.85, 0.75, 1.35)], CW, CW),
        ((iu1, iv0), (iu1, -3.55), [], CW, CW),
        ((iu1, -2.45), (iu1, D["inner_v"] - D["inner_clear"] / 2), [], CW, CW),
        ((iu1, D["inner_v"] + D["inner_clear"] / 2), (iu1, iv1), [], CW, CW),
        ((iu1, iv1), (iu0, iv1), [win(iu1 - (-3.8), 0.85, 0.75, 1.35)], CW, CW),
        ((iu0, iv1), (iu0, iv0), [win(iv1 - 0.8, 1.0, 0.6, 1.4), win(iv1 - (-3.2), 1.0, 0.6, 1.4), (iv1 - door["v"], door["clear"], F, F + door["h"], False)], CW, CW),
        # the lean-to: its ceiling follows the skillion, falling from the front room's wall to the back
        ((U1 + T / 2, iv0), (ilu1, iv0), [(2.6 - (U1 + T / 2), 0.85, F, F + 2.0, False)], LW0, LW1),
        ((ilu1, iv0), (ilu1, iv1), [], LW1, LW1),
        ((ilu1, iv1), (U1 + T / 2, iv1), [], LW1, LW0),
        ((U1 + T / 2, iv1), (U1 + T / 2, D["inner_v"] + D["inner_clear"] / 2), [], LW0, LW0),
        ((U1 + T / 2, D["inner_v"] - D["inner_clear"] / 2), (U1 + T / 2, iv0), [], LW0, LW0),
    ]
    for a, b, holes, za, zb in rooms_walls:
        za, zb = F + za, F + zb
        hz = [(c, w, zb_, zt, p) for c, w, zb_, zt, p in holes]
        outl = ak.holed_wall(_Null(), P, a, b, F, za, hz, z1b=zb)
        ak.holed_wall(dado, P, a, b, F, F + 0.95, [(c, w, b0, min(t, F + 0.95), p) for c, w, b0, t, p in hz if b0 < F + 0.95])
        ak.holed_wall(paper, P, a, b, F + 0.95, za, [(c, w, max(b0, F + 0.95), t, p) for c, w, b0, t, p in hz if t > F + 0.95], z1b=zb)
        A, B = np.asarray(a, float), np.asarray(b, float)
        tt = (B - A) / np.linalg.norm(B - A)
        Q = lambda s, z, d=0.0: P(*(A + tt * s + np.array([tt[1], -tt[0]]) * d), z)
        L = float(np.linalg.norm(B - A))
        gaps = sorted((c - w / 2, c + w / 2) for c, w, b0, t, p in hz if b0 < F + 0.95)       # (windows and doors the dado rail stops at)
        s = 0.0
        for g0, g1 in gaps + [(L, L)]:
            if g0 - s > 0.02:
                R.m("will_shelf").box(Q(s, F + 0.95, -0.02), Q(g0, F + 0.95, -0.02), 0.04, 0.05)      # the dado rail
            s = max(s, g1)
        s = 0.0
        for g0, g1 in sorted((c - w / 2, c + w / 2) for c, w, b0, t, p in hz if b0 <= F + 0.01) + [(L, L)]:
            if g0 - s > 0.02:
                R.m("will_shelf").box(Q(s, F + 0.07, -0.01), Q(g0, F + 0.07, -0.01), 0.03, 0.14)      # the skirting
            s = max(s, g1)
        for o, (c, w, zb_, zt, p) in zip(outl, hz):
            if zb_ <= F + 0.01:   # the front door: the wall's last few centimetres either side drawn but open to walkers
                vis = door["w"]
                soft_jambs(R, P, a, b, c, vis, w, F, F + door["h"], (("will_dado_soft", F, F + 0.95), ("will_paper_soft", F + 0.95, F + door["h"])))
                o = [(c - vis / 2, F), (c + vis / 2, F), (c + vis / 2, F + door["h"]), (c - vis / 2, F + door["h"])]
                ak.reveal(R.m("will_shelf_soft"), P, a, b, o, 0.0, T)
                continue
            ak.reveal(R.m("will_shelf"), P, a, b, o, 0.0, T)
            if zb_ > F + 0.01:   # the window: its glass, the sash bars, lit from outside by day
                ak.pane(R.m("will_glass"), P, a, b, o, T - 0.04)
    # the ceilings: matchlining, flat in the front room, the lean-to's following its skillion
    ceil.quad(P(iu0, iv0, F + CW), P(iu0, iv1, F + CW), P(iu1, iv1, F + CW), P(iu1, iv0, F + CW), [[iu0, iv0], [iu0, iv1], [iu1, iv1], [iu1, iv0]])
    ceil.quad(P(U1 + T / 2, iv0, F + LW0), P(U1 + T / 2, iv1, F + LW0), P(ilu1, iv1, F + LW1), P(ilu1, iv0, F + LW1), [[0, iv0], [0, iv1], [5, iv1], [5, iv0]])
    # the wall between them above the doorway and its jambs' thickness
    iw, iv, ic = D["inner_w"] / 2, D["inner_v"], D["inner_clear"] / 2
    ak.reveal(R.m("will_shelf_soft"), P, (iu1, iv + iw), (iu1, iv - iw), [(0, F), (2 * iw, F), (2 * iw, F + 2.0), (0, F + 2.0)], 0.0, T)
    paper.quad(P(iu1, iv - ic, F + 2.0), P(iu1, iv + ic, F + 2.0), P(iu1, iv + ic, F + CW), P(iu1, iv - ic, F + CW))
    paper.quad(P(U1 + T / 2, iv + ic, F + 2.0), P(U1 + T / 2, iv - ic, F + 2.0), P(U1 + T / 2, iv - ic, F + LW0), P(U1 + T / 2, iv + ic, F + LW0))
    for a, b in (((iu1, iv - ic), (iu1, iv + ic)), ((U1 + T / 2, iv + ic), (U1 + T / 2, iv - ic))):
        soft_jambs(R, P, a, b, ic, 2 * iw, 2 * ic, F, F + 2.0, (("will_dado_soft", F, F + 0.95), ("will_paper_soft", F + 0.95, F + 2.0)))
    # the fireplace in the chimney breast between the rooms: a schist surround, the dark firebox and its embers, a mantel
    st = R.m("will_stone")
    cuboid(st, P, iu1 - 0.6, iu1, -3.55, -2.45, F, F + CW, top=False)
    cuboid(R.m("int_soot"), P, iu1 - 0.62, iu1 - 0.2, -3.3, -2.7, F, F + 0.85)
    cuboid(R.m("int_ember"), P, iu1 - 0.64, iu1 - 0.35, -3.15, -2.85, F, F + 0.12)
    cuboid(R.m("will_shelf"), P, iu1 - 0.78, iu1 - 0.58, -3.7, -2.3, F + 1.25, F + 1.32)
    # the shop: shelves along the walls with goods on them, two display tables, the counter and its till by the
    # lean-to's doorway
    for (a0, a1, v, side) in ((-6.3, -5.6, iv1 - 0.32, 1), (-4.4, -1.8, iv1 - 0.32, 1), (-6.4, -5.5, iv0 + 0.32, -1), (-4.2, -3.1, iv0 + 0.32, -1)):
        for z in (0.0, 0.5, 1.0, 1.5):
            cuboid(R.f("will_shelf"), P, a0, a1, v - 0.18, v + 0.18, F + z + 0.3, F + z + 0.33)
        for u in (a0, a1):
            cuboid(R.f("will_shelf"), P, u - 0.02, u + 0.02, v - 0.18, v + 0.18, F, F + 1.9)
        for k, u in enumerate(np.arange(a0 + 0.12, a1 - 0.1, 0.22)):
            for z in (0.33, 0.83, 1.33):
                h = 0.12 + 0.1 * ((k * 7 + int(z * 10)) % 3)
                cuboid(R.f(("will_goods", "will_goods2", "will_goods3")[(k + int(z * 3)) % 3]), P, u - 0.08, u + 0.08, v - 0.1, v + 0.1, F + z, F + z + h)
    for (u, v) in ((-4.8, 0.75), (-2.8, -3.0)):
        cuboid(R.f("will_shelf"), P, u - 0.6, u + 0.6, v - 0.45, v + 0.45, F + 0.78, F + 0.82)
        for a in (-0.55, 0.55):
            for b in (-0.4, 0.4):
                cuboid(R.f("will_shelf"), P, u + a - 0.03, u + a + 0.03, v + b - 0.03, v + b + 0.03, F, F + 0.78)
        for k in range(6):
            a, b = -0.4 + 0.16 * k, (-0.2, 0.15)[k % 2]
            cuboid(R.f(("will_goods3", "will_goods", "will_goods2")[k % 3]), P, u + a - 0.06, u + a + 0.06, v + b - 0.09, v + b + 0.09, F + 0.82, F + 0.9 + 0.05 * (k % 3))
    cuboid(R.f("will_shelf"), P, 0.6, 2.4, 1.2, 1.75, F, F + 0.95)                     # the counter in the lean-to
    cuboid(R.f("will_goods2"), P, 1.6, 1.95, 1.3, 1.6, F + 0.95, F + 1.15)             # its till
    pendant(R, P, -3.8, -1.2, CW + F, F + 2.25, r=0.14, kind="globe")   # (over head height: the globe's foot at 2.1 m)
    pendant(R, P, 1.8, 0.0, LW0 - 0.3 + F, F + 2.25, r=0.13, kind="globe")
    # the front door: four panels in oxblood, a brass knob; it swings in
    leaf, brass = R.door("door", "will_door"), R.door("door", "will_door_brass")
    hv = door["v"] + door["w"] / 2
    du = U0 + 0.06
    cuboid(leaf, P, du - 0.025, du + 0.025, door["v"] - door["w"] / 2 + 0.02, hv - 0.02, F, F + door["h"] - 0.02)
    for (a, b) in ((0.12, 0.95), (1.1, 1.95)):
        for (c0, c1) in ((0.1, 0.4), (0.5, 0.8)):
            cuboid(leaf, P, du - 0.04, du + 0.04, hv - c1, hv - c0, F + a, F + b)
    x, y, _ = P(du - 0.07, door["v"] - door["w"] / 2 + 0.12, 0)
    brass.lathe([(g + F + 0.98, 0.0), (g + F + 0.98, 0.03), (g + F + 1.03, 0.03), (g + F + 1.06, 0.0)], (x, y), segs=8)
    x, y, _ = P(du + 0.07, door["v"] - door["w"] / 2 + 0.12, 0)
    brass.lathe([(g + F + 0.98, 0.0), (g + F + 0.98, 0.03), (g + F + 1.03, 0.03), (g + F + 1.06, 0.0)], (x, y), segs=8)
    hx, hy, _ = P(du, hv, 0)
    doors = [{"id": "williams-cottage", "name": "Williams Cottage's front door", "at": [round(P(U0, door["v"], 0)[0], 2), round(P(U0, door["v"], 0)[1], 2), round(g + F, 2)],
              "reach": 2.6, "time": 0.8, "leaves": [{"meshes": [leaf.name, brass.name], "hinge": [round(hx, 2), round(hy, 2)], "deg": 100}]}]
    surfaces = [strip("will_int_floor_int_boards", P, iu0, ilu1, iv0, iv1, F, label="Williams Cottage"),
                strip("will_verandah", P, U0 - 1.9, U0 + 0.02, V0, V1, 0.15, label="Williams Cottage's verandah")]
    rooms = [{"id": "williams-cottage", "name": "Williams Cottage", "note": "1864, one of the oldest houses in Queenstown: its schist chimney, the lean-to of 1866",
              "floor": round(g + F, 2), "height": 3.0, "door": "williams-cottage",
              "ring": ring_of(P, [(iu0, iv0), (ilu1, iv0), (ilu1, iv1), (iu0, iv1)]),
              "way": [[round(c, 2) for c in P(U0 - 4.0, door["v"], 0)[:2]], [round(c, 2) for c in P(U0 - 0.9, door["v"], 0)[:2]],
                      [round(c, 2) for c in P(U0 + 1.2, door["v"], 0)[:2]], [round(c, 2) for c in P(-2.6, -1.0, 0)[:2]]]}]
    glows = []
    return R.out(), doors, rooms, surfaces, glows


def will_dims():
    """Williams Cottage's shell, as heritage.williams draws it, and the inside: F, the floor over the frame's ground (the
    verandah's boards at 0.15 m); T, the walls' boards and studs; the front door and the doorway through to the lean-to."""
    return {"U0": -6.8, "U1": -0.8, "V0": -4.8, "V1": 2.4, "LU1": 4.5, "F": 0.2, "T": 0.14,
            # the front door 1.15 m between its jambs and the doorway through 1.3 m (a walker's 0.7 m and the collision
            # world's quarter-metre cells pass them, web/game/nav.js)
            # the doorways are drawn at their own widths (the front door 0.95 m, the way through 1.0 m) and a little
            # more is open to the walkers: the last 0.17 m of the wall either side is not a wall to them (_soft
            # materials), so that a walker's 0.7 m and the collision world's quarter-metre cells, here on walls at
            # 44 degrees to them, pass (web/game/nav.js)
            "door": {"v": 2.4 - 3.6, "w": 0.95, "h": 2.1, "clear": 1.3}, "inner_v": 0.9, "inner_w": 1.0, "inner_clear": 1.35}


for _k in ("will_dado", "will_paper", "will_shelf"):   # (the doorways' margins: drawn, not walls to walkers)
    MATERIALS[_k + "_soft"] = dict(MATERIALS[_k], solid=False)
    if _k in UV:
        UV.add(_k + "_soft")
    if _k in FLOODLIT:
        FLOODLIT.add(_k + "_soft")
MATERIALS["will_glass"] = {"color": "#d8e2e4", "roughness": 0.1, "metalness": 0.0, "emissive": "#fff4e2", "glow": 0.2, "glow_day": 0.9}
FLOODLIT.add("will_glass")
MATERIALS["will_stone"] = {"color": "#b4a37f", "roughness": 0.95, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.22, "block_m": 0.38}
UV.add("will_stone")


# ---------------------------------------------------------------- the Skyline restaurant

# the dining room in the deck's frame (city.py deck_frame: u along the deck, v out over the slope, z its level):
# its glass front HALL_V0 behind the deck's back edge (a planted bed between, open at the doors), back to HALL_V1,
# along the deck's span; its ceiling and roof over the deck's level
HALL = {"u0": -12.6, "u1": 12.6, "v0": -3.05, "v1": -15.2, "ceiling": 3.6, "roof": 3.9, "door_u": 4.5, "door_w": 1.8, "door_h": 2.4}


def hall_ring(c, ax, out, grow=0.0):
    """The dining room's outline in the city's frame (x, y), grown by `grow` m all round."""
    H = HALL
    pts = [(H["u0"] - grow, H["v0"] + grow), (H["u1"] + grow, H["v0"] + grow), (H["u1"] + grow, H["v1"] - grow), (H["u0"] - grow, H["v1"] - grow)]
    return [tuple(float(q) for q in (c + ax * u + out * v)) for u, v in pts]


def restaurant(deck_frame, ground, massing):
    """The dining room's shell, glazing and furnishings; its doors, its floor strip, its room, its lamps' pools."""
    c, ax, out, z = deck_frame(ground)
    H = HALL
    u0, u1, v0, v1 = H["u0"], H["u1"], H["v0"], H["v1"]
    P = lambda u, v, h: [float(q) for q in (c + ax * u + out * v)] + [z + h]
    Pf = _DeckFrame(c, ax, out, z)
    R = Room("sky_int", 0.75)   # (glazed the length of its front: more of the sky's light than the church's)
    ceiling, roof = H["ceiling"], H["roof"]
    # the floor (oak), the ceiling (slats), the lining of the sides and back, the schist wall behind the buffet
    R.m("sky_oak", "floor").quad(P(u0, v0, 0), P(u0, v1, 0), P(u1, v1, 0), P(u1, v0, 0), [[u0, v0], [u0, v1], [u1, v1], [u1, v0]])
    R.m("sky_slats").quad(P(u0, v0, ceiling), P(u1, v0, ceiling), P(u1, v1, ceiling), P(u0, v1, ceiling), [[u0, v0], [u1, v0], [u1, v1], [u0, v1]])
    lin = R.m("sky_lining")
    i = 0.12
    for (a, b) in (((u1 - i, v0), (u1 - i, v1 + i)), ((u0 + i, v1 + i), (u0 + i, v0))):
        ak.holed_wall(lin, Pf, a, b, 0.0, ceiling, [])
    ak.holed_wall(R.m("sky_schist"), Pf, (u1 - i, v1 + i), (u0 + i, v1 + i), 0.0, ceiling, [])
    # the shell outside: the walls from the ground up to the roof where the terraces behind no longer cover them,
    # the roof, the fascia over the glass, the glass's lower storeys under the floor (the luge building's)
    sh = R.outside("skyline_glass")
    gmin = lambda u, v: float(ground(*(c + ax * u + out * v))) - 0.5
    for (ua, va), (ub, vb) in (((u0, v0), (u0, v1)), ((u1, v1), (u1, v0))):
        n = 6
        for k in range(n):
            pa = (ua, va + (vb - va) * k / n)
            pb = (ua, va + (vb - va) * (k + 1) / n)
            za, zb = gmin(*pa) - z, gmin(*pb) - z
            sh.quad(P(*pa, za), P(*pb, zb), P(*pb, roof), P(*pa, roof), [[k, za], [k + 1, zb], [k + 1, roof], [k, roof]])
    for k in range(10):   # under the glass front: the lower storeys, down to the slope
        ua, ub = u0 + (u1 - u0) * k / 10, u0 + (u1 - u0) * (k + 1) / 10
        za, zb = gmin(ua, v0) - z, gmin(ub, v0) - z
        sh.quad(P(ua, v0, za), P(ub, v0, zb), P(ub, v0, -0.35), P(ua, v0, -0.35), [[ua, za], [ub, zb], [ub, -0.35], [ua, -0.35]])
    rf = R.outside("skyline_roof")
    rf.quad(P(u0 - 0.3, v0 + 0.6, roof), P(u0 - 0.3, v1, roof), P(u1 + 0.3, v1, roof), P(u1 + 0.3, v0 + 0.6, roof))
    R.outside("sky_mullion").quad(P(u0 - 0.3, v0 + 0.6, roof), P(u1 + 0.3, v0 + 0.6, roof), P(u1 + 0.3, v0 + 0.6, ceiling - 0.05), P(u0 - 0.3, v0 + 0.6, ceiling - 0.05))
    rf.quad(P(u0 - 0.3, v0 + 0.6, ceiling - 0.05), P(u1 + 0.3, v0 + 0.6, ceiling - 0.05), P(u1 + 0.3, v0, ceiling), P(u0 - 0.3, v0, ceiling))   # the soffit of the canopy over the doors
    R.outside("sky_mullion").quad(P(u0, v0, -0.35), P(u1, v0, -0.35), P(u1, v0, 0.02), P(u0, v0, 0.02))      # the floor's edge
    # the glass front: full height between slim mullions every 1.8 m, the doors' bay open for the sliding leaves
    du, dw, dh = H["door_u"], H["door_w"], H["door_h"]
    gl, mu = R.outside("sky_glass_in"), R.outside("sky_mullion")
    R.m("sky_oak", "threshold").quad(P(du - dw / 2 - 0.3, -DECK_D / 2, 0.0), P(du + dw / 2 + 0.3, -DECK_D / 2, 0.0), P(du + dw / 2 + 0.3, v0, 0.0), P(du - dw / 2 - 0.3, v0, 0.0),
                                     [[0, 0], [dw + 0.6, 0], [dw + 0.6, 1.2], [0, 1.2]])
    bays = np.arange(u0, u1 + 1e-6, (u1 - u0) / 14)   # (the doors fill one bay, between its mullions)
    da, db = du - dw / 2 - 0.06, du + dw / 2 + 0.06
    for ua, ub in zip(bays, bays[1:]):
        for a, b in ((ua, min(ub, da)), (max(ua, db), ub)):
            if b - a > 0.05:
                gl.quad(P(a, v0, 0.02), P(b, v0, 0.02), P(b, v0, ceiling), P(a, v0, ceiling))
    gl.quad(P(da, v0, dh + 0.12), P(db, v0, dh + 0.12), P(db, v0, ceiling), P(da, v0, ceiling))   # the glass over the doors
    for u in [q for q in bays if not da - 0.15 < q < db + 0.15] + [da, db]:
        mu.box(P(u, v0, 0.0), P(u, v0, ceiling), 0.07, 0.16)
    mu.box(P(da - 0.04, v0, dh + 0.06), P(db + 0.04, v0, dh + 0.06), 0.14, 0.14)   # the transom with the doors' track
    mu.box(P(u0, v0, 0.04), P(u1, v0, 0.04), 0.07, 0.08)
    mu.box(P(u0, v0, ceiling), P(u1, v0, ceiling), 0.07, 0.12)
    # the sliding doors: two glass leaves in slim frames, parting from the middle
    leaves = []
    for sgn in (-1, 1):
        lg, lf = R.door(f"door_{'w' if sgn < 0 else 'e'}", "sky_door_glass"), R.door(f"door_{'w' if sgn < 0 else 'e'}", "sky_door_frame")
        a, b = du + sgn * 0.01, du + sgn * dw / 2
        lo, hi = min(a, b), max(a, b)
        lg.quad(P(lo, v0 - 0.06, 0.03), P(hi, v0 - 0.06, 0.03), P(hi, v0 - 0.06, dh - 0.02), P(lo, v0 - 0.06, dh - 0.02))
        for (p0, p1) in (((lo, 0.0), (lo, dh)), ((hi, 0.0), (hi, dh)), ((lo, 0.02), (hi, 0.02)), ((lo, dh - 0.02), (hi, dh - 0.02))):
            lf.box(P(p0[0], v0 - 0.06, p0[1]), P(p1[0], v0 - 0.06, p1[1]), 0.05, 0.05)
        lf.box(P(du + sgn * 0.12, v0 - 0.1, 0.9), P(du + sgn * 0.12, v0 - 0.1, 1.3), 0.025, 0.025)   # the pull handle
        e = ax * sgn * (dw / 2 - 0.02)
        leaves.append({"meshes": [lg.name, lf.name], "slide": [round(float(e[0]), 3), round(float(e[1]), 3)]})
    # tables for four along the glass, round tables for six behind, a host's stand by the doors; the chairs
    tables = []
    for u in (-10.8, -8.2, -5.6, -3.0, -0.4, 7.4, 10.0):
        tables.append(("square", u, v0 - 1.55))
    for u in (-9.6, -6.0, -2.4, 8.6):
        tables.append(("round", u, v0 - 4.6))
    seats = []
    for kind, u, v in tables:
        if kind == "square":
            cuboid(R.f("sky_table"), Pf, u - 0.45, u + 0.45, v - 0.45, v + 0.45, 0.72, 0.76)
            R.f("sky_steel").box(P(u, v, 0.0), P(u, v, 0.72), 0.07, 0.07)
            cuboid(R.f("sky_steel"), Pf, u - 0.28, u + 0.28, v - 0.28, v + 0.28, 0.0, 0.02)
            places = [(u - 0.35, v + 0.68, (0, -1)), (u + 0.35, v + 0.68, (0, -1)), (u - 0.35, v - 0.68, (0, 1)), (u + 0.35, v - 0.68, (0, 1))]
        else:
            x, y, _ = P(u, v, 0)
            R.f("sky_cloth").lathe([(z + 0.5, 0.0), (z + 0.5, 0.82), (z + 0.76, 0.82), (z + 0.78, 0.0)], (x, y), segs=20)
            places = [(u + 1.15 * math.cos(a), v + 1.15 * math.sin(a), (-math.cos(a), -math.sin(a))) for a in np.linspace(0, 2 * math.pi, 7)[:-1] + 0.3]
        for (cu, cv, f) in places:
            chair(R, Pf, cu, cv, 0.0, f)
            seats.append((cu, cv, f))
        if kind == "square":   # the setting: a carafe and two glasses' glint
            R.f("sky_bottles").tube([P(u + 0.1, v, 0.76), P(u + 0.1, v, 0.98)], 0.04, sides=6)
    # the buffet: an island of pale stone with lit food under a glass guard, and the stations along the schist wall;
    # the bar at the east end with its shelves of bottles
    cuboid(R.f("sky_counter"), Pf, -8.0, 1.5, -11.2, -12.2, 0.0, 0.92)
    cuboid(R.f("sky_food"), Pf, -7.8, 1.3, -11.35, -12.05, 0.92, 1.0)
    R.f("sky_glass_in").quad(P(-7.8, -11.25, 1.32), P(1.3, -11.25, 1.32), P(1.3, -11.7, 1.42), P(-7.8, -11.7, 1.42))
    for u in np.arange(-7.6, 1.4, 1.5):
        R.f("sky_steel").box(P(u, -11.7, 0.92), P(u, -11.7, 1.42), 0.03, 0.03)
    cuboid(R.f("sky_counter"), Pf, -11.8, -2.5, v1 + 0.15, v1 + 0.85, 0.0, 0.92)
    cuboid(R.f("sky_food"), Pf, -11.6, -2.7, v1 + 0.25, v1 + 0.75, 0.92, 0.99)
    cuboid(R.f("sky_table"), Pf, 7.0, 12.2, -12.6, -13.3, 0.0, 1.08)                  # the bar
    cuboid(R.f("sky_counter"), Pf, 6.9, 12.3, -12.5, -13.4, 1.08, 1.13)
    for z0 in (1.2, 1.7, 2.2):
        cuboid(R.f("sky_table"), Pf, 6.8, 12.2, v1 + 0.15, v1 + 0.45, z0, z0 + 0.04)
        cuboid(R.f("sky_bottles"), Pf, 7.0, 12.0, v1 + 0.2, v1 + 0.4, z0 + 0.04, z0 + 0.32)
    for u in np.arange(7.4, 12.0, 0.9):                                               # stools at the bar
        x, y, _ = P(u, -12.2, 0)
        R.f("sky_steel").lathe([(z, 0.2), (z + 0.03, 0.2), (z + 0.05, 0.03), (z + 0.7, 0.03), (z + 0.72, 0.0)], (x, y), segs=10)
        R.f("sky_chair").lathe([(z + 0.7, 0.0), (z + 0.7, 0.2), (z + 0.78, 0.2), (z + 0.78, 0.0)], (x, y), segs=12)
    cuboid(R.f("sky_table"), Pf, 5.6, 6.2, -4.0, -4.5, 0.0, 1.1)                       # the host's stand, inside the doors
    # the pendants over the tables and the island
    lamps = [(u, v0 - 1.55) for _, u, _ in [t for t in tables if t[0] == "square"]] + [(u, v0 - 4.6) for _, u, _ in [t for t in tables if t[0] == "round"]] \
        + [(u, -11.7) for u in (-6.5, -3.25, 0.0)] + [(u, -12.95) for u in (8.0, 10.0, 12.0 - 0.4)]
    for u, v in lamps:
        x, y, _ = P(u, v, 0)
        pendant(R, Pf, u, v, ceiling, 2.35, r=0.24, kind="drum")
    doors = [{"id": "skyline-restaurant", "name": "The Skyline restaurant's doors", "at": [round(P(du, v0, 0)[0], 2), round(P(du, v0, 0)[1], 2), round(z, 2)],
              "reach": 3.4, "time": 0.6, "leaves": leaves}]
    surfaces = [strip("sky_int_floor_sky_oak", Pf, u0 + 0.12, u1 - 0.12, v1 + 0.12, v0 + 0.02, 0.0, label="the Skyline restaurant"),
                strip("sky_int_threshold_sky_oak", Pf, du - dw / 2 - 0.3, du + dw / 2 + 0.3, v0, -DECK_D / 2 + 0.05, 0.0, label="the Skyline restaurant's doors")]
    rooms = [{"id": "skyline-restaurant", "name": "The Skyline restaurant", "note": "the dining room behind the deck, 450 m over the lake: the Remarkables through the glass",
              "floor": round(z, 2), "height": ceiling, "door": "skyline-restaurant",
              "ring": [round(q, 2) for p in hall_ring(c, ax, out, -0.1) for q in p],
              "way": [[round(q, 2) for q in P(du, 0.8, 0)[:2]], [round(q, 2) for q in P(du, v0 + 0.8, 0)[:2]], [round(q, 2) for q in P(du, v0 - 1.0, 0)[:2]],
                      [round(q, 2) for q in P(du, v0 - 3.2, 0)[:2]]]}]
    glows = []
    return R.out(), doors, rooms, surfaces, glows, seats


DECK_D = 3.6   # the deck's depth (city.py DECK)


class _DeckFrame:
    """The deck's frame as an archkit-style callable: (u, v, h) -> (x, y, z)."""

    def __init__(self, c, ax, out, z):
        self.c, self.ax, self.out, self.z = c, ax, out, z

    def __call__(self, u, v, h):
        q = self.c + self.ax * u + self.out * v
        return (float(q[0]), float(q[1]), self.z + h)


_CACHE = {}


def build(ground, deck_frame):
    """Every interior: (meshes, doors, rooms, surfaces, glows, seats), made once per run."""
    if "all" not in _CACHE:
        import importlib.util
        key = "queenstown_heritage"
        if key not in sys.modules:
            spec = importlib.util.spec_from_file_location(key, os.path.join(HERE, "heritage.py"))
            sys.modules[key] = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(sys.modules[key])
        H = sys.modules[key]
        out = [[], [], [], [], []]
        for part in (st_peters(H, ground), williams(H, ground), restaurant(deck_frame, ground, None)[:5]):
            for k in range(5):
                out[k] += part[k]
        seats = restaurant(deck_frame, ground, None)[5]
        _CACHE["all"] = (*out, seats)
    return _CACHE["all"]
