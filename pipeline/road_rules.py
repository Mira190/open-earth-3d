"""The rules of the road for a city's traffic, from Overture Maps (OpenStreetMap, ODbL): which
streets are one-way, and where the traffic signals, stop signs and give-way signs stand.

pipeline/game_data.py writes them into web/data/<id>/game.json as it builds the paths and props:
a road piece one-way with its points carries "o": 1, one-way against them "o": -1; the signals
and signs are props ("traffic_signals", "stop", "give_way"), points in decimetres like the
benches and lamps. This script adds them to a game.json already built, without rebuilding the
rest (which needs every raw download), by matching each road piece to the Overture segment it
was cut from. Fetch the segments and infrastructure first:

    python pipeline/fetch_overture.py --city sydney --only segment infrastructure
    python pipeline/road_rules.py                  # every city with roads
    python pipeline/road_rules.py sydney tokyo
"""
import json
import os
import sys

import duckdb
import numpy as np
import shapely
from shapely import wkb as swkb
from shapely.geometry import box

from cityctx import City

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIGNS = ("traffic_signals", "stop", "give_way")
MOTOR = {"motor_vehicle", "car", "vehicle"}


def oneway(restrictions, t=0.5):
    """+1 if a car may only drive a segment with its points, -1 only against them, 0 both ways;
    at fraction t along it. Overture writes a one-way street as access denied heading backward
    (or forward), for everyone or for motor vehicles; a rule for bicycles alone leaves it two-way."""
    way = 0
    for a in restrictions or []:
        w = a.get("when") or {}
        b = a.get("between") or [0.0, 1.0]
        if a.get("access_type") != "denied" or w.get("heading") not in ("forward", "backward") or not b[0] <= t <= b[1]:
            continue
        if w.get("mode") and not MOTOR & set(w["mode"]):
            continue
        if w.get("during") or w.get("using") or w.get("recognized") or w.get("vehicle"):
            continue  # only at some times, or for some vehicles: two-way for the traffic here
        way = 1 if w["heading"] == "backward" else -1
    return way


def raw_rows(con, path, cols):
    cur = con.execute(f"SELECT {cols} FROM '{path}'")
    names = [d[0] for d in cur.description]
    for r in cur.fetchall():
        yield dict(zip(names, r))


def segments(C, con):
    """The road segments as local lines, with their one-way rule: [(class, LineString, restrictions)]."""
    from game_data import ROAD
    path = os.path.join(C.raw, "overture_segment.parquet")
    cols = [d[0] for d in con.execute(f"DESCRIBE SELECT * FROM '{path}'").fetchall()]
    if "access_restrictions" not in cols:
        raise SystemExit(f"{path} has no access_restrictions: fetch it again "
                         f"(python pipeline/fetch_overture.py --city {C.id} --only segment)")
    out = []
    for r in raw_rows(con, path, "class, subtype, access_restrictions, wkb"):
        if r["subtype"] == "road" and r["class"] in ROAD:
            out.append((r["class"], C.to_local(swkb.loads(bytes(r["wkb"]))), r["access_restrictions"]))
    return out


def signs(C, con, extent):
    """The signals and signs inside the extent, as local points: {class: [(x, y)]}."""
    out = {k: [] for k in SIGNS}
    path = os.path.join(C.raw, "overture_infrastructure.parquet")
    for r in raw_rows(con, path, "class, wkb"):
        if r["class"] in out:
            q = C.to_local(swkb.loads(bytes(r["wkb"]))).centroid
            if extent.contains(q):
                out[r["class"]].append((q.x, q.y))
    return out


def piece_way(line, segs, tree):
    """The one-way rule of a road piece (a LineString cut from one segment, its points the same way
    round): +1, -1 or 0, by the segment nearest its points a quarter, half and three quarters along."""
    votes = []
    for f in (0.25, 0.5, 0.75):
        p = line.interpolate(f, normalized=True)
        a, b = line.interpolate(max(0.0, line.project(p) - 1.0)), line.interpolate(min(line.length, line.project(p) + 1.0))
        cand = [i for i in tree.query(p.buffer(1.5)) if segs[i][1].distance(p) < 1.5]
        if not cand:
            continue
        i = min(cand, key=lambda i: segs[i][1].distance(p))
        g, rules = segs[i][1], segs[i][2]
        t = g.project(p)
        c, d = g.interpolate(max(0.0, t - 1.0)), g.interpolate(min(g.length, t + 1.0))
        same = (b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y) >= 0
        w = oneway(rules, t / max(g.length, 1e-9))
        votes.append(w if same else -w)
    return max(set(votes), key=votes.count) if votes else 0


def main(cities):
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    for cid in cities or sorted(os.listdir(os.path.join(ROOT, "cities"))):
        out = os.path.join(ROOT, "web", "data", cid, "game.json")
        if not os.path.exists(out):
            continue
        game = json.load(open(out, encoding="utf8"))
        roads = (game.get("paths") or {}).get("road") or []
        if not roads:
            continue
        C = City(cid)
        segs = segments(C, con)
        tree = shapely.STRtree([g for _, g, _ in segs])
        n1 = 0
        for o in roads:
            p = np.array(o["p"], dtype=float).reshape(-1, 3)[:, :2] / 10
            way = piece_way(shapely.LineString(p), segs, tree) if len(p) > 1 else 0
            o.pop("o", None)
            if way:
                o["o"] = way
                n1 += 1
        # a sign's height: the road's nearest point (the game seats props on the ground or deck there)
        pts = np.concatenate([np.array(o["p"], dtype=float).reshape(-1, 3) for o in roads]) / 10
        found = signs(C, con, box(C.x0, C.y0, C.x1, C.y1))
        props = game.setdefault("props", {})
        for k, xy in found.items():
            flat = []
            for x, y in xy:
                z = pts[np.argmin((pts[:, 0] - x) ** 2 + (pts[:, 1] - y) ** 2), 2]
                flat += [round(x * 10), round(y * 10), round(z * 10)]
            props[k] = flat
        json.dump(game, open(out, "w"), separators=(",", ":"))   # as game_data.py writes it
        print(f"{cid}: {n1} of {len(roads)} road pieces one-way; " + ", ".join(f"{len(v)} {k}" for k, v in found.items()))


if __name__ == "__main__":
    main(sys.argv[1:])
