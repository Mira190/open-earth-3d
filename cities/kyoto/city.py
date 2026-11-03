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
    return mats, [shaft, deck, cone, mast] + more, {"hidden": hidden}


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
        if kind == "gate":
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
    return K.out(), sorted(set(hidden))
