"""The Philosopher's Path, a map of Kyoto: what the generic pipeline cannot know from open data.

The model is the real district: Overture footprints at Project PLATEAU's surveyed heights on GSI's laser
terrain. This file plants the path's cherries and builds the landmarks on the outlines OpenStreetMap maps
for them (cities/tetsugaku/north_osm.json and south_osm.json, pipeline/osm_detail.py). Sources and what is
approximate: docs/cities/tetsugaku.md.

  * 哲学の道 the Philosopher's Path: the walk along the Lake Biwa Canal's branch (疏水分線) from Ginkaku-ji
    to Nyakuoji, named for the philosopher Nishida Kitaro who walked it; the cherries along it were first
    planted in 1922 by the painter Hashimoto Kansetsu and his wife (関雪桜). A cherry stands every few
    metres along both banks here, as photographs show them.
  * 南禅寺三門 Nanzen-ji's Sanmon (1628): a two-storey gate of five bays and three doors (五間三戸二階二重門),
    about 22 m high, bare timber under tiles, the balcony round its upper storey from which Ishikawa
    Goemon looked out in the kabuki play ("zekkei kana").
  * 水路閣 the aqueduct (1888, Tanabe Sakuro): about 93 m of red brick and granite arches carrying the
    canal's branch through Nanzen-ji's precinct, about 9 m high.
  * 蹴上インクライン the Keage Incline (1891-1948): a 582 m inclined railway that carried the canal's boats
    on cradles up and down the 36 m between the canal's two levels; its rails remain, lined with
    cherries, and a boat (三十石舟) stands on its cradle.
  * 銀閣 Ginkaku, the Kannon-den of Jisho-ji (1489): two storeys, the lower in the shoin manner and the upper
    a Zen hall with bell-shaped windows, under a roof of shingles with a bronze phoenix on its ridge.
"""
import json
import math
import os

import numpy as np

import archkit as ak
import kyotokit as kk
from japankit import block, lathe_at, left_of, unit
from meshkit import Mesh

HERE = os.path.dirname(os.path.abspath(__file__))

MATERIALS = {
    "timber": {"color": "#6b5442", "roughness": 0.82, "metalness": 0.0, "emissive": "#ffc890", "glow": 0.18},
    "timber_dark": {"color": "#4a3a2e", "roughness": 0.85, "metalness": 0.0},
    "plaster": {"color": "#ece6d8", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffe2bc", "glow": 0.15},
    "kawara": {"color": "#5b5f63", "roughness": 0.6, "metalness": 0.1, "pattern": "roof_tiles", "bay_m": 0.3, "course_m": 0.3},
    "kawara_ridge": {"color": "#43474a", "roughness": 0.6, "metalness": 0.1},
    "kokera": {"color": "#5e4c3e", "roughness": 0.92, "metalness": 0.0, "pattern": "roof_tiles", "bay_m": 0.08, "course_m": 0.1},
    "kokera_ridge": {"color": "#46382d", "roughness": 0.9, "metalness": 0.0},
    "soffit_wood": {"color": "#5d4a3c", "roughness": 0.85, "metalness": 0.0},
    "stone": {"color": "#9c968b", "roughness": 0.92, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.45, "block_m": 0.9},
    "lattice": {"color": "#3b2d24", "roughness": 0.8, "metalness": 0.0},
    "bracket": {"color": "#54443a", "roughness": 0.85, "metalness": 0.0},
    "bronze": {"color": "#6d5a36", "roughness": 0.4, "metalness": 0.8},
    # the aqueduct's red brick in English bond, its granite springers and coping
    "brick": {"color": "#87492f", "roughness": 0.9, "metalness": 0.0},
    "granite": {"color": "#a9a398", "roughness": 0.9, "metalness": 0.0},
    "rail": {"color": "#4a4440", "roughness": 0.5, "metalness": 0.7},
    "sleeper": {"color": "#5a4a3c", "roughness": 0.9, "metalness": 0.0},
    "boat": {"color": "#7a6450", "roughness": 0.85, "metalness": 0.0},
    # Honen-in's thatch: miscanthus gone grey-brown, moss in it, under a ridge of cedar bark
    "thatch": {"color": "#6b5f48", "roughness": 0.98, "metalness": 0.0, "pattern": "roof_tiles", "bay_m": 0.05, "course_m": 0.07},
    "thatch_under": {"color": "#4f4334", "roughness": 0.98, "metalness": 0.0},
    "thatch_ridge": {"color": "#3c332b", "roughness": 0.95, "metalness": 0.0},
    "moss": {"color": "#4f5a37", "roughness": 0.98, "metalness": 0.0},
    # Eikan-do: copper on the Tahoto's finial, white plaster on its round body
    "copper": {"color": "#4f7a68", "roughness": 0.55, "metalness": 0.5},
}
BARE = {"post": "timber", "wall": "plaster", "roof": "kawara", "soffit": "soffit_wood", "gable": "timber_dark", "ridge": "kawara_ridge",
        "base": "stone", "bracket": "bracket", "wood": "timber", "metal": "bronze", "gold": "bronze", "screen": "lattice",
        "screen_wood": "lattice", "nio": "timber"}
SHINGLE = dict(BARE, roof="kokera", ridge="kokera_ridge")
EIKAN = dict(BARE, screen_wood="timber")  # Eikan-do's fronts: doors of bare keyaki between the posts

SANMON, AQUEDUCT, INCLINE = "w190876301", 190871337, (378872665, 378872666)
SANMON_H = 22.0          # m to the ridge (the temple)
AQUEDUCT_H = 9.0         # m, the arches' top over the ground at its middle
AQUEDUCT_SPAN = 4.5      # m between piers (photographs: 13 arches over its mapped length)
GINKAKU = ("銀閣", 10.5)  # the Kannon-den's mapped name and height to its ridge (estimated from photographs)
# Eikan-do (Zenrin-ji): OSM way, height to the ridge (m), the floor's height over the ground. PLATEAU's tops are
# 16.7 m for the Miei-do and 9.2 m for the Shaka-do; its 25.1 m for the Amida-do is measured from the foot of
# its slope, and its 12.0 m for the Tahoto is the trees round it (docs/cities/tetsugaku.md)
MIEIDO = ("w292177629", 16.7, 1.2)     # 御影堂 (1912), the main hall: Honen's image
AMIDADO = ("w292177632", 13.5, 1.0)    # 阿弥陀堂 (1597, moved from Osaka 1607): the Mikaeri Amida
SHAKADO = ("w858269694", 9.2, 0.8)     # 釈迦堂 (1530s), the abbot's hall
TAHOTO = ("w291548888", 15.0)          # 多宝塔 (1928), on the hill above the halls
HONEN_GATE = ("w684381908", 5.4)       # 法然院 山門, thatched (茅葺); 5.4 m to the ridge (PLATEAU's 19.8 m is the trees over it)

_cache = {}


def ctx():
    if "C" not in _cache:
        import cityctx
        _cache["C"] = cityctx.City("tetsugaku")
        _cache["T"] = ak.Terrain("tetsugaku")
        _cache["S"] = ak.load_solids("tetsugaku")
        osm = {"nodes": [], "ways": []}
        for f in ("north", "south"):
            o = json.load(open(os.path.join(HERE, f"{f}_osm.json")))
            osm["nodes"] += o["nodes"]
            osm["ways"] += o["ways"]
        _cache["osm"] = osm
    return _cache["C"], _cache["T"], _cache["S"], _cache["osm"]


def local(ll):
    return np.array(ctx()[0].fwd.transform(*ll))


def way(wid):
    return next((w for w in ctx()[3]["ways"] if w["id"] == wid), None)


def solid_of(oid=None, name=None):
    _, _, S, _ = ctx()
    got = [sd for sd in S if (oid and sd["osm"] == oid) or (name and sd.get("name") == name)]
    return max(got, key=lambda sd: abs(ak.ring_area(sd["ring"]))) if got else None


# ---------------------------------------------------------------- the path and its cherries

BRIDGE_M = 160.0  # the longest gap between two named pieces of the path that is joined along the ways between them


def path_bridges():
    """The stretches of the path OpenStreetMap does not name: where the walk is mapped as an unnamed service
    lane or footway between two named pieces (south of Honen-in, by Otoyo-jinja and on to Nyakuoji), the
    shortest way along the mapped ways from the end of one named piece to the start of the next, when it is
    under BRIDGE_M and no more than 1.6 times the straight line. [[node, ...], ...] as lists of points."""
    ways = ctx()[3]["ways"]
    named = [w for w in ways if w["tags"].get("name", "").startswith("哲学の道") and len(w["nodes"]) > 1]
    walk = {"footway", "path", "pedestrian", "service", "living_street", "residential", "unclassified", "track"}
    pos, adj = {}, {}
    for w in ways:
        if w["tags"].get("highway") not in walk or len(w["nodes"]) < 2:
            continue
        for n, q in zip(w["nodes"], w["ll"]):
            pos[n] = local(q)
        for a, b in zip(w["nodes"], w["nodes"][1:]):
            d = float(np.linalg.norm(pos[a] - pos[b]))
            adj.setdefault(a, []).append((b, d))
            adj.setdefault(b, []).append((a, d))
    named_nodes = {n for w in named for n in w["nodes"]}
    # the pieces' ends: a node of a named way at one end only (not shared with another named way)
    count = {}
    for w in named:
        for n in (w["nodes"][0], w["nodes"][-1]):
            count[n] = count.get(n, 0) + 1
    ends = [n for n, c in count.items() if c == 1 and n in pos]
    piece = {}
    for w in named:  # which piece (connected run of named ways) each end belongs to
        for n in w["nodes"]:
            piece.setdefault(n, set()).add(w["id"])
    parent = {w["id"]: w["id"] for w in named}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for n, ids in piece.items():
        ids = list(ids)
        for i in ids[1:]:
            parent[find(i)] = find(ids[0])
    group = {n: find(next(iter(piece[n]))) for n in ends}
    import heapq
    out, seen = [], set()
    for a in ends:
        best = {a: 0.0}
        prev = {}
        h = [(0.0, a)]
        while h:
            d, u = heapq.heappop(h)
            if d > best.get(u, 1e18) or d > BRIDGE_M:
                continue
            if u != a and u in group and group[u] != group[a]:
                straight = float(np.linalg.norm(pos[u] - pos[a]))
                key = tuple(sorted((a, u)))
                if key not in seen and d <= 1.6 * max(straight, 1.0):
                    seen.add(key)
                    route = [u]
                    while route[-1] != a:
                        route.append(prev[route[-1]])
                    out.append([pos[n] for n in route[::-1]])
                break
            for v, dv in adj.get(u, []):
                if v in named_nodes and v not in group:
                    continue  # (along the named path itself: that is not a gap)
                nd = d + dv
                if nd < best.get(v, 1e18):
                    best[v], prev[v] = nd, u
                    heapq.heappush(h, (nd, v))
    return out


def path_lines():
    """The Philosopher's Path as OpenStreetMap names it, in pieces, with the stretches between them it does
    not name (path_bridges), in the local frame."""
    if "path" not in _cache:
        from shapely.geometry import LineString
        from shapely.ops import linemerge
        lines = [LineString([local(q) for q in w["ll"]]) for w in ctx()[3]["ways"]
                 if w["tags"].get("name", "").startswith("哲学の道") and len(w["ll"]) > 1]
        lines += [LineString(b) for b in path_bridges() if len(b) > 1]
        m = linemerge(lines)
        _cache["path"] = [np.asarray(g.coords) for g in getattr(m, "geoms", [m])]
    return _cache["path"]


def cherries(every=4.5, off=2.6):
    """A cherry every `every` m along both banks of the path (photographs: a single row on each side of
    the canal and the walk, about 4 to 5 m apart), [x, y, z, height] in decimetres."""
    C, T, S, _ = ctx()
    rng = np.random.default_rng(1922)
    from shapely.geometry import Point, Polygon
    blocked = [Polygon(sd["ring"]).buffer(0.8) for sd in S if sd["base"] <= 0]
    # and off the carriageways where the path runs along a street: a road's half width and a lane's reach
    from shapely.geometry import LineString
    from shapely.ops import unary_union
    ROADW = {"primary": 6.5, "secondary": 5.5, "tertiary": 4.5, "residential": 3.8, "unclassified": 3.8, "living_street": 2.8, "service": 2.6}
    roads = unary_union([LineString([local(q) for q in w["ll"]]).buffer(ROADW[w["tags"]["highway"]])
                         for w in ctx()[3]["ways"] if w["tags"].get("highway") in ROADW and len(w["ll"]) > 1])
    blocked.append(roads)
    out = []
    for pts in path_lines():
        Q, ss = kk.resample(pts, 0.5)
        for side in (-1, 1):
            s = rng.uniform(0, every)
            while s < ss[-1]:
                i = min(int(np.searchsorted(ss, s)), len(Q) - 1)
                a, b = Q[max(i - 2, 0)], Q[min(i + 2, len(Q) - 1)]
                n = left_of(unit(b - a)) if np.linalg.norm(b - a) > 0.1 else np.array([0.0, 1.0])
                p = Q[i] + n * side * (off + rng.uniform(-0.3, 0.3))
                if not any(q.contains(Point(*p)) for q in blocked):
                    out += [round(p[0] * 10), round(p[1] * 10), round(T(*p) * 10), round(rng.uniform(6.0, 9.5) * 10)]
                s += every * rng.uniform(0.8, 1.25)
    return out


def path_area():
    """The ring round the path the cherries' area covers (city.json trees.areas), in the local frame."""
    from shapely.geometry import LineString
    from shapely.ops import unary_union
    U = unary_union([LineString(p).buffer(7.0) for p in path_lines()]).simplify(1.0)
    return [[[round(x, 1), round(y, 1)] for x, y in q.exterior.coords] for q in getattr(U, "geoms", [U])]


# ---------------------------------------------------------------- Nanzen-ji's Sanmon

def sanmon(K, hidden):
    """A two-storey gate of five bays and three doors: the lower storey's twenty-four posts on a stone
    platform, its brackets and a pent roof all round; the upper storey (the 五鳳楼) on the same posts,
    its balcony and railing, white walls between posts and lattice doors, and its hipped-and-gabled roof."""
    C, T, S, _ = ctx()
    sd = solid_of(SANMON)
    if not sd:
        return
    west = local((135.7880, 35.0113))      # it faces west, toward the approach from the Keage side
    o, f, hu, hv = kk.site(sd["ring"], west)
    P = kk.frame(o, f)
    z0 = float(np.median([T(*P(u, v, 0)[:2]) for u in (-3, 0, 3) for v in (-6, 0, 6)]))
    ground = lambda x, y: T(x, y)
    a, b = min(hu - 2.2, 6.2), min(hv - 2.6, 11.0)          # half depth, half frontage at the posts
    block(K["stone"], P, -a - 1.2, a + 1.2, -b - 1.2, b + 1.2, z0 - 0.8, z0 + 0.5)
    kk.plinth(K, "stone", P, a + 1.2, b + 1.2, z0 + 0.5, ground)
    zb = z0 + 0.5
    us, vs = np.linspace(-a, a, 3), np.linspace(-b, b, 6)
    z1 = zb + 7.2                                            # the lower storey's head
    for u in us:
        for v in vs:
            x, y, _ = P(u, v, 0)
            kk.post(K, "timber", x, y, zb, z1, 0.42 if u == 0 else 0.36, "stone")
    for u in us:
        block(K["timber_dark"], P, u - 0.25, u + 0.25, -b - 0.3, b + 0.3, z1 - 0.6, z1)
        block(K["timber_dark"], P, u - 0.2, u + 0.2, -b, b, zb + 3.2, zb + 3.5)
    for v in vs:
        block(K["timber_dark"], P, -a - 0.3, a + 0.3, v - 0.25, v + 0.25, z1 - 0.6, z1)
    # the outer bays closed, the middle three open (the doors) on the centre line
    for v0, v1 in ((vs[0], vs[1]), (vs[4], vs[5])):
        block(K["plaster"], P, -0.12, 0.12, v0 + 0.4, v1 - 0.4, zb, z1 - 0.6)
    kk.brackets(K, BARE, P, a, b, z1, z1 + 1.4, out=1.0)
    # the lower roof: a skirt of tiles all round, to the upper storey's balcony
    zl = z1 + 1.4
    kk.hip_roof(K["kawara"], K["soffit_wood"], kk.across(P), b + 0.8, a + 0.8, zl, zl + 2.6, ov=2.6, k=1.5, ridge_frac=0.9)
    # the upper storey: set in a little, its balcony and railing
    zf = zl + 2.2
    a2, b2 = a - 0.6, b - 0.6
    block(K["timber_dark"], P, -a2 - 1.4, a2 + 1.4, -b2 - 1.4, b2 + 1.4, zf - 0.35, zf)
    rail = [P(-a2 - 1.3, -b2 - 1.3, zf), P(a2 + 1.3, -b2 - 1.3, zf), P(a2 + 1.3, b2 + 1.3, zf), P(-a2 - 1.3, b2 + 1.3, zf), P(-a2 - 1.3, -b2 - 1.3, zf)]
    K["timber"].rails(rail, 0.9, post_every=1.8, post=0.12, rail=0.09)
    z2 = zf + 4.4
    for u in (-a2, a2):
        for v in np.linspace(-b2, b2, 6):
            x, y, _ = P(u, v, 0)
            kk.post(K, "timber", x, y, zf, z2, 0.3)
    block(K["plaster"], P, -a2 + 0.2, a2 - 0.2, -b2 + 0.2, b2 - 0.2, zf, z2 - 0.4)
    for v0, v1 in zip(np.linspace(-b2, b2, 6)[:-1], np.linspace(-b2, b2, 6)[1:]):
        block(K["lattice"], P, a2 - 0.1, a2 + 0.08, v0 + 0.5, v1 - 0.5, zf + 0.3, z2 - 0.9)
    block(K["timber_dark"], P, -a2 - 0.2, a2 + 0.2, -b2 - 0.2, b2 + 0.2, z2 - 0.5, z2)
    kk.brackets(K, BARE, P, a2, b2, z2, z2 + 1.6, out=1.2)
    zt = z0 + SANMON_H
    R = kk.irimoya(K["kawara"], K["timber_dark"], K["soffit_wood"], kk.across(P), b2 + 0.8, a2 + 0.8, z2 + 1.6, zt - 0.7, ov=3.2,
                   gable_at=0.5, k=1.55)
    kk.ridge_cap(K, BARE, P, R["Ug"] + 0.3, zt - 0.9, h=0.9)
    hidden.append(sd["si"])
    _cache["sanmon"] = {"P": P, "z0": z0, "a": a, "b": b}


# ---------------------------------------------------------------- the aqueduct

def aqueduct(K):
    """水路閣: red brick on granite springers, a row of round arches along the mapped line, the canal's
    channel on top behind a granite coping."""
    C, T, S, _ = ctx()
    w = way(AQUEDUCT)
    if not w:
        return
    pts = [local(q) for q in w["ll"]]
    a, b = pts[0], pts[-1]
    L = float(np.linalg.norm(b - a))
    t = unit(b - a)
    P = kk.frame(a, t)
    n = max(3, int(round(L / AQUEDUCT_SPAN)))
    span = L / n
    pier = 1.1
    gs = [T(*P(s, 0, 0)[:2]) for s in np.linspace(0, L, 9)]
    ztop = float(np.median(gs)) + AQUEDUCT_H
    half = 2.0
    for k in range(n + 1):
        s = k * span
        g = min(T(*P(s, v, 0)[:2]) for v in (-half, half)) - 0.4
        block(K["brick"], P, s - pier / 2, s + pier / 2, -half, half, g, ztop)
        block(K["granite"], P, s - pier / 2 - 0.08, s + pier / 2 + 0.08, -half - 0.08, half + 0.08, g, g + 1.2)
    for k in range(n):
        s0, s1 = k * span + pier / 2, (k + 1) * span - pier / 2
        c, r = (s0 + s1) / 2, (s1 - s0) / 2
        g = min(T(*P(c, v, 0)[:2]) for v in (-half, half))
        spring = max(g + 2.5, ztop - 1.6 - r)
        m = 10
        for j in range(m):
            u0, u1 = s0 + (s1 - s0) * j / m, s0 + (s1 - s0) * (j + 1) / m
            um = (u0 + u1) / 2
            z_arch = spring + math.sqrt(max(r * r - (um - c) ** 2, 0.0))
            block(K["brick"], P, u0, u1 + 0.01, -half, half, z_arch, ztop)
        block(K["granite"], P, s0, s0 + 0.25, -half - 0.05, half + 0.05, spring - 0.3, spring)
        block(K["granite"], P, s1 - 0.25, s1, -half - 0.05, half + 0.05, spring - 0.3, spring)
    block(K["granite"], P, -0.6, L + 0.6, -half - 0.15, half + 0.15, ztop, ztop + 0.35)
    for v in (-half, half):
        block(K["granite"], P, -0.6, L + 0.6, v - 0.25, v + 0.25, ztop + 0.35, ztop + 1.0)


# ---------------------------------------------------------------- the incline

def incline(K):
    """蹴上インクライン: its two rails on sleepers down the mapped line (a broad gauge of 2.5 m, as the boats'
    cradles needed), and a boat on its cradle halfway down."""
    C, T, S, _ = ctx()
    for wid in INCLINE:
        w = way(wid)
        if not w:
            continue
        pts = [local(q) for q in w["ll"]]
        Q, ss = kk.resample(pts, 1.0)
        for side in (-1.25, 1.25):
            line = []
            for i, p in enumerate(Q):
                a, b = Q[max(i - 1, 0)], Q[min(i + 1, len(Q) - 1)]
                nrm = left_of(unit(b - a))
                q = p + nrm * side
                line.append((q[0], q[1], T(*q) + 0.35))
            for p0, p1 in zip(line, line[1:]):
                K["rail"].box(p0, p1, 0.1, 0.16)
        for i in range(0, len(Q), 1):
            a, b = Q[max(i - 1, 0)], Q[min(i + 1, len(Q) - 1)]
            nrm = left_of(unit(b - a))
            p = Q[i]
            z = T(*p) + 0.15
            K["sleeper"].box((*(p - nrm * 1.7), z), (*(p + nrm * 1.7), z), 0.25, 0.2)
    w = way(INCLINE[1]) or way(INCLINE[0])
    if w:
        pts = [local(q) for q in w["ll"]]
        Q, ss = kk.resample(pts, 0.5)
        i = len(Q) // 2
        a, b = Q[max(i - 6, 0)], Q[min(i + 6, len(Q) - 1)]
        t = unit(b - a)
        P = kk.frame(Q[i], t)
        z = T(*Q[i]) + 0.5
        block(K["timber_dark"], P, -5.5, 5.5, -1.6, 1.6, z, z + 0.7)                  # the cradle
        for s in (-4.5, -1.5, 1.5, 4.5):
            block(K["timber_dark"], P, s - 0.2, s + 0.2, -1.6, 1.6, z + 0.7, z + 1.3)
        hull = Mesh("_", "boat", False)
        prof = [(-7.0, 0.3), (-5.5, 1.0), (5.0, 1.0), (7.0, 0.4)]
        for (u0, w0), (u1, w1) in zip(prof, prof[1:]):
            for s in (-1, 1):
                K["boat"].quad(P(u0, s * w0, z + 1.3), P(u1, s * w1, z + 1.3), P(u1, s * w1, z + 2.3), P(u0, s * w0, z + 2.3))
            K["boat"].quad(P(u0, -w0, z + 1.3), P(u1, -w1, z + 1.3), P(u1, w1, z + 1.3), P(u0, w0, z + 1.3))


# ---------------------------------------------------------------- Ginkaku

def ginkaku(K, hidden):
    """The Kannon-den: the lower storey in the shoin manner (shoji and board walls), the upper a Zen hall
    with bell-shaped windows (花頭窓), under a pyramidal shingle roof crowned by a bronze phoenix."""
    C, T, S, _ = ctx()
    sd = solid_of(name=GINKAKU[0])
    if not sd:
        return
    o, f, hu, hv = kk.site(sd["ring"], local((135.7975, 35.0268)))
    P = kk.frame(o, f)
    z0 = float(np.median([T(*P(u, v, 0)[:2]) for u in (-2, 0, 2) for v in (-2, 0, 2)]))
    h = GINKAKU[1]
    a, b = hu - 1.2, hv - 1.2
    kk.hall(K, SHINGLE, P, z0, a, b, z0 + 0.6, z0 + 3.6, z0 + 5.0, roof="yosemune", ov=1.4, veranda=True, ground=lambda x, y: T(x, y),
            k=1.4, lift=0.25)
    a2, b2 = a * 0.72, b * 0.72
    zf = z0 + 4.6
    for u in (-a2, a2):
        for v in np.linspace(-b2, b2, 4):
            x, y, _ = P(u, v, 0)
            kk.post(K, "timber_dark", x, y, zf, zf + 2.8, 0.14)
    block(K["timber_dark"], P, -a2 + 0.1, a2 - 0.1, -b2 + 0.1, b2 - 0.1, zf, zf + 2.6)
    for s in (-1, 1):   # the bell-shaped windows on the front
        x, y, _ = P(a2 + 0.02, s * b2 * 0.45, 0)
        block(K["plaster"], P, a2 + 0.0, a2 + 0.06, s * b2 * 0.45 - 0.45, s * b2 * 0.45 + 0.45, zf + 0.7, zf + 1.9)
    kk.hip_roof(K["kokera"], K["soffit_wood"], P, a2 + 0.3, b2 + 0.3, zf + 2.8, z0 + h - 0.8, ov=1.3, k=1.45, ridge_frac=0.0, lift=0.3)
    x, y, _ = P(0, 0, 0)
    lathe_at(K["bronze"], x, y, [(z0 + h - 0.9, 0.25), (z0 + h - 0.6, 0.18), (z0 + h - 0.4, 0.06), (z0 + h + 0.4, 0.12), (z0 + h + 0.6, 0.0)], 8)
    hidden.append(sd["si"])


# ---------------------------------------------------------------- Honen-in's thatched gate

def thatch_gable(K, P, hu, hv, z_eave, z_ridge, ov_u, ov_v, thick=0.65):
    """A thatched gable roof (茅葺の切妻): its ridge along v, straight slopes front and back, as thick as a
    bundle of miscanthus (`thick`), cut square at the eaves and the verges; moss in the lower courses and a
    ridge of cedar bark held down by its battens."""
    Eu, Ev = hu + ov_u, hv + ov_v
    zt = lambda u: z_ridge - (z_ridge - z_eave) * abs(u) / Eu
    us = np.linspace(-Eu, Eu, 13)
    vs = np.linspace(-Ev, Ev, 7)
    K["thatch"].grid([[P(u, v, zt(u)) for v in vs] for u in us])
    K["thatch_under"].grid([[P(u, v, zt(u) - thick) for v in vs[::-1]] for u in us])
    for su in (-1, 1):  # the eaves' cut face, and the moss on the lowest course
        u = su * Eu
        a, b = (P(u, -Ev, zt(u) - thick), P(u, Ev, zt(u) - thick)) if su > 0 else (P(u, Ev, zt(u) - thick), P(u, -Ev, zt(u) - thick))
        c, d = (P(u, Ev, zt(u)), P(u, -Ev, zt(u))) if su > 0 else (P(u, -Ev, zt(u)), P(u, Ev, zt(u)))
        K["thatch_under"].quad(a, b, c, d)
        um = su * (Eu - 0.7)
        K["moss"].grid([[P(uu, v, zt(uu) + 0.02) for v in vs] for uu in sorted((um, u))])
    for sv in (-1, 1):  # the verges
        v = sv * Ev
        for a, b in zip(us, us[1:]):
            q = [P(a, v, zt(a) - thick), P(b, v, zt(b) - thick), P(b, v, zt(b)), P(a, v, zt(a))]
            K["thatch_under"].quad(*(q if sv < 0 else q[::-1]))
    # the ridge: a bundle of bark on top, its battens across it
    K["thatch_ridge"].box(P(0, -Ev - 0.15, z_ridge + 0.15), P(0, Ev + 0.15, z_ridge + 0.15), 1.1, 0.45)
    for v in np.linspace(-Ev + 0.3, Ev - 0.3, 7):
        K["timber_dark"].box(P(-0.6, v, z_ridge + 0.05), P(0.6, v, z_ridge + 0.05), 0.09, 0.42)


def honen_gate(K, hidden):
    """法然院の山門: a small gate of bare timber under a deep thatched gable, on the stone steps up from the
    lane: two main posts and two behind, tie beams and a lintel, the leaves of its door open; its roof
    green with moss in the shade of the trees, as photographs show it."""
    C, T, S, _ = ctx()
    sd = solid_of(HONEN_GATE[0])
    if not sd:
        return
    o, f, hu, hv = kk.site(sd["ring"], local((135.7950, 35.0216)))   # it faces west, down to the path
    P = kk.frame(o, f)
    z0 = float(np.median([T(*P(u, v, 0)[:2]) for u in (-1, 0, 1) for v in (-1, 0, 1)]))
    ground = lambda x, y: T(x, y)
    hu, hv = min(hu, 1.9), min(hv, 2.4)
    zb = z0 + 0.2
    block(K["stone"], P, -hu - 0.6, hu + 0.6, -hv - 0.5, hv + 0.5, z0 - 0.6, zb)
    kk.plinth(K, "stone", P, hu + 0.6, hv + 0.5, zb, ground)
    zt = z0 + 3.1            # the lintel's top: under the eaves
    for u, r in ((0.35, 0.17), (-hu + 0.25, 0.12)):        # the main posts (本柱), and those behind (控柱)
        for v in (-hv + 0.3, hv - 0.3):
            x, y, _ = P(u, v, 0)
            kk.post(K, "timber", x, y, zb, zt if r > 0.15 else zt - 0.5, r, "stone")
    block(K["timber_dark"], P, 0.15, 0.55, -hv, hv, zt - 0.35, zt)                    # the lintel (冠木)
    block(K["timber_dark"], P, -hu + 0.1, 0.5, -hv + 0.18, -hv + 0.42, zt - 0.85, zt - 0.6)  # tie beams
    block(K["timber_dark"], P, -hu + 0.1, 0.5, hv - 0.42, hv - 0.18, zt - 0.85, zt - 0.6)
    for sv in (-1, 1):                                                                # the doors, open
        block(K["timber"], P, 0.25 - 1.15, 0.25, sv * (hv - 0.5) - 0.04, sv * (hv - 0.5) + 0.04, zb + 0.1, zt - 0.5)
    for v in (-hv + 0.3, hv - 0.3):                                                    # the bracket blocks
        block(K["bracket"], P, -hu + 0.1, 0.55, v - 0.2, v + 0.2, zt, zt + 0.3)
    thatch_gable(K, P, hu - 0.3, hv, zt + 0.55, z0 + HONEN_GATE[1], ov_u=1.25, ov_v=0.8, thick=0.62)
    hidden.append(sd["si"])


# ---------------------------------------------------------------- Eikan-do

def eikando_hall(K, hidden, spec, toward, roof="irimoya", every=3.2, lift=0.35):
    """One of Eikan-do's halls on its mapped outline: a hall of bare timber on its veranda under a tiled
    hipped-and-gabled roof (kyotokit.hall), its floor raised `spec[2]` m."""
    C, T, S, _ = ctx()
    sd = solid_of(spec[0])
    if not sd:
        return None
    o, f, hu, hv = kk.site(sd["ring"], local(toward))
    P = kk.frame(o, f)
    gs = [T(*P(u, v, 0)[:2]) for u in (-hu * 0.6, 0, hu * 0.6) for v in (-hv * 0.6, 0, hv * 0.6)]
    z0 = float(np.median(gs))
    ridge = z0 + spec[1]
    a, b = hu - 1.6, hv - 1.6
    zf = z0 + spec[2]
    eave = z0 + spec[1] * 0.5
    kk.hall(K, EIKAN, P, z0, a, b, zf, eave, ridge, roof=roof, ov=max(2.0, min(a, b) * 0.34), posts_every=every, veranda=True,
            ground=lambda x, y: T(x, y), k=1.6, lift=lift)
    hidden.append(sd["si"])
    return P, z0


def tahoto(K, hidden):
    """多宝塔: the lower storey square, three bays a side, under a skirt roof (裳階); the white dome (亀腹) on it,
    the round upper body with its bracket ring, the square upper roof deep over it and the copper finial
    (相輪) of nine rings."""
    C, T, S, _ = ctx()
    sd = solid_of(TAHOTO[0])
    if not sd:
        return
    o, f, hu, hv = kk.site(sd["ring"], local((135.7930, 35.0146)))
    P = kk.frame(o, f)
    z0 = float(np.median([T(*P(u, v, 0)[:2]) for u in (-2, 0, 2) for v in (-2, 0, 2)]))
    w = min(hu, hv) - 0.9           # the lower storey's half width at its posts
    H = TAHOTO[1]
    block(K["stone"], P, -w - 1.0, w + 1.0, -w - 1.0, w + 1.0, z0 - 0.8, z0 + 0.6)
    kk.plinth(K, "stone", P, w + 1.0, w + 1.0, z0 + 0.6, lambda x, y: T(x, y))
    zb = z0 + 0.6
    z1 = zb + 3.0
    block(K["plaster"], P, -w + 0.12, w - 0.12, -w + 0.12, w - 0.12, zb, z1 - 0.3)
    for t in np.linspace(-w, w, 4):
        for sgn in (-1, 1):
            for x, y, _ in (P(t, sgn * w, 0), P(sgn * w, t, 0)):
                kk.post(K, "timber", x, y, zb, z1, 0.18, segs=6)
    block(K["lattice"], P, w - 0.04, w + 0.04, -w / 3 + 0.15, w / 3 - 0.15, zb + 0.2, z1 - 0.4)
    block(K["timber_dark"], P, -w - 0.1, w + 0.1, -w - 0.1, w + 0.1, z1 - 0.3, z1)
    kk.brackets(K, BARE, P, w, w, z1, z1 + 0.6, out=0.9)
    ze = z1 + 0.6
    kk.hip_roof(K["kawara"], K["soffit_wood"], P, w + 0.7, w + 0.7, ze, ze + 1.4, ov=1.8, k=1.6, lift=0.25)
    x, y, _ = P(0, 0, 0)
    zd = ze + 1.0
    r = w * 0.78
    lathe_at(K["plaster"], x, y, [(zd, r + 0.25), (zd + 0.5, r + 0.1), (zd + 1.0, r * 0.82), (zd + 1.2, r * 0.7)], 20)   # 亀腹
    zu = zd + 1.2
    zh = zu + 2.0
    lathe_at(K["timber"], x, y, [(zu, r * 0.7), (zh, r * 0.7)], 20)                     # the round upper body
    lathe_at(K["bracket"], x, y, [(zh, r * 0.72), (zh + 0.5, r * 1.15), (zh + 0.7, r * 1.25)], 20)
    zr = zh + 0.7
    zt = z0 + H - 4.6                # the upper roof's apex; the finial above it
    kk.hip_roof(K["kawara"], K["soffit_wood"], P, w + 0.2, w + 0.2, zr, zt, ov=2.2, k=1.75, lift=0.35)
    tip = z0 + H
    lathe_at(K["copper"], x, y, [(zt - 0.3, 0.8), (zt + 0.3, 0.7), (zt + 0.4, 0.3), (tip - 0.3, 0.1), (tip, 0.0)], 10)
    for k in range(9):
        z = zt + 0.9 + k * 0.33
        lathe_at(K["copper"], x, y, [(z, 0.0), (z + 0.04, 0.5 - 0.02 * k), (z + 0.18, 0.5 - 0.02 * k), (z + 0.22, 0.0)], 10)
    hidden.append(sd["si"])


def eikando(K, hidden):
    west = (135.7920, 35.0146)       # the halls face west, down to the gate and the city
    eikando_hall(K, hidden, MIEIDO, west, every=3.4)
    eikando_hall(K, hidden, AMIDADO, west, every=3.0, lift=0.45)
    eikando_hall(K, hidden, SHAKADO, west, every=3.0, lift=0.25)
    tahoto(K, hidden)


# ---------------------------------------------------------------- hooks

def landmark_meshes(scene):
    mats = {k: dict(v) for k, v in MATERIALS.items()}
    K = ak.Kit("tetsugaku", floodlit={"timber", "plaster"}, uv={"kawara", "kokera", "stone", "thatch"})
    hidden = []
    sanmon(K, hidden)
    aqueduct(K)
    incline(K)
    ginkaku(K, hidden)
    honen_gate(K, hidden)
    eikando(K, hidden)
    return mats, K.out(), {"hidden": sorted(set(hidden)), "trees": cherries()}


def finalize(ctx_):
    C = ctx_.city
    for name, ll, up in (("Philosopher's Path 哲学の道", (135.7951, 35.0215), 8.0), ("Ginkaku-ji 銀閣寺", (135.7982, 35.0270), 14.0),
                         ("Nanzen-ji 南禅寺", (135.7935, 35.0112), 26.0), ("Suirokaku 水路閣", (135.7944, 35.0106), 13.0),
                         ("Keage Incline 蹴上インクライン", (135.7895, 35.0092), 8.0), ("Eikan-do 永観堂", (135.7940, 35.0146), 14.0),
                         ("Honen-in 法然院", (135.7966, 35.0216), 10.0)):
        x, y = C.fwd.transform(*ll)
        ctx_.labels[name] = [round(x, 1), round(y, 1), round(ctx_.ground(x, y) + up, 1)]
