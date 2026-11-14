"""The Yamanote Line through the Shibuya map: Harajuku, Shibuya and Ebisu, and its trains' courses.

The line runs north and south through the map on OpenStreetMap's two tracks (山手線, cities/shibuya/rail_osm.json,
pipeline/rail_osm.py): from the Yoyogi side past Harajuku, along the Miyashita Park side to the girder bridge east
of the Scramble (the bed cities/shibuya/scramble.py draws, JR), through Shibuya Station, and south beside Meiji-dori
to Ebisu. In the city model all three stations stand inside buildings (JR Shibuya's works-site box, Harajuku's
station building of 2020, the JR Ebisu Building over Ebisu's platforms), so their platforms are not drawn: a train is
not drawn inside a station's box (a course's "dark" stretches), and a station is boarded and left at its street
entrance, OpenStreetMap's railway=train_station_entrance (web/game/trains.js "under"). Between them the trains run
in the open on the bed drawn here.

  levels    the rail is the ground under the track (the 5 m bare-earth model, which has the embankments and the
            cuttings in it) smoothed over 50 m and 0.8 m over it, and over a valley the grade-limited envelope of that
            (an embankment: Shibuya Station is on the second floor over the Shibuya River's valley), across a mapped
            bridge straight from end to end,
            and at the Scramble's bed its rail height (scramble.py JR: 7.4 m over the road); no grade steeper than
            3% (the Yamanote's steepest is about 2.5%)
  trains    E235 sets of eleven cars, each way every three minutes, the inner loop (内回り, south: Shinagawa and
            Tokyo) on the eastern track and the outer loop (外回り, north: Shinjuku and Ikebukuro) on the western,
            keeping left; the platform numbers OpenStreetMap's stopping points give
  overhead  masts every 46 m on the outer side with a cantilever over the track and the contact wire 5.0 m up

meshes(Mesh)   the bed, its rails, its walls where it stands on an embankment or in a cutting, the masts and the
               contact wire, outside the stations' boxes and the Scramble's stretch
trains()       game.json "trains" (web/game/trains.js)
"""
import json
import math
import os

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
LINE = "山手線"
STEP = 5.0           # the courses' sample spacing (m)
GRADE = 0.03
BED_HALF = 2.1       # a track's bed either side of its middle
MAST_EVERY = 46.0
WIRE = 5.0
# the Scramble's bed (scramble.py JR): its stretch, its rail height over the road at `at`
SCRAMBLE = {"x0": 380.0, "x1": 520.0, "y0": -1016.0, "y1": -860.0, "rail_m": 7.4, "at": (430.0, -1000.0)}
# each station: its name, the solids its platforms stand inside in the city model (by OSM id or by name), its street
# entrance (OSM, read 14 November 2026) and the line said as you come up there
STATIONS = [
    {"id": "harajuku", "name": "Harajuku", "native": "原宿", "kana": "はらじゅく", "names": ("原宿駅",), "osm": (),
     "entrance": (139.7026567, 35.6700700), "text": "Out by the East Exit, onto Omotesando's top end."},
    {"id": "shibuya", "name": "Shibuya", "native": "渋谷", "kana": "しぶや", "names": (), "osm": ("w904652357",),
     "entrance": (139.7010554, 35.6589885), "text": "Out through the Hachiko Gate, Hachiko and the Scramble in front of you."},
    {"id": "ebisu", "name": "Ebisu", "native": "恵比寿", "kana": "えびす", "names": ("JR恵比寿ビル", "恵比寿"), "osm": (),
     "entrance": (139.7094755, 35.6470028), "text": "Out by the West Exit, beside the station's Ebisu statue."},
]
SERVICES = [
    {"track": "yamanote-s", "stock": "e235", "cars": 11, "every_s": 180, "offset_s": 30, "stops": True, "v_ms": 19,
     "for": {"ja": "品川・東京方面", "en": "Shinagawa and Tokyo"}, "line": {"ja": "山手線", "en": "Yamanote Line"}},
    {"track": "yamanote-n", "stock": "e235", "cars": 11, "every_s": 180, "offset_s": 120, "stops": True, "v_ms": 19,
     "for": {"ja": "新宿・池袋方面", "en": "Shinjuku and Ikebukuro"}, "line": {"ja": "山手線", "en": "Yamanote Line"}},
]

MATERIALS = {
    "yl_ballast": {"color": "#6d665e", "roughness": 0.95, "metalness": 0.0, "solid": False},
    "yl_steel": {"color": "#8d8478", "roughness": 0.32, "metalness": 0.85, "solid": False},
    "yl_wall": {"color": "#a8a39a", "roughness": 0.9, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.6, "block_m": 1.8},
    "yl_mast": {"color": "#7d8283", "roughness": 0.55, "metalness": 0.6, "solid": False},
    "yl_wire": {"color": "#3b3d3f", "roughness": 0.5, "metalness": 0.7, "solid": False},
}

_S = {}


def city():
    if "C" not in _S:
        from cityctx import City
        _S["C"] = City("shibuya")
    return _S["C"]


def _smooth(v, k):
    out = np.empty_like(v)
    for i in range(len(v)):
        out[i] = np.median(v[max(0, i - k):i + k + 1])
    return out


def layout():
    if "L" in _S:
        return _S["L"]
    path = os.path.join(HERE, "rail_osm.json")
    if not os.path.exists(path):
        return None
    import archkit as ak
    C, D, T = city(), json.load(open(path, encoding="utf8")), ak.Terrain("shibuya")
    loc = lambda ll: [C.fwd.transform(*p) for p in ll]
    pieces = [(LineString(loc(t["ll"])), t) for t in D["tracks"] if t["line"] == LINE]
    merged = shapely.line_merge(shapely.union_all([g for g, _ in pieces]), directed=False)
    parts = sorted(getattr(merged, "geoms", [merged]), key=lambda g: -g.length)
    # the two tracks: chain each of the two longest runs on at each end with the piece that carries it on (a crossover
    # breaks OpenStreetMap's tracks in two north of Shibuya)
    def chain(g, rest):
        g = LineString(g.coords if g.coords[0][1] > g.coords[-1][1] else g.coords[::-1])   # north to south
        while True:
            a, b = Point(g.coords[0]), Point(g.coords[-1])
            best = None
            for q in rest:
                for end, rev in ((0, False), (-1, True)):
                    for tip, at_north in ((a, True), (b, False)):
                        d = Point(q.coords[end]).distance(tip)
                        if d < 10.0 and (best is None or d < best[0]):
                            best = (d, q, end, at_north)
            if not best:
                return g
            _, q, end, at_north = best
            rest.remove(q)
            qc = list(q.coords)
            if at_north:   # q ends where g starts
                qc = qc if end == -1 else qc[::-1]
                g = LineString(qc[:-1] + list(g.coords))
            else:
                qc = qc if end == 0 else qc[::-1]
                g = LineString(list(g.coords) + qc[1:])
    rest = [p for p in parts[2:] if p.length > 40]
    lines = [chain(parts[0], rest), chain(parts[1], rest)]
    lines.sort(key=lambda g: g.interpolate(0.5, normalized=True).x)   # west first
    rx, ry = SCRAMBLE["at"]
    zr = T(rx, ry) + SCRAMBLE["rail_m"]
    bridges = [g for g, t in pieces if t.get("bridge")]
    solids = ak.load_solids("shibuya")
    boxes = {}
    for S in STATIONS:
        ps = [Polygon(q["ring"]).buffer(0) for q in solids if len(q["ring"]) > 2 and (q["osm"] in S["osm"] or q.get("name") in S["names"])]
        # and its platforms near its entrance (Harajuku's run out of its building to the north and south), as OSM maps them
        ex, ey = C.fwd.transform(*S["entrance"])
        for q in D["platforms"]:
            P = Polygon(loc(q["ll"])).buffer(0)
            if P.area > 300 and P.centroid.distance(Point(ex, ey)) < 160 and any(g.distance(P) < 4 for g, _ in pieces):
                ps.append(P.buffer(4.0))
        boxes[S["id"]] = shapely.union_all(ps).buffer(1.0) if ps else Polygon()
    tracks = []
    for g, tid in zip(lines, ("yamanote-n", "yamanote-s")):
        north = tid == "yamanote-n"                 # the western track runs north (keeping left)
        n = int(g.length / STEP) + 1
        pts = np.array([g.interpolate(k * g.length / (n - 1)).coords[0] for k in range(n)])
        s = np.linspace(0, g.length, n)
        ground = np.array([T(x, y) for x, y in pts])
        # the rail never under the ground, and across a valley on an embankment: the upper envelope of the smoothed
        # ground at the steepest grade (Shibuya Station stands in the valley of the Shibuya River on its second floor)
        zs = _smooth(ground, 5) + 0.8
        z = np.max(zs[None, :] - GRADE * STEP * np.abs(np.arange(n)[:, None] - np.arange(n)[None, :]), axis=1)
        fixed = np.zeros(n, bool)
        # across a bridge, straight from end to end
        for b in bridges:
            on = np.array([b.distance(Point(*p)) < 2.5 for p in pts])
            idx = np.flatnonzero(on)
            if len(idx) > 1:
                i0, i1 = idx[0], idx[-1]
                z[i0:i1 + 1] = np.linspace(z[i0], z[i1], i1 - i0 + 1)
        sc = (pts[:, 0] > SCRAMBLE["x0"]) & (pts[:, 0] < SCRAMBLE["x1"]) & (pts[:, 1] > SCRAMBLE["y0"]) & (pts[:, 1] < SCRAMBLE["y1"])
        z[sc], fixed[sc] = zr, True
        # a station is level: its stretch at the highest rail within 30 m of it (at Shibuya, the Scramble's bed)
        for S in STATIONS:
            inb = np.array([boxes[S["id"]].contains(Point(*p)) for p in pts])
            idx = np.flatnonzero(inb)
            if len(idx) < 3:
                continue
            k = int(30 / STEP)
            lo, hi = max(0, idx[0] - k), min(n, idx[-1] + k + 1)
            z[idx[0]:idx[-1] + 1], fixed[idx[0]:idx[-1] + 1] = z[lo:hi].max(), True
        for _ in range(3):   # no grade steeper than GRADE, the Scramble's bed held
            for i in range(1, n):
                if not fixed[i]:
                    z[i] = min(max(z[i], z[i - 1] - GRADE * STEP), z[i - 1] + GRADE * STEP)
            for i in range(n - 2, -1, -1):
                if not fixed[i]:
                    z[i] = min(max(z[i], z[i + 1] - GRADE * STEP), z[i + 1] + GRADE * STEP)
        if north:   # in the direction of travel
            pts, z, ground, sc = pts[::-1], z[::-1], ground[::-1], sc[::-1]
        geom = LineString(pts)
        dark = []
        for S in STATIONS:
            inside = geom.intersection(boxes[S["id"]])
            for q in getattr(inside, "geoms", [inside]):
                if q.is_empty or q.length < 10:
                    continue
                m0, m1 = sorted((geom.project(Point(q.coords[0])), geom.project(Point(q.coords[-1]))))
                dark.append((S["id"], m0, m1))
        tracks.append({"id": tid, "north": north, "pts": pts, "z": z, "ground": ground, "geom": geom, "scramble": sc, "dark": dark})
    # each track's halts: at the station's stopping point on it (OSM railway=stop with its platform number), or the
    # middle of its dark stretch there
    for t in tracks:
        t["stops"] = []
        for S in STATIONS:
            here = [(C.fwd.transform(*q["ll"]), q) for q in D["stops"] if q["name"] == S["native"]]
            near = [(t["geom"].distance(Point(*xy)), xy, q) for xy, q in here]
            near = [v for v in near if v[0] < 2.5]
            dk = [d for d in t["dark"] if d[0] == S["id"]]
            if not dk:
                continue
            m0, m1, half = dk[0][1], dk[0][2], 11 * 20.0 / 2
            if near:
                _, xy, q = min(near, key=lambda v: v[0])
                m, no = t["geom"].project(Point(*xy)), int(q["platform"])
            else:
                m, no = (m0 + m1) / 2, None
            # a standing train inside the building: its middle where the whole of it fits, or the stretch's middle
            m = (m0 + m1) / 2 if m1 - m0 < 2 * half + 10 else min(max(m, m0 + half + 5), m1 - half - 5)
            t["stops"].append({"station": S["id"], "m": round(float(m), 1), **({"platform": no} if no else {})})
        t["stops"].sort(key=lambda h: h["m"])
    L = {"C": C, "T": T, "tracks": tracks, "boxes": boxes, "zr": zr}
    _S["L"] = L
    return L


def _open(t, i):
    """Whether the bed is drawn at sample i: not in a station's box, nor on the Scramble's stretch."""
    if t["scramble"][i]:
        return False
    m = t["geom"].project(Point(*t["pts"][i]))
    return not any(m0 - 4 < m < m1 + 4 for _, m0, m1 in t["dark"])


def meshes(Mesh):
    L = layout()
    if not L:
        return {}, []
    from railkit import Kit, offset
    K = Kit(Mesh, "yl", MATERIALS, uv={"yl_wall", "yl_ballast"})
    T = L["T"]
    for t in L["tracks"]:
        other = [q for q in L["tracks"] if q is not t][0]["geom"]
        P, Z = t["pts"], t["z"]
        ok = np.array([_open(t, i) for i in range(len(P))])
        d = np.gradient(P, axis=0)
        d /= np.linalg.norm(d, axis=1)[:, None]
        nrm = np.stack([-d[:, 1], d[:, 0]], axis=1)
        # the outer side, away from the other track
        out = np.array([1.0 if other.distance(Point(*(p + q * 3))) > other.distance(Point(*(p - q * 3))) else -1.0 for p, q in zip(P, nrm)])
        rails = [offset(P, sg * 1.067 / 2) for sg in (-1, 1)]
        run = []
        for i in range(len(P) + 1):
            if i < len(P) and ok[i]:
                run.append(i)
                continue
            if len(run) > 1:
                R = np.array(run)
                # the bed: ballast either side of the track's middle, a little under the rail
                K["yl_ballast"].grid([[[*(P[k] - nrm[k] * BED_HALF), Z[k] - 0.55], [*(P[k] + nrm[k] * BED_HALF), Z[k] - 0.55]] for k in R],
                                     [[[float(k * STEP), 0.0], [float(k * STEP), 2 * BED_HALF]] for k in R])
                for rl in rails:
                    K["yl_steel"].sweep([[*rl[k], Z[k] - 0.08] for k in R[::2]], [(-0.035, -0.08), (0.035, -0.08), (0.035, 0.08), (-0.035, 0.08)])
                # its walls on the outer side: down to the ground on an embankment, up to it in a cutting
                for a, b in zip(R[:-1], R[1:]):
                    pa, pb = P[a] + nrm[a] * out[a] * BED_HALF, P[b] + nrm[b] * out[b] * BED_HALF
                    ga, gb = T(*pa), T(*pb)
                    za, zb = Z[a] - 0.55, Z[b] - 0.55
                    face = (pa, pb) if out[a] > 0 else (pb, pa)
                    (fa, fza, fga), (fb, fzb, fgb) = ((pa, za, ga), (pb, zb, gb)) if out[a] > 0 else ((pb, zb, gb), (pa, za, ga))
                    if max(za - ga, zb - gb) > 0.5:     # an embankment: the wall from the ground to a coping over the bed
                        K["yl_wall"].quad([*fa, min(fga, fza) - 0.3], [*fb, min(fgb, fzb) - 0.3], [*fb, fzb + 0.9], [*fa, fza + 0.9])
                    elif max(ga - za, gb - zb) > 0.5:   # a cutting: the retaining wall from the bed up to the ground and a parapet
                        K["yl_wall"].quad([*fb, fzb], [*fa, fza], [*fa, max(fga, fza) + 0.9], [*fb, max(fgb, fzb) + 0.9])
                # the masts, the cantilever over the track and the contact wire
                ms = R[:: int(MAST_EVERY / STEP)]
                for k in ms:
                    base = P[k] + nrm[k] * out[k] * (BED_HALF + 0.3)
                    zb_ = min(Z[k] - 0.55, T(*base))
                    K["yl_mast"].tube([[*base, zb_], [*base, Z[k] + WIRE + 1.2]], 0.13, 8)
                    tip = P[k] - nrm[k] * out[k] * 0.6
                    K["yl_mast"].tube([[*base, Z[k] + WIRE + 0.9], [*tip, Z[k] + WIRE + 0.9]], 0.05, 6)
                    K["yl_mast"].tube([[*base, Z[k] + WIRE + 0.3], [*tip, Z[k] + WIRE + 0.9]], 0.04, 6)
                K["yl_wire"].sweep([[*P[k], Z[k] + WIRE] for k in R[::2]], [(-0.012, -0.012), (0.012, -0.012), (0.012, 0.012), (-0.012, 0.012)])
            run = []
    return MATERIALS, [m for m in K.values() if m.v]


def trains():
    L = layout()
    if not L:
        return None
    C, T = L["C"], L["T"]
    tracks = []
    for t in L["tracks"]:
        P, Z = t["pts"], t["z"]
        tracks.append({"id": t["id"], "line": "yamanote", "south": not t["north"], "gauge": 1.067,
                       "p": [v for q, z in zip(P, Z) for v in (round(q[0] * 10), round(q[1] * 10), round(z * 10))],
                       "stops": t["stops"], "hide_m": [3.0, round(t["geom"].length - 3.0, 1)],
                       "dark": [[round(m0 - 2, 1), round(m1 + 2, 1)] for _, m0, m1 in t["dark"]]})
    stations = []
    for S in STATIONS:
        x, y = C.fwd.transform(*S["entrance"])
        stations.append({"id": S["id"], "name": S["name"], "native": S["native"], "kana": S["kana"], "at": [round(x, 1), round(y, 1), round(T(x, y), 2)],
                         "r": 6, "hear_m": 25, "under": {"text": S["text"]}})
    return {
        "note": "The Yamanote Line through the map (cities/shibuya/rail.py): courses in decimetres at rail level, in the direction of travel. The stations stand inside buildings: boarded and left at a street entrance, the trains not drawn inside them.",
        "stations": stations,
        "tracks": tracks,
        "services": SERVICES,
    }
