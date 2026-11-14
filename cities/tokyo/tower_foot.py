"""The foot of Tokyo Tower: Foot Town under the lattice, and the ground round it.

Foot Town (フットタウン, the five-storey building between the legs) on its mapped outline: dark panels over a glazed
street floor, a line at the fourth floor, a rail round the roof terrace, and the tower's name in white letters
high on each face, as photographs show it (docs/HERO.md). The ground within 150 m, on OpenStreetMap's outlines
(tower_osm.json, ODbL): the streets' asphalt with lane dashes and zebras, the car park, pavements, and the
wooded slopes of Shiba Park as plain green under the map's trees, in place of the aerial photograph.
The lattice itself is cities/tokyo/city.py `tower`.
"""
import math
import os

import numpy as np

import archkit as ak

OSM = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tower_osm.json")
NAME = "東京タワー"
TOP = 19.0     # the roof terrace over the tower's ground (m); the arches' girder passes at 24
MATERIALS = {
    "ft_wall": {"color": "#3b3537", "roughness": 0.6, "metalness": 0.15},
    "ft_trim": {"color": "#c9c6c0", "roughness": 0.5, "metalness": 0.4},
    "ft_glass": {"color": "#1f262c", "roughness": 0.08, "metalness": 0.6, "emissive": "#ffdcae", "glow": 0.9, "glow_day": 0.1},
    "ft_letters": {"color": "#f1efe9", "roughness": 0.4, "metalness": 0.2, "emissive": "#fff2dc", "glow": 1.0},
    "ft_rail": {"color": "#8d9399", "roughness": 0.4, "metalness": 0.7},
}


def _font():
    from PIL import ImageFont
    try:
        import adkit
        return adkit.font("bebas", 240)
    except Exception:
        for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
            if os.path.exists(f):
                return ImageFont.truetype(f, 240)
    return None


def meshes(t, ST):
    """(materials, meshes, hidden solids): t the tower's record (scene.json landmarks), ST the station's module,
    whose ground, surfaces and street painter this level shares."""
    import shapely
    from shapely.geometry import Point, Polygon
    K = ak.Kit("twf", floodlit=("ft_glass", "ft_letters"), uv=("tks_pavers", "tks_lawn", "tks_groundcover"))
    T = ST.Ground("tokyo")
    Z = lambda x, y: float(T(x, y))
    cx, cy = t["centre"]
    g = t["ground_m"]
    uv = lambda x, y: (float(x - cx), float(y - cy))
    solids = ak.load_solids("tokyo")
    hidden = [s["si"] for s in solids if s["name"] == NAME]
    ft = max((s for s in solids if s["name"] == NAME), key=lambda s: abs(ak.ring_area(s["ring"])), default=None)
    O = ST._osm(OSM)
    # ---- the ground
    zone = Point(cx, cy).buffer(150)
    site = shapely.union_all([p for p in O["parking"] if p.distance(Point(cx, cy)) < 60] + ([Polygon(ft["ring"]).buffer(22)] if ft else []))
    foot = Polygon(ft["ring"]).buffer(0.2) if ft else Point(cx, cy).buffer(1)
    roads = shapely.union_all([l.buffer(n * ST.LANE_W / 2 + 0.35) for l, n in O["road"]] + [l.buffer(3.3) for l in O["service"]])
    # what is not a carriageway, a building or a wood is paved: pavements, the tower's forecourt, the lots between
    # the buildings (plain, where the photograph showed parked cars and shadows)
    blds = shapely.union_all([Polygon(b["ring"]).buffer(0.2) for b in solids if b["top"] - b["ground"] > 2.5 and Polygon(b["ring"]).intersects(zone)])
    green = shapely.union_all(O["wood"] + O["grass"]).intersection(zone).difference(roads.buffer(3.5)).difference(site).difference(blds)
    ST.streets(K, O, T, Z, uv, zone.difference(foot), [s for s in solids if s["name"] != NAME], walk_in=zone.difference(green.buffer(0.05)))
    for q in T.facets(green):
        ST._lay(K["tks_groundcover"], q, Z, 0.05, uv)
    if ft is None:
        return dict(MATERIALS), K.out(), hidden
    # ---- Foot Town
    ring = ST.ccw(ak.simplify(list(ft["ring"]), 0.5))
    wall, trim, glass = K["ft_wall"], K["ft_trim"], K["ft_glass"]
    z0 = min(Z(x, y) for x, y in ring) - 0.3
    n = len(ring)
    for i in range(n):
        a, b = np.asarray(ring[i], float), np.asarray(ring[(i + 1) % n], float)
        L = float(np.linalg.norm(b - a))
        if L < 0.5:
            continue
        tt = (b - a) / L
        nrm = np.array([tt[1], -tt[0]])
        ak.holed_wall(wall, ak.WORLD, a, b, z0, g + TOP, [])
        if L > 6:   # the glazed street floor between piers, under a pale fascia; the fourth floor's line
            nb = max(1, int((L - 1.0) // 3.6))
            w = (L - 1.0) / nb
            for j in range(nb):
                s0 = 0.5 + j * w
                ST.slab(glass, a, tt, nrm, s0 + 0.12, s0 + w - 0.12, g + 0.25, g + 4.0, 0, 0.03, "f")
            ST.slab(trim, a, tt, nrm, 0, L, g + 4.1, g + 4.45, 0, 0.12, "fbt")
        ST.slab(trim, a, tt, nrm, 0, L, g + 14.6, g + 14.72, 0, 0.04, "f")
        ST.slab(trim, a, tt, nrm, 0, L, g + TOP - 0.25, g + TOP, 0, 0.08, "fbt")
        K["ft_rail"].rails([(*(a + nrm * 0.02), g + TOP), (*(b + nrm * 0.02), g + TOP)], 1.1, post_every=2.0)
    ak.cap(K["ft_wall"], ak.WORLD, ring, g + TOP)
    # the name, high on each long face
    font = _font()
    if font is not None:
        rect = list(Polygon(ring).minimum_rotated_rectangle.exterior.coords)[:4]
        c = np.mean(np.asarray(rect), axis=0)
        for i in range(4):
            a, b = np.asarray(rect[i]), np.asarray(rect[(i + 1) % 4])
            L = float(np.linalg.norm(b - a))
            mid = (a + b) / 2
            out = (mid - c) / np.linalg.norm(mid - c)
            if L < 30:
                continue
            # a frame whose u points out of this face: the wall under the letters is the outline's own, so they
            # stand off the rectangle's face by what the outline lies inside it there
            P = ak.Frame(c[0], c[1], math.degrees(math.atan2(out[1], out[0])), g)
            d = float(np.linalg.norm(mid - c))
            probe = shapely.geometry.LineString([tuple(c), tuple(c + out * (d + 5))]).intersection(Polygon(ring))
            d_wall = probe.length if not probe.is_empty else d
            ak.letters(K["ft_letters"], P, "TOKYO TOWER", font, d_wall + 0.05, 0.0, TOP - 3.2, 1.5, depth=0.18, spacing=0.12)
    return dict(MATERIALS), K.out(), hidden
