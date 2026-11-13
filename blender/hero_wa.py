"""Japanese traditional pieces for hero levels (docs/HERO.md), on the kit of blender/hero_kit.py: what a
Kyoto lane or a shrine's approach is made of, each as plain geometry by material in the city's frame.

  Site       a map's measured data round a level: the terrain, the buildings' solids and their roof
             meshes (web/data/<city>/buildings.json), OpenStreetMap's detail, and what a walker on
             the level's lines can see (seen): a face nobody on the street can see is not built
  ribbon     paving that follows the terrain along a line
  roof_skin  a building's own roof mesh again in tile, with the round eave tiles along its eaves
  wall_skin  a side wall in charred boards under plaster
  machiya    a town house's front: stone footing, posts and beams, lattices (koshi) over lit paper,
             a sliding door under a noren, a shop's window, the bamboo guard (inuyarai), the pent
             roof (hisashi) in tile, plaster above with a slit window (mushiko-mado) or a blind
  torii, stone_lantern, tamagaki, nobori, andon, chochin, bench   what stands on a street or an approach

Materials follow web/game/hero.js's names: glow* lit by day and night, paper* and lamp* lit after
dark only, ground* what is walked on; a material ending _fine is the finest geometry (lattice bars,
eave tiles, rafters), which a phone does not load.
"""
import base64
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import adkit as ad  # noqa: E402
import archkit as ak  # noqa: E402
import hero_kit as K  # noqa: E402

UP = np.array([0.0, 0.0, 1.0])
WARM = (1.0, 0.72, 0.42)   # a paper lantern's light, linear


def materials():
    """The materials these pieces use (a level adds its own)."""
    return {
        "ground_sett": {"tex": "sett", "tint": (0.62, 0.60, 0.57), "rough": 0.8},
        "ground_flag": {"tex": "flag", "tint": (0.66, 0.65, 0.62), "rough": 0.8},
        "ground_gravel": {"tex": "gravel", "tint": (0.50, 0.49, 0.46), "rough": 0.95},
        "ground_lid": {"map": "atlas", "rough": 0.85},
        "ground_asphalt": {"tex": "asphalt", "tint": (0.42, 0.42, 0.43), "rough": 0.9},
        "stone": {"tex": "stone", "tint": (0.60, 0.59, 0.56), "rough": 0.85},
        "stone_moss": {"tex": "stone", "tint": (0.44, 0.47, 0.40), "rough": 0.9},
        "roof_kawara": {"tex": "kawara", "tint": (0.50, 0.51, 0.53), "rough": 0.5},
        "tile_edge_fine": {"color": (0.085, 0.088, 0.095), "rough": 0.45},
        "wood_dark": {"tex": "wood", "tint": (0.20, 0.155, 0.125), "rough": 0.75},
        "wood_dark_fine": {"tex": "wood", "tint": (0.17, 0.13, 0.105), "rough": 0.75},
        "wood_board": {"tex": "wood", "tint": (0.115, 0.10, 0.095), "rough": 0.8},
        "wood_bare": {"tex": "wood", "tint": (0.52, 0.40, 0.28), "rough": 0.7},
        "wood_shu": {"tex": "shu", "tint": (0.80, 0.215, 0.085), "rough": 0.5},
        "black_lacquer": {"color": (0.018, 0.018, 0.02), "rough": 0.35},
        "plaster_white": {"tex": "plaster", "tint": (0.86, 0.84, 0.78), "rough": 0.9},
        "plaster_ochre": {"tex": "plaster", "tint": (0.70, 0.56, 0.36), "rough": 0.9},
        "plaster_bengara": {"tex": "plaster", "tint": (0.52, 0.25, 0.17), "rough": 0.9},
        "plaster_grey": {"tex": "plaster", "tint": (0.45, 0.44, 0.42), "rough": 0.9},
        "bamboo": {"tex": "bamboo", "tint": (0.55, 0.47, 0.33), "rough": 0.6},
        "copper": {"color": (0.085, 0.13, 0.115), "rough": 0.6, "metal": 0.4},
        "iron": {"color": (0.03, 0.03, 0.033), "rough": 0.5, "metal": 0.7},
        "cloth": {"map": "atlas", "rough": 0.95},
        "sign": {"map": "atlas", "rough": 0.7},
        "glow_shop": {"map": "atlas", "rough": 0.15, "emissive": True, "glow": 0.5},
        "paper_shoji": {"map": "atlas", "rough": 0.9, "emissive": True, "glow": 0.75},
        "lamp_andon": {"map": "atlas", "rough": 0.9, "emissive": True, "glow": 1.6},
        "lamp_paper": {"color": (0.92, 0.86, 0.72), "rough": 0.9, "emissive": WARM, "glow": 2.2},
        "lamp_red": {"color": (0.75, 0.10, 0.06), "rough": 0.9, "emissive": (1.0, 0.16, 0.06), "glow": 1.6},
        "felt_red": {"color": (0.55, 0.035, 0.03), "rough": 1.0},
        "bucket_red": {"color": (0.6, 0.05, 0.03), "rough": 0.5},
    }


def tex_scale(mat, M):
    """Metres one repeat of a material's texture covers."""
    t = M.get(mat, {}).get("tex")
    return K.TEXTURES[t][1] if t else 1.0


# ---------------------------------------------------------------- the measured place

class Site:
    def __init__(self, city, osm_file=None):
        import cityctx
        from shapely.geometry import Polygon
        from shapely.strtree import STRtree
        self.city = city
        self.C = cityctx.City(city)
        self.T = ak.Terrain(city)
        self.S = ak.load_solids(city)
        B = json.load(open(os.path.join(ROOT, "web", "data", city, "buildings.json")))
        self.B = B
        self.roofs = {r[0]: r for r in B["r"]}
        self.osm = json.load(open(os.path.join(ROOT, "cities", city, osm_file))) if osm_file else {"ways": [], "nodes": []}
        self.polys = [Polygon(s["ring"]).buffer(0) for s in self.S]
        self.tree = STRtree(self.polys)
        self.eyes = []

    def z(self, x, y):
        return self.T(float(x), float(y))

    def local(self, ll):
        return np.array(self.C.fwd.transform(*ll))

    def ways(self, **tags):
        """OpenStreetMap ways whose tags match, as (tags, [(x, y)])."""
        return [(w["tags"], [self.local(p) for p in w["ll"]]) for w in self.osm["ways"]
                if all(w["tags"].get(k) == v for k, v in tags.items())]

    def building(self, sd):
        return self.B["b"][self.B["s"][sd["si"]][0]]

    def eave(self, sd):
        """A solid's eave, absolute (m)."""
        r = self.roofs.get(sd["si"])
        return sd["ground"] + (r[2] / 10 if r else sd["top"])

    def roof(self, sd):
        """A solid's roof mesh: (points absolute (n, 3), triangles, how many of them are roof)."""
        r = self.roofs.get(sd["si"])
        if not r:
            return None
        P = np.frombuffer(base64.b64decode(r[6]), dtype="<i2").reshape(-1, 3) / 10.0 + [r[4] / 10, r[5] / 10, sd["ground"]]
        tri = np.frombuffer(base64.b64decode(r[7]), dtype=np.uint8 if len(P) < 256 else "<u2").reshape(-1, 3)
        return P, tri, r[8]

    def watch(self, lines, step=4.0, eye=1.7, side=0.0):
        """The eye points a level is seen from: along its lines, every `step` m."""
        from shapely.geometry import LineString
        for ln in lines:
            ln = LineString(ln)
            for s in np.arange(0, ln.length + step, step):
                p = ln.interpolate(min(s, ln.length))
                self.eyes.append((p.x, p.y, self.z(p.x, p.y) + eye))

    def seen(self, p, reach=160.0, skip=None):
        """Whether a walker at any of the eye points sees p (x, y, z): the sight line clears every
        building's solid between them (their tops, as buildings.json has them)."""
        from shapely.geometry import LineString
        for e in self.eyes:
            d = math.hypot(p[0] - e[0], p[1] - e[1])
            if d > reach or d < 0.05:
                continue
            seg = LineString([e[:2], p[:2]])
            clear = True
            for i in self.tree.query(seg):
                if i == skip or not self.polys[i].intersects(seg):
                    continue
                g = self.polys[i].intersection(seg)
                ts = [math.hypot(x - e[0], y - e[1]) / d for part in getattr(g, "geoms", [g]) for x, y in getattr(part, "coords", [])]
                if not ts:
                    continue
                zl = e[2] + (p[2] - e[2]) * min(ts)
                zh = e[2] + (p[2] - e[2]) * max(ts)
                if min(zl, zh) < self.S[i]["ground"] + self.S[i]["top"] - 0.3:
                    clear = False
                    break
            if clear:
                return True
        return False

    def centred(self, line, reach=9.0, step=3.0, smooth=3):
        """A street's line moved to the middle of the gap between the buildings either side of it (a mapped
        centre line can hug one row of fronts): [(x, y)], and the half width there."""
        from shapely.geometry import LineString
        from shapely.ops import unary_union
        ln = LineString([tuple(p[:2]) for p in line])
        built = unary_union([g for g in self.polys if g.distance(ln) < reach + 2])
        pts, half = [], []
        for s in np.arange(0, ln.length + step, step):
            s = min(s, ln.length)
            c, a, b = ln.interpolate(s), ln.interpolate(max(s - 0.5, 0)), ln.interpolate(min(s + 0.5, ln.length))
            t = K.unit(np.array([b.x - a.x, b.y - a.y])); n = np.array([-t[1], t[0]])
            d = []
            for sg in (1, -1):
                ray = LineString([(c.x, c.y), (c.x + n[0] * sg * reach, c.y + n[1] * sg * reach)])
                hit = ray.intersection(built)
                d.append(reach if hit.is_empty else max(0.0, hit.distance(c) if not built.contains(c) else 0.0))
            off = (d[0] - d[1]) / 2 if max(d) < reach - 0.01 else (prev if pts else 0.0)
            prev = off
            pts.append(np.array([c.x, c.y]) + n * off); half.append((d[0] + d[1]) / 2)
        P = np.array(pts)
        for _ in range(smooth):
            P[1:-1] = (P[:-2] + 2 * P[1:-1] + P[2:]) / 4
        return [tuple(q) for q in P], half

    def edges(self, sd):
        """A solid's wall edges as frames, outward."""
        ring = [np.asarray(p, float) for p in sd["ring"]]
        ccw = ak.ring_area(sd["ring"]) > 0
        out = []
        for a, b in zip(ring, ring[1:] + ring[:1]):
            if np.linalg.norm(b - a) < 0.4:
                continue
            out.append(Frame(a, b) if ccw else Frame(b, a))
        return out


class Frame:
    """A wall's frame: u along it to the right as seen from outside, v out from it, z up (absolute)."""

    def __init__(self, a, b):
        # a -> b runs with the inside on the left (a counter-clockwise ring), so the outside is on the right
        a, b = np.asarray(a, float)[:2], np.asarray(b, float)[:2]
        self.L = float(np.linalg.norm(b - a))
        e = (b - a) / self.L
        self.n = np.array([e[1], -e[0]])
        self.t = np.array([-self.n[1], self.n[0]])   # (= e: to the right seen from outside)
        self.a = a
        self.t3, self.n3 = np.r_[self.t, 0.0], np.r_[self.n, 0.0]
        self.mid = (a + b) / 2

    def __call__(self, u, v, z):
        q = self.a + self.t * u + self.n * v
        return np.array([q[0], q[1], z])


# ---------------------------------------------------------------- small solids

def lathe(G, mat, c, prof, segs=12, ao=None, phase=0.0):
    """A solid of revolution round the vertical through c: prof [(r, z above c)], bottom to top."""
    g = G.part(mat)
    c = np.asarray(c, float)
    rings = []
    for i, (r, z) in enumerate(prof):
        r0, z0 = prof[max(i - 1, 0)]
        r1, z1 = prof[min(i + 1, len(prof) - 1)]
        dr, dz = r1 - r0, z1 - z0
        ln = math.hypot(dr, dz) or 1.0
        base = len(g["p"])
        for k in range(segs + 1):
            th = phase + 2 * math.pi * k / segs
            cs, sn = math.cos(th), math.sin(th)
            g["p"].append(c + [r * cs, r * sn, z])
            g["n"].append(np.array([cs * dz / ln, sn * dz / ln, -dr / ln]))
            g["uv"].append((k / segs * max(1.0, round(2 * math.pi * max(r, 0.05))), z))
            g["ao"].append(1.0 if ao is None else ao)
        rings.append(base)
    for i in range(len(rings) - 1):
        for k in range(segs):
            a0, a1, b0, b1 = rings[i] + k, rings[i] + k + 1, rings[i + 1] + k, rings[i + 1] + k + 1
            g["tri"] += [(a0, a1, b1), (a0, b1, b0)]


def rod(G, mat, a, b, r, segs=6):
    """A round rod from a to b, capped at b (an eave tile's end, a rafter's)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    G.tube(mat, [a, b], r, segs)
    g = G.part(mat)
    d = K.unit(b - a)
    base = len(g["p"])
    ring = g["p"][base - (segs + 1):base]
    g["p"].append(b); g["n"].append(d); g["uv"].append((0.5, 0.5)); g["ao"].append(1.0)
    for q in ring:
        g["p"].append(q); g["n"].append(d); g["uv"].append((0.5, 0.5)); g["ao"].append(1.0)
    for k in range(segs):
        g["tri"].append((base, base + 1 + k, base + 2 + k))


def light(G, c, rgb, k, area=0.05):
    """A small lamp at c for the bake: it shines every way."""
    for n in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, -1), (0, 0, 1)):
        G.emitters.append((np.asarray(c, float), np.asarray(n, float), area, np.asarray(rgb, float) * k))


def tq(G, M, mat, a, b, c, d, ao=None, sub=None, rot=False):
    """A quad in a tiled material, its texture in metres (the material's own repeat); rot turns the grain."""
    P = [np.asarray(q, float) for q in (a, b, c, d)]
    s = tex_scale(mat, M)
    lu, lv = np.linalg.norm(P[1] - P[0]) / s, np.linalg.norm(P[3] - P[0]) / s
    o = (float(P[0][0] + P[0][1]) * 0.37) % 1.0
    uv = [(o, 0), (o, lu), (o + lv, lu), (o + lv, 0)] if rot else [(o, 0), (o + lu, 0), (o + lu, lv), (o, lv)]
    G.quad(mat, *P, uv=uv, ao=ao, sub=sub)


def tbox(G, M, mat, c, ax, size, faces="all", ao=None):
    G.box(mat, c, ax, size, uvm=1.0 / tex_scale(mat, M), faces=faces, ao=ao)


# ---------------------------------------------------------------- the ground

def ribbon(G, M, mat, line, half, zf, lift=0.09, cell=0.8, clip=None):
    """Paving along a line, `half` m either side (or (left, right)), following the ground zf(x, y)."""
    from shapely.geometry import LineString, Point
    ln = LineString([tuple(p[:2]) for p in line])
    hl, hr = half if isinstance(half, tuple) else (half, half)
    ns = max(2, int(math.ceil(ln.length / cell)) + 1)
    nc = max(2, int(math.ceil((hl + hr) / cell)) + 1)
    s = tex_scale(mat, M)
    g = G.part(mat)
    base = len(g["p"])
    keep = []
    for i in range(ns):
        d = ln.length * i / (ns - 1)
        p, q = ln.interpolate(max(d - 0.3, 0)), ln.interpolate(min(d + 0.3, ln.length))
        c = ln.interpolate(d)
        t = K.unit(np.array([q.x - p.x, q.y - p.y]))
        nrm = np.array([-t[1], t[0]])   # to the left
        for j in range(nc):
            w = -hr + (hl + hr) * j / (nc - 1)
            x, y = c.x + nrm[0] * w, c.y + nrm[1] * w
            g["p"].append(np.array([x, y, zf(x, y) + lift])); g["n"].append(UP); g["uv"].append((w / s, d / s)); g["ao"].append(1.0)
            keep.append(clip is None or clip.contains(Point(x, y)))
    for i in range(ns - 1):
        for j in range(nc - 1):
            k = base + i * nc + j
            if clip is not None and not any(keep[q - base] for q in (k, k + 1, k + nc, k + nc + 1)):
                continue
            g["tri"] += [(k, k + nc, k + nc + 1), (k, k + nc + 1, k + 1)]


def decal(G, mat, c, ax, w, h, zf, uv, lift=0.11):
    """A flat thing on the ground (a manhole, a gutter's lid)."""
    e = K.unit(np.asarray(ax, float)[:2]); f = np.array([-e[1], e[0]])
    c = np.asarray(c, float)[:2]
    q = [c - e * w / 2 - f * h / 2, c + e * w / 2 - f * h / 2, c + e * w / 2 + f * h / 2, c - e * w / 2 + f * h / 2]
    G.quad(mat, *[np.array([p[0], p[1], zf(*p) + lift]) for p in q], uv=uv, n=UP)


# ---------------------------------------------------------------- roofs and side walls

def eave_tiles(G, a, b, out, pitch=0.27, r=0.07):
    """The row of round end tiles (noki-gawara) along an eave from a to b, facing `out`, and the flat edge between them."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    L = np.linalg.norm(b - a)
    n = max(1, int(L / pitch))
    o = np.r_[K.unit(np.asarray(out, float)[:2]), 0.0]
    for i in range(n):
        p = a + (b - a) * ((i + 0.5) / n) + [0, 0, 0.035]
        rod(G, "tile_edge_fine", p - o * 0.16 + [0, 0, 0.05], p + o * 0.03, r, 6)
    G.quad("tile_edge_fine", a + o * 0.02 - [0, 0, 0.05], b + o * 0.02 - [0, 0, 0.05], b + o * 0.02 + [0, 0, 0.02], a + o * 0.02 + [0, 0, 0.02], n=o)


def roof_skin(G, M, site, sd, lift=0.07, tiles=True, mat="roof_kawara"):
    """A building's roof again in tile over its own (the triangles of its roof mesh a walker can see), and
    the round tiles and the gutter along the eaves that face the level. Returns the eaves [(a, b, out)]."""
    got = site.roof(sd)
    if not got:
        return []
    P, tri, nr = got
    s = tex_scale(mat, M)
    g = G.part(mat)
    eaves = []
    for a, b, c in tri[:nr]:
        if len({a, b, c}) < 3:
            continue
        p = P[[a, b, c]]
        n = np.cross(p[1] - p[0], p[2] - p[0])
        if np.linalg.norm(n) < 1e-4:
            continue
        n = K.unit(n)
        if n[2] < 0:
            n, p = -n, p[::-1]
        if n[2] > 0.999 or not site.seen(p.mean(0) + n * 0.3, skip=sd["si"]):
            continue
        eh = K.unit(np.cross(UP, n)); es = np.cross(n, eh)
        base = len(g["p"])
        for q in p:
            g["p"].append(q + n * lift); g["n"].append(n); g["uv"].append((float(q @ eh) / s, float(q @ es) / s)); g["ao"].append(1.0)
        g["tri"].append((base, base + 1, base + 2))
        zmin = p[:, 2].min()
        for i in range(3):
            u, v = p[i], p[(i + 1) % 3]
            if abs(u[2] - v[2]) < 0.06 and abs(u[2] - zmin) < 0.06 and np.linalg.norm(u - v) > 1.2:
                out = K.unit(np.r_[n[:2], 0])
                eaves.append((u + n * lift, v + n * lift, out))
    if tiles:
        for a, b, out in eaves:
            eave_tiles(G, a, b, out)
            G.tube("copper", [a + out * 0.06 - [0, 0, 0.16], b + out * 0.06 - [0, 0, 0.16]], 0.055, 6)
    return eaves


def wall_skin(G, M, fr, zlow, ze, plaster="plaster_white", off=0.05, board=2.3):
    """A side or back wall: charred boards (yakisugi) to `board` m over the ground, plaster above, a rail between."""
    L = fr.L
    zb = min(ze, zlow + 0.3 + board)
    tq(G, M, "wood_board", fr(0, off, zlow), fr(L, off, zlow), fr(L, off, zb), fr(0, off, zb), rot=True)
    if ze > zb + 0.05:
        tq(G, M, plaster, fr(0, off, zb), fr(L, off, zb), fr(L, off, ze), fr(0, off, ze))
        tbox(G, M, "wood_dark", fr(L / 2, off + 0.03, zb - 0.05), (fr.t3, fr.n3), (L, 0.06, 0.1), faces=("+v", "top", "bot"))
        nb = max(1, int(round(L / 1.9)))
        for i in range(1, nb):
            tbox(G, M, "wood_dark", fr(L * i / nb, off + 0.02, zb), (fr.t3, fr.n3), (0.11, 0.04, ze - zb), faces=("+v", "+u", "-u"))
        if ze - zb > 1.6:
            tbox(G, M, "wood_dark", fr(L / 2, off + 0.02, zb + (ze - zb) * 0.55), (fr.t3, fr.n3), (L, 0.04, 0.09), faces=("+v", "top", "bot"))
    for u in (0.0, L):
        tbox(G, M, "wood_dark", fr(u, off, zlow), (fr.t3, fr.n3), (0.14, 0.16, ze - zlow), faces=("+v", "+u", "-u"))
    G.walls.append((fr(0, 0, 0), fr(L, 0, 0), zlow + 0.3, ze))


def gable_skin(G, M, site, sd, plaster="plaster_white", off=0.05):
    """The gable walls of a building's roof mesh (what is not roof and stands upright), in plaster."""
    got = site.roof(sd)
    if not got:
        return
    P, tri, nr = got
    s = tex_scale(plaster, M)
    g = G.part(plaster)
    c0 = np.r_[np.asarray(sd["ring"]).mean(0), 0]
    for a, b, c in tri[nr:]:
        if len({a, b, c}) < 3:
            continue
        p = P[[a, b, c]]
        n = np.cross(p[1] - p[0], p[2] - p[0])
        if np.linalg.norm(n) < 1e-3:
            continue
        n = K.unit(n)
        if abs(n[2]) > 0.3:
            continue   # (a soffit)
        if n[:2] @ (p.mean(0) - c0)[:2] < 0:
            n, p = -n, p[::-1]
        if not site.seen(p.mean(0) + n * 0.4, skip=sd["si"]):
            continue
        eh = np.cross(UP, n)
        base = len(g["p"])
        for q in p:
            g["p"].append(q + n * off); g["n"].append(n); g["uv"].append((float(q @ eh) / s, q[2] / s)); g["ao"].append(1.0)
        g["tri"].append((base, base + 1, base + 2))


# ---------------------------------------------------------------- the atlas' drawings

def _d(img, r):
    from PIL import ImageDraw
    return ImageDraw.Draw(img), r[0], r[1], r[2], r[3]


def draw_shoji(lit=True, cols=4, rows=6):
    """Paper behind a lattice: warm where a room is lit, with the frame's shadow lines."""
    def draw(img, r):
        d, x, y, w, h = _d(img, r)
        for j in range(h):
            k = j / h
            c = (int(236 - 40 * k), int(206 - 58 * k), int(150 - 62 * k)) if lit else (int(150 - 20 * k), int(142 - 22 * k), int(124 - 22 * k))
            d.line([(x, y + j), (x + w, y + j)], fill=c)
        for i in range(1, cols):
            d.line([(x + w * i // cols, y), (x + w * i // cols, y + h)], fill=(70, 46, 28), width=2)
        for j in range(1, rows):
            d.line([(x, y + h * j // rows), (x + w, y + h * j // rows)], fill=(70, 46, 28), width=2)
    return draw


def draw_interior(rng, kind):
    """A shop seen through its window: shelves of pottery, sweets in boxes, fans, cloth, under warm lamps."""
    PAL = [["#3b6ea5", "#e8e2d2", "#8fb3c9", "#27456e"], ["#c9a25a", "#7a4a2a", "#e6d2a8", "#a8562e"],
           ["#b23a48", "#f1c7b6", "#e9b44c", "#6d2e46"], ["#5a7a4c", "#c8d6a2", "#e6dfc6", "#34503a"]]
    def draw(img, r):
        d, x, y, w, h = _d(img, r)
        for j in range(h):
            k = j / h
            d.line([(x, y + j), (x + w, y + j)], fill=(int(96 - 50 * k), int(64 - 36 * k), int(36 - 22 * k)))
        pal = PAL[kind % len(PAL)]
        rows = 3
        for s in range(rows):
            sy = y + int(h * (0.22 + 0.24 * s))
            d.rectangle([x, sy, x + w, sy + 4], fill=(52, 32, 18))
            px = x + 6
            while px < x + w - 10:
                bw, bh = int(rng.integers(10, 26)), int(rng.integers(12, int(h * 0.19)))
                c = ad.rgb(pal[int(rng.integers(len(pal)))])
                if rng.random() < 0.5:
                    d.ellipse([px, sy - bh, px + bw, sy], fill=c)
                else:
                    d.rectangle([px, sy - bh, px + bw, sy], fill=c)
                px += bw + int(rng.integers(4, 12))
        for i in range(3):   # the lamps' pools
            cx = x + int(w * (0.2 + 0.3 * i))
            ad.blob(img, (cx, y + int(h * 0.06)), int(h * 0.3), "#ffd9a0", 0.55)
        d.rectangle([x, y + h - int(h * 0.12), x + w, y + h], fill=(38, 24, 15))
        from PIL import ImageFilter, ImageEnhance
        c = img.crop((x, y, x + w, y + h)).filter(ImageFilter.GaussianBlur(1.6))   # (behind glass, out of focus)
        img.paste(ImageEnhance.Color(c).enhance(0.7), (x, y))
    return draw


def draw_noren(cloth, words, ink, panels=3):
    """A noren: dyed cloth in panels, the shop's words reserved in white (or dyed dark on pale cloth)."""
    def draw(img, r):
        d, x, y, w, h = _d(img, r)
        d.rectangle([x, y, x + w, y + h], fill=cloth)
        rng = np.random.default_rng(len(words) * 7 + cloth[0])
        for _ in range(60):   # the weave's unevenness
            yy = y + int(rng.integers(h))
            k = int(rng.integers(-7, 8))
            d.line([(x, yy), (x + w, yy)], fill=tuple(int(np.clip(c + k, 0, 255)) for c in cloth))
        n = len(words)
        for i, ch in enumerate(words):
            ad.text(img, (x + int(w * (i + 0.5) / n), y + int(h * 0.52)), ch, "mincho", int(min(h * 0.62, w / n * 0.8)), fill="#%02x%02x%02x" % tuple(ink))
        for i in range(1, panels):
            d.line([(x + w * i // panels, y + int(h * 0.3)), (x + w * i // panels, y + h)], fill=(12, 10, 10), width=2)
        d.rectangle([x, y, x + w, y + 3], fill=tuple(int(c * 0.6) for c in cloth))
    return draw


def draw_paper(words, ink=(30, 24, 20), paper=(240, 226, 196), face="mincho", crest=None, frame=(52, 34, 22)):
    """A lantern's paper with its words down it (an andon, a chochin's face)."""
    def draw(img, r):
        d, x, y, w, h = _d(img, r)
        for j in range(h):
            k = abs(j / h - 0.55)
            d.line([(x, y + j), (x + w, y + j)], fill=tuple(int(c * (1.0 - 0.35 * k)) for c in paper))
        if frame:
            d.rectangle([x, y, x + w - 1, y + h - 1], outline=frame, width=max(2, w // 24))
        n = len(words)
        size = int(min(w * 0.62, h * 0.8 / max(n, 1)))
        for i, ch in enumerate(words):
            ad.text(img, (x + w // 2, y + int(h * (0.12 + 0.76 * (i + 0.5) / n))), ch, face, size, fill="#%02x%02x%02x" % tuple(ink))
        if crest:
            d.ellipse([x + w * 0.3, y + h * 0.04, x + w * 0.7, y + h * 0.04 + w * 0.4], outline=crest, width=3)
    return draw


def draw_board(words, ground=(54, 36, 22), ink=(214, 180, 96), face="mincho", vertical=False, border=None):
    """A wooden name board, its words cut in and gilded (a shop's kanban, a torii's plaque)."""
    def draw(img, r):
        d, x, y, w, h = _d(img, r)
        d.rectangle([x, y, x + w, y + h], fill=ground)
        rng = np.random.default_rng(len(words) + ground[0])
        for _ in range(40):
            a = int(rng.integers(h if not vertical else w))
            k = int(rng.integers(-9, 9))
            c = tuple(int(np.clip(v + k, 0, 255)) for v in ground)
            d.line([(x, y + a), (x + w, y + a)] if not vertical else [(x + a, y), (x + a, y + h)], fill=c)
        if border:
            d.rectangle([x + 2, y + 2, x + w - 3, y + h - 3], outline=border, width=max(3, min(w, h) // 16))
        n = len(words)
        fill = "#%02x%02x%02x" % tuple(ink)
        if vertical:
            size = int(min(w * 0.7, h * 0.86 / n))
            for i, ch in enumerate(words):
                ad.text(img, (x + w // 2, y + int(h * (0.07 + 0.86 * (i + 0.5) / n))), ch, face, size, fill=fill)
        else:
            size = int(min(h * 0.7, w * 0.86 / n))
            for i, ch in enumerate(words):
                ad.text(img, (x + int(w * (0.07 + 0.86 * (i + 0.5) / n)), y + h // 2), ch, face, size, fill=fill)
    return draw


def draw_mushiko(plaster=(214, 208, 192)):
    """A mushiko-mado: the upper floor's low window, slits between plastered bars."""
    def draw(img, r):
        d, x, y, w, h = _d(img, r)
        d.rectangle([x, y, x + w, y + h], fill=plaster)
        n = max(6, w // 22)
        for i in range(n):
            cx = x + int(w * (i + 0.5) / n)
            sw = max(3, w // n // 3)
            d.rounded_rectangle([cx - sw, y + int(h * 0.14), cx + sw, y + int(h * 0.86)], radius=sw, fill=(26, 22, 20))
        d.rounded_rectangle([x + 2, y + 2, x + w - 3, y + h - 3], radius=h // 5, outline=tuple(int(c * 0.82) for c in plaster), width=4)
    return draw


def draw_sudare():
    """A bamboo blind: fine reeds, their binding threads, a cloth edge."""
    def draw(img, r):
        d, x, y, w, h = _d(img, r)
        rng = np.random.default_rng(5)
        for j in range(0, h, 2):
            k = int(rng.integers(-14, 14))
            d.line([(x, y + j), (x + w, y + j)], fill=(176 + k, 150 + k, 96 + k))
            d.line([(x, y + j + 1), (x + w, y + j + 1)], fill=(120 + k, 98 + k, 58 + k))
        for i in range(1, 6):
            d.line([(x + w * i // 6, y), (x + w * i // 6, y + h)], fill=(64, 50, 34), width=2)
        d.rectangle([x, y, x + w, y + int(h * 0.05)], fill=(48, 62, 54))
    return draw


def draw_door(lit=True):
    """A sliding lattice door (koshi-do): fine bars over paper above a boarded foot."""
    def draw(img, r):
        d, x, y, w, h = _d(img, r)
        d.rectangle([x, y, x + w, y + h], fill=(196, 160, 100) if lit else (92, 84, 70))
        for i in range(0, w, 7):
            d.rectangle([x + i, y, x + i + 2, y + h], fill=(40, 28, 20))
        for j in (0.0, 0.33, 0.66):
            d.rectangle([x, y + int(h * j), x + w, y + int(h * j) + 4], fill=(34, 24, 17))
        d.rectangle([x, y + int(h * 0.72), x + w, y + h], fill=(46, 33, 24))
        for i in (0, w // 2 - 3, w - 6):
            d.rectangle([x + i, y, x + i + 6, y + h], fill=(30, 21, 15))
    return draw


def draw_lid(kind="gutter"):
    def draw(img, r):
        d, x, y, w, h = _d(img, r)
        d.rectangle([x, y, x + w, y + h], fill=(118, 114, 106))
        rng = np.random.default_rng(3)
        for _ in range(w * h // 30):
            px, py = x + int(rng.integers(w)), y + int(rng.integers(h))
            k = int(rng.integers(-22, 22))
            d.point((px, py), fill=(118 + k, 114 + k, 106 + k))
        if kind == "gutter":
            n = max(2, w // 64)
            for i in range(n):
                x0 = x + w * i // n
                d.line([(x0, y), (x0, y + h)], fill=(60, 58, 54), width=2)
                d.rounded_rectangle([x0 + w // n * 0.4, y + h * 0.3, x0 + w // n * 0.6, y + h * 0.7], radius=3, fill=(24, 24, 24))
        else:
            d.ellipse([x + 2, y + 2, x + w - 3, y + h - 3], fill=(58, 54, 50), outline=(34, 32, 30), width=4)
            for i in range(-6, 7):
                d.line([(x + w / 2 + i * w / 14, y + h * 0.12), (x + w / 2 + i * w / 14, y + h * 0.88)], fill=(78, 73, 66), width=2)
                d.line([(x + w * 0.12, y + h / 2 + i * h / 14), (x + w * 0.88, y + h / 2 + i * h / 14)], fill=(42, 40, 37), width=2)
            d.ellipse([x + w * 0.36, y + h * 0.36, x + w * 0.64, y + h * 0.64], fill=(66, 61, 55), outline=(34, 32, 30), width=3)
    return draw


NOREN = [  # cloth, words, ink
    ((34, 46, 78), "清水焼", (238, 232, 218)), ((96, 58, 38), "甘味処", (240, 230, 210)), ((232, 226, 210), "八ツ橋", (40, 34, 30)),
    ((150, 38, 30), "七味", (246, 236, 214)), ((52, 78, 58), "抹茶", (240, 234, 216)), ((30, 28, 28), "京扇子", (226, 196, 120)),
    ((60, 92, 128), "湯豆腐", (238, 232, 218)), ((168, 120, 52), "漬物", (36, 28, 22)), ((220, 214, 196), "珈琲", (60, 44, 36)),
    ((70, 44, 84), "着物", (236, 226, 232)),
]


def cells(A, rng):
    """The drawn cells a lane's fronts share."""
    A.cell("shoji", 192, 256, draw_shoji(True))
    A.cell("shoji_dark", 192, 256, draw_shoji(False))
    A.cell("door", 256, 384, draw_door(True))
    A.cell("door_dark", 256, 384, draw_door(False))
    for i in range(6):
        A.cell(f"int{i}", 384, 256, draw_interior(np.random.default_rng(40 + i), i))
    for i, (cloth, words, ink) in enumerate(NOREN):
        A.cell(f"noren{i}", 320, 160, draw_noren(cloth, words, ink))
        A.cell(f"andon{i}", 80, 200, draw_paper(words))
        A.cell(f"board{i}", 256, 80, draw_board(words))
    A.cell("mushiko", 320, 110, draw_mushiko())
    A.cell("sudare", 256, 256, draw_sudare())
    A.cell("gutter", 256, 64, draw_lid("gutter"))
    A.cell("manhole", 160, 160, draw_lid("manhole"))


# ---------------------------------------------------------------- a town house's front

def hisashi(G, M, fr, u0, u1, z, depth=0.85, drop=0.3, v0=0.1, rafters=True):
    """A pent roof in tile along a front from u0 to u1, its upper edge at z on the wall: tiles, a boarded
    soffit on rafters, the eave's round tiles."""
    a, b = fr(u0, v0, z), fr(u1, v0, z)
    c, d = fr(u1, v0 + depth, z - drop), fr(u0, v0 + depth, z - drop)
    s = tex_scale("roof_kawara", M)
    L = u1 - u0
    sl = math.hypot(depth, drop)
    G.quad("roof_kawara", d, c, b, a, uv=[(0, 0), (L / s, 0), (L / s, sl / s), (0, sl / s)])
    tq(G, M, "wood_dark", a - [0, 0, 0.07], b - [0, 0, 0.07], c - [0, 0, 0.07], d - [0, 0, 0.07], ao=0.6)
    tq(G, M, "wood_dark", d - [0, 0, 0.1], c - [0, 0, 0.1], c, d)
    for u, sgn in ((u0, -1), (u1, 1)):   # the ends
        G.quad("wood_dark", fr(u, v0, z - 0.07), fr(u, v0 + depth, z - drop - 0.07), fr(u, v0 + depth, z - drop), fr(u, v0, z), n=fr.t3 * sgn)
    eave_tiles(G, d, c, fr.n3)
    if rafters:
        n = max(2, int(L / 0.36))
        for i in range(n + 1):
            u = u0 + 0.04 + (L - 0.08) * i / n
            G.box("wood_dark_fine", fr(u, v0 + depth / 2, z - drop / 2 - 0.16), (fr.t3, K.unit(fr.n3 * depth - UP * drop)), (0.045, sl, 0.07), faces=("+u", "-u", "bot"))


def koshi(G, M, fr, u0, u1, z0, z1, v=0.1, pitch=0.085, bar=0.03):
    """A lattice: upright bars over three rails."""
    n = max(2, int((u1 - u0) / pitch))
    for i in range(n):
        u = u0 + (u1 - u0) * (i + 0.5) / n
        tbox(G, M, "wood_dark_fine", fr(u, v, z0), (fr.t3, fr.n3), (bar, 0.035, z1 - z0), faces=("+v", "+u", "-u"))
    for k in (0.04, 0.5, 0.96):
        tbox(G, M, "wood_dark", fr((u0 + u1) / 2, v - 0.03, z0 + (z1 - z0) * k - 0.02), (fr.t3, fr.n3), (u1 - u0, 0.03, 0.04), faces=("+v", "top", "bot"))


def noren(G, A, fr, uc, w, z_top, key, rng, drop=0.85, v=0.3, panels=3):
    """A noren on its rod, in panels that hang a little apart."""
    G.tube("wood_bare", [fr(uc - w / 2 - 0.12, v, z_top), fr(uc + w / 2 + 0.12, v, z_top)], 0.016, 6)
    for i in range(panels):
        u0, u1 = uc - w / 2 + w * i / panels + 0.006, uc - w / 2 + w * (i + 1) / panels - 0.006
        sway = (rng.random() - 0.5) * 0.09
        q = A.sub(key, i, panels, axis="u")
        mid = [(q[0][0], (q[0][1] + q[3][1]) / 2), (q[1][0], (q[1][1] + q[2][1]) / 2)]
        G.quad("cloth", fr(u0, v + sway * 0.5, z_top - drop / 2), fr(u1, v + sway * 0.5, z_top - drop / 2), fr(u1, v, z_top - 0.01), fr(u0, v, z_top - 0.01),
               uv=[mid[0], mid[1], q[2], q[3]])
        G.quad("cloth", fr(u0, v + sway, z_top - drop), fr(u1, v + sway, z_top - drop), fr(u1, v + sway * 0.5, z_top - drop / 2), fr(u0, v + sway * 0.5, z_top - drop / 2),
               uv=[q[0], q[1], mid[1], mid[0]])


def andon(G, A, c, ax, key, w=0.24, h=0.56, k=5.0):
    """A paper box lantern with the shop's name down it, at c (its foot's centre)."""
    c = np.asarray(c, float)
    t, n = K.unit(np.r_[np.asarray(ax[0])[:2], 0]), K.unit(np.r_[np.asarray(ax[1])[:2], 0])
    uv = A.uv(key)
    for d, e in ((n, t), (-n, -t), (t, -n), (-t, n)):
        p = c + d * w / 2
        G.quad("lamp_andon", p - e * w / 2, p + e * w / 2, p + e * w / 2 + [0, 0, h], p - e * w / 2 + [0, 0, h], uv=uv, n=d,
               emit=((WARM[0], WARM[1], WARM[2]), k))
    G.box("wood_dark", c - [0, 0, 0.03], (t, n), (w + 0.05, w + 0.05, 0.03))
    G.box("wood_dark", c + [0, 0, h], (t, n), (w + 0.09, w + 0.09, 0.035))


def chochin(G, c, r=0.17, h=0.46, mat="lamp_paper", k=4.0):
    """A round paper lantern hung at c (its top)."""
    c = np.asarray(c, float)
    prof = [(r * 0.45, -h)] + [(r * math.sin(a) ** 0.8 if 0 < a < math.pi else r * 0.45, -h / 2 - math.cos(math.pi - a) * h * 0.44) for a in np.linspace(0.5, math.pi - 0.5, 6)] + [(r * 0.45, 0)]
    lathe(G, mat, c, prof, 10)
    lathe(G, "black_lacquer", c, [(r * 0.47, -h - 0.03), (r * 0.47, -h + 0.01)], 10)
    lathe(G, "black_lacquer", c, [(r * 0.47, -0.01), (r * 0.47, 0.03)], 10)
    light(G, c - [0, 0, h / 2], WARM if mat == "lamp_paper" else (1.0, 0.2, 0.08), k)


def machiya(G, M, A, fr, zlow, zf, ze, rng, plaster="plaster_white", shop=0.6, name=None):
    """A town house's front on the frame fr (a wall of the city's building), from the ground zlow (the lowest
    under it) and its floor zf to its eave ze. Returns what stands at its door, for the level's props."""
    L, t, n = fr.L, fr.t3, fr.n3
    two = ze - zf > 4.3
    z1 = zf + 2.5 if two else max(zf + 2.1, min(ze - 0.2, zf + 2.6))
    S = 0.1
    # the stone footing, and the gutter's lids along it
    tbox(G, M, "stone", fr(L / 2, 0.1, zlow), (t, n), (L + 0.02, 0.2, zf - zlow), faces=("+v", "top", "+u", "-u"))
    G.walls.append((fr(0, 0.2, 0), fr(L, 0.2, 0), zf, ze))
    nb = max(1, int(round(L / 1.9)))
    bw = L / nb
    for i in range(nb + 1):   # the posts
        tbox(G, M, "wood_dark", fr(i * bw, S, zf), (t, n), (0.13, 0.15, ze - zf), faces=("+v", "+u", "-u"))
    tbox(G, M, "wood_dark", fr(L / 2, S, z1 - 0.2), (t, n), (L, 0.13, 0.2), faces=("+v", "top", "bot"))
    tbox(G, M, "wood_dark", fr(L / 2, S, zf), (t, n), (L, 0.13, 0.09), faces=("+v", "top"))
    # the bays of the ground floor
    kinds = [("shop" if rng.random() < shop else "koshi") if rng.random() < 0.8 else "wall" for _ in range(nb)]
    door = int(rng.integers(nb))
    kinds[door] = "door"
    ni = int(rng.integers(len(NOREN))) if name is None else name
    out = {"door": fr((door + 0.5) * bw, 0.5, zf), "name": ni, "t": t, "n": n}
    zt = z1 - 0.2
    for i, kd in enumerate(kinds):
        u0, u1 = i * bw + 0.065, (i + 1) * bw - 0.065
        lit = rng.random() < 0.8
        if kd == "door":
            G.quad("paper_shoji", fr(u0, 0.05, zf + 0.09), fr(u1, 0.05, zf + 0.09), fr(u1, 0.05, zt), fr(u0, 0.05, zt), uv=A.uv("door" if lit else "door_dark"),
                   emit=((WARM[0], WARM[1], WARM[2]), 1.3) if lit else None)
            noren(G, A, fr, (u0 + u1) / 2, min(u1 - u0 - 0.1, 1.7), zt - 0.04, f"noren{ni}", rng)
            G.box("stone", fr((u0 + u1) / 2, 0.42, zlow), (t, n), (u1 - u0, 0.5, zf - zlow - 0.04), faces=("+v", "top", "+u", "-u"))   # the step
        elif kd == "shop":
            zs = zf + 0.55
            tbox(G, M, "wood_board", fr((u0 + u1) / 2, 0.07, zf + 0.09), (t, n), (u1 - u0, 0.05, zs - zf - 0.09), faces=("+v",))
            ik = f"int{int(rng.integers(6))}"
            G.quad("glow_shop", fr(u0, 0.05, zs), fr(u1, 0.05, zs), fr(u1, 0.05, zt), fr(u0, 0.05, zt), uv=A.uv(ik), emit=(A.mean[ik], 2.2))
            tbox(G, M, "wood_dark", fr((u0 + u1) / 2, S, zs - 0.04), (t, n), (u1 - u0, 0.1, 0.06), faces=("+v", "top"))
            tbox(G, M, "wood_dark_fine", fr((u0 + u1) / 2, S, zs), (t, n), (0.04, 0.05, zt - zs), faces=("+v", "+u", "-u"))
        elif kd == "koshi":
            G.quad("paper_shoji", fr(u0, 0.04, zf + 0.09), fr(u1, 0.04, zf + 0.09), fr(u1, 0.04, zt), fr(u0, 0.04, zt), uv=A.uv("shoji" if lit else "shoji_dark"),
                   emit=((WARM[0], WARM[1], WARM[2]), 0.8) if lit else None)
            koshi(G, M, fr, u0, u1, zf + 0.09, zt)
        else:
            tq(G, M, plaster, fr(u0, 0.05, zf + 0.9), fr(u1, 0.05, zf + 0.9), fr(u1, 0.05, zt), fr(u0, 0.05, zt))
            tq(G, M, "wood_board", fr(u0, 0.06, zf + 0.09), fr(u1, 0.06, zf + 0.09), fr(u1, 0.06, zf + 0.9), fr(u0, 0.06, zf + 0.9), rot=True)
        if kd in ("koshi", "wall") and rng.random() < 0.6:   # the bamboo guard, curving from the wall to the ground
            pr = [(0.12 + 0.5 * math.sin(a), 0.92 * math.cos(a)) for a in np.linspace(0, math.pi / 2, 6)]
            s = tex_scale("bamboo", M)
            for (va, za), (vb, zb) in zip(pr, pr[1:]):
                G.quad("bamboo", fr(u0, vb, zf + zb), fr(u1, vb, zf + zb), fr(u1, va, zf + za), fr(u0, va, zf + za),
                       uv=[(0, zb / s), ((u1 - u0) / s, zb / s), ((u1 - u0) / s, za / s), (0, za / s)])
    # the pent roof over the ground floor, and the floor above
    if two:
        hisashi(G, M, fr, -0.1, L + 0.1, z1 + 0.32)
        zu = z1 + 0.36
        tq(G, M, plaster, fr(0, 0.06, zu), fr(L, 0.06, zu), fr(L, 0.06, ze), fr(0, 0.06, ze))
        hw = min(1.15, (ze - zu) * 0.55)
        zw = zu + (ze - zu) * 0.3
        for i in range(nb):
            u0, u1 = i * bw + 0.3, (i + 1) * bw - 0.3
            r = rng.random()
            if r < 0.4:
                G.quad("sign", fr(u0, 0.075, zw), fr(u1, 0.075, zw), fr(u1, 0.075, zw + hw * 0.6), fr(u0, 0.075, zw + hw * 0.6), uv=A.uv("mushiko"))
            elif r < 0.85:
                lit = rng.random() < 0.55
                G.quad("paper_shoji", fr(u0, 0.07, zw), fr(u1, 0.07, zw), fr(u1, 0.07, zw + hw), fr(u0, 0.07, zw + hw), uv=A.uv("shoji" if lit else "shoji_dark"),
                       emit=((WARM[0], WARM[1], WARM[2]), 0.5) if lit else None)
                koshi(G, M, fr, u0, u1, zw, zw + hw, v=0.115, pitch=0.11)
                tbox(G, M, "wood_dark", fr((u0 + u1) / 2, 0.1, zw - 0.06), (t, n), (u1 - u0 + 0.12, 0.12, 0.06), faces=("+v", "top", "bot", "+u", "-u"))
                if rng.random() < 0.4:
                    G.quad("sign", fr(u0, 0.17, zw + hw * 0.35), fr(u1, 0.17, zw + hw * 0.35), fr(u1, 0.15, zw + hw + 0.05), fr(u0, 0.15, zw + hw + 0.05), uv=A.uv("sudare"))
    else:
        hisashi(G, M, fr, -0.1, L + 0.1, min(ze, z1 + 0.32), depth=0.7, drop=0.24)
    # the shop's board over the door, its lantern beside it, the rain pipe at one end
    if L > 3.0:
        ub = (door + 0.5) * bw
        G.quad("sign", fr(ub - 0.62, 0.2, z1 - 0.17), fr(ub + 0.62, 0.2, z1 - 0.17), fr(ub + 0.62, 0.17, z1 + 0.2), fr(ub - 0.62, 0.17, z1 + 0.2), uv=A.uv(f"board{ni}"))
    ul = door * bw + (0.0 if door > 0 else bw)
    if rng.random() < 0.75:
        G.box("iron", fr(ul, 0.3, zf + 2.02), (t, n), (0.025, 0.4, 0.025))
        andon(G, A, fr(ul, 0.5, zf + 1.42), (t, n), f"andon{ni}")
    else:
        G.box("iron", fr(ul, 0.3, zf + 2.2), (t, n), (0.025, 0.4, 0.025))
        chochin(G, fr(ul, 0.5, zf + 2.2), mat="lamp_red" if rng.random() < 0.5 else "lamp_paper")
    G.tube("copper", [fr(0.1, 0.24, zlow + 0.1), fr(0.1, 0.24, ze - 0.2)], 0.04, 6)
    return out


# ---------------------------------------------------------------- what stands on a street or an approach

def beam(G, M, mat, c, t, n, length, w, h, rise=0.0, segs=1, splay=0.0, faces=None):
    """A beam centred on c (its underside's middle) along t, w deep along n and h high; with rise, its ends
    curve up (a torii's kasagi) in `segs` pieces a side; with splay, its ends are cut slanting outward."""
    c, t, n = np.asarray(c, float), np.asarray(t, float), np.asarray(n, float)
    us = np.linspace(-length / 2, length / 2, 2 * segs + 1)
    sec = []
    for u in us:
        dz = rise * (abs(u) / (length / 2)) ** 2.2
        ut = u + np.sign(u) * splay * (abs(u) >= length / 2 - 1e-6)   # (the top's end, cut slanting)
        sec.append([c + t * u - n * w / 2 + UP * dz, c + t * u + n * w / 2 + UP * dz,
                    c + t * ut + n * w / 2 + UP * (dz + h), c + t * ut - n * w / 2 + UP * (dz + h)])
    for a, b in zip(sec, sec[1:]):
        for i, j, nn in ((1, 2, n), (3, 0, -n), (2, 3, UP), (0, 1, -UP)):
            if i == 1:
                q = (a[1], b[1], b[2], a[2])
            elif i == 3:
                q = (b[0], a[0], a[3], b[3])
            elif i == 2:
                q = (a[2], b[2], b[3], a[3])
            else:
                q = (b[0], b[1], a[1], a[0])
            tq(G, M, mat, *q) if mat in M and M[mat].get("tex") else G.quad(mat, *q)
    for s_, e in ((sec[0], -t), (sec[-1], t)):
        q = (s_[0], s_[1], s_[2], s_[3]) if e @ t > 0 else (s_[1], s_[0], s_[3], s_[2])
        G.quad(mat, *q, n=e)


def torii(G, M, A, c, t, zg, width, height, post_r=0.45, plaque=None, lit=True, drum=False):
    """A vermilion myojin torii of the Inari kind at c, its beams along t (a horizontal unit vector): posts on
    stone drums with black feet (nemaki) and ring caps (daiwa), the tie beam (nuki) through them with its wedges,
    the lintels (shimaki under kasagi) curving up to their ends, the kasagi's top black, a plaque between."""
    t = K.unit(np.r_[np.asarray(t, float)[:2], 0]); n = np.array([-t[1], t[0], 0])
    c = np.array([c[0], c[1], zg])
    H = height
    z_nuki = H * 0.72
    z_shim = H * 0.875
    for s in (-1, 1):
        p = c + t * s * width / 2
        if drum:
            lathe(G, "stone", p, [(post_r * 1.75, -0.4), (post_r * 1.75, 0.16), (post_r * 1.45, 0.34), (post_r * 1.12, 0.36)], 20)
        lathe(G, "black_lacquer", p, [(post_r * 1.1, -0.3 if not drum else 0.34), (post_r * 1.08, 1.15), (post_r * 1.0, 1.16)], 20)
        lathe(G, "wood_shu", p, [(post_r * (1 - 0.07 * k / 8), 1.15 + (z_shim - 1.41) * k / 8) for k in range(9)], 20)
        lathe(G, "black_lacquer", p, [(post_r * 0.95, z_shim - 0.27), (post_r * 1.28, z_shim - 0.24), (post_r * 1.28, z_shim - 0.02), (post_r * 0.9, z_shim)], 20)
        for sn in (-1, 1):   # the wedges where the tie beam passes through
            tbox(G, M, "wood_shu", p + t * sn * (post_r + 0.12) + UP * (z_nuki + H * 0.062), (t, n), (0.3, post_r * 0.5, 0.09))
        if lit:   # a floodlight at the foot of each post, turned up at it
            for sn in (-1, 1):
                q = p + n * sn * 2.2 - t * s * 0.5
                G.box("iron", q, (t, n), (0.3, 0.22, 0.2))
                for k in range(5):
                    d = K.unit(p + UP * H * (0.45 + 0.12 * k) - t * s * width * 0.1 * k - q)
                    G.emitters.append((q + UP * 0.25, d, 0.5, np.array([1.0, 0.8, 0.58]) * (90.0 * (0.4 + 0.15 * k))))
    beam(G, M, "wood_shu", c + UP * z_nuki, t, n, width * 1.2, post_r * 0.62, H * 0.062)
    beam(G, M, "wood_shu", c + UP * z_shim, t, n, width * 1.3, post_r * 1.0, H * 0.055, rise=H * 0.035, segs=6)
    beam(G, M, "wood_shu", c + UP * (z_shim + H * 0.055), t, n, width * 1.38, post_r * 1.3, H * 0.06, rise=H * 0.04, segs=6, splay=H * 0.02)
    beam(G, M, "black_lacquer", c + UP * (z_shim + H * 0.115), t, n, width * 1.39 + H * 0.04, post_r * 1.5, H * 0.012, rise=H * 0.041, segs=6)
    # the strut and the plaque
    zs0, zs1 = z_nuki + H * 0.062, z_shim
    tbox(G, M, "wood_shu", c + UP * zs0, (t, n), (post_r * 0.7, post_r * 0.5, zs1 - zs0))
    if plaque:
        pw, ph = (zs1 - zs0) * 0.62, (zs1 - zs0) * 0.92
        for sn in (-1, 1):
            o = c + n * sn * (post_r * 0.25 + 0.06) + UP * (zs0 + (zs1 - zs0) * 0.04)
            e = t * -sn
            G.quad("sign", o - e * pw / 2, o + e * pw / 2, o + e * pw / 2 + UP * ph, o - e * pw / 2 + UP * ph, uv=A.uv(plaque), n=n * sn)


def stone_lantern(G, M, c, zg, h=2.3, mat="stone", k=3.0, heading=0.0, pool=14.0):
    """A stone lantern (kasuga-doro): a hexagonal base and platform, a round shaft with its ring, the fire
    box with lit paper windows, the roof with its upturned corners and the jewel."""
    c = np.array([c[0], c[1], zg])
    s = h / 2.3
    ph = heading + math.pi / 6
    lathe(G, mat, c, [(0.46 * s, -0.3), (0.46 * s, 0.14 * s), (0.36 * s, 0.26 * s), (0.2 * s, 0.3 * s)], 6, phase=ph)
    lathe(G, mat, c, [(0.14 * s, 0.3 * s), (0.13 * s, 0.72 * s), (0.17 * s, 0.75 * s), (0.17 * s, 0.8 * s), (0.13 * s, 0.83 * s), (0.125 * s, 1.22 * s)], 12)
    lathe(G, mat, c, [(0.13 * s, 1.22 * s), (0.36 * s, 1.34 * s), (0.36 * s, 1.42 * s), (0.2 * s, 1.43 * s)], 6, phase=ph)
    z0, z1 = 1.43 * s, 1.8 * s
    r = 0.21 * s
    for i in range(6):
        a0, a1 = ph + i * math.pi / 3, ph + (i + 1) * math.pi / 3
        p0, p1 = c + [r * math.cos(a0), r * math.sin(a0), 0], c + [r * math.cos(a1), r * math.sin(a1), 0]
        nn = K.unit((p0 + p1) / 2 - c)
        nn[2] = 0
        if i % 2 == 0:
            G.quad("lamp_paper", p0 + UP * (z0 + 0.04), p1 + UP * (z0 + 0.04), p1 + UP * (z1 - 0.04), p0 + UP * (z1 - 0.04), n=nn, emit=(WARM, k))
            for q in (p0, p1):
                G.box(mat, q + UP * z0, (K.unit(p1 - p0), nn), (0.035 * s, 0.035 * s, z1 - z0))
        else:
            tq(G, M, mat, p0 + UP * z0, p1 + UP * z0, p1 + UP * z1, p0 + UP * z1)
    lathe(G, mat, c, [(0.2 * s, 1.8 * s), (0.5 * s, 1.84 * s), (0.52 * s, 1.9 * s), (0.3 * s, 2.0 * s), (0.12 * s, 2.1 * s), (0.07 * s, 2.12 * s)], 6, phase=ph)
    lathe(G, mat, c, [(0.07 * s, 2.12 * s), (0.11 * s, 2.18 * s), (0.08 * s, 2.25 * s), (0.0, 2.3 * s)], 8)
    light(G, c + UP * 1.62 * s, WARM, pool, area=0.08)   # the pool of light it throws round its foot


def tamagaki(G, M, a, b, zf, h=1.25, pitch=0.42, names=None, A=None, face=None):
    """A shrine's stone fence from a to b: square posts under a rail, a taller pillar every few metres
    (with a donor's name on the side `face` points to, drawn in the atlas)."""
    a, b = np.asarray(a, float)[:2], np.asarray(b, float)[:2]
    L = np.linalg.norm(b - a)
    t = np.r_[(b - a) / L, 0]; n = np.array([-t[1], t[0], 0])
    if face is not None and n[:2] @ np.asarray(face, float)[:2] < 0:
        n = -n
    k = max(1, int(L / pitch))
    for i in range(k + 1):
        p = a + (b - a) * i / k
        z = zf(*p)
        big = i % 7 == 0
        w, hh = (0.24, h + 0.25) if big else (0.15, h)
        tbox(G, M, "stone", np.array([p[0], p[1], z - 0.15]), (t, n), (w, w, hh + 0.15), faces=("+u", "-u", "+v", "-v", "top"))
        if big and names and A is not None:
            key = names[(i // 7) % len(names)]
            o = np.array([p[0], p[1], z]) + n * (w / 2 + 0.004)
            G.quad("sign", o - t * w * 0.42 + UP * 0.3, o + t * w * 0.42 + UP * 0.3, o + t * w * 0.42 + UP * (hh - 0.06), o - t * w * 0.42 + UP * (hh - 0.06), uv=A.uv(key), n=n)
    for i in range(k):
        p, q = a + (b - a) * i / k, a + (b - a) * (i + 1) / k
        for zr in (h - 0.22, 0.28):
            pa, qa = np.array([p[0], p[1], zf(*p) + zr]), np.array([q[0], q[1], zf(*q) + zr])
            for d0, d1, nn in ((n * 0.05, n * 0.05 + UP * 0.1, n), (-n * 0.05 + UP * 0.1, -n * 0.05, -n), (n * 0.05 + UP * 0.1, -n * 0.05 + UP * 0.1, UP)):
                G.quad("stone", pa + d0, qa + d0, qa + d1, pa + d1, n=nn)
    G.walls.append((a, b, min(zf(*a), zf(*b)), min(zf(*a), zf(*b)) + h))


def nobori(G, A, c, zg, t, key, h=3.6, w=0.6, mat="wood_bare"):
    """A banner on its pole (nobori): cloth held by a top arm and loops down the pole."""
    c = np.array([c[0], c[1], zg])
    t = K.unit(np.r_[np.asarray(t, float)[:2], 0])
    G.tube(mat, [c - UP * 0.2, c + UP * (h + 0.25)], 0.022, 6)
    G.tube(mat, [c + UP * (h + 0.1), c + UP * (h + 0.1) + t * (w + 0.05)], 0.012, 5)
    n = np.array([-t[1], t[0], 0])
    k = 6
    for i in range(k):
        z0, z1 = 0.55 + (h - 0.5) * i / k, 0.55 + (h - 0.5) * (i + 1) / k
        s0, s1 = 0.05 * math.sin(i * 1.3), 0.05 * math.sin((i + 1) * 1.3)
        q = A.sub(key, k - 1 - i, k, axis="v")
        G.quad("cloth", c + t * 0.03 + UP * z0, c + t * (w + 0.03) + n * s0 + UP * z0, c + t * (w + 0.03) + n * s1 + UP * z1, c + t * 0.03 + UP * z1, uv=q)


def bench(G, M, c, zg, t, parasol=True):
    """A tea house's bench under red felt, and its red paper parasol (nodate-gasa)."""
    c = np.array([c[0], c[1], zg])
    t = K.unit(np.r_[np.asarray(t, float)[:2], 0]); n = np.array([-t[1], t[0], 0])
    G.box("felt_red", c + UP * 0.4, (t, n), (1.5, 0.52, 0.035))
    G.quad("felt_red", c + t * 0.75 + n * 0.26 + UP * 0.43, c + t * 0.75 - n * 0.26 + UP * 0.43, c + t * 0.75 - n * 0.26 + UP * 0.12, c + t * 0.75 + n * 0.26 + UP * 0.12, n=t)
    for su in (-0.6, 0.6):
        for sv in (-0.2, 0.2):
            tbox(G, M, "wood_dark", c + t * su + n * sv, (t, n), (0.06, 0.06, 0.4))
    if parasol:
        p = c - t * 1.05 + n * 0.1
        G.tube("wood_bare", [p, p + UP * 2.35], 0.02, 6)
        lathe(G, "felt_red", p, [(1.25, 2.02), (0.7, 2.2), (0.04, 2.36)], 18)
        for i in range(18):
            a = 2 * math.pi * i / 18
            G.tube("wood_bare", [p + UP * 2.34, p + [1.25 * math.cos(a), 1.25 * math.sin(a), 2.0]], 0.006, 3)


def bucket(G, c, zg):
    """A red fire bucket at a door."""
    lathe(G, "bucket_red", np.array([c[0], c[1], zg]), [(0.11, 0.0), (0.14, 0.26), (0.145, 0.27)], 10)
