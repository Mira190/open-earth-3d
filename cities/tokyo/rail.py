"""The JR viaduct from Tokyo Station to Shimbashi, Yurakucho Station on it, and the trains' courses.

Four double-track lines run side by side here on a viaduct about six metres over the streets: the Keihin-Tohoku
and Yamanote lines on the red-brick arches of 1910 (the elevated line Franz Baltzer laid out for the Railway
Agency on Berlin's Stadtbahn's pattern), the Tokaido Main Line beside them, and the Tokaido Shinkansen on its 1964
concrete viaduct on the east. Yurakucho Station (1910) has two island platforms on the brick arches: 1 and 4 the
Keihin-Tohoku Line, 2 and 3 the Yamanote Line. The Tokaido Line and the Shinkansen have no platform and run
past it. The city's solids leave the whole corridor empty, as the photograph on the ground shows only track.

Everything is laid out on OpenStreetMap's tracks and platform outlines (cities/tokyo/rail_osm.json,
pipeline/rail_osm.py). What is not mapped is from published figures and photographs:
  rail level    about 6.5 m over the street (the arches' crown about 4.5 m, as the height signs under them say);
                the viaduct is all but level, so one level for the whole stretch (RAIL_Z, m T.P.)
  platforms     1,100 mm over the rail (JR East's standard for commuter stock), 11-car (220 m), with platform
                doors on all four tracks (the Yamanote Line's since 2014; the Keihin-Tohoku Line's by JR East's
                programme for 2020)
  gauges        1,067 mm, and 1,435 mm for the Shinkansen
  overhead      contact wire 5.0 m over the rail (Shinkansen 5.0 m), on portal gantries about 50 m apart

meshes(Mesh)       the viaduct (deck, track, the brick arches and the concrete frame under it, girders over the
                   streets, parapets, overhead line), the station (platforms, canopies, lights, signs, platform doors,
                   stairs up from the concourse under the tracks) and a train shed's mouth at each end, where the
                   trains come from and go to
surfaces()         the platforms and the stairs, for the game to walk on
trains()           game.json "trains": each track's course and what runs on it (web/game/trains.js)
assets(out_dir)    the signs' sheet (rail_signs.png)
glows()            the station's own light on its platforms after dark
demolished()       the city's low solids under the platforms
"""
import json
import math
import os

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import substring

from railkit import Kit, bay, offset, ribbon, tri_poly, wall

HERE = os.path.dirname(os.path.abspath(__file__))
RAIL_Z = 9.2            # top of rail, m T.P.
PLAT = 1.1              # a platform over the rail
SLAB = 0.9              # the deck under the rail (ballast and slab)
N_GATE, S_GATE = 965.0, 2535.0   # the stretch, in metres along the reference track from where the data starts
SHED = 46.0             # a train shed's mouth at each end, inside the gates
LINES = {"京浜東北線": "keihin", "山手線": "yamanote", "東海道本線": "tokaido", "東海道新幹線": "shinkansen"}
ROADW = {"motorway": 14, "trunk": 13, "primary": 13, "secondary": 11, "tertiary": 9, "residential": 7, "unclassified": 6, "living_street": 5}
CAR = 20.0              # a commuter car, coupler to coupler
DOORS = (-7.23, -2.41, 2.41, 7.23)   # its four doors a side, from its middle (a 4.82 m pitch)

MATERIALS = {
    "rail_ballast": {"color": "#6a625a", "roughness": 0.95, "metalness": 0.0},
    "rail_bed": {"color": "#6a625a", "roughness": 0.95, "metalness": 0.0, "pattern": "deck_zones", "zones": [[2.7, "rail"]]},
    "rail_steel": {"color": "#8d8478", "roughness": 0.32, "metalness": 0.85},
    "rail_brick": {"color": "#8c4a38", "roughness": 0.85, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.085, "block_m": 0.23},
    "rail_stone": {"lamp_lit": True, "color": "#968f82", "roughness": 0.85, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.3, "block_m": 0.62},
    "rail_concrete": {"lamp_lit": True, "color": "#a8a59c", "roughness": 0.85, "metalness": 0.0},
    "rail_soffit": {"color": "#8f8c85", "roughness": 0.9, "metalness": 0.0},
    "rail_girder": {"color": "#7b9086", "roughness": 0.55, "metalness": 0.35},
    "rail_shop": {"color": "#2b2f33", "roughness": 0.25, "metalness": 0.3, "pattern": "curtain_wall", "bay_m": 1.3, "storey_m": 3.4,
                  "spandrel": 0.16, "frame": "#3a332c", "mullion_m": 0.1, "lit_share": 0.9, "lit_k": 1.5, "warm_share": 0.92},
    "rail_shutter": {"lamp_lit": True, "color": "#8d8f8c", "roughness": 0.6, "metalness": 0.4},
    "rail_mast": {"color": "#6f7c7a", "roughness": 0.6, "metalness": 0.5},
    "rail_wire": {"color": "#3c3a36", "roughness": 0.5, "metalness": 0.7, "shadow": False},
    "rail_platform": {"color": "#b4aea4", "roughness": 0.8, "metalness": 0.0, "pattern": "granite", "joints_m": [0.3, 0.3], "street_lit": True},
    "rail_stairs": {"lamp_lit": True, "color": "#a9a49b", "roughness": 0.8, "metalness": 0.0},
    "rail_yellow": {"lamp_lit": True, "color": "#e8c21c", "roughness": 0.7, "metalness": 0.0, "decal": True},
    "rail_white": {"lamp_lit": True, "color": "#ecebe6", "roughness": 0.6, "metalness": 0.0, "decal": True},
    "rail_roof": {"color": "#c4c8c6", "roughness": 0.5, "metalness": 0.5},
    "rail_ceiling": {"lamp_lit": True, "color": "#e4e2da", "roughness": 0.7, "metalness": 0.0},
    "rail_frame": {"lamp_lit": True, "color": "#a9b7b8", "roughness": 0.55, "metalness": 0.4},
    "rail_lamp": {"color": "#f4f6ee", "roughness": 0.4, "metalness": 0.0, "emissive": "#f2fbe9", "glow": 2.6, "glow_day": 0.9},
    "rail_psd": {"lamp_lit": True, "color": "#eceeed", "roughness": 0.45, "metalness": 0.2},
    "rail_psd_glass": {"color": "#bcd3d6", "roughness": 0.08, "metalness": 0.3, "opacity": 0.32},
    "rail_psd_line": {"lamp_lit": True, "color": "#7cc142", "roughness": 0.5, "metalness": 0.0},
    "rail_sign": {"color": "#ffffff", "roughness": 0.5, "metalness": 0.0, "map": "rail_signs.png", "emissive_map": True, "glow": 1.25, "glow_day": 0.35},
    "rail_bench": {"lamp_lit": True, "color": "#3d6f9a", "roughness": 0.6, "metalness": 0.1},
    "rail_dark": {"color": "#16181a", "roughness": 0.9, "metalness": 0.0},
}

_S = {}


# ---------------------------------------------------------------- the layout, from the mapped tracks

def city():
    if "C" not in _S:
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), "pipeline"))
        from cityctx import City
        _S["C"] = City("tokyo")
    return _S["C"]


def layout():
    """Everything the meshes, the strips and the game data share, worked out once."""
    if "L" in _S:
        return _S["L"]
    path = os.path.join(HERE, "rail_osm.json")
    if not os.path.exists(path):
        return None
    import archkit as ak
    C, D, T = city(), json.load(open(path, encoding="utf8")), ak.Terrain("tokyo")
    loc = lambda ll: [C.fwd.transform(*p) for p in ll]
    by = {}
    for t in D["tracks"]:
        by.setdefault(t["line"], []).append(LineString(loc(t["ll"])))
    through = {}
    for name, ls in by.items():
        m = shapely.line_merge(shapely.union_all(ls))
        through[name] = sorted(getattr(m, "geoms", [m]), key=lambda g: -g.length)[:2]
    south = lambda g: g if g.coords[0][1] > g.coords[-1][1] else LineString(g.coords[::-1])
    # the reference: the Yamanote track nearer the east (the outer loop, southbound), from north to south
    ya = [south(g) for g in through["山手線"]]
    ref = max(ya, key=lambda g: g.interpolate(g.project(Point(370, 550))).x)

    def frame(s):
        a, b = ref.interpolate(s - 0.5), ref.interpolate(s + 0.5)
        t = np.array([b.x - a.x, b.y - a.y])
        t /= np.linalg.norm(t)
        p = ref.interpolate(s)
        return np.array([p.x, p.y]), t, np.array([-t[1], t[0]])   # the point, along (southward), across (to the east)

    def sv(x, y):
        s = ref.project(Point(x, y))
        p, t, n = frame(s)
        return s, float((np.array([x, y]) - p) @ n)

    def gate(s, half=90.0):
        p, t, n = frame(s)
        return LineString([p - n * half, p + n * half])

    band = substring(ref, N_GATE, S_GATE).buffer(90.0, cap_style="flat")
    tracks = []
    for name, gs in through.items():
        for g in gs:
            g = south(g).intersection(band)
            g = max(getattr(g, "geoms", [g]), key=lambda q: q.length)
            n = max(2, int(g.length / 5.0) + 1)
            pts = np.array([g.interpolate(k / (n - 1), normalized=True).coords[0] for k in range(n)])
            v = sv(*pts[len(pts) // 2])[1]
            tracks.append({"line": LINES[name], "native": name, "pts": pts, "geom": LineString(pts), "side": v})
    tracks.sort(key=lambda t: sv(*t["geom"].interpolate(t["geom"].project(Point(370, 550))).coords[0])[1])
    # left-hand running: of each pair the western track runs north (towards Tokyo), the eastern south.
    # Keihin-Tohoku's two tracks are the outer pair round the Yamanote's
    seen = {}
    for t in tracks:
        t["south"] = bool(seen.get(t["line"]))
        seen[t["line"]] = 1
        t["gauge"] = 1.435 if t["line"] == "shinkansen" else 1.067
    # the platforms at Yurakucho, each as frames along the reference: (s, centre, across, width)
    plats = []
    for p in D["platforms"]:
        P = Polygon(loc(p["ll"]))
        if not (300 < P.centroid.y < 800 and P.area > 800):
            continue
        ss = [sv(*c)[0] for c in P.exterior.coords]
        fr = []
        for s in np.arange(min(ss) + 1.0, max(ss) - 0.99, 2.0):
            q = gate(s, 40).intersection(P)
            if q.is_empty:
                continue
            q = max(getattr(q, "geoms", [q]), key=lambda g: g.length)
            (x0, y0), (x1, y1) = q.coords[0], q.coords[-1]
            _, t, n = frame(s)
            fr.append((float(s), np.array([(x0 + x1) / 2, (y0 + y1) / 2]), t, n, float(q.length)))
        plats.append({"ref": p.get("ref", ""), "poly": P, "frames": fr, "side": sv(P.centroid.x, P.centroid.y)[1]})
    plats.sort(key=lambda p: p["side"])
    for p, k in zip(plats, "ab"):
        p["key"] = k
    # the deck: the tracks' and the platforms' ground, closed up between neighbouring tracks
    deck = shapely.union_all([t["geom"].buffer(2.55, cap_style="flat") for t in tracks] + [p["poly"].buffer(0.3) for p in plats])
    deck = deck.buffer(2.0, join_style="mitre").buffer(-2.0, join_style="mitre").intersection(band).simplify(0.25)
    deck = max(getattr(deck, "geoms", [deck]), key=lambda g: g.area) if deck.geom_type != "Polygon" else deck
    deck = Polygon(deck.exterior, [h for h in deck.interiors if Polygon(h).area > 150])
    # the city's solids in its way: the low ones under the platforms (the old station's rooms, which the viaduct
    # built here stands in for) come down; a tower whose corner the mapped tracks clip keeps its corner
    gone = []
    for q in ak.load_solids("tokyo"):
        if len(q["ring"]) < 3:
            continue
        P = Polygon(q["ring"]).buffer(0)
        if not P.intersects(deck) or P.intersection(deck).area < 1:
            continue
        if q["top"] < RAIL_Z - 1 and P.intersection(deck).area > 0.6 * P.area:
            gone.append(q["si"])
        else:
            deck = deck.difference(P.buffer(0.6))
            deck = max(getattr(deck, "geoms", [deck]), key=lambda g: g.area)
    # the station's concourse, straight across under the tracks at the middle of the platforms, and the streets
    # and footways that pass under the viaduct
    mid = float(np.mean([f[0] for p in plats for f in p["frames"]]))
    conc = Polygon([*gate(mid - 9).coords, *gate(mid + 9).coords[::-1]])
    G = json.load(open(os.path.join(C.out, "game.json")))
    near = deck.buffer(7.0)
    cuts = [conc]
    for kind, arr in G["paths"].items():
        for o in arr:
            p = np.asarray(o["p"], float).reshape(-1, 3) / 10
            if len(p) < 2 or p[:, 2].max() > RAIL_Z - 2:   # (an expressway over the tracks is no street under them)
                continue
            ln = LineString(p[:, :2])
            if not ln.intersects(deck):
                continue
            w = ROADW.get(o.get("c"), 7) / 2 + 3.2 if kind == "road" else 2.6
            # only a way that crosses: one that runs along under the tracks for a long way is left closed
            part = ln.intersection(near)
            for q in getattr(part, "geoms", [part]):
                if q.geom_type == "LineString" and q.length < 95 and q.intersects(deck):
                    cuts.append(q.buffer(w, cap_style="flat"))
    openings = shapely.union_all(cuts).buffer(1.5).buffer(-1.5)
    L = {"C": C, "T": T, "ref": ref, "frame": frame, "sv": sv, "gate": gate, "band": band, "tracks": tracks, "plats": plats, "deck": deck,
         "openings": openings, "mid": mid, "conc": conc, "stops": D["stops"], "gone": gone}
    L["stairs"] = stairs(L)
    _S["L"] = L
    return L


def stairs(L):
    """Two flights up to each platform from the concourse, one to the north and one to the south: each
    {key, plat, a (foot), b (head), t (along, uphill), n, w, z0, z1, run}."""
    out = []
    T, mid = L["T"], L["mid"]
    for p in L["plats"]:
        fr = {round(f[0]): f for f in p["frames"]}
        ss = sorted(fr)
        for d, tag in ((-1, "n"), (1, "s")):   # uphill towards the north, or the south
            s0 = mid + d * 8.2    # the foot, just inside the concourse
            f0 = fr[min(ss, key=lambda s: abs(s - s0))]
            c0 = f0[1] + f0[2] * (s0 - f0[0])
            z0, z1 = T(*c0) + 0.02, RAIL_Z + PLAT
            run = (z1 - z0) / 0.5 + 1.6   # 1 in 2, and a landing half way
            f1 = fr[min(ss, key=lambda s: abs(s - (s0 + d * run)))]
            c1 = f1[1] + f1[2] * (s0 + d * run - f1[0])
            t = (c1 - c0) / np.linalg.norm(c1 - c0)
            out.append({"key": f"{p['key']}{tag}", "plat": p["key"], "a": c0, "b": c0 + t * run, "t": t, "n": np.array([-t[1], t[0]]), "w": 3.0,
                        "z0": z0, "z1": z1, "run": run})
    return out


def stair_slot(st, grow=0.0):
    a, b, n, w = st["a"], st["b"], st["n"], st["w"] / 2 + grow
    return Polygon([a - n * w, b - n * w, b + n * w, a + n * w])


# ---------------------------------------------------------------- the signs' sheet

# each sign: (key, pixel box x, y, w, h) on a 2048 x 1024 sheet; faces take their UVs from here
SHEET = (2048, 1024)
SIGNS = {}


def _layout_signs():
    if SIGNS:
        return
    y = 0
    for k in ("name_a", "name_b"):                # the station's name boards, 3.2 x 1.0 m
        SIGNS[k] = (0, y, 1024, 320)
        y += 320
    for i in range(4):                            # platform and direction boards, 4.2 x 0.6 m
        SIGNS[f"dir{i + 1}"] = (1024, i * 148, 1024, 146)
    for i in range(4):                            # departure boards, 2.4 x 0.6 m
        SIGNS[f"led{i + 1}"] = (1024 + (i % 2) * 512, 600 + (i // 2) * 130, 510, 128)
    SIGNS["entrance"] = (0, 640, 1024, 160)       # the entrance's fascia, 9 x 1.4 m
    SIGNS["gates"] = (0, 810, 640, 100)           # over the ticket gates
    SIGNS["vending"] = (660, 810, 180, 210)       # a drinks machine's front
    SIGNS["vending2"] = (850, 810, 170, 210)
    SIGNS["blank"] = (4, 930, 60, 60)             # a lit white panel


def sign_uv(key):
    _layout_signs()
    x, y, w, h = SIGNS[key]
    W, H = SHEET
    return [[x / W, 1 - (y + h) / H], [(x + w) / W, 1 - (y + h) / H], [(x + w) / W, 1 - y / H], [x / W, 1 - y / H]]


def sign(K, c, N, w, z0, h, key, off=0.05):
    """A sign's lit face, w wide and h high, its middle at c (plan) and its foot at z0, read from the side N points to."""
    c, N = np.asarray(c, float), np.asarray(N, float)
    r = np.array([-N[1], N[0]])    # the reader's right
    a, b = c - r * w / 2 + N * off, c + r * w / 2 + N * off
    K["rail_sign"].quad([*a, z0], [*b, z0], [*b, z0 + h], [*a, z0 + h], sign_uv(key))


def assets(out_dir):
    """Draw the signs: JR East's station name boards, the platform boards with their line colours, the departure
    boards' orange and green LEDs, the entrance. The lettering is IPA Gothic (IPA Font License) where it is
    installed, else the default face."""
    from PIL import Image, ImageDraw, ImageFont
    _layout_signs()
    img = Image.new("RGB", SHEET, (20, 22, 24))
    d = ImageDraw.Draw(img)

    def font(size, bold=False):
        for p in ("/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf", "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
                  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"):
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
        return ImageFont.load_default()

    def text(xy, s, size, fill, anchor="mm", stroke=0):
        d.text(xy, s, font=font(size), fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=fill)

    GREEN, YAM, KEI = (0, 138, 62), (128, 194, 65), (0, 178, 229)
    # the name boards: white, the line's band along the foot with this station's square, the neighbours either side
    for k, (code, col, prev, nxt) in {"name_a": ("JY 30", YAM, ("新橋", "Shimbashi"), ("東京", "Tōkyō")),
                                      "name_b": ("JK 25", KEI, ("新橋", "Shimbashi"), ("東京", "Tōkyō"))}.items():
        x, y, w, h = SIGNS[k]
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(248, 248, 244))
        text((x + w / 2, y + 86), "有楽町", 118, (20, 20, 20), stroke=2)
        text((x + w / 2, y + 168), "ゆうらくちょう", 38, (40, 40, 40))
        text((x + w / 2, y + 214), "Yūrakuchō", 40, (20, 20, 20), stroke=1)
        d.rectangle([x, y + 246, x + w - 1, y + 276], fill=GREEN)
        d.rectangle([x + w / 2 - 34, y + 240, x + w / 2 + 34, y + 282], fill=col)
        d.polygon([(x + 26, y + 261), (x + 60, y + 243), (x + 60, y + 279)], fill=(248, 248, 244))
        d.polygon([(x + w - 26, y + 261), (x + w - 60, y + 243), (x + w - 60, y + 279)], fill=(248, 248, 244))
        text((x + 150, y + 296), prev[0], 30, (20, 20, 20))
        text((x + 290, y + 298), prev[1], 24, (60, 60, 60))
        text((x + w - 290, y + 296), nxt[0], 30, (20, 20, 20))
        text((x + w - 150, y + 298), nxt[1], 24, (60, 60, 60))
        d.rounded_rectangle([x + 60, y + 30, x + 180, y + 120], 12, outline=col, width=9)
        text((x + 120, y + 75), code, 36, (20, 20, 20), stroke=1)
    # the platform boards: the number in a white square, the line's colour, where the trains go
    rows = {1: (KEI, "京浜東北線", "東京・上野・大宮 方面", "Keihin-Tōhoku Line  for Tōkyō, Ueno, Ōmiya"),
            2: (YAM, "山手線", "東京・上野 方面", "Yamanote Line  for Tōkyō, Ueno"),
            3: (YAM, "山手線", "品川・渋谷 方面", "Yamanote Line  for Shinagawa, Shibuya"),
            4: (KEI, "京浜東北線", "品川・横浜 方面", "Keihin-Tōhoku Line  for Shinagawa, Yokohama")}
    for i, (col, line, to, en) in rows.items():
        x, y, w, h = SIGNS[f"dir{i}"]
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(34, 36, 40))
        d.rectangle([x, y, x + 12, y + h - 1], fill=col)
        d.rounded_rectangle([x + 30, y + 22, x + 132, y + h - 22], 8, fill=(246, 246, 240))
        text((x + 81, y + h / 2), str(i), 96, (20, 20, 20), stroke=2)
        d.rounded_rectangle([x + 158, y + 30, x + 196, y + 68], 6, fill=col)
        text((x + 210, y + 50), line, 40, (246, 246, 240), anchor="lm")
        text((x + 470, y + 52), to, 54, (246, 246, 240), anchor="lm", stroke=1)
        text((x + 160, y + 112), en, 30, (214, 214, 208), anchor="lm")
    # the departure boards: three rows of LED lettering
    led = {1: [("快速", "大宮", "Ōmiya"), ("各駅停車", "南浦和", "Minami-Urawa")], 2: [("山手線", "東京・上野方面", "for Tōkyō, Ueno"), ("山手線", "池袋方面", "for Ikebukuro")],
           3: [("山手線", "品川・渋谷方面", "for Shinagawa"), ("山手線", "新宿方面", "for Shinjuku")], 4: [("快速", "大船", "Ōfuna"), ("各駅停車", "磯子", "Isogo")]}
    for i, lines in led.items():
        x, y, w, h = SIGNS[f"led{i}"]
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(8, 8, 9))
        d.rectangle([x + 4, y + 4, x + w - 5, y + h - 5], outline=(44, 46, 48), width=3)
        for r, (kind, to, en) in enumerate(lines):
            yy = y + 36 + r * 40
            text((x + 20, yy), kind, 30, (255, 150, 30) if kind == "快速" else (80, 230, 90), anchor="lm")
            text((x + 170, yy), to, 30, (255, 170, 40), anchor="lm")
            text((x + w - 16, yy), en, 22, (255, 170, 40), anchor="rm")
        text((x + w / 2, y + h - 16), "まもなく電車がまいります", 20, (240, 60, 40))
    x, y, w, h = SIGNS["entrance"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(246, 246, 240))
    d.rectangle([x, y, x + w - 1, y + 22], fill=GREEN)
    d.rounded_rectangle([x + 34, y + 44, x + 150, y + 138], 10, fill=GREEN)
    text((x + 92, y + 91), "JR", 70, (246, 246, 240), stroke=2)
    text((x + 190, y + 80), "有楽町駅", 84, (20, 20, 20), anchor="lm", stroke=2)
    text((x + 560, y + 70), "Yūrakuchō Station", 42, (20, 20, 20), anchor="lm", stroke=1)
    text((x + 560, y + 122), "山手線 ・ 京浜東北線", 34, (60, 60, 60), anchor="lm")
    x, y, w, h = SIGNS["gates"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(34, 36, 40))
    text((x + 24, y + 34), "のりば  Tracks  1・2・3・4", 40, (246, 246, 240), anchor="lm", stroke=1)
    text((x + 24, y + 78), "山手線  京浜東北線", 30, YAM, anchor="lm")
    for k, body, cans in (("vending", (228, 232, 236), [(210, 40, 40), (30, 90, 180), (240, 240, 240), (30, 140, 70), (250, 190, 30)]),
                          ("vending2", (190, 40, 44), [(240, 240, 240), (20, 20, 20), (250, 200, 40), (30, 120, 200), (230, 120, 30)])):
        x, y, w, h = SIGNS[k]
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=body)
        d.rectangle([x + 10, y + 12, x + w - 11, y + 118], fill=(250, 250, 246))
        for r in range(3):
            for c in range(7):
                col = cans[(r * 3 + c * 2) % len(cans)]
                d.rounded_rectangle([x + 16 + c * ((w - 32) / 7), y + 18 + r * 34, x + 16 + c * ((w - 32) / 7) + (w - 32) / 7 - 5, y + 18 + r * 34 + 26], 3, fill=col)
        d.rectangle([x + 10, y + 128, x + w - 11, y + 150], fill=(60, 64, 70))
        d.rectangle([x + 24, y + 168, x + w - 25, y + 196], fill=(30, 32, 36))
    x, y, w, h = SIGNS["blank"]
    d.rectangle([x - 4, y - 4, x + w + 3, y + h + 3], fill=(244, 248, 238))
    img.save(os.path.join(out_dir, "rail_signs.png"))
    return ["rail_signs.png"]


# ---------------------------------------------------------------- the meshes

def meshes(Mesh):
    L = layout()
    if not L:
        return {}, []
    T, frame, sv, deck, openings = L["T"], L["frame"], L["sv"], L["deck"], L["openings"]
    K = Kit(Mesh, "rail", MATERIALS, flood=("rail_shop", "rail_lamp", "rail_sign"), sky={"rail_soffit": 0.3, "rail_ceiling": 0.45, "rail_frame": 0.6})
    zt, zs = RAIL_Z - 0.2, RAIL_Z - SLAB        # the ballast's top, the deck's soffit
    slots = shapely.union_all([stair_slot(st, 0.25) for st in L["stairs"]])
    plat_all = shapely.union_all([p["poly"] for p in L["plats"]])
    # ---- the deck and the track
    tri_poly(K["rail_ballast"], deck.difference(plat_all.buffer(-0.05)), zt)
    for t in L["tracks"]:
        ribbon(K["rail_bed"], t["pts"], zt + 0.03, 1.35)
        for s in (-1, 1):
            K["rail_steel"].sweep([[*q, RAIL_Z - 0.08] for q in offset(t["pts"], s * t["gauge"] / 2)[::2]], [(-0.035, -0.08), (0.035, -0.08), (0.035, 0.08), (-0.035, 0.08)])
    # ---- under the deck: closed where nothing passes, its faces brick arches on the west (1910) and a concrete
    # frame on the east (the Shinkansen's, 1964); abutments in dressed stone along the streets that pass under
    under = deck.difference(openings).difference(slots).buffer(0)
    edge = deck.exterior
    bays = 0
    for g in getattr(under, "geoms", [under]):
        if g.geom_type != "Polygon" or g.area < 6:
            continue
        for ring in [g.exterior, *g.interiors]:
            c = list(ring.coords)
            sign = 1 if ring.is_ccw else -1
            if ring is not g.exterior:
                sign = -sign
            u = 0.0
            for a, b in zip(c, c[1:]):
                a, b = np.array(a), np.array(b)
                ln = float(np.linalg.norm(b - a))
                if ln < 0.05:
                    continue
                t = (b - a) / ln
                out = np.array([t[1], -t[0]]) * sign      # away from the solid
                m = (a + b) / 2
                ga, gb = T(*a), T(*b)
                if edge.distance(Point(*m)) < 0.4 and ln > 0.6:   # the viaduct's own face
                    kind = "arch" if sv(*m)[1] < 10 else "frame"
                    n = max(1, round(ln / (7.6 if kind == "arch" else 9.5)))
                    for k in range(n):
                        p0, p1 = a + (b - a) * k / n, a + (b - a) * (k + 1) / n
                        bays += 1
                        bay(K, p0, p1, ga + (gb - ga) * k / n, ga + (gb - ga) * (k + 1) / n, zs, out, kind, bays)
                    # the deck's band over the arches, proud of the face
                    (K["rail_stone"] if kind == "arch" else K["rail_concrete"]).quad([*(a + out * 0.12), zs - 0.05], [*(b + out * 0.12), zs - 0.05], [*(b + out * 0.12), zt + 0.1], [*(a + out * 0.12), zt + 0.1],
                                                                                    [[u, 0], [u + ln, 0], [u + ln, 0.8], [u, 0.8]])
                else:
                    u = wall(K["rail_stone"], a, b, ga - 0.4, gb - 0.4, zs, u)
    # ---- over the streets: the soffit, and plate girders on the deck's edges
    span = deck.intersection(openings.union(slots.buffer(0.1))).buffer(0)
    tri_poly(K["rail_soffit"], span, zs)
    tri_poly(K["rail_soffit"], under, zs - 0.02)   # (seen only through a shop's glass; closes the deck from below)
    for ring in [deck.exterior, *deck.interiors]:
        c = np.array(ring.coords)
        for a, b in zip(c, c[1:]):
            m = (a + b) / 2
            ln = float(np.linalg.norm(b - a))
            if ln < 0.3:
                continue
            t = (b - a) / ln
            out = np.array([t[1], -t[0]]) * (1 if ring.is_ccw else -1) * (1 if ring is deck.exterior else -1)
            if openings.contains(Point(*m)):   # a girder's web, 1.5 m deep, its flanges and stiffeners
                K["rail_girder"].quad([*(a + out * 0.1), zs - 0.55], [*(b + out * 0.1), zs - 0.55], [*(b + out * 0.1), zt + 0.12], [*(a + out * 0.1), zt + 0.12])
                for z in (zs - 0.55, zt + 0.12):
                    K["rail_girder"].box([*(a + out * 0.1), z], [*(b + out * 0.1), z], 0.5, 0.06)
                for k in range(1, int(ln / 1.8) + 1):
                    q = a + t * (ln * k / (int(ln / 1.8) + 1)) + out * 0.16
                    K["rail_girder"].box([*q, zs - 0.5], [*q, zt + 0.1], 0.12, 0.05)
            # the parapet: a low wall on the brick side, a noise wall on the Shinkansen's
            if plat_all.distance(Point(*m)) > 0.8:
                east = sv(*m)[1] > 10
                h = 2.0 if east else 1.05
                pa, pb = a - out * 0.15, b - out * 0.15
                K["rail_concrete"].box([*pa, zt + h / 2], [*pb, zt + h / 2], 0.22, h)
    # ---- the overhead line: portal gantries, and a contact wire under a messenger over each track
    s = N_GATE + SHED + 12
    canopy = shapely.union_all([p["poly"].buffer(1.0) for p in L["plats"]])
    while s < S_GATE - SHED:
        p, t, n = frame(s)
        cut = LineString([p - n * 70, p + n * 70]).intersection(deck)
        for q in getattr(cut, "geoms", [cut]):
            if q.is_empty or q.length < 6:
                continue
            a, b = np.array(q.coords[0]), np.array(q.coords[-1])
            d = (b - a) / np.linalg.norm(b - a)
            a, b = a + d * 0.45, b - d * 0.45
            for e in (a, b):
                K["rail_mast"].box([*e, zt], [*e, RAIL_Z + 7.6], 0.3, 0.3)
            for z in (RAIL_Z + 6.5, RAIL_Z + 7.5):
                K["rail_mast"].box([*a, z], [*b, z], 0.16, 0.16)
            n_web = max(2, int(np.linalg.norm(b - a) / 2.0))
            for k in range(n_web):   # the truss's diagonals
                u0, u1 = a + (b - a) * k / n_web, a + (b - a) * (k + 1) / n_web
                K["rail_mast"].box([*u0, RAIL_Z + (6.5 if k % 2 else 7.5)], [*u1, RAIL_Z + (7.5 if k % 2 else 6.5)], 0.08, 0.08)
        s += 48.0
    for t in L["tracks"]:
        P = t["pts"][::4]
        for z, w in ((RAIL_Z + 5.0, 0.03), (RAIL_Z + 6.1, 0.03)):
            K["rail_wire"].sweep([[*q, z] for q in P], [(-w / 2, -w / 2), (w / 2, -w / 2), (0, w / 2)])
    # ---- a train shed's mouth at each end: a roof over the tracks and a dark wall behind it
    for s0, d in ((N_GATE, 1), (S_GATE, -1)):
        g0, g1 = L["gate"](s0 + d * 0.5), L["gate"](s0 + d * SHED)
        shed = Polygon([*g0.coords, *g1.coords[::-1]]).intersection(deck.buffer(1.2))
        shed = max(getattr(shed, "geoms", [shed]), key=lambda g: g.area)
        zr = RAIL_Z + 6.6
        tri_poly(K["rail_roof"], shed, zr + 0.3)
        tri_poly(K["rail_dark"], shed, zr)
        c = list(shed.exterior.coords)
        for a, b in zip(c, c[1:]):
            a, b = np.array(a), np.array(b)
            m = (a + b) / 2
            back = abs(sv(*m)[0] - (s0 + d * 0.5)) < 1.5
            front = abs(sv(*m)[0] - (s0 + d * SHED)) < 1.5
            if back:
                K["rail_dark"].quad([*a, zt], [*b, zt], [*b, zr], [*a, zr])
            elif front:
                K["rail_roof"].quad([*a, zr - 0.9], [*b, zr - 0.9], [*b, zr + 0.3], [*a, zr + 0.3])   # the roof's fascia
            else:
                K["rail_concrete"].quad([*a, zt], [*b, zt], [*b, zr + 0.3], [*a, zr + 0.3])
    station(L, K, Mesh)
    out = [m for m in K.values() if m.v] + L["own"]
    return MATERIALS, out


def station(L, K, Mesh):
    """Yurakucho's two island platforms."""
    T, frame, sv = L["T"], L["frame"], L["sv"]
    zt, zp = RAIL_Z - 0.2, RAIL_Z + PLAT
    own = L["own"] = []
    track_at = lambda line, south: next(t for t in L["tracks"] if t["line"] == line and t["south"] == south)
    for pi, p in enumerate(L["plats"]):
        st_here = [st for st in L["stairs"] if st["plat"] == p["key"]]
        holes = shapely.union_all([stair_slot(st) for st in st_here])
        top = Mesh(f"rail_platform_{p['key']}", "rail_platform", False, uv=True)   # walked on as strips (surfaces)
        tri_poly(top, p["poly"].difference(holes), zp, uv=True)
        own.append(top)
        c = list(p["poly"].exterior.coords)
        u = 0.0
        for a, b in zip(c, c[1:]):   # its faces down to the ballast, and the nosing over the track
            u = wall(K["rail_concrete"], a, b, zt, zt, zp, u)
        fr = p["frames"]
        # the yellow tactile strip and the white line, 0.9 m in from each edge
        for sgn in (-1, 1):
            edge_pts = [f[1] + f[3] * sgn * (f[4] / 2 - 0.9) for f in fr[1:-1]]
            ribbon(K["rail_yellow"], edge_pts, zp + 0.012, 0.15, uv=False)
            ribbon(K["rail_white"], [f[1] + f[3] * sgn * (f[4] / 2 - 0.08) for f in fr[1:-1]], zp + 0.012, 0.06, uv=False)
        # ---- the canopy: a butterfly roof on a row of columns down the middle, its gutter over them
        cov = [f for f in fr if fr[0][0] + 24 < f[0] < fr[-1][0] - 24]   # (the platforms' ends are open to the sky)
        he, hc = 4.7, 3.95     # the eaves and the gutter over the platform
        for sgn in (-1, 1):
            rows_t, rows_b = [], []
            for f in cov:
                hw = f[4] / 2 + 0.35
                e, m = f[1] + f[3] * sgn * hw, f[1]
                rows_t.append([[*m, zp + hc + 0.12], [*e, zp + he + 0.12]])
                rows_b.append([[*m, zp + hc], [*e, zp + he]])
            K["rail_roof"].grid(rows_t)
            K["rail_ceiling"].grid(rows_b)
            K["rail_frame"].sweep([[*(f[1] + f[3] * sgn * (f[4] / 2 + 0.35)), zp + he + 0.02] for f in cov], [(-0.05, -0.14), (0.05, -0.14), (0.05, 0.14), (-0.05, 0.14)])   # the fascia
            # two rows of tube lights along each side, as the platforms of the line have
            for off in (0.28, 0.62):
                pts = [[*(f[1] + f[3] * sgn * (f[4] / 2 + 0.35) * off), zp + hc + (he - hc) * off - 0.07] for f in cov]
                for k in range(0, len(pts) - 1, 3):
                    a, b = np.array(pts[k]), np.array(pts[min(k + 2, len(pts) - 1)])
                    K["rail_lamp"].box(a + (b - a) * 0.04, b - (b - a) * 0.04, 0.11, 0.04)
        cols = cov[2::4]
        for f in cols:   # a column every 8 m, its arms up to the eaves, a purlin across
            m, n = f[1], f[3]
            if holes.buffer(0.5).contains(Point(*m)):   # over a stair well its walls carry the roof: a post on each
                for sgn in (-1, 1):
                    K["rail_frame"].box([*(m + n * sgn * 1.75), zp + 1.2], [*(m + n * sgn * 1.75), zp + hc + 0.2], 0.16, 0.16)
            else:
                K["rail_frame"].box([*m, zp], [*m, zp + hc], 0.2, 0.2)
            for sgn in (-1, 1):
                e = m + n * sgn * (f[4] / 2 + 0.2)
                K["rail_frame"].box([*m, zp + hc - 0.2], [*e, zp + he - 0.1], 0.09, 0.14)
                K["rail_frame"].box([*(m + n * sgn * 0.08), zp + hc - 1.0], [*(m + n * sgn * 1.25), zp + hc - 0.05], 0.07, 0.07)
        # ---- platform doors along both edges: cabinets between the doors, glazed leaves at each door
        for sgn in (-1, 1):
            tr = track_at("keihin" if (sgn < 0) == (pi == 0) else "yamanote", (sgn > 0) if pi == 0 else (sgn > 0))
            edge = LineString([f[1] + f[3] * sgn * (f[4] / 2 - 0.42) for f in fr])
            cars = 10 if tr["line"] == "keihin" else 11
            door_u = sorted(edge.length / 2 + (k - (cars - 1) / 2) * CAR + dd for k in range(cars) for dd in DOORS)
            door_u = [u for u in door_u if 2.5 < u < edge.length - 2.5]
            at = lambda u, z: [*edge.interpolate(u).coords[0], z]
            prev = 0.6
            for u in door_u + [edge.length - 0.6 + 1.0]:
                a, b = prev, min(u - 1.0, edge.length - 0.6)
                if b - a > 0.3:   # a cabinet: a white box with the line's green along its top
                    n_seg = max(1, int((b - a) / 3.0))
                    for k in range(n_seg):
                        q0, q1 = a + (b - a) * k / n_seg, a + (b - a) * (k + 1) / n_seg
                        K["rail_psd"].box(at(q0, zp + 0.6), at(q1, zp + 0.6), 0.22, 1.2)
                        K["rail_psd_glass"].box(at(q0 + 0.08, zp + 1.27), at(q1 - 0.08, zp + 1.27), 0.03, 0.14)
                        K["rail_psd_line"].box(at(q0, zp + 1.215), at(q1, zp + 1.215), 0.24, 0.03)
                if u < edge.length - 0.6:   # the door: two leaves, glass over a white panel
                    K["rail_psd"].box(at(u - 1.0, zp + 0.36), at(u + 1.0, zp + 0.36), 0.06, 0.72)
                    K["rail_psd_glass"].box(at(u - 1.0, zp + 0.98), at(u + 1.0, zp + 0.98), 0.04, 0.52)
                    K["rail_psd"].box(at(u - 1.0, zp + 1.26), at(u + 1.0, zp + 1.26), 0.06, 0.05)
                    K["rail_psd"].box(at(u, zp + 0.02), at(u, zp + 1.28), 0.07, 0.07)
                prev = u + 1.0
        # ---- signs hung from the roof: the platform boards and the departure boards, back to back over the middle
        nums = (1, 2) if pi == 0 else (3, 4)
        for f in cov[8::18]:
            m, t, n = f[1], f[2], f[3]
            if holes.buffer(1.0).contains(Point(*m)):
                continue
            for sgn, num in ((-1, nums[0]), (1, nums[1])):
                c0 = m + n * sgn * (f[4] / 4 + 0.2)
                za = zp + 2.42
                for kk, (key, w, h, dz) in enumerate(((f"dir{num}", 3.6, 0.52, 0.0), (f"led{num}", 2.2, 0.55, 0.0))):
                    cc = c0 + t * (kk * 9.0)
                    a, b = cc - n * w / 2, cc + n * w / 2
                    K["rail_dark"].box([*a, za + h / 2 + dz], [*b, za + h / 2 + dz], 0.1, h + 0.06)
                    for face in (1, -1):   # read from both ways along the platform
                        sign(K, cc, t * face, w, za + dz, h, key, 0.056)
                    for e in (a + n * 0.2, b - n * 0.2):
                        K["rail_frame"].box([*e, za + h], [*e, zp + hc + (he - hc) * 0.45], 0.04, 0.04)
        # ---- the name boards on posts, facing each track; benches and drinks machines along the middle
        for k, f in enumerate(cov[5::14]):
            m, t, n = f[1], f[2], f[3]
            if holes.buffer(2.5).contains(Point(*m)):
                continue
            key = ("name_b", "name_a") if pi == 0 else ("name_a", "name_b")
            if k % 3 == 0:
                a, b = m - t * 1.45, m + t * 1.45
                for e in (a, b):
                    K["rail_frame"].box([*e, zp], [*e, zp + 2.25], 0.08, 0.08)
                K["rail_psd"].box([*a, zp + 1.72], [*b, zp + 1.72], 0.08, 0.98)
                for sgn, kk in ((-1, key[0]), (1, key[1])):
                    sign(K, m, n * sgn, 2.86, zp + 1.26, 0.92, kk, 0.046)
            elif k % 3 == 1:   # a bench: four seats back to back
                for sgn in (-1, 1):
                    c0 = m + n * sgn * 0.3
                    K["rail_bench"].box([*(c0 - t * 1.1), zp + 0.42], [*(c0 + t * 1.1), zp + 0.42], 0.42, 0.06)
                    K["rail_bench"].box([*(m + n * sgn * 0.06 - t * 1.1), zp + 0.68], [*(m + n * sgn * 0.06 + t * 1.1), zp + 0.68], 0.05, 0.42)
                for e in (-0.9, 0.9):
                    K["rail_frame"].box([*(m + t * e), zp], [*(m + t * e), zp + 0.4], 0.5, 0.06)
            else:              # a drinks machine, lit, either side
                for sgn, kk in ((-1, "vending"), (1, "vending2")):
                    c0 = m + n * sgn * 0.02
                    K["rail_shutter"].box([*(c0 - t * 0.55 + n * sgn * 0.36), zp + 0.92], [*(c0 + t * 0.55 + n * sgn * 0.36), zp + 0.92], 0.7, 1.84)
                    sign(K, c0, n * sgn, 1.04, zp + 0.06, 1.74, kk, 0.72)
        # ---- the stairs: treads between two walls, a balustrade round the well on the platform
        for st in st_here:
            a, t, n, hw, run = st["a"], st["t"], st["n"], st["w"] / 2, st["run"]
            sm = Mesh(f"rail_stair_{st['key']}", "rail_stairs", False)
            half = (run - 1.6) / 2
            rise = (st["z1"] - st["z0"]) / 2

            def zat(u):
                return st["z0"] + (min(u, half) / half) * rise + (max(0.0, min(u - half - 1.6, half)) / half) * rise

            steps = int(round(rise / 0.16))
            for flight, u0 in ((0, 0.0), (1, half + 1.6)):
                for k in range(steps):
                    ua, ub = u0 + half * k / steps, u0 + half * (k + 1) / steps
                    z = zat(u0) + rise * (k + 1) / steps
                    p0, p1 = a + t * ua, a + t * ub
                    sm.quad([*(p0 - n * hw), z], [*(p1 - n * hw), z], [*(p1 + n * hw), z], [*(p0 + n * hw), z])
                    sm.quad([*(p0 - n * hw), z - rise / steps], [*(p0 + n * hw), z - rise / steps], [*(p0 + n * hw), z], [*(p0 - n * hw), z])
            p0, p1 = a + t * half, a + t * (half + 1.6)
            zl = st["z0"] + rise
            sm.quad([*(p0 - n * hw), zl], [*(p1 - n * hw), zl], [*(p1 + n * hw), zl], [*(p0 + n * hw), zl])
            own.append(sm)
            for sgn in (-1, 1):   # the walls, from the ground to a balustrade 1.1 m over the platform, and a handrail
                e0, e1 = a + n * sgn * (hw + 0.12), a + t * run + n * sgn * (hw + 0.12)
                K["rail_stone"].quad([*e0, st["z0"] - 0.3], [*e1, st["z0"] - 0.3], [*e1, zp + 1.1], [*e0, zp + 1.1], [[0, 0], [run, 0], [run, 9], [0, 9]])
                K["rail_psd"].box([*e0, zp + 0.5], [*e1, zp + 0.5], 0.1, 1.0)     # a white panel, the line's green and a steel rail on it
                K["rail_psd_line"].box([*e0, zp + 1.0], [*e1, zp + 1.0], 0.11, 0.04)
                K["rail_frame"].tube([[*e0, zp + 1.1], [*e1, zp + 1.1]], 0.03, 6)
                rail_pts = [[*(a + t * u + n * sgn * (hw - 0.06)), zat(u) + 0.95] for u in np.linspace(0, run, 12)]
                K["rail_frame"].tube(rail_pts, 0.025, 5)
            # across the foot's end of the well, over the way in: a lintel from 2.6 m up, and the balustrade
            e0, e1 = a - n * (hw + 0.24), a + n * (hw + 0.24)
            K["rail_concrete"].quad([*e0, st["z0"] + 2.7], [*e1, st["z0"] + 2.7], [*e1, zp], [*e0, zp])
            K["rail_psd"].box([*e0, zp + 0.5], [*e1, zp + 0.5], 0.1, 1.0)
            K["rail_frame"].tube([[*e0, zp + 1.1], [*e1, zp + 1.1]], 0.03, 6)
            # lights down the walls
            for u in np.arange(2.0, run - 1.0, 3.2):
                for sgn in (-1, 1):
                    q = a + t * u + n * sgn * (hw + 0.02)
                    K["rail_lamp"].box([*(q - t * 0.5), zat(u) + 2.2], [*(q + t * 0.5), zat(u) + 2.2], 0.04, 0.1)
    # ---- the concourse under the tracks: lights on its soffit, the ticket gates' sign, the entrances' fascias
    conc = L["conc"].intersection(L["deck"])
    conc = max(getattr(conc, "geoms", [conc]), key=lambda g: g.area)
    zs = RAIL_Z - SLAB
    p, t, n = frame(L["mid"])
    s0, s1 = [sv(*c)[1] for c in (conc.exterior.interpolate(conc.exterior.project(Point(*(p - n * 80)))).coords[0], conc.exterior.interpolate(conc.exterior.project(Point(*(p + n * 80)))).coords[0])]
    for v in np.arange(s0 + 2.5, s1 - 2.0, 4.2):
        for du in (-5.0, 0.0, 5.0):
            c0 = p + n * v + t * du
            K["rail_lamp"].box([*(c0 - n * 0.9), zs - 0.06], [*(c0 + n * 0.9), zs - 0.06], 0.22, 0.05)
    for v, face in ((s0 - 0.25, -1), (s1 + 0.25, 1)):   # an entrance on the west (the International Forum's side) and the east (Ginza's)
        c0 = p + n * v
        g = T(*c0)
        a, b = c0 - t * 8.4, c0 + t * 8.4
        K["rail_dark"].box([*a, g + 4.25], [*b, g + 4.25], 0.3, 1.5)
        sign(K, c0, n * face, 16.8, g + 3.6, 1.3, "entrance", 0.16)
    for st in L["stairs"]:   # over the foot of each flight: which tracks it climbs to
        sign(K, st["a"] - st["t"] * 0.2, -st["t"], 3.0, st["z0"] + 2.75, 0.47, "dir" + {"a": "12", "b": "34"}[st["plat"]][0 if st["key"][1] == "n" else 1], 0.02)


# ---------------------------------------------------------------- the game's strips and its trains

def surfaces():
    """The platforms as straight strips along their length, and each flight of stairs."""
    L = layout()
    if not L:
        return []
    out, zp = [], RAIL_Z + PLAT
    for p in L["plats"]:
        fr = p["frames"]
        step = 8
        for k in range(0, len(fr) - 1, step):
            a, b = fr[k], fr[min(k + step, len(fr) - 1)]
            d = b[1] - a[1]
            ln = float(np.linalg.norm(d))
            ax, c = d / ln, (a[1] + b[1]) / 2
            hw = min(f[4] for f in fr[k:k + step + 1]) / 2 - 0.05
            out.append({"name": f"Yurakucho Station, platforms {'1 and 2' if p['key'] == 'a' else '3 and 4'}", "type": "strip", "origin": [round(float(c[0]), 2), round(float(c[1]), 2)],
                        "axis": [round(float(ax[0]), 5), round(float(ax[1]), 5)], "half_width": round(hw, 2),
                        "profile": [[round(-ln / 2 - (1.0 if k == 0 else 0.5), 2), zp], [round(ln / 2 + (1.0 if k + step >= len(fr) - 1 else 0.5), 2), zp]],
                        "thickness": PLAT + SLAB, "mesh": f"rail_platform_{p['key']}", "mapped": False, "label": "Yurakucho Station 有楽町駅"})
    for st in L["stairs"]:   # from the head down to the foot (tools/game_check.js climbs each: "check")
        half = (st["run"] - 1.6) / 2
        zl = (st["z0"] + st["z1"]) / 2
        c, run = st["b"], st["run"]
        out.append({"name": f"Yurakucho Station, the {'north' if st['key'][1] == 'n' else 'south'} stairs to platforms {'1 and 2' if st['plat'] == 'a' else '3 and 4'}", "type": "strip",
                    "origin": [round(float(c[0]), 2), round(float(c[1]), 2)], "axis": [round(float(-st["t"][0]), 5), round(float(-st["t"][1]), 5)], "half_width": st["w"] / 2,
                    "profile": [[-0.5, zp], [0.0, zp], [round(half, 2), round(zl, 2)], [round(half + 1.6, 2), round(zl, 2)], [round(run, 2), round(st["z0"], 2)], [round(run + 0.6, 2), round(st["z0"], 2)]],
                    "thickness": 1.0, "mesh": f"rail_stair_{st['key']}", "mapped": False, "check": True, "label": "the stairs to the platforms"})
    return out


def trains():
    """game.json "trains" (web/game/trains.js): each track's course at rail level, where its trains stop at
    Yurakucho if they do, which platform that is, and the services that run on it."""
    L = layout()
    if not L:
        return None
    sv = L["sv"]
    plat_no = {("keihin", False): 1, ("yamanote", False): 2, ("yamanote", True): 3, ("keihin", True): 4}
    tracks = []
    for t in L["tracks"]:
        pts = t["pts"] if t["south"] else t["pts"][::-1]    # in the direction of travel
        g = LineString(pts)
        o = {"id": f"{t['line']}-{'s' if t['south'] else 'n'}", "line": t["line"], "south": t["south"], "gauge": t["gauge"],
             "p": [v for q in pts for v in (round(q[0] * 10), round(q[1] * 10), round(RAIL_Z * 10))]}
        no = plat_no.get((t["line"], t["south"]))
        if no:
            p = L["plats"][0 if no < 3 else 1]
            fr = p["frames"]
            mid = fr[len(fr) // 2]
            o["stop_m"] = round(g.project(Point(*mid[1])), 1)     # where a stopping train's middle comes to rest
            o["platform"] = no
        o["hide_m"] = [round(SHED - 6.0, 1), round(g.length - SHED + 6.0, 1)]   # its cars are drawn between these: the sheds' mouths
        tracks.append(o)
    c = (L["plats"][0]["frames"][len(L["plats"][0]["frames"]) // 2][1] + L["plats"][1]["frames"][len(L["plats"][1]["frames"]) // 2][1]) / 2
    return {
        "note": "The JR lines past Yurakucho (cities/tokyo/rail.py): courses in decimetres at rail level, in the direction of travel.",
        "station": {"name": "Yurakucho", "native": "有楽町", "kana": "ゆうらくちょう", "at": [round(float(c[0]), 1), round(float(c[1]), 1), RAIL_Z + PLAT], "hear_m": 150},
        "tracks": tracks,
        "services": SERVICES,
    }


# What runs. Headways are a few times shorter than the timetable's, so that there is always a train to watch;
# the order and the kinds are the real ones. The Keihin-Tohoku Line's rapid trains (10:30 to 15:30) do not
# stop at Yurakucho; the Tokaido Line's and the Shinkansen's trains never do.
SERVICES = [
    {"track": "yamanote-n", "stock": "e235", "cars": 11, "every_s": 96, "offset_s": 10, "stops": True, "v_ms": 19,
     "for": {"ja": "東京・上野方面", "en": "Tokyo and Ueno"}, "line": {"ja": "山手線", "en": "Yamanote Line"}},
    {"track": "yamanote-s", "stock": "e235", "cars": 11, "every_s": 96, "offset_s": 58, "stops": True, "v_ms": 19,
     "for": {"ja": "品川・渋谷方面", "en": "Shinagawa and Shibuya"}, "line": {"ja": "山手線", "en": "Yamanote Line"}},
    {"track": "keihin-n", "stock": "e233k", "cars": 10, "every_s": 132, "offset_s": 34, "stops": True, "rapid_h": [10.5, 15.5], "v_ms": 21,
     "for": {"ja": "東京・上野・大宮方面", "en": "Tokyo, Ueno and Omiya"}, "line": {"ja": "京浜東北線", "en": "Keihin-Tohoku Line"}},
    {"track": "keihin-s", "stock": "e233k", "cars": 10, "every_s": 132, "offset_s": 100, "stops": True, "rapid_h": [10.5, 15.5], "v_ms": 21,
     "for": {"ja": "品川・横浜方面", "en": "Shinagawa and Yokohama"}, "line": {"ja": "京浜東北線", "en": "Keihin-Tohoku Line"}},
    {"track": "tokaido-n", "stock": "e233t", "cars": 15, "every_s": 150, "offset_s": 76, "stops": False, "v_ms": 24,
     "line": {"ja": "東海道線", "en": "Tokaido Line"}},
    {"track": "tokaido-s", "stock": "e233t", "cars": 15, "every_s": 150, "offset_s": 4, "stops": False, "v_ms": 24,
     "line": {"ja": "東海道線", "en": "Tokaido Line"}},
    {"track": "shinkansen-n", "stock": "n700s", "cars": 16, "every_s": 118, "offset_s": 88, "stops": False, "v_ms": 29,
     "line": {"ja": "東海道新幹線", "en": "Tokaido Shinkansen"}},
    {"track": "shinkansen-s", "stock": "n700s", "cars": 16, "every_s": 118, "offset_s": 24, "stops": False, "v_ms": 29,
     "line": {"ja": "東海道新幹線", "en": "Tokaido Shinkansen"}},
]


def travel():
    L = layout()
    if not L:
        return []
    f = L["plats"][1]["frames"]
    m = f[len(f) // 2 + 12]
    at = m[1] + m[3] * 1.0
    look = at + m[3] * 30 - m[2] * 60
    return [{"id": "t-yurakucho", "name": "Yurakucho Station, platform 4 有楽町駅", "at": [round(float(at[0]), 1), round(float(at[1]), 1), RAIL_Z + PLAT],
             "look": [round(float(look[0]), 1), round(float(look[1]), 1)],
             "blurb": "The island platforms on the 1910 brick viaduct: the Yamanote and Keihin-Tohoku lines stop, and the Tokaido Line and the Shinkansen run past a few metres away, with Ginza behind them."}]


def demolished():
    """The city's low solids under the platforms, which the viaduct stands in for (landmarks.json "demolished")."""
    L = layout()
    return L["gone"] if L else []


def glows():
    """The light of the platforms' tube lights and the concourse's on what stands under them after dark
    (landmarks.json "glows": [x, y, radius m, colour, strength], web/night.js)."""
    L = layout()
    if not L:
        return []
    out = []
    for p in L["plats"]:
        fr = p["frames"]
        for f in [f for f in fr if fr[0][0] + 24 < f[0] < fr[-1][0] - 24][2::5]:
            out.append([round(float(f[1][0]), 1), round(float(f[1][1]), 1), 9.0, "#f1f6e8", 0.36])
    p0, t, n = L["frame"](L["mid"])
    for v in (-12, 0, 12, 24):
        c = p0 + n * v
        out.append([round(float(c[0]), 1), round(float(c[1]), 1), 11.0, "#f1f6e8", 0.34])
    return out
