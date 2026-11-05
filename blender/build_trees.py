"""Build the street and park trees every city shares: web/assets/trees/trees.glb and
trees.json.

Nineteen species: London plane, elm, eucalyptus (gum), Moreton Bay fig, jacaranda, Canary
Island date palm and Japanese maple (momiji, red in autumn: web/trees.js); Japan's black pine,
cryptomeria (sugi), camphor, zelkova and ginkgo (the last two turn in autumn too) and the
Somei-yoshino cherry (pale pink on bare branches for a fortnight in spring) with three other
cherries on their own dates: the weeping shidarezakura, the February kawazu-zakura and the mid-April
yaezakura, all on bark banded with lenticels (web/trees.js draws the bands); an evergreen
broadleaf for Hong Kong's hills and the laurel forest of the shrine groves; and the coral cays'
pisonia and she-oak (casuarina). Each is grown,
not sculpted: points are scattered through the shell of
the species' crown shape, clustered into limbs and twigs, and branches are grown from the
trunk out to each cluster; every point carries a card with a spray of leaves from a leaf
atlas drawn here too. Each tree comes in three levels of detail: the full tree, a sparse
one with bigger cards, and a trunk with a crown hull for a long way off.

Each mesh's colour attribute carries what the game's shaders need: red the ambient
occlusion (darker inside the crown and low down), green how far the wind moves it, blue a
phase for the leaves' flutter. Leaf cards carry normals that point out of the crown, so it
lights as a mass, not as cards.

    pip install bpy==5.2.3 pillow
    python blender/build_trees.py                # build the trees
    python blender/build_trees.py --preview DIR  # render quick previews instead
"""
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_vehicles import MAT, ROOT, TAU, Mesh, camera, ground_plane, material, render, select, setup_render, sun_lamp  # noqa: E402
from meshopt import compress  # noqa: E402  (build_vehicles puts pipeline/ on the path)
from glb_webp import webp  # noqa: E402

OUT = os.path.join(ROOT, "web", "assets", "trees")
DOCS = os.path.join(ROOT, "docs", "images", "trees")

# ------------------------------------------------------------ the leaf atlas
# 4 x 6 cells, each a spray of leaves growing up from the middle of its bottom edge. The jacaranda's
# bloom cell stays right of its leaf cell ("bloom" beside "jacaranda"): web/trees.js swaps one for the other
# with the season. The cherries' bloom cells follow each other from "sakura" (SAKURA_CELLS, in that order:
# the Somei-yoshino, the weeping cherry, the kawazu-zakura and the yaezakura) and all show the cherry's
# leaf cell ("cherry") out of flower. Cells 21 and 22 are the coral cays' beach scrub; 23 is free.
ATLAS_W, ATLAS_H, CW, CH = 1024, 3072, 256, 512
COLS, ROWS = ATLAS_W // CW, ATLAS_H // CH
CELLS = {"gum": 0, "plane": 1, "elm": 2, "fig": 3, "jacaranda": 4, "bloom": 5, "palm": 6, "maple": 7,
         "pine": 8, "sugi": 9, "camphor": 10, "zelkova": 11, "ginkgo": 12, "evergreen": 13, "pisonia": 14, "casuarina": 15,
         "cherry": 16, "sakura": 17, "shidare": 18, "kawazu": 19, "yae": 20,
         "scaevola": 21, "argusia": 22}
SAKURA_CELLS = ["sakura", "shidare", "kawazu", "yae"]


def cell_uv(k):
    """The cell's rectangle in UV space (v up), inset half a texel."""
    c, r = k % COLS, k // COLS
    eu, ev = 0.5 / ATLAS_W, 0.5 / ATLAS_H
    return (c * CW / ATLAS_W + eu, 1 - (r + 1) * CH / ATLAS_H + ev, (c + 1) * CW / ATLAS_W - eu, 1 - r * CH / ATLAS_H - ev)


def hexrgb(h, k=1.0):
    h = h.lstrip("#")
    return tuple(max(0, min(255, int(int(h[i:i + 2], 16) * k))) for i in (0, 2, 4))


def leaf_poly(kind, L, Wd, rng):
    """A leaf's outline in its own frame: the stalk at the origin, the tip along +x."""
    n = 14
    ts = np.linspace(0, 1, n)
    if kind == "lance":     # eucalyptus, palm leaflets: long, narrow, pointed, a little curved
        w = Wd / 2 * np.sin(np.pi * ts ** 0.75) ** 0.9
        bend = 0.12 * L * ts ** 2
        up = [(L * t, b + ww) for t, ww, b in zip(ts, w, bend)]
        lo = [(L * t, b - ww) for t, ww, b in zip(ts, w, bend)]
        return up + lo[::-1]
    if kind == "ovate":     # elm, fig, jacaranda leaflets
        w = Wd / 2 * np.sin(np.pi * ts) ** 0.7 * (1.15 - 0.35 * ts)
        up = [(L * t, ww) for t, ww in zip(ts, w)]
        lo = [(L * t, -ww) for t, ww in zip(ts, w)]
        if rng.random() < 0.5:      # serrated edge
            up = [(x, y * (1 + 0.08 * (i % 2))) for i, (x, y) in enumerate(up)]
        return up + lo[::-1]
    if kind == "maple":     # Acer palmatum: seven narrow pointed lobes, cut deep, from the stalk end
        pts = []
        R = L / 2
        for a in np.linspace(-0.95 * math.pi, 0.95 * math.pi, 70):
            lobe = abs(math.cos(3.5 * a)) ** 3
            r = R * (0.34 + 0.66 * lobe) * (1 - 0.3 * abs(a) / math.pi)
            pts.append((R * 0.8 + r * math.cos(a), r * math.sin(a)))
        return pts
    if kind == "fan":       # ginkgo: a fan on a long stalk, its outer edge wavy and notched in the middle
        pts = [(0, 0)]
        R = L
        for a in np.linspace(-0.62, 0.62, 30):
            notch = 1 - 0.22 * math.exp(-(a / 0.07) ** 2)
            r = R * (0.92 + 0.05 * math.sin(a * 23)) * notch
            pts.append((R * 0.35 + r * 0.65 * math.cos(a), r * 0.65 * math.sin(a)))
        return pts
    # palmate (plane): five pointed lobes round the stalk end
    pts = []
    R = L / 2
    for a in np.linspace(-0.92 * math.pi, 0.92 * math.pi, 40):
        lobe = abs(math.cos(2.5 * a)) ** 2.5
        r = R * (0.55 + 0.45 * lobe)
        pts.append((R + r * math.cos(a) * 0.95, r * math.sin(a)))
    return pts


def draw_leaf(dr, x, y, ang, kind, L, Wd, col, rng, S):
    pts = leaf_poly(kind, L * S, Wd * S, rng)
    ca, sa = math.cos(ang), math.sin(ang)
    P = [(x + px * ca - py * sa, y + px * sa + py * ca) for px, py in pts]
    dr.polygon(P, fill=col)
    # one half a shade darker, and a pale midrib: the leaf reads as folded
    half = len(P) // 2
    col = tuple(col[:3])
    dark = tuple(int(c * 0.82) for c in col) + (255,)
    dr.polygon([(x, y)] + P[half:], fill=dark)
    tip = (x + L * S * 0.9 * ca, y + L * S * 0.9 * sa)
    dr.line([(x, y), tip], fill=tuple(min(255, int(c * 1.18)) for c in col) + (255,), width=max(1, int(S)))


def spray(img, k, spec, rng, S=2):
    """Draw one cell: twigs from the bottom middle, leaves along them."""
    dr = ImageDraw.Draw(img)
    ox, oy = 0, 0
    base = (ox + CW * S / 2, oy + CH * S - 6 * S)
    twig = hexrgb(spec.get("twig", "#5a4a3a")) + (255,)
    for t in range(spec["twigs"]):
        a = -math.pi / 2 + rng.uniform(-1, 1) * spec["spread"]
        length = CH * S * rng.uniform(0.55, 0.92)
        n = 24
        pts = [base]
        x, y = base
        for i in range(n):
            a += rng.uniform(-0.05, 0.05) + spec.get("arch", 0) * 0.012
            x += math.cos(a) * length / n
            y += math.sin(a) * length / n
            x = min(max(x, ox + 56 * S), ox + (CW - 56) * S)
            y = max(y, oy + 20 * S)
            pts.append((x, y))
        dr.line(pts, fill=twig, width=int(spec.get("twig_w", 3) * S))
        # leaves or flowers along the twig, alternating sides, the oldest near the base
        for i in range(spec.get("start", 3), n, spec["every"]):
            px, py = pts[i]
            qx, qy = pts[min(i + 1, n)]
            ta = math.atan2(qy - py, qx - px)
            for side in (1, -1):
                if rng.random() > spec.get("fill", 1.0):
                    continue
                ang = ta + side * rng.uniform(*spec["angle"]) + spec.get("droop", 0) * (1 if math.cos(ta + side) > 0 else -1)
                scale = rng.uniform(0.75, 1.15) * (0.6 + 0.4 * i / n if spec.get("taper") else 1)
                col = hexrgb(spec["colours"][rng.integers(len(spec["colours"]))], rng.uniform(0.85, 1.12))
                if spec["leaf"] == "needle":   # a pine's tuft: paired needles fanned forward from the twig
                    for _ in range(16):
                        na = ta + rng.normal(0, 0.6) * side
                        nl = spec["L"] * S * scale * rng.uniform(0.7, 1.1)
                        dr.line([(px, py), (px + math.cos(na) * nl, py + math.sin(na) * nl)], fill=col + (255,), width=max(2, int(2.2 * S)))
                elif spec["leaf"] == "awl":    # a cryptomeria's: short stiff awls all round a cord of green
                    for _ in range(8):
                        na = ta + side * rng.uniform(0.35, 1.1)
                        nl = spec["L"] * S * scale * rng.uniform(0.6, 1.0)
                        ox_, oy_ = px + rng.normal(0, 2) * S, py + rng.normal(0, 2) * S
                        dr.line([(ox_, oy_), (ox_ + math.cos(na) * nl, oy_ + math.sin(na) * nl)], fill=col + (255,), width=max(3, int(3.2 * S)))
                    dr.ellipse([px - 7 * S, py - 7 * S, px + 7 * S, py + 7 * S], fill=col + (255,))
                elif spec["leaf"] == "strand":  # a she-oak's branchlets: jointed green threads hanging from the twig
                    x_, y_ = px, py
                    a_ = ta + side * rng.uniform(0.3, 0.8)
                    pts_ = [(x_, y_)]
                    for _ in range(12):
                        a_ += (math.pi / 2 - a_) * 0.12      # gravity pulls each joint down
                        x_ += math.cos(a_) * spec["L"] * S / 12
                        y_ += math.sin(a_) * spec["L"] * S / 12
                        pts_.append((x_, y_))
                    dr.line(pts_, fill=col + (255,), width=max(4, int(4.0 * S)))
                elif spec["leaf"] == "blossom":  # a cherry's: umbels of three to five five-petalled flowers on
                    # short stalks from a bud on the bare twig, pale pink fading to white, a darker eye
                    cx, cy = px + side * rng.uniform(2, 6) * S, py - rng.uniform(0, 4) * S
                    for _ in range(int(rng.integers(4, 7))):
                        fa = rng.uniform(0, TAU)
                        fd = rng.uniform(6, 16) * S
                        fx, fy = cx + math.cos(fa) * fd, cy + math.sin(fa) * fd * 0.8
                        dr.line([(cx, cy), (fx, fy)], fill=hexrgb("#7a4a48") + (255,), width=max(1, int(S)))
                        pc = hexrgb(spec["colours"][rng.integers(len(spec["colours"]))], rng.uniform(0.94, 1.04))
                        pr = rng.uniform(5.0, 7.4) * S * scale * spec.get("petal", 1.0)
                        turn = rng.uniform(0, TAU)
                        for q in range(5):
                            qa = turn + q * TAU / 5
                            ex, ey = fx + math.cos(qa) * pr * 0.62, fy + math.sin(qa) * pr * 0.62
                            dr.ellipse([ex - pr * 0.5, ey - pr * 0.5, ex + pr * 0.5, ey + pr * 0.5], fill=pc + (255,))
                        eye = hexrgb(spec.get("eye", "#c9707f"))
                        dr.ellipse([fx - pr * 0.22, fy - pr * 0.22, fx + pr * 0.22, fy + pr * 0.22], fill=eye + (255,))
                    if rng.random() < spec.get("buds", 0.35):   # a bud not yet open: a deeper pink
                        dr.ellipse([cx - 2.5 * S, cy - 3.5 * S, cx + 2.5 * S, cy + 3.5 * S], fill=hexrgb("#e3a2b4") + (255,))
                elif spec["leaf"] == "double":  # a yaezakura's (Kanzan): heavy clusters of double flowers, twenty
                    # and more petals each, hanging on long stalks, with the bronze young leaves that come out with them
                    cx, cy = px + side * rng.uniform(2, 6) * S, py
                    if rng.random() < spec.get("leaves", 0):
                        draw_leaf(dr, cx, cy, ta + side * rng.uniform(0.5, 1.0), "ovate", 26 * scale, 12 * scale,
                                  hexrgb(spec["leaf_colour"], rng.uniform(0.85, 1.1)) + (255,), rng, S)
                    for _ in range(int(rng.integers(2, 5))):
                        fa = rng.uniform(-0.6, 0.6) + math.pi / 2   # down the card, the way they hang
                        fd = rng.uniform(10, 22) * S
                        fx, fy = cx + math.cos(fa) * fd, cy + math.sin(fa) * fd
                        dr.line([(cx, cy), (fx, fy)], fill=hexrgb("#6e5a3a") + (255,), width=max(1, int(S)))
                        pc = hexrgb(spec["colours"][rng.integers(len(spec["colours"]))], rng.uniform(0.94, 1.04))
                        pr = rng.uniform(6.5, 9.0) * S * scale
                        turn = rng.uniform(0, TAU)
                        # three whorls of petals, the outer pale, the inner deeper and smaller
                        for ring, (n_, f_, k_) in enumerate(((7, 0.62, 1.04), (6, 0.42, 0.95), (5, 0.22, 0.86))):
                            rc = tuple(min(255, int(c * k_)) for c in pc)
                            for q in range(n_):
                                qa = turn + (q + 0.5 * ring) * TAU / n_
                                ex, ey = fx + math.cos(qa) * pr * f_, fy + math.sin(qa) * pr * f_
                                rr = pr * (0.46 - 0.08 * ring)
                                dr.ellipse([ex - rr, ey - rr, ex + rr, ey + rr], fill=rc + (255,))
                elif spec["leaf"] == "flower":
                    for _ in range(4):
                        fx, fy = px + rng.normal(0, 10) * S, py + rng.normal(0, 10) * S
                        r = rng.uniform(4, 8) * S
                        dr.ellipse([fx - r, fy - r * 0.8, fx + r, fy + r * 0.8], fill=col + (255,))
                        dr.ellipse([fx - r * 0.4, fy - r * 0.3, fx + r * 0.3, fy + r * 0.3], fill=tuple(min(255, int(c * 1.25)) for c in col) + (255,))
                else:
                    draw_leaf(dr, px, py, ang, spec["leaf"], spec["L"] * scale, spec["W"] * scale, col + (255,), rng, S)


SPRAYS = {
    "gum": dict(leaf="lance", L=62, W=11, twigs=5, spread=0.55, every=2, angle=(0.5, 1.0), droop=0.7, arch=1.0,
                colours=["#6f8a6a", "#7f9877", "#5f7a5b", "#8aa083", "#6a8063"], twig="#8a6a4e", twig_w=2),
    "plane": dict(leaf="palm", L=58, W=58, twigs=5, spread=0.75, every=3, angle=(0.5, 1.1), colours=["#4f7a34", "#5f8a3c", "#46702e", "#6a9142"],
                  twig="#6b5a44", fill=0.9),
    "elm": dict(leaf="ovate", L=30, W=18, twigs=7, spread=0.8, every=1, angle=(0.6, 1.1), colours=["#4a7330", "#5a8538", "#41692b", "#62893c"],
                twig="#4f4034", twig_w=2, fill=0.85),
    "fig": dict(leaf="ovate", L=46, W=24, twigs=6, spread=0.75, every=2, angle=(0.5, 1.0), colours=["#2f5a2a", "#3b6630", "#27502a", "#45703a"],
                twig="#5b5045"),
    "jacaranda": dict(leaf="ovate", L=12, W=6, twigs=9, spread=0.85, every=1, angle=(1.1, 1.5), colours=["#5b8a3a", "#6a9744", "#507f34"],
                      twig="#5a4a3a", twig_w=2, taper=True),
    "bloom": dict(leaf="flower", L=0, W=0, twigs=8, spread=0.9, every=2, angle=(0.6, 1.2), colours=["#8e6bc4", "#a184d6", "#7a5ab2", "#9a78cc"],
                  twig="#5a4a3a", twig_w=2, fill=0.95),
    "maple": dict(leaf="maple", L=46, W=46, twigs=8, spread=0.85, every=2, angle=(0.6, 1.2), droop=0.3,
                  colours=["#7aa646", "#86b24e", "#6c9a3e", "#93ba58"], twig="#6b3b2c", twig_w=2, fill=0.8),
    "pine": dict(leaf="needle", L=46, W=0, twigs=7, spread=0.85, every=1, angle=(0.2, 0.6), colours=["#2c4724", "#36522b", "#263f20", "#3d5a30"],
                 twig="#4f3d2e", twig_w=3, fill=0.95),
    "sugi": dict(leaf="awl", L=20, W=0, twigs=10, spread=0.9, every=1, start=1, angle=(0.4, 1.0), colours=["#2d4a2b", "#365533", "#294225", "#3f5a35"],
                 twig="#3f4a2c", twig_w=4),
    "camphor": dict(leaf="ovate", L=26, W=12, twigs=8, spread=0.85, every=1, angle=(0.6, 1.1), colours=["#5a8636", "#679441", "#4f7a2f", "#7da64e"],
                    twig="#5a5040", twig_w=2, fill=0.85),
    "zelkova": dict(leaf="ovate", L=20, W=9, twigs=9, spread=0.9, every=1, angle=(0.7, 1.2), colours=["#587f35", "#64903e", "#4e742f", "#6d9744"],
                    twig="#5f564a", twig_w=2, fill=0.8),
    "ginkgo": dict(leaf="fan", L=30, W=30, twigs=6, spread=0.8, every=2, angle=(0.5, 1.1), colours=["#6a9a3a", "#76a544", "#5f8c34", "#82ad4c"],
                   twig="#6b5f52", twig_w=2, fill=0.9),
    "evergreen": dict(leaf="ovate", L=34, W=14, twigs=7, spread=0.8, every=1, angle=(0.5, 1.0), colours=["#36602a", "#416c31", "#2f5525", "#4b7838"],
                      twig="#55493d", twig_w=2, fill=0.9),
    "pisonia": dict(leaf="ovate", L=60, W=34, twigs=5, spread=0.8, every=2, angle=(0.5, 1.0), colours=["#7ea548", "#8bb253", "#71983f", "#97bb5c"],
                    twig="#8a8170", twig_w=3),
    "casuarina": dict(leaf="strand", L=170, W=0, twigs=11, spread=0.85, every=1, angle=(0.3, 0.8), colours=["#66795a", "#728564", "#5b6d52", "#7c8d6c"],
                      twig="#5a4a3c", twig_w=2),
    # Somei-yoshino: the leaves (elliptic, pointed, finely toothed; fresh green after the flowers) and the
    # bloom (umbels on the bare twigs, white with a blush of pink, a pink-red eye as the petals age)
    "cherry": dict(leaf="ovate", L=30, W=15, twigs=7, spread=0.85, every=1, angle=(0.6, 1.1), colours=["#5f8c3a", "#6c9944", "#557f33", "#78a24c"],
                   twig="#3f322e", twig_w=2, fill=0.85),
    "sakura": dict(leaf="blossom", L=0, W=0, twigs=13, spread=0.72, every=1, start=1, angle=(0.6, 1.2),
                   colours=["#f9dfe1", "#f4d1d6", "#fcebeb", "#f0c6cd", "#fae5e5"], eye="#d68590", twig="#3f322e", twig_w=3, fill=0.9),
    # the other cherries (#163). The weeping cherry (shidarezakura, an Edohigan): smaller flowers, a clearer
    # pink, close along long thin twigs (its cards hang: the twigs fall from the top of the card)
    "shidare": dict(leaf="blossom", L=0, W=0, twigs=11, spread=0.26, every=1, start=1, angle=(0.7, 1.3), petal=0.8, buds=0.45,
                    colours=["#f5c9d3", "#efb8c6", "#f8d6dd", "#eaaabb", "#f3c1cd"], eye="#c75d78", twig="#3a2c2a", twig_w=2, fill=0.95),
    # kawazu-zakura: big single flowers of a deep, vivid pink in February, a red eye
    "kawazu": dict(leaf="blossom", L=0, W=0, twigs=12, spread=0.7, every=1, start=1, angle=(0.6, 1.2), petal=1.15, buds=0.5,
                   colours=["#f2a2bb", "#ee93b0", "#f5b2c6", "#e985a6", "#f4aac0"], eye="#b8385e", twig="#3f302c", twig_w=3, fill=0.9),
    # yaezakura (Kanzan, the commonest double cherry): pompoms of deep pink in mid April, with bronze new leaves
    "yae": dict(leaf="double", L=0, W=0, twigs=10, spread=0.75, every=2, start=1, angle=(0.6, 1.2), leaves=0.3, leaf_colour="#8f5a3a",
                colours=["#f5b3c9", "#f0a6bf", "#f8c4d4", "#eb9bb7"], twig="#3f302c", twig_w=3, fill=0.9),
    # the cays' beach scrub (#165): Scaevola's fleshy spoon-shaped leaves, yellow-green, crowded at the twigs'
    # ends; the octopus bush's (Argusia, Heliotropium arboreum) narrow silvery-grey felted leaves in rosettes
    "scaevola": dict(leaf="ovate", L=44, W=20, twigs=6, spread=0.8, every=1, start=8, angle=(0.4, 1.0), taper=True,
                     colours=["#9ab84c", "#a8c457", "#8cab43", "#b2cb63"], twig="#7f8a4a", twig_w=3, fill=0.95),
    "argusia": dict(leaf="lance", L=40, W=11, twigs=7, spread=0.85, every=1, start=6, angle=(0.5, 1.2), arch=0.4,
                    colours=["#a7b39b", "#b6c1a9", "#98a58d", "#c0c9b2"], twig="#8a8072", twig_w=2, fill=0.95),
    "palm": dict(leaf="lance", L=84, W=8, twigs=1, spread=0.04, every=1, start=2, angle=(0.9, 1.25), arch=0, droop=0.25,
                 colours=["#5e7a3a", "#6b8a42", "#55703a", "#738f48"], twig="#7a7a4a", twig_w=5),
}


def build_atlas(path):
    rng = np.random.default_rng(7)
    S = 2
    img = Image.new("RGBA", (ATLAS_W, ATLAS_H), (0, 0, 0, 0))
    for name, k in CELLS.items():
        cell = Image.new("RGBA", (CW * S, CH * S), (0, 0, 0, 0))
        spray(cell, k, SPRAYS[name], rng, S)
        # fade the last few texels at the cell's edge, so a card never shows a straight cut
        a = np.asarray(cell, np.float32)
        ex = np.minimum(np.arange(CW * S), np.arange(CW * S)[::-1]) / (6 * S)
        ey = np.minimum(np.arange(CH * S), np.arange(CH * S)[::-1]) / (6 * S)
        a[..., 3] *= np.clip(np.minimum(ex[None, :], ey[:, None]), 0, 1)
        cell = Image.fromarray(a.astype(np.uint8), "RGBA").resize((CW, CH), Image.LANCZOS)
        img.paste(cell, ((k % COLS) * CW, (k // COLS) * CH))
    # bleed the leaf colours into the clear texels, so mipmaps don't fringe dark
    a = np.asarray(img, np.float32) / 255
    rgb, al = a[..., :3], a[..., 3:]
    pm = Image.fromarray((rgb * al * 255).astype(np.uint8))
    am = Image.fromarray((al[..., 0] * 255).astype(np.uint8))
    bp = np.asarray(pm.filter(ImageFilter.GaussianBlur(10)), np.float32) / 255
    ba = np.asarray(am.filter(ImageFilter.GaussianBlur(10)), np.float32)[..., None] / 255
    bleed = np.clip(bp / np.maximum(ba, 1e-3), 0, 1)
    out = np.where(al > 0.02, rgb, bleed)
    final = np.concatenate([out, al], axis=-1)
    Image.fromarray((final * 255).astype(np.uint8), "RGBA").save(path, optimize=True)
    return path


# ------------------------------------------------------------ growing a tree
# Heights in metres; a crown is a shape that says, for a point, how far out it is (1 at the
# surface). Species are near their usual street-tree size; the game scales each tree.
SPECIES = {
    "plane": dict(deciduous=True, H=17.0, trunk=4.2, r0=0.36, crown=("ellipsoid", 10.6, 6.6, 6.4), n=330, size=2.9, n1=7, n2=4, leaf="plane",
                  bark="#a08f78", lean=0.04, leader=True, colour="#557f37", autumn_colour="#7f7444", note="London plane: the street tree of both cities"),
    "elm": dict(deciduous=True, H=16.0, trunk=3.0, r0=0.34, crown=("vase", 3.2, 16.0, 1.2, 7.4), n=320, size=2.7, n1=5, n2=5, leaf="elm",
                bark="#5a4c40", lean=0.02, leader=False, colour="#4f7a32", autumn_colour="#8c8240", note="English elm: Melbourne's avenues"),
    "gum": dict(H=18.0, trunk=6.5, r0=0.40, crown=("clumps", 12.5, 5.6, 5.0), n=200, size=2.8, n1=5, n2=3, leaf="gum",
                bark="#ddd5c6", lean=0.10, leader=True, colour="#73906d", note="Eucalyptus: pale bark, open crown in clumps"),
    "fig": dict(H=15.0, trunk=2.6, r0=0.85, crown=("dome", 8.6, 10.5, 6.4), n=440, size=3.1, n1=8, n2=4, leaf="fig",
                bark="#6e665c", lean=0.0, leader=False, colour="#335f2c", note="Moreton Bay fig: a broad dark dome on buttresses"),
    "jacaranda": dict(H=11.0, trunk=2.6, r0=0.26, crown=("umbrella", 7.2, 6.2, 3.8), n=280, size=2.5, n1=5, n2=4, leaf="jacaranda",
                      bloom=0.6, bark="#5c4e42", lean=0.06, leader=False, colour="#5f8a3d", bloom_colour="#9177c9",
                      note="Jacaranda: purple in late spring (cards swap to the bloom cell with the season)"),
    "palm": dict(H=11.0, trunk=8.2, r0=0.42, crown=("palm", 9.0, 4.2, 2.6), n=26, size=5.6, leaf="palm",
                 bark="#86745c", lean=0.03, colour="#62803e", note="Canary Island date palm"),
    "maple": dict(deciduous=True, H=7.5, trunk=1.5, r0=0.2, crown=("umbrella", 4.7, 4.6, 2.5), n=300, size=2.2, n1=6, n2=4, leaf="maple",
                  bark="#5b534a", lean=0.12, leader=False, colour="#628f3b", autumn_colour="#c2412b",
                  note="Japanese maple (momiji, Acer palmatum): a low, wide, layered crown; red from mid November in Tokyo and Kyoto"),
    # Japan's own: the Gyoen's and the palace lawns' black pines, the shrine woods' cryptomeria, the camphor
    # and the zelkova of the precincts and avenues, and the ginkgo rows that go gold in late autumn
    "pine": dict(H=11.0, trunk=3.4, r0=0.3, crown=("pads", 7.6, 5.4, 3.2), flat=0.34, n=420, size=2.5, n1=9, n2=3, leaf="pine",
                 bark="#4d4038", lean=0.28, leader=False, colour="#33502b",
                 note="Japanese black pine (kuromatsu, Pinus thunbergii): a leaning, crooked trunk under flat pads of needles, as on the "
                      "Kyoto Gyoen's and the Kokyo Gaien's lawns"),
    "sugi": dict(H=28.0, trunk=9.0, r0=0.45, crown=("cone", 7.0, 28.5, 4.4), n=480, size=3.3, n1=14, n2=3, leaf="sugi",
                 bark="#6b4532", lean=0.01, excurrent=True, colour="#2f4b2b",
                 note="Japanese cedar (sugi, Cryptomeria japonica): straight red-brown trunk, a narrow cone; the shrine woods' tree, and "
                      "stands for hinoki"),
    "camphor": dict(H=20.0, trunk=3.2, r0=0.72, crown=("dome", 12.5, 10.5, 7.2), n=540, size=3.4, n1=8, n2=4, leaf="camphor",
                    bark="#5a4f45", lean=0.04, leader=False, colour="#56813a",
                    note="Camphor laurel (kusunoki, Cinnamomum camphora): a broad, bright evergreen dome on a massive trunk; the "
                         "shrine trees of Osaka and Kyoto and Meiji Jingu's commonest"),
    "zelkova": dict(deciduous=True, H=20.0, trunk=3.0, r0=0.45, crown=("vase", 3.6, 20.0, 1.6, 8.6), n=420, size=3.0, n1=7, n2=5, leaf="zelkova",
                    bark="#857d70", lean=0.02, leader=False, colour="#557d35", autumn_colour="#8e6a3e",
                    note="Japanese zelkova (keyaki, Zelkova serrata): a broom of upswept limbs and fine twigs; the avenue tree of "
                         "Omotesando and the precincts, rust-orange in November"),
    "ginkgo": dict(deciduous=True, H=17.0, trunk=2.6, r0=0.34, crown=("ellipsoid", 10.0, 4.2, 7.4), n=360, size=2.8, n1=9, n2=3, leaf="ginkgo",
                   bark="#6e655a", lean=0.02, excurrent=True, colour="#62903a", autumn_colour="#c8a640",
                   note="Ginkgo (icho, Ginkgo biloba): a tall narrow crown on a central stem; Tokyo's and Osaka's street tree "
                        "(Midosuji, Jingu Gaien), gold in late November"),
    "cherry": dict(deciduous=True, H=8.8, trunk=2.3, r0=0.34, crown=("ellipsoid", 5.7, 6.2, 3.0), n=420, size=2.4, n1=6, n2=5, leaf="sakura",
                   bark="#3e3431", lean=0.1, leader=False, colour="#5d8a3a", autumn_colour="#b2532f", bloom_colour="#f3dadc",
                   bloom_offset_d=0, bloom_len=1.0, bark_bands=True,
                   note="Somei-yoshino cherry (Cerasus x yedoensis): a short dark trunk that forks low into a few limbs spreading wide, "
                        "a crown wider than it is tall; pale pink on bare branches for about a fortnight from late March in Tokyo "
                        "(web/trees.js), then fresh leaves, orange-red in November. Its cards are all bloom cards, shown as the leaf "
                        "cell out of flower"),
    # the subtropics: the evergreen laurel forest of Hong Kong's hills (Schima, Machilus) and of Japan's old
    # shrine groves (shii and kashi)
    "evergreen": dict(H=14.0, trunk=3.0, r0=0.36, crown=("ellipsoid", 9.0, 5.6, 5.2), n=380, size=2.5, n1=7, n2=4, leaf="evergreen",
                      bark="#5e554b", lean=0.07, leader=False, colour="#3a6129",
                      note="Evergreen broadleaf (Schima superba, Machilus; in Japan shii and kashi): a dense, dark, glossy rounded "
                           "crown; Hong Kong's hillside woods and the laurel forest of the old shrine groves"),
    # the coral cays: the reef islands' own trees (web/reef/life/flora.js)
    "pisonia": dict(H=9.5, trunk=3.6, r0=0.5, crown=("umbrella", 7.2, 6.4, 2.4), n=280, size=2.9, n1=6, n2=4, leaf="pisonia",
                    bark="#9f988a", lean=0.18, leader=False, colour="#759c42", stems=3,
                    note="Pisonia (Pisonia grandis): several pale soft trunks from one base, leaning out (fallen stems re-root and "
                         "sprout, so a tree is a clump), and a broad low canopy of big lime-green leaves; the coral cays' forest, "
                         "mostly 6-8 m on Heron Island"),
    "casuarina": dict(H=16.0, trunk=4.5, r0=0.28, crown=("cone", 4.5, 16.5, 3.4), n=300, size=4.0, n1=9, n2=3, leaf="casuarina",
                      bark="#4d3f35", lean=0.06, excurrent=True, colour="#5e7055",
                      note="Coastal she-oak (Casuarina equisetifolia): an open, tapering crown of drooping grey-green branchlets, "
                           "behind the beaches"),
    # the other cherries (#163): each flowers on its own day, an offset (days) from the Somei-yoshino's opening
    # (web/trees.js), over a bloom bloom_len times as long, and all carry the cherry's banded bark
    "shidarezakura": dict(deciduous=True, H=10.5, trunk=3.0, r0=0.46, crown=("weep", 6.2, 6.6, 4.6), n1=8, n2=11, size=2.0, leaf="shidare",
                          bark="#3d3230", lean=0.08, colour="#5d8a3a", autumn_colour="#b2532f", bloom_colour="#efbdca",
                          bloom_offset_d=-4, bloom_len=1.0, bark_bands=True,
                          note="Weeping cherry (shidarezakura, Cerasus spachiana 'Pendula', an Edohigan): a stout trunk, scaffold "
                               "limbs arching up into a dome and curtains of thin branches hanging nearly to the ground, pink a few "
                               "days before the Somei-yoshino: Maruyama Park's Gion weeping cherry, the temple gardens, Rikugien"),
    "kawazu": dict(deciduous=True, H=7.0, trunk=1.8, r0=0.26, crown=("ellipsoid", 4.6, 4.0, 2.8), n=360, size=2.2, n1=6, n2=5, leaf="kawazu",
                   bark="#41332f", lean=0.08, leader=False, colour="#5f8c3a", autumn_colour="#b2532f", bloom_colour="#ef9fb9",
                   bloom_offset_d=-37, bloom_len=1.7, bark_bands=True,
                   note="Kawazu-zakura (Cerasus 'Kawazu-zakura', from Kawazu in Izu): a small upright tree whose deep pink flowers "
                        "open in February, five weeks before the Somei-yoshino's, and last a month"),
    "yaezakura": dict(deciduous=True, H=8.0, trunk=2.0, r0=0.32, crown=("vase", 2.2, 8.2, 1.0, 4.6), n=400, size=2.4, n1=6, n2=5, leaf="yae",
                      bark="#3f3330", lean=0.04, leader=False, colour="#5a8638", autumn_colour="#b2532f", bloom_colour="#eba3bc",
                      bloom_offset_d=16, bloom_len=1.15, bark_bands=True,
                      note="Yaezakura (Cerasus serrulata 'Kanzan', the commonest double cherry): upswept limbs in a vase, heavy "
                           "deep pink double flowers in mid April, about two weeks after the Somei-yoshino, with bronze new leaves"),
    # the coral cays' beach scrub (#165), drawn as blobs before: low multi-stemmed shrubs behind the beach
    "scaevola": dict(H=2.2, trunk=0.35, r0=0.07, crown=("ellipsoid", 1.3, 2.2, 1.05), n=170, size=1.1, n1=6, n2=3, leaf="scaevola",
                     bark="#7d7a55", lean=0.3, leader=False, colour="#8fae48", stems=5,
                     note="Beach cabbage (Scaevola taccada): a dense mound of thick yellow-green leaves on many soft stems "
                          "from the sand, 1-3 m high and wider than tall, the first shrub behind a cay's beach"),
    "argusia": dict(H=3.6, trunk=0.8, r0=0.12, crown=("umbrella", 2.5, 2.7, 1.3), n=220, size=1.4, n1=6, n2=4, leaf="argusia",
                    bark="#6f655a", lean=0.35, leader=False, colour="#a4b098", stems=4,
                    note="Octopus bush (Argusia argentea, now Heliotropium arboreum): crooked spreading stems under a "
                         "rounded crown of silvery grey-green felted leaves in rosettes, about 3.5 m high and 5 m across"),
}


def inside(shape, p, rng_state=None, flat=0.8):
    """How far out p is in the crown: < 1 inside."""
    kind = shape[0]
    x, y, z = p
    if kind in ("ellipsoid", "dome", "umbrella", "palm"):
        _, zc, r, h = shape
        if kind == "dome" and z < zc - h * 0.55:
            return 9.0
        return math.sqrt((x * x + y * y) / (r * r) + ((z - zc) / h) ** 2)
    if kind == "vase":
        _, z0, z1, rb, rt = shape
        if not z0 <= z <= z1:
            return 9.0
        t = (z - z0) / (z1 - z0)
        r = rb + (rt - rb) * math.sin(min(1.0, t * 1.25) * HALFPI) * (1 - 0.55 * max(0.0, t - 0.8) / 0.2)
        return math.hypot(x, y) / max(r, 0.1)
    if kind == "cone":
        _, z0, z1, rb = shape
        if not z0 <= z <= z1:
            return 9.0
        t = (z - z0) / (z1 - z0)
        r = rb * (1 - t) ** 0.85 * (0.75 + 0.25 * min(1.0, t * 5)) + 0.15
        return math.hypot(x, y) / r
    if kind in ("clumps", "pads"):
        best = 9.0
        for cx, cy, cz, cr in rng_state:
            best = min(best, math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + ((z - cz) / flat) ** 2) / cr)
        return best
    raise ValueError(kind)


HALFPI = math.pi / 2


def crown_points(sp, rng):
    shape = sp["crown"]
    clumps = None
    if shape[0] == "clumps":       # eucalyptus: a few rounded clumps at the ends of the limbs
        _, zc, r, h = shape
        clumps = []
        for k in range(sp["n1"] + 2):
            a = TAU * k / (sp["n1"] + 2) + rng.uniform(-0.4, 0.4)
            d = r * rng.uniform(0.35, 0.8)
            clumps.append((d * math.cos(a), d * math.sin(a), zc + rng.uniform(-0.6, 0.9) * h * 0.6, rng.uniform(1.8, 2.8)))
        clumps.append((0, 0, zc + h * 0.75, 2.4))
    if shape[0] == "pads":         # a pine: flat pads of needles in tiers, wider low down, one crowning the top
        _, zc, r, h = shape
        clumps = []
        for k in range(sp["n1"]):
            t = k / (sp["n1"] - 1)
            a = k * 2.39996 + rng.uniform(-0.3, 0.3)
            d = r * (0.85 - 0.6 * t) * rng.uniform(0.7, 1.05)
            clumps.append((d * math.cos(a), d * math.sin(a), zc - h * 0.5 + h * 1.1 * t, rng.uniform(1.5, 2.3) * (1.15 - 0.4 * t)))
        clumps.append((0, 0, zc + h * 0.75, 1.7))
    lo = np.array([-14, -14, 0.0])
    hi = np.array([14, 14, sp["H"] + 1])
    pts = []
    tries = 0
    while len(pts) < sp["n"] and tries < 200000:
        tries += 1
        p = lo + (hi - lo) * rng.random(3)
        f = inside(shape, p, clumps, sp.get("flat", 0.8))
        # mostly near the surface, some inside so it never looks hollow
        if f < 1.0 and (f > 0.62 or rng.random() < 0.18):
            pts.append(p)
    return np.array(pts), clumps


def kmeans(P, k, rng, iters=12):
    k = max(1, min(k, len(P)))
    C = P[rng.choice(len(P), k, replace=False)]
    for _ in range(iters):
        lab = np.argmin(((P[:, None, :] - C[None]) ** 2).sum(-1), axis=1)
        for j in range(k):
            if (lab == j).any():
                C[j] = P[lab == j].mean(0)
    lab = np.argmin(((P[:, None, :] - C[None]) ** 2).sum(-1), axis=1)
    return C, lab


def bezier(a, c, b, n):
    return [((1 - t) ** 2) * a + 2 * (1 - t) * t * c + t * t * b for t in np.linspace(0, 1, n)]


class Tree:
    """Geometry in the tree's frame (z up), with per-vertex colour (ao, sway, phase) and
    normals kept for the leaf cards."""

    def __init__(self):
        self.m = Mesh()
        self.col = []
        self.nrm = {}

    def vert(self, p, ao, sway, phase=0.0, n=None):
        i = self.m.vert(p)
        self.col.append((ao, sway, phase))
        if n is not None:
            self.nrm[i] = n
        return i


def branch(T, pts, r0, r1, mat, segs, H, ao=(0.85, 0.6), sway0=0.0, sway1=0.3):
    """A tapered tube along pts (numpy points), with sway growing along it."""
    n = len(pts)
    rings = []
    prev = None
    for i, p in enumerate(pts):
        t = i / (n - 1)
        d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
        d = Vector(d).normalized()
        if prev is None:
            u = d.orthogonal().normalized()
        else:
            u = (prev - d * prev.dot(d)).normalized()
        prev = u
        w = d.cross(u)
        r = r0 + (r1 - r0) * t
        ring = []
        a_o = ao[0] + (ao[1] - ao[0]) * t
        for k in range(segs):
            a = TAU * k / segs
            q = Vector(p) + (u * math.cos(a) + w * math.sin(a)) * r
            ring.append(T.vert(q, a_o, sway0 + (sway1 - sway0) * t))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            T.m.face([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]], mat, True)
    T.m.face(rings[-1][::-1], mat, False)


def card(T, at, up, out, size, k_cell, crown_c, crown_r, rng, aspect=0.55, sway=1.0):
    """A leaf card with its bottom middle at `at`, growing along `up`, facing roughly `out`."""
    up = Vector(up).normalized()
    out = Vector(out)
    side = up.cross(out)
    if side.length < 1e-4:
        side = up.orthogonal()
    side.normalize()
    w, h = size * aspect / 2, size
    u0, v0, u1, v1 = cell_uv(k_cell)
    at = Vector(at)
    corners = [at - side * w, at + side * w, at + side * w + up * h, at - side * w + up * h]
    uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    face_n = side.cross(up).normalized()
    phase = rng.random()
    ids = []
    for q in corners:
        radial = (q - Vector(crown_c))
        f = min(1.0, radial.length / crown_r)
        n = (radial.normalized() * 0.8 + face_n * 0.2 * (1 if face_n.dot(radial) >= 0 else -1)).normalized()
        ao = 0.42 + 0.58 * min(1.0, max(0.0, (f - 0.25) / 0.75)) ** 1.2
        ao *= 0.82 + 0.18 * min(1.0, max(0.0, (q.z - crown_c[2] + crown_r) / (2 * crown_r)))
        ids.append(T.vert(q, ao, sway, phase, n))
    T.m.face(ids, "Leaves", False, uv=uvs)


def grow(name, sp, seed, lod):
    """lod 0: the full tree; 1: limbs only and a fifth of the cards, bigger; 2: trunk and hull."""
    rng = np.random.default_rng(seed)
    T = Tree()
    bark = f"Bark_{name}"
    H = sp["H"]
    if sp["crown"][0] == "palm":
        return grow_palm(name, sp, rng, lod)
    if sp["crown"][0] == "weep":
        return grow_weeping(name, sp, rng, lod)
    P, clumps = crown_points(sp, rng)
    shape = sp["crown"]
    if shape[0] in ("vase", "cone"):
        crown_c = np.array([0, 0, (shape[1] + shape[2]) / 2])
        crown_r = max(shape[4] if shape[0] == "vase" else max(shape[3], (shape[2] - shape[1]) * 0.3), 3.0)
    else:
        crown_c = np.array([0, 0, shape[1]])
        crown_r = max(shape[2], 3.0)
    lean = np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), 0]) * sp["lean"]
    # an excurrent tree (a cedar, a ginkgo, a she-oak) carries its trunk up through the crown as a leader
    excurrent = sp.get("excurrent", False)
    top = np.array([0, 0, H * 0.94 if excurrent else sp["trunk"]]) + lean * sp["trunk"]
    # the trunk, with a flare at the foot; a pine's bends one way and then back
    mid = np.array([0, 0, top[2] * 0.5]) + lean * sp["trunk"] * (0.2 if sp["lean"] < 0.2 else 1.1)
    trunk_pts = bezier(np.array([0, 0, 0.0]), mid, top, (9 if excurrent else 6) if lod < 2 else 2)
    segs = 10 if lod == 0 else 6 if lod == 1 else 5
    r0 = sp["r0"]
    branch(T, [trunk_pts[0] - np.array([0, 0, 0.3])] + trunk_pts, r0 * 1.35, r0 * (0.12 if excurrent else 0.72), bark, segs, H, ao=(0.75, 0.55),
           sway1=0.2 if excurrent else 0.05)
    # a clump (pisonia, the beach scrub): more stems from the same foot, leaning out round it, a little shorter
    tops = [top]
    for k in range(1, sp.get("stems", 1)):
        a = TAU * k / sp["stems"] + rng.uniform(-0.4, 0.4)
        out = np.array([math.cos(a), math.sin(a), 0.0])
        h = sp["trunk"] * rng.uniform(0.75, 1.0)
        t_k = out * h * rng.uniform(0.35, 0.6) + np.array([0, 0, h])
        pts_k = bezier(out * r0 * 0.6, out * h * 0.1 + np.array([0, 0, h * 0.5]), t_k, 5 if lod < 2 else 2)
        branch(T, [pts_k[0] - np.array([0, 0, 0.3])] + pts_k, r0 * rng.uniform(0.75, 1.0), r0 * 0.55, bark, max(5, segs - 2), H, ao=(0.75, 0.55), sway1=0.08)
        tops.append(t_k)
    if lod == 2:
        return hull(T, name, sp, P, crown_c, crown_r)
    C1, lab1 = kmeans(P, sp["n1"], rng)
    limbs = []
    for j, c in enumerate(C1):
        near_top = tops[int(np.argmin([np.linalg.norm((c - t)[:2]) for t in tops]))]
        start = near_top + np.array([0, 0, rng.uniform(-0.6, 0.4) * min(1.0, sp["trunk"] / 2)])
        if sp.get("leader") and j == int(np.argmax(C1[:, 2])):
            start = top
        if excurrent:       # from the leader at the limb's own height, a little above it
            zt = min(max(c[2] + 0.4, sp["trunk"]), top[2] - 0.5)
            start = np.array([0, 0, zt]) + lean * sp["trunk"] * (zt / top[2])
        end = start + (c - start) * 0.82
        ctrl = start + np.array([0, 0, (end[2] - start[2]) * 0.6 + 1.0]) + (end - start) * np.array([0.25, 0.25, 0])
        pts = bezier(start, ctrl, end, 7 if lod == 0 else 4)
        rl = r0 * (0.28 if excurrent else 0.55) * (0.7 + 0.3 * rng.random())
        branch(T, pts, rl, rl * 0.35, bark, 6 if lod == 0 else 5, H, ao=(0.6, 0.7), sway0=0.05, sway1=0.45)
        limbs.append(pts)
        mine = P[lab1 == j]
        if not len(mine):
            continue
        if lod == 0:
            C2, lab2 = kmeans(mine, sp["n2"], rng)
            for i2, c2 in enumerate(C2):
                k0 = int(rng.integers(len(pts) // 2, len(pts)))
                s = pts[k0]
                e = s + (c2 - s) * 0.9
                twig = bezier(s, (s + e) / 2 + np.array([0, 0, 0.6]), e, 4)
                # twigs are thin and mostly inside the crown: a three-sided tube reads the same
                branch(T, twig, rl * 0.32, 0.03, bark, 3, H, ao=(0.65, 0.8), sway0=0.4, sway1=0.85)
                for p in mine[lab2 == i2]:
                    leaf_at(T, sp, p, e, crown_c, crown_r, rng, sp["size"])
        else:
            # the cards of each limb, merged five to one and grown to match
            k = max(1, len(mine) // 5)
            C3, _ = kmeans(mine, k, rng, iters=6)
            for p in C3:
                leaf_at(T, sp, p, end, crown_c, crown_r, rng, sp["size"] * 2.0)
    return T


def leaf_at(T, sp, p, base, crown_c, crown_r, rng, size):
    out = p - crown_c
    out = out / (np.linalg.norm(out) + 1e-6)
    up = (p - base)
    up = up / (np.linalg.norm(up) + 1e-6) * 0.6 + out * 0.4 + np.array([0, 0, 0.15])
    jitter = rng.normal(0, 0.35, 3)
    k_cell = CELLS[sp["leaf"]]
    if sp["leaf"] == "jacaranda" and rng.random() < sp.get("bloom", 0):   # (a cherry's are all its bloom cell, "sakura")
        k_cell = CELLS["bloom"]
    at = p - up / np.linalg.norm(up) * size * 0.45
    card(T, at, up + jitter * 0.3, out + jitter, size * rng.uniform(0.85, 1.15), k_cell, crown_c, crown_r, rng)


def hull(T, name, sp, P, crown_c, crown_r):
    """The far crown: an icosphere pulled out to the leaf points, with the leaf colour."""
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    rng = np.random.default_rng(len(P))
    for v in bm.verts:
        d = np.array(v.co)
        proj = (P - crown_c) @ d
        far = np.percentile(proj, 92) if len(P) else crown_r
        perp = np.linalg.norm((P - crown_c) - proj[:, None] * d[None], axis=1)
        near = proj[perp < crown_r * 0.45]
        r = np.percentile(near, 90) if len(near) > 3 else far
        v.co = Vector(crown_c + d * max(r, 0.6) * (1.12 + rng.uniform(-0.1, 0.1)))
    bm.verts.index_update()
    ids = []
    for v in bm.verts:
        q = v.co
        n = (q - Vector(crown_c)).normalized()
        ao = (0.55 + 0.45 * max(0.0, min(1.0, (q.z - crown_c[2] + crown_r) / (2 * crown_r)))) * rng.uniform(0.85, 1.0)
        ids.append(T.vert(q, ao, 0.35, 0.0, n))
    for f in bm.faces:
        T.m.face([ids[v.index] for v in f.verts], f"Crown_{name}", False)
    bm.free()
    return T


def grow_weeping(name, sp, rng, lod):
    """A weeping cherry: a stout trunk forking into scaffold limbs that arch up into a dome, and from them
    curtains of thin branches that rise a little, turn over and hang nearly to the ground, flowering along
    their length (Weber and Penn's 'curve down', as Blender's Sapling and ez-tree grow a weeping crown).
    The hanging cards grow down their branch, so the atlas's twigs fall from the top of each card."""
    T = Tree()
    bark = f"Bark_{name}"
    H = sp["H"]
    _, zc, R, hh = sp["crown"]
    lean = np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), 0]) * sp["lean"]
    top = np.array([0, 0, sp["trunk"]]) + lean * sp["trunk"]
    trunk_pts = bezier(np.array([0, 0, 0.0]), np.array([0, 0, top[2] * 0.5]) + lean * sp["trunk"] * 0.3, top, 6 if lod < 2 else 2)
    segs = 10 if lod == 0 else 6 if lod == 1 else 5
    r0 = sp["r0"]
    branch(T, [trunk_pts[0] - np.array([0, 0, 0.3])] + trunk_pts, r0 * 1.4, r0 * 0.8, bark, segs, H, ao=(0.75, 0.55), sway1=0.05)
    crown_c = np.array([0, 0, (H + 1.8) / 2])
    crown_r = max(R, (H - 1.8) / 2)
    P, hanging = [], []
    for j in range(sp["n1"]):
        a = TAU * j / sp["n1"] + rng.uniform(-0.3, 0.3)
        out = np.array([math.cos(a), math.sin(a), 0.0])
        d = R * rng.uniform(0.42, 0.62)
        end = np.array([0, 0, H * rng.uniform(0.82, 0.97)]) + out * d
        start = top + np.array([0, 0, rng.uniform(-0.4, 0.3)])
        ctrl = start + out * d * 0.35 + np.array([0, 0, (end[2] - start[2]) * 0.85])
        limb = bezier(start, ctrl, end, 7 if lod == 0 else 4)
        rl = r0 * 0.5 * (0.75 + 0.25 * rng.random())
        branch(T, limb, rl, rl * 0.3, bark, 6 if lod == 0 else 5, H, ao=(0.6, 0.75), sway0=0.05, sway1=0.4)
        if lod == 2:
            # the far crown's hull: a dome over curtains reaching down to two metres
            for k in range(14):
                b = a + rng.uniform(-0.5, 0.5)
                rr = R * rng.uniform(0.5, 1.0)
                P.append(np.array([math.cos(b) * rr, math.sin(b) * rr, rng.uniform(1.8, H * 0.95 - 1.2 * rr / R)]))
            continue
        # the hanging branches: from the outer part of the limb and its tip, outward and round it
        n2 = sp["n2"] if lod == 0 else max(3, sp["n2"] // 2)
        for i2 in range(n2):
            t0 = rng.uniform(0.45, 1.0)
            k0 = min(len(limb) - 1, int(t0 * (len(limb) - 1)))
            s = limb[k0]
            b = a + rng.uniform(-1.1, 1.1)
            o = np.array([math.cos(b), math.sin(b), 0.0])
            reach = rng.uniform(1.2, 3.0) * (R - np.hypot(s[0], s[1]) * 0.5) / R * 1.7
            z_end = rng.uniform(1.0, 3.2)
            c1 = s + o * reach * 0.65 + np.array([0, 0, rng.uniform(0.5, 1.1)])
            c2 = s + o * reach + np.array([0, 0, 0.2])
            e = s + o * reach * 1.08 + np.array([0, 0, z_end - s[2]])
            n = 7
            pts = [((1 - t) ** 3) * s + 3 * (1 - t) ** 2 * t * c1 + 3 * (1 - t) * t * t * c2 + t ** 3 * e for t in np.linspace(0, 1, n)]
            if lod == 0:   # (a thin three-sided tube through every other point: it reads the same)
                branch(T, pts[::2] if len(pts) % 2 else pts, rl * 0.22, 0.012, bark, 3, H, ao=(0.65, 0.85), sway0=0.35, sway1=1.0)
            hanging.append((pts, o))
        # a few short sprays hanging over the top of the limb, so the dome is never bare from above
        for k in range(5 if lod == 0 else 2):
            p = limb[-1 - k % 3] + rng.normal(0, 0.6, 3) + np.array([0, 0, 0.4])
            b = rng.uniform(0, TAU)
            card(T, p, np.array([math.cos(b) * 0.5, math.sin(b) * 0.5, -1.0]), out + rng.normal(0, 0.4, 3), sp["size"] * (0.9 if lod == 0 else 1.7),
                 CELLS[sp["leaf"]], crown_c, crown_r, rng, aspect=0.6)
            P.append(p)
    if lod == 2:
        return hull(T, name, sp, np.array(P), crown_c, crown_r)
    # cards hang along each branch from where it turns over, each growing down it, overlapping
    step = sp["size"] * (0.55 if lod == 0 else 1.4)
    size = sp["size"] * (1.0 if lod == 0 else 1.9)
    for pts, o in hanging:
        L = [0.0] + list(np.cumsum([np.linalg.norm(pts[i + 1] - pts[i]) for i in range(len(pts) - 1)]))
        at = L[-1] * 0.22
        while at < L[-1] - size * 0.35:
            i = max(0, min(len(pts) - 2, int(np.searchsorted(L, at)) - 1))
            f = (at - L[i]) / max(L[i + 1] - L[i], 1e-6)
            p = pts[i] + (pts[i + 1] - pts[i]) * f
            down = pts[i + 1] - pts[i]
            down = down / (np.linalg.norm(down) + 1e-6)
            jit = rng.normal(0, 0.25, 3)
            b = rng.uniform(-1.3, 1.3)   # each card turned its own way round the branch: a curtain, not a strip
            facing = np.array([o[0] * math.cos(b) - o[1] * math.sin(b), o[0] * math.sin(b) + o[1] * math.cos(b), 0.0]) + jit
            card(T, p + jit * 0.2, down * 0.85 + np.array([0, 0, -0.3]) + o * 0.1, facing, size * rng.uniform(0.85, 1.1), CELLS[sp["leaf"]],
                 crown_c, crown_r, rng, aspect=0.62)
            at += step * rng.uniform(0.8, 1.2)
    return T


def grow_palm(name, sp, rng, lod):
    T = Tree()
    bark = f"Bark_{name}"
    h = sp["trunk"]
    lean = np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), 0]) * sp["lean"] * h
    pts = bezier(np.array([0, 0, -0.3]), np.array([0, 0, h * 0.5]), np.array([0, 0, h]) + lean, 10 if lod == 0 else 4)
    segs = 12 if lod == 0 else 6
    # the trunk: thick, with rings of old leaf bases (alternate rings a touch fatter)
    n = len(pts)
    rings = []
    for i, p in enumerate(pts):
        t = i / (n - 1)
        r = sp["r0"] * (1.25 - 0.3 * t) * (1.06 if (lod == 0 and i % 2) else 1.0)
        ring = []
        for k in range(segs):
            a = TAU * k / segs
            ring.append(T.vert(Vector(p) + Vector((math.cos(a) * r, math.sin(a) * r, 0)), 0.72 - 0.2 * t, 0.15 * t * t))
        rings.append(ring)
    for i in range(n - 1):
        for k in range(segs):
            k2 = (k + 1) % segs
            T.m.face([rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]], bark, True)
    head = Vector(pts[-1])
    crown_c, crown_r = np.array(head) + np.array([0, 0, 0.6]), sp["crown"][2]
    if lod == 0:
        # a knob of leaf bases where the fronds spring from
        for k in range(10):
            a = TAU * k / 10
            q = head + Vector((math.cos(a) * 0.5, math.sin(a) * 0.5, 0.3))
            box_ids = [T.vert(q + Vector(o), 0.5, 0.2) for o in ((0, 0, -0.4), (0.3, 0, 0.4), (0, 0.3, 0.4))]
            T.m.face(box_ids, bark, False)
    if lod == 2:
        P = np.array([np.array(head) + np.array([math.cos(a) * r, math.sin(a) * r, 0.4 - 0.25 * r])
                      for a in np.linspace(0, TAU, 16, endpoint=False) for r in (2.0, 3.8)] + [np.array(head) + np.array([0, 0, 1.4])])
        return hull(T, name, sp, P, crown_c, crown_r)
    # fronds: arching cards in two whorls, the lower ones drooping
    count = sp["n"] if lod == 0 else 9
    for k in range(count):
        a = TAU * k / count + rng.uniform(-0.12, 0.12) + (0.5 if k % 2 else 0)
        lift = rng.uniform(0.25, 0.9) if k % 2 else rng.uniform(-0.35, 0.3)
        d = Vector((math.cos(a), math.sin(a), lift)).normalized()
        L = sp["size"] * rng.uniform(0.85, 1.1) * (1.0 if lod == 0 else 1.15)
        # two cards per frond, bent down at the middle
        mid = head + d * (L * 0.5) + Vector((0, 0, 0.2))
        d2 = Vector((d.x, d.y, d.z - 0.8)).normalized()
        out = Vector((-math.sin(a), math.cos(a), 0)).cross(d)
        for at, dd, LL in ((head, d, L * 0.52), (mid, d2, L * 0.55)):
            card(T, at, dd, out, LL, CELLS["palm"], crown_c, crown_r * 1.4, rng, aspect=0.85, sway=0.9)
    return T


# ------------------------------------------------------------ to Blender
def tree_materials(atlas_path):
    MAT.clear()
    for name, sp in SPECIES.items():
        material(f"Bark_{name}", sp["bark"], 0.9)
        material(f"Crown_{name}", sp["colour"], 0.85)
    m = material("Leaves", "#ffffff", 0.75, cull=False)
    nt = m.node_tree
    img = bpy.data.images.load(atlas_path)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    b = nt.nodes["Principled BSDF"]
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    # alpha through a threshold: the glTF exporter writes this as a MASK (cut-out) material
    cmp = nt.nodes.new("ShaderNodeMath")
    cmp.operation = "GREATER_THAN"
    cmp.inputs[1].default_value = 0.5
    nt.links.new(tex.outputs["Alpha"], cmp.inputs[0])
    nt.links.new(cmp.outputs[0], b.inputs["Alpha"])
    return m


def to_object(T, name):
    ob = T.m.build(name)
    me = ob.data
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    data = np.ones((len(T.col), 4), np.float32)
    data[:, :3] = np.asarray(T.col, np.float32)
    attr.data.foreach_set("color", data.ravel())
    me.color_attributes.active_color = attr
    if T.nrm:
        # leaf cards light as part of the crown: their own normals; the rest keep smooth ones
        me.update()
        vn = [Vector(v.normal) for v in me.vertices]
        for i, n in T.nrm.items():
            vn[i] = Vector((n[1], -n[0], n[2]))   # the same turn as Mesh.build's to_blender
        me.normals_split_custom_set_from_vertices(vn)
    return ob


def triangles(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


def build_all(atlas):
    tree_materials(atlas)
    objs, info = {}, {}
    for k, (name, sp) in enumerate(SPECIES.items()):
        tri = []
        for lod in range(3):
            T = grow(name, sp, 100 + k, lod)
            ob = to_object(T, f"{name}_LOD{lod}")
            objs[ob.name] = ob
            tri.append(triangles(ob))
        info[name] = {"height_m": sp["H"], "crown": list(sp["crown"][1:]), "colour": sp["colour"], "bark": sp["bark"], "triangles": tri,
                      "cell": CELLS[sp["leaf"]], "trunk_r": sp["r0"], "note": sp["note"]}
        for k_ in ("bloom_colour", "autumn_colour", "deciduous", "bloom_offset_d", "bloom_len", "bark_bands"):
            if k_ in sp:
                info[name][k_] = sp[k_]
    return objs, info


def preview(objs, folder, samples=24):
    """A contact sheet: each species' full tree on its own, framed by its height, and its three levels of
    detail side by side, so a new species can be judged next to the others."""
    os.makedirs(folder, exist_ok=True)
    names = list(SPECIES)
    setup_render(samples, (420, 560), sun=(38, 140), strength=0.6)
    ground_plane("Ground", 400, material("Grass", "#4d5a33", 0.95))
    sun_lamp(38, 140, energy=2.2)
    tiles = []
    for name in names:
        H = SPECIES[name]["H"]
        for ob in objs.values():
            sp, lod = ob.name.rsplit("_LOD", 1)
            ob.hide_render = sp != name
            ob.location = ((int(lod) - 1) * H * 1.15, 0, 0)
        # camera() takes the vehicle frame: x = -Blender y, y = Blender x
        camera("Cam", (H * 3.9, 0, H * 0.42), (0, 0, H * 0.5), 30)
        bpy.context.scene.render.resolution_x = 1100
        path = os.path.join(folder, f"{name}.jpg")
        render(path)
        tiles.append((name, path))
    W, Hh = 1100, 560
    cols = 3
    sheet = Image.new("RGB", (W * cols // 2, Hh * ((len(tiles) + cols - 1) // cols) // 2), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    for k, (name, path) in enumerate(tiles):
        im = Image.open(path).resize((W // 2, Hh // 2))
        x, y = (k % cols) * W // 2, (k // cols) * Hh // 2
        sheet.paste(im, (x, y))
        dr.text((x + 8, y + 6), name, fill=(255, 255, 255))
    sheet.save(os.path.join(folder, "sheet.jpg"), quality=88)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preview", help="render previews into this folder instead of exporting")
    ap.add_argument("--render", action="store_true", help="also render docs/images/trees/trees.jpg")
    ap.add_argument("--samples", type=int, default=96)
    a = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    atlas = build_atlas(os.path.join(OUT, "leaves.png") if not a.preview else os.path.join(a.preview, "leaves.png"))
    objs, info = build_all(atlas)
    if a.preview:
        preview(objs, a.preview, min(a.samples, 24))
        return
    for ob in objs.values():
        ob.location = (0, 0, 0)
    path = os.path.join(OUT, "trees.glb")
    select(list(objs.values()))
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_vertex_color="ACTIVE", export_normals=True,
                              export_materials="EXPORT", export_image_format="AUTO", export_cameras=False, export_lights=False,
                              export_animations=False)
    webp(path)  # the leaf atlas as a WebP (a fifth of the PNG), then meshopt
    compress(path)
    print(f"  {os.path.relpath(path, ROOT)}: {os.path.getsize(path) / 1e6:.2f} MB")
    manifest = {
        "note": "The trees every city shares, built by blender/build_trees.py. Nodes are <species>_LOD0..2; colour red is ambient "
                "occlusion, green how far the wind moves a vertex, blue a phase for the leaves' flutter. A city picks its mix of "
                "species in city.json 'trees'.",
        "file": "trees.glb", "lod_m": [130, 520], "atlas": {"cells": CELLS, "columns": COLS, "rows": ROWS,
                                                     "sakura_cells": [CELLS[k] for k in SAKURA_CELLS]},
        "mix": {"plane": 0.3, "gum": 0.25, "elm": 0.15, "fig": 0.1, "jacaranda": 0.1, "palm": 0.1},
        "species": info,
    }
    with open(os.path.join(OUT, "trees.json"), "w") as f:
        json.dump(manifest, f, indent=1)
        f.write("\n")
    print(os.path.join(OUT, "trees.json"))
    if a.render:
        # the full trees in three staggered rows of five, a little apart
        names = list(SPECIES)
        for ob in objs.values():
            name, lod = ob.name.rsplit("_LOD", 1)
            ob.hide_render = lod != "0"
            k = names.index(name)
            ob.location = ((k % 5) * 19.0 - 38.0 + (k // 5) * 6.0, (k // 5) * 26.0, 0)
        os.makedirs(DOCS, exist_ok=True)
        setup_render(a.samples, (1600, 900), sun=(34, 150), strength=0.6)
        ground_plane("Ground", 400, material("Grass", "#4d5a33", 0.95))
        sun_lamp(34, 150, energy=2.2)
        camera("Cam", (96, 6, 40), (-24, 6, 5), 28)
        render(os.path.join(DOCS, "trees.jpg"))
    os.remove(atlas)        # it travels inside the GLB


if __name__ == "__main__":
    main()
