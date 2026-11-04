"""The National Diet Building (国会議事堂; 1936, the Ministry of Finance's Provisional Bureau for the Diet
Building): 206.36 m by 88.63 m, its central tower 65.45 m (House of Representatives, "国会議事堂の概要").
The House of Representatives' wing to the south, the House of Councillors' to the north, the central
hall under the tower between them, the front to the east.

PLATEAU draws its 26 mapped solids as grey blocks with a flat-topped tower. They are drawn here on the
same outlines, which they hide (they stay in the surface model): the walls in granite (the building is
faced in granite from Hiroshima and Yamaguchi, the fact sheet) in courses over a plinth, three storeys of
tall windows between string courses, the cornice, and the parapet; over the chambers their skylit roofs
as the measured roofs; on the east front the central porch's square columns; and the tower as photographs
show it: a square base, the colonnade of its upper stage between corner piers, and the stepped pyramid to
a small lantern at 65.45 m. The storeys, the windows and the tower's stages are taken from photographs.
"""
import math

import numpy as np
import shapely
from shapely.geometry import Polygon

import archkit as ak

OSM = "r3361370"
TOWER_M = 65.45
GROUND = []  # the forecourt's ground, once meshes() has run (for the floodlights' reach)
STOREY_M, WINDOW = 6.2, (1.6, 3.4)
MATERIALS = {
    "diet_granite": {"color": "#c4baac", "roughness": 0.85, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.6, "block_m": 1.3,
                     "emissive": "#ffe2bc", "glow": 0.22},
    "diet_trim": {"color": "#d0c7b9", "roughness": 0.8, "metalness": 0.0, "emissive": "#ffe2bc", "glow": 0.24},
    "diet_win": {"color": "#2b3036", "roughness": 0.3, "metalness": 0.3, "emissive": "#ffd9a6", "glow": 0.4},
    "diet_roof": {"color": "#8f908c", "roughness": 0.75, "metalness": 0.1},
    "diet_copper": {"color": "#6d9a86", "roughness": 0.5, "metalness": 0.4},
}


def _ccw(ring):
    pts = ak.simplify(ring, 0.3)
    return pts if ak.ring_area(pts) > 0 else pts[::-1]


def _cap(m, poly, z):
    """A flat roof over a polygon with its courtyards (holes) left open."""
    for t in shapely.constrained_delaunay_triangles(poly).geoms:
        a, b, c = list(t.exterior.coords)[:3]
        if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0:
            b, c = c, b
        m.tri((a[0], a[1], z), (b[0], b[1], z), (c[0], c[1], z))


def meshes(city_id):
    solids = [s for s in ak.load_solids(city_id) if s["osm"] == OSM]
    if not solids:
        return [], []
    roofs = ak.measured_roofs(city_id)
    K = ak.Kit("diet", floodlit={"diet_granite", "diet_trim", "diet_win"}, uv={"diet_granite"})
    stone, trim, win, roof = (K[m] for m in ("diet_granite", "diet_trim", "diet_win", "diet_roof"))
    g0 = float(np.median([s["ground"] for s in solids]))
    GROUND[:] = [round(g0, 1)]
    body = max(solids, key=lambda s: abs(ak.ring_area(s["ring"])))
    cx, cy, axis, L, W = ak.oriented(body["ring"])
    tower = max((s for s in solids if abs(ak.ring_area(s["ring"])) < 700), key=lambda s: s["top"])
    tiers = sorted((s for s in solids if s["top"] > 40), key=lambda s: s["top"])
    for sd in solids:
        if sd["top"] > 40:  # the tower: drawn below
            continue
        z0, z1 = sd["ground"] - 0.8, sd["ground"] + sd["top"]
        r = roofs.get(sd["si"])
        eave = sd["ground"] + r["eave"] if r else z1
        ring = _ccw(sd["ring"])
        ak.stone_body(K, ring, z0, eave, ("diet_granite", "diet_trim", "diet_win"), storey=STOREY_M, win=WINDOW, every=3.8,
                      sill=1.4, top=False, cornice_h=1.6)
        if eave - sd["ground"] > 15 and abs(ak.ring_area(ring)) > 300:  # the parapet
            ak.balustrade(trim, ak.WORLD, ring + ring[:1], eave, h=1.1)
        for h in sd["holes"]:  # the courtyards' walls
            hr = ak.simplify(h, 0.3)
            ak.prism(stone, ak.WORLD, hr, z0, eave, top=False)
        poly = Polygon(sd["ring"], sd["holes"]).buffer(0)
        if r:  # the chambers' skylit roofs: the measured roof
            for t in r["roof"]:
                roof.tri(*t)
            for t in r["rest"]:
                stone.tri(*t)
        for p in getattr(poly, "geoms", [poly]):
            _cap(roof, p, eave)
    # the east front's porch: square columns along the projection on the front's middle
    front = min((s for s in solids if 300 < abs(ak.ring_area(s["ring"])) < 700 and s["top"] < 23),
                key=lambda s: -(ak.ring_centroid(s["ring"])[0]))
    fx, fy, fa, fl, fw = ak.oriented(front["ring"])
    P = ak.Frame(fx, fy, fa, front["ground"])
    vf = fw / 2 + 1.8 if (P(0, fw / 2, 0)[0] > P(0, -fw / 2, 0)[0]) else -(fw / 2 + 1.8)  # the side towards the east
    for u in np.linspace(-fl / 2 + 2.0, fl / 2 - 2.0, 8):
        ak.block(trim, P, u - 0.75, u + 0.75, vf - 0.75, vf + 0.75, -0.5, 13.0)
    ak.block(trim, P, -fl / 2 + 1.0, fl / 2 - 1.0, min(vf, 0) - 1.2 if vf < 0 else 0, max(vf, 0) + 1.2 if vf > 0 else 0, 13.0, 15.0)
    # the tower: a square base from the central hall's roof, the colonnade, the stepped pyramid and the lantern
    tx, ty, ta, tl, tw = ak.oriented(tiers[0]["ring"])
    T = ak.Frame(tx, ty, ta, tower["ground"])
    hb = min(tl, tw) / 2
    ht = hb - 2.2
    z_base, z_col, z_ent = 24.0, 44.0, 54.0
    ak.block(stone, T, -hb, hb, -hb, hb, z_base - 2.0, z_col, top=False)
    ring = ak.rect(-hb, hb, -hb, hb)
    for a, b in zip(ring, ring[1:] + ring[:1]):  # its tall windows, three a face
        ak.openings_along(win, T, a, b, 30.0, 1.8, 9.0, hb * 2 / 3, margin=hb / 3)
    ak.cornice(trim, T, ring, z_col - 1.4, ((0.0, 0.0), (0.3, 0.3), (0.6, 0.8), (0.6, 1.4), (0.0, 1.4)))
    # the colonnade: a core, corner piers, six columns a face, the entablature
    ak.block(K["diet_win"], T, -ht, ht, -ht, ht, z_col, z_ent, top=False)
    for su in (-1, 1):
        for sv in (-1, 1):
            ak.block(stone, T, su * hb - 1.6 if su > 0 else -hb, su * hb if su > 0 else -hb + 1.6,
                     sv * hb - 1.6 if sv > 0 else -hb, sv * hb if sv > 0 else -hb + 1.6, z_col, z_ent)
    for k in np.linspace(-hb + 3.2, hb - 3.2, 6):
        for (x, y) in ((k, -hb + 0.8), (k, hb - 0.8), (-hb + 0.8, k), (hb - 0.8, k)):
            ak.block(trim, T, x - 0.55, x + 0.55, y - 0.55, y + 0.55, z_col, z_ent)
    ak.block(trim, T, -hb - 0.3, hb + 0.3, -hb - 0.3, hb + 0.3, z_ent, z_ent + 2.0)
    # the stepped pyramid
    n = 8
    zs = np.linspace(z_ent + 2.0, TOWER_M - 2.6, n + 1)
    for k in range(n):
        h = hb - (hb - 3.2) * (k + 1) / n
        ak.block(stone, T, -h, h, -h, h, zs[k], zs[k + 1])
    ak.block(trim, T, -2.2, 2.2, -2.2, 2.2, zs[-1], TOWER_M - 1.2)
    K["diet_copper"].lathe([(T(0, 0, TOWER_M - 1.2)[2], 1.6), (T(0, 0, TOWER_M)[2], 0.1)], T(0, 0, 0)[:2], segs=4)
    return K.out(), sorted(s["si"] for s in solids)
