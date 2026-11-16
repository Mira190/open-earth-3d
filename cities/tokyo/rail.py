"""The JR viaduct through Tokyo Station to Shimbashi, the stations on it, and the trains' courses.

Four double-track lines run side by side here on a viaduct about six metres over the streets: the Keihin-Tohoku
and Yamanote lines on the red-brick arches of 1910 (the elevated line Franz Baltzer laid out for the Railway
Agency on Berlin's Stadtbahn's pattern), the Tokaido Main Line beside them, and the Tokaido Shinkansen on its 1964
concrete viaduct on the east. Yurakucho Station (1910) has two island platforms on the brick arches: 1 and 4 the
Keihin-Tohoku Line, 2 and 3 the Yamanote Line. The Tokaido Line and the Shinkansen have no platform and run
past it. The city's solids leave the whole corridor empty, as the photograph on the ground shows only track.

Everything is laid out on OpenStreetMap's tracks and platform outlines (cities/tokyo/rail_osm.json,
pipeline/rail_osm.py). What is not mapped is from published figures and photographs:
  rail level    about 6.5 m over the street (the arches' crown about 4.5 m, as the height signs under them say);
                the viaduct is all but level, so one level for the whole stretch (RAIL_Z, m T.P.)
  platforms     1,100 mm over the rail (JR East's standard for commuter stock), 11-car (220 m), with platform
                doors on all four tracks (the Yamanote Line's since 2014; the Keihin-Tohoku Line's by JR East's
                programme for 2020)
  gauges        1,067 mm, and 1,435 mm for the Shinkansen
  overhead      contact wire 5.0 m over the rail (Shinkansen 5.0 m), on portal gantries about 50 m apart

meshes(Mesh)       the viaduct (deck, track, the brick arches and the concrete frame under it, girders over the
                   streets, parapets, overhead line), the station (platforms, canopies, lights, signs, platform doors,
                   stairs up from the concourse under the tracks) and a train shed's mouth at each end, where the
                   trains come from and go to
surfaces()         the platforms and the stairs, for the game to walk on
trains()           game.json "trains": each track's course and what runs on it (web/game/trains.js)
assets(out_dir)    the signs' sheet (rail_signs.png)
glows()            the station's own light on its platforms after dark
demolished()       the city's low solids under the platforms
"""
import json
import math
import os

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import substring

from railkit import Kit, bay, offset, ribbon, tri_poly, wall

HERE = os.path.dirname(os.path.abspath(__file__))
RAIL_Z = 9.2            # top of rail, m T.P.
PLAT = 1.1              # a platform over the rail
EDGE = 1.52             # a platform's face from its track's middle
SLAB = 0.9              # the deck under the rail (ballast and slab)
N_GATE, S_GATE = 470.0, 2895.0   # the stretch, in metres along the reference track from where the data starts
SHINK_GATE = 1066.0     # the Tokaido Shinkansen's own north end: its platforms at Tokyo (14 to 19) stand east of this stretch, under their roof
# the stations on it, each by the stretch of the reference its platforms lie in: OpenStreetMap's platform outlines there,
# numbered by its stopping points (railway=stop, local_ref) on each track
STATIONS = [
    # Tokyo Station's platforms on this viaduct, 3 to 10 (OpenStreetMap maps each as a multipolygon of its edges). 1 and 2
    # (the Chuo Line, on its own higher viaduct) and the Shinkansen's are not this stretch's
    {"key": "yurakucho", "name": "Yurakucho", "native": "有楽町", "kana": "ゆうらくちょう", "romaji": "Yūrakuchō", "s": (1400.0, 1760.0),
     "codes": {"yamanote": "JY 30", "keihin": "JK 25"}, "prev": ("新橋", "Shimbashi"), "next": ("東京", "Tōkyō")},
    {"key": "shimbashi", "name": "Shimbashi", "native": "新橋", "kana": "しんばし", "romaji": "Shimbashi", "s": (2480.0, 2840.0),
     "codes": {"yamanote": "JY 29", "keihin": "JK 24", "tokaido": "JT 02"}, "prev": ("浜松町", "Hamamatsuchō"), "next": ("有楽町", "Yūrakuchō"),
     "prev_line": {"tokaido": ("品川", "Shinagawa")}, "next_line": {"tokaido": ("東京", "Tōkyō")}},
    # its passages under the tracks are on the Marunouchi building's two domes (cities/tokyo/station.py opens each dome's
    # hall onto its passage): "passages" [(where along the reference, which way its flights climb: 1 southward, and a
    # letter for a passage that is not the first to climb that way)], and no fascia on the west, where the passage runs
    # on into the building. The central passage (中央通路) is where OpenStreetMap maps its footway under the tracks (768 m
    # along the reference) and, on each platform, a flight down to it from the north and one from the south, their feet
    # at the passage: as JR East's station map draws it, stairs and an escalator either side of the passage on every
    # platform
    {"key": "tokyo", "name": "Tokyo", "native": "東京", "kana": "とうきょう", "romaji": "Tōkyō", "s": (590.0, 945.0), "refs": ("3;4", "5;6", "7;8", "9;10"),
     "passages": [(695.0, (1,)), (768.0, (-1, 1), "c"), (889.0, (-1,))], "fascia": (1,), "shut": ("c",),   # (shut: a passage that ends at the block behind the building, its west end walled)
     # the way in on foot, for the game's check: from the plaza before the south dome's doors, through its hall and the
     # passage (station.py: the dome's centre, 26 m and 33 m along its axis either way), to the stairs to platforms 5 and 6
     "way": {"hall": (610.2, 1167.6), "axis": (0.943, -0.333), "out_m": 26.0, "in_m": 33.0, "platform": 5},
     "codes": {"yamanote": "JY 01", "keihin": "JK 26", "tokaido": "JT 01"}, "prev": ("有楽町", "Yūrakuchō"), "next": ("神田", "Kanda"),
     "prev_line": {"tokaido": ("新橋", "Shimbashi")}, "next_line": {"tokaido": ("上野", "Ueno")}},
]
PSD_LINES = ("yamanote", "keihin")   # the lines whose platforms have platform doors (the Tokaido Line's at Shimbashi have none)
SHED = 46.0             # a train shed's mouth at each end, inside the gates
BEHIND = (655.0, 896.0)  # where the viaduct's west face stands against the block behind the Marunouchi building (cities/tokyo/station.py chuo)
# (the Tohoku Main Line's pair north of Tokyo's tracks 7 and 10 is the Tokaido Line's, run through: the Ueno-Tokyo Line)
LINES = {"京浜東北線": "keihin", "山手線": "yamanote", "東海道本線": "tokaido", "東北本線": "tokaido", "東海道新幹線": "shinkansen"}
NATIVE = {"keihin": "京浜東北線", "yamanote": "山手線", "tokaido": "東海道本線", "shinkansen": "東海道新幹線"}
ROADW = {"motorway": 14, "trunk": 13, "primary": 13, "secondary": 11, "tertiary": 9, "residential": 7, "unclassified": 6, "living_street": 5}
CAR = 20.0              # a commuter car, coupler to coupler
DOORS = (-7.23, -2.41, 2.41, 7.23)   # its four doors a side, from its middle (a 4.82 m pitch)

MATERIALS = {
    "rail_ballast": {"color": "#6a625a", "roughness": 0.95, "metalness": 0.0},
    "rail_bed": {"color": "#6a625a", "roughness": 0.95, "metalness": 0.0, "pattern": "deck_zones", "zones": [[2.7, "rail"]], "solid": False},
    "rail_steel": {"color": "#8d8478", "roughness": 0.32, "metalness": 0.85, "solid": False},
    "rail_brick": {"color": "#8c4a38", "roughness": 0.85, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.085, "block_m": 0.23},
    "rail_stone": {"lamp_lit": True, "color": "#968f82", "roughness": 0.85, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.3, "block_m": 0.62},
    "rail_concrete": {"lamp_lit": True, "color": "#a8a59c", "roughness": 0.85, "metalness": 0.0},
    "rail_parapet": {"lamp_lit": True, "color": "#a8a59c", "roughness": 0.85, "metalness": 0.0, "solid": False},   # (the deck's edge beside the tracks, where nobody walks)
    "rail_soffit": {"color": "#8f8c85", "roughness": 0.9, "metalness": 0.0},
    "rail_girder": {"color": "#7b9086", "roughness": 0.55, "metalness": 0.35, "solid": False},
    "rail_shop": {"color": "#2b2f33", "roughness": 0.25, "metalness": 0.3, "pattern": "curtain_wall", "bay_m": 1.3, "storey_m": 3.4,
                  "spandrel": 0.16, "frame": "#3a332c", "mullion_m": 0.1, "lit_share": 0.9, "lit_k": 1.5, "warm_share": 0.92},
    "rail_shutter": {"lamp_lit": True, "color": "#8d8f8c", "roughness": 0.6, "metalness": 0.4},
    "rail_mast": {"color": "#6f7c7a", "roughness": 0.6, "metalness": 0.5, "solid": False},
    "rail_wire": {"color": "#3c3a36", "roughness": 0.5, "metalness": 0.7, "shadow": False, "solid": False},
    "rail_platform": {"color": "#b4aea4", "roughness": 0.8, "metalness": 0.0, "pattern": "granite", "joints_m": [0.3, 0.3], "street_lit": True},
    # a concourse's floor under the tracks: pale granite in 0.6 m slabs, laid on the ground there (not solid: the ground is)
    "rail_floor": {"lamp_lit": True, "color": "#b0aaa0", "roughness": 0.75, "metalness": 0.0, "pattern": "granite", "joints_m": [0.6, 0.6], "solid": False},
    "rail_stairs": {"lamp_lit": True, "color": "#a9a49b", "roughness": 0.8, "metalness": 0.0},
    "rail_yellow": {"lamp_lit": True, "color": "#e8c21c", "roughness": 0.7, "metalness": 0.0, "decal": True, "solid": False},
    "rail_white": {"lamp_lit": True, "color": "#ecebe6", "roughness": 0.6, "metalness": 0.0, "decal": True, "solid": False},
    "rail_roof": {"color": "#c4c8c6", "roughness": 0.5, "metalness": 0.5},
    "rail_ceiling": {"lamp_lit": True, "color": "#e4e2da", "roughness": 0.7, "metalness": 0.0, "solid": False},
    "rail_frame": {"lamp_lit": True, "color": "#a9b7b8", "roughness": 0.55, "metalness": 0.4},
    "rail_lamp": {"color": "#f4f6ee", "roughness": 0.4, "metalness": 0.0, "emissive": "#f2fbe9", "glow": 2.6, "glow_day": 0.9, "solid": False},
    "rail_psd": {"lamp_lit": True, "color": "#eceeed", "roughness": 0.45, "metalness": 0.2},
    "rail_psd_glass": {"color": "#bcd3d6", "roughness": 0.08, "metalness": 0.3, "opacity": 0.32, "solid": False},
    "rail_psd_line": {"lamp_lit": True, "color": "#7cc142", "roughness": 0.5, "metalness": 0.0, "solid": False},
    "rail_sign": {"color": "#ffffff", "roughness": 0.5, "metalness": 0.0, "map": "rail_signs.png", "emissive_map": True, "glow": 1.25, "glow_day": 0.35, "solid": False},
    "rail_bench": {"lamp_lit": True, "color": "#3d6f9a", "roughness": 0.6, "metalness": 0.1},
    "rail_dark": {"color": "#16181a", "roughness": 0.9, "metalness": 0.0, "solid": False},
    # ("solid": False above: what no walker or car can reach or needs to meet, the rails and their bed, the overhead line,
    # the lamps, the signs, the paint on the platform, the ceilings under the roofs: no box of the collision world's)
    # an escalator's skirts, glass and handrails: not solid to a walker (the well's walls hold one in; 1.1 m apart, the
    # balustrades in the collision world's quarter-metre cells left no room between them for a walker's 0.7 m)
    "rail_esc_frame": {"lamp_lit": True, "color": "#a9b7b8", "roughness": 0.55, "metalness": 0.4, "solid": False},
    "rail_esc_glass": {"color": "#bcd3d6", "roughness": 0.08, "metalness": 0.3, "opacity": 0.32, "solid": False},
    "rail_esc_dark": {"color": "#16181a", "roughness": 0.9, "metalness": 0.0, "solid": False},
}

_S = {}


# ---------------------------------------------------------------- the layout, from the mapped tracks

def city():
    if "C" not in _S:
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), "pipeline"))
        from cityctx import City
        _S["C"] = City("tokyo")
    return _S["C"]


def layout():
    """Everything the meshes, the strips and the game data share, worked out once."""
    if "L" in _S:
        return _S["L"]
    path = os.path.join(HERE, "rail_osm.json")
    if not os.path.exists(path):
        return None
    import archkit as ak
    C, D, T = city(), json.load(open(path, encoding="utf8")), ak.Terrain("tokyo")
    loc = lambda ll: [C.fwd.transform(*p) for p in ll]
    by = {}
    for t in D["tracks"]:
        by.setdefault(LINES[t["line"]], []).append(LineString(loc(t["ll"])))
    through = {}
    for name, ls in by.items():
        m = shapely.line_merge(shapely.union_all(ls))
        through[name] = sorted(getattr(m, "geoms", [m]), key=lambda g: -g.length)[:2]
    south = lambda g: g if g.coords[0][1] > g.coords[-1][1] else LineString(g.coords[::-1])
    # the reference: the Yamanote track nearer the east (the outer loop, southbound), from north to south
    ya = [south(g) for g in through["yamanote"]]
    ref = max(ya, key=lambda g: g.interpolate(g.project(Point(370, 550))).x)

    def frame(s):
        a, b = ref.interpolate(s - 0.5), ref.interpolate(s + 0.5)
        t = np.array([b.x - a.x, b.y - a.y])
        t /= np.linalg.norm(t)
        p = ref.interpolate(s)
        return np.array([p.x, p.y]), t, np.array([-t[1], t[0]])   # the point, along (southward), across (to the east)

    def sv(x, y):
        s = ref.project(Point(x, y))
        p, t, n = frame(s)
        return s, float((np.array([x, y]) - p) @ n)

    def gate(s, half=90.0):
        p, t, n = frame(s)
        return LineString([p - n * half, p + n * half])

    band = substring(ref, N_GATE, S_GATE).buffer(90.0, cap_style="flat")
    shink = substring(ref, SHINK_GATE, S_GATE).buffer(90.0, cap_style="flat")
    tracks = []
    for name, gs in through.items():
        for g in gs:
            g = south(g).intersection(shink if name == "shinkansen" else band)
            g = max(getattr(g, "geoms", [g]), key=lambda q: q.length)
            n = max(2, int(g.length / 5.0) + 1)
            pts = np.array([g.interpolate(k / (n - 1), normalized=True).coords[0] for k in range(n)])
            v = sv(*pts[len(pts) // 2])[1]
            tracks.append({"line": name, "native": NATIVE[name], "pts": pts, "geom": LineString(pts), "side": v})
    tracks.sort(key=lambda t: sv(*t["geom"].interpolate(t["geom"].project(Point(370, 550))).coords[0])[1])
    # left-hand running: of each pair the western track runs north (towards Tokyo), the eastern south.
    # Keihin-Tohoku's two tracks are the outer pair round the Yamanote's
    seen = {}
    for t in tracks:
        t["south"] = bool(seen.get(t["line"]))
        seen[t["line"]] = 1
        t["gauge"] = 1.435 if t["line"] == "shinkansen" else 1.067
    # a station's platform tracks that no through line runs on (Tokyo's 8 and 9: OpenStreetMap's service tracks beside
    # a platform here): laid and wired like the rest, with their numbers, and no train of this timetable on them
    still = []
    raw = [Polygon(loc(p["ll"])) for p in D["platforms"] if any(p.get("ref") in S.get("refs", ()) for S in STATIONS)]
    for q in D.get("sidings", []):
        g = LineString(loc(q["ll"])).intersection(band)
        if g.is_empty or g.geom_type != "LineString" or g.length < 60 or not any(P.is_valid and g.intersection(P.buffer(4.0)).length > 60 for P in raw):
            continue
        g = south(g)
        n = max(2, int(g.length / 5.0) + 1)
        pts = np.array([g.interpolate(k / (n - 1), normalized=True).coords[0] for k in range(n)])
        still.append({"line": "tokaido", "native": NATIVE["tokaido"], "pts": pts, "geom": LineString(pts), "side": sv(*pts[len(pts) // 2])[1], "south": False, "gauge": 1.067, "still": True})
    # the platforms of each station, each as frames along the reference: (s, centre, across, width)
    plats = []
    for p in D["platforms"]:
        P = Polygon(loc(p["ll"])).buffer(0)
        if P.area < 800:
            continue
        sc, vc = sv(P.centroid.x, P.centroid.y)
        st = next((S for S in STATIONS if S["s"][0] < sc < S["s"][1]), None)
        if not st or ("refs" in st and p.get("ref") not in st["refs"]):
            continue
        if "refs" not in st and (abs(vc) > 40 or not any(t["geom"].distance(P) < 3.5 for t in tracks)):
            continue
        ss = [sv(*c)[0] for c in P.exterior.coords]
        fr = []
        for s in np.arange(min(ss) + 1.0, max(ss) - 0.99, 2.0):
            q = gate(s, 70).intersection(P)
            if q.is_empty:
                continue
            q = max(getattr(q, "geoms", [q]), key=lambda g: g.length)
            (x0, y0), (x1, y1) = q.coords[0], q.coords[-1]
            p0, t, n = frame(s)
            if "refs" in st:
                # Tokyo's outlines are drawn a metre or two off the rails either way: each face is set from the track
                # beside it, EDGE from its middle (the structure gauge's platform face), and the outline keeps the ends
                va, vb = sorted(((x0 - p0[0]) * n[0] + (y0 - p0[1]) * n[1], (x1 - p0[0]) * n[0] + (y1 - p0[1]) * n[1]))
                cut = gate(s, 70)
                tv = sorted(float((np.array(h.coords[0]) - p0) @ n) for tk in tracks + still for h in [tk["geom"].intersection(cut)] if h.geom_type == "Point")
                west, east = [v for v in tv if abs(v + EDGE - va) < 4.5], [v for v in tv if abs(v - EDGE - vb) < 4.5]
                if west:
                    va = min(west, key=lambda v: abs(v + EDGE - va)) + EDGE
                if east:
                    vb = min(east, key=lambda v: abs(v - EDGE - vb)) - EDGE
                if vb - va < 2.4:
                    continue
                (x0, y0), (x1, y1) = p0 + n * va, p0 + n * vb
            fr.append((float(s), np.array([(x0 + x1) / 2, (y0 + y1) / 2]), t, n, float(math.hypot(x1 - x0, y1 - y0))))
        if "refs" in st:
            P = Polygon([f[1] - f[3] * f[4] / 2 for f in fr] + [f[1] + f[3] * f[4] / 2 for f in fr[::-1]]).buffer(0)
        plats.append({"ref": p.get("ref", ""), "poly": P, "frames": fr, "side": vc, "station": st["key"]})
    plats.sort(key=lambda p: ([S["key"] for S in STATIONS].index(p["station"]), p["side"]))
    for p, k in zip(plats, "abcdefghijklmnop"):
        p["key"] = k
    # each platform's two faces: the track beside each (sgn -1 the west face, +1 the east) and its number, from the
    # stopping point mapped on that track at that station
    for p in plats:
        S = next(S for S in STATIONS if S["key"] == p["station"])
        f = p["frames"][len(p["frames"]) // 2]
        p["edges"] = {}
        for sgn in (-1, 1):
            e = f[1] + f[3] * sgn * (f[4] / 2 + 1.6)
            t = min(tracks + still, key=lambda t: t["geom"].distance(Point(*e)))
            if t["geom"].distance(Point(*e)) > 1.6:
                continue
            no = None
            for q in D["stops"]:
                if q["name"] != S["native"] or not str(q["platform"]).isdigit():
                    continue
                x, y = C.fwd.transform(*q["ll"])
                if t["geom"].distance(Point(x, y)) < 2.0 and S["s"][0] < sv(x, y)[0] < S["s"][1]:
                    no = int(q["platform"])
            if no is not None:
                p["edges"][sgn] = (t, no)
        p["nums"] = tuple(p["edges"][g][1] if g in p["edges"] else None for g in (-1, 1))
    # the deck: the tracks' and the platforms' ground, closed up between neighbouring tracks
    deck = shapely.union_all([t["geom"].buffer(2.55, cap_style="flat") for t in tracks + still] + [p["poly"].buffer(0.3) for p in plats])
    deck = deck.buffer(2.0, join_style="mitre").buffer(-2.0, join_style="mitre").intersection(band).simplify(0.25)
    deck = max(getattr(deck, "geoms", [deck]), key=lambda g: g.area) if deck.geom_type != "Polygon" else deck
    deck = Polygon(deck.exterior, [h for h in deck.interiors if Polygon(h).area > 150])
    # the city's solids in its way: the low ones under the platforms (the old station's rooms, which the viaduct
    # built here stands in for) come down; a tower whose corner the mapped tracks clip keeps its corner
    gone = []
    for q in ak.load_solids("tokyo"):
        if len(q["ring"]) < 3:
            continue
        P = Polygon(q["ring"]).buffer(0)
        if not P.intersects(deck) or P.intersection(deck).area < 1:
            continue
        if q["top"] < RAIL_Z - 1 and P.intersection(deck).area > 0.6 * P.area:
            gone.append(q["si"])
        elif q["top"] < 25 and (P.intersection(deck).area > 0.4 * P.area or (P.area > 2000 and P.intersection(deck).area > 0.25 * P.area)):
            gone.append(q["si"])   # a station's shed over its platforms (Shimbashi's), or a low block on the tracks: the viaduct is built in its place
        else:
            deck = deck.difference(P.buffer(0.6))
            deck = max(getattr(deck, "geoms", [deck]), key=lambda g: g.area)
    # the station's concourse, straight across under the tracks at the middle of the platforms, and the streets
    # and footways that pass under the viaduct
    sta = []
    for S in STATIONS:
        mine = [p for p in plats if p["station"] == S["key"]]
        if not mine:
            continue
        mid = float(np.mean([f[0] for p in mine for f in p["frames"]]))
        # each concourse: where it crosses, which way its flights climb (-1 northward, 1 southward), its strip
        concs = [(m, d, Polygon([*gate(m - 9).coords, *gate(m + 9).coords[::-1]]), "".join(tag)) for m, d, *tag in S.get("passages", [(mid, (-1, 1))])]
        sta.append(dict(S, plats=mine, mid=mid, concs=concs, conc=shapely.union_all([c[2] for c in concs])))
    mid, conc = sta[0]["mid"], sta[0]["conc"]
    G = json.load(open(os.path.join(C.out, "game.json")))
    near = deck.buffer(7.0)
    cuts = [S["conc"] for S in sta]
    for kind, arr in G["paths"].items():
        for o in arr:
            p = np.asarray(o["p"], float).reshape(-1, 3) / 10
            if len(p) < 2 or p[:, 2].max() > RAIL_Z - 2:   # (an expressway over the tracks is no street under them)
                continue
            ln = LineString(p[:, :2])
            if not ln.intersects(deck):
                continue
            w = ROADW.get(o.get("c"), 7) / 2 + 3.2 if kind == "road" else 2.6
            # only a way that crosses: one that runs along under the tracks for a long way is left closed
            part = ln.intersection(near)
            for q in getattr(part, "geoms", [part]):
                if q.geom_type == "LineString" and q.length < 95 and q.intersects(deck):
                    # (a metre past each end: a way that stops under the tracks ends that far short of its bay's end
                    # wall, and is not cut back by it again each time the game's footways are closed at the walls)
                    c = np.asarray(q.coords, float)
                    e0, e1 = c[0] - c[1], c[-1] - c[-2]
                    c[0], c[-1] = c[0] + e0 / (np.linalg.norm(e0) or 1.0) * 1.0, c[-1] + e1 / (np.linalg.norm(e1) or 1.0) * 1.0
                    cuts.append(LineString(c).buffer(w, cap_style="flat"))
    openings = shapely.union_all(cuts).buffer(1.5).buffer(-1.5)
    L = {"C": C, "T": T, "ref": ref, "frame": frame, "sv": sv, "gate": gate, "band": band, "tracks": tracks, "still": still, "plats": plats, "deck": deck,
         "openings": openings, "mid": mid, "conc": conc, "stops": D["stops"], "gone": gone, "stations": sta}
    L["stairs"] = stairs(L)
    _S["L"] = L
    return L


def stairs(L):
    """Two flights up to each platform from the concourse, one to the north and one to the south: each
    {key, plat, up ("n" or "s": which way it climbs), of (its passage's letter, "" the first), a (foot), b (head),
    t (along, uphill), n, w, z0, z1, run}."""
    out = []
    T = L["T"]
    concs = {S["key"]: S["concs"] for S in L["stations"]}
    for p in L["plats"]:
        fr = {round(f[0]): f for f in p["frames"]}
        ss = sorted(fr)
        for mid, d, tag, of in [(m, d, "n" if d < 0 else "s", of) for m, dirs, _, of in concs[p["station"]] for d in dirs]:   # uphill towards the north, or the south
            s0 = mid + d * 8.2    # the foot, just inside the concourse
            f0 = fr[min(ss, key=lambda s: abs(s - s0))]
            c0 = f0[1] + f0[2] * (s0 - f0[0])
            z0, z1 = T(*c0) + 0.02, RAIL_Z + PLAT
            run = (z1 - z0) / 0.5 + 1.6   # 1 in 2, and a landing half way
            f1 = fr[min(ss, key=lambda s: abs(s - (s0 + d * run)))]
            c1 = f1[1] + f1[2] * (s0 + d * run - f1[0])
            t = (c1 - c0) / np.linalg.norm(c1 - c0)
            n = np.array([-t[1], t[0]])
            c0 = c0 - n * (ESC_W + 0.15) / 2   # (the flight and the escalator beside it, together on the platform's middle)
            out.append({"key": f"{p['key']}{of}{tag}", "plat": p["key"], "up": tag, "of": of, "a": c0, "b": c0 + t * run, "t": t, "n": n, "w": 3.0,
                        "z0": z0, "z1": z1, "run": run})
    return out


def stair_slot(st, grow=0.0):
    """The flight's well, and the escalator's beside it on its +n side."""
    a, b, n, w = st["a"], st["b"], st["n"], st["w"] / 2 + grow
    return Polygon([a - n * w, b - n * w, b + n * (w + ESC_W + 0.15), a + n * (w + ESC_W + 0.15)])


OF = {"": "the ", "c": "the central passage's "}   # a flight's passage in its name, by the passage's letter
ESC_W = 1.45     # an escalator's width over its balustrades (a 1,000 mm step); its middle ESC_V off the flight's
ESC_V = 1.5 + 0.15 + ESC_W / 2
ESC_MS = 0.5     # its speed (m/s), JR East's standard


def escalator(st):
    """The up escalator beside a flight: its foot (the flight's foot), how far along its 30-degree incline starts and
    ends, its axis, and the levels."""
    a, t, n = st["a"], st["t"], st["n"]
    rise = st["z1"] - st["z0"]
    inc = rise / math.tan(math.radians(30))
    flat = max(0.9, (st["run"] - inc) / 2)
    return {"a": a + n * ESC_V, "t": t, "n": n, "u0": flat, "u1": flat + inc, "L": 2 * flat + inc, "z0": st["z0"], "z1": st["z1"]}


# ---------------------------------------------------------------- the signs' sheet

# each sign: (key, pixel box x, y, w, h) on a 2048 x 1024 sheet; faces take their UVs from here
SHEET = (2048, 2048)
SIGNS = {}
# each platform board's number, line and where its trains go, by station and number
ROWS = {
    "yurakucho": {1: ("keihin", "京浜東北線", "東京・上野・大宮 方面", "Keihin-Tōhoku Line  for Tōkyō, Ueno, Ōmiya"),
                  2: ("yamanote", "山手線", "東京・上野 方面", "Yamanote Line  for Tōkyō, Ueno"),
                  3: ("yamanote", "山手線", "品川・渋谷 方面", "Yamanote Line  for Shinagawa, Shibuya"),
                  4: ("keihin", "京浜東北線", "品川・横浜 方面", "Keihin-Tōhoku Line  for Shinagawa, Yokohama")},
    "shimbashi": {1: ("tokaido", "東海道線", "品川・横浜・小田原 方面", "Tōkaidō Line  for Shinagawa, Yokohama, Odawara"),
                  2: ("tokaido", "東海道線", "東京・上野 方面", "Tōkaidō Line  for Tōkyō, Ueno"),
                  3: ("keihin", "京浜東北線", "品川・横浜 方面", "Keihin-Tōhoku Line  for Shinagawa, Yokohama"),
                  4: ("yamanote", "山手線", "品川・渋谷 方面", "Yamanote Line  for Shinagawa, Shibuya"),
                  5: ("yamanote", "山手線", "東京・上野 方面", "Yamanote Line  for Tōkyō, Ueno"),
                  6: ("keihin", "京浜東北線", "東京・上野・大宮 方面", "Keihin-Tōhoku Line  for Tōkyō, Ueno, Ōmiya")},
    "tokyo": {3: ("keihin", "京浜東北線", "上野・大宮 方面", "Keihin-Tōhoku Line  for Ueno, Ōmiya"),
              4: ("yamanote", "山手線", "上野・池袋 方面", "Yamanote Line  for Ueno, Ikebukuro"),
              5: ("yamanote", "山手線", "品川・渋谷 方面", "Yamanote Line  for Shinagawa, Shibuya"),
              6: ("keihin", "京浜東北線", "品川・横浜 方面", "Keihin-Tōhoku Line  for Shinagawa, Yokohama"),
              7: ("tokaido", "上野東京ライン", "上野・大宮・水戸 方面", "Ueno-Tōkyō Line  for Ueno, Ōmiya, Mito"),
              8: ("tokaido", "上野東京ライン", "上野・大宮・水戸 方面", "Ueno-Tōkyō Line  for Ueno, Ōmiya, Mito"),
              9: ("tokaido", "東海道線", "品川・横浜・小田原 方面", "Tōkaidō Line  for Shinagawa, Yokohama, Odawara"),
              10: ("tokaido", "東海道線", "品川・横浜・小田原 方面", "Tōkaidō Line  for Shinagawa, Yokohama, Odawara")},
}


# each sign is drawn at its design size (DESIGN) and set into its box on the sheet (SIGNS: x, y, w, h, and whether it
# lies on its side, its foot to the right: the entrances' long fascias, three abreast)
DESIGN = {}


def _layout_signs():
    if SIGNS:
        return
    k = 0
    for S in STATIONS:                            # the stations' name boards, one per line, 3.2 x 1.0 m
        for line in S["codes"]:
            SIGNS[f"name_{S['key']}_{line}"], DESIGN[f"name_{S['key']}_{line}"] = (0, k * 250, 800, 250, False), (1024, 320)
            k += 1
    k = 0
    for S in STATIONS:                            # platform and direction boards, 4.2 x 0.6 m
        for i in ROWS[S["key"]]:
            SIGNS[f"dir_{S['key']}_{i}"], DESIGN[f"dir_{S['key']}_{i}"] = (800, k * 112, 800, 112, False), (1024, 146)
            k += 1
    for k, S in enumerate(STATIONS):              # each entrance's fascia, 9 x 1.4 m, on its side
        SIGNS[f"entrance_{S['key']}"], DESIGN[f"entrance_{S['key']}"] = (1600 + k * 148, 0, 144, 920, True), (1024, 160)
    y = 928
    for i, k in enumerate(("keihin-n", "yamanote-n", "yamanote-s", "keihin-s")):   # departure boards, 2.4 x 0.6 m
        SIGNS[f"led_{k}"], DESIGN[f"led_{k}"] = (1600, y + i * 114, 446, 112, False), (510, 128)
    y += 4 * 114 + 4
    for k, S in enumerate(STATIONS):              # over the ticket gates
        SIGNS[f"gates_{S['key']}"], DESIGN[f"gates_{S['key']}"] = (1600, y + k * 72, 446, 70, False), (640, 100)
    y += 3 * 72 + 4
    SIGNS["vending"], DESIGN["vending"] = (1600, y, 180, 210, False), (180, 210)        # a drinks machine's front
    SIGNS["vending2"], DESIGN["vending2"] = (1790, y, 170, 210, False), (170, 210)
    SIGNS["blank"], DESIGN["blank"] = (1980, 1980, 60, 60, False), (60, 60)         # a lit white panel
    assert len(STATIONS) <= 3 and all(b[1] + b[3] <= SHEET[1] and b[0] + b[2] <= SHEET[0] for b in SIGNS.values())


def sign_uv(key):
    _layout_signs()
    x, y, w, h, side = SIGNS[key]
    W, H = SHEET
    if side:   # the design's left at the box's foot, its top at the box's left
        return [[(x + w) / W, 1 - (y + h) / H], [(x + w) / W, 1 - y / H], [x / W, 1 - y / H], [x / W, 1 - (y + h) / H]]
    return [[x / W, 1 - (y + h) / H], [(x + w) / W, 1 - (y + h) / H], [(x + w) / W, 1 - y / H], [x / W, 1 - y / H]]


def sign(K, c, N, w, z0, h, key, off=0.05):
    """A sign's lit face, w wide and h high, its middle at c (plan) and its foot at z0, read from the side N points to."""
    c, N = np.asarray(c, float), np.asarray(N, float)
    r = np.array([-N[1], N[0]])    # the reader's right
    a, b = c - r * w / 2 + N * off, c + r * w / 2 + N * off
    K["rail_sign"].quad([*a, z0], [*b, z0], [*b, z0 + h], [*a, z0 + h], sign_uv(key))


def assets(out_dir):
    """Draw the signs: JR East's station name boards, the platform boards with their line colours, the departure
    boards' orange and green LEDs, the entrance. The lettering is IPA Gothic (IPA Font License) where it is
    installed, else the default face."""
    from PIL import Image, ImageDraw, ImageFont
    _layout_signs()
    img = Image.new("RGB", SHEET, (20, 22, 24))
    d = cur = None

    def begin(key):
        nonlocal d, cur
        cur = Image.new("RGB", DESIGN[key], (20, 22, 24))
        d = ImageDraw.Draw(cur)
        return (0, 0, *DESIGN[key])

    def end(key):
        x, y, w, h, side = SIGNS[key]
        im = cur.resize((h, w) if side else (w, h), Image.LANCZOS)
        img.paste(im.rotate(90, expand=True) if side else im, (x, y))

    def font(size, bold=False):
        for p in ("/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf", "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
                  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"):
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
        return ImageFont.load_default()

    def text(xy, s, size, fill, anchor="mm", stroke=0):
        d.text(xy, s, font=font(size), fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=fill)

    GREEN, YAM, KEI, TOK = (0, 138, 62), (128, 194, 65), (0, 178, 229), (246, 139, 31)
    COL = {"yamanote": YAM, "keihin": KEI, "tokaido": TOK}
    # the name boards: white, the line's band along the foot with this station's square, the neighbours either side
    for S in STATIONS:
        for line, code in S["codes"].items():
            col, prev, nxt = COL[line], S.get("prev_line", {}).get(line, S["prev"]), S.get("next_line", {}).get(line, S["next"])
            key = f"name_{S['key']}_{line}"
            x, y, w, h = begin(key)
            d.rectangle([x, y, x + w - 1, y + h - 1], fill=(248, 248, 244))
            text((x + w / 2, y + 86), S["native"], 118, (20, 20, 20), stroke=2)
            text((x + w / 2, y + 168), S["kana"], 38, (40, 40, 40))
            text((x + w / 2, y + 214), S["romaji"], 40, (20, 20, 20), stroke=1)
            d.rectangle([x, y + 246, x + w - 1, y + 276], fill=GREEN)
            d.rectangle([x + w / 2 - 34, y + 240, x + w / 2 + 34, y + 282], fill=col)
            d.polygon([(x + 26, y + 261), (x + 60, y + 243), (x + 60, y + 279)], fill=(248, 248, 244))
            d.polygon([(x + w - 26, y + 261), (x + w - 60, y + 243), (x + w - 60, y + 279)], fill=(248, 248, 244))
            text((x + 150, y + 296), prev[0], 30, (20, 20, 20))
            text((x + 290, y + 298), prev[1], 24, (60, 60, 60))
            text((x + w - 290, y + 296), nxt[0], 30, (20, 20, 20))
            text((x + w - 150, y + 298), nxt[1], 24, (60, 60, 60))
            d.rounded_rectangle([x + 60, y + 30, x + 180, y + 120], 12, outline=col, width=9)
            text((x + 120, y + 75), code, 36, (20, 20, 20), stroke=1)
            end(key)
    # the platform boards: the number in a white square, the line's colour, where the trains go
    for sk, i, (ln, line, to, en) in [(sk, i, r) for sk, rows in ROWS.items() for i, r in rows.items()]:
        col = COL[ln]
        x, y, w, h = begin(f"dir_{sk}_{i}")
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(34, 36, 40))
        d.rectangle([x, y, x + 12, y + h - 1], fill=col)
        d.rounded_rectangle([x + 30, y + 22, x + 132, y + h - 22], 8, fill=(246, 246, 240))
        text((x + 81, y + h / 2), str(i), 96 if i < 10 else 72, (20, 20, 20), stroke=2)
        d.rounded_rectangle([x + 158, y + 30, x + 196, y + 68], 6, fill=col)
        text((x + 210, y + 50), line, 40, (246, 246, 240), anchor="lm")
        text((x + (470 if len(line) < 6 else 500), y + 52), to, 54 if len(to) < 10 and len(line) < 6 else 44, (246, 246, 240), anchor="lm", stroke=1)
        text((x + 160, y + 112), en, 30, (214, 214, 208), anchor="lm")
        end(f"dir_{sk}_{i}")
    # the departure boards: three rows of LED lettering
    led = {"keihin-n": [("快速", "大宮", "Ōmiya"), ("各駅停車", "南浦和", "Minami-Urawa")], "yamanote-n": [("山手線", "東京・上野方面", "for Tōkyō, Ueno"), ("山手線", "池袋方面", "for Ikebukuro")],
           "yamanote-s": [("山手線", "品川・渋谷方面", "for Shinagawa"), ("山手線", "新宿方面", "for Shinjuku")], "keihin-s": [("快速", "大船", "Ōfuna"), ("各駅停車", "磯子", "Isogo")]}
    for i, lines in led.items():
        x, y, w, h = begin(f"led_{i}")
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(8, 8, 9))
        d.rectangle([x + 4, y + 4, x + w - 5, y + h - 5], outline=(44, 46, 48), width=3)
        for r, (kind, to, en) in enumerate(lines):
            yy = y + 36 + r * 40
            text((x + 20, yy), kind, 30, (255, 150, 30) if kind == "快速" else (80, 230, 90), anchor="lm")
            text((x + 150, yy), to, 28, (255, 170, 40), anchor="lm")
            text((x + w - 14, yy), en, 19, (255, 170, 40), anchor="rm")
        text((x + w / 2, y + h - 16), "まもなく電車がまいります", 20, (240, 60, 40))
        end(f"led_{i}")
    for S in STATIONS:
        x, y, w, h = begin(f"entrance_{S['key']}")
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(246, 246, 240))
        d.rectangle([x, y, x + w - 1, y + 22], fill=GREEN)
        d.rounded_rectangle([x + 34, y + 44, x + 150, y + 138], 10, fill=GREEN)
        text((x + 92, y + 91), "JR", 70, (246, 246, 240), stroke=2)
        text((x + 190, y + 80), S["native"] + "駅", 84, (20, 20, 20), anchor="lm", stroke=2)
        text((x + 560, y + 70), S["romaji"] + " Station", 42, (20, 20, 20), anchor="lm", stroke=1)
        text((x + 560, y + 122), " ・ ".join(ROWS[S["key"]][i][1] for i in sorted(ROWS[S["key"]]) if ROWS[S["key"]][i][1] not in [ROWS[S["key"]][j][1] for j in sorted(ROWS[S["key"]]) if j < i]), 34 if len(ROWS[S["key"]]) < 5 else 26, (60, 60, 60), anchor="lm")
        end(f"entrance_{S['key']}")
        x, y, w, h = begin(f"gates_{S['key']}")
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(34, 36, 40))
        nn = sorted(ROWS[S["key"]])
        text((x + 24, y + 34), "のりば  Tracks  " + ("・".join(str(i) for i in nn) if len(nn) < 7 else f"{nn[0]} – {nn[-1]}"), 40, (246, 246, 240), anchor="lm", stroke=1)
        text((x + 24, y + 78), "  ".join(dict.fromkeys(r[1] for r in ROWS[S["key"]].values())), 30 if len(nn) < 7 else 26, YAM, anchor="lm")
        end(f"gates_{S['key']}")
    for k, body, cans in (("vending", (228, 232, 236), [(210, 40, 40), (30, 90, 180), (240, 240, 240), (30, 140, 70), (250, 190, 30)]),
                          ("vending2", (190, 40, 44), [(240, 240, 240), (20, 20, 20), (250, 200, 40), (30, 120, 200), (230, 120, 30)])):
        x, y, w, h = begin(k)
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=body)
        d.rectangle([x + 10, y + 12, x + w - 11, y + 118], fill=(250, 250, 246))
        for r in range(3):
            for c in range(7):
                col = cans[(r * 3 + c * 2) % len(cans)]
                d.rounded_rectangle([x + 16 + c * ((w - 32) / 7), y + 18 + r * 34, x + 16 + c * ((w - 32) / 7) + (w - 32) / 7 - 5, y + 18 + r * 34 + 26], 3, fill=col)
        d.rectangle([x + 10, y + 128, x + w - 11, y + 150], fill=(60, 64, 70))
        d.rectangle([x + 24, y + 168, x + w - 25, y + 196], fill=(30, 32, 36))
        end(k)
    x, y, w, h, _ = SIGNS["blank"]
    ImageDraw.Draw(img).rectangle([x - 4, y - 4, x + w + 3, y + h + 3], fill=(244, 248, 238))
    img.save(os.path.join(out_dir, "rail_signs.png"))
    return ["rail_signs.png"]


# ---------------------------------------------------------------- the meshes

def meshes(Mesh):
    L = layout()
    if not L:
        return {}, []
    T, frame, sv, deck, openings = L["T"], L["frame"], L["sv"], L["deck"], L["openings"]
    K = Kit(Mesh, "rail", MATERIALS, flood=("rail_shop", "rail_lamp", "rail_sign"), sky={"rail_soffit": 0.3, "rail_ceiling": 0.45, "rail_frame": 0.6, "rail_esc_frame": 0.6})
    zt, zs = RAIL_Z - 0.2, RAIL_Z - SLAB        # the ballast's top, the deck's soffit
    slots = shapely.union_all([stair_slot(st, 0.25) for st in L["stairs"]])
    plat_all = shapely.union_all([p["poly"] for p in L["plats"]])
    # ---- the deck and the track
    tri_poly(K["rail_ballast"], deck.difference(plat_all.buffer(-0.05)), zt)
    for t in L["tracks"] + L["still"]:
        ribbon(K["rail_bed"], t["pts"], zt + 0.03, 1.35)
        for s in (-1, 1):
            K["rail_steel"].sweep([[*q, RAIL_Z - 0.08] for q in offset(t["pts"], s * t["gauge"] / 2)[::2]], [(-0.035, -0.08), (0.035, -0.08), (0.035, 0.08), (-0.035, 0.08)])
    # ---- under the deck: closed where nothing passes, its faces brick arches on the west (1910) and a concrete
    # frame on the east (the Shinkansen's, 1964); abutments in dressed stone along the streets that pass under
    under = deck.difference(openings).difference(slots).buffer(0)
    edge = deck.exterior
    bays = 0
    for g in getattr(under, "geoms", [under]):
        if g.geom_type != "Polygon" or g.area < 40:   # (a sliver left between two passages is no pier: it stood in the crowd's way)
            continue
        for ring in [g.exterior, *g.interiors]:
            c = list(ring.coords)
            sign = 1 if ring.is_ccw else -1
            if ring is not g.exterior:
                sign = -sign
            u = 0.0
            for a, b in zip(c, c[1:]):
                a, b = np.array(a), np.array(b)
                ln = float(np.linalg.norm(b - a))
                if ln < 0.05:
                    continue
                t = (b - a) / ln
                out = np.array([t[1], -t[0]]) * sign      # away from the solid
                m = (a + b) / 2
                ga, gb = T(*a), T(*b)
                if edge.distance(Point(*m)) < 0.4 and ln > 0.6 and BEHIND[0] < sv(*m)[0] < BEHIND[1] and sv(*m)[1] < -12:
                    # (the face behind the Marunouchi building, inside the block the Chuo Line's viaduct stands on: unseen)
                    K["rail_parapet"].quad([*a, ga - 0.4], [*b, gb - 0.4], [*b, zt + 0.1], [*a, zt + 0.1])
                elif edge.distance(Point(*m)) < 0.4 and ln > 0.6:   # the viaduct's own face
                    kind = "arch" if sv(*m)[1] < 10 else "frame"
                    n = max(1, round(ln / (7.6 if kind == "arch" else 9.5)))
                    for k in range(n):
                        p0, p1 = a + (b - a) * k / n, a + (b - a) * (k + 1) / n
                        bays += 1
                        bay(K, p0, p1, ga + (gb - ga) * k / n, ga + (gb - ga) * (k + 1) / n, zs, out, kind, bays)
                    # the deck's band over the arches, proud of the face
                    (K["rail_stone"] if kind == "arch" else K["rail_concrete"]).quad([*(a + out * 0.12), zs - 0.05], [*(b + out * 0.12), zs - 0.05], [*(b + out * 0.12), zt + 0.1], [*(a + out * 0.12), zt + 0.1],
                                                                                    [[u, 0], [u + ln, 0], [u + ln, 0.8], [u, 0.8]])
                else:
                    u = wall(K["rail_stone"], a, b, ga - 0.4, gb - 0.4, zs, u)
    # ---- over the streets: the soffit, and plate girders on the deck's edges
    # (not over the stair wells: the flights rise through the deck there, and a soffit across them is a ceiling at
    # the landing's head height)
    span = deck.intersection(openings.buffer(0.1)).difference(slots).buffer(0)
    tri_poly(K["rail_soffit"], span, zs)
    tri_poly(K["rail_soffit"], under, zs - 0.02)   # (seen only through a shop's glass; closes the deck from below)
    for ring in [deck.exterior, *deck.interiors]:
        c = np.array(ring.coords)
        for a, b in zip(c, c[1:]):
            m = (a + b) / 2
            ln = float(np.linalg.norm(b - a))
            if ln < 0.3:
                continue
            t = (b - a) / ln
            out = np.array([t[1], -t[0]]) * (1 if ring.is_ccw else -1) * (1 if ring is deck.exterior else -1)
            if openings.contains(Point(*m)):   # a girder's web, 1.5 m deep, its flanges and stiffeners
                K["rail_girder"].quad([*(a + out * 0.1), zs - 0.55], [*(b + out * 0.1), zs - 0.55], [*(b + out * 0.1), zt + 0.12], [*(a + out * 0.1), zt + 0.12])
                for z in (zs - 0.55, zt + 0.12):
                    K["rail_girder"].box([*(a + out * 0.1), z], [*(b + out * 0.1), z], 0.5, 0.06)
                for k in range(1, int(ln / 1.8) + 1):
                    q = a + t * (ln * k / (int(ln / 1.8) + 1)) + out * 0.16
                    K["rail_girder"].box([*q, zs - 0.5], [*q, zt + 0.1], 0.12, 0.05)
            # the parapet: a low wall on the brick side, a noise wall on the Shinkansen's
            if plat_all.distance(Point(*m)) > 0.8:
                east = sv(*m)[1] > 10
                h = 2.0 if east else 1.05
                pa, pb = a - out * 0.15, b - out * 0.15
                K["rail_parapet"].box([*pa, zt + h / 2], [*pb, zt + h / 2], 0.22, h)
    # ---- the overhead line: portal gantries, and a contact wire under a messenger over each track
    s = N_GATE + SHED + 12
    # (none through the Shinkansen's own shed, which stands inside the stretch)
    sheds = Polygon([*L["gate"](SHINK_GATE - 30).coords, *L["gate"](SHINK_GATE + SHED + 4).coords[::-1]]).intersection(
        shapely.union_all([t["geom"].buffer(6.0, cap_style="flat") for t in L["tracks"] if t["line"] == "shinkansen"]))
    while s < S_GATE - SHED:
        p, t, n = frame(s)
        cut = LineString([p - n * 95, p + n * 95]).intersection(deck).difference(sheds)
        for q in getattr(cut, "geoms", [cut]):
            if q.is_empty or q.length < 6:
                continue
            a, b = np.array(q.coords[0]), np.array(q.coords[-1])
            d = (b - a) / np.linalg.norm(b - a)
            a, b = a + d * 0.45, b - d * 0.45
            for e in (a, b):
                K["rail_mast"].box([*e, zt], [*e, RAIL_Z + 7.6], 0.3, 0.3)
            for z in (RAIL_Z + 6.5, RAIL_Z + 7.5):
                K["rail_mast"].box([*a, z], [*b, z], 0.16, 0.16)
            n_web = max(2, int(np.linalg.norm(b - a) / 2.0))
            for k in range(n_web):   # the truss's diagonals
                u0, u1 = a + (b - a) * k / n_web, a + (b - a) * (k + 1) / n_web
                K["rail_mast"].box([*u0, RAIL_Z + (6.5 if k % 2 else 7.5)], [*u1, RAIL_Z + (7.5 if k % 2 else 6.5)], 0.08, 0.08)
        s += 48.0
    for t in L["tracks"] + L["still"]:
        P = t["pts"][::4]
        for z, w in ((RAIL_Z + 5.0, 0.03), (RAIL_Z + 6.1, 0.03)):
            K["rail_wire"].sweep([[*q, z] for q in P], [(-w / 2, -w / 2), (w / 2, -w / 2), (0, w / 2)])
    # ---- a train shed's mouth at each end: a roof over the tracks and a dark wall behind it
    # (the Shinkansen's north one is its own, by the south end of its platforms at Tokyo)
    own = lambda sh: shapely.union_all([t["geom"].buffer(3.75, cap_style="flat") for t in L["tracks"] if (t["line"] == "shinkansen") == sh]).buffer(2.0).buffer(-2.0)
    for s0, d, over in ((N_GATE, 1, own(False)), (SHINK_GATE, 1, own(True)), (S_GATE, -1, deck.buffer(1.2))):
        g0, g1 = L["gate"](s0 + d * 0.5), L["gate"](s0 + d * SHED)
        shed = Polygon([*g0.coords, *g1.coords[::-1]]).intersection(over)
        shed = max(getattr(shed, "geoms", [shed]), key=lambda g: g.area)
        zr = RAIL_Z + 6.6
        tri_poly(K["rail_roof"], shed, zr + 0.3)
        tri_poly(K["rail_dark"], shed, zr)
        c = list(shed.exterior.coords)
        for a, b in zip(c, c[1:]):
            a, b = np.array(a), np.array(b)
            m = (a + b) / 2
            back = abs(sv(*m)[0] - (s0 + d * 0.5)) < 1.5
            front = abs(sv(*m)[0] - (s0 + d * SHED)) < 1.5
            if back:
                K["rail_dark"].quad([*a, zt], [*b, zt], [*b, zr], [*a, zr])
            elif front:
                K["rail_roof"].quad([*a, zr - 0.9], [*b, zr - 0.9], [*b, zr + 0.3], [*a, zr + 0.3])   # the roof's fascia
            else:
                K["rail_concrete"].quad([*a, zt], [*b, zt], [*b, zr + 0.3], [*a, zr + 0.3])
    station(L, K, Mesh)
    # what a phone goes without (landmarks.json "detail": never unpacked on the low tier): the overhead line and its
    # gantries, the canopies' brackets, the platform doors' green line and the glass on their cabinets, the escalators' step
    # lines and glass. Nothing a walker meets
    for k in ("rail_mast", "rail_wire", "rail_psd_line", "rail_psd_glass", "rail_esc_dark", "rail_esc_glass"):
        if k in K:
            K[k].detail = True
    # the flat things, laid a triangle at a time: one vertex where their triangles meet
    for k in ("rail_soffit", "rail_ballast", "rail_roof", "rail_dark"):
        if k in K:
            K[k].weld()
    for m in L["own"]:
        if m.name.startswith("rail_platform_") or m.name == "rail_floor_all":
            m.weld()
    out = [m for m in K.values() if m.v] + L["own"]
    return MATERIALS, out


def lamp(K, a, b, w):
    """A tube light's lit face, from a to b (3D) and w wide, looking down: what is seen of it from the platform."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = np.array([-(b - a)[1], (b - a)[0], 0.0])
    d = d / (np.linalg.norm(d) or 1.0) * w / 2
    K["rail_lamp"].quad(a + d, b + d, b - d, a - d)


def psd_line(p, sgn):
    """A platform's face with platform doors: the line of the doors (0.42 m in from the edge) and where along it each
    door's middle is, for the longest train that stops there."""
    fr, tr = p["frames"], p["edges"][sgn][0]
    edge = LineString([f[1] + f[3] * sgn * (f[4] / 2 - 0.42) for f in fr])
    cars = max(q["cars"] for q in SERVICES if q["track"] == f"{tr['line']}-{'s' if tr['south'] else 'n'}")
    door_u = sorted(edge.length / 2 + (k - (cars - 1) / 2) * CAR + dd for k in range(cars) for dd in DOORS)
    return edge, [u for u in door_u if 2.5 < u < edge.length - 2.5]


def station(L, K, Mesh):
    """The island platforms of Yurakucho and Shimbashi."""
    T, frame, sv = L["T"], L["frame"], L["sv"]
    zt, zp = RAIL_Z - 0.2, RAIL_Z + PLAT
    own = L["own"] = []
    _layout_signs()
    # the canopies' arms and brackets: a mesh of their own, which a phone goes without (the roofs stand on their posts)
    arms = Mesh("rail_frame_arms", "rail_frame", False)
    arms.sky, arms.bounce, arms.detail = 0.6, "#8a857c", True
    own.append(arms)
    for pi, p in enumerate(L["plats"]):
        st_here = [st for st in L["stairs"] if st["plat"] == p["key"]]
        holes = shapely.union_all([stair_slot(st) for st in st_here])
        top = Mesh(f"rail_platform_{p['key']}", "rail_platform", False, uv=True)   # walked on as strips (surfaces)
        tri_poly(top, p["poly"].difference(holes), zp, uv=True)
        own.append(top)
        c = list(p["poly"].exterior.coords)
        u = 0.0
        for a, b in zip(c, c[1:]):   # its faces down to the ballast, and the nosing over the track
            u = wall(K["rail_parapet"], a, b, zt, zt, zp, u)   # (not solid: the doors, or the strip's hold, keep a walker on the platform)
        fr = p["frames"]
        # the yellow tactile strip and the white line, 0.9 m in from each edge
        for sgn in (-1, 1):
            edge_pts = [f[1] + f[3] * sgn * (f[4] / 2 - 0.9) for f in fr[1:-1]]
            ribbon(K["rail_yellow"], edge_pts, zp + 0.012, 0.15, uv=False)
            ribbon(K["rail_white"], [f[1] + f[3] * sgn * (f[4] / 2 - 0.08) for f in fr[1:-1]], zp + 0.012, 0.06, uv=False)
        # ---- the canopy: a butterfly roof on a row of columns down the middle, its gutter over them
        cov = [f for f in fr if fr[0][0] + 24 < f[0] < fr[-1][0] - 24]   # (the platforms' ends are open to the sky)
        he, hc = 4.7, 3.95     # the eaves and the gutter over the platform
        for sgn in (-1, 1):
            rows_t, rows_b = [], []
            # (a panel every 8 m: the platforms are all but straight, and every edge of the roof's triangles is a row of
            # boxes in the game's collision world)
            for f in cov[::4] + ([cov[-1]] if (len(cov) - 1) % 4 else []):
                hw = f[4] / 2 + 0.35
                e, m = f[1] + f[3] * sgn * hw, f[1]
                rows_t.append([[*m, zp + hc + 0.12], [*e, zp + he + 0.12]])
                rows_b.append([[*m, zp + hc], [*e, zp + he]])
            K["rail_roof"].grid(rows_t)
            K["rail_ceiling"].grid(rows_b)
            K["rail_frame"].sweep([[*(f[1] + f[3] * sgn * (f[4] / 2 + 0.35)), zp + he + 0.02] for f in cov], [(-0.05, -0.14), (0.05, -0.14), (0.05, 0.14), (-0.05, 0.14)])   # the fascia
            # two rows of tube lights along each side, as the platforms of the line have
            for off in (0.28, 0.62):
                pts = [[*(f[1] + f[3] * sgn * (f[4] / 2 + 0.35) * off), zp + hc + (he - hc) * off - 0.07] for f in cov]
                for k in range(0, len(pts) - 1, 3):
                    a, b = np.array(pts[k]), np.array(pts[min(k + 2, len(pts) - 1)])
                    lamp(K, a + (b - a) * 0.04, b - (b - a) * 0.04, 0.11)
        cols = cov[2::4]
        for f in cols:   # a column every 8 m, its arms up to the eaves, a purlin across
            m, n = f[1], f[3]
            if holes.buffer(0.5).contains(Point(*m)):   # over a stair well its walls carry the roof: a post on each
                for sgn in (-1, 1):
                    d = 0.0
                    while d < 4.0 and holes.contains(Point(*(m + n * sgn * d))):
                        d += 0.05
                    K["rail_frame"].box([*(m + n * sgn * (d + 0.1)), zp + 1.2], [*(m + n * sgn * (d + 0.1)), zp + hc + 0.2], 0.16, 0.16)
            else:
                K["rail_frame"].box([*m, zp], [*m, zp + hc], 0.2, 0.2)
            for sgn in (-1, 1):
                e = m + n * sgn * (f[4] / 2 + 0.2)
                arms.box([*m, zp + hc - 0.2], [*e, zp + he - 0.1], 0.09, 0.14)
                arms.box([*(m + n * sgn * 0.08), zp + hc - 1.0], [*(m + n * sgn * 1.25), zp + hc - 0.05], 0.07, 0.07)
        # ---- platform doors along the faces of the Yamanote and Keihin-Tohoku lines: cabinets between the doors (here),
        # and each door's two glazed leaves, which slide open with a train standing (web/game/trains.js)
        for sgn in (-1, 1):
            if sgn not in p["edges"] or p["edges"][sgn][0]["line"] not in PSD_LINES:
                continue
            edge, door_u = psd_line(p, sgn)
            at = lambda u, z: [*edge.interpolate(u).coords[0], z]
            prev = 0.6
            for u in door_u + [edge.length - 0.6 + 1.0]:
                a, b = prev, min(u - 1.0, edge.length - 0.6)
                if b - a > 0.3:   # a cabinet: a white box with the line's green along its top
                    n_seg = max(1, int((b - a) / 6.0))
                    for k in range(n_seg):
                        q0, q1 = a + (b - a) * k / n_seg, a + (b - a) * (k + 1) / n_seg
                        K["rail_psd"].box(at(q0, zp + 0.6), at(q1, zp + 0.6), 0.22, 1.2)
                        K["rail_psd_glass"].box(at(q0 + 0.08, zp + 1.27), at(q1 - 0.08, zp + 1.27), 0.03, 0.14)
                        K["rail_psd_line"].box(at(q0, zp + 1.215), at(q1, zp + 1.215), 0.24, 0.03)
                if u < edge.length - 0.6:   # the door's lintel over the opening
                    K["rail_psd"].box(at(u - 1.0, zp + 1.33), at(u + 1.0, zp + 1.33), 0.2, 0.06)
                prev = u + 1.0
        # ---- signs hung from the roof: the platform boards and the departure boards, back to back over the middle
        nums = p["nums"]
        for f in cov[8::18]:
            m, t, n = f[1], f[2], f[3]
            if holes.buffer(1.0).contains(Point(*m)):
                continue
            for sgn, num in ((-1, nums[0]), (1, nums[1])):
                if num is None:
                    continue
                c0 = m + n * sgn * (f[4] / 4 + 0.2)
                za = zp + 2.42
                tr = p["edges"][sgn][0]
                led = f"led_{tr['line']}-{'s' if tr['south'] else 'n'}"
                for kk, (key, w, h, dz) in enumerate(((f"dir_{p['station']}_{num}", 3.6, 0.52, 0.0), (led, 2.2, 0.55, 0.0))):
                    if key not in SIGNS:
                        continue
                    cc = c0 + t * (kk * 9.0)
                    a, b = cc - n * w / 2, cc + n * w / 2
                    K["rail_dark"].box([*a, za + h / 2 + dz], [*b, za + h / 2 + dz], 0.1, h + 0.06)
                    for face in (1, -1):   # read from both ways along the platform
                        sign(K, cc, t * face, w, za + dz, h, key, 0.056)
                    for e in (a + n * 0.2, b - n * 0.2):
                        K["rail_frame"].box([*e, za + h], [*e, zp + hc + (he - hc) * 0.45], 0.04, 0.04)
        # ---- the name boards on posts, facing each track; benches and drinks machines along the middle
        for k, f in enumerate(cov[5::14]):
            m, t, n = f[1], f[2], f[3]
            if holes.buffer(2.5).contains(Point(*m)):
                continue
            key = tuple(f"name_{p['station']}_{p['edges'][g][0]['line']}" if g in p["edges"] else f"name_{p['station']}_yamanote" for g in (-1, 1))
            if k % 3 == 0:
                a, b = m - t * 1.45, m + t * 1.45
                for e in (a, b):
                    K["rail_frame"].box([*e, zp], [*e, zp + 2.25], 0.08, 0.08)
                K["rail_psd"].box([*a, zp + 1.72], [*b, zp + 1.72], 0.08, 0.98)
                for sgn, kk in ((-1, key[0]), (1, key[1])):
                    sign(K, m, n * sgn, 2.86, zp + 1.26, 0.92, kk, 0.046)
            elif k % 3 == 1:   # a bench: four seats back to back
                for sgn in (-1, 1):
                    c0 = m + n * sgn * 0.3
                    K["rail_bench"].box([*(c0 - t * 1.1), zp + 0.42], [*(c0 + t * 1.1), zp + 0.42], 0.42, 0.06)
                    K["rail_bench"].box([*(m + n * sgn * 0.06 - t * 1.1), zp + 0.68], [*(m + n * sgn * 0.06 + t * 1.1), zp + 0.68], 0.05, 0.42)
                for e in (-0.9, 0.9):
                    K["rail_frame"].box([*(m + t * e), zp], [*(m + t * e), zp + 0.4], 0.5, 0.06)
            else:              # a drinks machine, lit, either side
                for sgn, kk in ((-1, "vending"), (1, "vending2")):
                    c0 = m + n * sgn * 0.02
                    K["rail_shutter"].box([*(c0 - t * 0.55 + n * sgn * 0.36), zp + 0.92], [*(c0 + t * 0.55 + n * sgn * 0.36), zp + 0.92], 0.7, 1.84)
                    sign(K, c0, n * sgn, 1.04, zp + 0.06, 1.74, kk, 0.72)
        # ---- the escalators: up from the concourse beside each flight, glass balustrades and black handrails
        for st in st_here:
            E = escalator(st)
            a, t, n = E["a"], E["t"], E["n"]
            em = Mesh(f"rail_esc_{st['key']}", "rail_stairs", False)
            zu = lambda u: E["z0"] + (E["z1"] - E["z0"]) * min(1.0, max(0.0, (u - E["u0"]) / (E["u1"] - E["u0"])))
            us = [0.0, E["u0"]] + [E["u0"] + (E["u1"] - E["u0"]) * k / 24 for k in range(1, 24)] + [E["u1"], E["L"]]
            hw = 0.5
            em.grid([[[*(a + t * u - n * hw), zu(u)], [*(a + t * u + n * hw), zu(u)]] for u in us])
            own.append(em)
            for k in range(1, 24):   # the steps' risers, seen as ridges up the incline
                u = E["u0"] + (E["u1"] - E["u0"]) * k / 24
                K["rail_esc_dark"].box([*(a + t * u - n * hw), zu(u) + 0.01], [*(a + t * u + n * hw), zu(u) + 0.01], 0.03, 0.02)
            for sgn in (-1, 1):
                e = n * sgn * (hw + 0.12)
                pts = [[*(a + t * u + e), zu(u)] for u in us]
                K["rail_esc_frame"].sweep(pts, [(-0.06, -0.35), (0.06, -0.35), (0.06, 0.12), (-0.06, 0.12)])            # the skirt and deck
                K["rail_esc_glass"].sweep([[*q[:2], q[2] + 0.12] for q in pts], [(-0.012, 0.0), (0.012, 0.0), (0.012, 0.8), (-0.012, 0.8)])   # the glass
                K["rail_esc_dark"].sweep([[*q[:2], q[2] + 0.95] for q in pts], [(-0.05, -0.03), (0.05, -0.03), (0.05, 0.03), (-0.05, 0.03)])  # the handrail
            for sgn in (-1, 1):   # the well's outer wall, up to a balustrade over the platform
                e0, e1 = a + n * sgn * (hw + 0.3), a + t * E["L"] + n * sgn * (hw + 0.3)
                if sgn < 0:
                    continue   # (the flight's own wall stands between them)
                K["rail_stone"].quad([*e0, st["z0"] - 0.3], [*e1, st["z0"] - 0.3], [*e1, zp + 1.1], [*e0, zp + 1.1], [[0, 0], [E["L"], 0], [E["L"], 9], [0, 9]])
                K["rail_psd"].box([*e0, zp + 0.5], [*e1, zp + 0.5], 0.1, 1.0)
                K["rail_psd_line"].box([*e0, zp + 1.0], [*e1, zp + 1.0], 0.11, 0.04)
            e0, e1 = a - n * (hw + 0.3), a + n * (hw + 0.3)   # over the way in at its foot, the lintel and the balustrade
            K["rail_concrete"].quad([*e0, st["z0"] + 2.7], [*e1, st["z0"] + 2.7], [*e1, zp], [*e0, zp])
            K["rail_psd"].box([*e0, zp + 0.5], [*e1, zp + 0.5], 0.1, 1.0)
        # ---- the stairs: treads between two walls, a balustrade round the well on the platform
        for st in st_here:
            a, t, n, hw, run = st["a"], st["t"], st["n"], st["w"] / 2, st["run"]
            sm = Mesh(f"rail_stair_{st['key']}", "rail_stairs", False)
            half = (run - 1.6) / 2
            rise = (st["z1"] - st["z0"]) / 2

            def zat(u):
                return st["z0"] + (min(u, half) / half) * rise + (max(0.0, min(u - half - 1.6, half)) / half) * rise

            steps = int(round(rise / 0.16))
            for flight, u0 in ((0, 0.0), (1, half + 1.6)):
                for k in range(steps):
                    ua, ub = u0 + half * k / steps, u0 + half * (k + 1) / steps
                    z = zat(u0) + rise * (k + 1) / steps
                    p0, p1 = a + t * ua, a + t * ub
                    sm.quad([*(p0 - n * hw), z], [*(p1 - n * hw), z], [*(p1 + n * hw), z], [*(p0 + n * hw), z])
                    sm.quad([*(p0 - n * hw), z - rise / steps], [*(p0 + n * hw), z - rise / steps], [*(p0 + n * hw), z], [*(p0 - n * hw), z])
            p0, p1 = a + t * half, a + t * (half + 1.6)
            zl = st["z0"] + rise
            sm.quad([*(p0 - n * hw), zl], [*(p1 - n * hw), zl], [*(p1 + n * hw), zl], [*(p0 + n * hw), zl])
            own.append(sm)
            for sgn in (-1, 1):   # the walls, from the ground to a balustrade 1.1 m over the platform, and a handrail
                e0, e1 = a + n * sgn * (hw + 0.12), a + t * run + n * sgn * (hw + 0.12)
                K["rail_stone"].quad([*e0, st["z0"] - 0.3], [*e1, st["z0"] - 0.3], [*e1, zp + 1.1], [*e0, zp + 1.1], [[0, 0], [run, 0], [run, 9], [0, 9]])
                K["rail_psd"].box([*e0, zp + 0.5], [*e1, zp + 0.5], 0.1, 1.0)     # a white panel, the line's green and a steel rail on it
                K["rail_psd_line"].box([*e0, zp + 1.0], [*e1, zp + 1.0], 0.11, 0.04)
                K["rail_frame"].tube([[*e0, zp + 1.1], [*e1, zp + 1.1]], 0.03, 6)
                rail_pts = [[*(a + t * u + n * sgn * (hw - 0.06)), zat(u) + 0.95] for u in np.linspace(0, run, 12)]
                K["rail_frame"].tube(rail_pts, 0.025, 5)
            # across the foot's end of the well, over the way in: a lintel from 2.6 m up, and the balustrade
            e0, e1 = a - n * (hw + 0.24), a + n * (hw + 0.24)
            K["rail_concrete"].quad([*e0, st["z0"] + 2.7], [*e1, st["z0"] + 2.7], [*e1, zp], [*e0, zp])
            K["rail_psd"].box([*e0, zp + 0.5], [*e1, zp + 0.5], 0.1, 1.0)
            K["rail_frame"].tube([[*e0, zp + 1.1], [*e1, zp + 1.1]], 0.03, 6)
            # lights down the walls
            for u in np.arange(2.0, run - 1.0, 3.2):
                for sgn in (-1, 1):
                    q = a + t * u + n * sgn * (hw + 0.02)
                    K["rail_lamp"].box([*(q - t * 0.5), zat(u) + 2.2], [*(q + t * 0.5), zat(u) + 2.2], 0.04, 0.1)
    # ---- each concourse under the tracks: its floor, lights on its soffit, the entrances' fascias
    zs = RAIL_Z - SLAB
    floor = Mesh("rail_floor_all", "rail_floor", False, uv=True)
    own.append(floor)
    for S, (cmid, _dirs, conc, _of) in [(S, c) for S in L["stations"] for c in S["concs"]]:
        conc = conc.intersection(L["deck"])
        conc = max(getattr(conc, "geoms", [conc]), key=lambda g: g.area)
        # the floor: slabs on the ground's own levels, in 3 m squares (the street's paint and the photograph under the
        # tracks showed through as patches of other tones)
        x0, y0, x1, y1 = conc.bounds
        for gx in np.arange(math.floor(x0 / 3) * 3, x1, 3.0):
            for gy in np.arange(math.floor(y0 / 3) * 3, y1, 3.0):
                cell = conc.intersection(shapely.box(gx, gy, gx + 3.0, gy + 3.0))
                for g in getattr(cell, "geoms", [cell]):
                    if g.geom_type != "Polygon" or g.area < 0.01:
                        continue
                    for tri in shapely.constrained_delaunay_triangles(g).geoms:
                        c3 = list(tri.exterior.coords)[:3]
                        floor.tri(*[[x, y, T(x, y) + 0.04] for x, y in c3], [[x, y] for x, y in c3])
        p, t, n = frame(cmid)
        s0, s1 = [sv(*c)[1] for c in (conc.exterior.interpolate(conc.exterior.project(Point(*(p - n * 80)))).coords[0], conc.exterior.interpolate(conc.exterior.project(Point(*(p + n * 80)))).coords[0])]
        for v in np.arange(s0 + 2.5, s1 - 2.0, 4.2):
            for du in (-5.0, 0.0, 5.0):
                c0 = p + n * v + t * du
                lamp(K, [*(c0 - n * 0.9), zs - 0.06], [*(c0 + n * 0.9), zs - 0.06], 0.22)
        if _of in S.get("shut", ()):   # its west end, where it stops at the block behind: the viaduct's own stone, lit as the passage is
            a, b = p + n * (s0 + 0.15) - t * 9.0, p + n * (s0 + 0.15) + t * 9.0
            wall(K["rail_stone"], b, a, T(*b) - 0.4, T(*a) - 0.4, zs, 0.0)
        for v, face in ((s0 - 0.25, -1), (s1 + 0.25, 1)):   # an entrance on the west and the east (Yurakucho: the International Forum's side and Ginza's)
            if face not in S.get("fascia", (-1, 1)):
                continue
            c0 = p + n * v
            g = T(*c0)
            a, b = c0 - t * 8.4, c0 + t * 8.4
            K["rail_dark"].box([*a, g + 4.25], [*b, g + 4.25], 0.3, 1.5)
            sign(K, c0, n * face, 16.8, g + 3.6, 1.3, f"entrance_{S['key']}", 0.16)
    plat_of = {p["key"]: p for p in L["plats"]}
    for st in L["stairs"]:   # over the foot of each flight: which tracks it climbs to
        p = plat_of[st["plat"]]
        num = p["nums"][0 if st["up"] == "n" else 1] or p["nums"][1 if st["up"] == "n" else 0]
        sign(K, st["a"] - st["t"] * 0.2, -st["t"], 3.0, st["z0"] + 2.75, 0.47, f"dir_{p['station']}_{num}", 0.02)


# ---------------------------------------------------------------- the game's strips and its trains

def surfaces():
    """The platforms as straight strips along their length, and each flight of stairs."""
    L = layout()
    if not L:
        return []
    out, zp = [], RAIL_Z + PLAT
    name = {S["key"]: S for S in STATIONS}
    pn = lambda p: " and ".join(str(n) for n in sorted(n for n in p["nums"] if n is not None))
    for p in L["plats"]:
        S = name[p["station"]]
        fr = p["frames"]
        step = 8
        for k in range(0, len(fr) - 1, step):
            a, b = fr[k], fr[min(k + step, len(fr) - 1)]
            d = b[1] - a[1]
            ln = float(np.linalg.norm(d))
            ax, c = d / ln, (a[1] + b[1]) / 2
            hw = min(f[4] for f in fr[k:k + step + 1]) / 2 - 0.05
            U0, U1 = -ln / 2 - (1.0 if k == 0 else 0.5), ln / 2 + (1.0 if k + step >= len(fr) - 1 else 0.5)
            # (not over the stair and escalator wells: there the platform is two strips, one each side of the well, or a
            # walker carried up the escalator stepped onto the platform's level a step below it, and the steps no longer
            # carried them)
            nn = np.array([-ax[1], ax[0]])
            wells = []
            for st in L["stairs"]:
                if st["plat"] != p["key"]:
                    continue
                q = np.array(stair_slot(st).exterior.coords) - c
                u, v = q @ ax, q @ nn
                if u.max() > U0 and u.min() < U1:
                    wells.append((max(U0, float(u.min())), min(U1, float(u.max())), float(v.min()), float(v.max())))
            pieces, at = [], U0
            for w0, w1, v0, v1 in sorted(wells):
                if w0 - at > 0.3:
                    pieces.append((at, w0, -hw, hw))
                for a0, a1 in ((-hw, v0), (v1, hw)):
                    if a1 - a0 > 0.6:
                        pieces.append((w0, w1, a0, a1))
                at = max(at, w1)
            if U1 - at > 0.3:
                pieces.append((at, U1, -hw, hw))
            for u0, u1, v0, v1 in pieces:
                o = c + ax * (u0 + u1) / 2 + nn * (v0 + v1) / 2
                out.append({"name": f"{S['name']} Station, platforms {pn(p)}", "type": "strip", "origin": [round(float(o[0]), 2), round(float(o[1]), 2)],
                            "axis": [round(float(ax[0]), 5), round(float(ax[1]), 5)], "half_width": round((v1 - v0) / 2, 2),
                            "profile": [[round(-(u1 - u0) / 2, 2), zp], [round((u1 - u0) / 2, 2), zp]],
                            "thickness": PLAT + SLAB, "mesh": f"rail_platform_{p['key']}", "mapped": False, "label": f"{S['name']} Station {S['native']}駅"})
    plat_of = {p["key"]: p for p in L["plats"]}
    for st in L["stairs"]:   # from the head down to the foot (tools/game_check.js climbs each: "check")
        p = plat_of[st["plat"]]
        half = (st["run"] - 1.6) / 2
        zl = (st["z0"] + st["z1"]) / 2
        c, run = st["b"], st["run"]
        out.append({"name": f"{name[p['station']]['name']} Station, {OF[st['of']]}{'north' if st['up'] == 'n' else 'south'} stairs to platforms {pn(p)}", "type": "strip",
                    "origin": [round(float(c[0]), 2), round(float(c[1]), 2)], "axis": [round(float(-st["t"][0]), 5), round(float(-st["t"][1]), 5)], "half_width": st["w"] / 2,
                    "profile": [[-0.5, zp], [0.0, zp], [round(half, 2), round(zl, 2)], [round(half + 1.6, 2), round(zl, 2)], [round(run, 2), round(st["z0"], 2)], [round(run + 0.6, 2), round(st["z0"], 2)]],
                    "thickness": 1.0, "mesh": f"rail_stair_{st['key']}", "mapped": False, "check": True, "label": "the stairs to the platforms"})
        E = escalator(st)   # and the escalator up beside it, from its foot (its axis up the incline: it carries you up)
        out.append({"name": f"{name[p['station']]['name']} Station, {OF[st['of']]}{'north' if st['up'] == 'n' else 'south'} escalator to platforms {pn(p)}", "type": "strip",
                    "origin": [round(float(E["a"][0]), 2), round(float(E["a"][1]), 2)], "axis": [round(float(E["t"][0]), 5), round(float(E["t"][1]), 5)], "half_width": 0.45,
                    "profile": [[-0.6, round(E["z0"], 2)], [round(E["u0"], 2), round(E["z0"], 2)], [round(E["u1"], 2), round(E["z1"], 2)], [round(E["L"] + 0.5, 2), round(E["z1"], 2)]],
                    "thickness": 1.0, "mesh": f"rail_esc_{st['key']}", "mapped": False, "moving_ms": ESC_MS, "moving_u": [0.4, round(E["L"] - 0.4, 2)],
                    "label": "the escalator to the platforms"})
    return out


def trains():
    """game.json "trains" (web/game/trains.js): each track's course at rail level, where its trains stop (each station's
    platform on it: where a stopping train's middle rests, the platform's number and side, and its platform doors'
    leaves), and the services that run on it; the stations, each with where it is heard from."""
    L = layout()
    if not L:
        return None
    sv = L["sv"]
    tracks, stations = [], []
    for S in L["stations"]:
        fs = [p["frames"][len(p["frames"]) // 2][1] for p in S["plats"]]
        c = np.mean(fs, axis=0)
        stations.append({"id": S["key"], "name": S["name"], "native": S["native"], "kana": S["kana"], "at": [round(float(c[0]), 1), round(float(c[1]), 1), RAIL_Z + PLAT],
                         "hear_m": 150, "r": round(max(p["frames"][-1][0] - p["frames"][0][0] for p in S["plats"]) / 2 + 8, 1)})
        if S.get("way"):   # from the street to a platform on foot: the points a walker makes for, the last on the platform
            w = S["way"]
            h, e = np.array(w["hall"]), np.array(w["axis"])
            st = min((q for q in L["stairs"] if any(p["key"] == q["plat"] and w["platform"] in p["nums"] for p in S["plats"])),
                     key=lambda q: float(np.linalg.norm(q["a"] - h)))
            pts = [h - e * w["out_m"], h, h + e * w["in_m"], st["a"] - st["t"] * 1.6, st["a"] + st["t"] * 1.0, st["b"] + st["t"] * 2.5]
            stations[-1]["way"] = {"name": "from the Marunouchi South Entrance to platforms 5 and 6", "pts": [[round(float(q[0]), 1), round(float(q[1]), 1)] for q in pts]}
    for t in L["tracks"]:
        pts = t["pts"] if t["south"] else t["pts"][::-1]    # in the direction of travel
        g = LineString(pts)
        tid = f"{t['line']}-{'s' if t['south'] else 'n'}"
        o = {"id": tid, "line": t["line"], "south": t["south"], "gauge": t["gauge"],
             "p": [v for q in pts for v in (round(q[0] * 10), round(q[1] * 10), round(RAIL_Z * 10))]}
        stops = []
        for p in L["plats"]:
            for sgn, (tr, no) in p["edges"].items():
                if tr is not t:
                    continue
                mid = p["frames"][len(p["frames"]) // 2]
                m = g.project(Point(*mid[1]))
                a, b = g.interpolate(max(0, m - 1)), g.interpolate(min(g.length, m + 1))
                hx, hy = b.x - a.x, b.y - a.y
                left = 1 if (mid[1][0] - a.x) * -hy + (mid[1][1] - a.y) * hx > 0 else -1   # the platform on the left of the way the train runs
                q = {"station": p["station"], "m": round(m, 1), "platform": no, "side": left}
                if t["line"] in PSD_LINES:   # its platform doors' leaves, which the game draws and opens
                    edge, us = psd_line(p, sgn)
                    pts = [edge.interpolate(u) for u in us]
                    q["psd"] = {"off": round(g.distance(pts[len(pts) // 2]) * left, 2), "u": [round(g.project(e), 2) for e in pts]}
                stops.append(q)
        stops.sort(key=lambda q: q["m"])
        if stops:
            o["stops"] = stops
        y = next((q for q in stops if q["station"] == "yurakucho"), None)
        if y:   # (Yurakucho's, as the first pass gave it: a harness reads them)
            o["stop_m"], o["platform"] = y["m"], y["platform"]
        o["hide_m"] = [round(SHED - 6.0, 1), round(g.length - SHED + 6.0, 1)]   # its cars are drawn between these: the sheds' mouths
        tracks.append(o)
    return {
        "note": "The JR lines from Tokyo Station past Yurakucho and Shimbashi (cities/tokyo/rail.py): courses in decimetres at rail level, in the direction of travel.",
        "station": dict(stations[0], at=stations[0]["at"]),
        "stations": stations,
        "tracks": tracks,
        "services": SERVICES,
    }


# What runs. Headways are a few times shorter than the timetable's, so that there is always a train to watch;
# the order and the kinds are the real ones. The Keihin-Tohoku Line's rapid trains (10:30 to 15:30) stop at Tokyo
# ("rapid_at") and at neither Yurakucho nor Shimbashi; the Tokaido Line's stop at Tokyo and Shimbashi ("stop_at"), on
# to Ueno as the Ueno-Tokyo Line; the Shinkansen's stop at none of this stretch's platforms (their own are Tokyo's 14 to 19).
SERVICES = [
    {"track": "yamanote-n", "stock": "e235", "cars": 11, "every_s": 96, "offset_s": 10, "stops": True, "v_ms": 19,
     "for": {"ja": "東京・上野方面", "en": "Tokyo and Ueno"}, "line": {"ja": "山手線", "en": "Yamanote Line"}},
    {"track": "yamanote-s", "stock": "e235", "cars": 11, "every_s": 96, "offset_s": 58, "stops": True, "v_ms": 19,
     "for": {"ja": "品川・渋谷方面", "en": "Shinagawa and Shibuya"}, "line": {"ja": "山手線", "en": "Yamanote Line"}},
    {"track": "keihin-n", "stock": "e233k", "cars": 10, "every_s": 132, "offset_s": 34, "stops": True, "rapid_h": [10.5, 15.5], "rapid_at": ["tokyo"], "v_ms": 21,
     "for": {"ja": "東京・上野・大宮方面", "en": "Tokyo, Ueno and Omiya"}, "line": {"ja": "京浜東北線", "en": "Keihin-Tohoku Line"}},
    {"track": "keihin-s", "stock": "e233k", "cars": 10, "every_s": 132, "offset_s": 100, "stops": True, "rapid_h": [10.5, 15.5], "rapid_at": ["tokyo"], "v_ms": 21,
     "for": {"ja": "品川・横浜方面", "en": "Shinagawa and Yokohama"}, "line": {"ja": "京浜東北線", "en": "Keihin-Tohoku Line"}},
    {"track": "tokaido-n", "stock": "e233t", "cars": 15, "every_s": 150, "offset_s": 76, "stops": True, "stop_at": ["shimbashi", "tokyo"], "v_ms": 24,
     "for": {"ja": "東京・上野方面", "en": "Tokyo and Ueno"}, "line": {"ja": "東海道線", "en": "Tokaido Line"}},
    {"track": "tokaido-s", "stock": "e233t", "cars": 15, "every_s": 150, "offset_s": 4, "stops": True, "stop_at": ["shimbashi", "tokyo"], "v_ms": 24,
     "for": {"ja": "品川・横浜方面", "en": "Shinagawa and Yokohama"}, "line": {"ja": "東海道線", "en": "Tokaido Line"}},
    {"track": "shinkansen-n", "stock": "hayate", "cars": 16, "every_s": 118, "offset_s": 88, "stops": False, "v_ms": 29,
     "line": {"ja": "東海道新幹線", "en": "Tokaido Shinkansen"}},
    {"track": "shinkansen-s", "stock": "hayate", "cars": 16, "every_s": 118, "offset_s": 24, "stops": False, "v_ms": 29,
     "line": {"ja": "東海道新幹線", "en": "Tokaido Shinkansen"}},
]


def foot():
    """The ways in on foot the map has no line for (game_extras "foot"): a station's "way" from the plaza through its
    hall and along the passage under the tracks to the foot of its platform's flight, at the ground."""
    L = layout()
    if not L:
        return []
    out = []
    for S in L["stations"]:
        if S.get("way"):
            w = S["way"]
            h, e = np.array(w["hall"]), np.array(w["axis"])
            st = min((q for q in L["stairs"] if any(p["key"] == q["plat"] and w["platform"] in p["nums"] for p in S["plats"])),
                     key=lambda q: float(np.linalg.norm(q["a"] - h)))
            pts = [h - e * w["out_m"], h, h + e * w["in_m"], st["a"] - st["t"] * 1.6]   # (to the foot of the platform's flight, across the passage's own footway)
            out.append([[round(float(q[0]), 1), round(float(q[1]), 1), round(float(L["T"](*q)) + 0.05, 2)] for q in pts])
    return out


def closed():
    """Where the viaduct stands across the map's footways, as rings [[x, y], ...] (game_extras "closed"): its closed
    bays under the deck, which a footway mapped along under the tracks ran through, and each stair and escalator
    well (the map's footways under a platform run on to where the real flights are, into the wells' walls: they stop
    there, and the flights' own strips are walked instead)."""
    L = layout()
    if not L:
        return []
    area = shapely.union_all([L["deck"].difference(L["openings"]).buffer(0.6)] + [stair_slot(st).buffer(1.0, join_style="mitre") for st in L["stairs"]])   # (a metre round each well: its walls, and a walker's shoulder)
    R = lambda ring: [[round(float(x), 2), round(float(y), 2)] for x, y in ring.coords]
    return [{"ring": R(g.exterior), "holes": [R(h) for h in g.interiors]} for g in getattr(area, "geoms", [area]) if g.geom_type == "Polygon" and g.area > 1]


def bare():
    """Each concourse under the tracks, as rings [[x, y], ...]: no street lamp or bench of the map's stands in it
    (landmarks.json "bare"; a lamp post mapped on the street stood up through the soffit)."""
    L = layout()
    if not L:
        return []
    out = []
    for S in L["stations"]:
        for _m, _d, conc, _of in S["concs"]:
            g = conc.intersection(L["deck"]).buffer(1.0)
            out += [list(q.exterior.coords) for q in getattr(g, "geoms", [g]) if q.geom_type == "Polygon"]
    return out


def travel():
    L = layout()
    if not L:
        return []
    f = next(p for p in L["plats"] if p["station"] == "yurakucho" and 4 in p["nums"])["frames"]
    m = f[len(f) // 2 + 12]
    at = m[1] + m[3] * 1.0
    look = at + m[3] * 30 - m[2] * 60
    return [{"id": "t-yurakucho", "name": "Yurakucho Station, platform 4 有楽町駅", "at": [round(float(at[0]), 1), round(float(at[1]), 1), RAIL_Z + PLAT],
             "look": [round(float(look[0]), 1), round(float(look[1]), 1)],
             "blurb": "The island platforms on the 1910 brick viaduct: the Yamanote and Keihin-Tohoku lines stop, and the Tokaido Line and the Shinkansen run past a few metres away, with Ginza behind them."}] + [
        {"id": "t-shimbashi", "name": f"Shimbashi Station, platforms {' and '.join(str(n) for n in sorted(n for n in p['nums'] if n))} 新橋駅", "at": [round(float(m[1][0]), 1), round(float(m[1][1]), 1), RAIL_Z + PLAT],
         "look": [round(float(m[1][0] + m[3][0] * 30 + m[2][0] * 60), 1), round(float(m[1][1] + m[3][1] * 30 + m[2][1] * 60), 1)],
         "blurb": "The first railway station in Japan was here, in 1872. Its platforms now: the Yamanote, Keihin-Tohoku and Tokaido lines, the Shinkansen passing on its own viaduct to the east."}
        for p in L["plats"] if p["station"] == "shimbashi" and 4 in p["nums"] for m in [p["frames"][len(p["frames"]) // 2 + 8]]] + [
        {"id": "t-tokyo", "name": "Tokyo Station, platforms 5 and 6 東京駅", "at": [round(float(m[1][0]), 1), round(float(m[1][1]), 1), RAIL_Z + PLAT],
         "look": [round(float(m[1][0] - m[3][0] * 60 - m[2][0] * 40), 1), round(float(m[1][1] - m[3][1] * 60 - m[2][1] * 40), 1)],
         "blurb": "The Yamanote and Keihin-Tohoku lines' platforms behind the Marunouchi building's roofs, opened with the station in 1914: 5 for Shinagawa and Shibuya, 6 for Yokohama, and one stop to Yurakucho."}
        for p in L["plats"] if p["station"] == "tokyo" and 5 in p["nums"] for m in [p["frames"][len(p["frames"]) // 2 + 14]]]


def demolished():
    """The city's low solids under the platforms, which the viaduct stands in for (landmarks.json "demolished")."""
    L = layout()
    return L["gone"] if L else []


def glows():
    """The light of the platforms' tube lights and the concourse's on what stands under them after dark
    (landmarks.json "glows": [x, y, radius m, colour, strength], web/night.js)."""
    L = layout()
    if not L:
        return []
    out = []
    for p in L["plats"]:
        fr = p["frames"]
        for f in [f for f in fr if fr[0][0] + 24 < f[0] < fr[-1][0] - 24][2::5]:
            out.append([round(float(f[1][0]), 1), round(float(f[1][1]), 1), 9.0, "#f1f6e8", 0.36])
    for S, cmid in [(S, c[0]) for S in L["stations"] for c in S["concs"]]:
        p0, t, n = L["frame"](cmid)
        for v in (-12, 0, 12, 24):
            c = p0 + n * v
            out.append([round(float(c[0]), 1), round(float(c[1]), 1), 11.0, "#f1f6e8", 0.34])
    return out
