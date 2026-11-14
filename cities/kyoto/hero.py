"""Kyoto Station's north forecourt and Kyoto Tower's foot, the Kyoto map's hero level (blender/build_hero.py
--city kyoto; docs/HERO.md).

Why here: the game opens outside the station's Karasuma gate, and what everyone photographs from there is
Kyoto Tower over Shiokoji-dori: the forecourt's dark paving and its two map boards under three flagpoles,
the crossing, and the tower's building (Kyoto Tower Building, 1964: nine storeys of dark bronze balcony
bands and ribbon windows, the tower standing on its roof). The level is that view, 110 m deep.

What is built, over the city's own ground and solids:

  * the forecourt: dark granite paving on the plaza's outline, tactile strips to the crossing, steel bollards
    along the kerb, lamp posts, planters with clipped hedges, the two map boards with their direction signs
    and the three flagpoles in front of them;
  * Shiokoji-dori and the foot of Karasuma-dori: asphalt as one surface, a solid centre line, lane dashes,
    stop lines and the four zebras of the junction, flush granite kerbs, the north pavement's paving and
    Kyoto's brown pipe fences along it;
  * Kyoto Tower Building's south and east faces, in front of the city's plain solid: a glazed street floor
    lit from inside between dark piers, under a lit fascia; eight storeys above, each a balcony band of dark
    bronze with its rail over a ribbon of dark glass (rooms lit after dark, drawn), the hotel's name in lit
    letters on the sixth, and a rail round the roof.

The tower itself (shaft, deck, mast) is the city's landmark and stays. Names are the places' own (Kyoto
Tower Hotel, Kyoto Tower Sando); no logo is drawn.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "blender"))

import adkit as ad  # noqa: E402
import hero_open as HP  # noqa: E402
from hero_open import unit  # noqa: E402

ID = "karasuma"
UP = np.array([0.0, 0.0, 1.0])
LIFT = 0.1
ROAD_Y = (-1764.5, -1745.5)          # Shiokoji-dori between its kerbs (two carriageways: OpenStreetMap's lines at -1758.5 and -1750.5)
KARA_X = (-255.5, -239.5)            # Karasuma-dori's foot
PLAZA = (-300.0, -1842.0, -212.0)    # the forecourt: west, south, east (north: the kerb)
TOWER_AT = (-290.0, -1725.0)         # a point inside Kyoto Tower Building's outline
GF, FLOORS = 5.0, 8                  # the street floor's height; the storeys above it

TEX = {
    "plaza": ("Tiles138", 1.6),         # dark granite paving
    "paver": ("PavingStones136", 2.0),  # the north pavement's blocks
    "granite": ("Granite001A", 1.6),    # kerbs and planters
    "road": ("OEAsphalt031m", 3.0),
    "leaf": ("OELeaf001", 1.1),
    "conc": ("Concrete034", 3.0),
}


def materials():
    return {
        "ground_asphalt": {"tex": "road", "tint": (0.33, 0.33, 0.345), "bump": 1.6},
        "ground_patch": {"tex": "road", "tint": (0.27, 0.27, 0.283), "bump": 1.6},
        "ground_white": {"tex": "road", "tint": (1.55, 1.55, 1.48)},
        "ground_plaza": {"tex": "plaza", "tint": (0.5, 0.5, 0.52)},
        "ground_paver": {"tex": "paver", "tint": (0.5, 0.48, 0.45)},
        "ground_kerb": {"tex": "granite", "tint": (0.42, 0.42, 0.41)},
        "ground_tactile": {"tex": "conc", "tint": (0.95, 0.72, 0.1)},
        "ground_iron": {"map": "atlas", "rough": 0.55, "metal": 0.6},
        "granite": {"tex": "granite", "tint": (0.4, 0.4, 0.39)},
        "hedge": {"tex": "leaf", "tint": (0.5, 0.6, 0.45), "bump": 1.5},
        "bronze": {"color": (0.045, 0.036, 0.03), "rough": 0.5, "metal": 0.5},
        "bronze_rail": {"color": (0.03, 0.026, 0.022), "rough": 0.45, "metal": 0.7},
        "pier": {"tex": "plaza", "tint": (0.22, 0.21, 0.2)},
        "metal_dark": {"color": (0.03, 0.032, 0.035), "rough": 0.5, "metal": 0.7},
        "metal_alu": {"color": (0.6, 0.61, 0.62), "rough": 0.4, "metal": 0.9},
        "metal_steel": {"color": (0.55, 0.56, 0.57), "rough": 0.3, "metal": 1.0},
        "metal_brown": {"color": (0.1, 0.06, 0.04), "rough": 0.55, "metal": 0.4},
        "metal_white": {"color": (0.7, 0.7, 0.69), "rough": 0.45, "metal": 0.3},
        "board": {"map": "atlas", "rough": 0.5},
        "glow_win": {"map": "atlas", "color": (0.03, 0.04, 0.05), "rough": 0.08, "emissive": True, "emissive_only": True, "glow": 0.9},
        "glow_shop": {"map": "atlas", "rough": 0.1, "emissive": True, "glow": 0.6},
        "glow_sign": {"map": "atlas", "rough": 0.4, "emissive": True, "glow": 1.0},
        "glow_white": {"color": (0.95, 0.97, 1.0), "emissive": (1.0, 0.95, 0.86), "glow": 2.2},
    }


# ---------------------------------------------------------------- the atlas

def draw_manhole(img, r):
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(58, 58, 60))
    d.ellipse([x + 3, y + 3, x + w - 3, y + h - 3], fill=(38, 36, 34), outline=(84, 80, 74), width=3)
    for k in range(1, 5):
        rr = w * 0.1 * k
        d.ellipse([x + w / 2 - rr, y + h / 2 - rr, x + w / 2 + rr, y + h / 2 + rr], outline=(70, 66, 60), width=2)


def draw_rooms(img, r):
    """A storey's ribbon of windows, eight bays: each a room behind glass, its curtain part drawn, lit or dark."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(64)
    n = 8
    for i in range(n):
        x0, x1 = x + w * i / n, x + w * (i + 1) / n
        lit = rng.random() < 0.4
        base = (236, 196, 138) if lit else (16, 20, 26)
        if lit and rng.random() < 0.25:
            base = (214, 222, 232)
        d.rectangle([x0, y, x1, y + h], fill=base)
        c = rng.uniform(0.15, 0.6)   # a curtain drawn part of the way
        cur = tuple(int(v * 0.82) for v in base) if lit else (30, 34, 40)
        d.rectangle([x0, y, x0 + (x1 - x0) * c, y + h], fill=cur)
        for k in range(int((x1 - x0) * c / 5)):
            d.line([(x0 + k * 5, y), (x0 + k * 5, y + h)], fill=tuple(int(v * 0.9) for v in cur), width=1)
        if lit:
            d.rectangle([x0 + (x1 - x0) * 0.62, y + h * 0.5, x0 + (x1 - x0) * 0.9, y + h * 0.56], fill=(120, 90, 60))   # a desk and its lamp
            d.ellipse([x0 + (x1 - x0) * 0.7, y + h * 0.3, x0 + (x1 - x0) * 0.8, y + h * 0.46], fill=(255, 240, 200))
        d.rectangle([x1 - 2, y, x1, y + h], fill=(20, 18, 16))


def draw_shop(kind):
    """The street floor through its glass: a souvenir arcade's shelves and lanterns, a cafe's counter."""
    def draw(img, r):
        from PIL import ImageDraw
        x, y, w, h = r
        rng = np.random.default_rng(30 + kind)
        d = ImageDraw.Draw(img)
        d.rectangle([x, y, x + w, y + h], fill=(232, 208, 168) if kind % 2 == 0 else (214, 190, 150))
        for i in range(6):
            cx = x + (i + 0.5) * w / 6
            d.ellipse([cx - 10, y + 6, cx + 10, y + 13], fill=(255, 250, 232))
        if kind % 2 == 0:
            pal = [(190, 40, 40), (230, 200, 90), (60, 110, 70), (40, 70, 140), (240, 236, 226), (130, 80, 50), (220, 130, 150)]
            for j in range(4):
                yy = y + h * (0.3 + j * 0.16)
                d.rectangle([x, yy, x + w, yy + 3], fill=(120, 86, 56))
                for i in range(int(w / 10)):
                    c = pal[int(rng.integers(len(pal)))]
                    d.rectangle([x + i * 10 + 1, yy - 15 - rng.integers(0, 6), x + i * 10 + 8, yy], fill=c)
            for i in range(5):   # paper lanterns in a row
                cx = x + (i + 0.5) * w / 5
                d.ellipse([cx - 9, y + h * 0.1, cx + 9, y + h * 0.22], fill=(250, 232, 200), outline=(120, 40, 30))
        else:
            d.rectangle([x, y + h * 0.58, x + w, y + h], fill=(86, 56, 36))
            d.rectangle([x, y + h * 0.22, x + w, y + h * 0.34], fill=(40, 34, 30))
            for i in range(8):
                ad.text(img, (x + (i + 0.5) * w / 8, y + h * 0.28), "茶菓珈琲京抹甘味"[i], "mincho", h * 0.08, fill="#f0e6d0")
            for i in range(6):
                cx = x + (i + 0.5) * w / 6
                d.ellipse([cx - 9, y + h * 0.5, cx + 9, y + h * 0.58], fill=(60, 40, 30))
        d.rectangle([x, y + h * 0.94, x + w, y + h], fill=(70, 66, 60))
    return draw


def draw_fascia(img, r):
    x, y, w, h = r
    from PIL import ImageDraw
    ImageDraw.Draw(img).rectangle([x, y, x + w, y + h], fill=(246, 240, 226))
    ad.text(img, (x + w / 2, y + h / 2), "KYOTO TOWER SANDO", "bebas", h * 0.74, fill="#2a1c14", max_w=w * 0.94)


def draw_hotel(img, r):
    x, y, w, h = r
    from PIL import ImageDraw
    ImageDraw.Draw(img).rectangle([x, y, x + w, y + h], fill=(12, 10, 8))
    ad.text(img, (x + w / 2, y + h / 2), "KYOTO TOWER HOTEL", "bebas", h * 0.86, fill="#fff6e4", max_w=w * 0.97, spacing=4)


def draw_map(kind):
    """A forecourt map board: the city's grid of streets with the river down its east, or the station's
    surroundings; under a dark header with arrows to the buses, the subway and the taxis."""
    def draw(img, r):
        from PIL import ImageDraw
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        d.rectangle([x, y, x + w, y + h], fill=(28, 28, 30))
        hd = h * 0.11
        labels = ("← 市バス", "地下鉄 ↑", "タクシー →") if kind == 0 else ("← 定期観光バス", "駅レンタカー", "JR →")
        for i, s in enumerate(labels):
            ad.text(img, (x + w * (0.18 + 0.32 * i), y + hd * 0.5), s, "zen", hd * 0.42, fill="#f2f2f2", max_w=w * 0.3)
        x0, y0, x1, y1 = x + 8, y + hd + 4, x + w - 8, y + h - 8
        d.rectangle([x0, y0, x1, y1], fill=(216, 228, 204) if kind == 0 else (226, 224, 212))
        n = 11 if kind == 0 else 7
        for i in range(n + 1):
            xx = x0 + (x1 - x0) * i / n
            d.line([(xx, y0), (xx, y1)], fill=(250, 250, 246), width=3 if i % 3 == 0 else 1)
        m = 15 if kind == 0 else 9
        for j in range(m + 1):
            yy = y0 + (y1 - y0) * j / m
            d.line([(x0, yy), (x1, yy)], fill=(250, 250, 246), width=3 if j % 4 == 0 else 1)
        if kind == 0:
            d.line([(x0 + (x1 - x0) * 0.8, y0), (x0 + (x1 - x0) * 0.76, y1)], fill=(120, 170, 214), width=7)      # the Kamo
            d.rectangle([x0 + (x1 - x0) * 0.38, y0 + (y1 - y0) * 0.16, x0 + (x1 - x0) * 0.5, y0 + (y1 - y0) * 0.3], fill=(150, 190, 140))   # the Gosho
            d.rectangle([x0 + (x1 - x0) * 0.2, y0 + (y1 - y0) * 0.38, x0 + (x1 - x0) * 0.27, y0 + (y1 - y0) * 0.44], fill=(150, 190, 140))  # Nijo
        d.line([(x0, y0 + (y1 - y0) * 0.9), (x1, y0 + (y1 - y0) * 0.9)], fill=(90, 90, 96), width=5)                # the railway
        cx, cy = x0 + (x1 - x0) * 0.46, y0 + (y1 - y0) * 0.88
        d.ellipse([cx - 7, cy - 7, cx + 7, cy + 7], fill=(210, 40, 40))
        ad.text(img, (cx, cy - 16), "現在地", "zen", h * 0.028, fill="#c02020")
    return draw


class Level:
    def __init__(self, K):
        self.K = K
        K.TEXTURES.update(TEX)
        HP.leaf_texture(K, "OELeaf001")
        HP.texture_variant(K, "OEAsphalt031m", "Asphalt031", rough=(0.6, 0.5))
        self.geo = K.Geo()
        self.A = K.Atlas(1024, 1024)
        import archkit as ak
        self.T = ak.Terrain("kyoto")
        self.X = HP.Parts(K, self.geo, self.T, self.A)
        self.rng = np.random.default_rng(1964)
        from shapely.geometry import Polygon, Point, box
        from shapely.ops import unary_union
        B = json.load(open(os.path.join(ROOT, "web", "data", "kyoto", "buildings.json")))
        near, self.tower = [], None
        for s in B["s"]:
            r = np.asarray(s[4], float).reshape(-1, 2) / 10
            if abs(r[:, 0].mean() + 270) < 110 and abs(r[:, 1].mean() + 1790) < 90:
                p = Polygon(r).buffer(0)
                near.append(p)
                if p.contains(Point(*TOWER_AT)) and (self.tower is None or p.area > self.tower[0].area):
                    self.tower = (p, s[1] / 10, s[3] / 10)
        self.solids = unary_union([p.buffer(0.15) for p in near])
        self.box = box

    def Gp(self, x, y, h=0.0):
        return self.X.G((x, y), h)

    def build(self):
        A = self.A
        A.cell("rooms", 1016, 120, draw_rooms)
        for k in range(4):
            A.cell(f"shop{k}", 250, 156, draw_shop(k))
        A.cell("fascia", 600, 56, draw_fascia)
        A.cell("hotel", 760, 60, draw_hotel)
        A.cell("map0", 300, 420, draw_map(0))
        A.cell("map1", 300, 420, draw_map(1))
        A.cell("manhole", 128, 128, draw_manhole)
        self.road()
        self.forecourt()
        self.tower_building()
        return self.geo, self.A

    # -- the road
    def road(self):
        X, A, box = self.X, self.A, self.box
        y0, y1 = ROAD_Y
        shio = box(-338.0, y0, -198.0, y1)
        kara = box(KARA_X[0], y1 - 0.5, KARA_X[1], -1706.0)
        self.asphalt = shio.union(kara)
        X.cover("ground_asphalt", self.asphalt, LIFT, cell=2.0)
        m = LIFT + 0.012
        f = lambda d, o, h: self.Gp(d, o, h)          # d: x eastwards; o: y
        g = lambda d, o, h: self.Gp(o, d, h)          # d: y northwards; o: x
        yc = (y0 + y1) / 2
        zeb_x = [(-276.6, -270.6), (-261.5, -256.5), (-238.5, -233.5)]     # the zebras across Shiokoji-dori
        zeb_y = (-1744.6, -1740.0)                                         # and across Karasuma-dori's foot
        runs = [(-338.0, zeb_x[0][0] - 3.5), (zeb_x[0][1] + 3.5, zeb_x[1][0] - 3.5), (zeb_x[2][1] + 3.5, -198.0)]
        for a, b in runs:
            X.strip("ground_white", f, a, b, [yc - 0.08, yc + 0.08], m, step=2.0)
            for yl in (yc - 4.2, yc + 4.2):                                 # lane dashes: 5 m on, 5 m off
                for d in np.arange(a + 1.0, b - 5.0, 10.0):
                    X.strip("ground_white", f, d, d + 5.0, [yl - 0.06, yl + 0.06], m, step=2.5)
            for yl in (y0 + 0.55, y1 - 0.55):                               # edge lines
                X.strip("ground_white", f, a, b, [yl - 0.07, yl + 0.07], m, step=2.0)
            # stop lines before each zebra, on the side the traffic comes from (Japan keeps left: eastbound on the south)
            X.strip("ground_white", f, b + 1.2, b + 1.65, [y0 + 0.6, yc - 0.2], m) if b < -200 else None
            X.strip("ground_white", f, a - 1.65, a - 1.2, [yc + 0.2, y1 - 0.6], m) if a > -338 else None
        for (xa, xb) in zeb_x:
            for o in np.arange(y0 + 0.6, y1 - 0.9, 0.9):
                X.strip("ground_white", f, xa, xb, [o, o + 0.45], m, step=1.0)
        for o in np.arange(KARA_X[0] + 0.6, KARA_X[1] - 0.9, 0.9):
            X.strip("ground_white", g, zeb_y[0], zeb_y[1], [o, o + 0.45], m, step=1.0)
        X.strip("ground_white", g, -1736.0, -1708.0, [(KARA_X[0] + KARA_X[1]) / 2 - 0.08, (KARA_X[0] + KARA_X[1]) / 2 + 0.08], m, step=2.0)
        # patches and ironwork
        for (a, b, o0, o1) in [(-320.0, -296.0, yc + 1.0, yc + 2.6), (-228.0, -210.0, y0 + 1.2, y0 + 3.0), (-292.0, -281.0, y0 + 4.6, y0 + 6.4)]:
            X.strip("ground_patch", f, a, b, [o0, o1], LIFT + 0.006, step=2.0)
        for (x, y) in [(-300.0, yc - 2.2), (-266.0, yc + 2.4), (-246.0, yc - 0.9), (-222.0, yc + 2.0), (-247.0, -1726.0)]:
            X.decal("ground_iron", self.Gp(x, y), (1, 0), 0.66, 0.66, uv=A.uv("manhole"), h=m)
        # flush granite kerbs either side, open at the zebras; the north pavement's blocks and its brown fences
        gaps = zeb_x + [KARA_X]
        for yk, sgn in ((y0, -1), (y1, 1)):
            X.strip("ground_kerb", f, -338.0, -198.0 if sgn < 0 else KARA_X[0], [yk - 0.14, yk + 0.14], LIFT + 0.014, step=2.0)
            if sgn > 0:
                X.strip("ground_kerb", f, KARA_X[1], -198.0, [yk - 0.14, yk + 0.14], LIFT + 0.014, step=2.0)
        north = box(-338.0, y1, -198.0, y1 + 6.0).difference(kara).difference(self.solids)
        X.cover("ground_paver", north, LIFT + 0.004, cell=2.0)
        for yk, sgn in ((y1 + 0.55, 1), (y0 - 0.55, -1)):
            x = -336.0
            while x < -200.0:
                x2 = min(x + 7.5, -200.0)
                if not any(a - 2.0 < x2 and x < b + 2.0 for a, b in gaps) and not (sgn < 0 and -300 < x < -212 and (x + 302) % 22 < 7.5):
                    self.fence(self.Gp(x, yk, LIFT), self.Gp(x2 - 0.5, yk, LIFT))
                x = x2

    def fence(self, a, b):
        """Kyoto's pavement fence: brown posts with two flat rails and a mid rail."""
        G = self.geo
        n = max(1, int(round(np.linalg.norm(b - a) / 1.75)))
        t = unit(b - a)
        nrm = np.array([-t[1], t[0], 0])
        for k in range(n + 1):
            G.box("metal_brown", a + (b - a) * k / n, (t, nrm), (0.07, 0.07, 0.86))
        for z in (0.78, 0.42):
            G.box("metal_brown", (a + b) / 2 + UP * z, (t, nrm), (np.linalg.norm(b - a), 0.035, 0.07))

    # -- the forecourt
    def forecourt(self):
        G, X, A, box = self.geo, self.X, self.A, self.box
        x0, ys, x1 = PLAZA
        yk = ROAD_Y[0]
        plaza = box(x0, ys, x1, yk - 0.14).difference(self.solids)
        X.cover("ground_plaza", plaza, LIFT + 0.004, cell=2.0)
        f = lambda d, o, h: self.Gp(o, d, h)          # d: y; o: x
        e = lambda d, o, h: self.Gp(d, o, h)
        # tactile paving: a line to each zebra and a band along the kerb at it
        for xc in (-273.6, -259.0):
            X.strip("ground_tactile", f, -1800.0, yk - 0.9, [xc - 0.15, xc + 0.15], LIFT + 0.012, step=2.0)
            X.strip("ground_tactile", e, xc - 2.4, xc + 2.4, [yk - 0.9, yk - 0.3], LIFT + 0.012, step=1.0)
        X.strip("ground_tactile", e, -273.6, -259.0, [-1800.15, -1799.85], LIFT + 0.012, step=2.0)
        # steel bollards along the kerb, between the fences
        for x in np.arange(-298.0, -213.0, 1.5):
            if (x + 302) % 22 < 7.5 and not any(a - 0.4 < x < b + 0.4 for a, b in ((-276.6, -270.6), (-261.5, -256.5), (-238.5, -233.5))):
                X.bollard(self.Gp(x, yk - 0.6, LIFT), 0.75, mat="metal_steel", r=0.06)
        # the two map boards with their direction headers, the stand between them, the three flagpoles
        south = (0.0, -1.0)
        for k, xb in enumerate((-268.6, -256.0)):
            c = self.Gp(xb, -1787.0, LIFT)
            for s in (-1.3, 1.3):
                G.box("metal_dark", c + np.array([s, 0, 0]), ((1, 0, 0), (0, 1, 0)), (0.12, 0.16, 3.7))
            G.box("metal_dark", c + UP * 3.62, ((1, 0, 0), (0, 1, 0)), (2.9, 0.34, 0.1))
            G.box("metal_dark", c + UP * 0.25, ((1, 0, 0), (0, 1, 0)), (2.6, 0.5, 0.3))
            X.panel("board", c + UP * 2.02 + np.array([0, -0.09, 0]), south, (2.44, 3.1), f"map{k}", back="metal_dark")
        c = self.Gp(-262.3, -1789.5, LIFT)
        G.box("metal_alu", c, ((1, 0, 0), (0, 1, 0)), (0.9, 0.5, 0.08))
        X.panel("metal_white", c + UP * 0.85 + np.array([0, -0.03, 0]), south, (0.8, 1.2), None, back="metal_alu")
        for xp in (-270.4, -262.3, -254.4):
            p = self.Gp(xp, -1784.2, LIFT)
            G.cylinder("metal_white", p, 0.11, 0.5, 12)
            G.tube("metal_white", [p + UP * 0.5, p + UP * 5.0, p + UP * 9.6], 0.055, 10)
            G.cylinder("metal_steel", p + UP * 9.6, 0.09, 0.12, 10)
        # planters: granite boxes with a clipped hedge, either side of the way to the main zebra
        for (xa, xb, yy) in ((-296.0, -280.0, -1771.0), (-251.0, -241.0, -1771.0), (-230.0, -216.0, -1771.0)):
            a, b = self.Gp(xa, yy, LIFT), self.Gp(xb, yy, LIFT)
            G.box("granite", (a + b) / 2, ((1, 0, 0), (0, 1, 0)), (xb - xa, 1.5, 0.45), faces=("+u", "-u", "+v", "-v", "top"))
            X.hedge("hedge", [a + np.array([0.5, 0, 0.42]), b + np.array([-0.5, 0, 0.42])], 1.15, 0.6, seed=int(-xa))
        # lamp posts: slim dark columns with a ring of light, which the bake takes
        for (x, y) in ((-284.0, -1790.0), (-246.0, -1790.0), (-286.0, -1768.5), (-264.5, -1768.5), (-226.0, -1790.0), (-246.0, -1814.0)):
            self.lamp(self.Gp(x, y, LIFT))
        for (x, y) in ((-296.0, -1742.6), (-268.0, -1742.6), (-232.0, -1742.6)):
            self.lamp(self.Gp(x, y, LIFT), h=5.2)

    def lamp(self, c, h=6.4):
        G = self.geo
        G.cylinder("metal_dark", c, 0.1, 0.6, 10)
        G.tube("metal_dark", [c + UP * 0.6, c + UP * h], 0.06, 10)
        G.cylinder("glow_white", c + UP * (h - 0.75), 0.13, 0.6, 12, cap=False)
        G.cylinder("metal_dark", c + UP * (h - 0.15), 0.2, 0.06, 12)
        for k in range(6):
            a = 2 * math.pi * k / 6
            n = np.array([math.cos(a), math.sin(a), -0.35])
            G.emitters.append((c + UP * (h - 0.45) + n * 0.15, unit(n), 0.12, np.array([1.0, 0.92, 0.8]) * 260.0))
        G.emitters.append((c + UP * (h - 0.8), -UP, 0.2, np.array([1.0, 0.92, 0.8]) * 330.0))

    # -- Kyoto Tower Building
    def tower_building(self):
        """Its faces towards the forecourt and Karasuma-dori: every edge of its outline that looks south or
        east, dressed from the pavement to the roof in front of the city's solid."""
        G, A, X = self.geo, self.A, self.X
        poly, base, hgt = self.tower
        co = np.asarray(poly.exterior.coords)[:-1]
        if poly.exterior.is_ccw:
            co = co[::-1]                                # clockwise: the outside is on the left... the wall() faces right
        top = base + hgt
        fh = (hgt - GF) / FLOORS
        rng = self.rng
        n = len(co)
        k_shop = 0
        for i in range(n):
            a, b = co[i], co[(i + 1) % n]
            L = float(np.linalg.norm(b - a))
            u = (b - a) / L
            out = np.array([-u[1], u[0]])                # clockwise ring: the outside is on the left of the way round
            mid = (a + b) / 2
            if L < 2.0 or not (out[1] < -0.3 or out[0] > 0.3) or mid[1] > -1708.0 and out[0] <= 0.3:
                continue
            if poly.contains(__import__("shapely.geometry", fromlist=["Point"]).Point(*(mid + out * 0.5))):
                out = -out
            u3, o3 = np.r_[u, 0], np.r_[out, 0]
            z0 = self.T(*(mid + out * 1.0)) + LIFT
            P = lambda s, d, z: np.r_[a + u * s + out * d, z]
            # the street floor: dark piers every 6.4 m, glass onto the lit arcade between them, a lit fascia over it
            nb = max(1, int(round(L / 6.4)))
            bw = L / nb
            for j in range(nb + 1):
                G.box("pier", P(j * bw, 0.3, z0), (u3, o3), (0.7, 0.6, GF - 0.9))
            for j in range(nb):
                s0, s1 = j * bw + 0.35, (j + 1) * bw - 0.35
                q = (P(s1, 0.12, z0 + 0.25), P(s0, 0.12, z0 + 0.25), P(s0, 0.12, z0 + GF - 1.0), P(s1, 0.12, z0 + GF - 1.0))
                key = f"shop{k_shop % 4}"
                k_shop += 1
                uv = A.uv(key)
                G.quad("glow_shop", *q, uv=uv, n=o3, emit=(A.mean[key], 1.4))
                G.box("pier", P((s0 + s1) / 2, 0.14, z0), (u3, o3), (s1 - s0, 0.2, 0.25))
                for t in (0.33, 0.66):
                    G.box("metal_dark", P(s0 + (s1 - s0) * t, 0.15, z0 + 0.25), (u3, o3), (0.05, 0.06, GF - 1.25))
            G.box("bronze", P(L / 2, 0.55, z0 + GF - 0.95), (u3, o3), (L + 0.2, 1.1, 0.95))
            if L > 14:
                fw = min(L * 0.5, 15.0)
                q = (P(L / 2 + fw / 2, 1.115, z0 + GF - 0.82), P(L / 2 - fw / 2, 1.115, z0 + GF - 0.82), P(L / 2 - fw / 2, 1.115, z0 + GF - 0.13), P(L / 2 + fw / 2, 1.115, z0 + GF - 0.13))
                uv = A.uv("fascia")
                G.quad("glow_sign", *q, uv=uv, n=o3, emit=(A.mean["fascia"], 2.0))
            # the storeys: a balcony band of bronze with its rail, a ribbon of windows over it
            for k in range(FLOORS):
                zf = z0 + GF + k * fh
                G.box("bronze", P(L / 2, 0.4, zf - 0.1), (u3, o3), (L + 0.1, 0.8, 0.95))
                G.box("bronze_rail", P(L / 2, 0.76, zf + 1.02), (u3, o3), (L + 0.1, 0.05, 0.05))
                for s in np.arange(0.4, L, 1.6):
                    G.box("bronze_rail", P(s, 0.76, zf + 0.85), (u3, o3), (0.03, 0.03, 0.2))
                nrep = max(1, int(round(L / 25.6)))                # the drawn ribbon is eight bays of 3.2 m
                uv = A.uv("rooms")
                shift = rng.random()
                for rp in range(nrep):
                    s0, s1 = L * rp / nrep, L * (rp + 1) / nrep
                    q = (P(s1, 0.08, zf + 0.85), P(s0, 0.08, zf + 0.85), P(s0, 0.08, zf + fh - 0.1), P(s1, 0.08, zf + fh - 0.1))
                    uu = uv if (rp + k) % 2 else A.sub("rooms", 0, 1)
                    G.quad("glow_win", *q, uv=uu, n=o3)
                for s in np.arange(0.0, L + 0.01, 3.2):
                    G.box("bronze_rail", P(min(s, L), 0.12, zf + 0.85), (u3, o3), (0.09, 0.1, fh - 0.95))
                if k == 4 and out[1] < -0.9 and L > 30:            # the hotel's name on the sixth storey's band
                    w = 19.0
                    q = (P(L / 2 + w / 2, 0.812, zf - 0.02), P(L / 2 - w / 2, 0.812, zf - 0.02), P(L / 2 - w / 2, 0.812, zf + 0.78), P(L / 2 + w / 2, 0.812, zf + 0.78))
                    uv2 = A.uv("hotel")
                    G.quad("glow_sign", *q, uv=uv2, n=o3)
            # the roof's edge: a last band and a rail
            G.box("bronze", P(L / 2, 0.4, top + LIFT - 0.1), (u3, o3), (L + 0.1, 0.8, 0.6))
            G.box("bronze_rail", P(L / 2, 0.7, top + LIFT + 1.5), (u3, o3), (L, 0.05, 0.05))
            for s in np.arange(0.2, L, 2.0):
                G.box("bronze_rail", P(s, 0.7, top + LIFT + 0.5), (u3, o3), (0.04, 0.04, 1.0))
            self.geo.walls.append((a + out * 0.3, b + out * 0.3, z0, z0 + GF))


def build(K):
    """(geo, atlas, materials, meta) for blender/build_hero.py."""
    L = Level(K)
    geo, atlas = L.build()
    meta = {"id": ID, "at": [-262.0, -1780.0], "r": 75.0, "z": 29.0, "glb": f"hero/{ID}.glb", "bake_gain": 1.0}
    return geo, atlas, materials(), meta
