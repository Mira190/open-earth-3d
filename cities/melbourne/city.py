"""Melbourne: what the generic pipeline cannot know from open data.

Building adjustments (called by pipeline/build_scene.py):
  * Arts Centre Melbourne spire: OpenStreetMap maps it twice, as a 7 m square block
    from 15 m to 162 m (w271670390) and as a solid 452 m2 block from 15 m to 50 m with
    a 162 m mast (w22664482). Both become one parametric lattice spire on the first
    one's anchor.

Parametric landmarks (called by pipeline/landmarks.py):
  Arts Centre spire   162 m tall (Wikipedia, Arts Centre Melbourne; completed 1996,
                      replacing the 115 m original). Twelve ribs flare from a wide base
                      on the Theatres Building roof into a mast, with rings every 8 m.
                      The shape is an approximation: no published drawing was used.

  Flinders Street Station  OpenStreetMap maps the station's 310 m outline at 20 m (4 floors)
                      with parts: a dome from 20 to 30 m, the Elizabeth Street clock tower
                      at 35 m, two 24 m blocks. By the OSM convention the parts replace the
                      outline, which left the station's long body out of the model, and its
                      dome standing on nothing. The body comes back as the outline less the
                      parts that stand on the ground, at the outline's 20 m. On it: the dome
                      as a dome (copper, on the mapped part), clock faces near the top of the
                      tower, the clocks over the main entrance, and the 1910 colour scheme
                      that the 2018-2020 repaint restored: cream, terracotta and dark green
                      (Dulux, Munsell 10YR 7/4, 10R 3/8 and 10GY 2/2; the hex values here are
                      approximate conversions). The terracotta bands' heights are chosen.

Labels: no footprint in Overture carries Flinders Street Station's name, so its label
is placed at the station's published coordinates.
"""
import math

import numpy as np
import shapely
from shapely.geometry import Point

from meshkit import Mesh

SPIRE_OSM = ("w271670390", "w22664482")  # the anchor comes from the first
STATION_OSM = "w271939456"  # its parts: the dome w271939464, the clock tower w306665754
STATION_ENTRANCE = (144.96718, -37.81776)  # "under the clocks", Flinders and Swanston (OSM)
CREAM, TERRACOTTA, DARK_GREEN = "#c4a77d", "#8a2f22", "#2e3a2b"
SPIRE_TOP_M = 162.0
FLINDERS_STREET = (144.9671, -37.8183)
MATERIALS = {
    "spire": {"color": "#eef0f2", "roughness": 0.35, "metalness": 0.5},
    "fss_terracotta": {"color": TERRACOTTA, "roughness": 0.85, "metalness": 0.0},
    "fss_green": {"color": DARK_GREEN, "roughness": 0.6, "metalness": 0.1},
    "fss_cream": {"color": CREAM, "roughness": 0.8, "metalness": 0.0},
    "fss_copper": {"color": "#5d7f6d", "roughness": 0.45, "metalness": 0.5},
    "fss_clock": {"color": "#f4f1e6", "roughness": 0.4, "metalness": 0.0},
    "fss_hands": {"color": "#1d1d1f", "roughness": 0.5, "metalness": 0.2},
}


def adjust_building(b, cls, g, geoms, ctx):
    rid = (b.get("record_id") or "").split("@")[0]
    if rid == STATION_OSM:
        return station(b, g, geoms, ctx)
    if rid in SPIRE_OSM[1:]:
        return []
    if rid == SPIRE_OSM[0]:
        c = g.centroid
        base = min((s[1] for s in geoms), default=15.0)
        ground = ctx.ground(c.x, c.y)
        ctx.landmarks["arts_centre_spire"] = {"at": [round(c.x, 1), round(c.y, 1)], "ground_m": round(ground, 1),
                                              "base_m": round(ground + base, 1), "top_m": round(ground + SPIRE_TOP_M, 1)}
        return []
    return geoms


def station(b, g, geoms, ctx):
    """The body back under the parts, and anchors for the dome, the tower and the facade."""
    b["facade_color"] = CREAM
    ground_parts = [q for q in geoms if q[1] <= 0.5]
    body = g.difference(shapely.union_all([q[0] for q in ground_parts])) if ground_parts else g
    top = float(b.get("height") or 20.0)
    out = list(geoms) + [[p, 0.0, top, "mapped", None] for p in ctx.polygons(body) if p.area > 10]
    c = g.centroid
    lm = {"outline": [[round(x, 1), round(y, 1)] for x, y in g.exterior.coords], "ground_m": round(ctx.ground(c.x, c.y), 1), "top_m": top}
    # the dome is the part that starts above the ground; the clock tower the tallest that rises above the body
    for q in [q for q in geoms if q[1] > 5.0][:1]:  # drawn as a dome; still in the surface model
        ctx.hide(q)
        d = q[0].centroid
        lm["dome"] = {"at": [round(d.x, 1), round(d.y, 1)], "r": round(math.sqrt(q[0].area / math.pi), 2), "base_m": q[1], "top_m": q[2]}
    for q in sorted((q for q in ground_parts if q[2] > top + 5.0), key=lambda q: -q[2])[:1]:
        cs = np.asarray(q[0].minimum_rotated_rectangle.exterior.coords)[:4]
        lm["tower"] = {"corners": [[round(x, 1), round(y, 1)] for x, y in cs], "top_m": q[2]}
    e = ctx.city.to_local(Point(*STATION_ENTRANCE))
    lm["entrance"] = [round(e.x, 1), round(e.y, 1)]
    ctx.landmarks["flinders_street"] = lm
    return out


def finalize(ctx):
    p = ctx.city.to_local(Point(*FLINDERS_STREET))
    ctx.labels["Flinders Street Station"] = [round(p.x, 1), round(p.y, 1), round(ctx.ground(p.x, p.y) + 32.0, 1)]
    s = ctx.landmarks.get("arts_centre_spire")
    if s:
        ctx.labels["Arts Centre spire"] = [s["at"][0], s["at"][1], s["top_m"] + 6.0]


def landmark_meshes(scene):
    lm = scene["landmarks"]
    meshes = []
    if "arts_centre_spire" in lm:
        meshes.append(spire(lm["arts_centre_spire"]))
    if "flinders_street" in lm:
        meshes += flinders_street(lm["flinders_street"])
    return MATERIALS, meshes


def flinders_street(s):
    """Terracotta bands and a dark green cornice along the outline, the copper dome, the tower's
    clocks and the row of clocks over the entrance."""
    g0, top = s["ground_m"], s["ground_m"] + s["top_m"]
    bands, cornice = Mesh("fss_bands", "fss_terracotta", False), Mesh("fss_cornice", "fss_green", False)
    ring = [np.array(p) for p in s["outline"]]
    cx, cy = np.mean([p[0] for p in ring]), np.mean([p[1] for p in ring])
    for a, c in zip(ring, ring[1:]):
        L = np.linalg.norm(c - a)
        if L < 1.0:
            continue
        n = np.array([(c - a)[1], -(c - a)[0]]) / L  # outward, for a ring going round either way
        if np.dot((a + c) / 2 - np.array([cx, cy]), n) < 0:
            n = -n
        o = n * 0.12
        for z in (g0 + 4.5, g0 + 9.5, g0 + 14.5):
            bands.box((a[0] + o[0], a[1] + o[1], z), (c[0] + o[0], c[1] + o[1], z), 0.25, 0.7)
        cornice.box((a[0] + o[0], a[1] + o[1], top - 0.4), (c[0] + o[0], c[1] + o[1], top - 0.4), 0.5, 0.8)
    out = [bands, cornice]
    if "dome" in s:
        d = s["dome"]
        dx, dy = d["at"]
        z0, z1, r = g0 + d["base_m"], g0 + d["top_m"], d["r"]
        drum = Mesh("fss_dome_drum", "fss_cream", True)
        drum.lathe([(z0 - 0.5, r * 1.04), (z0 + 0.6, r * 1.04), (z0 + 0.6, r * 0.96)], (dx, dy), segs=40)
        dome = Mesh("fss_dome", "fss_copper", True, floodlit=True)
        k = 12
        dome.lathe([(z0 + 0.6 + (z1 - z0 - 1.6) * math.sin(math.pi / 2 * t / k), r * 0.96 * math.cos(math.pi / 2 * t / k)) for t in range(k + 1)] +
                   [(z1 - 0.2, 0.9), (z1 + 1.0, 0.7), (z1 + 1.4, 0.05)], (dx, dy), segs=40)
        out += [drum, dome]
    clocks, hands = Mesh("fss_clocks", "fss_clock", False, floodlit=True), Mesh("fss_clock_hands", "fss_hands", False)

    def face(c, n, rad, z):  # a clock face on a wall whose outward normal is n, with its hands at ten past ten
        c, n = np.asarray(c, float), np.asarray(n, float) / np.linalg.norm(n)
        side = np.array([n[1], -n[0], 0.0])
        nn = np.array([n[0], n[1], 0.0])
        P = lambda u, v: np.array([c[0], c[1], z]) + nn * 0.15 + side * u + np.array([0, 0, v])
        for j in range(24):
            a0, a1 = 2 * math.pi * j / 24, 2 * math.pi * (j + 1) / 24
            clocks.tri(P(0, 0), P(math.sin(a0) * rad, math.cos(a0) * rad), P(math.sin(a1) * rad, math.cos(a1) * rad))
        for ang, ln in ((math.radians(300), 0.55), (math.radians(60), 0.8)):
            hands.box(P(0, 0) + nn * 0.03, P(math.sin(ang) * rad * ln, math.cos(ang) * rad * ln) + nn * 0.03, rad * 0.08, 0.04, up=tuple(nn))
    if "tower" in s:
        cs = [np.array(p) for p in s["tower"]["corners"]]
        tc = np.mean(cs, axis=0)
        zc = g0 + s["tower"]["top_m"] - 6.0
        for a, c in zip(cs, cs[1:] + cs[:1]):
            m = (a + c) / 2
            face(m, m - tc, min(1.8, np.linalg.norm(c - a) * 0.3), zc)
    if "dome" in s:  # the row of clocks over the entrance, facing out from under the dome
        e, d = np.array(s["entrance"]), np.array(s["dome"]["at"])
        n = (e - d) / np.linalg.norm(e - d)
        side = np.array([n[1], -n[0]])
        for j in range(-3, 4):
            face(e + side * j * 1.3 + n * 0.4, n, 0.5, g0 + 6.0)
    return out + [clocks, hands]


def spire(s):
    """Twelve ribs from a 14 m base radius curving in to the mast, rings, and the mast."""
    cx, cy = s["at"]
    z0, top = s["base_m"], s["top_m"]
    skirt = (top - z0) * 0.62  # where the ribs meet the mast
    m = Mesh("arts_centre_spire", "spire", False, floodlit=True)

    def radius(t):  # 0 at the base, 1 where the ribs meet the mast
        return 1.6 + 12.4 * (1 - t) ** 1.7

    def P(a, t):
        r = radius(t)
        return np.array([cx + r * math.cos(a), cy + r * math.sin(a), z0 + t * skirt])
    ribs, segs = 12, 10
    for k in range(ribs):
        a = 2 * math.pi * k / ribs
        for j in range(segs):
            m.box(P(a, j / segs), P(a, (j + 1) / segs), 0.55, 0.55)
    for zr in np.arange(8.0, skirt, 8.0):  # rings
        t = zr / skirt
        for k in range(ribs):
            a0, a1 = 2 * math.pi * k / ribs, 2 * math.pi * (k + 1) / ribs
            m.box(P(a0, t), P(a1, t), 0.3, 0.3)
    mast = [(z0 + skirt * 0.6, 1.8), (z0 + skirt, 1.2), (top - 12, 0.6), (top, 0.15)]
    for (za, wa), (zb, wb) in zip(mast, mast[1:]):
        m.box((cx, cy, za), (cx, cy, zb), (wa + wb) / 2, (wa + wb) / 2, up=(1, 0, 0))
    return m
