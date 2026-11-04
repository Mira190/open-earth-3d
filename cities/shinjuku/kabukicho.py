"""Kabukicho and the east exit at street level, as they stand in autumn 2026.

cities/shibuya/city.py places Kabukicho's arch, the east exit's screens and the districts' shop signs
for both Tokyo maps; this module draws, in the Shinjuku map only, what a walker sees there, from
OpenStreetMap's hand-mapped detail (cities/shinjuku/kabukicho_osm.json, pipeline/osm_detail.py) and
photographs (Wikimedia Commons, 2023-2026; see docs/cities/shinjuku.md):

  * Kabukicho Ichibangai's arch (1969, its 55th year in 2025) as it is now: two grey stone pillars,
    and on them a red box-section ribbon that loops over the street, a lower band and an upper one
    joined at the posts, studded with two rows of bulbs on both faces; the white sign 歌舞伎町一番街
    in red between the bands, the same both ways. Sizes are estimates from photographs, scaled from
    the 8.6 m between the pillars (the street between the corner buildings, buildings.json).
  * Ichibangai, Central Road (Godzilla Road) and Sakura-dori: the tenant stacks that make
    Kabukicho's canyon, a tall sign standing out from each front, one panel a floor, the floor on
    each (the trades are typical; the names are invented, not the real tenants'); a lit box over
    each shop front; the lantern street lamps on OSM's lamp positions.
  * The kaiju on the Shinjuku Toho Building's eighth-floor terrace: a head 12 m tall with its top
    about 52 m above the street (Toho, April 2015), looking down Central Road. This one is sculpted
    for the model, a generic reptile with an open jaw and a row of dorsal plates, not Toho's figure.
  * Studio Alta (新宿ダイビル, 1980): closed on 28 February 2025 and pulled down from 25 April 2025;
    by July 2026 the lot was clear (Daibiru; reports from the site). Its solids are left out, and
    a white hoarding stands round the lot.
  * The Unica building's names over Yasukuni-dori, read from the arch: UNIKA BLDG. over its screens,
    the GOLF5 flagship's green box and Alpen TOKYO over the shop floors (the store opened in 2022).

The words are the buildings' and shops' own names, set in open fonts, not their logos.
Everything is built in the city's local frame (x east, y north, z up, metres).
"""
import json
import math
import os

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

import adkit as ad
import archkit as ak
import sculptkit as sk
from japankit import Atlas

HERE = os.path.dirname(os.path.abspath(__file__))
ATLAS_FILE = "kabukicho.jpg"

MATERIALS = {
    # the arch: its red ribbon (painted steel, lit red from inside after dark), the bulbs, the band's silver
    # underside with its downlights, the pillars' grey granite, the sign box's frame
    "kb_red": {"color": "#c8141b", "roughness": 0.35, "metalness": 0.2, "emissive": "#ff1c14", "glow": 1.6},
    "kb_bulb": {"color": "#fff2d0", "roughness": 0.3, "metalness": 0.0, "emissive": "#fff0c8", "glow": 3.2},
    "kb_under": {"color": "#b4b8bc", "roughness": 0.35, "metalness": 0.6},
    "kb_pillar": {"color": "#8b8a86", "roughness": 0.6, "metalness": 0.0, "pattern": "granite", "joints_m": [0.6, 0.9]},
    "kb_frame": {"color": "#2a2c30", "roughness": 0.45, "metalness": 0.6},
    # the drawn signs (this module's own atlas), lit from inside after dark
    "kb_atlas": {"color": "#ffffff", "roughness": 0.55, "metalness": 0.0, "map": ATLAS_FILE, "emissive_map": True, "glow": 1.35},
    # the lantern lamps: black iron, frosted glass lit warm
    "kb_iron": {"color": "#1b1c1e", "roughness": 0.5, "metalness": 0.55},
    "kb_lantern": {"color": "#f6ead2", "roughness": 0.4, "metalness": 0.0, "emissive": "#ffd9a0", "glow": 2.2},
    # Studio Alta's lot: the hoarding's white steel panels, and the cleared ground
    "kb_hoard": {"color": "#ecebe6", "roughness": 0.7, "metalness": 0.1, "pattern": "granite", "joints_m": [0.5, 0.0]},
    "kb_gravel": {"color": "#8d877d", "roughness": 0.95, "metalness": 0.0, "pattern": "granite", "joints_m": [0, 0], "decal": True},
    # the kaiju: grey-green cement, rough; paler dorsal plates; its eyes and the inside of its mouth
    "kb_hide": {"color": "#3f4955", "roughness": 0.8, "metalness": 0.08, "emissive": "#7fa4d8", "glow": 0.18},
    "kb_plate": {"color": "#6f7c8a", "roughness": 0.75, "metalness": 0.08, "emissive": "#a9c4e8", "glow": 0.22},
    "kb_mouth": {"color": "#5a2a26", "roughness": 0.7, "metalness": 0.0},
    "kb_tooth": {"color": "#e7e1d2", "roughness": 0.5, "metalness": 0.0},
    "kb_eye": {"color": "#d8b23a", "roughness": 0.3, "metalness": 0.0, "emissive": "#ffcc33", "glow": 2.6},
    # the Shinjuku Toho Building: the cinema podium's dark glass and stone, the hotel tower's grey grid
    # (photographs from Cine City Plaza, 2023: silver panels in horizontal bands on the podium's sides and the
    # tower's south wall behind the head; the hotel's windows on the tower's other faces)
    "kb_podium": {"color": "#a7acb2", "roughness": 0.4, "metalness": 0.55, "pattern": "granite", "joints_m": [0.0, 1.25]},
    "kb_tower": {"color": "#56606a", "roughness": 0.18, "metalness": 0.3, "pattern": "curtain_wall", "bay_m": 1.8, "storey_m": 3.1,
                 "spandrel": 0.35, "mullion_m": 0.12, "frame": "#c9ccce", "lit_share": 0.55, "lit_k": 0.75, "warm_share": 0.85},
    "kb_silver": {"color": "#b4b9bf", "roughness": 0.38, "metalness": 0.55, "pattern": "granite", "joints_m": [0.0, 1.25],
                  "emissive": "#9fb6d6", "glow": 0.25},
    "kb_roof": {"color": "#77797b", "roughness": 0.85, "metalness": 0.1},
}
LIT = {"kb_red", "kb_bulb", "kb_atlas", "kb_lantern", "kb_eye", "kb_hide", "kb_plate", "kb_silver"}

# the streets whose fronts carry the stacks (OSM way names), and how far from a street a front may stand
CANYON = {"歌舞伎町一番街通り": "Ichibangai", "セントラルロード": "Central Road", "歌舞伎町さくら通り": "Sakura-dori"}
FRONT_NEAR = 7.5

# the arch's sizes (metres; estimates from photographs, scaled from the pillars' spacing): the band's section,
# the lower band's height at the east and west posts, the upper band's, the sign box (w, h, centre z)
ARCH = {"from_node_m": 11.0, "half_span": 4.3, "pillar": (0.62, 0.62, 3.3), "band": 0.62, "depth": 0.62,
        "lower_z": (5.25, 4.8), "upper_z": (6.75, 7.65), "sign": (5.0, 1.05, 6.05), "corner_r": 1.1}

KAIJU = {"toho": "w170267549", "head_m": 12.0, "terrace_m": 40.0, "back_m": 4.5, "setback_m": 10.0, "cell": 0.2}
ALTA = "w55798483"
PLAZA = (402.0, 2620.0)   # the east exit's plaza, where the walk starts
ARCH_OSM = "w820506894"   # the arch, mapped in OSM as a little building under it
UNICA = "w55798484"


# ---------------------------------------------------------------- data

class Data:
    """OSM's detail round Kabukicho in the local frame, and the built city's solids and ground."""

    def __init__(self, city_id):
        import cityctx
        self.C = cityctx.City(city_id)
        self.T = ak.Terrain(city_id)
        self.solids = ak.load_solids(city_id)
        raw = json.load(open(os.path.join(HERE, "kabukicho_osm.json"), encoding="utf8"))
        fwd = self.C.fwd.transform
        self.nodes = [dict(n, xy=np.array(fwd(*n["ll"]))) for n in raw["nodes"]]
        self.ways = [dict(w, xy=[np.array(fwd(*p)) for p in w["ll"]]) for w in raw["ways"]]

    def ground(self, x, y):
        return self.T(x, y)

    def street(self, name):
        """The way(s) of a street as one line (OSM splits Ichibangai in two), south end first."""
        parts = [w["xy"] for w in self.ways if w["tags"].get("name") == name and w["tags"].get("highway")]
        if not parts:
            return None
        pts = []
        for p in sorted(parts, key=lambda q: min(q[0][1], q[-1][1])):
            p = p if p[0][1] <= p[-1][1] else p[::-1]
            pts += [q for q in p if not pts or np.linalg.norm(q - pts[-1]) > 0.1]
        return LineString(pts)


def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) or 1.0)


def frame(o, f):
    """(u, v, z) -> local point: u along f from o, v to its left, z absolute."""
    o, f = np.asarray(o, float)[:2], unit(f)[:2]
    left = np.array([-f[1], f[0]])
    return lambda u, v, z: np.array([o[0] + f[0] * u + left[0] * v, o[1] + f[1] * u + left[1] * v, z])


def box(m, P, u0, u1, v0, v1, z0, z1, uvm=False):
    """A box in frame P, faces wound outward; with uvm, texture coordinates in metres along each face."""
    c = [P(u, v, z) for z in (z0, z1) for v in (v0, v1) for u in (u0, u1)]
    du, dv, dz = u1 - u0, v1 - v0, z1 - z0
    faces = ((0, 2, 3, 1, du, dv), (4, 5, 7, 6, du, dv), (0, 1, 5, 4, du, dz), (2, 6, 7, 3, dz, du), (0, 4, 6, 2, dz, dv), (1, 3, 7, 5, dv, dz))
    for a, b, cc, d, w, h in faces:
        m.quad(c[a], c[b], c[cc], c[d], [[0, 0], [w, 0], [w, h], [0, h]] if uvm else None)


# ---------------------------------------------------------------- the arch

def rounded(points, r, n=6):
    """A polyline (v, z) with its corners rounded to radius r (an arc of n segments at each)."""
    P = [np.asarray(p, float) for p in points]
    out = [P[0]]
    for a, b, c in zip(P, P[1:], P[2:]):
        d0, d1 = unit(a - b), unit(c - b)
        ang = math.acos(max(-1.0, min(1.0, float(np.dot(d0, d1)))))
        t = min(r / math.tan(ang / 2) if ang > 1e-3 else 0.0, np.linalg.norm(a - b) / 2, np.linalg.norm(c - b) / 2)
        p0, p1 = b + d0 * t, b + d1 * t
        for k in range(n + 1):   # a quadratic Bezier through the corner: close to the arc, and smooth
            s = k / n
            out.append((1 - s) ** 2 * p0 + 2 * (1 - s) * s * b + s * s * p1)
    out.append(P[-1])
    return out


def ribbon(K, P, path, half_w, half_d, bulbs_every=0.3):
    """A box-section band along a path in the arch's plane ((v, z) points; u across the street, out of the
    plane): red on its faces and edges, a silver underside where it runs flat, and two rows of bulbs on
    both faces."""
    red, under, bulb = K["kb_red"], K["kb_under"], K["kb_bulb"]
    pts = [np.asarray(p, float) for p in path]
    ns = []
    for k, p in enumerate(pts):
        t = unit(pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)])
        ns.append(np.array([-t[1], t[0]]))   # the in-plane normal, to the left of the way the path runs
    W = lambda u, p, n, s: P(u, p[0] + n[0] * s, p[1] + n[1] * s)
    for k in range(len(pts) - 1):
        a, b, na, nb = pts[k], pts[k + 1], ns[k], ns[k + 1]
        for u in (-half_d, half_d):   # the two faces
            q = [W(u, a, na, -half_w), W(u, b, nb, -half_w), W(u, b, nb, half_w), W(u, a, na, half_w)]
            red.quad(*(q if u > 0 else q[::-1]))
        for s in (-half_w, half_w):   # the two edges: the one facing down silver, as on the arch
            q = [W(-half_d, a, na, s), W(-half_d, b, nb, s), W(half_d, b, nb, s), W(half_d, a, na, s)]
            nz = (na[1] + nb[1]) / 2 * np.sign(s)
            m = under if nz < -0.5 else red
            m.quad(*(q if s > 0 else q[::-1]))
    # bulbs: two rows a third of the way in from each edge, on both faces, every bulbs_every metres
    seg = np.array([np.linalg.norm(pts[k + 1] - pts[k]) for k in range(len(pts) - 1)])
    L, s = float(seg.sum()), bulbs_every / 2
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    while s < L:
        k = min(int(np.searchsorted(cum, s, side="right") - 1), len(seg) - 1)
        f = (s - cum[k]) / (seg[k] or 1)
        p, n = pts[k] + (pts[k + 1] - pts[k]) * f, unit(ns[k] * (1 - f) + ns[k + 1] * f)
        t = np.array([n[1], -n[0]])
        for off in (-half_w * 0.45, half_w * 0.45):
            c = p + n * off
            for u in (-half_d - 0.012, half_d + 0.012):
                e = 0.065
                q = [P(u, *(c - t * e - n * e)), P(u, *(c + t * e - n * e)), P(u, *(c + t * e + n * e)), P(u, *(c - t * e + n * e))]
                bulb.quad(*(q if u > 0 else q[::-1]))
        s += bulbs_every


def arch(K, A, D, gate):
    """Kabukicho Ichibangai's arch over the mouth of the street, as photographed in 2023-2026."""
    line = D.street("歌舞伎町一番街通り")
    a = ARCH
    if line is not None:
        o = line.interpolate(a["from_node_m"])
        f = unit(np.array(line.interpolate(a["from_node_m"] + 2.0).coords[0]) - np.array(o.coords[0]))
        at = np.array(o.coords[0])
    else:
        at, f = np.asarray(gate["at"], float), np.asarray(gate["axis"], float)
    P = frame(at, f)                 # u up the street (north), v to the west, z absolute
    z0 = D.ground(*at)
    hs, (pw, pd, ph), bw, bd = a["half_span"], a["pillar"], a["band"] / 2, a["depth"] / 2
    for v in (-hs, hs):              # the grey granite pillars, and a plinth
        box(K["kb_pillar"], P, -pd / 2, pd / 2, v - pw / 2, v + pw / 2, z0, z0 + ph, uvm=True)
        box(K["kb_frame"], P, -pd / 2 - 0.03, pd / 2 + 0.03, v - pw / 2 - 0.03, v + pw / 2 + 0.03, z0, z0 + 0.25)
    r = a["corner_r"]
    (le, lw), (ue, uw) = (z0 + h for h in a["lower_z"]), (z0 + h for h in a["upper_z"])
    zu = (ue + uw) / 2
    # a ribbon looped over the street: up the east post, over the top climbing to the west, down the west
    # post; the lower band under the sign falls the other way, east to west, so the two read as one twisted
    # loop (photographs from both sides, 2023-2026)
    loop = rounded([(-hs, z0 + ph), (-hs, ue), (-hs * 0.3, ue + (uw - ue) * 0.3 + 0.15), (hs * 0.4, ue + (uw - ue) * 0.75 + 0.1), (hs, uw), (hs, z0 + ph)], r)
    lower = rounded([(-hs, le + 0.6), (-hs + 1.0, le), (hs - 1.0, lw), (hs, lw + 0.6)], 0.7)
    ribbon(K, P, loop, bw, bd)
    ribbon(K, P, lower, bw * 0.9, bd)
    # the sign box between the bands, its face the same on both sides
    sw, sh, sz = a["sign"]
    sz += z0
    box(K["kb_frame"], P, -0.22, 0.22, -sw / 2 - 0.06, sw / 2 + 0.06, sz - sh / 2 - 0.06, sz + sh / 2 + 0.06)
    for u, s in ((0.235, 1), (-0.235, -1)):
        q = [P(u, -s * sw / 2, sz - sh / 2), P(u, s * sw / 2, sz - sh / 2), P(u, s * sw / 2, sz + sh / 2), P(u, -s * sw / 2, sz + sh / 2)]
        A.quad(K["kb_atlas"], *q, "arch_sign")
    # hangers from the upper band to the sign box, and the box on the top (its transformer)
    for v in (-sw * 0.3, sw * 0.3):
        K["kb_frame"].tube([P(0, v, sz + sh / 2 + 0.06), P(0, v, zu + 0.1)], 0.04, 6)
    box(K["kb_frame"], P, -0.35, 0.35, -0.7, 0.7, zu + 0.25 + bw, zu + 0.6 + bw)
    # the 劇場通り boxes on the pillars, lit pink, facing out of the street and into it
    for v in (-hs, hs):
        for u, s in ((pd / 2 + 0.16, 1), (-pd / 2 - 0.16, -1)):
            box(K["kb_frame"], P, u - 0.12 * s if s > 0 else u, u if s > 0 else u + 0.12, v - 0.22, v + 0.22, z0 + 1.4, z0 + 2.9)
            q = [P(u + 0.005 * s, -s * 0.2 + v, z0 + 1.45), P(u + 0.005 * s, s * 0.2 + v, z0 + 1.45), P(u + 0.005 * s, s * 0.2 + v, z0 + 2.85), P(u + 0.005 * s, -s * 0.2 + v, z0 + 2.85)]
            A.quad(K["kb_atlas"], *q, "gekijo")
    return {"at": [round(float(at[0]), 2), round(float(at[1]), 2)], "axis": [round(float(f[0]), 4), round(float(f[1]), 4)], "z": round(z0, 2),
            "half_span": hs, "top": round(uw + bw, 2)}


def draw_arch(img, rects):
    from PIL import ImageDraw
    x, y, w, h = rects["arch_sign"]   # red gothic on white, a thin red rule inside the frame
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(250, 249, 245))
    d.rectangle([x + 8, y + 8, x + w - 9, y + h - 9], outline=(214, 24, 30), width=4)
    ad.text(img, (x + w / 2, y + h / 2 + 2), "歌舞伎町一番街", "zen", h * 0.66, fill="#d4161c", max_w=w - 60)
    x, y, w, h = rects["gekijo"]     # 劇場通り, set vertically in red on pale pink, lit from inside
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(250, 214, 232))
    d.rectangle([x + 3, y + 3, x + w - 4, y + h - 4], outline=(196, 40, 90), width=2)
    ad.vtext(img, (x + w / 2, y + 16), "劇場通り", "zen", w * 0.62, fill="#b8123a")


# ---------------------------------------------------------------- the canyon: tenant stacks and fronts

# trades and invented names for the stacks' panels, in Kabukicho's colours: (words, ground, ink)
TENANTS = [("居酒屋 こだま", "#ffd400", "#c8000a"), ("らーめん 龍", "#e60012", "#ffffff"), ("カラオケ", "#ffe600", "#d4001a"),
           ("焼肉 炎", "#1a1a1a", "#ffcf3a"), ("やきとり 鳥平", "#f39800", "#2a1200"), ("もつ鍋", "#ffffff", "#c8000a"),
           ("麻雀", "#0b5a2e", "#ffffff"), ("BAR 夜鷹", "#14142a", "#ff5fd2"), ("Shisha", "#101010", "#f2f2f2"),
           ("牛タン", "#7a1010", "#ffe9c0"), ("中華 龍門", "#d4001a", "#ffd400"), ("ダーツ", "#101820", "#2ad0ff"),
           ("寿司 魚河岸", "#ffffff", "#111111"), ("串カツ", "#ffe14a", "#1a1a1a"), ("喫茶 星", "#3a2a20", "#f4e2c8"),
           ("ホルモン", "#ffd400", "#111111"), ("占い", "#3a1a5a", "#ffd76a"), ("歯科", "#ffffff", "#2a7ab8"),
           ("クリニック", "#e8f6ff", "#0070c0"), ("ネイル", "#ffd6e6", "#c2185b"), ("ポーカー", "#062e12", "#7dff7a"),
           ("CAFE", "#2b2b2b", "#ffe6b8"), ("海鮮 浜", "#0a3d7a", "#ffffff"), ("餃子", "#ffffff", "#d4001a"),
           ("鉄板焼", "#2a1a10", "#ffb340"), ("天ぷら", "#f6efe0", "#2a2a2a"), ("ラウンジ", "#000000", "#d8b25a"),
           ("食べ放題", "#ff6a00", "#ffffff"), ("立ち飲み", "#7a1515", "#fff0c8"), ("ゲーム", "#1aa0e6", "#ffffff")]
STACKS = 28        # stacks drawn in the atlas (a stack: five to seven panels)
FASCIAS = 16       # lit boxes over the shop fronts


def canyon_fronts(D):
    """The fronts of the canyon's buildings: (mid, out normal, length, ground, height, street) for each
    edge of a solid that faces one of the CANYON streets within FRONT_NEAR metres."""
    streets = {nm: D.street(nm) for nm in CANYON}
    streets = {k: v for k, v in streets.items() if v is not None}
    out = []
    seen = set()
    for s in D.solids:
        if s["top"] < 6.0 or s["base"] > 1.0:
            continue
        g = Polygon(s["ring"]).buffer(0)
        if g.is_empty or not any(ln.distance(g) < FRONT_NEAR for ln in streets.values()):
            continue
        ring = list(s["ring"])
        ccw = Polygon(ring).exterior.is_ccw
        for a, b in zip(ring, ring[1:] + ring[:1]):
            a, b = np.asarray(a, float), np.asarray(b, float)
            e = b - a
            L = float(np.hypot(*e))
            if L < 3.5:
                continue
            n = np.array([e[1], -e[0]]) / L if ccw else np.array([-e[1], e[0]]) / L
            mid = (a + b) / 2
            probe = Point(*(mid + n * 3.0))
            nm, ln = min(streets.items(), key=lambda kv: kv[1].distance(probe))
            if ln.distance(probe) > FRONT_NEAR - 1.0 or g.buffer(0.3).contains(probe):
                continue
            # the edge must face the street: the street's nearest point is in front of it
            q = np.array(ln.interpolate(ln.project(Point(*mid))).coords[0])
            if np.dot(unit(q - mid), n) < 0.6:
                continue
            key = (round(mid[0], 0), round(mid[1], 0))
            if key in seen:
                continue
            seen.add(key)
            out.append((mid, n, L, D.ground(*mid), s["top"], nm))
    return out


def canyon(K, A, D, avoid):
    """Tenant stacks standing out from the fronts, a lit box over each shop front, and the lamps."""
    rng = np.random.default_rng(1969)
    placed, sites = [], []
    for mid, n, L, g, top, street in canyon_fronts(D):
        t = np.array([-n[1], n[0]])
        sites.append([round(float(mid[0]), 1), round(float(mid[1]), 1)])
        # the shop front's lit box, the width of the front less its edges
        w = min(L - 1.0, 7.5)
        if w > 1.8:
            z0 = g + 2.75 + rng.random() * 0.3
            c = mid + n * 0.2
            q = [np.array([*(c - t * w / 2), z0]), np.array([*(c + t * w / 2), z0]), np.array([*(c + t * w / 2), z0 + 0.85]), np.array([*(c - t * w / 2), z0 + 0.85])]
            box(K["kb_frame"], frame(mid, n), 0.0, 0.18, -w / 2 - 0.05, w / 2 + 0.05, z0 - 0.05, z0 + 0.9)
            A.quad(K["kb_atlas"], *q, f"fascia{int(rng.integers(FASCIAS))}")
        if top < 9.0:
            continue
        # stacks: one every 6-8 m of front, from above the shop front to a floor under the roof
        k = max(1, int(L / 7.0))
        for j in range(k):
            along = (j + 0.5) / k * L - L / 2 + (rng.random() - 0.5) * 1.2
            along = max(-L / 2 + 0.6, min(L / 2 - 0.6, along))
            c = mid + t * along
            if any(np.hypot(*(c - p)) < 9.0 for p in avoid):
                continue
            if any(np.hypot(*(c - p)) < 2.6 for p in placed):
                continue
            z0 = g + 3.9 + rng.random() * 0.5
            z1 = min(g + top - 0.8, z0 + 4.0 + rng.random() * 14.0)
            if z1 - z0 < 3.0:
                continue
            placed.append(c)
            out_m = 0.95 + rng.random() * 0.4      # how far it stands out from the wall
            th = 0.32
            P = frame(c, n)                       # u out from the wall, v along it
            box(K["kb_frame"], P, 0.05, out_m + 0.05, -th / 2, th / 2, z0, z1)
            key = f"stack{int(rng.integers(STACKS))}"
            for s in (-1, 1):                     # both faces, each the right way round from its side
                v = s * (th / 2 + 0.006)
                ua, ub = (out_m + 0.02, 0.08) if s > 0 else (0.08, out_m + 0.02)   # its left edge first, as seen from its side
                q = [P(ua, v, z0), P(ub, v, z0), P(ub, v, z1), P(ua, v, z1)]
                A.quad(K["kb_atlas"], *q, key)
            # the stack's crown: a little lit box with its building's name side
            box(K["kb_frame"], P, 0.05, out_m + 0.05, -th / 2 - 0.02, th / 2 + 0.02, z1, z1 + 0.12)
    return sites


def draw_canyon(img, rects):
    from PIL import ImageDraw
    rng = np.random.default_rng(2026)
    d = ImageDraw.Draw(img)
    for i in range(STACKS):
        x, y, w, h = rects[f"stack{i}"]
        npan = int(rng.integers(5, 8))
        picks = [TENANTS[j] for j in rng.choice(len(TENANTS), npan, replace=False)]
        top_floor = npan + (1 if rng.random() < 0.5 else 0)
        ph = h / npan
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(26, 26, 30))
        for k, (words, bg, fg) in enumerate(picks):
            y0 = y + k * ph
            d.rectangle([x + 3, y0 + 3, x + w - 4, y0 + ph - 3], fill=ad.rgb(bg))
            floor = top_floor - k
            tag = "B1F" if floor <= 0 else f"{floor}F"
            th = min(ph * 0.2, w * 0.32)
            d.rectangle([x + 3, y0 + ph - 3 - th, x + w - 4, y0 + ph - 3], fill=ad.rgb(fg))
            ad.text(img, (x + w / 2, y0 + ph - 3 - th / 2), tag, "anton", th * 0.85, fill=bg)
            body = words.replace(" ", "")
            if all(ord(ch) < 128 for ch in body):   # Latin: across, shrunk to the panel's width
                ad.text(img, (x + w / 2, y0 + (ph - th) / 2), words, "anton", w * 0.3, fill=fg, max_w=w - 12)
            else:
                size = min(w * 0.6, (ph - th - 16) / (len(body) * 1.06))
                ad.vtext(img, (x + w / 2, y0 + 8 + max(0.0, (ph - th - 16 - size * 1.06 * len(body)) / 2)), body, "zen", size, fill=fg)
        d = ImageDraw.Draw(img)
    for i in range(FASCIAS):
        x, y, w, h = rects[f"fascia{i}"]
        words, bg, fg = TENANTS[(i * 7 + 3) % len(TENANTS)]
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=ad.rgb(bg))
        d.rectangle([x + 4, y + 4, x + w - 5, y + h - 5], outline=ad.rgb(fg), width=3)
        ad.text(img, (x + w / 2, y + h / 2 + 2), words, "zen" if any(ord(c) > 127 for c in words) else "anton", h * 0.58, fill=fg, max_w=w - 30)
        d = ImageDraw.Draw(img)


def lamp_model():
    """The canyon's street lamp: a black post with a crosspiece and two lanterns hung from it (photographs)."""
    K = ak.Kit("kb_lamp", floodlit={"kb_lantern"})
    iron, glass = K["kb_iron"], K["kb_lantern"]
    iron.tube([(0, 0, 0), (0, 0, 4.7)], 0.075, 8)
    iron.tube([(0, 0, 0), (0, 0, 0.5)], 0.12, 8)
    iron.tube([(-0.55, 0, 4.55), (0.55, 0, 4.55)], 0.03, 6)
    for x in (-0.5, 0.5):
        P = lambda u, v, z, x=x: np.array([x + u, v, z])
        box(iron, P, -0.2, 0.2, -0.2, 0.2, 4.38, 4.46)
        box(glass, P, -0.16, 0.16, -0.16, 0.16, 3.95, 4.38)
        box(iron, P, -0.19, 0.19, -0.19, 0.19, 3.9, 3.95)
    return K.out()


def lamps(D, avoid, every=12.0):
    """Lamps down the canyon's streets, every `every` metres on alternate sides, half a metre in front of
    the fronts (OSM maps none there; their spacing is from photographs)."""
    near = [Polygon(s["ring"]).buffer(0) for s in D.solids if s["top"] > 3.0]
    at = []
    for nm in CANYON:
        ln = D.street(nm)
        if ln is None:
            continue
        hits = [g for g in near if g.distance(ln) < 12.0]
        for k, s in enumerate(np.arange(every / 2, ln.length - 3.0, every)):
            p = np.array(ln.interpolate(s).coords[0])
            e = unit(np.array(ln.interpolate(min(ln.length, s + 1.0)).coords[0]) - np.array(ln.interpolate(max(0.0, s - 1.0)).coords[0]))
            side = np.array([-e[1], e[0]]) * (1 if k % 2 else -1)
            ray = LineString([p, p + side * 8.0])
            d = min((g.intersection(ray).distance(Point(*p)) for g in hits if g.intersects(ray)), default=None)
            if d is None or d < 2.4:
                continue
            q = p + side * (d - 0.55)
            if any(np.hypot(*(q - a)) < 6.0 for a in avoid):
                continue
            at.append([round(float(q[0]), 2), round(float(q[1]), 2), round(D.ground(*q), 2), round(math.atan2(e[1], e[0]), 3)])
    return at


# ---------------------------------------------------------------- the kaiju on the Toho building

def kaiju_field():
    """The head as a signed distance field in its frame: u the way it looks, v to its left, z up from the
    terrace. A generic reptile: a neck that leans forward out of the terrace, a broad flat skull with a
    heavy brow, the jaw dropped in a roar, and jagged plates down the back of the neck."""
    L = sk.mirror_v
    neck = sk.path([(-2.6, 0.0, -0.2), (-1.6, 0.0, 3.0), (-0.6, 0.0, 5.8), (0.2, 0.0, 7.6)], [3.3, 2.75, 2.25, 1.95])
    traps = L(sk.capsule((-2.6, 1.6, 0.2), (-0.6, 1.0, 6.6), 1.5, 0.9))          # the muscles either side of the neck
    skull = sk.ellipsoid((0.9, 0.0, 9.0), (2.5, 2.05, 1.5))
    snout = sk.capsule((2.2, 0.0, 9.15), (5.6, 0.0, 9.0), 1.25, 0.8)
    snout_top = sk.ellipsoid((3.6, 0.0, 9.75), (2.2, 0.75, 0.45))
    brow = L(sk.ellipsoid((2.1, 1.0, 9.95), (1.15, 0.6, 0.42)))
    cheek = L(sk.ellipsoid((0.6, 1.45, 8.35), (1.7, 0.75, 1.05)))
    jaw = L(sk.capsule((0.9, 0.85, 7.6), (4.9, 0.45, 6.55), 0.75, 0.5))           # the lower jaw, dropped open
    chin = sk.capsule((3.6, 0.0, 6.8), (5.0, 0.0, 6.45), 0.75, 0.5)
    throat = sk.ellipsoid((0.4, 0.0, 6.9), (2.0, 1.55, 1.4))
    head = sk.smooth_union(0.55, skull, snout, snout_top, brow, cheek)
    body = sk.smooth_union(0.8, neck, traps, throat)
    f = sk.smooth_union(0.6, body, head, sk.smooth_union(0.3, jaw, chin))
    # the open mouth between the upper snout and the jaw
    f = sk.subtract(0.2, f, sk.capsule((1.9, 0.0, 8.1), (6.2, 0.0, 7.75), 0.5, 0.85))
    # nostrils, eye sockets under the brow
    for s in (-1, 1):
        f = sk.subtract(0.08, f, sk.sphere((5.55, s * 0.42, 9.55), 0.2))
        f = sk.subtract(0.1, f, sk.sphere((2.25, s * 1.3, 9.5), 0.3))
    # jagged plates down the back of the neck, biggest at the shoulders: each a pointed leaf of two lobes
    plates = []
    for k, (u, z, r) in enumerate(((-0.9, 10.2, 0.75), (-1.9, 8.9, 1.05), (-2.9, 7.2, 1.35), (-3.7, 5.2, 1.6), (-4.3, 3.0, 1.75), (-4.7, 0.9, 1.6))):
        tip = (u - r * 1.05, 0.0, z + r * 0.55)
        plates.append(sk.capsule((u + 0.3, 0.0, z - r * 0.5), tip, r * 0.55, 0.06))
        plates.append(sk.capsule((u + 0.3, 0.0, z - r * 0.2), (u - r * 0.75, 0.0, z - r * 0.55), r * 0.4, 0.05))
    flat = lambda g: (lambda uu, vv, zz: g(uu, vv * 1.7, zz))                      # thin across, as the plates are
    f = sk.smooth_union(0.15, f, flat(sk.union(*plates)))
    return sk.roughen(f, 0.05, 0.3, seed=2015)


def kaiju_sculpt():
    v, t = sk.mesh(kaiju_field(), (-7.2, -3.6, -0.2), (6.8, 3.6, 12.2), KAIJU["cell"])
    v = sk.relax(v, t, 0.45, 2)
    return v, t


def toho(K, A, D):
    """The Shinjuku Toho Building (2015, 130 m): the eight-storey podium of the cinema whose roof is the
    terrace the kaiju stands on, and the hotel tower set back behind it (PLATEAU gives the whole outline
    the tower's height). Returns the solids it draws instead, and the terrace's south edge."""
    solids = [s for s in D.solids if s["osm"] == KAIJU["toho"]]
    if not solids:
        return [], None
    foot = unary_union([Polygon(s["ring"]).buffer(0) for s in solids]).buffer(0.3).buffer(-0.3)
    foot = foot if foot.geom_type == "Polygon" else max(foot.geoms, key=lambda g: g.area)
    foot = Polygon(ak.simplify(list(foot.exterior.coords)[:-1], 0.5)).buffer(0)
    g = min(s["ground"] for s in solids)
    top = max(s["top"] for s in solids)
    road = D.street("セントラルロード")
    north = unit(np.array(road.coords[-1]) - np.array(road.coords[0])) if road is not None else np.array([0.28, 0.96])
    c = np.array(foot.centroid.coords[0])
    proj = [float(np.dot(np.asarray(p) - c, north)) for p in foot.exterior.coords]
    s0 = min(proj)
    cut = s0 + KAIJU["setback_m"]
    side = np.array([-north[1], north[0]])
    half = Polygon([c + north * cut + side * 80, c + north * 200 + side * 80, c + north * 200 - side * 80, c + north * cut - side * 80])
    tower = foot.intersection(half)
    tower = tower if tower.geom_type == "Polygon" else max(tower.geoms, key=lambda q: q.area)
    zp = g + KAIJU["terrace_m"]
    ccw = lambda poly: [tuple(p) for p in (list(poly.exterior.coords)[:-1] if poly.exterior.is_ccw else list(poly.exterior.coords)[:-1][::-1])]
    ak.prism(K["kb_podium"], ak.WORLD, ccw(foot), g, zp, top=False)
    ak.cap(K["kb_roof"], ak.WORLD, ccw(foot), zp)
    ak.prism(K["kb_tower"], ak.WORLD, ccw(tower), zp, g + top - 2.5, top=False)
    ak.cap(K["kb_roof"], ak.WORLD, ccw(tower), g + top - 2.5)
    crown = tower.buffer(-2.0)
    if crown.geom_type == "Polygon" and not crown.is_empty:
        ak.prism(K["kb_roof"], ak.WORLD, ccw(crown), g + top - 2.5, g + top)
    # the terrace's parapet: a low glass rail round the podium's roof south of the tower
    rail = foot.exterior.difference(tower.buffer(0.5))
    for ln in getattr(rail, "geoms", [rail]):
        pts = [np.array([x, y, zp + 1.1]) for x, y in ln.coords]
        if len(pts) > 1:
            K["kb_frame"].tube(pts, 0.05, 4)
    # the podium's south face to Central Road: planted ledges from the third floor to the terrace, the
    # cinema's lit name band under them; and the tower's south wall behind the head, silver bands
    best = None
    ring = ccw(foot)
    for a, b in zip(ring, ring[1:] + ring[:1]):
        a, b = np.asarray(a), np.asarray(b)
        L = float(np.linalg.norm(b - a))
        nn = np.array([(b - a)[1], -(b - a)[0]]) / (L or 1)
        face = float(np.dot(nn, -north))
        if L > 8 and face > 0.5 and (best is None or face * L > best[3]):   # the widest face to the south
            best = (a, b, L, face * L, nn)
    if best:
        a, b, L, _, nn = best
        f = (b - a) / L
        mid = (a + b) / 2 + nn * 0.15
        w = L * 0.62
        p0, p1 = mid - f * w / 2, mid + f * w / 2   # seen from the plaza: a (to its left) first
        A.quad(K["kb_atlas"], np.array([*p0, g + 12.0]), np.array([*p1, g + 12.0]), np.array([*p1, zp - 0.5]), np.array([*p0, zp - 0.5]), "toho_green")
        A.quad(K["kb_atlas"], np.array([*p0, g + 8.6]), np.array([*p1, g + 8.6]), np.array([*p1, g + 10.6]), np.array([*p0, g + 10.6]), "toho_name")
        tw = [np.asarray(p) for p in ccw(tower)]
        tb = max(zip(tw, tw[1:] + tw[:1]), key=lambda e: np.dot(np.array([(e[1] - e[0])[1], -(e[1] - e[0])[0]]) / (np.linalg.norm(e[1] - e[0]) or 1), -north) * np.linalg.norm(e[1] - e[0]))
        ta, tb_ = tb
        tn = np.array([(tb_ - ta)[1], -(tb_ - ta)[0]]) / np.linalg.norm(tb_ - ta)
        K["kb_silver"].quad(np.array([*(ta + tn * 0.1), zp]), np.array([*(tb_ + tn * 0.1), zp]), np.array([*(tb_ + tn * 0.1), g + top - 2.5]), np.array([*(ta + tn * 0.1), g + top - 2.5]),
                            [[0, zp], [float(np.linalg.norm(tb_ - ta)), zp], [float(np.linalg.norm(tb_ - ta)), g + top - 2.5], [0, g + top - 2.5]])
    edge = c + north * s0
    return [s["si"] for s in solids], {"south": [round(float(edge[0]), 2), round(float(edge[1]), 2)], "north": north, "terrace_z": zp}


def kaiju(K, D, terrace=None):
    """The head on the Toho building's terrace, looking down Central Road toward Yasukuni-dori."""
    solids = [s for s in D.solids if s["osm"] == KAIJU["toho"]]
    road = D.street("セントラルロード")
    if not solids or road is None:
        return None
    foot = unary_union([Polygon(s["ring"]).buffer(0) for s in solids])
    end = np.array(road.coords[-1])        # where Central Road meets the building
    look = unit(np.array(road.coords[0]) - end)
    # on the terrace: back from the building's south face along the road's line
    if terrace:   # on the terrace's middle line, back from its south edge (toho())
        at = np.asarray(terrace["south"]) + np.asarray(terrace["north"]) * KAIJU["back_m"]
    else:
        edge = np.array(foot.exterior.interpolate(foot.exterior.project(Point(*end))).coords[0]) if foot.geom_type == "Polygon" else end
        at = edge - look * KAIJU["back_m"]
    g = min(s["ground"] for s in solids)
    zt = g + KAIJU["terrace_m"]
    P = frame(at, look)
    v, t = kaiju_sculpt()
    W = np.array([P(a, b, c + zt) for a, b, c in v])
    c = v[t].mean(1)
    nrm = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    eye = np.zeros(len(t), bool)
    for s in (-1, 1):
        eye |= np.linalg.norm(c - np.array([2.25, s * 1.3, 9.5]), axis=1) < 0.36
    mouth = (c[:, 0] > 1.8) & (np.abs(c[:, 1]) < 0.7) & (c[:, 2] > 7.2) & (c[:, 2] < 8.7) & ~eye
    plate = (c[:, 0] < -1.0) & (np.abs(c[:, 1]) < 0.75) & (c[:, 2] > 1.5) & (nrm[:, 0] < 0) & ~mouth
    for mat, sel in (("kb_hide", ~(eye | mouth | plate)), ("kb_plate", plate), ("kb_mouth", mouth), ("kb_eye", eye)):
        m = K[mat]
        m.smooth, m.digits = True, 3
        tt = t[sel]
        used = np.unique(tt)
        remap = np.zeros(len(v), int)
        remap[used] = np.arange(len(used)) + len(m.v)
        m.v += [p for p in W[used]]
        m.t += [[0.0, 0.0]] * len(used)
        m.i += remap[tt].ravel().tolist()
    # teeth along both jaws: small cones pointing into the mouth
    tooth = K["kb_tooth"]
    for s in (-1, 1):
        for k in range(7):
            u = 2.4 + k * 0.47
            zu = 8.55 - 0.03 * k
            zl = 7.45 - 0.13 * k
            for z, dz in ((zu, -0.45), (zl, 0.4)):
                b = P(u, s * (0.66 - 0.03 * k), z)
                tip = P(u + 0.05, s * (0.6 - 0.03 * k), z + dz)
                tooth.tube([b, tip], [0.11, 0.01], 5)
    top = P(0.4, 0.0, zt + KAIJU["head_m"])
    return {"at": [round(float(at[0]), 2), round(float(at[1]), 2)], "look": [round(float(look[0]), 4), round(float(look[1]), 4)],
            "terrace_z": round(zt, 2), "top_z": round(float(zt + KAIJU["head_m"]), 2), "street_z": round(g, 2), "eye": [round(float(x), 2) for x in P(2.25, 0, zt + 9.5)]}


# ---------------------------------------------------------------- Studio Alta's lot

def alta(K, A, D):
    """The cleared lot behind a white hoarding, a notice on its face to the station; the solids it hides."""
    solids = [s for s in D.solids if s["osm"] == ALTA]
    if not solids:
        return [], None
    lot = unary_union([Polygon(s["ring"]).buffer(0) for s in solids]).buffer(0.4).buffer(-0.4)
    lot = lot if lot.geom_type == "Polygon" else max(lot.geoms, key=lambda g: g.area)
    ring = [np.asarray(p, float) for p in ak.simplify(list(lot.exterior.coords)[:-1], 0.6)]
    g = min(s["ground"] for s in solids)
    H = 3.0
    hoard, frame_m = K["kb_hoard"], K["kb_frame"]
    centre = np.array(lot.centroid.coords[0])
    notice = None
    for a, b in zip(ring, ring[1:] + ring[:1]):
        L = float(np.linalg.norm(b - a))
        if L < 0.5:
            continue
        f = (b - a) / L
        n = np.array([f[1], -f[0]])
        if np.dot(n, ((a + b) / 2) - centre) < 0:
            n = -n
        za, zb = D.ground(*a), D.ground(*b)
        hoard.quad(np.array([*a, za]), np.array([*b, zb]), np.array([*b, zb + H]), np.array([*a, za + H]), [[0, 0], [L, 0], [L, H], [0, H]])
        hoard.quad(np.array([*b, zb]), np.array([*a, za]), np.array([*a, za + H]), np.array([*b, zb + H]), [[0, 0], [L, 0], [L, H], [0, H]])
        frame_m.tube([np.array([*a, za + H]), np.array([*b, zb + H])], 0.04, 4)
        face = float(np.dot(n, unit(np.asarray(PLAZA) - (a + b) / 2)))   # the face toward the east exit's plaza carries it
        if L > 8 and (notice is None or face > notice[4]):
            notice = (a, b, L, n, face)
    if notice:
        a, b, L, n, _ = notice
        m = (a + b) / 2 + n * 0.02
        f = unit(b - a)
        w = min(6.0, L - 2.0)
        # the face seen from outside reads left to right: from outside the lot, b is on the left if n points out
        p0, p1 = m + f * w / 2, m - f * w / 2
        if np.cross(np.append(f, 0), np.append(n, 0))[2] > 0:
            p0, p1 = p1, p0
        z = D.ground(*m)
        A.quad(K["kb_atlas"], np.array([*p0, z + 0.6]), np.array([*p1, z + 0.6]), np.array([*p1, z + 2.6]), np.array([*p0, z + 2.6]), "alta_notice")
    # the cleared ground, a little above the street so it covers the old roof in the aerial photo
    flat = [tuple(p) for p in ring]
    ak.cap(K["kb_gravel"], ak.WORLD, flat, g + 0.05)
    return [s["si"] for s in solids], {"at": [round(float(centre[0]), 1), round(float(centre[1]), 1)], "z": round(g, 2)}


def draw_alta(img, rects):
    from PIL import ImageDraw
    x, y, w, h = rects["alta_notice"]
    d = ImageDraw.Draw(img)
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(246, 246, 242))
    d.rectangle([x, y, x + w - 1, y + int(h * 0.3)], fill=(22, 58, 122))
    ad.text(img, (x + w / 2, y + h * 0.15), "工事中  新宿三丁目24番", "zen", h * 0.16, fill="#ffffff", max_w=w - 40)
    ad.text(img, (x + w / 2, y + h * 0.47), "ご迷惑をおかけしております", "zen", h * 0.13, fill="#1d2a44", max_w=w - 40)
    ad.text(img, (x + w / 2, y + h * 0.68), "新宿アルタ 1980-2025  ありがとうございました", "zen", h * 0.1, fill="#3a4660", max_w=w - 40)
    ad.text(img, (x + w / 2, y + h * 0.86), "Thank you, Shinjuku ALTA", "bebas", h * 0.12, fill="#16367a", max_w=w - 40)


# ---------------------------------------------------------------- the Unica building's names

def unica(K, A, D):
    """UNIKA BLDG. over the screens, GOLF5's green box above it and Alpen TOKYO over the shop floors,
    on the faces toward Yasukuni-dori and Kabukicho (the screens themselves: city.py SHINJUKU_SCREENS)."""
    solids = [s for s in D.solids if s["osm"] == UNICA]
    if not solids:
        return
    main = max(solids, key=lambda s: s["top"])
    g = min(s["ground"] for s in solids)
    top = g + main["top"]
    # the curved front over Yasukuni-dori: the arc between the two screens' edges (city.py), its middle face
    a, b = np.array([377.6, 2771.4]), np.array([406.0, 2769.3])
    mid, f = (a + b) / 2, unit(b - a)
    n = np.array([-f[1], f[0]])
    if n[1] < 0:
        n = -n
    def face(w, z0, z1, key, along=0.0, off=0.9):
        c = mid + n * off + f * along
        p0, p1 = c - f * w / 2, c + f * w / 2
        A.quad(K["kb_atlas"], np.array([*p0, z0]), np.array([*p1, z0]), np.array([*p1, z1]), np.array([*p0, z1]), key)
        P = frame(c, n)
        box(K["kb_frame"], P, -0.25, -0.01, -w / 2 - 0.1, w / 2 + 0.1, z0 - 0.1, z1 + 0.1)
    face(16.0, top - 3.2, top - 0.6, "unika_name")
    face(9.0, top - 10.8, top - 3.6, "golf5", along=-2.0)
    face(13.0, g + 5.2, g + 6.6, "alpen", off=0.45)


def draw_unica(img, rects):
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    x, y, w, h = rects["unika_name"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(236, 237, 238))
    ad.text(img, (x + w / 2, y + h / 2 + 2), "UNIKA BLDG.", "anton", h * 0.62, fill="#2a2d33", max_w=w - 30)
    x, y, w, h = rects["golf5"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(28, 138, 64))
    ad.text(img, (x + w / 2, y + h * 0.42), "GOLF5", "anton", h * 0.42, fill="#ffffff", max_w=w - 40)
    ad.text(img, (x + w / 2, y + h * 0.78), "FLAGSHIP  STORE", "bebas", h * 0.14, fill="#e6f5ea", max_w=w - 40)
    x, y, w, h = rects["alpen"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(18, 22, 30))
    ad.text(img, (x + w / 2, y + h / 2 + 2), "Alpen TOKYO", "anton", h * 0.66, fill="#ffffff", max_w=w - 30)


def draw_toho(img, rects):
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(2015)
    x, y, w, h = rects["toho_green"]   # planted ledges: bands of green between thin grey sills
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(64, 72, 60))
    rows = 9
    for k in range(rows):
        y0 = y + k * h / rows
        d.rectangle([x, y0, x + w - 1, y0 + h / rows * 0.18], fill=(150, 154, 156))
        for _ in range(140):
            cx, cy = x + rng.random() * w, y0 + h / rows * (0.2 + rng.random() * 0.8)
            r = 3 + rng.random() * 7
            g = int(70 + rng.random() * 70)
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(int(g * 0.55), g, int(g * 0.4)))
    x, y, w, h = rects["toho_name"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=(40, 42, 58))
    ad.text(img, (x + w * 0.5, y + h / 2 + 2), "TOHO CINEMAS   IMAX", "anton", h * 0.55, fill="#ffffff", max_w=w - 40)


# ---------------------------------------------------------------- the build

class Build:
    """What Kabukicho adds to the Shinjuku map's landmarks: meshes, solids drawn instead, solids pulled down."""

    def __init__(self, city_id, lm):
        self.lm = lm
        self.D = Data(city_id)
        items = [("arch_sign", 1024, 216), ("gekijo", 64, 256), ("alta_notice", 768, 256),
                 ("unika_name", 768, 128), ("golf5", 384, 304), ("alpen", 768, 84), ("toho_green", 512, 512), ("toho_name", 1024, 96)]
        items += [(f"stack{i}", 80, 640) for i in range(STACKS)]
        items += [(f"fascia{i}", 448, 64) for i in range(FASCIAS)]
        self.A = Atlas(items, width=2048)
        self.info = {}

    def meshes(self):
        K = ak.Kit("kabukicho", floodlit=LIT, uv={k for k, m in MATERIALS.items() if "map" in m or "pattern" in m})
        gate = arch(K, self.A, self.D, self.lm.get("kabukicho_gate", {}))
        self.info["arch"] = gate
        avoid = [np.asarray(gate["at"])]
        hidden, terrace = toho(K, self.A, self.D)
        hidden += [s["si"] for s in self.D.solids if s["osm"] == ARCH_OSM]
        self.info["kaiju"] = kaiju(K, self.D, terrace)
        gone, lot = alta(K, self.A, self.D)
        self.info["alta"] = lot
        unica(K, self.A, self.D)
        self.info["canyon"] = canyon(K, self.A, self.D, avoid)
        lamp_at = lamps(self.D, avoid)
        props = [{"name": "kabukicho_lamp", "far": 260, "at": lamp_at,
                  "parts": [m.dump() for m in lamp_model()]}] if lamp_at else []
        self.gone = gone
        return K.out(), hidden, [], props

    def draw(self, out_dir):
        from PIL import Image
        img = Image.new("RGB", (self.A.W, self.A.H), (30, 32, 36))
        draw_arch(img, self.A.rects)
        draw_canyon(img, self.A.rects)
        draw_alta(img, self.A.rects)
        draw_unica(img, self.A.rects)
        draw_toho(img, self.A.rects)
        img.save(os.path.join(out_dir, ATLAS_FILE), quality=88)
        return ATLAS_FILE

    def glows(self):
        """The arch's red light on the street, the canyon's signs and the lantern lamps (web/night.js)."""
        out = []
        g = self.info.get("arch")
        if g:
            out.append([g["at"][0], g["at"][1], 14.0, "#ff3a2a", 0.55])
        for x, y in (self.info.get("canyon") or [])[::3]:
            out.append([x, y, 9.0, "#ffd9a8", 0.22])
        return out


# ---------------------------------------------------------------- the game: spots, things to walk up to, chatter

def extras(info, spot, close_to, talk):
    """What Kabukicho adds to the game (city.py game_extras), from the build's info."""
    spots, close, chatter = [], [], []
    g = info.get("arch")
    if g:
        at, f = np.asarray(g["at"]), np.asarray(g["axis"])
        P = frame(at, f)
        spots.append(spot("kabukicho", "Kabukicho Ichibangai 歌舞伎町一番街", at - f * 3.0, g["z"], "Look up at the arch", [
            "The red arch has stood at the mouth of Ichibangai since 1969: a ribbon of lit steel looped over the street, its bulbs on both faces.",
            "Kabukicho is named for a kabuki theatre planned here after the war and never built. The cinemas came instead."], 4.0))
        pd = ARCH["pillar"][1] / 2
        close.append(close_to("Kabukicho Ichibangai arch, its pillar", P(-pd, g["half_span"], 0), g["z"], P(-4.5, g["half_span"] - 1.5, 0), 1.2, 0.25))
        chatter.append(talk(at + f * 12.0, g["z"], [["Friend", "Karaoke till the first train?"], ["Friend", "The first train's at five..."], ["Friend", "Exactly."]]))
        chatter.append(talk(at - f * 4.0, g["z"], [["Tourist", "Get the arch in. And the sign. Lower!"], ["Friend", "If I go lower I'm lying in the road."]], 10))
    k = info.get("kaiju")
    if k:
        look = np.asarray(k["look"])
        foot = np.asarray(k["at"]) + look * 60.0
        spots.append(spot("kaiju", "The head over Central Road", foot, k["street_z"], "Look up", [
            "Twelve metres of head on the Toho building's eighth-floor terrace, fifty-odd metres over the street, glaring down Central Road. Since April 2015.",
            "The Koma Theatre stood here from 1956 to 2008. Now it's cinemas below, a hotel above, and the monster in between."], 6.0))
        chatter.append(talk(foot + look * 8.0, k["street_z"], [["Kid", "It's looking at me."], ["Parent", "It looks at everyone."], ["Kid", "It's looking at ME."]], 12))
    a = info.get("alta")
    if a:
        spots.append(spot("alta", "Studio Alta's lot 新宿アルタ跡地", np.asarray(PLAZA) + unit(np.asarray(a["at"]) - np.asarray(PLAZA)) * 40.0, a["z"], "Read the hoarding", [
            "Studio Alta stood here from 1980: the meeting place of the east exit, its big screen over the plaza, a lunchtime TV show broadcast from inside for over thirty years.",
            "It closed on 28 February 2025 and came down over the next year. What goes up next has not been decided."], 6.0))
    return spots, close, chatter
