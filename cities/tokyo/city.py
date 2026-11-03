"""Tokyo: what the generic pipeline cannot know from open data.

Building adjustments (called by pipeline/build_scene.py):
  * Tokyo Station Marunouchi building: the brick facade colour (Tatsuno Kingo's 1914 red brick
    and white granite banding, restored 2012). Heights come from PLATEAU like every other
    building here.
  * Tokyo Tower: OSM maps the Foot Town building at its base. The lattice is parametric.

Parametric landmark (called by pipeline/landmarks.py):
  Tokyo Tower  333 m, a square base 80 m a side, main deck at 150 m and top deck at 250 m,
               painted in alternating International Orange and white bands (aviation
               marking rules). The lattice is an approximation of the published outline,
               anchored at the published coordinates of the tower (35.65858 N, 139.74543 E).
  Kabuki-za    the theatre (2013, Kengo Kuma, after Yoshida Isoya's 1951 front) on its outline from
               OpenStreetMap (cities/tokyo/kabukiza_osm.json): the auditorium block, and on Harumi-dori (its
               south-west side) the front of two storeys under grey tiles: the great central gable facing the street over
               the cusped karahafu porch, the side roofs, white plaster, vermilion railings and lattices,
               and the row of red lanterns. OSM records the theatre at the 141 m of the tower behind it;
               the tower (歌舞伎座タワー) stays a building.
"""
import math

import numpy as np

import archkit as ak
from meshkit import Mesh

TOWER_LL = (139.745433, 35.658581)
TOWER = {"height": 333.0, "base": 80.0, "main_deck": 150.0, "top_deck": 250.0, "antenna_from": 255.0}
STATION = "東京駅丸の内駅舎"
FOOT_TOWN = "東京タワー"
# after dark Motoko Ishii's "Landmark Light" (1989): floodlights at the foot and on the main deck
# light the whole lattice, orange from high-pressure sodium lamps from October to early July and
# white from metal halide ones in summer ("emissive_dates"); the decks' windows are lit (emissive,
# glow; "flood" is set from the tower's ground in landmark_meshes)
SUMMER = ("07-07", "10-01")
MATERIALS = {
    "orange": {"color": "#e8541c", "roughness": 0.55, "metalness": 0.35, "emissive": "#ff8f40", "glow": 0.95,
               "emissive_dates": [[*SUMMER, "#ffc9a6"]]},
    "white": {"color": "#f1efe9", "roughness": 0.55, "metalness": 0.3, "emissive": "#ffc27a", "glow": 0.85,
              "emissive_dates": [[*SUMMER, "#f3f1ff"]]},
    "deck": {"color": "#c9c6bd", "roughness": 0.6, "metalness": 0.2, "emissive": "#ffd29a", "glow": 0.6},
    "glass": {"color": "#2a3138", "roughness": 0.1, "metalness": 0.6, "emissive": "#ffe2b4", "glow": 0.45},
    # Kabuki-za
    "kz_plaster": {"color": "#efebe2", "roughness": 0.8, "metalness": 0.0, "emissive": "#fff0dc", "glow": 0.55},
    "kz_tile": {"color": "#4f5458", "roughness": 0.55, "metalness": 0.15, "pattern": "roof_tiles", "bay_m": 0.28, "course_m": 0.28},
    "kz_ridge": {"color": "#393d40", "roughness": 0.55, "metalness": 0.15},
    "kz_red": {"color": "#a8382b", "roughness": 0.6, "metalness": 0.0, "emissive": "#ff6a3c", "glow": 0.4},
    "kz_timber": {"color": "#4b372a", "roughness": 0.8, "metalness": 0.0},
    "kz_stone": {"color": "#a7a196", "roughness": 0.9, "metalness": 0.0},
    "kz_gold": {"color": "#d4a63c", "roughness": 0.3, "metalness": 0.85, "emissive": "#ffc94a", "glow": 0.7},
    "kz_lantern": {"color": "#d9412e", "roughness": 0.6, "metalness": 0.0, "emissive": "#ff7a3a", "glow": 1.4},
    "kz_glass": {"color": "#2c3036", "roughness": 0.2, "metalness": 0.4, "emissive": "#ffd9a8", "glow": 0.5},
}


def adjust_building(b, cls, g, geoms, ctx):
    x, y = ctx.city.fwd.transform(*TOWER_LL)
    near = math.hypot(g.centroid.x - x, g.centroid.y - y) < 60
    if near and b["name"] != FOOT_TOWN:
        return []  # the observatories and the lattice: the parametric mesh stands for them
    if b["name"] == STATION:
        b["facade_color"] = "#9c4f3c"  # red brick; the roofs are slate and the colour here is read as walls
    if b["name"] == FOOT_TOWN:
        # the OSM polygon is the tower's Foot Town podium; keep it, and build the lattice above it
        e = g.minimum_rotated_rectangle.exterior.coords
        cs = np.asarray(e)[:4]
        long_axis = cs[1] - cs[0] if np.linalg.norm(cs[1] - cs[0]) > np.linalg.norm(cs[2] - cs[1]) else cs[2] - cs[1]
        ctx.landmarks["tokyo_tower"] = {"centre": [round(float(x), 1), round(float(y), 1)], "axis_deg": round(math.degrees(math.atan2(long_axis[1], long_axis[0])) % 90, 2),
                                        "ground_m": round(ctx.ground(x, y), 1), **TOWER}
        # OSM tags the whole 333 m on the Foot Town polygon; the podium is a low block (four storeys),
        # and the lattice above it is the landmark mesh.
        return [[q, 0.0, 18.0, "parametric", None] for q in ctx.polygons(g)]
    return geoms


def finalize(ctx):
    t = ctx.landmarks.get("tokyo_tower")
    if t:
        ctx.labels["Tokyo Tower 東京タワー"] = [t["centre"][0], t["centre"][1], round(t["ground_m"] + t["height"] + 6, 1)]


# ---------------------------------------------------------------- Tokyo Tower

def leg_x(z, base, top_half=4.0, top_z=250.0):
    """Half-width of the lattice at height z: an exponential-ish taper from the base to the top deck."""
    s = min(max(z / top_z, 0.0), 1.0)
    return top_half + (base / 2 - top_half) * (1 - s) ** 1.7


def tower(t):
    gz = t["ground_m"]
    cx, cy = t["centre"]
    a = math.radians(t["axis_deg"])
    R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    P = lambda x, y, z: (float(cx + R[0, 0] * x + R[0, 1] * y), float(cy + R[1, 0] * x + R[1, 1] * y), float(gz + z))
    # horizontal levels of the lattice, each a bay; bands of orange and white every few bays
    zs = [0, 12, 26, 42, 60, 80, 102, 126, 150, 176, 202, 226, 250]
    meshes = {"orange": Mesh("tower_orange", "orange", False, floodlit=True), "white": Mesh("tower_white", "white", False, floodlit=True)}
    band = lambda z: "white" if int(z // 37.5) % 2 else "orange"
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for lo, hi in zip(zs[:-1], zs[1:]):
        m = meshes[band((lo + hi) / 2)]
        h0, h1 = leg_x(lo, t["base"]), leg_x(hi, t["base"])
        w = max(0.9, 3.4 * (1 - lo / 250.0) + 0.9)
        for k in range(4):
            (sx, sy), (tx, ty) = corners[k], corners[(k + 1) % 4]
            # corner legs
            m.box(P(sx * h0, sy * h0, lo), P(sx * h1, sy * h1, hi), w, w)
            # cross-bracing on the face between corner k and k+1: an X in each bay, and a ring beam at the top
            m.box(P(sx * h0, sy * h0, lo), P(tx * h1, ty * h1, hi), w * 0.45, w * 0.45)
            m.box(P(tx * h0, ty * h0, lo), P(sx * h1, sy * h1, hi), w * 0.45, w * 0.45)
            m.box(P(sx * h1, sy * h1, hi), P(tx * h1, ty * h1, hi), w * 0.6, w * 0.6)
    deck = Mesh("tower_decks", "deck", False, floodlit=True)
    glass = Mesh("tower_glass", "glass", False, floodlit=True)
    for z0, z1, hw in ((140.0, 150.0, 13.0), (239.0, 250.0, 7.0)):
        deck.box(P(0, 0, z0), P(0, 0, z0 + 2), 2 * hw + 3, 2 * hw + 3)
        glass.box(P(0, 0, z0 + 2), P(0, 0, z1), 2 * hw, 2 * hw)
        deck.box(P(0, 0, z1), P(0, 0, z1 + 1.2), 2 * hw + 2, 2 * hw + 2)
    ant = meshes["orange"]
    # antenna mast: a tapering mast above the top deck, banded to the tip
    for lo, hi, w in ((250, 270, 5.0), (270, 290, 3.8), (290, 310, 2.8), (310, 333, 1.6)):
        (meshes["white"] if int(lo // 20) % 2 else ant).box(P(0, 0, lo), P(0, 0, hi), w, w)
    return [*meshes.values(), deck, glass]


def landmark_meshes(scene):
    t = scene["landmarks"].get("tokyo_tower")
    mats = {k: dict(v) for k, v in MATERIALS.items()}
    if t:
        for k in ("orange", "white", "deck"):
            mats[k]["flood"] = [round(t["ground_m"], 1), round(t["ground_m"] + TOWER["height"], 1), 0.5, 0.5]
    meshes, hidden = kabukiza()
    return mats, (tower(t) if t else []) + meshes, {"hidden": hidden}


KABUKIZA = "r4859313"
FRONT_DEG = 215.0  # the front's compass bearing, onto Harumi-dori


KZ_STEP = 0.6       # the front's stone plinth over the pavement, stepped onto (web/game/nav.js floorAt)
KZ_FRONT = {}       # the front's frame, as kabukiza() lays it out (for game_extras)


def kabukiza():
    import json
    import os
    from shapely.geometry import Polygon
    import cityctx
    C = cityctx.City("tokyo")
    osm = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "kabukiza_osm.json")))
    loc = lambda pts: [C.fwd.transform(lon, lat) for lon, lat in pts]
    site, tower_p, front = (Polygon(loc(osm[k])).buffer(0) for k in ("site", "tower", "front"))
    solids = [s for s in ak.load_solids("tokyo") if s["osm"] == KABUKIZA]
    if not solids:
        return [], []
    g = min(s["ground"] for s in solids)
    K = ak.Kit("kabukiza", floodlit={"kz_plaster", "kz_red", "kz_gold", "kz_lantern", "kz_glass"}, uv={"kz_tile"})
    mats = {"base": "kz_stone", "post": "kz_red", "wall": "kz_plaster", "bracket": "kz_timber", "roof": "kz_tile", "ridge": "kz_ridge", "gable": "kz_plaster"}
    # the front faces Harumi-dori (south-west, 215 degrees, as city.json's arrival): a 12 m deep strip along the
    # site's edge there, u along the street, v out to it
    n = np.array([math.sin(math.radians(FRONT_DEG)), math.cos(math.radians(FRONT_DEG))])
    pts = np.asarray(site.exterior.coords)
    reach = pts @ n
    edge = pts[reach > reach.max() - 14.0]
    t = np.array([n[1], -n[0]])
    along = edge @ t
    W = 12.0
    L = float(along.max() - along.min())
    mid = t * (along.max() + along.min()) / 2 + n * (reach.max() - W / 2)
    ax = math.degrees(math.atan2(-n[0], n[1]))
    F = ak.Frame(mid[0], mid[1], ax, g)
    front = Polygon([F(u, v, 0)[:2] for u, v in ak.rect(-L / 2, L / 2, -W / 2, W / 2)])
    # the auditorium: the site less the tower and the front, to its roof garden (lower than the front's roofs)
    body = site.difference(tower_p.buffer(0.5)).difference(front.buffer(-0.5))
    for poly in getattr(body, "geoms", [body]):
        if poly.area > 40:
            ring = ak.simplify(list(poly.exterior.coords), 0.5)
            ak.prism(K["kz_plaster"], ak.WORLD, ring, g, g + 17.0, top=False)
            ak.cap(K["kz_ridge"], ak.WORLD, ring, g + 17.0)  # the roof garden's deck
            ak.cornice(K["kz_ridge"], ak.WORLD, ring, g + 16.0, ((0, 0), (0.6, 0.3), (1.2, 0.8), (1.2, 1.0), (0, 1.0)))
    hl = L / 2
    vf = W / 2  # the street face
    vb = -W / 2
    # ground floor: the arcade of the entrances, its glass, the stone plinth (one low step from the pavement,
    # so people walk in under the porch to the doors); the first eaves (tiles) at 8.5 m
    ak.block(K["kz_stone"], F, -hl, hl, vb, vf, 0.0, KZ_STEP)
    ak.block(K["kz_plaster"], F, -hl, hl, vb, vf - 1.5, KZ_STEP, 15.5, top=False)
    us = np.linspace(-hl + 3, hl - 3, 13)
    for u in us:
        # (the wall run from +u to -u, so that the street is on its right: archkit draws openings there)
        ak.opening(K["kz_glass"], F, (hl, vf - 1.5 + 0.02), (-hl, vf - 1.5 + 0.02), KZ_STEP, 3.2, 4.6, centre=hl - u)
    for u in (us[:-1] + us[1:]) / 2:                 # the arcade's posts between the doors, none in front of one
        x, y, z = F(u, vf - 0.4, KZ_STEP)
        K["kz_red"].lathe([(z, 0.3), (z + 8.2 - KZ_STEP, 0.3)], (x, y), segs=6)
    ak.irimoya(K, ak.Frame(*F(0, vf - 3.0, 0)[:2], ax, g), L + 1.0, 5.0, 8.4, 1.8, over=2.2, lift=0.4,
               mats=("kz_tile", "kz_ridge", "kz_plaster"), gable_frac=1.0, sag=0.06)
    # the lanterns under the first eaves
    for u in np.linspace(-hl + 2, hl - 2, 22):
        x, y, z = F(u, vf + 0.6, 6.4)
        K["kz_lantern"].lathe([(z, 0.25), (z + 0.2, 0.45), (z + 1.0, 0.48), (z + 1.3, 0.25)], (x, y), segs=8)
    # the upper storey: vermilion railings and lattices, white plaster, the side roofs
    ak.balustrade(K["kz_red"], F, [(-hl + 1, vf - 1.6), (hl - 1, vf - 1.6)], 10.4, h=1.1)
    for u in np.linspace(-hl + 4, hl - 4, 9):
        ak.opening(K["kz_red"], F, (hl, vf - 1.48), (-hl, vf - 1.48), 11.8, 2.6, 2.8, centre=hl - u)
    side = L * 0.3
    for sgn in (-1, 1):
        uc = sgn * (hl - side / 2)
        Q = ak.Frame(*F(uc, -1.0, 0)[:2], ax, g)
        ak.irimoya(K, Q, side, W + 2.0, 15.5, 5.0, over=2.2, lift=0.8, mats=("kz_tile", "kz_ridge", "kz_plaster"), gable_frac=0.5, sag=0.15)
    # the great central roof, its gable to the street (its ridge runs back from the front), on a taller body
    cw = L * 0.34
    ak.block(K["kz_plaster"], F, -cw / 2, cw / 2, vb - 8.0, vf - 1.5, 15.5, 19.0, top=False)
    G = ak.Frame(*F(0, (vb - 8.0 + vf) / 2 - 0.5, 0)[:2], (ax) + 90.0, g)
    ak.irimoya(K, G, (vf - vb) + 8.0, cw, 19.0, 9.5, over=2.6, lift=1.2, mats=("kz_tile", "kz_ridge", "kz_plaster"), gable_frac=0.42, sag=0.2)
    gold = K["kz_gold"]
    gold.box(F(0, vf + 2.2, 24.2), F(0, vf + 2.2, 26.6), 1.6, 0.4)  # the gable's ornament (懸魚)
    # the karahafu porch over the main entrance: a cusped gable, rising to a peak and sweeping out at both ends
    pw, pd, z0 = 12.0, 6.0, 8.6
    prof = []
    for k in range(17):
        s_ = -1 + 2 * k / 16
        z = z0 + 3.2 * (math.cos(math.pi * s_ / 2) ** 1.6) + 0.5 * abs(s_) ** 6
        prof.append((s_ * pw / 2, z))
    rows = [[F(u, vf + pd * 0.5, z) for u, z in prof], [F(u, vf - pd * 0.5, z + 0.3) for u, z in prof]]
    K["kz_tile"].grid(rows, [[[u, 0.0] for u, _ in prof], [[u, pd] for u, _ in prof]])
    for v in (vf + pd * 0.5,):
        for (ua, za), (ub, zb) in zip(prof[:-1], prof[1:]):
            gold.box(F(ua, v + 0.1, za - 0.3), F(ub, v + 0.1, zb - 0.3), 0.25, 0.45)
            K["kz_plaster"].tri(F(ua, v, za - 0.3), F(ub, v, zb - 0.3), F(0.0, v, z0 - 0.4))
    for su in (-1, 1):
        x, y, z = F(su * (pw / 2 - 0.6), vf + pd * 0.5 - 0.6, KZ_STEP)
        K["kz_red"].lathe([(z, 0.35), (z + z0 - KZ_STEP, 0.35)], (x, y), segs=8)
    KZ_FRONT.update({"F": F, "vf": vf, "g": g})
    return K.out(), [s["si"] for s in solids]


# ---------------------------------------------------------------- the game

def xy(p):
    return [round(float(p[0]), 2), round(float(p[1]), 2)]


def close_to(name, at, z, start, within=1.5, keep=0.0, on=False):
    """A thing to walk up to (game.json "close", a spot's "reach"): `at` on it at the floor's height z, the walk
    starting at `start`; tools/close_step.js must get within `within` m and never nearer than `keep`, and with `on`, stand on
    that floor (a gate's stone base, a plinth)."""
    return {**({"name": name} if name else {}), "at": [*xy(at), round(float(z), 2)], "from": xy(start), "within": within, **({"keep": keep} if keep else {}), **({"on": True} if on else {})}


def game_extras(scene):
    """The things people walk right up to: Tokyo Tower's four legs, where they meet the ground, and the
    Foot Town doors between them; Kabuki-za's doors under the karahafu porch."""
    close = []
    t = scene["landmarks"].get("tokyo_tower")
    if t:
        cx, cy = t["centre"]
        a = math.radians(t["axis_deg"])
        R = lambda x, y: np.array([cx + math.cos(a) * x - math.sin(a) * y, cy + math.sin(a) * x + math.cos(a) * y])
        from shapely.geometry import LineString, Point, Polygon
        h0 = leg_x(0, t["base"])
        solids = ak.load_solids("tokyo")
        T = ak.Terrain("tokyo")
        blocks = [Polygon(q["ring"]).buffer(0.6) for q in solids if q["base"] == 0 and q["top"] > 0.5 and len(q["ring"]) > 2
                  and Point(cx, cy).distance(Polygon(q["ring"])) < 90]
        for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
            # the leg's foot (tower(): a box 4.3 m square across its corner), its face 2.2 m out from its middle: from out
            # along the diagonal, or the nearest way round to it that no building stands in. The tower stands on
            # Shiba's slope: the floor there is the ground's, up to 4 m above the tower's datum on the north side
            c = R(sx * h0, sy * h0)
            for turn in (0, 1, -1, 2, -2):
                b = math.atan2(*((R(sx, sy) - R(0, 0))[::-1])) + turn * math.pi / 8
                d = np.array([math.cos(b), math.sin(b)])
                path = LineString([c + d * 2.2, c + d * 7.0])
                if not any(path.intersects(g) for g in blocks):
                    break
            # the leg leans in as it rises (leg_x): its outer face at a walker's knees, over the floor there
            zf = T(*(c + d * 2.2))
            for _ in range(2):
                lean = h0 - leg_x(max(zf + 0.4 - t["ground_m"], 0.0), t["base"])
                at = c + d * 2.2 - (R(sx, sy) - R(0, 0)) / math.sqrt(2) * lean * math.sqrt(2)
                zf = T(*at)
            close.append(close_to(f"Tokyo Tower, the foot of leg {k + 1}", at, zf, c + d * 7.0, 1.2))
        foot = [q for q in solids if q["name"] == FOOT_TOWN and q["base"] == 0]
        if foot:
            from shapely.geometry import Point, Polygon
            ring = Polygon(max(foot, key=lambda q: abs(ak.ring_area(q["ring"])))["ring"]).exterior
            mid = (R(h0, h0) + R(h0, -h0)) / 2          # between two legs, under the tower
            q = ring.interpolate(ring.project(Point(*mid)))
            p = np.array([q.x, q.y])
            close.append(close_to("Tokyo Tower, Foot Town under the legs", p, t["ground_m"], p + (mid - p) / np.linalg.norm(mid - p) * 5.0, 1.2))
    if not KZ_FRONT:
        kabukiza()
    if KZ_FRONT:
        F, vf, g = KZ_FRONT["F"], KZ_FRONT["vf"], KZ_FRONT["g"]
        # under the porch to the glass doors of the main entrance (1.5 m in from the street face)
        close.append(close_to("Kabuki-za, the doors under the porch", F(0, vf - 1.5, 0), g + KZ_STEP, F(0, vf + 5.5, 0), 1.0, on=True))
    return {"close": close}
