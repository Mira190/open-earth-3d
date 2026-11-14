"""Tokyo Station's Marunouchi building and its plaza: the city's hero level, where the game starts.

The building (東京駅丸の内駅舎, Tatsuno Kingo, 1914; restored to its three storeys and its domes in 2012) on
the solids of its OpenStreetMap/PLATEAU outline (r4856156), which it draws instead of the blocks:
  * the wings: red brick (Poly Haven's CC0 red_brick, web/assets/pbr) in three storeys under a cornice at
    about 16.7 m, white stone string courses at the plinth, each storey's sills and the first floor's
    imposts, stone quoins at every corner, each window a real opening 0.45 m deep with its sill, its lintel
    and keystone and a white timber sash, and a steep slate roof with dormers;
  * the dome pavilions at the south and north exits: octagons to 25 m with an attic of round windows, under
    the slate domes to 34.8 m (JR East) with copper ribs, a lantern and a finial;
  * the central pavilion (the imperial entrance), to about 28 m under its own steep roof, and its porch;
  * floodlit after dark, warm, as LPA's 2012 scheme lights the brick, the stone and the domes.
The plaza (丸の内駅前広場, reopened 7 December 2017): white granite paving from the facade to the street in
front of the Marunouchi Building, its two lawns, the zelkova rows on the axis to the Palace, the three-lamp
posts set along them, kerbs and bollards.
Dimensions: JR East (dome tops 34.8 m), tabiyomi/JR (central pavilion about 28 m), the 2014 Kenchikushi award
sheet (floor areas), photographs for the rhythm of the facade (bays about 3.6 m). See docs/HERO.md.
"""
import json
import math
import os

import numpy as np

import archkit as ak
from meshkit import Mesh

NAME = "東京駅丸の内駅舎"
EAVES = 16.7      # cornice top over the ground (m)
DOME_TOP = 34.8   # the domes' crown, without the finial
CENTRE_TOP = 28.0
BAY = 3.6

FLOOD = "#ffcf9e"   # warm, about 3000 K
MATERIALS = {
    "tks_brick": {"color": "#8a4630", "roughness": 0.86, "metalness": 0.0, "pbr": {"set": "brick", "tile_m": [1.4, 1.4], "vary": 0.05},
                  "emissive": "#d26a42", "glow": 1.5},
    "tks_stone": {"color": "#c4aa8c", "roughness": 0.8, "metalness": 0.0,
                  "emissive": FLOOD, "glow": 1.05},
    "tks_slate": {"color": "#39383a", "roughness": 0.62, "metalness": 0.0, "pbr": {"set": "slate", "tile_m": [2.6, 2.6], "normal": 1.2},
                  "emissive": "#ffd9b0", "glow": 0.05},
    "tks_copper": {"color": "#55625a", "roughness": 0.5, "metalness": 0.45, "emissive": FLOOD, "glow": 0.14},
    "tks_sash": {"color": "#ece7dc", "roughness": 0.55, "metalness": 0.0},
    "tks_glass": {"color": "#1f262c", "roughness": 0.08, "metalness": 0.6, "emissive": "#ffd29a", "glow": 0.62,
                  "interior": {"room_m": [3.6, 4.6, 5.0], "win_m": [1.55, 3.2]}},
    "tks_glass_small": {"color": "#1f262c", "roughness": 0.08, "metalness": 0.6, "emissive": "#ffd29a", "glow": 0.45},
    "tks_glass_dark": {"color": "#1c2228", "roughness": 0.08, "metalness": 0.6, "emissive": "#ffe6c4", "glow": 0.07,
                       "interior": {"room_m": [3.6, 4.6, 5.0], "win_m": [1.55, 3.2]}},
    "tks_reveal": {"color": "#7a3d2a", "roughness": 0.9, "metalness": 0.0, "pbr": {"set": "brick", "tile_m": [1.4, 1.4], "vary": 0.05}},
    # the pedestrian plaza's granite: one family, three tones a step apart, and the joint between the slabs
    "tks_granite_a": {"color": "#b4b1aa", "roughness": 0.6, "metalness": 0.0, "decal": True, "street_lit": True, "surface": "concrete"},
    "tks_granite_b": {"color": "#aaa7a0", "roughness": 0.62, "metalness": 0.0, "decal": True, "street_lit": True, "surface": "concrete"},
    "tks_granite_c": {"color": "#a09d96", "roughness": 0.64, "metalness": 0.0, "decal": True, "street_lit": True, "surface": "concrete"},
    "tks_joint": {"color": "#8a8782", "roughness": 0.9, "metalness": 0.0, "decal": True, "street_lit": True, "surface": None},
    "tks_pavers": {"color": "#8b857c", "roughness": 0.7, "metalness": 0.0, "pbr": {"set": "concrete_pavers", "tile_m": [1.8, 1.8], "vary": 0.03},
                   "decal": True, "street_lit": True},
    "tks_asphalt": {"color": "#3b3c3e", "roughness": 0.9, "metalness": 0.0, "decal": True, "street_lit": True},
    "tks_paint": {"color": "#d9d9d4", "roughness": 0.7, "metalness": 0.0, "decal": True, "street_lit": True},
    "tks_kerb": {"color": "#8f8c85", "roughness": 0.7, "metalness": 0.0, "pbr": {"set": "granite_paving", "tile_m": [1.2, 1.2]}, "street_lit": True},
    "tks_lawn": {"color": "#6c7442", "roughness": 0.95, "metalness": 0.0, "pbr": {"set": "lawn", "tile_m": [2.0, 2.0], "vary": 0.08}, "decal": True, "street_lit": True},
    "tks_hedge": {"color": "#3f5a2c", "roughness": 0.95, "metalness": 0.0, "pbr": {"set": "lawn", "tile_m": [0.9, 0.9], "vary": 0.08, "normal": 1.4}, "street_lit": True},
    "tks_groundcover": {"color": "#4c5a30", "roughness": 0.95, "metalness": 0.0, "pbr": {"set": "lawn", "tile_m": [1.3, 1.3], "vary": 0.08, "normal": 1.2}, "decal": True, "street_lit": True},
    "tks_door": {"color": "#1f262c", "roughness": 0.08, "metalness": 0.6, "emissive": "#ffd9a0", "glow": 1.0, "glow_day": 0.1},
    "tks_sign": {"color": "#ffffff", "roughness": 0.5, "metalness": 0.0, "map": "tks_signs.png", "emissive_map": True, "glow": 1.1, "glow_day": 0.3},
    "tks_canopy": {"color": "#dcdcd6", "roughness": 0.45, "metalness": 0.2},
    "tks_iron": {"color": "#23272a", "roughness": 0.45, "metalness": 0.6},
    "tks_pent": {"color": "#5b4a3c", "roughness": 0.5, "metalness": 0.55, "emissive": FLOOD, "glow": 0.06},
    "tks_soffit": {"color": "#d9d2c4", "roughness": 0.8, "metalness": 0.0, "emissive": "#ffdcae", "glow": 0.5},
    "tks_clock": {"color": "#efe9da", "roughness": 0.5, "metalness": 0.0, "emissive": "#fff0d0", "glow": 0.9},
    "tks_lamp": {"color": "#f3ead8", "roughness": 0.3, "metalness": 0.0, "emissive": "#ffe2b4", "glow": 1.0},
}


def _mats():
    return {k: {kk: (dict(vv) if isinstance(vv, dict) else vv) for kk, vv in v.items()} for k, v in MATERIALS.items()}


# ---------------------------------------------------------------- helpers

def sweep(m, ring, z, profile, closed=True):
    """A moulding round (or along) a ring of world points at height z: profile [(out, up)] from the wall face,
    with texture coordinates in metres along the ring and up the profile."""
    rings = [[(*q, z + h) for q in (ak.offset_ring(ring, d) if closed else _offset_open(ring, d))] for d, h in profile]
    n = len(ring)
    s = [0.0]
    for k in range(n if closed else n - 1):
        a, b = ring[k], ring[(k + 1) % n]
        s.append(s[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    t = [0.0]
    for (d0, h0), (d1, h1) in zip(profile, profile[1:]):
        t.append(t[-1] + math.hypot(d1 - d0, h1 - h0))
    for j, (r0, r1) in enumerate(zip(rings[:-1], rings[1:])):
        for k in range(n if closed else n - 1):
            k1 = (k + 1) % n
            m.quad(r0[k], r0[k1], r1[k1], r1[k], [[s[k], t[j]], [s[k + 1], t[j]], [s[k + 1], t[j + 1]], [s[k], t[j + 1]]])


def _offset_open(pts, d):
    out = []
    P = [np.asarray(p, float) for p in pts]
    for i, p in enumerate(P):
        a, b = P[max(0, i - 1)], P[min(len(P) - 1, i + 1)]
        t = (b - a) / (np.linalg.norm(b - a) or 1)
        out.append(tuple(p + np.array([t[1], -t[0]]) * d))
    return out


def box(m, c, t, n, z0, z1, w, d, uv=True):
    """A box centred at c (2D) on a wall whose tangent is t and outward normal n: w along, d out, z0..z1."""
    c, t, n = np.asarray(c, float), np.asarray(t, float), np.asarray(n, float)
    A = [c - t * w / 2, c + t * w / 2, c + t * w / 2 + n * d, c - t * w / 2 + n * d]
    s = 0.0
    for k in range(4):
        a, b = A[k], A[(k + 1) % 4]
        L = float(np.linalg.norm(b - a))
        m.quad((*a, z0), (*b, z0), (*b, z1), (*a, z1), [[s, z0], [s + L, z0], [s + L, z1], [s, z1]])
        s += L
    m.quad(*[(*p, z1) for p in A], [[0, 0], [w, 0], [w, d], [0, d]])
    m.quad(*[(*p, z0) for p in A[::-1]], [[0, 0], [w, 0], [w, d], [0, d]])


def ccw(ring):
    return ring if ak.ring_area(ring) > 0 else ring[::-1]


# ---------------------------------------------------------------- parts on a wall

HERO = False     # building for the streamed level (cities/tokyo/hero.py): bevelled edges, occlusion marks, floodlights
BEV = 0.022      # an arris is never a razor: the chamfer that catches the light along it (m)
STOPS, BENCHES = [], []   # the stands' poles (x, y, z) and the benches under the canopies (x, y, z, heading), for the level
FLOODS = []      # (x, y, z, nx, ny): a floodlight at the foot of a bay, for the level's baked night light


def shade(m, vals):
    """Occlusion of the vertices just added to m (the last len(vals)): 1 open to the sky, less in a recess or
    under an eave. Kept beside the mesh for the hero level's bake; the landmark model has no use for it."""
    d = m.__dict__.setdefault("ao", {})
    n = len(m.v)
    for k, v in enumerate(vals):
        d[n - len(vals) + k] = v


def slab(m, a, t, n, s0, s1, z0, z1, d0, d1, faces="fb"):
    """A block on the wall through a (2D) with tangent t and outward normal n: s0..s1 along, z0..z1 up, d0..d1 out.
    Only the faces named are built: f front, b bottom, t top, l the end at s0, r the end at s1 (what the eye can
    reach: a band a few centimetres proud needs its front alone). In the hero level a block that stands proud
    enough has its front's edges chamfered towards each side that is built."""
    a, t, n = np.asarray(a, float), np.asarray(t, float), np.asarray(n, float)
    Q = lambda s, z, d: (*(a + t * s + n * d), z)
    w, h, dd = s1 - s0, z1 - z0, d1 - d0
    bev = BEV if HERO and "f" in faces and dd > 2.6 * BEV and min(w, h) > 5 * BEV else 0.0
    L, R, T, B = (bev if k in faces else 0.0 for k in "lrtb")
    ds = d1 - bev      # where the sides end and the chamfers begin
    if "f" in faces:
        m.quad(Q(s0 + L, z0 + B, d1), Q(s1 - R, z0 + B, d1), Q(s1 - R, z1 - T, d1), Q(s0 + L, z1 - T, d1),
               [[s0 + L, z0 + B], [s1 - R, z0 + B], [s1 - R, z1 - T], [s0 + L, z1 - T]])
        if bev:
            if L:
                m.quad(Q(s0, z0 + B, ds), Q(s0 + L, z0 + B, d1), Q(s0 + L, z1 - T, d1), Q(s0, z1 - T, ds))
            if R:
                m.quad(Q(s1 - R, z0 + B, d1), Q(s1, z0 + B, ds), Q(s1, z1 - T, ds), Q(s1 - R, z1 - T, d1))
            if T:
                m.quad(Q(s0 + L, z1 - T, d1), Q(s1 - R, z1 - T, d1), Q(s1 - R, z1, ds), Q(s0 + L, z1, ds))
            if B:
                m.quad(Q(s0 + L, z0, ds), Q(s1 - R, z0, ds), Q(s1 - R, z0 + B, d1), Q(s0 + L, z0 + B, d1))
                shade(m, (0.8, 0.8, 0.9, 0.9))
            for cs, cz, es, ez, on in ((s0 + L, z1 - T, s0, z1, L and T), (s1 - R, z1 - T, s1, z1, R and T),
                                       (s0 + L, z0 + B, s0, z0, L and B), (s1 - R, z0 + B, s1, z0, R and B)):
                if on:   # the corner between two chamfers
                    m.tri(Q(cs, cz, d1), Q(es, cz, ds), Q(es, ez, ds))
                    m.tri(Q(cs, cz, d1), Q(es, ez, ds), Q(cs, ez, ds))
    if "b" in faces:
        m.quad(Q(s0, z0, d0), Q(s1, z0, d0), Q(s1, z0, ds), Q(s0, z0, ds), [[s0, 0], [s1, 0], [s1, dd], [s0, dd]])
        shade(m, (0.6, 0.6, 0.8, 0.8))
    if "t" in faces:
        m.quad(Q(s0, z1, ds), Q(s1, z1, ds), Q(s1, z1, d0), Q(s0, z1, d0), [[s0, 0], [s1, 0], [s1, dd], [s0, dd]])
    if "r" in faces:
        m.quad(Q(s1, z0, d0), Q(s1, z1, d0), Q(s1, z1, ds), Q(s1, z0, ds), [[0, z0], [0, z1], [dd, z1], [dd, z0]])
    if "l" in faces:
        m.quad(Q(s0, z0, ds), Q(s0, z1, ds), Q(s0, z1, d0), Q(s0, z0, d0), [[0, z0], [0, z1], [dd, z1], [dd, z0]])


def pediment(m, a, t, n, c, w, z, rise, d):
    """A triangular pediment over an opening: its face and the two raking tops."""
    a, t, n = np.asarray(a, float), np.asarray(t, float), np.asarray(n, float)
    Q = lambda s, zz, dd: (*(a + t * s + n * dd), zz)
    L, R, A = c - w / 2, c + w / 2, c
    m.tri(Q(L, z, d), Q(R, z, d), Q(A, z + rise, d), [[L, z], [R, z], [A, z + rise]])
    m.quad(Q(L, z, d), Q(A, z + rise, d), Q(A, z + rise, 0), Q(L, z, 0), [[0, 0], [w / 2, 0], [w / 2, d], [0, d]])
    m.quad(Q(A, z + rise, d), Q(R, z, d), Q(R, z, 0), Q(A, z + rise, 0), [[0, 0], [w / 2, 0], [w / 2, d], [0, d]])
    m.quad(Q(L, z, 0), Q(R, z, 0), Q(R, z, d), Q(L, z, d), [[0, 0], [w, 0], [w, d], [0, d]])


def arch_ring(m, a, t, n, c, z, r0, r1, d, segs=10, fill=None):
    """A round arch's face on a wall, springing at z over centre c: the ring between r0 and r1, d proud, with its
    outer edge; fill: a mesh for the half disc inside it (the glass of an arched head)."""
    a, t, n = np.asarray(a, float), np.asarray(t, float), np.asarray(n, float)
    Q = lambda s, zz, dd: (*(a + t * s + n * dd), zz)
    for k in range(segs):
        q0, q1 = math.pi * k / segs, math.pi * (k + 1) / segs
        c0, s0, c1, s1 = math.cos(q0), math.sin(q0), math.cos(q1), math.sin(q1)
        m.quad(Q(c + r0 * c0, z + r0 * s0, d), Q(c + r1 * c0, z + r1 * s0, d), Q(c + r1 * c1, z + r1 * s1, d), Q(c + r0 * c1, z + r0 * s1, d),
               [[r0 * c0, r0 * s0], [r1 * c0, r1 * s0], [r1 * c1, r1 * s1], [r0 * c1, r0 * s1]])
        m.quad(Q(c + r1 * c0, z + r1 * s0, d), Q(c + r1 * c0, z + r1 * s0, 0), Q(c + r1 * c1, z + r1 * s1, 0), Q(c + r1 * c1, z + r1 * s1, d))
        if fill is not None:
            fill.tri(Q(c, z, d * 0.3), Q(c + r0 * c0, z + r0 * s0, d * 0.3), Q(c + r0 * c1, z + r0 * s1, d * 0.3), [[r0, 0], [r0 + r0 * c0, r0 * s0], [r0 + r0 * c1, r0 * s1]])


def disc(m, centre, nrm, r, segs=16, r_in=0.0, depth=0.0):
    """A disc (or a ring from r_in) facing nrm at a 3D centre; depth: its rim back to the surface behind."""
    c, nrm = np.asarray(centre, float), np.asarray(nrm, float)
    nrm = nrm / np.linalg.norm(nrm)
    ref = np.array([0, 0, 1.0]) if abs(nrm[2]) < 0.9 else np.array([1.0, 0, 0])
    u = np.cross(ref, nrm)
    u /= np.linalg.norm(u)
    v = np.cross(nrm, u)
    P = lambda rr, q: tuple(c + (u * math.cos(q) + v * math.sin(q)) * rr)
    for k in range(segs):
        q0, q1 = 2 * math.pi * k / segs, 2 * math.pi * (k + 1) / segs
        if r_in > 0:
            m.quad(P(r_in, q0), P(r, q0), P(r, q1), P(r_in, q1))
        else:
            m.tri(tuple(c), P(r, q0), P(r, q1))
        if depth:
            b0, b1 = np.asarray(P(r, q0)) - nrm * depth, np.asarray(P(r, q1)) - nrm * depth
            m.quad(P(r, q0), tuple(b0), tuple(b1), P(r, q1))


def roof_bands(m, poly, z, steps, flat=None):
    """A roof over a polygon as bands of straight slopes: steps [(inset m, rise m), ...] from the eaves in, each band
    triangulated between the outline and its inset (no grid, so a long eave is one plane), then a flat top.
    Returns the top polygon and its height. UVs: metres across and up each slope."""
    import shapely
    cur = poly.buffer(0)
    for inset, rise in steps:
        inner = cur.buffer(-inset, join_style="mitre", mitre_limit=2.5)
        band = cur.difference(inner) if not inner.is_empty else cur
        edge = cur.boundary
        for tri in getattr(shapely.constrained_delaunay_triangles(band), "geoms", []):
            pts = list(tri.exterior.coords)[:3]
            zs = [z + (rise if edge.distance(shapely.geometry.Point(p)) > 1e-3 else 0.0) for p in pts]
            P3 = [np.array([p[0], p[1], zz]) for p, zz in zip(pts, zs)]
            nn = np.cross(P3[1] - P3[0], P3[2] - P3[0])
            if nn[2] < 0:
                P3 = P3[::-1]
                nn = -nn
            ln = np.linalg.norm(nn)
            if ln < 1e-6:
                continue
            nn /= ln
            h = np.array([-nn[1], nn[0], 0.0])
            h = h / np.linalg.norm(h) if np.linalg.norm(h) > 1e-6 else np.array([1.0, 0, 0])
            up = np.cross(nn, h)
            m.tri(*[tuple(p) for p in P3], [[float(np.dot(p, h)), float(np.dot(p, up))] for p in P3])
        if inner.is_empty:
            return None, z
        cur, z = inner, z + rise
    for p in getattr(cur, "geoms", [cur]):
        if not p.is_empty and p.area > 0.5:
            ak.cap(flat or m, ak.WORLD, list(p.exterior.coords)[:-1], z)
    return cur, z


# ---------------------------------------------------------------- the wings

# The front in Tatsuno's manner: red brick striped with white stone, an opening a bay, each in a stone frame
# (a keystone on the ground floor, a pediment on the first, a cornice on the second), pilasters through the upper
# two storeys, a cornice and a balustrade before the slate. Heights over the ground for a wall of EAVES.
BANDS = (1.75, 2.55, 3.35, 4.15, 4.95, 7.75, 8.65, 9.55, 12.75, 13.65, 14.55)   # the thin stripes (0.13 m)
COURSES = ((6.0, 0.5, 0.16), (6.86, 0.14, 0.1), (11.4, 0.36, 0.14), (12.06, 0.14, 0.1))   # (z, height, out): right round
FLOORS = ((1.9, 5.1, "ground"), (7.0, 10.4, "piano"), (12.2, 14.9, "attic"))


def window(K, a, t, n, c, w, zb, zt, style, lit=True, fine=True, head=False):
    """An opening's dressing on a front: its glass and sash set back in the reveal, and its stone frame.
    style "door": a doorway onto the lit concourse, glazed leaves under a transom, stone jambs and a keystone."""
    stone, sash = K["tks_stone_fine"], K["tks_sash"]
    glass = K["tks_glass"] if lit else K["tks_glass_dark"]
    a, t, n = np.asarray(a, float), np.asarray(t, float), np.asarray(n, float)
    if style == "door":
        slab(K["tks_door"], a, t, n, c - w / 2, c + w / 2, zb, zt, -0.4, -0.38, "f")
        for s0, s1, z0, z1 in ((c - w / 2, c + w / 2, zt - 0.1, zt), (c - w / 2, c - w / 2 + 0.08, zb, zt), (c + w / 2 - 0.08, c + w / 2, zb, zt),
                               (c - 0.04, c + 0.04, zb, zb + 2.4), (c - w / 2, c + w / 2, zb + 2.4, zb + 2.5)):
            slab(K["tks_iron"], a, t, n, s0, s1, z0, z1, -0.38, -0.33, "f")
        slab(K["tks_stone"], a, t, n, c - w / 2 - 0.3, c - w / 2, zb, zt, 0, 0.1, "fl")
        slab(K["tks_stone"], a, t, n, c + w / 2, c + w / 2 + 0.3, zb, zt, 0, 0.1, "fr")
        slab(K["tks_stone"], a, t, n, c - w / 2 - 0.3, c + w / 2 + 0.3, zt, zt + 0.45, 0, 0.1, "fblr")
        slab(stone, a, t, n, c - 0.2, c + 0.2, zt - 0.05, zt + 0.6, 0, 0.16, "fblrt")
        return
    q = [a + t * (c - w / 2) - n * 0.38, a + t * (c + w / 2) - n * 0.38]
    glass.quad((*q[0], zb), (*q[1], zb), (*q[1], zt), (*q[0], zt), [[0, 0], [w, 0], [w, zt - zb], [0, zt - zb]])
    shade(glass, (0.9, 0.9, 0.6, 0.6))
    # the sash: its frame, a mullion and a transom, as faces 4 cm in front of the glass
    f = 0.07
    for s0, s1, z0, z1 in ((c - w / 2, c + w / 2, zb, zb + f), (c - w / 2, c + w / 2, zt - f, zt), (c - w / 2, c - w / 2 + f, zb, zt),
                           (c + w / 2 - f, c + w / 2, zb, zt), (c - 0.03, c + 0.03, zb, zt)):
        slab(sash, a, t, n, s0, s1, z0, z1, -0.38, -0.34, "f")
    zm = zb + (zt - zb) * 0.68
    slab(sash, a, t, n, c - w / 2, c + w / 2, zm, zm + 0.07, -0.38, -0.33, "fb")
    if not fine:
        return
    # the frame: jambs, a sill on its brackets, and the head by storey
    j = 0.2
    slab(stone, a, t, n, c - w / 2 - j, c - w / 2, zb, zt, 0, 0.07, "fl")
    slab(stone, a, t, n, c + w / 2, c + w / 2 + j, zb, zt, 0, 0.07, "fr")
    slab(stone, a, t, n, c - w / 2 - j - 0.08, c + w / 2 + j + 0.08, zb - 0.2, zb, 0, 0.16, "fbtlr")
    if head:   # an arched head over the opening (the pavilions' triple windows)
        arch_ring(stone, a, t, n, c, zt, w / 2, w / 2 + j, 0.07, 8, fill=glass)
        slab(stone, a, t, n, c - 0.15, c + 0.15, zt + w / 2 - 0.08, zt + w / 2 + j + 0.14, 0, 0.13, "fblr")
    elif style == "ground":
        slab(stone, a, t, n, c - w / 2 - j, c + w / 2 + j, zt, zt + 0.42, 0, 0.07, "fblr")
        slab(stone, a, t, n, c - 0.17, c + 0.17, zt - 0.06, zt + 0.56, 0, 0.13, "fblrt")
    elif style == "piano":
        slab(stone, a, t, n, c - w / 2 - j, c + w / 2 + j, zt, zt + 0.3, 0, 0.07, "flr")
        slab(stone, a, t, n, c - w / 2 - j - 0.14, c + w / 2 + j + 0.14, zt + 0.3, zt + 0.42, 0, 0.2, "fblr")
        pediment(stone, a, t, n, c, w + 2 * j + 0.28, zt + 0.42, 0.5, 0.2)
    else:
        slab(stone, a, t, n, c - w / 2 - j, c + w / 2 + j, zt, zt + 0.26, 0, 0.07, "flr")
        slab(stone, a, t, n, c - w / 2 - j - 0.1, c + w / 2 + j + 0.1, zt + 0.26, zt + 0.38, 0, 0.16, "fblrt")


def facade(K, ring, g, top, skip, seen=None, layout=None, pil=True, parapet=True):
    """Walls round a CCW ring (world) from the ground g up to g + top. An edge the street can see (seen(n)) is a
    front: openings cut through the brick a bay apart, their frames, the stripes between them, pilasters and the
    balustrade; another (the side over the tracks) is the brick with its courses and flat glass.
    skip(a, b): an edge to leave out (inside a taller pavilion). layout(i, L): the openings of edge i as
    [(centre, width, arched)], where the pavilions differ from the bay rhythm."""
    brick, stone, rev, fine = K["tks_brick"], K["tks_stone"], K["tks_reveal"], K["tks_stone_fine"]
    H = top
    k = H / EAVES
    n = len(ring)
    s0 = 0.0
    any_edge = False
    for i in range(n):
        a, b = np.asarray(ring[i], float), np.asarray(ring[(i + 1) % n], float)
        L = float(np.linalg.norm(b - a))
        if L < 0.5 or skip(a, b):
            s0 += L
            continue
        any_edge = True
        t = (b - a) / L
        nrm = np.array([t[1], -t[0]])
        front = seen is None or seen(nrm)
        wins = layout(i, L) if layout else None
        if wins is None:
            nb = int((L - 1.6) // BAY) if L > 4.5 else 0
            off = (L - nb * BAY) / 2 + BAY / 2
            wins = [(off + j * BAY, 1.55, False) for j in range(nb)]
            piers = [off - BAY / 2 + j * BAY for j in range(nb + 1)] if nb >= 2 and pil else []
        else:
            piers = []
        lit_ = lambda c, zb: (math.sin(c * 12.9898 + zb * 78.233 + s0 * 3.1) * 43758.5453) % 1.0 < 0.62
        if not front:
            # the back: no openings cut, the glass a centimetre proud of the brick, the main courses only
            ak.holed_wall(brick, ak.WORLD, a, b, g, g + H, [], s0=s0)
            for c, w, _ in wins:
                for zb, zt, _s in FLOORS:
                    slab(K["tks_glass_dark"], a, t, nrm, c - w / 2, c + w / 2, g + zb * k, g + zt * k, 0, 0.02, "f")
            for z, h, d in COURSES:
                slab(stone, a, t, nrm, 0, L, g + z * k, g + (z + h) * k, 0, 0.03, "f")
            slab(stone, a, t, nrm, 0, L, g, g + 1.1, 0, 0.03, "f")
            s0 += L
            continue
        # (an arched opening at the ground floor is a doorway: from the paving to 4.1 m, a little wider)
        spans = [(c, w + 0.45, g + 0.05, g + 4.1, "door") if arched and style == "ground" else (c, w, g + zb * k, g + zt * k, style)
                 for c, w, arched in wins for zb, zt, style in FLOORS]
        outl = ak.holed_wall(brick, ak.WORLD, a, b, g, g + H, [(c, w, zb, zt, False) for c, w, zb, zt, _s in spans], s0=s0)
        for (c, w, zb, zt, style), o, arched in zip(spans, outl, [ar for _c, _w, ar in wins for _f in FLOORS]):
            ak.reveal(rev, ak.WORLD, a, b, o, 0.0, -0.4)
            for kq in range(len(o)):   # (each side of the reveal: open at the wall's face, dark at the glass)
                rev.__dict__.setdefault("ao", {}).update({len(rev.v) - 4 * (len(o) - kq) + j: v for j, v in enumerate((1.0, 1.0, 0.5, 0.5))})
            window(K, a, t, nrm, c, w, zb, zt, style, lit_(c, zb), head=arched and style != "door")
        # the white stripes, between one opening's frame and the next
        edges_ = sorted((c - w / 2 - (0.53 if ar else 0.2), c + w / 2 + (0.53 if ar else 0.2)) for c, w, ar in wins)
        gaps = [(x0, x1) for x0, x1 in zip([0.0] + [e[1] for e in edges_], [e[0] for e in edges_] + [L]) if x1 - x0 > 0.05]
        for z in BANDS:
            inside = any(zb - 0.25 < z < zt + 0.6 for zb, zt, _s in FLOORS)
            for x0, x1 in (gaps if inside else [(0.0, L)]):
                slab(stone, a, t, nrm, x0, x1, g + z * k, g + (z + 0.13) * k, 0, 0.035, "fb")
        if HERO:
            # what a course or the cornice keeps the sky off: the brick just under it, darker at the top (occlusion
            # baked into the level's vertices; a strip of the wall's own brick a centimetre proud carries it)
            for ztop, hgt, dark in ((g + H - 1.5, 0.55, 0.45), (g + 6.0 * k, 0.4, 0.6), (g + 11.4 * k, 0.35, 0.6)):
                for x0, x1 in gaps:
                    brick.quad((*(a + t * x0 + nrm * 0.012), ztop - hgt), (*(a + t * x1 + nrm * 0.012), ztop - hgt),
                               (*(a + t * x1 + nrm * 0.012), ztop), (*(a + t * x0 + nrm * 0.012), ztop),
                               [[s0 + x0, ztop - hgt], [s0 + x1, ztop - hgt], [s0 + x1, ztop], [s0 + x0, ztop]])
                    shade(brick, (1.0, 1.0, dark, dark))
            for x0, x1 in gaps:   # and the wall's foot, where it meets the ground
                brick.quad((*(a + t * x0 + nrm * 0.012), g + 1.12), (*(a + t * x1 + nrm * 0.012), g + 1.12),
                           (*(a + t * x1 + nrm * 0.012), g + 1.6), (*(a + t * x0 + nrm * 0.012), g + 1.6),
                           [[s0 + x0, g + 1.12], [s0 + x1, g + 1.12], [s0 + x1, g + 1.6], [s0 + x0, g + 1.6]])
                shade(brick, (0.7, 0.7, 1.0, 1.0))
            for c, w, _ in wins[::1]:
                fp = a + t * (c + BAY / 2 if not layout else c + 1.2) + nrm * 0.9
                FLOODS.append((float(fp[0]), float(fp[1]), g + 0.25, float(nrm[0]), float(nrm[1])))
        # pilasters through the upper storeys: a base, the shaft and its capital under the cornice
        zp0, zp1 = g + 6.5 * k, g + H - 1.5
        for s in piers:
            if s < 0.45 or s > L - 0.45:
                continue
            slab(fine, a, t, nrm, s - 0.31, s + 0.31, zp0 + 0.55, zp1 - 0.6, 0, 0.14, "flr")
            slab(fine, a, t, nrm, s - 0.4, s + 0.4, zp0, zp0 + 0.55, 0, 0.2, "flrt")
            slab(fine, a, t, nrm, s - 0.38, s + 0.38, zp1 - 0.6, zp1 - 0.22, 0, 0.2, "flrb")
            slab(fine, a, t, nrm, s - 0.46, s + 0.46, zp1 - 0.22, zp1, 0, 0.27, "flrb")
        # the balustrade over the cornice
        if parapet and L > 3.0:
            zc = g + H
            slab(fine, a, t, nrm, 0, L, zc, zc + 0.22, 0.3, 0.62, "ft")
            slab(fine, a, t, nrm, 0, L, zc + 0.86, zc + 1.0, 0.3, 0.62, "fbt")
            nbal = max(1, int(L / 0.62))
            for j in range(nbal):
                s = (j + 0.5) * L / nbal
                if j % 6 == 0:
                    slab(fine, a, t, nrm, s - 0.24, s + 0.24, zc + 0.22, zc + 0.86, 0.3, 0.62, "flr")
                else:
                    slab(fine, a, t, nrm, s - 0.08, s + 0.08, zc + 0.22, zc + 0.86, 0.38, 0.54, "flr")
        s0 += L
    if any_edge:
        # the plinth, the courses and the cornice run right round
        sweep(stone, ring, g, ((0.0, 0.0), (0.22, 0.0), (0.22, 1.0), (0.12, 1.12), (0.0, 1.12)))
        for z, h, d in COURSES:
            sweep(stone, ring, g + z * k, ((0.0, 0.0), (d, 0.0), (d, h * k), (0.0, h * k)))
        zc = g + H - 1.5
        sweep(stone, ring, zc, ((0.0, 0.0), (0.1, 0.12), (0.18, 0.5), (0.34, 0.62), (0.34, 0.8), (0.55, 1.02), (0.7, 1.3), (0.7, 1.5), (0.0, 1.5)))


def dormers(K, ring, z_eave, inset, rise, skip, seen=None, every=3):
    """Dormers on the slate's front slopes, one every few bays: a gabled copper box standing out of the slope."""
    slate, cop, glass = K["tks_slate"], K["tks_copper"], K["tks_glass_small"]
    n = len(ring)
    for i in range(n):
        a, b = np.asarray(ring[i], float), np.asarray(ring[(i + 1) % n], float)
        L = float(np.linalg.norm(b - a))
        if L < 14 or skip(a, b):
            continue
        t = (b - a) / L
        nrm = np.array([t[1], -t[0]])
        if seen is not None and not seen(nrm):
            continue
        nb = int((L - 8) // (BAY * every))
        off = (L - nb * BAY * every) / 2 + BAY * every / 2
        for j in range(nb):
            d_in = 1.5
            c = a + t * (off + j * BAY * every) - nrm * d_in
            w, h = 1.3, 1.5
            z0 = z_eave + rise * d_in / inset - 0.15
            depth = (h + 0.2) * inset / rise
            slab(cop, c, t, nrm, -w / 2, w / 2, z0, z0 + h, -depth, 0, "flr")
            A, B, apex = c - t * (w / 2 + 0.12), c + t * (w / 2 + 0.12), (*c, z0 + h + 0.6)
            cop.tri((*A, z0 + h), (*B, z0 + h), apex)
            back = c - nrm * (depth + 0.5)
            slate.quad((*A, z0 + h), apex, (*back, z0 + h + 0.6), (*(back - t * (w / 2 + 0.12)), z0 + h), [[0, 0], [1.0, 0], [1.0, 2.0], [0, 2.0]])
            slate.quad(apex, (*B, z0 + h), (*(back + t * (w / 2 + 0.12)), z0 + h), (*back, z0 + h + 0.6), [[0, 0], [1.0, 0], [1.0, 2.0], [0, 2.0]])
            slab(glass, c, t, nrm, -0.42, 0.42, z0 + 0.3, z0 + h - 0.15, 0, 0.02, "f")


# ---------------------------------------------------------------- the domes

def octagon(c, R, phase):
    return [(c[0] + R * math.cos(phase + k * math.pi / 4), c[1] + R * math.sin(phase + k * math.pi / 4)) for k in range(8)]


DRUM0, DRUM1 = 20.6, 26.2     # the drum under each dome: its foot in the slate, its cornice


def dome(K, S, c, R, phase, g):
    """The drum and the dome over a pavilion: an octagon of brick with three windows a face between stone
    pilasters, its cornice, the low slate dome with copper ribs and eight round windows, the lantern and the spire."""
    brick, stone, cop, glass = K["tks_brick"], K["tks_stone"], K["tks_copper"], K["tks_glass_small"]
    ring = octagon(c, R, phase)
    for i in range(8):
        a, b = np.asarray(ring[i], float), np.asarray(ring[(i + 1) % 8], float)
        L = float(np.linalg.norm(b - a))
        t = (b - a) / L
        nrm = np.array([t[1], -t[0]])
        holes = [(L / 2 + dx, 1.05, g + DRUM0 + 2.0, g + DRUM0 + 4.3, False) for dx in (-1.9, 0.0, 1.9)]
        outl = ak.holed_wall(brick, ak.WORLD, a, b, g + DRUM0, g + DRUM1, holes)
        for (cc, w, zb, zt, _), o in zip(holes, outl):
            ak.reveal(K["tks_reveal"], ak.WORLD, a, b, o, 0.0, -0.3)
            slab(glass, a, t, nrm, cc - w / 2, cc + w / 2, zb, zt, -0.3, -0.28, "f")
            slab(K["tks_sash"], a, t, nrm, cc - 0.03, cc + 0.03, zb, zt, -0.3, -0.26, "f")
            slab(K["tks_stone_fine"], a, t, nrm, cc - w / 2 - 0.12, cc + w / 2 + 0.12, zt, zt + 0.22, 0, 0.06, "fb")
            slab(K["tks_stone_fine"], a, t, nrm, cc - w / 2 - 0.12, cc + w / 2 + 0.12, zb - 0.16, zb, 0, 0.1, "fbt")
        for s in (0.0, L):   # the corner pilasters
            slab(stone, a, t, nrm, max(0.0, s - 0.5), min(L, s + 0.5), g + DRUM0 + 1.2, g + DRUM1 - 0.7, 0, 0.12, "flr")
        slab(stone, a, t, nrm, 0, L, g + DRUM0 + 1.0, g + DRUM0 + 1.3, 0, 0.14, "fbt")
    sweep(stone, ring, g + DRUM1 - 0.9, ((0.0, 0.0), (0.12, 0.15), (0.3, 0.4), (0.5, 0.55), (0.5, 0.75), (0.62, 0.9), (0.0, 0.9)))
    # the dome: a low ellipse in section, smooth, with its ribs standing on the drum's corners
    z0, zt, r_top = g + DRUM1, g + DOME_TOP - 1.3, 1.7
    Rd = R * math.cos(math.pi / 8) + 0.25
    qmax = math.acos(r_top / Rd)
    h = (zt - z0) / math.sin(qmax)
    prof = [(z0 - 0.02, Rd + 0.3), (z0 + 0.25, Rd + 0.3), (z0 + 0.3, Rd)]
    prof += [(z0 + 0.3 + (h - 0.3 / math.sin(qmax)) * math.sin(qmax * j / 12) * 1.0, Rd * math.cos(qmax * j / 12)) for j in range(1, 13)]
    S["slate"].lathe(prof, c, segs=32)
    zt = prof[-1][0]
    P = lambda q, ang, lift=0.0: (c[0] + (Rd * math.cos(q) + lift * math.cos(q)) * math.cos(ang), c[1] + (Rd * math.cos(q) + lift * math.cos(q)) * math.sin(ang),
                                  z0 + 0.3 + (h - 0.3 / math.sin(qmax)) * math.sin(q) + lift * math.sin(q))
    for kk in range(8):
        ang = phase + kk * math.pi / 4
        pts = [P(qmax * j / 10, ang, 0.06) for j in range(11)]
        for p0, p1 in zip(pts, pts[1:]):
            cop.box(p0, p1, 0.3, 0.2)
        # a round window on each face: a copper hood with its ring, the glass lit from the hall below
        ang = phase + (kk + 0.5) * math.pi / 4
        q = qmax * 0.36
        base = np.asarray(P(q, ang))
        out = np.array([math.cos(ang), math.sin(ang), 0.0])
        ctr = base + out * 0.75 + np.array([0, 0, 0.35])
        disc(S["copper"], ctr, out, 1.05, 16, r_in=0.62, depth=1.9)
        disc(glass, ctr - out * 0.08, out, 0.62, 16)
        disc(S["copper"], ctr + out * 0.05, out, 1.2, 16, r_in=1.02, depth=0.12)
    # the lantern, its cap and the spire
    S["copper"].lathe([(zt - 0.1, r_top + 0.25), (zt + 0.25, r_top + 0.25), (zt + 0.3, r_top - 0.3), (zt + 1.0, r_top - 0.35), (zt + 1.1, r_top - 0.1),
                       (zt + 1.3, r_top - 0.15), (zt + 1.9, 0.5), (zt + 2.3, 0.22), (zt + 2.8, 0.34), (zt + 3.1, 0.12), (zt + 6.4, 0.05)], c, segs=16)
    return ring


def turret(S, K, p, z0, z1):
    """One of the round stone turrets that flank a pavilion's gable: corbelled out over the first floor, a shaft
    banded in stone, and a little copper dome with its finial."""
    S["stone"].lathe([(z0 - 1.3, 0.25), (z0 - 0.5, 0.75), (z0, 1.0), (z0 + 0.25, 1.0), (z0 + 0.3, 0.9), (z1 - 0.5, 0.9), (z1 - 0.45, 1.02), (z1, 1.08), (z1 + 0.05, 0.95)], p, segs=14)
    S["copper"].lathe([(z1, 1.0), (z1 + 0.5, 0.93), (z1 + 1.0, 0.7), (z1 + 1.35, 0.35), (z1 + 1.5, 0.12), (z1 + 1.75, 0.2), (z1 + 1.95, 0.07), (z1 + 2.7, 0.03)], p, segs=14)


def pavilion(K, S, body, c, R, phase, g, out, axis):
    """A dome pavilion on the mapped outline of its block: the front in the wings' manner but for its middle,
    where three arched windows a storey stand between two round turrets under a great arched gable with the
    clock; a slate skirt up to the drum; the dome. Round its foot the copper pent roof over the doors."""
    import shapely
    brick, stone, cop = K["tks_brick"], K["tks_stone"], K["tks_copper"]
    ring = ccw(ak.simplify(list(body.exterior.coords), 0.6))
    n = len(ring)
    # the front: the edge that looks most squarely at the plaza
    def score(i):
        a, b = np.asarray(ring[i], float), np.asarray(ring[(i + 1) % n], float)
        t = (b - a) / (np.linalg.norm(b - a) or 1)
        return float(np.dot(np.array([t[1], -t[0]]), out)) * min(1.0, np.linalg.norm(b - a) / 8.0)
    fi = max(range(n), key=score)
    seen = lambda nrm: float(np.dot(nrm, out)) > -0.35
    half = 4.4

    def layout(i, L):
        if i != fi:
            return None
        return [(L / 2 - half - 2.2, 1.45, False), (L / 2 - 2.0, 1.25, True), (L / 2, 1.25, True), (L / 2 + 2.0, 1.25, True), (L / 2 + half + 2.2, 1.45, False)] if L > 15 \
            else [(L / 2 - 2.0, 1.25, True), (L / 2, 1.25, True), (L / 2 + 2.0, 1.25, True)]
    facade(K, ring, g, EAVES, lambda a, b: False, seen=seen, layout=layout)
    a, b = np.asarray(ring[fi], float), np.asarray(ring[(fi + 1) % n], float)
    L = float(np.linalg.norm(b - a))
    t = (b - a) / L
    nrm = np.array([t[1], -t[0]])
    mid = (a + b) / 2
    half = min(half, L / 2 - 1.2)
    # the balconies under the triple windows, and the turrets
    for zb in (7.0, 12.2):
        slab(K["tks_stone_fine"], a, t, nrm, L / 2 - 3.1, L / 2 + 3.1, g + zb - 0.42, g + zb - 0.2, 0, 0.55, "fblrt")
        slab(K["tks_iron"], a, t, nrm, L / 2 - 3.05, L / 2 + 3.05, g + zb + 0.65, g + zb + 0.71, 0.48, 0.53, "ftb")
        for s in np.arange(-3.0, 3.01, 0.25):
            slab(K["tks_iron_fine"], a, t, nrm, L / 2 + s - 0.015, L / 2 + s + 0.015, g + zb - 0.2, g + zb + 0.65, 0.49, 0.52, "f")
    for sgn in (-1, 1):
        turret(S, K, tuple(mid + t * sgn * (half + 0.2) + nrm * 0.35), g + 6.5, g + EAVES + 2.6)
    # the exit's name over its doors (the sheet: assets below)
    key = "south" if float(np.dot(np.asarray(c) - np.asarray(K.centre), axis)) < 0 else "north"
    u0_, v0_, u1_, v1_ = SIGN_UV[key]
    sa, sb, z0s = mid - t * 2.6 + nrm * 0.19, mid + t * 2.6 + nrm * 0.19, g + 4.18
    K["tks_sign"].quad((*sa, z0s), (*sb, z0s), (*sb, z0s + 0.65), (*sa, z0s + 0.65), [[u0_, v0_], [u1_, v0_], [u1_, v1_], [u0_, v1_]])
    slab(K["tks_iron"], mid, t, nrm, -2.66, 2.66, z0s - 0.05, z0s + 0.7, 0, 0.18, "blrt")
    # the gable: a round arch of brick over the cornice, a stone archivolt, the clock, and the barrel roof behind
    zg = g + EAVES + 0.2
    r = half - 0.8
    Q = lambda s, z, d: (*(mid + t * s + nrm * d), z)
    segs = 16
    for kk in range(segs):
        q0, q1 = math.pi * kk / segs, math.pi * (kk + 1) / segs
        brick.tri(Q(0, zg, 0.0), Q(r * math.cos(q0), zg + r * math.sin(q0), 0.0), Q(r * math.cos(q1), zg + r * math.sin(q1), 0.0),
                  [[L / 2, zg], [L / 2 + r * math.cos(q0), zg + r * math.sin(q0)], [L / 2 + r * math.cos(q1), zg + r * math.sin(q1)]])
    arch_ring(stone, mid, t, nrm, 0.0, zg, r, r + 0.55, 0.18, segs)
    arch_ring(stone, mid, t, nrm, 0.0, zg, r - 1.5, r - 1.3, 0.05, segs)
    slab(stone, mid, t, nrm, -r - 0.55, r + 0.55, zg - 0.2, zg + 0.35, 0, 0.2, "fblrt")
    slab(stone, mid, t, nrm, -0.3, 0.3, zg + r - 0.1, zg + r + 0.9, 0, 0.26, "fblrt")
    cc = np.array([*(mid + nrm * 0.1), zg + r * 0.42])
    n3 = np.array([nrm[0], nrm[1], 0.0])
    disc(K["tks_clock"], cc, n3, 0.95, 20)
    disc(S["copper"], cc + n3 * 0.02, n3, 1.12, 20, r_in=0.93, depth=0.1)
    t3 = np.array([t[0], t[1], 0.0])
    for ang, ln in ((math.radians(60), 0.55), (math.radians(-50), 0.8)):   # the hands, at ten past ten
        dirv = t3 * math.sin(ang) * -1 + np.array([0, 0, 1.0]) * math.cos(ang)
        K["tks_iron"].box(tuple(cc + n3 * 0.04), tuple(cc + n3 * 0.04 + dirv * ln), 0.06, 0.02)
    back = 9.0
    for kk in range(segs):
        q0, q1 = math.pi * kk / segs, math.pi * (kk + 1) / segs
        r1 = r + 0.5
        S["copper"].quad(Q(r1 * math.cos(q0), zg + r1 * math.sin(q0), 0.25), Q(r1 * math.cos(q0), zg + r1 * math.sin(q0), -back),
                         Q(r1 * math.cos(q1), zg + r1 * math.sin(q1), -back), Q(r1 * math.cos(q1), zg + r1 * math.sin(q1), 0.25))
    # the slate skirt from the cornice up to the drum, and the dome
    top, zt = roof_bands(K["tks_slate"], body, g + EAVES, [(3.4, 3.6), (3.0, 0.9)], flat=K["tks_slate"])
    dormers(K, ring, g + EAVES, 3.4, 3.6, lambda a_, b_: False, seen=seen, every=2)
    dome(K, S, c, R, phase, g)
    # corner roofs: a small square dome on the block's shoulders either side of the front
    for sgn in (-1, 1):
        p = mid + t * sgn * (L / 2 + 1.0) - nrm * 3.2
        if body.contains(shapely.geometry.Point(*p)):
            S["slate"].lathe([(g + EAVES + 0.9, 2.6), (g + EAVES + 2.6, 2.5), (g + EAVES + 4.6, 1.7), (g + EAVES + 5.6, 0.7), (g + EAVES + 5.9, 0.25)], tuple(p), segs=8)
            S["copper"].lathe([(g + EAVES + 5.8, 0.3), (g + EAVES + 6.2, 0.16), (g + EAVES + 6.5, 0.24), (g + EAVES + 6.8, 0.06), (g + EAVES + 7.8, 0.03)], tuple(p), segs=8)
    # the pent roof over the doors: copper sheet on iron posts along every face that looks at the street
    run = []
    for i in range(n):
        a_, b_ = np.asarray(ring[i], float), np.asarray(ring[(i + 1) % n], float)
        t_ = (b_ - a_) / (np.linalg.norm(b_ - a_) or 1)
        run.append(float(np.dot(np.array([t_[1], -t_[0]]), out)) > 0.2)
    start = next((i for i in range(n) if run[i] and not run[i - 1]), None)
    if start is not None:
        pts = [ring[start]]
        i = start
        while run[i % n] and len(pts) <= n:
            pts.append(ring[(i + 1) % n])
            i += 1
        zw, zo, d = g + 5.85, g + 5.0, 3.4
        inner, outer = _offset_open(pts, 0.16), _offset_open(pts, d)
        slen = 0.0
        for j in range(len(pts) - 1):
            Lj = math.dist(pts[j], pts[j + 1])
            K["tks_pent"].quad((*inner[j], zw), (*inner[j + 1], zw), (*outer[j + 1], zo), (*outer[j], zo), [[slen, 0], [slen + Lj, 0], [slen + Lj, d], [slen, d]])
            K["tks_soffit"].quad((*inner[j + 1], zw - 0.14), (*inner[j], zw - 0.14), (*outer[j], zo - 0.14), (*outer[j + 1], zo - 0.14))
            K["tks_pent"].quad((*outer[j], zo - 0.2), (*outer[j + 1], zo - 0.2), (*outer[j + 1], zo), (*outer[j], zo), [[slen, 0], [slen + Lj, 0], [slen + Lj, 0.2], [slen, 0.2]])
            o0, o1 = np.asarray(outer[j]), np.asarray(outer[j + 1])
            Lo = float(np.linalg.norm(o1 - o0))
            tt = (o1 - o0) / Lo
            nn = np.array([tt[1], -tt[0]])
            for s in np.arange(1.8, Lo - 0.9, 3.6):
                q = o0 + tt * s - nn * 0.25
                K["tks_iron"].box((*q, g), (*q, zo - 0.1), 0.14, 0.14)
                K["tks_iron_fine"].box((*q, zo - 0.75), (*(q - nn * 0.7), zo - 0.16), 0.05, 0.08)
            slen += Lj
    return ring


# ---------------------------------------------------------------- the building

def building(K, S):
    import shapely
    from shapely.geometry import Polygon
    solids = [s for s in ak.load_solids("tokyo") if s["name"] == NAME]
    g = float(np.median([s["ground"] for s in solids]))
    hidden = [s["si"] for s in solids]
    domes = [s for s in solids if s["top"] - s["ground"] > 30]
    pav = [s for s in solids if 22 < s["top"] - s["ground"] <= 30]
    porch = [s for s in solids if s["top"] - s["ground"] < 10]
    wings = [s for s in solids if s not in domes and s not in pav and s not in porch]
    octs = []
    for d in domes:
        c = ak.ring_centroid(d["ring"])
        R = math.sqrt(abs(ak.ring_area(d["ring"])) / (2 * math.sqrt(2)))   # the mapped octagon's circumradius
        v = np.asarray(d["ring"][0]) - np.asarray(c)
        octs.append((c, R, math.atan2(v[1], v[0])))
    octs.sort(key=lambda o: o[0][1])   # south first
    (c0, *_), (c1, *_) = octs
    axis = np.asarray(c1) - np.asarray(c0)
    axis /= np.linalg.norm(axis)
    out = np.array([-axis[1], axis[0]])
    if out[0] > 0:   # the plaza is on the west, the Palace's side
        out = -out
    seen = lambda nrm: float(np.dot(nrm, out)) > -0.35
    K.centre = (np.asarray(c0) + np.asarray(c1)) / 2
    union = lambda ss: shapely.union_all([Polygon(s["ring"]).buffer(0) for s in ss]).buffer(0.05).buffer(-0.05)
    # the pavilion blocks round each dome, and the wings between and beyond them
    tall = union(pav + domes)
    blocks = [p for p in getattr(tall, "geoms", [tall]) if p.area > 30]
    low = union(wings).difference(tall.buffer(-0.3))
    in_tall = lambda a, b: tall.buffer(0.4).contains(shapely.geometry.Point((a + b) / 2))
    for p in list(getattr(low, "geoms", [low])):
        if p.area < 30:
            continue
        r = ccw(ak.simplify(list(p.exterior.coords), 0.6))
        facade(K, r, g, EAVES, in_tall, seen=seen)
        roof_bands(K["tks_slate"], Polygon(r), g + EAVES, [(3.2, 3.9), (4.0, 1.1)])
        dormers(K, r, g + EAVES, 3.2, 3.9, in_tall, seen=seen)
    for c, R, ph in octs:
        body = min(blocks, key=lambda p: p.centroid.distance(shapely.geometry.Point(c)))
        pavilion(K, S, body, c, R, ph, g, out, axis)
    body = union(wings + pav)
    # the central pavilion: the imperial entrance's front, raised to CENTRE_TOP under its own steep roof
    if porch:
        pc = np.asarray(ak.ring_centroid(porch[0]["ring"]))
        mid = np.asarray(body.centroid.coords[0])
        o2 = out if np.dot(pc - mid, out) > 0 else -out
        cpt = pc - o2 * 4.0
        rr = ccw([tuple(cpt + axis * u + o2 * v) for u, v in ((-15, -22), (15, -22), (15, 2.5), (-15, 2.5))])
        facade(K, rr, g, EAVES + 2.2, lambda a, b: False, seen=seen)
        roof_bands(K["tks_slate"], Polygon(rr), g + EAVES + 2.2, [(4.2, CENTRE_TOP - EAVES - 2.2 - 0.6), (3.0, 0.6)])
        dormers(K, rr, g + EAVES + 2.2, 4.2, CENTRE_TOP - EAVES - 2.8, lambda a, b: False, seen=seen, every=2)
        # the porch: an arch in each face, brick over stone imposts, a stone entablature and parapet
        pr = ccw(ak.simplify(list(porch[0]["ring"]), 0.3))
        pz = porch[0]["top"] - porch[0]["ground"]
        zt = g + pz - 1.4
        for i in range(len(pr)):
            a, b = np.asarray(pr[i], float), np.asarray(pr[(i + 1) % len(pr)], float)
            L = float(np.linalg.norm(b - a))
            t = (b - a) / L
            nrm = np.array([t[1], -t[0]])
            w = L - 2.4
            o = ak.holed_wall(K["tks_brick"], ak.WORLD, a, b, g, zt, [(L / 2, w, g, zt - 1.25, False)])
            ak.reveal(K["tks_stone"], ak.WORLD, a, b, o[0], 0.0, -0.9)
            for sx in (0.6, L - 0.6):   # stone piers' faces and imposts
                box(K["tks_stone"], a + t * sx, t, nrm, g, g + 0.9, 1.3, 0.08)
                box(K["tks_stone"], a + t * sx, t, nrm, zt - 1.6, zt - 1.25, 1.4, 0.12)
                z = g + 0.9
                while z + 0.45 < zt - 1.6:
                    box(K["tks_stone"], a + t * sx, t, nrm, z, z + 0.4, 1.25, 0.05)
                    z += 0.9
            box(K["tks_stone"], a + t * L / 2, t, nrm, zt - 1.25, zt - 0.5, 0.6, 0.12)   # the keystone
        ak.prism(K["tks_stone"], ak.WORLD, pr, zt, g + pz - 0.5)
        ak.cap(K["tks_stone"], ak.WORLD, pr, zt, down=True)
        sweep(K["tks_stone"], pr, zt, ((0.0, 0.0), (0.12, 0.1), (0.3, 0.35), (0.42, 0.55), (0.42, 0.7), (0.0, 0.7)))
        sweep(K["tks_stone"], pr, g + pz - 0.5, ((0.0, 0.0), (0.0, 0.0), (-0.02, 0.0), (-0.02, 0.8), (-0.32, 0.8), (-0.32, 0.0)))
    return g, hidden, octs, axis


# ---------------------------------------------------------------- the plaza

OSM = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hero_osm.json")   # (c) OpenStreetMap contributors, ODbL
CENTRAL = (-43.3, 34.4)    # the pedestrian plaza between the two transport plazas, metres along the front from the domes' middle
LANE = 3.3                 # half the width of a lane of the transport plazas' roadway


def _under(t):
    try:
        return int(float(t.get("layer", "0"))) < 0 or t.get("tunnel") in ("yes", "building_passage") or t.get("indoor") == "yes"
    except ValueError:
        return False


def _osm(path=OSM):
    """OpenStreetMap's map of a level's box (pipeline/hero_osm.py), by kind, as shapely shapes in local metres."""
    from shapely.geometry import LineString, Point, Polygon
    d = json.load(open(path))
    out = {"common": [], "ped": [], "grass": [], "garden": [], "roof": [], "service": [], "tree": [], "road": [], "zebra": [], "wood": [], "parking": []}
    for w in d["ways"]:
        t = w["tags"]
        if _under(t) or len(w["xy"]) < 2:
            continue
        if w.get("closed") and len(w["xy"]) > 3:
            kind = ("common" if t.get("leisure") == "common" else "ped" if t.get("highway") == "pedestrian" else
                    "grass" if t.get("landuse") == "grass" or t.get("natural") == "grassland" else "garden" if t.get("leisure") == "garden" else
                    "roof" if t.get("building") == "roof" else "wood" if t.get("landuse") == "forest" or t.get("natural") == "wood" or t.get("leisure") == "park" else
                    "parking" if t.get("amenity") == "parking" else None)
            if kind:
                p = Polygon(w["xy"]).buffer(0)
                out[kind].append((p, int(float(t.get("layer", "1") or 1))) if kind == "roof" else p)
                continue
        if t.get("highway") == "service":
            out["service"].append(LineString(w["xy"]))
        elif t.get("highway") in ("trunk", "primary", "secondary", "tertiary", "unclassified", "residential"):
            lanes = int(float(t.get("lanes") or (2 if t.get("oneway") == "yes" else 4 if t["highway"] in ("primary", "secondary") else 2)))
            out["road"].append((LineString(w["xy"]), lanes))
        elif t.get("footway") == "crossing":
            out["zebra"].append(LineString(w["xy"]))
    out["tree"] = [Point(n["xy"]) for n in d["nodes"] if n["tags"].get("natural") == "tree"]
    out["stop"] = [Point(n["xy"]) for n in d["nodes"] if n["tags"].get("highway") == "bus_stop" or n["tags"].get("amenity") == "taxi"]
    return out


class Ground:
    """The ground the game draws and walks on: game.json's terrain, read on each cell's two triangles as
    web/game/nav.js reads it (as blender/hero_open.Ground does for the streamed levels)."""

    def __init__(self, city):
        import base64
        root = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "web", "data", city)
        S = json.load(open(os.path.join(root, "scene.json")))
        t = json.load(open(os.path.join(root, "game.json")))["terrain"]
        self.nx, self.ny, self.cell = t["nx"], t["ny"], t["cell"]
        self.x0, self.y1 = S["frame"]["x"][0], S["frame"]["y"][1]
        self.d = (np.frombuffer(base64.b64decode(t["data"]), dtype="<i2").astype(float) * t["scale"]).reshape(self.ny, self.nx)

    def __call__(self, x, y):
        c = max(0.0, min(self.nx - 1.001, (x - self.x0) / self.cell))
        r = max(0.0, min(self.ny - 1.001, (self.y1 - y) / self.cell))
        c0, r0 = int(c), int(r)
        fc, fr = c - c0, r - r0
        a, b, d, e = self.d[r0, c0], self.d[r0, c0 + 1], self.d[r0 + 1, c0], self.d[r0 + 1, c0 + 1]
        if fc + fr <= 1:
            return float(a + fc * (b - a) + fr * (d - a))
        return float(e + (1 - fc) * (d - e) + (1 - fr) * (b - e))

    def facets(self, poly):
        """A polygon cut on the terrain's own triangles, so that what is laid on each piece lies flat on the ground."""
        from shapely.geometry import Polygon
        from shapely.prepared import prep
        x0, y0, x1, y1 = poly.bounds
        pp, k = prep(poly), self.cell
        for c in range(int((x0 - self.x0) // k), int((x1 - self.x0) // k) + 1):
            for r in range(int((self.y1 - y1) // k), int((self.y1 - y0) // k) + 1):
                xl, xr, yt, yb = self.x0 + c * k, self.x0 + (c + 1) * k, self.y1 - r * k, self.y1 - (r + 1) * k
                for tri in (Polygon([(xl, yt), (xr, yt), (xl, yb)]), Polygon([(xr, yt), (xr, yb), (xl, yb)])):
                    if pp.contains(tri):
                        yield tri
                    elif pp.intersects(tri):
                        cc = poly.intersection(tri)
                        for q in getattr(cc, "geoms", [cc]):
                            if q.geom_type == "Polygon" and q.area > 0.005:
                                yield q


def _lay(m, poly, Z, lift, uv):
    """A flat surface on the ground over a polygon (with holes): triangles, texture coordinates in metres."""
    import shapely
    for tri in getattr(shapely.constrained_delaunay_triangles(poly), "geoms", []):
        pts = list(tri.exterior.coords)[:3]
        if (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[1][1] - pts[0][1]) * (pts[2][0] - pts[0][0]) < 0:
            pts = pts[::-1]
        m.tri(*[(float(x), float(y), Z(x, y) + lift) for x, y in pts], [list(uv(x, y)) for x, y in pts])


def plaza(K, g, octs, axis):
    """The forecourt on OpenStreetMap's outlines: the white granite of the pedestrian plaza laid slab by slab in
    three tones, its lawns, the transport plazas' roadway and pavers, planted islands, kerbs; the canopies over
    the bus and taxi stands; and as props the lamps and the granite bollards. Returns (trees, props, hidden)."""
    import shapely
    from shapely import affinity
    from shapely.geometry import Point, Polygon
    from shapely.prepared import prep
    T = Ground("tokyo")
    Z = lambda x, y: float(T(x, y))
    (c0, R0, _), (c1, R1, _) = octs
    centre = (np.asarray(c0) + np.asarray(c1)) / 2
    out = np.array([-axis[1], axis[0]])
    if out[0] > 0:
        out = -out
    P = lambda u, v: centre + axis * u + out * v
    uv = lambda x, y: (float(np.dot(np.array([x, y]) - centre, axis)), float(np.dot(np.array([x, y]) - centre, out)))
    quad = lambda u0, u1, v0, v1: Polygon([tuple(P(u0, v0)), tuple(P(u1, v0)), tuple(P(u1, v1)), tuple(P(u0, v1))])
    O = _osm()
    solids = ak.load_solids("tokyo")
    station = shapely.union_all([Polygon(s["ring"]).buffer(0) for s in solids if s["name"] == NAME]).buffer(0.3)
    common = shapely.union_all(O["common"])
    near = common.buffer(45)
    front = quad(-150, 150, 0, 300)   # everything on the plaza's side of the domes' line
    peds = shapely.union_all([p for p in O["ped"] if p.intersects(near)]).intersection(front)
    rim = station.buffer(9)
    apron = rim.intersection(affinity.translate(rim, *(out * 11)))   # the footway at the building's foot, on its street side
    area = shapely.union_all([common, peds, quad(-128, 128, 6, 42), apron]).difference(station).buffer(0)
    central = quad(CENTRAL[0], CENTRAL[1], 0, 300).intersection(area)
    lawn = shapely.union_all([p for p in O["grass"] if p.intersects(area)]).intersection(area)
    garden = shapely.union_all([p for p in O["garden"] if p.intersects(area)]).intersection(area).difference(lawn)
    lanes = shapely.union_all([l.buffer(LANE, cap_style="round") for l in O["service"] if l.intersects(common)])
    asphalt = lanes.intersection(common.buffer(1.5)).difference(central.buffer(0.5)).difference(peds).difference(lawn).difference(garden)
    asphalt = asphalt.buffer(-0.4).buffer(0.4)
    green = shapely.union_all([lawn, garden])
    granite = central.difference(green.buffer(0.3))
    pavers = area.difference(central).difference(asphalt).difference(green.buffer(0.3)).buffer(0)

    # the roadway, the pavers and the grass, each one surface cut on a grid so that it lies on the ground
    cover = shapely.union_all([garden, lawn])
    for mesh, poly, lift in ((K["tks_asphalt"], asphalt, 0.03), (K["tks_pavers"], pavers, 0.04), (K["tks_lawn"], lawn, 0.07), (K["tks_joint"], granite, 0.02),
                             (K["tks_groundcover"], garden, 0.1)):
        for q in T.facets(poly):
            _lay(mesh, q, Z, lift, uv)
    # the granite: rows along the front, 0.75 m deep, slabs of 1.2 to 3 m in three tones (photographs, docs/HERO.md)
    rnd = np.random.default_rng(1914)
    gp = prep(granite)
    main = max(getattr(granite, "geoms", [granite]), key=lambda q: q.area)
    u0, v0, u1, v1 = CENTRAL[0], 0.0, CENTRAL[1], max(uv(x, y)[1] for x, y in main.exterior.coords)
    tones = [K["tks_granite_a"], K["tks_granite_b"], K["tks_granite_c"]]
    row, gap = 0.75, 0.006
    v = v0
    while v < v1:
        u = u0 - rnd.uniform(0, 2.0)
        while u < u1:
            ln = float(rnd.choice((1.2, 1.5, 1.8, 2.4, 3.0), p=(0.15, 0.2, 0.3, 0.25, 0.1)))
            m = tones[int(rnd.choice(3, p=(0.56, 0.27, 0.17)))]
            r = quad(u + gap, u + ln - gap, v + gap, v + row - gap)
            if gp.contains(r):
                pts = list(r.exterior.coords)[:4]
                zz = max(Z(x, y) for x, y in pts + [(r.centroid.x, r.centroid.y)]) + 0.045   # (a slab is flat: it sits on its highest corner)
                m.quad(*[(x, y, zz) for x, y in pts], [list(uv(x, y)) for x, y in pts])
            elif gp.intersects(r):
                c = r.intersection(granite)
                for q in getattr(c, "geoms", [c]):
                    if q.geom_type == "Polygon" and q.area > 0.02:
                        _lay(m, q, Z, 0.05, uv)
            u += ln
        v += row
    zone = shapely.union_all([quad(-112, 150, 2, 300), quad(-190, -112, -45, 300)]).intersection(area.buffer(60)).difference(area).difference(station)
    streets(K, O, T, Z, uv, zone, solids)
    # planted islands: a clipped hedge mass within a granite edging; and a kerb round the roadway and the lawns
    hedge, kerb = K["tks_hedge"], K["tks_kerb"]
    for q in getattr(garden, "geoms", [garden]):
        if q.is_empty or q.area < 3:
            continue
        ring = ccw(ak.simplify(list(q.exterior.coords)[:-1], 0.25))
        z = max(Z(x, y) for x, y in ring)
        sweep(kerb, ring, z - 0.1, ((0.0, 0.0), (0.0, 0.32), (-0.18, 0.32), (-0.18, 0.0)))
        # a clipped azalea hedge 0.9 m wide round the bed, its top eased; ground cover and the trees within
        outer, inner = q.buffer(-0.3), q.buffer(-1.2)
        if outer.is_empty:
            continue
        band = outer.difference(inner) if q.area > 40 and not inner.is_empty else outer
        for h in getattr(band, "geoms", [band]):
            if h.is_empty or h.area < 0.5:
                continue
            for ringc, sgn in [(h.exterior, 1)] + [(i, -1) for i in h.interiors]:
                r2 = ak.simplify(list(ringc.coords)[:-1], 0.25)
                if len(r2) < 3:
                    continue
                r2 = ccw(r2)
                sweep(hedge, r2, z + 0.15, ((0.0, 0.0), (0.0, 0.3), (-0.1, 0.4)) if sgn > 0 else ((0.1, 0.4), (0.0, 0.3), (0.0, 0.0)))
            top = h.buffer(-0.1)
            for hh in getattr(top, "geoms", [top]):
                if not hh.is_empty and hh.area > 0.3:
                    _lay(hedge, hh, lambda x, y: z, 0.55, uv)
    for poly, hgt in ((lawn, 0.1),):
        for q in getattr(poly, "geoms", [poly]):
            if q.is_empty or q.area < 4:
                continue
            for ringc in [q.exterior] + list(q.interiors):
                ring = ak.simplify(list(ringc.coords)[:-1], 0.2)
                if len(ring) < 3:
                    continue
                ring = ccw(ring)
                z = Z(*ring[0])
                sweep(kerb, ring, z, ((0.0, 0.0), (0.0, hgt), (0.16, hgt), (0.16, 0.0)))
    # the canopies over the stands and the doors: a thin white roof on slender steel, lit from its soffit
    hidden = []
    roofs = [(p, lay) for p, lay in O["roof"] if p.intersects(area.buffer(3))]
    for s in solids:
        if s["name"] != NAME and s["top"] - s["ground"] < 12 and any(r.buffer(1.5).contains(Point(ak.ring_centroid(s["ring"]))) for r, _ in roofs):
            hidden.append(s["si"])
    for r, lay in roofs:
        canopy(K, r, Z, 5.4 if lay >= 2 and r.area > 100 else 3.3)
    STOPS[:] = [(p.x, p.y, Z(p.x, p.y)) for p in O.get("stop", []) if area.buffer(3).contains(p)]
    # the trees OpenStreetMap maps, lamps along the rows that edge the pedestrian plaza, bollards at the street
    trees, lamps, bollards = [], [], []
    rows = {}
    for t in O["tree"]:
        if not area.buffer(4).contains(t) or station.buffer(1).contains(t):
            continue
        hgt = 95 + int(rnd.integers(0, 40))
        trees.append([int(round(t.x * 10)), int(round(t.y * 10)), int(round(Z(t.x, t.y) * 10)), hgt])
        u, v = uv(t.x, t.y)
        for k, edge in enumerate(CENTRAL):
            if abs(u - edge) < 5:
                rows.setdefault(k, []).append((v, u))
    for k, pts in rows.items():
        pts.sort()
        for (va, ua), (vb, ub) in list(zip(pts, pts[1:]))[::2]:
            x, y = P((ua + ub) / 2, (va + vb) / 2)
            lamps.append([round(float(x), 2), round(float(y), 2), round(Z(x, y) + 0.05, 2), 0.0])
    head = math.atan2(axis[1], axis[0])
    edge = main.exterior
    vmax = v1
    s = 0.0
    while s < edge.length:
        q = edge.interpolate(s)
        u, v = uv(q.x, q.y)
        if v > vmax - 14 and CENTRAL[0] + 2 < u < CENTRAL[1] - 2 and abs(u - (CENTRAL[0] + CENTRAL[1]) / 2) > 5:
            x, y = P(u, v - 1.0)
            if granite.contains(Point(x, y)):
                bollards.append([round(float(x), 2), round(float(y), 2), round(Z(x, y) + 0.05, 2), round(head, 3)])
        s += 3.0
    props = [{"name": "tks_lamp3", "far": 260, "parts": lamp3_parts(), "at": lamps},
             {"name": "tks_bollard", "far": 140, "parts": bollard_parts(), "at": bollards}]
    return trees, props, hidden


LANE_W = 3.2


def streets(K, O, T, Z, uv, zone, solids, walk_in=None, hard=None):
    """The streets round a level (zone), as far as the first frame and a low flight see them: one asphalt surface on
    the mapped carriageways (a lane 3.2 m), pavers to the buildings' feet, lane dashes and the mapped zebras. They
    lie over the city's ground, whose aerial photograph (cars, shadows, a colour cast) showed there from the air."""
    import shapely
    from shapely.geometry import LineString, Point, Polygon
    blds = shapely.union_all([Polygon(b["ring"]).buffer(0.2) for b in solids
                              if b["top"] - b["ground"] > 2.5 and Polygon(b["ring"]).intersects(zone)])
    half = lambda n: n * LANE_W / 2 + 0.35
    road = shapely.union_all([l.buffer(half(n), cap_style="flat") for l, n in O["road"]] + [l.buffer(3.3) for l in O["service"]])
    if hard is not None:   # (a car park, a forecourt: asphalt too)
        road = shapely.union_all([road, hard])
    road = road.buffer(1.2).buffer(-1.2).intersection(zone).difference(blds)
    walk = (zone if walk_in is None else zone.intersection(walk_in)).difference(road).difference(blds).buffer(-0.05)
    for mesh, poly, lift in ((K["tks_asphalt"], road, 0.03), (K["tks_pavers"], walk, 0.04)):
        for q in T.facets(poly):
            _lay(mesh, q, Z, lift, uv)
    paint = K["tks_paint"]
    rp = shapely.prepared.prep(road.buffer(-0.3))

    def mark(a, b, w):
        """A painted strip from a to b, w wide, on the road."""
        a, b = np.asarray(a, float), np.asarray(b, float)
        L = float(np.linalg.norm(b - a))
        if L < 0.2:
            return
        n = np.array([-(b - a)[1], (b - a)[0]]) / L * w / 2
        pts = [a - n, b - n, b + n, a + n]
        if all(rp.contains(Point(*q)) for q in pts):
            zz = max(Z(*q) for q in pts) + 0.045
            paint.quad(*[(float(q[0]), float(q[1]), zz) for q in pts], [list(uv(*q)) for q in pts])

    def heading(l, s):
        p0, p1 = l.interpolate(max(0.0, s - 1.0)), l.interpolate(min(l.length, s + 1.0))
        v = np.array([p1.x - p0.x, p1.y - p0.y])
        return v / (np.linalg.norm(v) or 1)

    # lane dashes: 5 m of paint, 5 m of road, between the lanes of each carriageway, but not across a junction
    for l, n in O["road"]:
        if n < 2 or not l.intersects(zone):
            continue
        s = 2.5
        while s + 5.0 < l.length:
            pm = l.interpolate(s + 2.5)
            h = heading(l, s + 2.5)
            crossing = any(o is not l and o.distance(pm) < half(m) + half(n) and abs(float(np.dot(heading(o, o.project(pm)), h))) < 0.8
                           for o, m in O["road"])
            if not crossing:
                nrm = np.array([-h[1], h[0]])
                p0, p1 = l.interpolate(s), l.interpolate(s + 5.0)
                for i in range(1, n):
                    off = (i - n / 2) * LANE_W
                    mark(np.array([p0.x, p0.y]) + nrm * off, np.array([p1.x, p1.y]) + nrm * off, 0.15)
            s += 10.0
    # zebras on the mapped crossings: bars 0.45 m wide, 0.9 m apart, 4 m long, along the traffic
    for l in O["zebra"]:
        if not l.intersects(zone):
            continue
        s = 0.3
        while s < l.length - 0.3:
            pm = l.interpolate(s)
            h = heading(l, s)
            nrm = np.array([-h[1], h[0]])
            c = np.array([pm.x, pm.y])
            mark(c - nrm * 2.0, c + nrm * 2.0, 0.45)
            s += 0.9


def canopy(K, poly, Z, h):
    """A stand's canopy on a mapped roof's outline: the roof plate, its fascia, a lit soffit, a beam and posts."""
    white, iron = K["tks_canopy"], K["tks_iron"]
    ring = ccw(ak.simplify(list(poly.exterior.coords)[:-1], 0.15))
    z = Z(poly.centroid.x, poly.centroid.y) + h
    ak.prism(white, ak.WORLD, ring, z, z + 0.16)
    ak.cap(K["tks_soffit"], ak.WORLD, ring, z - 0.005, down=True)
    rect = list(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    e = [np.asarray(rect[1]) - np.asarray(rect[0]), np.asarray(rect[2]) - np.asarray(rect[1])]
    li = 0 if np.linalg.norm(e[0]) >= np.linalg.norm(e[1]) else 1
    L, W = float(np.linalg.norm(e[li])), float(np.linalg.norm(e[1 - li]))
    t, n = e[li] / L, e[1 - li] / W
    o = np.asarray(rect[0]) if li == 0 else np.asarray(rect[1])
    from shapely.geometry import Point
    rowsv = (W / 2,) if W < 3.6 else (0.6, W - 0.6)
    if W < 3.6 and L > 8:   # a stand's shelter: a bench between each pair of posts
        for sb in np.arange(3.5, L - 2.5, 5.5):
            qb = o + t * sb + n * (W / 2 + 0.55)
            BENCHES.append((float(qb[0]), float(qb[1]), Z(*qb), math.atan2(t[1], t[0])))
    for vv in rowsv:
        pts = []
        for s in np.arange(1.0, L - 0.5, max(4.5, min(6.0, (L - 2.0) / max(1, round((L - 2.0) / 5.5))))):
            q = o + t * s + n * vv
            if poly.buffer(-0.2).contains(Point(*q)):
                zz = Z(*q)
                iron.box((*q, zz), (*q, z), 0.14, 0.14)
                pts.append(q)
        for a, b in zip(pts, pts[1:]):
            if poly.buffer(0.05).contains(Point(*((a + b) / 2))):
                iron.box((*a, z - 0.12), (*b, z - 0.12), 0.12, 0.22)


def _ground(T, x, y, g):
    return max(0.0, float(T(x, y)))


def lamp3_parts():
    """The plaza's three-lamp post: a black iron column 6 m tall, three arms, three white globes."""
    pole = Mesh("tks_lamp3_pole", "tks_iron", False)
    pole.box((0, 0, 0), (0, 0, 0.5), 0.42, 0.42)
    pole.box((0, 0, 0.5), (0, 0, 5.4), 0.18, 0.18)
    globes = Mesh("tks_lamp3_globe", "tks_lamp", False, floodlit=True)
    for k in range(3):
        a = k * 2 * math.pi / 3
        ex, ey = 0.75 * math.cos(a), 0.75 * math.sin(a)
        pole.box((0, 0, 5.3), (ex, ey, 5.5), 0.08, 0.08)
        pole.box((ex, ey, 5.5), (ex, ey, 5.62), 0.12, 0.12)
        globes.box((ex, ey, 5.62), (ex, ey, 6.15), 0.36, 0.36)
    pole.box((0, 0, 5.4), (0, 0, 6.4), 0.12, 0.12)
    globes.box((0, 0, 6.4), (0, 0, 6.85), 0.3, 0.3)
    return [_dump(pole), _dump(globes)]


def bollard_parts():
    """The plaza's bollard: a drum of white granite under a low dome, 0.9 m across."""
    m = Mesh("tks_bollard", "tks_granite_a", True, uv=True)
    m.lathe([(0.0, 0.44), (0.46, 0.45), (0.5, 0.44), (0.62, 0.38), (0.7, 0.26), (0.74, 0.12), (0.75, 0.0)], (0, 0), segs=14)
    return [_dump(m)]


def _dump(m):
    d = m.dump()
    return d


# ---------------------------------------------------------------- the signs

SIGN_UV = {"south": (0.0, 0.5, 1.0, 1.0), "north": (0.0, 0.0, 1.0, 0.5)}   # (u0, v0, u1, v1) on tks_signs.png, v up
SIGN_TEXT = {"south": ("丸の内南口", "Marunouchi South Entrance"), "north": ("丸の内北口", "Marunouchi North Entrance")}


def sign_image():
    """The exits' name boards: white lettering on a dark bronze ground, as the restored building's own signs are
    kept quiet. Our own drawing; the lettering is IPA Gothic (IPA Font License) where it is installed."""
    from PIL import Image, ImageDraw, ImageFont

    def font(size):
        for f in ("/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf", "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
                  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"):
            if os.path.exists(f):
                return ImageFont.truetype(f, size)
        return ImageFont.load_default()
    W, H = 1024, 256
    img = Image.new("RGB", (W, H), (38, 31, 25))
    d = ImageDraw.Draw(img)
    for key, (u0, v0, u1, v1) in SIGN_UV.items():
        y0, y1 = int((1 - v1) * H), int((1 - v0) * H)
        d.rectangle([4, y0 + 4, W - 5, y1 - 5], outline=(150, 124, 84), width=2)
        ja, en = SIGN_TEXT[key]
        d.text((W * 0.3, (y0 + y1) / 2), ja, font=font(74), fill=(244, 238, 224), anchor="mm")
        d.text((W * 0.73, (y0 + y1) / 2 + 4), en, font=font(34), fill=(226, 214, 190), anchor="mm")
    return img


def assets(out_dir):
    sign_image().save(os.path.join(out_dir, "tks_signs.png"))
    return ["tks_signs.png"]


# ---------------------------------------------------------------- entry

GROUND = ("tks_asphalt", "tks_pavers", "tks_lawn", "tks_joint", "tks_groundcover", "tks_granite_a", "tks_granite_b", "tks_granite_c", "tks_paint",
          "tks_kerb", "tks_hedge")   # what lies on the ground: the landmark model's at every distance


def meshes(level="far"):
    """(materials, meshes, hidden solids, trees, props). level "far": the landmark model, what reads from across
    the plaza and the map (the game hides the building's part of it while the hero level is shown, and the
    viewer draws it); "hero": everything, with bevels and occlusion marks, for cities/tokyo/hero.py."""
    global HERO
    HERO = level == "hero"
    FLOODS.clear()
    BENCHES.clear()
    lit = ("tks_brick", "tks_stone", "tks_stone_fine", "tks_copper", "tks_glass", "tks_glass_dark", "tks_glass_small", "tks_pent", "tks_clock", "tks_door", "tks_sign")
    K = ak.Kit("tks", floodlit=lit,
               uv=("tks_glass", "tks_glass_dark", "tks_brick", "tks_stone", "tks_stone_fine", "tks_slate", "tks_reveal", "tks_pavers", "tks_kerb", "tks_lawn", "tks_pent",
                   "tks_granite_a", "tks_granite_b", "tks_granite_c", "tks_hedge", "tks_groundcover", "tks_sign"))
    # the round things, smooth: the domes' slate, the turrets' stone, the copper of lanterns and hoods
    S = {"slate": Mesh("tks_dome_slate", "tks_slate", True, uv=True), "stone": Mesh("tks_round_stone", "tks_stone", True, floodlit=True, uv=True),
         "copper": Mesh("tks_round_copper", "tks_copper", True, floodlit=True)}
    g, hidden, octs, axis = building(K, S)
    trees, props, hid2 = plaza(K, g, octs, axis)
    hidden = hidden + hid2
    mats = _mats()
    for k in ("tks_brick", "tks_stone", "tks_copper"):
        mats[k]["flood"] = [round(g, 1), round(g + 24.0, 1), 0.5, 0.45, BAY]  # (a fitting at the foot of every bay)
    for k in mats:
        if mats[k].get("pbr", {}).get("grime_m"):
            mats[k]["pbr"]["grime_z"] = round(g, 1)
    mats["tks_stone_fine"] = dict(mats["tks_stone"])
    mats["tks_iron_fine"] = dict(mats["tks_iron"])
    for k in ("tks_pavers", "tks_kerb", "tks_lawn", "tks_hedge", "tks_groundcover"):
        mats[k]["surface"] = None   # its own PBR set (web/pbr.js), not the shared ground surfaces (web/surface.js)
    out = K.out() + [m for m in S.values() if m.i]
    for m in out:
        if m.mat in ("tks_sash", "tks_kerb", "tks_stone_fine", "tks_iron_fine"):
            m.detail = True
    if not HERO:   # the landmark model goes without the parts only the streamed level's fine model shows
        out = [m for m in out if m.mat not in ("tks_sash", "tks_stone_fine", "tks_iron_fine")]
    HERO = False
    return mats, out, hidden, trees, props
