"""Nissaka and the Kamakurakokomae crossing, the Kamakura map's hero level (blender/build_hero.py --city
kamakura; docs/HERO.md).

Why here: the game opens on the hill road (日坂) 46 m above the Enoden's crossing 鎌倉高校前1号踏切, looking
down it to Route 134 and the bay: the most photographed 60 metres of the coast, and all of it in the first
frame. The level is that view and nothing behind it: the road from Route 134 up past the spawn, the two
lanes that meet it, Route 134 either side of the junction, and what stands along them.

What is built, over the city's own set (cities/kamakura/city.py), from the photographs listed in
docs/HERO.md and the set's measured profiles (set.json: every road's centre line each metre on GSI's 5 m
laser terrain):

  * the road: fine asphalt with its trench patches and sealed cracks, the white edge lines, the zebra and
    the stop lines, the crossing's yellow deck with its green strip for people on foot and the rails'
    flangeways, manholes, the long grate across the lane's mouth, a kerb and a raised pavement on the west;
  * the east side: the dark rubble retaining wall under the house at the crossing's corner, battered, with
    the tan stone facing, the garage's shutter and the glass balustrade over it; a low stone wall and a
    grass bank above the lane;
  * the west side: the pavement's block wall with a clipped hedge and a timber rail, the two notice boards,
    the orange post of the convex mirror, bollards;
  * overhead: concrete utility poles with their crossarms, insulators, a transformer and street lights, and
    the wires between them, the sagging bundle across the road that every photograph of the place has;
  * the signs: the school crossing's blue pentagon, no parking, the pipe fences and warning boards by the track;
  * Route 134 at the foot: asphalt with a solid centre line and edge lines, and the promenade's paving.

The gates, lamps, bell, track bed, catenary and trains stay the railway's (web/game/rail.js); the sea wall,
the beach steps and Enoshima the city's. No character, frame or art of any anime is in it: the place only.
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
from hero_open import Path, unit  # noqa: E402

ID = "nissaka"
HILL, SIDE, LANE, R134, PROM = "165632713_16", "1340191882_17", "436897489_12", "379988026_18", "390566771_14"
XING = (-446.2, 122.2)
HW = 3.1                 # the hill road's half width between its kerb and the wall's foot
LIFT = 0.095             # the level's asphalt over the ground (the city's own paving lies 0.04-0.05 over it)
UP = np.array([0.0, 0.0, 1.0])

TEX = {
    "rubble": ("Bricks089", 2.4),     # dark random rubble in mortar: the retaining wall at the crossing
    "block": ("Bricks066", 2.2),      # grey split-face blocks: the pavement's wall
    "facing": ("Tiles143", 1.8),      # tan stone facing: the garage over the rubble
    "grass": ("OEGrass004m", 2.2),    # the banks (ambientCG Grass004, its gloss taken off: hero_open.texture_variant)
    "leaf": ("OELeaf001", 1.1),       # the hedges' and shrubs' faces (drawn: hero_open.leaf_texture)
    "road": ("OEAsphalt031m", 3.0),   # the road (ambientCG Asphalt031, rougher)
}


def materials():
    return {
        "ground_asphalt": {"tex": "road", "tint": (0.33, 0.33, 0.345), "bump": 1.6},
        "ground_patch": {"tex": "road", "tint": (0.27, 0.27, 0.283), "bump": 1.6},
        "ground_old": {"tex": "road", "tint": (0.385, 0.38, 0.37), "bump": 1.6},
        "ground_white": {"tex": "road", "tint": (1.55, 1.55, 1.48)},
        "ground_yellow": {"tex": "road", "tint": (1.55, 1.05, 0.2)},
        "ground_orange": {"tex": "road", "tint": (1.3, 0.6, 0.15)},
        "ground_green": {"tex": "road", "tint": (0.3, 0.95, 0.52)},
        "ground_pave": {"tex": "conc", "tint": (0.33, 0.325, 0.31)},
        "ground_kerb": {"tex": "conc", "tint": (0.3, 0.3, 0.29)},
        "ground_seal": {"color": (0.012, 0.012, 0.013), "rough": 0.75, "alpha": 0.8},
        "ground_iron": {"map": "atlas", "rough": 0.55, "metal": 0.6},
        "ground_groove": {"color": (0.02, 0.02, 0.02), "rough": 0.8},
        "ground_rail": {"color": (0.42, 0.38, 0.34), "rough": 0.3, "metal": 1.0},
        "ground_grass": {"tex": "grass", "tint": (0.5, 0.56, 0.4)},
        "wall_rubble": {"tex": "rubble", "tint": (0.42, 0.43, 0.47), "bump": 1.5},
        "wall_block": {"tex": "block", "tint": (0.6, 0.58, 0.55), "bump": 1.5},
        "wall_facing": {"tex": "facing", "tint": (0.5, 0.47, 0.42)},
        "conc": {"tex": "conc", "tint": (0.36, 0.36, 0.35)},
        "pole": {"tex": "conc", "tint": (0.31, 0.31, 0.3)},
        "hedge": {"tex": "leaf", "tint": (0.55, 0.62, 0.5), "bump": 1.5},
        "shrub": {"tex": "leaf", "tint": (0.72, 0.74, 0.5), "bump": 1.5},
        "timber": {"color": (0.2, 0.13, 0.08), "rough": 0.85},
        "shutter": {"color": (0.5, 0.51, 0.5), "rough": 0.5, "metal": 0.5},
        "glass": {"color": (0.55, 0.72, 0.74), "rough": 0.06, "alpha": 0.32},
        "metal_dark": {"color": (0.03, 0.032, 0.035), "rough": 0.5, "metal": 0.7},
        "metal_alu": {"color": (0.6, 0.61, 0.62), "rough": 0.4, "metal": 0.9},
        "metal_galv": {"color": (0.42, 0.44, 0.45), "rough": 0.6, "metal": 0.6},
        "metal_green": {"color": (0.1, 0.26, 0.17), "rough": 0.5, "metal": 0.3},
        "paint_orange": {"color": (0.85, 0.24, 0.03), "rough": 0.5},
        "mirror": {"color": (0.5, 0.53, 0.56), "rough": 0.12, "metal": 1.0},
        "porcelain": {"color": (0.8, 0.79, 0.75), "rough": 0.3},
        "cable": {"color": (0.012, 0.012, 0.013), "rough": 0.6},
        "board": {"map": "atlas", "rough": 0.45},
        "glow_white": {"color": (0.95, 0.97, 1.0), "emissive": (0.92, 0.96, 1.0), "glow": 2.2},
    }


# ---------------------------------------------------------------- the atlas: what is drawn

def draw_manhole(img, r):
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(58, 58, 60))
    d.ellipse([x + 3, y + 3, x + w - 3, y + h - 3], fill=(38, 36, 34), outline=(84, 80, 74), width=3)
    c = (x + w / 2, y + h / 2)
    for k in range(1, 5):
        rr = w * 0.1 * k
        d.ellipse([c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr], outline=(70, 66, 60), width=2)
    for a in range(0, 360, 30):
        e = (c[0] + math.cos(math.radians(a)) * w * 0.44, c[1] + math.sin(math.radians(a)) * w * 0.44)
        d.line([c, e], fill=(60, 56, 52), width=2)
    d.ellipse([c[0] - 9, c[1] - 9, c[0] + 9, c[1] + 9], fill=(52, 48, 44))


def draw_grate(img, r):
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(70, 68, 64))
    d.rectangle([x + 2, y + 2, x + w - 2, y + h - 2], fill=(14, 14, 14))
    for i in range(int(w / 6)):
        d.rectangle([x + 3 + i * 6, y + 3, x + 6 + i * 6, y + h - 3], fill=(66, 62, 56))
    for j in (0.33, 0.66):
        d.rectangle([x + 2, y + h * j - 1, x + w - 2, y + h * j + 1], fill=(60, 56, 52))


def draw_school(img, r):
    """The pedestrian crossing's sign (407-A): a blue pentagon, two figures on the bars (drawn, not a copy)."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(120, 124, 126))
    pent = [(x + w / 2, y + 2), (x + w - 3, y + h * 0.42), (x + w - 3, y + h - 3), (x + 3, y + h - 3), (x + 3, y + h * 0.42)]
    d.polygon(pent, fill=(235, 238, 240))
    q = [(x + w / 2, y + 10), (x + w - 9, y + h * 0.44), (x + w - 9, y + h - 9), (x + 9, y + h - 9), (x + 9, y + h * 0.44)]
    d.polygon(q, fill=(18, 78, 168))
    for cx, s in ((x + w * 0.38, 1.0), (x + w * 0.63, 0.82)):
        cy = y + h * 0.5
        d.ellipse([cx - 7 * s, cy - 22 * s, cx + 7 * s, cy - 8 * s], fill=(245, 245, 245))
        d.polygon([(cx - 9 * s, cy - 6 * s), (cx + 9 * s, cy - 6 * s), (cx + 12 * s, cy + 18 * s), (cx - 12 * s, cy + 18 * s)], fill=(245, 245, 245))
        d.line([(cx - 5 * s, cy + 18 * s), (cx - 10 * s, cy + 38 * s)], fill=(245, 245, 245), width=int(5 * s))
        d.line([(cx + 5 * s, cy + 18 * s), (cx + 12 * s, cy + 38 * s)], fill=(245, 245, 245), width=int(5 * s))
    for i in range(4):
        d.rectangle([x + 16 + i * (w - 32) / 4, y + h - 22, x + 16 + i * (w - 32) / 4 + (w - 32) / 8, y + h - 14], fill=(245, 245, 245))


def draw_nopark(img, r):
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(120, 124, 126))
    d.ellipse([x + 2, y + 2, x + w - 2, y + h - 2], fill=(200, 28, 30))
    d.ellipse([x + 14, y + 14, x + w - 14, y + h - 14], fill=(22, 62, 150))
    d.line([(x + w * 0.24, y + h * 0.24), (x + w * 0.76, y + h * 0.76)], fill=(200, 28, 30), width=12)


def draw_map(img, r):
    """A neighbourhood map board: the coast, the line and the roads, schematically."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(238, 236, 226))
    d.rectangle([x, y, x + w, y + h * 0.1], fill=(30, 84, 60))
    ad.text(img, (x + w / 2, y + h * 0.05), "周辺案内図", "zen", h * 0.06, fill="#ffffff")
    d.polygon([(x, y + h * 0.62), (x + w, y + h * 0.72), (x + w, y + h), (x, y + h)], fill=(120, 176, 214))
    d.polygon([(x, y + h * 0.1), (x + w, y + h * 0.1), (x + w, y + h * 0.5), (x, y + h * 0.38)], fill=(186, 214, 160))
    d.line([(x, y + h * 0.56), (x + w, y + h * 0.66)], fill=(90, 90, 90), width=4)
    d.line([(x, y + h * 0.6), (x + w, y + h * 0.7)], fill=(240, 200, 70), width=5)
    for k in range(7):
        xx = x + w * (0.08 + 0.14 * k)
        d.line([(xx, y + h * 0.14), (xx + w * 0.05, y + h * 0.58)], fill=(250, 250, 250), width=3)
    for k in range(3):
        d.line([(x, y + h * (0.2 + 0.1 * k)), (x + w, y + h * (0.26 + 0.1 * k))], fill=(250, 250, 250), width=3)
    d.ellipse([x + w * 0.5 - 7, y + h * 0.6 - 7, x + w * 0.5 + 7, y + h * 0.6 + 7], fill=(210, 40, 40))
    ad.text(img, (x + w * 0.5, y + h * 0.53), "現在地", "zen", h * 0.035, fill="#c02020")
    ad.text(img, (x + w * 0.25, y + h * 0.86), "相模湾", "mincho", h * 0.05, fill="#2a5a88")


def draw_rules(img, r):
    """The manners board by the crossing: three coloured rows, a pictogram each (our own wording)."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(240, 240, 236))
    ad.text(img, (x + w / 2, y + h * 0.07), "マナーを守って観光を", "zen", h * 0.055, fill="#202020", max_w=w * 0.92)
    ad.text(img, (x + w / 2, y + h * 0.14), "PLEASE KEEP OFF THE ROAD", "anton", h * 0.04, fill="#202020", max_w=w * 0.9)
    rows = [((40, 120, 120), "車道に出ない"), ((200, 120, 40), "線路に入らない"), ((60, 140, 70), "通行のさまたげをしない")]
    for i, (c, s) in enumerate(rows):
        y0 = y + h * (0.2 + i * 0.26)
        d.rectangle([x + 8, y0, x + w - 8, y0 + h * 0.23], fill=c)
        cx, cy, rr = x + w * 0.2, y0 + h * 0.115, h * 0.085
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(250, 250, 250), outline=(210, 30, 30), width=7)
        d.line([(cx - rr * 0.7, cy - rr * 0.7), (cx + rr * 0.7, cy + rr * 0.7)], fill=(210, 30, 30), width=7)
        d.ellipse([cx - 6, cy - rr * 0.55, cx + 6, cy - rr * 0.55 + 12], fill=(30, 30, 30))
        d.rectangle([cx - 5, cy - rr * 0.2, cx + 5, cy + rr * 0.5], fill=(30, 30, 30))
        ad.text(img, (x + w * 0.63, cy), s, "zen", h * 0.05, fill="#ffffff", max_w=w * 0.56)


def draw_keepout(img, r):
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(244, 244, 240))
    d.rectangle([x + 3, y + 3, x + w - 3, y + h - 3], outline=(200, 30, 30), width=4)
    ad.vtext(img, (x + w * 0.5, y + h * 0.06), "線路内立入禁止", "zen", h * 0.115, fill="#c81e1e")


def draw_danger(img, r):
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(250, 214, 40))
    d.rectangle([x + 3, y + 3, x + w - 3, y + h - 3], outline=(20, 20, 20), width=3)
    ad.text(img, (x + w / 2, y + h * 0.3), "ふみきり", "zen", h * 0.2, fill="#141414", max_w=w * 0.86)
    ad.text(img, (x + w / 2, y + h * 0.68), "ちゅうい", "zen", h * 0.2, fill="#c81e1e", max_w=w * 0.86)


class Level:
    def __init__(self, K):
        self.K = K
        K.TEXTURES.update(TEX)
        HP.leaf_texture(K, "OELeaf001")
        HP.texture_variant(K, "OEGrass004m", "Grass004", rough=(0.35, 0.72), gain=0.9)
        HP.texture_variant(K, "OEAsphalt031m", "Asphalt031", rough=(0.6, 0.5))
        self.geo = K.Geo()
        self.A = K.Atlas(1024, 1024)
        import archkit as ak
        self.T = ak.Terrain("kamakura")
        self.X = HP.Parts(K, self.geo, self.T, self.A)
        R = json.load(open(os.path.join(HERE, "set.json")))["roads"]
        self.hill = Path(R[HILL]["p"], XING)                    # d: metres up the hill from the crossing; right: east
        self.side = Path(R[SIDE]["p"][::-1])                    # from its mouth on the hill road, east and up
        self.lane = Path(R[LANE]["p"][::-1])                    # from the spawn's fork, south-east and up
        self.r134 = Path(R[R134]["p"], XING)                    # eastwards; right: the sea
        self.prom = Path(R[PROM]["p"], XING)
        g = json.load(open(os.path.join(ROOT, "web", "data", "kamakura", "game.json")))["rail"]["train"]
        ln = np.asarray(g["lines"][0]["p"], float).reshape(-1, 3) / 10
        k = int(np.argmin(np.hypot(ln[:, 0] - XING[0], ln[:, 1] - XING[1])))
        self.track = Path(ln[max(k - 30, 0):k + 31], XING)      # eastwards along the rails
        self.rng = np.random.default_rng(134)

    # -- frames
    def H(self, d, o, h=0.0):
        """A point on the ground d up the hill road, o east of its centre line, h over the ground."""
        return self.X.G(self.hill.xy(d, o), h)

    def HZ(self, d, o, h=0.0):
        """The same at the road's own level (its centre line's), for what stands beside it."""
        c, t, r = self.hill.at(d)
        q = c[:2] + r * o
        return np.array([q[0], q[1], c[2] + h])

    def wide(self, d):
        """The west pavement's width: wider at its foot, where the boards stand."""
        return 2.3 + 2.2 * float(np.clip((9.0 - d) / 6.0, 0, 1))

    # -- the level
    def build(self):
        A = self.A
        A.cell("manhole", 160, 160, draw_manhole)
        A.cell("grate", 256, 48, draw_grate)
        A.cell("school", 192, 192, draw_school)
        A.cell("nopark", 160, 160, draw_nopark)
        A.cell("map", 320, 400, draw_map)
        A.cell("rules", 320, 400, draw_rules)
        A.cell("keepout", 96, 384, draw_keepout)
        A.cell("danger", 192, 128, draw_danger)
        self.outlines()
        self.ground()
        self.crossing()
        self.east()
        self.west()
        self.overhead()
        self.route134()
        return self.geo, self.A

    def outlines(self):
        """What lies where, as outlines: the asphalt (the hill road and the lanes that meet it, as one),
        Route 134, the pavement, the houses, the track's corridor; the green takes the rest."""
        from shapely.geometry import Polygon, box, LineString
        from shapely.ops import unary_union
        hill = self.hill.band(-8.6, 66.0, -HW - 0.2, HW + 0.55)
        side = self.side.band(0.0, 34.0, -3.3, 3.3)
        lane = self.lane.band(0.0, 30.0, -2.5, 2.5)
        self.road = unary_union([hill, side, lane]).buffer(1.2, join_style=1).buffer(-1.2, join_style=1)   # (the mouths rounded)
        self.r134_poly = self.r134.band(-52.0, 52.0, -4.8, 4.8, step=2.0)
        ds = np.arange(-0.2, 45.01, 1.0)
        self.pave = Polygon([self.hill.xy(d, -HW - 0.18) for d in ds] + [self.hill.xy(d, -HW - self.wide(d)) for d in ds[::-1]])
        B = json.load(open(os.path.join(ROOT, "web", "data", "kamakura", "buildings.json")))
        houses = []
        for s in B["s"]:
            r = np.asarray(s[4], float).reshape(-1, 2) / 10
            if abs(r[:, 0].mean() + 444) < 50 and abs(r[:, 1].mean() - 155) < 50:
                houses.append(Polygon(r).buffer(0.25))
        self.houses = unary_union(houses)
        tr = LineString(self.track.p[:, :2])
        self.corridor = tr.buffer(2.7, cap_style=2)
        # the green: north of the track, round the roads, to where the view from the spawn ends
        north = Polygon(list(tr.coords) + [(-405, 196), (-478, 196)]).buffer(0)
        area = box(-476, 118, -408, 194).intersection(north)
        self.green = area.difference(unary_union([self.road.buffer(-0.12), self.pave.buffer(0.05), self.houses, self.corridor]))

    def ground(self):
        G, A, H, X, rng = self.geo, self.A, self.H, self.X, self.rng
        D1 = 66.0
        # the asphalt: one surface on the terrain, the lanes with the hill road; then the green round it, a little lower
        X.cover("ground_asphalt", self.road, LIFT, uvk=1.0)
        X.cover("ground_grass", self.green, 0.055, cell=1.5, uvk=1.0)
        # trench patches (darker, newer asphalt) and older, paler strips: a Japanese road is a patchwork
        for (d0, d1, o0, o1, mat) in [(11.0, 24.0, 0.5, 1.5, "ground_patch"), (30.0, 33.0, -2.6, 0.8, "ground_patch"), (38.0, 52.0, -1.9, -1.1, "ground_old"),
                                      (-7.0, -3.2, -2.9, 2.9, "ground_patch"), (54.0, 57.5, 0.2, 2.7, "ground_old"), (24.0, 29.0, -2.9, -1.6, "ground_old"),
                                      (41.0, 44.0, 0.9, 3.0, "ground_patch"), (58.0, 66.0, -1.0, 0.3, "ground_patch")]:
            X.strip(mat, H, d0, d1, [o0, o1], LIFT + 0.006)
        for k in range(16):
            d, o, w, l = rng.uniform(8, 62), rng.uniform(-2.7, 2.0), rng.uniform(0.5, 1.6), rng.uniform(1.2, 6.0)
            X.strip(("ground_patch", "ground_old")[k % 2], H, d, d + l, [o, min(o + w, HW - 0.1)], LIFT + 0.004 + 0.0005 * k)
        f = lambda d, o, h: X.G(self.side.xy(d, o), h)
        X.strip("ground_patch", f, 3.0, 14.0, [-0.6, 0.7], LIFT + 0.006)
        f2 = lambda d, o, h: X.G(self.lane.xy(d, o), h)
        X.strip("ground_old", f2, 4.0, 22.0, [-2.3, -0.9], LIFT + 0.006)
        # sealed cracks: thin black lines that wander
        for k in range(12):
            d, o = rng.uniform(8, 62), rng.uniform(-2.4, 2.4)
            for _ in range(int(rng.integers(4, 9))):
                d2, o2 = d + rng.uniform(0.5, 1.1), float(np.clip(o + rng.uniform(-0.4, 0.4), -2.8, 2.8))
                a, b = H(d, o, LIFT + 0.009), H(d2, o2, LIFT + 0.009)
                t = unit(b - a)
                r = np.array([t[1], -t[0], 0]) * 0.013
                G.quad("ground_seal", a - r, a + r, b + r, b - r, n=UP)
                d, o = d2, o2
        # the edge lines, the zebra above the crossing and the stop lines either side of it
        m = LIFT + 0.012
        for o in (-HW + 0.3, HW - 0.25):
            X.strip("ground_white", H, 9.6 if o < 0 else 20.5, D1, [o - 0.075, o + 0.075], m)
        X.strip("ground_white", H, 9.6, 13.6, [HW - 0.325, HW - 0.175], m)
        for o in np.arange(-HW + 0.6, HW - 0.5, 0.9):
            X.strip("ground_white", H, 6.3, 9.2, [o, o + 0.45], m)
        for d in (4.4, -4.4):
            X.strip("ground_white", H, d - 0.22, d + 0.22, [-HW + 0.5, HW - 0.5], m)
        # manholes, the long grate across the east lane's mouth, and the gullies at the west kerb
        for (d, o) in [(13.0, -0.6), (10.6, 1.3), (27.5, 0.4), (47.0, -1.2), (-6.0, 1.0), (38.5, 1.9)]:
            X.decal("ground_iron", H(d, o), self.hill.at(d)[1], 0.66, 0.66, uv=A.uv("manhole"), h=LIFT + 0.01)
        guv = [A.uv("grate")[i] for i in (3, 0, 1, 2)]
        for k in range(6):
            X.decal("ground_iron", H(14.4 + k * 1.0, HW + 0.25), self.hill.at(17)[1], 0.42, 1.0, uv=guv, h=LIFT + 0.011)
        for d in (22.0, 36.0, 50.0):
            X.decal("ground_iron", H(d, -HW + 0.02), self.hill.at(d)[1], 0.3, 0.6, uv=guv, h=LIFT + 0.011)
        # the west pavement: concrete paving on a kerb
        X.cover("ground_pave", self.pave, LIFT + 0.15, cell=1.0)
        for i in range(0, 45):
            d0, d1 = float(i), float(i + 1)
            a, b = H(d0, -HW, LIFT), H(d1, -HW, LIFT)
            a2, b2 = H(d0, -HW - 0.18, LIFT + 0.15), H(d1, -HW - 0.18, LIFT + 0.15)
            a1, b1 = np.r_[a[:2], a2[2] + 0.005], np.r_[b[:2], b2[2] + 0.005]
            G.quad("ground_kerb", b, a, a1, b1, uv=[(d1, 0), (d0, 0), (d0, 0.16), (d1, 0.16)])          # its face
            G.quad("ground_kerb", a1, a2 + UP * 0.005, b2 + UP * 0.005, b1, uv=[(0, d0), (0.18, d0), (0.18, d1), (0, d1)], n=UP)   # its top
            j = 0.012   # a joint between kerb stones each metre, as a dark hairline
            G.quad("ground_seal", a1 + UP * 0.003, a2 + UP * 0.008, a2 + UP * 0.008 + unit(b2 - a2) * j, a1 + UP * 0.003 + unit(b1 - a1) * j, n=UP)
        G.walls.append((self.hill.xy(0, -HW), self.hill.xy(45, -HW), H(0, -HW)[2], H(45, -HW)[2] + 0.16))

    def crossing(self):
        """The deck: yellow non-slip paint between the stop boards, a green strip on the west for people on
        foot, the rails with their flangeways, and the pipe fences and boards along the track either side."""
        G, A, H, X = self.geo, self.A, self.H, self.X
        m = LIFT + 0.012
        X.strip("ground_yellow", H, -2.7, 2.7, [-HW + 1.25, HW + 0.2], m, step=0.9)
        X.strip("ground_green", H, -2.7, 2.7, [-HW - 0.2, -HW + 1.1], m, step=0.9)
        X.strip("ground_white", H, -2.7, 2.7, [-HW + 1.1, -HW + 1.25], m + 0.001, step=0.9)
        for d in (-2.7, 2.55):
            X.strip("ground_orange", H, d, d + 0.15, [-HW + 1.25, HW + 0.2], m + 0.002)
        # the rails across the road: a groove and the worn head, on the railway's own line
        tr = self.track
        for side in (-1, 1):
            for (o, w, mat, dz) in [(side * 0.5335, 0.17, "ground_groove", 0.003), (side * 0.5335 + side * 0.03, 0.065, "ground_rail", 0.006)]:
                f = lambda d, oo, h: X.G(tr.xy(d, oo), h)
                X.strip(mat, f, -5.4, 5.4, [o - w / 2, o + w / 2], m + dz, step=0.9)
        # pipe fences along the track from the road's four corners, and the boards on them
        for sd, e0 in ((1, HW + 0.9), (-1, -HW - 0.7)):
            for ns in (1, -1):   # north and south of the rails
                a = X.G(tr.xy(sd * (abs(e0) + 0.3), -ns * 2.3), 0.05)
                b = X.G(tr.xy(sd * (abs(e0) + 9.5), -ns * 2.2), 0.05)
                X.pipe_fence(a, b, mat="metal_green" if ns > 0 else "metal_galv")
                if ns > 0:
                    mid = a + (b - a) * 0.3
                    c, t, r = tr.at(sd * (abs(e0) + 3.0))
                    X.panel("board", mid + UP * 0.78 - np.r_[r, 0] * 0.04, -r, (0.28, 1.0), "keepout", back="metal_alu")
        # the yellow warning board by the uphill gate, on the east
        X.sign(H(3.4, HW + 1.0, 0.05), self.hill.at(3.4)[1], "danger", (0.6, 0.4), 1.45)

    def east(self):
        """The rubble retaining wall under the house at the corner, the block band, planting and glass
        balustrade over it, and the tan garage at its upper end; the low wall and the green bank above the lane."""
        G, A, H, HZ, X = self.geo, self.A, self.H, self.HZ, self.X
        e0 = HW + 0.55
        # the wall's line: up the hill road from the crossing's fence, then round into the lane (on its south side)
        line, zb = [], []
        for d in np.arange(2.6, 13.21, 0.9):
            p = HZ(d, e0)
            line.append(p[:2]); zb.append(self.T(*p[:2]) + LIFT - 0.06)
        c, t, r = self.hill.at(13.2)
        corner = c[:2] + r * e0
        for k in range(1, 5):   # the rounded corner
            a = math.pi / 2 * k / 4
            q = corner + r * (1.3 * (1 - math.cos(a))) + t * (1.3 * math.sin(a))
            line.append(q); zb.append(self.T(*q) + LIFT - 0.06)
        for d in np.arange(6.5, 26.1, 1.5):
            q = self.side.xy(d, 3.3)
            line.append(q); zb.append(self.T(*q) + LIFT - 0.08)
        top = 13.35   # the house's platform (its building's base is 13.0 m)
        zt = [max(top, b + 0.9) for b in zb]
        X.wall("wall_rubble", line, zb, zt, batter=0.16, cap="conc", thick=0.4, lip=0.04, left=True)
        nh = 9   # the wall's points along the hill road below the garage
        setb = lambda i, k=0.0: np.asarray(line[i]) + HP.normal(line, i) * (0.16 * (zt[i] - zb[i]) + 0.3 + k)
        # over the rubble below the garage: a band of blocks, the glass balustrade on it, planting behind
        bl = [setb(i) for i in range(0, nh + 1)]
        X.wall("wall_block", bl, [zt[i] + 0.04 for i in range(nh + 1)], top + 0.95, cap="conc", thick=0.22, lip=0.02, v0=0.3, left=True)
        gz = top + 1.0
        gl = [p + HP.normal(bl, i) * 0.11 for i, p in enumerate(bl)]
        for i in range(len(gl) - 1):
            p, q = gl[i], gl[i + 1]
            G.box("metal_alu", np.r_[p, gz], ((1, 0, 0), (0, 1, 0)), (0.05, 0.05, 1.12))
            G.quad("glass", np.r_[p, gz + 0.08], np.r_[q, gz + 0.08], np.r_[q, gz + 1.04], np.r_[p, gz + 1.04])
            G.tube("metal_alu", [np.r_[p, gz + 1.1], np.r_[q, gz + 1.1]], 0.02, 6)
        G.box("metal_alu", np.r_[gl[-1], gz], ((1, 0, 0), (0, 1, 0)), (0.05, 0.05, 1.12))
        X.hedge("hedge", [np.r_[gl[i] + HP.normal(gl, i) * 0.7, gz - 0.1] for i in range(0, len(gl))], 0.9, 0.8, seed=3)
        for k, i in enumerate((1, 3, 4, 6, 8)):   # shrubs spilling over the rubble's top
            X.bush("shrub", np.r_[np.asarray(line[i]) + HP.normal(line, i) * (0.16 * (zt[i] - zb[i]) + 0.12), zt[i] - 0.05], 0.38 + 0.08 * (k % 3), 0.42, seed=40 + k)
        # the garage at the wall's upper end: tan stone facing, a flat roof, its shutter to the lane
        c, t, r = self.hill.at(11.9)
        gc = c[:2] + r * (e0 + 0.16 * (top - zb[nh]) + 0.3 + 2.9)
        t3, r3 = np.r_[t, 0], np.r_[r, 0]
        gh, gw, gd = 2.6, 5.6, 4.3   # height, across (east-west), along the hill
        base = np.r_[gc, top + 0.02]
        ring = [gc - r * gw / 2 - t * gd / 2, gc - r * gw / 2 + t * gd / 2, gc + r * gw / 2 + t * gd / 2, gc + r * gw / 2 - t * gd / 2]
        # (walls run so that they face out: west, north, east, south)
        X.wall("wall_facing", [ring[1], ring[0]], top, top + gh, uvk=1.0)
        X.wall("wall_facing", [ring[0], ring[3]], top, top + gh)
        X.wall("wall_facing", [ring[3], ring[2]], top, top + gh)
        nA, nB = ring[2], ring[1]                    # the north face, with the shutter in it
        u = unit(nB - nA)
        sw = 3.6
        s0 = (np.linalg.norm(nB - nA) - sw) / 2
        X.wall("wall_facing", [nA, nA + u * s0], top, top + gh)
        X.wall("wall_facing", [nA + u * (s0 + sw), nB], top, top + gh)
        X.wall("wall_facing", [nA + u * s0, nA + u * (s0 + sw)], top + 2.2, top + gh, v0=2.2)
        nn = np.r_[t, 0]
        for k in range(int(2.2 / 0.085)):            # the shutter: slats, each a little tilted
            za, zb2 = top + k * 0.085, top + (k + 1) * 0.085
            a3, b3 = np.r_[nA + u * s0, 0] - nn * 0.07, np.r_[nA + u * (s0 + sw), 0] - nn * 0.07
            G.quad("shutter", a3 + UP * za, b3 + UP * za, b3 + UP * zb2 + nn * 0.012, a3 + UP * zb2 + nn * 0.012)
        G.box("conc", base + UP * gh, (r3, t3), (gw + 0.3, gd + 0.3, 0.14))   # the roof's slab
        # above the lane: a low stone wall along the hill road and round into the lane's north side
        lw, zb, zt = [], [], []
        for d in np.arange(20.6, 43.1, 1.2):
            p = HZ(d, e0 - 0.15)
            zr = self.T(*p[:2])
            back = self.T(*(p[:2] + self.hill.at(d)[2] * 1.6))
            lw.append(p[:2]); zb.append(zr + LIFT - 0.06)
            zt.append(float(np.clip(back + 0.2, zr + 0.5, zr + 1.7)))
        X.wall("wall_rubble", lw, zb, zt, batter=0.1, cap="conc", thick=0.3, lip=0.03, v0=1.3, left=True)
        lw2, zb2, zt2 = [], [], []
        for d in np.arange(24.0, 5.9, -1.5):    # the lane's north side, from up the lane down to its mouth
            q = self.side.xy(d, -3.3)
            zr = self.T(*q)
            back = self.T(*(q - self.side.at(d)[2] * 1.6))
            lw2.append(q); zb2.append(zr + LIFT - 0.08)
            zt2.append(float(np.clip(back + 0.2, zr + 0.5, zr + 1.7)))
        X.wall("wall_rubble", lw2, zb2, zt2, batter=0.1, cap="conc", thick=0.3, lip=0.03, v0=0.7, left=True)
        # shrubs on the bank between the lanes, and along the walls' tops
        rs = np.random.default_rng(9)
        from shapely.geometry import Point
        n = 0
        while n < 26:
            x, y = rs.uniform(-443, -418), rs.uniform(142, 178)
            if not self.green.buffer(-1.2).contains(Point(x, y)):
                continue
            s = rs.uniform(0.35, 0.9)
            X.bush("shrub" if n % 3 else "hedge", X.G((x, y), -0.05), s, s * rs.uniform(0.7, 1.1), seed=100 + n)
            n += 1
        for i in range(2, len(lw) - 1, 3):
            X.bush("shrub", np.r_[lw[i] + self.hill.at(30)[2] * 0.75, zt[i] - 0.1], 0.55, 0.5, seed=200 + i)
        # the signs on the east: the crossing's blue pentagon by the zebra, no parking above the lane
        X.sign(H(8.6, HW + 0.2, LIFT), self.hill.at(8.6)[1], "school", (0.62, 0.62), 2.45)
        X.sign(H(21.5, HW + 0.05, LIFT), self.hill.at(21.5)[1], "nopark", (0.6, 0.6), 2.5)

    def west(self):
        """The pavement's side: the block wall with its hedge and timber rail, the notice boards, the
        mirror's orange post, bollards."""
        G, A, H, HZ, X = self.geo, self.A, self.H, self.HZ, self.X
        line, zb, zt = [], [], []
        for d in np.arange(1.5, 45.01, 1.1):    # (uphill, so that the wall faces the road on its right)
            q = self.hill.xy(d, -HW - self.wide(d))
            zr = self.T(*q) + LIFT + 0.12
            back = self.T(*(q - self.hill.at(d)[2] * 1.5))
            line.append(q); zb.append(zr)
            zt.append(float(np.clip(back + 0.25, zr + 0.55, zr + 1.3)))
        X.wall("wall_block", line, zb, zt, batter=0.06, cap="conc", thick=0.3, lip=0.03)
        # the hedge on it, in two runs, and the timber rail in front of the lower one
        top = [np.r_[np.asarray(line[i]) - HP.normal(line, i) * 0.8, zt[i] - 0.05] for i in range(len(line))]
        X.hedge("hedge", top[3:21], 0.95, 0.9, seed=7)
        X.hedge("hedge", top[23:39], 1.0, 1.1, seed=8)
        for k, i in enumerate(range(3, len(line), 5)):
            X.bush("shrub", top[i] - np.r_[HP.normal(line, i) * 1.4, 0.2], 0.6 + 0.15 * (k % 3), 0.8 + 0.25 * (k % 2), seed=300 + k)
        rail = [np.r_[np.asarray(line[i]) - HP.normal(line, i) * 0.17, zt[i] + 0.04] for i in range(4, 20, 2)]
        for a, b in zip(rail, rail[1:]):
            G.box("timber", a, ((1, 0, 0), (0, 1, 0)), (0.11, 0.11, 0.72))
            for z in (0.6, 0.3):
                G.tube("timber", [a + UP * z, b + UP * z], 0.045, 6)
        G.box("timber", rail[-1], ((1, 0, 0), (0, 1, 0)), (0.11, 0.11, 0.72))
        # the notice boards at the pavement's foot: dark steel frames with a small roof, facing the road
        for (d, key) in ((5.6, "map"), (3.4, "rules")):
            c = H(d, -HW - 2.9, LIFT + 0.15)
            f = self.hill.at(d)[2]            # east: towards the road
            t = np.r_[self.hill.at(d)[1], 0]
            for s in (-0.72, 0.72):
                G.box("metal_dark", c + t * s, (t, np.r_[f, 0]), (0.08, 0.08, 2.35))
            G.box("metal_dark", c + UP * 2.3, (t, np.r_[f, 0]), (1.7, 0.5, 0.06))
            X.panel("board", c + UP * 1.35 + np.r_[f, 0] * 0.03, f, (1.32, 1.64), key, back="metal_dark")
        # the convex mirror: an orange post at the kerb by the zebra, the mirror facing up the hill and out
        c = H(7.6, -HW - 0.45, LIFT + 0.15)
        X.post("paint_orange", c, 0.045, 3.4, 10)
        ax = unit(np.r_[self.hill.at(7.6)[1] * 0.9 + self.hill.at(7.6)[2] * 0.45, -0.12])
        m = c + UP * 2.95 + ax * 0.12
        X.disc("mirror", m + ax * 0.01, ax, 0.4, dome=0.07)
        X.disc("paint_orange", m, -ax, 0.415, dome=0.1)
        u = unit(np.cross(ax, UP)); v = np.cross(u, ax)
        G.tube("paint_orange", [m + (math.cos(a) * u + math.sin(a) * v) * 0.415 for a in np.linspace(0, 2 * math.pi, 25)], 0.03, 6)
        # bollards at the pavement's upper end and where it meets the deck
        for (d, o) in [(13.5, -HW - 0.45), (15.3, -HW - 0.45), (1.6, -HW - 0.5), (1.6, -HW - 1.6)]:
            X.bollard(H(d, o, LIFT + 0.15))

    def overhead(self):
        """The poles and their wires. Places from the photographs: the tall one on the west by the boards
        with its transformer and the bundle that sags across the road, a pole on the east above the lane's
        corner, one each side up the hill, and one on the promenade beyond the track."""
        G, H, X = self.geo, self.H, self.X
        hd = math.atan2(self.hill.at(20)[2][1], self.hill.at(20)[2][0])   # the crossarms lie east-west
        east = self.hill.at(10)[2]
        P = {}
        P["w0"] = (H(0.9, -HW - 4.3, 0.1), dict(h=12.5, arms=[(12.2, hd), (11.3, hd)], transformer=True, lamp=east))
        P["e1"] = (H(19.6, HW + 1.2, 0.1), dict(h=11.5, arms=[(11.2, hd)], lamp=None))
        P["w2"] = (H(34.0, -HW - 0.6, 0.2), dict(h=11.5, arms=[(11.2, hd)], lamp=east))
        P["e3"] = (H(52.0, HW + 0.9, 0.1), dict(h=11.5, arms=[(11.2, hd)], transformer=True, lamp=-east))
        P["w4"] = (H(66.0, -HW - 0.7, 0.1), dict(h=11.5, arms=[(11.2, hd)], lamp=None))
        P["s"] = (X.G(self.prom.xy(9.0, -0.9), 0.1), dict(h=10.5, arms=[(10.2, hd + 0.3)], lamp=None))
        W = {k: X.pole(c, **kw) for k, (c, kw) in P.items()}
        rng = self.rng
        for a, b in (("s", "w0"), ("w0", "e1"), ("e1", "w2"), ("w2", "e3"), ("e3", "w4")):
            for kind, r_, sag in (("hv", 0.008, 0.35), ("lv", 0.011, 0.55), ("tel", 0.02, 0.8)):
                for p, q in zip(W[a][kind], W[b][kind]):
                    X.wire(p, q, sag * (0.8 + 0.4 * rng.random()), r_)
        # the bundle across the road by the crossing: a messenger and a thick cable hung under it
        a = P["w0"][0] + UP * 6.6
        b = H(5.0, HW + 2.2, 7.4)
        X.wire(a, b, 0.9, 0.038)
        X.wire(a + UP * 0.12, b + UP * 0.12, 0.75, 0.008)
        G.tube("pole", [H(5.0, HW + 2.2, 0.0), b + UP * 0.6], 0.11, 10)   # the short pole that takes it, on the house's side
        X.wire(P["w0"][0] + UP * 5.2, P["e1"][0] + UP * 5.6, 0.7, 0.014)
        X.wire(P["e1"][0] + UP * 7.5, b + UP * 0.3, 0.5, 0.009)

    def route134(self):
        """Route 134 either side of the junction and the promenade between it and the track."""
        G, A, X = self.geo, self.A, self.X
        f = lambda d, o, h: X.G(self.r134.xy(d, o), h)
        a0, a1 = -50.0, 50.0
        X.cover("ground_asphalt", self.r134_poly.difference(self.road.buffer(-0.05)), LIFT + 0.02)
        m = LIFT + 0.034
        for o in (-3.55, 0.0, 3.55):
            for (d0, d1) in (((a0, -5.0), (5.5, a1)) if o < 0 else ((a0, a1),)):
                X.strip("ground_white", f, d0, d1, [o - 0.075, o + 0.075], m, step=2.0)
        X.strip("ground_patch", f, -30.0, -12.0, [0.6, 2.2], LIFT + 0.027, step=2.0)
        X.strip("ground_old", f, 14.0, 40.0, [-3.0, -1.2], LIFT + 0.027, step=2.0)
        for d in (-22.0, 17.0, 33.0):
            X.decal("ground_iron", f(d, 1.8, 0), self.r134.at(d)[1], 0.66, 0.66, uv=A.uv("manhole"), h=m)
        # the promenade: concrete paving with a kerb to the road, and bollards along it
        g = lambda d, o, h: X.G(self.prom.xy(d, o), h)
        for (d0, d1) in ((-48.0, -4.6), (4.6, 48.0)):
            X.strip("ground_pave", g, d0, d1, [-1.2, 1.2], LIFT + 0.09, step=2.0)
            X.strip("ground_kerb", g, d0, d1, [1.2, 1.38], LIFT + 0.1, step=2.0)
        for d in list(np.arange(-44.0, -5.0, 6.0)) + list(np.arange(7.0, 45.0, 6.0)):
            X.bollard(g(d, 1.05, LIFT + 0.09), 0.8)


def build(K):
    """(geo, atlas, materials, meta) for blender/build_hero.py."""
    L = Level(K)
    geo, atlas = L.build()
    meta = {"id": ID, "at": [-446.0, 138.0], "r": 60.0, "z": 12.0, "glb": f"hero/{ID}.glb", "bake_gain": 1.0}
    return geo, atlas, materials(), meta
