"""Circular Quay Station, on the City Circle's viaduct over the quay, and its trains' courses.

The station (1956) is the upper of three levels: the concourse and shops on the quay, the railway's two tracks
with a platform either side about ten metres up, and the Cahill Expressway on its roof. The platforms are open
along both sides: from platform 2, the northern one, the whole of Sydney Cove lies in front of you, the Harbour
Bridge on the left and the Opera House on the right. The city model had it as one box 15.6 m high
(OpenStreetMap way 51065527) with the expressway's deck drawn over it.

Laid out on OpenStreetMap's two tracks ("City Inner", "City Outer") and the station's two platform edges
(cities/sydney/rail_osm.json, pipeline/rail_osm.py). What is not mapped is from photographs and published figures:
  levels     the roof is the box's own top, the expressway's level (ground + 15.6 m), so the Cahill Walk's
             lookout stands as it did; the rail 6.8 m under it, a double-deck train (4.4 m) and its wire under
             the roof's beams; the platforms 1.1 m over the rail
  platforms  8-car (170 m, the mapped edges), 6.5 m wide, open to the north and the south behind a glass
             balustrade, with columns every 8.5 m carrying the roof
  trains     the City Circle keeps left: the northern track (City Outer, platform 2) runs east to St James, the
             southern (City Inner, platform 1) west to Wynyard

meshes(Mesh)   the viaduct's deck and track, the station (platforms, columns, balustrades, roof, lights, signs,
               benches), the concourse under it with a flight of stairs up to each platform, and a tunnel's
               mouth at each end
surfaces()     the platforms and the stairs; trains()  game.json "trains" (web/game/trains.js)
demolished()   the box, and the shop block where the concourse now is; glows()  the platforms' light
assets(out_dir)  the signs' sheet (rail_signs.png)
"""
import json
import os

import numpy as np
import shapely
from shapely.geometry import LineString, Point, Polygon

from railkit import Kit, bay, offset, ribbon, sign, sign_uv, track, tri_poly, wall

HERE = os.path.dirname(os.path.abspath(__file__))
BOX, SHOPS = "w51065527", "w408117953"     # the station's box, and the shop block the concourse replaces
ROOF_H = 15.6            # the box's height over the quay: the expressway's level
PLAT = 1.1
SLAB = 0.9
PLAT_W = 6.5
GATE_W, GATE_E = -292.0, 82.0   # the tunnels' mouths, x (m east) on the tracks
CAR = 20.4

MATERIALS = {
    "rail_ballast": {"color": "#6a625a", "roughness": 0.95, "metalness": 0.0},
    "rail_bed": {"color": "#6a625a", "roughness": 0.95, "metalness": 0.0, "pattern": "deck_zones", "zones": [[2.7, "rail"]]},
    "rail_steel": {"color": "#8d8478", "roughness": 0.32, "metalness": 0.85},
    "rail_brick": {"color": "#b89a72", "roughness": 0.85, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.4, "block_m": 0.9},
    "rail_concrete": {"lamp_lit": True, "color": "#b3ada0", "roughness": 0.85, "metalness": 0.0},
    "rail_soffit": {"color": "#9a968d", "roughness": 0.9, "metalness": 0.0},
    "rail_shop": {"color": "#2b2f33", "roughness": 0.25, "metalness": 0.3, "pattern": "curtain_wall", "bay_m": 1.5, "storey_m": 3.6,
                  "spandrel": 0.14, "frame": "#3a3d40", "mullion_m": 0.08, "lit_share": 0.9, "lit_k": 1.4, "warm_share": 0.8},
    "rail_shutter": {"lamp_lit": True, "color": "#8d8f8c", "roughness": 0.6, "metalness": 0.4},
    "rail_dark": {"color": "#16181a", "roughness": 0.9, "metalness": 0.0},
    "rail_floor": {"color": "#a9a59c", "roughness": 0.75, "metalness": 0.0, "pattern": "granite", "joints_m": [0.6, 0.6], "street_lit": True},
    "rail_platform": {"color": "#8f8d89", "roughness": 0.85, "metalness": 0.0, "street_lit": True},
    "rail_stairs": {"lamp_lit": True, "color": "#a9a49b", "roughness": 0.8, "metalness": 0.0},
    "rail_yellow": {"lamp_lit": True, "color": "#e8c21c", "roughness": 0.7, "metalness": 0.0, "decal": True},
    "rail_tactile": {"lamp_lit": True, "color": "#2f6aa8", "roughness": 0.7, "metalness": 0.0, "decal": True},
    "rail_white": {"lamp_lit": True, "color": "#ecebe6", "roughness": 0.6, "metalness": 0.0, "decal": True},
    "rail_frame": {"lamp_lit": True, "color": "#3d4246", "roughness": 0.55, "metalness": 0.5},
    "rail_column": {"lamp_lit": True, "color": "#55595c", "roughness": 0.6, "metalness": 0.4},
    "rail_glass_barrier": {"color": "#bcd3d6", "roughness": 0.06, "metalness": 0.3, "opacity": 0.22},
    "rail_edge_barrier": {"color": "#ffffff", "roughness": 1.0, "metalness": 0.0, "opacity": 0.0},
    "rail_wire": {"color": "#3c3a36", "roughness": 0.5, "metalness": 0.7, "shadow": False},
    "rail_lamp": {"color": "#f4f6ee", "roughness": 0.4, "metalness": 0.0, "emissive": "#fff3dc", "glow": 2.6, "glow_day": 0.9},
    "rail_sign": {"color": "#ffffff", "roughness": 0.5, "metalness": 0.0, "map": "rail_signs.png", "emissive_map": True, "glow": 1.2, "glow_day": 0.35},
    "rail_name_box": {"color": "#f06e14", "roughness": 0.5, "metalness": 0.0, "emissive": "#f06e14", "glow": 0.9, "glow_day": 0.25},
    "rail_bench": {"lamp_lit": True, "color": "#8a5a3a", "roughness": 0.7, "metalness": 0.0},
    "rail_bin": {"lamp_lit": True, "color": "#c9ccc8", "roughness": 0.4, "metalness": 0.6},
}

SHEET = (1024, 512)
SIGNS = {"name": (0, 0, 640, 128), "plat1": (0, 136, 640, 100), "plat2": (0, 244, 640, 100), "led1": (0, 352, 500, 150), "led2": (512, 352, 500, 150),
         "bench": (656, 0, 360, 72), "entrance": (656, 84, 360, 120), "way1": (656, 212, 360, 60), "way2": (656, 280, 360, 60)}
_S = {}


def city():
    if "C" not in _S:
        from cityctx import City
        _S["C"] = City("sydney")
    return _S["C"]


def layout():
    if "L" in _S:
        return _S["L"]
    path = os.path.join(HERE, "rail_osm.json")
    if not os.path.exists(path):
        return None
    import archkit as ak
    C, D, T = city(), json.load(open(path, encoding="utf8")), ak.Terrain("sydney")
    loc = lambda ll: [C.fwd.transform(*p) for p in ll]
    solids = ak.load_solids("sydney")
    box = next(q for q in solids if q["osm"] == BOX and q["base"] == 0)
    shops = [q for q in solids if q["osm"] == SHOPS]
    ground = box["ground"]
    roof_z = ground + ROOF_H
    rail_z = round(roof_z - 6.8, 2)
    band = shapely.box(GATE_W, -50, GATE_E, 200)
    tracks = []
    for line, south_side in (("City Inner", True), ("City Outer", False)):
        m = shapely.line_merge(shapely.union_all([LineString(loc(t["ll"])) for t in D["tracks"] if t["line"] == line]))
        g = max(getattr(m, "geoms", [m]), key=lambda q: q.length).intersection(band)
        east = not south_side      # the direction of travel: the northern track east, the southern west
        if (g.coords[0][0] < g.coords[-1][0]) != east:
            g = LineString(g.coords[::-1])
        n = max(2, int(g.length / 4.0) + 1)
        pts = np.array([g.interpolate(k / (n - 1), normalized=True).coords[0] for k in range(n)])
        tracks.append({"id": "inner" if south_side else "outer", "pts": pts, "geom": LineString(pts), "east": east})
    plats = []
    for e in sorted(D["edges"], key=lambda q: q["ref"]):
        g = LineString(loc(e["ll"]))
        if g.coords[0][0] > g.coords[-1][0]:
            g = LineString(g.coords[::-1])        # from west to east
        n = int(g.length / 2.0) + 1
        edge = np.array([g.interpolate(k / (n - 1), normalized=True).coords[0] for k in range(n)])
        out = -1 if e["ref"] == "1" else 1        # platform 1 lies south of its edge, platform 2 north
        back = offset(edge, out * PLAT_W)
        mid = offset(edge, out * PLAT_W / 2)
        poly = Polygon([*edge, *back[::-1]]).buffer(0)
        plats.append({"no": int(e["ref"]), "key": "a" if e["ref"] == "1" else "b", "edge": edge, "back": back, "mid": mid, "poly": poly, "out": out})
    deck = shapely.union_all([t["geom"].buffer(2.6, cap_style="flat") for t in tracks] + [p["poly"].buffer(0.25) for p in plats])
    deck = deck.buffer(2.5, join_style="mitre").buffer(-2.5, join_style="mitre").intersection(band).simplify(0.2)
    deck = max(getattr(deck, "geoms", [deck]), key=lambda g: g.area)
    deck = Polygon(deck.exterior)
    for q in solids:   # a tower's foot by the eastern mouth keeps its corner
        if q["top"] > ROOF_H + 2 and q["base"] == 0 and len(q["ring"]) > 2:
            P = Polygon(q["ring"]).buffer(0)
            if P.intersects(deck):
                deck = deck.difference(P.buffer(0.5))
                deck = max(getattr(deck, "geoms", [deck]), key=lambda g: g.area)
    box_poly = Polygon(box["ring"]).buffer(0)
    conc = shapely.union_all([Polygon(q["ring"]).buffer(0) for q in shops]).buffer(0.4).envelope if shops else Polygon()
    # the streets and footways that pass under the viaduct outside the station
    G = json.load(open(os.path.join(C.out, "game.json")))
    cuts = []
    for kind, arr in G["paths"].items():
        for o in arr:
            p = np.asarray(o["p"], float).reshape(-1, 3) / 10
            if len(p) < 2 or p[:, 2].max() > rail_z - 2:
                continue
            ln = LineString(p[:, :2])
            if ln.intersects(deck):
                part = ln.intersection(deck.buffer(6.0))
                for q in getattr(part, "geoms", [part]):
                    if q.geom_type == "LineString" and q.length < 80:
                        cuts.append(q.buffer(7.5 if kind == "road" else 2.6, cap_style="flat"))
    span = box_poly.buffer(3.0).union(conc)   # under the station the quay's own buildings stand: nothing more is walled
    L = {"C": C, "T": T, "tracks": tracks, "plats": plats, "deck": deck, "box": box_poly, "conc": conc, "ground": ground, "roof_z": roof_z, "rail_z": rail_z,
         "openings": shapely.union_all(cuts + [span]), "gone": [box["si"]] + [q["si"] for q in shops]}
    L["stairs"] = stairs(L)
    _S["L"] = L
    return L


def stairs(L):
    """A flight up to each platform from the concourse: platform 1's climbs to the west, platform 2's to the east."""
    out, T = [], L["T"]
    x0, _, x1, _ = L["conc"].bounds
    zp = L["rail_z"] + PLAT
    for p in L["plats"]:
        g = LineString(p["mid"])
        d = -1 if p["no"] == 1 else 1
        xa = (x1 - 2.2) if d < 0 else (x0 + 2.2)
        a = np.array(g.interpolate(g.project(Point(xa, g.interpolate(0.5, normalized=True).y))).coords[0])
        z0 = T(*a) + 0.02
        run = (zp - z0) / 0.5 + 1.6
        b0 = np.array(g.interpolate(g.project(Point(*a)) + d * run).coords[0])
        t = (b0 - a) / np.linalg.norm(b0 - a)
        out.append({"key": p["key"], "plat": p["key"], "no": p["no"], "a": a, "b": a + t * run, "t": t, "n": np.array([-t[1], t[0]]), "w": 2.6, "z0": z0, "z1": zp, "run": run})
    return out


def stair_slot(st, grow=0.0):
    a, b, n, w = st["a"], st["b"], st["n"], st["w"] / 2 + grow
    return Polygon([a - n * w, b - n * w, b + n * w, a + n * w])


def assets(out_dir):
    """The signs: the station's name in white on orange, the platforms' boards and indicators, the benches' backs."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", SHEET, (20, 22, 24))
    d = ImageDraw.Draw(img)

    def font(size):
        for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/opentype/ipafont-gothic/ipagp.ttf",
                  "/Library/Fonts/Arial Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"):
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
        return ImageFont.load_default()

    def text(xy, s, size, fill, anchor="mm"):
        d.text(xy, s, font=font(size), fill=fill, anchor=anchor)

    ORANGE, INK, WHITE = (240, 110, 20), (26, 28, 32), (248, 248, 244)
    x, y, w, h = SIGNS["name"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=ORANGE)
    text((x + w / 2, y + h / 2), "Circular Quay", 78, WHITE)
    for k, n, via in (("plat1", "1", "City Circle  via Wynyard, Town Hall"), ("plat2", "2", "City Circle  via St James, Museum")):
        x, y, w, h = SIGNS[k]
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=INK)
        d.rectangle([x, y, x + 96, y + h - 1], fill=ORANGE)
        text((x + 48, y + h / 2), n, 74, WHITE)
        text((x + 116, y + 34), "Platform " + n, 30, WHITE, "lm")
        text((x + 116, y + 72), via, 26, (214, 214, 208), "lm")
    for k, rows in (("led1", [("City Circle", "2 min"), ("Wynyard  Town Hall  Central", ""), ("then  Bankstown", "8 cars")]),
                    ("led2", [("City Circle", "3 min"), ("St James  Museum  Central", ""), ("then  Leppington", "8 cars")])):
        x, y, w, h = SIGNS[k]
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=(8, 8, 9))
        d.rectangle([x + 4, y + 4, x + w - 5, y + h - 5], outline=(44, 46, 48), width=3)
        for r, (a, b) in enumerate(rows):
            text((x + 18, y + 34 + r * 42), a, 28 if r == 0 else 24, (255, 170, 40) if r == 0 else (240, 240, 232), "lm")
            text((x + w - 18, y + 34 + r * 42), b, 26, (255, 170, 40), "rm")
    x, y, w, h = SIGNS["bench"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=ORANGE)
    text((x + w / 2, y + h / 2), "Circular Quay", 40, WHITE)
    x, y, w, h = SIGNS["entrance"]
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=INK)
    d.rectangle([x, y + h - 22, x + w - 1, y + h - 1], fill=ORANGE)
    text((x + w / 2, y + 34), "Circular Quay", 40, WHITE)
    text((x + w / 2, y + 76), "Station   Trains", 26, (214, 214, 208))
    for k, s in (("way1", "Platform 1   City Circle"), ("way2", "Platform 2   City Circle")):
        x, y, w, h = SIGNS[k]
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=INK)
        d.rectangle([x, y, x + 10, y + h - 1], fill=ORANGE)
        text((x + 24, y + h / 2), s, 26, WHITE, "lm")
    img.save(os.path.join(out_dir, "rail_signs.png"))
    return ["rail_signs.png"]


def meshes(Mesh):
    L = layout()
    if not L:
        return {}, []
    T, deck, rz, roof_z, g0 = L["T"], L["deck"], L["rail_z"], L["roof_z"], L["ground"]
    K = Kit(Mesh, "rail", MATERIALS, flood=("rail_shop", "rail_lamp", "rail_sign", "rail_name_box"), sky={"rail_soffit": 0.35, "rail_column": 0.6, "rail_frame": 0.6})
    S = lambda key: sign_uv(SIGNS, SHEET, key)
    zt, zs, zp = rz - 0.2, rz - SLAB, rz + PLAT
    slots = shapely.union_all([stair_slot(st, 0.2) for st in L["stairs"]])
    plat_all = shapely.union_all([p["poly"] for p in L["plats"]])
    own = []
    # ---- the deck, the track, its soffit and the band along its edges (down over the tops of the shops under it)
    tri_poly(K["rail_ballast"], deck.difference(plat_all.buffer(-0.05)), zt)
    tri_poly(K["rail_soffit"], deck.difference(slots), zs)
    for t in L["tracks"]:
        track(K, t["pts"], 1.435, rz)
    # ---- the quay's level under it: paving where the box stood, which also keeps the expressway's columns out
    floor = deck.buffer(1.0).union(L["conc"])
    tri_poly(K["rail_floor"], floor, g0 + 0.04, uv=True)
    # ---- under the deck outside the station: a concrete frame, its bays shops or shuttered
    under = deck.difference(L["openings"]).buffer(0)
    edge, bays = deck.exterior, 0
    for g in getattr(under, "geoms", [under]):
        if g.geom_type != "Polygon" or g.area < 8:
            continue
        c = list(g.exterior.coords)
        sgn = 1 if g.exterior.is_ccw else -1
        u = 0.0
        for a, b in zip(c, c[1:]):
            a, b = np.array(a), np.array(b)
            ln = float(np.linalg.norm(b - a))
            if ln < 0.05:
                continue
            t = (b - a) / ln
            out = np.array([t[1], -t[0]]) * sgn
            ga, gb = T(*a), T(*b)
            if edge.distance(Point(*(a + b) / 2)) < 0.4 and ln > 0.6 and zs - max(ga, gb) > 3.6:
                n = max(1, round(ln / 9.0))
                for k in range(n):
                    bays += 1
                    bay(K, a + (b - a) * k / n, a + (b - a) * (k + 1) / n, ga + (gb - ga) * k / n, ga + (gb - ga) * (k + 1) / n, zs, out, "frame", bays)
            else:
                u = wall(K["rail_concrete"], a, b, ga - 0.4, gb - 0.4, zs, u)
    c = np.array(deck.exterior.coords)
    ccw = 1 if deck.exterior.is_ccw else -1
    for a, b in zip(c, c[1:]):
        ln = float(np.linalg.norm(b - a))
        if ln < 0.3:
            continue
        t = (b - a) / ln
        out = np.array([t[1], -t[0]]) * ccw
        m = (a + b) / 2
        gate = abs(m[0] - GATE_W) < 1.0 or abs(m[0] - GATE_E) < 1.0
        if gate:    # a tunnel's mouth: a dark wall across the tracks
            K["rail_dark"].quad([*a, zt], [*b, zt], [*b, roof_z - 1.0], [*a, roof_z - 1.0])
            continue
        K["rail_concrete"].quad([*(a + out * 0.15), zs - 1.3], [*(b + out * 0.15), zs - 1.3], [*(b + out * 0.15), zt + 0.1], [*(a + out * 0.15), zt + 0.1])
        K["rail_concrete"].quad([*(a + out * 0.15), roof_z - 1.2], [*(b + out * 0.15), roof_z - 1.2], [*(b + out * 0.15), roof_z + 0.05], [*(a + out * 0.15), roof_z + 0.05])   # the roof's fascia
        if abs(t[0]) < 0.6:
            continue
        on_plat = plat_all.distance(Point(*m)) < 0.8
        base = zp if on_plat else zt
        pa, pb = a - out * 0.2, b - out * 0.2
        # the open side: a glass balustrade under a steel rail at the platforms, a low wall beside the track elsewhere
        if on_plat:
            K["rail_glass_barrier"].box([*pa, base + 0.62], [*pb, base + 0.62], 0.03, 1.1)
            K["rail_frame"].box([*pa, base + 1.2], [*pb, base + 1.2], 0.07, 0.06)
            K["rail_frame"].box([*pa, base + 0.05], [*pb, base + 0.05], 0.08, 0.1)
            for k in range(int(ln / 1.7) + 1):
                q = pa + t * min(ln, k * 1.7)
                K["rail_frame"].box([*q, base], [*q, base + 1.2], 0.05, 0.05)
        else:
            K["rail_concrete"].box([*pa, base + 0.55], [*pb, base + 0.55], 0.25, 1.1)
    # ---- the columns that carry the roof along both sides, every 8.5 m, and the beams across between them
    ref = LineString(sorted([tuple(q) for q in L["tracks"][1]["pts"]]))
    for s in np.arange(6.0, ref.length - 4.0, 8.5):
        p = np.array(ref.interpolate(s).coords[0])
        q = np.array(ref.interpolate(s + 1.0).coords[0])
        t = (q - p) / np.linalg.norm(q - p)
        n = np.array([-t[1], t[0]])
        cut = LineString([p - n * 30, p + n * 30]).intersection(deck)
        if cut.is_empty or cut.geom_type != "LineString" or cut.length < 8:
            continue
        ends = sorted([np.array(cut.coords[0]), np.array(cut.coords[-1])], key=lambda e: e[1])
        d = (ends[1] - ends[0]) / np.linalg.norm(ends[1] - ends[0])
        a, b = ends[0] + d * 0.55, ends[1] - d * 0.55
        for e in (a, b):
            base = zp if plat_all.distance(Point(*e)) < 0.6 else zt
            K["rail_column"].box([*e, base], [*e, roof_z - 1.1], 0.5, 0.5)
        K["rail_column"].box([*a, roof_z - 1.45], [*b, roof_z - 1.45], 0.45, 0.7)
    tri_poly(K["rail_soffit"], deck.buffer(0.3), roof_z - 1.1)
    # ---- the roof: the box's own top, at the expressway's level, walked on as before
    roof = Mesh("rail_roof_deck", "rail_concrete", False)
    tri_poly(roof, L["box"].union(deck.buffer(0.3)), roof_z)
    own.append(roof)
    bc = list(L["box"].exterior.coords)
    for a, b in zip(bc, bc[1:]):
        if not deck.buffer(0.6).contains(Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)):
            K["rail_concrete"].quad([*a, roof_z - 1.2], [*b, roof_z - 1.2], [*b, roof_z], [*a, roof_z])
    # ---- the contact wire over each track, hung from the beams
    for t in L["tracks"]:
        K["rail_wire"].sweep([[*q, rz + 4.95] for q in t["pts"][::3]], [(-0.015, -0.015), (0.015, -0.015), (0, 0.015)])
    # ---- the platforms
    for p in L["plats"]:
        st_here = [st for st in L["stairs"] if st["plat"] == p["key"]]
        holes = shapely.union_all([stair_slot(st) for st in st_here])
        top = Mesh(f"rail_platform_{p['key']}", "rail_platform", False)
        tri_poly(top, p["poly"].difference(holes), zp)
        own.append(top)
        pc = list(p["poly"].exterior.coords)
        u = 0.0
        for a, b in zip(pc, pc[1:]):
            u = wall(K["rail_concrete"], a, b, zt, zt, zp, u)
        o = p["out"]
        ribbon(K["rail_tactile"], offset(p["edge"], o * 0.85)[1:-1], zp + 0.012, 0.3, uv=False)   # blue tactile tiles, a yellow line beside them
        ribbon(K["rail_yellow"], offset(p["edge"], o * 1.22)[1:-1], zp + 0.012, 0.05, uv=False)
        ribbon(K["rail_white"], offset(p["edge"], o * 0.1)[1:-1], zp + 0.012, 0.07, uv=False)
        # nothing stands between the platform and the track, so a clear wall keeps walkers on the platform
        eb = offset(p["edge"], o * 0.2)
        for qa, qb in zip(eb, eb[1:]):
            K["rail_edge_barrier"].box([*qa, zp + 0.65], [*qb, zp + 0.65], 0.14, 1.3)
        mid = LineString(p["mid"])
        along = lambda s: (np.array(mid.interpolate(s).coords[0]), (np.array(mid.interpolate(min(mid.length, s + 1)).coords[0]) - np.array(mid.interpolate(max(0, min(mid.length, s + 1) - 1)).coords[0])))
        # two rows of lights under the roof, the length of the platform
        for off in (-1.6, 1.6):
            row = offset(p["mid"], off)
            for k in range(1, len(row) - 3, 3):
                a, b = row[k], row[k + 2]
                K["rail_lamp"].box([*(a + (b - a) * 0.06), roof_z - 1.16], [*(b - (b - a) * 0.06), roof_z - 1.16], 0.16, 0.05)
        # the platform's board and its indicator by turns, hung over the middle, read from both ways along it
        for k, s in enumerate(np.arange(14.0, mid.length - 10.0, 26.0)):
            c0, t = along(s)
            t = t / np.linalg.norm(t)
            if holes.buffer(1.5).contains(Point(*c0)):
                continue
            key, w, h = ((f"plat{p['no']}", 3.2, 0.5), (f"led{p['no']}", 2.0, 0.6))[k % 2]
            za = zp + 2.5
            a, b = c0 - np.array([-t[1], t[0]]) * w / 2, c0 + np.array([-t[1], t[0]]) * w / 2
            K["rail_dark"].box([*a, za + h / 2], [*b, za + h / 2], 0.1, h + 0.06)
            for face in (1, -1):
                sign(K["rail_sign"], S(key), c0, t * face, w, za, h, 0.056)
            for e in (a, b):
                K["rail_frame"].box([*e, za + h], [*e, roof_z - 1.1], 0.04, 0.04)
        # the station's name: an orange box lit from inside, white letters on both faces, hung from the roof by the
        # platform's edge and facing across the tracks, between the boards so that neither hides the other
        for s in np.arange(27.0, mid.length - 20.0, 52.0):
            c0, t = along(s)
            t = t / np.linalg.norm(t)
            n = np.array([-t[1], t[0]]) * o
            c0 = c0 - n * (PLAT_W / 2 - 1.3)
            if holes.buffer(1.0).contains(Point(*c0)):
                continue
            K["rail_name_box"].box([*(c0 - t * 1.8), zp + 2.86], [*(c0 + t * 1.8), zp + 2.86], 0.16, 0.72)
            for face in (1, -1):
                sign(K["rail_sign"], S("name"), c0, n * face, 3.6, zp + 2.5, 0.72, 0.085)
            for e in (-1.5, 1.5):
                K["rail_frame"].box([*(c0 + t * e), zp + 3.22], [*(c0 + t * e), roof_z - 1.1], 0.05, 0.05)
        # benches along the back, facing the track, the station's name on their backs; a bin by every third
        for k, s in enumerate(np.arange(9.0, mid.length - 8.0, 12.5)):
            c0, t = along(s)
            t = t / np.linalg.norm(t)
            n = np.array([-t[1], t[0]]) * o     # away from the track
            c0 = c0 + n * (PLAT_W / 2 - 1.15)
            if holes.buffer(0.8).contains(Point(*c0)):
                continue
            K["rail_bench"].box([*(c0 - t * 1.0), zp + 0.44], [*(c0 + t * 1.0), zp + 0.44], 0.46, 0.06)
            K["rail_bench"].box([*(c0 - t * 1.0 + n * 0.24), zp + 0.74], [*(c0 + t * 1.0 + n * 0.24), zp + 0.74], 0.05, 0.4)
            sign(K["rail_sign"], S("bench"), c0 + n * 0.21, -n, 1.9, zp + 0.56, 0.36, 0.0)
            for e in (-0.85, 0.85):
                K["rail_frame"].box([*(c0 + t * e - n * 0.2), zp + 0.21], [*(c0 + t * e + n * 0.24), zp + 0.21], 0.05, 0.42)
            if k % 3 == 1:
                q = c0 + t * 2.4
                K["rail_bin"].box([*q, zp], [*q, zp + 1.05], 0.55, 0.45)
                K["rail_yellow"].box([*q, zp + 1.05], [*q, zp + 1.13], 0.57, 0.47)
        # ---- the stairs down to the concourse, between two walls, a balustrade round the well
        for st in st_here:
            a, t, n, hw, run = st["a"], st["t"], st["n"], st["w"] / 2, st["run"]
            sm = Mesh(f"rail_stair_{st['key']}", "rail_stairs", False)
            half, rise = (run - 1.6) / 2, (st["z1"] - st["z0"]) / 2
            zat = lambda u: st["z0"] + (min(u, half) / half) * rise + (max(0.0, min(u - half - 1.6, half)) / half) * rise
            steps = int(round(rise / 0.16))
            for u0 in (0.0, half + 1.6):
                for k in range(steps):
                    ua, ub = u0 + half * k / steps, u0 + half * (k + 1) / steps
                    z = zat(u0) + rise * (k + 1) / steps
                    p0, p1 = a + t * ua, a + t * ub
                    sm.quad([*(p0 - n * hw), z], [*(p1 - n * hw), z], [*(p1 + n * hw), z], [*(p0 + n * hw), z])
                    sm.quad([*(p0 - n * hw), z - rise / steps], [*(p0 + n * hw), z - rise / steps], [*(p0 + n * hw), z], [*(p0 - n * hw), z])
            p0, p1 = a + t * half, a + t * (half + 1.6)
            sm.quad([*(p0 - n * hw), st["z0"] + rise], [*(p1 - n * hw), st["z0"] + rise], [*(p1 + n * hw), st["z0"] + rise], [*(p0 + n * hw), st["z0"] + rise])
            own.append(sm)
            for sgn in (-1, 1):
                e0, e1 = a + n * sgn * (hw + 0.1), a + t * run + n * sgn * (hw + 0.1)
                # the flight's side: a wall under it (the stair's own depth), a glass balustrade up it and round the well
                pts = [(u, zat(u)) for u in np.linspace(0, run, 14)]
                for (ua, za), (ub, zb) in zip(pts, pts[1:]):
                    K["rail_concrete"].quad([*(a + t * ua + n * sgn * (hw + 0.1)), za - 0.5], [*(a + t * ub + n * sgn * (hw + 0.1)), zb - 0.5],
                                            [*(a + t * ub + n * sgn * (hw + 0.1)), zb + 0.1], [*(a + t * ua + n * sgn * (hw + 0.1)), za + 0.1])
                K["rail_frame"].tube([[*(a + t * u + n * sgn * (hw - 0.05)), zat(u) + 0.95] for u in np.linspace(0, run, 12)], 0.025, 5)
                K["rail_glass_barrier"].box([*e0, zp + 0.55], [*e1, zp + 0.55], 0.03, 1.1)
                K["rail_frame"].box([*e0, zp + 1.12], [*e1, zp + 1.12], 0.06, 0.05)
            e0, e1 = a - n * (hw + 0.1), a + n * (hw + 0.1)
            K["rail_glass_barrier"].box([*e0, zp + 0.55], [*e1, zp + 0.55], 0.03, 1.1)
            K["rail_frame"].box([*e0, zp + 1.12], [*e1, zp + 1.12], 0.06, 0.05)
            sign(K["rail_sign"], S(f"way{st['no']}"), a - t * 0.3, -t, 2.6, st["z0"] + 2.5, 0.43, 0.0)
    # ---- the concourse: columns under the deck, lights on its soffit, the station's name over each way in
    x0, y0, x1, y1 = L["conc"].bounds
    for x in np.arange(x0 + 4.0, x1 - 3.0, 9.0):
        for y in (y0 + 4.0, (y0 + y1) / 2, y1 - 4.0):
            q = Point(x, y)
            if deck.contains(q) and slots.distance(q) > 1.2:
                K["rail_column"].box([x, y, g0], [x, y, zs], 0.7, 0.7)
        for y in np.arange(y0 + 3.0, y1 - 2.0, 5.0):
            if deck.contains(Point(x + 4.5, y)):
                K["rail_lamp"].box([x + 3.6, y, zs - 0.06], [x + 5.4, y, zs - 0.06], 0.22, 0.05)
    cx = (x0 + x1) / 2
    for yy, face in ((y0 - 0.3, -1), (y1 + 0.3, 1)):
        ed = LineString([(cx, yy - 30), (cx, yy + 30)]).intersection(deck)
        if ed.is_empty:
            continue
        ye = min(q[1] for q in ed.coords) if face < 0 else max(q[1] for q in ed.coords)
        K["rail_dark"].box([cx - 6.2, ye + face * 0.2, g0 + 4.6], [cx + 6.2, ye + face * 0.2, g0 + 4.6], 0.3, 1.5)
        sign(K["rail_sign"], S("entrance"), [cx, ye + face * 0.2], [0, face], 4.2, g0 + 3.9, 1.4, 0.17)
    return MATERIALS, [m for m in K.values() if m.v] + own


def surfaces():
    L = layout()
    if not L:
        return []
    out, zp = [], L["rail_z"] + PLAT
    for p in L["plats"]:
        mid, step = p["mid"], 10
        for k in range(0, len(mid) - 1, step):
            a, b = mid[k], mid[min(k + step, len(mid) - 1)]
            ln = float(np.linalg.norm(b - a))
            ax, c = (b - a) / ln, (a + b) / 2
            out.append({"name": f"Circular Quay Station, platform {p['no']}", "type": "strip", "origin": [round(float(c[0]), 2), round(float(c[1]), 2)],
                        "axis": [round(float(ax[0]), 5), round(float(ax[1]), 5)], "half_width": round(PLAT_W / 2 - 0.05, 2),
                        "profile": [[round(-ln / 2 - 0.5, 2), zp], [round(ln / 2 + 0.5, 2), zp]], "thickness": PLAT + SLAB,
                        "mesh": f"rail_platform_{p['key']}", "mapped": False, "label": "Circular Quay Station"})
    for st in L["stairs"]:
        half, zl, c, run = (st["run"] - 1.6) / 2, (st["z0"] + st["z1"]) / 2, st["b"], st["run"]
        out.append({"name": f"Circular Quay Station, the stairs to platform {st['no']}", "type": "strip", "origin": [round(float(c[0]), 2), round(float(c[1]), 2)],
                    "axis": [round(float(-st["t"][0]), 5), round(float(-st["t"][1]), 5)], "half_width": st["w"] / 2,
                    "profile": [[-0.5, zp], [0.0, zp], [round(half, 2), round(zl, 2)], [round(half + 1.6, 2), round(zl, 2)], [round(run, 2), round(st["z0"], 2)], [round(run + 0.6, 2), round(st["z0"], 2)]],
                    "thickness": 1.0, "mesh": f"rail_stair_{st['key']}", "mapped": False, "check": True, "label": "the stairs to the platforms"})
    # the roof, where the lookout over the quay stands: the box's own rectangle, a step in from its edge
    r = np.array(L["box"].minimum_rotated_rectangle.exterior.coords[:4])
    e0, e1 = r[1] - r[0], r[2] - r[1]
    if np.linalg.norm(e0) < np.linalg.norm(e1):
        r, e0, e1 = np.roll(r, -1, axis=0), e1, -e0
    ln, wd, c = float(np.linalg.norm(e0)), float(np.linalg.norm(e1)), r.mean(axis=0)
    out.append({"name": "Circular Quay Station, the roof", "type": "strip", "origin": [round(float(c[0]), 2), round(float(c[1]), 2)],
                "axis": [round(float(e0[0] / ln), 5), round(float(e0[1] / ln), 5)], "half_width": round(wd / 2 - 0.4, 2),
                "profile": [[round(-ln / 2 + 0.4, 2), L["roof_z"]], [round(ln / 2 - 0.4, 2), L["roof_z"]]], "thickness": 1.2,
                "mesh": "rail_roof_deck", "mapped": False, "label": "Circular Quay"})
    return out


def trains():
    L = layout()
    if not L:
        return None
    rz = L["rail_z"]
    tracks = []
    for t, p in zip(L["tracks"], L["plats"]):
        g = LineString(t["pts"])
        mid = LineString(p["mid"]).interpolate(0.5, normalized=True)
        tracks.append({"id": t["id"], "line": "city-circle", "gauge": 1.435, "p": [v for q in t["pts"] for v in (round(q[0] * 10), round(q[1] * 10), round(rz * 10))],
                       "stop_m": round(g.project(mid), 1), "platform": p["no"], "hide_m": [3.0, round(g.length - 3.0, 1)]})
    c = L["box"].centroid
    return {
        "note": "The City Circle through Circular Quay (cities/sydney/rail.py): courses in decimetres at rail level, in the direction of travel.",
        "station": {"name": "Circular Quay", "style": "sydney", "at": [round(c.x, 1), round(c.y, 1), rz + PLAT], "hear_m": 130},
        "tracks": tracks,
        # one each way every five minutes, as the City Circle runs off peak, and never both at once: between
        # trains the harbour is in view across the tracks for most of a minute
        "services": [
            {"track": "inner", "stock": "waratah", "cars": 8, "every_s": 300, "offset_s": 20, "stops": True, "v_ms": 13,
             "for": {"en": "Central, via Wynyard and Town Hall"}, "first": "Wynyard", "line": {"en": "City Circle"}},
            {"track": "outer", "stock": "waratah", "cars": 8, "every_s": 300, "offset_s": 170, "stops": True, "v_ms": 13,
             "for": {"en": "Central, via St James and Museum"}, "first": "St James", "line": {"en": "City Circle"}},
        ],
    }


def travel():
    """Platform 1, across the tracks from the harbour: the view the station is known for."""
    L = layout()
    if not L:
        return []
    p = L["plats"][0]
    mid = LineString(offset(p["edge"], p["out"] * 1.5))   # by the yellow line, the platform's width behind you
    a = np.array(mid.interpolate(mid.length * 0.3).coords[0])
    return [{"id": "circular-quay-platform", "name": "Circular Quay Station, platform 1", "at": [round(float(a[0]), 1), round(float(a[1]), 1), L["rail_z"] + PLAT],
             "look": [round(float(a[0]) - 30, 1), round(float(a[1]) + 400, 1)], "pitch": 0.02,
             "note": "Across the tracks, platform 2 is open to Sydney Cove: the Harbour Bridge to the left, the ferries at the wharves below, the Opera House to the right."}]


def demolished():
    L = layout()
    return L["gone"] if L else []


def glows():
    L = layout()
    if not L:
        return []
    out = []
    for p in L["plats"]:
        for q in p["mid"][3::6]:
            out.append([round(float(q[0]), 1), round(float(q[1]), 1), 8.0, "#fff1da", 0.22])
    return out
