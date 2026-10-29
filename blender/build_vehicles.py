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
  their chord axis), `TailRotor` (spins about +x), the pilot's door `Door_Pilot` (it
  turns about an upright line through its origin, with its trim `Trim_Door`), and
  empties marking the way in (`Door`, `Step`, `Seat_Pilot`), the pilot's eyes, the
  lights and the searchlight.
- `ferry.glb`: a double-ended harbour ferry, 34 m long and 9.6 m in the beam, with a
  glazed main cabin and its seats, an open upper deck with railings and lifebuoys, a
  wheelhouse and a radar mast. Nodes: `Radar` (spins about +y), `Flag`, and empties for
  the passenger spot and the lights.

Both have a `Body_LOD1`, a decimated copy of the body for distance.
- `ferry_river.glb`: a double-ended river shuttle, 22 m, with the ferry's nodes.
- `cars.glb`: the traffic (a sedan, a taxi, a hatchback, an SUV, a van and a city bus),
  each with two decimated copies (`_LOD1`, `_LOD2`) and its occlusion in the vertex
  colours. Each car but the bus has a cabin seen through its glass (`<name>_Cabin`:
  seats, a dashboard, and the steering wheel `<name>_Steering`, which turns about its
  local +z), for the cars people get into (web/game/cars.js).
- `vehicles.json`: liveries, registrations by country, which material takes which
  livery colour, sizes and triangle counts, and each car's length, width, height,
  axles, wheels, seats and steering wheel.

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

    def grid(self, mesh, us, vs, mat_of, period=None, offset=0.0, flip=False, smooth=True, at=None):
        """Quads over the parameter grid us x vs (vs wraps if `period` is set). mat_of(u, v)
        names each cell's material, or None for a hole. Faces point outward (inward if flip).
        `at` moves grid points, {(i, j): (u, v)}, so that a cut can follow a curve."""
        ids = {}

        def P(i, j):
            if (i, j) not in ids:
                u, v = at.get((i, j), (us[i], vs[j])) if at else (us[i], vs[j])
                p = self.S(u, v)
                if offset:
                    p = p + self.normal(u, v) * offset
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
                if n.length < 1e-12:  # a cell that closes to a point (a car's tail): the diagonals still give its facing
                    n = (Vector(mesh.v[q[2]]) - a).cross(c - b)
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


def nearest_on(poly, x, y, ky=1.0):
    """The point of a closed polyline nearest (x, y), measuring y in units of ky."""
    best, out = None, None
    for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1]):
        dx, dy = bx - ax, (by - ay) * ky
        t = min(1.0, max(0.0, ((x - ax) * dx + (y - ay) * ky * dy) / (dx * dx + dy * dy or 1)))
        qx, qy = ax + dx * t, ay + (by - ay) * t
        d = (qx - x) ** 2 + ((qy - y) * ky) ** 2
        if best is None or d < best:
            best, out = d, (qx, qy)
    return out


def split(mesh, keep):
    """The faces of a mesh whose centre passes keep(centre), and the rest, as two meshes."""
    parts = (Mesh(), Mesh())
    maps = ({}, {})
    for ids, m, s, uv in zip(mesh.f, mesh.m, mesh.s, mesh.uv):
        k = 0 if keep(sum((Vector(mesh.v[i]) for i in ids), Vector()) / len(ids)) else 1
        out, idx = parts[k], maps[k]
        for i in ids:
            if i not in idx:
                idx[i] = out.vert(mesh.v[i])
        out.face([idx[i] for i in ids], m, s, uv)
    return parts


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


# glazing in (x, theta) for the right side; the left side mirrors theta -> pi - theta. The windscreen
# stays two grid cells clear of the pilot's door, so their cuts never share a grid point
WINDOWS = {
    "windscreen": [(2.51, HALF - 0.035), (2.51, 1.02), (2.79, 0.55), (3.05, -0.06), (3.36, -0.30), (3.58, -0.30),
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
    # the cabin's lining and the sides of its openings: the same, but left out of the AO bake, which
    # smudges the narrow strips between the windows and the door (see bake_ao's `plain`)
    material("Lining", "#34373b", 0.85, cull=False)
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
    nt = len(ths)

    # Cells of the grid, and the grid points with cells of two kinds round them. Those points move
    # onto the outline between the kinds, so the cuts follow the curves rather than the grid's steps.
    cell = lambda i, j: ((xs[i] + xs[i + 1]) / 2, (ths[j] + (ths[j + 1] if j + 1 < nt else ths[0] + TAU)) / 2)
    cells = [(i, j) for i in range(len(xs) - 1) for j in range(nt)]

    def edge_points(member):
        for i in range(len(xs)):
            for j in range(nt):
                near = [(i + di, (j + dj) % nt) for di in (-1, 0) for dj in (-1, 0) if 0 <= i + di < len(xs) - 1]
                if 0 < sum(c in member for c in near) < len(near):
                    yield i, j

    def edges(member):
        """The grid edges between a cell in `member` and one that is not: (cell, other, its two points)."""
        for i, j in member:
            for (ni, nj), ab in (((i - 1, j), ((i, j), (i, j + 1))), ((i + 1, j), ((i + 1, j), (i + 1, j + 1))),
                                 ((i, j - 1), ((i, j), (i + 1, j))), ((i, j + 1), ((i, j + 1), (i + 1, j + 1)))):
                if 0 <= ni < len(xs) - 1 and (ni, nj % nt) not in member:
                    yield (i, j), (ni, nj % nt), ab

    # the windows' edges: the glass, and the openings in the lining behind it, end on the outlines
    panes = {c for c in cells if glass(*cell(*c))}
    snap = {}
    for i, j in edge_points(panes):
        best = None
        for poly in win.values():
            for th in (ths[j], ths[j] - TAU):
                q = nearest_on(poly, xs[i], th, 0.8)
                d = (q[0] - xs[i]) ** 2 + ((q[1] - th) * 0.8) ** 2
                if best is None or d < best[0]:
                    best = (d, q)
        snap[(i, j)] = best[1]

    # The pilot's door (front right) is a part of its own, hinged at its front edge, so the game
    # can open it: its cells come out of the skin and the lining, cut along its seam
    door_poly = chaikin(SEAMS["front_door"][0], 2)

    def in_door(x, th):
        return inside(door_poly, x, (th + math.pi) % TAU - math.pi)

    in_d = {c for c in cells if in_door(*cell(*c))}
    door_edge = set(edge_points(in_d))
    assert not door_edge & set(snap), "a window comes within a grid cell of the pilot's door: their cuts would tear each other"
    for i, j in door_edge:
        snap[(i, j)] = nearest_on(door_poly, xs[i], (ths[j] + math.pi) % TAU - math.pi, 0.8)
    body, door = Mesh(), Mesh()
    F.grid(body, xs, ths, lambda x, th: None if in_door(x, th) else paint(x, th), period=TAU, at=snap)
    F.grid(door, xs, ths, lambda x, th: paint(x, th) if in_door(x, th) else None, period=TAU, at=snap)

    # the cabin lining, 3.5 cm inside the skin, open behind the glass, and the bulkhead behind it
    lin_xs = [x for x in xs if CABIN_X[0] <= x <= CABIN_X[1]]
    Fin = Surface(lambda x, th: F(x, th) - F.normal(x, th) * 0.035, F.out)
    i0 = xs.index(lin_xs[0])
    lsnap = {(i - i0, j): p for (i, j), p in snap.items() if 0 <= i - i0 < len(lin_xs)}
    lining = lambda x, th: None if glass(x, th) else "Lining"
    Fin.grid(body, lin_xs, ths, lambda x, th: None if in_door(x, th) else lining(x, th), period=TAU, flip=True, at=lsnap)
    Fin.grid(door, lin_xs, ths, lambda x, th: lining(x, th) if in_door(x, th) else None, period=TAU, flip=True, at=lsnap)

    # the sides of the openings, from the skin to the lining: round each window, facing the glass;
    # the door's edge, and the frame round its opening with a rubber seal
    at = lambda i, j: snap.get((i, j % nt), (xs[i], ths[j % nt]))
    centre = lambda c: F(*cell(*c))

    def rim(mesh, a, b, mat, facing):
        quad = [F(*at(*a)), F(*at(*b)), Fin(*at(*b)), Fin(*at(*a))]
        q = [mesh.vert(p) for p in quad]
        mesh.face(q if (quad[1] - quad[0]).cross(quad[3] - quad[0]).dot(facing) > 0 else q[::-1], mat, False)
    for c, other, (a, b) in edges(panes):
        if lin_xs[0] <= cell(*c)[0] <= lin_xs[-1]:
            rim(door if c in in_d else body, a, b, "Lining", centre(c) - centre(other))
    for c, other, (a, b) in edges(in_d):
        rim(door, a, b, "Lining", centre(other) - centre(c))
        rim(body, a, b, "Gasket", centre(c) - centre(other))
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
        return under_skin(Vector((x, -cw(x) * math.copysign(abs(c) ** e, c), cz(x) + chh(x) * math.copysign(abs(s) ** e, s))))

    def under_skin(p):
        """The cowling's flanks run down into the fuselage: held just under the roof's skin there,
        above the cabin lining, so they don't hang into the cabin over the seats."""
        zc, w, ht, hb, e_t, e_b = params(p.x)
        e = 2 / (e_t if p.z >= zc else e_b)
        k = ((abs(p.y) / w) ** (2 / e) + (abs(p.z - zc) / (ht if p.z >= zc else hb)) ** (2 / e)) ** (e / 2)  # 1 on the skin
        if k >= 0.995:
            return p
        f = 0.995 / max(k, 1e-6)
        return Vector((p.x, p.y * f, zc + (p.z - zc) * f))
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
    # door handles (the pilot's on the door) and the sliding door rail
    for side in (1, -1):
        for x in (1.42, -0.32):
            p = F(x, 0.02 if side > 0 else math.pi - 0.02)
            box(door if side > 0 and x > 0 else body, "Metal_Dark", (0.16, 0.03, 0.035),
                T(p + F.normal(x, 0.02 if side > 0 else math.pi - 0.02) * 0.012), bevel=0.008)

    # trim: window gaskets, seams, livery stripes, decal patches (lifted off the skin, outside the AO bake).
    # What lies on the pilot's door goes with it: its window's gaskets, its seam and its part of the stripes
    door_trim = Mesh()
    door_x = (min(x for x, _ in door_poly), max(x for x, _ in door_poly))

    def on_door(p):  # a point on the skin, or just off it: is it on the pilot's door?
        if p.y > 0 or not door_x[0] - 0.2 < p.x < door_x[1] + 0.2:
            return False
        zc, w, ht, hb, e_t, e_b = params(p.x)
        up = p.z >= zc
        e = 2 / (e_t if up else e_b)
        c = min(1.0, -p.y / w) ** (1 / e)
        s = min(1.0, abs(p.z - zc) / (ht if up else hb)) ** (1 / e)
        return in_door(p.x, math.atan2(s if up else -s, c))
    # gaskets on both faces of the skin, framing the panes outside and in
    for name, poly in win.items():
        for off in (0.006, -0.006):
            F.band(door_trim if name == "front_door" else trim, poly, 0.036, "Gasket", offset=off, across=2, closed=True, step=0.025)
    for name, (poly, closed) in SEAMS.items():
        for k, pts in enumerate((poly, mirror(poly))):
            F.band(door_trim if name == "front_door" and k == 0 else trim, chaikin(pts, 2, closed) if closed and name != "tail_cone" else pts,
                   0.006, "Seam", offset=0.003, across=2, closed=closed, step=0.04)
    stripes = Mesh()
    for pts in (STRIPE, mirror(STRIPE)):
        F.band(stripes, chaikin(pts, 3, False), 0.06, "Stripe_Accent", offset=0.004, across=4, step=0.04)
    for pts in (PINSTRIPE, mirror(PINSTRIPE)):
        F.band(stripes, chaikin(pts, 3, False), 0.014, "Stripe_Accent", offset=0.004, across=2, step=0.05)
    on, off = split(stripes, on_door)
    door_trim.merge(on)
    trim.merge(off)
    # registration on the tail boom, reading front to back on the left side and back to front on the right
    F.band(trim, [(-4.35, 0.10), (-2.95, 0.10)], 0.13, "Decal_Registration", offset=0.005, across=5, uv=True, step=0.05)
    F.band(trim, [(-2.95, math.pi - 0.10), (-4.35, math.pi - 0.10)], 0.13, "Decal_Registration", offset=0.005, across=5, uv=True, step=0.05)
    # logo on the cowling sides
    C.band(trim, [(-1.85, 0.62), (-0.35, 0.62)], 0.10, "Decal_Logo", offset=0.005, across=4, uv=True, step=0.05)
    C.band(trim, [(-0.35, math.pi - 0.62), (-1.85, math.pi - 0.62)], 0.10, "Decal_Logo", offset=0.005, across=4, uv=True, step=0.05)

    # the door's hinge line: upright, just ahead of and outboard of its front edge, so that every part
    # of the door swings out and back as it opens, clear of the pillar in front of it
    dv = [Vector(v) for v in door.v]
    front = max(v.x for v in dv)
    hinge = Vector((front + 0.01, min(v.y for v in dv if v.x > front - 0.35) - 0.015, min(v.z for v in dv)))
    objs = {"Body": body.build("Body"), "Trim": trim.build("Trim"), "Door_Pilot": door.build("Door_Pilot", origin=hinge)}
    objs["Trim_Door"] = door_trim.build("Trim_Door", origin=hinge, parent=objs["Door_Pilot"])

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

    # the way in: stand by the door (Door), up onto the step on the front cross tube (Step), and sit
    # down: Seat_Pilot is on the floor under the pilot's hips, where a seated person's feet rest
    # (the seat's cushion is 38 cm above it), and Eye_Pilot is where the pilot's eyes are
    anchors = dict(lights)
    anchors.update({"Seat_Pilot": (1.93, -0.40, zf), "Eye_Pilot": (2.02, -0.40, 1.90), "Door": (1.45, -1.55, 0.0),
                    "Step": (1.20, -0.90, 0.39), "Searchlight": (1.38, -0.42, 0.54), "Landing_Light": (3.50, 0, 0.76)})
    for k, p in anchors.items():
        objs[k] = empty(k, p)
    info = {"length_m": 10.7, "rotor_radius_m": span1, "rotor_hub": [0, hub_z, 0], "tail_rotor": [0.04, fz, fc], "duct_radius_m": rd,
            # the pilot's door turns about an upright line through its node (model axes: +y up), outward as the angle grows
            "door": {"node": "Door_Pilot", "axis": [0, 1, 0], "open_deg": 70}}
    return objs, info


# ------------------------------------------------------------ ferry
# A double-ended harbour ferry: the same at both ends, so she reverses out of a wharf
# instead of turning. Origin at the waterline amidships; x runs to one end ("A").
HULL_L, HULL_B, KEEL, DECK = 17.0, 4.8, -1.25, 1.55     # half-length, half-beam, keel and deck heights (m)
HULL_P = 2.6                                            # plan superellipse exponent: rounded, fairly fine ends


def hull_surface(hl=HULL_L, hb=HULL_B, keel=KEEL, deck=DECK, p=HULL_P, rise=0.30):
    def plan(a):
        c, s = math.cos(a), math.sin(a)
        e = 2 / p
        return hl * math.copysign(abs(c) ** e, c), hb * math.copysign(abs(s) ** e, s)

    def sheer(a):
        return deck + rise * (plan(a)[0] / hl) ** 2

    def S(a, z):
        x, y = plan(a)
        q = min(1.0, max(0.0, (deck - z) / (deck - keel)))
        ky = (1 - q ** 2.4) ** (1 / 2.4) + 0.035 * max(0.0, z) / deck     # round bilge, a little flare above the water
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


def ferry_materials(L):
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


def build_ferry():
    ferry_materials(FERRY_LIVERIES["harbour"])
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
    info = {"length_m": 2 * HULL_L, "beam_m": 2 * HULL_B, "deck_m": DECK, "upper_deck_m": 4.18, "label_m": 12.2, "waterline": waterline}
    return objs, info


# A double-ended river shuttle, 22 m: low freeboard for the river walls, one long saloon
# glazed floor to roof for the view, open decks at both ends, and a small wheelhouse
# amidships on the roof. Same anchors and paint names as the harbour ferry.
RIVER = dict(hl=11.0, hb=3.3, keel=-0.85, deck=0.95, p=3.0, rise=0.16)


def build_ferry_river():
    ferry_materials(FERRY_LIVERIES["river"])
    R = RIVER
    H, plan, sheer = hull_surface(**R)
    deck = R["deck"]
    body, trim = Mesh(), Mesh()
    alphas = list(np.linspace(0, TAU, 160, endpoint=False))
    zs = [R["keel"] + 0.02, -0.7, -0.5, -0.3, -0.12, 0.0, 0.10, 0.30, 0.52, 0.62, 0.76, deck]

    def hull_mat(a, z):
        return "Boot" if z < 0 else "Trim" if z < 0.10 else "Band" if 0.52 <= z < 0.62 else "Hull"
    Hs = Surface(lambda t, a: H(a, zs[int(t)] + (zs[int(t) + 1] - zs[int(t)]) * (t - int(t))) if t < len(zs) - 2
                 else H(a, zs[-2] + (sheer(a) - zs[-2]) * (t - len(zs) + 2)), lambda t, a, p: H.out(a, 0, p))
    Hs.grid(body, list(range(len(zs))), alphas, lambda t, a: hull_mat(a, zs[int(t)]), period=TAU)
    keel = [body.vert(H(a, R["keel"] + 0.02)) for a in alphas]
    body.face(keel[::-1], "Boot", False)
    top = [H(a, sheer(a)) for a in alphas]
    c = body.vert((0, 0, deck))
    ring = [body.vert(p) for p in top]
    for k in range(len(ring)):
        body.face([c, ring[k], ring[(k + 1) % len(ring)]], "Deck", False)
    edge = [(p.x * 1.004, p.y * 1.014, p.z - 0.08) for p in top]
    tube(body, "Fender", edge + [edge[0]], 0.10, segs=10, caps=False)
    # a second, lower rubbing strake for the river walls
    low = [(q.x, q.y, 0.34) for q in (H(a, 0.34) for a in alphas)]
    tube(body, "Fender", [(x * 1.01, y * 1.03, z) for x, y, z in low] + [(low[0][0] * 1.01, low[0][1] * 1.03, 0.34)], 0.06, segs=8, caps=False)

    # the saloon: posts 0.12 m, panes 1.45 m from a low sill to just under the roof; a door
    # each side near each end
    hx, hy, rc = 7.4, 2.75, 1.5
    out1 = rounded_rect(hx, hy, rc)
    per1 = sum(math.dist(out1[i], out1[(i + 1) % len(out1)]) for i in range(len(out1)))
    straight = 2 * (hx - rc)
    side_u = lambda x, left: (rc * HALF + (hy - rc) + rc * HALF + (hx - rc - x)) if left else \
        (3 * rc * HALF + 2 * (hy - rc) + straight + rc * HALF + (hy - rc) + rc * HALF + (hx - rc + x))
    doors = [(side_u(x, left) - 0.55, side_u(x, left) + 0.55) for x in (5.3, -5.3) for left in (True, False)]
    doors = [(min(a, b), max(a, b)) for a, b in doors]
    roof0 = 3.05
    cabin(body, out1, deck, roof0, window_band(per1, deck + 0.55, roof0 - 0.18, pane=1.45, post=0.12, doors=doors, door_z=deck + 0.04),
          "Cabin", "Interior", thick=0.07)
    # the roof: a shallow crown, overhanging the walls a little
    roof = rounded_rect(hx + 0.35, hy + 0.22, rc + 0.3, step=0.25)
    slab(body, roof, roof0, roof0 + 0.12, "Trim", "Trim", "Trim")
    ring_r = [body.vert((x, y, roof0 + 0.12)) for x, y in roof]
    crown = body.vert((0, 0, roof0 + 0.30))
    for k in range(len(ring_r)):
        body.face([crown, ring_r[k], ring_r[(k + 1) % len(ring_r)]], "Cabin", False)
    # seats facing the windows across the aisle, two rows each side, and the lights over them
    for x in np.arange(-6.2, 6.21, 0.95):
        if abs(abs(x) - 5.3) < 0.75:
            continue
        for y in (-1.75, 1.75):
            box(body, "Seat", (0.45, 1.6, 0.40), T((x, y, deck + 0.24)))
            box(body, "Seat", (0.10, 1.6, 0.50), T((x - 0.22, y, deck + 0.66), (0, -0.12, 0)))
    for y in (-1.1, 1.1):
        box(body, "Light_Cabin", (12.5, 0.16, 0.03), T((0, y, roof0 - 0.02)))

    # open decks at both ends: a railing round the hull edge, benches facing out, a lifebuoy
    for sx in (1, -1):
        pts = [(p.x * 0.975, p.y * 0.975) for p in top if p.x * sx > hx + 0.05]
        pts.sort(key=lambda q: math.atan2(q[1], q[0] * sx))
        z = max(sheer(math.atan2(pts[0][1], pts[0][0])), deck)
        railing(body, pts, z, h=1.0, spacing=0.9, closed=False)
        box(body, "Bench", (0.42, 3.4, 0.07), T(((hx + 1.0) * sx, 0, deck + 0.45)))
        box(body, "Bench", (0.06, 3.4, 0.40), T(((hx + 0.8) * sx, 0, deck + 0.70)))
        for y in (-1.4, 0, 1.4):
            box(body, "Metal_Dark", (0.32, 0.05, 0.42), T(((hx + 1.0) * sx, y, deck + 0.21)))
        for sy in (1, -1):
            revolve(body, "Buoy", [(0.28 + 0.065 * math.cos(t), 0.065 * math.sin(t)) for t in np.linspace(0, TAU, 10, endpoint=False)][::-1],
                    (sx * (hx + 1.4), sy * 2.62, deck + 0.62), (0, 1, 0), segs=16)
        # bollards and a coil of rope at each end
        for sy in (1, -1):
            cyl(body, "Metal_Dark", 0.11, 0.32, T(((hx + 2.4) * sx, sy * 1.6, deck + 0.16)), segs=12)
            cyl(body, "Metal_Dark", 0.15, 0.04, T(((hx + 2.4) * sx, sy * 1.6, deck + 0.34)), segs=12)

    # the roof: a railing round its edge, life rafts, and the wheelhouse amidships
    railing(body, offset_outline(rounded_rect(hx + 0.35, hy + 0.22, rc + 0.3, step=0.6), -0.1), roof0 + 0.12, h=0.45, spacing=1.6)
    for x in (4.6, -4.6):
        cyl(body, "Raft", 0.30, 1.1, T((x, 0, roof0 + 0.52), (0, HALF, 0)), segs=14)
        for d in (-0.28, 0.28):
            cyl(body, "Metal_Dark", 0.305, 0.05, T((x + d, 0, roof0 + 0.52), (0, HALF, 0)), segs=14)
    w0 = roof0 + 0.22
    out3 = rounded_rect(1.7, 1.45, 0.7, step=0.2)
    per3 = sum(math.dist(out3[i], out3[(i + 1) % len(out3)]) for i in range(len(out3)))
    cabin(body, out3, w0, w0 + 1.55, window_band(per3, w0 + 0.62, w0 + 1.42, pane=0.85, post=0.11), "Cabin", "Interior")
    slab(body, rounded_rect(1.95, 1.65, 0.85, step=0.2), w0 + 1.55, w0 + 1.68, "Trim", "Trim", "Trim")
    for sx in (1, -1):
        box(body, "Metal_Dark", (0.35, 1.2, 0.8), T((1.25 * sx, 0, w0 + 0.42)))
    top_w = w0 + 1.68
    cyl(body, "Rail", 0.06, 1.9, T((0, 0, top_w + 0.95)), segs=10)
    box(body, "Rail", (0.07, 0.9, 0.07), T((0, 0, top_w + 0.55)))
    lights = {"Side_Left": (0, 1.68, w0 + 1.0), "Side_Right": (0, -1.68, w0 + 1.0), "Masthead": (0.0, 0, top_w + 1.98)}
    sphere(body, "Light_White", 0.07, T(lights["Masthead"]), segs=10, rings=6)
    for k in ("Side_Left", "Side_Right"):
        box(body, "Metal_Dark", (0.42, 0.06, 0.26), T((0, lights[k][1] * 1.01, lights[k][2])))
        sphere(body, "Light_White", 0.05, T((0, lights[k][1] * 1.04, lights[k][2])), segs=8, rings=6)

    # names on the hull near each end, both sides, between the band and the waterline
    def name_patch(xc, left):
        a0 = math.acos(min(1.0, (abs(xc) / R["hl"]) ** (R["p"] / 2)))
        a = (a0 if xc > 0 else math.pi - a0) if left else (TAU - a0 if xc > 0 else math.pi + a0)
        da = 1.25 * 2e-3 / (H(a + 1e-3, 0.30) - H(a - 1e-3, 0.30)).length
        H.band(trim, [(a - da, 0.30), (a + da, 0.30)], 0.17, "Decal_Name", offset=0.012, across=5, uv=True, step=0.1)
    for xc in (7.6, -7.6):
        for left in (True, False):
            name_patch(xc, left)

    objs = {"Body": body.build("Body"), "Trim": trim.build("Trim")}
    radar = Mesh()
    cyl(radar, "Metal_Dark", 0.09, 0.15, T((0, 0, top_w + 0.10)), segs=12)
    box(radar, "Raft", (0.18, 1.3, 0.11), T((0, 0, top_w + 0.22)), bevel=0.03)
    objs["Radar"] = radar.build("Radar", origin=(0, 0, top_w + 0.10))
    flag = Mesh()
    w, h = 0.8, 0.5
    fz = top_w + 1.35
    fx = [flag.vert((-0.05 - w * k / 6, 0, fz + h * r)) for r in (0, 1) for k in range(7)]
    for k in range(6):
        flag.face([fx[k], fx[k + 1], fx[k + 8], fx[k + 7]], "Flag", False)
    objs["Flag"] = flag.build("Flag", origin=(0, 0, fz))

    anchors = dict(lights)
    anchors.update({"Deck_Passenger": (hx + 1.6, -0.9, deck), "Bow_A": (R["hl"], 0, 0), "Bow_B": (-R["hl"], 0, 0)})
    for k, p in anchors.items():
        objs[k] = empty(k, p)
    waterline = [[round(x, 2), round(y, 2)] for x, y in (plan(a) for a in np.linspace(0, TAU, 48, endpoint=False))]
    info = {"length_m": 2 * R["hl"], "beam_m": 2 * R["hb"], "deck_m": deck, "upper_deck_m": roof0 + 0.12, "label_m": round(top_w + 2.6, 2),
            "waterline": waterline}
    return objs, info


# ------------------------------------------------------------ cars
# Traffic: a sedan (and the same body as a taxi, with a roof sign), a hatchback, an SUV, a
# van and a city bus. Each body is one surface: stations along x give the roof and floor
# lines, and each section is a rounded box that narrows above the beltline (tumblehome).
# Windows are panes laid on that surface, framed in black, so no edge is ever cut; the
# wheel arches are cut and lined. The game paints the material Paint per car, Paint2 with
# a second colour (a taxi's or a bus's band), and lights the lamps after dark.
CARS = {
    "sedan": dict(L=4.80, W=1.82, axles=(1.45, -1.35), r=0.33, track=1.56, floor=0.17, belt=(0.99, 0.93),
                  roof=[(-2.40, 0.80), (-2.30, 0.99), (-1.75, 1.04), (-1.05, 1.40), (-0.70, 1.45), (0.10, 1.45), (0.95, 1.00),
                        (1.45, 0.93), (2.25, 0.84), (2.40, 0.70)],
                  ws=(0.93, 0.16), rw=(-1.74, -1.03), dlo=(0.84, 0.10, -0.98, -1.55), bpillar=-0.34, weight=0.30),
    "hatch": dict(L=4.15, W=1.76, axles=(1.27, -1.27), r=0.31, track=1.52, floor=0.16, belt=(1.00, 0.92),
                  roof=[(-2.075, 0.85), (-2.05, 1.05), (-1.95, 1.30), (-1.75, 1.44), (-1.30, 1.47), (0.05, 1.47), (0.85, 1.00),
                        (1.35, 0.92), (1.95, 0.84), (2.075, 0.70)],
                  ws=(0.83, 0.10), rw=(-2.02, -1.80), dlo=(0.74, 0.04, -1.30, -1.62), bpillar=-0.42, weight=0.25),
    "suv": dict(L=4.70, W=1.88, axles=(1.38, -1.32), r=0.38, track=1.62, floor=0.24, belt=(1.18, 1.10),
                roof=[(-2.35, 1.00), (-2.30, 1.25), (-2.18, 1.62), (-1.90, 1.74), (-1.20, 1.76), (0.05, 1.75), (0.90, 1.18),
                      (1.40, 1.10), (2.20, 1.00), (2.35, 0.84)],
                ws=(0.88, 0.10), rw=(-2.22, -1.95), dlo=(0.78, 0.04, -1.70, -1.95), bpillar=-0.40, weight=0.25),
    "van": dict(L=5.10, W=1.95, axles=(1.62, -1.60), r=0.36, track=1.68, floor=0.22, belt=(1.20, 1.15),
                roof=[(-2.55, 1.10), (-2.52, 1.70), (-2.45, 2.02), (-2.20, 2.08), (1.00, 2.08), (1.45, 1.85), (1.95, 1.25),
                      (2.30, 1.08), (2.50, 0.98), (2.55, 0.82)],
                ws=(1.92, 1.48), rw=(-2.50, -2.42), dlo=(1.40, 1.05, 0.35, 0.40), bpillar=None, weight=0.08),
}
CAR_LIVERIES = {"taxi": {"colours": ["#f3f3f0", "#c9ccd0", "#1c1d1f"], "band": "#1c1d1f", "share": 0.12},
                "bus": {"colour": "#f2f2ef", "band": "#1f5fa8", "share": 0.04},
                "colours": ["#f2f2f2", "#1c1c1e", "#8a9099", "#b3242b", "#1f4e8c", "#d8d3c8", "#2f3b33", "#c9a227", "#5a6470", "#7a1f2b",
                            "#e7e5df", "#3d4146"]}


def car_materials():
    material("Paint", "#d8dadc", 0.3, 0.0, coat=1.0)
    material("Paint2", "#1c1d1f", 0.3, 0.0, coat=1.0)
    material("Glass", "#10161b", 0.05, 0.1)
    material("Trim", "#141516", 0.6, cull=False)
    material("Chrome", "#c9cdd1", 0.2, 1.0)
    material("Tyre", "#1a1b1c", 0.85)
    material("Rim", "#a7adb3", 0.3, 0.9)
    material("Light_Head", "#aeb6bd", 0.08, 0.6, emit="#fff4dc")
    material("Light_Tail", "#8a0d10", 0.2, emit="#ff2a1a")
    material("Light_Amber", "#d97b0e", 0.2, emit="#ffae2a")
    material("Plate", "#f2f2ec", 0.5)
    material("Sign", "#f6e9a8", 0.4, emit="#ffe9a0")
    material("Seam", "#2a2c2e", 0.6)
    material("Seat", "#3b3d41", 0.85)
    material("Dash", "#1d1f22", 0.6)


def car_surface(c):
    xs = [p[0] for p in c["roof"]]
    top = pchip(xs, [p[1] for p in c["roof"]])
    half, W = c["L"] / 2, c["W"]
    belt0, belt1 = c["belt"]

    def belt(x):
        return belt0 + (belt1 - belt0) * (x + half) / (2 * half)

    def params(x):
        zt = top(min(max(x, -half), half))
        zb = c["floor"] + 0.18 * max(0.0, abs(x) / half - 0.80) / 0.20
        # blunt ends: in plan the corners round off over the last 30 cm, and the section
        # closes to a point only in the last few centimetres
        t = max(0.0, (abs(x) - (half - 0.30)) / 0.30)
        plan = (1 - min(1.0, t) ** 2.2) ** (1 / 2.2)
        close = (1 - min(1.0, max(0.0, (abs(x) - (half - 0.06)) / 0.059)) ** 3) ** (1 / 3)
        return zt, zb, W / 2 * (0.80 + 0.20 * plan), close

    def S(x, th):
        zt, zb, hw, k = params(x)
        zc, hz = (zt + zb) / 2, (zt - zb) / 2
        cth, sth = math.cos(th), math.sin(th)
        e = 2 / (4.2 if sth >= 0 else 7.0)
        y = -hw * math.copysign(abs(cth) ** e, cth)
        z = zc + hz * math.copysign(abs(sth) ** e, sth)
        b = belt(x)
        y *= 1 - 0.20 * min(1.0, max(0.0, (z - b) / 0.45)) ** 1.2 * (1 if zt > b + 0.15 else 0.0)
        return Vector((x, y * k, zc + (z - zc) * k))
    F = Surface(S, lambda x, th, p: Vector((p.x * 0.4, p.y, p.z - (params(x)[0] + params(x)[1]) / 2)))
    return F, belt, top, params


def theta_at(F, x, z, lo=-HALF + 1e-3, hi=HALF - 1e-3):
    """The angle on the right side (theta in -pi/2..pi/2) where the section at x reaches height z."""
    for _ in range(40):
        mid = (lo + hi) / 2
        if F(x, mid).z < z:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def patch(mesh, F, poly, mat, offset=0.006, rings=4, step=0.04, uv=None):
    """A filled pane lying on the surface F inside a param-space polygon (star-shaped about its centre)."""
    dense = []
    for a, b in zip(poly, poly[1:] + poly[:1]):
        n = max(1, int(math.ceil((F(*b) - F(*a)).length / step)))
        dense += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n)]
    cx = sum(p[0] for p in dense) / len(dense)
    cy = sum(p[1] for p in dense) / len(dense)
    P = lambda u, v: F(u, v) + F.normal(u, v) * offset
    centre = mesh.vert(P(cx, cy))
    ringv = [[mesh.vert(P(cx + (u - cx) * k / rings, cy + (v - cy) * k / rings)) for u, v in dense] for k in range(1, rings + 1)]
    out = F.normal(cx, cy)
    n = len(dense)

    def face(ids):
        a, b, c = (Vector(mesh.v[i]) for i in ids[:3])
        mesh.face(ids if (b - a).cross(c - a).dot(out) >= 0 else ids[::-1], mat, True)
    for i in range(n):
        face([centre, ringv[0][i], ringv[0][(i + 1) % n]])
    for k in range(rings - 1):
        for i in range(n):
            i2 = (i + 1) % n
            face([ringv[k][i], ringv[k + 1][i], ringv[k + 1][i2], ringv[k][i2]])
    return dense


def text_mesh(mesh, text, mat, size, M, depth=0.004):
    """Letters from Blender's own font as geometry, laid in the x-y plane of M."""
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = text
    cu.size = size
    cu.extrude = depth
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    ob = bpy.data.objects.new("txt", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    ob.evaluated_get(dg).to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    mesh.add_bm(bm, mat, M, smooth=False)


def build_car(kind, taxi=False):
    c = CARS[kind]
    F, belt, top, params = car_surface(c)

    def hw_at(x):
        return params(x)[2]
    half, L = c["L"] / 2, c["L"]
    body, trim = Mesh(), Mesh()
    r, track = c["r"], c["track"]
    arches = [(ax, r + 0.05) for ax in c["axles"]]
    # the glass: windscreen, rear window and the side windows, in (x, theta) on the surface
    ws0, ws1 = c["ws"]
    corner = 0.80
    panes = [[(ws0, corner), (ws1, corner), (ws1, math.pi - corner), (ws0, math.pi - corner)]]
    if c["rw"][0] < c["rw"][1] - 0.05:
        rw0, rw1 = c["rw"]
        panes.append([(rw1, corner), (rw0, corner), (rw0, math.pi - corner), (rw1, math.pi - corner)])
    # the side glass: up the A-pillar, along under the roof, down the C-pillar, and back along the
    # beltline (followed point by point: theta at the belt changes along the car, so a straight
    # edge in (x, theta) would leave a sliver under the roof)
    f0, f1, r1, r0 = c["dlo"]
    sill = [(x, theta_at(F, x, belt(x) + 0.03)) for x in np.linspace(r0, f0, 16)]
    for side in (1, -1):
        dlo = [sill[-1], (f1, corner - 0.08), (r1, corner - 0.08)] + sill[:-1]
        panes.append(dlo if side > 0 else mirror(dlo)[::-1])
    panes = [chaikin(p, 2) for p in panes]
    # the body is open behind the glass (a cell wholly inside a pane), so the cabin shows through
    # it; a cell under the edge of a pane is black, as the ceramic band round real glass is, and
    # what is left of the steps hides under the frame
    dx, dth = 0.03, TAU / 144

    def cut(x, th):
        p = F(x, th)
        for pane in panes:
            if inside(pane, x, th):
                return None if all(inside(pane, x + sx * dx, th + st * dth) for sx in (-1, 1) for st in (-1, 1)) else "Trim"
        if abs(p.y) < c["W"] / 2 * 0.55:
            return "Paint"
        for ax, ra in arches:
            if (p.x - ax) ** 2 + (p.z - r) ** 2 < ra * ra:
                return None
        return "Paint"
    xs = sorted(set(spaced(-half, half, 0.05) + [half - 0.22 * (1 - t) for t in np.linspace(0, 1, 10)] +
                    [-half + 0.22 * (1 - t) for t in np.linspace(0, 1, 10)]))
    xs = [x for x in xs if -half <= x <= half]
    xs[0], xs[-1] = -half + 1e-3, half - 1e-3
    ths = list(np.linspace(0, TAU, 72, endpoint=False))
    F.grid(body, xs, ths, cut, period=TAU)
    # floor pan under the car, so it reads solid from low angles
    box(body, "Trim", (L - 0.7, c["W"] - 0.25, 0.04), T((0, 0, c["floor"] + 0.06)))
    # wheel arches: a black liner, a trim lip, and the wheels
    for ax, ra in arches:
        for side in (1, -1):
            yo = side * (c["W"] / 2)
            arc = [(ax + ra * math.cos(a), yo * 0.985, r + ra * math.sin(a)) for a in np.linspace(-0.25, math.pi + 0.25, 24)]
            tube(trim, "Trim", arc, 0.025, segs=6)
            cyl(body, "Trim", ra + 0.01, 0.30, T((ax, side * (c["W"] / 2 - 0.16), r), (HALF, 0, 0)), segs=20, caps=False)
            yw = side * track / 2
            tyre = [(r * 0.62, -0.105), (r * 0.62, 0.105), (r * 0.92, 0.112), (r, 0.09), (r * 1.01, 0.0), (r, -0.09), (r * 0.92, -0.112)]
            revolve(body, "Tyre", tyre, (ax, yw, r), (0, 1, 0), segs=24)
            cyl(body, "Rim", r * 0.63, 0.20, T((ax, yw + side * 0.005, r), (HALF, 0, 0)), segs=20)
            cyl(body, "Trim", r * 0.22, 0.21, T((ax, yw + side * 0.006, r), (HALF, 0, 0)), segs=10)
            for k in range(5):
                a = k * TAU / 5
                box(body, "Chrome", (0.035, 0.012, r * 0.55), T((ax + math.sin(a) * r * 0.36, yw + side * 0.103, r + math.cos(a) * r * 0.36), (0, a, 0)))

    # the glass in the openings, each pane framed in black outside and in (the inner frame covers
    # the steps the cut leaves, seen from a seat)
    for pane in panes:
        outline = patch(trim, F, pane, "Glass", offset=0.005)
        F.band(trim, outline, 0.022, "Trim", offset=0.007, across=2, closed=True, step=0.03)
        F.band(trim, outline, 0.06, "Trim", offset=-0.012, across=2, closed=True, step=0.03)
    if c.get("bpillar") is not None:
        for side in (1, -1):
            x = c["bpillar"]
            pts = [(x, theta_at(F, x, belt(x))), (x, corner - 0.06)]
            F.band(trim, pts if side > 0 else mirror(pts), 0.05, "Trim", offset=0.008, across=2)
    # lamps, grille, plates, mirrors, handles, sill trim
    zt_f, zt_r = top(half - 0.12), top(-half + 0.12)
    for side in (1, -1):
        sgn = 1 if side > 0 else -1
        # lamp units set into the corners: a dark housing, then the lens
        # the units wrap round the corners, so their outer ends sit further back
        hy = side * (hw_at(half - 0.07) - 0.24)
        box(body, "Trim", (0.10, 0.36, 0.13), T((half - 0.075, hy, zt_f - 0.10), (0, 0, side * 0.30)), bevel=0.02)
        box(body, "Light_Head", (0.04, 0.30, 0.09), T((half - 0.03, hy, zt_f - 0.10), (0, 0, side * 0.30)), bevel=0.012)
        box(body, "Light_Amber", (0.03, 0.08, 0.04), T((half - 0.10, side * (hw_at(half - 0.10) - 0.05), zt_f - 0.12), (0, 0, side * 0.7)))
        ty = side * (hw_at(-half + 0.06) - 0.22)
        box(body, "Light_Tail", (0.07, 0.36, 0.12), T((-half + 0.04, ty, zt_r - 0.12), (0, 0, -side * 0.28)), bevel=0.015)
        x = c["dlo"][0] - 0.05
        box(body, "Paint", (0.10, 0.10, 0.10), T((x, side * (c["W"] / 2 + 0.06), belt(x) + 0.06)), bevel=0.02)
        box(body, "Trim", (0.06, 0.14, 0.03), T((x, side * (c["W"] / 2 + 0.01), belt(x) + 0.02)))
        sill = [(xx, theta_at(F, xx, c["floor"] + 0.14)) for xx in np.linspace(c["axles"][0] - r - 0.12, c["axles"][1] + r + 0.12, 8)]
        F.band(trim, sill if sgn > 0 else mirror(sill), 0.035, "Trim", offset=0.005, across=2)
        for xh in ((0.30, -0.80) if c.get("bpillar") is not None else (0.6,)):
            p = F(xh, theta_at(F, xh, belt(xh) - 0.07) if sgn > 0 else math.pi - theta_at(F, xh, belt(xh) - 0.07))
            box(body, "Chrome", (0.16, 0.025, 0.03), T(p + Vector((0, 0.01 * sgn, 0))))
    # grille, lower intake and plates on the blunt ends
    box(body, "Trim", (0.06, c["W"] * 0.42, 0.16), T((half - 0.03, 0, zt_f - 0.14)), bevel=0.02)
    box(body, "Chrome", (0.02, c["W"] * 0.40, 0.012), T((half + 0.002, 0, zt_f - 0.09)))
    box(body, "Trim", (0.06, c["W"] * 0.62, 0.10), T((half - 0.03, 0, c["floor"] + 0.16)), bevel=0.02)
    box(body, "Plate", (0.02, 0.50, 0.12), T((half + 0.005, 0, c["floor"] + 0.30)))
    box(body, "Plate", (0.02, 0.50, 0.12), T((-half - 0.005, 0, c["floor"] + 0.45)))
    box(body, "Trim", (0.06, c["W"] * 0.80, 0.12), T((-half + 0.03, 0, c["floor"] + 0.17)), bevel=0.02)
    box(body, "Chrome", (0.12, 0.05, 0.05), T((-half + 0.02, -0.45, c["floor"] + 0.08)))
    if taxi:
        zt = top(-0.35)
        box(body, "Sign", (0.26, 0.72, 0.16), T((-0.35, 0, zt + 0.09)), bevel=0.02)
        for side in (1, -1):
            M = T((-0.35, side * 0.362, zt + 0.09), (HALF, 0, HALF if side < 0 else -HALF))
            text_mesh(trim, "TAXI", "Trim", 0.11, M)
    cabin, wheel, hub, seats = build_cabin(c, belt)
    gl = lambda p: [round(p[1], 3), round(p[2], 3), round(p[0], 3)]  # vehicle frame -> glTF (left, up, forward)
    dims = {"length_m": L, "width_m": c["W"], "height_m": round(max(z for _, z in c["roof"]) + (0.17 if taxi else 0), 2),
            "axles_m": list(c["axles"]), "wheel_r_m": r, "track_m": track, "steering": gl(hub), "steering_tilt": STEER_TILT,
            "seats": {k: gl(p) for k, p in seats.items()}}
    return body, trim, cabin, wheel, dims


STEER_TILT = 0.42  # the steering column's rake, radians from horizontal


def build_cabin(c, belt):
    """Seats, a dashboard and a steering wheel, seen through the glass of a car someone rides in
    or drives (the traffic, with dark glass, leaves them out). Laid out from the windscreen
    back, for right-hand drive: the game mirrors the cabin where traffic keeps right. The wheel
    is its own object, centred on its hub and raked back along the column, which the game turns
    about the column (its local +z in glTF). Returns the meshes, the hub and the seats (the top
    of each cushion, where the game sits a person)."""
    cab, wheel = Mesh(), Mesh()
    fl, W, ws0 = c["floor"], c["W"], c["ws"][0]
    xf = ws0 - 1.15                     # the front seats' hip point, a long arm from the wheel
    zs = fl + 0.33                      # the top of the cushions
    drv = -0.38                         # the driver sits on the right
    van = c["rw"][1] - c["rw"][0] < 0.1  # a panel van: two seats and a bulkhead behind them

    def seat(x, y, w=0.50):
        box(cab, "Seat", (0.50, w, 0.12), T((x + 0.02, y, zs - 0.06)), bevel=0.04)
        box(cab, "Seat", (0.11, w, 0.60), T((x - 0.27, y, zs + 0.30), (0, -0.20, 0)), bevel=0.04)
        box(cab, "Seat", (0.08, min(0.26, w * 0.5), 0.16), T((x - 0.36, y, zs + 0.70), (0, -0.20, 0)), bevel=0.03)
        box(cab, "Dash", (0.40, w * 0.8, zs - fl - 0.21), T((x + 0.02, y, (fl + zs) / 2 - 0.015)))
    seats = {"driver": (xf, drv, zs), "passenger": (xf, -drv, zs)}
    for y in seats.values():
        seat(xf, y[1])
    if van:
        box(cab, "Dash", (0.04, W - 0.30, 1.30), T((xf - 0.48, 0, fl + 0.75)))
    else:
        xr = xf - 0.86
        seat(xr, 0.0, w=W - 0.72)
        for k in (-1, 1):
            box(cab, "Seat", (0.08, 0.26, 0.16), T((xr - 0.36, k * 0.36, zs + 0.70), (0, -0.20, 0)), bevel=0.03)
        seats.update({"rear_left": (xr, 0.36, zs), "rear_right": (xr, -0.36, zs)})
    # the dashboard under the windscreen, the carpet, the instrument binnacle, the centre stack and console
    xd = ws0 - 0.20
    zd = belt(xd) + 0.02
    x0 = xf - 0.45 if van else xr - 0.30
    box(cab, "Dash", (xd - 0.10 - x0, W - 0.30, 0.03), T(((xd - 0.10 + x0) / 2, 0, fl + 0.09)))
    box(cab, "Dash", (0.46, W - 0.34, 0.26), T((xd, 0, zd - 0.13)), bevel=0.05)
    box(cab, "Dash", (0.16, 0.36, 0.07), T((xd - 0.18, drv, zd + 0.01)), bevel=0.03)
    box(cab, "Dash", (0.24, 0.26, 0.34), T((xd - 0.22, 0, zd - 0.30)), bevel=0.03)
    box(cab, "Dash", (0.70, 0.20, 0.16), T((xf + 0.20, 0, fl + 0.20)), bevel=0.04)
    # the wheel: rim, three spokes, the boss and the column, about its hub
    hub = Vector((ws0 - 0.62, drv, zs + 0.40))
    R = 0.185
    rim = [hub + Vector((0, R * math.cos(a), R * math.sin(a))) for a in np.linspace(0, TAU, 33)]
    tube(wheel, "Dash", rim, 0.018, segs=8, caps=False)
    cyl(wheel, "Dash", 0.05, 0.06, T(hub, (0, HALF, 0)), segs=16)
    for a in (0.0, math.pi, -HALF):
        box(wheel, "Dash", (0.016, 0.15, 0.035), T(hub + Vector((0, math.cos(a) * 0.105, math.sin(a) * 0.105)), (a, 0, 0)))
    cyl(wheel, "Dash", 0.03, 0.30, T(hub + Vector((0.15, 0, 0)), (0, HALF, 0)), segs=10)
    return cab, wheel, hub, seats


def build_bus():
    """A low-floor city bus, 12 m: glazing all round, doors on the left (the kerb side where
    traffic keeps left; the game mirrors nothing), a destination sign that lights up."""
    c = dict(L=12.0, W=2.50, axles=(3.45, -2.45), r=0.50, track=2.08, floor=0.30)
    half = c["L"] / 2

    def S(x, th):
        t = max(0.0, (abs(x) - (half - 0.18)) / 0.18)
        k = (1 - min(1.0, t) ** 4) ** 0.25
        zt, zb = 3.05 - (0.10 if x < -half + 0.4 else 0), c["floor"]
        zc, hz, hw = (zt + zb) / 2, (zt - zb) / 2 * (0.9 + 0.1 * k), c["W"] / 2 * (0.9 + 0.1 * k)
        cth, sth = math.cos(th), math.sin(th)
        e = 2 / 8.0
        return Vector((x, -hw * math.copysign(abs(cth) ** e, cth), zc + hz * math.copysign(abs(sth) ** e, sth)))
    F = Surface(S, lambda x, th, p: Vector((p.x * 0.2, p.y, p.z - 1.65)))
    body, trim = Mesh(), Mesh()
    arches = [(ax, c["r"] + 0.06) for ax in c["axles"]]

    def mat_of(x, th):
        p = F(x, th)
        if abs(p.y) > 0.9 and any((p.x - ax) ** 2 + (p.z - c["r"]) ** 2 < ra * ra for ax, ra in arches):
            return None
        return "Paint2" if 0.75 < p.z < 1.05 else "Paint"
    xs = sorted(set(spaced(-half, half, 0.12) + [half - 0.18 * (1 - t) for t in np.linspace(0, 1, 8)] + [-half + 0.18 * (1 - t) for t in np.linspace(0, 1, 8)]))
    xs = [x for x in xs if -half <= x <= half]
    xs[0], xs[-1] = -half + 1e-3, half - 1e-3
    ths = list(np.linspace(0, TAU, 64, endpoint=False))
    F.grid(body, xs, ths, mat_of, period=TAU)
    for x in (xs[0], xs[-1]):    # flat end caps, fanned from the middle
        ring = [body.vert(F(x, th)) for th in ths]
        mid = body.vert(sum((Vector(body.v[i]) for i in ring), Vector()) / len(ring))
        for j in range(len(ring)):
            a, b = ring[j], ring[(j + 1) % len(ring)]
            body.face([mid, b, a] if x > 0 else [mid, a, b], "Paint", smooth=False)
    for ax, ra in arches:
        for side in (1, -1):
            cyl(body, "Trim", ra + 0.01, 0.36, T((ax, side * (c["W"] / 2 - 0.2), c["r"]), (HALF, 0, 0)), segs=20, caps=False)
            yw, r = side * c["track"] / 2, c["r"]
            revolve(body, "Tyre", [(r * 0.6, -0.14), (r * 0.6, 0.14), (r * 0.94, 0.15), (r, 0.11), (r, -0.11), (r * 0.94, -0.15)], (ax, yw, r), (0, 1, 0), segs=24)
            cyl(body, "Rim", r * 0.6, 0.26, T((ax, yw + side * 0.01, r), (HALF, 0, 0)), segs=20)
    # windows: a band each side, the windscreen and the rear window, a destination sign
    th_lo, th_hi = theta_at(F, 0, 1.25), theta_at(F, 0, 2.75)
    for side in (1, -1):
        band_ = [(half - 1.0, th_lo), (half - 1.0, th_hi), (-half + 0.5, th_hi), (-half + 0.5, th_lo)]
        outline = patch(trim, F, band_ if side > 0 else mirror(band_)[::-1], "Glass", offset=0.006, rings=2)
        F.band(trim, outline, 0.03, "Trim", offset=0.008, across=2, closed=True, step=0.06)
        for x in np.arange(-half + 1.3, half - 1.0, 1.25):
            F.band(trim, [(x, th_lo), (x, th_hi)] if side > 0 else mirror([(x, th_lo), (x, th_hi)]), 0.035, "Trim", offset=0.009, across=2)
    for xx, z0, z1, m in ((half - 0.001, 0.95, 2.55, "Glass"), (-half + 0.001, 1.6, 2.6, "Glass")):
        sgn = 1 if xx > 0 else -1
        box(trim, m, (0.02, c["W"] - 0.25, z1 - z0), T((xx + sgn * 0.005, 0, (z0 + z1) / 2)))
        box(trim, "Trim", (0.025, c["W"] - 0.18, 0.05), T((xx + sgn * 0.004, 0, z1 + 0.03)))
    box(trim, "Sign", (0.03, 1.6, 0.25), T((half + 0.01, 0, 2.78)))
    for x in (half - 0.5, -0.2):
        box(trim, "Glass", (0.9 if x > 0 else 1.2, 0.02, 2.2), T((x, c["W"] / 2 + 0.006, 1.42)))
    for side in (1, -1):
        for poly, m in (((half - 0.003, 0.45), "Light_Head"), ((-half + 0.003, 0.95), "Light_Tail")):
            box(trim, m, (0.02, 0.32, 0.16), T((poly[0], side * 0.95, poly[1])))
    box(body, "Plate", (0.02, 0.5, 0.12), T((half + 0.01, 0, 0.55)))
    box(body, "Plate", (0.02, 0.5, 0.12), T((-half - 0.01, 0, 0.75)))
    return body, trim, {"length_m": c["L"], "width_m": c["W"], "height_m": 3.05, "axles_m": list(c["axles"]), "wheel_r_m": c["r"],
                        "track_m": c["track"]}


def build_cars():
    car_materials()
    objs, cabins, dims = {}, {}, {}
    for name, kind, taxi in (("Car_Sedan", "sedan", False), ("Car_Taxi", "sedan", True), ("Car_Hatch", "hatch", False),
                             ("Car_SUV", "suv", False), ("Car_Van", "van", False)):
        b, t, cab, wheel, dims[name] = build_car(kind, taxi)
        b.merge(t)
        objs[name] = b.build(name)
        # the cabin is its own node beside the car (<name>_Cabin), with the wheel under it (<name>_Steering)
        cabins[name] = cab.build(f"{name}_Cabin")
        hub = [dims[name]["steering"][k] for k in (2, 0, 1)]  # back to the vehicle frame
        w = wheel.build(f"{name}_Steering", origin=hub, parent=cabins[name])
        w.rotation_euler = (STEER_TILT, 0, 0)
    b, t, dims["Bus"] = build_bus()
    b.merge(t)
    objs["Bus"] = b.build("Bus")
    # the end sections close to a point: weld those rings
    for ob in objs.values():
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
        bm.to_mesh(ob.data)
        bm.free()
    # spread them out so the bake sees each on its own, each cabin in its car
    for k, (name, ob) in enumerate(objs.items()):
        ob.location = to_blender((0, k * 6.0 - 15, 0))
        if name in cabins:
            cabins[name].location = ob.location
    info = {"models": {"Car_Sedan": {"weight": CARS["sedan"]["weight"]}, "Car_Hatch": {"weight": CARS["hatch"]["weight"]},
                       "Car_SUV": {"weight": CARS["suv"]["weight"]}, "Car_Van": {"weight": CARS["van"]["weight"]},
                       "Car_Taxi": {"taxi": True}, "Bus": {"bus": True}},
            "liveries": CAR_LIVERIES,
            "tones": {"Paint": 0, "Paint2": 1, "Seat": 2, "Glass": 4, "Tyre": 5, "Light_Head": 6, "Light_Tail": 7, "Trim": 8, "Chrome": 9,
                      "Rim": 10, "Plate": 11, "Sign": 12, "Light_Amber": 13, "Seam": 8, "Dash": 8}}
    for name, d in dims.items():
        info["models"][name].update(d)
        if name in cabins:
            info["models"][name]["cabin"] = f"{name}_Cabin"
    return objs, cabins, info


# ------------------------------------------------------------ the shared pipeline: AO bake, LOD, export
def select(objs):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def bake_ao(meshes, hidden, size, distance, samples, plain=()):
    """One ambient-occlusion atlas for all `meshes`, wired into their materials as glTF occlusion
    (except the materials named in `plain`, which bake into a scratch image and keep none)."""
    t = time.time()
    select(meshes)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.002)
    bpy.ops.uv.pack_islands(margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("AO", size, size, alpha=False)
    scratch = bpy.data.images.new("AO_scratch", 64, 64, alpha=False)
    mats = {m for o in meshes for m in o.data.materials}
    for m in mats:
        nt = m.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = scratch if m.name in plain else img
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
        if m.name in plain:
            continue
        nt = m.node_tree
        tex = nt.nodes.active
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
        g = nt.nodes.new("ShaderNodeGroup")
        g.node_tree = group
        nt.links.new(sep.outputs["Red"], g.inputs["Occlusion"])
    print(f"  AO bake {size}px for {len(meshes)} meshes: {time.time() - t:.0f} s")


def joined(objs, name):
    """A copy of several objects as one mesh, each part where it is."""
    copies = []
    for o in objs:
        c = o.copy()
        c.data = o.data.copy()
        c.parent = None
        c.matrix_world = o.matrix_world.copy()
        bpy.context.scene.collection.objects.link(c)
        copies.append(c)
    select(copies)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    return ob


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
    if kind in ("helicopter", "cars"):
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


def bake_vertex_ao(meshes, distance, samples):
    """Ambient occlusion into each mesh's colour attribute (for the instanced traffic, which has no UVs)."""
    t = time.time()
    for o in meshes:
        attr = o.data.color_attributes.new("ao", "BYTE_COLOR", "POINT")
        o.data.color_attributes.active_color = attr
    select(meshes)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    world = bpy.data.worlds.get("Bake") or bpy.data.worlds.new("Bake")
    world.light_settings.distance = distance
    sc.world = world
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS", use_clear=True)
    print(f"  vertex AO for {len(meshes)} meshes: {time.time() - t:.0f} s")


KINDS = ["helicopter", "ferry", "ferry_river", "cars"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=KINDS)
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
                       ("end", (40, 4, 6), (0, 0, 3.5), 45), ("deck", (16, -9, 7.5), (4, 0, 4.5), 30)],
             "ferry_river": [("front34", (24, -18, 6), (0, 0, 2), 40), ("side", (0, -32, 3.5), (0, 0, 2.0), 40),
                             ("end", (26, 3, 4), (0, 0, 2.2), 45), ("deck", (10, -6, 5), (3, 0, 2.5), 32)],
             "cars": [("row", (9, -24, 2.2), (0, -6, 0.8), 40), ("front", (11, -9, 1.6), (0, -9, 0.8), 45), ("rear", (-9, -3, 1.8), (0, -3, 0.8), 45),
                      ("bus", (-14, 20, 3.0), (0, 15, 1.5), 40), ("high", (16, -20, 10), (0, -4, 0.5), 35)]}
    hero = {"helicopter": ("front34", (9.6, -7.4, 1.9), (-0.9, 0.2, 1.75), 46), "ferry": ("front34", (36, -30, 4.5), (-1, 0, 3.6), 42),
            "ferry_river": ("front34", (24, -20, 3.2), (-1, 0, 2.0), 42)}
    builders = {"helicopter": build_helicopter, "ferry": build_ferry, "ferry_river": build_ferry_river, "cars": build_cars}
    for kind in KINDS:
        if a.only and a.only != kind:
            continue
        print(kind)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        MAT.clear()
        built = builders[kind]()
        objs, info = built[0], built[-1]
        cabins = built[1] if kind == "cars" else {}
        if a.preview:
            os.makedirs(a.preview, exist_ok=True)
            stage(kind, min(a.samples, 24), (960, 540))
            for name, loc, tgt, lens in shots[kind]:
                camera("Cam", loc, tgt, lens)
                render(os.path.join(a.preview, f"{kind}_{name}.jpg"))
            continue
        if kind == "cars":
            # ambient occlusion per vertex, two decimated copies of each body for distance (the cabins are
            # only seen close to), one file for all
            inner = [o for cab in cabins.values() for o in (cab, *cab.children)]
            bake_vertex_ao(list(objs.values()) + inner, 0.6, a.bake_samples)
            for name in list(objs):
                lo, far = lod_copy(objs[name], f"{name}_LOD1", 0.22), lod_copy(objs[name], f"{name}_LOD2", 0.045)
                info["models"][name].update({"triangles": triangles([objs[name]]), "lod1_triangles": triangles([lo]),
                                             "lod2_triangles": triangles([far])})
                if name in cabins:
                    info["models"][name]["cabin_triangles"] = triangles([o for o in inner if o.name.startswith(name + "_")])
                objs[f"{name}_LOD1"], objs[f"{name}_LOD2"] = lo, far
            for ob in list(objs.values()) + list(cabins.values()):
                ob.location = (0, 0, 0)
            path = os.path.join(OUT, "cars.glb")
            select(list(objs.values()) + inner)
            bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_vertex_color="ACTIVE",
                                      export_materials="EXPORT", export_cameras=False, export_lights=False, export_animations=False)
            print(f"  {os.path.relpath(path, ROOT)}: {os.path.getsize(path) / 1e6:.2f} MB")
            info.update({"file": "cars.glb", "lod1_m": 35, "lod2_m": 110,
                         "note": "Paint takes each car's colour, Paint2 a second (a taxi's or bus's band); 'tones' maps materials to the "
                                 "traffic shader's slots"})
            manifest[kind] = info
            if a.render:
                # the full models in a row, each in a colour of its own, as the game paints them
                paints = {"Car_Sedan": "#1f4e8c", "Car_Taxi": "#f4c20d", "Car_Hatch": "#b3242b", "Car_SUV": "#8a9099", "Car_Van": "#f2f2f2",
                          "Bus": "#eef0ef"}
                for k, name in enumerate(paints):
                    ob = objs[name]
                    ob.location = to_blender((0, k * 6.0 - 15, 0))
                    if name in cabins:
                        cabins[name].location = ob.location
                    for i, slot in enumerate(ob.material_slots):
                        if slot.material and slot.material.name in ("Paint", "Paint2"):
                            m = slot.material.copy()
                            colour = paints[name] if slot.material.name == "Paint" else "#1f5fa8" if name == "Bus" else "#1c1d1f"
                            m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*lin(colour), 1)
                            ob.material_slots[i].material = m
                for name, ob in objs.items():
                    ob.hide_render = "_LOD" in name
                os.makedirs(DOCS, exist_ok=True)
                stage(kind, a.samples, (1600, 900))
                # gloss paint in full sun: a neutral view transform holds the paint colours
                bpy.context.scene.view_settings.view_transform = "Khronos PBR Neutral"
                bpy.context.scene.view_settings.look = "None"
                bpy.context.scene.view_settings.exposure = -1.3
                camera("Cam", (9.5, -25, 2.4), (0, -5.5, 0.9), 38)
                render(os.path.join(DOCS, "cars.jpg"))
            continue
        trims = [o for k, o in objs.items() if k.startswith("Trim")]
        meshes = [o for k, o in objs.items() if o.type == "MESH" and o not in trims and k != "Flag"]
        bake_ao(meshes, trims, 2048, 1.0 if kind == "helicopter" else 2.5, a.bake_samples, plain=("Lining",))
        # a decimated copy of the body for distance (the game swaps at 'lod1_m'), with the door shut in it
        whole = joined([objs["Body"], objs["Door_Pilot"]], "Body_Whole") if "Door_Pilot" in objs else objs["Body"]
        objs["Body_LOD1"] = lod_copy(whole, "Body_LOD1", 0.14 if kind == "helicopter" else 0.18)
        if whole is not objs["Body"]:
            bpy.data.objects.remove(whole)
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
            entry.update({"default_livery": "river" if kind == "ferry_river" else "bay", "liveries": FERRY_LIVERIES,
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
