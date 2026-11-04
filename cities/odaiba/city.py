"""Odaiba, a map of Tokyo: what the generic pipeline cannot know from open data.

The model is the real district: Overture footprints at Project PLATEAU's surveyed heights on GSI's laser
bare earth, on islands made in the bay, with the bay round them. This file adds:

  * レインボーブリッジ the Rainbow Bridge (1993): a two-deck suspension bridge, 798 m between its
    anchorages, its main span 570 m between two white towers 126 m above the sea, the expressway on the
    upper deck about 50 m over the water at mid-span (Metropolitan Expressway; Port of Tokyo), on
    OpenStreetMap's line of the expressway; its towers lit white after dark. The deck is the game's road.
  * The Fuji TV building's sphere (Kenzo Tange, 1996): a titanium-clad ball 32 m across, the observation
    deck, held between the two towers of the 123 m building at about the 25th floor.
  * The Statue of Liberty of Odaiba (a replica of 2000, 12.25 m; Minato City), on its pedestal by the
    beach, facing the bridge.
  * The Yurikamome's guideway: the driverless line's concrete viaduct about 9 m up, on columns, along
    OpenStreetMap's line of it where it crosses the islands.
  * The bridges over the canals (pipeline/districtkit.py water_bridges).

Persona 5's Odaiba is the seaside park and the Rainbow Bridge at night. Nothing of the game's art is
copied, and the giant robot statue at DiverCity (a licensed character) is left out.
"""
import math

import numpy as np
from shapely.geometry import LineString, Point, Polygon, box

import districtkit as dk
import japankit as jk
from japankit import Atlas, Kit, block, frame, lathe_at, slab_at, unit, left_of

RAINBOW = "首都高速11号台場線・東京港連絡橋"
FUJI_TV = "FCGビル"
LIBERTY = "Statue of Liberty"
BRIDGE = {"side": 114.0, "main": 570.0, "tower": 126.0, "deck_mid": 50.0, "deck_tower": 44.0, "width": 30.0}
SPHERE = {"r": 16.0, "z": 104.0}
LIBERTY_H, LIBERTY_PEDESTAL = 12.25, 4.5

MATERIALS = {
    "atlas": {"color": "#ffffff", "roughness": 0.7, "metalness": 0.0, "map": "atlas.jpg", "emissive_map": True, "glow": 1.2},
    "tower_white": {"color": "#eef0f0", "roughness": 0.45, "metalness": 0.25, "emissive": "#ffffff", "glow": 0.55},
    "cable": {"color": "#e6e8ea", "roughness": 0.4, "metalness": 0.5, "emissive": "#fff6e8", "glow": 0.5},
    "truss": {"color": "#dfe2e4", "roughness": 0.5, "metalness": 0.4},
    "deck_road": {"color": "#55575a", "roughness": 0.9, "metalness": 0.0},
    "titanium": {"color": "#c4c8cc", "roughness": 0.22, "metalness": 0.9},
    "verdigris": {"color": "#6fa597", "roughness": 0.55, "metalness": 0.35},
    "torch_gold": {"color": "#e8c060", "roughness": 0.3, "metalness": 0.9, "emissive": "#ffcf70", "glow": 0.8},
    "granite": {"color": "#a7a39a", "roughness": 0.85, "metalness": 0.0},
    "concrete": {"color": "#bdb8ae", "roughness": 0.9, "metalness": 0.0},
    "aviation": {"color": "#ff2a1a", "roughness": 0.5, "metalness": 0.0, "emissive": "#ff2a1a", "glow": 2.0},
    **dk.BRIDGE_MATS,
}
ATLAS = Atlas([("blank", 32, 32)])


def adjust_building(b, cls, g, geoms, ctx):
    name = b["name"] or ""
    if g.geom_type == "Polygon" and name == FUJI_TV:
        c = g.centroid
        ctx.landmarks["fuji"] = {"c": [round(c.x, 2), round(c.y, 2)], "z": round(ctx.ground(c.x, c.y), 2)}
    return geoms


def rainbow_line(C):
    """The expressway's two lines over the bridge, from the Daiba end out, as one centre line (their mean)."""
    rows = [r["geom"] for r in jk.overture(C, "segment", f"name = '{RAINBOW}'") if r["geom"].geom_type == "LineString"]
    if not rows:
        return None
    a = np.asarray(rows[0].coords)
    if len(rows) > 1:
        b = LineString(rows[1].coords)
        pts = [(np.array(p) + np.array(b.interpolate(b.project(Point(p))).coords[0])) / 2 for p in a]
        a = np.asarray(pts)
    # from the Daiba end (the end nearer the islands' middle)
    if np.hypot(*a[0]) > np.hypot(*a[-1]):
        a = a[::-1]
    return a


def finalize(ctx):
    C, lm = ctx.city, ctx.landmarks
    rl = rainbow_line(C)
    if rl is not None:
        line = LineString(rl)
        # the Daiba anchorage: where the line leaves the island for the sea (the laser ground drops to the sea's level)
        t0 = 0.0
        for t in np.arange(0, line.length, 5.0):
            p = line.interpolate(t)
            if ctx.ground(p.x, p.y) < 1.0:
                t0 = t
                break
        back = min(60.0, t0)
        pts = [line.interpolate(t0 + s) for s in np.arange(-back, min(BRIDGE["side"] * 2 + BRIDGE["main"] + 60.0, line.length - t0), 10.0)]
        lm["rainbow"] = {"line": [dk.rnd((p.x, p.y), 1) for p in pts], "t0": back, "length": round(line.length, 1)}
        tw = line.interpolate(t0 + BRIDGE["side"])
        ctx.labels["Rainbow Bridge レインボーブリッジ"] = [round(tw.x, 1), round(tw.y, 1), round(BRIDGE["tower"] + 10, 1)]
        # the approach viaduct east from the anchorage along the island's north shore, both carriageways: the
        # deck from the anchorage's 30 m down to 15 m over 1.2 km (the expressway's own lines, OpenStreetMap)
        a0 = np.asarray(lm["rainbow"]["line"][int(back / 10)])
        appr = []
        for r in jk.overture(C, "segment", "name = '首都高速11号台場線'"):
            g = r["geom"]
            if g.geom_type != "LineString" or g.distance(Point(*a0)) > 40:
                continue
            cs = np.asarray(g.coords)
            if np.hypot(*(cs[0] - a0)) > np.hypot(*(cs[-1] - a0)):
                cs = cs[::-1]
            ln = LineString(cs)
            if ln.length < 200 or cs[-1][0] < a0[0] + 300:
                continue   # the line out over the bridge to Shibaura, not the approach east along Daiba
            ln = ln.simplify(1.0)
            pts = [ln.interpolate(t) for t in np.arange(0, ln.length, 20.0)] + [Point(ln.coords[-1])]
            appr.append([[*dk.rnd((q.x, q.y), 1), round(max(30.0 - 15.0 * min(ln.project(q) / 1200.0, 1.0), ctx.ground(q.x, q.y) + 6.0), 2),
                          round(ctx.ground(q.x, q.y), 2)] for q in pts])
        lm["rainbow"]["approach"] = appr
    art = {r["name"]: r["geom"] for r in jk.overture(C, "infrastructure", f"name = '{LIBERTY}'")}
    if LIBERTY in art:
        p = art[LIBERTY].centroid
        lm["liberty"] = {"c": dk.rnd((p.x, p.y)), "z": round(ctx.ground(p.x, p.y), 2)}
        ctx.labels["Statue of Liberty 自由の女神像"] = [round(p.x, 1), round(p.y, 1), round(ctx.ground(p.x, p.y) + 22, 1)]
    if "fuji" in lm:
        f = lm["fuji"]
        ctx.labels["Fuji TV 球体展望室"] = [f["c"][0], f["c"][1], round(f["z"] + 140, 1)]
    # the Yurikamome's guideway on the islands: its line over land inside the frame
    import shapely
    ext = box(C.x0 + 5, C.y0 + 5, C.x1 - 5, C.y1 - 5)
    rails = [r["geom"] for r in jk.overture(C, "segment", "name LIKE '%ゆりかもめ%'") if r["geom"].geom_type == "LineString"]
    water = shapely.union_all([r["geom"] for r in jk.overture(C, "water", "TRUE") if r["geom"].geom_type in ("Polygon", "MultiPolygon")])
    runs = []
    for ln in rails[:1]:
        clip = ln.intersection(ext)
        for part in getattr(clip, "geoms", [clip]):
            if part.geom_type != "LineString" or part.length < 30:
                continue
            land = part.difference(water.buffer(2.0))
            for q in getattr(land, "geoms", [land]):
                if q.geom_type == "LineString" and q.length > 40:
                    s = q.simplify(1.0)
                    runs.append([[*dk.rnd(p, 1), round(ctx.ground(*p), 2)] for p in s.coords])
    lm["yurikamome"] = runs
    lm["bridges"] = dk.water_bridges(ctx, classes=("canal", "river", "water"), colours={"ウエストパークブリッジ": "#d8dde0", "夢の大橋": "#e8e8e8"})


# ---------------------------------------------------------------- meshes

def deck_z(u):
    """The upper deck's height along the bridge from the Daiba anchorage (u = 0): up from 30 m to the
    tower, then a gentle crown to mid-span."""
    s, m = BRIDGE["side"], BRIDGE["main"]
    if u <= 0:
        return 30.0 + u * 0.1
    if u <= s:
        return 30.0 + (BRIDGE["deck_tower"] - 30.0) * u / s
    t = min((u - s) / m, 1.0)
    return BRIDGE["deck_tower"] + (BRIDGE["deck_mid"] - BRIDGE["deck_tower"]) * math.sin(math.pi * t)


def rainbow(K, rb):
    pts = np.asarray(rb["line"], float)
    us = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))] - rb["t0"]
    hw = BRIDGE["width"] / 2
    at = lambda u: np.array([np.interp(u, us, pts[:, 0]), np.interp(u, us, pts[:, 1])])
    dirn = lambda u: unit(at(u + 2) - at(u - 2))
    side = lambda u, v, z: np.array([*(at(u) + left_of(dirn(u)) * v), z])
    s, m = BRIDGE["side"], BRIDGE["main"]
    end = min(us[-1] - 1, s * 2 + m)
    U = np.arange(us[0] + 1, end, 6.0)
    # the deck: upper road, the truss's faces between the decks, the lower deck under it
    for u0, u1 in zip(U[:-1], U[1:]):
        z0, z1 = deck_z(u0), deck_z(u1)
        K("deck_road").quad(side(u0, -hw, z0), side(u1, -hw, z1), side(u1, hw, z1), side(u0, hw, z0))
        K("truss").quad(side(u0, hw, z0 - 9.0), side(u1, hw, z1 - 9.0), side(u1, -hw, z1 - 9.0), side(u0, -hw, z0 - 9.0))
        for v, sg in ((-hw, 1), (hw, -1)):
            K("truss").box(side(u0, v, z0 - 0.3), side(u1, v, z1 - 0.3), 0.6, 0.6)
            K("truss").box(side(u0, v, z0 - 9.0), side(u1, v, z1 - 9.0), 0.6, 0.6)
            K("truss").box(side(u0, v, z0 - 9.0), side(u1, v, z1 - 0.3), 0.35, 0.35)
            K("truss").box(side(u1, v, z1 - 9.0), side(u1, v, z1 - 0.3), 0.35, 0.35)
        K("bridge_rail").box(side(u0, -hw + 0.3, z0 + 1.0), side(u1, -hw + 0.3, z1 + 1.0), 0.1, 0.1)
        K("bridge_rail").box(side(u0, hw - 0.3, z0 + 1.0), side(u1, hw - 0.3, z1 + 1.0), 0.1, 0.1)
    # the towers: two legs each, rounded at the top, three cross beams; red lights on top
    tops = []
    for ut in (s, s + m):
        if ut > us[-1] + 5:
            continue
        for v in (-hw - 1.5, hw + 1.5):
            b0, b1 = side(ut, v, -4.0), side(ut, v, BRIDGE["tower"])
            K("tower_white").box(b0, b1, 4.0, 6.0)
            lathe_at(K("tower_white"), b1[0], b1[1], [(b1[2], 2.0), (b1[2] + 1.5, 1.6), (b1[2] + 2.4, 0.0)], 10)
            lathe_at(K("aviation", "lit"), b1[0], b1[1], [(b1[2] + 2.4, 0.3), (b1[2] + 2.9, 0.0)], 6)
            tops.append((ut, v, b1))
        for zb in (deck_z(ut) - 10.0, 88.0, BRIDGE["tower"] - 6.0):
            K("tower_white").box(side(ut, -hw - 1.5, zb), side(ut, hw + 1.5, zb), 3.0, 4.0)
    # the main cables (catenary) from the anchorage to the towers and across the main span, and the hangers
    za = deck_z(0) + 4.0
    zt = BRIDGE["tower"] - 1.0
    sag = deck_z(s + m / 2) + 3.0
    for v in (-hw - 1.5, hw + 1.5):
        cab = []
        for u in np.arange(0.0, min(end, s + m) + 0.1, 8.0):
            if u <= s:
                z = za + (zt - za) * (u / s) ** 1.6
            else:
                t = (u - s) / m
                z = sag + (zt - sag) * (2 * t - 1) ** 2
            cab.append(side(u, v, z))
        K("cable", "lit").tube(cab, 0.45, 6)
        for u in np.arange(s + 12.0, min(end, s + m) - 6, 12.0):
            t = (u - s) / m
            z = sag + (zt - sag) * (2 * t - 1) ** 2
            K("cable").box(side(u, v, deck_z(u) + 0.5), side(u, v, z), 0.08, 0.08)
    # the anchorage block on Daiba
    a0 = side(-20.0, 0, 0)
    block(K("concrete"), frame(a0[:2], dirn(0)), -22, 22, -hw - 4, hw + 4, -2.0, za - 6)
    # the approach viaducts: a deck 12 m wide on single columns every 40 m
    for run in rb.get("approach", []):
        q = np.asarray(run, float)
        for a, b in zip(q[:-1], q[1:]):
            d = unit(b[:2] - a[:2])
            n = left_of(d) * 6.0
            K("deck_road").quad(np.array([*(a[:2] - n), a[2]]), np.array([*(b[:2] - n), b[2]]), np.array([*(b[:2] + n), b[2]]), np.array([*(a[:2] + n), a[2]]))
            K("truss").quad(np.array([*(a[:2] + n), a[2] - 2.2]), np.array([*(b[:2] + n), b[2] - 2.2]), np.array([*(b[:2] - n), b[2] - 2.2]), np.array([*(a[:2] - n), a[2] - 2.2]))
            for sg in (-1, 1):
                e = n * sg
                K("truss").quad(np.array([*(a[:2] + e), a[2] - 2.2]), np.array([*(b[:2] + e), b[2] - 2.2]), np.array([*(b[:2] + e), b[2] + 1.0]), np.array([*(a[:2] + e), a[2] + 1.0]))
        L = np.r_[0, np.cumsum(np.hypot(*np.diff(q[:, :2], axis=0).T))]
        for t in np.arange(20.0, L[-1], 40.0):
            x, y, z, g = (np.interp(t, L, q[:, k]) for k in range(4))
            K("concrete").box(np.array([x, y, min(g, 0.0) - 3.0]), np.array([x, y, z - 2.2]), 2.6, 3.4)


def fuji_sphere(K, f):
    x, y = f["c"]
    r, zc = SPHERE["r"], f["z"] + SPHERE["z"]
    prof = [(zc + r * math.sin(t), r * math.cos(t)) for t in np.linspace(-math.pi / 2, math.pi / 2, 18)]
    lathe_at(K("titanium"), x, y, prof, 32)


def liberty(K, s):
    """The replica: a granite pedestal, the robed figure in verdigris, her right arm up with the gilt
    torch, the crown's seven rays, the tablet on her left arm; facing north-west to the bridge."""
    x, y = s["c"]
    z0 = s["z"]
    face = unit(np.array([-0.6, 0.8]))
    P = frame((x, y), face)
    block(K("granite"), P, -3.2, 3.2, -3.2, 3.2, z0, z0 + 1.0)
    block(K("granite"), P, -2.3, 2.3, -2.3, 2.3, z0 + 1.0, z0 + LIBERTY_PEDESTAL)
    zb = z0 + LIBERTY_PEDESTAL
    h = LIBERTY_H * 0.72   # to the top of the head; the arm and torch rise above it
    lathe_at(K("verdigris"), x, y, [(zb, 1.25), (zb + h * 0.4, 0.95), (zb + h * 0.7, 0.8), (zb + h * 0.82, 0.55), (zb + h * 0.86, 0.22)], 14)
    lathe_at(K("verdigris"), x, y, [(zb + h * 0.86, 0.0), (zb + h * 0.88, 0.32), (zb + h * 0.97, 0.34), (zb + h, 0.0)], 10)
    l = left_of(face)
    sh = np.array([x, y]) - l * 0.7
    arm_top = sh - l * 0.2 + face * 0.1
    K("verdigris").tube([np.array([*sh, zb + h * 0.8]), np.array([*arm_top, zb + h * 1.1]), np.array([*arm_top, zb + LIBERTY_H - 1.3])], 0.22, 6)
    lathe_at(K("torch_gold", "lit"), arm_top[0], arm_top[1], [(zb + LIBERTY_H - 1.4, 0.18), (zb + LIBERTY_H - 0.9, 0.35), (zb + LIBERTY_H - 0.5, 0.3), (zb + LIBERTY_H, 0.0)], 8)
    for k in range(7):   # the crown's rays
        a = -math.pi / 2 + (k - 3) * 0.35
        d = face * math.cos(a + math.pi / 2) + l * math.sin(a + math.pi / 2)
        d = unit(d * 0.8 + face * 0.4)
        base = np.array([x, y, zb + h * 0.95])
        K("verdigris").box(base, base + np.array([d[0] * 0.8, d[1] * 0.8, 0.35]), 0.06, 0.06)
    tab = np.array([x, y]) + l * 0.85 + face * 0.25
    K("verdigris").box(np.array([*tab, zb + h * 0.48]), np.array([*tab, zb + h * 0.72]), 0.6, 0.15)


def yurikamome(K, runs):
    """The guideway: a concrete box beam 9 m up on columns every 30 m."""
    for run in runs:
        q = np.asarray(run, float)
        L = np.r_[0, np.cumsum(np.hypot(*np.diff(q[:, :2], axis=0).T))]
        for a, b in zip(q[:-1], q[1:]):
            K("concrete").box(np.array([a[0], a[1], a[2] + 8.4]), np.array([b[0], b[1], b[2] + 8.4]), 1.4, 5.2)
        for t in np.arange(10.0, L[-1], 30.0):
            x, y, z = (np.interp(t, L, q[:, k]) for k in range(3))
            K("concrete").box(np.array([x, y, z]), np.array([x, y, z + 7.7]), 1.8, 1.8)


def landmark_meshes(scene):
    lm = scene["landmarks"]
    K = Kit("odaiba", MATERIALS, floodlit=("tower_white", "titanium", "verdigris"))
    if "rainbow" in lm:
        rainbow(K, lm["rainbow"])
    if "fuji" in lm:
        fuji_sphere(K, lm["fuji"])
    if "liberty" in lm:
        liberty(K, lm["liberty"])
    if lm.get("yurikamome"):
        yurikamome(K, lm["yurikamome"])
    for b in lm.get("bridges", []):
        dk.bridge_meshes(K, b)
    return MATERIALS, K.meshes()


def landmark_assets(out_dir, scene):
    from PIL import Image
    Image.new("RGB", (ATLAS.W, ATLAS.H), (200, 200, 200)).save(f"{out_dir}/atlas.jpg", quality=90)
    return ["atlas.jpg"]


def landmark_glows(scene):
    lm = scene["landmarks"]
    out = []
    rb = lm.get("rainbow")
    if rb:
        for p in rb["line"][::8]:
            out.append([p[0], p[1], 30.0, "#ffffff", 0.18])
    if "liberty" in lm:
        out.append([*lm["liberty"]["c"], 10.0, "#ffe2b0", 0.3])
    return out


def game_surfaces(scene):
    """The bridges' decks: the canal bridges, and the Rainbow Bridge's upper deck (the expressway)."""
    lm = scene["landmarks"]
    out = dk.bridge_surfaces(lm.get("bridges", []), mesh="odaiba_bridge_deck")
    rb = lm.get("rainbow")
    if rb:
        pts = np.asarray(rb["line"], float)
        us = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))] - rb["t0"]
        for k in range(0, len(pts) - 1, 6):   # straight pieces of ~60 m
            j = min(k + 6, len(pts) - 1)
            a, b = pts[k], pts[j]
            L = float(np.hypot(*(b - a)))
            if L < 5:
                continue
            ax = unit(b - a)
            prof = [[round(float(t), 2), round(deck_z(us[k] + t), 2)] for t in np.linspace(-0.5, L + 0.5, 6)]
            out.append({"name": f"Rainbow Bridge {k // 6 + 1}", "type": "strip", "origin": dk.rnd(a), "axis": dk.rnd(ax, 5),
                        "half_width": BRIDGE["width"] / 2, "profile": prof, "thickness": 2.0, "mesh": "odaiba_deck_road",
                        "fly_under": True, "label": "the Rainbow Bridge"})
        for run in rb.get("approach", []):
            q = np.asarray(run, float)
            for k in range(0, len(q) - 1):
                a, b = q[k], q[k + 1]
                L = float(np.hypot(*(b[:2] - a[:2])))
                if L < 2:
                    continue
                out.append({"name": f"Rainbow Bridge approach {k + 1}", "type": "strip", "origin": dk.rnd(a[:2]), "axis": dk.rnd(unit(b[:2] - a[:2]), 5),
                            "half_width": 6.0, "profile": [[-0.3, round(float(a[2]), 2)], [round(L + 0.3, 2), round(float(b[2]), 2)]], "thickness": 2.0,
                            "mesh": "odaiba_deck_road", "fly_under": True, "label": "the Rainbow Bridge"})
    return out


def game_extras(scene):
    lm = scene["landmarks"]
    spots, chatter, close = [], [], []
    s = lm.get("liberty")
    if s:
        at = np.asarray(s["c"]) + np.array([0.6, -0.8]) * 12.0
        spots.append(dk.spot("liberty", "Statue of Liberty 自由の女神像", at, s["z"], "Look at the statue",
                             ["The French lent Odaiba their Statue of Liberty in 1998 for a year. People missed her so much a copy was cast in 2000.",
                              "Stand here at dusk: her torch, and the Rainbow Bridge lit behind her."], 6.0))
    f = lm.get("fuji")
    if f:
        at = np.asarray(f["c"]) + np.array([-55.0, 40.0])
        spots.append(dk.spot("sphere", "Fuji TV's sphere 球体展望室", at, f["z"], "Look up at the sphere",
                             ["Fuji Television's headquarters, Kenzo Tange, 1996. The ball is titanium, thirty-two metres across, and you can go up into it.",
                              "From inside, the bay, the bridge and on a clear day Mount Fuji."], 8.0))
    rb = lm.get("rainbow")
    if rb:
        p = np.asarray(rb["line"][0])
        d = unit(np.asarray(rb["line"][8]) - p)
        at = p - d * 60.0 + left_of(d) * 40.0
        spots.append(dk.spot("rainbow", "Rainbow Bridge レインボーブリッジ", at, 3.0, "Look at the bridge",
                             ["The Rainbow Bridge, 1993: 798 metres, the expressway on top and the Yurikamome and the road below, and a footpath you can walk across.",
                              "It's lit white most nights. On special nights, all the colours of its name."], 10.0))
    return {"spots": spots, "chatter": chatter, "close": close}
