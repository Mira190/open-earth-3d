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
    (below); their measured solids stay in the surface model for the sun analyses.

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
            sq = c.buffer(0.75 * t["side"])
            _anchor(ctx, t["label"], t, c, t["side"], mr[1] - mr[0], sq)
            for gm in geoms:  # the church's tall pieces inside the tower: the tower draws them
                if gm[2] > 25 and gm[0].intersection(sq).area > 0.5 * gm[0].area:
                    ctx.hide(gm)
    return geoms


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
    return MATERIALS, meshes


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
