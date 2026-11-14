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
    "sett": ("OESett131n", 1.6),        # PavingStones131's small granite setts with the moss taken out of their joints (drawn here)
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
        "glow_lamp": {"color": (0.95, 0.97, 1.0), "emissive": (1.0, 0.93, 0.82), "glow": 2.4},
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


def sett_texture(K, tid="OESett131n", base="PavingStones131"):
    """ambientCG's PavingStones131 for a square a million feet a week keep bare: its green (moss in the joints)
    taken to the stone's own grey, the joints left dark."""
    if os.path.exists(os.path.join(K.TEX_DIR, tid, f"{tid}_1K-JPG_Color.jpg")):
        return tid
    from PIL import Image
    K.TEXTURES["_base"] = (base, 1.0)
    T = K.fetch_texture("_base")
    del K.TEXTURES["_base"]
    c = np.asarray(Image.open(T["Color"]).convert("RGB"), float)
    lum = c @ np.array([0.3, 0.59, 0.11])
    green = np.clip((c[..., 1] - (c[..., 0] + c[..., 2]) / 2) / 14.0, 0, 1)          # how mossy a texel is
    grey = np.dstack([lum * 1.01, lum * 0.995, lum * 0.97]) * (1 - 0.3 * green)[..., None]
    out = grey
    out = out * (1 - green[..., None]) + grey * green[..., None]
    d = os.path.join(K.TEX_DIR, tid)
    os.makedirs(d, exist_ok=True)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(os.path.join(d, f"{tid}_1K-JPG_Color.jpg"), quality=92)
    Image.open(T["NormalGL"]).convert("RGB").save(os.path.join(d, f"{tid}_1K-JPG_NormalGL.jpg"), quality=92)
    Image.open(T["Roughness"]).convert("L").save(os.path.join(d, f"{tid}_1K-JPG_Roughness.jpg"), quality=92)
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


# ---------------------------------------------------------------- the level

class Level:
    def __init__(self, K):
        from shapely.geometry import Point, Polygon, box
        from shapely.ops import unary_union
        self.K = K
        K.TEXTURES.update(TEX)
        asphalt_texture(K)
        sett_texture(K)
        paint_texture(K)
        tactile_texture(K, "OETactileBar", False)
        tactile_texture(K, "OETactileDot", True)
        self.geo = K.Geo()
        self.A = K.Atlas(512, 512)
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
        self.carriageway()
        self.markings()
        self.pavements()
        self.tactile()
        self.guards()
        self.lamps()
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
                                 low=(-0.9, 4.6), mat="metal_pole", light="glow_lamp", rgb=(1.0, 0.9, 0.76), power=230.0)
                    d += 26.0
                else:
                    d += 3.0
        self.lamp_at = placed


def build(K):
    """(geo, atlas, materials, meta) for blender/build_hero.py."""
    L = Level(K)
    geo, atlas = L.build()
    M = materials()
    # the pavements, the square, kerbs and gutters in close tones of one grey family (AGENTS.md, "The bar"): each
    # texture brought to its tone by its own mean, so that a yellowish block and a brown sett end as greys
    for mat, key, srgb in (("ground_paver", "paver", (150, 150, 148)), ("ground_sett", "sett", (138, 138, 137)),
                           ("ground_kerb", "granite", (160, 160, 158)), ("ground_gutter", "conc", (152, 152, 150))):
        M[mat]["tint"] = K.tint_to(key, srgb)
    meta = {"id": ID, "at": list(CENTRE), "r": R, "z": 15.0, "glb": f"hero/{ID}.glb", "bake_gain": 1.0, "cell": 28.0}
    return geo, atlas, M, meta
