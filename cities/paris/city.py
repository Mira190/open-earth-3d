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
  * Opéra Garnier: OSM maps its roofs, dome and stage house as parts from 29 to 55 m up and
    only a small part from the street, so the building floated over Place de l'Opéra. The part
    from the street takes the building's whole outline, up to where the raised parts start.

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

import archkit as ak
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
OPERA = "Opéra Garnier"
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
    # the monuments: Lutetian limestone in courses, its mouldings a shade paler, the windows dark until the
    # lights come on, roofs of lead and slate, copper gone green, gilding; floodlit gold after dark ("flood" per
    # monument in landmark_meshes, from its foot)
    "lime": {"color": "#d8ccb2", "roughness": 0.85, "metalness": 0.0, "pattern": "ashlar", "course_m": 1.5, "block_m": 3.2,
             "emissive": "#ffcf8f", "glow": 0.55},
    "lime_trim": {"color": "#e3d8c0", "roughness": 0.8, "metalness": 0.0, "emissive": "#ffcf8f", "glow": 0.6},
    "relief": {"color": "#c7bba2", "roughness": 0.9, "metalness": 0.0, "emissive": "#ffcf8f", "glow": 0.5},
    "win": {"color": "#272a30", "roughness": 0.3, "metalness": 0.3, "emissive": "#ffc77d", "glow": 0.35},
    "lead_roof": {"color": "#59606a", "roughness": 0.55, "metalness": 0.45, "emissive": "#ffd9a6", "glow": 0.25},
    "copper": {"color": "#6a877a", "roughness": 0.55, "metalness": 0.3, "emissive": "#d8ffe8", "glow": 0.3},
    "gold": {"color": "#d8ad45", "roughness": 0.28, "metalness": 0.95, "emissive": "#ffcf6a", "glow": 0.9},
    "steel_white": {"color": "#eceeee", "roughness": 0.4, "metalness": 0.3, "emissive": "#f4f8ff", "glow": 0.35},
    "pompidou_glass": {"color": "#5d7180", "roughness": 0.08, "metalness": 0.6, "pattern": "curtain_wall", "bay_m": 12.8, "storey_m": 7.0,
                       "spandrel": 0.0, "mullion_m": 0.12, "frame": "#d9dcdc", "lit_share": 0.7, "lit_k": 0.45, "emissive": "#ffe3b8", "glow": 0.22},
    "duct_blue": {"color": "#2f62b4", "roughness": 0.45, "metalness": 0.2},
    "duct_green": {"color": "#3a9a48", "roughness": 0.45, "metalness": 0.2},
    "duct_yellow": {"color": "#f0c22b", "roughness": 0.45, "metalness": 0.2},
    "duct_red": {"color": "#d23a2e", "roughness": 0.45, "metalness": 0.2},
    "tube_glass": {"color": "#c9d7dc", "roughness": 0.05, "metalness": 0.4, "opacity": 0.45, "emissive": "#fff1d6", "glow": 0.6},
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
    if b.get("name") == OPERA:
        raised = [gm[1] for gm in geoms if gm[1] > 0]
        for gm in geoms:
            if gm[1] == 0 and raised:
                gm[0], gm[2] = g, min(raised)
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
    mats = {k: dict(v) for k, v in MATERIALS.items()}
    if "arc_de_triomphe" in lm:
        meshes += arc(lm["arc_de_triomphe"], mats)
    if "louvre_pyramid" in lm:
        meshes += pyramid(lm["louvre_pyramid"])
    more, hidden = monuments(mats)
    meshes += more
    return mats, meshes, {"hidden": hidden}


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


# ---------------------------------------------------------------- the monuments on their mapped footprints
#
# Each is drawn on the footprints OpenStreetMap and IGN give it (web/data/paris/buildings.json), which the
# renderers then leave out ("hidden" in landmarks.json; they stay in the surface model), with the parts
# open data cannot carry built to published dimensions (Wikipedia and the monuments' own sites):
#   Arc de Triomphe   50 m high, 45 m wide, 22 m deep; the great arch 29.19 m by 14.62 m, the side arches
#                     18.68 m by 8.44 m; the four high-relief groups on the piers, the entablature and the
#                     attic with its thirty shields.
#   Panthéon          the Greek-cross body to its 30 m frieze; the portico of 22 Corinthian columns under its
#                     pediment, facing rue Soufflot; the dome on a peristyle of 32 columns to 83 m.
#   Dôme des Invalides the church to its entablature, its frontispiece of two orders facing place Vauban, the
#                     drum of paired columns, the lead dome with its gilded ribs and trophies, the lantern and
#                     spire to 107 m.
#   Opéra Garnier     the body to its cornice; the main front (seven arches, the loggia of sixteen paired
#                     columns, the gilded groups of Harmony and Poetry), the copper dome over the auditorium
#                     with its gilded crown, the stage house's gable and Millet's Apollo on it.
#   Saint-Sulpice     the nave under its slate roof, the aisles and chapels; the west front of two orders
#                     (Doric under Ionic) and its two towers, the north one 73 m, the south one left at 68 m.
#   Centre Pompidou   166 m by 60 m by 42 m: the glass box inside its white steel frame (columns every 12.8 m,
#                     the gerberettes, the cross-bracing), the escalator's glass tube across the piazza front
#                     and the ducts on rue du Renard in their codes (blue air, green water, yellow
#                     electricity, red circulation).
#   Palais de Chaillot the two curved wings round the Trocadéro gardens (their outlines from OpenStreetMap,
#                     ways 79742852 and 79749386: the built data has only their pavilions' stubs), the head
#                     pavilions on the parvis, piers and tall windows, and the gilded statues.

def flooded(mats, key, base, z0, z1, roof=0.5, top=0.6):
    """A copy of a material lit by floodlights from z0 (its foot) to z1, under its own name."""
    name = f"{base}_{key}"
    if name not in mats:
        mats[name] = dict(MATERIALS[base])
        mats[name]["flood"] = [round(z0, 1), round(z1, 1), roof, top]
    return name


class Monument(ak.Kit):
    """A kit whose stone, trim, relief and window materials are floodlit from the monument's foot."""

    def __init__(self, key, mats, z0, z1):
        names = {b: flooded(mats, key, b, z0, z1) for b in ("lime", "lime_trim", "relief", "gold", "lead_roof", "copper")}
        names["win"] = "win"
        super().__init__(key, floodlit=set(names.values()), uv={names["lime"], "balustrade"})
        self.n = names

    def m(self, base):
        return self[self.n.get(base, base)]


def monuments(mats):
    solids = ak.load_solids("paris")
    by = {}
    for s in solids:
        by.setdefault(s["osm"], []).append(s)
    out, hidden = [], []
    for osm, fn in (("w16407465", pantheon), ("w112452790", invalides_dome), ("w54667456", opera_garnier),
                    ("w16077204", saint_sulpice), ("w55503397", pompidou), ("r6826569", chaillot)):
        if osm not in by:
            continue
        meshes, hide = fn(by[osm], mats)
        out += meshes
        hidden += hide
    return out, sorted(hidden)


def biggest(rows):
    return max(rows, key=lambda s: abs(ak.ring_area(s["ring"])))


def arc(t, mats):
    """The Arc de Triomphe: four piers under the entablature and the attic, the great arch through the long
    faces and the side arches through the short ones, each arch's archivolt, the impost cornices, the
    high-relief groups on their pedestals and the panels over them, the frieze, the attic's shields."""
    cx, cy, gz = t["centre"][0], t["centre"][1], t["ground_m"]
    P = ak.Frame(cx, cy, t["axis_deg"], gz)
    K = Monument("arc", mats, gz, gz + ARC["height"])
    st, tr, rl = K.m("lime"), K.m("lime_trim"), K.m("relief")
    Wd, D, H = ARC["width"], ARC["depth"], ARC["height"]
    aw, ah, sw, sh = ARC["arch_w"], ARC["arch_h"], ARC["side_w"], ARC["side_h"]
    spring, s_spring = ah - aw / 2, sh - sw / 2
    ent = 31.4  # the entablature's foot, over the great arch's keystone; the attic from 38 m
    att = 38.0
    hw, hd = Wd / 2, D / 2
    # the piers, cut by both arches: each corner pier as one block to the great arch's springing, then
    # the side arch's vault through the long axis and the solid over it
    for sx in (-1, 1):
        u0, u1 = sorted((sx * aw / 2, sx * hw))
        for sy in (-1, 1):
            v0, v1 = sorted((sy * sw / 2, sy * hd))
            ak.block(st, P, u0, u1, v0, v1, 0.0, ent, top=False)
        ak.block(st, P, u0, u1, -sw / 2, sw / 2, sh, ent, top=False)
        # the side arch's vault (across v) and its archivolt on the end face
        um = (u0 + u1) / 2
        k = 10
        for j in range(k):
            a0, a1 = math.pi * j / k, math.pi * (j + 1) / k
            p0 = (-math.cos(a0) * sw / 2, s_spring + math.sin(a0) * sw / 2)
            p1 = (-math.cos(a1) * sw / 2, s_spring + math.sin(a1) * sw / 2)
            st.quad(P(u0, p0[0], p0[1]), P(u1, p0[0], p0[1]), P(u1, p1[0], p1[1]), P(u0, p1[0], p1[1]))
            ue = sx * (hw + 0.25)
            tr.quad(P(ue, p0[0] * 1.0, p0[1]), P(ue, p1[0], p1[1]), P(ue, p1[0] * 1.18, s_spring + (p1[1] - s_spring) * 1.18),
                    P(ue, p0[0] * 1.18, s_spring + (p0[1] - s_spring) * 1.18))
            # the spandrel over the side arch's crown is the block above (sh..ent)
            for ue2 in (u0, u1):
                st.quad(P(ue2, p0[0], p0[1]), P(ue2, p1[0], p1[1]), P(ue2, p1[0], sh), P(ue2, p0[0], sh))
    # the great arch's vault (along v) and the walls over it on both long faces, up to the entablature
    k = 16
    for j in range(k):
        a0, a1 = math.pi * j / k, math.pi * (j + 1) / k
        p0 = (-math.cos(a0) * aw / 2, spring + math.sin(a0) * aw / 2)
        p1 = (-math.cos(a1) * aw / 2, spring + math.sin(a1) * aw / 2)
        st.quad(P(p0[0], -hd, p0[1]), P(p1[0], -hd, p1[1]), P(p1[0], hd, p1[1]), P(p0[0], hd, p0[1]))
        for v in (-hd, hd):
            st.quad(P(p0[0], v, p0[1]), P(p1[0], v, p1[1]), P(p1[0], v, ent), P(p0[0], v, ent))
            ve = v * 1.012
            tr.quad(P(p0[0], ve, p0[1]), P(p1[0], ve, p1[1]), P(p1[0] * 1.14, ve, spring + (p1[1] - spring) * 1.14),
                    P(p0[0] * 1.14, ve, spring + (p0[1] - spring) * 1.14))
        # the coffers: ribs across the vault
        if j % 2 == 0:
            for v in np.linspace(-hd + 1.5, hd - 1.5, 7):
                tr.box(P(p0[0] * 0.98, v, spring + (p0[1] - spring) * 0.98), P(p1[0] * 0.98, v, spring + (p1[1] - spring) * 0.98), 0.4, 0.3)
    # the plinth round the foot, the impost cornices at both springings, the keystones
    outer = ak.rect(-hw, hw, -hd, hd)
    for sx in (-1, 1):  # the plinth round each pier, not across the arches
        for sy in (-1, 1):
            u0, u1 = sorted((sx * aw / 2, sx * hw))
            v0, v1 = sorted((sy * sw / 2, sy * hd))
            ak.band(tr, P, ak.rect(u0, u1, v0, v1), 0.0, out=0.45, h=1.6)
    ak.band(tr, P, outer, spring - 0.9, out=0.35, h=0.9)
    for sv in (-1, 1):
        tr.box(P(0, sv * (hd + 0.2), ah - 1.6), P(0, sv * (hd + 0.2), ah + 0.6), 2.2, 0.8)
    # the four high-relief groups on the long faces' piers (Le Départ de 1792, Le Triomphe de 1810, La Résistance,
    # La Paix), each on its pedestal, and the panels over them
    for sx in (-1, 1):
        um = sx * (aw / 2 + (hw - aw / 2) / 2)
        for sv in (-1, 1):
            v = sv * hd
            ak.block(rl, P, um - 3.6, um + 3.6, min(v, v + sv * 2.4), max(v, v + sv * 2.4), 0.0, 5.6)
            ak.block(rl, P, um - 3.0, um + 3.0, min(v, v + sv * 1.6), max(v, v + sv * 1.6), 5.6, 17.2)
            for f in (0.25, 0.5, 0.75):  # the figures' masses in the group
                rl.box(P(um - 3.0 + 6.0 * f, v + sv * 1.7, 6.0), P(um - 3.0 + 6.0 * f, v + sv * 1.7, 13.5 + 3 * f * (1 - f)), 1.3, 1.1)
            ak.block(rl, P, um - 3.4, um + 3.4, min(v, v + sv * 0.45), max(v, v + sv * 0.45), spring + 0.6, spring + 7.4)
    # the frieze between two cornices, the entablature's crown, the attic with its shields, the top cornice
    ak.block(st, P, -hw, hw, -hd, hd, ent, att, top=False)
    ak.band(rl, P, outer, ent + 1.2, out=0.25, h=3.0)
    ak.cornice(tr, P, outer, att - 1.8, ((0.0, 0.0), (0.4, 0.3), (0.9, 0.9), (1.4, 1.5), (1.4, 1.8), (0.0, 1.8)))
    ak.block(st, P, -hw + 0.3, hw - 0.3, -hd + 0.3, hd - 0.3, att, H - 1.2)
    ak.cornice(tr, P, ak.rect(-hw + 0.3, hw - 0.3, -hd + 0.3, hd - 0.3), H - 1.2, ((0.0, 0.0), (0.3, 0.3), (0.6, 0.8), (0.6, 1.2), (0.0, 1.2)))
    shields = K.m("relief")
    for sv in (-1, 1):
        for u in np.linspace(-hw + 2.0, hw - 2.0, 10):
            shields.box(P(u, sv * (hd - 0.1), att + 4.2), P(u, sv * (hd - 0.1), att + 6.0), 1.5, 0.5)
    for su in (-1, 1):
        for v in np.linspace(-hd + 2.5, hd - 2.5, 5):
            shields.box(P(su * (hw - 0.1), v, att + 4.2), P(su * (hw - 0.1), v, att + 6.0), 0.5, 1.5)
    return K.out()


def pantheon(rows, mats):
    """The Panthéon on its footprint: the Greek-cross body, the portico and the dome."""
    body = biggest(rows)
    g = body["ground"]
    K = Monument("pantheon", mats, g, g + 83.0)
    st, tr, wn = K.m("lime"), K.m("lime_trim"), K.m("win")
    ak.stone_body(K, body["ring"], g, g + body["top"], (K.n["lime"], K.n["lime_trim"], "win"), storey=None)
    ring = ak.simplify(body["ring"])
    # the garland frieze under the cornice and the blind walls' one high window row at the cross's ends
    ak.band(K.m("relief"), ak.WORLD, ring, g + body["top"] - 4.2, out=0.2, h=2.2)
    ak.band(tr, ak.WORLD, ring, g + 10.5, out=0.15, h=0.6)
    # the dome: the crossing is the centre of the tall round parts
    domes = [s for s in rows if s["top"] > 55]
    cx, cy = np.mean([ak.ring_centroid(s["ring"]) for s in domes], axis=0) if domes else ak.ring_centroid(body["ring"])
    # the portico: the part forward of the body facing rue Soufflot, about 55 m west of the crossing
    port = min(rows, key=lambda s: math.dist(ak.ring_centroid(s["ring"]), (cx - 52.0, cy + 17.0)) + (0 if s is not body else 1e9))
    px, py = ak.ring_centroid(port["ring"])
    ax = math.degrees(math.atan2(py - cy, px - cx))  # from the crossing out through the portico
    F = ak.Frame(px, py, ax, g)
    zt = body["top"]
    # the stylobate's steps, the columns (six across the front, four deep at the sides: 22 with the inner ones)
    ak.steps(st, F, -8.0, 8.0, -18.0, -18.0, 0.0, 0.0, n=1)
    ak.block(st, F, -8.5, 8.5, -18.0, 18.0, 0.0, 1.8)
    for u in (-6.5, -1.0, 4.5):
        ak.colonnade(st, F, u, u, -15.6, 1.8, zt - 6.2, 0.95, 1)
        ak.colonnade(st, F, u, u, 15.6, 1.8, zt - 6.2, 0.95, 1)
    ak.colonnade(st, F, 7.0, 7.0, -15.6, 1.8, zt - 6.2, 0.95, 1)
    ak.colonnade(st, F, 7.0, 7.0, 15.6, 1.8, zt - 6.2, 0.95, 1)
    for v in np.linspace(-15.6, 15.6, 6)[1:-1]:
        ak.colonnade(st, F, 7.0, 7.0, v, 1.8, zt - 6.2, 0.95, 1)
        ak.colonnade(st, F, 1.0, 1.0, v * 0.55, 1.8, zt - 6.2, 0.95, 1) if abs(v) < 8 else None
    # the entablature and the pediment with David d'Angers's relief in its tympanum
    ak.block(st, F, -8.5, 8.6, -17.0, 17.0, zt - 4.4, zt)
    ak.cornice(tr, F, ak.rect(-8.5, 8.6, -17.0, 17.0), zt - 1.2, ((0, 0), (0.3, 0.3), (0.8, 0.9), (0.8, 1.2), (0, 1.2)))
    ak.pediment(st, F, -8.5, 8.6, -17.2, 17.2, zt, 7.4, along_u=False)
    rl = K.m("relief")
    for v in np.linspace(-10, 10, 9):
        rl.box(F(8.75, v, zt + 0.3), F(8.75, v, zt + 0.3 + 6.0 * (1 - abs(v) / 17.2)), 1.3, 0.4)
    # the great door and the windows' blind panels behind the columns
    ak.opening(wn, F, (-8.4, 6.0), (-8.4, -6.0), 1.8, 5.0, 10.0, arch=False, centre=6.0)
    # the dome: a podium, the peristyle of 32 columns with its entablature and balustrade, the attic drum with
    # its windows, the dome with its ribs, the lantern
    c = (cx, cy)
    z0 = g + zt + 1.0
    st.lathe([(z0 - 1.0, 17.4), (z0 + 4.0, 17.4), (z0 + 4.0, 17.0)], c, segs=40)
    ak.cornice(tr, ak.WORLD, [(cx + 17.4 * math.cos(a), cy + 17.4 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 41)[:-1]], z0 + 3.2,
               ((0, 0), (0.4, 0.3), (0.4, 0.8), (0, 0.8)))
    ak.drum(st, c, z0 + 4.0, z0 + 21.0, 13.6, segs=40)
    ak.ring_openings_round(wn, c, z0 + 7.5, 13.6, 16, 2.4, 8.5, arch=True)
    ak.ring_columns(st, c, z0 + 4.0, 14.5, 16.2, 32, 0.72)
    st.lathe([(z0 + 18.5, 16.9), (z0 + 21.0, 16.9), (z0 + 21.0, 13.6)], c, segs=40)
    ak.cornice(tr, ak.WORLD, [(cx + 16.9 * math.cos(a), cy + 16.9 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 41)[:-1]], z0 + 20.0,
               ((0, 0), (0.5, 0.4), (0.5, 1.0), (0, 1.0)))
    ak.balustrade(tr, ak.WORLD, [(cx + 16.6 * math.cos(a), cy + 16.6 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 41)], z0 + 21.0, panel=K['balustrade'])
    ak.drum(st, c, z0 + 21.0, z0 + 28.5, 12.4, segs=40)
    ak.ring_openings_round(wn, c, z0 + 22.5, 12.4, 16, 1.6, 4.0, arch=False, phase=0.5)
    ak.cornice(tr, ak.WORLD, [(cx + 12.4 * math.cos(a), cy + 12.4 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 41)[:-1]], z0 + 27.6,
               ((0, 0), (0.4, 0.3), (0.6, 0.9), (0, 0.9)))
    lead = K.m("lead_roof")
    ak.dome(lead, c, z0 + 28.5, 12.2, 13.5, segs=40, rows=12)
    ak.dome_ribs(lead, c, z0 + 28.5, 12.2, 13.5, 16, w=0.45, d=0.25)
    zl = z0 + 28.5 + 13.0
    ak.drum(st, c, zl, zl + 5.5, 3.0, segs=16)
    ak.ring_columns(st, c, zl, 5.0, 3.6, 12, 0.22)
    ak.dome(lead, c, zl + 5.5, 3.4, 3.0, segs=16, rows=6)
    K.m("gold").box((cx, cy, zl + 8.3), (cx, cy, g + 83.0), 0.35, 0.35)
    hide = [s["si"] for s in rows]
    return K.out(), hide


def invalides_dome(rows, mats):
    """The Dôme des Invalides: the church, its south front, the drum, the gilded dome, lantern and spire."""
    body = biggest(rows)
    g = body["ground"]
    top_m = 107.0
    K = Monument("invalides", mats, g, g + top_m)
    st, tr, wn, rl = K.m("lime"), K.m("lime_trim"), K.m("win"), K.m("relief")
    zt = 27.5  # the main entablature; the frontispiece and the attic over the crossing rise above it
    ak.stone_body(K, body["ring"], g, g + zt, (K.n["lime"], K.n["lime_trim"], "win"), storey=13.0, win=(2.2, 7.0), arch=True, every=6.0, sill=2.5)
    domes = [s for s in rows if s["top"] > 60]
    cx, cy = np.mean([ak.ring_centroid(s["ring"]) for s in domes], axis=0)
    c = (cx, cy)
    # the square attic over the crossing, from the cross's square solid
    sq = max((s for s in rows if 25 < s["top"] < 32 and s is not body), key=lambda s: abs(ak.ring_area(s["ring"])), default=None)
    if sq:
        ak.stone_body(K, sq["ring"], g + zt - 0.5, g + zt + 6.0, (K.n["lime"], K.n["lime_trim"], "win"), storey=None, base_band=False)
    # the south front: two orders, Doric under Corinthian, the pediment over the upper one (u along the axis,
    # the front at its south end)
    xs = [p[1] for p in body["ring"]]
    fy = min(xs)
    F = ak.Frame(cx, fy, 90.0, g)  # u north, v west; the front at u = 0 facing -u (south)
    for (z0, h, r, cap, n) in ((1.5, 12.0, 0.75, "doric", 8), (zt - 13.0 + 13.5, 11.0, 0.65, "corinthian", 8)):
        for vv in np.linspace(-13.0, 13.0, n):
            x, y, z = F(-1.6, vv, z0)
            ak.column(st, x, y, z, h, r, capital=cap)
    ak.block(st, F, -3.0, 0.0, -15.0, 15.0, 13.5, 15.0)
    ak.block(st, F, -3.0, 0.0, -15.0, 15.0, zt + 0.5, zt + 3.0)
    ak.cornice(tr, F, ak.rect(-3.0, 0.0, -15.0, 15.0), zt + 2.0, ((0, 0), (0.4, 0.4), (0.8, 1.0), (0, 1.0)))
    ak.pediment(st, F, -3.0, 0.0, -15.0, 15.0, zt + 3.0, 5.5, along_u=False)
    ak.steps(st, F, -15.0, 15.0, -9.0, -3.0, 0.0, 1.5) if False else ak.block(st, F, -6.0, 0.0, -15.0, 15.0, 0.0, 1.5)
    for vv in (-8, 8):
        rl.box(F(-1.8, vv, 15.6), F(-1.8, vv, 19.8), 1.2, 1.0)  # the statues of Charlemagne and Saint Louis
    ak.opening(wn, F, (0.05, 4.0), (0.05, -4.0), 1.5, 4.0, 8.5, arch=True, centre=4.0)
    # the drum (40 columns in pairs, between them the windows), its attic with the buttresses (consoles)
    z0 = g + zt + 6.0
    R = 14.4
    ak.drum(st, c, z0, z0 + 17.0, R, segs=48)
    ak.ring_openings_round(wn, c, z0 + 4.0, R, 12, 2.4, 9.0, arch=True, phase=0.5)
    for j in range(12):
        a = 2 * math.pi * j / 12
        for da in (-0.045, 0.045):
            ak.column(st, cx + (R + 1.0) * math.cos(a + da), cy + (R + 1.0) * math.sin(a + da), z0, 15.0, 0.6)
        st.box((cx + (R + 0.9) * math.cos(a), cy + (R + 0.9) * math.sin(a), z0 + 17.0),
               (cx + (R + 0.3) * math.cos(a), cy + (R + 0.3) * math.sin(a), z0 + 23.0), 1.8, 2.6)
    ak.cornice(tr, ak.WORLD, [(cx + R * math.cos(a), cy + R * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 49)[:-1]], z0 + 15.0,
               ((0, 0), (0.8, 0.5), (1.6, 1.4), (1.6, 2.0), (0, 2.0)))
    ak.drum(st, c, z0 + 17.0, z0 + 23.0, R - 0.6, segs=48)
    ak.ring_openings_round(wn, c, z0 + 18.5, R - 0.6, 12, 1.6, 2.8, arch=False, phase=0.5)
    ak.balustrade(tr, ak.WORLD, [(cx + (R + 0.8) * math.cos(a), cy + (R + 0.8) * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 49)], z0 + 17.0, panel=K['balustrade'])
    # the dome: lead, its twelve gilded ribs, the garlands and the trophies between the dormers
    zd = z0 + 23.0
    lead, gold = K.m("lead_roof"), K.m("gold")
    dh = 24.0
    ak.dome(lead, c, zd, R - 0.8, dh, segs=48, rows=14)
    ak.dome_ribs(gold, c, zd, R - 0.8, dh, 12, w=0.7, d=0.35, lift=0.1)
    for f in (0.14, 0.42):  # garland bands
        zz = zd + dh * math.sin(math.pi / 2 * f)
        rr = (R - 0.8) * math.cos(math.pi / 2 * f) + 0.12
        pts = [(cx + rr * math.cos(a), cy + rr * math.sin(a), zz) for a in np.linspace(0, 2 * math.pi, 49)]
        for p, q in zip(pts[:-1], pts[1:]):
            gold.box(p, q, 0.5, 0.45)
    for j in range(12):  # the dormers (lucarnes) and the gilded trophies over them
        a = 2 * math.pi * (j + 0.5) / 12
        f = 0.25
        rr = (R - 0.8) * math.cos(math.pi / 2 * f) + 0.4
        zz = zd + dh * math.sin(math.pi / 2 * f)
        gold.box((cx + rr * math.cos(a), cy + rr * math.sin(a), zz), (cx + rr * math.cos(a), cy + rr * math.sin(a), zz + 3.2), 1.6, 1.0)
        gold.box((cx + (rr - 0.6) * math.cos(a), cy + (rr - 0.6) * math.sin(a), zz + 4.0),
                 (cx + (rr - 1.0) * math.cos(a), cy + (rr - 1.0) * math.sin(a), zz + 7.0), 1.2, 0.8)
    # the lantern (gilded), its little dome, the spire and the cross to 107 m
    zl = zd + dh - 0.8
    ak.drum(gold, c, zl, zl + 7.5, 3.6, segs=16)
    ak.ring_columns(gold, c, zl, 7.0, 4.1, 8, 0.28)
    ak.dome(gold, c, zl + 7.5, 4.0, 3.5, segs=16, rows=6)
    gold.lathe([(zl + 11.0, 1.2), (zl + 13.0, 1.0), (g + top_m - 5.0, 0.25), (g + top_m - 2.5, 0.12)], c, segs=8)
    gold.box((cx, cy, g + top_m - 3.5), (cx, cy, g + top_m), 0.25, 0.25)
    gold.box((cx - 1.0, cy, g + top_m - 1.6), (cx + 1.0, cy, g + top_m - 1.6), 0.2, 0.2)
    return K.out(), [s["si"] for s in rows]


def opera_garnier(rows, mats):
    """The Palais Garnier: the body, the main front, the auditorium's copper dome and the stage house."""
    body = biggest(rows)
    g = body["ground"]
    K = Monument("opera", mats, g, g + 64.0)
    st, tr, wn, rl, gold, cu = K.m("lime"), K.m("lime_trim"), K.m("win"), K.m("relief"), K.m("gold"), K.m("copper")
    zt = 29.0
    ak.stone_body(K, body["ring"], g, g + zt, (K.n["lime"], K.n["lime_trim"], "win"), storey=9.5, win=(2.6, 5.2), arch=True, every=6.5, sill=2.4)
    ak.balustrade(tr, ak.WORLD, ak.simplify(body["ring"]) + [ak.simplify(body["ring"])[0]], g + zt, panel=K['balustrade'])
    # the front: the axis from the stage house through the dome to the front, on place de l'Opéra (south-south-east)
    stage = next((s for s in rows if s["top"] > 60), None)
    dome_s = next((s for s in rows if 49 < s["top"] < 52), None)
    sx, sy = ak.ring_centroid(stage["ring"]) if stage else ak.ring_centroid(body["ring"])
    dx, dy = ak.ring_centroid(dome_s["ring"]) if dome_s else (sx, sy - 30)
    ux, uy = dx - sx, dy - sy
    L = math.hypot(ux, uy)
    ux, uy = ux / L, uy / L
    # the front's line: the body's furthest reach along the axis
    reach = max((p[0] - sx) * ux + (p[1] - sy) * uy for p in body["ring"])
    ax = math.degrees(math.atan2(uy, ux))
    F = ak.Frame(sx + ux * reach, sy + uy * reach, ax, g)  # u out of the front, v along it
    hw = 35.0
    ak.block(st, F, -1.5, 0.6, -hw, hw, 0.0, 10.5, top=False)
    for k in range(7):  # the seven arches of the ground floor
        v = -hw + 7.0 + k * (2 * hw - 14.0) / 6
        ak.opening(wn, F, (0.65, hw), (0.65, -hw), 1.2, 4.6, 8.0, arch=True, centre=hw - v)
    ak.block(st, F, 0.6, 9.0, -hw - 2, hw + 2, 0.0, 1.2)  # the steps' landing
    for k in range(6):
        ak.block(st, F, 0.6 + 9.0 + k * 0.4, 9.4 + k * 0.4, -hw + 4, hw - 4, 0.0, 1.2 - k * 0.2) if False else None
    ak.band(tr, F, ak.rect(-1.5, 0.6, -hw, hw), 10.3, out=0.35, h=0.9)
    # the loggia: sixteen paired monolithic columns in pairs, with bronze busts in the oculi between
    for k in range(8):
        v = -hw + 3.5 + k * (2 * hw - 7.0) / 7
        for dv in (-0.85, 0.85):
            x, y, z = F(0.1, v + dv, 11.2)
            ak.column(st, x, y, z, 12.0, 0.55)
    for k in range(7):
        v = -hw + 3.5 + (k + 0.5) * (2 * hw - 7.0) / 7
        ak.opening(wn, F, (-1.0, hw), (-1.0, -hw), 12.5, 3.2, 8.0, arch=True, centre=hw - v)
        gold.box(F(-0.6, v, 21.2), F(-0.6, v, 22.6), 1.0, 1.0)  # the busts of the composers
    ak.block(st, F, -2.0, 0.9, -hw, hw, 23.2, zt)
    ak.band(gold, F, ak.rect(-2.0, 0.9, -hw, hw), 24.0, out=0.15, h=1.0)  # the gilded inscriptions' frieze
    ak.cornice(tr, F, ak.rect(-2.0, 0.9, -hw, hw), zt - 1.0, ((0, 0), (0.4, 0.3), (0.9, 0.8), (0.9, 1.0), (0, 1.0)))
    # the end pavilions with their pediments, and the gilded groups of Harmony and Poetry on them
    for sv in (-1, 1):
        v0, v1 = sorted((sv * (hw - 1.5), sv * (hw + 8.5)))
        ak.block(st, F, -2.5, 1.2, v0, v1, 0.0, zt + 3.0)
        ak.pediment(st, F, -2.5, 1.2, v0, v1, zt + 3.0, 3.6, along_u=False)
        ak.opening(wn, F, (1.25, v1), (1.25, v0), 12.5, 4.0, 9.5, arch=True, centre=(v1 - v0) / 2)
        gold.box(F(0.0, sv * (hw + 3.5), zt + 6.6), F(0.0, sv * (hw + 3.5), zt + 11.0), 3.8, 2.4)
    # the attic over the front, its masks, the copper roof over the foyer
    ak.block(st, F, -12.0, -2.0, -hw, hw, zt, zt + 4.5)
    cu.quad(F(-2.0, -hw, zt + 4.5), F(-2.0, hw, zt + 4.5), F(-12.0, hw, zt + 7.5), F(-12.0, -hw, zt + 7.5))
    for v in np.linspace(-hw + 4, hw - 4, 12):
        gold.box(F(-1.9, v, zt + 1.6), F(-1.9, v, zt + 3.0), 0.9, 0.4)
    # the auditorium's dome: a low copper dome with its ribs and its gilded crown
    if dome_s:
        R = math.sqrt(abs(ak.ring_area(dome_s["ring"])) / math.pi)
        c = (dx, dy)
        z0 = g + zt + 2.0
        ak.drum(st, c, g + zt, z0 + 1.0, R + 0.4, segs=40)
        ak.ring_openings_round(wn, c, g + zt + 0.8, R + 0.4, 20, 1.6, 1.6, arch=True)
        ak.dome(cu, c, z0 + 1.0, R, (g + 50.5) - (z0 + 1.0), segs=40, rows=10)
        ak.dome_ribs(gold, c, z0 + 1.0, R, (g + 50.5) - (z0 + 1.0), 16, w=0.3, d=0.2, lift=0.05, stop=0.85)
        ak.dome(gold, c, g + 49.5, 3.0, 3.6, segs=16, rows=5)
    # the stage house: a block to its ridge under a pediment gable at each end, Apollo raising his lyre on the
    # front gable, and the two Pegasi on the back one
    if stage:
        sr = stage["ring"]
        S = ak.Frame(sx, sy, ax, g)
        us = [S.local(*p)[0] for p in sr]
        vs = [S.local(*p)[1] for p in sr]
        u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
        top = stage["top"]
        eave = top - 8.0
        ak.block(st, S, u0, u1, v0, v1, zt, eave, top=False)
        ak.cornice(tr, S, ak.rect(u0, u1, v0, v1), eave - 1.2, ((0, 0), (0.4, 0.4), (0.9, 1.0), (0.9, 1.2), (0, 1.2)))
        ak.pediment(cu, S, u0, u1, v0, v1, eave, top - eave, along_u=False) if False else None
        # the roof: copper, its ridge along u, gables at both ends (u0, u1)
        cu.quad(S(u0, v0, eave), S(u1, v0, eave), S(u1, 0, top), S(u0, 0, top))
        cu.quad(S(u0, 0, top), S(u1, 0, top), S(u1, v1, eave), S(u0, v1, eave))
        for u in (u0, u1):
            st.tri(S(u, v0, eave), S(u, v1, eave), S(u, 0, top))
            tr.box(S(u, v0, eave), S(u, 0, top), 0.9, 0.9)
            tr.box(S(u, v1, eave), S(u, 0, top), 0.9, 0.9)
        ak.ring_openings(wn, S, ak.rect(u0, u1, v0, v1), zt + 6.0, 2.0, 7.0, 7.5, arch=True)
        gold.box(S(u1 + 0.3, 0, top), S(u1 + 0.3, 0, top + 7.5), 2.2, 1.6)  # Apollo, 7.5 m with his lyre
        gold.box(S(u1 + 0.3, -1.8, top + 6.0), S(u1 + 0.3, 1.8, top + 6.0), 0.4, 0.8)
        for sv in (-1, 1):
            gold.box(S(u0 - 0.3, sv * (v1 - v0) * 0.42, eave), S(u0 - 0.3, sv * (v1 - v0) * 0.42, eave + 4.5), 2.4, 1.6)
    return K.out(), [s["si"] for s in rows]


def saint_sulpice(rows, mats):
    """Saint-Sulpice: the nave under its slate roof, the aisles and chapels, the west front and its towers."""
    g = min(s["ground"] for s in rows)
    K = Monument("sulpice", mats, g, g + 73.0)
    st, tr, wn, lead = K.m("lime"), K.m("lime_trim"), K.m("win"), K.m("lead_roof")
    towers = sorted([s for s in rows if s["top"] > 60], key=lambda s: ak.ring_centroid(s["ring"])[1], reverse=True)
    nave = max((s for s in rows if 30 < s["top"] < 60), key=lambda s: abs(ak.ring_area(s["ring"])))
    for s in rows:
        if s in towers or s is nave or abs(ak.ring_area(s["ring"])) < 50:
            continue
        ak.stone_body(K, s["ring"], s["ground"], s["ground"] + s["top"], (K.n["lime"], K.n["lime_trim"], "win"), storey=s["top"] - 2.0,
                      win=(3.2, 11.0), arch=True, every=9.0, sill=4.0)
        ak.balustrade(tr, ak.WORLD, ak.simplify(s["ring"]) + [ak.simplify(s["ring"])[0]], s["ground"] + s["top"], panel=K['balustrade'])
    # the nave: walls to the clerestory's cornice, the clerestory's windows, a slate roof to the mapped ridge
    ng, nt = nave["ground"], nave["top"]
    eave = nt - 7.5
    ring = ak.simplify(nave["ring"])
    ak.stone_body(K, ring, ng, ng + eave, (K.n["lime"], K.n["lime_trim"], "win"), storey=None)
    ak.ring_openings(wn, ak.WORLD, ring, ng + eave - 11.0, 3.6, 9.0, 8.6, arch=True, min_len=8.0)
    mr = np.asarray(_mrr(ring))
    e1, e2 = mr[1] - mr[0], mr[2] - mr[1]
    long_, short = (e1, e2) if np.linalg.norm(e1) >= np.linalg.norm(e2) else (e2, e1)
    c = mr.mean(axis=0)
    R = ak.Frame(c[0], c[1], math.degrees(math.atan2(long_[1], long_[0])), ng)
    hl, hs = np.linalg.norm(long_) / 2, np.linalg.norm(short) / 2 * 0.62
    lead.quad(R(-hl, -hs, eave), R(hl, -hs, eave), R(hl, 0, nt), R(-hl, 0, nt))
    lead.quad(R(-hl, 0, nt), R(hl, 0, nt), R(hl, hs, eave), R(-hl, hs, eave))
    for u in (-hl, hl):
        lead.tri(R(u, -hs, eave), R(u, hs, eave), R(u, 0, nt))
    # the west front: between the towers, two orders of columns (Doric, then Ionic) over a loggia, a balustrade
    (nx, ny), (sx, sy) = (ak.ring_centroid(t["ring"]) for t in towers[:2])
    wx = min(p[0] for t in towers[:2] for p in t["ring"])
    F = ak.Frame(wx, (ny + sy) / 2, 90.0, g)  # u north along the front, v west out of it; the church's wall at v = 0
    half = abs(ny - sy) / 2
    ak.block(st, F, -half, half, 0.0, 6.0, 0.0, 1.6)
    for (z0, h, r, cap) in ((1.6, 13.0, 0.85, "doric"), (17.0, 12.0, 0.75, "ionic")):
        for u in np.linspace(-half + 5.5, half - 5.5, 6):
            for dv in (1.2, 4.2):
                x, y, z = F(u, dv, z0)
                ak.column(st, x, y, z, h, r, capital=cap)
        ak.block(st, F, -half - 2, half + 2, 0.4, 5.6, z0 + h, z0 + h + 2.2)
        ak.cornice(tr, F, ak.rect(-half - 2, half + 2, 0.4, 5.6), z0 + h + 1.4, ((0, 0), (0.3, 0.3), (0.6, 0.8), (0, 0.8)))
    ak.balustrade(tr, F, [(-half - 2, 0.6), (half + 2, 0.6)], 31.2, panel=K['balustrade'])
    ak.block(st, F, -half + 3, half - 3, -2.0, 0.0, 0.0, 31.2)  # the front wall behind the loggias
    for u in np.linspace(-half + 5.5, half - 5.5, 5):
        ak.opening(wn, F, (-half, 5.95), (half, 5.95), 2.0, 3.6, 10.0, arch=True, centre=u + half) if False else None
    # the towers: a square stage to the front's balustrade, then two round stages with columns, a balustrade
    # on each; the north tower finished to 73 m, the south one (left unfinished) to 68 m
    for t, top_m in zip(towers[:2], (73.0, 68.0)):
        tg = t["ground"]
        tx, ty = ak.ring_centroid(t["ring"])
        side = math.sqrt(abs(ak.ring_area(t["ring"])))
        T = ak.Frame(tx, ty, 0.0, tg)
        hs_ = side / 2 + 1.0
        ak.block(st, T, -hs_, hs_, -hs_, hs_, 0.0, 33.0, top=False)
        ak.cornice(tr, T, ak.rect(-hs_, hs_, -hs_, hs_), 31.6, ((0, 0), (0.5, 0.4), (1.0, 1.2), (1.0, 1.4), (0, 1.4)))
        ak.block(st, T, -hs_ + 0.6, hs_ - 0.6, -hs_ + 0.6, hs_ - 0.6, 33.0, 46.0)
        ak.ring_openings(wn, T, ak.rect(-hs_ + 0.6, hs_ - 0.6, -hs_ + 0.6, hs_ - 0.6), 35.0, 3.0, 9.0, 20.0, arch=True)
        for (u, v) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            for du, dv in ((0.0, 2.2), (2.2, 0.0)):
                x, y, z = T(u * (hs_ - 0.6 - du) * 1.02, v * (hs_ - 0.6 - dv) * 1.02, 33.0)
                ak.column(st, x, y, z, 12.0, 0.5)
        ak.balustrade(tr, T, [(-hs_ + 0.4, -hs_ + 0.4), (hs_ - 0.4, -hs_ + 0.4), (hs_ - 0.4, hs_ - 0.4), (-hs_ + 0.4, hs_ - 0.4), (-hs_ + 0.4, -hs_ + 0.4)], 46.0, panel=K['balustrade'])
        r2 = hs_ * 0.78
        z2 = 46.0
        st.lathe([(tg + z2, r2), (tg + top_m - 9.0, r2)], (tx, ty), segs=24)
        ak.ring_openings_round(wn, (tx, ty), tg + z2 + 2.0, r2, 8, 2.4, 9.0, arch=True)
        ak.ring_columns(st, (tx, ty), tg + z2, top_m - 9.0 - z2 - 1.0, r2 + 0.7, 16, 0.4, capital="corinthian")
        ak.cornice(tr, ak.WORLD, [(tx + r2 * math.cos(a), ty + r2 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 25)[:-1]], tg + top_m - 10.0,
                   ((0, 0), (0.6, 0.4), (1.2, 1.0), (0, 1.0)))
        ak.balustrade(tr, ak.WORLD, [(tx + (r2 + 1.0) * math.cos(a), ty + (r2 + 1.0) * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 25)], tg + top_m - 9.0, panel=K['balustrade'])
        st.lathe([(tg + top_m - 9.0, r2 * 0.72), (tg + top_m - 1.0, r2 * 0.72), (tg + top_m - 1.0, r2 * 0.8), (tg + top_m, r2 * 0.8)], (tx, ty), segs=20)
    return K.out(), [s["si"] for s in rows]


def _mrr(ring):
    from shapely.geometry import Polygon
    return list(Polygon(ring).minimum_rotated_rectangle.exterior.coords)[:4]


def pompidou(rows, mats):
    """The Centre Pompidou: the glass box in its white steel frame, the escalator tube and the ducts."""
    body = biggest(rows)
    g = body["ground"]
    mr = np.asarray(_mrr(body["ring"]))
    e1, e2 = mr[1] - mr[0], mr[2] - mr[1]
    long_, short = (e1, e2) if np.linalg.norm(e1) >= np.linalg.norm(e2) else (e2, e1)
    c = mr.mean(axis=0)
    F = ak.Frame(c[0], c[1], math.degrees(math.atan2(long_[1], long_[0])), g)
    # v points to the piazza (west, rue Saint-Martin) or to rue du Renard (east): find which side is west
    west = 1.0 if F(0, 10, 0)[0] < F(0, -10, 0)[0] else -1.0
    L, Wd, H = 166.0, 60.0, 42.0
    hl, hw = L / 2, Wd / 2
    K = ak.Kit("pompidou", floodlit={"pompidou_glass", "steel_white", "tube_glass"}, uv={"pompidou_glass"})
    glass, steel = K["pompidou_glass"], K["steel_white"]
    gi = hw - 7.5  # the glass wall, set in from the frame
    ring = ak.rect(-hl + 2, hl - 2, -gi, gi)
    s0 = 0.0
    for k in range(4):
        a, b = ring[k], ring[(k + 1) % 4]
        L_ = math.dist(a, b)
        glass.quad(F(*a, 0.0), F(*b, 0.0), F(*b, H), F(*a, H), [[s0 / 12.8, 0.0], [(s0 + L_) / 12.8, 0.0], [(s0 + L_) / 12.8, H], [s0 / 12.8, H]])
        s0 += L_
    steel.quad(F(-hl + 2, -gi, H), F(hl - 2, -gi, H), F(hl - 2, gi, H), F(-hl + 2, gi, H))
    # the frame: columns every 12.8 m on both long sides, the gerberettes at each floor, the outer ties and the
    # cross-bracing, floors' edges
    bays = 13
    us = np.linspace(-hl + 0.0, hl - 0.0, bays + 1)
    floors = [0.0, 7.0, 14.0, 21.0, 28.0, 35.0, 42.0]
    for sv in (-1, 1):
        for u in us:
            steel.tube([F(u, sv * (gi + 1.6), 0.0), F(u, sv * (gi + 1.6), H + 1.0)], 0.43, sides=10)
            steel.tube([F(u, sv * (hw - 0.3), 0.0), F(u, sv * (hw - 0.3), H)], 0.11, sides=6)
            for z in floors[1:]:
                steel.box(F(u, sv * (gi - 1.0), z - 0.6), F(u, sv * (hw - 0.2), z - 0.4), 0.5, 0.9)
        for u0, u1 in zip(us[:-1], us[1:]):
            for z0, z1 in zip(floors[:-1], floors[1:]):
                steel.box(F(u0, sv * (hw - 0.3), z0 + 0.3), F(u1, sv * (hw - 0.3), z1 - 0.3), 0.08, 0.08)
                steel.box(F(u1, sv * (hw - 0.3), z0 + 0.3), F(u0, sv * (hw - 0.3), z1 - 0.3), 0.08, 0.08)
            for z in floors[1:]:
                steel.box(F(u0, sv * (hw - 0.3), z - 0.5), F(u1, sv * (hw - 0.3), z - 0.5), 0.12, 0.12)
                steel.box(F(u0, sv * (gi + 0.2), z - 0.5), F(u1, sv * (gi + 0.2), z - 0.5), 0.3, 0.7)
    # the escalator: a glass tube in five flights climbing the piazza front from its south end, with its
    # landings (galleries) along each floor
    tube = K["tube_glass"]
    vs = west * (hw + 1.6)
    u = -hl + 8.0
    for k in range(5):
        z0, z1 = 3.5 + k * 7.0, 3.5 + (k + 1) * 7.0
        u1 = u + 26.0
        tube.tube([F(u, vs, z0), F(u1, vs, z1)], 1.9, sides=10)
        steel.tube([F(u, vs - 1.9 * west, z0 - 1.6), F(u1, vs - 1.9 * west, z1 - 1.6)], 0.25, sides=6)
        tube.tube([F(u1, vs, z1), F(u1 + 4.0, vs, z1)], 1.9, sides=10)
        u = u1 + 4.0
    tube.tube([F(-hl + 4, west * (hw + 1.2), 42.4), F(hl - 4, west * (hw + 1.2), 42.4)], 1.6, sides=8)
    # the ducts on rue du Renard: big vertical pipes in their colours, and the air intakes on the roof
    ve = -west * (hw + 0.8)
    for k, u in enumerate(np.linspace(-hl + 6, hl - 6, 26)):
        mat = ("duct_blue", "duct_green", "duct_blue", "duct_yellow", "duct_red", "duct_blue")[k % 6]
        r = 1.3 if mat == "duct_blue" else 0.7
        K[mat].tube([F(u, ve, 0.5), F(u, ve, H + (3.5 if mat == "duct_blue" else 0.5))], r, sides=10)
        if mat == "duct_blue":
            K[mat].tube([F(u, ve, H + 3.5), F(u, ve + west * 6.0, H + 3.5)], r, sides=10)
    for u in np.linspace(-hl + 12, hl - 12, 8):
        K["duct_blue"].tube([F(u, -west * 10, H), F(u, -west * 10, H + 5.0)], 1.6, sides=10)
        K["steel_white"].box(F(u - 3, west * 6, H), F(u + 3, west * 6, H + 3.0), 4.0, 0.1) if False else None
    return K.out(), [s["si"] for s in rows]


# OpenStreetMap ways 79742852 (the Passy wing) and 79749386 (the Paris wing), lon/lat (ODbL)
CHAILLOT_LL = [[[2.2907905, 48.8632296],
               [2.2907478, 48.8632513],
               [2.2906925, 48.8632757],
               [2.2906353, 48.8632976],
               [2.290576, 48.8633167],
               [2.2905318, 48.8633288],
               [2.2904669, 48.8633439],
               [2.2904005, 48.8633562],
               [2.2903538, 48.8633627],
               [2.2902884, 48.8633697],
               [2.2902231, 48.8633733],
               [2.2902009, 48.8633732],
               [2.2901114, 48.8633708],
               [2.2900219, 48.8633644],
               [2.2899335, 48.8633545],
               [2.289824, 48.863335],
               [2.2897099, 48.8633101],
               [2.2895985, 48.8632813],
               [2.2895614, 48.8632705],
               [2.2894527, 48.8632358],
               [2.2893476, 48.8631974],
               [2.2892452, 48.863155],
               [2.2891259, 48.863098],
               [2.288872, 48.8629674],
               [2.2887241, 48.8628792],
               [2.2886984, 48.8628639],
               [2.2886331, 48.8629059],
               [2.2886376, 48.8629174],
               [2.2886375, 48.862923],
               [2.2886311, 48.8629381],
               [2.2886232, 48.8629461],
               [2.2886097, 48.8629537],
               [2.2885946, 48.8629576],
               [2.2885868, 48.8629588],
               [2.2885708, 48.8629587],
               [2.2885553, 48.8629559],
               [2.2885464, 48.8629617],
               [2.2884782, 48.8629148],
               [2.2884233, 48.8629541],
               [2.2884012, 48.8629389],
               [2.2883833, 48.8629266],
               [2.2883692, 48.8629358],
               [2.2882732, 48.8628707],
               [2.2881759, 48.8628047],
               [2.2881905, 48.8627958],
               [2.2881574, 48.8627728],
               [2.2881536, 48.8627702],
               [2.28821, 48.862734],
               [2.2881413, 48.8626872],
               [2.2881499, 48.8626818],
               [2.2882238, 48.8626354],
               [2.2882074, 48.8626245],
               [2.2882194, 48.8626162],
               [2.2882364, 48.8626278],
               [2.2882745, 48.8626033],
               [2.2882571, 48.8625917],
               [2.2882712, 48.8625831],
               [2.2882886, 48.8625938],
               [2.2883268, 48.8625702],
               [2.2883104, 48.8625574],
               [2.2883229, 48.8625503],
               [2.2883403, 48.8625613],
               [2.2883806, 48.8625355],
               [2.2883631, 48.8625243],
               [2.2883757, 48.8625169],
               [2.2883926, 48.8625276],
               [2.2884328, 48.8625015],
               [2.2884164, 48.8624906],
               [2.28843, 48.8624823],
               [2.2884459, 48.8624936],
               [2.2884851, 48.8624669],
               [2.2884692, 48.8624556],
               [2.2884828, 48.8624468],
               [2.2884997, 48.8624577],
               [2.2885368, 48.8624332],
               [2.2885219, 48.8624229],
               [2.2885329, 48.8624155],
               [2.2885488, 48.8624258],
               [2.2885793, 48.8624069],
               [2.2885867, 48.8624122],
               [2.2886458, 48.8624539],
               [2.2887048, 48.8624175],
               [2.2887402, 48.8624412],
               [2.2887605, 48.8624284],
               [2.2887826, 48.862443],
               [2.2887809, 48.8624514],
               [2.2887817, 48.8624712],
               [2.2887892, 48.8624901],
               [2.2888034, 48.8625078],
               [2.2888224, 48.8625225],
               [2.2888465, 48.8625344],
               [2.2888739, 48.8625423],
               [2.2889033, 48.8625462],
               [2.2889333, 48.8625455],
               [2.2889544, 48.8625595],
               [2.288934, 48.862573],
               [2.2889704, 48.8625983],
               [2.2889145, 48.8626332],
               [2.2889765, 48.8626767],
               [2.2889682, 48.8626818],
               [2.289059, 48.8627374],
               [2.2891905, 48.8628122],
               [2.2892598, 48.8628501],
               [2.2893596, 48.8628993],
               [2.289463, 48.8629448],
               [2.2895387, 48.8629752],
               [2.2896376, 48.8630105],
               [2.2897561, 48.8630477],
               [2.2898169, 48.8630661],
               [2.2898794, 48.8630816],
               [2.2899429, 48.8630944],
               [2.290008, 48.8631041],
               [2.2900576, 48.8631109],
               [2.2901067, 48.8631149],
               [2.2901559, 48.8631164],
               [2.2902434, 48.8631142],
               [2.2902864, 48.8631098],
               [2.290329, 48.8631036],
               [2.2903705, 48.8630952],
               [2.290411, 48.8630846],
               [2.2904709, 48.8630624],
               [2.2905407, 48.8630315],
               [2.2905746, 48.8630141],
               [2.2906221, 48.8629866],
               [2.2906665, 48.8629568],
               [2.2907079, 48.8629249],
               [2.2907156, 48.8629308],
               [2.2907375, 48.862917],
               [2.2908083, 48.8629657],
               [2.2908537, 48.8629363],
               [2.2908983, 48.862966],
               [2.2909072, 48.8629608],
               [2.2909159, 48.8629661],
               [2.290991, 48.863017],
               [2.2910299, 48.8630434],
               [2.2910682, 48.8630694],
               [2.2910588, 48.8630753],
               [2.2911019, 48.8631046],
               [2.2910986, 48.8631067],
               [2.2910564, 48.8631337],
               [2.2910652, 48.86314],
               [2.2909006, 48.8632463],
               [2.2908918, 48.863241],
               [2.2908474, 48.8632695],
               [2.2907905, 48.8632296]],
               [[2.2872917, 48.8619985],
               [2.2873559, 48.861958],
               [2.2872433, 48.8618713],
               [2.28712, 48.8617682],
               [2.2870362, 48.8616928],
               [2.2868836, 48.8615362],
               [2.2868474, 48.8614942],
               [2.2867947, 48.8614171],
               [2.2867527, 48.86135],
               [2.2867154, 48.8612805],
               [2.2866722, 48.8611849],
               [2.2866409, 48.8610916],
               [2.2866327, 48.8610501],
               [2.2866283, 48.8609978],
               [2.2866281, 48.8609758],
               [2.2866313, 48.8609276],
               [2.2866359, 48.8608973],
               [2.2866448, 48.860858],
               [2.2866711, 48.8607914],
               [2.2867008, 48.8607359],
               [2.2867447, 48.8606755],
               [2.2867967, 48.8606204],
               [2.286748, 48.8605864],
               [2.2868253, 48.860538],
               [2.2868053, 48.8605246],
               [2.2868503, 48.8604955],
               [2.2868426, 48.8604895],
               [2.2870051, 48.8603835],
               [2.2870143, 48.8603897],
               [2.2870598, 48.8603603],
               [2.2871044, 48.86039],
               [2.2871138, 48.8603848],
               [2.2872732, 48.8604947],
               [2.2872659, 48.8605005],
               [2.2873079, 48.8605299],
               [2.2872635, 48.8605596],
               [2.2873332, 48.860608],
               [2.2873134, 48.8606202],
               [2.2873195, 48.8606246],
               [2.2872459, 48.8606696],
               [2.287158, 48.8607319],
               [2.2871119, 48.8607728],
               [2.2870872, 48.8607995],
               [2.2870587, 48.860838],
               [2.2870433, 48.8608633],
               [2.287031, 48.8608892],
               [2.2870224, 48.8609158],
               [2.2870178, 48.8609451],
               [2.2870157, 48.8609813],
               [2.2870178, 48.8610175],
               [2.2870305, 48.8610721],
               [2.2870479, 48.8611248],
               [2.2870896, 48.8612129],
               [2.2871042, 48.8612411],
               [2.2871578, 48.8613309],
               [2.2871953, 48.8613834],
               [2.2872641, 48.8614637],
               [2.2873105, 48.8615116],
               [2.2875356, 48.8617054],
               [2.2876339, 48.86178],
               [2.2876438, 48.8617748],
               [2.287713, 48.8618213],
               [2.2877695, 48.8617849],
               [2.2878049, 48.8618086],
               [2.2878268, 48.8617951],
               [2.2878478, 48.8618098],
               [2.2878455, 48.861829],
               [2.2878498, 48.8618485],
               [2.287861, 48.8618668],
               [2.2878783, 48.8618833],
               [2.2878999, 48.8618964],
               [2.2879256, 48.8619062],
               [2.2879401, 48.8619097],
               [2.287969, 48.8619133],
               [2.2879991, 48.8619125],
               [2.2880206, 48.8619269],
               [2.2880002, 48.861941],
               [2.2880351, 48.8619641],
               [2.2879792, 48.8620006],
               [2.2880479, 48.8620474],
               [2.2880202, 48.8620658],
               [2.288035, 48.8620764],
               [2.2880236, 48.8620835],
               [2.2880077, 48.8620735],
               [2.2879685, 48.8620986],
               [2.2879833, 48.8621089],
               [2.2879713, 48.8621165],
               [2.2879559, 48.8621066],
               [2.2879162, 48.8621329],
               [2.2879311, 48.8621426],
               [2.2879185, 48.8621509],
               [2.2879032, 48.8621406],
               [2.2878629, 48.862166],
               [2.2878778, 48.8621763],
               [2.2878653, 48.8621846],
               [2.2878504, 48.8621746],
               [2.2878107, 48.8621997],
               [2.2878255, 48.86221],
               [2.287813, 48.8622183],
               [2.2877976, 48.862208],
               [2.287759, 48.8622331],
               [2.2877738, 48.8622434],
               [2.2877608, 48.8622514],
               [2.2877459, 48.8622414],
               [2.2877067, 48.8622665],
               [2.2877216, 48.8622768],
               [2.2877096, 48.8622842],
               [2.2876947, 48.8622739],
               [2.2876545, 48.8622999],
               [2.2876698, 48.8623099],
               [2.2876594, 48.8623167],
               [2.287644, 48.8623067],
               [2.2876095, 48.8623278],
               [2.2875419, 48.8622804],
               [2.2874839, 48.8623162],
               [2.2874475, 48.8622912],
               [2.2874329, 48.8623001],
               [2.287337, 48.8622346],
               [2.2872411, 48.862169],
               [2.2872552, 48.8621598],
               [2.2872183, 48.8621348],
               [2.2872758, 48.8620977],
               [2.2872071, 48.8620524],
               [2.2872138, 48.8620481],
               [2.2872114, 48.8620404],
               [2.2872115, 48.8620295],
               [2.2872132, 48.8620243],
               [2.28722, 48.8620144],
               [2.2872289, 48.8620071],
               [2.2872368, 48.8620028],
               [2.2872513, 48.8619979],
               [2.2872674, 48.8619959],
               [2.2872757, 48.8619959],
               [2.2872917, 48.8619985]]]


def chaillot(rows, mats):
    """The Palais de Chaillot: the two curved wings and the head pavilions on the parvis."""
    import cityctx
    C = cityctx.City("paris")
    wings = [[C.fwd.transform(lon, lat) for lon, lat in ring] for ring in CHAILLOT_LL]
    parvis = max(s["ground"] for s in rows) if rows else 33.7
    K = Monument("chaillot", mats, parvis - 22.0, parvis + 18.0)
    st, tr, wn, gold, rl = K.m("lime"), K.m("lime_trim"), K.m("win"), K.m("gold"), K.m("relief")
    roof = parvis + 12.0  # OpenStreetMap's 30 m, from the gardens' side
    for ring in wings:
        ring = ak.simplify(ring, 0.6)
        z0 = parvis - 24.0  # the gardens' side, down the slope to the Seine; the terrain covers what is underground
        ak.prism(st, ak.WORLD, ring, z0, roof, top=False)
        ak.cap(rl, ak.WORLD, ring, roof - 0.3)
        ak.cornice(tr, ak.WORLD, ring, roof - 1.4, ((0, 0), (0.3, 0.4), (0.6, 1.0), (0.6, 1.4), (0, 1.4)))
        # the piers and tall windows of the long curved walls
        pts = list(ring)
        if ak.ring_area(pts) > 0:
            pts = pts[::-1]
        for k in range(len(pts)):
            a, b = pts[k], pts[(k + 1) % len(pts)]
            if math.dist(a, b) < 3.0:
                continue
            ak.openings_along(wn, ak.WORLD, a, b, parvis - 20.0, 2.2, 16.0, 4.6)
            ak.openings_along(wn, ak.WORLD, a, b, parvis - 1.0, 2.2, 10.5, 4.6)
            ak.pilasters(tr, ak.WORLD, a, b, parvis - 22.0, roof - parvis + 20.6, 0.9, 4.6, out=0.35)
        # the head pavilion: the wing's end nearest the parvis's axis, a storey higher
        cx, cy = ak.ring_centroid(ring)
    # the parvis between the wings: the head pavilions face each other across it; each is the end of its wing
    # nearest the other wing
    import shapely
    from shapely.geometry import Polygon
    A, B = (Polygon(ak.simplify(w, 0.6)).buffer(0) for w in wings)
    from shapely.ops import nearest_points
    pa, pb = nearest_points(A, B)
    mid = ((pa.x + pb.x) / 2, (pa.y + pb.y) / 2)
    for poly, p in ((A, pa), (B, pb)):
        head = poly.intersection(Point(p.x, p.y).buffer(26.0))
        if head.is_empty or head.geom_type != "Polygon":
            continue
        hr = ak.simplify(list(head.exterior.coords), 0.6)
        ak.prism(st, ak.WORLD, hr, roof - 0.5, parvis + 18.0, top=False)
        ak.cap(rl, ak.WORLD, hr, parvis + 17.7)
        ak.cornice(tr, ak.WORLD, hr, parvis + 16.6, ((0, 0), (0.3, 0.4), (0.7, 1.1), (0.7, 1.4), (0, 1.4)))
        ak.band(gold, ak.WORLD, hr, parvis + 13.4, out=0.12, h=1.2)  # Paul Valéry's gilded inscriptions
        pts = list(hr)
        if ak.ring_area(pts) > 0:
            pts = pts[::-1]
        for k in range(len(pts)):
            a, b = pts[k], pts[(k + 1) % len(pts)]
            if math.dist(a, b) > 6:
                ak.openings_along(wn, ak.WORLD, a, b, parvis + 0.6, 2.4, 11.0, 4.8)
    # the gilded bronze statues along the parvis, on their plinths
    ux, uy = pb.x - pa.x, pb.y - pa.y
    Lp = math.hypot(ux, uy)
    nx, ny = -uy / Lp, ux / Lp
    for side in (-1, 1):
        for k in range(4):
            t = 0.2 + 0.2 * k
            x, y = pa.x + ux * t + nx * side * 22.0, pa.y + uy * t + ny * side * 22.0
            st.box((x, y, parvis), (x, y, parvis + 2.2), 1.4, 1.4)
            gold.box((x, y, parvis + 2.2), (x, y, parvis + 5.0), 0.8, 0.6)
    return K.out(), [s["si"] for s in rows]
