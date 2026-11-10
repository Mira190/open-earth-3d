"""A railway for the game (game.rail.train): the running line, its passing loops, stations and level crossings.

pipeline/game_data.py calls train() with the Overture rail pieces of the configured class, chained into
through routes. A Japanese private railway is the model (the Enoden at Kamakura): one track, trains both
ways, passing each other in loops at some stations and signal stops, level crossings with the streets,
and stretches where the rails run in the street itself.

    main       the longest through route, sampled every 4 m: the line every distance `s` is measured along.
               Its height is the ground's, smoothed (a railway's grade changes slowly; a 5 m terrain grid
               under a narrow bench does not) and held to the road's level at each crossing.
    loops      a second track whose two ends meet the main line: {s0, s1, side (+ left of rising s, m), p}
    street     [s0, s1] where the rails lie in a street: within STREET_M of a road's centre line and
               within STREET_DEG of its direction, for at least STREET_MIN metres
    stations   the config's stations, each found by name among the mapped stations (Overture
               infrastructure, class railway_station), projected onto the line: {id, name, native, s,
               side (+1 platform on the left of rising s, -1 on the right), p0, p1 (the platform's ends
               along the line, from the mapped platform where there is one), at}
    crossings  where a road or a path of the game's network crosses the line on the level: {id, s, at,
               h (the track's heading, radians clockwise from north), road_h (the road's), half_m (half
               the track zone, measured along the road), width_m, kind, name}. kind: "gated" (a road:
               warning lamps, bell and barrier arms), "foot" (a path: lamps and bell) or "street" (a side
               street meeting the rails where they run in the street: no equipment, as there).

Everything is in the city's local frame, metres; the lines' points are decimetres like the game's roads.
"""
import math

import numpy as np
from scipy import ndimage
from shapely.geometry import LineString, Point

STEP = 4.0
RAIL_TOP = 0.05        # the rail head over the line's level (web/game/rail.js TRAIN.railTop)
BALLAST_M = 0.16       # the line's level over the ground on open track: sleepers on ballast; none in a street or at a crossing
PLATFORM_M = 0.9       # a platform over the rail head (the Enoden's cars' floors are 1.07 to 1.1 m over it)
PLATFORM_W, EDGE_M, RAMP_M = 2.6, 1.4, 6.0   # a side platform's width; its edge from the track's centre line; its end ramps
STREET_M, STREET_DEG, STREET_MIN = 2.5, 20.0, 60.0
ROAD_W = {"motorway": 14, "trunk": 13, "primary": 11, "secondary": 9, "tertiary": 7.5, "residential": 5.5,
          "unclassified": 5.5, "living_street": 4.5, "service": 4, "track": 3, "pedestrian": 4, "footway": 2.2,
          "path": 1.8, "cycleway": 2.5, "steps": 2.2}


def _heading(ln, s):
    a, b = ln.interpolate(max(0, s - 1)), ln.interpolate(min(ln.length, s + 1))
    return math.atan2(b.x - a.x, b.y - a.y)


def _dm(pts, z):
    return [v for (x, y), h in zip(pts, z) for v in (round(x * 10), round(y * 10), round(h * 10))]


def train(rc, routes, roads, foot, stations_mapped, platforms, ground, gauge=1.067):
    """rc: game.rail.train; routes: LineStrings (chained); roads, foot: the game's road and path records
    ({c, p}); stations_mapped: [(name, Point)]; platforms: [geometry]; ground(x, y) -> m."""
    routes = sorted(routes, key=lambda l: -l.length)
    main = routes[0]
    if main.coords[0][0] > main.coords[-1][0]:  # s rises eastward (northward for a line that runs north)
        main = LineString(main.coords[::-1])
    L = main.length
    n = max(2, int(L / STEP) + 1)
    S = np.linspace(0, L, n)
    P = [main.interpolate(s) for s in S]
    xy = [(q.x, q.y) for q in P]
    z = np.array([ground(*q) for q in xy])

    road_lines = [(r, LineString([(r["p"][k] / 10, r["p"][k + 1] / 10) for k in range(0, len(r["p"]), 3)])) for r in roads]
    foot_lines = [(r, LineString([(r["p"][k] / 10, r["p"][k + 1] / 10) for k in range(0, len(r["p"]), 3)])) for r in foot]

    # ---- rails in the street
    in_street = np.zeros(n, bool)
    for i, q in enumerate(P):
        h = _heading(main, S[i])
        for r, ln in road_lines:
            if ln.distance(q) < STREET_M:
                d = ln.project(q)
                hr = _heading(ln, d)
                if abs(math.sin(h - hr)) < math.sin(math.radians(STREET_DEG)):
                    in_street[i] = True
                    break
    in_street = ndimage.binary_closing(in_street, iterations=3)  # bridge the gaps at side streets
    lab, k = ndimage.label(in_street)
    street = []
    for j in range(1, k + 1):
        idx = np.nonzero(lab == j)[0]
        if S[idx[-1]] - S[idx[0]] >= STREET_MIN:
            street.append([round(float(S[idx[0]]), 1), round(float(S[idx[-1]]), 1)])
    on_street = lambda s: any(a - 2 <= s <= b + 2 for a, b in street)

    # ---- crossings
    found = []
    for lines, is_foot in ((road_lines, False), (foot_lines, True)):
        for r, ln in lines:
            if r["c"] == "steps":
                continue
            x = ln.intersection(main)
            for q in getattr(x, "geoms", [x]):
                if q.is_empty or q.geom_type != "Point":
                    continue
                s = main.project(q)
                h, hr = _heading(main, s), _heading(ln, ln.project(q))
                sn = abs(math.sin(h - hr))
                if sn < 0.35:  # running along the rails, not across them
                    continue
                kz = 2 + 3 * min(len(r["p"]) // 3 - 1, int(np.argmin([math.hypot(r["p"][k] / 10 - q.x, r["p"][k + 1] / 10 - q.y) for k in range(0, len(r["p"]), 3)])))
                if abs(r["p"][kz] / 10 - ground(q.x, q.y)) > 2.5:  # a bridge over the line, or under it
                    continue
                w = ROAD_W.get(r["c"], 5)
                found.append({"s": s, "x": q.x, "y": q.y, "h": h, "road_h": hr, "sn": sn, "w": w, "c": r["c"],
                              "kind": "street" if on_street(s) else "foot" if is_foot or r["c"] in ("track",) else "gated"})
    found.sort(key=lambda c: c["s"])
    crossings = []
    for c in found:  # one crossing per place: the two carriageways of a road, a road and its footway
        if crossings and c["s"] - crossings[-1]["s"] < 7:
            o = crossings[-1]
            if (c["kind"] == "gated") > (o["kind"] == "gated") or (c["kind"] == o["kind"] and c["w"] > o["w"]):
                crossings[-1] = c
            continue
        crossings.append(c)
    names = rc.get("crossing_names", {})
    out_x = []
    for i, c in enumerate(crossings):
        name = next((nm for nm, at in names.items() if math.hypot(at[0] - c["x"], at[1] - c["y"]) < 12), None)
        zc = ground(c["x"], c["y"])
        out_x.append({"id": f"x{i}", "s": round(c["s"], 1), "at": [round(c["x"], 1), round(c["y"], 1), round(zc, 2)],
                      "h": round(c["h"], 3), "road_h": round(c["road_h"], 3),
                      "half_m": round(min(6.0, (gauge / 2 + 1.3) / max(0.35, c["sn"])), 1), "width_m": c["w"], "kind": c["kind"],
                      "cls": c["c"], **({"name": name} if name else {})})

    # ---- the profile: the ground, smoothed, held at the crossings
    zs = ndimage.gaussian_filter1d(ndimage.median_filter(z, size=5, mode="nearest"), sigma=5, mode="nearest")
    lift = np.array([0.0 if on_street(s) else BALLAST_M for s in S])
    zs = zs + ndimage.gaussian_filter1d(lift, sigma=2, mode="nearest")
    for c in out_x:
        w = np.exp(-((S - c["s"]) / 8.0) ** 2)
        zs = zs * (1 - w) + c["at"][2] * w
    zs = np.maximum(zs, 0.6)  # never under the sea's level

    # ---- loops
    loops = []
    for o in routes[1:]:
        a, b = Point(o.coords[0][:2]), Point(o.coords[-1][:2])
        if o.length < 50 or main.distance(a) > 3 or main.distance(b) > 3:
            continue
        s0, s1 = main.project(a), main.project(b)
        if s0 > s1:
            o, s0, s1 = LineString(o.coords[::-1]), s1, s0
        if s1 - s0 < 40:
            continue
        mo, mm = o.interpolate(0.5, normalized=True), main.interpolate((s0 + s1) / 2)
        h = _heading(main, (s0 + s1) / 2)
        side = -(math.cos(h) * (mo.x - mm.x) - math.sin(h) * (mo.y - mm.y))  # + = left of rising s
        if abs(side) < 1.5 or any(abs(l["s0"] - s0) < 20 and abs(l["s1"] - s1) < 20 for l in loops):
            continue
        m = max(2, int(o.length / STEP) + 1)
        pts = [o.interpolate(k / (m - 1), normalized=True) for k in range(m)]
        zl = np.interp([s0 + (s1 - s0) * k / (m - 1) for k in range(m)], S, zs)
        loops.append({"s0": round(s0, 1), "s1": round(s1, 1), "side": round(side, 2), "p": _dm([(q.x, q.y) for q in pts], zl)})
    loops.sort(key=lambda l: l["s0"])

    # ---- stations
    stations = []
    for st in rc.get("stations", []):
        hit = [(nm, q) for nm, q in stations_mapped if nm == st.get("find", st.get("native")) and main.distance(q) < 40]
        if not hit:
            print(f"  rail: station {st['id']} ({st.get('find', st.get('native'))}) is not on the line in this frame")
            continue
        q = min(hit, key=lambda t: main.distance(t[1]))[1]
        s = main.project(q)
        h, m = _heading(main, s), main.interpolate(s)
        left = lambda g: -(math.cos(h) * (g.x - m.x) - math.sin(h) * (g.y - m.y))
        near = [g for g in platforms if g.distance(q) < 45]
        side, p0, p1 = st.get("side"), s - st.get("platform_m", 50) / 2, s + st.get("platform_m", 50) / 2
        if near:
            cs = [Point(c[:2]) for g in near for c in (g.exterior.coords if g.geom_type == "Polygon" else g.coords)]
            sp = [main.project(c) for c in cs]
            if max(sp) - min(sp) > 15:
                p0, p1 = min(sp), max(sp)
            if side is None:
                lv = [left(c) for c in cs]
                side = 0 if max(lv) > 2 and min(lv) < -2 else 1 if sum(lv) > 0 else -1  # 0: a platform each side (a loop)
        stations.append({"id": st["id"], "name": st["name"], **({"native": st["native"]} if st.get("native") else {}),
                         "s": round((p0 + p1) / 2, 1), "side": 1 if side is None else side, "p0": round(p0, 1), "p1": round(p1, 1),
                         "at": [round(m.x, 1), round(m.y, 1), round(float(np.interp(s, S, zs)), 2)],
                         **({"doors_cut": st["doors_cut"]} if st.get("doors_cut") else {})})
    stations.sort(key=lambda t: t["s"])

    # ---- platforms: beside a single track on the station's side; in a loop outside the two tracks, or
    # between them where they stand far enough apart (an island). Each is a straight slab along the chord of
    # its stretch of track, EDGE_M from the track's centre line, PLATFORM_M over the rail head, with a ramp
    # at each end; the game walks on it as a strip (game.json surfaces).
    def offset(s, m):
        q, h = main.interpolate(s), _heading(main, s)
        return q.x - math.cos(h) * m, q.y + math.sin(h) * m

    platforms, surfaces = [], []
    for st in stations:
        lp = next((l for l in loops if l["s0"] - 5 < st["s"] < l["s1"] + 5), None)
        if lp is None:
            sd = st["side"] or 1
            specs = [(sd * (EDGE_M + PLATFORM_W / 2), PLATFORM_W / 2, -sd, [1, -1])]
        else:
            sd = lp["side"]
            g = 1 if sd > 0 else -1
            if abs(sd) > 6:
                specs = [(sd / 2, abs(sd) / 2 - EDGE_M, 0, [1, -1])]
            else:  # a train going with rising s keeps to the left track: the loop's when it lies on the left
                specs = [(-g * (EDGE_M + PLATFORM_W / 2), PLATFORM_W / 2, g, [-g]), (sd + g * (EDGE_M + PLATFORM_W / 2), PLATFORM_W / 2, -g, [g])]
        for m, half, track_side, dirs in specs:
            a, b = offset(st["p0"], m), offset(st["p1"], m)
            ln = math.hypot(b[0] - a[0], b[1] - a[1])
            mid = offset((st["p0"] + st["p1"]) / 2, m)
            sag = abs(-(mid[0] - a[0]) * (b[1] - a[1]) + (mid[1] - a[1]) * (b[0] - a[0])) / ln
            nseg = 1 if sag <= 0.4 else 2 if sag <= 1.6 else 4   # a platform on a curve: in straight pieces
            zt, z0 = st["at"][2] + RAIL_TOP + PLATFORM_M, st["at"][2]
            for i in range(nseg):
                s0, s1 = (st["p0"] + (st["p1"] - st["p0"]) * k / nseg for k in (i, i + 1))
                a, b = offset(s0, m), offset(s1, m)
                ln = math.hypot(b[0] - a[0], b[1] - a[1])
                ax, ay = (b[0] - a[0]) / ln, (b[1] - a[1]) / ln
                ramps = [i == 0, i == nseg - 1]
                pf = {"station": st["id"], "dirs": dirs, "origin": [round(a[0], 2), round(a[1], 2)], "axis": [round(ax, 4), round(ay, 4)],
                      "half_width": round(half, 2), "length_m": round(ln + (0.15 if i < nseg - 1 else 0), 1), "height_m": round(RAIL_TOP + PLATFORM_M, 2),
                      "ramp_m": RAMP_M, "ramps": ramps, "z": round(zt, 2), "track_side": track_side, "shelter": i == (nseg - 1) // 2}
                platforms.append(pf)
                prof = ([[-RAMP_M, round(z0, 2)]] if ramps[0] else []) + [[0.0, pf["z"]], [pf["length_m"], pf["z"]]] + ([[round(ln + RAMP_M, 1), round(z0, 2)]] if ramps[1] else [])
                surfaces.append({"name": f"{st['name']} platform", "type": "strip", "origin": pf["origin"], "axis": pf["axis"], "half_width": pf["half_width"],
                                 "profile": prof, "thickness": round(pf["height_m"] + 0.4, 2), "label": f"{st['name']} platform"})

    out = dict({k: v for k, v in rc.items() if k not in ("class", "min_length_m", "stations", "crossing_names")}, platforms=platforms, surfaces=surfaces,
               lines=[{"length_m": round(L, 1), "p": _dm(xy, zs)}], loops=loops, street=street, stations=stations, crossings=out_x)
    kinds = {k: sum(1 for c in out_x if c["kind"] == k) for k in ("gated", "foot", "street")}
    print(f"rail train: {L:.0f} m, {len(loops)} loops, {len(stations)} stations, crossings {kinds}, "
          f"{sum(b - a for a, b in street):.0f} m in the street")
    return out
