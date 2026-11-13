"""Kyoto Station's railway: the Tokaido Shinkansen on its viaduct with platforms 11 to 14, and the Tokaido Main Line
(the JR Kyoto and Biwako lines) at grade with platforms 2 to 5, and the trains' courses through them.

The Shinkansen's station (1964) is the southern half of Kyoto Station, its two island platforms on the viaduct a
storey and a half over the Hachijo side's concourse; every Tokaido Shinkansen train stops there. The JR lines run on
the ground between the station building (1997, the landmark kyoto_station draws) and the Shinkansen. The city model
had the Shinkansen's half of the station as PLATEAU solids standing over its tracks, and the JR platforms as the
aerial photograph's ground.

Laid out on OpenStreetMap's tracks, platform outlines and stopping points (cities/kyoto/rail_osm.json,
pipeline/rail_osm.py). Each line's through tracks are its longest mapped lines; a platform's own track (the loops
beside them, 3, 5, 11 and 14) runs on the through track of its direction, set across to the mapped stopping point
along the platform and easing back over 180 m beyond each end. What is not mapped is from published figures:
  levels      the Shinkansen's rail 8.6 m over the ground at the station, level along its platforms and easing to
              the same height over the ground beyond; the JR lines' rail 0.3 m over the ground
  platforms   1.25 m over the rail on the Shinkansen (JR Central's standard for its 16-car trains, 410 m), with
              platform gates at the cars' doors; 0.92 m on the JR lines (JR West's), 12-car
  trains      the Shinkansen keeps left as every Japanese line does: tracks 11 and 12 for Tokyo, 13 and 14 for
              Shin-Osaka and Hakata; the JR lines' 2 and 3 for the Biwako Line (Kusatsu, Maibara), 4 and 5 for the
              JR Kyoto Line (Osaka, Kobe)

meshes(Mesh)       the Shinkansen's viaduct (deck, track, piers, the concourse's walls under the station, noise
                   walls, overhead line), the JR tracks and their overhead line, the platforms (slab, edges, tactile
                   strips, canopies, lights, signs, benches, the Shinkansen's platform gates)
surfaces()         the platforms, for the game to walk on
trains()           game.json "trains": each track's course and what runs on it (web/game/trains.js)
assets(out_dir)    the signs' sheet (rail_signs.png)
glows()            the platforms' light after dark;  demolished()  the PLATEAU solids over the Shinkansen's platforms
"""
import json
import math
import os

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon

from railkit import Kit, offset, sign, sign_uv, tri_poly

HERE = os.path.dirname(os.path.abspath(__file__))
LINES = {"東海道新幹線": "shinkansen", "東海道本線": "tokaido"}
SPAN = {"shinkansen": (-1700.0, 740.0), "tokaido": (-1500.0, 1000.0)}   # the stretch drawn, x (m east)
STATION_X = -330.0       # the station's middle, x
SH_UP = 8.6              # the Shinkansen's rail over the ground at the station
JR_UP = 0.3              # the JR lines' rail over the ground
PLAT = {"shinkansen": 1.25, "tokaido": 0.92}
SLAB = 1.6               # the Shinkansen's deck under the rail (slab track, deck and girders)
EASE = 180.0             # a platform's own track eases back to the through track over this, beyond each end
PLATFORMS = {"11;12": "shinkansen", "13;14": "shinkansen", "2;3": "tokaido", "4;5": "tokaido"}
EAST = {"shinkansen": (11, 12), "tokaido": (2, 3)}   # the tracks of trains bound east (Tokyo; Kusatsu and Maibara)
SH_DOORS = (-10.9, 10.9)   # a Shinkansen car's doors (one a side at each end), from its middle; 25 m cars
SH_CAR, SH_CARS = 25.0, 16

MATERIALS = {
    "rail_ballast": {"color": "#6d665d", "roughness": 0.95, "metalness": 0.0},
    "rail_bed": {"color": "#6a625a", "roughness": 0.95, "metalness": 0.0, "pattern": "deck_zones", "zones": [[2.7, "rail"]]},
    "rail_slab": {"color": "#8f8c85", "roughness": 0.9, "metalness": 0.0},
    "rail_steel": {"color": "#8d8478", "roughness": 0.32, "metalness": 0.85},
    "rail_concrete": {"lamp_lit": True, "color": "#b0aca3", "roughness": 0.85, "metalness": 0.0},
    "rail_soffit": {"color": "#8f8c85", "roughness": 0.9, "metalness": 0.0},
    "rail_shop": {"color": "#2b2f33", "roughness": 0.25, "metalness": 0.3, "pattern": "curtain_wall", "bay_m": 1.6, "storey_m": 4.2,
                  "spandrel": 0.18, "frame": "#3a3d40", "mullion_m": 0.1, "lit_share": 0.92, "lit_k": 1.4, "warm_share": 0.75},
    "rail_mast": {"color": "#6f7c7a", "roughness": 0.6, "metalness": 0.5},
    "rail_wire": {"color": "#3c3a36", "roughness": 0.5, "metalness": 0.7, "shadow": False},
    "rail_platform": {"color": "#aaa59c", "roughness": 0.8, "metalness": 0.0, "pattern": "granite", "joints_m": [0.3, 0.3], "street_lit": True},
    "rail_yellow": {"lamp_lit": True, "color": "#e8c21c", "roughness": 0.7, "metalness": 0.0, "decal": True},
    "rail_white": {"lamp_lit": True, "color": "#ecebe6", "roughness": 0.6, "metalness": 0.0, "decal": True},
    "rail_roof": {"color": "#c4c8c6", "roughness": 0.5, "metalness": 0.5},
    "rail_ceiling": {"lamp_lit": True, "color": "#e2e0d8", "roughness": 0.7, "metalness": 0.0},
    "rail_frame": {"lamp_lit": True, "color": "#9aa6a8", "roughness": 0.55, "metalness": 0.4},
    "rail_lamp": {"color": "#f4f6ee", "roughness": 0.4, "metalness": 0.0, "emissive": "#f2fbe9", "glow": 2.6, "glow_day": 0.9},
    "rail_gate": {"lamp_lit": True, "color": "#e9ebea", "roughness": 0.45, "metalness": 0.2},
    "rail_gate_line": {"lamp_lit": True, "color": "#e86a10", "roughness": 0.5, "metalness": 0.0},
    "rail_sign": {"color": "#ffffff", "roughness": 0.5, "metalness": 0.0, "map": "rail_signs.png", "emissive_map": True, "glow": 1.25, "glow_day": 0.35},
    "rail_bench": {"lamp_lit": True, "color": "#3d6f9a", "roughness": 0.6, "metalness": 0.1, "floor": False},
    "rail_dark": {"color": "#16181a", "roughness": 0.9, "metalness": 0.0},
}

_S = {}


def city():
    if "C" not in _S:
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), "pipeline"))
        from cityctx import City
        _S["C"] = City("kyoto")
    return _S["C"]


def smooth(v, k):
    """A running mean over 2k + 1 samples, the ends held."""
    v = np.asarray(v, float)
    p = np.concatenate([np.full(k, v[0]), v, np.full(k, v[-1])])
    c = np.cumsum(np.concatenate([[0.0], p]))
    return (c[2 * k + 1:] - c[:-2 * k - 1]) / (2 * k + 1)


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def layout():
    """Everything the meshes, the strips and the game data share, worked out once."""
    if "L" in _S:
        return _S["L"]
    path = os.path.join(HERE, "rail_osm.json")
    if not os.path.exists(path):
        return None
    import archkit as ak
    C, D, T = city(), json.load(open(path, encoding="utf8")), ak.Terrain("kyoto")
    loc = lambda ll: [C.fwd.transform(*p) for p in ll]
    by = {}
    for t in D["tracks"]:
        if t["line"] in LINES:
            by.setdefault(LINES[t["line"]], []).append(LineString(loc(t["ll"])))
    east = lambda g: g if g.coords[0][0] < g.coords[-1][0] else LineString(g.coords[::-1])
    lines = {}
    for line, ls in by.items():
        m = shapely.line_merge(shapely.union_all(ls))
        gs = sorted(getattr(m, "geoms", [m]), key=lambda g: -g.length)
        x0, x1 = SPAN[line]
        mains = []
        for g in gs[:4]:
            g = east(g).intersection(shapely.box(x0, -1e5, x1, 1e5))
            g = max(getattr(g, "geoms", [g]), key=lambda q: q.length)
            if g.length > 0.8 * (x1 - x0):
                mains.append(east(g))
        cut = lambda g: LineString([(STATION_X, -1e5), (STATION_X, 1e5)]).intersection(g)
        mains.sort(key=lambda g: -cut(g).y)   # north first
        lines[line] = {"mains": mains}
    # each line's reference, its eastbound through track nearest the middle, and frames along it (s from its west end)
    for line, Lx in lines.items():
        ys = [LineString([(STATION_X, -1e5), (STATION_X, 1e5)]).intersection(g).y for g in Lx["mains"]]
        mid = (max(ys) + min(ys)) / 2
        e = [g for g, y in zip(Lx["mains"], ys) if y > mid]
        w = [g for g, y in zip(Lx["mains"], ys) if y <= mid]
        Lx["east"] = min(e, key=lambda g: abs(LineString([(STATION_X, -1e5), (STATION_X, 1e5)]).intersection(g).y - mid))
        Lx["west"] = max(w, key=lambda g: LineString([(STATION_X, -1e5), (STATION_X, 1e5)]).intersection(g).y)
        Lx["ref"] = Lx["east"]
    stops = {}
    for q in D["stops"]:
        if q["name"] == "京都":
            for n in str(q["platform"]).split(";"):
                if n.isdigit():
                    stops[int(n)] = np.array(C.fwd.transform(*q["ll"]))

    def framer(ref):
        def frame(s):
            a, b = ref.interpolate(s - 0.5), ref.interpolate(s + 0.5)
            t = np.array([b.x - a.x, b.y - a.y])
            t /= np.linalg.norm(t)
            p = ref.interpolate(s)
            return np.array([p.x, p.y]), t, np.array([-t[1], t[0]])   # the point, along (east), across (to the north)

        def sv(x, y):
            s = ref.project(Point(x, y))
            p, t, n = frame(s)
            return s, float((np.array([x, y]) - p) @ n)
        return frame, sv
    for Lx in lines.values():
        Lx["frame"], Lx["sv"] = framer(Lx["ref"])
    # the platforms, each as frames along its line's reference: (s, centre, along, across, width)
    plats = []
    for p in D["platforms"]:
        line = PLATFORMS.get(p.get("ref"))
        if not line:
            continue
        P = Polygon(loc(p["ll"]))
        if abs(P.centroid.x - STATION_X) > 300:
            continue
        frame, sv = lines[line]["frame"], lines[line]["sv"]
        ss = [sv(*c)[0] for c in P.exterior.coords]
        fr = []
        for s in np.arange(min(ss) + 1.0, max(ss) - 0.99, 2.0):
            pp, t, n = frame(s)
            q = LineString([pp - n * 60, pp + n * 60]).intersection(P)
            if q.is_empty:
                continue
            q = max(getattr(q, "geoms", [q]), key=lambda g: g.length)
            (x0, y0), (x1, y1) = q.coords[0], q.coords[-1]
            fr.append((float(s), np.array([(x0 + x1) / 2, (y0 + y1) / 2]), t, n, float(q.length)))
        nums = [int(v) for v in p["ref"].split(";")]
        plats.append({"ref": p["ref"], "line": line, "poly": P, "frames": fr, "nums": nums, "key": p["ref"].replace(";", "_")})
    # the tracks: each through track, and each platform's own, in the direction of travel, with its rail's height
    lev = {}
    for line, Lx in lines.items():
        ref = Lx["ref"]
        ss = np.arange(0.0, ref.length + 0.1, 5.0)
        g = smooth([T(*ref.interpolate(s).coords[0]) for s in ss], 12)
        s_st = Lx["sv"](STATION_X, LineString([(STATION_X, -1e5), (STATION_X, 1e5)]).intersection(ref).y)[0]
        if line == "shinkansen":   # level along the platforms, easing to SH_UP over the ground beyond
            z_st = float(np.interp(s_st, ss, g)) + SH_UP
            k = np.array([ease((abs(s - s_st) - 240.0) / 260.0) for s in ss])
            z = z_st * (1 - k) + (g + SH_UP) * k
        else:
            z = g + JR_UP
        lev[line] = (ss, z)
        Lx["s_st"] = s_st
    zat = lambda line, s: float(np.interp(s, *lev[line]))
    tracks = []
    for p in plats:
        Lx = lines[p["line"]]
        frame, sv = Lx["frame"], Lx["sv"]
        s0, s1 = p["frames"][0][0], p["frames"][-1][0]
        for no in p["nums"]:
            if no not in stops:
                continue
            bound_east = no in EAST[p["line"]]
            main = Lx["east"] if bound_east else Lx["west"]
            sm, vk = sv(*stops[no])
            vm = sv(*main.interpolate(main.project(Point(*stops[no]))).coords[0])[1]
            d = vk - vm
            pts = []
            for k in range(int(main.length / 4.0) + 1):
                q = main.interpolate(k * 4.0)
                s, v = sv(q.x, q.y)
                w = 1.0 if s0 - 15 <= s <= s1 + 15 else 1 - ease((min(abs(s - s0 + 15), abs(s - s1 - 15))) / EASE)
                _, t, n = frame(s)
                xy = np.array([q.x, q.y]) + n * d * w
                pts.append((*xy, zat(p["line"], s)))
            if not bound_east:
                pts = pts[::-1]
            side = 1 if (p["frames"][len(p["frames"]) // 2][1] - stops[no]) @ frame(sm)[2] > 0 else -1   # the platform north of the track
            tracks.append({"id": f"{p['line']}-{no}", "line": p["line"], "no": no, "east": bound_east, "pts": np.array(pts), "plat": p,
                           "side": side if bound_east else -side})   # (+1: on the left of the way the train runs)
    L = {"C": C, "T": T, "lines": lines, "plats": plats, "tracks": tracks, "zat": zat}
    # the Shinkansen's deck: its tracks and platforms, closed up between them
    sh = [t for t in tracks if t["line"] == "shinkansen"]
    deck = shapely.union_all([LineString(t["pts"][:, :2]).buffer(2.4, cap_style="flat") for t in sh]
                             + [g.buffer(2.4, cap_style="flat") for g in lines["shinkansen"]["mains"]] + [p["poly"].buffer(0.3) for p in plats if p["line"] == "shinkansen"])
    deck = deck.buffer(2.0, join_style="mitre").buffer(-2.0, join_style="mitre").simplify(0.25)
    L["deck"] = max(getattr(deck, "geoms", [deck]), key=lambda g: g.area)
    # the city's solids over the Shinkansen's platforms and its tracks (the station's half the model had as blocks) come down
    gone = []
    keep = L["deck"].buffer(3.0)
    jr = shapely.union_all([p["poly"].buffer(1.0) for p in plats if p["line"] == "tokaido"])
    for q in ak.load_solids("kyoto"):
        if len(q["ring"]) < 3:
            continue
        P = Polygon(q["ring"]).buffer(0)
        if P.area < 1:
            continue
        a = P.intersection(keep).area
        if q["top"] < 25 and (a > 0.4 * P.area or (P.area > 2000 and a > 0.25 * P.area)):
            gone.append(q["si"])
        elif q["top"] < 12 and P.intersection(jr).area > 0.4 * P.area:
            gone.append(q["si"])
    L["gone"] = gone
    _S["L"] = L
    return L


# ---------------------------------------------------------------- the signs' sheet

SHEET = (2048, 1024)
SIGNS = {"name_shinkansen": (0, 0, 1024, 320), "name_tokaido": (0, 330, 1024, 320), "blank": (4, 960, 60, 60)}
for _i, _n in enumerate((11, 12, 13, 14, 2, 3, 4, 5)):
    SIGNS[f"dir{_n}"] = (1024, _i * 128, 1024, 124)
ROWS = {11: ("shinkansen", "東海道新幹線", "名古屋・東京 方面", "Tōkaidō Shinkansen  for Nagoya, Tōkyō"),
        12: ("shinkansen", "東海道新幹線", "名古屋・東京 方面", "Tōkaidō Shinkansen  for Nagoya, Tōkyō"),
        13: ("shinkansen", "東海道新幹線", "新大阪・博多 方面", "Tōkaidō Shinkansen  for Shin-Ōsaka, Hakata"),
        14: ("shinkansen", "東海道新幹線", "新大阪・博多 方面", "Tōkaidō Shinkansen  for Shin-Ōsaka, Hakata"),
        2: ("tokaido", "琵琶湖線", "草津・米原 方面", "Biwako Line  for Kusatsu, Maibara"),
        3: ("tokaido", "琵琶湖線", "草津・米原 方面", "Biwako Line  for Kusatsu, Maibara"),
        4: ("tokaido", "JR京都線", "大阪・三ノ宮 方面", "JR Kyōto Line  for Ōsaka, Sannomiya"),
        5: ("tokaido", "JR京都線", "大阪・三ノ宮 方面", "JR Kyōto Line  for Ōsaka, Sannomiya")}
COL = {"shinkansen": (0, 98, 172), "tokaido": (0, 114, 188)}


def assets(out_dir):
    """The signs: the station's name boards (JR Central's on the Shinkansen, JR West's on the JR lines) and the platform
    boards. Lettered in IPA Gothic (IPA Font License) where it is installed, else the default face."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", SHEET, (20, 22, 24))
    d = ImageDraw.Draw(img)

    def font(size):
        for p in ("/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf", "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
                  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"):
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
        return ImageFont.load_default()

    def text(xy, s, size, fill, anchor="mm", stroke=0):
        d.text(xy, s, font=font(size), fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=fill)
    ORANGE, BLUE = (240, 131, 0), (0, 114, 188)
    for key, band, prev, nxt in (("name_shinkansen", ORANGE, ("米原", "Maibara"), ("新大阪", "Shin-Ōsaka")),
                                 ("name_tokaido", BLUE, ("山科", "Yamashina"), ("西大路", "Nishiōji"))):
        x, y, w, h = SIGNS[key]
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(248, 248, 244))
        text((x + w / 2, y + 86), "京都", 124, (20, 20, 20), stroke=2)
        text((x + w / 2, y + 168), "きょうと", 38, (40, 40, 40))
        text((x + w / 2, y + 214), "Kyōto", 42, (20, 20, 20), stroke=1)
        d.rectangle([x, y + 246, x + w - 1, y + 276], fill=band)
        d.polygon([(x + 26, y + 261), (x + 60, y + 243), (x + 60, y + 279)], fill=(248, 248, 244))
        d.polygon([(x + w - 26, y + 261), (x + w - 60, y + 243), (x + w - 60, y + 279)], fill=(248, 248, 244))
        text((x + 150, y + 296), nxt[0], 30, (20, 20, 20))
        text((x + 300, y + 298), nxt[1], 24, (60, 60, 60))
        text((x + w - 300, y + 296), prev[0], 30, (20, 20, 20))
        text((x + w - 150, y + 298), prev[1], 24, (60, 60, 60))
    for n, (line, name, to, en) in ROWS.items():
        x, y, w, h = SIGNS[f"dir{n}"]
        col = ORANGE if line == "shinkansen" else BLUE
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(34, 36, 40))
        d.rectangle([x, y, x + 12, y + h - 1], fill=col)
        d.rounded_rectangle([x + 30, y + 16, x + 132, y + h - 16], 8, fill=(246, 246, 240))
        text((x + 81, y + h / 2), str(n), 84, (20, 20, 20), stroke=2)
        text((x + 160, y + 42), name, 36, col, anchor="lm")
        text((x + 470, y + 44), to, 48, (246, 246, 240), anchor="lm", stroke=1)
        text((x + 160, y + 96), en, 28, (214, 214, 208), anchor="lm")
    x, y, w, h = SIGNS["blank"]
    d.rectangle([x - 4, y - 4, x + w + 3, y + h + 3], fill=(244, 248, 238))
    img.save(os.path.join(out_dir, "rail_signs.png"))
    return ["rail_signs.png"]


def _sign(K, c, N, w, z0, h, key, off=0.05):
    sign(K["rail_sign"], sign_uv(SIGNS, SHEET, key), c, N, w, z0, h, off)


# ---------------------------------------------------------------- the meshes

def grid_along(mesh, rows, uv=False):
    """A strip from rows of [left, right] points (3D)."""
    if len(rows) < 2:
        return
    us = None
    if uv:
        acc, us = 0.0, []
        for k, (a, b) in enumerate(rows):
            if k:
                acc += float(np.linalg.norm(np.asarray(a[:2]) - np.asarray(rows[k - 1][0][:2])))
            us.append([[acc, 0.0], [acc, float(np.linalg.norm(np.asarray(b[:2]) - np.asarray(a[:2])))]])
    mesh.grid([[list(a), list(b)] for a, b in rows], us)


def meshes(Mesh):
    L = layout()
    if not L:
        return {}, []
    T, lines, zat = L["T"], L["lines"], L["zat"]
    K = Kit(Mesh, "rail", MATERIALS, flood=("rail_lamp", "rail_sign", "rail_shop"), sky={"rail_soffit": 0.3, "rail_ceiling": 0.45, "rail_frame": 0.6})
    own = L["own"] = []
    sh_plats = shapely.union_all([p["poly"] for p in L["plats"] if p["line"] == "shinkansen"])
    # ---- the tracks: the through tracks and the platforms' own (each drawn once, the through ones where no platform's is)
    drawn = []
    for line, Lx in lines.items():
        for g in Lx["mains"]:
            drawn.append((line, np.array([(*g.interpolate(k * 2.0).coords[0],) for k in range(int(g.length / 2.0) + 1)])))
    for t in L["tracks"]:
        drawn.append((t["line"], t["pts"][:, :2]))
    for line, P in drawn:
        frame, sv = lines[line]["frame"], lines[line]["sv"]
        z = np.array([zat(line, sv(*q)[0]) for q in P])
        bed = ("rail_slab", 1.3, 0.25) if line == "shinkansen" else ("rail_bed", 1.35, 0.2)
        rows = []
        for q, n, zz in zip(P, _normals(P), z):
            rows.append(([*(q - n * bed[1]), zz - bed[2]], [*(q + n * bed[1]), zz - bed[2]]))
        grid_along(K[bed[0]], rows, uv=bed[0] == "rail_bed")
        g = 1.435 if line == "shinkansen" else 1.067
        for sgn in (-1, 1):
            o = offset(P, sgn * g / 2)
            K["rail_steel"].sweep([[*q, zz - 0.08] for q, zz in list(zip(o, z))[::2]], [(-0.035, -0.08), (0.035, -0.08), (0.035, 0.08), (-0.035, 0.08)])
    # ---- the JR lines' ballast between their tracks, at grade
    jr = shapely.union_all([LineString(P).buffer(2.6, cap_style="flat") for line, P in drawn if line == "tokaido"])
    jr = jr.buffer(1.5).buffer(-1.5).simplify(0.3)
    jr = jr.difference(shapely.union_all([p["poly"] for p in L["plats"] if p["line"] == "tokaido"]))
    for g in getattr(jr, "geoms", [jr]):
        if g.geom_type == "Polygon" and g.area > 4:
            for tri in shapely.constrained_delaunay_triangles(g).geoms:
                c = list(tri.exterior.coords)[:3]
                K["rail_ballast"].tri(*[[x, y, T(x, y) + JR_UP - 0.24] for x, y in c])
    # ---- the Shinkansen's viaduct: its deck as strips across, the soffit, its edges' faces down to the soffit
    Lx = lines["shinkansen"]
    frame, sv = Lx["frame"], Lx["sv"]
    deck = L["deck"]
    ref = Lx["ref"]
    s_lo, s_hi = sv(*deck.exterior.coords[0])[0], 0
    ss = [sv(*c)[0] for c in deck.exterior.coords]
    s_lo, s_hi = max(0.0, min(ss)), min(ref.length, max(ss))
    rows_top, rows_soffit, prev = [], [], None
    for s in np.arange(s_lo + 1.0, s_hi - 1.0, 4.0):
        p, t, n = frame(s)
        cut = LineString([p - n * 80, p + n * 80]).intersection(deck)
        if cut.is_empty:
            continue
        segs = sorted(getattr(cut, "geoms", [cut]), key=lambda g: -g.length)
        a, b = np.array(segs[0].coords[0]), np.array(segs[0].coords[-1])
        z = zat("shinkansen", s)
        rows_top.append(([*a, z - 0.27], [*b, z - 0.27]))
        rows_soffit.append(([*b, z - SLAB], [*a, z - SLAB]))
        if prev is not None:
            for e0, e1 in ((prev[0], a), (b, prev[1])):   # the deck's two faces, a parapet over each away from the platforms
                K["rail_concrete"].quad([*e0, prev[2] - SLAB], [*e1, z - SLAB], [*e1, z - 0.27], [*e0, prev[2] - 0.27])
                m = (e0 + e1) / 2
                if sh_plats.distance(Point(*m)) > 3.0:
                    o = -n * 0.15 if e0 is prev[0] else n * 0.15
                    K["rail_concrete"].box([*(e0 + o * (1 if e0 is prev[0] else 1)), prev[2] + 0.6], [*(e1 + o), z + 0.6], 0.22, 1.75)
        prev = (a, b, z)
    grid_along(K["rail_slab"], rows_top)
    grid_along(K["rail_soffit"], rows_soffit)
    # piers every 12 m, a cross beam on each pair; under the station, the concourse's walls between them (lit shop fronts)
    st_s = (min(f[0] for p in L["plats"] if p["line"] == "shinkansen" for f in p["frames"]) - 10,
            max(f[0] for p in L["plats"] if p["line"] == "shinkansen" for f in p["frames"]) + 10)
    prev = None
    for s in np.arange(s_lo + 6.0, s_hi - 6.0, 12.0):
        p, t, n = frame(s)
        cut = LineString([p - n * 80, p + n * 80]).intersection(deck)
        if cut.is_empty:
            prev = None
            continue
        seg = max(getattr(cut, "geoms", [cut]), key=lambda g: g.length)
        a, b = np.array(seg.coords[0]), np.array(seg.coords[-1])
        w = float(np.linalg.norm(b - a))
        d = (b - a) / max(w, 1e-6)
        zs = zat("shinkansen", s) - SLAB
        cols = [a + d * 1.2, b - d * 1.2] + ([a + d * w / 2] if w > 18 else [])
        for c in cols:
            K["rail_concrete"].box([*c, T(*c) - 0.5], [*c, zs], 1.3, 1.3)
        K["rail_concrete"].box([*(a + d * 0.6), zs - 0.6], [*(b - d * 0.6), zs - 0.6], 1.2, 1.2)
        inside = st_s[0] < s < st_s[1]
        if inside and prev is not None:   # the concourse's walls on both faces, set back under the deck's edge
            for e0, e1 in ((prev[0] + prev[2] * 1.2, a + d * 1.2), (prev[1] - prev[2] * 1.2, b - d * 1.2)):
                g0, g1 = T(*e0), T(*e1)
                K["rail_shop"].quad([*e0, g0 - 0.3], [*e1, g1 - 0.3], [*e1, zs - 0.9], [*e0, prev[3] - 0.9],
                                    [[0, 0], [float(np.linalg.norm(e1 - e0)), 0], [float(np.linalg.norm(e1 - e0)), zs - 0.9 - g1], [0, prev[3] - 0.9 - g0]])
                K["rail_dark"].quad([*e0, prev[3] - 0.9], [*e1, zs - 0.9], [*e1, zs - 0.6], [*e0, prev[3] - 0.6])
        prev = (a, b, d, zs) if inside else None
    # ---- the overhead line: gantries every 50 m, a contact wire over each track
    for line, Lx in lines.items():
        frame, sv, ref = Lx["frame"], Lx["sv"], Lx["ref"]
        ws = [LineString(P) for l2, P in drawn if l2 == line]
        allw = shapely.union_all([g.buffer(2.6, cap_style="flat") for g in ws])
        for s in np.arange(30.0, ref.length - 30.0, 50.0):
            p, t, n = frame(s)
            cut = LineString([p - n * 60, p + n * 60]).intersection(allw)
            if cut.is_empty:
                continue
            parts = list(getattr(cut, "geoms", [cut]))
            xs = [sv(*c)[1] for g in parts for c in g.coords]
            a, b = p + n * (min(xs) - 0.6), p + n * (max(xs) + 0.6)
            z = zat(line, s)
            g0 = z - (SLAB if line == "shinkansen" else JR_UP + 0.2)
            for e in (a, b):
                K["rail_mast"].box([*e, g0], [*e, z + 7.4], 0.3, 0.3)
            K["rail_mast"].box([*a, z + 6.9], [*b, z + 6.9], 0.22, 0.32)
        for g in ws:
            P = np.array(g.coords)[::3]
            K["rail_wire"].sweep([[*q, zat(line, sv(*q)[0]) + 5.0] for q in P], [(-0.015, -0.015), (0.015, -0.015), (0, 0.015)])
    # ---- the platforms
    for p in L["plats"]:
        platform(L, K, Mesh, p)
    out = [m for m in K.values() if m.v] + own
    return MATERIALS, out


def _normals(P):
    P = np.asarray(P, float)
    d = np.gradient(P, axis=0)
    d /= np.linalg.norm(d, axis=1)[:, None]
    return np.stack([-d[:, 1], d[:, 0]], axis=1)


def platform(L, K, Mesh, p):
    """An island platform: its slab on the frames along it at its track's level (the rail's height + PLAT), its faces down
    to the bed, the tactile strip and white line along each edge, a canopy on a row of columns with its lights, the
    station's name boards and the platform boards, benches; on the Shinkansen, platform gates along each edge."""
    line, fr = p["line"], p["frames"]
    zat, sv = L["zat"], L["lines"][line]["sv"]
    up = PLAT[line]
    zp = [zat(line, f[0]) + up for f in fr]
    zb = [zat(line, f[0]) - (0.27 if line == "shinkansen" else 0.24) for f in fr]
    top = Mesh(f"rail_platform_{p['key']}", "rail_platform", False, uv=True)   # walked on as strips (surfaces)
    grid_along(top, [([*(f[1] - f[3] * f[4] / 2), z], [*(f[1] + f[3] * f[4] / 2), z]) for f, z in zip(fr, zp)], uv=True)
    L["own"].append(top)
    for sgn in (-1, 1):
        edge = [f[1] + f[3] * sgn * f[4] / 2 for f in fr]
        for k in range(len(fr) - 1):
            a, b = edge[k], edge[k + 1]
            if sgn > 0:
                a, b = b, a
                za, zb_, ta, tb = zp[k + 1], zp[k], zb[k + 1], zb[k]
            else:
                za, zb_, ta, tb = zp[k], zp[k + 1], zb[k], zb[k + 1]
            K["rail_concrete"].quad([*a, ta], [*b, tb], [*b, zb_], [*a, za])
        # the tactile strip 0.9 m in (1.1 on the Shinkansen) and the white line at the edge
        din = 1.1 if line == "shinkansen" else 0.9
        grid_along(K["rail_yellow"], [([*(f[1] + f[3] * sgn * (f[4] / 2 - din - 0.15)), z + 0.012], [*(f[1] + f[3] * sgn * (f[4] / 2 - din + 0.15)), z + 0.012]) for f, z in zip(fr[1:-1], zp[1:-1])])
        grid_along(K["rail_white"], [([*(f[1] + f[3] * sgn * (f[4] / 2 - 0.11)), z + 0.012], [*(f[1] + f[3] * sgn * (f[4] / 2 - 0.05)), z + 0.012]) for f, z in zip(fr[1:-1], zp[1:-1])])
    for k in (0, len(fr) - 1):   # the ends
        f, z = fr[k], zp[k]
        a, b = f[1] - f[3] * f[4] / 2, f[1] + f[3] * f[4] / 2
        if k == 0:
            a, b = b, a
        K["rail_concrete"].quad([*a, zb[k]], [*b, zb[k]], [*b, z], [*a, z])
    # ---- the canopy: a butterfly roof on a row of columns down the middle, open for the last 20 m at each end
    cov = [(f, z) for f, z in zip(fr, zp) if fr[0][0] + 20 < f[0] < fr[-1][0] - 20]
    he, hc = 4.6, 3.9
    for sgn in (-1, 1):
        rows_t, rows_b = [], []
        for f, z in cov:
            e = f[1] + f[3] * sgn * (f[4] / 2 + 0.3)
            rows_t.append(([*f[1], z + hc + 0.12], [*e, z + he + 0.12]))
            rows_b.append(([*f[1], z + hc], [*e, z + he]))
        if sgn < 0:
            rows_t = [(b, a) for a, b in rows_t]
        else:
            rows_b = [(b, a) for a, b in rows_b]
        grid_along(K["rail_roof"], rows_t)
        grid_along(K["rail_ceiling"], rows_b)
        for off in (0.3, 0.65):
            pts = [[*(f[1] + f[3] * sgn * (f[4] / 2 + 0.3) * off), z + hc + (he - hc) * off - 0.07] for f, z in cov]
            for k in range(0, len(pts) - 1, 3):
                a, b = np.array(pts[k]), np.array(pts[min(k + 2, len(pts) - 1)])
                K["rail_lamp"].box(a + (b - a) * 0.04, b - (b - a) * 0.04, 0.11, 0.04)
    for f, z in cov[2::5]:
        m, n = f[1], f[3]
        K["rail_frame"].box([*m, z], [*m, z + hc], 0.24, 0.24)
        for sgn in (-1, 1):
            e = m + n * sgn * (f[4] / 2 + 0.2)
            K["rail_frame"].box([*m, z + hc - 0.2], [*e, z + he - 0.1], 0.1, 0.16)
    # ---- the platform gates on the Shinkansen: a waist-high wall along each edge with an opening at each door of a
    # standing 16-car train, its two gate leaves folded back into the posts (they open with the train's doors)
    if line == "shinkansen":
        for sgn in (-1, 1):
            edge = LineString([f[1] + f[3] * sgn * (f[4] / 2 - 0.55) for f in fr])
            Lm = edge.length
            doors = sorted(Lm / 2 + (k - (SH_CARS - 1) / 2) * SH_CAR + dd for k in range(SH_CARS) for dd in SH_DOORS)
            cuts = [(u - 0.9, u + 0.9) for u in doors if 1.0 < u < Lm - 1.0]
            at = lambda u: np.array(edge.interpolate(u).coords[0])
            zu = lambda u: float(np.interp(u, np.linspace(0, Lm, len(zp)), zp))
            prev = 0.8
            for a, b in cuts + [(Lm - 0.8, Lm)]:
                if a - prev > 0.3:
                    n_seg = max(1, int((a - prev) / 4.0))
                    for k in range(n_seg):
                        q0, q1 = prev + (a - prev) * k / n_seg, prev + (a - prev) * (k + 1) / n_seg
                        K["rail_gate"].box([*at(q0), zu(q0) + 0.6], [*at(q1), zu(q1) + 0.6], 0.2, 1.2)
                        K["rail_gate_line"].box([*at(q0), zu(q0) + 1.215], [*at(q1), zu(q1) + 1.215], 0.22, 0.03)
                prev = b
    # ---- the name boards and platform boards, hung from the canopy, read along the platform; benches between
    nums = sorted(p["nums"])
    for k, (f, z) in enumerate(cov[6::16]):
        m, t, n = f[1], f[2], f[3]
        if k % 2 == 0:
            for sgn in (-1, 1):
                c0 = m + n * sgn * (f[4] / 4 + 0.2)
                a, b = c0 - t * 1.45, c0 + t * 1.45
                for e in (a, b):
                    K["rail_frame"].box([*e, z], [*e, z + 2.25], 0.08, 0.08)
                K["rail_dark"].box([*a, z + 1.72], [*b, z + 1.72], 0.08, 0.98)
                _sign(K, c0, n * sgn, 2.86, z + 1.26, 0.92, f"name_{line}", 0.046)
        else:
            for sgn, num in ((-1, nums[-1]), (1, nums[0])):
                key = f"dir{num}"
                if key not in SIGNS:
                    continue
                c0 = m + n * sgn * (f[4] / 4 + 0.2)
                a, b = c0 - n * 1.8, c0 + n * 1.8
                K["rail_dark"].box([*a, z + 2.71], [*b, z + 2.71], 0.1, 0.5)
                for face in (1, -1):
                    _sign(K, c0, t * face, 3.6, z + 2.47, 0.48, key, 0.056)
                for e in (a + n * 0.2, b - n * 0.2):
                    K["rail_frame"].box([*e, z + 2.95], [*e, z + hc + 0.2], 0.04, 0.04)
        q = m + t * 7.0   # a bench, two seats back to back
        for sgn in (-1, 1):
            c0 = q + n * sgn * 0.3
            K["rail_bench"].box([*(c0 - t * 1.0), z + 0.42], [*(c0 + t * 1.0), z + 0.42], 0.42, 0.06)
            K["rail_bench"].box([*(q + n * sgn * 0.06 - t * 1.0), z + 0.68], [*(q + n * sgn * 0.06 + t * 1.0), z + 0.68], 0.05, 0.42)
        for e in (-0.8, 0.8):
            K["rail_frame"].box([*(q + t * e), z], [*(q + t * e), z + 0.4], 0.5, 0.06)


# ---------------------------------------------------------------- the game's strips and its trains

def surfaces():
    """The platforms as strips along their length; held (a walker does not step off their sides onto the track)."""
    L = layout()
    if not L:
        return []
    out = []
    for p in L["plats"]:
        line, fr = p["line"], p["frames"]
        zat = L["zat"]
        step = 8
        for k in range(0, len(fr) - 1, step):
            a, b = fr[k], fr[min(k + step, len(fr) - 1)]
            d = b[1] - a[1]
            ln = float(np.linalg.norm(d))
            ax, c = d / ln, (a[1] + b[1]) / 2
            hw = min(f[4] for f in fr[k:k + step + 1]) / 2 - 0.05
            z0, z1 = zat(line, a[0]) + PLAT[line], zat(line, b[0]) + PLAT[line]
            e0, e1 = (1.0 if k == 0 else 0.5), (1.0 if k + step >= len(fr) - 1 else 0.5)
            out.append({"name": f"Kyoto Station, platforms {' and '.join(str(n) for n in sorted(p['nums']))}", "type": "strip",
                        "origin": [round(float(c[0]), 2), round(float(c[1]), 2)], "axis": [round(float(ax[0]), 5), round(float(ax[1]), 5)], "half_width": round(hw, 2),
                        "profile": [[round(-ln / 2 - e0, 2), round(z0, 2)], [round(ln / 2 + e1, 2), round(z1, 2)]],
                        "thickness": (SLAB + PLAT[line]) if line == "shinkansen" else PLAT[line] + 0.3, "mesh": f"rail_platform_{p['key']}", "mapped": False,
                        "hold": True, "label": "Kyoto Station 京都駅"})
    return out


def trains():
    """game.json "trains" (web/game/trains.js): each track's course at rail level in the direction of travel, its halt at
    Kyoto (where a stopping train's middle rests, the platform's number and side, and on the Shinkansen its platform
    gates' leaves), and the services on it."""
    L = layout()
    if not L:
        return None
    tracks = []
    for t in L["tracks"]:
        P = t["pts"]
        g = LineString(P[:, :2])
        p = t["plat"]
        mid = p["frames"][len(p["frames"]) // 2][1]
        m = g.project(Point(*mid))
        q = {"station": "kyoto", "m": round(m, 1), "platform": t["no"], "side": t["side"]}
        if t["line"] == "shinkansen":   # the gates: an opening at each door of the standing train
            sgn = 1 if (np.array(g.interpolate(m).coords[0]) - mid) @ p["frames"][len(p["frames"]) // 2][3] > 0 else -1   # the platform's face towards the track
            fr = p["frames"]
            edge = LineString([f[1] + f[3] * sgn * (f[4] / 2 - 0.55) for f in fr])
            Lm = edge.length
            doors = sorted(Lm / 2 + (k - (SH_CARS - 1) / 2) * SH_CAR + dd for k in range(SH_CARS) for dd in SH_DOORS)
            pts = [edge.interpolate(u) for u in doors if 1.0 < u < Lm - 1.0]
            q["psd"] = {"off": round(g.distance(pts[len(pts) // 2]) * t["side"], 2), "u": [round(g.project(e), 2) for e in pts], "w": 1.8, "kind": "gate"}
        tracks.append({"id": t["id"], "line": t["line"], "gauge": 1.435 if t["line"] == "shinkansen" else 1.067,
                       "p": [v for x, y, z in P for v in (round(x * 10), round(y * 10), round(z * 10))],
                       "stops": [q], "stop_m": q["m"], "platform": t["no"], "platform_m": PLAT[t["line"]], "hide_m": [12.0, round(g.length - 12.0, 1)]})
    fs = [p["frames"][len(p["frames"]) // 2][1] for p in L["plats"]]
    c = np.mean(fs, axis=0)
    z = L["zat"]("shinkansen", L["lines"]["shinkansen"]["s_st"]) + PLAT["shinkansen"]
    st = {"id": "kyoto", "name": "Kyoto", "native": "京都", "kana": "きょうと", "style": "jrw", "at": [round(float(c[0]), 1), round(float(c[1]), 1), round(z, 2)], "hear_m": 170, "r": 240}
    return {
        "note": "The Tokaido Shinkansen and the Tokaido Main Line through Kyoto Station (cities/kyoto/rail.py): courses in decimetres at rail level, in the direction of travel.",
        "station": st, "stations": [st], "tracks": tracks, "services": SERVICES,
    }


# What runs. Headways a few times shorter than the timetable's, so that there is always a train to watch; every
# Shinkansen stops at Kyoto (the Nozomi, Hikari and Kodama alike), drawn as this project's own high-speed train.
SERVICES = [
    {"track": "shinkansen-12", "stock": "hayate", "cars": 16, "every_s": 300, "offset_s": 20, "stops": True, "v_ms": 24, "kind": "shinkansen",
     "for": {"ja": "東京", "en": "Tokyo"}, "line": {"ja": "のぞみ", "en": "Nozomi"}},
    {"track": "shinkansen-11", "stock": "hayate", "cars": 16, "every_s": 300, "offset_s": 170, "stops": True, "v_ms": 24, "kind": "shinkansen",
     "for": {"ja": "東京", "en": "Tokyo"}, "line": {"ja": "ひかり", "en": "Hikari"}},
    {"track": "shinkansen-13", "stock": "hayate", "cars": 16, "every_s": 300, "offset_s": 95, "stops": True, "v_ms": 24, "kind": "shinkansen",
     "for": {"ja": "博多", "en": "Hakata"}, "line": {"ja": "のぞみ", "en": "Nozomi"}},
    {"track": "shinkansen-14", "stock": "hayate", "cars": 16, "every_s": 300, "offset_s": 245, "stops": True, "v_ms": 24, "kind": "shinkansen",
     "for": {"ja": "新大阪", "en": "Shin-Osaka"}, "line": {"ja": "こだま", "en": "Kodama"}},
    {"track": "tokaido-2", "stock": "jrw225", "cars": 12, "every_s": 240, "offset_s": 60, "stops": True, "v_ms": 20,
     "for": {"ja": "米原", "en": "Maibara"}, "line": {"ja": "新快速", "en": "Special Rapid"}},
    {"track": "tokaido-3", "stock": "jrw225", "cars": 8, "every_s": 240, "offset_s": 180, "stops": True, "v_ms": 17,
     "for": {"ja": "野洲", "en": "Yasu"}, "line": {"ja": "普通", "en": "Local"}},
    {"track": "tokaido-4", "stock": "jrw225", "cars": 12, "every_s": 240, "offset_s": 0, "stops": True, "v_ms": 20,
     "for": {"ja": "姫路", "en": "Himeji"}, "line": {"ja": "新快速", "en": "Special Rapid"}},
    {"track": "tokaido-5", "stock": "jrw225", "cars": 8, "every_s": 240, "offset_s": 120, "stops": True, "v_ms": 17,
     "for": {"ja": "高槻", "en": "Takatsuki"}, "line": {"ja": "普通", "en": "Local"}},
]


def travel():
    L = layout()
    if not L:
        return []
    out = []
    for p in L["plats"]:
        if sorted(p["nums"]) not in ([13, 14], [2, 3]):
            continue
        f = p["frames"][len(p["frames"]) // 2 + 15]
        z = L["zat"](p["line"], f[0]) + PLAT[p["line"]]
        f = (f[0], f[1] - f[3] * 2.5, *f[2:])   # off the row of columns, towards the southern track
        look = f[1] + f[2] * 80 + f[3] * 2
        if p["line"] == "shinkansen":
            out.append({"id": "k-shinkansen", "name": "Kyoto Station, Shinkansen platforms 13 and 14 京都駅", "at": [round(float(f[1][0]), 1), round(float(f[1][1]), 1), round(z, 2)],
                        "look": [round(float(look[0]), 1), round(float(look[1]), 1)],
                        "blurb": "Every Tokaido Shinkansen stops here: the trains for Shin-Osaka and Hakata come in at 13 and 14, the ones for Tokyo across at 11 and 12, the Kyoto Tower over the station building beyond."})
        else:
            out.append({"id": "k-jr-platform", "name": "Kyoto Station, JR platforms 2 and 3 京都駅", "at": [round(float(f[1][0]), 1), round(float(f[1][1]), 1), round(z, 2)],
                        "look": [round(float(look[0]), 1), round(float(look[1]), 1)],
                        "blurb": "The Biwako Line's platform, between the station building and the Shinkansen's viaduct: the Special Rapid for Maibara, a local for Yasu."})
    return out


def treeless():
    """The Shinkansen's deck and 4 m round it: no tree mapped on the ground under it stands up through it."""
    L = layout()
    if not L:
        return []
    g = L["deck"].buffer(4.0).simplify(1.0)
    return [[round(v * 10) for c in q.exterior.coords for v in c] for q in getattr(g, "geoms", [g])]


def demolished():
    L = layout()
    return L["gone"] if L else []


def glows():
    L = layout()
    if not L:
        return []
    out = []
    for p in L["plats"]:
        fr = p["frames"]
        for f in [f for f in fr if fr[0][0] + 20 < f[0] < fr[-1][0] - 20][2::5]:
            out.append([round(float(f[1][0]), 1), round(float(f[1][1]), 1), 9.0, "#f1f6e8", 0.36])
    return out
