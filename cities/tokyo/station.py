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
import math

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
    "tks_brick": {"color": "#7e3828", "roughness": 0.86, "metalness": 0.0, "pbr": {"set": "brick", "tile_m": [1.4, 1.4], "grime_m": 1.6, "vary": 0.2},
                  "emissive": "#c4573a", "glow": 0.3},
    "tks_stone": {"color": "#c2b7a3", "roughness": 0.78, "metalness": 0.0, "pbr": {"set": "stucco", "tile_m": [2.0, 2.0], "vary": 0.08, "grime_m": 1.2},
                  "emissive": FLOOD, "glow": 0.3},
    "tks_slate": {"color": "#3b4045", "roughness": 0.62, "metalness": 0.0, "pbr": {"set": "slate", "tile_m": [2.6, 2.6], "normal": 1.2},
                  "emissive": "#ffd9b0", "glow": 0.05},
    "tks_copper": {"color": "#55625a", "roughness": 0.5, "metalness": 0.45, "emissive": FLOOD, "glow": 0.14},
    "tks_sash": {"color": "#ece7dc", "roughness": 0.55, "metalness": 0.0},
    "tks_glass": {"color": "#1f262c", "roughness": 0.08, "metalness": 0.6, "emissive": "#ffd29a", "glow": 0.62},
    "tks_glass_dark": {"color": "#1c2228", "roughness": 0.08, "metalness": 0.6, "emissive": "#ffe6c4", "glow": 0.07},
    "tks_reveal": {"color": "#6f3426", "roughness": 0.9, "metalness": 0.0, "pbr": {"set": "brick", "tile_m": [1.4, 1.4], "vary": 0.05}},
    "tks_paving": {"color": "#9d988e", "roughness": 0.55, "metalness": 0.0, "pbr": {"set": "granite_paving", "tile_m": [2.4, 2.4], "vary": 0.06},
                   "decal": True, "street_lit": True},
    "tks_kerb": {"color": "#a9a59c", "roughness": 0.7, "metalness": 0.0, "pbr": {"set": "granite_paving", "tile_m": [1.2, 1.2]}, "street_lit": True},
    "tks_lawn": {"color": "#6c7442", "roughness": 0.95, "metalness": 0.0, "pbr": {"set": "lawn", "tile_m": [2.0, 2.0], "vary": 0.25}, "decal": True, "street_lit": True},
    "tks_iron": {"color": "#23272a", "roughness": 0.45, "metalness": 0.6},
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


# ---------------------------------------------------------------- the wings

def facade(K, ring, g, top, skip, centre_band=None):
    """Walls round a CCW ring (world) from the ground g up to g + top: three storeys of openings, the stone
    courses, quoins and the cornice. skip(a, b): an edge to leave out (inside a taller pavilion)."""
    brick, stone, sash, glass, rev = K["tks_brick"], K["tks_stone"], K["tks_sash"], K["tks_glass"], K["tks_reveal"]
    H = top
    # storeys scaled to the wall: the ground floor tallest, the cornice at the top
    k = H / EAVES
    floors = [(1.9 * k, 5.1 * k, True), (7.0 * k, 10.4 * k, False), (12.2 * k, 14.9 * k, False)]
    edges = []
    s0 = 0.0
    n = len(ring)
    for i in range(n):
        a, b = np.asarray(ring[i], float), np.asarray(ring[(i + 1) % n], float)
        L = float(np.linalg.norm(b - a))
        if L < 0.5 or skip(a, b):
            s0 += L
            continue
        t = (b - a) / L
        nrm = np.array([t[1], -t[0]])
        nb = int((L - 1.6) // BAY) if L > 4.5 else 0
        holes = []
        if nb:
            off = (L - nb * BAY) / 2 + BAY / 2
            for j in range(nb):
                c = off + j * BAY
                for zb, zt, arch in floors:
                    holes.append((c, 1.55, g + zb, g + zt, False))
        outl = ak.holed_wall(brick, ak.WORLD, a, b, g, g + H, holes, s0=s0)
        for (c, w, zb, zt, _), o in zip(holes, outl):
            ak.reveal(rev, ak.WORLD, a, b, o, 0.0, -0.45)
            # after dark the hotel's and the offices' rooms are lit, not all of them
            lit = (math.sin(c * 12.9898 + zb * 78.233 + s0 * 3.1) * 43758.5453) % 1.0 < 0.62
            ak.pane(glass if lit else K["tks_glass_dark"], ak.WORLD, a, b, o, -0.38)
            p = a + t * c
            # the sash: a frame round the glass, a mullion and a transom
            for (dz0, dz1, ww) in ((zb, zb + 0.08, w), (zt - 0.08, zt, w)):
                box(sash, p - nrm * 0.42, t, nrm, dz0, dz1, ww, 0.06)
            for sx in (-w / 2 + 0.04, 0.0, w / 2 - 0.04):
                box(sash, p + t * sx - nrm * 0.42, t, nrm, zb, zt, 0.08 if sx else 0.06, 0.06)
            zm = zb + (zt - zb) * 0.68
            box(sash, p - nrm * 0.42, t, nrm, zm, zm + 0.07, w, 0.06)
            # stone: a sill under it, a lintel over it with its keystone
            box(stone, p, t, nrm, zb - 0.16, zb, w + 0.3, 0.12)
            box(stone, p, t, nrm, zt, zt + 0.38, w + 0.36, 0.06)
            box(stone, p, t, nrm, zt - 0.1, zt + 0.5, 0.34, 0.11)
        edges.append((a, b))
        s0 += L
    # courses round the whole ring (the plinth, the sill lines, the imposts), and the cornice
    if edges:
        sweep(stone, ring, g, ((0.0, 0.0), (0.22, 0.0), (0.22, 1.0), (0.12, 1.12), (0.0, 1.12)))
        for z, h in ((1.75 * k, 0.16), (6.1 * k, 0.42), (6.85 * k, 0.16), (11.5 * k, 0.32), (12.05 * k, 0.16), (3.2 * k, 0.22)):
            sweep(stone, ring, g + z, ((0.0, 0.0), (0.09, 0.0), (0.09, h), (0.0, h)))
        zc = g + H - 1.5
        sweep(stone, ring, zc, ((0.0, 0.0), (0.1, 0.12), (0.18, 0.5), (0.34, 0.62), (0.34, 0.8), (0.55, 1.02), (0.7, 1.3), (0.7, 1.5), (0.0, 1.5)))
        # quoins: stone blocks up each corner, long and short in turn
        for i in range(n):
            p = np.asarray(ring[i], float)
            a, b = np.asarray(ring[i - 1], float), np.asarray(ring[(i + 1) % n], float)
            if skip(a, p) and skip(p, b):
                continue
            if np.linalg.norm(p - a) < 6.0 or np.linalg.norm(b - p) < 6.0:
                continue   # quoins at the pavilions' and wings' corners, not at every jog of the outline
            for tdir in ((p - a), (b - p)):
                Lt = np.linalg.norm(tdir)
                if Lt < 2.0:
                    continue
                tt = tdir / Lt
                nn = np.array([tt[1], -tt[0]])
                sgn = 1.0 if tdir is not None and np.allclose(tdir, p - a) else -1.0
                z = g + 1.12
                j = 0
                while z + 0.55 < g + H - 1.5:
                    w = 1.1 if j % 2 == 0 else 0.7
                    box(stone, p - sgn * tt * w / 2, tt, nn, z, z + 0.5, w, 0.04)
                    z += 0.62
                    j += 1


def dormers(K, ring, z_eave, pitch, skip):
    """Dormers on the roof's slopes every other bay: a gabled box standing out of the slate, its window lit."""
    slate, stone, glass, cop = K["tks_slate"], K["tks_stone"], K["tks_glass"], K["tks_copper"]
    n = len(ring)
    for i in range(n):
        a, b = np.asarray(ring[i], float), np.asarray(ring[(i + 1) % n], float)
        L = float(np.linalg.norm(b - a))
        if L < 12 or skip(a, b):
            continue
        t = (b - a) / L
        nrm = np.array([t[1], -t[0]])
        nb = int((L - 6) // (BAY * 2))
        off = (L - nb * BAY * 2) / 2 + BAY
        for j in range(nb):
            c = a + t * (off + j * BAY * 2) - nrm * 1.2   # its face 1.2 m in from the eaves
            w, h = 1.5, 2.0
            box(stone, c, t, -nrm, z_eave + pitch * 0.4, z_eave + pitch * 0.4 + h, w, 2.6)
            zg = z_eave + pitch * 0.4 + h
            # the pediment and its little roof
            A, B = c - t * (w / 2 + 0.15), c + t * (w / 2 + 0.15)
            apex = (*c, zg + 0.75)
            stone.tri((*A, zg), (*B, zg), apex, [[0, 0], [w, 0], [w / 2, 0.75]])
            back = c - nrm * 2.6
            for S, E in ((A, B),):
                slate.quad((*A, zg), apex, (*back, zg + 0.75), (*(back - t * (w / 2 + 0.15)), zg), [[0, 0], [1.5, 0], [1.5, 2.6], [0, 2.6]])
                slate.quad(apex, (*B, zg), (*(back + t * (w / 2 + 0.15)), zg), (*back, zg + 0.75), [[0, 0], [1.5, 0], [1.5, 2.6], [0, 2.6]])
            q = [(c - t * 0.5 + nrm * 0.02), (c + t * 0.5 + nrm * 0.02)]
            z0 = z_eave + pitch * 0.4 + 0.35
            glass.quad((*q[0], z0), (*q[1], z0), (*q[1], z0 + 1.35), (*q[0], z0 + 1.35))
            box(cop, c, t, nrm, zg + 0.72, zg + 0.82, 0.12, 0.12)


# ---------------------------------------------------------------- the domes

def octagon(c, R, phase):
    return [(c[0] + R * math.cos(phase + k * math.pi / 4), c[1] + R * math.sin(phase + k * math.pi / 4)) for k in range(8)]


def dome_pavilion(K, c, R, phase, g):
    """An octagonal pavilion to 25 m, then the dome to DOME_TOP, its lantern and finial."""
    brick, stone, slate, cop, glass = K["tks_brick"], K["tks_stone"], K["tks_slate"], K["tks_copper"], K["tks_glass"]
    ring = octagon(c, R, phase)
    zp = EAVES + 6.2
    facade(K, ring, g, EAVES, lambda a, b: False)
    # the attic over the cornice: brick, round windows, a second cornice
    for i in range(8):
        a, b = np.asarray(ring[i], float), np.asarray(ring[(i + 1) % 8], float)
        L = float(np.linalg.norm(b - a))
        t = (b - a) / L
        nrm = np.array([t[1], -t[0]])
        mid = (a + b) / 2
        hole = [(L / 2, 2.0, g + EAVES + 1.6, g + EAVES + 3.6, False)]
        outl = ak.holed_wall(brick, ak.WORLD, a, b, g + EAVES, g + zp - 1.0, hole)
        ak.reveal(K["tks_reveal"], ak.WORLD, a, b, outl[0], 0.0, -0.4)
        ak.pane(glass, ak.WORLD, a, b, outl[0], -0.35)
        box(stone, mid, t, nrm, g + EAVES + 3.6, g + EAVES + 4.0, 2.6, 0.08)
        box(stone, mid, t, nrm, g + EAVES + 1.4, g + EAVES + 1.6, 2.6, 0.12)
    sweep(stone, ring, g + zp - 1.0, ((0.0, 0.0), (0.15, 0.2), (0.45, 0.5), (0.6, 0.75), (0.6, 1.0), (0.0, 1.0)))
    # the dome: an octagonal bell, swelling out over its foot and drawn in to the lantern
    prof = []
    for j in range(15):
        s = j / 14
        r = R * (0.93 - 0.06 * math.sin(s * math.pi * 0.9)) * (1 - s) ** 0.62 + 1.9 * s
        prof.append((r, g + zp + (DOME_TOP - 2.2 - zp) * (1 - (1 - s) ** 1.6)))
    rings = [octagon(c, r / math.cos(math.pi / 8) * math.cos(math.pi / 8), phase) for r, _ in prof]
    vlen = [0.0]
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        vlen.append(vlen[-1] + math.hypot(r1 - r0, z1 - z0))
    for j in range(len(prof) - 1):
        for k in range(8):
            k1 = (k + 1) % 8
            w0 = math.dist(rings[j][k], rings[j][k1])
            w1 = math.dist(rings[j + 1][k], rings[j + 1][k1])
            slate.quad((*rings[j][k], prof[j][1]), (*rings[j][k1], prof[j][1]), (*rings[j + 1][k1], prof[j + 1][1]), (*rings[j + 1][k], prof[j + 1][1]),
                       [[0, vlen[j]], [w0, vlen[j]], [(w0 + w1) / 2 + (w1 - w0) / 2, vlen[j + 1]], [(w0 - w1) / 2, vlen[j + 1]]])
    # copper ribs up the eight hips, and a band at the foot
    for k in range(8):
        pts = [(rings[j][k][0], rings[j][k][1], prof[j][1]) for j in range(len(prof))]
        for p0, p1 in zip(pts, pts[1:]):
            cop.box(p0, p1, 0.32, 0.32)
    sweep(cop, ring, g + zp, ((0.0, -0.05), (0.25, 0.0), (0.25, 0.25), (0.0, 0.3)))
    # oculi: a dormer on each face, low on the dome
    for k in range(8):
        j = 3
        p = (np.asarray(rings[j][k]) + np.asarray(rings[j][(k + 1) % 8])) / 2
        out = p - np.asarray(c)
        out /= np.linalg.norm(out)
        t = np.array([-out[1], out[0]])
        z = prof[j][1]
        box(stone, p - out * 0.4, t, out, z - 0.4, z + 1.5, 1.4, 1.0)
        glass.quad((*(p + out * 0.62 - t * 0.45), z - 0.1), (*(p + out * 0.62 + t * 0.45), z - 0.1), (*(p + out * 0.62 + t * 0.45), z + 1.0), (*(p + out * 0.62 - t * 0.45), z + 1.0))
        box(cop, p - out * 0.4, t, out, z + 1.5, z + 1.75, 1.6, 1.1)
    # the lantern, its cap and the finial
    z0 = prof[-1][1]
    lr = octagon(c, 1.9, phase)
    for i in range(8):
        a, b = lr[i], lr[(i + 1) % 8]
        cop.quad((*a, z0), (*b, z0), (*b, z0 + 1.6), (*a, z0 + 1.6))
    zc = z0 + 1.6
    for i in range(8):
        a, b = lr[i], lr[(i + 1) % 8]
        cop.quad((*a, zc), (*b, zc), (c[0], c[1], zc + 1.4), (c[0], c[1], zc + 1.4))
    cop.box((c[0], c[1], zc + 1.2), (c[0], c[1], zc + 4.6), 0.16, 0.16)
    cop.box((c[0], c[1], zc + 2.3), (c[0], c[1], zc + 2.7), 0.5, 0.5)
    return ring


# ---------------------------------------------------------------- the building

def building(K):
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
    oct_polys = [Polygon(octagon(c, R, ph)) for c, R, ph in octs]
    union = lambda ss: shapely.union_all([Polygon(s["ring"]).buffer(0) for s in ss]).buffer(0.05).buffer(-0.05)
    inside = lambda a, b: any(op.buffer(0.4).contains(shapely.geometry.Point((a + b) / 2)) for op in oct_polys)
    # the wings, and the corner blocks round each dome a storey higher (PLATEAU: 28 m against the wings' 22)
    tall = union(pav)
    for op in oct_polys:
        tall = tall.difference(op.buffer(-0.3))
    low = union(wings).difference(tall.buffer(-0.3))
    for op in oct_polys:
        low = low.difference(op.buffer(-0.3))
    in_tall = lambda a, b: inside(a, b) or tall.buffer(0.4).contains(shapely.geometry.Point((a + b) / 2))
    rings = []
    for body, top, skip, rise in ((low, EAVES, in_tall, 5.2), (tall, EAVES + 3.4, inside, 28.0 - 3.3 - EAVES - 3.4)):
        for p in list(getattr(body, "geoms", [body])):
            if p.area < 30:
                continue
            r = ccw(ak.simplify(list(p.exterior.coords), 0.6))
            rings.append(r)
            facade(K, r, g, top, skip)
            ak.outline_roof(K["tks_slate"], r, g + top, 1.25, over=0.55, rise_max=rise, cell=1.5)
            dormers(K, r, g + top, 1.25, skip)
    body = union(wings + pav)
    for c, R, ph in octs:
        dome_pavilion(K, c, R, ph, g)
    # the central pavilion: the imperial entrance's front, raised to CENTRE_TOP under its own steep roof
    axis = None
    if len(octs) == 2:
        (c0, *_), (c1, *_) = octs
        axis = np.asarray(c1) - np.asarray(c0)
        axis /= np.linalg.norm(axis)
    if porch and axis is not None:
        pc = np.asarray(ak.ring_centroid(porch[0]["ring"]))
        out = np.array([-axis[1], axis[0]])
        mid = np.asarray(body.centroid.coords[0])
        if np.dot(pc - mid, out) < 0:
            out = -out
        # the pavilion's front on the wings' face, 30 m along it and 24 m deep
        face = np.dot(pc - mid, out) - 2.0
        base = mid + out * (face - np.dot(pc - mid, out) + np.dot(pc - mid, out)) * 0 + out * 0
        cpt = pc - out * 4.0
        rr = [tuple(cpt + axis * u + out * v) for u, v in ((-15, -22), (15, -22), (15, 2.5), (-15, 2.5))]
        rr = ccw(rr)
        facade(K, rr, g, EAVES + 3.0, lambda a, b: False)
        ak.outline_roof(K["tks_slate"], rr, g + EAVES + 3.0, 1.6, over=0.6, rise_max=CENTRE_TOP - EAVES - 3.0, cell=1.0)
        dormers(K, rr, g + EAVES + 3.0, 1.6, lambda a, b: False)
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

def plaza(K, g, octs, axis):
    """Granite from the facade out to the street, two lawns, kerbs; trees, lamps and bollards as props."""
    if axis is None:
        return [], []
    T = ak.Terrain("tokyo")
    (c0, R0, _), (c1, R1, _) = octs
    centre = (np.asarray(c0) + np.asarray(c1)) / 2
    out = np.array([-axis[1], axis[0]])
    # the plaza is on the west (the Palace's) side
    if out[0] > 0:
        out = -out
    face = R0 * 0.85
    P = lambda u, v: centre + axis * u + out * v
    pave, lawn, kerb = K["tks_paving"], K["tks_lawn"], K["tks_kerb"]

    def slab(m, u0, u1, v0, v1, lift, cell=3.0):
        nu, nv = max(1, int((u1 - u0) / cell)), max(1, int((v1 - v0) / cell))
        pts = [[None] * (nu + 1) for _ in range(nv + 1)]
        uvs = [[None] * (nu + 1) for _ in range(nv + 1)]
        for j in range(nv + 1):
            for i in range(nu + 1):
                u, v = u0 + (u1 - u0) * i / nu, v0 + (v1 - v0) * j / nv
                x, y = P(u, v)
                pts[j][i] = (float(x), float(y), _ground(T, x, y, g) + lift)
                uvs[j][i] = [u, v]
        for j in range(nv):
            for i in range(nu):
                m.quad(pts[j][i], pts[j][i + 1], pts[j + 1][i + 1], pts[j + 1][i], [uvs[j][i], uvs[j][i + 1], uvs[j + 1][i + 1], uvs[j + 1][i]])

    U, V = 52.0, 112.0
    slab(pave, -U, U, face - 6, V, 0.04)               # the pedestrian plaza in front of the central entrance
    slab(pave, -140, 140, face - 6, face + 8, 0.035)      # the footway along the whole front
    lawns = [(-40, -13, 26, 98), (13, 40, 26, 98)]
    for u0, u1, v0, v1 in lawns:
        slab(lawn, u0, u1, v0, v1, 0.07, cell=3.0)
        # granite kerbs round each lawn
        for (a0, a1, b0, b1) in ((u0, u1, v0 - 0.3, v0), (u0, u1, v1, v1 + 0.3), (u0 - 0.3, u0, v0 - 0.3, v1 + 0.3), (u1, u1 + 0.3, v0 - 0.3, v1 + 0.3)):
            c = P((a0 + a1) / 2, (b0 + b1) / 2)
            z = _ground(T, c[0], c[1], g)
            q = [tuple(P(a0, b0)), tuple(P(a1, b0)), tuple(P(a1, b1)), tuple(P(a0, b1))]
            ak.prism(kerb, ak.WORLD, ccw(q), z, z + 0.16)
    # props: the zelkova rows (trees), the three-lamp posts and the bollards
    trees, lamps, bollards = [], [], []
    for side in (-1, 1):
        for v in np.arange(16, V, 8.0):
            x, y = P(side * 46.5, v)
            trees.append([int(round(x * 10)), int(round(y * 10)), int(round(_ground(T, x, y, g) * 10)), 125])
        for v in np.arange(20, V, 16.0):
            x, y = P(side * 49.0, v)
            lamps.append([round(float(x), 2), round(float(y), 2), round(_ground(T, x, y, g) + 0.04, 2), 0.0])
    head = math.atan2(axis[1], axis[0])
    for u in np.arange(-U + 1, U, 2.2):
        if abs(u) < 8:
            continue
        x, y = P(u, V - 0.6)
        bollards.append([round(float(x), 2), round(float(y), 2), round(_ground(T, x, y, g) + 0.04, 2), round(head, 3)])
    props = [{"name": "tks_lamp3", "far": 260, "parts": lamp3_parts(), "at": lamps},
             {"name": "tks_bollard", "far": 120, "parts": bollard_parts(), "at": bollards}]
    return trees, props


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
    m = Mesh("tks_bollard", "tks_iron", False)
    m.box((0, 0, 0), (0, 0, 0.85), 0.16, 0.16)
    m.box((0, 0, 0.85), (0, 0, 0.92), 0.2, 0.2)
    return [_dump(m)]


def _dump(m):
    d = m.dump()
    return d


# ---------------------------------------------------------------- entry

def meshes():
    """(materials, meshes, hidden solids, trees, props)"""
    K = ak.Kit("tks", floodlit=("tks_brick", "tks_stone", "tks_slate", "tks_copper", "tks_glass", "tks_glass_dark"),
               uv=("tks_brick", "tks_stone", "tks_slate", "tks_reveal", "tks_paving", "tks_kerb", "tks_lawn"))
    g, hidden, octs, axis = building(K)
    trees, props = plaza(K, g, octs, axis)
    mats = _mats()
    for k in ("tks_brick", "tks_stone", "tks_copper"):
        mats[k]["flood"] = [round(g, 1), round(g + DOME_TOP, 1), 0.5, 0.55]
    for k in mats:
        if mats[k].get("pbr", {}).get("grime_m"):
            mats[k]["pbr"]["grime_z"] = round(g, 1)
    out = K.out()
    for m in out:
        if m.mat in ("tks_sash", "tks_reveal", "tks_kerb"):
            m.detail = True
    return mats, out, hidden, trees, props
