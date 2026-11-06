"""Covered walkways (arcades) and gates as canopies over the way through, not solid blocks.

    python pipeline/arcades.py --city kyoto       # after game_data.py; or --city all

A covered shopping street or a covered pavement (Kyoto's Shijo and Kawaramachi arcades,
Osaka's shotengai, a station's covered walk) comes in the open data as a building: a
long, thin footprint from OpenStreetMap (building=roof) or Project PLATEAU, extruded from
the ground. Drawn and walked that way it is a wall several hundred metres long down the
pavement, and it closes off whole blocks (central Kyoto between Shijo, Kawaramachi, Sanjo
and Shinkyogoku had no way in on foot).

A solid is taken for a canopy when its footprint is thin (twice its area over its
perimeter, its mean width, at most 6 m: an arcade's footprint takes in the wider squares where
two covered streets cross, as Ebisubashi-suji's does at Namba, 5.7 m), a mapped footway (game.json paths) runs inside
it along at least 60% of its length, and it is either mapped as a roof (class "roof") or
an unnamed PLATEAU footprint no taller than 20 m (a named or taller one is a building a
passage runs through: a department store, a station). Its solid then starts at a soffit
(min_dm) under its measured top (soffit_dm), and it is drawn as a
plain canopy (class "roof", style "plain": no windows, an underside; web/buildings.js),
and walked under (web/game/nav.js reads min_dm as every solid's).

A gate is the same: a gatehouse comes in the data as a building from the ground, so the
mapped path through it (Kyoto Gosho's Gishumon and Kenshunmon, Nijo Castle's Higashi Ote-mon)
runs into a wall, and a walled precinct has no way in. A building named as a gate (its name
ends in 門, or its class is "gate"), no bigger than 400 m2 and not a home, shop or hotel, that
a mapped footway crosses, starts at the height of its opening: 55% of its height, between
2.5 and 6 m, and at least 0.6 m under its eaves (gate_soffit_dm).

Any other roof (OpenStreetMap building=roof: a park's shelter, a station's or a bus stop's
canopy, a petrol station's roof, a shrine's open pavilion, a subway entrance's cover) is a roof
on posts too, wherever it stands, unless most of its footprint lies inside a taller building
(a roof mapped over a terrace or on top of a block: hidden, and nothing to walk under). Its
underside is open_soffit_dm, under its eaves when it has a pitched roof, and never lower than 2.2 m.
A roof whose height is no measurement at all (height_src "estimate" or "ml": build_scene.py
takes it from the buildings within 60 m, so a subway entrance's cover in Marunouchi came out
77 m tall) is held to what a canopy is: 4 m under 60 m2, else 8 m; and a small roof (under
60 m2) at most 8 m whatever its source (PLATEAU measures a tree over a shelter as its top).
Its fascia and posts take a dark timber or steel colour (FRAME), its roof keeps its own.

Then every roof on posts and every gate (not an arcade) is finished (finish(), run again on what an earlier
run opened, so it needs no rebuild of the scene):
- a borrowed top (#258): a roof on posts over 15 m whose top is that of a building it touches (the height
  matching took the neighbour's) is held to a canopy's 8 m: Keio University Hospital's entrance canopy over its
  taxi drive stood at 51.6-53.1 m on posts, building 1's top.
  A covered walk (an arcade) with a borrowed top is held to 6 m the same way (two beside a Kyoto hotel stood at
  38.4-41.4 m, #263).
- its colour: OSM building:colour when mapped; else its precinct's palette (cities/<id>/city.json
  "roofs" "palette", by precinct name: Kiyomizu-dera's vermilion); else a shrine's vermilion (SHU) in a
  Shinto precinct or on a Shinto building, a temple's aged timber (TIMBER) in a Buddhist one; else it
  keeps its own (FRAME for a roof). The tags and precincts come from cities/<id>/roofs_osm.json
  (pipeline/roof_osm.py, from the OpenStreetMap API).
- its height: a pavilion under 400 m2 is no taller than its kind stands (a bell tower 4.5 m + 0.6 m per
  metre of the square root of its area, a font's pavilion 3 m + 0.4, a dance stage or votive hall
  4.5 m + 0.45, anything else 4 m + 0.5), over the highest ground under it, when its top is PLATEAU's
  or a lidar's or a guess (they take a tree over it as its top): Higashiyama's bell towers stood
  10-21 m tall over 16 m2. A pitched roof drops whole.
- inner posts: a roof over 400 m2 stands on rows of posts inside its outline too (buildings.json
  "inner_posts", by building: x_dm, y_dm, ...): one row down the middle of a platform's or a bus stand's
  canopy (narrower than 24 m), else rows every 10 m across, at 10 m along, at least 1.5 m inside its
  edge, 4 m off a road's centre line and 1.2 m off a footway, and not inside another building.
- a structure under 2.6 m with no name or class (a vent's or a stair's cover by a subway exit, a shed, a
  kiosk's back) is drawn plain: there is no room in it for a storey of windows (Marunouchi's solid 18776, a
  2.4 m block beside Tokyo Station's M8 exit, was a windowed box under the trees), and so is a subway
  entrance's cover under 4.5 m (named ...出入口, as the M8 exit itself is).
- its roof (#258): a pavilion under 900 m2 drawn as a flat slab gets a pitched roof (buildings.json "r"): its
  mapped roof:shape (and roof:material, roof:colour), else in a temple's or a shrine's precinct, or on a
  temple or a shrine, a hipped roof of grey kawara (a hip-and-gable's nearest; Yasaka-jinja's Buden stood
  as a slab on posts), its eaves no lower than 2.4 m and its fascia under them.
- a roof the city names as closed (city.json "roofs" "closed", OSM ids: Shinjuku's Sumitomo Triangle
  Plaza, a glass atrium) goes back to a glass building from the ground.

Rewrites web/data/<city>/buildings.json in place; running it again changes nothing.
"""
import argparse
import json
import os

import shapely
from shapely.geometry import LineString, Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDTH_M, ALONG, TALL_M = 6.0, 0.6, 20.0
SMALL_M2, SMALL_TOP_M, GUESS_SMALL_M, GUESS_M, MIN_CLEAR_DM = 60.0, 8.0, 4.0, 8.0, 22
GUESSED = {"estimate", "ml"}
FRAME = "#5b564f"  # a roof on posts: dark timber or painted steel, under a roof of its own colour
SHU = "#c4482a"  # a shrine's vermilion (朱), as the Fushimi Inari and Kiyomizu models' torii_shu under the grade
TIMBER = "#6a5444"  # a temple's aged keyaki and hinoki
GLASS = "#7f95a0"  # a glass atrium's walls
GLASS_ROOF, ATRIUM_EAVE_M, ATRIUM_NEAR_M, ATRIUM_PART_DM = "#5d7280", 4.5, 12.0, 300  # a glass roof; a closed atrium's eaves, and how near the tower its top corners stand
BORROWED_DM = 150  # a roof on posts taller than this with a neighbour's top: its height was the neighbour's
WALK_M = 6.0  # a covered walk with a borrowed top: held to a hotel's or a station's covered pavement, its underside 4.5 m up
PITCH_DEG, PITCH_OVERHANG, PITCH_MAX_M2, PITCH_EAVE_M = 32.0, 0.5, 900.0, 2.4  # an open pavilion's pitched roof (pitched_roof())
KAWARA, BARK = "#4c5156", "#4a4c50"  # a temple's grey tiles (kawara); a shrine pavilion's, a little darker (Yasaka-jinja's Buden, photographs)
UTILITY = {"bicycle_parking", "motorcycle_parking", "parking", "parking_entrance", "smoking_area", "toilets", "waste_disposal",
           "recycling", "vending_machine", "fuel", "car_wash", "bus_station", "taxi"}
SPAN_M, ROW_W_M, INNER_MIN_M2 = 10.0, 24.0, 400.0
LOW_DM = 26  # under this (decimetres) a building has no room for a storey of windows
EXITS, EXIT_DM = ("出入口", "入口", "出口", "Entrance", "entrance"), 45  # a subway entrance's cover under 4.5 m
MEASURED_TALL = {"plateau", "lidar", "estimate", "ml"}  # tops that may be a tree over the roof
KINDS = (  # (name parts, base m, m per metre of sqrt(area))
    (("鐘楼", "鐘堂", "鐘撞", "梵鐘", "鐘つき"), 4.5, 0.6),
    (("手水", "水屋", "浄水"), 3.0, 0.4),
    (("舞殿", "神楽殿", "絵馬堂", "絵馬殿", "能舞台", "拝殿", "神輿"), 4.5, 0.45),
)


def roof_top_dm(meta, area_m2, top_dm):
    """A roof's top, held to a canopy's when it was never measured, or measured over a tree."""
    cap = (GUESS_SMALL_M if area_m2 < SMALL_M2 else GUESS_M) if meta[4] in GUESSED else (SMALL_TOP_M if area_m2 < SMALL_M2 else None)
    return min(top_dm, round(10 * cap)) if cap is not None else top_dm


def soffit_dm(height_m):
    """A canopy's underside: its roof at the measured top, a quarter of the height deep (0.5-3 m),
    and never lower than 2.5 m over the street."""
    return round(10 * max(2.5, height_m - max(0.5, min(3.0, 0.25 * height_m))))


def open_soffit_dm(height_m):
    """A roof on posts: a thinner one than an arcade's, its fascia 15% of its height (0.35-1.5 m) deep."""
    return round(10 * (height_m - max(0.35, min(1.5, 0.15 * height_m))))


def gate_soffit_dm(height_m, eave_m):
    """A gate's opening: 55% of its height (2.5-6 m), under its eaves; None when there is no headroom."""
    z = min(max(2.5, min(6.0, 0.55 * height_m)), eave_m - 0.6)
    return round(10 * z) if z >= 2.2 else None


GATE_CLASSES = {"", "yes", "roof", "gate", "shrine", "temple", "religious", "castle", "ruins", "historic"}


def is_gate(meta, P):
    name = (meta[0] or "").strip()
    return (meta[1] == "gate" or name.endswith("門")) and meta[1] in GATE_CLASSES and P.area <= 400


def open_roof(B, s, si, P, polys, solid_tree, eave, plain):
    """A roof from the ground (building=roof) lifted onto posts: True when it was changed."""
    for j in solid_tree.query(P):
        o = B["s"][j]
        if j != si and polys[j] is not None and B["b"][o[0]][1] != "roof" and o[2] <= 30 and o[3] >= s[3] - 10:
            if polys[j].intersection(P).area > 0.5 * P.area:
                return False  # inside a taller building: a roof over its terrace, or on top of it
    meta = B["b"][s[0]]
    if eave is None:  # (a pitched roof keeps the top its roof record was built to)
        top = roof_top_dm(meta, P.area, s[3])
        if top < s[3]:
            s[3] = top
            meta[2] = meta[9] = round(top / 10, 1)
    lo = open_soffit_dm(s[3] / 10)
    if eave is not None:
        lo = min(lo, eave - 5)
    if s[3] - lo < 3:
        lo = s[3] - 3
    if lo < MIN_CLEAR_DM:
        return False
    s[2] = lo
    if len(meta) > 7:
        meta[7] = FRAME  # its fascia and posts (web/buildings.js draws both in the wall's colour)
    if plain is not None and len(meta) > 10 and eave is None:
        meta[10] = plain
    return True


def mark(out_dir):
    bpath, gpath = os.path.join(out_dir, "buildings.json"), os.path.join(out_dir, "game.json")
    if not (os.path.exists(bpath) and os.path.exists(gpath)):
        return 0
    B, G = json.load(open(bpath, encoding="utf8")), json.load(open(gpath, encoding="utf8"))
    foot = []
    for o in G.get("paths", {}).get("foot", []):
        p = o["p"]
        if len(p) >= 6:
            foot.append(LineString([(p[i] / 10, p[i + 1] / 10) for i in range(0, len(p), 3)]))
    if not foot:
        return 0
    tree = shapely.STRtree(foot)
    plain = B["styles"].index("plain") if "plain" in B.get("styles", []) else None
    n = 0
    eaves = {id(B["s"][r[0]]): r[2] for r in B.get("r", [])}  # a roofed solid's eaves, decimetres over its base
    polys = []
    for s in B["s"]:
        ring = s[4]
        try:
            P = Polygon([(ring[k] / 10, ring[k + 1] / 10) for k in range(0, len(ring), 2)],
                        [[(h[k] / 10, h[k + 1] / 10) for k in range(0, len(h), 2)] for h in s[5:] if len(h) >= 6])
            if not P.is_valid:
                P = P.buffer(0)
        except ValueError:
            P = None
        polys.append(None if P is None or P.is_empty else P)
    solid_tree = shapely.STRtree([P if P is not None else Polygon() for P in polys])
    for si, s in enumerate(B["s"]):
        bi = s[0]
        meta = B["b"][bi]
        height = (s[3] - s[2]) / 10
        P = polys[si]
        if P is None:
            continue
        if is_gate(meta, P) and s[2] == 0 and any(foot[i].crosses(P) for i in tree.query(P)):
            r = eaves.get(id(s))
            lo = gate_soffit_dm(height, (r - s[2]) / 10 if r is not None else height)
            if lo is not None and s[3] - lo >= 5:
                s[2] = lo
                meta[1] = "roof"
                n += 1
            continue
        roof = meta[1] == "roof"
        if P.length < 40 or 2 * P.area / P.length > WIDTH_M:
            if roof and s[2] == 0 and open_roof(B, s, si, P, polys, solid_tree, eaves.get(id(s)), plain):
                n += 1
            continue
        if s[2] > 0 and not roof:
            continue  # already raised: part of a building over a passage
        if not roof and (meta[0] or meta[6] or meta[5] != "P" or height > TALL_M):
            continue
        inside = sum(foot[i].intersection(P).length for i in tree.query(P))
        if inside < ALONG * P.length / 2:
            if roof and s[2] == 0 and open_roof(B, s, si, P, polys, solid_tree, eaves.get(id(s)), plain):
                n += 1
            continue
        lo = soffit_dm(height)
        if s[2] >= lo or s[3] - lo < 3:
            continue
        s[2] = lo
        meta[1] = "roof"
        if plain is not None and len(meta) > 10:
            meta[10] = plain
        n += 1
    n += finish(out_dir, B, G, polys, solid_tree, foot, tree)
    if n:
        with open(bpath, "w") as f:
            json.dump(B, f, separators=(",", ":"))
    return n


def muted_keep(hex_colour):
    """A mapped building:colour as paint shows it: saturation at most 0.75, brightness 0.25-0.8."""
    import colorsys
    try:
        r, g, b = (int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
    except (ValueError, IndexError):
        return None
    h, s_, v = colorsys.rgb_to_hsv(r, g, b)
    r, g, b = colorsys.hsv_to_rgb(h, min(s_, 0.75), min(max(v, 0.25), 0.8))
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


NAMED = {"red": "#b8402a", "vermilion": "#c4482a", "orange": "#c86a30", "brown": "#6a4a36", "black": "#2e2b28",
         "white": "#e6e2d8", "grey": "#8c8c88", "gray": "#8c8c88", "green": "#4f6a4a", "blue": "#4a5f7a"}


def mapped_colour(t):
    c = (t.get("building:colour") or "").strip().lower()
    if c in NAMED:
        return NAMED[c]
    return muted_keep(c) if c.startswith("#") and len(c) == 7 else None


def kind_cap_m(name, area_m2):
    """How tall a pavilion of this kind and footprint stands, at most."""
    base, per = 4.0, 0.5
    for parts, b, p in KINDS:
        if any(k in name for k in parts):
            base, per = b, p
            break
    return base + per * area_m2 ** 0.5


def ground_max_dm(G, cfg, P):
    """The highest walking ground under a footprint, in decimetres (None without a terrain grid)."""
    import base64
    import numpy as np
    t = G.get("terrain")
    if not t or t.get("encoding") != "int16le-base64":
        return None
    z = np.frombuffer(base64.b64decode(t["data"]), "<i2").reshape(t["ny"], t["nx"])
    x0, x1, y0, y1 = cfg["extent_m"]
    c = t["cell"]
    a, b, e, f = P.bounds
    c0, c1 = max(0, int((a - x0) / c)), min(t["nx"] - 1, int((e - x0) / c))
    r0, r1 = max(0, int((y1 - f) / c)), min(t["ny"] - 1, int((y1 - b) / c))
    best = None
    for r in range(r0, r1 + 1):
        for cc in range(c0, c1 + 1):
            x, y = x0 + (cc + 0.5) * c, y1 - (r + 0.5) * c
            if P.buffer(c * 0.75).contains(shapely.Point(x, y)):
                v = int(z[r, cc])
                best = v if best is None else max(best, v)
    return best


def drop_roof(r, top_dm):
    """Lower a solid's pitched roof mesh to top_dm (decimetres over its base): whole, where its eaves then
    stand at least 55% of the way up; else its eaves at 55% and its slopes shallower to fit."""
    import base64
    import numpy as np
    top, eave = r[1], r[2]
    dz = top - top_dm
    new_eave = max(eave - dz, round(0.55 * top_dm))
    xyz = np.frombuffer(base64.b64decode(r[6]), "<i2").astype(np.float64)
    z = xyz[2::3]
    lo = z <= eave
    z[lo] = z[lo] * (new_eave / max(eave, 1))
    z[~lo] = new_eave + (z[~lo] - eave) * ((top_dm - new_eave) / max(top - eave, 1))
    xyz[2::3] = z
    r[6] = base64.b64encode(np.round(xyz).astype("<i2").tobytes()).decode()
    r[1], r[2] = top_dm, new_eave


def glass_atrium_roof(B, s, si, P, polys):
    """A closed glass atrium's roof (#258, Shinjuku's Sumitomo Triangle Plaza, by a photograph): faceted glass
    rising from eaves at ATRIUM_EAVE_M on its far side to its top by the tower it stands against (a tower within
    ATRIUM_NEAR_M: PLATEAU cuts the two apart). Each corner of its outline takes a height by its distance from the
    tower, and the outline is triangulated into flat facets between them. None when nothing taller stands by it."""
    import numpy as np
    import roofs
    from build_scene import pack_roof
    top, lo = s[3], round(10 * ATRIUM_EAVE_M)
    if top - lo < 20 or P.geom_type != "Polygon":
        return None
    tall = [polys[j] for j, o in enumerate(B["s"]) if j != si and polys[j] is not None and o[1] + o[3] > s[1] + top + 100
            and polys[j].distance(P) < ATRIUM_NEAR_M]
    if not tall:
        return None
    q = np.asarray(shapely.geometry.polygon.orient(P, 1.0).exterior.coords)[:-1]
    d = np.array([min(T.distance(shapely.geometry.Point(x, y)) for T in tall) for x, y in q])
    if d.max() - d.min() < 10:
        return None
    tris = roofs.earcut(q)
    if not tris:
        return None
    zs = lo + (top - lo) * (d.max() - d) / (d.max() - d.min())   # the nearest corners at the top, the farthest at the eaves
    pos = [c for (x, y), z in zip(q, zs) for c in (round(x * 10), round(y * 10), int(round(z)))]
    idx = [i for t in tris for i in t]
    meta = B["b"][s[0]]
    mats, shapes = B.get("roof_materials", []), B.get("roof_shapes", [])
    if len(meta) > 15:
        if "glass" in mats:
            meta[13] = mats.index("glass")
        if "skillion" in shapes:
            meta[15] = shapes.index("skillion")
        meta[8] = GLASS_ROOF
    return [si, top, lo, roofs.CODES["skillion"]] + pack_roof(pos, idx) + [len(tris)]


def borrowed_top(B, s, si, P, polys, solid_tree):
    """Whether a roof on posts has the top of a building it touches (within 0.5 m, over the ground or over
    its base): a height the matching took from the building beside it, not a measurement of the roof."""
    for j in solid_tree.query(P.buffer(1.5)):
        o = B["s"][j]
        if j == si or polys[j] is None or B["b"][o[0]][1] == "roof" or o[2] > 0:
            continue
        if (abs(o[3] - s[3]) <= 5 or abs(o[1] + o[3] - s[1] - s[3]) <= 5) and polys[j].distance(P) < 1.5:
            return True
    return False


def roof_shape_for(t, here, colour):
    """The pitched roof an open pavilion carries ((shape, source) or None): its mapped roof:shape, else a
    hipped roof (a hip-and-gable's nearest) in a temple's or a shrine's precinct or on a temple or a shrine."""
    import roofs
    shape = (t.get("roof:shape") or "").strip()
    if shape in roofs.PITCHED and shape not in ("dome", "onion", "spherical"):
        return shape, "mapped"
    if shape and shape != "flat" and shape not in roofs.PITCHED:
        shape = ""
    if shape == "flat":
        return None
    rel = t.get("religion") or (here[0].get("religion") if here else "") or ""
    if rel in ("shinto", "buddhist") or t.get("building") in ("shrine", "temple") or colour in (SHU, TIMBER):
        return "hipped", "rule"
    return None


def pitched_roof(B, s, si, P, t, here, colour):
    """A roof record (buildings.json "r") for an open pavilion drawn as a flat slab (#258): its eaves over its
    fascia and its ridge at its top, kawara over a temple's, cypress bark's brown over a shrine's. None when
    there is no pitched roof to give it or no room for one."""
    import numpy as np
    import roofs
    from build_scene import pack_roof
    got = roof_shape_for(t, here, colour)
    if got is None or P.geom_type != "Polygon":
        return None
    shape, src = got
    meta = B["b"][s[0]]
    top = s[3] / 10
    cap = min(0.45 * top, top - PITCH_EAVE_M - 0.25)   # its eaves no lower than a person walks under
    if cap < 0.8:
        return None
    Q = shapely.geometry.polygon.orient(P, 1.0)
    for tol, over in ((0.0, PITCH_OVERHANG), (0.3, PITCH_OVERHANG), (0.3, 0.0), (0.8, 0.0)):
        R = Q.simplify(tol) if tol else Q
        if R.geom_type != "Polygon" or len(R.exterior.coords) < 4:
            continue
        R = shapely.geometry.polygon.orient(R, 1.0)
        rings = [np.asarray(R.exterior.coords)[:-1]]
        m, built, rh = roofs.roof_mesh(rings, shape, pitch=PITCH_DEG, cap=cap, overhang=over)
        if m is not None and built != "flat" and rh >= 0.6 and roofs.check(m, rings, rh, built):
            break
    else:
        return None
    eave = top - rh
    s[2] = max(MIN_CLEAR_DM, min(s[2], round(10 * (eave - 0.3))))   # its fascia under the eaves, open below
    v = np.asarray(m.v)
    q = np.c_[np.round(v[:, :2] * 10), np.round((eave + v[:, 2]) * 10)].astype(int)
    uniq, remap = {}, []
    for p_ in q.tolist():
        remap.append(uniq.setdefault(tuple(p_), len(uniq)))
    pos = [c for p_ in uniq for c in p_]
    idx = [remap[i] for tri in m.roof + m.wall for i in tri]
    mats, shapes, srcs = B.get("roof_materials", []), B.get("roof_shapes", []), B.get("roof_sources", [])
    if len(meta) > 16:
        sacred = colour in (SHU, TIMBER) or src == "rule"
        mat = (t.get("roof:material") or "").strip()
        mat = mat if mat in mats else "kawara" if sacred else None
        if mat in mats:
            meta[13] = mats.index(mat)
        if built in shapes:
            meta[15] = shapes.index(built)
        if src in srcs:
            meta[16] = srcs.index(src)
        if t.get("roof:colour"):
            meta[8] = t["roof:colour"]
        elif sacred:
            meta[8] = BARK if colour == SHU else KAWARA
    return [si, s[3], round(eave * 10), roofs.CODES[built]] + pack_roof(pos, idx) + [len(m.roof)]


def inner_posts(P, roads, footways, others):
    """Posts inside a wide roof's outline: [(x, y)] in metres (finish())."""
    from shapely import affinity
    R = P.minimum_rotated_rectangle
    q = list(R.exterior.coords)[:4]
    e = [((q[(k + 1) % 4][0] - q[k][0]), (q[(k + 1) % 4][1] - q[k][1])) for k in range(2)]
    L = [max(1e-6, (v[0] ** 2 + v[1] ** 2) ** 0.5) for v in e]
    k_long = 0 if L[0] >= L[1] else 1
    ux, uy = e[k_long][0] / L[k_long], e[k_long][1] / L[k_long]
    vx, vy = -uy, ux
    length, width = L[k_long], L[1 - k_long]
    cx, cy = R.centroid.x, R.centroid.y
    rows = [0.0] if width < ROW_W_M else [(-width / 2 + width * (i + 1) / (int(width // SPAN_M) + 1))
                                          for i in range(int(width // SPAN_M))]
    m = max(1, int(length // SPAN_M))
    along = [-length / 2 + length * (i + 0.5) / m for i in range(m)]
    inside = P.buffer(-1.5)
    out = []
    for v in rows:
        for u in along:
            x, y = cx + ux * u + vx * v, cy + uy * u + vy * v
            pt = shapely.Point(x, y)
            if inside.is_empty or not inside.contains(pt):
                continue
            if roads is not None and any(roads[1][i].distance(pt) < 4.0 for i in roads[0].query(pt.buffer(4.0))):
                continue
            if footways is not None and any(footways[1][i].distance(pt) < 1.2 for i in footways[0].query(pt.buffer(1.2))):
                continue
            if any(o.contains(pt) for o in others):
                continue
            out.append((x, y))
    del affinity
    return out


def finish(out_dir, B, G, polys, solid_tree, foot, foot_tree):
    """Colour, height, inner posts and closed atria for the roofs on posts and the gates (see the docstring)."""
    cid = os.path.basename(os.path.normpath(out_dir))
    cpath = os.path.join(ROOT, "cities", cid, "city.json")
    cfg = json.load(open(cpath, encoding="utf8")) if os.path.exists(cpath) else {}
    rcfg = cfg.get("roofs", {})
    opath = os.path.join(ROOT, "cities", cid, "roofs_osm.json")
    osm = json.load(open(opath, encoding="utf8")) if os.path.exists(opath) else {}
    tags = osm.get("tags", {})
    prec = [(Polygon(p["ring"]), p) for p in osm.get("precincts", []) if len(p["ring"]) >= 4]
    prec = [(Pg if Pg.is_valid else Pg.buffer(0), p) for Pg, p in prec]
    palette = rcfg.get("palette", {})
    closed = set(rcfg.get("closed", []))
    glazed = set(rcfg.get("glazed", []))
    glass = B["styles"].index("glass") if "glass" in B.get("styles", []) else None
    eaves = {r[0]: r for r in B.get("r", [])}
    road_lines = []
    for o in G.get("paths", {}).get("road", []):
        p = o["p"]
        if len(p) >= 6:
            road_lines.append(LineString([(p[i] / 10, p[i + 1] / 10) for i in range(0, len(p), 3)]))
    roads = (shapely.STRtree(road_lines), road_lines) if road_lines else None
    footways = (foot_tree, foot) if foot else None
    inner = {}
    n = 0
    new_roofs = []
    plain = B["styles"].index("plain") if "plain" in B.get("styles", []) else None
    top = {}
    for s in B["s"]:
        top[s[0]] = max(top.get(s[0], 0), s[3])
    for s in B["s"]:  # the low structures
        meta = B["b"][s[0]]
        name = (meta[0] or "").strip()
        entrance = name.endswith(EXITS) and top[s[0]] < EXIT_DM  # a subway entrance's cover: steel and glass, no storey
        if (plain is not None and len(meta) > 10 and s[2] == 0 and (entrance or (top[s[0]] < LOW_DM and not name))
                and meta[1] in ("", "yes") and meta[10] != plain and B["styles"][meta[10]] != "wall"):
            meta[10] = plain
            n += 1
    parts = rcfg.get("atrium_parts", {})   # a tower's low solids that are its atrium's: moved to the atrium's building
    if parts:
        by_osm = {}
        for bi, m in enumerate(B["b"]):
            by_osm.setdefault(m[6] or "", bi)
        for s in B["s"]:
            src = B["b"][s[0]][6] or ""
            if src in parts and parts[src] in by_osm and s[3] < ATRIUM_PART_DM and s[2] == 0:
                s[0] = by_osm[parts[src]]
                n += 1
    for si, s in enumerate(B["s"]):
        meta = B["b"][s[0]]
        P = polys[si]
        oid = (meta[6] or "") if P is not None else ""
        if oid in closed:
            if s[2] > 0:
                s[2] = 0
                meta[1] = "commercial"
                meta[7] = GLASS
                if glass is not None and len(meta) > 10:
                    meta[10] = glass
                n += 1
            if si not in eaves and P is not None and P.area > 300:
                r = glass_atrium_roof(B, s, si, P, polys)
                if r is not None:
                    new_roofs.append(r)
                    eaves[si] = r
                    n += 1
            continue
        if oid in glazed and P is not None and meta[1] == "roof":
            mats = B.get("roof_materials", [])
            want = (GLASS, GLASS_ROOF, mats.index("glass") if "glass" in mats else meta[13])
            if (meta[7], meta[8], meta[13]) != want:
                meta[7], meta[8], meta[13] = want
                n += 1
            continue   # a glazed roof spans between the buildings either side: no posts inside it
        if P is None or meta[1] != "roof" or s[2] <= 0:
            continue
        if (P.length >= 40 and 2 * P.area / P.length <= WIDTH_M and not is_gate(meta, P)
                and sum(foot[i].intersection(P).length for i in foot_tree.query(P)) >= ALONG * P.length / 2):
            # an arcade: a covered street keeps its own colour; but a covered walk with the top of the building it
            # runs along (#263: two beside a Kyoto hotel, w1316075664 and w1316075663, stood 38.4-41.4 m up on posts,
            # the hotel's 41.4 m) is held to a covered walk's height
            if (s[3] > BORROWED_DM and "height" not in tags.get(oid, {}) and meta[4] in MEASURED_TALL
                    and borrowed_top(B, s, si, P, polys, solid_tree)):
                r = eaves.get(si)
                if r is not None:
                    drop_roof(r, round(10 * WALK_M))
                s[3] = round(10 * WALK_M)
                s[2] = soffit_dm(WALK_M)
                meta[2] = meta[9] = WALK_M
                n += 1
            continue
        t = tags.get(oid, {})
        name = (meta[0] or t.get("name") or "").strip()
        here = [p for Pg, p in prec if Pg.intersects(P) and Pg.intersection(P).area > 0.5 * P.area]
        here.sort(key=lambda p: Polygon(p["ring"]).area)  # the innermost (a sub-temple inside its head temple)
        colour = mapped_colour(t)
        if colour is None:
            for p in here:
                for k, c in palette.items():
                    if k and k in p.get("name", ""):
                        colour = c
                        break
                if colour:
                    break
        if colour is None and (t.get("amenity") in UTILITY or t.get("shelter_type") == "public_transport"):
            colour = FRAME  # a bicycle stand's or a smoking area's roof in a precinct is painted steel all the same
        if colour is None:
            rel = t.get("religion") or (here[0].get("religion") if here else "") or ""
            if rel == "shinto" or t.get("building") == "shrine":
                colour = SHU
            elif rel == "buddhist" or t.get("building") == "temple":
                colour = TIMBER
        if colour and len(meta) > 7 and meta[7] != colour:
            meta[7] = colour
            n += 1
        # the height of a pavilion (not a gate: their tops were measured with their roofs)
        gate = is_gate(meta, P) or t.get("building") in ("gatehouse", "gate")
        if not gate and s[3] > BORROWED_DM and "height" not in t and meta[4] in MEASURED_TALL and borrowed_top(B, s, si, P, polys, solid_tree):
            # its top is a building's beside it, taken over by the height matching (#258: Keio University Hospital's
            # entrance canopy, w1409752350, stood at 51.6-53.1 m on posts over its taxi drive, building 1's 53.1 m)
            r = eaves.get(si)
            if r is not None:
                drop_roof(r, round(10 * GUESS_M))
            s[3] = round(10 * GUESS_M)
            lo = open_soffit_dm(s[3] / 10)
            if r is not None:
                lo = min(lo, r[2] - 5)
            s[2] = max(MIN_CLEAR_DM, min(lo, s[3] - 3))
            meta[2] = meta[9] = round(s[3] / 10, 1)
            n += 1
        if not gate and P.area < INNER_MIN_M2 and meta[4] in MEASURED_TALL and "height" not in t:
            gmax = ground_max_dm(G, cfg, P)
            lift = max(0, gmax - s[1]) if gmax is not None else 0
            cap = max(lift + round(10 * kind_cap_m(name, P.area)), MIN_CLEAR_DM + 8)
            if s[3] > cap:
                r = eaves.get(si)
                if r is not None:
                    drop_roof(r, cap)
                s[3] = cap
                lo = open_soffit_dm(s[3] / 10)
                if r is not None:
                    lo = min(lo, r[2] - 5)
                lo = min(lo, s[3] - 3)
                s[2] = max(MIN_CLEAR_DM, lo)
                meta[2] = meta[9] = round(s[3] / 10, 1)
                n += 1
        if si not in eaves and P.area <= PITCH_MAX_M2:
            r = pitched_roof(B, s, si, P, t, here, colour)
            if r is not None:
                new_roofs.append(r)
                eaves[si] = r
                n += 1
        if P.area > INNER_MIN_M2:
            others = [polys[j] for j in solid_tree.query(P) if j != si and polys[j] is not None
                      and B["b"][B["s"][j][0]][1] != "roof" and B["s"][j][2] == 0]
            pts = inner_posts(P, roads, footways, others)
            if pts:
                inner.setdefault(str(s[0]), []).extend(v for x, y in pts for v in (round(x * 10), round(y * 10)))
    if new_roofs:
        B["r"] = B.get("r", []) + new_roofs
    if inner or B.get("inner_posts"):
        if B.get("inner_posts") != inner:
            n += 1
        B["inner_posts"] = inner
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--city", required=True, help="a city id, or all")
    a = ap.parse_args()
    data = os.path.join(ROOT, "web", "data")
    ids = sorted(d for d in os.listdir(data) if os.path.exists(os.path.join(data, d, "game.json"))) if a.city == "all" else [a.city]
    for cid in ids:
        print(f"{cid}: {mark(os.path.join(data, cid))} changes: covered walkways and gates opened, roofs on posts finished, low structures plain")


if __name__ == "__main__":
    main()
