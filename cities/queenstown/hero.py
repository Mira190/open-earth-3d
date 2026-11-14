"""The Skyline deck on Bob's Peak, the Queenstown map's hero level (python blender/build_hero.py --city
queenstown; docs/HERO.md).

Why here: the game starts on this deck, and the view from its balustrade (the bay, the Gardens, the Kelvin
Peninsula, the Remarkables over the lake) is the most photographed in New Zealand. Nothing else stands within
300 m of the start but the hillside: the town's waterfront is 450 m below. So the level is the deck itself,
26 m by 3.6 m, where the camera's nearest metres are: what the player's feet, hands and eyes are next to.

The deck, its steel frame, its glass and its planters are the map's own landmark meshes (city.py DECK,
measured from LINZ's aerial photographs and LiDAR); the dining room behind the glass is interiors.py's. This
level lays over them, a centimetre or two proud:

  * the boards: grooved hardwood decking with its grain, joints and fixings' shadow, in place of a flat colour;
  * the balustrade's hardware: the shoe the glass stands in, a round stainless handrail on its brackets, the
    posts' base plates and clamps;
  * the planter's face to the deck clad in stacked Otago schist under a hardwood coping, a seat's height;
  * on the deck: two coin-operated viewers on their pedestals, an interpretive panorama that names what the
    view holds, two backless benches against the planter, two patio heaters by the doors;
  * after dark: the heaters' burners, the panorama's lamp, and the light they throw on boards and stone, baked.

The frame is the deck's own: u along it (north-east positive), v out over the slope, h above its boards.
The viewers, the panorama, the benches, the heaters and the schist cladding are placed by design, not
surveyed; the panorama's names are LINZ's place names.
"""
import importlib.util
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "blender"))

import adkit as ad  # noqa: E402
import hero_parts as hp  # noqa: E402

ID = "skyline-deck"
DECK = {"at": (-975.0, 478.1), "along_deg": 49.5, "length": 26.0, "depth": 3.6, "z": 474.6}   # city.py DECK
LIFT_B = 1.35           # the lift shaft's half width across the deck's south-west end (city.py LIFT)
DOOR = (3.3, 5.7)       # the gap in the planter at the restaurant's doors (interiors.py HALL, with its margins)


def materials(K):
    T = K.tint_to
    return {
        "ground_deck": {"tex": "deck", "tint": T("deck", (118, 92, 70)), "rough": 0.7},
        "stone_schist": {"tex": "rubble", "tint": T("rubble", (112, 114, 110)), "rough": 0.9, "maps": "cn"},
        "wood_coping": {"tex": "deck", "tint": T("deck", (128, 96, 66)), "rough": 0.6, "maps": "c"},
        "wood_bench": {"color": (0.3, 0.17, 0.09), "rough": 0.6},
        "metal_steel": {"color": (0.62, 0.63, 0.64), "rough": 0.28, "metal": 1.0},
        "metal_dark": {"color": (0.035, 0.037, 0.04), "rough": 0.45, "metal": 0.7},
        "metal_viewer": {"color": (0.36, 0.38, 0.4), "rough": 0.38, "metal": 0.9},
        "paint_viewer": {"color": (0.02, 0.09, 0.2), "rough": 0.4},
        "glass_lens": {"color": (0.02, 0.03, 0.05), "rough": 0.03, "metal": 0.6},
        "rubber": {"color": (0.02, 0.02, 0.02), "rough": 0.9},
        "atlas_flat": {"map": "atlas", "rough": 0.5},
        "glow_panel": {"map": "atlas", "rough": 0.4, "emissive": True, "glow": 0.5},
        "glow_lamp": {"color": (1.0, 0.95, 0.85), "emissive": (1.0, 0.86, 0.66), "glow": 5.0},
        "glow_flame": {"color": (1.0, 0.5, 0.15), "emissive": (1.0, 0.36, 0.08), "glow": 3.0},
    }


def draw_panorama(img, r):
    """The interpretive panel: the view in outline, each thing named along a leader."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(232, 228, 216))
    d.rectangle([x, y, x + w - 1, y + int(h * 0.13)], fill=(34, 52, 58))
    ad.text(img, (x + w * 0.02, y + h * 0.065), "THE VIEW FROM BOB'S PEAK  ·  TE TAUMATA-O-HAKITEKURA", "bebas", h * 0.075, fill=(236, 232, 220), anchor="lm", max_w=w * 0.8)
    ad.text(img, (x + w * 0.98, y + h * 0.065), "790 m", "bebas", h * 0.075, fill=(214, 170, 90), anchor="rm")
    # the skyline: the Remarkables' saw edge on the left, Cecil and Walter Peaks across the lake to the right
    rng = np.random.default_rng(5)
    hz = y + h * 0.66
    ridge = []
    for i in range(0, w + 1, 6):
        t = i / w
        m = 0.30 * math.exp(-((t - 0.3) / 0.16) ** 2) + 0.22 * math.exp(-((t - 0.66) / 0.07) ** 2) + 0.2 * math.exp(-((t - 0.86) / 0.08) ** 2) + 0.05
        m += 0.03 * math.sin(t * 90) * math.exp(-((t - 0.3) / 0.16) ** 2) + rng.normal(0, 0.004)
        ridge.append((x + i, hz - m * h))
    d.polygon(ridge + [(x + w, hz), (x, hz)], fill=(150, 160, 168))
    d.line(ridge, fill=(60, 70, 78), width=2)
    d.rectangle([x, int(hz), x + w - 1, y + int(h * 0.8)], fill=(92, 138, 156))                       # the lake
    d.polygon([(x + w * 0.1, hz + h * 0.14), (x + w * 0.34, hz + h * 0.05), (x + w * 0.52, hz + h * 0.09), (x + w * 0.44, hz + h * 0.14)], fill=(88, 112, 78))   # the Gardens
    d.polygon([(x + w * 0.5, hz + h * 0.04), (x + w * 0.8, hz + h * 0.02), (x + w * 0.74, hz + h * 0.07)], fill=(108, 122, 90))                              # Kelvin Peninsula
    d.rectangle([x, y + int(h * 0.8), x + w - 1, y + h - 1], fill=(120, 124, 112))                    # the town
    names = [(0.22, 0.2, "THE REMARKABLES  ·  KAWARAU"), (0.33, 0.26, "DOUBLE CONE 2319 m"), (0.66, 0.3, "CECIL PEAK 1978 m"), (0.86, 0.33, "WALTER PEAK 1800 m"),
             (0.56, 0.72, "LAKE WHAKATIPU"), (0.3, 0.775, "QUEENSTOWN GARDENS"), (0.7, 0.705, "KELVIN PENINSULA"), (0.14, 0.9, "QUEENSTOWN BAY  ·  TĀHUNA")]
    for (tx, ty, s) in names:
        ad.text(img, (x + w * tx, y + h * ty), s, "bebas", h * 0.055, fill=(28, 34, 38), max_w=w * 0.3)


def draw_coin(img, r):
    """A viewer's coin plate."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(176, 178, 180))
    ad.text(img, (x + w / 2, y + h * 0.22), "VIEWER", "bebas", h * 0.2, fill=(20, 30, 50))
    ad.text(img, (x + w / 2, y + h * 0.5), "$2", "bebas", h * 0.3, fill=(150, 30, 24))
    d.rectangle([x + w * 0.42, y + h * 0.74, x + w * 0.58, y + h * 0.78], fill=(10, 10, 10))
    ad.text(img, (x + w / 2, y + h * 0.9), "2 MINUTES", "bebas", h * 0.11, fill=(20, 30, 50))


class Level:
    def __init__(self, K):
        self.K = K
        self.geo = K.Geo()
        self.A = K.Atlas(1024, 512)
        a = math.radians(DECK["along_deg"])
        self.ax = np.array([math.sin(a), math.cos(a)])
        self.out = np.array([self.ax[1], -self.ax[0]])
        self.c = np.array(DECK["at"])
        self.z = DECK["z"]
        self.rep = {k: v[1] for k, v in K.TEXTURES.items()}
        self.L, self.D = DECK["length"], DECK["depth"]
        # the deck as a wall's frame laid along its back edge, facing out: P(u from the south-west end, out, z)
        self.F = hp.Frame(self.xy(-self.L / 2, -self.D / 2), self.xy(self.L / 2, -self.D / 2))

    def xy(self, u, v):
        return self.c + self.ax * u + self.out * v

    def P(self, u, v, h=0.0):
        q = self.xy(u, v)
        return np.array([q[0], q[1], self.z + h])

    def build(self):
        A = self.A
        A.cell("panorama", 1000, 300, draw_panorama)
        A.cell("coin", 96, 128, draw_coin)
        self.boards()
        self.balustrade()
        self.planter()
        self.things()
        return self.geo, A

    def boards(self):
        geo, L, D, rep = self.geo, self.L, self.D, self.rep["deck"]
        # the boards run along the deck; laid in panels so that the bake has vertices to light
        nu, nv = 26, 4
        for i in range(nu):
            for j in range(nv):
                u0, u1 = -L / 2 + L * i / nu, -L / 2 + L * (i + 1) / nu
                v0, v1 = -D / 2 + D * j / nv, -D / 2 + D * (j + 1) / nv
                geo.quad("ground_deck", self.P(u0, v0, 0.018), self.P(u1, v0, 0.018), self.P(u1, v1, 0.018), self.P(u0, v1, 0.018),
                         uv=[(u0 / rep, v0 / rep), (u1 / rep, v0 / rep), (u1 / rep, v1 / rep), (u0 / rep, v1 / rep)], n=(0, 0, 1.0))
        # the joints where the boards' ends meet over a bearer, every 4 m, and their fixings
        fine = self.geo.fine
        for u in np.arange(-L / 2 + 1, L / 2, 4.0):
            fine.quad("rubber", self.P(u - 0.004, -D / 2, 0.021), self.P(u + 0.004, -D / 2, 0.021), self.P(u + 0.004, D / 2, 0.021), self.P(u - 0.004, D / 2, 0.021), n=(0, 0, 1.0))
            for v in np.arange(-D / 2 + 0.07, D / 2, 0.14):
                for du in (-0.03, 0.03):
                    hp.disc(fine, "metal_steel", self.xy(u + du, v), 0.005, self.z + 0.0215, segs=5)
        self.geo.walls.append((self.xy(-L / 2, -D / 2), self.xy(L / 2, -D / 2), self.z, self.z + 0.5))

    def balustrade(self):
        geo, fine, L, D = self.geo, self.geo.fine, self.L, self.D
        runs = (((-L / 2, D / 2), (L / 2, D / 2)), ((-L / 2, LIFT_B), (-L / 2, D / 2)), ((L / 2, -D / 2), (L / 2, D / 2)))
        for (u0, v0), (u1, v1) in runs:
            a, b = self.P(u0, v0), self.P(u1, v1)
            t = hp.unit(b - a)
            s = np.array([-t[1], t[0], 0.0])
            ln = np.linalg.norm(b - a)
            # the shoe the glass stands in, and a round handrail over the map's flat one
            geo.box("metal_dark", (a + b) / 2 + [0, 0, 0.02], (t, s), (ln, 0.1, 0.1))
            geo.tube("metal_steel", [a + [0, 0, 1.165], b + [0, 0, 1.165]], 0.027, segs=10)
            n = max(1, int(ln / 1.5))
            for k in range(n + 1):
                p = a + (b - a) * k / n
                geo.box("metal_dark", p + [0, 0, 0.02], (t, s), (0.16, 0.16, 0.012))           # the post's base plate
                fine.box("metal_steel", p + [0, 0, 1.115], (t, s), (0.04, 0.05, 0.05))         # the rail's saddle
                for h in (0.35, 0.85):                                                         # the glass's clamps
                    for sd in (-1, 1):
                        fine.box("metal_steel", p + t * sd * 0.065 + [0, 0, h], (t, s), (0.05, 0.03, 0.07))
                for q in (-1, 1):
                    for w in (-1, 1):
                        fine.cylinder("metal_steel", p + t * q * 0.06 + s * w * 0.06 + [0, 0, 0.032], 0.008, 0.008, segs=6)

    def planter(self):
        """The planter's face to the deck in stacked schist, under a hardwood coping at a seat's height."""
        geo, F, L, D = self.geo, self.F, self.L, self.D
        rs = self.rep["rubble"]
        for (ua, ub) in ((0.0, DOOR[0] + L / 2), (DOOR[1] + L / 2, L)):
            hp.wall(geo, "stone_schist", F, ua, ub, self.z, self.z + 0.45, 0.05, rs, sub=1.5)
            for u in (ua, ub):       # its ends, returned
                e = hp.Frame(F.P(u, -0.3, 0), F.P(u, 0.05, 0), flip=(u == ua))
                hp.wall(geo, "stone_schist", e, 0.0, 0.35, self.z, self.z + 0.45, 0.0, rs)
            hp.fbox(geo, "wood_coping", F, ua - 0.02, ub + 0.02, -0.16, 0.11, self.z + 0.45, self.z + 0.5, self.rep["deck"])

    def viewer(self, u, v):
        """A coin-operated binocular viewer on its pedestal, looking out over the rail."""
        geo, fine = self.geo, self.geo.fine
        c = self.P(u, v, 0.02)
        o, a = np.r_[self.out, 0.0], np.r_[self.ax, 0.0]
        geo.lathe("metal_viewer", c, [(0.2, 0.0), (0.2, 0.03), (0.09, 0.07), (0.075, 0.9), (0.1, 0.94), (0.1, 1.0), (0.05, 1.04), (0.05, 1.16)], segs=14)
        geo.box("metal_viewer", c + [0, 0, 1.16], (a, o), (0.34, 0.1, 0.06))                    # the yoke
        for sd in (-1, 1):
            geo.box("metal_viewer", c + a * sd * 0.15 + [0, 0, 1.2], (a, o), (0.04, 0.1, 0.2))
        body = c + [0, 0, 1.36]
        geo.box("paint_viewer", body - [0, 0, 0.11], (a, o), (0.3, 0.42, 0.22))
        for sd in (-1, 1):       # the two barrels, their lenses and eyepieces
            p0, p1 = body + a * sd * 0.075 - o * 0.3, body + a * sd * 0.075 + o * 0.36
            geo.tube("metal_viewer", [p0, p1], 0.062, segs=12)
            hp.disc(geo, "glass_lens", p1[:2] + self.out * 0.002, 0.055, p1[2], n=o, segs=12)
            fine.tube("rubber", [p0 - o * 0.04, p0], 0.04, segs=10)
            fine.tube("metal_steel", [p1 - o * 0.02, p1 + o * 0.004], 0.066, segs=12)
        geo.box("metal_viewer", c + o * -0.02 + a * 0.24 + [0, 0, 1.2], (a, o), (0.12, 0.16, 0.2))  # the coin box
        q = c + a * 0.301 + o * -0.02 + [0, 0, 1.22]
        geo.quad("atlas_flat", q - o * 0.06, q + o * 0.06, q + o * 0.06 + [0, 0, 0.16], q - o * 0.06 + [0, 0, 0.16], uv=self.A.uv("coin"))
        fine.box("metal_steel", c + [0, 0, 0.26], (a, o), (0.3, 0.34, 0.02))                      # a child's step
        fine.box("metal_steel", c - o * 0.14 + [0, 0, 0.0], (a, o), (0.03, 0.03, 0.26))

    def panorama(self, u):
        """The interpretive panel on its lectern at the rail, lit from under its hood after dark."""
        geo = self.geo
        D = self.D
        o, a = np.r_[self.out, 0.0], np.r_[self.ax, 0.0]
        w = 2.2
        for sd in (-1, 1):
            geo.box("metal_dark", self.P(u + sd * (w / 2 - 0.1), D / 2 - 0.55, 0.02), (a, o), (0.06, 0.06, 0.86))
        lo, hi = self.P(u, D / 2 - 0.78, 0.84), self.P(u, D / 2 - 0.3, 1.02)
        t = hi - lo
        geo.quad("glow_panel", lo - a * w / 2, lo + a * w / 2, hi + a * w / 2, hi - a * w / 2, uv=self.A.uv("panorama"),
                 emit=(self.A.mean["panorama"], 0.25))
        nrm = hp.unit(np.cross(a, t))
        geo.quad("metal_dark", hi - a * w / 2 - nrm * 0.03, hi + a * w / 2 - nrm * 0.03, lo + a * w / 2 - nrm * 0.03, lo - a * w / 2 - nrm * 0.03)
        for (p, q) in ((lo - a * w / 2, lo + a * w / 2), (hi - a * w / 2, hi + a * w / 2)):
            geo.tube("metal_dark", [p, q], 0.018, segs=6)

    def heater(self, u, v):
        """A patio heater: a weighted base, a post, the burner under its dish."""
        geo = self.geo
        c = self.P(u, v, 0.02)
        geo.lathe("metal_steel", c, [(0.24, 0.0), (0.24, 0.04), (0.2, 0.5), (0.05, 0.56), (0.03, 0.6), (0.03, 1.75), (0.07, 1.78)], segs=14)
        geo.lathe("glow_flame", c, [(0.07, 1.78), (0.075, 2.02)], segs=12)
        geo.lathe("metal_steel", c, [(0.07, 2.02), (0.1, 2.06), (0.42, 2.16), (0.43, 2.14), (0.1, 2.03)], segs=18)
        self.geo.emitters.append((c + [0, 0, 1.9], np.array([0, 0, -1.0]), 1.0, np.array([1.0, 0.45, 0.14]) * 9))
        for k in range(4):
            th = math.pi / 4 + k * math.pi / 2
            d = np.array([math.cos(th), math.sin(th), 0.0])
            self.geo.emitters.append((c + d * 0.1 + [0, 0, 1.9], d, 1.0, np.array([1.0, 0.45, 0.14]) * 5))

    def things(self):
        L, D = self.L, self.D
        self.viewer(-7.6, D / 2 - 0.5)
        self.viewer(8.4, D / 2 - 0.5)
        self.panorama(0.6)
        # (the panel's lamp: a strip under the rail's line, and its light on the boards)
        p = self.P(0.6, D / 2 - 0.25, 1.06)
        a = np.r_[self.ax, 0.0]
        o = np.r_[self.out, 0.0]
        self.geo.quad("glow_lamp", p - a * 1.0 - o * 0.02, p - a * 1.0 + o * 0.02, p + a * 1.0 + o * 0.02, p + a * 1.0 - o * 0.02, n=(0, 0, -1.0))
        for du in (-0.6, 0.0, 0.6):
            self.geo.emitters.append((p + a * du - [0, 0, 0.03], hp.unit([-o[0] * 0.5, -o[1] * 0.5, -1.0]), 1.0, np.array([1.0, 0.86, 0.66]) * 2.2))
        ang = math.atan2(self.out[1], self.out[0])
        for u in (-9.3, -1.6, 10.2):
            hp.bench(self.geo, self.xy(u, -D / 2 + 0.42), ang, self.z + 0.02, w=1.8, back=False)
        self.heater(DOOR[0] - 0.7, -D / 2 + 0.45)
        self.heater(DOOR[1] + 0.7, -D / 2 + 0.45)


def build(K):
    """(geo, atlas, materials, meta) for blender/build_hero.py."""
    L = Level(K)
    geo, atlas = L.build()
    meta = {"id": ID, "at": [float(DECK["at"][0]), float(DECK["at"][1])], "r": 16.0, "z": DECK["z"], "glb": f"hero/{ID}.glb",
            "fine": f"hero/{ID}_fine.glb", "fine_cell": 9.0, "bake_gain": 0.6}
    return geo, atlas, materials(K), meta
