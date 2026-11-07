"""The Shuto Expressway's Inner Circular Route (首都高速都心環状線) over the Nihonbashi River, as it stands in
2026: built for the 1964 Olympics over the river, it passes a few metres over Nihonbashi's lamp standards.
The undergrounding (日本橋区間地下化事業, approved 2020) has taken down the Edobashi and Gofukubashi ramps
(2021-22); the tunnel is due to open in fiscal 2035 and the viaduct over the bridge to come down by fiscal
2040, so in 2026 the main line still stands over the river.

What is drawn, from photographs of the river and the bridge (no published drawing was found):
  * each carriageway's deck along its OpenStreetMap centre line (Overture segments), 9 m wide (two lanes and
    their strips), a concrete slab under a solid parapet, on two steel box girders painted the Shuto's pale
    grey-green;
  * the road's height measured from Tokyo's airborne LiDAR (cities/tokyo/shuto_lidar.py, CC BY 4.0): 14.1 m
    (T.P.) over Nihonbashi, whose deck is at 5.4 m there and whose kirin lamp standards top out at 12.75 m in
    the same survey; it falls to 11-12 m upstream by Ichikoku-bashi and is 12.5-13.8 m at Edobashi JCT. (The
    photographs' estimate, 17 m, and OpenStreetMap's layers, 6 m a level, 22 m, were both too high);
  * two steel box girders under the slab, GIRDER deep, shallowing over the bridge so that their soffit clears
    the lamp standards by CLEAR (the survey leaves only about a metre between the lamps and the road);
  * steel T-piers standing in the river every SPAN metres, none on a bridge's deck, their caps under both
    girders;
  * the deck's lamp posts along the parapets, lit after dark.

`python cities/tokyo/shuto.py --relevel` takes shuto.json's heights again from shuto_lidar.json without the raw data;
`python cities/tokyo/shuto.py --game` puts game.json's expressway lines on the LiDAR's heights and on the decks.
`python cities/tokyo/shuto.py` reads the raw Overture segments, water and bridges (fetch_overture.py
--only water infrastructure segment) and writes cities/tokyo/shuto.json; the build reads that file:

  meshes    the decks, girders, piers and lamps (pipeline/landmarks.py)
  surfaces  the decks as strips the game's traffic drives and the boats pass under (game_extras.py), so
            web/game/decks.js lays the expressway's lines on them and draws no deck of its own there
  paths     with --game, the expressway's lines in game.json are put on the strips, as game_data.py puts a
            line a level up onto a surface under it
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "shuto.json")
NAME = "首都高速都心環状線"
BRIDGE = (1403.4, 1561.0)      # Nihonbashi's centre (scene.json water_bridges)
X_FROM = 1190.0                # m, the west end of the stretch drawn (the river past Ichikoku-bashi)
LIDAR = os.path.join(HERE, "shuto_lidar.json")   # the road's surface measured from the LiDAR (shuto_lidar.py)
LIDAR_R = 4.5                  # m: a sample this near a carriageway's point gives its height
LAMP_TOP = 12.75               # T.P. m, the top of Nihonbashi's middle lamp standards (the LiDAR)
CLEAR = 0.3                    # m between the lamps' tops and the girders' soffit
GIRDER_MIN = 0.7               # m, the girders' depth over the lamps at least
SHALLOW_R = (14.0, 40.0)       # m from the bridge's centre: the girders shallow inside the first, full outside the second
SAME_LINE_M = 3.0              # m: samples of lines the data puts further apart than this are other decks
FIRST = (150.0, 1500.0)        # shuto_lidar.py's first survey (#272): game.json's lines there were put on it then
ON_SAMPLE_M = 0.3
MOVED_GRADE = 0.1              # a moved point climbs or falls at most this to its neighbours              # m: a point this near a sample's measured height already stands on it
SURVEY_M = 30.0                # m: a line point this near any sample is inside the survey
GROUND_LINE_M = 8.0            # T.P. m: a line point under this is on the ground here (the ground is 2-5 m), not on a viaduct
TAPER_M = 150.0                # m along a line outside the survey over which its offset from the survey eases to nothing
HALF = 4.5                     # m, half a carriageway's deck
SLAB = 0.35                    # m, the concrete slab under the road
GIRDER = 2.2                   # m, the box girders' depth under the slab
PARAPET = 1.0                  # m, over the road
SPAN = 34.0                    # m between the piers
STEP = 12.0                    # m between the profile's points (and the game's strips)
LAMP_EVERY = 34.0
MATERIALS = {
    "shuto_steel": {"color": "#8b968f", "roughness": 0.6, "metalness": 0.25},
    "shuto_concrete": {"color": "#a9a69d", "roughness": 0.9, "metalness": 0.0},
    "shuto_road": {"color": "#4d4f52", "roughness": 0.9, "metalness": 0.0},
    "shuto_post": {"color": "#7d8582", "roughness": 0.5, "metalness": 0.6},
    "shuto_lamp": {"color": "#fff1d6", "roughness": 0.3, "metalness": 0.0, "emissive": "#ffd9a0", "glow": 1.4},
}


def load():
    if not os.path.exists(PATH):
        return None
    return json.load(open(PATH, encoding="utf8"))


def _frames(pts):
    """Unit tangents and left normals along a polyline."""
    P = np.asarray(pts, float)
    d = np.gradient(P[:, :2], axis=0)
    t = d / np.maximum(np.hypot(d[:, 0], d[:, 1])[:, None], 1e-9)
    return t, np.column_stack([-t[:, 1], t[:, 0]])


def girder(x, y, z):
    """The box girders' depth under a road at z: GIRDER, shallowing over Nihonbashi to clear its lamp standards."""
    d = float(np.hypot(x - BRIDGE[0], y - BRIDGE[1]))
    over = max(GIRDER_MIN, min(GIRDER, z - SLAB - LAMP_TOP - CLEAR))
    t = float(np.clip((d - SHALLOW_R[0]) / (SHALLOW_R[1] - SHALLOW_R[0]), 0.0, 1.0))
    return over + (GIRDER - over) * (3 * t * t - 2 * t * t * t)


_LIDAR = {}


def lidar():
    """The LiDAR samples as (xy array, z array, data z array, KD-tree), or None without shuto_lidar.json."""
    if "S" not in _LIDAR:
        if not os.path.exists(LIDAR):
            _LIDAR["S"] = None
        else:
            from scipy.spatial import cKDTree
            A = np.asarray(json.load(open(LIDAR, encoding="utf8"))["samples"], float)
            _LIDAR["S"] = (A[:, :2], A[:, 2], A[:, 4], cKDTree(A[:, :2]))
    return _LIDAR["S"]


def lidar_z(x, y, near=None):
    """The measured road height at (x, y): the nearest sample within LIDAR_R (of those whose data height is
    nearest `near`, where decks stack), or None."""
    S = lidar()
    if S is None:
        return None
    xy, z, dz, T = S
    ks = T.query_ball_point([x, y], LIDAR_R)
    if not ks:
        return None
    if near is not None:      # only a sample of a line the data puts within SAME_LINE_M of this one (not a deck over it),
        # or one the point already stands on (game.json's lines in the first survey are on its samples: --game again
        # leaves them, #290)
        gap = lambda k: min(abs(dz[k] - near), abs(z[k] - near) if abs(z[k] - near) <= ON_SAMPLE_M else 99.0)
        ks = [k for k in ks if gap(k) <= SAME_LINE_M]
        if not ks:
            return None
        best = min(gap(k) for k in ks)
        ks = [k for k in ks if gap(k) <= best + 0.5]
    k = min(ks, key=lambda k: (xy[k, 0] - x) ** 2 + (xy[k, 1] - y) ** 2)
    return float(z[k])


# ---------------------------------------------------------------- the build hooks

def meshes(Mesh):
    S = load()
    if not S:
        return {}, []
    steel = Mesh("shuto_steel", "shuto_steel", False)
    conc = Mesh("shuto_parapet_shuto_concrete", "shuto_concrete", False)
    deck = Mesh("shuto_deck_shuto_road", "shuto_road", False)
    post = Mesh("shuto_post", "shuto_post", False)
    lamp = Mesh("shuto_lamp", "shuto_lamp", False)
    for cw in S["ways"]:
        P = np.asarray(cw["pts"], float)
        t, n = _frames(P)
        for k in range(len(P) - 1):
            a, b = P[k], P[k + 1]
            na, nb = n[k], n[k + 1]
            L = lambda p, nn, v, z: [*(p[:2] + nn * v), p[2] + z]
            # the road and the slab's soffit and edges
            deck.quad(L(a, na, -HALF, 0), L(b, nb, -HALF, 0), L(b, nb, HALF, 0), L(a, na, HALF, 0))
            conc.quad(L(a, na, HALF, -SLAB), L(b, nb, HALF, -SLAB), L(b, nb, -HALF, -SLAB), L(a, na, -HALF, -SLAB))
            for s in (-1, 1):
                # the parapet: a solid wall 0.35 m thick, its outer face down to the slab's soffit
                o, i = HALF * s, (HALF - 0.35) * s
                q = (lambda u, v, w, x: conc.quad(u, v, w, x)) if s > 0 else (lambda u, v, w, x: conc.quad(v, u, x, w))
                q(L(a, na, o, -SLAB), L(b, nb, o, -SLAB), L(b, nb, o, PARAPET), L(a, na, o, PARAPET))
                q(L(b, nb, i, 0), L(a, na, i, 0), L(a, na, i, PARAPET), L(b, nb, i, PARAPET))
                q(L(a, na, o, PARAPET), L(b, nb, o, PARAPET), L(b, nb, i, PARAPET), L(a, na, i, PARAPET))
            # the two box girders under the slab, their bottom flanges wider than their webs
            for v in (-HALF * 0.5, HALF * 0.5):
                ga, gb = girder(a[0], a[1], a[2]), girder(b[0], b[1], b[2])
                g = (ga + gb) / 2
                za, zb = a[2] - SLAB - g / 2, b[2] - SLAB - g / 2
                steel.box([*(a[:2] + na * v), za], [*(b[:2] + nb * v), zb], 2.2, g)
            # a cross-frame between the girders every segment
            cf = min(1.2, girder(a[0], a[1], a[2]))
            steel.box([*(a[:2] - na * HALF * 0.5), a[2] - SLAB - cf / 2 - 0.05], [*(a[:2] + na * HALF * 0.5), a[2] - SLAB - cf / 2 - 0.05], 0.3, cf)
        for x, y, z in cw["lamps"]:
            k = int(np.argmin(np.hypot(P[:, 0] - x, P[:, 1] - y)))
            for s in (-1, 1):
                base = np.array([x, y]) + n[k] * (HALF - 0.2) * s
                head = base - n[k] * 1.6 * s
                post.box([*base, z + PARAPET], [*base, z + 9.5], 0.22, 0.22)
                post.box([*base, z + 9.5], [*head, z + 9.9], 0.16, 0.16)
                lamp.box([*head, z + 9.75], [*(head - n[k] * 0.7 * s), z + 9.75], 0.35, 0.18)
    for p in S["piers"]:
        c, ax, w, top, g = np.asarray(p["at"], float), np.asarray(p["across"], float), p["width"], p["top"], p["bed"]
        along = np.array([ax[1], -ax[0]])
        # the column, from the river's bed to the cap; the cap across under the girders, tapering to its ends
        steel.box([*c, g], [*c, top - 1.8], 2.4, 2.0)
        steel.box([*(c - ax * w / 2), top - 0.9], [*(c + ax * w / 2), top - 0.9], 1.8, 1.8)
        steel.box([*(c - ax * w / 2 + along * 0), top - 2.0], [*(c - ax * 1.2), top - 2.8], 1.6, 1.0)
        steel.box([*(c + ax * w / 2), top - 2.0], [*(c + ax * 1.2), top - 2.8], 1.6, 1.0)
    return MATERIALS, [m for m in (steel, conc, deck, post, lamp) if m.v]


def glows():
    S = load()
    if not S:
        return []
    return [[round(x, 1), round(y, 1), round(z + 9.6, 1), "#ffd9a0", 0.35] for cw in S["ways"] for x, y, z in cw["lamps"]]


def cover():
    """Where the water closes over the photograph of the riverbed (landmarks.json "water_cover", web/world.js):
    the stretch's outline, both carriageways and the 6-16 m between them, which the photograph also shows
    covered by the real deck over the river (issue 234), with 3 m for its lean in the photograph."""
    import shapely
    from shapely.geometry import LineString
    S = load()
    if not S:
        return []
    g = shapely.union_all([LineString([p[:2] for p in cw["pts"]]).buffer(HALF + 3.0) for cw in S["ways"]]).buffer(10.0).buffer(-10.0)
    return [[[round(x, 1), round(y, 1)] for x, y in q.exterior.simplify(0.5).coords] for q in getattr(g, "geoms", [g])]


def surfaces():
    """Each carriageway as straight strips STEP long, a metre over into the next, for the game."""
    S = load()
    if not S:
        return []
    out = []
    for cw in S["ways"]:
        P = np.asarray(cw["pts"], float)
        for k in range(len(P) - 1):
            a, b = P[k], P[k + 1]
            d = b[:2] - a[:2]
            L = float(np.hypot(*d))
            if L < 0.5:
                continue
            ax = d / L
            c = (a[:2] + b[:2]) / 2
            out.append({"name": f"the Shuto Expressway ({cw['dir']})", "type": "strip", "origin": [round(float(c[0]), 2), round(float(c[1]), 2)],
                        "axis": [round(float(ax[0]), 5), round(float(ax[1]), 5)], "half_width": HALF,
                        "profile": [[round(-L / 2 - 0.6, 2), round(float(a[2]), 2)], [round(L / 2 + 0.6, 2), round(float(b[2]), 2)]],
                        "thickness": SLAB + GIRDER, "mesh": "shuto_deck", "fly_under": True, "cover": True, "label": "the Shuto Expressway"})
    return out


def on_strips(game):
    """Put game.json's expressway lines (paths.road, class motorway) that lie along a carriageway onto its deck:
    the point's height is the strip's, as game_data.py sets a line a level up on a surface under it."""
    S = surfaces()
    if not S:
        return 0
    n = 0
    for o in game["paths"]["road"]:
        if o["c"] != "motorway":
            continue
        p = o["p"]
        for i in range(0, len(p), 3):
            x, y, z = p[i] / 10, p[i + 1] / 10, p[i + 2] / 10
            for s in S:
                u = (x - s["origin"][0]) * s["axis"][0] + (y - s["origin"][1]) * s["axis"][1]
                v = -(x - s["origin"][0]) * s["axis"][1] + (y - s["origin"][1]) * s["axis"][0]
                (u0, z0), (u1, z1) = s["profile"]
                if abs(v) <= HALF and u0 <= u <= u1:
                    zz = round((z0 + (z1 - z0) * (u - u0) / (u1 - u0)) * 10)
                    if zz != p[i + 2]:
                        p[i + 2] = zz
                        n += 1
                    break
    return n


# ---------------------------------------------------------------- shuto.json

def build():
    import sys
    sys.path.insert(0, os.path.join(HERE, "..", "..", "pipeline"))
    sys.argv = [sys.argv[0], "--city", "tokyo"]
    import shapely
    from shapely.geometry import LineString, Point
    import japankit as jk
    from build_scene import sample
    from cityctx import city_args
    import refresh_bridges as rb
    C, _ = city_args("shuto")
    G = rb.walking_ground(C)
    ground = lambda x, y: float(sample(C, G, x, y)[0])
    water = shapely.union_all([r["geom"] for r in jk.overture(C, "water", "class IN ('river', 'canal')") if r["geom"].geom_type in ("Polygon", "MultiPolygon")])
    scene = json.load(open(os.path.join(C.out, "scene.json"), encoding="utf8"))
    decks = []
    for b in scene["landmarks"].get("water_bridges", []):
        c, ax, L, W = np.asarray(b["centre"]), np.asarray(b["axis"]), b["length_m"], b["width_m"]
        decks.append(LineString([c - ax * L / 2, c + ax * L / 2]).buffer(W / 2 + 4.0))
    decks = shapely.union_all(decks)
    gj = json.load(open(os.path.join(C.out, "game.json"), encoding="utf8"))
    motorway = [(o["p"][i] / 10, o["p"][i + 1] / 10, o["p"][i + 2] / 10) for o in gj["paths"]["road"] if o["c"] == "motorway"
                for i in range(0, len(o["p"]), 3)]
    rows = [r for r in jk.overture(C, "segment", f"subtype = 'road' AND class = 'motorway' AND name = '{NAME}'")
            if r["geom"].geom_type == "LineString"]
    ways = []
    for r in rows:
        g = r["geom"]
        lv = max([q["value"] for q in (r["level_rules"] or []) if q.get("value") is not None] or [0])
        if lv < 2:
            continue
        cs = np.asarray(g.coords)
        cut = g.intersection(shapely.box(X_FROM, cs[:, 1].min() - 1, cs[:, 0].max() + 1, cs[:, 1].max() + 1))
        if cut.is_empty or cut.length < 100 or cut.distance(Point(*BRIDGE)) > 30:
            continue
        cut = max(getattr(cut, "geoms", [cut]), key=lambda q: q.length)
        c2 = np.asarray(cut.coords)
        d = "east" if c2[-1, 0] > c2[0, 0] else "west"
        if d == "west":   # (the profile and the pier stations run west to east)
            cut = LineString(c2[::-1])
        # the data's own height (the game's line there: game_data.py's ground and 6 m a level), where the LiDAR has none
        def data_z(x, y):
            return min(((qx - x) ** 2 + (qy - y) ** 2, qz) for qx, qy, qz in motorway)[1]
        n = max(2, int(cut.length / STEP) + 1)
        pts = []
        for k in range(n):
            q = cut.interpolate(k / (n - 1), normalized=True)
            pts.append([q.x, q.y])
        heights(pts, data_z)
        # lamps along it every LAMP_EVERY
        line = LineString([p[:2] for p in pts])
        lamps = []
        for s in np.arange(LAMP_EVERY / 2, line.length, LAMP_EVERY):
            q = line.interpolate(s)
            k = int(np.argmin([abs(line.project(Point(*p[:2])) - s) for p in pts]))
            lamps.append([round(q.x, 2), round(q.y, 2), pts[k][2]])
        ways.append({"dir": d, "osm": r["id"], "pts": [[round(p[0], 2), round(p[1], 2), p[2]] for p in pts], "lamps": lamps, "line": line})
    # the piers: every SPAN along each carriageway, standing in the river and off the bridges; where the other
    # carriageway's deck is within a cap's reach, one pier carries both
    piers = []
    for w in ways:
        line, P = w["line"], np.asarray(w["pts"])
        for s in np.arange(SPAN / 2, line.length - 4, SPAN):
            q = line.interpolate(s)
            k = int(np.argmin(np.hypot(P[:, 0] - q.x, P[:, 1] - q.y)))
            t = P[min(k + 1, len(P) - 1), :2] - P[max(k - 1, 0), :2]
            t /= max(np.hypot(*t), 1e-9)
            nrm = np.array([-t[1], t[0]])
            c = np.array([q.x, q.y])
            if not water.buffer(-2.5).contains(Point(*c)) or decks.contains(Point(*c)):
                continue
            if any(np.hypot(*(np.asarray(p["at"]) - c)) < SPAN * 0.4 for p in piers):
                continue
            top = float(P[k, 2]) - SLAB - girder(c[0], c[1], float(P[k, 2]))
            piers.append({"at": [round(float(c[0]), 2), round(float(c[1]), 2)], "across": [round(float(nrm[0]), 4), round(float(nrm[1]), 4)],
                          "width": 2 * HALF + 0.6, "top": round(top, 2), "bed": -2.0})
    for w in ways:
        del w["line"]
    with open(PATH, "w", encoding="utf8") as f:
        json.dump({"note": "The Shuto Expressway's Inner Circular Route over the Nihonbashi River (cities/tokyo/shuto.py): each carriageway's "
                   "centre line from OpenStreetMap (ODbL, via Overture) in the local frame [x, y, road z], lamps [x, y, road z], "
                   "piers [centre, across, width, cap top, bed].", "ways": ways, "piers": piers}, f, ensure_ascii=False, separators=(",", ":"))
    for w in ways:
        print(f"{w['dir']}: {len(w['pts'])} points, road {min(p[2] for p in w['pts']):.1f} to {max(p[2] for p in w['pts']):.1f} m, {len(w['lamps'])} lamps")
    print(f"{len(piers)} piers in the river")


def heights(pts, fallback=None):
    """Set each [x, y(, z)] point's road height from the LiDAR samples (or fallback(x, y), or its own z), smoothed
    along the carriageway (a vertical curve), the ends kept."""
    z = []
    for p in pts:
        h = lidar_z(p[0], p[1])
        z.append(h if h is not None else (fallback(p[0], p[1]) if fallback else p[2]))
    z = np.asarray(z, float)
    for _ in range(3):
        z[1:-1] = (z[:-2] + 2 * z[1:-1] + z[2:]) / 4
    for p, zz in zip(pts, z):
        p[2:] = [round(float(zz), 2)]


def relevel():
    """--relevel: shuto.json's heights again from the LiDAR samples, without the raw data: each carriageway's points,
    its lamps and the piers' caps."""
    S = load()
    for cw in S["ways"]:
        heights(cw["pts"])
        P = np.asarray(cw["pts"], float)
        for lp in cw["lamps"]:
            k = int(np.argmin(np.hypot(P[:, 0] - lp[0], P[:, 1] - lp[1])))
            lp[2] = cw["pts"][k][2]
    allp = np.asarray([p for cw in S["ways"] for p in cw["pts"]], float)
    for pr in S["piers"]:
        c = pr["at"]
        k = int(np.argmin(np.hypot(allp[:, 0] - c[0], allp[:, 1] - c[1])))
        pr["top"] = round(float(allp[k, 2]) - SLAB - girder(c[0], c[1], float(allp[k, 2])), 2)
    json.dump(S, open(PATH, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    for cw in S["ways"]:
        print(f"{cw['dir']}: road {min(p[2] for p in cw['pts']):.1f} to {max(p[2] for p in cw['pts']):.1f} m")
    print(f"{len(S['piers'])} piers, caps {min(p['top'] for p in S['piers']):.1f} to {max(p['top'] for p in S['piers']):.1f} m")


def on_lidar(game):
    """Put game.json's elevated expressway lines (paths.road, class motorway) on the LiDAR's heights: a point within
    LIDAR_R of a sample takes its height (the sample of the line whose data height is nearest, where decks stack);
    a line that runs on out of the survey eases from its offset there back to its own height over TAPER_M along it,
    and the lines joined to it end to end the same, so the junctions meet. Returns the points moved."""
    if lidar() is None:
        return 0
    roads = [o for o in game["paths"]["road"] if o["c"] == "motorway"]
    P = [np.asarray(o["p"], float).reshape(-1, 3) / 10 for o in roads]
    off = [np.full(len(p), np.nan) for p in P]
    for p, f in zip(P, off):
        for i, (x, y, z) in enumerate(p):
            if z < GROUND_LINE_M:  # on the ground (or in a cutting): not on a viaduct
                continue
            if x > FIRST[0] and y > FIRST[1]:   # the first survey's lines already stand on its samples (#290)
                f[i] = 0.0
                continue
            h = lidar_z(x, y, near=z)
            if h is not None:
                f[i] = h - z
    # a line that comes down to the ground (or into a cutting) beyond its last sample: straight from that sample to
    # where it meets the ground
    for p, f in zip(P, off):
        ok = np.nonzero(np.isfinite(f))[0]
        if not len(ok):
            continue
        s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p[:, :2], axis=0).T))])
        for a, ends in ((ok[0], range(ok[0] - 1, -1, -1)), (ok[-1], range(ok[-1] + 1, len(p)))):
            ends = list(ends)
            low = [i for i in ends if p[i, 2] < GROUND_LINE_M]
            if not low:
                continue
            b = low[0]
            za, zb = p[a, 2] + f[a], p[b, 2]
            for i in ends:
                if i == b:
                    break
                t = (s[i] - s[a]) / (s[b] - s[a])
                f[i] = za + (zb - za) * t - p[i, 2]
    # inside the survey, a stretch no sample reached (under another deck) keeps its line's nearest measured height
    xy, _, _, T = lidar()
    for p, f in zip(P, off):
        ok = np.nonzero(np.isfinite(f))[0]
        if not len(ok):
            continue
        s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p[:, :2], axis=0).T))])
        for i in range(len(p)):
            if np.isfinite(f[i]) or p[i, 2] < GROUND_LINE_M or not T.query_ball_point(p[i, :2], SURVEY_M):
                continue
            j = ok[np.argmin(np.abs(s[ok] - s[i]))]
            f[i] = p[j, 2] + f[j] - p[i, 2]
    # ease the offsets out along each line and through its ends into the next, TAPER_M long
    key = lambda q: (round(q[0], 1), round(q[1], 1))
    ends = {}
    for li, p in enumerate(P):
        ends.setdefault(key(p[0]), []).append((li, 0))
        ends.setdefault(key(p[-1]), []).append((li, len(p) - 1))
    for _ in range(4):        # a few rounds carry an offset across the junctions
        changed = False
        for li, (p, f) in enumerate(zip(P, off)):
            s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p[:, :2], axis=0).T))])
            src = [(s[i], f[i]) for i in range(len(p)) if np.isfinite(f[i])]
            for e, i in ((key(p[0]), 0), (key(p[-1]), len(p) - 1)):
                if np.isfinite(f[i]):
                    continue
                for lj, j in ends.get(e, []):
                    if lj != li and np.isfinite(off[lj][j]):
                        src.append((s[i], off[lj][j]))
                        break
            if not src:
                continue
            for i in range(len(p)):
                if np.isfinite(f[i]) or p[i, 2] < GROUND_LINE_M:
                    continue
                d, o = min(((abs(s[i] - si), oi) for si, oi in src), key=lambda t: t[0])
                if d < TAPER_M:
                    f[i] = o * (1 - d / TAPER_M)
                    changed = True
        if not changed:
            break
    # no step where a moved point meets one that stays (a ramp's foot on the ground, a junction): the moved points
    # eased toward their neighbours, to at most MOVED_GRADE between them, back and forth along the line (#290)
    for p, f in zip(P, off):
        moved = np.isfinite(f) & (np.abs(np.nan_to_num(f)) > 0.05)
        if not moved.any():
            continue
        z = p[:, 2] + np.where(moved, np.nan_to_num(f), 0.0)
        s = np.hypot(*np.diff(p[:, :2], axis=0).T)
        for _ in range(6):
            for order in (range(1, len(p)), range(len(p) - 2, -1, -1)):
                for i in order:
                    j = i - 1 if order.step == 1 else i + 1
                    if not moved[i]:
                        continue
                    d = s[min(i, j)] * MOVED_GRADE
                    z[i] = min(max(z[i], z[j] - d), z[j] + d)
        f[moved] = z[moved] - p[moved, 2]
    n = 0
    for o, p, f in zip(roads, P, off):
        for i in range(len(p)):
            if np.isfinite(f[i]) and abs(f[i]) > 0.05:
                o["p"][3 * i + 2] = int(round((p[i, 2] + f[i]) * 10))
                n += 1
    return n


def game():
    """--game: game.json's surfaces and the expressway's lines brought up to shuto.json, without the rebuild
    (pipeline/game_extras.py rewrites the surfaces the same way)."""
    path = os.path.join(HERE, "..", "..", "web", "data", "tokyo", "game.json")
    G = json.load(open(path, encoding="utf8"))
    m = on_lidar(G)
    n = on_strips(G)
    json.dump(G, open(path, "w"), separators=(",", ":"))   # as game_extras.py writes it
    print(f"{m} expressway points put on the LiDAR's heights, {n} on the decks -> {path}")


if __name__ == "__main__":
    import sys
    if "--relevel" in sys.argv:
        relevel()
    elif "--game" in sys.argv:
        game()
    else:
        build()
