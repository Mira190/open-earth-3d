"""Queenstown (Tāhuna): what the generic pipeline cannot know from open data.

Heights come from LINZ's 2021 LiDAR (every footprint's roof measured from the 1 m surface model,
pipeline/survey.py), so no building needs a height fix here. What the data cannot carry:

  Skyline Gondola   the towers, the cable and the cabins. The line, its six towers and its two
                    stations are OpenStreetMap's (via Overture); the towers' heights and the cable's
                    profile are measured from the LiDAR by gondola.py into gondola.json. The towers
                    are Doppelmayr-style tubular steel masts with a crossarm carrying a sheave train
                    over each track; the cabins (web/game/rail.js, kind "gondola") ride the profile.

  Skyline deck      the viewing deck on the Skyline restaurant's south-east face on Bob's Peak, where
                    the town's best-known photograph is taken: the bay, the Gardens, the Kelvin
                    Peninsula and the Remarkables. A timber deck on a steel frame with a glass
                    balustrade, 17 m over the luge track. Its place and level are measured (DECK:
                    the 2026 aerial photographs and the 2021 LiDAR); the game walks it as a strip
                    and the player starts on it. A glass lift (LIFT) joins it to the luge track.
"""
import json
import math
import os

import numpy as np

from meshkit import Mesh

HERE = os.path.dirname(os.path.abspath(__file__))
TRACK_M = 5.6        # between the up and the down cable
CABLE_R = 0.026      # the haul rope, 52 mm

# The viewing deck along the south-east face of the Skyline restaurant, where LINZ's 2026 aerial photographs
# show the crowd at its balustrade and the 2021 LiDAR's surface model a 3-4 m strip 17 m over the luge
# track below, at 474.6 m (the restaurant's roof at 479.4 m): its centre, the bearing of its long side,
# its length and depth (metres), and its level (z, from the LiDAR; without it, the ground at its back edge).
DECK = {"at": (-975.0, 478.1), "along_deg": 49.5, "length": 26.0, "depth": 3.6, "z": 474.6}

# The way up to the deck. The real deck is reached through the restaurant, and the extension that opened
# in March 2026 has a glass lift (Naylor Love's project page: a glass elevator on a structural steel frame;
# the Otago Daily Times: five levels from the lift level up to the deck). Neither gives the lift's place,
# so it is drawn where the deck's south-west end meets the luge track, 15 m below: a glass shaft on a
# steel frame, its door to the luge track on its south-west side, its top door onto the deck. u: along the
# deck from its centre (past its south-west end), side: the shaft's width (m), m_per_min: a passenger
# lift's 1 m/s.
LIFT = {"u": -14.9, "side": 2.4, "m_per_min": 60}

MATERIALS = {
    "skyline_wall": {"color": "#3e4347", "roughness": 0.55, "metalness": 0.2},
    "skyline_glass": {"color": "#26343c", "roughness": 0.08, "metalness": 0.5, "pattern": "curtain_wall", "bay_m": 1.8, "storey_m": 3.6,
                      "spandrel": "#3e4347", "mullion_m": 0.1, "frame": "#2a2e31", "lit_share": 0.8, "lit_k": 0.8},
    "skyline_roof": {"color": "#55595c", "roughness": 0.8},
    "deck_timber": {"color": "#8d6c4c", "roughness": 0.85, "pattern": "granite", "joints_m": [0.14, 2.4]},
    "deck_steel": {"color": "#3b4045", "roughness": 0.5, "metalness": 0.6},
    "deck_glass": {"color": "#3d5158", "roughness": 0.04, "metalness": 0.0, "opacity": 0.12},
    "skyline_lift_cab": {"color": "#9aa3a8", "roughness": 0.3, "metalness": 0.6},
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


def gondola_meshes(G, ground=None):
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
        if sp.get("type") == "portal":
            portal(G, sp, o, u, r, steel, sheave, footing, paint, ground)
            continue
        c = o + u * sp["s"]
        g, top = sp["ground"], sp["ground"] + sp["height_m"]
        arm_z = top - 0.55  # the crossarm, under the sheave trains
        # concrete plinth, the mast (tapering tube), its flange rings
        footing.box([c[0], c[1], g - 0.6], [c[0], c[1], g + 0.5], 2.2, 2.2)
        steel.tube([[c[0], c[1], g + 0.5], [c[0], c[1], arm_z - 0.4]], [0.55, 0.38], sides=14)
        for z in np.arange(g + 0.5 + 6.0, arm_z - 1.0, 6.0):
            steel.tube([[c[0], c[1], z - 0.06], [c[0], c[1], z + 0.06]], 0.47 - 0.17 * (z - g) / max(top - g, 1), sides=14)
        # the head: a crossarm across the line, and a maintenance platform with its rail
        a0, a1 = c - r * (half + 1.2), c + r * (half + 1.2)
        steel.box([a0[0], a0[1], arm_z], [a1[0], a1[1], arm_z], 0.6, 0.7)
        platform(steel, c, u, r, half, 1.0, arm_z)
        # a ladder up the mast's downhill side
        lad = c - u * 0.5
        for side in (-0.22, 0.22):
            q = lad + r * side
            steel.box([q[0], q[1], g + 2.5], [q[0], q[1], arm_z - 0.45], 0.05, 0.05)
        paint.box([c[0], c[1], g + 2.0], [c[0], c[1], g + 2.6], 1.12, 1.12)  # the hazard band at its foot
        # a sheave train over each track: a beam along the line with its wheels, the rope over them
        for side in (-1, 1):
            t = c + r * side * half
            steel.box([t[0], t[1], arm_z + 0.35], [t[0], t[1], cable_z(G, sp["s"]) - 0.35], 0.2, 0.2)
            sheave_train(G, sp["s"], sp.get("head_m", 0.45 * (4 if sp["height_m"] < 18 else 6)), t, u, r, steel, sheave)
    # the rope: up on the right and down on the left, between the stations, and round the bullwheels
    prof = G["profile"]
    for side in (-1, 1):
        pts = []
        for s, z in prof:
            q = o + u * s + r * side * half
            pts.append([q[0], q[1], z])
        cable.tube(pts, CABLE_R, sides=5)
    return [steel, sheave, footing, paint, cable]


def sheave_train(G, s, length, t, u, r, steel, sheave):
    """A beam along the line at track point t (the tower's s), `length` m long, with a pair of
    wheels every 0.45 m under the rope, following the cable's pitch."""
    n = max(4, int(length / 0.45))
    Lb = 0.45 * n
    z = lambda d: cable_z(G, s + d)
    b0, b1 = t - u * Lb / 2, t + u * Lb / 2
    steel.box([b0[0], b0[1], z(-Lb / 2) - 0.35], [b1[0], b1[1], z(Lb / 2) - 0.35], 0.18, 0.3)
    for k in range(n):
        d = -Lb / 2 + 0.225 + 0.45 * k
        w, wz = t + u * d, z(d) - 0.2
        sheave.tube([[w[0] - r[0] * 0.15, w[1] - r[1] * 0.15, wz], [w[0] + r[0] * 0.15, w[1] + r[1] * 0.15, wz]], 0.2, sides=8)  # a pair of wheels


def platform(steel, c, u, r, half, along, z):
    """A maintenance platform round a tower's head at z: grating, its frame and a handrail."""
    p0, p1 = c - u * along, c + u * along
    ring = [p0 - r * (half + 0.9), p0 + r * (half + 0.9), p1 + r * (half + 0.9), p1 - r * (half + 0.9)]
    for k in range(4):
        a, b = ring[k], ring[(k + 1) % 4]
        steel.box([a[0], a[1], z - 0.45], [b[0], b[1], z - 0.45], 0.08, 0.08)
        steel.box([a[0], a[1], z + 0.65], [b[0], b[1], z + 0.65], 0.05, 0.05)
        steel.box([a[0], a[1], z - 0.45], [a[0], a[1], z + 0.65], 0.05, 0.05)
    steel.quad([*ring[0], z - 0.42], [*ring[1], z - 0.42], [*ring[2], z - 0.42], [*ring[3], z - 0.42])
    steel.quad([*ring[3], z - 0.44], [*ring[2], z - 0.44], [*ring[1], z - 0.44], [*ring[0], z - 0.44])


def portal(G, sp, o, u, r, steel, sheave, footing, paint, ground=None):
    """A portal tower, as the 2026 photographs show three of them (by the bottom station, over the
    luge and under the top station): a lattice frame across and along the line on a pair of legs
    outside the tracks (two pairs under a long head), carrying a long sheave train over each track."""
    half = TRACK_M / 2
    c, Lh = o + u * sp["s"], sp.get("head_m", 8.0)
    leg_d = half + 1.9
    ends = [-Lh / 2 + 1.0, Lh / 2 - 1.0] if Lh > 12 else [0.0]
    cz = lambda d: cable_z(G, sp["s"] + d)
    for e in ends:
        q = c + u * e
        top = cz(e) - 1.1  # the cross girder, under the sheave trains
        feet = []
        for side in (-1, 1):
            f = q + r * side * (leg_d + 0.8)
            g = ground(*f) if ground else sp["ground"]  # each leg on the bare earth under it
            feet.append((f, g))
            footing.box([f[0], f[1], g - 0.6], [f[0], f[1], g + 0.6], 1.8, 1.8)
            h = q + r * side * leg_d
            steel.tube([[f[0], f[1], g + 0.6], [h[0], h[1], top]], [0.42, 0.3], sides=12)
            paint.tube([[f[0], f[1], g + 1.8], [f[0] + (h[0] - f[0]) * 0.04, f[1] + (h[1] - f[1]) * 0.04, g + 2.4]], 0.45, sides=12)
        # the cross girder and a K-brace between the legs
        a0, a1 = q - r * (leg_d + 0.3), q + r * (leg_d + 0.3)
        steel.box([a0[0], a0[1], top], [a1[0], a1[1], top], 0.7, 0.9)
        (f0, g0), (f1, g1) = feet
        zm = min(g0, g1) + 0.55 * (top - min(g0, g1))
        m0, m1 = q - r * (leg_d - 0.15) * 0.97, q + r * (leg_d - 0.15) * 0.97
        steel.box([m0[0], m0[1], zm], [m1[0], m1[1], zm], 0.25, 0.25)
        for m in (m0, m1):
            steel.box([m[0], m[1], zm], [q[0], q[1], top - 0.45], 0.16, 0.16)
    # the head: a lattice along the line, a girder and a walkway outside each track
    for side in (-1, 1):
        t = c + r * side * half
        sheave_train(G, sp["s"], Lh, t, u, r, steel, sheave)
        w = c + r * side * (half + 1.0)
        b0, b1 = w - u * Lh / 2, w + u * Lh / 2
        z0, z1 = cz(-Lh / 2) - 1.1, cz(Lh / 2) - 1.1
        steel.box([b0[0], b0[1], z0], [b1[0], b1[1], z1], 0.35, 0.6)            # the bottom chord
        steel.box([b0[0], b0[1], z0 + 1.5], [b1[0], b1[1], z1 + 1.5], 0.06, 0.06)  # the walkway's handrail
        n = max(2, int(Lh / 2.4))
        for k in range(n + 1):
            d = -Lh / 2 + Lh * k / n
            p = c + u * d
            z = cz(d) - 1.1
            pa, pb = p - r * (half + 1.0), p + r * (half + 1.0)
            if side < 0:
                steel.box([pa[0], pa[1], z], [pb[0], pb[1], z], 0.18, 0.25)   # the cross members
            q = p + r * side * (half + 1.0)
            steel.box([q[0], q[1], z], [q[0], q[1], z + 1.5], 0.05, 0.05)       # the handrail's posts
            ts = p + r * side * half
            steel.box([q[0], q[1], z + 0.1], [ts[0], ts[1], cz(d) - 0.45], 0.12, 0.12)  # the hangers to the sheave beam
    paint.box([*(c - u * Lh / 2 - r * (half + 1.0)), cz(-Lh / 2) - 1.45], [*(c - u * Lh / 2 + r * (half + 1.0)), cz(-Lh / 2) - 1.45], 0.12, 0.12)


def deck_frame(ground):
    a = math.radians(DECK["along_deg"])
    ax = np.array([math.sin(a), math.cos(a)])           # along the deck
    out = np.array([ax[1], -ax[0]])                       # out over the slope (south-east)
    c = np.array(DECK["at"])
    back = c - out * DECK["depth"] / 2
    z = DECK.get("z") or max(ground(*(back + ax * u)) for u in np.linspace(-DECK["length"] / 2, DECK["length"] / 2, 9)) + 0.15
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


def lift_frame(ground):
    """The lift's centre, the deck's axes and level, the ground at its foot and its two stops ([x, y, z])."""
    c, ax, out, z = deck_frame(ground)
    q = c + ax * LIFT["u"]
    h = LIFT["side"] / 2
    foot_xy = q - ax * (h + 1.2)                        # outside its door on the south-west side, along the luge track
    top_xy = c + ax * (-DECK["length"] / 2 + 1.2)       # on the deck, by its south-west end
    g = float(min(ground(*(q + ax * a + out * b)) for a in (-h, h) for b in (-h, h)))
    foot = [round(float(foot_xy[0]), 2), round(float(foot_xy[1]), 2), round(float(ground(*foot_xy)), 2)]
    top = [round(float(top_xy[0]), 2), round(float(top_xy[1]), 2), round(float(z), 2)]
    return q, ax, out, z, g, foot, top


def lift_meshes(ground):
    q, ax, out, z, g, foot, top = lift_frame(ground)
    h = LIFT["side"] / 2
    steel = Mesh("skyline_lift_frame", "deck_steel", False)
    glass = Mesh("skyline_lift_glass", "deck_glass", False)
    roof = Mesh("skyline_lift_roof", "skyline_roof", False)
    cab = Mesh("skyline_lift_cab", "skyline_lift_cab", False)
    P = lambda a, b, zz: [*(q + ax * a + out * b), zz]
    z0, z1 = g - 0.3, z + 3.2                             # from its pit to the machine head over the deck
    for a in (-h, h):
        for b in (-h, h):
            steel.box(P(a, b, z0), P(a, b, z1), 0.16, 0.16)  # the corner posts
    for zz in np.arange(g + 3.0, z1, 3.0):                    # a ring beam every 3 m
        for (a0, b0), (a1, b1) in (((-h, -h), (h, -h)), ((h, -h), (h, h)), ((h, h), (-h, h)), ((-h, h), (-h, -h))):
            steel.box(P(a0, b0, zz), P(a1, b1, zz), 0.1, 0.12)
    for (a0, b0), (a1, b1) in (((-h, -h), (h, -h)), ((h, -h), (h, h)), ((h, h), (-h, h)), ((-h, h), (-h, -h))):
        glass.quad(P(a0, b0, g), P(a1, b1, g), P(a1, b1, z1 - 0.4), P(a0, b0, z1 - 0.4))
        glass.quad(P(a1, b1, g), P(a0, b0, g), P(a0, b0, z1 - 0.4), P(a1, b1, z1 - 0.4))
    roof.box(P(0, 0, z1 - 0.4), P(0, 0, z1 + 0.15), LIFT["side"] + 0.5, LIFT["side"] + 0.5, up=(*ax, 0))
    # the cab, waiting at the deck, and the door frames at the foot and onto the deck
    cab.box(P(0, 0, z + 0.05), P(0, 0, z + 2.4), LIFT["side"] - 0.3, LIFT["side"] - 0.3, up=(*ax, 0))
    for zz, a in ((g, -h), (z, h)):  # the door at the foot faces south-west, the one at the top onto the deck
        steel.box(P(a, -0.6, zz), P(a, -0.6, zz + 2.3), 0.12, 0.12, up=(*ax, 0))
        steel.box(P(a, 0.6, zz), P(a, 0.6, zz + 2.3), 0.12, 0.12, up=(*ax, 0))
        steel.box(P(a, -0.6, zz + 2.3), P(a, 0.6, zz + 2.3), 0.14, 0.12)
    # a landing from the shaft's top door onto the deck's end
    steel.box(P(h, 0, z - 0.3), P(h + 1.0, 0, z - 0.3), 1.3, 0.3)
    return [steel, glass, roof, cab]


def game_extras(scene):
    """The lift between the luge track and the deck (web/game/game.js rideLift; route.js walks through it)."""
    from archkit import Terrain
    q, ax, out, z, g, foot, top = lift_frame(Terrain("queenstown"))
    face_out = [round(float(out[0]), 3), round(float(out[1]), 3)]
    face_sw = [round(float(-ax[0]), 3), round(float(-ax[1]), 3)]
    return {"lifts": [{"id": "skyline-lift", "name": "Skyline glass lift", "line": "SKYLINE GLASS LIFT · LUGE TRACK → DECK", "m_per_min": LIFT["m_per_min"],
                       "stops": [{"name": "The luge track", "at": foot, "face": face_sw},
                                 {"name": "The Skyline deck", "at": top, "face": face_out}]}]}


def game_surfaces(scene):
    from archkit import Terrain
    t = Terrain("queenstown")
    c, ax, out, z = deck_frame(t)
    L = DECK["length"]
    return [{"name": "Skyline deck", "type": "strip", "origin": [round(float(c[0]), 2), round(float(c[1]), 2)],
             "axis": [round(float(ax[0]), 5), round(float(ax[1]), 5)], "half_width": DECK["depth"] / 2,
             "profile": [[-L / 2, round(z, 2)], [L / 2, round(z, 2)]], "thickness": 0.25, "mesh": "skyline_deck",
             "drape": False, "fly_under": False, "label": "the Skyline deck"}]


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
    from archkit import Terrain
    T = Terrain("queenstown")
    if G:
        meshes += gondola_meshes(G, T)
    meshes += deck_meshes(T)
    meshes += lift_meshes(T)
    for M in massing_data().values():
        meshes += terraces(M)
    heritage = _sibling("heritage")
    hm, hidden = heritage.meshes(T)
    return {**MATERIALS, **heritage.MATERIALS}, meshes + hm, {"hidden": hidden}


def _sibling(name):
    """A module next to this one (cities/queenstown/<name>.py): the city's own modules are not on the path."""
    import importlib.util
    import sys
    key = f"queenstown_{name}"
    if key not in sys.modules:
        spec = importlib.util.spec_from_file_location(key, os.path.join(HERE, f"{name}.py"))
        sys.modules[key] = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sys.modules[key])
    return sys.modules[key]


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
