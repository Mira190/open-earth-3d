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
                    walls}] rivers drawn from their centre line
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
from shapely.ops import linemerge, unary_union

from cityctx import city_args, polygons

CLASSES = ["pond", "lake", "reservoir", "basin", "water", "river", "canal", "moat"]
FLAT = {"pond", "lake", "reservoir", "basin", "water", "moat"}  # still water: one level
SEG_M = 4.0        # ring vertices this far apart at most (a channel's level changes along it)
BANK_OUT_M = (3.0, 8.0)  # a wall's bank: the highest ground this far outside it
SMOOTH_M = 80.0    # a channel's bank smoothed over this length along it
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
    """The bank's height at each ring point: the highest ground BANK_OUT_M outside the polygon near it."""
    out = np.empty(len(pts))
    for i, (x, y) in enumerate(pts):
        best = -1e9
        for a in np.linspace(0, 2 * np.pi, 12, endpoint=False):
            for d in BANK_OUT_M:
                px, py = x + d * np.cos(a), y + d * np.sin(a)
                if not poly.contains(Point(px, py)):
                    best = max(best, float(at(px, py)))
        out[i] = best if best > -1e8 else float(at(x, y))
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
    bank = np.empty(len(s))
    for i, si in enumerate(s):
        p, q = L.interpolate(si), L.interpolate(min(L.length, si + 2) if si + 2 <= L.length else si - 2)
        d = np.array([q.x - p.x, q.y - p.y]) * (1 if si + 2 <= L.length else -1)
        d /= np.linalg.norm(d) or 1
        nx, ny = -d[1], d[0]
        t = si / L.length
        half = (w0 + (w1 - w0) * t) / 2
        vals = [float(at(p.x + o * nx, p.y + o * ny)) for side in (-1, 1) for o in side * np.array([half + 3, half + 5, half + 8])]
        bank[i] = np.percentile(vals, 60)
    bank = smooth_along(s, bank, SMOOTH_M)
    bank = np.minimum.accumulate(bank)
    out = []
    for p in polygons(poly):
        if p.area < 20:
            continue
        rings = [p.exterior] + list(p.interiors)
        R, BZ, WZ = [], [], []
        for ring in rings:
            pts = ring_xy(ring)
            st = np.array([L.project(Point(x, y)) for x, y in pts])
            b = np.interp(st, s, bank)
            wz = b - spec["bank_to_water_m"]
            R.append(pts); BZ.append(b); WZ.append(wz)
        out.append({"name": spec["name"], "kind": "walled", "walls": spec.get("walls", "concrete"), "rings": R, "bz": BZ, "wz": WZ,
                    "water_m": spec.get("water_m", 0.3), "_poly": p, "_line": L})
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
            WZ = []
            for pts, b in zip(R, BZ):
                st = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))])
                WZ.append(smooth_along(st, b, SMOOTH_M) - d)
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
    out = []
    for name, cls, sub, flags, w in duckdb.sql(f"SELECT name, class, subtype, road_flags, wkb FROM '{path}'").fetchall():
        g = C.to_local(swkb.loads(bytes(w)))
        if not g.intersects(W) or sub != "road":
            continue
        fl = json.dumps(flags) if flags is not None else ""
        if "is_tunnel" in fl:
            continue
        cross = g.intersection(W.buffer(0.5))
        if cross.is_empty:
            continue
        half = ROAD_HALF.get(cls, 2.5)
        d = cross.buffer(half, cap_style="flat")
        d = d.intersection(W.buffer(1.0))
        if models is not None:
            d = d.difference(models)
        for p in polygons(d):
            if p.area > 4:
                out.append(p)
    U = unary_union(out) if out else None
    return polygons(U) if U is not None else []


def main():
    C, _ = city_args(__doc__.splitlines()[0])
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
            if spec.get("name") is not None and name != spec["name"]:
                continue
            g = C.to_local(swkb.loads(bytes(w)))
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
    q = lambda a: [round(float(v), 1) for v in np.asarray(a).ravel()]
    out = {"note": "Inland water at its own level, from pipeline/inland_water.py: rings [x, y, ...] local m (outer, then holes); "
                   "bz the bank's height and wz the water's at each ring point (m); water_m the water's depth over the bed; "
                   "decks: where a road crosses a walled channel without a bridge model, the ground kept over it.",
           "bodies": [{"name": b["name"], "kind": b["kind"], **({"walls": b["walls"]} if b.get("walls") else {}),
                       "water_m": b["water_m"], "rings": [q(r) for r in b["rings"]], "bz": [q(v) for v in b["bz"]],
                       "wz": [q(v) for v in b["wz"]]} for b in bodies],
           "decks": [q(np.asarray(p.exterior.coords)[:-1]) for p in D]}
    if cfg.get("colour"):
        out["colour"] = cfg["colour"]
    scene["inland"] = out
    json.dump(scene, open(scene_path, "w"), separators=(",", ":"))
    for b in bodies:
        wz = np.concatenate(b["wz"]); bz = np.concatenate(b["bz"])
        print(f"  {b['kind']:8s} {b['name'] or '-':24s} {b['_poly'].area:9.0f} m2  water {wz.min():6.1f}..{wz.max():6.1f} m"
              f"  bank-water {np.median(bz - wz):4.1f} m")
    print(f"inland water: {len(bodies)} bodies ({sum(b['kind'] == 'walled' for b in bodies)} walled), {len(D)} decks -> {scene_path}")


if __name__ == "__main__":
    main()
