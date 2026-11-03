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
    "shu": {"color": "#b5452f", "roughness": 0.7, "metalness": 0.0, "emissive": "#ffc9a8", "glow": 0.2},   # vermilion lacquer
    "renji": {"color": "#3e6b56", "roughness": 0.75, "metalness": 0.0},  # the corridors' green lattice
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
# the south court before the Shishinden (南庭): its corridors (回廊), vermilion pillars and green lattice in a white
# wall under cypress bark, and its vermilion gates, the Jōmei-mon (承明門) to the south, the Nikka-mon (日華門) and the
# Gekka-mon (月華門) to the east and west (Imperial Household Agency; OpenStreetMap)
GOSHO_KAIRO = ("w554905823", "w554905831")
GOSHO_SHU_GATES = ("承明門", "日華門", "月華門")
SHU = dict(BARK, post="shu", lattice="renji")


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

    def bent(sd):
        """An outline far from its rectangle (a corridor that turns, an L, a ring round a court)."""
        cx, cy, ax, L, W = ak.oriented(sd["ring"])
        return bool(sd["holes"]) or abs(ak.ring_area(sd["ring"])) < 0.6 * L * W

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
    in_gosho = [sd for sd in solids if gosho.buffer(4).contains(Point(*ak.ring_centroid(sd["ring"]))) and abs(ak.ring_area(sd["ring"])) >= 30]
    grounded = {sd["osm"] for sd in in_gosho if sd["base"] <= 0 and sd["osm"]}
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
            ak.gate(K, ak.Frame(cx, cy, ax, T(cx, cy)), L, W, 10.0 if sd["name"] == "承明門" else 8.0, SHU, storeys=1)
        elif sd["name"].endswith("門"):  # the outer gates, the Kenrei-mon (建礼門) first: plain cypress, open bays
            ak.gate(K, ak.Frame(cx, cy, ax, T(cx, cy)), L, W, 8.5 if sd["name"] == "建礼門" else 7.5, BARK, storeys=1)
        elif sd["osm"] == SHISHINDEN:
            ak.hall(K, P, L, W, 20.5, BARK, eave_frac=0.42, base_h=1.6, over=3.4)
        else:
            ak.hall(K, P, L, W, float(np.clip(4.0 + 0.36 * W, 6.5, 14.5)), BARK, eave_frac=0.42, base_h=0.8)
        hidden.append(sd["si"])
    # every part of a building drawn here goes with it (the parts mapped over a gate's posts, a hall's roof)
    drawn = {sd["osm"] for sd in solids if sd["si"] in set(hidden) and sd["osm"]}
    hidden += [sd["si"] for sd in solids if sd["osm"] in drawn]
    return K.out() + approach_steps(solids), sorted(set(hidden))


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
    return gosho_court_strays()



# ---------------------------------------------------------------- the front steps, and the game

# (OSM id, name, kind): the halls and the gate visitors walk into, all facing east onto Karasuma-dori and
# Horikawa-dori. Their front steps are drawn (approach_steps) and walked as strips (game_surfaces): the
# mapped outlines, which stay in the collisions, run out to the eaves' drip line, beyond the platforms
FRONTS = [("w1241560765", "Higashi Honganji, the Founder's Hall Gate 御影堂門", "gate"),
          ("w99130389", "Higashi Honganji, the Founder's Hall 御影堂", "founders"),
          ("w99182315", "Nishi Hongwanji, the Founder's Hall 御影堂", "founders")]
RISE, TREAD = 0.2, 0.32


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
        if kind == "gate":                                           # gate(): the platform is the outline, 0.8 m up
            edge, base_h, wall, hw = W / 2, 0.8, None, 2.2
        else:                                                        # hall(): the platform 1.2 m out from the walls
            over = max(1.6, 0.11 * W)
            wall = W / 2 - over * 0.55
            edge, base_h, hw = wall + 1.2, 1.0, 3.0
        front = np.array(P(0, sgn * edge, 0)[:2])
        inward = np.array(P(0, 0, 0)[:2]) - front
        inward /= np.linalg.norm(inward)
        z0, n = sd["ground"], int(round(base_h / RISE))
        prof = [[-(W / 2 - edge) - 2.5, z0], [round(-n * TREAD - 0.02, 3), z0]]   # the paving from outside the outline
        for j in range(n):
            a = -(n - j) * TREAD
            prof += [[round(a + (0.02 if j else 0), 3), round(z0 + (j + 1) * RISE, 3)], [round(a + TREAD, 3), round(z0 + (j + 1) * RISE, 3)]]
        if kind == "gate":                                           # across the platform and down the far side
            prof.append([round(W - 0.02, 3), round(z0 + base_h, 3)])
            for j in range(n):
                a = W + j * TREAD
                prof += [[round(a + 0.02, 3), round(z0 + base_h - (j + 1) * RISE, 3)], [round(a + TREAD, 3), round(z0 + base_h - (j + 1) * RISE, 3)]]
            prof.append([round(W + n * TREAD + 2.5, 3), z0])
        else:
            prof.append([1.2, round(z0 + base_h, 3)])                # the platform, to the doors
        out.append({"name": name, "kind": kind, "origin": [float(front[0]), float(front[1])], "axis": [float(inward[0]), float(inward[1])],
                    "half_width": hw, "profile": prof, "z0": z0, "base_h": base_h, "depth": W})
    return out


def approach_steps(solids):
    """The front steps in granite, under each strip's treads (approaches)."""
    m = Mesh("kyoto_steps", "jp_base", False, uv=True)
    for a in approaches(solids):
        ang = math.degrees(math.atan2(a["axis"][1], a["axis"][0]))
        F = ak.Frame(a["origin"][0], a["origin"][1], ang, 0.0)
        z0, n, hw = a["z0"], int(round(a["base_h"] / RISE)), a["half_width"] + 0.3
        for j in range(n):
            ak.block(m, F, -(n - j) * TREAD, 0.0, -hw, hw, z0 - 0.3, z0 + (j + 1) * RISE)
            if a["kind"] == "gate":
                ak.block(m, F, a["depth"], a["depth"] + (n - j) * TREAD, -hw, hw, z0 - 0.3, z0 + (j + 1) * RISE)
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
    return {"close": close}
