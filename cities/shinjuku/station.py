"""Shinjuku Station's faces and the towers that frame it, at street level, as they stand in autumn 2026.

cities/shinjuku/kabukicho.py draws Kabukicho and the east exit's plaza; this module adds, in the
Shinjuku map only (see docs/cities/shinjuku.md for every source and its licence):

  * The west exit's construction site. The Odakyu department store's main building (Junzo Sakakura,
    1967) closed on 2 October 2022 and was pulled down; the Shinjuku West Exit District Development
    (Odakyu Electric Railway, Tokyo Metro, Tokyu Land; built by Taisei) began its new building on
    25 March 2024: 48 storeys and five basements, 258.15 m, due at the end of March 2030 (fiscal 2029).
    PLATEAU surveyed the old building standing; those solids are left out (landmark_demolished) and the
    site is drawn as photographs of 17 October 2026 show it (BLUE STYLE COM's site report): the new
    building's steel is still below the plaza, so nothing stands on the site's own deck but the site
    office and floodlights; along its plaza side a steel work deck (乗入れ構台) one storey up, on H-piles,
    with a fascia of grey panels and a white mesh fence, reaches out into the roundabout, and a ramp in
    white panels climbs to it from the plaza's north end; on the deck's south half stand two red and white
    crawler cranes with luffing jibs, and at the site's north end a yellow all-terrain crane. No tower
    crane has gone up. The white hoarding runs along the plaza and the lane, the project's board on its
    face to the plaza. The site's outline is OpenStreetMap's construction area joined to the old
    building's PLATEAU footprint; the deck's, the ramp's and the cranes' places are read from the
    photographs against GSI's aerial photograph (about +-5 m).
  * Tokyu Kabukicho Tower (2023, 225 m, 48 storeys; Kume Sekkei and Tokyu Sekkei, the facade by Yuko
    Nagayama & Associates): on its mapped outline, glass between thin mullions, and over it a second
    skin of white frit printed as rising jets of water, the fountain the facade was drawn as (a nod to
    the fountain of the Koma Theatre's plaza); the crown's fins, lit after dark; on Cine City Plaza
    its entrances under a canopy, the lobby lit, and its name.
  * Shinjuku Station's east exit: LUMINE EST's front to the East Square (the station building of
    1964, LUMINE EST since 2006), its name, and the station's sign over the doors; in the square,
    renewed in July 2020, Tomokazu Matsuyama's Hanao-san (花尾), a bouquet in mirror-polished
    stainless steel, 7 m tall and 8 m on its base.
  * The west exit's ramps (Sakakura, 1966): the two oval loops that took the cars down to the
    underground plaza closed on 15 January 2025 and are being taken out with the plaza's rebuilding;
    photographs of May and October 2026 show their openings decked flat in asphalt behind the road
    works' barriers. They are drawn so: the loops' line kept as a ring of red and white water-filled
    barriers and orange mesh panels round a flat deck at the plaza's level, over the hollow the terrain
    model keeps there. North of them stands the underground plaza's ventilation tower, an open drum
    faced in mottled brown tiles (the ivy that covered it is gone), on GSI's aerial photograph.

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
    # the west exit's site: white steel hoarding, the cabins' white and navy, fresh concrete, the site's deck,
    # the floodlights' masts
    "st_hoard": {"color": "#efeeea", "roughness": 0.65, "metalness": 0.15, "pattern": "granite", "joints_m": [0.5, 0.0]},
    "st_cabin": {"color": "#e9eaec", "roughness": 0.6, "metalness": 0.2, "pattern": "granite", "joints_m": [2.3, 2.7]},
    "st_navy": {"color": "#1f3566", "roughness": 0.55, "metalness": 0.2},
    "st_window": {"color": "#40505e", "roughness": 0.2, "metalness": 0.3, "emissive": "#ffe2b0", "glow": 1.1},
    "st_deck": {"color": "#7d7b76", "roughness": 0.9, "metalness": 0.0},
    "st_mast": {"color": "#e4e4e0", "roughness": 0.5, "metalness": 0.4},
    "st_lamp": {"color": "#f4f4ee", "roughness": 0.3, "metalness": 0.0, "emissive": "#fff4dc", "glow": 3.0},
    "st_aviation": {"color": "#d01010", "roughness": 0.4, "metalness": 0.0, "emissive": "#ff2a1a", "glow": 3.0},
    # the work deck: grey fascia panels, its steel (H-piles and girders, grey primer), the deck's checker plate;
    # the crawlers' red and white, the all-terrain crane's yellow, the tyres and tracks; the road works' barriers
    "st_fascia": {"color": "#a7a8a5", "roughness": 0.7, "metalness": 0.2, "pattern": "granite", "joints_m": [1.8, 0.0]},
    "st_girder": {"color": "#5d605f", "roughness": 0.6, "metalness": 0.45},
    "st_plate": {"color": "#6d6c68", "roughness": 0.85, "metalness": 0.2},
    "st_red": {"color": "#c8361f", "roughness": 0.5, "metalness": 0.3},
    "st_white": {"color": "#ecebe6", "roughness": 0.5, "metalness": 0.25},
    "st_yellow": {"color": "#e3b51e", "roughness": 0.45, "metalness": 0.3},
    "st_track": {"color": "#26272a", "roughness": 0.8, "metalness": 0.3},
    "st_barrier_r": {"color": "#d0402a", "roughness": 0.6, "metalness": 0.0},
    "st_barrier_w": {"color": "#efefea", "roughness": 0.6, "metalness": 0.0},
    "st_mesh_o": {"color": "#e8742a", "roughness": 0.8, "metalness": 0.0, "pattern": "lattice"},
    "st_asphalt": {"color": "#5b5c5d", "roughness": 0.95, "metalness": 0.0},
    # the ventilation drum: tiles in mottled browns and ochres, its concrete inner face and plinth
    "st_brick": {"color": "#8c6b52", "roughness": 0.85, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.11, "block_m": 0.24},
    "st_conc": {"color": "#9d9a93", "roughness": 0.9, "metalness": 0.0},
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
    # LUMINE EST's front: horizontal louvres of grey-brown aluminium over dark glass (photographs, 2013-23)
    "st_lumine": {"color": "#3c434a", "roughness": 0.2, "metalness": 0.35, "pattern": "curtain_wall", "bay_m": 7.2, "storey_m": 4.4,
                  "spandrel": 0.2, "mullion_m": 0.12, "frame": "#55595c", "lit_share": 0.7, "lit_k": 0.9, "warm_share": 0.85},
    "st_louvre": {"color": "#8d877d", "roughness": 0.45, "metalness": 0.55},
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
TOWER = {"deck_m": 1.2}          # the site's own deck over the excavation, at the plaza's level
# the work deck along the site's plaza side, one storey up (the photographs: the plaza's buses pass under its edge)
WORK_DECK = {"ring": [(230.0, 2492.0), (262.0, 2492.0), (268.0, 2602.0), (236.0, 2602.0)], "up_m": 7.0, "fascia_m": 1.6,
             "pile_every": 8.0, "fence_m": 1.8}
# the ramp up to it from the plaza's north end: from (x, y) at the plaza to (x, y) at the deck, its width
WORK_RAMP = {"from": (247.0, 2660.0), "to": (247.0, 2602.0), "w": 7.5, "wall_m": 2.6}
# crawler cranes on the work deck: lattice boom, a luffing jib at its head (deg from the horizontal), facing
CRAWLERS = [{"at": (247.0, 2560.0), "face_deg": 70.0, "boom_m": 46.0, "boom_deg": 62.0, "jib_m": 26.0, "jib_deg": 15.0},
            {"at": (250.0, 2508.0), "face_deg": 95.0, "boom_m": 54.0, "boom_deg": 80.0, "jib_m": 22.0, "jib_deg": 40.0}]
# the all-terrain crane at the site's north end, on the site's deck: its telescopic boom
MOBILE = {"at": (283.0, 2628.0), "face_deg": 200.0, "boom_m": 44.0, "boom_deg": 72.0}
PLAZA = {"z": 0.0}              # the plaza's level round the loops (deck_over_hollow sets it)
PLAZA_R = 42.0                  # m from the loops' middle: the ring whose ground gives the plaza's level
PLAZA_PCT = 20                  # its lower ground (the ring crosses kerbs and raised islands)
HOLLOW_M = 0.5                  # m: ground lower than the plaza by this is the openings' hollow, decked over
VENT = {"at": (172.0, 2616.0), "r": 8.3, "h": 7.4, "wall_m": 0.45}   # the underground plaza's ventilation drum
OFFICE = {"at": (277.0, 2633.0), "axis_deg": 97.0, "w": 12.2, "d": 2.5, "storeys": 3}

FRIT_BURST = 0.3                # how far up the tower the frit's jets break into spray (photographs)
KT_OSM = "w852000385"           # Tokyu Kabukicho Tower
KT = {"floors_m": 200.0, "crown_m": 225.0, "frit_off": 0.35, "fin_every": 1.6, "lobby_m": 8.5, "canopy_m": 6.2}
CINE_CITY = (434.0, 3020.0)     # Cine City Plaza (OSM way 684924350), the tower's front

LUMINE = "r16502754"
LUMINE_FRONT = ((441.1, 2467.2), (431.4, 2550.9))   # its face to the East Square (the outline's east edge)
LUMINE_LOUVRE_M = 0.6          # m between the front's louvres
HANAO = {"at": (453.3, 2500.5), "plinth_r": 2.0, "plinth_m": 1.0, "h": 7.0, "bench_r": (3.3, 4.3), "bench_m": 0.45}
# the round bench about it: OSM maps it as a 1 m "building" (relation 16263947, bench=yes) and PLATEAU stands it
# and the square's planters at 2.4-2.8 m, so they read as huts; they are drawn here as the bench instead
HANAO_HIDE = ("r16263947",)
HANAO_HIDE_P = ((454.0, 2500.0), (453.0, 2510.0))   # PLATEAU-only solids (no OSM id) of the same, by centroid

RAMPS = [{"c": (192.0, 2529.0), "a": 22.0, "b": 10.5}, {"c": (192.5, 2508.0), "a": 21.5, "b": 9.5}]   # the loops: centre, half length, half width
RAMP_OPEN_DEG = 55.0            # each loop's parapet was open this far either side of east, where its road came up


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
    z0 = g0 + TOWER["deck_m"]
    # the work deck one storey up along the plaza side, and the ramp up to it
    deck = work_deck(K, D, g0)
    # the cranes, the office, the floodlights
    for c in CRAWLERS:
        crawler(K, np.asarray(c["at"]), deck, c)
    mobile_crane(K, np.asarray(MOBILE["at"]), z0, MOBILE)
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
            "deck_z": round(float(deck), 2), "cranes": [list(c["at"]) for c in CRAWLERS] + [list(MOBILE["at"])]}


def work_deck(K, D, g0):
    """The steel work deck along the site's plaza side: a checker-plate top on girders, H-piles in a grid under
    it, a fascia of grey panels round its edge with a white mesh fence over it; and the ramp up to it from the
    plaza's north end, walled in white panels. Returns the deck's top."""
    ring = ccw(WORK_DECK["ring"])
    z = g0 + WORK_DECK["up_m"]
    fz = WORK_DECK["fascia_m"]
    poly = Polygon(ring)
    ak.cap(K["st_plate"], ak.WORLD, ring, z)
    ak.cap(K["st_girder"], ak.WORLD, ring, z - fz, down=True)
    for a, b in zip(ring, ring[1:] + ring[:1]):
        a, b = np.asarray(a), np.asarray(b)
        L = float(np.linalg.norm(b - a))
        f = (b - a) / L
        n = np.array([f[1], -f[0]])                     # out of a ccw ring
        pa, pb = a + n * 0.05, b + n * 0.05
        K["st_fascia"].quad(np.array([*pa, z - fz]), np.array([*pb, z - fz]), np.array([*pb, z + 0.15]), np.array([*pa, z + 0.15]),
                            [[0, 0], [L, 0], [L, fz + 0.15], [0, fz + 0.15]])
        fh = WORK_DECK["fence_m"]
        K["st_rail"].tube([np.array([*a, z + fh]), np.array([*b, z + fh])], 0.04, 4)
        K["st_barrier_w"].quad(np.array([*a, z + 0.15]), np.array([*b, z + 0.15]), np.array([*b, z + fh]), np.array([*a, z + fh]))
        K["st_barrier_w"].quad(np.array([*b, z + 0.15]), np.array([*a, z + 0.15]), np.array([*a, z + fh]), np.array([*b, z + fh]))
    # piles and the girders between them, every pile_every both ways, clear of the ramp's foot
    x0, y0, x1, y1 = poly.bounds
    e = WORK_DECK["pile_every"]
    for x in np.arange(x0 + 2.0, x1, e):
        for y in np.arange(y0 + 2.0, y1, e):
            if not poly.buffer(-1.0).contains(Point(x, y)):
                continue
            g = D.ground(x, y)
            box(K["st_girder"], frame((x, y), (1, 0)), -0.2, 0.2, -0.2, 0.2, g, z - fz)
            box(K["st_girder"], frame((x, y), (1, 0)), -0.03, 0.03, -0.2, 0.2, g + 1.2, z - fz - 0.4)
    # the ramp: a sloping deck between white panel walls
    f0, f1 = np.asarray(WORK_RAMP["from"], float), np.asarray(WORK_RAMP["to"], float)
    ax = unit(f1 - f0)
    side = np.array([-ax[1], ax[0]])
    w = WORK_RAMP["w"] / 2
    za, zb = D.ground(*f0), z
    L = float(np.linalg.norm(f1 - f0))
    for s0, s1 in ((-w, w),):
        A0, A1, B0, B1 = f0 + side * s0, f0 + side * s1, f1 + side * s0, f1 + side * s1
        K["st_plate"].quad(np.array([*A1, za + 0.05]), np.array([*A0, za + 0.05]), np.array([*B0, zb]), np.array([*B1, zb]))
        K["st_girder"].quad(np.array([*A0, za]), np.array([*A1, za]), np.array([*B1, zb - 1.0]), np.array([*B0, zb - 1.0]))
    hw = WORK_RAMP["wall_m"]
    for s0 in (-w, w):
        A, B = f0 + side * s0, f1 + side * s0
        for o in (0.0, 0.12):
            pa, pb = A + side * np.sign(s0) * o, B + side * np.sign(s0) * o
            qa, qb = (pa, pb) if (s0 > 0) == (o > 0) else (pb, pa)
            zqa, zqb = (za, zb) if qa is pa else (zb, za)
            K["st_hoard"].quad(np.array([*qa, zqa]), np.array([*qb, zqb]), np.array([*qb, zqb + hw]), np.array([*qa, zqa + hw]),
                               [[0, zqa], [L, zqb], [L, zqb + hw], [0, zqa + hw]])
        # the ramp's side under the slope, down to the plaza
        K["st_fascia"].quad(np.array([*A, za]), np.array([*B, D.ground(*B)]), np.array([*B, zb]), np.array([*A, za]))
    for t in np.arange(8.0, L - 2.0, 8.0):   # trestles under it
        c = f0 + ax * t
        zt = za + (zb - za) * t / L
        for s0 in (-w + 0.5, w - 0.5):
            q = c + side * s0
            box(K["st_girder"], frame(q, ax), -0.18, 0.18, -0.18, 0.18, D.ground(*q), zt - 0.6)
    return z


def crawler(K, c, z, spec):
    """A lattice-boom crawler crane: two tracks, the carbody and the red and white house with its cab and
    counterweight, the boom raised at its angle with a luffing jib at its head, the gantry and its pendants,
    the hook block, and red lights at the tips."""
    a = math.radians(spec["face_deg"])
    f = np.array([math.cos(a), math.sin(a)])
    P = frame(c, f)
    for v in (-2.6, 2.6):                                                           # the tracks
        box(K["st_track"], P, -3.8, 3.8, v - 0.5, v + 0.5, z, z + 1.1)
    box(K["st_girder"], P, -1.6, 1.6, -2.1, 2.1, z + 0.5, z + 1.4)                     # the carbody
    box(K["st_white"], P, -4.2, 1.6, -1.6, 1.6, z + 1.4, z + 3.4)                      # the house
    box(K["st_red"], P, -4.2, 1.6, -1.65, 1.65, z + 1.4, z + 1.8)
    box(K["st_red"], P, -5.6, -3.4, -1.7, 1.7, z + 1.4, z + 3.6)                       # the counterweight
    box(K["st_white"], P, 0.4, 2.2, 1.7, 2.9, z + 1.5, z + 3.6)                        # the cab
    K["st_window"].quad(P(2.22, 1.8, z + 2.4), P(2.22, 2.8, z + 2.4), P(2.22, 2.8, z + 3.4), P(2.22, 1.8, z + 3.4))
    peak = P(-2.0, 0, z + 7.5)                                                        # the gantry
    for v in (-1.2, 1.2):
        K["st_red"].tube([P(-3.6, v, z + 3.4), peak], 0.1, 4)
        K["st_red"].tube([P(0.0, v, z + 3.4), peak], 0.1, 4)
    lu = math.radians(spec["boom_deg"])
    foot = P(1.4, 0, z + 2.4)
    up = np.array([*(f * math.cos(lu)), math.sin(lu)])
    tip = foot + up * spec["boom_m"]
    jl = math.radians(spec["jib_deg"])
    jtip = tip + np.array([*(f * math.cos(jl)), math.sin(jl)]) * spec["jib_m"]
    lattice(K, foot, tip, f, 1.2, 0.5, int(spec["boom_m"] / 2.2))
    lattice(K, tip, jtip, f, 0.7, 0.35, int(spec["jib_m"] / 2.0))
    strut = tip + np.array([0, 0, 1.0]) * 5.0 - up * 1.0                              # the jib's strut and its ties
    K["st_red"].tube([tip, strut], 0.12, 4)
    K["st_frame"].tube([strut, jtip], 0.03, 3)
    K["st_frame"].tube([strut, peak], 0.03, 3)
    K["st_frame"].tube([peak, P(-5.4, 0, z + 3.6)], 0.035, 3)
    hook = jtip.copy()
    hook[2] = max(z + 6.0, jtip[2] - 0.55 * (jtip[2] - z))
    K["st_frame"].tube([jtip, hook], 0.03, 3)
    box(K["st_yellow"], frame(hook[:2], f), -0.4, 0.4, -0.3, 0.3, hook[2] - 1.0, hook[2])
    for q in (tip, jtip):
        box(K["st_aviation"], frame(q[:2], f), -0.25, 0.25, -0.25, 0.25, q[2], q[2] + 0.5)


def lattice(K, a, b, f, w, w_tip, n):
    """A boom from a to b in alternating red and white sections: four chords tapering from w wide to w_tip,
    laced with diagonals."""
    side = np.array([-f[1], f[0], 0.0])
    d = unit(b - a)
    up = np.cross(side, d)
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for k in range(n):
        s0, s1 = k / n, (k + 1) / n
        p0, p1 = a + (b - a) * s0, a + (b - a) * s1
        h0, h1 = (w + (w_tip - w) * s0) / 2, (w + (w_tip - w) * s1) / 2
        M = K["st_red"] if (k // 2) % 2 == 0 else K["st_white"]
        c0 = [p0 + side * sx * h0 + up * sy * h0 for sx, sy in corners]
        c1 = [p1 + side * sx * h1 + up * sy * h1 for sx, sy in corners]
        for q in range(4):
            M.tube([c0[q], c1[q]], 0.07, 4)
            M.tube([c0[q], c1[(q + 1) % 4]], 0.035, 3)


def mobile_crane(K, c, z, spec):
    """An all-terrain crane: the yellow carrier on its tyres, outriggers down, the cab, the slewing
    superstructure and its counterweight, and the telescopic boom out at its angle."""
    a = math.radians(spec["face_deg"])
    f = np.array([math.cos(a), math.sin(a)])
    P = frame(c, f)
    box(K["st_yellow"], P, -6.5, 6.5, -1.3, 1.3, z + 1.0, z + 2.0)                     # the carrier
    for u in (-5.0, -3.4, 2.2, 3.8, 5.4):                                             # its tyres
        for v in (-1.35, 1.05):
            box(K["st_track"], P, u - 0.6, u + 0.6, v, v + 0.3, z, z + 1.25)
    for u in (-5.8, 5.8):                                                             # the outriggers
        for v in (-1, 1):
            box(K["st_yellow"], P, u - 0.25, u + 0.25, v * 1.3, v * 3.6, z + 1.1, z + 1.5)
            box(K["st_girder"], P, u - 0.4, u + 0.4, v * 3.6 - 0.4, v * 3.6 + 0.4, z, z + 1.3)
    box(K["st_yellow"], P, 4.6, 6.6, -1.3, 0.2, z + 2.0, z + 3.6)                      # the driving cab
    box(K["st_yellow"], P, -4.0, 1.0, -1.2, 1.2, z + 2.0, z + 3.4)                      # the superstructure
    box(K["st_girder"], P, -5.2, -3.6, -1.3, 1.3, z + 2.2, z + 3.6)                     # the counterweight
    box(K["st_white"], P, -0.8, 1.2, 1.2, 2.2, z + 2.0, z + 3.9)                       # the crane cab
    lu = math.radians(spec["boom_deg"])
    up = np.array([*(f * math.cos(lu)), math.sin(lu)])
    foot = P(-2.5, 0, z + 3.4)
    L = spec["boom_m"]
    k = 5                                                                             # telescopic sections, each narrower
    for i in range(k):
        s0, s1 = i / k * L * 0.98, (i + 1) / k * L
        w = 1.3 - i * 0.16
        K["st_yellow"].box(foot + up * s0, foot + up * s1, w, w * 1.15)
    tip = foot + up * L
    hook = tip.copy()
    hook[2] = z + L * 0.35
    K["st_frame"].tube([tip, hook], 0.03, 3)
    box(K["st_yellow"], frame(hook[:2], f), -0.35, 0.35, -0.3, 0.3, hook[2] - 0.9, hook[2])
    box(K["st_aviation"], frame(tip[:2], f), -0.25, 0.25, -0.25, 0.25, tip[2], tip[2] + 0.5)


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
    """The frit skin's picture: rising jets of water in white dots and strokes on clear glass (its clear pixels are
    holes), breaking into spray a third of the way up the tower (FRIT_BURST), thin lines running on above, as
    photographs of 2023-24 show the white strands dense over the lower tower and the glass clear above."""
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
            burst = math.exp(-((s - FRIT_BURST) / 0.09) ** 2)   # where the jets break, a third of the way up
            spread = 5 + 80 * burst + 10 * s                  # a stream that bursts into spray, then thins out above
            xx = x0 + lean * (H - yy) * 0.08 + rng.normal(0, spread)
            r = (1.5 + 4.5 * (1 - s)) * (0.35 if s > FRIT_BURST + 0.15 else 1.0) + rng.random() * 2.0
            if burst > 0.3 and rng.random() < 0.5:            # the spray: drops thrown out and falling
                xx += rng.normal(0, 70 * burst)
                r *= 0.7
            if s > FRIT_BURST + 0.15 and rng.random() < 0.6:  # above it only a fine line runs on up
                continue
            d.ellipse([xx - r, yy - r * 2.2, xx + r, yy + r * 2.2], fill=(250, 252, 255, 255))
        d.line([(x0, H), (x0 + lean * H * 0.06, H * 0.02)], fill=(250, 252, 255, 255), width=4)
    for _ in range(5000):                                 # fine mist about the burst
        xx, yy = rng.random() * W, H * (1 - FRIT_BURST) + rng.normal(0, H * 0.07)
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
    # dark glass behind horizontal louvres on the upper floors, a glazed and lit street floor, the canopy over the doors
    o = n * 0.12
    K["st_lumine"].quad(np.array([*(a + o), g + 6.0]), np.array([*(b + o), g + 6.0]), np.array([*(b + o), g + top - 0.5]), np.array([*(a + o), g + top - 0.5]),
                        [[0, 6.0], [L, 6.0], [L, top - 0.5], [0, top - 0.5]])
    for z in np.arange(g + 6.3, g + top - 0.6, LUMINE_LOUVRE_M):   # the louvres, each a blade tilted a little down
        K["st_louvre"].quad(np.array([*(a + n * 0.25), z]), np.array([*(b + n * 0.25), z]), np.array([*(b + n * 0.75), z - 0.12]), np.array([*(a + n * 0.75), z - 0.12]))
        K["st_louvre"].quad(np.array([*(a + n * 0.75), z - 0.15]), np.array([*(b + n * 0.75), z - 0.15]), np.array([*(b + n * 0.25), z - 0.03]), np.array([*(a + n * 0.25), z - 0.03]))
    K["st_lobby"].quad(np.array([*(a + o * 0.5), g]), np.array([*(b + o * 0.5), g]), np.array([*(b + o * 0.5), g + 5.6]), np.array([*(a + o * 0.5), g + 5.6]))
    c0 = m - f * 14.0
    c1 = m + f * 14.0
    cz = g + 4.4
    K["st_kt_canopy"].quad(np.array([*(c0 + n * 3.5), cz]), np.array([*(c1 + n * 3.5), cz]), np.array([*c1, cz]), np.array([*c0, cz]))
    K["st_kt_canopy"].quad(np.array([*c0, cz + 0.35]), np.array([*c1, cz + 0.35]), np.array([*(c1 + n * 3.5), cz + 0.35]), np.array([*(c0 + n * 3.5), cz + 0.35]))
    K["st_kt_canopy"].quad(np.array([*(c0 + n * 3.5), cz]), np.array([*(c0 + n * 3.5), cz + 0.35]), np.array([*(c1 + n * 3.5), cz + 0.35]), np.array([*(c1 + n * 3.5), cz]))
    sign_quad(K, A, m, n, 18.0, g + top - 6.0, g + top - 2.2, "lumine_est", off=0.9)   # over the louvres
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
    r0, r1 = HANAO["bench_r"]
    bz = g + HANAO["bench_m"]
    K["st_plinth"].lathe([(g, r1), (bz, r1), (bz, r0), (g, r0)], tuple(c), 64)
    K["st_green"].lathe([(g + 0.05, r0 - 0.05), (g + 0.3, r0 - 0.1), (g + 0.3, pr + 0.1)], tuple(c), 48)
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
    """The loops as they stand closed: each opening decked flat at the plaza's level (the rim's ground), the old
    parapet's line kept as a ring of water-filled barriers, red and white by turns, with orange mesh panels on
    stands here and there and cones between; and the ventilation drum north of them."""
    out = []
    deck_over_hollow(K, D)
    for rp in RAMPS:
        c, a, b = rp["c"], rp["a"], rp["b"]
        outer = stadium(c, a, b, 64)
        rim = PLAZA["z"]
        s = 0.0
        for k, (p, q) in enumerate(zip(outer, outer[1:])):
            L = float(np.linalg.norm(q - p))
            if k % 9 in (3, 4):          # an orange mesh panel on its feet
                for t in (p, q):
                    K["st_frame"].tube([np.array([*t, rim]), np.array([*t, rim + 1.8])], 0.03, 3)
                K["st_mesh_o"].quad(np.array([*p, rim + 0.15]), np.array([*q, rim + 0.15]), np.array([*q, rim + 1.8]), np.array([*p, rim + 1.8]),
                                    [[0, 0], [L, 0], [L, 1.65], [0, 1.65]])
                K["st_mesh_o"].quad(np.array([*q, rim + 0.15]), np.array([*p, rim + 0.15]), np.array([*p, rim + 1.8]), np.array([*q, rim + 1.8]),
                                    [[0, 0], [L, 0], [L, 1.65], [0, 1.65]])
            else:                        # a barrier, 1.2 m long sections
                n = max(1, int(round(L / 1.2)))
                for j in range(n):
                    u0, u1 = p + (q - p) * j / n, p + (q - p) * (j + 0.94) / n
                    M = K["st_barrier_r"] if int((s + L * j / n) / 1.2) % 2 == 0 else K["st_barrier_w"]
                    d = unit(u1 - u0)
                    P = frame(u0, d)
                    box(M, P, 0.0, float(np.linalg.norm(u1 - u0)), -0.22, 0.22, rim, rim + 0.8)
            s += L
        for k in range(0, len(outer) - 1, 6):   # cones inside the ring
            p = outer[k] + unit(np.asarray(c) - outer[k]) * 1.2
            K["st_mesh_o"].lathe([(rim, 0.18), (rim + 0.7, 0.03)], (float(p[0]), float(p[1])), 8)
        out.append(list(c))
    vent(K, D)
    return out


def deck_over_hollow(K, D):
    """The loops' openings decked flat: the terrain model keeps the hollow the openings made (the photograph's
    ground), wider than the loops; the deck covers every cell of it lower than the plaza by HOLLOW_M, at the plaza's
    level (the lower ground, PLAZA_PCT, on a ring PLAZA_R out from the loops' middle)."""
    import shapely
    from shapely.geometry import box as sbox
    cx = float(np.mean([r["c"][0] for r in RAMPS]))
    cy = float(np.mean([r["c"][1] for r in RAMPS]))
    z = float(np.percentile([D.ground(cx + PLAZA_R * math.cos(t), cy + PLAZA_R * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 48, endpoint=False)], PLAZA_PCT))
    cells = []
    for x in np.arange(cx - 55.0, cx + 55.0, 2.0):
        for y in np.arange(cy - 45.0, cy + 45.0, 2.0):
            if D.ground(x + 1.0, y + 1.0) < z - HOLLOW_M:
                cells.append(sbox(x, y, x + 2.0, y + 2.0))
    PLAZA["z"] = z
    if not cells:
        return
    U = shapely.union_all(cells).buffer(1.5).buffer(-0.5).simplify(0.4)
    for poly in getattr(U, "geoms", [U]):
        if poly.area < 30:
            continue
        ak.cap(K["st_asphalt"], ak.WORLD, list(poly.exterior.coords)[:-1], z + 0.03)
        ring = list(poly.exterior.coords)
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):   # its edge down to the hollow, so no gap shows under it
            K["st_asphalt"].quad(np.array([x1, y1, z + 0.03]), np.array([x2, y2, z + 0.03]), np.array([x2, y2, z - 2.5]), np.array([x1, y1, z - 2.5]))
            K["st_asphalt"].quad(np.array([x2, y2, z + 0.03]), np.array([x1, y1, z + 0.03]), np.array([x1, y1, z - 2.5]), np.array([x2, y2, z - 2.5]))


def vent(K, D):
    """The underground plaza's ventilation drum: an open cylinder faced in tiles over a concrete plinth band,
    its concrete inner face, the rim's coping."""
    c = VENT["at"]
    r, h, t = VENT["r"], VENT["h"], VENT["wall_m"]
    g = min(D.ground(c[0] + r * math.cos(q), c[1] + r * math.sin(q)) for q in np.linspace(0, 2 * math.pi, 12, endpoint=False))
    K["st_conc"].lathe([(g - 0.5, r + 0.05), (g + 0.6, r + 0.05)], c, 64)
    K["st_brick"].lathe([(g + 0.6, r), (g + h - 0.25, r)], c, 64)
    K["st_conc"].lathe([(g + h - 0.25, r + 0.04), (g + h, r + 0.04), (g + h, r - t), (g + h - 0.25, r - t)], c, 64)
    K["st_conc"].lathe([(g + h - 0.25, r - t), (g + 0.2, r - t)], c, 64)   # inside, top to bottom: faces in
    K["st_asphalt"].lathe([(g + 0.2, r - t), (g + 0.2, 0.01)], c, 32)


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
        for sd in self.D.solids:
            cxy = Polygon(sd["ring"]).centroid
            if sd["osm"] in HANAO_HIDE or (not sd["osm"] and sd["top"] < 4 and any(math.hypot(cxy.x - a, cxy.y - b) < 2.5 for a, b in HANAO_HIDE_P)):
                hidden.append(sd["si"])
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
        h = self.info.get("hanao")
        if h:   # the square's lamps on the bouquet
            out.append([h["at"][0], h["at"][1], 9.0, "#fff4e0", 0.5])
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
