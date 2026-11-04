"""Shinagawa and Takanawa, a map of Tokyo: what the generic pipeline cannot know from open data.

The model is the real district: Overture footprints at Project PLATEAU's surveyed heights on GSI's laser
bare earth, from Kita-Shinagawa and Gotenyama in the south to Sengakuji and Takanawa Gateway in the
north, the tracks between the Takanawa hills and Konan's towers. This file adds:

  * 高輪ゲートウェイ駅 Takanawa Gateway Station (Kengo Kuma, 2020): its roof of white membrane folded
    like paper over the concourse, its glass sides, on OpenStreetMap's footprint of the station
    (East Japan Railway Company); the plain block of the footprint is hidden.
  * 旧東海道品川宿 the old Tokaido's first post town south of the Yatsuyama bridge: the shops along the
    old road with their boards and blade signs (typical of the street; no real shop's sign), and the
    post town's lanterns.

Shinagawa is not one of Persona 5's districts; it is the southern gate of Tokyo, where the Shinkansen
and the airport trains stop.
"""
import math

import numpy as np
from shapely.geometry import LineString, Point, Polygon

import districtkit as dk
import japankit as jk
from japankit import Atlas, Kit, block, frame, lathe_at, unit, left_of

GATEWAY = "高輪ゲートウェイ"
OLD_TOKAIDO = [(-40.0, -694.0), (0.0, -783.0), (22.0, -835.0), (85.0, -933.0), (146.0, -1020.0)]
SIGN_CLASSES = {"", "commercial", "retail", "restaurant", "mixed_use", "house", "residential", "apartments", "office"}

MATERIALS = {
    "atlas": {"color": "#ffffff", "roughness": 0.7, "metalness": 0.0, "map": "atlas.jpg", "emissive_map": True, "glow": 1.2},
    "frame": {"color": "#26292e", "roughness": 0.5, "metalness": 0.5},
    "membrane": {"color": "#f4f2ec", "roughness": 0.6, "metalness": 0.0, "emissive": "#fff2dc", "glow": 0.7},
    "timber": {"color": "#c9a476", "roughness": 0.7, "metalness": 0.0},
    "glass": {"color": "#9fb6bc", "roughness": 0.08, "metalness": 0.3, "opacity": 0.45},
    "paper": {"color": "#f6efd9", "roughness": 0.9, "metalness": 0.0, "emissive": "#ffd9a0", "glow": 0.9},
}

BLADES = [("旧東海道", "#2b1a12", "#f2d16b", "mincho"), ("品川宿", "#f2e6c8", "#7a2a12", "mincho"), ("そば", "#1d1d1d", "#ffffff", "mincho"),
          ("和菓子", "#5a1a2a", "#f4e6c8", "mincho"), ("居酒屋", "#2b1a12", "#ffcf70", "mincho"), ("酒", "#f4f1ea", "#1a1a1a", "mincho"),
          ("薬局", "#ffffff", "#00915a", "zen"), ("寿司", "#f4f1ea", "#1a1a1a", "mincho"), ("喫茶", "#3b2a1e", "#f4e6c8", "mincho"),
          ("八百屋", "#00915a", "#ffffff", "zen"), ("呉服", "#4a2a5a", "#f4e6c8", "mincho"), ("理容", "#d4001a", "#ffffff", "zen")]
BOARDS = [("旧東海道 品川宿", "#2b1a12", "#f2d16b", "mincho"), ("手打ち そば", "#1d1d1d", "#ffffff", "mincho"), ("和菓子 創業", "#5a1a2a", "#f4e6c8", "mincho"),
          ("酒 たばこ", "#f4f1ea", "#1a1a1a", "mincho"), ("やきとり", "#3b2a1e", "#ffffff", "mincho"), ("喫茶 コーヒー", "#3b2a1e", "#f4e6c8", "mincho"),
          ("八百屋", "#00915a", "#ffffff", "zen"), ("品川宿 交流館", "#f2e6c8", "#7a2a12", "mincho")]
ATLAS = Atlas([(f"blade{i}", 64, 320) for i in range(len(BLADES))] + [(f"board{i}", 384, 96) for i in range(len(BOARDS))] + [("shuku_lantern", 128, 160)])


def adjust_building(b, cls, g, geoms, ctx):
    name = b["name"] or ""
    lm = ctx.landmarks
    if g.geom_type != "Polygon":
        return geoms
    geoms = jk.police_box(b, geoms)
    top = max((q[2] for q in geoms), default=0.0)
    if name == GATEWAY and g.area > 3000:
        c = g.centroid
        lm["_gateway"] = {"ring": [[round(x, 2), round(y, 2)] for x, y in g.exterior.coords], "z": round(ctx.ground(c.x, c.y), 2)}
        for q in geoms:
            ctx.hide(q)
        return geoms
    if (b["class"] or "") in SIGN_CLASSES and geoms and 20 < g.area < 1500 and 3 <= top <= 30 and LineString(OLD_TOKAIDO).distance(g) < 12:
        ctx.signs.append((g, top))
    return geoms


def finalize(ctx):
    C, lm = ctx.city, ctx.landmarks
    lm["shuku"] = {"sites": jk.sign_sites(C, ctx.signs, ctx.ground)}
    # the post town's paper lanterns, hung on brackets from the shop fronts along the old road (not on posts in it)
    lanterns = []
    for k, (x, y, nx, ny, g, top, L) in enumerate(jk.open_fronts(lm["shuku"]["sites"])):
        if k % 2 == 0:
            lanterns.append([round(x + nx * 0.7, 2), round(y + ny * 0.7, 2), round(g, 2), round(nx, 3), round(ny, 3)])
    lm["shuku"]["lanterns"] = lanterns
    ctx.labels["Shinagawa-shuku 品川宿"] = [22.0, -835.0, round(ctx.ground(22.0, -835.0) + 18, 1)]
    gw = lm.pop("_gateway", None)
    if gw:
        g = Polygon(gw["ring"])
        cc, ax, half = jk.footprint_frame(g)
        lm["gateway"] = {"c": dk.rnd(cc), "axis": dk.rnd(ax, 4), "hu": round(half[0], 2), "hv": round(min(half[1], 30.0), 2), "z": gw["z"]}
        ctx.labels["Takanawa Gateway Station 高輪ゲートウェイ駅"] = [round(cc[0], 1), round(cc[1], 1), round(gw["z"] + 30, 1)]


def gateway(K, gw):
    """The roof: folds across the station, each about 7 m, up and down by 2.5 m, highest over the middle of
    the concourse and coming down to the glass walls at the sides, on timber-clad columns."""
    P = frame(gw["c"], gw["axis"])
    hu, hv, z0 = gw["hu"], gw["hv"], gw["z"]
    n = max(4, int(2 * hu / 7.0))
    us = np.linspace(-hu, hu, n + 1)
    vs = np.linspace(-hv, hv, 9)
    zr = lambda i, v: z0 + 13.0 + (2.6 if i % 2 else 0.0) + 4.0 * (1 - (v / hv) ** 2)
    M = K("membrane", "lit")
    for i in range(n):
        for j in range(len(vs) - 1):
            a, b = P(us[i], vs[j], zr(i, vs[j])), P(us[i + 1], vs[j], zr(i + 1, vs[j]))
            c, d = P(us[i + 1], vs[j + 1], zr(i + 1, vs[j + 1])), P(us[i], vs[j + 1], zr(i, vs[j + 1]))
            M.quad(a, b, c, d)
            M.quad(d, c, b, a)
    for s in (-1, 1):   # the glass sides and the fold's edges
        for i in range(n):
            a, b = P(us[i], s * hv, z0), P(us[i + 1], s * hv, z0)
            c, d = P(us[i + 1], s * hv, zr(i + 1, s * hv)), P(us[i], s * hv, zr(i, s * hv))
            K("glass").quad(*((a, b, c, d) if s > 0 else (b, a, d, c)))
            K("timber").box(a, d, 0.5, 0.7)
    for i in range(1, n, 2):   # the columns under the folds
        for v in (-hv * 0.45, hv * 0.45):
            K("timber").box(P(us[i], v, z0), P(us[i], v, zr(i, v)), 0.8, 0.8)


def shuku(K, s, rng):
    jk.street_signs(K, ATLAS, s["sites"], ([f"board{i}" for i in range(len(BOARDS))], [f"blade{i}" for i in range(len(BLADES))]), rng, max_h=4.0)
    for x, y, z, nx, ny in s.get("lanterns", []):
        K("frame").box(np.array([x - nx * 0.7, y - ny * 0.7, z + 3.9]), np.array([x, y, z + 3.9]), 0.06, 0.06)
        ATLAS.wrap(K("atlas", "lit"), x, y, z + 3.0, z + 3.75, 0.24, "shuku_lantern", 12)


def landmark_meshes(scene):
    lm = scene["landmarks"]
    K = Kit("shina", MATERIALS)
    rng = np.random.default_rng(1601)
    if lm.get("shuku"):
        shuku(K, lm["shuku"], rng)
    if "gateway" in lm:
        gateway(K, lm["gateway"])
    return MATERIALS, K.meshes()


def landmark_assets(out_dir, scene):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (ATLAS.W, ATLAS.H), (30, 30, 34))
    d = ImageDraw.Draw(img)
    dk.draw_signs(d, ATLAS, BLADES, BOARDS)
    x, y, w, h = ATLAS.rects["shuku_lantern"]
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(246, 239, 217))
    for k in range(5):
        d.line([(x, y + 12 + k * (h - 24) / 4), (x + w, y + 12 + k * (h - 24) / 4)], fill=(200, 180, 140), width=2)
    jk.vertical(d, "品川宿", x + w / 2, y + 16, y + h - 16, "mincho", (30, 30, 30), w - 30)
    img.save(f"{out_dir}/atlas.jpg", quality=90)
    return ["atlas.jpg"]


def landmark_glows(scene):
    lm = scene["landmarks"]
    out = dk.sign_glows((lm.get("shuku") or {}).get("sites", []), every=3, colours=("#ffd9a0", "#fff1d0"), strength=0.22)
    for k, (x, y, z, nx, ny) in enumerate((lm.get("shuku") or {}).get("lanterns", [])):
        if k % 3 == 0:
            out.append([x, y, 6.0, "#ffcf8a", 0.22])
    if "gateway" in lm:
        out.append([*lm["gateway"]["c"], 40.0, "#fff2dc", 0.3])
    return out


def game_extras(scene):
    lm = scene["landmarks"]
    spots, chatter, close = [], [], []
    gw = lm.get("gateway")
    if gw:
        ax = np.asarray(gw["axis"])
        at = np.asarray(gw["c"]) + left_of(ax) * (gw["hv"] + 14.0)
        spots.append(dk.spot("gateway", "Takanawa Gateway Station 高輪ゲートウェイ駅", at, gw["z"], "Look at the station",
                             ["Takanawa Gateway, 2020: the Yamanote line's first new station in fifty years. Kengo Kuma folded its roof like origami.",
                              "They found the stone embankment of 1872 under the yard while building it: Japan's first railway ran on it along the shore."], 8.0))
    sh = lm.get("shuku") or {}
    if sh.get("sites"):
        x, y, nx, ny, g, top, L = sh["sites"][len(sh["sites"]) // 2]
        spots.append(dk.spot("shuku", "Shinagawa-shuku 品川宿", [x + nx * 3, y + ny * 3], g, "Look along the old road",
                             ["The old Tokaido: the first post town out of Edo on the road to Kyoto. Travellers spent their last night in the city here.",
                              "The road is the same width it was in 1700. The shops are newer, mostly."], 6.0))
        chatter.append({"at": [x + nx * 4, y + ny * 4, g], "radius": 12, "side": True,
                        "lines": [["Walker", "Is this really the Tokaido?"], ["Shopkeeper", "Nihonbashi that way, Kyoto that way. Five hundred kilometres. Mind the bicycles."]]})
    return {"spots": spots, "chatter": chatter, "close": close}
