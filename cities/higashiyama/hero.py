"""Yasaka-dori, the Higashiyama map's hero level (blender/build_hero.py --city higashiyama; docs/HERO.md).

Why here: the game starts at the foot of Yasaka-dori on Higashioji-dori, and the lane climbing east to the
Yasaka Pagoda (Hokan-ji's five-storey pagoda) is Kyoto's most photographed street view: stone setts between
two rows of town houses, the pagoda closing the view. 170 m, 4 to 7 m between its fronts, rising 9 m.

What is built, on the buildings the city has there (PLATEAU's and OpenStreetMap's solids and roofs), a few
centimetres in front of their walls and over their roofs:

  * every front on the lane as a town house (blender/hero_wa.py machiya): stone footing, posts and beams,
    lattices over lit paper, a sliding door under a noren, a shop's window, the bamboo guard, the tiled pent
    roof, plaster above with a slit window or a lattice and a blind; a name board and a paper lantern;
  * the side walls a walker can see, in charred boards under plaster, and the gables;
  * every roof a walker can see, in grey tile, with the round eave tiles and a copper gutter;
  * the lane: granite setts wall to wall, gutter lids along the fronts, manholes;
  * on it: tea-house benches under red parasols, fire buckets at doors, lanterns.

No utility poles: Kyoto City ran this stretch's wires under the eaves (its pole-removal plan shows
Yasaka-dori as the example). Only what a walker on the lane can see is built (hero_wa.Site.seen).
"""
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "blender"))

import hero_wa as W  # noqa: E402

ID = "yasaka"
FRONT_M = 7.5     # a wall within this of the lane's line, facing it, is a front
NEAR_M = 16.0     # buildings within this of the line are dressed
PLASTERS = ("plaster_white", "plaster_white", "plaster_ochre", "plaster_bengara", "plaster_grey")


def lane(site):
    """Yasaka-dori's line east of Higashioji-dori, to the pagoda's gate (OpenStreetMap)."""
    pts = max((p for t, p in site.ways(name="八坂通") if t.get("surface") == "sett"), key=len)
    return [p for p in pts if p[0] < -272.0 and p[1] > 165.0]


def build(K):
    from shapely.geometry import LineString, Point
    site = W.Site("higashiyama", "kiyomizu_osm.json")
    line, half = site.centred(lane(site))
    ln = LineString(line)
    site.watch([line], step=4.0)
    G, A, M = K.Geo(), K.Atlas(2048, 2048), W.materials()
    rng = np.random.default_rng(1440)
    W.cells(A, rng)
    doors = []
    nfront = nside = 0
    for sd in site.S:
        g = site.polys[sd["si"]]
        if g.distance(ln) > NEAR_M or sd["top"] > 16 or sd["base"] > 0.5 or g.area < 8 or g.area > 400:
            continue
        ze = site.eave(sd)
        plaster = PLASTERS[int(rng.integers(len(PLASTERS)))]
        for fr in site.edges(sd):
            mid = fr.mid
            za, zb = site.z(*fr(0, 0, 0)[:2]), site.z(*fr(fr.L, 0, 0)[:2])
            zlow, zf = min(za, zb) - 0.3, max(za, zb) + 0.14
            d = ln.distance(Point(*mid))
            s = ln.project(Point(*mid))
            p, q = ln.interpolate(max(s - 0.5, 0)), ln.interpolate(min(s + 0.5, ln.length))
            along = abs(np.array([q.x - p.x, q.y - p.y]) @ fr.t)
            faces = ln.distance(Point(*(mid + fr.n * 1.0))) < d
            if faces and d < FRONT_M and along > 0.75 and fr.L >= 2.4 and ze - zf > 2.5:
                doors.append(W.machiya(G, M, A, fr, zlow, zf, ze, rng, plaster=plaster))
                nfront += 1
            elif fr.L > 0.8 and any(site.seen(np.r_[fr(u, 0.4, 0)[:2], z], skip=sd["si"]) for u in (0.15 * fr.L, 0.5 * fr.L, 0.85 * fr.L) for z in (zf + 1.5, ze - 0.3)):
                W.wall_skin(G, M, fr, zlow, ze, plaster=plaster)
                nside += 1
        W.gable_skin(G, M, site, sd, plaster=plaster)
        W.roof_skin(G, M, site, sd)
    print(f"{nfront} fronts, {nside} side walls")
    # the lane's setts, wall to wall (under the buildings they are not drawn), and what is set in them
    from shapely.ops import unary_union
    built = unary_union([site.polys[sd["si"]] for sd in site.S if site.polys[sd["si"]].distance(ln) < 12]).buffer(-0.4)
    W.ribbon(G, M, "ground_sett", line, 7.0, site.z, lift=0.1, cell=0.7, clip=ln.buffer(8.5, cap_style=2).difference(built))
    for s in np.arange(9.0, ln.length - 4, 23.0):
        p = ln.interpolate(s)
        W.decal(G, "ground_lid", (p.x, p.y), (1, 0), 0.62, 0.62, site.z, A.uv("manhole"))
    # at the doors: a tea house's bench and parasol, fire buckets, now and then
    for i, dr in enumerate(doors):
        c, t, n = dr["door"], dr["t"], dr["n"]
        r = rng.random()
        room = ln.distance(Point(*c[:2]))
        if r < 0.22 and room > 2.3:
            q = c + t * 1.9 + n * 0.25
            W.bench(G, M, q, site.z(*q[:2]) + 0.1, t, parasol=room > 2.8)
        elif r < 0.6:
            q = c + t * 0.95 - n * 0.22
            W.bucket(G, q, site.z(*q[:2]) + 0.1)
    c = ln.interpolate(ln.length / 2)
    meta = {"id": ID, "at": [round(c.x, 1), round(c.y, 1)], "r": round(ln.length / 2 + 10, 1), "z": round(site.z(c.x, c.y), 1), "glb": f"hero/{ID}.glb", "bake_gain": 0.6}
    return G, A, M, meta
