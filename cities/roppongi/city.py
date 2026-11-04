"""Roppongi, a map of Tokyo: what the generic pipeline cannot know from open data.

The model is the real district: Overture footprints at Project PLATEAU's surveyed heights (Roppongi Hills
Mori Tower's 238 m, Tokyo Midtown's 248 m, Azabudai Hills' 325 m) on GSI's laser bare earth. This file
adds:

  * Maman (Louise Bourgeois, 1999; cast 2002), the bronze spider of Roppongi Hills' 66 Plaza, about
    9.3 m high and 10 m across (Mori Building), at OpenStreetMap's position: its body and egg sac high
    on eight jointed legs.
  * 毛利庭園 the Mohri Garden's pond, drawn at its own level (pipeline/districtkit.py).
  * The National Art Center, Tokyo (Kisho Kurokawa, 2007): its front of glass louvers in a wave, about
    21 m high, along the face that looks east to Roppongi, in front of the plain block the survey has.
  * Keyakizaka-dori's winter lights (Roppongi Hills Christmas illumination, November to December): the
    zelkovas along the street wound with white and blue LEDs.
  * The bars and clubs round the Roppongi crossing: boards and blade signs in Japanese and English
    (typical of the street, no real shop's sign).

Persona 5's Roppongi is a night district of clubs and galleries; nothing of the game's art is copied.
"""
import math

import numpy as np
from shapely.geometry import LineString, Point, Polygon

import districtkit as dk
import japankit as jk
from japankit import Atlas, Kit, block, frame, lathe_at, unit, left_of

MAMAN = "ママン"
NACT = "国立新美術館"
KEYAKIZAKA = "けやき坂"
CROSSING = ((40.0, 30.0), 170.0)
SIGN_CLASSES = {"", "commercial", "retail", "restaurant", "mixed_use", "hotel", "entertainment"}
MAMAN_H, MAMAN_SPAN = 9.27, 10.0

MATERIALS = {
    "atlas": {"color": "#ffffff", "roughness": 0.7, "metalness": 0.0, "map": "atlas.jpg", "emissive_map": True, "glow": 1.35},
    "frame": {"color": "#26292e", "roughness": 0.5, "metalness": 0.5},
    "bronze_dark": {"color": "#3a3128", "roughness": 0.45, "metalness": 0.75},
    "marble": {"color": "#d9d4cc", "roughness": 0.3, "metalness": 0.1},
    "louvers": {"color": "#ffffff", "roughness": 0.12, "metalness": 0.4, "map": "atlas.jpg", "emissive_map": True, "glow": 0.5, "opacity": 0.92},
    "mullion": {"color": "#c9ccd0", "roughness": 0.35, "metalness": 0.6},
    "led_white": {"color": "#f4f8ff", "roughness": 0.4, "metalness": 0.0, "emissive": "#d8e8ff", "glow": 1.4},
    "led_blue": {"color": "#bcd4ff", "roughness": 0.4, "metalness": 0.0, "emissive": "#5d8cff", "glow": 1.6},
    **dk.WATER,
}

BLADES = [("BAR", "#111111", "#ff3f8e", "bebas"), ("CLUB", "#1a0a2e", "#53f2ff", "bebas"), ("カラオケ", "#ffd400", "#e60012", "dela"),
          ("SHISHA", "#2b1a12", "#ffcf70", "bebas"), ("焼肉", "#3b2a1e", "#ff6b4a", "zen"), ("寿司", "#f4f1ea", "#1a1a1a", "mincho"),
          ("ラーメン", "#d4001a", "#ffffff", "zen"), ("PUB", "#0a3a1a", "#f2d16b", "bebas"), ("LOUNGE", "#2a0a1a", "#ffb0d0", "bebas"),
          ("居酒屋", "#2b1a12", "#ffcf70", "mincho"), ("DJ BAR", "#000000", "#b0ff3a", "bebas"), ("天ぷら", "#2b1a12", "#ffffff", "mincho"),
          ("WINE", "#4a0a1a", "#f4e6c8", "bebas"), ("ダーツ", "#0068b7", "#ffffff", "zen"), ("TACOS", "#ffb000", "#5a1a0a", "bebas"),
          ("2F CAFE", "#f4f1ea", "#2b1a12", "bebas")]
BOARDS = [("WELCOME 営業中", "#e60012", "#ffffff", "zen"), ("SPORTS BAR · LIVE", "#0a2a6a", "#ffffff", "bebas"), ("CLUB · DJ TONIGHT", "#1a0a2e", "#ff3f8e", "bebas"),
          ("カラオケ 朝まで", "#ffd400", "#e60012", "dela"), ("焼肉 和牛", "#3b2a1e", "#ff6b4a", "zen"), ("SHISHA LOUNGE", "#2b1a12", "#ffcf70", "bebas"),
          ("寿司 割烹", "#f4f1ea", "#1a1a1a", "mincho"), ("HAPPY HOUR 17-19", "#ff7b00", "#ffffff", "bebas"), ("WINE BAR ワイン", "#4a0a1a", "#f4e6c8", "zen"),
          ("ROPPONGI 六本木", "#111111", "#ffffff", "bebas")]
ATLAS = Atlas([(f"blade{i}", 64, 320) for i in range(len(BLADES))] + [(f"board{i}", 384, 96) for i in range(len(BOARDS))] + [("louvers", 256, 256)])

PONDS = dk.Ponds(lambda name, g: g.distance(Point(-34.0, -241.0)) < 30.0, min_m2=200.0)


def adjust_terrain(dem, C, cell):
    return PONDS.adjust_terrain(dem, C, cell)


def adjust_building(b, cls, g, geoms, ctx):
    name = b["name"] or ""
    lm = ctx.landmarks
    if g.geom_type != "Polygon":
        return geoms
    geoms = jk.police_box(b, geoms)
    top = max((q[2] for q in geoms), default=0.0)
    c = g.centroid
    if name == NACT:
        lm["_nact"] = {"ring": [[round(x, 2), round(y, 2)] for x, y in g.exterior.coords], "top_m": round(top, 1), "ground_m": round(ctx.ground(c.x, c.y), 2)}
        b["facade_color"] = "#d8d6d0"
    (cx, cy), r = CROSSING
    if (b["class"] or "") in SIGN_CLASSES and geoms and 25 < g.area < 2000 and 5 <= top <= 50 and math.hypot(c.x - cx, c.y - cy) < r:
        ctx.signs.append((g, top))
    return geoms


def finalize(ctx):
    C, lm = ctx.city, ctx.landmarks
    lm["ponds"] = PONDS.anchors(C, ctx.ground)
    lm["signs"] = {"sites": jk.sign_sites(C, ctx.signs, ctx.ground)}
    art = sorted((r["geom"] for r in jk.overture(C, "infrastructure", f"name = '{MAMAN}'")), key=lambda q: -q.area)   # the mapped outline before a point
    if art:
        p = art[0].centroid
        lm["maman"] = {"c": dk.rnd((p.x, p.y)), "z": round(ctx.ground(p.x, p.y), 2)}
        ctx.labels["Maman ママン"] = [round(p.x, 1), round(p.y, 1), round(ctx.ground(p.x, p.y) + 14, 1)]
    n = lm.pop("_nact", None)
    if n:
        g = Polygon(n["ring"])
        x0, y0, x1, y1 = g.bounds
        # the wave runs along the east face, from the south-east corner to the north-east one, a few metres out
        ys = np.linspace(y0 + 6.0, y1 - 6.0, 60)
        line = []
        for y in ys:
            q = LineString([(x0 - 1, y), (x1 + 1, y)]).intersection(g)
            xe = max((pt[0] for gg in getattr(q, "geoms", [q]) for pt in getattr(gg, "coords", [])), default=None)
            if xe is not None:
                line.append([round(xe, 2), round(y, 2)])
        lm["nact"] = {"face": line, "z": n["ground_m"], "h": round(min(max(n["top_m"], 18.0), 22.0), 1)}
        ctx.labels["The National Art Center 国立新美術館"] = [round(g.centroid.x, 1), round(g.centroid.y, 1), round(n["ground_m"] + 30, 1)]
    kz = [r["geom"] for r in jk.overture(C, "segment", f"name = '{KEYAKIZAKA}'") if r["geom"].geom_type == "LineString"]
    trees = []
    for ln in kz:
        for t in np.arange(4.0, ln.length - 2.0, 9.0):
            p = ln.interpolate(t)
            q = ln.interpolate(min(t + 1.0, ln.length))
            d = unit(np.array([q.x - p.x, q.y - p.y]))
            for s in (-1, 1):
                o = np.array([p.x, p.y]) + left_of(d) * s * 8.5
                trees.append([*dk.rnd(o), round(ctx.ground(*o), 2)])
    lm["keyakizaka"] = trees
    ctx.labels["Roppongi crossing 六本木交差点"] = [40.0, 30.0, round(ctx.ground(40.0, 30.0) + 30, 1)]


# ---------------------------------------------------------------- meshes

def maman(K, m):
    """The spider: a ribbed body and a marble-egged sac under it, high up; eight legs, each up from the body
    to a knee and down in a long taper to a point on the ground."""
    x, y = m["c"]
    z0 = m["z"]
    zb = z0 + MAMAN_H * 0.78
    B = K("bronze_dark")
    lathe_at(B, x, y, [(zb - 0.9, 0.0), (zb - 0.6, 0.7), (zb + 0.1, 0.95), (zb + 0.6, 0.6), (zb + 0.8, 0.0)], 14)   # the body
    lathe_at(B, x + 0.5, y, [(zb + 0.4, 0.0), (zb + 0.6, 0.45), (zb + 1.1, 0.35), (zb + 1.25, 0.0)], 10)
    lathe_at(B, x, y, [(zb - 2.4, 0.0), (zb - 2.2, 0.45), (zb - 1.5, 0.75), (zb - 0.9, 0.55)], 12)                  # the sac's cage
    for k in range(9):   # the eggs, marble, in the sac
        a = k * math.tau / 9
        lathe_at(K("marble"), x + 0.32 * math.cos(a), y + 0.32 * math.sin(a), [(zb - 1.95, 0.0), (zb - 1.8, 0.18), (zb - 1.6, 0.0)], 8)
    for k in range(8):
        a = (k + 0.5) * math.tau / 8 + (0.18 if k % 2 else -0.18)
        d = np.array([math.cos(a), math.sin(a)])
        hip = np.array([x, y]) + d * 0.8
        knee = np.array([x, y]) + d * MAMAN_SPAN * 0.32
        foot = np.array([x, y]) + d * MAMAN_SPAN * 0.52
        pts = [np.array([*hip, zb]), np.array([*(hip + d * 0.9), zb + 1.3]), np.array([*knee, z0 + MAMAN_H]),
               np.array([*(knee + d * 0.9), z0 + MAMAN_H * 0.75]), np.array([*(foot - d * 0.3), z0 + 2.0]), np.array([*foot, z0 + 0.05])]
        rs = [0.2, 0.19, 0.17, 0.15, 0.09, 0.03]
        for i in range(len(pts) - 1):
            B.tube([pts[i], pts[i + 1]], (rs[i] + rs[i + 1]) / 2, 6)
            lathe_at(B, pts[i + 1][0], pts[i + 1][1], [(pts[i + 1][2] - rs[i + 1] * 1.4, 0.0), (pts[i + 1][2], rs[i + 1] * 1.4), (pts[i + 1][2] + rs[i + 1] * 1.4, 0.0)], 6)


def nact_wave(K, n):
    """The glass front in waves: louvered glass between the face and the wave, swelling out to about 4.5 m
    in three crests along the east face; mullions every few metres; a flat roof edge."""
    face = np.asarray(n["face"], float)
    if len(face) < 4:
        return
    z0, h = n["z"], n["h"]
    L = np.r_[0, np.cumsum(np.hypot(*np.diff(face, axis=0).T))]
    out = 1.0 + 3.5 * np.sin(np.pi * L / L[-1] * 3.0) ** 2
    lean = lambda z: 1.0 + 0.25 * (z - z0) / h            # leaning out as it rises, like the real one
    W = [np.array([p[0] + o * lean(z), p[1], z]) for p, o in zip(face, out) for z in (z0, z0 + h)]
    G = K("louvers")
    u0, v0, u1, v1 = ATLAS.uv("louvers")
    for i in range(len(face) - 1):
        a0, a1, b0, b1 = W[2 * i], W[2 * i + 1], W[2 * i + 2], W[2 * i + 3]
        tu = (L[i] / 12.0) % 1.0
        G.quad(b0, a0, a1, b1, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]])
        if i % 4 == 0:
            K("mullion").box(a0, a1, 0.15, 0.25)
        # the roof between the wave and the face
        K("mullion").quad(np.array([*face[i], z0 + h]), np.array([*face[i + 1], z0 + h]), b1, a1)


def keyakizaka(K, trees):
    """The zelkovas' lights: each tree's trunk and a dozen branches wound in LEDs, a vase of light 3 to 8 m
    up as a zelkova's crown grows, blue on most trees and white on every third."""
    rng = np.random.default_rng(66)
    for k, (x, y, z) in enumerate(trees):
        m = K("led_blue" if k % 3 else "led_white", "lit")
        m.tube([np.array([x, y, z + 2.2]), np.array([x, y, z + 5.0])], 0.05, 3)
        for b in range(12):
            a = b * math.tau / 12 + rng.normal(0, 0.2)
            z1 = z + 3.6 + (b % 4) * 0.7
            r = 1.6 + rng.uniform(0, 1.6)
            mid = np.array([x + r * 0.55 * math.cos(a), y + r * 0.55 * math.sin(a), z1 + 1.2])
            tip = np.array([x + r * math.cos(a), y + r * math.sin(a), z1 + 2.6 + rng.uniform(0, 1.2)])
            m.tube([np.array([x, y, z1]), mid, tip], 0.03, 3)


def landmark_meshes(scene):
    lm = scene["landmarks"]
    K = Kit("ropp", MATERIALS)
    rng = np.random.default_rng(2003)
    if lm.get("ponds"):
        dk.pond_meshes(K, lm["ponds"])
    if lm.get("signs"):
        jk.street_signs(K, ATLAS, lm["signs"]["sites"], ([f"board{i}" for i in range(len(BOARDS))], [f"blade{i}" for i in range(len(BLADES))]), rng)
    if "maman" in lm:
        maman(K, lm["maman"])
    if "nact" in lm:
        nact_wave(K, lm["nact"])
    if lm.get("keyakizaka"):
        keyakizaka(K, lm["keyakizaka"])
    return MATERIALS, K.meshes()


def landmark_assets(out_dir, scene):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (ATLAS.W, ATLAS.H), (30, 30, 34))
    d = ImageDraw.Draw(img)
    dk.draw_signs(d, ATLAS, BLADES, BOARDS)
    x, y, w, h = ATLAS.rects["louvers"]   # glass louvers: pale green-grey bands with bright edges
    for k in range(h + 8):
        t = (k % 16) / 16
        c = (int(150 + 60 * t), int(176 + 50 * t), int(178 + 50 * t)) if t < 0.8 else (238, 244, 244)
        d.line([(x - 4, y - 4 + k), (x + w + 4, y - 4 + k)], fill=c)
    img.save(f"{out_dir}/atlas.jpg", quality=90)
    return ["atlas.jpg"]


def landmark_glows(scene):
    lm = scene["landmarks"]
    out = dk.sign_glows((lm.get("signs") or {}).get("sites", []), every=3, colours=("#ff5ab0", "#7ad8ff", "#ffe08a", "#b07aff"), strength=0.3)
    for k, (x, y, z) in enumerate(lm.get("keyakizaka", [])):
        if k % 2 == 0:
            out.append([x, y, 9.0, "#8fb4ff", 0.35])
    return out


def woods_clear(scene):
    lm = scene.get("landmarks", {})
    out = [p["ring"] for p in lm.get("ponds", [])]
    if "maman" in lm:
        out.append([*lm["maman"]["c"], 7.0])
    return out


def game_ponds(scene):
    return scene["landmarks"].get("ponds", [])


def game_extras(scene):
    lm = scene["landmarks"]
    spots, chatter, close = [], [], []
    m = lm.get("maman")
    if m:
        at = np.asarray(m["c"]) + np.array([0.0, -9.0])
        spots.append(dk.spot("maman", "Maman ママン", at, m["z"], "Look up at the spider",
                             ["Maman, by Louise Bourgeois: a spider nine metres high, with marble eggs under her body. She made it about her mother, a weaver.",
                              "Everybody arranges to meet 'under the spider'. Look up: the eggs are there."], 5.0))
        close.append(dk.close_to("Maman, between her legs", np.asarray(m["c"]) + np.array([0.0, -1.5]), m["z"], at, 2.0))
    n = lm.get("nact")
    if n and n["face"]:
        p = n["face"][len(n["face"]) // 2]
        at = np.array([p[0] + 22.0, p[1]])
        spots.append(dk.spot("nact", "The National Art Center 国立新美術館", at, n["z"], "Look at the glass wave",
                             ["The National Art Center: Kisho Kurokawa's last big building, 2007. No collection of its own, only exhibitions, fourteen thousand square metres of them.",
                              "The glass louvers keep the sun out and let the light in. Inside, two cones of concrete hold up cafes in the air."], 8.0))
    kz = lm.get("keyakizaka") or []
    if kz:
        x, y, z = kz[len(kz) // 2]
        spots.append(dk.spot("keyaki", "Keyakizaka けやき坂", [x, y], z, "Look down the avenue",
                             ["Keyakizaka: in November and December the zelkovas are wound in blue and white lights, all the way down the hill to Tokyo Tower.",
                              "Come back after dark. Couples queue to take the same photograph."], 8.0))
    st = (lm.get("signs") or {}).get("sites", [])
    if st:
        x, y, nx, ny, g, top, L = st[len(st) // 2]
        chatter.append({"at": [x + nx * 4, y + ny * 4, g], "radius": 14, "side": True,
                        "lines": [["Tout", "Happy hour, two drinks, one price!"], ["Visitor", "Which floor?"], ["Tout", "Every floor! Seventh is the best."]]})
    return {"spots": spots, "chatter": chatter, "close": close}
