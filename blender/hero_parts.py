"""Parts a hero level is put together from (docs/HERO.md), on the kit's Geo (blender/hero_kit.py): the ground
the game walks on as a surface to pave, a wall's own frame with openings cut into it, windows set into their
reveals, and the furniture of a street or a quay (lamp posts, benches, bollards, bins).

Everything is in the city's local frame (x east, y north, z up, metres). Texture coordinates are in repeats of
the material's texture (hero_kit.TEXTURES gives the metres one repeat covers), so `rep` below is that length.
The finest pieces (glazing bars, slats' fixings, rails) go to geo.fine: a second model the page fetches only
near the camera and never on a phone.
"""
import json
import math

import numpy as np


def unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


# ---------------------------------------------------------------- the ground the game has

class Ground:
    """The game's own walking surface over a rectangle (tools/ground_probe.js): z(x, y) bilinear on its grid,
    None-safe over water (the nearest land's level), and water(x, y)."""

    def __init__(self, path):
        d = json.load(open(path))
        self.x0, self.y0, self.step, self.nx, self.ny = d["x0"], d["y0"], d["step"], d["nx"], d["ny"]
        self.Z = np.array(d["z"], float).reshape(self.ny, self.nx)
        self.W = np.array(list(d["water"]), int).reshape(self.ny, self.nx).astype(bool)
        # over the water the probe reads the bed: take the nearest land's level there instead
        Z = self.Z.copy()
        wet = self.W | (Z < 0.3)
        if wet.any() and (~wet).any():
            from scipy import ndimage
            idx = ndimage.distance_transform_edt(wet, return_distances=False, return_indices=True)
            Z = Z[idx[0], idx[1]]
        self.L = Z

    def _bil(self, A, x, y):
        fx = min(max((x - self.x0) / self.step, 0), self.nx - 1.001)
        fy = min(max((y - self.y0) / self.step, 0), self.ny - 1.001)
        i, j = int(fx), int(fy)
        u, v = fx - i, fy - j
        return (A[j, i] * (1 - u) + A[j, i + 1] * u) * (1 - v) + (A[j + 1, i] * (1 - u) + A[j + 1, i + 1] * u) * v

    def z(self, x, y):
        return float(self._bil(self.L, x, y))

    def water(self, x, y):
        i = int(round(min(max((x - self.x0) / self.step, 0), self.nx - 1)))
        j = int(round(min(max((y - self.y0) / self.step, 0), self.ny - 1)))
        return bool(self.W[j, i])


def pave(geo, mat, ground, area, rep, cell=1.0, dz=0.04, rot=False, ao=None):
    """Paving laid on the ground over a shapely area: a grid of `cell` m clipped to the area's outline (each
    cell cut by the outline, so that edges are true), dz over the ground. rot turns the texture a quarter."""
    from shapely.geometry import box
    from shapely.ops import triangulate
    from shapely.prepared import prep
    x0, y0, x1, y1 = area.bounds
    pa = prep(area)
    P, tri, idx = [], [], {}

    def vid(x, y):
        k = (round(x, 3), round(y, 3))
        if k not in idx:
            idx[k] = len(P)
            P.append((x, y, ground.z(x, y) + dz))
        return idx[k]

    for gx in np.arange(math.floor(x0 / cell) * cell, x1, cell):
        for gy in np.arange(math.floor(y0 / cell) * cell, y1, cell):
            c = box(gx, gy, gx + cell, gy + cell)
            if pa.contains(c):
                a, b, cc, d = vid(gx, gy), vid(gx + cell, gy), vid(gx + cell, gy + cell), vid(gx, gy + cell)
                tri += [(a, b, cc), (a, cc, d)]
            elif pa.intersects(c):
                part = area.intersection(c)
                for poly in getattr(part, "geoms", [part]):
                    if poly.geom_type != "Polygon" or poly.area < 1e-4:
                        continue
                    for t in triangulate(poly):
                        if t.area < 1e-5 or not poly.contains(t.representative_point()):
                            continue
                        q = list(t.exterior.coords)[:3]
                        if (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]) < 0:
                            q = q[::-1]
                        tri.append(tuple(vid(*p) for p in q))
    if not P:
        return
    P = np.array(P)
    uv = P[:, :2] / rep
    if rot:
        uv = np.c_[P[:, 1], -P[:, 0]] / rep
    geo.mesh(mat, P, tri, uv=uv, ao=ao)


def decal(geo, mat, ground, c, ax, w, h, uv=None, dz=0.05):
    """A flat thing on the ground (a manhole's cover, a plaque, a drain), w along ax and h across."""
    c = np.array([c[0], c[1], ground.z(*c[:2]) + dz])
    u = unit(np.r_[ax[:2], 0.0])
    v = np.array([-u[1], u[0], 0.0])
    geo.quad(mat, c - u * w / 2 - v * h / 2, c + u * w / 2 - v * h / 2, c + u * w / 2 + v * h / 2, c - u * w / 2 + v * h / 2, uv=uv)


def disc(geo, mat, c, r, z, uv=None, segs=24, n=(0, 0, 1.0)):
    """A flat disc at height z (a plaque in the paving, a clock's face when n is a wall's): uv the atlas cell's corners."""
    n = unit(n)
    a = unit(np.cross(n, [0, 0, 1.0])) if abs(n[2]) < 0.9 else np.array([1.0, 0, 0])
    b = np.cross(n, a)
    c = np.array([c[0], c[1], z])
    P, U = [c], [(0.5, 0.5)]
    for k in range(segs):
        th = 2 * math.pi * k / segs
        P.append(c + (a * math.cos(th) + b * math.sin(th)) * r)
        U.append((0.5 + 0.5 * math.cos(th), 0.5 + 0.5 * math.sin(th)))
    if uv is not None:
        (u0, v0), (u1, _), (_, v1), _ = uv
        U = [(u0 + (u1 - u0) * s, v0 + (v1 - v0) * t) for s, t in U]
    geo.mesh(mat, P, [(0, 1 + k, 1 + (k + 1) % segs) for k in range(segs)], n=n, uv=U)


def blob(geo, mat, ground, c, r, rng, dz=0.058, stretch=1.0):
    """An irregular flat patch on the ground (a stain, a puddle, a drift of fallen flowers)."""
    k = 18
    ph = rng.random(3) * 6.28
    ang = rng.random() * math.pi
    P = [(c[0], c[1], ground.z(*c) + dz)]
    U = [(0.5, 0.5)]
    for i in range(k):
        a = 2 * math.pi * i / k
        rr = r * (1 + 0.25 * math.sin(3 * a + ph[0]) + 0.15 * math.sin(5 * a + ph[1]))
        x, y = math.cos(a) * rr * stretch, math.sin(a) * rr
        x, y = x * math.cos(ang) - y * math.sin(ang), x * math.sin(ang) + y * math.cos(ang)
        P.append((c[0] + x, c[1] + y, ground.z(c[0] + x, c[1] + y) + dz))
        U.append((0.5 + x / (2 * r), 0.5 + y / (2 * r)))
    geo.mesh(mat, P, [(0, 1 + i, 1 + (i + 1) % k) for i in range(k)], uv=U)


# ---------------------------------------------------------------- a wall's frame

class Frame:
    """A wall from a to b (x, y), seen from its front with a on the left: P(u, out, z) is u metres along it,
    `out` metres in front of it, at height z (absolute)."""

    def __init__(self, a, b, flip=False):
        a, b = np.asarray(a, float)[:2], np.asarray(b, float)[:2]
        if flip:
            a, b = b, a
        self.a, self.b = a, b
        self.len = float(np.linalg.norm(b - a))
        self.t = (b - a) / self.len
        self.n = np.array([self.t[1], -self.t[0]])      # out of the wall, to the right of a -> b

    def P(self, u, out, z):
        q = self.a + self.t * u + self.n * out
        return np.array([q[0], q[1], z])

    @property
    def T(self):
        return np.r_[self.t, 0.0]

    @property
    def N(self):
        return np.r_[self.n, 0.0]


def wall(geo, mat, F, u0, u1, z0, z1, out, rep, holes=(), ao=None, sub=3.0, zf=None):
    """A wall's face between u0..u1 and z0..z1 at `out`, with rectangular holes [(u0, u1, z0, z1)] left open.
    Cut into panels no larger than `sub` m, so that the bake has vertices to light. zf(u) -> the foot's height
    where the ground under the wall is not level (z0 then is the lowest foot)."""
    us = sorted(set([u0, u1] + [h[k] for h in holes for k in (0, 1) if u0 < h[k] < u1]))
    zs = sorted(set([z0, z1] + [h[k] for h in holes for k in (2, 3) if z0 < h[k] < z1]))

    def split(v):
        out_ = [v[0]]
        for a, b in zip(v[:-1], v[1:]):
            n = max(1, int(math.ceil((b - a) / sub)))
            out_ += [a + (b - a) * (i + 1) / n for i in range(n)]
        return out_
    us, zs = split(us), split(zs)
    for i in range(len(us) - 1):
        for j in range(len(zs) - 1):
            ua, ub, za, zb = us[i], us[i + 1], zs[j], zs[j + 1]
            um, zm = (ua + ub) / 2, (za + zb) / 2
            if any(h[0] <= um <= h[1] and h[2] <= zm <= h[3] for h in holes):
                continue
            fa, fb = (zf(ua), zf(ub)) if (zf and j == 0) else (za, za)
            geo.quad(mat, F.P(ua, out, fa), F.P(ub, out, fb), F.P(ub, out, zb), F.P(ua, out, zb),
                     uv=[(ua / rep, fa / rep), (ub / rep, fb / rep), (ub / rep, zb / rep), (ua / rep, zb / rep)], n=F.N, ao=ao)


def fbox(geo, mat, F, u0, u1, o0, o1, z0, z1, rep=1.0, faces=("front", "left", "right", "top", "bottom"), ao=None, emit=None):
    """A box on a wall's frame: u0..u1 along, o0..o1 out of it, z0..z1 up (a pier, a sill, a cornice, a canopy)."""
    P = F.P
    Q = {
        "front": (P(u0, o1, z0), P(u1, o1, z0), P(u1, o1, z1), P(u0, o1, z1)),
        "back": (P(u1, o0, z0), P(u0, o0, z0), P(u0, o0, z1), P(u1, o0, z1)),
        "left": (P(u0, o0, z0), P(u0, o1, z0), P(u0, o1, z1), P(u0, o0, z1)),
        "right": (P(u1, o1, z0), P(u1, o0, z0), P(u1, o0, z1), P(u1, o1, z1)),
        "top": (P(u0, o1, z1), P(u1, o1, z1), P(u1, o0, z1), P(u0, o0, z1)),
        "bottom": (P(u0, o0, z0), P(u1, o0, z0), P(u1, o1, z0), P(u0, o1, z0)),
    }
    for k in faces:
        q = Q[k]
        l1, l2 = np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[3] - q[0])
        a0 = (u0 if k in ("front", "back", "top", "bottom") else o0) / rep
        b0 = (z0 if k in ("front", "back", "left", "right") else o0) / rep
        geo.quad(mat, *q, uv=[(a0, b0), (a0 + l1 / rep, b0), (a0 + l1 / rep, b0 + l2 / rep), (a0, b0 + l2 / rep)], ao=ao,
                 emit=emit if (emit and k == "front") else None)


def window(geo, F, u0, u1, z0, z1, out, depth, wall_mat, rep, glass="win_glass", uv=None, frame="metal_bronze",
           bars=(1, 2), sill=True, emit=None, ao=0.7):
    """A window set `depth` back from a wall's face at `out`: the glass (uv: its atlas cell), the reveals in the
    wall's own stone, a sill, the frame; and, in the fine model, its glazing bars (bars: uprights, transoms)."""
    d = out - depth
    P = F.P
    geo.quad(glass, P(u0, d, z0), P(u1, d, z0), P(u1, d, z1), P(u0, d, z1), uv=uv, n=F.N, emit=emit)
    for (a, b) in (((u0, z0), (u1, z0)), ((u1, z0), (u1, z1)), ((u1, z1), (u0, z1)), ((u0, z1), (u0, z0))):
        pa, pb = P(a[0], d, a[1]), P(b[0], d, b[1])
        ln = np.linalg.norm(pb - pa)
        geo.quad(wall_mat, pa, pb, P(b[0], out, b[1]), P(a[0], out, a[1]),
                 uv=[(0, 0), (ln / rep, 0), (ln / rep, depth / rep), (0, depth / rep)], ao=ao)
    if sill:
        fbox(geo, wall_mat, F, u0 - 0.08, u1 + 0.08, out, out + 0.07, z0 - 0.14, z0, rep, faces=("front", "left", "right", "top", "bottom"))
    # the frame: a rim just in front of the glass
    t = 0.055
    for (a0, a1, b0, b1) in ((u0, u1, z0, z0 + t), (u0, u1, z1 - t, z1), (u0, u0 + t, z0, z1), (u1 - t, u1, z0, z1)):
        fbox(geo, frame, F, a0, a1, d, d + 0.05, b0, b1, faces=("front", "left", "right", "top", "bottom"))
    fine = geo.fine
    nu, nv = bars
    for i in range(nu):
        um = u0 + (u1 - u0) * (i + 1) / (nu + 1)
        fbox(fine, frame, F, um - 0.02, um + 0.02, d, d + 0.04, z0 + t, z1 - t, faces=("front", "left", "right"))
    for j in range(nv):
        zm = z0 + (z1 - z0) * (j + 1) / (nv + 1)
        fbox(fine, frame, F, u0 + t, u1 - t, d, d + 0.035, zm - 0.018, zm + 0.018, faces=("front", "top", "bottom"))


# ---------------------------------------------------------------- furniture

def lamp_post(geo, c, heading, z, h=9.5, arms=((1.6, 8.9), (-1.6, 8.9)), low=None, banner=None, mat="metal_pole",
              light="glow_lamp", rgb=(1.0, 0.86, 0.66), power=170.0):
    """A tapered steel post with outreach arms (reach along `heading`, height) and flat LED luminaires; `low`
    (reach, height) a pedestrian luminaire; banner (atlas uvs a, b; width, height, foot height) a pair of
    banners on arms. Its light is baked: each luminaire is a lit face (power: its intensity)."""
    c = np.array([c[0], c[1], z])
    e = np.array([math.cos(heading), math.sin(heading), 0.0])
    s = np.array([-e[1], e[0], 0.0])
    geo.lathe(mat, c, [(0.2, 0.0), (0.2, 0.05), (0.15, 0.09), (0.15, 0.95), (0.125, 1.0), (0.105, 1.1), (0.062, h)], segs=12)
    geo.fine.lathe(mat, c, [(0.165, 0.3), (0.172, 0.31), (0.172, 0.34), (0.165, 0.35)], segs=12)   # the door's band
    for reach, zh in list(arms) + ([low] if low else []):
        d = e * (1 if reach > 0 else -1)
        r = abs(reach)
        p0 = c + [0, 0, zh - 0.35]
        geo.tube(mat, [p0, p0 + d * r * 0.35 + [0, 0, 0.27], p0 + d * r * 0.75 + [0, 0, 0.36], p0 + d * r + [0, 0, 0.35]], 0.035, segs=6)
        hc = c + d * (r + 0.28) + [0, 0, zh - 0.03]
        geo.box(mat, hc, (d, s), (0.62, 0.26, 0.07))
        q = [hc + d * a * 0.27 + s * b * 0.1 + [0, 0, -0.004] for a, b in ((-1, 1), (1, 1), (1, -1), (-1, -1))]
        geo.quad(light, *q, uv=[(0, 0), (1, 0), (1, 1), (0, 1)], n=(0, 0, -1.0))
        k = power * (0.35 if (low and (reach, zh) == tuple(low)) else 1.0)
        geo.emitters.append((hc + [0, 0, -0.05], np.array([0, 0, -1.0]), 1.0, np.asarray(rgb, float) * k))
    if banner:
        ua, ub, bw, bh, bz = banner
        for side, uv in ((1, ua), (-1, ub)):
            for zz in (bz, bz + bh):
                geo.tube(mat, [c + [0, 0, zz], c + s * side * (bw + 0.12) + [0, 0, zz]], 0.016, segs=5)
            a, b = c + s * side * 0.1, c + s * side * (0.1 + bw)
            if side < 0:
                a, b = b, a
            geo.quad("atlas_cloth", a + [0, 0, bz + 0.02], b + [0, 0, bz + 0.02], b + [0, 0, bz + bh - 0.02], a + [0, 0, bz + bh - 0.02], uv=uv, sub=(1, 3))


def bench(geo, c, heading, z, w=1.9, wood="wood_bench", metal="metal_steel", back=True):
    """A slatted hardwood bench on steel legs, facing `heading`."""
    c = np.array([c[0], c[1], z])
    f = np.array([math.cos(heading), math.sin(heading), 0.0])
    s = np.array([-f[1], f[0], 0.0])
    for i in range(5):       # the seat's slats
        geo.box(wood, c + f * (-0.2 + i * 0.1) + [0, 0, 0.43], (s, f), (w, 0.082, 0.035))
    if back:
        for i in range(3):
            geo.box(wood, c - f * (0.27 + i * 0.035) + [0, 0, 0.56 + i * 0.11], (s, f), (w, 0.03, 0.085))
    for side in (-1, 1):
        o = c + s * side * (w / 2 - 0.16)
        geo.box(metal, o + f * 0.0 + [0, 0, 0.0], (s, f), (0.05, 0.5, 0.045))             # the foot
        geo.box(metal, o + f * 0.18, (s, f), (0.05, 0.05, 0.43))
        geo.box(metal, o - f * 0.2, (s, f), (0.05, 0.05, 0.95 if back else 0.43))
        geo.box(metal, o + [0, 0, 0.39], (s, f), (0.05, 0.5, 0.04))
        if back:
            geo.fine.box(metal, o + [0, 0, 0.64], (s, f), (0.04, 0.46, 0.03))               # the arm
            geo.fine.box(metal, o + f * 0.2 + [0, 0, 0.43], (s, f), (0.04, 0.04, 0.22))


def bollard(geo, c, z, h=0.95, r=0.085, mat="metal_steel", band=None):
    """A street bollard: a steel post with a domed cap (and a reflective band in the fine model)."""
    c = np.array([c[0], c[1], z])
    geo.lathe(mat, c, [(r * 1.25, 0.0), (r * 1.25, 0.03), (r, 0.05), (r, h - 0.04), (r * 0.8, h - 0.01), (0.0, h)], segs=10)
    if band:
        geo.fine.lathe(band, c, [(r + 0.004, h - 0.2), (r + 0.004, h - 0.12)], segs=10)


def mooring_bollard(geo, c, z, mat="iron_black"):
    """A cast-iron quay bollard: a waisted drum under a mushroom head."""
    c = np.array([c[0], c[1], z])
    geo.lathe(mat, c, [(0.3, 0.0), (0.3, 0.05), (0.2, 0.1), (0.17, 0.3), (0.19, 0.44), (0.29, 0.5), (0.3, 0.56), (0.24, 0.62), (0.0, 0.64)], segs=14)


def bin_(geo, c, z, mat="metal_steel", dark="metal_dark"):
    """A stainless litter bin with a dark hood."""
    c = np.array([c[0], c[1], z])
    geo.lathe(mat, c, [(0.27, 0.05), (0.27, 0.86)], segs=14)
    geo.lathe(dark, c, [(0.2, 0.0), (0.2, 0.05), (0.27, 0.05)], segs=14)
    geo.lathe(dark, c, [(0.27, 0.86), (0.285, 0.88), (0.285, 1.0), (0.24, 1.06), (0.0, 1.08)], segs=14)
    geo.fine.lathe("rubber", c, [(0.287, 0.9), (0.287, 0.985)], segs=14)
