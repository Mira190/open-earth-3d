"""Kabukicho Ichibangai, the Shinjuku map's hero level (blender/build_hero.py --city shinjuku; docs/HERO.md).

Why here: the street from Yasukuni-dori through the red Ichibangai arch is Kabukicho's threshold and its
most photographed view, 8.6 m between its fronts and 130 m long, a canyon of four- to six-storey
buildings each carrying a stack of lit tenant signs: small enough to model to the centimetre, and at
night the densest light on the map. (Omoide Yokocho by the west exit was the other candidate: a finer
grain, but its alleys are roofed over and lit from inside, and they show little from the game's chase
camera; the Ichibangai arch is also where the map's opening walk already leads.)

What is built, on the fronts the city's own buildings have (kabukicho.canyon_fronts, PLATEAU's solids
on OpenStreetMap's outlines), in front of their walls:

  * every front's street floor: a shop front set back between tiled pilasters, glazed onto a lit
    interior (drawn), aluminium mullions and a door, a lit fascia box with the tenant's name, and in
    front of some a menu board, a noren curtain or a half-drawn shutter;
  * the floors above: tiled or rendered walls in the building's own colour, windows set into them with
    frames and sills, lit after dark room by room, names in the windows of the bars and karaoke rooms
    upstairs, air conditioners on brackets, drain pipes and cable runs, a parapet and its coping;
  * the tenant stacks (sode kanban): a sign standing out from each front, one panel a floor, with the real
    tenants' names where OpenStreetMap maps them (kabukicho.tenants_by_front) and Kabukicho's trades
    elsewhere; lit after dark and light the street;
  * the street: fine asphalt between the fronts, the kerbless gutters' grates, manholes, painted
    markings, stains, and a few shallow puddles that hold the signs' reflection;
  * on it: vending machines in their clusters, the lantern lamps, bins, beer crates, bicycles, cones.

The trades and colours are Kabukicho's; the names that are not OpenStreetMap's are invented, and no logo
is drawn. Learned from Ryu Ga Gotoku Studio's Kamurocho (its Kabukicho): a street read as a wall of
signs from far down it, and dressed at the foot of every front with the small things people use.
"""
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, HERE)

import adkit as ad  # noqa: E402
import kabukicho as kb  # noqa: E402

ID = "kabukicho"
STREET = "歌舞伎町一番街通り"
Y0, Y1 = 2806.0, 2936.0          # the level along the street: from the Yasukuni-dori pavement to Sakura-dori
OUT = 0.5                        # the shop fronts' face in front of the city's wall (m)
SKIN = 0.22                      # the upper floors' face in front of it
STOREY = 3.15
GF = 3.9                         # the street floor's height
# Yasukuni-dori's north pavement either side of the arch (OpenStreetMap's footway, run on west to the corner)
YASU_LINE = [(372.0, 2816.5), (404.6, 2811.8), (413.6, 2809.2), (452.3, 2800.8)]
YASU_TOP = 26.0                  # its fronts up to this height (the towers behind keep the city's own walls)

# the city's colours for the facing (linear tints of the tile and render textures)
TINTS = [(0.92, 0.88, 0.80), (0.80, 0.78, 0.74), (0.62, 0.60, 0.58), (0.95, 0.93, 0.90), (0.70, 0.62, 0.52),
         (0.55, 0.52, 0.50), (0.85, 0.80, 0.72), (0.74, 0.76, 0.78)]


def materials():
    """The level's materials, by hero.js's naming (glow*, tube*, win*, ground*)."""
    M = {
        "ground_paver": {"tex": "paver", "tint": (0.5, 0.49, 0.48), "rough": 0.8},
        "ground_puddle": {"color": (0.02, 0.022, 0.025), "rough": 0.04, "metal": 0.0},
        "ground_mark": {"color": (0.75, 0.74, 0.70), "rough": 0.7},
        "ground_iron": {"color": (0.09, 0.09, 0.09), "rough": 0.55, "metal": 0.8},
        "ground_stain": {"color": (0.05, 0.05, 0.05), "rough": 0.6, "alpha": 0.55},
        "dark_tile": {"tex": "dark", "tint": (0.55, 0.55, 0.57), "rough": 0.35},
        "conc": {"tex": "conc", "tint": (0.7, 0.7, 0.7), "rough": 0.8},
        "metal_dark": {"color": (0.035, 0.037, 0.04), "rough": 0.45, "metal": 0.7},
        "metal_alu": {"color": (0.62, 0.63, 0.64), "rough": 0.35, "metal": 0.9},
        "metal_white": {"color": (0.78, 0.78, 0.76), "rough": 0.45, "metal": 0.2},
        "plastic_grey": {"color": (0.45, 0.46, 0.46), "rough": 0.6},
        "plastic_blue": {"color": (0.02, 0.12, 0.35), "rough": 0.5},
        "plastic_yellow": {"color": (0.8, 0.55, 0.02), "rough": 0.5},
        "plastic_red": {"color": (0.55, 0.02, 0.02), "rough": 0.5},
        "rubber": {"color": (0.02, 0.02, 0.02), "rough": 0.9},
        "cable": {"color": (0.015, 0.015, 0.015), "rough": 0.7},
        "cloth_noren": {"color": (0.05, 0.08, 0.25), "rough": 0.95},
        "cloth_red": {"color": (0.5, 0.03, 0.03), "rough": 0.95},
        "shutter": {"tex": "conc", "tint": (0.55, 0.57, 0.58), "rough": 0.5, "metal": 0.6},
        "win_glass": {"map": "atlas", "rough": 0.08, "metal": 0.0, "emissive": True, "glow": 1.0},
        "glow_atlas": {"map": "atlas", "rough": 0.4, "emissive": True, "glow": 1.0},
        "glow_shop": {"map": "atlas", "rough": 0.1, "emissive": True, "glow": 0.55},
        "glow_vend": {"map": "atlas", "rough": 0.3, "emissive": True, "glow": 0.5},
        "glow_warm": {"color": (1.0, 0.85, 0.6), "emissive": (1.0, 0.78, 0.5), "glow": 2.0},
        "glow_white": {"color": (0.95, 0.97, 1.0), "emissive": (0.9, 0.95, 1.0), "glow": 2.0},
        "tube_pink": {"color": (1.0, 0.3, 0.7), "emissive": (1.0, 0.15, 0.55), "glow": 4.0},
        "tube_cyan": {"color": (0.3, 0.9, 1.0), "emissive": (0.1, 0.75, 1.0), "glow": 4.0},
        "tube_red": {"color": (1.0, 0.2, 0.15), "emissive": (1.0, 0.08, 0.05), "glow": 4.0},
    }
    for i, t in enumerate(TINTS):
        M[f"wall_tile{i}"] = {"tex": "tile", "tint": t, "rough": 0.45}
        M[f"wall_render{i}"] = {"tex": "plaster", "tint": t, "rough": 0.85}
    return M


# ---------------------------------------------------------------- the atlas

INTERIORS = 12      # shop interiors drawn (a ramen counter, a bar, a drugstore, a karaoke lobby, ...)
ROOMS = 16          # rooms seen through the windows upstairs (lit or dark)


def draw_interior(rng, kind):
    """A shop's interior through its glass: a back wall, shelves or a counter, lights."""
    from PIL import ImageDraw, ImageFilter

    def draw(img, r):
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        warm = kind % 3 != 2
        wall = (190, 150, 110) if warm else (215, 225, 235)
        d.rectangle([x, y, x + w, y + h], fill=wall)
        # the ceiling's lights
        for i in range(5):
            cx = x + (i + 0.5) * w / 5
            d.ellipse([cx - 14, y + 6, cx + 14, y + 14], fill=(255, 250, 230))
        if kind % 4 == 0:      # a counter with stools and a menu strip
            d.rectangle([x, y + h * 0.18, x + w, y + h * 0.32], fill=(250, 240, 210))
            for i in range(10):
                ad.text(img, (x + (i + 0.5) * w / 10, y + h * 0.25), "麺餃丼酒焼定肉飯茶鍋"[i], "zen", h * 0.09, fill="#7a1010")
            d.rectangle([x, y + h * 0.62, x + w, y + h], fill=(90, 50, 25))
            for i in range(7):
                cx = x + (i + 0.5) * w / 7
                d.ellipse([cx - 12, y + h * 0.56, cx + 12, y + h * 0.64], fill=(160, 20, 20))
                d.rectangle([cx - 2, y + h * 0.62, cx + 2, y + h * 0.9], fill=(40, 40, 40))
        elif kind % 4 == 1:    # shelves of goods (a drugstore, a discount shop)
            for j in range(5):
                yy = y + h * (0.2 + j * 0.15)
                d.rectangle([x, yy, x + w, yy + 4], fill=(240, 240, 240))
                pal = [(220, 220, 215), (200, 70, 60), (70, 110, 180), (90, 160, 90), (230, 200, 90), (180, 180, 185)]
                for i in range(int(w / 9)):
                    c = pal[int(rng.integers(len(pal)))]
                    d.rectangle([x + i * 9 + 1, yy - 16 - rng.integers(0, 6), x + i * 9 + 7, yy], fill=c)
            d.rectangle([x, y + h * 0.9, x + w, y + h], fill=(200, 200, 205))
        elif kind % 4 == 2:    # a bar: a dark room, bottles lit from behind
            d.rectangle([x, y, x + w, y + h], fill=(40, 22, 30))
            d.rectangle([x, y + h * 0.25, x + w, y + h * 0.55], fill=(150, 80, 40))
            bp = [(180, 140, 60), (90, 50, 30), (40, 120, 90), (160, 180, 190), (120, 70, 50), (200, 180, 120)]
            for i in range(int(w / 7)):
                c = bp[int(rng.integers(len(bp)))]
                d.rectangle([x + i * 7 + 1, y + h * 0.3, x + i * 7 + 5, y + h * 0.5], fill=c)
            d.rectangle([x, y + h * 0.66, x + w, y + h], fill=(25, 12, 10))
        else:                  # a lobby: a counter, posters, a bright floor
            d.rectangle([x, y + h * 0.7, x + w, y + h], fill=(230, 220, 200))
            for i in range(4):
                c = tuple(int(v) for v in rng.integers(80, 255, 3))
                d.rectangle([x + w * (0.05 + i * 0.24), y + h * 0.2, x + w * (0.2 + i * 0.24), y + h * 0.55], fill=c)
            d.rectangle([x + w * 0.3, y + h * 0.58, x + w * 0.7, y + h * 0.75], fill=(30, 30, 40))
        # people inside, as soft silhouettes
        for i in range(int(rng.integers(0, 4))):
            cx = x + rng.random() * w
            d.ellipse([cx - 9, y + h * 0.4, cx + 9, y + h * 0.5], fill=(50, 35, 30))
            d.rectangle([cx - 14, y + h * 0.5, cx + 14, y + h], fill=tuple(int(v) for v in rng.integers(20, 120, 3)))
        sub = img.crop((x, y, x + w, y + h)).filter(ImageFilter.GaussianBlur(1.2))
        img.paste(sub, (x, y))
    return draw


def draw_room(rng, lit):
    """A room behind a window upstairs: lit warm or cool with blinds or curtains, or dark."""
    from PIL import ImageDraw

    def draw(img, r):
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        if not lit:
            d.rectangle([x, y, x + w, y + h], fill=(14, 16, 20))
            d.rectangle([x, y + h * 0.6, x + w, y + h], fill=(8, 9, 11))
            return
        warm = rng.random() < 0.6
        c = (255, 214, 160) if warm else (215, 232, 255)
        dim = 0.55 + 0.45 * rng.random()
        c = tuple(int(v * dim) for v in c)
        d.rectangle([x, y, x + w, y + h], fill=c)
        kind = rng.integers(0, 3)
        if kind == 0:           # blinds
            for j in range(0, h, 7):
                d.rectangle([x, y + j, x + w, y + j + 3], fill=tuple(int(v * 0.8) for v in c))
        elif kind == 1:         # curtains drawn back
            cc = tuple(int(v) for v in rng.integers(60, 200, 3))
            d.rectangle([x, y, x + w * 0.22, y + h], fill=cc)
            d.rectangle([x + w * 0.78, y, x + w, y + h], fill=cc)
        d.rectangle([x, y + h * 0.75, x + w, y + h], fill=tuple(int(v * 0.5) for v in c))
        d.ellipse([x + w * 0.4, y + 2, x + w * 0.6, y + 8], fill=(255, 255, 240))
    return draw


def draw_window_sign(word, bg, fg):
    """A bar's or karaoke room's name across its window, lit from inside."""
    def draw(img, r):
        from PIL import ImageDraw
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        d.rectangle([x, y, x + w, y + h], fill=ad.rgb(bg))
        ad.text(img, (x + w / 2, y + h / 2), word, "zen" if any(ord(c) > 127 for c in word) else "anton", h * 0.55, fill=fg, max_w=w - 16)
    return draw


def draw_vending(rng, kind):
    """A drinks machine's face: rows of cans and bottles under a lit band, buttons, the coin panel."""
    from PIL import ImageDraw

    def draw(img, r):
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        body = [(240, 240, 240), (200, 20, 30), (20, 70, 160), (30, 120, 60)][kind % 4]
        d.rectangle([x, y, x + w, y + h], fill=body)
        d.rectangle([x + 6, y + 8, x + w - 6, y + h * 0.58], fill=(196, 206, 218))
        drinks = [(200, 30, 30), (40, 90, 180), (30, 140, 70), (230, 230, 230), (40, 40, 40), (210, 170, 40), (180, 60, 140), (90, 60, 40), (60, 170, 200)]
        for j in range(3):
            yy = y + 14 + j * (h * 0.56 - 14) / 3
            for i in range(8):
                cx = x + 12 + i * (w - 24) / 7.5
                c = drinks[int(rng.integers(len(drinks)))]
                d.rounded_rectangle([cx - 6, yy + 8, cx + 6, yy + 38], 4, fill=c)
                d.rectangle([cx - 6, yy + 18, cx + 6, yy + 24], fill=(245, 245, 245))   # the label band
                d.rectangle([cx - 5, yy + 42, cx + 5, yy + 46], fill=(220, 30, 30) if rng.random() < 0.35 else (40, 200, 60))
        d.rectangle([x + 6, y + h * 0.62, x + w - 6, y + h * 0.7], fill=(30, 30, 30))
        ad.text(img, (x + w / 2, y + h * 0.66), ["つめた～い", "あったか～い", "COLD DRINK", "おいしい水"][kind % 4], "zen", h * 0.045, fill="#ffffff", max_w=w - 20)
        d.rectangle([x + w * 0.62, y + h * 0.72, x + w * 0.9, y + h * 0.84], fill=(60, 60, 64))
        d.rectangle([x + 10, y + h * 0.86, x + w - 10, y + h * 0.95], fill=(15, 15, 15))
    return draw


def draw_menu(rng, i):
    """A menu board on an easel: dishes and prices, chalk on black or print on white."""
    def draw(img, r):
        from PIL import ImageDraw
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        dark = i % 2 == 0
        d.rectangle([x, y, x + w, y + h], fill=(20, 22, 20) if dark else (245, 240, 228))
        items = ["生ビール 390円", "ハイボール 290円", "唐揚げ 480円", "餃子 380円", "焼鳥盛 880円", "ラーメン 900円", "飲み放題 1500円", "お通し 300円"]
        ad.text(img, (x + w / 2, y + h * 0.1), ["本日のおすすめ", "MENU", "ランチ", "OPEN"][i % 4], "zen", h * 0.08, fill="#ffd400" if dark else "#c8000a", max_w=w - 20)
        for j in range(6):
            ad.text(img, (x + w / 2, y + h * (0.24 + j * 0.12)), items[(i * 3 + j) % len(items)], "zen", h * 0.052, fill="#f2f2f2" if dark else "#1a1a1a", max_w=w - 24)
    return draw


def draw_plain(colour):
    def draw(img, r):
        from PIL import ImageDraw
        x, y, w, h = r
        ImageDraw.Draw(img).rectangle([x, y, x + w, y + h], fill=ad.rgb(colour))
    return draw


def draw_ac(img, r):
    """An air conditioner's outdoor unit: a fan grille in a pale case."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(206, 206, 198))
    cx, cy, R = x + w * 0.36, y + h / 2, h * 0.4
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(60, 62, 62))
    for k in range(10):
        rr = R * (1 - k / 10)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(150, 150, 146), width=2)
    for k in range(4):
        a = k * math.pi / 4
        d.line([cx - R * math.cos(a), cy - R * math.sin(a), cx + R * math.cos(a), cy + R * math.sin(a)], fill=(150, 150, 146), width=2)
    for j in range(8):
        d.line([x + w * 0.72, y + h * (0.15 + j * 0.09), x + w * 0.95, y + h * (0.15 + j * 0.09)], fill=(170, 170, 162), width=2)


def draw_manhole(img, r):
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(0, 0, 0))
    cx, cy, R = x + w / 2, y + h / 2, w / 2 - 2
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(58, 56, 52))
    for k in range(1, 7):
        rr = R * k / 7
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(36, 35, 33), width=3)
    for k in range(12):
        a = k * math.pi / 6
        d.line([cx, cy, cx + R * math.cos(a), cy + R * math.sin(a)], fill=(36, 35, 33), width=3)
    ad.text(img, (cx, cy), "下水", "zen", R * 0.4, fill="#2a2926")


def draw_grate(img, r):
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(70, 68, 64))
    for i in range(0, w, 8):
        d.rectangle([x + i + 2, y + 4, x + i + 5, y + h - 4], fill=(5, 5, 5))


# ---------------------------------------------------------------- the build

class Level:
    def __init__(self, K, atlas_cls):
        self.K = K
        self.D = kb.Data("shinjuku")
        self.rng = np.random.default_rng(1969)
        self.A = atlas_cls(2048, 4096)
        self.geo = K.Geo()
        self.fronts = [f for f in kb.canyon_fronts(self.D) if f[5] == STREET and Y0 - 4 < f[0][1] < Y1 + 4] + self.yasukuni()
        self.real = kb.tenants_by_front(self.D, self.fronts)
        self.street = self.D.street(STREET)

    def yasukuni(self):
        """The fronts facing Yasukuni-dori's pavement either side of the arch, as canyon_fronts gives them."""
        from shapely.geometry import LineString, Point, Polygon
        ln = LineString(YASU_LINE)
        out = []
        for s in self.D.solids:
            if s["top"] < 6.0 or s["base"] > 1.0 or s["top"] > YASU_TOP:
                continue
            g = Polygon(s["ring"]).buffer(0)
            if g.distance(ln) > 6.0:
                continue
            ring = list(s["ring"])
            ccw = Polygon(ring).exterior.is_ccw
            for a, b in zip(ring, ring[1:] + ring[:1]):
                a, b = np.asarray(a, float), np.asarray(b, float)
                e = b - a
                L = float(np.hypot(*e))
                if L < 3.0:
                    continue
                n = np.array([e[1], -e[0]]) / L if ccw else np.array([-e[1], e[0]]) / L
                mid = (a + b) / 2
                d = ln.distance(Point(*mid))
                if d < 6.0 and ln.distance(Point(*(mid + n * 2))) < d:
                    out.append((mid, n, L, self.D.ground(*mid), s["top"], "yasu"))
        return out

    # -- the atlas cells
    def cells(self):
        A, rng = self.A, self.rng
        for i in range(INTERIORS):
            A.cell(f"int{i}", 384, 192, draw_interior(np.random.default_rng(100 + i), i))
        for i in range(ROOMS):
            A.cell(f"room{i}", 64, 64, draw_room(np.random.default_rng(200 + i), i % 3 != 2))
        words = [("カラオケ", "#ffe600", "#d4001a"), ("BAR", "#14142a", "#ff6ad8"), ("麻雀", "#0b5a2e", "#ffffff"), ("SNACK", "#3a1a5a", "#ffd76a"),
                 ("ダーツ", "#101820", "#2ad0ff"), ("個室", "#7a1010", "#ffe9c0"), ("ネットカフェ", "#1aa0e6", "#ffffff"), ("LOUNGE", "#000000", "#d8b25a")]
        for i, (w, bg, fg) in enumerate(words):
            A.cell(f"wsign{i}", 192, 64, draw_window_sign(w, bg, fg))
        for i in range(4):
            A.cell(f"vend{i}", 192, 384, draw_vending(np.random.default_rng(300 + i), i))
        for i in range(4):
            A.cell(f"menu{i}", 128, 192, draw_menu(rng, i))
        A.cell("ac", 128, 96, draw_ac)
        A.cell("manhole", 128, 128, draw_manhole)
        A.cell("grate", 128, 32, draw_grate)
        A.cell("black", 8, 8, draw_plain("#050505"))
        # the tenant stacks and fascias: kabukicho.py's own drawings, real names where OSM has them
        self.stack_keys, self.fascia_keys = [], []
        for i in range(kb.STACKS):
            self.stack_keys.append(f"stack{i}")
        for i in range(kb.FASCIAS):
            self.fascia_keys.append(f"fascia{i}")
        rects = {}
        for k in self.stack_keys + [f"rstack{fi}" for fi in self.real]:
            rects[k] = A.cell(k, 80, 560, lambda img, r: None)
        for k in self.fascia_keys + [f"rfascia{fi}" for fi in self.real]:
            rects[k] = A.cell(k, 448, 84, lambda img, r: None)
        kb.draw_canyon(A.img, rects)
        kb.draw_real(A.img, rects, self.real)
        # (their light: the mean colour of what was just drawn into each)
        for k, r in rects.items():
            a = np.asarray(A.img.crop((r[0], r[1], r[0] + r[2], r[1] + r[3])), float) / 255.0
            A.mean[k] = (a ** 2.2).reshape(-1, 3).mean(0)

    def build(self):
        self.cells()
        for fi, f in enumerate(self.fronts):
            self.front(fi, f)
        self.ground()
        self.props()
        return self.geo, self.A

    # -- one front
    def front(self, fi, f):
        G, A, rng = self.geo, self.A, np.random.default_rng(int(1000 + fi))
        mid, n, L, g, top, _ = f
        n = np.array([n[0], n[1], 0.0])
        t = np.array([-n[1], n[0], 0.0])
        m = np.array([mid[0], mid[1], 0.0])
        H = top
        z0 = g - 0.3
        tint = int(rng.integers(len(TINTS)))
        wall = f"wall_tile{tint}" if rng.random() < 0.6 else f"wall_render{tint}"
        G.walls.append((m - t * L / 2, m + t * L / 2, g, g + H))

        def P(u, v, z):   # u along the front from its middle (to the right seen from the street), v out, z absolute
            return m + t * u + n * v + np.array([0, 0, z])

        hl = L / 2
        # ---- the street floor: pilasters, the recessed glass on its lit interior, the fascia box
        pil = 0.38
        for s in (-1, 1):
            u0, u1 = (-hl, -hl + pil) if s < 0 else (hl - pil, hl)
            G.quad("dark_tile", P(u0, OUT, z0), P(u1, OUT, z0), P(u1, OUT, g + GF), P(u0, OUT, g + GF), sub=(1, 6))
            # (the pilaster's return to the glass)
            ui = u1 if s < 0 else u0
            a, b = (P(ui, OUT, z0), P(ui, 0.05, z0)) if s < 0 else (P(ui, 0.05, z0), P(ui, OUT, z0))
            G.quad("dark_tile", a, b, b + [0, 0, g + GF - z0], a + [0, 0, g + GF - z0], sub=(1, 6))
        gu0, gu1 = -hl + pil, hl - pil
        shut = rng.random() < 0.15
        kind = int(rng.integers(INTERIORS))
        zg1 = g + 2.75
        if shut:   # a shutter half down over a shop that has not opened yet
            G.quad("shutter", P(gu0, 0.12, g + 1.6), P(gu1, 0.12, g + 1.6), P(gu1, 0.12, zg1), P(gu0, 0.12, zg1),
                   uv=[(0, 0), (gu1 - gu0, 0), (gu1 - gu0, 1.2), (0, 1.2)])
        uvI = A.uv(f"int{kind}")
        G.quad("glow_shop", P(gu0, 0.06, g), P(gu1, 0.06, g), P(gu1, 0.06, zg1), P(gu0, 0.06, zg1), uv=uvI,
               emit=(A.mean[f"int{kind}"], 1.6))
        # mullions and the door's frame
        nb = max(2, int((gu1 - gu0) / 1.5))
        for i in range(nb + 1):
            u = gu0 + (gu1 - gu0) * i / nb
            G.box("metal_alu", P(u, 0.1, g), (t, n), (0.06, 0.08, zg1 - g))
        G.box("metal_alu", P((gu0 + gu1) / 2, 0.1, zg1 - 0.06), (t, n), (gu1 - gu0, 0.1, 0.08))
        G.box("dark_tile", P((gu0 + gu1) / 2, OUT / 2, g), (t, n), (gu1 - gu0, OUT - 0.1, 0.12))   # the step
        # soffit over the recess and the wall to the fascia
        G.quad("conc", P(gu0, 0.05, zg1), P(gu0, OUT, zg1), P(gu1, OUT, zg1), P(gu1, 0.05, zg1), ao=0.6)
        G.quad(wall, P(gu0, OUT, zg1), P(gu1, OUT, zg1), P(gu1, OUT, zg1 + 0.12), P(gu0, OUT, zg1 + 0.12))
        # the fascia: a lit box with the tenant's name, standing out from the wall
        fk = f"rfascia{fi}" if fi in self.real else self.fascia_keys[int(rng.integers(len(self.fascia_keys)))]
        fz0, fz1 = zg1 + 0.15, g + GF - 0.05
        fw = L - 0.4
        G.box("metal_dark", P(0, OUT, fz0 - 0.04), (t, n), (fw + 0.08, 0.5, fz1 - fz0 + 0.08))
        G.quad("glow_atlas", P(-fw / 2, OUT + 0.26, fz0), P(fw / 2, OUT + 0.26, fz0), P(fw / 2, OUT + 0.26, fz1), P(-fw / 2, OUT + 0.26, fz1),
               uv=A.uv(fk), emit=(A.mean[fk], 1.4))
        # an awning or a noren, a menu board, now and then
        if rng.random() < 0.35 and not shut:
            cl = "cloth_noren" if rng.random() < 0.6 else "cloth_red"
            for k in range(3):
                u = -0.75 + k * 0.5
                G.quad(cl, P(u - 0.23, 0.25, zg1 - 0.75), P(u + 0.23, 0.25, zg1 - 0.75), P(u + 0.23, 0.25, zg1 - 0.02), P(u - 0.23, 0.25, zg1 - 0.02))
            G.tube("metal_dark", [P(-0.85, 0.25, zg1 - 0.02), P(0.85, 0.25, zg1 - 0.02)], 0.015, 6)
        if rng.random() < 0.45 and not shut:
            self.menu_board(P(gu1 - 0.6, OUT + 0.45, g), t, n, int(rng.integers(4)))
        # ---- the floors above
        floors = max(0, int((H - GF - 0.9) / STOREY))
        zt = g + H
        # the wall's face: the whole front from the street floor's top to the roof, skin out
        za = g + GF
        G.quad(wall, P(-hl, SKIN, za), P(hl, SKIN, za), P(hl, SKIN, zt), P(-hl, SKIN, zt),
               sub=(max(1, int(L / 0.8)), max(1, int((zt - za) / 0.8))))
        # (the skin's top and ends back to the city's wall)
        G.quad("metal_alu", P(-hl, SKIN + 0.04, zt), P(hl, SKIN + 0.04, zt), P(hl, -0.05, zt + 0.02), P(-hl, -0.05, zt + 0.02))
        G.box("metal_alu", P(0, SKIN + 0.02, zt - 0.02), (t, n), (L + 0.02, 0.12, 0.1))
        for s in (-1, 1):
            u = s * hl
            a, b = (P(u, 0.0, za - GF), P(u, SKIN, za - GF)) if s < 0 else (P(u, SKIN, za - GF), P(u, 0.0, za - GF))
            G.quad(wall, a, b, b + [0, 0, zt - za + GF], a + [0, 0, zt - za + GF])
        G.quad(wall, P(-hl, OUT, g + GF), P(hl, OUT, g + GF), P(hl, SKIN, g + GF + 0.01), P(-hl, SKIN, g + GF + 0.01))
        style = int(rng.integers(3)) if L > 4 else 0
        signs = rng.random() < 0.55
        for k in range(floors):
            zf = g + GF + k * STOREY
            if style == 1:      # a ribbon of glass across the front
                self.window(P, -hl + 0.5, hl - 0.5, zf + 0.85, zf + 2.55, rng, signs and k < 3)
            else:               # punched windows, 1.8 m bays
                nb = max(1, int((L - 0.6) / 1.9))
                bw = (L - 0.6) / nb
                for i in range(nb):
                    u = -hl + 0.3 + (i + 0.5) * bw
                    self.window(P, u - bw * 0.36, u + bw * 0.36, zf + 0.9, zf + 2.45, rng, signs and k < 3 and i == 0)
            # an air conditioner or two on the floor's brackets, a pipe now and then
            for _ in range(int(rng.integers(0, 3))):
                u = -hl + 0.7 + rng.random() * (L - 1.4)
                self.ac(P, u, zf + 0.15, t, n)
        # a drain pipe down one side, a cable run along the street floor's top
        su = (hl - 0.18) * (1 if rng.random() < 0.5 else -1)
        G.tube("metal_white", [P(su, SKIN + 0.08, g), P(su, SKIN + 0.08, zt - 0.2)], 0.05, 8)
        if rng.random() < 0.6:
            zc = g + GF + 0.25 + rng.random() * 0.3
            G.tube("cable", [P(-hl, SKIN + 0.05, zc), P(0, SKIN + 0.05, zc - 0.04), P(hl, SKIN + 0.05, zc)], 0.018, 5)
        # ---- the tenant stack
        if H > 9.0 and L > 4.0:
            self.stack(fi, P, t, n, g, H, rng)

    def window(self, P, u0, u1, z0, z1, rng, sign):
        G, A = self.geo, self.A
        d = SKIN - 0.12   # the glass, set back into the wall
        key = f"room{int(rng.integers(ROOMS))}"
        if sign:
            key = f"wsign{int(rng.integers(8))}"
        G.quad("win_glass", P(u0, d, z0), P(u1, d, z0), P(u1, d, z1), P(u0, d, z1), uv=A.uv(key),
               emit=(A.mean[key], 0.9) if not key.startswith("room") or A.mean[key].sum() > 0.2 else None)
        # the reveals and the frame
        for (a, b) in (((u0, z0), (u1, z0)), ((u1, z0), (u1, z1)), ((u1, z1), (u0, z1)), ((u0, z1), (u0, z0))):
            pa, pb = P(a[0], d, a[1]), P(b[0], d, b[1])
            G.quad("metal_alu", pa, pb, P(b[0], SKIN, b[1]), P(a[0], SKIN, a[1]), ao=0.75)
        G.box("metal_alu", P((u0 + u1) / 2, d + 0.03, z0 - 0.02), ((P(1, 0, 0) - P(0, 0, 0)), (P(0, 1, 0) - P(0, 0, 0))), (u1 - u0, 0.06, z1 - z0 + 0.04), faces=("top",))
        G.box("metal_alu", P((u0 + u1) / 2, SKIN + 0.04, z0 - 0.08), ((P(1, 0, 0) - P(0, 0, 0)), (P(0, 1, 0) - P(0, 0, 0))), (u1 - u0 + 0.1, 0.12, 0.06))
        if u1 - u0 > 1.2:  # a mullion
            um = (u0 + u1) / 2
            G.box("metal_alu", P(um, d + 0.03, z0), ((P(1, 0, 0) - P(0, 0, 0)), (P(0, 1, 0) - P(0, 0, 0))), (0.05, 0.05, z1 - z0))

    def ac(self, P, u, z, t, n):
        G, A = self.geo, self.A
        w, h, dd = 0.8, 0.6, 0.3
        c = P(u, SKIN + 0.05 + dd / 2, z)
        G.box("metal_white", c, (t, n), (w, dd, h), faces=("+u", "-u", "top", "bot", "-v"))
        q = [c + t * (-w / 2) + n * (dd / 2), c + t * (w / 2) + n * (dd / 2), c + t * (w / 2) + n * (dd / 2) + [0, 0, h], c + t * (-w / 2) + n * (dd / 2) + [0, 0, h]]
        G.quad("glow_atlas" if False else "metal_white", *q) if False else self.geo.quad("ac_face", *q, uv=A.uv("ac"))
        for s in (-1, 1):
            G.box("metal_dark", P(u + s * 0.3, SKIN + 0.2, z - 0.04), (t, n), (0.04, 0.4, 0.04))
        # its pipe to the wall
        G.tube("plastic_grey", [P(u + w / 2, SKIN + 0.1, z + 0.2), P(u + w / 2 + 0.15, SKIN + 0.04, z + 0.25), P(u + w / 2 + 0.15, SKIN + 0.04, z + 1.2)], 0.03, 6)

    def stack(self, fi, P, t, n, g, H, rng):
        G, A = self.geo, self.A
        key = f"rstack{fi}" if fi in self.real else self.stack_keys[int(rng.integers(len(self.stack_keys)))]
        u = (rng.random() - 0.5) * 1.0
        z0 = g + GF + 0.2
        z1 = min(g + H - 0.6, z0 + 6 + rng.random() * 9)
        if z1 - z0 < 3.0:
            return
        out, th = 1.25, 0.34
        c = P(u, SKIN, z0)
        G.box("metal_dark", c + n * (out / 2), (t, n), (th, out, z1 - z0), faces=("+v", "top", "bot"))
        col = A.mean[key]
        for s in (-1, 1):   # both faces: the street reads it from both ends
            a = c + t * (s * (th / 2 + 0.005))
            # (counter-clockwise seen from its side, its text the right way round: from +t the wall is on the right)
            if s > 0:
                q = (a + n * out, a + n * 0.06, a + n * 0.06 + [0, 0, z1 - z0], a + n * out + [0, 0, z1 - z0])
            else:
                q = (a + n * 0.06, a + n * out, a + n * out + [0, 0, z1 - z0], a + n * 0.06 + [0, 0, z1 - z0])
            G.quad("glow_atlas", *q, uv=A.uv(key, flip=False), emit=(col, 1.5))
        # its crown and the bracket arms to the wall
        G.box("metal_dark", c + n * (out / 2) + [0, 0, z1 - z0], (t, n), (th + 0.06, out + 0.06, 0.14))
        for z in (z0 + 0.3, z1 - 0.3):
            G.box("metal_dark", P(u, SKIN - 0.1, z), (t, n), (th + 0.1, 0.25, 0.08))
        # an edge of neon down its front, now and then
        if rng.random() < 0.5:
            tube = ["tube_pink", "tube_cyan", "tube_red"][int(rng.integers(3))]
            G.tube(tube, [c + n * (out + 0.04) + [0, 0, 0.1], c + n * (out + 0.04) + [0, 0, z1 - z0 - 0.1]], 0.025, 6)
            G.emitters.append((c + n * (out + 0.1) + [0, 0, (z1 - z0) / 2], n, (z1 - z0) * 0.1, np.array({"tube_pink": (1, .15, .55), "tube_cyan": (.1, .75, 1), "tube_red": (1, .08, .05)}[tube]) * 6.0))

    def menu_board(self, c, t, n, i):
        G, A = self.geo, self.A
        # an A-board facing the street, leaning
        w, h = 0.6, 0.95
        top = c + [0, 0, h]
        lean = n * 0.18
        q = (c - t * (w / 2) + lean, c + t * (w / 2) + lean, top + t * (w / 2), top - t * (w / 2))
        G.quad("glow_atlas", q[1], q[0], q[3], q[2], uv=A.uv(f"menu{i}"))
        G.quad("metal_dark", c - t * (w / 2) - lean, c + t * (w / 2) - lean, top + t * (w / 2), top - t * (w / 2))
        for s in (-1, 1):
            G.tube("metal_dark", [c + t * (s * w / 2) + lean, top + t * (s * w / 2)], 0.015, 4)

    # -- the street
    def ground(self):
        from shapely.geometry import LineString, Point, Polygon
        from shapely.ops import unary_union
        G, A, D = self.geo, self.A, self.D
        ln = self.street
        s0, s1 = ln.project(Point(408.5, Y0)), ln.project(Point(445.0, Y1))
        seg = LineString([ln.interpolate(s).coords[0] for s in np.arange(s0, s1, 1.0)] + [ln.interpolate(s1).coords[0]])
        near = [Polygon(s["ring"]).buffer(0) for s in D.solids if s["top"] > 3.0 and Polygon(s["ring"]).buffer(0).distance(seg) < 30]
        area = seg.buffer(6.5, cap_style=2).difference(unary_union(near).buffer(OUT - 0.05))
        # Yasukuni-dori's pavement in front of the corner buildings either side of the arch, to its kerb
        yasu = LineString(YASU_LINE)
        walk = unary_union([Polygon([f[0] + np.array([-f[1][1], f[1][0]]) * (s * f[2] / 2) + f[1] * d
                                     for s, d in ((-1, OUT - 0.05), (1, OUT - 0.05), (1, 4.6), (-1, 4.6))]).buffer(0.3, join_style=2)
                            for f in self.fronts if f[5] == "yasu"])
        walk = walk.difference(unary_union(near).buffer(OUT - 0.05))
        self.grid(seg, 6.5, area)
        self.grid(yasu, 7.0, walk.difference(area))
        area = area.union(walk)
        self.area = area
        rng = np.random.default_rng(7)
        # manholes down the middle, grates along the gutters, painted marks, stains and puddles
        def flat(mat, c, ax, w, h, uv=None, dz=0.05):
            c = np.array([c[0], c[1], D.ground(*c) + dz])
            u = np.array([ax[0], ax[1], 0.0]); v = np.array([-ax[1], ax[0], 0.0])
            G.quad(mat, c - u * w / 2 - v * h / 2, c + u * w / 2 - v * h / 2, c + u * w / 2 + v * h / 2, c - u * w / 2 + v * h / 2, uv=uv)
        for s in np.arange(9.0, seg.length, 23.0):
            p = np.array(seg.interpolate(s).coords[0]) + rng.normal(0, 0.4, 2)
            flat("ground_iron", p, (1, 0), 0.62, 0.62, uv=A.uv("manhole"))
        for s in np.arange(3.0, seg.length, 4.2):
            p = np.array(seg.interpolate(s).coords[0])
            e = np.array(seg.interpolate(min(seg.length, s + 0.5)).coords[0]) - p
            e = e / (np.linalg.norm(e) or 1)
            lf = np.array([-e[1], e[0]])
            for side in (-1, 1):
                q = p + lf * side * 3.3
                if area.contains(Point(*q)):
                    flat("ground_iron", q, e, 0.9, 0.22, uv=A.uv("grate"), dz=0.048)
        for _ in range(26):     # stains: oil, spilt drinks, old gum
            s = rng.random() * seg.length
            p = np.array(seg.interpolate(s).coords[0]) + rng.normal(0, 1.6, 2)
            if area.contains(Point(*p)):
                r = 0.2 + rng.random() * 0.7
                self.blob("ground_stain", p, r, rng, dz=0.045)
        for _ in range(9):      # shallow puddles where the street dips to its grates
            s = rng.random() * seg.length
            p = np.array(seg.interpolate(s).coords[0]) + rng.normal(0, 2.0, 2)
            if area.contains(Point(*p).buffer(1.2)):
                self.blob("ground_puddle", p, 0.5 + rng.random() * 1.1, rng, dz=0.046, stretch=1.8)

    def grid(self, line, half, area, cell=0.5):
        """Paving on a grid of `cell` m in a line's own frame, kept where its cells' centres are in `area`."""
        from shapely.geometry import Point
        D = self.D
        S = np.arange(0, line.length, cell)
        V = np.arange(-half, half + 1e-6, cell)
        pts = {}
        for i, s in enumerate(S):
            p = np.array(line.interpolate(s).coords[0])
            e = np.array(line.interpolate(min(line.length, s + 0.5)).coords[0]) - np.array(line.interpolate(max(0, s - 0.5)).coords[0])
            e = e / (np.linalg.norm(e) or 1)
            lf = np.array([-e[1], e[0]])
            for j, v in enumerate(V):
                pts[(i, j)] = p + lf * v
        g = self.geo.part("ground_paver")
        idx = {}
        for (i, j), q in pts.items():
            if (i + 1, j + 1) not in pts:
                continue
            c = (q + pts[(i + 1, j + 1)]) / 2
            if not area.contains(Point(*c)):
                continue
            ks = []
            for key in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                if key not in idx:
                    p = pts[key]
                    idx[key] = len(g["p"])
                    g["p"].append(np.array([p[0], p[1], D.ground(*p) + 0.04])); g["n"].append(np.array([0, 0, 1.0]))
                    g["uv"].append((p[0] / 2.0, p[1] / 2.0)); g["ao"].append(1.0)
                ks.append(idx[key])
            # (counter-clockwise from above: along the line, then to its left)
            g["tri"] += [(ks[0], ks[1], ks[2]), (ks[0], ks[2], ks[3])]

    def blob(self, mat, c, r, rng, dz=0.045, stretch=1.0):
        """An irregular flat patch on the ground (a stain, a puddle), as a fan."""
        g = self.geo.part(mat)
        base = len(g["p"])
        z = self.D.ground(*c) + dz
        g["p"].append(np.array([c[0], c[1], z])); g["n"].append(np.array([0, 0, 1.0])); g["uv"].append((0.5, 0.5)); g["ao"].append(1.0)
        k = 18
        ph = rng.random(3) * 6.28
        ang = rng.random() * math.pi
        for i in range(k):
            a = 2 * math.pi * i / k
            rr = r * (1 + 0.25 * math.sin(3 * a + ph[0]) + 0.15 * math.sin(5 * a + ph[1]))
            x, y = math.cos(a) * rr * stretch, math.sin(a) * rr
            x, y = x * math.cos(ang) - y * math.sin(ang), x * math.sin(ang) + y * math.cos(ang)
            g["p"].append(np.array([c[0] + x, c[1] + y, z])); g["n"].append(np.array([0, 0, 1.0])); g["uv"].append((0.5 + x / (2 * r), 0.5 + y / (2 * r))); g["ao"].append(1.0)
        for i in range(k):
            g["tri"].append((base, base + 1 + i, base + 1 + (i + 1) % k))

    # -- what stands on it
    def props(self):
        from shapely.geometry import Point
        G, A, D = self.geo, self.A, self.D
        rng = np.random.default_rng(11)
        ln = self.street
        # vending machines: a cluster of two or three against a pilaster every few fronts
        for fi, f in enumerate(self.fronts):
            mid, n, L, g, top, _ = f
            if rng.random() > 0.3 or L < 5:
                continue
            n3, t3 = np.array([n[0], n[1], 0.0]), np.array([-n[1], n[0], 0.0])
            k = int(rng.integers(1, 4))
            u0 = L / 2 - 0.5 - k * 1.0
            for j in range(k):
                c = np.array([mid[0], mid[1], g]) + t3 * (u0 + j * 1.02 + 0.5) + n3 * (OUT + 0.42)
                if not self.area.contains(Point(c[0], c[1])):
                    continue
                self.vending(c, t3, n3, int(rng.integers(4)))
        # the lantern lamps (kabukicho.lamps' places), finer
        for (x, y, z, h) in kb.lamps(D, [], every=12.0):
            if Y0 < y < Y1 and self.area.distance(Point(x, y)) < 1.0:
                self.lamp(np.array([x, y, z]), h)
        # bins, crates, bicycles, cones, along the fronts
        for fi, f in enumerate(self.fronts):
            mid, n, L, g, top, _ = f
            n3, t3 = np.array([n[0], n[1], 0.0]), np.array([-n[1], n[0], 0.0])
            r = rng.random()
            c = np.array([mid[0], mid[1], g]) + t3 * ((rng.random() - 0.5) * (L - 1.5)) + n3 * (OUT + 0.35)
            if not self.area.contains(Point(c[0], c[1])):
                continue
            if r < 0.25:
                for j in range(int(rng.integers(2, 5))):   # beer crates, stacked
                    G.box(["plastic_yellow", "plastic_red", "plastic_blue"][j % 3], c + t3 * (j // 2) * 0.48 + [0, 0, (j % 2) * 0.3], (t3, n3), (0.45, 0.35, 0.29))
            elif r < 0.4:
                G.cylinder("plastic_blue", c, 0.24, 0.72, 12)       # a ward's bin
                G.cylinder("plastic_grey", c + [0, 0, 0.72], 0.26, 0.06, 12)
            elif r < 0.55:
                self.bicycle(c, t3)
            elif r < 0.62:
                G.cylinder("plastic_red", c, 0.14, 0.7, 8)          # a cone
                G.box("plastic_red", c, (t3, n3), (0.4, 0.4, 0.04))

    def vending(self, c, t, n, kind):
        G, A = self.geo, self.A
        w, d, h = 1.0, 0.75, 1.83
        G.box("metal_white", c - n * 0.0, (t, n), (w, d, h), faces=("+u", "-u", "top", "-v"))
        f = c + n * (d / 2 + 0.005)
        q = (f - t * (w / 2), f + t * (w / 2), f + t * (w / 2) + [0, 0, h], f - t * (w / 2) + [0, 0, h])
        G.quad("glow_vend", *q, uv=A.uv(f"vend{kind}"), emit=(A.mean[f"vend{kind}"], 0.7))
        G.box("plastic_grey", c + n * (d / 2 + 0.12) + [0, 0, 0.0], (t, n), (w * 0.95, 0.04, 0.12))   # the recycling bin's lip
        G.box("plastic_grey", c + n * (d / 2 + 0.2) + t * 0.62, (t, n), (0.3, 0.3, 0.8))

    def lamp(self, c, heading):
        G = self.geo
        G.cylinder("metal_dark", c, 0.13, 0.5, 10)
        G.cylinder("metal_dark", c, 0.075, 4.7, 10, cap=False)
        e = np.array([math.cos(heading), math.sin(heading), 0.0])
        G.tube("metal_dark", [c + [0, 0, 4.55] - e * 0.55, c + [0, 0, 4.55] + e * 0.55], 0.03, 6)
        for s in (-1, 1):
            q = c + e * (s * 0.5) + [0, 0, 3.9]
            G.box("metal_dark", q, (e, np.array([-e[1], e[0], 0])), (0.38, 0.38, 0.05))
            G.box("glow_warm", q + [0, 0, 0.05], (e, np.array([-e[1], e[0], 0])), (0.32, 0.32, 0.43))
            G.box("metal_dark", q + [0, 0, 0.48], (e, np.array([-e[1], e[0], 0])), (0.4, 0.4, 0.08))
            G.tube("metal_dark", [q + [0, 0, 0.56], q + [0, 0, 0.65]], 0.02, 4)
            for k, nn in enumerate(((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0))):
                G.emitters.append((q + [0, 0, 0.27] + np.array(nn) * 0.2, np.array(nn, float), 0.14, np.array([1.0, 0.78, 0.5]) * 3.0))
            G.emitters.append((q + [0, 0, 0.0], np.array([0, 0, -1.0]), 0.1, np.array([1.0, 0.78, 0.5]) * 3.0))

    def bicycle(self, c, t):
        G = self.geo
        e = t
        for s in (-0.52, 0.52):
            w = c + e * s + [0, 0, 0.34]
            pts = [w + (e * math.cos(a) + np.array([0, 0, 1.0]) * math.sin(a)) * 0.33 for a in np.linspace(0, 2 * math.pi, 17)]
            G.tube("rubber", pts, 0.022, 5)
        f = [c + e * -0.52 + [0, 0, 0.34], c + e * -0.05 + [0, 0, 0.36], c + e * 0.35 + [0, 0, 0.8], c + e * -0.15 + [0, 0, 0.82], c + e * -0.05 + [0, 0, 0.36]]
        G.tube("plastic_red", f, 0.02, 5)
        G.tube("plastic_red", [c + e * 0.52 + [0, 0, 0.34], c + e * 0.35 + [0, 0, 0.8], c + e * 0.3 + [0, 0, 0.98]], 0.018, 5)
        G.tube("metal_dark", [c + e * 0.3 + [0, 0, 0.98] - np.cross(e, [0, 0, 1]) * 0.25, c + e * 0.3 + [0, 0, 0.98] + np.cross(e, [0, 0, 1]) * 0.25], 0.015, 4)
        G.box("rubber", c + e * -0.2 + [0, 0, 0.84], (e, np.cross([0, 0, 1], e)), (0.25, 0.12, 0.05))
        G.box("metal_alu", c + e * 0.42 + [0, 0, 0.72], (e, np.cross([0, 0, 1], e)), (0.3, 0.3, 0.2), faces=("+u", "-u", "+v", "-v", "bot"))


def build(K):
    """(geo, atlas, materials, meta) for blender/build_hero.py."""
    L = Level(K, K.Atlas)
    geo, atlas = L.build()
    M = materials()
    M["ac_face"] = {"map": "atlas", "rough": 0.6}
    c = L.street.interpolate(L.street.length * 0.0)
    meta = {"id": ID, "at": [425.0, 2870.0], "r": 85.0, "glb": f"hero/{ID}.glb"}
    return geo, atlas, M, meta
