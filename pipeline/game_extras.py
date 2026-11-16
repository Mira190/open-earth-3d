"""Refresh what a city's landmark builders give its game, in a built web/data/<city>/game.json, without
the raw downloads a full pipeline/game_data.py run needs: the walkable surfaces (city.py
game_surfaces(scene)), and the spots to look at closely, the conversations to overhear and the things
to walk up to and the lifts (city.json game "spots", "chatter", "close", "lifts", then city.py game_extras(scene)). They are
built from scene.json alone, so a change to a builder lands in the game in seconds.

  close   things people come to see up close, each {name, at: [x, y, z], from: [x, y], within, keep}:
          a point on the thing at the height of the floor before it, where a walker starts towards it,
          how near they must get (1.5 m unless given) and how near they cannot (its half-thickness);
          tools/game_check.js walks up to each (tools/close_step.js). A spot's own "reach" lists the
          same for the thing it is about, and its "look" frames the look closer (web/game/places.js).
  doors   doors that open as someone comes up to them, and interiors, the rooms behind them (web/game/doors.js)
  keep_off  where walkers keep off without a word, rings [x, y, ...] in decimetres: a landmark's water
          that the city's water leaves out, such as a temple's moat (web/game/nav.js)
  foot    a builder's own footways, [[x, y, z], ...] in metres: a way through a hall that the map has no line in. Each
          end is carried on to the nearest mapped footway within 40 m, so the crowd and the gold line take it
  posts   what a landmark stands where the map's footways run, [[x, y(, radius)], ...] in metres (a canopy's row of
          posts along a station's front, a bench, a bollard): the footways bend round each, 0.75 m clear of it (a walker's shoulder and the collision world's cell),
          and one that ends at one stops short of it
  trains  a railway's tracks, its station and what runs on them (web/game/trains.js), and "travel", the
          builders' places to travel to (a platform)

    python pipeline/game_extras.py --city shibuya     # after landmarks.py; game_data.py does the same
"""
import json
import math
import os

import bridges
from cityctx import city_args

KEYS = ("spots", "chatter", "close", "keep_off", "lifts", "doors", "interiors", "seats", "shows")  # (city.json's own first, then the builders')
WHOLE = ("trains",)   # a builder's whole block (cities/tokyo/rail.py: the railway's tracks and services, web/game/trains.js)


def apply(C, scene, out):
    """Set out's surfaces and KEYS from the city's hooks and city.json, as game_data.py builds them."""
    gcfg = C.cfg.get("game", {})
    hook = C.hook("game_surfaces")
    out["surfaces"] = ((hook(scene) if hook else []) + bridges.surfaces(scene)   # and the bridges over the water (bridges.py)
                       + [s for s in out.get("surfaces", []) if s.get("outpost")])  # and an outpost's wharf (pipeline/outposts.py)
    for k in KEYS:
        out.pop(k, None)
        if k in gcfg:
            out[k] = list(gcfg[k])
    if C.hook("game_extras"):
        extras = C.hook("game_extras")(scene)
        if extras.get("closed"):   # walls a landmark stands on the crowd's footways: the footways stop at them
            clip_closed(out, extras["closed"])
        own_foot(out, extras.get("foot", []))
        bend_round(out, extras.get("posts", []))
        # a builder's own fine walking levels (game.json "patches", each with an "id"): laid in place of the one of that id
        if extras.get("patches"):
            ids = {p["id"] for p in extras["patches"]}
            out["patches"] = [p for p in out.get("patches", []) if p.get("id") not in ids] + extras["patches"]
        for k, v in extras.items():
            if k in KEYS:
                out[k] = out.get(k, []) + v
            elif k in WHOLE:
                out[k] = v
            elif k == "travel":   # a builder's places to travel to, after the city's own (game_data.py gives those their ground)
                ids = {t["id"] for t in v}
                out[k] = [t for t in out.get(k, []) if t["id"] not in ids] + v
    # the NPCs placed as given (at [x, y, z]: up on a deck, in a room, seated at a table) need no raw data, so they are
    # put in here too: replaced in place by id, the new ones after the rest
    given = [n for n in gcfg.get("npcs", []) if len(n.get("at", [])) > 2]
    if given and "npcs" in out:
        by = {n["id"]: n for n in given}
        out["npcs"] = [by.pop(n["id"], n) for n in out["npcs"]] + list(by.values())
    drop_kept_off(out)
    return out


def clip_closed(out, rings):
    """Cut the crowd's footways where a landmark has built walls across them (a hook's "closed": rings [[x, y], ...] in
    metres: Tokyo Station's building but for its halls and passages): each footway keeps its parts outside, 2 m and
    longer, with its own heights. The map's footways run through a station's rooms in every direction; a walker follows
    them, and walked through the walls. Returns how many footways were cut."""
    import numpy as np
    import shapely
    from shapely.geometry import LineString, Point, Polygon
    # (a ring, or {"ring", "holes"}: a closed area with open courts in it)
    area = shapely.union_all([Polygon(r["ring"], r.get("holes", [])).buffer(0) if isinstance(r, dict) else Polygon(r).buffer(0) for r in rings if len(r) > 2 or isinstance(r, dict)])
    if area.is_empty or "paths" not in out:
        return 0
    shapely.prepare(area)
    keep, cut = [], 0
    for f in out["paths"].get("foot", []):
        P = np.asarray(f["p"], float).reshape(-1, 3) / 10
        line = LineString(P[:, :2]) if len(P) > 1 else None
        if line is None or line.length < 0.1 or not line.intersects(area) or line.intersection(area).length < 0.5:
            keep.append(f)
            continue
        cut += 1
        s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P[:, :2], axis=0), axis=1))])
        rest = line.difference(area)
        for piece in getattr(rest, "geoms", [rest]):
            if piece.geom_type != "LineString" or piece.length < 2.0:
                continue
            q = [(x, y, float(np.interp(line.project(Point(x, y)), s, P[:, 2]))) for x, y in piece.coords]
            keep.append(dict(f, p=[int(round(v * 10)) for pt in q for v in pt]))
    out["paths"]["foot"] = keep
    return cut


def own_foot(out, lines, reach=40.0):
    """Lay a builder's own footways (a hook's "foot": [[x, y, z], ...] in metres) among the crowd's, in place of the
    ones laid before ("own"): each end carried on in a straight line to the nearest point of a mapped footway within
    `reach` m and a storey of its height, unless its last stretch crosses one already. Returns how many were laid."""
    import numpy as np
    from shapely.geometry import LineString, Point
    if "paths" not in out:
        return 0
    foot = [f for f in out["paths"].get("foot", []) if not f.get("own")]
    mapped = []
    for f in foot:
        P = np.asarray(f["p"], float).reshape(-1, 3) / 10
        if len(P) > 1:
            mapped.append((LineString(P[:, :2]), P))
    for pts in lines:
        pts = [tuple(float(v) for v in q) for q in pts]
        for end in (0, -1):
            x, y, z = pts[end]
            last = LineString([pts[end][:2], pts[1 if end == 0 else -2][:2]])
            if any(g.intersects(last) for g, _ in mapped):   # (it crosses a mapped footway on its way there: joined)
                continue
            best = None
            for g, P in mapped:
                d = g.distance(Point(x, y))
                if d < (best[0] if best else reach):
                    q = g.interpolate(g.project(Point(x, y)))
                    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P[:, :2], axis=0), axis=1))])
                    zq = float(np.interp(g.project(q), s, P[:, 2]))
                    if abs(zq - z) < 2.5:
                        best = (d, (q.x, q.y, zq))
            if best and best[0] > 0.3:
                pts = [best[1]] + pts if end == 0 else pts + [best[1]]
        foot.append({"c": "footway", "own": 1, "p": [int(round(v * 10)) for q in pts for v in q]})
    out["paths"]["foot"] = foot
    return len(lines)


def bend_round(out, posts, room=0.75, reach=2.4):
    """Bend the crowd's footways round what a landmark stands on them (a hook's "posts": [[x, y(, radius)], ...] in
    metres, radius 0.1 unless given): where a line comes within `room` of a post's edge it is sampled every half metre
    for `reach` either side and moved sideways, all to the side most of it already passes on, until every post is
    `room` away. The rest of it stays where it was; an end that stands that near a post is cut back until it is clear.
    Returns how many footways were bent."""
    import numpy as np
    from shapely.geometry import LineString, MultiPoint, Point
    if not posts or "paths" not in out:
        return 0
    Q = np.asarray([[q[0], q[1]] for q in posts], float)
    CL = np.asarray([(q[2] if len(q) > 2 else 0.1) + room for q in posts], float)
    clear = float(CL.max())
    cloud = MultiPoint([tuple(q) for q in Q])
    # (0.15 m of slack: a line bent once, sampled every half metre and kept to the decimetre, is not bent again)
    hit = lambda g: any(g.distance(Point(*q)) < c - 0.15 for q, c in zip(Q, CL))
    bent = 0
    for f in out["paths"].get("foot", []):
        P = np.asarray(f["p"], float).reshape(-1, 3) / 10
        if len(P) < 2:
            continue
        line = LineString(P[:, :2])
        if line.length < 0.5 or line.distance(cloud) >= clear or not hit(line):
            continue
        # an end at a post: cut back, a vertex at a time, then to the point half a metre before the post's reach
        for end in (0, -1):
            while len(P) > 2 and hit(Point(*P[end, :2])):
                P = P[1:] if end == 0 else P[:-1]
        f["p"] = [int(round(v * 10)) for q in P for v in q]
        line = LineString(P[:, :2])
        if line.length < 0.5 or not hit(line):
            bent += 1
            continue
        sel = [line.distance(Point(*q)) < clear + 3.0 for q in Q]   # (and the next row it would be moved into)
        near, ncl = Q[sel], CL[sel]
        s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P[:, :2], axis=0), axis=1))])
        hits = sorted(line.project(Point(*q)) for q, c in zip(near, ncl) if line.distance(Point(*q)) < c)
        # the stretches to resample: `reach` either side of each post, merged, kept off the line's two ends
        spans = []
        for h in hits:
            a, b = max(0.3, h - reach), min(line.length - 0.3, h + reach)
            if b - a < 0.5:
                continue
            if spans and a <= spans[-1][1] + 0.5:
                spans[-1][1] = b
            else:
                spans.append([a, b])
        if not spans:
            continue
        at = lambda d: np.array(line.interpolate(d).coords[0])
        nrm = lambda d: (lambda t: np.array([-t[1], t[0]]) / (np.linalg.norm(t) or 1.0))(at(min(line.length, d + 0.25)) - at(max(0.0, d - 0.25)))
        side = 1.0 if sum(float((at(h) - q) @ nrm(h)) for q, c in zip(near, ncl) if line.distance(Point(*q)) < c for h in [line.project(Point(*q))]) >= 0 else -1.0
        pts = []   # (distance along, x, y)
        for k in range(len(P)):
            if not any(a < s[k] < b for a, b in spans):
                pts.append((s[k], *P[k, :2]))
        for a, b in spans:
            n = max(2, int(round((b - a) / 0.5)))
            for d in np.linspace(a, b, n + 1):
                c, nn = at(d), nrm(d) * side
                need = 0.0
                for _ in range(6):   # (past one post, then past the next it would then stand at)
                    was = need
                    for q, cl in zip(near, ncl):
                        along, lat = float((q - c) @ np.array([nn[1], -nn[0]])), float((q - c) @ nn)
                        if abs(along) < cl and (lat - need) ** 2 + along * along < cl * cl:
                            need = lat + math.sqrt(cl * cl - along * along) + 0.08   # (and the data's decimetre)
                    if need == was:
                        break
                # (back onto the line at the stretch's ends, but for one at the line's own end: its last vertex stays)
                ease = min(1.0, (d - a) / 0.8 if a > 0.31 else 1.0, (b - d) / 0.8 if b < line.length - 0.31 else 1.0)
                c = c + nn * max(0.0, need) * max(0.0, ease) if need > 0 else c
                pts.append((float(d), float(c[0]), float(c[1])))
        pts.sort()
        pts = [q for k, q in enumerate(pts) if k == 0 or math.hypot(q[1] - pts[k - 1][1], q[2] - pts[k - 1][2]) > 0.06 or k == len(pts) - 1]   # (no point twice)
        f["p"] = [int(round(v * 10)) for d, x, y in pts for v in (x, y, float(np.interp(d, s, P[:, 2])))]
        bent += 1
    return bent


def drop_kept_off(out):
    """Drop the crowd's footways that cross a keep_off area (a door's link over a moat); returns how many."""
    if not out.get("keep_off") or "paths" not in out:
        return 0
    import numpy as np
    import shapely
    from shapely.geometry import LineString, Polygon
    area = shapely.union_all([Polygon(np.asarray(r, float).reshape(-1, 2) / 10) for r in out["keep_off"]])
    shapely.prepare(area)
    foot = out["paths"].get("foot", [])
    keep = [f for f in foot if len(f["p"]) < 6 or LineString(np.asarray(f["p"], float).reshape(-1, 3)[:, :2] / 10).intersection(area).length < 0.5]
    out["paths"]["foot"] = keep
    return len(foot) - len(keep)


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    scene = json.load(open(os.path.join(C.out, "scene.json")))
    path = os.path.join(C.out, "game.json")
    game = json.load(open(path))
    apply(C, scene, game)
    json.dump(game, open(path, "w"), separators=(",", ":"))
    print(f"{path}: {len(game['surfaces'])} surfaces, " + ", ".join(f"{len(game.get(k, []))} {k}" for k in KEYS))


if __name__ == "__main__":
    main()
