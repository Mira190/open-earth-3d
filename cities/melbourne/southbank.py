"""Southbank's two tallest towers, on their mapped parts (OpenStreetMap's heights, within a metre of the
published ones), which they hide; the surface model keeps the parts.

  Eureka Tower   Fender Katsalidis, 2006: 297.3 m, 91 storeys. Blue glass for the blue of the Eureka
                 Stockade's flag, white lines for its cross (and for the bars of a surveyor's staff), a
                 red stripe for the blood of the 1854 revolt, and 24-carat gold-plated glass on the top
                 10 floors for the gold rush (Eureka Tower; Wikipedia). Drawn on its four parts: the
                 blue curtain wall, the white bars in columns up the long faces, the red stripe up the
                 north face (towards the city, as photographs from the Yarra show it), and the gold
                 crown, the part from 261 m and the top 10 floors' glass below it.
  Australia 108  Fender Katsalidis, 2020: 316.7 m, 100 floors; the "starburst", the sky lobby on
                 levels 69-71 (Wikipedia), drawn as a gold band of facets standing out from the dark
                 glass round the tower at about 219-228 m (3.17 m a floor). Its projection is taken from
                 photographs.
"""
import math

import numpy as np

import archkit as ak

EUREKA, A108 = "w13307317", "w540885940"
STOREY_M = 3.25            # Eureka: 297.3 m over 91 storeys
GOLD_FROM_M = 258.0        # the top 10 floors' gold glass, under the crown's part from 261 m
STARBURST = (219.0, 228.0)
MATERIALS = {
    "sb_blue": {"color": "#3f5f7d", "roughness": 0.12, "metalness": 0.6, "pattern": "curtain_wall", "bay_m": 1.5, "storey_m": 3.25,
                "spandrel": 0.22, "mullion_m": 0.1, "frame": "#9fb0bf", "lit_share": 0.4, "lit_k": 1.0},
    "sb_gold": {"color": "#c9a03c", "roughness": 0.2, "metalness": 0.9, "pattern": "curtain_wall", "bay_m": 1.5, "storey_m": 3.25,
                "spandrel": 0.2, "mullion_m": 0.1, "frame": "#a88530", "lit_share": 0.2, "lit_k": 0.8, "emissive": "#ffcf6a", "glow": 0.35},
    "sb_white": {"color": "#eef0f1", "roughness": 0.5, "metalness": 0.1, "emissive": "#ffffff", "glow": 0.15},
    "sb_red": {"color": "#b3262a", "roughness": 0.4, "metalness": 0.2, "emissive": "#ff3b30", "glow": 0.25},
    "sb_dark": {"color": "#2a2f35", "roughness": 0.12, "metalness": 0.65, "pattern": "curtain_wall", "bay_m": 1.5, "storey_m": 3.17,
                "spandrel": 0.18, "mullion_m": 0.08, "frame": "#3b4148", "lit_share": 0.45, "lit_k": 1.1},
    "sb_roof": {"color": "#8a8d90", "roughness": 0.8, "metalness": 0.1},
}


def _ccw(ring):
    pts = ak.simplify(ring, 0.3)
    return pts if ak.ring_area(pts) > 0 else pts[::-1]


def _walls(m, ring, z0, z1):
    s = 0.0
    for a, b in zip(ring, ring[1:] + ring[:1]):
        s += ak.wall(m, ak.WORLD, a[0], a[1], b[0], b[1], z0, z1, s)


def meshes(city_id):
    solids = ak.load_solids(city_id)
    K = ak.Kit("southbank", floodlit={"sb_gold", "sb_white", "sb_red"}, uv={"sb_blue", "sb_gold", "sb_dark"})
    hidden = []
    rng = np.random.default_rng(1854)
    eureka = [s for s in solids if s["osm"] == EUREKA]
    for sd in eureka:
        hidden.append(sd["si"])
        ring = _ccw(sd["ring"])
        g0 = sd["ground"]
        z0, z1 = g0 + (sd["base"] if sd["base"] > 1 else -0.5), g0 + sd["top"]
        if sd["base"] > 200:  # the crown
            _walls(K["sb_gold"], ring, z0, z1)
            ak.cap(K["sb_gold"], ak.WORLD, ring, z0, down=True)
        else:
            zg = g0 + GOLD_FROM_M if z1 - g0 > GOLD_FROM_M + 5 else z1
            _walls(K["sb_blue"], ring, z0, zg)
            if zg < z1:
                _walls(K["sb_gold"], ring, zg, z1)
        ak.cap(K["sb_roof"], ak.WORLD, ring, z1)
    main = max((s for s in eureka if s["base"] < 1), key=lambda s: s["top"], default=None)
    if main:
        ring = _ccw(main["ring"])
        g0 = main["ground"]
        edges = sorted(zip(ring, ring[1:] + ring[:1]), key=lambda e: -math.dist(*e))
        # the white bars: two columns up each of the two long faces, bars of a surveyor's staff
        for a, b in edges[:2]:
            a, b = np.asarray(a), np.asarray(b)
            t = (b - a) / np.linalg.norm(b - a)
            n = np.array([t[1], -t[0]])
            L = float(np.linalg.norm(b - a))
            for f in (0.22, 0.7):
                for z in np.arange(g0 + 6.0, g0 + GOLD_FROM_M - 4.0, STOREY_M * 2):
                    w = rng.uniform(1.2, 3.6)
                    c = a + t * L * f + n * 0.08
                    K["sb_white"].quad((*(c - t * w / 2), z), (*(c + t * w / 2), z), (*(c + t * w / 2), z + STOREY_M * 0.9), (*(c - t * w / 2), z + STOREY_M * 0.9))
        # the red stripe up the north face: the long-enough edge whose outside faces most nearly north
        def northness(e):
            (x0, y0), (x1, y1) = e
            L = math.dist(*e)
            return -(x1 - x0) / L if L > 6 else -9.0  # the outward normal's north component (outside on the right)
        a, b = (np.asarray(p) for p in max(zip(ring, ring[1:] + ring[:1]), key=northness))
        t = (b - a) / np.linalg.norm(b - a)
        c = (a + b) / 2 + np.array([t[1], -t[0]]) * 0.1
        K["sb_red"].quad((*(c - t * 1.3), g0 + 4.0), (*(c + t * 1.3), g0 + 4.0), (*(c + t * 1.3), g0 + GOLD_FROM_M), (*(c - t * 1.3), g0 + GOLD_FROM_M))
    for sd in (s for s in solids if s["osm"] == A108):
        hidden.append(sd["si"])
        ring = _ccw(sd["ring"])
        g0 = sd["ground"]
        z0, z1 = g0 + (sd["base"] if sd["base"] > 1 else -0.5), g0 + sd["top"]
        _walls(K["sb_dark"], ring, z0, z1)
        ak.cap(K["sb_roof"], ak.WORLD, ring, z1)
        # the starburst: a gold band of facets standing out round the tower
        za, zb = g0 + STARBURST[0], g0 + STARBURST[1]
        for p, q in zip(ring, ring[1:] + ring[:1]):
            L = math.dist(p, q)
            if L < 0.5:
                continue
            t = ((q[0] - p[0]) / L, (q[1] - p[1]) / L)
            n = (t[1], -t[0])
            m = ((p[0] + q[0]) / 2 + n[0] * 3.5, (p[1] + q[1]) / 2 + n[1] * 3.5, (za + zb) / 2)  # a ray's point, out from the wall
            K["sb_gold"].tri((p[0], p[1], zb), (q[0], q[1], zb), m)
            K["sb_gold"].tri((q[0], q[1], za), (p[0], p[1], za), m)
            K["sb_gold"].tri((p[0], p[1], za), (p[0], p[1], zb), m)
            K["sb_gold"].tri((q[0], q[1], zb), (q[0], q[1], za), m)
    return K.out(), sorted(hidden)
