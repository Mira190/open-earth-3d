"""Parts for hero levels in the open: roads on a hillside, walls, planting, poles and wires, signs
(blender/hero_kit.py has the kit itself and blender/hero_parts.py the parts of a street or a quay;
cities/kamakura/hero.py was the first to use these; docs/HERO.md).

A street between buildings (cities/shinjuku/hero.py) is fronts and a flat floor. A road on a hill, a canal
path or a forecourt is ground that follows the terrain, with walls, banks and planting either side of it,
so the parts here are:

  * Path: a road's centre line with heights, and points a distance along it and to its right;
  * Parts.cover: ground draped on the city's terrain every metre and cut to an outline (a road's asphalt as
    one surface with the lanes that meet it, a bank's grass), so that the terrain never shows through it;
  * Parts.strip, decal: markings, patches and ironwork on that ground;
  * Parts.wall: a retaining wall along a line, battered, with a coping;
  * Parts.hedge, bush: clipped hedges and shrubs, in a leaf texture drawn here (leaf_texture: no CC0 set
    of a hedge's face was found on ambientCG);
  * Parts.pole, wire: a concrete utility pole with crossarms, insulators, a transformer and a street
    light (which the bake takes as a light), and wires that sag between two points;
  * Parts.sign, bollard, pipe_fence.

texture_variant makes a second set of a CC0 texture with its roughness remapped (ambientCG's grass is
glossy as scanned: 0.26), kept beside the original in data/raw/hero_tex.
"""
import math
import os

import numpy as np

UP = np.array([0.0, 0.0, 1.0])


def unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


# ---------------------------------------------------------------- textures made here

def _save_set(K, tid, colour, height=None, rough=0.9, normal_k=2.0, size="1K"):
    """Write a texture set where hero_kit.fetch_texture looks for one (so it is not downloaded)."""
    from PIL import Image
    d = os.path.join(K.TEX_DIR, tid)
    os.makedirs(d, exist_ok=True)
    colour.convert("RGB").save(os.path.join(d, f"{tid}_{size}-JPG_Color.jpg"), quality=92)
    n = colour.size[0]
    if height is None:
        nrm = Image.new("RGB", (n, n), (128, 128, 255))
    else:
        h = np.asarray(height, float)
        gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * normal_k
        gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * normal_k
        v = np.dstack([-gx, gy, np.ones_like(h)])
        v /= np.linalg.norm(v, axis=2, keepdims=True)
        nrm = Image.fromarray(((v * 0.5 + 0.5) * 255).astype(np.uint8))
    nrm.save(os.path.join(d, f"{tid}_{size}-JPG_NormalGL.jpg"), quality=92)
    r = rough if not isinstance(rough, (int, float)) else Image.new("L", (n, n), int(rough * 255))
    r.convert("L").save(os.path.join(d, f"{tid}_{size}-JPG_Roughness.jpg"), quality=92)
    orm = os.path.join(d, f"{tid}_{size}_ORM.png")
    if os.path.exists(orm):
        os.remove(orm)


def leaf_texture(K, tid="OELeaf001", n=1024, seed=5, leaf=(26, 11), greens=((38, 70, 30), (66, 104, 44), (96, 134, 58)), count=9000):
    """A hedge's or a shrub's face: small leaves over one another, the deep ones dark, tileable; with the
    height that gives its normal map. Drawn, so that it is ours (CC0 with the project)."""
    if os.path.exists(os.path.join(K.TEX_DIR, tid, f"{tid}_1K-JPG_Color.jpg")):
        return tid
    from PIL import Image, ImageDraw
    rng = np.random.default_rng(seed)
    S = 2
    img = Image.new("RGB", (n * S, n * S), (10, 20, 9))
    hgt = Image.new("L", (n * S, n * S), 0)
    d, dh = ImageDraw.Draw(img), ImageDraw.Draw(hgt)
    for i in range(count):
        t = i / count                               # drawn back to front: later leaves are nearer and lighter
        cx, cy = rng.random(2) * n * S
        a = rng.random() * math.pi
        L, W = leaf[0] * S * (0.7 + 0.6 * rng.random()) / 2, leaf[1] * S * (0.7 + 0.6 * rng.random()) / 2
        g0, g1 = (greens[0], greens[1]) if t < 0.5 else (greens[1], greens[2])
        k = (t * 2) % 1.0 if t < 1 else 1
        col = tuple(int((g0[c] + (g1[c] - g0[c]) * k) * (0.82 + 0.3 * rng.random())) for c in range(3))
        ca, sa = math.cos(a), math.sin(a)
        pts = []
        for th in np.linspace(0, 2 * math.pi, 12, endpoint=False):
            x, y = L * math.cos(th) * (1 - 0.25 * abs(math.sin(th))), W * math.sin(th)
            pts.append((x * ca - y * sa, x * sa + y * ca))
        for ox in (-n * S, 0, n * S):               # wrapped, so that it tiles
            for oy in (-n * S, 0, n * S):
                if not (-L * 2 < cx + ox < n * S + L * 2 and -L * 2 < cy + oy < n * S + L * 2):
                    continue
                q = [(cx + ox + x, cy + oy + y) for x, y in pts]
                d.polygon(q, fill=col)
                dh.polygon(q, fill=int(40 + 215 * t))
                d.line([(cx + ox - L * ca, cy + oy - L * sa), (cx + ox + L * ca, cy + oy + L * sa)], fill=tuple(int(c * 1.18) for c in col), width=S)
    img = img.resize((n, n), Image.LANCZOS)
    hgt = hgt.resize((n, n), Image.LANCZOS)
    _save_set(K, tid, img, np.asarray(hgt, float) / 255.0, rough=0.86, normal_k=5.0)
    return tid


def texture_variant(K, tid, base, rough=(1.0, 0.0), gain=1.0):
    """A second set of the CC0 texture `base`: its roughness scaled and offset, its colour scaled."""
    if os.path.exists(os.path.join(K.TEX_DIR, tid, f"{tid}_1K-JPG_Color.jpg")):
        return tid
    from PIL import Image
    K.TEXTURES["_base"] = (base, 1.0)
    T = K.fetch_texture("_base")
    del K.TEXTURES["_base"]
    d = os.path.join(K.TEX_DIR, tid)
    os.makedirs(d, exist_ok=True)
    c = np.asarray(Image.open(T["Color"]).convert("RGB"), float) * gain
    Image.fromarray(np.clip(c, 0, 255).astype(np.uint8)).save(os.path.join(d, f"{tid}_1K-JPG_Color.jpg"), quality=92)
    Image.open(T["NormalGL"]).convert("RGB").save(os.path.join(d, f"{tid}_1K-JPG_NormalGL.jpg"), quality=92)
    r = np.asarray(Image.open(T["Roughness"]).convert("L"), float) / 255.0
    Image.fromarray((np.clip(r * rough[0] + rough[1], 0, 1) * 255).astype(np.uint8)).save(os.path.join(d, f"{tid}_1K-JPG_Roughness.jpg"), quality=92)
    return tid


# ---------------------------------------------------------------- a road's centre line

class Path:
    """A line with heights (x, y, z each metre or so): points along it and to its right."""

    def __init__(self, pts, origin=None):
        self.p = np.asarray(pts, float)
        seg = np.linalg.norm(np.diff(self.p[:, :2], axis=0), axis=1)
        self.s = np.r_[0, np.cumsum(seg)]
        self.L = float(self.s[-1])
        self.s0 = 0.0
        if origin is not None:
            self.s0 = float(self.s[int(np.argmin(np.hypot(self.p[:, 0] - origin[0], self.p[:, 1] - origin[1])))])

    def at(self, d):
        """Centre (x, y, z), the unit tangent and the right-hand normal, d metres from the path's origin."""
        s = float(np.clip(d + self.s0, 0, self.L))
        i = int(np.clip(np.searchsorted(self.s, s) - 1, 0, len(self.p) - 2))
        f = (s - self.s[i]) / max(1e-6, self.s[i + 1] - self.s[i])
        c = self.p[i] + (self.p[i + 1] - self.p[i]) * f
        a, b = self.p[max(i - 2, 0), :2], self.p[min(i + 3, len(self.p) - 1), :2]
        t = (b - a) / (np.linalg.norm(b - a) or 1)
        return c, t, np.array([t[1], -t[0]])

    def xy(self, d, o=0.0):
        c, t, r = self.at(d)
        return c[:2] + r * o

    def line(self, d0=None, d1=None, step=1.0, o=0.0):
        d0 = -self.s0 if d0 is None else d0
        d1 = self.L - self.s0 if d1 is None else d1
        n = max(1, int(math.ceil((d1 - d0) / step)))
        return [self.xy(d0 + (d1 - d0) * i / n, o) for i in range(n + 1)]

    def band(self, d0, d1, o0, o1, step=1.0):
        """The outline (a shapely polygon) between two offsets along a stretch."""
        from shapely.geometry import Polygon
        return Polygon(self.line(d0, d1, step, o0) + self.line(d0, d1, step, o1)[::-1]).buffer(0)

    def dist(self, q):
        return float(np.hypot(self.p[:, 0] - q[0], self.p[:, 1] - q[1]).min())


# ---------------------------------------------------------------- the parts

class Parts:
    """Built on a hero_kit.Geo (`geo`), over a terrain T(x, y) -> z (pipeline/archkit.Terrain)."""

    def __init__(self, K, geo, T, atlas=None):
        self.K, self.geo, self.T, self.A = K, geo, T, atlas

    def G(self, q, h=0.0):
        """A point on the ground: (x, y) -> (x, y, terrain + h)."""
        return np.array([q[0], q[1], self.T(q[0], q[1]) + h])

    # -- ground
    def cover(self, mat, poly, h, cell=1.0, uvk=1.0, ao=None, zfn=None):
        """Ground draped on the terrain, cut to `poly` (shapely): a grid every `cell` metres, each cell kept
        whole inside, cut on the outline; uv in metres of the map, so that neighbours meet without a seam."""
        import shapely
        from shapely.geometry import box
        from shapely.prepared import prep
        if poly.is_empty:
            return
        g = self.geo.part(mat)
        z = zfn or (lambda x, y: self.T(x, y) + h)
        x0, y0, x1, y1 = poly.bounds
        x0, y0 = math.floor(x0 / cell) * cell, math.floor(y0 / cell) * cell
        pp = prep(poly)
        idx = {}

        def vert(x, y):
            k = (round(x, 3), round(y, 3))
            if k not in idx:
                idx[k] = len(g["p"])
                g["p"].append(np.array([x, y, z(x, y)])); g["n"].append(UP); g["uv"].append((x * uvk, y * uvk)); g["ao"].append(1.0 if ao is None else ao)
            return idx[k]

        def tri(a, b, c):
            if a == b or b == c or a == c:
                return
            pa, pb, pc = g["p"][a], g["p"][b], g["p"][c]
            if abs(np.cross(pb - pa, pc - pa)[2]) < 1e-7:
                return
            if np.cross(pb - pa, pc - pa)[2] < 0:
                b, c = c, b
            g["tri"].append((a, b, c))

        nx, ny = int(math.ceil((x1 - x0) / cell)), int(math.ceil((y1 - y0) / cell))
        for j in range(ny):
            for i in range(nx):
                cx, cy = x0 + i * cell, y0 + j * cell
                sq = box(cx, cy, cx + cell, cy + cell)
                if not pp.intersects(sq):
                    continue
                if pp.contains(sq):
                    a, b, c, d = vert(cx, cy), vert(cx + cell, cy), vert(cx + cell, cy + cell), vert(cx, cy + cell)
                    tri(a, b, c); tri(a, c, d)
                    continue
                part = poly.intersection(sq)
                for piece in getattr(part, "geoms", [part]):
                    if piece.geom_type != "Polygon" or piece.area < 1e-4:
                        continue
                    for t in shapely.constrained_delaunay_triangles(piece).geoms:
                        co = list(t.exterior.coords)[:3]
                        tri(*[vert(x, y) for x, y in co])
        # smooth normals from the terrain's slope
        e = 0.5
        for k, i in idx.items():
            x, y = g["p"][i][0], g["p"][i][1]
            g["n"][i] = unit([(z(x - e, y) - z(x + e, y)) / (2 * e), (z(x, y - e) - z(x, y + e)) / (2 * e), 1.0])

    def strip(self, mat, fn, d0, d1, offs, h, step=1.0, uvk=1.0, across=1.0):
        """A ribbon of ground: fn(d, o, h) along d0..d1 between the offsets `offs` (to the right), cut no
        wider than `across` so that it follows the ground; uv in metres."""
        n = max(1, int(math.ceil((d1 - d0) / step)))
        ds = [d0 + (d1 - d0) * i / n for i in range(n + 1)]
        os_ = [offs[0]]
        for a, b in zip(offs, offs[1:]):
            m = max(1, int(math.ceil(abs(b - a) / across)))
            os_ += [a + (b - a) * (k + 1) / m for k in range(m)]
        for i in range(n):
            for j in range(len(os_) - 1):
                a, b = fn(ds[i], os_[j], h), fn(ds[i], os_[j + 1], h)
                c, d = fn(ds[i + 1], os_[j + 1], h), fn(ds[i + 1], os_[j], h)
                uv = [(os_[j] * uvk, ds[i] * uvk), (os_[j + 1] * uvk, ds[i] * uvk), (os_[j + 1] * uvk, ds[i + 1] * uvk), (os_[j] * uvk, ds[i + 1] * uvk)]
                self.geo.quad(mat, a, b, c, d, uv=uv, n=UP)

    def decal(self, mat, c, t, w, l, uv=None, h=0.0):
        """A flat rectangle on the ground at c (x, y, z), l long along t and w wide."""
        t = np.r_[unit(np.asarray(t, float)[:2]), 0]
        r = np.array([t[1], -t[0], 0])
        c = np.asarray(c, float) + [0, 0, h]
        self.geo.quad(mat, c - r * w / 2 - t * l / 2, c + r * w / 2 - t * l / 2, c + r * w / 2 + t * l / 2, c - r * w / 2 + t * l / 2, uv=uv, n=UP)

    # -- walls
    def wall(self, mat, pts, zb, zt, batter=0.0, uvk=1.0, cap=None, thick=0.3, back=False, v0=0.0, lip=0.0, left=False):
        """A wall along pts (x, y), facing the right of the way they run (the left with `left`); zb and zt
        per point (or one number); `batter` leans its top back by that share of its height; cap: a material
        for its coping (thick wide, standing `lip` proud of the face); back: its far face too."""
        G = self.geo
        pts = [np.asarray(p, float)[:2] for p in pts]
        zb = [zb] * len(pts) if isinstance(zb, (int, float)) else list(zb)
        zt = [zt] * len(pts) if isinstance(zt, (int, float)) else list(zt)
        if left:
            pts, zb, zt = pts[::-1], zb[::-1], zt[::-1]
        nrm = [normal(pts, i) for i in range(len(pts))]
        s = 0.0
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            L = np.linalg.norm(b - a)
            if L < 1e-3:
                continue
            na, nb = nrm[i], nrm[i + 1]
            ha, hb = zt[i] - zb[i], zt[i + 1] - zb[i + 1]
            A0, B0 = np.r_[a, zb[i]], np.r_[b, zb[i + 1]]
            A1, B1 = np.r_[a - na * batter * ha, zt[i]], np.r_[b - nb * batter * hb, zt[i + 1]]
            n = unit(np.r_[(na + nb) / 2, batter])
            G.quad(mat, A0, B0, B1, A1, uv=[(s * uvk, v0), ((s + L) * uvk, v0), ((s + L) * uvk, v0 + hb * uvk), (s * uvk, v0 + ha * uvk)], n=n,
                   sub=(max(1, int(L / 1.5)), max(1, int(max(ha, hb) / 1.2))))
            G.walls.append((a, b, min(zb[i], zb[i + 1]), max(zt[i], zt[i + 1])))
            if cap:
                A1l, B1l = A1 + np.r_[na, 0] * lip, B1 + np.r_[nb, 0] * lip
                A2, B2 = A1 - np.r_[na, 0] * thick, B1 - np.r_[nb, 0] * thick
                G.quad(cap, A1l + UP * 0.06, B1l + UP * 0.06, B2 + UP * 0.06, A2 + UP * 0.06, uv=[(s, 0), (s + L, 0), (s + L, thick), (s, thick)], n=UP)
                G.quad(cap, A1l - UP * 0.02, B1l - UP * 0.02, B1l + UP * 0.06, A1l + UP * 0.06, uv=[(s, 0), (s + L, 0), (s + L, 0.08), (s, 0.08)], n=n)
                if back:
                    G.quad(mat, np.r_[B2[:2], zb[i + 1]], np.r_[A2[:2], zb[i]], A2 + UP * 0.06, B2 + UP * 0.06, n=-np.r_[(na + nb) / 2, 0])
            s += L

    # -- planting
    def hedge(self, mat, pts, w, h, seed=0, rough=0.06):
        """A clipped hedge along pts (x, y, z of its foot): a squarish section, slightly uneven, smooth."""
        g = self.geo.part(mat)
        rng = np.random.default_rng(seed)
        pts = [np.asarray(p, float) for p in pts]
        fine = []
        for a, b in zip(pts, pts[1:]):
            n = max(1, int(np.linalg.norm(b - a) / 0.4))
            fine += [a + (b - a) * k / n for k in range(n)]
        fine.append(pts[-1])
        K = 11
        rings, s = [], 0.0
        sq = lambda v: math.copysign(abs(v) ** 0.35, v)   # a squarer section than an ellipse: clipped
        for i, p in enumerate(fine):
            t = unit((fine[min(i + 1, len(fine) - 1)] - fine[max(i - 1, 0)])[:2])
            r = np.array([t[1], -t[0], 0.0])
            if i:
                s += np.linalg.norm(p - fine[i - 1])
            base = len(g["p"])
            end = min(i, len(fine) - 1 - i)
            k_end = (0.55, 0.9, 1.0)[min(end, 2)]
            for k in range(K):
                a = math.pi * k / (K - 1)
                bump = 1 + rough * rng.standard_normal()
                x, zz = -sq(math.cos(a)) * w / 2 * k_end, sq(math.sin(a)) * h * (0.9 + 0.1 * k_end)
                q = p + r * x * bump + UP * (zz * bump)
                nn = unit(r * -math.cos(a) + UP * math.sin(a))
                g["p"].append(q); g["n"].append(nn); g["uv"].append((a / math.pi * (w + 2 * h), s)); g["ao"].append(0.45 + 0.55 * math.sin(a) ** 0.6)
            rings.append(base)
        for i in range(len(rings) - 1):
            for k in range(K - 1):
                a0, a1, b0, b1 = rings[i] + k, rings[i] + k + 1, rings[i + 1] + k, rings[i + 1] + k + 1
                g["tri"] += [(a0, a1, b1), (a0, b1, b0)]
        for ring, flip in ((rings[0], False), (rings[-1], True)):   # its ends
            for k in range(1, K - 2):
                g["tri"].append((ring, ring + k + 1, ring + k) if not flip else (ring, ring + k, ring + k + 1))

    def bush(self, mat, c, r, h=None, seed=0, lumps=0.22):
        """A shrub: a lumpy dome on the ground at c (x, y, z), radius r and height h."""
        g = self.geo.part(mat)
        rng = np.random.default_rng(seed)
        h = h or r * 1.1
        c = np.asarray(c, float)
        ph = rng.random(6) * 6.28
        NA, NB = 14, 7
        base = len(g["p"])
        for j in range(NB + 1):
            b = (math.pi / 2) * j / NB * 1.12 - 0.18          # from a little under the ground to the top
            for i in range(NA):
                a = 2 * math.pi * i / NA
                k = 1 + lumps * (math.sin(3 * a + ph[0] + 2 * b) * 0.6 + math.sin(5 * a + ph[1]) * math.cos(3 * b + ph[2]) * 0.5 + 0.35 * math.sin(7 * a + 5 * b + ph[3]))
                d = np.array([math.cos(a) * math.cos(b), math.sin(a) * math.cos(b), math.sin(b)])
                g["p"].append(c + d * np.array([r, r, h]) * k); g["n"].append(unit(d * np.array([1 / r, 1 / r, 1 / h])))
                g["uv"].append((a / (2 * math.pi) * 2 * math.pi * r, b * h)); g["ao"].append(float(np.clip(0.35 + 0.75 * math.sin(max(b, 0)) ** 0.7, 0, 1)))
        for j in range(NB):
            for i in range(NA):
                a0, a1 = base + j * NA + i, base + j * NA + (i + 1) % NA
                b0, b1 = a0 + NA, a1 + NA
                g["tri"] += [(a0, a1, b1), (a0, b1, b0)]

    # -- things that stand
    def post(self, mat, c, r, h, segs=8):
        self.geo.cylinder(mat, c, r, h, segs)

    def sign(self, c, facing, key, size, hgt, mat="board", post="metal_galv", back="metal_galv"):
        """A sign on a post at c, its face (the atlas cell `key`) towards `facing` (x, y), its centre hgt up."""
        G, A = self.geo, self.A
        f = np.r_[unit(np.asarray(facing, float)[:2]), 0]
        r = np.array([f[1], -f[0], 0.0])
        self.post(post, c, 0.03, hgt + size[1] / 2 + 0.05, 8)
        o = np.asarray(c, float) + f * 0.04 + UP * hgt
        w, h = size
        q = (o + r * w / 2 - UP * h / 2, o - r * w / 2 - UP * h / 2, o - r * w / 2 + UP * h / 2, o + r * w / 2 + UP * h / 2)
        G.quad(mat, *q, uv=A.uv(key), n=f)
        G.quad(back, q[1] - f * 0.012, q[0] - f * 0.012, q[3] - f * 0.012, q[2] - f * 0.012, n=-f)

    def panel(self, mat, o, facing, size, key=None, back=None):
        """A flat panel centred at o (x, y, z) facing `facing` (x, y): the atlas cell `key` on it."""
        f = np.r_[unit(np.asarray(facing, float)[:2]), 0]
        r = np.array([f[1], -f[0], 0.0])
        o = np.asarray(o, float)
        w, h = size
        q = (o + r * w / 2 - UP * h / 2, o - r * w / 2 - UP * h / 2, o - r * w / 2 + UP * h / 2, o + r * w / 2 + UP * h / 2)
        self.geo.quad(mat, *q, uv=self.A.uv(key) if key else None, n=f)
        if back:
            self.geo.quad(back, q[1] - f * 0.03, q[0] - f * 0.03, q[3] - f * 0.03, q[2] - f * 0.03, n=-f)

    def wire(self, a, b, sag, r=0.011, mat="cable", n=10):
        a, b = np.asarray(a, float), np.asarray(b, float)
        pts = [a + (b - a) * (k / n) - UP * sag * 4 * (k / n) * (1 - k / n) for k in range(n + 1)]
        self.geo.tube(mat, pts, r, 4)

    def pole(self, c, h=11.5, arms=(), lamp=None, transformer=False, low=True, lamp_z=7.2, lamp_k=520.0, lamp_rgb=(0.92, 0.96, 1.0)):
        """A concrete utility pole (materials pole, metal_galv, porcelain, metal_alu, glow_white):
        crossarms [(height, heading of the arm)] with three insulators each, a rack of low-voltage
        insulators, a transformer, and an LED street light on an arm towards `lamp` (x, y), which the bake
        takes as a light. Returns where its wires hang: {"hv": [...], "lv": [3], "tel": [2]}."""
        G = self.geo
        c = np.asarray(c, float)
        for (z0, z1, r0) in ((-0.3, h * 0.35, 0.165), (h * 0.35, h * 0.7, 0.145), (h * 0.7, h, 0.125)):   # tapered in three lifts
            G.tube("pole", [c + UP * z0, c + UP * z1], r0, 12)
        G.cylinder("pole", c + UP * h, 0.125, 0.02, 12)
        G.box("metal_alu", c + UP * 1.75 + np.array([0.0, -0.17, 0]), ((1, 0, 0), (0, 1, 0)), (0.12, 0.012, 0.3))   # its number plate
        for k in range(8):   # the climbing pegs
            a = k % 2 * math.pi
            e = np.array([math.cos(a), math.sin(a), 0])
            G.tube("metal_galv", [c + e * 0.13 + UP * (2.6 + k * 0.45), c + e * 0.3 + UP * (2.6 + k * 0.45)], 0.009, 4)
        out = {"hv": [], "lv": [], "tel": []}
        for (z, hd) in arms:
            e = np.array([math.cos(hd), math.sin(hd), 0.0])
            n = np.array([-e[1], e[0], 0.0])
            G.box("metal_galv", c + UP * z + n * 0.16, (e, n), (1.8, 0.075, 0.075))
            for sgn in (1, -1):
                G.tube("metal_galv", [c + UP * (z - 0.55) + n * 0.14, c + UP * z + n * 0.16 + e * 0.6 * sgn], 0.012, 4)
            for o in (-0.8, -0.25, 0.8):
                q = c + UP * (z + 0.075) + n * 0.16 + e * o
                G.cylinder("porcelain", q, 0.04, 0.16, 8)
                G.cylinder("porcelain", q + UP * 0.05, 0.07, 0.03, 8)
                G.cylinder("porcelain", q + UP * 0.1, 0.06, 0.025, 8)
                out["hv"].append(q + UP * 0.17)
        if low:
            for k in range(3):   # the low-voltage rack: three insulators one over another on the pole's side
                q = c + UP * (h - 3.4 - k * 0.3)
                G.cylinder("porcelain", q + np.array([0.17, 0, -0.04]), 0.04, 0.08, 6)
                out["lv"].append(q + np.array([0.19, 0, 0.0]))
            for k in range(2):
                q = c + UP * (h - 5.4 - k * 0.5)
                G.box("metal_galv", q + np.array([0.15, 0, -0.05]), ((1, 0, 0), (0, 1, 0)), (0.1, 0.06, 0.1))
                out["tel"].append(q + np.array([0.19, 0, 0]))
        if transformer:
            q = c + UP * (h - 2.9) + np.array([0, -0.42, 0])
            G.cylinder("metal_galv", q, 0.27, 0.8, 14)
            G.cylinder("metal_galv", q + UP * 0.8, 0.2, 0.06, 14)
            for zz in (0.12, 0.62):
                G.tube("metal_dark", [q + UP * zz + np.array([math.cos(a), math.sin(a), 0]) * 0.275 for a in np.linspace(0, 2 * math.pi, 15)], 0.012, 4)
            G.box("metal_galv", c + UP * (h - 2.95) + np.array([0, -0.2, 0]), ((1, 0, 0), (0, 1, 0)), (0.5, 0.5, 0.06))
            for o in (-0.1, 0.1):
                G.cylinder("porcelain", q + UP * 0.86 + np.array([o, 0, 0]), 0.03, 0.14, 6)
                self.wire(q + UP * 1.0 + np.array([o, 0, 0]), c + UP * (h - 0.9) + np.array([o * 3, 0.1, 0]), 0.12, 0.006, n=5)
        if lamp is not None:
            e = np.r_[unit(np.asarray(lamp, float)[:2]), 0]
            z = lamp_z
            G.tube("metal_galv", [c + UP * (z - 0.5) + e * 0.13, c + UP * (z - 0.1) + e * 0.55, c + UP * (z + 0.08) + e * 1.5], 0.022, 6)
            hd = c + UP * (z + 0.03) + e * 1.75
            n = np.array([-e[1], e[0], 0.0])
            G.box("metal_alu", hd, (e, n), (0.6, 0.24, 0.07))
            G.box("glow_white", hd - UP * 0.012, (e, n), (0.46, 0.16, 0.012), faces=("bot", "+u", "-u", "+v", "-v"))
            G.emitters.append((hd - UP * 0.05, -UP, 0.5, np.asarray(lamp_rgb, float) * lamp_k))
        return out

    def bollard(self, c, h=0.85, mat="metal_galv", r=0.057):
        self.geo.cylinder(mat, c, r, h, 10)
        self.geo.cylinder(mat, np.asarray(c, float) + UP * h, r + 0.008, 0.03, 10)

    def pipe_fence(self, a, b, h=1.1, mat="metal_galv", rails=(1.05, 0.6, 0.15), every=1.8, r=0.022):
        a, b = np.asarray(a, float), np.asarray(b, float)
        n = max(1, int(np.linalg.norm(b - a) / every))
        for k in range(n + 1):
            self.geo.cylinder(mat, a + (b - a) * k / n, r + 0.003, h, 6)
        for z in rails:
            self.geo.tube(mat, [a + UP * z, b + UP * z], r, 6)

    def disc(self, mat, c, ax, r, n=24, dome=0.0, uv=False):
        """A disc at c facing along ax; `dome` bulges its middle (a convex mirror)."""
        g = self.geo.part(mat)
        ax = unit(ax)
        u = unit(np.cross(ax, UP if abs(ax[2]) < 0.9 else [1, 0, 0])); v = np.cross(u, ax)
        base = len(g["p"])
        g["p"].append(np.asarray(c, float) + ax * dome); g["n"].append(ax); g["uv"].append((0.5, 0.5)); g["ao"].append(1.0)
        for k in range(n):
            a = 2 * math.pi * k / n
            e = math.cos(a) * u + math.sin(a) * v
            g["p"].append(np.asarray(c, float) + e * r); g["n"].append(unit(ax + e * (dome / r * 2.5))); g["uv"].append((0.5 + 0.5 * math.cos(a), 0.5 + 0.5 * math.sin(a))); g["ao"].append(1.0)
        for k in range(n):
            a, b = base + 1 + k, base + 1 + (k + 1) % n
            pa, pb = g["p"][a] - g["p"][base], g["p"][b] - g["p"][base]
            g["tri"].append((base, a, b) if np.dot(np.cross(pa, pb), ax) > 0 else (base, b, a))


def normal(line, i):
    """The right-hand normal of a line of (x, y) at its point i."""
    a, b = np.asarray(line[max(i - 1, 0)], float)[:2], np.asarray(line[min(i + 1, len(line) - 1)], float)[:2]
    u = unit(b - a)
    return np.array([u[1], -u[0]])
