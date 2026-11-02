"""Asakusa, a map of Tokyo: what the generic pipeline cannot know from open data.

The model is the real district: Overture footprints at Project PLATEAU's surveyed heights. This file
builds the landmarks in code from published dimensions, placed on OpenStreetMap's footprints of them
(via Overture), and hides the plain blocks the survey has for them.

Senso-ji (金龍山浅草寺), along its approach from the Kaminarimon to the main hall:
  * 雷門 Kaminarimon: a gabled eight-legged gate, 11.7 m high (OpenStreetMap; Senso-ji), vermilion,
    its tiled roof grey. Under it the great red lantern: 3.9 m tall, 3.3 m across, about 700 kg, 雷門 on
    the front and 風雷神門 on the back, a black lacquered ring with a carved dragon underneath (Senso-ji;
    the lantern was renewed in 2020). Fujin and Raijin in the front bays, behind wire screens.
  * 仲見世 Nakamise: about 250 m of shops along the approach; the shop blocks are the survey's, given
    their vermilion fronts here.
  * 宝蔵門 Hozomon: a two-storey gate (二重門, irimoya roofs), 21.7 m high (OpenStreetMap; Senso-ji
    gives 22.7 m to the ridge ornaments); the 小舟町 lantern, 3.75 m tall and 2.7 m across, between two
    bronze tsuri-doro; the giant straw sandals, 4.5 m by 1.5 m, on the back.
  * 五重塔 the five-storey pagoda: 53.32 m to the tip of its finial (OpenStreetMap; Senso-ji), five
    pyramidal roofs over a stone podium, the bronze sorin with nine rings.
  * 本堂 the main hall (Kannon-do): 29.4 m (OpenStreetMap), a steep irimoya roof of grey titanium tiles
    (re-roofed 2010), vermilion posts and the 志ちやうちん lantern in the front bay; the bronze incense
    burner (常香炉) in front of it.

Tokyo Skytree (東京スカイツリー), 634 m (Tobu Tower Skytree): a triangle 68 m a side at the foot whose
section rounds into a circle by about 320 m; the Tembo Deck at 340-350 m and the Tembo Galleria at
445-450 m; the antenna mast above. The white lattice ("Skytree White", a pale indigo-white) is an
approximation of its diagrid; after dark it is lit, one day the pale blue of 粋 (Iki), the next the
purple of 雅 (Miyabi).

The Asahi Beer Hall's Flamme d'Or (Philippe Starck, 1989), a golden flame 44 m long on the black hall
(OpenStreetMap's 44.1 m); the Asahi headquarters' amber glass with its white crown, a glass of beer.

Persona 5 sends its players here by a book (Shitamachi Reborn): the game's Asakusa is the Kaminarimon,
Nakamise and the Skytree across the river. Nothing of the game's art is copied.
"""
import math

import numpy as np
from shapely.geometry import Point, Polygon

import japankit as jk
from japankit import Atlas, Kit, block, frame, lathe_at, slab_at, taper, unit, left_of

KAMINARIMON, HOZOMON, PAGODA, HONDO = "雷門", "宝蔵門", "五重塔", "本殿"
SKYTREE = "東京スカイツリー"
DRY_HALL, ASAHI_HQ = "スーパードライホール", "アサヒビール本社ビル"
NAKAMISE = (139.7965, 35.7123)   # the middle of the approach (Overture land use 仲見世商店街)

# published heights (Senso-ji; OpenStreetMap): PLATEAU's roof surveys stop short of the ridges' ornaments
# and the pagoda's finial
HEIGHTS = {"kaminarimon": 11.7, "hozomon": 21.7, "pagoda": 53.32, "hondo": 29.4}
TREE = {"height": 634.0, "side": 68.0, "round_at": 320.0, "deck": [340.0, 350.0], "galleria": [445.0, 450.0], "mast_from": 497.0}

MATERIALS = {
    "vermilion": {"color": "#c8402c", "roughness": 0.6, "metalness": 0.0, "emissive": "#ff7a4a", "glow": 0.5},
    "vermilion_dark": {"color": "#8e2a1f", "roughness": 0.65, "metalness": 0.0},
    "tile": {"color": "#5d6168", "roughness": 0.7, "metalness": 0.15},
    "tile_ti": {"color": "#7c8189", "roughness": 0.45, "metalness": 0.55},
    "soffit": {"color": "#b8452f", "roughness": 0.8, "metalness": 0.0},
    "white_wall": {"color": "#efeae0", "roughness": 0.85, "metalness": 0.0},
    "wood_dark": {"color": "#3e2b22", "roughness": 0.85, "metalness": 0.0},
    "stone": {"color": "#9a968e", "roughness": 0.9, "metalness": 0.0},
    "stone_dark": {"color": "#6e6b65", "roughness": 0.9, "metalness": 0.0},
    "bronze": {"color": "#4c4234", "roughness": 0.45, "metalness": 0.75},
    "gold": {"color": "#d8a840", "roughness": 0.28, "metalness": 0.9},
    "lacquer": {"color": "#1a1614", "roughness": 0.35, "metalness": 0.2},
    "straw": {"color": "#c8b07a", "roughness": 0.95, "metalness": 0.0},
    "wire": {"color": "#2a2a2a", "roughness": 0.7, "metalness": 0.3, "opacity": 0.55},
    "statue_red": {"color": "#a8352a", "roughness": 0.6, "metalness": 0.1},
    "statue_green": {"color": "#3f6d58", "roughness": 0.6, "metalness": 0.1},
    # the lanterns: paper and their words, lit from inside after dark
    "atlas": {"color": "#ffffff", "roughness": 0.75, "metalness": 0.0, "map": "atlas.jpg", "emissive_map": True, "glow": 0.9},
    "lamp": {"color": "#f6ecd2", "roughness": 0.6, "metalness": 0.0, "emissive": "#ffcf80", "glow": 2.0},
    # Skytree: white steel, its decks' glass, lit after dark in Iki's blue or Miyabi's purple, a day each
    "tree_steel": {"color": "#e6e9ef", "roughness": 0.5, "metalness": 0.35, "emissive": "#7fd0ff", "glow": 1.1,
                   "emissive_cycle": ["#7fd0ff", "#b77dff"]},
    "tree_core": {"color": "#c9ccd2", "roughness": 0.6, "metalness": 0.2, "emissive": "#5ab4f0", "glow": 0.45,
                  "emissive_cycle": ["#5ab4f0", "#9a5ee8"]},
    "tree_deck": {"color": "#d9dce2", "roughness": 0.45, "metalness": 0.4, "emissive": "#ffffff", "glow": 0.7},
    "tree_glass": {"color": "#5b6b7a", "roughness": 0.1, "metalness": 0.55, "emissive": "#ffe9c8", "glow": 0.6},
    "tree_floor": {"color": "#8d8f93", "roughness": 0.7, "metalness": 0.1},
    "aviation": {"color": "#ff3b30", "roughness": 0.5, "metalness": 0.0, "emissive": "#ff2a1a", "glow": 3.0},
    "flame": {"color": "#e0a636", "roughness": 0.22, "metalness": 0.95, "emissive": "#ffc463", "glow": 0.5},
    "hall_black": {"color": "#141416", "roughness": 0.35, "metalness": 0.3},
}

# the atlas: the lanterns' words and the plaques, drawn with open fonts
LANTERNS = {
    # key: (width px, height px, paper colour, words, ink, font)
    "kaminari_front": (768, 768, (196, 32, 26), "雷門", (18, 14, 12), "syuku"),
    "kaminari_back": (768, 768, (196, 32, 26), "風雷神門", (18, 14, 12), "syuku"),
    "kobuna": (768, 768, (196, 32, 26), "小舟町", (18, 14, 12), "syuku"),
    "hondo": (768, 768, (196, 32, 26), "志ちやうちん", (18, 14, 12), "syuku"),
    "nakamise": (384, 384, (226, 64, 40), "仲見世", (250, 244, 230), "mincho"),
    "chochin_w": (256, 256, (246, 238, 220), "浅草", (170, 30, 26), "syuku"),
}
PLAQUES = {
    "kinryuzan": (512, 192, (28, 24, 20), "金龍山", (222, 178, 72), "mincho"),
    "sensoji": (512, 192, (28, 24, 20), "浅草寺", (222, 178, 72), "mincho"),
}
ATLAS = Atlas([(k, w, h) for k, (w, h, *_) in {**LANTERNS, **PLAQUES}.items()])


# ---------------------------------------------------------------- anchors from the data

def _extent(g, o, ax):
    """The footprint's extent along the approach axis ax (u) and across it (v), from o."""
    cs = np.asarray(g.exterior.coords) - np.asarray(o)
    u, v = cs @ ax, cs @ left_of(ax)
    return float(u.min()), float(u.max()), float(v.min()), float(v.max())


def adjust_building(b, cls, g, geoms, ctx):
    name = b["name"] or ""
    lm = ctx.landmarks
    if g.geom_type != "Polygon":
        return geoms
    geoms = jk.police_box(b, geoms)
    top = max((q[2] for q in geoms), default=0.0)
    c = g.centroid
    if name in (KAMINARIMON, HOZOMON, PAGODA, HONDO) and g.distance(Point(*ctx.city.fwd.transform(*NAKAMISE))) < 260:
        lm.setdefault("_senso", {})[name] = {"ring": [[round(x, 2), round(y, 2)] for x, y in g.exterior.coords],
                                             "c": [round(c.x, 2), round(c.y, 2)], "ground_m": round(ctx.ground(c.x, c.y), 2),
                                             "top_m": round(top, 1)}
        for q in geoms:
            ctx.hide(q)
        return geoms
    if name == SKYTREE and top > 300:
        cs = np.asarray(g.convex_hull.exterior.coords)[:-1]
        d = cs - np.array([c.x, c.y])
        apex = d[int(np.argmax((d ** 2).sum(1)))]
        lm["skytree"] = {"centre": [round(c.x, 2), round(c.y, 2)], "ground_m": round(ctx.ground(c.x, c.y), 2),
                         "apex_deg": round(math.degrees(math.atan2(apex[1], apex[0])), 2), **TREE}
        for q in geoms:
            ctx.hide(q)
        return geoms
    if name == DRY_HALL:
        cen, ax, half = jk.footprint_frame(g)
        lm["flame"] = {"centre": [round(float(cen[0]), 2), round(float(cen[1]), 2)], "axis": [round(float(ax[0]), 4), round(float(ax[1]), 4)],
                       "half": [round(half[0], 2), round(half[1], 2)], "roof_m": round(ctx.ground(c.x, c.y) + top, 2)}
        b["facade_color"] = "#18181a"   # black granite
    if name == ASAHI_HQ:
        b["facade_color"] = "#c98a2a"   # the amber glass of a glass of beer
    if top < 9 and g.area < 600 and not name.endswith("交番") and g.distance(nakamise_line(ctx)) < 6.0:
        b["facade_color"] = "#b4412d"   # Nakamise's vermilion shop fronts, the low rows either side of the approach
    return geoms


_LINE = {}


def nakamise_line(ctx):
    """Nakamise's footway between the gates (OpenStreetMap's 仲見世通り), cached."""
    if "line" not in _LINE:
        from shapely.ops import unary_union
        rows = jk.overture(ctx.city, "segment", "name = '仲見世通り'")
        _LINE["line"] = unary_union([r["geom"] for r in rows]) if rows else Point(1e9, 1e9)
    return _LINE["line"]


def finalize(ctx):
    lm = ctx.landmarks
    s = lm.pop("_senso", {})
    if KAMINARIMON in s and HONDO in s:
        k, h = s[KAMINARIMON], s[HONDO]
        ax = unit(np.asarray(k["c"]) - np.asarray(h["c"]))   # the approach, from the hall out to the gate (south)
        out = {"axis": [round(float(ax[0]), 5), round(float(ax[1]), 5)]}
        for key, name in (("kaminarimon", KAMINARIMON), ("hozomon", HOZOMON), ("pagoda", PAGODA), ("hondo", HONDO)):
            if name not in s:
                continue
            e = s[name]
            g = Polygon(e["ring"])
            u0, u1, v0, v1 = _extent(g, e["c"], ax)
            mid = np.asarray(e["c"]) + ax * (u0 + u1) / 2 + left_of(ax) * (v0 + v1) / 2
            out[key] = {"c": [round(float(mid[0]), 2), round(float(mid[1]), 2)], "half_u": round((u1 - u0) / 2, 2),
                        "half_v": round((v1 - v0) / 2, 2), "z": e["ground_m"], "top_m": HEIGHTS[key], "survey_m": e["top_m"]}
        lm["sensoji"] = out
        labels = {"kaminarimon": "Kaminarimon 雷門", "hozomon": "Hozomon 宝蔵門", "pagoda": "Five-storey Pagoda 五重塔", "hondo": "Senso-ji 浅草寺"}
        for key, lab in labels.items():
            if key in out:
                o = out[key]
                ctx.labels[lab] = [o["c"][0], o["c"][1], round(o["z"] + o["top_m"] + 4, 1)]
    t = lm.get("skytree")
    if t:
        ctx.labels["Tokyo Skytree 東京スカイツリー"] = [t["centre"][0], t["centre"][1], round(t["ground_m"] + t["height"] + 8, 1)]
    f = lm.get("flame")
    if f:
        ctx.labels["Asahi Beer Hall アサヒビールホール"] = [f["centre"][0], f["centre"][1], round(f["roof_m"] + 20, 1)]


# ---------------------------------------------------------------- Senso-ji

def gate_posts(K, P, hu, hv, z0, z1, nv=4, nu=3, r=0.32):
    for u in np.linspace(-hu, hu, nu):
        for v in np.linspace(-hv, hv, nv):
            lathe_at(K("stone_dark"), *P(u, v, 0)[:2], [(z0, r * 1.5), (z0 + 0.35, r * 1.35), (z0 + 0.4, r)], 10)
            lathe_at(K("vermilion"), *P(u, v, 0)[:2], [(z0 + 0.4, r), (z1, r * 0.92)], 12)


def kirizuma(K, P, hu, hv, z_eave, z_ridge, ov_u, ov_v, k=1.5):
    """A gabled roof with its ridge along v (across the approach), its slopes curving down to the eaves
    at the front and back, the gable boards at the ends, the ridge and its end tiles."""
    us = np.linspace(-(hu + ov_u), hu + ov_u, 15)
    Eu = hu + ov_u
    zr = lambda u: z_eave + (z_ridge - z_eave) * (1 - abs(u) / Eu) ** (1 / k)
    vs = np.linspace(-(hv + ov_v), hv + ov_v, 5)
    K("tile").grid([[P(u, v, zr(u) + (0.25 if abs(v) > hv + ov_v - 0.1 else 0)) for v in vs] for u in us])
    for sv in (-1, 1):
        vv = sv * (hv + ov_v * 0.8)
        for a, b in zip(us, us[1:]):
            K("vermilion_dark").quad(P(a, vv, zr(a) - 0.5), P(b, vv, zr(b) - 0.5), P(b, vv, zr(b)), P(a, vv, zr(a)))
            K("soffit").quad(P(a, sv * hv, z_eave - 0.3), P(b, sv * hv, z_eave - 0.3), P(b, vv, zr(b) - 0.5), P(a, vv, zr(a) - 0.5))
    for su in (-1, 1):
        K("soffit").quad(P(su * Eu, -(hv + ov_v), z_eave - 0.4), P(su * Eu, hv + ov_v, z_eave - 0.4), P(su * hu, hv, z_eave - 0.6), P(su * hu, -hv, z_eave - 0.6))
    block(K("tile"), P, -0.45, 0.45, -(hv + ov_v), hv + ov_v, z_ridge - 0.1, z_ridge + 0.7)
    for sv in (-1, 1):
        taper(K("tile"), P, 0, sv * (hv + ov_v - 0.4), 1.2, 0.6, z_ridge + 0.5, 0.5, 0.4, z_ridge + 2.0)


def lantern_big(K, x, y, z_top, h, d, front, back, P):
    """A great paper lantern hung from a gate: the black lacquered ring at the top and bottom (the
    bottom carved with a dragon, here a gilt boss), the paper body with its words front and back."""
    r = d / 2
    zt, zb = z_top - 0.45, z_top - h + 0.45
    lathe_at(K("lacquer"), x, y, [(zt, r * 0.82), (zt + 0.08, r * 0.86), (z_top, r * 0.8), (z_top + 0.02, 0.0)], 24)
    lathe_at(K("lacquer"), x, y, [(z_top - h, 0.0), (z_top - h + 0.02, r * 0.78), (zb - 0.08, r * 0.86), (zb, r * 0.82)], 24)
    lathe_at(K("gold"), x, y, [(z_top - h - 0.2, 0.0), (z_top - h - 0.12, r * 0.3), (z_top - h - 0.02, r * 0.35), (z_top - h, 0.0)], 16)
    # the body bulges: two drums with the words, and the bulge's paper between them
    prof = [(zb + (zt - zb) * t, r * (0.82 + 0.18 * math.sin(math.pi * t))) for t in np.linspace(0, 1, 9)]
    m = K("atlas", "lit")
    for (za, ra), (zb_, rb) in zip(prof, prof[1:]):
        rr = (ra + rb) / 2
        # half the drum shows the front's words, half the back's
        for key, a0 in ((front, -math.pi / 2), (back, math.pi / 2)):
            u0, v0, u1, v1 = ATLAS.uv(key)
            seg = 12
            for kk in range(seg):
                a = a0 + math.pi * kk / seg - math.pi / 2
                b = a0 + math.pi * (kk + 1) / seg - math.pi / 2
                fa, fb = kk / seg, (kk + 1) / seg
                ta, tb = (za - zb) / (zt - zb), (zb_ - zb) / (zt - zb)
                pa = lambda ang, z, r_: np.array([x + r_ * math.cos(ang), y + r_ * math.sin(ang), z])
                # angles in the gate's frame: turn by the frame's heading
                m.quad(pa(a + P.heading, za, ra), pa(b + P.heading, za, ra), pa(b + P.heading, zb_, rb), pa(a + P.heading, zb_, rb),
                       [[u0 + (u1 - u0) * (1 - fa), v0 + (v1 - v0) * ta], [u0 + (u1 - u0) * (1 - fb), v0 + (v1 - v0) * ta],
                        [u0 + (u1 - u0) * (1 - fb), v0 + (v1 - v0) * tb], [u0 + (u1 - u0) * (1 - fa), v0 + (v1 - v0) * tb]])


def framed(o, ax):
    P = frame(o, ax)
    P.heading = math.atan2(ax[1], ax[0])   # the frame's u axis, as an angle
    return P


def statue(K, P, u, v, z0, mat, h=2.6):
    """A guardian in his bay: a robed figure on a rock, the scarf (Fujin's wind bag, Raijin's drums) a hoop."""
    taper(K("stone_dark"), P, u, v, 1.4, 1.2, z0, 1.2, 1.0, z0 + 0.6)
    taper(K(mat), P, u, v, 1.1, 0.8, z0 + 0.6, 0.8, 0.6, z0 + 0.6 + h * 0.6)
    x, y, _ = P(u, v, 0)
    lathe_at(K(mat), x, y, [(z0 + 0.6 + h * 0.6, 0.3), (z0 + 0.6 + h * 0.75, 0.32), (z0 + 0.6 + h * 0.92, 0.26), (z0 + 0.6 + h, 0.0)], 10)
    ring = [P(u + 0.2 * math.cos(a), v + 0.75 * math.sin(a), z0 + 0.6 + h * 0.85 + 0.55 * math.cos(a)) for a in np.linspace(0, 2 * math.pi, 17)]
    K("gold").tube(ring, 0.06, 5)


def kaminarimon(K, g, ax):
    o = np.asarray(g["c"])
    P = framed(o, ax)       # u: out of the precinct (south), v: across
    z0 = g["z"]
    hu, hv = min(g["half_u"], 4.5), min(g["half_v"], 6.2)
    ridge = z0 + g["top_m"]
    block(K("stone"), P, -hu - 0.6, hu + 0.6, -hv - 0.6, hv + 0.6, z0 - 0.4, z0 + 0.2)
    zb = z0 + 0.2
    zh = ridge - 4.6       # the tie beams under the roof
    gate_posts(K, P, hu - 0.3, hv - 0.3, zb, zh, nv=4, nu=3)
    for u in (-hu + 0.3, hu - 0.3):
        block(K("vermilion"), P, u - 0.25, u + 0.25, -hv, hv, zh - 0.8, zh)
        block(K("vermilion"), P, u - 0.2, u + 0.2, -hv, hv, zb + 2.6, zb + 2.95)
    block(K("vermilion"), P, -hu + 0.1, hu - 0.1, -hv, hv, zh, zh + 0.9)      # the frieze of brackets, as a band
    for v in np.linspace(-hv + 0.4, hv - 0.4, 9):
        block(K("gold"), P, hu - 0.05, hu + 0.02, v - 0.2, v + 0.2, zh + 0.2, zh + 0.65)
        block(K("gold"), P, -hu - 0.02, -hu + 0.05, v - 0.2, v + 0.2, zh + 0.2, zh + 0.65)
    kirizuma(K, P, hu, hv, zh + 0.9, ridge - 0.6, ov_u=2.4, ov_v=1.2)
    # the side bays: walls with the guardians behind a screen of wire, front (Fujin, Raijin) and back
    mid = (hv - 0.3) / 3
    for sv, mat in ((1, "statue_green"), (-1, "statue_red")):
        v = sv * (hv - 0.3 - mid)
        block(K("white_wall"), P, -0.15, 0.15, v - mid, v + mid, zb, zh - 0.8)
        statue(K, P, hu * 0.5, v, zb, mat)
        statue(K, P, -hu * 0.5, v, zb, "gold" if sv > 0 else "bronze", 2.2)
        for su in (-1, 1):
            K("wire").quad(P(su * (hu - 0.32), v - mid, zb + 0.3), P(su * (hu - 0.32), v + mid, zb + 0.3),
                           P(su * (hu - 0.32), v + mid, zh - 0.8), P(su * (hu - 0.32), v - mid, zh - 0.8))
    # the plaque 金龍山 on the back, over the passage
    ATLAS.quad(K("atlas"), P(-hu - 0.05, 1.3, zh - 0.75), P(-hu - 0.05, -1.3, zh - 0.75), P(-hu - 0.05, -1.3, zh + 0.2), P(-hu - 0.05, 1.3, zh + 0.2), "kinryuzan")
    # the lantern, hung in the middle of the passage
    x, y, _ = P(0, 0, 0)
    lantern_big(K, x, y, zh - 0.8, 3.9, 3.3, "kaminari_front", "kaminari_back", P)
    return {"lantern": [round(float(x), 2), round(float(y), 2), round(zh - 0.8 - 2.0, 2)]}


def hozomon(K, g, ax):
    o = np.asarray(g["c"])
    P = framed(o, ax)
    z0 = g["z"]
    hu, hv = min(g["half_u"], 5.0), min(g["half_v"], 10.5)
    top = z0 + g["top_m"]
    block(K("stone"), P, -hu - 0.8, hu + 0.8, -hv - 0.8, hv + 0.8, z0 - 0.3, z0 + 0.6)
    zb = z0 + 0.6
    z1 = zb + 7.2          # the lower roof's eaves
    gate_posts(K, P, hu - 0.4, hv - 0.4, zb, z1 - 0.6, nv=6, nu=3, r=0.4)
    block(K("vermilion"), P, -hu + 0.1, hu - 0.1, -hv + 0.1, hv - 0.1, z1 - 0.6, z1 + 0.5)
    jk.hip_roof(K("tile"), K("soffit"), P, hu, hv, z1 + 0.5, z1 + 2.6, ov=2.6, k=1.0, ridge_frac=0.0)
    # the upper storey: a white-walled hall with vermilion posts and its balcony
    hu2, hv2 = hu - 1.0, hv - 1.6
    z2 = z1 + 2.6
    block(K("vermilion_dark"), P, -hu2 - 0.9, hu2 + 0.9, -hv2 - 0.9, hv2 + 0.9, z2 - 0.2, z2 + 0.2)
    block(K("white_wall"), P, -hu2, hu2, -hv2, hv2, z2 + 0.2, z2 + 4.6)
    for u in np.linspace(-hu2, hu2, 3):
        for v in np.linspace(-hv2, hv2, 6):
            slab_at(K("vermilion"), P, u, v, 0.45, 0.45, z2 + 0.2, z2 + 4.8)
    block(K("vermilion"), P, -hu2 - 0.1, hu2 + 0.1, -hv2 - 0.1, hv2 + 0.1, z2 + 4.6, z2 + 5.4)
    R = jk.irimoya(K("tile"), K("vermilion_dark", "gable"), K("soffit"), lambda u, v, z: P(v, u, z), hv2, hu2, z2 + 5.4, top - 0.8, ov=3.0, gable_at=0.5)
    block(K("tile"), P, -0.45, 0.45, -R["Ug"] - 0.4, R["Ug"] + 0.4, top - 1.0, top - 0.3)
    for sv in (-1, 1):
        taper(K("gold"), P, 0, sv * (R["Ug"] + 0.2), 1.0, 0.5, top - 0.5, 0.3, 0.3, top + 1.0)
    # the 小舟町 lantern between two bronze tsuri-doro, under the lower roof
    x, y, _ = P(0, 0, 0)
    lantern_big(K, x, y, z1 - 0.6, 3.75, 2.7, "kobuna", "kobuna", P)
    for sv in (-1, 1):
        xx, yy, _ = P(0, sv * 3.0, 0)
        zt = z1 - 0.6
        lathe_at(K("bronze"), xx, yy, [(zt - 2.6, 0.0), (zt - 2.5, 0.5), (zt - 2.2, 0.42), (zt - 1.0, 0.55), (zt - 0.9, 0.95), (zt - 0.5, 0.25), (zt, 0.1)], 6)
    # the sandals on the back
    for sv in (-1, 1):
        v = sv * (hv - 2.6)
        block(K("straw"), P, -hu - 0.05, -hu + 0.25, v - 0.75, v + 0.75, zb + 1.2, zb + 5.7)
    return {"lantern": [round(float(x), 2), round(float(y), 2), round(z1 - 2.6, 2)]}


def pagoda(K, g, ax):
    """Five storeys whose roofs dominate, as a pagoda's do: short walls under deep eaves, each storey a
    little narrower, the bracket bands under the eaves, the bronze sorin with its nine rings."""
    o = np.asarray(g["c"])
    P = framed(o, ax)
    z0 = g["z"]
    tip = z0 + g["top_m"]
    base = min(g["half_u"], g["half_v"], 9.0)
    block(K("stone"), P, -base, base, -base, base, z0, z0 + 1.6)          # the podium (it holds a hall below)
    zb = z0 + 1.6
    sorin = 9.7
    zt = tip - sorin
    h = (zt - zb) / 5.0
    for s in range(5):
        w = 4.9 * (1 - 0.07 * s)
        za = zb + s * h
        zw = za + h * 0.36                                               # the walls' top
        block(K("white_wall"), P, -w, w, -w, w, za, zw)
        for u in np.linspace(-w, w, 4):
            for sgn in (-1, 1):
                slab_at(K("vermilion"), P, u, sgn * w, 0.4, 0.4, za, zw)
                slab_at(K("vermilion"), P, sgn * w, u, 0.4, 0.4, za, zw)
        # the brackets: two bands stepping out under the eaves
        block(K("vermilion"), P, -w - 0.5, w + 0.5, -w - 0.5, w + 0.5, zw, zw + h * 0.12)
        block(K("vermilion_dark"), P, -w - 1.2, w + 1.2, -w - 1.2, w + 1.2, zw + h * 0.12, zw + h * 0.22)
        ze = zw + h * 0.22
        E = w + 1.2 + 2.6 - 0.12 * s
        if s < 4:   # the roof runs up into the next storey's walls, so no gap shows between them
            w2 = 4.9 * (1 - 0.07 * (s + 1))
            H = (za + h - ze) / ((E - w2 + 0.3) / E) ** 1.7
        else:
            H = h * 0.34
        jk.hip_roof(K("tile_ti"), K("soffit"), P, w + 1.2, w + 1.2, ze, ze + H, ov=2.6 - 0.12 * s, k=1.7)
        # the balcony rail of the storey above sits on the roof
        if s < 4:
            w2 = 4.9 * (1 - 0.07 * (s + 1))
            block(K("vermilion_dark"), P, -w2 - 0.6, w2 + 0.6, -w2 - 0.6, w2 + 0.6, za + h - 0.15, za + h + 0.1)
    x, y, _ = P(0, 0, 0)
    lathe_at(K("bronze"), x, y, [(zt - 0.6, 1.8), (zt + 0.6, 1.5), (zt + 0.7, 0.4), (tip - 0.6, 0.18), (tip, 0.0)], 12)
    for k in range(9):   # the nine rings
        z = zt + 1.2 + k * (sorin - 3.2) / 9
        lathe_at(K("bronze"), x, y, [(z, 0.0), (z + 0.05, 0.85 - 0.03 * k), (z + 0.22, 0.85 - 0.03 * k), (z + 0.27, 0.0)], 12)
    lathe_at(K("gold"), x, y, [(tip - 1.6, 0.0), (tip - 1.3, 0.45), (tip - 0.9, 0.3), (tip - 0.6, 0.0)], 12)


def hondo(K, g, ax):
    o = np.asarray(g["c"])
    P = framed(o, ax)
    z0 = g["z"]
    hu, hv = min(g["half_u"], 17.0), min(g["half_v"], 17.0)
    ridge = z0 + g["top_m"]
    zp = z0 + 2.4                                    # the raised floor and its veranda
    block(K("stone"), P, -hu, hu, -hv, hv, z0 - 0.3, z0 + 1.0)
    block(K("wood_dark"), P, -hu + 0.6, hu - 0.6, -hv + 0.6, hv - 0.6, z0 + 1.0, zp)
    for j in range(8):                               # the front steps, the full width of the middle bays
        uu = hu - 0.6 + (8 - j) * 0.45
        block(K("stone"), P, hu - 0.6, uu, -6.0, 6.0, z0, z0 + 1.0 + (j + 1) * (zp - z0 - 1.0) / 8)
    hu_w, hv_w = hu - 3.6, hv - 3.6
    zw = zp + 7.5
    block(K("white_wall"), P, -hu_w, hu_w - 2.0, -hv_w, hv_w, zp, zw)
    for u in np.linspace(-hu + 1.0, hu - 1.0, 7):
        for v in np.linspace(-hv + 1.0, hv - 1.0, 7):
            if abs(u) < hu - 1.2 and abs(v) < hv - 1.2 and not (u > hu_w - 2.2):
                continue
            lathe_at(K("vermilion"), *P(u, v, 0)[:2], [(zp, 0.42), (zw, 0.4)], 12)
    block(K("vermilion"), P, -hu + 0.6, hu - 0.6, -hv + 0.6, hv - 0.6, zw, zw + 1.6)   # the bracket band
    jk.irimoya(K("tile_ti"), K("vermilion_dark", "gable"), K("soffit"), lambda u, v, z: P(v, u, z), hv - 0.6, hu - 0.6, zw + 1.6, ridge - 0.7, ov=3.4, gable_at=0.62, k=1.8)
    block(K("tile_ti"), P, -0.8, 0.8, -hv * 0.42, hv * 0.42, ridge - 0.9, ridge)
    for sv in (-1, 1):
        taper(K("tile_ti"), P, 0, sv * hv * 0.42, 2.2, 1.0, ridge - 0.5, 0.8, 0.6, ridge + 1.8)
    # the plaque 浅草寺 and the 志ちやうちん lantern in the front bay
    ATLAS.quad(K("atlas"), P(hu - 0.55, -2.2, zw - 1.6), P(hu - 0.55, 2.2, zw - 1.6), P(hu - 0.55, 2.2, zw), P(hu - 0.55, -2.2, zw), "sensoji")
    x, y, _ = P(hu - 2.4, 0, 0)
    lantern_big(K, x, y, zw - 1.8, 3.9, 3.0, "hondo", "hondo", P)
    # the incense burner in front, on the approach
    xi, yi, _ = P(hu + 14.0, 0, 0)
    zi = z0
    lathe_at(K("bronze"), xi, yi, [(zi, 1.3), (zi + 0.5, 1.2), (zi + 0.6, 1.6), (zi + 1.1, 1.7), (zi + 1.2, 0.6), (zi + 2.2, 0.5), (zi + 2.3, 1.4), (zi + 2.7, 0.6), (zi + 3.2, 0.0)], 8)
    return {"incense": [round(float(xi), 2), round(float(yi), 2), round(zi, 2)], "lantern": [round(float(x), 2), round(float(y), 2), round(zw - 3.8, 2)]}


def nakamise_lanterns(K, s, ax):
    """Paper lanterns down the approach between the gates, both sides, at the shops' eaves."""
    if "kaminarimon" not in s or "hozomon" not in s:
        return
    a, b = np.asarray(s["kaminarimon"]["c"]), np.asarray(s["hozomon"]["c"])
    L = np.linalg.norm(b - a)
    d = unit(b - a)
    l = left_of(d)
    z = s["kaminarimon"]["z"]
    for t in np.arange(18.0, L - 14.0, 9.0):
        for sv in (-1, 1):
            p = a + d * t + l * sv * 3.4
            K("lacquer").tube([np.array([*p, z + 4.6]), np.array([*p, z + 4.2])], 0.03, 4)
            lathe_at(K("lacquer"), p[0], p[1], [(z + 3.45, 0.0), (z + 3.5, 0.24), (z + 3.55, 0.26)], 10)
            lathe_at(K("lacquer"), p[0], p[1], [(z + 4.15, 0.26), (z + 4.2, 0.24), (z + 4.25, 0.0)], 10)
            ATLAS.wrap(K("atlas", "lit"), p[0], p[1], z + 3.55, z + 4.15, 0.3, "chochin_w", 12)


def sensoji_meshes(s):
    ax = np.asarray(s["axis"])
    K = Kit("senso", MATERIALS, floodlit=("vermilion", "atlas"))
    out = {}
    if "kaminarimon" in s:
        out["kaminarimon"] = kaminarimon(K, s["kaminarimon"], ax)
    if "hozomon" in s:
        out["hozomon"] = hozomon(K, s["hozomon"], ax)
    if "pagoda" in s:
        pagoda(K, s["pagoda"], ax)
    if "hondo" in s:
        out["hondo"] = hondo(K, s["hondo"], ax)
    nakamise_lanterns(K, s, ax)
    return K.meshes(), out


# ---------------------------------------------------------------- Tokyo Skytree

def tree_radius(z, t):
    """The circumradius of the section at height z: the triangle's 39.3 m at the foot, narrowing on a
    concave curve to the round shaft; the shaft tapering above the decks."""
    R0 = t["side"] / math.sqrt(3)
    if z <= t["round_at"]:
        s = z / t["round_at"]
        return 16.5 + (R0 - 16.5) * (1 - s) ** 1.45
    if z <= t["galleria"][1]:
        s = (z - t["round_at"]) / (t["galleria"][1] - t["round_at"])
        return 16.5 - 5.5 * s
    s = min((z - t["galleria"][1]) / (t["mast_from"] - t["galleria"][1]), 1.0)
    return 11.0 - 6.5 * s


def tree_point(t, z, ang):
    """A point on the section at height z and angle ang (from the triangle's apex): the triangle's
    edge blended into the circle as the section rounds."""
    R = tree_radius(z, t)
    s = min(z / t["round_at"], 1.0) ** 0.75
    rel = ((ang % (2 * math.pi / 3)) - math.pi / 3)
    r_tri = R * 0.5 / max(math.cos(rel), 0.5)
    r = (1 - s) * r_tri + s * R
    a = ang + math.radians(t["apex_deg"])
    return np.array([t["centre"][0] + r * math.cos(a), t["centre"][1] + r * math.sin(a), t["ground_m"] + z]), r


def skytree_meshes(t):
    """The lattice in bands (each its own mesh, so the game sees the decks as floors between them), the
    core, the Tembo Deck and the Tembo Galleria, and the mast."""
    meshes = []
    gz = t["ground_m"]
    cx, cy = t["centre"]
    N = 24                                  # members round the section
    levels = list(np.arange(0.0, t["deck"][0] - 6.0, 12.0)) + [t["deck"][0] - 6.0]
    upper = list(np.arange(t["deck"][1] + 8.0, t["galleria"][0] - 4.0, 12.0)) + [t["galleria"][0] - 4.0]
    top = list(np.arange(t["galleria"][1] + 6.0, t["mast_from"], 12.0)) + [t["mast_from"]]
    for band, zs in (("low", levels), ("mid", upper), ("high", top)):
        m = jk.Mesh(f"tree_{band}_steel", "tree_steel", False, floodlit=True)
        core = jk.Mesh(f"tree_{band}_core", "tree_core", False, floodlit=True)
        for k, (z0, z1) in enumerate(zip(zs, zs[1:])):
            w = max(0.5, 1.6 * (1 - z0 / 600.0))
            for i in range(N):
                a0, a1 = 2 * math.pi * i / N, 2 * math.pi * (i + 1) / N
                p00, _ = tree_point(t, z0, a0)
                p01, _ = tree_point(t, z0, a1)
                p10, _ = tree_point(t, z1, a0)
                p11, _ = tree_point(t, z1, a1)
                m.box(p00, p10, w, w)                       # the verticals
                m.box(p00, p11, w * 0.6, w * 0.6)           # the diagrid: both diagonals in each bay
                m.box(p01, p10, w * 0.6, w * 0.6)
                if k % 2 == 0:
                    m.box(p10, p11, w * 0.7, w * 0.7)       # a ring every other level
            # the three legs at the triangle's corners, heavier, up to where the section is round
            if z1 <= t["round_at"]:
                for c in range(3):
                    a = 2 * math.pi * c / 3
                    m.box(tree_point(t, z0, a)[0], tree_point(t, z1, a)[0], w * 2.6, w * 2.6)
            # the core: a cylinder well inside the lattice
            rc0, rc1 = tree_radius(z0, t) * 0.42, tree_radius(z1, t) * 0.42
            core.lathe([(gz + z0, rc0), (gz + z1, rc1)], (cx, cy), 20)
        meshes += [m, core]
    # the Tembo Deck: three floors in a ring of glass (340, 345, 350), its floor slab for walking, a roof
    d0, d1 = t["deck"]
    R = tree_radius(d1, t) + 6.5
    floor = jk.Mesh("tree_deck_floor", "tree_floor", False)
    floor.lathe([(gz + d1 - 0.6, R - 0.3), (gz + d1, R - 0.3), (gz + d1, 0.0)], (cx, cy), 48)
    deck = jk.Mesh("tree_deck_shell", "tree_deck", False, floodlit=True)
    deck.lathe([(gz + d0 - 9.0, tree_radius(d0 - 9.0, t) * 0.95), (gz + d0 - 4.0, R - 1.5), (gz + d0 - 1.5, R)], (cx, cy), 48)
    glass = jk.Mesh("tree_deck_glass", "tree_glass", False, floodlit=True)
    glass.lathe([(gz + d0 - 1.5, R), (gz + d1 + 5.0, R + 0.6)], (cx, cy), 48)
    roof = jk.Mesh("tree_deck_roof", "tree_deck", False, floodlit=True)
    roof.lathe([(gz + d1 + 5.0, R + 0.6), (gz + d1 + 6.2, R - 0.5), (gz + d1 + 9.0, tree_radius(d1 + 9.0, t) * 0.9)], (cx, cy), 48)
    # the Galleria: a slimmer ring, its glass tube spiralling up
    g0, g1 = t["galleria"]
    Rg = tree_radius(g1, t) + 3.2
    gfloor = jk.Mesh("tree_gal_floor", "tree_floor", False)
    gfloor.lathe([(gz + g1 - 0.6, Rg - 0.3), (gz + g1, Rg - 0.3), (gz + g1, 0.0)], (cx, cy), 40)
    gshell = jk.Mesh("tree_gal_shell", "tree_deck", False, floodlit=True)
    gshell.lathe([(gz + g0 - 6.0, tree_radius(g0 - 6.0, t) * 0.95), (gz + g0 - 1.0, Rg)], (cx, cy), 40)
    gglass = jk.Mesh("tree_gal_glass", "tree_glass", False, floodlit=True)
    gglass.lathe([(gz + g0 - 1.0, Rg), (gz + g1 + 4.0, Rg + 0.3)], (cx, cy), 40)
    groof = jk.Mesh("tree_gal_roof", "tree_deck", False, floodlit=True)
    groof.lathe([(gz + g1 + 4.0, Rg + 0.3), (gz + g1 + 6.0, tree_radius(g1 + 6.0, t) * 0.9)], (cx, cy), 40)
    # the mast: a lattice of its own to 634 m, the beacons on it
    mast = jk.Mesh("tree_mast_steel", "tree_steel", False, floodlit=True)
    zs = np.linspace(t["mast_from"], t["height"], 12)
    for z0, z1 in zip(zs, zs[1:]):
        r0 = 4.5 * (1 - (z0 - t["mast_from"]) / (t["height"] - t["mast_from"])) + 0.6
        r1 = 4.5 * (1 - (z1 - t["mast_from"]) / (t["height"] - t["mast_from"])) + 0.6
        mast.lathe([(gz + z0, r0), (gz + z1, r1)], (cx, cy), 8)
    beacons = jk.Mesh("tree_beacons", "aviation", False, floodlit=True)
    for z in (t["deck"][1] + 9.5, t["galleria"][1] + 6.5, t["height"] - 0.5):
        lathe_at(beacons, cx, cy, [(gz + z, 0.0), (gz + z + 0.1, tree_radius(min(z, 600), t) * 0.5 + 0.8), (gz + z + 0.6, tree_radius(min(z, 600), t) * 0.5 + 0.8), (gz + z + 0.7, 0.0)], 16)
    return meshes + [floor, deck, glass, roof, gfloor, gshell, gglass, groof, mast, beacons]


# ---------------------------------------------------------------- the Asahi flame

def flame_meshes(f):
    """The Flamme d'Or: a golden flame 44 m long lying on the black hall's roof, its head at one end and
    its tail curling up off the other (Starck, 1989)."""
    o, ax = np.asarray(f["centre"]), unit(f["axis"])
    P = frame(o, ax)
    z = f["roof_m"]
    m = jk.Mesh("asahi_flame", "flame", True, floodlit=True)
    path, rs = [], []
    for s in np.linspace(0, 1, 24):
        u = -18.0 + 40.0 * s
        lift = 2.6 + 11.0 * max(s - 0.55, 0.0) ** 1.6 * 4.0
        path.append(P(u, 0.0, z + lift + 3.0 * math.sin(math.pi * min(s * 1.4, 1.0))))
        rs.append(max(0.25, 5.2 * (1 - s) ** 0.8 * (0.35 + 0.65 * min(s * 6, 1.0))))
    m.tube(path, rs, 16)
    return [m]


# ---------------------------------------------------------------- hooks

def landmark_meshes(scene):
    lm = scene["landmarks"]
    mats = {k: dict(v) for k, v in MATERIALS.items()}
    meshes = []
    if "sensoji" in lm:
        ms, extra = sensoji_meshes(lm["sensoji"])
        meshes += ms
        lm["sensoji"]["built"] = extra
        z = lm["sensoji"]["hondo"]["z"] if "hondo" in lm["sensoji"] else 3.0
        mats["vermilion"]["flood"] = [round(z, 1), round(z + 32.0, 1), 0.45, 0.55]
    t = lm.get("skytree")
    if t:
        meshes += skytree_meshes(t)
        for k in ("tree_steel", "tree_core"):
            mats[k]["flood"] = [round(t["ground_m"], 1), round(t["ground_m"] + t["height"], 1), 0.5, 0.7]
    if "flame" in lm:
        meshes += flame_meshes(lm["flame"])
    return mats, meshes


def landmark_assets(out_dir, scene):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (ATLAS.W, ATLAS.H), (120, 30, 24))
    d = ImageDraw.Draw(img)
    for key, (w, h, paper, words, ink, fname) in LANTERNS.items():
        x, y = ATLAS.rects[key][:2]
        d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=paper)
        # the paper's bamboo ribs, faint horizontal lines, and a darker band top and bottom
        for k in range(1, 24):
            yy = y + h * k / 24
            d.line([(x, yy), (x + w, yy)], fill=tuple(max(0, c - 22) for c in paper), width=2)
        if len(words) <= 2:
            f = jk.fit(d, [words], fname, w * 0.46, h * 0.86, 520)
            # the words face one way on half the drum: set them in the middle of the cell's half-width
            d.text((x + w / 2, y + h / 2), words, font=f, fill=ink, anchor="mm")
        else:
            jk.vertical(d, words, x + w / 2, y + h * 0.06, y + h * 0.94, fname, ink, w * 0.3)
    for key, (w, h, bg, words, ink, fname) in PLAQUES.items():
        x, y = ATLAS.rects[key][:2]
        d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=bg)
        d.rectangle([x + 8, y + 8, x + w - 8, y + h - 8], outline=ink, width=5)
        f = jk.fit(d, [words], fname, w - 60, h - 40, 160)
        d.text((x + w / 2, y + h / 2), words, font=f, fill=ink, anchor="mm")
    img.save(f"{out_dir}/atlas.jpg", quality=90)
    return ["atlas.jpg"]


def landmark_glows(scene):
    """The lanterns' light on the approach after dark."""
    s = scene["landmarks"].get("sensoji", {})
    out = []
    for key in ("kaminarimon", "hozomon", "hondo"):
        b = (s.get("built") or {}).get(key)
        if b:
            x, y, z = b["lantern"]
            out.append([x, y, 14.0, "#ffb070", 0.35])
    return out


def game_extras(scene):
    """Spots to look at, talk to overhear, and the Skytree's lifts to the Tembo Deck (600 m a minute)."""
    lm = scene["landmarks"]
    spots, chatter = [], []
    s = lm.get("sensoji")
    if s:
        ax = np.asarray(s["axis"])
        if "kaminarimon" in s:
            g = s["kaminarimon"]
            p = np.asarray(g["c"]) + ax * (g["half_u"] + 4.0)
            spots.append({"id": "kaminari", "name": "Kaminarimon 雷門", "at": [round(float(p[0]), 2), round(float(p[1]), 2), g["z"]], "verb": "Look up at the lantern",
                          "lines": ["The great lantern: 3.9 m tall, 3.3 m across and about 700 kg. 雷門 on the front, 風雷神門 on the back. Look underneath: a carved dragon.",
                                    "Fujin, the god of wind, on the right; Raijin, the god of thunder, on the left. The gate burned in 1865 and stood empty for 95 years, until 1960."],
                          "radius": 4.0})
            chatter.append({"at": [round(float(p[0] + 3), 2), round(float(p[1]), 2), g["z"]], "radius": 14, "side": True,
                            "lines": [["Visitor", "Everyone takes the same photo here."], ["Friend", "Because it's the photo. Stand under the lantern."], ["Visitor", "Rickshaw after?"]]})
        if "hondo" in s and "built" in s and "hondo" in s["built"]:
            x, y, z = s["built"]["hondo"]["incense"]
            spots.append({"id": "jokoro", "name": "Incense burner 常香炉", "at": [x, y, z], "verb": "Waft the smoke",
                          "lines": ["Wave the smoke over yourself: to the head for wisdom, to a sore shoulder to heal it. Then up the steps to the hall.",
                                    "Senso-ji is Tokyo's oldest temple: two fishermen found a statue of Kannon in the Sumida in 628, says the temple."],
                          "radius": 3.5})
            g = s["hondo"]
            p = np.asarray(g["c"]) + ax * (g["half_u"] + 6.0) + left_of(ax) * 8.0
            spots.append({"id": "omikuji", "name": "Omikuji おみくじ", "at": [round(float(p[0]), 2), round(float(p[1]), 2), g["z"]], "verb": "Draw a fortune", "pick": 1,
                          "lines": ["第四十八 大吉. Great fortune. What you wish for will come; the lost thing will be found.",
                                    "第三十二 吉. Good fortune. Be patient with travel; the wind turns.",
                                    "第九十六 凶. Bad fortune. Tie it to the rack and leave it behind. Senso-ji is known for its 凶: about three in ten.",
                                    "第七十 末吉. Future fortune. Small steps; the road is longer than it looks."],
                          "radius": 3.0})
    out = {"spots": spots, "chatter": chatter}
    t = lm.get("skytree")
    if t:
        gz, (cx, cy) = t["ground_m"], t["centre"]
        # the lifts rise from the fourth-floor lobby inside the tower's foot; here they start at its east side
        a = math.radians(t["apex_deg"])
        R0 = tree_radius(0.0, t) * 0.5
        door = [round(cx + (R0 + 4.0) * math.cos(a + math.pi), 2), round(cy + (R0 + 4.0) * math.sin(a + math.pi), 2), round(gz, 2)]
        deck_r = tree_radius(t["deck"][1], t) + 3.0
        deck = [round(cx + deck_r * math.cos(a + math.pi), 2), round(cy + deck_r * math.sin(a + math.pi), 2), round(gz + t["deck"][1], 2)]
        gal_r = tree_radius(t["galleria"][1], t) + 1.8
        gal = [round(cx + gal_r * math.cos(a), 2), round(cy + gal_r * math.sin(a), 2), round(gz + t["galleria"][1], 2)]
        out["lifts"] = [{"id": "skytree", "name": "Tokyo Skytree", "line": "TEMBO SHUTTLE · 4F → 350F → 450F", "m_per_min": 600,
                         "stops": [{"name": "Tokyo Skytree, the foot", "at": door},
                                   {"name": "Tembo Deck 天望デッキ, 350 m", "at": deck},
                                   {"name": "Tembo Galleria 天望回廊, 450 m", "at": gal}]}]
        out["travel"] = [{"id": "tembo", "name": "Tembo Deck 天望デッキ (350 m)", "at": deck, "always": True}]
        spots.append({"id": "tembo", "name": "Tembo Deck 天望デッキ", "at": deck, "verb": "Look out",
                      "lines": [f"350 m up. Senso-ji's roof is the grey one with the pagoda beside it; the Sumida bends past the Asahi flame.",
                                "On a clear winter morning Mt Fuji stands to the south-west, about 100 km away. Tokyo Tower is the orange one, 8 km south-west."],
                      "radius": 5.0})
    return out
