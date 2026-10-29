"""Melbourne Bayside: what the generic pipeline cannot know from open data.

Building adjustments (called by pipeline/build_scene.py):
  * Brighton bathing boxes: OpenStreetMap maps all 96 of them (as Wikipedia counts them in
    2026) as beach_hut footprints along Dendy Street Beach, with no heights. Each becomes a
    parametric box on its own footprint. The OSM solids stay in the surface model at the
    box's ridge height, so their shadows count, and the renderers draw the boxes instead.

Parametric landmarks (called by pipeline/landmarks.py):
  Bathing boxes   timber weatherboard boxes with pitched corrugated-iron gable roofs, openings
                  at the front (Heritage Victoria assessment, 2017; VHR H2369). Walls 2.0 m
                  with a 35-degree roof pitch, the bay-wide standard of the Brighton Bathing Box
                  Association; plan sizes from each OSM footprint (about 3 x 4 m). The front
                  faces whichever end has the lower ground: the water. Since the mid-1970s each
                  owner has painted their box (the 2017 assessment); the schemes drawn here are
                  illustrative, not each box's own.
  Scenic Railway  Luna Park's 1912 roller coaster: 967 m of track, 16 m tall (Luna Park). It
                  runs round the park; here it is one loop of the mapped park edge, set 6 m in,
                  climbing to 16 m on the far side, on timber trestles. Where the loop passes
                  behind Mr Moon it crosses the way in on a span, so that the gate stays open.
  Mr Moon         the face entrance (1912, rebuilt in fibreglass in 1999). No dimensions are
                  published, so the face is scaled so that its open mouth is a 3.2 m doorway,
                  between two towers, at the entrance OpenStreetMap maps on the park's edge.

Labels: the pier kiosk (1904, rebuilt after the 2003 fire) and Mr Moon are placed at their
OpenStreetMap coordinates.
"""
import math

import numpy as np
import shapely
from shapely.geometry import LineString, Point

from meshkit import Mesh

WALL_M, PITCH_DEG, PLINTH_M = 2.0, 35.0, 0.25
MR_MOON = (144.97678, -37.86725)      # Luna Park's main entrance (OSM)
PIER_KIOSK = (144.96572, -37.86472)   # St Kilda Pier kiosk (OSM node 310961049)
SCENIC_TOP_M, SCENIC_TRACK_M = 16.0, 967.0

# paint and roof colours for the boxes (sRGB); schemes are illustrative
PAINTS = {"red": "#c8352e", "yellow": "#f2c230", "blue": "#2f6db3", "teal": "#2a9d8f", "white": "#f4f1ea", "pink": "#e77fa6",
          "orange": "#ef7d32", "green": "#3f8f4f", "navy": "#1f3557", "lilac": "#9a86c4", "sky": "#7fc4e6", "lime": "#a8c94a"}
ROOFS = {"white": "#e9e7e1", "red": "#a83a2f", "green": "#356b4a", "grey": "#8a9095", "blue": "#3b5f86"}
MATERIALS = {**{f"paint_{k}": {"color": v, "roughness": 0.72, "metalness": 0.0} for k, v in PAINTS.items()},
             **{f"roof_{k}": {"color": v, "roughness": 0.45, "metalness": 0.35} for k, v in ROOFS.items()},
             "timber": {"color": "#8a6a48", "roughness": 0.85, "metalness": 0.0},
             "trestle": {"color": "#efe9dc", "roughness": 0.8, "metalness": 0.0},
             "rail": {"color": "#5b5f63", "roughness": 0.4, "metalness": 0.7},
             "moon": {"color": "#f3e9c6", "roughness": 0.6, "metalness": 0.0},
             "moon_dark": {"color": "#2b2a33", "roughness": 0.6, "metalness": 0.0},
             "moon_red": {"color": "#c23a3a", "roughness": 0.5, "metalness": 0.0},
             "tower": {"color": "#e8d7b0", "roughness": 0.7, "metalness": 0.0},
             "dome": {"color": "#d8a23a", "roughness": 0.4, "metalness": 0.4}}


def adjust_building(b, cls, g, geoms, ctx):
    if cls != "beach_hut":
        return geoms
    rect = g.minimum_rotated_rectangle
    cs = np.asarray(rect.exterior.coords)[:4]
    e1, e2 = cs[1] - cs[0], cs[2] - cs[1]
    width_axis, depth_axis = (e1, e2) if np.linalg.norm(e1) < np.linalg.norm(e2) else (e2, e1)
    w, d = float(np.linalg.norm(width_axis)), float(np.linalg.norm(depth_axis))
    c = np.asarray(rect.centroid.coords[0])
    u = depth_axis / d
    # the front is the end towards the water: the lower ground 8 m beyond it
    if ctx.ground(*(c + u * (d / 2 + 8))) > ctx.ground(*(c - u * (d / 2 + 8))):
        u = -u
    ground = min(ctx.ground(x, y) for x, y in cs)
    ridge = PLINTH_M + WALL_M + w / 2 * math.tan(math.radians(PITCH_DEG))
    ctx.landmarks.setdefault("bathing_boxes", []).append({
        "at": [round(float(c[0]), 2), round(float(c[1]), 2)], "front_deg": round(math.degrees(math.atan2(u[0], u[1])), 1),
        "width_m": round(w, 2), "depth_m": round(d, 2), "ground_m": round(ground, 2), "osm": (b.get("record_id") or "").split("@")[0]})
    out = [[p, 0.0, ridge, "parametric", None] for p in ctx.polygons(g)]
    for q in out:  # the surface model keeps them; the renderers draw the boxes
        ctx.hide(q)
    return out


def finalize(ctx):
    boxes = ctx.landmarks.get("bathing_boxes", [])
    if boxes:  # north to south, as they stand along the beach
        boxes.sort(key=lambda b: -b["at"][1])
        mid = boxes[len(boxes) // 2]
        ctx.labels["Brighton bathing boxes"] = [mid["at"][0], mid["at"][1], round(mid["ground_m"] + 9.0, 1)]
    p = ctx.city.to_local(Point(*PIER_KIOSK))
    ctx.labels["St Kilda Pier kiosk"] = [round(p.x, 1), round(p.y, 1), round(ctx.ground(p.x, p.y) + 14.0, 1)]
    # Luna Park: its mapped edge carries the Scenic Railway, and Mr Moon stands at the mapped entrance
    m = ctx.city.to_local(Point(*MR_MOON))
    ctx.landmarks["mr_moon"] = {"at": [round(m.x, 1), round(m.y, 1)], "ground_m": round(ctx.ground(m.x, m.y), 1)}
    ctx.labels["Luna Park"] = [round(m.x, 1), round(m.y, 1), round(ctx.ground(m.x, m.y) + 22.0, 1)]
    park = land_use(ctx, "Luna Park")
    if park is not None:
        edge = park.buffer(-6.0).simplify(1.0)
        edge = max(ctx.polygons(edge), key=lambda q: q.area).exterior
        c = park.centroid
        ctx.landmarks["luna_park"] = {"edge": [[round(x, 1), round(y, 1)] for x, y in edge.coords], "centre": [round(c.x, 1), round(c.y, 1)],
                                      "entrance": [round(m.x, 1), round(m.y, 1)], "ground_m": round(ctx.ground(c.x, c.y), 1),
                                      "loop_m": round(edge.length), "track_m": SCENIC_TRACK_M}


def land_use(ctx, name):
    """The largest Overture land-use polygon of a name, in the local frame."""
    import duckdb
    from shapely import wkb as swkb
    rows = duckdb.connect().execute(f"SELECT wkb FROM '{ctx.city.raw}/overture_land_use.parquet' WHERE name = ?", [name]).fetchall()
    gs = [ctx.city.to_local(swkb.loads(bytes(r[0]))) for r in rows]
    return max(gs, key=lambda g: g.area) if gs else None


def landmark_meshes(scene):
    lm = scene["landmarks"]
    meshes = {}

    def mesh(name, mat, floodlit=False):
        if name not in meshes:
            meshes[name] = Mesh(name, mat, False, floodlit=floodlit)
        return meshes[name]
    rng = np.random.default_rng(1934)  # the year the boxes moved to this site
    paints, roofs = list(PAINTS), list(ROOFS)
    for k, b in enumerate(lm.get("bathing_boxes", [])):
        body = paints[rng.integers(len(paints))]
        trim = "white" if body != "white" else paints[rng.integers(len(paints))]
        scheme = ("solid", "stripes", "stripes", "bands", "split")[rng.integers(5)]
        roof = roofs[rng.integers(len(roofs))]
        bathing_box(mesh, b, body, trim, scheme, roof)
    if "luna_park" in lm:
        scenic_railway(mesh, lm["luna_park"], lm.get("mr_moon"))
    if "mr_moon" in lm:
        mr_moon(mesh, lm["mr_moon"], lm.get("luna_park"))
    return MATERIALS, list(meshes.values())


def frame(b):
    """The box's local axes: f towards the front (the water), r to its right, from its centre."""
    a = math.radians(b["front_deg"])
    f = np.array([math.sin(a), math.cos(a), 0.0])
    r = np.array([f[1], -f[0], 0.0])
    o = np.array([b["at"][0], b["at"][1], b["ground_m"]])
    return o, f, r


def bathing_box(mesh, b, body, trim, scheme, roof):
    o, f, r = frame(b)
    w, d = b["width_m"], b["depth_m"]
    z0, z1 = PLINTH_M, PLINTH_M + WALL_M
    rise = w / 2 * math.tan(math.radians(PITCH_DEG))
    P = lambda x, y, z: o + r * x + f * y + np.array([0, 0, z])
    base = mesh("bathing_box_plinth", "timber")
    base.box(P(0, -d / 2 + 0.05, 0), P(0, d / 2 - 0.05, 0), w - 0.1, PLINTH_M * 2, up=(0, 0, 1))
    walls = mesh(f"bathing_box_{body}", f"paint_{body}")
    # side and back walls, and the gables
    for x in (-w / 2, w / 2):
        walls.quad(P(x, -d / 2, z0), P(x, d / 2, z0), P(x, d / 2, z1), P(x, -d / 2, z1))
    walls.quad(P(w / 2, -d / 2, z0), P(-w / 2, -d / 2, z0), P(-w / 2, -d / 2, z1), P(w / 2, -d / 2, z1))
    walls.tri(P(w / 2, -d / 2, z1), P(-w / 2, -d / 2, z1), P(0, -d / 2, z1 + rise))
    # the front, in the scheme's panels (vertical stripes, horizontal bands, two halves, or plain)
    front = lambda x0, x1, za, zb, colour: mesh(f"bathing_box_{colour}", f"paint_{colour}").quad(
        P(x0, d / 2 + 0.01, za), P(x1, d / 2 + 0.01, za), P(x1, d / 2 + 0.01, zb), P(x0, d / 2 + 0.01, zb))
    if scheme == "stripes":
        n = 5 if w < 3.2 else 7
        for k in range(n):
            front(-w / 2 + w * k / n, -w / 2 + w * (k + 1) / n, z0, z1, body if k % 2 == 0 else trim)
    elif scheme == "bands":
        for k in range(4):
            front(-w / 2, w / 2, z0 + WALL_M * k / 4, z0 + WALL_M * (k + 1) / 4, body if k % 2 == 0 else trim)
    elif scheme == "split":
        front(-w / 2, 0, z0, z1, body)
        front(0, w / 2, z0, z1, trim)
    else:
        front(-w / 2, w / 2, z0, z1, body)
    gable = mesh(f"bathing_box_{trim}", f"paint_{trim}")
    gable.tri(P(-w / 2, d / 2 + 0.01, z1), P(w / 2, d / 2 + 0.01, z1), P(0, d / 2 + 0.01, z1 + rise))
    # double doors: frames and a centre stile, in the body colour on a trimmed front, else the trim
    door = mesh(f"bathing_box_{trim if scheme == 'solid' else 'white'}", f"paint_{trim if scheme == 'solid' else 'white'}")
    dw, dh = min(1.6, w - 0.8), 1.85
    for x0, x1, za, zb in ((-dw / 2, dw / 2, z0 + dh, z0 + dh + 0.08), (-dw / 2 - 0.08, -dw / 2, z0, z0 + dh + 0.08),
                           (dw / 2, dw / 2 + 0.08, z0, z0 + dh + 0.08), (-0.03, 0.03, z0, z0 + dh)):
        door.quad(P(x0, d / 2 + 0.03, za), P(x1, d / 2 + 0.03, za), P(x1, d / 2 + 0.03, zb), P(x0, d / 2 + 0.03, zb))
    # the corrugated-iron roof, overhanging a little
    rf = mesh(f"bathing_box_roof_{roof}", f"roof_{roof}")
    ov = 0.15
    for s in (-1, 1):
        a, c = P(s * (w / 2 + ov), -d / 2 - ov, z1 - ov * math.tan(math.radians(PITCH_DEG))), P(0, -d / 2 - ov, z1 + rise)
        a2, c2 = P(s * (w / 2 + ov), d / 2 + ov, z1 - ov * math.tan(math.radians(PITCH_DEG))), P(0, d / 2 + ov, z1 + rise)
        rf.quad(a, a2, c2, c) if s < 0 else rf.quad(c, c2, a2, a)


def scenic_railway(mesh, lp, gate=None):
    """One loop of track along the park's edge, set in, rising from the entrance side to 16 m
    on the far side; trestles every 4 m. Behind Mr Moon the track crosses the way in on a clear
    span, 4.5 m above the gate's ground, so that people walk in under it."""
    ring = LineString(lp["edge"])
    L = ring.length
    n = max(24, int(L / 3))
    ex, ey = lp["entrance"]
    s0 = ring.project(Point(ex, ey))
    span = (gate["ground_m"] if gate else lp["ground_m"]) - lp["ground_m"] + 4.5  # above the park's ground
    pts, near = [], []
    for k in range(n + 1):
        s = (s0 + L * k / n) % L
        q = ring.interpolate(s)
        t = k / n  # 0 and 1 at the entrance, 0.5 on the far side
        h = 4.0 + (SCENIC_TOP_M - 4.0) * (0.5 - 0.5 * math.cos(2 * math.pi * t)) ** 0.8 + 1.5 * math.sin(6 * math.pi * t) ** 2
        ds = L * min(t, 1 - t)  # along the track from the gate
        h = max(h, span * min(1.0, max(0.0, 2.0 - ds / 10.0)))  # level over the gate, easing out 10-20 m away
        pts.append(np.array([q.x, q.y, lp["ground_m"] + h]))
        near.append(ds < 6.0)
    deck = mesh("scenic_railway_deck", "timber")
    deck.sweep(pts, [(-1.3, 0), (1.3, 0), (1.3, -0.35), (-1.3, -0.35)])
    rails = mesh("scenic_railway_rails", "rail")
    for side in (-0.55, 0.55):
        path = []
        for k, p in enumerate(pts):
            t = pts[min(k + 1, n)] - pts[max(k - 1, 0)]
            sd = np.cross(t, (0, 0, 1.0))
            sd /= np.linalg.norm(sd) or 1
            path.append(p + sd * side + np.array([0, 0, 0.12]))
        rails.tube(path, 0.06, sides=5)
    trestles = mesh("scenic_railway_trestles", "trestle")
    for k in range(0, n, max(1, int(4 / (L / n)))):
        if near[k]:  # no trestles in the way in
            continue
        p = pts[k]
        t = pts[min(k + 1, n)] - pts[max(k - 1, 0)]
        sd = np.cross(t, (0, 0, 1.0))
        sd /= np.linalg.norm(sd) or 1
        for side in (-1.1, 1.1):
            top = p + sd * side - np.array([0, 0, 0.35])
            trestles.box(np.array([top[0], top[1], lp["ground_m"]]), top, 0.22, 0.22, up=(1, 0, 0))
        trestles.box(p + sd * -1.1 - np.array([0, 0, 0.6]), p + sd * 1.1 - np.array([0, 0, 0.6]), 0.16, 0.16)


def mr_moon(mesh, m, lp):
    """A round face with an open mouth for the gate, between two towers with domes. Scaled by its
    mouth (3.2 m, a walk-through doorway); no published dimensions exist."""
    cx, cy = m["at"]
    g0 = m["ground_m"]
    # face the way out of the park: away from its centre
    if lp:
        ox, oy = cx - lp["centre"][0], cy - lp["centre"][1]
    else:
        ox, oy = 0.0, 1.0
    Ln = math.hypot(ox, oy) or 1
    f = np.array([ox / Ln, oy / Ln, 0.0])
    r = np.array([f[1], -f[0], 0.0])
    mouth_h, R = 3.2, 5.2  # the face is about three mouths tall
    zc = g0 + mouth_h + R * 0.55
    P = lambda x, z, y=0.0: np.array([cx, cy, 0.0]) + r * x + f * y + np.array([0, 0, z])
    face = mesh("mr_moon_face", "moon", floodlit=True)
    # the face: a disc of rings, with the mouth cut as an arch below its centre
    segs = 40
    for k in range(segs):
        a0, a1 = 2 * math.pi * k / segs, 2 * math.pi * (k + 1) / segs
        for r0, r1 in ((0.0, R * 0.5), (R * 0.5, R)):
            pa, pb = (math.sin(a0), math.cos(a0)), (math.sin(a1), math.cos(a1))
            q = [P(pa[0] * r0, zc + pa[1] * r0, 0.4), P(pb[0] * r0, zc + pb[1] * r0, 0.4), P(pb[0] * r1, zc + pb[1] * r1, 0.4 - 0.3 * r1 / R),
                 P(pa[0] * r1, zc + pa[1] * r1, 0.4 - 0.3 * r1 / R)]
            mid = (q[0] + q[2]) / 2
            if abs(np.dot(mid - P(0, g0), r)) < 1.6 and mid[2] < g0 + mouth_h:  # the doorway
                continue
            face.quad(*q) if r0 > 0 else face.tri(q[0], q[3], q[2])
    def disc(m, x, z, rx, rz, y, n=14):
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            m.tri(P(x, z, y), P(x + math.sin(a1) * rx, z + math.cos(a1) * rz, y), P(x + math.sin(a0) * rx, z + math.cos(a0) * rz, y))
    whites = mesh("mr_moon_teeth", "moon")
    dark = mesh("mr_moon_features", "moon_dark")
    for s in (-1, 1):  # wide eyes looking out, and brows raised in arcs
        ex, ez = s * R * 0.34, zc + R * 0.3
        disc(whites, ex, ez, 0.75, 0.95, 0.47)
        disc(dark, ex + s * 0.08, ez - 0.1, 0.36, 0.45, 0.5)
        for k in range(6):
            a0, a1 = math.pi * (0.2 + 0.6 * k / 6), math.pi * (0.2 + 0.6 * (k + 1) / 6)
            dark.box(P(ex - 1.0 * math.cos(a0), ez + 0.75 + 0.55 * math.sin(a0), 0.46), P(ex - 1.0 * math.cos(a1), ez + 0.75 + 0.55 * math.sin(a1), 0.46), 0.14, 0.2)
    red = mesh("mr_moon_mouth", "moon_red")
    # the grin: a smile curving up over the doorway, with a row of teeth under it
    smile = [(x, g0 + mouth_h + 0.15 + 0.55 * (x / 2.4) ** 2) for x in np.linspace(-2.4, 2.4, 13)]
    for (x0, z0), (x1, z1) in zip(smile, smile[1:]):
        red.box(P(x0, z0, 0.47), P(x1, z1, 0.47), 0.32, 0.34)
    for x in np.linspace(-1.35, 1.35, 7):  # each tooth hangs from the top of the mouth
        whites.box(P(x, g0 + mouth_h + 0.1, 0.46), P(x, g0 + mouth_h - 0.4, 0.46), 0.34, 0.12, up=tuple(f))
    for s in (-1, 1):  # rosy cheeks
        disc(red, s * R * 0.62, zc - R * 0.12, 0.7, 0.5, 0.44)
    towers = mesh("mr_moon_towers", "tower", floodlit=True)
    domes = mesh("mr_moon_domes", "dome", floodlit=True)
    for s in (-1, 1):
        tx, ty = (np.array([cx, cy]) + r[:2] * s * (R + 2.6)).tolist()
        towers.lathe([(g0, 1.6), (g0 + 12.0, 1.6), (g0 + 12.0, 2.0), (g0 + 12.6, 2.0), (g0 + 12.6, 1.5)], (tx, ty), segs=16)
        domes.lathe([(g0 + 12.6, 1.6), (g0 + 14.2, 1.3), (g0 + 15.4, 0.6), (g0 + 16.2, 0.1)], (tx, ty), segs=16)
