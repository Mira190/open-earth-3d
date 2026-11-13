"""Kyoto: what the generic pipeline cannot know from open data.

Building adjustments (called by pipeline/build_scene.py):
  * Kyoto Tower Hotel: PLATEAU records the tower and the 9-storey building below it as one
    building 130.5 m high, so matching it to the hotel footprint would extrude the whole block
    to 131 m. The block is cut to its published base height and the tower is parametric.

Parametric landmarks (called by pipeline/landmarks.py):
  The temples and palaces, on their PLATEAU footprints (web/data/kyoto/buildings.json), which the
  renderers then leave out ("hidden" in landmarks.json; they stay in the surface model). Each hall has
  its stone platform, pillars and tie beams, white plaster, the bracket band, and a hipped-and-gabled
  (irimoya) roof with curved eaves: tiles at the temples and the castle, cypress bark at the palace.
  Higashi Honganji  the Founder's Hall (御影堂), 76 m by 58 m and 38 m high, among the largest wooden
                    buildings in the world, with its pent roof; the Amida Hall (阿弥陀堂), 29 m; the
                    Founder's Hall Gate (御影堂門), 27 m, two storeys under two roofs (Higashi Honganji;
                    Wikipedia).
  Nishi Hongwanji   the Founder's Hall, 62 m by 48 m, 29 m high; the Amida Hall, 25 m; the study halls.
  Nijo Castle       the palaces of the Ninomaru and the Honmaru on their footprints; the stone ramparts,
                    plastered walls, the two corner turrets, the gates and the keep's base where
                    OpenStreetMap maps them (cities/kyoto/castles_osm.json).
  Imperial Palace   the Hall for State Ceremonies (紫宸殿), 20.5 m to its ridge under cypress bark, the south
                    court's corridors (回廊) and its vermilion gates, the Jōmei-mon (承明門), Nikka-mon and
                    Gekka-mon; the halls, gates and walls inside the palace's outline.
  Kyoto Station Building (京都駅ビル, Hiroshi Hara, 1997): 470 m along the tracks, 80 m deep and 60 m
               high (JR West; the building's own figures), on its PLATEAU footprint, which the renderers
               then leave out: the west block over the Isetan, the Grand Staircase (大階段, 171 steps rising
               35 m over about 70 m) climbing west from the concourse to the roof garden, the atrium over
               the concourse (147 m long, 29 m deep, 50 m high) under a glass roof of about 4,000 panes on
               a steel grid, the Skyway (空中径路, 185 m long, 45 m up) along its north side, and the east
               block of the Hotel Granvia. The massing and the steel's spacing are read from GSI's aerial
               photograph and photographs, not from drawings.
  Kyoto Tower  131 m to the spire, observation deck at 100 m, a stressed-skin steel tube
               (no inner frame) completed in 1964. Published figures are the two heights;
               the radii and the deck's shape are an approximation, not survey data.
"""
import math

import numpy as np

import archkit as ak
from meshkit import Mesh


def _load(name):
    import importlib.util
    import os
    spec = importlib.util.spec_from_file_location(f"kyoto_{name}", os.path.join(os.path.dirname(os.path.abspath(__file__)), f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RAIL = _load("rail")   # Kyoto Station's Shinkansen and JR platforms and their trains (cities/kyoto/rail.py)

TOWER_LL = (135.75946, 34.98748)   # lon, lat of the tower
BASE_M = 31.0                      # roof of the building under the tower
# after dark the tower is floodlit white from the roof of the building under it, and the deck's
# windows are lit from inside (emissive, glow; "flood" is set from the tower's base in landmark_meshes)
MATERIALS = {
    "tower": {"color": "#f4f2ec", "roughness": 0.45, "metalness": 0.1, "emissive": "#fff6ea", "glow": 0.75},
    "deck_glass": {"color": "#2b3238", "roughness": 0.1, "metalness": 0.5, "emissive": "#ffd7a0", "glow": 0.55},
    "mast": {"color": "#d9463b", "roughness": 0.5, "metalness": 0.2, "emissive": "#ffd2c2", "glow": 0.4},
    # the temples, the castle and the palace: weathered timber, white plaster, grey tiles (Osaka Castle's
    # kawara), cypress bark, granite; lit softly after dark
    "jp_base": {"color": "#a19b90", "roughness": 0.92, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.45, "block_m": 0.9},
    "jp_post": {"color": "#5a4130", "roughness": 0.8, "metalness": 0.0},
    "jp_wall": {"color": "#ebe7dc", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffe6c4", "glow": 0.15},
    "jp_bracket": {"color": "#4a3628", "roughness": 0.8, "metalness": 0.0, "emissive": "#ffcf98", "glow": 0.2},
    "kawara": {"color": "#5d6266", "roughness": 0.6, "metalness": 0.1, "pattern": "roof_tiles", "bay_m": 0.3, "course_m": 0.3},
    "kawara_ridge": {"color": "#43474a", "roughness": 0.6, "metalness": 0.1},
    "hiwada": {"color": "#6e5847", "roughness": 0.92, "metalness": 0.0, "pattern": "roof_tiles", "bay_m": 0.09, "course_m": 0.12},
    "hiwada_ridge": {"color": "#4c3c30", "roughness": 0.9, "metalness": 0.0},
    "gable_white": {"color": "#e9e4d6", "roughness": 0.8, "metalness": 0.0},
    "ishigaki": {"color": "#8f897d", "roughness": 0.95, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.65, "block_m": 1.1},
    "shu": {"color": "#b5452f", "roughness": 0.7, "metalness": 0.0, "emissive": "#ffc9a8", "glow": 0.2},   # vermilion lacquer
    "renji": {"color": "#3e6b56", "roughness": 0.75, "metalness": 0.0},  # the corridors' green lattice
    "jp_gold": {"color": "#d6a93a", "roughness": 0.3, "metalness": 0.85, "emissive": "#ffc94a", "glow": 0.5},
    # Kyoto Station: grey-silver aluminium and glass on a 3.6 m grid, the atrium's glass, white steel
    # (#244, side by side with photographs from Karasuma-dori: the panels a neutral mid grey, darker than the
    # sky, and the glass grid dark with the sky and Kyoto Tower in it; they had read pale blue-white)
    "ks_panel": {"color": "#7c7f81", "roughness": 0.45, "metalness": 0.35, "pattern": "curtain_wall", "bay_m": 3.6, "storey_m": 4.2,
                 "spandrel": 0.45, "mullion_m": 0.18, "frame": "#b4b8bb", "lit_share": 0.55, "lit_k": 0.8},
    "ks_glass": {"color": "#4c5f6c", "roughness": 0.05, "metalness": 0.6, "pattern": "curtain_wall", "bay_m": 3.6, "storey_m": 4.2,
                 "spandrel": 0.0, "mullion_m": 0.06, "frame": "#e6e9eb", "lit_share": 0.9, "lit_k": 0.5},
    # the building beside the Granvia's east corner (#307, granvia_neighbour): light grey aluminium spandrels, ribbons of
    # glass between them (lit room by room after dark), a glazed ground storey, solar panels on the roof
    "gv_band": {"color": "#c3c5c3", "roughness": 0.5, "metalness": 0.25, "pattern": "granite", "joints_m": [2.4, 1.6]},
    "gv_glass": {"color": "#55636b", "roughness": 0.06, "metalness": 0.6, "pattern": "curtain_wall", "bay_m": 1.6, "storey_m": 3.8,
                 "spandrel": 0.0, "mullion_m": 0.07, "frame": "#a9afb1", "lit_share": 0.5, "lit_k": 0.7},
    "gv_shop": {"color": "#46535a", "roughness": 0.05, "metalness": 0.5, "pattern": "curtain_wall", "bay_m": 2.4, "storey_m": 4.4,
                "spandrel": 0.0, "mullion_m": 0.09, "frame": "#8d9496", "lit_share": 0.8, "lit_k": 0.6, "warm_share": 0.6},
    "gv_solar": {"color": "#1d2a3a", "roughness": 0.2, "metalness": 0.5},
    # the Hotel Granvia's guest floors (#258): grey granite panels, and windows lit room by room after dark
    "ks_stone": {"color": "#85878a", "roughness": 0.7, "metalness": 0.05, "pattern": "granite", "joints_m": [1.8, 1.1]},
    "ks_room": {"color": "#3f4d58", "roughness": 0.06, "metalness": 0.6, "pattern": "curtain_wall", "bay_m": 1.8, "storey_m": 1.65,
                "spandrel": 0.0, "mullion_m": 0.05, "frame": "#c9ccce", "lit_share": 0.5, "lit_k": 0.8},
    # the glass block beside the atrium: deep blue glass on a fine dark grid, the sky and Kyoto Tower in it
    "ks_bluegrid": {"color": "#33495e", "roughness": 0.04, "metalness": 0.7, "pattern": "curtain_wall", "bay_m": 1.8, "storey_m": 1.8,
                    "spandrel": 0.0, "mullion_m": 0.07, "frame": "#262d33", "lit_share": 0.35, "lit_k": 0.4},
    "ks_rail": {"color": "#8a9aa4", "roughness": 0.1, "metalness": 0.4, "opacity": 0.45},
    "ks_roofglass": {"color": "#b8c9d4", "roughness": 0.06, "metalness": 0.3, "opacity": 0.32},
    "ks_steel": {"color": "#dfe2e4", "roughness": 0.35, "metalness": 0.6, "emissive": "#fff1dc", "glow": 0.35},
    # the great grid over the north face (#218): aluminium-clad frames standing proud of the glass
    "ks_frame": {"color": "#a7abb0", "roughness": 0.38, "metalness": 0.55},
    "ks_concrete": {"color": "#b3b0aa", "roughness": 0.85, "metalness": 0.0},
    # the Grand Staircase's LED risers (since 2012): a warm white, red and green for Christmas, cherry pink in spring
    "ks_led": {"color": "#d8d4cc", "roughness": 0.6, "metalness": 0.0, "emissive": "#ffe3b8", "glow": 0.9,
               "emissive_dates": [["12-01", "12-25", "#ff5a4a"], ["03-20", "04-15", "#ff9ec4"]]},
    "ks_steps": {"color": "#9d988f", "roughness": 0.8, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 0.4], "stair": "tread"},
    # Higashi Honganji's moat (honganji_moat): its still water, its granite sides and their coping; none of
    # them solid (the 2 m cells would fill the pavement beside it): walkers keep off it by game.json "keep_off"
    "moat_water": {"color": "#24312c", "roughness": 0.06, "metalness": 0.35, "solid": False},
    "moat_stone": {"color": "#878176", "roughness": 0.95, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.4, "block_m": 0.9, "solid": False},
    "moat_coping": {"color": "#a39d92", "roughness": 0.9, "metalness": 0.0, "solid": False},
    # the bridges' granite decks, laid over the photograph (which has the gate's shadow across the one before it)
    # the courts round the halls (aprons, #187): granite flags at the Honganji, raked gravel at the castle
    # and the palace, laid over the aerial photograph where its shadows of the halls and its strips of
    # small water lay flat on the ground the drawn pavement stops short of
    "court_flags": {"color": "#a8a196", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [0.9, 0.6], "decal": True, "street_lit": True},
    "court_gravel": {"color": "#c9c3b5", "roughness": 0.95, "metalness": 0.0, "decal": True, "street_lit": True},
    "moat_deck": {"color": "#aaa398", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [0.9, 1.8], "decal": True, "street_lit": True},
}

# Higashi Honganji's moat (お堀), round the temple along Karasuma-dori and its north and south sides:
# OpenStreetMap way 1010912897 (natural=water, 2,650 m2, 3 to 4 m wide), too small for the city's water
# (city.json water.min_area_m2), so the aerial photograph's dark strip of water lay on the paving, a blue
# band in front of the gates. Drawn sunk MOAT_DROP_M below the pavement between granite sides, under a
# coping, and crossed by the bridges OpenStreetMap maps over it (footways, bridge=yes): (way, the
# bridge's line, its width along the moat, metres, measured on GSI's photograph where it shows,
# MOAT_BRIDGE_M otherwise). The broad one before the Founder's Hall Gate spans 32 m of the moat, the
# gate's width (31 m, Wikipedia): the photograph shows no water across it.
MOAT_RING = [[135.7582888, 34.9895685], [135.7582892, 34.9895432], [135.7595912, 34.9895402], [135.7595909, 34.9898292],
             [135.7596123, 34.9898542], [135.7596061, 34.9903165], [135.7595991, 34.9926007], [135.7595891, 34.9926094],
             [135.7595828, 34.9931876], [135.7595128, 34.9932544], [135.7571322, 34.9932498], [135.757132, 34.9932231],
             [135.7594864, 34.9932221], [135.7594902, 34.9931832], [135.75954, 34.9931829], [135.7595407, 34.9925999],
             [135.7595615, 34.9925852], [135.7595644, 34.9911995], [135.7595764, 34.9898821], [135.759508, 34.9898837],
             [135.7595065, 34.9895648]]
MOAT_BRIDGES = [("w1010912912", [[135.7595368, 34.9927771], [135.7595827, 34.9927775]], None),
                ("w1010912910", [[135.7596044, 34.9924711], [135.7595452, 34.9924711]], 14.0),
                ("w1010912907", [[135.7596074, 34.9920907], [135.7595527, 34.9920912]], 8.0),
                ("w1010912904", [[135.7596092, 34.9914458], [135.7595616, 34.9914458]], 6.0),
                ("w1010912900", [[135.7596197, 34.9910006], [135.7595692, 34.9910007]], 32.0),
                ("w1010912899", [[135.7596084, 34.9903588], [135.7595607, 34.9903592]], 9.0),
                ("w1241562565", [[135.7590092, 34.9895684], [135.7590095, 34.9895376]], None)]
# the bridge before the gate is not centred on OpenStreetMap's line: the photograph has it from 18.7 m
# north of the line to 13.3 m south (way: metres north of the line its middle is)
MOAT_BRIDGE_SHIFT = {"w1010912900": 2.7}
# and its granite runs on east of the moat to the pavement's flags, over the gate's shadow on the
# photograph (metres past the line's east end)
MOAT_DECK_EAST = {"w1010912900": 4.5}
MOAT_BRIDGE_M, MOAT_DROP_M, MOAT_COPING = 5.0, 1.1, (0.35, 0.18)  # width; water below the pavement; coping wide, high
MOAT_WALK_M, MOAT_TEMPLE_XY = 2.5, (-370.0, -1290.0)  # the flags along the outer bank; a point inside the temple's grounds
KEEP_OFF_PAD_M = 0.25  # a walker's half-width: the keep-off area reaches this far out over the coping


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
    mats = {k: dict(v) for k, v in MATERIALS.items()}
    for k in ("tower", "mast"):
        mats[k]["flood"] = [round(z0, 1), round(t["ground_m"] + t["spire_m"], 1), 0.5, 0.5]
    shaft = Mesh("Kyoto Tower shaft", "tower", True, floodlit=True)
    lathe(shaft, x, y, z0, [(0, 6.2), (6, 5.2), (28, 3.9), (52, 3.1), (61, 3.0)])   # base building roof to just under the deck
    deck = Mesh("Kyoto Tower deck", "deck_glass", True, floodlit=True)
    lathe(deck, x, y, z0, [(61, 3.0), (62, 7.5), (64, 9.6), (68, 9.6), (70, 7.0), (71, 3.4)])
    cone = Mesh("Kyoto Tower rim", "tower", True, floodlit=True)
    lathe(cone, x, y, z0, [(60, 3.0), (62, 7.7), (62, 9.8), (64, 10.0)])
    mast = Mesh("Kyoto Tower mast", "mast", True, floodlit=True)
    lathe(mast, x, y, z0, [(71, 3.4), (74, 2.0), (90, 0.9), (100 - BASE_M + 31, 0.12)], n=12)   # spire tip at 131 m above ground
    more, hidden = temples_and_palaces()
    st, st_hidden = kyoto_station()
    nb, nb_hidden = granvia_neighbour()
    rm, rmesh = RAIL.meshes(Mesh)   # the Shinkansen's viaduct, the JR tracks and the platforms (cities/kyoto/rail.py)
    mats.update({k: dict(v) for k, v in rm.items()})
    return mats, [shaft, deck, cone, mast] + more + st + nb + rmesh, {"hidden": sorted(set(hidden + st_hidden + nb_hidden + in_horikawa())),
                                                              "clip": moat_meshes()[1]}


def in_horikawa():
    """Solids standing mostly in the Horikawa's sunken channel (a shed mapped across its wall, OSM w229155098, hung
    out over the promenade at a flight of steps): not drawn, and not in walkers' way."""
    from shapely.geometry import Polygon
    ch = horikawa_channel(0.0)
    if ch is None:
        return []
    out = []
    for sd in ak.load_solids("kyoto"):
        g = Polygon(sd["ring"]).buffer(0)
        if g.area > 0 and g.intersects(ch) and g.intersection(ch).area > 0.3 * g.area:
            out.append(sd["si"])
    return out


# ---------------------------------------------------------------- Kyoto Station

# the Hotel Granvia's north face, west to east (m along the building), and its heights (m), read from the frontal
# photographs (Zairon, 2017, CC BY-SA 4.0; Soramimi, CC BY-SA 4.0) scaled to the face's PLATEAU length: the strip
# w536429045, 77 m, standing 12 m forward of the main solid (#272, #290). "east_h" is the range set back behind it
GRANVIA = {"tower": 9.8, "shaft": 7.0, "gate": 10.2, "corner": 3.4, "east_h": 56.0, "recess": 7.0, "box_bottom": 40.0, "box_top": 45.7,
           "box_proud": 0.6, "glass": (31.9, 40.0), "band": (29.9, 31.9), "base_top": 34.5, "holes_z": 24.0, "vault": 30.5}
STATION_OSM = "w136243347"   # 京都駅ビル: the largest of its solids is the building over the concourse
STATION = {"length": 470.0, "height": 59.8, "atrium": (214.0, 325.0), "atrium_deep": 29.0, "atrium_h": 50.0,
           "stairs": (130.0, 214.0), "stairs_top": 45.0, "stairs_foot": 10.0, "steps": 171, "skyway_m": 45.0,
           "west_top": 59.8, "garden": 45.0, "south": 31.0, "east_top": 59.8}


def station_layout():
    """The building's frame (u east along the tracks from its west end, v north) and its bounds, from
    the PLATEAU solid it replaces."""
    from shapely.geometry import Polygon, box as sbox
    solids = ak.load_solids("kyoto")
    got = [sd for sd in solids if sd["osm"] == STATION_OSM]
    if not got:
        return None
    sd = max(got, key=lambda d: abs(ak.ring_area(d["ring"])))
    cx, cy, ax, L, W = ak.oriented(sd["ring"])
    if math.cos(math.radians(ax)) < 0:
        ax += 180.0
    F0 = ak.Frame(cx, cy, ax, 0.0)
    loc = Polygon([F0.local(x, y) for x, y in sd["ring"]]).buffer(0)
    u0, v0, u1, v1 = loc.bounds
    def north(a, b):
        g = loc.intersection(sbox(u0 + a, v0 - 1, u0 + b, v1 + 1))
        return g.bounds[3] if not g.is_empty else v1
    def south(a, b):
        g = loc.intersection(sbox(u0 + a, v0 - 1, u0 + b, v1 + 1))
        return g.bounds[1] if not g.is_empty else v0
    return {"sd": sd, "F": ak.Frame(cx, cy, ax, sd["ground"]), "u0": u0, "u1": u1, "v0": v0, "v1": v1, "north": north, "south": south,
            "ground": sd["ground"]}


def kyoto_station():
    """Kyoto Station Building, its parts west to east along the tracks (STATION; s in metres from the west
    end): the west block, the roof garden, the Grand Staircase, the atrium over the concourse with its
    glass roof and the Skyway, the east block."""
    S = station_layout()
    if not S:
        return [], []
    F, u0, D = S["F"], S["u0"], STATION
    K = ak.Kit("kyoto_station", floodlit={"ks_steel", "ks_led"}, uv={"ks_panel", "ks_glass", "ks_steps", "ks_stone", "ks_room", "ks_bluegrid"})
    scale = (S["u1"] - S["u0"]) / D["length"]
    s_ = lambda s: u0 + s * scale
    A0, A1 = D["atrium"]
    T0, T1 = D["stairs"]
    vn = S["north"](A0, A1)
    vs = S["south"](0, D["length"])
    va = vn - D["atrium_deep"]                                   # the atrium's south side
    def mass(sa, sb, va_, vb_, h, mat="ks_panel", roof=True):
        ak.block(K[mat], F, s_(sa), s_(sb), va_, vb_, 0.0, h, top=False)
        if roof:
            ak.block(K["ks_concrete"], F, s_(sa) + 0.4, s_(sb) - 0.4, va_ + 0.4, vb_ - 0.4, h - 0.3, h + 0.9)
    # the west block: its upper storeys stepping back from the north, the roof garden east of it
    vw = S["north"](0, 85)
    mass(0, 85, vs, vw, 45.0)
    mass(4, 85, vs + 4, vw - 9, D["west_top"])
    mass(85, T0, vs, S["north"](85, T0), D["garden"])
    # the Grand Staircase: from the concourse up westward to the roof garden, in the atrium's band,
    # the south part of the block beside it at the garden's height
    mass(T0, A0, vs, va, D["garden"])
    n = D["steps"]
    run = (s_(T1) - s_(T0)) / n
    for k in range(n):
        z = D["stairs_foot"] + (D["stairs_top"] - D["stairs_foot"]) * (k + 1) / n
        ua = s_(T1) - (k + 1) * run
        ak.block(K["ks_steps"], F, ua, ua + run + 0.02, va, vn, z - 0.6, z, top=True)
        zr0 = D["stairs_foot"] + (D["stairs_top"] - D["stairs_foot"]) * k / n
        K["ks_led"].quad(F(ua + run + 0.03, va + 0.6, zr0), F(ua + run + 0.03, vn - 0.6, zr0), F(ua + run + 0.03, vn - 0.6, z - 0.02), F(ua + run + 0.03, va + 0.6, z - 0.02))
    ak.block(K["ks_concrete"], F, s_(T0), s_(T1), va + 0.5, vn - 0.5, 0.0, D["stairs_foot"] - 0.6, top=True)
    for v in (va, vn):   # the staircase's side walls, stepping down with it
        K["ks_panel"].quad(F(s_(T1), v, 0.0), F(s_(T0), v, 0.0), F(s_(T0), v, D["stairs_top"] + 1.2), F(s_(T1), v, D["stairs_foot"] + 1.2),
                           [[0, 0], [s_(T1) - s_(T0), 0], [s_(T1) - s_(T0), D["stairs_top"]], [0, D["stairs_foot"]]])
    # the atrium: the block south of it at 31 m, open over the concourse to the glass roof
    mass(A0, A1, vs, va, D["south"])
    ak.wall(K["ks_glass"], F, s_(A0), va, s_(A1), va, D["south"], D["atrium_h"])               # the south wall above the block
    H = D["atrium_h"]
    # the north face: a frame of white steel, glazed from 6 m up, open over the concourse's doors
    for k in range(int((s_(A1) - s_(A0)) / 7.2) + 1):
        u = s_(A0) + k * 7.2
        K["ks_steel"].box(F(u, vn, 0.0), F(u, vn, H), 0.7, 0.9)
    for z in np.arange(6.0, H, 4.2):
        K["ks_steel"].box(F(s_(A0), vn, z), F(s_(A1), vn, z), 0.35, 0.5)
    ak.wall(K["ks_glass"], F, s_(A0), vn - 0.2, s_(A1), vn - 0.2, 6.0, H)
    # the roof: glass on a steel grid with a lower chord and diagonals, rising a little to the south
    zr = lambda v: H + 3.0 * (vn - v) / D["atrium_deep"]
    K["ks_roofglass"].quad(F(s_(A0), vn, zr(vn) + 0.1), F(s_(A1), vn, zr(vn) + 0.1), F(s_(A1), va, zr(va) + 0.1), F(s_(A0), va, zr(va) + 0.1))
    for k in range(int((s_(A1) - s_(A0)) / 3.6) + 1):
        u = s_(A0) + k * 3.6
        K["ks_steel"].box(F(u, va, zr(va)), F(u, vn, zr(vn)), 0.25, 0.3)
        if k % 2 == 0:
            K["ks_steel"].box(F(u, va, zr(va) - 2.4), F(u, vn, zr(vn) - 2.4), 0.2, 0.25)
            K["ks_steel"].box(F(u, va, zr(va)), F(u + 3.6, (va + vn) / 2, zr((va + vn) / 2) - 2.4), 0.12, 0.12)
            K["ks_steel"].box(F(u, vn, zr(vn)), F(u + 3.6, (va + vn) / 2, zr((va + vn) / 2) - 2.4), 0.12, 0.12)
    for v in np.arange(va, vn + 0.1, 3.6):
        K["ks_steel"].box(F(s_(A0), v, zr(v)), F(s_(A1), v, zr(v)), 0.22, 0.25)
    # the Skyway: a glazed corridor along the atrium's north side, 45 m up, on to the blocks either end
    zs = D["skyway_m"]
    ak.block(K["ks_glass"], F, s_(A0 - 25), s_(A1 + 13), vn - 5.0, vn - 1.5, zs, zs + 3.2, top=False)
    ak.block(K["ks_steel"], F, s_(A0 - 25), s_(A1 + 13), vn - 5.2, vn - 1.3, zs - 0.6, zs)
    ak.block(K["ks_steel"], F, s_(A0 - 25), s_(A1 + 13), vn - 5.2, vn - 1.3, zs + 3.2, zs + 3.6)
    # the atrium's front, the gate (門) of the station: a deep portal of white steel round the glass, its
    # piers either side and a lintel over it, standing out from the faces of the blocks beside it
    for sa in (A0, A1):
        ak.block(K["ks_steel"], F, s_(sa) - 1.4, s_(sa) + 1.4, vn - 0.5, vn + 2.4, 0.0, H + 1.2)
    ak.block(K["ks_steel"], F, s_(A0) - 1.4, s_(A1) + 1.4, vn - 0.5, vn + 2.4, H - 1.8, H + 1.2)
    ak.block(K["ks_steel"], F, s_(A0), s_(A1), vn + 0.6, vn + 2.4, 5.4, 6.4)     # over the concourse's doors
    # the east block, the Hotel Granvia (#258, #272; side by side with photographs from Karasuma-dori and the
    # forecourt, docs/cities/kyoto.md): next to the atrium a block of glass on a fine steel grid standing forward to
    # the portal's face (PLATEAU's strip in front of the main solid), then the hotel. Its north face, west to east
    # (the frontal photograph, Zairon 2017, scaled to PLATEAU's length): a tower of balconied rooms over a grey base
    # pierced by a grid of square openings; a shaft of blue grid glass; the gate (門), a void through the guest
    # floors in which a grey box hangs under the top floors, its soffit sloping up into the void, a curtain of glass
    # set back under it and a concave band below that; then the long wing of rooms with small balconies hung under
    # every other window, staggered floor to floor, over a podium of big windows with a faceted glass vault rising up
    # its face from the east to the gate; a glazed top storey the length of it, and a glazed corner at its east end
    # (#290) the face is PLATEAU's strip in front of the main solid (w536429045, 77 m from 15 m east of the atrium):
    # the aerial photograph shows the atrium's glass roof ending there and the station's north face stepping back
    # 28 m east of the strip, behind a separate building 46 m tall (w120374245) that the forecourt photographs show
    # beside the hotel's east corner, not in front of its face
    G1, E1, ve = hotel_front(S, A1)
    Hh = D["east_top"]
    vf = S["north"](A1, G1)                        # the glass block's front, the main solid's face
    vr = ve - 6.0                                  # the guest floors' face, behind the podium
    zp, zt = 22.0, 55.0                            # the podium's top, and the glazed top storey's foot
    GV = GRANVIA
    tw, sh = G1 + GV["tower"], G1 + GV["tower"] + GV["shaft"]          # the tower's east side, the shaft's
    gw, ge = sh, sh + GV["gate"]                                       # the gate's sides
    rec = GV["recess"]
    mass(A1, E1, vs, vr - rec, Hh)                 # the main solid, its face back where the gate's glass stands
    ven = S["north"](E1 + 3.0, D["length"])        # the range east of the face, set back, a little lower
    mass(E1, D["length"], vs, ven, GV["east_h"])
    for a_, b_ in ((A1, gw), (ge, E1)):            # the north range either side of the gate, to the guest floors' face
        mass(a_, b_, vr - rec, vr, Hh)
    mass(gw, ge, vr - rec, vr, zp)                 # under the gate, and over its box
    ak.block(K["ks_panel"], F, s_(gw), s_(ge), vr - rec, vr, GV["box_top"], Hh, top=False)
    ak.block(K["ks_concrete"], F, s_(gw), s_(ge), vr - rec + 0.4, vr - 0.4, Hh - 0.3, Hh + 0.9)
    ak.block(K["ks_bluegrid"], F, s_(A1), s_(G1), vr, vf, 0.0, Hh, top=False)
    ak.block(K["ks_concrete"], F, s_(A1) + 0.4, s_(G1) - 0.4, vr, vf - 0.4, Hh - 0.3, Hh + 0.9)
    ak.block(K["ks_stone"], F, s_(G1), s_(E1), vr, ve, 0.0, zp)
    # the gate: its side walls and ceiling, the glass curtain at its back, the concave band and the dark recess under it
    zb, zg0, zg1 = GV["box_bottom"], GV["glass"][0], GV["glass"][1]
    for uu, sgn in ((gw, 1), (ge, -1)):
        u = s_(uu)
        q = (lambda a1, b1, c1, d1: K["ks_stone"].quad(a1, b1, c1, d1, [[0, zp], [rec, zp], [rec, zb], [0, zb]])) if sgn > 0 else \
            (lambda a1, b1, c1, d1: K["ks_stone"].quad(b1, a1, d1, c1, [[0, zp], [rec, zp], [rec, zb], [0, zb]]))
        q(F(u, vr, zp), F(u, vr - rec, zp), F(u, vr - rec, zb + 2.5), F(u, vr, zb))
    ak.wall(K["ks_glass"], F, s_(gw), vr - rec + 0.05, s_(ge), vr - rec + 0.05, zg0, zg1)
    for k in range(1, 5):                          # the curtain's mullions
        u = s_(gw) + (s_(ge) - s_(gw)) * k / 5
        K["ks_frame"].box(F(u, vr - rec + 0.25, zg0), F(u, vr - rec + 0.25, zg1), 0.2, 0.3)
    arc = [(s_(gw) + (s_(ge) - s_(gw)) * t, vr - rec * 0.55 * math.sin(math.pi * t)) for t in np.linspace(0, 1, 13)]
    zc0, zc1 = GV["band"]
    for (u1, v1), (u2, v2) in zip(arc, arc[1:]):  # the concave band, faced in panels, and its soffit
        K["ks_frame"].quad(F(u1, v1, zc0), F(u2, v2, zc0), F(u2, v2, zc1), F(u1, v1, zc1))
        K["ks_frame"].quad(F(u2, v2, zc1), F(u1, v1, zc1), F(u1, vr - rec, zc1), F(u2, vr - rec, zc1))
        K["ks_concrete"].quad(F(u1, vr - rec, zc0), F(u2, vr - rec, zc0), F(u2, v2, zc0), F(u1, v1, zc0))
    K["ks_glass"].quad(F(s_(gw), vr - rec + 0.05, zp), F(s_(ge), vr - rec + 0.05, zp), F(s_(ge), vr - rec + 0.05, zc0), F(s_(gw), vr - rec + 0.05, zc0))
    ak.block(K["ks_glass"], F, s_(gw) + 1.0, s_(ge) - 1.0, vr - 1.2, ve - 0.6, zp, zp + 2.6, top=True)   # the glazed room on the podium
    # the box, hung under the top floors: its grey front a little proud of the guest floors' face, its soffit
    # sloping up from the front into the gate
    zbt = GV["box_top"]
    vb = vr + GV["box_proud"]
    u1, u2 = s_(gw), s_(ge)
    K["ks_stone"].quad(F(u1, vb, zb), F(u2, vb, zb), F(u2, vb, zbt), F(u1, vb, zbt), [[0, zb], [u2 - u1, zb], [u2 - u1, zbt], [0, zbt]])
    K["ks_concrete"].quad(F(u2, vb, zb), F(u1, vb, zb), F(u1, vr - rec, zb + 2.5), F(u2, vr - rec, zb + 2.5))
    for uu, sgn in ((u1, -1), (u2, 1)):
        tri = [F(uu, vb, zb), F(uu, vr - rec, zb + 2.5), F(uu, vr - rec, zbt), F(uu, vb, zbt)]
        K["ks_stone"].quad(*(tri if sgn > 0 else tri[::-1]))
    ak.block(K["ks_concrete"], F, u1, u2, vr, vb, zbt, zbt + 0.3)
    # the shaft of blue grid glass from over the tower's base to the top, and the base of the tower and the shaft
    # standing forward to the podium's face, with its grid of square openings
    ak.block(K["ks_bluegrid"], F, s_(tw), s_(sh), vr, vr + 0.6, GV["base_top"], Hh, top=False)
    ak.block(K["ks_stone"], F, s_(G1), s_(sh), vr, ve, zp, GV["base_top"])
    for i in range(4):
        for j in range(4):
            u = s_(G1) + 2.4 + i * 1.7
            z = GV["holes_z"] + j * 1.75
            K["ks_frame"].quad(F(u, ve + 0.03, z), F(u + 0.9, ve + 0.03, z), F(u + 0.9, ve + 0.03, z + 0.9), F(u, ve + 0.03, z + 0.9))
    # the glazed corner at the east end
    ak.block(K["ks_bluegrid"], F, s_(E1) - GV["corner"], s_(E1) + 0.05, vr - 0.3, vr + 0.4, zp, Hh, top=False)
    # the podium: the porte-cochere's soffit and two rows of big windows over it
    ak.block(K["ks_concrete"], F, s_(G1), s_(E1), ve - 1.5, ve + 0.4, 6.4, 7.6)
    for u in np.arange(s_(G1) + 2.0, s_(E1) - 5.0, 7.2):
        for z0 in (9.5, 15.5):
            if u < s_(sh) and z0 > 12:
                continue
            K["ks_room"].quad(F(u, ve + 0.04, z0), F(u + 5.6, ve + 0.04, z0), F(u + 5.6, ve + 0.04, z0 + 4.2), F(u, ve + 0.04, z0 + 4.2),
                              [[0, 0], [1.8, 0], [1.8, 1.65], [0, 1.65]])
    # the faceted glass vault up the face of the wing, from the podium's top at the east end rising to the gate:
    # a ridge of facets between the podium's edge and the guest floors' face, high and low by turns
    va0, va1 = ge + 0.5, E1 - GV["corner"] - 6.0
    zv = GV["vault"]
    n = int((va1 - va0) / 4.5)
    rise = lambda u: zp + (zv - zp) * min(1.0, max(0.0, (u - s_(va1)) / (s_(va0) - s_(va1) + 1e-9)) * 1.6)
    front = [(s_(va0) + (s_(va1) - s_(va0)) * k / n, ve - 0.6) for k in range(n + 1)]
    back = [(u, vr + 0.05) for u, _ in front]
    for k in range(n):
        (ua, vfa), (ub, vfb) = front[k], front[k + 1]
        hb = (0.0 if k % 2 else 1.4)
        pa, pb = F(ua, vfa, zp + 0.3), F(ub, vfb, zp + 0.3)
        ra, rb = F(ua, vr + 0.05, rise(ua) + hb), F(ub, vr + 0.05, rise(ub) + (1.4 - hb))
        mid = F((ua + ub) / 2, (vfa + vr) / 2, (zp + 0.3 + (rise(ua) + rise(ub)) / 2) / 2 + 2.2)
        for tri_ in ((pa, pb, mid), (pb, rb, mid), (rb, ra, mid), (ra, pa, mid)):
            K["ks_roofglass"].tri(*tri_)
            K["ks_roofglass"].tri(tri_[0], tri_[2], tri_[1])
            for e0, e1 in ((tri_[0], tri_[1]), (tri_[1], tri_[2])):
                K["ks_steel"].box(e0, e1, 0.12, 0.12)
    canopy = lambda u: (rise(u) + 1.6) if s_(va0) - 1.0 <= u <= s_(va1) + 1.0 else 0.0
    def blank(u, z):   # where the guest floors' windows are not: the gate, the shaft, the tower's base, the corner
        return (s_(gw) - 0.9 <= u <= s_(ge) + 0.9 and z < GV["box_top"] + 0.4) or s_(tw) - 0.9 <= u <= s_(sh) + 0.9 \
            or (u < s_(tw) and z < GV["base_top"] + 0.4) or u > s_(E1) - GV["corner"] - 1.2
    # the guest floors: 3.3 m storeys, a window every 3.6 m, a balcony under every other window
    def rooms(ua, ub, vr, z0, z1, skip):
      for f, z in enumerate(np.arange(z0, z1, 3.3)):
        for k, u in enumerate(np.arange(ua + 1.8, ub - 1.0, 3.6)):
            if skip(u, z):
                continue
            K["ks_room"].quad(F(u - 0.9, vr + 0.04, z), F(u + 0.9, vr + 0.04, z), F(u + 0.9, vr + 0.04, z + 1.65), F(u - 0.9, vr + 0.04, z + 1.65),
                              [[k * 1.8, f * 1.65], [k * 1.8 + 1.8, f * 1.65], [k * 1.8 + 1.8, f * 1.65 + 1.65], [k * 1.8, f * 1.65 + 1.65]])
            ak.block(K["ks_frame"], F, u - 1.0, u + 1.0, vr, vr + 0.18, z - 0.12, z)        # the sill
            if (k + f) % 2 == 0:
                ak.block(K["ks_concrete"], F, u - 1.3, u + 1.3, vr, vr + 1.1, z - 0.3, z - 0.08)
                K["ks_steel"].box(F(u - 1.3, vr + 1.05, z + 0.95), F(u + 1.3, vr + 1.05, z + 0.95), 0.06, 0.06)
                for uu in (u - 1.3, u + 1.3):
                    K["ks_steel"].box(F(uu, vr + 0.05, z + 0.95), F(uu, vr + 1.05, z + 0.95), 0.06, 0.06)
                    K["ks_steel"].box(F(uu, vr + 1.05, z - 0.08), F(uu, vr + 1.05, z + 0.95), 0.05, 0.05)
                K["ks_rail"].quad(F(u - 1.3, vr + 1.05, z - 0.08), F(u + 1.3, vr + 1.05, z - 0.08), F(u + 1.3, vr + 1.05, z + 0.9), F(u - 1.3, vr + 1.05, z + 0.9))
                K["ks_rail"].quad(F(u + 1.3, vr + 1.05, z - 0.08), F(u - 1.3, vr + 1.05, z - 0.08), F(u - 1.3, vr + 1.05, z + 0.9), F(u + 1.3, vr + 1.05, z + 0.9))
    rooms(s_(G1), s_(E1), vr, zp + 0.9, zt - 2.0, lambda u, z: z < canopy(u + 1.8) + 0.6 or blank(u, z))
    # the range behind, east of the face (its rooms and balconies show beside the face's east corner)
    rooms(s_(E1) + 1.0, s_(D["length"]) - 1.0, ven, zp + 0.9, GV["east_h"] - 3.0, lambda u, z: False)
    # the glazed top storey with its rail, the length of the hotel and over the glass block
    ak.block(K["ks_glass"], F, s_(A1) + 0.5, s_(E1) - 0.5, vr - 1.5, vr + 0.05, zt, Hh, top=False)
    K["ks_steel"].box(F(s_(A1), vr + 0.6, zt + 1.1), F(s_(E1), vr + 0.6, zt + 1.1), 0.08, 0.08)
    ak.block(K["ks_concrete"], F, s_(G1), s_(E1), vr, vr + 0.8, zt - 0.3, zt)
    # the great grid over the north faces either side of the atrium (#218): Hara's frame of squares, a
    # module of 7.2 m by two storeys (8.4 m), its members 1.2 m proud of the glass and heavier every
    # third line, as photographs of the Karasuma side show it (the bays' size read from them)
    def grid(sa, sb, v, z0, z1):
        ua, ub = s_(sa), s_(sb)
        for k, u in enumerate(np.arange(ua, ub + 0.1, 7.2)):
            w = 1.1 if k % 3 == 0 else 0.6
            K["ks_frame"].box(F(u, v + 0.8, z0), F(u, v + 0.8, z1), w, 1.6)
        for k, z in enumerate(np.arange(z0, z1 + 0.1, 8.4)):
            h = 1.0 if k % 3 == 0 else 0.55
            K["ks_frame"].box(F(ua, v + 0.8, z), F(ub, v + 0.8, z), 1.6, h)
    grid(0, 85, vw, 0.0, 45.0)
    grid(85, T0, S["north"](85, T0), 0.0, D["garden"])
    return K.out(), [S["sd"]["si"]] + station_strips(S, A1, vn)


# the building beside the Hotel Granvia's east corner (#307): PLATEAU's solid w120374245, 31 x 50 m and 46 m tall, its
# roof covered in solar panels (GSI's aerial photograph). The photograph from the drive-up road (Another Believer, 2019,
# CC BY-SA 4.0, docs/cities/kyoto.md) shows it light grey in horizontal bands, proud aluminium spandrels over ribbons of
# glass, its north-west corner (the one the road comes round) rounded. The corner's radius, the storeys and the bands
# are read from that photograph, not measured
NEIGHBOUR = {"osm": "w120374245", "corner_r": 6.0, "ground": 5.0, "storey": 3.8, "spandrel": 1.6, "proud": 0.22, "parapet": 1.4}


def horikawa_channel(grow=2.0):
    """The Horikawa's sunken promenade (scene.json inland, the body with a terrace), grown by `grow` m, or None."""
    import json
    import os
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "web", "data", "kyoto", "scene.json")
    I = json.load(open(path)).get("inland", {}) if os.path.exists(path) else {}
    polys = []
    for b in I.get("bodies", []):
        if b.get("terrace"):
            R = [list(zip(r[0::2], r[1::2])) for r in b["rings"]]
            polys.append(Polygon(R[0], R[1:]).buffer(0))
    return unary_union(polys).buffer(grow) if polys else None


def granvia_neighbour():
    """The banded grey building NE of the Granvia (NEIGHBOUR): ribbon glass between proud spandrels on a rounded
    footprint, a glazed ground storey set back under the first band, a parapet, and solar panels over the roof."""
    solids = [sd for sd in ak.load_solids("kyoto") if sd["osm"] == NEIGHBOUR["osm"]]
    if not solids:
        return [], []
    sd = max(solids, key=lambda d: abs(ak.ring_area(d["ring"])))
    N = NEIGHBOUR
    cx, cy, ax, L, W = ak.oriented(sd["ring"])
    F = ak.Frame(cx, cy, ax, sd["ground"] + sd["base"])
    H = sd["top"] - sd["base"]
    K = ak.Kit("granvia_neighbour", uv={"gv_glass", "gv_shop", "gv_band"})
    # the footprint in the frame, its north-west corner (the farthest north-west in the city's frame) rounded
    hu, hv = L / 2, W / 2
    corners = [(-hu, -hv), (hu, -hv), (hu, hv), (-hu, hv)]
    nw = max(range(4), key=lambda k: (lambda x, y: y - x)(*F(*corners[k], 0)[:2]))
    def ring(d, r):
        """the footprint moved out by d (in: negative), the north-west corner rounded to radius r + d"""
        out = []
        for k, (u, v) in enumerate(corners):
            su, sv = (1 if u > 0 else -1), (1 if v > 0 else -1)
            u, v = u + su * d, v + sv * d
            if k != nw:
                out.append((u, v))
                continue
            rr = max(0.5, r + d)
            cu, cv = u - su * rr, v - sv * rr
            # from the tangent point on the edge before the corner to the one on the edge after it
            tang = lambda q: math.atan2(sv, 0.0) if q[1] == corners[k][1] else math.atan2(0.0, su)
            start, end = tang(corners[k - 1]), tang(corners[(k + 1) % 4])
            dif = (end - start + math.pi) % (2 * math.pi) - math.pi
            angs = [(cu + rr * math.cos(start + dif * j / 12), cv + rr * math.sin(start + dif * j / 12)) for j in range(13)]
            out += angs
        return out
    R0 = ring(0.0, N["corner_r"])
    Rg = ring(-N["proud"], N["corner_r"])           # the glass, behind the spandrels' faces
    Rs = ring(-1.2, N["corner_r"])                  # the ground storey's glass, set back under the first band
    def walls(m, R, z0, z1, v0=0.0):
        """the walls round R from z0 to z1, UVs metres along and up from v0"""
        s = 0.0
        for k in range(len(R)):
            a, b = R[k], R[(k + 1) % len(R)]
            Lk = math.hypot(b[0] - a[0], b[1] - a[1])
            m.quad(F(*a, z0), F(*b, z0), F(*b, z1), F(*a, z1), [[s, v0], [s + Lk, v0], [s + Lk, v0 + z1 - z0], [s, v0 + z1 - z0]])
            s += Lk
    def ledge(m, Ro, Ri, z, down=False):
        """the flat strip between rings Ro (outer) and Ri (inner) at z, facing up (or down)"""
        for k in range(len(Ro)):
            a, b, c, d = Ro[k], Ro[(k + 1) % len(Ro)], Ri[(k + 1) % len(Ri)], Ri[k]
            q = [F(*a, z), F(*b, z), F(*c, z), F(*d, z)]
            m.quad(*(q if not down else q[::-1]))
    ccw = ak.ring_area(R0) > 0
    if not ccw:
        R0, Rg, Rs = R0[::-1], Rg[::-1], Rs[::-1]
    zg, sty, sp, top = N["ground"], N["storey"], N["spandrel"], H - N["parapet"]
    # the ground storey: glass set back, the first band over it carried on its soffit
    walls(K["gv_shop"], Rs, 0.0, zg - 0.6)
    walls(K["gv_band"], Rs, zg - 0.6, zg)
    ledge(K["gv_band"], R0, Rs, zg, down=True)
    # the ribbons of glass, and a proud spandrel at the foot of every storey (its face, its sill and its soffit)
    walls(K["gv_glass"], Rg, zg, top)
    z = zg
    while z < top - 0.5:
        z1 = min(z + sp, top)
        walls(K["gv_band"], R0, z, z1, v0=z)
        ledge(K["gv_band"], R0, Rg, z1)
        if z > zg:
            ledge(K["gv_band"], R0, Rg, z, down=True)
        z += sty
    # the parapet round the roof, and the roof inside it
    walls(K["gv_band"], R0, top, H)
    Rp = ring(-0.3, N["corner_r"])
    if not ccw:
        Rp = Rp[::-1]
    ledge(K["gv_band"], R0, Rp, H)
    walls(K["gv_band"], Rp[::-1], H - 0.9, H)
    ak.cap(K["ks_concrete"], F, Rp, H - 0.9)
    # solar panels over the west two thirds of the roof (the aerial photograph), in rows running east-west tilted to
    # the south, and the plant on the east third. (n, e): metres north and east in the frame's axes
    o = F(0, 0, 0)
    du, dv = [F(*q, 0)[0] - o[0] for q in ((1, 0), (0, 1))], [F(*q, 0)[1] - o[1] for q in ((1, 0), (0, 1))]
    ns_u = abs(dv[0]) >= abs(dv[1])                       # u runs north-south
    sn = (1 if dv[0] > 0 else -1) if ns_u else (1 if dv[1] > 0 else -1)   # +1: the frame's axis points north
    se = (1 if du[1] > 0 else -1) if ns_u else (1 if du[0] > 0 else -1)   # +1: the other axis points east
    hn, he = (hu, hv) if ns_u else (hv, hu)
    uv_ = lambda n, e: (n * sn, e * se) if ns_u else (e * se, n * sn)
    P2 = lambda n, e, z: F(*uv_(n, e), z)
    zr = H - 0.9
    ew = (-he + 2.0, he / 3)                              # the west two thirds
    n = -hn + 2.5
    while n < hn - 3.0:
        p = [P2(n, ew[0], zr + 0.4), P2(n, ew[1], zr + 0.4), P2(n + 1.8, ew[1], zr + 1.0), P2(n + 1.8, ew[0], zr + 1.0)]  # (low to the south)
        if ak.ring_area([F.local(*q[:2]) for q in p]) < 0:
            p = p[::-1]
        K["gv_solar"].quad(*p)
        K["gv_solar"].quad(p[3], p[2], p[1], p[0])
        for e in (ew[0] + 0.5, (ew[0] + ew[1]) / 2, ew[1] - 0.5):   # the frames under them
            K["ks_concrete"].box(P2(n + 1.6, e, zr), P2(n + 1.6, e, zr + 0.95), 0.12, 0.12)
        n += 2.6
    def box_ne(n0, n1, e0, e1, z0, z1):
        (ua, va), (ub, vb) = uv_(n0, e0), uv_(n1, e1)
        ak.block(K["ks_concrete"], F, min(ua, ub), max(ua, ub), min(va, vb), max(va, vb), z0, z1)
    box_ne(-hn * 0.4, hn * 0.3, he / 3 + 2.0, he - 3.0, zr, zr + 2.4)
    box_ne(hn * 0.4, hn * 0.7, he / 3 + 2.5, he / 3 + 7.0, zr, zr + 3.2)
    return K.out(), [sd["si"] for sd in solids]


def hotel_front(S, A1):
    """The Hotel Granvia's north face (#290): the tall strip PLATEAU cut off the station's solid east of the
    atrium, as (west end, east end) in metres along the building, and its north side."""
    from shapely.geometry import Polygon
    F0, u0 = S["F"], S["u0"]
    scale = (S["u1"] - u0) / STATION["length"]
    best = None
    for si in station_strips(S, A1, None):
        sd = next(d for d in ak.load_solids("kyoto") if d["si"] == si)
        loc = Polygon([F0.local(x, y)[:2] for x, y in sd["ring"]])
        if best is None or loc.area > best.area:
            best = loc
    if best is None:   # without the strip: the face as PLATEAU's main solid puts it
        return A1 + 15.0, A1 + 92.0, S["north"](A1, A1 + 92.0)
    a, _, c, d = best.bounds
    return (a - u0) / scale, (c - u0) / scale, d


def station_strips(S, A1, vn=None):
    """Solids PLATEAU cut from the station along its north face east of the atrium (a strip 12 m deep and
    66 m high in front of the main solid), which the model draws as the Hotel Granvia's north face."""
    from shapely.geometry import Polygon
    F0, u0 = S["F"], S["u0"]
    scale = (S["u1"] - u0) / STATION["length"]
    face = S["north"](A1, STATION["length"])
    out = []
    for sd in ak.load_solids("kyoto"):
        if sd["si"] == S["sd"]["si"] or sd["top"] < 40:
            continue
        loc = Polygon([F0.local(x, y)[:2] for x, y in sd["ring"]])
        if loc.is_empty or not loc.is_valid:
            continue
        a, b, c, d = loc.bounds
        if (a - u0) / scale > A1 - 5 and (c - u0) / scale < STATION["length"] - 40 and face - 2 < b < face + 6 and d - b < 20:
            out.append(sd["si"])
    return out


# ---------------------------------------------------------------- temples, the castle and the palace

TILE = {"base": "jp_base", "post": "jp_post", "wall": "jp_wall", "bracket": "jp_bracket", "roof": "kawara", "ridge": "kawara_ridge", "gable": "gable_white"}
BARK = dict(TILE, roof="hiwada", ridge="hiwada_ridge")
# (OSM id, ridge m, kind): the halls drawn at Higashi Honganji and Nishi Hongwanji
TEMPLE_HALLS = [("w99130389", 38.0, "founders"), ("w560097459", 29.0, "hall"), ("w1241560765", 27.3, "gate"), ("w1241560768", 18.9, "hall"),
                ("w99182315", 29.0, "founders"), ("w99182202", 25.0, "founders"), ("w372433543", 17.7, "hall"), ("w372433070", 16.2, "hall")]
SHISHINDEN = "w554905814"
# the south court before the Shishinden (南庭): its corridors (回廊), vermilion pillars and green lattice in a white
# wall under cypress bark, and its vermilion gates, the Jōmei-mon (承明門) to the south, the Nikka-mon (日華門) and the
# Gekka-mon (月華門) to the east and west (Imperial Household Agency; OpenStreetMap)
GOSHO_KAIRO = ("w554905823", "w554905831")
GOSHO_SHU_GATES = ("承明門", "日華門", "月華門")
SHU = dict(BARK, post="shu", lattice="renji")
# the palace gates' stone platforms: a low step that the paths mapped through them (OpenStreetMap's building passages)
# step up onto and walk across (issue #127)
GOSHO_KIDAN = 0.3

BENT_FILL = 0.85   # a building filling less of its rectangle than this has a roof on its own outline (archkit.outline_roof)


APRON_M = 3.5   # how far round a hall's outline its court is laid over the photograph (m), at the least
APRON_PER_M = 0.3   # and for a tall hall, this much a metre of its height: its shadow on the photograph is longer


def W_of(sd):
    return ak.oriented(sd["ring"])[4]


def L_of(sd):
    return ak.oriented(sd["ring"])[3]


# the wide forecourts (#218), each the hull of the buildings that frame it: Higashi Honganji's and Nishi
# Hongwanji's courts between their gates and their halls, and Nijo's outer court from the Higashi-Otemon
# to the Karamon. Gravel, laid over the photograph's trees' shadows; the aprons round the halls stay granite
FORECOURTS = [("w99130389", "w560097459", "w1241560765", "w99130358"), ("w99182315", "w99182202", "w372432409", "w99182450"),
              ("w99019130", "w99019140")]


def forecourts(K, solids, mat="court_gravel"):
    from shapely.geometry import MultiPoint, Polygon as Poly
    from shapely.ops import unary_union
    import kyotokit
    fp = lambda sd: Poly(sd["ring"], sd["holes"]).buffer(0)
    heights = {oid: ridge for oid, ridge, _ in TEMPLE_HALLS}
    for ids in FORECOURTS:
        got = [sd for sd in solids if sd["osm"] in ids and sd["base"] <= 0]
        if len({sd["osm"] for sd in got}) < 2:
            continue
        hull = MultiPoint([c for sd in got for c in sd["ring"]]).convex_hull.buffer(4.0)
        aprons_ = unary_union([fp(sd).buffer(max(APRON_M, APRON_PER_M * heights.get(sd["osm"], 0.0)), join_style="mitre")
                               for sd in got if sd["osm"] in heights])
        near = [sd for sd in solids if sd["base"] <= 0 and fp(sd).intersects(hull)]
        court = hull.difference(aprons_.buffer(-0.05) if not aprons_.is_empty else aprons_).difference(unary_union([fp(sd).buffer(0.05) for sd in near]))
        kyotokit.drape(K[mat], court, kyotokit.game_ground("kyoto"), lift=0.04, cell=5.0)


def aprons(K, solids, T, around, mat, heights=None):
    """The court round each hall in `around`, APRON_M out from its outline, laid in `mat` a little over the
    ground (#187): the aerial photograph has each hall's shadow and the lean of its eaves on the ground
    beside it, and strips of water too small to draw (city.json water.min_area_m2) along the platforms, a
    blue band where the drawn pavement stops short of the wall. Not where another building stands."""
    import shapely
    from shapely.geometry import Polygon as Poly
    from shapely.ops import unary_union
    if not around:
        return
    fp = lambda sd: Poly(sd["ring"], sd["holes"]).buffer(0)
    heights = heights or {}
    ring = unary_union([fp(sd).buffer(max(APRON_M, APRON_PER_M * heights.get(sd["osm"], 0.0)), join_style="mitre") for sd in around])
    near = [sd for sd in solids if sd["base"] <= 0 and fp(sd).intersects(ring)]
    mine = {sd["si"] for sd in around}
    # (under a hall's own outline's edge too: its stone platform stands inside the outline, which is traced
    # at the eaves, and the photograph shows between them)
    court = ring.difference(unary_union([fp(sd).buffer(-2.0 if sd["si"] in mine else 0.05) for sd in near]))
    import kyotokit
    kyotokit.drape(K[mat], court, kyotokit.game_ground("kyoto"), lift=0.05, cell=4.0)   # on the ground the game draws


def temples_and_palaces():
    import json
    import os
    from shapely.geometry import LineString, Point, Polygon
    import shapely
    import cityctx
    C = cityctx.City("kyoto")
    T = ak.Terrain("kyoto")
    osm = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "castles_osm.json")))
    loc = lambda pts: [C.fwd.transform(lon, lat) for lon, lat in pts]
    solids = ak.load_solids("kyoto")
    by = {}
    for sd in solids:
        by.setdefault(sd["osm"], []).append(sd)
    K = ak.Kit("kyoto_jp", floodlit={"jp_wall", "jp_bracket", "jp_gold"}, uv={"kawara", "hiwada", "jp_base", "ishigaki", "court_flags"})
    hidden = []

    def bent(sd):
        """An outline far enough from its rectangle that a roof over the rectangle would hang over empty
        ground (a corridor that turns, an L, a ring round a court, a hall with a wing or a stepped side):
        under 85% of its rectangle (#185; it was 60%, which left the palaces' winged halls, the Gosho's
        Otsunegoten and the Empress's, under one box of a roof)."""
        cx, cy, ax, L, W = ak.oriented(sd["ring"])
        return bool(sd["holes"]) or abs(ak.ring_area(sd["ring"])) < BENT_FILL * L * W

    def along_outline(sd, mats):
        """A building drawn on its own outline: a stone footing, white walls, and an outline roof whose eaves
        follow every turn, as wide as the building's mean width (2 area / perimeter) allows."""
        from shapely.geometry import Polygon as Pg
        P_ = Pg(sd["ring"], sd["holes"]).buffer(0)
        w = 2 * P_.area / max(P_.length, 1.0)
        g = sd["ground"]
        eave = g + float(np.clip(2.6 + 0.35 * w, 3.2, 6.5))
        for poly in getattr(P_, "geoms", [P_]):
            rings = [ak.simplify(list(poly.exterior.coords), 0.4)] + [ak.simplify(list(h.coords), 0.4) for h in poly.interiors]
            for r in rings:
                ak.prism(K[mats["base"]], ak.WORLD, r, g - 0.5, g + 0.5, top=False)
                ak.prism(K[mats["wall"]], ak.WORLD, r, g + 0.5, eave - 0.25, top=False)
            over = float(np.clip(0.25 * w + 0.6, 0.8, 1.8))
            ak.outline_roof(K[mats["roof"]], rings[0], eave, 0.6, over=over, rise_max=float(np.clip(0.3 * (w + 2 * over), 1.2, 6.0)), k=1.3,
                            holes=rings[1:], soffit=K[mats["bracket"]], wall_z=eave - 0.25, cell=1.5)
        hidden.append(sd["si"])

    def draw(sd, ridge, kind, mats):
        cx, cy, ax, L, W = ak.oriented(sd["ring"])
        P = ak.Frame(cx, cy, ax, sd["ground"])
        if kind == "gate" and sd["osm"] in GATE_LEVELS_OF:
            top = gate_levels(sd)[2]
            ak.gate(K, P, L, W, ridge, mats, storeys=2, base_h=top - sd["ground"], foot=0.6)
        elif kind == "gate":
            ak.gate(K, P, L, W, ridge, mats, storeys=2 if ridge > 15 else 1)
        else:
            ak.hall(K, P, L, W, ridge, mats, eave_frac=0.36 if kind == "founders" else 0.42, mokoshi=kind == "founders")
        hidden.append(sd["si"])

    for oid, ridge, kind in TEMPLE_HALLS:
        for sd in by.get(oid, []):
            if abs(ak.ring_area(sd["ring"])) > 50:
                draw(sd, ridge, kind, TILE)
    # Nijo Castle: every building inside its outline is a palace hall, a turret or a gate
    castle = Polygon(loc(osm["nijo"]["outline"]))
    named = {r["name"]: Polygon(loc(r["pts"])) for r in osm["nijo"]["gates"] + osm["nijo"]["turrets"] if len(r["pts"]) > 3}
    halls = [sd for sd in solids if sd["base"] <= 0 and castle.contains(Point(*ak.ring_centroid(sd["ring"]))) and abs(ak.ring_area(sd["ring"])) >= 40]
    for sd in halls:
        cx, cy, ax, L, W = ak.oriented(sd["ring"])
        which = next((n for n, pg in named.items() if pg.buffer(3).contains(Point(cx, cy))), None)
        if which and "櫓" in which and "門" not in which:  # a corner turret: two storeys
            P = ak.Frame(cx, cy, ax, sd["ground"])
            ak.hall(K, P, L, W, 7.5, TILE, eave_frac=0.6, base_h=0.3, over=1.4)
            Q = ak.Frame(cx, cy, ax, sd["ground"] + 6.6)
            ak.hall(K, Q, L * 0.7, W * 0.7, 6.0, TILE, eave_frac=0.45, base_h=0.0, over=1.2)
        elif which and "門" in which:
            ridge = 14.0 if which in ("東大手門", "北大手門") else 10.5 if which == "唐門" else 8.5
            draw(sd, ridge, "gate", BARK if which == "唐門" else TILE)
            continue
        elif bent(sd):
            along_outline(sd, TILE)
            continue
        elif not sd["name"] and W < 7.5 and L > 1.3 * W and sum(Polygon(o["ring"]).buffer(0).distance(Polygon(sd["ring"]).buffer(0)) < 1.5
                                                               for o in halls if o is not sd) >= 2:
            # a covered way (渡廊下) between two of the palace's halls, as the Ninomaru's run from hall to hall
            ak.corridor(K, ak.Frame(cx, cy, ax, sd["ground"]), L, W, float(np.clip(3.2 + 0.5 * W, 5.0, 7.0)), dict(TILE, lattice="jp_post"))
        else:
            ridge = float(np.clip(4.5 + 0.38 * W, 7.5, 15.5))
            P = ak.Frame(cx, cy, ax, sd["ground"])
            ak.hall(K, P, L, W, ridge, TILE, eave_frac=0.4, base_h=0.7)
        hidden.append(sd["si"])
    # the ramparts: battered granite between the moat (or the lower court) and the court above, with the
    # plastered walls on them
    # (not the Horikawa's own walls, which OpenStreetMap maps as retaining walls beside the castle, ways 379568048,
    # 379748479, 379748488 and 379748501: the sunken promenade's walls draw them, inland_water.py, and a battered
    # rampart on them stood out into its floor)
    channel = horikawa_channel()
    for r in osm["nijo"]["ramparts"]:
        pts = loc(r["pts"])
        if channel is not None and LineString(pts).intersection(channel).length > 0.5 * LineString(pts).length:
            continue
        a, b = np.array(pts[0]), np.array(pts[-1])
        mid = np.mean(pts, axis=0)
        t = (b - a) / (np.linalg.norm(b - a) or 1)
        n = np.array([t[1], -t[0]])
        zr, zl = T(*(mid + n * 8)), T(*(mid - n * 8))
        low = 1 if zr < zl else -1
        top, foot = max(zr, zl) + 1.0, min(zr, zl) - 2.5
        ak.ishigaki_line(K["ishigaki"], ak.WORLD, pts, top, foot, low, batter=0.3)
    for r in osm["nijo"]["walls"]:
        pts = loc(r["pts"])
        z = min(T(*p) for p in pts)
        ak.dobei(K, ak.WORLD, pts, z, 2.6, mats=("gable_white", "kawara", "kawara_ridge"))  # unlit at night
    for r in osm["nijo"]["keep_base"]:
        ring = loc(r["pts"])[:-1] if r["pts"][0] == r["pts"][-1] else loc(r["pts"])
        z = min(T(*p) for p in ring)
        ak.ishigaki(K["ishigaki"], ak.WORLD, ring, z - 1.0, z + 7.0, batter=0.18)
    # the Imperial Palace: the halls under cypress bark, the gates, the plastered walls (築地塀)
    gosho = Polygon(loc(osm["gosho"]["outline"]))
    in_gosho = [sd for sd in solids if gosho.buffer(4).contains(Point(*ak.ring_centroid(sd["ring"]))) and abs(ak.ring_area(sd["ring"])) >= 30]
    grounded = {sd["osm"] for sd in in_gosho if sd["base"] <= 0 and sd["osm"]}
    court = shapely.union_all([Polygon(sd["ring"]).buffer(0) for sd in in_gosho if sd["osm"] in GOSHO_KAIRO]).convex_hull

    def gate_frame(sd, cx, cy, ax, L, W):
        """A gate's long side runs along the wall it stands in: the palace's outer wall for the gates in it, else
        across the way out of the south court for the gates in its corridors. So the way mapped through it
        (OpenStreetMap's building passage) crosses its open middle bay; the outline of a near-square gate (its
        roof's, over the eaves) leaves which side is long to that. (frame, L, W)"""
        if L < 1.3 * W:
            a = math.radians(ax)
            if gosho.exterior.distance(Point(cx, cy)) < 15.0:  # in the outer wall: along its nearest stretch
                q = gosho.exterior.project(Point(cx, cy))
                p0, p1 = gosho.exterior.interpolate(max(0.0, q - 3.0)), gosho.exterior.interpolate(q + 3.0)
                tx, ty = p1.x - p0.x, p1.y - p0.y
                turn = abs(math.cos(a) * tx + math.sin(a) * ty) < abs(-math.sin(a) * tx + math.cos(a) * ty)
            else:  # in the court's corridors: across the way from the court's middle
                c = court.centroid
                ox, oy = cx - c.x, cy - c.y
                turn = abs(math.cos(a) * ox + math.sin(a) * oy) > abs(-math.sin(a) * ox + math.cos(a) * oy)
            if turn:
                ax, L, W = ax + 90.0, W, L
        return ak.Frame(cx, cy, ax, T(cx, cy)), L, W

    for sd in in_gosho:
        # a building's upper parts (a gate's roof, mapped as a part over its posts) go with it; a gate mapped
        # only by its upper part is drawn from the ground
        if sd["base"] > 0 and not (sd["osm"] and sd["osm"] not in grounded and sd["name"].endswith("門")):
            continue
        cx, cy, ax, L, W = ak.oriented(sd["ring"])
        P = ak.Frame(cx, cy, ax, sd["ground"])
        if W < 4.5 and L > 12:  # a wall
            u = ak.Frame(cx, cy, ax, 0)
            ak.dobei(K, ak.WORLD, [u(-L / 2, 0, 0)[:2], u(L / 2, 0, 0)[:2]], sd["ground"], min(5.0, sd["top"]) - 0.6,
                     mats=("gable_white", "hiwada", "hiwada_ridge"))
        elif sd["osm"] != SHISHINDEN and bent(sd):
            along_outline(sd, BARK)
            continue
        elif sd["osm"] in GOSHO_KAIRO:
            ak.corridor(K, P, L, W, 6.4, SHU)
        elif sd["name"] in GOSHO_SHU_GATES:
            ak.gate(K, *gate_frame(sd, cx, cy, ax, L, W), 10.0 if sd["name"] == "承明門" else 8.0, SHU, storeys=1, base_h=GOSHO_KIDAN, foot=0.6)
        elif sd["name"].endswith("門"):  # the outer gates, the Kenrei-mon (建礼門) first: plain cypress, open bays
            ak.gate(K, *gate_frame(sd, cx, cy, ax, L, W), 8.5 if sd["name"] == "建礼門" else 7.5, BARK, storeys=1, base_h=GOSHO_KIDAN, foot=0.6)
        elif sd["osm"] == SHISHINDEN:
            ak.hall(K, P, L, W, 20.5, BARK, eave_frac=0.42, base_h=1.6, over=3.4)
        else:
            ak.hall(K, P, L, W, float(np.clip(4.0 + 0.36 * W, 6.5, 14.5)), BARK, eave_frac=0.42, base_h=0.8)
        hidden.append(sd["si"])
    aprons(K, solids, T, [sd for sd in solids for oid, _, _ in TEMPLE_HALLS if sd["osm"] == oid], "court_flags",
           {oid: ridge for oid, ridge, _ in TEMPLE_HALLS})
    forecourts(K, solids)
    aprons(K, solids, T, halls + [sd for sd in in_gosho if sd["base"] <= 0 and not (W_of(sd) < 4.5 and L_of(sd) > 12)], "court_gravel")
    # every part of a building drawn here goes with it (the parts mapped over a gate's posts, a hall's roof)
    drawn = {sd["osm"] for sd in solids if sd["si"] in set(hidden) and sd["osm"]}
    hidden += [sd["si"] for sd in solids if sd["osm"] in drawn]
    return K.out() + approach_steps(solids) + moat_meshes()[0], sorted(set(hidden))


def moat_shapes():
    """Higashi Honganji's moat in the local frame: (the water less the bridges, the bridges' rectangles, the
    moat, and the decks' reach past it: MOAT_DECK_EAST)."""
    import cityctx
    import shapely
    from shapely.geometry import LineString, Polygon
    C = cityctx.City("kyoto")
    loc = lambda pts: [C.fwd.transform(lon, lat) for lon, lat in pts]
    moat = Polygon(loc(MOAT_RING)).buffer(0)
    decks, ext = [], []
    for way, line, width in MOAT_BRIDGES:
        a, b = (np.array(p) for p in loc(line))
        t = (b - a) / np.linalg.norm(b - a)
        n = np.array([-t[1], t[0]])
        if n[1] < 0:
            n = -n  # (to the north, or the west of a bridge running north-south)
        mid = (a + b) / 2 + n * MOAT_BRIDGE_SHIFT.get(way, 0.0)
        half_w, half_l = (width or MOAT_BRIDGE_M) / 2, np.linalg.norm(b - a) / 2 + 2.0
        decks.append(Polygon([mid - t * half_l - n * half_w, mid + t * half_l - n * half_w,
                              mid + t * half_l + n * half_w, mid - t * half_l + n * half_w]))
        east = MOAT_DECK_EAST.get(way)
        if east:  # (the deck's own reach: the rectangle on east past the moat)
            e = a if a[0] > b[0] else b
            ext.append(Polygon([mid - n * half_w, e + t * np.sign(np.dot(e - mid, t)) * east + (mid - (a + b) / 2) - n * half_w,
                                e + t * np.sign(np.dot(e - mid, t)) * east + (mid - (a + b) / 2) + n * half_w, mid + n * half_w]).buffer(0))
    water = moat.difference(shapely.union_all(decks))
    return [q for q in getattr(water, "geoms", [water]) if q.area > 1.0], decks, moat, ext


def moat_meshes():
    """The moat: its water MOAT_DROP_M below the pavement, its granite sides down to it (the bridges'
    faces among them), the coping along its banks and the bridges' parapets; and the clip regions,
    where the ground is not drawn (world.js "clip")."""
    from shapely.geometry import Point
    T = ak.Terrain("kyoto")
    pieces, decks, moat, ext = moat_shapes()
    water, side = Mesh("kyoto_moat_water", "moat_water", False), Mesh("kyoto_moat_sides", "moat_stone", False, uv=True)
    coping = Mesh("kyoto_moat_coping", "moat_coping", False)
    cw, ch = MOAT_COPING
    import shapely
    for q in pieces:
        for t in shapely.constrained_delaunay_triangles(q.segmentize(4.0)).geoms:
            cs = np.asarray(t.exterior.coords)[:3]
            (ax, ay), (bx, by) = cs[1] - cs[0], cs[2] - cs[0]
            if ax * by - ay * bx < 0:
                cs = cs[::-1]
            water.tri(*[np.array([x, y, T(x, y) - MOAT_DROP_M]) for x, y in cs])
        ring = np.asarray(q.exterior.segmentize(2.0).coords)
        if not q.exterior.is_ccw:
            ring = ring[::-1]
        run = 0.0
        for a, b in zip(ring, ring[1:]):
            L = float(np.linalg.norm(b - a))
            if L < 1e-3:
                continue
            za, zb = T(*a), T(*b)
            # (anticlockwise: the water on the left, so the face looks in at it from the right)
            side.quad(np.array([*b, zb - MOAT_DROP_M - 0.3]), np.array([*a, za - MOAT_DROP_M - 0.3]), np.array([*a, za]), np.array([*b, zb]),
                      [[run + L, -MOAT_DROP_M - 0.3], [run, -MOAT_DROP_M - 0.3], [run, 0.0], [run + L, 0.0]])
            run += L
            mid = (a + b) / 2
            o = np.array([(b - a)[1], -(b - a)[0]]) / L  # out of the water, onto the bank or the bridge
            on_bridge = any(d.buffer(0.05).contains(Point(*(mid + o * 0.4))) for d in decks)
            h = 0.55 if on_bridge else ch  # a bridge's parapet, or the bank's coping
            coping.box(np.array([*(a + o * cw / 2), za + h / 2]), np.array([*(b + o * cw / 2), zb + h / 2]), cw, h)
    # the bridges' decks: granite flags across the moat and its coping, a little over the ground
    deck = Mesh("kyoto_moat_decks", "moat_deck", False, uv=True)
    for d in decks + ext:
        g = d.intersection(moat.buffer(cw + 0.4, join_style="mitre")) if d in decks else d.difference(moat.buffer(cw + 0.4, join_style="mitre"))
        for q in getattr(g, "geoms", [g]):
            if q.geom_type != "Polygon" or q.area < 1.0:
                continue
            for t in shapely.constrained_delaunay_triangles(q.segmentize(2.0)).geoms:
                cs = np.asarray(t.exterior.coords)[:3]
                (ax, ay), (bx, by) = cs[1] - cs[0], cs[2] - cs[0]
                if ax * by - ay * bx < 0:
                    cs = cs[::-1]
                deck.tri(*[np.array([x, y, T(x, y) + 0.03]) for x, y in cs], [[x, y] for x, y in cs])
    # the flags along the outer bank (the street's side, away from the temple), out to the pavement: over the
    # photograph's strip of shade there, which the drawn pavement does not reach
    from shapely.geometry import Polygon as Poly
    temple = np.array(MOAT_TEMPLE_XY)
    strips = []
    for q in pieces:
        ring = np.asarray(q.exterior.segmentize(2.0).coords)
        for a, b in zip(ring, ring[1:]):
            L = float(np.linalg.norm(b - a))
            if L < 1e-3:
                continue
            o = np.array([(b - a)[1], -(b - a)[0]]) / L
            mid = (a + b) / 2
            if Point(*(mid + o * 0.3)).within(q):
                o = -o  # (out of the water)
            if np.linalg.norm(mid + o * 2.0 - temple) < np.linalg.norm(mid - temple):
                continue  # the temple's side
            strips.append(Poly([a + o * cw, b + o * cw, b + o * (cw + MOAT_WALK_M), a + o * (cw + MOAT_WALK_M)]).buffer(0.05, join_style="mitre"))
    walk_g = shapely.union_all(strips).difference(moat.buffer(cw, join_style="mitre")).difference(shapely.union_all(decks + ext).buffer(0.01)) if strips else None
    for q in (getattr(walk_g, "geoms", [walk_g]) if walk_g is not None else []):
        if q.geom_type != "Polygon" or q.area < 0.5:
            continue
        for t in shapely.constrained_delaunay_triangles(q.segmentize(2.0)).geoms:
            cs = np.asarray(t.exterior.coords)[:3]
            (ax, ay), (bx, by) = cs[1] - cs[0], cs[2] - cs[0]
            if ax * by - ay * bx < 0:
                cs = cs[::-1]
            deck.tri(*[np.array([x, y, T(x, y) + 0.03]) for x, y in cs], [[x, y] for x, y in cs])
    clip = [{"ring": [[round(x, 2), round(y, 2)] for x, y in q.exterior.coords[:-1]]} for q in pieces]
    return [m for m in (water, side, coping, deck) if m.v], clip


def keep_off(scene=None):
    """Where walkers keep off (game.json "keep_off", rings in decimetres): the moat's water less its
    bridges, out over the coping by a walker's half-width."""
    pieces = moat_shapes()[0]
    out = []
    for q in pieces:
        g = q.buffer(KEEP_OFF_PAD_M + MOAT_COPING[0] / 2, join_style="mitre")
        for p in getattr(g, "geoms", [g]):
            out.append([round(v * 10) for xy_ in p.simplify(0.1).exterior.coords[:-1] for v in xy_])
    return out


def gosho_court_strays():
    """Solids in the court before the Shishinden (南庭), which is bare gravel between its corridors but for the
    cherry and the mandarin orange: a block with a guessed height there is not."""
    import json
    import os
    from shapely.geometry import Point, Polygon
    import shapely
    solids = ak.load_solids("kyoto")
    pieces = [Polygon(sd["ring"]) for sd in solids if sd["osm"] in GOSHO_KAIRO + (SHISHINDEN,) and abs(ak.ring_area(sd["ring"])) > 100]
    if not pieces:
        return []
    court = shapely.union_all(pieces).convex_hull.difference(shapely.union_all(pieces).buffer(1.0))
    B = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "web", "data", "kyoto", "buildings.json")))
    return [sd["si"] for sd in solids if court.contains(Point(*ak.ring_centroid(sd["ring"]))) and not sd["osm"]
            and B["b"][B["s"][sd["si"]][0]][4] in ("estimate", "ml")]


def landmark_demolished(scene):
    """And the PLATEAU solids over the Shinkansen's platforms (cities/kyoto/rail.py)."""
    return gosho_court_strays() + RAIL.demolished()


def landmark_treeless(scene):
    """The Shinkansen's viaduct (cities/kyoto/rail.py)."""
    return RAIL.treeless()


def landmark_glows(scene):
    """Kyoto Station's platforms' light (cities/kyoto/rail.py)."""
    return RAIL.glows()


def landmark_assets(out_dir, scene):
    """The station's signs (cities/kyoto/rail.py)."""
    return RAIL.assets(out_dir)



# ---------------------------------------------------------------- the front steps, and the game

# (OSM id, name, kind): the halls and the gate visitors walk into, all facing east onto Karasuma-dori and
# Horikawa-dori. Their front steps are drawn (approach_steps) and walked as strips (game_surfaces): the
# mapped outlines, which stay in the collisions, run out to the eaves' drip line, beyond the platforms
FRONTS = [("w1241560765", "Higashi Honganji, the Founder's Hall Gate 御影堂門", "gate"),
          ("w99130389", "Higashi Honganji, the Founder's Hall 御影堂", "founders"),
          ("w99182315", "Nishi Hongwanji, the Founder's Hall 御影堂", "founders")]
RISE, TREAD = 0.2, 0.32
GATE_LEVELS_OF = {"w1241560765"}   # the gates whose platform is set on the paving round them (gate_levels)
KIDAN = 0.4                        # the gate's stone platform stands this far above the highest ground under it
_terrain = []


def gate_levels(sd):
    """A gate's levels on the ground round it: (the paving in front, east; the paving behind, west; the
    top of its stone platform). The built city's ground under the gate (sd["ground"]) lies below the
    bare-earth terrain the viewer draws, which bulges up to 1 m over the footprint, so a platform set
    on sd["ground"] is buried; the platform is set KIDAN above the highest terrain under it instead,
    and the steps run down to the paving measured 1.5 m outside each long side."""
    if not _terrain:
        _terrain.append(ak.Terrain("kyoto"))
    T = _terrain[0]
    cx, cy, ax, L, W = ak.oriented(sd["ring"])
    P = ak.Frame(cx, cy, ax, 0.0)
    sgn = 1 if P(0, 1, 0)[0] > P(0, -1, 0)[0] else -1
    us = np.linspace(-L / 2 + 2, L / 2 - 2, 9)
    inside = max(T(*P(u, v, 0)[:2]) for u in np.linspace(-L / 2, L / 2, 13) for v in np.linspace(-W / 2, W / 2, 11))
    side = lambda s: round(float(np.median([T(*P(u, s * (W / 2 + 1.5), 0)[:2]) for u in us])), 2)
    return side(sgn), side(-sgn), round(inside + KIDAN, 2)


def approaches(solids):
    """For each of FRONTS on the built city's footprints: the strip a walker takes from the paving outside
    its outline up the front steps, onto the platform as far as the doors (a hall) or through the middle
    bay and down the far side (a gate), in a frame whose u runs inward from the platform's front edge.
    [{name, kind, origin, axis, half_width, profile, z0, edge, wall, depth}]"""
    by = {sd["osm"]: sd for sd in solids if abs(ak.ring_area(sd["ring"])) > 50}
    out = []
    for oid, name, kind in FRONTS:
        sd = by.get(oid)
        if not sd:
            continue
        cx, cy, ax, L, W = ak.oriented(sd["ring"])
        P = ak.Frame(cx, cy, ax, sd["ground"])
        sgn = 1 if P(0, 1, 0)[0] > P(0, -1, 0)[0] else -1          # the side of the frame towards the east
        z0 = sd["ground"]
        if kind == "gate":                                           # gate(): the platform is the outline
            edge, wall, hw = W / 2, None, 2.2
            if oid in GATE_LEVELS_OF:
                z0, z_back, top = gate_levels(sd)
                base_h = top - z0
            else:
                base_h, z_back = 0.8, z0
        else:                                                        # hall(): the platform 1.2 m out from the walls
            over = max(1.6, 0.11 * W)
            wall = W / 2 - over * 0.55
            edge, base_h, hw = wall + 1.2, 1.0, 3.0
        front = np.array(P(0, sgn * edge, 0)[:2])
        inward = np.array(P(0, 0, 0)[:2]) - front
        inward /= np.linalg.norm(inward)
        n = max(2, int(round(base_h / RISE)))
        rise = base_h / n
        prof = [[-(W / 2 - edge) - 2.5, z0], [round(-n * TREAD - 0.02, 3), z0]]   # the paving from outside the outline
        for j in range(n):
            a = -(n - j) * TREAD
            prof += [[round(a + (0.02 if j else 0), 3), round(z0 + (j + 1) * rise, 3)], [round(a + TREAD, 3), round(z0 + (j + 1) * rise, 3)]]
        nb, rb = n, rise
        if kind == "gate":                                           # across the platform and down the far side
            top = z0 + base_h
            nb = max(2, int(round((top - z_back) / RISE)))
            rb = (top - z_back) / nb
            prof.append([round(W - 0.02, 3), round(top, 3)])
            for j in range(nb):
                a = W + j * TREAD
                prof += [[round(a + 0.02, 3), round(top - (j + 1) * rb, 3)], [round(a + TREAD, 3), round(top - (j + 1) * rb, 3)]]
            prof.append([round(W + nb * TREAD + 2.5, 3), round(z_back, 3)])
        else:
            prof.append([1.2, round(z0 + base_h, 3)])                # the platform, to the doors
        out.append({"name": name, "kind": kind, "origin": [float(front[0]), float(front[1])], "axis": [float(inward[0]), float(inward[1])],
                    "half_width": hw, "profile": prof, "z0": z0, "base_h": base_h, "depth": W,
                    "steps": (n, rise, nb, rb)})
    return out


def approach_steps(solids):
    """The front steps in granite, under each strip's treads (approaches)."""
    m = Mesh("kyoto_steps", "jp_base", False, uv=True)
    for a in approaches(solids):
        ang = math.degrees(math.atan2(a["axis"][1], a["axis"][0]))
        F = ak.Frame(a["origin"][0], a["origin"][1], ang, 0.0)
        z0, hw = a["z0"], a["half_width"] + 0.3
        n, rise, nb, rb = a["steps"]
        for j in range(n):
            ak.block(m, F, -(n - j) * TREAD, 0.0, -hw, hw, z0 - 0.3, z0 + (j + 1) * rise)
        if a["kind"] == "gate":
            top = z0 + a["base_h"]
            for j in range(nb):
                ak.block(m, F, a["depth"], a["depth"] + (nb - j) * TREAD, -hw, hw, top - nb * rb - 0.3, top - (nb - 1 - j) * rb)
    return [m] if m.i else []


def game_surfaces(scene):
    """The front steps of the gate and the founders' halls (approaches), walked as strips."""
    return [{"name": a["name"] + ", the steps", "type": "strip", "origin": [round(v, 2) for v in a["origin"]], "axis": [round(v, 5) for v in a["axis"]],
             "half_width": a["half_width"], "profile": a["profile"], "thickness": 1.2, "mesh": "kyoto_steps", "label": a["name"]}
            for a in approaches(ak.load_solids("kyoto"))] + RAIL.surfaces()


def xy(p):
    return [round(float(p[0]), 2), round(float(p[1]), 2)]


def close_to(name, at, z, start, within=1.5, keep=0.0):
    """A thing to walk up to (game.json "close"): `at` on it at the floor's height z, the walk starting at
    `start`; the walker must get within `within` m and never nearer than `keep`."""
    return {"name": name, "at": [*xy(at), round(float(z), 2)], "from": xy(start), "within": within, **({"keep": keep} if keep else {})}


def game_extras(scene):
    """The things people walk up to: Kyoto Tower's doors on Shiokoji-dori and Karasuma-dori; through
    Higashi Honganji's Founder's Hall Gate and up to the doors of the two founders' halls."""
    close = []
    solids = ak.load_solids("kyoto")
    t = scene["landmarks"].get("kyoto_tower")
    hotel = next((sd for sd in solids if sd["name"] == "京都タワーホテル"), None)
    if t and hotel:
        cx, cy, ax, L, W = ak.oriented(hotel["ring"])      # the block's rectangle is square to the compass
        z, (x, y) = hotel["ground"], t["at"]
        south, east = cy - W / 2, cx + L / 2
        close.append(close_to("Kyoto Tower, its doors on Shiokoji-dori", (x, south), z, (x, south - 5.0), 1.2))
        close.append(close_to("Kyoto Tower Building on Karasuma-dori", (east, y), z, (east + 5.0, y), 1.2))
    for a in approaches(solids):
        o, d = np.array(a["origin"]), np.array(a["axis"])
        start = o + d * (a["profile"][0][0] - 3.0)
        if a["kind"] == "gate":    # through the middle bay, to the gate's centre line
            close.append(close_to(a["name"] + ", through it", o + d * a["depth"] / 2, a["z0"] + a["base_h"], start, 1.0))
        else:                      # up the steps to the doors
            close.append(close_to(a["name"] + ", up to its doors", o + d * 1.2, a["z0"] + a["base_h"], start, 1.0))
    tr = RAIL.trains()   # the Shinkansen and the JR lines through Kyoto Station (cities/kyoto/rail.py)
    return {"close": close, "keep_off": keep_off(), **({"trains": tr, "travel": RAIL.travel()} if tr else {})}
