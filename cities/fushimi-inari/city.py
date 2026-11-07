"""Fushimi Inari, a map of Kyoto: what the generic pipeline cannot know from open data.

The model is the real district: Overture footprints at Project PLATEAU's surveyed heights on GSI's laser
terrain. This file builds Fushimi Inari Taisha's gate and halls in code on the footprints OpenStreetMap
maps for them (web/data/fushimi-inari/buildings.json, which the renderers then leave out), and the torii.
Sources and what is approximate: docs/cities/fushimi-inari.md.

  * 楼門 the Romon (1589, given by Toyotomi Hideyoshi): a two-storey gate of about 14 m, vermilion under
    hinoki bark, its corridors either side; the two foxes before it, one with a jewel, one with the key
    to the rice granary in its mouth.
  * 外拝殿 the outer worship hall (1840), open on all sides, its gilt lanterns under the eaves; 内拝殿 the
    inner worship hall; 本殿 the main hall (rebuilt 1499), in the Inari style, its front slope carried
    out over the steps.
  * 千本鳥居 the Senbon Torii: two tunnels side by side, one up, one down, each about 80 m; OpenStreetMap's
    survey (2014) counts 382 torii in one and 396, with 3 large ones, in the other. Each is placed
    here along the mapped line at the counted spacing.
  * The mountain: about 10,000 torii on Inari-yama's paths, from the Okusha Hohaisho past Kumataka-sha
    and Yotsutsuji, where Kyoto opens out to the west, round the summit (一ノ峰, 233 m). They stand along
    the mapped path here, close together with gaps at the shrines; how many and how close is not counted.
    Each torii is cedar coated in vermilion with black feet and a black lintel, the donor's name in black
    on the back (seen coming down).
  * The stone lanterns where OpenStreetMap maps the path's lamps, lit after dark.
"""
import heapq
import json
import math
import os

import numpy as np

import archkit as ak
import kyotokit as kk
from japankit import Atlas, block, lathe_at, taper, unit, left_of, vertical
from meshkit import Mesh

HERE = os.path.dirname(os.path.abspath(__file__))

MATERIALS = {
    # Inari's vermilion: red lead (鉛丹), a brighter orange than Kiyomizu's
    "inari_shu": {"color": "#d8502a", "roughness": 0.55, "metalness": 0.0, "emissive": "#ff7a40", "glow": 0.45},
    "inari_black": {"color": "#1d1a19", "roughness": 0.5, "metalness": 0.05},
    # the torii: lit only by the lanterns along the path after dark, not floodlit
    "torii_shu": {"color": "#d24e28", "roughness": 0.5, "metalness": 0.0},
    "inari_white": {"color": "#f0ebde", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffe2bc", "glow": 0.25},
    "bracket_green": {"color": "#356e5a", "roughness": 0.7, "metalness": 0.0},
    "gold": {"color": "#d6a93a", "roughness": 0.3, "metalness": 0.85, "emissive": "#ffc94a", "glow": 0.5},
    "hiwada": {"color": "#6a4f3e", "roughness": 0.92, "metalness": 0.0, "pattern": "roof_tiles", "bay_m": 0.09, "course_m": 0.12},
    "hiwada_ridge": {"color": "#4b3a2f", "roughness": 0.9, "metalness": 0.0},
    "copper": {"color": "#4f7f6d", "roughness": 0.6, "metalness": 0.4},
    "soffit": {"color": "#b84a2c", "roughness": 0.8, "metalness": 0.0},
    "gable": {"color": "#a63f24", "roughness": 0.7, "metalness": 0.0},
    "stone": {"color": "#a19b90", "roughness": 0.92, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.45, "block_m": 0.9},
    "stone_dark": {"color": "#7a766e", "roughness": 0.92, "metalness": 0.0},
    "fox_stone": {"color": "#b8b2a6", "roughness": 0.9, "metalness": 0.0},
    "bib": {"color": "#c8321f", "roughness": 0.85, "metalness": 0.0},
    "lattice": {"color": "#3b2d24", "roughness": 0.8, "metalness": 0.0},
    "screen": {"color": "#2f2620", "roughness": 0.8, "metalness": 0.0, "opacity": 0.75},
    "bronze": {"color": "#4c4234", "roughness": 0.45, "metalness": 0.75},
    "nio": {"color": "#8a5a3c", "roughness": 0.7, "metalness": 0.1},
    "wood_dark": {"color": "#4a3a2e", "roughness": 0.85, "metalness": 0.0},
    "lamp_glass": {"color": "#f6e7c4", "roughness": 0.6, "metalness": 0.0, "emissive": "#ffc070", "glow": 0.5},
    "setts": {"color": "#8f8a80", "roughness": 0.9, "metalness": 0.0, "pattern": "granite", "joints_m": [0.6, 0.4], "street_lit": True, "decal": True},
    "kerb": {"color": "#a19b90", "roughness": 0.9, "metalness": 0.0, "solid": False},
    # the donors' names on the torii's backs
    # the torii's pillars in the collision world (torii_hits): solid, never seen
    "torii_hit": {"color": "#d24e28", "roughness": 1.0, "metalness": 0.0, "opacity": 0.0},
    "inari_words": {"color": "#ffffff", "roughness": 0.6, "metalness": 0.0, "map": "inari.png", "cutout": True},
}
SHU = {"post": "inari_shu", "wall": "inari_white", "roof": "hiwada", "soffit": "soffit", "gable": "gable", "ridge": "hiwada_ridge",
       "base": "stone", "bracket": "bracket_green", "wood": "inari_shu", "metal": "copper", "gold": "gold", "screen": "screen",
       "nio": "nio", "screen_wood": "lattice"}

ROMON, GEHAIDEN, NAIHAIDEN, HONDEN = "w105449733", "w105449674", "w105449716", "w899425893"
SENBON = {260121328: 382, 377968455: 399}     # OSM ways and their surveyed counts (note: "actual torii count")
# the route up the mountain and round the summit, by its shrines (lon, lat from OpenStreetMap)
ROUTE = [("奥社奉拝所", (135.77557, 34.96654)), ("熊鷹社", (135.77862, 34.96835)), ("四ツ辻", (135.78138, 34.96911)),
         ("三ノ峰", (135.78235, 34.9679)), ("二ノ峰", (135.78407, 34.96728)), ("一ノ峰", (135.7855, 34.96709)),
         ("御劔社", (135.78585, 34.96866)), ("御膳谷奉拝所", (135.78354, 34.96951)), ("四ツ辻", (135.78138, 34.96911))]
YOTSUTSUJI = (135.78138, 34.96911)
OMOTESANDO_TORII = (135.77104, 34.96793)      # the great torii on the Omotesando (OSM ceremonial gate)
FOOT = {"footway", "path", "steps", "pedestrian", "track"}

# torii kinds: (height, span between the pillars, pillar diameter) in metres. The shrine sells a donated
# torii by its size in 号, the pillar's diameter in sun (寸, 3.03 cm): 5号 to 10号 on the paths (the
# Senbon Torii's are 6号 and 7号 in photographs, measured against the 2 m width OpenStreetMap gives the
# tunnels), the miniature ones left at the otsuka 1号 to 3号 (see docs/cities/fushimi-inari.md)
SUN = 0.0303
KINDS = {"senbon": (2.6, 1.5, 6.5 * SUN), "small": (2.4, 1.6, 5 * SUN), "mountain": (3.1, 2.0, 7 * SUN), "large": (4.6, 2.9, 10 * SUN),
         "votive": (0.62, 0.42, 1.5 * SUN)}
# the side paths off the round, each a leg between two places OpenStreetMap names, torii-lined as the
# round is; a leg keeps off the ways the round already takes
SIDE = [("三つ辻 (Mittsu tsuji)", "荒木神社"),            # Mitsutsuji down to Araki-jinja and the north approach
        ("四ツ辻 (Yottsu tsuji)", "田中社 権田夫大神"),   # Yotsutsuji up to Kojin-ga-mine (田中社神蹟)
        ("御膳谷奉拝所", "清明舎")]                       # Gozendani to the Kiyotaki falls (清滝)
# (Okusha to Kumataka-sha is the round's first leg; the other way from Neagari-no-matsu is the same mapped way)

_cache = {}


def ctx():
    if "C" not in _cache:
        import cityctx
        _cache["C"] = cityctx.City("fushimi-inari")
        _cache["T"] = ak.Terrain("fushimi-inari")
        _cache["S"] = ak.load_solids("fushimi-inari")
        _cache["osm"] = json.load(open(os.path.join(HERE, "inari_osm.json")))
    return _cache["C"], _cache["T"], _cache["S"], _cache["osm"]


def solid_of(oid):
    _, _, S, _ = ctx()
    got = [sd for sd in S if sd["osm"] == oid]
    return max(got, key=lambda sd: abs(ak.ring_area(sd["ring"]))) if got else None


def local(ll):
    C = ctx()[0]
    return np.array(C.fwd.transform(*ll))


# ---------------------------------------------------------------- the shrine

def romon_layout():
    sd = solid_of(ROMON)
    if not sd:
        return None
    C, T, S, _ = ctx()
    west = local(OMOTESANDO_TORII)
    o, f, hu, hv = kk.site(sd["ring"], west)
    z0 = float(np.median([T(*(o + f * du + left_of(f) * dv)) for du in (-3, 0, 3) for dv in (-4, 0, 4)]))
    return {"o": o, "f": f, "hu": hu, "hv": hv, "z0": z0, "si": sd["si"]}


def shrine(K, hidden):
    C, T, S, _ = ctx()
    R = romon_layout()
    if R:
        P = kk.frame(R["o"], R["f"])
        g = kk.romon(K, SHU, P, R["z0"], frontage=10.0, depth=5.4, ridge=14.0, nio=False, lattice=False, ground=T)
        # the corridors (回廊) either side, to the ends of the mapped outline: vermilion posts, white walls, bark roofs
        for s in (-1, 1):
            v0, v1 = sorted((s * 6.2, s * (R["hv"] - 0.4)))
            if v1 - v0 < 2.0:
                continue
            Q = lambda u, v, z, vc=(v0 + v1) / 2: P(u, vc + v, z)
            hw = (v1 - v0) / 2
            block(K["stone"], Q, -2.0, 2.0, -hw, hw, R["z0"] - 0.6, R["z0"] + 0.3)
            for v in np.linspace(-hw, hw, max(2, int(2 * hw / 2.4) + 1)):
                for u in (-1.6, 1.6):
                    x, y, _ = Q(u, v, 0)
                    kk.post(K, "inari_shu", x, y, R["z0"] + 0.3, R["z0"] + 3.6, 0.17)
            block(K["inari_white"], Q, -0.12, 0.12, -hw, hw, R["z0"] + 0.3, R["z0"] + 3.3)
            block(K["inari_shu"], Q, -1.7, 1.7, -hw, hw, R["z0"] + 3.4, R["z0"] + 3.75)
            kk.kirizuma(K, SHU, lambda u, v, z, Q=Q: Q(u, v, z), 1.7, hw, R["z0"] + 3.8, R["z0"] + 5.4, ov_u=1.0, ov_v=0.2)
        hidden.append(R["si"])
        _cache["romon"] = dict(R, stone=g["stone"])
        foxes(K, P, R["z0"], R["hu"])
    for oid, kind, h in ((GEHAIDEN, "gehaiden", 10.5), (NAIHAIDEN, "naihaiden", 11.5), (HONDEN, "honden", 12.0)):
        sd = solid_of(oid)
        if not sd:
            continue
        o, f, hu, hv = kk.site(sd["ring"], local(OMOTESANDO_TORII))
        z0 = float(np.median([T(*(o + f * du + left_of(f) * dv)) for du in (-2, 0, 2) for dv in (-3, 0, 3)]))
        P = kk.frame(o, f)
        ov = 2.2
        if kind == "gehaiden":   # open on all sides: posts, no walls, gilt lanterns in the eaves
            a, b = hu - ov * 0.6, hv - ov * 0.6
            block(K["stone"], P, -a - 0.8, a + 0.8, -b - 0.8, b + 0.8, z0 - 0.6, z0 + 0.6)
            ze = z0 + h * 0.5
            for u in np.linspace(-a, a, 4):
                for v in np.linspace(-b, b, 6):
                    if abs(u) < a - 0.1 and abs(v) < b - 0.1:
                        continue
                    x, y, _ = P(u, v, 0)
                    kk.post(K, "inari_shu", x, y, z0 + 0.6, ze - 0.8, 0.22, "stone")
            block(K["inari_shu"], P, -a - 0.15, a + 0.15, -b - 0.15, b + 0.15, ze - 1.2, ze - 0.8)
            kk.brackets(K, SHU, P, a, b, ze - 0.8, ze, out=0.9)
            for v in np.linspace(-b + 1.2, b - 1.2, 5):      # the gilt hanging lanterns (釣灯籠) round the eaves
                for u in (-a - 0.4, a + 0.4):
                    x, y, _ = P(u, v, 0)
                    lathe_at(K["gold"], x, y, [(ze - 2.0, 0.0), (ze - 1.95, 0.22), (ze - 1.5, 0.26), (ze - 1.35, 0.32), (ze - 1.2, 0.0)], 6)
            from japankit import irimoya
            Rr = irimoya(K["hiwada"], K["gable"], K["soffit"], kk.across(P), b + 0.6, a + 0.6, ze, z0 + h - 0.6, ov=ov, gable_at=0.5, k=1.55)
            kk.ridge_cap(K, SHU, P, Rr["Ug"] + 0.3, z0 + h - 0.8, h=0.6)
        else:
            kk.hall(K, SHU, P, z0, hu - ov * 0.6, hv - ov * 0.6, z0 + 1.0, z0 + h * 0.46, z0 + h, roof="irimoya", ov=ov, ground=T)
            if kind == "honden":     # 稲荷造: the front slope carried out over the steps (向拝) on its own posts
                a, b = hu - ov * 0.6, hv - ov * 0.6
                for v in np.linspace(-b * 0.6, b * 0.6, 4):
                    x, y, _ = P(a + 3.0, v, 0)
                    kk.post(K, "inari_shu", x, y, z0, z0 + h * 0.4, 0.2, "stone")
                us = np.linspace(a, a + 3.6, 6)
                zs = [z0 + h * 0.62 - (z0 + h * 0.62 - z0 - h * 0.42) * ((uu - a) / 3.6) ** 0.9 for uu in us]
                K["hiwada"].grid([[P(uu, v, zz) for v in np.linspace(-b * 0.75, b * 0.75, 5)] for uu, zz in zip(us, zs)])
        hidden.append(sd["si"])
    # the great torii on the Omotesando
    x, y = local(OMOTESANDO_TORII)
    big = Mesh("inari_otorii_shu", "inari_shu", False, floodlit=True)
    blk = Mesh("inari_otorii_black", "inari_black", False)
    tmp_a, tmp_b = Mesh("_", "inari_shu", False), Mesh("_", "inari_black", False)
    kk.torii(tmp_a, tmp_b, 9.5, 7.0, r=0.45)
    d = road_heading((x, y))
    for src, dst in ((tmp_a, big), (tmp_b, blk)):
        n = len(dst.v)
        c, s_ = math.cos(d - math.pi / 2), math.sin(d - math.pi / 2)
        z = T(x, y)
        dst.v += [(x + c * vx - s_ * vy, y + s_ * vx + c * vy, z + vz) for vx, vy, vz in src.v]
        dst.t += [[0.0, 0.0]] * len(src.v)
        dst.i += [i + n for i in src.i]
    return [big, blk]


def road_heading(p):
    """The direction of the mapped path nearest p (the Omotesando)."""
    _, _, _, osm = ctx()
    best, h = 1e9, 0.0
    for w in osm["ways"]:
        if w["tags"].get("highway") not in FOOT | {"pedestrian", "living_street", "residential", "unclassified"}:
            continue
        pts = [local(q) for q in w["ll"]]
        for a, b in zip(pts, pts[1:]):
            m = (a + b) / 2
            dd = float(np.linalg.norm(m - p))
            if dd < best and np.linalg.norm(b - a) > 1:
                best, h = dd, math.atan2(b[1] - a[1], b[0] - a[0])
    return h


def fox(m, bib, P, u, v, z, mirror, holds):
    """A fox (狐, the messenger of Inari) seated on its plinth, tail up, a red bib; holding in its mouth a
    jewel (玉) or a key (鍵)."""
    import sculptkit as sk
    s = -1 if mirror else 1
    parts = [sk.ellipsoid((0, 0, 0.55), (0.32, 0.26, 0.5)), sk.ellipsoid((0.12, 0, 1.12), (0.2, 0.17, 0.2)),
             sk.capsule((0.2, 0, 1.08), (0.42, 0, 1.03), 0.09, 0.05),
             sk.capsule((0.08, 0.08, 1.22), (0.06, 0.1, 1.45), 0.06, 0.01), sk.capsule((0.08, -0.08, 1.22), (0.06, -0.1, 1.45), 0.06, 0.01),
             sk.capsule((0.2, 0.12, 0.1), (0.2, 0.1, 0.65), 0.07), sk.capsule((0.2, -0.12, 0.1), (0.2, -0.1, 0.65), 0.07),
             sk.path([(-0.3, 0.0, 0.2), (-0.5, 0.0, 0.7), (-0.42, 0.0, 1.2), (-0.25, 0.0, 1.45)], [0.12, 0.17, 0.15, 0.05])]
    if holds == "key":
        parts.append(sk.capsule((0.42, -0.18, 1.02), (0.42, 0.18, 1.02), 0.03))
    else:
        parts.append(sk.sphere((0.46, 0, 1.02), 0.08))
    f = sk.smooth_union(0.06, *parts)
    verts, quads = sk.mesh(f, (-0.8, -0.45, -0.05), (0.7, 0.45, 1.6), 0.035)
    verts = sk.relax(np.asarray(verts, float), np.asarray(quads), 0.5, 2)
    n = len(m.v)
    scale = 1.25
    for a in verts:
        x, y, zz = P(u + a[0] * scale, v + a[1] * scale, z + a[2] * scale)
        m.v.append((float(x), float(y), float(zz)))
        m.t.append([0.0, 0.0])
    for q in quads:
        m.i += [n + int(k) for k in q]
    x, y, _ = P(u + 0.15, v, 0)
    lathe_at(bib, x, y, [(z + 0.9 * scale, 0.27 * scale), (z + 0.98 * scale, 0.25 * scale), (z + 1.0 * scale, 0.0)], 10)


def foxes(K, P, z0, hu):
    """The pair of foxes before the Romon on tall stone plinths: the jewel on the right as you face the
    gate, the key on the left."""
    for s, holds in ((1, "key"), (-1, "jewel")):
        u, v = hu + 5.0, s * 5.5
        block(K["stone"], P, u - 0.8, u + 0.8, v - 0.8, v + 0.8, z0 - 0.3, z0 + 0.6)
        taper(K["stone"], P, u, v, 1.3, 1.3, z0 + 0.6, 1.0, 1.0, z0 + 2.4)
        block(K["stone_dark"], P, u - 0.65, u + 0.65, v - 0.65, v + 0.65, z0 + 2.4, z0 + 2.6)
        Q = kk.frame(P(u, v, 0)[:2], unit(np.array(P(1, 0, 0)[:2]) - np.array(P(0, 0, 0)[:2])))
        # each fox turns a little toward the passage
        fox(K["fox_stone"], K["bib"], lambda a, b, c, Q=Q, s=s: Q(a * math.cos(0.35 * s) - b * math.sin(0.35 * s), a * math.sin(0.35 * s) + b * math.cos(0.35 * s), c),
            0.0, 0.0, z0 + 2.6, s < 0, holds)


# ---------------------------------------------------------------- the torii

def graph():
    """The footpaths as a graph: node id -> (x, y), and adjacency with lengths."""
    if "G" in _cache:
        return _cache["G"]
    _, _, _, osm = ctx()
    xy, adj = {}, {}
    for w in osm["ways"]:
        if w["tags"].get("highway") not in FOOT or len(w["nodes"]) != len(w["ll"]):
            continue
        ids = w["nodes"]
        for nid, ll in zip(ids, w["ll"]):
            xy[nid] = local(ll)
        for a, b in zip(ids, ids[1:]):
            d = float(np.linalg.norm(xy[a] - xy[b]))
            adj.setdefault(a, []).append((b, d, w["id"]))
            adj.setdefault(b, []).append((a, d, w["id"]))
    _cache["G"] = (xy, adj)
    return xy, adj


def shortest(a, b, avoid=(), used=None, avoid_edges=(), nodes=False):
    xy, adj = graph()
    via = {}
    dist, prev, q = {a: 0.0}, {}, [(0.0, a)]
    while q:
        d, n = heapq.heappop(q)
        if n == b:
            break
        if d > dist.get(n, 1e18):
            continue
        for m, w, wid in adj.get(n, ()):
            if wid in avoid:
                continue
            nd = d + (w * 50 if (min(n, m), max(n, m)) in avoid_edges else w)   # (a way already taken: only if no other)
            if nd < dist.get(m, 1e18):
                dist[m], prev[m], via[m] = nd, n, wid
                heapq.heappush(q, (nd, m))
    if b not in dist:
        return []
    path = [b]
    while path[-1] != a:
        if used is not None:
            used.add((min(path[-1], prev[path[-1]]), max(path[-1], prev[path[-1]])))
        path.append(prev[path[-1]])
    return path[::-1] if nodes else [xy[n] for n in reversed(path)]


def nearest(p):
    xy, adj = graph()
    return min((n for n in xy if n in adj), key=lambda n: float(np.linalg.norm(xy[n] - p)))


def uphill(pts, T):
    return pts if T(*pts[-1]) >= T(*pts[0]) else pts[::-1]


def LineString_distance(pts, p):
    """The distance from p to the polyline pts."""
    A, B = np.asarray(pts[:-1], float), np.asarray(pts[1:], float)
    d = B - A
    t = np.clip(((p - A) * d).sum(1) / np.maximum((d * d).sum(1), 1e-9), 0, 1)
    return float(np.min(np.linalg.norm(A + d * t[:, None] - p, axis=1)))


def foot_segments():
    """The footpaths' segments as arrays (a, b) for distances."""
    if "segs" not in _cache:
        xy, adj = graph()
        A, B = [], []
        for n, nb in adj.items():
            for m, _, _ in nb:
                if n < m:
                    A.append(xy[n]); B.append(xy[m])
        _cache["segs"] = (np.array(A), np.array(B))
    return _cache["segs"]


def path_distance(p):
    A, B = foot_segments()
    d = B - A
    t = np.clip(((p - A) * d).sum(1) / np.maximum((d * d).sum(1), 1e-9), 0, 1)
    return float(np.min(np.linalg.norm(A + d * t[:, None] - p, axis=1)))


def votive(out, rng):
    """The miniature torii left at the otsuka (お塚, the stone mounds the faithful dedicate to their own
    name of Inari, more than ten thousand on the mountain): a cluster behind each shrine and memorial
    stone OpenStreetMap maps along the torii-lined ways, stacked in rows up the mound, kept off the path."""
    C, T, S, osm = ctx()
    x_okusha = local(ROUTE[0][1])[0] - 30
    lined = np.array([a[:2] for k, at in out.items() if k != "votive" for a in at])
    for n in osm["nodes"]:
        t = n["tags"]
        if t.get("historic") not in ("wayside_shrine", "memorial"):
            continue
        c = local(n["ll"])
        if c[0] < x_okusha or path_distance(c) > 25 or np.min(np.linalg.norm(lined - c, axis=1)) > 20:
            continue    # (only on the torii-lined ways: not the temples' graves to the south)
        # away from the nearest path: the mound rises behind the shrine
        A, B = foot_segments()
        d = B - A
        tt = np.clip(((c - A) * d).sum(1) / np.maximum((d * d).sum(1), 1e-9), 0, 1)
        q = (A + d * tt[:, None])[int(np.argmin(np.linalg.norm(A + d * tt[:, None] - c, axis=1)))]
        back = unit(c - q) if np.linalg.norm(c - q) > 0.3 else unit(np.array([rng.normal(), rng.normal()]))
        side = np.array([-back[1], back[0]])
        face = math.atan2(-back[1], -back[0]) - math.pi / 2     # each faces the path
        for k in range(int(rng.integers(50, 120))):
            row, col = divmod(k, 11)
            p = c + back * (1.0 + 0.4 * row + rng.uniform(-0.1, 0.1)) + side * ((col - 5) * 0.46 + rng.uniform(-0.12, 0.12))
            if path_distance(p) < 1.5:
                continue
            out["votive"].append([round(float(p[0]), 2), round(float(p[1]), 2), round(T(*p) - 0.03, 2),
                                  round(face + float(rng.uniform(-0.25, 0.25)), 3), round(float(rng.uniform(0.7, 1.6)), 2)])


def torii_sites():
    """Every torii: {kind: [[x, y, z, heading, across]]}, the Senbon Torii at their surveyed spacing along
    each mapped tunnel, and the mountain route's at a torii every 0.65 m with gaps at the shrines and here
    and there between them. heading turns the torii's frame so its y runs uphill along the path."""
    if "torii" in _cache:
        return _cache["torii"]
    C, T, S, osm = ctx()
    rng = np.random.default_rng(10000)
    out = {k: [] for k in KINDS}
    lines, runs = [], []
    xy, adj = graph()
    forks = np.array([xy[n] for n, nb in adj.items() if len({m for m, _, _ in nb}) >= 3])
    lamp_xy = np.array([a[:2] for a in lamps()])

    def place(pts, n=None, pitch=None, kind="mountain", gaps=False, keep_clear=(), avoid_lines=()):
        Q, ss = kk.resample(pts, 0.05)
        L = ss[-1]
        if L < 2:
            return
        if n:
            at = [L * (k + 0.5) / n for k in range(n)]
        else:
            at, s, hole = [], 1.0, 0.0
            while s < L - 0.5:
                if gaps and rng.random() < 0.012:
                    s += rng.uniform(4.0, 12.0)
                    continue
                at.append(s)
                s += pitch * rng.uniform(0.85, 1.25)
        run = []
        for s in at:
            i = min(int(np.searchsorted(ss, s)), len(Q) - 1)
            a, b = Q[max(i - 4, 0)], Q[min(i + 4, len(Q) - 1)]
            p = Q[i]
            # none on a sharp bend (its pillars would stand in the way round it), nor, in the Senbon Torii,
            # where the other tunnel runs close (where the two part at their ends)
            a2, b2 = Q[max(i - 16, 0)], Q[min(i + 16, len(Q) - 1)]
            d1, d2 = p - a2, b2 - p
            if np.linalg.norm(d1) > 0.1 and np.linalg.norm(d2) > 0.1 and \
                    math.acos(float(np.clip(d1 @ d2 / np.linalg.norm(d1) / np.linalg.norm(d2), -1, 1))) > 0.6:
                continue
            if any(LineString_distance(o, p) < KINDS[kind][1] / 2 + 0.9 for o in avoid_lines):
                continue
            if any(np.linalg.norm(p - c) < r for c, r in keep_clear):
                continue
            if kind != "senbon" and len(forks) and np.min(np.linalg.norm(forks - p, axis=1)) < 1.8:
                continue    # a gap where another path joins
            if len(lamp_xy) and np.min(np.linalg.norm(lamp_xy - p, axis=1)) < 1.3:
                continue    # and at a lamp OpenStreetMap maps on the path (a solid post in the game)
            h = math.atan2(b[1] - a[1], b[0] - a[0]) - math.pi / 2
            k = kind
            if kind == "mountain":
                r = rng.random()
                k = "large" if r < 0.04 else "small" if r < 0.35 else "mountain"
            out[k].append([round(float(p[0]), 2), round(float(p[1]), 2), round(T(*p) - 0.05, 2), round(h, 3),
                           round(float(rng.uniform(0.95, 1.08)), 2)])
            run.append((k, out[k][-1]))
        lines.append(pts)
        runs.append(run)

    senbon = set()
    tunnels = {w["id"]: uphill([local(q) for q in w["ll"]], T) for w in osm["ways"] if w["id"] in SENBON and len(w["ll"]) > 1}
    for wid, pts in tunnels.items():
        place(pts, n=SENBON[wid], kind="senbon", avoid_lines=[q for k, q in tunnels.items() if k != wid])
        senbon.add(wid)
    clear = [(local(ll), 7.0) for _, ll in ROUTE]
    stops = [nearest(local(ll)) for _, ll in ROUTE]
    used = set()
    for a, b in zip(stops, stops[1:]):
        pts = shortest(a, b, avoid=senbon, used=used)
        if len(pts) > 1:
            place(uphill(pts, T) if a == stops[0] else pts, pitch=0.65, gaps=True, keep_clear=clear)
    named = {w["tags"]["name"].replace("\u3000", " "): np.mean([local(q) for q in w["ll"]], axis=0)
             for w in osm["ways"] if w["tags"].get("name") and w["ll"]}     # (a shrine's outline: its middle)
    named.update({n["tags"]["name"].replace("\u3000", " "): local(n["ll"]) for n in osm["nodes"] if n["tags"].get("name")})
    for a, b in SIDE:
        if a not in named or b not in named:
            print(f"  torii: no place named {a if a not in named else b}")
            continue
        na, nb = nearest(named[a]), nearest(named[b])
        length = lambda ids: sum(float(np.linalg.norm(xy[n] - xy[m])) for n, m in zip(ids, ids[1:]))
        direct = shortest(na, nb, avoid=senbon, nodes=True)
        ids = shortest(na, nb, avoid=senbon, avoid_edges=set(used), nodes=True)
        if length(ids) > 1.8 * length(direct):
            ids = direct      # no other way of about the same length: the direct one, where it is not lined yet
        run = []          # the leg's stretches off the ways already lined
        for n, m in zip(ids, ids[1:]):
            e = (min(n, m), max(n, m))
            if e in used:
                if len(run) > 1:
                    place(uphill([xy[k] for k in run], T), pitch=0.65, gaps=True, keep_clear=clear + [(named[b], 5.0)], avoid_lines=list(lines))
                run = []
                continue
            used.add(e)
            run = run + [m] if run else [n, m]
        if len(run) > 1:
            place(uphill([xy[k] for k in run], T), pitch=0.65, gaps=True, keep_clear=clear + [(named[b], 5.0)], avoid_lines=list(lines))
    votive(out, rng)
    _cache["torii"] = out
    _cache["torii_lines"] = lines
    _cache["torii_runs"] = runs
    return out


def torii_props():
    """The torii as instanced props: each kind's vermilion body, its black parts and the donors' names."""
    props = []
    for kind, at in torii_sites().items():
        if not at:
            continue
        h, span, dia = KINDS[kind]
        body = Mesh(f"torii_{kind}_shu", "torii_shu", False)
        black = Mesh(f"torii_{kind}_black", "inari_black", False)
        words = Mesh(f"torii_{kind}_words", "inari_words", False, uv=True)
        r = dia / 2
        kk.torii(body, black, h, span, r=r)
        if kind == "votive":
            props.append({"name": f"torii_{kind}", "at": at, "parts": [m.dump() for m in (body, black)], "far": 160})
            continue
        for s in (-1, 1):   # the names, on the pillar's back (the side facing uphill, +y)
            x = s * span / 2
            words.quad((x - r * 0.9, r + 0.01, 0.12 * h), (x + r * 0.9, r + 0.01, 0.12 * h), (x + r * 0.9, r + 0.01, 0.72 * h), (x - r * 0.9, r + 0.01, 0.72 * h),
                       [[1, 0], [0, 0], [0, 1], [1, 1]] if s < 0 else [[0, 0], [1, 0], [1, 1], [0, 1]])
        props.append({"name": f"torii_{kind}", "at": at, "parts": [m.dump() for m in (body, black, words)], "far": 2200})
    return props


WALL_TOP = 1.15   # the collision walls' height (m): over a walker's knee, so they stop walkers, and under the
# camera, which the landmarks' coarse cells (padded 0.3 m) would otherwise lift over the torii's roofs


def torii_hits(chunk=48.0):
    """The torii's pillars for the collision world. The torii on the paths stand closer than a walker is
    wide (0.2 m apart in the Senbon Torii, 0.65 m on the mountain), so each side of a run of them is one
    wall, pillar to pillar, from the ground to 1.15 m (over the knee, under the camera), broken where the run is (a shrine, a gap
    of a metre or more). The walls are in a material that is solid but never drawn (opacity 0), cut into
    chunks drawn only within their own radius: walkers and the player keep between the pillars. (The
    miniature torii at the otsuka stand off the path.)"""
    torii_sites()
    cells = {}

    def wall(pts):
        if len(pts) < 2:
            return
        x, y = pts[len(pts) // 2][:2]
        m = cells.setdefault((int(x // chunk), int(y // chunk)), Mesh("_", "torii_hit", False))
        n = len(m.v)
        for px, py, z0, z1, _ in pts:
            m.v += [(px, py, z0), (px, py, z1)]
            m.t += [[0.0, 0.0], [0.0, 0.0]]
        for k in range(len(pts) - 1):
            a = n + 2 * k
            m.i += [a, a + 2, a + 1, a + 1, a + 2, a + 3]

    for run in _cache["torii_runs"]:
        for side in (-1, 1):
            pts, last = [], None
            for kind, (x, y, z, hd, sc) in run:
                h, span, dia = KINDS[kind]
                # along the pillars' outer faces: the collision world's cells (0.25 m) widen a wall by up to a
                # cell each side, and the tunnels are only a little wider than two people
                X = side * ((span / 2 + h * 0.01) * sc + dia / 2)
                p = (round(x + math.cos(hd) * X, 2), round(y + math.sin(hd) * X, 2), round(z, 2), round(z + WALL_TOP, 2), hd)
                if last is not None and (math.hypot(p[0] - last[0], p[1] - last[1]) > 1.0 or abs(math.remainder(hd - last[4], math.tau)) > 0.35):
                    wall(pts)
                    pts = []
                pts.append(p)
                last = p
            wall(pts)
    out = []
    for (i, j), m in sorted(cells.items()):
        m.name = f"torii_hit_{i}_{j}"
        out.append(Near(m))
    return out


def torii_ceilings(step=2.0):
    """Each run of torii as a low ceiling for the game's camera (landmarks.json "ceilings", web/game/nav.js
    ceilingAt): under the tie beams of the run's lowest torii, so that the chase camera stays in the
    tunnel rather than over the lintels."""
    torii_sites()
    out = []
    for run in _cache["torii_runs"]:
        if len(run) < 3:
            continue
        h = min(KINDS[k][0] for k, _ in run)
        span = min(KINDS[k][1] * a[4] for k, a in run)
        pieces, pts, last = [], [], None
        for kind, (x, y, z, hd, sc) in run:
            if last is None or math.hypot(x - last[0], y - last[1]) >= step:
                if last is not None and math.hypot(x - last[0], y - last[1]) > 4.0 and len(pts) > 1:
                    pieces.append(pts)
                    pts = []
                pts.append([x, y, z])
                last = (x, y)
        if len(pts) > 1:
            pieces.append(pts)
        out += [{"pts": p, "half_width": round(span / 2 - 0.1, 2), "clear_m": round(0.7 * h - 0.05, 2)} for p in pieces]
    return out


class Near:
    """A mesh drawn only within its own radius ("far" 1 m)."""
    def __init__(self, m):
        self.m, self.v, self.i, self.name, self.mat = m, m.v, m.i, m.name, m.mat

    def dump(self):
        return dict(self.m.dump(), far=1)


def woods_clear(scene):
    """No tree from the canopy in a torii tunnel: the ways the torii line, 1.6 m either side, as rings of
    20 m pieces of them (no piece closes on itself, so none has a hole) for pipeline/woods.py
    (pipeline/woods_clear.py applies it to the trees already planted)."""
    from shapely.geometry import LineString
    torii_sites()
    out = []
    for l in _cache["torii_lines"]:
        Q, ss = kk.resample(l, 1.0)
        for i in range(0, len(Q) - 1, 20):
            piece = Q[i:i + 21]
            if len(piece) > 1:
                g = LineString(piece).buffer(1.6, quad_segs=2).simplify(0.2)
                out.append([[round(x, 2), round(y, 2)] for x, y in g.exterior.coords])
    return out


def lamps():
    """The stone lanterns at the mapped lamps along the paths: [[x, y, z, heading]]."""
    C, T, S, osm = ctx()
    out = []
    for n in osm["nodes"]:
        if n["tags"].get("man_made") == "lamp" or n["tags"].get("highway") == "street_lamp":
            x, y = local(n["ll"])
            out.append([round(float(x), 2), round(float(y), 2), round(T(x, y), 2), 0.0])
    return out


def lamp_props():
    at = lamps()
    if not at:
        return []
    stone = Mesh("toro_stone", "stone_dark", False)
    light = Mesh("toro_light", "lamp_glass", False, floodlit=True)
    kk.stone_lantern(stone, 1.7)
    kk.lantern_light(light, 1.7)
    return [{"name": "toro", "at": at, "parts": [stone.dump(), light.dump()], "far": 900}]


def paths(K):
    """Stone paving on the Omotesando and the shrine's approaches."""
    C, T, S, osm = ctx()
    for w in osm["ways"]:
        t = w["tags"]
        if t.get("name") in ("表参道", "神幸道") and len(w["ll"]) > 1:
            kk.paving(K["setts"], [local(q) for q in w["ll"]], float(t.get("width", 0) or 8.0), T, lift=0.05, step=2.0, kerb=K["kerb"])


def landmark_meshes(scene):
    mats = {k: dict(v) for k, v in MATERIALS.items()}
    K = ak.Kit("inari", floodlit={"inari_shu", "inari_white", "gold", "lamp_glass"}, uv={"hiwada", "stone", "setts"})
    hidden = []
    more = shrine(K, hidden)
    paths(K)
    R = romon_layout()
    if R:
        mats["inari_shu"]["flood"] = [round(R["z0"], 1), round(R["z0"] + 16.0, 1), 0.5, 0.6]
    return mats, K.out() + more + torii_hits(), {"ceilings": torii_ceilings(), "hidden": sorted(set(hidden)), "props": torii_props() + lamp_props()}


def landmark_assets(out_dir, scene):
    """The donors' names: black brush characters down a pillar's back, on a clear ground."""
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (128, 1024), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    vertical(d, "奉納 株式会社京都商店", 64, 30, 1000, "mincho", (22, 18, 16, 255), 110)
    img.save(os.path.join(out_dir, "inari.png"))
    return ["inari.png"]


def landmark_glows(scene):
    return [[a[0], a[1], 6.0, "#ffb070", 0.22] for a in lamps()]


def finalize(ctx):
    C = ctx.city
    for name, (lon, lat), up in (("Fushimi Inari Taisha 伏見稲荷大社", (135.77265, 34.96713), 18.0), ("Senbon Torii 千本鳥居", (135.77476, 34.96698), 8.0),
                                 ("Yotsutsuji 四ツ辻", YOTSUTSUJI, 8.0), ("Inari-yama 稲荷山 233 m", (135.78553, 34.96701), 10.0)):
        x, y = C.fwd.transform(lon, lat)
        ctx.labels[name] = [round(x, 1), round(y, 1), round(ctx.ground(x, y) + up, 1)]


# ---------------------------------------------------------------- the game

def xy(p):
    return [round(float(p[0]), 2), round(float(p[1]), 2)]


def game_extras(scene):
    """Spots: the foxes at the Romon, inside the Senbon Torii, the omokaru stones, Yotsutsuji's view."""
    C, T, S, osm = ctx()
    spots, chatter = [], []
    R = romon_layout()
    if R:
        P = kk.frame(R["o"], R["f"])
        p = P(R["hu"] + 8.0, 0, 0)
        spots.append({"id": "romon", "name": "The Romon and its foxes 楼門", "at": [*xy(p), round(T(*p[:2]), 2)], "verb": "Look up at the gate",
                      "lines": ["Toyotomi Hideyoshi gave this gate in 1589, they say in thanks for his mother's recovery.",
                                "The foxes are Inari's messengers. One holds a jewel; the other the key to the rice store."],
                      "radius": 5.0})
    for w in osm["ways"]:
        if w["id"] == 260121328:
            pts = [local(q) for q in w["ll"]]
            m = pts[len(pts) // 2]
            spots.append({"id": "senbon", "name": "Senbon Torii 千本鳥居", "at": [*xy(m), round(T(*m), 2)], "verb": "Look along the tunnel",
                          "lines": ["Two tunnels side by side: you keep to the right one going up. Each torii was given by a person or a company; their names are on the back.",
                                    "Look back down the way you came: from above, the black writing on every torii shows."],
                          "radius": 3.0})
            chatter.append({"at": [*xy(pts[0]), round(T(*pts[0]), 2)], "radius": 12, "side": True,
                            "lines": [["Visitor", "How many are there?"], ["Friend", "About ten thousand on the whole mountain."], ["Visitor", "And all the way to the top?"],
                                      ["Friend", "Two, three hours there and back. Yotsutsuji has the view, if your legs give up."]]})
    y = local(YOTSUTSUJI)
    spots.append({"id": "yotsutsuji", "name": "Yotsutsuji 四ツ辻", "at": [*xy(y), round(T(*y), 2)], "verb": "Look out over Kyoto",
                  "lines": ["Halfway up, the mountain opens to the west: all of Kyoto, and on a clear evening the sun going down over Arashiyama.",
                            "From here the path goes round the summit. 一ノ峰, the top, is 233 m."],
                  "radius": 5.0})
    return {"spots": spots, "chatter": chatter}
