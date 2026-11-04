"""Roads the data runs into a building or a canopy's post: a way through for the traffic.

    xvfb-run -a node tools/road_walls.js osaka --json /tmp/osaka_walls.json   # the game's own cuts
    python pipeline/road_passages.py --city osaka --walls /tmp/osaka_walls.json

The game's traffic drives a road only where a car fits along it (web/game/game.js cutAtWalls,
route.js): a road that runs into a wall ends there, and a car that comes up it on a one-way
street has nowhere to go. In the open data that happens where the two sources disagree by a
metre (a house's PLATEAU footprint over the edge of a lane in OpenStreetMap), where a road
really goes into or through a building (Osaka's OCAT bus terminal and Minatomachi River Place,
a road under a block), where an elevated road passes a building mapped across it, and where an
arcade over a street open to cars (an Osaka shotengai) stands on posts in the carriageway.

tools/road_walls.js lists each stretch where the game cuts a road, and each where a car doesn't
fit along it (route.js), with the points along it and what is in the way, measured by the game's
own collision (the floor under the road, decks).
For each building solid in such a stretch the road's corridor (its line, 4 m on at either
end, 1.3 m either side: room for a car on the road's line) is taken out of the footprint:
- where it only clips the footprint (what is left is one piece, the corridor takes at most a
  quarter of it, and no more than a metre deep of one high enough for a passage), the footprint
  stands back from the road: it is trimmed; not where a lane
  only too narrow for a car runs between buildings on both sides (an alley: it is that narrow);
- where the road goes into or through it and the building is high enough over the road
  (2.5 m of it over a 4.5 m clearance over the road's highest point in there), the corridor becomes a passage: the building is kept
  over it (and under it, for a road passing at a height), and the passage gets a ceiling
  (buildings.json "passages", web/buildings.js);
- where a main road (motorway to secondary) runs through a building too low for a passage, the
  footprint across it is taken to be wrong (a toll booth's canopy, an old outline): it is trimmed;
- otherwise (a lane through a row of low houses) nothing is changed: the road stays cut there,
  and the traffic keeps off it (web/game/route.js).
A canopy's post in the corridor is left out (buildings.json "no_posts", by building, the posts'
positions in decimetres; web/buildings.js canopyPosts). Landmarks are not touched.

A building with roads through it at two levels is carved for the lowest, and for the next when
the stretches are measured again (tools/road_passages.sh repeats until nothing changes).

A new piece keeps its building (style, windows, roof material); its facades' shopfronts follow
the edges they came from. Rewrites web/data/<city>/buildings.json in place; with the stretches
measured again afterwards, running it again changes nothing more.
"""
import argparse
import json
import os

import shapely
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import substring

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HW, EXT = 1.3, 4.0          # corridor half-width and the stretch extended at either end (m: a ramp down into a building is found a stretch at a time)
CLEAR, OVER = 4.5, 2.5      # a passage's clearance over the road, and the building it needs over that (m)
UNDER = 2.5                 # a building kept under an elevated road passing through it (m of it)
TRIM_SHARE = 0.25           # the most of a footprint a trim takes
SLIVER = 1.0                # a trim goes no deeper into a building high enough for a passage (m)
MAJOR = {"motorway", "trunk", "primary", "secondary"}  # roads that win over a low building mapped across them


def ring_of(r):
    return [(r[k] / 10, r[k + 1] / 10) for k in range(0, len(r), 2)]


def dm_ring(coords):
    c = list(coords)[:-1]
    return [round(v * 10) for xy in c for v in xy]


def polygon_of(s):
    try:
        P = Polygon(ring_of(s[4]), [ring_of(h) for h in s[5:] if len(h) >= 6])
        return P if P.is_valid else P.buffer(0)
    except ValueError:
        return None


def pieces(g):
    if g.is_empty:
        return []
    gs = list(g.geoms) if hasattr(g, "geoms") else [g]
    return [p for p in gs if isinstance(p, Polygon) and p.area >= 1.0]


def solid_of(p, base, lo, hi, bi):
    p = shapely.geometry.polygon.orient(p.simplify(0.05), 1.0)
    return [bi, base, lo, hi, dm_ring(p.exterior.coords)] + [dm_ring(h.coords) for h in p.interiors if len(h.coords) >= 4]


def fronts_for(old_ring, old_flags, new_ring):
    """Shopfront flags on the edges of new_ring that lie along a flagged edge of old_ring."""
    if not old_flags:
        return []
    o, n, out = ring_of(old_ring), ring_of(new_ring), []
    for k in range(len(n)):
        a, b = n[k], n[(k + 1) % len(n)]
        for e, fl in old_flags.items():
            c, d = o[e], o[(e + 1) % len(o)]
            seg = LineString([c, d])
            if seg.length > 0 and seg.distance(shapely.Point(a)) < 0.15 and seg.distance(shapely.Point(b)) < 0.15:
                out += [k, fl]
                break
    return out


def corridor(pts):
    line = LineString([(p[0], p[1]) for p in pts]) if len(pts) > 1 else shapely.Point(pts[0][0], pts[0][1]).buffer(0.01).exterior
    if isinstance(line, LineString) and line.length > 0 and len(pts) > 1:
        (x0, y0), (x1, y1) = line.coords[0], line.coords[1]
        (xa, ya), (xb, yb) = line.coords[-2], line.coords[-1]
        def ext(px, py, qx, qy):
            d = max(1e-6, ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5)
            return (px + (px - qx) / d * EXT, py + (py - qy) / d * EXT)
        line = LineString([ext(x0, y0, x1, y1)] + list(line.coords) + [ext(xb, yb, xa, ya)])
    return line.buffer(HW, cap_style="flat" if len(pts) > 1 else "round")


def carve(out_dir, walls):
    bpath = os.path.join(out_dir, "buildings.json")
    B = json.load(open(bpath, encoding="utf8"))
    S = B["s"]
    by_bi = {}
    for i, s in enumerate(S):
        by_bi.setdefault(s[0], []).append(i)
    roof = {r[0]: r for r in B.get("r", [])}
    fronts = {f[0]: f for f in B.get("f", [])}
    passages = set(B.get("passages", []))
    no_posts = B.get("no_posts", {})
    hidden = set()
    sp = os.path.join(out_dir, "scene.json")
    if os.path.exists(sp):
        hidden = set(json.load(open(sp, encoding="utf8")).get("hidden_solids") or [])
    # each solid's corridors, with the road's height along them
    want = {}
    n_post = 0
    for w in walls:
        pts = w.get("pts") or []
        if not pts:
            continue
        z, ztop = min(p[2] for p in pts), max(p[2] for p in pts)  # (a ramp: the clearance over its highest point in there)
        major = w.get("c") in MAJOR
        # (a lane too narrow for a car between buildings on both sides, an alley: it really is that narrow,
        # and the traffic keeps off it; a footprint that clips it on one side only stands back from it)
        sides, line = set(), LineString([(p[0], p[1]) for p in pts]) if len(pts) > 1 else None
        if w.get("room") and line is not None:
            for h in w["hits"]:
                for si in by_bi.get(h["id"], []) if h["kind"] == "building" else []:
                    P = polygon_of(S[si]) if S[si] else None
                    if P is None or P.distance(line) > HW:
                        continue
                    c = P.intersection(line.buffer(HW)).representative_point()
                    t = line.project(c)
                    a, b = line.interpolate(max(0, t - 0.5)), line.interpolate(min(line.length, t + 0.5))
                    cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
                    if abs(cross) > 1e-3:
                        sides.add(cross > 0)
        trim_ok = not w.get("room") or major or len(sides) < 2
        for h in w["hits"]:
            if h["kind"] == "post":
                lst = no_posts.setdefault(str(h["id"]), [])
                key = [round(h["x"] * 10), round(h["y"] * 10)]
                if not any(abs(lst[i] - key[0]) <= 2 and abs(lst[i + 1] - key[1]) <= 2 for i in range(0, len(lst), 2)):
                    lst += key
                    n_post += 1
                continue
            if h["kind"] != "building":
                continue
            for si in by_bi.get(h["id"], []):
                s = S[si]
                if si in hidden or abs((s[1] + s[2]) / 10 - h["zlo"]) > 0.15 or abs((s[1] + s[3]) / 10 - h["zhi"]) > 0.15:
                    continue
                want.setdefault(si, []).append((corridor(pts), z, major, trim_ok, ztop))
    n_trim = n_pass = n_left = n_later = 0
    new_solids, new_fronts = [], []
    for si, cs in sorted(want.items()):
        s = S[si]
        P = polygon_of(s)
        if P is None or P.is_empty:
            continue
        bi, base, lo, hi = s[0], s[1], s[2], s[3]
        g0 = base / 10
        # (roads through it at more than one level, an elevated road over a street: the lowest now, the next
        # when it is measured again, through the pieces this leaves)
        z = min(c[1] for c in cs)
        later = [c for c in cs if c[1] > z + 3]
        cs = [c for c in cs if c[1] <= z + 3]
        n_later += bool(later)
        C = shapely.unary_union([c[0] for c in cs])
        ztop = max(c[4] for c in cs)
        major = any(c[2] for c in cs)
        trim_ok = all(c[3] for c in cs)
        cut, rest = P.intersection(C), P.difference(C)
        if cut.area < 0.05:
            continue
        rp = pieces(rest)
        r = roof.get(si)
        top_walls = r[2] if r else hi  # (a pitched roof: the walls end at its eaves, the roof drawn over all of it)
        over = g0 + top_walls / 10 - (ztop + CLEAR)
        # how far into the footprint the road goes: the deepest point of what it takes from it
        depth = max((P.boundary.distance(shapely.Point(q)) for g in pieces(cut) or [cut] if hasattr(g, "exterior") for q in g.exterior.coords), default=0.0)
        if len(rp) <= 1 and cut.area <= TRIM_SHARE * P.area and trim_ok and (depth <= SLIVER or over < OVER):
            kind = "trim"
        elif over >= OVER:
            kind = "pass"
        elif major:
            kind = "trim"  # (a main road is not built through a low building: the footprint across it is wrong)
        else:
            n_left += 1
            continue
        if kind == "pass":  # (a sliver left beside the passage, by the road: part of what stands over it, not a needle up the building)
            thin = [q for q in rp if q.area < 6 or 2 * q.area / q.length < 1.2]
            if thin:
                rp = [q for q in rp if q not in thin]
                cut = shapely.unary_union([cut] + thin)
        old_flags = {}
        if si in fronts:
            f = fronts[si]
            old_flags = {f[k]: f[k + 1] for k in range(1, len(f), 2)}
        old_ring = s[4]
        if rp:
            first = solid_of(rp[0], base, lo, hi, bi)
            S[si] = first
            if si in fronts:
                fronts[si][1:] = fronts_for(old_ring, old_flags, first[4])
            for p in rp[1:]:
                ns = solid_of(p, base, lo, hi, bi)
                new_solids.append(ns)
                ff = fronts_for(old_ring, old_flags, ns[4])
                if ff:
                    new_fronts.append((len(S) + len(new_solids) - 1, ff))
        if kind == "pass":
            for p in pieces(cut):
                parts = [(solid_of(p, base, max(lo, round((ztop + CLEAR - g0) * 10)), top_walls, bi), True)]
                if (z - 0.3) - (g0 + lo / 10) >= UNDER:  # a road at a height through it: the building under the road too
                    parts.append((solid_of(p, base, lo, round((z - 0.3 - g0) * 10), bi), False))
                for ns, ceiling in parts:
                    if not rp:  # (nothing left beside the road: the first piece takes the solid's own place, its key)
                        S[si] = ns; rp = [None]
                        if ceiling:
                            passages.add(si)
                        continue
                    new_solids.append(ns)
                    if ceiling:
                        passages.add(len(S) + len(new_solids) - 1)
            n_pass += 1
        else:
            n_trim += 1
        if si in fronts:
            fronts[si][1:] = fronts_for(old_ring, old_flags, S[si][4])
    if not (n_trim or n_pass or n_post):
        print(f"  nothing to change ({n_left} roads through low buildings left as they are)")
        return
    S += new_solids
    for idx, ff in new_fronts:
        B.setdefault("f", []).append([idx] + ff)
    if passages:
        B["passages"] = sorted(passages)
    if no_posts:
        B["no_posts"] = no_posts
    with open(bpath, "w") as f:
        json.dump(B, f, separators=(",", ":"))
    print(f"  {n_trim} footprints stood back from a road, {n_pass} passages for a road through a building, "
          f"{n_post} canopy posts out of a carriageway; {n_left} roads through low buildings left as they are"
          + (f"; {n_later} with a road at another level through them, for the next pass" if n_later else ""))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--city", required=True)
    ap.add_argument("--walls", required=True, help="tools/road_walls.js --json output for the city")
    a = ap.parse_args()
    print(a.city)
    carve(os.path.join(ROOT, "web", "data", a.city), json.load(open(a.walls, encoding="utf8")))


if __name__ == "__main__":
    main()
