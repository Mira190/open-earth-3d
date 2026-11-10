"""Shichirigahama, a map of Kamakura: what the generic pipeline cannot know from open data.

The model is the real coast: Overture footprints at Project PLATEAU's surveyed heights on GSI's laser terrain,
and the Enoden's line from Overture's rail (pipeline/game_rail.py). This file adds the place round the
Kamakurakokomae crossing (鎌倉高校前1号踏切) and the far view. Places only: no characters, frames, logos or art
from any anime (the rule pipeline/shinkai.py follows). Sources and what is approximate: docs/cities/kamakura.md.

  * The sheds over the Enoden's track and platforms are mapped as buildings (PLATEAU's "普通無壁舎", wall-less
    sheds). As solid blocks they would stand on the platforms and the rails, so every footprint within
    TRACK_CLEAR_M of the line's centre is left out; the platforms and their shelters are drawn from the line
    itself (web/game/rail.js).
  * The set: within SET_R of the crossing, every road OpenStreetMap maps is laid as paving on its centre line
    (Route 134, two lanes; the hill road, 日坂; the lanes off it; the pavement beside it), each level
    across its width at the height the laser terrain has on its centre line, smoothed along it. The 10 m and
    5 m terrain grids cannot hold a road 6 m wide on a hillside, so the ground under each is set to it
    (adjust_terrain) and the paving drawn on top. With it: the crossing's deck between the rails, the stop
    lines and the zebra on the uphill side, the sea wall and its railing along Route 134's sea side with the revetment below, the steps to
    the beach, the convex mirror at the east kerb and the warning sign up the hill.
  * Enoshima, 700 m past the frame's south-west corner: its relief from GSI's laser terrain every 10 m
    (enoshima_dem.json), the Sea Candle (the observation lighthouse of 2003: 59.8 m, its top 119.6 m above
    the sea, on the outline OpenStreetMap maps), the road bridge and the footbridge from Katase, and the
    harbour's breakwater.
"""
import glob
import json
import math
import os

import numpy as np
from shapely.geometry import LineString, Point
from shapely.ops import unary_union

from meshkit import Mesh

HERE = os.path.dirname(os.path.abspath(__file__))
TRACK_CLEAR_M = 1.9      # a car's half width (1.2 to 1.25 m) and the gap to a platform's edge
XING_LL = (139.5020923, 35.3066013)   # OpenStreetMap node 3937261506, the Kamakurakokomae crossing
SET_R = 330.0
# a road's paved width by class (m), and the strips across it (web/world.js deck_zones), from its left edge
ROADS = {
    "trunk": (9.6, [[1.3, "footway"], [7.0, "lanes2"], [1.3, "footway"]]),       # Route 134: two lanes of 3.5 m and their shoulders
    "tertiary": (6.2, [[0.7, "footway"], [4.8, "lanes2"], [0.7, "footway"]]),     # the hill road
    "unclassified": (4.4, None), "residential": (4.4, None),
    "footway": (2.4, [[2.4, "footway"]]),                                           # the pavement between Route 134 and the track
}
PROMENADE = 390566771    # the footway along the land side of Route 134 (OpenStreetMap way)
BEACH_STEPS = 390559761
HILL_ROAD = 165632713
SEA_CANDLE = 1311985404
BRIDGES = {26359130: (11.0, 5.5), 27423903: (4.0, 4.0)}   # Enoshima Ohashi (the road), Benten-bashi (on foot): width, deck height
BREAKWATER = 191693949

MATERIALS = {
    "km_asphalt": {"color": "#3b3d40", "roughness": 0.9, "metalness": 0.0, "solid": False, "street_lit": True},
    "km_road134": {"color": "#3b3d40", "roughness": 0.9, "metalness": 0.0, "solid": False, "pattern": "deck_zones", "zones": ROADS["trunk"][1]},
    "km_hill": {"color": "#3b3d40", "roughness": 0.9, "metalness": 0.0, "solid": False, "pattern": "deck_zones", "zones": ROADS["tertiary"][1]},
    "km_promenade": {"color": "#a9a59d", "roughness": 0.9, "metalness": 0.0, "solid": False, "pattern": "deck_zones", "zones": ROADS["footway"][1]},
    "km_paint": {"color": "#e9e6dc", "roughness": 0.8, "metalness": 0.0, "solid": False, "street_lit": True},
    "km_deck": {"color": "#8f8c84", "roughness": 0.85, "metalness": 0.0, "solid": False, "street_lit": True},
    "km_concrete": {"color": "#a8a59c", "roughness": 0.9, "metalness": 0.0},
    "km_concrete_soft": {"color": "#a8a59c", "roughness": 0.9, "metalness": 0.0, "solid": False},
    "km_rail": {"color": "#c9ccce", "roughness": 0.4, "metalness": 0.7, "solid": False},
    "km_orange": {"color": "#e8742a", "roughness": 0.6, "metalness": 0.1, "solid": False},
    "km_mirror": {"color": "#c8d4dc", "roughness": 0.08, "metalness": 1.0, "solid": False},
    "km_sign": {"color": "#f0c81e", "roughness": 0.6, "metalness": 0.0, "solid": False},
    "km_dark": {"color": "#1c1c1c", "roughness": 0.6, "metalness": 0.0, "solid": False},
    "eno_green": {"color": "#3f5a3a", "roughness": 0.95, "metalness": 0.0, "solid": False},
    "eno_rock": {"color": "#8a8173", "roughness": 0.95, "metalness": 0.0, "solid": False},
    "eno_town": {"color": "#9c9a94", "roughness": 0.9, "metalness": 0.0, "solid": False},
    "eno_white": {"color": "#eef0ee", "roughness": 0.45, "metalness": 0.2, "solid": False, "emissive": "#bfe2ff", "glow": 0.9},
    "eno_bridge": {"color": "#b5b2aa", "roughness": 0.85, "metalness": 0.0, "solid": False},
}

_osm = None


def osm():
    """The OpenStreetMap extracts kept beside this file (pipeline/osm_detail.py), as {way id: way} and nodes."""
    global _osm
    if _osm is None:
        ways, nodes = {}, {}
        for f in sorted(glob.glob(os.path.join(HERE, "*_osm.json"))):
            d = json.load(open(f, encoding="utf8"))
            for w in d["ways"]:
                ways.setdefault(w["id"], w)
            for n in d["nodes"]:
                nodes.setdefault(n["id"], n)
        _osm = ways, nodes
    return _osm


def local(C, ll):
    x, y = C.fwd.transform(*np.asarray(ll, float).T)
    return np.column_stack([x, y])


_track = None


def track(C):
    """The Enoden's tracks in the local frame."""
    global _track
    if _track is None:
        _track = unary_union([LineString(local(C, w["ll"])) for w in osm()[0].values()
                              if w["tags"].get("railway") in ("light_rail", "rail", "tram") and len(w["ll"]) > 1])
    return _track


def adjust_building(b, cls, g, geoms, ctx):
    if g.distance(track(ctx.city)) < TRACK_CLEAR_M:
        return []
    return None


# ------------------------------------------------------------------ the set: roads as paving on a level ground
def set_lines(C):
    """The roads of the set, minor ones first: [(way id, class, width, zones, LineString inside SET_R)]."""
    cx, cy = local(C, [XING_LL])[0]
    disc = Point(cx, cy).buffer(SET_R)
    out = []
    for wid, w in osm()[0].items():
        cls = w["tags"].get("highway")
        if wid == PROMENADE:
            cls = "footway"
        elif cls not in ("trunk", "tertiary", "unclassified", "residential") or w["tags"].get("bridge"):
            continue
        ln = LineString(local(C, w["ll"])).intersection(disc)
        for part in getattr(ln, "geoms", [ln]):
            if part.geom_type == "LineString" and part.length > 8:
                out.append((wid, cls, ROADS[cls][0], ROADS[cls][1], part))
    order = {"residential": 0, "unclassified": 0, "footway": 1, "tertiary": 2, "trunk": 3}
    return sorted(out, key=lambda r: (order[r[1]], r[0]))


def _bilinear(z, C, cell, x, y):
    c, r = (np.asarray(x) - C.x0) / cell, (C.y1 - np.asarray(y)) / cell
    c0, r0 = np.clip(np.floor(c).astype(int), 0, z.shape[1] - 2), np.clip(np.floor(r).astype(int), 0, z.shape[0] - 2)
    fc, fr = np.clip(c - c0, 0, 1), np.clip(r - r0, 0, 1)
    return (z[r0, c0] * (1 - fc) + z[r0, c0 + 1] * fc) * (1 - fr) + (z[r0 + 1, c0] * (1 - fc) + z[r0 + 1, c0 + 1] * fc) * fr


def _smooth(v, n):
    k = np.exp(-0.5 * (np.arange(-3 * n, 3 * n + 1) / n) ** 2)
    return np.convolve(np.pad(v, 3 * n, mode="edge"), k / k.sum(), mode="valid")


def set_profiles(z, C, cell):
    """Each road of the set every metre along its centre line, at the terrain's height there smoothed over
    6 m: {key: {cls, w, p: [[x, y, z], ...]}}. Taken from the 5 m grid and kept in set.json for the meshes."""
    out = {}
    for k, (wid, cls, w, zones, ln) in enumerate(set_lines(C)):
        n = max(2, int(ln.length) + 1)
        pts = np.array([ln.interpolate(i / (n - 1), normalized=True).coords[0] for i in range(n)])
        h = _smooth(_bilinear(z, C, cell, pts[:, 0], pts[:, 1]), 6)
        out[f"{wid}_{k}"] = {"way": wid, "cls": cls, "w": w, "p": [[round(float(x), 2), round(float(y), 2), round(float(q), 2)] for (x, y), q in zip(pts, h)]}
    return out


def adjust_terrain(z, C, cell):
    """The ground under each road of the set, and a cell either side of it, at the road's level; and under
    the Enoden's track within the set, along the line. The 5 m grid's call measures the roads' profiles."""
    from scipy.spatial import cKDTree
    path = os.path.join(HERE, "set.json")
    if cell <= 5.0 or not os.path.exists(path):
        prof = set_profiles(z, C, cell)
        json.dump({"note": "The set's roads every metre along their centre lines, at the 5 m laser terrain's height smoothed over 6 m "
                           "(cities/kamakura/city.py set_profiles); local frame, metres.", "roads": prof}, open(path, "w"), separators=(",", ":"))
    else:
        prof = json.load(open(path))["roads"]
    z = z.copy()
    ys, xs = np.mgrid[0:z.shape[0], 0:z.shape[1]]
    gx, gy = C.x0 + (xs + 0.0) * cell, C.y1 - (ys + 0.0) * cell
    cx, cy = local(C, [XING_LL])[0]
    near = (np.abs(gx - cx) < SET_R + 20) & (np.abs(gy - cy) < SET_R + 20)
    P = np.column_stack([gx[near], gy[near]])
    zz = z[near]
    for r in prof.values():
        p = np.asarray(r["p"])
        d, i = cKDTree(p[:, :2]).query(P)
        inner, outer = r["w"] / 2 + 0.8 * cell, r["w"] / 2 + 1.8 * cell
        k = np.clip((outer - d) / (outer - inner), 0, 1)
        zz = zz * (1 - k) + p[i, 2] * k
    z[near] = zz
    return z


def _ribbon(mesh, pts, w, lift, T):
    """A strip w wide along pts ([[x, y, z]]), laid `lift` over the ground as built (T: archkit.Terrain), which
    adjust_terrain has set to the road's level: three columns from its left edge, so it follows the terrain grid's
    own surface and nothing of the ground shows through it."""
    P = np.asarray(pts, float)
    rows, uvs, s = [], [], 0.0
    for k in range(len(P)):
        t = P[min(k + 1, len(P) - 1), :2] - P[max(k - 1, 0), :2]
        t = t / (np.linalg.norm(t) or 1)
        n = np.array([-t[1], t[0]])  # left
        if k:
            s += float(np.linalg.norm(P[k, :2] - P[k - 1, :2]))
        row = [P[k, :2] + n * o for o in (w / 2, 0.0, -w / 2)]
        rows.append([[*q, T(*q) + lift] for q in row])
        uvs.append([[s, 0.0], [s, w / 2], [s, w]])
    mesh.grid(rows, uvs)


def the_set(C, meshes):
    path = os.path.join(HERE, "set.json")
    if not os.path.exists(path):
        return
    prof = json.load(open(path))["roads"]
    import archkit as ak
    T = ak.Terrain("kamakura")
    by = {}
    for key, r in prof.items():
        # (Route 134 and the hill road with their lanes and edges; the lanes that meet them plain, and under them)
        mat = "km_road134" if r["cls"] == "trunk" else "km_hill" if r["way"] == HILL_ROAD else "km_promenade" if r["cls"] == "footway" else "km_asphalt"
        m = by.setdefault(mat, Mesh(f"kamakura_set_{mat[3:]}", mat, True, uv=True))
        lift = {"km_road134": 0.05, "km_hill": 0.04, "km_promenade": 0.035}.get(mat, 0.025)
        _ribbon(m, r["p"][::2] + ([r["p"][-1]] if len(r["p"]) % 2 == 0 else []), r["w"], lift, T)
    meshes += list(by.values())

    cx, cy = local(C, [XING_LL])[0]
    hill = next((r for r in prof.values() if r["way"] == HILL_ROAD), None)
    if hill is None:
        return
    hp = np.asarray(hill["p"])
    tr = track(C)
    # the crossing: where the hill road's centre line meets the track; its frame is the road's (f ahead uphill, l left)
    k0 = int(np.argmin([tr.distance(Point(*q[:2])) for q in hp]))
    X = hp[k0]
    f = hp[min(k0 + 3, len(hp) - 1), :2] - hp[max(k0 - 3, 0), :2]
    f = f / np.linalg.norm(f)
    if f[1] < 0:
        f = -f
    l = np.array([-f[1], f[0]])
    w = hill["w"]

    def zat(d):  # the road's level d metres up the hill from the crossing
        i = int(np.clip(k0 + d * (1 if hp[min(k0 + 3, len(hp) - 1), 1] > hp[k0, 1] else -1), 0, len(hp) - 1))
        return float(hp[i, 2])

    def at(d, o, h=0.0):
        q = X[:2] + f * d + l * o
        return [*q, T(*q) + h]

    def flat(mesh, d0, d1, o0, o1, h):
        mesh.quad(at(d0, o1, h), at(d0, o0, h), at(d1, o0, h), at(d1, o1, h))

    deck, paint = Mesh("kamakura_xing_deck", "km_deck", False), Mesh("kamakura_xing_paint", "km_paint", False)
    flat(deck, -1.75, 1.75, -w / 2 - 0.4, w / 2 + 0.4, 0.075)                 # the crossing's panels, to the rail head
    for d in (-4.3, 4.3):                                                       # the stop lines
        flat(paint, d - 0.22, d + 0.22, -w / 2 + 0.7, w / 2 - 0.7, 0.07)
    for o in np.arange(-w / 2 + 0.95, w / 2 - 0.9, 0.9):                        # the zebra on the uphill side
        flat(paint, 6.2, 9.2, o, o + 0.45, 0.07)
    meshes += [deck, paint]

    # the convex mirror at the east kerb: an orange post and two round mirrors, one each way along the track
    post, mir = Mesh("kamakura_mirror_post", "km_orange", True), Mesh("kamakura_mirror", "km_mirror", True)
    e = -l if l[0] < 0 else l   # east
    eo = float(np.dot(e, l))
    b = at(3.2, eo * (w / 2 + 0.55))
    post.tube([b, [b[0], b[1], b[2] + 3.3]], 0.045, 8)
    for sgn in (-1, 1):
        c = np.array([b[0], b[1], b[2] + 2.9]) + np.array([*(e * 0.0 + f * 0.0), 0]) + np.array([*(np.array([f[1], -f[0]]) * 0.38 * sgn), 0])
        ax = np.array([*(-f * 0.5 + np.array([f[1], -f[0]]) * sgn * 0.5), 0.0])
        ax /= np.linalg.norm(ax)
        u = np.cross(ax, [0, 0, 1.0])
        u /= np.linalg.norm(u)
        v = np.cross(u, ax)
        ring = [c + 0.36 * (math.cos(a) * u + math.sin(a) * v) for a in np.linspace(0, 2 * math.pi, 21)]
        hub = c + ax * 0.07
        for i in range(20):
            mir.tri(list(hub), list(ring[i]), list(ring[i + 1]))
            post.tri(list(c - ax * 0.03), list(ring[i + 1]), list(ring[i]))
    # the warning sign up the hill: a yellow diamond on a post, on the left of the way down
    sign, ink = Mesh("kamakura_warning", "km_sign", False), Mesh("kamakura_warning_ink", "km_dark", False)
    sb = at(34, -eo * (w / 2 + 0.5) * (1 if eo else 1))
    post.tube([sb, [sb[0], sb[1], sb[2] + 2.6]], 0.03, 6)
    side = np.array([*l, 0.0])
    cz = np.array([sb[0], sb[1], sb[2] + 2.25]) - np.array([*f, 0]) * -0.04
    dia = [cz + side * 0.42, cz + np.array([0, 0, 0.42]), cz - side * 0.42, cz - np.array([0, 0, 0.42])]
    sign.quad(*[list(q) for q in dia])
    sign.quad(*[list(q) for q in dia[::-1]])
    meshes += [post, mir, sign, ink]

    # the sea wall: along Route 134's sea side, a wall 0.9 m high with a rail on it, and the revetment below it
    # (the footway OpenStreetMap maps beside the road is the pavement on its land side, between the road and the track)
    prom = [r for r in prof.values() if r["cls"] == "trunk"]
    wall, rail, rev = Mesh("kamakura_seawall", "km_concrete", False, uv=False), Mesh("kamakura_seawall_rail", "km_rail", False), Mesh("kamakura_revetment", "km_concrete_soft", True)
    for r in prom:
        P = np.asarray(r["p"])[::3]
        if len(P) < 2:
            continue
        t = np.gradient(P[:, :2], axis=0)
        t /= np.linalg.norm(t, axis=1, keepdims=True)
        n = np.column_stack([-t[:, 1], t[:, 0]])
        sea = np.where((n[:, 1] < 0)[:, None], n, -n)   # the side towards the south
        edge = P[:, :2] + sea * (r["w"] / 2 + 0.12)
        top = [[*q, z + 0.9] for q, z in zip(edge, P[:, 2])]
        for a, b2, za, zb in zip(edge, edge[1:], P[:, 2], P[1:, 2]):
            wall.box([*a, za + 0.45], [*b2, zb + 0.45], 0.24, 0.9)
        rail.rails(top, 0.3, post_every=2.0, post=0.04, rail=0.04, rails=1)
        # the revetment: the concrete slope from the wall's foot down to the sand, laid on the ground as built
        rev.grid([[[*(q + sd * dd), (za + 0.02) if dd == 0 else min(za, T(*(q + sd * dd))) + 0.06] for dd in (0.0, 3.0, 6.0, 9.0, 12.0, 15.0)][::-1]
                  for q, sd, za in zip(edge, sea, P[:, 2])])
    meshes += [wall, rail, rev]

    # the steps down to the beach by the crossing, where OpenStreetMap maps them
    st = osm()[0].get(BEACH_STEPS)
    if st:
        sp = local(C, st["ll"])
        a, b2 = (sp[0], sp[-1]) if sp[0][1] > sp[-1][1] else (sp[-1], sp[0])   # from the top (north) down
        za = min((float(r["p"][int(np.argmin([math.hypot(q[0] - a[0], q[1] - a[1]) for q in r["p"]]))][2]) for r in prom), default=8.0)
        steps = Mesh("kamakura_beach_steps", "km_concrete_soft", False)
        L = float(np.linalg.norm(b2 - a))
        nst = max(8, int((za - 1.5) / 0.17))
        d = (b2 - a) / L
        for i in range(nst):
            p0, p1 = a + d * (L * i / nst), a + d * (L * (i + 1) / nst)
            zs = za - (za - 1.5) * (i + 1) / nst
            steps.box([*p0, zs - 0.1], [*p1, zs - 0.1], 2.4, 0.2)
        meshes.append(steps)


# ------------------------------------------------------------------ Enoshima, in the far view
def enoshima(C, meshes):
    path = os.path.join(HERE, "enoshima_dem.json")
    if not os.path.exists(path):
        return
    D = json.load(open(path))
    nx, ny, cell = D["nx"], D["ny"], D["cell"]
    H = np.asarray(D["z_dm"], float).reshape(ny, nx) / 10
    gy, gx = np.gradient(H, cell)
    slope = np.hypot(gx, gy)
    green, rock, town = Mesh("enoshima_wood", "eno_green", True), Mesh("enoshima_rock", "eno_rock", True), Mesh("enoshima_town", "eno_town", True)
    P = lambda i, j: [D["x0"] + i * cell, D["y0"] + j * cell, float(H[j, i]) + 1.0]
    for j in range(ny - 1):
        for i in range(nx - 1):
            hs = [H[j, i], H[j, i + 1], H[j + 1, i + 1], H[j + 1, i]]
            if max(hs) < 0.4:
                continue
            s = float(slope[j:j + 2, i:i + 2].mean())
            m = rock if s > 0.75 or (max(hs) < 6 and s > 0.2) else town if (max(hs) < 9 and s < 0.12) else green
            m.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1))
    for m in (green, rock, town):
        m.weld(0.01)
    meshes += [green, rock, town]

    ways = osm()[0]
    ground = lambda x, y: float(H[int(np.clip(round((y - D["y0"]) / cell), 0, ny - 1)), int(np.clip(round((x - D["x0"]) / cell), 0, nx - 1))])
    sc = ways.get(SEA_CANDLE)
    if sc:
        c = local(C, sc["ll"]).mean(axis=0)
        z0 = ground(*c)
        top = 119.6                        # its top above the sea (the tower is 59.8 m with its lightning rod)
        tw = Mesh("enoshima_sea_candle", "eno_white", True, floodlit=True)
        b = top - 59.8
        if abs(b - z0) > 6:                # the published figures and the terrain should agree to a few metres
            print(f"  Sea Candle: its foot by the published heights is {b:.1f} m, the terrain there {z0:.1f} m")
        # an inverted cone of struts round a core, opening to the deck at 41.75 m, the lantern and the rod above
        tw.lathe([(b, 1.6), (b + 36, 1.6), (b + 36, 0.5), (b + 59.8, 0.12)], tuple(c), 12)
        tw.lathe([(b + 2, 3.0), (b + 37.5, 6.6), (b + 41.75, 7.4), (b + 43.2, 7.4), (b + 43.2, 6.0), (b + 46.5, 5.2), (b + 46.5, 2.4), (b + 50, 2.0)], tuple(c), 24)
        meshes.append(tw)
    br = Mesh("enoshima_bridges", "eno_bridge", False)
    for wid, (w, h) in BRIDGES.items():
        if wid in ways:
            p = local(C, ways[wid]["ll"])
            a, b2 = p[0], p[-1]
            br.box([*a, h], [*b2, h], w, 0.9)
            L = float(np.linalg.norm(b2 - a))
            for t in np.arange(15, L - 5, 30):
                q = a + (b2 - a) * t / L
                br.box([*q, -1.0], [*q, h - 0.4], 1.6, 1.6)
    bw = ways.get(BREAKWATER)
    if bw:
        p = local(C, bw["ll"])
        for a, b2 in zip(p, p[1:]):
            br.box([*a, 1.2], [*b2, 1.2], 9.0, 3.6)
    meshes.append(br)


def landmark_meshes(scene):
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), "pipeline"))
    from cityctx import City
    C = City("kamakura")
    meshes = []
    the_set(C, meshes)
    enoshima(C, meshes)
    return {k: dict(v) for k, v in MATERIALS.items()}, [m for m in meshes if m.v]


def finalize(ctx):
    C = ctx.city
    for name, ll, up in (("Kamakurakokomae crossing 鎌倉高校前1号踏切", XING_LL, 9.0), ("Kamakurakokomae 鎌倉高校前", (139.5007, 35.30672), 9.0),
                         ("Koshigoe 腰越", (139.4932, 35.3084), 10.0), ("Enoshima Station 江ノ島駅", (139.4875, 35.3110), 10.0),
                         ("Shichirigahama 七里ヶ浜", (139.5101, 35.3063), 10.0), ("Inamuragasaki 稲村ヶ崎", (139.5255, 35.3022), 22.0),
                         ("Kamakura High School 鎌倉高校", (139.5024, 35.3078), 24.0), ("Koshigoe fishing harbour 腰越漁港", (139.4905, 35.3062), 10.0)):
        x, y = C.fwd.transform(*ll)
        ctx.labels[name] = [round(x, 1), round(y, 1), round(ctx.ground(x, y) + up, 1)]
