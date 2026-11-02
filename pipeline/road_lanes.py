"""Real lane counts and lane arrows for a city's road pieces, from OpenStreetMap (ODbL).

Overture's segments carry neither OSM's `lanes` nor its `turn:lanes`, but each names the OSM ways
it was cut from (sources[].record_id, "w123@4": fetch_overture.py keeps them as `records`). This
script reads those ways' tags from the OSM API (api.openstreetmap.org, by id, a few hundred at a
time: the API's multi-fetch, not a bulk download) and writes onto each road piece in
web/data/<id>/game.json:

  "nl": n       lanes each way (1 or 2: the game drives at most two each way), where OSM tags them:
                a one-way road's `lanes`; a two-way road's `lanes:forward` and `lanes:backward`
                (the fewer of the two), or half its `lanes` less any `lanes:both_ways`
  "tl": [[end, "l|t|tr"], ...]
                the lane arrows of the traffic coming up to the piece's end (0 its first point, 1
                its last), one entry per OSM lane from left to right as the driver sees them,
                letters l (left, sharp or slight), t (through, or no marking) and r (right); only
                at an end where the OSM way itself ends (where its arrows are painted)

The traffic (web/game/junctions.js) reads the arrows: a movement goes from the lanes whose arrows show
its way. It doesn't read the counts yet (lanesOf keeps two each way on a main road, one elsewhere):
where the count changes from one piece to the next the cars' merging can't keep up, and Sydney's
jams under tools/traffic_check.js more than double. The tags are cached in data/raw/<id>/osm_ways.json.

    python pipeline/fetch_overture.py --city sydney --only segment   # with records
    python pipeline/road_lanes.py                  # every city with roads
    python pipeline/road_lanes.py sydney tokyo
"""
import json
import os
import sys
import time
import urllib.request

import duckdb
import numpy as np
import shapely
from shapely import wkb as swkb

from cityctx import City
from road_rules import piece_segment, raw_rows

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.openstreetmap.org/api/0.6"
UA = "open-earth-3d (https://github.com/Mira190/open-earth-3d)"
ARROW = {"left": "l", "sharp_left": "l", "slight_left": "l", "through": "t", "none": "t", "": "t",
         "right": "r", "sharp_right": "r", "slight_right": "r", "merge_to_left": "t", "merge_to_right": "t"}


def get(url):
    for k in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return json.load(urllib.request.urlopen(req, timeout=120))
        except Exception as e:  # (the API is busy now and then: wait and ask again)
            if k == 4:
                raise
            print(f"  {e}: again in {2 ** k} s")
            time.sleep(2 ** k)


def osm_ways(C, ids):
    """Tags and end nodes of OSM ways by id, cached: {id: {"tags": {...}, "ends": [[lon, lat], [lon, lat]]}}."""
    path = os.path.join(C.raw, "osm_ways.json")
    have = json.load(open(path)) if os.path.exists(path) else {}
    want = sorted({str(i) for i in ids} - set(have))
    for k in range(0, len(want), 400):
        part = want[k:k + 400]
        got = get(f"{API}/ways.json?ways={','.join(part)}")
        nodes = {}
        for e in got.get("elements", []):
            if not e.get("visible", True):
                have[str(e["id"])] = {"tags": {}, "nodes": []}
                continue
            t = {a: b for a, b in (e.get("tags") or {}).items() if a.startswith(("lanes", "turn:lanes", "oneway", "highway"))}
            have[str(e["id"])] = {"tags": t, "nodes": [e["nodes"][0], e["nodes"][-1]]}
            if any(a.startswith("turn:lanes") for a in t):
                nodes[e["nodes"][0]] = nodes[e["nodes"][-1]] = None
        # the end nodes of the ways with lane arrows (where the arrows are painted)
        nl = list(nodes)
        for q in range(0, len(nl), 400):
            for e in get(f"{API}/nodes.json?nodes={','.join(map(str, nl[q:q + 400]))}").get("elements", []):
                if "lon" in e:
                    nodes[e["id"]] = [e["lon"], e["lat"]]
        for i in part:
            w = have.get(i)
            if w is not None and w.get("nodes") and any(a.startswith("turn:lanes") for a in w["tags"]):
                w["ends"] = [nodes.get(w["nodes"][0]), nodes.get(w["nodes"][1])]
        print(f"  {min(k + 400, len(want))} of {len(want)} ways")
        time.sleep(1)
    json.dump(have, open(path, "w"))
    return have


def num(v):
    try:
        return int(str(v).split(";")[0])
    except (TypeError, ValueError):
        return None


def lanes_each_way(t, oneway):
    """Lanes each way from a way's tags, or None."""
    if oneway:
        return num(t.get("lanes"))
    f, b = num(t.get("lanes:forward")), num(t.get("lanes:backward"))
    if f and b:
        return min(f, b)
    n = num(t.get("lanes"))
    if n:
        return max(1, (n - (num(t.get("lanes:both_ways")) or 0)) // 2)
    return None


def arrows(v):
    """OSM's turn:lanes value as our letters per lane, 'l|t|tr', or None."""
    if v is None:
        return None
    out = []
    for lane in str(v).split("|"):
        s = "".join(sorted({ARROW.get(a.strip(), "") for a in lane.split(";")} - {""}, key="ltr".index))
        out.append(s or "t")
    return "|".join(out)


def main(cities):
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    for cid in cities or sorted(os.listdir(os.path.join(ROOT, "cities"))):
        out = os.path.join(ROOT, "web", "data", cid, "game.json")
        if not os.path.exists(out):
            continue
        game = json.load(open(out, encoding="utf8"))
        roads = (game.get("paths") or {}).get("road") or []
        C = City(cid)
        path = os.path.join(C.raw, "overture_segment.parquet")
        if not roads or not os.path.exists(path):
            print(f"{cid}: no roads or no {path}")
            continue
        cols = [d[0] for d in con.execute(f"DESCRIBE SELECT * FROM '{path}'").fetchall()]
        if "records" not in cols:
            raise SystemExit(f"{path} has no records: fetch it again (python pipeline/fetch_overture.py --city {cid} --only segment)")
        segs = []
        for r in raw_rows(con, path, "subtype, records, wkb"):
            if r["subtype"] != "road":
                continue
            ws = [int(x[1:].split("@")[0]) for x in (r["records"] or []) if x and x.startswith("w")]
            segs.append((ws, C.to_local(swkb.loads(bytes(r["wkb"]))), None))
        tree = shapely.STRtree([g for _, g, _ in segs])
        ways = osm_ways(C, {w for ws, _, _ in segs for w in ws})
        n_nl = n_tl = 0
        for o in roads:
            o.pop("nl", None)
            o.pop("tl", None)
            p = np.array(o["p"], dtype=float).reshape(-1, 3)[:, :2] / 10
            if len(p) < 2:
                continue
            line = shapely.LineString(p)
            i, same = piece_segment(line, segs, tree)
            if i is None or len(segs[i][0]) != 1:
                continue
            w = ways.get(str(segs[i][0][0]))
            if not w:
                continue
            t = w["tags"]
            n = lanes_each_way(t, bool(o.get("o")))
            if n:
                o["nl"] = max(1, min(2, n))
                n_nl += 1
            # the lane arrows at each end where the way ends: forward ones at the way's last node,
            # backward ones at its first; a one-way road's plain turn:lanes in its own direction
            tl = []
            for e in (0, 1):
                for wend, key in ((1, "turn:lanes:forward"), (0, "turn:lanes:backward")):
                    v = t.get(key)
                    if v is None and o.get("o") and t.get("turn:lanes"):
                        v = t["turn:lanes"] if (wend == 1) == (t.get("oneway") != "-1") else None
                    a, xy = arrows(v), (w.get("ends") or [None, None])[wend]
                    if not a or not xy:
                        continue
                    q = C.to_local(shapely.Point(*xy))
                    # this piece's end e is the way's end, and the traffic coming up to it goes the way's way
                    if np.hypot(*(p[-1 if e else 0] - [q.x, q.y])) < 6 and (e == 1) == (same == (wend == 1)):
                        tl.append([e, a])
            if tl:
                o["tl"] = tl
                n_tl += 1
        json.dump(game, open(out, "w"), separators=(",", ":"))   # as game_data.py writes it
        print(f"{cid}: lanes from OSM on {n_nl} of {len(roads)} road pieces ({sum(1 for o in roads if o.get('nl') == 2)} with two each way), lane arrows at {n_tl}")


if __name__ == "__main__":
    main(sys.argv[1:])
