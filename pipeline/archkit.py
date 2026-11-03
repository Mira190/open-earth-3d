"""Architectural parts for landmark meshes (cities/<id>/city.py), on top of meshkit.

meshkit has the primitives (box, lathe, sweep, grid); this module has what buildings are made
of, at real dimensions, so that a palace, a church or a temple hall reads as built from street
level: walls with their courses (the ashlar pattern's UVs, metres along and up), cornices and
string courses, columns and pilasters, arched and square openings recessed into the wall,
pediments, steps, balustrades, domes on drums with their ribs and lanterns; and for Japan,
hipped-and-gabled (irimoya) roofs with curved eaves, rows of pillars, bracket bands and the
battered stone walls (ishigaki) castles stand on.

Everything works in a building frame: Frame(cx, cy, axis_deg, ground) gives P(u, v, z), with u
along the building's axis, v across it and z up from its ground, in metres.
"""
import math

import numpy as np

from meshkit import Mesh


class Frame:
    def __init__(self, cx, cy, axis_deg, ground):
        self.cx, self.cy, self.g = float(cx), float(cy), float(ground)
        a = math.radians(axis_deg)
        self.ca, self.sa = math.cos(a), math.sin(a)

    def __call__(self, u, v, z):
        return (self.cx + self.ca * u - self.sa * v, self.cy + self.sa * u + self.ca * v, self.g + z)

    def local(self, x, y):
        dx, dy = x - self.cx, y - self.cy
        return (self.ca * dx + self.sa * dy, -self.sa * dx + self.ca * dy)


class Kit:
    """A set of meshes by material, each made once (one draw call per material)."""

    def __init__(self, prefix, floodlit=None, uv=None):
        self.prefix, self.meshes = prefix, {}
        self.floodlit, self.uv = set(floodlit or ()), set(uv or ())

    def __getitem__(self, mat):
        if mat not in self.meshes:
            self.meshes[mat] = Mesh(f"{self.prefix}_{mat}", mat, False, floodlit=mat in self.floodlit, uv=mat in self.uv)
        return self.meshes[mat]

    def out(self):
        return [m for m in self.meshes.values() if m.i]


# ---------------------------------------------------------------- walls and solids

def wall(m, P, u0, v0, u1, v1, z0, z1, s0=0.0):
    """A vertical quad from (u0, v0) to (u1, v1), z0 to z1; UVs metres along (from s0) and up."""
    L = math.hypot(u1 - u0, v1 - v0)
    m.quad(P(u0, v0, z0), P(u1, v1, z0), P(u1, v1, z1), P(u0, v0, z1), [[s0, z0], [s0 + L, z0], [s0 + L, z1], [s0, z1]])
    return L


def block(m, P, u0, u1, v0, v1, z0, z1, top=True, bottom=False):
    """An axis-aligned box in the frame: four walls (ashlar UVs) and its top."""
    s = 0.0
    for a, b in (((u0, v0), (u1, v0)), ((u1, v0), (u1, v1)), ((u1, v1), (u0, v1)), ((u0, v1), (u0, v0))):
        s += wall(m, P, a[0], a[1], b[0], b[1], z0, z1, s)
    if top:
        m.quad(P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1), [[u0, v0], [u1, v0], [u1, v1], [u0, v1]])
    if bottom:
        m.quad(P(u0, v1, z0), P(u1, v1, z0), P(u1, v0, z0), P(u0, v0, z0))


def prism(m, P, ring, z0, z1, top=True):
    """A vertical extrusion of a closed ring [(u, v)] (either winding)."""
    s = 0.0
    n = len(ring)
    for k in range(n):
        a, b = ring[k], ring[(k + 1) % n]
        s += wall(m, P, a[0], a[1], b[0], b[1], z0, z1, s)
    if top:
        cap(m, P, ring, z1)


def cap(m, P, ring, z, down=False):
    """A flat polygon at height z (ear-clipped, so concave rings work)."""
    pts = [tuple(p) for p in ring]
    if len(pts) > 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    if area < 0:
        pts = pts[::-1]
    for a, b, c in ear_clip(pts):
        if down:
            m.tri(P(*c, z), P(*b, z), P(*a, z), [list(c), list(b), list(a)])
        else:
            m.tri(P(*a, z), P(*b, z), P(*c, z), [list(a), list(b), list(c)])


def ear_clip(pts):
    """Triangles of a simple counter-clockwise polygon."""
    idx = list(range(len(pts)))
    out, guard = [], 0
    def inside(p, a, b, c):
        d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1])
        d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1])
        d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])
        return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))
    while len(idx) > 3 and guard < 10000:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = pts[i0], pts[i1], pts[i2]
            if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-9:
                continue
            if any(inside(pts[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            out.append((a, b, c))
            idx.pop(k)
            break
        else:
            break
    if len(idx) == 3:
        out.append(tuple(pts[i] for i in idx))
    return out


def offset_ring(ring, d):
    """The ring moved outward by d (negative: inward), corner by corner (mitred)."""
    pts = [np.asarray(p, float) for p in ring]
    n = len(pts)
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    sgn = 1.0 if area > 0 else -1.0  # outward normal of a CCW edge is (dy, -dx)
    out = []
    for i in range(n):
        a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
        e1, e2 = b - a, c - b
        n1 = sgn * np.array([e1[1], -e1[0]]) / (np.linalg.norm(e1) or 1)
        n2 = sgn * np.array([e2[1], -e2[0]]) / (np.linalg.norm(e2) or 1)
        bis = n1 + n2
        bl = np.linalg.norm(bis)
        if bl < 1e-6:
            out.append(tuple(b + n1 * d))
            continue
        bis /= bl
        k = min(3.0, 1.0 / max(0.3, float(np.dot(bis, n1))))
        out.append(tuple(b + bis * d * k))
    return out


def cornice(m, P, ring, z, profile=((0.0, 0.0), (0.25, 0.25), (0.6, 0.55), (0.9, 0.85), (0.9, 1.0), (0.0, 1.0))):
    """A moulding round a closed ring at height z: profile [(projection, height)] from the wall
    face out and up, swept round the ring (mitred corners)."""
    rings = [[(*q, z + h) for q in offset_ring(ring, d)] for d, h in profile]
    n = len(ring)
    for r0, r1 in zip(rings[:-1], rings[1:]):
        for k in range(n):
            a0, b0, a1, b1 = r0[k], r0[(k + 1) % n], r1[k], r1[(k + 1) % n]
            m.quad(P(*a0), P(*b0), P(*b1), P(*a1))


def band(m, P, ring, z, out=0.15, h=0.4):
    """A plain string course round a ring."""
    cornice(m, P, ring, z, ((0.0, 0.0), (out, 0.0), (out, h), (0.0, h)))


def rect(u0, u1, v0, v1):
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


# ---------------------------------------------------------------- openings

def opening(m, P, a, b, z0, w, h, arch=False, depth=0.05, centre=None):
    """A window or door on the wall from a to b (2D, in the frame), its centre at fraction
    `centre` along it (or the given distance), sill at z0, w wide, h high (to the arch's crown);
    drawn as a dark panel just in front of the wall, its top a semicircle when arch."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    t = (b - a) / np.linalg.norm(b - a)
    nrm = np.array([t[1], -t[0]])  # to the right of a->b: walls are given with the outside on the right
    c = a + t * centre
    Q = lambda s, z: P(*(c + t * s + nrm * depth), z)
    rise = w / 2 if arch else 0.0
    zs = z0 + h - rise
    m.quad(Q(-w / 2, z0), Q(w / 2, z0), Q(w / 2, zs), Q(-w / 2, zs))
    if arch:
        k = 8
        for j in range(k):
            a0, a1 = math.pi * j / k, math.pi * (j + 1) / k
            m.tri(Q(0, zs), Q(w / 2 * math.cos(a0), zs + rise * math.sin(a0)), Q(w / 2 * math.cos(a1), zs + rise * math.sin(a1)))


def openings_along(m, P, a, b, z0, w, h, every, arch=False, margin=None, depth=0.05):
    """Openings evenly spaced along a wall a->b (outside on the right)."""
    L = math.dist(a, b)
    margin = every / 2 if margin is None else margin
    n = max(0, int((L - 2 * margin) // every) + 1)
    if n <= 0:
        return
    span = (n - 1) * every
    s0 = (L - span) / 2
    for k in range(n):
        opening(m, P, a, b, z0, w, h, arch, depth, centre=s0 + k * every)


def ring_openings(m, P, ring, z0, w, h, every, arch=False, margin=None, min_len=0.0):
    """Openings along every edge of a ring, on its outside: the ring is run anticlockwise, so that the
    outside is on the right of each edge, where opening() puts its panel (clockwise, they were drawn
    5 cm inside the wall, facing in, and never seen)."""
    pts = list(ring)
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    if area < 0:
        pts = pts[::-1]
    for k in range(len(pts)):
        a, b = pts[k], pts[(k + 1) % len(pts)]
        if math.dist(a, b) >= max(min_len, w + 0.5):
            openings_along(m, P, a, b, z0, w, h, every, arch, margin)


def frame_quad(m, P, a, b, centre, z0, w, h, t=0.25, depth=0.12):
    """A raised surround round an opening (pale stone in a dark recess's place)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    tv = (b - a) / np.linalg.norm(b - a)
    nrm = np.array([tv[1], -tv[0]])
    c = a + tv * centre
    Q = lambda s, d, z: P(*(c + tv * s + nrm * d), z)
    for s0, s1, za, zb in ((-w / 2 - t, -w / 2, z0 - t, z0 + h), (w / 2, w / 2 + t, z0 - t, z0 + h), (-w / 2 - t, w / 2 + t, z0 + h, z0 + h + t),
                           (-w / 2 - t, w / 2 + t, z0 - t, z0)):
        m.quad(Q(s0, depth, za), Q(s1, depth, za), Q(s1, depth, zb), Q(s0, depth, zb))


# ---------------------------------------------------------------- the orders

def column(m, x, y, z0, h, r, segs=8, capital="corinthian"):
    """A column on its base: a plinth, the torus, the shaft with its entasis, the capital and the
    abacus (in world coordinates)."""
    m.box((x, y, z0), (x, y, z0 + r * 0.5), r * 2.7, r * 2.7, up=(1, 0, 0))
    prof = [(z0 + r * 0.5, r * 1.25), (z0 + r * 0.85, r * 1.05)]
    shaft = h * (0.86 if capital == "corinthian" else 0.9)
    for t in (0.0, 0.5, 1.0):
        prof.append((z0 + r * 0.95 + (shaft - r * 0.95) * t, r * (1.0 - 0.14 * t ** 1.5)))
    zc = z0 + shaft
    if capital == "corinthian":
        prof += [(zc + (h - shaft) * 0.5, r * 1.12), (zc + (h - shaft) * 0.85, r * 1.3)]
    else:
        prof += [(zc + (h - shaft) * 0.6, r * 1.15)]
    m.lathe(prof, (x, y), segs=segs)
    m.box((x, y, z0 + h - (h - shaft) * 0.18), (x, y, z0 + h), r * 2.8, r * 2.8, up=(1, 0, 0))


def colonnade(m, P, u0, u1, v, z0, h, r, n, capital="corinthian", pairs=False):
    """n columns (or pairs) evenly from u0 to u1 along the frame's u, at v."""
    us = np.linspace(u0, u1, n) if n > 1 else [(u0 + u1) / 2]
    for u in us:
        for du in ((-r * 1.35, r * 1.35) if pairs else (0.0,)):
            x, y, z = P(u + du, v, z0)
            column(m, x, y, z, h, r, capital=capital)


def pilasters(m, P, a, b, z0, h, w, every, out=0.25, margin=None):
    """Flat pilasters along a wall a->b (outside on the right)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    L = float(np.linalg.norm(b - a))
    t = (b - a) / L
    nrm = np.array([t[1], -t[0]])
    margin = every / 2 if margin is None else margin
    n = max(1, int((L - 2 * margin) // every) + 1)
    span = (n - 1) * every
    for k in range(n):
        c = a + t * ((L - span) / 2 + k * every) + nrm * out / 2
        m.box(P(*c, z0), P(*c, z0 + h), w, out, up=(*nrm, 0.0)) if False else _upright(m, P, c, t, nrm, z0, h, w, out)


def _upright(m, P, c, t, nrm, z0, h, w, d):
    """A vertical box at c (2D), w along t and d along nrm."""
    corners = [c - t * w / 2 - nrm * d / 2, c + t * w / 2 - nrm * d / 2, c + t * w / 2 + nrm * d / 2, c - t * w / 2 + nrm * d / 2]
    for k in range(4):
        p, q = corners[k], corners[(k + 1) % 4]
        m.quad(P(*p, z0), P(*q, z0), P(*q, z0 + h), P(*p, z0 + h))
    m.quad(P(*corners[0], z0 + h), P(*corners[1], z0 + h), P(*corners[2], z0 + h), P(*corners[3], z0 + h))


def pediment(m, P, u0, u1, v0, v1, z, rise, along_u=True):
    """A triangular pediment (a gable end) over the span u0..u1 (or v0..v1), its ridge running
    across from v0 to v1: two sloping faces, two triangular ends."""
    if along_u:
        um = (u0 + u1) / 2
        a, b, r = (u0, z), (u1, z), (um, z + rise)
        for v in (v0, v1):
            m.tri(P(a[0], v, a[1]), P(b[0], v, b[1]), P(r[0], v, r[1]))
        m.quad(P(u0, v0, z), P(um, v0, z + rise), P(um, v1, z + rise), P(u0, v1, z))
        m.quad(P(um, v0, z + rise), P(u1, v0, z), P(u1, v1, z), P(um, v1, z + rise))
    else:
        vm = (v0 + v1) / 2
        for u in (u0, u1):
            m.tri(P(u, v0, z), P(u, v1, z), P(u, vm, z + rise))
        m.quad(P(u0, v0, z), P(u0, vm, z + rise), P(u1, vm, z + rise), P(u1, v0, z))
        m.quad(P(u0, vm, z + rise), P(u0, v1, z), P(u1, v1, z), P(u1, vm, z + rise))


def steps(m, P, u0, u1, v0, v1, z0, z1, n=None, rise=0.16):
    """A flight from v0 (foot, at z0) to v1 (top, at z1), across u0..u1."""
    n = n or max(1, int(round((z1 - z0) / rise)))
    for k in range(n):
        za, zb = z0 + (z1 - z0) * k / n, z0 + (z1 - z0) * (k + 1) / n
        va = v0 + (v1 - v0) * k / n
        block(m, P, u0, u1, min(va, v1), max(va, v1), z0, zb) if False else None
        m.quad(P(u0, va, za), P(u1, va, za), P(u1, va, zb), P(u0, va, zb))
        vb = v0 + (v1 - v0) * (k + 1) / n
        m.quad(P(u0, va, zb), P(u1, va, zb), P(u1, vb, zb), P(u0, vb, zb))


def balustrade(m, P, path, z, h=1.0, panel=None):
    """A balustrade along a 2D path at height z: its rail and plinth, and the balusters between them as a
    cut-out strip on `panel` (a mesh whose material has the railing pattern), or as posts every 1.5 m."""
    pts = [np.asarray(p, float) for p in path]
    for a, b in zip(pts[:-1], pts[1:]):
        m.box(P(*a, z + h - 0.12), P(*b, z + h - 0.12), 0.32, 0.24)
        m.box(P(*a, z + 0.08), P(*b, z + 0.08), 0.3, 0.16)
        if panel is None:
            L = float(np.linalg.norm(b - a))
            for s in np.arange(0.75, L, 1.5):
                q = a + (b - a) * s / L
                m.box(P(*q, z + 0.16), P(*q, z + h - 0.24), 0.3, 0.3)
    if panel is not None:
        panel.panel([P(*q, z + 0.16) for q in pts], h - 0.4)


# ---------------------------------------------------------------- domes

def dome(m, centre, z0, r, h, segs=32, rows=10, base_out=0.0):
    """A dome of radius r rising h above z0 (an ellipse in section: a stilted or a saucer dome)."""
    prof = [(z0, r + base_out)] if base_out else []
    for k in range(rows + 1):
        t = k / rows
        prof.append((z0 + h * math.sin(math.pi / 2 * t), max(0.02, r * math.cos(math.pi / 2 * t))))
    m.lathe(prof, centre, segs=segs)


def dome_ribs(m, centre, z0, r, h, n, w=0.5, d=0.3, lift=0.08, stop=0.92):
    """Ribs on a dome: n meridians from its foot to `stop` of the way up."""
    cx, cy = centre
    for j in range(n):
        a = 2 * math.pi * (j + 0.5) / n
        pts = []
        for k in range(11):
            t = stop * k / 10
            rr = r * math.cos(math.pi / 2 * t) + lift
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a), z0 + h * math.sin(math.pi / 2 * t)))
        for p, q in zip(pts[:-1], pts[1:]):
            m.box(p, q, w, d)


def drum(m, centre, z0, z1, r, segs=32):
    m.lathe([(z0, r), (z1, r)], centre, segs=segs)


def ring_columns(m, centre, z0, h, R, n, r, capital="corinthian"):
    cx, cy = centre
    for j in range(n):
        a = 2 * math.pi * (j + 0.5) / n
        column(m, cx + R * math.cos(a), cy + R * math.sin(a), z0, h, r, segs=8, capital=capital)


def ring_openings_round(m, centre, z0, R, n, w, h, arch=True, phase=0.0, depth=0.06):
    """Openings round a cylinder of radius R (facing out)."""
    cx, cy = centre
    P = lambda x, y, z: (x, y, z)
    for j in range(n):
        a = 2 * math.pi * (j + phase) / n
        c = np.array([cx + (R + depth) * math.cos(a), cy + (R + depth) * math.sin(a)])
        t = np.array([-math.sin(a), math.cos(a)])
        # a wall from c - t to c + t whose outside (right of a->b) points out: right of t is (t1, -t0) = out
        opening(m, P, c + t * 5, c - t * 5, z0, w, h, arch, depth=0.0, centre=5.0)


# ---------------------------------------------------------------- Japan

def japanese_roof(P, u_half, v_half, z_eave, z_top, over, roof, eave=None, gable=None, soffit=None, gable_frac=1.0, k=1.0,
                  lift=0.0, ridge_frac=1.0, ridge_h=1.2, ridges=True, n=None, wall_z=None, swap=None):
    """The one Japanese roof every kit builds on (archkit, japankit, Shibuya's shrines): a hipped (寄棟) or
    hipped-and-gabled (入母屋) roof over the rectangle u in +-u_half, v in +-v_half (the ridge along u),
    its eaves `over` outside the walls.

    Its height is a function of the depth in from the eaves, tau (0 at the eaves, 1 at the ridge, the same on
    the long slopes and the hips, so the hips are the lines where they meet): z = z_eave + (z_top - z_eave) *
    tau ** k, k > 1 the concave sweep, flat at the eaves and steep at the ridge; the corners lift `lift` (反り),
    fading up the slope. From tau = gable_frac up, the long slopes run on out to the gables (妻) standing over
    the end hips; gable_frac 1 is a plain hipped roof, whose ridge is ridge_frac of the hips' natural one
    (0: a pyramid, as a pagoda's storeys); gable_frac 0 is a gabled roof (切妻). Meshes: roof (the slopes), eave (fascia, barge boards, the ridge
    and the hips' ridges when `ridges`), gable (the gables' faces), soffit (the eaves' underside, back to the
    walls at wall_z). swap: run the ridge along v (by default, when v is the longer side). Returns {"zr": z at depth d m in from the long eaves (without the lift), "Ug": the
    gables' plane, "Ev", "Eu", "corners": the eave's corners, as P gives them}."""
    swap = v_half > u_half if swap is None else swap  # the ridge runs along the longer side, unless told
    Q = (lambda u, v, z: P(v, u, z)) if swap else P
    uh, vh = (v_half, u_half) if swap else (u_half, v_half)
    Eu, Ev = uh + over, vh + over
    H = z_top - z_eave
    R = max(Eu - Ev, 0.0) * (ridge_frac if gable_frac >= 1.0 else 1.0)  # the ridge's half length on a hipped roof
    tg = min(1.0, gable_frac)
    Ug = R + (Eu - R) * (1 - tg)
    n = n or (8 if Ev > 15 else 6 if Ev > 7 else 4)
    m = max(4, n)
    f = lambda t: H * max(t, 0.0) ** k

    def z(s, t):
        return z_eave + f(t) + lift * abs(s) ** 3 * (1 - t)

    def half_u(t):  # the long slopes' half length at depth t
        return R + (Eu - R) * (1 - min(t, tg))

    def long_face(sgn):
        ts = sorted(set([i / n for i in range(n + 1)] + [tg]))
        rows, uvs = [], []
        for t in ts:
            hu = half_u(t)
            rows.append([Q(s_ * hu, sgn * Ev * (1 - t), z(s_, t)) for s_ in np.linspace(-1, 1, m + 1)])
            uvs.append([[s_ * hu, t * math.hypot(H, Ev)] for s_ in np.linspace(-1, 1, m + 1)])
        roof.grid(rows, uvs)

    def end_face(sgn):
        ts = [tg * i / n for i in range(n + 1)]
        rows, uvs = [], []
        for t in ts:
            hv = Ev * (1 - t)
            rows.append([Q(sgn * half_u(t), s_ * hv, z(s_, t)) for s_ in np.linspace(-1, 1, m + 1)])
            uvs.append([[s_ * hv, t * math.hypot(H, Eu - R)] for s_ in np.linspace(-1, 1, m + 1)])
        roof.grid(rows, uvs)

    for sgn in (-1, 1):
        long_face(sgn)
        if Eu - R > 1e-6 and tg > 0:  # gable_frac 0: a gabled roof (切妻), no hips
            end_face(sgn)
    if eave is not None:  # the fascia along each eave
        for (u0, v0), (u1, v1) in (((-Eu, -Ev), (Eu, -Ev)), ((Eu, -Ev), (Eu, Ev)), ((Eu, Ev), (-Eu, Ev)), ((-Eu, Ev), (-Eu, -Ev))):
            eave.box(Q(u0, v0, z_eave + lift - 0.35), Q(u1, v1, z_eave + lift - 0.35), 0.5, 0.7) if ridges else None
    if tg < 1.0:
        # the gables: a fan from the gable's foot up to the long slopes' edge, and the barge boards on it
        kk = max(3, n // 2)
        ts = [tg + (1 - tg) * i / kk for i in range(kk + 1)]
        zg = z(1.0, tg)
        for sgn in (-1, 1):
            ug = sgn * Ug * 0.985
            for side in (-1, 1):
                edge = [(side * Ev * (1 - t), z(1.0, t)) for t in ts]
                if gable is not None:
                    for (v0, z0), (v1, z1) in zip(edge[:-1], edge[1:]):
                        gable.tri(Q(ug, 0.0, zg), Q(ug, v0, z0), Q(ug, v1, z1))
                if eave is not None:
                    for (v0, z0), (v1, z1) in zip(edge[:-1], edge[1:]):
                        eave.box(Q(sgn * (Ug + 0.15), v0, z0 + (0.1 if ridges else -0.18)), Q(sgn * (Ug + 0.15), v1, z1 + (0.1 if ridges else -0.18)), 0.35, 0.45)
            if gable is not None:
                v0 = Ev * (1 - tg)
                gable.quad(Q(ug, -v0, zg), Q(ug, v0, zg), Q(ug, v0, zg - 0.4), Q(ug, -v0, zg - 0.4))
    if ridges and eave is not None:
        # the ridge with its end tiles (鬼瓦), and the hips' ridges from the corners up
        rh = max(Ug if tg < 1.0 else R, 0.3)
        eave.box(Q(-rh - 0.3, 0, z_top), Q(rh + 0.3, 0, z_top), 1.2, ridge_h)
        for sgn in (-1, 1):
            eave.box(Q(sgn * (rh + 0.1), 0, z_top), Q(sgn * (rh + 0.1), 0, z_top + ridge_h * 1.8), 1.0, 1.4)
        hs = max(2, n // 2)
        for su in (-1, 1):
            for sv in (-1, 1):
                pts = [(su * half_u(t), sv * Ev * (1 - t), z(1.0, t)) for t in np.linspace(0, tg, hs + 1)]
                for p, q in zip(pts[:-1], pts[1:]):
                    eave.box(Q(p[0], p[1], p[2] + 0.15), Q(q[0], q[1], q[2] + 0.15), 0.6, 0.5)
    corners = [Q(su * Eu, sv * Ev, z_eave + lift) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    if soffit is not None:  # the fascia's face and the underside back to the walls
        zw = wall_z if wall_z is not None else z_eave - 0.4
        walls = [Q(su * uh, sv * vh, zw) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        dn = np.array([0, 0, -0.35])
        for i in range(4):
            j = (i + 1) % 4
            a, b = np.array(corners[i]), np.array(corners[j])
            soffit.quad(a + dn, b + dn, b, a)
            soffit.quad(a + dn, walls[i], walls[j], b + dn)
    zr = lambda d: z_eave + f(min(max(d / Ev, 0.0), 1.0))
    return {"zr": zr, "Ug": Ug, "Ev": Ev, "Eu": Eu, "corners": corners}


def outline_roof(roof, ring, z_eave, pitch, over=1.0, rise_max=None, k=1.0, holes=(), cell=1.0, soffit=None, wall_z=None):
    """A hipped roof of equal pitches over any outline (an L, a bend, a corridor round a court), in the world
    frame: the height is the distance in from the eaves (the outline `over` m out), times `pitch`, raised to
    k for the concave sweep and capped at rise_max (a flat top where the outline is wider): the straight
    skeleton's roof, its hips and valleys where the distances from two eaves meet. Triangulated on the eaves'
    outline and a `cell` m grid inside it. soffit: the eaves' underside back to the walls, at wall_z."""
    import shapely
    from shapely.geometry import MultiPoint, Point, Polygon
    foot = Polygon(ring, list(holes)).buffer(0)
    eav = foot.buffer(over, join_style="mitre", mitre_limit=2.0)
    if eav.is_empty:
        return
    edge = eav.boundary
    full = rise_max / pitch if rise_max else None  # the depth at which the roof reaches its top

    def z(x, y):
        d = float(shapely.distance(edge, Point(x, y)))
        if full is None:
            return z_eave + pitch * d
        return z_eave + rise_max * (min(d, full) / full) ** k

    dense = shapely.segmentize(eav, cell)
    pts = [c for r in [dense.exterior] + list(dense.interiors) for c in r.coords] if dense.geom_type == "Polygon" else \
        [c for g in dense.geoms for r in [g.exterior] + list(g.interiors) for c in r.coords]
    x0, y0, x1, y1 = eav.bounds
    gx, gy = np.meshgrid(np.arange(x0 + cell / 2, x1, cell), np.arange(y0 + cell / 2, y1, cell))
    inner = shapely.contains_xy(eav.buffer(-cell * 0.3), gx, gy)
    pts += list(zip(gx[inner], gy[inner]))
    tris = shapely.delaunay_triangles(MultiPoint(pts))
    for t in tris.geoms:
        c = t.centroid
        if not eav.contains(c):
            continue
        a, b, cc = list(t.exterior.coords)[:3]
        if (b[0] - a[0]) * (cc[1] - a[1]) - (b[1] - a[1]) * (cc[0] - a[0]) < 0:
            b, cc = cc, b
        roof.tri(*[(float(px), float(py), float(z(px, py))) for px, py in (a, b, cc)], [[a[0], a[1]], [b[0], b[1]], [cc[0], cc[1]]])
    if soffit is not None:  # the eaves' underside: between the eaves' outline and the walls'
        zw = wall_z if wall_z is not None else z_eave - 0.4
        under = eav.difference(foot)
        for g in getattr(under, "geoms", [under]):
            if g.geom_type != "Polygon":
                continue
            for t in shapely.constrained_delaunay_triangles(g).geoms:
                q = [(px, py, z_eave - 0.3 if not foot.buffer(0.05).contains(Point(px, py)) else zw) for px, py in list(t.exterior.coords)[:3]]
                soffit.tri(*q)


def irimoya(K, P, L, W, z_eave, rise, over=3.0, lift=0.9, mats=("roof", "eave", "gable"), gable_frac=0.45, sag=0.18, ridge_h=1.2, n=None, soffit=None):
    """A hipped-and-gabled roof (入母屋) over an L x W rectangle centred on the frame's origin (L along u), by
    japanese_roof: eaves `over` outside the walls, corners lifted `lift`, the slopes' concave sweep from
    `sag` (k = 1 + 3 sag), the gables from gable_frac of the depth up (1: a plain hipped roof, 寄棟).
    mats: names in the kit K (roof, eave and ridge, gable); soffit: a name for the eaves' underside."""
    roof, eave, gab = (K[m] for m in mats)
    return japanese_roof(P, L / 2, W / 2, z_eave, z_eave + rise, over, roof, eave, gab, K[soffit] if soffit else None,
                         gable_frac=gable_frac, k=1.0 + 3.0 * sag, lift=lift, ridge_h=ridge_h, n=n)


def hip_roof(K, P, L, W, z_eave, rise, over=2.0, lift=0.5, mat="roof", trim="eave", sag=0.12):
    """A hipped roof with curved eaves (寄棟) — irimoya without its gables."""
    return irimoya(K, P, L, W, z_eave, rise, over, lift, (mat, trim, trim), gable_frac=1.0, sag=sag, ridge_h=0.8)


def pillars(m, P, L, W, z0, h, every, r=0.28, inset=0.0):
    """Round timber pillars round an L x W rectangle (the frame's origin at its centre)."""
    for u0, v0, u1, v1 in ((-L / 2, -W / 2, L / 2, -W / 2), (L / 2, -W / 2, L / 2, W / 2), (L / 2, W / 2, -L / 2, W / 2), (-L / 2, W / 2, -L / 2, -W / 2)):
        n = max(1, int(round(math.hypot(u1 - u0, v1 - v0) / every)))
        for k in range(n):
            t = k / n
            x, y, z = P(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, z0)
            m.lathe([(z, r), (z + h, r)], (x, y), segs=8)


def ishigaki(m, P, ring, z0, z1, batter=0.25, rows=6):
    """A battered stone wall: the ring at the top, leaning out by `batter` of the height at the foot
    (with the curve of a castle wall, steeper at the top). UVs metres along and up (ashlar)."""
    H = z1 - z0
    rings = []
    for k in range(rows + 1):
        t = k / rows  # 0 at the foot
        d = batter * H * (1 - t) ** 1.6
        rings.append((offset_ring(ring, d), z0 + H * t))
    n = len(ring)
    for (r0, za), (r1, zb) in zip(rings[:-1], rings[1:]):
        s = 0.0
        for k in range(n):
            a0, b0, a1, b1 = r0[k], r0[(k + 1) % n], r1[k], r1[(k + 1) % n]
            L = math.dist(a0, b0)
            m.quad(P(*a0, za), P(*b0, za), P(*b1, zb), P(*a1, zb), [[s, za], [s + L, za], [s + L, zb], [s, zb]])
            s += L
    cap(m, P, ring, z1)


# ---------------------------------------------------------------- the built city's footprints

def load_solids(city_id):
    """The built city's solids (web/data/<city>/buildings.json), for landmarks that stand on their
    mapped footprints: [{si, osm, name, ground, base, top, ring [(x, y)], holes}] (metres)."""
    import json
    import os
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "data", city_id, "buildings.json")
    B = json.load(open(path))
    out = []
    for si, s in enumerate(B["s"]):
        b = B["b"][s[0]]
        r = s[4]
        out.append({"si": si, "osm": (b[6] or "").split("@")[0], "name": b[0] or "", "ground": s[1] / 10, "base": s[2] / 10, "top": s[3] / 10,
                    "ring": [(r[i] / 10, r[i + 1] / 10) for i in range(0, len(r), 2)],
                    "holes": [[(h[i] / 10, h[i + 1] / 10) for i in range(0, len(h), 2)] for h in s[5:]]})
    return out


def ring_area(ring):
    return 0.5 * sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))


def ring_centroid(ring):
    a = ring_area(ring) or 1e-9
    cx = sum((ring[i][0] + ring[(i + 1) % len(ring)][0]) * (ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1]) for i in range(len(ring)))
    cy = sum((ring[i][1] + ring[(i + 1) % len(ring)][1]) * (ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1]) for i in range(len(ring)))
    return cx / (6 * a), cy / (6 * a)


WORLD = lambda x, y, z: (float(x), float(y), float(z))  # a frame that is the city's own


def simplify(ring, tol=0.4):
    """Drop vertices that sit within tol of the line through their neighbours (a mapped outline's
    near-collinear points), so cornices and openings follow the walls."""
    pts = [tuple(p) for p in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for k in range(len(pts)):
            a, b, c = np.asarray(pts[k - 1]), np.asarray(pts[k]), np.asarray(pts[(k + 1) % len(pts)])
            ac = c - a
            L = np.linalg.norm(ac)
            d = abs(ac[0] * (b - a)[1] - ac[1] * (b - a)[0]) / L if L > 1e-6 else 0.0
            if d < tol or np.linalg.norm(b - a) < 0.3:
                pts.pop(k)
                changed = True
                break
    return pts


def stone_body(K, ring, z0, z1, mats, storey=None, win=None, arch=False, cornice_h=1.2, every=4.2, sill=None, top=True, base_band=True):
    """A masonry body on a mapped outline (world coordinates): walls (ashlar), a plinth, a
    cornice at the top, string courses at each storey, and windows (dark recesses that light up
    after dark) in rows. mats: (stone, trim, window)."""
    stone, trim, wmat = (K[m] for m in mats)
    ring = simplify(ring)
    prism(stone, WORLD, ring, z0, z1, top=top)
    cornice(trim, WORLD, ring, z1 - cornice_h, ((0.0, 0.0), (0.2, 0.25), (0.45, 0.6), (0.75, 0.9), (0.75, cornice_h), (0.0, cornice_h)))
    if base_band:
        band(trim, WORLD, ring, z0, out=0.3, h=1.1)
    if not storey:
        return
    H = z1 - z0 - cornice_h
    n = max(1, int(H // storey))
    for k in range(n):
        zf = z0 + k * storey
        if k:
            band(trim, WORLD, ring, zf - 0.2, out=0.12, h=0.35)
        w, h = win or (1.6, storey * 0.55)
        ring_openings(wmat, WORLD, ring, zf + (sill if sill is not None else storey * 0.22), w, h, every, arch=arch)


class Terrain:
    """The built city's bare-earth heights (web/data/<city>/terrain.json), bilinear."""

    def __init__(self, city_id):
        import base64
        import json
        import os
        root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "data", city_id)
        S = json.load(open(os.path.join(root, "scene.json")))
        T = json.load(open(os.path.join(root, "terrain.json")))
        t = S["terrain"]
        self.nx, self.ny, self.cell = t["nx"], t["ny"], t["cell"]
        self.x0, self.y1 = S["frame"]["x"][0], S["frame"]["y"][1]
        self.d = (np.frombuffer(base64.b64decode(T["data"]), dtype="<i2").astype(float) * t["scale"]).reshape(self.ny, self.nx)

    def __call__(self, x, y):
        c, r = (x - self.x0) / self.cell, (self.y1 - y) / self.cell
        c0, r0 = int(math.floor(c)), int(math.floor(r))
        fc, fr = c - c0, r - r0
        g = lambda rr, cc: self.d[min(max(rr, 0), self.ny - 1), min(max(cc, 0), self.nx - 1)]
        return float((g(r0, c0) * (1 - fc) + g(r0, c0 + 1) * fc) * (1 - fr) + (g(r0 + 1, c0) * (1 - fc) + g(r0 + 1, c0 + 1) * fc) * fr)


def oriented(ring):
    """A ring's minimum rotated rectangle: (centre x, y, axis deg along the long side, long, short)."""
    from shapely.geometry import Polygon
    mr = np.asarray(list(Polygon(ring).minimum_rotated_rectangle.exterior.coords)[:4])
    e1, e2 = mr[1] - mr[0], mr[2] - mr[1]
    long_, short = (e1, e2) if np.linalg.norm(e1) >= np.linalg.norm(e2) else (e2, e1)
    c = mr.mean(axis=0)
    return float(c[0]), float(c[1]), math.degrees(math.atan2(long_[1], long_[0])), float(np.linalg.norm(long_)), float(np.linalg.norm(short))


def hall(K, P, L, W, ridge, mats, eave_frac=0.42, over=None, base_h=1.0, mokoshi=False, bays=None, gable_frac=0.45, lift=None):
    """A Japanese temple or palace hall (the frame's origin at its centre, L along u): a stone platform,
    timber pillars and tie beams with white plaster (or shutters) between them, the bracket band under the
    eaves, and a hipped-and-gabled roof to `ridge` m; with mokoshi, a pent roof round the lower storey (as
    the great founders' halls have). mats: {"base", "post", "wall", "bracket", "roof", "ridge"}."""
    base, post, wall_m, br = K[mats["base"]], K[mats["post"]], K[mats["wall"]], K[mats["bracket"]]
    over = over if over is not None else max(1.6, 0.11 * W)
    hl, hw = L / 2 - over * 0.55, W / 2 - over * 0.55  # the walls stand in from the footprint, under the eaves
    block(base, P, -hl - 1.2, hl + 1.2, -hw - 1.2, hw + 1.2, -0.5, base_h)
    eave = base_h + (ridge - base_h) * eave_frac
    zw = eave - min(2.4, 0.18 * (eave - base_h))  # the bracket band's foot
    block(wall_m, P, -hl, hl, -hw, hw, base_h, zw, top=False)
    # pillars and the tie beams (長押) round the walls
    every = bays or (max(3.0, min(5.0, L / 8)) if L * W > 400 else 1e9)  # small halls: the beams alone
    for (u0, v0, u1, v1) in ((-hl, -hw, hl, -hw), (hl, -hw, hl, hw), (hl, hw, -hl, hw), (-hl, hw, -hl, -hw)):
        n = max(1, int(round(math.hypot(u1 - u0, v1 - v0) / every)))
        for k in range(n if every < 1e8 else 0):
            t = k / n
            u, v = u0 + (u1 - u0) * t, v0 + (v1 - v0) * t
            _upright(post, P, np.array([u, v]), np.array([1.0, 0.0]), np.array([0.0, 1.0]), base_h, zw - base_h, 0.55, 0.55)
    for z in (base_h + 0.15, base_h + (zw - base_h) * 0.62, zw - 0.25):  # the tie beams, proud of the wall
        band(post, P, rect(-hl, hl, -hw, hw), z - 0.15, out=0.22, h=0.3)
    cornice(br, P, rect(-hl, hl, -hw, hw), zw, ((0.0, 0.0), (0.3, 0.0), (0.3, 0.5), (0.8, 0.6), (0.8, 1.2), (1.4, 1.3), (1.4, eave - zw), (0.0, eave - zw)))
    if mokoshi:
        zm = base_h + (zw - base_h) * 0.5
        hip_roof(K, P, 2 * hl, 2 * hw, zm, 1.6, over=over * 0.75, lift=0.3, mat=mats["roof"], trim=mats["ridge"], sag=0.05) if False else None
        # a pent roof: four sloping skirts from the wall out, under the main eaves
        roof = K[mats["roof"]]
        o = over * 0.8
        for (a, b) in (((-hl, -hw), (hl, -hw)), ((hl, -hw), (hl, hw)), ((hl, hw), (-hl, hw)), ((-hl, hw), (-hl, -hw))):
            a, b = np.array(a), np.array(b)
            t = (b - a) / np.linalg.norm(b - a)
            n = np.array([t[1], -t[0]])
            if np.dot(n, (a + b) / 2) < 0:
                n = -n
            ao, bo = a + n * o - t * o, b + n * o + t * o
            L_ = float(np.linalg.norm(bo - ao))
            roof.quad(P(*a, zm + 1.6), P(*b, zm + 1.6), P(*bo, zm), P(*ao, zm), [[0, 1.8], [L_, 1.8], [L_, 0], [0, 0]])
            K[mats["ridge"]].box(P(*ao, zm - 0.15), P(*bo, zm - 0.15), 0.35, 0.35)
    irimoya(K, P, 2 * hl, 2 * hw, eave, ridge - eave, over=over, lift=lift if lift is not None else min(1.4, 0.035 * W + 0.3),
            mats=(mats["roof"], mats["ridge"], mats.get("gable", mats["ridge"])), gable_frac=gable_frac, sag=0.16, ridge_h=min(2.2, 0.03 * L + 0.6))


def gate(K, P, L, W, ridge, mats, storeys=2):
    """A temple gate (三門 / 二重門): two storeys under two roofs, open bays at the foot."""
    base, post = K[mats["base"]], K[mats["post"]]
    block(base, P, -L / 2, L / 2, -W / 2, W / 2, -0.3, 0.8)
    z1 = 0.8 + (ridge - 0.8) * (0.32 if storeys == 2 else 0.5)
    for u in np.linspace(-L / 2 + 1.0, L / 2 - 1.0, 6):
        for v in (-W / 2 + 1.0, 0.0, W / 2 - 1.0):
            x, y, z = P(u, v, 0.8)
            post.lathe([(z, 0.42), (z + z1 - 0.8, 0.42)], (x, y), segs=6)
    if storeys == 2:
        z2 = z1 + 1.8
        irimoya(K, P, L - 2.0, W - 2.0, z1 + 0.6, 2.2, over=2.6, lift=0.6, mats=(mats["roof"], mats["ridge"], mats["ridge"]), gable_frac=1.0, sag=0.08)
        hall(K, P, L - 1.0, W - 1.0, ridge - z2 + 0.0, mats, eave_frac=0.45, base_h=0.0, over=3.0) if False else None
        Q = lambda u, v, z: P(u, v, z + z2)
        block(K[mats["post"]], Q, -L / 2 + 2.2, L / 2 - 2.2, -W / 2 + 2.2, W / 2 - 2.2, 0.0, (ridge - z2) * 0.4, top=False)  # timber doors and windows
        balustrade(post, Q, [(-L / 2 + 1.4, -W / 2 + 1.4), (L / 2 - 1.4, -W / 2 + 1.4), (L / 2 - 1.4, W / 2 - 1.4), (-L / 2 + 1.4, W / 2 - 1.4), (-L / 2 + 1.4, -W / 2 + 1.4)], 0.0, 1.0)
        irimoya(K, Q, L - 4.4, W - 4.4, (ridge - z2) * 0.45, (ridge - z2) * 0.55, over=3.2, lift=0.9,
                mats=(mats["roof"], mats["ridge"], mats.get("gable", mats["ridge"])), gable_frac=0.45, sag=0.16)
    else:
        irimoya(K, P, L - 2.0, W - 2.0, z1, ridge - z1, over=2.0, lift=0.6, mats=(mats["roof"], mats["ridge"], mats.get("gable", mats["ridge"])))


def corridor(K, P, L, W, ridge, mats, bay=3.0):
    """A roofed corridor (回廊) along u, L x W, the frame's origin at its centre: a stone plinth, three rows of
    pillars every `bay` m (the outer rows open, the middle one in a plastered wall with a lattice window,
    連子窓, in every bay), tie beams along the rows, and a gabled roof to `ridge` (japanese_roof). mats:
    {"base", "post", "wall", "lattice", "roof", "ridge", "gable"}."""
    base, post, wall_m = K[mats["base"]], K[mats["post"]], K[mats["wall"]]
    lat = K[mats.get("lattice", mats["post"])]
    z0 = 0.45
    block(base, P, -L / 2 - 0.4, L / 2 + 0.4, -W / 2, W / 2, -0.3, z0)
    over = 1.2
    eave = z0 + (ridge - z0) * 0.62
    zb = eave - 0.5  # the tie beams' top
    n = max(1, int(round(L / bay)))
    us = np.linspace(-L / 2 + 0.3, L / 2 - 0.3, n + 1)
    rows = (-W / 2 + over, 0.0, W / 2 - over)
    for v in rows:
        for u in us:
            x, y, z = P(u, v, z0)
            post.lathe([(z, 0.17), (z + zb - z0, 0.17)], (x, y), segs=8)
        block(post, P, -L / 2 + 0.1, L / 2 - 0.1, v - 0.13, v + 0.13, zb - 0.45, zb, top=False)
        block(post, P, -L / 2 + 0.1, L / 2 - 0.1, v - 0.1, v + 0.1, z0 + 0.15, z0 + 0.4, top=False)  # the sill
    # the middle wall, white between the pillars, and the green lattice windows in it on both faces
    block(wall_m, P, -L / 2 + 0.3, L / 2 - 0.3, -0.09, 0.09, z0 + 0.4, zb - 0.45, top=False)
    for a, b in zip(us[:-1], us[1:]):
        c, w = (a + b) / 2, (b - a) * 0.62
        for sv in (-1, 1):
            vv = sv * 0.11
            lat.quad(P(c - w / 2, vv, z0 + 1.1), P(c + w / 2, vv, z0 + 1.1), P(c + w / 2, vv, zb - 0.8), P(c - w / 2, vv, zb - 0.8))
            for k in range(1, 8):  # the lattice's bars
                uu = c - w / 2 + w * k / 8
                post.box(P(uu, vv + sv * 0.03, z0 + 1.1), P(uu, vv + sv * 0.03, zb - 0.8), 0.05, 0.05)
    japanese_roof(P, L / 2, W / 2 - over, eave, ridge, over, K[mats["roof"]], K[mats["ridge"]], K[mats.get("gable", mats["ridge"])],
                  gable_frac=0.0, k=1.25, lift=0.0, ridge_h=0.6, swap=False)


def ishigaki_line(m, P, pts, z_top, z_foot, low_side, batter=0.3, coping=None):
    """A battered stone retaining wall along a polyline: vertical-ish on the high side, leaning out over the
    low side (low_side = +1 for the right of the line's direction, -1 the left), its face curving in as it
    rises (扇の勾配). UVs metres along and up for the ashlar pattern."""
    P2 = [np.asarray(p, float) for p in pts]
    H = z_top - z_foot
    s = 0.0
    for a, b in zip(P2[:-1], P2[1:]):
        L = float(np.linalg.norm(b - a))
        if L < 0.2:
            continue
        t = (b - a) / L
        n = np.array([t[1], -t[0]]) * low_side
        rows = 5
        prev = None
        for k in range(rows + 1):
            f = k / rows
            d = batter * H * (1 - f) ** 1.7
            za = z_foot + H * f
            cur = (a + n * d, b + n * d, za)
            if prev:
                m.quad(P(*prev[0], prev[2]), P(*prev[1], prev[2]), P(*cur[1], cur[2]), P(*cur[0], cur[2]),
                       [[s, prev[2]], [s + L, prev[2]], [s + L, cur[2]], [s, cur[2]]])
            prev = cur
        m.quad(P(*a, z_top), P(*b, z_top), P(*(b - n * 1.5), z_top), P(*(a - n * 1.5), z_top))
        s += L


def dobei(K, P, pts, z, h=2.4, mats=("plaster", "kawara", "kawara_ridge")):
    """A plastered earthen wall (土塀) with its little tiled roof along a polyline at height z."""
    wall_m, roof, ridge = (K[m] for m in mats)
    P2 = [np.asarray(p, float) for p in pts]
    s = 0.0
    for a, b in zip(P2[:-1], P2[1:]):
        L = float(np.linalg.norm(b - a))
        if L < 0.2:
            continue
        t = (b - a) / L
        n = np.array([t[1], -t[0]])
        for side in (-1, 1):
            wall_m.quad(P(*(a + n * side * 0.35), z), P(*(b + n * side * 0.35), z), P(*(b + n * side * 0.35), z + h), P(*(a + n * side * 0.35), z + h))
            roof.quad(P(*(a + n * side * 0.85), z + h - 0.15), P(*(b + n * side * 0.85), z + h - 0.15), P(*b, z + h + 0.45), P(*a, z + h + 0.45),
                      [[s, 0], [s + L, 0], [s + L, 0.9], [s, 0.9]])
        ridge.box(P(*a, z + h + 0.45), P(*b, z + h + 0.45), 0.3, 0.25)
        s += L
