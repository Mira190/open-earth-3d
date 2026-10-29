"""Sydney: what the generic pipeline cannot know from open data.

Building adjustments (called by pipeline/build_scene.py):
  * Sydney Opera House: the outline becomes the upper podium the halls stand on; the
    Monumental Steps climb from the forecourt to a lower landing, and a flight from there to
    the podium in front of each hall. The shells are parametric, on the ridges OSM maps for
    the roof.
  * Harbour Bridge pylons: OSM maps each abutment base to the full 89 m, but the deck
    passes through them, so the base stops at the deck and the towers start there.

Parametric landmarks (called by pipeline/landmarks.py), placed with anchors measured
from the data:
  Sydney Opera House  every shell is cut from a sphere of radius 75.2 m (Utzon's
                      "spherical solution"): two spherical triangles, mirror images that
                      meet along the shell's ridge, each with its ribs fanning out from the
                      pedestal where the leg of the shell's arch stands. OSM maps the roof in
                      detail, traced from aerial imagery, with a maintenance walkway along
                      every ridge; those walkways place the shells: four over the Concert
                      Hall on a ridge line 124 m long, four over the Joan Sutherland Theatre,
                      turned 22 degrees from it, and the restaurant's two, back to back.
                      Each hall's first shell faces the forecourt and stands back to back with
                      the next; the rest face the harbour, each nested in the mouth of the one
                      behind it. Where each shell's pedestals stand, and how wide it spans, is
                      measured on the NSW aerial photo from the outline of the OSM roof parts.
                      The highest shell stands 67 m above sea level (Wikipedia), over the
                      Concert Hall; the Joan Sutherland Theatre's tallest, 61 m, was measured
                      with the NSW LiDAR point cloud by flatcad.com ("Are the Sydney Opera
                      House shells really cut from one sphere?", 2026), which also fits
                      spheres of 75.2 m to them. The other tips, how high the back-to-back
                      shells meet, and the side shells on the flanks between them, with glass
                      under them, are taken from a photograph of the Concert Hall side on
                      (Wikimedia Commons, "Sydney Opera House Sails.jpg"): an approximation,
                      not survey data.
                      The shells carry "a subtle chevron pattern composed of 1,056,006
                      tiles in two colours: glossy white and matte cream", laid in sheets
                      on the ground (Wikipedia, Sydney Opera House, revision 1382109423);
                      the pattern's lid size here is an approximation. The glass walls are
                      topaz glass on bronze mullions, hung from the shells in pleats; the
                      podium and the steps are clad in pink granite aggregate from Tarana
                      (Wikipedia).
                      The Monumental Steps are "nearly 100 m wide and two storeys high"
                      (UNESCO). Measured on the NSW aerial photo, they are 85 m wide and climb
                      in three flights of 0.39 m treads, between landings 1.6 m deep, from the
                      forecourt to the landing 17.6 m in; the flights up to the halls are 11.6 m
                      deep. The 15 cm riser is assumed, which puts the landing 10.1 m above sea
                      level and the podium 14.4 m, close to the podium's height in the
                      photograph. A forecourt apron ramps up to the first tread where the 5 m
                      DEM dips at the foot (the vehicle concourse runs in under the forecourt),
                      which would leave the first riser a wall.
  Harbour Bridge      arch span 503 m between bearings, crown 134 m above sea level,
                      28 panels, trusses 30 m apart, deck 49 m wide with 49 m
                      clearance; alignment from the two pylon footprints in OSM. The deck
                      carries, west to east, the cycleway, the North Shore railway, the six
                      original lanes, lanes 7 and 8 (the former tram tracks) and the
                      footway (Wikipedia, Sydney Harbour Bridge, revision 1381717237); the
                      widths of those strips are approximations that add up to 48.8 m.
  Sydney Tower        309 m to the top of the lightning rod, with a golden turret
                      (Wikipedia, Sydney Tower, revision 1381960211); the shaft, turret and
                      mast take their sizes and heights from the OSM parts they replace.
                      The cable stays form a hyperboloid as photographed; their number here
                      is not from a cited source.
"""
import math

import numpy as np
import shapely
from shapely.geometry import Point, Polygon
from shapely.geometry.polygon import orient

from meshkit import Mesh

OPERA = "Sydney Opera House"
PYLONS = ("Sydney Harbour Bridge - South Pylons", "Sydney Harbour Bridge - North Pylons")
BRIDGE_DECK_TOP = 52.0  # 49 m clearance plus the deck structure
R_SHELL = 75.2
# the deck from its western edge: (width m, kind); see the docstring
DECK_ZONES = [(0.5, "parapet"), (3.5, "cycleway"), (0.4, "barrier"), (10.0, "rail"), (0.6, "barrier"), (20.4, "lanes6"),
              (0.6, "barrier"), (6.8, "lanes2"), (0.6, "barrier"), (4.9, "footway"), (0.5, "parapet")]
MATERIALS = {
    "tile": {"color": "#f1eee6", "roughness": 0.35, "metalness": 0.0, "pattern": "chevron_tiles", "lid_m": 2.6, "chevron_m": 1.8, "emissive": "#fff1dc", "glow": 0.42},
    "tile_edge": {"color": "#d6ccb8", "roughness": 0.7, "metalness": 0.0},
    # topaz glass, lit warm from the foyers after dark
    "glass": {"color": "#2e251d", "roughness": 0.05, "metalness": 0.8, "emissive": "#e89a48", "glow": 0.07},
    "mullion": {"color": "#4d3c2b", "roughness": 0.5, "metalness": 0.7},
    # reconstituted granite (u, v metres): the podium's panels; treads with a pale nosing; risers
    # darker, with the shadow under the nosing (v from the riser's foot to its top, 0 to 1)
    "podium": {"color": "#9c816b", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 1.65]},
    "granite": {"color": "#b39684", "roughness": 0.8, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 0.0], "stair": "tread"},
    # paving laid over a roof: drawn in front of it (web/world.js)
    "paving": {"color": "#b39684", "roughness": 0.8, "metalness": 0.0, "pattern": "granite", "joints_m": [1.5, 1.5], "decal": True},
    "granite_riser": {"color": "#7e6154", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 0.0], "stair": "riser"},
    "steel": {"color": "#8e959a", "roughness": 0.55, "metalness": 0.4},
    "deck": {"color": "#5e6164", "roughness": 0.85, "metalness": 0.1, "pattern": "deck_zones", "zones": DECK_ZONES},
    "rail": {"color": "#55504a", "roughness": 0.4, "metalness": 0.8},
    "railing": {"color": "#8e959a", "roughness": 0.55, "metalness": 0.4, "pattern": "railing", "bar_m": 0.13, "rails_m": [0.08, 1.25]},
    "barrier": {"color": "#b9b4aa", "roughness": 0.85, "metalness": 0.0},
    "lamp": {"color": "#d9d4c8", "roughness": 0.4, "metalness": 0.2},
    "tower": {"color": "#c9cdd0", "roughness": 0.6, "metalness": 0.1},
    "turret": {"color": "#c9a04a", "roughness": 0.25, "metalness": 0.85},
    "turret_glass": {"color": "#6e5524", "roughness": 0.1, "metalness": 0.7},
    "cable": {"color": "#a3aaaf", "roughness": 0.45, "metalness": 0.6},
}
SYDNEY_TOWER = "Sydney Tower"  # the turret part's name; the shaft and mast are unnamed parts above 200 m beside it
# The shells, hall by hall from south to north, one per ridge OSM maps (the restaurant's two share
# one): which way each faces (-1 the forecourt, 1 the harbour), its tip in m AHD, and its side
# feet, in metres back from the tip along the ridge and half the span across it; see the docstring
SHELLS = {
    "concert": [(-1, 42.4, 16.5, 15.2), (1, 67.0, 16.3, 24.9), (1, 51.2, 18.1, 27.4), (1, 41.1, 20.0, 24.5)],
    "joan_sutherland": [(-1, 39.1, 14.0, 11.3), (1, 61.1, 12.5, 19.4), (1, 47.0, 11.8, 21.5), (1, 38.0, 13.5, 18.2)],
    "restaurant": [(-1, 28.0, 19.0, 14.0), (1, 26.0, 10.6, 11.5)],
}
HALL_NAMES = {"concert": "Concert Hall", "joan_sutherland": "Joan Sutherland Theatre", "restaurant": "Bennelong"}
RESTAURANT_SPLIT = 0.65  # how far along the restaurant's ridge its two shells meet, back to back
JUNCTION_M = {"concert": 23.0, "joan_sutherland": 20.5, "restaurant": 8.0}  # how high above the podium the back-to-back shells' ridges meet
SIDE_GLASS_M = {"concert": 6.0, "joan_sutherland": 5.5, "restaurant": 3.0}  # the glass under the side shells, at its highest
NESTED_BACK, NESTED_RISE = 4.0, 0.5  # a nested shell's ridge goes back into the mouth of the one behind this far behind where it comes out, to this share of its tip's height
# Monumental Steps, measured on the aerial photo along the axis of the podium's south edge: the
# flights in metres from the top riser, the tread, the width and its offset from the podium's axis,
# and how far inside the podium's mapped edge the top riser is; the riser is assumed
STEPS = {"flights": [(-17.6, -15.6), (-14.0, -8.0), (-6.4, 0.0)], "tread": 0.39, "riser": 0.15, "width": 85.0, "lateral": -0.4,
         "inside": 2.8, "apron": 8.0}
# The halls stand on the upper podium, and a flight climbs to it in front of each, measured on the
# aerial photo in the Monumental Steps' frame (metres from their top riser along their axis, and
# across from their centre line): where its foot is, and its two ends across. The restaurant stays
# on the lower landing, west of the Concert Hall's flight, as far as `behind_restaurant`.
UPPER = {"flights": {"concert": (24.4, -12.0, 11.0), "joan_sutherland": (34.4, 11.0, 44.0)}, "run": 11.6, "risers": 29, "behind_restaurant": 50.0}


# ---------------------------------------------------------------- build_scene hooks

def adjust_building(b, cls, g, geoms, ctx):
    """geoms: [polygon, min_height, height, source, part_name] per solid."""
    if b["name"] == OPERA:
        return opera_podium(g, geoms, ctx)
    turret = next((q for q in geoms if q[4] == SYDNEY_TOWER), None)
    if turret is not None:  # the shaft, turret and mast become one parametric tower
        c = turret[0].centroid
        near = [q for q in geoms if q[2] > 200 and q[0].centroid.distance(c) < 12]
        rest = [q for q in geoms if q not in near]
        shaft = max((q for q in near if q[4] != SYDNEY_TOWER and q[0].area > 50), key=lambda q: q[0].area)
        g0 = ctx.ground(c.x, c.y)
        podium = max((q[2] for q in rest if q[0].contains(c)), default=0.0)
        ctx.landmarks["sydney_tower"] = {"at": [round(c.x, 1), round(c.y, 1)], "ground_m": round(g0, 1), "podium_m": round(g0 + podium, 1),
                                         "shaft_r": round(math.sqrt(shaft[0].area / math.pi), 2), "turret_r": round(math.sqrt(turret[0].area / math.pi), 2),
                                         "turret_m": [round(g0 + turret[1], 1), round(g0 + turret[2], 1)], "top_m": round(g0 + max(q[2] for q in near), 1)}
        for q in near:  # still in the surface model: the tower's shadow counts in the analyses
            ctx.hide(q)
        return geoms
    if b["name"] in PYLONS:
        ctx.landmarks.setdefault("bridge_pylons", {})[b["name"].split(" - ")[1].split()[0].lower()] = \
            [round(g.centroid.x, 1), round(g.centroid.y, 1)]
        for s in geoms:  # the unnamed base part stops at the deck; the named towers start there
            if s[4]:
                s[1] = BRIDGE_DECK_TOP
            else:
                s[2] = BRIDGE_DECK_TOP
    return geoms


def finalize(ctx):
    """Bridge alignment from the pylon footprints, and labels for both landmarks."""
    pl = ctx.landmarks.get("bridge_pylons", {})
    if "south" in pl and "north" in pl:
        s, n = np.array(pl["south"]), np.array(pl["north"])
        d = n - s
        u = d / np.linalg.norm(d)
        ctx.landmarks["harbour_bridge"] = {
            "south_pylons": pl["south"], "north_pylons": pl["north"],
            "pylon_spacing_m": round(float(np.linalg.norm(d)), 1),
            "bearing_deg": round(math.degrees(math.atan2(d[0], d[1])), 2),
            # published: arch span 503 m, crown 134 m above sea level, deck clearance 49 m,
            # deck 49 m wide, arch trusses 30 m apart, pylons 89 m
            "span_m": 503.0, "crown_m": 134.0, "deck_m": 49.0, "deck_width_m": 49.0, "truss_spacing_m": 30.0,
            "approach_ground_south": round(ctx.ground(*(s - u * 120)), 1),
            "approach_ground_north": round(ctx.ground(*(n + u * 120)), 1),
        }
        ctx.landmarks["harbour_bridge"]["deck_profile"] = deck_profile(ctx, (s + n) / 2, u, float(np.linalg.norm(d)) / 2)
        m = (s + n) / 2
        ctx.labels["Sydney Harbour Bridge"] = [round(float(m[0]), 1), round(float(m[1]), 1), 142.0]
    if "sydney_tower" in ctx.landmarks:
        t = ctx.landmarks["sydney_tower"]
        ctx.labels["Sydney Tower"] = [t["at"][0], t["at"][1], t["top_m"] - 30.0]
    if "opera_house" in ctx.landmarks:
        o = ctx.landmarks["opera_house"]
        ctx.labels["Sydney Opera House"] = [o["centroid"][0], o["centroid"][1], 72.0]
        for m in ctx.meta:  # the podium in its pink granite: the walls, and the deck's paving for its roof
            if m[0] == OPERA:
                m[7], m[8] = MATERIALS["podium"]["color"], MATERIALS["granite"]["color"]


def opera_podium(g, geoms, ctx):
    """The Opera House's outline becomes its podium on two levels: the lower landing, at the top
    of the Monumental Steps, which climb to it from the forecourt (they take the strip of the
    outline they cross), and the upper podium the halls stand on, with a flight up to it in front
    of each. The ridges of the roof come from its OSM parts; landmark_meshes() builds the shells
    on them."""
    rect = g.minimum_rotated_rectangle
    cs = np.asarray(rect.exterior.coords)[:4]
    e1, e2 = cs[1] - cs[0], cs[2] - cs[1]
    axis = e1 if np.linalg.norm(e1) > np.linalg.norm(e2) else e2
    o = ctx.landmarks["opera_house"] = {
        "centroid": [round(g.centroid.x, 1), round(g.centroid.y, 1)],
        "axis_deg": round(math.degrees(math.atan2(axis[1], axis[0])), 2),
        "length_m": round(max(np.linalg.norm(e1), np.linalg.norm(e2)), 1),
        "width_m": round(min(np.linalg.norm(e1), np.linalg.norm(e2)), 1),
        "halls": opera_ridges(geoms),
    }
    c, f, l = opera_frame(o)
    top = c - f * (o["length_m"] / 2 - STEPS["inside"]) + l * STEPS["lateral"]
    st = o["steps"] = monumental_steps(ctx, top, f, l)
    z_low = st["z_top"]
    box = lambda u0, u1, v0, v1: Polygon([top + f * u0 + l * v0, top + f * u1 + l * v0, top + f * u1 + l * v1, top + f * u0 + l * v1])
    run, n = UPPER["run"], UPPER["risers"]
    upper = [box(UPPER["behind_restaurant"], 500, -500, 500)]
    for hall, (u0, v0, v1) in UPPER["flights"].items():
        upper.append(box(u0 + run + 0.03, 500, v0, v1 if hall == "concert" else 500))
    upper = shapely.union_all(upper)
    lower = g.intersection(box(0.03, 500, -500, 500)).difference(upper)
    # the upper podium is the building's one solid (as the whole podium was, so the solids after it,
    # and the roofs drawn from their order, stay as they were): its deck is where build_scene puts
    # the solid's top, to the decimetre, and the flights climb to it
    pod = orient(max(ctx.polygons(g.intersection(upper)), key=lambda p: p.area), 1.0)
    zb = max(min(ctx.ground(x, y) for x, y in pod.simplify(0.15, preserve_topology=True).exterior.coords), 0.0)  # as build_scene takes it
    z_up = (round(zb * 10) + round((z_low + n * STEPS["riser"] - zb) * 10)) / 10
    o["upper_steps"] = {hall: flight(top + f * (u0 + run) + l * (v0 + v1) / 2, f, (v1 - v0) / 2, z_low, [(-run, 0.0)], run / (n - 1),
                                     (z_up - z_low) / n, z_low - 0.5) for hall, (u0, v0, v1) in UPPER["flights"].items()}
    # the landing is walked as a strip, the width of the outline there, as far as the Concert Hall's flight
    across = [[(np.asarray(c) - top) @ l for c in shapely.LineString([top + f * u - l * 200, top + f * u + l * 200]).intersection(g).coords]
              for u in np.arange(0.5, UPPER["flights"]["concert"][0] + run, 2.0)]
    v0, v1 = max(min(a) for a in across) + 0.3, min(max(a) for a in across) - 0.3  # the narrowest
    u1 = UPPER["flights"]["concert"][0] + run
    o["landing"] = {"origin": [round(v, 2) for v in top + l * (v0 + v1) / 2], "axis": st["axis"], "half_width": round((v1 - v0) / 2, 2),
                    "z_top": z_low, "base_m": st["base_m"], "profile": [[0.0, z_low], [round(u1, 2), z_low]]}
    rings, decks = [], {z_low: [], z_up: []}
    for geom, z in ((lower, z_low), (pod, z_up)):
        for p in ctx.polygons(geom):
            if p.area < 2:
                continue
            p = orient(p, 1.0)
            rings.append({"top_m": z, "ring": [[round(x, 2), round(y, 2), round(ctx.ground(x, y), 2), int(g.exterior.distance(Point(x, y)) < 0.3)]
                                               for x, y in p.exterior.coords]})
            decks[z].append([[round(x, 2), round(y, 2)] for x, y in p.exterior.coords])
    o["podium"] = {"low_m": z_low, "top_m": z_up, "rings": rings, "decks": [decks[z_low], decks[z_up]]}
    return [[pod, 0.0, z_up - zb, "parametric", None]]


def opera_ridges(geoms):
    """The ridges of the roof: OSM maps a maintenance walkway along each, as a thin part (about
    1.2 m wide) with no roof shape. Grouped by bearing into the halls, the longest run first: the
    Concert Hall, the Joan Sutherland Theatre, then the restaurant; each [x0, y0, x1, y1] from
    its south end, the hall's ridges from south to north."""
    strips = []
    for q in geoms:
        if len(q) < 6 or q[5].get("roof_shape"):
            continue
        cs = np.asarray(q[0].minimum_rotated_rectangle.exterior.coords)[:4]
        e1, e2 = cs[1] - cs[0], cs[2] - cs[1]
        L, W = max(np.linalg.norm(e1), np.linalg.norm(e2)), min(np.linalg.norm(e1), np.linalg.norm(e2))
        if W > 2.5 or L < 8.0:
            continue
        ax = (e1 if np.linalg.norm(e1) > np.linalg.norm(e2) else e2) / L
        ax = ax if ax[1] > 0 else -ax
        c = np.array(q[0].centroid.coords[0])
        strips.append((math.degrees(math.atan2(ax[0], ax[1])), c - ax * L / 2, c + ax * L / 2))
    groups = []
    for brg, a, b in sorted(strips, key=lambda t: t[0]):
        if groups and brg - groups[-1][-1][0] < 4.0:
            groups[-1].append((brg, a, b))
        else:
            groups.append([(brg, a, b)])
    groups.sort(key=lambda gr: -sum(np.linalg.norm(b - a) for _, a, b in gr))
    if len(groups) != len(SHELLS) or [len(gr) for gr in groups] != [len(SHELLS["concert"]), len(SHELLS["joan_sutherland"]), 1]:
        raise SystemExit(f"Opera House: expected the roof's ridges in OSM as 4, 4 and 1 walkways, found {[len(gr) for gr in groups]}")
    out = {}
    for name, gr in zip(SHELLS, groups):
        ax = sum(b - a for _, a, b in gr)
        ax /= np.linalg.norm(ax)
        out[name] = [[round(float(v), 2) for v in (*a, *b)] for _, a, b in sorted(gr, key=lambda t: float(t[1] @ ax))]
    return out


def opera_frame(o):
    """Centroid, forward (towards the harbour, north) and lateral (east) unit vectors."""
    c = np.array(o["centroid"], float)
    ang = math.radians(o["axis_deg"])
    f = np.array([math.cos(ang), math.sin(ang)])
    if f[1] < 0:
        f = -f
    return c, f, np.array([f[1], -f[0]])


def monumental_steps(ctx, top, f, l):
    """The Monumental Steps as a strip climbing north from the forecourt to the lower landing:
    origin at the top riser's centre (top), u from the foot (negative) to 0 at the top riser."""
    u_foot = STEPS["flights"][0][0]
    hw = STEPS["width"] / 2
    z_foot = float(np.percentile([ctx.ground(*(top + f * u_foot + l * v)) for v in np.linspace(-hw, hw, 9)], 75))  # bury few treads
    a0 = top + f * (u_foot - STEPS["apron"])
    z_apron = min(z_foot, max(0.5, min(ctx.ground(*(a0 + l * v)) for v in np.linspace(-hw, hw, 9))))  # the lowest forecourt
    low = min(ctx.ground(*(top + f * u + l * v)) for u in np.arange(u_foot - STEPS["apron"], 1, 2.0) for v in np.linspace(-hw, hw, 17))
    return flight(top, f, hw, z_foot, STEPS["flights"], STEPS["tread"], STEPS["riser"], min(low, z_foot) - 0.5, (STEPS["apron"], z_apron))


def flight(top, f, hw, z_foot, flights, tread, riser, base, apron=None):
    """A stair as a strip, origin at its top riser's centre and u along f: flights [(u0, u1)] of
    treads `tread` deep (each ending in the riser onto the landing or the top), from z_foot;
    `apron` (length, height) ramps up to the first riser from the ground in front."""
    risers = []
    for a, b in flights:
        n = max(1, round((b - a) / tread))
        risers += [a + (b - a) * k / n for k in range(n + 1)]
    z_top = z_foot + riser * len(risers)
    u_foot = flights[0][0]
    out = [[round(u_foot - apron[0], 2), round(apron[1], 3)]] if apron else []
    out.append([round(u_foot - 0.02, 2), round(z_foot, 3)])
    for j, u in enumerate(risers):
        out += [[round(u, 2), round(z_foot + j * riser, 3)], [round(u + 0.02, 2), round(z_foot + (j + 1) * riser, 3)]]
    out.append([1.0, round(z_top, 3)])
    return {"origin": [round(top[0], 2), round(top[1], 2)], "axis": [round(f[0], 5), round(f[1], 5)], "half_width": round(hw, 2),
            "z_foot": round(z_foot, 2), "z_top": round(z_top, 2), "base_m": round(base, 2), "risers": len(risers), "profile": out}


def deck_profile(ctx, mid, ax, half_pylons):
    """Road deck height along the bridge axis, [[u, z], ...] from south to north: level
    across the arch and the pylons, then down the approach viaducts at 5% until it meets
    the ground (the real approaches run on to the Cahill Expressway and North Sydney)."""
    flat = half_pylons + 40.0
    prof = {}
    for sign in (-1, 1):
        pts = [(flat, BRIDGE_DECK_TOP)]
        u = flat
        while u < flat + 900:
            u += 10.0
            z = BRIDGE_DECK_TOP - 0.05 * (u - flat)
            g = ctx.ground(*(mid + ax * sign * u))
            if z <= g + 0.5:
                pts.append((u, round(g, 1)))
                break
            pts.append((u, round(z, 1)))
        prof[sign] = pts
    south = [[-u, z] for u, z in reversed(prof[-1])]
    return south + [[u, z] for u, z in prof[1]]


def deck_at(profile, u):
    us = [p[0] for p in profile]
    return float(np.interp(u, us, [p[1] for p in profile]))


def game_surfaces(scene):
    """Walkable and drivable surfaces above the terrain, for the game (pipeline/game_data.py).
    `mesh` names the landmark mesh the surface stands for (the game walks on the surface,
    not the mesh); `fly_under` marks a span the helicopter can be flown under; `drape`
    puts every footway that crosses the surface onto it."""
    out = []
    h = scene["landmarks"].get("harbour_bridge")
    if h and "deck_profile" in h:
        s, n = np.array(h["south_pylons"], float), np.array(h["north_pylons"], float)
        m = (s + n) / 2
        ax = (n - s) / np.linalg.norm(n - s)
        out.append({"name": "Sydney Harbour Bridge deck", "type": "strip", "origin": [round(m[0], 1), round(m[1], 1)],
                    "axis": [round(ax[0], 5), round(ax[1], 5)], "half_width": h["deck_width_m"] / 2,
                    "profile": h["deck_profile"], "thickness": 3.0, "mesh": "bridge_deck", "fly_under": True, "label": "Harbour Bridge"})
    o = scene["landmarks"].get("opera_house") or {}
    if o.get("steps"):
        st = o["steps"]
        out.append({"name": "Opera House steps", "type": "strip", "origin": st["origin"], "axis": st["axis"],
                    "half_width": st["half_width"], "profile": st["profile"], "thickness": round(st["z_top"] - st["base_m"], 1),
                    "mesh": "opera_steps", "drape": True})
    if o.get("landing"):
        st = o["landing"]
        out.append({"name": "Opera House podium", "type": "strip", "origin": st["origin"], "axis": st["axis"], "half_width": st["half_width"],
                    "profile": st["profile"], "thickness": round(st["z_top"] - st["base_m"], 1), "mesh": "opera_steps_landing", "drape": True})
    for hall, st in (o.get("upper_steps") or {}).items():
        out.append({"name": f"Opera House steps, {HALL_NAMES[hall]}", "type": "strip", "origin": st["origin"], "axis": st["axis"],
                    "half_width": st["half_width"], "profile": st["profile"], "thickness": round(st["z_top"] - st["base_m"], 1),
                    "mesh": f"opera_steps_{hall}"})
    return out


def landmark_meshes(scene):
    """(materials, meshes) for pipeline/landmarks.py."""
    lm = scene["landmarks"]
    meshes = []
    if "opera_house" in lm:
        o = lm["opera_house"]
        meshes += opera_house(o)
        meshes += steps_mesh(o["steps"], "opera_steps")
        for hall, st in o["upper_steps"].items():
            meshes += steps_mesh(st, f"opera_steps_{hall}")
        meshes += podium_mesh(o)
    if "harbour_bridge" in lm:
        meshes += harbour_bridge(lm["harbour_bridge"])
    if "sydney_tower" in lm:
        meshes += sydney_tower(lm["sydney_tower"])
    return MATERIALS, meshes


# ---------------------------------------------------------------- Opera House

def sphere_centre(a, b, c, r, inward):
    """Centre of the radius-r sphere through a, b, c on the side of `inward`."""
    ab, ac = b - a, c - a
    n = np.cross(ab, ac)
    n2 = np.dot(n, n)
    cc = a + (np.dot(ac, ac) * np.cross(n, ab) + np.dot(ab, ab) * np.cross(ac, n)) / (2 * n2)  # circumcentre
    rc = np.linalg.norm(cc - a)
    n = n / math.sqrt(n2)
    if np.dot(n, inward) < 0:
        n = -n
    return cc + n * math.sqrt(max(r * r - rc * rc, 0.0))


def slerp(p, q, t):
    """From vector p to vector q (the same length) round the circle through both, a fraction t."""
    cw = np.dot(p, q) / (np.linalg.norm(p) * np.linalg.norm(q))
    w = math.acos(min(1.0, max(-1.0, cw)))
    if w < 1e-6:
        return p + (q - p) * t
    return (math.sin((1 - t) * w) * p + math.sin(t * w) * q) / math.sin(w)


def shell_half(P, T, J, c, across, n=22):
    """Rows of points on one half of a shell: the triangle on the sphere about c (radius
    R_SHELL) with its pedestal P on the podium, its tip T and the back end of its ridge J. The
    ribs fan out from the pedestal to the ridge T..J, which is where the half meets its mirror
    image: a circle in the hall's vertical plane (normal `across`), so both halves share it.
    Rows run from the pedestal to the ridge, columns from the tip to J: the first column is the
    shell's free edge (the leg of its arch), the last its back edge."""
    cr = c - across * np.dot(c - T, across)  # the ridge circle's centre
    return [[c + slerp(P - c, cr + slerp(T - cr, J - cr, j / n) - c, i / n) for j in range(n + 1)] for i in range(n + 1)]


def side_shell(J, back_a, back_b, z0, gap, n=12):
    """A side shell on a hall's flank, between two shells that stand back to back: a smaller lobe
    facing out, two faces that meet along a crease from the shells' junction J down towards the
    podium. Each face runs along one shell's back edge (back_a, back_b: points from J down to its
    pedestal) to where that edge comes within `gap` of the podium; under the side shell is glass.
    Returns the faces' rows of points (from J; columns from the back edge to the crease), the
    glass wall's foot, and its outline from one pedestal round to the other."""
    mid = (back_a[-1] + back_b[-1]) / 2
    out = mid[:2] - (J[:2] - mid[:2]) / np.linalg.norm(J[:2] - mid[:2]) * 1.5  # the crease comes down a little outside the pedestals' line
    B = np.array([*out, z0 + gap * 0.55])
    faces, corners = [], []
    for e in (back_a, back_b):
        k = next(i for i, q in enumerate(e) if q[2] <= z0 + gap)
        corners.append(k)
        rail = [e[int(x)] + (e[min(int(x) + 1, k)] - e[int(x)]) * (x - int(x)) for x in np.linspace(0, k, n + 1)]
        c = sphere_centre(J, e[k], B, R_SHELL, np.array([*mid[:2], z0 - 30.0]) - (J + e[k] + B) / 3)
        rows = []
        for i in range(n + 1):
            p, q = rail[i], J + (B - J) * i / n
            row = []
            for j in range(n + 1):
                w = j / n
                r = p + (q - p) * w
                row.append(r + (c + (r - c) * R_SHELL / np.linalg.norm(r - c) - r) * 4 * w * (1 - w))  # bowed onto its sphere between the edges
            rows.append(row)
        faces.append(rows)
    outline = back_a[corners[0]:][::-1] + faces[0][-1][1:] + faces[1][-1][::-1][1:] + back_b[corners[1]:][1:]
    return faces, np.array([*out, z0]), outline


def hall_shells(hall, ridges, z0):
    """The shells of a hall from SHELLS on its ridges, as 3D points: the back end of its ridge J
    (where it meets the shell it stands back to back with, or goes into the mouth of the one
    behind it), its tip T, and its pedestals on the hall's west and east flanks, where the legs
    of its arch stand."""
    R = [(np.array(r[:2]), np.array(r[2:])) for r in ridges]
    if hall == "restaurant":  # one ridge for both
        a, b = R[0]
        m = a + (b - a) * RESTAURANT_SPLIT
        R = [(a, m), (m, b)]
    h = R[-1][1] - R[0][0]
    east = np.array([h[1], -h[0]]) / np.linalg.norm(h)
    junction = (R[0][1] + R[1][0]) / 2
    out = []
    for k, ((facing, tip_m, back, half), (s, e)) in enumerate(zip(SHELLS[hall], R)):
        tip = s if facing < 0 else e
        if k < 2:  # back to back
            J = np.array([*junction, z0 + JUNCTION_M[hall]])
        else:  # nested: its ridge goes back into the mouth of the one behind
            f = (e - s) / np.linalg.norm(e - s)
            J = np.array([*(s - f * NESTED_BACK), z0 + NESTED_RISE * (tip_m - z0)])
        f = (tip - J[:2]) / np.linalg.norm(tip - J[:2])
        foot = tip - f * back
        out.append((J, np.array([*tip, tip_m]), [np.array([*(foot + east * sd * half), z0]) for sd in (-1, 1)]))
    return out


def opera_house(o):
    """The three groups of shells on the ridges OSM maps, each shell two halves on the one sphere
    radius, and side shells on the flanks between the shells that stand back to back: tiled,
    with the precast edge of each shell along the legs of its arch and a cap along its ridge, and
    the glass walls that close their mouths, topaz glass on bronze mullions fanning out from the
    foot of each mouth (and closing a nested shell's back, inside the mouth of the one behind)."""
    shells = Mesh("opera_shells", "tile", True, floodlit=True, uv=True)
    rims, caps = Mesh("opera_shell_rims", "tile_edge", False), Mesh("opera_shell_ridges", "tile_edge", True)
    glass, mullions = Mesh("opera_glass", "glass", False, floodlit=True), Mesh("opera_mullions", "mullion", False)
    for hall, ridges in o["halls"].items():
        z0 = o["podium"]["low_m" if hall == "restaurant" else "top_m"]  # the restaurant stands on the lower landing
        backs = []  # each shell's back edges, west and east: from J down to the pedestal
        for k, (J, T, peds) in enumerate(hall_shells(hall, ridges, z0)):
            f = (T[:2] - J[:2]) / np.linalg.norm(T[:2] - J[:2])
            across = np.array([f[1], -f[0], 0.0])
            below = np.array([*((J[:2] + T[:2]) / 2), z0 - 30.0])
            legs, edges = [], []
            for P in peds:
                c = sphere_centre(P, T, J, R_SHELL, below - (P + T + J) / 3)
                pts = shell_half(P, T, J, c, across)
                shells.grid(pts, shell_uv(pts))
                leg = [r[0] for r in pts]  # the free edge, from the pedestal up to the tip
                inner = [q - (q - c) / R_SHELL * 1.1 for q in leg]  # the shell's thickness: the precast ribs under the tiles
                for i in range(len(leg) - 1):
                    rims.quad(leg[i], leg[i + 1], inner[i + 1], inner[i])
                legs.append([q - (q - c) / R_SHELL * 0.7 for q in leg])  # the glass stands a little inside the edge
                edges.append([r[-1] for r in pts][::-1])
            caps.sweep(pts[-1], [(-0.65, -0.25), (0.65, -0.25), (0.65, 0.12), (0.3, 0.3), (-0.3, 0.3), (-0.65, 0.12)])
            mouth(glass, mullions, np.array([T[0], T[1], z0]), legs[0] + legs[1][::-1][1:])
            if k > 1:  # a nested shell's back, in the mouth of the one behind: glazed down to the podium
                for e in edges:
                    mouth(glass, mullions, np.array([J[0], J[1], z0]), e, frame=False)
            backs.append(edges)
        for side in (0, 1):  # side shells between the back-to-back pair
            faces, foot, outline = side_shell(backs[0][side][0], backs[0][side], backs[1][side], z0, SIDE_GLASS_M[hall])
            for pts in faces:
                shells.grid(pts, shell_uv(pts))
                caps.sweep([r[-1] for r in pts], [(-0.35, -0.2), (0.35, -0.2), (0.35, 0.08), (-0.35, 0.08)])
            mouth(glass, mullions, foot, outline)
    return [shells, rims, caps, glass, mullions]


def mouth(glass, mullions, foot, arch, frame=True):
    """A glass wall hung from a shell's arch (points from one foot over to the other): a pleated
    curtain of panes down to a line on the podium from one end of the arch through `foot`, under
    the tip, to the other, on bronze mullions that close in towards the foot, with transoms
    following the arch."""
    z0 = foot[2]
    ground = lambda q: np.array([q[0], q[1], z0])
    run = lambda pts: np.concatenate([[0.0], np.cumsum([np.linalg.norm(q - p) for p, q in zip(pts, pts[1:])])])
    sa, line = run(arch), [ground(arch[0]), foot, ground(arch[-1])]
    sl = run(line)
    t = sa / sa[-1] * sl[-1]
    seg = np.minimum(np.searchsorted(sl, t, side="right") - 1, len(line) - 2)
    bottom = [line[k] + (line[k + 1] - line[k]) * ((tt - sl[k]) / max(sl[k + 1] - sl[k], 1e-9)) for k, tt in zip(seg, t)]
    for k in range(len(arch) - 1):
        glass.quad(arch[k], arch[k + 1], bottom[k + 1], bottom[k])
    if not frame:
        return
    for k in range(2, len(arch) - 2, 2):
        mullions.box(bottom[k], arch[k], 0.16, 0.26)
    for lam in (0.3, 0.55, 0.78):
        mullions.tube([b + (q - b) * lam for b, q in zip(bottom, arch)], 0.08, 4)


def shell_uv(pts):
    """Texture coordinates for one half from shell_half(), its rows from the pedestal: u counts
    the rib bays across it (the ribs fan out from the pedestal), v is metres along a rib."""
    rows, cols = len(pts), len(pts[0])
    edge = sum(np.linalg.norm(pts[-1][j + 1] - pts[-1][j]) for j in range(cols - 1))
    bays = max(3, round(edge / 4.2))
    uv = [[[0.0, 0.0] for _ in range(cols)] for _ in range(rows)]
    for j in range(cols):
        v = 0.0
        for r in range(rows):
            if r:
                v += np.linalg.norm(pts[r][j] - pts[r - 1][j])
            uv[r][j] = [bays * j / (cols - 1), v]
    return uv


def steps_mesh(st, name):
    """Solid granite steps from the profile: treads with a nosing that overhangs the riser, the
    risers, and the cheek walls either side. UVs in metres across the steps (u) and from the
    front of each tread (v), or up a riser from its foot to its top (0 to 1)."""
    o, f = np.array(st["origin"], float), np.array(st["axis"], float)
    l, hw, base = np.array([f[1], -f[0]]), st["half_width"], st.get("base_m", st["z_foot"] - 0.5)
    treads, risers = Mesh(name, "granite", False, uv=True), Mesh(f"{name}_risers", "granite_riser", False, uv=True)
    walls = Mesh(f"{name}_walls", "podium", False, uv=True)
    NOSE, LIP = 0.03, 0.035  # the nosing's overhang and depth

    def P(u, v, z):
        xy = o + f * u + l * v
        return np.array([xy[0], xy[1], z])

    def face(m, a, b, c, d, out, uv):  # a quad wound so its normal points along `out`
        if np.dot(np.cross(b - a, c - a), out) < 0:
            a, b, c, d, uv = d, c, b, a, uv[::-1]
        m.quad(a, b, c, d, uv)
    up, south, east = np.array([0, 0, 1.0]), np.array([-f[0], -f[1], 0]), np.array([l[0], l[1], 0])
    prof = st["profile"]
    for (u0, z0), (u1, z1) in zip(prof, prof[1:]):
        u1 = min(u1, 0.0)  # the podium takes over at the top riser
        if u1 <= u0:
            continue
        for sd in (-1, 1):  # the cheek walls, under every tread and riser
            face(walls, P(u0, sd * hw, base), P(u1, sd * hw, base), P(u1, sd * hw, z1), P(u0, sd * hw, z0), sd * east,
                 [[u0, base], [u1, base], [u1, z1], [u0, z0]])
        if abs(z1 - z0) < 1e-6 or u1 - u0 > 1.0:  # a tread, a landing or the apron ramp
            n0 = u0 - NOSE if abs(z1 - z0) < 1e-6 and u0 > prof[1][0] else u0  # every tread above the first riser overhangs it
            d = u1 - n0
            face(treads, P(n0, -hw, z0), P(u1, -hw, z1), P(u1, hw, z1), P(n0, hw, z0), up, [[-hw, 0], [-hw, d], [hw, d], [hw, 0]])
            if n0 < u0:  # the nosing's front and its underside, in the riser's shade
                face(risers, P(n0, -hw, z0 - LIP), P(n0, hw, z0 - LIP), P(n0, hw, z0), P(n0, -hw, z0), south, [[-hw, 0.75], [hw, 0.75], [hw, 1], [-hw, 1]])
                face(risers, P(n0, -hw, z0 - LIP), P(u0, -hw, z0 - LIP), P(u0, hw, z0 - LIP), P(n0, hw, z0 - LIP), -up,
                     [[-hw, 1], [-hw, 1], [hw, 1], [hw, 1]])
        else:  # a riser
            face(risers, P(u0, -hw, z0), P(u0, hw, z0), P(u1, hw, z1), P(u1, -hw, z1), south, [[-hw, 0], [hw, 0], [hw, 1], [-hw, 1]])
    face(walls, P(prof[0][0], -hw, base), P(prof[0][0], hw, base), P(prof[0][0], hw, prof[0][1]), P(prof[0][0], -hw, prof[0][1]), south,
         [[-hw, base], [hw, base], [hw, prof[0][1]], [-hw, prof[0][1]]])
    return [treads, risers, walls]


def podium_mesh(o):
    """The podium's walls on both levels, clad in granite panels (just proud of the building's
    own walls, which the analyses keep), with a low upstand and a bronze handrail along its
    edges: round the outside, and along the upper podium above the lower landing, except at the
    tops of the flights."""
    tops = [o["steps"]] + list(o["upper_steps"].values())

    def at_top(m):  # the middle of an edge at the top of a flight
        for st in tops:
            so, f = np.array(st["origin"]), np.array(st["axis"])
            if abs((m - so) @ f) < 0.3 and abs((m - so) @ np.array([f[1], -f[0]])) < st["half_width"] + 0.1:
                return True
        return False
    clad, upstand, rail = Mesh("opera_podium", "podium", False, uv=True), Mesh("opera_podium_upstand", "podium", False), Mesh("opera_podium_rail", "mullion", False)
    # paving on the landing (the strip the game walks on) and over the upper podium's roof, in metres
    # along and across the steps
    landing, deck, st = Mesh("opera_steps_landing", "paving", False, uv=True), Mesh("opera_podium_deck", "paving", False, uv=True), o["landing"]
    so, f = np.array(st["origin"]), np.array(st["axis"])
    l = np.array([f[1], -f[0]])
    for m, rings, z in ((landing, o["podium"]["decks"][0], o["podium"]["low_m"]), (deck, o["podium"]["decks"][1], o["podium"]["top_m"] + 0.02)):
        for ring in rings:
            for t in shapely.constrained_delaunay_triangles(Polygon(ring)).geoms:
                cs = np.asarray(t.exterior.coords)[:3]
                (ax, ay), (bx, by) = cs[1] - cs[0], cs[2] - cs[0]
                if ax * by - ay * bx < 0:  # anticlockwise from above: facing up
                    cs = cs[::-1]
                m.tri(*[np.array([*c, z]) for c in cs], [[(c - so) @ l, (c - so) @ f] for c in cs])
    for level in o["podium"]["rings"]:
        top, ring, run = level["top_m"], level["ring"], 0.0
        upper = top > o["podium"]["low_m"] + 0.1
        for p, q in zip(ring, ring[1:]):
            p, q = np.array(p), np.array(q)
            e = q[:2] - p[:2]
            L = float(np.linalg.norm(e))
            if L < 0.05:
                continue
            out = np.array([e[1], -e[0]]) / L  # the ring runs anticlockwise: outward is to its right
            run += L
            if at_top((p[:2] + q[:2]) / 2):
                continue  # the flight covers the wall below it, and its top stays open
            a, b = p[:2] + out * 0.04, q[:2] + out * 0.04
            clad.quad(np.array([*a, p[2] - 0.5]), np.array([*b, q[2] - 0.5]), np.array([*b, top]), np.array([*a, top]),
                      [[run - L, p[2] - 0.5], [run, q[2] - 0.5], [run, top], [run - L, top]])
            if not (p[3] and q[3] or upper):
                continue  # inside the outline, the lower landing's edge is the foot of the upper podium's wall
            a, b = p[:2] - out * 0.2, q[:2] - out * 0.2
            upstand.box(np.array([*a, top + 0.25]), np.array([*b, top + 0.25]), 0.4, 0.5)
            rail.rails([np.array([*a, top]), np.array([*b, top])], 1.05, post_every=3.0, post=0.05, rail=0.06, rails=1)
    return [clad, upstand, rail, landing, deck]


# ---------------------------------------------------------------- Harbour Bridge

def harbour_bridge(h):
    s, n = np.array(h["south_pylons"], float), np.array(h["north_pylons"], float)
    m = (s + n) / 2
    ax = (n - s) / np.linalg.norm(n - s)
    lat = np.array([ax[1], -ax[0]])
    half = h["span_m"] / 2
    z_bear, z_crown = 4.0, h["crown_m"]
    deck_under = h["deck_m"]
    deck_top = deck_under + 3.0
    panels = 28
    end_depth = 57.0
    crown_depth = 18.0

    def P(u, v, z):
        xy = m + ax * u + lat * v
        return np.array([xy[0], xy[1], z])

    def bottom(u):
        return z_bear + (z_crown - crown_depth - z_bear) * (1 - (u / half) ** 2)

    def top(u):
        z_end = z_bear + end_depth
        return z_end + (z_crown - z_end) * (1 - (u / half) ** 2)

    steel, deck = Mesh("bridge_steel", "steel", False), Mesh("bridge_deck", "deck", False, uv=True)
    # the steel inside the deck's depth; named under the deck strip, whose slab the game uses for it
    under_steel = Mesh("bridge_deck_steel", "steel", False)
    us = np.linspace(-half, half, panels + 1)
    for v in (-h["truss_spacing_m"] / 2, h["truss_spacing_m"] / 2):
        for k in range(panels):
            u0, u1 = us[k], us[k + 1]
            steel.box(P(u0, v, bottom(u0)), P(u1, v, bottom(u1)), 3.5, 4.0)    # bottom chord
            steel.box(P(u0, v, top(u0)), P(u1, v, top(u1)), 2.5, 3.0)          # top chord
            if k % 2 == 0:                                                     # Warren diagonals
                steel.box(P(u0, v, bottom(u0)), P(u1, v, top(u1)), 1.6, 1.6)
            else:
                steel.box(P(u0, v, top(u0)), P(u1, v, bottom(u1)), 1.6, 1.6)
        for u in us:
            steel.box(P(u, v, bottom(u)), P(u, v, top(u)), 1.8, 1.8)           # verticals
            zb = bottom(u)
            if zb > deck_top + 1:                                              # hangers down to the deck
                steel.box(P(u, v, deck_top), P(u, v, zb), 0.8, 0.8)
            elif zb < deck_under - 1:                                          # posts up to the deck
                steel.box(P(u, v, zb), P(u, v, deck_under), 1.4, 1.4)
    tsp = h["truss_spacing_m"] / 2
    for k in range(panels):                                                    # top lateral bracing
        u0, u1 = us[k], us[k + 1]
        steel.box(P(u0, -tsp, top(u0)), P(u1, tsp, top(u1)), 0.9, 0.9)
        steel.box(P(u0, tsp, top(u0)), P(u1, -tsp, top(u1)), 0.9, 0.9)
        steel.box(P(u0, -tsp, top(u0)), P(u0, tsp, top(u0)), 1.0, 1.0)
    # deck: level across the arch and pylons, then the approach viaducts down to the ground
    w = h["deck_width_m"] / 2
    prof = h.get("deck_profile") or [[-np.linalg.norm(n - s) / 2 - 190, deck_top], [np.linalg.norm(n - s) / 2 + 190, deck_top]]
    slab = 0.5  # the deck slab; under it, inside the deck's depth, the steel that carries it
    run = 0.0  # metres along the deck, for the lane markings
    for (u0, z0), (u1, z1) in zip(prof[:-1], prof[1:]):
        a0, a1, b0, b1 = P(u0, -w, z0), P(u1, -w, z1), P(u0, w, z0), P(u1, w, z1)
        under = lambda p: p - np.array([0, 0, deck_top - deck_under])
        soffit = lambda p: p - np.array([0, 0, slab])
        seg = float(np.linalg.norm(a1 - a0))
        deck.quad(a0, b0, b1, a1, [[run, 0], [run, 2 * w], [run + seg, 2 * w], [run + seg, 0]])
        run += seg
        under_steel.quad(soffit(a1), soffit(b1), soffit(b0), soffit(a0))
        deck.quad(a0, a1, under(a1), under(a0))
        deck.quad(b1, b0, under(b0), under(b1))
    # the deck's steel, seen from below: edge girders behind the fascias, stringers along the
    # deck, and a cross girder at every panel point (the hangers' spacing) along its length
    depth = deck_top - deck_under - slab
    along = lambda v: [P(u, v, z - slab) for u, z in prof]
    for v in (-w + 0.35, w - 0.35):
        under_steel.sweep(along(v), [(-0.3, -depth), (0.3, -depth), (0.3, 0.0), (-0.3, 0.0)])
    for v in np.linspace(-w + 5, w - 5, 7):
        under_steel.sweep(along(v), [(-0.22, -1.2), (0.22, -1.2), (0.22, 0.0), (-0.22, 0.0)])
    panel = h["span_m"] / panels
    for u in np.arange(np.ceil(prof[0][0] / panel) * panel, prof[-1][0], panel):
        zc = deck_at(prof, u) - slab - depth / 2
        under_steel.box(P(u, -w + 0.65, zc), P(u, w - 0.65, zc), 0.7, depth)
    deck.quad(P(prof[0][0], w, prof[0][1]), P(prof[0][0], -w, prof[0][1]),
              P(prof[0][0], -w, prof[0][1] - 3), P(prof[0][0], w, prof[0][1] - 3))
    deck.quad(P(prof[-1][0], -w, prof[-1][1]), P(prof[-1][0], w, prof[-1][1]),
              P(prof[-1][0], w, prof[-1][1] - 3), P(prof[-1][0], -w, prof[-1][1] - 3))
    half_pyl = np.linalg.norm(n - s) / 2
    furniture = deck_furniture(P, prof, w)
    for sign, g in ((-1, h["approach_ground_south"]), (1, h["approach_ground_north"])):  # approach piers
        end = abs(prof[0][0] if sign < 0 else prof[-1][0])
        for u in np.arange(half_pyl + 40, end - 15, 45):
            zt = deck_at(prof, sign * u) - 3.0
            for v in (-w + 4, w - 4):
                steel.box(P(sign * u, v, g - 5), P(sign * u, v, zt), 4.0, 4.0)
    return [steel, deck, under_steel] + furniture


def deck_furniture(P, prof, w):
    """On the deck: the railway's two tracks, the concrete barriers between the strips, a
    railing along both edges and lamp standards; P(u, v, z) with v from the deck's centre
    (east positive), prof the deck profile [[u, z]], w the half width."""
    # named under the deck strip ("bridge_deck"), so the game walks them as part of the deck
    rails, barriers, railings, lamps, heads = (Mesh("bridge_deck_rails", "rail", False), Mesh("bridge_deck_barriers", "barrier", False),
                                              Mesh("bridge_deck_railings", "railing", False, uv=True), Mesh("bridge_deck_lamps", "lamp", False),
                                              Mesh("bridge_deck_lamp_heads", "lamp", False, floodlit=True))
    edges, v = [], 0.0
    for width, kind in DECK_ZONES:
        edges.append((v - w, v + width - w, kind))
        v += width
    along = lambda vv, dz: [P(u, vv, z + dz) for u, z in prof]
    for v0, v1, kind in edges:
        if kind == "rail":  # standard gauge, two tracks
            for tc in (v0 + (v1 - v0) * 0.25, v0 + (v1 - v0) * 0.75):
                for r in (-0.7175, 0.7175):
                    rails.sweep(along(tc + r, 0.0), [(-0.035, 0.0), (0.035, 0.0), (0.035, 0.16), (-0.035, 0.16)])
        if kind == "barrier":  # a New Jersey profile, 0.9 m high
            hw = (v1 - v0) / 2
            barriers.sweep(along((v0 + v1) / 2, 0.0), [(-hw, 0.0), (hw, 0.0), (hw * 0.55, 0.3), (hw * 0.3, 0.9), (-hw * 0.3, 0.9), (-hw * 0.55, 0.3)])
    for vv in (-w + 0.25, w - 0.25):  # railings: a strip with the bars cut out by the material
        railings.panel(along(vv, 0.0), 1.3)
    # lamps on the barriers either side of the six lanes, every 36 m along the deck
    lane = next(e for e in edges if e[2] == "lanes6")
    for vb, side in ((lane[0] - 0.3, 1), (lane[1] + 0.3, -1)):
        run = 0.0
        for (u0, z0), (u1, z1) in zip(prof[:-1], prof[1:]):
            L = math.hypot(u1 - u0, z1 - z0)
            for t in np.arange((-run) % 36.0, L, 36.0):
                u, z = u0 + (u1 - u0) * t / L, z0 + (z1 - z0) * t / L
                base, top = P(u, vb, z + 0.9), P(u, vb, z + 9.0)
                lamps.box(base, top, 0.22, 0.22)
                end = P(u, vb + side * 2.2, z + 9.3)
                lamps.box(top, end, 0.14, 0.14)
                heads.box(end - np.array([0, 0, 0.2]), end + np.array([0, 0, 0.05]), 0.7, 0.35)
            run += L
    return [rails, barriers, railings, lamps, heads]


# ---------------------------------------------------------------- Sydney Tower

def sydney_tower(t):
    """Shaft, golden turret, mast and the cable stays, on the replaced OSM parts' sizes."""
    cx, cy = t["at"]
    z_pod, (z_t0, z_t1), z_top = t["podium_m"], t["turret_m"], t["top_m"]
    rs, rt = t["shaft_r"], t["turret_r"]
    shaft, turret, glazing, mast, cables = (Mesh("sydney_tower_shaft", "tower", True), Mesh("sydney_tower_turret", "turret", True, floodlit=True),
                                            Mesh("sydney_tower_glazing", "turret_glass", True), Mesh("sydney_tower_mast", "tower", True),
                                            Mesh("sydney_tower_cables", "cable", False))
    shaft.lathe([(z_pod - 1.0, rs), (z_t0 + 1.0, rs)], (cx, cy), 28)
    h = z_t1 - z_t0
    # the turret: a flared underside, two glazed bands of levels between gold bands, and a cap
    prof = [(z_t0, rs), (z_t0 + 0.18 * h, rt * 0.94), (z_t0 + 0.24 * h, rt), (z_t0 + 0.30 * h, rt), (z_t0 + 0.52 * h, rt),
            (z_t0 + 0.58 * h, rt * 1.01), (z_t0 + 0.80 * h, rt * 1.01), (z_t0 + 0.86 * h, rt * 0.97), (z_t1, rt * 0.55), (z_t1 + 0.6, rs * 0.4)]
    turret.lathe(prof, (cx, cy), 48)
    for z0, z1 in ((z_t0 + 0.31 * h, z_t0 + 0.51 * h), (z_t0 + 0.59 * h, z_t0 + 0.79 * h)):
        glazing.lathe([(z0, rt * 1.012), (z1, rt * 1.012)], (cx, cy), 48)
    # the mast with the lightning rod, tapering to the published 309 m
    mast.lathe([(z_t1 + 0.5, rs * 0.32), (z_t1 + 0.55 * (z_top - z_t1), 0.9), (z_top - 4.0, 0.35), (z_top, 0.08)], (cx, cy), 12)
    # cable stays from under the turret down to the podium roof, twisted into a hyperboloid
    n, twist, r_top, r_bot, z_c = 36, math.radians(55), rs + 0.6, rs + 16.0, z_t0 - 12.0
    for k in range(n):
        a = 2 * math.pi * k / n
        top = (cx + r_top * math.cos(a), cy + r_top * math.sin(a), z_c)
        bot = (cx + r_bot * math.cos(a + twist), cy + r_bot * math.sin(a + twist), z_pod + 0.5)
        cables.tube([top, bot], 0.12, 4)
    return [shaft, turret, glazing, mast, cables]
