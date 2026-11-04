"""Ueno, a map of Tokyo: what the generic pipeline cannot know from open data.

The model is the real district: Overture footprints at Project PLATEAU's surveyed heights on GSI's laser
bare earth. This file builds the landmarks in code, placed on OpenStreetMap's footprints of them (via
Overture), and hides the plain blocks the survey has for them:

  * 不忍池 Shinobazu Pond: its three ponds (the lotus pond, the boat pond and the cormorant pond in the
    zoo) about 3 m above the sea, drawn as water at their own shore's level (pipeline/districtkit.py), the
    lotus pond under its leaves, brown and dry from autumn to spring as they stand in photographs.
  * 弁天堂 Bentendo, the octagonal hall of Benzaiten on the pond's island (Kan'ei-ji; rebuilt 1958):
    vermilion, its eight-sided roof and jewel finial.
  * 旧寛永寺五重塔 Kan'ei-ji's five-storey pagoda (1639; 36.4 m, Taito City), vermilion, now inside the zoo.
  * 上野東照宮 Ueno Toshogu (1651): the Konjiki-den, the gilt hall in gongen style (拝殿 in front, 本殿
    behind under one roof line), and the bronze and stone lanterns of its approach (about 250 lanterns;
    Toshogu).
  * 西郷隆盛像 the statue of Saigo Takamori with his dog Tsun (Takamura Koun, 1898): 3.7 m of bronze on
    a granite pedestal of about 4 m, at the park's south end over Keisei Ueno.
  * アメ横 Ameyoko (アメヤ横丁): the market street under and beside the Yamanote line's viaduct from
    Ueno to Okachimachi, its shops' boards and blade signs (fish, dried food, sweets, shoes, spices,
    standing bars; typical trades, no real shop's signs) and its lit gate at the Ueno end.

Persona 5's Ueno is the park and its museums, and Ameyoko for a confidant's errands. Nothing of the
game's art is copied.
"""
import math

import numpy as np
from shapely.geometry import LineString, Point, Polygon

import districtkit as dk
import japankit as jk
from japankit import Atlas, Kit, block, frame, lathe_at, slab_at, unit, left_of

BENTEN, PAGODA, TOSHOGU, KARAMON = "不忍池弁天堂", "旧寛永寺五重塔", "上野東照宮", "Kara-mon"
SAIGO, AMEYOKO_GATE = "西郷隆盛像", "「アメヤ横丁」ゲート"
SHINOBAZU = (139.7700, 35.7115)
LOTUS = ("不忍池",)
# Ameyoko: the lane west of the viaduct from the gate at the Ueno end to Okachimachi (local metres; the
# gate is where OpenStreetMap has it, the line follows the tracks)
AMEYOKO = [(104.0, -172.0), (98.0, -330.0), (92.0, -480.0), (84.0, -690.0)]
SIGN_CLASSES = {"", "commercial", "retail", "restaurant", "office", "mixed_use", "hotel"}
HEIGHTS = {"pagoda": 36.4, "saigo": 3.7, "saigo_pedestal": 4.0}

MATERIALS = {
    "atlas": {"color": "#ffffff", "roughness": 0.7, "metalness": 0.0, "map": "atlas.jpg", "emissive_map": True, "glow": 1.25},
    "gold_panel": {"color": "#ffffff", "roughness": 0.35, "metalness": 0.55, "map": "atlas.jpg", "emissive_map": True, "glow": 0.35},
    "frame": {"color": "#26292e", "roughness": 0.5, "metalness": 0.5},
    "vermilion": {"color": "#c8402c", "roughness": 0.6, "metalness": 0.0, "emissive": "#ff7a4a", "glow": 0.45},
    "vermilion_dark": {"color": "#8e2a1f", "roughness": 0.65, "metalness": 0.0},
    "tile": {"color": "#4f5359", "roughness": 0.7, "metalness": 0.15},
    "copper_dark": {"color": "#3d4a44", "roughness": 0.55, "metalness": 0.35},
    "soffit": {"color": "#b8452f", "roughness": 0.8, "metalness": 0.0},
    "white_wall": {"color": "#efeae0", "roughness": 0.85, "metalness": 0.0},
    "door": {"color": "#3a2a20", "roughness": 0.8, "metalness": 0.0},
    "stone": {"color": "#9a968e", "roughness": 0.9, "metalness": 0.0},
    "granite": {"color": "#a7a39a", "roughness": 0.85, "metalness": 0.0},
    "bronze": {"color": "#3f3a2e", "roughness": 0.5, "metalness": 0.7},
    "bronze_green": {"color": "#4f6658", "roughness": 0.55, "metalness": 0.55},
    "gold": {"color": "#d8a840", "roughness": 0.25, "metalness": 0.95, "emissive": "#ffcf70", "glow": 0.25},
    "lacquer": {"color": "#1a1614", "roughness": 0.35, "metalness": 0.2},
    "paper": {"color": "#f6efd9", "roughness": 0.9, "metalness": 0.0, "emissive": "#ffd9a0", "glow": 0.9},
    **dk.WATER,
}

# Ameyoko's trades, on blade signs (words, background, ink, font)
BLADES = [("鮮魚", "#0a4da2", "#ffffff", "zen"), ("乾物", "#f2e6c8", "#7a2a12", "mincho"), ("珍味", "#d4001a", "#ffffff", "dela"),
          ("菓子", "#ffd400", "#d4001a", "dela"), ("チョコ", "#5a2d18", "#ffe6a0", "mplus"), ("スニーカー", "#111111", "#ffffff", "zen"),
          ("ジーンズ", "#1d3f7a", "#ffffff", "zen"), ("化粧品", "#ff7fb0", "#ffffff", "mplus"), ("時計", "#ffffff", "#111111", "mincho"),
          ("海鮮丼", "#e60012", "#ffffff", "dela"), ("ケバブ", "#ffd400", "#111111", "dela"), ("居酒屋", "#2b1a12", "#ffcf70", "mincho"),
          ("立ち飲み", "#d4001a", "#ffe600", "zen"), ("焼き鳥", "#3b2a1e", "#ffffff", "mincho"), ("たこ焼", "#ff7b00", "#ffffff", "mplus"),
          ("果物", "#00915a", "#ffffff", "zen"), ("香辛料", "#a8551a", "#ffffff", "zen"), ("干物", "#f4f1ea", "#0a4da2", "mincho"),
          ("まぐろ", "#0a2a6a", "#ff4d4d", "dela"), ("蟹", "#e60012", "#ffffff", "mincho"), ("免税", "#ffffff", "#d4001a", "zen"),
          ("革製品", "#4a2c1a", "#e8c890", "zen"), ("帽子", "#f2f2ee", "#1a1a1a", "zen"), ("佃煮", "#1d1d1d", "#f2d16b", "mincho")]
BOARDS = [("いらっしゃい! 安いよ!", "#e60012", "#ffffff", "zen"), ("鮮魚 まぐろ 蟹", "#0a4da2", "#ffffff", "zen"), ("乾物 珍味 佃煮", "#f2e6c8", "#7a2a12", "mincho"),
          ("菓子 一袋千円", "#ffd400", "#d4001a", "dela"), ("スニーカー SALE", "#111111", "#ffe600", "zen"), ("海鮮丼 500円", "#ffffff", "#d4001a", "dela"),
          ("立ち飲み 酒場", "#2b1a12", "#ffcf70", "mincho"), ("やきとり もつ焼", "#3b2a1e", "#ffffff", "mincho"), ("果物 フルーツ", "#00915a", "#ffffff", "zen"),
          ("TAX FREE 免税", "#ffffff", "#d4001a", "bebas"), ("アジア 食材", "#d4001a", "#ffe600", "zen"), ("アメ横 名物", "#ffe600", "#d4001a", "dela")]

ATLAS = Atlas([(f"blade{i}", 64, 320) for i in range(len(BLADES))] + [(f"board{i}", 384, 96) for i in range(len(BOARDS))]
              + [("ameyoko", 512, 128), ("toshogu", 256, 96), ("kin", 192, 256), ("kin_door", 192, 256)])

PONDS = dk.Ponds(lambda name, g: g.distance(Point(-226.0, -141.0)) < 330.0 and g.area > 4000)


# ---------------------------------------------------------------- the build hooks

def adjust_terrain(dem, C, cell):
    return PONDS.adjust_terrain(dem, C, cell)


def _ring(g):
    return [[round(x, 2), round(y, 2)] for x, y in g.exterior.coords]


def adjust_building(b, cls, g, geoms, ctx):
    name = b["name"] or ""
    lm = ctx.landmarks
    if g.geom_type != "Polygon":
        return geoms
    geoms = jk.police_box(b, geoms)
    top = max((q[2] for q in geoms), default=0.0)
    c = g.centroid
    gz = ctx.ground(c.x, c.y)
    key = {BENTEN: "benten", PAGODA: "pagoda", TOSHOGU: "toshogu", KARAMON: "karamon"}.get(name)
    if key:
        lm[f"_{key}"] = {"ring": _ring(g), "c": [round(c.x, 2), round(c.y, 2)], "ground_m": round(gz, 2), "top_m": round(top, 1)}
        for q in geoms:
            ctx.hide(q)
        return geoms
    if (b["class"] or "") in SIGN_CLASSES and geoms and 25 < g.area < 2500 and 4 <= top <= 45 and LineString(AMEYOKO).distance(g) < 38:
        ctx.signs.append((g, top))
    return geoms


def finalize(ctx):
    C, lm = ctx.city, ctx.landmarks
    lm["ponds"] = PONDS.anchors(C, ctx.ground)
    lm["ameyoko"] = {"sites": jk.sign_sites(C, ctx.signs, ctx.ground)}
    art = {r["name"]: r["geom"] for r in jk.overture(C, "infrastructure", f"name IN ('{SAIGO}', '{AMEYOKO_GATE}')")}
    if SAIGO in art:
        p = art[SAIGO].centroid
        lm["saigo"] = {"c": [round(p.x, 2), round(p.y, 2)], "z": round(ctx.ground(p.x, p.y), 2)}
        ctx.labels["Saigo Takamori 西郷隆盛像"] = [round(p.x, 1), round(p.y, 1), round(ctx.ground(p.x, p.y) + 12, 1)]
    if AMEYOKO_GATE in art:
        p = art[AMEYOKO_GATE].centroid
        # the gate spans the lane: its axis along the lane (the nearest stretch of Ameyoko's line)
        line = LineString(AMEYOKO)
        t = line.project(p)
        a, b = line.interpolate(max(t - 5, 0)), line.interpolate(t + 5)
        along = unit(np.array([b.x - a.x, b.y - a.y]))
        lm["ameyoko"]["gate"] = {"c": [round(p.x, 2), round(p.y, 2)], "along": dk.rnd(along, 4), "z": round(ctx.ground(p.x, p.y), 2)}
        ctx.labels["Ameyoko アメ横"] = [round(p.x, 1), round(p.y, 1), round(ctx.ground(p.x, p.y) + 14, 1)]
    bt = lm.pop("_benten", None)
    if bt:
        g = Polygon(bt["ring"])
        # the hall faces its approach: the causeway from the east shore (天龍橋)
        c = np.asarray(bt["c"])
        face = unit(np.array([-136.0, -78.0]) - c)
        lm["benten"] = {"c": bt["c"], "z": bt["ground_m"], "r": round(min(5.4, math.sqrt(g.area / math.pi) * 0.6), 2), "face": dk.rnd(face, 4)}
        ctx.labels["Bentendo 弁天堂"] = [bt["c"][0], bt["c"][1], round(bt["ground_m"] + 16, 1)]
    pg = lm.pop("_pagoda", None)
    if pg:
        g = Polygon(pg["ring"])
        cc, ax, half = jk.footprint_frame(g)
        lm["pagoda"] = {"c": dk.rnd(g.centroid.coords[0]), "axis": dk.rnd(ax, 4), "z": pg["ground_m"], "half": round(min(half) , 2)}
        ctx.labels["Kan'ei-ji pagoda 五重塔"] = [pg["c"][0], pg["c"][1], round(pg["ground_m"] + HEIGHTS["pagoda"] + 4, 1)]
    ts = lm.pop("_toshogu", None)
    if ts:
        g = Polygon(ts["ring"])
        # the hall faces east, down its approach towards the pagoda and the park's main avenue
        cc, ax, half = jk.footprint_frame(g, toward=None)
        east = np.array([1.0, 0.0])
        axes = [ax, left_of(ax), -ax, -left_of(ax)]
        f = max(axes, key=lambda v: float(v @ east))
        cs = np.asarray(g.exterior.coords) - np.asarray(cc)
        hu = float(np.max(np.abs(cs @ f)))
        hv = float(np.max(np.abs(cs @ left_of(f))))
        z = ts["ground_m"]
        km = lm.pop("_karamon", None)          # the gilt gate in the enclosure's wall, where OpenStreetMap has it
        ug = float((np.asarray(km["c"]) - np.asarray(cc)) @ f) if km else hu + 6.0
        # the enclosure (透塀): OpenStreetMap's wall round the hall, a gilt and lacquered fence
        walls = [r["geom"] for r in jk.overture(C, "infrastructure", "class = 'wall'") if r["geom"].geom_type == "LineString" and r["geom"].distance(Point(*cc)) < hu + 15]
        fence = [[dk.rnd(p) + [round(ctx.ground(*p), 2)] for p in w.coords] for w in walls]
        # the approach's lanterns: two rows from the hall's front gate eastwards, on the ground
        lanterns = []
        for k in range(18):
            u = max(hu + 12.0, ug + 6.0) + k * 4.2
            for s in (-1, 1):
                p = np.asarray(cc) + f * u + left_of(f) * s * 4.2
                lanterns.append([*dk.rnd(p), round(ctx.ground(*p), 2)])
        lm["toshogu"] = {"c": dk.rnd(cc), "face": dk.rnd(f, 4), "hu": round(min(hu, 15.0), 2), "hv": round(min(hv, 14.0), 2), "z": z, "lanterns": lanterns,
                         "karamon_u": round(ug, 2), "fence": fence}
        ctx.labels["Ueno Toshogu 上野東照宮"] = [ts["c"][0], ts["c"][1], round(z + 18, 1)]


# ---------------------------------------------------------------- meshes

def ameyoko(K, a):
    rng = np.random.default_rng(1945)
    jk.street_signs(K, ATLAS, a["sites"], ([f"board{i}" for i in range(len(BOARDS))], [f"blade{i}" for i in range(len(BLADES))]), rng, max_h=5.0)
    g = a.get("gate")
    if g:
        dk.street_gate(K, ATLAS, "ameyoko", g["c"], g["along"], 9.0, g["z"], clear=5.0, board_h=1.7, board_w=7.2)


def benten(K, b):
    mats = {"stone": "stone", "wall": "vermilion", "post": "vermilion_dark", "door": "door", "bracket": "vermilion", "roof": "tile", "soffit": "soffit", "gold": "gold"}
    dk.octagon_hall(K, b["c"], b["z"], b["r"], 4.0, 5.2, mats, face=b["face"], podium=0.9)


def toshogu(K, t):
    """The Konjiki-den in gongen style: the worship hall (拝殿) in front, the stone-floored passage (石の間)
    and the main hall (本殿) behind, gilt walls and black lacquered posts, dark copper roofs; the
    Karamon (唐門), a gilt gate, before it; and the lanterns of the approach."""
    P = frame(t["c"], t["face"])
    z0 = t["z"]
    hu, hv = t["hu"], t["hv"]
    block(K("stone"), P, -hu, hu, -hv, hv, z0 - 0.3, z0 + 0.8)
    zb = z0 + 0.8
    parts = [(hu * 0.25, hu * 0.85, hv * 0.85, 5.2, 4.2), (-hu * 0.2, hu * 0.25, hv * 0.4, 4.4, 2.0), (-hu * 0.85, -hu * 0.2, hv * 0.6, 5.6, 4.4)]
    G = K("gold_panel")
    for k, (u0, u1, w, wh, rh) in enumerate(parts):
        block(K("lacquer"), P, u0 + 0.05, u1 - 0.05, -w + 0.05, w - 0.05, zb, zb + wh)
        nu = max(2, int(round((u1 - u0) / 2.6)))
        nv = max(2, int(round(2 * w / 2.6)))
        us, vs = np.linspace(u0, u1, nu + 1), np.linspace(-w, w, nv + 1)
        for u in us:
            for sg in (-1, 1):
                slab_at(K("lacquer"), P, u, sg * w, 0.36, 0.36, zb, zb + wh)
        for v in vs:
            for sg in (-1, 1):
                slab_at(K("lacquer"), P, u1 if sg > 0 else u0, v, 0.36, 0.36, zb, zb + wh)
        z0p, z1p = zb + 0.3, zb + wh - 0.55
        for a, b in zip(vs, vs[1:]):     # the front and back faces, a gilt panel each bay; the doors on the front of the worship hall
            front = k == 0 and abs((a + b) / 2) < w * 0.75
            ATLAS.quad(G, P(u1 + 0.02, a + 0.2, z0p), P(u1 + 0.02, b - 0.2, z0p), P(u1 + 0.02, b - 0.2, z1p), P(u1 + 0.02, a + 0.2, z1p), "kin_door" if front else "kin")
            ATLAS.quad(G, P(u0 - 0.02, b - 0.2, z0p), P(u0 - 0.02, a + 0.2, z0p), P(u0 - 0.02, a + 0.2, z1p), P(u0 - 0.02, b - 0.2, z1p), "kin")
        for a, b in zip(us, us[1:]):
            ATLAS.quad(G, P(b - 0.2, w + 0.02, z0p), P(a + 0.2, w + 0.02, z0p), P(a + 0.2, w + 0.02, z1p), P(b - 0.2, w + 0.02, z1p), "kin")
            ATLAS.quad(G, P(a + 0.2, -w - 0.02, z0p), P(b - 0.2, -w - 0.02, z0p), P(b - 0.2, -w - 0.02, z1p), P(a + 0.2, -w - 0.02, z1p), "kin")
        block(K("gold"), P, u0 - 0.25, u1 + 0.25, -w - 0.25, w + 0.25, zb + wh - 0.55, zb + wh - 0.35)    # the gilt tie beam
        block(K("lacquer"), P, u0 - 0.2, u1 + 0.2, -w - 0.2, w + 0.2, zb + wh - 0.5, zb + wh)
        jk.irimoya(K("copper_dark"), K("gold", "gable"), K("lacquer", "soffit"), lambda u, v, z, u0=u0, u1=u1: P((u0 + u1) / 2 + v, u, z),
                   w, (u1 - u0) / 2, zb + wh, zb + wh + rh, ov=1.6, gable_at=0.5)
    # the karamon: a small gilt gate with a curved gable before the hall
    ug = t.get("karamon_u", hu + 6.0)
    for w in t.get("fence", []):     # the enclosure: a lacquered sill, gilt lattice panels and a copper cap, cut at the gate
        for a, b in zip(w, w[1:]):
            a, b = np.asarray(a), np.asarray(b)
            L = float(np.linalg.norm(b[:2] - a[:2]))
            if L < 0.5:
                continue
            e = (b[:2] - a[:2]) / L
            for t0 in np.arange(0.0, L, 2.0):
                t1 = min(t0 + 2.0, L)
                p0, p1 = a[:2] + e * t0, a[:2] + e * t1
                mid = (p0 + p1) / 2
                if abs(float((mid - np.asarray(t["c"])) @ np.asarray(t["face"])) - ug) < 1.0 and abs(float((mid - np.asarray(t["c"])) @ left_of(np.asarray(t["face"])))) < 2.4:
                    continue
                zz = float(a[2] + (b[2] - a[2]) * (t0 + t1) / 2 / L)
                Q = frame(mid, e)
                h = (t1 - t0) / 2
                block(K("lacquer"), Q, -h, h, -0.2, 0.2, zz, zz + 0.6)
                block(K("gold", "fence"), Q, -h + 0.08, h - 0.08, -0.06, 0.06, zz + 0.6, zz + 2.0)
                block(K("copper_dark"), Q, -h, h, -0.32, 0.32, zz + 2.0, zz + 2.3)
    for s in (-1, 1):
        slab_at(K("gold"), P, ug, s * 1.6, 0.45, 0.45, z0, z0 + 3.6)
    block(K("gold"), P, ug - 0.6, ug + 0.6, -2.0, 2.0, z0 + 3.6, z0 + 4.2)
    jk.irimoya(K("copper_dark"), K("gold", "gable"), K("lacquer", "soffit"), lambda u, v, z: P(ug + v, u, z), 2.0, 0.8, z0 + 4.2, z0 + 5.6, ov=0.9, gable_at=0.4)
    ATLAS.quad(K("atlas"), P(ug + 0.62, 0.9, z0 + 3.65), P(ug + 0.62, -0.9, z0 + 3.65), P(ug + 0.62, -0.9, z0 + 4.15), P(ug + 0.62, 0.9, z0 + 4.15), "toshogu")
    for k, (x, y, z) in enumerate(t["lanterns"]):
        if k % 3 == 0:   # the bronze ones: copper-green with age
            lathe_at(K("bronze_green"), x, y, [(z, 0.5), (z + 0.3, 0.45), (z + 0.35, 0.14), (z + 1.4, 0.14), (z + 1.5, 0.38)], 8)
            lathe_at(K("paper", "lit"), x, y, [(z + 1.5, 0.26), (z + 1.95, 0.26), (z + 1.95, 0.0)], 6)
            lathe_at(K("bronze_green"), x, y, [(z + 1.95, 0.55), (z + 2.1, 0.5), (z + 2.35, 0.12), (z + 2.6, 0.0)], 8)
        else:
            dk.stone_lantern(K, x, y, z, h=2.4, mat="stone", lamp="paper")


def saigo(K, s):
    """The statue and its pedestal: Saigo in his summer kimono, the dog Tsun on a leash at his left,
    looking south over the steps to the station square."""
    x, y = s["c"]
    z0 = s["z"]
    face = unit(np.array([0.35, -1.0]))
    P = frame((x, y), face)
    ph = HEIGHTS["saigo_pedestal"]
    block(K("granite"), P, -2.6, 2.6, -2.6, 2.6, z0, z0 + 0.6)
    block(K("granite"), P, -2.0, 2.0, -2.0, 2.0, z0 + 0.6, z0 + ph - 0.4)
    block(K("granite"), P, -2.3, 2.3, -2.3, 2.3, z0 + ph - 0.4, z0 + ph)
    zt = z0 + ph
    dk.figure(K, x, y, zt, HEIGHTS["saigo"], face, mat="bronze", robe=0.5)
    q = np.array([x, y]) + left_of(face) * 1.0 + face * 0.3
    dk.dog(K, q[0], q[1], zt, face, h=0.9, mat="bronze")


def landmark_meshes(scene):
    lm = scene["landmarks"]
    K = Kit("ueno", MATERIALS, floodlit=("vermilion", "gold"))
    if lm.get("ponds"):
        dk.pond_meshes(K, lm["ponds"], lotus=LOTUS, season_dry=True)
    if "ameyoko" in lm:
        ameyoko(K, lm["ameyoko"])
    if "benten" in lm:
        benten(K, lm["benten"])
    if "pagoda" in lm:
        p = lm["pagoda"]
        dk.pagoda(K, p["c"], p["axis"], p["z"], HEIGHTS["pagoda"], base_half=min(2.9, p["half"] * 0.55), podium=1.0,
                  mats={"wall": "vermilion", "post": "vermilion_dark", "roof": "tile", "bracket": "vermilion"})
    if "toshogu" in lm:
        toshogu(K, lm["toshogu"])
    if "saigo" in lm:
        saigo(K, lm["saigo"])
    return MATERIALS, K.meshes()


def landmark_assets(out_dir, scene):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (ATLAS.W, ATLAS.H), (30, 30, 34))
    d = ImageDraw.Draw(img)
    for i, (words, bg, ink, fname) in enumerate(BLADES):
        x, y, w, h = ATLAS.rects[f"blade{i}"]
        d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=bg)
        d.rectangle([x + 3, y + 3, x + w - 3, y + h - 3], outline=ink, width=2)
        jk.vertical(d, words.replace(" ", ""), x + w / 2, y + 10, y + h - 10, fname, ink, w - 12)
    for i, (words, bg, ink, fname) in enumerate(BOARDS):
        x, y, w, h = ATLAS.rects[f"board{i}"]
        d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=bg)
        jk.text(d, (x + w / 2, y + h / 2), words, fname, jk.fit(d, [words], fname, w - 24, h - 16, 80), ink)
    # the gate's board: アメ横 in red on white, the street's full name under it
    x, y, w, h = ATLAS.rects["ameyoko"]
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(246, 244, 238))
    d.rectangle([x + 6, y + 6, x + w - 6, y + h - 6], outline=(212, 0, 26), width=4)
    jk.text(d, (x + w * 0.38, y + h / 2), "アメ横", "dela", jk.fit(d, ["アメ横"], "dela", w * 0.6, h - 26, 110), (212, 0, 26))
    jk.text(d, (x + w * 0.82, y + h * 0.36), "上野", "zen", 30, (30, 30, 30))
    jk.text(d, (x + w * 0.82, y + h * 0.68), "AMEYOKO", "bebas", 30, (30, 30, 30))
    for key in ("kin", "kin_door"):   # gilt panels: a lacquer frame, lattice or doors, a band of coloured carving above
        x, y, w, h = ATLAS.rects[key]
        for k in range(h + 8):
            t = k / (h + 8)
            col = (int(214 + 30 * math.sin(t * 9.0)), int(166 + 26 * math.sin(t * 9.0)), int(58 + 14 * math.sin(t * 9.0)))
            d.line([(x - 4, y - 4 + k), (x + w + 4, y - 4 + k)], fill=col)
        d.rectangle([x, y, x + w, y + h], outline=(22, 18, 16), width=8)
        band = int(h * 0.22)
        for j, c in enumerate([(40, 110, 90), (190, 50, 40), (40, 70, 140), (230, 200, 90)]):
            d.ellipse([x + 14 + j * (w - 28) / 4, y + 12, x + 14 + (j + 1) * (w - 28) / 4 - 4, y + band], fill=c, outline=(22, 18, 16), width=2)
        d.line([(x, y + band + 6), (x + w, y + band + 6)], fill=(22, 18, 16), width=5)
        if key == "kin":
            for gx in range(x + 18, x + w - 8, 22):
                d.line([(gx, y + band + 12), (gx, y + h - 10)], fill=(90, 62, 22), width=3)
            for gy in range(y + band + 20, y + h - 8, 22):
                d.line([(x + 10, gy), (x + w - 10, gy)], fill=(90, 62, 22), width=3)
        else:
            d.line([(x + w / 2, y + band + 10), (x + w / 2, y + h - 8)], fill=(22, 18, 16), width=6)
            for sx in (x + 16, x + w / 2 + 10):
                d.rectangle([sx, y + band + 22, sx + w / 2 - 26, y + h - 22], outline=(120, 84, 28), width=4)
                d.ellipse([sx + 18, y + band + 50, sx + w / 2 - 44, y + band + 50 + (w / 2 - 62)], outline=(22, 18, 16), width=4)
    x, y, w, h = ATLAS.rects["toshogu"]
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(24, 22, 20))
    d.rectangle([x + 6, y + 6, x + w - 6, y + h - 6], outline=(222, 178, 72), width=4)
    jk.text(d, (x + w / 2, y + h / 2), "東照宮", "mincho", jk.fit(d, ["東照宮"], "mincho", w - 40, h - 24, 90), (222, 178, 72))
    img.save(f"{out_dir}/atlas.jpg", quality=90)
    return ["atlas.jpg"]


def landmark_glows(scene):
    """Ameyoko's light after dark, a pool every few shop fronts; the Toshogu approach's lanterns."""
    lm = scene["landmarks"]
    out = []
    for k, (x, y, nx, ny, g, top, L) in enumerate((lm.get("ameyoko") or {}).get("sites", [])):
        if k % 3 == 0:
            out.append([round(x + nx * 3.0, 1), round(y + ny * 3.0, 1), 8.0, ["#ffd9a0", "#ffffff", "#ffb070"][k % 3], 0.28])
    for k, (x, y, z) in enumerate((lm.get("toshogu") or {}).get("lanterns", [])):
        if k % 4 == 0:
            out.append([x, y, 6.0, "#ffcf8a", 0.2])
    b = lm.get("benten")
    if b:
        out.append([b["c"][0], b["c"][1], 16.0, "#ff9a6a", 0.3])
    return out


def woods_clear(scene):
    """No tree in the ponds, in the pagoda or the halls, or on the statue's pedestal."""
    lm = scene.get("landmarks", {})
    out = [p["ring"] for p in lm.get("ponds", [])]
    if "benten" in lm:
        out.append([*lm["benten"]["c"], lm["benten"]["r"] * 1.6])
    if "pagoda" in lm:
        out.append([*lm["pagoda"]["c"], 7.0])
    if "toshogu" in lm:
        out.append([*lm["toshogu"]["c"], 18.0])
    if "saigo" in lm:
        out.append([*lm["saigo"]["c"], 4.5])
    return out


# ---------------------------------------------------------------- the game

def game_extras(scene):
    lm = scene["landmarks"]
    spots, chatter, close = [], [], []
    b = lm.get("benten")
    if b:
        f = np.asarray(b["face"])
        p = np.asarray(b["c"]) + f * (b["r"] * 1.3 + 5.0)
        spots.append(dk.spot("benten", "Bentendo 弁天堂", p, b["z"], "Look at the hall",
                             ["Benzaiten, goddess of water, music and luck: the island was built for her in the 1600s, after Lake Biwa's Chikubushima.",
                              "The hall burned in the 1945 air raids; this one is from 1958. People still come to pray for luck in the arts."], 5.0))
        close.append(dk.close_to("Bentendo, the hall's front", np.asarray(b["c"]) + f * (b["r"] * 1.3 + 0.6), b["z"], p, 1.5))
    ponds = lm.get("ponds") or []
    lotus = next((p for p in ponds if p["name"] in LOTUS), None)
    if lotus:
        g = Polygon(lotus["ring"])
        q = g.exterior.interpolate(g.exterior.project(Point(-150.0, -250.0)))
        out = unit(np.array([q.x, q.y]) - np.array(g.centroid.coords[0]))
        at = np.array([q.x, q.y]) + out * 3.0
        spots.append(dk.spot("lotus", "Shinobazu Pond 不忍池", at, lotus["z"] + 0.5, "Look over the lotus",
                             ["In July and August the leaves stand a metre high and the flowers open at dawn. Now they're brown and dry, waiting for spring.",
                              "This was an inlet of Tokyo Bay once. The sea went out; the pond stayed."], 6.0))
    pg = lm.get("pagoda")
    if pg:
        at = np.asarray(pg["c"]) + np.array([-12.0, -14.0])
        spots.append(dk.spot("pagoda", "Kan'ei-ji pagoda 五重塔", at, pg["z"], "Look up at the pagoda",
                             ["Rebuilt in 1639, it has outlived the shogun's temple it belonged to, the 1868 battle on this hill, two earthquakes and the war.",
                              "It stands inside the zoo now. The pandas live a short walk away."], 6.0))
    t = lm.get("toshogu")
    if t:
        f = np.asarray(t["face"])
        at = np.asarray(t["c"]) + f * (t["hu"] + 9.0)
        spots.append(dk.spot("toshogu", "Ueno Toshogu 上野東照宮", at, t["z"], "Look at the gilt hall",
                             ["The Konjiki-den, the golden hall, 1651: Tokugawa Ieyasu's shrine. Gold leaf over the walls, black lacquer on the posts.",
                              "The lanterns along the approach were given by the daimyo, each with his name on it. Count them; there are about two hundred."], 6.0))
        close.append(dk.close_to("Toshogu, the Karamon", np.asarray(t["c"]) + f * (t["hu"] + 6.0 + 1.2), t["z"], at, 1.5))
    s = lm.get("saigo")
    if s:
        face = unit(np.array([0.35, -1.0]))
        at = np.asarray(s["c"]) + face * 8.0
        spots.append(dk.spot("saigo", "Saigo Takamori 西郷隆盛像", at, s["z"], "Look at the statue",
                             ["Saigo Takamori with his dog Tsun, 1898. He led the samurai who gave Edo back to the emperor, then rebelled and died.",
                              "His widow said at the unveiling that he never dressed like that in public. Everyone meets here anyway."], 5.0))
    a = lm.get("ameyoko")
    if a and a.get("gate"):
        g = a["gate"]
        at = np.asarray(g["c"]) - np.asarray(g["along"]) * 6.0
        spots.append(dk.spot("ame_gate", "Ameyoko アメ横", at, g["z"], "Look down the street",
                             ["Ameyoko: after the war, a black market under the tracks. Ame for the sweets sold here, or for America, for the army's goods.",
                              "Every December the whole of Tokyo comes for New Year's crab and salmon roe. Half a kilometre, elbow to elbow."], 5.0))
        x, y, nx, ny, gz, top, L = a["sites"][len(a["sites"]) // 2] if a["sites"] else (*g["c"], 0, 1, g["z"], 0, 0)
        chatter.append({"at": [x + nx * 4, y + ny * 4, gz], "radius": 14, "side": True,
                        "lines": [["Fishmonger", "Tuna, tuna! Three for a thousand!"], ["Shopper", "Three what? Slices?"], ["Fishmonger", "Blocks! Take two, I'll throw in roe."]]})
    return {"spots": spots, "chatter": chatter, "close": close}


def game_ponds(scene):
    """Shinobazu's ponds are water to the game: no walking on them (pipeline/game_data.py)."""
    return scene["landmarks"].get("ponds", [])
