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

Labels: no footprint in Overture carries Flinders Street Station's name, so its label
is placed at the station's published coordinates.
"""
import math

import numpy as np
from shapely.geometry import Point

from meshkit import Mesh

SPIRE_OSM = ("w271670390", "w22664482")  # the anchor comes from the first
SPIRE_TOP_M = 162.0
FLINDERS_STREET = (144.9671, -37.8183)
MATERIALS = {
    "spire": {"color": "#eef0f2", "roughness": 0.35, "metalness": 0.5},
}


def adjust_building(b, cls, g, geoms, ctx):
    rid = (b.get("record_id") or "").split("@")[0]
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
    return MATERIALS, meshes


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
