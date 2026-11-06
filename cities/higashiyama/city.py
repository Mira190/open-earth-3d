"""Higashiyama, a map of Kyoto: what the generic pipeline cannot know from open data.

The model is the real district: Overture footprints at Project PLATEAU's surveyed heights on GSI's laser
terrain. This file builds the temple and the pagoda in code from published dimensions, on the footprints
OpenStreetMap maps for them (web/data/higashiyama/buildings.json, which the renderers then leave out),
and dresses the stone lanes. Sources and what is approximate: docs/cities/higashiyama.md.

Kiyomizu-dera 清水寺 (rebuilt 1631-1633 under Tokugawa Iemitsu; a World Heritage site):
  * 本堂 the Main Hall (National Treasure): about 36 m across and 30 m deep, about 18 m to the ridge of its
    hipped roof of hinoki bark (寄棟造 檜皮葺), with the two wing corridors (翼廊) running forward either
    side of the stage. Its floor is level with the hillside behind it.
  * 舞台 the Stage: about 200 m2 of hinoki boards (the temple: "about 200 m2"), nearly 13 m over the slope, on a lattice of keyaki pillars
    (懸造) tied by through-beams without a nail: eighteen pillars under the stage itself.
  * 仁王門 the Deva Gate, 西門 the West Gate, 三重塔 the Three-storey Pagoda (about 31 m, among the
    tallest of its kind), 鐘楼 the Bell Tower, 経堂 the Sutra Hall, 開山堂 (田村堂) the Founder's Hall and 轟門
    the Todoroki Gate: vermilion (丹塗). 奥の院 the Inner Hall, with a stage of its own that looks back at the
    Main Hall (the view on every postcard), and 音羽の滝 the Otowa Falls below it: three streams from the
    rock, drunk from long-handled cups. 子安塔 the Koyasu Pagoda (three storeys, about 15 m) across the valley.
  * Detective Conan sends fans here: Kiyomizu is in 迷宮の十字路 (Crossroad in the Ancient Capital, 2003), and in
    紅の修学旅行 (Crimson School Trip, 2018) Shinichi and Ran are photographed with the stage behind them, the
    view from the Okunoin's stage. Places only: nothing of the films' art is copied.

八坂の塔 the Yasaka Pagoda (法観寺, rebuilt 1440): five storeys, 46 m, bare timber and white plaster under
tiled roofs, at the top of Yasaka-dori.

The lanes: 産寧坂 Sannenzaka, 二寧坂 Ninenzaka, 一念坂, 清水坂 and 八坂通, stone setts and steps laid along
OpenStreetMap's lines (cities/higashiyama/kiyomizu_osm.json), and the shops along them given their noren,
lattices and paper lanterns.
"""
import json
import math
import os

from shapely.geometry import Point

import numpy as np

import archkit as ak
import kyotokit as kk
from japankit import Atlas, block, lathe_at, taper, unit, left_of, font, text, fit, vertical
from meshkit import Mesh

HERE = os.path.dirname(os.path.abspath(__file__))

MATERIALS = {
    # Kiyomizu's vermilion (丹塗, an orange red), lit softly from below after dark as the temple is for its
    # autumn and spring illuminations
    "shu": {"color": "#c9472c", "roughness": 0.62, "metalness": 0.0, "emissive": "#ff7a48", "glow": 0.42},
    "shu_dark": {"color": "#8f2f1e", "roughness": 0.66, "metalness": 0.0},
    "kiyo_white": {"color": "#efe9dc", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffe2bc", "glow": 0.25},
    "bracket_green": {"color": "#3d6f5c", "roughness": 0.7, "metalness": 0.0},
    "bracket_shu": {"color": "#e0b25a", "roughness": 0.6, "metalness": 0.2},
    # bare cypress and keyaki, weathered silver-brown, as the Main Hall and the Yasaka Pagoda are
    "timber": {"color": "#6b5442", "roughness": 0.82, "metalness": 0.0, "emissive": "#ffc890", "glow": 0.18},
    "timber_dark": {"color": "#4a3a2e", "roughness": 0.85, "metalness": 0.0},
    "keyaki": {"color": "#5c4a3b", "roughness": 0.86, "metalness": 0.0, "emissive": "#ffb878", "glow": 0.22},
    "nuki": {"color": "#54443a", "roughness": 0.86, "metalness": 0.0},
    "hinoki_floor": {"color": "#a58e72", "roughness": 0.72, "metalness": 0.0},
    "lattice": {"color": "#3b2d24", "roughness": 0.8, "metalness": 0.0},
    # roofs: hinoki bark (檜皮), clay tiles (本瓦)
    "hiwada": {"color": "#6a4f3e", "roughness": 0.92, "metalness": 0.0, "pattern": "roof_tiles", "bay_m": 0.09, "course_m": 0.12},
    "hiwada_ridge": {"color": "#4b3a2f", "roughness": 0.9, "metalness": 0.0},
    # the Main Hall's roof of its own: hinoki bark laid in courses about 1.2 cm apart, weathered darker and
    # greyer than the smaller halls' (re-roofed 2017-2020), its thick cut edge at the eaves (軒付) the colour
    # of fresh bark
    "hondo_hiwada": {"color": "#4f3d33", "roughness": 0.95, "metalness": 0.0, "pattern": "roof_tiles", "bay_m": 0.06, "course_m": 0.08},
    "hondo_koba": {"color": "#86674f", "roughness": 0.92, "metalness": 0.0},
    # the dark inner sanctum (内陣) and the outer hall (外陣) behind the lattices: unlit wood, lacquer and gilt
    "naijin": {"color": "#16110d", "roughness": 0.96, "metalness": 0.0},
    "kawara": {"color": "#5b5f63", "roughness": 0.6, "metalness": 0.1, "pattern": "roof_tiles", "bay_m": 0.3, "course_m": 0.3},
    "kawara_ridge": {"color": "#43474a", "roughness": 0.6, "metalness": 0.1},
    "soffit": {"color": "#a8432c", "roughness": 0.8, "metalness": 0.0},
    "soffit_wood": {"color": "#5d4a3c", "roughness": 0.85, "metalness": 0.0},
    "gable_shu": {"color": "#a23a24", "roughness": 0.7, "metalness": 0.0},
    "gable_white": {"color": "#e7e1d3", "roughness": 0.8, "metalness": 0.0},
    "stone": {"color": "#9c968b", "roughness": 0.92, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.45, "block_m": 0.9},
    # the terrace before the West Gate (#187): granite flags laid over the aerial photograph
    "court_flags": {"color": "#a39d93", "roughness": 0.86, "metalness": 0.0, "pattern": "granite", "joints_m": [0.9, 0.6], "decal": True, "street_lit": True},
    # the West Gate's steps: granite, walked as a strip (game_surfaces), so not solid
    "gate_step": {"color": "#97918a", "roughness": 0.9, "metalness": 0.0, "pattern": "granite", "joints_m": [0.6, 0.36], "stair": "tread", "solid": False},
    "stone_dark": {"color": "#77736b", "roughness": 0.92, "metalness": 0.0},
    "bronze": {"color": "#4c4234", "roughness": 0.45, "metalness": 0.75},
    "gold": {"color": "#d6a93a", "roughness": 0.3, "metalness": 0.85, "emissive": "#ffc94a", "glow": 0.4},
    "nio": {"color": "#8a5a3c", "roughness": 0.7, "metalness": 0.1},
    "screen": {"color": "#2f2620", "roughness": 0.8, "metalness": 0.0, "opacity": 0.75},
    "water": {"color": "#d6eef6", "roughness": 0.05, "metalness": 0.1, "opacity": 0.55, "emissive": "#bfe8ff", "glow": 0.3},
    # the lanes: granite setts and steps, the shops' noren, lattices and lanterns (one atlas)
    "setts": {"color": "#8f8a80", "roughness": 0.9, "metalness": 0.0, "pattern": "granite", "joints_m": [0.45, 0.3], "street_lit": True, "decal": True},
    "kerb": {"color": "#a19b90", "roughness": 0.9, "metalness": 0.0, "solid": False},
    "step_stone": {"color": "#97918a", "roughness": 0.9, "metalness": 0.0, "pattern": "granite", "joints_m": [0.6, 0.35], "stair": "tread", "solid": False},
    "lanes": {"color": "#ffffff", "roughness": 0.85, "metalness": 0.0, "map": "lanes.png", "cutout": True, "emissive_map": True, "glow": 0.55, "solid": False},
    "lamp_paper": {"color": "#f3e6c8", "roughness": 0.7, "metalness": 0.0, "emissive": "#ffc070", "glow": 1.6, "solid": False},
    "lamp_cap": {"color": "#1d1a18", "roughness": 0.5, "metalness": 0.2, "solid": False},
    # kukurizaru (くくり猿): cloth monkeys bound hand and foot, hung in bright strings at Yasaka Koshin-do
    "saru_red": {"solid": False, "color": "#d8352c", "roughness": 0.85, "metalness": 0.0},
    "saru_pink": {"solid": False, "color": "#e77aa0", "roughness": 0.85, "metalness": 0.0},
    "saru_yellow": {"solid": False, "color": "#e8c03a", "roughness": 0.85, "metalness": 0.0},
    "saru_green": {"solid": False, "color": "#4f9a58", "roughness": 0.85, "metalness": 0.0},
    "saru_purple": {"solid": False, "color": "#7d5bb0", "roughness": 0.85, "metalness": 0.0},
    "hisashi": {"color": "#4d5054", "roughness": 0.65, "metalness": 0.1, "pattern": "roof_tiles", "bay_m": 0.25, "course_m": 0.25},
}

VERMILION = {"post": "shu", "wall": "kiyo_white", "roof": "hiwada", "soffit": "soffit", "gable": "gable_shu", "ridge": "hiwada_ridge",
             "base": "stone", "bracket": "bracket_green", "wood": "shu_dark", "metal": "bronze", "gold": "gold", "screen": "screen",
             "nio": "nio", "screen_wood": "lattice"}
VERMILION_TILE = dict(VERMILION, roof="kawara", ridge="kawara_ridge")
BARE = {"post": "timber", "wall": "kiyo_white", "roof": "hiwada", "soffit": "soffit_wood", "gable": "timber_dark", "ridge": "hiwada_ridge",
        "base": "stone", "bracket": "timber_dark", "wood": "timber_dark", "metal": "bronze", "gold": "gold", "screen": "screen",
        "nio": "nio", "screen_wood": "lattice", "pillar": "keyaki", "nuki": "nuki"}
BARE_TILE = dict(BARE, roof="kawara", ridge="kawara_ridge")

# (OpenStreetMap way, kind, published height to the top in metres, toward: the point its front faces)
KIYOMIZU = {
    "niomon": ("w102164608", 14.0),      # 仁王門, faces Kiyomizu-zaka (west)
    "saimon": ("w102164575", 11.0),      # 西門
    "sanjunoto": ("w102164638", 30.1),   # 三重塔
    "shoro": ("w102164614", 9.7),        # 鐘楼
    "kyodo": ("w102164586", 12.0),       # 経堂
    "tamurado": ("w102164632", 10.8),    # 田村堂 (開山堂)
    "todoroki": ("w102164595", 11.4),    # 轟門
    "asakura": ("w102164640", 11.4),     # 朝倉堂
    "hondo": ("w102164590", 18.0),       # 本堂
    "butai": ("w340294693", 0.0),        # 舞台
    "okunoin": ("w102164641", 12.0),     # 奥ノ院
    "shakado": ("w102164574", 9.1),      # 釈迦堂
    "amidado": ("w102164636", 10.3),     # 阿弥陀堂
    "koyasu": ("w333894528", 15.0),      # 子安塔
}
# each hall's own roof: (k, the sweep: archkit.japanese_roof's exponent, flat at the eaves and steep at the
# ridge; lift: the corners' rise, as a fraction of the overhang), read from photographs of each roof
# side on: the Main Hall's and the Okunoin's bark roofs sag deepest and barely lift at the corners, the
# tiled halls are stiffer and turn up more (docs/cities/higashiyama.md)
ROOFS = {"hondo": (1.9, 0.12), "okunoin": (1.8, 0.14), "kyodo": (1.45, 0.3), "tamurado": (1.5, 0.26), "asakura": (1.5, 0.28),
         "shakado": (1.7, 0.16), "amidado": (1.65, 0.18)}
SAIMON_WAY_FOOT = (142.0, -204.9)   # where the way up through the West Gate (OSM w339551498) starts, in the court below it
OKUNOIN_FLOOR = 115.45   # the Okunoin's floor (m): its stage level with the corridor from the north (114.7-115.9 on GSI's terrain)
OKUNOIN_STAGE = "w893859575"   # the Okunoin's stage, mapped apart from the hall
OKUNOIN_OPEN = (6.9, 4.2)   # where the stage's railing stops on its north and south ends (m forward), for the corridor
CORRIDOR_U = 6.2   # the corridor's line in front of the Amida-do, in the hall's frame (m forward of its outline's centre)
YASAKA = ("w371717416", 46.0)            # 八坂の塔
KIYOMIZU_ZAKA_TOP = (84.0, -165.0)       # where Kiyomizu-zaka meets the gate's steps (OSM 清水坂's end)
OTOWA = (300.2, -286.4)                  # 音羽の滝 不動明王 (OSM wayside shrine at the falls)
KOSHINDO = (135.7787378, 34.9985413)     # 八坂庚申堂 (OSM 庚申堂, the stone at its gate on Yasaka-dori)
LANES = ("産寧坂", "二寧坂", "一念坂", "清水坂", "八坂通")

_cache = {}


def ctx():
    if "C" not in _cache:
        import cityctx
        _cache["C"] = cityctx.City("higashiyama")
        _cache["T"] = ak.Terrain("higashiyama")
        _cache["S"] = ak.load_solids("higashiyama")
    return _cache["C"], _cache["T"], _cache["S"]


def solid_by_osm(oid):
    return solid_of(oid)


def solid_of(oid):
    _, _, S = ctx()
    got = [sd for sd in S if sd["osm"] == oid]
    return max(got, key=lambda sd: abs(ak.ring_area(sd["ring"]))) if got else None


def hondo_layout():
    """The Main Hall's frame and levels from its footprint and the slope, shared by the meshes and the
    game: u along the hall (east), v forward (south, out over the valley), z absolute."""
    if "hondo" in _cache:
        return _cache["hondo"]
    C, T, S = ctx()
    sd, st = solid_of(KIYOMIZU["hondo"][0]), solid_of(KIYOMIZU["butai"][0])
    if not sd or not st:
        return None
    cx, cy, ax, L, W = ak.oriented(sd["ring"])
    a = math.radians(ax)
    e1 = np.array([math.cos(a), math.sin(a)])
    if e1[0] < 0:
        e1 = -e1
    fwd = -left_of(e1)                                  # the front: south, toward the stage
    sc = np.array(ak.ring_centroid(st["ring"]))
    if (sc - (cx, cy)) @ fwd < 0:
        fwd = -fwd
    P = kk.frame((cx, cy), fwd)                        # u forward (south), v to the left (east)
    ring = np.asarray(sd["ring"]) - (cx, cy)
    us, vs = ring @ fwd, ring @ left_of(fwd)
    hu, hv = float(us.max() - us.min()) / 2, float(vs.max() - vs.min()) / 2
    # the floor: level with the hillside behind (the back half of the footprint)
    back = [T(*P(u, v, 0)[:2]) for u in np.linspace(-hu + 2, -hu * 0.2, 6) for v in np.linspace(-hv + 3, hv - 3, 7)]
    zf = round(float(np.percentile(back, 70)) + 0.5, 2)
    sring = np.asarray(st["ring"]) - (cx, cy)
    su, sv = sring @ fwd, sring @ left_of(fwd)
    out = {"P": P, "fwd": fwd, "c": (cx, cy), "hu": hu, "hv": hv, "zf": zf, "ridge": zf + KIYOMIZU["hondo"][1] - 0.5,
           "stage": {"u0": float(su.min()) + 0.3, "u1": float(su.max()) + 1.2, "v0": float(sv.min()), "v1": float(sv.max()), "z": zf - 0.25},
           "body_u1": float(su.min()) - 0.2}
    _cache["hondo"] = out
    return out


def kiyomizu(K, hidden):
    """Kiyomizu-dera's buildings on their footprints."""
    C, T, S = ctx()
    ground = lambda x, y: T(x, y)
    built = {}
    for key, (oid, h) in KIYOMIZU.items():
        sd = solid_of(oid)
        if not sd:
            continue
        built[key] = sd
    centre = lambda sd: np.array(ak.ring_centroid(sd["ring"]))

    def base_of(sd, P=None):
        """the lowest terrain round a footprint's middle (a platform is built up to the highest)"""
        cx, cy = ak.ring_centroid(sd["ring"])
        hs = [T(cx + dx, cy + dy) for dx in (-3, 0, 3) for dy in (-3, 0, 3)]
        return float(np.median(hs))

    # gates and the pagodas, facing down the approach (west) or toward the hall
    west = np.array(KIYOMIZU_ZAKA_TOP)
    if "niomon" in built:
        sd = built["niomon"]
        o, f, hu, hv = kk.site(sd["ring"], west)
        z0 = base_of(sd)
        kk.romon(K, VERMILION, kk.frame(o, f), z0, frontage=min(2 * hv - 2.0, 10.0), depth=min(2 * hu - 2.0, 5.2), ridge=KIYOMIZU["niomon"][1], ground=ground)
        hidden.append(sd["si"])
    if "saimon" in built:
        sd = built["saimon"]
        o, f, hu, hv = kk.site(sd["ring"], west)
        depth = min(2 * hu - 2.2, 5.0)
        g = kk.hakkyaku(K, VERMILION, kk.frame(o, f), base_of(sd), frontage=min(2 * hv - 2.2, 9.0), depth=depth,
                        ridge=KIYOMIZU["saimon"][1], roof="irimoya", ground=ground)
        saimon_steps(K, kk.frame(o, f), depth / 2 + 0.7, g["stone"], ground)
        hidden.append(sd["si"])
    if "todoroki" in built:
        sd = built["todoroki"]
        o, f, hu, hv = kk.site(sd["ring"], centre(built["hondo"]) if "hondo" in built else west)
        kk.hakkyaku(K, VERMILION_TILE, kk.frame(o, f), base_of(sd), frontage=min(2 * hv - 1.6, 7.0), depth=min(2 * hu - 1.6, 4.4),
                    ridge=KIYOMIZU["todoroki"][1], roof="kirizuma", ground=ground)
        hidden.append(sd["si"])
    for key, n, core in (("sanjunoto", 3, 3.25), ("koyasu", 3, 1.75)):
        if key in built:
            sd = built[key]
            o, f, hu, hv = kk.site(sd["ring"], west)
            core = min(core, min(hu, hv) - 1.2)
            kk.pagoda(K, VERMILION_TILE, kk.frame(o, f), base_of(sd), n, KIYOMIZU[key][1], KIYOMIZU[key][1] * 0.3, core, podium=1.0,
                      deep=1.0 if key == "sanjunoto" else 0.6, ground=ground)
            hidden.append(sd["si"])
    if "shoro" in built:   # the bell tower: open on its posts, the bell under an irimoya of tiles
        sd = built["shoro"]
        o, f, hu, hv = kk.site(sd["ring"], west)
        P = kk.frame(o, f)
        z0 = base_of(sd)
        h = KIYOMIZU["shoro"][1]
        a, b = min(hu - 1.4, 2.6), min(hv - 1.4, 3.2)
        block(K["stone"], P, -a - 0.9, a + 0.9, -b - 0.9, b + 0.9, z0 - 0.8, z0 + 1.0)
        kk.plinth(K, "stone", P, a + 0.9, b + 0.9, z0 + 1.0, ground)
        ze = z0 + h * 0.62
        for su in (-1, 1):
            for sv in (-1, 0, 1):
                x, y, _ = P(su * a, sv * b, 0)
                kk.post(K, "shu", x, y, z0 + 1.0, ze - 0.6, 0.24, "stone")
        block(K["shu"], P, -a - 0.2, a + 0.2, -b - 0.2, b + 0.2, ze - 0.95, ze - 0.6)
        kk.brackets(K, VERMILION_TILE, P, a, b, ze - 0.6, ze, out=0.7)
        x, y, _ = P(0, 0, 0)
        lathe_at(K["bronze"], x, y, [(ze - 3.1, 0.0), (ze - 3.1, 0.75), (ze - 2.9, 0.78), (ze - 1.4, 0.68), (ze - 1.0, 0.45), (ze - 0.7, 0.12)], 16)
        from japankit import irimoya as jirimoya
        R = jirimoya(K["kawara"], K["gable_shu"], K["soffit"], kk.across(P), b + 0.4, a + 0.4, ze, z0 + h - 0.6, ov=1.8, gable_at=0.5, k=1.6)
        kk.ridge_cap(K, VERMILION_TILE, P, R["Ug"] + 0.3, z0 + h - 0.8, h=0.5)
        hidden.append(sd["si"])
    # the halls: the sutra hall and the founder's hall vermilion, the others bare timber
    for key, M, roof, face in (("kyodo", VERMILION_TILE, "irimoya", west), ("tamurado", VERMILION_TILE, "hogyo", west),
                               ("asakura", BARE_TILE, "irimoya", None), ("shakado", BARE, "yosemune", None), ("amidado", BARE, "irimoya", None)):
        if key not in built:
            continue
        sd = built[key]
        toward = face if face is not None else centre(built["hondo"]) if "hondo" in built else west
        o, f, hu, hv = kk.site(sd["ring"], toward)
        z0 = base_of(sd)
        h = KIYOMIZU[key][1]
        ov = max(1.6, min(hu, hv) * 0.3)
        k, lift = ROOFS[key]
        a = hu - ov * 0.6
        if key == "amidado":
            # the covered corridor (OSM w1340239544) runs along the hall's front inside its mapped outline,
            # from the Shaka-do to the Okunoin: the hall stands back behind it, the corridor under a lean-to
            back, front = -a, CORRIDOR_U - 1.1 - 1.6
            a = (front - back) / 2
            o = o + f * (front + back) / 2
            lean_to(K, BARE, kk.frame(o, f), a + 0.3, CORRIDOR_U + 1.9 - (front + back) / 2, hv - ov * 0.6 + 0.4, z0 + h * 0.4, z0 + 0.0, ground)
        kk.hall(K, M, kk.frame(o, f), z0, a, hv - ov * 0.6, z0 + 0.9, z0 + h * 0.48, z0 + h, roof=roof, ov=ov, ground=ground,
                k=k, lift=lift * ov)
        hidden.append(sd["si"])
    if "hondo" in built and "butai" in built:
        hondo(K, ground)
        hidden += [built["hondo"]["si"], built["butai"]["si"]]
    if "okunoin" in built:
        okunoin(K, built["okunoin"], ground)
        hidden.append(built["okunoin"]["si"])
        st = solid_of(OKUNOIN_STAGE)
        if st:
            hidden.append(st["si"])
    otowa(K, ground)


def hondo(K, ground):
    """The Main Hall and its stage. The hall's body on the hillside, its floor level with the slope behind;
    the front over the valley on the keyaki lattice; the wing corridors either side of the stage, their
    gables to the front; the great hipped roof of hinoki bark; the stage with its railing on three sides."""
    H = hondo_layout()
    P, hu, hv, zf = H["P"], H["hu"], H["hv"], H["zf"]
    st = H["stage"]
    ridge = H["ridge"]
    # the body: from the back of the footprint to the stage
    b0, b1 = -hu + 1.5, st["u0"]
    bm, bh = (b0 + b1) / 2, (b1 - b0) / 2
    Q = lambda u, v, z: P(bm + u, v, z)
    wv = hv - 2.2
    # under the front half, where the slope falls away: the lattice
    kk.kakezukuri(K, BARE, P, bm, b1, -wv, wv, zf, ground, every=3.8)
    zt = zf + 5.2
    block(K["timber_dark"], Q, -bh, bh, -wv, wv, zf - 0.6, zf)                   # the floor's edge beam
    naijin(K, Q, bh, wv, zf, zt)
    for u in np.linspace(-bh, bh, 9):
        for v in (-wv, wv):
            x, y, _ = Q(u, v, 0)
            kk.post(K, "timber", x, y, zf, zt, 0.3)
    for v in np.linspace(-wv, wv, 12):
        x, y, _ = Q(bh, v, 0)
        kk.post(K, "timber", x, y, zf, zt, 0.3)
        block(K["lattice"], Q, bh - 2.4, bh - 2.32, v - 1.2, v + 1.2, zf + 0.4, zt - 1.0) if abs(v) < wv - 0.5 else None
    block(K["timber_dark"], Q, -bh - 0.15, bh + 0.15, -wv - 0.15, wv + 0.15, zt - 0.6, zt)
    kk.brackets(K, BARE, Q, bh, wv, zt, zt + 1.0, out=0.9)
    # the great roof: hipped, of hinoki bark, its ridge along the hall
    from kyotokit import hip_roof
    k, lift = ROOFS["hondo"]
    corners = hip_roof(K["hondo_hiwada"], K["soffit_wood"], kk.across(Q), wv + 0.9, bh + 0.9, zt + 1.0, ridge - 0.5, ov=3.4, k=k, ridge_frac=0.62,
                       lift=lift * 3.4)
    koba(K["hondo_koba"], corners, lift * 3.4)
    block(K["hiwada_ridge"], Q, -0.6, 0.6, -(wv - bh) * 0.62 - 1.2, (wv - bh) * 0.62 + 1.2, ridge - 0.9, ridge + 0.4)
    # the wing corridors forward of the body, either side of the stage, each under its own roof with its gable to the front
    for side in (-1, 1):
        v_in = st["v1"] + 0.6 if side > 0 else st["v0"] - 0.6
        v_out = side * hv
        va, vb = sorted((v_in, v_out))
        if vb - va < 3.0:
            continue
        ua, ub = b1 - 1.0, max(st["u1"] - 1.0, b1 + 4.0)
        Wc = (vb - va) / 2
        R = lambda u, v, z, vc=(va + vb) / 2, uc=(ua + ub) / 2: P(uc + u, vc + v, z)
        Uh = (ub - ua) / 2
        kk.kakezukuri(K, BARE, P, ua, ub, va + 0.4, vb - 0.4, zf, ground, every=3.4)
        block(K["timber_dark"], R, -Uh, Uh, -Wc, Wc, zf - 0.5, zf)
        for u in np.linspace(-Uh, Uh, 4):
            for v in (-Wc + 0.3, Wc - 0.3):
                x, y, _ = R(u, v, 0)
                kk.post(K, "timber", x, y, zf, zf + 3.8, 0.26)
        # the outer wall: boards below, a band of white plaster under the eaves; dark behind the posts
        block(K["timber_dark"], R, -Uh + 0.3, Uh - 0.3, side * (Wc - 0.5) - 0.12, side * (Wc - 0.5) + 0.12, zf, zf + 2.6)
        block(K["kiyo_white"], R, -Uh + 0.3, Uh - 0.3, side * (Wc - 0.5) - 0.1, side * (Wc - 0.5) + 0.1, zf + 2.6, zf + 3.4)
        block(K["naijin"], R, -Uh + 0.3, Uh - 0.3, -Wc + 0.6, Wc - 0.8, zf + 3.0, zf + 3.4)      # the ceiling's shadow
        block(K["timber_dark"], R, -Uh - 0.1, Uh + 0.1, -Wc - 0.1, Wc + 0.1, zf + 3.4, zf + 3.8)
        kk.kirizuma(K, {"roof": "hondo_hiwada", "gable": "timber_dark", "soffit": "soffit_wood", "ridge": "hiwada_ridge"},
                    lambda u, v, z, R=R: R(v, u, z), Wc, Uh, zf + 4.1, zf + 7.6, ov_u=1.6, ov_v=1.4)
    # the stage: boards on the lattice, its railing round the three open sides
    zs = st["z"]
    # eighteen keyaki pillars under the stage itself (the temple's count): six across its front, three
    # rows deep, about 0.64 m thick (cf. photographs against the 1.8 m railing posts), tied by four tiers
    # of through-beams
    kk.kakezukuri(K, BARE, P, st["u0"], st["u1"], st["v0"], st["v1"], zs, ground, bays=(2, 5), r=0.32)
    m = K["hinoki_floor"]
    for k in range(int((st["v1"] - st["v0"]) / 0.3)):
        v = st["v0"] + k * 0.3
        block(m, P, st["u0"] - 0.2, st["u1"], v + 0.012, v + 0.288, zs - 0.12, zs)
    block(K["timber_dark"], P, st["u0"] - 0.2, st["u1"] + 0.1, st["v0"] - 0.1, st["v1"] + 0.1, zs - 0.45, zs - 0.12)
    rail = [P(st["u0"], st["v0"], zs), P(st["u1"], st["v0"], zs), P(st["u1"], st["v1"], zs), P(st["u0"], st["v1"], zs)]
    K["timber"].rails(rail, 0.95, post_every=1.8, post=0.14, rail=0.1, rails=2)


def saimon_steps(K, P, u_edge, z_top, ground, width=5.4, max_rise=0.2):
    """The West Gate stands on a stone platform at the top of the slope from the Deva Gate's court; the way
    (OSM w339551498) climbs 1.5 m more to it than the slope does, by a steep flight of granite steps down
    its front (west) to where the way meets the court. Records the flight for the game (game_surfaces:
    one strip, its slope the flight's)."""
    ground = kk.game_ground("higashiyama")      # the ground the game draws and walks at the flight's foot
    end = np.array(SAIMON_WAY_FOOT, float)
    o, f = np.array(P(0, 0, 0)[:2]), np.array(P(1, 0, 0)[:2]) - np.array(P(0, 0, 0)[:2])
    u_end = max(float((end - o) @ f), u_edge + 1.0)
    z_end = ground(*P(u_end, 0, 0)[:2])
    n = max(1, int(math.ceil((z_top - z_end) / max_rise)))
    rise, tread = (z_top - z_end) / n, (u_end - u_edge) / n
    for k in range(n):
        u, z = u_edge + k * tread, z_top - (k + 1) * rise
        block(K["gate_step"], P, u, u + tread + 0.02, -width / 2, width / 2, min(ground(*P(u + tread, sv * width / 2, 0)[:2]) for sv in (-1, 0, 1)) - 0.5, z)
    for sv in (-1, 1):       # the flight's side walls, down from the platform
        block(K["stone"], P, u_edge - 0.05, u_end, sv * (width / 2 + 0.3) - 0.3, sv * (width / 2 + 0.3) + 0.3,
              min(ground(*P(u_end, sv * width / 2, 0)[:2]), z_end) - 0.5, z_top - 0.05)
    _cache["saimon_steps"] = {"P": P, "u0": u_edge, "u1": u_end, "z_top": z_top, "z_foot": z_end, "width": width}
    # the terrace at the foot of the flight, the city's sunset view, in granite flags laid over the aerial
    # photograph, whose trees' shadows lay flat on it (#187); not where a building stands
    from shapely.geometry import Polygon as Poly
    pad = Poly([P(u, v, 0)[:2] for u, v in ((u_end, -7.0), (u_end + 9.0, -7.0), (u_end + 9.0, 7.0), (u_end, 7.0))])
    C, T, S = ctx()
    for sd in S:
        q = Poly(sd["ring"]).buffer(0.1)
        if sd["base"] <= 0 and q.intersects(pad):
            pad = pad.difference(q)
    drape(K["court_flags"], pad, ground)


def drape(m, poly, ground=None):
    """A decal on the ground the game draws (kyotokit.game_ground)."""
    kk.drape(m, poly, kk.game_ground("higashiyama"), lift=0.04, cell=1.0)


def lean_to(K, M, P, u0, u1, hv, z_hi, z_ground, ground):
    """A lean-to roof (庇) of bark from a hall's front wall out over a corridor, on a row of posts at its
    outer edge: u from u0 (the wall, z_hi) to u1 (the posts), across +-hv."""
    z_lo = z_hi - 0.22 * (u1 - u0) - 0.4
    us = np.linspace(u0, u1 + 0.9, 5)
    zs = [z_hi - (z_hi - z_lo + 0.25) * ((u - u0) / (u1 + 0.9 - u0)) ** 1.25 for u in us]
    vs = np.linspace(-hv, hv, 6)
    K[M["roof"]].grid([[P(u, v, z) for v in vs] for u, z in zip(us, zs)])
    K[M["soffit"]].grid([[P(u, v, z - 0.12) for v in vs[::-1]] for u, z in zip(us, zs)])
    for v in np.linspace(-hv + 0.3, hv - 0.3, max(2, int(2 * hv / 3.0) + 1)):
        x, y, _ = P(u1, v, 0)
        kk.post(K, M["post"], x, y, ground(x, y), z_lo + 0.05, 0.13, M["base"])
    block(K[M["post"]], P, u1 - 0.12, u1 + 0.12, -hv, hv, z_lo - 0.25, z_lo + 0.05)


def naijin(K, Q, bh, wv, zf, zt):
    """The Main Hall's inside, seen through its lattices and open sides: the outer hall (外陣) and the
    inner sanctum (内陣) dark, under a coffered ceiling, the gilt shrine (厨子) of the Eleven-headed
    Thousand-armed Kannon at the back between its attendants' (the image is shown once in 33 years);
    the outer walls of boards and shitomi lattices with a band of white plaster above, not white walls."""
    block(K["naijin"], Q, -bh + 0.6, bh - 2.6, -wv + 0.6, wv - 0.6, zf, zt - 0.6)
    block(K["naijin"], Q, -bh + 0.6, bh - 2.45, -wv + 0.45, wv - 0.45, zt - 1.0, zt - 0.6)       # the ceiling
    for v in (-wv * 0.35, 0.0, wv * 0.35):                                                    # the three zushi
        w = 1.3 if v == 0 else 0.9
        block(K["gold"], Q, -bh + 0.62, -bh + 1.6, v - w, v + w, zf + 0.6, zf + 0.6 + 2.6 * w)
    for side in (-1, 1):
        sv = side * (wv - 0.35)
        for u0, u1 in zip(np.linspace(-bh, bh, 9)[:-1], np.linspace(-bh, bh, 9)[1:]):
            block(K["lattice"], Q, u0 + 0.32, u1 - 0.32, sv - 0.06, sv + 0.06, zf + 0.25, zt - 1.7)            # shitomi
            block(K["kiyo_white"], Q, u0 + 0.3, u1 - 0.3, sv - 0.05, sv + 0.05, zt - 1.7, zt - 0.6)           # 小壁
            block(K["timber_dark"], Q, u0 + 0.3, u1 - 0.3, sv - 0.1, sv + 0.1, zt - 1.85, zt - 1.7)           # 長押
    block(K["timber_dark"], Q, -bh + 0.35, -bh + 0.6, -wv + 0.4, wv - 0.4, zf, zt - 0.6)                    # the back wall


def koba(m, corners, lift, depth=0.55, n=12):
    """A bark roof's thick cut edge (軒付) round the eaves, following their rise to the corners."""
    C = [np.asarray(c, float) for c in corners]
    for i in range(4):
        a, b = C[i], C[(i + 1) % 4]
        for j in range(n):
            s0, s1 = -1 + 2 * j / n, -1 + 2 * (j + 1) / n
            p0, p1 = a + (b - a) * (s0 + 1) / 2, a + (b - a) * (s1 + 1) / 2
            z0 = a[2] - lift + lift * abs(s0) ** 3
            z1 = a[2] - lift + lift * abs(s1) ** 3
            m.quad((p0[0], p0[1], z0 - depth), (p1[0], p1[1], z1 - depth), (p1[0], p1[1], z1 + 0.05), (p0[0], p0[1], z0 + 0.05))


def okunoin(K, sd, ground):
    """The Inner Hall: a hipped hall of hinoki bark facing the Main Hall, its stage out over the slope on
    keyaki pillars (懸造), from which the Main Hall is seen whole. The stage runs the hall's whole front,
    level with the way from the Amida-do: the covered corridor (OSM w1272415075) comes onto it from the
    north, crosses it and leaves to the south past the hall's corner, so its ends are open, with the
    railing along the valley side alone."""
    H = hondo_layout()
    toward = np.array(H["c"]) if H else np.array([0.0, 0.0])
    o, f, hu, hv = kk.site(sd["ring"], toward)
    P = kk.frame(o, f)
    # the floor: level with the corridor where it comes onto the stage from the north (the Amida-do's)
    zf = OKUNOIN_FLOOR
    h = KIYOMIZU["okunoin"][1]
    body_u1 = 0.6
    bh = (body_u1 + hu - 1.0) / 2
    bm = (body_u1 - hu + 1.0) / 2
    Q = lambda u, v, z: P(bm + u, v, z)
    wv = hv - 3.2      # clear of the corridor where it leaves past the hall's south-west corner
    kk.kakezukuri(K, BARE, P, bm - bh, body_u1, -wv, wv, zf, ground, every=3.4)
    k, lift = ROOFS["okunoin"]
    kk.hall(K, BARE, Q, zf - 0.4, bh - 1.0, wv, zf, zf + h * 0.42, zf + h, roof="yosemune", ov=2.4, veranda=False, k=k, lift=lift * 2.4)
    # the veranda along the hall's whole front, and the stage out from it over the valley toward the Main
    # Hall, on its own outline (OSM w893859575, a shallow, wide platform); their floor one level
    zs = zf - 0.2
    su0, sa = body_u1 + 0.3, hu + 0.05
    st = solid_by_osm(OKUNOIN_STAGE)
    if st is not None:
        r = np.asarray(st["ring"]) - o
        us, vs = r @ f, r @ left_of(f)
        sb, (vb0, vb1) = float(us.max()) + 0.2, (float(vs.min()), float(vs.max()))
    else:
        sb, (vb0, vb1) = hu + 1.5, (-5.0, 5.0)
    kk.kakezukuri(K, BARE, P, su0, sa, -hv, hv, zs, ground, every=3.0)
    kk.kakezukuri(K, BARE, P, sa, sb, vb0, vb1, zs, ground, every=3.0)
    for k in range(int(2 * hv / 0.3)):
        v = -hv + k * 0.3
        u1 = sb if vb0 <= v + 0.15 <= vb1 else sa
        block(K["hinoki_floor"], P, su0, u1, v + 0.012, v + 0.288, zs - 0.12, zs)
    rail = lambda pts: K["timber"].rails([P(u, v, zs) for u, v in pts], 0.95, post_every=1.6, post=0.13, rail=0.09)
    rail([(OKUNOIN_OPEN[0], -hv), (sa, -hv), (sa, vb0), (sb, vb0), (sb, vb1), (sa, vb1), (sa, hv), (OKUNOIN_OPEN[1], hv)])
    _cache["okunoin"] = {"P": P, "stage_u": (su0, sa), "sv": hv, "z": zs, "fwd": f, "o": o, "stage": (sa, sb, vb0, vb1)}


def otowa(K, ground):
    """The Otowa Falls: three streams falling from a rock face under a timber roof into a stone basin;
    people drink from long-handled cups (one stream each: learning, love, long life)."""
    H = hondo_layout()
    x, y = OTOWA
    # the falls face out over the path below, toward the Main Hall's stage
    f = unit(np.array(H["c"]) - (x, y)) if H else np.array([-1.0, 0.0])
    P = kk.frame((x, y), f)
    z0 = ground(*P(3.5, 0, 0)[:2])
    # the rock face and the stone wall it stands in, behind the spouts
    block(K["stone"], P, -1.6, 0.0, -5.0, 5.0, z0 - 0.5, z0 + 4.6)
    for k, v in enumerate((-1.3, 0.0, 1.3)):
        K["bronze"].box(P(0.0, v, z0 + 3.2), P(0.9, v, z0 + 3.15), 0.12, 0.12)            # the spout
        xx, yy, _ = P(0.95, v, 0)
        lathe_at(K["water"], xx, yy, [(z0 + 0.25, 0.045), (z0 + 3.15, 0.035)], 8)          # the stream
    block(K["stone_dark"], P, 0.4, 2.2, -4.4, 4.4, z0 - 0.3, z0 + 0.25)                    # the basin
    block(K["water"], P, 0.5, 2.1, -4.3, 4.3, z0 + 0.12, z0 + 0.2)
    # the roof over the people waiting, on posts at the front
    for v in (-4.8, 0.0, 4.8):
        xx, yy, _ = P(5.2, v, 0)
        kk.post(K, "timber", xx, yy, z0, z0 + 3.3, 0.16, "stone")
    kk.kirizuma(K, {"roof": "kawara", "gable": "timber_dark", "soffit": "soffit_wood", "ridge": "kawara_ridge"},
                lambda u, v, z: P(2.6 + u, v, z), 2.8, 4.9, z0 + 3.4, z0 + 4.6, ov_u=0.8, ov_v=0.6)
    _cache["otowa"] = {"P": P, "z": z0}


def yasaka(K, hidden):
    """The Yasaka Pagoda: five storeys of bare timber and white plaster, 46 m to the tip of its finial."""
    sd = solid_of(YASAKA[0])
    if not sd:
        return
    C, T, S = ctx()
    o, f, hu, hv = kk.site(sd["ring"], (-440.0, 189.0))   # facing down Yasaka-dori (west)
    z0 = T(*o)
    kk.pagoda(K, BARE_TILE, kk.frame(o, f), z0, 5, YASAKA[1], 9.6, min(3.25, min(hu, hv) - 2.0), podium=1.2, deep=0.95, ground=T)
    hidden.append(sd["si"])


def koshindo(K):
    """Yasaka Koshin-do's kukurizaru: strings of cloth monkeys, each a ball bound hand and foot, in red
    with the odd pink, yellow, green and purple, hung on a frame at the temple's gate on Yasaka-dori
    (where Detective Conan's Crimson School Trip, 2018, puts Shinichi and Ran with the pagoda behind)."""
    C, T, S = ctx()
    x, y = C.fwd.transform(*KOSHINDO)
    P = kk.frame((x, y + 1.2), (0.0, -1.0))           # facing the street, south
    z0 = T(x, y + 1.2)
    rng = np.random.default_rng(4)
    for side in (-1, 1):                               # a frame either side of the gate
        Q = lambda u, v, z, side=side: P(u, v + side * 2.6, z)
        for v in (-1.3, 1.3):
            xx, yy, _ = Q(0, v, 0)
            kk.post(K, "timber_dark", xx, yy, z0, z0 + 2.6, 0.06)
        K["timber_dark"].box(Q(0, -1.4, z0 + 2.55), Q(0, 1.4, z0 + 2.55), 0.08, 0.08)
        for v in np.linspace(-1.2, 1.2, 13):
            for k in range(9):
                zz = z0 + 2.4 - 0.2 - k * 0.2
                c = ("saru_red",) * 6 + ("saru_pink", "saru_yellow", "saru_green", "saru_purple")
                mat = c[int(rng.integers(len(c)))]
                xx, yy, _ = Q(0.0, v + rng.uniform(-0.02, 0.02), 0)
                lathe_at(K[mat], xx, yy, [(zz - 0.08, 0.0), (zz - 0.06, 0.06), (zz + 0.02, 0.075), (zz + 0.07, 0.04), (zz + 0.08, 0.0)], 6)
    _cache["koshindo"] = {"at": (float(x), float(y) - 2.0), "z": z0}


# ---------------------------------------------------------------- the lanes

NOREN = [  # (key, cloth colour, words, ink)
    ("noren_indigo", (34, 46, 78), "清水焼", (238, 232, 218)),
    ("noren_brown", (88, 56, 38), "甘味処", (240, 230, 210)),
    ("noren_white", (232, 226, 210), "八ツ橋", (40, 34, 30)),
    ("noren_red", (150, 38, 30), "七味", (246, 236, 214)),
    ("noren_green", (52, 78, 58), "抹茶", (240, 234, 216)),
    ("noren_black", (30, 28, 28), "京扇子", (226, 196, 120)),
    ("noren_sky", (60, 92, 128), "湯豆腐", (238, 232, 218)),
    ("noren_ochre", (168, 120, 52), "漬物", (36, 28, 22)),
]
LANES_ATLAS = Atlas([(k, 256, 320) for k, *_ in NOREN] + [("koshi", 512, 512), ("chochin", 256, 256)], width=1024)


def lanes_paths():
    """The lanes' lines from OpenStreetMap, in metres: [(name, highway, [(x, y)], width)]."""
    C, T, S = ctx()
    d = json.load(open(os.path.join(HERE, "kiyomizu_osm.json")))
    out = []
    for w in d["ways"]:
        t = w["tags"]
        if t.get("name") in LANES and t.get("highway") in ("pedestrian", "steps", "residential", "footway", "service"):
            pts = [C.fwd.transform(*p) for p in w["ll"]]
            wd = float(t.get("width", 0) or 0) or (4.2 if t.get("highway") != "service" else 3.2)
            out.append((t["name"], t["highway"], pts, wd))
    return out


def lanes(K):
    """Stone setts along the lanes and their flights of steps, and the shop fronts facing them: a noren in
    the doorway, a lattice (格子) over the ground floor, a paper lantern at the door."""
    C, T, S = ctx()
    paths = lanes_paths()
    from shapely.geometry import LineString, Polygon
    from shapely.ops import unary_union
    for name, hw, pts, wd in paths:
        if hw == "steps":
            kk.stairs(K["step_stone"], pts, wd, T(*pts[0]), T(*pts[-1]))
        else:
            kk.paving(K["setts"], pts, wd, T, lift=0.05, step=1.5, kerb=K["kerb"])
    line = unary_union([LineString(p) for _, _, p, _ in paths])
    rng = np.random.default_rng(7)
    m = K["lanes"]
    lamps_p, lamps_c = K["lamp_paper"], K["lamp_cap"]
    n = 0
    for sd in S:
        if sd["top"] > 14 or sd["base"] > 0:
            continue
        ring = sd["ring"]
        g = Polygon(ring)
        if not g.is_valid or g.area > 900 or g.distance(line) > 6.0:
            continue
        for a, b in zip(ring, ring[1:] + ring[:1]):
            a, b = np.asarray(a), np.asarray(b)
            L = float(np.linalg.norm(b - a))
            if L < 3.0:
                continue
            t = (b - a) / L
            nrm = np.array([t[1], -t[0]])
            mid = (a + b) / 2
            if g.contains(Point(*(mid + nrm * 0.5))):
                nrm = -nrm
            if line.distance(Point(*(mid + nrm * 1.0))) > 4.5:
                continue
            z = min(T(*a), T(*b))
            off = nrm * 0.08
            # the lattice over the ground floor, either side of the door
            zl = z + 2.5
            k0, k1 = 0.15, 0.85
            p0, p1 = a + (b - a) * k0 + off, a + (b - a) * k1 + off
            u0, v0, u1, v1 = LANES_ATLAS.uv("koshi")
            reps = max(1.0, (k1 - k0) * L / 2.0)
            m.quad(np.array([*p0, z + 0.05]), np.array([*p1, z + 0.05]), np.array([*p1, zl]), np.array([*p0, zl]),
                   [[u0, v0], [u0 + (u1 - u0) * min(reps, 1.0), v0], [u0 + (u1 - u0) * min(reps, 1.0), v1], [u0, v1]])
            # the noren in the doorway, in front of the lattice
            key = NOREN[int(rng.integers(len(NOREN)))][0]
            wn = min(2.2, L * 0.4)
            c = mid + nrm * 0.25
            q0, q1 = c - t * wn / 2, c + t * wn / 2
            LANES_ATLAS.quad(m, np.array([*q0, z + 1.35]), np.array([*q1, z + 1.35]), np.array([*q1, z + 2.35]), np.array([*q0, z + 2.35]), key)
            LANES_ATLAS.quad(m, np.array([*q1, z + 1.35]), np.array([*q0, z + 1.35]), np.array([*q0, z + 2.35]), np.array([*q1, z + 2.35]), key)
            K["lattice"].box(np.array([*(q0 - t * 0.1), z + 2.38]), np.array([*(q1 + t * 0.1), z + 2.38]), 0.04, 0.04)
            # a paper lantern hung at the door, every other shop
            if rng.random() < 0.55:
                lp = mid + t * (wn / 2 + 0.5) + nrm * 0.45
                tmp_p, tmp_c = Mesh("_", "lamp_paper", False), Mesh("_", "lamp_cap", False)
                kk.chochin(tmp_p, tmp_c, z + 2.0, 0.17, 0.5)
                for src, dst in ((tmp_p, lamps_p), (tmp_c, lamps_c)):
                    base = len(dst.v)
                    dst.v += [(float(vx) + lp[0], float(vy) + lp[1], float(vz)) for vx, vy, vz in src.v]
                    dst.t += [[0.0, 0.0]] * len(src.v)
                    dst.i += [i + base for i in src.i]
            n += 1
    return n


def landmark_meshes(scene):
    mats = {k: dict(v) for k, v in MATERIALS.items()}
    K = ak.Kit("kiyomizu", floodlit={"shu", "kiyo_white", "timber", "keyaki", "gold", "water", "lanes", "lamp_paper"},
               uv={"hiwada", "hondo_hiwada", "gate_step", "court_flags", "kawara", "stone", "setts", "step_stone", "lanes", "hisashi"})
    hidden = []
    kiyomizu(K, hidden)
    yasaka(K, hidden)
    koshindo(K)
    L = ak.Kit("lanes", floodlit={"lanes", "lamp_paper"}, uv={"setts", "step_stone", "lanes"})
    lanes(L)
    H = hondo_layout()
    if H:
        z = H["zf"]
        for k in ("shu", "keyaki", "timber", "kiyo_white"):
            mats[k]["flood"] = [round(z - 16.0, 1), round(z + 20.0, 1), 0.5, 0.6]
    extra = {"hidden": sorted(set(hidden))}
    gs = _cache.get("saimon_steps")
    if gs:   # the ground isn't drawn over the West Gate's steps, which the laser terrain's slope would bury
        P, w = gs["P"], gs["width"] / 2 + 0.6
        extra["clip"] = [{"ring": [[round(float(c), 2) for c in P(u, v, 0)[:2]] for u, v in
                                   ((gs["u0"] - 0.1, -w), (gs["u1"] + 0.1, -w), (gs["u1"] + 0.1, w), (gs["u0"] - 0.1, w))], "holes": []}]
    extra["trees"] = gion_cherry()
    return mats, K.out() + L.out(), extra


# Maruyama Park's Gion weeping cherry (the second tree, grown in 1949 from the first's seed, about 12 m tall),
# on its own spot: the lone round crown in the gravel plaza north-west of the Hyotan pond in the city's aerial
# photograph (35.00388 N, 135.78090 E). OSM maps no node for it; its two nearest mapped trees, 6 m west in the
# open plaza, are taken off (places.json), and trees.areas' "Gion weeping cherry" circle makes it a weeping cherry.
GION_CHERRY = (-100.8, 763.5, 12.0)


def gion_cherry():
    x, y, h = GION_CHERRY
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "web", "data", "higashiyama", "places.json")
    P = json.load(open(path))
    t = P.get("trees", [])
    keep = [v for i in range(0, len(t), 4) if math.hypot(t[i] / 10 - x, t[i + 1] / 10 - y) >= 7.5 for v in t[i:i + 4]]
    if len(keep) != len(t):
        P["trees"] = keep
        json.dump(P, open(path, "w"), separators=(",", ":"))
    return [round(x * 10), round(y * 10), round(kk.game_ground("higashiyama")(x, y) * 10), round(h * 10)]


def landmark_assets(out_dir, scene):
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (LANES_ATLAS.W, LANES_ATLAS.H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for key, cloth, words, ink in NOREN:
        x, y, w, h = LANES_ATLAS.rects[key]
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(*cloth, 255))
        # the split in the middle (a noren hangs in two or three panels) and the words down it
        d.rectangle([x + w // 2 - 3, y + int(h * 0.3), x + w // 2 + 3, y + h - 1], fill=(0, 0, 0, 0))
        vertical(d, words, x + w / 2, y + h * 0.08, y + h * 0.92, "mincho", (*ink, 255), w * 0.42)
    x, y, w, h = LANES_ATLAS.rects["koshi"]
    for k in range(0, w, 16):   # the lattice: thin vertical slats close together, two rails across
        d.rectangle([x + k, y, x + k + 9, y + h - 1], fill=(58, 44, 34, 255))
    for yy in (y, y + 18, y + h - 30):
        d.rectangle([x, yy, x + w - 1, yy + 12], fill=(48, 36, 28, 255))
    x, y, w, h = LANES_ATLAS.rects["chochin"]
    d.ellipse([x, y, x + w - 1, y + h - 1], fill=(240, 226, 196, 255))
    img.save(os.path.join(out_dir, "lanes.png"))
    return ["lanes.png"]


def landmark_glows(scene):
    """The paper lanterns' and the illuminated temple's light after dark."""
    H = hondo_layout()
    out = []
    if H:
        x, y, _ = H["P"]((H["stage"]["u0"] + H["stage"]["u1"]) / 2, 0, 0)
        out.append([round(float(x), 1), round(float(y), 1), 40.0, "#ffb070", 0.35])
    return out


def finalize(ctx):
    C = ctx.city
    for name, (lon, lat), up in (("Kiyomizu-dera 清水寺", (135.78499, 34.99483), 24.0), ("Yasaka Pagoda 八坂の塔", (135.77925, 34.99856), 50.0),
                                 ("Sannenzaka 産寧坂", (135.78115, 34.99645), 12.0), ("Ninenzaka 二寧坂", (135.78108, 34.99825), 12.0),
                                 ("Kodai-ji 高台寺", (135.78105, 35.00065), 16.0), ("Yasaka Shrine 八坂神社", (135.77856, 35.00366), 18.0)):
        x, y = C.fwd.transform(lon, lat)
        ctx.labels[name] = [round(x, 1), round(y, 1), round(ctx.ground(x, y) + up, 1)]


# ---------------------------------------------------------------- the game

def xy(p):
    return [round(float(p[0]), 2), round(float(p[1]), 2)]


def game_surfaces(scene):
    """The Main Hall's front gallery and its stage, and the Okunoin's stage, walked as strips (their boards
    are the mesh)."""
    landmark_meshes_cache()
    H = hondo_layout()
    if not H:
        return []
    P, st = H["P"], H["stage"]
    fwd = H["fwd"]
    out = []
    # the stage: from inside the front gallery out to the railing, across the stage's width
    o = P(st["u0"] - 4.0, (st["v0"] + st["v1"]) / 2, 0)
    out.append({"name": "Kiyomizu-dera, the Stage 清水の舞台", "type": "strip", "origin": xy(o), "axis": [round(float(fwd[0]), 5), round(float(fwd[1]), 5)],
                "half_width": round((st["v1"] - st["v0"]) / 2 - 0.3, 2), "profile": [[0.0, st["z"]], [round(st["u1"] - st["u0"] + 4.0 - 0.3, 2), st["z"]]],
                "thickness": 1.0, "mesh": "kiyomizu_hinoki", "label": "the Stage"})
    # the front gallery along the hall, from the east side where the hillside meets the floor
    east = left_of(fwd)
    o = P(st["u0"] - 2.0, H["hv"] + 4.0, 0)
    out.append({"name": "Kiyomizu-dera, the Main Hall's gallery", "type": "strip", "origin": xy(o), "axis": [round(float(-east[0]), 5), round(float(-east[1]), 5)],
                "half_width": 1.8, "profile": [[0.0, H["zf"]], [round(2 * H["hv"] + 4.0, 2), H["zf"]]], "thickness": 1.0, "mesh": "kiyomizu_hinoki",
                "label": "the Main Hall"})
    gs = _cache.get("saimon_steps")
    if gs:   # up the West Gate's steps and across its platform
        P3 = gs["P"]
        o = P3(gs["u1"], 0, 0)
        ax = np.array(P3(0, 0, 0)[:2]) - np.array(P3(1, 0, 0)[:2])
        run = gs["u1"] - gs["u0"]
        out.append({"name": "Kiyomizu-dera, the West Gate's steps 西門", "type": "strip", "origin": xy(o), "axis": [round(float(ax[0]), 5), round(float(ax[1]), 5)],
                    "half_width": round(gs["width"] / 2, 2), "profile": [[0.0, round(gs["z_foot"], 2)], [round(run, 2), round(gs["z_top"], 2)],
                                                                         [round(run + 2 * gs["u0"], 2), round(gs["z_top"], 2)]],
                    "thickness": 1.0, "mesh": "kiyomizu_gate_step", "drape": True, "label": "the West Gate"})
    ok = _cache.get("okunoin")
    if ok:   # the veranda along its front, which the corridor crosses, and the stage out from it
        P2, (a, b) = ok["P"], ok["stage_u"]
        f = ok["fwd"]
        ax = [round(float(f[0]), 5), round(float(f[1]), 5)]
        out.append({"name": "Okunoin's veranda 奥の院", "type": "strip", "origin": xy(P2(a, 0, 0)), "axis": ax,
                    "half_width": round(ok["sv"], 2), "profile": [[0.0, round(ok["z"], 2)], [round(b - a, 2), round(ok["z"], 2)]],
                    "thickness": 1.0, "mesh": "kiyomizu_hinoki", "label": "the Okunoin"})
        sa, sb, v0, v1 = ok["stage"]
        out.append({"name": "Okunoin's stage 奥の院", "type": "strip", "origin": xy(P2(sa - 0.5, (v0 + v1) / 2, 0)), "axis": ax,
                    "half_width": round((v1 - v0) / 2 - 0.15, 2), "profile": [[0.0, round(ok["z"], 2)], [round(sb - sa + 0.3, 2), round(ok["z"], 2)]],
                    "thickness": 1.0, "mesh": "kiyomizu_hinoki", "label": "the Okunoin"})
    return out


def game_extras(scene):
    """Spots: the stage, the view from the Okunoin (the Conan pilgrims' photo), the Otowa Falls, the Yasaka
    Pagoda from Yasaka-dori."""
    landmark_meshes_cache()
    spots, chatter = [], []
    H = hondo_layout()
    if H:
        P, st = H["P"], H["stage"]
        p = P(st["u1"] - 1.5, (st["v0"] + st["v1"]) / 2, 0)
        spots.append({"id": "butai", "name": "The Stage of Kiyomizu 清水の舞台", "at": [*xy(p), st["z"]], "verb": "Look out",
                      "lines": ["About thirteen metres down to the treetops. 清水の舞台から飛び降りる: to jump off the stage of Kiyomizu, as Kyoto says of any bold decision.",
                                "The stage is about 200 square metres of hinoki boards. Underneath, keyaki pillars, tied by through-beams. Not a single nail.",
                                "In November the whole valley below turns red and gold. Kyoto Tower is the white one on the horizon to the west."],
                      "radius": 4.0, "pick": 1})
        chatter.append({"at": [*xy(P(st["u0"] + 2.0, st["v0"] + 2.0, 0)), st["z"]], "radius": 12, "side": True,
                        "lines": [["Student", "So this is the stage from Detective Conan!"], ["Friend", "The Conan film? Which one?"],
                                  ["Student", "Crossroad in the Ancient Capital. And in Crimson School Trip, Shinichi and Ran have their photo taken with the stage behind them."]]})
    ok = _cache.get("okunoin")
    if ok:
        P2, (sa, sb, v0, v1) = ok["P"], ok["stage"]
        p = P2((sa + sb) / 2, (v0 + v1) / 2, 0)
        spots.append({"id": "okunoin", "name": "Okunoin stage 奥の院", "at": [*xy(p), round(ok["z"], 2)], "verb": "Take the photo",
                      "lines": ["Here is the photo everyone takes: the whole Main Hall on its pillars, the stage hanging over the trees, and the city beyond.",
                                "Detective Conan fans come for this view: Kiyomizu is in Crossroad in the Ancient Capital (2003), and Shinichi and Ran pose with the stage behind them in Crimson School Trip (2018)."],
                      "radius": 3.5})
    o = _cache.get("otowa")
    if o:
        P3, z = o["P"], o["z"]
        spots.append({"id": "otowa", "name": "Otowa Falls 音羽の滝", "at": [*xy(P3(4.0, 0, 0)), round(z, 2)], "verb": "Drink",
                      "lines": ["Three streams: learning, love and a long life. Choose one; drinking from all three is greedy, people say.",
                                "清水寺, the Temple of Pure Water, is named for this spring."],
                      "radius": 3.5, "pick": 1})
    C, T, S = ctx()
    kx, ky = C.fwd.transform(*KOSHINDO)
    spots.append({"id": "koshindo", "name": "Yasaka Koshin-do 八坂庚申堂", "at": [round(kx, 2), round(ky - 3.0, 2), round(T(kx, ky - 3.0), 2)],
                  "verb": "Look at the kukurizaru",
                  "lines": ["Kukurizaru: cloth monkeys bound hand and foot, so a desire is held in check. Write your wish on one and give up one thing for it.",
                            "In Detective Conan's Crimson School Trip, Shinichi and Ran stand here, the charms in front and the Yasaka Pagoda behind."],
                  "radius": 3.5})
    sd = solid_of(YASAKA[0])
    if sd:
        cx, cy = ak.ring_centroid(sd["ring"])
        x, y = -300.0, 176.0
        spots.append({"id": "yasaka", "name": "Yasaka Pagoda from Yasaka-dori 八坂の塔", "at": [x, y, round(T(x, y), 2)], "verb": "Look up the street",
                      "lines": ["The view of Kyoto: the five storeys of the Yasaka Pagoda at the top of the stone street. 46 metres, rebuilt in 1440.",
                                "Come at dusk, when the shops light their lanterns and the pagoda goes dark against the sky."],
                      "radius": 5.0})
    return {"spots": spots, "chatter": chatter}


def landmark_meshes_cache():
    """The Okunoin's and the falls' frames are set while the meshes are built; build them once if the game
    asks first."""
    if "okunoin" not in _cache or "otowa" not in _cache:
        K = ak.Kit("tmp")
        kiyomizu(K, [])
