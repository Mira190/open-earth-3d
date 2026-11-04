"""Parts for Japanese landmarks built in code: frames, boxes, frusta, temple roofs, lanterns, and an
image atlas for signs and lanterns drawn with open fonts.

Used by the Tokyo maps (cities/asakusa, cities/akihabara). The roof profile and the frame helpers
follow cities/shibuya/city.py (Suga Shrine), which has its own copies.
"""
import math
import os
import urllib.parse
import urllib.request

import numpy as np

from meshkit import Mesh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Google Fonts under the SIL Open Font License (downloaded once into data/raw/fonts)
FONTS = {
    "mincho": "ofl/shipporimincho/ShipporiMincho-Bold.ttf", "syuku": "ofl/yujisyuku/YujiSyuku-Regular.ttf",
    "rocknroll": "ofl/rocknrollone/RocknRollOne-Regular.ttf", "dot": "ofl/dotgothic16/DotGothic16-Regular.ttf",
    "dela": "ofl/delagothicone/DelaGothicOne-Regular.ttf", "zen": "ofl/zenkakugothicnew/ZenKakuGothicNew-Bold.ttf",
    "bebas": "ofl/bebasneue/BebasNeue-Regular.ttf", "reggae": "ofl/reggaeone/ReggaeOne-Regular.ttf",
    "kaisei": "ofl/kaiseidecol/KaiseiDecol-Bold.ttf", "mplus": "ofl/mplusrounded1c/MPLUSRounded1c-ExtraBold.ttf",
    # Latin capitals for lettering cast on a facade (archkit.letters): Roman capitals with a 1920s cut
    "cinzel": "ofl/cinzel/Cinzel[wght].ttf",
}
FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/{}"


def font(name, size):
    from PIL import ImageFont
    d = os.path.join(ROOT, "data", "raw", "fonts")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, os.path.basename(FONTS[name]))
    if not os.path.exists(path):
        urllib.request.urlretrieve(FONT_URL.format(urllib.parse.quote(FONTS[name])), path)
    return ImageFont.truetype(path, size)


FALLBACK = "zen"   # a face with kana and kanji, for the characters a Latin display face lacks
_COVERS = {}


def covers(fname, ch):
    """Whether the font draws the character (a missing one draws the same box as a private-use code point)."""
    k = (fname, ch)
    if k not in _COVERS:
        f = font(fname, 48)
        _COVERS[k] = ch.isspace() or bytes(f.getmask(ch)) != bytes(f.getmask("\U000F0000"))
    return _COVERS[k]


def runs(text, fname):
    """The text in runs of one font each: fname where it has the glyphs, FALLBACK where it has not."""
    out = []
    for ch in text:
        fn = fname if covers(fname, ch) else FALLBACK
        if out and out[-1][1] == fn:
            out[-1][0] += ch
        else:
            out.append([ch, fn])
    return out


def length(draw, text, fname, size):
    return sum(draw.textlength(t, font=font(fn, size)) for t, fn in runs(text, fname))


def text(draw, xy, words, fname, size, fill):
    """A line centred on xy, each character in a font that has it (no boxes for missing glyphs)."""
    x = xy[0] - length(draw, words, fname, size) / 2
    for t, fn in runs(words, fname):
        f = font(fn, size)
        draw.text((x, xy[1]), t, font=f, fill=fill, anchor="lm")
        x += draw.textlength(t, font=f)


def fit(draw, lines, fname, box_w, box_h, max_size=120):
    """The largest size at which the lines fit the box (with fallback glyphs measured as drawn)."""
    for size in range(max_size, 7, -1):
        if max(length(draw, t, fname, size) for t in lines) <= box_w and size * 1.18 * len(lines) <= box_h:
            return size
    return 8


def vertical(draw, text, cx, y0, y1, fname, fill, width):
    """Text set top to bottom, one character a line, as large as fits."""
    n = max(len(text), 1)
    size = max(int(min(width * 0.9, (y1 - y0) / n * 0.92)), 8)
    step = (y1 - y0) / n
    for k, ch in enumerate(text):
        draw.text((cx, y0 + step * (k + 0.5)), ch, font=font(fname if covers(fname, ch) else FALLBACK, size), fill=fill, anchor="mm")


# ---------------------------------------------------------------- geometry

def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) or 1.0)


def left_of(f):
    return np.array([-f[1], f[0]])


def frame(o, f):
    """(u, v, z) -> local point: u along the unit vector f from o, v to its left, z absolute."""
    o, f = np.asarray(o, float)[:2], unit(f)[:2]
    l = left_of(f)
    return lambda u, v, z: np.array([o[0] + f[0] * u + l[0] * v, o[1] + f[1] * u + l[1] * v, z])


def block(m, P, u0, u1, v0, v1, z0, z1):
    """A box in frame P, faces wound outward."""
    c = [P(u, v, z) for z in (z0, z1) for v in (v0, v1) for u in (u0, u1)]
    for a, b, cc, d in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
        m.quad(c[a], c[b], c[cc], c[d])


def slab_at(m, P, u, v, w, d, z0, z1):
    block(m, P, u - w / 2, u + w / 2, v - d / 2, v + d / 2, z0, z1)


def taper(m, P, u, v, w0, d0, z0, w1, d1, z1, top=True):
    """A frustum between two centred rectangles."""
    a = [P(u + sx * w0 / 2, v + sy * d0 / 2, z0) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    b = [P(u + sx * w1 / 2, v + sy * d1 / 2, z1) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for k in range(4):
        j = (k + 1) % 4
        m.quad(a[k], a[j], b[j], b[k])
    if top:
        m.quad(b[0], b[1], b[2], b[3])


def lathe_at(m, x, y, profile, segs=16):
    m.lathe([(float(z), float(r)) for z, r in profile], (float(x), float(y)), segs)


def hip_roof(roof, soffit, P, u_half, v_half, z_eave, z_top, ov, k=1.6, rings=6, ridge_frac=0.0):
    """A hipped roof with the concave sweep of a temple's (flat at the eaves, steep above), over the
    rectangle u in +-u_half, v in +-v_half, its eaves `ov` out; ridge_frac of the long side stays as a
    ridge (0: a pyramid, as a pagoda's storeys). Returns the eave outline's corner points."""
    Eu, Ev = u_half + ov, v_half + ov
    ridge = max(Eu - Ev, 0.0) * ridge_frac if Eu >= Ev else 0.0
    rv = max(Ev - Eu, 0.0) * ridge_frac if Ev > Eu else 0.0
    H = z_top - z_eave

    def ring(t):  # t from 0 (eaves) to 1 (top): the outline shrinks linearly in plan, rises on the curve
        s = 1 - t
        hu = ridge + (Eu - ridge) * s
        hv = rv + (Ev - rv) * s
        z = z_eave + H * t ** k if k != 1 else z_eave + H * t
        # the corners lift a little (sori): the eaves curve up toward the corners
        return [P(su * hu, sv * hv, z + (0.28 * ov * s if t < 0.35 else 0.0)) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]

    rs = [ring(t) for t in np.linspace(0, 1, rings + 1)]
    for a, b in zip(rs, rs[1:]):
        for i in range(4):
            j = (i + 1) % 4
            roof.quad(a[i], a[j], b[j], b[i])
    top = rs[-1]
    roof.quad(top[0], top[1], top[2], top[3])
    e = rs[0]
    w = [P(su * u_half, sv * v_half, z_eave - 0.4) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    dn = np.array([0, 0, -0.35])
    for i in range(4):
        j = (i + 1) % 4
        soffit.quad(e[i] + dn, e[j] + dn, e[j], e[i])
        soffit.quad(e[i] + dn, w[i], w[j], e[j] + dn)
    return e


def irimoya(roof, gable, soffit, P, u_half, v_half, z_eave, z_ridge, ov, gable_at=0.55, k=1.5):
    """A hip-and-gable roof (irimoya) with its ridge along u: the hipped skirt below gable_at of the
    height, the gables above it, and the ridge."""
    Eu, Ev = u_half + ov, v_half + ov
    H = z_ridge - z_eave
    zr = lambda d: z_eave + H * (min(max(d / Ev, 0.0), 1.0)) ** k   # height at d in from the long eaves
    d_g = Ev * gable_at ** (1 / k)
    Ug = Eu - d_g
    # the two long slopes, from the eaves to the ridge (the ridge runs from -Ug to Ug)
    vs = np.linspace(-Ev, Ev, 13)
    roof.grid([[P(u, v, zr(Ev - abs(v))) for u in np.linspace(-Ug, Ug, 7)] for v in vs])
    # the hipped ends: from the eaves to the gable's foot
    for su in (-1, 1):
        rows = []
        for v in vs:
            d = Ev - abs(v)
            rows.append([P(su * u, v, zr(min(d, Eu - abs(u), d_g))) for u in np.linspace(Ug, Eu, 5)])
        if su < 0:
            rows = [r[::-1] for r in rows]
        roof.grid(rows)
        zg = zr(d_g)
        vv = [v for v in vs if Ev - abs(v) >= d_g - 1e-6]
        for a, b in zip(vv, vv[1:]):
            gable.quad(P(su * Ug, a, zg), P(su * Ug, b, zg), P(su * Ug, b, zr(Ev - abs(b))), P(su * Ug, a, zr(Ev - abs(a))))
    e = [P(su * Eu, sv * Ev, z_eave) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    w = [P(su * u_half, sv * v_half, z_eave - 0.4) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    dn = np.array([0, 0, -0.4])
    for i in range(4):
        j = (i + 1) % 4
        soffit.quad(e[i] + dn, e[j] + dn, e[j], e[i])
        soffit.quad(e[i] + dn, w[i], w[j], e[j] + dn)
    return {"zr": zr, "Ug": Ug, "Ev": Ev}


# ---------------------------------------------------------------- meshes per material, and the atlas

class Kit:
    """One mesh per material (and part) for a landmark, created on first use."""

    def __init__(self, prefix, materials, floodlit=()):
        self.prefix, self.mats, self.m, self.lit = prefix, materials, {}, set(floodlit)

    def __call__(self, mat, part=""):
        key = (mat, part)
        if key not in self.m:
            self.m[key] = Mesh(f"{self.prefix}{('_' + part) if part else ''}_{mat}", mat, False,
                               floodlit=mat in self.lit or part == "lit",
                               uv=bool({"map", "pattern"} & set(self.mats.get(mat, {}))))
        return self.m[key]

    def meshes(self):
        return [m for m in self.m.values() if m.v]


class Atlas:
    """Cells of one texture, packed in shelves. items: [(key, w, h)] in pixels."""

    def __init__(self, items, width=2048, pad=4):
        self.rects, x, y, row = {}, pad, pad, 0
        for key, w, h in sorted(items, key=lambda it: -it[2]):
            if x + w + pad > width:
                x, y, row = pad, y + row + pad * 2, 0
            self.rects[key] = (x, y, w, h)
            x, row = x + w + pad * 2, max(row, h)
        self.W, self.H = width, int(2 ** math.ceil(math.log2(y + row + pad)))

    def uv(self, key):
        x, y, w, h = self.rects[key]
        return x / self.W, 1 - (y + h) / self.H, (x + w) / self.W, 1 - y / self.H

    def quad(self, m, a, b, c, d, key):
        """a-b-c-d counter-clockwise seen from its face, a bottom-left."""
        u0, v0, u1, v1 = self.uv(key)
        m.quad(a, b, c, d, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]])

    def wrap(self, m, x, y, z0, z1, r, key, segs=24):
        """A drum (a paper lantern's body) with the image wrapped once round it."""
        u0, v0, u1, v1 = self.uv(key)
        for k in range(segs):
            a0, a1 = 2 * math.pi * k / segs, 2 * math.pi * (k + 1) / segs
            p = lambda a, z, rr: np.array([x + rr * math.cos(a), y + rr * math.sin(a), z])
            m.quad(p(a0, z0, r), p(a1, z0, r), p(a1, z1, r), p(a0, z1, r),
                   [[u0 + (u1 - u0) * k / segs, v0], [u0 + (u1 - u0) * (k + 1) / segs, v0],
                    [u0 + (u1 - u0) * (k + 1) / segs, v1], [u0 + (u1 - u0) * k / segs, v1]])


def overture(C, layer, where="TRUE"):
    """Rows of a raw Overture layer, as dicts with a local geometry."""
    import duckdb
    from shapely import wkb as swkb
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    cur = con.execute(f"SELECT * FROM '{os.path.join(C.raw, f'overture_{layer}.parquet')}' WHERE {where}")
    cols = [d[0] for d in cur.description]
    out = []
    for r in cur.fetchall():
        d = dict(zip(cols, r))
        d["geom"] = C.to_local(swkb.loads(bytes(d["wkb"])))
        out.append(d)
    return out


def police_box(b, geoms):
    """A koban (交番), a police box: a small one- or two-storey building, whose height the build
    otherwise estimates from its taller neighbours. A typical 6 m where the survey has none."""
    if not (b["name"] or "").endswith("交番"):
        return geoms
    return [[q[0], q[1], 6.0, "typical", q[4]] if q[3] in ("default", "ml", "estimate") or q[2] > 9.0 else q for q in geoms]


def footprint_frame(g, toward=None):
    """A footprint's minimum rectangle: centre, unit long axis (turned to face `toward` if given) and
    the half-sizes along it and across."""
    r = np.asarray(g.minimum_rotated_rectangle.exterior.coords)[:4]
    e1, e2 = r[1] - r[0], r[2] - r[1]
    c = r.mean(axis=0)
    L1, L2 = float(np.linalg.norm(e1)), float(np.linalg.norm(e2))
    ax, half = (e1 / L1, (L1 / 2, L2 / 2)) if L1 >= L2 else (e2 / L2, (L2 / 2, L1 / 2))
    return c, ax, half


def open_fronts(sites):
    """The sites without those that face a neighbour across a party wall: two fronts back to back
    within a metre, each facing into the other's building (the footprints of a terrace often leave
    one with a road beyond it), whose signs would stand inside a wall and show their backs."""
    S = np.asarray([s[:4] for s in sites], float).reshape(-1, 4)
    shut = set()
    for i in range(len(S)):
        m, n = S[i, :2], S[i, 2:4]
        t = np.array([-n[1], n[0]])
        for j in range(i + 1, len(S)):
            d = S[j, :2] - m
            if np.dot(n, S[j, 2:4]) < -0.9 and 0.0 <= np.dot(d, n) < 1.0 and abs(np.dot(d, t)) < (sites[i][6] + sites[j][6]) / 2:
                shut |= {i, j}
    return [s for k, s in enumerate(sites) if k not in shut]


def street_signs(K, atlas, sites, keys, rng, max_h=None):
    """Signs on street fronts: a lit board over the shop front and blade signs standing out from the
    wall, read both ways. sites: [x, y, nx, ny, ground, top, edge length]; keys: (board keys, blade keys)."""
    boards, blades = keys
    A = K("atlas", "lit")
    placed = []   # blades already built: one from the facing wall of a narrow lane would cross them
    for x, y, nx, ny, g, top, L in open_fronts(sites):
        n, mid = np.array([nx, ny]), np.array([x, y])
        t = np.array([-n[1], n[0]])
        w = min(max(L * 0.6, 2.4), 6.5)
        along = (rng.random() - 0.5) * max(L - w, 0.0)
        z0 = g + 2.9 + rng.random() * 0.5
        c = mid + n * 0.18 + t * along
        a, b = c - t * w / 2, c + t * w / 2
        atlas.quad(A, np.array([*a, z0]), np.array([*b, z0]), np.array([*b, z0 + w / 4]), np.array([*a, z0 + w / 4]), boards[int(rng.integers(len(boards)))])
        nb = 1 + (top > 14) + (top > 26)
        for j in range(nb):
            h = min(3.0 + rng.random() * 5.0 * (1 + j), (max_h or 99))
            z0 = g + 4.2 + j * 8.5 + rng.random() * 1.5
            if z0 + h > g + top - 0.6:
                h = g + top - 0.6 - z0
            if h < 2.0:
                continue
            along = (rng.random() - 0.5) * max(L - 1.5, 0.0)
            c = mid + n * 0.95 + t * along
            key = blades[int(rng.integers(len(blades)))]
            if any(np.hypot(*(c - p)) < 2.0 and abs(z0 - pz) < h + ph for p, pz, ph in placed):
                continue
            placed.append((c, z0, h))
            for side in (-1, 1):  # both faces, each on the side it faces
                a, b = c - n * 0.7 * side - t * 0.06 * side, c + n * 0.7 * side - t * 0.06 * side
                atlas.quad(A, np.array([*a, z0]), np.array([*b, z0]), np.array([*b, z0 + h]), np.array([*a, z0 + h]), key)


def sign_sites(C, signs, ground, max_dist=7.0):
    """Street fronts of candidate buildings: up to two edges per footprint that face a road within max_dist."""
    from shapely import STRtree
    from shapely.geometry import Point
    rows = overture(C, "segment", "subtype = 'road'")
    lines = [r["geom"] for r in rows if r["geom"].geom_type == "LineString" and not any(
        "is_tunnel" in (rule.get("values") or []) or "is_indoor" in (rule.get("values") or []) for rule in (r.get("road_flags") or []))]
    tree = STRtree(lines)
    out = []
    for g, top in signs:
        cs = np.asarray(g.exterior.coords)
        ccw = g.exterior.is_ccw
        best = []
        for a, b in zip(cs[:-1], cs[1:]):
            e = b - a
            L = float(np.hypot(*e))
            if L < 4.0:
                continue
            n = np.array([e[1], -e[0]]) / L if ccw else np.array([-e[1], e[0]]) / L
            mid = (a + b) / 2
            probe = Point(mid + n * 4.0)
            near = tree.query(probe.buffer(8.0))
            if not len(near):
                continue
            dd = min(lines[i].distance(probe) for i in near)
            if dd < max_dist and not g.buffer(0.5).contains(probe):
                best.append((dd + 0.02 * (60 - min(L, 60)), mid, n, L))
        for _, mid, n, L in sorted(best, key=lambda r: r[0])[:2]:
            out.append([round(float(mid[0]), 1), round(float(mid[1]), 1), round(float(n[0]), 3), round(float(n[1]), 3),
                        round(ground(*mid), 1), round(top, 1), round(L, 1)])
    return out
