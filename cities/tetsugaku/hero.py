"""The head of the Philosopher's Path, the Tetsugaku map's hero level (blender/build_hero.py --city
tetsugaku; docs/HERO.md).

Why here: 哲学の道 begins at Ginkakuji-bashi, where the Lake Biwa Canal's branch (疏水分線) turns south along
the foot of the hills. The view from the bridge down the first hundred metres (the canal between its mossy
stone walls, the earth path with its two rows of granite slabs, the cherries over both) is the photograph
everyone takes of the path, and the game now opens on it. The level is that stretch: from the bridge past
the second bridge to the third, 115 m of canal, and nothing behind the houses either side.

What is built, over the city's own canal (web/inland.js draws its water, bed and plain walls):

  * the canal's walls: random rubble in mortar, battered, green with moss, under an edging of granite;
  * the west bank, the path itself: a strip of moss at the wall's top, compacted earth, the two rows of
    granite slabs laid as stepping stones (each its own stone, of its own length), a verge of moss and
    fallen leaves, clipped azaleas, timber posts with a rope between them, stone benches, the black
    litter bins, a notice board, vending machines, and at the bridge the boulder and the timber post that
    name the path;
  * the east bank: a mossy verge with shrubs and the lane's asphalt;
  * the three bridges' granite balustrades (posts, two rails, a kerb);
  * two utility poles on the lane with their street lights, and the vending machines' glow, for the night.

The cherries are the city's own trees (cities/tetsugaku/city.py plants one every few metres), and so are
the houses. The canal has no railing here (OpenStreetMap maps ropes and hedges, and the photographs show
none), so the map's generic railing is taken off this canal (city.json water.inland.lines "rail": false).
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
import hero_parts as HP  # noqa: E402
from hero_parts import Path, unit  # noqa: E402

ID = "tetsugaku"
UP = np.array([0.0, 0.0, 1.0])
BOX = (273.0, 905.0, 345.0, 1040.0)     # the stretch of the canal the level takes (x0, y0, x1, y1)
D0, D1 = 9.0, 124.0                     # along the west bank from Ginkakuji-bashi (metres of the bank's line)
EARTH, SLAB = 0.08, 0.115               # the path's earth and its slabs over the ground

TEX = {
    "rubble": ("Bricks089", 2.2),       # random rubble in mortar: the canal's walls
    "granite": ("Granite001A", 1.6),    # the slabs, the edging, the bridges' balustrades
    "earth": ("Ground069", 2.6),        # compacted earth with grit: the path
    "moss": ("OEMoss001m", 1.8),        # moss with needles and litter (ambientCG Moss001, its gloss taken off)
    "verge": ("OEGround068m", 2.4),     # moss and red-brown litter: the verges (ambientCG Ground068, rougher)
    "leaf": ("OELeaf001", 1.1),         # hedges and azaleas (drawn: hero_parts.leaf_texture)
    "road": ("OEAsphalt031m", 3.0),     # the lane's asphalt
}


def materials():
    return {
        "ground_earth": {"tex": "earth", "tint": (0.52, 0.5, 0.46)},
        "ground_slab": {"tex": "granite", "tint": (0.5, 0.5, 0.5), "bump": 1.4},
        "ground_slab_b": {"tex": "granite", "tint": (0.42, 0.43, 0.42), "bump": 1.4},
        "ground_moss": {"tex": "moss", "tint": (0.62, 0.7, 0.5)},
        "ground_verge": {"tex": "verge", "tint": (0.5, 0.5, 0.42)},
        "ground_asphalt": {"tex": "road", "tint": (0.33, 0.33, 0.345), "bump": 1.6},
        "ground_joint": {"color": (0.03, 0.028, 0.022), "rough": 0.95},
        "wall_rubble": {"tex": "rubble", "tint": (0.34, 0.4, 0.3), "bump": 1.6},
        "wall_rubble_wet": {"tex": "rubble", "tint": (0.16, 0.2, 0.15), "bump": 1.6},
        "edging": {"tex": "granite", "tint": (0.4, 0.43, 0.38), "bump": 1.4},
        "granite": {"tex": "granite", "tint": (0.46, 0.47, 0.45), "bump": 1.4},
        "boulder": {"tex": "granite", "tint": (0.36, 0.37, 0.33), "bump": 2.0},
        "hedge": {"tex": "leaf", "tint": (0.5, 0.6, 0.45), "bump": 1.5},
        "shrub": {"tex": "leaf", "tint": (0.62, 0.68, 0.45), "bump": 1.5},
        "timber": {"color": (0.17, 0.11, 0.07), "rough": 0.85},
        "rope": {"color": (0.3, 0.22, 0.12), "rough": 0.9},
        "pole": {"tex": "granite", "tint": (0.3, 0.3, 0.29)},
        "metal_dark": {"color": (0.03, 0.032, 0.035), "rough": 0.5, "metal": 0.7},
        "metal_alu": {"color": (0.6, 0.61, 0.62), "rough": 0.4, "metal": 0.9},
        "metal_galv": {"color": (0.42, 0.44, 0.45), "rough": 0.6, "metal": 0.6},
        "metal_white": {"color": (0.74, 0.74, 0.72), "rough": 0.45, "metal": 0.2},
        "porcelain": {"color": (0.8, 0.79, 0.75), "rough": 0.3},
        "cable": {"color": (0.012, 0.012, 0.013), "rough": 0.6},
        "plastic_black": {"color": (0.02, 0.02, 0.022), "rough": 0.45},
        "board": {"map": "atlas", "rough": 0.6},
        "glow_vend": {"map": "atlas", "rough": 0.3, "emissive": True, "glow": 0.5},
        "glow_white": {"color": (0.95, 0.97, 1.0), "emissive": (1.0, 0.9, 0.74), "glow": 2.2},
    }


# ---------------------------------------------------------------- the atlas

def draw_vend(kind):
    """A drinks machine's front: three lit shelves of bottles and cans, the coin panel (no maker's mark)."""
    def draw(img, r):
        from PIL import ImageDraw
        x, y, w, h = r
        rng = np.random.default_rng(20 + kind)
        d = ImageDraw.Draw(img)
        body = [(150, 152, 156), (150, 24, 28), (24, 56, 124)][kind % 3]
        d.rectangle([x, y, x + w, y + h], fill=body)
        d.rectangle([x + w * 0.06, y + h * 0.05, x + w * 0.94, y + h * 0.56], fill=(206, 208, 200))
        pal = [(214, 40, 40), (240, 200, 60), (40, 110, 60), (30, 60, 140), (240, 240, 240), (120, 60, 30), (230, 120, 40), (60, 60, 60)]
        for j in range(3):
            y0 = y + h * (0.07 + j * 0.165)
            for i in range(9):
                cx = x + w * (0.1 + 0.089 * i)
                c = pal[int(rng.integers(len(pal)))]
                d.rectangle([cx, y0 + h * 0.02, cx + w * 0.06, y0 + h * 0.125], fill=c)
                d.rectangle([cx + w * 0.012, y0 + h * 0.005, cx + w * 0.048, y0 + h * 0.022], fill=tuple(int(v * 0.7) for v in c))
                d.rectangle([cx + w * 0.012, y0 + h * 0.133, cx + w * 0.048, y0 + h * 0.146], fill=(40, 90, 200) if rng.random() < 0.6 else (220, 50, 40))
        d.rectangle([x + w * 0.66, y + h * 0.6, x + w * 0.92, y + h * 0.74], fill=(36, 36, 40))
        d.rectangle([x + w * 0.7, y + h * 0.62, x + w * 0.88, y + h * 0.66], fill=(120, 200, 140))
        d.rectangle([x + w * 0.1, y + h * 0.82, x + w * 0.9, y + h * 0.93], fill=(28, 28, 30))
    return draw


def draw_post(img, r):
    """The timber post at the path's head: its name, brushed top to bottom."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(96, 62, 40))
    for k in range(40):
        yy = y + (k * 37) % h
        d.line([(x, yy), (x + w, yy + 3)], fill=(84, 54, 34), width=1)
    ad.vtext(img, (x + w * 0.5, y + h * 0.05), "哲学の道", "mincho", h * 0.2, fill="#f4efe2")


def draw_board(img, r):
    """A walkers' notice board: the path as a line down the canal with its temples named."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w, y + h], fill=(236, 230, 212))
    d.rectangle([x, y, x + w, y + h * 0.12], fill=(70, 50, 36))
    ad.text(img, (x + w / 2, y + h * 0.06), "哲学の道 案内", "mincho", h * 0.07, fill="#f4efe2")
    d.polygon([(x + w * 0.62, y + h * 0.12), (x + w, y + h * 0.12), (x + w, y + h), (x + w * 0.75, y + h)], fill=(170, 196, 150))
    pts = [(x + w * (0.52 + 0.06 * math.sin(k * 0.9)), y + h * (0.16 + 0.8 * k / 12)) for k in range(13)]
    d.line(pts, fill=(90, 140, 190), width=6)
    d.line([(px - 9, py) for px, py in pts], fill=(150, 110, 70), width=3)
    for k, name in ((0, "銀閣寺"), (4, "法然院"), (8, "永観堂"), (12, "南禅寺")):
        px, py = pts[k]
        d.ellipse([px - 26, py - 7, px - 12, py + 7], fill=(190, 50, 40))
        ad.text(img, (x + w * 0.2, py), name, "mincho", h * 0.055, fill="#2a2a2a")


class Level:
    def __init__(self, K):
        self.K = K
        K.TEXTURES.update(TEX)
        HP.leaf_texture(K, "OELeaf001")
        HP.texture_variant(K, "OEMoss001m", "Moss001", rough=(0.3, 0.7), gain=0.9)
        HP.texture_variant(K, "OEGround068m", "Ground068", rough=(0.3, 0.7), gain=0.85)
        HP.texture_variant(K, "OEAsphalt031m", "Asphalt031", rough=(0.6, 0.5))
        self.geo = K.Geo()
        self.A = K.Atlas(1024, 512)
        import archkit as ak
        self.T = ak.Terrain("tetsugaku")
        self.X = HP.Parts(K, self.geo, self.T, self.A)
        self.rng = np.random.default_rng(1922)
        S = json.load(open(os.path.join(ROOT, "web", "data", "tetsugaku", "scene.json")))
        body = next(b for b in S["inland"]["bodies"] if b["name"] == "疏水分線" and min(b["rings"][0][0::2]) < 300 < max(b["rings"][0][0::2]) and max(b["rings"][0][1::2]) > 1000)
        r = np.asarray(body["rings"][0]).reshape(-1, 2)
        bz, wz = np.asarray(body["bz"][0]), np.asarray(body["wz"][0])
        inb = (r[:, 0] > BOX[0]) & (r[:, 0] < BOX[2]) & (r[:, 1] > BOX[1]) & (r[:, 1] < BOX[3])
        idx = np.where(inb)[0]
        chains = np.split(idx, np.where(np.diff(idx) > 1)[0] + 1)
        banks = []
        for c in chains:
            pts = np.c_[r[c], bz[c], wz[c]]
            if pts[0, 1] < pts[-1, 1]:
                pts = pts[::-1]                        # from the bridge south
            keep = [0] + [i for i in range(1, len(pts)) if np.hypot(*(pts[i, :2] - pts[i - 1, :2])) > 0.2]
            banks.append(pts[keep])
        banks.sort(key=lambda p: p[len(p) // 2, 0])
        self.Wb, self.Eb = banks[0], banks[1]          # west (the path's side) and east
        self.W = Path(self.Wb[:, :3])                  # right of the way south: west, away from the water
        self.E = Path(self.Eb[:, :3])                  # right: west, the water; left (negative): the lane
        from shapely.geometry import Polygon
        self.water = Polygon(r).buffer(0)
        self.decks = [Polygon(np.asarray(d).reshape(-1, 2)) for d in S["inland"]["decks"] if BOX[0] < d[0] < BOX[2] and BOX[1] < d[1] < BOX[3]]
        B = json.load(open(os.path.join(ROOT, "web", "data", "tetsugaku", "buildings.json")))
        from shapely.ops import unary_union
        self.houses = unary_union([Polygon(np.asarray(s[4], float).reshape(-1, 2) / 10).buffer(0.3) for s in B["s"]
                                   if BOX[0] - 20 < s[4][0] / 10 < BOX[2] + 20 and BOX[1] - 20 < s[4][1] / 10 < BOX[3] + 20])

    def wzat(self, path, bank, d):
        s = float(np.clip(d + path.s0, 0, path.L))
        return float(np.interp(s, path.s, bank[:, 3]))

    def bzat(self, path, d):
        return float(path.at(d)[0][2])

    def build(self):
        A = self.A
        for k in range(3):
            A.cell(f"vend{k}", 160, 292, draw_vend(k))
        A.cell("post", 64, 320, draw_post)
        A.cell("map", 256, 320, draw_board)
        self.walls()
        self.west()
        self.east()
        self.bridges()
        self.night()
        return self.geo, self.A

    def walls(self):
        """The canal's walls in front of the city's: rubble, battered (its foot 0.28 m into the channel),
        dark and wet at the waterline, an edging of granite along the top."""
        X = self.X
        for path, bank, left in ((self.W, self.Wb, True), (self.E, self.Eb, False)):
            ds = np.arange(0.0, path.L + 0.01, 1.5)
            sgn = -1.0 if left else 1.0      # towards the water
            foot = [path.xy(d, sgn * 0.3) for d in ds]
            top = [self.bzat(path, d) + 0.1 for d in ds]
            wl = [self.wzat(path, bank, d) for d in ds]
            mid = [w + 0.22 for w in wl]
            hb = [t - (w - 0.5) for t, w in zip(top, wl)]
            k = 0.26 / float(np.mean(hb))
            # (the wet band from under the water to a hand over it, then the wall to its top, on one plane)
            X.wall("wall_rubble_wet", foot, [w - 0.5 for w in wl], mid, batter=k, left=left)
            f2 = [path.xy(d, sgn * (0.3 - k * (m - (w - 0.5)))) for d, m, w in zip(ds, mid, wl)]
            X.wall("wall_rubble", f2, mid, top, batter=k, cap="edging", thick=0.5, lip=0.03, left=left, v0=0.72)

    def band(self, path, d0, d1, o0, o1):
        return path.band(d0, d1, o0, o1, step=1.5)

    def west(self):
        """The path: moss at the wall's top, earth, the two rows of slabs, the verge with its azaleas, posts
        and rope; benches, bins, the notice board, vending machines; the boulder and post at its head."""
        G, A, X, W, rng = self.geo, self.A, self.X, self.W, self.rng
        from shapely.geometry import Point
        from shapely.ops import unary_union
        clear = unary_union(self.decks).buffer(0.2) if self.decks else None
        cut = lambda p: p.difference(self.houses) if clear is None else p.difference(self.houses).difference(clear)
        X.cover("ground_moss", cut(self.band(W, D0, D1, 0.5, 1.02)), EARTH + 0.01, cell=1.5)
        X.cover("ground_earth", cut(self.band(W, D0 - 3, D1, 1.0, 4.3)), EARTH, cell=1.5)
        X.cover("ground_verge", cut(self.band(W, D0, D1, 4.25, 5.9)), EARTH - 0.015, cell=1.5)
        # the slabs: two rows, each stone its own length, the rows out of step, a dark joint round each
        f = lambda d, o, h: X.G(W.xy(d, o), h)
        for row, o in enumerate((1.62, 2.24)):
            d = D0 - 2.0 + row * 0.47
            while d < D1 - 1.2:
                L = float(rng.uniform(0.62, 1.15))
                w = 0.52 + 0.04 * rng.standard_normal()
                oo = o + 0.03 * rng.standard_normal()
                X.strip("ground_joint", f, d - 0.025, d + L + 0.025, [oo - w / 2 - 0.025, oo + w / 2 + 0.025], SLAB - 0.012, step=0.6)
                X.strip("ground_slab" if rng.random() < 0.6 else "ground_slab_b", f, d, d + L, [oo - w / 2, oo + w / 2], SLAB, step=0.6, uvk=1.0 + 0.2 * rng.random())
                d += L + float(rng.uniform(0.05, 0.11))
        # the low hedge along the wall's top over the first stretch, in three runs
        for (a, b, s) in ((16.0, 27.0, 1), (33.0, 46.0, 2), (70.0, 84.0, 3)):
            X.hedge("hedge", [X.G(W.xy(d, 0.8), EARTH) for d in np.arange(a, b + 0.01, 1.0)], 0.5, 0.3, seed=s)
        # azaleas, timber posts and a rope along the path's far edge, where no house stands in the way
        open_at = lambda d, o: not self.houses.buffer(0.8).contains(Point(*W.xy(d, o)))
        k = 0
        for d in np.arange(D0 + 2, D1 - 2, 2.3):
            if not open_at(d, 5.0):
                continue
            s = 0.5 + 0.22 * ((k * 7) % 5) / 4
            X.bush("shrub" if k % 3 else "hedge", X.G(W.xy(d + 0.4 * math.sin(k), 5.0 + 0.3 * math.cos(k * 1.7)), -0.05), s, s * 0.95, seed=500 + k)
            k += 1
        run = []
        for d in np.arange(D0 + 1.5, D1, 2.6):
            if open_at(d, 4.6) and (clear is None or not clear.buffer(2.5).contains(Point(*W.xy(d, 4.25)))):
                run.append(X.G(W.xy(d, 4.25), EARTH - 0.02))
            else:
                self.rope(run); run = []
        self.rope(run)
        # stone benches, litter bins and the notice board, at the places OpenStreetMap maps them
        for d in (27.0, 55.0, 97.0):
            self.bench(d, 3.55)
        for d in (22.0, 30.5, 78.0):
            c = X.G(W.xy(d, 3.7), EARTH)
            G.cylinder("plastic_black", c, 0.27, 0.72, 14, cap=False)
            X.bush("plastic_black", c + UP * 0.7, 0.29, 0.2, seed=int(d), lumps=0.0)
        c, t, r = W.at(25.0)
        b = X.G(W.xy(25.0, 3.9), EARTH)
        for s in (-0.55, 0.55):
            G.box("timber", b + np.r_[t, 0] * s, (np.r_[t, 0], np.r_[r, 0]), (0.1, 0.1, 1.9))
        G.box("timber", b + UP * 1.86, (np.r_[t, 0], np.r_[r, 0]), (1.4, 0.3, 0.06))
        X.panel("board", b + UP * 1.2 - np.r_[r, 0] * 0.06, -r, (1.0, 1.25), "map", back="timber")
        # vending machines against the houses (OpenStreetMap maps five along this stretch)
        for k, (d, o) in enumerate(((38.0, 4.9), (62.0, 5.0), (66.5, 5.0), (104.0, 4.9))):
            self.vending(X.G(W.xy(d, o), EARTH - 0.02), np.r_[W.at(d)[1], 0], -np.r_[W.at(d)[2], 0], k % 3)
        # the head of the path: a boulder and the timber post that names it
        c = X.G(W.xy(D0 + 1.5, 3.6), EARTH - 0.1)
        X.bush("boulder", c, 0.85, 0.7, seed=77, lumps=0.3)
        p = X.G(W.xy(D0 + 3.4, 3.7), EARTH)
        G.box("timber", p, (np.r_[W.at(D0)[1], 0], np.r_[W.at(D0)[2], 0]), (0.2, 0.2, 1.95))
        fwd = -W.at(D0 + 3)[1]            # towards the bridge: read as you step onto the path
        X.panel("board", p + UP * 1.15 + np.r_[fwd, 0] * 0.105, fwd, (0.19, 1.45), "post")

    def rope(self, run):
        if len(run) < 2:
            return
        G = self.geo
        for a in run:
            G.cylinder("timber", a, 0.06, 0.82, 8)
        for a, b in zip(run, run[1:]):
            self.X.wire(a + UP * 0.7, b + UP * 0.7, 0.12, 0.014, mat="rope", n=6)

    def bench(self, d, o):
        """A granite bench: a slab on two blocks, along the path."""
        G, X, W = self.geo, self.X, self.W
        c = X.G(W.xy(d, o), EARTH)
        t, r = np.r_[W.at(d)[1], 0], np.r_[W.at(d)[2], 0]
        for s in (-0.6, 0.6):
            G.box("granite", c + t * s, (t, r), (0.22, 0.4, 0.36))
        G.box("granite", c + UP * 0.36, (t, r), (1.7, 0.46, 0.1))

    def vending(self, c, t, n, kind):
        G, A = self.geo, self.A
        w, d, h = 1.0, 0.72, 1.83
        G.box("metal_white", c, (t, n), (w, d, h), faces=("+u", "-u", "top", "-v"))
        f = c + n * (d / 2 + 0.005)
        q = (f - t * (w / 2), f + t * (w / 2), f + t * (w / 2) + UP * h, f - t * (w / 2) + UP * h)
        if np.dot(np.cross(q[1] - q[0], q[3] - q[0]), n) < 0:
            q = (q[1], q[0], q[3], q[2])
        G.quad("glow_vend", *q, uv=A.uv(f"vend{kind}"), emit=(A.mean[f"vend{kind}"], 0.9), n=n)

    def east(self):
        """The east bank: a verge of moss and shrubs along the wall, and the lane."""
        X, E = self.X, self.E
        from shapely.ops import unary_union
        clear = unary_union(self.decks).buffer(0.2)
        X.cover("ground_verge", self.band(E, 4.0, E.L - 2, -1.7, -0.5).difference(clear), EARTH + 0.01, cell=1.5)
        X.cover("ground_asphalt", self.band(E, 2.0, E.L - 2, -5.2, -1.65).difference(self.houses), EARTH, cell=1.5)
        k = 0
        for d in np.arange(6.0, E.L - 4, 3.1):
            from shapely.geometry import Point
            if clear.buffer(1.5).contains(Point(*E.xy(d, -1.1))):
                continue
            s = 0.4 + 0.2 * ((k * 5) % 4) / 3
            X.bush("shrub" if k % 2 else "hedge", X.G(E.xy(d, -1.1), -0.05), s, s * 0.9, seed=700 + k)
            k += 1

    def bridges(self):
        """A granite balustrade along each edge of the three bridges that stands over the water: end posts,
        posts between, two rails and a kerb."""
        G = self.geo
        for dk in self.decks:
            co = np.asarray(dk.exterior.coords)[:-1]
            n = len(co)
            for i in range(n):
                a, b = co[i], co[(i + 1) % n]
                L = np.linalg.norm(b - a)
                mid = (a + b) / 2
                from shapely.geometry import Point
                u = (b - a) / L
                out = np.array([u[1], -u[0]])
                if dk.contains(Point(*(mid + out * 0.3))):
                    out = -out
                if L < 2.0 or not self.water.contains(Point(*(mid + out * 0.6))):
                    continue
                z = self.T(*(mid - out * 0.8)) + 0.1
                t3, o3 = np.r_[u, 0], np.r_[out, 0]
                a3, b3 = np.r_[a - out * 0.2 - u * 0.5, z], np.r_[b - out * 0.2 + u * 0.5, z]
                L2 = np.linalg.norm(b3 - a3)
                G.box("granite", (a3 + b3) / 2, (t3, o3), (L2, 0.3, 0.18))
                m = max(1, int(round(L2 / 1.7)))
                for k in range(m + 1):
                    p = a3 + (b3 - a3) * k / m
                    end = k in (0, m)
                    G.box("granite", p, (t3, o3), (0.34, 0.34, 1.12) if end else (0.2, 0.22, 0.92))
                    if end:
                        G.box("granite", p + UP * 1.12, (t3, o3), (0.4, 0.4, 0.08))
                for zz, hh, ww in ((0.74, 0.15, 0.2), (0.36, 0.1, 0.14)):
                    G.box("granite", (a3 + b3) / 2 + UP * zz, (t3, o3), (L2 - 0.3, ww, hh))

    def night(self):
        """Two utility poles on the lane with their street lights, and their wires."""
        X, E = self.X, self.E
        hd = math.atan2(E.at(30)[2][1], E.at(30)[2][0])
        P = [X.G(E.xy(d, -1.85), 0.05) for d in (14.0, 52.0, 92.0)]
        W = [X.pole(p, h=10.5, arms=[(10.2, hd)], lamp=E.at(d)[2], transformer=(i == 1), lamp_z=5.6, lamp_k=260.0, lamp_rgb=(1.0, 0.86, 0.68))
             for i, (p, d) in enumerate(zip(P, (14.0, 52.0, 92.0)))]
        for a, b in zip(W, W[1:]):
            for kind, r_, sag in (("hv", 0.008, 0.3), ("lv", 0.011, 0.5), ("tel", 0.02, 0.7)):
                for p, q in zip(a[kind], b[kind]):
                    X.wire(p, q, sag, r_)


def build(K):
    """(geo, atlas, materials, meta) for blender/build_hero.py."""
    L = Level(K)
    geo, atlas = L.build()
    c = L.W.xy(62.0)
    meta = {"id": ID, "at": [round(float(c[0]), 1), round(float(c[1]), 1)], "r": 70.0, "z": 75.0, "glb": f"hero/{ID}.glb", "bake_gain": 1.0,
            "start": [round(float(v), 1) for v in L.W.xy(D0 + 3.0, 1.9)], "facing": [round(float(v), 1) for v in L.W.xy(60.0, 1.5)]}
    return geo, atlas, materials(), meta
