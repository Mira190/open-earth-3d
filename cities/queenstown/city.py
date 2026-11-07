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
# the Otago Daily Times: five levels from the lift level up to the deck). No source found says where it
# stands (checked again in November 2026: the opening coverage, the builder's page, Commons' April 2026
# photographs), so it is drawn where the deck's south-west end meets the luge track, 15 m below.
# It is drawn as a panoramic machine-room-less traction lift of the kind KONE's MonoSpace and Scenic
# planning guides describe: a 1000 kg car 1.45 m deep and 1.6 m wide, glazed on its long sides, doors at
# both ends (through-car: the luge track's door faces south-west, the deck's north-east), the counterweight
# on the shaft's back wall against the hill so the view side stays clear, the machine in the shaft's head.
# u: the shaft's centre along the deck from its centre (its north-east face against the deck's end);
# a, b: the shaft's half depth (along the deck) and half width (m); m_per_min: a passenger lift's 1 m/s.
LIFT = {"u": -14.1, "a": 1.05, "b": 1.35, "m_per_min": 60}
LIFT_CAR = {"a": 0.72, "b0": -0.6, "b1": 1.0, "h": 2.35}   # the car: half depth, its sides across (b), its height
LIFT_DOOR = (-0.25, 0.65)                                  # the doors' clear opening across the shaft (b), 0.9 m

MATERIALS = {
    "skyline_wall": {"color": "#3e4347", "roughness": 0.55, "metalness": 0.2},
    "skyline_glass": {"color": "#26343c", "roughness": 0.08, "metalness": 0.5, "pattern": "curtain_wall", "bay_m": 1.8, "storey_m": 3.6,
                      "spandrel": "#3e4347", "mullion_m": 0.1, "frame": "#2a2e31", "lit_share": 0.8, "lit_k": 0.8},
    "skyline_roof": {"color": "#55595c", "roughness": 0.8},
    "deck_timber": {"color": "#8d6c4c", "roughness": 0.85, "pattern": "granite", "joints_m": [0.14, 2.4]},
    "deck_steel": {"color": "#3b4045", "roughness": 0.5, "metalness": 0.6},
    "deck_glass": {"color": "#3d5158", "roughness": 0.04, "metalness": 0.0, "opacity": 0.12},
    "deck_led": {"color": "#d8cbb4", "roughness": 0.5, "emissive": "#ffc98a", "glow": 2.2, "solid": False},
    "lift_frame": {"color": "#2b3034", "roughness": 0.42, "metalness": 0.55},
    "lift_steel": {"color": "#c3c8cc", "roughness": 0.26, "metalness": 0.9},
    "lift_rail": {"color": "#6d7378", "roughness": 0.4, "metalness": 0.75},
    "lift_glass": {"color": "#55707a", "roughness": 0.03, "metalness": 0.0, "opacity": 0.13},
    # what moves (the car, its doors, the landing doors, the counterweight) and the lit buttons are not walls to
    # the game's walkers (web/game/nav.js): the car rides, and the shaft's glass and frame round it are the walls
    "lift_door_glass": {"color": "#5d7680", "roughness": 0.03, "metalness": 0.0, "opacity": 0.16, "solid": False},
    "lift_car_glass": {"color": "#55707a", "roughness": 0.03, "metalness": 0.0, "opacity": 0.13, "solid": False},
    "lift_car_steel": {"color": "#c3c8cc", "roughness": 0.26, "metalness": 0.9, "solid": False},
    "lift_car_frame": {"color": "#2b3034", "roughness": 0.42, "metalness": 0.55, "solid": False},
    "lift_car_floor": {"color": "#4a4743", "roughness": 0.55, "solid": False},
    "lift_light": {"color": "#f3efe6", "roughness": 0.5, "emissive": "#fff1dc", "glow": 1.4, "solid": False},
    "lift_cw": {"color": "#4b5054", "roughness": 0.7, "metalness": 0.3, "solid": False},
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
    led = Mesh("skyline_deck_led", "deck_led", False, floodlit=True)
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
    # (at the south-west end the lift's shaft closes the deck: the balustrade runs from each corner to the
    # shaft's corner column and stops there, and the landing door opens between)
    sw = LIFT["b"] + 0.01
    for (u0, v0), (u1, v1) in (((-L / 2, D / 2), (L / 2, D / 2)), ((-L / 2, -D / 2), (-L / 2, -sw)), ((-L / 2, sw), (-L / 2, D / 2)), ((L / 2, -D / 2), (L / 2, D / 2))):
        n = max(1, int(math.hypot(u1 - u0, v1 - v0) / 1.5))
        for k in range(n + 1):
            u, v = u0 + (u1 - u0) * k / n, v0 + (v1 - v0) * k / n
            steel.box(P(u, v), P(u, v, 1.1), 0.06, 0.06)
        steel.box(P(u0, v0, 1.12), P(u1, v1, 1.12), 0.08, 0.06)
        led.box(P(u0, v0, 1.08), P(u1, v1, 1.08), 0.03, 0.012)   # the LED strip under the handrail, lit after dark
        glass.quad(P(u0, v0, 0.08), P(u1, v1, 0.08), P(u1, v1, 1.05), P(u0, v0, 1.05))
        glass.quad(P(u1, v1, 0.08), P(u0, v0, 0.08), P(u0, v0, 1.05), P(u1, v1, 1.05))
    return [timber, steel, glass, led]


def lift_frame(ground):
    """The lift's centre, the deck's axes and level, the ground at its foot and its two stops ([x, y, z])."""
    c, ax, out, z = deck_frame(ground)
    q = c + ax * LIFT["u"]
    A, B = LIFT["a"], LIFT["b"]
    foot_xy = q - ax * (A + 1.2)                        # outside its door on the south-west side, along the luge track
    top_xy = c + ax * (-DECK["length"] / 2 + 2.2)       # on the deck, by its south-west end (clear of the shaft's 2 m cells, nav.js)
    g = float(ground(*foot_xy))                         # the foot's landing, level with the luge track outside its door
    foot = [round(float(foot_xy[0]), 2), round(float(foot_xy[1]), 2), round(g, 2)]
    top = [round(float(top_xy[0]), 2), round(float(top_xy[1]), 2), round(float(z), 2)]
    return q, ax, out, z, g, foot, top


def cuboid(m, P, a0, a1, b0, b1, z0, z1):
    """A box in the lift's frame (a along the deck, b across it, z up): its six faces."""
    v = [P(a, b, zz) for zz in (z0, z1) for b in (b0, b1) for a in (a0, a1)]
    for f in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
        m.quad(*[v[k] for k in f])


def lift_levels(g, z):
    """The shaft's transoms: at the foot's floor and door head, the deck's floor and door head, the head,
    and between them no more than 3.2 m apart."""
    z1 = z + LIFT_CAR["h"] + 1.45
    lv = [g, g + 2.3]
    n = max(1, math.ceil((z - 0.25 - (g + 2.3)) / 3.2))
    lv += [g + 2.3 + (z - 0.25 - g - 2.3) * k / n for k in range(1, n + 1)]
    return lv + [z + 2.3, z1], z1


def lift_meshes(ground):
    """The panoramic lift, as LIFT says: a glazed shaft on a slim graphite frame (corner columns, a transom at
    each landing and every 3 m, mullions dividing the glass, a stainless surround and call buttons at each
    landing door), the car glazed on its long sides with a handrail, a stone floor and a lit ceiling, its
    sling and guide shoes on T-rails, the counterweight on its own rails on the back wall, the machine and
    its ropes in the head, and a pit plinth on the luge track. The car is drawn at the deck (skyline_lift_car*
    and its doors), the counterweight at the bottom (skyline_lift_cw); the game moves them
    (web/game/game.js liftCar) and slides the landing doors (skyline_lift_door_top, _foot) where the car stands."""
    q, ax, out, z, g, foot, top = lift_frame(ground)
    A, B = LIFT["a"], LIFT["b"]
    ca, cb0, cb1, ch = LIFT_CAR["a"], LIFT_CAR["b0"], LIFT_CAR["b1"], LIFT_CAR["h"]
    d0, d1 = LIFT_DOOR
    P = lambda a, b, zz: [*(q + ax * a + out * b), zz]
    M = lambda name, mat, flood=False: Mesh(f"skyline_lift_{name}", mat, False, floodlit=flood)
    frame, glass, steel, rail, head = M("frame", "lift_frame"), M("glass", "lift_glass"), M("steel", "lift_steel"), M("rail", "lift_rail"), M("head", "lift_frame")
    plinth = M("pit", "gondola_concrete")
    car_steel, car_glass, car_floor = M("car_steel", "lift_car_steel"), M("car_glass", "lift_car_glass"), M("car_floor", "lift_car_floor")
    car_frame, car_light = M("car_frame", "lift_car_frame"), M("car_light", "lift_light", True)
    doors = {k: M(k, "lift_door_glass") for k in ("car_door_ne", "car_door_sw", "door_top", "door_foot")}
    door_frames = {k: M(k + "_frame", "lift_car_steel") for k in doors}
    buttons = M("buttons", "lift_light", True)
    cw, rope_car, rope_cw = M("cw", "lift_cw"), M("rope_car", "gondola_cable"), M("rope_cw", "gondola_cable")
    levels, z1 = lift_levels(g, z)
    z0 = min(g, min(float(ground(*(q + ax * a + out * b))) for a in (-A, 0, A) for b in (-B, 0, B))) - 0.35   # the pit, under the lowest ground
    # the pit's plinth on the luge track, and a step of paving out to the foot's door
    cuboid(plinth, P, -A - 0.25, A + 0.25, -B - 0.25, B + 0.25, z0 - 0.4, g + 0.02)
    cuboid(plinth, P, -A - 1.6, -A - 0.25, d0 - 0.5, d1 + 0.5, z0 - 0.4, g + 0.02)
    # the frame: corner columns (150 SHS), transoms round the four faces at each level
    c = 0.15
    for sa in (-1, 1):
        for sb in (-1, 1):
            cuboid(frame, P, sa * A - (c if sa > 0 else 0), sa * A + (c if sa < 0 else 0), sb * B - (c if sb > 0 else 0), sb * B + (c if sb < 0 else 0), z0, z1)
    for k, zz in enumerate(levels):
        t = 0.2 if k in (0, len(levels) - 1) else 0.14     # the heavier ring beams at the pit and the head
        for sa in (-1, 1):
            cuboid(frame, P, sa * A - (0.12 if sa > 0 else 0), sa * A + (0.12 if sa < 0 else 0), -B, B, zz - t / 2, zz + t / 2)
        for sb in (-1, 1):
            cuboid(frame, P, -A, A, sb * B - (0.12 if sb > 0 else 0), sb * B + (0.12 if sb < 0 else 0), zz - t / 2, zz + t / 2)
    # the glass: on the long faces (b = +-B) two panes a bay, a mullion between; on the door faces (a = +-A) the
    # panes either side of the door's surround, and over it, with the doors' openings left for the landing doors
    for sb in (-1, 1):
        bb = sb * (B - 0.07)
        for lo, hi in zip(levels, levels[1:]):
            cuboid(frame, P, -0.025, 0.025, bb - 0.06, bb + 0.06, lo, hi)          # the mullion
            for a0, a1 in ((-A + c, -0.025), (0.025, A - c)):
                glass.quad(P(a0, bb, lo + 0.07), P(a1, bb, lo + 0.07), P(a1, bb, hi - 0.07), P(a0, bb, hi - 0.07))
    for sa, zd in ((1, z), (-1, g)):                                                 # NE: the deck's door; SW: the luge track's
        aa = sa * (A - 0.07)
        for lo, hi in zip(levels, levels[1:]):
            spans = [(-B + c, B - c)]
            if lo <= zd + 0.01 < hi or abs(lo - zd) < 0.3:                          # the bay with the door in it
                spans = [(-B + c, d0 - 0.11), (d1 + 0.11, B - c)]
                glass.quad(P(aa, d0 - 0.11, zd + 2.45), P(aa, d1 + 0.11, zd + 2.45), P(aa, d1 + 0.11, hi - 0.07), P(aa, d0 - 0.11, hi - 0.07))
            for b0, b1 in spans:
                glass.quad(P(aa, b0, lo + 0.07), P(aa, b1, lo + 0.07), P(aa, b1, hi - 0.07), P(aa, b0, hi - 0.07))
        # the landing door's stainless surround: jambs, a head with the floor indicator, the sill; the call buttons
        for bj in (d0 - 0.11, d1 + 0.01):
            cuboid(steel, P, aa - 0.05, aa + 0.05 + sa * 0.04, bj, bj + 0.1, zd, zd + 2.45)
        cuboid(steel, P, aa - 0.05, aa + 0.05 + sa * 0.04, d0 - 0.11, d1 + 0.11, zd + 2.3, zd + 2.45)
        sill_out = 1.12 if sa > 0 else A + 0.3                                         # (to the deck's end at the top)
        cuboid(steel, P, min(sa * (A - 0.12), sa * sill_out), max(sa * (A - 0.12), sa * sill_out), d0 - 0.11, d1 + 0.11, zd - 0.06, zd + 0.008)
        cuboid(buttons, P, aa + sa * 0.06, aa + sa * 0.075, (d0 + d1) / 2 - 0.18, (d0 + d1) / 2 + 0.18, zd + 2.33, zd + 2.42)   # the indicator
        cuboid(steel, P, aa + sa * 0.05, aa + sa * 0.08, d1 + 0.16, d1 + 0.3, zd + 0.95, zd + 1.3)                            # the call panel
        for bz in (1.05, 1.18):
            cuboid(buttons, P, aa + sa * 0.08, aa + sa * 0.095, d1 + 0.2, d1 + 0.26, zd + bz - 0.03, zd + bz + 0.03)
        # the landing door: a glass leaf in a slim stainless frame, shut (the game slides it open)
        k = "door_top" if sa > 0 else "door_foot"
        door_leaf(doors[k], door_frames[k], P, sa * (A - 0.11), d0, d1, zd, 2.28)
    # the T-rails: the car's either side of it, the counterweight's on the back wall, bracketed to each transom
    for bb in (cb0 - 0.12, cb1 + 0.12):
        cuboid(rail, P, -0.045, 0.045, bb - 0.035, bb + 0.035, z0 + 0.3, z1 - 0.2)
        for zz in levels[1:-1]:
            cuboid(rail, P, -0.05, 0.05, min(bb, sb_wall(bb, B)), max(bb, sb_wall(bb, B)), zz - 0.04, zz + 0.04)
    cw_b = -B + 0.32
    for aa in (-0.5, 0.5):
        cuboid(rail, P, aa - 0.035, aa + 0.035, cw_b - 0.03, cw_b + 0.03, z0 + 0.3, z1 - 0.2)
        for zz in levels[1:-1]:
            cuboid(rail, P, aa - 0.04, aa + 0.04, -B + 0.1, cw_b, zz - 0.04, zz + 0.04)
    # the counterweight, at the bottom while the car is at the deck: a frame of filler weights between its rails
    cz = g + 0.6
    cuboid(cw, P, -0.45, 0.45, cw_b - 0.09, cw_b + 0.09, cz, cz + 2.1)
    for k in range(1, 9):
        cuboid(car_frame, P, -0.455, 0.455, cw_b - 0.095, cw_b + 0.095, cz + 2.1 * k / 9 - 0.01, cz + 2.1 * k / 9 + 0.01)
    # the machine in the head: the gearless motor and its traction sheave over the counterweight, a bedplate
    cuboid(head, P, -0.6, 0.6, -B + 0.1, -B + 0.75, z1 - 0.45, z1 - 0.32)
    cuboid(rail, P, -0.3, 0.25, -B + 0.15, -B + 0.6, z1 - 0.32, z1 + 0.05)
    head.tube([P(0.25, cw_b - 0.18, z1 - 0.12), P(0.4, cw_b - 0.18, z1 - 0.12)], 0.2, sides=14)
    # the head over the shaft: a graphite cap a little wider than the frame, with a louvred vent
    cuboid(head, P, -A - 0.1, A + 0.1, -B - 0.1, B + 0.1, z1 + 0.1, z1 + 0.5)
    for k in range(5):
        cuboid(frame, P, -A - 0.12, -A - 0.1, -0.6 + 0.3 * k - 0.1, -0.6 + 0.3 * k + 0.1, z1 + 0.18, z1 + 0.42)
    # the ropes: from the sheave down to the car's crosshead, and to the counterweight (the game stretches them)
    for db in (-0.05, 0.05):
        rope_car.tube([P(0.0, (cb0 + cb1) / 2 + db, z1 - 0.1), P(0.0, (cb0 + cb1) / 2 + db, z + ch + 0.45)], 0.008, sides=4)
        rope_cw.tube([P(0.0, cw_b + db, z1 - 0.1), P(0.0, cw_b + db, cz + 2.1)], 0.008, sides=4)
    # the car at the deck: its floor (stone over a steel frame), its sling (stiles up the rails, the crosshead,
    # the guide shoes), the ceiling with its light, slim stainless posts, glass on its long sides with a
    # handrail and a kick plate, and the door ends: a fixed panel either side of the door, the door leaf
    zf = z
    cuboid(car_floor, P, -ca, ca, cb0, cb1, zf - 0.03, zf + 0.004)
    cuboid(car_frame, P, -ca, ca, cb0, cb1, zf - 0.22, zf - 0.03)
    for bb in (cb0 - 0.06, cb1 + 0.06):
        cuboid(car_frame, P, -0.07, 0.07, bb - 0.04, bb + 0.04, zf - 0.3, zf + ch + 0.42)
        for zz in (zf - 0.3, zf + ch + 0.3):
            cuboid(car_steel, P, -0.06, 0.06, bb + (-0.08 if bb < 0 else 0.0), bb + (0.08 if bb > 0 else 0.0) + (0.0 if bb > 0 else 0.0), zz - 0.06, zz + 0.06)
    cuboid(car_frame, P, -0.1, 0.1, cb0 - 0.1, cb1 + 0.1, zf + ch + 0.3, zf + ch + 0.5)       # the crosshead
    cuboid(car_frame, P, -ca, ca, cb0, cb1, zf + ch, zf + ch + 0.1)                          # the ceiling
    cuboid(car_light, P, -ca + 0.16, ca - 0.16, cb0 + 0.16, cb1 - 0.16, zf + ch - 0.012, zf + ch)
    for sa in (-1, 1):
        for bb in (cb0, cb1):
            cuboid(car_steel, P, sa * ca - 0.025, sa * ca + 0.025, bb - 0.025, bb + 0.025, zf, zf + ch)
    for bb in (cb0, cb1):
        sb = 1 if bb > 0 else -1
        cuboid(car_steel, P, -0.02, 0.02, bb - 0.02, bb + 0.02, zf, zf + ch)                  # the post between the panes
        for a0, a1 in ((-ca + 0.03, -0.02), (0.02, ca - 0.03)):
            car_glass.quad(P(a0, bb, zf + 0.12), P(a1, bb, zf + 0.12), P(a1, bb, zf + ch - 0.02), P(a0, bb, zf + ch - 0.02))
        cuboid(car_steel, P, -ca, ca, bb - 0.015, bb + 0.015, zf, zf + 0.12)                  # the kick plate
        hb = bb - sb * 0.07                                                                    # the handrail, 70 mm off the glass
        car_steel.tube([P(-ca + 0.12, hb, zf + 0.95), P(ca - 0.12, hb, zf + 0.95)], 0.02, sides=8)
        for aa in (-ca + 0.18, ca - 0.18):
            car_steel.box(P(aa, hb, zf + 0.95), P(aa, bb, zf + 0.95), 0.025, 0.025)
    for sa in (-1, 1):
        aa = sa * ca
        for b0, b1 in ((cb0 + 0.03, d0 - 0.05), (d1 + 0.05, cb1 - 0.03)):
            car_glass.quad(P(aa, b0, zf + 0.12), P(aa, b1, zf + 0.12), P(aa, b1, zf + ch - 0.02), P(aa, b0, zf + ch - 0.02))
        for bj in (d0 - 0.05, d1 + 0.01):
            cuboid(car_steel, P, aa - 0.03, aa + 0.03, bj, bj + 0.04, zf, zf + ch)
        cuboid(car_steel, P, aa - 0.03, aa + 0.03, d0 - 0.05, d1 + 0.05, zf + 2.15, zf + ch)
        k = "car_door_ne" if sa > 0 else "car_door_sw"
        door_leaf(doors[k], door_frames[k], P, aa + sa * 0.05, d0, d1, zf, 2.13)
    # the car's operating panel on its back wall by the deck's door, its buttons lit
    cuboid(car_steel, P, ca - 0.3, ca - 0.1, cb0 + 0.02, cb0 + 0.045, zf + 0.85, zf + 1.45)
    for k in range(3):
        cuboid(buttons, P, ca - 0.23, ca - 0.17, cb0 + 0.045, cb0 + 0.055, zf + 1.0 + 0.12 * k, zf + 1.05 + 0.12 * k)
    return [frame, glass, steel, rail, head, plinth, car_steel, car_glass, car_floor, car_frame, car_light, buttons, cw, rope_car, rope_cw,
            *doors.values(), *door_frames.values()]


def sb_wall(bb, B):
    """Where a rail's bracket meets the shaft's side wall nearest it (b)."""
    return (B - 0.12) if bb > 0 else (-B + 0.12)


def door_leaf(glass, frame, P, a, d0, d1, zd, h):
    """A door leaf at a (across b from d0 to d1, h high from zd): glass in a slim stainless frame."""
    glass.quad(P(a, d0 + 0.04, zd + 0.04), P(a, d1 - 0.04, zd + 0.04), P(a, d1 - 0.04, zd + h - 0.04), P(a, d0 + 0.04, zd + h - 0.04))
    for b0, b1, z0, z1 in ((d0, d0 + 0.04, zd, zd + h), (d1 - 0.04, d1, zd, zd + h), (d0, d1, zd, zd + 0.04), (d0, d1, zd + h - 0.04, zd + h)):
        cuboid(frame, P, a - 0.02, a + 0.02, b0, b1, z0, z1)


def game_extras(scene):
    """The lift between the luge track and the deck (web/game/game.js rideLift; route.js walks through it),
    with its car: the meshes that ride with it (drawn at the deck), the counterweight's (drawn at the bottom),
    the ropes that stretch from the head, the doors that slide (along the shaft's width, out of the opening)."""
    from archkit import Terrain
    q, ax, out, z, g, foot, top = lift_frame(Terrain("queenstown"))
    face_out = [round(float(out[0]), 3), round(float(out[1]), 3)]
    face_sw = [round(float(-ax[0]), 3), round(float(-ax[1]), 3)]
    levels, z1 = lift_levels(g, z)
    cb = (LIFT_CAR["b0"] + LIFT_CAR["b1"]) / 2
    centre = q + out * cb
    d0, d1 = LIFT_DOOR
    car = {"meshes": ["skyline_lift_car_steel", "skyline_lift_car_glass", "skyline_lift_car_floor", "skyline_lift_car_frame", "skyline_lift_car_light",
                      "skyline_lift_car_door_ne", "skyline_lift_car_door_ne_frame", "skyline_lift_car_door_sw", "skyline_lift_car_door_sw_frame"],
           "counter": ["skyline_lift_cw"], "ropes": [["skyline_lift_rope_car", round(z1 - 0.1, 2), 1], ["skyline_lift_rope_cw", round(z1 - 0.1, 2), -1]],
           "drawn_at": 1, "centre": [round(float(centre[0]), 2), round(float(centre[1]), 2)], "axis": [round(float(ax[0]), 4), round(float(ax[1]), 4)],
           "slide": [round(float(-out[0] * (d1 - d0)), 3), round(float(-out[1] * (d1 - d0)), 3)],
           "doors": [{"stop": 1, "landing": ["skyline_lift_door_top", "skyline_lift_door_top_frame"], "car": ["skyline_lift_car_door_ne", "skyline_lift_car_door_ne_frame"]},
                     {"stop": 0, "landing": ["skyline_lift_door_foot", "skyline_lift_door_foot_frame"], "car": ["skyline_lift_car_door_sw", "skyline_lift_car_door_sw_frame"]}]}
    return {"lifts": [{"id": "skyline-lift", "name": "Skyline glass lift", "line": "SKYLINE GLASS LIFT · LUGE TRACK → DECK", "m_per_min": LIFT["m_per_min"],
                       "car": car,
                       "stops": [{"name": "The luge track", "at": foot, "face": face_sw, "floor": round(float(g), 2)},
                                 {"name": "The Skyline deck", "at": top, "face": face_out, "floor": round(float(z), 2)}]}]}


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
