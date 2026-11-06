"""The Skyline Gondola's line, measured: where its towers and stations stand and how high, from
OpenStreetMap's aerialway (via Overture) and LINZ's 2021 LiDAR, written to gondola.json for the
landmarks (city.py) and the game's cabins (game_rail).

    python cities/queenstown/gondola.py          # needs data/raw/queenstown (fetch_overture, fetch_tiles)
    python cities/queenstown/gondola.py --photo  # only the towers, from the 2026 photographs (PHOTO_TOWERS)
    python cities/queenstown/gondola.py --game   # only game.json: the cable, the cabins, the deck and the places on it

The line is straight in plan from the Brecon Street station to the top station on Bob's Peak;
OpenStreetMap maps six towers on it. The LiDAR surface model catches the taller lattice tops
(the laser's highest return within 4 m of a mapped tower); where it does not, a tower stands as
high as the cable needs to keep the cabins clear of the ground under it. (The surface model along
the line itself is no guide to the trees: it caught the cable and the cabins, and the corridor
through the forest is kept clear.) The cable
between supports sags as a parabola (SAG of the span), and the cabins hang HANG_M under it.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

SAG = 0.025          # the cable's sag at mid-span, as a share of the span
HANG_M = 4.65        # grip to the cabin's floor: hanger 2.6 m and the cabin 2.05 m
CLEAR_M = 5.0        # the cabin's floor over the ground under it, at least (the corridor through the trees is kept clear)
STATION_GRIP_M = 4.65 + 0.4  # the cable in a station: the platform (0.4 m over the ground) plus the cabin and its hanger
TOWER_MIN_M, TOWER_MAX_M = 8.0, 32.0
STATION_M = 18.0     # the cable's run inside a station building, from the line's end


def measure():
    import duckdb
    import shapely.wkb as swkb
    from PIL import Image
    from pyproj import Transformer
    from cityctx import City
    C = City("queenstown")
    rows = duckdb.connect().execute(f"SELECT class, name, wkb FROM '{C.raw}/overture_infrastructure.parquet' WHERE subtype = 'aerialway'").fetchall()
    line = next(swkb.loads(bytes(w)) for c, n, w in rows if c == "gondola")
    pylons = [swkb.loads(bytes(w)) for c, n, w in rows if c == "pylon"]
    cs = list(line.coords)
    t2193 = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
    rasters = {}
    for name in ("dem", "dsm"):
        meta = json.load(open(os.path.join(C.raw, f"{name}.json")))
        rasters[name] = (np.asarray(Image.open(os.path.join(C.raw, f"{name}.tif")), np.float32), meta["bbox"])
    off = C.cfg.get("datum_offset_m", 0.0)

    def rc(lon, lat, name):
        a, (x0, y0, x1, y1) = rasters[name]
        X, Y = t2193.transform(lon, lat)
        return a, int(round(y1 - Y - 0.5)), int(round(X - x0 - 0.5))

    def ground(lon, lat):
        a, r, c = rc(lon, lat, "dem")
        return float(a[r, c]) - off

    def top_near(lon, lat, rad=4):
        a, r, c = rc(lon, lat, "dsm")
        return float(a[r - rad:r + rad + 1, c - rad:c + rad + 1].max()) - off

    # bottom station first (the line is mapped from the top down)
    if ground(*cs[0]) > ground(*cs[-1]):
        cs = cs[::-1]
    xy = [C.fwd.transform(lo, la) for lo, la in cs]
    on_pylon = [any(math.hypot(p.x - lo, p.y - la) < 2e-6 for p in pylons) for lo, la in cs]
    supports = []
    for k, ((lo, la), (x, y)) in enumerate(zip(cs, xy)):
        g = ground(lo, la)
        if k in (0, len(cs) - 1):
            supports.append({"kind": "station", "x": x, "y": y, "ground": g, "cable": g + STATION_GRIP_M, "lonlat": [lo, la]})
        elif on_pylon[k]:
            lidar = top_near(lo, la) - g
            supports.append({"kind": "tower", "x": x, "y": y, "ground": g, "lidar_m": round(lidar, 1), "lonlat": [lo, la],
                             "cable": g + min(max(lidar, TOWER_MIN_M), TOWER_MAX_M) if lidar > TOWER_MIN_M else None})
    # the distance along the line, and the ground and canopy under it every metre
    s = [0.0]
    for a, b in zip(xy, xy[1:]):
        s.append(s[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    for sp, sv in zip(supports, [s[k] for k in range(len(cs)) if k in (0, len(cs) - 1) or on_pylon[k]]):
        sp["s"] = sv
    L = s[-1]
    lo0, la0 = cs[0]
    lo1, la1 = cs[-1]
    under = []
    for d in np.arange(STATION_M, L - STATION_M + 0.01, 1.0):  # inside a station the laser saw its roof
        f = d / L
        lo, la = lo0 + (lo1 - lo0) * f, la0 + (la1 - la0) * f
        under.append((d, ground(lo, la), ground(lo, la)))

    # towers the laser missed: start at the lowest and raise each until every span next to it clears
    for sp in supports:
        if sp["cable"] is None:
            sp["cable"] = sp["ground"] + TOWER_MIN_M
    for _ in range(200):
        worst = min(under, key=lambda u: cable_at(u[0], supports) - HANG_M - u[2])
        gap = cable_at(worst[0], supports) - HANG_M - worst[2]
        if gap >= CLEAR_M:
            break
        # raise the nearer tower of the span (not a station)
        span = next((a, b) for a, b in zip(supports, supports[1:]) if a["s"] <= worst[0] <= b["s"])
        cand = [t for t in span if t["kind"] == "tower" and t["cable"] - t["ground"] < TOWER_MAX_M]
        if not cand:
            break
        t = min(cand, key=lambda t: abs(t["s"] - worst[0]))
        t["cable"] += 0.5
    clear = min(cable_at(u[0], supports) - HANG_M - u[2] for u in under)
    prof = [[round(d, 1), round(cable_at(d, supports), 2)] for d in np.arange(0, L + 0.01, 4.0)]
    out = {
        "note": __doc__.strip().splitlines()[0],
        "sources": "OpenStreetMap aerialway=gondola and its pylons (via Overture 2026-10-21.0); LINZ Otago - Queenstown LiDAR 1m DEM and DSM (2021)",
        "length_m": round(L, 1), "rise_m": round(supports[-1]["ground"] - supports[0]["ground"], 1),
        "start": [round(xy[0][0], 2), round(xy[0][1], 2)], "end": [round(xy[-1][0], 2), round(xy[-1][1], 2)],
        "hang_m": HANG_M, "sag": SAG, "min_clearance_m": round(clear, 1),
        "supports": [{k: (round(v, 2) if isinstance(v, float) else v) for k, v in sp.items()} | {"height_m": round(sp["cable"] - sp["ground"], 1)} for sp in supports],
        "profile": prof,
    }
    json.dump(out, open(os.path.join(HERE, "gondola.json"), "w"), indent=1)
    print(f"gondola: {L:.0f} m along, rise {out['rise_m']} m, towers {[s['height_m'] for s in out['supports'] if s['kind'] == 'tower']}, "
          f"min clearance {clear:.1f} m")


def massing(names=("Skyline Luge Queenstown",), cell=3.0, step=1.5):
    """Buildings on a steep slope whose single block (the roof's median over the lowest ground under
    it) would stand far too tall: the roof levels the LiDAR surface model shows inside the footprint,
    in cells of `cell` m quantised to `step` m, joined into terraces, each with the ground under it.
    Writes massing.json for city.py (the Skyline complex on Bob's Peak steps down the hill)."""
    import duckdb
    import shapely
    import shapely.wkb as swkb
    from PIL import Image
    from pyproj import Transformer
    from shapely.geometry import box
    from cityctx import City
    C = City("queenstown")
    off = C.cfg.get("datum_offset_m", 0.0)
    rasters = {}
    for name in ("dem", "dsm"):
        meta = json.load(open(os.path.join(C.raw, f"{name}.json")))
        rasters[name] = (np.asarray(Image.open(os.path.join(C.raw, f"{name}.tif")), np.float32), meta["bbox"])
    to2193 = Transformer.from_crs(C.proj, "EPSG:2193", always_xy=True)

    def sample(name, x, y, agg):
        a, (x0, y0, x1, y1) = rasters[name]
        X, Y = to2193.transform(x, y)
        r, c = int(y1 - Y), int(X - x0)
        h = int(cell / 2)
        return float(agg(a[r - h:r + h + 1, c - h:c + h + 1])) - off

    out = {}
    con = duckdb.connect()
    for nm in names:
        rows = con.execute(f"SELECT wkb FROM '{C.raw}/overture_building.parquet' WHERE name = ?", [nm]).fetchall()
        if not rows:
            continue
        g = C.to_local(swkb.loads(bytes(rows[0][0])))
        x0, y0, x1, y1 = g.bounds
        levels = {}
        for x in np.arange(x0, x1, cell):
            for y in np.arange(y0, y1, cell):
                b = box(x, y, x + cell, y + cell)
                if g.intersection(b).area < 0.5 * cell * cell:
                    continue
                cx, cy = x + cell / 2, y + cell / 2
                roof = sample("dsm", cx, cy, lambda v: np.percentile(v, 60))
                ground = sample("dem", cx, cy, np.min)
                if roof - ground < 2.0:
                    continue  # open ground or a terrace at grade
                levels.setdefault(round(roof / step) * step, []).append(b.intersection(g))
        tiers = []
        for z, parts in sorted(levels.items()):
            u = shapely.union_all(parts).buffer(0.01).buffer(-0.01)
            for q in getattr(u, "geoms", [u]):
                if q.area < 2 * cell * cell:
                    continue
                q = q.simplify(0.5)
                cs = np.asarray(q.exterior.coords)
                gz = min(sample("dem", x, y, np.min) for x, y in cs[::max(1, len(cs) // 12)])
                tiers.append({"top": round(z, 1), "ground": round(gz, 1), "ring": [[round(x, 2), round(y, 2)] for x, y in cs[:-1]]})
        out[nm] = {"cell_m": cell, "step_m": step, "tiers": tiers}
        print(f"massing: {nm}: {len(tiers)} terraces, roofs {min(t['top'] for t in tiers)} to {max(t['top'] for t in tiers)} m")
    json.dump({"note": massing.__doc__.strip().splitlines()[0], "sources": "LINZ Otago - Queenstown LiDAR 1m DEM and DSM (2021); OpenStreetMap outline via Overture",
               "buildings": out}, open(os.path.join(HERE, "massing.json"), "w"), indent=1)


# The towers as LINZ's 2026 aerial photographs (Queenstown 0.1m Urban Aerial Photos, flown 11 February
# to 2 March 2026) show them. The 2021 LiDAR predates the line (built 2021-2023): along it the laser
# caught the old line and the forest the new corridor was cut through, so it measures none of these
# towers. In the photographs each tower's foot is a white concrete plinth on the line, where its shadow
# starts; its head is displaced several metres downhill by the photo's relief displacement, so the foot
# places it. A tower's height is its shadow: the head's shadow (the crossarm and its sheave trains) lies
# shadow_m across the line from the foot, along the sun's azimuth. The sun is calibrated on the
# photograph's own coaches in the Brecon Street car park (3.65 m tall, 3.05 m of shadow towards 212
# degrees: 0.84 m of shadow per metre of height, the sun 50 degrees up), and each shadow is followed
# down or up the slope on the 1 m DEM. s_m is the foot's distance along the line from the bottom
# station's end (OpenStreetMap's line), shadow_m the head's shadow measured from the foot across
# the line (the photographs read by eye to about half a metre), head_m the head's length along the line.
# "mast": a tubular mast with a crossarm; "portal": a lattice frame on legs either side of the line,
# carrying long sheave trains (the line's breaks over the rock below Brecon Street, over the luge and
# under the top station).
SUN_AZ_DEG, SUN_K = 212.0, 0.84
PHOTO_TOWERS = [
    {"s_m": 32.0, "shadow_m": 11.0, "kind": "portal", "head_m": 11.0},
    {"s_m": 97.0, "shadow_m": 11.0, "kind": "mast", "head_m": 3.5},
    {"s_m": 230.0, "shadow_m": 15.0, "kind": "mast", "head_m": 4.5},
    {"s_m": 381.5, "shadow_m": 25.0, "kind": "mast", "head_m": 6.5},
    {"s_m": 554.0, "shadow_m": 14.5, "kind": "portal", "head_m": 19.0},
    {"s_m": 598.0, "shadow_m": 12.0, "kind": "portal", "head_m": 8.5},
]


def cable_at(d, sup):
    for a, b in zip(sup, sup[1:]):
        if a["s"] <= d <= b["s"]:
            f = (d - a["s"]) / max(b["s"] - a["s"], 1e-6)
            return a["cable"] + (b["cable"] - a["cable"]) * f - 4 * SAG * (b["s"] - a["s"]) * f * (1 - f)
    return sup[-1]["cable"]


def photo():
    """Re-place the towers and their heights from the 2026 photographs (PHOTO_TOWERS), on the 1 m
    DEM, and redraw the cable's profile: rewrites gondola.json's supports and profile."""
    from fetch_tiles import stac_mosaic
    from pyproj import Transformer
    from cityctx import City
    C = City("queenstown")
    off = C.cfg.get("datum_offset_m", 0.0)
    path = os.path.join(HERE, "gondola.json")
    G = json.load(open(path))
    st = [sp for sp in G["supports"] if sp["kind"] == "station"]
    t = Transformer.from_crs("EPSG:4326", "EPSG:2193", always_xy=True)
    inv = Transformer.from_crs("EPSG:2193", "EPSG:4326", always_xy=True)
    A, B = np.array(t.transform(*st[0]["lonlat"])), np.array(t.transform(*st[1]["lonlat"]))
    L = float(np.linalg.norm(B - A))
    u = (B - A) / L
    r = np.array([u[1], -u[0]])
    lons, lats = zip(*(st[0]["lonlat"], st[1]["lonlat"]))
    dem, ok, (X0, Y0, X1, Y1) = stac_mosaic(C.cfg["terrain"]["collection"], [min(lons), min(lats), max(lons), max(lats)], "EPSG:2193", 1.0, pad_m=60)
    dem = dem[0] - off

    def ground(p):  # bilinear on the 1 m DEM (cell centres at half metres)
        c, rr = p[0] - X0 - 0.5, Y1 - p[1] - 0.5
        c0, r0 = int(math.floor(c)), int(math.floor(rr))
        fc, fr = c - c0, rr - r0
        q = dem[r0:r0 + 2, c0:c0 + 2]
        return float((q[0, 0] * (1 - fc) + q[0, 1] * fc) * (1 - fr) + (q[1, 0] * (1 - fc) + q[1, 1] * fc) * fr)

    az = math.radians(SUN_AZ_DEG)
    sun = np.array([math.sin(az), math.cos(az)])
    across = float(sun @ r)  # the shadow's share across the line (the rest runs along it)
    towers = []
    for T in PHOTO_TOWERS:
        foot = A + u * T["s_m"]
        g = ground(foot)
        run = T["shadow_m"] / -across              # the shadow's horizontal length along the sun's azimuth
        tip = foot + sun * run
        h = round(ground(tip) - g + run / SUN_K, 1)  # the head's height over the foot, the slope taken into account
        x, y = C.fwd.transform(*inv.transform(*foot))
        towers.append({"kind": "tower", "type": T["kind"], "x": round(x, 2), "y": round(y, 2), "ground": round(g, 2), "s": T["s_m"],
                       "head_m": T["head_m"], "shadow_m": T["shadow_m"], "lonlat": [round(v, 7) for v in inv.transform(*foot)],
                       "cable": round(g + h, 2), "height_m": h})
    sup = [st[0]] + towers + [st[1]]
    under = [(d, ground(A + u * d)) for d in np.arange(STATION_M, L - STATION_M + 0.01, 1.0)]
    clear = min(cable_at(d, sup) - HANG_M - z for d, z in under)
    G["supports"] = sup
    G["profile"] = [[round(d, 1), round(cable_at(d, sup), 2)] for d in np.arange(0, L + 0.01, 4.0)]
    G["min_clearance_m"] = round(clear, 1)
    G["towers_note"] = ("The towers' feet and heights from LINZ's 2026 aerial photographs (their plinths and shadows, the sun "
                        "calibrated on coaches in the same photograph) on the 2021 1 m DEM; the stations' from OpenStreetMap and the LiDAR.")
    G["sources"] = G["sources"] + "; LINZ Queenstown 0.1m Urban Aerial Photos (2026)"
    json.dump(G, open(path, "w"), indent=1)
    print(f"gondola: towers {[(T['s'], T['height_m']) for T in towers]}, min clearance {clear:.1f} m")
    refresh_game()


def refresh_game():
    """Write what this city's scripts measure into the built game data (web/data/queenstown/game.json)
    as pipeline/game_data.py does, without a rebuild: the cable's profile and the cabins' settings
    (city.json game.rail.gondola), the deck's walkable strip (city.py game_surfaces), and the places
    on the deck city.json gives (the start, the NPCs, the viewpoint and the quests' steps)."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("qt_city", os.path.join(HERE, "city.py"))
    city = importlib.util.module_from_spec(spec)
    sys.path.insert(0, os.path.join(ROOT, "pipeline"))
    spec.loader.exec_module(city)
    path = os.path.join(ROOT, "web", "data", "queenstown", "game.json")
    game = json.load(open(path))
    gcfg = json.load(open(os.path.join(HERE, "city.json")))["game"]
    for kind, r in city.game_rail(None).items():
        game.setdefault("rail", {})[kind] = dict(gcfg.get("rail", {}).get(kind, {}), **r)
    own = {s["name"]: s for s in city.game_surfaces(None)}
    game["surfaces"] = [own.pop(s["name"], s) for s in game.get("surfaces", [])] + list(own.values())
    game["start"]["at"] = gcfg["start"]["at"]
    for key in ("npcs", "viewpoints"):
        by_id = {o["id"]: o for o in gcfg.get(key, [])}
        for o in game.get(key, []):
            if o.get("id") in by_id and "at" in by_id[o["id"]]:
                o["at"] = by_id[o["id"]]["at"]
    for q, qc in zip(game.get("quests", []), gcfg.get("quests", [])):
        for st, sc in zip(q.get("steps", []), qc.get("steps", [])):
            if "at" in sc and "at" in st:
                st["at"] = sc["at"]
    json.dump(game, open(path, "w"), separators=(",", ":"))
    # and the deck's and the gondola's entries in scene.json's landmarks, as city.py finalize() writes them
    spath = os.path.join(ROOT, "web", "data", "queenstown", "scene.json")
    scene = json.load(open(spath, encoding="utf8"))
    from archkit import Terrain

    class Ctx:
        ground = Terrain("queenstown")
        landmarks = scene["landmarks"]
    city.finalize(Ctx)
    json.dump(scene, open(spath, "w"), separators=(",", ":"))
    print(f"{path}: rail {list(game['rail'])}, surfaces {len(game['surfaces'])}, start {game['start']['at']}")

if __name__ == "__main__":
    if "--photo" in sys.argv:
        photo()
    elif "--game" in sys.argv:
        refresh_game()
    else:
        measure()
        massing()
        photo()
