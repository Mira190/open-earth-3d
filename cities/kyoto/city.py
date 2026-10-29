"""Kyoto: what the generic pipeline cannot know from open data.

Building adjustments (called by pipeline/build_scene.py):
  * Kyoto Tower Hotel: PLATEAU records the tower and the 9-storey building below it as one
    building 130.5 m high, so matching it to the hotel footprint would extrude the whole block
    to 131 m. The block is cut to its published base height and the tower is parametric.

Parametric landmarks (called by pipeline/landmarks.py):
  Kyoto Tower  131 m to the spire, observation deck at 100 m, a stressed-skin steel tube
               (no inner frame) completed in 1964. Published figures are the two heights;
               the radii and the deck's shape are an approximation, not survey data.
"""
import math

import numpy as np

from meshkit import Mesh

TOWER_LL = (135.75946, 34.98748)   # lon, lat of the tower
BASE_M = 31.0                      # roof of the building under the tower
MATERIALS = {
    "tower": {"color": "#f4f2ec", "roughness": 0.45, "metalness": 0.1},
    "deck_glass": {"color": "#2b3238", "roughness": 0.1, "metalness": 0.5},
    "mast": {"color": "#d9463b", "roughness": 0.5, "metalness": 0.2},
}


def adjust_building(b, cls, g, geoms, ctx):
    if b["name"] == "京都タワーホテル":
        ctx.landmarks["kyoto_tower_base"] = {"plateau_footprint_centroid": [round(g.centroid.x, 1), round(g.centroid.y, 1)]}
        return [[p, 0.0, BASE_M, "parametric", None] for p in ctx.polygons(g)]
    return geoms


def finalize(ctx):
    x, y = ctx.city.fwd.transform(*TOWER_LL)
    ctx.landmarks["kyoto_tower"] = {"at": [round(x, 1), round(y, 1)], "ground_m": round(ctx.ground(x, y), 1), "spire_m": 131.0,
                                    "deck_m": 100.0, "base_m": BASE_M, "plateau_m": 130.5}
    spots = {"Kyoto Tower": (x, y, 138.0), "Kyoto Station": (-338, -1908, 62.0), "Higashi Honganji": (-365, -1331, 40.0),
             "Nishi Hongwanji": (-986, -1287, 40.0), "Nijo Castle": (-1314, 1243, 36.0), "Imperial Palace": (-46, 2474, 36.0),
             "Kyoto City Hall": (529, 932, 66.0)}
    for name, (sx, sy, up) in spots.items():
        z = ctx.ground(sx, sy) + (0 if name == "Kyoto Tower" else up)
        ctx.labels[name] = [round(sx, 1), round(sy, 1), round(ctx.ground(sx, sy) + up if name != "Kyoto Tower" else up + ctx.ground(sx, sy), 1)]


def lathe(m, cx, cy, z0, prof, n=28):
    """Revolve [(height above z0, radius)] about the vertical axis at (cx, cy)."""
    rows = []
    for h, r in prof:
        rows.append([(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n), z0 + h) for k in range(n + 1)])
    m.grid(rows)


def landmark_meshes(scene):
    t = scene["landmarks"]["kyoto_tower"]
    x, y = t["at"]
    z0 = t["ground_m"] + t["base_m"]
    shaft = Mesh("Kyoto Tower shaft", "tower", True)
    lathe(shaft, x, y, z0, [(0, 6.2), (6, 5.2), (28, 3.9), (52, 3.1), (61, 3.0)])   # base building roof to just under the deck
    deck = Mesh("Kyoto Tower deck", "deck_glass", True)
    lathe(deck, x, y, z0, [(61, 3.0), (62, 7.5), (64, 9.6), (68, 9.6), (70, 7.0), (71, 3.4)])
    cone = Mesh("Kyoto Tower rim", "tower", True)
    lathe(cone, x, y, z0, [(60, 3.0), (62, 7.7), (62, 9.8), (64, 10.0)])
    mast = Mesh("Kyoto Tower mast", "mast", True, floodlit=True)
    lathe(mast, x, y, z0, [(71, 3.4), (74, 2.0), (90, 0.9), (100 - BASE_M + 31, 0.12)], n=12)   # spire tip at 131 m above ground
    return MATERIALS, [shaft, deck, cone, mast]
