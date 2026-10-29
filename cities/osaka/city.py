"""Osaka: what the generic pipeline cannot know from open data.

Building adjustments (called by pipeline/build_scene.py):
  * Osaka Castle keep: OpenStreetMap maps it as four stacked blocks (31 m). It becomes solids for
    the stone base and each tier, which the parametric keep draws instead (hidden solids: they
    stay in the sun analyses and the collisions). The ground is the honmaru, levelled in
    city.json (terrain.level) where GSI's 5 m DEM interpolates a false terrace round the keep.
  * The small keep platform (小天守台) and the Kinmeisui well house (金明水井戸屋形) on it:
    PLATEAU's 2017 survey drew one outline round them and the keep, so both took the keep's
    54.6 m and stood as a white tower beside it. They are drawn as a 6.0 m stone platform and a
    4.7 m well house, the heights PLATEAU's 2025 model gives them.
  * Tsutenkaku: the OSM footprint is a 108 m box. The footprint stays as a 12 m base and the
    steel tower is parametric above it.
  * HEP FIVE: PLATEAU's 107 m is the top of the Ferris wheel, not the building. The building
    is drawn at 47 m (an estimate) and the wheel is parametric.
  * The Glico sign and the Kani Doraku crab are placed on the buildings nearest their published
    positions, facing the Dotonbori canal.

Parametric landmarks (pipeline/landmarks.py), with anchors measured from the data:
  Osaka Castle keep   stone base 13.3 m, tower 39.4 m above it (total 52.7 m, 54.8 m with the
                      golden shachi), five roofs outside, eight floors inside (Osaka Prefecture,
                      "大阪城天守閣の詳細説明"; Bunshun for 54.8 m). The plan of each tier, the
                      levels of its eaves and the gables on each face are measured from PLATEAU's
                      LOD2 model of the keep (Osaka City 2025 release, 27100-bldg-328870) and
                      scaled to the published heights. White plaster on the first four tiers, the
                      top tier black with gold tigers, copper roofs formed as tiles, gilded gable
                      fittings (the fact sheet); windows, brackets and ornaments are indicative.
  Tsutenkaku          103 m (108 m with the lightning rod), 1956, steel (Naito Tachu, Takenaka);
                      observatories at 84 m and 87.5 m (the gold one), the open deck at 94.5 m
                      with its round gallery 8.5 m across, the third-floor deck at 22 m over the
                      legs (Osaka City planning leaflet; MLIT's multilingual guide; gltjp). The
                      legs, lattice, ceiling painting, sign boards and jutting deck are schematic.
  Glico sign          the Dotonbori running man: a panel about 21 m wide with a simplified
                      runner, at the position published for it. Size and figure are indicative.
  Kani Doraku crab    the moving crab on the Dotonbori front, about 8 m across.
  HEP FIVE wheel      75 m diameter, top at 106 m above the street, lowest point at the seventh
                      floor (about 31 m).
"""
import math

import numpy as np
import shapely
from shapely.geometry import Point, Polygon

from meshkit import Mesh

TSUTENKAKU = "通天閣"
CASTLE = "大阪城"
CASTLE_PL, WELL = "大阪城天守閣", "金明水井戸屋形"     # PLATEAU's record of the keep; the well house
KOTENSHU_H, WELL_H = 6.0, 4.7     # the small keep platform and the well house on it (PLATEAU 2025: the
                                  # well house, 27100-bldg-951272, 4.7 m on ground 6.0 m above the keep's)
HEP5 = "HEP FIVE"
KANI = "かに道楽"
GLICO_LONLAT = (135.50134, 34.66885)   # Glico sign, Dotonbori (Wikipedia coordinates)
CASTLE_STONE_H, CASTLE_TOWER_H, CASTLE_TOP_H = 13.3, 39.4, 54.8
BRICK_HALL, CITY_HALL = "大阪市中央公会堂", "大阪市役所"
HEP5_BUILDING_H = 47.0

MATERIALS = {
    # the castle: dressed granite in courses, copper formed as round tiles (verdigris), white
    # plaster, gold leaf, black lacquer; the well house's grey tiles and timber
    "granite": {"color": "#8d8a81", "roughness": 0.92, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.75, "block_m": 1.5},
    "plaster": {"color": "#ebe8df", "roughness": 0.8, "metalness": 0.0, "emissive": "#fff3e2", "glow": 0.42},
    "copper_roof": {"color": "#4f8b78", "roughness": 0.55, "metalness": 0.3, "pattern": "roof_tiles", "bay_m": 0.33, "course_m": 0.32,
                    "emissive": "#5f9e8a", "glow": 0.32},
    "ridge_copper": {"color": "#3c6b5c", "roughness": 0.55, "metalness": 0.3, "emissive": "#4d8574", "glow": 0.32},
    "gold": {"color": "#d6a931", "roughness": 0.32, "metalness": 0.85, "emissive": "#ffc94a", "glow": 0.55},
    "black_wall": {"color": "#24201e", "roughness": 0.6, "metalness": 0.1, "emissive": "#2b2420", "glow": 0.3},
    "window": {"color": "#2d2f30", "roughness": 0.45, "metalness": 0.2},
    "window_bar": {"color": "#8e938f", "roughness": 0.6, "metalness": 0.2},
    "paving": {"color": "#c6bda9", "roughness": 0.92, "metalness": 0.0},
    "kawara": {"color": "#6b7073", "roughness": 0.6, "metalness": 0.1, "pattern": "roof_tiles", "bay_m": 0.28, "course_m": 0.28},
    "kawara_ridge": {"color": "#4e5356", "roughness": 0.6, "metalness": 0.1},
    "timber": {"color": "#4a3b2d", "roughness": 0.8, "metalness": 0.0},
    "steel": {"color": "#a9b1b6", "roughness": 0.5, "metalness": 0.45},
    "steel_white": {"color": "#dfe1df", "roughness": 0.55, "metalness": 0.2},
    "glass": {"color": "#31475a", "roughness": 0.1, "metalness": 0.5},
    "glass_gold": {"color": "#b8913c", "roughness": 0.2, "metalness": 0.75, "emissive": "#ffc860", "glow": 0.9},
    "ceiling_paint": {"color": "#b5543a", "roughness": 0.7, "metalness": 0.0, "emissive": "#ff9a50", "glow": 0.7},
    "sign_board": {"color": "#e9edf2", "roughness": 0.5, "metalness": 0.0, "emissive": "#9fc4ff", "glow": 1.1},
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
        # the keep: OSM's stepped blocks give the centre and the axis, the honmaru the ground
        c, ang, long_, short_ = rect_of(g)
        z0 = ctx.ground(*c)
        lm["castle"] = {"centroid": [round(c[0], 1), round(c[1], 1)], "axis_deg": round(math.degrees(ang), 2), "ground_m": round(z0, 1),
                        "osm_long_m": round(long_, 1), "osm_short_m": round(short_, 1)}
        # solids for the sun analyses and the collisions, which the parametric keep draws instead:
        # the stone base, then each tier out to its eaves and the top roof
        P = frame(c[0], c[1], ang - math.pi / 2)
        block = lambda hu, hv: Polygon([tuple(P(sx * hu, sy * hv, 0)[:2]) for sx, sy in CORNERS])
        out, z = [[block(*KEEP_STONE[1]), 0.0, CASTLE_STONE_H, "parametric", None]], CASTLE_STONE_H
        for _, eave, _, _, top in KEEP_TIERS:
            out.append([block(*eave), z, keep_level(top), "parametric", None])
            z = keep_level(top)
        mid = (z + CASTLE_STONE_H + CASTLE_TOWER_H) / 2
        out += [[block(KEEP_TOP[0], KEEP_TOP[1]), z, mid, "parametric", None], [block(2.0, KEEP_TOP[1]), mid, CASTLE_STONE_H + CASTLE_TOWER_H, "parametric", None]]
        for s_ in out:
            ctx.hide(s_)
        return out
    if name != CASTLE and geoms:
        f, keep = keep_record(ctx)
        if keep is not None and g.intersection(keep).area > 0.5 * g.area and max(s_[2] for s_ in geoms) > 0.8 * f["h"]:
            # under PLATEAU's outline of the keep, with its height: the small keep platform or the well house
            c, ang, long_, short_ = rect_of(g)
            if name == WELL:
                lm["well_house"] = {"centroid": [round(c[0], 1), round(c[1], 1)], "axis_deg": round(math.degrees(ang), 2), "long_m": round(long_, 1),
                                    "short_m": round(short_, 1), "ground_m": round(ctx.ground(*c), 1), "base_m": KOTENSHU_H, "height_m": WELL_H}
                out = [[p, KOTENSHU_H, KOTENSHU_H + WELL_H, "parametric", None] for p in ctx.polygons(g)]
            else:
                q = shapely.geometry.polygon.orient(g.simplify(0.3), 1.0)
                lm.setdefault("kotenshu", {"ring": [[round(x, 1), round(y, 1)] for x, y in q.exterior.coords[:-1]],
                                           "ground_m": round(ctx.ground(*c), 1), "height_m": KOTENSHU_H})
                out = [[p, 0.0, KOTENSHU_H, "parametric", None] for p in ctx.polygons(g)]
            for s_ in out:
                ctx.hide(s_)
            return out
    if name == TSUTENKAKU:
        c, ang, long_, short_ = rect_of(g)
        lm["tsutenkaku"] = {"centroid": [round(c[0], 1), round(c[1], 1)], "axis_deg": round(math.degrees(ang), 2),
                            "width_m": round(long_, 1), "depth_m": round(short_, 1), "ground_m": round(ctx.ground(*c), 1)}
        out = tsutenkaku_solids(frame(c[0], c[1], ang), min(long_, short_) / 2 - 0.5)
        for s_ in out:
            ctx.hide(s_)
        return out
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
    if "kotenshu" in lm or "well_house" in lm:
        M = {k: Mesh("kotenshu_" + k, m, False, uv=m in ("granite", "kawara")) for k, m in
             (("stone", "granite"), ("paving", "paving"), ("wall", "plaster"), ("timber", "timber"), ("kawara", "kawara"), ("kawara_ridge", "kawara_ridge"))}
        if "kotenshu" in lm:
            kotenshu(M, lm["kotenshu"])
        if "well_house" in lm:
            well_house(M, lm["well_house"])
        meshes += [m for m in M.values() if m.v]
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

# The keep as PLATEAU's LOD2 model measures it (Osaka City 2025 release, building
# 27100-bldg-328870): half-widths across the keep (u, to the east) and along it (v, to the north)
# in metres, and levels above its ground (30.9 m T.P.), which keep_level() scales to the
# published heights. The stone base: foot, top, height.
KEEP_STONE = ((19.85, 22.04), (16.85, 18.88), 13.15)
# each tier: its wall, its eaves, the level its wall rises from (the stone, or the roof below),
# the soffit under its eaves and the top of the tiles at the eaves
KEEP_TIERS = [((16.87, 18.88), (18.87, 20.88), 13.15, 18.25, 19.15),
              ((14.37, 16.59), (16.37, 18.60), 21.23, 24.57, 25.47),
              ((11.52, 14.04), (13.52, 16.03), 27.34, 31.17, 31.97),
              ((8.82, 8.79), (10.81, 10.79), 34.46, 37.04, 37.74),
              ((7.30, 7.43), (9.30, 9.43), 39.43, 45.21, 45.81)]
# the top roof, hip-and-gable with its gables to the north and south: half-width and distance
# out of the gables, the level of their base, the ridge
KEEP_TOP = (7.03, 5.77, 47.06, 53.21)
# the gables (破風) on the roofs: the faces they look out of ("ns" north and south, "ew" east and
# west), their distance out from the centre, centre along the face, half-width, base, apex, and
# how far back their own roofs run (to the wall behind, or to the edge of the top floor's balcony)
KEEP_GABLES = [("ns", 19.40, 0.0, 17.15, 19.71, 30.40, 5.4),      # the great gables of the first roof
               ("ew", 17.25, 10.45, 6.74, 19.83, 24.53, 3.4),     # a pair on each side of the first roof
               ("ew", 17.25, -10.45, 6.74, 19.83, 24.53, 3.4),
               ("ew", 14.90, 0.0, 11.50, 26.15, 34.07, 5.9),      # second roof
               ("ns", 14.04, 0.0, 12.30, 32.41, 40.81, 5.5),      # third roof
               ("ew", 9.30, 0.0, 6.10, 38.50, 41.99, 0.85)]       # fourth roof
BALCONY = (1.1, 41.4)   # the top floor's balcony (廻縁): its reach, and its deck on the scale of the levels above (our
                        # choice, just over the ridges of the gables below it)
CORNERS = ((1, -1), (1, 1), (-1, 1), (-1, -1))   # anticlockwise from the south-east, so face k is east, north, west, south
SIDES = {"e": (1, 0), "n": (0, 1), "w": (-1, 0), "s": (0, -1)}
# a crouching tiger (伏虎) in profile, facing +a: metres, length 1, from the forepaws
TIGER = [(0.5, 0.0), (0.5, 0.05), (0.34, 0.07), (0.3, 0.16), (0.4, 0.2), (0.52, 0.27), (0.5, 0.33), (0.42, 0.38), (0.38, 0.45),
         (0.34, 0.39), (0.28, 0.36), (0.15, 0.33), (-0.05, 0.36), (-0.25, 0.33), (-0.38, 0.28), (-0.44, 0.3), (-0.55, 0.4),
         (-0.6, 0.52), (-0.66, 0.5), (-0.6, 0.38), (-0.5, 0.24), (-0.45, 0.12), (-0.48, 0.0), (-0.3, 0.0), (-0.28, 0.08),
         (-0.1, 0.1), (0.1, 0.1), (0.18, 0.03), (0.22, 0.0)]


def keep_level(h):
    """A level of PLATEAU's model of the keep above its ground -> the model's: the stone base and
    the tower above it each scaled to the published heights (13.3 m and 39.4 m)."""
    s0, ridge = KEEP_STONE[2], KEEP_TOP[3]
    return h * CASTLE_STONE_H / s0 if h <= s0 else CASTLE_STONE_H + (h - s0) * CASTLE_TOWER_H / (ridge - s0)


def keep_record(ctx):
    """PLATEAU's record of the keep and its outline in the local frame. The 2017 survey drew one
    outline round the keep and the small keep platform south of it."""
    if not hasattr(ctx, "osaka_keep"):
        f = ctx.plateau.named(CASTLE_PL)
        ctx.osaka_keep = (f, ctx.city.to_local(Polygon(f["rings"][0])) if f else None)
    return ctx.osaka_keep


def side_frame(P, side, d0):
    """(a, d, z) -> local point on a face of a frame P: the face d0 out from the centre on `side`,
    a along it (to the right, seen from outside), d further out."""
    nu, nv = SIDES[side]
    return lambda a, d, z: P(nu * (d0 + d) + nv * a, nv * (d0 + d) - nu * a, z)


def along(side, c):
    """Where a point c along the u (or v) axis falls along a face, in that face's a."""
    nu, nv = SIDES[side]
    return nv * c if nu == 0 else -nu * c


def qbox(mesh, Q, a0, a1, d0, d1, z0, z1):
    """A box in a face frame."""
    c = [Q(a, d, z) for z in (z0, z1) for d in (d0, d1) for a in (a0, a1)]
    for i, j, k, l in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        mesh.quad(c[i], c[j], c[k], c[l])


def triangles(poly):
    """A polygon's triangles (constrained where shapely has it, else Delaunay inside the outline)."""
    if hasattr(shapely, "constrained_delaunay_triangles"):
        return list(shapely.constrained_delaunay_triangles(poly).geoms)
    return [t for t in shapely.delaunay_triangles(poly).geoms if poly.contains(t.centroid)]


def plate(mesh, Q, pts, d, depth=0.12):
    """A flat shape [(a, z)] standing `depth` proud of a face at d (an ornament, a relief)."""
    poly = Polygon(pts)
    for t in triangles(poly):
        mesh.tri(*[Q(a, d + depth, z) for a, z in t.exterior.coords[:3]])
    cs = list(poly.exterior.coords)
    for (a0, z0), (a1, z1) in zip(cs, cs[1:]):
        mesh.quad(Q(a0, d, z0), Q(a1, d, z1), Q(a1, d + depth, z1), Q(a0, d + depth, z0))


def skirt(M, P, eave, top, z_eave, z_top, soffit, wall, lift=0.9, reach=7.0):
    """A hipped roof skirt from its eaves (half-widths `eave`, tiles at z_eave) up to the wall or
    gables of the tier above (`top`, at z_top): tiled faces that sag between (teri) and turn up
    at the corners (sori), hip ridges with gilded end tiles, gilded tile ends along the eaves,
    the fascia, and the plastered soffit back to this tier's wall (at `soffit`)."""
    E, T, W = ([np.array((h[0] * sx, h[1] * sy)) for sx, sy in CORNERS] for h in (eave, top, wall))
    ts = (0.0, 0.07, 0.18, 0.33, 0.52, 0.75, 1.0)
    drop = np.array((0.0, 0.0, z_eave - soffit))
    for k in range(4):
        j = (k + 1) % 4
        L = float(np.linalg.norm(E[j] - E[k]))
        along_, out = (E[j] - E[k]) / L, np.array(((E[j] - E[k])[1], -(E[j] - E[k])[0])) / L
        mid = (E[j] + E[k]) / 2
        ms = [m for m in (0.0, 0.4, 1.0, 1.8, 2.9, 4.3, 6.0, 8.0) if m < L / 2 - 1.0]
        ms += list(np.arange(ms[-1] + 2.5, L / 2 - 1.0, 2.5))
        ss = sorted({m / L for m in ms} | {1 - m / L for m in ms} | {0.5})
        up = [lift * max(0.0, 1 - min(s, 1 - s) * L / reach) ** 2 for s in ss]
        rows, uvs = [], []
        for t in ts:
            xy = [(1 - t) * (E[k] + (E[j] - E[k]) * s) + t * (T[k] + (T[j] - T[k]) * s) for s in ss]
            rows.append([P(q[0], q[1], z_eave + (z_top - z_eave) * t ** 1.4 + u_ * (1 - t) ** 2) for q, u_ in zip(xy, up)])
            uvs.append([[float(np.dot(q - mid, along_)), 0.0] for q in xy])
        for r in range(1, len(ts)):       # v: metres up the slope
            for c in range(len(ss)):
                uvs[r][c][1] = uvs[r - 1][c][1] + float(np.linalg.norm(rows[r][c] - rows[r - 1][c]))
        M["roof"].grid(rows, uvs)
        eaves = rows[0]
        off = P(out[0] * 0.05, out[1] * 0.05, 0) - P(0, 0, 0)
        M["wall"].grid([[p - drop for p in eaves], eaves])                                            # fascia
        M["gold"].grid([[p + off - (0, 0, 0.3) for p in eaves], [p + off + (0, 0, 0.03) for p in eaves]])  # gilded tile ends
        wl = [P(*(W[k] + (W[j] - W[k]) * s), soffit) for s in ss]
        M["soffit"].grid([wl, [p - drop for p in eaves]])
        hip = [r_[0] + (0, 0, 0.22) for r_ in rows]
        for a, b in zip(hip, hip[1:]):
            M["ridge"].box(a, b, 0.5, 0.42)
        d = (hip[1] - hip[0]) / np.linalg.norm(hip[1] - hip[0])
        M["gold"].box(hip[0] - d * 0.4, hip[0] + d * 0.5, 0.64, 0.85)


def gable(M, Q, hw, zb, za, depth, ov=0.9, windows=0, k=1.0):
    """A gable (破風) standing on a roof, its face at d = 0: a plastered triangle with gilded
    fittings (飾金具) and a hanging ornament (懸魚), under two tiled slopes and a ridge that run
    `depth` back into the roof behind. k scales the timbers and ornaments (1 for the keep).
    Returns the ridge's front end and level."""
    sl, rt, e = (za - zb) / hw, 0.35 * k, 0.7 * k      # slope; the tiles stand on the bargeboards; the eaves reach past the corners
    M["wall"].tri(Q(-hw, 0, zb), Q(hw, 0, zb), Q(0, 0, za))
    qbox(M["wall"], Q, -hw, hw, -0.3 * k, 0.12 * k, zb - 0.8 * k, zb + 0.05)               # the beam under it
    qbox(M["gold"], Q, -hw, hw, 0.12 * k, 0.16 * k, zb - 0.25 * k, zb - 0.05 * k)
    dg = ov * 0.8
    for sg in (-1, 1):
        rows, uvs = [], []
        for i in range(6):
            f = i / 5
            z = za + rt - f * (hw + e) * sl - 0.22 * k * math.sin(math.pi * f)
            rows.append([Q(sg * f * (hw + e), d, z) for d in (ov, -depth)])
            uvs.append([[ov, f * (hw + e) * math.hypot(1, sl)], [-depth, f * (hw + e) * math.hypot(1, sl)]])
        M["roof"].grid(rows, uvs)
        end = [Q(sg * (hw + e), d, za + rt - (hw + e) * sl) for d in (ov, -depth)]
        M["wall"].quad(end[0], end[1], end[1] - (0, 0, 0.45 * k), end[0] - (0, 0, 0.45 * k))   # the slope's fascia
        # bargeboard (破風板), plastered, with a gilded band
        M["wall"].box(Q(sg * (hw + e), dg, zb - e * sl + 0.15 * k), Q(0, dg, za + 0.15 * k), 0.32 * k, 0.85 * k)
        M["gold"].box(Q(sg * (hw + e), dg + 0.17 * k, zb - e * sl + 0.15 * k), Q(0, dg + 0.17 * k, za + 0.15 * k), 0.04, 0.36 * k)
    # the hanging ornament under the apex, with its fins
    s = max(0.5, 0.07 * hw) * k
    zc = za - 0.45 * k - s
    M["gold"].quad(Q(0, dg + 0.2 * k, zc + s), Q(-0.8 * s, dg + 0.2 * k, zc), Q(0, dg + 0.2 * k, zc - 1.3 * s), Q(0.8 * s, dg + 0.2 * k, zc))
    for sg in (-1, 1):
        M["gold"].tri(Q(sg * 0.6 * s, dg + 0.19 * k, zc + 0.3 * s), Q(sg * 2.2 * s, dg + 0.19 * k, zc + 0.45 * s), Q(sg * 0.7 * s, dg + 0.19 * k, zc - 0.25 * s))
    for i in range(windows):          # a row of windows in a large gable
        window(M, Q, (i - (windows - 1) / 2) * 2.6, zb + 0.7, 1.4, 1.3, 3)
    zr = za + rt + 0.25 * k
    M["ridge"].box(Q(0, ov + 0.3 * k, zr), Q(0, -depth, zr), 0.55 * k, 0.55 * k)
    qbox(M["gold"], Q, -0.55 * k, 0.55 * k, ov + 0.3 * k, ov + 0.5 * k, zr - 0.5 * k, zr + 0.7 * k)   # the gilded ridge-end plate (鬼板)
    return ov + 0.3 * k, zr


def window(M, Q, a, z, w, h, bars=4):
    """A dark window, a little proud of the wall, with its bars."""
    qbox(M["window"], Q, a - w / 2, a + w / 2, -0.05, 0.1, z, z + h)
    for i in range(1, bars + 1):
        x = a - w / 2 + w * i / (bars + 1)
        qbox(M["bars"], Q, x - 0.05, x + 0.05, 0.1, 0.15, z, z + h)


def covered(side, d0, a, w, z, h, gables):
    """Whether a window on a wall d0 out on `side` would be inside a gable (behind its face and
    under its slopes): the gable hides it."""
    for sides, dg, c, hw, zb, za, depth in gables:
        if side not in sides or not dg - depth - 0.6 <= d0 <= dg + 0.1:
            continue
        ac = along(side, c)
        an = min(max(ac, a - w / 2), a + w / 2)
        if abs(an - ac) < hw and z + h > zb - 0.3 and z < zb + (za - zb) * (1 - abs(an - ac) / hw):
            return True
    return False


def wall_windows(M, P, wall, z, h, gables, every=3.6, w=1.5, bars=4, sides="enws"):
    for side in sides:
        nu, _ = SIDES[side]
        d0, half = (wall[0], wall[1]) if nu else (wall[1], wall[0])
        Q = side_frame(P, side, d0)
        n = int((2 * half - 2.4) // every) + 1
        for i in range(n):
            a = (i - (n - 1) / 2) * every
            if not covered(side, d0, a, w, z, h, gables):
                window(M, Q, a, z, w, h, bars)


def bell_window(M, Q, a, z, w, h):
    """A bell-shaped window (花頭窓) in a gilded frame."""
    pts = [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, h * 0.62)] + \
          [(w / 2 * math.cos(t) * (1 + 0.18 * math.sin(3 * t)), h * 0.62 + h * 0.38 * math.sin(t)) for t in np.linspace(0.15, math.pi - 0.15, 9)] + \
          [(-w / 2, h * 0.62)]
    plate(M["gold"], lambda x, d, zz: Q(a + x * 1.12, d, z - 0.08 + (zz - h * 0.5) * 1.1 + h * 0.5), pts, 0.0, 0.08)
    plate(M["window"], lambda x, d, zz: Q(a + x, d, z + zz), pts, 0.08, 0.06)


def shachi(mesh, Q, d, z, size=1.8):
    """A gilded shachihoko on the end of a ridge: head down and facing along it, tail up."""
    path = [(0.72, 0.08), (0.6, 0.2), (0.3, 0.42), (0.1, 0.78), (0.14, 1.12), (0.0, 1.45), (-0.12, 1.62)]
    radii = [0.05, 0.24, 0.36, 0.34, 0.26, 0.15, 0.07]
    mesh.tube([Q(0, d - p * size, z + q * size) for p, q in path], [r * size for r in radii], 8)
    tip = Q(0, d + 0.12 * size, z + 1.6 * size)
    mesh.tri(tip, Q(0, d + 0.55 * size, z + 2.0 * size), Q(0, d + 0.12 * size, z + 1.78 * size))     # the tail's two lobes
    mesh.tri(tip, Q(0, d - 0.3 * size, z + 2.0 * size), Q(0, d - 0.02 * size, z + 1.78 * size))
    for sg in (-1, 1):                                                                                   # fins
        mesh.tri(Q(sg * 0.15 * size, d - 0.3 * size, z + 0.5 * size), Q(sg * 0.6 * size, d - 0.05 * size, z + 0.55 * size),
                 Q(sg * 0.15 * size, d - 0.1 * size, z + 0.75 * size))
        mesh.tri(Q(sg * 0.12 * size, d - 0.05 * size, z + 1.05 * size), Q(sg * 0.42 * size, d + 0.15 * size, z + 1.0 * size),
                 Q(sg * 0.12 * size, d + 0.05 * size, z + 1.25 * size))


def stone_base(mesh, P, z0, foot, top, h, below=8.0):
    """Dressed granite in a batter that steepens towards the top (扇の勾配), carried `below` under
    the ground so it never floats on a slope."""
    rings = [(foot, z0 - below)] + [((top[0] + (foot[0] - top[0]) * (1 - t) ** 1.7, top[1] + (foot[1] - top[1]) * (1 - t) ** 1.7), z0 + h * t)
                                    for t in (0.0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.88, 1.0)]
    for k in range(4):
        j = (k + 1) % 4
        tdir = np.array(CORNERS[j]) - np.array(CORNERS[k])
        tdir = tdir / np.linalg.norm(tdir)
        rows = [[P(hu * CORNERS[i][0], hv * CORNERS[i][1], z) for i in (k, j)] for (hu, hv), z in rings]
        uvs = [[[float(np.dot((hu * CORNERS[i][0], hv * CORNERS[i][1]), tdir)), z - z0] for i in (k, j)] for (hu, hv), z in rings]
        mesh.grid(rows, uvs)


def top_floor(M, P, wall, rise, soffit, zd):
    """The top tier: black lacquered walls with gilded tigers in relief and gilded tie-beams, its
    windows, and the balcony round it (廻縁, its deck at zd) with a black railing and gilded post caps."""
    reach = BALCONY[0]
    loft(M["black"], P, 2 * wall[0], 2 * wall[1], rise - 0.3, 2 * wall[0], 2 * wall[1], soffit, top=False)
    hu, hv = wall[0] + reach, wall[1] + reach
    for side in "enws":
        nu, _ = SIDES[side]
        d0, half = (wall[0], wall[1]) if nu else (wall[1], wall[0])
        Q = side_frame(P, side, d0)
        qbox(M["deck"], Q, -half - reach, half + reach, 0.0, reach, zd - 0.3, zd)                      # the deck
        for a in np.arange(-half + 0.6, half - 0.3, 1.5):                                               # its brackets
            qbox(M["deck"], Q, a - 0.12, a + 0.12, 0.0, reach - 0.15, zd - 0.95, zd - 0.3)
        n = max(2, int(round((2 * half + 2 * reach) / 1.6)))
        for i in range(n + 1):                                                                          # the railing
            a = -half - reach + 0.1 + (2 * half + 2 * reach - 0.2) * i / n
            qbox(M["black"], Q, a - 0.08, a + 0.08, reach - 0.2, reach - 0.04, zd, zd + 1.05)
            if i in (0, n) or i % 3 == 0:
                qbox(M["gold"], Q, a - 0.11, a + 0.11, reach - 0.23, reach - 0.01, zd + 1.05, zd + 1.25)
        for zr, t in ((zd + 0.98, 0.14), (zd + 0.5, 0.08)):
            qbox(M["black"], Q, -half - reach + 0.1, half + reach - 0.1, reach - 0.18, reach - 0.06, zr, zr + t)
        # gilded tie-beams (長押), the windows between them, a tiger either side
        for zz in (zd + 1.15, soffit - 0.55):
            qbox(M["gold"], Q, -half, half, 0.0, 0.06, zz, zz + 0.16)
        for a in (-1.55, 1.55):
            qbox(M["window"], Q, a - 1.1, a + 1.1, -0.05, 0.08, zd + 1.5, soffit - 0.8)
            for x in np.linspace(a - 1.1, a + 1.1, 7)[1:-1]:
                qbox(M["black"], Q, x - 0.05, x + 0.05, 0.08, 0.12, zd + 1.5, soffit - 0.8)
        for sg in (-1, 1):
            L = 2.5
            pts = [(sg * x * L, z * L) for x, z in TIGER]
            plate(M["gold"], lambda x, d, z, a0=sg * (half - 1.9): Q(a0 + x, d, zd + 1.55 + z), pts if sg > 0 else pts[::-1], 0.0, 0.14)


def osaka_castle(c):
    """The keep on its stone base: five tiers of white plaster under copper roofs formed as tiles,
    each with the plan and the eaves PLATEAU's model measures, its gables on the faces where that
    model has them, windows, and the black top tier under a hip-and-gable roof with its shachi."""
    P = frame(c["centroid"][0], c["centroid"][1], math.radians(c["axis_deg"]) - math.pi / 2)
    z0 = c["ground_m"]
    lv = lambda h: z0 + keep_level(h)
    mats = {"stone": "granite", "wall": "plaster", "soffit": "plaster", "roof": "copper_roof", "ridge": "ridge_copper", "gold": "gold",
            "black": "black_wall", "window": "window", "bars": "window_bar", "deck": "black_wall"}
    # the keep is floodlit after dark: everything but the stone base and the windows
    M = {k: Mesh("castle_" + k, m, False, floodlit=k not in ("stone", "window", "bars"), uv=m in ("granite", "copper_roof")) for k, m in mats.items()}
    stone_base(M["stone"], P, z0, KEEP_STONE[0], KEEP_STONE[1], CASTLE_STONE_H)
    gables = [(("n", "s") if f == "ns" else ("e", "w"), d0, cc, hw, lv(zb), lv(za), dp) for f, d0, cc, hw, zb, za, dp in KEEP_GABLES]
    for k, (wall, eave, rise, soffit, top) in enumerate(KEEP_TIERS):
        if k == len(KEEP_TIERS) - 1:
            top_floor(M, P, wall, lv(rise), lv(soffit), lv(BALCONY[1]))
            hw, face, zb, za = KEEP_TOP
            skirt(M, P, eave, (hw, face), lv(top), lv(zb), lv(soffit), wall, lift=0.8, reach=4.5)
            for side in "ns":
                Q = side_frame(P, side, face)
                dr, zr = gable(M, Q, hw, lv(zb), lv(za), face)
                shachi(M["gold"], Q, dr - 0.45, zr - 0.3, (z0 + CASTLE_TOP_H - zr + 0.3) / 2.05)   # its tail at the published 54.8 m
            continue
        loft(M["wall"], P, 2 * wall[0], 2 * wall[1], lv(rise) - 0.3, 2 * wall[0], 2 * wall[1], lv(soffit), top=False)
        nxt = KEEP_TIERS[k + 1]
        skirt(M, P, eave, nxt[0], lv(top), lv(nxt[2]), lv(soffit), wall, lift=1.1 if k < 2 else 0.9)
        lo, hi = lv(rise) + (0.3 if k else 0.0), lv(soffit)
        if k == 3:   # the fourth tier: bell-shaped windows on the faces the gables leave clear
            for side in "ew":
                Q = side_frame(P, side, wall[0])
                for a in (-3.6, 3.6):
                    bell_window(M, Q, a, lo + 0.35, 1.5, hi - lo - 0.75)
        else:
            h = min(1.8, (hi - lo) * 0.45)
            wall_windows(M, P, wall, (lo + hi) / 2 - h / 2, h, gables, every=3.6 if k == 0 else 3.2)
    for sides, d0, cc, hw, zb, za, dp in gables:
        for side in sides:
            Q, ac = side_frame(P, side, d0), along(side, cc)
            gable(M, lambda a, d, z, Q=Q, ac=ac: Q(a + ac, d, z), hw, zb, za, dp, windows=int(hw // 2.6) - 2 if hw > 11 else 0)
    return list(M.values())


def kotenshu(M, p):
    """The small keep platform (小天守台) on its mapped outline: dressed stone in a batter, paved on top."""
    ring = np.array(p["ring"], float)
    z0, h, n = p["ground_m"], p["height_m"], len(ring)
    # the top, 0.9 m in from the foot: each corner moved in along the bisector of its two edges
    nrm = [np.array((ring[(i + 1) % n][1] - ring[i][1], ring[i][0] - ring[(i + 1) % n][0])) for i in range(n)]
    nrm = [v / np.linalg.norm(v) for v in nrm]           # outward, for an anticlockwise ring
    top = []
    for i in range(n):
        m = nrm[i - 1] + nrm[i]
        m = m / (np.linalg.norm(m) or 1)
        top.append(ring[i] - m * 0.9 / max(0.3, float(np.dot(m, nrm[i]))))
    s = 0.0
    for i in range(n):
        j = (i + 1) % n
        L = float(np.linalg.norm(ring[j] - ring[i]))
        M["stone"].grid([[np.array((*ring[i], z0 - 4.0)), np.array((*ring[j], z0 - 4.0))], [np.array((*ring[i], z0)), np.array((*ring[j], z0))],
                         [np.array((*top[i], z0 + h)), np.array((*top[j], z0 + h))]],
                        [[[s, -4.0], [s + L, -4.0]], [[s, 0.0], [s + L, 0.0]], [[s, h], [s + L, h]]])
        s += L
    for t in triangles(Polygon(top)):
        M["paving"].tri(*[np.array((x, y, z0 + h)) for x, y in t.exterior.coords[:3]])


def well_house(M, w):
    """The Kinmeisui well house (金明水井戸屋形, 1626) on the platform: plastered walls on a timber
    frame under a hip-and-gable roof of grey tiles."""
    P = frame(w["centroid"][0], w["centroid"][1], math.radians(w["axis_deg"]))
    z0 = w["ground_m"] + w["base_m"]
    hu, hv = w["long_m"] / 2 - 0.6, w["short_m"] / 2 - 0.6
    zt = z0 + w["height_m"]
    loft(M["stone"], P, 2 * hu + 0.6, 2 * hv + 0.6, z0 - 0.2, 2 * hu + 0.6, 2 * hv + 0.6, z0 + 0.3)
    loft(M["timber"], P, 2 * hu, 2 * hv, z0 + 0.3, 2 * hu, 2 * hv, z0 + 1.1, top=False)
    loft(M["wall"], P, 2 * hu, 2 * hv, z0 + 1.1, 2 * hu, 2 * hv, z0 + 2.5, top=False)
    for sx, sy in CORNERS:
        M["timber"].box(P(sx * hu, sy * hv, z0 + 0.3), P(sx * hu, sy * hv, z0 + 2.5), 0.28, 0.28)
    ring_trim(M["timber"], P, 2 * hu + 0.1, 2 * hv + 0.1, z0 + 2.3, 0.2, 0.25)
    G = {"roof": M["kawara"], "ridge": M["kawara_ridge"], "wall": M["wall"], "soffit": M["timber"], "gold": M["kawara_ridge"]}
    k = 0.4
    face, ghw, zb, za = hu * 0.55, hv * 0.7, z0 + 3.4, zt - 0.6 * k - 0.11      # the ridge's top at the measured height
    skirt(G, P, (hu + 0.9, hv + 0.9), (face, ghw), z0 + 2.65, zb, z0 + 2.45, (hu, hv), lift=0.25, reach=1.5)
    for side in "ew":
        gable(G, side_frame(P, side, face), ghw, zb, za, face, ov=0.5, k=k)


# ---------------------------------------------------------------- Tsutenkaku

# half-width of the tower's corners with height: legs that splay over the street, a body that
# narrows to the observatory (schematic, fitted to the 25 m footprint)
TSUTEN_PROFILE = [(0.0, 1.0), (8.0, 0.9), (14.0, 0.79), (22.0, 0.71), (40.0, 0.61), (60.0, 0.53), (82.0, 0.46)]
TSUTEN_BOX = (9.5, 22.0)      # the floors over the legs, above the open space with the ceiling painting, to the 22 m deck


def tsutenkaku_solids(P, half):
    """The legs and the floors over them, for the analyses and the collisions; the open space
    under the tower stays open, so people can walk under it."""
    sq = lambda cu, cv, r: Polygon([tuple(P(cu + sx * r, cv + sy * r, 0)[:2]) for sx, sy in CORNERS])
    legs = [[sq(sx * (half - 1.3), sy * (half - 1.3), 1.3), 0.0, TSUTEN_BOX[1], "parametric", None] for sx, sy in CORNERS]
    w = half * float(np.interp(TSUTEN_BOX[0], *zip(*TSUTEN_PROFILE))) + 1.2     # out to the legs' outer faces
    return legs + [[sq(0, 0, w), TSUTEN_BOX[0], TSUTEN_BOX[1], "parametric", None]]


def tsutenkaku(t):
    """Tsutenkaku: four legs over the street with the ceiling painting between them, the floors
    above to the third-floor deck (22 m), a braced steel body round its lift shaft with the sign
    boards on two faces, the observatories at 84 m and 87.5 m (the gold one), the round gallery
    (8.5 m across) of the open deck at 94.5 m and a jutting deck, the weather light and the
    lightning rod. Those heights are published; the members, panels and sizes are schematic."""
    P = frame(t["centroid"][0], t["centroid"][1], math.radians(t["axis_deg"]))
    z0 = t["ground_m"]
    half = min(t["width_m"], t["depth_m"]) / 2 - 0.5
    M = {k: Mesh("tsuten_" + k, m, False, floodlit=k in ("neon", "ceiling", "sign", "gold")) for k, m in
         (("steel", "steel"), ("panel", "steel_white"), ("glass", "glass"), ("gold", "glass_gold"), ("neon", "neon"),
          ("ceiling", "ceiling_paint"), ("sign", "sign_board"))}
    hw = lambda z: half * float(np.interp(z, *zip(*TSUTEN_PROFILE)))
    corner = lambda z, sx, sy: P(sx * hw(z), sy * hw(z), z0 + z)
    zc, zt = TSUTEN_BOX
    levels = [0.0, zc / 2, zc + 0.5] + list(np.arange(zt, 82.0, 6.0)) + [82.0]
    for za, zb in zip(levels[:-1], levels[1:]):
        for k, (sx, sy) in enumerate(CORNERS):
            nx, ny = CORNERS[(k + 1) % 4]
            if za < zc:
                M["steel"].box(corner(za, sx, sy), corner(zb, sx, sy), 2.2, 2.2)                # the legs, up to the floors over them
                continue
            M["steel"].box(corner(za, sx, sy), corner(zb, sx, sy), 1.2, 1.2)                    # the body's corners
            M["steel"].box(corner(za, sx, sy), corner(za, nx, ny), 0.5, 0.7)                    # ring beams
            M["steel"].box(corner(za, sx, sy), corner(zb, nx, ny), 0.35, 0.35)                  # X bracing
            M["steel"].box(corner(za, nx, ny), corner(zb, sx, sy), 0.35, 0.35)
    # the open base: arches between the legs, the ceiling painting, the floors over it
    for k, (sx, sy) in enumerate(CORNERS):
        nx, ny = CORNERS[(k + 1) % 4]
        # an arch from leg to leg, its crown under the ceiling
        pts = [P((sx + (nx - sx) * s) * hw(zc - 1), (sy + (ny - sy) * s) * hw(zc - 1), z0 + zc - 0.6 - 3.5 * abs(2 * s - 1) ** 2.5)
               for s in np.linspace(0, 1, 13)]
        for a, b in zip(pts, pts[1:]):
            M["steel"].box(a, b, 0.9, 1.1)
    R = 8.5
    oct_ = [P(R * math.cos(math.pi / 8 + k * math.pi / 4), R * math.sin(math.pi / 8 + k * math.pi / 4), z0 + zc) for k in range(8)]
    for k in range(8):
        M["ceiling"].tri(P(0, 0, z0 + zc), oct_[k], oct_[(k + 1) % 8])
    w0, w1 = 2 * hw(zc) + 2.4, 2 * hw(zt) + 1.4                                          # flush with the outside of the legs
    loft(M["panel"], P, w0, w0, z0 + zc + 0.05, w1, w1, z0 + zt, bottom=True)
    for zz in (zc + 3.0, zc + 7.5):
        f = (zz - zc) / (zt - zc)
        ring_trim(M["glass"], P, w0 + (w1 - w0) * (f + 0.06) + 0.14, w0 + (w1 - w0) * (f + 0.06) + 0.14, z0 + zz, 0.1, 1.6)   # window bands
    # the lift shaft up the middle, and the sign boards on two faces
    loft(M["panel"], P, 4.6, 4.6, z0 + zt, 4.6, 4.6, z0 + 82.0, top=False)
    for sv in (-1, 1):
        M["sign"].grid([[P(-hw(z) + 0.8, sv * (hw(z) + 0.3), z0 + z), P(hw(z) - 0.8, sv * (hw(z) + 0.3), z0 + z)] for z in (44.0, 58.0, 72.0)])
    # the observatories: the fourth floor at 84 m, the gold fifth floor at 87.5 m, the roof at 92.5 m
    r = hw(82.0) + 2.4
    ch = r * 0.38                                                                           # an octagon: corners cut back
    octo = lambda rr: [(rr, -rr + ch), (rr, rr - ch), (rr - ch, rr), (-rr + ch, rr), (-rr, rr - ch), (-rr, -rr + ch), (-rr + ch, -rr), (rr - ch, -rr)]

    def band(mesh, z_lo, z_hi, rr, cap=None):
        ring_ = octo(rr)
        for k in range(8):
            (ua, va), (ub, vb) = ring_[k], ring_[(k + 1) % 8]
            mesh.quad(P(ua, va, z0 + z_lo), P(ub, vb, z0 + z_lo), P(ub, vb, z0 + z_hi), P(ua, va, z0 + z_hi))
        if cap is not None:
            for k in range(8):
                (ua, va), (ub, vb) = ring_[k], ring_[(k + 1) % 8]
                mesh.tri(P(0, 0, z0 + cap), P(ua, va, z0 + cap), P(ub, vb, z0 + cap))

    band(M["panel"], 81.6, 83.6, r - 0.3, cap=81.6)
    band(M["glass"], 83.6, 86.6, r)
    band(M["panel"], 86.6, 87.4, r + 0.1)
    band(M["gold"], 87.4, 90.8, r)
    band(M["panel"], 90.8, 92.5, r + 0.2, cap=92.5)
    for zz in (83.6, 86.6, 90.8):
        for k in range(8):
            (ua, va) = octo(r + 0.02)[k]
            M["steel"].box(P(ua, va, z0 + zz), P(ua, va, z0 + zz + (3.0 if zz < 87 else 3.4)), 0.25, 0.25)     # mullions
    # the jutting deck (92.5 m), on one face
    slab(M["panel"], P, -2.5, 2.5, -r - 3.0, -r + 0.5, z0 + 92.2, z0 + 92.5)
    M["steel"].rails([P(-2.5, -r + 0.5, z0 + 92.5), P(-2.5, -r - 3.0, z0 + 92.5), P(2.5, -r - 3.0, z0 + 92.5), P(2.5, -r + 0.5, z0 + 92.5)], 1.1, 1.2, 0.06, 0.06)
    # the open deck (94.5 m): its round gallery, 8.5 m across, and the railing
    M["panel"].lathe([(z0 + 92.5, 4.25), (z0 + 94.5, 4.25), (z0 + 94.5, 0.01)], P(0, 0, 0)[:2], 24)
    M["steel"].tube([P(4.7 * math.cos(a), 4.7 * math.sin(a), z0 + 95.6) for a in np.linspace(0, 2 * math.pi, 25)], 0.06, 4)
    for a in np.linspace(0, 2 * math.pi, 17)[:-1]:
        M["steel"].box(P(4.7 * math.cos(a), 4.7 * math.sin(a), z0 + 94.5), P(4.7 * math.cos(a), 4.7 * math.sin(a), z0 + 95.6), 0.08, 0.08)
    # the mast with the weather light (white fair, orange cloudy, blue rain), to 103 m, and the rod to 108 m
    for sx, sy in CORNERS:
        M["steel"].box(P(sx * 1.6, sy * 1.6, z0 + 94.5), P(sx * 0.9, sy * 0.9, z0 + 103.0), 0.45, 0.45)
    M["neon"].lathe([(z0 + 96.0, 0.01), (z0 + 96.0, 1.7), (z0 + 100.6, 1.7), (z0 + 101.2, 1.1), (z0 + 101.2, 0.01)], P(0, 0, 0)[:2], 16)
    M["steel"].box(P(0, 0, z0 + 101.2), P(0, 0, z0 + 103.0), 0.6, 0.6)
    M["steel"].box(P(0, 0, z0 + 103.0), P(0, 0, z0 + 108.0), 0.25, 0.25)
    return [m for m in M.values() if m.v]


# ---------------------------------------------------------------- HEP FIVE wheel

def hep_wheel(h):
    """The HEP FIVE wheel: 75 m across, its lowest point at the seventh floor and its top 106 m
    above the street; two trussed rims on cable spokes from the hub, 52 gondolas hanging level,
    an A-frame down to the roof (the trusses and gondolas are schematic)."""
    ang = math.radians(h["axis_deg"])
    P = frame(h["centroid"][0], h["centroid"][1], ang)
    zc = h["ground_m"] + 31.0 + 37.5                                      # lowest point at the seventh floor
    red, steel, glass = Mesh("hep_wheel", "wheel_red", False), Mesh("hep_cables", "steel", False), Mesh("hep_glass", "glass", False)
    R, n, w = 37.5, 52, 1.5
    pt = lambda r, k, v=0.0: P(r * math.cos(2 * math.pi * k / n), v, zc + r * math.sin(2 * math.pi * k / n))
    for k in range(n):
        for v in (-w, w):
            red.box(pt(R, k, v), pt(R, k + 1, v), 0.45, 0.45)              # each rim a truss: outer and inner chords
            red.box(pt(R - 1.4, k, v), pt(R - 1.4, k + 1, v), 0.35, 0.35)
            red.box(pt(R, k, v), pt(R - 1.4, k + 0.5, v), 0.2, 0.2)       # zigzag between them
            red.box(pt(R - 1.4, k + 0.5, v), pt(R, k + 1, v), 0.2, 0.2)
            steel.box(P(0, v * 1.6, zc), pt(R - 1.4, k, v), 0.09, 0.09)   # cable spokes
        red.box(pt(R, k, -w), pt(R, k, w), 0.25, 0.25)                     # ties between the rims
        # a gondola hanging level under its pivot on the rim
        top = pt(R + 0.2, k + 0.5)
        steel.box(top, top - (0, 0, 0.9), 0.12, 0.12)
        body = [(0.9, 0.08), (1.0, 0.8), (1.2, 1.12), (1.9, 1.18), (2.6, 1.12), (2.8, 0.8), (2.9, 0.08)]    # (depth below the pivot, radius)
        red.tube([top - (0, 0, d) for d, _ in body], [r for _, r in body], 10)
        glass.tube([top - (0, 0, 1.25), top - (0, 0, 2.0)], 1.21, 10)
    red.tube([P(0, -2.6, zc), P(0, 2.6, zc)], 1.7, 16)                     # the hub
    for s in (-1, 1):                                                      # the A-frame down to the roof
        for a in (-1, 1):
            red.box(P(0, s * 2.2, zc), P(a * 9.0, s * 3.2, zc - 31.0 - 2.0), 1.0, 1.0)
        red.box(P(-6.0, s * 3.0, zc - 25.0), P(6.0, s * 3.0, zc - 25.0), 0.7, 0.7)
    return [red, steel, glass]


# ---------------------------------------------------------------- Glico sign and Kani Doraku

def runner():
    """The Glico runner, arms up and mid-stride, as a silhouette 1 unit tall from the ground."""
    from shapely.geometry import LineString
    limbs = [([(0.0, 0.47), (-0.03, 0.72)], 0.055), ([(-0.03, 0.71), (-0.17, 0.87), (-0.22, 0.98)], 0.03),
             ([(-0.03, 0.71), (0.12, 0.86), (0.17, 0.98)], 0.03), ([(0.0, 0.47), (0.17, 0.33), (0.13, 0.12)], 0.038),
             ([(0.13, 0.12), (0.2, 0.1)], 0.025), ([(0.0, 0.47), (-0.13, 0.31), (-0.27, 0.22)], 0.038),
             ([(-0.27, 0.22), (-0.31, 0.27)], 0.025)]
    body = shapely.union_all([LineString(p).buffer(r) for p, r in limbs] + [Point(-0.045, 0.81).buffer(0.065)])
    shorts = Polygon([(-0.085, 0.43), (0.08, 0.43), (0.11, 0.5), (-0.07, 0.53)])
    return body.simplify(0.004), shorts


def glico_sign(g):
    """The Glico sign: a lit board standing on the roof, its face to the canal, with the runner
    arms up on a track (an indicative figure, at the published position)."""
    n = np.array(g["normal"], float)
    t = np.array([n[1], -n[0]])
    Q = lambda u, v, z: np.array([g["at"][0] + t[0] * u + n[0] * v, g["at"][1] + t[1] * u + n[1] * v, z])
    z0 = g["ground_m"] + g["roof_m"]
    W, H = min(21.0, max(g["len"] - 1.0, 8.0)), 24.0
    blue, white, red, gold = (Mesh("glico_panel", "glico_blue", False, floodlit=True), Mesh("glico_white", "glico_white", False, floodlit=True),
                              Mesh("glico_red", "glico_red", False, floodlit=True), Mesh("glico_gold", "glico_gold", False, floodlit=True))
    frame_ = Mesh("glico_frame", "steel", False)
    loft(blue, Q, W, 0.8, z0 + 1.0, W, 0.8, z0 + H, True)
    for u in (-W / 2 + 1.0, 0.0, W / 2 - 1.0):                             # legs and a catwalk on the roof
        frame_.box(Q(u, -0.6, z0), Q(u, -0.6, z0 + 1.0), 0.5, 0.5)
    ring_ = [Q(-W / 2, 0.42, z0 + 1.0), Q(W / 2, 0.42, z0 + 1.0), Q(W / 2, 0.42, z0 + H), Q(-W / 2, 0.42, z0 + H)]
    for a, b in zip(ring_, ring_[1:] + ring_[:1]):
        white.box(a, b, 0.12, 0.35)                                        # the lit border
    for zz in (1.9, 2.7):                                                  # the track and its lanes
        gold.box(Q(-W / 2 + 0.6, 0.43, z0 + zz), Q(W / 2 - 0.6, 0.43, z0 + zz), 0.06, 0.22)
    body, shorts = runner()
    s = H * 0.82
    fig = lambda x, d, z: Q(x * s, 0.4 + d, z0 + 2.8 + z * s)
    for part, mesh in ((body, white), (shorts, red)):
        for poly in [part] if part.geom_type == "Polygon" else part.geoms:
            plate(mesh, fig, list(poly.exterior.coords)[:-1], 0.0, 0.1)
    return [blue, white, red, gold, frame_]


def kani_crab(k):
    """The Kani Doraku crab over the restaurant's door: a domed shell facing the street, four
    jointed legs a side and two raised claws with their pincers, eyes on stalks (indicative)."""
    n = np.array(k["normal"], float)
    t = np.array([n[1], -n[0]])
    Q = lambda u, v, z: np.array([k["at"][0] + t[0] * u + n[0] * v, k["at"][1] + t[1] * u + n[1] * v, z])
    z = k["ground_m"] + min(k["height_m"] * 0.62, 16.0)
    crab = Mesh("kani_crab", "crab", False, floodlit=True)
    eyes = Mesh("kani_eyes", "glico_white", False, floodlit=True)
    # the shell: half an ellipsoid, 4.6 m across, 3 m high, bulging 1.6 m out of the wall
    rows = []
    for th in np.linspace(0, math.pi / 2, 7):
        rows.append([Q(2.3 * math.cos(ph) * math.cos(th), 0.3 + 1.6 * math.sin(th), z + 1.5 * math.sin(ph) * math.cos(th) + 1.2)
                     for ph in np.linspace(0, 2 * math.pi, 25)])
    crab.grid(rows)
    for s in (-1, 1):
        for i in range(4):                                                 # legs: hip, knee, foot
            hip = Q(s * (1.6 + 0.12 * i), 0.8 + 0.25 * i, z + 1.6 - 0.35 * i)
            knee = Q(s * (3.4 + 0.45 * i), 1.3 + 0.2 * i, z + 2.5 - 0.3 * i)
            foot = Q(s * (4.4 + 0.75 * i), 1.0 + 0.3 * i, z - 0.6 - 0.2 * i)
            crab.tube([hip, knee, foot], [0.32, 0.26, 0.08], 6)
        # the claw: arm, wrist, and a pincer of two fingers raised in front
        sh, el, wr = Q(s * 1.5, 1.4, z + 2.0), Q(s * 2.6, 2.1, z + 3.3), Q(s * 2.0, 2.4, z + 4.6)
        crab.tube([sh, el, wr], [0.38, 0.36, 0.42], 8)
        crab.tube([wr, Q(s * 1.8, 2.5, z + 5.6), Q(s * 1.35, 2.5, z + 6.3)], [0.55, 0.42, 0.08], 8)    # the fixed finger
        crab.tube([wr, Q(s * 2.6, 2.5, z + 5.5), Q(s * 2.4, 2.5, z + 6.2)], [0.36, 0.28, 0.06], 8)     # the moving finger
        eyes.tube([Q(s * 0.55, 1.4, z + 2.6), Q(s * 0.6, 1.6, z + 3.2)], 0.13, 6)
        eyes.tube([Q(s * 0.6, 1.6, z + 3.15), Q(s * 0.6, 1.62, z + 3.45)], 0.2, 8)
    return [crab, eyes]


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
