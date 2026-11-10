"""What a railway's builders share (cities/tokyo/rail.py, cities/sydney/rail.py): one mesh per material, flat
polygons, walls, ribbons along a line, a track's bed and rails, and a sign's lit face on a sheet.
"""
import math

import numpy as np
import shapely


def tri_poly(mesh, poly, z, uv=False):
    """A flat polygon (with holes) at height z."""
    for g in getattr(poly, "geoms", [poly]):
        if g.is_empty or g.geom_type != "Polygon":
            continue
        for t in shapely.constrained_delaunay_triangles(g).geoms:
            c = list(t.exterior.coords)[:3]
            mesh.tri(*[[x, y, z] for x, y in c], [[x, y] for x, y in c] if uv else None)


def wall(mesh, a, b, z0a, z0b, z1, u0=0.0):
    """A vertical face from a to b (plan), from the ground at each end up to z1; UVs metres along and up."""
    L = float(np.linalg.norm(np.asarray(b) - np.asarray(a)))
    mesh.quad([*a, z0a], [*b, z0b], [*b, z1], [*a, z1], [[u0, 0], [u0 + L, 0], [u0 + L, z1 - z0b], [u0, z1 - z0a]])
    return u0 + L


class Kit(dict):
    """One mesh per material, made as it is first asked for."""

    def __init__(self, Mesh, prefix, materials, flood=(), uv=(), sky=None):
        super().__init__()
        self.Mesh, self.prefix, self.mats, self.flood, self.uv, self.sky = Mesh, prefix, materials, set(flood), set(uv), sky or {}

    def __missing__(self, mat):
        m = self.Mesh(f"{self.prefix}_{mat}", mat, False, floodlit=mat in self.flood, uv=mat in self.uv or "pattern" in self.mats[mat] or "map" in self.mats[mat])
        if mat in self.sky:
            m.sky, m.bounce = self.sky[mat], "#8a857c"
        self[mat] = m
        return m


def ribbon(mesh, pts, z, half, uv=True):
    """A strip `2 x half` wide along a plan polyline at height z; UVs metres along and across."""
    P = np.asarray(pts, float)
    d = np.gradient(P, axis=0)
    d /= np.linalg.norm(d, axis=1)[:, None]
    n = np.stack([-d[:, 1], d[:, 0]], axis=1)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    mesh.grid([[[*(p - q * half), z], [*(p + q * half), z]] for p, q in zip(P, n)], [[[u, 0.0], [u, 2 * half]] for u in s] if uv else None)


def offset(pts, v):
    P = np.asarray(pts, float)
    d = np.gradient(P, axis=0)
    d /= np.linalg.norm(d, axis=1)[:, None]
    return P + np.stack([-d[:, 1], d[:, 0]], axis=1) * v



def track(K, pts, gauge, rail_z, bed="rail_bed", steel="rail_steel", every=2):
    """A track along a plan polyline: the sleepers' bed 0.17 m under the top of the rail, and the two rails."""
    ribbon(K[bed], pts, rail_z - 0.17, 1.35)
    for s in (-1, 1):
        K[steel].sweep([[*q, rail_z - 0.08] for q in offset(pts, s * gauge / 2)[::every]], [(-0.035, -0.08), (0.035, -0.08), (0.035, 0.08), (-0.035, 0.08)])


def sign_uv(signs, sheet, key):
    """The texture coordinates of a sign's box (x, y, w, h in pixels) on its sheet (W, H)."""
    x, y, w, h = signs[key]
    W, H = sheet
    return [[x / W, 1 - (y + h) / H], [(x + w) / W, 1 - (y + h) / H], [(x + w) / W, 1 - y / H], [x / W, 1 - y / H]]


def sign(mesh, uv, c, N, w, z0, h, off=0.05):
    """A sign's lit face, w wide and h high, its middle at c (plan) and its foot at z0, read from the side N points to."""
    c, N = np.asarray(c, float), np.asarray(N, float)
    r = np.array([-N[1], N[0]])    # the reader's right
    a, b = c - r * w / 2 + N * off, c + r * w / 2 + N * off
    mesh.quad([*a, z0], [*b, z0], [*b, z0 + h], [*a, z0 + h], uv)


def bay(K, a, b, g0, g1, top, out, kind, seed):
    """One bay of the viaduct's face from a to b (plan), `out` its outward normal: a brick arch (kind "arch") or a
    concrete frame's opening (kind "frame"), and what fills it, set back from the face."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    L = float(np.linalg.norm(b - a))
    t = (b - a) / L
    face = K["rail_brick"] if kind == "arch" else K["rail_concrete"]
    gz = lambda u: g0 + (g1 - g0) * u / L - 0.4
    P = lambda u, z, d=0.0: [*(a + t * u - out * d), z]
    pier = 0.75 if kind == "arch" else 0.55
    if L < 4.2 or top - max(g0, g1) < 3.6:
        face.quad(P(0, gz(0)), P(L, gz(L)), P(L, top), P(0, top), [[0, 0], [L, 0], [L, top - gz(L)], [0, top - gz(0)]])
        return
    x0, x1, base = pier, L - pier, max(g0, g1)
    w = x1 - x0
    if kind == "arch":   # a segmental arch: springing 2.3 m up, its crown under the deck's band
        spring = base + 2.3
        rise = min(w / 2, top - 0.75 - spring)
        n = 10
        crv = [(x0 + w * k / n, spring + rise * math.sin(math.pi * k / n) ** 0.85) for k in range(n + 1)]
    else:                # a frame: a beam 1.1 m deep on columns
        crv = [(x0, top - 1.1), (x1, top - 1.1)]
    # the face: the piers, and the wall over the opening
    for u0, u1 in ((0, x0), (x1, L)):
        face.quad(P(u0, gz(u0)), P(u1, gz(u1)), P(u1, top), P(u0, top), [[u0, 0], [u1, 0], [u1, top - gz(u1)], [u0, top - gz(u0)]])
    for (ua, za), (ub, zb) in zip(crv, crv[1:]):
        face.quad(P(ua, za), P(ub, zb), P(ub, top), P(ua, top), [[ua, za - base], [ub, zb - base], [ub, top - base], [ua, top - base]])
    # the reveal, 0.45 m deep: the jambs and the arch's soffit
    d = 0.45
    for u in (x0, x1):
        face.quad(P(u, gz(u)), P(u, gz(u), d), P(u, crv[0][1], d), P(u, crv[0][1]), [[0, 0], [d, 0], [d, 2.3], [0, 2.3]])
    for (ua, za), (ub, zb) in zip(crv, crv[1:]):
        face.quad(P(ua, za), P(ub, zb), P(ub, zb, d), P(ua, za, d), [[ua, 0], [ub, 0], [ub, d], [ua, d]])
    # the infill: mostly a lit front (the bars and shops under the tracks), some shuttered, some bricked up
    r = (seed * 2654435761) % 100
    fill = K["rail_shop"] if r < 62 else K["rail_shutter"] if r < 84 else face
    zf = gz(0) if g0 < g1 else gz(L)
    pts = [(x0, zf)] + crv + [(x1, zf)]
    c = (x0 + w / 2, zf)
    for (ua, za), (ub, zb) in zip(pts, pts[1:]):
        fill.tri(P(c[0], c[1], d), P(ua, za, d), P(ub, zb, d), [[c[0] - x0, 0], [ua - x0, za - zf], [ub - x0, zb - zf]])
    if fill is K["rail_shop"]:   # a sign band over the door and an awning's edge
        zb = base + 2.55
        K["rail_dark"].box(P(x0 + 0.1, zb, d - 0.12), P(x1 - 0.1, zb, d - 0.12), 0.1, 0.32)
