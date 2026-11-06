"""The Shuto Expressway's Inner Circular Route (首都高速都心環状線) over the Nihonbashi River, as it stands in
2026: built for the 1964 Olympics over the river, it passes a few metres over Nihonbashi's lamp standards.
The undergrounding (日本橋区間地下化事業, approved 2020) has taken down the Edobashi and Gofukubashi ramps
(2021-22); the tunnel is due to open in fiscal 2035 and the viaduct over the bridge to come down by fiscal
2040, so in 2026 the main line still stands over the river.

What is drawn, from photographs of the river and the bridge (no published drawing was found):
  * each carriageway's deck along its OpenStreetMap centre line (Overture segments), 9 m wide (two lanes and
    their strips), a concrete slab under a solid parapet, on two steel box girders painted the Shuto's pale
    grey-green;
  * the road over Nihonbashi at 17.0 m (T.P.), so that the girders' soffit clears the kirin lamp standards'
    globes (12.3 m, pipeline/bridges.py) by about two metres, as the photographs show; away from the bridge it
    eases to the heights the data gives the viaducts beyond (OpenStreetMap's layers, 6 m a level: 22 m and
    16 m at Edobashi), so it meets them;
  * steel T-piers standing in the river every SPAN metres, none on a bridge's deck, their caps under both
    girders;
  * the deck's lamp posts along the parapets, lit after dark.

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
ROAD_M = 17.0                  # T.P. m, the road over Nihonbashi
# the road's height along each carriageway by x (east), a profile from the data's height at the stretch's
# ends to ROAD_M over the bridge: (x, z or None for the data's own height there)
PROFILE = {"east": [(1250.0, None), (1375.0, ROAD_M), (1415.0, ROAD_M), (1458.0, None)],
           "west": [(1250.0, None), (1375.0, ROAD_M), (1430.0, ROAD_M), (1543.0, None)]}
HALF = 4.5                     # m, half a carriageway's deck
SLAB = 0.35                    # m, the concrete slab under the road
GIRDER = 2.4                   # m, the box girders' depth under the slab
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
                za, zb = a[2] - SLAB - GIRDER / 2, b[2] - SLAB - GIRDER / 2
                steel.box([*(a[:2] + na * v), za], [*(b[:2] + nb * v), zb], 2.2, GIRDER)
            # a cross-frame between the girders every segment
            steel.box([*(a[:2] - na * HALF * 0.5), a[2] - SLAB - 0.9], [*(a[:2] + na * HALF * 0.5), a[2] - SLAB - 0.9], 0.3, 1.2)
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
        prof = PROFILE[d]
        # the data's own height at the stretch's ends: the game's line there (game_data.py: the ground and 6 m a level)
        def data_z(x, y):
            return min(((qx - x) ** 2 + (qy - y) ** 2, qz) for qx, qy, qz in motorway)[1]
        n = max(2, int(cut.length / STEP) + 1)
        pts = []
        for k in range(n):
            q = cut.interpolate(k / (n - 1), normalized=True)
            pts.append([q.x, q.y])
        # the profile's end heights from the data where the line passes them
        def z_at_x(x0):
            best = min(range(len(pts)), key=lambda k: abs(pts[k][0] - x0))
            return data_z(*pts[best])
        zs = [z if z is not None else z_at_x(x) for x, z in prof]
        xs = [x for x, _ in prof]
        for p in pts:
            t = np.clip(np.interp(p[0], xs, zs), min(zs), max(zs))
            p.append(round(float(t), 2))
        # smooth the profile's corners (a vertical curve), keeping the ends
        z = np.array([p[2] for p in pts])
        zsm = z.copy()
        for _ in range(3):
            zsm[1:-1] = (zsm[:-2] + 2 * zsm[1:-1] + zsm[2:]) / 4
        for p, zz in zip(pts, zsm):
            p[2] = round(float(zz), 2)
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
            top = float(P[k, 2]) - SLAB - GIRDER
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


def game():
    """--game: game.json's surfaces and the expressway's lines brought up to shuto.json, without the rebuild
    (pipeline/game_extras.py rewrites the surfaces the same way)."""
    path = os.path.join(HERE, "..", "..", "web", "data", "tokyo", "game.json")
    G = json.load(open(path, encoding="utf8"))
    n = on_strips(G)
    json.dump(G, open(path, "w"), separators=(",", ":"))   # as game_extras.py writes it
    print(f"{n} expressway points put on the decks -> {path}")


if __name__ == "__main__":
    import sys
    game() if "--game" in sys.argv else build()
