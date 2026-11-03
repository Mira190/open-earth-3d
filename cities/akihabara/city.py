"""Akihabara, a map of Tokyo: what the generic pipeline cannot know from open data.

The model is the real district: Overture footprints at Project PLATEAU's surveyed heights. This file
dresses Electric Town and builds two landmarks up the hill, placed on OpenStreetMap's footprints of them
(via Overture):

  * Electric Town (秋葉原電気街), along Chuo-dori from Manseibashi to Suehirocho and in the lanes off it:
    lit boards over the shop fronts, blade signs standing out from the walls with the trades the street
    sells (PC parts, games, anime, figures, cards, maid cafes, duty free), and the big prints that wrap
    the upper walls. The trades are typical; the signs are not real shops', and the prints are invented
    (no characters, logos or art of any game or show).
  * The names of a few buildings on their roofs' edges, as they are read from the street: Radio Kaikan,
    Don Quijote, GiGO, Yodobashi Akiba. Their own words set in open fonts, not their logos.
  * 随神門 Zuishinmon, Kanda Myojin's gate (1975): a two-storey vermilion gate with green copper roofs
    and gold fittings, on OpenStreetMap's footprint; and the hall behind it (御社殿, 1934, reinforced
    concrete), gongen-zukuri: the worship hall, the offering hall and the main hall joined, the wings either
    side and the roof over the front steps, in vermilion and black lacquer under green copper, on its
    footprint (shaden; the survey's block of it is not drawn).
  * ニコライ堂 Nikolai-do, the Holy Resurrection Cathedral (1891, rebuilt 1929): its green copper dome,
    about 35 m to the cross (Japanese Orthodox Church; Chiyoda City), on its drum over the nave.

Persona 5 unlocks Akihabara by a confidant: the game's Akihabara is Chuo-dori's signs and the lanes of
arcades and maid cafes off it. Nothing of the game's art is copied.
"""
import math

import numpy as np

import japankit as jk
from japankit import Atlas, Kit, block, frame, lathe_at, slab_at, taper, unit, left_of

ELECTRIC_TOWN = ((139.7712, 35.7000), 330)       # centre (lon, lat) and radius, metres
SIGN_CLASSES = {"", "commercial", "retail", "entertainment", "hotel", "restaurant", "office", "mixed_use"}
ROOF_NAMES = {"秋葉原ラジオ会館": "radio", "ドン・キホーテ": "donki", "GIGO3号館": "gigo", "ヨドバシカメラ マルチメディアAkiba": "yodobashi"}
ZUISHIN, SHADEN, NIKOLAI = "随神門", "御社殿", "ニコライ堂"

MATERIALS = {
    "atlas": {"color": "#ffffff", "roughness": 0.7, "metalness": 0.0, "map": "atlas.jpg", "emissive_map": True, "glow": 1.3},
    "atlas_print": {"color": "#ffffff", "roughness": 0.8, "metalness": 0.0, "map": "atlas.jpg", "emissive_map": True, "glow": 0.5},
    "frame": {"color": "#22252a", "roughness": 0.5, "metalness": 0.5},
    "vermilion": {"color": "#c8402c", "roughness": 0.6, "metalness": 0.0, "emissive": "#ff7a4a", "glow": 0.45},
    "copper_green": {"color": "#5f9a87", "roughness": 0.55, "metalness": 0.25},
    "soffit": {"color": "#b8452f", "roughness": 0.8, "metalness": 0.0},
    "gold": {"color": "#d8a840", "roughness": 0.28, "metalness": 0.9},
    "white_wall": {"color": "#efeae0", "roughness": 0.85, "metalness": 0.0},
    "stone": {"color": "#9a968e", "roughness": 0.9, "metalness": 0.0},
    "plaster": {"color": "#e4dccb", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffe6c0", "glow": 0.35},
    "dome": {"color": "#5c9a86", "roughness": 0.5, "metalness": 0.35},
    "lacquer": {"color": "#1c1815", "roughness": 0.3, "metalness": 0.05},
}

# the trades of Electric Town, on blade signs (words, background, ink, font)
BLADES = [("パソコン", "#0a4da2", "#ffffff", "zen"), ("PCパーツ", "#111111", "#ffd400", "zen"), ("ゲーム", "#e60012", "#ffffff", "dela"),
          ("アニメ", "#ff4fa0", "#ffffff", "mplus"), ("フィギュア", "#6a1bb0", "#ffffff", "mplus"), ("トレカ", "#ffd400", "#d4001a", "dela"),
          ("メイドカフェ", "#ffffff", "#ff3f8e", "mplus"), ("免税 TAX FREE", "#d4001a", "#ffffff", "zen"), ("中古", "#ffe600", "#111111", "dela"),
          ("電子部品", "#f2f2ee", "#0a4da2", "zen"), ("ガチャ", "#00a0e9", "#ffffff", "mplus"), ("同人誌", "#2b2b2b", "#ff8ad8", "mplus"),
          ("ホビー", "#00915a", "#ffffff", "dela"), ("カラオケ", "#e60012", "#ffe600", "dela"), ("レトロゲーム", "#111144", "#53f2ff", "dot"),
          ("無線", "#f2f2ee", "#d4001a", "zen"), ("家電", "#0068b7", "#ffffff", "zen"), ("プラモデル", "#ff7b00", "#ffffff", "dela"),
          ("コスプレ", "#c2185b", "#ffffff", "mplus"), ("スマホ修理", "#ffffff", "#00897b", "zen"), ("ゲームセンター", "#ffd400", "#e60012", "dela"),
          ("買取", "#d4001a", "#ffe600", "dela"), ("ラジオ", "#1a1a1a", "#ff9f1a", "zen"), ("アキバ", "#ff2d6f", "#ffffff", "reggae")]
BOARDS = [("いらっしゃいませ", "#e60012", "#ffffff", "zen"), ("高価買取 中古PC", "#ffe600", "#d4001a", "dela"), ("新作ゲーム 入荷", "#0a4da2", "#ffffff", "zen"),
          ("TAX FREE 免税", "#ffffff", "#d4001a", "bebas"), ("メイドカフェ ♡", "#ffd6e6", "#d81b60", "mplus"), ("トレカ ショップ", "#111111", "#ffd400", "dela"),
          ("DUTY FREE ELECTRONICS", "#141414", "#53f2ff", "bebas"), ("フィギュア 専門店", "#6a1bb0", "#ffffff", "mplus"), ("パーツ ジャンク", "#ffe600", "#111111", "dela"),
          ("レトロゲーム", "#101036", "#ff5ad1", "dot"), ("カード 買取", "#00915a", "#ffffff", "dela"), ("営業中 OPEN", "#d4001a", "#ffffff", "bebas")]
# the big prints on the upper walls: invented adverts (gradient, words, font)
PRINTS = [(["#ff5fa8", "#6a2bff"], ["NEW SEASON", "秋アニメ", "10月 放送中"], "dela"), (["#00c2ff", "#0033aa"], ["STAR BEAT", "LIVE 2026", "11.22 SAT"], "bebas"),
          (["#ffd400", "#ff4d00"], ["全品", "最大", "50%OFF"], "dela"), (["#111111", "#2e2e2e"], ["NEXT GEN", "GAMING PC", "RTX 入荷"], "bebas"),
          (["#ff9ad5", "#ffe0f0"], ["メイドカフェ", "おかえりなさい", "ませ"], "mplus"), (["#00e0a0", "#006b5a"], ["カード", "大会", "毎週土曜"], "dela"),
          (["#7a2bff", "#ff2bd6"], ["SAKURA", "DRIVE", "新曲配信"], "reggae"), (["#0a0a1e", "#2a1066"], ["レトロ", "ゲーム", "8BIT"], "dot")]
NAMES = {"radio": ("秋葉原ラジオ会館", "#ffffff", "#e60012", "zen"), "donki": ("ドン・キホーテ", "#ffd400", "#d4001a", "dela"),
         "gigo": ("GiGO", "#ffffff", "#0068b7", "bebas"), "yodobashi": ("ヨドバシAkiba", "#ffffff", "#d4001a", "zen")}

ATLAS = Atlas([(f"blade{i}", 64, 320) for i in range(len(BLADES))] + [(f"board{i}", 384, 96) for i in range(len(BOARDS))]
              + [(f"print{i}", 256, 512) for i in range(len(PRINTS))] + [(f"name_{k}", 512, 96) for k in NAMES] + [("kanda", 384, 128)])


# ---------------------------------------------------------------- anchors from the data

def adjust_building(b, cls, g, geoms, ctx):
    name = b["name"] or ""
    lm = ctx.landmarks
    if g.geom_type != "Polygon":
        return geoms
    geoms = jk.police_box(b, geoms)
    top = max((q[2] for q in geoms), default=0.0)
    c = g.centroid
    gz = ctx.ground(c.x, c.y)
    ring = [[round(x, 2), round(y, 2)] for x, y in g.exterior.coords]
    if name in ROOF_NAMES:
        lm.setdefault("_names", []).append({"key": ROOF_NAMES[name], "ring": ring, "top_m": round(top, 1), "ground_m": round(gz, 2)})
    if name == ZUISHIN:
        lm["_zuishin"] = {"ring": ring, "c": [round(c.x, 2), round(c.y, 2)], "ground_m": round(gz, 2), "top_m": round(top, 1)}
        for q in geoms:
            ctx.hide(q)
        return geoms
    if name == SHADEN:
        lm["_shaden"] = [round(c.x, 2), round(c.y, 2)]
        b["facade_color"] = "#c4402c"
    if name == NIKOLAI:
        lm["nikolai"] = {"c": [round(c.x, 2), round(c.y, 2)], "ground_m": round(gz, 2), "r": round(math.sqrt(g.area / math.pi), 2)}
        b["facade_color"] = "#e2d8c4"
        return [[q[0], q[1], min(max(q[2], 14.0), 16.0), q[3], q[4]] for q in geoms]
    (lo, la), r = ELECTRIC_TOWN
    ex, ey = ctx.city.fwd.transform(lo, la)
    if (b["class"] or "") in SIGN_CLASSES and geoms and 25 < g.area < 3000 and 6 <= top <= 80 and math.hypot(c.x - ex, c.y - ey) < r:
        ctx.signs.append((g, top))
    return geoms


def finalize(ctx):
    lm = ctx.landmarks
    sites = jk.sign_sites(ctx.city, ctx.signs, ctx.ground)
    lm["electric_town"] = {"sites": sites}
    names = lm.pop("_names", [])
    out = []
    from shapely.geometry import Polygon
    roads = [r["geom"] for r in jk.overture(ctx.city, "segment", "subtype = 'road' AND class IN ('primary', 'secondary', 'tertiary')") if r["geom"].geom_type == "LineString"]
    for n in names:
        g = Polygon(n["ring"])
        if not roads:
            continue
        near = min(roads, key=lambda ln: ln.distance(g.centroid))
        p = near.interpolate(near.project(g.centroid))
        # the footprint's edge that faces that road
        cs = np.asarray(g.exterior.coords)
        best = None
        for a, b in zip(cs[:-1], cs[1:]):
            mid = (a + b) / 2
            L = float(np.linalg.norm(b - a))
            if L < 6:
                continue
            e = (b - a) / L
            nrm = np.array([e[1], -e[0]]) if g.exterior.is_ccw else np.array([-e[1], e[0]])
            score = float(np.linalg.norm(mid - [p.x, p.y]))
            if (np.array([p.x, p.y]) - mid) @ nrm > 0 and (best is None or score < best[0]):
                best = (score, mid, nrm, L)
        if best:
            _, mid, nrm, L = best
            out.append({"key": n["key"], "mid": [round(float(mid[0]), 2), round(float(mid[1]), 2)], "n": [round(float(nrm[0]), 4), round(float(nrm[1]), 4)],
                        "L": round(L, 1), "z": round(n["ground_m"] + n["top_m"], 2)})
    lm["roof_names"] = out
    z = lm.pop("_zuishin", None)
    s = lm.pop("_shaden", None)
    if z and s:
        ax = unit(np.asarray(z["c"]) - np.asarray(s))     # out of the precinct, through the gate
        g = Polygon(z["ring"])
        cs = np.asarray(g.exterior.coords) - np.asarray(z["c"])
        u, v = cs @ ax, cs @ left_of(ax)
        lm["zuishinmon"] = {"c": z["c"], "axis": [round(float(ax[0]), 5), round(float(ax[1]), 5)], "half_u": round(float(u.max() - u.min()) / 2, 2),
                            "half_v": round(float(v.max() - v.min()) / 2, 2), "z": z["ground_m"], "top_m": z["top_m"]}
        ctx.labels["Kanda Myojin 神田明神"] = [s[0], s[1], round(z["ground_m"] + 18, 1)]
    nk = lm.get("nikolai")
    if nk:
        ctx.labels["Nikolai-do ニコライ堂"] = [nk["c"][0], nk["c"][1], round(nk["ground_m"] + 40, 1)]


# ---------------------------------------------------------------- meshes

def electric_town(K, et, names):
    rng = np.random.default_rng(1999)
    jk.street_signs(K, ATLAS, et["sites"], ([f"board{i}" for i in range(len(BOARDS))], [f"blade{i}" for i in range(len(BLADES))]), rng)
    # a big print on the upper wall of each tall street front (one in three), its frame and the lamps over it
    P = K("atlas_print", "lit")
    for x, y, nx, ny, g, top, L in jk.open_fronts(et["sites"]):
        if top < 22 or L < 8 or rng.random() > 0.38:
            continue
        n, t = np.array([nx, ny]), np.array([-ny, nx])
        w = min(L * 0.7, 9.0)
        h = min(w * 2.0, top - 12.0)
        z1 = g + top - 1.5
        z0 = z1 - h
        c = np.array([x, y]) + n * 0.22
        a, b = c - t * w / 2, c + t * w / 2
        ATLAS.quad(P, np.array([*a, z0]), np.array([*b, z0]), np.array([*b, z1]), np.array([*a, z1]), f"print{int(rng.integers(len(PRINTS)))}")
        cf = np.array([x, y]) + n * 0.1
        block(K("frame"), frame(cf, n), -0.12, 0.12, -w / 2 - 0.15, w / 2 + 0.15, z1, z1 + 0.25)
    # the roof-edge names
    A = K("atlas", "lit")
    for r in names:
        n, mid = np.asarray(r["n"]), np.asarray(r["mid"])
        t = np.array([-n[1], n[0]])
        w = min(r["L"] * 0.8, 22.0)
        h = w / 5.3
        c = mid + n * 0.3
        a, b = c - t * w / 2, c + t * w / 2
        z0 = r["z"] + 0.6
        ATLAS.quad(A, np.array([*a, z0]), np.array([*b, z0]), np.array([*b, z0 + h]), np.array([*a, z0 + h]), f"name_{r['key']}")
        for s in np.linspace(-w / 2 + 0.5, w / 2 - 0.5, 5):   # its steel legs
            p = mid - n * 0.3 + t * s
            K("frame").box(np.array([*p, r["z"]]), np.array([*p, z0 + h * 0.8]), 0.18, 0.18)


GATE_STONE = 0.25   # the gate's stone floor: one low step up from the paving, walked over


def zuishin_frame(gte):
    """The gate's frame (u out of the precinct, v across) and its half sizes, as zuishinmon() builds it."""
    return frame(gte["c"], np.asarray(gte["axis"])), min(gte["half_u"], 4.5), min(gte["half_v"], 7.5)


def zuishinmon(K, gte):
    P, hu, hv = zuishin_frame(gte)
    z0 = gte["z"]
    top = z0 + max(min(gte["top_m"], 14.0), 12.0)
    block(K("stone"), P, -hu - 0.5, hu + 0.5, -hv - 0.5, hv + 0.5, z0 - 0.3, z0 + GATE_STONE)
    zb = z0 + GATE_STONE
    z1 = zb + 5.0
    for u in np.linspace(-hu + 0.4, hu - 0.4, 3):
        for v in np.linspace(-hv + 0.4, hv - 0.4, 4):
            lathe_at(K("vermilion"), *P(u, v, 0)[:2], [(zb, 0.32), (z1, 0.3)], 12)
    for sv in (-1, 1):   # the side bays' walls, white with gilt panels
        v = sv * (hv - 2.2)
        block(K("white_wall"), P, -0.15, 0.15, v - 1.6, v + 1.6, zb, z1 - 0.6)
    block(K("vermilion"), P, -hu, hu, -hv, hv, z1 - 0.6, z1 + 0.4)
    for v in np.linspace(-hv + 0.5, hv - 0.5, 8):
        block(K("gold"), P, hu - 0.02, hu + 0.04, v - 0.18, v + 0.18, z1 - 0.4, z1 + 0.2)
    jk.hip_roof(K("copper_green"), K("soffit"), P, hu, hv, z1 + 0.4, z1 + 2.0, ov=2.0, k=1.0)
    hu2, hv2 = hu - 1.0, hv - 1.4
    z2 = z1 + 2.0
    block(K("vermilion"), P, -hu2, hu2, -hv2, hv2, z2, z2 + 3.0)
    jk.irimoya(K("copper_green"), K("vermilion", "gable"), K("soffit"), lambda u, v, z: P(v, u, z), hv2, hu2, z2 + 3.0, top, ov=2.2, gable_at=0.5)
    ATLAS.quad(K("atlas"), P(hu2 + 0.05, 1.4, z2 + 0.6), P(hu2 + 0.05, -1.4, z2 + 0.6), P(hu2 + 0.05, -1.4, z2 + 1.55), P(hu2 + 0.05, 1.4, z2 + 1.55), "kanda")


# ---------------------------------------------------------------- Kanda Myojin's hall (御社殿)

# The hall of 1934 (Ōe Shintarō and Sano Toshikata; reinforced concrete, an Important Cultural Property
# since 2003) is gongen-zukuri: the worship hall (拝殿) in front, joined by the offering hall (幣殿) to the
# main hall (本殿) behind, with a roof over the front steps (向拝); vermilion, black lacquer and gold under
# green copper roofs. Laid out in OpenStreetMap's footprint of it (御社殿), whose outline holds the three
# halls and the wings either side; the worship hall about 21 m across its front. The heights stop at the
# survey's 13.6 m. The proportions are from photographs, not drawings.
SHADEN_KIDAN = 1.2      # the stone platform over the paving in front: six steps up
SHADEN_STEPS = (6, 0.32)


def shaden_site(solids, gate):
    """The hall's frame on its footprint (u toward the gate, v to its left; the footprint's rectangle
    axis nearest that), the footprint's extents in it, its levels and the survey's solids of it:
    {P, u0, u1, v0, v1, z0 (the paving in front), top (the platform), si}, or None."""
    import archkit as ak
    parts = [q for q in solids if q["name"] == SHADEN]
    if not parts or not gate:
        return None
    main = max(parts, key=lambda q: abs(ak.ring_area(q["ring"])))
    cx, cy, axd, L, W = ak.oriented(main["ring"])
    to_gate = unit(np.asarray(gate["c"]) - [cx, cy])
    a = math.radians(axd)
    axes = [np.array([math.cos(a + k * math.pi / 2), math.sin(a + k * math.pi / 2)]) for k in range(4)]
    f = max(axes, key=lambda e: float(e @ to_gate))
    P = frame((cx, cy), f)
    r = np.asarray(main["ring"]) - [cx, cy]
    u, v = r @ f, r @ left_of(f)
    T = ak.Terrain("akihabara")
    u1 = float(u.max())
    edge = u1 - 5.7                                    # the platform's front edge, under the front roof
    z0 = float(np.median([T(*P(edge + 3.5, s, 0)[:2]) for s in np.linspace(-6, 6, 7)]))
    hi = max(T(*P(uu, vv, 0)[:2]) for uu in np.linspace(u.min(), u1, 9) for vv in np.linspace(v.min(), v.max(), 9))
    top = round(max(z0 + SHADEN_KIDAN, hi + 0.6), 2)
    return {"P": P, "u0": float(u.min()), "u1": u1, "v0": float(v.min()), "v1": float(v.max()), "edge": edge,
            "z0": round(z0, 2), "top": top, "si": sorted(q["si"] for q in parts)}


def _body(K, P, u0, u1, v0, v1, zf, zt, front_open=0.0):
    """A hall's walls between its floor zf and the foot of its bracket band zt: vermilion pillars every
    bay round it, the walls between them set in, three black-lacquered tie beams (長押) with gold caps
    at the corners; on the front (u1) the middle bays open (front_open m wide) onto the dark interior."""
    block(K("vermilion", "wall"), P, u0 + 0.25, u1 - 0.25, v0 + 0.25, v1 - 0.25, zf, zt)
    if front_open:
        block(K("frame"), P, u1 - 0.24, u1 - 0.2, -front_open / 2, front_open / 2, zf, zt - 0.5)
        for v in np.linspace(-front_open / 2, front_open / 2, 5)[1:-1]:      # the lattice doors folded back
            block(K("lacquer"), P, u1 - 0.3, u1 - 0.18, v - 0.06, v + 0.06, zf, zt - 0.5)
    for (a, b) in (((u0, v0), (u1, v0)), ((u1, v0), (u1, v1)), ((u1, v1), (u0, v1)), ((u0, v1), (u0, v0))):
        n = max(1, int(round(math.hypot(b[0] - a[0], b[1] - a[1]) / 2.7)))
        for k in range(n):
            t = k / n
            uu, vv = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            lathe_at(K("vermilion"), *P(uu, vv, 0)[:2], [(zf, 0.3), (zt, 0.28)], 10)
    for z in (zf + 0.35, zf + (zt - zf) * 0.62, zt - 0.3):
        block(K("lacquer"), P, u0 - 0.12, u1 + 0.12, v0 - 0.12, v1 + 0.12, z - 0.14, z + 0.14)
    for su in (u0, u1):
        for sv in (v0, v1):
            for z in (zf + 0.35, zf + (zt - zf) * 0.62, zt - 0.3):
                block(K("gold"), P, su - 0.16, su + 0.16, sv - 0.16, sv + 0.16, z - 0.16, z + 0.16)
    # the bracket band (組物): black, with a gilt line, under the eaves
    block(K("lacquer"), P, u0 - 0.35, u1 + 0.35, v0 - 0.35, v1 + 0.35, zt, zt + 0.7)
    block(K("gold"), P, u0 - 0.37, u1 + 0.37, v0 - 0.37, v1 + 0.37, zt + 0.32, zt + 0.4)


def _roof_across(K, P, uc, hu, hv, z_eave, z_ridge, ov):
    """A hip-and-gable roof in copper with its ridge across the frame (along v), centred at u = uc."""
    Q = lambda a, b, z: P(uc + b, a, z)
    r = jk.irimoya(K("copper_green"), K("vermilion", "gable"), K("soffit"), Q, hv, hu, z_eave, z_ridge, ov, gable_at=0.5)
    K("lacquer").box(P(uc, -r["Ug"] - 0.3, z_ridge + 0.15), P(uc, r["Ug"] + 0.3, z_ridge + 0.15), 0.7, 0.55)   # the ridge


def shaden(K, site):
    """Kanda Myojin's hall (see above): the main hall, the offering hall and the worship hall, the wings
    either side, the front roof over the steps on its posts, and the steps (shaden_steps)."""
    P, u0, u1, v0, v1, z0, top, edge = (site[k] for k in ("P", "u0", "u1", "v0", "v1", "z0", "top", "edge"))
    hw = min(10.5, (v1 - v0) / 2 - 1.0)          # the worship hall's half width (21 m across its front)
    hf = edge - 1.6                              # its front wall
    hb = hf - 11.0                               # its back wall
    ob = hb - 5.5                                # the offering hall, to the main hall's front
    mb = max(u0 + 0.8, ob - 14.0)                # the main hall's back wall
    mh = min(hw, 10.0)
    up = top + 0.45                              # the main hall's floor, a step above the rest
    stone = K("stone")
    # the stone platform: under the worship and offering halls to the front edge, higher under the main hall
    block(stone, P, hb - 0.2, edge, -hw - 1.6, hw + 1.6, z0 - 0.4, top)
    block(stone, P, mb - 1.2, hb - 0.2, -mh - 1.4, mh + 1.4, z0 - 0.4, up)
    # the wings either side, along the courtyard: low halls on their own low plinth
    wv0, wv1 = hw + 1.8, min(abs(v0), abs(v1)) - 0.6
    if wv1 - wv0 > 3.0:
        for s in (-1, 1):
            Pw = lambda a, b, z, s=s: P(a, s * b, z)
            wu0, wu1 = hb - 9.0, hf - 3.5
            block(stone, Pw, wu0 - 0.6, wu1 + 0.6, wv0 - 0.6, wv1 + 0.6, z0 - 0.4, z0 + 0.5)
            _body(K, P, wu0, wu1, *sorted((s * wv0, s * wv1)), z0 + 0.5, z0 + 3.6)
            jk.irimoya(K("copper_green"), K("vermilion", "gable"), K("soffit"), lambda a, b, z, s=s: P((wu0 + wu1) / 2 + a, s * (wv0 + wv1) / 2 + b, z),
                       (wu1 - wu0) / 2, (wv1 - wv0) / 2, z0 + 4.3, z0 + 7.6, 1.4, gable_at=0.5)
    # the main hall (本殿)
    _body(K, P, mb, ob, -mh, mh, up, up + 5.6)
    _roof_across(K, P, (mb + ob) / 2, (ob - mb) / 2, mh, up + 6.3, z0 + 13.6, 2.2)
    # the offering hall (幣殿), lower, its ridge running from the worship hall to the main hall
    _body(K, P, ob - 0.3, hb + 0.3, -4.6, 4.6, top, top + 4.6)
    jk.irimoya(K("copper_green"), K("vermilion", "gable"), K("soffit"), lambda a, b, z: P((ob + hb) / 2 + a, b, z),
               (hb - ob) / 2 + 0.3, 4.6, top + 5.3, z0 + 10.4, 1.4, gable_at=0.5)
    # the worship hall (拝殿), open across its middle bays
    _body(K, P, hb, hf, -hw, hw, top, top + 5.2, front_open=11.0)
    _roof_across(K, P, (hb + hf) / 2, (hf - hb) / 2, hw, top + 5.9, z0 + 13.0, 2.6)
    # the front roof (向拝) over the steps, on four vermilion posts at their foot, its gable to the front
    pu = edge + SHADEN_STEPS[0] * SHADEN_STEPS[1] + 0.5
    for v in (-4.6, 4.6):
        lathe_at(K("vermilion"), *P(pu, v, 0)[:2], [(z0, 0.32), (z0 + 4.0, 0.3)], 12)
        block(K("stone"), P, pu - 0.45, pu + 0.45, v - 0.45, v + 0.45, z0 - 0.2, z0 + 0.25)
    block(K("lacquer"), P, hf, pu + 0.4, -4.9, 4.9, z0 + 4.0, z0 + 4.55)          # the beam over the posts
    block(K("gold"), P, pu + 0.38, pu + 0.44, -4.9, 4.9, z0 + 4.2, z0 + 4.35)
    zr, ze, w = z0 + 6.4, z0 + 4.6, 6.0
    roof, gable = K("copper_green"), K("vermilion", "gable")
    ua, ub = hf - 0.5, pu + 1.6
    for s in (-1, 1):
        _facing(roof, [P(ua, 0, zr), P(ub, 0, zr), P(ub, s * w, ze), P(ua, s * w, ze)], up=True)
        _facing(K("soffit"), [P(ua, 0, zr - 0.35), P(ub, 0, zr - 0.35), P(ub, s * w, ze - 0.05), P(ua, s * w, ze - 0.05)], up=False)
    gable.tri(P(ub - 0.3, -w + 0.6, ze + 0.15), P(ub - 0.3, w - 0.6, ze + 0.15), P(ub - 0.3, 0, zr - 0.2))
    K("gold").box(P(ub - 0.25, 0, zr - 1.0), P(ub - 0.25, 0, zr - 0.3), 0.5, 0.12)        # the gilt ornament in the gable
    K("lacquer").box(P(ua, 0, zr + 0.15), P(ub + 0.1, 0, zr + 0.15), 0.5, 0.4)
    shaden_steps(site)


_SHADEN_STEPS = []


def _facing(m, q, up):
    """A quad wound to face up (or down)."""
    n = np.cross(q[1] - q[0], q[2] - q[0])
    m.quad(*(q if (n[2] > 0) == up else q[::-1]))


def shaden_approach(site):
    """The strip a walker takes up the front steps onto the platform (game.json "surfaces"), in a frame whose
    u runs inward from the platform's front edge: {origin, axis, half_width, profile, z0, top}."""
    P, z0, top, edge = site["P"], site["z0"], site["top"], site["edge"]
    n, tread = SHADEN_STEPS
    rise = (top - z0) / n
    o, inward = P(edge, 0, 0)[:2], -(P(1, 0, 0)[:2] - P(0, 0, 0)[:2])
    prof = [[-n * tread - 4.0, z0], [round(-n * tread - 0.02, 3), z0]]
    for j in range(n):
        a = -(n - j) * tread
        prof += [[round(a + (0.02 if j else 0), 3), round(z0 + (j + 1) * rise, 3)], [round(a + tread, 3), round(z0 + (j + 1) * rise, 3)]]
    prof.append([1.4, round(top, 3)])                # onto the platform, to the worship hall's open front
    return {"origin": [float(o[0]), float(o[1])], "axis": [float(inward[0]), float(inward[1])], "half_width": 3.4, "profile": prof,
            "z0": z0, "top": top, "rise": rise}


def shaden_steps(site):
    """The front steps in granite, under the strip's treads (shaden_approach), as a mesh of their own."""
    from meshkit import Mesh
    a = shaden_approach(site)
    m = Mesh("akiba_shaden_steps", "stone", False)
    F = frame(a["origin"], a["axis"])
    n, tread = SHADEN_STEPS
    for j in range(n):
        block(m, F, -(n - j) * tread, 0.05, -a["half_width"] - 0.4, a["half_width"] + 0.4, a["z0"] - 0.3, a["z0"] + (j + 1) * a["rise"])
    _SHADEN_STEPS[:] = [m]


def nikolai(K, nk):
    """The dome on its drum over the crossing, the cross on top, and a lit lantern ring."""
    x, y = nk["c"]
    z = nk["ground_m"] + 15.0
    r = min(nk["r"] * 0.42, 7.5)
    lathe_at(K("plaster"), x, y, [(z, r + 0.6), (z + 1.0, r + 0.6), (z + 1.0, r), (z + 6.5, r), (z + 7.0, r + 0.4)], 24)
    for k in range(12):    # the drum's arched windows, as dark slots
        a = 2 * math.pi * k / 12
        p = np.array([x + r * math.cos(a), y + r * math.sin(a)])
        n = np.array([math.cos(a), math.sin(a)])
        block(K("frame"), frame(p, n), -0.05, 0.08, -0.45, 0.45, z + 2.0, z + 5.6)
    dome = [(z + 7.0, r + 0.2)] + [(z + 7.0 + r * 1.05 * math.sin(t), (r + 0.2) * math.cos(t)) for t in np.linspace(0.12, math.pi / 2, 10)]
    lathe_at(K("dome"), x, y, dome, 32)
    zt = z + 7.0 + r * 1.05
    lathe_at(K("dome"), x, y, [(zt - 0.2, 0.9), (zt + 0.8, 0.8), (zt + 1.0, 0.0)], 12)
    K("gold").box(np.array([x, y, zt + 0.9]), np.array([x, y, zt + 4.4]), 0.25, 0.25)
    K("gold").box(np.array([x - 1.0, y, zt + 3.4]), np.array([x + 1.0, y, zt + 3.4]), 0.22, 0.22)


def landmark_meshes(scene):
    lm = scene["landmarks"]
    K = Kit("akiba", MATERIALS, floodlit=("vermilion", "plaster"))
    if "electric_town" in lm:
        electric_town(K, lm["electric_town"], lm.get("roof_names", []))
    if "zuishinmon" in lm:
        zuishinmon(K, lm["zuishinmon"])
    if "nikolai" in lm:
        nikolai(K, lm["nikolai"])
    import archkit
    site = shaden_site(archkit.load_solids("akihabara"), lm.get("zuishinmon"))
    if site:
        shaden(K, site)
    return MATERIALS, K.meshes() + (_SHADEN_STEPS if site else []), {"hidden": site["si"] if site else []}


def _grad(img, rect, top, bot):
    from PIL import ImageColor
    x, y, w, h = rect
    a, b = ImageColor.getrgb(top), ImageColor.getrgb(bot)
    for k in range(h):
        t = k / max(h - 1, 1)
        img.paste(tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)), (x, y + k, x + w, y + k + 1))


def landmark_assets(out_dir, scene):
    from PIL import Image, ImageDraw, ImageColor
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
    for i, (cols, lines, fname) in enumerate(PRINTS):
        x, y, w, h = ATLAS.rects[f"print{i}"]
        _grad(img, (x - 4, y - 4, w + 8, h + 8), *cols)
        # bands of light and stars: an advert's graphic, abstract
        for k in range(6):
            yy = y + h * (0.1 + 0.15 * k)
            d.polygon([(x, yy), (x + w, yy - 40), (x + w, yy - 28), (x, yy + 12)], fill=tuple(min(255, c + 40) for c in ImageColor.getrgb(cols[0])))
        for k, line in enumerate(lines):
            size = jk.fit(d, [line], fname, w - 24, h * 0.2, 120)
            jk.text(d, (x + w / 2 + 2, y + h * (0.3 + 0.24 * k) + 3), line, fname, size, (0, 0, 0))
            jk.text(d, (x + w / 2, y + h * (0.3 + 0.24 * k)), line, fname, size, (255, 255, 255))
    for k, (words, bg, ink, fname) in NAMES.items():
        x, y, w, h = ATLAS.rects[f"name_{k}"]
        d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=bg)
        jk.text(d, (x + w / 2, y + h / 2), words, fname, jk.fit(d, [words], fname, w - 30, h - 14, 90), ink)
    x, y, w, h = ATLAS.rects["kanda"]
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(28, 40, 34))
    d.rectangle([x + 8, y + 8, x + w - 8, y + h - 8], outline=(222, 178, 72), width=5)
    jk.text(d, (x + w / 2, y + h / 2), "神田神社", "mincho", jk.fit(d, ["神田神社"], "mincho", w - 50, h - 30, 120), (222, 178, 72))
    img.save(f"{out_dir}/atlas.jpg", quality=90)
    return ["atlas.jpg"]


def landmark_glows(scene):
    """The signs' light on Chuo-dori after dark: one pool every few street fronts."""
    et = scene["landmarks"].get("electric_town")
    if not et:
        return []
    out = []
    for k, (x, y, nx, ny, g, top, L) in enumerate(et["sites"]):
        if k % 4 == 0:
            out.append([round(x + nx * 3.0, 1), round(y + ny * 3.0, 1), 9.0, ["#ff8ac8", "#8ad8ff", "#ffe08a", "#ffffff"][k % 4], 0.22])
    return out


def xy(p):
    return [round(float(p[0]), 2), round(float(p[1]), 2)]


def close_to(name, at, z, start, within=1.5, keep=0.0):
    """A thing to walk up to (game.json "close", a spot's "reach"): `at` on it at the floor's height z, the walk
    starting at `start`; tools/close_step.js must get within `within` m and never nearer than `keep`."""
    return {**({"name": name} if name else {}), "at": [*xy(at), round(float(z), 2)], "from": xy(start), "within": within, **({"keep": keep} if keep else {})}


def wall_point(ring, toward):
    """The point of a footprint's outline nearest `toward`, and the outline's outward normal there."""
    from shapely.geometry import Point, Polygon
    g = Polygon(ring)
    q = g.exterior.interpolate(g.exterior.project(Point(*toward[:2])))
    p = np.array([q.x, q.y])
    n = unit(np.asarray(toward, float)[:2] - p)
    return p, n


def close_extras(lm, close):
    """Things people walk right up to: through Kanda Myojin's gate and up to its posts, to the hall's
    front, and to Nikolai-do's west door under its bell tower."""
    import archkit
    z = lm.get("zuishinmon")
    solids = archkit.load_solids("akihabara") if z or "nikolai" in lm else []
    if z:
        P, hu, hv = zuishin_frame(z)
        zb = z["z"] + GATE_STONE
        close.append(close_to("Zuishinmon, through the gate", P(0, 0, 0), zb, P(hu + 5.0, 0, 0), 1.0))
        v = (hv - 0.4) / 3                          # the posts either side of the passage (radius 0.32)
        close.append(close_to("Zuishinmon, a vermilion post", P(hu - 0.4 + 0.32, -v, 0), zb, P(hu + 4.5, -v, 0), 1.0))
        site = shaden_site(solids, z)
        if site:                                    # up the hall's front steps, onto its platform
            a = shaden_approach(site)
            o, d = np.asarray(a["origin"]), np.asarray(a["axis"])
            close.append(close_to("Kanda Myojin, up the hall's front steps", o + d * 0.6, a["top"], o + d * (a["profile"][0][0] - 3.0), 1.0))
    nk = lm.get("nikolai")
    if nk:
        # the bell tower's block, its west front, where the door is (the cathedral faces west, the altar east)
        parts = [q for q in solids if q["name"] == NIKOLAI and q["base"] == 0]
        if parts:
            west = min(parts, key=lambda q: min(x for x, _ in q["ring"]))
            c = np.mean(np.asarray(west["ring"]), 0)
            p, n = wall_point(west["ring"], c + np.array([-30.0, 0.0]))
            close.append(close_to("Nikolai-do, under its bell tower", p, west["ground"], p + n * 5.0, 1.2))


def game_surfaces(scene):
    """Kanda Myojin's front steps, walked as a strip (shaden_approach)."""
    import archkit
    site = shaden_site(archkit.load_solids("akihabara"), scene["landmarks"].get("zuishinmon"))
    if not site:
        return []
    a = shaden_approach(site)
    return [{"name": "Kanda Myojin, the hall's front steps", "type": "strip", "origin": [round(v, 2) for v in a["origin"]],
             "axis": [round(v, 5) for v in a["axis"]], "half_width": a["half_width"], "profile": a["profile"], "thickness": 1.2,
             "mesh": "akiba_shaden_steps", "label": "Kanda Myojin 神田明神"}]


def game_extras(scene):
    lm = scene["landmarks"]
    spots, chatter, close = [], [], []
    close_extras(lm, close)
    z = lm.get("zuishinmon")
    if z:
        p = np.asarray(z["c"]) + np.asarray(z["axis"]) * (z["half_u"] + 5.0)
        spots.append({"id": "zuishin", "name": "Zuishinmon 随神門", "at": [round(float(p[0]), 2), round(float(p[1]), 2), z["z"]], "verb": "Look at the gate",
                      "lines": ["Kanda Myojin has watched over Kanda, Nihonbashi and Akihabara since Edo. Akihabara's shops come here for New Year blessings on their computers.",
                                "The gate dates from 1975; the hall behind it, all vermilion concrete, from 1934. It survived the war's fires."], "radius": 4.0})
    nk = lm.get("nikolai")
    if nk:
        spots.append({"id": "nikolai", "name": "Nikolai-do ニコライ堂", "at": [round(nk["c"][0] + nk["r"] + 6, 2), nk["c"][1], nk["ground_m"]], "verb": "Listen for the bells",
                      "lines": ["The Holy Resurrection Cathedral, 1891: Josiah Conder drew it from a Russian design. Its dome fell in the 1923 earthquake and was rebuilt smaller in 1929.",
                                "From the hill it looked over the whole of Tokyo once. Now look how the towers have grown round it."], "radius": 5.0})
    et = lm.get("electric_town")
    if et and et["sites"]:
        x, y, nx, ny, g, top, L = et["sites"][0]
        chatter.append({"at": [x + nx * 4, y + ny * 4, g], "radius": 14, "side": True,
                        "lines": [["Shopper", "Is the junk-parts shop still down that lane?"], ["Friend", "Since 1980-something. Bring cash."], ["Shopper", "And then the arcade."]]})
    return {"spots": spots, "chatter": chatter, "close": close}
