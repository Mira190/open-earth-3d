"""Shinjuku Station's faces and the towers that frame it, at street level, as they stand in autumn 2026.

cities/shinjuku/kabukicho.py draws Kabukicho and the east exit's plaza; this module adds, in the
Shinjuku map only (see docs/cities/shinjuku.md for every source and its licence):

  * The west exit's construction site. The Odakyu department store's main building (Junzo Sakakura,
    1967) closed on 2 October 2022 and was pulled down; the Shinjuku West Exit District Development
    (Odakyu Electric Railway, Tokyo Metro, Tokyu Land; built by Taisei) began its new building on
    25 March 2024: 48 storeys and five basements, 258.15 m, due at the end of March 2030 (fiscal 2029).
    PLATEAU surveyed the old building standing; those solids are left out (landmark_demolished) and the
    site is drawn as it is: white hoarding along the plaza and the lane, the project's board on its face
    to the plaza, the site office in stacked cabins, floodlights, two luffing-jib tower cranes, and the
    new building as far as it has risen: in January and July 2026 the work was still mostly below
    ground (reports from the site), so the drawing stops at the ground-floor deck, the concrete core
    two storeys up and the first tier of steel columns. The site's outline is OpenStreetMap's
    construction area joined to the old building's PLATEAU footprint; the cranes' and the office's
    places are illustrative.
  * Tokyu Kabukicho Tower (2023, 225 m, 48 storeys; Kume Sekkei and Tokyu Sekkei, the facade by Yuko
    Nagayama & Associates): on its mapped outline, glass between thin mullions, and over it a second
    skin of white frit printed as rising jets of water, the fountain the facade was drawn as (a nod to
    the fountain of the Koma Theatre's plaza); the crown's fins, lit after dark; on Cine City Plaza
    its entrances under a canopy, the lobby lit, and its name.
  * Shinjuku Station's east exit: LUMINE EST's front to the East Square (the station building of
    1964, LUMINE EST since 2006), its name, and the station's sign over the doors; in the square,
    renewed in July 2020, Tomokazu Matsuyama's Hanao-san (花尾), a bouquet in mirror-polished
    stainless steel, 7 m tall and 8 m on its base.
  * The west exit's ramps (Sakakura, 1966): the two oval loops that take the cars down to the
    underground plaza, their parapets and the planted islands in them, on the loops of GSI's aerial
    photograph.

Words are the buildings' own names, set in open fonts, not their logos. Local frame: x east, y north,
z up, metres.
"""
import math
import os

import numpy as np
from shapely.geometry import Point, Polygon

import adkit as ad
import archkit as ak
from japankit import Atlas

ATLAS_FILE = "station.jpg"
FRIT_FILE = "kabukicho_tower.png"

MATERIALS = {
    # the west exit's site: white steel hoarding, the cabins' white and navy, steel columns in their red
    # primer, the core's fresh concrete, the ground-floor deck, the cranes' white masts and red jibs
    "st_hoard": {"color": "#efeeea", "roughness": 0.65, "metalness": 0.15, "pattern": "granite", "joints_m": [0.5, 0.0]},
    "st_cabin": {"color": "#e9eaec", "roughness": 0.6, "metalness": 0.2, "pattern": "granite", "joints_m": [2.3, 2.7]},
    "st_navy": {"color": "#1f3566", "roughness": 0.55, "metalness": 0.2},
    "st_window": {"color": "#40505e", "roughness": 0.2, "metalness": 0.3, "emissive": "#ffe2b0", "glow": 1.1},
    "st_steel": {"color": "#8a3b2a", "roughness": 0.6, "metalness": 0.35},
    "st_core": {"color": "#a9a7a1", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [1.8, 0.9]},
    "st_deck": {"color": "#7d7b76", "roughness": 0.9, "metalness": 0.0},
    "st_mast": {"color": "#e4e4e0", "roughness": 0.5, "metalness": 0.4},
    "st_jib": {"color": "#c9302a", "roughness": 0.5, "metalness": 0.35},
    "st_net": {"color": "#4f6f9a", "roughness": 0.9, "metalness": 0.0, "pattern": "lattice"},
    "st_lamp": {"color": "#f4f4ee", "roughness": 0.3, "metalness": 0.0, "emissive": "#fff4dc", "glow": 3.0},
    "st_aviation": {"color": "#d01010", "roughness": 0.4, "metalness": 0.0, "emissive": "#ff2a1a", "glow": 3.0},
    # Tokyu Kabukicho Tower: blue-silver glass in a fine grid, the white frit over it, the crown's fins
    # lit cool white after dark, the canopy's steel and the lobby's light
    "st_kt_glass": {"color": "#7d93a8", "roughness": 0.12, "metalness": 0.45, "pattern": "curtain_wall", "bay_m": 1.5, "storey_m": 4.2,
                    "spandrel": 0.22, "mullion_m": 0.08, "frame": "#d6dade", "lit_share": 0.5, "lit_k": 0.85, "warm_share": 0.7},
    "st_kt_frit": {"color": "#f4f6f8", "roughness": 0.35, "metalness": 0.1, "map": FRIT_FILE, "cutout": True, "emissive": "#cfe4ff", "glow": 0.22},
    "st_kt_fin": {"color": "#e8ecf0", "roughness": 0.3, "metalness": 0.4, "emissive": "#bfe0ff", "glow": 2.6},
    "st_kt_canopy": {"color": "#d9dcdf", "roughness": 0.35, "metalness": 0.6},
    "st_lobby": {"color": "#55606a", "roughness": 0.15, "metalness": 0.3, "emissive": "#ffe6c0", "glow": 1.4},
    # the drawn signs (this module's atlas), lit from inside after dark
    "st_atlas": {"color": "#ffffff", "roughness": 0.55, "metalness": 0.0, "map": ATLAS_FILE, "emissive_map": True, "glow": 1.3},
    "st_frame": {"color": "#2a2c30", "roughness": 0.45, "metalness": 0.6},
    # LUMINE EST's front: pale panels in bands
    "st_lumine": {"color": "#6f7a84", "roughness": 0.25, "metalness": 0.3, "pattern": "curtain_wall", "bay_m": 2.4, "storey_m": 4.4,
                  "spandrel": 0.5, "mullion_m": 0.22, "frame": "#e2ded4", "lit_share": 0.7, "lit_k": 0.9, "warm_share": 0.85},
    # Hanao-san: mirror-polished stainless steel; its base's dark granite
    "st_chrome": {"color": "#e3e7ec", "roughness": 0.08, "metalness": 1.0},
    "st_plinth": {"color": "#3a3b3d", "roughness": 0.4, "metalness": 0.1, "pattern": "granite", "joints_m": [0.6, 0.4]},
    # the ramps' parapets (white concrete), their rails, the islands' planting
    "st_parapet": {"color": "#d6d3cb", "roughness": 0.8, "metalness": 0.0, "pattern": "granite", "joints_m": [3.0, 0.0]},
    "st_rail": {"color": "#b8bcc0", "roughness": 0.35, "metalness": 0.7},
    "st_green": {"color": "#3f5a32", "roughness": 0.95, "metalness": 0.0, "pattern": "granite", "joints_m": [0, 0]},
}
LIT = {"st_window", "st_lamp", "st_aviation", "st_kt_frit", "st_kt_fin", "st_lobby", "st_atlas"}

# ---------------------------------------------------------------- places (local frame, metres)

# the west exit's site: OSM's construction area (way 1214435033) joined to the old building's PLATEAU footprint
SITE = [(272.7, 2613.9), (268.6, 2645.3), (301.3, 2649.1), (305.3, 2615.3), (302.4, 2576.0), (298.6, 2483.3), (263.1, 2479.4),
        (258.7, 2496.9), (250.0, 2498.8)]
SITE_GONE_MIN_M = 20.0          # PLATEAU-only solids taller than this inside the site: the old building
TOWER = {"u": (55.0, 118.0), "v": (-19.0, 17.0), "core_u": (74.0, 98.0), "core_v": (-8.0, 7.0), "deck_m": 1.2,
         "core_m": 9.0, "steel_m": 13.5, "bay_m": 9.0}
CRANES = [{"at": (283.5, 2548.0), "mast_m": 34.0, "jib_m": 42.0, "luff_deg": 58.0, "slew_deg": 200.0},
          {"at": (285.0, 2592.0), "mast_m": 30.0, "jib_m": 38.0, "luff_deg": 64.0, "slew_deg": 110.0}]
OFFICE = {"at": (277.0, 2633.0), "axis_deg": 97.0, "w": 12.2, "d": 2.5, "storeys": 3}

KT_OSM = "w852000385"           # Tokyu Kabukicho Tower
KT = {"floors_m": 200.0, "crown_m": 225.0, "frit_off": 0.35, "fin_every": 1.6, "lobby_m": 8.5, "canopy_m": 6.2}
CINE_CITY = (434.0, 3020.0)     # Cine City Plaza (OSM way 684924350), the tower's front

LUMINE = "r16502754"
LUMINE_FRONT = ((441.1, 2467.2), (431.4, 2550.9))   # its face to the East Square (the outline's east edge)
HANAO = {"at": (453.3, 2500.5), "plinth_r": 2.0, "plinth_m": 1.0, "h": 7.0}

RAMPS = [{"c": (192.0, 2529.0), "a": 22.0, "b": 10.5}, {"c": (192.5, 2508.0), "a": 21.5, "b": 9.5}]   # the loops: centre, half length, half width
RAMP_OPEN_DEG = 55.0            # each loop's parapet is open this far either side of east, where its road comes up


# ---------------------------------------------------------------- helpers

def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) or 1.0)


def frame(o, f):
    """(u, v, z) -> local point: u along f from o, v to its left, z absolute."""
    o, f = np.asarray(o, float)[:2], unit(f)[:2]
    left = np.array([-f[1], f[0]])
    return lambda u, v, z: np.array([o[0] + f[0] * u + left[0] * v, o[1] + f[1] * u + left[1] * v, z])


def box(m, P, u0, u1, v0, v1, z0, z1):
    ak.block(m, P, u0, u1, v0, v1, z0, z1)


def ccw(ring):
    r = [tuple(map(float, p)) for p in ring]
    return r if Polygon(r).exterior.is_ccw else r[::-1]


def sign_quad(K, A, c, n, w, z0, z1, key, off=0.05):
    """An atlas picture w wide from z0 to z1 on a wall facing n, centred at c, read from the front."""
    n = unit(n)
    t = np.array([-n[1], n[0]])          # to the right of someone facing the wall is +t
    c = np.asarray(c, float)[:2] + n * off
    p0, p1 = c - t * w / 2, c + t * w / 2   # from the front: p0 on the left
    A.quad(K["st_atlas"], np.array([*p0, z0]), np.array([*p1, z0]), np.array([*p1, z1]), np.array([*p0, z1]), key)


# ---------------------------------------------------------------- the west exit's site

def site_solids(D):
    site = Polygon(SITE)
    import json
    B = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "web", "data", "shinjuku", "buildings.json")))
    out = []
    for s in D.solids:
        src = B["b"][B["s"][s["si"]][0]][5]
        if src == "P" and s["top"] > SITE_GONE_MIN_M and site.contains(Polygon(s["ring"]).centroid):
            out.append(s["si"])
    return out


def west_site(K, A, D):
    site = Polygon(SITE)
    ring = ccw(SITE)
    centre = np.array(site.centroid.coords[0])
    g0 = min(D.ground(*p) for p in ring)
    H = 3.6
    board = None
    for a, b in zip(ring, ring[1:] + ring[:1]):
        a, b = np.asarray(a), np.asarray(b)
        L = float(np.linalg.norm(b - a))
        f = (b - a) / L
        n = np.array([f[1], -f[0]])          # out of a ccw ring
        if a[0] > 296 and b[0] > 296:        # the east side stands against the tracks' fence
            continue
        for k in range(max(1, int(round(L / 2.0)))):
            p, q = a + f * (L * k / max(1, round(L / 2.0))), a + f * (L * (k + 1) / max(1, round(L / 2.0)))
            zp, zq = D.ground(*p), D.ground(*q)
            for s in (1, -1):
                pa, pb = (p, q) if s > 0 else (q, p)
                za, zb = (zp, zq) if s > 0 else (zq, zp)
                K["st_hoard"].quad(np.array([*pa, za]), np.array([*pb, zb]), np.array([*pb, zb + H]), np.array([*pa, za + H]),
                                   [[0, za], [L / round(L / 2.0), zb], [L / round(L / 2.0), zb + H], [0, za + H]])
        K["st_frame"].tube([np.array([*a, D.ground(*a) + H]), np.array([*b, D.ground(*b) + H])], 0.05, 4)
        to_plaza = float(np.dot(n, unit(np.array([200.0, 2560.0]) - (a + b) / 2)))
        if L > 20 and (board is None or to_plaza * L > board[3]):
            board = (a, b, n, to_plaza * L, L)
    if board:
        a, b, n, _, L = board
        f = unit(b - a)
        m = (a + b) / 2
        z = D.ground(*m)
        sign_quad(K, A, m - f * 9.0, n, 13.0, z + 0.5, z + 3.3, "west_board")
        sign_quad(K, A, m + f * 7.0, n, 9.0, z + 0.5, z + 3.3, "west_art")
        sign_quad(K, A, m + f * 18.0, n, 4.2, z + 0.8, z + 3.0, "west_notice")
    # the ground inside: a fresh concrete deck over the excavation
    ak.cap(K["st_deck"], ak.WORLD, ring, g0 + TOWER["deck_m"])
    # the new building, as far as it has risen: its core and the first tier of steel
    ax = unit(np.array(SITE[5]) - np.array(SITE[6]))     # along the site, from its south end
    side = np.array([-ax[1], ax[0]])
    south = np.array(SITE[6]) + side * 18.0
    P = frame(south, ax)
    z0 = g0 + TOWER["deck_m"]
    cu, cv = TOWER["core_u"], TOWER["core_v"]
    box(K["st_core"], P, cu[0], cu[1], cv[0], cv[1], z0, z0 + TOWER["core_m"])
    u0, u1 = TOWER["u"]
    v0, v1 = TOWER["v"]
    bay = TOWER["bay_m"]
    us = list(np.arange(u0, u1 + 0.1, bay))
    vs = list(np.linspace(v0, v1, 5))
    zt = z0 + TOWER["steel_m"]
    S = K["st_steel"]
    for u in us:
        for v in vs:
            if cu[0] - 1 < u < cu[1] + 1 and cv[0] - 1 < v < cv[1] + 1:
                continue
            box(S, P, u - 0.4, u + 0.4, v - 0.4, v + 0.4, z0, zt)
    for z in (z0 + 4.5, z0 + 9.0, zt):   # girders at each floor, both ways
        for u in us:
            box(S, P, u - 0.2, u + 0.2, v0, v1, z - 0.8, z)
        for v in vs:
            box(S, P, u0, u1, v - 0.2, v + 0.2, z - 0.8, z)
    # the safety net round the top tier
    for a, b in (((u0, v0), (u1, v0)), ((u1, v0), (u1, v1)), ((u1, v1), (u0, v1)), ((u0, v1), (u0, v0))):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        pa, pb = P(a[0], a[1], 0), P(b[0], b[1], 0)
        K["st_net"].quad(np.array([*pa[:2], zt - 4.5]), np.array([*pb[:2], zt - 4.5]), np.array([*pb[:2], zt + 1.2]), np.array([*pa[:2], zt + 1.2]),
                         [[0, 0], [L, 0], [L, 5.7], [0, 5.7]])
    # the cranes, the office, the floodlights
    for c in CRANES:
        crane(K, np.asarray(c["at"]), z0 if Point(*c["at"]).within(site) else D.ground(*c["at"]), c)
    office(K, A, D)
    lamps = []
    for k, p in enumerate(ring):
        if k % 2:
            continue
        q = np.asarray(p) + unit(centre - np.asarray(p)) * 2.5
        z = D.ground(*q)
        K["st_mast"].tube([np.array([*q, z]), np.array([*q, z + 14.0])], 0.12, 6)
        box(K["st_lamp"], frame(q, centre - q), -0.3, 0.3, -0.6, 0.6, z + 14.0, z + 14.7)
        lamps.append([round(float(q[0]), 1), round(float(q[1]), 1)])
    return {"at": [round(float(centre[0]), 1), round(float(centre[1]), 1)], "z": round(g0, 2), "lamps": lamps,
            "steel_top": round(float(zt), 2), "cranes": [list(c["at"]) for c in CRANES]}


def crane(K, c, z, spec):
    """A luffing-jib tower crane: a lattice mast, the slewing deck and cab, the counter-jib with its
    weights, the A-frame, the jib raised at its angle, its ties, the hook, and red lights on its tips."""
    top = z + spec["mast_m"]
    M, J = K["st_mast"], K["st_jib"]
    h = 1.0
    for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        M.tube([np.array([c[0] + dx * h, c[1] + dy * h, z]), np.array([c[0] + dx * h, c[1] + dy * h, top])], 0.1, 4)
    for k in range(int(spec["mast_m"] / 2.5)):
        z1, z2 = z + k * 2.5, z + (k + 1) * 2.5
        for (x1, y1), (x2, y2) in (((-h, -h), (h, -h)), ((h, -h), (h, h)), ((h, h), (-h, h)), ((-h, h), (-h, -h))):
            M.tube([np.array([c[0] + x1, c[1] + y1, z1]), np.array([c[0] + x2, c[1] + y2, z2])], 0.045, 3)
    a = math.radians(spec["slew_deg"])
    f = np.array([math.cos(a), math.sin(a)])
    P = frame(c, f)
    box(K["st_mast"], P, -2.2, 2.2, -1.8, 1.8, top, top + 1.2)                       # the slewing deck
    box(K["st_cabin"], P, 1.4, 3.6, 1.0, 3.0, top + 0.2, top + 2.6)   # the cab, on the jib's side
    box(K["st_jib"], P, -9.0, -2.0, -1.0, 1.0, top + 0.8, top + 1.6)                 # the counter-jib
    box(K["st_core"], P, -9.0, -6.5, -1.3, 1.3, top + 1.6, top + 4.2)                 # its weights
    peak = P(-1.0, 0, top + 9.0)
    for v in (-1.0, 1.0):                                                             # the A-frame
        J.tube([P(-1.8, v, top + 1.2), peak], 0.12, 4)
        J.tube([P(0.8, v, top + 1.2), peak], 0.12, 4)
    lu = math.radians(spec["luff_deg"])
    foot = P(1.5, 0, top + 1.5)
    tip = foot + np.array([*(f * math.cos(lu) * spec["jib_m"]), math.sin(lu) * spec["jib_m"]])
    for v in (-0.7, 0.7):                                                             # the jib: two chords and lacing
        o = np.array([-f[1] * v, f[0] * v, 0.0])
        J.tube([foot + o, tip + o * 0.4], 0.12, 4)
    lower = foot - np.array([0, 0, 1.0])
    J.tube([lower, tip - np.array([0, 0, 0.3])], 0.1, 4)
    n = 14
    for k in range(n):
        s0, s1 = k / n, (k + 1) / n
        a0 = foot + (tip - foot) * s0
        b1 = lower + (tip - np.array([0, 0, 0.3]) - lower) * s1
        J.tube([a0, b1], 0.04, 3)
    K["st_frame"].tube([peak, tip], 0.035, 3)                                         # the luffing ties
    K["st_frame"].tube([peak, P(-8.5, 0, top + 1.6)], 0.035, 3)
    hook = tip.copy()
    hook[2] = top - spec["mast_m"] * 0.45
    K["st_frame"].tube([tip, hook], 0.03, 3)
    box(K["st_jib"], frame(hook[:2], f), -0.35, 0.35, -0.35, 0.35, hook[2] - 0.9, hook[2])
    for q in (tip, peak, P(-9.0, 0, top + 1.6)):
        box(K["st_aviation"], frame(q[:2], f), -0.25, 0.25, -0.25, 0.25, q[2], q[2] + 0.5)


def office(K, A, D):
    """The site office: cabins stacked three high, an outside stair, the contractor's name band."""
    c = np.asarray(OFFICE["at"])
    a = math.radians(OFFICE["axis_deg"])
    f = np.array([math.cos(a), math.sin(a)])
    P = frame(c, f)
    z = D.ground(*c)
    w, d = OFFICE["w"] / 2, OFFICE["d"]
    for k in range(OFFICE["storeys"]):
        z0 = z + 0.3 + k * 2.75
        box(K["st_cabin"], P, -w, w, 0.0, d, z0, z0 + 2.6)
        box(K["st_navy"], P, -w, w, -0.02, d + 0.02, z0 + 2.35, z0 + 2.6)
        for j in range(5):
            u = -w + 1.2 + j * (2 * w - 2.4) / 4
            K["st_window"].quad(P(u + 0.8, -0.03, z0 + 0.9), P(u - 0.8, -0.03, z0 + 0.9), P(u - 0.8, -0.03, z0 + 2.0), P(u + 0.8, -0.03, z0 + 2.0))
    K["st_frame"].tube([P(w + 0.6, 0.4, z), P(w + 0.6, 0.4, z + 8.6)], 0.05, 4)
    for k in range(4):
        K["st_frame"].tube([P(w + 0.2, 0.4, z + k * 2.75), P(w + 1.2, d - 0.3, z + (k + 1) * 2.75)], 0.05, 3)
    t = np.array([-f[1], f[0]])
    sign_quad(K, A, c - t * 0.0 + f * 0.0, -t, 2 * w - 1.0, z + 0.3 + 2 * 2.75 + 2.35, z + 0.3 + 2 * 2.75 + 2.6, "office_band", off=0.06)


def draw_west(img, R):
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    x, y, w, h = R["west_board"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(244, 245, 246))
    d.rectangle([x, y, x + w - 1, y + int(h * 0.26)], fill=(18, 60, 130))
    ad.text(img, (x + w / 2, y + h * 0.13), "新宿駅西口地区開発計画", "zen", h * 0.15, fill="#ffffff", max_w=w - 40)
    ad.text(img, (x + w / 2, y + h * 0.38), "SHINJUKU WEST EXIT DISTRICT DEVELOPMENT", "bebas", h * 0.11, fill="#123c82", max_w=w - 40)
    ad.text(img, (x + w * 0.5, y + h * 0.56), "地上48階  地下5階  高さ 約260m", "zen", h * 0.09, fill="#2a3346", max_w=w - 40)
    ad.text(img, (x + w * 0.5, y + h * 0.71), "2029年度 竣工予定", "zen", h * 0.09, fill="#2a3346", max_w=w - 40)
    ad.text(img, (x + w * 0.5, y + h * 0.88), "小田急電鉄  ・  東京地下鉄  ・  東急不動産", "zen", h * 0.065, fill="#4a5468", max_w=w - 40)
    x, y, w, h = R["west_art"]   # the new tower at dusk, a drawing of our own
    for k in range(h):
        s = k / h
        c0, c1 = np.array([40, 70, 128]), np.array([246, 190, 132])
        d.line([(x, y + k), (x + w - 1, y + k)], fill=tuple(int(v) for v in c0 + (c1 - c0) * s))
    tx0, tx1 = x + w * 0.38, x + w * 0.62
    d.polygon([(tx0, y + h), (tx0 + w * 0.02, y + h * 0.1), (tx1 - w * 0.03, y + h * 0.06), (tx1, y + h)], fill=(196, 212, 228))
    for k in range(40):
        yy = y + h * 0.1 + k * h * 0.022
        d.line([(tx0 + 3, yy), (tx1 - 3, yy)], fill=(150, 172, 196), width=1)
    d.rectangle([x, y + h * 0.82, x + w, y + h], fill=(70, 76, 88))
    ad.text(img, (x + w * 0.2, y + h * 0.92), "NEW SHINJUKU", "bebas", h * 0.07, fill="#ffffff")
    x, y, w, h = R["west_notice"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(255, 255, 255))
    d.rectangle([x + 6, y + 6, x + w - 7, y + h - 7], outline=(20, 90, 50), width=6)
    ad.text(img, (x + w / 2, y + h * 0.18), "建築計画のお知らせ", "zen", h * 0.1, fill="#14502c", max_w=w - 30)
    rows = [("建築主", "小田急電鉄 他"), ("施工者", "大成建設"), ("着工", "2024年3月"), ("完了予定", "2030年3月")]
    for k, (a, b) in enumerate(rows):
        yy = y + h * (0.36 + 0.15 * k)
        ad.text(img, (x + w * 0.27, yy), a, "zen", h * 0.075, fill="#222222")
        ad.text(img, (x + w * 0.66, yy), b, "zen", h * 0.075, fill="#222222", max_w=w * 0.6)
    x, y, w, h = R["office_band"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(31, 53, 102))
    ad.text(img, (x + w / 2, y + h / 2 + 1), "大成建設  新宿駅西口地区開発計画作業所", "zen", h * 0.6, fill="#ffffff", max_w=w - 20)


# ---------------------------------------------------------------- Tokyu Kabukicho Tower

def kabukicho_tower(K, A, D):
    solids = [s for s in D.solids if s["osm"] == KT_OSM]
    if not solids:
        return [], None
    s = max(solids, key=lambda q: q["top"])
    ring = ccw(ak.simplify(s["ring"], 0.3))
    g = s["ground"]
    zf, zc = g + KT["floors_m"], g + KT["crown_m"]
    ak.prism(K["st_kt_glass"], ak.WORLD, ring, g, zf, top=False)
    ak.cap(K["st_frame"], ak.WORLD, ring, zf)
    # the frit skin: one picture up each face, a little out from the glass
    for a, b in zip(ring, ring[1:] + ring[:1]):
        a, b = np.asarray(a), np.asarray(b)
        L = float(np.linalg.norm(b - a))
        if L < 2.0:
            continue
        f = (b - a) / L
        n = np.array([f[1], -f[0]])
        o = n * KT["frit_off"]
        z0 = g + KT["lobby_m"] + 2.0
        u0 = 0.5 + 0.5 * math.sin(a[0] * 0.37 + a[1] * 0.11)   # each face a different stretch of the picture
        uw = min(1.0, L / 40.0) * 0.5
        K["st_kt_frit"].quad(np.array([*(a + o), z0]), np.array([*(b + o), z0]), np.array([*(b + o), zc - 1.0]), np.array([*(a + o), zc - 1.0]),
                             [[u0 * 0.5, 0.0], [u0 * 0.5 + uw, 0.0], [u0 * 0.5 + uw, 1.0], [u0 * 0.5, 1.0]])
        # the crown: fins standing up from the last floor, a little taller toward the corners
        nf = max(2, int(L / KT["fin_every"]))
        for k in range(nf + 1):
            t = k / nf
            p = a + f * L * t + n * 0.15
            hh = (zc - zf) * (0.8 + 0.2 * abs(2 * t - 1))
            box(K["st_kt_fin"], frame(p, n), -0.35, 0.35, -0.08, 0.08, zf - 3.0, zf + hh)
        K["st_kt_fin"].tube([np.array([*(a + n * 0.15), zf + 0.5]), np.array([*(b + n * 0.15), zf + 0.5])], 0.12, 4)
    inner = Polygon(ring).buffer(-3.0)
    if inner.geom_type == "Polygon" and not inner.is_empty:
        ak.prism(K["st_frame"], ak.WORLD, ccw(list(inner.exterior.coords)[:-1]), zf, zf + 6.0)
    # the front on Cine City Plaza: the edges that face it carry the lobby, the canopy and the name
    front = []
    for a, b in zip(ring, ring[1:] + ring[:1]):
        a, b = np.asarray(a), np.asarray(b)
        L = float(np.linalg.norm(b - a))
        f = (b - a) / L
        n = np.array([f[1], -f[0]])
        if L > 6 and np.dot(n, unit(np.asarray(CINE_CITY) - (a + b) / 2)) > 0.55:
            front.append((a, b, L, f, n))
    best = max(front, key=lambda e: e[2]) if front else None
    for a, b, L, f, n in front:
        o = n * 0.06
        K["st_lobby"].quad(np.array([*(a + o), g]), np.array([*(b + o), g]), np.array([*(b + o), g + KT["lobby_m"]]), np.array([*(a + o), g + KT["lobby_m"]]))
        P = frame(a, f)   # u along the front, v to its left (into the building is -n... v left of f is -n here)
        cz = g + KT["canopy_m"]
        K["st_kt_canopy"].quad(np.array([*(a + n * 4.5), cz]), np.array([*(b + n * 4.5), cz]), np.array([*b, cz]), np.array([*a, cz]))
        K["st_kt_canopy"].quad(np.array([*a, cz + 0.4]), np.array([*b, cz + 0.4]), np.array([*(b + n * 4.5), cz + 0.4]), np.array([*(a + n * 4.5), cz + 0.4]))
        K["st_kt_canopy"].quad(np.array([*(a + n * 4.5), cz]), np.array([*(a + n * 4.5), cz + 0.4]), np.array([*(b + n * 4.5), cz + 0.4]), np.array([*(b + n * 4.5), cz]))
        for k in range(int(L / 7.0) + 1):
            p = a + f * min(L - 0.5, 0.5 + k * 7.0) + n * 4.2
            K["st_kt_canopy"].tube([np.array([*p, g]), np.array([*p, cz])], 0.14, 8)
    if best:
        a, b, L, f, n = best
        m = (a + b) / 2
        sign_quad(K, A, m, n, min(L - 2.0, 22.0), g + KT["canopy_m"] + 0.9, g + KT["canopy_m"] + 2.3, "kt_name", off=0.1)
        sign_quad(K, A, m, n, 3.0, g + 16.0, g + 34.0, "kt_name_ja", off=KT["frit_off"] + 0.05)
    c = np.array(Polygon(ring).centroid.coords[0])
    return [x["si"] for x in solids], {"at": [round(float(c[0]), 1), round(float(c[1]), 1)], "z": round(g, 2), "top": round(zc, 1),
                                       "front": [round(float(v), 1) for v in ((best[0] + best[1]) / 2 if best else c)]}


def draw_frit(path):
    """The frit skin's picture: rising jets of water in white dots and strokes on clear glass (its
    clear pixels are holes), denser toward the top where the jets break into spray."""
    from PIL import Image, ImageDraw
    W, H = 1024, 4096
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(2023)
    jets = 9
    for j in range(jets):
        x0 = (j + 0.5) / jets * W + rng.normal(0, 12)
        lean = rng.normal(0, 0.12)
        for k in range(1400):
            s = (k / 1400) ** 0.85                       # up the jet
            yy = H * (1 - s)
            spread = 6 + 70 * s ** 2.2                   # a thin stream that opens into spray
            xx = x0 + lean * (H - yy) * 0.08 + rng.normal(0, spread)
            r = 1.5 + 4.5 * (1 - s) + rng.random() * 2.0
            if s > 0.75 and rng.random() < 0.5:          # the spray: drops thrown out and falling
                xx += rng.normal(0, 90 * (s - 0.7))
                r *= 0.7
            d.ellipse([xx - r, yy - r * 2.2, xx + r, yy + r * 2.2], fill=(250, 252, 255, 255))
        d.line([(x0, H), (x0 + lean * H * 0.06, H * 0.32)], fill=(250, 252, 255, 255), width=5)
    for _ in range(5000):                                 # fine mist over the top third
        xx, yy = rng.random() * W, (rng.random() ** 2.4) * H * 0.4
        r = 1.0 + rng.random() * 1.6
        d.ellipse([xx - r, yy - r, xx + r, yy + r], fill=(250, 252, 255, 255))
    img = img.resize((512, 2048), Image.LANCZOS)
    a = np.asarray(img).copy()
    a[..., 3] = np.where(a[..., 3] > 110, 255, 0)
    Image.fromarray(a, "RGBA").save(path, optimize=True)


def draw_kt(img, R):
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    x, y, w, h = R["kt_name"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(22, 24, 30))
    ad.text(img, (x + w / 2, y + h / 2 + 2), "TOKYU KABUKICHO TOWER", "bebas", h * 0.62, fill="#f2f4f8", max_w=w - 30, spacing=6)
    x, y, w, h = R["kt_name_ja"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(236, 240, 244))
    ad.vtext(img, (x + w / 2, y + 14), "東急歌舞伎町タワー", "zen", min(w * 0.7, (h - 28) / (9 * 1.06)), fill="#20242c")


# ---------------------------------------------------------------- the east exit: LUMINE EST and the East Square

def lumine(K, A, D):
    a, b = (np.asarray(p, float) for p in LUMINE_FRONT)
    L = float(np.linalg.norm(b - a))
    f = (b - a) / L
    n = np.array([f[1], -f[0]])
    if n[0] < 0:
        n = -n
    solids = [s for s in D.solids if s["osm"] == LUMINE]
    g = min(s["ground"] for s in solids) if solids else D.ground(*a)
    top = max(s["top"] for s in solids if Polygon(s["ring"]).area > 1000) if solids else 29.0
    m = (a + b) / 2
    # pale bands between the windows of the upper floors, a glazed and lit street floor, the canopy over the doors
    o = n * 0.12
    K["st_lumine"].quad(np.array([*(a + o), g + 6.0]), np.array([*(b + o), g + 6.0]), np.array([*(b + o), g + top - 0.5]), np.array([*(a + o), g + top - 0.5]),
                        [[0, 6.0], [L, 6.0], [L, top - 0.5], [0, top - 0.5]])
    K["st_lobby"].quad(np.array([*(a + o * 0.5), g]), np.array([*(b + o * 0.5), g]), np.array([*(b + o * 0.5), g + 5.6]), np.array([*(a + o * 0.5), g + 5.6]))
    c0 = m - f * 14.0
    c1 = m + f * 14.0
    cz = g + 4.4
    K["st_kt_canopy"].quad(np.array([*(c0 + n * 3.5), cz]), np.array([*(c1 + n * 3.5), cz]), np.array([*c1, cz]), np.array([*c0, cz]))
    K["st_kt_canopy"].quad(np.array([*c0, cz + 0.35]), np.array([*c1, cz + 0.35]), np.array([*(c1 + n * 3.5), cz + 0.35]), np.array([*(c0 + n * 3.5), cz + 0.35]))
    K["st_kt_canopy"].quad(np.array([*(c0 + n * 3.5), cz]), np.array([*(c0 + n * 3.5), cz + 0.35]), np.array([*(c1 + n * 3.5), cz + 0.35]), np.array([*(c1 + n * 3.5), cz]))
    sign_quad(K, A, m, n, 18.0, g + top - 6.0, g + top - 2.2, "lumine_est", off=0.2)
    sign_quad(K, A, m, n, 11.0, cz + 0.45, cz + 1.75, "jr_east", off=3.6)
    return {"front": [round(float(m[0]), 1), round(float(m[1]), 1)], "z": round(g, 2)}


def draw_lumine(img, R):
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    x, y, w, h = R["lumine_est"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(214, 212, 206))
    ad.text(img, (x + w / 2, y + h / 2 + 3), "LUMINE EST", "bebas", h * 0.7, fill="#1b1c20", max_w=w - 40, spacing=10)
    x, y, w, h = R["jr_east"]   # the station's sign: white on dark grey, the line colour's stripe
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(44, 47, 52))
    d.rectangle([x, y + h - 10, x + w - 1, y + h - 1], fill=(0, 155, 70))
    ad.text(img, (x + w * 0.36, y + h * 0.4), "新宿駅  東口", "zen", h * 0.42, fill="#ffffff", max_w=w * 0.6)
    ad.text(img, (x + w * 0.78, y + h * 0.3), "Shinjuku Sta.", "bebas", h * 0.24, fill="#e8eaee")
    ad.text(img, (x + w * 0.78, y + h * 0.62), "East Exit", "bebas", h * 0.24, fill="#e8eaee")


def hanao(K, D):
    """Hanao-san: a bouquet on a round base, the flowers' heads turned out on their stems, every surface a
    mirror. The flowers are drawn for the model (a bunch of open blooms), not the artist's figure."""
    c = np.asarray(HANAO["at"], float)
    g = D.ground(*c)
    pr, ph = HANAO["plinth_r"], HANAO["plinth_m"]
    K["st_plinth"].lathe([(g, pr), (g + ph, pr), (g + ph, 0.0)], tuple(c), 40)
    Ch = K["st_chrome"]
    z0 = g + ph
    Ch.lathe([(z0, 0.55), (z0 + 0.8, 0.7), (z0 + 1.8, 0.5), (z0 + 2.4, 0.42)], tuple(c), 24)   # the bunch's wrapped stems
    rng = np.random.default_rng(2020)
    blooms = [(0.0, 0.0, HANAO["h"] - 1.2, 1.15)]
    for k in range(9):
        a = k / 9 * 2 * math.pi + rng.normal(0, 0.15)
        rr = 1.1 + rng.random() * 0.9
        zz = 3.4 + rng.random() * 2.2
        blooms.append((math.cos(a) * rr, math.sin(a) * rr, zz, 0.7 + rng.random() * 0.35))
    for bx, by, bz, r in blooms:
        head = c + np.array([bx, by])
        hz = z0 + bz
        Ch.tube([np.array([*c, z0 + 2.2]), np.array([*(c + np.array([bx, by]) * 0.5), z0 + 2.2 + (bz - 2.2) * 0.6]), np.array([*head, hz - r * 0.5])], 0.09, 6)
        out = unit(np.array([bx, by, 1.2]))   # the face of the flower: turned out and up
        Ch.lathe([(hz - r * 0.4, 0.0), (hz - r * 0.3, r * 0.45), (hz, r * 0.62), (hz + r * 0.3, r * 0.45), (hz + r * 0.42, 0.0)], tuple(head), 18)
        side = unit(np.cross(out, [0, 0, 1.0])) if abs(out[2]) < 0.99 else np.array([1.0, 0, 0])
        up = np.cross(side, out)
        for j in range(8):   # the petals: flat leaves round the heart
            q = j / 8 * 2 * math.pi
            dvec = side * math.cos(q) + up * math.sin(q)
            base = np.array([*head, hz]) + dvec * r * 0.5
            tipp = np.array([*head, hz]) + dvec * r * 1.25 + out * r * 0.25
            wv = np.cross(dvec, out) * r * 0.32
            Ch.quad(base - wv * 0.5, base + wv * 0.5, tipp + wv, tipp - wv)
            Ch.quad(tipp - wv, tipp + wv, base + wv * 0.5, base - wv * 0.5)
    return {"at": [round(float(c[0]), 1), round(float(c[1]), 1)], "z": round(g, 2)}


# ---------------------------------------------------------------- the west exit's ramps

def stadium(c, a, b, n=48, a0=0.0, a1=2 * math.pi):
    """Points round an oval of half length a and half width b (ends round) from angle a0 to a1."""
    out = []
    for k in range(n + 1):
        t = a0 + (a1 - a0) * k / n
        x, y = math.cos(t), math.sin(t)
        r = 1.0 / max(1e-6, (abs(x) ** 3 + abs(y) ** 3) ** (1 / 3))   # a squarish oval, as the loops are
        out.append(np.array([c[0] + a * x * r * 0.92, c[1] + b * y * min(1.0, r * 0.92)]))
    return out


def ramps(K, D):
    for rp in RAMPS:
        c, a, b = rp["c"], rp["a"], rp["b"]
        o0 = math.radians(RAMP_OPEN_DEG)
        outer = stadium(c, a, b, 64, o0, 2 * math.pi - o0)
        inner = stadium(c, a - 7.0, max(2.0, b - 6.5), 48)
        for path, h in ((outer, 1.1), (inner, 0.75)):
            for p, q in zip(path, path[1:]):
                zp, zq = D.ground(*p), D.ground(*q)
                n = unit(np.array([q[1] - p[1], p[0] - q[0]]))
                for s in (0.0, 0.3):
                    pp, qq = p + n * s, q + n * s
                    K["st_parapet"].quad(np.array([*pp, zp]), np.array([*qq, zq]), np.array([*qq, zq + h]), np.array([*pp, zp + h]),
                                         [[0, 0], [float(np.linalg.norm(q - p)), 0], [float(np.linalg.norm(q - p)), h], [0, h]])
                K["st_parapet"].quad(np.array([*p, zp + h]), np.array([*q, zq + h]), np.array([*(q + n * 0.3), zq + h]), np.array([*(p + n * 0.3), zp + h]))
            K["st_rail"].tube([np.array([*(p + 0.0), D.ground(*p) + h + 0.35]) for p in path], 0.04, 4)
        isl = [tuple(p) for p in inner[:-1]]
        ak.cap(K["st_green"], ak.WORLD, isl, D.ground(*c) + 0.75)
    return [list(r["c"]) for r in RAMPS]


# ---------------------------------------------------------------- the build

class Build:
    """What this module adds to the Shinjuku map: meshes, solids drawn instead, solids pulled down."""

    def __init__(self, D):
        self.D = D
        items = [("west_board", 1024, 220), ("west_art", 640, 200), ("west_notice", 384, 200), ("office_band", 1024, 40),
                 ("kt_name", 1024, 64), ("kt_name_ja", 96, 576), ("lumine_est", 1024, 216), ("jr_east", 768, 96)]
        self.A = Atlas(items, width=2048)
        self.info, self.gone = {}, []

    def meshes(self):
        K = ak.Kit("station", floodlit=LIT, uv={k for k, m in MATERIALS.items() if "map" in m or "pattern" in m})
        self.gone = site_solids(self.D)
        self.info["west"] = west_site(K, self.A, self.D)
        hidden, self.info["tower"] = kabukicho_tower(K, self.A, self.D)
        self.info["lumine"] = lumine(K, self.A, self.D)
        self.info["hanao"] = hanao(K, self.D)
        self.info["ramps"] = ramps(K, self.D)
        return K.out(), hidden

    def draw(self, out_dir):
        from PIL import Image
        img = Image.new("RGB", (self.A.W, self.A.H), (30, 32, 36))
        draw_west(img, self.A.rects)
        draw_kt(img, self.A.rects)
        draw_lumine(img, self.A.rects)
        img.save(os.path.join(out_dir, ATLAS_FILE), quality=88)
        draw_frit(os.path.join(out_dir, FRIT_FILE))
        return [ATLAS_FILE, FRIT_FILE]

    def glows(self):
        out = []
        w = self.info.get("west")
        if w:
            out += [[x, y, 18.0, "#fff2d8", 0.35] for x, y in w["lamps"]]
        t = self.info.get("tower")
        if t:
            out.append([t["front"][0], t["front"][1], 22.0, "#ffe2b8", 0.45])
        lu = self.info.get("lumine")
        if lu:
            out.append([lu["front"][0], lu["front"][1], 20.0, "#fff0d8", 0.4])
        return out


def extras(info, spot, close_to, talk):
    """What this module adds to the game (city.py game_extras)."""
    spots, close, chatter = [], [], []
    w = info.get("west")
    if w:
        spots.append(spot("west_site", "The west exit's building site 新宿駅西口地区開発計画", np.array([214.0, 2585.0]), w["z"], "Watch the cranes", [
            "The Odakyu department store stood here from 1967, Junzo Sakakura's building over the station. It closed in October 2022 and came down.",
            "What goes up is 48 storeys and 258 metres, the tallest in Shinjuku, due in the spring of 2030. For now it is still mostly going down: five basements first."], 8.0))
        chatter.append(talk(np.array([222.0, 2590.0]), w["z"], [["Commuter", "Every morning a different way round the hoarding."], ["Friend", "Four more years of it."], ["Commuter", "I'll have moved by then."]], 14))
    t = info.get("tower")
    if t:
        f = np.asarray(t["front"])
        spots.append(spot("kabukicho_tower", "Tokyu Kabukicho Tower 東急歌舞伎町タワー", f + unit(np.asarray(CINE_CITY) - f) * 18.0, t["z"], "Look up the fountain", [
            "225 metres of hotel, theatre and cinema over Cine City Plaza, opened in April 2023. The white frit on the glass is drawn as a fountain's jets.",
            "The Koma Theatre's plaza had a fountain; the tower that replaced the Milano-za cinemas wears one."], 8.0))
    h = info.get("hanao")
    if h:
        c = np.asarray(h["at"])
        spots.append(spot("hanao", "Hanao-san 花尾, the East Square", c + np.array([-6.0, 3.0]), h["z"], "Look at the flowers", [
            "A bouquet seven metres tall in mirror-polished steel, put up when the East Square was rebuilt in July 2020. Tomokazu Matsuyama made it.",
            "Every face in the square is in it somewhere, bent round a petal."], 4.0))
    return spots, close, chatter
