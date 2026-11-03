"""Parts shared by the Tokyo district maps built after the first four (cities/ueno, cities/ikebukuro,
cities/jinbocho, cities/roppongi, cities/tsukishima, cities/odaiba, cities/shinagawa), on top of
pipeline/japankit.py:

  * Ponds: garden and park ponds above the scene's sea-level water plane, each drawn as a sheet of
    water at its own low shore (the laser DEM's ground over a pond is the interpolated surface), the
    grid cut under it so the water lies in a basin with low banks, as pipeline/shinkai.py does for
    Shinjuku Gyoen. Lotus leaves where a pond is a lotus pond.
  * A five-storey pagoda of any size, a bronze figure on a granite pedestal, rows of stone lanterns, a
    lit street gate with a name board, and the sign words of a street's trades.
  * Small helpers for the game: a spot, a thing to walk up to.

Every landmark here is placed on OpenStreetMap's footprint of it (via Overture) by its city.py.
"""
import math

import numpy as np
from shapely.geometry import Point, Polygon

import japankit as jk
from japankit import block, frame, lathe_at, slab_at, taper, unit, left_of

WATER = {"pond_water": {"color": "#1f3438", "roughness": 0.06, "metalness": 0.25},
         "pond_bank": {"color": "#4a4438", "roughness": 0.95, "metalness": 0.0},
         "lotus": {"color": "#5d6b3a", "roughness": 0.8, "metalness": 0.0},
         "lotus_dry": {"color": "#6e5c3c", "roughness": 0.92, "metalness": 0.0}}


def rnd(p, k=2):
    return [round(float(c), k) for c in p]


def xy(p):
    return [round(float(p[0]), 2), round(float(p[1]), 2)]


# ---------------------------------------------------------------- ponds

class Ponds:
    """The ponds a map draws: Overture water of class pond, chosen by `pick(name, geom)`, read once."""

    def __init__(self, pick, min_m2=800.0):
        self.pick, self.min_m2, self.cache = pick, min_m2, {}

    def list(self, C):
        if "list" not in self.cache:
            rows = jk.overture(C, "water", "class IN ('pond', 'lake', 'reservoir', 'basin')")
            out = []
            for r in rows:
                g = r["geom"]
                gs = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
                for q in gs:
                    if q.geom_type == "Polygon" and q.area >= self.min_m2 and self.pick(r["name"] or "", q):
                        out.append((r["name"] or "", q.buffer(0)))
            self.cache["list"] = out
        return self.cache["list"]

    def adjust_terrain(self, dem, C, cell):
        """Each pond's level is its low shore (the 15th percentile of the ground round it, from the finest
        grid seen); the grid inside is lowered 0.6 m below it and its bank to within a metre or so above."""
        ny, nx = dem.shape
        at = lambda q: dem[np.clip(np.round((C.y1 - q[:, 1]) / cell).astype(int), 0, ny - 1),
                           np.clip(np.round((q[:, 0] - C.x0) / cell).astype(int), 0, nx - 1)]
        fine = cell <= self.cache.get("cell", math.inf)
        for k, (_, g) in enumerate(self.list(C)):
            if fine:
                dense = np.array([g.exterior.interpolate(t).coords[0] for t in np.arange(0, g.exterior.length, 2.0)])
                self.cache[k] = float(np.percentile(at(dense), 15))
            level = self.cache[k]
            bank = 1.2 * cell
            x0, y0, x1, y1 = g.buffer(bank).bounds
            c0, c1 = max(0, int((x0 - C.x0) / cell)), min(nx, int((x1 - C.x0) / cell) + 2)
            r0, r1 = max(0, int((C.y1 - y1) / cell)), min(ny, int((C.y1 - y0) / cell) + 2)
            for c in range(c0, c1):
                for r in range(r0, r1):
                    q = Point(C.x0 + c * cell, C.y1 - r * cell)
                    if g.contains(q):
                        dem[r, c] = min(dem[r, c], level - 0.6)
                    else:
                        d = g.exterior.distance(q)
                        if d < bank:
                            dem[r, c] = min(dem[r, c], level + 0.35 + 1.2 * d / bank)
        if fine:
            self.cache["cell"] = cell
        return dem

    def anchors(self, C, ground):
        """[{name, ring, holes, z}] for the meshes and the game."""
        out = []
        for k, (n, g) in enumerate(self.list(C)):
            if k in self.cache:
                z = self.cache[k]
            else:
                dense = [g.exterior.interpolate(t).coords[0] for t in np.arange(0, g.exterior.length, 2.0)]
                z = float(np.percentile([ground(*p) for p in dense], 15))
            s = g.simplify(0.4)
            out.append({"name": n, "ring": [rnd(p, 1) for p in np.asarray(s.exterior.coords)[:-1]],
                        "holes": [[rnd(p, 1) for p in np.asarray(h.coords)[:-1]] for h in s.interiors], "z": round(z, 2)})
        return out


def _poly(p):
    return Polygon(p["ring"], p.get("holes") or [])


def pond_meshes(K, ponds, lotus=(), season_dry=True, seed=7):
    """Each pond a flat sheet of water at its shore's height; lotus leaves over the ponds named in `lotus`,
    in clumps, kept a few metres off the shore; dry brown leaves (autumn and winter) if season_dry."""
    import shapely
    rng = np.random.default_rng(seed)
    W = K("pond_water")
    for p in ponds:
        g = _poly(p)
        z = p["z"]
        for tri in shapely.constrained_delaunay_triangles(g).geoms:
            a, b, c = np.asarray(tri.exterior.coords)[:3]
            if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0:
                b, c = c, b
            W.tri([*a, z], [*b, z], [*c, z])
        if p["name"] not in lotus:
            continue
        L = K("lotus_dry" if season_dry else "lotus")
        inner = g.buffer(-5.0)
        if inner.is_empty:
            continue
        # the leaves grow in wide beds with open water between them: beds as unions of discs, drawn as a
        # surface of leaves a few centimetres over the water, ragged at the edge with single leaves
        x0, y0, x1, y1 = inner.bounds
        discs = []
        for _ in range(int(inner.area / 900)):
            c = np.array([rng.uniform(x0, x1), rng.uniform(y0, y1)])
            for _ in range(10):
                q = c + rng.normal(0, 9.0, 2)
                discs.append(Point(*q).buffer(rng.uniform(3.0, 7.0), quad_segs=4))
        import shapely
        beds = shapely.union_all(discs).intersection(inner).simplify(0.6)
        for bed in getattr(beds, "geoms", [beds]):
            if bed.geom_type != "Polygon" or bed.area < 4:
                continue
            for tri in shapely.constrained_delaunay_triangles(bed).geoms:
                a, b, c = np.asarray(tri.exterior.coords)[:3]
                if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0:
                    b, c = c, b
                L.tri([*a, z + 0.06], [*b, z + 0.06], [*c, z + 0.06])
            ring = bed.exterior
            for t in np.arange(0, ring.length, 1.6):
                e = ring.interpolate(t)
                for _ in range(2):
                    q = np.array([e.x, e.y]) + rng.normal(0, 1.0, 2)
                    if not inner.contains(Point(*q)):
                        continue
                    r = rng.uniform(0.3, 0.6)
                    h = z + 0.05 + rng.uniform(0, 0.35 if season_dry else 0.25)
                    a0 = rng.uniform(0, math.tau)
                    pts = [np.array([q[0] + r * math.cos(a0 + k), q[1] + r * math.sin(a0 + k), h + rng.normal(0, 0.05)]) for k in np.linspace(0, math.tau, 6)[:-1]]
                    ctr = np.array([q[0], q[1], h - 0.04])
                    for i in range(5):
                        L.tri(ctr, pts[i], pts[(i + 1) % 5])
            if season_dry:   # dry stalks standing out of the beds
                bx0, by0, bx1, by1 = bed.bounds
                for _ in range(int(bed.area / 6)):
                    q = (rng.uniform(bx0, bx1), rng.uniform(by0, by1))
                    if bed.contains(Point(*q)):
                        L.box(np.array([q[0], q[1], z]), np.array([q[0] + rng.normal(0, 0.1), q[1] + rng.normal(0, 0.1), z + rng.uniform(0.3, 1.0)]), 0.03, 0.03)


# ---------------------------------------------------------------- a five-storey pagoda

def pagoda(K, c, ax, z0, total, base_half=2.8, sorin=None, podium=1.2, mats=None):
    """A five-storey pagoda (五重塔) on a stone podium: `total` m from the ground to the finial's tip, the
    first storey `base_half` m from its centre to a wall; each storey a little narrower, short walls under
    deep eaves, bracket bands, rails round the upper storeys, and the sorin (a third of the height above
    the top roof) with its nine rings. mats: {wall, post, roof, soffit, stone, bronze, gold}."""
    m = {"wall": "vermilion", "post": "vermilion", "roof": "tile", "soffit": "soffit", "stone": "stone", "bronze": "bronze", "gold": "gold", "bracket": "vermilion", **(mats or {})}
    P = frame(c, ax)
    sor = sorin or total * 0.27
    block(K(m["stone"]), P, -base_half - 1.2, base_half + 1.2, -base_half - 1.2, base_half + 1.2, z0 - 0.3, z0 + podium)
    zb = z0 + podium
    tip = z0 + total
    zt = tip - sor
    h = (zt - zb) / 5.0
    ov = base_half * 0.9
    for s in range(5):
        w = base_half * (1 - 0.06 * s)
        za = zb + s * h
        zw = za + h * 0.42
        block(K(m["wall"]), P, -w, w, -w, w, za, zw)
        for uu in np.linspace(-w, w, 4):
            for sgn in (-1, 1):
                slab_at(K(m["post"]), P, uu, sgn * w, 0.28, 0.28, za, zw)
                slab_at(K(m["post"]), P, sgn * w, uu, 0.28, 0.28, za, zw)
        block(K(m["bracket"], "brackets"), P, -w - 0.5, w + 0.5, -w - 0.5, w + 0.5, zw, zw + h * 0.16)
        ze = zw + h * 0.16
        o = ov * (1 - 0.04 * s)
        if s < 4:   # the roof runs up into the storey above (a little inside its wall), so no gap shows under it
            E = w + 0.5 + o
            w2 = base_half * (1 - 0.06 * (s + 1))
            H = (za + h - ze) / ((E - w2 + 0.3) / E) ** 1.7
        else:
            H = h * 0.42
        jk.hip_roof(K(m["roof"]), K(m["soffit"]), P, w + 0.5, w + 0.5, ze, ze + H, ov=o, k=1.7)
        if s < 4:
            w2 = base_half * (1 - 0.06 * (s + 1))
            rail = [P(su * (w2 + 0.45), sv * (w2 + 0.45), za + h) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1))]
            K(m["post"]).rails(rail, 0.6, post_every=1.4, post=0.08, rail=0.06, rails=2)
    x, y, _ = P(0, 0, 0)
    lathe_at(K(m["bronze"]), x, y, [(zt - 0.4, base_half * 0.38), (zt + 0.5, base_half * 0.3), (zt + 0.6, 0.12), (tip - 0.4, 0.1), (tip, 0.0)], 12)
    lathe_at(K(m["bronze"]), x, y, [(zt + 0.6, 0.0), (zt + 0.7, 0.6), (zt + 1.2, 0.62), (zt + 1.35, 0.0)], 12)
    for k in range(9):
        z = zt + 1.8 + k * (sor * 0.55) / 9
        r = 0.6 - 0.025 * k
        lathe_at(K(m["bronze"]), x, y, [(z, 0.0), (z + 0.05, r), (z + 0.22, r), (z + 0.27, 0.0)], 12)
    zf = zt + 1.8 + sor * 0.6
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        K(m["gold"]).quad(np.array([x, y, zf]), np.array([x + 0.7 * math.cos(a), y + 0.7 * math.sin(a), zf + 0.4]),
                          np.array([x + 0.5 * math.cos(a), y + 0.5 * math.sin(a), zf + 1.6]), np.array([x, y, zf + 1.3]))
    lathe_at(K(m["gold"]), x, y, [(tip - 1.6, 0.0), (tip - 1.3, 0.3), (tip - 1.0, 0.22), (tip - 0.8, 0.0)], 12)


# ---------------------------------------------------------------- a bronze figure, a stone lantern

def figure(K, x, y, z0, h, face, mat="bronze", robe=0.34, stride=0.0):
    """A standing figure in a robe (a statue): legs under the robe's hem, the body, arms by the sides,
    the head; `face` the unit vector it looks along. Proportions of a man of 7.5 heads."""
    f = unit(face)
    l = left_of(f)
    H = h / 7.5
    zk = z0 + H * 2.0          # the robe's hem, at the knees
    for s in (-1, 1):          # the legs and feet
        p = np.array([x, y]) + l * s * H * 0.22 + f * s * stride * H
        K(mat).box(np.array([*p, z0]), np.array([*p, zk + 0.1]), H * 0.32, H * 0.32)
        q = p + f * H * 0.18
        K(mat).box(np.array([*q, z0]), np.array([*q, z0 + H * 0.15]), H * 0.35, H * 0.5)
    lathe_at(K(mat), x, y, [(zk, robe * h / 3.7 * 1.1), (z0 + H * 4.2, robe * h / 3.7 * 0.95), (z0 + H * 5.6, robe * h / 3.7 * 1.0),
                            (z0 + H * 6.25, robe * h / 3.7 * 0.55), (z0 + H * 6.4, H * 0.22)], 12)
    for s in (-1, 1):          # the arms, from the shoulder down the robe's side
        a = np.array([x, y]) + l * s * H * 0.85
        b = np.array([x, y]) + l * s * H * 0.95 + f * H * 0.15
        K(mat).tube([np.array([*a, z0 + H * 6.0]), np.array([*b, z0 + H * 4.6]), np.array([*(b + f * H * 0.2), z0 + H * 3.8])], H * 0.2, 6)
    lathe_at(K(mat), x, y, [(z0 + H * 6.35, 0.0), (z0 + H * 6.45, H * 0.42), (z0 + H * 6.9, H * 0.48), (z0 + H * 7.3, H * 0.38), (z0 + h, 0.0)], 10)


def dog(K, x, y, z0, face, h=0.85, mat="bronze"):
    """A dog standing at its master's side: body, legs, head and ears, tail."""
    f, l = unit(face), left_of(unit(face))
    L = h * 1.1
    p = lambda u, v, z: np.array([x + f[0] * u + l[0] * v, y + f[1] * u + l[1] * v, z])
    for u in (-L * 0.38, L * 0.38):
        for v in (-h * 0.13, h * 0.13):
            K(mat).box(p(u, v, z0), p(u, v, z0 + h * 0.55), h * 0.1, h * 0.1)
    K(mat).tube([p(-L * 0.5, 0, z0 + h * 0.62), p(L * 0.5, 0, z0 + h * 0.66)], h * 0.2, 8)
    K(mat).tube([p(L * 0.45, 0, z0 + h * 0.7), p(L * 0.62, 0, z0 + h * 0.95)], h * 0.12, 6)
    K(mat).box(p(L * 0.6, 0, z0 + h * 0.9), p(L * 0.85, 0, z0 + h * 0.88), h * 0.15, h * 0.2)
    for v in (-0.07, 0.07):
        K(mat).box(p(L * 0.6, v * h, z0 + h * 1.0), p(L * 0.6, v * h * 1.3, z0 + h * 1.14), h * 0.06, h * 0.06)
    K(mat).tube([p(-L * 0.5, 0, z0 + h * 0.66), p(-L * 0.62, 0, z0 + h * 0.85), p(-L * 0.58, 0, z0 + h * 0.95)], h * 0.05, 5)


def stone_lantern(K, x, y, z0, h=2.3, mat="stone", lamp="paper"):
    """A stone lantern (石灯籠): base, post, fire box, cap and jewel."""
    s = h / 2.3
    lathe_at(K(mat), x, y, [(z0, 0.42 * s), (z0 + 0.25 * s, 0.4 * s), (z0 + 0.3 * s, 0.13 * s), (z0 + 1.15 * s, 0.13 * s), (z0 + 1.2 * s, 0.34 * s),
                            (z0 + 1.3 * s, 0.3 * s), (z0 + 1.3 * s, 0.0)], 6)
    lathe_at(K(lamp, "lit"), x, y, [(z0 + 1.3 * s, 0.22 * s), (z0 + 1.7 * s, 0.22 * s), (z0 + 1.7 * s, 0.0)], 6)
    lathe_at(K(mat), x, y, [(z0 + 1.7 * s, 0.5 * s), (z0 + 1.8 * s, 0.46 * s), (z0 + 2.0 * s, 0.16 * s), (z0 + 2.08 * s, 0.13 * s),
                            (z0 + 2.2 * s, 0.11 * s), (z0 + h, 0.0)], 6)


# ---------------------------------------------------------------- an octagonal hall

def octagon_hall(K, c, z0, r, wall_h, roof_h, mats, face=(1.0, 0.0), podium=0.6):
    """An octagonal hall (八角堂) on a stone podium: vermilion posts and walls, a sweeping eight-sided roof
    and a jewel (宝珠) on top; the doors on the face that looks along `face`."""
    x, y = c
    a0 = math.atan2(face[1], face[0]) + math.pi / 8
    ring = lambda rr, z: [np.array([x + rr * math.cos(a0 + k * math.pi / 4), y + rr * math.sin(a0 + k * math.pi / 4), z]) for k in range(8)]
    lathe_at(K(mats["stone"]), x, y, [(z0 - 0.3, r * 1.3), (z0 + podium, r * 1.3), (z0 + podium, 0.0)], 8)
    zb = z0 + podium
    lo, hi = ring(r, zb), ring(r, zb + wall_h)
    for k in range(8):
        j = (k + 1) % 8
        K(mats["wall"]).quad(lo[k], lo[j], hi[j], hi[k])
        K(mats["post"]).box(lo[k], hi[k], 0.32, 0.32)
    # the doors: a dark panel on the face toward `face`
    d0, d1 = ring(r + 0.03, zb), ring(r + 0.03, zb + wall_h * 0.78)
    m0, m1 = (d0[7] * 0.3 + d0[0] * 0.7), (d0[7] * 0.7 + d0[0] * 0.3)
    K(mats["door"]).quad(m0, m1, m1 + (d1[0] - d0[0]), m0 + (d1[0] - d0[0]))
    zt = zb + wall_h
    K(mats["bracket"], "brackets").lathe([(zt, r + 0.1), (zt + 0.5, r + 0.6), (zt + 0.5, 0.0)], (x, y), 8)
    ze = zt + 0.5
    ov = r * 0.6
    rings = []
    for t in np.linspace(0, 1, 7):
        rr = (r + ov) * (1 - t) + 0.4 * t
        z = ze + roof_h * t ** 1.7 + (0.35 * ov * (1 - t) if t < 0.3 else 0.0)
        rings.append(ring(rr / math.cos(math.pi / 8), z))
    for A, B in zip(rings, rings[1:]):
        for k in range(8):
            j = (k + 1) % 8
            K(mats["roof"]).quad(A[k], A[j], B[j], B[k])
    E = rings[0]
    for k in range(8):
        j = (k + 1) % 8
        K(mats["soffit"]).quad(E[j], E[k], hi[k] + np.array([0, 0, 0.5]), hi[j] + np.array([0, 0, 0.5]))
    ztop = ze + roof_h
    lathe_at(K(mats["gold"]), x, y, [(ztop - 0.1, 0.45), (ztop + 0.3, 0.4), (ztop + 0.45, 0.3), (ztop + 0.9, 0.42), (ztop + 1.25, 0.25), (ztop + 1.5, 0.0)], 12)


# ---------------------------------------------------------------- a street gate with a lit name board

def street_gate(K, atlas, key, c, along, width, z0, clear=5.2, board_h=1.6, board_w=None, mat="frame"):
    """Two posts either side of a lane and a lit board across it between them (a shopping street's
    arch, 商店街のゲート); the board's words face both ways along the lane."""
    f = unit(along)
    l = left_of(f)
    c = np.asarray(c, float)
    bw = board_w or width * 0.8
    for s in (-1, 1):
        p = c + l * s * width / 2
        K(mat).box(np.array([*p, z0]), np.array([*p, z0 + clear + board_h + 0.3]), 0.35, 0.35)
    K(mat).box(np.array([*(c - l * width / 2), z0 + clear + board_h + 0.2]), np.array([*(c + l * width / 2), z0 + clear + board_h + 0.2]), 0.3, 0.3)
    K(mat).box(np.array([*(c - l * width / 2), z0 + clear - 0.1]), np.array([*(c + l * width / 2), z0 + clear - 0.1]), 0.25, 0.25)
    A = K("atlas", "lit")
    for side in (-1, 1):
        n = f * side
        t = np.array([-n[1], n[0]])
        o = c + n * 0.18
        a, b = o - t * bw / 2, o + t * bw / 2
        atlas.quad(A, np.array([*a, z0 + clear]), np.array([*b, z0 + clear]), np.array([*b, z0 + clear + board_h]), np.array([*a, z0 + clear + board_h]), key)
    block(K(mat), frame(c, f), -0.16, 0.16, -bw / 2, bw / 2, z0 + clear, z0 + clear + board_h)


# ---------------------------------------------------------------- the game

def spot(sid, name, at, z, verb, lines, radius=4.0):
    return {"id": sid, "name": name, "at": [round(float(at[0]), 2), round(float(at[1]), 2), round(float(z), 2)], "verb": verb, "lines": lines, "radius": radius}


def close_to(name, at, z, start, within=1.5, keep=0.0):
    """A thing to walk up to (game.json "close"): `at` on it at the floor's height z, the walk starting at
    `start`; tools/close_step.js must get within `within` m and never nearer than `keep`."""
    return {**({"name": name} if name else {}), "at": [*xy(at), round(float(z), 2)], "from": xy(start), "within": within, **({"keep": keep} if keep else {})}


def near_line(g, pts, d):
    """Whether geometry g is within d m of the polyline pts."""
    from shapely.geometry import LineString
    return LineString(pts).distance(g) < d


# ---------------------------------------------------------------- names on roofs

def roof_name_sites(C, names, min_edge=6.0):
    """For each building whose name is drawn on its roof ({key, ring, top_m, ground_m}), the footprint's edge
    that faces the nearest main road: its middle, outward normal, length and the roof's height."""
    roads = [r["geom"] for r in jk.overture(C, "segment", "subtype = 'road' AND class IN ('primary', 'secondary', 'tertiary')")
             if r["geom"].geom_type == "LineString"]
    out = []
    for n in names:
        g = Polygon(n["ring"])
        if not roads:
            break
        near = min(roads, key=lambda ln: ln.distance(g.centroid))
        p = near.interpolate(near.project(g.centroid))
        cs = np.asarray(g.exterior.coords)
        best = None
        for a, b in zip(cs[:-1], cs[1:]):
            mid = (a + b) / 2
            L = float(np.linalg.norm(b - a))
            if L < min_edge:
                continue
            e = (b - a) / L
            nrm = np.array([e[1], -e[0]]) if g.exterior.is_ccw else np.array([-e[1], e[0]])
            score = float(np.linalg.norm(mid - [p.x, p.y]))
            if (np.array([p.x, p.y]) - mid) @ nrm > 0 and (best is None or score < best[0]):
                best = (score, mid, nrm, L)
        if best:
            _, mid, nrm, L = best
            out.append({"key": n["key"], "mid": rnd(mid), "n": rnd(nrm, 4), "L": round(L, 1), "z": round(n["ground_m"] + n["top_m"], 2)})
    return out


def roof_names(K, atlas, sites, max_w=22.0, aspect=5.3, mat="frame"):
    """The names on their roofs' edges, on steel legs, lit after dark (atlas cells name_<key>)."""
    A = K("atlas", "lit")
    for r in sites:
        n, mid = np.asarray(r["n"]), np.asarray(r["mid"])
        t = np.array([-n[1], n[0]])
        w = min(r["L"] * 0.8, max_w)
        h = w / aspect
        c = mid + n * 0.3
        a, b = c - t * w / 2, c + t * w / 2
        z0 = r["z"] + 0.6
        atlas.quad(A, np.array([*a, z0]), np.array([*b, z0]), np.array([*b, z0 + h]), np.array([*a, z0 + h]), f"name_{r['key']}")
        for s in np.linspace(-w / 2 + 0.5, w / 2 - 0.5, 5):
            p = mid - n * 0.3 + t * s
            K(mat).box(np.array([*p, r["z"]]), np.array([*p, z0 + h * 0.8]), 0.18, 0.18)


def draw_names(d, atlas, names):
    """Atlas cells for roof names: {key: (words, background, ink, font)}."""
    for k, (words, bg, ink, fname) in names.items():
        x, y, w, h = atlas.rects[f"name_{k}"]
        d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=bg)
        jk.text(d, (x + w / 2, y + h / 2), words, fname, jk.fit(d, [words], fname, w - 30, h - 14, 90), ink)


def draw_signs(d, atlas, blades, boards):
    """Atlas cells blade<i> (vertical words) and board<i> (a lit board) for jk.street_signs."""
    for i, (words, bg, ink, fname) in enumerate(blades):
        x, y, w, h = atlas.rects[f"blade{i}"]
        d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=bg)
        d.rectangle([x + 3, y + 3, x + w - 3, y + h - 3], outline=ink, width=2)
        jk.vertical(d, words.replace(" ", ""), x + w / 2, y + 10, y + h - 10, fname, ink, w - 12)
    for i, (words, bg, ink, fname) in enumerate(boards):
        x, y, w, h = atlas.rects[f"board{i}"]
        d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=bg)
        jk.text(d, (x + w / 2, y + h / 2), words, fname, jk.fit(d, [words], fname, w - 24, h - 16, 80), ink)


def sign_glows(sites, every=3, colours=("#ffd9a0", "#ffffff", "#ffb070"), strength=0.26):
    return [[round(x + nx * 3.0, 1), round(y + ny * 3.0, 1), 8.0, colours[k % len(colours)], strength]
            for k, (x, y, nx, ny, g, top, L) in enumerate(sites) if k % every == 0]
