"""Jinbocho and Kanda, a map of Tokyo: what the generic pipeline cannot know from open data.

The model is the real district: Overture footprints at Project PLATEAU's surveyed heights on GSI's laser
bare earth. This file dresses and adds:

  * The book town (神保町古書店街): the second-hand bookshops along Yasukuni-dori's south side from the
    Jinbocho crossing to Surugadai-shita, and Suzuran-dori and Sakura-dori behind them, with their
    boards and blade signs (old books, foreign books, art books, film, maps, prints; typical trades, no
    real shop's sign) and the wooden carts of cheap books (均一本) on the pavement before the doors.
    The shops face north, away from the sun, to keep it off their books.
  * The names of Sanseido and Tokyo-do on their roofs' edges, their own words in open fonts.
  * カトリック神田教会 the Catholic Kanda Church (Max Hinder, 1928; a registered cultural property): a
    three-aisled basilica in a Romanesque and Renaissance manner, its front on Hakusan-dori with an
    arched portal and a rose window, its walls cream, its roofs of red tile. Placed on the long
    basilica's footprint of block 1-1, Nishi-Kanda (OpenStreetMap does not name it).
  * ニコライ堂 Nikolai-do over Ochanomizu, built by the same code as in the Akihabara map
    (cities/akihabara/city.py), which shares this corner of the city.

Persona 5 sends its players to Jinbocho for its books and to a church in Kanda; nothing of the game's
art is copied.
"""
import importlib.util
import math
import os

import numpy as np
from shapely.geometry import LineString, Point, Polygon

import districtkit as dk
import japankit as jk
from japankit import Atlas, Kit, block, frame, lathe_at, slab_at, unit, left_of

_AKIBA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "akihabara", "city.py")
_spec = importlib.util.spec_from_file_location("city_akihabara_for_jinbocho", _AKIBA)
akiba = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(akiba)

# the book town's streets: Yasukuni-dori's south side from the crossing to Surugadai-shita, and the lanes behind
BOOK_STREETS = [[(-60.0, -18.0), (120.0, -26.0), (330.0, -40.0)], [(-40.0, -92.0), (120.0, -95.0), (230.0, -98.0)]]
CHURCH_AT = (-55.0, 377.0)        # the basilica's footprint in block 1-1, Nishi-Kanda
SIGN_CLASSES = {"", "commercial", "retail", "restaurant", "office", "mixed_use", "hotel"}
ROOF_NAMES = {"三省堂書店ビル": "sanseido", "東京堂神保町第1ビルディング": "tokyodo"}
NIKOLAI = "ニコライ堂"

MATERIALS = {
    **akiba.MATERIALS,
    "atlas": {"color": "#ffffff", "roughness": 0.7, "metalness": 0.0, "map": "atlas.jpg", "emissive_map": True, "glow": 1.15},
    "books": {"color": "#ffffff", "roughness": 0.85, "metalness": 0.0, "map": "atlas.jpg"},
    "cart_wood": {"color": "#7a5636", "roughness": 0.8, "metalness": 0.0},
    "stucco": {"color": "#e8dcc4", "roughness": 0.9, "metalness": 0.0, "emissive": "#ffe6c0", "glow": 0.3},
    "stucco_dark": {"color": "#cdbd9f", "roughness": 0.9, "metalness": 0.0},
    "roof_tile_red": {"color": "#9a4a34", "roughness": 0.75, "metalness": 0.05},
    "church_front": {"color": "#ffffff", "roughness": 0.85, "metalness": 0.0, "map": "atlas.jpg", "emissive_map": True, "glow": 0.25},
}

BLADES = [("古書", "#2b1a12", "#f2d16b", "mincho"), ("古本", "#f2e6c8", "#7a2a12", "mincho"), ("洋書", "#0a2a6a", "#ffffff", "zen"),
          ("美術書", "#5a1a2a", "#f4e6c8", "mincho"), ("和本", "#f4f1ea", "#1a1a1a", "mincho"), ("絶版", "#1d1d1d", "#ffcf70", "mincho"),
          ("映画", "#d4001a", "#ffffff", "zen"), ("地図", "#00664a", "#ffffff", "zen"), ("浮世絵", "#f2e6c8", "#a8351a", "mincho"),
          ("買取", "#d4001a", "#ffe600", "dela"), ("カレー", "#ffb000", "#5a2d18", "mplus"), ("喫茶", "#3b2a1e", "#f4e6c8", "mincho"),
          ("漫画", "#ffd400", "#d4001a", "dela"), ("楽器", "#111111", "#ffffff", "zen"), ("スポーツ", "#0068b7", "#ffffff", "zen"),
          ("学術書", "#2b3a5a", "#ffffff", "mincho"), ("文庫", "#00915a", "#ffffff", "zen"), ("天ぷら", "#2b1a12", "#ffffff", "mincho")]
BOARDS = [("古書 買入 販売", "#2b1a12", "#f2d16b", "mincho"), ("洋書 FOREIGN BOOKS", "#0a2a6a", "#ffffff", "zen"), ("美術書 図録 写真集", "#5a1a2a", "#f4e6c8", "mincho"),
          ("映画 演劇 古書", "#1d1d1d", "#ffcf70", "zen"), ("絶版 文庫 新書", "#f2e6c8", "#7a2a12", "mincho"), ("欧風カレー", "#ffb000", "#5a2d18", "mplus"),
          ("喫茶 珈琲", "#3b2a1e", "#f4e6c8", "mincho"), ("古地図 浮世絵", "#f2e6c8", "#a8351a", "mincho"), ("漫画 古書", "#ffd400", "#d4001a", "dela"),
          ("BOOKS 古本", "#ffffff", "#2b1a12", "bebas")]
NAMES = {"sanseido": ("三省堂書店", "#ffffff", "#1d3f7a", "mincho"), "tokyodo": ("東京堂書店", "#f4f1ea", "#2b1a12", "mincho")}
SPINES = ["#7a2a12", "#1d3f7a", "#2f5a3a", "#d9c9a0", "#5a1a2a", "#c8a04a", "#2b2b2b", "#8a6a3a", "#f2e6c8", "#3d4a5c", "#a8351a", "#6a7a3a"]

ATLAS = Atlas([(f"blade{i}", 64, 320) for i in range(len(BLADES))] + [(f"board{i}", 384, 96) for i in range(len(BOARDS))]
              + [(f"name_{k}", 512, 96) for k in NAMES] + [("books", 256, 128), ("church_front", 256, 320), ("church_side", 128, 128)])


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
    if name == NIKOLAI:
        lm["nikolai"] = {"c": [round(c.x, 2), round(c.y, 2)], "ground_m": round(gz, 2), "r": round(math.sqrt(g.area / math.pi), 2)}
        b["facade_color"] = "#e2d8c4"
        return [[q[0], q[1], min(max(q[2], 14.0), 16.0), q[3], q[4]] for q in geoms]
    if g.contains(Point(*CHURCH_AT)) and 400 < g.area < 1200:
        lm["_church"] = {"ring": _ring(g), "ground_m": round(gz, 2), "top_m": round(top, 1)}
        for q in geoms:
            ctx.hide(q)
        return geoms
    if name in ROOF_NAMES and top > 8:
        lm.setdefault("_names", []).append({"key": ROOF_NAMES[name], "ring": _ring(g), "top_m": round(top, 1), "ground_m": round(gz, 2)})
    if (b["class"] or "") in SIGN_CLASSES and geoms and 20 < g.area < 2500 and 4 <= top <= 50:
        if any(LineString(s).distance(g) < 22 for s in BOOK_STREETS):
            ctx.signs.append((g, top))
    return geoms


def finalize(ctx):
    C, lm = ctx.city, ctx.landmarks
    sites = jk.sign_sites(C, ctx.signs, ctx.ground)
    # the carts of cheap books stand before the shops on Yasukuni-dori's south side, whose fronts face north
    carts = [s for s in jk.open_fronts(sites) if s[3] > 0.7 and s[6] > 5.0]
    lm["books"] = {"sites": sites, "carts": carts[::2]}
    lm["roof_names"] = dk.roof_name_sites(C, lm.pop("_names", []))
    ch = lm.pop("_church", None)
    if ch:
        g = Polygon(ch["ring"])
        hak = [r["geom"] for r in jk.overture(C, "segment", "subtype = 'road' AND class IN ('primary', 'secondary')") if r["geom"].geom_type == "LineString"]
        road = min(hak, key=lambda ln: ln.distance(g)) if hak else None
        cc, ax, half = jk.footprint_frame(g)
        if road is not None:   # the front looks onto the nearest main road (Hakusan-dori)
            p = road.interpolate(road.project(Point(*cc)))
            to = np.array([p.x, p.y]) - cc
            ax = ax if float(ax @ to) >= 0 else -ax
            if abs(float(unit(to) @ ax)) < 0.5:   # the road runs along the long side: front on the short end nearer the crossing
                ax = ax if float(ax @ (np.array([-20.0, -10.0]) - cc)) >= 0 else -ax
        lm["church"] = {"c": dk.rnd(cc), "axis": dk.rnd(ax, 4), "hu": round(min(half[0], 24.0), 2), "hv": round(min(half[1], 9.0), 2),
                        "z": ch["ground_m"], "top_m": ch["top_m"]}
        ctx.labels["Catholic Kanda Church カトリック神田教会"] = [round(cc[0], 1), round(cc[1], 1), round(ch["ground_m"] + 26, 1)]
    nk = lm.get("nikolai")
    if nk:
        ctx.labels["Nikolai-do ニコライ堂"] = [nk["c"][0], nk["c"][1], round(nk["ground_m"] + 40, 1)]
    ctx.labels["Jinbocho Book Town 神保町古書店街"] = [120.0, -30.0, round(ctx.ground(120.0, -30.0) + 30, 1)]


# ---------------------------------------------------------------- meshes

def book_carts(K, carts, rng):
    """The wooden carts of cheap books before the shop doors: two or three per front, a sloping shelf of
    spines on a box on castors, the books' colours from the atlas."""
    W, B = K("cart_wood"), K("books")
    for x, y, nx, ny, g, top, L in carts:
        n, t = np.array([nx, ny]), np.array([-ny, nx])
        k = 3 if L > 9 else 2
        for j in range(k):
            off = (j - (k - 1) / 2) * 1.7 + rng.normal(0, 0.15)
            c = np.array([x, y]) + n * 0.85 + t * off
            P = frame(c, n)
            block(W, P, -0.32, 0.32, -0.7, 0.7, g + 0.12, g + 0.82)
            for s in (-0.6, 0.6):
                for u in (-0.25, 0.25):
                    block(W, P, u - 0.04, u + 0.04, s - 0.04, s + 0.04, g, g + 0.12)
            # the shelf: books standing in two tiers, their spines facing the street
            for tier, (u0, z0) in enumerate(((0.32, g + 0.82), (0.02, g + 1.12))):
                a, b = P(u0 + 0.01, 0.68, z0), P(u0 + 0.01, -0.68, z0)
                ATLAS.quad(B, a, b, b + np.array([0, 0, 0.26]), a + np.array([0, 0, 0.26]), "books")
                block(W, P, u0 - 0.3, u0, -0.7, 0.7, z0 - 0.04, z0)
            block(W, P, -0.32, 0.04, -0.7, 0.7, g + 1.38, g + 1.42)


def church(K, c):
    """The basilica: a tall nave between lower aisles under red tile roofs, the round-arched windows of the
    clerestory and the aisles, an apse at the east end, and the front with its portal, rose window and
    gable cross; its axis u from the apse to the front."""
    P = frame(c["c"], c["axis"])
    hu, hv, z0 = c["hu"], c["hv"], c["z"]
    ridge = z0 + max(min(c["top_m"], 19.0), 15.0)
    nave_w = hv * 0.55
    eave_a, eave_n = z0 + 6.5, ridge - 3.6
    block(K("stone"), P, -hu, hu, -hv, hv, z0 - 0.3, z0 + 0.5)
    block(K("stucco"), P, -hu + 0.5, hu - 0.4, -hv, hv, z0 + 0.5, eave_a)           # the aisles
    block(K("stucco"), P, -hu + 0.5, hu - 0.4, -nave_w, nave_w, eave_a, eave_n)     # the nave's clerestory
    for s in (-1, 1):   # the aisles' lean-to roofs
        a = [P(-hu + 0.2, s * (hv + 0.4), eave_a - 0.3), P(hu - 0.2, s * (hv + 0.4), eave_a - 0.3),
             P(hu - 0.2, s * nave_w, eave_a + 1.2), P(-hu + 0.2, s * nave_w, eave_a + 1.2)]
        (K("roof_tile_red").quad if s < 0 else K("roof_tile_red").quad)(*(a if s > 0 else a[::-1]))
    for s in (-1, 1):   # the nave's pitched roof
        a = [P(-hu + 0.2, s * (nave_w + 0.5), eave_n - 0.2), P(hu + 0.1, s * (nave_w + 0.5), eave_n - 0.2), P(hu + 0.1, 0, ridge), P(-hu + 0.2, 0, ridge)]
        K("roof_tile_red").quad(*(a if s > 0 else a[::-1]))
    # the front's gable wall, flush with the front, and the side walls' windows (the atlas's arched window)
    fa, fb = P(hu - 0.38, -nave_w, eave_n), P(hu - 0.38, nave_w, eave_n)
    K("stucco").tri(fa, fb, P(hu - 0.38, 0, ridge))
    A = K("church_front")
    ATLAS.quad(A, P(hu + 0.03, -hv, z0 + 0.5), P(hu + 0.03, hv, z0 + 0.5), P(hu + 0.03, hv, eave_n), P(hu + 0.03, -hv, eave_n), "church_front")
    nwin = max(3, int((2 * hu - 4) / 4.2))
    for k in range(nwin):
        u = -hu + 2.8 + k * (2 * hu - 5.0) / max(nwin - 1, 1)
        for s in (-1, 1):
            for (v, z1, z2) in ((s * (hv + 0.03), z0 + 2.0, eave_a - 1.0), (s * (nave_w + 0.03), eave_a + 1.6, eave_n - 0.6)):
                a, b = P(u - 0.8 * s, v, z1), P(u + 0.8 * s, v, z1)
                ATLAS.quad(K("church_front"), a, b, b + np.array([0, 0, z2 - z1]), a + np.array([0, 0, z2 - z1]), "church_side")
    # the apse: a half drum at the east end
    x, y, _ = P(-hu + 0.5, 0, 0)
    ax = np.asarray(c["axis"])
    for k in range(8):
        t0, t1 = math.pi / 2 + k * math.pi / 8, math.pi / 2 + (k + 1) * math.pi / 8
        d0 = np.array([math.cos(t0), math.sin(t0)])
        d1 = np.array([math.cos(t1), math.sin(t1)])
        rot = lambda d: ax * d[0] + left_of(ax) * d[1]
        r = nave_w
        p0, p1 = np.array([x, y]) + rot(d0) * r, np.array([x, y]) + rot(d1) * r
        K("stucco").quad(np.array([*p1, z0 + 0.5]), np.array([*p0, z0 + 0.5]), np.array([*p0, eave_n - 1.5]), np.array([*p1, eave_n - 1.5]))
        K("roof_tile_red").tri(np.array([x, y, eave_n + 0.6]), np.array([*(np.array([x, y]) + rot(d1) * (r + 0.4)), eave_n - 1.7]),
                               np.array([*(np.array([x, y]) + rot(d0) * (r + 0.4)), eave_n - 1.7]))
    # the cross over the gable
    tip = P(hu - 0.3, 0, ridge)
    K("gold").box(tip, tip + np.array([0, 0, 2.2]), 0.14, 0.14)
    l = left_of(ax)
    K("gold").box(tip + np.array([*(l * -0.55), 1.55]), tip + np.array([*(l * 0.55), 1.55]), 0.12, 0.12)


def landmark_meshes(scene):
    lm = scene["landmarks"]
    K = Kit("jinbo", MATERIALS, floodlit=("stucco", "plaster"))
    rng = np.random.default_rng(1913)
    if lm.get("books"):
        jk.street_signs(K, ATLAS, lm["books"]["sites"], ([f"board{i}" for i in range(len(BOARDS))], [f"blade{i}" for i in range(len(BLADES))]), rng, max_h=6.0)
        book_carts(K, lm["books"].get("carts", []), rng)
    dk.roof_names(K, ATLAS, lm.get("roof_names", []), max_w=18.0)
    if "church" in lm:
        church(K, lm["church"])
    if "nikolai" in lm:
        akiba.nikolai(K, lm["nikolai"])
    return MATERIALS, K.meshes()


def landmark_assets(out_dir, scene):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (ATLAS.W, ATLAS.H), (30, 30, 34))
    d = ImageDraw.Draw(img)
    dk.draw_signs(d, ATLAS, BLADES, BOARDS)
    dk.draw_names(d, ATLAS, NAMES)
    rng = np.random.default_rng(3)
    x, y, w, h = ATLAS.rects["books"]   # spines, close together, of every height
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(60, 44, 30))
    px = x
    while px < x + w:
        bw = int(rng.integers(5, 13))
        top = y + int(rng.integers(0, h // 3))
        col = SPINES[int(rng.integers(len(SPINES)))]
        d.rectangle([px, top, px + bw - 1, y + h], fill=col)
        d.line([(px + 1, top + (y + h - top) * 0.2), (px + bw - 2, top + (y + h - top) * 0.2)], fill=(222, 196, 120), width=1)
        px += bw
    x, y, w, h = ATLAS.rects["church_front"]   # the front: pilasters, the arched portal, the rose window over it
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(232, 220, 196))
    for px in (x + 8, x + w * 0.3, x + w * 0.7 - 10, x + w - 18):
        d.rectangle([px, y + 10, px + 10, y + h], fill=(214, 200, 172))
    d.rectangle([x, y + 4, x + w, y + 14], fill=(214, 200, 172))
    cx = x + w / 2
    d.rectangle([cx - 26, y + h - 96, cx + 26, y + h], fill=(70, 50, 38))
    d.ellipse([cx - 26, y + h - 122, cx + 26, y + h - 70], fill=(70, 50, 38))
    d.arc([cx - 34, y + h - 130, cx + 34, y + h - 62], 180, 360, fill=(196, 180, 150), width=6)
    d.ellipse([cx - 40, y + 70, cx + 40, y + 150], fill=(60, 70, 96), outline=(196, 180, 150), width=8)
    for k in range(12):
        a = k * math.tau / 12
        d.line([(cx, y + 110), (cx + 36 * math.cos(a), y + 110 + 36 * math.sin(a))], fill=(196, 180, 150), width=3)
    for sx in (x + w * 0.16, x + w * 0.84):   # the side bays' windows
        d.rectangle([sx - 12, y + h - 150, sx + 12, y + h - 70], fill=(60, 70, 96))
        d.ellipse([sx - 12, y + h - 162, sx + 12, y + h - 138], fill=(60, 70, 96))
    x, y, w, h = ATLAS.rects["church_side"]
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(232, 220, 196))
    d.rectangle([x + w * 0.3, y + h * 0.3, x + w * 0.7, y + h], fill=(60, 70, 96))
    d.ellipse([x + w * 0.3, y + h * 0.3 - w * 0.2, x + w * 0.7, y + h * 0.3 + w * 0.2], fill=(60, 70, 96))
    img.save(f"{out_dir}/atlas.jpg", quality=90)
    return ["atlas.jpg"]


def landmark_glows(scene):
    lm = scene["landmarks"]
    out = dk.sign_glows((lm.get("books") or {}).get("sites", []), every=4, colours=("#ffd9a0", "#fff1d0"), strength=0.22)
    if "church" in lm:
        out.append([*lm["church"]["c"], 18.0, "#ffe2b0", 0.25])
    return out


def woods_clear(scene):
    lm = scene.get("landmarks", {})
    return [[*lm["church"]["c"], 26.0]] if "church" in lm else []


def game_extras(scene):
    lm = scene["landmarks"]
    spots, chatter, close = [], [], []
    ch = lm.get("church")
    if ch:
        ax = np.asarray(ch["axis"])
        at = np.asarray(ch["c"]) + ax * (ch["hu"] + 7.0)
        spots.append(dk.spot("church", "Catholic Kanda Church カトリック神田教会", at, ch["z"], "Look at the church",
                             ["The Catholic Kanda Church, 1928: a Swiss architect drew it, round arches and a rose window, after the earthquake took the first one.",
                              "It came through the war's fires too. On Sunday mornings you can hear the organ from the street."], 6.0))
        close.append(dk.close_to("Kanda Church, the portal", np.asarray(ch["c"]) + ax * (ch["hu"] + 0.6), ch["z"] + 0.5, at, 1.5))
    b = lm.get("books") or {}
    if b.get("carts"):
        x, y, nx, ny, g, top, L = b["carts"][len(b["carts"]) // 2]
        at = np.array([x, y]) + np.array([nx, ny]) * 3.0
        spots.append(dk.spot("carts", "The hundred-yen carts 均一本", at, g, "Browse the carts",
                             ["Every shop puts its cheap books out front: a hundred yen, three hundred, five hundred. The good finds are always at the bottom.",
                              "The shops face north, all of them. The sun never touches the books in the windows."], 4.0))
        chatter.append({"at": [x + nx * 4, y + ny * 4, g], "radius": 12, "side": True,
                        "lines": [["Collector", "Is this the first edition?"], ["Shopkeeper", "Second printing. The first is upstairs, behind glass."], ["Collector", "How much behind glass?"]]})
    nk = lm.get("nikolai")
    if nk:
        spots.append(dk.spot("nikolai", "Nikolai-do ニコライ堂", [nk["c"][0] - nk["r"] - 6, nk["c"][1]], nk["ground_m"], "Listen for the bells",
                             ["Nikolai-do, 1891: the Russian Orthodox cathedral of Tokyo, its green dome rebuilt after the 1923 earthquake.",
                              "From the hill here the students of Ochanomizu have looked at it for a hundred years."], 6.0))
    return {"spots": spots, "chatter": chatter, "close": close}
