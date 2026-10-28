"""Tokyo: what the generic pipeline cannot know from open data.

Building adjustments (called by pipeline/build_scene.py):
  * Tokyo Station Marunouchi building: the brick facade colour (Tatsuno Kingo's 1914 red brick
    and white granite banding, restored 2012). Heights come from PLATEAU like every other
    building here.
  * Tokyo Tower: OSM maps the Foot Town building at its base. The lattice is parametric.

Parametric landmark (called by pipeline/landmarks.py):
  Tokyo Tower  333 m, a square base 80 m a side, main deck at 150 m and top deck at 250 m,
               painted in alternating International Orange and white bands (aviation
               marking rules). The lattice is an approximation of the published outline,
               anchored at the published coordinates of the tower (35.65858 N, 139.74543 E).
"""
import math

import numpy as np

from meshkit import Mesh

TOWER_LL = (139.745433, 35.658581)
TOWER = {"height": 333.0, "base": 80.0, "main_deck": 150.0, "top_deck": 250.0, "antenna_from": 255.0}
STATION = "東京駅丸の内駅舎"
FOOT_TOWN = "東京タワー"
MATERIALS = {
    "orange": {"color": "#e8541c", "roughness": 0.55, "metalness": 0.35},
    "white": {"color": "#f1efe9", "roughness": 0.55, "metalness": 0.3},
    "deck": {"color": "#c9c6bd", "roughness": 0.6, "metalness": 0.2},
    "glass": {"color": "#2a3138", "roughness": 0.1, "metalness": 0.6},
}


def adjust_building(b, cls, g, geoms, ctx):
    x, y = ctx.city.fwd.transform(*TOWER_LL)
    near = math.hypot(g.centroid.x - x, g.centroid.y - y) < 60
    if near and b["name"] != FOOT_TOWN:
        return []  # the observatories and the lattice: the parametric mesh stands for them
    if b["name"] == STATION:
        b["facade_color"] = "#9c4f3c"  # red brick; the roofs are slate and the colour here is read as walls
    if b["name"] == FOOT_TOWN:
        # the OSM polygon is the tower's Foot Town podium; keep it, and build the lattice above it
        e = g.minimum_rotated_rectangle.exterior.coords
        cs = np.asarray(e)[:4]
        long_axis = cs[1] - cs[0] if np.linalg.norm(cs[1] - cs[0]) > np.linalg.norm(cs[2] - cs[1]) else cs[2] - cs[1]
        ctx.landmarks["tokyo_tower"] = {"centre": [round(float(x), 1), round(float(y), 1)], "axis_deg": round(math.degrees(math.atan2(long_axis[1], long_axis[0])) % 90, 2),
                                        "ground_m": round(ctx.ground(x, y), 1), **TOWER}
        # OSM tags the whole 333 m on the Foot Town polygon; the podium is a low block (four storeys),
        # and the lattice above it is the landmark mesh.
        return [[q, 0.0, 18.0, "parametric", None] for q in ctx.polygons(g)]
    return geoms


def finalize(ctx):
    t = ctx.landmarks.get("tokyo_tower")
    if t:
        ctx.labels["Tokyo Tower 東京タワー"] = [t["centre"][0], t["centre"][1], round(t["ground_m"] + t["height"] + 6, 1)]


# ---------------------------------------------------------------- Tokyo Tower

def leg_x(z, base, top_half=4.0, top_z=250.0):
    """Half-width of the lattice at height z: an exponential-ish taper from the base to the top deck."""
    s = min(max(z / top_z, 0.0), 1.0)
    return top_half + (base / 2 - top_half) * (1 - s) ** 1.7


def tower(t):
    gz = t["ground_m"]
    cx, cy = t["centre"]
    a = math.radians(t["axis_deg"])
    R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    P = lambda x, y, z: (float(cx + R[0, 0] * x + R[0, 1] * y), float(cy + R[1, 0] * x + R[1, 1] * y), float(gz + z))
    # horizontal levels of the lattice, each a bay; bands of orange and white every few bays
    zs = [0, 12, 26, 42, 60, 80, 102, 126, 150, 176, 202, 226, 250]
    meshes = {"orange": Mesh("tower_orange", "orange", False, floodlit=True), "white": Mesh("tower_white", "white", False, floodlit=True)}
    band = lambda z: "white" if int(z // 37.5) % 2 else "orange"
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for lo, hi in zip(zs[:-1], zs[1:]):
        m = meshes[band((lo + hi) / 2)]
        h0, h1 = leg_x(lo, t["base"]), leg_x(hi, t["base"])
        w = max(0.9, 3.4 * (1 - lo / 250.0) + 0.9)
        for k in range(4):
            (sx, sy), (tx, ty) = corners[k], corners[(k + 1) % 4]
            # corner legs
            m.box(P(sx * h0, sy * h0, lo), P(sx * h1, sy * h1, hi), w, w)
            # cross-bracing on the face between corner k and k+1: an X in each bay, and a ring beam at the top
            m.box(P(sx * h0, sy * h0, lo), P(tx * h1, ty * h1, hi), w * 0.45, w * 0.45)
            m.box(P(tx * h0, ty * h0, lo), P(sx * h1, sy * h1, hi), w * 0.45, w * 0.45)
            m.box(P(sx * h1, sy * h1, hi), P(tx * h1, ty * h1, hi), w * 0.6, w * 0.6)
    deck = Mesh("tower_decks", "deck", False, floodlit=True)
    glass = Mesh("tower_glass", "glass", False)
    for z0, z1, hw in ((140.0, 150.0, 13.0), (239.0, 250.0, 7.0)):
        deck.box(P(0, 0, z0), P(0, 0, z0 + 2), 2 * hw + 3, 2 * hw + 3)
        glass.box(P(0, 0, z0 + 2), P(0, 0, z1), 2 * hw, 2 * hw)
        deck.box(P(0, 0, z1), P(0, 0, z1 + 1.2), 2 * hw + 2, 2 * hw + 2)
    ant = meshes["orange"]
    # antenna mast: a tapering mast above the top deck, banded to the tip
    for lo, hi, w in ((250, 270, 5.0), (270, 290, 3.8), (290, 310, 2.8), (310, 333, 1.6)):
        (meshes["white"] if int(lo // 20) % 2 else ant).box(P(0, 0, lo), P(0, 0, hi), w, w)
    return [*meshes.values(), deck, glass]


def landmark_meshes(scene):
    t = scene["landmarks"].get("tokyo_tower")
    return MATERIALS, tower(t) if t else []
