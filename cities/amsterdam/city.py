"""Amsterdam: what the generic pipeline cannot know from open data.

Heights and roofs come from the 3DBAG (pipeline/fetch_3dbag.py, build_scene.BAG3D): every
building in the cadastral register, measured by the national airborne LiDAR, with its LOD2.2
roof. The canal houses' gables are drawn by build_scene.gable_props from each house's year of
construction. The hooks add what the 3DBAG does not hold.

Building adjustments (called by pipeline/build_scene.py):
  * Houseboats: about 2,500 are moored in the city's canals (woonboten). They are not in the
    BAG, so OpenStreetMap's outlines carry no height; they float (water.floating in city.json)
    and stand 2.6-3.5 m above the water, a guess from the common ark (a flat-roofed box on a
    concrete hull).
  * Towers: a laser over a 10 m footprint cannot draw a spire. The five tallest are parametric
    (below); their measured solids stay in the surface model for the sun analyses. In a church,
    only the pieces the drawn tower stands in place of are hidden, never its body (draws_instead);
    pipeline/refresh_hidden.py applies that rule to a built scene.

Parametric landmarks (called by pipeline/landmarks.py), placed on their footprints:
  Westertoren       85 m (87 m with the weathercock; westerkerk.nl), Hendrick de Keyser,
                    1638: a square brick shaft, three stone stages and the imperial crown
  Zuidertoren       68 m (nl.wikipedia, Zuiderkerkstoren), 1614: a square brick shaft, an
                    octagonal stone stage, a clock stage and a lead spire
  Oudekerkstoren    67 m (oudekerk.nl; nl.wikipedia gives 70 m), a square brick shaft under
                    lead-clad timber stages
  Montelbaanstoren  48 m (nl.wikipedia), a round brick defence tower of 1516 under De Keyser's
                    timber stages of 1606
  Munttoren         35 m (nl.wikipedia; a tourist site gives 41 m), the round base of the
                    Regulierspoort under an open timber lantern of 1620
  The stages' proportions are approximations from photographs.
  Rijksmuseum       P. J. H. Cuypers, 1885: 135.54 m long, the towers 52.90 m (nl.wikipedia,
                    Rijksmuseumgebouw). Drawn on its 46 measured 3DBAG solids, which it hides (they
                    stay in the surface model): the walls in red brick banded with sandstone over a
                    granite plinth (the soubasement of Ourthe granite), rows of arched windows on
                    every outer wall, the measured roofs in slate and glass over the two courtyards,
                    gilt finials on the towers' spires; and the passage through the central wing from
                    the Stadhouderskade to the Museumplein, its axis between the central towers'
                    solids on each front: a vaulted tunnel 10 m wide and 10 m high (from photographs)
                    under a great arch at each end with a blind arch either side, the cycle path
                    between two footways. The storeys' bands and windows are placed from photographs.
  Canal bridges     every bridge OpenStreetMap outlines over a canal, the Amstel or the IJ: a
                    deck from bank to bank at the measured ground of the two banks, with a
                    crown, and a brick arch under it springing just above the water.

Statistics for the tour (scene.json "landmarks"): the canal houses and their gables by type,
the measured roofs, the houses' median year, and the canals' level.
"""
import math
import os

import numpy as np
import shapely
from shapely import wkb as swkb

import archkit as ak
from meshkit import Mesh

TOWERS = {  # a tower with a footprint of its own
    "Westertoren": {"height": 85.0, "design": "wester"},
    "Munttoren": {"height": 35.0, "design": "munt", "side": 7.0},
    "Montelbaanstoren": {"height": 48.0, "design": "montelbaan"},
}
CHURCH_TOWERS = {  # a tower inside its church's footprint: centred under the 3DBAG's highest tiers
    "Zuiderkerk": {"height": 68.0, "design": "zuider", "label": "Zuidertoren", "side": 8.5},
    "Oude Kerk": {"height": 67.0, "design": "oudekerk", "label": "Oudekerkstoren", "side": 9.0},
}
GABLES = ["spout", "step", "neck", "bell", "cornice"]

MATERIALS = {
    "tower_brick": {"color": "#7b4636", "roughness": 0.9, "metalness": 0.0},
    "sandstone": {"color": "#d9cfb6", "roughness": 0.85, "metalness": 0.0},
    "lead": {"color": "#4e5860", "roughness": 0.5, "metalness": 0.55},
    "white_wood": {"color": "#ece8de", "roughness": 0.7, "metalness": 0.0},
    "crown_blue": {"color": "#2c4f8c", "roughness": 0.45, "metalness": 0.2},
    "gilt": {"color": "#d4a63a", "roughness": 0.3, "metalness": 0.9},
    "bridge_brick": {"color": "#8a4f3c", "roughness": 0.9, "metalness": 0.0},
    "bridge_deck": {"color": "#6b6964", "roughness": 0.9, "metalness": 0.0},
    "bridge_stone": {"color": "#cfc6b3", "roughness": 0.85, "metalness": 0.0},
    "railing": {"color": "#2c2e2c", "roughness": 0.6, "metalness": 0.5, "pattern": "railing", "bar_m": 0.18, "rails_m": [0.1, 0.92]},
}


def _frac(x, y):
    return (math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1.0


# ---------------------------------------------------------------- build_scene hooks

_SITES = None


def tower_sites(ctx):
    """The towers' own footprints (OpenStreetMap), read once, as (name, outline): the 3DBAG can
    register a church and its tower as one building, and the church's footprint then takes some
    of the tower's tiers; the tower draws them instead."""
    global _SITES
    if _SITES is None:
        import duckdb
        C = ctx.city
        path = os.path.join(C.raw, "overture_building.parquet")
        names = "', '".join(n.replace("'", "''") for n in TOWERS)
        _SITES = [(n, C.to_local(swkb.loads(bytes(w)))) for n, w in
                  duckdb.connect().execute(f"SELECT name, wkb FROM '{path}' WHERE name IN ('{names}')").fetchall()]
    return _SITES


def adjust_building(b, cls, g, geoms, ctx):
    name = b.get("name")
    if name not in TOWERS:
        for tname, site in tower_sites(ctx):
            if site.distance(g) < 6.0:
                for gm in geoms:  # a piece against the tower and over 60% of its height is the tower's
                    if gm[2] > 0.6 * TOWERS[tname]["height"] and site.distance(gm[0].centroid) < 6.0:
                        ctx.hide(gm)
    if cls == "houseboat":
        # an ark is a flat-roofed box on a concrete hull: a height or floor count mapped for the boat
        # stands, otherwise it takes the typical 2.6-3.5 m (source "typical", which the neighbour
        # estimate leaves alone: the houses on the quay say nothing about the boats)
        c = g.centroid
        h = round(2.6 + 0.9 * _frac(c.x, c.y), 1)
        for gm in geoms:
            gm[1] = 0.0
            if gm[3] not in ("mapped", "floors"):
                gm[2], gm[3] = h, "typical"
        return geoms
    if name in TOWERS:
        t = TOWERS[name]
        mr = np.asarray(g.minimum_rotated_rectangle.exterior.coords)[:4]
        side = t.get("side") or float(min(np.hypot(*(mr[1] - mr[0])), np.hypot(*(mr[2] - mr[1])), 13.0))
        _anchor(ctx, name, t, g.centroid, side, mr[1] - mr[0], g)
        for gm in geoms:
            ctx.hide(gm)
    if name in CHURCH_TOWERS and geoms:
        # the 3DBAG draws a spire as a stack of small roof tiers: the tower stands under those in
        # the top quarter of the church's height
        t, pl = CHURCH_TOWERS[name], ctx.plateau
        idx = [i for i in pl.tree.query(g) if g.contains(pl.polys[i].centroid)] if pl.tree is not None else []
        if idx:
            hmax = max(pl.h[i] for i in idx)
            c = shapely.union_all([pl.polys[i] for i in idx if pl.h[i] >= 0.75 * hmax]).centroid
            mr = np.asarray(g.minimum_rotated_rectangle.exterior.coords)[:4]
            edge = mr[1] - mr[0]
            sq = tower_square(c.x, c.y, t["side"], math.degrees(math.atan2(edge[1], edge[0])) % 90)
            _anchor(ctx, t["label"], t, c, t["side"], edge, sq)
            body = church_body([(gm[0], gm[2]) for gm in geoms])
            for gm in geoms:  # the pieces the drawn tower stands in place of
                if draws_instead(gm[0], gm[2], sq, t["side"], body):
                    ctx.hide(gm)
    return geoms


def tower_square(x, y, side, axis_deg):
    """The square a church tower is drawn on (landmark_meshes): side m wide, turned axis_deg."""
    a = math.radians(axis_deg)
    u, v = np.array([math.cos(a), math.sin(a)]) * side / 2, np.array([-math.sin(a), math.cos(a)]) * side / 2
    c = np.array([x, y])
    return shapely.Polygon([c - u - v, c + u - v, c + u + v, c - u + v])


def church_body(pieces):
    """The height of a church's body, the top of its main roofs: the highest of its pieces of 100 m2 or
    more. pieces: [(outline, top above the ground)]."""
    return max((top for poly, top in pieces if poly.area >= 100), default=0.0)


def draws_instead(poly, top, sq, side, body):
    """Whether the tower drawn on the square sq (side m wide) stands in place of a church piece (its
    outline, its top above the ground): the piece lies mostly inside the square, or it is the measured
    tower's masonry, which the survey draws up to half as wide again as the drawn shaft: rising more than
    2 m over the church's body (church_body) with its centre within 0.75 side of the tower's. The body's
    pieces round the tower, its nave and aisle roofs, are never hidden unless the square covers them
    mostly: they stay drawn and in the surface model."""
    poly = poly if poly.is_valid else poly.buffer(0)
    if poly.area <= 0:
        return False
    if poly.intersection(sq).area > 0.5 * poly.area:
        return True
    return top > body + 2.0 and poly.centroid.distance(sq.centroid) < 0.75 * side


def refresh_hidden(scene, solids):
    """scene.json hidden_solids for the church towers, from the built city's solids by the same rule as
    adjust_building (draws_instead), without rebuilding the scene: (solid indices to show, to hide)."""
    towers = {t["name"]: t for t in scene["landmarks"].get("towers", [])}
    show, hide = set(), set()
    for church, t in CHURCH_TOWERS.items():
        tw = towers.get(t["label"])
        if not tw:
            continue
        sq = tower_square(*tw["centre"], tw["side_m"], tw["axis_deg"])
        pieces = [(sd, shapely.Polygon(sd["ring"])) for sd in solids if sd["name"] == church]
        body = church_body([(poly, sd["top"]) for sd, poly in pieces])
        for sd, poly in pieces:
            if poly.distance(sq) < 30:
                (hide if draws_instead(poly, sd["top"], sq, tw["side_m"], body) else show).add(sd["si"])
    return show, hide


def _anchor(ctx, name, t, c, side, edge, base):
    """The tower's place: its centre, axis, width and the lowest ground under it."""
    ground = min(ctx.ground(x, y) for x, y in np.asarray(base.exterior.coords))
    ctx.landmarks.setdefault("towers", []).append({
        "name": name, "design": t["design"], "centre": [round(c.x, 1), round(c.y, 1)],
        "axis_deg": round(math.degrees(math.atan2(edge[1], edge[0])) % 90, 1), "side_m": round(side, 1),
        "ground_m": round(ground, 1), "height_m": t["height"]})


def finalize(ctx):
    for t in ctx.landmarks.get("towers", []):
        ctx.labels[t["name"]] = [t["centre"][0], t["centre"][1], round(t["ground_m"] + t["height_m"] + 4, 1)]
    ctx.landmarks["bridges"] = canal_bridges(ctx)
    ctx.landmarks["canals"] = {"level_m": ctx.city.cfg.get("datum_offset_m", 0.0), "datum": "NAP"}
    stats(ctx)


def canal_bridges(ctx):
    """Every bridge OpenStreetMap outlines over the city's water: its axis across the water,
    its length and width, and the measured ground at both ends."""
    import duckdb
    C = ctx.city
    con = duckdb.connect()
    path = os.path.join(C.raw, "overture_infrastructure.parquet")
    wpath = os.path.join(C.raw, "overture_water.parquet")
    classes = set(C.cfg.get("water", {}).get("classes", []))
    water = shapely.union_all([C.to_local(swkb.loads(bytes(w))) for cl, w in con.execute(f"SELECT class, wkb FROM '{wpath}'").fetchall()
                               if cl in classes])
    ext = shapely.box(C.x0, C.y0, C.x1, C.y1)
    water = water.intersection(ext.buffer(100))
    shapely.prepare(water)
    out = []
    for name, w in con.execute(f"SELECT name, wkb FROM '{path}' WHERE class = 'bridge'").fetchall():
        g = C.to_local(swkb.loads(bytes(w)))
        if g.geom_type != "Polygon" or g.area < 25 or not ext.contains(g.centroid):
            continue
        if g.intersection(water).area < 0.3 * g.area:
            continue
        mr = np.asarray(g.minimum_rotated_rectangle.exterior.coords)[:4]
        c = np.asarray(g.minimum_rotated_rectangle.centroid.coords[0])
        sides = [mr[1] - mr[0], mr[2] - mr[1]]
        best = None
        for s in sides:  # the axis whose two ends are both on land crosses the water
            L = float(np.hypot(*s))
            ax = s / L
            ends = [c - ax * (L / 2 + 3), c + ax * (L / 2 + 3)]
            wet = sum(water.contains(shapely.Point(*e)) for e in ends)
            key = (wet, -L)
            if best is None or key < best[0]:
                best = (key, ax, L, float(np.hypot(*[x for x in sides if x is not s][0])))
        _, ax, L, W = best
        if L < 4 or W < 1.5:
            continue
        za, zb = (ctx.ground(*(c - ax * (L / 2 + 2))), ctx.ground(*(c + ax * (L / 2 + 2))))
        out.append({"name": name or "", "centre": [round(c[0], 1), round(c[1], 1)], "axis": [round(ax[0], 5), round(ax[1], 5)],
                    "length_m": round(L, 1), "width_m": round(W, 1), "z_ends": [round(max(za, 0.8), 2), round(max(zb, 0.8), 2)]})
    print(f"amsterdam: {len(out)} bridges over the water")
    return out


def stats(ctx):
    """The model's own numbers for the tour."""
    meta, props = getattr(ctx, "meta", None), getattr(ctx, "prop_rows", None) or []
    if not meta:
        return
    import typology
    gi = typology.STYLES.index("grachtenpand")
    canal = [m for m in meta if len(m) > 10 and m[10] == gi]
    gables = [GABLES[p[9]] for p in props if p[1] == 5]
    ctx.landmarks["canal_houses"] = {"n": len(canal), "gables": len(gables),
                                     "by_type": {t: gables.count(t) for t in GABLES}}
    mi = ctx.roof_sources.index("measured")
    measured = [m for m in meta if len(m) > 16 and m[16] == mi]
    pitched = [m for m in measured if ctx.roof_shapes[m[15]] != "flat"]
    adam = next((m for m in meta if m[0] == "A'DAM Toren"), None)
    if adam:  # the tallest building in the model, for the game's north bank
        ctx.landmarks["adam_toren"] = {"height_m": adam[2], "source": adam[4], "published_m": 80.0}
    ctx.landmarks["roofs"] = {"measured": len(measured), "measured_pitched": len(pitched),
                              "gabled_pct": round(100 * sum(ctx.roof_shapes[m[15]] in ("gabled", "gabled_across") for m in pitched) / max(1, len(pitched)), 1)}


# ---------------------------------------------------------------- game surfaces

def game_surfaces(scene):
    """The bridge decks: walked, and the canal boats pass under them."""
    out = []
    for k, b in enumerate(scene["landmarks"].get("bridges", [])):
        out.append({"name": b["name"] or f"bridge {k}", "type": "strip", "origin": b["centre"], "axis": b["axis"],
                    "half_width": round(b["width_m"] / 2, 1), "profile": deck_profile(b), "thickness": 0.8,
                    "mesh": "bridge_deck", "fly_under": False, "label": b["name"] or "the bridge"})
    return out


# ---------------------------------------------------------------- things to walk up to (game.json "close")

# where people come up to a tower's foot from (a unit vector, east and north): the Munttoren from
# Muntplein's west side, by the Singel; the Westertoren from the Prinsengracht quay. (Not the
# Oudekerkstoren from Oudekerksplein: the measured pieces it hides, which a walker still meets,
# reach 2.3 m out in front of its drawn west face.)
TOWER_FRONT = {"Munttoren": (-1.0, 0.0), "Westertoren": (-1.0, 0.0), "Oudekerkstoren": (-1.0, 0.0)}
# canal bridges to lean on the railing of: one over the Amstel, one over a ring canal
RAIL_BRIDGES = ("Halvemaansbrug", "Vingboomsbrug")


def xy(p):
    return [round(float(p[0]), 2), round(float(p[1]), 2)]


def close_to(name, at, z, start, within=1.5, keep=0.0):
    """A thing to walk up to (game.json "close"): `at` on it at the floor's height z, the walk starting at
    `start`; tools/close_step.js must get within `within` m and never nearer than `keep`."""
    return {"name": name, "at": [*xy(at), round(float(z), 2)], "from": xy(start), "within": within, **({"keep": keep} if keep else {})}


def game_extras(scene):
    """The things people walk up to: two towers' feet, and the railings of two canal bridges at
    their crowns."""
    lm, close = scene["landmarks"], []
    for t in lm.get("towers", []):
        f = TOWER_FRONT.get(t["name"])
        if not f:
            continue
        c, a, half = np.asarray(t["centre"], float), math.radians(t["axis_deg"]), t["side_m"] / 2
        if t["design"] not in ("munt", "montelbaan"):  # a square shaft: out to the face square on to f
            u, n = np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)])
            half /= max(abs(float(np.dot(f, u))), abs(float(np.dot(f, n))))
        at = c + np.asarray(f) * half
        close.append(close_to(f"{t['name']}, its foot", at, t["ground_m"], at + np.asarray(f) * 5.0, 1.0, 0.3))
    for b in lm.get("bridges", []):
        if b["name"] not in RAIL_BRIDGES or any(c["name"].startswith(b["name"]) for c in close):
            continue
        ax = np.asarray(b["axis"], float)
        n = np.array([-ax[1], ax[0]])
        prof = deck_profile(b)
        z = float(np.interp(0.0, [p[0] for p in prof], [p[1] for p in prof]))
        v = b["width_m"] / 2 - 0.15  # bridge(): the railing's line
        at = np.asarray(b["centre"], float) + n * v
        start = at - n * min(5.0, b["width_m"] - 1.0) - ax * max(0.0, 5.0 - (b["width_m"] - 1.0))
        close.append(close_to(f"{b['name']}, its railing", at, z, start, 0.8, 0.2))
    return {"close": close}


def deck_profile(b):
    """[[u, z]] along the axis: the two banks, and a crown of 4% of the length (0.3-1.2 m), as a
    canal bridge humps over the boats."""
    L, (za, zb) = b["length_m"], b["z_ends"]
    crown = min(1.2, max(0.3, 0.04 * L))
    us = np.linspace(-L / 2 - 1.5, L / 2 + 1.5, 9)
    t = (us - us[0]) / (us[-1] - us[0])
    return [[round(float(u), 1), round(float(za + (zb - za) * k + crown * 4 * k * (1 - k)), 2)] for u, k in zip(us, t)]


# ---------------------------------------------------------------- landmarks

def landmark_meshes(scene):
    lm = scene["landmarks"]
    meshes = []
    for t in lm.get("towers", []):
        meshes += tower(t)
    for b in lm.get("bridges", []):
        meshes += bridge(b)
    more, hidden, clip = rijksmuseum()
    mats = {k: dict(v) for k, v in MATERIALS.items()}
    for k in ("rijks_brick", "rijks_stone"):  # floodlit from below
        mats[k]["flood"] = [0.0, 45.0, 0.5, 0.55]
    return mats, meshes + more, {"hidden": hidden, "clip": clip}


def prism(m, c, a, w, d, z0, z1, top=True):
    """A box w by d, rotated a radians, from z0 to z1 (no floor)."""
    ca, sa = math.cos(a), math.sin(a)
    P = [(c[0] + ca * x - sa * y, c[1] + sa * x + ca * y) for x, y in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
    for (x0, y0), (x1, y1) in zip(P, P[1:] + P[:1]):
        m.quad((x0, y0, z0), (x1, y1, z0), (x1, y1, z1), (x0, y0, z1))
    if top:
        m.quad(*[(x, y, z1) for x, y in P])


def tower(t):
    """A Dutch Renaissance tower: a square (or round) brick shaft, then stages that narrow as
    they rise, each in its material, and a spire with a gilt finial."""
    c, a, s = t["centre"], math.radians(t["axis_deg"]), t["side_m"]
    z, H = t["ground_m"], t["height_m"]
    brick, stone, lead = Mesh(f"tower_{t['name']}_brick", "tower_brick", False, floodlit=True), \
        Mesh(f"tower_{t['name']}_stone", "sandstone", False, floodlit=True), Mesh(f"tower_{t['name']}_lead", "lead", False)
    wood, gilt = Mesh(f"tower_{t['name']}_wood", "white_wood", False, floodlit=True), Mesh(f"tower_{t['name']}_gilt", "gilt", False, floodlit=True)
    out = [brick, stone, lead, wood, gilt]
    oct_ = lambda m, z0, z1, r0, r1=None: m.lathe([(z0, r0), (z1, r1 if r1 is not None else r0)], c, segs=8)
    cap = lambda m, zz, r0, r1: m.lathe([(zz, r0), (zz, r1)], c, segs=8)
    d = t["design"]
    if d == "wester":
        prism(brick, c, a, s, s, z, z + 0.47 * H)
        prism(stone, c, a, s + 0.6, s + 0.6, z + 0.47 * H, z + 0.49 * H)
        prism(stone, c, a, 0.78 * s, 0.78 * s, z + 0.49 * H, z + 0.6 * H)
        oct_(stone, z + 0.6 * H, z + 0.7 * H, 0.33 * s)
        cap(stone, z + 0.7 * H, 0.33 * s, 0.36 * s)
        oct_(wood, z + 0.7 * H, z + 0.79 * H, 0.26 * s)
        cap(lead, z + 0.79 * H, 0.26 * s, 0.29 * s)
        crown = Mesh(f"tower_{t['name']}_crown", "crown_blue", False, floodlit=True)
        crown.lathe([(z + 0.79 * H, 0.2 * s), (z + 0.82 * H, 0.27 * s), (z + 0.86 * H, 0.17 * s), (z + 0.88 * H, 0.06 * s)], c, segs=8)
        out.append(crown)
        lead.lathe([(z + 0.88 * H, 0.06 * s), (z + 0.97 * H, 0.02 * s)], c, segs=8)
    elif d == "zuider":
        prism(brick, c, a, s, s, z, z + 0.45 * H)
        oct_(stone, z + 0.45 * H, z + 0.6 * H, 0.4 * s)
        cap(stone, z + 0.6 * H, 0.4 * s, 0.42 * s)
        oct_(stone, z + 0.6 * H, z + 0.7 * H, 0.32 * s)
        oct_(wood, z + 0.7 * H, z + 0.77 * H, 0.26 * s)
        lead.lathe([(z + 0.77 * H, 0.28 * s), (z + 0.82 * H, 0.2 * s), (z + 0.86 * H, 0.22 * s), (z + 0.97 * H, 0.02 * s)], c, segs=8)
    elif d == "oudekerk":
        prism(brick, c, a, s, s, z, z + 0.42 * H)
        oct_(lead, z + 0.42 * H, z + 0.58 * H, 0.4 * s, 0.37 * s)
        cap(lead, z + 0.58 * H, 0.37 * s, 0.3 * s)
        oct_(wood, z + 0.58 * H, z + 0.7 * H, 0.3 * s)
        cap(lead, z + 0.7 * H, 0.3 * s, 0.24 * s)
        oct_(wood, z + 0.7 * H, z + 0.78 * H, 0.22 * s)
        lead.lathe([(z + 0.78 * H, 0.24 * s), (z + 0.97 * H, 0.02 * s)], c, segs=8)
    else:  # montelbaan, munt: a round brick shaft under timber stages
        r = s / 2
        frac = 0.42 if d == "montelbaan" else 0.5
        brick.lathe([(z, r), (z + frac * H, r * 0.97), (z + frac * H, 0.0)], c, segs=20)
        oct_(wood, z + frac * H, z + (frac + 0.17) * H, 0.62 * r)
        cap(lead, z + (frac + 0.17) * H, 0.62 * r, 0.5 * r)
        oct_(wood, z + (frac + 0.17) * H, z + (frac + 0.27) * H, 0.44 * r)
        lead.lathe([(z + (frac + 0.27) * H, 0.48 * r), (z + 0.97 * H, 0.03 * r)], c, segs=8)
    gilt.lathe([(z + 0.97 * H, 0.0), (z + 0.975 * H, 0.35), (z + 0.99 * H, 0.35), (z + H, 0.0)], c, segs=8)
    return out


def bridge(b):
    """A canal bridge on its outline: a deck from bank to bank with a crown, brick sides, a
    brick arch under it springing just above the water, and iron railings."""
    cx, cy = b["centre"]
    ax = np.array(b["axis"], float)
    nx = np.array([-ax[1], ax[0]])
    L, Wd = b["length_m"], b["width_m"]
    prof = deck_profile(b)
    us, zs = np.array([p[0] for p in prof]), np.array([p[1] for p in prof])
    deck_z = lambda u: float(np.interp(u, us, zs))
    P = lambda u, v, z: (float(cx + ax[0] * u + nx[0] * v), float(cy + ax[1] * u + nx[1] * v), float(z))
    deck, side = Mesh("bridge_deck", "bridge_deck", False), Mesh("bridge_brick", "bridge_brick", False)
    rail = Mesh("bridge_rail", "railing", False, uv=True)
    hw = Wd / 2
    u_s = np.linspace(-L / 2, L / 2, 13)
    for u0, u1 in zip(u_s[:-1], u_s[1:]):
        z0, z1 = deck_z(u0), deck_z(u1)
        deck.quad(P(u0, -hw, z0), P(u1, -hw, z1), P(u1, hw, z1), P(u0, hw, z0))
    # the arch: springing 0.3 m above the water at the banks, its crown 0.7 m under the deck
    spring, crown = 0.3, max(0.8, deck_z(0) - 0.7)
    ts = np.linspace(0, 1, 13)
    arc = [(-L / 2 + L * t, spring + (crown - spring) * math.sin(math.pi * t) ** 0.7) for t in ts]
    for (ua, za), (ub, zb) in zip(arc[:-1], arc[1:]):
        side.quad(P(ua, -hw, za), P(ua, hw, za), P(ub, hw, zb), P(ub, -hw, zb))  # the soffit
        for v in (-hw, hw):  # the spandrel walls up to the deck
            side.quad(P(ua, v, za), P(ub, v, zb), P(ub, v, deck_z(ub) + 0.05), P(ua, v, deck_z(ua) + 0.05))
    for v in (-hw + 0.15, hw - 0.15):
        rail.panel([P(u, v, deck_z(u)) for u in u_s], 1.0)
    return [deck, side, rail]


# ---------------------------------------------------------------- the Rijksmuseum

RIJKS_OSM = "w431070185"  # the Rijksmuseumgebouw: 46 solids in the 3DBAG
# the passage's axis, from the north front to the south: the midpoints between the two central towers'
# measured solids on each front (local metres)
RIJKS_PASSAGE = ((-473.0, -1420.5), (-512.5, -1467.0))
PASSAGE_W, PASSAGE_SPRING, PASSAGE_CROWN = 10.0, 6.5, 10.0  # m, from photographs
# the side aisles either side of it, for walkers: their axes where OpenStreetMap maps the two footways
# through the building (ways 310324474 and 310324477, 7.8 m either side of the cycle path's), each under the
# smaller arch either side of the great one on both fronts (3.2 m wide, springing at 4.4 m), and open to the
# cycle passage through an arcade between the vault's pilasters (issues #120, #127)
AISLE_V, AISLE_W, AISLE_SPRING, AISLE_CROWN = 7.8, 3.2, 4.4, 6.0
# storeys above the building's ground (m): the granite plinth, the ground floor, the main floor of the
# galleries and the attic, each with its windows (sill, width, height to the arch's crown)
RIJKS_BANDS = (2.6, 9.6, 18.8)
RIJKS_WINDOWS = ((3.6, 1.5, 4.0), (11.0, 1.9, 6.2), (20.4, 1.3, 3.6))
RIJKS_BAY = 4.4

MATERIALS.update({
    # Cuypers' dark red brick, the pale sandstone of its bands and arches, the Ourthe granite of the plinth,
    # the slate of the roofs and the glass over the courtyards; floodlit after dark, the windows lit
    "rijks_brick": {"color": "#8a3f2f", "roughness": 0.88, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.11, "block_m": 0.27,
                    "emissive": "#e0805c", "glow": 0.2},
    "rijks_stone": {"color": "#d2c09c", "roughness": 0.8, "metalness": 0.0, "emissive": "#ffdcae", "glow": 0.2},
    "rijks_granite": {"color": "#7e7a72", "roughness": 0.75, "metalness": 0.0},
    "rijks_slate": {"color": "#3f464e", "roughness": 0.55, "metalness": 0.25},
    "rijks_glass": {"color": "#8399a6", "roughness": 0.12, "metalness": 0.55, "emissive": "#ffe2b8", "glow": 0.25},
    "rijks_vault": {"color": "#9b5a46", "roughness": 0.9, "metalness": 0.0, "emissive": "#ffd7a8", "glow": 0.2},
    "rijks_cycle": {"color": "#9c4a3e", "roughness": 0.85, "metalness": 0.0},
    "rijks_win": {"color": "#25282c", "roughness": 0.25, "metalness": 0.3, "emissive": "#ffd39a", "glow": 0.35},
})


def _ccw(ring):
    pts = [tuple(p) for p in ring]
    if pts and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts if ak.ring_area(pts) > 0 else pts[::-1]


def rijksmuseum():
    """The Rijksmuseum (P. J. H. Cuypers, 1885) on its 46 measured solids, which it hides: their walls in
    red brick with sandstone string courses over a granite plinth, arched windows in rows on every outer
    wall, the 3DBAG's measured roofs in slate (glass over the two courtyards), gilt finials on the towers;
    and the passage through the central wing from the Stadhouderskade front to the Museumplein front, a
    10 m wide vaulted tunnel under a great arch at each end, with a smaller arch either side into an aisle
    for walkers, open to the cycle passage through an arcade, its outer wall glass."""
    from shapely.geometry import LineString, Polygon
    solids = [s for s in ak.load_solids("amsterdam") if s["osm"] == RIJKS_OSM]
    if not solids:
        return [], [], []
    roofs = ak.measured_roofs("amsterdam")
    T = ak.Terrain("amsterdam")
    K = ak.Kit("rijksmuseum", floodlit={"rijks_brick", "rijks_stone", "rijks_win", "rijks_glass", "rijks_vault"}, uv={"rijks_brick"})
    brick, stone, granite, slate, glass, win = (K[m] for m in ("rijks_brick", "rijks_stone", "rijks_granite", "rijks_slate", "rijks_glass", "rijks_win"))
    polys = {s["si"]: Polygon(s["ring"], s["holes"]).buffer(0) for s in solids}
    U = shapely.union_all(list(polys.values())).buffer(0.05)
    g_ref = float(np.median([s["ground"] for s in solids]))
    a, b = (np.asarray(p, float) for p in RIJKS_PASSAGE)
    d = (b - a) / np.linalg.norm(b - a)
    f = np.array([-d[1], d[0]])  # across the passage
    C = LineString([a - d * 25, b + d * 25]).buffer(PASSAGE_W / 2, cap_style="flat")  # out past both fronts
    aw = AISLE_V + AISLE_W / 2  # the aisles' outer walls, from the axis
    CA = LineString([a - d * 25, b + d * 25]).buffer(aw, cap_style="flat")  # the passage and its aisles
    # the passage's floor: the street's level outside its two fronts (the bare earth under the building, which
    # the built city guesses, dips 2 m in the middle)
    pz = (T(*(a - d * 3.0)) + T(*(b + d * 3.0))) / 2
    crown = pz + PASSAGE_CROWN

    def walls(ring, z0, z1, detail=True):
        pts = _ccw(ring)
        s = 0.0
        for p, q in zip(pts, pts[1:] + pts[:1]):
            L = math.dist(p, q)
            if L < 0.05:
                continue
            s += ak.wall(brick, ak.WORLD, p[0], p[1], q[0], q[1], z0, z1, s)
            t = (np.asarray(q) - np.asarray(p)) / L
            mid = (np.asarray(p) + np.asarray(q)) / 2 + np.array([t[1], -t[0]]) * 0.4
            if not detail or L < 2.5 or U.contains(shapely.Point(*mid)):
                continue  # an inner wall, against another of the building's solids
            # the granite plinth, the string courses and the cornice, where the wall reaches them
            zp = min(z1, g_ref + RIJKS_BANDS[0])
            if zp > z0:
                ak.edge_band(granite, p, q, z0, 0.25, zp - z0)
            for zb in RIJKS_BANDS[1:]:
                if z0 < g_ref + zb < z1 - 1.0:
                    ak.edge_band(stone, p, q, g_ref + zb, 0.14, 0.38)
            if z1 - z0 > 4.0:
                ak.edge_band(stone, p, q, z1 - 0.9, 0.3, 0.6)
            for sill, w, h in RIJKS_WINDOWS:
                zs = g_ref + sill
                if zs >= z0 + 0.3 and zs + h <= z1 - 1.2 and L >= w + 1.6:
                    ak.openings_along(win, ak.WORLD, p, q, zs, w, h, RIJKS_BAY, arch=True, margin=1.4)
            # above the attic's windows on a tall wall (the towers), a row of smaller ones
            for zs in np.arange(g_ref + 26.0, z1 - 4.5, 5.5):
                if L >= 2.6:
                    ak.openings_along(win, ak.WORLD, p, q, zs, 1.1, 3.0, 3.6, arch=True, margin=1.0)
        return pts

    hidden = []
    for sd in solids:
        si, poly = sd["si"], polys[sd["si"]]
        hidden.append(si)
        r = roofs.get(si)
        g0 = sd["ground"]
        eave = g0 + (r["eave"] if r else sd["top"])
        z0 = g0 - 0.6
        if poly.intersection(CA).area > 1.0 and eave > crown + 1.0:  # under it, the passage and its aisles
            za = pz + AISLE_CROWN
            for cut, zz0, zz1 in ((CA, z0, za), (C, za, crown)):
                rest = poly.difference(cut)
                for p in getattr(rest, "geoms", [rest]):
                    if p.area > 0.5:
                        walls(list(p.exterior.coords), zz0, zz1, detail=zz0 == z0)
            z0 = crown
        rings = [list(poly.exterior.coords)] if poly.geom_type == "Polygon" else [list(g.exterior.coords) for g in poly.geoms]
        for ring in rings:
            pts = walls(ring, z0, eave)
            if not r:
                ak.cap(slate, ak.WORLD, pts, eave)
        if r:
            roof_m = glass if poly.area > 900 else slate  # the courtyards' glass roofs
            for t in r["roof"]:
                roof_m.tri(*t)
            for t in r["rest"]:
                brick.tri(*t)
            # a tower's spire: a gilt finial at its apex
            if poly.area < 160 and r["top"] - r["eave"] > 8.0:
                apex = max((v for t in r["roof"] for v in t), key=lambda v: v[2])
                K["gilt"].box(apex, (apex[0], apex[1], apex[2] + 3.2), 0.18, 0.18, up=(1, 0, 0))
                K["gilt"].lathe([(apex[2] + 1.0, 0.45), (apex[2] + 1.5, 0.05)], apex[:2], segs=8)

    # the passage: its vault between the two fronts, the great arch and the blind arches each side
    inside = C.intersection(U)
    ts = [float(np.dot(np.asarray(c) - a, d)) for c in inside.exterior.coords] if inside.geom_type == "Polygon" else \
        [float(np.dot(np.asarray(c) - a, d)) for g in inside.geoms for c in g.exterior.coords]
    t0, t1 = min(ts), max(ts)
    hw = PASSAGE_W / 2
    ends = {}  # each aisle's two fronts, along the axis
    for side in (-1, 1):
        lane = LineString([a - d * 25 + f * side * AISLE_V, b + d * 25 + f * side * AISLE_V]).buffer(AISLE_W / 2, cap_style="flat").intersection(U)
        cs = [c for g in getattr(lane, "geoms", [lane]) for c in g.exterior.coords]
        tt = [float(np.dot(np.asarray(c) - a, d)) for c in cs] or [t0, t1]
        ends[side] = (min(tt), max(tt))
    zv = lambda v: pz + PASSAGE_SPRING + (PASSAGE_CROWN - PASSAGE_SPRING) * (1 - (v / hw) ** 2)
    vs = np.linspace(-hw, hw, 13)
    Pt = lambda t, v, z: (*(a + d * t + f * v), z)
    vault = K["rijks_vault"]
    for v0, v1 in zip(vs[:-1], vs[1:]):
        vault.quad(Pt(t0, v0, zv(v0)), Pt(t1, v0, zv(v0)), Pt(t1, v1, zv(v1)), Pt(t0, v1, zv(v1)))
        for t in (t0, t1):  # the brick over the arch, up to the floor above
            brick.quad(Pt(t, v0, zv(v0)), Pt(t, v1, zv(v1)), Pt(t, v1, crown + 0.4), Pt(t, v0, crown + 0.4))
    for t in np.arange(t0 + 5.0, t1 - 3.0, 6.0):  # the vault's sandstone ribs, on pilasters
        for v0, v1 in zip(vs[:-1], vs[1:]):
            stone.box(Pt(t, v0, zv(v0) - 0.15), Pt(t, v1, zv(v1) - 0.15), 0.5, 0.3, up=(0, 0, 1))
        for v in (-hw + 0.2, hw - 0.2):
            stone.box(Pt(t, v, pz), Pt(t, v, pz + PASSAGE_SPRING), 0.6, 0.4, up=(0, 0, 1))
        for v in (-hw, hw):  # a lamp on each pilaster
            K["rijks_win"].box(Pt(t, v * 0.93, pz + 4.2), Pt(t, v * 0.93, pz + 4.8), 0.3, 0.3, up=(1, 0, 0))
    for t, out in ((t0, -1.0), (t1, 1.0)):
        o = out * 0.25
        for v0, v1 in zip(vs[:-1], vs[1:]):  # the arch's sandstone voussoirs
            stone.box(Pt(t + o, v0, zv(v0) + 0.35), Pt(t + o, v1, zv(v1) + 0.35), 0.7, 0.5, up=tuple(d) + (0,))
        for v in (-hw, hw):  # its piers
            granite.box(Pt(t + o, v, pz - 0.3), Pt(t + o, v, pz + PASSAGE_SPRING), 0.9, 0.5, up=(0, 0, 1))
        for side in (-1, 1):  # the smaller arch either side, into an aisle
            vc, ar = side * AISLE_V, AISLE_W / 2
            ta = ends[side][0 if out < 0 else 1]
            pts = [(vc + ar * math.cos(q), pz + AISLE_SPRING + ar * math.sin(q)) for q in np.linspace(0, math.pi, 9)]
            for (v0, z0), (v1, z1) in zip(pts[:-1], pts[1:]):
                stone.box(Pt(ta + out * 0.12, v0, z0 + 0.2), Pt(ta + out * 0.12, v1, z1 + 0.2), 0.4, 0.35, up=tuple(d) + (0,))
                # the brick between the arch and the aisle's ceiling, on the front and on the inside
                for o2, sgn in ((0.0, 1), (-out * 0.5, -1)):
                    zc = pz + AISLE_CROWN + 0.05
                    brick.quad(*([Pt(ta + o2, v0, z0), Pt(ta + o2, v1, z1), Pt(ta + o2, v1, zc), Pt(ta + o2, v0, zc)][::sgn * side * int(out)]))
            for v in (vc - ar, vc + ar):  # its piers
                granite.box(Pt(ta + out * 0.12, v, pz - 0.3), Pt(ta + out * 0.12, v, pz + AISLE_SPRING), 0.5, 0.4, up=(0, 0, 1))
    # the aisles: a barrel vault over each, an arcade between it and the cycle passage (an arch between each
    # two of the vault's pilasters, on piers), the outer wall glass with the museum's doors behind it
    for side in (-1, 1):
        sa, sb = ends[side]
        vi, vo = side * hw, side * aw
        vs2 = np.linspace(min(vi, vo), max(vi, vo), 7)
        zs = lambda v: pz + AISLE_SPRING + (AISLE_CROWN - AISLE_SPRING) * (1 - ((v - side * (hw + aw) / 2) / ((aw - hw) / 2)) ** 2)
        for v0, v1 in zip(vs2[:-1], vs2[1:]):
            q = [Pt(sa, v0, zs(v0)), Pt(sb, v0, zs(v0)), Pt(sb, v1, zs(v1)), Pt(sa, v1, zs(v1))]
            vault.quad(*q)
        # the arcade: piers on the line of the pilasters, an arch between each two, brick over it up to the vault
        piers = [sa] + [t for t in np.arange(t0 + 5.0, t1 - 3.0, 6.0) if sa + 1.0 < t < sb - 1.0] + [sb]
        vm = side * (hw + 0.6)
        for t in piers[1:-1]:
            brick.box(Pt(t, vm, pz), Pt(t, vm, pz + AISLE_SPRING), 1.2, 1.2, up=(0, 0, 1))
            granite.box(Pt(t, vm, pz - 0.2), Pt(t, vm, pz + 0.6), 1.35, 1.35, up=(0, 0, 1))
        for ta, tb in zip(piers[:-1], piers[1:]):
            ta2, tb2 = ta + (0.6 if ta != sa else 0.0), tb - (0.6 if tb != sb else 0.0)
            if tb2 - ta2 < 1.0:
                continue
            tc, r = (ta2 + tb2) / 2, (tb2 - ta2) / 2
            zr = lambda q: pz + AISLE_SPRING + min(r, AISLE_CROWN - AISLE_SPRING - 0.25) * math.sin(q)
            arc = [(tc - r * math.cos(q), zr(q)) for q in np.linspace(0, math.pi, 9)]
            for v in (vi, side * (hw + 1.2)):  # both faces of the arcade
                sgn = 1 if (v == vi) == (side > 0) else -1
                for (u0, z0), (u1, z1) in zip(arc[:-1], arc[1:]):
                    brick.quad(*([Pt(u0, v, z0), Pt(u1, v, z1), Pt(u1, v, pz + AISLE_CROWN + 0.3), Pt(u0, v, pz + AISLE_CROWN + 0.3)][::sgn]))
                for (u0, z0), (u1, z1) in zip(arc[:-1], arc[1:]):  # the arch's sandstone, under it
                    stone.quad(*([Pt(u0, vi, z0 - 0.02), Pt(u1, vi, z1 - 0.02), Pt(u1, side * (hw + 1.2), z1 - 0.02), Pt(u0, side * (hw + 1.2), z0 - 0.02)][::-sgn]))
        # the glass of the outer wall, between brick piers, and a lamp over each bay
        gl = vo - side * 0.15
        for ta, tb in zip(piers[:-1], piers[1:]):
            glass.quad(*([Pt(ta + 0.4, gl, pz), Pt(tb - 0.4, gl, pz), Pt(tb - 0.4, gl, pz + AISLE_SPRING), Pt(ta + 0.4, gl, pz + AISLE_SPRING)][::side]))
            K["rijks_win"].box(Pt((ta + tb) / 2, vo - side * 0.6, pz + AISLE_CROWN - 0.5), Pt((ta + tb) / 2, vo - side * 0.6, pz + AISLE_CROWN - 0.2), 0.3, 0.3, up=(1, 0, 0))
    # the passage's floor, level from the street at one end to the square at the other (the ground the
    # viewer draws there is the bare earth under the building: not drawn, "clip"): the red cycle path
    # between two footways of granite setts
    za, zb = T(*Pt(t0 - 3.0, 0, 0)[:2]), T(*Pt(t1 + 3.0, 0, 0)[:2])
    zt = lambda t: za + (zb - za) * (t - t0 + 2.0) / (t1 - t0 + 4.0) + 0.04
    ts = np.linspace(t0 - 2.0, t1 + 2.0, 9)
    for v0, v1, m in ((-aw, -hw + 2.5, granite), (-hw + 2.5, hw - 2.5, K["rijks_cycle"]), (hw - 2.5, aw, granite)):
        for ta, tb in zip(ts[:-1], ts[1:]):
            m.quad(Pt(ta, v0, zt(ta)), Pt(tb, v0, zt(tb)), Pt(tb, v1, zt(tb)), Pt(ta, v1, zt(ta)))
    floor = [Pt(t0 - 2.0, -aw, 0)[:2], Pt(t1 + 2.0, -aw, 0)[:2], Pt(t1 + 2.0, aw, 0)[:2], Pt(t0 - 2.0, aw, 0)[:2]]
    return K.out(), sorted(hidden), [{"ring": [[round(x, 2), round(y, 2)] for x, y in floor]}]
