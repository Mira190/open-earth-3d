"""Shibuya & Shinjuku: what the generic pipeline cannot know from open data.

The model is the real city: Overture footprints at Project PLATEAU's surveyed heights. This file
adds the places a film and a game made famous, built in code from published dimensions and
placed on anchors measured from the data (OpenStreetMap footprints, steps and points via Overture):

Suga Shrine, Yotsuya (須賀神社), the stairs of Your Name (君の名は。, 2016)
  * 男坂, the main stairs: 52 stone steps, 49 in three flights of 18, 16 and 15 up to the shrine's
    approach and 3 more towards the ridge road; 3.6 m wide, about 16 m long, about 27 degrees, two
    landings, red iron handrails on both sides and down the middle (Tokyo stairs database, "0008
    須賀神社 男坂"). The line is OpenStreetMap's; the rise is the GSI laser DEM's (7 m here, against
    6.1 m published), so the steps meet the street and the approach. The terrain is cut so the
    stairs are set into the slope (adjust_terrain), as they are, between retaining walls.
  * 女坂, the gentler stairs up from the north, arriving beside the great torii (OpenStreetMap line).
  * The approach runs straight from the head of the 男坂 to the haiden (OpenStreetMap's path), with the
    great torii (1990, vermilion, myojin style, a green plaque with 須賀神社 in gold, a sacred rope with
    three tassels), the temizuya on the right, the ladder mound of the く組 fire brigade beside it,
    lanterns, two pairs of komainu, the ema rack, the Daikoku and Sorei shrines and the Tenpaku Inari.
  * The haiden and honden on OpenStreetMap's footprint, facing the torii: a green copper irimoya roof
    with a chidori gable and a cusped karahafu over the porch, vermilion posts and white walls (Suga
    Shrine, photographs). The ridge is at PLATEAU's 10.5 m. The rebuilt hall is reinforced concrete;
    the proportions of the roof are an approximation, not a survey.
  * The ema of 2026: the shrine's own design (the 男坂 painted in colour, 800 yen) and the year's
    wishes, many for the film's tenth anniversary (26 August 2026). The wishes are written for this
    model; no official anniversary ema had been announced when it was built. No character art: the
    doodles are comets, braided cords and stairs.

The rest (Shibuya, Sangenjaya, Shinjuku) is in the sections below.
"""
import math
import os
import urllib.request

import numpy as np
from shapely.geometry import Point, Polygon

from meshkit import Mesh

HAIDEN = "須賀大神 稲荷大神"       # the OSM name of Suga Shrine's hall (its two kami), as Overture spells it
TENPAKU = "天白稲荷神社"
ONNAZAKA = "Suga Shrine Onnazaka"

# the 男坂, from the Tokyo stairs database: steps per flight from the foot, width, length, slope
OTOKO = {"flights": [18, 16, 15], "extra": 3, "width_m": 3.6, "length_m": 16.0, "slope_deg": 27.0}

MATERIALS = {
    "granite": {"color": "#a29e96", "roughness": 0.85, "metalness": 0.0},
    "granite_dark": {"color": "#8a867e", "roughness": 0.9, "metalness": 0.0},
    "concrete": {"color": "#b5b0a6", "roughness": 0.92, "metalness": 0.0},
    "rail_red": {"color": "#c23b2c", "roughness": 0.42, "metalness": 0.35},
    "vermilion": {"color": "#d9644a", "roughness": 0.6, "metalness": 0.0},
    "white_wall": {"color": "#efebe2", "roughness": 0.8, "metalness": 0.0},
    "copper_green": {"color": "#6fa392", "roughness": 0.55, "metalness": 0.25},
    "copper_dark": {"color": "#4c7a6d", "roughness": 0.5, "metalness": 0.3},
    "gold": {"color": "#d6a83c", "roughness": 0.3, "metalness": 0.85},
    "wood": {"color": "#8a5a3b", "roughness": 0.8, "metalness": 0.0},
    "wood_dark": {"color": "#4a3427", "roughness": 0.85, "metalness": 0.0},
    "wood_light": {"color": "#d8c3a0", "roughness": 0.8, "metalness": 0.0},
    "straw": {"color": "#cdb47c", "roughness": 0.95, "metalness": 0.0},
    "paper": {"color": "#f4f1ea", "roughness": 0.9, "metalness": 0.0},
    "stone": {"color": "#8f8c85", "roughness": 0.92, "metalness": 0.0},
    "stone_dark": {"color": "#6c6a65", "roughness": 0.92, "metalness": 0.0},
    "bronze": {"color": "#5e4c3a", "roughness": 0.45, "metalness": 0.7},
    "water": {"color": "#2b4852", "roughness": 0.05, "metalness": 0.1},
    "steel": {"color": "#8d9399", "roughness": 0.5, "metalness": 0.5},
    "steel_dark": {"color": "#3a3e43", "roughness": 0.5, "metalness": 0.5},
    "pole": {"color": "#b8b5ad", "roughness": 0.9, "metalness": 0.0},
    "wire": {"color": "#1e1e1e", "roughness": 0.6, "metalness": 0.2},
    "paint_white": {"color": "#e9e7e0", "roughness": 0.7, "metalness": 0.0},
    "rope_red": {"color": "#b02a2a", "roughness": 0.9, "metalness": 0.0},
    "lamp": {"color": "#f6ecd2", "roughness": 0.6, "metalness": 0.0, "emissive": "#ffcf80", "glow": 2.2},
    # the drawn images (landmark_assets): ema, plaques, banners, signs and screens; lit after dark where floodlit
    "atlas": {"color": "#ffffff", "roughness": 0.75, "metalness": 0.0, "map": "atlas.jpg", "emissive_map": True, "glow": 1.25},
}


# ---------------------------------------------------------------- geometry helpers

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


def block(m, P, u0, u1, v0, v1, z0, z1, uvs=None):
    """A box in frame P, faces wound outward."""
    c = [P(u, v, z) for z in (z0, z1) for v in (v0, v1) for u in (u0, u1)]  # index z*4 + v*2 + u
    for a, b, cc, d in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
        m.quad(c[a], c[b], c[cc], c[d])


def slab_at(m, P, u, v, w, d, z0, z1):
    """A box centred at (u, v), w along u and d along v."""
    block(m, P, u - w / 2, u + w / 2, v - d / 2, v + d / 2, z0, z1)


def taper(m, P, u, v, w0, d0, z0, w1, d1, z1, top=True):
    """A frustum between two centred rectangles (plinths, battered walls, posts)."""
    a = [P(u + sx * w0 / 2, v + sy * d0 / 2, z0) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    b = [P(u + sx * w1 / 2, v + sy * d1 / 2, z1) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for k in range(4):
        j = (k + 1) % 4
        m.quad(a[k], a[j], b[j], b[k])
    if top:
        m.quad(b[0], b[1], b[2], b[3])


def lathe_at(m, x, y, profile, segs=16):
    m.lathe([(float(z), float(r)) for z, r in profile], (float(x), float(y)), segs)


def bilinear(grid, x0, y1, cell, x, y):
    """Bilinear height of a row-major grid (row 0 north) at (x, y), and its four corner indices."""
    ny, nx = grid.shape
    c = min(max((x - x0) / cell, 0.0), nx - 1.001)
    r = min(max((y1 - y) / cell, 0.0), ny - 1.001)
    c0, r0 = int(c), int(r)
    fc, fr = c - c0, r - r0
    z = (grid[r0, c0] * (1 - fc) * (1 - fr) + grid[r0, c0 + 1] * fc * (1 - fr) +
         grid[r0 + 1, c0] * (1 - fc) * fr + grid[r0 + 1, c0 + 1] * fc * fr)
    return float(z), (r0, c0)


# ---------------------------------------------------------------- data: the shrine's lines and footprint

_DATA = {}


def overture(C, layer, where):
    """Rows of a raw Overture layer near the shrine (or wherever `where` says), as dicts with a local geometry."""
    import duckdb
    from shapely import wkb as swkb
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    path = os.path.join(C.raw, f"overture_{layer}.parquet")
    cur = con.execute(f"SELECT * FROM '{path}' WHERE {where}")
    cols = [d[0] for d in cur.description]
    out = []
    for r in cur.fetchall():
        d = dict(zip(cols, r))
        d["geom"] = C.to_local(swkb.loads(bytes(d["wkb"])))
        out.append(d)
    return out


def envelope(C, x, y, r):
    (w, s), (e, n) = C.inv.transform(x - r, y - r), C.inv.transform(x + r, y + r)
    return f"ST_Intersects(ST_GeomFromWKB(wkb), ST_MakeEnvelope({w}, {s}, {e}, {n}))"


def suga_lines(C):
    """The hall's footprint, the 男坂 and 女坂 lines and the approach, read from Overture (cached)."""
    if "suga" in _DATA:
        return _DATA["suga"]
    hall = [r for r in overture(C, "building", "name = '" + HAIDEN + "'")]
    if not hall:
        _DATA["suga"] = None
        return None
    g = max((r["geom"] for r in hall), key=lambda q: q.area)
    c = g.centroid
    steps = [r for r in overture(C, "segment", f"class = 'steps' AND {envelope(C, c.x, c.y, 140)}") if r["geom"].geom_type == "LineString"]
    onna = [r["geom"] for r in steps if (r["name"] or "") == ONNAZAKA]
    _DATA["suga"] = {"hall": g, "centre": (c.x, c.y), "steps": [r["geom"] for r in steps if (r["name"] or "") != ONNAZAKA],
                     "onna": onna[0] if onna else None}
    return _DATA["suga"]


# ---------------------------------------------------------------- the 男坂 and 女坂

def stair_profile(z_foot, z_top, length, flights, extra, slope_deg, top_landing=2.6):
    """A straight flight of flights with landings between, as the strip profile the game walks
    ([u, z], u from -length at the foot to 0 at the head of the last flight, then a landing and the
    extra steps); the risers are equal and the treads keep the published slope where they fit."""
    n = sum(flights)
    rise = (z_top - z_foot) / n
    tread = min(rise / math.tan(math.radians(slope_deg)), (length - 0.9 * (len(flights) - 1)) / n)
    landing = (length - n * tread) / max(len(flights) - 1, 1)
    prof, u, z = [[round(-length - 0.6, 2), round(z_foot, 3)]], -length, z_foot
    edges = []  # (u0, u1, z) of each tread or landing, for the mesh
    for k, nf in enumerate(flights):
        for j in range(nf):
            prof += [[round(u, 3), round(z, 3)], [round(u + 0.02, 3), round(z + rise, 3)]]
            z += rise
            run = tread if j < nf - 1 or k == len(flights) - 1 else landing + tread
            edges.append((u, u + run, z))
            u += run
    # the head of the 49th step is at u = 0 (rounding apart); then the approach landing and the extra steps
    edges[-1] = (edges[-1][0], top_landing, z)
    u = top_landing
    for j in range(extra):
        prof += [[round(u, 3), round(z, 3)], [round(u + 0.02, 3), round(z + rise, 3)]]
        z += rise
        edges.append((u, u + (tread if j < extra - 1 else 1.2), z))
        u += tread
    prof.append([round(edges[-1][1], 3), round(z, 3)])
    return prof, edges, rise, tread, landing


def otokozaka(C, dem, cell):
    """The 男坂 from its OpenStreetMap line: the steps segment beside the shrine that climbs the most."""
    S = suga_lines(C)
    if not S or not S["steps"]:
        return None
    x0, y1 = C.x0, C.y1
    gz = lambda p: bilinear(dem, x0, y1, cell, p[0], p[1])[0]
    best = None
    for ln in S["steps"]:
        a, b = np.asarray(ln.coords[0]), np.asarray(ln.coords[-1])
        if not 10 < ln.length < 26:
            continue
        d = abs(gz(a) - gz(b))
        if best is None or d > best[0]:
            best = (d, a, b) if gz(b) > gz(a) else (d, b, a)
    if best is None:
        return None
    _, foot0, top = best
    f = unit(top - foot0)
    L = OTOKO["length_m"]
    foot = top - f * L
    z_top, z_foot = gz(top), gz(foot)
    prof, edges, rise, tread, landing = stair_profile(z_foot, z_top, L, OTOKO["flights"], OTOKO["extra"], OTOKO["slope_deg"])
    return {"origin": [round(float(top[0]), 2), round(float(top[1]), 2)], "axis": [round(float(f[0]), 5), round(float(f[1]), 5)],
            "half_width": OTOKO["width_m"] / 2, "z_foot": round(z_foot, 2), "z_top": round(z_top, 2), "riser_m": round(rise, 3),
            "tread_m": round(tread, 3), "landing_m": round(landing, 2), "steps": sum(OTOKO["flights"]) + OTOKO["extra"],
            "profile": prof, "treads": [[round(a, 3), round(b, 3), round(z, 3)] for a, b, z in edges],
            "osm_length_m": round(float(np.linalg.norm(top - foot0)), 1)}


def onnazaka(C, dem, cell):
    """The 女坂: OpenStreetMap's polyline, climbing south to the approach in short flights of equal risers."""
    S = suga_lines(C)
    if not S or S["onna"] is None:
        return None
    pts = [np.asarray(p, float) for p in S["onna"].coords]
    gz = lambda p: bilinear(dem, C.x0, C.y1, cell, p[0], p[1])[0]
    if gz(pts[0]) > gz(pts[-1]):
        pts = pts[::-1]  # from the foot up
    z0, z1 = gz(pts[0]), gz(pts[-1])
    lens = [float(np.linalg.norm(b - a)) for a, b in zip(pts, pts[1:])]
    total = sum(lens)
    n = max(4, round((z1 - z0) / 0.15))
    rise = (z1 - z0) / n
    legs, done, z = [], 0, z0
    for k, (a, b) in enumerate(zip(pts, pts[1:])):
        m = round(n * sum(lens[:k + 1]) / total) - done   # risers on this leg, by its share of the length
        done += m
        f = unit(b - a)
        L = lens[k]
        prof, treads = [[-0.4, round(z, 3)]], []
        u = 0.0
        run = L / max(m + 1, 1)
        for j in range(m):
            u += run
            prof += [[round(u, 3), round(z, 3)], [round(u + 0.02, 3), round(z + rise, 3)]]
            treads.append([round(u, 3), round(u + run, 3), round(z + rise, 3)])
            z += rise
        prof.append([round(L + 0.4, 3), round(z, 3)])
        legs.append({"origin": [round(float(a[0]), 2), round(float(a[1]), 2)], "axis": [round(float(f[0]), 5), round(float(f[1]), 5)],
                     "length_m": round(L, 2), "half_width": 1.1, "profile": prof, "z0": round(prof[0][1], 3), "treads": treads})
    return {"legs": legs, "z_foot": round(z0, 2), "z_top": round(z1, 2), "riser_m": round(rise, 3), "steps": n}


def tread_z(st, u):
    """The height of the strip profile at u (the walked surface)."""
    p = st["profile"]
    if u <= p[0][0]:
        return p[0][1]
    for (ua, za), (ub, zb) in zip(p, p[1:]):
        if u <= ub:
            return za + (zb - za) * (u - ua) / max(ub - ua, 1e-6)
    return p[-1][1]


def carve(dem, C, cell, strips, margin=0.06):
    """Lower the terrain under strips (stairs) so that the grid's bilinear ground does not rise through the
    treads. Each sample of a tread that the ground covers is cleared by a change to its cell's corners (a
    Kaczmarz pass, repeated until nothing is left), each corner moved in proportion to its bilinear weight
    and to how far it stands above the tread: the hillside beside the stairs takes the cut, and a corner
    already below them, in the lane at the foot or the approach at the top, barely moves."""
    pts = []
    for st in strips:
        o, f = np.asarray(st["origin"], float), np.asarray(st["axis"], float)
        l = left_of(f)
        hw = st["half_width"] + 0.3
        for u in np.arange(st["profile"][0][0], st["profile"][-1][0] + 0.01, 0.4):
            zt = tread_z(st, u) - margin
            pts += [(o + f * u + l * v, zt) for v in np.linspace(-hw, hw, 7)]
    ny, nx = dem.shape
    for _ in range(200):
        worst = 0.0
        for p, zt in pts:
            c = min(max((p[0] - C.x0) / cell, 0.0), nx - 1.001)
            r = min(max((C.y1 - p[1]) / cell, 0.0), ny - 1.001)
            c0, r0 = int(c), int(r)
            fc, fr = c - c0, r - r0
            w = np.array([[(1 - fc) * (1 - fr), fc * (1 - fr)], [(1 - fc) * fr, fc * fr]])
            blk = dem[r0:r0 + 2, c0:c0 + 2]
            z = float((blk * w).sum())
            if z > zt:
                e = z - zt + 0.005
                k = w * np.maximum(blk - zt, 0.02)
                blk -= e * k / (w * k).sum()
                worst = max(worst, e)
        if worst < 0.01:
            break
    return dem


def adjust_terrain(dem, C, cell):
    """Set the shrine's two stairs into the slope. build_scene calls it on the 5 m grid every consumer
    loads (the game walks it, and the stairs are placed from it) and again on the 10 m grid the viewer
    draws, each cut at its own resolution so the coarse one does not dig the lanes round the stairs."""
    if cell <= _DATA.get("stairs_cell", math.inf):  # the stairs come from the finest grid seen
        raw = dem.copy()
        _DATA["otokozaka"], _DATA["onnazaka"], _DATA["stairs_cell"] = otokozaka(C, raw, cell), onnazaka(C, raw, cell), cell
    ok, on = _DATA["otokozaka"], _DATA["onnazaka"]
    strips = ([ok] if ok else []) + (on or {}).get("legs", [])
    return carve(dem, C, cell, strips) if strips else dem


# ---------------------------------------------------------------- the shrine's furniture, from OpenStreetMap

# points OpenStreetMap maps in the precinct that Overture does not carry (node ids for checking)
SUGA_OSM = {
    "temizuya": (139.722764, 35.685267),   # node 3935663596, man_made=water_tap (the temizuya's basin)
    "kugumi": (139.722741, 35.685280),     # node 3935659185, historic=memorial く組 (the fire brigade's ladder mound)
    "sorei": (139.722667, 35.685339),      # node 3935663783, 祖霊社
    "ireihi": (139.722569, 35.685157),     # node 3935663780, 慰霊碑
    "iizuka": (139.722633, 35.685142),     # node 3935663785, 飯塚正兵衛翁
}


def precinct_frame(lm):
    """The approach's frame: origin at the head of the 男坂, u towards the hall, v to its left."""
    s = lm["suga"]
    return frame(s["origin"], s["axis"])


def suga_finalize(ctx):
    """Everything the shrine's meshes need, placed from the data: the approach axis runs from the head of
    the 男坂 to the hall's centre (OpenStreetMap's path follows it to within a degree)."""
    lm = ctx.landmarks
    ok, on, h = _DATA.get("otokozaka"), _DATA.get("onnazaka"), lm.get("suga_hall")
    if not (ok and h):
        return
    top = np.array(ok["origin"])
    hc = np.array(h["centre"])
    ax = unit(hc - top)
    lv = left_of(ax)
    sv = lambda p: (float((np.asarray(p[:2]) - top) @ ax), float((np.asarray(p[:2]) - top) @ lv))
    ring = np.asarray(h["ring"])
    ss = [(p - top) @ ax for p in ring]
    vv = [(p - top) @ lv for p in ring]
    s_front, depth = float(min(ss)), float(max(ss) - min(ss))
    v_mid, half = float((max(vv) + min(vv)) / 2), float((max(vv) - min(vv)) / 2)
    # the great torii stands just past the head of the 女坂, which climbs to the approach beside it
    if on:
        last = on["legs"][-1]
        s_onna = sv(np.asarray(last["origin"]) + np.asarray(last["axis"]) * last["length_m"])[0]
    else:
        s_onna = s_front - 30.0
    s_torii = s_onna + 2.5
    g = lambda s, v: round(ctx.ground(*(top + ax * s + lv * v)), 2)
    loc = lambda ll: sv(ctx.city.fwd.transform(*ll))
    # the precinct's other buildings (the hall and the Tenpaku Inari are ours): furniture keeps clear of them
    from shapely import STRtree
    others = [r["geom"] for r in overture(ctx.city, "building", envelope(ctx.city, *hc, 110))
              if r["geom"].geom_type == "Polygon" and (r["name"] or "") not in (HAIDEN, TENPAKU)]
    tree = STRtree(others)

    def clear(s_, v_, r):
        q = Point(*(top + ax * s_ + lv * v_)).buffer(r)
        return not any(others[i].intersects(q) for i in tree.query(q))

    def spot(s_, v_, r, toward_axis=True):
        """(s, v) nearest the wanted spot that is clear of buildings: slid along the approach, then in."""
        for ds in (0, -1, 1, -2, 2, -3, 3, -4, 4, -6, 6):
            for k in range(0, 9):
                vv = v_ - np.sign(v_) * 0.25 * k if toward_axis else v_
                if abs(vv) >= 1.9 and clear(s_ + ds, vv, r):
                    return round(s_ + ds, 1), round(vv, 2)
        return round(s_, 1), round(v_, 2)
    pave = [[round(s, 1), g(s, -1.2), g(s, 1.2)] for s in np.arange(0.0, s_front - 1.9, 1.0)]
    s = {
        "origin": [round(float(top[0]), 2), round(float(top[1]), 2)], "axis": [round(float(ax[0]), 5), round(float(ax[1]), 5)],
        "z_approach": ok["z_top"], "pave": pave,
        "torii": {"s": round(s_torii, 2), "z": g(s_torii, 0), "span_m": 4.2, "height_m": 6.0},
        "hall": {"s_front": round(s_front, 2), "depth_m": round(depth, 2), "v_mid": round(v_mid, 2), "half_width_m": round(half, 2),
                 "z": round(max(g(s_front + a, v_mid + b) for a in (0, depth) for b in (-half, half)), 2), "ridge_m": h["ridge_m"]},
        "nobori": [[round(s_torii - 1.6, 1), sgn * 3.6, g(s_torii - 1.6, sgn * 3.6)] for sgn in (-1, 1)],
        "shago": [round(s_torii - 2.4, 1), 2.9, g(s_torii - 2.4, 2.9)],
        "daikoku": [round(s_front + 2.0, 1), round(v_mid + half + 1.6, 1), g(s_front + 2.0, v_mid + half + 1.6)],
    }
    for k in ("temizuya", "kugumi", "sorei", "ireihi", "iizuka"):
        a, b = loc(SUGA_OSM[k])
        s[k] = [round(a, 1), round(b, 1), g(a, b)]
    # lanterns and komainu in pairs along the approach, and the ema rack beside it before the hall (placed
    # where the precinct's buildings leave room: the hall on the left past the torii fills that side)
    s["lanterns"], s["komainu"] = [], []
    for want in (s_torii + 4.5, s_front - 7.5):
        for sgn in (-1, 1):
            a, b = spot(want, sgn * 3.1, 0.55)
            s["lanterns"].append([a, b, g(a, b)])
    for sgn in (-1, 1):
        a, b = spot(s_front - 4.2, sgn * 2.5, 0.6)
        s["komainu"].append([a, b, g(a, b)])
    rack = None
    for want_v in (-4.6, 4.6):   # the right first, between the temizuya and the hall
        for ds in np.arange(0, 9, 1.0):
            a = s_front - 5.5 - ds
            if all(clear(a + du, want_v, 0.9) for du in (-2.1, 0, 2.1)) and abs(a - s["temizuya"][0]) > 3.2:
                rack = (round(a, 1), want_v)
                break
        if rack:
            break
    rack = rack or (round(s_front - 6, 1), -4.6)
    s["ema_rack"] = {"s": rack[0], "v": rack[1], "z": g(*rack), "length_m": 4.2}
    board = overture(ctx.city, "infrastructure", "name = '三十六歌仙'")  # the board on the shrine's paintings of the 36 poets
    if board:
        a, b = sv((board[0]["geom"].x, board[0]["geom"].y))
        s["kasen_board"] = [round(a, 1), round(b, 1), g(a, b)]
    t = lm.pop("suga_tenpaku", None)
    if t:  # its own footprint and long axis, in the local frame
        s["tenpaku"] = t | {"z": round(ctx.ground(*t["centre"]), 2)}
    lm.pop("suga_hall", None)
    for st in [ok] + ((on or {}).get("legs") or []):   # the slope beside each tread (to 3.5 m out), which its retaining walls hold back
        if st:
            o, f = np.asarray(st["origin"]), np.asarray(st["axis"])
            l, hw = left_of(f), st["half_width"]
            st["sides"] = [[round(max(ctx.ground(*(o + f * (u0 + u1) / 2 + l * side * (hw + d))) for d in (0.6, 1.5, 2.5, 3.5)), 2)
                            for side in (-1, 1)] for u0, u1, _ in st["treads"]]
    s["otokozaka"], s["onnazaka"] = ok, on
    s["sources"] = ("男坂: Tokyo stairs database 0008 (52 steps, 3.6 m, 16 m, 27 degrees, two landings, red iron handrails); "
                    "lines and footprints: OpenStreetMap via Overture; hall ridge: PLATEAU")
    lm["suga"] = s
    tz = s["hall"]["z"] + h["ridge_m"]
    ctx.labels["Suga Shrine 須賀神社"] = [round(float(hc[0]), 1), round(float(hc[1]), 1), round(tz + 6, 1)]
    mid = top - np.array(ok["axis"]) * 8.0
    ctx.labels["Your Name stairs 男坂"] = [round(float(mid[0]), 1), round(float(mid[1]), 1), round(ok["z_top"] + 9, 1)]


def suga_building(b, cls, g, geoms, ctx):
    """The hall and the Tenpaku Inari are drawn by the shrine's meshes (their solids stay for the sun);
    small buildings in the precinct get copper roofs, and one whose PLATEAU height is the cherry tree above it is capped."""
    name = b["name"] or ""
    if name == HAIDEN:
        ring = [[round(x, 2), round(y, 2)] for x, y in g.exterior.coords]
        ctx.landmarks["suga_hall"] = {"centre": [round(g.centroid.x, 2), round(g.centroid.y, 2)], "ring": ring,
                                      "ridge_m": round(max(q[2] for q in geoms), 1)}
        for q in geoms:
            ctx.hide(q)
        return geoms
    if name == TENPAKU:
        r = np.asarray(g.minimum_rotated_rectangle.exterior.coords)[:4]
        e1, e2 = r[1] - r[0], r[2] - r[1]
        e = e1 if np.linalg.norm(e1) >= np.linalg.norm(e2) else e2
        ctx.landmarks["suga_tenpaku"] = {"centre": [round(g.centroid.x, 2), round(g.centroid.y, 2)], "axis_deg": round(math.degrees(math.atan2(e[1], e[0])), 1),
                                         "long_m": round(float(max(np.linalg.norm(e1), np.linalg.norm(e2))), 2),
                                         "short_m": round(float(min(np.linalg.norm(e1), np.linalg.norm(e2))), 2)}
        for q in geoms:
            ctx.hide(q)
        return geoms
    ok, S = _DATA.get("otokozaka"), suga_lines(ctx.city)
    if not ok or not S or g.area > 120 or g.distance(S["hall"]) > 60:
        return geoms
    top, hc = np.array(ok["origin"]), np.array(S["centre"])
    ax = unit(hc - top)
    p = np.array([g.centroid.x, g.centroid.y]) - top
    s, v = p @ ax, p @ left_of(ax)
    if 25 < s < float(np.linalg.norm(hc - top)) and abs(v) < 12:  # inside the precinct, beside the approach
        b["roof_material"], b["roof_shape"] = "copper", b.get("roof_shape") or "hipped"
        for q in geoms:
            if q[2] > 12:  # the canopy of the cherry beside the torii, not a building (the photographs show a low hall)
                q[2], q[3] = 6.0, "estimate"
    return geoms


# ---------------------------------------------------------------- roofs

def sweep_curve(t, k=1.3):
    """A Japanese roof's concave sweep: flat at the eaves, steep at the ridge (t from eave 0 to ridge 1)."""
    return max(t, 0.0) ** k


def irimoya(mats, P, a0, a1, b_half, z_eave, z_ridge, ov=1.2, gable_at=0.55, ridge_cap=True, k=1.3):
    """A hip-and-gable roof over a in [a0, a1] (front to back) and b in +-b_half, its ridge across the
    front (along b): the hipped skirt all round, the gables above it at gable_at of the height, a ridge
    cap, the fascia and the eaves' underside. mats: (roof, gable, cap, fascia, soffit) meshes."""
    roof, gable, cap, fascia, soffit = mats
    A = (a0 + a1) / 2
    Ey, Ex = (a1 - a0) / 2 + ov, b_half + ov
    H = z_ridge - z_eave
    d_g = Ey * gable_at ** (1 / k)       # in from the eave where the hip meets the gable
    Gx, Yg = Ex - d_g, Ey - d_g
    zr = lambda d: z_eave + H * sweep_curve(d / Ey, k)
    Q = lambda X, Y, z: P(A + Y, X, z)
    ys = np.unique(np.round(np.concatenate([np.linspace(-Ey, -Yg, 5), np.linspace(-Yg, Yg, 9), np.linspace(Yg, Ey, 5)]), 4))
    xin = np.linspace(-Gx, Gx, 7)
    roof.grid([[Q(X, Y, zr(Ey - abs(Y))) for X in xin] for Y in ys])
    for sgn in (-1, 1):
        xo = np.linspace(Gx, Ex, 5) * sgn
        roof.grid([[Q(X, Y, zr(min(Ey - abs(Y), Ex - abs(X), d_g))) for X in xo] for Y in ys])
        # the gable: from the top of the hip to the roof line, set in where the hip stops
        zg = zr(d_g)
        yy = [y for y in ys if abs(y) <= Yg + 1e-6]
        for y0, y1 in zip(yy, yy[1:]):
            gable.quad(Q(sgn * Gx, y0, zg), Q(sgn * Gx, y1, zg), Q(sgn * Gx, y1, zr(Ey - abs(y1))), Q(sgn * Gx, y0, zr(Ey - abs(y0))))
            # the bargeboard just under the roof line
            fascia.quad(Q(sgn * (Gx + 0.08), y0, zr(Ey - abs(y0)) - 0.38), Q(sgn * (Gx + 0.08), y1, zr(Ey - abs(y1)) - 0.38),
                        Q(sgn * (Gx + 0.08), y1, zr(Ey - abs(y1)) + 0.02), Q(sgn * (Gx + 0.08), y0, zr(Ey - abs(y0)) + 0.02))
    # fascia round the eaves and the underside back to the walls
    e = [Q(-Ex, -Ey, z_eave), Q(Ex, -Ey, z_eave), Q(Ex, Ey, z_eave), Q(-Ex, Ey, z_eave)]
    w = [Q(-b_half, -(a1 - a0) / 2, z_eave - 0.3), Q(b_half, -(a1 - a0) / 2, z_eave - 0.3),
         Q(b_half, (a1 - a0) / 2, z_eave - 0.3), Q(-b_half, (a1 - a0) / 2, z_eave - 0.3)]
    dn = np.array([0, 0, -0.32])
    for i in range(4):
        j = (i + 1) % 4
        fascia.quad(e[i] + dn, e[j] + dn, e[j], e[i])
        soffit.quad(e[i] + dn, w[i], w[j], e[j] + dn)
    if ridge_cap:
        block(cap, lambda u, v, z: Q(v, u, z), -0.28, 0.28, -Gx - 0.35, Gx + 0.35, z_ridge - 0.15, z_ridge + 0.42)
        for sgn in (-1, 1):  # the ridge-end tiles
            block(cap, lambda u, v, z: Q(v, u, z), -0.32, 0.32, sgn * (Gx + 0.35) - 0.25, sgn * (Gx + 0.35) + 0.25, z_ridge - 0.1, z_ridge + 0.85)
    return {"zr": zr, "Ey": Ey, "Ex": Ex, "A": A, "Q": Q}


def karahafu(mats, P, a0, a1, width, z_edge, rise):
    """A cusped gable over a porch: a bell-shaped roof across b, extruded from a0 (the front) to a1,
    with its front board edged in gold and the gilt pendant at the crown."""
    roof, board, gold = mats
    bs = np.linspace(-width / 2, width / 2, 21)
    zc = lambda b: z_edge + rise * (1 - (2 * b / width) ** 2) ** 2
    roof.grid([[P(a, b, zc(b)) for b in bs] for a in (a0, a1)])
    for b0, b1 in zip(bs, bs[1:]):
        board.quad(P(a0 - 0.02, b0, zc(b0) - 0.42), P(a0 - 0.02, b1, zc(b1) - 0.42), P(a0 - 0.02, b1, zc(b1)), P(a0 - 0.02, b0, zc(b0)))
    gold.tube([P(a0 - 0.05, b, zc(b) - 0.42) for b in bs], 0.035, 5)
    gold.tube([P(a0 - 0.05, b, zc(b) + 0.01) for b in bs], 0.03, 5)
    taper(gold, lambda u, v, z: P(a0 - 0.08 + u, v, z), 0, 0, 0.06, 0.5, zc(0) - 0.95, 0.06, 0.18, zc(0) - 0.4)


def chidori(mats, R, width, at_frac=0.45):
    """A triangular dormer gable on the front slope of roof R (as irimoya returned it), centred."""
    roof, face, gold = mats
    Q, zr, Ey = R["Q"], R["zr"], R["Ey"]
    yf = -Ey * at_frac                       # its front, on the front slope
    zb = zr(Ey - abs(yf))
    za = zb + width * 0.42
    zmax = zr(Ey)
    za = min(za, zmax - 0.05)
    t = ((za - zr(0)) / (zmax - zr(0))) ** (1 / 1.3) if zmax > zr(0) else 1.0
    yb = -(Ey - Ey * t)                      # where its ridge meets the main roof
    hw = width / 2
    face.tri(Q(-hw, yf, zb), Q(hw, yf, zb), Q(0, yf, za))
    roof.tri(Q(-hw - 0.3, yf - 0.4, zb - 0.15), Q(0, yf - 0.4, za + 0.08), Q(0, yb, za + 0.08))
    roof.tri(Q(hw + 0.3, yf - 0.4, zb - 0.15), Q(0, yb, za + 0.08), Q(0, yf - 0.4, za + 0.08))
    gold.tube([Q(-hw - 0.3, yf - 0.42, zb - 0.2), Q(0, yf - 0.42, za + 0.03), Q(hw + 0.3, yf - 0.42, zb - 0.2)], 0.04, 5)
    taper(gold, lambda u, v, z: Q(v, yf - 0.45 + u, z), 0, 0, 0.05, 0.45, za - 0.85, 0.05, 0.12, za - 0.3)


def gable_roof(roof, end, P, u0, u1, v_half, z_eave, z_ridge, ov=0.4):
    """A plain gabled roof with its ridge along u (temizuya, small shrines)."""
    for sgn in (-1, 1):
        roof.quad(P(u0 - ov, sgn * (v_half + ov), z_eave), P(u1 + ov, sgn * (v_half + ov), z_eave), P(u1 + ov, 0, z_ridge), P(u0 - ov, 0, z_ridge))
    for uu in (u0, u1):
        end.tri(P(uu, -v_half, z_eave), P(uu, v_half, z_eave), P(uu, 0, z_ridge - 0.08))


# ---------------------------------------------------------------- the shrine's buildings

class Kit:
    """One mesh per material for a landmark, created on first use."""

    def __init__(self, prefix, floodlit=()):
        self.prefix, self.m, self.lit = prefix, {}, set(floodlit)

    def __call__(self, mat, part=""):
        key = (mat, part)
        if key not in self.m:
            self.m[key] = Mesh(f"{self.prefix}{('_' + part) if part else ''}_{mat}", mat, False, floodlit=mat in self.lit or part == "lit", uv=mat == "atlas")
        return self.m[key]

    def meshes(self):
        return [m for m in self.m.values() if m.v]


def hall(K, s):
    """The haiden in front and the honden behind, on the hall's footprint, facing the torii."""
    h = s["hall"]
    ax = np.array(s["axis"])
    front = np.array(s["origin"]) + ax * h["s_front"] + left_of(ax) * h["v_mid"]
    P = frame(front, ax)
    z0, D, hw = h["z"], h["depth_m"], h["half_width_m"]
    zp = z0 + 0.9                       # the stone platform
    ridge = z0 + h["ridge_m"]
    porch, body = 2.4, min(8.0, D * 0.48)
    hw_h = min(hw - 1.0, 6.2)           # the haiden's walls (the eaves come out to the footprint)
    a_hon0, a_hon1 = porch + body + 1.3, D - 0.4
    hw_n = min(hw - 2.6, 4.0)
    # platform and its front steps (the steps are a walkable strip)
    block(K("granite"), P, -0.4, D, -hw + 0.2, hw - 0.2, z0 - 1.2, zp)
    block(K("granite_dark"), P, -0.5, D + 0.1, -hw + 0.1, hw - 0.1, zp - 0.12, zp + 0.02)
    n = 5
    for j in range(n):
        a = -0.4 - (n - j) * 0.32
        block(K("granite", "steps"), P, a, -0.4, -1.8, 1.8, z0 - 0.3, z0 + (j + 1) * 0.9 / n)
    # haiden: posts, white walls, beams, doors in the middle of the front
    a0, a1 = porch, porch + body
    W, R_ = K("white_wall"), K("vermilion")
    for b0, b1, ua, ub in ((-hw_h, hw_h, a1 - 0.12, a1 + 0.12), (-hw_h - 0.12, -hw_h + 0.12, a0, a1), (hw_h - 0.12, hw_h + 0.12, a0, a1)):
        block(W, P, ua, ub, b0, b1, zp, zp + 4.0)
    block(W, P, a0 - 0.12, a0 + 0.12, -hw_h, -2.6, zp, zp + 4.0)
    block(W, P, a0 - 0.12, a0 + 0.12, 2.6, hw_h, zp, zp + 4.0)
    block(K("wood_dark"), P, a0 - 0.06, a0 + 0.06, -2.6, 2.6, zp, zp + 3.3)        # the lattice doors
    for k in range(9):
        bb = -2.6 + k * 5.2 / 8
        block(K("gold"), P, a0 - 0.1, a0 - 0.06, bb - 0.025, bb + 0.025, zp + 0.4, zp + 3.2)
    block(W, P, a0 - 0.1, a0 + 0.1, -2.6, 2.6, zp + 3.3, zp + 4.0)
    for b in np.linspace(-hw_h, hw_h, 7):
        for a in (a0, a1):
            slab_at(R_, P, a, b, 0.34, 0.34, zp, zp + 4.1)
    for a in np.linspace(a0, a1, 5):
        for b in (-hw_h, hw_h):
            slab_at(R_, P, a, b, 0.34, 0.34, zp, zp + 4.1)
    for z in (zp + 0.35, zp + 3.25):     # nageshi beams round the walls
        block(R_, P, a0 - 0.2, a1 + 0.2, -hw_h - 0.2, -hw_h + 0.2, z, z + 0.22)
        block(R_, P, a0 - 0.2, a1 + 0.2, hw_h - 0.2, hw_h + 0.2, z, z + 0.22)
        block(R_, P, a0 - 0.2, a0 + 0.2, -hw_h, hw_h, z, z + 0.22)
        block(R_, P, a1 - 0.2, a1 + 0.2, -hw_h, hw_h, z, z + 0.22)
    rm = (K("copper_green"), K("white_wall", "gable"), K("copper_dark"), K("copper_dark", "fascia"), K("wood"))
    R = irimoya(rm, P, a0, a1, hw_h, zp + 4.3, ridge, ov=min(1.5, hw - hw_h + 0.5), gable_at=0.55)
    chidori((K("copper_green"), K("white_wall", "gable"), K("gold")), R, 4.6)
    # the porch: four posts, a beam with a gold-capped bracket, the karahafu, the offering box and the bell
    for a in (0.15, porch - 0.15):
        for b in (-2.5, 2.5):
            slab_at(R_, P, a, b, 0.32, 0.32, zp, zp + 3.7)
    block(R_, P, -0.05, porch + 0.1, -2.75, 2.75, zp + 3.45, zp + 3.75)
    block(K("gold"), P, -0.09, -0.05, -2.75, 2.75, zp + 3.45, zp + 3.75)
    karahafu((K("copper_green"), K("copper_dark", "fascia"), K("gold")), P, -0.9, porch + 0.6, 6.6, zp + 3.75, 1.25)
    block(K("wood"), P, 0.55, 1.25, -0.85, 0.85, zp, zp + 0.72)                     # saisen-bako
    for k in range(8):
        block(K("wood_dark"), P, 0.6 + k * 0.08, 0.63 + k * 0.08, -0.82, 0.82, zp + 0.72, zp + 0.78)
    lathe_at(K("gold"), *P(0.25, 0, 0)[:2], [(zp + 2.85, 0.0), (zp + 2.9, 0.12), (zp + 3.05, 0.19), (zp + 3.2, 0.12), (zp + 3.3, 0.03)], 12)
    K("rope_red").tube([P(0.25, 0, zp + 2.85), P(0.27, 0.02, zp + 1.8), P(0.25, 0, zp + 0.85)], 0.045, 6)
    # the honden behind, joined by a short heiden
    block(W, P, a1, a_hon0, -2.0, 2.0, zp, zp + 3.4)
    block(W, P, a_hon0, a_hon1, -hw_n, hw_n, zp + 0.4, zp + 3.6)
    for b in (-hw_n, 0, hw_n):
        for a in (a_hon0, a_hon1):
            slab_at(R_, P, a, b, 0.32, 0.32, zp + 0.4, zp + 3.7)
    block(R_, P, a_hon0 - 0.2, a_hon1 + 0.2, -hw_n - 0.25, hw_n + 0.25, zp + 0.2, zp + 0.42)
    irimoya((K("copper_green"), K("white_wall", "gable"), K("copper_dark"), K("copper_dark", "fascia"), K("wood")),
            P, a_hon0, a_hon1, hw_n, zp + 3.9, ridge - 0.9, ov=1.0, gable_at=0.5)
    block(K("copper_green"), P, a1 - 0.3, a_hon0 + 0.3, -2.4, 2.4, zp + 3.45, zp + 3.75)
    return P, zp


def torii(K, P, z0, span=4.2, height=6.0):
    """A myojin torii in frame P (u through it, v across): stone bases, tapered pillars with their
    rings, the nuki and its tie through the pillars, the plaque on its strut, the shimaki and the
    kasagi sweeping up at the ends; the sacred rope with three tassels and paper streamers."""
    R_, S = K("vermilion"), K("stone_dark")
    hs = span / 2
    for v in (-hs, hs):
        x, y, _ = P(0, v, 0)
        lathe_at(S, x, y, [(z0 - 0.3, 0.52), (z0 + 0.25, 0.5), (z0 + 0.42, 0.36), (z0 + 0.45, 0.27)], 16)
        lathe_at(R_, x, y, [(z0 + 0.45, 0.245), (z0 + height - 0.7, 0.215)], 16)
        lathe_at(R_, x, y, [(z0 + height - 0.85, 0.3), (z0 + height - 0.7, 0.3), (z0 + height - 0.68, 0.0)], 16)
    zn = z0 + height * 0.70
    block(R_, P, -0.1, 0.1, -hs - 0.75, hs + 0.75, zn, zn + 0.3)                    # nuki
    for v in (-hs - 0.6, hs + 0.6):
        block(R_, P, -0.13, 0.13, v - 0.04, v + 0.04, zn + 0.02, zn + 0.28)          # its wedges
    block(R_, P, -0.1, 0.1, -0.14, 0.14, zn + 0.3, z0 + height - 0.7)              # gakuzuka
    zs = z0 + height - 0.7
    block(R_, P, -0.16, 0.16, -hs - 1.25, hs + 1.25, zs, zs + 0.28)                 # shimaki
    path = [P(0, v, zs + 0.28 + 0.38 * (abs(v) / (hs + 1.75)) ** 2.4) for v in np.linspace(-hs - 1.75, hs + 1.75, 25)]
    R_.sweep(path, [(-0.3, 0.0), (0.3, 0.0), (0.33, 0.42), (-0.33, 0.42)])          # kasagi, up-swept
    # the plaque: green with a gold frame and 須賀神社 in gold (drawn in the atlas)
    zq0, zq1 = zn + 0.15, zs + 0.05
    block(K("gold"), P, -0.22, -0.13, -0.5, 0.5, zq0 - 0.05, zq1 + 0.05)
    quad_img(K("atlas"), P(-0.225, 0.45, zq0), P(-0.225, -0.45, zq0), P(-0.225, -0.45, zq1), P(-0.225, 0.45, zq1), "gaku")
    # shimenawa: a straw rope sagging just under the nuki, three tassels, four paper streamers
    rope = [P(-0.05, v, zn - 0.12 - 0.3 * (1 - (v / hs) ** 2)) for v in np.linspace(-hs + 0.25, hs - 0.25, 15)]
    K("straw").tube(rope, 0.11, 8)
    for v in (-1.2, 0.0, 1.2):
        x, y, _ = P(-0.05, v, 0)
        zt = zn - 0.12 - 0.3 * (1 - (v / hs) ** 2)
        lathe_at(K("straw"), x, y, [(zt - 0.8, 0.02), (zt - 0.72, 0.13), (zt - 0.15, 0.08), (zt - 0.05, 0.05)], 8)
    for v in (-1.8, -0.6, 0.6, 1.8):
        zt = zn - 0.12 - 0.3 * (1 - (v / hs) ** 2)
        for j in range(4):  # a zigzag of paper
            dz, dv = j * 0.11, (0.05 if j % 2 else -0.05)
            K("paper").quad(P(-0.16, v + dv - 0.05, zt - dz - 0.11), P(-0.16, v + dv + 0.05, zt - dz - 0.11), P(-0.16, v - dv + 0.05, zt - dz), P(-0.16, v - dv - 0.05, zt - dz))


def quad_img(m, a, b, c, d, key):
    """A quad a-b-c-d (a bottom-left, counter-clockwise seen from its face) showing an atlas image."""
    u0, v0, u1, v1 = atlas_uv(key)
    m.quad(a, b, c, d, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]])


def lantern(K, x, y, z0, h=2.3):
    """A stone lantern (kasuga-doro, six-sided): base, post, middle stage, firebox (lit after dark), cap, finial."""
    S = K("stone")
    s = h / 2.3
    lathe_at(S, x, y, [(z0, 0.4 * s), (z0 + 0.22 * s, 0.38 * s), (z0 + 0.26 * s, 0.2 * s)], 6)
    lathe_at(S, x, y, [(z0 + 0.26 * s, 0.12 * s), (z0 + 1.08 * s, 0.11 * s)], 8)
    lathe_at(S, x, y, [(z0 + 1.08 * s, 0.16 * s), (z0 + 1.14 * s, 0.3 * s), (z0 + 1.24 * s, 0.3 * s), (z0 + 1.26 * s, 0.2 * s)], 6)
    lathe_at(S, x, y, [(z0 + 1.26 * s, 0.22 * s), (z0 + 1.66 * s, 0.22 * s)], 6)
    lathe_at(K("lamp", "lit"), x, y, [(z0 + 1.32 * s, 0.231 * s), (z0 + 1.6 * s, 0.231 * s)], 6)
    lathe_at(S, x, y, [(z0 + 1.66 * s, 0.5 * s), (z0 + 1.72 * s, 0.46 * s), (z0 + 1.95 * s, 0.1 * s), (z0 + 1.98 * s, 0.08 * s)], 6)
    lathe_at(S, x, y, [(z0 + 1.98 * s, 0.07 * s), (z0 + 2.05 * s, 0.12 * s), (z0 + 2.2 * s, 0.09 * s), (z0 + 2.3 * s, 0.0)], 8)


def komainu(K, P, z0, mouth_open):
    """A guardian lion-dog on its pedestal, facing +u in frame P (stone): the a-gyo open-mouthed, the un-gyo closed."""
    S = K("stone")
    taper(S, P, 0, 0, 0.95, 0.72, z0, 0.82, 0.6, z0 + 1.05)
    z = z0 + 1.05
    block(S, P, -0.38, 0.38, -0.27, 0.27, z, z + 0.1)
    block(S, P, -0.3, 0.05, -0.22, 0.22, z + 0.1, z + 0.46)        # haunches
    taper(S, lambda u, v, zz: P(u + 0.12, v, zz), 0, 0, 0.36, 0.38, z + 0.1, 0.3, 0.34, z + 0.78)  # chest
    for v in (-0.12, 0.12):
        block(S, P, 0.24, 0.33, v - 0.05, v + 0.05, z + 0.1, z + 0.58)   # forelegs
    block(S, P, 0.0, 0.2, -0.23, 0.23, z + 0.6, z + 1.06)          # mane
    block(S, P, 0.12, 0.42, -0.17, 0.17, z + 0.72, z + 1.02)       # head
    block(S, P, 0.42, 0.5, -0.1, 0.1, z + 0.74 + (0.0 if mouth_open else 0.04), z + 0.9)  # muzzle
    if mouth_open:
        block(K("stone_dark"), P, 0.43, 0.5, -0.08, 0.08, z + 0.72, z + 0.76)
    for v in (-0.15, 0.15):
        block(S, P, 0.16, 0.24, v - 0.04, v + 0.04, z + 1.02, z + 1.12)  # ears
    taper(S, lambda u, v, zz: P(u - 0.32, v, zz), 0, 0, 0.12, 0.3, z + 0.36, 0.08, 0.14, z + 0.92)  # flame tail


def temizuya(K, P, z0):
    """The ablution pavilion: four posts, a copper gable roof, the stone basin with its water and ladles."""
    for u in (-1.2, 1.2):
        for v in (-0.85, 0.85):
            slab_at(K("wood"), P, u, v, 0.16, 0.16, z0, z0 + 2.6)
    block(K("wood"), P, -1.35, 1.35, -0.95, 0.95, z0 + 2.5, z0 + 2.65)
    gable_roof(K("copper_green"), K("wood", "gable"), P, -1.3, 1.3, 1.0, z0 + 2.6, z0 + 3.45, ov=0.45)
    block(K("granite"), P, -0.75, 0.75, -0.35, 0.35, z0, z0 + 0.72)
    block(K("water"), P, -0.66, 0.66, -0.27, 0.27, z0 + 0.6, z0 + 0.66)
    block(K("wood_dark"), P, -0.7, 0.7, 0.36, 0.42, z0 + 0.7, z0 + 0.74)          # the ladle rest
    for k in range(5):
        u = -0.55 + k * 0.27
        K("wood_light").tube([P(u, 0.39, z0 + 0.75), P(u + 0.02, 0.15, z0 + 0.9)], 0.012, 4)
        lathe_at(K("wood_light"), *P(u + 0.02, 0.13, 0)[:2], [(z0 + 0.86, 0.04), (z0 + 0.94, 0.045)], 8)


def ema_rack(K, P, z0, length, rng):
    """The ema rack: posts, a little gable roof and three rails a side, hung thick with this year's ema,
    some showing their wishes and some the shrine's painting of the 男坂."""
    hl = length / 2
    for u in (-hl, 0.0, hl):
        slab_at(K("wood_dark"), P, u, 0, 0.1, 0.1, z0, z0 + 2.05)
    block(K("wood_dark"), P, -hl - 0.1, hl + 0.1, -0.06, 0.06, z0 + 1.95, z0 + 2.07)
    gable_roof(K("wood"), K("wood_dark", "gable"), P, -hl - 0.15, hl + 0.15, 0.32, z0 + 2.02, z0 + 2.32, ov=0.12)
    wishes = [k for k in ATLAS_KEYS if k.startswith("ema_w")]
    pinks = [k for k in ATLAS_KEYS if k.startswith("ema_pink")]
    A = K("atlas")
    for side in (-1, 1):
        for z in (1.08, 1.43, 1.78):
            block(K("wood_light"), P, -hl, hl, side * 0.11 - 0.015, side * 0.11 + 0.015, z0 + z - 0.015, z0 + z + 0.015)
            for layer in (0, 1):  # two overlapping layers, as a full rack hangs
                u = -hl + 0.06 + layer * 0.055
                while u < hl - 0.06:
                    face = rng.choice(pinks) if rng.random() < 0.06 else ("ema_front" if rng.random() < 0.28 else rng.choice(wishes))
                    back = "ema_front" if face != "ema_front" else rng.choice(wishes)
                    tilt = rng.normal(0, 0.12)
                    off = side * (0.135 + 0.012 * layer + rng.random() * 0.01)
                    ema(A, P, u, off, z0 + z - 0.055 - 0.015 * layer, side, tilt, face, back)
                    u += 0.105 + rng.random() * 0.03


EMA_W, EMA_H = 0.15, 0.10
EMA_SHAPE = [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.25), (0.0, 0.5), (-0.5, 0.25)]  # the house-shaped tablet, in widths and heights


def ema(m, P, u, v, zc, side, tilt, face, back):
    """One ema hung by its top at (u, v), facing out on `side` (+-1 across the rack): its front shows
    `face`, its back `back`, each a pentagon of the atlas."""
    c, s = math.cos(tilt), math.sin(tilt)
    for key, dv, flip in ((face, 0.0, 1), (back, -side * 0.004, -1)):
        u0, v0, u1, v1 = atlas_uv(key)
        pts, uvs = [], []
        for x, y in EMA_SHAPE:
            xx, yy = x * EMA_W * flip * side, y * EMA_H
            xr, yr = xx * c - yy * s, xx * s + yy * c
            pts.append(P(u + xr, v + dv, zc + yr))
            uvs.append([u0 + (x + 0.5) * (u1 - u0), v0 + (y + 0.5) * (v1 - v0)])
        for a, b in ((1, 2), (2, 3), (3, 4)):
            m.tri(pts[0], pts[a], pts[b], [uvs[0], uvs[a], uvs[b]])


def face_to(P, s0, v0, s1, v1):
    """A frame at (s0, v0) of frame P whose +u points at (s1, v1)."""
    a = P(s0, v0, 0)[:2]
    return frame(a, unit(P(s1, v1, 0)[:2] - a))


def hokora(K, P, z0, w=1.3, d=1.0, h=1.2):
    """A small shrine on a stone base, facing +u: a body with a dark opening and a copper gable roof."""
    block(K("granite"), P, -d / 2 - 0.2, d / 2 + 0.2, -w / 2 - 0.2, w / 2 + 0.2, z0, z0 + 0.45)
    block(K("wood"), P, -d / 2, d / 2, -w / 2, w / 2, z0 + 0.45, z0 + 0.45 + h)
    block(K("wood_dark"), P, d / 2, d / 2 + 0.02, -w * 0.3, w * 0.3, z0 + 0.6, z0 + 0.35 + h)  # its front, at +u
    gable_roof(K("copper_green"), K("wood", "gable"), lambda u, v, z: P(v, u, z), -w / 2, w / 2, d / 2, z0 + 0.45 + h, z0 + 0.9 + h, ov=0.3)


def stele(K, P, z0, w=0.6, h=1.5):
    block(K("granite"), P, -0.35, 0.35, -w / 2 - 0.15, w / 2 + 0.15, z0, z0 + 0.3)
    block(K("stone_dark"), P, -0.12, 0.12, -w / 2, w / 2, z0 + 0.3, z0 + 0.3 + h)


def small_torii(K, P, z0, span=1.4, h=2.1):
    R_ = K("vermilion")
    for v in (-span / 2, span / 2):
        x, y, _ = P(0, v, 0)
        lathe_at(R_, x, y, [(z0, 0.09), (z0 + h, 0.08)], 8)
    block(R_, P, -0.06, 0.06, -span / 2 - 0.3, span / 2 + 0.3, z0 + h * 0.78, z0 + h * 0.78 + 0.1)
    block(K("wood_dark"), P, -0.09, 0.09, -span / 2 - 0.45, span / 2 + 0.45, z0 + h, z0 + h + 0.14)
    block(R_, P, -0.08, 0.08, -span / 2 - 0.42, span / 2 + 0.42, z0 + h - 0.12, z0 + h)


def fox(K, P, z0):
    """A stone fox of the Inari, sitting on a pedestal, facing +u."""
    S = K("stone")
    block(S, P, -0.25, 0.25, -0.2, 0.2, z0, z0 + 0.7)
    block(S, P, -0.18, 0.08, -0.12, 0.12, z0 + 0.7, z0 + 1.0)
    block(S, P, -0.02, 0.2, -0.09, 0.09, z0 + 0.95, z0 + 1.15)
    block(S, P, 0.18, 0.3, -0.05, 0.05, z0 + 1.0, z0 + 1.08)
    for v in (-0.06, 0.06):
        block(S, P, 0.0, 0.06, v - 0.025, v + 0.025, z0 + 1.15, z0 + 1.26)
    block(S, P, -0.32, -0.16, -0.05, 0.05, z0 + 0.75, z0 + 1.1)


def stair_mesh(K, st, part, rails=(-1, 0, 1), wall=True):
    """Stone stairs from a strip's treads: treads, risers, side walls and the red iron handrails."""
    o, f = np.asarray(st["origin"], float), np.asarray(st["axis"], float)
    P = frame(o, f)
    hw = st["half_width"]
    T, Rz = K("granite", part), K("granite_dark", part)
    base = min(t[2] for t in st["treads"]) - st.get("riser_m", 0.15) - 2.0
    for u0, u1, z in st["treads"]:
        block(T, P, u0, u1, -hw, hw, z - 0.12, z)
        block(Rz, P, u0, u1, -hw, hw, base, z - 0.12)   # the mass under each tread (risers are its faces)
    if wall:  # retaining walls beside the flights, where the stairs are cut into the slope: up to the ground
        # beside each tread ("sides", measured by suga_finalize), and a kerb of 0.32 m where it is lower
        sides = st.get("sides") or [[None, None]] * len(st["treads"])
        for k, side in enumerate((-1, 1)):
            for (u0, u1, z), g in zip(st["treads"], sides):
                if u1 <= 0.05 or part != "otoko":
                    top = z + 0.32 if g[k] is None else min(max(z + 0.32, g[k] + 0.15), z + 3.5)
                    block(K("concrete", part), P, u0, u1, side * hw, side * (hw + 0.3), base, top)
    # handrails: posts every 1.6 m along each flight and at its ends, a round rail 0.85 m above the nosings
    for side in rails:
        v = side * (hw - 0.1)             # on posts at the edges of the treads, beside the walls, and down the middle
        pts = []                          # the front edge of each tread, and the far end of a landing
        for u0, u1, z in st["treads"]:
            pts.append((u0, z))
            if u1 - u0 > 0.6:
                pts.append((u1 - 0.3, z))
        pts.append((st["treads"][-1][1] - 0.2, st["treads"][-1][2]))
        K("rail_red", part).tube([P(u, v, z + 0.85) for u, z in pts], 0.026, 6)
        last = -99.0
        for k, (u, z) in enumerate(pts):
            if u - last >= 1.6 or k == len(pts) - 1:
                K("rail_red", part).tube([P(u, v, z), P(u, v, z + 0.85)], 0.022, 6)
                last = u


def suga_meshes(s):
    rng = np.random.default_rng(826)   # 26 August, the film's release day
    K = Kit("suga", floodlit=("lamp",))
    P = precinct_frame({"suga": s})
    # the stairs
    stair_mesh(K, s["otokozaka"], "otoko")
    if s.get("onnazaka"):
        for k, leg in enumerate(s["onnazaka"]["legs"]):
            stair_mesh(K, leg, "onna", rails=(1,), wall=True)
    # the approach: granite paving from the head of the 男坂 to the hall's steps
    pv = s["pave"]
    G = K("granite", "pave")
    for (s0, za0, zb0), (s1, za1, zb1) in zip(pv, pv[1:]):
        G.quad(P(s0, -1.2, za0 + 0.05), P(s1, -1.2, za1 + 0.05), P(s1, 1.2, zb1 + 0.05), P(s0, 1.2, zb0 + 0.05))
    # the great torii, facing the 男坂
    t = s["torii"]
    torii(K, lambda u, v, z: P(t["s"] + u, v, z), t["z"], t["span_m"], t["height_m"])
    for su, sv_, z in s["lanterns"]:
        lantern(K, *P(su, sv_, 0)[:2], z)
    for k, (su, sv_, z) in enumerate(s["komainu"]):
        komainu(K, face_to(P, su, sv_, su - 6.0, 0.0), z, k == 0)   # each looks down the approach, turned towards it
    hall(K, s)
    # the temizuya on the right, its long side along the approach; the く組 ladder mound beside it
    su, sv_, z = s["temizuya"]
    temizuya(K, lambda u, v, zz: P(su + u, sv_ + v, zz), z)
    su, sv_, z = s["kugumi"]
    stele(K, face_to(P, su, sv_, su, 0.0), z, 0.9, 1.4)
    # the ema rack, to the left of the approach before the hall
    r = s["ema_rack"]
    ema_rack(K, lambda u, v, zz: P(r["s"] + u, r["v"] + v, zz), r["z"], r["length_m"], rng)
    # nobori banners either side outside the torii, and the shrine's name on a stone post
    for su, sv_, z in s["nobori"]:
        x, y, _ = P(su, sv_, 0)
        K("paint_white").tube([np.array([x, y, z]), np.array([x, y, z + 4.9])], 0.035, 6)
        K("paint_white").tube([P(su, sv_, z + 4.75), P(su, sv_ - 0.62 * np.sign(sv_), z + 4.75)], 0.02, 4)
        a, b = P(su, sv_ - 0.04 * np.sign(sv_), z + 1.2), P(su, sv_ - 0.6 * np.sign(sv_), z + 1.2)
        up = np.array([0, 0, 3.5])
        quad_img(K("atlas"), a, b, b + up, a + up, "nobori")   # both faces read the right way round
        quad_img(K("atlas"), b, a, a + up, b + up, "nobori")
    su, sv_, z = s["shago"]
    block(K("granite"), P, su - 0.2, su + 0.2, sv_ - 0.2, sv_ + 0.2, z - 0.2, z + 2.5)
    quad_img(K("atlas"), P(su - 0.205, sv_ + 0.17, z + 0.3), P(su - 0.205, sv_ - 0.17, z + 0.3), P(su - 0.205, sv_ - 0.17, z + 2.4), P(su - 0.205, sv_ + 0.17, z + 2.4), "shago")
    # Daikoku and the ancestors' shrine, the memorials, the board on the 36 poets
    su, sv_, z = s["daikoku"]
    hokora(K, face_to(P, su, sv_, su - 4.0, 0.0), z)
    su, sv_, z = s["sorei"]
    hokora(K, face_to(P, su, sv_, su, 0.0), z, 1.5, 1.2, 1.4)
    for key in ("ireihi", "iizuka"):
        su, sv_, z = s[key]
        stele(K, face_to(P, su, sv_, su, 0.0), z, 0.7, 1.7 if key == "ireihi" else 1.2)
    if "kasen_board" in s:
        su, sv_, z = s["kasen_board"]
        for v in (-0.6, 0.6):
            slab_at(K("wood_dark"), P, su, sv_ + v, 0.08, 0.08, z, z + 1.8)
        quad_img(K("atlas"), P(su - 0.05, sv_ + 0.6, z + 0.9), P(su - 0.05, sv_ - 0.6, z + 0.9), P(su - 0.05, sv_ - 0.6, z + 1.7), P(su - 0.05, sv_ + 0.6, z + 1.7), "kasen")
    # the Tenpaku Inari on its own footprint, two small torii and its foxes before it
    if "tenpaku" in s:
        tp = s["tenpaku"]
        a = math.radians(tp["axis_deg"])
        fa = np.array([math.cos(a), math.sin(a)])
        # its front faces the approach side of its footprint
        to_axis = np.array(s["origin"]) + np.array(s["axis"]) * (s["hall"]["s_front"] + 3) - np.array(tp["centre"])
        fn = left_of(fa) if left_of(fa) @ to_axis > 0 else -left_of(fa)
        Q = frame(tp["centre"], fn)
        hokora(K, Q, tp["z"], tp["long_m"] - 0.8, tp["short_m"] - 0.8, 1.9)   # its front is a long side
        for k in (1, 2):
            small_torii(K, lambda u, v, zz, k=k: Q(tp["short_m"] / 2 + 0.6 * k + u, v, zz), tp["z"])
        for v in (-0.9, 0.9):
            fox(K, lambda u, w, zz, v=v: Q(tp["short_m"] / 2 + 0.3 + u, v + w, zz), tp["z"])
    return K.meshes()


# ---------------------------------------------------------------- the drawn atlas (landmark_assets)

# fonts for the drawn images: Google Fonts, SIL Open Font License, fetched once into data/raw/fonts
FONTS = {
    "yomogi": "ofl/yomogi/Yomogi-Regular.ttf", "kurenaido": "ofl/zenkurenaido/ZenKurenaido-Regular.ttf",
    "klee": "ofl/kleeone/KleeOne-SemiBold.ttf", "syuku": "ofl/yujisyuku/YujiSyuku-Regular.ttf",
    "mincho": "ofl/shipporimincho/ShipporiMincho-Bold.ttf", "dot": "ofl/dotgothic16/DotGothic16-Regular.ttf",
    "rocknroll": "ofl/rocknrollone/RocknRollOne-Regular.ttf", "mashan": "ofl/mashanzheng/MaShanZheng-Regular.ttf",
    "kuaile": "ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf", "longcang": "ofl/longcang/LongCang-Regular.ttf",
    "wenkai": "ofl/lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf", "nanumpen": "ofl/nanumpenscript/NanumPenScript-Regular.ttf",
    "gaegu": "ofl/gaegu/Gaegu-Regular.ttf", "caveat": "ofl/caveat/Caveat%5Bwght%5D.ttf", "kalam": "ofl/kalam/Kalam-Regular.ttf",
}
FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/{}"

# this year's wishes on the rack: (font, lines, ink, doodle). Written for this model: visitors' kinds of
# wishes in their own languages, many for the film's tenth anniversary; no lines quoted from the film.
WISHES = [
    ("yomogi", ["君の名は。", "公開10周年", "おめでとう!", "2016→2026"], "#24324d", "comet"),
    ("kurenaido", ["10年経っても", "この階段で", "胸がぎゅっとなる", "2026.8.26"], "#2a2a2a", "stairs"),
    ("yomogi", ["瀧くんと三葉が", "ずっと幸せで", "ありますように"], "#3a2a6a", "cord"),
    ("klee", ["聖地巡礼", "ついに来れた!", "令和八年 夏"], "#2a2a2a", "torii"),
    ("kurenaido", ["組紐みたいに", "ご縁が", "結ばれますように"], "#7a1f2b", "cord"),
    ("yomogi", ["大切な人の", "名前を", "忘れませんように"], "#1d3557", "heart"),
    ("klee", ["彗星を観た夏から", "もう十年。", "また会えますように"], "#22305a", "comet"),
    ("yomogi", ["10周年の再上映", "3回観ました!", "ありがとう"], "#3b2a20", "star"),
    ("syuku", ["合格祈願", "東京の大学に", "行けますように", "令和八年"], "#1a1a1a", None),
    ("syuku", ["家内安全", "健康第一", "令和八年 丙午"], "#1a1a1a", "uma"),
    ("kurenaido", ["四ツ谷に越して一年", "毎朝この坂を", "上っています"], "#2a2a2a", "stairs"),
    ("klee", ["劇場版", "大ヒット祈願", "制作スタッフ一同", "2026"], "#1a1a1a", None),
    ("yomogi", ["夕暮れの階段で", "誰かとすれ違った", "気がした"], "#4a2a4a", "dusk"),
    ("kurenaido", ["初詣 2026", "今年こそ", "運命の人に", "出会えますように"], "#8a2030", "heart"),
    ("syuku", ["就職成就", "令和八年"], "#1a1a1a", "uma"),
    ("yomogi", ["三葉ちゃん", "大好き♡", "10th anniversary"], "#c2185b", "heart"),
    ("klee", ["新海監督", "素敵な十年を", "ありがとう"], "#22305a", "comet"),
    ("kurenaido", ["ずっと探してた", "この景色。", "来てよかった"], "#2a2a2a", "stairs"),
    ("yomogi", ["かたわれ時に", "また来ます", "2026.10"], "#5a2a5a", "dusk"),
    ("klee", ["Persona5の聖地から", "Your Nameの聖地へ", "東京巡礼 2026"], "#b00020", "stairs"),
    ("mashan", ["《你的名字》", "十周年快乐!", "终于站在这段阶梯上", "2026.8"], "#1a1a1a", "stairs"),
    ("kuaile", ["希望我也能", "遇见命中注定的", "那个人"], "#c2185b", "heart"),
    ("longcang", ["从上海来", "十年了", "还是会哭"], "#1d3557", "comet"),
    ("mashan", ["愿所有相遇", "都不被遗忘", "2026 须贺神社"], "#7a1f2b", "cord"),
    ("kuaile", ["家人平安", "工作顺利", "2026"], "#2a2a2a", None),
    ("wenkai", ["你的名字", "十週年快樂", "從台北來朝聖", "2026.10"], "#1d3557", "stairs"),
    ("wenkai", ["希望能和", "那個人再次相遇", "♡"], "#8a2030", "heart"),
    ("nanumpen", ["너의 이름은", "10주년 축하해!", "2026"], "#22305a", "comet"),
    ("nanumpen", ["드디어 왔다", "스가 신사 계단", "꿈이 이루어졌어요"], "#2a2a2a", "stairs"),
    ("caveat", ["Happy 10th", "anniversary,", "Your Name!", "Melbourne 2026"], "#22305a", "comet"),
    ("kalam", ["Climbed the stairs", "at dusk. Still", "looking for", "someone."], "#4a2a4a", "dusk"),
    ("caveat", ["10 years, 1 comet,", "a million", "goosebumps."], "#1d3557", "comet"),
    ("kalam", ["May we always", "find each other.", "2026"], "#7a1f2b", "cord"),
    ("caveat", ["¡10 años de", "Kimi no Na wa!", "México 2026"], "#1b5e20", "star"),
    ("kalam", ["Dix ans déjà…", "merci pour", "ce film.", "Paris 2026"], "#22305a", "heart"),
    ("caveat", ["Thanks for", "the magic,", "Suga-jinja!"], "#2a2a2a", "torii"),
    ("syuku", ["商売繁盛", "令和八年"], "#1a1a1a", None),
    ("syuku", ["交通安全", "令和八年 四谷"], "#1a1a1a", None),
    ("yomogi", ["猫のミケが", "元気で", "いますように"], "#3b2a20", "heart"),
    ("kurenaido", ["東京に来て十年", "あの映画が", "背中を押してくれた"], "#22305a", "comet"),
]
PINKS = [("yomogi", ["10周年", "おめでとう"], "#ad1457"), ("kurenaido", ["恋愛成就", "2026"], "#ad1457"), ("klee", ["縁結び", "令和八年"], "#ad1457")]

EMA_CELL = (192, 128)


def atlas_items():
    """(key, width, height) of every image in the atlas, in packing order."""
    items = [("ema_front", *EMA_CELL)] + [(f"ema_w{i}", *EMA_CELL) for i in range(len(WISHES))]
    items += [(f"ema_pink{i}", *EMA_CELL) for i in range(len(PINKS))]
    items += [("gaku", 160, 224), ("nobori", 96, 512), ("shago", 64, 448), ("kasen", 288, 192)]
    items += EXTRA_ATLAS
    return items


def atlas_layout(width=2048, pad=4):
    """Shelf-pack the atlas: {key: (x, y, w, h)} in pixels, and the atlas size."""
    out, x, y, row = {}, 0, 0, 0
    for key, w, h in atlas_items():
        if x + w + 2 * pad > width:
            x, y, row = 0, y + row, 0
        out[key] = (x + pad, y + pad, w, h)
        x += w + 2 * pad
        row = max(row, h + 2 * pad)
    height = int(math.ceil((y + row) / 256.0) * 256)
    return out, (width, height)


def atlas_uv(key):
    """The atlas rectangle of an image as texture coordinates (u0, v0, u1, v1), v up."""
    rects, (W, H) = atlas_layout()
    x, y, w, h = rects[key]
    return x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H


def font(name, size):
    from PIL import ImageFont
    d = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "raw", "fonts")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, os.path.basename(FONTS[name]).replace("%5B", "[").replace("%5D", "]"))
    if not os.path.exists(path):
        urllib.request.urlretrieve(FONT_URL.format(FONTS[name]), path)
    return ImageFont.truetype(path, size)


def fit_lines(draw, lines, fname, box_w, box_h, max_size=30):
    """The largest font size at which the lines fit the box, and the font."""
    for size in range(max_size, 7, -1):
        f = font(fname, size)
        ws = [draw.textlength(t, font=f) for t in lines]
        if max(ws) <= box_w and size * 1.18 * len(lines) <= box_h:
            return f, size
    return font(fname, 8), 8


def ema_shape_px(x, y, w, h):
    """EMA_SHAPE in an atlas cell's pixels (y down)."""
    return [(x + (px + 0.5) * w, y + (0.5 - py) * h) for px, py in EMA_SHAPE]


def wood(img, d, rect, rng, base=(227, 201, 160)):
    """A wooden tablet: a warm ground with faint grain, a darker bevel at the edge, the hole and its red cord."""
    x, y, w, h = rect
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=base)
    for k in range(int(h / 5)):
        yy = y + k * 5 + rng.random() * 3
        col = tuple(int(c * (0.9 + 0.08 * rng.random())) for c in base)
        d.line([(x + t * w, yy + 1.5 * math.sin(t * 7 + k)) for t in np.linspace(0, 1, 9)], fill=col, width=1)
    d.polygon(ema_shape_px(x, y, w, h), outline=(150, 112, 70), width=3)
    cx = x + w / 2
    d.ellipse([cx - 4, y + 10, cx + 4, y + 18], fill=(90, 60, 40))
    d.line([(cx, y + 2), (cx, y + 14)], fill=(200, 40, 40), width=3)


def doodle(d, kind, box, rng):
    x0, y0, x1, y1 = box
    cx, cy, s = (x0 + x1) / 2, (y0 + y1) / 2, min(x1 - x0, y1 - y0)
    if kind == "comet":   # a head and a long tail across the corner
        for k in range(14):
            t = k / 13
            r = s * 0.04 * (1 - t) + 1
            d.ellipse([x1 - s * 0.15 - t * s * 0.8 - r, y0 + s * 0.15 + t * s * 0.45 - r, x1 - s * 0.15 - t * s * 0.8 + r, y0 + s * 0.15 + t * s * 0.45 + r],
                      fill=(int(80 + 120 * t), int(140 + 60 * t), 230))
        d.ellipse([x1 - s * 0.22, y0 + s * 0.08, x1 - s * 0.08, y0 + s * 0.22], fill=(250, 250, 255), outline=(120, 160, 230), width=2)
    elif kind == "cord":  # a braided cord tied in a bow
        pts = [(x0 + t * (x1 - x0), cy + math.sin(t * 9) * s * 0.07) for t in np.linspace(0, 1, 40)]
        pts2 = [(x0 + t * (x1 - x0), cy - math.sin(t * 9) * s * 0.07) for t in np.linspace(0, 1, 40)]
        d.line(pts, fill=(200, 40, 50), width=3)
        d.line(pts2, fill=(230, 120, 40), width=3)
        d.ellipse([cx - s * 0.08, cy - s * 0.06, cx + s * 0.08, cy + s * 0.06], outline=(200, 40, 50), width=3)
    elif kind == "stairs":  # the stairs and their red rail, as everyone draws them
        n = 6
        for k in range(n):
            xa = x0 + (x1 - x0) * k / n
            ya = y1 - (y1 - y0) * k / n
            d.line([(xa, ya), (xa + (x1 - x0) / n, ya), (xa + (x1 - x0) / n, ya - (y1 - y0) / n)], fill=(90, 90, 90), width=2)
        d.line([(x0, y1 - (y1 - y0) * 0.45), (x1, y0 - (y1 - y0) * 0.1)], fill=(200, 40, 40), width=3)
    elif kind == "heart":
        r = s * 0.18
        d.ellipse([cx - r * 1.9, cy - r, cx, cy + r * 0.8], fill=(230, 80, 110))
        d.ellipse([cx, cy - r, cx + r * 1.9, cy + r * 0.8], fill=(230, 80, 110))
        d.polygon([(cx - r * 1.85, cy + r * 0.1), (cx + r * 1.85, cy + r * 0.1), (cx, cy + r * 2.0)], fill=(230, 80, 110))
    elif kind == "star":
        pts = [(cx + math.cos(a) * s * (0.35 if k % 2 == 0 else 0.15), cy + math.sin(a) * s * (0.35 if k % 2 == 0 else 0.15))
               for k, a in enumerate(np.linspace(-math.pi / 2, 1.5 * math.pi, 11)[:-1])]
        d.polygon(pts, fill=(250, 200, 50), outline=(190, 140, 20))
    elif kind == "torii":
        d.line([(x0, y0 + s * 0.15), (x1, y0 + s * 0.15)], fill=(210, 80, 60), width=4)
        d.line([(x0 + s * 0.12, y0 + s * 0.35), (x1 - s * 0.12, y0 + s * 0.35)], fill=(210, 80, 60), width=3)
        for xx in (x0 + s * 0.25, x1 - s * 0.25):
            d.line([(xx, y0 + s * 0.15), (xx, y1)], fill=(210, 80, 60), width=4)
    elif kind == "dusk":  # a low sun and the twilight band
        for k in range(8):
            c = (int(250 - 10 * k), int(160 - 12 * k), int(110 + 12 * k))
            d.line([(x0, y0 + k * 3), (x1, y0 + k * 3)], fill=c, width=3)
        d.ellipse([cx - s * 0.12, y0 + 12, cx + s * 0.12, y0 + 12 + s * 0.24], fill=(255, 200, 120))
    elif kind == "uma":   # the year's zodiac stamp: 午, the horse (2026, hinoe-uma)
        f = font("syuku", int(s * 0.5))
        d.ellipse([cx - s * 0.36, cy - s * 0.36, cx + s * 0.36, cy + s * 0.36], outline=(200, 30, 30), width=3)
        d.text((cx, cy), "午", font=f, fill=(200, 30, 30), anchor="mm")


def draw_ema_front(img, d, rect, rng):
    """The shrine's own ema: the 男坂 painted in colour (sky, the stone stairs and their three red rails
    between the houses), the shrine's name in a red seal."""
    x, y, w, h = rect
    wood(img, d, rect, rng)
    px0, py0, px1, py1 = x + 14, y + 34, x + w - 14, y + h - 12
    for k in range(int(py1 - py0)):   # evening sky: blue to rose
        t = k / (py1 - py0)
        d.line([(px0, py0 + k), (px1, py0 + k)], fill=(int(120 + 120 * t), int(170 + 40 * t), int(230 - 60 * t)))
    cx = (px0 + px1) / 2
    d.polygon([(px0, py0 + 18), (cx - 18, py0 + 30), (cx - 30, py1), (px0, py1)], fill=(205, 196, 178))   # houses, left
    d.polygon([(px1, py0 + 14), (cx + 18, py0 + 30), (cx + 30, py1), (px1, py1)], fill=(190, 182, 168))   # and right
    d.polygon([(cx - 14, py0 + 30), (cx + 14, py0 + 30), (cx + 34, py1), (cx - 34, py1)], fill=(150, 146, 138))  # the stairs
    for k in range(9):
        t = (k + 1) / 10
        yy = py0 + 30 + (py1 - py0 - 30) * t ** 1.3
        half = 14 + 20 * t ** 1.3
        d.line([(cx - half, yy), (cx + half, yy)], fill=(110, 106, 100), width=1)
    for sx in (-1, 0, 1):  # the three red handrails converging up the stairs
        d.line([(cx + sx * 34, py1 - 4), (cx + sx * 14, py0 + 24)], fill=(205, 40, 35), width=3)
    d.polygon([(px0, py0 + 6), (px0 + 26, py0 - 4), (px0 + 40, py0 + 20)], fill=(70, 110, 70))   # the shrine's trees
    d.rectangle([px1 - 30, py1 - 34, px1 - 6, py1 - 6], fill=(200, 35, 35))
    f = font("mincho", 10)
    for k, ch in enumerate("須賀"):
        d.text((px1 - 18, py1 - 28 + k * 11), ch, font=f, fill=(255, 245, 230), anchor="mm")


def draw_wish(img, d, rect, wish, rng):
    fname, lines, ink, kind = wish
    x, y, w, h = rect
    wood(img, d, rect, rng)
    box = (x + 14, y + 30, x + w - 14, y + h - 10)
    tw = (box[2] - box[0]) * (0.68 if kind else 1.0)
    f, size = fit_lines(d, lines, fname, tw, box[3] - box[1], 26)
    lh = size * 1.18
    y0 = box[1] + ((box[3] - box[1]) - lh * len(lines)) / 2
    xc = box[0] + tw / 2 if kind else (box[0] + box[2]) / 2
    for k, t in enumerate(lines):
        d.text((xc + rng.normal(0, 1.2), y0 + k * lh + lh / 2), t, font=f, fill=ink, anchor="mm")
    if kind:
        doodle(d, kind, (box[0] + tw + 2, box[1] + 4, box[2], box[3] - 6), rng)


def draw_pink(img, d, rect, wish, rng):
    fname, lines, ink = wish
    wood(img, d, rect, rng, base=(244, 186, 206))
    x, y, w, h = rect
    f, size = fit_lines(d, lines, fname, w - 40, h - 46, 28)
    for k, t in enumerate(lines):
        d.text((x + w / 2, y + 40 + k * size * 1.2 + size / 2), t, font=f, fill=ink, anchor="mm")
    doodle(d, "heart", (x + w - 46, y + 34, x + w - 12, y + 64), rng)


def draw_vertical(d, text, cx, y0, y1, fname, fill, max_size=None, width=None):
    n = len(text)
    size = int(min((y1 - y0) / n * 0.92, max_size or 999, (width or 999) * 0.86))
    f = font(fname, size)
    for k, ch in enumerate(text):
        d.text((cx, y0 + (k + 0.5) * (y1 - y0) / n), ch, font=f, fill=fill, anchor="mm")


def draw_shrine_items(img, d, rects, rng):
    x, y, w, h = rects["gaku"]   # the torii's plaque: green with a gold frame and gold letters
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(200, 160, 60))
    d.rectangle([x + 12, y + 12, x + w - 12, y + h - 12], fill=(38, 92, 70))
    d.rectangle([x + 18, y + 18, x + w - 18, y + h - 18], outline=(214, 172, 70), width=3)
    draw_vertical(d, "須賀神社", x + w / 2, y + 26, y + h - 26, "syuku", (226, 186, 80), width=w - 36)
    x, y, w, h = rects["nobori"]  # a red banner: 須賀神社, and 奉納 at its foot
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(196, 30, 36))
    d.rectangle([x, y, x + w, y + 18], fill=(240, 236, 226))
    draw_vertical(d, "須賀神社", x + w / 2, y + 40, y + h - 110, "syuku", (250, 246, 236), width=w)
    draw_vertical(d, "奉納", x + w / 2, y + h - 96, y + h - 20, "mincho", (250, 246, 236), 34)
    x, y, w, h = rects["shago"]   # the stone post at the approach: the name cut in the granite
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(150, 146, 138))
    for k in range(60):
        d.point((x + rng.random() * w, y + rng.random() * h), fill=(120, 116, 110))
    draw_vertical(d, "須賀神社", x + w / 2, y + 30, y + h - 30, "mincho", (60, 58, 56), width=w)
    x, y, w, h = rects["kasen"]   # the board on the shrine's 36 poets (Shinjuku City cultural property)
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(240, 236, 224))
    d.rectangle([x + 2, y + 2, x + w - 2, y + h - 2], outline=(90, 70, 50), width=3)
    f1, f2 = font("mincho", 22), font("klee", 13)
    d.text((x + w / 2, y + 26), "三十六歌仙絵", font=f1, fill=(40, 30, 20), anchor="mm")
    for k, t in enumerate(["新宿区指定有形文化財（絵画）", "天保七年（一八三六）奉納", "絵 大岡雲峰  書 千種有功", "須賀神社"]):
        d.text((x + w / 2, y + 62 + k * 28), t, font=f2, fill=(50, 40, 30), anchor="mm")


def landmark_assets(out_dir, scene):
    """Draw the atlas the materials' "map" names: the ema, the shrine's plaque, banner and post, and the
    signs and screens of the other districts (EXTRA_ATLAS)."""
    from PIL import Image, ImageDraw
    rects, (W, H) = atlas_layout()
    img = Image.new("RGB", (W, H), (120, 110, 100))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(2026)
    draw_ema_front(img, d, rects["ema_front"], rng)
    for i, wsh in enumerate(WISHES):
        draw_wish(img, d, rects[f"ema_w{i}"], wsh, rng)
    for i, p in enumerate(PINKS):
        draw_pink(img, d, rects[f"ema_pink{i}"], p, rng)
    draw_shrine_items(img, d, rects, rng)
    draw_extra(img, d, rects, rng)
    img.save(os.path.join(out_dir, "atlas.jpg"), quality=90)
    return ["atlas.jpg"]


ATLAS_KEYS = ["ema_front"] + [f"ema_w{i}" for i in range(len(WISHES))] + [f"ema_pink{i}" for i in range(len(PINKS))]


# ---------------------------------------------------------------- Persona 5's Tokyo: Shibuya, Yongen-Jaya, Shinjuku
#
# Persona 5 (Atlus, 2016) drew its Tokyo from real streets: Station Square is Hachiko Square, Central
# Street is Center Gai, the hideout is the passage over the scramble that holds Okamoto Taro's mural,
# Yongen-Jaya is Sangenjaya's backstreets (the front of Café Leblanc is the snack bar New Marina's; the
# bathhouse is Chiyo-no-yu, the supermarket Hanamasa), and Shinjuku's red-light district is Kabukicho.
# The model is the real city; the game's places are those streets as they are in 2026. Nothing of the
# game's art is copied: no characters, logos or invented shops; the Aoi-gaeru train car that stood on
# Hachiko Square in the game left for Odate in 2020, so it is not here. The sizes of signs, screens
# and gates below are indicative, from photographs, unless a source is named.

HACHIKO = "忠犬ハチ公像"                         # Overture infrastructure (OSM artwork) on Hachiko Square
CROSSING_ROADS = {"道玄坂", "神宮通り", "旧大山街道", "渋谷センター街"}   # the four streets that meet at the scramble
CENTER_GAI = "渋谷センター街"
SCREENS = ["Q-FRONT", "MAGNET SHIBUYA", "渋谷駅前ビル", "西武渋谷店A館"]   # facades with big screens round the scramble
S109 = "Shibuya 109"
CARROT, CHIYO, HANAMASA = "キャロットタワー", "千代の湯", "肉のハナマサ"
MARINA_LL = (139.669257, 35.642788)   # Overture place ニューマリーナ (snack bar, 三軒茶屋2-14-21)
RAIN_LL = (139.669289, 35.642574)     # Overture place Rain on the Roof (cafe, 三軒茶屋2-14-22, first floor up)
DOCOMO = "ドコモ代々木タワー"
DOCOMO_FIG = {"clock_d_m": 15.0, "clock_z_m": 150.0, "mast_top_m": 272.0}  # Citizen clock, 2002 (Tokyo tourism; TV Tokyo); 892 ft (SkyscraperPage)
KABUKI_ST = "歌舞伎町一番街通り"
# districts whose street fronts carry shop signs: centre (lon, lat) and radius in metres
SIGN_DISTRICTS = {
    "Center Gai and Udagawacho": ((139.6985, 35.6608), 190), "Dogenzaka": ((139.6975, 35.6585), 120),
    "Sangenjaya (Yongen-Jaya)": ((139.6695, 35.6430), 170), "Kabukicho": ((139.7025, 35.6945), 210),
    "Golden Gai": ((139.7046, 35.6940), 60), "Shinjuku 3-chome": ((139.7055, 35.6905), 150),
    "Shinjuku 2-chome": ((139.7082, 35.6905), 110),
}
MAX_SIGNS = 2200
SIGN_CLASSES = {"", "commercial", "retail", "entertainment", "hotel", "restaurant", "office", "mixed_use"}

MATERIALS.update({
    "neon_red": {"color": "#ff3b3b", "roughness": 0.4, "metalness": 0.0, "emissive": "#ff2a2a", "glow": 2.6},
    "neon_pink": {"color": "#ff5fb0", "roughness": 0.4, "metalness": 0.0, "emissive": "#ff3fa4", "glow": 2.2},
    "screen_frame": {"color": "#1c1e22", "roughness": 0.5, "metalness": 0.4},
    "orange_tile": {"color": "#c9663a", "roughness": 0.8, "metalness": 0.0},
    "corrugated": {"color": "#9aa0a3", "roughness": 0.6, "metalness": 0.4},
    "clock_face": {"color": "#f1efe6", "roughness": 0.5, "metalness": 0.0, "emissive": "#fff6dc", "glow": 1.4},
})

SCREEN_ADS = [  # what the screens show: invented, colourful, no brands
    ("SHIBUYA", "SCRAMBLE 2026", ((255, 70, 140), (60, 40, 200))),
    ("渋谷", "NEW MUSIC FRIDAY", ((20, 200, 220), (20, 30, 90))),
    ("TOKYO", "NIGHT LIVE 24:00", ((255, 190, 40), (230, 40, 60))),
    ("夏祭り", "AUTUMN SALE 10.29", ((250, 120, 40), (120, 20, 120))),
    ("STREAM", "ON AIR", ((90, 230, 120), (10, 70, 90))),
]
BLADES = [("居酒屋", (200, 30, 40), (255, 245, 230)), ("カラオケ", (250, 220, 40), (200, 20, 40)), ("ラーメン", (230, 60, 30), (255, 255, 240)),
          ("焼肉", (20, 20, 20), (240, 200, 60)), ("BAR", (30, 30, 80), (120, 220, 255)), ("スナック", (150, 40, 140), (255, 220, 250)),
          ("喫茶", (90, 50, 30), (250, 230, 200)), ("古着", (30, 90, 60), (250, 250, 240)), ("寿司", (245, 245, 240), (30, 30, 30)),
          ("中華", (200, 20, 20), (255, 210, 60)), ("焼鳥", (240, 120, 20), (40, 20, 10)), ("珈琲", (40, 30, 25), (230, 200, 150)),
          ("占い", (60, 20, 90), (250, 200, 90)), ("餃子", (255, 255, 255), (200, 20, 30)), ("酒場", (10, 60, 120), (255, 255, 255)),
          ("漫画", (240, 80, 30), (255, 255, 255)), ("ゲーム", (30, 160, 220), (255, 255, 255)), ("美容室", (245, 240, 235), (60, 60, 60)),
          ("牛丼", (240, 140, 20), (40, 20, 10)), ("そば", (20, 40, 30), (240, 230, 200)), ("ホルモン", (180, 20, 20), (255, 230, 200)),
          ("薬", (40, 120, 200), (255, 255, 255)), ("中古", (250, 220, 0), (30, 30, 30)), ("立ち飲み", (120, 20, 20), (255, 240, 200))]
BOARDS = [("いらっしゃいませ", (200, 30, 40), (255, 255, 255)), ("営業中", (20, 60, 140), (255, 255, 255)), ("カラオケ 1時間 500円", (250, 210, 30), (180, 20, 30)),
          ("らーめん", (230, 230, 225), (180, 20, 20)), ("焼肉 食べ放題", (20, 20, 20), (240, 190, 40)), ("ゲームセンター", (30, 150, 220), (255, 255, 255)),
          ("BAR & DINING", (25, 25, 30), (255, 120, 200)), ("古着 USED", (60, 40, 30), (250, 230, 200)), ("24時間営業", (40, 160, 80), (255, 255, 255)),
          ("立ち食いそば", (240, 240, 230), (20, 60, 30)), ("ホテル", (90, 30, 120), (255, 210, 250)), ("占い 手相", (40, 20, 70), (250, 210, 100))]


def district_atlas():
    items = [("centergai", 768, 128), ("kabukicho", 768, 160), ("s109", 128, 512), ("hachiko", 256, 96), ("noren_yu", 256, 160),
             ("chiyo", 384, 96), ("laundry", 384, 96), ("marina", 320, 96), ("rain", 256, 64), ("hanamasa", 512, 112), ("clock", 256, 256)]
    items += [(f"screen{i}", 512, 288) for i in range(len(SCREEN_ADS))]
    items += [(f"vend{i}", 128, 224) for i in range(3)]
    items += [(f"blade{i}", 64, 256) for i in range(len(BLADES))]
    items += [(f"board{i}", 384, 96) for i in range(len(BOARDS))]
    items += [("geocompass", 512, 512)]
    return items


EXTRA_ATLAS = district_atlas()


def panel(d, rect, bg, fg, text, fname, pad=10, outline=None):
    x, y, w, h = rect
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=bg)
    if outline:
        d.rectangle([x + 3, y + 3, x + w - 3, y + h - 3], outline=outline, width=4)
    f, size = fit_lines(d, [text], fname, w - 2 * pad, h - 2 * pad, 120)
    d.text((x + w / 2, y + h / 2), text, font=f, fill=fg, anchor="mm")


def draw_extra(img, d, rects, rng):
    panel(d, rects["centergai"], (230, 230, 225), (200, 20, 40), "SHIBUYA CENTER-GAI", "rocknroll", 14, (200, 20, 40))
    x, y, w, h = rects["kabukicho"]   # red letters on white, framed in red neon
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(250, 248, 244))
    d.rectangle([x + 4, y + 4, x + w - 4, y + h - 4], outline=(235, 30, 40), width=7)
    f, _ = fit_lines(d, ["歌舞伎町一番街"], "mincho", w - 60, h - 30, 120)
    d.text((x + w / 2, y + h / 2), "歌舞伎町一番街", font=f, fill=(225, 25, 35), anchor="mm")
    x, y, w, h = rects["s109"]
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(245, 245, 245))
    draw_vertical(d, "SHIBUYA", x + w / 2, y + 14, y + h - 140, "rocknroll", (20, 20, 20), width=w - 10)
    f = font("rocknroll", 54)
    d.text((x + w / 2, y + h - 66), "109", font=f, fill=(230, 20, 60), anchor="mm")
    x, y, w, h = rects["hachiko"]     # the pedestal's bronze plate
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(96, 78, 52))
    d.rectangle([x + 6, y + 6, x + w - 6, y + h - 6], outline=(170, 140, 90), width=3)
    f, _ = fit_lines(d, ["忠犬ハチ公"], "mincho", w - 30, h - 24, 60)
    d.text((x + w / 2, y + h / 2), "忠犬ハチ公", font=f, fill=(215, 185, 120), anchor="mm")
    x, y, w, h = rects["noren_yu"]    # indigo curtains, the bath's ゆ in white, split in three
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(28, 48, 98))
    for k in (1, 2):
        d.line([(x + w * k / 3, y + 26), (x + w * k / 3, y + h)], fill=(18, 30, 64), width=4)
    d.rectangle([x, y, x + w, y + 22], fill=(18, 30, 64))
    f = font("syuku", 96)
    d.text((x + w / 2, y + h / 2 + 12), "ゆ", font=f, fill=(250, 250, 250), anchor="mm")
    panel(d, rects["chiyo"], (246, 240, 225), (30, 30, 30), "千代の湯", "syuku", 10, (120, 30, 30))
    panel(d, rects["laundry"], (240, 248, 255), (20, 80, 170), "COIN LAUNDRY コインランドリー", "rocknroll", 10, (20, 80, 170))
    panel(d, rects["marina"], (60, 20, 70), (255, 210, 245), "スナック ニューマリーナ", "rocknroll", 12, (255, 120, 220))
    panel(d, rects["rain"], (40, 40, 40), (230, 230, 220), "RAIN ON THE ROOF 2F", "kalam", 8)
    panel(d, rects["hanamasa"], (250, 210, 0), (200, 20, 20), "肉のハナマサ", "mincho", 10)
    x, y, w, h = rects["clock"]       # a white dial with bar markers (the hands are meshes)
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(40, 44, 50))
    d.ellipse([x + 4, y + 4, x + w - 4, y + h - 4], fill=(244, 242, 234), outline=(60, 64, 70), width=6)
    cx, cy, r = x + w / 2, y + h / 2, w / 2 - 14
    for k in range(12):
        a = k * math.pi / 6
        r0 = r * (0.78 if k % 3 == 0 else 0.86)
        d.line([(cx + r0 * math.sin(a), cy - r0 * math.cos(a)), (cx + r * math.sin(a), cy - r * math.cos(a))], fill=(40, 44, 50), width=8 if k % 3 == 0 else 4)
    for i, (big, small, (c0, c1)) in enumerate(SCREEN_ADS):
        x, y, w, h = rects[f"screen{i}"]
        for k in range(h + 8):
            t = k / (h + 8)
            d.line([(x - 4, y - 4 + k), (x + w + 4, y - 4 + k)], fill=tuple(int(a + (b - a) * t) for a, b in zip(c0, c1)))
        for _ in range(9):   # bold shapes behind the words
            cx, cy, r = x + rng.random() * w, y + rng.random() * h, 20 + rng.random() * 70
            col = tuple(int(min(255, c * 0.6 + 120 * rng.random())) for c in c1)
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=6)
        f, _ = fit_lines(d, [big], "rocknroll", w - 60, h * 0.55, 160)
        d.text((x + w / 2, y + h * 0.42), big, font=f, fill=(255, 255, 255), anchor="mm")
        f2 = font("dot", 30)
        d.text((x + w / 2, y + h * 0.82), small, font=f2, fill=(255, 255, 255), anchor="mm")
    for i, (body, label) in enumerate((((200, 30, 40), "DRINK"), ((30, 90, 190), "COFFEE"), ((240, 240, 235), "TEA"))):
        x, y, w, h = rects[f"vend{i}"]   # a vending machine's front: rows of cans under a lit band, the coin slot below
        d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=body)
        d.rectangle([x + 8, y + 10, x + w - 8, y + 120], fill=(250, 250, 245))
        for row in range(3):
            for col in range(5):
                cc = tuple(int(v) for v in rng.integers(40, 255, 3))
                d.rectangle([x + 14 + col * 21, y + 18 + row * 34, x + 28 + col * 21, y + 44 + row * 34], fill=cc)
        d.rectangle([x + 8, y + 128, x + w - 8, y + 150], fill=(20, 20, 20))
        d.text((x + w / 2, y + 139), label, font=font("dot", 14), fill=(120, 255, 140), anchor="mm")
        d.rectangle([x + 20, y + 180, x + w - 20, y + 208], fill=(30, 30, 30))
    for i, (txt, bg, fg) in enumerate(BLADES):
        x, y, w, h = rects[f"blade{i}"]
        d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=bg)
        d.rectangle([x + 3, y + 3, x + w - 3, y + h - 3], outline=fg, width=2)
        draw_vertical(d, txt, x + w / 2, y + 12, y + h - 12, "mincho" if len(txt) < 4 else "rocknroll", fg, width=w - 8)
    for i, (txt, bg, fg) in enumerate(BOARDS):
        panel(d, rects[f"board{i}"], bg, fg, txt, "rocknroll", 10)
    draw_compass(d, rects["geocompass"])


# GEO COMPASS's floor here points at places you can't see from it: a few in Tokyo's view and the other
# cities of this project, each at its true great-circle bearing and distance from the roof
COMPASS_FROM = (139.7022, 35.6582)   # SHIBUYA SKY (Scramble Square)
COMPASS_TO = {"Mt Fuji 富士山": (138.7274, 35.3606), "Tokyo Skytree": (139.8107, 35.7101), "Tokyo Tower": (139.7454, 35.6586),
              "Suga Shrine": (139.7225, 35.6853), "Osaka": (135.513, 34.679), "Kyoto": (135.7625, 35.003), "Hong Kong": (114.1635, 22.286),
              "Sydney": (151.2115, -33.862), "Melbourne": (144.9631, -37.8136), "Paris": (2.3225, 48.8585)}


def bearing_km(a, b):
    lo1, la1, lo2, la2 = map(math.radians, (*a, *b))
    dl = lo2 - lo1
    brg = math.degrees(math.atan2(math.sin(dl) * math.cos(la2), math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl))) % 360
    d = 2 * 6371.0 * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dl / 2) ** 2))
    return brg, d


def draw_compass(d, rect):
    """The compass on GEO COMPASS's floor, drawn north up (the mesh turns it to true north)."""
    x, y, w, h = rect
    cx, cy, R = x + w / 2, y + h / 2, w / 2 - 10
    d.rectangle([x - 4, y - 4, x + w + 4, y + h + 4], fill=(58, 60, 64))
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=(210, 214, 220), width=4)
    d.ellipse([cx - R * 0.42, cy - R * 0.42, cx + R * 0.42, cy + R * 0.42], outline=(150, 154, 160), width=2)
    for k in range(72):
        a = math.radians(k * 5)
        r0 = R * (0.9 if k % 18 == 0 else 0.95)
        d.line([(cx + r0 * math.sin(a), cy - r0 * math.cos(a)), (cx + R * math.sin(a), cy - R * math.cos(a))], fill=(200, 204, 210), width=3 if k % 18 == 0 else 1)
    f = font("rocknroll", 30)
    boxes = []   # what the place names must keep clear of: the four letters, then each name placed
    for lab, a in (("N", 0), ("E", 90), ("S", 180), ("W", 270)):
        r = R * 0.8
        q = (cx + r * math.sin(math.radians(a)), cy - r * math.cos(math.radians(a)))
        d.text(q, lab, font=f, fill=(240, 240, 240), anchor="mm")
        boxes.append((q[0] - 20, q[1] - 20, q[0] + 20, q[1] + 20))
    # each place: a gold tick on the rim at its bearing, and its name and distance on one line, slid along the
    # ring until it clears the others (places in the same direction stack), with a leader from the inner ring
    fs = font("klee", 13)
    labels = []
    for name, ll in sorted(COMPASS_TO.items(), key=lambda kv: bearing_km(COMPASS_FROM, kv[1])[1]):  # nearest first
        brg, km = bearing_km(COMPASS_FROM, ll)
        a = math.radians(brg)
        s_, c_ = math.sin(a), math.cos(a)
        d.line([(cx + R * 0.9 * s_, cy - R * 0.9 * c_), (cx + R * s_, cy - R * c_)], fill=(255, 196, 70), width=4)
        text = f"{name}  {km:,.0f} km" if km >= 10 else f"{name}  {km:.1f} km"
        l, tp, r_, bt = d.textbbox((0, 0), text, font=fs, anchor="mm")
        hw, hh = (r_ - l) / 2 + 3, (bt - tp) / 2 + 2
        px, py = cx + R * 0.6 * s_, cy - R * 0.6 * c_
        for k in range(200):   # along the ring's tangent, alternately each side
            off = (k + 1) // 2 * 6 * (1 if k % 2 else -1)
            qx, qy = px + off * c_, py + off * s_
            box = (qx - hw, qy - hh, qx + hw, qy + hh)
            if not any(box[0] < b[2] and b[0] < box[2] and box[1] < b[3] and b[1] < box[3] for b in boxes):
                break
        boxes.append(box)
        labels.append(((cx + R * 0.43 * s_, cy - R * 0.43 * c_), (qx, qy), box, text))
    for a0, q, _, _ in labels:   # the leaders first, so that no name is crossed out
        d.line([a0, q], fill=(255, 196, 70), width=1)
    for _, q, box, text in labels:
        d.rectangle(box, fill=(58, 60, 64))
        d.text(q, text, font=fs, fill=(255, 224, 160), anchor="mm")
    fb = font("dot", 22)
    d.text((cx, cy - 12), "GEO COMPASS", font=fb, fill=(240, 240, 240), anchor="mm")
    d.text((cx, cy + 16), "SHIBUYA SKY 229 m", font=font("dot", 16), fill=(200, 210, 220), anchor="mm")


def facing_edges(g, toward, min_len=3.0):
    """Exterior edges of polygon g, best facing the point `toward` first: (score, midpoint, outward normal, length)."""
    cs = np.asarray(g.exterior.coords)
    ccw = g.exterior.is_ccw
    out = []
    for a, b in zip(cs[:-1], cs[1:]):
        e = b - a
        L = float(np.linalg.norm(e))
        if L < min_len:
            continue
        n = np.array([e[1], -e[0]]) / L if ccw else np.array([-e[1], e[0]]) / L
        mid = (a + b) / 2
        dirn = unit(np.asarray(toward) - mid)
        out.append((float(n @ dirn) * min(L, 30.0), mid, n, L))
    return sorted(out, key=lambda r: -r[0])


def front_to_road(ctx, g, roads):
    """The edge of a footprint that faces its nearest street: (midpoint, outward normal, length)."""
    c = g.centroid
    near = min(roads, key=lambda ln: ln.distance(c))
    p = near.interpolate(near.project(c))
    _, mid, n, L = facing_edges(g, (p.x, p.y))[0]
    return mid, n, L


def districts_building(b, cls, g, geoms, ctx):
    """Anchors for the districts' landmarks, colours for a few buildings, and shop-sign candidates."""
    name = b["name"] or ""
    lm = ctx.landmarks
    top = max((q[2] for q in geoms), default=0.0)
    if name == CARROT:
        b["facade_color"] = "#c9663a"   # the tower's orange tiles, the carrot of its name
    if name in SCREENS or name == S109 or name in (CHIYO, HANAMASA, DOCOMO):
        lm.setdefault("_fronts", {})[name] = {"ring": [[round(x, 2), round(y, 2)] for x, y in g.exterior.coords], "top_m": round(top, 1),
                                              "ground_m": round(ctx.ground(g.centroid.x, g.centroid.y), 2)}
    mx, my = ctx.city.fwd.transform(*MARINA_LL)
    if g.distance(Point(mx, my)) < 3.0 and g.area < 400 and "_marina" not in lm:
        lm["_marina"] = {"ring": [[round(x, 2), round(y, 2)] for x, y in g.exterior.coords], "top_m": round(top, 1)}
    if (b["class"] or "") in SIGN_CLASSES and geoms and 30 < g.area < 1600 and 6 <= top <= 70:
        c = g.centroid
        if any(math.hypot(c.x - x, c.y - y) < r for x, y, r in ctx_districts(ctx)):
            ctx.signs.append((g, top))
    return geoms


def ctx_districts(ctx):
    if not hasattr(ctx, "_districts"):
        ctx._districts = [(*ctx.city.fwd.transform(*ll), r) for ll, r in SIGN_DISTRICTS.values()]
    return ctx._districts


def street_lines(ctx, classes, where="TRUE"):
    rows = overture(ctx.city, "segment", f"subtype = 'road' AND class IN ({', '.join(repr(c) for c in classes)}) AND {where}")
    return [r for r in rows if r["geom"].geom_type == "LineString" and not any(
        "is_indoor" in (rule.get("values") or []) or "is_tunnel" in (rule.get("values") or []) for rule in (r.get("road_flags") or []))]


def sign_sites(ctx, roads):
    """Street fronts that carry shop signs: up to two edges per building that face a street within 7 m."""
    from shapely import STRtree
    lines = [r["geom"] for r in roads]
    tree = STRtree(lines)
    out = []
    for g, top in ctx.signs:
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
            if dd < 7.0 and not g.buffer(0.5).contains(probe):
                best.append((dd + 0.02 * (60 - min(L, 60)), mid, n, L))
        for _, mid, n, L in sorted(best, key=lambda r: r[0])[:2]:
            out.append([round(float(mid[0]), 1), round(float(mid[1]), 1), round(float(n[0]), 3), round(float(n[1]), 3),
                        round(ctx.ground(*mid), 1), round(top, 1), round(L, 1)])
    return out


def scramble_node(ctx):
    """The junction where the scramble's four streets meet (cached)."""
    if "node" not in _DATA:
        _DATA["node"] = scramble_lines(ctx)
    n = _DATA["node"][0]
    return None if n is None else [float(n[0]), float(n[1])]


def scramble_lines(ctx):
    """The scramble's crosswalks: the pieces of the mapped footways that cross the four streets within
    30 m of the junction where they meet (the two diagonals pass through it)."""
    roads = street_lines(ctx, ["primary", "secondary", "tertiary", "unclassified", "residential", "pedestrian"])
    named = [r["geom"] for r in roads if (r["name"] or "") in CROSSING_ROADS]
    ends = {}
    for ln in named:
        for p in (ln.coords[0], ln.coords[-1]):
            k = (round(p[0], 1), round(p[1], 1))
            ends[k] = ends.get(k, 0) + 1
    if not ends:
        return None, []
    node = np.array(max(ends, key=lambda k: ends[k]))
    foot = [r for r in overture(ctx.city, "segment", f"class = 'footway' AND {envelope(ctx.city, *node, 45)}") if r["geom"].geom_type == "LineString"]
    # a mapped crossing shares a node with the street it crosses: the crosswalk runs from the footway's
    # vertex before that node to the one after it (the diagonals share the junction itself)
    from shapely import STRtree
    tree = STRtree(named)
    out, seen = [], []
    for r in foot:
        if any("is_indoor" in (rule.get("values") or []) or "is_tunnel" in (rule.get("values") or []) for rule in (r.get("road_flags") or [])):
            continue
        cs = [np.asarray(c) for c in r["geom"].coords]
        for k in range(1, len(cs) - 1):
            p = Point(*cs[k])
            if np.hypot(*(cs[k] - node)) > 32 or not any(named[i].distance(p) < 0.3 for i in tree.query(p.buffer(0.5))):
                continue
            a, b = cs[k - 1], cs[k + 1]
            if max(np.hypot(*(a - cs[k])), np.hypot(*(b - cs[k]))) > 24:
                continue
            mid, d = (a + b) / 2, unit(b - a)
            if any(np.hypot(*(mid - m)) < 4.0 and abs(d @ e) > 0.95 for m, e in seen):
                continue  # the same crosswalk mapped twice, a few metres apart
            seen.append((mid, d))
            out.append([[round(float(a[0]), 2), round(float(a[1]), 2)], [round(float(b[0]), 2), round(float(b[1]), 2)]])
    return node, out


def districts_finalize(ctx):
    lm = ctx.landmarks
    fronts = lm.pop("_fronts", {})
    roads = street_lines(ctx, ["primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "pedestrian", "service", "footway"])
    gz = ctx.ground
    # Shibuya: the scramble, Hachiko, the Center Gai gate, the screens, the 109's sign
    scramble_node(ctx)
    node, cross = _DATA["node"]
    if node is not None:
        lm["scramble"] = {"node": [round(float(node[0]), 1), round(float(node[1]), 1)], "lines": cross,
                          "z": [[round(gz(*a), 2), round(gz(*b), 2)] for a, b in cross]}
        ctx.labels["Shibuya Crossing 渋谷スクランブル交差点"] = [round(float(node[0]), 1), round(float(node[1]), 1), round(gz(*node) + 60, 1)]
    hk = overture(ctx.city, "infrastructure", f"name = '{HACHIKO}'")
    if hk and node is not None:
        p = np.array([hk[0]["geom"].x, hk[0]["geom"].y])
        lm["hachiko"] = {"at": [round(float(p[0]), 2), round(float(p[1]), 2)], "face": [round(float(v), 4) for v in unit(node - p)], "z": round(gz(*p), 2)}
        ctx.labels["Hachiko 忠犬ハチ公"] = [round(float(p[0]), 1), round(float(p[1]), 1), round(gz(*p) + 12, 1)]
    cg = [r["geom"] for r in roads if (r["name"] or "") == CENTER_GAI and r["class"] == "pedestrian"]
    if cg and node is not None:
        ln = cg[0]
        s0 = 0.0 if Point(ln.coords[0]).distance(Point(*node)) < Point(ln.coords[-1]).distance(Point(*node)) else ln.length
        a, b = ln.interpolate(abs(s0 - 7.0)), ln.interpolate(abs(s0 - 9.0))
        f = unit(np.array([b.x - a.x, b.y - a.y]))
        lm["center_gai"] = {"at": [round(a.x, 2), round(a.y, 2)], "axis": [round(float(f[0]), 4), round(float(f[1]), 4)], "z": round(gz(a.x, a.y), 2), "span_m": 9.0}
        ctx.labels["Center Gai センター街"] = [round(a.x, 1), round(a.y, 1), round(gz(a.x, a.y) + 22, 1)]
    scr = []
    for k, nm in enumerate(SCREENS):
        fr = fronts.get(nm)
        if fr and node is not None:
            g = Polygon(fr["ring"])
            sc, mid, n, L = facing_edges(g, node)[0]
            w = min(L * 0.8, 24.0)
            h = min(w * 0.56, fr["top_m"] * 0.45)
            scr.append({"name": nm, "at": [round(float(mid[0]), 2), round(float(mid[1]), 2)], "normal": [round(float(n[0]), 4), round(float(n[1]), 4)],
                        "w": round(w, 1), "h": round(h, 1), "z0": round(fr["ground_m"] + fr["top_m"] * 0.86 - h, 1), "ad": k % len(SCREEN_ADS)})
    lm["screens"] = scr
    if S109 in fronts and node is not None:
        fr = fronts[S109]
        _, mid, n, L = facing_edges(Polygon(fr["ring"]), node)[0]
        lm["s109"] = {"at": [round(float(mid[0]), 2), round(float(mid[1]), 2)], "normal": [round(float(n[0]), 4), round(float(n[1]), 4)],
                      "z1": round(fr["ground_m"] + fr["top_m"] - 1.0, 1)}
    # Yongen-Jaya: Chiyo-no-yu, Hanamasa, the snack bar New Marina and the cafe upstairs next door
    streets = [r["geom"] for r in roads if r["class"] not in ("footway",)]
    shops = {}
    for nm, key in ((CHIYO, "chiyo"), (HANAMASA, "hanamasa")):
        if nm in fronts:
            mid, n, L = front_to_road(ctx, Polygon(fronts[nm]["ring"]), streets)
            shops[key] = {"at": [round(float(mid[0]), 2), round(float(mid[1]), 2)], "normal": [round(float(n[0]), 4), round(float(n[1]), 4)],
                          "len": round(L, 1), "z": round(gz(*mid), 2), "top_m": fronts[nm]["top_m"]}
    mar = lm.pop("_marina", None)
    if mar:
        mid, n, L = front_to_road(ctx, Polygon(mar["ring"]), streets)
        shops["marina"] = {"at": [round(float(mid[0]), 2), round(float(mid[1]), 2)], "normal": [round(float(n[0]), 4), round(float(n[1]), 4)],
                           "len": round(L, 1), "z": round(gz(*mid), 2), "top_m": mar["top_m"]}
    lm["yongen"] = shops
    mx, my = ctx.city.fwd.transform(*MARINA_LL)
    ctx.labels["Yongen-Jaya: Sangenjaya 三軒茶屋"] = [round(mx, 1), round(my, 1), round(gz(mx, my) + 40, 1)]
    # Shinjuku: the Kabukicho Ichibangai arch, the Docomo tower's clock and mast
    kb = [r["geom"] for r in roads if (r["name"] or "") == KABUKI_ST]
    if kb:
        pts = [np.asarray(p) for ln in kb for p in (ln.coords[0], ln.coords[-1])]
        south = min(pts, key=lambda p: p[1])
        nxt = min((p for p in pts if np.linalg.norm(p - south) > 20), key=lambda p: np.linalg.norm(p - south))
        f = unit(nxt - south)
        at = south + f * 6.0
        lm["kabukicho_gate"] = {"at": [round(float(at[0]), 2), round(float(at[1]), 2)], "axis": [round(float(f[0]), 4), round(float(f[1]), 4)],
                                "z": round(gz(*at), 2), "span_m": 9.5, "since": 1969}
        ctx.labels["Kabukicho 歌舞伎町"] = [round(float(at[0]), 1), round(float(at[1]), 1) + 60, round(gz(*at) + 70, 1)]
    if DOCOMO in fronts:
        fr = fronts[DOCOMO]
        g = Polygon(fr["ring"])
        _, mid, n, L = facing_edges(g, (g.centroid.x, g.centroid.y + 500))[0]   # the clock faces north
        lm["docomo"] = {"centre": [round(g.centroid.x, 2), round(g.centroid.y, 2)], "clock_at": [round(float(mid[0]), 2), round(float(mid[1]), 2)],
                        "normal": [round(float(n[0]), 4), round(float(n[1]), 4)], "ground_m": fr["ground_m"], "roof_m": fr["top_m"], **DOCOMO_FIG}
        ctx.labels["Docomo Tower ドコモタワー"] = [round(g.centroid.x, 1), round(g.centroid.y, 1), round(fr["ground_m"] + DOCOMO_FIG["mast_top_m"] + 6, 1)]
    for label, (ll, _) in (("Shinjuku 2-chome 新宿二丁目", SIGN_DISTRICTS["Shinjuku 2-chome"]), ("Golden Gai ゴールデン街", SIGN_DISTRICTS["Golden Gai"])):
        x, y = ctx.city.fwd.transform(*ll)
        ctx.labels[label] = [round(x, 1), round(y, 1), round(gz(x, y) + 30, 1)]
    # shop signs on the street fronts of the districts, and the poles and wires of the backstreets
    sites = sign_sites(ctx, [r for r in roads if r["class"] != "service"])
    if len(sites) > MAX_SIGNS:
        rng = np.random.default_rng(1612)
        sites = [sites[i] for i in sorted(rng.choice(len(sites), MAX_SIGNS, replace=False))]
    lm["signs"] = {"sites": sites, "districts": list(SIGN_DISTRICTS), "note": "shop signs on street fronts in the districts; indicative, not the real shops' signs"}
    lm["poles"] = utility_poles(ctx, roads)


# the backstreets where utility poles and their wires are drawn (Sangenjaya's triangle, round the shrine's stairs)
POLE_AREAS = {"Sangenjaya": ((139.6695, 35.6430), 170), "Suga-cho": ((139.7232, 35.6852), 130)}


def utility_poles(ctx, roads):
    """Concrete poles along the narrow streets, about every 30 m on one side, and the lines strung between
    them: Tokyo's overhead wires, which most of its backstreets still have."""
    from shapely import STRtree
    areas = [(*ctx.city.fwd.transform(*ll), r) for ll, r in POLE_AREAS.values()]
    rows = [r for r in roads if r["class"] in ("residential", "service", "unclassified", "living_street", "tertiary")]
    blds = [r["geom"] for x, y, rad in areas for r in overture(ctx.city, "building", envelope(ctx.city, x, y, rad + 20)) if r["geom"].geom_type == "Polygon"]
    tree = STRtree(blds) if blds else None
    lines = []
    for r in rows:
        ln = r["geom"]
        c = ln.interpolate(0.5, normalized=True)
        if not any(math.hypot(c.x - x, c.y - y) < rad for x, y, rad in areas) or ln.length < 25:
            continue
        poles = []
        for s in np.arange(6.0, ln.length - 3.0, 30.0):
            p, q = ln.interpolate(s), ln.interpolate(min(s + 1.0, ln.length))
            f = unit(np.array([q.x - p.x, q.y - p.y]))
            at = np.array([p.x, p.y]) + left_of(f) * 2.6
            pt = Point(*at)
            if tree is not None and any(blds[i].contains(pt) for i in tree.query(pt)):
                at = np.array([p.x, p.y]) - left_of(f) * 2.6
                pt = Point(*at)
                if any(blds[i].contains(pt) for i in tree.query(pt)):
                    continue
            poles.append([round(float(at[0]), 2), round(float(at[1]), 2), round(ctx.ground(*at), 2)])
        if len(poles) >= 2:
            lines.append(poles)
    return lines


# ---------------------------------------------------------------- the districts' meshes

def zebra(K, cross, zs, width=6.0):
    """Each crosswalk's white bars on the road: 0.45 m wide with 0.45 m gaps, lying along the street, so that
    you step over them one after another as you cross (a Japanese 横断歩道)."""
    W = K("paint_white")
    for (a, b), (za, zb) in zip(cross, zs):
        a, b = np.asarray(a, float), np.asarray(b, float)
        f = unit(b - a)
        L = float(np.linalg.norm(b - a))
        l = left_of(f) * width / 2
        z = lambda u: za + (zb - za) * u / L + 0.07
        u = 1.0
        while u + 0.45 <= L - 1.0:
            p, q = a + f * u, a + f * (u + 0.45)
            W.quad(np.array([*(p - l), z(u)]), np.array([*(q - l), z(u + 0.45)]), np.array([*(q + l), z(u + 0.45)]), np.array([*(p + l), z(u)]))
            u += 0.9


def hachiko(K, h):
    """Hachiko on his granite pedestal: the Akita sitting up, ears pricked, tail curled over his back
    (bronze, Ando Takeshi's 1948 recast of his father Ando Teru's 1934 statue)."""
    P = frame(h["at"], h["face"])
    z0 = h["z"]
    block(K("granite"), P, -0.8, 0.8, -0.55, 0.55, z0, z0 + 0.25)
    block(K("granite"), P, -0.7, 0.7, -0.45, 0.45, z0 + 0.25, z0 + 1.6)
    quad_img(K("atlas"), P(0.705, 0.35, z0 + 0.9), P(0.705, -0.35, z0 + 0.9), P(0.705, -0.35, z0 + 1.15), P(0.705, 0.35, z0 + 1.15), "hachiko")
    Bz = K("bronze")
    z = z0 + 1.6
    block(Bz, P, -0.5, 0.45, -0.35, 0.35, z, z + 0.05)                      # the bronze base plate
    block(Bz, P, -0.42, 0.0, -0.2, 0.2, z + 0.05, z + 0.42)                 # haunches
    for v in (-0.2, 0.2):
        block(Bz, P, -0.35, 0.05, v - 0.06, v + 0.06, z + 0.05, z + 0.3)    # hind legs folded
    taper(Bz, lambda u, vv, zz: P(u + 0.1, vv, zz), 0, 0, 0.42, 0.36, z + 0.1, 0.32, 0.3, z + 0.78)  # chest and shoulders
    for v in (-0.09, 0.09):
        block(Bz, P, 0.22, 0.31, v - 0.045, v + 0.045, z + 0.05, z + 0.5)   # forelegs straight
    taper(Bz, lambda u, vv, zz: P(u + 0.18, vv, zz), 0, 0, 0.26, 0.22, z + 0.7, 0.2, 0.2, z + 0.9)   # neck
    block(Bz, P, 0.12, 0.4, -0.12, 0.12, z + 0.84, z + 1.05)                # head
    block(Bz, P, 0.4, 0.53, -0.065, 0.065, z + 0.86, z + 0.96)              # muzzle
    for v in (-0.075, 0.075):
        taper(Bz, lambda u, vv, zz, v=v: P(u + 0.2, vv + v, zz), 0, 0, 0.08, 0.06, z + 1.05, 0.02, 0.02, z + 1.16)  # ears
    Bz.tube([P(-0.42, 0, z + 0.4), P(-0.5, 0, z + 0.55), P(-0.42, 0, z + 0.66), P(-0.3, 0, z + 0.6)], 0.05, 6)   # the curled tail


def center_gai_gate(K, c):
    """The arch over Center Gai's mouth: two posts and a sign box lit after dark, read from both ways."""
    P = frame(c["at"], c["axis"])
    z0, hs = c["z"], c["span_m"] / 2
    for v in (-hs, hs):
        slab_at(K("steel_dark"), P, 0, v, 0.4, 0.4, z0, z0 + 6.6)
    block(K("steel_dark"), P, -0.25, 0.25, -hs - 0.3, hs + 0.3, z0 + 5.0, z0 + 6.6)
    for side, a, b in ((-1, 1, -1), (1, -1, 1)):
        u = side * 0.26
        quad_img(K("atlas", "lit"), P(u, a * (hs - 0.3), z0 + 5.1), P(u, b * (hs - 0.3), z0 + 5.1), P(u, b * (hs - 0.3), z0 + 6.5), P(u, a * (hs - 0.3), z0 + 6.5), "centergai")


def kabukicho_gate(K, c):
    """Kabukicho Ichibangai's arch (1969): posts, the sign, and its red neon outline."""
    P = frame(c["at"], c["axis"])
    z0, hs = c["z"], c["span_m"] / 2
    for v in (-hs, hs):
        slab_at(K("steel_dark"), P, 0, v, 0.45, 0.45, z0, z0 + 7.6)
        K("neon_red", "lit").tube([P(-0.3, v, z0 + 2.5), P(-0.3, v, z0 + 7.4)], 0.05, 6)
    block(K("steel_dark"), P, -0.3, 0.3, -hs, hs, z0 + 5.4, z0 + 7.2)
    for side, a, b in ((-1, 1, -1), (1, -1, 1)):
        u = side * 0.31
        quad_img(K("atlas", "lit"), P(u, a * (hs - 0.25), z0 + 5.5), P(u, b * (hs - 0.25), z0 + 5.5), P(u, b * (hs - 0.25), z0 + 7.1), P(u, a * (hs - 0.25), z0 + 7.1), "kabukicho")
        arc = [P(u * 1.2, v, z0 + 7.3 + 1.1 * math.cos(v / hs * math.pi / 2)) for v in np.linspace(-hs, hs, 21)]
        K("neon_red", "lit").tube(arc, 0.06, 6)


def facade_panel(m, mid, n, w, z0, z1, key, off=0.25, along=0.0):
    """An image on a facade: width w centred `along` metres along the edge from its midpoint, `off` out from the wall."""
    mid, n = np.asarray(mid, float), np.asarray(n, float)
    t = np.array([-n[1], n[0]])       # along the wall, left to right seen from outside
    c = mid + n * off + t * along
    a, b = c - t * w / 2, c + t * w / 2
    quad_img(m, np.array([*a, z0]), np.array([*b, z0]), np.array([*b, z1]), np.array([*a, z1]), key)


def screens(K, scr):
    for s in scr:
        n = np.asarray(s["normal"], float)
        mid = np.asarray(s["at"], float)
        P = frame(mid + n * 0.2, n)
        block(K("screen_frame"), P, -0.2, 0.35, -s["w"] / 2 - 0.4, s["w"] / 2 + 0.4, s["z0"] - 0.4, s["z0"] + s["h"] + 0.4)
        facade_panel(K("atlas", "lit"), mid, n, s["w"], s["z0"], s["z0"] + s["h"], f"screen{s['ad']}", off=0.57)


def yongen(K, y):
    """Sangenjaya's backstreet: Chiyo-no-yu's curtain, sign, laundry and vending machines; Hanamasa's yellow
    sign; New Marina's lit box and its door; the cafe's sign upstairs."""
    c = y.get("chiyo")
    if c:
        mid, n, z = np.asarray(c["at"]), np.asarray(c["normal"]), c["z"]
        facade_panel(K("atlas"), mid, n, 1.9, z + 1.9, z + 3.0, "noren_yu", off=0.35, along=-1.2)
        facade_panel(K("atlas", "lit"), mid, n, 3.4, z + 3.3, z + 4.15, "chiyo", off=0.2, along=-1.2)
        facade_panel(K("atlas", "lit"), mid, n, 3.0, z + 2.5, z + 3.25, "laundry", off=0.2, along=min(2.4, c["len"] / 2 - 1.5))
        t = np.array([-n[1], n[0]])
        P = frame(mid + n * 0.6 + t * (-1.2), n)
        block(K("wood_dark"), P, -0.1, 0.05, -1.2, 1.2, z + 3.0, z + 3.12)       # the curtain rod's lintel
        for k, along in enumerate((-3.2, -4.25)):   # vending machines beside the door
            Q = frame(mid + t * along + n * 0.45, n)
            block(K("steel_dark"), Q, -0.75, 0.0, -0.48, 0.48, z, z + 1.83)
            facade_panel(K("atlas", "lit"), mid + t * along, n, 0.9, z + 0.05, z + 1.78, f"vend{k}", off=0.455)
        Q = frame(mid + n * 0.1, n)
        block(K("corrugated"), Q, 0.0, 0.08, -c["len"] / 2 + 0.3, c["len"] / 2 - 0.3, z + 4.4, z + min(c["top_m"] - 0.5, 7.5))
    h = y.get("hanamasa")
    if h:
        facade_panel(K("atlas", "lit"), h["at"], h["normal"], min(6.5, h["len"] * 0.8), h["z"] + 3.4, h["z"] + 4.8, "hanamasa", off=0.25)
    m = y.get("marina")
    if m:
        mid, n, z = np.asarray(m["at"]), np.asarray(m["normal"]), m["z"]
        t = np.array([-n[1], n[0]])
        P = frame(mid + n * 0.05, n)
        block(K("wood_dark"), P, 0.0, 0.12, -0.5, 0.5, z, z + 2.1)              # the door
        block(K("lamp", "lit"), P, 0.0, 0.1, 0.7, 1.4, z + 1.0, z + 1.9)        # a lit window
        # the box sign standing out from the wall, read from up and down the street
        Q = frame(mid + n * 0.9 + t * 0.9, t)
        block(K("steel_dark"), Q, -0.85, 0.85, -0.12, 0.12, z + 2.4, z + 2.95)
        for side in (-1, 1):
            a, b = Q(-0.8 * side, side * 0.125, z + 2.45), Q(0.8 * side, side * 0.125, z + 2.45)
            quad_img(K("atlas", "lit"), a, b, b + [0, 0, 0.45], a + [0, 0, 0.45], "marina")
        facade_panel(K("atlas", "lit"), mid, n, 2.0, z + 3.2, z + 3.7, "rain", off=0.12, along=-2.6)


def shop_signs(K, sites):
    """Blade signs, banners and upper-wall boards on the districts' street fronts, each with its own words."""
    rng = np.random.default_rng(2016)
    A = K("atlas", "lit")
    for x, y, nx, ny, g, top, L in sites:
        n, mid = np.array([nx, ny]), np.array([x, y])
        t = np.array([-n[1], n[0]])
        kinds = ["board"] + (["blade"] if top > 9 else []) + (["blade2"] if top > 18 and rng.random() < 0.6 else [])
        for kind in kinds:
            if kind == "board":
                w = min(max(L * 0.6, 2.4), 6.0)
                along = (rng.random() - 0.5) * max(L - w, 0.0)
                z0 = g + 2.9 + rng.random() * 0.6
                facade_panel(A, mid, n, w, z0, z0 + w / 4, f"board{int(rng.integers(len(BOARDS)))}", off=0.18, along=along)
            else:
                along = (rng.random() - 0.5) * max(L - 1.5, 0.0)
                h = 2.6 + rng.random() * 2.4
                z0 = g + (4.2 if kind == "blade" else 9.0) + rng.random() * 2.0
                if z0 + h > g + top - 0.5:
                    continue
                key = f"blade{int(rng.integers(len(BLADES)))}"
                c = mid + n * 0.95 + t * along
                for side in (-1, 1):  # both faces of a sign that stands out from the wall
                    a, b = c - n * 0.65 * side + t * 0.06 * side, c + n * 0.65 * side + t * 0.06 * side
                    quad_img(A, np.array([*a, z0]), np.array([*b, z0]), np.array([*b, z0 + h]), np.array([*a, z0 + h]), key)


def poles_and_wires(K, lines):
    for poles in lines:
        tops = []
        for x, y, z in poles:
            lathe_at(K("pole"), x, y, [(z - 0.5, 0.19), (z + 11.0, 0.13), (z + 11.1, 0.0)], 8)
            K("steel_dark").tube([np.array([x - 0.9, y, z + 10.2]), np.array([x + 0.9, y, z + 10.2])], 0.05, 4)  # crossarm
            tops.append((x, y, z))
        for k, ((x0, y0, z0), (x1, y1, z1)) in enumerate(zip(tops, tops[1:])):
            if k % 2 == 0:
                lathe_at(K("steel"), x0 + 0.35, y0, [(z0 + 8.2, 0.28), (z0 + 9.3, 0.28), (z0 + 9.35, 0.0)], 10)  # a transformer drum
            for dx, dz in ((-0.8, 10.25), (0.0, 10.25), (0.8, 10.25), (0.0, 7.4), (0.0, 6.6)):
                a, b = np.array([x0 + dx, y0, z0 + dz]), np.array([x1 + dx, y1, z1 + dz])
                sag = 0.35 + 0.01 * np.linalg.norm(b - a)
                K("wire").tube([a + (b - a) * t - np.array([0, 0, sag * 4 * t * (1 - t)]) for t in np.linspace(0, 1, 9)], 0.012 if dz > 8 else 0.02, 4)


def docomo(K, d):
    """The Docomo tower's north clock (15 m across, 150 m up) and the mast to 272 m."""
    n, at = np.asarray(d["normal"]), np.asarray(d["clock_at"])
    zc = d["ground_m"] + d["clock_z_m"]
    r = d["clock_d_m"] / 2
    facade_panel(K("atlas", "lit"), at, n, 2 * r, zc - r, zc + r, "clock", off=0.6)
    P = frame(at + n * 0.75, n)
    now = (10, 10)   # the hands at ten past ten, as clocks are shown
    for frac, ln, w in ((now[0] / 12 + now[1] / 720, r * 0.55, 0.7), (now[1] / 60, r * 0.85, 0.45)):
        a = frac * 2 * math.pi
        tip = (math.sin(a) * ln, math.cos(a) * ln)
        K("steel_dark", "lit").tube([P(0, 0, zc), P(0, -tip[0], zc + tip[1])], w / 2, 6)
    cx, cy = d["centre"]
    z0, z1 = d["ground_m"] + d["roof_m"], d["ground_m"] + d["mast_top_m"]
    lathe_at(K("steel"), cx, cy, [(z0 - 2, 1.2), (z0 + 8, 0.9), (z1 - 6, 0.35), (z1, 0.1)], 10)
    lathe_at(K("lamp", "lit"), cx, cy, [(z1 - 0.6, 0.3), (z1 + 0.3, 0.0)], 8)


def districts_meshes(lm):
    K = Kit("p5", floodlit=("lamp", "neon_red", "neon_pink", "clock_face"))
    if "scramble" in lm:
        zebra(K, lm["scramble"]["lines"], lm["scramble"]["z"])
    if "hachiko" in lm:
        hachiko(K, lm["hachiko"])
    if "center_gai" in lm:
        center_gai_gate(K, lm["center_gai"])
    screens(K, lm.get("screens", []))
    if "s109" in lm:
        s = lm["s109"]
        facade_panel(K("atlas", "lit"), s["at"], s["normal"], 2.6, s["z1"] - 10.4, s["z1"], "s109", off=0.3)
    if "yongen" in lm:
        yongen(K, lm["yongen"])
    if "kabukicho_gate" in lm:
        kabukicho_gate(K, lm["kabukicho_gate"])
    if "docomo" in lm:
        docomo(K, lm["docomo"])
    if "signs" in lm:
        shop_signs(K, lm["signs"]["sites"])
    poles_and_wires(K, lm.get("poles", []))
    return K.meshes()


# ---------------------------------------------------------------- SHIBUYA SKY, on Shibuya Scramble Square
#
# The open-air deck on the roof of Shibuya Scramble Square's east tower (opened 1 November 2019; Nikken
# Sekkei and Nomura, with Rhizomatiks): about 2,500 m2 at 229 m (SHIBUYA SKY; Wikipedia). Visitors enter at
# 14F, ride the Hitachi lifts of SKY GATE to 45F at 360 m a minute, and climb from the 46F gallery to the
# roof on an escalator walled in glass. On the roof: SKY EDGE, the corner over the scramble where the glass
# is lowest; GEO COMPASS, the highest point, a raised deck with a compass on its floor; CLOUD HAMMOCK, nets
# to lie in; and CROSSING LIGHT, 18 searchlights after dark. The deck is put at PLATEAU's lower roof tier
# and GEO COMPASS reaches its top; the plan of the roof furniture is drawn from photographs.

SCRAMBLE_SQ = "渋谷スクランブルスクエア"
SKY = {"floor_46_below_m": 5.5, "escalator_deg": 30.0, "escalator_ms": 0.5, "fence_m": 2.0, "edge_fence_m": 1.3, "compass_m": 24.0,
       "lift_m_per_min": 360.0, "searchlights": 18, "opened": "2019-11-01", "area_m2": 2500}

MATERIALS.update({
    "deck": {"color": "#b4ada3", "roughness": 0.85, "metalness": 0.05},          # the roof's pale paving (GSI aerial photo)
    "deck_light": {"color": "#c2bbb1", "roughness": 0.8, "metalness": 0.05},
    "glass": {"color": "#bcd6de", "roughness": 0.05, "metalness": 0.1, "opacity": 0.28},
    "rubber": {"color": "#1a1a1a", "roughness": 0.6, "metalness": 0.0},
    "net": {"color": "#e8e8e4", "roughness": 0.9, "metalness": 0.0, "opacity": 0.75},
    "led": {"color": "#cfe8ff", "roughness": 0.3, "metalness": 0.0, "emissive": "#9fd2ff", "glow": 3.0},
})


def roof_frame(ring):
    """Centre, unit axes (long, short) and half-lengths of a roof footprint's minimum rotated rectangle."""
    g = Polygon(ring)
    r = np.asarray(g.minimum_rotated_rectangle.exterior.coords)[:4]
    e1, e2 = r[1] - r[0], r[2] - r[1]
    if np.linalg.norm(e1) < np.linalg.norm(e2):
        e1, e2 = e2, e1
    c = r.mean(axis=0)
    return c, unit(e1), unit(e2), float(np.linalg.norm(e1)) / 2, float(np.linalg.norm(e2)) / 2


def sky_plan(ring, toward):
    """Where things go on the roof: the frame turned so that +u, +v points at the SKY EDGE corner (the one
    nearest the scramble), the escalator pit near the opposite corner."""
    c, a1, a2, h1, h2 = roof_frame(ring)
    d = np.asarray(toward) - c
    a1 = a1 if d @ a1 > 0 else -a1
    a2 = a2 if d @ a2 > 0 else -a2
    pit_len, pit_w = 15.0, 3.6
    pit_c = c - a1 * (h1 - 9.5 - pit_len / 2) - a2 * (h2 - 8.0)
    pit = [pit_c + a1 * su * pit_len / 2 + a2 * sv * pit_w / 2 for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    return {"c": c, "a1": a1, "a2": a2, "h1": h1, "h2": h2, "pit_c": pit_c, "pit": pit, "pit_len": pit_len, "pit_w": pit_w}


def solid_base(q, ctx):
    """The ground a solid will stand on, as the build sets it: the lowest DEM point of its simplified outline."""
    return max(min(ctx.ground(x, y) for x, y in q.simplify(0.15, preserve_topology=True).exterior.coords), 0.0)


def sky_building(b, g, geoms, ctx):
    """Scramble Square's roof becomes SHIBUYA SKY's deck: the top tier is lowered to the deck (PLATEAU's
    lower roof tier), and the escalator's well is cut down to the 46F floor. Each solid stands on its own
    ground, a few centimetres apart, so the deck's solids get the heights that put their tops at one level,
    the one the deck is drawn at. The thin band PLATEAU has 9 m lower along the west and north edges
    (190 m², under the edge of the deck in the model) is raised to it."""
    tops = sorted({round(q[2], 1) for q in geoms}, reverse=True)
    top = tops[0]
    deck = next((t for t in tops[1:] if 0.8 <= top - t <= 4.0), round(top - 2.0, 1))
    main = max((q for q in geoms if round(q[2], 1) == top), key=lambda q: q[0].area)
    ring = [[round(x, 2), round(y, 2)] for x, y in main[0].exterior.coords]
    toward = scramble_node(ctx)
    plan = sky_plan(ring, toward)
    pit = Polygon(plan["pit"])
    c, a1, a2, h1, h2 = plan["c"], plan["a1"], plan["a2"], plan["h1"], plan["h2"]
    rect = Polygon([c + a1 * su * h1 + a2 * sv * h2 for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    ground = round(max(min(ctx.ground(x, y) for x, y in ring), 0.0), 2)
    z_dm = round((ground + deck) * 10)                                # the deck's level, in decimetres
    up_to = lambda p, zdm: (zdm - round(solid_base(p, ctx) * 10)) / 10  # the height that puts p's top there
    out = []
    for q in geoms:
        p = main[0].difference(pit.buffer(0.3, join_style=2)) if q is main else q[0]
        if q is main or (q[2] > deck - 12.0 and p.intersection(rect).area > 0.5 * p.area):
            q = [p, q[1], up_to(p, z_dm), q[3], q[4], *q[5:]]
        elif round(q[2], 1) > deck:
            q = [p, q[1], deck, q[3], q[4], *q[5:]]
        out.append(q)
    out.append([pit, 0.0, up_to(pit, z_dm - round(SKY["floor_46_below_m"] * 10)), main[3], None, *main[5:]])
    ctx.landmarks["_sky"] = {"ring": ring, "roof_top_m": top, "deck_m": deck, "ground_m": ground, "deck_z": z_dm / 10,
                             "toward": [round(float(toward[0]), 1), round(float(toward[1]), 1)]}
    return out


def sky_searchlights(c, a1, a2, h1, h2):
    """The roof's searchlights: one in each corner, the rest spaced along the edges."""
    out = [c + a1 * su * (h1 - 1.0) + a2 * sv * (h2 - 1.0) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    while len(out) < SKY["searchlights"]:
        k = len(out) - 4
        t = (k + 1) / (SKY["searchlights"] - 3)
        out.append([c + a1 * (-h1 + 2 * h1 * t) - a2 * (h2 - 1.0), c + a2 * (-h2 + 2 * h2 * t) + a1 * (h1 - 1.0),
                    c + a1 * (h1 - 2 * h1 * t) + a2 * (h2 - 1.0), c + a2 * (h2 - 2 * h2 * t) - a1 * (h1 - 1.0)][k % 4])
    return out


def sky_finalize(ctx):
    s = ctx.landmarks.pop("_sky", None)
    if not s:
        return
    node = s["toward"]
    p = sky_plan(s["ring"], node)
    z = s["deck_z"]
    c, a1, a2, h1, h2 = p["c"], p["a1"], p["a2"], p["h1"], p["h2"]
    # the lift's street door: the foot of the facade that faces the scramble, a few metres out
    g = Polygon(s["ring"])
    _, mid, n, _ = facing_edges(g, node)[0]
    door = np.asarray(mid) + n * 3.0
    esc_rise = SKY["floor_46_below_m"]
    esc_run = esc_rise / math.tan(math.radians(SKY["escalator_deg"]))
    f = a1                                      # the escalator climbs along +a1, towards the SKY EDGE end
    e0 = p["pit_c"] - f * (p["pit_len"] / 2 - 2.2)  # its foot, past a landing at 46F
    beams = sky_searchlights(c, a1, a2, h1, h2)
    r2 = lambda v: [round(float(v[0]), 2), round(float(v[1]), 2)]
    ctx.landmarks["shibuya_sky"] = {
        "centre": r2(c), "a1": [round(float(a1[0]), 5), round(float(a1[1]), 5)], "a2": [round(float(a2[0]), 5), round(float(a2[1]), 5)],
        "half": [round(h1, 2), round(h2, 2)], "deck_z": round(z, 2), "ground_m": s["ground_m"], "deck_m": s["deck_m"],
        "roof_top_m": s["roof_top_m"], "pit": [r2(q) for q in p["pit"]], "pit_c": r2(p["pit_c"]), "pit_len": p["pit_len"], "pit_w": p["pit_w"],
        "escalator": {"origin": r2(e0), "axis": [round(float(f[0]), 5), round(float(f[1]), 5)], "run_m": round(esc_run, 2), "rise_m": esc_rise,
                      "z0": round(z - esc_rise, 2), "half_width": 0.6, "plate_end": round(p["pit_len"] - 2.2 + 0.4, 2)},
        "door": r2(door), "door_z": round(ctx.ground(*door), 2),
        "beams": [[round(float(q[0]), 1), round(float(q[1]), 1), round(z + 1.0, 1)] for q in beams],
        "at": r2(c), "top_m": round(z + 2.0, 1), **SKY,
    }
    ctx.labels["SHIBUYA SKY 229 m"] = [round(float(c[0]), 1), round(float(c[1]), 1), round(z + 14, 1)]


def sky_meshes(s):
    K = Kit("sky", floodlit=("led", "lamp"))
    c, a1, a2 = np.asarray(s["centre"]), np.asarray(s["a1"]), np.asarray(s["a2"])
    h1, h2 = s["half"]
    z = s["deck_z"]
    P = frame(c, a1)                    # u along a1, v along a2 (a2 is a1's left or right: use its sign)
    sgn = 1.0 if left_of(a1) @ a2 > 0 else -1.0
    Q = lambda u, v, zz: P(u, sgn * v, zz)
    pit = Polygon(s["pit"])
    gc = SKY["compass_m"] / 2
    # the deck, in boards round the well and the GEO COMPASS
    D, D2 = K("deck"), K("deck_light")
    tone = np.random.default_rng(2019)          # a paler tile here and there
    n1, n2 = int(2 * h1 / 3), int(2 * h2 / 3)
    for i in range(n1):
        for j in range(n2):
            u0, v0 = -h1 + 0.4 + i * (2 * h1 - 0.8) / n1, -h2 + 0.4 + j * (2 * h2 - 0.8) / n2
            u1, v1 = u0 + (2 * h1 - 0.8) / n1, v0 + (2 * h2 - 0.8) / n2
            cell = Polygon([Q(u0, v0, 0)[:2], Q(u1, v0, 0)[:2], Q(u1, v1, 0)[:2], Q(u0, v1, 0)[:2]])
            if cell.intersects(pit.buffer(0.4)) or (abs((u0 + u1) / 2) < gc and abs((v0 + v1) / 2) < gc):
                continue
            (D2 if tone.random() < 0.35 else D).quad(Q(u0, v0, z + 0.03), Q(u1, v0, z + 0.03), Q(u1, v1, z + 0.03), Q(u0, v1, z + 0.03))
    # the glass fence round the edge, lowest at SKY EDGE (+u, +v corner), on steel posts
    G, S = K("glass"), K("steel_dark")
    edges = [((-h1, -h2), (h1, -h2)), ((h1, -h2), (h1, h2)), ((h1, h2), (-h1, h2)), ((-h1, h2), (-h1, -h2))]
    for (ua, va), (ub, vb) in edges:
        L = math.hypot(ub - ua, vb - va)
        n = max(1, int(L / 2.0))
        for k in range(n):
            t0, t1 = k / n, (k + 1) / n
            pa, pb = (ua + (ub - ua) * t0, va + (vb - va) * t0), (ua + (ub - ua) * t1, va + (vb - va) * t1)
            mid = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
            edge = mid[0] > h1 - 14 and mid[1] > h2 - 14
            hh = SKY["edge_fence_m"] if edge else SKY["fence_m"]
            G.quad(Q(*pa, z), Q(*pb, z), Q(*pb, z + hh), Q(*pa, z + hh))
            S.tube([Q(*pa, z), Q(*pa, z + hh)], 0.04, 6)
            S.tube([Q(*pa, z + hh), Q(*pb, z + hh)], 0.03, 4)
    # SKY EDGE: light lines in the floor fanning out to the corner over the scramble
    for k in range(7):
        a = math.radians(15 + k * 10)
        p0 = (h1 - 13.0, h2 - 13.0)
        p1 = (p0[0] + 12.0 * math.cos(a), p0[1] + 12.0 * math.sin(a))
        d = np.array([p1[0] - p0[0], p1[1] - p0[1]])
        nrm = np.array([-d[1], d[0]]) / np.linalg.norm(d) * 0.07
        K("led").quad(Q(p0[0] - nrm[0], p0[1] - nrm[1], z + 0.06), Q(p1[0] - nrm[0], p1[1] - nrm[1], z + 0.06),
                      Q(p1[0] + nrm[0], p1[1] + nrm[1], z + 0.06), Q(p0[0] + nrm[0], p0[1] + nrm[1], z + 0.06))
    # GEO COMPASS: the raised deck in the middle, the compass on its floor, steps up each side
    zt = z + 2.0
    block(K("concrete", "compass"), Q, -gc, gc, -gc, gc, z - 0.5, zt - 0.02)
    # the compass is drawn north up: a north-up square that fits inside the platform, which is turned with the tower
    cc, th = np.asarray(s["centre"]), math.atan2(a1[1], a1[0])
    hs = gc / (abs(math.cos(th)) + abs(math.sin(th)))
    quad_img(K("atlas", "compass"), *[np.array([cc[0] + dx * hs, cc[1] + dy * hs, zt + 0.01]) for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1))], "geocompass")
    for su, sv_ in ((1, 0), (-1, 0), (0, 1), (0, -1)):   # ten 0.2 m steps on each side, the lowest outermost
        for j in range(10):
            d0, d1 = gc + 1.8 - j * 0.2, gc + 2.0 - j * 0.2
            lo, hi = (d0, d1) if su + sv_ > 0 else (-d1, -d0)
            if su:
                block(K("deck_light", "steps"), Q, lo, hi, -2.5, 2.5, z, z + (j + 1) * 0.2)
            else:
                block(K("deck_light", "steps"), Q, -2.5, 2.5, lo, hi, z, z + (j + 1) * 0.2)
    # CLOUD HAMMOCK: nets slung between low steel frames on the deck
    for k, (u, v) in enumerate(((-h1 + 9, h2 - 9), (-h1 + 9, -h2 + 22), (h1 - 24, -h2 + 7))):
        for du in (-2.6, 2.6):
            for dv in (-1.4, 1.4):
                S.tube([Q(u + du, v + dv, z), Q(u + du, v + dv, z + 0.9)], 0.05, 6)
        S.tube([Q(u - 2.6, v - 1.4, z + 0.9), Q(u + 2.6, v - 1.4, z + 0.9)], 0.04, 4)
        S.tube([Q(u - 2.6, v + 1.4, z + 0.9), Q(u + 2.6, v + 1.4, z + 0.9)], 0.04, 4)
        us, vs = np.linspace(-2.5, 2.5, 9), np.linspace(-1.35, 1.35, 5)
        K("net").grid([[Q(u + a, v + b, z + 0.9 - 0.45 * (1 - (a / 2.5) ** 2) * (1 - (b / 1.35) ** 2)) for a in us] for b in vs])
    # the escalator up from the 46F gallery: steps, glass balustrades with black handrails, the glass walls
    # round the top of its well, and the well's floor at 46F
    e = s["escalator"]
    o, f = np.asarray(e["origin"]), np.asarray(e["axis"])
    E = frame(o, f)
    run, rise, z0 = e["run_m"], e["rise_m"], e["z0"]
    n = int(rise / 0.2)
    for j in range(n):
        u0, u1 = j * run / n, (j + 1) * run / n
        block(K("steel", "esc"), E, u0, u1, -0.55, 0.55, z0 + j * rise / n - 0.25, z0 + (j + 1) * rise / n)
    block(K("steel", "esc"), E, run, e["plate_end"], -1.75, 1.75, z - 0.25, z)        # the top landing, across the well
    block(K("steel", "esc"), E, -2.2, 0.0, -1.75, 1.75, z0 - 0.25, z0)                # the landing at 46F
    for side in (-1, 1):
        K("glass", "esc").quad(E(-0.5, side * 0.62, z0 + 0.1), E(run + 1.0, side * 0.62, z + 0.1), E(run + 1.0, side * 0.62, z + 1.05), E(-0.5, side * 0.62, z0 + 1.05))
        K("rubber", "esc").tube([E(-0.6, side * 0.62, z0 + 1.0), E(run + 1.1, side * 0.62, z + 1.0)], 0.04, 6)
        block(K("steel_dark", "esc"), E, -0.5, run + 1.0, side * 0.62 - 0.06, side * 0.62 + 0.06, z0 - 0.3, z0 + 0.12)
    pc = np.asarray(s["pit_c"])
    W = frame(pc, f)
    L, Wd = s["pit_len"] / 2, s["pit_w"] / 2
    for (ua, va), (ub, vb) in (((-L, -Wd), (L, -Wd)), ((L, -Wd), (L, Wd)), ((L, Wd), (-L, Wd)), ((-L, Wd), (-L, -Wd))):
        if ua == ub == L:
            continue  # the open end, where the escalator comes up onto the deck
        # part of the escalator's mesh (esc_*), so the game does not make the rim solid round the rider's head
        K("glass", "esc_well").quad(W(ua, va, z), W(ub, vb, z), W(ub, vb, z + 1.3), W(ua, va, z + 1.3))
        K("steel_dark", "esc_well").tube([W(ua, va, z + 1.3), W(ub, vb, z + 1.3)], 0.03, 4)
    for q in s["beams"]:                      # the searchlights of CROSSING LIGHT
        lathe_at(S, q[0], q[1], [(z, 0.35), (z + 0.6, 0.3), (z + 0.65, 0.0)], 10)
        lathe_at(K("lamp", "lit"), q[0], q[1], [(z + 0.6, 0.26), (z + 0.75, 0.0)], 10)
    return K.meshes()


# ---------------------------------------------------------------- hooks

def adjust_building(b, cls, g, geoms, ctx):
    """geoms: [polygon, min_height, height, source, part_name] per solid."""
    if g.geom_type != "Polygon":
        return geoms
    geoms = suga_building(b, cls, g, geoms, ctx)
    if (b["name"] or "") == SCRAMBLE_SQ:
        geoms = sky_building(b, g, geoms, ctx)
    return districts_building(b, cls, g, geoms, ctx)


def finalize(ctx):
    suga_finalize(ctx)
    districts_finalize(ctx)
    sky_finalize(ctx)


def landmark_meshes(scene):
    lm = scene["landmarks"]
    meshes = []
    if "suga" in lm:
        meshes += suga_meshes(lm["suga"])
    meshes += districts_meshes(lm)
    if "shibuya_sky" in lm:
        meshes += sky_meshes(lm["shibuya_sky"])
    return MATERIALS, meshes


def sky_surfaces(s):
    """SHIBUYA SKY: the escalator from 46F (it carries you), GEO COMPASS's top and its four flights of steps."""
    out = []
    e = s["escalator"]
    out.append({"name": "SHIBUYA SKY escalator", "type": "strip", "origin": e["origin"], "axis": e["axis"], "half_width": 0.55,
                "profile": [[-2.2, e["z0"]], [0.0, e["z0"]], [e["run_m"], s["deck_z"]], [e["plate_end"], s["deck_z"]]],
                "thickness": 1.0, "mesh": "sky_esc", "moving_ms": s["escalator_ms"], "moving_u": [0.0, e["run_m"] + 0.5], "label": "the escalator to the roof"})
    gc, zt, z = s["compass_m"] / 2, s["deck_z"] + 2.0, s["deck_z"]
    a1, a2, c = np.asarray(s["a1"]), np.asarray(s["a2"]), np.asarray(s["centre"])
    out.append({"name": "SHIBUYA SKY GEO COMPASS", "type": "strip", "origin": s["centre"], "axis": s["a1"], "half_width": gc,
                "profile": [[-gc, zt], [gc, zt]], "thickness": 2.5, "mesh": "sky_compass", "label": "GEO COMPASS"})
    for k, dvec in enumerate((a1, -a1, a2, -a2)):
        o = c + dvec * gc
        out.append({"name": f"SHIBUYA SKY steps {k + 1}", "type": "strip", "origin": [round(float(o[0]), 2), round(float(o[1]), 2)],
                    "axis": [round(float(dvec[0]), 5), round(float(dvec[1]), 5)], "half_width": 2.5,
                    "profile": [[0.0, zt], [2.0, z]], "thickness": 2.2, "mesh": "sky_steps", "label": "GEO COMPASS"})
    return out


# what the wishes say, for readers of other languages (the same order as WISHES)
GLOSS = ["Your Name: happy 10th anniversary of the release!", "Ten years on, these stairs still squeeze my heart.", "May Taki and Mitsuha always be happy.",
         "A pilgrimage: finally made it! Summer, Reiwa 8.", "Like a braided cord, may our bond be tied.", "May I never forget the name of the one who matters.",
         "Ten years since the summer we saw the comet. May we meet again.", "Saw the 10th-anniversary re-release three times. Thank you!",
         "Passing my exams: may I get into a university in Tokyo. Reiwa 8.", "Safety for the family, health first. Reiwa 8, year of the fire horse.",
         "A year since I moved to Yotsuya: I climb these stairs every morning.", "The film: praying for a big hit, from all the staff. 2026.",
         "On the stairs at dusk I felt I passed someone.", "First visit of 2026: this year, may I meet the one.", "A job offer, please. Reiwa 8.",
         "Mitsuha, I love you. 10th anniversary.", "Director Shinkai: thank you for a wonderful ten years.", "The view I was always looking for. Glad I came.",
         "I'll come back in the twilight. October 2026.", "From Persona 5's holy ground to Your Name's: a Tokyo pilgrimage, 2026.",
         "Your Name: happy 10th! Finally standing on these stairs. August 2026.", "May I, too, meet the person meant for me.",
         "Came from Shanghai. Ten years, and I still cry.", "May no meeting ever be forgotten. Suga Shrine, 2026.", "Peace for my family, work going well. 2026.",
         "Your Name: happy 10th! A pilgrimage from Taipei. October 2026.", "May I meet that person again.", "Your Name: happy 10th anniversary!",
         "Finally here: the Suga Shrine stairs. A dream come true.", "", "", "", "", "Ten years of Kimi no Na wa! Mexico, 2026.",
         "Ten years already... thank you for this film. Paris, 2026.", "", "Prosperity in business. Reiwa 8.", "Road safety. Reiwa 8, Yotsuya.",
         "May Mike the cat stay well.", "Ten years in Tokyo: that film gave me the push."]


def spot(id_, name, at, z, verb, lines, radius=2.5, pick=0, role=""):
    return {"id": id_, "name": name, "at": [round(float(at[0]), 2), round(float(at[1]), 2), round(float(z), 2)], "verb": verb, "lines": lines,
            "radius": radius, **({"pick": 1} if pick else {}), **({"role": role} if role else {})}


def talk(at, z, lines, radius=14, side=True):
    return {"at": [round(float(at[0]), 2), round(float(at[1]), 2), round(float(z), 2)], "radius": radius, "lines": lines, "side": side}


def suga_extras(s, spots, chatter):
    P = precinct_frame({"suga": s})
    r = s["ema_rack"]
    wishes = []
    for (fname, lines, ink, kind), gl in zip(WISHES, GLOSS):
        txt = "「" + " ".join(lines) + "」"
        wishes.append(txt + (f" ({gl})" if gl else ""))
    spots.append(spot("ema", "Ema rack 絵馬掛所", P(r["s"], r["v"], 0), r["z"], "Read an ema", wishes, 3.0, pick=1, role="Suga Shrine, 2026"))
    h = s["hall"]
    spots.append(spot("saisen", "Offering box 賽銭箱", P(h["s_front"] - 2.4, 0, 0), h["z"], "Pray at the hall", [
        "Bow twice, clap twice, bow once. A coin first: five yen, go-en, sounds like 'a bond'.",
        "Suga Shrine enshrines Susanoo and the Inari kami. It has watched over Yotsuya's eighteen towns since 1634."], 2.6, role="Suga Shrine"))
    q = s["temizuya"]
    spots.append(spot("temizuya", "Temizuya 手水舎", P(q[0], q[1], 0), q[2], "Rinse your hands", [
        "Left hand, then right, then a sip from your cupped left palm, never from the ladle. Then rinse the handle."], 2.4))
    ok = s["otokozaka"]
    foot = np.asarray(ok["origin"]) - np.asarray(ok["axis"]) * 16.0
    spots.append(spot("otoko", "男坂 Otokozaka", foot - np.asarray(ok["axis"]) * 1.0, ok["z_foot"], "Look up the stairs", [
        f"The 男坂: {ok['steps']} stone steps, 18, 16 and 15 to the approach and 3 more, {OTOKO['width_m']} m wide, red iron handrails both sides and down the middle.",
        f"Here each riser is {round(ok['riser_m'] * 100)} cm: {round(ok['z_top'] - ok['z_foot'], 1)} m from the street to the shrine, by GSI's laser survey of the ground."], 3.0))
    chatter.append(talk(foot - np.asarray(ok["axis"]) * 3.0, ok["z_foot"], [["Pilgrim", "Here! This is the angle from the poster."],
                   ["Friend", "Stand on the left. I'll be halfway up."], ["Pilgrim", "Ten years... I was in high school."]]))


def districts_extras(lm, spots, chatter):
    h = lm.get("hachiko")
    if h:
        at, f = np.asarray(h["at"]), np.asarray(h["face"])
        spots.append(spot("hachiko", "Hachiko 忠犬ハチ公", at + f * 1.4, h["z"], "Look at Hachiko", [
            "Hachiko, an Akita, met his master here every evening. After Professor Ueno died in 1925 he kept coming, for almost ten years.",
            "The first statue (1934) went for metal in the war; this is the 1948 recast. 'Meet at Hachiko' is still how Tokyo says 'meet at Shibuya'."], 2.8))
        chatter.append(talk(at + f * 6 + left_of(f) * 4, h["z"], [["Student", "Meet at Hachiko? Everyone says that."], ["Friend", "Which side of Hachiko, though?"],
                                                               ["Student", "The side with the tourists."]]))
    sc = lm.get("scramble")
    if sc:
        n = sc["node"]
        chatter.append(talk(n, sc["z"][0][0] if sc["z"] else 15, [["Visitor", "Wait for green... now!"], ["Visitor", "All the lights go green at once: every way, even across."],
                                                                 ["Friend", "Don't stop in the middle for a photo!"]], 18))
    cg = lm.get("center_gai")
    if cg:
        at, f = np.asarray(cg["at"]), np.asarray(cg["axis"])
        spots.append(spot("center_gai", "Center Gai センター街", at + f * 1.5, cg["z"], "Read the arch", [
            "SHIBUYA CENTER-GAI: a few hundred metres of shops, ramen and arcades from the scramble towards Udagawacho. A game knew it as Central Street."], 4.0))
        chatter.append(talk(at + f * 12, cg["z"], [["Friend", "Ramen or monja?"], ["Friend", "Ramen. Then the arcade."], ["Friend", "You always say that."]]))
    y = lm.get("yongen", {})
    if "chiyo" in y:
        c = y["chiyo"]
        mid, n = np.asarray(c["at"]), np.asarray(c["normal"])
        t_ = np.array([-n[1], n[0]])
        spots.append(spot("chiyo", "Chiyo-no-yu 千代の湯", mid + n * 1.6 - t_ * 1.2, c["z"], "Look at the bathhouse", [
            "千代の湯, a neighbourhood sentō. The curtain says ゆ, hot water. Tokyo sets the price of a bath at every sentō in the city.",
            "Coin laundry beside it, vending machines out front: everything a backstreet needs. A game put its bathhouse here, across from the café."], 3.0))
        spots.append(spot("vending", "Vending machines 自販機", mid + n * 1.4 - t_ * 3.7, c["z"], "Buy a drink", [
            "A can of cold green tea rolls out. 150 yen.", "Hot milk tea in a can. In October, already.", "A bottle of water. There are about two million of these machines in Japan."], 2.2, pick=1))
        chatter.append(talk(mid + n * 3.0, c["z"], [["", "(from inside) Ka-kon... a wooden bucket on tiles."], ["Regular", "Ahh. Just right."]], 9, False))
    if "marina" in y:
        m = y["marina"]
        spots.append(spot("marina", "New Marina ニューマリーナ", np.asarray(m["at"]) + np.asarray(m["normal"]) * 1.5, m["z"], "Look at the snack bar", [
            "A snack bar: a counter, a few stools, karaoke, a mama-san. A game borrowed this front for its café; the café isn't here, this is somebody's bar.",
            "Upstairs next door, a café in an old house. Keep your voice down: people live in these lanes."], 2.8))
        chatter.append(talk(np.asarray(m["at"]) + np.asarray(m["normal"]) * 4.0, m["z"], [["Regular", "Same as always?"], ["Mama-san", "Same as always."]], 10, False))
    if "hanamasa" in y:
        hm = y["hanamasa"]
        spots.append(spot("hanamasa", "Niku no Hanamasa 肉のハナマサ", np.asarray(hm["at"]) + np.asarray(hm["normal"]) * 1.6, hm["z"], "Look at the supermarket", [
            "肉のハナマサ: a meat-first supermarket, open 24 hours. The game's supermarket sits where this one does, with another name."], 3.0))
    k = lm.get("kabukicho_gate")
    if k:
        at, f = np.asarray(k["at"]), np.asarray(k["axis"])
        spots.append(spot("kabukicho", "Kabukicho Ichibangai 歌舞伎町一番街", at - f * 2.0, k["z"], "Look up at the arch", [
            "The red arch has stood at Kabukicho Ichibangai since 1969. Kabukicho is named for a kabuki theatre planned here after the war and never built."], 4.0))
        chatter.append(talk(at + f * 10, k["z"], [["Friend", "Karaoke till the first train?"], ["Friend", "The first train's at five..."], ["Friend", "Exactly."]]))


def sky_extras(s, spots, chatter):
    c, a1, a2 = np.asarray(s["centre"]), np.asarray(s["a1"]), np.asarray(s["a2"])
    zt = s["deck_z"] + 2.0
    lines = ["GEO COMPASS, the highest point of SHIBUYA SKY: the floor points the way to places out of sight."]
    for name, ll in COMPASS_TO.items():
        brg, km = bearing_km(COMPASS_FROM, ll)
        lines.append(f"{name}: {km:,.0f} km at {brg:.0f}°" if km >= 10 else f"{name}: {km:.1f} km at {brg:.0f}°")
    spots.append(spot("geocompass", "GEO COMPASS", c, zt, "Read the compass", [lines[0], "  ·  ".join(lines[1:6]), "  ·  ".join(lines[6:])], 6.0))
    h1, h2 = s["half"]
    for u, v in ((-h1 + 9, h2 - 9),):
        p = c + a1 * u + a2 * v
        spots.append(spot("hammock", "CLOUD HAMMOCK", p, s["deck_z"], "Lie in the net", [
            "You lie back in the net. 229 metres up, nothing over you but the sky, and the wind."], 3.2))
    edge = c + a1 * (h1 - 9.0) + a2 * (h2 - 9.0)
    chatter.append(talk(edge, s["deck_z"], [["Visitor", "You can see the scramble breathing."], ["Visitor", "Is that Mt Fuji? Left, look."], ["Friend", "Only on a clear day."]], 16))


def game_extras(scene):
    """What the landmarks add to the game: SHIBUYA SKY's lift (SKY GATE: street to the 46F gallery, at the
    real lifts' 360 m a minute) and its roof to travel to from the start; spots to look at closely and
    conversations to overhear, placed at the landmarks."""
    lm = scene["landmarks"]
    spots, chatter = [], []
    if "suga" in lm:
        suga_extras(lm["suga"], spots, chatter)
    districts_extras(lm, spots, chatter)
    out = {"spots": spots, "chatter": chatter}
    s = lm.get("shibuya_sky")
    if not s:
        return out
    sky_extras(s, spots, chatter)
    e = s["escalator"]
    land = np.asarray(e["origin"]) - np.asarray(e["axis"]) * 1.2
    c, a1, a2 = np.asarray(s["centre"]), np.asarray(s["a1"]), np.asarray(s["a2"])
    edge = c + a1 * (s["half"][0] - 9.0) + a2 * (s["half"][1] - 9.0)   # SKY EDGE
    return out | {"lifts": [{"id": "sky-gate", "name": "SHIBUYA SKY", "line": "SKY GATE · TRANSITION POD · 14F → 45F", "m_per_min": s["lift_m_per_min"],
                       "stops": [{"name": "Shibuya Scramble Square, street level", "at": [*s["door"], s["door_z"]]},
                                 {"name": "SHIBUYA SKY 46F, the escalator to the roof", "at": [round(float(land[0]), 2), round(float(land[1]), 2), e["z0"]],
                                  "face": e["axis"]}]}],
            "travel": [{"id": "shibuya-sky", "name": "SHIBUYA SKY (the roof, 229 m)", "at": [round(float(edge[0]), 1), round(float(edge[1]), 1), s["deck_z"]], "always": True}]}


def game_surfaces(scene):
    """The shrine's stairs as walkable strips (every footway crossing them is put on them), and the
    steps up to the hall's platform."""
    out = []
    s = scene["landmarks"].get("suga")
    if not s:
        return sky_surfaces(scene["landmarks"]["shibuya_sky"]) if "shibuya_sky" in scene["landmarks"] else out
    ok = s["otokozaka"]
    out.append({"name": "Suga Shrine 男坂", "type": "strip", "origin": ok["origin"], "axis": ok["axis"], "half_width": ok["half_width"] + 0.2,
                "profile": ok["profile"], "thickness": 2.0, "mesh": "suga_otoko", "drape": True, "label": "the 男坂"})
    for k, leg in enumerate((s.get("onnazaka") or {}).get("legs", [])):
        out.append({"name": f"Suga Shrine 女坂 {k + 1}", "type": "strip", "origin": leg["origin"], "axis": leg["axis"], "half_width": leg["half_width"] + 0.2,
                    "profile": leg["profile"], "thickness": 2.0, "mesh": "suga_onna", "drape": True, "label": "the 女坂"})
    if "shibuya_sky" in scene["landmarks"]:
        out += sky_surfaces(scene["landmarks"]["shibuya_sky"])
    return out
