"""Ikebukuro, a map of Tokyo: what the generic pipeline cannot know from open data.

The model is the real district: Overture footprints at Project PLATEAU's surveyed heights (Sunshine 60's
240 m among them) on GSI's laser bare earth. This file dresses and adds:

  * Sunshine 60-dori (サンシャイン60通り), the street from the station's east exit to Sunshine City, and
    Otome Road (乙女ロード) behind it: boards and blade signs on the street fronts with the trades of
    each (games, karaoke, ramen, arcades; on Otome Road the books, goods and cafes of women's fandom).
    Typical trades, no real shop's sign, and no characters or art of any work.
  * The names of the department stores and big shops round the station on their roofs' edges, their own
    words in open fonts (Seibu, PARCO, Bic Camera, Tobu, Sunshine City): not their logos.
  * GLOBAL RING (2019), Ikebukuro West Gate Park's ring: five steel rings of LED light about 35 m across
    over the open-air theatre (Toshima City; the diameter as published by visitors' guides, the ring's
    height from photographs).

Persona 5 does not send its players to Ikebukuro by name, but the west exit's park is a drama's
(Ikebukuro West Gate Park, 2000) and Otome Road a pilgrimage street for fans. Nothing of either is copied.
"""
import math

import numpy as np
from shapely.geometry import LineString, Point, Polygon

import districtkit as dk
import japankit as jk
from japankit import Atlas, Kit, block, frame, lathe_at, unit, left_of

SIXTY_DORI = [(-165.0, 12.0), (-60.0, -8.0), (60.0, -34.0), (190.0, -58.0)]
OTOME = "乙女ロード"
SIGN_CLASSES = {"", "commercial", "retail", "restaurant", "office", "mixed_use", "hotel", "entertainment"}
ROOF_NAMES = {"西武池袋本店": "seibu", "池袋パルコ": "parco", "ビックカメラ": "bic", "LABI1": "labi"}
RING = "Global Ring"
RING_D = 35.0

MATERIALS = {
    "atlas": {"color": "#ffffff", "roughness": 0.7, "metalness": 0.0, "map": "atlas.jpg", "emissive_map": True, "glow": 1.3},
    "frame": {"color": "#26292e", "roughness": 0.5, "metalness": 0.5},
    "steel_white": {"color": "#e9ebee", "roughness": 0.35, "metalness": 0.6},
    "led": {"color": "#f2f6ff", "roughness": 0.3, "metalness": 0.2, "emissive": "#bfe0ff", "glow": 1.6},
    "concrete": {"color": "#b8b3a9", "roughness": 0.9, "metalness": 0.0},
}

BLADES = [("ゲーム", "#e60012", "#ffffff", "dela"), ("カラオケ", "#ffd400", "#e60012", "dela"), ("ラーメン", "#d4001a", "#ffffff", "zen"),
          ("つけ麺", "#1d1d1d", "#ffcf70", "mincho"), ("居酒屋", "#2b1a12", "#ffcf70", "mincho"), ("焼肉", "#3b2a1e", "#ff6b4a", "zen"),
          ("映画館", "#0a2a6a", "#ffffff", "zen"), ("ゲームセンター", "#ffd400", "#d4001a", "dela"), ("ガチャ", "#00a0e9", "#ffffff", "mplus"),
          ("ドラッグ", "#ffffff", "#00915a", "zen"), ("免税", "#ffffff", "#d4001a", "zen"), ("回転寿司", "#0a4da2", "#ffffff", "zen"),
          ("同人誌", "#2b2b2b", "#ff8ad8", "mplus"), ("執事喫茶", "#1a1a2e", "#e6c87a", "mincho"), ("グッズ", "#ff4fa0", "#ffffff", "mplus"),
          ("コスプレ", "#c2185b", "#ffffff", "mplus"), ("古本", "#f2e6c8", "#7a2a12", "mincho"), ("カフェ", "#5a3a24", "#ffffff", "mplus"),
          ("アニメ", "#6a1bb0", "#ffffff", "mplus"), ("買取", "#d4001a", "#ffe600", "dela"), ("ボウリング", "#0068b7", "#ffffff", "dela"),
          ("プリクラ", "#ff7fb0", "#ffffff", "mplus")]
BOARDS = [("いらっしゃいませ", "#e60012", "#ffffff", "zen"), ("ラーメン 豚骨 醤油", "#1d1d1d", "#ffcf70", "zen"), ("カラオケ 30分 100円", "#ffd400", "#e60012", "dela"),
          ("GAME CENTER", "#141414", "#53f2ff", "bebas"), ("同人誌 専門店", "#2b2b2b", "#ff8ad8", "mplus"), ("執事喫茶 ご帰宅", "#1a1a2e", "#e6c87a", "mincho"),
          ("アニメ グッズ 買取", "#6a1bb0", "#ffffff", "mplus"), ("CINEMA", "#0a2a6a", "#ffffff", "bebas"), ("回転寿司", "#0a4da2", "#ffffff", "zen"),
          ("焼肉 食べ放題", "#3b2a1e", "#ff6b4a", "dela"), ("TAX FREE 免税", "#ffffff", "#d4001a", "bebas"), ("営業中 OPEN", "#d4001a", "#ffffff", "bebas")]
NAMES = {"seibu": ("SEIBU 西武", "#ffffff", "#0068b7", "zen"), "parco": ("PARCO", "#111111", "#ffffff", "bebas"),
         "bic": ("ビックカメラ", "#d4001a", "#ffffff", "dela"),
         "labi": ("LABI", "#ffffff", "#e60012", "bebas")}

ATLAS = Atlas([(f"blade{i}", 64, 320) for i in range(len(BLADES))] + [(f"board{i}", 384, 96) for i in range(len(BOARDS))]
              + [(f"name_{k}", 512, 96) for k in NAMES])


_OTOME = {}


def otome(C):
    """Otome Road: OpenStreetMap's outline of the street's shops (land use 乙女ロード), read once."""
    if "g" not in _OTOME:
        import shapely
        gs = [r["geom"] for r in jk.overture(C, "land_use", f"name = '{OTOME}'")]
        _OTOME["g"] = shapely.union_all(gs) if gs else Point(1e9, 1e9)
    return _OTOME["g"]


def adjust_building(b, cls, g, geoms, ctx):
    name = b["name"] or ""
    lm = ctx.landmarks
    if g.geom_type != "Polygon":
        return geoms
    geoms = jk.police_box(b, geoms)
    top = max((q[2] for q in geoms), default=0.0)
    c = g.centroid
    if name == RING and b["class"] == "roof":   # OpenStreetMap's ring as a plain canopy: drawn by global_ring() instead
        ext = Polygon(g.exterior)
        lm["_ring"] = {"r_out": round(math.sqrt(ext.area / math.pi), 2), "r_in": round(math.sqrt(max(ext.area - g.area, 1.0) / math.pi), 2),
                       "c": [round(ext.centroid.x, 2), round(ext.centroid.y, 2)], "top_m": round(top, 1)}
        for q in geoms:
            ctx.hide(q)
        return geoms
    if name in ROOF_NAMES and top > 8 and not any(n["key"] == ROOF_NAMES[name] for n in lm.get("_names", [])):
        # the roof that carries the name: the main block's, not a stair tower's
        lm.setdefault("_names", []).append({"key": ROOF_NAMES[name], "ring": [[round(x, 2), round(y, 2)] for x, y in g.exterior.coords],
                                            "top_m": round(top, 1), "ground_m": round(ctx.ground(c.x, c.y), 2)})
    if (b["class"] or "") in SIGN_CLASSES and geoms and 25 < g.area < 2500 and 4 <= top <= 60:
        if LineString(SIXTY_DORI).distance(g) < 30 or otome(ctx.city).distance(g) < 14:
            ctx.signs.append((g, top))
    return geoms


def finalize(ctx):
    C, lm = ctx.city, ctx.landmarks
    lm["streets"] = {"sites": jk.sign_sites(C, ctx.signs, ctx.ground)}
    lm["roof_names"] = dk.roof_name_sites(C, lm.pop("_names", []))
    art = [r["geom"] for r in jk.overture(C, "infrastructure", f"name = '{RING}'")]
    park = [r["geom"] for r in jk.overture(C, "land_use", "name = '池袋西口公園'") if r["geom"].geom_type in ("Polygon", "MultiPolygon")]
    if art:
        p = art[0].centroid
        if park:   # the ring stands over the theatre's plaza, the middle of the park's open ground
            q = max(park, key=lambda g: g.area)
            if q.distance(p) < 30:
                p = q.centroid if q.contains(q.centroid) else p
        osm = lm.pop("_ring", None)
        if osm:
            p = Point(*osm["c"])
        lm["ring"] = {"c": [round(p.x, 2), round(p.y, 2)], "z": round(ctx.ground(p.x, p.y), 2),
                      "r_out": osm["r_out"] if osm else RING_D / 2, "r_in": osm["r_in"] if osm else RING_D / 2 - 3.0}
        ctx.labels["GLOBAL RING グローバルリング"] = [round(p.x, 1), round(p.y, 1), round(ctx.ground(p.x, p.y) + 22, 1)]


def global_ring(K, r):
    """Five rings, one over another, of white steel with LED light in them, on eight slender raking legs."""
    x, y = r["c"]
    z0 = r["z"]
    R = r.get("r_out", RING_D / 2)
    ri = r.get("r_in", R - 3.0)
    segs = 72
    for k in range(5):   # each ring a band of white steel 0.5 m deep, tilted a little, the LED line along its foot
        z = z0 + 8.2 + k * 0.7
        rr = R - k * (R - ri) / 4
        ts = np.linspace(0, math.tau, segs + 1)
        at = lambda t, r_, dz=0.0: np.array([x + r_ * math.cos(t), y + r_ * math.sin(t), z + 0.5 * math.sin(t + k) + dz])
        S = K("steel_white")
        for a, b in zip(ts, ts[1:]):
            for r_ in (rr, rr - 0.12):
                p0, p1, p2, p3 = at(a, r_), at(b, r_), at(b, r_, 0.5), at(a, r_, 0.5)
                (S.quad(p0, p1, p2, p3) if r_ == rr else S.quad(p1, p0, p3, p2))
            S.quad(at(a, rr, 0.5), at(b, rr, 0.5), at(b, rr - 0.12, 0.5), at(a, rr - 0.12, 0.5))
            S.quad(at(b, rr), at(a, rr), at(a, rr - 0.12), at(b, rr - 0.12))
        K("led", "lit").tube([at(t, rr - 0.06, -0.06) for t in ts], 0.06, 4)
    for k in range(8):
        t = k * math.tau / 8 + 0.2
        top = np.array([x + R * math.cos(t), y + R * math.sin(t), z0 + 8.2 + 0.5 * math.sin(t)])
        foot = np.array([x + (R + 2.4) * math.cos(t + 0.08), y + (R + 2.4) * math.sin(t + 0.08), z0])
        K("steel_white").tube([foot, top, top + np.array([0, 0, 3.4])], 0.22, 6)
        lathe_at(K("concrete"), foot[0], foot[1], [(z0 - 0.2, 0.6), (z0 + 0.3, 0.5), (z0 + 0.3, 0.0)], 8)


def landmark_meshes(scene):
    lm = scene["landmarks"]
    K = Kit("ike", MATERIALS)
    rng = np.random.default_rng(1978)
    if lm.get("streets"):
        jk.street_signs(K, ATLAS, lm["streets"]["sites"], ([f"board{i}" for i in range(len(BOARDS))], [f"blade{i}" for i in range(len(BLADES))]), rng)
    dk.roof_names(K, ATLAS, lm.get("roof_names", []))
    if "ring" in lm:
        global_ring(K, lm["ring"])
    return MATERIALS, K.meshes()


def landmark_assets(out_dir, scene):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (ATLAS.W, ATLAS.H), (30, 30, 34))
    d = ImageDraw.Draw(img)
    dk.draw_signs(d, ATLAS, BLADES, BOARDS)
    dk.draw_names(d, ATLAS, NAMES)
    img.save(f"{out_dir}/atlas.jpg", quality=90)
    return ["atlas.jpg"]


def landmark_glows(scene):
    lm = scene["landmarks"]
    out = dk.sign_glows((lm.get("streets") or {}).get("sites", []), colours=("#ff8ac8", "#8ad8ff", "#ffe08a", "#ffffff"))
    if "ring" in lm:
        out.append([*lm["ring"]["c"], 26.0, "#cfe6ff", 0.35])
    return out


def game_extras(scene):
    lm = scene["landmarks"]
    spots, chatter, close = [], [], []
    r = lm.get("ring")
    if r:
        at = np.asarray(r["c"]) + np.array([0.0, -RING_D / 2 - 6.0])
        spots.append(dk.spot("ring", "GLOBAL RING", at, r["z"], "Look up at the ring",
                             ["Ikebukuro West Gate Park: the ring went up in 2019, over an open-air theatre. Orchestras play here on summer nights.",
                              "Before that it was a fountain and benches, and the kids from a famous TV drama hung out here. People still come looking for them."], 6.0))
        R = r.get("r_out", RING_D / 2)   # from the plaza on the west side, under the ring's edge
        close.append(dk.close_to("GLOBAL RING, under the ring", np.asarray(r["c"]) + np.array([-(R - 2.0), 0.0]), r["z"], np.asarray(r["c"]) + np.array([-(R + 8.0), 0.0]), 2.0))
    st = (lm.get("streets") or {}).get("sites", [])
    if st:
        x, y, nx, ny, g, top, L = st[len(st) // 3]
        chatter.append({"at": [x + nx * 4, y + ny * 4, g], "radius": 14, "side": True,
                        "lines": [["Fan", "The new volume's out today. They had a line round the block at nine."], ["Friend", "Did you get the shop bonus?"], ["Fan", "Both versions. Don't tell my mother."]]})
    return {"spots": spots, "chatter": chatter, "close": close}
