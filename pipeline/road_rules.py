"""The rules of the road for a city's traffic, from Overture Maps (OpenStreetMap, ODbL): which
streets are one-way, which turns are banned, and where the traffic signals, stop signs, give-way
signs and the pedestrian crossings with signals or zebra stripes stand.

pipeline/game_data.py writes them into web/data/<id>/game.json as it builds the paths and props:
a road piece one-way with its points carries "o": 1, one-way against them "o": -1; the signals
and signs are props ("traffic_signals", "stop", "give_way"), points in decimetres like the
benches and lamps. A banned turn (Overture's prohibited_transitions: OSM's no_right_turn,
no_u_turn, only_straight_on and the like, for motor traffic at all times) is written on the road
piece it starts from as "nt": [[end, piece, end entered, steps], ...]: from this piece's end (0 its
first point, 1 its last) a car may not go into that piece (its index in paths.road) by that end,
directly when steps is 1, or by way of steps - 1 more pieces between. This script adds them to a game.json already built, without rebuilding the
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
SIGNS = ("traffic_signals", "stop", "give_way", "crossing_signals", "crossing_zebra")
# a pedestrian crossing (OSM highway=crossing, Overture class "crossing") by its tags: one with its own
# signals (a pelican or puffin crossing, and the walk signals at a junction's arms), or a zebra, where
# the traffic gives way to whoever is on it; the game models the ones between junctions (junctions.js)
ZEBRA = {"zebra", "marked"}


def crossing_kind(tags):
    """'crossing_signals', 'crossing_zebra' or None, from a crossing's OSM tags (Overture's source_tags)."""
    t = tags or {}
    if t.get("crossing") == "traffic_signals" or t.get("crossing:signals") == "yes" or t.get("crossing_ref") in ("pelican", "puffin", "toucan", "pegasus"):
        return "crossing_signals"
    if t.get("crossing") in ZEBRA or t.get("crossing_ref") == "zebra" or str(t.get("crossing:markings", "")).startswith("zebra"):
        return "crossing_zebra"
    return None
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


DAYS = ("Mo", "Tu", "We", "Th", "Fr", "Sa", "Su")
ALL_DAYS = 127


def windows(during):
    """The times an OSM opening_hours value (Overture's `when.during`) covers, as [[days, m0, m1], ...]:
    days a bit mask (1 Monday .. 64 Sunday), m0..m1 minutes of the day (m1 up to 1440); one past
    midnight is split, its morning part on the next day. Overture drops the spaces
    ("Mo-Fr07:30-08:30", "07:30-08:3016:00-18:00"). None for what it can't read (sunrise, public
    holidays, months), which the game then leaves out."""
    import re
    if not during:
        return None
    d = during.strip()
    if d == "24/7":
        return [[ALL_DAYS, 0, 1440]]
    out = []
    for part in d.split(";"):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?\s*)*)(.*)$", part)
        dpart, rest = m.group(1), m.group(2).strip()
        mask = 0
        for a, b in re.findall(r"(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?", dpart):
            i, j = DAYS.index(a), DAYS.index(b or a)
            k = i
            while True:
                mask |= 1 << k
                if k == j:
                    break
                k = (k + 1) % 7
        mask = mask or ALL_DAYS
        times = re.findall(r"(\d{1,2}):(\d\d)-(\d{1,2}):(\d\d)", rest)
        if re.sub(r"(\d{1,2}):(\d\d)-(\d{1,2}):(\d\d)|[,\s]", "", rest):
            return None  # (something else: sunrise, PH, months, "off")
        if not times:
            out.append([mask, 0, 1440])
        for h0, n0, h1, n1 in times:
            m0, m1 = int(h0) * 60 + int(n0), int(h1) * 60 + int(n1)
            if m1 <= m0:
                m1 += 1440
            m0 = min(m0, 1440)
            if m1 <= 1440:
                out.append([mask, m0, m1])
            else:  # (past midnight: its morning on the next day)
                if m0 < 1440:
                    out.append([mask, m0, 1440])
                nxt = ((mask << 1) | (mask >> 6)) & ALL_DAYS
                out.append([nxt, 0, min(1440, m1 - 1440)])
    return out or None


def timed_access(restrictions, t=0.5):
    """The times a segment is shut to cars at fraction t along it, as [[way, shut, windows], ...]:
    way 0 both ways, +1 for a car going with its points, -1 against them; shut 1 while the windows
    last (OSM's access=no @ (Mo-Fr 07:30-08:30), as Japan's school roads are in the morning), 0
    outside them (a street shut to cars but for their deliveries' hours, as Amsterdam's are)."""
    out, base = [], {0: False, 1: False, -1: False}
    def car_rule(w):
        return not (w.get("mode") and not MOTOR & set(w["mode"])) and not (w.get("using") or w.get("recognized") or w.get("vehicle"))
    rules = []
    for a in restrictions or []:
        w, b = a.get("when") or {}, a.get("between") or [0.0, 1.0]
        if not b[0] <= t <= b[1] or not car_rule(w):
            continue
        way = 1 if w.get("heading") == "forward" else -1 if w.get("heading") == "backward" else 0
        if not w.get("during"):
            if a.get("access_type") == "denied" and way == 0:
                base[0] = True
            continue
        win = windows(w["during"])
        if win is None or win == [[ALL_DAYS, 0, 1440]]:
            continue
        rules.append((a.get("access_type"), way, win))
    for kind, way, win in rules:
        if kind == "denied":
            out.append([way, 1, win])
        elif kind in ("allowed", "permissive", "delivery", "destination") and base[0]:
            out.append([way, 0, win])
    return out


def allowed_for_cars(w):
    """Does a rule with this `when` apply to cars, all the time?"""
    w = w or {}
    if w.get("mode") and not MOTOR & set(w["mode"]):
        return False
    return not (w.get("during") or w.get("using") or w.get("recognized") or w.get("vehicle"))


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


def piece_segment(line, segs, tree):
    """The segment a road piece was cut from: (index, same way round), by the segment nearest its
    points a quarter, half and three quarters along, or (None, True)."""
    votes = []
    for f in (0.25, 0.5, 0.75):
        p = line.interpolate(f, normalized=True)
        cand = [i for i in tree.query(p.buffer(1.5)) if segs[i][1].distance(p) < 1.5]
        if not cand:
            continue
        i = min(cand, key=lambda i: segs[i][1].distance(p))
        g = segs[i][1]
        a, b = line.interpolate(max(0.0, line.project(p) - 1.0)), line.interpolate(min(line.length, line.project(p) + 1.0))
        t = g.project(p)
        c, d = g.interpolate(max(0.0, t - 1.0)), g.interpolate(min(g.length, t + 1.0))
        votes.append((i, (b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y) >= 0))
    return max(set(votes), key=votes.count) if votes else (None, True)


def turns(C, con, roads, lines):
    """The banned turns, written on the road pieces as "nt" (see above); lines: each piece as a
    local LineString. Returns how many."""
    path = os.path.join(C.raw, "overture_segment.parquet")
    cols = [d[0] for d in con.execute(f"DESCRIBE SELECT * FROM '{path}'").fetchall()]
    if "prohibited_transitions" not in cols:
        print(f"  {path} has no prohibited_transitions: no banned turns (fetch it again with fetch_overture.py --only segment)")
        return 0
    segs, ids = [], {}
    for r in raw_rows(con, path, "id, class, subtype, connectors, prohibited_transitions, wkb"):
        if r["subtype"] == "road":
            ids[r["id"]] = len(segs)
            segs.append((r["id"], C.to_local(swkb.loads(bytes(r["wkb"]))), r["connectors"] or [], r["prohibited_transitions"] or []))
    tree = shapely.STRtree([g for _, g, _, _ in segs])
    by_seg, view = {}, [(None, g, None) for _, g, _, _ in segs]  # segment index -> [(piece, same way round)]
    for k, line in enumerate(lines):
        if line is None:
            continue
        i, same = piece_segment(line, view, tree)
        if i is not None:
            by_seg.setdefault(i, []).append((k, same))

    def connector_at(i, cid):
        """Where connector cid lies on segment i: its nearest vertex (connectors stand on vertices)."""
        g = segs[i][1]
        for c in segs[i][2]:
            if c["connector_id"] == cid:
                q = g.interpolate(c["at"] or 0.0, normalized=True)
                xy = np.asarray(g.coords)[:, :2]
                return xy[np.argmin(((xy - [q.x, q.y]) ** 2).sum(1))]
        return None

    def piece_end_at(k, xy):
        """The end of piece k at xy (0 its first point, 1 its last), within 3 m, or None."""
        cs = np.asarray(lines[k].coords)
        for e, q in ((0, cs[0]), (1, cs[-1])):
            if np.hypot(q[0] - xy[0], q[1] - xy[1]) < 3.0:
                return e
        return None

    for o in roads:
        o.pop("nt", None)
        o.pop("ntw", None)
    n = 0
    for i, (_, g, _, rules) in enumerate(segs):
        if not rules or i not in by_seg:
            continue
        for r in rules:
            w, seq = r.get("when") or {}, r.get("sequence") or []
            win = None
            if w.get("during") and allowed_for_cars({k: v for k, v in w.items() if k != "during"}):
                win = windows(w["during"])  # a turn banned at some hours: "ntw", with the times
                if win is None:
                    continue
            elif not seq or not allowed_for_cars(w):
                continue
            if not seq:
                continue
            j = ids.get(seq[-1]["segment_id"])
            x0, x1 = connector_at(i, seq[0]["connector_id"]), connector_at(j, seq[-1]["connector_id"]) if j is not None else None
            if x0 is None or x1 is None or j not in by_seg:
                continue
            for k, same in by_seg[i]:
                e = piece_end_at(k, x0)
                if e is None:
                    continue
                if w.get("heading") in ("forward", "backward") and (e == 1) != ((w["heading"] == "forward") == same):
                    continue  # the rule is for traffic going the other way along the segment
                for k2, same2 in by_seg[j]:
                    e2 = piece_end_at(k2, x1)
                    if e2 is None:
                        continue
                    if r.get("final_heading") in ("forward", "backward") and (e2 == 0) != ((r["final_heading"] == "forward") == same2):
                        continue  # into it the other way
                    if win:
                        ntw = roads[k].setdefault("ntw", [])
                        if [e, k2, e2, len(seq), win] not in ntw:
                            ntw.append([e, k2, e2, len(seq), win])
                            n += 1
                        continue
                    nt = roads[k].setdefault("nt", [])
                    if [e, k2, e2, len(seq)] not in nt:
                        nt.append([e, k2, e2, len(seq)])
                        n += 1
    return n


def signs(C, con, extent):
    """The signals and signs inside the extent, as local points: {class: [(x, y)]}."""
    out = {k: [] for k in SIGNS}
    path = os.path.join(C.raw, "overture_infrastructure.parquet")
    tags = "source_tags" in [d[0] for d in con.execute(f"DESCRIBE SELECT * FROM '{path}'").fetchall()]
    if not tags:
        print(f"  {path} has no source_tags: no crossings (fetch it again with fetch_overture.py --only infrastructure)")
    for r in raw_rows(con, path, "class, wkb" + (", source_tags" if tags else "")):
        k = crossing_kind(r.get("source_tags")) if r["class"] == "crossing" else r["class"]
        if k in out:
            q = C.to_local(swkb.loads(bytes(r["wkb"]))).centroid
            if extent.contains(q):
                out[k].append((q.x, q.y))
    return out


def piece_times(line, segs, tree):
    """The times a road piece is shut to cars ("tb": timed_access, its ways turned to the piece's
    points), by the segment nearest its middle; [] if none."""
    p = line.interpolate(0.5, normalized=True)
    cand = [i for i in tree.query(p.buffer(1.5)) if segs[i][1].distance(p) < 1.5]
    if not cand:
        return []
    i = min(cand, key=lambda i: segs[i][1].distance(p))
    g = segs[i][1]
    t = g.project(p)
    a, b = line.interpolate(max(0.0, line.project(p) - 1.0)), line.interpolate(min(line.length, line.project(p) + 1.0))
    c, d = g.interpolate(max(0.0, t - 1.0)), g.interpolate(min(g.length, t + 1.0))
    same = (b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y) >= 0
    return [[way if same else -way, shut, win] for way, shut, win in timed_access(segs[i][2], t / max(g.length, 1e-9))]


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
        n1 = n2 = 0
        lines = []
        for o in roads:
            p = np.array(o["p"], dtype=float).reshape(-1, 3)[:, :2] / 10
            lines.append(shapely.LineString(p) if len(p) > 1 else None)
            way = piece_way(lines[-1], segs, tree) if len(p) > 1 else 0
            o.pop("o", None)
            if way:
                o["o"] = way
                n1 += 1
            o.pop("tb", None)
            tb = piece_times(lines[-1], segs, tree) if len(p) > 1 else []
            tb = [r for r in tb if not (way and r[0] == -way)]  # (not the way no car goes anyway)
            if tb:
                o["tb"] = tb
                n2 += 1
        nt = turns(C, con, roads, lines)
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
        print(f"{cid}: {n1} of {len(roads)} road pieces one-way, {n2} shut to cars at some hours, {nt} banned turns; " + ", ".join(f"{len(v)} {k}" for k, v in found.items()))


if __name__ == "__main__":
    main(sys.argv[1:])
