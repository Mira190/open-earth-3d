"""Bridges over the water, for every city (issue 122).

OpenStreetMap maps a city's bridges over its rivers, canals and moats (Overture infrastructure, class
bridge: an outline, or the centre lines of its carriageways). A city whose own builder draws them
(Paris's Seine bridges, Amsterdam's canal bridges, Tsukishima's and Odaiba's) keeps them; every other
bridge over the water is found here (districtkit.water_bridges), kept in scene.json's landmarks as
"water_bridges", drawn in landmarks.json and made a walkable, drivable deck in game.json's surfaces.

A bridge takes its form from city.json "bridges" "forms", by its OpenStreetMap name:

  girder          a steel or concrete girder deck on piers (the default, `form` in "bridges" changes it)
  deck_arch       arches under the deck, spandrel posts up to it (上路アーチ: Azuma-bashi)
  half_through    the middle span's arch springs below the deck and rises over it, hangers down to the
                  road; the side spans are deck arches (中路アーチ: Komagata-bashi)
  through_arch    a tied arch over each span either side of the road, hangers and top bracing
                  (下路アーチ: Umaya-bashi)
  truss           a through Warren truss either side, its top chord braced across (railway bridges)
  stone_arch      masonry: solid spandrel walls over round arches, a stone parapet (Nihonbashi,
                  the Imperial Palace's Seimon Ishibashi)
  kachidoki       Kachidoki Bridge: the two tied side arches, the bascule and its control houses

with `colour` (the paint), `spans`, `rise_m` (the arch's rise over the deck, or of the deck arch under
it), `rail` ("steel", "stone", "timber" with giboshi caps), `lamps` (lamp posts a side) and `lamp`
(their head's colour), `lamp_style` ("bronze": stone pedestals and candelabra), `statues` (cast bronzes from its photographs:
{"middle": "kirin", "ends": "lion"}, Nihonbashi's kirin on the lamp standards over its pier and its lions at the ends), `span_m` (the published spans,
in proportion), `crown_m` (the deck's rise in the middle), `deck_z` (the deck's height at its two ends, from its
south or west end, where the road over it is carried up above the banks). Over a ferry's course (game.json "ferries") a deck rises
in the middle until the city's boats pass under it, with someone standing on the upper deck (`lift_m`). `skip` names bridges to leave out, `widths` the deck of one mapped as lines,
`deck_min_m` the lowest a deck's ends stand (3.5 m: a Tokyo river's embankment), `road_min_m` the lowest
ground under the road a deck carries that its end is set to instead (districtkit.road_bank; lower, the
grid has the water there; deck_min_m when not given), `min_m2` the smallest outline,
`classes` the water's classes, `form`, `colour`, `stone`, `rail` and `lamps` the city's default for every bridge,
and `off` leaves them all out.
"""
import json
import math

import numpy as np

import districtkit as dk
import japankit as jk
from japankit import Kit, block, frame, lathe_at, left_of

CLASSES = ("river", "canal", "moat", "stream", "drain", "ditch", "water", "bay", "ocean", "strait", "sea")
MATERIALS = {
    "wb_deck": {"color": "#5a5b5d", "roughness": 0.9, "metalness": 0.0},
    "wb_walk": {"color": "#8d877c", "roughness": 0.9, "metalness": 0.0},
    "wb_girder": {"color": "#7d9aa0", "roughness": 0.55, "metalness": 0.45},
    "wb_rail": {"color": "#c9ccc8", "roughness": 0.5, "metalness": 0.5, "pattern": "railing", "bar_m": 0.16, "rails_m": [0.1, 0.95]},
    "wb_post": {"color": "#6d7275", "roughness": 0.5, "metalness": 0.6},
    "wb_pier": {"color": "#8a877f", "roughness": 0.9, "metalness": 0.0},
    "wb_stone": {"color": "#aaa395", "roughness": 0.92, "metalness": 0.0},
    "wb_timber": {"color": "#6b4a32", "roughness": 0.8, "metalness": 0.0},
    "wb_bronze": {"color": "#5b4a2e", "roughness": 0.45, "metalness": 0.8},
    "wb_lamp": {"color": "#fff3dc", "roughness": 0.3, "metalness": 0.0, "emissive": "#ffd9a0", "glow": 1.6},
    "wb_house": {"color": "#e8e4d8", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffe6c0", "glow": 0.35},
    "wb_copper": {"color": "#3d4a44", "roughness": 0.55, "metalness": 0.35},
}
RAIL_PATTERN = {"pattern": "railing", "bar_m": 0.16, "rails_m": [0.1, 0.95]}
DEFAULTS = ("colour", "rail", "stone", "lamp", "lamps", "lamp_style")   # city.json "bridges" keys every bridge takes
FORMS = ("girder", "deck_arch", "half_through", "through_arch", "truss", "stone_arch", "kachidoki")


def config(C):
    return C.cfg.get("bridges", {}) if isinstance(C.cfg.get("bridges", {}), dict) else {}


def own_decks(C, scene):
    """The city's own decks (its game_surfaces strips and its landmarks' "bridges"), as (origin, axis,
    half width, u0, u1): a bridge found here whose middle stands on one is the city's, not ours."""
    out = []
    hook = C.hook("game_surfaces")
    for s in (hook(scene) if hook else []):
        if s.get("type") == "strip" and s.get("profile"):
            us = [p[0] for p in s["profile"]]
            out.append((np.asarray(s["origin"][:2], float), jk.unit(np.asarray(s["axis"], float)), float(s["half_width"]), min(us), max(us)))
    for b in scene.get("landmarks", {}).get("bridges", []) or []:
        if isinstance(b, dict) and "centre" in b and "axis" in b:
            L = b.get("length_m", 30.0)
            out.append((np.asarray(b["centre"][:2], float), jk.unit(np.asarray(b["axis"], float)), b.get("width_m", 10.0) / 2, -L / 2, L / 2))
    return out


def on_decks(c, decks, pad=2.0):
    c = np.asarray(c, float)
    for o, ax, hw, u0, u1 in decks:
        d = c - o
        u, v = float(d @ ax), float(-d[0] * ax[1] + d[1] * ax[0])
        if u0 - pad <= u <= u1 + pad and abs(v) <= hw + pad:
            return True
    return False


def elevated(C, b):
    """A bridge whose every road over it is an expressway a level or more up: its viaduct over the river,
    not a deck at the banks' height. (OpenStreetMap's layer is an order, not a height: a street's bridge
    over the water is mapped one to three layers up, Tsukiji Ohashi three.)"""
    import os
    import duckdb
    from shapely import wkb as swkb
    from shapely.geometry import Polygon
    path = os.path.join(C.raw, "overture_segment.parquet")
    if not os.path.exists(path):
        return False
    if not hasattr(C, "_bridge_segments"):
        con = duckdb.connect()
        con.execute("INSTALL spatial; LOAD spatial;")
        rows = con.execute(f"SELECT class, road_flags, level_rules, wkb FROM '{path}' WHERE subtype = 'road' AND road_flags IS NOT NULL").fetchall()
        C._bridge_segments = [(cl, lv, C.to_local(swkb.loads(bytes(w)))) for cl, fl, lv, w in rows
                              if any("is_bridge" in (f.get("values") or []) for f in fl)]
    P = frame(b["centre"], b["axis"])
    L, hw = b["length_m"] / 2, b["width_m"] / 2
    box = Polygon([P(-L, -hw, 0)[:2], P(L, -hw, 0)[:2], P(L, hw, 0)[:2], P(-L, hw, 0)[:2]])
    levels = []
    for cl, lv, g in C._bridge_segments:
        if g.intersects(box) and g.intersection(box).length > 0.4 * b["length_m"]:
            z = max([r["value"] for r in (lv or []) if r.get("value") is not None] or [0])
            levels.append(z if cl == "motorway" else 0)
    return bool(levels) and min(levels) >= 1


def boats(C):
    """How high the city's ferries stand over the water (the shared model's upper deck, at the city's
    length, and someone standing on it: as the game reckons it, web/game/game.js boatTop) and their
    courses as lines, from the built game.json (none on a first build: the next build lifts the decks)."""
    import os
    from shapely.geometry import LineString
    path = os.path.join(C.out, "game.json")
    if not os.path.exists(path):
        return 0.0, []
    g = json.load(open(path, encoding="utf8"))
    courses = [LineString(l["path"]) for f in g.get("ferries", []) for l in f.get("legs", []) if len(l.get("path", [])) > 1]
    if not courses:
        return 0.0, []
    st = g.get("ferry_style") or {}
    V = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "assets", "vehicles", "vehicles.json"), encoding="utf8"))
    m = V.get("ferry_river" if st.get("model") == "river" else "ferry") or {}
    top = m.get("upper_deck_m", 4.2) * (st["length_m"] / m["length_m"] if st.get("length_m") and m.get("length_m") else 1.0) + 2.2
    return top, courses


def lift(b, top, courses):
    """Over a ferry's course the middle of the span rises until the boats pass under its soffit, level
    across the middle of the bridge (as web/game/decks.js lifts the bridges it draws): b["lift_m"]."""
    from shapely.geometry import Polygon
    if not courses or not top:
        return
    P = frame(b["centre"], b["axis"])
    L, hw = b["length_m"] / 2, b["width_m"] / 2
    box = Polygon([P(-L, -hw, 0)[:2], P(L, -hw, 0)[:2], P(L, hw, 0)[:2], P(-L, hw, 0)[:2]])
    if not any(box.intersects(c) for c in courses):
        return
    stone = b.get("form") == "stone_arch"
    n_sp = len(b["span_m"]) if b.get("span_m") else int(b.get("spans") or max(1, round(b["length_m"] / (30.0 if stone else 45.0))))
    deep = 1.2 if stone else min(2.6, max(1.2, b["length_m"] / (n_sp * 25)))
    need = max(b.get("z_base", 0.0), 0.0) + top + deep - min(b["z_ends"])
    if need > b.get("crown_m", max(0.8, 0.02 * b["length_m"])):
        b["lift_m"] = round(need, 2)


def find(ctx, scene=None):
    """The bridges over the water that the city does not draw itself, each with its form (city.json
    "bridges"), its deck at the banks' height, and z_base, the water's (or the riverbed's) height under it."""
    C = ctx.city
    cfg = config(C)
    if cfg.get("off"):
        return []
    forms = cfg.get("forms", {})
    colours = {n: f["colour"] for n, f in forms.items() if f.get("colour")}
    try:
        found = dk.water_bridges(ctx, classes=tuple(cfg.get("classes", CLASSES)), min_m2=cfg.get("min_m2", 150.0),
                                 colours=colours, widths=cfg.get("widths"), floor=cfg.get("deck_min_m", 3.5),
                                 road_floor=cfg.get("road_min_m"))
    except Exception as e:   # no water or no infrastructure layer
        print(f"bridges: none ({e})")
        return []
    decks = own_decks(C, scene or {"landmarks": ctx.landmarks})
    top, courses = boats(C)
    skip = set(cfg.get("skip", []))
    out, dropped = [], 0
    for b in found:
        if b["name"] in skip or on_decks(b["centre"], decks) or elevated(C, b):
            dropped += 1
            continue
        f = {**{k: cfg[k] for k in DEFAULTS if k in cfg}, **forms.get(b["name"], {})}
        b["form"] = f.pop("form", cfg.get("form", "girder"))
        b["colour"] = f.pop("colour", b.get("colour"))
        b.update(f)
        if "deck_z" in b:   # the deck's height at its two ends, where the road over it is carried up (Kings Way over Crown)
            b["z_ends"] = [float(z) for z in b.pop("deck_z")]
        clear(ctx, b)
        b["z_base"] = round(max(min(ctx.ground(*b["centre"]), min(b["z_ends"]) - 1.5), 0.0), 2)
        lift(b, top, courses)
        if b["form"] == "x":   # an X in plan (Sakura-bashi): two decks corner to corner of its outline
            out += x_arms(ctx, b, float(f.get("arm_m", 8.0)))
            continue
        out.append(b)
    print(f"bridges: {len(out)} decks over the water, of {len(found)} mapped bridges ({dropped} the city's own, viaducts or skipped)")
    return out


def clear(ctx, b, gap=0.8, grade=0.1):
    """Over water the model draws as ground (a castle moat kept at its own level, Kyoto's riverbed), the deck
    stands gap over the highest ground under it: where that is higher than the banks, the ends rise to it
    and ramps at grade come down to the banks beyond them."""
    P = frame(b["centre"], b["axis"])
    L = b["length_m"]
    from shapely.geometry import Point
    water = getattr(ctx, "bridge_water", None)
    pts = [P(u, v, 0)[:2] for u in np.linspace(-L / 2 + 2, L / 2 - 2, 13) for v in (-b["width_m"] / 4, 0, b["width_m"] / 4)]
    under = [ctx.ground(*p) for p in pts if water is None or water.contains(Point(*p))]
    if not under:
        return
    need = max(under) + gap - min(0.8, 0.02 * L) * 0.75   # the crown lifts the middle of the span
    za, zb = b["z_ends"]
    if need <= min(za, zb) + 0.3:   # (a little under: the deck's soffit sits on the bank's edge)
        return
    b["banks"] = [za, zb]
    b["z_ends"] = [round(max(za, need), 2), round(max(zb, need), 2)]
    b["ramp_m"] = round(min(60.0, max(b["z_ends"][0] - za, b["z_ends"][1] - zb) / grade), 1)


def x_arms(ctx, b, w):
    """The two arms of an X-shaped footbridge, each a girder deck w wide from a corner of the outline to
    the opposite one, crossing in the middle of the river."""
    ax = np.asarray(b["axis"], float)
    l = left_of(ax)
    c = np.asarray(b["centre"], float)
    L, W = b["length_m"], b["width_m"]
    out = []
    for s in (-1, 1):
        d = ax * L + l * s * (W - w)
        n = float(np.linalg.norm(d))
        a = jk.unit(d)
        za = max(ctx.ground(*(c - a * (n / 2 + 3))), min(b["z_ends"]))
        zb = max(ctx.ground(*(c + a * (n / 2 + 3))), min(b["z_ends"]))
        out.append({**b, "name": b["name"], "axis": dk.rnd(a, 5), "length_m": round(n, 1), "width_m": round(w, 1),
                    "z_ends": [round(za, 2), round(zb, 2)], "form": "girder", "arm": s})
    return out


# ---------------------------------------------------------------- meshes

def lit_tone(hex_colour, white=0.12):
    """A paint's colour under a floodlight: the paint, a little towards white."""
    c = [int(hex_colour[k:k + 2], 16) for k in (1, 3, 5)]
    return "#" + "".join(f"{round(v + (255 - v) * white):02x}" for v in c)


def lamps(K, P, dz, L, hw, n, colour=None, h=6.5, stone=False):
    """Lamp posts along both kerbs: a post, an arm over the road and a lit lantern."""
    if not n:
        return
    lamp = "wb_lamp"
    if colour:
        lamp = "wb_lamp_" + colour.lstrip("#")
        K.mats[lamp] = {**MATERIALS["wb_lamp"], "emissive": colour}
    K.lit.add(lamp)   # lit after dark (web/world.js: a floodlit mesh's material glows by its "glow")
    for k in range(n):
        u = -L / 2 + (k + 0.5) * L / n
        for s in (-1, 1):
            v = s * (hw - 0.45)
            z = dz(u)
            if stone:
                block(K(K.stone), P, u - 0.45, u + 0.45, v - 0.45, v + 0.45, z, z + 1.4)
                candelabra(K, P, u, v, z + 1.4, 3.0, 2, lamp)
            else:
                K("wb_post").box(P(u, v, z), P(u, v, z + h), 0.16, 0.16)
                K("wb_post").box(P(u, v, z + h), P(u, v - s * 1.4, z + h + 0.3), 0.1, 0.1)
                block(K(lamp), P, u - 0.25, u + 0.25, v - s * 1.4 - 0.25, v - s * 1.4 + 0.25, z + h - 0.05, z + h + 0.15)


def globe(m, x, y, z, r, segs=10):
    """A glass globe of radius r, its foot at z (a lathe of a circle)."""
    a = np.linspace(-math.pi / 2, math.pi / 2, 7)
    lathe_at(m, x, y, [(z + r + r * math.sin(t), max(0.0, r * math.cos(t))) for t in a], segs)


def candelabra(K, P, u, v, z, h, arms, lamp, r=0.2):
    """A cast-bronze lamp standard (as on Nihonbashi and the Seimon Ishibashi): a turned column h high from
    z, with a moulded base, a collar and a capital, a globe on top and `arms` scrolled arms below it, each
    with its own globe."""
    x, y, _ = P(u, v, 0)
    B = K("wb_bronze")
    lathe_at(B, x, y, [(z, 0.3), (z + 0.12, 0.3), (z + 0.2, 0.2), (z + 0.5, 0.13), (z + h * 0.55, 0.09), (z + h * 0.6, 0.13),
                       (z + h * 0.64, 0.08), (z + h - 0.15, 0.07), (z + h - 0.05, 0.14), (z + h, 0.1)], 10)
    globe(K(lamp), x, y, z + h, r * 1.15)
    for k in range(arms):
        t = 2 * math.pi * (k + 0.5) / arms if arms > 2 else (0 if k == 0 else math.pi)
        du, dv = math.cos(t) * 0.75, math.sin(t) * 0.75
        za = z + h * 0.78
        B.box(P(u, v, za), P(u + du * 0.6, v + dv * 0.6, za + 0.18), 0.06, 0.06)
        B.box(P(u + du * 0.6, v + dv * 0.6, za + 0.18), P(u + du, v + dv, za + 0.1), 0.06, 0.06)
        ax, ay, _ = P(u + du, v + dv, 0)
        lathe_at(B, ax, ay, [(za, 0.0), (za + 0.04, 0.09), (za + 0.12, 0.07)], 8)
        globe(K(lamp), ax, ay, za + 0.12, r)


def cast(m, f, lo, hi, cell, place):
    """A sculpted field (sculptkit.py) meshed and set down by place(u, v, z) -> world point, into mesh m
    (its own smooth mesh: the viewer smooths across shared vertices)."""
    import sculptkit as sk
    verts, tris = sk.mesh(f, lo, hi, cell)
    verts = sk.relax(np.asarray(verts, float), np.asarray(tris), 0.5, 2)
    n = len(m.v)
    m.smooth, m.digits = True, 3
    for a in verts:
        m.v.append(tuple(float(c) for c in place(*a)))
        m.t.append([0.0, 0.0])
    for t in tris:
        m.i += [n + int(k) for k in t]


def kirin_field():
    """Nihonbashi's kirin (麒麟, Watanabe Osao after Tsumaki Yorinaka, 1911): a winged beast seated on its
    haunches, forelegs straight, head up under two swept horns, its wings raised behind and a flame of a
    tail, in its own frame facing +u, about 2.2 m high."""
    import sculptkit as sk
    side = sk.mirror_v(sk.smooth_union(0.05,
        sk.capsule((0.36, 0.15, 0.95), (0.42, 0.16, 0.06), 0.09, 0.065),             # the forelegs
        sk.ellipsoid((0.5, 0.17, 0.05), (0.13, 0.07, 0.05)),                          # forepaws
        sk.ellipsoid((-0.3, 0.24, 0.32), (0.36, 0.11, 0.28)),                         # the folded hind legs
        sk.capsule((0.47, 0.06, 1.95), (0.25, 0.09, 2.25), 0.04, 0.012),              # horns, swept back
        sk.ellipsoid((-0.15, 0.36, 1.55), (0.5, 0.05, 0.5)),                          # the raised wings
        sk.path([(0.1, 0.3, 1.15), (-0.05, 0.42, 1.75), (-0.45, 0.46, 2.15)], [0.09, 0.07, 0.03])))
    body = sk.smooth_union(0.12,
        sk.ellipsoid((-0.2, 0.0, 0.58), (0.55, 0.32, 0.42)),
        sk.ellipsoid((0.25, 0.0, 0.95), (0.3, 0.27, 0.45)),
        sk.capsule((0.3, 0.0, 1.2), (0.47, 0.0, 1.7), 0.19, 0.14),
        sk.ellipsoid((0.55, 0.0, 1.85), (0.24, 0.14, 0.15)),
        sk.capsule((0.6, 0.0, 1.83), (0.86, 0.0, 1.78), 0.09, 0.06),
        sk.path([(-0.7, 0.0, 0.4), (-0.98, 0.0, 0.75), (-0.88, 0.0, 1.2), (-0.62, 0.0, 1.5)], [0.1, 0.085, 0.07, 0.025]))
    return sk.roughen(sk.smooth_union(0.05, body, side), 0.012, 0.09, seed=11)


def lion_field():
    """Nihonbashi's lions (獅子): seated, maned, holding up the shield of the City of Tokyo's crest between
    the forepaws; facing +u, about 1.6 m high."""
    import sculptkit as sk
    side = sk.mirror_v(sk.smooth_union(0.05,
        sk.capsule((0.3, 0.15, 0.8), (0.36, 0.15, 0.06), 0.1, 0.075),
        sk.ellipsoid((0.43, 0.16, 0.05), (0.13, 0.08, 0.05)),
        sk.ellipsoid((-0.25, 0.23, 0.3), (0.36, 0.11, 0.28)),
        sk.sphere((0.36, 0.12, 1.3), 0.06)))                                          # the eyes' brows
    body = sk.smooth_union(0.1,
        sk.ellipsoid((-0.15, 0.0, 0.52), (0.48, 0.3, 0.42)),
        sk.ellipsoid((0.15, 0.0, 0.85), (0.3, 0.29, 0.4)),
        sk.roughen(sk.ellipsoid((0.22, 0.0, 1.22), (0.32, 0.37, 0.36)), 0.035, 0.07, seed=5),   # the mane
        sk.ellipsoid((0.42, 0.0, 1.18), (0.17, 0.19, 0.2)),
        sk.ellipsoid((0.56, 0.0, 1.1), (0.09, 0.12, 0.09)),
        sk.path([(-0.6, 0.0, 0.2), (-0.8, 0.0, 0.5), (-0.7, 0.0, 0.85)], [0.06, 0.05, 0.09]))
    shield = sk.box((0.5, 0.0, 0.72), (0.04, 0.22, 0.27), 0.03)
    return sk.roughen(sk.smooth_union(0.04, body, side, shield), 0.01, 0.08, seed=3)


def statues(K, P, dz, L, hw, b, lamp):
    """The bronze ornaments of a bridge from its photographs (city.json "statues"): on Nihonbashi the two
    lamp standards over the middle pier, each on a granite pedestal with a pair of kirin back to back, and at
    the four ends granite pillars with a lamp on each and a lion before it, holding the city's crest."""
    st = b.get("statues") or {}
    if st.get("middle") == "kirin":
        f = kirin_field()
        for s in (-1, 1):
            v = s * (hw - 0.75)
            z = dz(0.0)
            block(K(K.stone), P, -1.6, 1.6, v - 0.9, v + 0.9, z, z + 0.5)
            jk.taper(K(K.stone), P, 0.0, v, 3.0, 1.6, z + 0.5, 2.7, 1.4, z + 2.3)
            block(K(K.stone), P, -1.55, 1.55, v - 0.8, v + 0.8, z + 2.3, z + 2.55)
            for d in (-1, 1):   # back to back, each facing an end of the bridge
                cast(K("wb_bronze", "kirin"), f, (-1.2, -0.62, -0.05), (1.05, 0.62, 2.4), 0.065,
                     lambda a, c, e, d=d, v=v, z=z: P(d * (0.55 + a * 0.8), v + d * c * 0.8, z + 2.55 + e * 0.8))
            candelabra(K, P, 0.0, v, z + 2.55, 5.2, 4, lamp, r=0.26)
    if st.get("ends") == "lion":
        f = lion_field()
        for e in (-1, 1):
            u = e * (L / 2 - 1.2)
            z = dz(u)
            for s in (-1, 1):
                v = s * (hw - 0.75)
                block(K(K.stone), P, u - 0.75, u + 0.75, v - 0.75, v + 0.75, z, z + 0.4)
                jk.taper(K(K.stone), P, u, v, 1.3, 1.3, z + 0.4, 0.95, 0.95, z + 4.2)   # the end pillar
                block(K(K.stone), P, u - 0.6, u + 0.6, v - 0.6, v + 0.6, z + 4.2, z + 4.45)
                candelabra(K, P, u, v, z + 4.45, 2.4, 4, lamp, r=0.2)
                # the lion on its plinth beside the pillar, out on the bank's side, facing along the street
                lu = u + e * 1.9
                block(K(K.stone), P, lu - 0.8, lu + 0.8, v - 0.55, v + 0.55, z, z + 1.3)
                cast(K("wb_bronze", "lion"), f, (-0.95, -0.5, -0.05), (0.7, 0.5, 1.65), 0.06,
                     lambda a, c, ee, e=e, lu=lu, v=v, z=z: P(lu + e * a * 0.95, v + e * c * 0.95, z + 1.3 + ee * 0.95))


def railing(K, P, dz, us, hw, kind, paint):
    if kind == "none":   # the city's own railings stand on it (Tsukuda Kobashi)
        return
    if kind == "stone":
        for s in (-1, 1):
            v = s * (hw - 0.3)
            for u0, u1 in zip(us[:-1], us[1:]):
                block(K(K.stone), P, u0, u1, v - 0.3, v + 0.3, min(dz(u0), dz(u1)) - 0.1, max(dz(u0), dz(u1)) + 1.1)
        return
    if kind == "timber":
        for s in (-1, 1):
            v = s * (hw - 0.25)
            K("wb_timber").rails([P(u, v, dz(u)) for u in us], 1.05, post_every=2.4, post=0.16, rail=0.12, rails=2)
            for u in (us[0], us[-1]) + tuple(us[1:-1:max(1, len(us) // 6)]):
                x, y = P(u, v, 0)[:2]
                z = dz(u)
                lathe_at(K("wb_timber"), x, y, [(z, 0.17), (z + 1.25, 0.17)], 8)
                lathe_at(K("wb_bronze"), x, y, [(z + 1.25, 0.19), (z + 1.4, 0.21), (z + 1.55, 0.12), (z + 1.75, 0.0)], 8)   # the giboshi
        return
    # steel: a cut-out balustrade (the viewer's railing pattern), grey or in the bridge's paint
    mat = "wb_rail"
    if kind == "painted":
        mat = paint + "_rail"
        K.mats[mat] = {**K.mats[paint], **RAIL_PATTERN}
        K.lit.add(mat)
    for v in (-hw + 0.2, hw - 0.2):
        K(mat).panel([P(u, v, dz(u)) for u in us], 1.1)


def arch_z(u, u0, u1, z0, z1):
    """A segmental arch between springings (u0, z0) and (u1, z0) rising to z1 at its middle."""
    t = (u - u0) / (u1 - u0)
    return z0 + (z1 - z0) * (1 - (2 * t - 1) ** 2)


def spans_of(L, n, span_m=None):
    """The spans' ends along the deck: n equal ones, or in the proportions of the published span_m."""
    w = np.asarray(span_m if span_m else [1.0] * n, float)
    e = -L / 2 + L * np.concatenate([[0.0], np.cumsum(w) / w.sum()])
    return list(zip(e[:-1], e[1:]))


def bridge(K, b):
    """One bridge on its outline: the deck and its pavements, the structure of its form, piers in the
    water, railings and lamps."""
    P = frame(b["centre"], b["axis"])
    L, hw = b["length_m"], b["width_m"] / 2
    prof = dk.deck_profile(b)
    us_p, zs_p = np.array([p[0] for p in prof]), np.array([p[1] for p in prof])
    dz = lambda u: float(np.interp(u, us_p, zs_p))
    form = b.get("form", "girder")
    paint = "wb_girder"
    if b.get("colour"):
        paint = "wb_paint_" + b["colour"].lstrip("#")
        # floodlit after dark in its own colour, as Tokyo lights the Sumida's bridges (not a white wash)
        K.mats[paint] = {"color": b["colour"], "roughness": 0.5, "metalness": 0.4, "emissive": lit_tone(b["colour"]), "glow": 0.42}
        K.lit.add(paint)
    stone = form == "stone_arch"
    K.stone = "wb_stone"   # the masonry's material, in the city's stone or brick
    if b.get("stone"):
        K.stone = "wb_stone_" + b["stone"].lstrip("#")
        K.mats[K.stone] = {**MATERIALS["wb_stone"], "color": b["stone"]}
    side = K.stone if stone else paint
    base = b.get("z_base", 0.0)
    n_sp = len(b["span_m"]) if b.get("span_m") else int(b.get("spans") or max(1, round(L / (30.0 if stone else 45.0))))
    us = np.linspace(-L / 2, L / 2, max(8, int(L / 5)))
    deep = 1.2 if stone else min(2.6, max(1.2, L / (n_sp * 25)))
    walk = min(3.5, hw * 0.22) if hw > 5 else 0.0
    # the deck: the road, the raised pavements either side, its soffit and its fascia
    for u0, u1 in zip(us[:-1], us[1:]):
        z0, z1 = dz(u0), dz(u1)
        K("wb_deck").quad(P(u0, -hw + walk, z0), P(u1, -hw + walk, z1), P(u1, hw - walk, z1), P(u0, hw - walk, z0))
        if walk:
            for a, c in ((-hw, -hw + walk), (hw - walk, hw)):
                K("wb_walk").quad(P(u0, a, z0 + 0.15), P(u1, a, z1 + 0.15), P(u1, c, z1 + 0.15), P(u0, c, z0 + 0.15))
            for v, s in ((-hw + walk, 1), (hw - walk, -1)):
                q = [P(u0, v, z0), P(u1, v, z1), P(u1, v, z1 + 0.15), P(u0, v, z0 + 0.15)]
                K("wb_walk").quad(*(q if s > 0 else [q[1], q[0], q[3], q[2]]))
        K("wb_deck").quad(P(u0, hw, z0 - deep), P(u1, hw, z1 - deep), P(u1, -hw, z1 - deep), P(u0, -hw, z0 - deep))
        for v, s in ((-hw, -1), (hw, 1)):
            q = [P(u0, v, z0 - deep), P(u1, v, z1 - deep), P(u1, v, z1 + 0.2), P(u0, v, z0 + 0.2)]
            K(side).quad(*(q if s < 0 else [q[1], q[0], q[3], q[2]]))
    if b.get("banks"):
        ramps(K, P, dz, b, hw)
    sp = spans_of(L, n_sp, b.get("span_m"))
    rise = float(b.get("rise_m") or 0.0)
    if form == "kachidoki":
        kachidoki(K, b, paint)
    elif form == "stone_arch":
        stone_arches(K, P, dz, sp, hw, base, deep)
    elif form in ("deck_arch", "half_through"):
        for k, (u0, u1) in enumerate(sp):
            mid = form == "half_through" and k == len(sp) // 2 and len(sp) % 2 == 1 or form == "half_through" and len(sp) == 1
            if mid:
                up = rise or 0.18 * (u1 - u0)
                through_rib(K, P, dz, u0, u1, hw, base + 1.0, dz((u0 + u1) / 2) + up, paint, half=True)
            else:
                deck_rib(K, P, dz, u0, u1, hw, base + 0.8, dz((u0 + u1) / 2) - deep - 0.1, paint)
    elif form == "through_arch":
        for u0, u1 in sp:
            up = rise or 0.16 * (u1 - u0)
            through_rib(K, P, dz, u0, u1, hw, None, dz((u0 + u1) / 2) + up, paint)
    elif form == "truss":
        truss(K, P, dz, sp, hw, b.get("truss_h") or min(9.0, max(5.0, L / n_sp / 8)), paint)
    if form != "stone_arch" and form != "kachidoki":
        for u0, u1 in sp[1:]:   # piers between the spans
            block(K("wb_pier"), P, u0 - 1.4, u0 + 1.4, -hw + 0.6, hw - 0.6, base - 6.0, dz(u0) - deep)
            for s in (-1, 1):   # their cutwaters
                block(K("wb_pier"), P, u0 - 0.9, u0 + 0.9, s * (hw - 0.6) - 0.6, s * (hw - 0.6) + 0.6, base - 6.0, base + 1.6)
        for e in (-1, 1):       # the abutments under the ends
            u = e * L / 2
            block(K("wb_pier"), P, u - (1.6 if e < 0 else 0.0), u + (0.0 if e < 0 else 1.6), -hw, hw, base - 6.0, dz(u) - deep)
    railing(K, P, dz, us, hw, b.get("rail", "stone" if stone else "steel"), paint)
    if b.get("statues"):   # its lamps stand with its statues
        lamp = "wb_lamp"
        if b.get("lamp"):
            lamp = "wb_lamp_" + b["lamp"].lstrip("#")
            K.mats[lamp] = {**MATERIALS["wb_lamp"], "emissive": b["lamp"]}
        K.lit.add(lamp)
        statues(K, P, dz, L, hw, b, lamp)
    else:
        lamps(K, P, dz, L, hw, int(b.get("lamps", max(2, int(L / 30)) if L > 25 else 0)), b.get("lamp"), stone=b.get("lamp_style") == "bronze")


def ramps(K, P, dz, b, hw):
    """The approaches up from banks lower than the deck: a road between retaining walls of stone, and
    their railings."""
    L, r = b["length_m"], b["ramp_m"] + 3.0
    for e, g in ((-1, b["banks"][0]), (1, b["banks"][1])):
        us = np.linspace(e * L / 2, e * (L / 2 + r), max(3, int(r / 4)))
        if e < 0:
            us = us[::-1]
        for u0, u1 in zip(us[:-1], us[1:]):
            z0, z1 = dz(u0), dz(u1)
            K("wb_deck").quad(P(u0, -hw, z0), P(u1, -hw, z1), P(u1, hw, z1), P(u0, hw, z0))
            for v, s in ((-hw, -1), (hw, 1)):
                q = [P(u0, v, g - 0.5), P(u1, v, g - 0.5), P(u1, v, z1 + 0.2), P(u0, v, z0 + 0.2)]
                K(K.stone).quad(*(q if s < 0 else [q[1], q[0], q[3], q[2]]))
        railing(K, P, dz, us if e > 0 else us[::-1], hw, b.get("rail", "steel"), "wb_rail")


def deck_rib(K, P, dz, u0, u1, hw, z_spring, z_crown, paint):
    """A deck arch's two ribs under the deck's edges, and the spandrel posts up to the deck."""
    ts = np.linspace(0, 1, 15)
    for v in (-hw + 0.5, hw - 0.5):
        pts = [P(u0 + (u1 - u0) * t, v, arch_z(u0 + (u1 - u0) * t, u0, u1, z_spring, z_crown)) for t in ts]
        for p, q in zip(pts, pts[1:]):
            K(paint).box(p, q, 0.7, 1.3)
        for t in ts[1:-1]:
            u = u0 + (u1 - u0) * t
            za = arch_z(u, u0, u1, z_spring, z_crown)
            if dz(u) - za > 0.8:
                K(paint).box(P(u, v, za), P(u, v, dz(u) - 1.0), 0.35, 0.35)
    for t in ts[2:-2:3]:   # bracing across, between the ribs
        u = u0 + (u1 - u0) * t
        za = arch_z(u, u0, u1, z_spring, z_crown)
        K(paint).box(P(u, -hw + 0.5, za), P(u, hw - 0.5, za), 0.3, 0.4)


def through_rib(K, P, dz, u0, u1, hw, z_spring, z_crown, paint, half=False):
    """Arch ribs either side of the road rising to z_crown, hangers down to the deck and bracing across over
    the road. half: the ribs spring below the deck (a half-through arch); else they spring from it, tied."""
    ts = np.linspace(0, 1, 21)
    zs = (lambda u: arch_z(u, u0, u1, z_spring, z_crown)) if half else (lambda u: arch_z(u, u0, u1, (dz(u0) + dz(u1)) / 2, z_crown))
    for v in (-hw - 0.5, hw + 0.5):
        pts = [P(u0 + (u1 - u0) * t, v, zs(u0 + (u1 - u0) * t)) for t in ts]
        for p, q in zip(pts, pts[1:]):
            K(paint).box(p, q, 0.9, 1.4)
        for t in ts[1:-1]:
            u = u0 + (u1 - u0) * t
            za = zs(u)
            if za - dz(u) > 1.2:
                K(paint).box(P(u, v, dz(u)), P(u, v, za), 0.2, 0.2)
            elif dz(u) - za > 1.2:
                K(paint).box(P(u, v, za), P(u, v, dz(u) - 1.0), 0.4, 0.4)
        if not half:
            K(paint).box(P(u0, v, dz(u0) - 0.6), P(u1, v, dz(u1) - 0.6), 0.8, 1.6)    # the tie
    for t in ts[3:-3:3]:
        u = u0 + (u1 - u0) * t
        za = zs(u)
        if za - dz(u) > 5.2:
            K(paint).box(P(u, -hw - 0.5, za), P(u, hw + 0.5, za), 0.4, 0.5)


def truss(K, P, dz, sp, hw, h, paint):
    """A through Warren truss either side of the deck, a panel every h metres, braced across at the top."""
    for u0, u1 in sp:
        n = max(2, int(round((u1 - u0) / h)))
        nodes = np.linspace(u0, u1, n + 1)
        for v in (-hw - 0.3, hw + 0.3):
            bot = [P(u, v, dz(u)) for u in nodes]
            top = [P(u, v, dz(u) + h) for u in nodes[1:-1]]
            for p, q in zip(bot, bot[1:]):
                K(paint).box(p, q, 0.6, 0.9)
            for p, q in zip(top, top[1:]):
                K(paint).box(p, q, 0.6, 0.8)
            for k in range(n):   # the diagonals, up and down in turn, from the ends' end posts
                a = bot[k] if k % 2 == 0 else top[k - 1] if k - 1 < len(top) else bot[k]
                c = top[k] if k % 2 == 0 and k < len(top) else bot[k + 1]
                K(paint).box(a, c, 0.45, 0.45)
            for p, q in zip(bot[1:-1], top):
                K(paint).box(p, q, 0.35, 0.35)
        for u in nodes[1:-1]:
            z = dz(u) + h
            K(paint).box(P(u, -hw - 0.3, z), P(u, hw + 0.3, z), 0.35, 0.4)


def stone_arches(K, P, dz, sp, hw, base, deep):
    """Masonry: each span a round arch, its barrel vault under the deck and the spandrel walls either side
    from the arch up to the deck, the piers' faces down to the water."""
    S = K(K.stone)
    w = 0.0
    for k, (u0, u1) in enumerate(sp):
        pier = min(2.5, 0.12 * (u1 - u0))
        a0, a1 = u0 + (pier / 2 if k else 0.0), u1 - (pier / 2 if k < len(sp) - 1 else 0.0)
        z_crown = min(dz((a0 + a1) / 2) - deep, base + 0.5 + (a1 - a0) * 0.45)
        ts = np.linspace(0, 1, 17)
        uu = a0 + (a1 - a0) * ts
        zz = [arch_z(u, a0, a1, base + 0.3, z_crown) for u in uu]
        for (ua, za), (ub, zb) in zip(zip(uu, zz), zip(uu[1:], zz[1:])):
            S.quad(P(ua, hw, za), P(ub, hw, zb), P(ub, -hw, zb), P(ua, -hw, za))   # the vault, seen from below
            for v, s in ((-hw, -1), (hw, 1)):
                q = [P(ua, v, za), P(ub, v, zb), P(ub, v, dz(ub) - deep), P(ua, v, dz(ua) - deep)]
                S.quad(*(q if s < 0 else [q[1], q[0], q[3], q[2]]))
            # the voussoirs' ring, proud of the wall
            for v in (-hw - 0.12, hw + 0.12):
                S.box(P(ua, v, za + 0.3), P(ub, v, zb + 0.3), 0.25, 0.6)
        if k:   # the pier between this span and the last, with its cutwaters
            block(S, P, u0 - pier / 2, u0 + pier / 2, -hw, hw, base - 3.0, dz(u0) - deep)
            for s in (-1, 1):
                jk.taper(S, P, u0, s * (hw + 0.8), pier, 1.6, base - 3.0, pier * 0.5, 0.6, base + 2.0)
        w += 1
    for e in (-1, 1):
        u = e * sp[-1][1] if e > 0 else sp[0][0]
        block(S, P, u - (2.0 if e < 0 else 0.0), u + (0.0 if e < 0 else 2.0), -hw, hw, base - 3.0, dz(u) - deep)


def kachidoki(K, b, paint):
    """Kachidoki Bridge (1940): the two tied arches over the side spans (about 86 m each, rising 11 m over
    the deck), their hangers and top bracing, the bascule's 44 m between them, and the four control houses
    on its piers (Tokyo Metropolitan Government; Kachidoki Bridge Museum)."""
    P = frame(b["centre"], b["axis"])
    L, hw = b["length_m"], b["width_m"] / 2
    prof = dk.deck_profile(b)
    us, zs = np.array([p[0] for p in prof]), np.array([p[1] for p in prof])
    dz = lambda u: float(np.interp(u, us, zs))
    bas = 44.0 * L / 246.0
    S = K(paint)
    for s in (-1, 1):
        u0, u1 = (-L / 2, -bas / 2) if s < 0 else (bas / 2, L / 2)
        ts = np.linspace(0, 1, 17)
        for v in (-hw - 0.4, hw + 0.4):
            arc = [P(u0 + (u1 - u0) * t, v, dz(u0 + (u1 - u0) * t) + 11.0 * math.sin(math.pi * t)) for t in ts]
            for p, q in zip(arc, arc[1:]):
                S.box(p, q, 0.9, 1.2)
            for t in ts[1:-1:2]:
                u = u0 + (u1 - u0) * t
                S.box(P(u, v, dz(u)), P(u, v, dz(u) + 11.0 * math.sin(math.pi * t)), 0.25, 0.25)
            S.box(P(u0, v, dz(u0) - 0.8), P(u1, v, dz(u1) - 0.8), 0.7, 1.6)
        for t in ts[3:-3:3]:
            u = u0 + (u1 - u0) * t
            z = dz(u) + 11.0 * math.sin(math.pi * t)
            S.box(P(u, -hw - 0.4, z), P(u, hw + 0.4, z), 0.4, 0.5)
    for su in (-1, 1):
        u = su * (bas / 2 + 3.0)
        block(K("wb_pier"), P, u - 4.0, u + 4.0, -hw - 5.6, hw + 5.6, b.get("z_base", 0.0) - 6.0, dz(u) - 2.0)
        for sv in (-1, 1):
            v = sv * (hw + 3.2)
            z = dz(u)
            block(K("wb_house"), P, u - 2.6, u + 2.6, v - 2.4, v + 2.4, z - 8.0, z + 4.2)
            jk.hip_roof(K("wb_copper"), K("wb_copper"), lambda a, c, zz, u=u, v=v: P(u + a, v + c, zz), 2.6, 2.4, z + 4.2, z + 6.0, ov=0.5, k=1.0)


def meshes(scene):
    """(materials, meshes) for scene.json's water_bridges."""
    bs = scene.get("landmarks", {}).get("water_bridges") or []
    if not bs:
        return {}, []
    K = Kit("bridges", {k: dict(v) for k, v in MATERIALS.items()}, floodlit=())
    for b in bs:
        bridge(K, b)
    ms = K.meshes()
    used = {m.mat for m in ms}
    return {k: v for k, v in K.mats.items() if k in used}, ms


def glows(scene):
    """The lamps' light on the decks after dark."""
    out = []
    for b in scene.get("landmarks", {}).get("water_bridges") or []:
        n = int(b.get("lamps", max(2, int(b["length_m"] / 30)) if b["length_m"] > 25 else 0))
        if n:
            out.append([b["centre"][0], b["centre"][1], round(b["length_m"] / 2 + 8, 1), b.get("lamp") or "#ffd9a0", 0.22])
    return out


def surfaces(scene):
    """The decks as walkable, drivable strips for the game, flown and sailed under."""
    return dk.bridge_surfaces(scene.get("landmarks", {}).get("water_bridges") or [], mesh="bridges_wb_deck")
