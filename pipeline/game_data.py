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

from build_scene import DEM_CELL, load_dem, raster_mask, rows, sample, write_index
from shore import depth_at, from_png
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
    wcfg = cfg.get("water", {})
    wclasses, wmin = set(wcfg.get("classes", ["ocean", "bay", "water"])), wcfg.get("min_area_m2", 5000)
    seas = [C.to_local(swkb.loads(bytes(r["wkb"]))) for r in rows(con, raw("water")) if r["class"] in wclasses]
    sea = [p for g in seas for p in polygons(g.intersection(extent.buffer(50))) if p.area > wmin]
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
        p = hits[0]
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
        if r["class"] == "helipad":
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
        x, y, moved = snap(*n["at"])
        if moved > 0:
            print(f"  npc {n['id']} moved {moved:.1f} m to open ground")
        npcs.append(dict(n, at=[round(x, 1), round(y, 1)]))
    sx, sy, _ = snap(*gcfg.get("start", {}).get("at", [0, 0]))

    # the walking ground: the DEM on land, the modelled bottom under the water, except where a
    # helipad stands on the water (a floating pad): there it keeps the pad's own height
    ground_grid = np.where(water, -depth_at(sm, gx, gy, C.x0, C.y1), dem)
    for hp in helipads:
        x, y, z = hp["at"]
        near = water & (np.hypot(gx - x, gy - y) < 14.0)
        ground_grid[near] = np.maximum(ground_grid[near], max(z, 0.0))
    out = {
        "note": "Game data for web/game, written by pipeline/game_data.py.",
        "title": gcfg.get("title", f"{cfg['name']} on Foot"),
        **{k: gcfg[k] for k in ("local_name", "water_name", "under_bridge_note", "shade_landmarks", "ferry_style") if k in gcfg},
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
        "props": props,
        "crowd": gcfg.get("crowd", {"pedestrians": 300, "cars": 120, "radius_m": 450}),
        "npcs": npcs,
        "quests": gcfg.get("quests", []),
        "start": dict(gcfg.get("start", {}), at=[round(sx, 1), round(sy, 1)]),
    }
    path = os.path.join(C.out, "game.json")
    json.dump(out, open(path, "w"), separators=(",", ":"))
    print(f"{path}: {os.path.getsize(path) / 1e6:.2f} MB")
    write_index()


if __name__ == "__main__":
    main()
