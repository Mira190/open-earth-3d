"""Hachiko Square's own plants: the clumps of lilyturf (ryu-no-hige) between the rocks in the bed
behind Hachiko, and the atlas they are drawn with.

From photographs of the square (Wikimedia Commons, April 2020, February 2021, July 2025;
docs/cities/shibuya.md) the bed round Hachiko's back holds rocks, a stone lantern and lilyturf. Its
garden pines and maple are left out on purpose, so that nothing stands over the statue and he stays
the centre of the square. The two round planters' Somei-yoshino cherries are the shared trees'
(web/trees.js, `trees.areas` in city.json), so they flower, leaf, turn and go bare with the season.

A clump is three crossed cards cut out of a drawn atlas (`cutout`: their clear pixels are holes, in
their shadows too). Its height is an estimate from the photographs.
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ATLAS = "hachiko_garden.png"
CELL_PX = 256                  # the atlas, in the final image; drawn at twice that


def cell_uv():
    """The atlas's rectangle (u0, v0, u1, v1), inset a texel."""
    e = 1.0 / (2 * CELL_PX)
    return (e, e, 1 - e, 1 - e)


# ---------------------------------------------------------------- the atlas

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


def draw_atlas(path):
    """The lilyturf's atlas, a 256 px RGBA PNG, drawn at twice that."""
    rng = np.random.default_rng(1934)
    out = _turf(rng).resize((CELL_PX, CELL_PX), Image.LANCZOS)
    # bleed the colours into the clear pixels round them, so the mips do not fringe dark
    a = out.getchannel("A")
    rgb = out.convert("RGB")
    blur = Image.composite(rgb, rgb.filter(ImageFilter.BoxBlur(4)), a.point(lambda v: 255 if v > 8 else 0))
    blur.putalpha(a)
    blur.save(path, optimize=True)
    return path


# ---------------------------------------------------------------- the clumps

def card(m, c, right, up, w, h):
    """A card: a quad w wide and h tall, standing on c along up."""
    right, up = right / (np.linalg.norm(right) or 1), up / (np.linalg.norm(up) or 1)
    u0, v0, u1, v1 = cell_uv()
    p = [c - right * w / 2, c + right * w / 2, c + right * w / 2 + up * h, c - right * w / 2 + up * h]
    m.quad(*p, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]])


def turf(K, base, seed, h=0.32):
    """A clump of lilyturf: three crossed cards."""
    rng = np.random.default_rng(seed)
    leaf = K("hk_leaf")
    a0 = rng.uniform(0, math.pi)
    for k in range(3):
        a = a0 + math.pi * k / 3
        sz = h * rng.uniform(0.85, 1.15)
        card(leaf, np.asarray(base, float), np.array([math.cos(a), math.sin(a), 0.0]), np.array([0, 0, 1.0]), sz * 1.3, sz)
