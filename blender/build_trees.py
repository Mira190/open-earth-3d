"""Build the street and park trees every city shares: web/assets/trees/trees.glb and
trees.json.

Six species: London plane, elm, eucalyptus (gum), Moreton Bay fig, jacaranda and Canary
Island date palm. Each is grown, not sculpted: points are scattered through the shell of
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

OUT = os.path.join(ROOT, "web", "assets", "trees")
DOCS = os.path.join(ROOT, "docs", "images", "trees")

# ------------------------------------------------------------ the leaf atlas
# 4 x 2 cells, each a spray of leaves growing up from the middle of its bottom edge
ATLAS, CW, CH = 1024, 256, 512
CELLS = {"gum": 0, "plane": 1, "elm": 2, "fig": 3, "jacaranda": 4, "bloom": 5, "palm": 6}


def cell_uv(k):
    """The cell's rectangle in UV space (v up), inset half a texel."""
    c, r = k % 4, k // 4
    e = 0.5 / ATLAS
    return (c * CW / ATLAS + e, 1 - (r + 1) * CH / ATLAS + e, (c + 1) * CW / ATLAS - e, 1 - r * CH / ATLAS - e)


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
                if spec["leaf"] == "flower":
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
    "palm": dict(leaf="lance", L=84, W=8, twigs=1, spread=0.04, every=1, start=2, angle=(0.9, 1.25), arch=0, droop=0.25,
                 colours=["#5e7a3a", "#6b8a42", "#55703a", "#738f48"], twig="#7a7a4a", twig_w=5),
}


def build_atlas(path):
    rng = np.random.default_rng(7)
    S = 2
    img = Image.new("RGBA", (ATLAS, ATLAS), (0, 0, 0, 0))
    for name, k in CELLS.items():
        cell = Image.new("RGBA", (CW * S, CH * S), (0, 0, 0, 0))
        spray(cell, k, SPRAYS[name], rng, S)
        # fade the last few texels at the cell's edge, so a card never shows a straight cut
        a = np.asarray(cell, np.float32)
        ex = np.minimum(np.arange(CW * S), np.arange(CW * S)[::-1]) / (6 * S)
        ey = np.minimum(np.arange(CH * S), np.arange(CH * S)[::-1]) / (6 * S)
        a[..., 3] *= np.clip(np.minimum(ex[None, :], ey[:, None]), 0, 1)
        cell = Image.fromarray(a.astype(np.uint8), "RGBA").resize((CW, CH), Image.LANCZOS)
        img.paste(cell, ((k % 4) * CW, (k // 4) * CH))
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
    "plane": dict(H=17.0, trunk=4.2, r0=0.36, crown=("ellipsoid", 10.6, 6.6, 6.4), n=330, size=2.9, n1=7, n2=4, leaf="plane",
                  bark="#9a957c", lean=0.04, leader=True, colour="#557f37", note="London plane: the street tree of both cities"),
    "elm": dict(H=16.0, trunk=3.0, r0=0.34, crown=("vase", 3.2, 16.0, 1.2, 7.4), n=320, size=2.7, n1=5, n2=5, leaf="elm",
                bark="#5a4c40", lean=0.02, leader=False, colour="#4f7a32", note="English elm: Melbourne's avenues"),
    "gum": dict(H=18.0, trunk=6.5, r0=0.40, crown=("clumps", 12.5, 5.6, 5.0), n=200, size=2.8, n1=5, n2=3, leaf="gum",
                bark="#ddd5c6", lean=0.10, leader=True, colour="#73906d", note="Eucalyptus: pale bark, open crown in clumps"),
    "fig": dict(H=15.0, trunk=2.6, r0=0.85, crown=("dome", 8.6, 10.5, 6.4), n=440, size=3.1, n1=8, n2=4, leaf="fig",
                bark="#6e665c", lean=0.0, leader=False, colour="#335f2c", note="Moreton Bay fig: a broad dark dome on buttresses"),
    "jacaranda": dict(H=11.0, trunk=2.6, r0=0.26, crown=("umbrella", 7.2, 6.2, 3.8), n=280, size=2.5, n1=5, n2=4, leaf="jacaranda",
                      bloom=0.6, bark="#5c4e42", lean=0.06, leader=False, colour="#5f8a3d", bloom_colour="#9177c9",
                      note="Jacaranda: purple in late spring (cards swap to the bloom cell with the season)"),
    "palm": dict(H=11.0, trunk=8.2, r0=0.42, crown=("palm", 9.0, 4.2, 2.6), n=26, size=5.6, leaf="palm",
                 bark="#86745c", lean=0.03, colour="#62803e", note="Canary Island date palm"),
}


def inside(shape, p, rng_state=None):
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
    if kind == "clumps":
        best = 9.0
        for cx, cy, cz, cr in rng_state:
            best = min(best, math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + ((z - cz) / 0.8) ** 2) / cr)
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
    lo = np.array([-14, -14, 0.0])
    hi = np.array([14, 14, sp["H"] + 1])
    pts = []
    tries = 0
    while len(pts) < sp["n"] and tries < 200000:
        tries += 1
        p = lo + (hi - lo) * rng.random(3)
        f = inside(shape, p, clumps)
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
    P, clumps = crown_points(sp, rng)
    shape = sp["crown"]
    crown_c = np.array([0, 0, shape[1] if shape[0] != "vase" else (shape[1] + shape[2]) / 2])
    crown_r = max(shape[2] if shape[0] != "vase" else shape[4], 3.0)
    lean = np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), 0]) * sp["lean"]
    top = np.array([0, 0, sp["trunk"]]) + lean * sp["trunk"]
    # the trunk, with a flare at the foot
    trunk_pts = bezier(np.array([0, 0, 0.0]), np.array([0, 0, sp["trunk"] * 0.5]) + lean * sp["trunk"] * 0.2, top, 6 if lod < 2 else 2)
    segs = 10 if lod == 0 else 6 if lod == 1 else 5
    r0 = sp["r0"]
    branch(T, [trunk_pts[0] - np.array([0, 0, 0.3])] + trunk_pts, r0 * 1.35, r0 * 0.72, bark, segs, H, ao=(0.75, 0.55), sway1=0.05)
    if lod == 2:
        return hull(T, name, sp, P, crown_c, crown_r)
    C1, lab1 = kmeans(P, sp["n1"], rng)
    limbs = []
    for j, c in enumerate(C1):
        start = top + np.array([0, 0, rng.uniform(-0.6, 0.4)])
        if sp["leader"] and j == int(np.argmax(C1[:, 2])):
            start = top
        end = start + (c - start) * 0.82
        ctrl = start + np.array([0, 0, (end[2] - start[2]) * 0.6 + 1.0]) + (end - start) * np.array([0.25, 0.25, 0])
        pts = bezier(start, ctrl, end, 7 if lod == 0 else 4)
        rl = r0 * 0.55 * (0.7 + 0.3 * rng.random())
        branch(T, pts, rl, rl * 0.35, bark, 7 if lod == 0 else 5, H, ao=(0.6, 0.7), sway0=0.05, sway1=0.45)
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
                branch(T, twig, rl * 0.32, 0.03, bark, 5, H, ao=(0.65, 0.8), sway0=0.4, sway1=0.85)
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
    if sp["leaf"] == "jacaranda" and rng.random() < sp.get("bloom", 0):
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
                      "note": sp["note"]}
        if "bloom_colour" in sp:
            info[name]["bloom_colour"] = sp["bloom_colour"]
    return objs, info


def preview(objs, folder):
    os.makedirs(folder, exist_ok=True)
    names = list(SPECIES)
    for ob in objs.values():
        name, lod = ob.name.rsplit("_LOD", 1)
        ob.location = (names.index(name) * 22.0 - 55, int(lod) * 26.0, 0)
    setup_render(24, (1280, 640), sun=(38, 140), strength=0.6)
    ground_plane("Ground", 400, material("Grass", "#4d5a33", 0.95))
    sun_lamp(38, 140, energy=2.2)
    # camera() takes the vehicle frame: x = -Blender y, y = Blender x
    for shot, loc, tgt, lens in (("row", (80, 0, 10), (0, 0, 8), 24), ("near", (24, -4, 2.5), (0, 2, 9), 22),
                                 ("lods", (40, -80, 28), (-26, -40, 6), 30), ("above", (60, 10, 70), (-10, 0, 0), 24)):
        camera("Cam", loc, tgt, lens)
        render(os.path.join(folder, f"trees_{shot}.jpg"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preview", help="render previews into this folder instead of exporting")
    a = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    atlas = build_atlas(os.path.join(OUT, "leaves.png") if not a.preview else os.path.join(a.preview, "leaves.png"))
    objs, info = build_all(atlas)
    if a.preview:
        preview(objs, a.preview)
        return
    for ob in objs.values():
        ob.location = (0, 0, 0)
    path = os.path.join(OUT, "trees.glb")
    select(list(objs.values()))
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_vertex_color="ACTIVE", export_normals=True,
                              export_materials="EXPORT", export_image_format="AUTO", export_cameras=False, export_lights=False,
                              export_animations=False)
    os.remove(atlas)        # it travels inside the GLB
    print(f"  {os.path.relpath(path, ROOT)}: {os.path.getsize(path) / 1e6:.2f} MB")
    manifest = {
        "note": "The trees every city shares, built by blender/build_trees.py. Nodes are <species>_LOD0..2; colour red is ambient "
                "occlusion, green how far the wind moves a vertex, blue a phase for the leaves' flutter. A city picks its mix of "
                "species in city.json 'trees'.",
        "file": "trees.glb", "lod_m": [130, 520], "atlas": {"cells": CELLS, "columns": 4, "rows": 2},
        "mix": {"plane": 0.3, "gum": 0.25, "elm": 0.15, "fig": 0.1, "jacaranda": 0.1, "palm": 0.1},
        "species": info,
    }
    with open(os.path.join(OUT, "trees.json"), "w") as f:
        json.dump(manifest, f, indent=1)
        f.write("\n")
    print(os.path.join(OUT, "trees.json"))


if __name__ == "__main__":
    main()
