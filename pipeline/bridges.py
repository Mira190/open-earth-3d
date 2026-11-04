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
(their head's colour), `lamp_style` ("bronze": stone pedestals and candelabra), `span_m` (the published spans,
in proportion), `crown_m` (the deck's rise in the middle), `deck_z` (the deck's height at its two ends, from its
south or west end, where the road over it is carried up above the banks). `skip` names bridges to leave out, `widths` the deck of one mapped as lines,
`deck_min_m` the lowest a deck's ends stand (3.5 m: a Tokyo river's embankment), `min_m2` the smallest outline,
`classes` the water's classes, `form`, `colour`, `stone`, `rail` and `lamps` the city's default for every bridge,
and `off` leaves them all out.
"""
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
                                 colours=colours, widths=cfg.get("widths"), floor=cfg.get("deck_min_m", 3.5))
    except Exception as e:   # no water or no infrastructure layer
        print(f"bridges: none ({e})")
        return []
    decks = own_decks(C, scene or {"landmarks": ctx.landmarks})
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
    for k in range(n):
        u = -L / 2 + (k + 0.5) * L / n
        for s in (-1, 1):
            v = s * (hw - 0.45)
            z = dz(u)
            if stone:
                block(K(K.stone), P, u - 0.45, u + 0.45, v - 0.45, v + 0.45, z, z + 1.4)
                K("wb_bronze").box(P(u, v, z + 1.4), P(u, v, z + 4.2), 0.18, 0.18)
                for a in (-0.6, 0.6):
                    K("wb_bronze").box(P(u, v, z + 3.6), P(u + a, v, z + 4.0), 0.08, 0.08)
                    block(K(lamp), P, u + a - 0.18, u + a + 0.18, v - 0.18, v + 0.18, z + 4.0, z + 4.5)
                block(K(lamp), P, u - 0.2, u + 0.2, v - 0.2, v + 0.2, z + 4.2, z + 4.8)
            else:
                K("wb_post").box(P(u, v, z), P(u, v, z + h), 0.16, 0.16)
                K("wb_post").box(P(u, v, z + h), P(u, v - s * 1.4, z + h + 0.3), 0.1, 0.1)
                block(K(lamp), P, u - 0.25, u + 0.25, v - s * 1.4 - 0.25, v - s * 1.4 + 0.25, z + h - 0.05, z + h + 0.15)


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
