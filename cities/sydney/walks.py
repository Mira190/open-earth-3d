"""The ways up on foot in Sydney's game: the Bridge Stairs from Cumberland Street to the Harbour Bridge's
walkway, and the Cahill Walk's lift at Circular Quay.

The Bridge Stairs (1932) are part of the bridge's southern approach: a broad flight of concrete steps from
Cumberland Street, just south of the Argyle Cut, between cement-rendered flank walls with a raked string and
panelled piers, up to a covered landing whose round arches look out over The Rocks to the harbour, and from
there onto the walkway on the east side of the Bradfield Highway. They are concrete finished in render, as the
approach's other structures are, not dressed sandstone.

  where      OpenStreetMap (c) OpenStreetMap contributors, ODbL (cities/sydney/bridge_stairs_osm.json): the
             steps way 431130980, 32 steps from Cumberland Street (the node "The Bridge Stairs") west to a turn and
             north onto the walkway (way 39159515); the flight is laid on that line
  levels     the ground's at its foot and at its head (the game's terrain: about 6 m between them, which 32 steps
             of 170 mm would not quite climb: the steps here are as many as that rise needs)
  form       photographs of 1932 (docs/HERO.md lists them): the flight's width against the people standing on it
             (about 4 m), the flank walls' rake and string, the piers' recessed panels, the lamp standards on the
             piers at the head, the landing's arches, its iron railings and its hanging lanterns. The landing's
             plan (two bays by one) and every height not read off those photographs are this model's own

The Cahill Walk runs along the north side of the Cahill Expressway, over Circular Quay Station and on east to
Macquarie Street. Its lift stands at the station's EAST end, at East Circular Quay (OpenStreetMap: the node
highway=elevator at the middle of the building way 1241003116, with the walk's footbridge to it, way 151429617;
cities/sydney/quay_station_osm.json), not at the west end where the game first had it: a glass shaft in a dark
steel frame, a louvred panel high on one face, a flat glass canopy on steel beams over its landing, and a balustrade
of upright steel flats (the photograph docs/HERO.md lists). Built here: the shaft on the mapped building's place,
the landing and its bridge to the walk, and the walk itself from the station's roof east to the lift, a slab
bracketed off the viaduct's north side at the roof's level (east of the lift the real walk goes on to Macquarie
Street: not built). The shaft's size over the walk is read off the photograph; its plan is the mapped building's.

meshes(Mesh, R)   the stairs and the landing; the lift, its bridge and the walk (R: cities/sydney/rail.py layout())
surfaces(R)       the flight as a strip the game walks (and climbs in its check); the walk and the lift's bridge
demolished()      the mapped lift building's solid, which the shaft stands in for
glows()           the light under the lift's canopy and in the stairs' landing after dark
"""
import math
import os

import numpy as np
import shapely
from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
# the Bridge Stairs, from OpenStreetMap: the foot on Cumberland Street, the turn at the landing, the head on the walkway
BS_FOOT, BS_TURN, BS_HEAD = (-418.6, 319.8), (-439.9, 326.4), (-438.6, 330.2)
BS_W = 4.2            # the flight's clear width
BS_WALL = 0.42        # a flank wall's thickness
BS_SET = 3.0          # the first riser, back from the street's edge
BS_LAND = 1.6         # the half-way landing
BS_TREAD = 0.31
BS_BAY, BS_BAYS = 3.3, 2   # the covered landing: bays along the flight's line
BS_ROOM = 3.9         # its ceiling over its floor
BS_PIER = 0.6

MATERIALS = {
    # cement render on concrete, as the approach's walls: one pale warm tone, smooth
    "bs_render": {"color": "#cdc4b1", "roughness": 0.92, "metalness": 0.0, "street_lit": True},
    "bs_step": {"color": "#bcb5a6", "roughness": 0.9, "metalness": 0.0, "street_lit": True},
    "bs_soffit": {"color": "#c4bcaa", "roughness": 0.95, "metalness": 0.0, "solid": False, "emissive": "#ffd8a8", "glow": 0.16},
    "bs_iron": {"color": "#23262a", "roughness": 0.6, "metalness": 0.5},
    "bs_lantern": {"color": "#f4ead2", "roughness": 0.4, "metalness": 0.0, "emissive": "#ffe2b0", "glow": 2.2, "glow_day": 0.25, "solid": False},
}

# the Cahill Walk's lift: the mapped building's middle, its long side (east) and the walk's line past it (OpenStreetMap)
CW_LIFT = (91.0, 66.2)
CW_E = (0.9955, -0.0948)
CW_LINE = ((-67.8, 81.4), (90.5, 62.1))
CW_W = 3.0            # the walk's width
CW_SHAFT = (2.9, 3.1)  # the shaft, along the building's long side and across it
CW_OVER = 3.3         # the shaft's head over the walk
CW_END = 5.5          # the walk runs on this far past the lift's bridge, to a balustrade

MATERIALS.update({
    "cw_steel": {"color": "#2c2f33", "roughness": 0.5, "metalness": 0.6},
    "cw_glass": {"color": "#a9c6c8", "roughness": 0.06, "metalness": 0.3, "opacity": 0.3},
    "cw_louvre": {"color": "#4b4f52", "roughness": 0.6, "metalness": 0.4, "solid": False},
    "cw_walk": {"color": "#6a6c6e", "roughness": 0.92, "metalness": 0.0, "street_lit": True},          # asphalt, as the walk's
    "cw_concrete": {"color": "#b3aea3", "roughness": 0.9, "metalness": 0.0},
    "cw_railing": {"color": "#4a443c", "roughness": 0.6, "metalness": 0.5, "pattern": "railing", "bar_m": 0.11, "rails_m": [0.06, 1.2]},
    "cw_car": {"color": "#d8d4c8", "roughness": 0.5, "metalness": 0.2, "emissive": "#ffe9c4", "glow": 0.9, "glow_day": 0.1, "solid": False},
    "cw_light": {"color": "#f4efe2", "roughness": 0.4, "metalness": 0.0, "emissive": "#fff0d2", "glow": 2.4, "glow_day": 0.2, "solid": False},
})

_S = {}


def layout():
    """The stairs' frame and levels, worked out once: {o (the foot), d (up the flight), n (to its left), z0, z1, n_risers,
    riser, u (where along d each part starts)}."""
    if "L" in _S:
        return _S["L"]
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), "pipeline"))
    import archkit as ak
    T = ak.Terrain("sydney")
    o, turn = np.array(BS_FOOT), np.array(BS_TURN)
    d = (turn - o) / np.linalg.norm(turn - o)
    n = np.array([-d[1], d[0]])
    run = float(np.linalg.norm(turn - o))
    hall = BS_BAY * BS_BAYS
    u_hall = run - 0.3 - hall                      # the covered landing's east edge: its back wall at the turn, where the bank behind it begins
    z0 = float(T(*(o + d * BS_SET)))
    # the landing's floor: over the ground everywhere under it, and no lower than the walkway it opens onto
    under = [float(T(*(o + d * u + n * v))) for u in np.linspace(u_hall, u_hall + hall, 7) for v in (-BS_W / 2, 0.0, BS_W / 2)]
    z1 = round(max(max(under), float(T(*BS_HEAD))) + 0.06, 2)
    going = u_hall - BS_SET - BS_LAND
    n_r = int(math.ceil((z1 - z0) / 0.172 / 2)) * 2   # risers of 172 mm at most, an even number: two equal flights
    tread = going / n_r
    riser = (z1 - z0) / n_r
    L = {"T": T, "o": o, "d": d, "n": n, "z0": z0, "z1": z1, "n_risers": n_r, "riser": riser, "tread": tread, "u_hall": u_hall, "hall": hall}
    _S["L"] = L
    return L


def _exit(L):
    """The covered landing's way out to the walkway: {c (its middle, on the side wall's outer face), out (the way out),
    w (its width), drop (down to the ground a pace out), steps, run}."""
    o, d, n = L["o"], L["d"], L["n"]
    mid = o + d * (L["u_hall"] + L["hall"] / 2)
    side = 1.0 if float(np.dot(np.array(BS_HEAD) - mid, n)) > 0 else -1.0
    c = o + d * (L["u_hall"] + BS_BAY * (BS_BAYS - 0.5)) + n * side * (BS_W / 2 + BS_WALL)
    k = 0
    while True:   # as many steps of 170 mm as the ground at their foot is below the landing
        run = 0.32 * k
        drop = L["z1"] - float(L["T"](*(c + n * side * (run + 0.5))))
        if drop <= 0.17 * (k + 1) or k > 14:
            break
        k += 1
    return {"c": c, "out": n * side, "side": side, "w": BS_BAY - BS_PIER, "drop": max(0.0, drop), "steps": k, "run": 0.32 * k}


def _zat(L, u):
    """The flight's level at u metres from the street's edge (the nosing line: the tread a walker stands on)."""
    half = L["n_risers"] // 2
    a0, a1 = BS_SET, BS_SET + half * L["tread"]
    b0 = a1 + BS_LAND
    if u <= a0:
        return L["z0"]
    if u < a1:
        return L["z0"] + (u - a0) / L["tread"] * L["riser"]
    if u <= b0:
        return L["z0"] + half * L["riser"]
    if u < L["u_hall"]:
        return L["z0"] + (half + (u - b0) / L["tread"]) * L["riser"]
    return L["z1"]


def _arch_wall(m, P, a, b, zb, zt, arches, thick, uv0=0.0):
    """A wall from a to b (plan), zb to zt, `thick` thick about that line, with round-headed openings cut through it:
    arches [(centre along, width, sill z, springing z)]. Both faces, the openings' reveals and the wall's top."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    ln = float(np.linalg.norm(b - a))
    t = (b - a) / ln
    nr = np.array([t[1], -t[0]])
    face = Polygon([(0, zb), (ln, zb), (ln, zt), (0, zt)])
    for c, w, zs, zp in arches:
        r = w / 2
        ring = [(c - r, zs), (c + r, zs)] + [(c + r * math.cos(q), zp + r * math.sin(q)) for q in np.linspace(0, math.pi, 13)] + [(c - r, zs)]
        face = face.difference(Polygon(ring).buffer(0))
        # the reveal: the opening's jambs and the arch's soffit
        pts = [(c - r, zs)] + [(c + r * math.cos(q), zp + r * math.sin(q)) for q in np.linspace(math.pi, 0, 13)] + [(c + r, zs)]
        for (s0, e0), (s1, e1) in zip(pts, pts[1:]):
            p0, p1 = a + t * s0, a + t * s1
            m.quad([*(p0 + nr * thick / 2), e0], [*(p0 - nr * thick / 2), e0], [*(p1 - nr * thick / 2), e1], [*(p1 + nr * thick / 2), e1])
    for g in getattr(face, "geoms", [face]):
        for tri in shapely.constrained_delaunay_triangles(g).geoms:
            q = list(tri.exterior.coords)[:3]
            for sgn in (1, -1):
                pts = [[*(a + t * s + nr * sgn * thick / 2), e] for s, e in (q if sgn > 0 else q[::-1])]
                m.tri(*pts, [[uv0 + s, e] for s, e in (q if sgn > 0 else q[::-1])])
    m.quad([*(a + nr * thick / 2), zt], [*(b + nr * thick / 2), zt], [*(b - nr * thick / 2), zt], [*(a - nr * thick / 2), zt])
    for p in (a, b):   # its two ends
        m.quad([*(p - nr * thick / 2), zb], [*(p + nr * thick / 2), zb], [*(p + nr * thick / 2), zt], [*(p - nr * thick / 2), zt])


def cahill(R):
    """The lift's and the walk's frame: {c (the shaft's middle), e (east along the building), f (north), a, b (the walk's
    line from the station's roof to its east end), t, n (along it, and to its north), z (the walk's level), g (the
    ground at the lift), door_n, door_s (the shaft's faces: the way in at the quay, the way out at the walk)}."""
    e = np.array(CW_E) / np.linalg.norm(CW_E)
    f = np.array([-e[1], e[0]])
    c = np.array(CW_LIFT) + f * 0.25
    p0, p1 = np.array(CW_LINE[0]), np.array(CW_LINE[1])
    t = (p1 - p0) / np.linalg.norm(p1 - p0)
    n = np.array([-t[1], t[0]])
    if n[1] < 0:
        n = -n
    # from a metre inside the station's roof (the box's east end) to past the lift's bridge
    box_e = max(x for x, _y in R["box"].exterior.coords)
    a = p0 + t * ((box_e - 1.5 - p0[0]) / t[0])
    b = p0 + t * (float(np.dot(c - p0, t)) + CW_END)
    return {"c": c, "e": e, "f": f, "a": a, "b": b, "t": t, "n": n, "z": float(R["roof_z"]), "g": float(R["T"](*CW_LIFT)),
            "door_n": c + f * CW_SHAFT[1] / 2, "door_s": c - f * CW_SHAFT[1] / 2}


def cahill_meshes(Mesh, R):
    """The Cahill Walk's lift, its bridge and the walk east of the station's roof."""
    C = cahill(R)
    c, e, f, a, b, t, n, z, g = (C[k] for k in ("c", "e", "f", "a", "b", "t", "n", "z", "g"))
    steel, glass, louvre = Mesh("cw_steel", "cw_steel", False), Mesh("cw_glass", "cw_glass", False), Mesh("cw_louvre", "cw_louvre", False)
    walk, conc, rail_ = Mesh("cw_walk", "cw_walk", False), Mesh("cw_concrete", "cw_concrete", False), Mesh("cw_railing", "cw_railing", False, uv=True)
    car, light = Mesh("cw_car", "cw_car", False), Mesh("cw_light", "cw_light", False)
    he, hf = CW_SHAFT[0] / 2, CW_SHAFT[1] / 2
    Q = lambda u, v, zz: [*(c + e * u + f * v), zz]
    top = z + CW_OVER
    # ---- the shaft: four posts, transoms at the walk's floor, its door head and the shaft's head, glass between them
    for su in (-1, 1):
        for sv in (-1, 1):
            steel.box(Q(su * he, sv * hf, g - 0.2), Q(su * he, sv * hf, top), 0.16, 0.16, up=(*e, 0))
    levels = [g + 0.05, g + 2.6, g + 5.6, g + 8.6, g + 11.6, z - 0.25, z + 2.45, top]
    faces = [((-he, -hf), (he, -hf)), ((he, -hf), (he, hf)), ((he, hf), (-he, hf)), ((-he, hf), (-he, -hf))]   # south, east, north, west
    for k, (p, q) in enumerate(faces):
        for zz in levels:
            steel.box(Q(*p, zz), Q(*q, zz), 0.1, 0.12)
        mid = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        steel.box(Q(*mid, g + 2.6 if k == 2 else g + 0.05), Q(*mid, z - 0.25 if k == 0 else top), 0.05, 0.08, up=(*e, 0))   # a mullion (not across a doorway)
        for z0, z1 in zip(levels, levels[1:]):
            if (k == 2 and z0 < g + 1) or (k == 0 and abs(z0 - (z - 0.25)) < 0.01):
                continue   # the doorways: north at the quay, south at the walk
            if k == 1 and z0 > z:   # the louvred panel, high on the east face
                for zz in np.arange(z0 + 0.12, z1 - 0.05, 0.14):
                    louvre.box(Q(p[0] + 0.02, p[1] + 0.25, zz), Q(q[0] + 0.02, q[1] - 0.25, zz + 0.05), 0.11, 0.02)
                continue
            glass.quad(Q(*p, z0 + 0.06), Q(*q, z0 + 0.06), Q(*q, z1 - 0.06), Q(*p, z1 - 0.06))
    glass.quad(Q(-he, -hf, top), Q(he, -hf, top), Q(he, hf, top), Q(-he, hf, top))
    # the doorways' frames, and the car waiting at the walk
    for sv, zz in ((1, g + 0.05), (-1, z)):
        for su in (-0.75, 0.75):
            steel.box(Q(su, sv * hf, zz), Q(su, sv * hf, zz + 2.3), 0.08, 0.14, up=(*e, 0))
        steel.box(Q(-0.75, sv * hf, zz + 2.3), Q(0.75, sv * hf, zz + 2.3), 0.14, 0.1)
    car.box(Q(0, 0, z + 0.04), Q(0, 0, z + 2.3), 1.9, 2.0, up=(*e, 0))
    # ---- the landing's bridge from the shaft to the walk, and the canopy over it: glass on two steel beams
    s_walk = float(np.dot(c - a, t))                        # where along the walk the bridge meets it
    m_w = a + t * s_walk                                    # the walk's middle there
    edge = m_w + n * CW_W / 2                               # its north edge
    d_br = float(np.linalg.norm(C["door_s"] - edge))
    bw = 2.6
    j = (C["door_s"] + edge) / 2
    walk.box([*j, z - 0.14], [*j, z], bw, d_br + 0.1, up=(*((C["door_s"] - edge) / d_br), 0))
    conc.box([*j, z - 0.42], [*j, z - 0.14], bw, d_br + 0.1, up=(*((C["door_s"] - edge) / d_br), 0))
    for su in (-1, 1):
        rail_.panel([[*(edge + t * su * bw / 2), z], [*(C["door_s"] + e * su * bw / 2), z]], 1.25)
        steel.box(Q(su * 1.2, -hf, z + 2.75), Q(su * 1.2, -hf - d_br - 1.6, z + 2.6), 0.1, 0.22)
    glass.quad(Q(-1.75, -hf + 0.3, z + 2.95), Q(1.75, -hf + 0.3, z + 2.95), Q(1.75, -hf - d_br - 1.9, z + 2.78), Q(-1.75, -hf - d_br - 1.9, z + 2.78))
    light.box(Q(-0.9, -hf - 0.5, z + 2.55), Q(0.9, -hf - 0.5, z + 2.55), 0.12, 0.05)
    # ---- the walk: a slab bracketed off the viaduct's north side, asphalt on it, a balustrade either side
    ln = float(np.linalg.norm(b - a))
    hw = CW_W / 2
    walk.quad([*(a - n * hw), z], [*(b - n * hw), z], [*(b + n * hw), z], [*(a + n * hw), z])
    conc.box([*a, z - 0.16], [*b, z - 0.16], CW_W + 0.3, 0.3)                          # the slab
    conc.box([*(a + n * (hw + 0.05)), z - 0.42], [*(b + n * (hw + 0.05)), z - 0.42], 0.3, 0.5)   # its edge beam
    deck_e = max(x for x, _y in R["deck"].exterior.coords)
    for s in np.arange(4.0, ln - 1.0, 6.0):
        p = a + t * s
        if p[0] < deck_e - 1.0:   # a bracket back to the viaduct
            steel.box([*(p - n * (hw + 3.0)), z - 1.5], [*(p + n * hw), z - 0.45], 0.2, 0.3)
        else:                    # past the viaduct's end: a column
            steel.box([*p, R["T"](*p) - 0.3], [*p, z - 0.3], 0.32, 0.32, up=(*t, 0))
    north = [[*(a + n * hw), z]]
    for s0, s1 in ((0.0, s_walk - bw / 2), (s_walk + bw / 2, ln)):                     # the north side, open at the bridge
        rail_.panel([[*(a + t * s0 + n * hw), z], [*(a + t * s1 + n * hw), z]], 1.25)
    rail_.panel([[*(a - n * hw), z], [*(b - n * hw), z]], 1.25)
    rail_.panel([[*(b - n * hw), z], [*(b + n * hw), z]], 1.25)                         # and its end
    del north
    for m in (steel, conc):
        m.weld()
    return [steel, glass, louvre, walk, conc, rail_, car, light]


def cahill_surfaces(R):
    """The walk east of the station's roof, and the lift's bridge onto it."""
    C = cahill(R)
    a, b, t, z = C["a"], C["b"], C["t"], C["z"]
    ln = float(np.linalg.norm(b - a))
    m = (a + b) / 2
    s_walk = float(np.dot(C["c"] - a, t))
    edge = a + t * s_walk + C["n"] * CW_W / 2
    d_br = float(np.linalg.norm(C["door_s"] - edge))
    j = (C["door_s"] + edge) / 2
    ax = (C["door_s"] - edge) / d_br
    return [{"name": "The Cahill Walk, east of Circular Quay Station", "type": "strip", "origin": [round(float(m[0]), 2), round(float(m[1]), 2)],
             "axis": [round(float(t[0]), 5), round(float(t[1]), 5)], "half_width": round(CW_W / 2 - 0.1, 2),
             "profile": [[round(-ln / 2, 2), z], [round(ln / 2 - 0.2, 2), z]], "thickness": 0.45, "mesh": "cw_walk", "mapped": False, "label": "the Cahill Walk"},
            {"name": "The Cahill Walk, the lift's landing", "type": "strip", "origin": [round(float(j[0]), 2), round(float(j[1]), 2)],
             "axis": [round(float(ax[0]), 5), round(float(ax[1]), 5)], "half_width": 1.2,
             "profile": [[round(-d_br / 2 - 0.4, 2), z], [round(d_br / 2, 2), z]], "thickness": 0.45, "mesh": "cw_walk", "mapped": False, "label": "the Cahill Walk"}]


def lift_stops(R):
    """Where the Cahill Walk's lift lets you out (city.json game.lifts "cahill-walk" stops): on the quay before its
    north door, and on its bridge at the walk."""
    C = cahill(R)
    lo, hi = C["door_n"] + C["f"] * 1.6, C["door_s"] - C["f"] * 1.3
    R2 = lambda v: [round(float(q), 2) for q in v]
    return [{"name": "East Circular Quay, by the station", "at": [*R2(lo), round(float(R["T"](*lo)), 2)], "face": R2(C["f"])},
            {"name": "the Cahill Walk", "at": [*R2(hi), round(C["z"], 2)], "face": R2(-C["f"])}]


def demolished():
    """The mapped lift building's solid (OpenStreetMap way 1241003116), which the shaft stands in for."""
    import archkit as ak
    from shapely.geometry import Point
    return [q["si"] for q in ak.load_solids("sydney") if len(q["ring"]) > 2 and q["top"] - q["ground"] < 6
            and Polygon(q["ring"]).buffer(0).contains(Point(*CW_LIFT))]


def glows(R):
    """The light under the lift's canopy and in the Bridge Stairs' landing after dark (landmarks.json "glows")."""
    C, L = cahill(R), layout()
    p = C["door_s"] - C["f"] * 1.2
    q = L["o"] + L["d"] * (L["u_hall"] + L["hall"] / 2)
    return [[round(float(p[0]), 1), round(float(p[1]), 1), 6.0, "#fff0d2", 0.5], [round(float(q[0]), 1), round(float(q[1]), 1), 7.0, "#ffe2b0", 0.5]]


def meshes(Mesh, R=None):
    """(materials, meshes): the Bridge Stairs, and with the station's layout R the Cahill Walk's lift and walk."""
    L = layout()
    T, o, d, n, z0, z1 = L["T"], L["o"], L["d"], L["n"], L["z0"], L["z1"]
    P = lambda u, v, z: [*(o + d * u + n * v), z]
    render = Mesh("bs_render", "bs_render", False)
    steps = Mesh("bs_steps", "bs_step", False)          # walked as the strip (surfaces)
    soffit = Mesh("bs_soffit", "bs_soffit", False)
    iron = Mesh("bs_iron", "bs_iron", False)
    lantern = Mesh("bs_lantern", "bs_lantern", False)
    soffit.sky, soffit.bounce = 0.35, "#bcb5a6"
    hw, half = BS_W / 2, L["n_risers"] // 2
    # ---- the treads and risers of the two flights, the half-way landing and the covered landing's floor
    u, z = BS_SET, z0
    for flight in range(2):
        for _k in range(half):
            steps.quad(P(u, -hw, z), P(u, hw, z), P(u, hw, z + L["riser"]), P(u, -hw, z + L["riser"]))                              # the riser
            steps.quad(P(u, -hw, z + L["riser"]), P(u, hw, z + L["riser"]), P(u + L["tread"], hw, z + L["riser"]), P(u + L["tread"], -hw, z + L["riser"]))
            u, z = u + L["tread"], z + L["riser"]
        if flight == 0:
            steps.quad(P(u, -hw, z), P(u, hw, z), P(u + BS_LAND, hw, z), P(u + BS_LAND, -hw, z))
            u += BS_LAND
    uh, hall = L["u_hall"], L["hall"]
    steps.quad(P(uh, -hw - 0.1, z1), P(uh, hw + 0.1, z1), P(uh + hall, hw + 0.1, z1), P(uh + hall, -hw - 0.1, z1))
    # ---- the flank walls: from the ground up to a rake a metre over the nosings, level along the landing; a string
    # along the rake on the outer face, a panelled pier at the foot and one at the head with its lamp standard
    us = [BS_SET - 0.9, BS_SET] + [BS_SET + half * L["tread"], BS_SET + half * L["tread"] + BS_LAND, uh]
    top = lambda u_: _zat(L, max(u_, BS_SET)) + 1.05
    for sgn in (-1, 1):
        vi, vo = sgn * hw, sgn * (hw + BS_WALL)
        for ua, ub in zip(us, us[1:]):
            g_a, g_b = float(T(*(o + d * ua + n * vo))) - 0.4, float(T(*(o + d * ub + n * vo))) - 0.4
            for v_, flip in ((vo, sgn > 0), (vi, sgn < 0)):   # the outer face, the inner
                q = [P(ua, v_, g_a if v_ == vo else _zat(L, ua) - 0.3), P(ub, v_, g_b if v_ == vo else _zat(L, ub) - 0.3), P(ub, v_, top(ub)), P(ua, v_, top(ua))]
                render.quad(*(q if flip else q[::-1]))
            render.quad(P(ua, vi, top(ua)), P(ub, vi, top(ub)), P(ub, vo, top(ub)), P(ua, vo, top(ua))) if sgn > 0 else \
                render.quad(P(ua, vo, top(ua)), P(ub, vo, top(ub)), P(ub, vi, top(ub)), P(ua, vi, top(ua)))
            # the coping, proud of both faces, and the string 0.45 m under it on the outer face
            render.box(P(ua, (vi + vo) / 2, top(ua) + 0.06), P(ub, (vi + vo) / 2, top(ub) + 0.06), BS_WALL + 0.12, 0.12)
            render.box(P(ua, vo + sgn * 0.03, top(ua) - 0.45), P(ub, vo + sgn * 0.03, top(ub) - 0.45), 0.06, 0.14)
        for up_, h in ((BS_SET - 0.9, 1.55), (uh - 0.05, 1.75)):   # the piers: a plinth, a shaft with a sunk panel, a cap
            c = np.array(P(up_, sgn * (hw + BS_WALL / 2), 0.0)[:2])
            zb, zt = float(T(*c)) - 0.4, top(up_) + (h - 1.05)
            render.box([*c, zb], [*c, zt], 0.84, 0.84, up=(*d, 0))
            render.box([*c, zt], [*c, zt + 0.14], 1.0, 1.0, up=(*d, 0))
            render.box([*c, zt + 0.14], [*c, zt + 0.24], 0.72, 0.72, up=(*d, 0))
            fo = np.array(P(up_ - 0.425, sgn * (hw + BS_WALL / 2), 0.0)[:2])   # (the face that looks down the flight)
            render.box([*fo, zt - 1.05], [*fo, zt - 0.2], 0.46, 0.03, up=(*d, 0))
            if up_ > BS_SET:   # the lamp standard: a fluted column, a collar and a lantern
                iron.lathe([(zt + 0.24, 0.16), (zt + 0.5, 0.11), (zt + 0.6, 0.08), (zt + 2.5, 0.06), (zt + 2.58, 0.13), (zt + 2.64, 0.13), (zt + 2.7, 0.05)], tuple(c), segs=10)
                lantern.lathe([(zt + 2.7, 0.12), (zt + 2.82, 0.2), (zt + 3.12, 0.2), (zt + 3.2, 0.12)], tuple(c), segs=10)
                iron.lathe([(zt + 3.2, 0.22), (zt + 3.3, 0.14), (zt + 3.42, 0.03)], tuple(c), segs=10)
        # a handrail on the inner face
        iron.tube([P(u_, sgn * (hw - 0.08), _zat(L, u_) + 0.92) for u_ in np.linspace(BS_SET, uh, 30)], 0.022, 6)
    # ---- the covered landing: piers and round arches on both long sides and at the flight's end, a wall at the
    # back, the ceiling and the roof with its cornice; iron railings in the arches that are not ways through
    zc = z1 + BS_ROOM
    spring = z1 + 2.15
    back, front = uh + hall, uh
    vw = hw + BS_WALL / 2      # the side walls' line
    exit_bay = BS_BAYS - 1     # the way out onto the walkway: the bay nearest the turn, on the side the head is on
    side_out = _exit(L)["side"]
    for sgn in (-1, 1):
        a, b = o + d * front + n * sgn * vw, o + d * back + n * sgn * vw
        arches = []
        for k in range(BS_BAYS):
            way = sgn == side_out and k == exit_bay
            arches.append((BS_BAY * (k + 0.5), BS_BAY - BS_PIER, z1 if way else z1 + 0.25, spring))
            if not way:   # the railing: a top rail, a bottom rail and square bars, crossed in every fourth panel
                p0, p1 = o + d * (front + BS_BAY * k + BS_PIER / 2) + n * sgn * vw, o + d * (front + BS_BAY * (k + 1) - BS_PIER / 2) + n * sgn * vw
                for zz in (z1 + 0.33, z1 + 1.13):
                    iron.box([*p0, zz], [*p1, zz], 0.05, 0.04)
                nb = int(np.linalg.norm(p1 - p0) / 0.13)
                for j in range(1, nb):
                    q = p0 + (p1 - p0) * j / nb
                    iron.box([*q, z1 + 0.33], [*q, z1 + 1.13], 0.018, 0.018)
        g = min(float(T(*a)), float(T(*b))) - 0.4
        _arch_wall(render, P, a, b, g, zc, arches, BS_WALL)
    a, b = o + d * front + n * (-vw - BS_WALL / 2), o + d * front + n * (vw + BS_WALL / 2)     # the flight's end: one wide arch
    _arch_wall(render, P, a, b, z1, zc, [(vw + BS_WALL / 2, BS_W - 0.5, z1, spring - 0.1)], BS_WALL)
    a, b = o + d * back + n * (-vw - BS_WALL / 2), o + d * back + n * (vw + BS_WALL / 2)       # the back: a wall, with a blind arch's reveal
    g = min(float(T(*a)), float(T(*b))) - 0.4
    _arch_wall(render, P, a, b, g, zc, [], BS_WALL)
    render.box(P(back - BS_WALL / 2 - 0.03, 0, spring + 0.4), P(back - BS_WALL / 2 - 0.03, 0, spring + 0.52), 2.6, 0.06, up=(*d, 0))
    # the ceiling, the roof slab and its cornice
    e = vw + BS_WALL / 2
    soffit.quad(P(front, e, zc), P(back, e, zc), P(back, -e, zc), P(front, -e, zc))
    render.box(P((front + back) / 2, 0, zc), P((front + back) / 2, 0, zc + 0.34), 2 * e + 0.5, hall + BS_WALL + 0.5, up=(*d, 0))
    render.box(P((front + back) / 2, 0, zc + 0.34), P((front + back) / 2, 0, zc + 0.5), 2 * e + 0.2, hall + BS_WALL + 0.2, up=(*d, 0))
    for k in range(BS_BAYS):   # a lantern hung in each bay
        c = P(front + BS_BAY * (k + 0.5), 0, zc)
        iron.box(c, [c[0], c[1], zc - 0.5], 0.03, 0.03)
        lantern.lathe([(zc - 0.92, 0.1), (zc - 0.86, 0.17), (zc - 0.56, 0.17), (zc - 0.5, 0.1)], tuple(c[:2]), segs=8)
        iron.lathe([(zc - 0.5, 0.2), (zc - 0.44, 0.06)], tuple(c[:2]), segs=8)
    # steps down from the landing's way out to the walkway's ground, where that is lower (walked: surfaces())
    X = _exit(L)
    for k in range(X["steps"]):
        zz = z1 - (k + 1) * X["drop"] / (X["steps"] + 1)
        q = X["c"] + X["out"] * (0.16 + 0.32 * k)
        steps.box([*q, zz - 0.6], [*q, zz], X["w"], 0.32, up=(*n, 0))
    for m in (render, steps):
        m.weld()
    return MATERIALS, [render, steps, soffit, iron, lantern] + (cahill_meshes(Mesh, R) if R else [])


def surfaces(R=None):
    """The flight, walked: a strip from the covered landing's back wall down to the street; and the Cahill Walk."""
    L = layout()
    o, d = L["o"], L["d"]
    c = o + d * L["u_hall"]            # the head of the upper flight
    half = L["n_risers"] // 2
    r = half * L["tread"]
    zm = L["z0"] + half * L["riser"]
    prof = [[-(L["hall"] - 0.3), L["z1"]], [0.0, L["z1"]], [round(r, 2), round(zm, 2)], [round(r + BS_LAND, 2), round(zm, 2)],
            [round(2 * r + BS_LAND, 2), round(L["z0"], 2)], [round(2 * r + BS_LAND + 0.8, 2), round(L["z0"], 2)]]
    return [{"name": "The Bridge Stairs, Cumberland Street", "type": "strip", "origin": [round(float(c[0]), 2), round(float(c[1]), 2)],
             "axis": [round(float(-d[0]), 5), round(float(-d[1]), 5)], "half_width": BS_W / 2, "profile": prof, "thickness": 1.0,
             "mesh": "bs_steps", "mapped": False, "check": True, "drape": True, "label": "the Bridge Stairs"}] + _exit_strip(L) + (cahill_surfaces(R) if R else [])


def _exit_strip(L):
    """The few steps from the covered landing's way out down to the walkway's ground, as a strip."""
    X = _exit(L)
    if not X["steps"]:
        return []
    c, out = X["c"], X["out"]
    zg = L["z1"] - X["drop"]
    return [{"name": "The Bridge Stairs, the steps to the walkway", "type": "strip", "origin": [round(float(c[0]), 2), round(float(c[1]), 2)],
             "axis": [round(float(out[0]), 5), round(float(out[1]), 5)], "half_width": round(X["w"] / 2 - 0.1, 2),
             "profile": [[-1.0, L["z1"]], [0.0, L["z1"]], [round(X["run"] + 0.32, 2), round(zg, 2)], [round(X["run"] + 1.0, 2), round(zg, 2)]],
             "thickness": 0.8, "mesh": "bs_steps", "mapped": False, "label": "the Bridge Stairs"}]


def walkway_hop(deck):
    """The stops of the way on from the Bridge Stairs to the Harbour Bridge's footway (city.json game.lifts
    "bridge-stairs"): the walkway at the stairs' head, and the deck's east footway near its south end. The real
    walkway runs between them beside the highway, over the Argyle Cut; the model's approach comes down to the ground
    at 5 %, five metres under the real highway there, so that stretch is not built and the game carries you along it.
    deck: the game's "Sydney Harbour Bridge deck" strip."""
    L = layout()
    X = _exit(L)
    lo = X["c"] + X["out"] * (X["run"] + 1.6)
    m, ax = np.array(deck["origin"]), np.array(deck["axis"])
    lat = np.array([ax[1], -ax[0]])
    u = deck["profile"][0][0] + 16.0
    us, zs = [q[0] for q in deck["profile"]], [q[1] for q in deck["profile"]]
    hi = m + ax * u + lat * (deck["half_width"] - 3.0)
    R2 = lambda v: [round(float(q), 2) for q in v]
    return [{"name": "the Bridge Stairs, Cumberland Street", "at": [*R2(lo), round(float(L["T"](*lo)), 2)], "face": R2(-X["out"])},
            {"name": "the Harbour Bridge footway", "at": [*R2(hi), round(float(np.interp(u, us, zs)), 2)], "face": R2(ax)}]
