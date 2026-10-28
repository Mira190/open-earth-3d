"""Sydney: what the generic pipeline cannot know from open data.

Building adjustments (called by pipeline/build_scene.py):
  * Sydney Opera House: the outline becomes a 6 m podium; the shells are parametric,
    and the Monumental Steps climb from the forecourt to the podium.
  * Harbour Bridge pylons: OSM maps each abutment base to the full 89 m, but the deck
    passes through them, so the base stops at the deck and the towers start there.

Parametric landmarks (called by pipeline/landmarks.py), placed with anchors measured
from the data:
  Sydney Opera House  every shell is a spherical triangle cut from a sphere of radius
                      75.2 m (Utzon's "spherical solution"); highest shell 67 m above
                      sea level. Shell layout is an approximation, not survey data.
                      The Monumental Steps are "nearly 100 m wide and two storeys high"
                      (UNESCO); their extent here, 90 m wide and 40 m from the podium edge
                      to the forecourt, is measured on the NSW aerial photo. Risers are
                      15 cm, in two flights with a landing between and a landing at the top.
  Harbour Bridge      arch span 503 m between bearings, crown 134 m above sea level,
                      28 panels, trusses 30 m apart, deck 49 m wide with 49 m
                      clearance; alignment from the two pylon footprints in OSM.
"""
import math

import numpy as np

from meshkit import Mesh

OPERA = "Sydney Opera House"
PYLONS = ("Sydney Harbour Bridge - South Pylons", "Sydney Harbour Bridge - North Pylons")
BRIDGE_DECK_TOP = 52.0  # 49 m clearance plus the deck structure
R_SHELL = 75.2
MATERIALS = {
    "tile": {"color": "#f1eee6", "roughness": 0.35, "metalness": 0.0},
    "glass": {"color": "#2a2622", "roughness": 0.08, "metalness": 0.6},
    "podium": {"color": "#c9a77e", "roughness": 0.9, "metalness": 0.0},
    "steel": {"color": "#8e959a", "roughness": 0.55, "metalness": 0.4},
    "deck": {"color": "#5e6164", "roughness": 0.85, "metalness": 0.1},
    "granite": {"color": "#cbb7a4", "roughness": 0.8, "metalness": 0.0},
    "granite_riser": {"color": "#a8968a", "roughness": 0.85, "metalness": 0.0},  # darker, so the steps read
}
# Monumental Steps, measured on the aerial photo: width, depth from the podium edge to the
# forecourt, top landing depth, middle landing depth, lateral offset from the podium axis
STEPS = {"width": 90.0, "depth": 40.0, "top_landing": 12.0, "mid_landing": 5.0, "lateral": -3.0, "riser": 0.15}


# ---------------------------------------------------------------- build_scene hooks

def adjust_building(b, cls, g, geoms, ctx):
    """geoms: [polygon, min_height, height, source, part_name] per solid."""
    if b["name"] == OPERA:
        rect = g.minimum_rotated_rectangle
        cs = np.asarray(rect.exterior.coords)[:4]
        e1, e2 = cs[1] - cs[0], cs[2] - cs[1]
        axis = e1 if np.linalg.norm(e1) > np.linalg.norm(e2) else e2
        ctx.landmarks["opera_house"] = {
            "centroid": [round(g.centroid.x, 1), round(g.centroid.y, 1)],
            "axis_deg": round(math.degrees(math.atan2(axis[1], axis[0])), 2),
            "length_m": round(max(np.linalg.norm(e1), np.linalg.norm(e2)), 1),
            "width_m": round(min(np.linalg.norm(e1), np.linalg.norm(e2)), 1),
            "ground_m": round(min(ctx.ground(x, y) for x, y in np.asarray(g.exterior.coords)), 1) if g.geom_type == "Polygon" else None,
        }
        return [[p, 0.0, 6.0, "parametric", None] for p in ctx.polygons(g)]
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
    if "opera_house" in ctx.landmarks:
        o = ctx.landmarks["opera_house"]
        ctx.labels["Sydney Opera House"] = [o["centroid"][0], o["centroid"][1], 72.0]
        o["steps"] = monumental_steps(ctx, o)


def opera_frame(o):
    """Centroid, forward (towards the harbour, north) and lateral (east) unit vectors."""
    c = np.array(o["centroid"], float)
    ang = math.radians(o["axis_deg"])
    f = np.array([math.cos(ang), math.sin(ang)])
    if f[1] < 0:
        f = -f
    return c, f, np.array([f[1], -f[0]])


def monumental_steps(ctx, o):
    """The steps as a strip climbing north from the forecourt to the podium top: origin at
    the top edge's centre, u from -depth (the foot) to 0 (the podium edge)."""
    c, f, l = opera_frame(o)
    top = c - f * o["length_m"] / 2 + l * STEPS["lateral"]
    foot = top - f * STEPS["depth"]
    hw = STEPS["width"] / 2
    z_foot = float(np.percentile([ctx.ground(*(foot + l * v)) for v in np.linspace(-hw, hw, 9)], 75))  # bury few treads
    z_top = o["ground_m"] + 6.0
    # two flights of n risers each; the top riser of the first flight leads onto the middle
    # landing, the top riser of the second onto the top landing
    flight = (STEPS["depth"] - STEPS["top_landing"] - STEPS["mid_landing"]) / 2
    n = max(2, round((z_top - z_foot) / 2 / STEPS["riser"]))
    tread = flight / (n - 1)
    risers = [-STEPS["depth"] + k * tread for k in range(n)]
    risers += [-STEPS["depth"] + flight + STEPS["mid_landing"] + k * tread for k in range(n)]
    rise = (z_top - z_foot) / len(risers)
    out = [[-STEPS["depth"] - 0.5, z_foot]]
    for j, u in enumerate(risers):
        out += [[round(u, 2), round(z_foot + j * rise, 3)], [round(u + 0.02, 2), round(z_foot + (j + 1) * rise, 3)]]
    out.append([1.0, round(z_top, 3)])
    return {"origin": [round(top[0], 1), round(top[1], 1)], "axis": [round(f[0], 5), round(f[1], 5)], "half_width": hw,
            "z_foot": round(z_foot, 2), "z_top": round(z_top, 2), "risers": len(risers), "profile": out}


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
                    "profile": h["deck_profile"], "thickness": 3.0, "mesh": "bridge_deck", "fly_under": True})
    st = (scene["landmarks"].get("opera_house") or {}).get("steps")
    if st:
        out.append({"name": "Opera House steps", "type": "strip", "origin": st["origin"], "axis": st["axis"],
                    "half_width": st["half_width"], "profile": st["profile"], "thickness": round(st["z_top"] - st["z_foot"] + 1, 1),
                    "mesh": "opera_steps", "drape": True})
    return out


def landmark_meshes(scene):
    """(materials, meshes) for pipeline/landmarks.py."""
    lm = scene["landmarks"]
    meshes = []
    if "opera_house" in lm:
        meshes += opera_house(lm["opera_house"], lm["opera_house"]["ground_m"] + 6.0)
        if "steps" in lm["opera_house"]:
            meshes += steps_mesh(lm["opera_house"]["steps"])
    if "harbour_bridge" in lm:
        meshes += harbour_bridge(lm["harbour_bridge"])
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


def spherical_triangle(a, b, c, centre, steps=14):
    """Rows of points on the sphere patch spanned by a, b, c (b..c is one row end)."""
    r = np.linalg.norm(a - centre)
    rows = []
    for i in range(steps + 1):
        t = i / steps
        row = []
        for j in range(steps + 1):
            s = j / steps
            # bilinear on the degenerate quad a,a,b,c then pushed out to the sphere
            p = (1 - t) * a + t * ((1 - s) * b + s * c)
            d = p - centre
            row.append(centre + d / np.linalg.norm(d) * r)
        rows.append(row)
    return rows


def opera_house(o, podium_top):
    c, f, l = opera_frame(o)  # forward = towards the harbour end of Bennelong Point (north); l to the east

    def P(fw, lat, z):
        xy = c + f * fw + l * lat
        return np.array([xy[0], xy[1], z])

    shells, glass = Mesh("opera_shells", "tile", True, floodlit=True), Mesh("opera_glass", "glass", False)
    # (lateral centre, pedestal along-axis, tip along-axis, tip height AHD, half-width, facing)
    # facing +1 opens to the harbour (north), -1 to the forecourt (south)
    halls = {
        "concert": (-27.0, [(-6, 50, 60.0, 24), (-36, 20, 67.0, 27), (-56, -14, 50.0, 22), (-22, -62, 36.0, 17)]),
        "joan_sutherland": (25.0, [(-4, 46, 53.0, 21), (-32, 18, 59.0, 24), (-52, -14, 44.0, 19), (-20, -58, 32.0, 15)]),
        "restaurant": (-36.0, [(-60, -84, 26.0, 11), (-66, -50, 20.0, 9)]),
    }
    for hall, (lat0, specs) in halls.items():
        for fa, fb, zb, hw in specs:
            facing = 1 if fb > fa else -1
            a = P(fa, lat0, podium_top)
            b = P(fb, lat0, zb)
            fd = fb - facing * 4.0
            for side in (-1, 1):
                d = P(fd, lat0 + side * hw, podium_top)
                inward = P((fa + fb) / 2, lat0, podium_top - 30) - (a + b + d) / 3  # below the hall centreline
                ctr = sphere_centre(a, b, d, R_SHELL, inward)
                shells.grid(spherical_triangle(a, b, d, ctr))
                # glazed mouth: fan from the foot of the tip down to the arc b..d
                foot = P(fd, lat0, podium_top)
                arc = spherical_triangle(a, b, d, ctr)[-1]
                for k in range(len(arc) - 1):
                    glass.tri(foot, arc[k], arc[k + 1]) if side > 0 else glass.tri(foot, arc[k + 1], arc[k])
    return [shells, glass]


def steps_mesh(st):
    """Solid granite steps from the profile: treads, then risers and the two side walls."""
    o, f = np.array(st["origin"], float), np.array(st["axis"], float)
    l, hw, base = np.array([f[1], -f[0]]), st["half_width"], st["z_foot"] - 0.5
    treads, risers = Mesh("opera_steps", "granite", False), Mesh("opera_steps_risers", "granite_riser", False)

    def P(u, v, z):
        xy = o + f * u + l * v
        return np.array([xy[0], xy[1], z])

    def face(a, b, c, d, out, m):  # a quad wound so its normal points along `out`
        if np.dot(np.cross(b - a, c - a), out) < 0:
            a, b, c, d = d, c, b, a
        m.quad(a, b, c, d)
    up, south, east = np.array([0, 0, 1.0]), np.array([-f[0], -f[1], 0]), np.array([l[0], l[1], 0])
    prof = st["profile"]
    for (u0, z0), (u1, z1) in zip(prof, prof[1:]):
        u1 = min(u1, 0.0)  # the podium takes over at its edge
        if u1 <= u0:
            continue
        if abs(z1 - z0) < 1e-6:  # a tread or landing, with the side walls below it
            face(P(u0, -hw, z0), P(u1, -hw, z0), P(u1, hw, z0), P(u0, hw, z0), up, treads)
            face(P(u0, hw, base), P(u1, hw, base), P(u1, hw, z0), P(u0, hw, z0), east, risers)
            face(P(u0, -hw, base), P(u1, -hw, base), P(u1, -hw, z0), P(u0, -hw, z0), -east, risers)
        else:  # a riser
            face(P(u0, -hw, z0), P(u0, hw, z0), P(u1, hw, z1), P(u1, -hw, z1), south, risers)
    face(P(prof[0][0], -hw, base), P(prof[0][0], hw, base), P(prof[0][0], hw, prof[0][1]), P(prof[0][0], -hw, prof[0][1]), south, risers)
    return [treads, risers]


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

    steel, deck = Mesh("bridge_steel", "steel", False), Mesh("bridge_deck", "deck", False)
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
    for (u0, z0), (u1, z1) in zip(prof[:-1], prof[1:]):
        a0, a1, b0, b1 = P(u0, -w, z0), P(u1, -w, z1), P(u0, w, z0), P(u1, w, z1)
        under = lambda p: p - np.array([0, 0, deck_top - deck_under])
        deck.quad(a0, b0, b1, a1)
        deck.quad(under(a1), under(b1), under(b0), under(a0))
        deck.quad(a0, a1, under(a1), under(a0))
        deck.quad(b1, b0, under(b0), under(b1))
    deck.quad(P(prof[0][0], w, prof[0][1]), P(prof[0][0], -w, prof[0][1]),
              P(prof[0][0], -w, prof[0][1] - 3), P(prof[0][0], w, prof[0][1] - 3))
    deck.quad(P(prof[-1][0], -w, prof[-1][1]), P(prof[-1][0], w, prof[-1][1]),
              P(prof[-1][0], w, prof[-1][1] - 3), P(prof[-1][0], -w, prof[-1][1] - 3))
    half_pyl = np.linalg.norm(n - s) / 2
    for sign, g in ((-1, h["approach_ground_south"]), (1, h["approach_ground_north"])):  # approach piers
        end = abs(prof[0][0] if sign < 0 else prof[-1][0])
        for u in np.arange(half_pyl + 40, end - 15, 45):
            zt = deck_at(prof, sign * u) - 3.0
            for v in (-w + 4, w - 4):
                steel.box(P(sign * u, v, g - 5), P(sign * u, v, zt), 4.0, 4.0)
    return [steel, deck]
