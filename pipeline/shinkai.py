"""Makoto Shinkai's Shinjuku: the places three of his films are set in, built in code for the Shinjuku map
(cities/shinjuku/city.py calls these hooks). Places only: no art, characters, frames or logos from the
films. Sources, licences and what is approximate: docs/cities/shinjuku.md, "Pilgrimage sites".

Shinjuku Gyoen 新宿御苑, The Garden of Words (言の葉の庭, 2013)
  * The azumaya (東屋), the garden's rest shelter on the south shore of the Japanese garden's pond, the
    second pool west of the Kyu-Goryotei, where the garden's own map (Ministry of the Environment,
    "見どころ" map) marks it; OpenStreetMap has no footprint for it, so it is set on the mapped pond's
    shore there, facing the water. A square timber shelter with a pyramidal (hogyo) roof, benches round
    three sides and the pond side open (photographs; the dimensions are a park shelter's, not a survey).
  * The wisteria trellis (藤棚) on the pond path between the shelter and the Kyu-Goryotei.
  * The Kyu-Goryotei (旧御涼亭, "Taiwan Pavilion", 1927, Moriyama Matsunosuke): a single-storey timber
    pavilion in the Min-nan style of southern Fujian, clay-tiled (honkawara), 165 m2 (Tokyo's register
    of selected historic buildings; Kanto Regional Development Bureau). On OpenStreetMap's footprint,
    its veranda over the pond; the ridges sweep up into swallowtails. The proportions are approximate.
  * The pond itself, as water: the viewer's sea-level water plane cannot hold a garden pond 30 m up, so
    the Japanese garden's mapped ponds are drawn here at their shore's height.

Shinanomachi 信濃町, Your Name (君の名は。, 2016)
  * The footbridge in front of the station (信濃町駅前歩道橋): its deck and its three flights of steps on
    OpenStreetMap's lines (level 1), a steel deck 5.6 m above the road, railings, piers. Walkable
    (game_surfaces), so the guide can send pilgrims up to look along Gaien-higashi-dori.

Each hook takes what the pipeline gives a city hook (pipeline/build_scene.py Ctx); finalize stores the
anchors in ctx.landmarks["shinkai"], meshes(lm) builds from them alone, so landmarks.json can be rebuilt
from scene.json without the raw data.
"""
import math

import numpy as np
from shapely.geometry import Point, Polygon

from japankit import block, frame, lathe_at, left_of, overture, slab_at, unit, Kit
from roofs import earcut

GORYOTEI = "旧御涼亭"
# the azumaya, by the garden's map: the south shore of the pond west of the Kyu-Goryotei (OSM relation
# 5362865, the pond nearest this point), near its east end. The shore point nearest it is the shelter's front.
AZUMAYA_NEAR = (139.70814, 35.68483)
GARDEN = "新宿御苑"     # every pond inside the garden (Overture land use) is drawn as water
FOOTBRIDGE = "信濃町駅前歩道橋"
FOOTBRIDGE_STEPS = ("w97195468", "w381567525", "w97195476")   # its three flights (OSM ways)
DECK_CLEAR_M = 5.6      # deck above the road (a Tokyo footbridge's 4.7 m clearance plus the girder)

MATERIALS = {
    "sk_timber": {"color": "#5b4433", "roughness": 0.85, "metalness": 0.0},
    # the shelter's frame, benches and shore stones: walked among, not into (in the game's 2 m collision cells
    # they would fill the shelter's floor); the roof is above head height
    "sk_frame": {"color": "#5b4433", "roughness": 0.85, "metalness": 0.0, "solid": False},
    "sk_bench": {"color": "#9a7a5c", "roughness": 0.85, "metalness": 0.0, "solid": False},
    "sk_stone": {"color": "#7d7a72", "roughness": 0.95, "metalness": 0.0, "solid": False},
    "sk_stone_moss": {"color": "#5d6a4a", "roughness": 0.95, "metalness": 0.0, "solid": False},
    "sk_timber_light": {"color": "#9a7a5c", "roughness": 0.85, "metalness": 0.0},
    "sk_soffit": {"color": "#6e5642", "roughness": 0.9, "metalness": 0.0},
    "sk_roof": {"color": "#4b4a47", "roughness": 0.7, "metalness": 0.2},
    "sk_bronze": {"color": "#5e4c3a", "roughness": 0.45, "metalness": 0.7},
    "sk_paving": {"color": "#a19b8f", "roughness": 0.92, "metalness": 0.0},
    "sk_pond": {"color": "#1b2a26", "roughness": 0.5, "metalness": 0.0},
    "sk_vine": {"color": "#54463a", "roughness": 0.9, "metalness": 0.0},
    "sk_leaf": {"color": "#4d6e34", "roughness": 0.8, "metalness": 0.0},
    "sk_leaf_dark": {"color": "#3b5a2b", "roughness": 0.8, "metalness": 0.0},
    "go_tile": {"color": "#5d5f61", "roughness": 0.65, "metalness": 0.05},
    "go_ridge": {"color": "#4e5052", "roughness": 0.6, "metalness": 0.05},
    "go_wood": {"color": "#7a3226", "roughness": 0.7, "metalness": 0.0},
    "go_lattice": {"color": "#3d2a22", "roughness": 0.75, "metalness": 0.0},
    "go_wall": {"color": "#e6dccb", "roughness": 0.85, "metalness": 0.0},
    "go_glow": {"color": "#b9a888", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffd29a", "glow": 0.25},
    "go_stone": {"color": "#9c968b", "roughness": 0.9, "metalness": 0.0},
    "fb_girder": {"color": "#7f8f8b", "roughness": 0.55, "metalness": 0.4},
    "fb_deck": {"color": "#8a8279", "roughness": 0.9, "metalness": 0.0},
    "fb_rail": {"color": "#9aa7a3", "roughness": 0.5, "metalness": 0.45},
    "fb_lamp": {"color": "#f4eedc", "roughness": 0.6, "metalness": 0.0, "emissive": "#fff1d0", "glow": 1.6},
}


def osm_ids(r):
    """The OpenStreetMap ids a segment was cut from (Overture's records, "w123@4")."""
    return {str(x).split("@")[0] for x in (r.get("records") or [])}


def rnd(p, k=2):
    return [round(float(c), k) for c in p]


# ---------------------------------------------------------------- the build hooks

_PONDS = {}


def garden_ponds(C):
    """The ponds inside the garden (local polygons, with their names), read once."""
    if "list" not in _PONDS:
        park = [r["geom"] for r in overture(C, "land_use", f"name = '{GARDEN}'") if r["geom"].geom_type in ("Polygon", "MultiPolygon")]
        park = max(park, key=lambda q: q.area) if park else None
        _PONDS["list"] = [(r["name"] or "", r["geom"]) for r in overture(C, "water", "class = 'pond'")
                          if park is not None and r["geom"].geom_type == "Polygon" and park.contains(r["geom"].representative_point())]
    return _PONDS["list"]


def adjust_terrain(dem, C, cell):
    """Set each garden pond's water level (the low shore: the 15th percentile of the ground round it, from
    the finest grid seen), lower the grid inside it 0.6 m below that and its bank to within a metre or so
    above, so the water lies in a basin with low banks, as a garden pond's are; the
    laser survey's ground over a pond is the interpolated water surface, which a 10 m grid smooths into a
    mound over the small ones."""
    ny, nx = dem.shape
    at = lambda q: dem[np.clip(np.round((C.y1 - q[:, 1]) / cell).astype(int), 0, ny - 1), np.clip(np.round((q[:, 0] - C.x0) / cell).astype(int), 0, nx - 1)]
    fine = cell <= _PONDS.get("cell", math.inf)
    for k, (_, g) in enumerate(garden_ponds(C)):
        if fine:
            dense = np.array([g.exterior.interpolate(t).coords[0] for t in np.arange(0, g.exterior.length, 2.0)])
            _PONDS[k] = float(np.percentile(at(dense), 15))
        level = _PONDS[k]
        bank = 1.2 * cell                     # the bank: brought down to just above the water
        x0, y0, x1, y1 = g.buffer(bank).bounds
        for c in range(max(0, int((x0 - C.x0) / cell)), min(nx, int((x1 - C.x0) / cell) + 2)):
            for r in range(max(0, int((C.y1 - y1) / cell)), min(ny, int((C.y1 - y0) / cell) + 2)):
                q = Point(C.x0 + c * cell, C.y1 - r * cell)
                if g.contains(q):
                    dem[r, c] = min(dem[r, c], level - 0.6)
                else:
                    d = g.exterior.distance(q)
                    if d < bank:
                        dem[r, c] = min(dem[r, c], level + 0.35 + 1.2 * d / bank)
    if fine:
        _PONDS["cell"] = cell
    return dem


def pond_level(C, k, g, ground):
    """The level adjust_terrain set, or (no cut made) the low shore."""
    if k in _PONDS:
        return _PONDS[k]
    dense = [g.exterior.interpolate(t).coords[0] for t in np.arange(0, g.exterior.length, 2.0)]
    return float(np.percentile([ground(*p) for p in dense], 15))


def woods_clear(scene):
    """Where the trees planted from the canopy model must not stand (pipeline/woods.py): in and round the
    shelter, the trellis and the pavilion, on the footbridge, and in the garden's ponds."""
    s = scene.get("landmarks", {}).get("shinkai") or {}
    out = []
    if "azumaya" in s:
        out.append([*s["azumaya"]["centre"], 4.2])
    if "trellis" in s:
        out.append([*s["trellis"]["centre"], 5.0])
    for r in (s.get("goryotei") or {}).get("rects", []):
        out.append([*r["centre"], 0.5 * math.hypot(r["depth_m"], r["width_m"]) + 1.5])
    fb = s.get("footbridge")
    if fb:
        out += [[*p, 3.0] for p in fb["deck"]]
    out += [p["ring"] for p in s.get("ponds", [])]
    return out

def building(b, cls, g, geoms, ctx):
    """The Kyu-Goryotei is drawn by its mesh: its footprint is recorded and its solids hidden (kept for the sun)."""
    if (b.get("name") or "") == GORYOTEI and g.geom_type == "Polygon":
        ctx.landmarks["goryotei_ring"] = [rnd(p) for p in g.exterior.coords[:-1]]
        if geoms:  # PLATEAU's height: the main ridge's
            ctx.landmarks["goryotei_top"] = round(max(q[2] for q in geoms), 1)
        for q in geoms:
            ctx.hide(q)
    return geoms


def finalize(ctx):
    """Anchors for the meshes, from the raw data: the ponds, the shelter's shore, the pavilion, the footbridge."""
    C, lm = ctx.city, ctx.landmarks
    s = {}
    water = [{"name": n, "geom": g} for n, g in garden_ponds(C)]
    ponds = []
    for k, r in enumerate(water):
        ring = np.asarray(r["geom"].exterior.coords)[:-1]
        ponds.append({"name": r["name"], "ring": [rnd(p, 1) for p in ring], "z": round(pond_level(C, k, r["geom"], ctx.ground), 2)})
    if ponds:
        s["ponds"] = ponds
    near = Point(*C.fwd.transform(*AZUMAYA_NEAR))
    pond = min((r["geom"] for r in water), key=lambda q: q.distance(near), default=None)
    if pond is not None and pond.distance(near) < 15:
        shore = pond.exterior.interpolate(pond.exterior.project(near))
        out = unit(np.array([near.x - shore.x, near.y - shore.y]))
        if np.linalg.norm(out) < 0.5 or pond.contains(near):
            out = unit(np.array([shore.x - pond.centroid.x, shore.y - pond.centroid.y]))
        c = np.array([shore.x, shore.y]) + out * 3.4             # set back from the water's edge
        face = -out                                              # the open side faces the pond
        s["azumaya"] = {"centre": rnd(c), "face": rnd(face, 4), "z": round(ctx.ground(*c), 2),
                        "shore": rnd((shore.x, shore.y))}
        # the shore stones at the shelter's front, on the water line either side
        L = pond.exterior.length
        t0 = pond.exterior.project(shore)
        rocks = []
        for k, d in enumerate((-5.5, -3.6, -1.4, 1.8, 3.9, 6.2)):
            p = pond.exterior.interpolate((t0 + d) % L)
            rocks.append(rnd((p.x, p.y, ctx.ground(p.x, p.y) - 0.15, 0.45 + 0.25 * ((k * 7) % 3)), 2))
        s["azumaya"]["rocks"] = rocks
    if "goryotei_ring" in lm:
        ring = np.asarray(lm.pop("goryotei_ring"))
        poly = Polygon(ring)
        cen = np.array(poly.centroid.coords[0])
        gp = min((r["geom"] for r in water), key=lambda q: q.distance(poly), default=None)
        to_pond = unit(np.array(gp.centroid.coords[0]) - cen) if gp is not None else np.array([0.0, 1.0])
        z = min(ctx.ground(*p) for p in ring)
        s["goryotei"] = {"centre": rnd(cen), "z": round(z, 2), "rects": rects(poly, to_pond),
                         "top_m": min(8.0, max(6.5, lm.pop("goryotei_top", 7.5)))}
        if "azumaya" in s:  # the wisteria trellis: on the pond path, 40% of the way from the shelter to the pavilion
            a, gc = np.array(s["azumaya"]["centre"]), cen
            m = a + (gc - a) * 0.4
            along = unit(gc - a)
            s["trellis"] = {"centre": rnd(m), "axis": rnd(along, 4), "z": round(ctx.ground(*m), 2)}
    fb = footbridge(ctx)
    if fb:
        s["footbridge"] = fb
    if not s:
        return
    lm["shinkai"] = s
    if "azumaya" in s:
        a = s["azumaya"]
        ctx.labels["Garden of Words shelter 東屋"] = [a["centre"][0], a["centre"][1], round(a["z"] + 9, 1)]
    if "goryotei" in s:
        g = s["goryotei"]
        ctx.labels["Kyu-Goryotei 旧御涼亭"] = [g["centre"][0], g["centre"][1], round(g["z"] + 12, 1)]
    if fb:
        m = fb["deck"][len(fb["deck"]) // 2]
        ctx.labels["Shinanomachi footbridge 歩道橋"] = [m[0], m[1], round(fb["z"] + 7, 1)]


def rects(poly, to_pond, cell=0.5, min_m2=14.0):
    """The footprint as a few rectangles (the pavilion's halls, each under its own roof): squared to its
    longest edge, rasterised, and the largest rectangle of filled cells taken until little is left. Each
    is {centre, axis (u across it, towards the pond), depth_m (along u), width_m, open (the one nearest
    the pond is the open veranda)}."""
    q = np.asarray(poly.exterior.coords)
    e = np.diff(q, axis=0)
    k = int(np.argmax(np.hypot(e[:, 0], e[:, 1])))
    f = unit(e[k])
    l = left_of(f)
    o = np.array(poly.centroid.coords[0])
    loc = (q - o) @ np.stack([f, l]).T
    lp = Polygon(loc)
    x0, y0, x1, y1 = lp.bounds
    nx, ny = int(math.ceil((x1 - x0) / cell)), int(math.ceil((y1 - y0) / cell))
    grid = np.array([[lp.contains(Point(x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell)) for i in range(nx)] for j in range(ny)])
    out = []
    while True:
        best, hist = None, np.zeros(nx, int)
        for j in range(ny):   # the largest rectangle under each row's histogram
            hist = np.where(grid[j], hist + 1, 0)
            stack = []
            for i in range(nx + 1):
                h = hist[i] if i < nx else 0
                start = i
                while stack and stack[-1][1] >= h:
                    s0, hh = stack.pop()
                    a = hh * (i - s0)
                    if best is None or a > best[0]:
                        best = (a, s0, i, j - hh + 1, j + 1)
                    start = s0
                stack.append((start, h))
        if best is None or best[0] * cell * cell < min_m2:
            break
        if min(best[2] - best[1], best[4] - best[3]) * cell < 2.5:   # a sliver: left to the neighbours' eaves
            grid[best[3]:best[4], best[1]:best[2]] = False
            continue
        _, i0, i1, j0, j1 = best
        grid[j0:j1, i0:i1] = False
        ca, cb = x0 + (i0 + i1) / 2 * cell, y0 + (j0 + j1) / 2 * cell
        wa, wb = (i1 - i0) * cell, (j1 - j0) * cell
        c = o + f * ca + l * cb
        across = l if wa >= wb else f           # u runs across the rectangle's short side
        if float(np.dot(across, to_pond)) < 0:
            across = -across
        out.append({"centre": rnd(c), "axis": rnd(across, 4), "depth_m": round(min(wa, wb), 2), "width_m": round(max(wa, wb), 2)})
    if out:
        pond_side = max(range(len(out)), key=lambda i: float(np.dot(np.array(out[i]["centre"]) - o, to_pond)))
        for i, r in enumerate(out):
            r["open"] = i == pond_side
    return out


def footbridge(ctx):
    """The deck on its OpenStreetMap line, at DECK_CLEAR_M over the highest ground under it; each flight of
    steps from the deck down its own line to the ground."""
    C = ctx.city
    segs = overture(C, "segment", f"name = '{FOOTBRIDGE}'")
    if not segs:
        return None
    line = max((r["geom"] for r in segs if r["geom"].geom_type == "LineString"), key=lambda q: q.length)
    pts = np.asarray(line.coords)
    zg = max(ctx.ground(*line.interpolate(t, normalized=True).coords[0]) for t in np.linspace(0, 1, 9))
    z = round(zg + DECK_CLEAR_M, 2)
    flights = []
    for r in overture(C, "segment", "class = 'steps'"):
        ids = osm_ids(r) & set(FOOTBRIDGE_STEPS)
        if not ids or r["geom"].geom_type != "LineString":
            continue
        q = np.asarray(r["geom"].coords)
        d0, d1 = line.distance(Point(*q[0])), line.distance(Point(*q[-1]))
        top, foot = (q[0], q[-1]) if d0 <= d1 else (q[-1], q[0])
        ax = unit(foot - top)
        n = len(q)
        length = float(np.linalg.norm(foot - top))
        flights.append({"id": sorted(ids)[0], "top": rnd(top), "axis": rnd(ax, 4), "length_m": round(length, 2),
                        "z_foot": round(ctx.ground(*foot), 2), "points": n})
    return {"deck": [rnd(p) for p in pts], "z": z, "width_m": 2.4, "flights": flights}


# ---------------------------------------------------------------- the shelter of The Garden of Words

AZ = {"half": 1.6, "post": 0.15, "eave_z": 2.38, "ov": 0.85, "pitch": 0.58, "seat_z": 0.42, "seat_d": 0.4}


def azumaya(K, a):
    """Floor pad, four posts and mid posts, the eave beams and tie beams, benches round three sides with
    lattice backs, the pyramidal roof on its rafters and the finial; shore stones in front."""
    c, f, z0 = np.array(a["centre"]), np.array(a["face"]), a["z"]
    P = frame(c, f)            # u towards the pond, v to its left
    h, w = AZ["half"], AZ["post"]
    zf = z0 + 0.14
    T, TL = K("sk_frame"), K("sk_bench")
    block(K("sk_paving"), P, -h - 0.55, h + 0.55, -h - 0.55, h + 0.55, z0 - 0.4, zf)
    for su in (-1, 1):
        for sv in (-1, 1):
            slab_at(T, P, su * h, sv * h, w, w, zf, z0 + AZ["eave_z"])
            lathe_at(K("sk_stone"), *P(su * h, sv * h, 0)[:2], [(zf - 0.02, 0.16), (zf + 0.08, 0.14), (zf + 0.1, 0.0)], 8)  # base stones
    ze = z0 + AZ["eave_z"]
    # the eave beams (keta) round the top, the tie beams (nuki) under them, a tie across the middle
    for sv in (-1, 1):
        block(T, P, -h - 0.25, h + 0.25, sv * h - 0.07, sv * h + 0.07, ze - 0.2, ze)
        block(T, P, sv * h - 0.07, sv * h + 0.07, -h - 0.25, h + 0.25, ze - 0.2, ze)
        block(T, P, -h, h, sv * h - 0.04, sv * h + 0.04, ze - 0.62, ze - 0.52)
        block(T, P, sv * h - 0.04, sv * h + 0.04, -h, h, ze - 0.62, ze - 0.52)
    block(T, P, -h, h, -0.06, 0.06, ze - 0.06, ze + 0.12)
    # benches: the back (away from the pond) and the two sides, seats on brackets, lattice backs to 0.85 m
    sz, sd = z0 + AZ["seat_z"], AZ["seat_d"]
    for u0, u1, v0, v1 in ((-h + 0.08, -h + 0.08 + sd, -h + 0.08, h - 0.08),
                           (-h + 0.08 + sd, h - 0.12, -h + 0.08, -h + 0.08 + sd),
                           (-h + 0.08 + sd, h - 0.12, h - 0.08 - sd, h - 0.08)):
        block(TL, P, u0, u1, v0, v1, sz - 0.045, sz)
        for k in np.linspace(0, 1, 4):
            uu, vv = u0 + (u1 - u0) * k, v0 + (v1 - v0) * k
            slab_at(T, P, min(max(uu, u0 + 0.04), u1 - 0.04), min(max(vv, v0 + 0.04), v1 - 0.04), 0.07, 0.07, zf, sz - 0.045)
    for side in ("back", "left", "right"):
        if side == "back":
            span, fix = (-h, h), lambda t, z: P(-h, t, z)
        else:
            sv = 1 if side == "left" else -1
            span, fix = (-h, h * 0.25), lambda t, z, sv=sv: P(t, sv * h, z)
        a0, a1 = span
        # the panel: top and bottom rails, vertical slats every 0.12 m
        for zz in (zf + 0.02, sz + 0.38):
            p0, p1 = fix(a0, zz), fix(a1, zz)
            T.box(p0, p1, 0.06, 0.06)
        for t in np.arange(a0 + 0.1, a1 - 0.05, 0.12):
            T.box(fix(t, zf + 0.02), fix(t, sz + 0.4), 0.03, 0.025)
    # the roof: pyramidal, swept a little, the eaves AZ["ov"] out; rafters radiating underneath
    E = h + AZ["ov"]
    H = E * AZ["pitch"]
    zt = ze + 0.12 + H
    zr = lambda t: ze + 0.12 + H * t ** 1.25      # t from 0 (eaves) to 1 (apex)
    R, S = K("sk_roof"), K("sk_soffit")
    ts = np.linspace(0, 1, 7)
    corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    ring = lambda t, lift=0.0: [P(su * E * (1 - t), sv * E * (1 - t), zr(t) + lift + (0.09 * (1 - t) ** 3 if t < 0.5 else 0)) for su, sv in corners]
    for t0, t1 in zip(ts, ts[1:]):
        a0, a1 = ring(t0), ring(t1)
        for i in range(4):
            j = (i + 1) % 4
            R.quad(a0[i], a0[j], a1[j], a1[i])
            S.quad(a0[j] + [0, 0, -0.06], a0[i] + [0, 0, -0.06], a1[i] + [0, 0, -0.06], a1[j] + [0, 0, -0.06])
    e = ring(0)
    for i in range(4):  # the fascia board round the eaves
        j = (i + 1) % 4
        R.quad(e[i] + [0, 0, -0.1], e[j] + [0, 0, -0.1], e[j], e[i])
    for su, sv in corners:  # hip ridges, slightly proud
        K("sk_roof", "hip").box(P(su * E, sv * E, zr(0) + 0.1), P(0, 0, zt + 0.03), 0.09, 0.07)
    for k in np.linspace(-1, 1, 9):  # rafters, seen from the benches, from the eave beam up under the roof
        for side in range(4):
            su, sv = corners[side]
            nu, nv = corners[(side + 1) % 4]
            pu, pv = su + (nu - su) * (k + 1) / 2, sv + (nv - sv) * (k + 1) / 2
            p0 = P(pu * E * 0.96, pv * E * 0.96, zr(0.02) - 0.1)
            p1 = P(pu * E * 0.3, pv * E * 0.3, zr(0.7) - 0.1)
            T.box(p0, p1, 0.05, 0.07)
    lathe_at(K("sk_bronze"), *P(0, 0, 0)[:2], [(zt, 0.16), (zt + 0.08, 0.14), (zt + 0.16, 0.07), (zt + 0.22, 0.12), (zt + 0.34, 0.08), (zt + 0.42, 0.0)], 10)
    for x, y, zz, r in a.get("rocks", []):
        rock(K, x, y, zz, r)


def rock(K, x, y, z, r):
    """A garden stone: a low lumpy lathe, its top mossy."""
    lathe_at(K("sk_stone"), x, y, [(z - 0.2, r * 0.9), (z + r * 0.25, r), (z + r * 0.55, r * 0.8)], 7)
    lathe_at(K("sk_stone_moss"), x, y, [(z + r * 0.55, r * 0.8), (z + r * 0.7, r * 0.45), (z + r * 0.74, 0.0)], 7)


# ---------------------------------------------------------------- the wisteria trellis

def trellis(K, t, rng):
    """A 7.2 x 4.8 m trellis of log posts and a grid of poles at 2.4 m, three old wisteria vines climbing it
    and spreading over the top, their leaves in clumps with gaps (in leaf, not in flower)."""
    P = frame(t["centre"], t["axis"])
    z0 = t["z"]
    L, W, Hh = 3.6, 2.4, 2.4
    T, V = K("sk_timber"), K("sk_vine")
    for u in np.linspace(-L, L, 4):
        for v in (-W, W):
            lathe_at(T, *P(u, v, 0)[:2], [(z0 - 0.1, 0.085), (z0 + Hh, 0.075)], 8)
    for v in (-W, W):
        T.box(P(-L - 0.3, v, z0 + Hh), P(L + 0.3, v, z0 + Hh), 0.12, 0.12)
    for u in np.linspace(-L, L, 7):
        T.box(P(u, -W - 0.3, z0 + Hh + 0.12), P(u, W + 0.3, z0 + Hh + 0.12), 0.07, 0.07)
    for v in np.arange(-W + 0.4, W, 0.45):
        K("sk_timber_light").box(P(-L - 0.2, v, z0 + Hh + 0.2), P(L + 0.2, v, z0 + Hh + 0.2), 0.035, 0.035)
    # three vines: a twisted trunk up a post, then branches along the top
    for u0, v0 in ((-L, -W), (0.0, W), (L, -W)):
        path, rr = [], []
        for k in range(10):
            s = k / 9
            a = s * 5.5
            path.append(P(u0 + 0.16 * math.cos(a), v0 + 0.16 * math.sin(a), z0 + s * (Hh + 0.1)))
            rr.append(0.11 - 0.04 * s)
        V.tube(path, rr, 7)
        for b in range(4):
            ang = rng.uniform(0, 2 * math.pi)
            q, pts, rads = np.array([u0, v0]), [], []
            for k in range(7):
                ang += rng.uniform(-0.5, 0.5)
                q = q + 0.6 * np.array([math.cos(ang), math.sin(ang)])
                q = np.clip(q, [-L - 0.2, -W - 0.2], [L + 0.2, W + 0.2])
                pts.append(P(q[0], q[1], z0 + Hh + 0.28 + 0.05 * math.sin(k)))
                rads.append(0.06 - 0.007 * k)
            V.tube([P(u0, v0, z0 + Hh + 0.1)] + pts, [0.07] + rads, 5)
    # the leaves: flattened clumps over the top, denser over the middle, a few hanging below the poles
    for _ in range(70):
        u, v = rng.uniform(-L - 0.3, L + 0.3), rng.uniform(-W - 0.2, W + 0.2)
        if rng.random() < 0.18:
            continue
        r = rng.uniform(0.45, 0.85)
        x, y, _ = P(u, v, 0)
        zc = z0 + Hh + 0.32 + rng.uniform(-0.05, 0.12)
        m = K("sk_leaf" if rng.random() < 0.6 else "sk_leaf_dark")
        lathe_at(m, x, y, [(zc - 0.22, r * 0.55), (zc - 0.05, r), (zc + 0.12, r * 0.8), (zc + 0.22, 0.0)], 7)
    for _ in range(26):
        u, v = rng.uniform(-L, L), rng.uniform(-W, W)
        x, y, _ = P(u, v, 0)
        zc = z0 + Hh + 0.05
        lathe_at(K("sk_leaf_dark"), x, y, [(zc - 0.55, 0.0), (zc - 0.4, 0.12), (zc, 0.22)], 6)


# ---------------------------------------------------------------- the Kyu-Goryotei

def goryotei(K, g):
    """The pavilion: its footprint's halls, each under its own roof, the largest roof highest."""
    rs = sorted(g["rects"], key=lambda r: -r["depth_m"] * r["width_m"])
    for k, r in enumerate(rs):
        pavilion(K, r, g["z"], 1.0 if k == 0 else 0.82, g.get("top_m", 7.5))


def pavilion(K, g, z0, scale=1.0, top_m=7.5):
    """One hall on its rectangle: a stone base, columns, lattice windows and plaster (or, on the pond side,
    an open veranda with a low railing in front of the hall), under a hip-and-gable roof of grey clay
    tiles with the Min-nan ridge sweeping up into swallowtails at both ends."""
    P = frame(g["centre"], g["axis"])     # u towards the pond, v along the front
    D, Wd = g["depth_m"] / 2, g["width_m"] / 2
    zb = z0 + 0.6
    zc = zb + 3.2 * (0.9 + 0.1 * scale)   # column tops
    Wo, Cl, Lt = K("go_wood"), K("go_wall"), K("go_lattice")
    block(K("go_stone"), P, -D, D, -Wd, Wd, z0 - 0.6, zb)
    block(K("go_stone", "cap"), P, -D - 0.05, D + 0.05, -Wd - 0.05, Wd + 0.05, zb - 0.1, zb)
    if g.get("open"):
        for k in range(4):   # steps down from the veranda at the middle of the front
            block(K("go_stone"), P, D, D + 0.3 * (4 - k), -1.2, 1.2, z0 - 0.3, z0 + 0.15 * (k + 1))
    ver = min(2.6, D * 0.45) if g.get("open") else 0.0   # the veranda's depth
    uh0, uh1 = -D + 0.35, D - max(ver, 0.35)   # the hall's back and front walls
    vh = Wd - 0.35
    # the hall: plaster walls, lattice windows in the bays, doors in the front
    bays = max(3, int(round(2 * vh / 2.0)))
    vs = np.linspace(-vh, vh, bays + 1)
    for u in (uh0, uh1):
        for v0, v1 in zip(vs, vs[1:]):
            block(Cl, P, u - 0.1, u + 0.1, v0, v1, zb, zb + 0.75)
            block(Cl, P, u - 0.1, u + 0.1, v0, v1, zc - 0.55, zc)
            block(K("go_glow"), P, u - 0.04, u + 0.04, v0 + 0.1, v1 - 0.1, zb + 0.75, zc - 0.55)   # the paper behind, lit at night
            side = 1 if u > 0 else -1
            for vv in np.linspace(v0 + 0.1, v1 - 0.1, 9):   # the lattice's bars, proud of the panel
                slab_at(Lt, P, u + side * 0.06, vv, 0.03, 0.06, zb + 0.75, zc - 0.55)
            for zz in np.linspace(zb + 0.75, zc - 0.55, 7):
                block(Lt, P, u + side * 0.04, u + side * 0.08, v0 + 0.1, v1 - 0.1, zz - 0.03, zz + 0.03)
    us = np.linspace(uh0, uh1, max(2, int(round((uh1 - uh0) / 2.0))) + 1)
    for v in (-vh, vh):
        for u0, u1 in zip(us, us[1:]):
            block(Cl, P, u0, u1, v - 0.1, v + 0.1, zb, zc)
            block(Lt, P, u0 + 0.25, u1 - 0.25, v - 0.13, v + 0.13, zb + 0.9, zc - 0.6)
    # columns: round, on the hall's corners and bays and along the veranda's front, a beam round the top
    for v in vs:
        for u in ((uh0, uh1, D - 0.3) if ver else (uh0, uh1)):
            lathe_at(Wo, *P(u, v, 0)[:2], [(zb, 0.16), (zb + 0.12, 0.13), (zc, 0.12)], 10)
            lathe_at(K("go_stone"), *P(u, v, 0)[:2], [(zb, 0.22), (zb + 0.18, 0.2), (zb + 0.2, 0.0)], 8)
    for u in us[1:-1]:
        for v in (-vh, vh):
            lathe_at(Wo, *P(u, v, 0)[:2], [(zb, 0.15), (zc, 0.12)], 10)
    block(Wo, P, -D + 0.2, D - 0.15, -Wd + 0.2, -Wd + 0.45, zc - 0.3, zc)
    block(Wo, P, -D + 0.2, D - 0.15, Wd - 0.45, Wd - 0.2, zc - 0.3, zc)
    block(Wo, P, D - 0.45, D - 0.15, -Wd + 0.2, Wd - 0.2, zc - 0.3, zc)
    block(Wo, P, -D + 0.2, -D + 0.5, -Wd + 0.2, Wd - 0.2, zc - 0.3, zc)
    # the veranda's railing between the front columns, gaps at the steps; brackets under the eaves
    for v0, v1 in zip(vs, vs[1:]) if ver else ():
        if v0 < 1.2 and v1 > -1.2:
            continue
        block(Wo, P, D - 0.36, D - 0.24, v0 + 0.15, v1 - 0.15, zb + 0.62, zb + 0.72)
        for vv in np.arange(v0 + 0.3, v1 - 0.2, 0.22):
            slab_at(Lt, P, D - 0.3, vv, 0.05, 0.05, zb, zb + 0.62)
    for v in vs:
        K("go_wood").box(P(D - 0.3, v, zc - 0.25), P(D + 0.6, v, zc + 0.15), 0.12, 0.18)
    # the roof: hip-and-gable, its ridge along v, the eaves 0.9 m out; grey tiles in courses
    ov = 0.9
    Eu, Ev = D + ov, Wd + ov
    zr0 = zc + 0.25
    H = min(top_m - (zr0 - z0) - 0.4, 0.42 * min(D, Wd) * 2) * scale   # the main ridge (and its cap) at PLATEAU's height
    zr = lambda d: zr0 + H * min(max(d / Eu, 0.0), 1.0) ** 1.35
    d_g = Eu * 0.62 ** (1 / 1.35)
    Vg = Ev - d_g
    R, Rg = K("go_tile"), K("go_ridge")
    us_ = np.linspace(-Eu, Eu, 15)
    lift = lambda v: 0.32 * max(0.0, (abs(v) - Vg) / max(Ev - Vg, 1e-6)) ** 2   # the eaves curl up at the corners
    R.grid([[P(u, v, zr(Eu - abs(u)) + lift(v) * (1 - (Eu - abs(u)) / Eu)) for v in np.linspace(-Vg, Vg, 9)] for u in us_])
    for sv in (-1, 1):
        rows = []
        for u in us_:
            d = Eu - abs(u)
            rows.append([P(u, sv * v, zr(min(d, Ev - v, d_g)) + lift(v) * (1 - min(d, Ev - v) / Eu)) for v in np.linspace(Vg, Ev, 5)])
        if sv > 0:
            rows = [r[::-1] for r in rows]
        R.grid(rows)
        zg = zr(d_g)
        uu = [u for u in us_ if Eu - abs(u) >= d_g - 1e-6]
        for a, b in zip(uu, uu[1:]):  # the gable, plastered, set in where the hip stops
            K("go_wall", "gable").quad(P(a, sv * Vg, zg), P(b, sv * Vg, zg), P(b, sv * Vg, zr(Eu - abs(b))), P(a, sv * Vg, zr(Eu - abs(a))))
    for k in np.linspace(-Vg, Vg, 18):   # tile courses: ribs down the long slopes
        for su in (-1, 1):
            Rg.box(P(su * Eu, k, zr(0) + 0.04), P(su * (Eu - d_g * 0.98), k, zr(d_g) + 0.04), 0.07, 0.06)
    # the eaves' underside back to the walls
    S = K("go_wood", "soffit")
    e = [P(su * Eu, sv * Ev, zr0 + lift(Ev) * 0.0) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    wl = [P(su * (D - 0.2), sv * (Wd - 0.2), zc) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for i in range(4):
        j = (i + 1) % 4
        S.quad(e[j] + [0, 0, -0.08], e[i] + [0, 0, -0.08], wl[i], wl[j])
        S.quad(e[i] + [0, 0, -0.18], e[j] + [0, 0, -0.18], e[j], e[i])
    # the main ridge: sagging a little in the middle, sweeping up at the ends into forked swallowtails
    zt = zr0 + H
    vr = np.linspace(-Vg - 0.6, Vg + 0.6, 21)
    sag = lambda v: zt + 0.12 - 0.12 * (1 - (v / (Vg + 0.6)) ** 2) + 0.55 * (abs(v) / (Vg + 0.6)) ** 6
    Rg.sweep([P(0, v, sag(v)) for v in vr], [(-0.2, -0.1), (0.2, -0.1), (0.16, 0.38), (-0.16, 0.38)])
    for sv in (-1, 1):
        for fork in (-1, 1):
            base = P(0, sv * (Vg + 0.6), sag(Vg + 0.6) + 0.25)
            tip = P(fork * 0.28, sv * (Vg + 1.3), sag(Vg + 0.6) + 0.85)
            Rg.box(base, tip, 0.12, 0.1)
        for su in (-1, 1):  # the hip ridges, curling up at the corners
            p0 = P(su * (Eu - d_g), sv * Vg, zr(d_g) + 0.08)
            pm = P(su * (Eu - 0.35), sv * (Ev - 0.35), zr(0.35) + 0.16)
            p1 = P(su * (Eu + 0.15), sv * (Ev + 0.15), zr(0) + lift(Ev) + 0.55)
            Rg.tube([p0, pm, p1], [0.11, 0.1, 0.06], 6)


# ---------------------------------------------------------------- the ponds

def ponds(K, ps):
    """Each pond a flat sheet of water at its shore's height, and a dark bank just under it."""
    for p in ps:
        q = np.asarray(p["ring"], float)
        if len(q) < 3:
            continue
        z = p["z"]
        m = K("sk_pond")
        for a, b, c in earcut(q):
            m.tri([*q[a], z], [*q[b], z], [*q[c], z])


# ---------------------------------------------------------------- the Shinanomachi footbridge

def openings(fb, a, f, L, hw):
    """Where the flights leave the deck segment a + f t (t in 0..L): (t0, t1, side) gaps in its railing."""
    out = []
    for fl in fb["flights"]:
        d = np.array(fl["top"]) - a
        t = float(d @ f)
        if -0.5 <= t <= L + 0.5 and abs(float(d @ left_of(f))) < 0.6:
            side = 1 if float(np.array(fl["axis"]) @ left_of(f)) > 0 else -1
            out.append((t - STAIR_HW - 0.1, t + STAIR_HW + 0.1, side))
    return out


def spans(t0, t1, cuts):
    """[t0, t1] less the cuts (a0, a1): the pieces left."""
    out, a = [], t0
    for c0, c1 in sorted(cuts):
        if c1 <= a or c0 >= t1:
            continue
        if c0 > a:
            out.append((a, c0))
        a = max(a, c1)
    if a < t1:
        out.append((a, t1))
    return out


def footbridge_meshes(K, fb):
    """Girder, deck and railings along the line, open where the flights leave it, piers at each node and every
    12 m, lamps on the rails; the flights of steps with stringers, treads, risers and handrails."""
    z, hw = fb["z"], fb["width_m"] / 2
    pts = [np.array(p) for p in fb["deck"]]
    # the deck and all on it are walked on as its strips (game_surfaces: mesh "shinkai_deck"): the game's 2 m
    # collision cells would otherwise take the railings for a wall across the deck; the piers stay solid
    G, Dk, Rl = K("fb_girder", "deck"), K("fb_deck", "deck"), K("fb_rail", "deck")
    for a, b in zip(pts, pts[1:]):
        f = unit(b - a)
        L = float(np.linalg.norm(b - a))
        if L < 0.05:
            continue
        P = frame(a, f)
        block(G, P, -0.15, L + 0.15, -hw - 0.1, hw + 0.1, z - 0.95, z - 0.05)
        block(Dk, P, -0.15, L + 0.15, -hw, hw, z - 0.05, z)
        gaps = openings(fb, a, f, L, hw)
        for sv in (-1, 1):
            vv = sv * (hw - 0.04)
            for t0, t1 in spans(-0.15, L + 0.15, [(g0, g1) for g0, g1, side in gaps if side == sv]):
                block(G, P, t0, t1, sv * hw - 0.06 * (sv < 0), sv * hw + 0.06 * (sv > 0), z - 0.05, z + 0.12)
                Rl.box(P(t0, vv, z + 1.15), P(t1, vv, z + 1.15), 0.08, 0.05)
                Rl.box(P(t0, vv, z + 0.2), P(t1, vv, z + 0.2), 0.05, 0.04)
                for t in np.arange(t0, t1 + 0.01, 0.12):
                    Rl.box(P(t, vv, z + 0.12), P(t, vv, z + 1.12), 0.018, 0.018)
                for t in np.arange(t0 + 1.5, t1, 6.0):
                    slab_at(K("fb_lamp", "deck"), P, t, sv * (hw - 0.1), 0.3, 0.06, z + 1.04, z + 1.1)
    zg = min(f["z_foot"] for f in fb["flights"]) if fb["flights"] else z - DECK_CLEAR_M
    piers = list(pts)
    for a, b in zip(pts, pts[1:]):
        L = float(np.linalg.norm(b - a))
        piers += [a + (b - a) * t for t in np.arange(12.0, L - 4.0, 12.0) / max(L, 1e-6)]
    for p in piers:
        lathe_at(K("fb_girder"), p[0], p[1], [(zg - 0.5, 0.32), (z - 0.95, 0.3)], 12)
    for fl in fb["flights"]:
        flight(K, fl, z, hw)


STAIR_HW = 0.9


def stair_profile(z_top, z_foot, length, start=0.0):
    """(u, z) along a flight from its top (the deck's centreline): level to start (the deck's edge), then treads
    of 0.3 m and risers of up to 0.16 m, with a landing half way."""
    rise = z_top - z_foot
    n = max(2, int(math.ceil(rise / 0.16)))
    run = 0.3 * n
    land = max(0.0, min(1.6, length - start - run))
    half = n // 2
    prof = [(0.0, z_top), (start, z_top)] if start > 0 else [(0.0, z_top)]
    u, zz = start, z_top
    for k in range(n):
        if k == half and land > 0.4:
            u += land
            prof.append((u, zz))
        zz -= rise / n
        prof.append((u, zz))
        u += 0.3
        prof.append((u, zz))
    return prof


def flight(K, fl, z_top, deck_hw):
    P = frame(fl["top"], fl["axis"])
    hw = STAIR_HW
    prof = stair_profile(z_top, fl["z_foot"], fl["length_m"], deck_hw)
    # all of it is walked on as the strip (game_surfaces: mesh "shinkai_steps"), as the 男坂 is: in the game's 2 m
    # collision cells its stringers and rails would stand across the treads
    St, Rs, G, Rl = K("fb_deck", "steps"), K("fb_girder", "steps"), K("fb_girder", "steps"), K("fb_rail", "steps")
    for (u0, z0), (u1, z1) in zip(prof, prof[1:]):
        if u0 < deck_hw - 0.01:
            continue                                 # on the deck
        if abs(z1 - z0) < 1e-6 and u1 > u0:         # a tread (or the landing)
            block(St, P, u0, u1, -hw, hw, z0 - 0.06, z0)
        elif u1 == u0:                               # a riser
            block(Rs, P, u0 - 0.01, u0 + 0.01, -hw, hw, z1, z0)
    end = prof[-1][0]
    steps = [(u, zz) for u, zz in prof if u >= deck_hw - 0.01]
    for sv in (-1, 1):
        path = [P(u, sv * hw, zz) for u, zz in steps[::2]] + [P(end, sv * hw, prof[-1][1])]
        G.sweep(path, [(-0.04, -0.35), (0.04, -0.35), (0.04, 0.08), (-0.04, 0.08)])
        rail = [p + np.array([0, 0, 0.95]) for p in path]
        Rl.tube(rail, 0.025, 6)
        for k in range(0, len(path), 3):
            Rl.box(path[k], rail[k], 0.03, 0.03)


# ---------------------------------------------------------------- meshes, glows, walkable surfaces

def meshes(lm):
    s = lm.get("shinkai")
    if not s:
        return []
    rng = np.random.default_rng(13)
    K = Kit("shinkai", MATERIALS, floodlit=("fb_lamp", "go_glow"))
    if s.get("ponds"):
        ponds(K, s["ponds"])
    if "azumaya" in s:
        azumaya(K, s["azumaya"])
    if "trellis" in s:
        trellis(K, s["trellis"], rng)
    if "goryotei" in s:
        goryotei(K, s["goryotei"])
    if "footbridge" in s:
        footbridge_meshes(K, s["footbridge"])
    return K.meshes()


def glows(lm):
    """The footbridge's rail lamps on the deck after dark."""
    fb = (lm.get("shinkai") or {}).get("footbridge")
    if not fb:
        return []
    m = fb["deck"][len(fb["deck"]) // 2]
    return [[m[0], m[1], 14, "#fff1d0", 0.5]]


def riser_spread(prof, d=0.02):
    """A stepped profile with each riser leant d metres forward, so that u always grows (strip heights interpolate in u)."""
    out = []
    for u, z in prof:
        if out and u <= out[-1][0]:
            u = out[-1][0] + d
        out.append([round(u, 3), round(z, 3)])
    return out


def surfaces(lm):
    """The footbridge's deck and flights as walkable strips (game_data.py game_surfaces)."""
    fb = (lm.get("shinkai") or {}).get("footbridge")
    out = []
    if not fb:
        return out
    pts = [np.array(p) for p in fb["deck"]]
    for k, (a, b) in enumerate(zip(pts, pts[1:])):
        L = float(np.linalg.norm(b - a))
        if L < 0.5:
            continue
        out.append({"name": f"Shinanomachi footbridge {k + 1}", "type": "strip", "origin": rnd(a), "axis": rnd(unit(b - a), 4),
                    "half_width": fb["width_m"] / 2 + 0.3, "profile": [[-0.4, fb["z"]], [round(L + 0.4, 2), fb["z"]]],
                    "thickness": 1.0, "mesh": "shinkai_deck", "label": "the footbridge"})
    for fl in fb["flights"]:
        prof = stair_profile(fb["z"], fl["z_foot"], fl["length_m"], fb["width_m"] / 2)
        out.append({"name": f"Shinanomachi footbridge steps {fl['id']}", "type": "strip", "origin": fl["top"], "axis": fl["axis"],
                    "half_width": STAIR_HW + 0.05, "profile": riser_spread(prof) + [[round(prof[-1][0] + 0.6, 2), round(prof[-1][1], 3)]],
                    "thickness": 1.5, "mesh": "shinkai_steps", "drape": True, "label": "the footbridge's steps",
                    "check": True})   # tools/game_check.js climbs it
    return out
