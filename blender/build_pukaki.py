"""Build Lake Pukaki's landmarks: web/data/lake-pukaki/models/pukaki-*.glb (meshopt-compressed).

    pip install bpy==5.2.3 pillow shapely scipy
    python pipeline/pukaki_landmarks.py        # measure first (cities/lake-pukaki/analysis/landmarks.json)
    python blender/build_pukaki.py              # build the models
    python blender/build_pukaki.py --render     # and render stills into docs/images/lake-pukaki

- The Hermitage Hotel, Aoraki / Mount Cook Village: its massing from LINZ's LiDAR, square metre by square metre (the
  DSM over the DEM inside the OpenStreetMap footprints of the hotel and its attached wings), cut into blocks of whole
  storeys (3.2 m) on their own ground, so the seven-storey Aoraki Wing, the lower wings and the terraces stand where
  and as high as the survey found them; the walls in bays of windows (3 m), flat roofs with their parapets.
- The Lake Pukaki Visitor Centre (Ngāi Tahu's, on SH8 by the dam): its OpenStreetMap footprint (10.3 x 7.6 m), its height
  from the LiDAR (5.2 m to the top, 3.9 m median): a mono-pitch roof rising to the lake, glazed on the lake side.
- The Mt Cook Alpine Salmon shop beside it: footprint 14.7 x 6.7 m, 5.8 m to the ridge (LiDAR); a gable roof of
  corrugated iron over weatherboards.
- The tahr statue (Game and Forest Foundation, 2014): a life-size bronze Himalayan tahr bull (0.95 m at the shoulder)
  standing on a boulder, 2.8 m to the top (the LiDAR's object on the knoll west of the visitor centre), looking north up
  the lake to Aoraki.
- The Hooker Valley's three swing bridges (Lower Hooker, Hooker Bluff, Upper Hooker): each span along its OpenStreetMap
  way, its deck along the DSM, a 1.2 m deck hung from two main cables at handrail height on portal frames at each end,
  wire mesh sides, and the cables anchored into the banks.

The forms of the visitor centre and the shop (the roofs, the glazing, the cladding) are judgements; their footprints and
heights are measured. Each model is in the frame of its anchor in cities/lake-pukaki/city.json `landmarks`: x east,
y north, z up in Blender (glTF x east, y up, -z north), z = 0 at the landmark's `ground_m`.
"""
import argparse
import json
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector
from PIL import Image
from scipy import ndimage
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_tekapo as bt  # noqa: E402
from build_tekapo import MAT, Mesh, T, capsule, cube, ell, export, mat, metaball_mesh, tileable_noise, normal_from_height  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "data", "lake-pukaki", "models")
DOCS = os.path.join(ROOT, "docs", "images", "lake-pukaki")
CITY = os.path.join(ROOT, "cities", "lake-pukaki")
bt.TEX = os.path.join(ROOT, "data", "raw", "lake-pukaki", "tex")
STOREY, BAY = 3.2, 3.0


# ------------------------------------------------------------ textures
def facade_texture(n=512, seed=3):
    """One bay by one storey of the Hermitage's walls (3 x 3.2 m): dark grey cladding, a window of grey-blue glass in a
    pale frame with a spandrel below; tiles both ways. Returns (albedo, normal)."""
    r = np.random.default_rng(seed)
    a = np.zeros((n, n, 3))
    a[:] = np.array([0.20, 0.18, 0.16])
    a *= (0.92 + 0.16 * tileable_noise(n, 5, seed))[..., None]
    h = np.zeros((n, n))
    y0, y1, x0, x1 = int(n * 0.16), int(n * 0.78), int(n * 0.12), int(n * 0.88)   # from the top: the window's frame
    fr = 6
    a[y0:y1, x0:x1] = [0.80, 0.80, 0.78]
    sky = np.linspace(0.55, 0.30, y1 - y0 - 2 * fr)[:, None, None] * np.array([0.62, 0.72, 0.82])[None, None, :]
    a[y0 + fr:y1 - fr, x0 + fr:x1 - fr] = sky
    xm = (x0 + x1) // 2
    a[y0:y1, xm - 3:xm + 3] = [0.80, 0.80, 0.78]                                   # a mullion
    a[y0 + fr:y1 - fr, x0 + fr:x1 - fr] *= (0.9 + 0.2 * r.random())
    h[y0:y1, x0:x1] = -0.6
    h[y0 + fr:y1 - fr, x0 + fr:x1 - fr] = -1.0
    a[y1:y1 + 10, x0 - 6:x1 + 6] = [0.62, 0.62, 0.6]                                # the sill
    h[y1:y1 + 10, x0 - 6:x1 + 6] = 0.4
    return bt.save((np.clip(a, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8), "facade.jpg"), bt.save(normal_from_height(h, 2.0), "facade_n.png")


def boards_texture(n=512, seed=5, base=(0.42, 0.29, 0.19), boards=10):
    """Vertical cedar boards weathered silver-brown at the edges (1 tile = 1.5 m)."""
    r = np.random.default_rng(seed)
    x = np.arange(n) * boards / n
    k = np.floor(x).astype(int)
    shade = 0.85 + 0.3 * r.random(boards)[k]
    grain = tileable_noise(n, 6, seed, base=2)
    a = np.array(base)[None, None, :] * shade[None, :, None] * (0.85 + 0.3 * grain)[..., None]
    gap = (x - k) < 0.04
    a[:, gap] *= 0.35
    h = np.where(gap[None, :], -1.0, 0.0) + 0.1 * grain
    return bt.save((np.clip(a, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8), f"boards{seed}.jpg"), bt.save(normal_from_height(np.broadcast_to(h, (n, n)).copy(), 2.0), f"boards{seed}_n.png")


def corrugate_texture(n=256, seed=9, base=(0.20, 0.22, 0.23)):
    """Corrugated iron, 76 mm pitch (1 tile = 1 m: 13 corrugations)."""
    x = np.arange(n) / n * 13 * 2 * math.pi
    h = np.broadcast_to(np.sin(x)[None, :], (n, n)).copy()
    a = np.array(base)[None, None, :] * (0.9 + 0.1 * np.sin(x))[None, :, None] * (0.9 + 0.2 * tileable_noise(n, 4, seed))[..., None]
    return bt.save((np.clip(a, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8), f"corr{seed}.jpg"), bt.save(normal_from_height(h, 3.0), f"corr{seed}_n.png")


def materials():
    fa, fn = facade_texture()
    ca, cn = boards_texture(seed=5)
    wa, wn = boards_texture(seed=6, base=(0.78, 0.78, 0.74), boards=6)
    ra, rn = corrugate_texture(seed=9)
    dk = bt.deck_texture()
    mat("Facade", "#ffffff", 0.55, tex=fa, normal=fn)
    mat("Parapet", "#d9d8d2", 0.8)
    mat("RoofFlat", "#5d6063", 0.85)
    mat("Cedar", "#ffffff", 0.8, tex=ca, normal=cn)
    mat("Weatherboard", "#ffffff", 0.75, tex=wa, normal=wn)
    mat("Corrugate", "#ffffff", 0.45, metal=0.3, tex=ra, normal=rn)
    mat("Glass", "#9fb3bf", 0.06, alpha=0.45, cull=False)
    mat("Interior", "#3a332c", 0.9)
    mat("Frame", "#2b2d2f", 0.5, metal=0.4)
    mat("Concrete", "#b5b0a6", 0.85)
    mat("Bronze", "#5a4630", 0.42, metal=0.35)   # (a metal with no environment map to reflect renders near black in the viewer)
    ba = (np.clip((0.36 + 0.12 * tileable_noise(512, 6, 21) - 0.05 * tileable_noise(512, 3, 22, base=8))[..., None] * np.array([1.0, 0.97, 0.92]), 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)
    mat("Boulder", "#ffffff", 0.9, tex=bt.save(ba, "boulder.jpg"), normal=bt.save(normal_from_height(tileable_noise(512, 6, 23), 6.0), "boulder_n.png"))
    mat("Decking", "#ffffff", 0.75, tex=dk)
    mat("Steel", "#a9adb0", 0.35, metal=0.9)
    mat("Cable", "#8d9295", 0.3, metal=1.0)
    mat("Mesh", "#7d8386", 0.4, metal=0.8, alpha=0.16, cull=False)


# ------------------------------------------------------------ helpers
def walls(m, poly, z0, z1, material, top_z=None, bay=BAY, storey=STOREY):
    """Walls round a shapely polygon (and its holes) from z0 to z1, UVs in bays along the wall and storeys down from
    top_z (so the window rows meet the roof line)."""
    top_z = z1 if top_z is None else top_z
    rings = [list(poly.exterior.coords)[:-1]] + [list(h.coords)[:-1] for h in poly.interiors]
    for k, ring in enumerate(rings):
        P = Polygon(ring)
        if (P.exterior.is_ccw) != (k == 0):
            ring = ring[::-1]
        s = 0.0
        for i in range(len(ring)):
            a, b = ring[i], ring[(i + 1) % len(ring)]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 1e-3:
                continue
            u0, u1 = s / bay, (s + L) / bay
            m.quad([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], material,
                   [(u0, (z0 - top_z) / storey), (u1, (z0 - top_z) / storey), (u1, (z1 - top_z) / storey), (u0, (z1 - top_z) / storey)])
            s += L


def cap(m, poly, z, material, scale=2.0):
    """A flat cap over a polygon (triangulated by bmesh, holes and all)."""
    bm = bmesh.new()
    for ring in [list(poly.exterior.coords)[:-1]] + [list(h.coords)[:-1] for h in poly.interiors]:
        vs = [bm.verts.new((x, y, z)) for x, y in ring]
        for i in range(len(vs)):
            bm.edges.new((vs[i], vs[(i + 1) % len(vs)]))
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=bm.edges)
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    m.add_bm(bm, material, uvscale=scale)


def rect_frame(ring):
    """The minimum rotated rectangle of a footprint: centre, unit axis along its long side, length and width."""
    R = Polygon(ring).minimum_rotated_rectangle
    c = list(R.exterior.coords)[:4]
    e0, e1 = Vector((c[1][0] - c[0][0], c[1][1] - c[0][1])), Vector((c[2][0] - c[1][0], c[2][1] - c[1][1]))
    if e1.length > e0.length:
        e0, e1 = e1, e0
    ctr = Vector((sum(p[0] for p in c) / 4, sum(p[1] for p in c) / 4))
    return ctr, e0.normalized(), e0.length, e1.length


# ------------------------------------------------------------ the Hermitage
def build_hermitage(meas):
    cells = np.array(meas["cells"], np.float64)
    x, y, h, g = cells[:, 0], cells[:, 1], cells[:, 2] / 10, cells[:, 3] / 10
    i0, j0 = np.floor(x.min()), np.floor(y.min())
    ii, jj = np.floor(x - i0).astype(int), np.floor(y - j0).astype(int)
    W, H = ii.max() + 1, jj.max() + 1
    ns = np.zeros((H, W), np.int32)
    gg = np.full((H, W), np.nan)
    # storeys: the height less a roof's rise, in whole storeys (one at least)
    ns[jj, ii] = np.maximum(1, np.round((h - 0.9) / STOREY)).astype(int)
    gg[jj, ii] = g
    occ = ns > 0
    occ = ndimage.binary_closing(occ, iterations=1) & ndimage.binary_opening(occ, iterations=1)
    nf = ndimage.median_filter(ns, size=3)
    nf[~occ] = 0
    nf = np.where(occ & (nf == 0), 1, nf)
    gf = ndimage.generic_filter(np.nan_to_num(gg, nan=np.nanmedian(gg)), np.median, size=5)
    m = Mesh()
    blocks = 0
    for n in range(1, nf.max() + 1):
        lab, cnt = ndimage.label(nf == n)
        for k in range(1, cnt + 1):
            sel = lab == k
            if sel.sum() < 12:
                continue
            jj_, ii_ = np.nonzero(sel)
            poly = unary_union([box(i0 + a, j0 + b, i0 + a + 1, j0 + b + 1) for a, b in zip(ii_, jj_)]).buffer(0.3).buffer(-0.3).simplify(0.8)
            for p in getattr(poly, "geoms", [poly]):
                if p.area < 10:
                    continue
                base = float(np.median(gf[sel]))
                top = base + n * STOREY + 0.4
                walls(m, p, base - 3.0, top, "Facade", top_z=top - 0.4)
                # the parapet, a band over the top storey, and the roof inside it
                walls(m, p, top, top + 0.6, "Parapet")
                inner = p.buffer(-0.35)
                cap(m, p, top + 0.6, "Parapet") if inner.is_empty else None
                if not inner.is_empty:
                    for q in getattr(inner, "geoms", [inner]):
                        cap(m, q, top + 0.25, "RoofFlat", 4.0)
                    ring_poly = p.difference(inner)
                    for q in getattr(ring_poly, "geoms", [ring_poly]):
                        cap(m, q, top + 0.6, "Parapet")
                blocks += 1
    print(f"  hermitage: {blocks} blocks, up to {nf.max()} storeys")
    bt.fix_uv_quads(m) if False else None
    return [m.build("Hermitage")]


# ------------------------------------------------------------ the visitor centre and the salmon shop
def lake_side(e0):
    """The long side's outward normal that looks most to the north (the lake)."""
    nrm = Vector((-e0.y, e0.x))
    return nrm if nrm.y >= 0 else -nrm


def build_visitor_centre(meas):
    ctr, u, L, Wd = rect_frame(meas["ring"])
    nn = lake_side(u)
    hi, lo = meas["top_m"], meas["top_m"] - 2.0                   # 5.2 m over the lake side, 3.2 m at the back
    P = lambda a, b, z: (ctr.x + u.x * a + nn.x * b, ctr.y + u.y * a + nn.y * b, z)
    m = Mesh()
    hl, hw = L / 2, Wd / 2
    zat = lambda b: lo + (hi - lo) * (b + hw) / (2 * hw)
    # the back and the ends: cedar boards; the front (to the lake): glass in a dark frame, floor to roof
    m.quad([P(hl, -hw, 0), P(-hl, -hw, 0), P(-hl, -hw, lo), P(hl, -hw, lo)], "Cedar", [(0, 0), (2 * hl / 1.5, 0), (2 * hl / 1.5, lo / 1.5), (0, lo / 1.5)])
    for s in (-1, 1):
        pts = [P(s * hl, -hw, 0), P(s * hl, hw, 0), P(s * hl, hw, hi), P(s * hl, -hw, lo)]
        m.quad(pts if s > 0 else pts[::-1], "Cedar", [(0, 0), (2 * hw / 1.5, 0), (2 * hw / 1.5, hi / 1.5), (0, lo / 1.5)] if s > 0 else None)
    for k in range(6):
        a0, a1 = -hl + 2 * hl * k / 6, -hl + 2 * hl * (k + 1) / 6
        m.quad([P(a0, hw, 0.35), P(a1, hw, 0.35), P(a1, hw, hi - 0.3), P(a0, hw, hi - 0.3)], "Glass")
        m.add_bm(cube((0.08, 0.1, hi - 0.3), T(P(a0, hw, (hi - 0.3) / 2), rz=math.atan2(u.y, u.x))), "Frame")
    m.quad([P(-hl, hw, 0), P(hl, hw, 0), P(hl, hw, 0.35), P(-hl, hw, 0.35)], "Frame")
    m.add_bm(cube((2 * hl, 0.12, 0.3), T(P(0, hw, hi - 0.15), rz=math.atan2(u.y, u.x))), "Frame")
    # inside, seen through the glass: a floor and a darker back wall
    m.quad([P(-hl + 0.1, -hw + 0.1, 0.05), P(hl - 0.1, -hw + 0.1, 0.05), P(hl - 0.1, hw - 0.2, 0.05), P(-hl + 0.1, hw - 0.2, 0.05)], "Interior")
    m.quad([P(-hl + 0.1, -hw + 0.12, 0), P(hl - 0.1, -hw + 0.12, 0), P(hl - 0.1, -hw + 0.12, lo - 0.1), P(-hl + 0.1, -hw + 0.12, lo - 0.1)][::-1], "Interior")
    # the roof: a mono-pitch with deep eaves over the glass, a thin dark edge
    o, oe = 0.5, 1.4
    r = [P(-hl - o, -hw - o, zat(-hw - o) + 0.1), P(hl + o, -hw - o, zat(-hw - o) + 0.1), P(hl + o, hw + oe, zat(hw + oe) + 0.1), P(-hl - o, hw + oe, zat(hw + oe) + 0.1)]
    m.quad(r, "Corrugate", [(0, 0), (2 * (hl + o), 0), (2 * (hl + o), 2 * hw + o + oe), (0, 2 * hw + o + oe)])
    m.quad([(p[0], p[1], p[2] - 0.18) for p in r][::-1], "Frame")
    for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
        pa, pb = r[a], r[b]
        m.quad([(pa[0], pa[1], pa[2] - 0.18), (pb[0], pb[1], pb[2] - 0.18), pb, pa], "Frame")
    # a door in the back wall and a concrete apron
    m.quad([P(0.6, -hw - 0.02, 0), P(-0.6, -hw - 0.02, 0), P(-0.6, -hw - 0.02, 2.2), P(0.6, -hw - 0.02, 2.2)], "Frame")
    m.add_bm(cube((2 * hl + 3, 2 * hw + 4, 0.2), T(P(0, 0.6, 0.0), rz=math.atan2(u.y, u.x))), "Concrete", uvscale=2.0)
    return [m.build("Pukaki_visitor_centre")]


def build_salmon_shop(meas):
    ctr, u, L, Wd = rect_frame(meas["ring"])
    nn = lake_side(u)
    ridge, eave = meas["top_m"], 3.0
    P = lambda a, b, z: (ctr.x + u.x * a + nn.x * b, ctr.y + u.y * a + nn.y * b, z)
    m = Mesh()
    hl, hw = L / 2, Wd / 2
    for b in (-hw, hw):
        pts = [P(-hl, b, 0), P(hl, b, 0), P(hl, b, eave), P(-hl, b, eave)]
        m.quad(pts if b > 0 else pts[::-1], "Weatherboard", [(0, 0), (2 * hl / 1.5, 0), (2 * hl / 1.5, eave / 1.5), (0, eave / 1.5)])
    for s in (-1, 1):
        pts = [P(s * hl, -hw, 0), P(s * hl, hw, 0), P(s * hl, hw, eave), P(s * hl, 0, ridge), P(s * hl, -hw, eave)]
        m.quad(pts if s > 0 else pts[::-1], "Weatherboard")
    # the shop front on the car park side: windows and a door, and the lake side's windows
    for side, n in ((-1, 3), (1, 2)):
        for k in range(n):
            a = -hl + 2 * hl * (k + 0.5) / n
            w = 2.2 if side < 0 else 1.6
            m.quad([P(a - w / 2, side * (hw + 0.02), 0.9), P(a + w / 2, side * (hw + 0.02), 0.9), P(a + w / 2, side * (hw + 0.02), 2.3), P(a - w / 2, side * (hw + 0.02), 2.3)][::side], "Glass")
            m.add_bm(cube((w + 0.12, 0.06, 0.08), T(P(a, side * (hw + 0.03), 0.88), rz=math.atan2(u.y, u.x))), "Frame")
    m.quad([P(0.55, -hw - 0.03, 0), P(-0.55, -hw - 0.03, 0), P(-0.55, -hw - 0.03, 2.3), P(0.55, -hw - 0.03, 2.3)], "Glass")
    m.quad([P(-hl + 0.1, -hw + 0.1, 0.05), P(hl - 0.1, -hw + 0.1, 0.05), P(hl - 0.1, hw - 0.1, 0.05), P(-hl + 0.1, hw - 0.1, 0.05)], "Interior")
    # the roof: corrugated iron, 0.5 m eaves and verges
    o = 0.5
    for side in (-1, 1):
        r = [P(-hl - o, side * (hw + o), eave - o * (ridge - eave) / hw), P(hl + o, side * (hw + o), eave - o * (ridge - eave) / hw), P(hl + o, 0, ridge + 0.05), P(-hl - o, 0, ridge + 0.05)]
        r = r if side < 0 else [r[1], r[0], r[3], r[2]]
        m.quad(r, "Corrugate", [(0, 0), (2 * (hl + o), 0), (2 * (hl + o), hw + o), (0, hw + o)])
        m.quad([(p[0], p[1], p[2] - 0.1) for p in r][::-1], "Weatherboard")
    m.add_bm(cube((2 * hl + 0.3, 0.25, 0.12), T(P(0, 0, ridge + 0.08), rz=math.atan2(u.y, u.x))), "Frame")
    m.add_bm(cube((2 * hl + 2, 2 * hw + 2.5, 0.2), T(P(0, -0.4, 0.0), rz=math.atan2(u.y, u.x))), "Concrete", uvscale=2.0)
    return [m.build("Pukaki_salmon_shop")]


# ------------------------------------------------------------ the tahr statue
def build_tahr(meas):
    """A Himalayan tahr bull, life size (0.95 m at the shoulder, 1.4 m long), standing on a boulder, head turned a little
    to the lake; the thick ruff of a bull's winter coat over the neck and shoulders, short horns curving back."""
    top = meas.get("top_m", 2.8)
    E = []
    E += [ell((0.0, 0, 0.78), 0, (0.42, 0.2, 0.2)), ell((0.30, 0, 0.84), 0, (0.22, 0.22, 0.25)), ell((-0.34, 0, 0.78), 0, (0.2, 0.19, 0.2))]
    # the ruff: long hair over the neck, the shoulders and down the chest
    E += [ell((0.38, 0, 0.98), 0, (0.24, 0.24, 0.24)), ell((0.46, 0, 0.82), 0, (0.18, 0.2, 0.28)), ell((0.24, 0, 1.0), 0, (0.22, 0.22, 0.18))]
    # neck and head, a short face and the horns
    E += [capsule((0.50, 0, 1.0), (0.62, 0, 1.13), 0.11), ell((0.68, 0, 1.16), 0, (0.11, 0.075, 0.09)), capsule((0.70, 0, 1.15), (0.82, 0, 1.08), 0.05),
          ell((0.84, 0, 1.07), 0, (0.035, 0.035, 0.03))]
    for s in (-1, 1):
        E += [ell((0.64, s * 0.075, 1.25), 0, (0.04, 0.02, 0.025))]                                           # ears
        horn = [(0.66, s * 0.035, 1.24), (0.64, s * 0.05, 1.31), (0.59, s * 0.065, 1.35), (0.53, s * 0.07, 1.34)]
        for i, (a, b) in enumerate(zip(horn[:-1], horn[1:])):
            E.append(capsule(a, b, 0.026 - 0.006 * i))
        E += [capsule((0.30, s * 0.11, 0.66), (0.32, s * 0.1, 0.30), 0.06), capsule((0.32, s * 0.1, 0.30), (0.33, s * 0.09, 0.06), 0.045),
              ell((0.34, s * 0.09, 0.03), 0, (0.04, 0.03, 0.03))]                                            # forelegs
        E += [ell((-0.36, s * 0.11, 0.68), 0, (0.14, 0.08, 0.15)), capsule((-0.38, s * 0.1, 0.56), (-0.44, s * 0.09, 0.30), 0.055),
              capsule((-0.44, s * 0.09, 0.30), (-0.40, s * 0.085, 0.06), 0.045), ell((-0.39, s * 0.085, 0.03), 0, (0.04, 0.03, 0.03))]
    E.append(capsule((-0.52, 0, 0.84), (-0.58, 0, 0.74), 0.045))
    me = metaball_mesh("tahr", E, res=0.02)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    # the coat as a sculptor models it in the clay: locks of long hair hanging from the ruff (streaks that run down, so
    # the noise is stretched along z), a shorter coat elsewhere, smooth on the face and the legs
    from mathutils import noise
    bm.normal_update()
    for vtx in bm.verts:
        co, nrm = vtx.co, vtx.normal
        ruff = max(0.0, min(1.0, (co.x - 0.05) / 0.2)) * max(0.0, min(1.0, (co.z - 0.62) / 0.15)) * (1.0 if co.x < 0.6 and co.z < 1.16 else 0.0)
        body = 1.0 if 0.45 < co.z < 1.05 and co.x < 0.6 else 0.0
        locks = noise.noise(Vector((co.x * 26, co.y * 26, co.z * 5)))
        short = noise.noise(Vector((co.x * 40, co.y * 40, co.z * 40)))
        vtx.co = co + nrm * (ruff * 0.035 * (0.6 + locks) + body * 0.008 * short)
    for vtx in bm.verts:
        if vtx.co.x > 0.1 and 0.72 < vtx.co.z < 1.16 and vtx.co.x < 0.6 and vtx.normal.z < -0.2:
            vtx.co.z -= 0.03 * (0.5 + 0.5 * noise.noise(Vector((vtx.co.x * 30, vtx.co.y * 30, 0.5))))   # the fringe hangs
    m = Mesh()
    # the boulder: a rounded block of greywacke, flat enough on top for the animal
    rock_h = top - 1.36
    r = np.random.default_rng(2014)
    b = bmesh.new()
    bmesh.ops.create_icosphere(b, subdivisions=3, radius=1.0)
    for v in b.verts:
        d = v.co.copy()
        k = 1 + 0.12 * math.sin(3.1 * d.x + 1.3) * math.cos(2.7 * d.y) + 0.08 * (r.random() - 0.5)
        v.co = Vector((d.x * 1.35 * k, d.y * 0.95 * k, d.z * rock_h * 0.62 * k))
        if v.co.z > rock_h * 0.42:
            v.co.z = rock_h * 0.42 + (v.co.z - rock_h * 0.42) * 0.25
    bmesh.ops.translate(b, vec=(0, 0, rock_h * 0.55), verts=b.verts)
    m.add_bm(b, "Boulder", smooth=True, uvscale=1.0)
    stand = rock_h * 0.55 + rock_h * 0.42 + (rock_h * 0.62 * 1.1 - rock_h * 0.42) * 0.25 - 0.06
    head = Matrix.Rotation(math.pi / 2 + math.radians(8), 4, "Z")          # facing north, a little to the west (Aoraki)
    m.add_bm(bm, "Bronze", Matrix.Translation((0, 0, stand)) @ head, smooth=True)
    return [m.build("Pukaki_tahr")]


# ------------------------------------------------------------ the Hooker Valley's swing bridges
def build_bridge(meas, name):
    (ax, ay), (bx, by) = meas["ends"]
    z0 = meas["river_m"]
    A, B = Vector((ax, ay)), Vector((bx, by))
    u = (B - A).normalized()
    v = Vector((-u.y, u.x))
    L = (B - A).length
    # the deck: the DSM along the way, fitted to a sag (a parabola), its ends on the banks
    prof = np.array(meas["dsm_profile_m"])
    ts = np.linspace(0, 1, len(prof))
    c = np.polyfit(ts, prof, 2)
    deck = lambda s: float(np.polyval(c, s / L)) - z0
    zA, zB = deck(0), deck(L)
    Wd, rail, post = 1.2, 1.15, 3.2                    # deck width, the main cables' height at mid-span, the portals over the deck
    P = lambda s, off, z: (A.x + u.x * s + v.x * off, A.y + u.y * s + v.y * off, z)
    rz = math.atan2(u.y, u.x)
    m = Mesh()
    n = max(24, int(L / 1.5))
    ss = np.linspace(0, L, n + 1)
    cable = lambda s: (zA + (zB - zA) * s / L + post) - 4 * (post - rail) * (s / L) * (1 - s / L) + (deck(s) - (zA + (zB - zA) * s / L)) * 0.0
    for i in range(n):
        sa, sb = ss[i], ss[i + 1]
        za, zb = deck(sa), deck(sb)
        m.quad([P(sa, -Wd / 2, za), P(sb, -Wd / 2, zb), P(sb, Wd / 2, zb), P(sa, Wd / 2, za)], "Decking", [(sa / 2, 0), (sb / 2, 0), (sb / 2, 0.6), (sa / 2, 0.6)])
        m.quad([P(sa, -Wd / 2, za - 0.08), P(sa, Wd / 2, za - 0.08), P(sb, Wd / 2, zb - 0.08), P(sb, -Wd / 2, zb - 0.08)], "Steel")
        for side in (-1, 1):
            o = side * Wd / 2
            # the mesh sides from the deck edge to the cable
            ca, cb = max(za + 0.9, cable(sa)), max(zb + 0.9, cable(sb))
            m.quad([P(sa, o, za), P(sb, o, zb), P(sb, o, cb), P(sa, o, ca)], "Mesh")
            # the main cable, a thin square tube
            for (o0, z0_), (o1, z1_) in (((o - 0.02, 0), (o + 0.02, 0)), ((o, -0.02), (o, 0.02))):
                m.quad([P(sa, o0, ca + z0_), P(sb, o0, cb + z0_), P(sb, o1, cb + z1_), P(sa, o1, ca + z1_)], "Cable")
            # a stringer along the deck edge
            m.add_bm(cube((sb - sa + 0.01, 0.06, 0.12), T(P((sa + sb) / 2, o, (za + zb) / 2 - 0.04), rz=rz, ry=-math.atan2(zb - za, sb - sa))), "Steel")
    # hangers, every 1.5 m
    for s in np.arange(1.5, L - 1.0, 1.5):
        for side in (-1, 1):
            z = deck(s)
            hgt = max(0.9, cable(s) - z)
            m.add_bm(cube((0.02, 0.02, hgt), T(P(s, side * Wd / 2, z + hgt / 2), rz=rz)), "Cable")
    # the portals at each end: two steel posts and a crossbar, on concrete footings; the cables run on to anchor blocks
    for s, back, z in ((0, -1, zA), (L, 1, zB)):
        for side in (-1, 1):
            m.add_bm(cube((0.14, 0.14, post + 2.0), T(P(s, side * (Wd / 2 + 0.15), z + post / 2 - 1.0), rz=rz)), "Steel")
            m.add_bm(cube((0.7, 0.7, 2.2), T(P(s, side * (Wd / 2 + 0.15), z - 1.0), rz=rz)), "Concrete", uvscale=1.0)
            # the backstay to its anchor, 6 m behind and down in the bank
            a0 = Vector(P(s, side * (Wd / 2 + 0.15), z + post))
            a1 = Vector(P(s + back * 6.0, side * (Wd / 2 + 0.6), z - 0.6))
            d = a1 - a0
            q = Vector((0, 0, 1)).rotation_difference(d.normalized())
            m.add_bm(cube((0.04, 0.04, d.length), Matrix.Translation((a0 + a1) / 2) @ q.to_matrix().to_4x4()), "Cable")
            m.add_bm(cube((1.2, 1.2, 1.4), T(tuple(a1 - Vector((0, 0, 0.4))), rz=rz)), "Concrete", uvscale=1.0)
        m.add_bm(cube((0.12, Wd + 0.6, 0.18), T(P(s, 0, z + post), rz=rz)), "Steel")
        # the landing: a concrete pad onto the deck
        m.add_bm(cube((2.0, Wd + 0.8, 1.6), T(P(s + back * 1.0, 0, z - 0.8), rz=rz)), "Concrete", uvscale=1.0)
    return [m.build(name)]


VIEWS = {
    "hermitage": [((-120.0, -150.0, 60.0), (30.0, -50.0, 10.0), 30)],
    "visitor-centre": [((14.0, 26.0, 4.0), (0.0, 0.0, 2.5), 28), ((-18.0, -22.0, 3.0), (0.0, 0.0, 2.5), 28)],
    "tahr-statue": [((3.5, 3.0, 2.6), (0.0, 0.0, 2.2), 40)],
    "lower-hooker-bridge": [((40.0, -50.0, 22.0), (0.0, 0.0, 9.0), 30)],
}


def still(key, objs, samples):
    bt.DOCS = DOCS
    bt.VIEWS[key] = VIEWS[key]
    bt.still(key, objs, samples)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--render", action="store_true", help="also render stills into docs/images/lake-pukaki")
    ap.add_argument("--samples", type=int, default=48)
    a = ap.parse_args()
    meas = json.load(open(os.path.join(CITY, "analysis", "landmarks.json")))["landmarks"]
    os.makedirs(OUT, exist_ok=True)
    jobs = {"hermitage": (build_hermitage, "hermitage"), "visitor-centre": (build_visitor_centre, "visitor-centre"),
            "salmon-shop": (build_salmon_shop, "salmon-shop"), "tahr-statue": (build_tahr, "tahr-statue"),
            "lower-hooker-bridge": (lambda mm: build_bridge(mm, "Lower_Hooker_bridge"), "lower-hooker-bridge"),
            "hooker-bluff-bridge": (lambda mm: build_bridge(mm, "Hooker_Bluff_bridge"), "hooker-bluff-bridge"),
            "upper-hooker-bridge": (lambda mm: build_bridge(mm, "Upper_Hooker_bridge"), "upper-hooker-bridge")}
    for key, (fn, mid) in jobs.items():
        if a.only and a.only != key:
            continue
        bt.clear()
        materials()
        objs = fn(meas.get(mid) or {})
        tris = 0
        for o in objs:
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
        print(f"{key}: {tris} triangles")
        export(objs, os.path.join(OUT, f"pukaki-{key}.glb"))
        if a.render and key in VIEWS:
            still(key, objs, a.samples)


if __name__ == "__main__":
    main()
