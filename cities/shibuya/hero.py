"""The Scramble, the Shibuya map's hero level (blender/build_hero.py --city shibuya; docs/HERO.md).

Why here: the game opens on Hachiko Square at the Scramble's south-east corner, looking across the
diagonal to QFRONT. The hundred metres round that spot are the most photographed junction there is, and
almost all of what a player sees of it from eye level is ground: the square's setts in the foreground,
then the asphalt with its worn bars, then the kerbs and what stands on them.

What is built, over the city's own ground and landmarks (cities/shibuya/scramble.py keeps the fronts,
the entrances, the tracks and Hachiko himself):

  * the carriageways as one asphalt surface on the game's road bands, with the concrete gutter Japanese
    streets have along each kerb, flush granite kerbs, manholes and gully grates; clean and of one tone
    (AGENTS.md, "The bar": the ground is never aged);
  * the paint, in a thermoplastic of its own: the five crosswalks at their measured places
    (scramble.CROSSWALKS, off GSI's aerial photo), stop lines, the diamonds before them, centre lines;
  * the pavements in grey blocks and Hachiko Square in small granite setts, the yellow tactile blocks along
    the lines OpenStreetMap maps, with their bars and domes in relief;
  * on the kerbs: the white guard pipes between the crosswalks, tall steel lamp posts whose light is
    baked into everything here, tree grates round the trees that stand in the paving.

Nothing is built under a building, in a stair well or beyond 100 m of the junction: from the spawn and
from each corner of the crossing the fronts close the view before that.
"""
import importlib.util
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "blender"))

import hero_open as HP  # noqa: E402
import hero_parts as PT  # noqa: E402
from hero_open import unit  # noqa: E402

ID = "scramble"
CENTRE = (368.0, -1002.0)
R = 100.0
UP = np.array([0.0, 0.0, 1.0])
LIFT = 0.04                       # the asphalt over the game's ground (docs/HERO.md: paving 4 cm over it)
PAINT = LIFT + 0.012
GUTTER_M = 0.5                    # the concrete gutter along a kerb (街渠: 50 cm is the common section)
KERB_M = 0.18
PLAZA = (369.0, -1080.0, 416.0, -1009.5)   # Hachiko Square: west, south, east, north (setts; the rest is blocks)

TEX = {
    "road": ("OEAsphalt031d", 3.2),     # Asphalt031 with its stones' contrast raised (drawn here: a worn carriageway shows its aggregate)
    "paver": ("PavingStones136", 2.0),  # grey interlocking blocks: the pavements
    "sett": ("PavingStones128", 2.4),   # rectangular pavers in running bond: Hachiko Square's red-brown blocks (photographs, 2024)
    "tile": ("Tiles036", 0.9),          # small square facing tiles, the skin of Japan's mixed-use buildings
    "panel": ("Concrete034", 3.0),      # smooth precast and render
    "dark": ("Tiles138", 1.6),          # dark stone at a shop front's foot
    "conc": ("Concrete034", 3.0),       # gutters
    "granite": ("Granite005A", 1.5),    # kerbs
    "paint": ("OEPaint002", 2.4),       # thermoplastic road paint (drawn here)
    "tact_bar": ("OETactileBar", 0.3),  # a 30 cm guide block: four bars (drawn here, JIS T 9251's pattern)
    "tact_dot": ("OETactileDot", 0.3),  # a 30 cm warning block: five by five domes
}


def materials():
    return {
        "ground_asphalt": {"tex": "road", "tint": (0.5, 0.5, 0.5), "bump": 1.8},
        "ground_gutter": {"tex": "conc", "tint": (0.62, 0.61, 0.59), "maps": "cn"},
        "ground_kerb": {"tex": "granite", "tint": (0.7, 0.69, 0.68), "maps": "cn"},
        "ground_paint": {"tex": "paint", "tint": (0.92, 0.92, 0.9)},
        "ground_paver": {"tex": "paver", "tint": (0.7, 0.7, 0.7)},
        "ground_sett": {"tex": "sett", "tint": (0.74, 0.72, 0.71)},
        "ground_tact_bar": {"tex": "tact_bar", "maps": "cn", "rough": 0.7},
        "ground_tact_dot": {"tex": "tact_dot", "maps": "cn", "rough": 0.7},
        "ground_iron": {"map": "atlas", "rough": 0.5, "metal": 0.7},
        "metal_guard": {"color": (0.78, 0.78, 0.76), "rough": 0.42, "metal": 0.3},
        "metal_pole": {"color": (0.5, 0.51, 0.52), "rough": 0.38, "metal": 0.85},
        "metal_dark": {"color": (0.03, 0.032, 0.035), "rough": 0.5, "metal": 0.7},
        "lamp_head": {"color": (0.95, 0.97, 1.0), "emissive": (1.0, 0.93, 0.82), "glow": 2.4},
        # the fronts: facing in three close tones, dark stone at the foot, aluminium frames
        "wall_white": {"tex": "tile", "maps": "cn", "rough": 0.42},
        "wall_cream": {"tex": "tile", "maps": "cn", "rough": 0.45},
        "wall_grey": {"tex": "panel", "maps": "cn", "rough": 0.6},
        "wall_foot": {"tex": "dark", "tint": (0.5, 0.5, 0.52), "maps": "cn", "rough": 0.3},
        "metal_alu": {"color": (0.56, 0.57, 0.58), "rough": 0.36, "metal": 0.9},
        # glass: dark and mirror-smooth, so that by day it shows the sky (the game's environment) and after dark
        # the rooms drawn behind it, which are its light alone
        "win_glass": {"map": "atlas", "color": (0.035, 0.045, 0.055), "rough": 0.05, "metal": 0.65, "emissive": True, "emissive_only": True, "glow": 0.9},
        "glow_shop": {"map": "atlas", "color": (0.03, 0.035, 0.04), "rough": 0.08, "metal": 0.0, "sky": 0.15, "emissive": True, "emissive_only": True, "glow": 1.0},
    }


# ---------------------------------------------------------------- textures drawn here

def _noise(n, cells, rng):
    """Smooth tiling noise in 0..1: a grid of `cells` random values, interpolated (cubic) and wrapped."""
    from scipy import ndimage
    g = rng.random((cells, cells))
    return np.clip(ndimage.zoom(g, n / cells, order=3, mode="grid-wrap"), 0, 1)


def paint_texture(K, tid="OEPaint002", n=512, seed=7):
    """Thermoplastic road paint: off-white, the fine grain of its glass beads in colour and relief, matt. Clean
    and even (AGENTS.md, "The bar": the ground is never aged)."""
    if os.path.exists(os.path.join(K.TEX_DIR, tid, f"{tid}_1K-JPG_Color.jpg")):
        return tid
    from PIL import Image
    rng = np.random.default_rng(seed)
    grain = rng.random((n, n))
    lum = 234 - 9 * (grain - 0.5)
    col = np.dstack([lum, lum * 0.995, lum * 0.97])
    HP._save_set(K, tid, Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)), 0.5 + 0.1 * grain, rough=0.7, normal_k=2.0)
    return tid


def asphalt_texture(K, tid="OEAsphalt031d", base="Asphalt031", seed=3):
    """ambientCG's Asphalt031 with its aggregate a little clearer (the stones' tops show pale in a laid
    carriageway) and a roughness that is lower on them. Nothing else: the ground is clean and of one tone
    (AGENTS.md, "The bar": no variation the material does not explain)."""
    if os.path.exists(os.path.join(K.TEX_DIR, tid, f"{tid}_1K-JPG_Color.jpg")):
        return tid
    from PIL import Image
    K.TEXTURES["_base"] = (base, 1.0)
    T = K.fetch_texture("_base")
    del K.TEXTURES["_base"]
    rng = np.random.default_rng(seed)
    c = np.asarray(Image.open(T["Color"]).convert("L"), float)
    n = c.shape[0]
    m = c.mean()
    lum = m + (c - m) * 1.5
    col = np.dstack([lum * 1.0, lum * 0.992, lum * 0.975])           # a touch warm: stone, not blue
    d = os.path.join(K.TEX_DIR, tid)
    os.makedirs(d, exist_ok=True)
    Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).save(os.path.join(d, f"{tid}_1K-JPG_Color.jpg"), quality=92)
    Image.open(T["NormalGL"]).convert("RGB").save(os.path.join(d, f"{tid}_1K-JPG_NormalGL.jpg"), quality=92)
    r = np.asarray(Image.open(T["Roughness"]).convert("L"), float) / 255.0
    r = np.clip(0.86 - 0.3 * np.clip((c - m) / 60.0, -0.3, 1), 0.35, 1)
    Image.fromarray((r * 255).astype(np.uint8)).save(os.path.join(d, f"{tid}_1K-JPG_Roughness.jpg"), quality=92)
    return tid


def tactile_texture(K, tid, dots, n=128):
    """One 30 cm tactile block (JIS T 9251): four bars 17 mm wide at 75 mm centres along v, or five by five
    domes at 60 mm centres; safety yellow, a little scuffed, the relief in its normal map."""
    if os.path.exists(os.path.join(K.TEX_DIR, tid, f"{tid}_1K-JPG_Color.jpg")):
        return tid
    from PIL import Image
    rng = np.random.default_rng(11 + dots)
    yy, xx = np.mgrid[0:n, 0:n] / n * 300.0                      # mm across the block
    if dots:
        d = np.full((n, n), 1e9)
        for i in range(5):
            for j in range(5):
                d = np.minimum(d, np.hypot(xx - (30 + 60 * i), yy - (30 + 60 * j)))
        h = np.clip((11.0 - d) / 5.0, 0, 1)
    else:
        d = np.full((n, n), 1e9)
        for i in range(4):
            d = np.minimum(d, np.abs(xx - (37.5 + 75 * i)))
        h = np.clip((8.5 - d) / 4.0, 0, 1) * np.clip((yy - 8) / 6, 0, 1) * np.clip((292 - yy) / 6, 0, 1)
    joint = np.clip(1 - np.minimum(np.minimum(xx, 300 - xx), np.minimum(yy, 300 - yy)) / 2.5, 0, 1)
    scuff = _noise(n, 6, rng)
    lum = 1.0 - 0.22 * joint - 0.1 * scuff + 0.07 * h
    col = np.dstack([226 * lum, 176 * lum, 22 * lum])
    HP._save_set(K, tid, Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)), h * 0.9 - joint * 0.5, rough=0.72, normal_k=4.0)
    return tid


def draw_manhole(kind):
    """A cast-iron cover in its frame: rings and a field of studs (a sewer's), or a square service cover."""
    def draw(img, r):
        from PIL import ImageDraw
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        d.rectangle([x, y, x + w, y + h], fill=(52, 50, 48))
        if kind == 2:                                             # a square two-leaf cover (telecoms, hydrants)
            d.rectangle([x + 3, y + 3, x + w - 4, y + h - 4], fill=(40, 38, 36), outline=(88, 84, 78), width=3)
            d.line([(x + w / 2, y + 4), (x + w / 2, y + h - 5)], fill=(18, 18, 18), width=2)
            for i in range(8):
                for j in range(8):
                    cx, cy = x + 12 + i * (w - 24) / 7, y + 12 + j * (h - 24) / 7
                    d.rectangle([cx - 3, cy - 3, cx + 3, cy + 3], fill=(66, 62, 58))
            return
        d.ellipse([x + 2, y + 2, x + w - 3, y + h - 3], fill=(36, 34, 32), outline=(92, 88, 80), width=4)
        cx, cy = x + w / 2, y + h / 2
        for k in range(1, 5):
            rr = w * 0.105 * k
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(74, 70, 64), width=2)
        for k in range(24 if kind == 0 else 16):
            a = 2 * math.pi * k / (24 if kind == 0 else 16)
            for rr in ((0.16, 0.27, 0.37) if kind == 0 else (0.2, 0.33)):
                px, py = cx + math.cos(a) * w * rr, cy + math.sin(a) * w * rr
                d.ellipse([px - 2.5, py - 2.5, px + 2.5, py + 2.5], fill=(84, 80, 72))
        d.ellipse([cx - 7, cy - 7, cx + 7, cy + 7], fill=(60, 56, 52))
    return draw


def draw_grate(img, r):
    """A gully's steel grating: bearing bars across, in a frame."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(70, 70, 70))
    d.rectangle([x + 4, y + 4, x + w - 5, y + h - 5], fill=(8, 8, 8))
    for i in range(14):
        xx = x + 6 + i * (w - 12) / 13
        d.rectangle([xx - 2, y + 4, xx + 2, y + h - 5], fill=(92, 92, 90))
    for j in (0.33, 0.66):
        d.rectangle([x + 4, y + h * j - 2, x + w - 5, y + h * j + 2], fill=(80, 80, 78))


def draw_tree_grate(img, r):
    """A cast-iron tree grate: a square of radial slots round the trunk's hole."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(44, 42, 40))
    cx, cy = x + w / 2, y + h / 2
    for k in range(40):
        a = 2 * math.pi * k / 40
        for (r0, r1) in ((0.2, 0.3), (0.33, 0.45)):
            m = 1.0 / max(abs(math.cos(a)), abs(math.sin(a))) if r1 > 0.4 else 1.0
            d.line([(cx + math.cos(a) * w * r0, cy + math.sin(a) * w * r0), (cx + math.cos(a) * w * min(r1 * m, 0.47 * m), cy + math.sin(a) * w * min(r1 * m, 0.47 * m))], fill=(10, 9, 8), width=3)
    d.ellipse([cx - w * 0.16, cy - w * 0.16, cx + w * 0.16, cy + w * 0.16], fill=(30, 24, 18))
    d.rectangle([x, y, x + w - 1, y + h - 1], outline=(80, 76, 70), width=3)


def draw_room(seed, lit):
    """A room behind an upstairs window, as its light after dark: a ceiling's lamps over a wall and the things
    against it, behind a blind part drawn; or dark."""
    def draw(img, r):
        from PIL import ImageDraw
        x, y, w, h = r
        rng = np.random.default_rng(seed)
        d = ImageDraw.Draw(img)
        if not lit:
            d.rectangle([x, y, x + w, y + h], fill=(5, 6, 8))
            return
        warm = rng.random() < 0.45
        c = np.array((255, 222, 176) if warm else (226, 236, 250)) * (0.55 + 0.4 * rng.random())
        for j in range(h):                                   # brightest under the ceiling, falling to the floor
            k = 1.0 - 0.45 * j / h
            d.line([(x, y + j), (x + w, y + j)], fill=tuple(int(v * k) for v in c))
        for i in range(3):
            cx = x + (i + 0.5) * w / 3
            d.rectangle([cx - w * 0.1, y + 3, cx + w * 0.1, y + 7], fill=(255, 252, 240))
        for i in range(int(rng.integers(1, 4))):             # a cabinet, a desk, a plant: dark shapes against the wall
            x0 = x + rng.random() * w * 0.8
            d.rectangle([x0, y + h * rng.uniform(0.5, 0.75), x0 + w * rng.uniform(0.1, 0.3), y + h], fill=tuple(int(v * 0.35) for v in c))
        b = int(h * rng.choice([0.0, 0.2, 0.45, 0.7]))       # a blind drawn part of the way
        for j in range(0, b, 5):
            d.rectangle([x, y + j, x + w, y + j + 3], fill=tuple(int(v * 0.82) for v in c))
    return draw


def draw_shop(kind):
    """A shop through its glass, as its light: a bright ceiling, a back wall, and its trade against it (shelves of
    goods, a cafe's counter and pendant lamps, a clothes rail)."""
    def draw(img, r):
        from PIL import ImageDraw, ImageFilter
        x, y, w, h = r
        rng = np.random.default_rng(40 + kind)
        d = ImageDraw.Draw(img)
        wall = [(236, 214, 178), (240, 242, 246), (226, 206, 170), (232, 232, 228)][kind % 4]
        d.rectangle([x, y, x + w, y + h], fill=wall)
        d.rectangle([x, y, x + w, y + h * 0.1], fill=(255, 252, 240))
        d.rectangle([x, y + h * 0.86, x + w, y + h], fill=tuple(int(v * 0.6) for v in wall))
        if kind % 4 in (0, 1):                               # shelves
            pal = [(210, 60, 50), (60, 110, 190), (240, 200, 70), (90, 170, 100), (245, 245, 240), (40, 40, 46), (230, 130, 160)]
            for j in range(4):
                yy = y + h * (0.3 + j * 0.15)
                d.rectangle([x, yy, x + w, yy + 3], fill=(200, 196, 188))
                for i in range(int(w / 8)):
                    c = pal[int(rng.integers(len(pal)))]
                    d.rectangle([x + i * 8 + 1, yy - 12 - int(rng.integers(0, 6)), x + i * 8 + 6, yy], fill=c)
        elif kind % 4 == 2:                                  # a cafe: a timber counter, pendant lamps, a menu board
            d.rectangle([x, y + h * 0.6, x + w, y + h * 0.86], fill=(104, 70, 44))
            d.rectangle([x + w * 0.1, y + h * 0.2, x + w * 0.9, y + h * 0.36], fill=(38, 34, 30))
            for i in range(6):
                cx = x + (i + 0.5) * w / 6
                d.line([(cx, y + h * 0.1), (cx, y + h * 0.42)], fill=(40, 36, 32), width=1)
                d.ellipse([cx - 7, y + h * 0.4, cx + 7, y + h * 0.5], fill=(255, 226, 150))
        else:                                                # clothes on a rail
            d.line([(x, y + h * 0.32), (x + w, y + h * 0.32)], fill=(120, 120, 124), width=2)
            for i in range(int(w / 12)):
                c = tuple(int(v) for v in rng.integers(40, 230, 3))
                d.rectangle([x + i * 12 + 2, y + h * 0.33, x + i * 12 + 10, y + h * rng.uniform(0.55, 0.72)], fill=c)
        for i in range(int(rng.integers(1, 4))):             # people inside
            cx = x + rng.random() * w
            d.ellipse([cx - 6, y + h * 0.5, cx + 6, y + h * 0.58], fill=(60, 44, 38))
            d.rectangle([cx - 9, y + h * 0.58, cx + 9, y + h * 0.9], fill=tuple(int(v) for v in rng.integers(30, 110, 3)))
        sub = img.crop((x, y, x + w, y + h)).filter(ImageFilter.GaussianBlur(0.8))
        img.paste(sub, (x, y))
    return draw


ROOMS, SHOPS = 16, 8
OUT = 0.1           # the fronts' face in front of the city's wall (m): behind the landmarks' signs, which stand 0.16 m off and more
STOREY = 3.5


# ---------------------------------------------------------------- the level

class Level:
    def __init__(self, K):
        from shapely.geometry import Point, Polygon, box
        from shapely.ops import unary_union
        self.K = K
        K.TEXTURES.update(TEX)
        asphalt_texture(K)
        paint_texture(K)
        tactile_texture(K, "OETactileBar", False)
        tactile_texture(K, "OETactileDot", True)
        self.geo = K.Geo()
        self.A = K.Atlas(2048, 1024)
        self.T = HP.Ground("shibuya")
        self.X = HP.Parts(K, self.geo, self.T, self.A)
        self.rng = np.random.default_rng(1973)
        spec = importlib.util.spec_from_file_location("shibuya_scramble", os.path.join(HERE, "scramble.py"))
        self.S = S = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(S)
        self.D = D = S.Data("shibuya")
        c = np.asarray(CENTRE)
        self.disc = Point(*c).buffer(R, 48)
        near = [Polygon(s["ring"]).buffer(0) for s in D.solids if len(s["ring"]) >= 3 and np.linalg.norm(np.mean(s["ring"], axis=0) - c) < R + 120
                and s.get("base", 0) - s.get("ground", 0) < 2.5]          # (what stands on the ground: not a deck or a bridge over it)
        self.solids = unary_union([p.buffer(0.12) for p in near if p.is_valid and p.area > 1]).intersection(self.disc.buffer(5))
        # the stair wells the entrances cut into the ground (the landmarks' clip rings)
        L = json.load(open(os.path.join(ROOT, "web", "data", "shibuya", "landmarks.json")))
        self.wells = unary_union([Polygon(q["ring"]).buffer(0.25) for q in L.get("clip", []) if len(q["ring"]) >= 3])
        self.junction = S.junction_area(D)
        bands = S.road_bands(D)
        self.roads = unary_union([bands, self.junction]).intersection(self.disc).difference(self.solids).buffer(0)
        self.walks = unary_union([Polygon(S.crosswalk_poly(cw)) for cw in S.CROSSWALKS])
        self.pave = self.disc.difference(self.roads.buffer(KERB_M)).difference(self.solids).difference(self.wells).buffer(0)
        self.box = box

    def Gp(self, x, y, h=0.0):
        return self.X.G((x, y), h)

    def build(self):
        A = self.A
        for k in range(3):
            A.cell(f"manhole{k}", 124, 124, draw_manhole(k))
        A.cell("grate", 124, 100, draw_grate)
        A.cell("tree_grate", 248, 248, draw_tree_grate)
        for k in range(ROOMS):
            A.cell(f"room{k}", 124, 150, draw_room(700 + k, k % 5 != 0 and k % 3 != 0))
        for k in range(SHOPS):
            A.cell(f"shop{k}", 400, 220, draw_shop(k))
        self.carriageway()
        self.markings()
        self.pavements()
        self.tactile()
        self.guards()
        self.lamps()
        self.fronts()
        self.qfront_base()
        return self.geo, self.A

    # -- helpers
    def ribbon(self, mat, a, b, w, h, step=2.0, uvk=1.0):
        """A flat band from a to b (x, y), w wide, laid on the ground in pieces `step` long."""
        a, b = np.asarray(a, float)[:2], np.asarray(b, float)[:2]
        L = float(np.linalg.norm(b - a))
        if L < 1e-3:
            return
        f = (b - a) / L
        r = np.array([f[1], -f[0]])
        fn = lambda d, o, hh: self.Gp(*(a + f * d + r * o), hh)
        self.X.strip(mat, fn, 0.0, L, [-w / 2, w / 2], h, step=step, uvk=uvk, across=max(w, 1.0))

    def lines(self, geom):
        for g in getattr(geom, "geoms", [geom]):
            if g.geom_type == "LineString" and g.length > 0.3:
                yield np.asarray(g.coords)
            elif g.geom_type in ("MultiLineString", "GeometryCollection"):
                yield from self.lines(g)

    # -- the carriageway
    def carriageway(self):
        X, A, rng = self.X, self.A, self.rng
        from shapely.geometry import LineString, Point
        k = 1.0 / TEX["road"][1]
        edge = self.roads.buffer(-GUTTER_M)
        # the gutter runs where the road meets a pavement, not across the level's rim or a building's foot
        gutter = self.roads.difference(edge).intersection(self.pave.buffer(KERB_M + 0.3)).buffer(0)
        X.cover("ground_asphalt", self.roads.difference(gutter).buffer(0), LIFT, cell=2.0, uvk=k)
        X.cover("ground_gutter", gutter, LIFT + 0.002, cell=2.0, uvk=1.0 / TEX["conc"][1])
        kerb = self.roads.buffer(KERB_M).difference(self.roads).intersection(self.pave.buffer(KERB_M + 0.05)).intersection(self.disc).difference(self.wells).buffer(0)
        X.cover("ground_kerb", kerb, LIFT + 0.016, cell=2.0, uvk=1.0 / TEX["granite"][1])
        self.kerb_line = kerb
        # manholes down each road's lanes
        inner = self.roads.buffer(-1.6)
        for cls, pts in self.D.roads:
            ln = LineString([p[:2] for p in pts]).intersection(self.disc)
            for co in self.lines(ln):
                P = HP.Path(np.c_[co, np.zeros(len(co))])
                if P.L < 12:
                    continue
                half = self.S.ROADW.get(cls, 7) / 2
                d = rng.uniform(4, 14)
                while d < P.L - 5:
                    o = rng.uniform(-half + 1.2, half - 1.2)
                    q = P.xy(d, o)
                    if inner.contains(Point(*q)) and not self.walks.buffer(0.6).contains(Point(*q)):
                        kind = int(rng.integers(3))
                        s = (0.66, 0.6, 0.5)[kind]
                        X.decal("ground_iron", self.Gp(*q), P.at(d)[1], s, s, uv=A.uv(f"manhole{kind}"), h=LIFT + 0.008)
                    d += rng.uniform(11, 24)
        # gully grates in the gutter, every 14 m or so along each kerb
        for co in self.lines(self.roads.buffer(-GUTTER_M / 2).boundary.intersection(self.pave.buffer(1.2))):
            P = HP.Path(np.c_[co, np.zeros(len(co))])
            d = 5.0
            while d < P.L - 3:
                q, t, _ = P.at(d)
                if not self.walks.buffer(0.3).contains(Point(*q[:2])):
                    X.decal("ground_iron", self.Gp(*q[:2]), t, 0.4, 0.5, uv=A.uv("grate"), h=LIFT + 0.01)
                d += 14.0

    # -- the paint
    def markings(self):
        S, D, rng = self.S, self.D, self.rng
        from shapely.geometry import LineString, Point
        k = 1.0 / TEX["paint"][1]
        centre = np.mean([np.asarray(c["a"]) + np.asarray(c["b"]) for c in S.CROSSWALKS], axis=0) / 2
        bands = S.road_bands(D)
        for cw in S.CROSSWALKS:
            a, b = np.asarray(cw["a"], float), np.asarray(cw["b"], float)
            f = unit(b - a)
            L = float(np.linalg.norm(b - a))
            l = np.array([-f[1], f[0]])
            hw = cw["width"] / 2
            n = int((L - 0.6) // (S.BAR + S.GAP))
            u0 = (L - (n * (S.BAR + S.GAP) - S.GAP)) / 2
            for i in range(n):
                u = u0 + i * (S.BAR + S.GAP) + S.BAR / 2
                self.ribbon("ground_paint", a + f * u - l * hw, a + f * u + l * hw, S.BAR, PAINT, step=2.4, uvk=k)
            mode = S.STOPS.get(cw["id"])
            if not mode:
                continue
            o = l if ((a + b) / 2 - centre) @ l > 0 else -l          # outward, away from the junction
            back = (a + b) / 2 + o * (hw + S.STOP_BACK + S.STOP_W / 2)
            Ls = L - 0.6
            left = -np.array([-o[1], o[0]])                          # the left of a driver coming in
            if mode == "full":
                p, q = back - f * Ls / 2, back + f * Ls / 2
                lanes = [back + (f if f @ left > 0 else -f) * (Ls / 2 - 1.6 - 3.1 * j) for j in range(int(Ls // 3.1))]
            else:
                p, q = back + left * 0.15, back + left * Ls / 2
                lanes = [back + left * (1.6 + 3.1 * j) for j in range(int((Ls / 2) // 3.1))]
            self.ribbon("ground_paint", p, q, S.STOP_W, PAINT, uvk=k)
            for c0 in lanes:                                          # the diamonds 30 m and 50 m before a crossing
                for dd in (30.0, 50.0):
                    cc = c0 + o * dd
                    if not (bands.contains(Point(*cc).buffer(1.0)) and self.disc.contains(Point(*cc).buffer(2.6))):
                        continue
                    pts = [cc + o * 2.5, cc + left * 0.75, cc - o * 2.5, cc - left * 0.75]
                    for j in range(4):
                        self.ribbon("ground_paint", pts[j], pts[(j + 1) % 4], 0.2, PAINT, uvk=k)
        # centre lines on the two-way streets, up to the stop lines (none through the junction)
        keep_out = self.junction.buffer(S.STOP_BACK + 1.0).union(self.walks.buffer(S.STOP_BACK + 1.0))
        inner = self.roads.buffer(-2.5)
        for cls, pts in D.roads:
            if S.ROADW.get(cls, 7) < 9:
                continue
            ln = LineString([p[:2] for p in pts]).intersection(inner).difference(keep_out)
            for co in self.lines(ln):
                if LineString(co).length < 4:
                    continue
                for a, b in zip(co[:-1], co[1:]):
                    self.ribbon("ground_paint", a, b, 0.15, PAINT, uvk=k)

    # -- the pavements
    def pavements(self):
        X, A = self.X, self.A
        plaza = self.box(PLAZA[0], PLAZA[1], PLAZA[2], PLAZA[3])
        X.cover("ground_sett", self.pave.intersection(plaza).buffer(0), LIFT + 0.01, cell=2.0, uvk=1.0 / TEX["sett"][1])
        X.cover("ground_paver", self.pave.difference(plaza).buffer(0), LIFT + 0.01, cell=2.0, uvk=1.0 / TEX["paver"][1])
        self.geo.walls += [(np.asarray(a), np.asarray(b), self.T(*a), self.T(*a) + 4.0) for poly in getattr(self.solids, "geoms", [self.solids])
                           for a, b in zip(list(poly.exterior.coords)[:-1], list(poly.exterior.coords)[1:]) if np.linalg.norm(np.subtract(a, b)) > 1.0]
        # a cast-iron grate round each tree that stands in the paving (OpenStreetMap's trees)
        from shapely.geometry import Point
        for n in self.D.nodes:
            if n["tags"].get("natural") == "tree" and self.pave.contains(Point(*n["xy"]).buffer(0.8)):
                X.decal("ground_iron", self.Gp(*n["xy"]), (1, 0), 1.3, 1.3, uv=A.uv("tree_grate"), h=LIFT + 0.02)

    def tactile(self):
        """The yellow blocks along the footways OpenStreetMap tags tactile_paving=yes: guide blocks along the
        line, a pad of warning blocks two deep where it meets a kerb."""
        from shapely.geometry import LineString, Point
        ok = self.pave.buffer(-0.2)
        ends = []
        for w in self.D.ways:
            t = w["tags"]
            if t.get("tactile_paving") != "yes" or not t.get("highway") or t.get("highway") in ("steps", "elevator"):
                continue
            if str(t.get("layer", "0")) != "0" or str(t.get("level", "0"))[:1] in "-123" or t.get("bridge"):
                continue
            ln = LineString([tuple(p) for p in w["xy"]]).intersection(ok)
            for co in self.lines(ln):
                P = HP.Path(np.c_[co, np.zeros(len(co))])
                fn = lambda d, o, h, P=P: self.Gp(*P.xy(d, o), h)
                n = max(1, int(round(P.L / 0.3)))
                # (uv: across the block along u, so that the bars run along the line)
                for i0 in range(0, n, 8):
                    d0, d1 = P.L * i0 / n, P.L * min(n, i0 + 8) / n
                    a, b = fn(d0, -0.15, LIFT + 0.022), fn(d0, 0.15, LIFT + 0.022)
                    c, d = fn(d1, 0.15, LIFT + 0.022), fn(d1, -0.15, LIFT + 0.022)
                    self.geo.quad("ground_tact_bar", a, b, c, d, uv=[(0, i0), (1, i0), (1, min(n, i0 + 8)), (0, min(n, i0 + 8))], n=UP)
                ends += [(co[0], unit(co[1] - co[0])), (co[-1], unit(co[-2] - co[-1]))]
        for e, back in ends:
            if self.roads.distance(Point(*e)) > 1.6:
                continue
            r = np.array([back[1], -back[0]])
            q = [e + r * -0.6, e + r * 0.6, e + r * 0.6 + back * 0.6, e + r * -0.6 + back * 0.6]
            self.geo.quad("ground_tact_dot", *[self.Gp(*p, LIFT + 0.024) for p in q], uv=[(0, 0), (4, 0), (4, 2), (0, 2)], n=UP)

    # -- what stands on the kerbs
    def guards(self):
        """White guard pipes (ガードパイプ: posts every 2 m, 0.8 m high, two rails) along the kerbs between the
        crosswalks, on the pavement's side, as photographs show them on the Hachiko and station sides; none
        across a crosswalk's end or along QFRONT's forecourt, which has the landmarks' steel bollards."""
        from shapely.geometry import Point
        G = self.geo
        skip = self.walks.buffer(1.2)
        centre = np.asarray(CENTRE)
        for co in self.lines(self.roads.buffer(KERB_M + 0.32).boundary.intersection(self.pave)):
            P = HP.Path(np.c_[co, np.zeros(len(co))])
            n = int(P.L // 2.0)
            run = []
            for i in range(n + 1):
                q = P.xy(P.L * i / max(n, 1))
                ok = (np.linalg.norm(q - centre) < 62 and not skip.contains(Point(*q)) and not (q[1] > -992.0 and q[0] < 372.0)
                      and self.solids.distance(Point(*q)) > 1.4)
                if ok:
                    run.append(self.Gp(*q, LIFT + 0.01))
                if (not ok or i == n) and run:
                    if len(run) > 1:
                        for p in run:
                            G.cylinder("metal_guard", p, 0.038, 0.8, 8)
                            G.lathe("metal_guard", p, [(0.07, 0.0), (0.07, 0.012), (0.04, 0.03)], segs=8)
                        for h in (0.42, 0.74):
                            G.tube("metal_guard", [p + UP * h for p in run], 0.024, 6)
                    run = []

    def lamps(self):
        """Tall tapered steel posts with a flat LED head out over the road (the square's and the junction's own, from
        photographs), on the pavement 0.9 m behind the kerb, about 26 m apart; their light is the bake's."""
        from shapely.geometry import Point
        centre = np.asarray(CENTRE)
        placed = []
        for co in self.lines(self.roads.buffer(KERB_M + 0.9).boundary.intersection(self.pave)):
            P = HP.Path(np.c_[co, np.zeros(len(co))])
            d = 6.0
            while d < P.L - 2:
                q, t, r = P.at(d)
                q = q[:2]
                to_road = r if self.roads.contains(Point(*(q + r * 1.5))) else -r
                if (np.linalg.norm(q - centre) < R - 8 and not self.walks.buffer(1.5).contains(Point(*q)) and self.solids.distance(Point(*q)) > 1.2
                        and all(np.linalg.norm(q - p) > 20 for p in placed)):
                    placed.append(q)
                    PT.lamp_post(self.geo, q, math.atan2(to_road[1], to_road[0]), self.T(*q) + LIFT + 0.01, h=9.0, arms=((1.9, 8.6),),
                                 low=(-0.9, 4.6), mat="metal_pole", light="lamp_head", rgb=(1.0, 0.9, 0.76), power=230.0)
                    d += 26.0
                else:
                    d += 3.0
        self.lamp_at = placed

    # -- the fronts round the junction
    def seen(self, mid, n):
        """Whether a wall's middle can be seen from somewhere a player stands (the junction's roads and pavements
        within 70 m): from in front of it, with no building between."""
        from shapely.geometry import LineString
        p = np.asarray(mid) + np.asarray(n) * 0.4
        for e in self.eyes:
            if (e - mid) @ n > 1.5 and np.linalg.norm(e - mid) < 130 and not self.block.intersects(LineString([e, p])):
                return True
        return False

    def fronts(self):
        """Each wall a player can see, of the buildings round the junction that the landmarks do not draw whole: a
        skin OUT in front of the city's plain wall. A glazed street floor between piers on a dark stone foot, onto
        a lit shop; above it, storey by storey, facing tile or panel with windows set back in their reveals, frames,
        sills, and a coping on the parapet. The landmarks' signs and screens hang in front of it as before."""
        from shapely.geometry import Point, Polygon
        from shapely.ops import unary_union
        from shapely.prepared import prep
        G, D = self.geo, self.D
        c = np.asarray(CENTRE)
        # whole buildings scramble.py draws (QFRONT, 109, MAGNET, Seibu, the station) keep their own fronts
        whole = {"w136691386", "w55895868", "w55896465", "w136692137", "w136692134", "w904652357", "w116710254"}
        L = json.load(open(os.path.join(ROOT, "web", "data", "shibuya", "landmarks.json")))
        gone = set(L.get("hidden", [])) | set(L.get("demolished", []))
        near = [(Polygon(s["ring"]).buffer(0), s) for s in D.solids if len(s["ring"]) >= 3 and np.linalg.norm(np.mean(s["ring"], axis=0) - c) < 160
                and s.get("base", 0) < 2.5 and s["si"] not in gone]
        self.block = prep(unary_union([p.buffer(-0.25) for p, _ in near if p.area > 4]))
        walk = self.roads.union(self.pave).intersection(Point(*c).buffer(70))
        x0, y0, x1, y1 = walk.bounds
        self.eyes = [np.array([x, y]) for x in np.arange(x0, x1, 7.0) for y in np.arange(y0, y1, 7.0) if walk.contains(Point(x, y))]
        allp = unary_union([p for p, _ in near]).buffer(0.3)
        # what the landmarks hang on these walls (signs, prints, screens, their boxes and frames): the skin leaves the
        # wall behind each alone, so that nothing of it stands in front of a picture (tools/sign_clear.py's rule)
        M = L["materials"]
        self.hung = []
        for m in L["meshes"]:
            mt = M.get(m["material"], {})
            if not (mt.get("map") or "screen" in m["material"] or "print" in m["material"] or "atlas" in m["material"]):
                continue
            P = np.asarray(m["position"], float).reshape(-1, 3)
            I = np.asarray(m.get("index") or np.arange(len(P)), np.int64).reshape(-1, 3)
            T = P[I]
            keep = np.linalg.norm(T.mean(1)[:, :2] - c, axis=1) < 150
            self.hung += [t for t in T[keep] if t[:, 2].max() - t[:, 2].min() > 0.4]
        n_faces = 0
        for poly, s in near:
            h = s["top"] - s.get("base", 0)
            if s["osm"] in whole or h < 7 or h > 62 or poly.area < 25 or np.linalg.norm(np.asarray(poly.centroid.coords[0]) - c) > 115:
                continue
            rng = np.random.default_rng(sum(ord(ch) for ch in (s["osm"] or str(s["si"]))) * 7919 % (2 ** 31))
            wall = ("wall_white", "wall_cream", "wall_grey")[int(rng.integers(3))]
            rep = TEX["panel"][1] if wall == "wall_grey" else TEX["tile"][1]
            ribbon = rng.random() < 0.4                    # an office floor's ribbon windows, or punched ones
            co = np.asarray(poly.exterior.coords)[:-1]
            if poly.exterior.is_ccw:
                co = co[::-1]                              # clockwise: the outside is on the left of the way round
            top = s["ground"] + s["top"]
            for i in range(len(co)):
                a, b = co[i], co[(i + 1) % len(co)]
                Ln = float(np.linalg.norm(b - a))
                if Ln < 3.2:
                    continue
                u = (b - a) / Ln
                n = np.array([-u[1], u[0]])
                mid = (a + b) / 2
                # (a wall against a neighbour is no front; nor one no player sees)
                if allp.contains(Point(*(mid + n * 1.2))) or not self.seen(mid, n):
                    continue
                F = PT.Frame(b, a)
                self.front(F, Ln, self.T(*(mid + n * 0.8)) + LIFT, top, wall, rep, ribbon, rng, self.behind(F, Ln))
                G.walls.append((a + n * OUT, b + n * OUT, self.T(*mid), top))
                n_faces += 1
        print(f"fronts: {n_faces} walls dressed, seen from {len(self.eyes)} places")

    def qfront_base(self):
        """QFRONT's street floor under its canopy, which the landmark draws as one plain band: the shopfront line a
        metre behind the building's face, glazed from a stone foot to the canopy's soffit onto the shops (the
        coffee shop's stair hall, the bookshop's entrance), and the building's round columns in silver cladding
        standing free in front of it, as the photographs show."""
        from shapely.geometry import Polygon
        SC = self.S
        G, A, D = self.geo, self.A, self.D
        Q = SC.QFRONT
        s = next((s for s in D.solids if s["osm"] == Q["osm"] and s["top"] > 40), None)
        if not s:
            return
        R = Q["round_m"]
        O = Polygon(s["ring"]).buffer(-R, join_style=2).buffer(R, resolution=6)
        cen, toward = np.array(O.centroid.coords[0]), np.asarray(Q["toward"])
        front = lambda mid, n: (toward - cen) @ n / np.linalg.norm(toward - cen) > -0.25 and (mid - cen) @ (toward - cen) > -8.0
        zs = s["ground"] + Q["shop_m"] - 0.55              # the canopy's soffit
        n_bays = 0
        for a, b, n, L in SC.ring_edges(O.buffer(-1.0 + OUT, join_style=2)):
            mid = (a + b) / 2
            if L < 0.6 or not front(mid, n):
                continue
            F = PT.Frame(a, b) if np.allclose(PT.Frame(a, b).n, n, atol=0.05) else PT.Frame(b, a)
            g = self.T(*(mid + n * 1.5)) + LIFT
            nb = max(1, int(round(L / 3.0)))
            bw = L / nb
            for j in range(nb):
                u0, u1 = j * bw, (j + 1) * bw
                z0 = g + 0.3
                key = f"shop{(2 + n_bays // 2) % SHOPS}"
                (ua, va), (ub, _), (_, vb), _ = A.uv(key)
                half = n_bays % 2
                uv = [(ua + (ub - ua) * (half + s_) / 2, v_) for s_, v_ in ((0, va), (1, va), (1, vb), (0, vb))]
                G.quad("glow_shop", F.P(u0, 0.0, z0), F.P(u1, 0.0, z0), F.P(u1, 0.0, zs), F.P(u0, 0.0, zs), uv=uv, n=F.N, emit=(A.mean[key], 1.3))
                PT.fbox(G, "wall_foot", F, u0, u1, 0.0, 0.05, g, z0, TEX["dark"][1], faces=("front", "top"))
                PT.fbox(G, "metal_alu", F, u0 - 0.035, u0 + 0.035, 0.0, 0.08, z0, zs, faces=("front", "left", "right"))
                PT.fbox(G, "metal_alu", F, u0, u1, 0.0, 0.07, g + 2.5, g + 2.56, faces=("front", "top", "bottom"))
                PT.fbox(G, "metal_alu", F, u0, u1, 0.0, 0.07, zs - 0.08, zs, faces=("front", "bottom"))
                n_bays += 1
        # the columns, on the building's face line, 5.4 m apart along the front
        acc, last, n_cols = 2.7, None, 0
        for a, b, n, L in SC.ring_edges(O.buffer(-0.35, join_style=2)):
            if not front((a + b) / 2, n):
                last = None
                continue
            for t in np.arange(0.0, L, 0.3):
                p = a + (b - a) * (t / L)
                acc += 0.3
                if acc >= 5.4:
                    acc = 0.0
                    g = self.T(*p) + LIFT
                    G.tube("metal_alu", [(p[0], p[1], g), (p[0], p[1], zs)], 0.3, segs=14)
                    G.tube("wall_foot", [(p[0], p[1], g), (p[0], p[1], g + 0.25)], 0.34, segs=14)
                    n_cols += 1
        print(f"QFRONT's street floor: {n_bays} bays of glass, {n_cols} columns")

    def behind(self, F, Ln):
        """The parts of a wall that a landmark's picture hangs on: [(u0, u1, z0, z1)] in the wall's frame, for each
        upright picture face that lies along the wall within 1.6 m in front of it (or 0.6 m inside it: a wall the
        city draws a little off its sign's)."""
        out = []
        for t in self.hung:
            d = (t[:, :2] - F.a) @ F.n
            u = (t[:, :2] - F.a) @ F.t
            if d.min() < -0.6 or d.max() > 1.6 or u.max() < 0.2 or u.min() > Ln - 0.2 or d.max() - d.min() > 0.5 * (u.max() - u.min()) + 0.3:
                continue
            out.append((max(0.0, u.min() - 0.12), min(Ln, u.max() + 0.12), t[:, 2].min() - 0.12, t[:, 2].max() + 0.12))
        # (two triangles to a face, and faces side by side: joined where they overlap, so that the wall is cut once)
        out.sort()
        merged = []
        for r in out:
            for k, q in enumerate(merged):
                if r[0] <= q[1] + 0.3 and r[1] >= q[0] - 0.3 and r[2] <= q[3] + 0.3 and r[3] >= q[2] - 0.3:
                    merged[k] = (min(q[0], r[0]), max(q[1], r[1]), min(q[2], r[2]), max(q[3], r[3]))
                    break
            else:
                merged.append(r)
        return merged

    def front(self, F, Ln, g, top, wall, rep, ribbon, rng, hung=()):
        G, A = self.geo, self.A
        free = lambda u0, u1, z0, z1: not any(u0 < h[1] and u1 > h[0] and z0 < h[3] and z1 > h[2] for h in hung)
        H = top - g
        gf = 4.3 if H > 11 else 3.3
        floors = max(1, int(round((H - gf - 0.6) / STOREY)))
        st = (H - gf - 0.6) / floors
        nb = max(1, int(round(Ln / (4.2 if ribbon else 3.3))))
        bw = Ln / nb
        pier = 0.32 if ribbon else 0.75                    # the wall left either side of a bay's window
        holes = []
        # the street floor: glass onto the shop between piers, over a stone foot
        k0 = int(rng.integers(SHOPS))
        for j in range(nb):
            u0, u1 = j * bw + 0.3, (j + 1) * bw - 0.3
            z0, z1 = g + 0.38, g + gf - 0.85
            if u1 - u0 < 1.2 or not free(u0 - 0.1, u1 + 0.1, g, z1 + 0.1):
                continue
            holes.append((u0, u1, g, z1))
            key = f"shop{(k0 + j // 2) % SHOPS}"
            (ua, va), (ub, _), (_, vb), _ = A.uv(key)
            half = j % 2                                    # a shop's picture runs across two bays
            uv = [(ua + (ub - ua) * (half + s_) / 2, v_) for s_, v_ in ((0, va), (1, va), (1, vb), (0, vb))]
            G.quad("glow_shop", F.P(u0, 0.03, z0), F.P(u1, 0.03, z0), F.P(u1, 0.03, z1), F.P(u0, 0.03, z1), uv=uv, n=F.N,
                   emit=(A.mean[key], 1.3))
            PT.fbox(G, "wall_foot", F, u0, u1, 0.0, OUT + 0.03, g, z0, TEX["dark"][1], faces=("front", "top"))
            for (m0, m1, y0, y1) in ((u0, u1, z1 - 0.07, z1), (u0, u1, z0, z0 + 0.06), (u0, u0 + 0.06, z0, z1), (u1 - 0.06, u1, z0, z1)):
                PT.fbox(G, "metal_alu", F, m0, m1, 0.02, 0.09, y0, y1, faces=("front", "left", "right", "top", "bottom"))
            for t in ((0.5,) if u1 - u0 < 2.6 else (0.34, 0.67)):
                um = u0 + (u1 - u0) * t
                PT.fbox(G, "metal_alu", F, um - 0.03, um + 0.03, 0.02, 0.08, z0, z1, faces=("front", "left", "right"))
            PT.fbox(G, "metal_alu", F, u0, u1, 0.02, 0.07, g + 2.25, g + 2.31, faces=("front", "top", "bottom"))     # the transom over the doors
            # the reveal's soffit and jambs
            G.quad(wall, F.P(u1, 0.03, z1), F.P(u0, 0.03, z1), F.P(u0, OUT, z1), F.P(u1, OUT, z1), ao=0.7)
            G.quad(wall, F.P(u0, 0.03, z0), F.P(u0, OUT, z0), F.P(u0, OUT, z1), F.P(u0, 0.03, z1), ao=0.7)
            G.quad(wall, F.P(u1, OUT, z0), F.P(u1, 0.03, z0), F.P(u1, 0.03, z1), F.P(u1, OUT, z1), ao=0.7)
        # the floors above: windows in their reveals
        k1 = int(rng.integers(ROOMS))
        wins = []
        for f in range(floors):
            zf = g + gf + f * st
            sill, head = zf + (0.85 if ribbon else 0.95), zf + st - 0.4
            for j in range(nb):
                u0, u1 = j * bw + pier, (j + 1) * bw - pier
                if u1 - u0 < 0.8 or head - sill < 1.0 or not free(u0 - 0.2, u1 + 0.2, sill - 0.25, head + 0.2):
                    continue
                holes.append((u0, u1, sill, head))
                wins.append((u0, u1, sill, head, (k1 + f * 5 + j * 3) % ROOMS))
        holes += [(max(0.0, h[0]), min(Ln, h[1]), max(g, h[2]), min(top + 0.5, h[3])) for h in hung]
        PT.wall(G, wall, F, 0.0, Ln, g, top + 0.5, OUT, rep, holes=holes, sub=3.5)
        d = OUT
        for (u0, u1, z0, z1, k) in wins:
            cols = max(1, int(round((u1 - u0) / 1.5)))
            for ci in range(cols):                          # a room to each 1.5 m of glass
                a0, a1 = u0 + (u1 - u0) * ci / cols, u0 + (u1 - u0) * (ci + 1) / cols
                G.quad("win_glass", F.P(a0, 0.02, z0), F.P(a1, 0.02, z0), F.P(a1, 0.02, z1), F.P(a0, 0.02, z1), uv=A.uv(f"room{(k + ci) % ROOMS}"), n=F.N)
                if ci:
                    PT.fbox(G, "metal_alu", F, a0 - 0.025, a0 + 0.025, 0.02, 0.07, z0, z1, faces=("front", "left", "right"))
            # the reveal: sill, jambs, head
            G.quad(wall, F.P(u0, 0.02, z0), F.P(u1, 0.02, z0), F.P(u1, d, z0), F.P(u0, d, z0), ao=0.75)
            G.quad(wall, F.P(u1, 0.02, z1), F.P(u0, 0.02, z1), F.P(u0, d, z1), F.P(u1, d, z1), ao=0.65)
            G.quad(wall, F.P(u0, 0.02, z0), F.P(u0, d, z0), F.P(u0, d, z1), F.P(u0, 0.02, z1), ao=0.72)
            G.quad(wall, F.P(u1, d, z0), F.P(u1, 0.02, z0), F.P(u1, 0.02, z1), F.P(u1, d, z1), ao=0.72)
            t = 0.045
            for (m0, m1, y0, y1) in ((u0, u1, z0, z0 + t), (u0, u1, z1 - t, z1), (u0, u0 + t, z0, z1), (u1 - t, u1, z0, z1)):
                PT.fbox(G, "metal_alu", F, m0, m1, 0.02, 0.065, y0, y1, faces=("front", "left", "right", "top", "bottom"))
            PT.fbox(G, wall, F, u0 - 0.06, u1 + 0.06, OUT, OUT + 0.04, z0 - 0.1, z0, rep)                            # the sill
        # a band over the shops, and the parapet's coping
        if free(0.0, Ln, g + gf - 0.2, g + gf + 0.1):
            PT.fbox(G, wall, F, 0.0, Ln, OUT, OUT + 0.04, g + gf - 0.12, g + gf, rep, faces=("front", "top", "bottom"))
        PT.fbox(G, "metal_alu", F, -0.05, Ln + 0.05, -0.3, OUT + 0.1, top + 0.5, top + 0.62, faces=("front", "left", "right", "top", "bottom"))


def build(K):
    """(geo, atlas, materials, meta) for blender/build_hero.py."""
    L = Level(K)
    geo, atlas = L.build()
    M = materials()
    # the pavements, the square, kerbs and gutters in close tones of one grey family (AGENTS.md, "The bar"): each
    # texture brought to its tone by its own mean, so that a yellowish block and a brown sett end as greys
    for mat, key, srgb in (("ground_paver", "paver", (150, 150, 148)), ("ground_sett", "sett", (152, 118, 110)),
                           ("ground_kerb", "granite", (160, 160, 158)), ("ground_gutter", "conc", (152, 152, 150)),
                           ("wall_white", "tile", (214, 214, 210)), ("wall_cream", "tile", (204, 196, 182)), ("wall_grey", "panel", (168, 170, 172))):
        M[mat]["tint"] = K.tint_to(key, srgb)
    meta = {"id": ID, "at": list(CENTRE), "r": R, "z": 15.0, "glb": f"hero/{ID}.glb", "bake_gain": 1.0, "cell": 28.0,
            "sky_rays": 20, "sky_reach": 5.0, "sky_strength": 1.0}   # (the sky's light occluded, ray-cast: hero_kit.sky_occlusion)
    return geo, atlas, M, meta
