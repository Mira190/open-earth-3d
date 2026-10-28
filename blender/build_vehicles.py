"""The vehicles every city's game shares: a light twin-engine helicopter and a
double-ended harbour ferry, modelled in Blender from code (headless, no hand
modelling, no stock assets), with ambient occlusion baked in Cycles, written as
glTF binary for three.js.

    pip install bpy==5.2.3                       # Blender as a Python module (Python 3.13)
    python blender/build_vehicles.py             # -> web/assets/vehicles/
    python blender/build_vehicles.py --render    # also Cycles beauty shots -> docs/images/vehicles/

writes:

- `helicopter.glb`: a light twin-engine helicopter in the H135 class, 10.3 m long with a
  10.2 m four-blade main rotor and a ducted tail fan. Glazed cockpit with seats,
  instruments and screens, sliding doors, skids, searchlight, camera turret and lights.
  Nodes the game drives: `MainRotor` (spins about +y) with `Blade_0..3` (flap about
  their chord axis), `TailRotor` (spins about +x), and empties marking the pilot's seat,
  the door, the lights and the searchlight.
- `ferry.glb`: a double-ended harbour ferry, 34 m long and 9.6 m in the beam, with a
  glazed main cabin and its seats, an open upper deck with railings and lifebuoys, a
  wheelhouse and a radar mast. Nodes: `Radar` (spins about +y), `Flag`, and empties for
  the passenger spot and the lights.

Both have a `Body_LOD1`, a decimated copy of the body for distance.
- `vehicles.json`: liveries, registrations by country, which material takes which
  livery colour, sizes and triangle counts.

Model axes (glTF, as three.js reads them): +z forward, +y up, +x to the left; the
helicopter's origin is under the rotor mast at the bottom of the skids, the ferry's
at the waterline amidships. Nothing here is city-specific: each city's game picks a
livery, a registration and its vessel names (game.vehicles in city.json), recolours
the materials named in `paint` and writes the names on the `Decal_*` patches.
"""
import argparse
import json
import math
import os
import time

import bpy
import bmesh  # after bpy, which provides it
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "assets", "vehicles")
DOCS = os.path.join(ROOT, "docs", "images", "vehicles")
TAU = 2 * math.pi
HALF = math.pi / 2


def lin(h):
    h = h.lstrip("#")
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))]


# ------------------------------------------------------------ liveries (sRGB); the game recolours from these
HELI_LIVERIES = {
    "survey": {"primary": "#f3f4f1", "secondary": "#15253b", "accent": "#ff6a14"},
    "rescue": {"primary": "#f4f3ee", "secondary": "#c8102e", "accent": "#ffcc00"},
    "news": {"primary": "#1d4e89", "secondary": "#f4f4f2", "accent": "#e63946"},
    "executive": {"primary": "#17191c", "secondary": "#3a3f45", "accent": "#c9a227"},
}
FERRY_LIVERIES = {
    "harbour": {"hull": "#1d5a3b", "band": "#e2b02a", "cabin": "#efe6cc", "trim": "#f5f0e1", "deck": "#6d7068", "boot": "#7b2b23"},
    "bay": {"hull": "#f2f2ee", "band": "#123b6d", "cabin": "#f7f7f4", "trim": "#123b6d", "deck": "#7d8183", "boot": "#2d3640"},
    "river": {"hull": "#2e3a46", "band": "#3fb8c9", "cabin": "#d9dee2", "trim": "#eef1f3", "deck": "#5d646a", "boot": "#1d2329"},
    "commuter": {"hull": "#f08c1e", "band": "#1f2328", "cabin": "#f4efe6", "trim": "#f9f6f0", "deck": "#6a6d6f", "boot": "#3a2a24"},
}
# ICAO nationality marks with an invented suffix, keyed by the country name in scene.json
REGISTRATIONS = {
    "Australia": "VH-OEH", "Japan": "JA03DE", "United States": "N3DOE", "United Kingdom": "G-OEHX", "France": "F-HOEX",
    "Netherlands": "PH-OEH", "China": "B-73DE", "Hong Kong": "B-HOE", "Singapore": "9V-OEH", "Germany": "D-HOEX",
    "New Zealand": "ZK-OEH", "Canada": "C-GOEH", "Italy": "I-OEHX", "Spain": "EC-OEH", "South Korea": "HL93DE",
}


# ------------------------------------------------------------ materials
MAT = {}


def material(name, color, rough=0.5, metal=0.0, coat=0.0, emit=None, alpha=1.0, cull=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*lin(color), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.06
    if emit:
        b.inputs["Emission Color"].default_value = (*lin(emit), 1)
        b.inputs["Emission Strength"].default_value = 1.0
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    m.use_backface_culling = cull
    MAT[name] = m
    return m


# ------------------------------------------------------------ mesh building
# Geometry is written in the vehicle frame: x forward, y left, z up. Blender's glTF
# exporter turns z-up into y-up, and three.js models face +z, so the vehicle frame is
# turned a quarter turn about z on the way out: forward becomes Blender -y.
def to_blender(p):
    return Vector((p[1], -p[0], p[2]))


class Mesh:
    """Vertices and faces with a material and smoothing flag per face (and optional
    corner UVs), built into one Blender object."""

    def __init__(self):
        self.v, self.f, self.m, self.s, self.uv = [], [], [], [], []

    def vert(self, p):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.v) - 1

    def face(self, ids, mat, smooth=True, uv=None):
        self.f.append(list(ids))
        self.m.append(mat)
        self.s.append(smooth)
        self.uv.append(uv)

    def add_bm(self, bm, mat, M=None, smooth=None):
        """Append a bmesh, transformed by M; `smooth` is a predicate on the face normal
        (in the bmesh's own frame), or a bool."""
        bm.verts.index_update()
        base = len(self.v)
        for v in bm.verts:
            self.vert(M @ v.co if M is not None else v.co)
        for f in bm.faces:
            sm = smooth(f.normal) if callable(smooth) else bool(smooth)
            self.face([base + v.index for v in f.verts], mat, sm)
        bm.free()

    def merge(self, other):
        base = len(self.v)
        self.v += other.v
        for ids, m, s, uv in zip(other.f, other.m, other.s, other.uv):
            self.face([base + i for i in ids], m, s, uv)

    def build(self, name, origin=(0, 0, 0), parent=None):
        o = to_blender(origin)
        me = bpy.data.meshes.new(name + "_mesh")   # glTF mesh names must not clash with node names
        me.from_pydata([tuple(to_blender(p) - o) for p in self.v], [], self.f)
        assert len(me.polygons) == len(self.f), name
        names = list(dict.fromkeys(self.m))
        for n in names:
            me.materials.append(MAT[n])
        me.polygons.foreach_set("material_index", [names.index(n) for n in self.m])
        me.polygons.foreach_set("use_smooth", self.s)
        if any(u is not None for u in self.uv):
            layer = me.uv_layers.new(name="UV")
            flat = []
            for ids, u in zip(self.f, self.uv):
                flat.extend(u if u is not None else [(0.0, 0.0)] * len(ids))
            layer.data.foreach_set("uv", np.asarray(flat, np.float32).ravel())
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if parent is not None:
            ob.parent = parent
            ob.location = o - parent.location
        else:
            ob.location = o
        return ob


def empty(name, p, parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.2
    bpy.context.scene.collection.objects.link(ob)
    ob.location = to_blender(p)
    if parent is not None:
        ob.parent = parent
        ob.location = to_blender(p) - parent.location
    return ob


def T(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """A transform in the vehicle frame: rotations in radians about x, y, z (applied x, then y, then z)."""
    R = Matrix.Rotation(rot[2], 4, "Z") @ Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[0], 4, "X")
    return Matrix.Translation(loc) @ R @ Matrix.Diagonal((*scale, 1))


# ------------------------------------------------------------ primitives (vehicle frame)
def box(mesh, mat, size, M=Matrix(), bevel=0.0, segs=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, affect="EDGES", profile=0.5)
    mesh.add_bm(bm, mat, M, smooth=bool(bevel))


def cyl(mesh, mat, r, h, M=Matrix(), segs=16, r2=None, caps=True):
    """A cylinder (or cone) along local z, centred on the origin."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h)
    mesh.add_bm(bm, mat, M, smooth=lambda n: abs(n.z) < 0.7)


def sphere(mesh, mat, r, M=Matrix(), segs=16, rings=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    mesh.add_bm(bm, mat, M, smooth=True)


def tube(mesh, mat, pts, r, segs=12, caps=True, smooth=True):
    """A round tube swept along a 3D polyline (rotation-minimising frames)."""
    P = [Vector(p) for p in pts]
    n = len(P)
    tan = []
    for i in range(n):
        a, b = P[max(0, i - 1)], P[min(n - 1, i + 1)]
        tan.append((b - a).normalized())
    ref = Vector((0, 0, 1)) if abs(tan[0].z) < 0.9 else Vector((1, 0, 0))
    u = tan[0].cross(ref).normalized()
    rings = []
    for i in range(n):
        if i:
            u = (u - tan[i] * u.dot(tan[i])).normalized()
        w = tan[i].cross(u)
        rr = r(i / (n - 1)) if callable(r) else r
        rings.append([mesh.vert(P[i] + (u * math.cos(a) + w * math.sin(a)) * rr) for a in np.linspace(0, TAU, segs, endpoint=False)])
    for i in range(n - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            mesh.face([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]], mat, smooth)
    if caps:
        mesh.face(rings[0][::-1], mat, False)
        mesh.face(rings[-1], mat, False)


def loft(mesh, mat, sections, caps=True, smooth=True, cap_mat=None):
    """Quads between closed sections with the same number of points; flat caps at both ends."""
    rings = [[mesh.vert(p) for p in s] for s in sections]
    m = len(rings[0])
    first = len(mesh.f)
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(m):
            k2 = (k + 1) % m
            mesh.face([a[k], a[k2], b[k2], b[k]], mat, smooth)
    if caps:
        mesh.face(rings[0][::-1], cap_mat or mat, False)
        mesh.face(rings[-1], cap_mat or mat, False)
    # point every face away from the middle of its section (sections may be given either way round)
    score = 0.0
    for i in range(first, first + (len(rings) - 1) * m):
        ids = mesh.f[i]
        a, b, d = (Vector(mesh.v[ids[k]]) for k in (0, 1, 3))
        ring = rings[(i - first) // m]
        mid = sum((Vector(mesh.v[j]) for j in ring), Vector()) / m
        score += (b - a).cross(d - a).dot(a - mid)
    if score < 0:
        for i in range(first, len(mesh.f)):
            mesh.f[i].reverse()
    return rings


def revolve(mesh, mat, profile, centre, axis, segs=48, smooth=True, scale=None):
    """Revolve a closed (radius, axial) profile, clockwise in the (radius, axial) plane, about
    an axis through `centre`; scale(radius, angle) can reshape it round the turn."""
    c, ax = Vector(centre), Vector(axis).normalized()
    ref = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))
    e1 = ax.cross(ref).normalized()
    e2 = ax.cross(e1)
    rings = []
    for a in np.linspace(0, TAU, segs, endpoint=False):
        d = e1 * math.cos(a) + e2 * math.sin(a)
        phi = math.atan2(d.z, d.x)  # angle in the vehicle's x-z plane, 0 forward
        rings.append([mesh.vert(c + d * (scale(rho, phi) if scale else rho) + ax * h) for rho, h in profile])
    m = len(profile)
    for i in range(segs):
        i2 = (i + 1) % segs
        for k in range(m):
            k2 = (k + 1) % m
            mesh.face([rings[i][k], rings[i][k2], rings[i2][k2], rings[i2][k]], mat, smooth)


def airfoil(chord, thick, n=10, le_at=0.0):
    """A symmetric NACA 00xx section as (along-chord, half-thickness) points, closed, leading edge first.
    Along-chord runs from -le_at*chord (leading edge) to (1 - le_at)*chord."""
    xs = [(1 - math.cos(math.pi * k / n)) / 2 for k in range(n + 1)]
    yt = [5 * thick * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4) for x in xs]
    up = [((x - le_at) * chord, t * chord) for x, t in zip(xs, yt)]
    lo = [((x - le_at) * chord, -t * chord) for x, t in zip(xs[1:-1], yt[1:-1])][::-1]
    return up + lo


# ------------------------------------------------------------ parametric surfaces
def pchip(xs, ys):
    """Monotone cubic interpolation (Fritsch-Carlson): smooth, with no overshoot between stations."""
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    h, d = np.diff(xs), np.diff(ys) / np.diff(xs)
    m = np.zeros_like(ys)
    m[0], m[-1] = d[0], d[-1]
    for k in range(1, len(xs) - 1):
        if d[k - 1] * d[k] > 0:
            w1, w2 = 2 * h[k] + h[k - 1], h[k] + 2 * h[k - 1]
            m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])

    def f(x):
        k = int(min(max(np.searchsorted(xs, x) - 1, 0), len(xs) - 2))
        t = (x - xs[k]) / h[k]
        return ((2 * t ** 3 - 3 * t * t + 1) * ys[k] + (t ** 3 - 2 * t * t + t) * h[k] * m[k]
                + (-2 * t ** 3 + 3 * t * t) * ys[k + 1] + (t ** 3 - t * t) * h[k] * m[k + 1])
    return f


class Surface:
    """A surface S(u, v) with an outward hint, for normals, gridding and decals that lie on it."""

    def __init__(self, S, outward):
        self.S, self.out = S, outward

    def __call__(self, u, v):
        return self.S(u, v)

    def frame(self, u, v, du=1e-4, dv=1e-4):
        p = self.S(u, v)
        su = (self.S(u + du, v) - self.S(u - du, v)) / (2 * du)
        sv = (self.S(u, v + dv) - self.S(u, v - dv)) / (2 * dv)
        n = su.cross(sv)
        o = self.out(u, v, p)
        if n.length < 1e-9:
            n = o.copy()
        elif n.dot(o) < 0:
            n = -n
        return p, su, sv, n.normalized()

    def normal(self, u, v):
        return self.frame(u, v)[3]

    def project(self, u, v, q, iters=3):
        """The parameters of the surface point nearest q, starting from (u, v)."""
        for _ in range(iters):
            p, su, sv, _n = self.frame(u, v)
            J = np.array([su, sv]).T
            d = np.linalg.lstsq(J, np.array(q - p), rcond=None)[0]
            u, v = u + d[0], v + d[1]
        return u, v

    def grid(self, mesh, us, vs, mat_of, period=None, offset=0.0, flip=False, smooth=True):
        """Quads over the parameter grid us x vs (vs wraps if `period` is set). mat_of(u, v)
        names each cell's material, or None for a hole. Faces point outward (inward if flip)."""
        ids = {}

        def P(i, j):
            if (i, j) not in ids:
                p = self.S(us[i], vs[j])
                if offset:
                    p = p + self.normal(us[i], vs[j]) * offset
                ids[(i, j)] = mesh.vert(p)
            return ids[(i, j)]
        nv = len(vs)
        for i in range(len(us) - 1):
            for j in range(nv if period else nv - 1):
                j2 = (j + 1) % nv
                v1 = vs[j2] if j2 else vs[0] + (period or 0)
                um, vm = (us[i] + us[i + 1]) / 2, (vs[j] + v1) / 2
                m = mat_of(um, vm)
                if m is None:
                    continue
                q = [P(i, j), P(i + 1, j), P(i + 1, j2), P(i, j2)]
                a, b, c = (Vector(mesh.v[q[k]]) for k in (0, 1, 3))
                n = (b - a).cross(c - a)
                if n.length < 1e-12:
                    n = (Vector(mesh.v[q[2]]) - b).cross(Vector(mesh.v[q[2]]) - c)
                o = self.out(um, vm, self.S(um, vm))
                if (n.dot(o) < 0) != flip:
                    q.reverse()
                mesh.face(q, m, smooth)
        return ids

    def band(self, mesh, pts, half, mat, offset=0.004, across=3, closed=False, step=0.025, uv=False, smooth=True):
        """A strip 2*half metres wide lying on the surface along the parameter-space polyline
        `pts`, lifted `offset` metres off it: stripes, gaskets, panel seams and decal patches.
        With uv, u runs 0..1 along the strip and v 0..1 across it (left to right of travel)."""
        seq = list(pts) + ([pts[0]] if closed else [])
        dense = []
        for a, b in zip(seq[:-1], seq[1:]):
            n = max(1, int(math.ceil((self.S(*b) - self.S(*a)).length / step)))
            dense += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n)]
        if not closed:
            dense.append(seq[-1])
        N = len(dense)
        P3 = [self.S(*d) for d in dense]
        cum = [0.0]
        for a, b in zip(P3[:-1], P3[1:]):
            cum.append(cum[-1] + (b - a).length)
        rows = []
        for k, (u, v) in enumerate(dense):
            p, _su, _sv, nrm = self.frame(u, v)
            k0, k1 = ((k - 1) % N, (k + 1) % N) if closed else (max(0, k - 1), min(N - 1, k + 1))
            t = (P3[k1] - P3[k0]).normalized()
            side = nrm.cross(t).normalized()
            row = []
            for a in np.linspace(-1, 1, across):
                uu, vv = self.project(u, v, p + side * (half * a), iters=2)
                row.append(mesh.vert(self.S(uu, vv) + self.normal(uu, vv) * offset))
            rows.append((row, nrm))
        segs = N if closed else N - 1
        for k in range(segs):
            (ra, na), (rb, _) = rows[k], rows[(k + 1) % N]
            for i in range(across - 1):
                q = [ra[i], rb[i], rb[i + 1], ra[i + 1]]
                a, b, c = (Vector(mesh.v[x]) for x in (q[0], q[1], q[3]))
                flip = (b - a).cross(c - a).dot(na) < 0
                uvq = None
                if uv:
                    L = cum[-1] or 1
                    u0, u1 = cum[k] / L, (cum[k + 1] if k + 1 < N else L) / L
                    v0, v1 = i / (across - 1), (i + 1) / (across - 1)
                    uvq = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
                if flip:
                    q.reverse()
                    uvq = uvq[::-1] if uvq else None
                mesh.face(q, mat, smooth, uvq)


def chaikin(poly, n=3, closed=True):
    for _ in range(n):
        out = []
        m = len(poly)
        for i in range(m if closed else m - 1):
            a, b = poly[i], poly[(i + 1) % m]
            out += [tuple(0.75 * p + 0.25 * q for p, q in zip(a, b)), tuple(0.25 * p + 0.75 * q for p, q in zip(a, b))]
        poly = out if closed else [poly[0]] + out + [poly[-1]]
    return poly


def inside(poly, x, y):
    c = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def spaced(a, b, step):
    n = max(1, int(round(abs(b - a) / step)))
    return list(np.linspace(a, b, n + 1))


# ------------------------------------------------------------ helicopter
# Stations along the fuselage: x, centre height, half-width, height above and below the
# centre, and the superellipse exponents of the upper and lower halves (2 is an ellipse,
# higher is boxier). Origin under the mast at the bottom of the skids.
FUSELAGE = [
    (3.47, 1.17, 0.66, 0.62, 0.50, 2.3, 2.8),
    (3.10, 1.25, 0.75, 0.71, 0.56, 2.4, 3.1),
    (2.60, 1.31, 0.80, 0.75, 0.62, 2.6, 3.5),
    (2.00, 1.35, 0.82, 0.74, 0.67, 2.8, 3.9),
    (1.20, 1.37, 0.83, 0.72, 0.69, 3.0, 4.0),
    (0.30, 1.38, 0.83, 0.71, 0.70, 3.0, 4.0),
    (-0.50, 1.40, 0.81, 0.68, 0.69, 3.0, 3.8),
    (-1.15, 1.46, 0.74, 0.62, 0.61, 2.8, 3.3),
    (-1.75, 1.58, 0.56, 0.48, 0.45, 2.5, 2.7),
    (-2.35, 1.74, 0.34, 0.32, 0.30, 2.2, 2.2),
    (-2.95, 1.84, 0.255, 0.255, 0.245, 2.0, 2.0),
    (-4.70, 1.97, 0.21, 0.21, 0.20, 2.0, 2.0),
    (-5.05, 2.00, 0.19, 0.20, 0.18, 2.0, 2.0),
    (-5.22, 2.02, 0.12, 0.13, 0.12, 2.0, 2.0),
    (-5.30, 2.03, 0.02, 0.02, 0.02, 2.0, 2.0),
]
NOSE_X0, NOSE_TIP, NOSE_ZTIP = 3.47, 3.99, 1.02     # the nose is an elliptic cap ahead of the first station
BELLY = 0.30                                         # rad below the side line: the lower livery colour
CABIN_X = (-1.22, 3.92)                              # the interior lining and its rear bulkhead


def fuselage_surface():
    xs = [r[0] for r in FUSELAGE][::-1]
    cols = [pchip(xs, [r[k] for r in FUSELAGE][::-1]) for k in range(1, 7)]
    first = FUSELAGE[0]

    def params(x):
        if x > NOSE_X0:  # elliptic nose cap, tending to an ellipsoid at the tip
            t = min(1.0, (x - NOSE_X0) / (NOSE_TIP - NOSE_X0))
            k = math.sqrt(max(0.0, 1 - t * t))
            zc = first[1] + (NOSE_ZTIP - first[1]) * t
            return zc, first[2] * k, first[3] * k, first[4] * k, first[5] + (2 - first[5]) * t, first[6] + (2 - first[6]) * t
        return [c(x) for c in cols]

    def S(x, th):
        zc, w, ht, hb, nt, nb = params(x)
        c, s = math.cos(th), math.sin(th)
        e = 2 / (nt if s >= 0 else nb)
        y = -w * math.copysign(abs(c) ** e, c)            # theta 0 is the right side (-y), pi/2 the top
        z = zc + ht * abs(s) ** e if s >= 0 else zc - hb * abs(s) ** e
        return Vector((x, y, z))

    def out(x, th, p):
        zc = params(x)[0]
        if x > NOSE_X0 + 0.3:
            return Vector((p.x - NOSE_X0, p.y, p.z - zc))
        return Vector((0, p.y, p.z - zc))
    return Surface(S, out), params


def nose_xs():
    """Samples along x: elliptic spacing on the nose cap so it stays round at the tip."""
    xs = [NOSE_X0 + (NOSE_TIP - NOSE_X0) * math.sin(a) for a in np.linspace(0, HALF, 14)[1:]]
    return xs


# glazing in (x, theta) for the right side; the left side mirrors theta -> pi - theta
WINDOWS = {
    "windscreen": [(2.47, HALF - 0.035), (2.47, 1.02), (2.75, 0.55), (3.02, -0.06), (3.36, -0.30), (3.58, -0.30),
                   (3.70, 0.30), (3.74, HALF - 0.035)],
    "front_door": [(1.34, -0.04), (1.34, 0.97), (2.30, 0.97), (2.56, 0.52), (2.84, -0.04)],
    "chin": [(3.04, -0.66), (3.42, -0.52), (3.60, -0.62), (3.56, -0.98), (3.12, -1.10)],
    "rear_door": [(-0.38, 0.04), (-0.38, 0.97), (1.02, 0.97), (1.02, 0.04)],
    "aft": [(-1.02, 0.16), (-1.02, 0.82), (-0.62, 0.88), (-0.62, 0.16)],
}
SEAMS = {  # door and panel outlines, right side
    "front_door": ([(1.24, -0.70), (1.24, 1.07), (2.40, 1.07), (2.66, 0.55), (2.96, -0.12), (2.96, -0.70)], True),
    "rear_door": ([(-0.48, -0.70), (-0.48, 1.07), (1.12, 1.07), (1.12, -0.70)], True),
    "rail": ([(-0.48, -0.74), (-1.40, -0.74)], False),
    "tail_cone": ([(-2.55, th) for th in np.linspace(0, TAU, 40, endpoint=False)], True),
    "nose": ([(3.80, th) for th in np.linspace(-1.9, 0.25, 30)], False),
}
STRIPE = [(3.82, -0.46), (3.45, -0.40), (2.90, -0.34), (2.10, -0.31), (0.80, -0.30), (-0.60, -0.30), (-1.40, -0.25),
          (-2.10, -0.10), (-2.80, 0.02), (-3.60, 0.05), (-4.95, 0.05)]
PINSTRIPE = [(3.40, -0.62), (2.50, -0.52), (1.20, -0.47), (-0.30, -0.45), (-1.20, -0.40), (-1.90, -0.30), (-2.60, -0.18), (-3.40, -0.14)]


def mirror(poly):
    return [(x, (math.pi - th)) for x, th in poly]


def build_helicopter():
    # two-sided: from inside, through the glass, the skin's back shows round the lining's openings
    material("Paint_Primary", HELI_LIVERIES["survey"]["primary"], 0.32, 0.0, coat=1.0, cull=False)
    material("Paint_Secondary", HELI_LIVERIES["survey"]["secondary"], 0.32, 0.0, coat=1.0, cull=False)
    material("Stripe_Accent", HELI_LIVERIES["survey"]["accent"], 0.34, 0.0, coat=1.0)
    material("Glass", "#1c2730", 0.03, 0.0, alpha=0.38)
    material("Gasket", "#0b0c0d", 0.5, cull=False)
    material("Seam", "#3a3f44", 0.6)
    material("Grille", "#15181b", 0.7, 0.2)
    material("Metal_Dark", "#2a2e33", 0.38, 0.75)
    material("Metal", "#9aa1a8", 0.28, 0.9)
    material("Exhaust", "#5d5a55", 0.45, 0.85, cull=False)
    material("Rubber", "#1a1b1c", 0.8)
    material("Interior", "#34373b", 0.85, cull=False)
    material("Seat", "#24272b", 0.75)
    material("Panel", "#1d2024", 0.6, 0.1)
    material("Screen", "#0d2233", 0.25, emit="#2b8fc7")
    material("Blade", "#2a2d31", 0.42, 0.3)
    material("Blade_Tip", "#f2c53d", 0.4)
    material("Light_Red", "#b3121a", 0.2, emit="#ff2a2a")
    material("Light_Green", "#0f8a3a", 0.2, emit="#2aff6a")
    material("Light_White", "#d8dde0", 0.15, emit="#ffffff")
    material("Light_Lens", "#cfd8de", 0.05, 0.2, emit="#fff4dc")
    material("Decal_Registration", "#ffffff", 0.4, alpha=0.999)
    material("Decal_Logo", "#ffffff", 0.4, alpha=0.999)

    F, params = fuselage_surface()
    win = {k: chaikin(v) for k, v in WINDOWS.items()}
    win.update({k + "_l": chaikin(mirror(v)) for k, v in WINDOWS.items()})

    def glass(x, th):
        th = th % TAU
        return any(inside(p, x, th) or inside(p, x, th - TAU) for p in win.values())

    def paint(x, th):
        th = th % TAU
        if glass(x, th):
            return "Glass"
        return "Paint_Secondary" if math.pi + BELLY < th < TAU - BELLY else "Paint_Primary"

    xs = sorted(set(spaced(-5.30, -2.6, 0.12) + spaced(-2.6, NOSE_X0, 0.042) + nose_xs()))
    # angles spaced by arc length round the cabin section, so cells are near square everywhere
    fine = np.linspace(0, TAU, 2001)
    pts = [F(1.2, t) for t in fine]
    arc = np.concatenate([[0], np.cumsum([(b - a).length for a, b in zip(pts[:-1], pts[1:])])])
    ths = list(np.interp(np.linspace(0, arc[-1], 124, endpoint=False), arc, fine))
    body = Mesh()
    F.grid(body, xs, ths, paint, period=TAU)

    # the cabin lining, 3.5 cm inside the skin, and the bulkhead behind it. Its openings are a
    # cell wider than the glass all round, so their stepped edges hide behind the painted skin
    lin_xs = [x for x in xs if CABIN_X[0] <= x <= CABIN_X[1]]
    nt = len(ths)
    mid = lambda i, j: ((lin_xs[i] + lin_xs[i + 1]) / 2, (ths[j] + (ths[j + 1] if j + 1 < nt else ths[0] + TAU)) / 2)
    pane = {(i, j) for i in range(len(lin_xs) - 1) for j in range(nt) if glass(*mid(i, j))}
    hole = {mid(i + di, (j + dj) % nt) for i, j in pane for di in (-1, 0, 1) for dj in (-1, 0, 1) if 0 <= i + di < len(lin_xs) - 1}
    Fin = Surface(lambda x, th: F(x, th) - F.normal(x, th) * 0.035, F.out)
    Fin.grid(body, lin_xs, ths, lambda x, th: None if (x, th) in hole else "Interior", period=TAU, flip=True)
    ring = [body.vert(Fin(lin_xs[0], th)) for th in ths]
    c = body.vert(Vector((lin_xs[0], 0, params(lin_xs[0])[0])))
    for k in range(len(ring)):
        body.face([c, ring[(k + 1) % len(ring)], ring[k]], "Interior", False)

    # cockpit and cabin: floor, seats, instrument panel and screens, controls
    zf = 0.80
    for x0, x1 in ((-1.18, 3.35),):
        pts = []
        for x in spaced(x0, x1, 0.25):
            hw = params(x)[1] * 0.80
            pts.append((x, hw))
        floor = Mesh()
        a = [floor.vert((x, -hw, zf)) for x, hw in pts]
        b = [floor.vert((x, hw, zf)) for x, hw in pts]
        for i in range(len(pts) - 1):
            floor.face([a[i], a[i + 1], b[i + 1], b[i]], "Interior", False)
        body.merge(floor)

    def seat(x, y, facing=1.0, w=0.48):
        s = facing
        box(body, "Seat", (0.50, w, 0.12), T((x, y, 1.12)), bevel=0.04)
        box(body, "Seat", (0.11, w, 0.62), T((x - 0.26 * s, y, 1.47), (0, -0.16 * s, 0)), bevel=0.04)
        box(body, "Seat", (0.08, w * 0.55, 0.16), T((x - 0.33 * s, y, 1.86), (0, -0.16 * s, 0)), bevel=0.03)
        box(body, "Metal_Dark", (0.42, w * 0.8, 0.30), T((x, y, 0.94)))
    seat(2.00, -0.40)
    seat(2.00, 0.40)
    for y in (-0.48, 0.0, 0.48):
        seat(0.30, y, w=0.44)
    # instrument panel under a glare shield, three screens a side, centre console
    box(body, "Panel", (0.32, 1.30, 0.42), T((2.80, 0, 1.36), (0, 0.32, 0)), bevel=0.03)
    box(body, "Panel", (0.42, 1.36, 0.06), T((2.74, 0, 1.60), (0, 0.10, 0)), bevel=0.02)
    for y in (-0.42, -0.14, 0.14, 0.42):
        box(body, "Screen", (0.01, 0.22, 0.18), T((2.635, y, 1.38), (0, 0.32, 0)))
    box(body, "Panel", (0.80, 0.24, 0.30), T((2.30, 0, 0.98)), bevel=0.03)
    for y in (-0.40, 0.40):
        cyl(body, "Metal_Dark", 0.016, 0.42, T((2.30, y, 1.05), (0, 0.18, 0)), segs=8)
        sphere(body, "Rubber", 0.035, T((2.34, y, 1.26)), segs=8, rings=6)

    # engine cowling: a long hump over the cabin roof, with intakes and twin exhausts
    cowl_st = [(2.42, 1.99, 0.04, 0.02), (2.20, 2.02, 0.36, 0.13), (1.75, 2.04, 0.52, 0.33), (1.05, 2.05, 0.57, 0.47),
               (0.00, 2.05, 0.58, 0.52), (-0.90, 2.04, 0.56, 0.50), (-1.55, 2.00, 0.48, 0.40), (-2.15, 1.92, 0.33, 0.24),
               (-2.75, 1.86, 0.10, 0.04)]
    cx = [r[0] for r in cowl_st][::-1]
    cz, cw, chh = (pchip(cx, [r[k] for r in cowl_st][::-1]) for k in (1, 2, 3))

    def Sc(x, th):
        c, s = math.cos(th), math.sin(th)
        e = 2 / 2.6
        return Vector((x, -cw(x) * math.copysign(abs(c) ** e, c), cz(x) + chh(x) * math.copysign(abs(s) ** e, s)))
    C = Surface(Sc, lambda x, th, p: Vector((0, p.y, p.z - cz(x) + 0.2)))
    cxs = spaced(-2.75, 2.42, 0.07)
    cths = list(np.linspace(-0.45, math.pi + 0.45, 40))
    C.grid(body, cxs, cths, lambda x, th: "Paint_Primary")
    # mast fairing, rotor mast and swashplate
    revolve(body, "Paint_Primary", [(0.001, 2.93), (0.10, 2.925), (0.16, 2.88), (0.21, 2.78), (0.25, 2.62), (0.27, 2.50), (0.001, 2.45)],
            (0, 0, 0), (0, 0, 1), segs=32)
    cyl(body, "Metal_Dark", 0.075, 0.40, T((0, 0, 3.10)), segs=16)
    cyl(body, "Metal", 0.19, 0.035, T((0, 0, 3.00)), segs=24)
    trim = Mesh()
    for side in (1, -1):
        th0 = 0.30 if side > 0 else math.pi - 0.30
        for x0, x1 in ((0.95, 0.40), (-0.35, -0.90)):
            C.band(trim, [(x0, th0), (x1, th0)], 0.055, "Grille", offset=0.004, across=3)
        # exhausts, angled up and out
        y = -0.30 * side
        tube(body, "Exhaust", [(-1.35, y, 2.20), (-1.58, y * 1.10, 2.28), (-1.80, y * 1.24, 2.38)], 0.095, segs=16, caps=False)
        cyl(body, "Rubber", 0.09, 0.02, T((-1.45, y * 1.04, 2.23), (0, -math.atan2(0.10, 0.25) + HALF, 0)), segs=16)

    # tail: the ducted fan's shroud, the fin over it, the stabiliser with end plates
    fc, fz, rd = -5.78, 2.12, 0.46
    shroud = [(rd, -0.13), (rd, 0.13), (rd + 0.02, 0.165), (rd + 0.06, 0.185), (rd + 0.12, 0.19), (0.74, 0.17), (0.80, 0.12),
              (0.82, 0.0), (0.80, -0.12), (0.74, -0.17), (rd + 0.12, -0.19), (rd + 0.06, -0.185), (rd + 0.02, -0.165)]
    # the housing is not round: it runs forward into the boom and up into the fin
    def R(phi):
        return 0.665 - 0.03 * math.cos(phi) + 0.08 * math.sin(phi) - 0.015 * math.cos(2 * phi)
    revolve(body, "Paint_Secondary", shroud, (fc, 0, fz), (0, 1, 0), segs=72,
            scale=lambda rho, phi: rho if rho <= rd + 0.121 else rd + 0.12 + (rho - rd - 0.12) * (R(phi) - rd - 0.12) / (0.82 - rd - 0.12))
    # stators behind the fan, and its gearbox
    for k in range(9):
        a = k / 9 * TAU + 0.2
        r0, r1 = 0.11, rd
        box(body, "Metal_Dark", ((r1 - r0), 0.012, 0.05), T((fc + math.cos(a) * (r0 + r1) / 2, -0.07, fz + math.sin(a) * (r0 + r1) / 2), (0, -a, 0)))
    cyl(body, "Metal_Dark", 0.115, 0.16, T((fc, -0.06, fz), (HALF, 0, 0)), segs=20)

    def fin_section(z, le, te, t):
        return [Vector((le - a, b, z)) for a, b in airfoil(le - te, t)]
    loft(body, "Paint_Secondary", [fin_section(z, le, te, t) for z, le, te, t in
                                   ((2.78, -5.30, -6.56, 0.13), (3.20, -5.72, -6.62, 0.12), (3.58, -6.12, -6.66, 0.10))])
    loft(body, "Paint_Secondary", [fin_section(z, le, te, t) for z, le, te, t in ((1.24, -5.70, -6.10, 0.12), (1.46, -5.55, -6.20, 0.13))])
    tube(body, "Metal_Dark", [(-5.95, 0, 1.22), (-6.20, 0, 1.12), (-6.38, 0, 1.18)], 0.02, segs=8)

    def stab_section(y, ch, t, z):
        return [Vector((-4.18 - a, y, z + b)) for a, b in airfoil(ch, t)]
    loft(body, "Paint_Secondary", [stab_section(y, 0.55, 0.12, 1.98) for y in (-1.22, 0.0, 1.22)])
    for side in (1, -1):
        y = 1.24 * side
        secs = []
        for z, le, ch in ((1.74, -4.10, 0.62), (2.10, -4.18, 0.56), (2.44, -4.32, 0.44)):
            secs.append([Vector((le - a, y + b * side, z)) for a, b in airfoil(ch, 0.10)])
        loft(body, "Paint_Secondary", secs)

    # skids: two tubes with upturned toes, two arched cross tubes, steps
    for side in (1, -1):
        y = 1.02 * side
        path = [(-2.05, y, 0.13), (-1.92, y, 0.06), (-1.75, y, 0.05)] + [(x, y, 0.05) for x in spaced(-1.5, 1.6, 0.5)] + \
               [(1.82, y, 0.07), (2.00, y, 0.15), (2.12, y, 0.28), (2.17, y, 0.40)]
        tube(body, "Metal_Dark", chaikin(path, 2, closed=False), 0.048, segs=12)
    for x in (1.10, -0.95):
        arch = [(x, -1.02, 0.05), (x, -1.01, 0.22), (x, -0.95, 0.46), (x, -0.78, 0.64), (x, -0.45, 0.73), (x, 0.0, 0.75),
                (x, 0.45, 0.73), (x, 0.78, 0.64), (x, 0.95, 0.46), (x, 1.01, 0.22), (x, 1.02, 0.05)]
        tube(body, "Metal_Dark", chaikin(arch, 2, closed=False), 0.055, segs=12)
    for side in (1, -1):
        box(body, "Rubber", (0.42, 0.22, 0.03), T((1.10, 0.86 * side, 0.36), (0.25 * side, 0, 0)), bevel=0.01)
        box(body, "Rubber", (0.42, 0.22, 0.03), T((-0.95, 0.86 * side, 0.36), (0.25 * side, 0, 0)), bevel=0.01)

    # sensors, lights and antennas
    sphere(body, "Paint_Primary", 0.17, T((3.30, 0, 0.53)), segs=20, rings=14)       # camera turret
    cyl(body, "Metal_Dark", 0.07, 0.18, T((3.30, 0, 0.72)), segs=12)
    cyl(body, "Glass", 0.08, 0.04, T((3.46, 0, 0.53), (0, HALF, 0)), segs=16)
    cyl(body, "Metal_Dark", 0.115, 0.22, T((1.25, -0.42, 0.62), (0, HALF + 0.5, 0)), segs=18)  # searchlight
    cyl(body, "Light_Lens", 0.10, 0.012, T((1.35, -0.42, 0.565), (0, HALF + 0.5, 0)), segs=18)
    for y in (-0.16, 0.16):                                                           # landing lights
        cyl(body, "Light_Lens", 0.055, 0.02, T((3.48, y, 0.78), (0, HALF + 0.7, 0)), segs=12)
    lights = {"Nav_Red": (-4.40, 1.30, 2.30), "Nav_Green": (-4.40, -1.30, 2.30), "Nav_White": (-6.67, 0, 3.05),
              "Beacon_Top": (-6.40, 0, 3.66), "Beacon_Bottom": (-0.70, 0, 0.66), "Strobe_L": (-4.46, 1.27, 2.47),
              "Strobe_R": (-4.46, -1.27, 2.47)}
    sphere(body, "Light_Red", 0.035, T(lights["Nav_Red"]), segs=8, rings=6)
    sphere(body, "Light_Green", 0.035, T(lights["Nav_Green"]), segs=8, rings=6)
    sphere(body, "Light_White", 0.03, T(lights["Nav_White"]), segs=8, rings=6)
    sphere(body, "Light_Red", 0.055, T(lights["Beacon_Top"]), segs=10, rings=6)
    sphere(body, "Light_Red", 0.06, T(lights["Beacon_Bottom"]), segs=10, rings=6)
    for k in ("Strobe_L", "Strobe_R"):
        sphere(body, "Light_White", 0.03, T(lights[k]), segs=8, rings=6)

    def blade_antenna(x, z, up=1, h=0.26):
        secs = [[Vector((x - a, b, z)) for a, b in airfoil(0.30, 0.10)], [Vector((x - 0.16 - a, b, z + h * up)) for a, b in airfoil(0.12, 0.10)]]
        loft(body, "Metal_Dark", secs if up > 0 else secs[::-1])
    blade_antenna(-3.30, 2.17)
    blade_antenna(0.70, 0.70, -1, 0.20)
    blade_antenna(-1.70, 2.36, 1, 0.16)
    # wire-strike cutters above the windscreen and under the nose; pitot tubes
    loft(body, "Metal", [[Vector((2.44 + a * 0.4, b * 0.4, 2.06 + 0.0)) for a, b in airfoil(0.5, 0.06)],
                         [Vector((2.50 + a * 0.4, b * 0.4, 2.40)) for a, b in airfoil(0.3, 0.06)]])
    loft(body, "Metal", [[Vector((3.62 + a * 0.4, b * 0.4, 0.70)) for a, b in airfoil(0.4, 0.06)],
                         [Vector((3.74 + a * 0.4, b * 0.4, 0.42)) for a, b in airfoil(0.2, 0.06)]])
    for y in (-0.18, 0.18):
        tube(body, "Metal", [(2.55, y, 2.02), (2.78, y, 2.06), (3.05, y, 2.07)], 0.011, segs=6)
    # door handles and the sliding door rail
    for side in (1, -1):
        for x in (1.42, -0.32):
            p = F(x, 0.02 if side > 0 else math.pi - 0.02)
            box(body, "Metal_Dark", (0.16, 0.03, 0.035), T(p + F.normal(x, 0.02 if side > 0 else math.pi - 0.02) * 0.012), bevel=0.008)

    # trim: window gaskets, seams, livery stripes, decal patches (lifted off the skin, outside the AO bake)
    # gaskets on both faces of the skin: they hide the panes' stepped edges from outside and in
    for name, poly in win.items():
        for off in (0.006, -0.006):
            F.band(trim, poly, 0.036, "Gasket", offset=off, across=2, closed=True, step=0.025)
    for name, (poly, closed) in SEAMS.items():
        for pts in (poly, mirror(poly)):
            F.band(trim, chaikin(pts, 2, closed) if closed and name != "tail_cone" else pts, 0.006, "Seam", offset=0.003, across=2,
                   closed=closed, step=0.04)
    for pts in (STRIPE, mirror(STRIPE)):
        F.band(trim, chaikin(pts, 3, False), 0.06, "Stripe_Accent", offset=0.004, across=4, step=0.04)
    for pts in (PINSTRIPE, mirror(PINSTRIPE)):
        F.band(trim, chaikin(pts, 3, False), 0.014, "Stripe_Accent", offset=0.004, across=2, step=0.05)
    # registration on the tail boom, reading front to back on the left side and back to front on the right
    F.band(trim, [(-4.35, 0.10), (-2.95, 0.10)], 0.13, "Decal_Registration", offset=0.005, across=5, uv=True, step=0.05)
    F.band(trim, [(-2.95, math.pi - 0.10), (-4.35, math.pi - 0.10)], 0.13, "Decal_Registration", offset=0.005, across=5, uv=True, step=0.05)
    # logo on the cowling sides
    C.band(trim, [(-1.85, 0.62), (-0.35, 0.62)], 0.10, "Decal_Logo", offset=0.005, across=4, uv=True, step=0.05)
    C.band(trim, [(-0.35, math.pi - 0.62), (-1.85, math.pi - 0.62)], 0.10, "Decal_Logo", offset=0.005, across=4, uv=True, step=0.05)

    objs = {"Body": body.build("Body"), "Trim": trim.build("Trim")}

    # main rotor: hub, flexbeams, cuffs and pitch links turn with it; four blades
    hub_z = 3.30
    rotor = Mesh()
    cyl(rotor, "Metal_Dark", 0.20, 0.14, T((0, 0, hub_z)), segs=24)
    revolve(rotor, "Metal_Dark", [(0.001, hub_z + 0.30), (0.08, hub_z + 0.29), (0.15, hub_z + 0.22), (0.17, hub_z + 0.10), (0.001, hub_z + 0.06)],
            (0, 0, 0), (0, 0, 1), segs=24)
    for k in range(4):
        a = math.pi / 4 + k * HALF
        d = Vector((math.cos(a), math.sin(a), 0))
        box(rotor, "Metal_Dark", (0.62, 0.13, 0.05), T(d * 0.40 + Vector((0, 0, hub_z)), (0, 0, a)), bevel=0.015)
        box(rotor, "Blade", (0.42, 0.20, 0.09), T(d * 0.62 + Vector((0, 0, hub_z + 0.01)), (0, 0, a)), bevel=0.03)
        tube(rotor, "Metal", [d * 0.20 + Vector((0, 0, 3.05)), d * 0.24 + Vector((0, 0, hub_z - 0.02))], 0.012, segs=6)
    objs["MainRotor"] = rotor.build("MainRotor", origin=(0, 0, hub_z))

    span0, span1, chord = 0.78, 5.10, 0.30
    for k in range(4):
        a = math.pi / 4 + k * HALF
        blade = Mesh()
        secs = []
        for r in list(np.linspace(span0, 4.70, 14)) + list(np.linspace(4.78, span1, 6)):
            tip = max(0.0, (r - 4.70) / (span1 - 4.70))
            c = chord * (1 - 0.45 * tip ** 1.6)
            sweep = 0.10 * tip ** 2                          # the parabolic tip sweeps back
            pitch = math.radians(9.0 - 7.5 * (r - span0) / (span1 - span0))
            sec = []
            for ch_, th_ in airfoil(c, 0.12, n=9, le_at=0.25):
                # clockwise from above, so the leading edge faces -y on a blade along +x
                yy, zz = ch_ + sweep, th_
                yy, zz = yy * math.cos(pitch) + zz * math.sin(pitch), -yy * math.sin(pitch) + zz * math.cos(pitch)
                sec.append(Vector((r, yy, zz)))
            secs.append(sec)
        loft(blade, "Blade", secs)
        # paint the tip: the last three bays and the tip cap
        nb = len(secs[0])
        for i in range((len(secs) - 4) * nb, (len(secs) - 1) * nb):
            blade.m[i] = "Blade_Tip"
        blade.m[-1] = "Blade_Tip"
        # each blade is built along +x and turned to its azimuth by its node, so the game can flap it about its chord
        ob = blade.build(f"Blade_{k}", parent=objs["MainRotor"])
        ob.location = (0, 0, 0)
        ob.rotation_euler = (0, 0, a)
        objs[f"Blade_{k}"] = ob

    # the ducted tail fan: ten unevenly spaced blades on a hub (uneven spacing spreads the noise)
    fan = Mesh()
    cyl(fan, "Metal_Dark", 0.105, 0.14, T((fc, 0.04, fz), (HALF, 0, 0)), segs=20)
    angles = [0, 30, 72, 108, 144, 180, 210, 252, 288, 324]
    for adeg in angles:
        a = math.radians(adeg)
        mid = (0.105 + rd - 0.01) / 2
        box(fan, "Blade", (rd - 0.115, 0.012, 0.085), T((fc + math.cos(a) * mid, 0.04, fz + math.sin(a) * mid), (0, -a, 0)) @ T(rot=(0.5, 0, 0)))
    objs["TailRotor"] = fan.build("TailRotor", origin=(fc, 0.04, fz))

    anchors = dict(lights)
    anchors.update({"Seat_Pilot": (2.02, -0.40, 1.18), "Door": (1.80, -1.95, 0.0), "Searchlight": (1.38, -0.42, 0.54),
                    "Landing_Light": (3.50, 0, 0.76)})
    for k, p in anchors.items():
        objs[k] = empty(k, p)
    info = {"length_m": 10.7, "rotor_radius_m": span1, "rotor_hub": [0, hub_z, 0], "tail_rotor": [0.04, fz, fc], "duct_radius_m": rd}
    return objs, info


# ------------------------------------------------------------ ferry
# A double-ended harbour ferry: the same at both ends, so she reverses out of a wharf
# instead of turning. Origin at the waterline amidships; x runs to one end ("A").
HULL_L, HULL_B, KEEL, DECK = 17.0, 4.8, -1.25, 1.55     # half-length, half-beam, keel and deck heights (m)
HULL_P = 2.6                                            # plan superellipse exponent: rounded, fairly fine ends


def hull_surface():
    def plan(a):
        c, s = math.cos(a), math.sin(a)
        e = 2 / HULL_P
        return HULL_L * math.copysign(abs(c) ** e, c), HULL_B * math.copysign(abs(s) ** e, s)

    def sheer(a):
        return DECK + 0.30 * (plan(a)[0] / HULL_L) ** 2

    def S(a, z):
        x, y = plan(a)
        q = min(1.0, max(0.0, (DECK - z) / (DECK - KEEL)))
        ky = (1 - q ** 2.4) ** (1 / 2.4) + 0.035 * max(0.0, z) / DECK     # round bilge, a little flare above the water
        kx = 1 - 0.24 * q ** 1.7                                        # the ends rake in towards the keel
        return Vector((x * kx, y * ky, z))
    return Surface(S, lambda a, z, p: Vector((p.x * 0.3, p.y, 0))), plan, sheer


def rounded_rect(hl, hw, rc, step=0.3):
    """A rounded rectangle's outline, anticlockwise from above, as points (x, y) about 'step' apart."""
    pts = []
    corners = [(hl - rc, hw - rc, 0), (-(hl - rc), hw - rc, HALF), (-(hl - rc), -(hw - rc), math.pi), (hl - rc, -(hw - rc), 3 * HALF)]
    for k, (cx, cy, a0) in enumerate(corners):
        n = max(2, int(math.ceil(rc * HALF / step)))
        pts += [(cx + rc * math.cos(a0 + HALF * t / n), cy + rc * math.sin(a0 + HALF * t / n)) for t in range(n + 1)]
        nx, ny, _ = corners[(k + 1) % 4]
        L = math.hypot(nx - (cx + rc * math.cos(a0 + HALF)), ny - (cy + rc * math.sin(a0 + HALF)))
        m = int(L // step)
        ex, ey = cx + rc * math.cos(a0 + HALF), cy + rc * math.sin(a0 + HALF)
        tx, ty = nx + rc * math.cos(a0 + HALF), ny + rc * math.sin(a0 + HALF)
        pts += [(ex + (tx - ex) * i / (m + 1), ey + (ty - ey) * i / (m + 1)) for i in range(1, m + 1)]
    return pts


def resample(poly, cuts):
    """Insert points into a closed polyline at the arc lengths in `cuts`; returns (points, arc length of each)."""
    seg = [math.dist(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))]
    cum = np.concatenate([[0], np.cumsum(seg)])
    us = sorted(set([round(u, 4) for u in cum[:-1]] + [round(u % cum[-1], 4) for u in cuts]))
    out = []
    for u in us:
        i = min(int(np.searchsorted(cum, u, side="right")) - 1, len(poly) - 1)
        t = (u - cum[i]) / seg[i] if seg[i] else 0
        a, b = poly[i], poly[(i + 1) % len(poly)]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out, us, cum[-1]


def cabin(mesh, outline, z0, z1, openings, wall, inner, glass="Window", thick=0.08):
    """Walls round a closed outline from z0 to z1 with rectangular openings, each
    (u0, u1, zb, zt) in arc length and height, glazed halfway through the wall."""
    cuts = [u for o in openings for u in o[:2]]
    pts, us, per = resample(outline, cuts)
    n = len(pts)
    zs = sorted(set([z0, z1] + [o[2] for o in openings] + [o[3] for o in openings]))
    norm = []
    for i in range(n):
        a, b = pts[i - 1], pts[(i + 1) % n]
        tx, ty = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, ty)
        norm.append((ty / L, -tx / L))         # outward for an anticlockwise outline

    def P(i, z, d=0.0):
        return (pts[i][0] - norm[i][0] * d, pts[i][1] - norm[i][1] * d, z)

    def opening(um, zm):
        for u0, u1, zb, zt in openings:
            uu = um if u0 <= u1 else (um if um >= u0 else um + per)
            if (u0 <= uu <= (u1 if u1 >= u0 else u1 + per)) and zb <= zm <= zt:
                return True
        return False
    hole = {}
    for i in range(n):
        u0, u1 = us[i], (us[i + 1] if i + 1 < n else per)
        for r in range(len(zs) - 1):
            hole[(i, r)] = opening((u0 + u1) / 2, (zs[r] + zs[r + 1]) / 2)
    O = {(i, r): mesh.vert(P(i, zs[r])) for i in range(n) for r in range(len(zs))}
    I = {(i, r): mesh.vert(P(i, zs[r], thick)) for i in range(n) for r in range(len(zs))}
    for (i, r), h in hole.items():
        i2 = (i + 1) % n
        if h:
            g = [mesh.vert(P(k, zs[rr], thick / 2)) for k, rr in ((i, r), (i2, r), (i2, r + 1), (i, r + 1))]
            mesh.face(g, glass, False)
            continue
        mesh.face([O[(i, r)], O[(i2, r)], O[(i2, r + 1)], O[(i, r + 1)]], wall, True)
        mesh.face([I[(i, r + 1)], I[(i2, r + 1)], I[(i2, r)], I[(i, r)]], inner, True)
        # reveals where this cell borders an opening
        if r + 1 < len(zs) - 1 and hole[(i, r + 1)]:
            mesh.face([O[(i, r + 1)], O[(i2, r + 1)], I[(i2, r + 1)], I[(i, r + 1)]], wall, False)
        if r > 0 and hole[(i, r - 1)]:
            mesh.face([I[(i, r)], I[(i2, r)], O[(i2, r)], O[(i, r)]], wall, False)
        if hole[(i2, r)]:
            mesh.face([O[(i2, r)], I[(i2, r)], I[(i2, r + 1)], O[(i2, r + 1)]], wall, False)
        if hole[((i - 1) % n, r)]:
            mesh.face([I[(i, r)], O[(i, r)], O[(i, r + 1)], I[(i, r + 1)]], wall, False)
    top = len(zs) - 1
    for i in range(n):  # cap the wall top
        i2 = (i + 1) % n
        mesh.face([O[(i, top)], O[(i2, top)], I[(i2, top)], I[(i, top)]], wall, False)
    return pts, per


def window_band(per, zb, zt, pane=1.15, post=0.22, doors=(), door_z=None, start=0.0):
    """Openings round a cabin: panes `pane` wide between posts, doors (u0, u1) full height."""
    out, u = [], start + post
    while u + pane <= start + per - post / 2:
        if not any(d0 - post < u + pane and u < d1 + post for d0, d1 in doors):
            out.append((u, u + pane, zb, zt))
        u += pane + post
    out += [(d0, d1, door_z, zt) for d0, d1 in doors]
    return out


def slab(mesh, outline, z0, z1, top, side, bottom):
    """A flat plate with the outline's shape."""
    n = len(outline)
    lo = [mesh.vert((x, y, z0)) for x, y in outline]
    hi = [mesh.vert((x, y, z1)) for x, y in outline]
    mesh.face(hi, top, False)
    mesh.face(lo[::-1], bottom, False)
    for i in range(n):
        i2 = (i + 1) % n
        mesh.face([lo[i], lo[i2], hi[i2], hi[i]], side, True)


def railing(mesh, path, z, h=1.05, spacing=1.1, closed=True, mat="Rail"):
    pts = path + ([path[0]] if closed else [])
    cum = [0.0]
    for a, b in zip(pts[:-1], pts[1:]):
        cum.append(cum[-1] + math.dist(a, b))
    for frac, r in ((1.0, 0.035), (0.55, 0.018), (0.15, 0.018)):
        tube(mesh, mat, [(x, y, z + h * frac) for x, y in pts], r, segs=6 if r < 0.03 else 8, caps=not closed)
    for u in np.arange(0.0, cum[-1] - (0.3 if closed else -0.01), spacing):
        i = min(int(np.searchsorted(cum, u, side="right")) - 1, len(pts) - 2)
        t = (u - cum[i]) / max(1e-9, cum[i + 1] - cum[i])
        x, y = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t
        cyl(mesh, mat, 0.026, h, T((x, y, z + h / 2)), segs=6)


def offset_outline(pts, d):
    n = len(pts)
    out = []
    for i in range(n):
        a, b = pts[i - 1], pts[(i + 1) % n]
        tx, ty = b[0] - a[0], b[1] - a[1]
        L = math.hypot(tx, ty)
        out.append((pts[i][0] + ty / L * d, pts[i][1] - tx / L * d))
    return out


def build_ferry():
    L = FERRY_LIVERIES["harbour"]
    material("Hull", L["hull"], 0.35, 0.0, coat=0.6)
    material("Band", L["band"], 0.35, 0.1, coat=0.6)
    material("Boot", L["boot"], 0.7)
    material("Trim", L["trim"], 0.45)
    material("Cabin", L["cabin"], 0.42, coat=0.3)
    material("Deck", L["deck"], 0.85)
    material("Bulwark", L["cabin"], 0.45, cull=False)
    material("Fender", "#141516", 0.75)
    material("Window", "#1b2830", 0.05, 0.0, alpha=0.55)
    material("Interior", "#3d3a36", 0.85, cull=False)
    material("Seat", "#2f4f6b", 0.7)
    material("Bench", "#8a5a36", 0.7)
    material("Rail", "#e9e7e1", 0.3, 0.6)
    material("Metal_Dark", "#2a2e33", 0.38, 0.75)
    material("Buoy", "#f2601e", 0.5)
    material("Raft", "#f1f1ee", 0.5)
    material("Light_Cabin", "#f3eadc", 0.4, emit="#ffe2b3")
    material("Light_Red", "#b3121a", 0.2, emit="#ff2a2a")
    material("Light_Green", "#0f8a3a", 0.2, emit="#2aff6a")
    material("Light_White", "#d8dde0", 0.15, emit="#ffffff")
    material("Flag", "#c8102e", 0.8, cull=False)
    material("Decal_Name", "#ffffff", 0.4, alpha=0.999)

    H, plan, sheer = hull_surface()
    body, trim = Mesh(), Mesh()
    alphas = list(np.linspace(0, TAU, 200, endpoint=False))
    zs = [KEEL + 0.02, -1.1, -0.9, -0.65, -0.35, -0.12, 0.0, 0.12, 0.42, 0.75, 1.05, 1.25, 1.42, DECK]

    def hull_mat(a, z):
        return "Boot" if z < 0 else "Trim" if z < 0.12 else "Band" if 1.05 <= z < 1.25 else "Hull"
    # rows at fixed heights so the waterline and the band are crisp; the top row follows the sheer
    Hs = Surface(lambda t, a: H(a, zs[int(t)] + (zs[int(t) + 1] - zs[int(t)]) * (t - int(t))) if t < len(zs) - 2
                 else H(a, zs[-2] + (sheer(a) - zs[-2]) * (t - len(zs) + 2)), lambda t, a, p: H.out(a, 0, p))
    Hs.grid(body, list(range(len(zs))), alphas, lambda t, a: hull_mat(a, zs[int(t)]), period=TAU)
    # flat bottom and the deck
    keel = [body.vert(H(a, KEEL + 0.02)) for a in alphas]
    body.face(keel[::-1], "Boot", False)
    top = [(H(a, sheer(a))) for a in alphas]
    c = body.vert((0, 0, DECK))
    ring = [body.vert(p) for p in top]
    for k in range(len(ring)):
        body.face([c, ring[k], ring[(k + 1) % len(ring)]], "Deck", False)
    # rubbing strake round the deck edge
    edge = [(p.x * 1.004, p.y * 1.012, p.z - 0.10) for p in top]
    tube(body, "Fender", edge + [edge[0]], 0.12, segs=10, caps=False)

    # main cabin, glazed all round with a pair of doors each side
    out1 = rounded_rect(10.8, 4.0, 3.0)
    per1 = sum(math.dist(out1[i], out1[(i + 1) % len(out1)]) for i in range(len(out1)))
    # arc length of x = +-8 on each side (the outline starts on the +x end and runs anticlockwise)
    side_u = lambda x, left: (3.0 * HALF + (7.8 - x)) if left else (9.0 * HALF + 2 * 7.8 + 2 * 1.0 + (7.8 + x))
    doors = [(side_u(x, left) - 0.75, side_u(x, left) + 0.75) for x in (7.0, -7.0) for left in (True, False)]
    doors = [(min(a, b), max(a, b)) for a, b in doors]
    cabin(body, out1, 1.50, 3.95, window_band(per1, 2.45, 3.55, doors=doors, door_z=1.62), "Cabin", "Interior")
    slab(body, rounded_rect(11.6, 4.38, 3.4), 3.95, 4.18, "Deck", "Trim", "Trim")
    # seats in rows either side of the aisle, and the lights over them
    for x in np.arange(-9.0, 9.01, 1.05):
        if abs(abs(x) - 7.0) < 0.9:
            continue
        for y in (-2.1, 2.1):
            box(body, "Seat", (0.45, 2.6, 0.42), T((x, y, 1.80)))
            box(body, "Seat", (0.10, 2.6, 0.55), T((x - 0.22, y, 2.25), (0, -0.12, 0)))
    for y in (-1.6, 1.6):
        box(body, "Light_Cabin", (17.0, 0.18, 0.03), T((0, y, 3.93)))

    # upper deck: a smaller cabin, open ends with benches, railings, lifebuoys and life rafts
    out2 = rounded_rect(7.2, 3.5, 2.4)
    per2 = sum(math.dist(out2[i], out2[(i + 1) % len(out2)]) for i in range(len(out2)))
    cabin(body, out2, 4.12, 6.20, window_band(per2, 4.95, 5.95, pane=1.3, post=0.2), "Cabin", "Interior")
    slab(body, rounded_rect(8.4, 3.85, 2.8), 6.20, 6.38, "Trim", "Trim", "Trim")
    for x in np.arange(-5.6, 5.61, 1.25):
        for y in (-1.8, 1.8):
            box(body, "Seat", (0.45, 2.2, 0.42), T((x, y, 4.42)))
            box(body, "Seat", (0.10, 2.2, 0.5), T((x - 0.22, y, 4.84), (0, -0.12, 0)))
    deck2 = offset_outline(rounded_rect(11.6, 4.38, 3.4, step=0.6), -0.12)
    railing(body, deck2, 4.18)
    for sx in (1, -1):
        for x in (8.4, 9.6, 10.6):
            box(body, "Bench", (0.45, 4.2, 0.08), T((x * sx, 0, 4.62)))
            box(body, "Bench", (0.06, 4.2, 0.42), T(((x + 0.22) * sx, 0, 4.88)))
            for y in (-1.9, 0, 1.9):
                box(body, "Metal_Dark", (0.35, 0.05, 0.44), T((x * sx, y, 4.40)))
    for sx in (1, -1):
        for sy in (1, -1):
            for x in (3.4, -3.4):
                revolve(body, "Buoy", [(0.30 + 0.07 * math.cos(t), 0.07 * math.sin(t)) for t in np.linspace(0, TAU, 10, endpoint=False)][::-1],
                        (x + sx * 0.2, sy * 4.30, 4.85), (0, 1, 0), segs=16)
        for x in (5.0, -5.0):
            cyl(body, "Raft", 0.33, 1.2, T((x, sx * 3.1, 6.62), (0, HALF, 0)), segs=14)
            for d in (-0.3, 0.3):
                cyl(body, "Metal_Dark", 0.335, 0.05, T((x + d, sx * 3.1, 6.62), (0, HALF, 0)), segs=14)

    # bulwarks round the open ends of the main deck, with a rail on top
    for sx in (1, -1):
        pts = [(p.x * 0.985, p.y * 0.985, p.z) for a, p in zip(alphas, top) if p.x * sx > 10.4]
        pts.sort(key=lambda p: math.atan2(p[1], p[0] * sx))
        lo = [body.vert(p) for p in pts]
        hi = [body.vert((p[0], p[1], p[2] + 0.95)) for p in pts]
        for i in range(len(pts) - 1):
            body.face([lo[i], lo[i + 1], hi[i + 1], hi[i]], "Bulwark", True)
        tube(body, "Trim", [(p[0], p[1], p[2] + 0.97) for p in pts], 0.05, segs=8)
        for x in (11.6, 12.8, 14.0):
            box(body, "Bench", (0.45, 5.0 if x < 13 else 3.6, 0.08), T((x * sx, 0, 2.02)))
            box(body, "Bench", (0.06, 5.0 if x < 13 else 3.6, 0.42), T(((x + 0.22) * sx, 0, 2.28)))

    # wheelhouse on top, glazed all round, with its mast
    out3 = rounded_rect(2.4, 2.1, 1.0, step=0.25)
    per3 = sum(math.dist(out3[i], out3[(i + 1) % len(out3)]) for i in range(len(out3)))
    cabin(body, out3, 6.36, 8.05, window_band(per3, 7.05, 7.85, pane=0.9, post=0.14), "Cabin", "Interior")
    slab(body, rounded_rect(2.65, 2.35, 1.2, step=0.25), 8.05, 8.22, "Trim", "Trim", "Trim")
    for sx in (1, -1):
        box(body, "Metal_Dark", (0.4, 1.6, 0.9), T((1.9 * sx, 0, 6.85)))       # the consoles at each end
    cyl(body, "Rail", 0.07, 3.0, T((0, 0, 9.7)), segs=10)
    box(body, "Rail", (0.08, 1.2, 0.08), T((0, 0, 9.0)))
    for y in (-0.6, 0.6):
        cyl(body, "Rail", 0.025, 1.0, T((0, y, 8.6)), segs=6)
    lights = {"Side_Left": (0, 2.18, 7.35), "Side_Right": (0, -2.18, 7.35), "Masthead": (0.0, 0, 11.27)}
    sphere(body, "Light_White", 0.08, T(lights["Masthead"]), segs=10, rings=6)
    for k in ("Side_Left", "Side_Right"):
        box(body, "Metal_Dark", (0.5, 0.06, 0.3), T((0, lights[k][1] * 1.01, lights[k][2])))
        sphere(body, "Light_White", 0.06, T((0, lights[k][1] * 1.04, lights[k][2])), segs=8, rings=6)

    # vessel names on the hull near each end, both sides, reading left to right from outside
    def name_patch(xc, left):
        a0 = math.acos(min(1.0, (abs(xc) / HULL_L) ** (HULL_P / 2)))
        a = (a0 if xc > 0 else math.pi - a0) if left else (TAU - a0 if xc > 0 else math.pi + a0)
        # +-1.6 m along the hull
        da = 1.6 * 2e-3 / (H(a + 1e-3, 0.68) - H(a - 1e-3, 0.68)).length
        H.band(trim, [(a - da, 0.68), (a + da, 0.68)], 0.24, "Decal_Name", offset=0.012, across=5, uv=True, step=0.1)
    for xc in (12.0, -12.0):
        for left in (True, False):
            name_patch(xc, left)

    objs = {"Body": body.build("Body"), "Trim": trim.build("Trim")}
    radar = Mesh()
    cyl(radar, "Metal_Dark", 0.12, 0.2, T((0, 0, 9.92)), segs=12)
    box(radar, "Raft", (0.22, 1.9, 0.14), T((0, 0, 10.08)), bevel=0.04)
    objs["Radar"] = radar.build("Radar", origin=(0, 0, 9.92))
    flag = Mesh()
    w, h = 1.1, 0.7
    fx = [flag.vert((-0.05 - w * k / 6, 0, 10.4 + h * r)) for r in (0, 1) for k in range(7)]
    for k in range(6):
        flag.face([fx[k], fx[k + 1], fx[k + 8], fx[k + 7]], "Flag", False)
    objs["Flag"] = flag.build("Flag", origin=(0, 0, 10.4))

    anchors = dict(lights)
    anchors.update({"Deck_Passenger": (9.0, -1.6, 4.18), "Bow_A": (HULL_L, 0, 0), "Bow_B": (-HULL_L, 0, 0)})
    for k, p in anchors.items():
        objs[k] = empty(k, p)
    # the waterline (x forward, y left), for the foam the game draws round the hull
    waterline = [[round(x, 2), round(y, 2)] for x, y in (plan(a) for a in np.linspace(0, TAU, 48, endpoint=False))]
    info = {"length_m": 2 * HULL_L, "beam_m": 2 * HULL_B, "deck_m": DECK, "upper_deck_m": 4.18, "waterline": waterline}
    return objs, info


# ------------------------------------------------------------ the shared pipeline: AO bake, LOD, export
def select(objs):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def bake_ao(meshes, hidden, size, distance, samples):
    """One ambient-occlusion atlas for all `meshes`, wired into their materials as glTF occlusion."""
    t = time.time()
    select(meshes)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.002)
    bpy.ops.uv.pack_islands(margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("AO", size, size, alpha=False)
    mats = {m for o in meshes for m in o.data.materials}
    for m in mats:
        nt = m.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        nt.nodes.active = n
    for o in hidden:
        o.hide_render = True
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    world = bpy.data.worlds.get("Bake") or bpy.data.worlds.new("Bake")
    world.light_settings.distance = distance
    sc.world = world
    bpy.ops.object.bake(type="AO", margin=6, use_clear=True)
    for o in hidden:
        o.hide_render = False
    # soften the bake's sampling noise a little
    px = np.array(img.pixels[:], np.float32).reshape(size, size, 4)
    a = px[..., 0]
    blur = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
    px[..., 0] = px[..., 1] = px[..., 2] = 0.35 + 0.65 * blur      # keep some light in the deepest corners
    img.pixels[:] = px.ravel()
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is None:
        group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        group.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    for m in mats:
        nt = m.node_tree
        tex = nt.nodes.active
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
        g = nt.nodes.new("ShaderNodeGroup")
        g.node_tree = group
        nt.links.new(sep.outputs["Red"], g.inputs["Occlusion"])
    print(f"  AO bake {size}px for {len(meshes)} meshes: {time.time() - t:.0f} s")


def lod_copy(ob, name, ratio):
    me = ob.data.copy()
    lo = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(lo)
    lo.location = ob.location
    mod = lo.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = ratio
    select([lo])
    bpy.ops.object.modifier_apply(modifier=mod.name)
    lo.data.validate()
    return lo


def export(objs, path):
    select(list(objs.values()))
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_image_format="JPEG",
                              export_jpeg_quality=82, export_cameras=False, export_lights=False, export_extras=False,
                              export_animations=False)
    print(f"  {os.path.relpath(path, ROOT)}: {os.path.getsize(path) / 1e6:.2f} MB")


def triangles(objs):
    n = 0
    for o in objs:
        if o.type == "MESH":
            o.data.calc_loop_triangles()
            n += len(o.data.loop_triangles)
    return n


# ------------------------------------------------------------ preview and beauty renders
def setup_render(samples=32, res=(1280, 720), sun=(40, 150), strength=1.0):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.get("Sky") or bpy.data.worlds.new("Sky")
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_elevation = math.radians(sun[0])
    sky.sun_rotation = math.radians(sun[1])
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.28 * strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    sc.world = world
    return sc


def camera(name, loc, target, lens=50):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = lens
    cam.location = to_blender(loc)
    d = to_blender(target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def render(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 88
    t = time.time()
    bpy.ops.render.render(write_still=True)
    print(f"  {os.path.relpath(path, ROOT) if path.startswith(ROOT) else path}: {time.time() - t:.0f} s")


def ground_plane(name, size, mat):
    g = bpy.data.objects.new(name, bpy.data.meshes.new(name))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size)
    bm.to_mesh(g.data)
    bm.free()
    g.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(g)
    return g


def sun_lamp(elev, azim, energy=3.4):
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = energy
    sun.data.angle = math.radians(0.6)
    sun.rotation_euler = (math.radians(90 - elev), 0, math.radians(azim))
    bpy.context.scene.collection.objects.link(sun)
    return sun


def water_material():
    m = material("Water", "#0d2f3a", 0.04)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 1.6
    noise.inputs["Detail"].default_value = 6
    b.inputs["Roughness"].default_value = 0.06
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def stage(kind, samples, res):
    """A Cycles set for the beauty shots and previews: sky, sun, and a helipad or open water."""
    setup_render(samples, res, sun=(24, 205) if kind == "helicopter" else (28, 230))
    if kind == "helicopter":
        ground_plane("Ground", 300, material("Asphalt", "#3b3d3f", 0.85))
        pad = Mesh()
        revolve(pad, "Paint_Line", [(9.0, 0.005), (9.0, 0.015), (9.6, 0.015), (9.6, 0.005)][::-1], (0, 0, 0), (0, 0, 1), segs=96, smooth=False)
        for y in (-2.0, 2.0):
            box(pad, "Paint_Line", (5.0, 0.8, 0.02), T((0.5, y, 0.01)))
        box(pad, "Paint_Line", (0.8, 3.2, 0.02), T((0.5, 0, 0.01)))
        material("Paint_Line", "#f2c230", 0.6)
        pad.build("Pad")
        sun_lamp(24, 205)
    else:
        ground_plane("Water", 1500, water_material())
        sun_lamp(28, 230)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["helicopter", "ferry"])
    ap.add_argument("--preview", help="render quick previews into this folder instead of exporting")
    ap.add_argument("--render", action="store_true", help="also render beauty shots into docs/images/vehicles")
    ap.add_argument("--samples", type=int, default=96, help="Cycles samples for the beauty shots")
    ap.add_argument("--bake-samples", type=int, default=128)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    path_json = os.path.join(OUT, "vehicles.json")
    manifest = json.load(open(path_json)) if a.only and os.path.exists(path_json) else {}
    manifest.update({
        "note": "The vehicles every city's game shares, built by blender/build_vehicles.py. A city picks a livery (by name, or "
                "its own colours) and a registration in game.vehicles; 'paint' says which material takes which livery colour.",
        "axes": "+z forward, +y up, +x left; helicopter origin under the mast at the bottom of the skids, ferry origin at the "
                "waterline amidships",
    })
    shots = {"helicopter": [("front34", (8.6, -6.4, 2.6), (-0.6, 0, 1.55), 42), ("side", (0.2, -14.5, 1.9), (-1.0, 0, 1.6), 40),
                            ("rear34", (-12.5, 7.5, 3.6), (-1.4, 0, 1.7), 40), ("top", (-0.5, 0.01, 19), (-0.5, 0, 0), 35),
                            ("cockpit", (5.0, -2.7, 1.9), (2.3, 0, 1.3), 35)],
             "ferry": [("front34", (34, -26, 9), (0, 0, 3), 40), ("side", (0, -48, 5), (0, 0, 3.2), 40),
                       ("end", (40, 4, 6), (0, 0, 3.5), 45), ("deck", (16, -9, 7.5), (4, 0, 4.5), 30)]}
    hero = {"helicopter": ("front34", (9.6, -7.4, 1.9), (-0.9, 0.2, 1.75), 46), "ferry": ("front34", (36, -30, 4.5), (-1, 0, 3.6), 42)}
    for kind in ("helicopter", "ferry"):
        if a.only and a.only != kind:
            continue
        print(kind)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        MAT.clear()
        objs, info = build_helicopter() if kind == "helicopter" else build_ferry()
        if a.preview:
            os.makedirs(a.preview, exist_ok=True)
            stage(kind, min(a.samples, 24), (960, 540))
            for name, loc, tgt, lens in shots[kind]:
                camera("Cam", loc, tgt, lens)
                render(os.path.join(a.preview, f"{kind}_{name}.jpg"))
            continue
        meshes = [o for k, o in objs.items() if o.type == "MESH" and k not in ("Trim", "Flag")]
        bake_ao(meshes, [objs["Trim"]], 2048, 1.0 if kind == "helicopter" else 2.5, a.bake_samples)
        # a decimated copy of the body for distance (the game swaps at 'lod1_m')
        objs["Body_LOD1"] = lod_copy(objs["Body"], "Body_LOD1", 0.14 if kind == "helicopter" else 0.18)
        info["lod1_triangles"] = triangles([objs["Body_LOD1"]])
        info["lod1_m"] = 90 if kind == "helicopter" else 260
        info["triangles"] = triangles([o for k, o in objs.items() if k != "Body_LOD1"])
        export(objs, os.path.join(OUT, f"{kind}.glb"))
        entry = {"file": f"{kind}.glb"}
        if kind == "helicopter":
            entry.update({"default_livery": "survey", "liveries": HELI_LIVERIES,
                          "paint": {"Paint_Primary": "primary", "Paint_Secondary": "secondary", "Stripe_Accent": "accent"},
                          "registrations": REGISTRATIONS, "registration_default": "OEH-3D", "logo": "OPEN EARTH 3D",
                          "rotor_rpm": 395, "tail_rotor_rpm": 3580})
        else:
            entry.update({"default_livery": "bay", "liveries": FERRY_LIVERIES,
                          "paint": {"Hull": "hull", "Band": "band", "Cabin": "cabin", "Bulwark": "cabin", "Trim": "trim",
                                    "Deck": "deck", "Boot": "boot"}})
        entry.update(info)
        manifest[kind] = entry
        if a.render:
            # the full body only, and no blank decal patches (the game writes the names)
            objs["Body_LOD1"].hide_render = True
            for m in MAT.values():
                if m.name.startswith("Decal_"):
                    m.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0
            os.makedirs(DOCS, exist_ok=True)
            stage(kind, a.samples, (1600, 900))
            name, loc, tgt, lens = hero[kind]
            camera("Cam", loc, tgt, lens)
            render(os.path.join(DOCS, f"{kind}.jpg"))
    if not a.preview:
        with open(path_json, "w") as f:
            json.dump(manifest, f, indent=1)
            f.write("\n")
        print(path_json)


if __name__ == "__main__":
    main()
