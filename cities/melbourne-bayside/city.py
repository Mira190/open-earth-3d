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

  Pier kiosk      the pavilion at the end of St Kilda Pier (J. C. Morell for the Public Works
                  Department, 1904; burnt in 2003 and rebuilt in 2005 to the original plans): a
                  timber kiosk and observatory on its mapped platform at the pier's deck height, its
                  ground floor of weatherboards and windows under a verandah, the balustraded
                  upper deck, the observatory room on it and its lantern, cast-iron cresting and
                  weathervane (Victorian Heritage Database; Wikipedia). No drawings are published:
                  the 16 m by 9 m plan, the heights and the cream, green and red paint are taken
                  from photographs.

  Palais Theatre  Henry E. White's picture palace on the Lower Esplanade (1927; restored 2017-2019, the
                  facade back in its original sand colour). Drawn on its mapped footprint (OSM w15477104,
                  34 by 78 m), which it hides: the front to the Esplanade between two square towers, each
                  with a tall slit window, an upper stage with an arched window and Spanish Baroque corner
                  pinnacles, and a zinc dome and spire; between them the curved parapet with PALAIS THEATRE
                  in raised capitals over the crest and its flagpole, the arched recess with five tall
                  windows and lattice panels, the glazed loggia of three arches over the balustrade, the
                  cantilevered canopy and its sign band over the doors; behind, the auditorium under a
                  shallow barrel roof. No drawings are published: the facade's proportions are scaled
                  from a 2025 photograph (Wikimedia Commons, "Palais Theatre St Kilda 2025.jpg") to the
                  footprint's 34 m front, which puts the towers' spires at about 30 m and the parapet's
                  crown at 25 m; the auditorium's 20 m is the mapped height.

Labels: the pier kiosk and Mr Moon are placed at their OpenStreetMap coordinates.
"""
import math

import numpy as np
import shapely
from shapely.geometry import LineString, Point

import archkit as ak
import japankit as jk
from meshkit import Mesh

WALL_M, PITCH_DEG, PLINTH_M = 2.0, 35.0, 0.25
MR_MOON = (144.97678, -37.86725)      # Luna Park's main entrance (OSM)
PIER_KIOSK = (144.96572, -37.86472)   # St Kilda Pier kiosk (OSM node 310961049)
PALAIS_OSM = "w15477104"              # the Palais Theatre's footprint
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
             "dome": {"color": "#d8a23a", "roughness": 0.4, "metalness": 0.4},
             # the pier kiosk: cream weatherboards, dark green trim, a red iron roof; its windows lit after dark
             "kiosk_wall": {"color": "#eee3c8", "roughness": 0.75, "metalness": 0.0, "emissive": "#fff0d6", "glow": 0.35},
             "kiosk_trim": {"color": "#2f4a36", "roughness": 0.6, "metalness": 0.1},
             "kiosk_roof": {"color": "#a4432e", "roughness": 0.5, "metalness": 0.35},
             "kiosk_win": {"color": "#2a3036", "roughness": 0.2, "metalness": 0.3, "emissive": "#ffd59a", "glow": 0.9},
             "kiosk_iron": {"color": "#2c2f30", "roughness": 0.5, "metalness": 0.6},
             # the Palais: sand-coloured render (the 2017 restoration's), floodlit after dark, zinc domes,
             # bronze-framed glass lit from the foyer, the raised letters lit white
             "palais_wall": {"color": "#d3a35c", "roughness": 0.82, "metalness": 0.0, "emissive": "#ffcf8a", "glow": 0.3},
             "palais_trim": {"color": "#e0b873", "roughness": 0.78, "metalness": 0.0, "emissive": "#ffd9a0", "glow": 0.26},
             "palais_lattice": {"color": "#b78a4c", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffd9a0", "glow": 0.18},
             "palais_glass": {"color": "#2a2d31", "roughness": 0.2, "metalness": 0.4, "emissive": "#ffd29a", "glow": 0.75},
             "palais_frame": {"color": "#33302c", "roughness": 0.5, "metalness": 0.5},
             "palais_zinc": {"color": "#868d93", "roughness": 0.45, "metalness": 0.55},
             "palais_roof": {"color": "#9a9d9e", "roughness": 0.55, "metalness": 0.4},
             "palais_letters": {"color": "#f2e7c9", "roughness": 0.6, "metalness": 0.0, "emissive": "#fff4dd", "glow": 1.1},
             "palais_sign": {"color": "#f4f2ec", "roughness": 0.5, "metalness": 0.0, "emissive": "#ffffff", "glow": 1.2},
             "palais_poster": {"color": "#b8433c", "roughness": 0.4, "metalness": 0.0, "emissive": "#ffb489", "glow": 0.9}}


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
    more, hidden = palais()
    mats = {k: dict(v) for k, v in MATERIALS.items()}
    if PALAIS_GROUND:
        g0 = PALAIS_GROUND[0]
        for k in ("palais_wall", "palais_trim", "palais_lattice"):
            mats[k]["flood"] = [round(g0, 1), round(g0 + 32.0, 1), 0.55, 0.75]
    return mats, list(meshes.values()) + pier_kiosk(scene) + more, {"hidden": hidden}


KIOSK_DECK_M = 2.2  # the piers' deck (game.json pier_deck_m)
KIOSK_DOOR_M = 1.6  # its doors, one in each end (a pair of leaves, from photographs)


def openings_out(m, P, ring, z0, w, h, every):
    """Windows along every side of an anticlockwise ring (ak.rect), on the outside: ak.opening puts its
    panel on the right of a -> b, which is outside when the ring runs anticlockwise."""
    for a, b in zip(ring, ring[1:] + ring[:1]):
        ak.openings_along(m, P, a, b, z0, w, h, every)


def pier_kiosk(scene):
    """The St Kilda Pier kiosk on the pier's end, at its label."""
    x, y = scene["labels"]["St Kilda Pier kiosk"][:2]
    K = ak.Kit("pier_kiosk", floodlit={"kiosk_wall", "kiosk_win"})
    P = ak.Frame(x - 2.0, y, 0.0, KIOSK_DECK_M)
    wall, trim, roof, win, iron = (K[m] for m in ("kiosk_wall", "kiosk_trim", "kiosk_roof", "kiosk_win", "kiosk_iron"))
    L, W = 16.0, 9.0
    hl, hw = L / 2, W / 2
    # the ground floor: weatherboards and tall windows, a door in each end, the verandah's posts round it
    ak.block(wall, P, -hl, hl, -hw, hw, 0.0, 3.8, top=False)
    ring = ak.rect(-hl, hl, -hw, hw)
    for (a, b) in zip(ring, ring[1:] + ring[:1]):  # tall windows along the sides; in each end a door between two windows
        if abs(a[0] - b[0]) < 0.1:
            for c in (hw - 2.4, hw + 2.4):
                ak.opening(win, P, a, b, 0.9, 1.3, 2.2, centre=c)
            ak.opening(win, P, a, b, 0.0, KIOSK_DOOR_M, 2.7, centre=hw, depth=0.08)
        else:
            ak.openings_along(win, P, a, b, 0.9, 1.3, 2.2, 2.4)
    for z in (0.0, 0.8, 3.6):
        ak.band(trim, P, ring, z, out=0.06, h=0.2)
    vo = 2.0  # the verandah's reach
    for u in np.linspace(-hl - vo + 0.2, hl + vo - 0.2, 9):
        for v in (-hw - vo + 0.2, hw + vo - 0.2):
            trim.box(P(u, v, 0.0), P(u, v, 3.6), 0.16, 0.16)
    for v in np.linspace(-hw - vo + 0.2, hw + vo - 0.2, 5)[[1, 3]]:  # (none in front of the doors)
        for u in (-hl - vo + 0.2, hl + vo - 0.2):
            trim.box(P(u, v, 0.0), P(u, v, 3.6), 0.16, 0.16)
    # the verandah's roof, a low hipped skirt of red iron, carrying the upper deck's floor
    o = ak.rect(-hl - vo, hl + vo, -hw - vo, hw + vo)
    for k in range(4):
        a, b = o[k], o[(k + 1) % 4]
        ia, ib = ak.rect(-hl, hl, -hw, hw)[k], ak.rect(-hl, hl, -hw, hw)[(k + 1) % 4]
        roof.quad(P(*a, 3.6), P(*b, 3.6), P(*ib, 4.3), P(*ia, 4.3))
    ak.block(wall, P, -hl, hl, -hw, hw, 4.3, 4.6)
    ak.balustrade(trim, P, [(-hl, -hw), (hl, -hw), (hl, hw), (-hl, hw), (-hl, -hw)], 4.6, h=1.0)
    # the observatory: a room on the deck with windows all round, its hipped roof, the lantern and its vane
    ol, ow = 7.0, 5.0
    ak.block(wall, P, -ol / 2, ol / 2, -ow / 2, ow / 2, 4.6, 7.6, top=False)
    openings_out(win, P, ak.rect(-ol / 2, ol / 2, -ow / 2, ow / 2), 5.3, 1.1, 1.8, 1.7)
    ak.band(trim, P, ak.rect(-ol / 2, ol / 2, -ow / 2, ow / 2), 7.4, out=0.25, h=0.3)
    ak.hip_roof(K, P, ol, ow, 7.6, 2.2, over=0.7, lift=0.0, mat="kiosk_roof", trim="kiosk_trim", sag=0.0)
    ak.block(wall, P, -1.1, 1.1, -1.1, 1.1, 9.4, 10.6, top=False)
    openings_out(win, P, ak.rect(-1.1, 1.1, -1.1, 1.1), 9.6, 0.7, 0.8, 1.0)
    roof.lathe([(KIOSK_DECK_M + 10.6, 1.6), (KIOSK_DECK_M + 12.4, 0.12)], P(0, 0, 0)[:2], segs=4)
    iron.box(P(0, 0, 12.3), P(0, 0, 14.0), 0.08, 0.08)
    iron.box(P(-0.6, 0, 13.6), P(0.6, 0, 13.6), 0.05, 0.25)  # the vane
    # the cast-iron cresting along the verandah roof's ridge line, and finials at its corners
    for (a, b) in zip(ak.rect(-hl, hl, -hw, hw), ak.rect(-hl, hl, -hw, hw)[1:] + ak.rect(-hl, hl, -hw, hw)[:1]):
        iron.box(P(*a, 4.3), P(*b, 4.3), 0.05, 0.05)
    for (u, v) in ak.rect(-hl - vo, hl + vo, -hw - vo, hw + vo):
        iron.box(P(u, v, 3.6), P(u, v, 4.4), 0.1, 0.1)
    return K.out()


PALAIS_GROUND = []  # the front's ground, once palais() has found it (for the floodlight's reach)
PALAIS_TOWER_M, PALAIS_FRONT_DEPTH_M = 7.6, 9.0  # each tower's side; the front block's depth (from the photograph)


def palais():
    """The Palais Theatre on its mapped footprint, facing the Lower Esplanade (the footprint's end nearer
    the water's edge road: its north-north-east end). The frame's u runs out of the front, v to the right
    of someone looking at it, z up from the ground in front of the doors."""
    solids = [q for q in ak.load_solids("melbourne-bayside") if q["osm"] == PALAIS_OSM]
    if not solids:
        return [], []
    sd = max(solids, key=lambda q: abs(ak.ring_area(q["ring"])))
    cx, cy, axis, L, W = ak.oriented(sd["ring"])
    T = ak.Terrain("melbourne-bayside")
    # the front is the short end towards the Esplanade: the end with the higher ground (the beach road's
    # rise), checked against the footprint's two short ends
    a = math.radians(axis)
    ends = [(cx + math.cos(a) * L / 2 * s, cy + math.sin(a) * L / 2 * s, s) for s in (-1, 1)]
    fx, fy, sgn = max(ends, key=lambda e: e[1])  # the north end
    front_deg = axis if sgn > 0 else axis + 180.0
    g0 = T(fx, fy)
    PALAIS_GROUND[:] = [g0]
    P = ak.Frame(fx, fy, front_deg, g0)
    K = ak.Kit("palais", floodlit={"palais_wall", "palais_trim", "palais_lattice", "palais_glass", "palais_letters", "palais_sign", "palais_poster"})
    wall, trim, lat, glass, frm, zinc, roof = (K[m] for m in ("palais_wall", "palais_trim", "palais_lattice", "palais_glass", "palais_frame", "palais_zinc", "palais_roof"))
    hw, tw, D = W / 2, PALAIS_TOWER_M, PALAIS_FRONT_DEPTH_M
    cw = hw - tw  # the central bay's half width
    z_low = min(T(*P(-L, v, 0)[:2]) for v in (-hw, hw)) - g0 - 0.6  # the walls reach down to the lowest ground
    top = lambda v: 23.8 + 1.5 * (1 - (v / cw) ** 2)  # the curved parapet between the towers

    # ---- the auditorium: rendered walls with pilasters, a cornice, and a shallow barrel roof
    ak.block(wall, P, -L, -D, -hw, hw, z_low, 16.5, top=False)
    for v in (-hw, hw):
        for u in np.arange(-D - 4.0, -L + 2.0, -6.5):
            trim.box(P(u, v * 1.012, z_low), P(u, v * 1.012, 16.0), 0.8, 0.45, up=(0, 0, 1))
    ak.band(trim, P, ak.rect(-L, -D, -hw, hw), 15.6, out=0.35, h=0.9)
    ak.band(trim, P, ak.rect(-L, -D, -hw, hw), 4.2, out=0.12, h=0.3)
    n = 14
    arcz = lambda v: 16.5 + 4.0 * (1 - (v / hw) ** 2)
    vs = np.linspace(-hw, hw, n + 1)
    for v0, v1 in zip(vs[:-1], vs[1:]):
        roof.quad(P(-L - 0.3, v0, arcz(v0)), P(-L - 0.3, v1, arcz(v1)), P(-D, v1, arcz(v1)), P(-D, v0, arcz(v0)))
        wall.quad(P(-L, v0, 16.5), P(-L, v1, 16.5), P(-L, v1, arcz(v1)), P(-L, v0, arcz(v0)))  # the back's gable
    for k in range(5):  # exit doors along each side
        u = -D - 8.0 - k * 14.0
        ak.opening(frm, P, (u + 1.0, hw), (u - 1.0, hw), 0.0, 1.8, 2.4, centre=1.0)  # (the outside on the right)
        ak.opening(frm, P, (u - 1.0, -hw), (u + 1.0, -hw), 0.0, 1.8, 2.4, centre=1.0)

    # ---- the towers
    tower_c = []
    for s in (-1, 1):
        v0, v1 = sorted((s * cw, s * hw))
        vc = (v0 + v1) / 2
        tower_c.append(vc)
        ak.block(wall, P, -D, 0.0, v0, v1, z_low, 21.5)
        for e in (v0, v1):  # the corner piers, standing proud of the front and running up to the shoulder
            ee = e + (0.6 if e == v0 else -0.6)
            trim.box(P(0.15, ee, 4.8), P(0.15, ee, 21.2), 1.2, 0.3, up=(0, 0, 1))
        ak.opening(glass, P, (0.0, v0), (0.0, v1), 6.3, 1.0, 13.4, centre=tw / 2, depth=0.04)  # the tall slit window
        side = ((0.0, v1), (-D, v1)) if s > 0 else ((-D, v0), (0.0, v0))  # and on the outer side, outside on the right
        ak.opening(glass, P, *side, 6.3, 1.0, 13.4, centre=D / 2, depth=0.04)
        ak.band(trim, P, ak.rect(-D, 0.0, v0, v1), 21.1, out=0.4, h=0.55)
        ak.band(trim, P, ak.rect(-D, 0.0, v0, v1), 4.6, out=0.15, h=0.45)
        # the upper stage: a square room with an arched window on each face, corner pinnacles, a cornice
        uc, h2 = -tw / 2 + 0.2, 2.7
        ak.block(wall, P, uc - h2, uc + h2, vc - h2, vc + h2, 21.5, 25.8)
        for ring_a, ring_b in zip(ak.rect(uc - h2, uc + h2, vc - h2, vc + h2), ak.rect(uc - h2, uc + h2, vc - h2, vc + h2)[1:] + ak.rect(uc - h2, uc + h2, vc - h2, vc + h2)[:1]):
            ak.opening(glass, P, ring_a, ring_b, 22.3, 1.4, 2.9, arch=True, centre=h2, depth=0.04)
        ak.band(trim, P, ak.rect(uc - h2, uc + h2, vc - h2, vc + h2), 25.4, out=0.35, h=0.45)
        for du in (-1, 1):
            for dv in (-1, 1):
                pu, pv = uc + du * (h2 + 0.55), vc + dv * (h2 + 0.55)
                ak.block(trim, P, pu - 0.4, pu + 0.4, pv - 0.4, pv + 0.4, 21.6, 23.4)
                trim.lathe([(g0 + 23.4, 0.45), (g0 + 23.9, 0.3), (g0 + 24.6, 0.05)], P(pu, pv, 0)[:2], segs=4)
                # the scroll from the pinnacle up the stage's corner (a console in two steps)
                trim.box(P(pu - du * 0.35, pv - dv * 0.35, 23.0), P(uc + du * h2, vc + dv * h2, 24.8), 0.45, 0.45, up=(0, 0, 1))
        # the zinc dome on a short drum, its finial and spire
        cxy = P(uc, vc, 0)[:2]
        zinc.lathe([(g0 + 25.8, 2.75), (g0 + 26.3, 2.75)], cxy, segs=24)
        zinc.lathe([(g0 + 26.3, 2.95), (g0 + 27.3, 2.75), (g0 + 28.1, 2.15), (g0 + 28.7, 1.2), (g0 + 28.95, 0.25)], cxy, segs=24)
        zinc.lathe([(g0 + 28.9, 0.18), (g0 + 30.6, 0.02)], cxy, segs=6)

    # ---- the central bay: the wall under its curved parapet, set back from the towers' fronts
    uf = -0.45
    vs = np.linspace(-cw, cw, 19)
    for v0, v1 in zip(vs[:-1], vs[1:]):
        wall.quad(P(uf, v0, z_low), P(uf, v1, z_low), P(uf, v1, top(v1)), P(uf, v0, top(v0)))
        wall.quad(P(uf, v0, top(v0)), P(uf, v1, top(v1)), P(-D, v1, top(v1)), P(-D, v0, top(v0)))  # the parapet's top
    for v0, v1 in zip(vs[:-1], vs[1:]):  # its coping
        trim.quad(P(uf + 0.25, v0, top(v0) - 0.45), P(uf + 0.25, v1, top(v1) - 0.45), P(uf + 0.25, v1, top(v1)), P(uf + 0.25, v0, top(v0)))
        trim.quad(P(uf + 0.25, v0, top(v0)), P(uf + 0.25, v1, top(v1)), P(uf, v1, top(v1) + 0.02), P(uf, v0, top(v0) + 0.02))
    # the crest over the parapet's crown, its medallion and the flagpole
    ak.block(trim, P, uf - 0.8, uf + 0.35, -2.4, 2.4, top(0) - 0.6, top(0) + 0.5)
    ak.block(trim, P, uf - 0.8, uf + 0.3, -1.2, 1.2, top(0) + 0.5, top(0) + 1.9)
    for k in range(16):  # the medallion: a disc on the crest's face
        a0, a1 = 2 * math.pi * k / 16, 2 * math.pi * (k + 1) / 16
        trim.tri(P(uf + 0.5, 0, top(0) + 1.0), P(uf + 0.5, 0.75 * math.sin(a1), top(0) + 1.0 + 0.75 * math.cos(a1)),
                 P(uf + 0.5, 0.75 * math.sin(a0), top(0) + 1.0 + 0.75 * math.cos(a0)))
    frm.box(P(uf - 0.3, 0, top(0) + 1.9), P(uf - 0.3, 0, top(0) + 8.5), 0.1, 0.1, up=(1, 0, 0))
    # PALAIS THEATRE in raised capitals, following the parapet's curve
    f = jk.font("cinzel", 240)
    f.set_variation_by_name("Bold")
    words = "PALAIS THEATRE"
    span = sum(ak.glyph_outline(c, f)[1] if c != " " else 0.3 for c in words) + 0.05 * (len(words) - 1)
    ak.letters(K["palais_letters"], P, words, f, uf, 0.0, 22.85, min(1.55, 17.2 / span), depth=0.22, spacing=0.05, arc=20.0)
    # the arched recess: lattice panels between pilasters, five tall windows and their roundels
    va = 8.3
    arc_top = lambda v: 20.9 + 1.1 * (1 - (v / va) ** 2)
    vs = np.linspace(-va, va, 17)
    for v0, v1 in zip(vs[:-1], vs[1:]):
        lat.quad(P(uf + 0.03, v0, 9.7), P(uf + 0.03, v1, 9.7), P(uf + 0.03, v1, arc_top(v1)), P(uf + 0.03, v0, arc_top(v0)))
        trim.box(P(uf + 0.12, v0, arc_top(v0) + 0.2), P(uf + 0.12, v1, arc_top(v1) + 0.2), 0.45, 0.3, up=(1, 0, 0))
    for v in (-8.3, -5.4, -1.85, 1.85, 5.4, 8.3):
        trim.box(P(uf + 0.1, v, 9.7), P(uf + 0.1, v, arc_top(v) + 0.2), 0.55, 0.3, up=(1, 0, 0))
    for v, w, z0, z1 in ((0.0, 1.55, 10.9, 19.9), (-3.65, 1.55, 10.9, 19.9), (3.65, 1.55, 10.9, 19.9), (-6.95, 0.85, 9.9, 18.9), (6.95, 0.85, 9.9, 18.9)):
        glass.quad(P(uf + 0.07, v - w / 2, z0), P(uf + 0.07, v + w / 2, z0), P(uf + 0.07, v + w / 2, z1), P(uf + 0.07, v - w / 2, z1))
        for z in np.arange(z0 + 1.0, z1, 1.0):  # glazing bars
            frm.box(P(uf + 0.09, v - w / 2, z), P(uf + 0.09, v + w / 2, z), 0.05, 0.04, up=(1, 0, 0))
        frm.box(P(uf + 0.09, v, z0), P(uf + 0.09, v, z1), 0.05, 0.04, up=(1, 0, 0))
    for v in (-3.65, 0.0, 3.65):
        for k in range(12):
            a0, a1 = 2 * math.pi * k / 12, 2 * math.pi * (k + 1) / 12
            trim.tri(P(uf + 0.12, v, 10.25), P(uf + 0.12, v + 0.42 * math.sin(a1), 10.25 + 0.42 * math.cos(a1)),
                     P(uf + 0.12, v + 0.42 * math.sin(a0), 10.25 + 0.42 * math.cos(a0)))
    # the loggia: a glazed box over the balustrade, three arched bays in its middle
    ul = 0.6
    ak.block(frm, P, uf, ul, -10.0, 10.0, 9.45, 9.7)
    glass.quad(P(ul, -10.0, 6.25), P(ul, 10.0, 6.25), P(ul, 10.0, 9.45), P(ul, -10.0, 9.45))
    for v in (-10.0, 10.0):
        glass.quad(P(uf, v, 6.25), P(ul, v, 6.25), P(ul, v, 9.45), P(uf, v, 9.45))
    for v in np.arange(-10.0, 10.01, 1.0):
        frm.box(P(ul + 0.03, v, 6.25), P(ul + 0.03, v, 9.45), 0.07, 0.06, up=(1, 0, 0))
    frm.box(P(ul + 0.03, -10.0, 7.6), P(ul + 0.03, 10.0, 7.6), 0.07, 0.06, up=(1, 0, 0))
    for vc in (-4.0, 0.0, 4.0):  # the arches' frames, springing at 8.3 m
        pts = [(vc + 2.0 * math.cos(t), 8.3 + 1.1 * math.sin(t)) for t in np.linspace(0, math.pi, 10)]
        for (v0, z0), (v1, z1) in zip(pts[:-1], pts[1:]):
            frm.box(P(ul + 0.05, v0, z0), P(ul + 0.05, v1, z1), 0.16, 0.08, up=(1, 0, 0))
        frm.box(P(ul + 0.05, vc - 2.0, 6.25), P(ul + 0.05, vc - 2.0, 8.3), 0.16, 0.08, up=(1, 0, 0))
    frm.box(P(ul + 0.05, 6.0, 6.25), P(ul + 0.05, 6.0, 8.3), 0.16, 0.08, up=(1, 0, 0))
    # the balustrade across the front, at the loggia's foot
    ak.balustrade(trim, P, [(1.0, -hw + 0.6), (1.0, hw - 0.6)], 5.55, h=0.7)
    ak.block(trim, P, -0.1, 1.15, -hw + 0.4, hw - 0.4, 5.25, 5.55)
    # the cantilevered canopy and its sign band, the small sign over it
    ak.block(frm, P, 0.0, 3.6, -15.2, 15.2, 3.95, 4.75, bottom=True)
    K["palais_sign"].quad(P(3.62, -14.8, 4.05), P(3.62, 14.8, 4.05), P(3.62, 14.8, 4.62), P(3.62, -14.8, 4.62))
    ak.block(frm, P, 0.6, 1.3, -2.9, 2.9, 4.75, 5.3)
    K["palais_sign"].quad(P(1.32, -2.7, 4.82), P(1.32, 2.7, 4.82), P(1.32, 2.7, 5.22), P(1.32, -2.7, 5.22))
    # the doors along the front under the canopy, between piers; a poster case at each end
    for v in (-10.6, -6.2, -2.0, 2.0, 6.2, 10.6):
        ak.block(trim, P, -0.4, 0.35, v - 0.45, v + 0.45, 0.0, 3.95)
    glass.quad(P(-0.38, -10.2, 0.0), P(-0.38, 10.2, 0.0), P(-0.38, 10.2, 3.6), P(-0.38, -10.2, 3.6))
    for v in np.arange(-10.0, 10.01, 1.25):
        frm.box(P(-0.34, v, 0.0), P(-0.34, v, 3.6), 0.06, 0.05, up=(1, 0, 0))
    for s in (-1, 1):
        v0, v1 = sorted((s * 11.6, s * 16.4))
        ak.block(frm, P, 0.0, 0.35, v0, v1, 0.25, 3.7)
        K["palais_poster"].quad(P(0.37, v0 + 0.2, 0.45), P(0.37, v1 - 0.2, 0.45), P(0.37, v1 - 0.2, 3.5), P(0.37, v0 + 0.2, 3.5))
    return K.out(), [q["si"] for q in solids]


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
            # the dome falls from 0.4 m at the centre to 0.1 m at the rim, the rings meeting at r = R/2
            y0, y1 = 0.4 - 0.3 * r0 / R, 0.4 - 0.3 * r1 / R
            q = [P(pa[0] * r0, zc + pa[1] * r0, y0), P(pb[0] * r0, zc + pb[1] * r0, y0), P(pb[0] * r1, zc + pb[1] * r1, y1),
                 P(pa[0] * r1, zc + pa[1] * r1, y1)]
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


def xy(p):
    return [round(float(p[0]), 2), round(float(p[1]), 2)]


def close_to(name, at, z, start, within=1.5, keep=0.0):
    """A thing to walk up to (game.json "close"): `at` on it at the floor's height z, the walk starting
    at `start`; tools/close_step.js must get within `within` m and never nearer than `keep`."""
    return {"name": name, "at": [*xy(at), round(float(z), 2)], "from": xy(start), "within": within, **({"keep": keep} if keep else {})}


def game_extras(scene):
    """The things people come to see up close (game.json "close"): the doors of bathing boxes at both ends
    of the row and in its middle, from the sand in front; Mr Moon's mouth, and on through it into Luna
    Park; and the St Kilda Pier kiosk's door at its landward end, from the pier's deck."""
    lm = scene["landmarks"]
    close = []
    T = ak.Terrain("melbourne-bayside")
    boxes = lm.get("bathing_boxes", [])
    for k in sorted({0, len(boxes) // 2, len(boxes) - 1}) if boxes else ():
        o, f, _ = frame(boxes[k])
        at = o[:2] + f[:2] * boxes[k]["depth_m"] / 2  # the middle of its doors
        close.append(close_to(f"Brighton bathing box {k + 1}, its doors", at, T(*at), at + f[:2] * 5.0, 1.0, 0.1))
    m = lm.get("mr_moon")
    if m:
        c = np.asarray(m["at"], float)
        lp = lm.get("luna_park")
        f = c - np.asarray(lp["centre"], float) if lp else np.array([0.0, 1.0])  # out of the park, as mr_moon() faces him
        f /= np.linalg.norm(f)
        close.append(close_to("Mr Moon, his mouth: Luna Park's way in", c, m["ground_m"], c + f * 5.0, 1.0))
        inside = c - f * 4.0
        close.append(close_to("Luna Park, in through Mr Moon's mouth", inside, T(*inside), c + f * 4.0, 1.0))
    if "St Kilda Pier kiosk" in scene.get("labels", {}):
        x, y = scene["labels"]["St Kilda Pier kiosk"][:2]
        at = np.array([x - 2.0 + 8.0, y])  # pier_kiosk(): 16 m long along x, a door in each end; the shore is to the east
        close.append(close_to("St Kilda Pier kiosk, its door", at, KIOSK_DECK_M, at + np.array([5.0, 0.0]), 1.0, 0.1))
    return {"close": close}
