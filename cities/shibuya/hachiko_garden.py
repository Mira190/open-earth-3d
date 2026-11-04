"""Hachiko Square's own plants: the two cherry trees in the round planters, the clumps of lilyturf in
the bed behind Hachiko, and the leaf atlas they are drawn with.

What stands there, from photographs of the square (Wikimedia Commons, April 2020, February 2021, July
2025; docs/cities/shibuya.md):
  - each round planter holds a Somei-yoshino cherry: a short dark trunk that forks a little over head
    height into four or five limbs, which rise and then spread into a wide, open crown, 7 to 8 m high
    and as wide; in autumn its leaves turn yellow, orange and red and thin out;
  - the bed round Hachiko's back holds rocks, a stone lantern and lilyturf (ryu-no-hige) clumps
    between the rocks. Its garden pines and maple are left out on purpose, so that nothing stands over
    the statue and he stays the centre of the square.

The trees are grown, not sculpted: a trunk and limbs as tapering tubes, forks and twigs from them, and
leaf cards (quads cut out of a drawn atlas, `cutout`: their clear pixels are holes, in their shadows
too) at the twigs' ends. Everything here is an estimate from the
photographs: the trees' heights, spreads and branching. The leaves keep the colour of early autumn
(the cherries a mix of turning green, yellow and orange-red) all year: they do not follow the
season as the shared trees do.
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ATLAS = "hachiko_garden.png"
CELL_PX = 256                  # a cell of the atlas, in the final image; drawn at twice that
CELLS = {"cherry": 0, "cherry_red": 1, "turf": 3}   # 2 x 2 (cell 2 free)


def cell_uv(k):
    """A cell's rectangle (u0, v0, u1, v1), v up (three.js flips the image), inset a texel."""
    c, r = k % 2, k // 2
    e = 1.0 / (2 * CELL_PX)
    return (c / 2 + e, 1 - (r + 1) / 2 + e, (c + 1) / 2 - e, 1 - r / 2 - e)


# ---------------------------------------------------------------- the atlas

def _leaf(d, x, y, ang, L, W, col, edge):
    """A cherry leaf (obovate, pointed, its stalk at x, y), with a paler midrib."""
    ca, sa = math.cos(ang), math.sin(ang)
    pts = []
    for k in range(17):
        t = k / 16
        w = W * (math.sin(math.pi * t) ** 0.8) * (0.75 + 0.35 * t) * (1 - 0.9 * max(0, t - 0.85) / 0.15)
        pts.append((t * L, w / 2))
    poly = pts + [(p[0], -p[1]) for p in reversed(pts)]
    P = [(x + ca * u - sa * v, y + sa * u + ca * v) for u, v in poly]
    d.polygon(P, fill=col, outline=edge)
    d.line([(x, y), (x + ca * L * 0.92, y + sa * L * 0.92)], fill=tuple(min(255, c + 28) for c in col[:3]) + (255,), width=2)


def _cherry(rng, palette):
    S = CELL_PX * 2
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    twig = (78, 60, 52, 255)
    # a spray: a twig up the middle, two side twigs, leaves alternating along them
    stems = [((S * 0.5, S * 0.99), (S * 0.5 + rng.uniform(-30, 30), S * 0.12))]
    for side, lo, hi in ((-1, 0.5, 0.68), (1, 0.5, 0.68), (-1, 0.28, 0.4), (1, 0.28, 0.4)):
        y0 = S * rng.uniform(lo, hi)
        stems.append(((S * 0.5, y0), (S * 0.5 + side * S * rng.uniform(0.28, 0.4), y0 - S * rng.uniform(0.18, 0.3))))
    for (x0, y0), (x1, y1) in stems:
        d.line([(x0, y0), (x1, y1)], fill=twig, width=5)
    leaves = []
    for (x0, y0), (x1, y1) in stems:
        n = int(rng.integers(5, 8))
        base = math.atan2(y1 - y0, x1 - x0)
        for k in range(n):
            t = 0.18 + 0.82 * k / (n - 1)
            side = 1 if k % 2 else -1
            ang = base + side * rng.uniform(0.55, 1.0)
            leaves.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, ang, rng.uniform(78, 112), rng.uniform(40, 52)))
    rng.shuffle(leaves)
    for x, y, ang, L, W in leaves:
        c = np.asarray(palette[int(rng.integers(len(palette)))], float) * rng.uniform(0.86, 1.1)
        col = tuple(int(min(255, v)) for v in c) + (255,)
        _leaf(d, x, y, ang, L, W, col, tuple(int(v * 0.7) for v in c) + (255,))
    return img


def _turf(rng):
    """A clump of lilyturf: dark narrow blades arching up and out from the bottom middle."""
    S = CELL_PX * 2
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for k in range(46):
        x0 = S * 0.5 + rng.uniform(-S * 0.08, S * 0.08)
        lean = rng.uniform(-1.0, 1.0)
        h = rng.uniform(S * 0.5, S * 0.95)
        pts = []
        for j in range(9):
            t = j / 8
            pts.append((x0 + lean * S * 0.42 * t ** 1.6, S - 2 - h * (t - 0.35 * abs(lean) * t * t)))
        g = rng.uniform(0.75, 1.2)
        col = tuple(int(min(255, v * g)) for v in (40, 66, 38)) + (255,)
        for j in range(8):
            w = max(2, int(9 * (1 - j / 8)))
            d.line([pts[j], pts[j + 1]], fill=col, width=w)
    return img


CHERRY_TURNING = [(96, 122, 52), (110, 134, 58), (138, 146, 62), (168, 160, 70), (190, 162, 64), (150, 128, 54)]
CHERRY_AUTUMN = [(200, 120, 48), (212, 140, 58), (170, 70, 46), (182, 86, 56), (138, 92, 50), (196, 158, 60)]


def draw_atlas(path):
    """The garden's leaf atlas, a 512 px RGBA PNG: four cells of 256 px, drawn at twice that."""
    rng = np.random.default_rng(1934)
    S = CELL_PX * 2
    big = Image.new("RGBA", (S * 2, S * 2), (0, 0, 0, 0))
    for k, img in ((0, _cherry(rng, CHERRY_TURNING)), (1, _cherry(rng, CHERRY_AUTUMN)), (3, _turf(rng))):
        big.alpha_composite(img, ((k % 2) * S, (k // 2) * S))
    out = big.resize((CELL_PX * 2, CELL_PX * 2), Image.LANCZOS)
    # bleed the colours into the clear pixels round them, so the mips do not fringe dark
    a = out.getchannel("A")
    rgb = out.convert("RGB")
    blur = Image.composite(rgb, rgb.filter(ImageFilter.BoxBlur(4)), a.point(lambda v: 255 if v > 8 else 0))
    blur.putalpha(a)
    blur.save(path, optimize=True)
    return path


# ---------------------------------------------------------------- growing

def _bezier(a, c, b, n):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * a + 2 * (1 - t) * t * c + t * t * b


def _dir(az, el):
    return np.array([math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)])


def card(m, c, right, up, w, h, k, anchor="bottom"):
    """A leaf card: a quad w wide and h tall, from c along up (anchor bottom) or centred on c."""
    right, up = right / (np.linalg.norm(right) or 1), up / (np.linalg.norm(up) or 1)
    u0, v0, u1, v1 = cell_uv(k)
    b = c - up * h / 2 if anchor == "centre" else c
    p = [b - right * w / 2, b + right * w / 2, b + right * w / 2 + up * h, b - right * w / 2 + up * h]
    m.quad(*p, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]])


def _frame_for(n):
    """Two unit vectors across a normal n."""
    n = n / (np.linalg.norm(n) or 1)
    ref = np.array([0, 0, 1.0]) if abs(n[2]) < 0.9 else np.array([1.0, 0, 0])
    a = np.cross(n, ref)
    a /= np.linalg.norm(a)
    return a, np.cross(n, a)


def ellipsoid(m, c, r, rings=6, segs=10):
    """A closed ellipsoid of radii r = (rx, ry, rz) round c (smooth, shared vertices)."""
    pts = []
    for i in range(rings + 1):
        th = math.pi * i / rings
        row = []
        for j in range(segs + 1):
            ph = 2 * math.pi * j / segs
            row.append(c + np.array([r[0] * math.sin(th) * math.cos(ph), r[1] * math.sin(th) * math.sin(ph), -r[2] * math.cos(th)]))
        pts.append(row)
    m.grid(pts)


def cherry(K, base, seed, H=7.4, R=4.0, clear=2.5):
    """A Somei-yoshino cherry standing at base (x, y, z): its trunk, limbs, forks and twigs as tapering
    tubes ("hk_cbark"), its leaves as cards ("hk_leaf"); no leaf hangs lower than clear over the base."""
    rng = np.random.default_rng(seed)
    base = np.asarray(base, float)
    bark, leaf = K("hk_cbark"), K("hk_leaf")
    th = rng.uniform(1.75, 2.05)
    lean = np.array([*rng.uniform(-0.18, 0.18, 2), 0.0])
    top = base + np.array([0, 0, th]) + lean
    bark.tube([base - [0, 0, 0.1], base + np.array([0, 0, th * 0.5]) + lean * 0.4, top], [0.21, 0.17, 0.15], 10)
    n = int(rng.integers(4, 6))
    az0 = rng.uniform(0, 2 * math.pi)
    leaves = 0
    for i in range(n):
        az = az0 + 2 * math.pi * (i + rng.uniform(-0.18, 0.18)) / n
        el = math.radians(rng.uniform(38, 58))
        s = top - np.array([0, 0, rng.uniform(0.0, 0.35)])
        reach, rise = R * rng.uniform(0.5, 0.7), H * rng.uniform(0.62, 0.78) - th
        end = s + np.array([math.cos(az) * reach, math.sin(az) * reach, rise])
        ctrl = s + _dir(az, el) * 0.45 * np.linalg.norm(end - s) + np.array([0, 0, rise * 0.25])
        limb = _bezier(s, ctrl, end, 7)
        bark.tube(list(limb), list(np.linspace(0.13, 0.05, 7)), 8)
        for t in (0.42, 0.68, 0.92):
            j = int(t * 6)
            p = limb[j]
            tang = limb[min(j + 1, 6)] - limb[max(j - 1, 0)]
            taz = math.atan2(tang[1], tang[0]) + rng.uniform(-0.75, 0.75)
            tel = math.radians(rng.uniform(5, 40))
            L2 = rng.uniform(1.3, 2.2) * (1.15 - 0.3 * t)
            e2 = p + _dir(taz, tel) * L2
            c2 = p + _dir(taz, tel + 0.35) * L2 * 0.5
            sec = _bezier(p, c2, e2 - [0, 0, 0.25 * L2 * rng.uniform(0, 1)], 5)
            bark.tube(list(sec), list(np.linspace(0.05, 0.02, 5)), 6)
            for u in (0.25, 0.5, 0.75, 1.0):
                q = sec[int(u * 4)]
                taz2 = taz + rng.uniform(-1.0, 1.0)
                tw_end = q + _dir(taz2, math.radians(rng.uniform(-10, 45))) * rng.uniform(0.45, 0.85)
                bark.tube([q, (q + tw_end) / 2 + [0, 0, 0.05], tw_end], [0.018, 0.013, 0.008], 4)
                # the leaves round the twig's end: sprays leaning out of the crown and up
                for _ in range(int(rng.integers(6, 10))):
                    c = tw_end + rng.normal(0, 0.32, 3) * [1, 1, 0.6]
                    if c[2] - base[2] < clear:
                        continue
                    out = c - (base + [0, 0, H * 0.55])
                    out[2] *= 0.4
                    out /= np.linalg.norm(out) or 1
                    up = out * rng.uniform(0.4, 0.9) + np.array([0, 0, 1.0]) + rng.normal(0, 0.35, 3)
                    right = np.cross(up, rng.normal(0, 1, 3))
                    sz = rng.uniform(0.9, 1.25)
                    card(leaf, c, right, up, sz, sz, CELLS["cherry"] if rng.random() < 0.55 else CELLS["cherry_red"], anchor="centre")
                    leaves += 1
    return leaves


def turf(K, base, seed, h=0.32):
    """A clump of lilyturf: three crossed cards."""
    rng = np.random.default_rng(seed)
    leaf = K("hk_leaf")
    a0 = rng.uniform(0, math.pi)
    for k in range(3):
        a = a0 + math.pi * k / 3
        sz = h * rng.uniform(0.85, 1.15)
        card(leaf, np.asarray(base, float), np.array([math.cos(a), math.sin(a), 0.0]), np.array([0, 0, 1.0]), sz * 1.3, sz, CELLS["turf"])
