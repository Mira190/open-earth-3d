"""Paris: what the generic pipeline cannot know from open data.

Heights and roofs come from IGN (pipeline/measured.py): BD TOPO eaves under LiDAR HD tops,
so most buildings need nothing here. The hooks build what a laser over a footprint cannot.

Building adjustments (called by pipeline/build_scene.py):
  * Eiffel Tower: OSM maps a 330 m block over the whole 9,763 m2 base (w5013364). It is
    dropped; the tower is the parametric lattice below. It is open iron, so the surface
    model for the sun analyses does not include it.
  * Arc de Triomphe and the Louvre Pyramid: their solids are kept for the sun analyses
    and drawn as landmarks instead (the arch's openings, the pyramid's glass).
  * Colonne Vendôme: OSM tags it with a mansard roof; it is a column.

Parametric landmarks (called by pipeline/landmarks.py), placed with anchors measured from
the data:
  Eiffel Tower    330 m to the tip of the antenna (2022); floors at 57.6 m, 115.7 m and
                  276.1 m; a base 124.9 m square, four legs that join at the second floor
                  (toureiffel.paris, "The Eiffel Tower in figures"; Wikipedia). The curve of
                  the corner edges between those points, the legs' 25 m width and the
                  decorative arches' rise are approximations from photographs. The iron is
                  drawn as a lattice cut out of each face (web/world.js "lattice"), in three
                  browns, darker at the base, as it is painted; after dark it is lit gold and
                  sparkles for five minutes at the start of every hour.
  Seine bridges   every bridge OpenStreetMap outlines over the river, on its own outline:
                  a deck from quay to quay at the measured height of the two banks, with a
                  slight crown, parapets, masonry arches and piers with cutwaters. Span
                  counts are published for the bridges in SPANS; for the others the span is
                  about 30 m, as the masonry bridges of Paris have, and the count follows.
                  Pont Alexandre III is one steel arch of 107.5 m, with its four pylons.
  Notre-Dame      the spire, 96 m above the parvis, rebuilt to Viollet-le-Duc's design and
                  unveiled in 2024; the LiDAR of March 2023 saw only its scaffolding.
  Arc de Triomphe 50 m high, 45 m wide and 22 m deep; the great arch 29.2 m high and
                  14.6 m wide, the side arches 18.7 m by 8.4 m (Wikipedia).
  Louvre Pyramid  21.6 m high on a base 35.4 m square, glass on a steel net.

Statistics for the tour (scene.json "landmarks"): the share of LiDAR-profiled pitched roofs
that are mansards and the median measured roof height, the eaves of the buildings dated
1850-1914, and the Seine's level.
"""
import math
import os

import numpy as np
import shapely
from shapely import wkb as swkb
from shapely.geometry import LineString, Point

from meshkit import Mesh

EIFFEL = {"height": 330.0, "base_half": 62.45, "leg": 25.0, "floor1": 57.6, "floor2": 115.7, "floor3": 276.1,
          # half-width of the outer edge at heights (m): the base, the two lower floors, the top floor
          "profile": [(0.0, 62.45), (20.0, 50.5), (40.0, 41.5), (57.6, 35.3), (85.0, 26.5), (115.7, 20.3), (160.0, 15.0),
                      (210.0, 11.4), (276.1, 8.3), (290.0, 5.5)]}
EIFFEL_OSM = "w5013364"
ARC = {"height": 49.5, "width": 45.0, "depth": 22.0, "arch_h": 29.19, "arch_w": 14.62, "side_h": 18.68, "side_w": 8.44}
PYRAMID = {"height": 21.6, "base": 35.4}
SPIRE_M = 96.0
NOTRE_DAME = "Cathédrale Notre-Dame de Paris"
# published span counts (Wikipedia, each bridge's article)
SPANS = {"Pont Neuf": None, "Pont Royal": 5, "Pont de la Concorde": 5, "Pont Alexandre III": 1, "Pont des Arts": 7,
         "Pont Saint-Michel": 3, "Pont Marie": 5, "Pont d'Iéna": 5, "Pont d'Arcole": 1, "Pont au Double": 1, "Pont Saint-Louis": 1,
         "Petit-Pont - Cardinal Lustiger": 1, "Pont au Change": 3}
STEEL = {"Pont Alexandre III", "Pont des Arts", "Pont d'Arcole", "Pont au Double", "Pont Saint-Louis", "Pont de Bir-Hakeim",
         "Passerelle Léopold-Sédar-Senghor", "Passerelle Debilly", "Pont de l'Alma", "Pont du Carrousel"}
FOOTBRIDGES = {"Pont des Arts", "Passerelle Léopold-Sédar-Senghor", "Passerelle Debilly"}

MATERIALS = {
    "iron_low": {"color": "#5f4a37", "roughness": 0.6, "metalness": 0.45, "pattern": "lattice", "bay_m": 4.2, "bar_m": 0.42,
                 "emissive": "#ffb347", "glow": 0.9, "sparkle": True},
    "iron_mid": {"color": "#6c553f", "roughness": 0.6, "metalness": 0.45, "pattern": "lattice", "bay_m": 3.4, "bar_m": 0.34,
                 "emissive": "#ffb347", "glow": 0.9, "sparkle": True},
    "iron_top": {"color": "#7a6248", "roughness": 0.6, "metalness": 0.45, "pattern": "lattice", "bay_m": 2.4, "bar_m": 0.24,
                 "emissive": "#ffb347", "glow": 0.9, "sparkle": True},
    "iron": {"color": "#634e3a", "roughness": 0.55, "metalness": 0.5, "emissive": "#ffb347", "glow": 0.75},
    "deck_iron": {"color": "#5d4a38", "roughness": 0.7, "metalness": 0.3, "emissive": "#ffb347", "glow": 0.6},
    "cabin": {"color": "#9aa3a6", "roughness": 0.2, "metalness": 0.6},
    "stone": {"color": "#d6cbb5", "roughness": 0.85, "metalness": 0.0},
    "stone_dark": {"color": "#b9ad97", "roughness": 0.9, "metalness": 0.0},
    "asphalt": {"color": "#55585b", "roughness": 0.9, "metalness": 0.0},
    "bridge_steel": {"color": "#6f7a78", "roughness": 0.5, "metalness": 0.55},
    "timber_deck": {"color": "#8a6b4f", "roughness": 0.85, "metalness": 0.0},
    "gilt": {"color": "#d4a63a", "roughness": 0.3, "metalness": 0.9},
    "balustrade": {"color": "#d0c6b0", "roughness": 0.85, "metalness": 0.0, "pattern": "railing", "bar_m": 0.32, "rails_m": [0.12, 0.95]},
    "lead": {"color": "#5b6066", "roughness": 0.5, "metalness": 0.5},
    "pyramid_glass": {"color": "#a9c0c8", "roughness": 0.05, "metalness": 0.75},
    "pyramid_net": {"color": "#3c4246", "roughness": 0.4, "metalness": 0.7},
}


# ---------------------------------------------------------------- build_scene hooks

def adjust_building(b, cls, g, geoms, ctx):
    rid = (b.get("record_id") or "").split("@")[0]
    if rid == EIFFEL_OSM:
        mr = np.asarray(g.minimum_rotated_rectangle.exterior.coords)[:4]
        e = mr[1] - mr[0]
        c = g.centroid
        ctx.landmarks["eiffel_tower"] = {"centre": [round(c.x, 1), round(c.y, 1)], "axis_deg": round(math.degrees(math.atan2(e[1], e[0])) % 90, 2),
                                         "ground_m": round(ctx.ground(c.x, c.y), 1), "height_m": EIFFEL["height"],
                                         "floors_m": [EIFFEL["floor1"], EIFFEL["floor2"], EIFFEL["floor3"]], "base_m": 2 * EIFFEL["base_half"]}
        return []
    if b.get("name") == "Colonne Vendôme":
        b["roof_shape"] = None
        for gm in geoms:
            if len(gm) > 5 and isinstance(gm[5], dict):
                gm[5]["roof_shape"] = None
    if b.get("name") in ("Arc de Triomphe", "Pyramide du Louvre"):
        key = "arc_de_triomphe" if b["name"] == "Arc de Triomphe" else "louvre_pyramid"
        mr = np.asarray(g.minimum_rotated_rectangle.exterior.coords)[:4]
        sides = [mr[1] - mr[0], mr[2] - mr[1]]
        long_ = max(sides, key=lambda v: np.hypot(*v))
        c = g.centroid
        ctx.landmarks[key] = {"centre": [round(c.x, 1), round(c.y, 1)], "axis_deg": round(math.degrees(math.atan2(long_[1], long_[0])), 2),
                              "ground_m": round(min(ctx.ground(x, y) for x, y in np.asarray(g.exterior.coords)), 1)}
        for gm in geoms:
            ctx.hide(gm)
    if b.get("name") == NOTRE_DAME:
        # the crossing: where nave and transept meet, the footprint's centre along its long axis
        c = g.centroid
        ctx.landmarks["notre_dame"] = {"centre": [round(c.x, 1), round(c.y, 1)], "ground_m": round(ctx.ground(c.x, c.y), 1), "spire_m": SPIRE_M}
    return geoms


def finalize(ctx):
    C = ctx.city
    e = ctx.landmarks.get("eiffel_tower")
    if e:
        ctx.labels["Eiffel Tower"] = [e["centre"][0], e["centre"][1], round(e["ground_m"] + EIFFEL["height"] + 8, 1)]
    a = ctx.landmarks.get("arc_de_triomphe")
    if a:
        ctx.labels["Arc de Triomphe"] = [a["centre"][0], a["centre"][1], round(a["ground_m"] + ARC["height"] + 5, 1)]
    ctx.landmarks["bridges"] = seine_bridges(ctx)
    ctx.landmarks["seine"] = {"level_m": C.cfg.get("datum_offset_m", 0.0), "datum": "NGF-IGN69"}
    stats(ctx)


def seine_bridges(ctx):
    """Every named bridge outlined in OpenStreetMap that crosses the Seine: its axis across the
    river, deck width, and the measured ground at both ends (the quays)."""
    import duckdb
    C = ctx.city
    con = duckdb.connect()
    con.execute("LOAD spatial")
    path = os.path.join(C.raw, "overture_infrastructure.parquet")
    wpath = os.path.join(C.raw, "overture_water.parquet")
    river = shapely.union_all([C.to_local(swkb.loads(bytes(w))) for (w,) in con.execute(f"SELECT wkb FROM '{wpath}' WHERE class = 'river'").fetchall()])
    out = []
    for name, w in con.execute(f"SELECT name, wkb FROM '{path}' WHERE class = 'bridge' AND name IS NOT NULL").fetchall():
        g = C.to_local(swkb.loads(bytes(w)))
        if g.geom_type != "Polygon" or g.area < 500 or not name.startswith(("Pont", "Petit-Pont", "Passerelle")):
            continue
        over = g.intersection(river).area / g.area
        if over < 0.3:
            continue
        mr = np.asarray(g.minimum_rotated_rectangle.exterior.coords)[:4]
        s1, s2 = mr[1] - mr[0], mr[2] - mr[1]
        L1, L2 = np.hypot(*s1), np.hypot(*s2)
        ax = (s1 / L1) if L1 >= L2 else (s2 / L2)
        length, width = max(L1, L2), min(L1, L2)
        c = np.asarray(g.minimum_rotated_rectangle.centroid.coords[0])
        # the banks: the measured ground a few metres beyond each end, on land
        za, zb = ctx.ground(*(c - ax * (length / 2 + 4))), ctx.ground(*(c + ax * (length / 2 + 4)))
        za, zb = max(za, 5.0), max(zb, 5.0)
        out.append({"name": name, "centre": [round(c[0], 1), round(c[1], 1)], "axis": [round(ax[0], 5), round(ax[1], 5)],
                    "length_m": round(length, 1), "width_m": round(width, 1), "z_ends": [round(za, 2), round(zb, 2)],
                    "spans": SPANS.get(name) or max(1, round(length / 30)), "steel": name in STEEL, "foot": name in FOOTBRIDGES})
    print(f"paris: {len(out)} Seine bridges")
    return out


def stats(ctx):
    """The model's own numbers for the tour."""
    ign = getattr(ctx, "plateau", None)
    rows = getattr(ign, "rows", [])
    eaves = [r["hauteur"] for r in rows if r.get("hauteur") and r.get("date_d_apparition")
             and 1850 <= int(r["date_d_apparition"][:4]) <= 1914 and r.get("usage_1") == "Résidentiel" and (r.get("nombre_d_etages") or 0) >= 5]
    if eaves:
        ctx.landmarks["haussmann"] = {"n": len(eaves), "eaves_median_m": round(float(np.median(eaves)), 1),
                                      "eaves_p90_m": round(float(np.percentile(eaves, 90)), 1),
                                      "note": "BD TOPO residential buildings of five floors or more dated 1850-1914"}
    # the roofs the LiDAR profiled (build_scene.py hands the finished buildings to this hook)
    meta, roof_rows, shapes = getattr(ctx, "meta", None), getattr(ctx, "roof_rows", None), getattr(ctx, "roof_shapes", None)
    if meta and shapes:
        mi = ctx.roof_sources.index("measured")
        pitched = [shapes[m[15]] for m in meta if len(m) > 16 and m[16] == mi and shapes[m[15]] != "flat"]
        heights = [(r[1] - r[2]) / 10 for r in roof_rows]
        if pitched:
            ctx.landmarks["roofs"] = {"measured_pitched": len(pitched),
                                      "mansard_pct": round(100 * sum(x in ("mansard", "gambrel") for x in pitched) / len(pitched), 1),
                                      "median_roof_m": round(float(np.median(heights)), 1) if heights else None}


# ---------------------------------------------------------------- game surfaces

def game_surfaces(scene):
    """The bridge decks (walked and driven, flown under) and the Eiffel Tower's first floor
    (flown under: a quest step)."""
    out = []
    for b in scene["landmarks"].get("bridges", []):
        out.append({"name": b["name"], "type": "strip", "origin": b["centre"], "axis": b["axis"], "half_width": round(b["width_m"] / 2, 1),
                    "profile": deck_profile(b), "thickness": 1.6, "mesh": "bridge_deck", "fly_under": True, "label": b["name"]})
    e = scene["landmarks"].get("eiffel_tower")
    if e:
        a = math.radians(e["axis_deg"])
        z = round(e["ground_m"] + EIFFEL["floor1"], 1)
        hw = 35.3
        out.append({"name": "Eiffel Tower first floor", "type": "strip", "origin": e["centre"], "axis": [round(math.cos(a), 5), round(math.sin(a), 5)],
                    "half_width": hw, "profile": [[-hw, z], [hw, z]], "thickness": 7.0, "mesh": "eiffel_floor1", "fly_under": True,
                    "label": "the Eiffel Tower's first floor"})
    return out


def deck_profile(b):
    """[[u, z]] along the axis: the two banks, and a crown of 1% of the length (at least 0.6 m)."""
    L, (za, zb) = b["length_m"], b["z_ends"]
    crown = max(0.6, 0.01 * L) if not b["steel"] else 0.4
    us = np.linspace(-L / 2 - 3, L / 2 + 3, 9)
    t = (us - us[0]) / (us[-1] - us[0])
    return [[round(float(u), 1), round(float(za + (zb - za) * k + crown * 4 * k * (1 - k)), 2)] for u, k in zip(us, t)]


# ---------------------------------------------------------------- landmarks

def landmark_meshes(scene):
    lm = scene["landmarks"]
    meshes = []
    if "eiffel_tower" in lm:
        meshes += eiffel_tower(lm["eiffel_tower"])
    for b in lm.get("bridges", []):
        meshes += bridge(b)
    if "notre_dame" in lm:
        meshes += spire(lm["notre_dame"], scene)
    if "arc_de_triomphe" in lm:
        meshes += arc(lm["arc_de_triomphe"])
    if "louvre_pyramid" in lm:
        meshes += pyramid(lm["louvre_pyramid"])
    return MATERIALS, meshes


def eiffel_tower(t):
    gz = t["ground_m"]
    cx, cy = t["centre"]
    a = math.radians(t["axis_deg"])
    ca, sa = math.cos(a), math.sin(a)
    P = lambda x, y, z: (float(cx + ca * x - sa * y), float(cy + sa * x + ca * y), float(gz + z))
    zs_p, ws_p = zip(*EIFFEL["profile"])
    W = lambda z: float(np.interp(z, zs_p, ws_p))
    f2 = EIFFEL["floor2"]
    # the inner edge of a leg: 25 m in from the outer edge at the base, closing to nothing at the second floor
    I = lambda z: max(0.0, (W(0) - EIFFEL["leg"]) * (1 - z / f2) ** 1.25) if z < f2 else 0.0
    mat = lambda z: "iron_low" if z < EIFFEL["floor1"] else "iron_mid" if z < f2 else "iron_top"
    out = {}

    def mesh(name, m):
        if name not in out:
            out[name] = Mesh(name, m, False, floodlit=True, uv=m.startswith("iron_"))
        return out[name]

    # legs: four tapering box girders, each face a lattice panel, the corner edges solid
    levels = list(np.arange(0, f2, 5.0)) + [f2]
    for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        def ring(z):
            o, i = W(z), I(z)
            return [(sx * i, sy * i), (sx * o, sy * i), (sx * o, sy * o), (sx * i, sy * o)]
        for face in range(4):
            for lo, hi in zip(levels[:-1], levels[1:]):
                m = mesh(f"eiffel_leg{k}_{mat(lo)}", mat(lo))
                r0, r1 = ring(lo), ring(hi)
                a0, b0, a1, b1 = r0[face], r0[(face + 1) % 4], r1[face], r1[(face + 1) % 4]
                w0, w1 = math.dist(a0, b0), math.dist(a1, b1)
                if w0 < 0.3 and w1 < 0.3:
                    continue
                m.quad(P(*a0, lo), P(*b0, lo), P(*b1, hi), P(*a1, hi), [[0, lo], [w0, lo], [w1, hi], [0, hi]])
            # the corner edge, a solid member
            edge = mesh(f"eiffel_leg{k}_edges", "iron")
            for lo, hi in zip(levels[:-1], levels[1:]):
                p0, p1 = ring(lo)[face], ring(hi)[face]
                wd = 1.8 * (1 - lo / 160) + 0.6
                edge.box(P(*p0, lo), P(*p1, hi), wd, wd)
    # the shaft above the second floor
    top_levels = list(np.arange(f2, 290.0, 6.0)) + [290.0]
    shaft = mesh("eiffel_shaft", "iron_top")
    edges = mesh("eiffel_shaft_edges", "iron")
    corners = ((1, 1), (-1, 1), (-1, -1), (1, -1))
    for lo, hi in zip(top_levels[:-1], top_levels[1:]):
        w0, w1 = W(lo), W(hi)
        for f in range(4):
            (ax_, ay_), (bx_, by_) = corners[f], corners[(f + 1) % 4]
            shaft.quad(P(ax_ * w0, ay_ * w0, lo), P(bx_ * w0, by_ * w0, lo), P(bx_ * w1, by_ * w1, hi), P(ax_ * w1, ay_ * w1, hi),
                       [[0, lo], [2 * w0, lo], [2 * w1, hi], [0, hi]])
            edges.box(P(ax_ * w0, ay_ * w0, lo), P(ax_ * w1, ay_ * w1, hi), 0.9, 0.9)
    # the decorative arches under the first floor, one on each face between two legs
    arches = mesh("eiffel_arches", "iron")
    for f, (ux, uy) in enumerate(((1, 0), (0, 1), (-1, 0), (0, -1))):
        vx, vy = -uy, ux  # along the face
        pts = []
        for s in np.linspace(-1, 1, 25):
            z = 12.0 + (49.0 - 12.0) * math.sqrt(max(0.0, 1 - s * s))
            x = s * I(z)
            pts.append(P(ux * W(z) * 0.98 + vx * x, uy * W(z) * 0.98 + vy * x, z))
        for p0, p1 in zip(pts[:-1], pts[1:]):
            arches.box(p0, p1, 1.4, 1.6)
    # the floors: the first a square ring with its frieze, the second a full square, the third an enclosed cabin
    fl1 = mesh("eiffel_floor1", "deck_iron")
    z1 = EIFFEL["floor1"]
    for f in range(4):
        (ax_, ay_), (bx_, by_) = corners[f], corners[(f + 1) % 4]
        # outer frieze band, 7 m deep, and the platform behind it
        fl1.box(P(ax_ * 35.3, ay_ * 35.3, z1 - 3.5), P(bx_ * 35.3, by_ * 35.3, z1 - 3.5), 1.2, 7.0)
        fl1.box(P(ax_ * 28.0, ay_ * 28.0, z1 - 0.4), P(bx_ * 28.0, by_ * 28.0, z1 - 0.4), 14.6, 0.8)
    fl2 = mesh("eiffel_floor2", "deck_iron")
    z2 = f2
    fl2.box(P(0, -20.3, z2 - 2.5), P(0, 20.3, z2 - 2.5), 40.6, 5.0)
    cab = mesh("eiffel_top", "cabin")
    z3 = EIFFEL["floor3"]
    cab.box(P(0, -8.3, z3 + 3.0), P(0, 8.3, z3 + 3.0), 16.6, 6.0)
    top = mesh("eiffel_top_iron", "iron")
    top.box(P(0, -9.0, z3 - 0.5), P(0, 9.0, z3 - 0.5), 18.0, 1.0)
    top.box(P(0, -6.0, z3 + 6.5), P(0, 6.0, z3 + 6.5), 12.0, 1.0)
    # the campanile and the antennas to 330 m
    top.box(P(0, 0, z3 + 7), P(0, 0, 300.0), 5.0, 5.0)
    top.box(P(0, 0, 300.0), P(0, 0, 312.0), 2.6, 2.6)
    top.box(P(0, 0, 312.0), P(0, 0, EIFFEL["height"]), 0.9, 0.9)
    return list(out.values())


def bridge(b):
    """A Seine bridge on its outline: deck, parapets, arches and piers (masonry), or a steel
    deck on a shallow arch."""
    cx, cy = b["centre"]
    ax = np.array(b["axis"], float)
    nx = np.array([-ax[1], ax[0]])
    L, Wd = b["length_m"], b["width_m"]
    prof = deck_profile(b)
    us, zs = np.array([p[0] for p in prof]), np.array([p[1] for p in prof])
    deck_z = lambda u: float(np.interp(u, us, zs))
    P = lambda u, v, z: (float(cx + ax[0] * u + nx[0] * v), float(cy + ax[1] * u + nx[1] * v), float(z))
    deck = Mesh("bridge_deck", "asphalt" if not b["foot"] else "timber_deck", False)
    side = Mesh("bridge_side", "bridge_steel" if b["steel"] else "stone", False, floodlit=not b["steel"])
    rail = Mesh("bridge_rail", "balustrade", False, uv=True)
    piers = Mesh("bridge_piers", "stone_dark", False)
    hw = Wd / 2
    u_s = np.linspace(-L / 2, L / 2, 25)
    # the deck slab: road surface on top, the slab's edge faces
    for u0, u1 in zip(u_s[:-1], u_s[1:]):
        z0, z1 = deck_z(u0), deck_z(u1)
        deck.quad(P(u0, -hw, z0), P(u1, -hw, z1), P(u1, hw, z1), P(u0, hw, z0))
        for v in (-hw, hw):
            side.quad(P(u0, v, z0 - 1.6), P(u1, v, z1 - 1.6), P(u1, v, z1 + 0.05), P(u0, v, z0 + 0.05))
    # parapets: a balustrade along both edges
    for v in (-hw + 0.25, hw - 0.25):
        rail.panel([P(u, v, deck_z(u)) for u in u_s], 1.0)
    # arches and piers below: n spans between piers 3 m thick, springing 1.5 m above the water
    n = max(1, int(b["spans"]))
    pier_t = 0 if n == 1 else 3.2
    span = (L - (n - 1) * pier_t) / n
    spring = 1.5
    for k in range(n):
        u0 = -L / 2 + k * (span + pier_t)
        u1 = u0 + span
        crown = min(deck_z((u0 + u1) / 2) - 1.8, spring + (0.32 if not b["steel"] else 0.12) * span)
        ts = np.linspace(0, 1, 13)
        arc = [(u0 + (u1 - u0) * t, spring + (crown - spring) * math.sin(math.pi * t) ** (0.8 if not b["steel"] else 1.0)) for t in ts]
        if b["steel"]:
            # open steelwork: an arch rib under each edge of the deck, posts from the rib up to the deck
            for v in (-hw + 0.6, hw - 0.6):
                for (ua, za), (ub, zb) in zip(arc[:-1], arc[1:]):
                    side.box(P(ua, v, za), P(ub, v, zb), 0.5, 0.9)
                for ua, za in arc[2:-2:2]:
                    side.box(P(ua, v, za), P(ua, v, deck_z(ua) - 1.6), 0.25, 0.25)
        else:
            for (ua, za), (ub, zb) in zip(arc[:-1], arc[1:]):
                # the soffit (intrados) across the width, and the spandrel walls from the arch up to the deck on both faces
                side.quad(P(ua, -hw + 0.4, za), P(ua, hw - 0.4, za), P(ub, hw - 0.4, zb), P(ub, -hw + 0.4, zb))
                for v in (-hw + 0.4, hw - 0.4):
                    side.quad(P(ua, v, za), P(ub, v, zb), P(ub, v, deck_z(ub) - 1.6), P(ua, v, deck_z(ua) - 1.6))
        if k < n - 1 and pier_t:
            um = u1 + pier_t / 2
            # a pier from the riverbed to the springing, with pointed cutwaters up- and downstream
            top = spring + 0.6
            for z0, z1 in ((-4.0, top),):
                pts = [(-pier_t / 2, -hw), (pier_t / 2, -hw), (pier_t / 2, hw), (-pier_t / 2, hw)]
                for (a0, b0), (a1, b1) in zip(pts, pts[1:] + pts[:1]):
                    piers.quad(P(um + a0, b0, z0), P(um + a1, b1, z0), P(um + a1, b1, z1), P(um + a0, b0, z1))
                for sgn in (-1, 1):  # cutwaters
                    tip = (0.0, sgn * (hw + pier_t * 0.9))
                    for (a0, b0), (a1, b1) in (((-pier_t / 2, sgn * hw), tip), (tip, (pier_t / 2, sgn * hw))):
                        piers.quad(P(um + a0, b0, z0), P(um + a1, b1, z0), P(um + a1, b1, z1), P(um + a0, b0, z1))
    out = [deck, side, rail, piers]
    if b["name"] == "Pont Alexandre III":
        # the four pylons at the ends, 17 m columns with gilded Fames and Pegasi on top
        pyl, gilt = Mesh("bridge_pylons", "stone", False, floodlit=True), Mesh("bridge_gilt", "gilt", False, floodlit=True)
        for u in (-L / 2 - 4, L / 2 + 4):
            for v in (-hw - 2.5, hw + 2.5):
                z = deck_z(max(min(u, L / 2), -L / 2))
                pyl.box(P(u, v, z), P(u, v, z + 17.0), 4.2, 4.2)
                gilt.box(P(u, v, z + 17.0), P(u, v, z + 21.5), 2.0, 1.4)
        out += [pyl, gilt]
    return out


def spire(nd, scene):
    """Notre-Dame's spire: an octagonal lead-clad timber spire from the roof ridge at the crossing to 96 m."""
    cx, cy = nd["centre"]
    gz = nd["ground_m"]
    m = Mesh("notre_dame_spire", "lead", False, floodlit=True)
    prof = [(gz + 42.0, 4.4), (gz + 50.0, 4.0), (gz + 52.0, 3.4), (gz + 62.0, 2.8), (gz + 64.0, 2.2), (gz + 90.0, 0.35), (gz + SPIRE_M, 0.05)]
    m.lathe(prof, (cx, cy), segs=8)
    return [m]


def arc(t):
    """The Arc de Triomphe: four piers under an attic, the great arch through the long faces and
    the side arches through the short ones."""
    cx, cy, gz = t["centre"][0], t["centre"][1], t["ground_m"]
    a = math.radians(t["axis_deg"])
    ca, sa = math.cos(a), math.sin(a)
    P = lambda x, y, z: (float(cx + ca * x - sa * y), float(cy + sa * x + ca * y), float(gz + z))
    m = Mesh("arc_de_triomphe", "stone", False, floodlit=True)
    Wd, D, H = ARC["width"], ARC["depth"], ARC["height"]
    aw, ah, sw, sh = ARC["arch_w"], ARC["arch_h"], ARC["side_w"], ARC["side_h"]
    # piers: the four corners left by the great arch (across x) and the side arch (across y)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x0, x1 = sorted((sx * aw / 2, sx * Wd / 2))
            y0, y1 = sorted((sy * sw / 2, sy * D / 2))
            m.box(P((x0 + x1) / 2, y0, 0), P((x0 + x1) / 2, y1, 0), x1 - x0, 0.01)
            m.box(P((x0 + x1) / 2, (y0 + y1) / 2, 0), P((x0 + x1) / 2, (y0 + y1) / 2, ah), x1 - x0, y1 - y0)
        # the walls beside the side arch, up to the great arch's springing
    for sx in (-1, 1):
        x0, x1 = sorted((sx * aw / 2, sx * Wd / 2))
        m.box(P((x0 + x1) / 2, 0, sh), P((x0 + x1) / 2, 0, ah), x1 - x0, sw)
    # the vault of the great arch and the attic above everything
    ts = np.linspace(0, math.pi, 13)
    for t0, t1 in zip(ts[:-1], ts[1:]):
        p0 = (-math.cos(t0) * aw / 2, ah - aw / 2 + math.sin(t0) * aw / 2)
        p1 = (-math.cos(t1) * aw / 2, ah - aw / 2 + math.sin(t1) * aw / 2)
        m.quad(P(p0[0], -D / 2, p0[1]), P(p1[0], -D / 2, p1[1]), P(p1[0], D / 2, p1[1]), P(p0[0], D / 2, p0[1]))
        for y in (-D / 2, D / 2):
            m.quad(P(p0[0], y, p0[1]), P(p1[0], y, p1[1]), P(p1[0], y, ah + 0.01), P(p0[0], y, ah + 0.01))
    m.box(P(0, 0, ah), P(0, 0, H), Wd, D)
    return [m]


def pyramid(t):
    """I. M. Pei's pyramid: glass faces and the steel net drawn over them."""
    cx, cy, gz = t["centre"][0], t["centre"][1], t["ground_m"]
    a = math.radians(t["axis_deg"])
    ca, sa = math.cos(a), math.sin(a)
    h, s = PYRAMID["height"], PYRAMID["base"] / 2
    P = lambda x, y, z: (float(cx + ca * x - sa * y), float(cy + sa * x + ca * y), float(gz + z))
    glass, net = Mesh("louvre_pyramid", "pyramid_glass", False, floodlit=True), Mesh("louvre_pyramid_net", "pyramid_net", False)
    c = [(-s, -s), (s, -s), (s, s), (-s, s)]
    apex = P(0, 0, h)
    for k in range(4):
        (x0, y0), (x1, y1) = c[k], c[(k + 1) % 4]
        glass.tri(P(x0, y0, 0), P(x1, y1, 0), apex)
        # the net: rungs up the face and the hip ribs
        for f in np.linspace(0.1, 0.9, 9):
            net.box(P(x0 * (1 - f), y0 * (1 - f), h * f), P(x1 * (1 - f), y1 * (1 - f), h * f), 0.12, 0.12)
        net.box(P(x0, y0, 0), apex, 0.3, 0.3)
    return [glass, net]
