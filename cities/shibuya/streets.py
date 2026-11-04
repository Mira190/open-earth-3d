"""The streets off Shibuya's scramble, their first 150 m (#118): Center Gai, Dogenzaka, Bunkamura-dori,
Jingu-dori up to MODI and Inokashira-dori between the two Seibu buildings.

The generic city gives these streets their buildings' masses and windows; what makes them read as
Shibuya from the pavement is what hangs on the fronts (photographs 2023-25, docs/cities/shibuya.md 6c):

  * at the foot of every front a shop window lit from inside and a lit fascia over it;
  * the tenants' vertical signs (縦看板), one panel a floor, standing out from the wall at one end of
    the front and read up and down the street, and on some fronts bands of tenants' signs floor over floor;
  * the named fronts: the camera and electronics store on Dogenzaka, the drugstore and the shoe store
    on Center Gai, MODI on Jingu-dori with its record and book store, and SHIBUYA109's Bunkamura-dori face;
  * Seibu's A and B buildings, closed on 30 September 2026: cream precast panels with small punched
    windows, dark after closing, the closing notice at their doors, and the bridge over Inokashira-dori;
  * on the Taiseido block, the small vertical signs of the pharmacy and the monja restaurant.

Shops' names and adverts are invented in the kind the real ones are (as everywhere in this model, no
real brand or logo is drawn); the buildings' own names (MODI, SHIBUYA109) are set in open fonts. Built
by cities/shibuya/scramble.py into its kit and atlas (scramble.jpg), in the city's local frame (x east,
y north, z up, metres).
"""
import zlib

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

import adkit as ad

# the streets' centrelines from where they leave the scramble, about 150 m each (OSM's ways, local frame;
# Inokashira-dori, not in the extract by name, runs between the two Seibu buildings' faces)
STREETS = {
    "center_gai": [(348, -987), (345, -978), (341, -973), (323, -955), (305, -938), (298, -935), (271, -930), (255, -926), (247, -923), (232, -916)],
    "dogenzaka": [(337, -996), (331, -995), (298, -992), (279, -994), (266, -999), (248, -1006), (236, -1010), (200, -1022)],
    "bunkamura": [(263, -993), (254, -984), (233, -974), (188, -954), (165, -943), (140, -931)],
    "jingu": [(376, -973), (384, -941), (391, -908), (391, -895), (392, -877), (392, -835), (392, -800), (392, -760)],
    "inokashira": [(391, -891), (352, -888), (321, -881), (300, -874), (280, -866)],
}
# fronts drawn as themselves below (or by scramble.py / city.py), not dressed by the generic rule
OWN = {"w136691386", "w116806281", "w60739635", "w136690966", "w55895868", "w55896465", "w136692137", "w136692134",
       "w116710254", "w136690945", "w136690970", "w904652357"}

MATERIALS = {
    # the side streets' shop windows: dark glass between mullions, most lit after dark, warm, softer than QFRONT's
    "st_shop": {"color": "#3c454e", "roughness": 0.1, "metalness": 0.3, "pattern": "curtain_wall", "bay_m": 1.6, "storey_m": 3.4, "spandrel": 0.08,
                "mullion_m": 0.1, "frame": "#2a2d31", "lit_share": 0.6, "lit_k": 0.22, "warm_share": 0.75},
    # Seibu's cream precast panels; the windows small and set deep, dark since the store closed
    "st_seibu": {"color": "#2a3036", "roughness": 0.2, "metalness": 0.2, "pattern": "curtain_wall", "bay_m": 2.7, "storey_m": 4.5, "spandrel": 0.58,
                 "mullion_m": 1.55, "frame": "#ddd3bd", "lit_share": 0.04, "lit_k": 0.4, "warm_share": 0.2},
    "st_cream": {"color": "#d9cfb9", "roughness": 0.75, "metalness": 0.0, "pattern": "granite", "joints_m": [2.7, 1.5]},
    # a closed store's ground floor: dark glass, no light behind it
    "st_closed": {"color": "#1e2328", "roughness": 0.08, "metalness": 0.3, "pattern": "curtain_wall", "bay_m": 3.0, "storey_m": 4.4, "spandrel": 0.0,
                  "mullion_m": 0.12, "frame": "#3a3f45", "lit_share": 0.0, "lit_k": 0.0},
    "st_bridge": {"color": "#5d7480", "roughness": 0.06, "metalness": 0.3, "pattern": "curtain_wall", "bay_m": 1.5, "storey_m": 4.0, "spandrel": 0.18,
                  "mullion_m": 0.1, "frame": "#c9c2b0", "lit_share": 0.0, "lit_k": 0.0},
}

# fascias over the shop windows: (background, name, face, colour) -- typical trades, invented names
FASCIAS = [("#e60012", "カラオケ 歌広場", "zen", "#ffffff"), ("#ffd400", "100円ショップ ハッピー", "zen", "#d4001a"), ("#1a1a1a", "古着 VINTAGE KOGA", "anton", "#ffcf3a"),
           ("#ffffff", "らーめん 一鶴", "zen", "#c8000a"), ("#004ea2", "MOBILE SHOP ソラ", "zen", "#ffffff"), ("#f39800", "牛めし 松葉屋", "zen", "#3a1a00"),
           ("#2b4d34", "CAFE & BAKERY MORI", "bebas", "#fff8e6"), ("#ffffff", "めがね工房 ミエル", "zen", "#1a3c8a"), ("#d4001a", "焼肉 ホルモン 丸八", "zen", "#ffe36e"),
           ("#14142a", "GAME ARENA G-ZONE", "anton", "#2ad0ff"), ("#f2f2f2", "SNEAKER LAB", "anton", "#e60012"), ("#ffe600", "激安 チケット ノア", "zen", "#111111"),
           ("#3a2a20", "COFFEE STAND 渋", "zen", "#f4e2c8"), ("#e83f8a", "COSME & BEAUTY Lily", "bebas", "#ffffff"), ("#0a6ebd", "英会話 SPEAKS", "zen", "#ffffff"),
           ("#ffffff", "回転寿司 魚がし", "zen", "#111111"), ("#6b0d0d", "居酒屋 酔い処 さくら", "zen", "#ffe9c2"), ("#00a29a", "ドラッグ ハーブ堂", "zen", "#ffffff"),
           ("#1d1d1d", "UNDERGROUND RECORDS", "bebas", "#ff5fd2"), ("#ffffff", "たい焼き 浪花堂", "zen", "#b8000a")]
# the tenants of a vertical sign, a panel a floor (as city.py TENANTS: trades, not shops)
TENANT_PANELS = [("カラオケ", "#e60012", "#ffffff"), ("居酒屋", "#1a1a1a", "#ffcf3a"), ("焼肉", "#b80d0d", "#ffffff"), ("ネイル", "#ffd6e6", "#c2185b"),
                 ("歯科", "#ffffff", "#2a7ab8"), ("BAR", "#14142a", "#ff5fd2"), ("まんが喫茶", "#ffffff", "#e60012"), ("占い", "#3a1a5a", "#ffd76a"),
                 ("ラーメン", "#ffe600", "#c8000a"), ("美容室", "#f2f2f2", "#4a4a4a"), ("英会話", "#0a6ebd", "#ffffff"), ("ダーツ", "#101010", "#2ad0ff"),
                 ("中華", "#d4001a", "#ffd400"), ("脱毛", "#ffffff", "#d0458a"), ("麻雀", "#0c5b2e", "#ffffff"), ("整体", "#ffffff", "#0b7a4b"),
                 ("質", "#ffffff", "#c8000a"), ("ホルモン", "#ffd400", "#111111"), ("ジム", "#111111", "#ffe600"), ("寿司", "#ffffff", "#111111")]
STACKS = 14
STACK_K = [2 + i % 6 for i in range(STACKS)]   # panels in each sign, a floor (3.2 m) each
STACK_PX = (40, 128)                           # a panel's cell: 1.0 x 3.2 m
BANDS = [("#e60012", "カラオケ ルーム 3F・4F", "#ffffff"), ("#ffffff", "渋谷 デンタルクリニック", "#2a7ab8"), ("#1a1a1a", "BAR & DINING 7F", "#ff9ad5"),
         ("#ffd400", "金券 チケット 2F", "#c8000a"), ("#0a6ebd", "英会話 スクール 5F", "#ffffff"), ("#ffffff", "メンズ脱毛 6F", "#d0458a"),
         ("#2b4d34", "古着 USED 2F", "#fff8e6"), ("#f39800", "焼肉 食べ放題 8F", "#3a1a00")]

# the named fronts: the building, the street its front looks onto, and what is on it. The real stores'
# trades and colours are kept, their names are invented (docs/cities/shibuya.md 6c)
NAMED = [
    # Dogenzaka: the camera and electronics store at the station end (its floors' banners in red and blue on white)
    {"osm": "w116710254", "toward": (285.0, -993.0), "fascia": ("#ffffff", "カメラのサクラ", "dela", "#d4001a"), "fascia_h": 1.6,
     "banners": [("#d4001a", "カメラ・パソコン", "#ffffff"), ("#003da5", "家電・ゲーム", "#ffffff"), ("#ffffff", "ポイント10%", "#d4001a")], "sub": ("#003da5", "SAKURA CAMERA  免税 TAX FREE", "#ffffff")},
    # Center Gai: the drugstore (yellow, its name in dark blue, the big 薬)
    {"osm": "w136690945", "toward": (262.0, -929.0), "fascia": ("#ffe100", "薬 ドラッグ あおば", "dela", "#0b2a6f"), "fascia_h": 1.3,
     "banners": [("#ffe100", "薬", "#0b2a6f"), ("#0b2a6f", "化粧品", "#ffe100")], "sub": ("#0b2a6f", "COSMETICS  DRUGS  免税", "#ffe100")},
    # Center Gai: the shoe store (white on red, a navy band)
    {"osm": "w136690970", "toward": (250.0, -924.0), "fascia": ("#d7001d", "STEP MARKET", "anton", "#ffffff"), "fascia_h": 1.3,
     "banners": [("#d7001d", "SHOES", "#ffffff"), ("#0d2a5c", "スニーカー", "#ffffff")], "sub": ("#0d2a5c", "SNEAKERS  KIDS  SPORTS", "#ffffff")},
    # Jingu-dori: MODI (the building's name), and its record and book store's fascia over the door
    {"osm": "w136692134", "toward": (395.0, -780.0), "fascia": ("#111111", "DISC & BOOKS", "anton", "#ff3040"), "fascia_h": 1.2,
     "banners": [("#ffffff", "MODI", "#111111")], "name_blade": True, "sub": ("#ff3040", "RECORDS  BOOKS  CAFE  4F-7F", "#ffffff")},
]
# SHIBUYA109's face on Bunkamura-dori: its name up a blade at the corner and a printed advert (the front's, scramble.py)
S109_SIDE = {"a": (226.5, -981.8), "b": (193.8, -967.0), "print": (9.0, 13.5, 12.0), "out": 0.35}
# Seibu A and B: their buildings, the bridge between them over Inokashira-dori, the notice at the doors
SEIBU = {"a": "w55896465", "b": "w136692137", "panels_from_m": 4.6,
         "bridge": {"x": (358.5, 363.5), "a_face": ((374.8, -902.0), (352.8, -897.9)), "b_face": ((333.7, -876.9), (374.7, -884.9)), "z": (9.0, 13.0)},
         "notice": "西武渋谷店 A館・B館は 2026年9月30日をもちまして閉店いたしました  長年のご愛顧 誠にありがとうございました"}
# the Taiseido block's small vertical signs on its Dogenzaka face, west of the bookshop's return: the
# pharmacy's red on white and the monja restaurant's (invented names; positions from photographs)
TAISEIDO = {"face": ((323.6, -975.2), (295.4, -978.2)), "toward": (310.0, -995.0),
            "blades": [(4.5, 0.75, 3.2, 7.4, ("#ffffff", "八千代薬品", "#d0101a")), (9.5, 0.7, 3.0, 6.4, ("#2a1a12", "もんじゃ 月島", "#ffd27a"))]}


def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) or 1.0)


def left_of(f):
    return np.array([-f[1], f[0]])


def seed(s):
    return zlib.crc32(s.encode())


def atlas_items():
    items = [(f"st_fascia{i}", 384, 48) for i in range(len(FASCIAS))]
    items += [(f"st_stack{i}", STACK_PX[0], STACK_PX[1] * STACK_K[i]) for i in range(STACKS)]
    items += [(f"st_band{i}", 384, 44) for i in range(len(BANDS))]
    for k, n in enumerate(NAMED):
        items += [(f"st_named{k}", 640, 80), (f"st_sub{k}", 640, 40)]
        items += [(f"st_banner{k}_{j}", 96, 512) for j in range(len(n["banners"]))]
    items += [("st_109name", 80, 532), ("st_notice", 1024, 96), ("st_modi", 56, 560)]
    items += [(f"st_tai{j}", 64, 320) for j in range(len(TAISEIDO["blades"]))]
    return items


# ---------------------------------------------------------------- geometry

def outlines(D):
    """Each building's outline (its solids' union) with the solids behind it: {osm: (polygon, [solids])}."""
    by = {}
    for s in D.solids:
        if s["osm"]:
            by.setdefault(s["osm"], []).append(s)
    out = {}
    for osm, ss in by.items():
        g = unary_union([Polygon(s["ring"]).buffer(0) for s in ss])
        if g.geom_type == "MultiPolygon":
            g = max(g.geoms, key=lambda p: p.area)
        out[osm] = (g, ss)
    return out


def height_at(ss, p):
    """The top (absolute) of the tallest solid at or just inside point p, and the ground there."""
    best = None
    for s in ss:
        if Polygon(s["ring"]).buffer(0.4).contains(Point(p)):
            z = s["ground"] + s["top"]
            if best is None or z > best[0]:
                best = (z, s["ground"])
    return best


def street_faces(D):
    """The fronts onto the streets: (osm, a, b, outward normal, ground, top), one per long enough edge."""
    lines = {k: LineString(v) for k, v in STREETS.items()}
    out = []
    for osm, (g, ss) in outlines(D).items():
        if osm in OWN or g.distance(unary_union(list(lines.values()))) > 18:
            continue
        cs = np.asarray(g.exterior.coords)
        ccw = g.exterior.is_ccw
        for a, b in zip(cs[:-1], cs[1:]):
            L = float(np.linalg.norm(b - a))
            if L < 4.5:
                continue
            f = (b - a) / L
            n = np.array([f[1], -f[0]]) if ccw else np.array([-f[1], f[0]])
            mid = (a + b) / 2
            for line in lines.values():
                if line.distance(Point(mid)) > 15:
                    continue
                q = np.asarray(line.interpolate(line.project(Point(mid))).coords[0])
                if n @ unit(q - mid) < 0.75:
                    continue
                h = height_at(ss, mid - n * 1.0)
                if h and h[0] - h[1] > 8:
                    out.append((osm, a, b, n, h[1], h[0]))
                break
    return out


def quad_on(A, m, mid, t, n, w, z0, z1, off, key):
    """An atlas cell on a face: centred at mid, `off` out along n, width w along t (left to right seen from in front)."""
    c = mid + n * off
    a, b = c - t * w / 2, c + t * w / 2
    A.quad(m, np.array([*a, z0]), np.array([*b, z0]), np.array([*b, z1]), np.array([*a, z1]), key)


def lit_box(K, A, mid, t, n, w, z0, z1, depth, key, frame="x_jr_steel"):
    """A box sign on a wall, lit from inside, its face out along n."""
    c0, c1 = mid + n * 0.02, mid + n * depth
    pts = [c0 - t * w / 2, c0 + t * w / 2, c1 + t * w / 2, c1 - t * w / 2]
    m = K[frame]
    for p, q in zip(pts, pts[1:] + pts[:1]):
        m.quad(np.array([*p, z0]), np.array([*q, z0]), np.array([*q, z1]), np.array([*p, z1]))
    m.quad(*[np.array([*p, z1]) for p in pts[::-1]])
    m.quad(*[np.array([*p, z0]) for p in pts])
    quad_on(A, K["x_atlas"], mid, t, n, w, z0, z1, depth + 0.02, key)


def blade(K, A, root, n, out, w, z0, z1, key, thick=0.22):
    """A vertical sign standing out from the wall at `root` along n, both its faces read along the street."""
    t = left_of(n)
    c = root + n * (out + w / 2)
    P = [c - n * w / 2 - t * thick / 2, c + n * w / 2 - t * thick / 2, c + n * w / 2 + t * thick / 2, c - n * w / 2 + t * thick / 2]
    m = K["x_jr_steel"]
    m.quad(*[np.array([*p, z1]) for p in P[::-1]])
    m.quad(*[np.array([*p, z0]) for p in P])
    m.quad(np.array([*P[1], z0]), np.array([*P[2], z0]), np.array([*P[2], z1]), np.array([*P[1], z1]))
    # the faces: seen from +t, the outer end is on the left; seen from -t, on the right
    o, i = c + n * w / 2, c - n * w / 2
    for side in (1, -1):
        e = t * (thick / 2 + 0.01) * side
        a, b = (o + e, i + e) if side > 0 else (i + e, o + e)
        A.quad(K["x_atlas"], np.array([*a, z0]), np.array([*b, z0]), np.array([*b, z1]), np.array([*a, z1]), key)
    for zz in (z0 + 0.4, z1 - 0.4):   # the brackets back to the wall
        K["x_wire"].tube([np.array([*(root + n * 0.05), zz]), np.array([*(c - n * w / 2), zz])], 0.04, 4)


def facing(a, b, n):
    """The ends of a wall in the order whose quad (a, b, b up, a up) faces out along n."""
    f = np.asarray(b, float) - np.asarray(a, float)
    return (a, b) if np.array([f[1], -f[0]]) @ n > 0 else (b, a)


def shopfront(K, a, b, n, g, z1=3.25):
    a, b = facing(a, b, n)
    L = float(np.linalg.norm(b - a))
    if L < 2.5:
        return
    f = (b - a) / L
    p, q = a + f * 0.3 + n * 0.07, b - f * 0.3 + n * 0.07
    K["st_shop"].quad(np.array([*p, g + 0.05]), np.array([*q, g + 0.05]), np.array([*q, g + z1]), np.array([*p, g + z1]),
                     [[0, 0], [L - 0.6, 0], [L - 0.6, z1], [0, z1]])


# ---------------------------------------------------------------- the fronts

def dress(K, A, D):
    """Every front onto the five streets, by the generic rule: window, fascia, a vertical sign, bands."""
    faces = street_faces(D)
    for osm, a, b, n, g, top in faces:
        rng = np.random.default_rng(seed(osm + f"{a[0]:.0f}{a[1]:.0f}"))
        L = float(np.linalg.norm(b - a))
        t = left_of(n)                          # to the right seen from in front
        mid = (a + b) / 2
        shopfront(K, a, b, n, g)
        w = min(L - 1.2, 11.0)
        if w > 2.5:
            lit_box(K, A, mid, t, n, w, g + 3.35, g + 3.35 + min(1.0, 0.12 * w + 0.4), 0.3, f"st_fascia{int(rng.integers(len(FASCIAS)))}")
        floors = int((top - g - 4.4) // 3.2)
        if floors >= 2 and rng.random() < 0.8:  # the tenants' vertical sign, at the front's end nearer the scramble or the far one
            end = a if rng.random() < 0.5 else b
            root = end + (b - a) / L * (0.7 if end is a else -0.7)
            kk = min(floors, 7)
            pick = [i for i in range(STACKS) if STACK_K[i] == kk]
            blade(K, A, root, n, 0.25, 1.0, g + 4.4, g + 4.4 + kk * 3.2, f"st_stack{pick[int(rng.integers(len(pick)))]}")
        if floors >= 3 and L >= 7 and rng.random() < 0.45:   # bands of tenants' signs on the floors above
            k0 = int(rng.integers(len(BANDS)))
            for j in range(min(floors - 1, 4)):
                z = g + 5.0 + j * 3.2
                lit_box(K, A, mid + t * (L * 0.08), t, n, L * 0.62, z, z + 0.85, 0.25, f"st_band{(k0 + j) % len(BANDS)}")
    return len(faces)


def named(K, A, D):
    import screens as sc_
    for k, s in enumerate(NAMED):
        mid, n, L, z0, z1 = sc_.facade("shibuya", s["osm"], s["toward"])
        t = left_of(n)
        g = D.ground(*mid)
        a, b = mid - t * L / 2, mid + t * L / 2
        shopfront(K, a, b, n, g, 3.6)
        w = min(L - 1.0, 20.0)
        fh = s["fascia_h"]
        lit_box(K, A, mid, t, n, w, g + 3.75, g + 3.75 + fh, 0.45, f"st_named{k}")
        lit_box(K, A, mid, t, n, w, g + 3.75 + fh + 0.1, g + 3.75 + fh + 0.6, 0.35, f"st_sub{k}")
        # the store's banners up the floors over its front, side by side
        nb = len(s["banners"])
        bw = min(2.6, (w - 2.0) / nb - 0.6)
        top = min(z1 - 1.5, g + 4.4 + fh + 16.0)
        for j in range(nb):
            v = (j - (nb - 1) / 2) * (bw + 1.2)
            if s.get("name_blade") and j == 0:
                end = mid - t * (L / 2 - 0.9)   # MODI's name up a blade at the corner
                blade(K, A, end, n, 0.3, 1.5, g + 6.0, g + 21.0, "st_modi", thick=0.3)
                continue
            lit_box(K, A, mid + t * v, t, n, bw, g + 5.0 + fh, top, 0.3, f"st_banner{k}_{j}")


def s109_side(K, A, D):
    S = S109_SIDE
    a, b = np.asarray(S["a"], float), np.asarray(S["b"], float)
    f = unit(b - a)
    n = left_of(f)
    if n @ (np.array([230.0, -960.0]) - (a + b) / 2) < 0:   # out toward Bunkamura-dori
        n = -n
    t = left_of(n)
    g = D.ground(*((a + b) / 2))
    shopfront(K, a, b, n, g, 3.8)
    w, h, z = S["print"]
    mid = a + f * 13.0
    K["x_jr_steel"].quad(*[np.array([*(mid + n * 0.2 + t * u), g + zz]) for u, zz in ((-w / 2 - 0.2, z - 0.2), (w / 2 + 0.2, z - 0.2), (w / 2 + 0.2, z + h + 0.2), (-w / 2 - 0.2, z + h + 0.2))])
    quad_on(A, K["x_print"], mid, t, n, w, g + z, g + z + h, 0.26, "s109_wrap")
    blade(K, A, a + f * 2.5, n, 0.3, 1.4, g + 6.0, g + 6.0 + 1.4 * 532 / 80, "st_109name", thick=0.3)


def seibu(K, A, D):
    """Seibu A and B: cream precast panels with small windows over the floors, the closed ground floor."""
    S = SEIBU
    ol = outlines(D)
    z_from = S["panels_from_m"]
    for osm in (S["a"], S["b"]):
        g_all, ss = ol[osm]
        for s in ss:
            ring = np.asarray(s["ring"], float)
            ccw = 0.5 * float(np.sum(ring[:, 0] * np.roll(ring[:, 1], -1) - np.roll(ring[:, 0], -1) * ring[:, 1])) > 0
            z_top = s["ground"] + s["top"]
            for a, b in zip(ring, np.roll(ring, -1, axis=0)):
                L = float(np.linalg.norm(b - a))
                if L < 1.5:
                    continue
                f = (b - a) / L
                n = np.array([f[1], -f[0]]) if ccw else np.array([-f[1], f[0]])
                mid = (a + b) / 2
                probe = mid + n * 0.6
                cover = max([q["ground"] + q["top"] for q in ss if q is not s and Polygon(q["ring"]).buffer(0).contains(Point(probe))], default=None)
                z0 = s["ground"] + z_from if cover is None else max(cover, s["ground"] + z_from)
                z1 = z_top - 0.4
                p, q = facing(a + n * 0.14, b + n * 0.14, n)
                if z1 - z0 > 1.0:
                    K["st_seibu"].quad(np.array([*p, z0]), np.array([*q, z0]), np.array([*q, z1]), np.array([*p, z1]), [[0, z0 - s["ground"]], [L, z0 - s["ground"]], [L, z1 - s["ground"]], [0, z1 - s["ground"]]])
                    K["st_cream"].quad(np.array([*(p + n * 0.02), z1]), np.array([*(q + n * 0.02), z1]), np.array([*(q + n * 0.02), z_top + 0.6]), np.array([*(p + n * 0.02), z_top + 0.6]),
                                       [[0, 0], [L, 0], [L, 1.0], [0, 1.0]])
                if cover is None and L >= 3:
                    g = s["ground"]
                    K["st_closed"].quad(np.array([*p, g + 0.05]), np.array([*q, g + 0.05]), np.array([*q, g + z_from - 0.2]), np.array([*p, g + z_from - 0.2]),
                                        [[0, 0], [L, 0], [L, z_from], [0, z_from]])
                    K["st_cream"].quad(np.array([*(p + n * 0.05), g + z_from - 0.2]), np.array([*(q + n * 0.05), g + z_from - 0.2]),
                                       np.array([*(q + n * 0.05), g + z_from + 0.05]), np.array([*(p + n * 0.05), g + z_from + 0.05]))
    # the closing notice at the doors on Jingu-dori and Inokashira-dori: white boards
    import screens as sc_
    for osm, toward in ((S["a"], (395.0, -925.0)), (S["b"], (370.0, -892.0))):
        mid, n, L, z0, z1 = sc_.facade("shibuya", osm, toward)
        t = left_of(n)
        g = D.ground(*mid)
        lit_box(K, A, mid, t, n, 7.5, g + 1.2, g + 1.9, 0.25, "st_notice", frame="x_bk_box")
    # the bridge over Inokashira-dori, glass on a cream frame (its floor's height is an estimate)
    B = S["bridge"]
    def y_at(face, x):
        (x0, y0), (x1, y1) = face
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    g = D.ground(361.0, -890.0)
    z0, z1 = g + B["z"][0], g + B["z"][1]
    xa, xb = B["x"]
    ya, yb = y_at(B["a_face"], (xa + xb) / 2) + 0.2, y_at(B["b_face"], (xa + xb) / 2) - 0.2
    c = [np.array(v) for v in ((xa, ya), (xb, ya), (xb, yb), (xa, yb))]
    for p, q in ((c[0], c[3]), (c[2], c[1])):   # the long sides (west, east), facing out
        L = float(np.linalg.norm(q - p))
        K["st_bridge"].quad(np.array([*p, z0 + 0.6]), np.array([*q, z0 + 0.6]), np.array([*q, z1 - 0.5]), np.array([*p, z1 - 0.5]), [[0, 0.6], [L, 0.6], [L, 3.5], [0, 3.5]])
        K["st_cream"].quad(np.array([*p, z0]), np.array([*q, z0]), np.array([*q, z0 + 0.6]), np.array([*p, z0 + 0.6]))
        K["st_cream"].quad(np.array([*p, z1 - 0.5]), np.array([*q, z1 - 0.5]), np.array([*q, z1]), np.array([*p, z1]))
    K["st_cream"].quad(*[np.array([*p, z1]) for p in (c[0], c[1], c[2], c[3])][::-1])
    K["st_cream"].quad(*[np.array([*p, z0]) for p in (c[0], c[1], c[2], c[3])])


def taiseido(K, A, D):
    T = TAISEIDO
    a, b = (np.asarray(p, float) for p in T["face"])
    f = unit(b - a)
    n = left_of(f)
    if n @ (np.asarray(T["toward"]) - (a + b) / 2) < 0:
        n = -n
    g = D.ground(*((a + b) / 2))
    for j, (along, w, z0, z1, _) in enumerate(T["blades"]):
        blade(K, A, a + f * along, n, 0.2, w, g + z0, g + z1, f"st_tai{j}", thick=0.18)


def build(K, A, D):
    n = dress(K, A, D)
    named(K, A, D)
    s109_side(K, A, D)
    seibu(K, A, D)
    taiseido(K, A, D)
    return n


# ---------------------------------------------------------------- the art (scramble.jpg)

def _im(w, h, c):
    from PIL import Image
    return Image.new("RGB", (w, h), ad.rgb(c) if isinstance(c, str) else c)


def _panel(img, rect, bg, word, face, fg, edge=True):
    from PIL import ImageDraw
    x, y, w, h = rect
    im = _im(w, h, bg)
    if edge:
        ImageDraw.Draw(im).rectangle([2, 2, w - 3, h - 3], outline=tuple(max(0, c - 50) for c in ad.rgb(bg)), width=3)
    ad.text(im, (w / 2, h * 0.53), word, face, int(h * 0.66), fill=fg, max_w=w * 0.92)
    img.paste(im, (x, y))


def _column(img, rect, panels, face="zen"):
    """A vertical sign: tenants top to bottom, each its colours, set vertically."""
    from PIL import ImageDraw
    x, y, w, h = rect
    im = _im(w, h, (20, 20, 22))
    d = ImageDraw.Draw(im)
    ph = h / len(panels)
    for k, (word, bg, fg) in enumerate(panels):
        y0 = int(k * ph)
        d.rectangle([2, y0 + 2, w - 3, int(y0 + ph) - 2], fill=ad.rgb(bg))
        size = int(min(w * 0.72, (ph - 8) / max(1, len(word)) / 1.05))
        sub = _im(w - 4, int(ph) - 4, bg)
        top = (ph - 4 - size * 1.05 * len(word)) / 2
        ad.vtext(sub, ((w - 4) / 2, top), word, face, size, fill=fg)
        im.paste(sub, (2, y0 + 2))
    img.paste(im, (x, y))


def draw(img, rects):
    for i, (bg, word, face, fg) in enumerate(FASCIAS):
        _panel(img, rects[f"st_fascia{i}"], bg, word, face, fg)
    rng = np.random.default_rng(118)
    for i in range(STACKS):
        k = STACK_K[i]
        pick = rng.choice(len(TENANT_PANELS), k, replace=False)
        _column(img, rects[f"st_stack{i}"], [TENANT_PANELS[j] for j in pick])
    for i, (bg, word, fg) in enumerate(BANDS):
        _panel(img, rects[f"st_band{i}"], bg, word, "zen", fg)
    for k, s in enumerate(NAMED):
        bg, word, face, fg = s["fascia"]
        _panel(img, rects[f"st_named{k}"], bg, word, face, fg)
        bg, word, fg = s["sub"]
        _panel(img, rects[f"st_sub{k}"], bg, word, "zen", fg, edge=False)
        for j, (bg, word, fg) in enumerate(s["banners"]):
            x, y, w, h = rects[f"st_banner{k}_{j}"]
            im = _im(w, h, bg)
            if len(word) == 1:
                ad.text(im, (w / 2, h * 0.5), word, "dela", int(w * 0.8), fill=fg)
            elif word.isascii():
                im = im.rotate(90, expand=True)
                ad.text(im, (h / 2, w / 2), word, "anton", int(w * 0.6), fill=fg, max_w=h * 0.9)
                im = im.rotate(-90, expand=True)
            else:
                size = int(min(w * 0.7, h * 0.9 / len(word)))
                ad.vtext(im, (w / 2, (h - size * 1.05 * len(word)) / 2), word, "zen", size, fill=fg)
            img.paste(im, (x, y))
    # MODI's and SHIBUYA109's names, set up their blades
    for key, word, bg, fg, face in (("st_modi", "MODI", "#ffffff", "#111111", "anton"), ("st_109name", "SHIBUYA109", "#c9cdd1", "#e6007e", "anton")):
        x, y, w, h = rects[key]
        im = _im(h, w, bg)
        ad.text(im, (h / 2, w / 2), word, face, int(w * 0.7), fill=fg, max_w=h * 0.92)
        img.paste(im.rotate(-90, expand=True), (x, y))
    x, y, w, h = rects["st_notice"]
    im = _im(w, h, "#fbfaf6")
    ad.text(im, (w / 2, h * 0.5), SEIBU["notice"], "zen", int(h * 0.3), fill="#222222", max_w=w * 0.95)
    img.paste(im, (x, y))
    for j, (_, _, _, _, (bg, word, fg)) in enumerate(TAISEIDO["blades"]):
        x, y, w, h = rects[f"st_tai{j}"]
        im = _im(w, h, bg)
        size = int(min(w * 0.72, h * 0.92 / len(word) / 1.05))
        ad.vtext(im, (w / 2, (h - size * 1.05 * len(word)) / 2), word.replace(" ", ""), "zen", size, fill=fg)
        img.paste(im, (x, y))
