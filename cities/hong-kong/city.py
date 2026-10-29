"""Hong Kong: what the generic pipeline cannot know from open data.

Heights come from the Lands Department's building blocks and the 2020 LiDAR
(pipeline/survey.py), so no building needs a height fix here. What the blocks
cannot carry is shape: a tower whose four shafts stop at four heights, an
exoskeleton, a crown. Those landmarks are built from published dimensions on
anchors measured from their footprints (centroid and the bearing of their
faces), and the solids they replace are hidden: the surface model and the
analyses keep their shadows, and the renderers draw the landmark instead.

Sources (the research notes are in docs/cities/hong-kong.md):
  Bank of China Tower   52 m square plan split along its diagonals into four
                        triangular shafts; roof 315 m, two masts to 367.4 m
                        (Wikipedia; BOCHK). The shafts end lowest on the
                        harbour (north) side, then west, east, and the south
                        shaft runs to the roof; each top slopes up to the
                        centre, about 30 m (OpenStreetMap building parts, which
                        agree with the published floor groupings). Silver-white
                        cross bracing over 13-storey modules (52 m), on dark
                        reflective glass, above a granite base.
  HSBC Main Building    178.8 m; 66.4 x 57.2 m plan (OpenStreetMap); three bays
                        16.2 m wide, of 29, 36 and 44 storeys (south, north and
                        middle); eight masts in two rows of four; two-storey
                        suspension trusses at five levels; the banking hall is
                        lifted over an open plaza (Wikipedia; Baidu Baike;
                        truss levels inferred from OpenStreetMap parts).
  Two IFC               412 m to the tips of the crown's fins, 88 floors; 57 m
                        across at the base, 39 m at the main roof (SkyscraperPage).
                        The setback levels are not published: here the plan
                        steps in over the top 120 m.
  ICC                   484 m with its roof parapets; a square of about 53 m
                        faces with re-entrant corners that widen with height,
                        and a base that curves out into canopies (KPF;
                        Architectural Record; OpenStreetMap).
  Central Plaza         roof 309 m, mast tip 373.9 m; a triangle with cut
                        corners, about 48 m faces, one looking south; a
                        three-sided glass pyramid from about 282 m (Wikipedia;
                        OpenStreetMap). Gold and silver glass.
  Observation Wheel     60 m high, 42 gondolas (Wikipedia); its plane along
                        160 degrees, from its base in OpenStreetMap.
  Clock Tower           44 m plus a 7 m lightning rod, a 7 x 7 m red-brick and
                        granite shaft with four clock faces and a domed
                        octagonal belfry (Antiquities and Monuments Office).
  Peak Tower            396 to 428 m above the datum; a 68.5 x 28.8 m crescent
                        roof with upswept ends, floating on columns over the
                        building (Wikipedia; Farrells; OpenStreetMap outline).
"""
import math

import numpy as np
from shapely.geometry import Point

from meshkit import Mesh

MATERIALS = {
    "boc_glass": {"color": "#2c3c48", "roughness": 0.08, "metalness": 0.7, "pattern": "curtain_wall", "bay_m": 1.6, "storey_m": 4.0,
                  "spandrel": 0.12, "mullion_m": 0.1, "frame": "#5d6b74"},
    "boc_frame": {"color": "#e7ebee", "roughness": 0.3, "metalness": 0.55},
    "granite": {"color": "#b9aea4", "roughness": 0.75, "metalness": 0.0},
    "mast": {"color": "#d9dde0", "roughness": 0.35, "metalness": 0.6},
    "hsbc_glass": {"color": "#56656e", "roughness": 0.12, "metalness": 0.55, "pattern": "curtain_wall", "bay_m": 1.8, "storey_m": 3.9,
                   "spandrel": 0.3, "mullion_m": 0.14, "frame": "#a9b0b5"},
    "hsbc_steel": {"color": "#b7bdc1", "roughness": 0.35, "metalness": 0.65},
    "ifc_glass": {"color": "#7f97a8", "roughness": 0.1, "metalness": 0.5, "pattern": "curtain_wall", "bay_m": 1.5, "storey_m": 4.2,
                  "spandrel": 0.28, "mullion_m": 0.16, "frame": "#d4d6d4"},
    "icc_glass": {"color": "#6f8798", "roughness": 0.09, "metalness": 0.55, "pattern": "curtain_wall", "bay_m": 1.5, "storey_m": 4.4,
                  "spandrel": 0.22, "mullion_m": 0.1, "frame": "#bfc7cc"},
    "cp_glass": {"color": "#6e5a33", "roughness": 0.14, "metalness": 0.55, "pattern": "curtain_wall", "bay_m": 1.6, "storey_m": 3.9,
                 "spandrel": 0.3, "mullion_m": 0.16, "frame": "#9c8c66"},
    "cp_crown": {"color": "#c9c3b0", "roughness": 0.2, "metalness": 0.6},
    "wheel": {"color": "#f1f3f4", "roughness": 0.35, "metalness": 0.4},
    "gondola": {"color": "#dfe7ec", "roughness": 0.15, "metalness": 0.3},
    "brick": {"color": "#a4523a", "roughness": 0.85, "metalness": 0.0},
    "stone_trim": {"color": "#ddd5c4", "roughness": 0.7, "metalness": 0.0},
    "clock_face": {"color": "#f4f1e8", "roughness": 0.5, "metalness": 0.0},
    "peak_roof": {"color": "#e8e6e1", "roughness": 0.45, "metalness": 0.15},
    "peak_body": {"color": "#a9b4b9", "roughness": 0.2, "metalness": 0.4, "pattern": "curtain_wall", "bay_m": 2.0, "storey_m": 4.5,
                  "spandrel": 0.3, "mullion_m": 0.15, "frame": "#d8d8d4"},
}

NAMES = {
    "中銀大廈 Bank of China Tower": "bank_of_china",
    "滙豐總行大廈 HSBC Main Building": "hsbc",
    "國際金融中心二期 Two International Finance Centre": "ifc2",
    "環球貿易廣場 International Commerce Centre": "icc",
    "中環廣場 Central Plaza": "central_plaza",
    "尖沙咀鐘樓 Tsim Sha Tsui Clock Tower": "clock_tower",
    "凌霄閣 Peak Tower": "peak_tower",
}
LABELS = {"bank_of_china": "Bank of China Tower", "hsbc": "HSBC Main Building", "ifc2": "Two IFC", "icc": "ICC",
          "central_plaza": "Central Plaza", "clock_tower": "Clock Tower", "peak_tower": "Peak Tower"}
# the wheel is not a building in the open data: the centroid of its site (OpenStreetMap land use,
# via Overture) and the bearing of its base (OpenStreetMap way 323202868)
WHEEL_AT, WHEEL_BEARING = (114.1617658, 22.2853328), 160.0
HULLS = {}  # the landmarks' footprints, to hide other records of the same towers


# ---------------------------------------------------------------- build_scene hooks

def face_bearing(g, period=90.0):
    """Bearing (degrees east of north, modulo `period`) of the longest side of g's minimum rectangle."""
    r = np.asarray(g.minimum_rotated_rectangle.exterior.coords)
    e = max([r[1] - r[0], r[2] - r[1]], key=lambda v: math.hypot(*v))
    return math.degrees(math.atan2(e[0], e[1])) % period


def landmark_hulls(ctx):
    """The landmarks' footprints, read once from the open data before any building is adjusted, so
    a record met before its landmark's own is hidden too."""
    import duckdb
    from shapely import wkb as swkb
    con = duckdb.connect()
    con.execute("LOAD spatial")
    names = ", ".join("'" + n.replace("'", "''") + "'" for n in NAMES)
    for name, w in con.execute(f"SELECT name, wkb FROM '{ctx.city.raw}/overture_building.parquet' WHERE name IN ({names})").fetchall():
        HULLS.setdefault(NAMES[name], ctx.city.to_local(swkb.loads(bytes(w))).convex_hull)


def adjust_building(b, cls, g, geoms, ctx):
    if not HULLS:
        landmark_hulls(ctx)
    key = NAMES.get(b["name"])
    if not key or key in ctx.landmarks:
        # another record of a landmark's tower (a surveyed block the open data lacks): hidden too
        for hull in HULLS.values():
            for q in geoms:
                if q[2] > 40.0 and q[0].area > 0 and q[0].intersection(hull).area > 0.6 * q[0].area:
                    ctx.hide(q)
        return geoms
    hull = g.convex_hull
    c = hull.centroid
    ring = np.asarray(hull.exterior.coords)
    ground = min(ctx.ground(x, y) for x, y in ring)
    lm = {"at": [round(c.x, 1), round(c.y, 1)], "ground_m": round(ground, 1), "bearing_deg": round(face_bearing(hull), 1),
          "top_m": round(ground + max((q[2] for q in geoms), default=0.0), 1)}
    if key == "central_plaza":  # the bearing of the outward normal of the face nearest to looking south
        best = None
        for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
            if math.hypot(x1 - x0, y1 - y0) < 25:
                continue
            nx, ny = y1 - y0, -(x1 - x0)
            if nx * ((x0 + x1) / 2 - c.x) + ny * ((y0 + y1) / 2 - c.y) < 0:
                nx, ny = -nx, -ny
            nb = math.degrees(math.atan2(nx, ny)) % 360
            if best is None or abs(nb - 180) < abs(best - 180):
                best = nb
        lm["south_face_deg"] = round(best if best is not None else 180.0, 1)
    if key in ("peak_tower", "hsbc"):  # long buildings: the bearing of the long axis
        lm["bearing_deg"] = round(face_bearing(hull, 180.0), 1)
    ctx.landmarks[key] = lm
    for q in geoms:  # still in the surface model: the landmark's shadow counts in the analyses
        ctx.hide(q)
    return geoms


def finalize(ctx):
    p = ctx.city.to_local(Point(*WHEEL_AT))
    ctx.landmarks["observation_wheel"] = {"at": [round(p.x, 1), round(p.y, 1)], "ground_m": round(ctx.ground(p.x, p.y), 1), "bearing_deg": WHEEL_BEARING,
                                          "height_m": 60.0, "gondolas": 42}
    tops = {"bank_of_china": 367.4, "hsbc": 178.8, "ifc2": 412.0, "icc": 484.0, "central_plaza": 373.9, "clock_tower": 51.0}
    for k, lm in ctx.landmarks.items():
        if k in tops:
            lm["published_top_m"] = tops[k]
        if k in LABELS:
            top = lm["ground_m"] + tops[k] if k in tops else 428.0 if k == "peak_tower" else lm["top_m"]
            ctx.labels[LABELS[k]] = [lm["at"][0], lm["at"][1], round(top + 6.0, 1)]
    w = ctx.landmarks["observation_wheel"]
    ctx.labels["Observation Wheel"] = [w["at"][0], w["at"][1], round(w["ground_m"] + 64.0, 1)]


def landmark_meshes(scene):
    lm = scene["landmarks"]
    meshes = []
    for key, fn in (("bank_of_china", bank_of_china), ("hsbc", hsbc), ("ifc2", ifc2), ("icc", icc), ("central_plaza", central_plaza),
                    ("observation_wheel", observation_wheel), ("clock_tower", clock_tower), ("peak_tower", peak_tower)):
        if key in lm:
            meshes += fn(lm[key])
    return MATERIALS, meshes


# ---------------------------------------------------------------- geometry helpers

def axes(bearing_deg):
    """Unit vectors along a bearing (n) and 90 degrees clockwise of it (e), in the local frame."""
    t = math.radians(bearing_deg)
    return np.array([math.cos(t), -math.sin(t)]), np.array([math.sin(t), math.cos(t)])


def wall(m, a, b, z0, z1, u0=0.0, g0=0.0):
    """A vertical quad from plan point a to b, z0 to z1; uv in metres (along, up from g0)."""
    L = float(np.hypot(*(np.asarray(b) - np.asarray(a))))
    m.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1],
           [[u0, z0 - g0], [u0 + L, z0 - g0], [u0 + L, z1 - g0], [u0, z1 - g0]])
    return u0 + L


def loft(m, levels, g0, cap=True):
    """Side walls between successive plan rings (same vertex count) at heights z, and a flat cap
    on the last: levels [(z, [(x, y), ...]), ...] bottom up. A ring that shrinks between two levels
    steps in with a horizontal ledge, so each pair of levels with the same ring is a straight wall."""
    for (za, ra), (zb, rb) in zip(levels, levels[1:]):
        if ra != rb:  # a setback: a ledge at za from the old ring in to the new one
            n = len(ra)
            for k in range(n):
                a0, a1, b0, b1 = ra[k], ra[(k + 1) % n], rb[k], rb[(k + 1) % n]
                m.quad([a0[0], a0[1], za], [a1[0], a1[1], za], [b1[0], b1[1], za], [b0[0], b0[1], za], [[0, 0], [1, 0], [1, 1], [0, 1]])
        u = 0.0
        for k in range(len(rb)):
            u = wall(m, rb[k], rb[(k + 1) % len(rb)], za, zb, u, g0)
    if cap:
        z, r = levels[-1]
        cx, cy = np.mean([p[0] for p in r]), np.mean([p[1] for p in r])
        for k in range(len(r)):
            a, b = r[k], r[(k + 1) % len(r)]
            m.tri([cx, cy, z], [a[0], a[1], z], [b[0], b[1], z], [[0, 0], [1, 0], [0, 1]])


def chamfered_square(c, e, n, half, ch):
    """A square of half-width `half` with its corners cut by `ch`, ccw, on axes e and n."""
    pts = []
    for sx, sy in ((1, -1), (1, 1), (-1, 1), (-1, -1)):
        corner = c + e * sx * half + n * sy * half
        # the two points either side of the corner, going ccw
        if sx == sy:
            pts += [corner - n * sy * ch, corner - e * sx * ch]
        else:
            pts += [corner - e * sx * ch, corner - n * sy * ch]
    return [tuple(p) for p in pts]


def frame_bar(m, p0, p1, w=1.0, d=0.8):
    m.box(p0, p1, w, d)


# ---------------------------------------------------------------- Bank of China Tower

BOC = {"side_m": 52.0, "module_m": 52.0, "roof_m": 315.0, "mast_top_m": 367.4, "mast_gap_m": 10.8,
       # shaft: (outer edge height, ridge height at the centre), above the ground
       "shafts": {"N": (80.0, 110.0), "W": (130.0, 160.0), "E": (180.0, 210.0), "S": (285.0, 315.0)}}


def bank_of_china(o):
    c, g0 = np.array(o["at"]), o["ground_m"]
    e, n = axes(o["bearing_deg"])
    a = BOC["side_m"] / 2
    corner = {"NE": c + e * a + n * a, "NW": c - e * a + n * a, "SW": c - e * a - n * a, "SE": c + e * a - n * a}
    # each shaft's outer edge, in the order that winds its face outward (ccw seen from above)
    edge = {"N": ("NE", "NW"), "W": ("NW", "SW"), "S": ("SW", "SE"), "E": ("SE", "NE")}
    glass, frame, base, masts = (Mesh("boc_glass", "boc_glass", False, uv=True), Mesh("boc_frame", "boc_frame", False, floodlit=True),
                                 Mesh("boc_base", "granite", False), Mesh("boc_masts", "mast", True, floodlit=True))
    W = 1.1  # the cladding's frame members, m
    for k, (s0, s1) in edge.items():
        A, B = corner[s0], corner[s1]
        ho, hr = (g0 + h for h in BOC["shafts"][k])
        wall(glass, A, B, g0, ho, 0.0, g0)  # the outer face
        # the sloped glazed top: from the outer edge up to the ridge at the centre
        glass.quad([B[0], B[1], ho], [A[0], A[1], ho], [c[0], c[1], hr], [c[0], c[1], hr], [[0, 0], [52, 0], [26, 30], [26, 30]])
        # the two inner faces along the diagonals, each up to the sloped top
        for P in (A, B):
            glass.quad([c[0], c[1], g0], [P[0], P[1], g0], [P[0], P[1], ho], [c[0], c[1], hr],
                       [[0, 0], [36.8, 0], [36.8, ho - g0], [0, hr - g0]])
        # cladding: the corner columns, a frame at every module, and a cross in each full module
        out = (A + B) / 2 - c
        out = out / np.linalg.norm(out) * 0.45
        A2, B2 = A + out, B + out
        for P in (A2, B2):
            frame_bar(frame, [P[0], P[1], g0], [P[0], P[1], ho], W * 1.4, W * 1.4)
        z = g0
        while z + 1 < ho:
            z1 = min(z + BOC["module_m"], ho)
            frame_bar(frame, [A2[0], A2[1], z1], [B2[0], B2[1], z1], W, W)
            if z1 - z > BOC["module_m"] - 1:
                frame_bar(frame, [A2[0], A2[1], z], [B2[0], B2[1], z1], W, W)
                frame_bar(frame, [B2[0], B2[1], z], [A2[0], A2[1], z1], W, W)
            else:  # the part-module under the sloped top: a triangle up from the corners to mid-face
                M = (A2 + B2) / 2
                frame_bar(frame, [A2[0], A2[1], z], [M[0], M[1], z1], W, W)
                frame_bar(frame, [B2[0], B2[1], z], [M[0], M[1], z1], W, W)
            z = z1
        for P in (A2, B2):  # the sloped top's edges up to the ridge
            frame_bar(frame, [P[0], P[1], ho], [c[0], c[1], hr + 0.4], W, W)
        frame_bar(frame, [A2[0], A2[1], ho], [B2[0], B2[1], ho], W, W)
    hmax = max(h for _, h in BOC["shafts"].values())
    frame_bar(frame, [c[0], c[1], g0], [c[0], c[1], g0 + hmax], W, W)  # the centre column where the shafts step
    # the granite base, a storey and a half up
    sq = [tuple(corner[k] + (corner[k] - c) / np.linalg.norm(corner[k] - c) * 1.2) for k in ("SE", "NE", "NW", "SW")]
    loft(base, [(g0 - 1.0, sq), (g0 + 6.5, sq)], g0)
    # the two masts near the south face, parallel to it
    so, sr = BOC["shafts"]["S"]
    mid_s = (corner["SW"] + corner["SE"]) / 2
    inset = 7.0
    for side in (-1, 1):
        p = mid_s + n * inset + e * side * BOC["mast_gap_m"] / 2
        zb = g0 + so + (sr - so) * inset / a
        masts.lathe([(zb - 1.0, 1.1), (zb + 14.0, 0.95), (g0 + BOC["mast_top_m"] - 8.0, 0.45), (g0 + BOC["mast_top_m"], 0.12)], (p[0], p[1]), 10)
    return [glass, frame, base, masts]


# ---------------------------------------------------------------- HSBC Main Building

HSBC = {"length_m": 66.4, "bay_m": 16.2, "plaza_m": 10.0, "bays": {"S": 108.0, "M": 160.0, "N": 135.0}, "roof_m": 178.8,
        "mast_rows_m": 29.0, "trusses_m": [41.0, 75.0, 108.0, 135.0, 160.0], "truss_depth_m": 8.0}


def hsbc(o):
    """Three bays hung from two rows of masts at the east and west ends: the floors fill the 58 m
    between the rows, service modules stand outside them, and at each truss level a coat-hanger
    truss spans from row to row in every mast plane (the outer two make the north and south faces)."""
    c, g0 = np.array(o["at"]), o["ground_m"]
    # the long axis runs at about 105 degrees (east-west): e along it, n across it, to the north
    t = math.radians(o["bearing_deg"])
    e = np.array([math.sin(t), math.cos(t)])
    n = np.array([-e[1], e[0]])
    if n[1] < 0:
        e, n = -e, -n
    L, B, R = HSBC["length_m"] / 2, HSBC["bay_m"], HSBC["mast_rows_m"]
    glass, steel, core = (Mesh("hsbc_glass", "hsbc_glass", False, uv=True), Mesh("hsbc_steel", "hsbc_steel", False, floodlit=True),
                          Mesh("hsbc_cores", "hsbc_steel", False))
    z_plaza = g0 + HSBC["plaza_m"]
    bands = {"S": (-1.5 * B, -0.5 * B), "M": (-0.5 * B, 0.5 * B), "N": (0.5 * B, 1.5 * B)}
    P = lambda u, v: c + e * u + n * v
    for k, (v0, v1) in bands.items():
        top = g0 + HSBC["bays"][k]
        ring = [tuple(P(R - 1.6, v0)), tuple(P(R - 1.6, v1)), tuple(P(-R + 1.6, v1)), tuple(P(-R + 1.6, v0))]
        loft(glass, [(z_plaza, ring), (top, ring)], g0)
        for side in (-1, 1):  # the service modules outside the masts, from the ground up
            u0, u1 = side * (R + 1.8), side * L
            ring = [tuple(P(max(u0, u1), v0 + 0.6)), tuple(P(max(u0, u1), v1 - 0.6)), tuple(P(min(u0, u1), v1 - 0.6)), tuple(P(min(u0, u1), v0 + 0.6))]
            loft(core, [(g0, ring), (top + 2.0, ring)], g0)
    mtop = g0 + HSBC["bays"]["M"]  # roof plant, the helipad and the crane on the middle bay, to the published 178.8 m
    steel.box(list(c) + [mtop], list(c) + [g0 + HSBC["roof_m"] - 6.0], 2 * R * 0.7, B * 0.8, up=(n[0], n[1], 0))
    steel.lathe([(g0 + HSBC["roof_m"] - 6.0, 9.0), (g0 + HSBC["roof_m"] - 5.2, 9.0)], tuple(c), 24)
    p = P(-R * 0.5, 0)
    steel.box([p[0], p[1], mtop], [p[0], p[1], g0 + HSBC["roof_m"]], 1.2, 1.2)
    posts = (-1.5 * B, -0.5 * B, 0.5 * B, 1.5 * B)
    height_at = {-1.5 * B: HSBC["bays"]["S"], -0.5 * B: HSBC["bays"]["M"], 0.5 * B: HSBC["bays"]["M"], 1.5 * B: HSBC["bays"]["N"]}
    for v in posts:
        out = 1.4 if v > 0.6 * B else -1.4 if v < -0.6 * B else 0.0  # the outer trusses stand proud of the faces
        for side in (-1, 1):  # a mast: four steel tubes in a square
            for du in (-1.2, 1.2):
                for dv in (-1.2, 1.2):
                    q = P(side * R + du, v + dv)
                    steel.lathe([(g0, 0.7), (g0 + height_at[v] + 3.0, 0.7)], (q[0], q[1]), 8)
        for zt in HSBC["trusses_m"]:
            if zt > height_at[v] + 0.1:
                continue
            z1, z0 = g0 + zt, g0 + zt - HSBC["truss_depth_m"]
            A, Bm, M = P(-R, v + out), P(R, v + out), P(0, v + out)
            for a_, b_ in (((A, z1), (Bm, z1)), ((A, z0), (Bm, z0)), ((A, z0), (M, z1)), ((Bm, z0), (M, z1)),
                           ((P(-R / 2, v + out), z1), (P(-R / 2, v + out), z0)), ((P(R / 2, v + out), z1), (P(R / 2, v + out), z0))):
                steel.box([a_[0][0], a_[0][1], a_[1]], [b_[0][0], b_[0][1], b_[1]], 1.3, 1.3)
    return [glass, steel, core]


# ---------------------------------------------------------------- Two IFC

IFC2 = {"tip_m": 412.0, "roof_m": 388.0, "base_w": 57.0, "roof_w": 39.1, "chamfer_m": 11.0,
        "steps": [(270.0, 57.0), (300.0, 54.0), (325.0, 51.0), (348.0, 47.5), (368.0, 43.5), (388.0, 39.1)]}


def ifc2(o):
    c, g0 = np.array(o["at"]), o["ground_m"]
    e, n = axes(o["bearing_deg"])
    glass, crown = Mesh("ifc2_glass", "ifc_glass", False, uv=True), Mesh("ifc2_crown", "mast", False, floodlit=True)
    levels, z = [], g0
    for zt, w in IFC2["steps"]:
        ring = chamfered_square(c, e, n, w / 2, IFC2["chamfer_m"] * w / IFC2["base_w"])
        levels += [(z, ring), (g0 + zt, ring)]
        z = g0 + zt
    loft(glass, levels, g0)
    # the open crown: vertical fins round the roof, rising to the tip at the corners
    top = chamfered_square(c, e, n, IFC2["roof_w"] / 2 - 0.5, IFC2["chamfer_m"] * IFC2["roof_w"] / IFC2["base_w"])
    for k in range(len(top)):
        a, b = np.array(top[k]), np.array(top[(k + 1) % len(top)])
        L = float(np.hypot(*(b - a)))
        out = (a + b) / 2 - c
        out = out / np.linalg.norm(out)
        for t in np.arange(0.0, 1.0, 2.2 / max(L, 1)):
            p = a + (b - a) * t
            corner = min(t, 1 - t) * L
            h = IFC2["tip_m"] - min(corner, 12.0) * 0.9
            crown.box([p[0], p[1], g0 + IFC2["roof_m"]], [p[0], p[1], g0 + h], 0.5, 1.4, up=(out[0], out[1], 0))
    return [glass, crown]


# ---------------------------------------------------------------- ICC

ICC = {"top_m": 484.0, "face_m": 53.0, "notch": [(0.0, 3.0), (484.0, 7.5)], "skirt": [(0.0, 9.0), (25.0, 5.0), (50.0, 2.0), (70.0, 0.0)]}


def notched_square(c, e, n, half, notch):
    """A square with a square notch of size `notch` cut from each corner (12 points, ccw)."""
    pts = []
    for sx, sy in ((1, -1), (1, 1), (-1, 1), (-1, -1)):
        corner = c + e * sx * half + n * sy * half
        a, b = corner - n * sy * notch, corner - e * sx * notch  # on the e-facing and n-facing sides
        inner = corner - n * sy * notch - e * sx * notch
        pts += [tuple(a), tuple(inner), tuple(b)] if sx == sy else [tuple(b), tuple(inner), tuple(a)]
    return pts


def icc(o):
    c, g0 = np.array(o["at"]), o["ground_m"]
    e, n = axes(o["bearing_deg"])
    glass = Mesh("icc_glass", "icc_glass", False, uv=True)
    half = ICC["face_m"] / 2 + ICC["notch"][0][1]
    levels = []
    zs = [0.0, 10.0, 25.0, 40.0, 55.0, 70.0] + list(np.arange(100.0, ICC["top_m"], 40.0)) + [ICC["top_m"]]
    for z in zs:
        notch = np.interp(z, [p[0] for p in ICC["notch"]], [p[1] for p in ICC["notch"]])
        skirt = np.interp(z, [p[0] for p in ICC["skirt"]], [p[1] for p in ICC["skirt"]])
        lean = 1.0 - 0.017 * z / ICC["top_m"] * 2  # the faces lean in about 1 degree
        levels.append((g0 + z, notched_square(c, e, n, (half + skirt) * lean, notch)))
    for (za, ra), (zb, rb) in zip(levels, levels[1:]):  # a smooth loft, no ledges
        u = 0.0
        for k in range(len(ra)):
            a0, a1, b0, b1 = ra[k], ra[(k + 1) % len(ra)], rb[k], rb[(k + 1) % len(rb)]
            L = math.hypot(a1[0] - a0[0], a1[1] - a0[1])
            glass.quad([a0[0], a0[1], za], [a1[0], a1[1], za], [b1[0], b1[1], zb], [b0[0], b0[1], zb],
                       [[u, za - g0], [u + L, za - g0], [u + L, zb - g0], [u, zb - g0]])
            u += L
    z, r = levels[-1]
    cx, cy = c
    for k in range(len(r)):  # the roof, 6 m down inside the parapets
        a, b = r[k], r[(k + 1) % len(r)]
        glass.tri([cx, cy, z - 6.0], [a[0], a[1], z - 6.0], [b[0], b[1], z - 6.0], [[0, 0], [1, 0], [0, 1]])
        glass.quad([a[0], a[1], z], [b[0], b[1], z], [b[0], b[1], z - 6.0], [a[0], a[1], z - 6.0], [[0, 0], [1, 0], [1, 1], [0, 1]])
    return [glass]


# ---------------------------------------------------------------- Central Plaza

CP = {"side_m": 72.0, "cut_m": 12.0, "body_m": 282.0, "roof_m": 309.0, "tip_m": 373.9}


def central_plaza(o):
    c, g0 = np.array(o["at"]), o["ground_m"]
    s = math.radians(o.get("south_face_deg", 180.0))
    out = np.array([math.sin(s), math.cos(s)])  # the south face's outward normal
    side = np.array([out[1], -out[0]])
    R = CP["side_m"] / math.sqrt(3)  # circumradius of the full triangle
    # the triangle's corners: the south face's two ends and the apex opposite it
    apex = c - out * R
    base_mid = c + out * R / 2
    corners = [base_mid - side * CP["side_m"] / 2, base_mid + side * CP["side_m"] / 2, apex]
    ring = []
    for k in range(3):
        p, prev, nxt = corners[k], corners[k - 1], corners[(k + 1) % 3]
        ring += [tuple(p + (prev - p) / np.linalg.norm(prev - p) * CP["cut_m"]), tuple(p + (nxt - p) / np.linalg.norm(nxt - p) * CP["cut_m"])]
    glass, crown, mast = (Mesh("central_plaza_glass", "cp_glass", False, uv=True), Mesh("central_plaza_crown", "cp_crown", False, floodlit=True),
                          Mesh("central_plaza_mast", "mast", True, floodlit=True))
    loft(glass, [(g0, ring), (g0 + CP["body_m"], ring)], g0, cap=False)
    top = (c[0], c[1], g0 + CP["roof_m"])
    for k in range(len(ring)):  # the glass pyramid
        a, b = ring[k], ring[(k + 1) % len(ring)]
        crown.tri([a[0], a[1], g0 + CP["body_m"]], [b[0], b[1], g0 + CP["body_m"]], list(top))
    mast.lathe([(g0 + CP["roof_m"] - 2, 1.6), (g0 + CP["roof_m"] + 20, 1.2), (g0 + CP["tip_m"] - 10, 0.5), (g0 + CP["tip_m"], 0.12)], (c[0], c[1]), 10)
    # the Lightime clock's four bars, in the crown's south face
    for k in range(4):
        z = g0 + CP["body_m"] - 4 - k * 4.5
        p0, p1 = base_mid + out * 0.6 - side * 14, base_mid + out * 0.6 + side * 14
        crown.box([p0[0], p0[1], z], [p1[0], p1[1], z], 0.5, 1.6)
    return [glass, crown, mast]


# ---------------------------------------------------------------- Observation Wheel

def observation_wheel(o):
    c, g0, H = np.array(o["at"]), o["ground_m"], o["height_m"]
    d, ax = axes(o["bearing_deg"])[1], axes(o["bearing_deg"])[0]  # d: in the wheel's plane; ax: its axle
    r, hub = H / 2 - 3.0, g0 + H / 2 + 0.5
    frame, cars = Mesh("wheel_frame", "wheel", False, floodlit=True), Mesh("wheel_gondolas", "gondola", True, floodlit=True)
    P = lambda a, rr, off: [c[0] + d[0] * rr * math.cos(a) + ax[0] * off, c[1] + d[1] * rr * math.cos(a) + ax[1] * off, hub + rr * math.sin(a)]
    for off in (-1.2, 1.2):  # the twin rims
        frame.tube([P(a, r, off) for a in np.linspace(0, 2 * math.pi, 73)], 0.35, 6)
    for k in range(42):  # spokes, alternating sides, and the gondolas hung outside the rim
        a = 2 * math.pi * k / 42
        frame.tube([P(0, 0, 1.6 * (1 if k % 2 else -1)), P(a, r, 1.2 * (1 if k % 2 else -1))], 0.06, 4)
        g = P(a, r + 1.6, 0.0)
        cars.box([g[0], g[1], g[2] - 1.3], [g[0], g[1], g[2] + 1.0], 2.2, 2.6)
    for side in (-1, 1):  # A-frame legs either side of the wheel, down to a base along its plane
        top = [c[0] + ax[0] * side * 3.2, c[1] + ax[1] * side * 3.2, hub]
        for t in (-1, 1):
            foot = [c[0] + d[0] * t * 13.0 + ax[0] * side * 5.0, c[1] + d[1] * t * 13.0 + ax[1] * side * 5.0, g0]
            frame.tube([foot, top], 0.55, 8)
    frame.tube([[c[0] - ax[0] * 3.4, c[1] - ax[1] * 3.4, hub], [c[0] + ax[0] * 3.4, c[1] + ax[1] * 3.4, hub]], 1.2, 12)  # the axle
    return [frame, cars]


# ---------------------------------------------------------------- Clock Tower

def clock_tower(o):
    c, g0 = np.array(o["at"]), o["ground_m"]
    e, n = axes(o["bearing_deg"])
    brick, trim, face = Mesh("clock_tower_brick", "brick", False), Mesh("clock_tower_trim", "stone_trim", False, floodlit=True), Mesh("clock_tower_faces", "clock_face", True, floodlit=True)
    sq = lambda h: [tuple(c + e * sx * h + n * sy * h) for sx, sy in ((1, -1), (1, 1), (-1, 1), (-1, -1))]
    loft(brick, [(g0, sq(3.6)), (g0 + 31.0, sq(3.6))], g0, cap=False)
    for z in (0.0, 8.0, 16.0, 24.0):  # granite bands
        loft(trim, [(g0 + z, sq(3.75)), (g0 + z + 0.8, sq(3.75))], g0, cap=False)
    loft(trim, [(g0 + 31.0, sq(3.9)), (g0 + 37.5, sq(3.9))], g0)  # the clock stage
    for k in range(4):  # a clock face on each side
        nrm = [e, n, -e, -n][k]
        p = c + nrm * 3.95
        face.box([p[0], p[1], g0 + 34.2], [p[0] + nrm[0] * 0.15, p[1] + nrm[1] * 0.15, g0 + 34.2], 2.5, 2.5, up=(0, 0, 1))
    oct8 = lambda r: [(c[0] + r * math.cos(math.pi / 8 + k * math.pi / 4), c[1] + r * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    loft(brick, [(g0 + 37.5, oct8(3.0)), (g0 + 41.0, oct8(3.0))], g0, cap=False)  # the belfry
    brick.lathe([(g0 + 41.0, 3.1), (g0 + 42.4, 2.6), (g0 + 43.4, 1.6), (g0 + 44.0, 0.4)], (c[0], c[1]), 16)  # the dome
    trim.lathe([(g0 + 44.0, 0.12), (g0 + 51.0, 0.03)], (c[0], c[1]), 6)  # the lightning rod
    return [brick, trim, face]


# ---------------------------------------------------------------- Peak Tower

PEAK = {"top_m": 428.0, "length_m": 68.5, "width_m": 28.8, "upsweep_m": 7.0, "roof_base_m": 418.5, "body_top_m": 412.0}


def peak_tower(o):
    c, g0 = np.array(o["at"]), o["ground_m"]
    e, n = axes(o["bearing_deg"])  # e across, n along the long axis
    a, b = PEAK["length_m"] / 2, PEAK["width_m"] / 2
    body, roof = Mesh("peak_tower_body", "peak_body", False, uv=True), Mesh("peak_tower_roof", "peak_roof", True, floodlit=True)
    ring = [tuple(c + n * a * 0.82 * math.cos(t) + e * b * 0.78 * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 25)[:-1]]
    loft(body, [(g0 - 2.0, ring), (PEAK["body_top_m"], ring)], g0)
    # the crescent roof: a shallow dish whose ends sweep up, on columns
    zr = lambda u, v: PEAK["roof_base_m"] + PEAK["upsweep_m"] * u ** 4 + 1.5 * v * v
    top_pts, bot_pts = [], []
    for i, u in enumerate(np.linspace(-1, 1, 25)):
        row_t, row_b = [], []
        for v in np.linspace(-1, 1, 9):
            w = math.sqrt(max(0.0, 1 - u ** 8)) * (1 - 0.18 * u * u)  # a lens-shaped plan, its ends pinched
            p = c + n * a * u + e * b * v * w
            row_t.append([p[0], p[1], min(zr(u, v) + 1.6, PEAK["top_m"])])
            row_b.append([p[0], p[1], zr(u, v)])
        top_pts.append(row_t)
        bot_pts.append(row_b[::-1])
    roof.grid(top_pts)
    roof.grid(bot_pts)
    for t in np.linspace(-0.6, 0.6, 4):
        for v in (-0.5, 0.5):
            p = c + n * a * t + e * b * v * 0.7
            roof.lathe([(PEAK["body_top_m"], 0.6), (PEAK["roof_base_m"] + 0.2, 0.6)], (p[0], p[1]), 8)
    return [body, roof]
