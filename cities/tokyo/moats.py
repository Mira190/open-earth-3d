"""The Imperial Palace's moats (皇居の濠), each at its own water level.

GSI's 5 m laser DEM has no returns from the water, and its gaps are filled from the castle's banks, so
the moats read several metres above the streets beside them (the Wadakura moat at 6.8 m against banks
of 2.8 m), and the bridges over them ramped down to the banks. Here each moat is water at its level:

  * the twelve moats of the Outer Garden at the water levels the Ministry of the Environment publishes
    (皇居外苑濠 濠別管理方針, Kokyo Gaien National Garden Office, March 2010: 水面標高 T.P. m, which is the
    scene's datum): Wadakura, Babasaki and Hibiya 1.43 m, Kikyo, Otemachi and Shimizu 1.87 m, Hamaguri
    2.37 m, Gaisen 2.85 m, Sakurada and the Nijubashi moat 3.82 m, Ushigafuchi 4.17 m, Hanzo and
    Chidorigafuchi 15.98 m;
  * the moats inside the palace (the Imperial Household Agency's, with no published level) at their low
    bank less 1.7 m, the median of the Outer Garden moats' banks over their water.

The outlines are OpenStreetMap's (Overture water, class moat). `python cities/tokyo/moats.py` writes
cities/tokyo/moats.json from the raw Overture water and the DEM (fetch_overture.py --only water,
fetch_tiles.py --only dem); the build reads that file:

  adjust_terrain  the grid inside each moat goes down to its bed (pipeline/build_scene.py load_dem)
  meshes          the water at its level, and the dressed stone walls (ishigaki) from the water up to
                  the bank (pipeline/landmarks.py)
  ponds           the moats are water to the game, at their level (pipeline/game_data.py game_ponds)
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "moats.json")
SOURCE = "Ministry of the Environment, Kokyo Gaien National Garden Office: 皇居外苑濠 濠別管理方針 (March 2010), 水面標高 (T.P. m)"
OFFICIAL = {   # name in OpenStreetMap: water level, T.P. m (SOURCE)
    "和田倉濠": 1.43, "馬場先濠": 1.43, "日比谷濠": 1.43,
    "桔梗濠": 1.87, "大手濠": 1.87, "清水濠": 1.87,
    "蛤濠": 2.37, "凱旋濠": 2.85,
    "桜田濠": 3.82, "二重橋濠": 3.82,   # the Nijubashi moat is the Sakurada moat's arm (the source's 桜田濠全体)
    "牛ヶ淵": 4.17, "半蔵濠": 15.98, "千鳥ヶ淵": 15.98,
}
FREEBOARD = 1.7    # m, the median of the Outer Garden moats' low banks (10th percentile) over their water
BED = 4.0          # m, the grid under the water: deep enough that a cell across the shore, sloping up to the
                   # bank, comes out of the water within a metre or so of it, behind the wall's foot (the
                   # published depths are 0.7 to 1.9 m; the game's basin is its own, a metre under the level)
BLEED = 10.0       # m beyond the shore that the DEM's fill over the water raises the banks
REACH = 12.0       # m back from the shore where the bank is the DEM's own
WALL_STEP = 2.5    # m between a wall's posts along the shore


def load():
    if not os.path.exists(PATH):
        return []
    return json.load(open(PATH, encoding="utf8"))["moats"]


def _poly(m):
    from shapely.geometry import Polygon
    return Polygon([p[:2] for p in m["ring"]], [[p[:2] for p in h] for h in m.get("holes", [])])


# ---------------------------------------------------------------- the build hooks

def adjust_terrain(dem, C, cell, lower=True):
    """The DEM's fill over the water bleeds onto the banks beside it, raising a street by the moat a metre
    or more: a point of the grid within BLEED of a moat stands no higher than the bank REACH back from the
    shore, along the line from the shore through it (a slope up to the palace keeps its height: the ground
    further back is higher). Then the points inside a moat go down to its bed, BED under its level."""
    import shapely
    from shapely.ops import nearest_points
    ny, nx = dem.shape
    gx, gy = np.meshgrid(C.x0 + np.arange(nx) * cell, C.y1 - np.arange(ny) * cell)
    moats = load()
    polys = [_poly(m) for m in moats]
    if not polys:
        return dem
    water = shapely.union_all(polys)
    raw = dem.copy()
    at = lambda x, y: raw[int(np.clip(round((C.y1 - y) / cell), 0, ny - 1)), int(np.clip(round((x - C.x0) / cell), 0, nx - 1))]
    near = water.buffer(BLEED)
    x0, y0, x1, y1 = near.bounds
    c0, c1 = max(0, int((x0 - C.x0) / cell)), min(nx, int((x1 - C.x0) / cell) + 2)
    r0, r1 = max(0, int((C.y1 - y1) / cell)), min(ny, int((C.y1 - y0) / cell) + 2)
    sub = (slice(r0, r1), slice(c0, c1))
    band = shapely.contains_xy(near, gx[sub], gy[sub]) & ~shapely.contains_xy(water, gx[sub], gy[sub])
    for r, c in zip(*np.nonzero(band)):
        r, c = r + r0, c + c0
        q = shapely.Point(gx[r, c], gy[r, c])
        e = np.asarray(nearest_points(water, q)[0].coords[0])
        d = np.asarray(q.coords[0]) - e
        n = float(np.hypot(*d))
        if n < 1e-6:
            continue
        b = e + d / n * REACH
        if water.contains(shapely.Point(*b)):   # a narrow causeway between two moats: its own ground
            continue
        dem[r, c] = min(dem[r, c], at(*b))
    if not lower:
        return dem
    for m, g in zip(moats, polys):
        x0, y0, x1, y1 = g.bounds
        c0, c1 = max(0, int((x0 - C.x0) / cell)), min(nx, int((x1 - C.x0) / cell) + 2)
        r0, r1 = max(0, int((C.y1 - y1) / cell)), min(ny, int((C.y1 - y0) / cell) + 2)
        if c0 >= c1 or r0 >= r1:
            continue
        sub = (slice(r0, r1), slice(c0, c1))
        inside = shapely.contains_xy(g, gx[sub], gy[sub])
        dem[sub] = np.where(inside, np.minimum(dem[sub], m["level"] - BED), dem[sub])
    return dem


def ponds():
    """[{name, ring, holes, z}] for pipeline/game_data.py: water to the game, its basin a metre under z."""
    return [{"name": m["name"], "ring": [p[:2] for p in m["ring"]], "holes": [[p[:2] for p in h] for h in m.get("holes", [])],
             "z": m["level"]} for m in load()]


MATERIALS = {
    "moat_stone": {"color": "#6f6a60", "roughness": 0.94, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.55, "block_m": 0.95},
}


def meshes(Mesh):
    """The water of each moat at its level and its walls of dressed stone: from half a metre under the water
    up to the bank's ground along each shore, leaning back a sixth of their height (the ishigaki's batter) to
    their head on the outline.
    Where the bank beyond the shore is another moat's water, the wall stands up to the higher of the two."""
    import shapely
    import districtkit as dk
    moats = load()
    if not moats:
        return {}, []
    water = []
    wall = Mesh("moat_walls_moat_stone", "moat_stone", False, uv=True)
    for m in moats:
        water.append({"name": m["name"], "ring": [p[:2] for p in m["ring"]], "holes": [[p[:2] for p in h] for h in m.get("holes", [])], "z": m["level"]})
        g = _poly(m)
        for ring in [m["ring"]] + m.get("holes", []):
            P = np.asarray(ring, float)
            n = len(P)
            u = 0.0
            for k in range(n):
                a, b = P[k], P[(k + 1) % n]
                d = b[:2] - a[:2]
                L = float(np.hypot(*d))
                if L < 1e-3:
                    continue
                t = d / L
                out = np.array([t[1], -t[0]])          # off the water: the side of the edge outside the polygon
                if g.contains(shapely.Point(*(0.5 * (a[:2] + b[:2]) + out * 0.5))):
                    out = -out
                za0, zb0 = m["level"] - 0.5, m["level"] - 0.5
                za1, zb1 = a[2], b[2]
                if za1 - m["level"] < 0.3 and zb1 - m["level"] < 0.3:   # no bank over the water here (a weir to a lower moat)
                    u += L
                    continue
                # the head on the outline, the foot out in the water by the batter, a metre at the least: the
                # grid's cell across the shore comes out of the water behind it
                lean_a, lean_b = out * max(1.2, (za1 - za0) / 6.0), out * max(1.2, (zb1 - zb0) / 6.0)
                A0, B0 = [*(a[:2] - lean_a), za0], [*(b[:2] - lean_b), zb0]
                A1, B1 = [*a[:2], za1], [*b[:2], zb1]
                # counter-clockwise seen from the water (and the coping from above)
                if out @ np.array([t[1], -t[0]]) < 0:
                    wall.quad(A0, B0, B1, A1, [[u, za0], [u + L, zb0], [u + L, zb1], [u, za1]])
                else:
                    wall.quad(B0, A0, A1, B1, [[u + L, zb0], [u, za0], [u, za1], [u + L, zb1]])
                # the coping: a stone's width back from the wall's head, level with the bank
                C0, C1 = [*(a[:2] + out * 0.6), za1], [*(b[:2] + out * 0.6), zb1]
                if out @ np.array([t[1], -t[0]]) < 0:
                    wall.quad(A1, B1, C1, C0, [[u, 0], [u + L, 0], [u + L, 0.6], [u, 0.6]])
                else:
                    wall.quad(B1, A1, C0, C1, [[u + L, 0], [u, 0], [u, 0.6], [u + L, 0.6]])
                u += L

    class K:   # what dk.pond_meshes asks of a landmark kit
        def __init__(self):
            self.m = {}

        def __call__(self, mat):
            if mat not in self.m:
                self.m[mat] = Mesh(f"moat_water_{mat}", mat, False)
            return self.m[mat]
    k = K()
    dk.pond_meshes(k, water, lotus=())
    mats = {**MATERIALS, "pond_water": dk.WATER["pond_water"]}
    return mats, [wall] + [m for m in k.m.values() if m.v]


# ---------------------------------------------------------------- moats.json

def build():
    import sys
    sys.path.insert(0, os.path.join(HERE, "..", "..", "pipeline"))
    sys.argv = [sys.argv[0], "--city", "tokyo"]
    import shapely
    from scipy import ndimage
    from build_scene import DEM_CELL, load_dem, raster_mask, sample
    from cityctx import city_args
    import japankit as jk
    C, _ = city_args("moats")
    C.cfg = dict(C.cfg, terrain=dict(C.cfg["terrain"], level=[]))
    hooks, C.hooks = C.hooks, None
    dem = load_dem(C)   # the DEM as fetched, without these moats
    C.hooks = hooks
    ny, nx = dem.shape
    extent = shapely.box(C.x0, C.y0, C.x1, C.y1).buffer(-2)
    rows = jk.overture(C, "water", "class = 'moat'")
    found = []
    for r in rows:
        g = r["geom"].intersection(extent)
        for q in getattr(g, "geoms", [g]):
            if q.geom_type != "Polygon" or q.area < 400:
                continue
            q = q.buffer(0).simplify(0.4)
            mask = raster_mask([q], nx, ny, DEM_CELL, C.x0, C.y1)
            bank = ndimage.binary_dilation(mask, iterations=3) & ~ndimage.binary_dilation(mask, iterations=1)
            name = r["name"] or ""
            if name in OFFICIAL:
                level, src = OFFICIAL[name], "official"
            else:
                level, src = round(float(np.percentile(dem[bank], 10)) - FREEBOARD, 2), "estimate"
            found.append((name, q, level, src))
    def write(moats):
        with open(PATH, "w", encoding="utf8") as f:
            f.write('{"note": "The Imperial Palace moats: OpenStreetMap outlines (ODbL, via Overture), rings [x, y, bank top] in the local frame; '
                    'level in T.P. m, official from ' + SOURCE.replace('"', "'") + ', else the low bank less ' + str(FREEBOARD) + ' m (cities/tokyo/moats.py).",\n"moats": [\n')
            f.write(",\n".join(json.dumps(m, ensure_ascii=False, separators=(",", ":")) for m in moats))
            f.write("\n]}\n")

    def dense(q, coords):
        ring = shapely.LineString(coords)
        return [[round(p[0], 1), round(p[1], 1), 0.0] for p in (ring.interpolate(t).coords[0] for t in np.arange(0, ring.length, WALL_STEP))]
    found.sort(key=lambda f: f[0])
    moats = [{"name": name, "level": level, "source": src, "ring": dense(q, q.exterior.coords),
              "holes": [dense(q, h.coords) for h in q.interiors if shapely.Polygon(h).area > 50]} for name, q, level, src in found]
    write(moats)
    bank = adjust_terrain(dem.copy(), C, DEM_CELL, lower=False)   # the banks without the fill's bleed
    for m, (name, q, level, src) in zip(moats, found):
        others = [(g2, l2) for n2, g2, l2, _ in found if g2 is not q]
        for ring in [m["ring"]] + m["holes"]:
            for k, p in enumerate(ring):
                a, b = np.asarray(ring[k - 1][:2]), np.asarray(ring[(k + 1) % len(ring)][:2])
                t = (b - a) / max(1e-6, float(np.hypot(*(b - a))))
                n = np.array([t[1], -t[0]])
                if q.contains(shapely.Point(*(np.asarray(p[:2]) + n * 0.5))):
                    n = -n
                o = np.asarray(p[:2]) + n * 2.0          # the bank, 2 m back from the shore
                top = float(sample(C, bank, *o)[0])
                for g2, l2 in others:                # the bank is another moat's water: up to the higher one
                    if g2.distance(shapely.Point(*o)) < 1.0:
                        top = max(level, l2)
                p[2] = round(max(top, level), 2)
    write(moats)
    for m in moats:
        print(f"{m['name'] or '(unnamed)'}: {m['level']} m ({m['source']}), {len(m['ring'])} shore points")


if __name__ == "__main__":
    build()
