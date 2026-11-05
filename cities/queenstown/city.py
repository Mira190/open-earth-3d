"""Queenstown (Tāhuna): what the generic pipeline cannot know from open data.

Heights come from LINZ's 2021 LiDAR (every footprint's roof measured from the 1 m surface model,
pipeline/survey.py), so no building needs a height fix here. What the data cannot carry:

  Skyline Gondola   the towers, the cable and the cabins. The line, its six towers and its two
                    stations are OpenStreetMap's (via Overture); the towers' heights and the cable's
                    profile are measured from the LiDAR by gondola.py into gondola.json. The towers
                    are Doppelmayr-style tubular steel masts with a crossarm carrying a sheave train
                    over each track; the cabins (web/game/rail.js, kind "gondola") ride the profile.

  Skyline deck      the viewing deck in front of the Skyline complex on Bob's Peak, where the
                    town's best-known photograph is taken: the bay, the Gardens, the Kelvin
                    Peninsula and the Remarkables. A timber deck on steel posts with a glass
                    balustrade, laid along the contour and facing south-east down the slope. Its
                    place and size are indicative (DECK), its level the ground at its back edge
                    from the LiDAR; the game walks it as a strip and the player starts on it.
"""
import json
import math
import os

import numpy as np

from meshkit import Mesh

HERE = os.path.dirname(os.path.abspath(__file__))
TRACK_M = 5.6        # between the up and the down cable
CABLE_R = 0.026      # the haul rope, 52 mm

DECK = {"at": (-1048.0, 452.0), "along_deg": 45.0, "length": 26.0, "depth": 10.0}  # centre, the bearing of its long side, metres

MATERIALS = {
    "skyline_wall": {"color": "#3e4347", "roughness": 0.55, "metalness": 0.2},
    "skyline_glass": {"color": "#26343c", "roughness": 0.08, "metalness": 0.5, "pattern": "curtain_wall", "bay_m": 1.8, "storey_m": 3.6,
                      "spandrel": "#3e4347", "mullion_m": 0.1, "frame": "#2a2e31", "lit_share": 0.8, "lit_k": 0.8},
    "skyline_roof": {"color": "#55595c", "roughness": 0.8},
    "deck_timber": {"color": "#8d6c4c", "roughness": 0.85, "pattern": "granite", "joints_m": [0.14, 2.4]},
    "deck_steel": {"color": "#3b4045", "roughness": 0.5, "metalness": 0.6},
    "deck_glass": {"color": "#3d5158", "roughness": 0.04, "metalness": 0.0, "opacity": 0.12},
    "gondola_steel": {"color": "#59636b", "roughness": 0.45, "metalness": 0.7},
    "gondola_sheave": {"color": "#c8cdd0", "roughness": 0.35, "metalness": 0.75},
    "gondola_cable": {"color": "#2b2e31", "roughness": 0.4, "metalness": 0.8},
    "gondola_concrete": {"color": "#a7a39a", "roughness": 0.9},
    "gondola_yellow": {"color": "#d9a514", "roughness": 0.5},
}


def massing_data():
    path = os.path.join(HERE, "massing.json")
    return json.load(open(path))["buildings"] if os.path.exists(path) else {}


def adjust_building(b, cls, g, geoms, ctx):
    """A building massing.json measures in terraces (the Skyline complex): its single block is
    hidden, and landmark_meshes draws the terraces."""
    if b.get("name") in massing_data():
        for q in geoms:
            ctx.hide(q)
    return geoms


def terraces(M):
    """Each terrace of a measured building: walls glazed from its ground to its roof, a flat roof."""
    wall = Mesh("skyline_complex_glass", "skyline_glass", False, uv=True)
    roof = Mesh("skyline_complex_roof", "skyline_roof", False)
    for t in M["tiers"]:
        ring = t["ring"]
        area = 0.5 * sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1]))
        if area < 0:
            ring = ring[::-1]
        z0, z1 = t["ground"], t["top"]
        u = 0.0
        for a, b in zip(ring, ring[1:] + ring[:1]):
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            wall.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1], [[u, z0], [u + L, z0], [u + L, z1], [u, z1]])
            u += L
        # the roof: a fan from the centroid (the terraces' outlines are cell unions, near convex pieces)
        cx, cy = np.mean(ring, axis=0)
        for a, b in zip(ring, ring[1:] + ring[:1]):
            roof.tri([cx, cy, z1], [a[0], a[1], z1], [b[0], b[1], z1])
    return [wall, roof]


def gondola_data():
    path = os.path.join(HERE, "gondola.json")
    return json.load(open(path)) if os.path.exists(path) else None


def _frame(G):
    (x0, y0), (x1, y1) = G["start"], G["end"]
    L = math.hypot(x1 - x0, y1 - y0)
    u = np.array([(x1 - x0) / L, (y1 - y0) / L])
    r = np.array([u[1], -u[0]])  # to the right going up
    return np.array([x0, y0]), u, r


def cable_z(G, s):
    p = G["profile"]
    s = min(max(s, 0.0), p[-1][0])
    for (a, za), (b, zb) in zip(p, p[1:]):
        if a <= s <= b:
            return za + (zb - za) * (s - a) / max(b - a, 1e-6)
    return p[-1][1]


def gondola_meshes(G):
    o, u, r = _frame(G)
    steel = Mesh("gondola_towers", "gondola_steel", False)
    sheave = Mesh("gondola_sheaves", "gondola_sheave", False)
    footing = Mesh("gondola_footings", "gondola_concrete", False)
    paint = Mesh("gondola_marks", "gondola_yellow", False)
    cable = Mesh("gondola_cable", "gondola_cable", True)
    half = TRACK_M / 2
    for sp in G["supports"]:
        if sp["kind"] != "tower":
            continue
        c = o + u * sp["s"]
        g, top = sp["ground"], sp["ground"] + sp["height_m"]
        arm_z = top - 0.55  # the crossarm, under the sheave trains
        # concrete footing, the mast (tapering tube), its flange rings
        footing.box([c[0], c[1], g - 0.6], [c[0], c[1], g + 0.5], 2.2, 2.2)
        steel.tube([[c[0], c[1], g + 0.5], [c[0], c[1], arm_z - 0.4]], [0.55, 0.38], sides=14)
        for z in np.arange(g + 0.5 + 6.0, arm_z - 1.0, 6.0):
            steel.tube([[c[0], c[1], z - 0.06], [c[0], c[1], z + 0.06]], 0.47 - 0.17 * (z - g) / max(top - g, 1), sides=14)
        # the head: a crossarm across the line, and a maintenance platform with its rail
        a0, a1 = c - r * (half + 1.2), c + r * (half + 1.2)
        steel.box([a0[0], a0[1], arm_z], [a1[0], a1[1], arm_z], 0.6, 0.7)
        p0, p1 = c - u * 1.0, c + u * 1.0
        footing_plat = [p0 - r * (half + 0.9), p0 + r * (half + 0.9), p1 + r * (half + 0.9), p1 - r * (half + 0.9)]
        for k in range(4):
            a, b = footing_plat[k], footing_plat[(k + 1) % 4]
            steel.box([a[0], a[1], arm_z - 0.45], [b[0], b[1], arm_z - 0.45], 0.08, 0.08)
            steel.box([a[0], a[1], arm_z + 0.65], [b[0], b[1], arm_z + 0.65], 0.05, 0.05)
        steel.quad([*footing_plat[0], arm_z - 0.42], [*footing_plat[1], arm_z - 0.42], [*footing_plat[2], arm_z - 0.42], [*footing_plat[3], arm_z - 0.42])
        steel.quad([*footing_plat[3], arm_z - 0.44], [*footing_plat[2], arm_z - 0.44], [*footing_plat[1], arm_z - 0.44], [*footing_plat[0], arm_z - 0.44])
        # a ladder up the mast's downhill side
        lad = c - u * 0.5
        for side in (-0.22, 0.22):
            q = lad + r * side
            steel.box([q[0], q[1], g + 2.5], [q[0], q[1], arm_z - 0.45], 0.05, 0.05)
        paint.box([c[0], c[1], g + 2.0], [c[0], c[1], g + 2.6], 1.12, 1.12)  # the hazard band at its foot
        # a sheave train over each track: a beam along the line with its wheels, the rope over them
        for side in (-1, 1):
            t = c + r * side * half
            cz = cable_z(G, sp["s"])
            pitch = (cable_z(G, sp["s"] + 4) - cable_z(G, sp["s"] - 4)) / 8
            n = 4 if sp["height_m"] < 18 else 6
            Lb = 0.45 * n
            b0, b1 = t - u * Lb / 2, t + u * Lb / 2
            steel.box([b0[0], b0[1], cz - 0.35 - pitch * Lb / 2], [b1[0], b1[1], cz - 0.35 + pitch * Lb / 2], 0.18, 0.3)
            steel.box([t[0], t[1], arm_z + 0.35], [t[0], t[1], cz - 0.35], 0.2, 0.2)
            for k in range(n):
                w = t + u * (-Lb / 2 + 0.225 + 0.45 * k)
                wz = cz - 0.2 + pitch * (-Lb / 2 + 0.225 + 0.45 * k)
                for d in (-0.12, 0.12):
                    q = w + r * d
                    sheave.tube([[q[0] - r[0] * 0.03, q[1] - r[1] * 0.03, wz], [q[0] + r[0] * 0.03, q[1] + r[1] * 0.03, wz]], 0.2, sides=12)
    # the rope: up on the right and down on the left, between the stations, and round the bullwheels
    prof = G["profile"]
    for side in (-1, 1):
        pts = []
        for s, z in prof:
            q = o + u * s + r * side * half
            pts.append([q[0], q[1], z])
        cable.tube(pts, CABLE_R, sides=5)
    return [steel, sheave, footing, paint, cable]


def deck_frame(ground):
    a = math.radians(DECK["along_deg"])
    ax = np.array([math.sin(a), math.cos(a)])           # along the deck
    out = np.array([ax[1], -ax[0]])                       # out over the slope (south-east)
    c = np.array(DECK["at"])
    back = c - out * DECK["depth"] / 2
    z = max(ground(*(back + ax * u)) for u in np.linspace(-DECK["length"] / 2, DECK["length"] / 2, 9)) + 0.15
    return c, ax, out, z


def deck_meshes(ground):
    c, ax, out, z = deck_frame(ground)
    L, D = DECK["length"], DECK["depth"]
    timber = Mesh("skyline_deck", "deck_timber", False, uv=True)
    steel = Mesh("skyline_deck_frame", "deck_steel", False)
    glass = Mesh("skyline_deck_glass", "deck_glass", False)
    P = lambda u, v, h=0.0: [*(c + ax * u + out * v), z + h]
    timber.quad(P(-L / 2, -D / 2), P(L / 2, -D / 2), P(L / 2, D / 2), P(-L / 2, D / 2), [[-L / 2, -D / 2], [L / 2, -D / 2], [L / 2, D / 2], [-L / 2, D / 2]])
    timber.quad(P(-L / 2, D / 2, -0.25), P(L / 2, D / 2, -0.25), P(L / 2, -D / 2, -0.25), P(-L / 2, -D / 2, -0.25))
    for (u0, v0), (u1, v1) in (((-L / 2, D / 2), (L / 2, D / 2)), ((-L / 2, -D / 2), (-L / 2, D / 2)), ((L / 2, -D / 2), (L / 2, D / 2))):
        timber.quad(P(u0, v0, -0.25), P(u1, v1, -0.25), P(u1, v1), P(u0, v0))
        timber.quad(P(u1, v1, -0.25), P(u0, v0, -0.25), P(u0, v0), P(u1, v1))
    # bearers under it, the posts down to the ground, and the balustrade round the open sides
    for u in np.arange(-L / 2 + 1, L / 2, 4.0):
        steel.box(P(u, -D / 2, -0.45), P(u, D / 2, -0.45), 0.2, 0.4)
        for v in (-D / 2 + 1, 0.0, D / 2 - 0.6):
            q = c + ax * u + out * v
            g = ground(*q)
            if z - 0.6 - g > 0.3:
                steel.box([q[0], q[1], g - 0.3], [q[0], q[1], z - 0.6], 0.25, 0.25)
                if z - g > 3:  # cross bracing on the tall ones
                    q2 = c + ax * (u + 4) + out * v
                    steel.box([q[0], q[1], g + 0.5], [q2[0], q2[1], z - 0.7], 0.08, 0.08)
    for (u0, v0), (u1, v1) in (((-L / 2, D / 2), (L / 2, D / 2)), ((-L / 2, -D / 2), (-L / 2, D / 2)), ((L / 2, -D / 2), (L / 2, D / 2))):
        n = max(1, int(math.hypot(u1 - u0, v1 - v0) / 1.5))
        for k in range(n + 1):
            u, v = u0 + (u1 - u0) * k / n, v0 + (v1 - v0) * k / n
            steel.box(P(u, v), P(u, v, 1.1), 0.06, 0.06)
        steel.box(P(u0, v0, 1.12), P(u1, v1, 1.12), 0.08, 0.06)
        glass.quad(P(u0, v0, 0.08), P(u1, v1, 0.08), P(u1, v1, 1.05), P(u0, v0, 1.05))
        glass.quad(P(u1, v1, 0.08), P(u0, v0, 0.08), P(u0, v0, 1.05), P(u1, v1, 1.05))
    return [timber, steel, glass]


def game_surfaces(scene):
    from archkit import Terrain
    t = Terrain("queenstown")
    c, ax, out, z = deck_frame(t)
    L = DECK["length"]
    return [{"name": "Skyline deck", "type": "strip", "origin": [round(float(c[0]), 2), round(float(c[1]), 2)],
             "axis": [round(float(ax[0]), 5), round(float(ax[1]), 5)], "half_width": DECK["depth"] / 2,
             "profile": [[-L / 2, round(z, 2)], [L / 2, round(z, 2)]], "thickness": 0.25, "mesh": "skyline_deck",
             "drape": True, "fly_under": False, "label": "the Skyline deck"}]


def finalize(ctx):
    c, ax, out, z = deck_frame(ctx.ground)
    ctx.landmarks["skyline_deck"] = {"at": [round(float(c[0]), 1), round(float(c[1]), 1)], "z_m": round(z, 1), "faces_deg": round((DECK["along_deg"] + 90) % 360, 1)}
    G = gondola_data()
    if G:
        o, u, r = _frame(G)
        top = G["supports"][-1]
        ctx.landmarks["skyline_gondola"] = {"start": G["start"], "end": G["end"], "length_m": G["length_m"], "rise_m": G["rise_m"],
                                            "top_station_m": round(top["ground"], 1), "towers": sum(1 for s in G["supports"] if s["kind"] == "tower")}


def landmark_meshes(scene):
    meshes = []
    G = gondola_data()
    if G:
        meshes += gondola_meshes(G)
    from archkit import Terrain
    meshes += deck_meshes(Terrain("queenstown"))
    for M in massing_data().values():
        meshes += terraces(M)
    return MATERIALS, meshes


def game_rail(scene):
    """The gondola's cable for the game's cabins (web/game/rail.js): the line along its centre from
    the bottom station up, at the cable's height, in decimetres."""
    G = gondola_data()
    if not G:
        return {}
    o, u, r = _frame(G)
    pts = []
    for s, z in G["profile"]:
        q = o + u * s
        pts += [round(q[0] * 10), round(q[1] * 10), round(z * 10)]
    return {"gondola": {"lines": [{"length_m": G["length_m"], "p": pts}], "track_m": TRACK_M, "hanger_m": 2.6, "height_m": 2.05}}
