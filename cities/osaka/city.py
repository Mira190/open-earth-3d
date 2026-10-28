"""Osaka: what the generic pipeline cannot know from open data.

Building adjustments (called by pipeline/build_scene.py):
  * Osaka Castle keep: OpenStreetMap maps it as four stacked blocks (31 m); the keep becomes a
    13.3 m stone base solid plus parametric tiers. Ground and the plan axis come from Project
    PLATEAU's footprint (the PLATEAU record "大阪城天守閣": 54.6 m with its stone base, ground
    31.7 m T.P.).
  * Tsutenkaku: the OSM footprint is a 108 m box. The footprint stays as a 12 m base and the
    steel tower is parametric above it.
  * HEP FIVE: PLATEAU's 107 m is the top of the Ferris wheel, not the building. The building
    is drawn at 47 m (an estimate) and the wheel is parametric.
  * The Glico sign and the Kani Doraku crab are placed on the buildings nearest their published
    positions, facing the Dotonbori canal.

Parametric landmarks (pipeline/landmarks.py), with anchors measured from the data:
  Osaka Castle keep   stone base 13.3 m, tower 39.4 m above it (total 52.7 m, 54.8 m with the
                      golden shachi), five roof tiers outside, eight floors inside, green copper
                      roofs (Osaka Prefecture, "大阪城天守閣" fact sheet; Bunshun for 54.8 m).
                      Plan sizes and the tier split are approximations, not survey data.
  Tsutenkaku          103 m (108 m with the lightning rod), 1956, steel (Naito Tachu, Takenaka);
                      gold observatory on the fifth floor at 87.5 m and an open deck at 94.5 m
                      (Osaka City planning leaflet and tourist sources). The lattice is schematic.
  Glico sign          the Dotonbori running man: a panel about 21 m wide with a simplified
                      runner, at the position published for it. Size and figure are indicative.
  Kani Doraku crab    the moving crab on the Dotonbori front, about 8 m across.
  HEP FIVE wheel      75 m diameter, top at 106 m above the street, lowest point at the seventh
                      floor (about 31 m).
"""
import math

import numpy as np
from shapely.geometry import Point

from meshkit import Mesh

TSUTENKAKU = "通天閣"
CASTLE = "大阪城"
HEP5 = "HEP FIVE"
KANI = "かに道楽"
GLICO_LONLAT = (135.50134, 34.66885)   # Glico sign, Dotonbori (Wikipedia coordinates)
CASTLE_STONE_H, CASTLE_TOWER_H, CASTLE_TOP_H = 13.3, 39.4, 54.8
BRICK_HALL, CITY_HALL = "大阪市中央公会堂", "大阪市役所"
HEP5_BUILDING_H = 47.0

MATERIALS = {
    "granite": {"color": "#a7a396", "roughness": 0.92, "metalness": 0.0},
    "plaster": {"color": "#efece2", "roughness": 0.8, "metalness": 0.0},
    "copper_roof": {"color": "#5f8f7c", "roughness": 0.55, "metalness": 0.35},
    "gold": {"color": "#d6a931", "roughness": 0.32, "metalness": 0.85},
    "black_wall": {"color": "#24201e", "roughness": 0.6, "metalness": 0.1},
    "steel": {"color": "#a9b1b6", "roughness": 0.5, "metalness": 0.45},
    "glass": {"color": "#31475a", "roughness": 0.1, "metalness": 0.5},
    "neon": {"color": "#ff7a2a", "roughness": 0.4, "metalness": 0.0, "emissive": "#ff6a1a", "glow": 1.6},
    "glico_blue": {"color": "#1d62c9", "roughness": 0.5, "metalness": 0.0, "emissive": "#2a6cff", "glow": 1.3},
    "glico_white": {"color": "#f4f1ea", "roughness": 0.5, "metalness": 0.0, "emissive": "#ffffff", "glow": 1.4},
    "glico_red": {"color": "#e5242b", "roughness": 0.5, "metalness": 0.0, "emissive": "#ff2a30", "glow": 1.3},
    "glico_gold": {"color": "#f3b320", "roughness": 0.5, "metalness": 0.0, "emissive": "#ffb020", "glow": 1.3},
    "crab": {"color": "#e04a2b", "roughness": 0.45, "metalness": 0.1, "emissive": "#ff4a20", "glow": 0.9},
    "wheel_red": {"color": "#d8302f", "roughness": 0.45, "metalness": 0.3},
    # shop signs: painted by day, lit after dark (the viewer lights "floodlit" meshes by night)
    "sign_red": {"color": "#d8262b", "roughness": 0.6, "metalness": 0.0, "emissive": "#ff2a2a", "glow": 1.5},
    "sign_yellow": {"color": "#f1c21b", "roughness": 0.6, "metalness": 0.0, "emissive": "#ffcf30", "glow": 1.4},
    "sign_pink": {"color": "#d9378c", "roughness": 0.6, "metalness": 0.0, "emissive": "#ff3fa4", "glow": 1.5},
    "sign_cyan": {"color": "#2aa6d4", "roughness": 0.6, "metalness": 0.0, "emissive": "#31d0ff", "glow": 1.4},
    "sign_white": {"color": "#ece8de", "roughness": 0.6, "metalness": 0.0, "emissive": "#fff2d8", "glow": 1.2},
    "sign_green": {"color": "#35a85a", "roughness": 0.6, "metalness": 0.0, "emissive": "#6dff8f", "glow": 1.2},
}
SIGN_MATS = ["sign_red", "sign_yellow", "sign_pink", "sign_cyan", "sign_white", "sign_green", "sign_red", "sign_yellow"]
# the neon districts, in the local frame: x0, x1, y0, y1 (Dotonbori and Namba, Shinsekai, Umeda's Hankyu streets)
NEON_DISTRICTS = [(-1500, -420, -1560, -820), (-900, -330, -3230, -2760), (-1500, -760, 2470, 2980)]
SIGN_CLASSES = {"", "commercial", "retail", "entertainment", "hotel", "restaurant", "office"}
MAX_SIGNS = 1400


# ---------------------------------------------------------------- geometry helpers

def frame(cx, cy, ang):
    """(u, v, z) -> local point, u along `ang` (radians from east) and v to its left."""
    c, s = math.cos(ang), math.sin(ang)
    return lambda u, v, z: np.array([cx + u * c - v * s, cy + u * s + v * c, z])


def rect(P, w, d, z):
    return [P(sx * w / 2, sy * d / 2, z) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def loft(mesh, P, w0, d0, z0, w1, d1, z1, bottom=False, top=True):
    """A frustum between two rectangles (flat shaded): walls, hip roofs, stone batter."""
    a, b = rect(P, w0, d0, z0), rect(P, w1, d1, z1)
    for k in range(4):
        j = (k + 1) % 4
        mesh.quad(a[k], a[j], b[j], b[k])
    if top:
        mesh.quad(b[0], b[3], b[2], b[1])
    if bottom:
        mesh.quad(a[0], a[1], a[2], a[3])


def slab(mesh, P, u0, u1, v0, v1, z0, z1):
    loft(mesh, lambda u, v, z: P((u0 + u1) / 2 + u * (u1 - u0), (v0 + v1) / 2 + v * (v1 - v0), z), 1, 1, z0, 1, 1, z1, True)


def ring_trim(mesh, P, w, d, z, t=0.5, h=0.45):
    """Thin trim running round a rectangle."""
    hw, hd = w / 2, d / 2
    slab(mesh, P, -hw, hw, -hd - t / 2, -hd + t / 2, z, z + h)
    slab(mesh, P, -hw, hw, hd - t / 2, hd + t / 2, z, z + h)
    slab(mesh, P, -hw - t / 2, -hw + t / 2, -hd, hd, z, z + h)
    slab(mesh, P, hw - t / 2, hw + t / 2, -hd, hd, z, z + h)


def prism(mesh, P, u0, u1, v_out, v_in, z0, z1):
    """A triangular gable: base u0..u1 on z0, apex at z1, from v_in out to v_out."""
    um = (u0 + u1) / 2
    a0, a1, a2 = P(u0, v_out, z0), P(u1, v_out, z0), P(um, v_out, z1)
    b0, b1, b2 = P(u0, v_in, z0), P(u1, v_in, z0), P(um, v_in, z1)
    mesh.tri(a0, a1, a2)
    mesh.tri(b2, b1, b0)
    mesh.quad(a0, b0, b2, a2)
    mesh.quad(a1, a2, b2, b1)


def cuboid(mesh, c, sx, sy, sz):
    """An axis-aligned box about point c (local frame)."""
    c = np.asarray(c, float)
    lo, hi = c - np.array([sx, sy, sz]) / 2, c + np.array([sx, sy, sz]) / 2
    v = lambda i, j, k: np.array([(lo, hi)[i][0], (lo, hi)[j][1], (lo, hi)[k][2]])
    for a, b, d, e in (((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)), ((0, 0, 1), (0, 1, 1), (1, 1, 1), (1, 0, 1)),
                       ((0, 0, 0), (0, 0, 1), (1, 0, 1), (1, 0, 0)), ((0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)),
                       ((0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)), ((1, 0, 0), (1, 0, 1), (1, 1, 1), (1, 1, 0))):
        mesh.quad(v(*a), v(*b), v(*d), v(*e))


def rect_of(g):
    """(centre, angle of the long side in radians, long, short) of a polygon's minimum rotated rectangle."""
    r = np.asarray(g.minimum_rotated_rectangle.exterior.coords)[:4]
    e1, e2 = r[1] - r[0], r[2] - r[1]
    l1, l2 = np.linalg.norm(e1), np.linalg.norm(e2)
    e, long_, short_ = (e1, l1, l2) if l1 >= l2 else (e2, l2, l1)
    return [float(g.centroid.x), float(g.centroid.y)], math.atan2(e[1], e[0]), float(long_), float(short_)


def facing_edge(g, toward=(0.0, 1.0)):
    """The longest exterior edge of g whose outward normal points most towards `toward`:
    returns (midpoint, outward unit normal, length)."""
    cs = np.asarray(g.exterior.coords)
    ccw = g.exterior.is_ccw
    best = None
    for a, b in zip(cs[:-1], cs[1:]):
        e = b - a
        L = float(np.linalg.norm(e))
        if L < 3:
            continue
        n = np.array([e[1], -e[0]]) / L if ccw else np.array([-e[1], e[0]]) / L
        score = float(np.dot(n, toward)) * min(L, 25.0)
        if best is None or score > best[0]:
            best = (score, (a + b) / 2, n, L)
    return best[1], best[2], best[3]


# ---------------------------------------------------------------- build_scene hooks

def adjust_building(b, cls, g, geoms, ctx):
    """geoms: [polygon, min_height, height, source, part_name] per solid."""
    name = b["name"] or ""
    lm = ctx.landmarks
    if name == CASTLE and "castle" not in lm:
        # the keep: OSM's stepped blocks give the centre; the stone base is a solid just inside
        # the parametric batter, so people and helicopters collide with it
        c, ang, long_, short_ = rect_of(g)
        pl = ctx.plateau.named("大阪城天守閣")       # ground 31.7 m T.P. under the keep, surveyed for PLATEAU
        z0 = float(pl["ground"]) if pl and pl.get("ground") is not None else ctx.ground(*c)
        lm["castle"] = {"centroid": [round(c[0], 1), round(c[1], 1)], "axis_deg": round(math.degrees(ang), 2), "ground_m": round(z0, 1),
                        "osm_long_m": round(long_, 1), "osm_short_m": round(short_, 1)}
        inner = g.minimum_rotated_rectangle.buffer(-3.0)
        return [[p, 0.0, CASTLE_STONE_H, "parametric", None] for p in ctx.polygons(inner)] or geoms
    if name == TSUTENKAKU:
        c, ang, long_, short_ = rect_of(g)
        lm["tsutenkaku"] = {"centroid": [round(c[0], 1), round(c[1], 1)], "axis_deg": round(math.degrees(ang), 2),
                            "width_m": round(long_, 1), "depth_m": round(short_, 1), "ground_m": round(ctx.ground(*c), 1)}
        return [[p, 0.0, 12.0, "parametric", None] for p in ctx.polygons(g)]
    if name == HEP5 and "hep_five" not in lm:
        c, ang, long_, short_ = rect_of(g)
        lm["hep_five"] = {"centroid": [round(c[0], 1), round(c[1], 1)], "axis_deg": round(math.degrees(ang), 2),
                          "length_m": round(long_, 1), "ground_m": round(ctx.ground(*c), 1), "building_m": HEP5_BUILDING_H}
        return [[p, 0.0, HEP5_BUILDING_H, "parametric", None] for p in ctx.polygons(g)]
    if name == KANI and "kani" not in lm:
        mid, n, L = facing_edge(g, (0.0, 1.0))
        lm["kani"] = {"at": [round(float(mid[0]), 1), round(float(mid[1]), 1)], "normal": [round(float(n[0]), 4), round(float(n[1]), 4)],
                      "ground_m": round(ctx.ground(*mid), 1), "height_m": round(max(s[2] for s in geoms), 1)}
    if name == BRICK_HALL:
        b["facade_color"] = "#a2523c"
    if name == CITY_HALL:
        b["facade_color"] = "#cdc2ae"
    # facades that might carry shop signs: collected here, kept in finalize() if a street runs past them
    if (b["class"] or "") in SIGN_CLASSES and geoms and g.geom_type == "Polygon" and 60 < g.area < 1600:
        c = g.centroid
        if any(x0 < c.x < x1 and y0 < c.y < y1 for x0, x1, y0, y1 in NEON_DISTRICTS):
            top = max(s_[2] for s_ in geoms)
            if 7 <= top <= 80:
                ctx.signs.append((g, top))
    # the building nearest the Glico sign that is big enough to carry a sign
    if g.area > 150 and geoms:
        d = g.distance(Point(*ctx.city.fwd.transform(*GLICO_LONLAT)))
        if d < 25 and d < lm.get("_glico", {}).get("d", 1e9):
            mid, n, L = facing_edge(g, (0.0, 1.0))
            lm["_glico"] = {"d": d, "at": [float(mid[0]), float(mid[1])], "normal": [float(n[0]), float(n[1])], "len": L,
                            "roof_m": round(max(s[2] for s in geoms), 1), "ground_m": round(ctx.ground(*mid), 1)}
    return geoms


def sign_sites(ctx):
    """Shop-sign sites on facades that face a street or the canal path: [x, y, nx, ny, ground, top, edge length]."""
    import duckdb
    from shapely import STRtree
    from shapely import wkb as swkb
    con = duckdb.connect()
    lines = [ctx.city.to_local(swkb.loads(bytes(r[0]))) for r in con.execute(
        f"SELECT wkb FROM '{ctx.city.raw}/overture_segment.parquet' WHERE subtype = 'road' AND class IN "
        "('pedestrian','footway','living_street','residential','tertiary','secondary','primary','unclassified','service','path','steps')").fetchall()]
    lines = [l for l in lines if l.geom_type == "LineString"]
    tree = STRtree(lines)
    out = []
    for g, top in ctx.signs:
        cs = np.asarray(g.exterior.coords)
        ccw = g.exterior.is_ccw
        best = []
        for a, b in zip(cs[:-1], cs[1:]):
            e = b - a
            L = float(np.hypot(*e))
            if L < 5.0:
                continue
            n = np.array([e[1], -e[0]]) / L if ccw else np.array([-e[1], e[0]]) / L
            mid = (a + b) / 2
            probe = Point(mid + n * 4.0)                       # a point 4 m in front of the facade
            near = tree.query(probe.buffer(9.0))
            if not len(near):
                continue
            d = min(lines[i].distance(probe) for i in near)
            if d < 7.0 and not g.buffer(0.5).contains(probe):
                best.append((d + 0.02 * (60 - min(L, 60)), mid, n, L))
        for _, mid, n, L in sorted(best, key=lambda t: t[0])[:2]:
            out.append([round(float(mid[0]), 1), round(float(mid[1]), 1), round(float(n[0]), 3), round(float(n[1]), 3),
                        round(ctx.ground(*mid), 1), round(top, 1), round(L, 1)])
    return out


def finalize(ctx):
    lm = ctx.landmarks
    sites = sign_sites(ctx)
    if sites:
        # a stable pseudo-random subset when there are too many
        rng = np.random.default_rng(1612)
        if len(sites) > MAX_SIGNS:
            sites = [sites[i] for i in sorted(rng.choice(len(sites), MAX_SIGNS, replace=False))]
        lm["signs"] = {"sites": sites, "note": "shop-sign sites: facades on streets in the neon districts; the signs themselves are indicative"}
    gl = lm.pop("_glico", None)
    if gl:
        lm["glico"] = {k: (round(v, 1) if isinstance(v, float) else v) for k, v in gl.items()}
    if "castle" in lm:
        c = lm["castle"]
        c.update({"stone_base_m": CASTLE_STONE_H, "tower_m": CASTLE_TOWER_H, "total_m": CASTLE_STONE_H + CASTLE_TOWER_H, "height_m": CASTLE_TOP_H})
        ctx.labels["大阪城天守閣 Osaka Castle"] = [c["centroid"][0], c["centroid"][1], round(c["ground_m"] + CASTLE_TOP_H + 4, 1)]
    if "tsutenkaku" in lm:
        t = lm["tsutenkaku"]
        t.update({"published_m": 103.0, "with_rod_m": 108.0, "observatory_m": 87.5, "open_deck_m": 94.5})
        ctx.labels["通天閣 Tsutenkaku"] = [t["centroid"][0], t["centroid"][1], round(t["ground_m"] + 112, 1)]
    if "hep_five" in lm:
        h = lm["hep_five"]
        ctx.labels["HEP FIVE"] = [h["centroid"][0], h["centroid"][1], round(h["ground_m"] + 110, 1)]
    if "glico" in lm:
        g = lm["glico"]
        ctx.labels["グリコ Glico"] = [round(g["at"][0], 1), round(g["at"][1], 1), round(g["ground_m"] + g["roof_m"] + 18, 1)]


# ---------------------------------------------------------------- landmark meshes

def landmark_meshes(scene):
    lm = scene["landmarks"]
    meshes = []
    if "castle" in lm:
        meshes += osaka_castle(lm["castle"])
    if "tsutenkaku" in lm:
        meshes += tsutenkaku(lm["tsutenkaku"])
    if "hep_five" in lm:
        meshes += hep_wheel(lm["hep_five"])
    if "glico" in lm:
        meshes += glico_sign(lm["glico"])
    if "kani" in lm:
        meshes += kani_crab(lm["kani"])
    if "signs" in lm:
        meshes += shop_signs(lm["signs"]["sites"])
    return MATERIALS, meshes


# ---------------------------------------------------------------- Osaka Castle keep

# wall plan (E-W, N-S), wall height, eave overhang, roof rise: nominal values, rescaled to 39.4 m
TIERS = [(30.0, 25.5, 7.2, 3.4, 3.8), (25.0, 21.5, 6.2, 3.0, 3.4), (20.0, 17.5, 5.4, 2.8, 3.0),
         (15.5, 13.5, 5.0, 2.6, 2.8), (11.0, 9.5, 5.8, 2.4, 3.6)]


def osaka_castle(c):
    P = frame(c["centroid"][0], c["centroid"][1], math.radians(c["axis_deg"]))
    z0 = c["ground_m"]
    stone, wall, roof, gold, black = (Mesh("castle_stone", "granite", False), Mesh("castle_wall", "plaster", False),
                                      Mesh("castle_roof", "copper_roof", False), Mesh("castle_gold", "gold", False),
                                      Mesh("castle_black", "black_wall", False))
    # stone base: a batter from 42 x 37 m at the foot to 37 x 32 m at the top, 13.3 m high
    # (carried down 12 m below the ground, with the same batter, so it never floats on the hill's slope)
    loft(stone, P, 45.9, 40.9, z0 - 12.0, 37.0, 32.0, z0 + CASTLE_STONE_H)
    z = z0 + CASTLE_STONE_H
    scale = CASTLE_TOWER_H / sum(t[2] + t[4] for t in TIERS)
    for k, (w, d, wh, ov, rise) in enumerate(TIERS):
        wh, rise = wh * scale, rise * scale
        top_tier = k == len(TIERS) - 1
        loft(black if top_tier else wall, P, w, d, z, w, d, z + wh, top=False)
        ew, ed = w + 2 * ov, d + 2 * ov
        z_eave = z + wh
        if top_tier:
            loft(roof, P, ew, ed, z_eave, max(ew - ed + 1.2, 1.2), 1.2, z_eave + rise)
            ring_trim(gold, P, ew, ed, z_eave, 0.5, 0.5)
            ring_trim(gold, P, w + 1.6, d + 1.6, z + 0.4, 0.4, 0.9)          # the gilded balcony rail
            # shachihoko at both ends of the ridge
            half = max(ew - ed + 1.2, 1.2) / 2
            for sgn in (-1, 1):
                Pu = lambda u, v, zz, sgn=sgn: P(u + sgn * half, v, zz)
                loft(gold, Pu, 1.0, 0.9, z_eave + rise, 0.5, 0.4, z_eave + rise + CASTLE_TOP_H - CASTLE_STONE_H - CASTLE_TOWER_H + 2.0)
        else:
            nw, nd = TIERS[k + 1][0], TIERS[k + 1][1]
            loft(roof, P, ew, ed, z_eave, nw, nd, z_eave + rise)
            ring_trim(gold, P, ew, ed, z_eave, 0.5, 0.5)
            if k < 3:                                                      # chidori-hafu gables on the four faces
                gw = 0.34 * ew
                for sgn in (-1, 1):
                    prism(wall, P, -gw / 2, gw / 2, sgn * (ed / 2 - 0.2), sgn * (ed / 2 - 3.0), z_eave + 0.1, z_eave + rise * 0.95)
                    prism(gold, P, -gw / 2 - 0.3, gw / 2 + 0.3, sgn * (ed / 2 + 0.1), sgn * (ed / 2 - 0.3), z_eave + 0.05, z_eave + rise * 0.95 + 0.4)
        z = z_eave + (0 if top_tier else rise)
    # shachi at the corners of the third roof, as on the real tower, are left out: too small to read
    return [stone, wall, roof, gold, black]


# ---------------------------------------------------------------- Tsutenkaku

def tsutenkaku(t):
    P = frame(t["centroid"][0], t["centroid"][1], math.radians(t["axis_deg"]))
    z0 = t["ground_m"]
    steel, glass, neon = Mesh("tsuten_steel", "steel", False), Mesh("tsuten_glass", "glass", False), Mesh("tsuten_neon", "neon", False, floodlit=True)
    base = 12.0
    w0 = min(t["width_m"], t["depth_m"]) - 3.0
    # frames: (height above the ground, half width): legs splay from the base, narrow to the deck
    prof = [(base, w0 / 2), (30.0, w0 / 2 - 3.5), (48.0, w0 / 2 - 6.0), (66.0, 5.6), (80.0, 3.4)]
    corners = lambda h, z: [P(sx * h, sy * h, z0 + z) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for (za, ha), (zb, hb) in zip(prof[:-1], prof[1:]):
        ca, cb = corners(ha, za), corners(hb, zb)
        for k in range(4):
            steel.box(ca[k], cb[k], 1.4, 1.4)                              # legs
            j = (k + 1) % 4
            steel.box(ca[k], ca[j], 0.6, 0.6)                              # ring beam
            steel.box(ca[k], cb[j], 0.45, 0.45)                            # X bracing
            steel.box(ca[j], cb[k], 0.45, 0.45)
    ctop = corners(prof[-1][1], prof[-1][0])
    for k in range(4):
        steel.box(ctop[k], ctop[(k + 1) % 4], 0.6, 0.6)
    # the gold observatory (fifth floor, 87.5 m) and the open deck (94.5 m)
    loft(glass, P, 14.0, 14.0, z0 + 82.0, 14.0, 14.0, z0 + 92.0)
    loft(steel, P, 15.2, 15.2, z0 + 92.0, 15.2, 15.2, z0 + 94.5)
    ring_trim(steel, P, 15.2, 15.2, z0 + 94.5, 0.3, 1.1)                  # parapet of the open deck
    loft(steel, P, 14.6, 14.6, z0 + 81.4, 14.6, 14.6, z0 + 82.0, bottom=True)
    # mast with the neon sign ring, to 103 m, then the lightning rod to 108 m
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        steel.box(P(sx * 1.8, sy * 1.8, z0 + 94.5), P(sx * 0.9, sy * 0.9, z0 + 103.0), 0.6, 0.6)
    steel.box(P(0, 0, z0 + 103.0), P(0, 0, z0 + 108.0), 0.35, 0.35)
    for sx, sy, ang in ((0, -1, 0), (0, 1, 0), (-1, 0, 1), (1, 0, 1)):
        a = P(sx * 2.0 - (0 if ang else 3.0), sy * 2.0 - (3.0 if ang else 0), z0 + 97.0)
        b = P(sx * 2.0 + (0 if ang else 3.0), sy * 2.0 + (3.0 if ang else 0), z0 + 97.0)
        neon.box(a, b, 0.4, 3.6)
    return [steel, glass, neon]


# ---------------------------------------------------------------- HEP FIVE wheel

def hep_wheel(h):
    ang = math.radians(h["axis_deg"])
    P = frame(h["centroid"][0], h["centroid"][1], ang)
    zc = h["ground_m"] + 31.0 + 37.5                                      # lowest point at the seventh floor
    red = Mesh("hep_wheel", "wheel_red", False)
    R, n = 37.5, 40
    pt = lambda r, k, v=0.0: P(r * math.cos(2 * math.pi * k / n), v, zc + r * math.sin(2 * math.pi * k / n))
    for k in range(n):
        for v in (-1.2, 1.2):
            red.box(pt(R, k, v), pt(R, k + 1, v), 0.5, 0.5)               # two rims
        red.box(pt(R, k, -1.2), pt(R, k, 1.2), 0.3, 0.3)
        if k % 2 == 0:
            for v in (-1.0, 1.0):
                red.box(P(0, v, zc), pt(R, k, v), 0.25, 0.25)             # spokes
        if k % 2 == 1:
            a = pt(R + 0.4, k)
            cuboid(red, a, 2.0, 2.0, 2.2)                                  # a gondola, hanging level
    for s in (-1, 1):                                                      # the A-frame down to the roof
        red.box(P(0, s * 1.6, zc), P(s * 9.0, s * 1.6, zc - 31.0 - 2.0), 1.0, 1.0)
    return [red]


# ---------------------------------------------------------------- Glico sign and Kani Doraku

def glico_sign(g):
    # a panel standing on the roof, its face towards the canal
    # frame: u along the facade, v outward along the normal
    n = np.array(g["normal"], float)
    t = np.array([n[1], -n[0]])
    Q = lambda u, v, z: np.array([g["at"][0] + t[0] * u + n[0] * v, g["at"][1] + t[1] * u + n[1] * v, z])
    z0 = g["ground_m"] + g["roof_m"]
    W, H = min(21.0, max(g["len"] - 1.0, 8.0)), 24.0
    blue, white, red, gold = (Mesh("glico_panel", "glico_blue", False, floodlit=True), Mesh("glico_white", "glico_white", False, floodlit=True),
                              Mesh("glico_red", "glico_red", False, floodlit=True), Mesh("glico_gold", "glico_gold", False, floodlit=True))
    loft(blue, lambda u, v, z: Q(u, v, z), W, 0.8, z0, W, 0.8, z0 + H, True)
    # a track and a low sun
    loft(gold, lambda u, v, z: Q(u, v, z), W - 0.6, 0.2, z0 + 0.4, W - 0.6, 0.2, z0 + 2.2)
    base = z0 + 2.2
    fig = lambda a, b, w: white.box(Q(a[0], 0.6, base + a[1]), Q(b[0], 0.6, base + b[1]), w, 0.5)
    fig((0, 11.5), (-0.6, 17.0), 1.8)                                      # torso
    fig((-0.6, 17.0), (-4.6, 21.0), 1.0)                                   # arms up
    fig((-0.6, 17.0), (3.8, 21.2), 1.0)
    fig((0, 11.5), (4.0, 7.2), 1.2)                                        # stride
    fig((4.0, 7.2), (3.6, 2.6), 1.1)
    fig((0, 11.5), (-3.6, 7.8), 1.2)
    fig((-3.6, 7.8), (-6.4, 4.4), 1.1)
    for (a, b, w) in (((-0.5, 12.0), (-0.5, 11.0), 3.0),):
        red.box(Q(a[0], 0.65, base + a[1]), Q(b[0], 0.65, base + b[1]), w, 0.5)   # shorts
    s = 1.55
    for k in range(10):                                                    # head
        a0, a1 = 2 * math.pi * k / 10, 2 * math.pi * (k + 1) / 10
        white.tri(Q(-0.8, 0.62, base + 18.8), Q(-0.8 + s * math.cos(a0), 0.62, base + 18.8 + s * math.sin(a0)),
                  Q(-0.8 + s * math.cos(a1), 0.62, base + 18.8 + s * math.sin(a1)))
    return [blue, white, red, gold]


def kani_crab(k):
    n = np.array(k["normal"], float)
    t = np.array([n[1], -n[0]])
    Q = lambda u, v, z: np.array([k["at"][0] + t[0] * u + n[0] * v, k["at"][1] + t[1] * u + n[1] * v, z])
    z = k["ground_m"] + min(k["height_m"] * 0.62, 16.0)
    crab = Mesh("kani_crab", "crab", False, floodlit=True)
    loft(crab, lambda u, v, zz: Q(u, v, zz), 4.6, 2.2, z, 3.4, 1.8, z + 1.5, True)   # shell
    for s in (-1, 1):
        for i in range(4):                                                 # legs, four a side
            crab.box(Q(s * 2.0, 0.6, z + 0.6), Q(s * (3.6 + i * 0.5), 1.3 + i * 0.15, z + 1.0 + 0.2 * i), 0.35, 0.35)
            crab.box(Q(s * (3.6 + i * 0.5), 1.3 + i * 0.15, z + 1.0 + 0.2 * i), Q(s * (4.4 + i * 0.7), 1.0 + i * 0.3, z - 1.4 + 0.4 * i), 0.3, 0.3)
        crab.box(Q(s * 1.8, 1.0, z + 1.1), Q(s * 3.4, 1.6, z + 3.6), 0.7, 0.7)       # arm
        loft(crab, lambda u, v, zz: Q(u + s * 3.2, v + 1.7, zz), 1.9, 0.8, z + 3.4, 1.0, 0.5, z + 5.2, True)   # claw
    return [crab]


# ---------------------------------------------------------------- shop signs

def shop_signs(sites):
    """Blade signs, awning banners and upper-wall boards on street facades, in six colours."""
    rng = np.random.default_rng(2025)
    meshes = {m: Mesh("signs_" + m, m, False, floodlit=True) for m in dict.fromkeys(SIGN_MATS)}
    for x, y, nx, ny, g, top, L in sites:
        n = np.array([nx, ny])
        t = np.array([ny, -nx])
        at = np.array([x, y])
        Q = lambda u, v, z: np.array([at[0] + t[0] * u + n[0] * v, at[1] + t[1] * u + n[1] * v, z])
        z0 = g
        kinds = [("banner", 3.4 + rng.random() * 0.8)]
        if top > 12:
            kinds.append(("blade", 5.0 + rng.random() * 6.0))
        if top > 20 and rng.random() < 0.7:
            kinds.append(("board", top * (0.45 + 0.3 * rng.random())))
        for kind, z in kinds:
            mat = SIGN_MATS[int(rng.integers(len(SIGN_MATS)))]
            m = meshes[mat]
            if kind == "banner":
                w = min(max(L * 0.7, 3.0), 9.0)
                u0 = (rng.random() - 0.5) * max(L - w, 0.0)
                loft(m, lambda u, v, zz: Q(u0 + u, v, zz), w, 0.5, z0 + z, w, 0.5, z0 + z + 1.5 + rng.random())
            elif kind == "blade":
                u0 = (rng.random() - 0.5) * max(L - 2.0, 0.0)
                h = 3.0 + rng.random() * 3.0
                loft(m, lambda u, v, zz: Q(u0 + u, v + 0.9, zz), 0.35, 1.6, z0 + z, 0.35, 1.6, z0 + z + h)
            else:
                w = min(L * 0.55, 10.0)
                h = 3.0 + rng.random() * 4.0
                u0 = (rng.random() - 0.5) * max(L - w - 1.0, 0.0)
                zz0 = min(z0 + z, z0 + top - h - 1.0)
                loft(m, lambda u, v, zzz: Q(u0 + u, v + 0.15, zzz), w, 0.3, zz0, w, 0.3, zz0 + h)
    return [m for m in meshes.values() if m.v]
