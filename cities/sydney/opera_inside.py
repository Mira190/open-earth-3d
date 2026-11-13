"""Inside the Sydney Opera House: the rooms you walk into, under the shells cities/sydney/city.py builds.

What is published, and what is drawn from it (docs/cities/sydney.md, "Inside the Opera House", has the sources):

  The plan      Each hall's stage is at its south end and its audience faces south: you come up the Monumental
                Steps into the southern foyer under the first shell, walk north along a side foyer past the
                brush-box-clad "carcass" of the auditorium, where the shells' pedestals stand, and reach the
                northern foyer under the last shell, its glass wall leaning out over the harbour (Sydney Opera
                House Conservation Management Plan, 4th edition, 2017; the venue's technical specifications).
  Joan Sutherland Theatre  (east) proscenium opening 11.35 m wide and up to 7.10 m high, a flat stage with
                "extremely limited" wings, an orchestra pit for up to 70 players, 1,503 seats; walls and ceiling
                of carabeen plywood painted matt black, a brush box floor, seats of white birch with red wool, a
                black velour house curtain (technical specification, 2024).
  Concert Hall  (west) a stage 14.5 m across at its front and 12.3 m deep with the choir stalls and the Grand
                Organ behind it (15 m high and 13 m wide, 109 burnished tin pipes in its front), brush box walls
                and floor, a white birch ceiling, seats of white birch with magenta wool, and since 2022 eighteen
                magenta petals over the stage (technical specification, 2024; ARM Architecture and Arup's renewal).
  The foyers    Peter Hall's signature colours: red for the theatre and its foyers, purple for the Concert
                Hall's; brush box bars lit by polycarbonate spheres on poles; bronze rails (CMP).
  Bennelong     the restaurant under the smallest shells, on terraces that continue the steps outside, the ribs
                bare overhead (Tonkin Zulaikha Greer's fit-out, 2015).

No measured survey of the inside is published in a form that can be redrawn, and the shells here stand on the
ridges OpenStreetMap maps at sizes taken from photographs, so the rooms are fitted to the shells as built here: every
wall and ceiling stops short of the ribs and louvres over it (Envelope).
  The levels   the southern foyer at the doors' level, the podium's deck (RL 14.70 m; the real one is lower, RL 12.80 m,
                under the Monumental Steps); a straight flight up each side foyer to a gallery at the northern foyer's
                level, RL 18.59 m (CMP table 5.1), a landing behind the auditorium with the bar, and the broad stair
                down to the lower level by the glass. Walked end to end by tools/foyer_walk.js.
  The house    stalls on a rake, a circle over their back and boxes in tiers along the side walls (the theatre has 865,
                466 and 158: technical specification, 2024). Fitted under the shells as built here, the theatre seats
                693, 260 and 112, the Concert Hall 1,320, 423 and 112. The seats are a moulded birch shell with wool on
                the seat and the back and a shared armrest (seat_model); the rows stop a walker (oh_seat_hit); round
                the seats kept for you the audience are seated Rocketbox people (web/game/show.js audience), the
                boxes beyond them. No stair reaches the circle or the boxes.
"""
import math
import os
import sys

import numpy as np
import shapely
from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), "pipeline"))
import archkit as ak  # noqa: E402
from meshkit import Mesh  # noqa: E402

FAR = 140   # the furnishings are drawn within this many metres

MATERIALS = {
    # what the foyers are made of: brush box (the auditorium's carcass, the bars, the stairs), off-form concrete,
    # the signature carpets, bronze
    "oh_brushbox": {"color": "#8a5a3c", "roughness": 0.5, "metalness": 0.0, "pattern": "granite", "joints_m": [0.45, 0.0], "emissive": "#ffc98a", "glow": 0.16, "glow_day": 0.06},
    "oh_brushbox_floor": {"color": "#94603f", "roughness": 0.42, "metalness": 0.0, "pattern": "granite", "joints_m": [0.13, 2.4], "decal": True, "emissive": "#ffc98a", "glow": 0.1, "glow_day": 0.03},
    "oh_carpet_red": {"color": "#8e1f26", "roughness": 1.0, "metalness": 0.0, "decal": True, "emissive": "#ffb07a", "glow": 0.1, "glow_day": 0.02},
    "oh_carpet_purple": {"color": "#6a2460", "roughness": 1.0, "metalness": 0.0, "decal": True, "emissive": "#ffb0c8", "glow": 0.1, "glow_day": 0.02},
    "oh_concrete": {"color": "#cfc5b3", "roughness": 0.9, "metalness": 0.0, "emissive": "#ffc98a", "glow": 0.2},
    "oh_bronze": {"color": "#6b4b2c", "roughness": 0.35, "metalness": 0.85},
    "oh_black": {"color": "#141314", "roughness": 0.9, "metalness": 0.0},
    "oh_velour": {"color": "#0d0c0e", "roughness": 1.0, "metalness": 0.0, "solid": False},
    "oh_birch": {"color": "#d9c49c", "roughness": 0.45, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 0.0], "emissive": "#ffdcae", "glow": 0.3, "glow_day": 0.14},
    "oh_birch_seat": {"color": "#a8926c", "roughness": 0.5, "metalness": 0.0},
    "oh_wool_red": {"color": "#a3161d", "roughness": 1.0, "metalness": 0.0, "emissive": "#ff6a5a", "glow": 0.1, "glow_day": 0.05},
    "oh_wool_magenta": {"color": "#b01f6e", "roughness": 1.0, "metalness": 0.0, "emissive": "#ff6ab0", "glow": 0.1, "glow_day": 0.05},
    "oh_petal": {"color": "#c0207a", "roughness": 0.35, "metalness": 0.0, "emissive": "#ff5aa8", "glow": 0.35, "glow_day": 0.2},
    "oh_tin": {"color": "#c9cbc8", "roughness": 0.22, "metalness": 0.9, "emissive": "#fff0d8", "glow": 0.25, "glow_day": 0.12},
    # what lights a room, by day as well: the downlights, the bars' spheres, the stands' lamps, the exit signs
    "oh_lamp": {"color": "#f6e7c8", "roughness": 0.4, "metalness": 0.0, "emissive": "#ffd9a0", "glow": 2.2, "glow_day": 1.0},
    "oh_sphere": {"color": "#f4efe2", "roughness": 0.3, "metalness": 0.0, "emissive": "#fff0cc", "glow": 1.8, "glow_day": 0.9},
    "oh_bottles": {"color": "#5a3a22", "roughness": 0.15, "metalness": 0.2, "emissive": "#ffb860", "glow": 0.7, "glow_day": 0.4},
    "oh_stone": {"color": "#d8d2c6", "roughness": 0.3, "metalness": 0.0, "emissive": "#ffd9a0", "glow": 0.14},
    "oh_leather": {"color": "#3a2a22", "roughness": 0.6, "metalness": 0.0},
    "oh_felt": {"color": "#55504a", "roughness": 1.0, "metalness": 0.0, "emissive": "#ffc98a", "glow": 0.12},
    "oh_resin": {"color": "#efe6d2", "roughness": 0.3, "metalness": 0.0, "emissive": "#ffd9a0", "glow": 0.9, "glow_day": 0.35},
    "oh_ochre": {"color": "#a8622a", "roughness": 1.0, "metalness": 0.0, "decal": True, "emissive": "#ffb07a", "glow": 0.1, "glow_day": 0.02},
    "oh_mural_blue": {"color": "#2c2f7a", "roughness": 0.8, "metalness": 0.0, "emissive": "#8a90ff", "glow": 0.3, "glow_day": 0.12},
    "oh_mural_ochre": {"color": "#b5632a", "roughness": 0.8, "metalness": 0.0, "emissive": "#ffb070", "glow": 0.3, "glow_day": 0.12},
    # the doors: their leaves are not walls (web/game/nav.js); the portal is
    "oh_door_glass": {"color": "#4a3320", "roughness": 0.05, "metalness": 0.2, "opacity": 0.3, "solid": False},
    "oh_side_glass": {"color": "#4a3320", "roughness": 0.05, "metalness": 0.2, "opacity": 0.35},
    "oh_door_frame": {"color": "#6b4b2c", "roughness": 0.35, "metalness": 0.85, "solid": False},
    "oh_door_leaf": {"color": "#8a5a3c", "roughness": 0.5, "metalness": 0.0, "solid": False},
    # the stage: Seville at noon for Carmen, lit as a stage is, by day as well
    "oh_stage": {"color": "#2a2622", "roughness": 0.7, "metalness": 0.0, "emissive": "#ffd0a0", "glow": 0.5, "glow_day": 0.5},
    "oh_set_wall": {"color": "#c98a4a", "roughness": 0.95, "metalness": 0.0, "emissive": "#ffb060", "glow": 0.9, "glow_day": 0.9},
    "oh_set_white": {"color": "#e8dcc4", "roughness": 0.95, "metalness": 0.0, "emissive": "#ffe0b0", "glow": 0.9, "glow_day": 0.9},
    "oh_set_sky": {"color": "#3a5fae", "roughness": 1.0, "metalness": 0.0, "emissive": "#6f9cff", "glow": 1.1, "glow_day": 1.1},
    "oh_set_dark": {"color": "#3a2418", "roughness": 0.9, "metalness": 0.0, "emissive": "#ff9a50", "glow": 0.3, "glow_day": 0.3},
    "oh_set_tile": {"color": "#8a3a22", "roughness": 0.8, "metalness": 0.0, "emissive": "#ff9a60", "glow": 0.7, "glow_day": 0.7},
    # what stops a walker at the rows of seats, drawn by nothing (the seats are instanced, web/game/nav.js reads this)
    "oh_seat_hit": {"color": "#000000", "roughness": 1.0, "metalness": 0.0, "opacity": 0.0},
    # the audience, seen from behind in the dark
    "oh_patron_dark": {"color": "#1d1e24", "roughness": 0.9, "metalness": 0.0},
    "oh_patron_warm": {"color": "#5a2f2a", "roughness": 0.9, "metalness": 0.0},
    "oh_patron_pale": {"color": "#7d7468", "roughness": 0.9, "metalness": 0.0},
    "oh_skin": {"color": "#b58a6c", "roughness": 0.8, "metalness": 0.0},
    "oh_hair": {"color": "#2a211c", "roughness": 0.9, "metalness": 0.0},
}
# the circle and the boxes, which no one walks up to (no stair reaches them here): drawn, not solid. Up there, over
# the floor beneath, they would stand in the collision world's 2 m cells (web/game/nav.js BAND), which reach out
# through the auditorium's wall into the side foyers' galleries at a walker's head
for _k in ("oh_brushbox", "oh_birch", "oh_black", "oh_wool_red", "oh_wool_magenta"):
    MATERIALS[_k + "_hung"] = {**MATERIALS[_k], "solid": False}
FLOODLIT = {k for k, v in MATERIALS.items() if "emissive" in v}
# who sits round you at the opera (web/game/show.js audience): Rocketbox avatars the NPCs already use, dressed for an evening out
AUDIENCE_CAST = ["R_Business_Female_02", "R_Business_Male_03", "R_Female_Adult_08", "R_Male_Adult_13", "R_Business_Female_03",
                 "R_Business_Male_06", "R_Female_Party_02", "R_Male_Adult_05", "R_Business_Female_04_f011", "R_Female_Adult_12",
                 "R_Male_Adult_11", "R_Female_Adult_13"]
UV = {k for k, v in MATERIALS.items() if "pattern" in v}

# Each hall in its own frame: u along its ridges from the first shell's tip (south), v to the east. `stage`: where
# its stage or platform begins and where the proscenium (or the platform's front) is, and its half-width; `house`:
# the auditorium's rear wall and half-width; `rake`: how high the last row stands over the first
HALLS = {
    "joan_sutherland": {"name": "Joan Sutherland Theatre", "id": "jst", "carpet": "oh_carpet_red", "wool": "oh_wool_red", "lining": "oh_black",
                        "stage": (29.5, 46.0, 8.6), "house": (73.5, 11.4), "rake": 2.5, "opening": (11.35, 7.1), "stage_m": 1.1,
                        "ceiling": (8.2, 10.6), "bounce": "#7a5a48", "kind": "theatre",
                        "circle": 8, "boxes": 2},
    "concert": {"name": "Concert Hall", "id": "ch", "carpet": "oh_carpet_purple", "wool": "oh_wool_magenta", "lining": "oh_brushbox",
                "stage": (40.5, 55.0, 9.6), "house": (91.0, 14.6), "rake": 3.2, "opening": None, "stage_m": 0.9,
                "ceiling": (9.0, 15.0), "bounce": "#6a4a30", "kind": "concert",
                "circle": 9, "boxes": 1},
}


class Envelope:
    """How high the shells' ribs, the louvre walls and the side shells stand over a hall's floor, in its frame: the
    exterior's own meshes sampled on a half-metre grid, so that nothing inside is built through them."""

    def __init__(self, meshes, origin, ax, east, z0, length):
        self.o, self.ax, self.east, self.z0 = np.asarray(origin, float), np.asarray(ax, float), np.asarray(east, float), z0
        self.cell, self.u0, self.v0 = 0.5, -4.0, -34.0
        nu, nv = int((length + 12) / self.cell), int(68 / self.cell)
        H = np.full((nu, nv), 80.0)
        for m in meshes:
            if not len(m.i):
                continue
            V = np.asarray(m.v, float)
            T = V[np.asarray(m.i).reshape(-1, 3)]
            e = np.maximum.reduce([np.linalg.norm(T[:, 1] - T[:, 0], axis=1), np.linalg.norm(T[:, 2] - T[:, 0], axis=1), np.linalg.norm(T[:, 2] - T[:, 1], axis=1)])
            for k in sorted(set(np.minimum(np.ceil(e / 0.3).astype(int), 40))):
                sel = T[np.minimum(np.ceil(e / 0.3).astype(int), 40) == k]
                ij = np.array([(i / k, j / k) for i in range(k + 1) for j in range(k + 1 - i)])
                Q = sel[:, None, 0] + (sel[:, None, 1] - sel[:, None, 0]) * ij[None, :, :1] + (sel[:, None, 2] - sel[:, None, 0]) * ij[None, :, 1:]
                Q = Q.reshape(-1, 3)
                d = Q[:, :2] - self.o
                iu = np.floor((d @ self.ax - self.u0) / self.cell).astype(int)
                iv = np.floor((d @ self.east - self.v0) / self.cell).astype(int)
                ok = (iu >= 0) & (iv >= 0) & (iu < nu) & (iv < nv) & (Q[:, 2] > z0 + 0.3)
                np.minimum.at(H, (iu[ok], iv[ok]), Q[ok, 2] - z0)
        from scipy import ndimage
        self.H = ndimage.minimum_filter(H, size=5)  # (a metre's margin round every point)

    def __call__(self, u, v):
        iu, iv = int((u - self.u0) / self.cell), int((v - self.v0) / self.cell)
        if iu < 0 or iv < 0 or iu >= self.H.shape[0] or iv >= self.H.shape[1]:
            return 80.0
        return float(self.H[iu, iv])


class Room:
    """One interior's meshes by material and part, sheltered (Mesh.sky); its fittings drawn near (far)."""

    def __init__(self, prefix, sky, bounce):
        self.prefix, self.sky, self.bounce, self.meshes = prefix, sky, bounce, {}

    def m(self, mat, part="shell", sky=None):
        key = (mat, part)
        if key not in self.meshes:
            me = Mesh(f"{self.prefix}_{part}_{mat}", mat, False, floodlit=mat in FLOODLIT, uv=mat in UV)
            me.sky, me.bounce = self.sky if sky is None else sky, self.bounce
            if part.startswith("fit"):
                me.far = FAR
            self.meshes[key] = me
        return self.meshes[key]

    def f(self, mat, sky=None):
        return self.m(mat, "fit", sky)

    def out(self):
        return [m for m in self.meshes.values() if m.i]


def frame(origin, ax, east, z0):
    o, ax, east = np.asarray(origin, float), np.asarray(ax, float), np.asarray(east, float)

    def P(u, v, h):
        q = o + ax * u + east * v
        return (float(q[0]), float(q[1]), z0 + h)
    return P


def strip(name, P, u0, u1, v0, v1, profile, label):
    """A walkable strip (game.json surfaces) along u between v0 and v1: profile [(u, height over the frame's floor)]."""
    o = P(0, (v0 + v1) / 2, 0)
    e = np.array(P(1, 0, 0)[:2]) - np.array(P(0, 0, 0)[:2])
    return {"name": name, "type": "strip", "origin": [round(o[0], 2), round(o[1], 2)], "axis": [round(float(e[0]), 5), round(float(e[1]), 5)],
            "half_width": round(abs(v1 - v0) / 2, 2), "profile": [[round(u, 2), round(o[2] + h, 2)] for u, h in profile],
            "thickness": 0.3, "mesh": name, "drape": False, "fly_under": False, "label": label}


def doorway(P, a, b, t, z0, z1, top, name):
    pa, pb = P(*a, z0), P(*b, z0)
    return {"name": name, "a": [round(pa[0], 3), round(pa[1], 3)], "b": [round(pb[0], 3), round(pb[1], 3)], "t": round(t, 3),
            "z0": round(pa[2], 2), "z1": round(P(*a, z1)[2], 2), "top": round(P(*a, top)[2], 2)}


def xy(P, u, v):
    return [round(q, 2) for q in P(u, v, 0)[:2]]


def env_wall(m, P, E, a, b, h, z0=0.0, step=1.5, t=0.0):
    """A wall from a to b (u, v) up to h, or as high as the shells over it leave room for; returns its lowest top."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    L = float(np.linalg.norm(b - a))
    n = max(1, int(math.ceil(L / step)))
    tops = [min(h, E(*(a + (b - a) * k / n)) - 0.5) for k in range(n + 1)]
    nrm = np.array([(b - a)[1], -(b - a)[0]]) / L * t / 2
    for k in range(n):
        p, q = a + (b - a) * k / n, a + (b - a) * (k + 1) / n
        if tops[k] <= z0 + 0.05 and tops[k + 1] <= z0 + 0.05:
            continue
        for sgn in ((-1, 1) if t else (0,)):
            m.quad(P(*(p + nrm * sgn), z0), P(*(q + nrm * sgn), z0), P(*(q + nrm * sgn), max(z0, tops[k + 1])), P(*(p + nrm * sgn), max(z0, tops[k])),
                   [[L * k / n, z0], [L * (k + 1) / n, z0], [L * (k + 1) / n, tops[k + 1]], [L * k / n, tops[k]]])
        if t:
            m.quad(P(*(p - nrm), tops[k]), P(*(q - nrm), tops[k + 1]), P(*(q + nrm), tops[k + 1]), P(*(p + nrm), tops[k]))
    return min(tops)


def hung_wall(m, P, E, a, b, h, z0=0.0, Z=3.4):
    """env_wall, solid up to Z over the floor and drawn but not solid above it (the material's "_hung" twin). The
    auditorium's walls stand beside the side foyers' flights, and their tops, more than web/game/nav.js's BAND over
    the floor under them, would stand in the collision world's 2 m cells, which reach through the wall to the flight
    at a walker's head where it has climbed (a gallery's own wall stops a walker there: hit, below)"""
    hm = m.twin if hasattr(m, "twin") else None
    if z0 < Z:
        env_wall(m, P, E, a, b, min(h, Z), z0)
    if hm is not None:
        env_wall(hm, P, E, a, b, h, max(z0, Z))


def box(m, P, u0, u1, v0, v1, z0, z1):
    ak.block(m, P, min(u0, u1), max(u0, u1), min(v0, v1), max(v0, v1), z0, z1)


def disc(m, P, u, v, z0, z1, r, segs=12):
    x, y, g = P(u, v, 0)
    m.lathe([(g + z0, 0.0), (g + z0, r), (g + z1, r), (g + z1, 0.0)], (x, y), segs=segs)


def flat(m, P, ring, h, uv_scale=1.0):
    """A floor finish over a ring [(u, v)], triangulated."""
    poly = Polygon(ring).buffer(0)
    for g in getattr(poly, "geoms", [poly]):
        for t in shapely.constrained_delaunay_triangles(g).geoms:
            cs = [c for c in t.exterior.coords][:3]
            if (cs[1][0] - cs[0][0]) * (cs[2][1] - cs[0][1]) - (cs[1][1] - cs[0][1]) * (cs[2][0] - cs[0][0]) < 0:
                cs = cs[::-1]
            pts = [np.array(P(c[0], c[1], h)) for c in cs]
            if np.cross(pts[1] - pts[0], pts[2] - pts[0])[2] < 0:
                cs, pts = cs[::-1], pts[::-1]
            m.tri(*pts, [[c[0] * uv_scale, c[1] * uv_scale] for c in cs])


def sphere_lamp(R, P, u, v, h=2.3, r=0.2, z0=0.0):
    """One of the foyers' lights: a polycarbonate sphere on a slim pole (Peter Hall's, "Hall's Balls") standing on
    the floor at z0; with z0 None, on a bronze bracket from the wall behind it (on a gallery, out of the way)."""
    x, y, g = P(u, v, 0)
    if z0 is None:
        wx, wy, _ = P(u, v - math.copysign(0.15, v), 0)
        R.f("oh_bronze").tube([(wx, wy, g + h - r - 0.25), (x, y, g + h - r - 0.25), (x, y, g + h - r)], 0.022, sides=5)
    else:
        R.f("oh_bronze").tube([(x, y, g + z0), (x, y, g + h - r)], 0.022, sides=5)
    R.f("oh_sphere").lathe([(g + h + r * math.sin(a), r * math.cos(a)) for a in np.linspace(-math.pi / 2, math.pi / 2, 7)], (x, y), segs=10)


def lounge(R, P, u, v, face, mat="oh_leather"):
    """A low armchair facing `face` (unit (du, dv))."""
    fu, fv = face
    su, sv = -fv, fu
    Q = lambda a, b, z: P(u + fu * a + su * b, v + fv * a + sv * b, z)
    m = R.f(mat)
    for (a0, a1, b0, b1, z0, z1) in ((-0.3, 0.3, -0.32, 0.32, 0.18, 0.42), (-0.38, -0.26, -0.32, 0.32, 0.42, 0.8), (-0.3, 0.3, -0.4, -0.32, 0.18, 0.6), (-0.3, 0.3, 0.32, 0.4, 0.18, 0.6)):
        ring = [Q(a0, b0, 0)[:2], Q(a1, b0, 0)[:2], Q(a1, b1, 0)[:2], Q(a0, b1, 0)[:2]]
        g = P(u, v, 0)[2]
        ak.prism(m, ak.WORLD, ring, g + z0, g + z1)


def table(R, P, u, v, r=0.4, h=0.72, top="oh_resin"):
    x, y, g = P(u, v, 0)
    R.f("oh_bronze").tube([(x, y, g), (x, y, g + h)], 0.035, sides=6)
    R.f("oh_bronze").lathe([(g, 0.0), (g, r * 0.6), (g + 0.02, r * 0.6), (g + 0.02, 0.0)], (x, y), segs=10)
    R.f(top).lathe([(g + h, 0.0), (g + h, r), (g + h + 0.04, r), (g + h + 0.04, 0.0)], (x, y), segs=14)


def chair(R, P, u, v, face, mat="oh_leather"):
    fu, fv = face
    su, sv = -fv, fu
    Q = lambda a, b: P(u + fu * a + su * b, v + fv * a + sv * b, 0)[:2]
    g = P(u, v, 0)[2]
    ak.prism(R.f(mat), ak.WORLD, [Q(-0.22, -0.22), Q(0.22, -0.22), Q(0.22, 0.22), Q(-0.22, 0.22)], g + 0.4, g + 0.47)
    ak.prism(R.f(mat), ak.WORLD, [Q(-0.25, -0.21), Q(-0.2, -0.21), Q(-0.2, 0.21), Q(-0.25, 0.21)], g + 0.47, g + 0.88)
    for a in (-0.19, 0.19):
        for b in (-0.19, 0.19):
            q = P(u + fu * a + su * b, v + fv * a + sv * b, 0)
            R.f("oh_bronze").box((q[0], q[1], g), (q[0], q[1], g + 0.4), 0.025, 0.025)


def bar(R, P, u0, u1, v, side, stools=True):
    """A bar along u at v, serving towards `side` (+1 or -1 in v): a brush box counter with a pale stone top, the
    back bar's lit shelves of bottles behind it, stools before it."""
    box(R.f("oh_brushbox"), P, u0, u1, v - 0.3, v + 0.3, 0.0, 1.05)
    box(R.f("oh_stone"), P, u0 - 0.05, u1 + 0.05, v - 0.36, v + 0.36, 1.05, 1.1)
    b = v - side * 1.5
    box(R.f("oh_brushbox"), P, u0, u1, b - 0.2, b + 0.2, 0.0, 0.95)
    for z in (1.15, 1.6, 2.05):
        box(R.f("oh_brushbox"), P, u0, u1, b - 0.16, b + 0.16, z, z + 0.04)
        box(R.f("oh_bottles"), P, u0 + 0.15, u1 - 0.15, b - 0.1, b + 0.1, z + 0.04, z + 0.3)
    if stools:
        for u in np.arange(min(u0, u1) + 0.5, max(u0, u1) - 0.3, 0.85):
            x, y, g = P(u, v + side * 0.75, 0)
            R.f("oh_bronze").lathe([(g, 0.19), (g + 0.03, 0.19), (g + 0.05, 0.03), (g + 0.7, 0.03), (g + 0.72, 0.0)], (x, y), segs=8)
            R.f("oh_leather").lathe([(g + 0.7, 0.0), (g + 0.7, 0.19), (g + 0.77, 0.19), (g + 0.77, 0.0)], (x, y), segs=10)


def sliding_door(R, P, c, t, w, h, name, D):
    """Glass doors that part as you come up, in a bronze portal through a glass wall: at c (u, v) across the
    wall's direction t (unit (du, dv)), w wide and h high. Returns the door for game.json."""
    c, t = np.asarray(c, float), np.asarray(t, float)
    n = np.array([t[1], -t[0]])
    Q = lambda s, d, z: P(*(c + t * s + n * d), z)
    fr = R.m("oh_bronze", f"portal_{name}")
    for s in (-w / 2 - 0.08, w / 2 + 0.08):     # the portal's jambs and head, a metre deep through the glass
        fr.box(Q(s, -0.5, 0), Q(s, -0.5, h + 0.1), 0.14, 0.14)
        fr.box(Q(s, 0.5, 0), Q(s, 0.5, h + 0.1), 0.14, 0.14)
        fr.quad(Q(s, -0.5, 0), Q(s, 0.5, 0), Q(s, 0.5, h + 0.1), Q(s, -0.5, h + 0.1))
    fr.quad(Q(-w / 2 - 0.15, -0.5, h + 0.1), Q(w / 2 + 0.15, -0.5, h + 0.1), Q(w / 2 + 0.15, 0.5, h + 0.1), Q(-w / 2 - 0.15, 0.5, h + 0.1))
    fr.quad(Q(-w / 2 - 0.15, -0.5, h + 0.1), Q(w / 2 + 0.15, -0.5, h + 0.1), Q(w / 2 + 0.15, -0.5, h + 0.75), Q(-w / 2 - 0.15, -0.5, h + 0.75))
    sl = R.m("oh_side_glass", f"portal_{name}")   # fixed lights either side, out to where the wall's own glass begins
    for sgn in (-1, 1):
        sl.quad(Q(sgn * (w / 2 + 0.15), 0, 0), Q(sgn * (w / 2 + 1.15), 0, 0), Q(sgn * (w / 2 + 1.15), 0, h + 0.75), Q(sgn * (w / 2 + 0.15), 0, h + 0.75))
        fr.box(Q(sgn * (w / 2 + 1.15), 0, 0), Q(sgn * (w / 2 + 1.15), 0, h + 0.75), 0.08, 0.08)
    leaves = []
    for sgn in (-1, 1):
        lg, lf = R.m("oh_door_glass", f"door_{name}_{'a' if sgn < 0 else 'b'}", 1.0), R.m("oh_door_frame", f"door_{name}_{'a' if sgn < 0 else 'b'}", 1.0)
        lo, hi = sorted((sgn * 0.01, sgn * w / 2))
        lg.quad(Q(lo, 0, 0.03), Q(hi, 0, 0.03), Q(hi, 0, h - 0.02), Q(lo, 0, h - 0.02))
        for (p0, p1) in (((lo, 0.0), (lo, h)), ((hi, 0.0), (hi, h)), ((lo, 0.03), (hi, 0.03)), ((lo, h - 0.03), (hi, h - 0.03))):
            lf.box(Q(p0[0], 0, p0[1]), Q(p1[0], 0, p1[1]), 0.05, 0.05)
        e = (np.array(P(*(c + t), 0)[:2]) - np.array(P(*c, 0)[:2])) * sgn * (w / 2 - 0.03)
        leaves.append({"meshes": [lg.name, lf.name], "slide": [round(float(e[0]), 3), round(float(e[1]), 3)]})
    at = P(*c, 0)
    return {"id": D["id"], "name": D["name"], "at": [round(at[0], 2), round(at[1], 2), round(at[2], 2)], "reach": 3.6, "time": 0.6, "leaves": leaves,
            "frames": [doorway(P, c - t * w / 2, c + t * w / 2, 1.0, 0.0, h, h + 0.6, D["name"])]}


def swing_doors(R, P, c, t, w, h, name, D, mat="oh_door_leaf", swing=1):
    """A pair of timber doors in a wall at c (u, v) along t, swinging to the side `swing` of it."""
    c, t = np.asarray(c, float), np.asarray(t, float)
    Q = lambda s, z: P(*(c + t * s), z)
    leaves = []
    for sgn in (-1, 1):
        lf = R.m(mat, f"door_{name}_{'a' if sgn < 0 else 'b'}", 0.6)
        lo, hi = sorted((sgn * 0.01, sgn * w / 2))
        lf.box(Q((lo + hi) / 2, 0), Q((lo + hi) / 2, h), hi - lo, 0.05)
        hx = Q(sgn * w / 2, 0)
        leaves.append({"meshes": [lf.name], "hinge": [round(hx[0], 3), round(hx[1], 3)], "deg": 88 * sgn * swing})
    at = P(*c, 0)
    return {"id": D["id"], "name": D["name"], "at": [round(at[0], 2), round(at[1], 2), round(at[2], 2)], "reach": 3.0, "time": 0.7, "leaves": leaves,
            "frames": [doorway(P, c - t * w / 2, c + t * w / 2, 0.3, 0.0, h, h + 0.5, D["name"])]}


# ---------------------------------------------------------------- the seats and the audience (instanced)

def _swept(m, ys, shape, bend=lambda y: 0.0, tilt=None):
    """A section [(x, z)] swept across the seat from y = ys[0] to ys[-1] (its back curving forward at the ends by
    bend(y)), with both ends closed. tilt(x, z) -> (x, z) leans it."""
    tilt = tilt or (lambda x, z: (x, z))
    rings = [[(*(lambda q: (q[0] + bend(y), y, q[1]))(tilt(x, z)),) for x, z in shape + [shape[0]]] for y in ys]
    m.grid([[list(p) for p in r] for r in rings])
    for r in (rings[0], rings[-1]):
        y0 = r[0][1]
        ak.cap(m, lambda a, b, _z, y0=y0: (a, y0, b), [(p[0], p[2]) for p in r[:-1]], 0.0)


def seat_model(wool):
    """A theatre seat facing +x, as the Joan Sutherland Theatre's and the Concert Hall's are: a moulded white birch
    shell and a back that curves round you, its seat and back upholstered in wool and rounded at the edges, on a
    birch standard with an armrest that it shares with the seat beside it (the hall's own photographs; the Utzon
    room's and the halls' renewal, 2022). About 120 triangles: drawn for every seat of a hall, instanced."""
    shell, pad, arm = Mesh("seat_shell", "oh_birch_seat", False), Mesh("seat_pad", wool, False, floodlit=True), Mesh("seat_arm", "oh_birch_seat", False)
    ys = list(np.linspace(-0.235, 0.235, 4))
    bend = lambda y: 0.035 * (y / 0.235) ** 2          # the back curves round
    lean = lambda x, z: (x - max(0.0, z - 0.46) * 0.24, z)   # and leans back 13 degrees above the seat
    # the back: wool in front (rounded at its top), the birch shell behind it, and the seat: a cushion over a birch pan
    _swept(pad, ys, [(-0.27, 0.47), (-0.228, 0.52), (-0.228, 0.8), (-0.25, 0.91), (-0.29, 0.93), (-0.3, 0.48)], bend, lean)
    _swept(shell, ys, [(-0.3, 0.42), (-0.3, 0.93), (-0.33, 0.965), (-0.355, 0.8), (-0.33, 0.4)], bend, lean)
    _swept(pad, ys, [(-0.25, 0.4), (0.19, 0.38), (0.225, 0.44), (0.19, 0.485), (-0.22, 0.48), (-0.26, 0.45)])
    # the standard on its +y side: a birch panel from the floor, the armrest on it, rounded at the front
    ak.block(arm, ak.WORLD, -0.36, 0.08, 0.255, 0.29, 0.0, 0.6)
    _swept(arm, [0.245, 0.3], [(-0.38, 0.6), (0.12, 0.6), (0.155, 0.615), (0.15, 0.64), (0.11, 0.65), (-0.38, 0.65)])
    for m in (shell, pad, arm):
        m.sky, m.bounce = 0.12, "#3a2a22"
    return [shell, pad, arm]


def patron_model(cloth, hair):
    """Someone seated, facing +x: shoulders, neck and head over the seat's back, as the row behind sees them."""
    body, head, hr = Mesh("patron_body", cloth, False), Mesh("patron_head", "oh_skin", True), Mesh("patron_hair", hair, True)
    I = ak.WORLD
    ak.block(body, I, -0.2, 0.04, -0.21, 0.21, 0.47, 1.0)
    head.lathe([(1.0, 0.045), (1.06, 0.05), (1.12, 0.085), (1.2, 0.092)], (-0.06, 0.0), segs=6)
    hr.lathe([(1.17, 0.097), (1.25, 0.094), (1.3, 0.06), (1.32, 0.0)], (-0.07, 0.0), segs=6)
    for m in (body, head, hr):
        m.sky, m.bounce = 0.12, "#3a2a22"
    return [body, head, hr]


# ---------------------------------------------------------------- a hall

def hall_inside(key, shells, exterior, z0, deck=None):
    """One hall's rooms. shells: city.hall_shells(); exterior: the shells' own meshes (for the envelope).
    Returns a dict: meshes, doors, rooms, surfaces, props, seats, gaps (where the glass walls stand open for the
    doors), and the places the game's people and its show stand (people)."""
    C = HALLS[key]
    hid = C["id"]
    T0, T1 = shells[0][1], shells[-1][1]
    o = T0[:2]
    ax = (T1[:2] - o) / np.linalg.norm(T1[:2] - o)
    east = np.array([ax[1], -ax[0]])
    Ltot = float(np.linalg.norm(T1[:2] - o))
    P = frame(o, ax, east, z0)
    loc = lambda p: (float((p[:2] - o) @ ax), float((p[:2] - o) @ east))
    E = Envelope(exterior, o, ax, east, z0, Ltot)
    peds = [abs(loc(s[2][1])[1]) for s in shells]            # each shell's half-span
    pu = [loc(s[2][1])[0] for s in shells]                   # and how far along its pedestals stand
    R = Room(f"oh_{hid}", 0.4, C["bounce"])
    A = Room(f"oh_{hid}_aud", 0.1, C["bounce"])               # the auditorium: next to no daylight
    us0, up, hs = C["stage"]
    ur, ha = C["house"]
    sm = C["stage_m"]
    out = {"doors": [], "rooms": [], "surfaces": [], "props": [], "seats": [], "gaps": [], "people": {}, "glows": []}
    if os.environ.get('OH_PROBE'):
        print(hid, 'z0', z0, 'up', up, 'ur', ur, 'ha', ha)
        print('  Ltot', Ltot, 'peds', [round(x, 1) for x in peds], 'pu', [round(x, 1) for x in pu], 'us0', us0)
        for u in np.arange(us0 - 6, Ltot + 4, 3.0):
            print(f'  u {u:5.1f}: ' + ' '.join(f'{E(u, v):5.1f}' for v in (-ha - 4, -ha - 2.5, -ha - 1, 0, ha + 1, ha + 2.5, ha + 4)))

    # ---- the floors: the signature carpet through the foyers
    outline = [(1.2, 0.0)] + [(pu[k], peds[k] - 0.5) for k in range(len(shells))] + [(Ltot - 0.8, 0.0)] + [(pu[k], -peds[k] + 0.5) for k in range(len(shells) - 1, -1, -1)]
    carpet = Polygon(outline)
    if deck is not None:   # and on to the podium's edge under the northern glass, which leans out from it
        north = Polygon([(pu[-1], -peds[-1] + 0.5), (Ltot + 20, -peds[-1] + 0.5), (Ltot + 20, peds[-1] - 0.5), (pu[-1], peds[-1] - 0.5)])
        edge = Polygon([loc(np.array(q, float)) for q in deck]).buffer(-0.45)
        carpet = shapely.unary_union([carpet, north.intersection(edge)]).buffer(0.01)
        carpet = max(getattr(carpet, "geoms", [carpet]), key=lambda g: g.area)
    # (the carpet is laid, and the floors walked, by level once the carcass is placed: see "the levels" below)

    # ---- the entrances: sliding glass doors in bronze portals, one in each arm of the southern glass wall
    arm = np.array([pu[0], peds[0]])
    for sgn, side in ((-1, "west"), (1, "east")):
        a = np.array([arm[0], arm[1] * sgn])
        t = a / np.linalg.norm(a)
        c = a * 0.55
        d = sliding_door(R, P, c, t, 2.4, 2.5, f"s{side[0]}", {"id": f"{hid}-south-{side}", "name": f"{C['name']}, the southern foyer's {side} doors"})
        out["doors"].append(d)
        out["gaps"].append((P(*c, 0)[:2], 2.25, 3.25))
        n = np.array([t[1], -t[0]]) * (1 if sgn > 0 else -1)   # into the foyer: towards the hall's axis and north
        n = n if n @ np.array([1.0, -sgn * 0.2]) > 0 else -n
        if sgn > 0:
            way = [xy(P, *(c - n * 4.5)), xy(P, *(c - n * 1.0)), xy(P, *(c + n * 1.2)), xy(P, *(c + n * 4.0))]
            out["rooms"].append({"id": f"{hid}-foyers", "name": f"{C['name']}: the foyers",
                                 "note": "the shells' ribs fan overhead; the northern foyer looks down the harbour",
                                 "floor": round(z0, 2), "height": 30, "door": d["id"], "ring": [q for p in outline for q in xy(P, *p)], "way": way})

    # ---- the stage house and the auditorium: one carcass, clad in brush box towards the foyers
    car = R.m("oh_brushbox", "carcass")
    lin = A.m(C["lining"], "lining")
    car.twin, lin.twin = R.m("oh_brushbox_hung", "carcass"), A.m(C["lining"] + "_hung", "lining")
    T = 0.35
    for sgn in (-1, 1):
        env_wall(car, P, E, (us0, sgn * (hs + T)), (up, sgn * (hs + T)), 14.0)
        env_wall(car, P, E, (up - 0.25, sgn * (hs + T)), (up - 0.25, sgn * (ha + T)), 12.0)
        env_wall(lin, P, E, (us0, sgn * hs), (up, sgn * hs), 14.0)
    env_wall(car, P, E, (us0 - T, -hs - T), (us0 - T, hs + T), 14.0)
    env_wall(lin, P, E, (us0, -hs), (us0, hs), 14.0)
    # the side walls, with a pair of doors each onto the cross aisle before the first row
    du, dw, dh = up + 3.4, 1.8, 2.3
    for sgn, side in ((-1, "west"), (1, "east")):
        v = sgn * ha
        for (a, b) in (((up, v), (du - dw / 2, v)), ((du + dw / 2, v), (ur, v))):
            hung_wall(car, P, E, (a[0], a[1] + sgn * T), (b[0], b[1] + sgn * T), 12.0)
            hung_wall(lin, P, E, a, b, 12.0)
        for m_, vv in ((car, v + sgn * T), (lin, v)):
            hung_wall(m_, P, E, (du - dw / 2, vv), (du + dw / 2, vv), 12.0, z0=dh)
        box(R.m("oh_bronze", "carcass"), P, du - dw / 2 - 0.06, du - dw / 2, v, v + sgn * T, 0, dh)
        box(R.m("oh_bronze", "carcass"), P, du + dw / 2, du + dw / 2 + 0.06, v, v + sgn * T, 0, dh)
        d = swing_doors(R, P, (du, v + sgn * T / 2), (1.0, 0.0), dw, dh, f"a{side[0]}",
                        {"id": f"{hid}-stalls-{side}", "name": f"{C['name']}, the stalls' {side} doors"}, swing=-sgn)
        d["frames"][0]["t"] = T + 0.1
        out["doors"].append(d)
        if sgn < 0:
            out["rooms"].insert(0, {"id": f"{hid}-auditorium", "name": C["name"],
                                    "note": "the stalls; the stage is at the south end" if C["kind"] == "theatre" else "the stalls, under the white birch ceiling",
                                    "floor": round(z0, 2), "height": 12, "door": d["id"],
                                    "ring": [q for p in ((up, -ha), (ur, -ha), (ur, ha), (up, ha)) for q in xy(P, *p)],
                                    "way": [xy(P, du, v + sgn * 4.2 if abs(v) + 4.4 < min(peds[1], peds[2]) else v + sgn * 2.4), xy(P, du, v + sgn * 1.4), xy(P, du, v - sgn * 1.2), xy(P, du, v - sgn * 4.5)]})
    hung_wall(car, P, E, (ur + T, -ha - T), (ur + T, ha + T), 12.0)
    hung_wall(lin, P, E, (ur, -ha), (ur, ha), 12.0)
    # the ceiling: as high as the shells leave room for, higher along the middle
    c0, c1 = C["ceiling"]
    cm = A.m("oh_birch_hung" if C["kind"] == "concert" else "oh_black_hung", "ceiling")
    nu_, nv_ = int((ur - up) / 2) + 1, 8
    grid = []
    for i in range(nu_ + 1):
        u = up + (ur - up) * i / nu_
        row = []
        for j in range(nv_ + 1):
            v = -ha + 2 * ha * j / nv_
            h = c0 + (c1 - c0) * (1 - (v / ha) ** 2)
            row.append(np.array(P(u, v, min(h, E(u, v) - 0.9))))
        grid.append(row)
    cm.grid(grid, [[[i * 2.0, j * 2.0 * ha / nv_] for j in range(nv_ + 1)] for i in range(nu_ + 1)])
    ceil_at = lambda u, v: min(c0 + (c1 - c0) * (1 - (v / ha) ** 2), E(u, v) - 0.9)
    # and over the stage: the theatre's fly tower as high as the shell lets it stand, the hall's ceiling carried on over its platform
    fly = 13.0 if C["kind"] == "theatre" else c1
    sg = [[np.array(P(us0 + (up - us0) * i / 6, -hs + 2 * hs * j / 6, min(fly if C["kind"] == "theatre" else c0 + (c1 - c0) * (1 - ((-hs + 2 * hs * j / 6) / ha) ** 2),
                                                                         E(us0 + (up - us0) * i / 6, -hs + 2 * hs * j / 6) - 0.9))) for j in range(7)] for i in range(7)]
    cm.grid(sg, [[[i * 2.0, j * 2.0] for j in range(7)] for i in range(7)])
    stage_top = lambda u, v: min(fly, E(u, v) - 0.9)
    # the house lights: downlights in the ceiling, dim
    for u in np.arange(up + 4, ur - 2, 5.0):
        for v in np.linspace(-ha + 3, ha - 3, 4):
            disc(A.f("oh_lamp"), P, u, v, ceil_at(u, v) - 0.08, ceil_at(u, v) - 0.02, 0.09, 6)

    # ---- the stalls: a cross aisle, then the rows on one rake, a middle aisle and one along each wall
    row0, pitch = up + 5.4, 0.95
    nrows = int((ur - 1.4 - row0) / pitch)
    rise = C["rake"] / nrows
    rake_u0, rake_u1 = row0 - 0.7, row0 + nrows * pitch
    fl = A.m("oh_brushbox_floor", "floor")
    fl.quad(P(up, -ha, 0.06), P(rake_u0, -ha, 0.06), P(rake_u0, ha, 0.06), P(up, ha, 0.06), [[-ha, up], [-ha, rake_u0], [ha, rake_u0], [ha, up]])
    steps = A.m("oh_brushbox", "rows")
    for k in range(nrows):
        u = rake_u0 + k * pitch
        z = (k + 1) * rise
        steps.quad(P(u, -ha, z), P(u + pitch, -ha, z), P(u + pitch, ha, z), P(u, ha, z), [[u, -ha], [u + pitch, -ha], [u + pitch, ha], [u, ha]])
        steps.quad(P(u, -ha, z - rise), P(u, ha, z - rise), P(u, ha, z), P(u, -ha, z), [[-ha, 0], [ha, 0], [ha, rise], [-ha, rise]])
    steps.quad(P(rake_u1, -ha, C["rake"]), P(ur, -ha, C["rake"]), P(ur, ha, C["rake"]), P(rake_u1, ha, C["rake"]))
    out["surfaces"].append(strip(f"oh_{hid}_aud_rows_oh_brushbox", P, rake_u0, ur - 0.1, -ha + 0.05, ha - 0.05,
                                 [(rake_u0 - 0.05, 0.0), (rake_u0, rise)] + [(rake_u0 + nrows * pitch, C["rake"]), (ur - 0.1, C["rake"])], f"{C['name']}, the stalls"))
    seats, patrons = [], [[], [], []]
    heading = math.atan2(-ax[1], -ax[0])   # the seats face the stage: south along the hall
    rng = np.random.default_rng(7 if hid == "jst" else 11)
    hit = A.m("oh_seat_hit", "hit")   # what stops a walker: a block over each row's seats, either side of the middle aisle
    kfree = nrows // 3
    near_you = []   # the patrons round the seats kept for you: drawn as people, not as boxes (show "audience")
    count = {"stalls": 0, "circle": 0, "boxes": 0}

    def seat_at(u, v, z, h, where, full=0.62, kept=False):
        x, y, _ = P(u, v, 0)
        seats.append([round(x, 2), round(y, 2), round(z0 + z, 2), round(h, 3)])
        count[where] += 1
        if kept or rng.random() >= full:
            return None
        k = int(rng.integers(0, 3))
        patrons[k].append([round(x, 2), round(y, 2), round(z0 + z, 2), round(h, 3), round(float(0.92 + 0.14 * rng.random()), 2)])
        return (k, len(patrons[k]) - 1)

    for k in range(nrows):
        u = row0 + k * pitch
        z = (k + 1) * rise
        vs = [v for v in np.arange(-ha + 1.5, ha - 1.49, 0.56) if abs(v) > 0.85]
        for v in vs:
            keep_free = abs(v) < 1.6 and kfree <= k <= kfree + 1   # the places kept for you, by the middle aisle
            got = seat_at(u, v, z, heading, "stalls", kept=keep_free)
            if got and abs(v) < 4.6 and kfree - 4 <= k <= kfree + 2:
                near_you.append((abs(k - kfree - 0.5) + abs(v) / 0.56 * 0.6, got, round(float(z0 + z), 2)))
            if keep_free:
                x, y, _ = P(u, v, 0)
                out["seats"].append({"id": f"{hid}-stalls-{len(out['seats']) + 1}", "name": f"{C['name']}, the stalls", "verb": "Take your seat",
                                     "at": [round(x, 2), round(y, 2), round(z0 + z, 2)], "face": [round(float(-ax[0]), 4), round(float(-ax[1]), 4)],
                                     "eye": 1.14, "pitch": -0.02, **({"show": f"{hid}-show"} if C["kind"] == "theatre" else {})})
        for side in (-1, 1):   # the row's block of seats on this side: from the row in front's backs to this row's
            vi = [v for v in vs if v * side > 0]
            a0 = u - (0.25 if k == 0 else pitch - 0.42)
            box(hit, P, a0, u + 0.42, min(vi) - 0.28, max(vi) + 0.28, z, z + 0.85)

    # ---- the circle: over the back of the stalls, its rows climbing to the rear wall, a birch parapet along its front
    stall_z = lambda u: min(C["rake"], max(0.0, (u - rake_u0) / (rake_u1 - rake_u0) * C["rake"]))   # the stalls' floor under u
    uc0 = ur
    if C.get("circle"):
        nc, cp, crise = C["circle"], 0.95, 0.3
        uc0 = ur - nc * cp - 0.6
        zc = stall_z(uc0) + 3.0                  # its front stands 3 m over the stalls' floor under it
        cf, cs_, cpar = A.m("oh_brushbox_hung", "circle"), A.m(C["lining"] + "_hung", "circle"), A.m("oh_birch_hung", "circle")
        hc = ha - 0.05
        for k in range(nc + 1):                  # the steps (the front one a landing behind the parapet)
            ua, ub = uc0 + k * cp, min(ur, uc0 + (k + 1) * cp)
            zk = zc + k * crise
            box(cf, P, ua, ub if k < nc else ur, -hc, hc, zk - 0.3, zk)
            cs_.quad(P(ua, -hc, zk - 0.3), P(ua, hc, zk - 0.3), P(ub, hc, zk - 0.3 + crise), P(ub, -hc, zk - 0.3 + crise))   # the soffit, stepping up
        box(cpar, P, uc0 - 0.12, uc0, -hc, hc, zc - 0.55, zc + 0.8)                 # the parapet
        box(A.m(C["wool"] + "_hung", "circle"), P, uc0 - 0.16, uc0 + 0.04, -hc, hc, zc + 0.8, zc + 0.86)
        for k in range(nc):
            u, z = uc0 + 0.75 + k * cp, zc + (k + 1) * crise
            for v in np.arange(-ha + 1.1, ha - 1.09, 0.56):
                if abs(v) < 0.6 or min(ceil_at(u, v), E(u, v) - 0.9) < z + 1.6:   # an aisle down the middle; and room over the heads
                    continue
                seat_at(u, v, z, heading, "circle", full=0.7)

    # ---- the boxes: along each side wall between the stalls' doors and the circle, in tiers, six or seven seats in
    # each on two steps behind a parapet, turned to the stage
    if C.get("boxes"):
        bw, bd = 2.5, 1.75
        ub0, ub1 = du + dw / 2 + 0.6, uc0 - 0.4
        nb = int((ub1 - ub0) / bw)
        aim = np.array([up, 0.0])
        bf, bpar, bwall = A.m("oh_brushbox_hung", "boxes"), A.m("oh_birch_hung", "boxes"), A.m(C["lining"] + "_hung", "boxes")
        for side in (-1, 1):
            for tier in range(C["boxes"]):
                for j in range(nb):
                    ua, ub = ub0 + j * bw, ub0 + (j + 1) * bw
                    zb = max(stall_z(ua), stall_z(ub)) + 2.9 + tier * 2.35   # 2.9 m over the side aisle under it
                    vw, vf = side * ha, side * (ha - bd)
                    if min(ceil_at(ua + bw / 2, vw - side * 0.8), E(ua + bw / 2, vw - side * 0.8) - 0.9) < zb + 2.1:
                        continue
                    box(bf, P, ua, ub, vw, vf, zb - 0.28, zb)                              # its floor
                    box(bf, P, ua, ub, vw, vw - side * 0.85, zb, zb + 0.22)                # the back step
                    box(bpar, P, ua, ub, vf, vf - side * 0.1, zb - 0.45, zb + 0.82)        # the parapet
                    box(A.m(C["wool"] + "_hung", "boxes"), P, ua, ub, vf + side * 0.03, vf - side * 0.13, zb + 0.82, zb + 0.88)
                    box(bwall, P, ua, ua + 0.08, vw, vf, zb, zb + 2.0)                     # the partition
                    for row, (dv, dz, n) in enumerate(((bd - 0.55, 0.0, 3), (0.42, 0.22, 4))):
                        v = side * (ha - dv)
                        for i in range(n):
                            u = ua + 0.42 + (bw - 0.6) * (i + 0.5) / n
                            f = np.array(P(*aim, 0)[:2]) - np.array(P(u, v, 0)[:2])
                            h = math.atan2(f[1], f[0])
                            seat_at(u, v, zb + dz, h, "boxes", full=0.75)
    print(f"  {C['name']}: {count['stalls']} seats in the stalls, {count['circle']} in the circle, {count['boxes']} in the boxes ({sum(count.values())})")
    out["props"].append(dict(name=f"oh_{hid}_seat", at=seats, parts=[m.dump() for m in seat_model(C["wool"])], far=110))
    for k, (cloth, hair) in enumerate((("oh_patron_dark", "oh_hair"), ("oh_patron_warm", "oh_hair"), ("oh_patron_pale", "oh_patron_pale"))):
        out["props"].append(dict(name=f"oh_{hid}_patron{k}", at=patrons[k], parts=[m.dump() for m in patron_model(cloth, hair)], far=90))
    # the nearest round your seat, as people (web/game/show.js audience): the patron's prop and its place in it
    out["audience"] = [{"prop": f"oh_{hid}_patron{k}", "i": i} for _, (k, i), _z in sorted(near_you)[:28]]

    # ---- the stage
    st = A.m("oh_stage", "stage")
    front = up + 1.6
    box(st, P, us0, front, -hs, hs, 0.0, sm)
    if C["kind"] == "theatre":
        ow, oh = C["opening"]
        # the proscenium: black piers either side of the opening and a header over it
        pros = A.m("oh_black", "proscenium")
        for sgn in (-1, 1):
            env_wall(pros, P, E, (up, sgn * ow / 2), (up, sgn * ha), 12.0, t=0.3)
        env_wall(pros, P, E, (up, -ow / 2), (up, ow / 2), 12.0, z0=sm + oh, t=0.3)
        fr = A.m("oh_bronze", "proscenium")
        for sgn in (-1, 1):
            fr.box(P(up + 0.2, sgn * ow / 2, sm), P(up + 0.2, sgn * ow / 2, sm + oh), 0.12, 0.12)
        fr.box(P(up + 0.2, -ow / 2, sm + oh), P(up + 0.2, ow / 2, sm + oh), 0.12, 0.12)
        # the surtitles' screen over the opening
        box(A.m("oh_black", "proscenium"), P, up + 0.32, up + 0.4, -3.2, 3.2, sm + oh + 0.25, sm + oh + 0.95)
        # the pit: a rail before the stage, the players' stands lit
        pit0, pit1 = front, front + 2.6
        rail = A.m("oh_black", "pit")
        box(rail, P, pit1, pit1 + 0.12, -ow / 2 - 0.6, ow / 2 + 0.6, 0.0, 1.0)
        for sgn in (-1, 1):
            box(rail, P, pit0, pit1 + 0.12, sgn * (ow / 2 + 0.6), sgn * (ow / 2 + 0.72), 0.0, 1.0)
        for u in (pit0 + 0.7, pit0 + 1.7):
            for v in np.arange(-ow / 2 + 0.4, ow / 2 - 0.3, 1.15):
                x, y, g = P(u, v, 0)
                A.f("oh_black").tube([(x, y, g + 0.06), (x, y, g + 0.92)], 0.012, sides=4)
                box(A.f("oh_set_white"), P, u - 0.02, u + 0.02, v - 0.2, v + 0.2, 0.74, 0.95)
                box(A.f("oh_lamp"), P, u - 0.05, u - 0.02, v - 0.12, v + 0.12, 0.96, 0.98)
        # the conductor's rostrum
        box(A.f("oh_black"), P, pit1 - 0.9, pit1 - 0.2, -0.45, 0.45, 0.0, 0.45)
        # the set, for Carmen's first act: a square in Seville at noon, drawn for this page (not a production's):
        # a whitewashed wall with the tobacco factory's arched gate up three steps, an ochre guardhouse with a
        # tiled eave, a blue sky cloth behind
        S = A.m
        sk = S("oh_set_sky", "set")
        for j in range(6):   # the sky cloth, up into the flies
            va, vb = -hs + 0.1 + (2 * hs - 0.2) * j / 6, -hs + 0.1 + (2 * hs - 0.2) * (j + 1) / 6
            sk.quad(P(us0 + 0.5, va, sm), P(us0 + 0.5, vb, sm), P(us0 + 0.5, vb, stage_top(us0 + 0.5, vb)), P(us0 + 0.5, va, stage_top(us0 + 0.5, va)))
        wall_u = us0 + 4.0
        ak.holed_wall(S("oh_set_white", "set"), P, (wall_u, -hs + 0.3), (wall_u, 2.5), sm, sm + 5.4, [(hs - 0.3 - 4.2, 2.6, sm + 0.54, sm + 4.2, True)])
        box(S("oh_set_tile", "set"), P, wall_u - 0.25, wall_u + 0.45, -hs + 0.3, 2.5, sm + 5.4, sm + 5.75)
        for k in range(3):   # the gate's steps
            box(S("oh_set_white", "set"), P, wall_u + 0.02, wall_u + 1.3 - k * 0.4, -5.9, -2.5, sm + k * 0.18, sm + (k + 1) * 0.18)
        box(S("oh_set_dark", "set"), P, wall_u - 0.6, wall_u - 0.5, -5.5, -2.9, sm + 0.54, sm + 4.2)     # the gate's dark, behind
        box(S("oh_set_wall", "set"), P, us0 + 6.5, us0 + 10.5, hs - 3.6, hs - 0.3, sm, sm + 4.2)            # the guardhouse
        box(S("oh_set_tile", "set"), P, us0 + 6.2, us0 + 10.8, hs - 3.9, hs - 0.3, sm + 4.2, sm + 4.5)
        box(S("oh_set_dark", "set"), P, us0 + 10.5, us0 + 10.56, hs - 2.6, hs - 1.5, sm, sm + 2.3)
        x, y, g = P(us0 + 9.0, 1.2, sm)                                                                      # the fountain
        S("oh_set_white", "set").lathe([(g, 0.0), (g, 1.3), (g + 0.5, 1.3), (g + 0.5, 1.1), (g + 0.3, 1.1), (g + 0.3, 0.0)], (x, y), segs=14)
        S("oh_set_white", "set").lathe([(g + 0.3, 0.16), (g + 1.2, 0.12), (g + 1.25, 0.45), (g + 1.32, 0.45), (g + 1.32, 0.0)], (x, y), segs=10)
        for v in np.linspace(-hs + 1.5, hs - 1.5, 7):                                                       # festoon lamps across the square
            disc(S("oh_lamp", "set"), P, us0 + 12.0, v, sm + 6.0 - 0.5 * math.cos(v / hs * 1.4), sm + 6.12 - 0.5 * math.cos(v / hs * 1.4), 0.07, 6)
        # the house curtain: black velour, two halves that part (a door the stalls open as you come down the aisle)
        leaves = []
        for sgn in (-1, 1):
            cu = A.m("oh_velour", f"curtain_{'a' if sgn < 0 else 'b'}")
            lo, hi = sorted((0.0, sgn * (ow / 2 + 0.25)))
            n = 12
            for i in range(n):   # in folds
                a, b = lo + (hi - lo) * i / n, lo + (hi - lo) * (i + 1) / n
                da, db = (0.09 if i % 2 else -0.09), (-0.09 if i % 2 else 0.09)
                cu.quad(P(up - 0.5 + da, a, sm), P(up - 0.5 + db, b, sm), P(up - 0.5 + db, b, sm + oh + 0.3), P(up - 0.5 + da, a, sm + oh + 0.3))
            e = (np.array(P(0, 1, 0)[:2]) - np.array(P(0, 0, 0)[:2])) * sgn * (ow / 2 - 0.6)
            leaves.append({"meshes": [cu.name], "slide": [round(float(e[0]), 3), round(float(e[1]), 3)]})
        at = P(row0 + nrows * pitch * 0.35, 0, 0)
        out["doors"].append({"id": f"{hid}-curtain", "name": "The house curtain", "at": [round(at[0], 2), round(at[1], 2), round(at[2] + 1.0, 2)],
                             "reach": 9.0, "time": 5.0, "leaves": leaves})
        cs = P(us0 + 12.6, -1.2, sm)
        out["people"][f"{hid}-carmen"] = [round(cs[0], 2), round(cs[1], 2), round(cs[2], 2)]
        sc = P(up, 0, sm + 1.6)
        import json
        score = json.load(open(os.path.join(HERE, "opera_score.json"), encoding="utf8"))
        out["show"] = {"id": f"{hid}-show", "venue": C["name"], "stage": [round(sc[0], 2), round(sc[1], 2), round(sc[2], 2)],
                       "curtain": f"{hid}-curtain", "singer": f"{hid}-carmen", "dim": [f"oh_{hid}_aud_fit_oh_lamp"], **score,
                       "audience": out.pop("audience", []), "cast": AUDIENCE_CAST}
    else:
        # the platform, the choir stalls rising behind it, and the Grand Organ on the south wall
        box(st, P, us0, us0 + 3.4, -hs, hs, sm, sm + 1.6)
        for k in range(3):
            box(A.m("oh_brushbox", "choir"), P, us0 + 0.3 + k * 1.0, us0 + 1.2 + k * 1.0, -hs + 0.6, hs - 0.6, sm + 1.6 - k * 0.5, sm + 2.1 - k * 0.5)
        og = A.m("oh_brushbox", "organ")
        otop = min(sm + 1.6 + 13.0, E(us0 + 0.6, 0) - 1.0)
        box(og, P, us0 + 0.02, us0 + 0.5, -6.5, 6.5, sm + 1.6, sm + 4.0)
        tin = A.m("oh_tin", "organ")
        n = 27   # the front's burnished tin pipes, in five flats, tallest at the middle of each
        for i in range(n):
            v = -6.2 + 12.4 * i / (n - 1)
            flatk = abs(((i + 2) % 6) - 2.5) / 2.5
            mid = 1 - abs(v) / 6.5
            h = (otop - sm - 4.0) * (0.45 + 0.5 * mid) * (1 - 0.3 * flatk)
            x, y, g = P(us0 + 0.65, v, sm + 4.0)
            tin.lathe([(g, 0.03), (g + 0.25, 0.13), (g + h, 0.13), (g + h, 0.0)], (x, y), segs=8)
        box(og, P, us0 + 0.02, us0 + 0.35, -6.6, 6.6, sm + 4.0, otop)
        # the petals: eighteen, in rings over the platform
        pm = A.m("oh_petal", "petals")
        for i, (du_, dv_) in enumerate([(3.5, -6.5), (3.5, -2.2), (3.5, 2.2), (3.5, 6.5), (7.0, -7.5), (7.0, -4.5), (7.0, -1.5), (7.0, 1.5), (7.0, 4.5), (7.0, 7.5),
                                        (10.5, -6.5), (10.5, -2.2), (10.5, 2.2), (10.5, 6.5), (13.5, -5.5), (13.5, -1.8), (13.5, 1.8), (13.5, 5.5)]):
            u, v = us0 + 2.0 + du_, dv_
            zc = min(sm + 9.0 + 0.2 * (i % 3), ceil_at(max(u, up + 0.1), v) - 1.2)
            x, y, g = P(u, v, zc)
            pm.lathe([(g + 0.22, 0.0), (g + 0.12, 0.7), (g, 1.25), (g + 0.05, 1.3), (g + 0.2, 0.75), (g + 0.3, 0.0)], (x, y), segs=7)
            A.m("oh_black", "petals").tube([(x, y, g + 0.3), (x, y, g + 2.2)], 0.012, sides=4)
        # the orchestra's chairs and stands on the platform
        for r_, n_ in ((3.0, 7), (5.0, 11), (7.0, 13)):
            for i in range(n_):
                a = -1.15 + 2.3 * i / (n_ - 1)
                u, v = up + 0.6 - r_ * math.cos(a) * 0.9, r_ * math.sin(a) * 1.15
                if us0 + 3.8 < u < front - 0.6 and abs(v) < hs - 0.6:
                    box(A.f("oh_black"), P, u - 0.2, u + 0.2, v - 0.2, v + 0.2, sm + 0.42, sm + 0.47)
                    x, y, g = P(u + 0.55, v, sm)
                    A.f("oh_black").tube([(x, y, g), (x, y, g + 0.95)], 0.012, sides=4)
                    box(A.f("oh_set_white"), P, u + 0.53, u + 0.57, v - 0.2, v + 0.2, sm + 0.78, sm + 1.0)
        box(A.f("oh_brushbox"), P, front - 1.5, front - 0.7, -0.5, 0.5, sm, sm + 0.25)   # the conductor's rostrum
        sc = P(up, 0, sm + 1.6)
        out["show"] = None
    # exit signs over the doors, and the aisle lights
    for sgn in (-1, 1):
        box(A.f("oh_lamp"), P, du - 0.25, du + 0.25, sgn * (ha - 0.04), sgn * (ha - 0.02), dh + 0.12, dh + 0.26)

    # ---- the levels. The southern foyer is at the doors' level, the podium's deck. Past the stalls' doors each side
    # foyer climbs a straight flight along the carcass (26 risers of 15 cm) to a gallery at the northern foyer's
    # level, 3.89 m up (RL 18.59 m against the deck's 14.70: CMP table 5.1), and the galleries meet on a landing
    # behind the auditorium, where the bar is; from the landing the broad stair comes down to the lower level by the
    # glass. The shells as built here stand lower over the north than the real ones, so the gallery keeps to 1.6 m
    # from the carcass and the broad stair stops where they come down to it (E). (The real southern foyer is lower
    # than the deck, at RL 12.80 m, under the Monumental Steps; here the doors open onto it at the deck's level.)
    # The game walks each level as a strip (game.json surfaces) on the podium's roof: near one, web/game/nav.js reads
    # the walls, the doors and the furniture finely, from the deck up, not as 2 m cells from the ground under it.
    LV, RISE, TREAD, G = 3.89, 0.15, 0.3, 1.6
    NR = int(round(LV / RISE))
    RUN = NR * TREAD
    us1 = du + dw / 2 + 2.0                 # the side flights' foot, past the stalls' doors
    us2 = us1 + RUN
    ur_ = ur + T                            # the auditorium's rear wall, outside
    un1 = ur_ + 5.5                         # the landing's edge, the broad stair's head
    un2 = un1 + RUN
    W = max(peds) + 1.0
    gin = ha + T                            # the galleries: from the carcass out to gin + G
    side_h = lambda u: 0.0 if u <= us1 else LV if u >= us2 else RISE * (int((u - us1) / TREAD) + 1)
    north_h = lambda u: LV if u <= un1 else 0.0 if u >= un2 else LV - RISE * (int((u - un1) / TREAD) + 1)
    band = lambda u0, u1, v0, v1: shapely.box(u0, v0, u1, v1)
    for part, rect in (("floor", band(-10, us1, -W, W)), ("outer_w", band(us1, ur_, -W, -gin - G)), ("outer_e", band(us1, ur_, gin + G, W)), ("lower", band(un2, Ltot + 30, -W, W))):
        lower = rect.intersection(carpet)   # (each level's carpet named for the strip it is walked as)
        for g_ in getattr(lower, "geoms", [lower]):
            if g_.area > 0.5:
                flat(R.m(C["carpet"], part), P, list(g_.exterior.coords)[:-1], 0.05)
    lab = C["name"]
    out["surfaces"].append(strip(f"oh_{hid}_floor_{C['carpet']}", P, -5.0, us1 + 0.05, -W, W, [(-5.0, 0.0), (us1 + 0.05, 0.0)], lab))
    out["surfaces"].append(strip(f"oh_{hid}_lower_{C['carpet']}", P, un2 - 0.05, Ltot + 2.5, -W, W, [(un2 - 0.05, 0.0), (Ltot + 2.5, 0.0)], lab))
    for sgn, sd in ((-1, "w"), (1, "e")):
        out["surfaces"].append(strip(f"oh_{hid}_outer_{sd}", P, us1 - 0.05, ur_ + 0.05, sgn * (gin + G), sgn * W, [(us1 - 0.05, 0.0), (ur_ + 0.05, 0.0)], lab))
        # the flight and the gallery: carpeted treads on a brush box stair, the gallery's edge a bronze rail over a
        # brush box face to the lower foyer
        gs = R.m(C["carpet"], f"gallery_{sd}")
        gf = R.m("oh_brushbox", f"galface_{sd}")
        va, vb = sorted((sgn * gin, sgn * (gin + G)))
        for i in range(NR):
            ua, ub = us1 + i * TREAD, us1 + (i + 1) * TREAD
            box(gs, P, ua, ub, va, vb, 0.0, (i + 1) * RISE)
        box(gs, P, us2, ur_, va, vb, LV - 0.3, LV)
        box(gf, P, us2, ur_, sgn * (gin + G) - sgn * 0.06, sgn * (gin + G), 0.0, LV - 0.3)
        rail = R.m("oh_bronze", f"gallery_{sd}_rail")
        rv = sgn * (gin + G - 0.08)
        top = [(us1, 0.95)] + [(us1 + (i + 0.5) * TREAD, (i + 1) * RISE + 0.95) for i in range(NR)] + [(us2, LV + 0.95), (ur_ - 0.1, LV + 0.95)]
        rail.tube([P(u, rv, h) for u, h in top], 0.03, sides=6)
        for u, h in top[::4] + [top[-1]]:
            rail.tube([P(u, rv, h - 0.95), P(u, rv, h)], 0.018, sides=4)
        out["surfaces"].append(strip(f"oh_{hid}_gallery_{sd}", P, us1 - 0.05, ur_ + 0.05, va, vb, [(us1 - 0.05, 0.0), (us2, LV), (ur_ + 0.05, LV)], f"{lab}, the side foyer's stair"))
        # the auditorium's wall beside the gallery, solid at a walker's height there (the wall itself is solid only
        # to Z, hung_wall)
        box(hit, P, us2 - 1.0, ur_, sgn * (gin - 0.05), sgn * gin, LV, LV + 2.4)
    box(hit, P, ur_ - 0.05, ur_, -gin, gin, LV, LV + 2.4)   # and behind the landing
    # the landing and the broad stair down, each step as wide as the carpet and the shells over it let it be
    land = band(ur_, un1, -W, W).intersection(carpet)
    for g_ in getattr(land, "geoms", [land]):
        if g_.area > 0.5:
            ring = list(g_.exterior.coords)[:-1]
            flat(R.m(C["carpet"], "north_landing"), P, ring, LV + 0.01)
            ak.prism(R.m("oh_brushbox", "north_landing"), P, ring, LV - 0.3, LV, top=False)
    for i in range(NR):
        ua, ub = un1 + i * TREAD, un1 + (i + 1) * TREAD
        h = LV - (i + 1) * RISE
        um = (ua + ub) / 2
        vs_ok = [v for v in np.arange(-W, W + 0.01, 0.5) if E(um, v) > h + 0.6]
        if not vs_ok:
            continue
        st_ = band(ua, ub, min(vs_ok), max(vs_ok)).intersection(carpet)
        for g_ in getattr(st_, "geoms", [st_]):
            if g_.area > 0.05:
                ring = list(g_.exterior.coords)[:-1]
                flat(R.m(C["carpet"], "north_stair"), P, ring, h + 0.01)
                ak.prism(R.m("oh_brushbox", "north_stair"), P, ring, 0.0, h, top=False)
    out["surfaces"].append(strip(f"oh_{hid}_north", P, ur_ - 0.05, un2 + 0.05, -W, W, [(ur_ - 0.05, LV), (un1, LV), (un2, 0.0), (un2 + 0.05, 0.0)], f"{lab}, the northern foyer"))
    # the way up and down the levels, for tools/foyer_walk.js: in at the southern doors, along the east side foyer, up
    # its flight, along the gallery to the landing, down the broad stair to the glass
    bar_half = min(ha - 1.5, 7.0 if C["kind"] == "concert" else 5.0)
    gv = gin + 0.75   # (the gallery's middle: clear of the lamps' poles by the carcass and the rail)
    route = [(us0 - 3.0, 4.0, 0.0), (us0 - 3.0, gv, 0.0), (us1 - 1.5, gv, 0.0), (us2 + 0.5, gv, LV), (ur_ - 0.5, gv, LV), (ur_ + 1.2, gv, LV), (ur_ + 1.2, bar_half + 1.4, LV), (ur_ + 4.7, bar_half + 1.4, LV), (ur_ + 4.7, 0.0, LV), (un2 + 0.6, 0.0, 0.0)]
    for r_ in out["rooms"]:
        if r_["id"] == f"{hid}-foyers":
            r_["route"] = [[round(c, 2) for c in P(u, v, h)] for u, v, h in route]

    # ---- the southern foyer: an information desk, benches under the glass
    box(R.f("oh_brushbox"), P, us0 - 4.6, us0 - 4.0, -2.2, 2.2, 0.0, 1.05)
    box(R.f("oh_stone"), P, us0 - 4.7, us0 - 3.9, -2.3, 2.3, 1.05, 1.1)
    for v in (-4.2, 4.2):
        sphere_lamp(R, P, us0 - 4.3, v)
    for v in (-6.5, -2.2, 2.2, 6.5):
        sphere_lamp(R, P, us0 - 1.2, v * min(1.0, (peds[0] - 2) / 7.5), 2.6, 0.22)
    out["people"][f"{hid}-usher"] = [round(q, 2) for q in P(us0 - 5.6, 0.0, 0)]

    # ---- the side foyers: the pedestals' fans, lamps along the carcass, a bronze rail
    for sgn in (-1, 1):
        for u in np.arange(us0 + 2, ur, 6.0):
            w = ha + T if u > up else hs + T
            lv = side_h(u) if u > up else 0.0   # (on the gallery, once the flight has climbed)
            if E(u, sgn * (w + 0.3)) > lv + 3.2:
                sphere_lamp(R, P, u, sgn * (w + 0.15), lv + 2.4, 0.18, None if lv > 0 else 0.0)
        for k in range(1, len(shells)):   # the pedestals: concrete fans where a shell's ribs come down
            x, y, g = P(pu[k], sgn * (peds[k] - 0.4), 0)
            R.m("oh_concrete", "pedestals").lathe([(g, 0.9), (g + 1.6, 0.75), (g + 2.6, 1.1)], (x, y), segs=10)

    # ---- the northern foyer: on the landing, the bar against the auditorium's rear wall; down the broad stair,
    # lounge chairs along the glass
    nb = ur + T + 0.5
    half = bar_half   # (the shells come down low over the landing's ends: the bar keeps to its middle)
    # (the bar runs across the hall: along v)
    Pb = lambda u, v, h: P(nb + 1.8 - v, u, h + LV)   # a frame turned a quarter: its u is the hall's v
    bar(R, Pb, -half, half, 0.0, -1)
    for v in (-half - 0.5, 0.0, half + 0.5):
        sphere_lamp(R, P, nb + 2.3, v, LV + 2.9, 0.2, LV)
    out["people"][f"{hid}-bartender"] = [round(q, 2) for q in P(nb + 1.0, 1.0, LV)]
    # the mural on the auditorium's rear wall, over the back bar: a long panel in the work's ground colour
    mw, mh = (10.0, 1.8) if C["kind"] == "theatre" else (min(21.0, 2 * ha - 2), 3.0)
    box(R.m("oh_mural_ochre" if C["kind"] == "theatre" else "oh_mural_blue", "mural"), P, ur + T, ur + T + 0.06, -mw / 2, mw / 2, LV + 2.7, LV + 2.7 + mh)
    box(R.m("oh_bronze", "mural"), P, ur + T, ur + T + 0.04, -mw / 2 - 0.06, mw / 2 + 0.06, LV + 2.64, LV + 2.7)
    # lounge chairs in pairs, turned to the glass and the harbour; a place for you in each group
    north_end = Ltot - 2.0
    k = 0
    for u in np.arange(un2 + 1.2, north_end - 1.5, 3.2):
        wmax = (peds[-1] - 1.2) * (Ltot - u) / (Ltot - pu[-1]) if u > pu[-1] else peds[-1] - 1.2
        for v in np.arange(-wmax + 1.0, wmax - 0.9, 3.6):
            if E(u, v) < 3.0:
                continue
            face = np.array([1.0, 0.25 * np.sign(v) if abs(v) > 1 else 0.0])
            face /= np.linalg.norm(face)
            table(R, P, u + 0.75, v, 0.3, 0.45)
            lounge(R, P, u, v - 0.55, tuple(face))
            k += 1
            if k % 3 == 1:   # the other chair is yours
                s = P(u, v + 0.55, 0)
                out["seats"].append({"id": f"{hid}-north-{k}", "name": f"{C['name']}, the northern foyer", "verb": "Sit and look down the harbour",
                                     "at": [round(s[0], 2), round(s[1], 2), round(s[2] + 0.02, 2)],
                                     "face": [round(float(ax[0] * face[0] + east[0] * face[1]), 4), round(float(ax[1] * face[0] + east[1] * face[1]), 4)], "eye": 1.05, "pitch": 0.02})
                lounge(R, P, u, v + 0.55, tuple(face), "oh_felt")
            else:
                lounge(R, P, u, v + 0.55, tuple(face))
    out["meshes"] = R.out() + A.out()
    out["frame"] = {"origin": [float(o[0]), float(o[1])], "axis": [float(ax[0]), float(ax[1])], "z0": z0, "length": Ltot}
    return out


# ---------------------------------------------------------------- Bennelong

def bennelong_inside(shells, exterior, z0):
    """The restaurant under the smallest shells: the dining room on the landing's level under the southern shell,
    its tables along the glass towards Circular Quay and the city; up three steps, the upper terrace under the
    northern shell with the bar; the kitchen's counter between them."""
    T0, T1 = shells[0][1], shells[-1][1]
    o = T0[:2]
    ax = (T1[:2] - o) / np.linalg.norm(T1[:2] - o)
    east = np.array([ax[1], -ax[0]])
    Ltot = float(np.linalg.norm(T1[:2] - o))
    P = frame(o, ax, east, z0)
    loc = lambda p: (float((p[:2] - o) @ ax), float((p[:2] - o) @ east))
    E = Envelope(exterior, o, ax, east, z0, Ltot)
    peds = [abs(loc(s[2][1])[1]) for s in shells]
    pu = [loc(s[2][1])[0] for s in shells]
    R = Room("oh_bl", 0.55, "#8a5a34")
    out = {"doors": [], "rooms": [], "surfaces": [], "props": [], "seats": [], "gaps": [], "people": {}, "glows": [], "show": None}
    outline = [(1.2, 0.0)] + [(pu[k], peds[k] - 0.5) for k in range(2)] + [(Ltot - 0.8, 0.0)] + [(pu[k], -peds[k] + 0.5) for k in (1, 0)]
    flat(R.m("oh_ochre", "floor"), P, outline, 0.05)
    # the door: in the east arm of the southern glass, towards the top of the Monumental Steps
    a = np.array([pu[0], peds[0]])
    t = a / np.linalg.norm(a)
    c = a * 0.6
    d = sliding_door(R, P, c, t, 1.8, 2.4, "e", {"id": "bennelong-door", "name": "Bennelong's doors"})
    out["doors"].append(d)
    out["gaps"].append((P(*c, 0)[:2], 1.95, 3.15))
    n = np.array([t[1], -t[0]])
    n = n if n @ np.array([1.0, -0.2]) > 0 else -n
    out["rooms"].append({"id": "bennelong", "name": "Bennelong", "note": "the restaurant under the smallest shells: Circular Quay and the bridge through the glass",
                         "floor": round(z0, 2), "height": 16, "door": d["id"], "ring": [q for p in outline for q in xy(P, *p)],
                         "way": [xy(P, *(c - n * 4.5)), xy(P, *(c - n * 1.0)), xy(P, *(c + n * 1.2)), xy(P, *(c + n * 3.6))]})
    # the upper terrace: three risers up, under the northern shell
    t0, th = pu[0] + 5.0, 0.54
    tw = 5.6
    tr = R.m("oh_brushbox", "terrace")
    for k in range(3):
        box(tr, P, t0 + k * 0.32, Ltot - 4.5, -tw, tw, k * 0.18, (k + 1) * 0.18)
    out["surfaces"].append(strip("oh_bl_terrace_oh_brushbox", P, t0, Ltot - 4.5, -tw, tw, [(t0 - 0.05, 0.0), (t0 + 0.0, 0.18), (t0 + 0.32, 0.18), (t0 + 0.34, 0.36), (t0 + 0.64, 0.36), (t0 + 0.66, th), (Ltot - 4.5, th)],
                                 "Bennelong, the upper terrace"))
    Pt = lambda u, v, h: P(u, v, h + th)
    bar(R, Pt, t0 + 3.0, min(t0 + 8.5, Ltot - 7.0), -2.2, 1)
    out["people"]["barkeeper"] = [round(q, 2) for q in Pt(t0 + 5.0, -3.0, 0)]
    for u in (t0 + 2.6, t0 + 5.8):
        table(R, Pt, u, 3.2, 0.42)
        for a_ in (0.4, 2.5, 4.6):
            chair(R, Pt, u + 0.8 * math.cos(a_), 3.2 + 0.8 * math.sin(a_), (-math.cos(a_), -math.sin(a_)))
    # the kitchen's counter, where the terrace begins
    box(R.f("oh_stone"), P, t0 - 2.6, t0 - 1.9, -3.4, 1.2, 0.0, 0.95)
    box(R.f("oh_bottles"), P, t0 - 2.5, t0 - 2.0, -3.2, 1.0, 0.95, 1.05)
    # the dining room: resin tables lit from within, along both arms of the glass and down the middle
    k = 0
    for u in np.arange(6.0, pu[0] + 2.5, 2.7):
        w = peds[0] * min(1.0, u / pu[0]) - 3.4
        vs = [-w, w] if w > 1.6 else [0.0]
        if w > 5.2:
            vs += [-w + 3.0, w - 3.0] if w > 7.5 else [0.0]
        for v in vs:
            if E(u, v) < 2.2 or abs(u - c[0]) < 3.0 and abs(v - c[1]) < 3.4:
                continue
            table(R, P, u, v, 0.45)
            out_dir = np.array([-0.35, 1.0 if v > 0 else -1.0]) if abs(v) > 0.5 else np.array([-1.0, 0.0])
            out_dir /= np.linalg.norm(out_dir)
            k += 1
            mine = k in (2, 5) and abs(v) > 0.5 and v < 0   # a place for you on the room's side of the table: the glass and Circular Quay before you
            for sgn in (1, -1):
                side = np.array([-out_dir[1], out_dir[0]]) * 0.78 * sgn
                q = np.array([u, v]) + side
                f = -side / np.linalg.norm(side)
                chair(R, P, q[0], q[1], tuple(f))
            if mine:
                q = np.array([u, v]) - out_dir * 0.85
                s = P(*q, 0)
                fw = ax * out_dir[0] + east * out_dir[1]
                out["seats"].append({"id": f"bennelong-{k}", "name": "Bennelong, a table by the glass", "verb": "Sit at the table",
                                     "at": [round(s[0], 2), round(s[1], 2), round(s[2] + 0.02, 2)], "face": [round(float(fw[0]), 4), round(float(fw[1]), 4)], "eye": 1.12, "pitch": -0.06})
                chair(R, P, q[0], q[1], tuple(out_dir), "oh_felt")
    for u, v in ((8.0, 0.0), (13.0, -3.0), (13.0, 3.0), (18.0, 0.0), (t0 + 4.0, 0.5)):
        if E(u, v) > 3.4:
            sphere_lamp(R, P, u, v, 2.6, 0.22)
    out["people"]["maitre"] = [round(q, 2) for q in P(*(c + n * 2.6 + t * 1.6), 0)]
    out["meshes"] = R.out()
    return out


def build(o, hall_shells, exterior):
    """Every room: hall_shells(hall, ridges, z0) is city.py's; exterior, the shells' meshes. Returns one dict."""
    parts = []
    for key in ("joan_sutherland", "concert"):
        if key in o["halls"]:
            z0 = o["podium"]["top_m"]
            deck = max(o["podium"]["decks"][1], key=lambda r: abs(Polygon(r).area))
            parts.append(hall_inside(key, hall_shells(key, o["halls"][key], z0), exterior, z0, deck))
    if "restaurant" in o["halls"]:
        z0 = o["podium"]["low_m"]
        parts.append(bennelong_inside(hall_shells("restaurant", o["halls"]["restaurant"], z0), exterior, z0))
    out = {k: [] for k in ("meshes", "doors", "rooms", "surfaces", "props", "seats", "gaps", "glows")}
    out["people"], out["shows"] = {}, []
    for p in parts:
        for k in ("meshes", "doors", "rooms", "surfaces", "props", "seats", "gaps", "glows"):
            out[k] += p[k]
        out["people"].update(p["people"])
        if p.get("show"):
            out["shows"].append(p["show"])
    return out
