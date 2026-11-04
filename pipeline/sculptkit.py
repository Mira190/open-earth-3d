"""Sculpted shapes for landmarks: signed distance fields meshed by surface nets.

A statue or anything organic is hard to build from boxes and lathes. Here it is modelled the way a
sculptor blocks it out in clay: ellipsoids, capsules and tapered limbs joined with a smooth union
(the clay filling the joint), then meshed on a regular grid by naive surface nets (one vertex per cell
the surface crosses, at the mean of its edge crossings; one quad per grid edge it crosses). The mesh
shares its vertices, so the viewer smooths across it (web/world.js computes vertex normals).

Distances are in metres in the shape's own frame (u forward, v left, z up). A field is a function of
three arrays of the same shape (u, v, z) returning an array, negative inside.

    import sculptkit as sk
    f = sk.smooth_union(0.04, sk.ellipsoid((0, 0, 0.5), (0.2, 0.15, 0.3)), sk.capsule((0, 0, 0), (0, 0, 0.4), 0.06))
    verts, quads = sk.mesh(f, (-0.3, -0.3, -0.1), (0.3, 0.3, 0.9), 0.015)
"""
import numpy as np


# ---------------------------------------------------------------- primitives

def sphere(c, r):
    c = np.asarray(c, float)
    return lambda u, v, z: np.sqrt((u - c[0]) ** 2 + (v - c[1]) ** 2 + (z - c[2]) ** 2) - r


def ellipsoid(c, radii):
    """An ellipsoid (the usual bound: exact on the axes, close enough near the surface)."""
    c, r = np.asarray(c, float), np.asarray(radii, float)

    def f(u, v, z):
        x, y, w = (u - c[0]) / r[0], (v - c[1]) / r[1], (z - c[2]) / r[2]
        k0 = np.sqrt(x * x + y * y + w * w)
        k1 = np.sqrt((x / r[0]) ** 2 + (y / r[1]) ** 2 + (w / r[2]) ** 2)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
    return f


def capsule(a, b, ra, rb=None):
    """A limb from a to b, its radius ra at a and rb at b (a cone with rounded ends)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    rb = ra if rb is None else rb
    ab = b - a
    L2 = float(ab @ ab)

    def f(u, v, z):
        px, py, pz = u - a[0], v - a[1], z - a[2]
        t = np.clip((px * ab[0] + py * ab[1] + pz * ab[2]) / L2, 0.0, 1.0)
        dx, dy, dz = px - ab[0] * t, py - ab[1] * t, pz - ab[2] * t
        return np.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t)
    return f


def path(points, radii):
    """A tube along a polyline with a radius at each point (a tail, a strap): capsules joined."""
    parts = [capsule(points[k], points[k + 1], radii[k], radii[k + 1]) for k in range(len(points) - 1)]
    return lambda u, v, z: np.minimum.reduce([p(u, v, z) for p in parts])


def torus(c, axis, R, r):
    """A ring of tube radius r round a circle of radius R about `axis` through c (a collar)."""
    c, n = np.asarray(c, float), np.asarray(axis, float) / np.linalg.norm(axis)

    def f(u, v, z):
        px, py, pz = u - c[0], v - c[1], z - c[2]
        h = px * n[0] + py * n[1] + pz * n[2]
        qx, qy, qz = px - n[0] * h, py - n[1] * h, pz - n[2] * h
        q = np.sqrt(qx * qx + qy * qy + qz * qz)
        return np.sqrt((q - R) ** 2 + h * h) - r
    return f


def box(c, half, round_r=0.0):
    c, b = np.asarray(c, float), np.asarray(half, float) - round_r

    def f(u, v, z):
        qx, qy, qz = np.abs(u - c[0]) - b[0], np.abs(v - c[1]) - b[1], np.abs(z - c[2]) - b[2]
        out = np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2 + np.maximum(qz, 0) ** 2)
        return out + np.minimum(np.maximum(qx, np.maximum(qy, qz)), 0.0) - round_r
    return f


def mirror_v(f):
    """The shape and its mirror image across v = 0 (a pair of legs, ears)."""
    return lambda u, v, z: f(u, np.abs(v), z)


# ---------------------------------------------------------------- operations

def smooth_union(k, *fs):
    """The union of the fields, filled with a fillet about k wide where they meet (polynomial smooth min)."""
    def f(u, v, z):
        d = fs[0](u, v, z)
        for g in fs[1:]:
            e = g(u, v, z)
            h = np.clip(0.5 + 0.5 * (e - d) / k, 0.0, 1.0)
            d = e * (1 - h) + d * h - k * h * (1 - h)
        return d
    return f


def union(*fs):
    return lambda u, v, z: np.minimum.reduce([g(u, v, z) for g in fs])


def subtract(k, f, g):
    """f with g carved out of it, the cut's edge rounded about k."""
    def h(u, v, z):
        a, b = f(u, v, z), -g(u, v, z)
        t = np.clip(0.5 - 0.5 * (b - a) / k, 0.0, 1.0)
        return b * (1 - t) + a * t + k * t * (1 - t)
    return h


def roughen(f, amp, scale, seed=0):
    """A cast surface: the field moved in and out by smooth value noise of size `scale` metres, `amp`
    deep (the modelling marks of a bronze, or the grain of hewn stone)."""
    rng = np.random.default_rng(seed)
    lat = rng.random((64, 64, 64))

    def noise(x, y, w):
        x, y, w = x / scale, y / scale, w / scale
        i, j, k = np.floor(x).astype(int), np.floor(y).astype(int), np.floor(w).astype(int)
        fx, fy, fz = x - i, y - j, w - k
        fx, fy, fz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
        out = 0.0
        for a in (0, 1):
            for b in (0, 1):
                for c in (0, 1):
                    wgt = (fx if a else 1 - fx) * (fy if b else 1 - fy) * (fz if c else 1 - fz)
                    out = out + wgt * lat[(i + a) % 64, (j + b) % 64, (k + c) % 64]
        return out - 0.5

    return lambda u, v, z: f(u, v, z) + amp * (noise(u, v, z) + 0.5 * noise(u * 2.1 + 7, v * 2.1 + 3, z * 2.1 + 5))


# ---------------------------------------------------------------- meshing

def mesh(f, lo, hi, cell):
    """Surface nets over the box lo..hi at `cell` metres: (vertices (n, 3), triangles (m, 3)), wound
    with their fronts outward."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    n = np.maximum(np.ceil((hi - lo) / cell).astype(int) + 1, 2)
    ax = [lo[k] + np.arange(n[k]) * cell for k in range(3)]
    U, V, Z = np.meshgrid(*ax, indexing="ij")
    F = f(U, V, Z)
    F[0, :, :] = F[-1, :, :] = F[:, 0, :] = F[:, -1, :] = F[:, :, 0] = F[:, :, -1] = np.abs(F).max() + 1.0  # closed at the box
    inside = F < 0
    nx, ny, nz = n - 1
    # each cell's vertex: the mean of the points where its twelve edges cross the surface
    acc = np.zeros((nx, ny, nz, 3))
    cnt = np.zeros((nx, ny, nz))
    corner = lambda a, b, c: F[a:a + nx, b:b + ny, c:c + nz]
    for d in range(3):
        e = np.eye(3, dtype=int)[d]
        others = [k for k in range(3) if k != d]
        for o1 in (0, 1):
            for o2 in (0, 1):
                off = np.zeros(3, int)
                off[others[0]], off[others[1]] = o1, o2
                f0 = corner(*off)
                f1 = corner(*(off + e))
                hit = (f0 < 0) != (f1 < 0)
                t = np.where(hit, f0 / np.where(hit, f0 - f1, 1.0), 0.0)
                p = np.stack([off[k] + e[k] * t for k in range(3)], -1)
                acc += p * hit[..., None]
                cnt += hit
    active = cnt > 0
    idx = -np.ones((nx, ny, nz), int)
    idx[active] = np.arange(int(active.sum()))
    ii = np.argwhere(active)
    verts = lo + (ii + acc[active] / cnt[active][:, None]) * cell
    # a quad for each grid edge the surface crosses, joining the four cells round it
    tris = []
    for d in range(3):
        o = [k for k in range(3) if k != d]
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[d], sl1[d] = slice(0, n[d] - 1), slice(1, n[d])
        a, b = inside[tuple(sl0)], inside[tuple(sl1)]
        cross = a != b
        for k in o:   # the edges on the box's outer layer have no cells on one side
            s = [slice(None)] * 3
            s[k] = 0
            cross[tuple(s)] = False
        e = np.argwhere(cross)
        if not len(e):
            continue
        flip = a[cross]

        def cell_at(da, db):
            q = e.copy()
            q[:, o[0]] -= da
            q[:, o[1]] -= db
            return idx[q[:, 0], q[:, 1], q[:, 2]]
        c00, c10, c11, c01 = cell_at(1, 1), cell_at(0, 1), cell_at(0, 0), cell_at(1, 0)
        q = np.stack([c00, c10, c11, c01], -1)
        q[flip] = q[flip][:, ::-1]
        if d == 1:   # (o = (u, z): the other hand)
            q = q[:, ::-1]
        tris += [q[:, [0, 1, 2]], q[:, [0, 2, 3]]]
    tris = np.concatenate(tris) if tris else np.zeros((0, 3), int)
    tris = tris[(tris >= 0).all(1)]
    # outward: the signed volume of a closed surface is positive
    vol = np.einsum("ij,ij->i", verts[tris[:, 0]], np.cross(verts[tris[:, 1]], verts[tris[:, 2]])).sum()
    if vol < 0:
        tris = tris[:, ::-1]
    return verts, tris


def relax(verts, tris, k=0.5, rounds=1):
    """Laplacian smoothing (moves each vertex k of the way to its neighbours' mean): takes off the
    grid's stair-steps that surface nets leave on gently curved surfaces."""
    import scipy.sparse as sp
    n = len(verts)
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    A = sp.coo_matrix((np.ones(len(e) * 2), (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
    A.data[:] = 1.0
    deg = np.asarray(A.sum(1)).ravel()
    for _ in range(rounds):
        mean = (A @ verts) / np.maximum(deg, 1)[:, None]
        verts = verts + k * (mean - verts)
    return verts
