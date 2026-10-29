"""Data for the game view (web/game/): where people can walk, where boats can go,
and where the city's NPCs, wharves, helipads and ferry routes are.

    python pipeline/game_data.py --city sydney      # after build_scene.py and landmarks.py

Writes web/data/<city>/game.json:
  water     5 m mask (1 = water), bit-packed rows from the north-west corner
  terrain   5 m bare-earth grid for walking and the ground mesh: land keeps its DEM
            height, and under the water the bottom is modelled from the distance to
            the nearest shore and its kind (pipeline/shore.py, from shore.png): a
            beach shelves gently, rock steeply, a seawall drops to 4 m at once
  paths     footways for pedestrians and roads for traffic, as 3D polylines in
            decimetres with their class; bridge parts follow the city's deck surfaces, tunnel parts
            are dropped (Overture road flags and levels)
  surfaces  walkable surfaces above the terrain from the city's game_surfaces hook
  wharves   ferry berths next to the Overture ferry terminals named in city.json
  ferries   routes found by a shortest path through open water, kept clear of land
            and piers, then smoothed
  helipads, props (benches and street lamps), npcs and quests (positions snapped to
  open ground)
  viewpoints  trig stations to survey the view from, as given in city.json (not
            snapped: one stands on the bridge deck)
  boardwalks  walkways at deck height over rocks, water or sand: mapped lines found by
            name, or lines given in the local frame, buffered to their width
  wildlife  a colony on a mapped class of infrastructure (the St Kilda breakwater):
            burrows on it, landing places on its seaward edge with open water beyond,
            and the line of its viewing platform
  flocks    birds that work a spot on open ground (Sydney's gulls round a box of chips),
            snapped to it, with places on the seawall beside it where they stand
  nogo      the colony's rocks, which walkers keep off (footways across them are dropped)
  travel    fast-travel points, on the ground; links to neighbouring cities
  climate   passed through from city.json: the monthly mean daily maximum, which decides
            whether the crowd looks for sun or shade on the benches
"""
import base64
import json
import math
import os
from heapq import heappop, heappush

import duckdb
import numpy as np
import shapely
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from shapely import wkb as swkb
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import substring

from build_scene import DEM_CELL, load_dem, raster_mask, rows, sample, water_polygons, write_index
from shore import QUAY_SHELF_M, depth_at, from_png
from cityctx import city_args, polygons

FOOT = {"footway", "pedestrian", "path", "living_street", "steps", "cycleway"}
ROAD = {"motorway": 22, "trunk": 19, "primary": 14, "secondary": 13, "tertiary": 12, "residential": 9,
        "unclassified": 9, "living_street": 5}  # default speeds, m/s
PIER_DECK = 2.2


def strip_height(surf, x, y):
    """Height of a strip surface at (x, y), or None outside it."""
    ox, oy = surf["origin"]
    ax, ay = surf["axis"]
    dx, dy = x - ox, y - oy
    u, v = dx * ax + dy * ay, -dx * ay + dy * ax
    prof = surf["profile"]
    if abs(v) > surf["half_width"] or u < prof[0][0] or u > prof[-1][0]:
        return None
    return float(np.interp(u, [p[0] for p in prof], [p[1] for p in prof]))


def flag_ranges(flags, name):
    """Fractions [a, b] of a segment that carry a road flag."""
    out = []
    for f in flags or []:
        if name in (f.get("values") or []):
            b = f.get("between") or [0.0, 1.0]
            out.append((float(b[0]), float(b[1])))
    return out


def level_of(levels, t):
    for lv in levels or []:
        b = lv.get("between") or [0.0, 1.0]
        if b[0] <= t <= b[1]:
            return int(lv.get("value") or 0)
    return 0


def pack(mask):
    return base64.b64encode(np.packbits(mask.astype(np.uint8), axis=None).tobytes()).decode()


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    cfg, gcfg = C.cfg, C.cfg.get("game", {})
    scene = json.load(open(os.path.join(C.out, "scene.json")))
    places = json.load(open(os.path.join(C.out, "places.json")))
    B = json.load(open(os.path.join(C.out, "buildings.json")))
    con = duckdb.connect()
    con.execute("LOAD spatial")
    raw = lambda name: os.path.join(C.raw, f"overture_{name}.parquet")
    extent = box(C.x0, C.y0, C.x1, C.y1)

    # ---------------------------------------------------------- water and land
    dem = load_dem(C)
    ny, nx = dem.shape
    sm = from_png(os.path.join(C.out, "shore.png"), C.x0, C.y1, cfg)
    gy, gx = np.mgrid[0:ny, 0:nx]
    gx, gy = C.x0 + (gx + 0.5) * DEM_CELL, C.y1 - (gy + 0.5) * DEM_CELL
    sea = water_polygons(C, con, raw, extent)
    water = raster_mask(sea, nx, ny, DEM_CELL, C.x0, C.y1)
    piers = [Polygon(np.asarray(r, float).reshape(-1, 2) / 10) for r in places["piers"]]
    pier_mask = raster_mask([p.buffer(3) for p in piers], nx, ny, DEM_CELL, C.x0, C.y1)
    built = raster_mask([Polygon(np.asarray(s[4], float).reshape(-1, 2) / 10) for s in B["s"]], nx, ny, DEM_CELL, C.x0, C.y1)
    open_ground = ~water & ~built
    cell = lambda x, y: (int(np.clip((C.y1 - y) / DEM_CELL, 0, ny - 1)), int(np.clip((x - C.x0) / DEM_CELL, 0, nx - 1)))
    ground = lambda x, y: float(sample(C, dem, x, y)[0])

    hook = C.hook("game_surfaces")
    surfaces = hook(scene) if hook else []

    def surface_z(x, y):
        hs = [h for s in surfaces if (h := strip_height(s, x, y)) is not None]
        return max(hs) if hs else None

    def drape_z(x, y):  # surfaces every footway crossing them is put onto (steps)
        hs = [h for s in surfaces if s.get("drape") and (h := strip_height(s, x, y)) is not None]
        return max(hs) if hs else None

    # ---------------------------------------------------------- paths
    foot, roads, n_tunnel, n_bridge = [], [], 0, 0
    for r in rows(con, raw("segment"), "class, subtype, road_flags, level_rules, max_speed_kmh, wkb"):
        if r["subtype"] != "road" or (r["class"] not in FOOT and r["class"] not in ROAD):
            continue
        g = C.to_local(swkb.loads(bytes(r["wkb"])))
        if not g.intersects(extent):
            continue
        tunnels = flag_ranges(r["road_flags"], "is_tunnel")
        bridges = flag_ranges(r["road_flags"], "is_bridge")
        if any(a <= 0.0 and b >= 1.0 for a, b in tunnels):
            n_tunnel += 1
            continue
        # cut out tunnel parts, keep the rest as pieces
        cuts, t0 = [], 0.0
        for a, b in sorted(tunnels):
            if a > t0:
                cuts.append((t0, a))
            t0 = max(t0, b)
        if t0 < 1.0:
            cuts.append((t0, 1.0))
        for a, b in cuts:
            piece = substring(g, a, b, normalized=True) if (a, b) != (0.0, 1.0) else g
            piece = piece.intersection(extent)
            for line in getattr(piece, "geoms", [piece]):
                if line.geom_type != "LineString" or line.length < 3:
                    continue
                line = line.simplify(0.5)
                n = max(2, int(line.length / 8) + 1)  # resample every ~8 m so heights follow the ground
                pts, ok = [], True
                for k in range(n):
                    q = line.interpolate(k / (n - 1), normalized=True)
                    t = a + (b - a) * (line.project(q) / max(line.length, 1e-9))
                    on_bridge = any(ba <= t <= bb for ba, bb in bridges)
                    lv = level_of(r["level_rules"], t)
                    sz = surface_z(q.x, q.y)
                    if r["class"] in FOOT and drape_z(q.x, q.y) is not None:
                        z = drape_z(q.x, q.y)
                        n_bridge += 1
                    elif sz is not None and (on_bridge or lv >= 1):
                        z = sz
                        n_bridge += 1
                    elif water[cell(q.x, q.y)] and not on_bridge:
                        ok = False  # an unflagged line over water (ferry lines, data errors)
                        break
                    else:
                        z = ground(q.x, q.y) + (6.0 * lv if lv >= 1 else 0.0)
                        if on_bridge and water[cell(q.x, q.y)]:
                            z = max(z, 5.0)  # small bridges over water
                    pts += [round(q.x * 10), round(q.y * 10), round(z * 10)]
                if not ok:
                    continue
                if r["class"] in FOOT and level_of(r["level_rules"], (a + b) / 2) <= 0 or r["class"] in FOOT and surface_z(*line.interpolate(0.5, normalized=True).coords[0]) is not None:
                    foot.append({"c": r["class"], "p": pts})
                if r["class"] in ROAD:
                    v = (r["max_speed_kmh"] or 0) / 3.6 or ROAD[r["class"]]
                    roads.append({"c": r["class"], "v": round(min(v, ROAD[r["class"]] + 3), 1), "p": pts})
    print(f"paths: {len(foot)} footway pieces, {len(roads)} road pieces; {n_tunnel} tunnels dropped, {n_bridge} points on deck surfaces")

    # ---------------------------------------------------------- wharves and helipads
    infra = rows(con, raw("infrastructure"), "name, class, wkb")
    terminals = [(r["name"], C.to_local(swkb.loads(bytes(r["wkb"]))).centroid) for r in infra if r["class"] == "ferry_terminal" and r["name"]]
    # navigable water keeps clear of land and piers; clearance in metres
    nav = water & ~pier_mask
    clear = ndimage.distance_transform_edt(nav) * DEM_CELL
    wharves = {}
    for w in gcfg.get("wharves", []):
        hits = [p for n, p in terminals if n.startswith(w["terminal"])]
        if not hits:
            print("wharf not found:", w["terminal"])
            continue
        # several terminals can share a name (each berth of Central's piers is "Central"): the one nearest `near`
        p = min(hits, key=lambda q: math.hypot(q.x - w["near"][0], q.y - w["near"][1])) if "near" in w else hits[0]
        # berth: the nearest navigable cell with 6 m of clearance
        rr, cc = np.nonzero(clear >= 6.0)
        r0, c0 = cell(p.x, p.y)
        k = int(np.argmin((rr - r0) ** 2 + (cc - c0) ** 2))
        bx, by = C.x0 + (cc[k] + 0.5) * DEM_CELL, C.y1 - (rr[k] + 0.5) * DEM_CELL
        # boarding point: open ground or pier nearest the berth
        wharves[w["id"]] = {"id": w["id"], "name": w["name"], "terminal": [round(p.x, 1), round(p.y, 1)], "berth": [round(bx, 1), round(by, 1)],
                            "dist_m": round(math.hypot(bx - p.x, by - p.y), 1)}
    print("wharves:", {k: v["dist_m"] for k, v in wharves.items()})
    helipads = []
    for r in infra:
        if r["class"] == "helipad" and gcfg.get("helipads_from_data", True):
            q = C.to_local(swkb.loads(bytes(r["wkb"]))).centroid
            if extent.contains(q):
                first = next((h["id"] for h in gcfg.get("helipads", []) if h.get("from_data")), "helipad")
                helipads.append({"id": first if not helipads else f"helipad-{len(helipads)}", "name": r["name"] or "Helipad",
                                 "at": [round(q.x, 1), round(q.y, 1), round(ground(q.x, q.y), 1)]})
    for h in gcfg.get("helipads", []):
        if h.get("from_data") and "near" in h and helipads:  # the mapped pad nearest a point, first in the list
            k = min(range(len(helipads)), key=lambda i: math.hypot(helipads[i]["at"][0] - h["near"][0], helipads[i]["at"][1] - h["near"][1]))
            hp = helipads.pop(k)
            for other in helipads:
                if other["id"] == h["id"]:
                    other["id"] = hp["id"]
            hp["id"] = h["id"]
            helipads.insert(0, hp)
        for hp in helipads:
            if hp["id"] == h["id"]:
                hp["name"] = h.get("name", hp["name"])
        if not h.get("from_data") and "at" in h:
            helipads.append({"id": h["id"], "name": h["name"], "at": h["at"] + [round(ground(*h["at"]), 1)]})

    # ---------------------------------------------------------- boardwalks: mapped walkways (lines) over rocks or water, as decks
    boardwalks = []
    for bw in gcfg.get("boardwalks", []):
        if "line" in bw:  # given in the local frame, e.g. a mapped path extended to where the ground meets the deck
            lines = [LineString(bw["line"])]
        else:
            lines = [C.to_local(swkb.loads(bytes(r["wkb"]))) for r in infra if r["name"] == bw["name"]]
        lines = [g for g in lines if g.geom_type in ("LineString", "MultiLineString")]
        if not lines:
            print("boardwalk not found:", bw["name"])
            continue
        deck = shapely.union_all(lines).buffer(bw.get("width_m", 3.0) / 2, cap_style="flat").intersection(extent)
        for q in polygons(deck):
            boardwalks.append([round(v * 10) for xy in q.simplify(0.3).exterior.coords[:-1] for v in xy])
    print("boardwalks:", len(boardwalks))

    # ---------------------------------------------------------- wildlife: a colony on mapped rocks (a breakwater), where its birds
    # come ashore (the colony's edge with open water beyond it, on the seaward bearings) and where they nest
    wildlife, nogo = [], []
    for wc in gcfg.get("wildlife", []):
        near = Point(*wc["colony_near"])
        rocks = [C.to_local(swkb.loads(bytes(r["wkb"]))) for r in infra if r["class"] == wc.get("on", "breakwater")]
        rocks = [g for g in rocks if g.geom_type in ("Polygon", "MultiPolygon") and g.distance(near) < wc.get("within_m", 60)]
        if not rocks:
            print("colony not found:", wc["name"])
            continue
        colony = shapely.union_all(rocks).intersection(extent)
        walk = shapely.union_all([Polygon(np.asarray(r, float).reshape(-1, 2) / 10) for r in boardwalks]).buffer(1.0) if boardwalks else Polygon()
        b0, b1 = wc.get("seaward_bearing_deg", [0, 360])
        landings = []
        for poly in polygons(colony):
            ring = poly.exterior
            for d in np.arange(0, ring.length, 3.0):
                p, q = ring.interpolate(d), ring.interpolate(d + 0.5)
                tx, ty = q.x - p.x, q.y - p.y
                L = math.hypot(tx, ty) or 1
                nxo, nyo = ty / L, -tx / L  # one side; flip to face out of the rocks
                if poly.contains(Point(p.x + nxo, p.y + nyo)):
                    nxo, nyo = -nxo, -nyo
                bearing = math.degrees(math.atan2(nxo, nyo)) % 360
                if not (b0 <= bearing <= b1) or walk.distance(p) < 4:
                    continue
                if all(water[cell(p.x + nxo * k, p.y + nyo * k)] for k in (6, 20, 40)):  # open water beyond
                    landings.append([round(p.x, 1), round(p.y, 1), round(bearing)])
        rng = np.random.default_rng(7)
        inner = colony.buffer(-1.0).difference(walk.buffer(2.0))
        x0, y0, x1, y1 = inner.bounds
        burrows = []
        while len(burrows) < wc.get("show", 150) and inner.area > 0:
            x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
            if inner.contains(Point(x, y)):
                burrows.append([round(x, 1), round(y, 1), round(ground(x, y), 1)])
        view = [C.to_local(swkb.loads(bytes(r["wkb"]))) for r in infra if r["name"] == wc.get("viewing")]
        wildlife.append({k: wc[k] for k in wc if k not in ("colony_near", "within_m", "on", "seaward_bearing_deg")} | {
            "landings": landings, "burrows": burrows,
            "viewing": [[round(c, 1) for c in xy] for g in view for xy in (g.coords if g.geom_type == "LineString" else g.exterior.coords)]})
        for q in polygons(colony.difference(walk)):  # the rocks are the birds': walkers keep to the boardwalk
            nogo.append([round(v * 10) for xy in q.simplify(0.5).exterior.coords[:-1] for v in xy])
        print(f"wildlife {wc['name']}: {len(landings)} landing points, {len(burrows)} burrows")
    if nogo:  # the crowd keeps off the colony too: drop footways that cross it
        from shapely.prepared import prep
        keep_off = prep(shapely.union_all([Polygon(np.asarray(r, float).reshape(-1, 2) / 10) for r in nogo]))
        n0 = len(foot)
        foot = [f for f in foot if not any(keep_off.contains(Point(f["p"][k] / 10, f["p"][k + 1] / 10)) for k in range(0, len(f["p"]), 3))]
        print(f"footways crossing no-go areas dropped: {n0 - len(foot)}")

    # ---------------------------------------------------------- places to travel to once visited, with the ground under them
    travel = [dict(t, at=[t["at"][0], t["at"][1], round(ground(*t["at"]), 1)]) for t in gcfg.get("travel", [])]

    # ---------------------------------------------------------- ferry routes through open water
    rr, cc = np.nonzero(nav)
    idx = -np.ones(nav.shape, int)
    idx[rr, cc] = np.arange(len(rr))
    cost_cell = 1.0 + 40.0 / np.maximum(clear[rr, cc], 2.5)  # keep to the middle of channels
    src, dst, wt = [], [], []
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        r2, c2 = rr + dr, cc + dc
        ok = (r2 < ny) & (c2 >= 0) & (c2 < nx)
        j = np.full(len(rr), -1)
        j[ok] = idx[r2[ok], c2[ok]]
        ok = j >= 0
        d = math.hypot(dr, dc) * DEM_CELL
        src.append(np.nonzero(ok)[0]); dst.append(j[ok]); wt.append(d * 0.5 * (cost_cell[ok] + cost_cell[j[ok]]))
    src, dst, wt = np.concatenate(src), np.concatenate(dst), np.concatenate(wt)
    graph = coo_matrix((np.r_[wt, wt], (np.r_[src, dst], np.r_[dst, src])), shape=(len(rr), len(rr))).tocsr()

    def node(x, y):
        r0, c0 = cell(x, y)
        if idx[r0, c0] >= 0:
            return idx[r0, c0]
        k = int(np.argmin((rr - r0) ** 2 + (cc - c0) ** 2))
        return k

    def seg_clear(a, b, need):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        for t in np.linspace(0, 1, max(2, int(L / 2.5))):
            x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            if clear[cell(x, y)] < need:
                return False
        return True

    def route(a, b):
        s, t = node(*a), node(*b)
        _, pred = dijkstra(graph, indices=s, return_predecessors=True)
        path, k = [], t
        while k != s and k >= 0:
            path.append(k)
            k = pred[k]
        if k < 0:
            raise SystemExit(f"no water route between {a} and {b}")
        path = [s] + path[::-1]
        pts = [a] + [(C.x0 + (cc[k] + 0.5) * DEM_CELL, C.y1 - (rr[k] + 0.5) * DEM_CELL) for k in path] + [b]
        # string pulling: keep 12 m of clearance on long legs, less near the berths
        out, i = [pts[0]], 0
        while i < len(pts) - 1:
            j = len(pts) - 1
            while j > i + 1 and not seg_clear(pts[i], pts[j], 12.0 if 3 < i < len(pts) - 4 else 3.0):
                j -= 1
            out.append(pts[j])
            i = j
        # densify to 20 m so Chaikin smoothing can only cut a corner by a few metres,
        # then take the smoothest version that stays in open water
        dense = [out[0]]
        for p, q in zip(out[:-1], out[1:]):
            k = max(1, int(math.hypot(q[0] - p[0], q[1] - p[1]) / 20))
            dense += [(p[0] + (q[0] - p[0]) * t / k, p[1] + (q[1] - p[1]) * t / k) for t in range(1, k + 1)]
        for iters in (3, 2, 1, 0):
            sm = dense
            for _ in range(iters):
                nxt = [sm[0]]
                for p, q in zip(sm[:-1], sm[1:]):
                    nxt += [(0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]), (0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1])]
                nxt.append(sm[-1])
                sm = nxt
            line = LineString(sm)
            n = max(2, int(line.length / 5))
            res = [line.interpolate(k / n, normalized=True) for k in range(n + 1)]
            inner = [clear[cell(p.x, p.y)] for p in res if min(p.distance(Point(a)), p.distance(Point(b))) > 30]
            worst = min(inner) if inner else 0.0
            if worst >= 4.0:
                break
        return [[round(p.x, 1), round(p.y, 1)] for p in res], round(line.length, 1), float(worst)

    ferries = []
    for f in gcfg.get("ferries", []):
        stops = [s for s in f["stops"] if s in wharves]
        legs = []
        for a, b in zip(stops[:-1], stops[1:]):
            pts, length, worst = route(wharves[a]["berth"], wharves[b]["berth"])
            legs.append({"from": a, "to": b, "length_m": length, "min_clearance_m": float(worst), "path": pts})
            print(f"  {f['route']}: {a} -> {b}: {length:.0f} m, min clearance {worst:.0f} m")
        ferries.append({"route": f["route"], "stops": stops, "vessels": f.get("vessels", ["Ferry"]), "legs": legs})

    # ---------------------------------------------------------- props
    props = {"bench": [], "street_lamp": []}
    for r in rows(con, raw("infrastructure"), "class, wkb"):
        if r["class"] in props:
            q = C.to_local(swkb.loads(bytes(r["wkb"]))).centroid
            if extent.contains(q) and not water[cell(q.x, q.y)]:
                props[r["class"]] += [round(q.x * 10), round(q.y * 10), round(ground(q.x, q.y) * 10)]
    print("props:", {k: len(v) // 3 for k, v in props.items()})

    # ---------------------------------------------------------- rail: trams in the street, a funicular up the hill
    # Overture rail segments of the classes the city's game names (game.rail). OpenStreetMap breaks a
    # track at every junction, so pieces are chained into through routes, each continuing along the
    # straightest piece that meets its end. A funicular climbs: its route starts at the lower end and
    # its profile is the ground made monotonic, which bridges the dips under its viaducts. A piece
    # left over whose ends both meet the route is the funicular's passing loop.
    def chain(lines, tol=2.5):
        unit = lambda v: v / (np.linalg.norm(v) or 1)
        used, routes = set(), []
        for i0 in sorted(range(len(lines)), key=lambda i: -lines[i].length):
            if i0 in used:
                continue
            used.add(i0)
            pts = [tuple(c[:2]) for c in lines[i0].coords]
            for _ in range(2):  # extend the far end, then (reversed) the near end
                while True:
                    tip, d0, best = np.array(pts[-1]), unit(np.array(pts[-1]) - np.array(pts[-2])), None
                    for j, l in enumerate(lines):
                        if j in used:
                            continue
                        cs = [tuple(c[:2]) for c in l.coords]
                        for seq in (cs, cs[::-1]):
                            if np.linalg.norm(np.array(seq[0]) - tip) < tol:
                                c = float(np.dot(d0, unit(np.array(seq[1]) - np.array(seq[0]))))
                                if c > 0.7 and (best is None or c > best[0]):
                                    best = (c, j, seq)
                    if best is None:
                        break
                    used.add(best[1])
                    pts += best[2][1:]
                pts.reverse()
            routes.append(LineString(pts))
        return routes

    rail = {}
    for kind, rc in gcfg.get("rail", {}).items():
        segs = []
        for r in rows(con, raw("segment"), "class, subtype, road_flags, wkb"):
            if r["subtype"] != "rail" or r["class"] != rc.get("class", kind):
                continue
            if any(a <= 0.0 and b >= 1.0 for a, b in flag_ranges(r["road_flags"], "is_tunnel")):
                continue
            g = C.to_local(swkb.loads(bytes(r["wkb"]))).intersection(extent)
            segs += [ln for ln in getattr(g, "geoms", [g]) if ln.geom_type == "LineString" and ln.length > 1]
        merged = shapely.line_merge(shapely.union_all(segs)) if segs else None
        pieces = [ln for ln in getattr(merged, "geoms", [merged]) if ln is not None and ln.length > 1]
        routes = chain(pieces)
        if rc.get("climb") and routes:  # one route, from the bottom up, and its passing loop
            routes.sort(key=lambda l: -l.length)
            main = routes[0]
            if ground(*main.coords[0][:2]) > ground(*main.coords[-1][:2]):
                main = LineString(main.coords[::-1])
            loop = None
            for o in routes[1:]:
                if main.distance(Point(o.coords[0][:2])) < 3 and main.distance(Point(o.coords[-1][:2])) < 3 and o.length > 50:
                    s0, s1 = sorted([main.project(Point(o.coords[0][:2])), main.project(Point(o.coords[-1][:2]))])
                    mid_o, mid_m = o.interpolate(0.5, normalized=True), main.interpolate((s0 + s1) / 2)
                    ahead = main.interpolate(min(main.length, (s0 + s1) / 2 + 5))
                    hx, hy = ahead.x - mid_m.x, ahead.y - mid_m.y
                    side = (-hy * (mid_o.x - mid_m.x) + hx * (mid_o.y - mid_m.y)) / (math.hypot(hx, hy) or 1)  # + = left of the climb
                    loop = [round(s0, 1), round(s1, 1), round(side, 1)]
            routes = [main]
        out_lines = []
        for ln in routes:
            if ln.length < rc.get("min_length_m", 60):
                continue
            n = max(2, int(ln.length / 4) + 1)
            pts = [ln.interpolate(k / (n - 1), normalized=True) for k in range(n)]
            z = np.array([ground(q.x, q.y) for q in pts])
            if rc.get("climb"):
                z = np.maximum.accumulate(z)
            out_lines.append({"length_m": round(ln.length, 1), "p": [v for q, h in zip(pts, z) for v in (round(q.x * 10), round(q.y * 10), round(h * 10))]})
        out_lines.sort(key=lambda l: -l["length_m"])
        rail[kind] = dict({k: v for k, v in rc.items() if k not in ("class", "min_length_m")}, lines=out_lines)
        if rc.get("climb") and loop:
            rail[kind]["passing_loop"] = loop
        print(f"rail {kind}: {len(out_lines)} routes, {sum(l['length_m'] for l in out_lines):.0f} m" + (f"; passing loop {loop}" if rc.get("climb") else ""))

    # ---------------------------------------------------------- NPCs: snap to open ground
    og_r, og_c = np.nonzero(open_ground)

    def snap(x, y):
        r0, c0 = cell(x, y)
        if open_ground[r0, c0]:
            return x, y, 0.0
        k = int(np.argmin((og_r - r0) ** 2 + (og_c - c0) ** 2))
        sx, sy = C.x0 + (og_c[k] + 0.5) * DEM_CELL, C.y1 - (og_r[k] + 0.5) * DEM_CELL
        return sx, sy, math.hypot(sx - x, sy - y)

    npcs = []
    for n in gcfg.get("npcs", []):
        if len(n["at"]) > 2:  # someone up on a roof or a deck: placed as given
            npcs.append(n)
            continue
        x, y, moved = snap(*n["at"])
        if moved > 0:
            print(f"  npc {n['id']} moved {moved:.1f} m to open ground")
        npcs.append(dict(n, at=[round(x, 1), round(y, 1)]))
    sx, sy, _ = snap(*gcfg.get("start", {}).get("at", [0, 0]))

    # ---------------------------------------------------------- flocks: birds that work a spot on open ground (gulls round a box
    # of chips by the water), and the seawall beside it: the edges of land cells within perch_m that face the water, where
    # they stand and look out
    flocks = []
    for fc in gcfg.get("flocks", []):
        x, y, moved = snap(*fc["at"])
        r0, c0 = cell(x, y)
        reach, perches = fc.get("perch_m", 14.0), []
        cells = int(reach / DEM_CELL) + 1
        for r in range(max(0, r0 - cells), min(ny, r0 + cells + 1)):
            for c in range(max(0, c0 - cells), min(nx, c0 + cells + 1)):
                if not open_ground[r, c]:
                    continue
                for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    if 0 <= r + dr < ny and 0 <= c + dc < nx and water[r + dr, c + dc]:
                        px, py = gx[r, c] + dc * 1.7, gy[r, c] - dr * 1.7  # about a metre in from the edge
                        if math.hypot(px - x, py - y) <= reach and all(math.hypot(px - p[0], py - p[1]) > 3 for p in perches):
                            perches.append([round(px, 1), round(py, 1), round(math.degrees(math.atan2(dc, -dr)) % 360)])
        perches.sort(key=lambda p: math.hypot(p[0] - x, p[1] - y))
        flocks.append(dict({k: v for k, v in fc.items() if k != "perch_m"}, at=[round(x, 1), round(y, 1)], perches=perches[:6]))
        print(f"flock {fc['id']}: at {x:.1f}, {y:.1f} (moved {moved:.1f} m), {len(perches[:6])} places on the seawall")
    for q in gcfg.get("quests", []):  # a quest step that visits a flock goes where it is
        for st in q.get("steps", []):
            f = next((f for f in flocks if f["id"] == st.get("flock")), None)
            if f:
                st["at"] = f["at"]

    # the walking ground: the DEM on land, the modelled bottom under the water, except where a
    # helipad stands on the water (a floating pad): there it keeps the pad's own height
    ground_grid = np.where(water, -depth_at(sm, gx, gy, C.x0, C.y1), dem)
    edge = water & ndimage.binary_dilation(~water)  # just under the surface off a quay, as in the viewer's terrain
    ground_grid[edge] = np.maximum(ground_grid[edge], -QUAY_SHELF_M)
    for hp in helipads:
        x, y, z = hp["at"]
        near = water & (np.hypot(gx - x, gy - y) < 14.0)
        ground_grid[near] = np.maximum(ground_grid[near], max(z, 0.0))
    out = {
        "note": "Game data for web/game, written by pipeline/game_data.py.",
        "title": gcfg.get("title", f"{cfg['name']} on Foot"),
        **{k: gcfg[k] for k in ("local_name", "water_name", "greeting", "blurb", "under_bridge_note", "shade_landmarks", "ferry_style", "climate", "sky") if k in gcfg},
        "water": {"cell": DEM_CELL, "nx": nx, "ny": ny, "bits": pack(water)},
    "terrain": {"cell": DEM_CELL, "nx": nx, "ny": ny, "scale": 0.1, "encoding": "int16le-base64",
                "data": base64.b64encode(np.round(ground_grid * 10).astype("<i2").tobytes()).decode()},
        "pier_deck_m": PIER_DECK,
        "surfaces": surfaces,
        "paths": {"foot": foot, "road": roads},
        "wharves": list(wharves.values()),
        "ferries": ferries, "ferry_note": gcfg.get("ferry_note", ""),
        "ferry_speed_ms": gcfg.get("ferry_speed_ms", 9.0), "ferry_dwell_s": gcfg.get("ferry_dwell_s", 20.0),
        "helipads": helipads,
        "viewpoints": gcfg.get("viewpoints", []),
        "boardwalks": boardwalks,
        "wildlife": wildlife,
        "flocks": flocks,
        "nogo": nogo,
        "travel": travel,
        **{k: gcfg[k] for k in ("links",) if k in gcfg},
        **({"rail": rail} if rail else {}),
        "props": props,
        "crowd": gcfg.get("crowd", {"pedestrians": 300, "cars": 120, "radius_m": 450}),
        "npcs": npcs,
        "lines": gcfg.get("lines", []),
        "quests": gcfg.get("quests", []),
        "start": dict(gcfg.get("start", {}), at=[round(sx, 1), round(sy, 1)]),
        # liveries, registration and logo for the shared vehicles (web/assets/vehicles); empty means the defaults
        "vehicles": gcfg.get("vehicles", {}),
    }
    # a city's own flavour: the title-screen text, crowd small talk, the player's look
    out |= {k: gcfg[k] for k in ("blurb", "smalltalk", "player_looks", "areas", "spots", "chatter", "metro", "regulars") if k in gcfg}
    # what the city's landmarks add to the game (lifts, places to travel to on a roof): city.py game_extras(scene)
    if C.hook("game_extras"):
        for k, v in C.hook("game_extras")(scene).items():
            out[k] = out.get(k, []) + v if isinstance(v, list) else v
    path = os.path.join(C.out, "game.json")
    json.dump(out, open(path, "w"), separators=(",", ":"))
    print(f"{path}: {os.path.getsize(path) / 1e6:.2f} MB")
    write_index()


if __name__ == "__main__":
    main()
