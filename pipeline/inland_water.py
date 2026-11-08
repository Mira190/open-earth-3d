"""Inland water at its own level: rivers, canals, moats and ponds above the sea (issue 277).

The sea, a harbour or a tidal river is drawn by web/water.js at the scene's 0 m. Water above it, a river
in an inland city (Kyoto's Kamo River at 30-50 m, the Meguro River at 8-16 m) or a park's pond, was left
to the aerial photograph and drawn as ground. This step finds that water and writes it to scene.json
"inland", which web/inland.js draws in the viewer and the game:

  walled   a channel between revetments (the Meguro and Shibuya rivers' concrete, a canal's or a moat's
           stone): its water bank_to_water_m below the bank, walls from the bank down to its bed, the
           ground cut away over it, and the roads that cross it kept as decks over it
  natural  a pond or a river in its bed (the Kamo River): the water at the level the terrain's 5 m laser
           survey gives (GSI DEM5A interpolates over water), the ground under it lowered to its bed

Bodies come from Overture's base water (OpenStreetMap, ODbL): its polygons of the classes in
city.json water.inland.classes, and its rivers mapped only as lines (the Meguro River) by name with a
width (inland.lines). Stretches in a culvert (tunnel=culvert) are left out, and so is water a landmark
already draws (the Nijo Castle moats) or that a city names in inland.skip.

The levels come from the game's 5 m terrain grid (web/data/<id>/game.json), so they agree with the ground
drawn: a channel's bank is the ground just outside its walls (the laser survey dips into a 10 m channel,
so the bank is the higher ground either side), smoothed along the river and never rising downstream.

    python pipeline/inland_water.py --city shibuya

city.json water.inland:
  classes           polygon classes kept (default pond, lake, reservoir, basin, water, river, canal, moat)
  min_area_m2       the smallest polygon kept (default 250)
  lines             [{name, width_m (one value, or [start, end] along the flow), bank_to_water_m, water_m,
                    walls, also (other names of the same river), clip ([x0, y0, x1, y1]: only this stretch),
                    terrace}] rivers drawn from their centre line; terrace {stream_m, path_m, steps_m}: a sunken
                    promenade, a paved floor path_m over the water between the walls with the stream down its
                    middle stream_m wide, and flights of steps down from the crossings (Kyoto's Horikawa)
  rules             {name: {walls, bank_to_water_m, water_m, flat}} for named polygons
  class_rules       {class: {...}} the same for every polygon of a class without a rule of its own
  narrow            {...} the same for a river's or a canal's polygon narrower than narrow.under_m on average
                    (Kyoto's Takase River and Shirakawa between their stone walls), default walled in stone
                    1 m down, under 15 m
  skip              names left out
"""
import base64
import json
import os

import duckdb
import numpy as np
import shapely
from scipy import ndimage
from shapely import wkb as swkb
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import linemerge, substring, unary_union

from cityctx import city_args, polygons

CLASSES = ["pond", "lake", "reservoir", "basin", "water", "river", "canal", "moat"]
FLAT = {"pond", "lake", "reservoir", "basin", "water", "moat"}  # still water: one level
SEG_M = 4.0        # ring vertices this far apart at most (a channel's level changes along it)
BANK_OUT_M = (2.5, 5.0, 8.0)  # a wall's bank: the highest ground this far outside it, on its own side
SMOOTH_M = 80.0    # a channel's bank smoothed over this length along it
BANK_RISE_M = 2.5  # a channel's higher bank (on a slope) at most this much over its lower one
STEPS_CLEAR_M = 1.5  # a flight of steps down to a sunken promenade starts this far past its crossing's deck
SEAT_PIECE_M = 6.0   # seating steps along a promenade's wall, in pieces this long that follow its line
STEPS_OSM_M = 25.0   # mapped stairs this near a crossing (along the channel) put its flight on their bank and face
ROAD_HALF = {"motorway": 9.0, "trunk": 8.0, "primary": 7.0, "secondary": 6.0, "tertiary": 5.0, "residential": 3.5,
             "unclassified": 3.5, "living_street": 3.0, "service": 2.5, "pedestrian": 3.0, "footway": 1.5, "path": 1.2,
             "steps": 1.5, "cycleway": 1.5, "track": 2.0}


def grid(C):
    g = json.load(open(os.path.join(C.out, "game.json"), encoding="utf8"))["terrain"]
    z = np.frombuffer(base64.b64decode(g["data"]), "<i2").reshape(g["ny"], g["nx"]).astype(float) * g["scale"]
    cell = g["cell"]

    def at(x, y):
        scalar = np.ndim(x) == 0
        c = np.clip((np.atleast_1d(np.asarray(x, float)) - C.x0) / cell, 0, g["nx"] - 1)
        r = np.clip((C.y1 - np.atleast_1d(np.asarray(y, float))) / cell, 0, g["ny"] - 1)
        v = ndimage.map_coordinates(z, [r, c], order=1, mode="nearest")
        return float(v[0]) if scalar else v
    return at, cell


def landmark_water(C):
    """Outlines of the water a landmark draws itself (a castle's moat): its water meshes' footprints."""
    L = json.load(open(os.path.join(C.out, "landmarks.json"), encoding="utf8"))
    mats = L.get("materials", {})
    out = []
    for m in L.get("meshes", []):
        if not ("water" in m["name"].lower() or "pond" in m["name"].lower() or "water" in m.get("material", "")):
            continue
        if (mats.get(m.get("material"), {}) or {}).get("opacity", 1) == 0:
            continue
        p, idx = np.asarray(m["position"], float).reshape(-1, 3), np.asarray(m["index"], int).reshape(-1, 3)
        tris = [Polygon(p[t, :2]) for t in idx]
        tris = [t for t in tris if t.is_valid and t.area > 0.01]
        if tris:
            out.append(unary_union(tris).buffer(1.0))
    g = json.load(open(os.path.join(C.out, "game.json"), encoding="utf8"))
    for r in g.get("keep_off", []):
        a = np.asarray(r, float).reshape(-1, 2) / 10
        if len(a) >= 3:
            out.append(Polygon(a).buffer(1.0))
    return unary_union(out) if out else None


def ring_xy(ring, seg=SEG_M):
    r = shapely.segmentize(LineString(ring.coords), seg)
    a = np.asarray(r.coords)[:-1]
    return a


def smooth_along(s, v, length):
    """Values v at stations s (sorted), smoothed with a running median then mean over `length`."""
    out = np.empty_like(v)
    for i, si in enumerate(s):
        k = np.abs(s - si) <= length / 2
        out[i] = np.median(v[k])
    sm = np.empty_like(out)
    for i, si in enumerate(s):
        k = np.abs(s - si) <= length / 4
        sm[i] = out[k].mean()
    return sm


def bank_samples(at, poly, pts):
    """The bank's height at each ring point: the highest ground BANK_OUT_M outside the polygon on the point's own
    side (a fan about its outward normal, none of whose samples crosses the water). A narrow channel on a slope
    (the Philosopher's Path canal) would otherwise take its uphill bank's height on its downhill side too, and its
    coping stood high over the ground there (issue 300)."""
    n = len(pts)
    out = np.empty(n)
    for i, (x, y) in enumerate(pts):
        tx, ty = pts[(i + 1) % n] - pts[(i - 1) % n]
        L = np.hypot(tx, ty) or 1.0
        nx, ny = ty / L, -tx / L
        if poly.contains(Point(x + 0.4 * nx, y + 0.4 * ny)):
            nx, ny = -nx, -ny
        best = -1e9
        for a in np.radians([-55, -25, 0, 25, 55]):
            ca, sa = np.cos(a), np.sin(a)
            dx, dy = nx * ca - ny * sa, nx * sa + ny * ca
            for d in BANK_OUT_M:
                px, py = x + d * dx, y + d * dy
                seg = LineString([(x + 0.3 * dx, y + 0.3 * dy), (px, py)])
                if poly.intersects(seg):
                    break   # back over the water: the far bank, not this one
                best = max(best, float(at(px, py)))
        out[i] = best if best > -1e8 else float(at(x, y))
    return out


def across_min(R, BZ, width):
    """Each ring point's bank and the lowest bank across the channel from it (within `width` m): the water stands
    level across a channel, under its lower bank."""
    P = np.concatenate(R)
    Z = np.concatenate(BZ)
    out = []
    for pts in R:
        m = np.empty(len(pts))
        for i, (x, y) in enumerate(pts):
            k = np.hypot(P[:, 0] - x, P[:, 1] - y) <= width
            m[i] = Z[k].min()
        out.append(m)
    return out


def line_body(C, at, line, spec, extent):
    """A walled channel from a river's centre line: its outline, and the bank and water levels at each of
    its points from the stations along the line."""
    L = line
    # the river flows downhill: from the end whose ground is higher
    if at(*L.coords[0]) < at(*L.coords[-1]):
        L = LineString(L.coords[::-1])
    w = spec.get("width_m", 10.0)
    w0, w1 = (w, w) if not isinstance(w, list) else w
    # widths along it, a buffer per piece so the outline widens downstream
    n = max(2, int(L.length / 25))
    parts = []
    for i in range(n):
        a, b = L.length * i / n, L.length * (i + 1) / n
        piece = shapely.ops.substring(L, max(0, a - 1), min(L.length, b + 1))
        t = (a + b) / 2 / L.length
        parts.append(piece.buffer((w0 + (w1 - w0) * t) / 2, cap_style="flat", join_style="round", quad_segs=4))
    poly = unary_union(parts).buffer(0.3).buffer(-0.3).intersection(extent)
    # levels along the line: the bank either side, smoothed, never rising downstream
    s = np.arange(0, L.length + 0.1, 5.0)
    sides = np.empty((2, len(s)))
    for i, si in enumerate(s):
        p, q = L.interpolate(si), L.interpolate(min(L.length, si + 2) if si + 2 <= L.length else si - 2)
        d = np.array([q.x - p.x, q.y - p.y]) * (1 if si + 2 <= L.length else -1)
        d /= np.linalg.norm(d) or 1
        nx, ny = -d[1], d[0]
        t = si / L.length
        half = (w0 + (w1 - w0) * t) / 2
        for j, side in enumerate((-1, 1)):
            vals = [float(at(p.x + o * nx, p.y + o * ny)) for o in side * np.array([half + 3, half + 5, half + 8])]
            sides[j, i] = np.percentile(vals, 60)
    # each bank on its own (a river along a slope has a higher bank uphill), smoothed, never rising downstream; the
    # water under the lower one
    sides = np.array([np.minimum.accumulate(smooth_along(s, v, SMOOTH_M)) for v in sides])
    low = sides.min(axis=0)
    sides = np.minimum(sides, low + BANK_RISE_M)
    out = []
    for p in polygons(poly):
        if p.area < 20:
            continue
        rings = [p.exterior] + list(p.interiors)
        R, BZ, WZ = [], [], []
        for ring in rings:
            pts = ring_xy(ring)
            st = np.array([L.project(Point(x, y)) for x, y in pts])
            # which bank: the side of the line the point is on (n = (-d.y, d.x) is side +1, as above)
            side = np.empty(len(pts), int)
            for k, ((x, y), sk) in enumerate(zip(pts, st)):
                a, q = L.interpolate(max(0.0, sk - 1.0)), L.interpolate(min(L.length, sk + 1.0))
                c = L.interpolate(sk)
                side[k] = 1 if (q.x - a.x) * (y - c.y) - (q.y - a.y) * (x - c.x) > 0 else 0
            b = np.where(side == 1, np.interp(st, s, sides[1]), np.interp(st, s, sides[0]))
            wz = np.interp(st, s, low) - spec["bank_to_water_m"]
            R.append(pts); BZ.append(b); WZ.append(wz)
        body = {"name": spec["name"], "kind": "walled", "walls": spec.get("walls", "concrete"), "rings": R, "bz": BZ, "wz": WZ,
                "water_m": spec.get("water_m", 0.3), "_poly": p, "_line": L}
        if spec.get("terrace"):
            body.update(terrace_of(L, p, s, low, sides, spec))
        out.append(body)
    return out


def terrace_of(L, p, s, low, sides, spec):
    """A sunken promenade (Kyoto's Horikawa): the channel between its walls is a paved floor path_m above the
    water, with the stream down the middle in a narrow bed of its own (stream_m wide, along the line). The walls
    stand from the bank down to that floor."""
    T = spec["terrace"]
    stream = L.buffer(T.get("stream_m", 2.5) / 2, cap_style="flat").intersection(p.buffer(-T.get("lip_m", 0.6)))
    water_z = lambda st: np.interp(st, s, low) - spec["bank_to_water_m"]
    # over stepped weirs the stream lies level from one sill to the next and falls over each (a chute the length of a
    # ring's step, about 2 m): its level the smooth one at the sill above
    weir_s = []
    if T.get("weirs"):
        wa, wb = sorted(L.project(Point(*q)) for q in T["weirs"]["between"])
        weir_s = list(np.arange(wa + T["weirs"].get("every_m", 12.0) / 2, wb, T["weirs"].get("every_m", 12.0)))
    def stream_z(st):
        st = np.atleast_1d(st)
        z = water_z(st)
        if len(weir_s) > 1:
            k = np.searchsorted(weir_s, st, side="right") - 1
            on = (k >= 0) & (k < len(weir_s) - 1)
            z = np.where(on, water_z(np.array(weir_s)[np.clip(k, 0, len(weir_s) - 1)]), z)
        return z
    R, WZ = [], []
    for sp in polygons(stream):
        if sp.area < 4:
            continue
        for ring in [sp.exterior] + list(sp.interiors):
            pts = ring_xy(ring, 2.0)
            st = np.array([L.project(Point(x, y)) for x, y in pts])
            R.append(pts); WZ.append(stream_z(st))
    out = {"path_m": T.get("path_m", 0.35), "steps_m": T.get("steps_m", 1.4)}
    floor_z = lambda st: np.interp(st, s, low) - spec["bank_to_water_m"] + T.get("path_m", 0.35)
    span = lambda pts: sorted(L.project(Point(*q)) for q in pts)
    def wall_at(st, bank):
        """the point on the line at st, the unit vectors along it and to the wall on `bank` (+1 its left), and the
        wall's distance from the line"""
        c, q = L.interpolate(st), L.interpolate(min(L.length, st + 1.0))
        ux, uy = q.x - c.x, q.y - c.y
        n = np.hypot(ux, uy) or 1.0
        ux, uy = ux / n, uy / n
        nx, ny = -uy * bank, ux * bank
        half = next((o for o in np.arange(0.5, 15.0, 0.1) if not p.contains(Point(c.x + nx * o, c.y + ny * o))), None)
        return c, ux, uy, nx, ny, half
    # a lawn on one bank's side of the stream (Kyoto City: the 芝生広場 between Shimochojamachi and Demizu), a paved
    # strip kept along the stream and a margin along the wall
    if T.get("lawn"):
        a, b = span(T["lawn"]["between"])
        band = substring(L, a, b).buffer(30.0, cap_style="flat")
        bank = T["lawn"].get("bank", 1)
        side = band.intersection(L.buffer(30.0, cap_style="flat", single_sided=True) if bank > 0 else L.buffer(-30.0, cap_style="flat", single_sided=True))
        g = p.buffer(-T["lawn"].get("wall_m", 0.8)).intersection(side).difference(L.buffer(T.get("stream_m", 2.5) / 2 + T["lawn"].get("path_m", 1.4)))
        out["lawn"] = {"rings": [], "z": []}
        for lp in polygons(g):
            if lp.area < 10:
                continue
            pts = ring_xy(lp.simplify(0.2).exterior, 2.0)
            out["lawn"]["rings"].append(pts)
            out["lawn"]["z"].append(floor_z(np.array([L.project(Point(x, y)) for x, y in pts])))
    # seating steps along one wall (Kyoto City: 観覧席にもなる階段 between Nijo and Oshikoji, on the east bank in the
    # photographs): tiers stepping up from the floor to the wall, in pieces SEAT_PIECE_M long that follow its line
    if T.get("seats"):
        S = T["seats"]
        a, b = span(S["between"])
        pieces = []
        for st in np.arange(a + S.get("clear_m", 6.0), b - S.get("clear_m", 6.0), SEAT_PIECE_M):
            c, ux, uy, nx, ny, half = wall_at(st, S.get("bank", 1))
            if half is None:
                continue
            ln = min(SEAT_PIECE_M, b - S.get("clear_m", 6.0) - st)
            pieces.append([c.x + nx * half, c.y + ny * half, ux, uy, nx, ny, ln, float(floor_z(st)), S.get("tiers", 4), S.get("rise_m", 0.4), S.get("tread_m", 0.7)])
        out["seats"] = pieces
    # stepped weirs in the stream (Kyoto City: 階段状の落差工 between Marutamachi and Takeyamachi): a granite sill
    # across it every every_m, the stream falling over it to the next sill's level
    if T.get("weirs"):
        W = T["weirs"]
        a, b = span(W["between"])
        out["weirs"] = []
        for i, st in enumerate(weir_s):
            c, ux, uy, nx, ny, half = wall_at(st, 1)
            # (the sill at the level above it; the fall to the level below, the next sill's)
            nxt = weir_s[i + 1] if i + 1 < len(weir_s) else st + W.get("every_m", 12.0)
            out["weirs"].append([c.x, c.y, ux, uy, T.get("stream_m", 2.5), float(water_z(st)), float(water_z(st) - water_z(nxt))])
    return {"terrace": out, "stream": {"rings": R, "wz": WZ},
            "_terrace": T, "_s": s, "_low": low, "_sides": sides}


def terrace_json(t):
    """A promenade's terrace for scene.json: its lawn's rings [x, y, ...] and levels to the decimetre and centimetre,
    the seats' and weirs' figures to the centimetre."""
    out = {k: v for k, v in t.items() if k not in ("lawn", "seats", "weirs")}
    if t.get("lawn"):
        out["lawn"] = {"rings": [[round(float(v), 1) for v in np.asarray(r).ravel()] for r in t["lawn"]["rings"]],
                       "z": [[round(float(v), 2) for v in z] for z in t["lawn"]["z"]]}
    for k in ("seats", "weirs"):
        if t.get(k):
            out[k] = [[round(float(v), 2) for v in row] for row in t[k]]
    return out


def steps_of(body, D, spec_d, osm_steps=None):
    """Flights of steps down to a sunken promenade from the streets that cross it: beside each crossing, on its
    downstream face, along the wall on one bank and then the other (the Horikawa's entrances open off the
    pavements and the crossings, Kyoto City). A crossing is a deck that cuts the channel in two (not a bank lane's
    sliver of deck along one wall), and each flight starts STEPS_CLEAR_M past the deck's own edge on the flight's
    line (clear of a mapped bridge's deck, which web/game/decks.js lays wider than the road), where the pavement
    beside it opens onto its top through the railing (web/inland.js). Where OpenStreetMap maps the stairs at a crossing
    (osm_steps: highway=steps lines), the flight is on their bank and their face of it; elsewhere below the crossing,
    on one bank and then the other. [x, y, ux, uy (down the flight), nx, ny (to the wall),
    z top, z bottom, width, run] per flight."""
    L, p, s, low, sides = body["_line"], body["_poly"], body["_s"], body["_low"], body["_sides"]
    T = body["_terrace"]
    width, rise, tread = T.get("steps_m", 1.4), 0.16, 0.3
    out, k = [], 0
    crossings = []
    for d in D:
        if not d.intersects(p):
            continue
        rest = [q for q in polygons(p.difference(d)) if q.area > 15.0]
        if len(rest) < 2:
            continue   # (it does not reach across)
        st = [L.project(Point(x, y)) for x, y in d.exterior.coords]
        crossings.append([min(st), max(st), d])
    crossings.sort(key=lambda c: c[0])
    merged = []
    for a, b, d in crossings:   # (a crossing's carriageway and its pavements, one crossing)
        if merged and a <= merged[-1][1] + 4.0:
            merged[-1][1] = max(merged[-1][1], b)
            merged[-1][2] = merged[-1][2].union(d)
        else:
            merged.append([a, b, d])
    stream = L.buffer(T.get("stream_m", 2.5) / 2 + 0.3, cap_style="flat")
    decked = unary_union(D) if D else None
    inside = p.buffer(0.05)
    # the stairs OpenStreetMap maps down into the channel (highway=steps with an end at its wall): where one is
    # within STEPS_OSM_M of a crossing, that crossing's flight is on its bank and its face (upstream or downstream)
    mapped = []
    for g in osm_steps or []:
        ends = [Point(g.coords[0]), Point(g.coords[-1])]
        depth = [(1 if p.contains(e) else -1) * p.exterior.distance(e) for e in ends]
        if min(depth) > 1.5 or max(depth) < -1.0:
            continue   # (inside, away from the walls: the promenade's own steps beside its weirs; or off it)
        out_end = ends[int(np.argmin(depth))]
        so = L.project(out_end)
        c0, c1 = L.interpolate(max(0.0, so - 1.0)), L.interpolate(min(L.length, so + 1.0))
        bank = 1 if (c1.x - c0.x) * (out_end.y - c0.y) - (c1.y - c0.y) * (out_end.x - c0.x) > 0 else -1
        mapped.append((L.project(g.interpolate(0.5, normalized=True)), bank))
    for i, (a, b, dk) in enumerate(merged):
        prv = merged[i - 1][1] if i > 0 else 0.0
        nxt = merged[i + 1][0] if i + 1 < len(merged) else L.length
        near = [(abs(sm - (a + b) / 2), sm, bank) for sm, bank in mapped if a - STEPS_OSM_M < sm < b + STEPS_OSM_M]
        # (else on one bank and then the other below the crossing; the other bank where the first will not take it)
        tries = [(1, 1), (1, -1)] if k % 2 == 0 else [(1, -1), (1, 1)]
        if near:
            _, sm, bank = min(near)
            tries = [(1 if sm > (a + b) / 2 else -1, bank)] + tries
        for face, bank in tries:
            s0 = b + 0.3 if face > 0 else a - 0.3
            c = L.interpolate(min(L.length, max(0.0, s0)))
            q = L.interpolate(min(L.length, max(0.0, s0 + face * 1.0)))
            ux, uy = q.x - c.x, q.y - c.y
            n = np.hypot(ux, uy) or 1.0
            ux, uy = ux / n, uy / n
            f = flight_at(L, p, s, low, sides, spec_d, T, c, ux, uy, bank * face, bank, dk, width, rise, tread)
            if f is None:
                continue
            x0, y0, nx, ny, ztop, zbot, run, st0 = f
            if not prv < st0 + face * (run + 1.0) < nxt or ztop - zbot < 0.5:
                continue
            # its footprint and a landing past its foot: in the channel, clear of the stream and of every deck; and
            # floor beside its foot to walk on from
            vx, vy = -nx, -ny
            rect = Polygon([(x0 + vx * sv * width / 2 + ux * su, y0 + vy * sv * width / 2 + uy * su)
                            for su, sv in ((-0.4, -1), (run + 1.0, -1), (run + 1.0, 1), (-0.4, 1))])
            foot = Point(x0 + ux * (run + 1.0) + vx * (width / 2 + 0.8), y0 + uy * (run + 1.0) + vy * (width / 2 + 0.8))
            if not inside.contains(rect) or rect.intersects(stream) or (decked is not None and rect.intersects(decked)):
                continue
            if not inside.contains(foot) or stream.contains(foot) or (decked is not None and decked.contains(foot)):
                continue
            out.append([x0, y0, ux, uy, nx, ny, ztop, zbot, width, run])
            k += 1
            break
    return out


def flight_at(L, p, s, low, sides, spec_d, T, c, ux, uy, side, bank, dk, width, rise, tread):
    """A flight of steps down (ux, uy) along the wall on `side` of it (the bank `bank` of the line: +1 its left),
    STEPS_CLEAR_M past the crossing's deck dk: (x, y of its top, nx, ny to the wall, z top, z bottom, run, its place
    along the line), or None."""
    nx, ny = -uy * side, ux * side
    half = None
    for o in np.arange(0.5, 15.0, 0.25):   # the wall on that side: out from the line until off the channel
        if not p.contains(Point(c.x + nx * o, c.y + ny * o)):
            half = o
            break
    if half is None:
        return None
    o = half - 0.08 - width / 2
    # the deck's edge on the flight's line: back up the channel until on the deck, then down to its edge
    ax_, ay_ = c.x + nx * o, c.y + ny * o
    on = lambda t: dk.contains(Point(ax_ + ux * t, ay_ + uy * t))
    t = 0.0
    while t > -12.0 and not on(t):
        t -= 0.1
    if t <= -12.0:
        return None
    while on(t + 0.05) and t < 12.0:
        t += 0.05
    t += STEPS_CLEAR_M
    x0, y0 = ax_ + ux * t, ay_ + uy * t
    st0 = L.project(Point(x0, y0))
    ztop = float(np.interp(st0, s, sides[1 if bank == 1 else 0]))
    zbot = float(np.interp(st0, s, low)) - spec_d["bank_to_water_m"] + T.get("path_m", 0.35)
    run = max(0.0, (ztop - zbot)) / rise * tread
    # against the wall all along: the nearest the wall comes to the flight's line between its top and its foot
    gap = []
    for a in np.linspace(-0.4, run + 1.0, 8):
        bx, by = x0 + ux * a, y0 + uy * a
        g = next((e for e in np.arange(-1.5, 3.0, 0.05) if not p.contains(Point(bx + nx * e, by + ny * e))), None)
        if g is None:
            return None
        gap.append(g)
    shift = min(gap) - width / 2 - 0.08
    return x0 + nx * shift, y0 + ny * shift, nx, ny, ztop, zbot, run, st0


def steps_lines(C, poly):
    """The stairs OpenStreetMap maps at a channel (Overture segments of class steps within 2 m of it), as lines in
    the local frame."""
    path = os.path.join(C.raw, "overture_segment.parquet")
    if not os.path.exists(path):
        return []
    out = []
    for (w,) in duckdb.sql(f"SELECT wkb FROM '{path}' WHERE class = 'steps'").fetchall():
        g = C.to_local(swkb.loads(bytes(w)))
        if g.geom_type == "LineString" and g.distance(poly) < 2.0:
            out.append(g)
    return out


def polygon_body(C, at, cell, name, cls, poly, rule):
    rings = [poly.exterior] + list(poly.interiors)
    R = [ring_xy(r) for r in rings]
    flat = rule.get("flat", cls in FLAT)
    walled = rule.get("walls") is not None
    BZ = [bank_samples(at, poly, pts) for pts in R]
    if walled:
        d = rule["bank_to_water_m"]
        if flat:
            lvl = min(float(b.min()) for b in BZ) - d
            WZ = [np.full(len(pts), lvl) for pts in R]
        else:
            # the water level across the channel (under its lower bank), then smoothed along it
            low = across_min(R, BZ, 1.6 * 2 * poly.area / max(poly.length, 1.0) + 2.0)
            WZ = []
            for pts, b in zip(R, low):
                st = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))])
                WZ.append(smooth_along(st, b, SMOOTH_M) - d)
            # and the banks along each side smoothed too, never under the water's own bank
            # (a hillside over the uphill bank stays a slope behind a wall at most BANK_RISE_M higher than the other)
            BZ = [np.clip(smooth_along(np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]), b, 20.0), w + d, w + d + BANK_RISE_M)
                  for pts, b, w in zip(R, BZ, WZ)]
        return {"name": name, "kind": "walled", "walls": rule["walls"], "rings": R, "bz": BZ, "wz": WZ,
                "water_m": rule.get("water_m", 0.5), "_poly": poly}
    # natural: the laser survey's own level over the water (it interpolates across it), just under the bank
    inner = poly.buffer(-min(cell * 0.6, 3.0))
    xs = np.arange(poly.bounds[0], poly.bounds[2], cell / 2)
    ys = np.arange(poly.bounds[1], poly.bounds[3], cell / 2)
    P = [(x, y) for x in xs for y in ys if inner.contains(Point(x, y))]
    if flat:
        zin = np.array([float(at(x, y)) for x, y in P]) if P else np.array([float(min(b.min() for b in BZ))])
        edge = np.concatenate([at(pts[:, 0], pts[:, 1]) for pts in R])
        lvl = min(np.percentile(zin, 30), np.percentile(edge, 15) - 0.15) + rule.get("raise_m", 0.0)
        WZ = [np.full(len(pts), lvl) for pts in R]
    else:
        # a river: the level near each point of its outline, the lowest fifth of the survey within 40 m
        P = np.asarray(P) if P else np.concatenate(R)
        zP = at(P[:, 0], P[:, 1])
        WZ = []
        for pts in R:
            wz = np.empty(len(pts))
            for i, (x, y) in enumerate(pts):
                k = np.hypot(P[:, 0] - x, P[:, 1] - y) < 40
                wz[i] = np.percentile(zP[k], 20) if k.any() else float(at(x, y)) - 0.3
            st = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))])
            WZ.append(smooth_along(st, wz, 60.0))
    return {"name": name, "kind": "natural", "rings": R, "bz": BZ, "wz": WZ, "water_m": rule.get("water_m", 1.0), "_poly": poly}


ALONG_M = 32.0   # a way's piece over a channel longer than this runs along it, not across


def polygons_or_lines(g):
    """The line parts of a geometry."""
    if g.is_empty:
        return []
    if hasattr(g, "geoms"):
        return [p for q in g.geoms for p in polygons_or_lines(q)]
    return [g] if g.geom_type == "LineString" else []


def decks(C, bodies, extent):
    """Where a road or a path crosses a walled channel and no bridge model stands (scene.json landmarks
    water_bridges): the ground kept as a deck over it, as wide as the road."""
    path = os.path.join(C.raw, "overture_segment.parquet")
    walled = [b for b in bodies if b["kind"] == "walled"]
    if not walled or not os.path.exists(path):
        return []
    scene = json.load(open(os.path.join(C.out, "scene.json"), encoding="utf8"))
    lmk = scene.get("landmarks", {})
    models = [Point(b["centre"]).buffer(max(6.0, b.get("length_m", 20) / 2)) for b in (lmk.get("water_bridges", []) if isinstance(lmk, dict) else [])]
    models = unary_union(models) if models else None
    W = unary_union([b["_poly"] for b in walled])
    core = W.buffer(-0.8)   # a crossing reaches over the middle of the channel; a way grazing its edge does not
    pieces = []   # (piece of a way over the channel, its class)
    for name, cls, sub, flags, w in duckdb.sql(f"SELECT name, class, subtype, road_flags, wkb FROM '{path}'").fetchall():
        g = C.to_local(swkb.loads(bytes(w)))
        if not g.intersects(W) or sub != "road" or cls == "steps":   # (stairs go down into a channel: #315)
            continue
        fl = json.dumps(flags) if flags is not None else ""
        if "is_tunnel" in fl:
            continue
        cross = g.intersection(W.buffer(0.5))
        if cross.is_empty:
            continue
        # a way that runs along the channel, not across it (a promenade inside it, a road beside it that the outline
        # grazes), is no deck: only its short pieces over it that reach over its middle are (the others still join
        # them up, below)
        pieces += [(c, cls, core.contains(c.interpolate(0.5, normalized=True))) for c in polygons_or_lines(cross) if c.length <= ALONG_M]
    # and over a sunken promenade only what crosses, from wall to wall: the pieces that join up (a bridge mapped as
    # several ways, split over the water) and reach its walls at two places; not a path that ends inside it (the
    # Horikawa's entrances, laid as slabs at the street's level over its promenade, #315)
    walls = W.boundary.buffer(0.8)
    sunk = unary_union([b["_poly"] for b in walled if b.get("_terrace")]) if any(b.get("_terrace") for b in walled) else None
    groups = []
    for c, cls, mid in pieces:
        hit = [gp for gp in groups if gp["geom"].distance(c) < 0.5]
        gp = {"geom": unary_union([c] + [h["geom"] for h in hit]), "items": [(c, cls, mid)] + [i for h in hit for i in h["items"]]}
        groups = [h for h in groups if h not in hit] + [gp]
    out = []
    for gp in groups:
        if not any(mid for _, _, mid in gp["items"]):
            continue
        if sunk is not None and gp["geom"].intersects(sunk) and len(polygons_or_lines(gp["geom"].intersection(walls))) < 2:
            continue
        d = unary_union([c.buffer(ROAD_HALF.get(cls, 2.5), cap_style="flat") for c, cls, mid in gp["items"] if mid])
        d = d.intersection(W.buffer(1.0))
        if models is not None:
            d = d.difference(models)
        for p in polygons(d):
            if p.area > 4:
                out.append(p)
    U = unary_union(out) if out else None
    return polygons(U) if U is not None else []


ROADW = {"motorway": 14, "trunk": 12, "primary": 12, "secondary": 10, "tertiary": 9, "residential": 7, "unclassified": 6, "living_street": 5}
LANE_STRIP_M = 1.8   # between a bank lane's carriageway and a channel's wall: the railing and the planting strip
LANE_MIN_M = 5.4     # no narrower: the traffic keeps 1.7 m off the line (web/game/actors.js LANE), a car 1.8 m wide


def bank_lanes(C, bodies):
    """The lanes along a walled channel's banks (the Meguro's, between the railing and the houses) are narrower
    than their class's band in the game: a road beside a channel takes "cw" in game.json, its carriageway's width,
    so that its edge keeps LANE_STRIP_M from the wall, where the bank's trees stand (web/streets.js reads it).
    Only minor roads that run along the channel for 15 m or more; a crossing keeps its width."""
    path = os.path.join(C.out, "game.json")
    walled = [b["_poly"] for b in bodies if b["kind"] == "walled"]
    if not walled or not os.path.exists(path):
        return 0
    g = json.load(open(path, encoding="utf8"))
    W = unary_union(walled)
    edge = W.boundary
    n = 0
    for r in g.get("paths", {}).get("road", []):
        r.pop("cw", None)
        if isinstance(r.get("w"), float):
            r.pop("w")   # (an earlier run's name for cw, which the game reads as a wall flag)
        c = r.get("c")
        if c not in ("residential", "unclassified", "living_street"):
            continue
        p = np.asarray(r["p"], float).reshape(-1, 3)[:, :2] / 10
        if len(p) < 2:
            continue
        L = LineString(p)
        if L.distance(W) > ROADW[c] / 2 + LANE_STRIP_M:
            continue
        near = L.intersection(W.buffer(ROADW[c] / 2 + LANE_STRIP_M)).difference(W.buffer(0.5))
        if near.length < 15:
            continue
        pts = shapely.segmentize(near, 2.0)
        xy = [q for part in (pts.geoms if hasattr(pts, "geoms") else [pts]) for q in part.coords]
        d = np.array([edge.distance(Point(q)) for q in xy])
        w = round(float(np.clip(2 * (np.percentile(d, 25) - LANE_STRIP_M), LANE_MIN_M, ROADW[c])), 1)
        if w < ROADW[c]:
            r["cw"] = w
            n += 1
    json.dump(g, open(path, "w", encoding="utf8"), separators=(",", ":"))
    return n


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    build(C)


def build(C):
    """Write scene.json "inland" for city C (game_data.py runs it after game.json, whose 5 m terrain it reads)."""
    cfg = C.cfg.get("water", {}).get("inland")
    scene_path = os.path.join(C.out, "scene.json")
    scene = json.load(open(scene_path, encoding="utf8"))
    if not cfg:
        if scene.pop("inland", None) is not None:
            json.dump(scene, open(scene_path, "w"), separators=(",", ":"))
        print("inland water: none configured")
        return
    at, cell = grid(C)
    extent = shapely.box(C.x0 + 1, C.y0 + 1, C.x1 - 1, C.y1 - 1)
    rows = duckdb.sql(f"SELECT name, class, source_tags, wkb FROM '{os.path.join(C.raw, 'overture_water.parquet')}'").fetchall()
    skip = set(cfg.get("skip", []))
    own = landmark_water(C)
    bodies = []
    # rivers from their centre lines
    for spec in cfg.get("lines", []):
        lines = []
        for name, cls, tags, w in rows:
            tags = dict(tags or {})
            if tags.get("tunnel") in ("culvert", "yes", "flooded") or tags.get("covered") == "yes":
                continue
            if spec.get("name") is not None and name not in [spec["name"], *spec.get("also", [])]:
                continue
            g = C.to_local(swkb.loads(bytes(w)))
            if spec.get("clip") is not None:
                g = g.intersection(shapely.box(*spec["clip"]))   # only this stretch (the open one)
            if spec.get("at") is not None and g.distance(Point(spec["at"])) > spec.get("within_m", 25):
                continue   # an unnamed river, picked by a point on it
            if spec.get("name") is None and (name or cls not in spec.get("classes", ["river", "stream", "canal"])):
                continue
            if g.geom_type in ("LineString", "MultiLineString"):
                lines.append(g.intersection(extent.buffer(60)))
        lines = [g for l in lines for g in (l.geoms if hasattr(l, "geoms") else [l]) if not g.is_empty and g.geom_type == "LineString"]
        merged = linemerge(lines) if len(lines) > 1 else (lines[0] if lines else None)
        for L in ([] if merged is None else merged.geoms if hasattr(merged, "geoms") else [merged]):
            if L.length < spec.get("min_m", 40):
                continue
            bodies += line_body(C, at, L, {**spec, "name": spec.get("name") or spec.get("label", "")}, extent)
    lined = unary_union([b["_poly"] for b in bodies]).buffer(6) if bodies else None
    # polygons
    classes, amin, rules = set(cfg.get("classes", CLASSES)), cfg.get("min_area_m2", 250), cfg.get("rules", {})
    for name, cls, tags, w in rows:
        if cls not in classes or (name in skip):
            continue
        tags = dict(tags or {})
        if tags.get("covered") == "yes" or tags.get("tunnel"):
            continue
        g = C.to_local(swkb.loads(bytes(w)))
        for p in polygons(g.intersection(extent)):
            p = p.simplify(0.3)
            if p.area < amin:
                continue
            if lined is not None and p.intersection(lined).area > 0.5 * p.area:
                continue   # a river drawn from its line already
            if own is not None and p.intersection(own).area > 0.3 * p.area:
                continue   # a landmark's own water
            rule = rules.get(name or "") or cfg.get("class_rules", {}).get(cls)
            if rule is None and cls in ("river", "canal", "stream"):
                nw = {"walls": "stone", "bank_to_water_m": 1.0, "water_m": 0.3, "under_m": 15.0} | cfg.get("narrow", {})
                if 2 * p.area / p.length < nw["under_m"]:
                    rule = nw
            bodies.append(polygon_body(C, at, cell, name or "", cls, p, rule or {}))
    D = decks(C, bodies, extent)
    for b in bodies:
        if b.get("_terrace"):
            spec = next(l for l in cfg.get("lines", []) if l.get("name") == b["name"])
            b["steps"] = steps_of(b, D, spec, steps_lines(C, b["_poly"]))
    q = lambda a: [round(float(v), 1) for v in np.asarray(a).ravel()]
    out = {"note": "Inland water at its own level, from pipeline/inland_water.py: rings [x, y, ...] local m (outer, then holes); "
                   "bz the bank's height and wz the water's at each ring point (m); water_m the water's depth over the bed; "
                   "decks: where a road crosses a walled channel without a bridge model, the ground kept over it.",
           "bodies": [{"name": b["name"], "kind": b["kind"], **({"walls": b["walls"]} if b.get("walls") else {}),
                       "water_m": b["water_m"], "rings": [q(r) for r in b["rings"]], "bz": [q(v) for v in b["bz"]],
                       "wz": [q(v) for v in b["wz"]],
                       **({"terrace": terrace_json(b["terrace"]), "stream": {"rings": [q(r) for r in b["stream"]["rings"]], "wz": [q(v) for v in b["stream"]["wz"]]},
                           "steps": [[round(float(v), 2) for v in st] for st in b.get("steps", [])]} if b.get("terrace") else {})} for b in bodies],
           "decks": [q(np.asarray(p.exterior.coords)[:-1]) for p in D]}
    if cfg.get("colour"):
        out["colour"] = cfg["colour"]
    scene["inland"] = out
    json.dump(scene, open(scene_path, "w"), separators=(",", ":"))
    print(f"inland water: {bank_lanes(C, bodies)} bank lanes narrowed (game.json roads cw)")
    for b in bodies:
        wz = np.concatenate(b["wz"]); bz = np.concatenate(b["bz"])
        print(f"  {b['kind']:8s} {b['name'] or '-':24s} {b['_poly'].area:9.0f} m2  water {wz.min():6.1f}..{wz.max():6.1f} m"
              f"  bank-water {np.median(bz - wz):4.1f} m")
    print(f"inland water: {len(bodies)} bodies ({sum(b['kind'] == 'walled' for b in bodies)} walled), {len(D)} decks -> {scene_path}")


if __name__ == "__main__":
    main()
