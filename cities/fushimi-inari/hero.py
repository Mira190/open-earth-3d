"""The Omotesando of Fushimi Inari Taisha, the Fushimi Inari map's hero level (blender/build_hero.py
--city fushimi-inari; docs/HERO.md).

Why here: the game starts by JR Inari station, and the first thing a visitor sees leaving it is the first
great torii, with the second torii and the Romon gate behind it on one straight line: the shrine's front
approach, 140 m of stone paving rising 7 m. (The Senbon Torii are the shrine's most photographed place, but
they stand 350 m further in, behind the halls, out of sight from where the game starts.)

What is built, over the city's own model:

  * the two great torii (hero_wa.torii), on OpenStreetMap's two gate lines: vermilion posts with black feet
    and ring caps, tie beam and wedges, the curved lintels with the black top, the plaque; a floodlight at
    the foot of each post;
  * the approach: stone flags 9 m wide, gravel either side of it;
  * stone lanterns in pairs along it, lit after dark, and the stone fences (tamagaki) on the lines
    OpenStreetMap maps as fences and walls beside it, with donors' names on their pillars;
  * the shrine's name pillar by the first torii, and offering banners (nobori) in vermilion.

The torii are concrete, dedicated in 1972 (the first) and 1960 (the second), on no base stones. Their
heights and spans are not published: they are set from OpenStreetMap's widths (11.5 m and 11 m over the
lintels) and one guide's 9 m for the second. The lanterns' number and spacing, the banners and the pillar's
size are a shrine approach's usual ones, not surveyed here.
"""
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "blender"))

import hero_wa as W  # noqa: E402

ID = "sando"
DONORS = ["京都 伏見", "大阪 講社", "奉納 商店会", "稲荷 講中"]


def cells(A):
    A.cell("plaque", 200, 300, W.draw_board("伏見稲荷大社", ground=(20, 18, 18), ink=(222, 186, 96), vertical=True, border=(196, 160, 80)))
    A.cell("pillar", 96, 600, W.draw_board("伏見稲荷大社", ground=(128, 124, 116), ink=(28, 26, 24), vertical=True))
    A.cell("nobori0", 96, 512, W.draw_board("奉納稲荷大神", ground=(176, 36, 22), ink=(244, 238, 226), vertical=True))
    A.cell("nobori1", 96, 512, W.draw_board("正一位稲荷大明神", ground=(236, 230, 216), ink=(170, 34, 22), vertical=True))
    for i, d in enumerate(DONORS):
        A.cell(f"donor{i}", 64, 256, W.draw_board(d.replace(" ", ""), ground=(124, 120, 112), ink=(150, 40, 28), vertical=True))
    A.cell("gutter", 256, 64, W.draw_lid("gutter"))


def build(K):
    from shapely.geometry import LineString, Point
    from shapely.ops import unary_union
    site = W.Site("fushimi-inari", "inari_osm.json")
    way = max((p for t, p in site.ways(name="表参道")), key=len)
    line = [tuple(p) for p in (way if way[0][0] < way[-1][0] else way[::-1])]
    ln = LineString(line)
    site.watch([line], step=5.0)
    G, A, M = K.Geo(), K.Atlas(1024, 1024), W.materials()
    cells(A)
    rng = np.random.default_rng(1589)
    z = site.z
    built = unary_union([g for g in site.polys if g.distance(ln) < 16]).buffer(0.3)
    area = ln.buffer(11.0, cap_style=2).difference(built)
    W.ribbon(G, M, "ground_gravel", line, 11.0, z, lift=0.07, cell=1.5, clip=area.difference(ln.buffer(4.4, cap_style=2)))
    W.ribbon(G, M, "ground_flag", line, 4.5, z, lift=0.1, cell=0.9)
    for sg in (1, -1):   # the kerb stones along the flags
        k = ln.parallel_offset(4.55, "left" if sg > 0 else "right")
        pts = [k.interpolate(s) for s in np.arange(0, k.length, 1.5)]
        for a, b in zip(pts, pts[1:]):
            W.tbox(G, M, "stone", np.array([(a.x + b.x) / 2, (a.y + b.y) / 2, min(z(a.x, a.y), z(b.x, b.y)) - 0.1]), (np.array([b.x - a.x, b.y - a.y, 0]), np.array([a.y - b.y, b.x - a.x, 0])), (1.5, 0.22, 0.32), faces=("+v", "-v", "top"))
    # the two great torii, on their mapped lines
    gates = sorted(((t, p) for t, p in site.ways(man_made="ceremonial_gate") if t.get("colour") == "vermilion" and ln.distance(Point(*np.mean(p, 0))) < 3), key=lambda g: g[1][0][0])
    for i, (t, p) in enumerate(gates):
        c = np.mean(p, 0)
        wd = float(t.get("width", 11))
        W.torii(G, M, A, c, np.asarray(p[1]) - np.asarray(p[0]), z(*c) + 0.05, wd * 0.8, 9.8 if i == 0 else 9.0, post_r=0.52 if i == 0 else 0.48, plaque="plaque")
    # the name pillar by the first torii
    if gates:
        c = np.mean(gates[0][1], 0)
        s0 = ln.project(Point(*c))
        q = ln.interpolate(s0 - 3.0)
        tng = W.K.unit(np.array([ln.interpolate(s0 + 1).x - q.x, ln.interpolate(s0 + 1).y - q.y]))
        nl = np.array([-tng[1], tng[0]])
        pc = np.array([q.x, q.y]) + nl * 8.0
        zp = z(*pc)
        W.tbox(G, M, "stone", np.array([*pc, zp - 0.2]), (np.r_[tng, 0], np.r_[nl, 0]), (1.3, 1.3, 0.75))
        W.tbox(G, M, "stone", np.array([*pc, zp + 0.55]), (np.r_[tng, 0], np.r_[nl, 0]), (0.62, 0.62, 4.6))
        o = np.array([*pc, zp + 0.75]) - np.r_[tng, 0] * 0.315
        G.quad("sign", o + np.r_[nl, 0] * 0.25, o - np.r_[nl, 0] * 0.25, o - np.r_[nl, 0] * 0.25 + W.UP * 4.2, o + np.r_[nl, 0] * 0.25 + W.UP * 4.2, uv=A.uv("pillar"), n=-np.r_[tng, 0])
    # stone lanterns in pairs, banners between them
    for s in np.arange(10.0, ln.length - 6, 12.0):
        c, d = ln.interpolate(s), ln.interpolate(s + 0.5)
        tng = W.K.unit(np.array([d.x - c.x, d.y - c.y])); nl = np.array([-tng[1], tng[0]])
        for sg in (1, -1):
            q = np.array([c.x, c.y]) + nl * sg * 5.6
            if not built.contains(Point(*q)):
                W.stone_lantern(G, M, q, z(*q), h=2.5, heading=math.atan2(tng[1], tng[0]))
            e = ln.interpolate(s + 6.0)
            q = np.array([e.x, e.y]) + nl * sg * 6.3
            if not built.contains(Point(*q)) and s + 6.0 < ln.length - 4 and int(s / 12) % 2 == (sg > 0):
                W.nobori(G, A, q, z(*q), tng * sg, f"nobori{int(s / 24) % 2}", mat="wood_shu")
    # the stone fences on the mapped fences and walls beside the approach
    for t, p in site.osm_barriers() if hasattr(site, "osm_barriers") else [(w["tags"], [site.local(q) for q in w["ll"]]) for w in site.osm["ways"] if w["tags"].get("barrier") in ("fence", "wall")]:
        g = LineString(p)
        if g.distance(ln) > 14 or g.length < 3:
            continue
        for a, b in zip(p, p[1:]):
            mid = (np.asarray(a) + np.asarray(b)) / 2
            if ln.distance(Point(*mid)) < 14 and np.linalg.norm(np.asarray(b) - np.asarray(a)) > 1.0:
                near = ln.interpolate(ln.project(Point(*mid)))
                W.tamagaki(G, M, a, b, z, names=[f"donor{i}" for i in range(len(DONORS))], A=A, face=np.array([near.x, near.y]) - mid)
    c = ln.interpolate(ln.length / 2)
    meta = {"id": ID, "at": [round(c.x, 1), round(c.y, 1)], "r": round(ln.length / 2 + 12, 1), "z": round(z(c.x, c.y), 1), "glb": f"hero/{ID}.glb", "bake_gain": 0.6}
    return G, A, M, meta
