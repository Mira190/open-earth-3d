"""Melbourne: what the generic pipeline cannot know from open data.

Building adjustments (called by pipeline/build_scene.py):
  * Arts Centre Melbourne spire: OpenStreetMap maps it twice, as a 7 m square block
    from 15 m to 162 m (w271670390) and as a solid 452 m2 block from 15 m to 50 m with
    a 162 m mast (the built data's merge of the Theatres Building, w22664482, with the
    spire's skirt, w272730480). Both become one parametric lattice spire on the first
    one's anchor, and the Theatres Building is drawn on its own outline (below).

Parametric landmarks (called by pipeline/landmarks.py):
  Arts Centre spire   162 m tall (Wikipedia, Arts Centre Melbourne; completed 1996,
                      replacing the 115 m original). Twelve ribs flare from a wide base
                      on the Theatres Building roof into a mast, with rings every 8 m.
                      The shape is an approximation: no published drawing was used.

  Theatres Building   Arts Centre Melbourne's theatres under the spire (Roy Grounds; opened 1984) lie mostly
                      below St Kilda Road. Above ground they show as a low bluestone-clad body on
                      OpenStreetMap's outline (way 22664482, 15 m over the Southbank promenade), its roof
                      at the spire's foot, 6 m over the forecourt on St Kilda Road (whose ground the DEM
                      lost: city.json terrain.level), with the foyer's glass to the forecourt, a pale
                      coping and the drum the spire's ribs stand on.

  Flinders Street Station  OpenStreetMap maps the station's 310 m outline at 20 m (4 floors)
                      with parts: a dome from 20 to 30 m, the Elizabeth Street clock tower
                      at 35 m, two 24 m blocks. By the OSM convention the parts replace the
                      outline, which left the station's long body out of the model, and its
                      dome standing on nothing. The body comes back as the outline less the
                      parts that stand on the ground, at the outline's 20 m. On it: the dome
                      as a dome (copper, on the mapped part), clock faces near the top of the
                      tower, the clocks over the main entrance, and the 1910 colour scheme
                      that the 2018-2020 repaint restored: cream, terracotta and dark green
                      (Dulux, Munsell 10YR 7/4, 10R 3/8 and 10GY 2/2; the hex values here are
                      approximate conversions). The terracotta bands' heights are chosen.

                      The body, the 24 m blocks and the clock tower are drawn on their mapped parts
                      (the solids are "hidden"): cream walls in courses with a window in every bay,
                      arched above the ground floor, the grand arch of the entrance under the clocks,
                      the drum's windows, and the clock tower's belfry and copper cupola.

  Crown Melbourne     the casino's podium (OSM w13306836) in sandstone with bronze bands, glass along
                      the river front's two lower floors, the atrium's glass vault over the main
                      entrance, and the eight Gas Brigades towers along Southbank's promenade, black
                      granite with the fire bowls that send up fireballs each night. Their 14 m height
                      and spacing are taken from photographs.

  Southbank towers    Eureka Tower and Australia 108 on their mapped parts (cities/melbourne/southbank.py).

Labels: no footprint in Overture carries Flinders Street Station's name, so its label
stands over the dome, the station's front (its published coordinates are out over the platforms).
"""
import math

import numpy as np
import shapely
from shapely.geometry import Point

import archkit as ak
from meshkit import Mesh


def _load(name):
    import importlib.util
    import os
    spec = importlib.util.spec_from_file_location(f"melbourne_{name}", os.path.join(os.path.dirname(os.path.abspath(__file__)), f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


SOUTHBANK = _load("southbank")

SPIRE_OSM = ("w271670390", "w22664482")  # the anchor comes from the first
STATION_OSM = "w271939456"  # its parts: the dome w271939464, the clock tower w306665754
STATION_ENTRANCE = (144.96718, -37.81776)  # "under the clocks", Flinders and Swanston (OSM)
CREAM, TERRACOTTA, DARK_GREEN = "#c4a77d", "#8a2f22", "#2e3a2b"
SPIRE_TOP_M = 162.0
# the Theatres Building's outline (OpenStreetMap way 22664482, mapped from aerial imagery), longitude and latitude
THEATRES_OUTLINE = [[144.968591, -37.8218057], [144.9685573, -37.8218489], [144.9685262, -37.8218741], [144.9684864, -37.821896], [144.9684327, -37.8219166], [144.9683793, -37.8219264], [144.9683255, -37.8219284], [144.9682742, -37.8219241], [144.9682307, -37.821911], [144.9681966, -37.8218914], [144.9681597, -37.8218638], [144.9681278, -37.8218256], [144.9681087, -37.8217894], [144.968098, -37.8217558], [144.9681049, -37.8217099], [144.9681174, -37.8216694], [144.9681321, -37.8216259], [144.9682702, -37.821146], [144.9682998, -37.821091], [144.96834, -37.8210518], [144.9683909, -37.8210263], [144.9684473, -37.8210062], [144.9685036, -37.8210009], [144.9685269, -37.8210028], [144.9685559, -37.8210051], [144.9685798, -37.8210107], [144.9686243, -37.821021], [144.9686739, -37.8210528], [144.9687168, -37.8210899], [144.9687463, -37.8211376], [144.9687571, -37.8211863], [144.9687504, -37.821234], [144.9687124, -37.8214178], [144.9686766, -37.8215336], [144.9686639, -37.8215749], [144.9686187, -37.8217329], [144.9686108, -37.8217607]]
# the row of clocks over the main entrance hangs over the top of its steps, which climb about 1 m from the
# corner's pavement; the clocks' lower edge is about 3 m over the top step (photographs: no published
# measurement of the steps or the clocks' height was found, in Wikipedia, eMelbourne or the Victorian
# Heritage Database's entry, H1083)
ENTRANCE_STEPS_M, CLOCKS_OVER_STEPS_M, ENTRANCE_CLOCK_R = 1.0, 3.0, 0.5
FLINDERS_STREET = (144.9671, -37.8183)
MATERIALS = {
    "spire": {"color": "#eef0f2", "roughness": 0.35, "metalness": 0.5},
    # the Theatres Building: bluestone (Victorian basalt) in courses, a pale concrete coping, the foyer's glass
    "acm_bluestone": {"color": "#55585c", "roughness": 0.85, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.6, "block_m": 1.2},
    "acm_coping": {"color": "#cfcac0", "roughness": 0.7, "metalness": 0.0, "emissive": "#ffe2bd", "glow": 0.3},
    "acm_glass": {"color": "#2b3238", "roughness": 0.15, "metalness": 0.5, "emissive": "#ffd9a6", "glow": 0.5},
    "fss_terracotta": {"color": TERRACOTTA, "roughness": 0.85, "metalness": 0.0},
    "fss_green": {"color": DARK_GREEN, "roughness": 0.6, "metalness": 0.1},
    "fss_cream": {"color": CREAM, "roughness": 0.8, "metalness": 0.0},
    "fss_copper": {"color": "#5d7f6d", "roughness": 0.45, "metalness": 0.5, "emissive": "#7fbf9f", "glow": 0.3},
    # the faces are lit from behind after dark, the row over the entrance and the tower's alike (photographs)
    "fss_clock": {"color": "#f4f1e6", "roughness": 0.4, "metalness": 0.0, "emissive": "#fff2d8", "glow": 0.8},
    "fss_hands": {"color": "#1d1d1f", "roughness": 0.5, "metalness": 0.2},
    # the station's walls (floodlit after dark, as its festoon of lights picks it out), windows lit from inside
    "fss_wall": {"color": CREAM, "roughness": 0.8, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.9, "block_m": 2.0,
                 "emissive": "#ffd59a", "glow": 0.5},
    "fss_trim": {"color": "#d9c49c", "roughness": 0.75, "metalness": 0.0, "emissive": "#ffd59a", "glow": 0.5},
    "fss_win": {"color": "#26292d", "roughness": 0.3, "metalness": 0.3, "emissive": "#ffcf8a", "glow": 0.45},
    # Crown: sandstone and bronze glass, the Gas Brigades' black granite and their fire bowls
    "crown_wall": {"color": "#c9b394", "roughness": 0.8, "metalness": 0.0, "emissive": "#ffe2bd", "glow": 0.3},
    "crown_glass": {"color": "#4a4136", "roughness": 0.1, "metalness": 0.6, "pattern": "curtain_wall", "bay_m": 3.0, "storey_m": 4.5,
                    "spandrel": 0.15, "mullion_m": 0.08, "frame": "#6b5a40", "lit_share": 0.8, "lit_k": 0.6, "emissive": "#ffd9a6", "glow": 0.4},
    "crown_bronze": {"color": "#6b5a40", "roughness": 0.4, "metalness": 0.7},
    "crown_granite": {"color": "#26282b", "roughness": 0.35, "metalness": 0.2},
    "crown_fire": {"color": "#3a2a20", "roughness": 0.6, "metalness": 0.3, "emissive": "#ff8a2a", "glow": 1.2},
}


def adjust_building(b, cls, g, geoms, ctx):
    rid = (b.get("record_id") or "").split("@")[0]
    if rid == STATION_OSM:
        return station(b, g, geoms, ctx)
    if rid in SPIRE_OSM[1:]:
        return []
    if rid == SPIRE_OSM[0]:
        c = g.centroid
        base = min((s[1] for s in geoms), default=15.0)
        ground = ctx.ground(c.x, c.y)
        ctx.landmarks["arts_centre_spire"] = {"at": [round(c.x, 1), round(c.y, 1)], "ground_m": round(ground, 1),
                                              "base_m": round(ground + base, 1), "top_m": round(ground + SPIRE_TOP_M, 1)}
        return []
    return geoms


def station(b, g, geoms, ctx):
    """The body back under the parts, and anchors for the dome, the tower and the facade."""
    b["facade_color"] = CREAM
    ground_parts = [q for q in geoms if q[1] <= 0.5]
    body = g.difference(shapely.union_all([q[0] for q in ground_parts])) if ground_parts else g
    top = float(b.get("height") or 20.0)
    out = list(geoms) + [[p, 0.0, top, "mapped", None] for p in ctx.polygons(body) if p.area > 10]
    c = g.centroid
    lm = {"outline": [[round(x, 1), round(y, 1)] for x, y in g.exterior.coords], "ground_m": round(ctx.ground(c.x, c.y), 1), "top_m": top}
    # the dome is the part that starts above the ground; the clock tower the tallest that rises above the body
    for q in [q for q in geoms if q[1] > 5.0][:1]:  # drawn as a dome; still in the surface model
        ctx.hide(q)
        d = q[0].centroid
        lm["dome"] = {"at": [round(d.x, 1), round(d.y, 1)], "r": round(math.sqrt(q[0].area / math.pi), 2), "base_m": q[1], "top_m": q[2]}
    for q in sorted((q for q in ground_parts if q[2] > top + 5.0), key=lambda q: -q[2])[:1]:
        cs = np.asarray(q[0].minimum_rotated_rectangle.exterior.coords)[:4]
        lm["tower"] = {"corners": [[round(x, 1), round(y, 1)] for x, y in cs], "top_m": q[2]}
    e = ctx.city.to_local(Point(*STATION_ENTRANCE))
    lm["entrance"] = [round(e.x, 1), round(e.y, 1)]
    ctx.landmarks["flinders_street"] = lm
    return out


def finalize(ctx):
    # over the dome and the entrance under the clocks, the station's front: its published coordinate is out
    # over the platforms, 50 m behind it, where map travel framed the platform walls
    fs = ctx.landmarks.get("flinders_street", {})
    if "dome" in fs:
        d = fs["dome"]
        ctx.labels["Flinders Street Station"] = [d["at"][0], d["at"][1], round(fs["ground_m"] + d["top_m"] + 6.0, 1)]
    else:
        p = ctx.city.to_local(Point(*FLINDERS_STREET))
        ctx.labels["Flinders Street Station"] = [round(p.x, 1), round(p.y, 1), round(ctx.ground(p.x, p.y) + 32.0, 1)]
    s = ctx.landmarks.get("arts_centre_spire")
    if s:
        ctx.labels["Arts Centre spire"] = [s["at"][0], s["at"][1], s["top_m"] + 6.0]


def landmark_meshes(scene):
    lm = scene["landmarks"]
    meshes = []
    if "arts_centre_spire" in lm:
        meshes.append(spire(lm["arts_centre_spire"]))
        meshes += theatres_building(lm["arts_centre_spire"])
    hidden = []
    if "flinders_street" in lm:
        meshes += flinders_street(lm["flinders_street"])
        more, hide = station_body(lm["flinders_street"])
        meshes += more
        hidden += hide
    more, hide = crown()
    meshes += more
    hidden += hide
    more, hide = SOUTHBANK.meshes("melbourne")  # Eureka Tower and Australia 108 (cities/melbourne/southbank.py)
    meshes += more
    hidden += hide
    mats = {k: dict(v) for k, v in {**MATERIALS, **SOUTHBANK.MATERIALS}.items()}
    if "flinders_street" in lm:
        g0 = lm["flinders_street"]["ground_m"]
        for k in ("fss_wall", "fss_trim"):
            mats[k]["flood"] = [round(g0, 1), round(g0 + 40.0, 1), 0.5, 0.7]
    return mats, meshes, {"hidden": hidden}


def station_body(s):
    """Flinders Street Station's body on its mapped parts: cream walls in courses, a window in every bay
    (arched on the upper floors), the grand arched entrance under the dome, the drum's windows, and the clock
    tower's belfry and copper cupola on Elizabeth Street."""
    solids = [q for q in ak.load_solids("melbourne") if q["osm"] == STATION_OSM]
    K = ak.Kit("fss_body", floodlit={"fss_wall", "fss_trim", "fss_win", "fss_copper"}, uv={"fss_wall"})
    mats = ("fss_wall", "fss_trim", "fss_win")
    dome = s.get("dome")
    hide = []
    for q in solids:
        if dome and q["base"] > 5.0:
            continue  # the dome's part, drawn as the dome
        hide.append(q["si"])
        if abs(ak.ring_area(q["ring"])) < 20:
            continue
        z0, z1 = q["ground"], q["ground"] + q["top"]
        if q["top"] > 30:  # the clock tower: plain to the belfry, then the belfry's arches, a cornice and the cupola
            ak.stone_body(K, q["ring"], z0, z1 - 6.0, mats, storey=7.0, win=(1.2, 3.2), arch=True, every=3.0, sill=2.0)
            ring = ak.simplify(q["ring"])
            ak.prism(K["fss_wall"], ak.WORLD, ring, z1 - 6.0, z1)
            ak.ring_openings(K["fss_win"], ak.WORLD, ring, z1 - 5.0, 1.6, 3.6, 3.0, arch=True)
            ak.cornice(K["fss_trim"], ak.WORLD, ring, z1 - 0.8, ((0, 0), (0.4, 0.3), (0.7, 0.8), (0, 0.8)))
            cx, cy = ak.ring_centroid(q["ring"])
            r = math.sqrt(abs(ak.ring_area(q["ring"]))) * 0.42
            ak.dome(K["fss_copper"], (cx, cy), z1, r, r * 1.3, segs=16, rows=6)
            K["fss_copper"].box((cx, cy, z1 + r * 1.2), (cx, cy, z1 + r * 1.3 + 3.5), 0.15, 0.15)
            continue
        ak.stone_body(K, q["ring"], z0, z1, mats, storey=6.2, win=(1.7, 3.4), arch=True, every=4.4, sill=1.6)
    if dome:
        # the drum's arched windows under the copper dome, and the grand arch of the entrance under the clocks
        dx, dy = dome["at"]
        g0 = s["ground_m"]
        ak.ring_openings_round(K["fss_win"], (dx, dy), g0 + dome["base_m"] - 6.0, dome["r"] * 1.04 + 0.05, 12, 1.8, 4.2, arch=True)
        e = np.array(s["entrance"])
        n = (e - np.array([dx, dy])) / np.linalg.norm(e - np.array([dx, dy]))
        t = np.array([n[1], -n[0]])
        a, b = e + n * 0.4 - t * 8, e + n * 0.4 + t * 8
        ak.opening(K["fss_win"], ak.WORLD, b, a, g0 + 0.2, 7.0, 10.5, arch=True, centre=8.0)
        ak.frame_quad(K["fss_trim"], ak.WORLD, b, a, 8.0, g0 + 0.2, 7.0, 10.5, t=0.8, depth=0.2)
    return K.out(), hide


CROWN = "w13306836"
GAS_BRIGADE_M = 2.4  # their granite shafts, square
GAS_BRIGADES = 8  # the towers along the promenade that send up fireballs each night (Crown Melbourne)


def crown_front(q):
    """The casino podium's simplified ring, its ground and top, and its river front: the long edges
    [(p0, p1, outward normal, length)] facing the Yarra (north-west)."""
    ring = ak.simplify(q["ring"], 0.8)
    g, top = q["ground"], q["ground"] + q["top"]
    cx, cy, ax, L, W = ak.oriented(ring)
    a = math.radians(ax)
    north = np.array([-math.sin(a), math.cos(a)])
    if north[1] < 0:
        north = -north  # the river side: the long side facing the Yarra (north-west)
    pts = list(ring)
    if ak.ring_area(pts) < 0:
        pts = pts[::-1]
    river = []
    for k in range(len(pts)):
        p0, p1 = np.array(pts[k]), np.array(pts[(k + 1) % len(pts)])
        e = p1 - p0
        Ln = float(np.linalg.norm(e))
        if Ln < 12:
            continue
        nrm = np.array([e[1], -e[0]]) / Ln  # outward for an anticlockwise ring
        if float(nrm @ north) > 0.7:
            river.append((p0, p1, nrm, Ln))
    return ring, g, top, river


def gas_brigades(river):
    """The Gas Brigades along the whole river front, 9 m out on the promenade: [(centre, outward normal)]."""
    segs = [(r[0], r[1], r[2]) for r in river]
    total = sum(float(np.linalg.norm(b - a_)) for a_, b, _ in segs)
    out = []
    for i in range(GAS_BRIGADES):
        d = total * (i + 0.5) / GAS_BRIGADES
        for a_, b, nrm in segs:
            Lg = float(np.linalg.norm(b - a_))
            if d <= Lg:
                out.append((a_ + (b - a_) * d / Lg + nrm * 9.0, nrm))
                break
            d -= Lg
    return out


def crown():
    """Crown Melbourne's riverfront: the podium in sandstone and bronze glass, the atrium's glass over the main
    entrance, and the eight Gas Brigades towers along Southbank's promenade with their fire bowls."""
    rows = [q for q in ak.load_solids("melbourne") if q["osm"] == CROWN]
    if not rows:
        return [], []
    q = max(rows, key=lambda r: abs(ak.ring_area(r["ring"])))
    K = ak.Kit("crown", floodlit={"crown_wall", "crown_glass", "crown_fire"}, uv={"crown_glass"})
    ring, g, top, river = crown_front(q)
    ak.prism(K["crown_wall"], ak.WORLD, ring, g, top)
    ak.cornice(K["crown_bronze"], ak.WORLD, ring, top - 1.2, ((0, 0), (0.6, 0.2), (0.6, 1.2), (0, 1.2)))
    ak.band(K["crown_bronze"], ak.WORLD, ring, g + 13.0, out=0.4, h=0.8)
    glass = K["crown_glass"]
    s0 = 0.0
    for p0, p1, nrm, Ln in river:  # glass along the river front, its two lower floors
        a0, a1 = p0 + nrm * 0.15, p1 + nrm * 0.15
        glass.quad((*a0, g), (*a1, g), (*a1, g + 12.5), (*a0, g + 12.5), [[s0, 0], [s0 + Ln, 0], [s0 + Ln, 12.5], [s0, 12.5]])
        s0 += Ln
    if river:
        longest = max(river, key=lambda r: r[3])
        p0, p1, nrm, Ln = longest
        mid = (p0 + p1) / 2
        # the atrium: a glass vault over the main entrance, rising over the podium's roof
        t = (p1 - p0) / Ln
        F = ak.Frame(*(mid - nrm * 15.0), math.degrees(math.atan2(t[1], t[0])), top)
        for k in range(10):
            a0, a1 = math.pi * k / 10, math.pi * (k + 1) / 10
            glass.quad(F(-20, -14 * math.cos(a0), 7 * math.sin(a0)), F(20, -14 * math.cos(a0), 7 * math.sin(a0)),
                       F(20, -14 * math.cos(a1), 7 * math.sin(a1)), F(-20, -14 * math.cos(a1), 7 * math.sin(a1)))
        for p, _ in gas_brigades(river):
            K["crown_granite"].box((p[0], p[1], g), (p[0], p[1], g + 14.0), GAS_BRIGADE_M, GAS_BRIGADE_M)
            K["crown_fire"].lathe([(g + 14.0, 1.0), (g + 14.6, 1.6), (g + 15.0, 1.7)], (p[0], p[1]), segs=10)
    return K.out(), [r["si"] for r in rows]


def crown_duplicates():
    """An unmapped duplicate of the casino under the complex's outline (w972192630, 31 m), which the podium
    draws: demolished rather than hidden, so the surface model (and the arrival's measure of what a walker
    sees of Crown) has the podium alone."""
    from shapely.geometry import Polygon
    rows = [q for q in ak.load_solids("melbourne") if q["osm"] == CROWN]
    if not rows:
        return []
    outline = Polygon(max(rows, key=lambda r: abs(ak.ring_area(r["ring"])))["ring"]).buffer(0)
    return [r["si"] for r in ak.load_solids("melbourne") if r["osm"] != CROWN and abs(ak.ring_area(r["ring"])) > 1000
            and Polygon(r["ring"]).buffer(0).intersection(outline).area > 0.8 * abs(ak.ring_area(r["ring"]))]


def landmark_demolished(scene):
    return crown_duplicates()


def flinders_street(s):
    """Terracotta bands and a dark green cornice along the outline, the copper dome, the tower's
    clocks and the row of clocks over the entrance."""
    g0, top = s["ground_m"], s["ground_m"] + s["top_m"]
    bands, cornice = Mesh("fss_bands", "fss_terracotta", False), Mesh("fss_cornice", "fss_green", False)
    ring = [np.array(p) for p in s["outline"]]
    cx, cy = np.mean([p[0] for p in ring]), np.mean([p[1] for p in ring])
    for a, c in zip(ring, ring[1:]):
        L = np.linalg.norm(c - a)
        if L < 1.0:
            continue
        n = np.array([(c - a)[1], -(c - a)[0]]) / L  # outward, for a ring going round either way
        if np.dot((a + c) / 2 - np.array([cx, cy]), n) < 0:
            n = -n
        o = n * 0.12
        for z in (g0 + 4.5, g0 + 9.5, g0 + 14.5):
            bands.box((a[0] + o[0], a[1] + o[1], z), (c[0] + o[0], c[1] + o[1], z), 0.25, 0.7)
        cornice.box((a[0] + o[0], a[1] + o[1], top - 0.4), (c[0] + o[0], c[1] + o[1], top - 0.4), 0.5, 0.8)
    out = [bands, cornice]
    if "dome" in s:
        d = s["dome"]
        dx, dy = d["at"]
        z0, z1, r = g0 + d["base_m"], g0 + d["top_m"], d["r"]
        drum = Mesh("fss_dome_drum", "fss_cream", True)
        drum.lathe([(z0 - 0.5, r * 1.04), (z0 + 0.6, r * 1.04), (z0 + 0.6, r * 0.96)], (dx, dy), segs=40)
        dome = Mesh("fss_dome", "fss_copper", True, floodlit=True)
        k = 12
        dome.lathe([(z0 + 0.6 + (z1 - z0 - 1.6) * math.sin(math.pi / 2 * t / k), r * 0.96 * math.cos(math.pi / 2 * t / k)) for t in range(k + 1)] +
                   [(z1 - 0.2, 0.9), (z1 + 1.0, 0.7), (z1 + 1.4, 0.05)], (dx, dy), segs=40)
        out += [drum, dome]
    clocks, hands = Mesh("fss_clocks", "fss_clock", False, floodlit=True), Mesh("fss_clock_hands", "fss_hands", False)

    def face(c, n, rad, z):  # a clock face on a wall whose outward normal is n, with its hands at ten past ten
        c, n = np.asarray(c, float), np.asarray(n, float) / np.linalg.norm(n)
        side = np.array([n[1], -n[0], 0.0])
        nn = np.array([n[0], n[1], 0.0])
        P = lambda u, v: np.array([c[0], c[1], z]) + nn * 0.15 + side * u + np.array([0, 0, v])
        for j in range(24):
            a0, a1 = 2 * math.pi * j / 24, 2 * math.pi * (j + 1) / 24
            clocks.tri(P(0, 0), P(math.sin(a0) * rad, math.cos(a0) * rad), P(math.sin(a1) * rad, math.cos(a1) * rad))
        for ang, ln in ((math.radians(300), 0.55), (math.radians(60), 0.8)):
            hands.box(P(0, 0) + nn * 0.03, P(math.sin(ang) * rad * ln, math.cos(ang) * rad * ln) + nn * 0.03, rad * 0.08, 0.04, up=tuple(nn))
    if "tower" in s:
        cs = [np.array(p) for p in s["tower"]["corners"]]
        tc = np.mean(cs, axis=0)
        zc = g0 + s["tower"]["top_m"] - 6.0
        for a, c in zip(cs, cs[1:] + cs[:1]):
            m = (a + c) / 2
            face(m, m - tc, min(1.8, np.linalg.norm(c - a) * 0.3), zc)
    if "dome" in s:  # the row of clocks over the entrance, facing out from under the dome, placed from the
        # ground at the door (the station's centroid stands 3 m lower, down Flinders Street)
        e, d = np.array(s["entrance"]), np.array(s["dome"]["at"])
        n = (e - d) / np.linalg.norm(e - d)
        side = np.array([n[1], -n[0]])
        ze = ak.Terrain("melbourne")(*e) + ENTRANCE_STEPS_M + CLOCKS_OVER_STEPS_M + ENTRANCE_CLOCK_R
        for j in range(-3, 4):
            face(e + side * j * 1.3 + n * 0.4, n, ENTRANCE_CLOCK_R, ze)
    return out + [clocks, hands]


def theatres_outline():
    """The Theatres Building's outline in the local frame, anticlockwise, simplified to 0.4 m."""
    import cityctx
    from shapely.geometry import Polygon
    C = cityctx.City("melbourne")
    ring = ak.simplify(list(C.to_local(Polygon(THEATRES_OUTLINE)).exterior.coords)[:-1])
    return ring if ak.ring_area(ring) > 0 else ring[::-1]


def theatres_building(s):
    """The Theatres Building above ground: bluestone walls from the promenade to the roof at the spire's foot,
    a pale coping, the foyer's glass where it faces the forecourt on St Kilda Road (east), the roof, and the
    drum the spire's ribs stand on."""
    ring = theatres_outline()
    T = ak.Terrain("melbourne")
    roof = s["base_m"]
    z0 = min(T(x, y) for x, y in ring) - 0.5
    K = ak.Kit("acm_theatres", floodlit={"acm_coping"}, uv={"acm_bluestone"})  # (dark stone stays dark at night; its coping catches the light)
    ak.prism(K["acm_bluestone"], ak.WORLD, ring, z0, roof - 0.9)
    ak.prism(K["acm_coping"], ak.WORLD, ak.offset_ring(ring, 0.15), roof - 0.9, roof)
    ak.band(K["acm_coping"], ak.WORLD, ring, roof - 4.2, out=0.12, h=0.3)
    glass = K["acm_glass"]
    for k in range(len(ring)):
        a, b = np.asarray(ring[k]), np.asarray(ring[(k + 1) % len(ring)])
        L = float(np.linalg.norm(b - a))
        if L < 3.0:
            continue
        t = (b - a) / L
        n = np.array([t[1], -t[0]])  # outward, the ring being anticlockwise
        if n[0] < 0.6:  # the forecourt's side only
            continue
        za, zb = T(*(a + t * 0.6)), T(*(b - t * 0.6))
        if roof - max(za, zb) > 7.5:  # only where the forecourt is (the promenade below it has no foyer)
            continue
        p0, p1 = a + t * 0.6 + n * 0.06, b - t * 0.6 + n * 0.06
        glass.quad((*p0, za - 0.3), (*p1, zb - 0.3), (*p1, zb + 3.4), (*p0, za + 3.4), [[0, 0], [L, 0], [L, 3.7], [0, 3.7]])
    cx, cy = s["at"]
    K["acm_coping"].lathe([(roof, 15.6), (roof + 0.9, 15.6), (roof + 0.9, 14.8), (roof + 1.3, 14.4), (roof + 1.3, 0.1)], (cx, cy), segs=36)
    return K.out()


def spire(s):
    """Twelve ribs from a 14 m base radius curving in to the mast, rings, and the mast."""
    cx, cy = s["at"]
    z0, top = s["base_m"], s["top_m"]
    skirt = (top - z0) * 0.62  # where the ribs meet the mast
    m = Mesh("arts_centre_spire", "spire", False, floodlit=True)

    def radius(t):  # 0 at the base, 1 where the ribs meet the mast
        return 1.6 + 12.4 * (1 - t) ** 1.7

    def P(a, t):
        r = radius(t)
        return np.array([cx + r * math.cos(a), cy + r * math.sin(a), z0 + t * skirt])
    ribs, segs = 12, 10
    for k in range(ribs):
        a = 2 * math.pi * k / ribs
        for j in range(segs):
            m.box(P(a, j / segs), P(a, (j + 1) / segs), 0.55, 0.55)
    for zr in np.arange(8.0, skirt, 8.0):  # rings
        t = zr / skirt
        for k in range(ribs):
            a0, a1 = 2 * math.pi * k / ribs, 2 * math.pi * (k + 1) / ribs
            m.box(P(a0, t), P(a1, t), 0.3, 0.3)
    mast = [(z0 + skirt * 0.6, 1.8), (z0 + skirt, 1.2), (top - 12, 0.6), (top, 0.15)]
    for (za, wa), (zb, wb) in zip(mast, mast[1:]):
        m.box((cx, cy, za), (cx, cy, zb), (wa + wb) / 2, (wa + wb) / 2, up=(1, 0, 0))
    return m


def xy(p):
    return [round(float(p[0]), 2), round(float(p[1]), 2)]


def close_to(name, at, z, start, within=1.5, keep=0.0):
    """A thing to walk up to (game.json "close"): `at` on it at the floor's height z, the walk starting
    at `start`; tools/close_step.js must get within `within` m and never nearer than `keep`."""
    return {"name": name, "at": [*xy(at), round(float(z), 2)], "from": xy(start), "within": within, **({"keep": keep} if keep else {})}


def game_extras(scene):
    """The things people come to see up close (game.json "close"): Flinders Street Station's main entrance
    under the clocks, from the corner of Flinders and Swanston Streets, and the Gas Brigades towers on
    Southbank's promenade, and the Theatres Building's foyer glass under the Arts Centre spire, across the
    forecourt from St Kilda Road. (The spire stands on the building's roof, 6 m up: not a thing to walk up to.)"""
    lm = scene["landmarks"]
    close = []
    T = ak.Terrain("melbourne")
    fs = lm.get("flinders_street")
    if fs and "dome" in fs:
        e, d = np.asarray(fs["entrance"], float), np.asarray(fs["dome"]["at"], float)
        n = (e - d) / np.linalg.norm(e - d)  # out from under the dome, as the clocks face (flinders_street)
        close.append(close_to("Flinders Street Station, the entrance under the clocks", e, T(*e), e + n * 6.0, 1.5, 0.2))
    sp = lm.get("arts_centre_spire")
    if sp:
        # the forecourt's side of the Theatres Building: the east-facing wall nearest the spire
        ring, c = theatres_outline(), np.asarray(sp["at"], float)
        best = None
        for k in range(len(ring)):
            a, b = np.asarray(ring[k], float), np.asarray(ring[(k + 1) % len(ring)], float)
            L = float(np.linalg.norm(b - a))
            n = np.array([(b - a)[1], -(b - a)[0]]) / max(L, 1e-9)
            if L > 6.0 and n[0] > 0.6:
                m = (a + b) / 2
                if best is None or np.linalg.norm(m - c) < np.linalg.norm(best[0] - c):
                    best = (m, n)
        if best:
            m, n = best
            close.append(close_to("Arts Centre Melbourne, the Theatres Building's foyer under the spire", m, T(*(m + n * 1.0)), m + n * 6.0, 1.0, 0.3))
    rows = [q for q in ak.load_solids("melbourne") if q["osm"] == CROWN]
    if rows:
        _, _, _, river = crown_front(max(rows, key=lambda r: abs(ak.ring_area(r["ring"]))))
        towers = gas_brigades(river)
        for k in (0, len(towers) // 2):
            p, nrm = towers[k]
            at = p + nrm * GAS_BRIGADE_M / 2  # its face towards the river
            close.append(close_to(f"Crown's Gas Brigades, tower {k + 1}", at, T(*at), at + nrm * 5.0, 1.0, 0.1))
    return {"close": close}
