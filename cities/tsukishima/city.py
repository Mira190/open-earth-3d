"""Tsukishima and Tsukuda, a map of Tokyo: what the generic pipeline cannot know from open data.

The model is the real district: Overture footprints at Project PLATEAU's surveyed heights on GSI's laser
bare earth, the Sumida and the canals round the islands. This file adds:

  * 月島もんじゃストリート Monja Street (西仲通り商店街): about 500 m of Nishinaka-dori, parallel to
    Kiyosumi-dori one block to the north-west, with some seventy monjayaki shops (Tsukishima Monja
    Promotion Association): their boards and blade signs (monja, okonomiyaki, teppanyaki; typical, no
    real shop's sign) and the street's gate at the station end.
  * The bridges over the water (pipeline/districtkit.py water_bridges), each on OpenStreetMap's outline or
    its centre lines, a girder deck painted in its own colour, walkable and drivable in the game.
  * 勝鬨橋 Kachidoki Bridge (1940; Important Cultural Property): 246 m, two steel tied arches of 86 m
    either side of the 44 m double-leaf bascule that last opened in 1970, and the four control houses
    on the bascule's piers (Tokyo Metropolitan Government; Kachidoki Bridge Museum).
  * 佃小橋 Tsukuda Kobashi, the small vermilion bridge over the Tsukuda moat, and the torii of
    Sumiyoshi Shrine (1646) by the river: Tsukuda's fishing village, where tsukudani was first made.

Persona 5's Tsukishima is Monja Street, where its players eat monja with friends. Nothing of the game's
art is copied.
"""
import math

import numpy as np
from shapely.geometry import LineString, Point, Polygon

import districtkit as dk
import japankit as jk
from japankit import Atlas, Kit, block, frame, lathe_at, slab_at, unit, left_of

MONJA = [(100.0, 93.0), (-266.0, -247.0)]          # Nishinaka-dori from the station end to Tsukishima 3-chome
SIGN_CLASSES = {"", "commercial", "retail", "restaurant", "mixed_use", "house", "residential", "apartments"}
KACHIDOKI = "勝鬨橋"
COLOURS = {"勝鬨橋": "#8ea8a6", "中央大橋": "#d8dde0", "佃大橋": "#6f9fb8", "相生橋": "#7aa08a", "朝潮大橋": "#c9b98a", "黎明橋": "#a8b6c0"}
WIDTHS = {"勝鬨橋": 8.0, "中央大橋": 10.0, "相生橋": 8.0, "朝潮大橋": 8.0}

MATERIALS = {
    "atlas": {"color": "#ffffff", "roughness": 0.7, "metalness": 0.0, "map": "atlas.jpg", "emissive_map": True, "glow": 1.25},
    "frame": {"color": "#26292e", "roughness": 0.5, "metalness": 0.5},
    "vermilion": {"color": "#c8402c", "roughness": 0.6, "metalness": 0.0, "emissive": "#ff7a4a", "glow": 0.4},
    "stone": {"color": "#9a968e", "roughness": 0.9, "metalness": 0.0},
    "arch_steel": {"color": "#8ea8a6", "roughness": 0.5, "metalness": 0.45},
    "house_wall": {"color": "#e8e4d8", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffe6c0", "glow": 0.35},
    "copper_dark": {"color": "#3d4a44", "roughness": 0.55, "metalness": 0.35},
    **dk.BRIDGE_MATS,
}

BLADES = [("もんじゃ", "#d4001a", "#ffffff", "zen"), ("お好み焼", "#ffd400", "#5a1a0a", "dela"), ("もんじゃ焼", "#1d1d1d", "#ffcf70", "mincho"),
          ("鉄板焼", "#3b2a1e", "#ffffff", "zen"), ("月島名物", "#ffffff", "#d4001a", "mincho"), ("明太もちチーズ", "#ff7fb0", "#ffffff", "mplus"),
          ("居酒屋", "#2b1a12", "#ffcf70", "mincho"), ("やきそば", "#ff7b00", "#ffffff", "mplus"), ("駄菓子", "#00a0e9", "#ffffff", "mplus"),
          ("生ビール", "#ffd400", "#d4001a", "dela"), ("佃煮", "#1d1d1d", "#f2d16b", "mincho"), ("もんじゃ", "#0a4da2", "#ffffff", "zen"),
          ("海鮮", "#0a4da2", "#ffffff", "zen"), ("元祖", "#f2e6c8", "#7a2a12", "mincho")]
BOARDS = [("もんじゃ お好み焼", "#d4001a", "#ffffff", "zen"), ("元祖 もんじゃ", "#f2e6c8", "#7a2a12", "mincho"), ("鉄板焼 もんじゃ", "#1d1d1d", "#ffcf70", "zen"),
          ("明太もち もんじゃ", "#ff7fb0", "#ffffff", "mplus"), ("お好み焼 やきそば", "#ffd400", "#5a1a0a", "dela"), ("月島 もんじゃ", "#ffffff", "#d4001a", "mincho"),
          ("生ビール 冷えてます", "#ffd400", "#d4001a", "dela"), ("佃煮 創業", "#1d1d1d", "#f2d16b", "mincho")]
ATLAS = Atlas([(f"blade{i}", 64, 320) for i in range(len(BLADES))] + [(f"board{i}", 384, 96) for i in range(len(BOARDS))]
              + [("monja_gate", 512, 128), ("kachidoki", 256, 64)])


def adjust_building(b, cls, g, geoms, ctx):
    if g.geom_type != "Polygon":
        return geoms
    geoms = jk.police_box(b, geoms)
    top = max((q[2] for q in geoms), default=0.0)
    if (b["class"] or "") in SIGN_CLASSES and geoms and 20 < g.area < 1500 and 3 <= top <= 30 and LineString(MONJA).distance(g) < 9:
        ctx.signs.append((g, top))
    return geoms


def finalize(ctx):
    C, lm = ctx.city, ctx.landmarks
    lm["monja"] = {"sites": jk.sign_sites(C, ctx.signs, ctx.ground)}
    a, b = np.asarray(MONJA[0]), np.asarray(MONJA[1])
    lm["monja"]["gate"] = {"c": dk.rnd(a + unit(b - a) * 12.0), "along": dk.rnd(unit(b - a), 4), "z": round(ctx.ground(*(a + unit(b - a) * 12.0)), 2)}
    lm["bridges"] = dk.water_bridges(ctx, colours=COLOURS, widths=WIDTHS)
    kc = next((x for x in lm["bridges"] if x["name"] == KACHIDOKI), None)
    if kc:
        ctx.labels["Kachidoki Bridge 勝鬨橋"] = [kc["centre"][0], kc["centre"][1], round(max(kc["z_ends"]) + 22, 1)]
    ctx.labels["Monja Street もんじゃストリート"] = [round((a[0] + b[0]) / 2, 1), round((a[1] + b[1]) / 2, 1), round(ctx.ground(*(a + b) / 2) + 20, 1)]
    # Tsukuda: the small bridge over the moat (OpenStreetMap's line), and Sumiyoshi Shrine's grounds
    kb = [r["geom"] for r in jk.overture(C, "infrastructure", "name = '佃小橋'") if r["geom"].geom_type == "LineString"]
    if kb:
        cs = np.asarray(kb[0].coords)
        lm["kobashi"] = {"a": dk.rnd(cs[0]), "b": dk.rnd(cs[-1]), "z": round(max(ctx.ground(*cs[0]), ctx.ground(*cs[-1])), 2)}
    sh = [r["geom"] for r in jk.overture(C, "land_use", "name = '住吉大社' OR name = '住吉神社'") if r["geom"].geom_type == "Polygon"]
    if sh:
        g = sh[0]
        # the torii on the grounds' edge that faces the river (west)
        p = g.exterior.interpolate(g.exterior.project(Point(g.centroid.x - 60, g.centroid.y)))
        f = unit(np.array([p.x, p.y]) - np.array(g.centroid.coords[0]))
        lm["sumiyoshi"] = {"c": dk.rnd((p.x, p.y)), "face": dk.rnd(f, 4), "z": round(ctx.ground(p.x, p.y), 2), "centre": dk.rnd(g.centroid.coords[0])}
        ctx.labels["Sumiyoshi Shrine 住吉神社"] = [round(g.centroid.x, 1), round(g.centroid.y, 1), round(ctx.ground(g.centroid.x, g.centroid.y) + 14, 1)]


# ---------------------------------------------------------------- meshes

def kachidoki(K, b):
    """The two tied arches over the side spans (about 86 m each, rising 11 m over the deck), their hangers
    and top bracing, the bascule's 44 m between them, and the four control houses on its piers."""
    P = frame(b["centre"], b["axis"])
    L, hw = b["length_m"], b["width_m"] / 2
    prof = dk.deck_profile(b)
    us, zs = np.array([p[0] for p in prof]), np.array([p[1] for p in prof])
    dz = lambda u: float(np.interp(u, us, zs))
    bas = 44.0 * L / 246.0
    span = (L - bas) / 2
    S = K("arch_steel")
    for s in (-1, 1):
        u0, u1 = (-L / 2, -bas / 2) if s < 0 else (bas / 2, L / 2)
        ts = np.linspace(0, 1, 17)
        for v in (-hw - 0.4, hw + 0.4):
            arc = [P(u0 + (u1 - u0) * t, v, dz(u0 + (u1 - u0) * t) + 11.0 * math.sin(math.pi * t)) for t in ts]
            for p, q in zip(arc, arc[1:]):
                S.box(p, q, 0.9, 1.2)
            for t in ts[1:-1:2]:   # the hangers
                u = u0 + (u1 - u0) * t
                S.box(P(u, v, dz(u)), P(u, v, dz(u) + 11.0 * math.sin(math.pi * t)), 0.25, 0.25)
            S.box(P(u0, v, dz(u0) - 0.8), P(u1, v, dz(u1) - 0.8), 0.7, 1.6)     # the tie
        for t in ts[3:-3:3]:   # bracing across, over the road
            u = u0 + (u1 - u0) * t
            z = dz(u) + 11.0 * math.sin(math.pi * t)
            S.box(P(u, -hw - 0.4, z), P(u, hw + 0.4, z), 0.4, 0.5)
    for su in (-1, 1):   # the control houses on the bascule's piers, either side of the road
        u = su * (bas / 2 + 3.0)
        for sv in (-1, 1):
            v = sv * (hw + 3.2)
            z = dz(u)
            block(K("house_wall"), P, u - 2.6, u + 2.6, v - 2.4, v + 2.4, z - 8.0, z + 4.2)
            jk.hip_roof(K("copper_dark"), K("copper_dark"), lambda a, c, zz, u=u, v=v: P(u + a, v + c, zz), 2.6, 2.4, z + 4.2, z + 6.0, ov=0.5, k=1.0)
            for wv in (-1.2, 1.2):
                ATLAS.quad(K("atlas"), P(u + 2.62, v + wv - 0.5, z + 1.6), P(u + 2.62, v + wv + 0.5, z + 1.6), P(u + 2.62, v + wv + 0.5, z + 3.2), P(u + 2.62, v + wv - 0.5, z + 3.2), "kachidoki")


def kobashi(K, k):
    """Tsukuda Kobashi: a short vermilion bridge, its railings with round posts and bronze caps."""
    a, b = np.asarray(k["a"]), np.asarray(k["b"])
    f = unit(b - a)
    L = float(np.linalg.norm(b - a))
    P = frame((a + b) / 2, f)
    z = k["z"] + 0.1
    for v in (-2.0, 2.0):
        pts = [P(u, v, z + 0.35 * math.sin(math.pi * (u / L + 0.5))) for u in np.linspace(-L / 2 - 1, L / 2 + 1, 9)]
        K("vermilion").rails(pts, 1.0, post_every=1.6, post=0.14, rail=0.09, rails=2)
        for u in (-L / 2 - 1, L / 2 + 1):
            lathe_at(K("vermilion"), *P(u, v, 0)[:2], [(z, 0.16), (z + 1.3, 0.16), (z + 1.3, 0.2), (z + 1.5, 0.0)], 8)


def torii(K, t):
    """Sumiyoshi Shrine's torii: two posts, the kasagi with its upturned ends over the nuki."""
    P = frame(t["c"], t["face"])
    z = t["z"]
    for v in (-2.2, 2.2):
        lathe_at(K("stone"), *P(0, v, 0)[:2], [(z, 0.3), (z + 4.6, 0.26), (z + 4.6, 0.0)], 10)
    block(K("stone"), P, -0.18, 0.18, -2.8, 2.8, z + 3.7, z + 4.0)
    block(K("stone"), P, -0.3, 0.3, -3.4, 3.4, z + 4.6, z + 4.9)
    block(K("stone"), P, -0.25, 0.25, -3.7, 3.7, z + 4.9, z + 5.15)


def landmark_meshes(scene):
    lm = scene["landmarks"]
    K = Kit("tsuki", MATERIALS, floodlit=("vermilion", "arch_steel"))
    rng = np.random.default_rng(1946)
    m = lm.get("monja") or {}
    if m.get("sites"):
        jk.street_signs(K, ATLAS, m["sites"], ([f"board{i}" for i in range(len(BOARDS))], [f"blade{i}" for i in range(len(BLADES))]), rng, max_h=5.0)
    if m.get("gate"):
        g = m["gate"]
        dk.street_gate(K, ATLAS, "monja_gate", g["c"], g["along"], 8.0, g["z"], clear=4.8, board_h=1.5, board_w=6.6)
    for b in lm.get("bridges", []):
        dk.bridge_meshes(K, b)
        if b["name"] == KACHIDOKI:
            kachidoki(K, b)
    if "kobashi" in lm:
        kobashi(K, lm["kobashi"])
    if "sumiyoshi" in lm:
        torii(K, lm["sumiyoshi"])
    return MATERIALS, K.meshes()


def landmark_assets(out_dir, scene):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (ATLAS.W, ATLAS.H), (30, 30, 34))
    d = ImageDraw.Draw(img)
    dk.draw_signs(d, ATLAS, BLADES, BOARDS)
    x, y, w, h = ATLAS.rects["monja_gate"]
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(212, 0, 26))
    d.rectangle([x + 6, y + 6, x + w - 6, y + h - 6], outline=(255, 230, 0), width=4)
    jk.text(d, (x + w * 0.36, y + h / 2), "もんじゃストリート", "mincho", jk.fit(d, ["もんじゃストリート"], "mincho", w * 0.62, h - 30, 80), (255, 255, 255))
    jk.text(d, (x + w * 0.84, y + h / 2), "月島", "dela", jk.fit(d, ["月島"], "dela", w * 0.24, h - 30, 90), (255, 230, 0))
    x, y, w, h = ATLAS.rects["kachidoki"]   # the control houses' windows: dark panes in white frames
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(232, 228, 216))
    d.rectangle([x + 10, y + 8, x + w - 10, y + h - 8], fill=(40, 52, 60))
    img.save(f"{out_dir}/atlas.jpg", quality=90)
    return ["atlas.jpg"]


def landmark_glows(scene):
    lm = scene["landmarks"]
    out = dk.sign_glows((lm.get("monja") or {}).get("sites", []), every=2, colours=("#ffcf8a", "#ffe6c0", "#ff9a6a"), strength=0.3)
    for b in lm.get("bridges", []):
        if b["name"] == KACHIDOKI:
            out.append([b["centre"][0], b["centre"][1], 60.0, "#cfe2ff", 0.25])
    return out


def game_surfaces(scene):
    return dk.bridge_surfaces(scene["landmarks"].get("bridges", []), mesh="tsuki_bridge_deck")


def game_extras(scene):
    lm = scene["landmarks"]
    spots, chatter, close = [], [], []
    m = lm.get("monja") or {}
    if m.get("gate"):
        g = m["gate"]
        at = np.asarray(g["c"]) - np.asarray(g["along"]) * 6.0
        spots.append(dk.spot("monja", "Monja Street もんじゃストリート", at, g["z"], "Look down the street",
                             ["Monja Street: seventy shops of monjayaki in five hundred metres. Batter on the hot plate, a ring of cabbage, eat it off the little spatula.",
                              "It was a children's snack once, from the sweet shops. Now people queue for it."], 5.0))
    st = m.get("sites") or []
    if st:
        x, y, nx, ny, g, top, L = st[len(st) // 2]
        chatter.append({"at": [x + nx * 4, y + ny * 4, g], "radius": 12, "side": True,
                        "lines": [["Diner", "Make the bank first! The cabbage, in a ring!"], ["Friend", "It's running everywhere."], ["Diner", "That's how you know it's monja."]]})
    kc = next((b for b in lm.get("bridges", []) if b["name"] == KACHIDOKI), None)
    if kc:
        ax = np.asarray(kc["axis"])
        at = np.asarray(kc["centre"]) - ax * (kc["length_m"] / 2 + 16.0) - left_of(ax) * (kc["width_m"] / 2 + 6.0)   # on the Kachidoki bank
        z = kc["z_ends"][0]
        spots.append(dk.spot("kachidoki", "Kachidoki Bridge 勝鬨橋", at, z, "Look at the bridge",
                             ["Kachidoki Bridge, 1940: the middle opens, two leaves raised like a drawbridge, to let ships up the Sumida. It last opened in 1970.",
                              "They built it for a World's Fair that never happened. The control rooms on the piers are a museum now."], 8.0))
    sh = lm.get("sumiyoshi")
    if sh:
        at = np.asarray(sh["c"]) + np.asarray(sh["face"]) * 6.0
        spots.append(dk.spot("sumiyoshi", "Sumiyoshi Shrine 住吉神社", at, sh["z"], "Look at the shrine",
                             ["Sumiyoshi Shrine, 1646: the fishermen who came from Osaka to Tsukuda brought their god with them.",
                              "Every three years the portable shrine goes into the river. The fishermen carry it through the water."], 5.0))
    return {"spots": spots, "chatter": chatter, "close": close}
