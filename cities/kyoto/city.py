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
  Imperial Palace   the Hall for State Ceremonies (紫宸殿), 20.5 m to its ridge under cypress bark, and the
                    halls, gates and walls inside the palace's outline.
  Kyoto Tower  131 m to the spire, observation deck at 100 m, a stressed-skin steel tube
               (no inner frame) completed in 1964. Published figures are the two heights;
               the radii and the deck's shape are an approximation, not survey data.
"""
import math

import numpy as np

import archkit as ak
from meshkit import Mesh

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
    "jp_gold": {"color": "#d6a93a", "roughness": 0.3, "metalness": 0.85, "emissive": "#ffc94a", "glow": 0.5},
    # Higashi Honganji's moat (honganji_moat): its still water, its granite sides and their coping; none of
    # them solid (the 2 m cells would fill the pavement beside it): walkers keep off it by game.json "keep_off"
    "moat_water": {"color": "#24312c", "roughness": 0.06, "metalness": 0.35, "solid": False},
    "moat_stone": {"color": "#878176", "roughness": 0.95, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.4, "block_m": 0.9, "solid": False},
    "moat_coping": {"color": "#a39d92", "roughness": 0.9, "metalness": 0.0, "solid": False},
    # the bridges' granite decks, laid over the photograph (which has the gate's shadow across the one before it)
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
    return mats, [shaft, deck, cone, mast] + more, {"hidden": hidden, "clip": moat_meshes()[1]}


# ---------------------------------------------------------------- temples, the castle and the palace

TILE = {"base": "jp_base", "post": "jp_post", "wall": "jp_wall", "bracket": "jp_bracket", "roof": "kawara", "ridge": "kawara_ridge", "gable": "gable_white"}
BARK = dict(TILE, roof="hiwada", ridge="hiwada_ridge")
# (OSM id, ridge m, kind): the halls drawn at Higashi Honganji and Nishi Hongwanji
TEMPLE_HALLS = [("w99130389", 38.0, "founders"), ("w560097459", 29.0, "hall"), ("w1241560765", 27.3, "gate"), ("w1241560768", 18.9, "hall"),
                ("w99182315", 29.0, "founders"), ("w99182202", 25.0, "founders"), ("w372433543", 17.7, "hall"), ("w372433070", 16.2, "hall")]
SHISHINDEN = "w554905814"


def temples_and_palaces():
    import json
    import os
    from shapely.geometry import Point, Polygon
    import cityctx
    C = cityctx.City("kyoto")
    T = ak.Terrain("kyoto")
    osm = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "castles_osm.json")))
    loc = lambda pts: [C.fwd.transform(lon, lat) for lon, lat in pts]
    solids = ak.load_solids("kyoto")
    by = {}
    for sd in solids:
        by.setdefault(sd["osm"], []).append(sd)
    K = ak.Kit("kyoto_jp", floodlit={"jp_wall", "jp_bracket", "jp_gold"}, uv={"kawara", "hiwada", "jp_base", "ishigaki"})
    hidden = []

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
    for sd in solids:
        if sd["base"] > 0 or not castle.contains(Point(*ak.ring_centroid(sd["ring"]))) or abs(ak.ring_area(sd["ring"])) < 40:
            continue
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
        else:
            ridge = float(np.clip(4.5 + 0.38 * W, 7.5, 15.5))
            P = ak.Frame(cx, cy, ax, sd["ground"])
            ak.hall(K, P, L, W, ridge, TILE, eave_frac=0.4, base_h=0.7)
        hidden.append(sd["si"])
    # the ramparts: battered granite between the moat (or the lower court) and the court above, with the
    # plastered walls on them
    for r in osm["nijo"]["ramparts"]:
        pts = loc(r["pts"])
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
    for sd in solids:
        if sd["base"] > 0 or not gosho.buffer(4).contains(Point(*ak.ring_centroid(sd["ring"]))) or abs(ak.ring_area(sd["ring"])) < 30:
            continue
        cx, cy, ax, L, W = ak.oriented(sd["ring"])
        P = ak.Frame(cx, cy, ax, sd["ground"])
        if W < 4.5 and L > 12:  # a wall
            u = ak.Frame(cx, cy, ax, 0)
            ak.dobei(K, ak.WORLD, [u(-L / 2, 0, 0)[:2], u(L / 2, 0, 0)[:2]], sd["ground"], min(5.0, sd["top"]) - 0.6,
                     mats=("gable_white", "hiwada", "hiwada_ridge"))
        elif sd["osm"] == SHISHINDEN:
            ak.hall(K, P, L, W, 20.5, BARK, eave_frac=0.42, base_h=1.6, over=3.4)
        else:
            ak.hall(K, P, L, W, float(np.clip(4.0 + 0.36 * W, 6.5, 14.5)), BARK, eave_frac=0.42, base_h=0.8)
        hidden.append(sd["si"])
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
            for a in approaches(ak.load_solids("kyoto"))]


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
    return {"close": close, "keep_off": keep_off()}
