"""Ways through a landmark: building passages, arches and covered ways the game walks and drives.

    python pipeline/landmark_passages.py --city amsterdam      # or --city all; --survey: list only

OpenStreetMap maps a road, a cycle path or a footway that runs through a building as a way with
tunnel=building_passage (the Rijksmuseum's cycle passage, a gatehouse's arch, the road under the
Louvre's Pavillon Richelieu), and one under a roof open at the sides with covered=yes (an arcade,
a colonnade). Overture flags both on its segments (is_tunnel, is_covered) and names the OSM ways
they were cut from; game_data.py drops every piece flagged is_tunnel (the city's road and rail
tunnels, which the game doesn't model), and with it these passages.

This script finds, for each city with a game, the Overture segments flagged is_tunnel or
is_covered whose OSM way is tagged tunnel=building_passage or covered=yes (the tags read from the
OSM API by id, cached in data/raw/<id>/osm_passages.json), and keeps the parts of them that pass
under a landmark's mesh (web/data/<id>/landmarks.json: a triangle of it 2.2 m or more over the
ground there), all of it at the ground (not a deck's or a bridge's walkway). A way that runs on into
the landmark's inside (INSIDE: a museum's doors into its hall) is not a way through and is left out.
Each passage is

- listed in landmarks.json "passages": [{osm, name, class, kind, w, floor, pts}]: its points every
  2 m or so at its floor ([x, y, z], m), its width w (OSM's width tag, else 3 m for a footway, 4 m
  for a cycle path or a pedestrian street, 6.5 m for a road). Its floor is the landmark's own where
  the landmark draws one over the way (a gate's stone platform, a passage's paving), else the ground;
  through a building whose bare-earth model departs from the line between the ground at the passage's
  two ends by more than DIP, that line, and then "floor" is true: web/game/nav.js takes the passage's
  floor for the ground in its corridor (the walker, the traffic, the camera);
- put back in web/data/<id>/game.json's paths where game_data.py dropped it as a tunnel (a footway,
  a cycle path or a road with its class, speed and one-way rule as game_data.py writes them, marked
  "lp"; appended, so that no other piece's index moves);
- marked "open": false with what it needs where the landmark's model does not open it yet (NOT_YET);
- printed with the clearance the landmark leaves over it (the lowest mesh over its floor; 2.2 m means
  a wall), so that a landmark that draws no opening there can be given one (cities/<id>/city.py).

The survey (--survey) prints the passages without writing anything. tools/passage_check.js walks
each opening end to end in the game.
"""
import argparse
import base64
import json
import math
import os
import sys
import time
import urllib.request

import duckdb
import numpy as np
import shapely
from shapely import wkb as swkb
from shapely.geometry import LineString, Point
from shapely.ops import substring

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cityctx import City  # noqa: E402
import road_rules  # noqa: E402
from game_data import FOOT, ROAD, level_of, strip_height  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.openstreetmap.org/api/0.6"
UA = "open-earth-3d (https://github.com/Mira190/open-earth-3d)"
WIDTH = {"footway": 3.0, "path": 3.0, "steps": 3.0, "pedestrian": 4.0, "cycleway": 4.0}  # else a road's 6.5 m
OVER = 2.2      # a mesh this high over the ground or more stands over the way
SHARE = 0.5     # the least share of a passage's length under a landmark (less: a sign or an awning over a street)
COVERED = ("yes", "arcade", "colonnade")
# ways that run on into a landmark's inside (its halls, which are not modelled), not through it: OSM way -> where
INSIDE = {"593157575": "the Rijksmuseum's doors from the passage into its hall",
          "335101059": "into the Eiffel Tower's north pillar, to its lifts and stairs",
          "1460593031": "Saint-Sulpice's south-west door, from its loggia into the church",
          "582149849": "between the Imperial Palace's halls (Kyoto), through their corridors, which are closed to visitors"}
# passages a landmark's model does not open yet: OSM way -> what it needs (listed with "open": false; tools/passage_walk.js
# reports them and does not count them blocked)
NOT_YET = {
    "1064828742": "Central Plaza (Hong Kong): the public way through its ground floor; the tower is drawn as one glass prism",
    "1416961012": "the ICC and Elements (Hong Kong): the covered walk runs on into the mall's halls, which are not modelled",
    "1515285572": "Crown (Melbourne): the covered riverside walk under the complex's overhang; the model's wall stands on it",
}
DIP = 0.4       # the bare earth under a building this far off the line between a passage's two ends is a guess
CELL = 1.0      # the cells the landmarks' cover is read in (m)


def get(url):
    for k in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return json.load(urllib.request.urlopen(req, timeout=120))
        except Exception as e:  # (the API is busy now and then)
            if k == 4:
                raise
            print(f"  {e}: again in {2 ** k} s")
            time.sleep(2 ** k)


def osm_tags(C, ids):
    """{way id: tags} from the OSM API, cached in data/raw/<id>/osm_passages.json."""
    os.makedirs(C.raw, exist_ok=True)
    path = os.path.join(C.raw, "osm_passages.json")
    have = json.load(open(path)) if os.path.exists(path) else {}
    want = sorted({str(i) for i in ids} - set(have))
    for k in range(0, len(want), 300):
        part = want[k:k + 300]
        got = get(f"{API}/ways.json?ways={','.join(part)}")
        for e in got.get("elements", []):
            have[str(e["id"])] = e.get("tags") or {}
        for i in part:
            have.setdefault(i, {})
        time.sleep(1)
    json.dump(have, open(path, "w"))
    return have


def segments(C):
    """Overture's road segments in the city flagged is_tunnel or is_covered, cached in data/raw/<id>/overture_passages.json:
    [{class, wkt (local), ranges: [[a, b, tunnel]], osm: [way ids], acc, levels, bridges, speed}]."""
    path = os.path.join(C.raw, "overture_passages.json")
    if os.path.exists(path):
        return json.load(open(path))
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("CREATE OR REPLACE SECRET anon (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2');")
    w, s, e, n = C.cfg["bbox"]
    root = f"s3://overturemaps-us-west-2/release/{C.cfg['overture_release']}"
    q = f"""SELECT class, road_flags, access_restrictions, level_rules, speed_limits[1].max_speed.value,
        list_transform(sources, lambda s: s.record_id) AS records, ST_AsWKB(geometry) AS wkb
        FROM read_parquet('{root}/theme=transportation/type=segment/*', hive_partitioning=1)
        WHERE bbox.xmax > {w} AND bbox.xmin < {e} AND bbox.ymax > {s} AND bbox.ymin < {n} AND subtype = 'road'
        AND road_flags IS NOT NULL"""
    out = []
    for cls, flags, acc, lv, speed, recs, wkb in con.execute(q).fetchall():
        rng = []
        for f in flags or []:
            vals = f["values"] or []
            if "is_tunnel" in vals or "is_covered" in vals:
                b = f.get("between") or [0.0, 1.0]
                rng.append([float(b[0]), float(b[1]), "is_tunnel" in vals])
        osm = [r[1:].split("@")[0] for r in recs or [] if r and r.startswith("w")]  # (a segment can join several ways)
        if not rng or not osm:
            continue
        out.append({"class": cls, "wkt": C.to_local(swkb.loads(bytes(wkb))).wkt, "ranges": rng, "osm": osm,
                    "acc": json.loads(json.dumps(acc, default=str)) if acc else None,
                    "levels": json.loads(json.dumps(lv, default=str)) if lv else None,
                    "bridges": [[float((f.get("between") or [0, 1])[0]), float((f.get("between") or [0, 1])[1])] for f in flags or [] if "is_bridge" in (f["values"] or [])],
                    "speed": speed})
    os.makedirs(C.raw, exist_ok=True)
    json.dump(out, open(path, "w"))
    return out


class Terrain:
    """The game's ground (game.json terrain: 5 m, north-west first), bilinear."""

    def __init__(self, C, game):
        t = game["terrain"]
        self.z = np.frombuffer(base64.b64decode(t["data"]), dtype="<i2").astype(float).reshape(t["ny"], t["nx"]) * t["scale"]
        self.cell, self.x0, self.y1 = t["cell"], C.x0, C.y1

    def __call__(self, x, y):
        c = min(max((x - self.x0) / self.cell, 0), self.z.shape[1] - 1.001)
        r = min(max((self.y1 - y) / self.cell, 0), self.z.shape[0] - 1.001)
        c0, r0 = int(c), int(r)
        fc, fr = c - c0, r - r0
        Z = self.z
        return float(Z[r0, c0] * (1 - fc) * (1 - fr) + Z[r0, c0 + 1] * fc * (1 - fr) + Z[r0 + 1, c0] * (1 - fc) * fr + Z[r0 + 1, c0 + 1] * fc * fr)


def cover(lm, boxes):
    """The landmarks' cover, in CELL cells, within `boxes` ([(x0, y0, x1, y1)]): {(i, j): [(zlo, zhi, mesh name), ...]}."""
    cells = {}
    BX = np.asarray(boxes, float).reshape(-1, 4)
    for m in lm.get("meshes", []):
        mat = (lm.get("materials") or {}).get(m.get("material"), {})
        if mat.get("decal"):
            continue
        P = np.asarray(m["position"], float).reshape(-1, 3)
        idx = np.asarray(m["index"], dtype=np.int64).reshape(-1, 3)
        V = P[idx]  # (n, 3, 3)
        lo, hi = V[:, :, :2].min(1), V[:, :, :2].max(1)
        keep = np.zeros(len(idx), bool)
        for b in BX:
            keep |= (hi[:, 0] >= b[0]) & (lo[:, 0] <= b[2]) & (hi[:, 1] >= b[1]) & (lo[:, 1] <= b[3])
        idx = idx[keep]
        mine = {}
        for t in idx:
            A, B, Cc = P[t[0]], P[t[1]], P[t[2]]
            e = max(np.linalg.norm(B[:2] - A[:2]), np.linalg.norm(Cc[:2] - A[:2]), np.linalg.norm(Cc[:2] - B[:2]))
            n = max(1, int(math.ceil(e / (CELL * 0.7))))
            for i in range(n + 1):
                for j in range(n + 1 - i):
                    u, v = i / n, j / n
                    p = A * (1 - u - v) + B * u + Cc * v
                    k = (int(math.floor(p[0] / CELL)), int(math.floor(p[1] / CELL)))
                    q = mine.get(k)
                    if q:
                        q[0], q[1] = min(q[0], p[2]), max(q[1], p[2])
                    else:
                        mine[k] = [p[2], p[2]]
        for k, q in mine.items():
            cells.setdefault(k, []).append((q[0], q[1], m["name"]))
    return cells


def soffit(cells, x, y, floor):
    """(lo, name, top): the lowest landmark mesh in (x, y)'s cell reaching more than OVER above `floor` (from
    there up), and its mesh's name, or None, None; and the highest top of a mesh from 0.6 m under `floor` to 1.5 m
    over it (a floor the landmark draws: a platform, paving), or None."""
    lo, name, top = None, None, None
    for zl, zh, nm in cells.get((int(math.floor(x / CELL)), int(math.floor(y / CELL))), ()):
        if floor - 0.6 <= zh <= floor + 1.5:
            top = zh if top is None else max(top, zh)
        if zh > floor + OVER:
            z = max(zl, floor + OVER) if zl < floor + OVER else zl
            if lo is None or z < lo:
                lo, name = z, nm
    return lo, name, top


def passages(C, game, lm, tags, segs):
    """The parts of the building passages and covered ways that run under a landmark: [{...}]."""
    T = Terrain(C, game)
    todo = []
    for sg in segs:
        cls = sg["class"]
        ts = [tags.get(i) or {} for i in sg["osm"]]
        tg = next((t for t in ts if t.get("tunnel") == "building_passage"), None) or next((t for t in ts if t.get("covered") in COVERED), {})
        kind = "building_passage" if tg.get("tunnel") == "building_passage" else "covered" if tg.get("covered") in COVERED else None
        if kind is None or (cls not in FOOT and cls not in ROAD):
            continue
        osm = next((i for i, t in zip(sg["osm"], ts) if t is tg), sg["osm"][0])
        todo.append((sg, shapely.from_wkt(sg["wkt"]), tg, kind, osm))
    cells = cover(lm, [(g.bounds[0] - 3, g.bounds[1] - 3, g.bounds[2] + 3, g.bounds[3] + 3) for _, g, *_ in todo])
    x0, x1, y0, y1 = C.x0, C.x1, C.y0, C.y1
    extent = shapely.box(x0, y0, x1, y1)
    out = []
    for sg, g, tg, kind, osm in todo:
        for a, b, tunnel in sg["ranges"]:
            mid = (a + b) / 2
            if level_of(sg["levels"], mid) != 0 or any(p <= mid <= q for p, q in sg["bridges"]):
                continue  # a deck's covered walkway, a bridge's: on its deck, not under a landmark
            piece = substring(g, a, b, normalized=True) if (a, b) != (0.0, 1.0) else g
            piece = piece.intersection(extent)
            if piece.geom_type != "LineString" or piece.length < 3:
                continue
            piece = piece.simplify(0.5)
            n = max(2, int(piece.length / 0.5) + 1)
            under = []
            for k in range(n):
                q = piece.interpolate(k / (n - 1), normalized=True)
                z = T(q.x, q.y)
                lo, nm, top = soffit(cells, q.x, q.y, z)
                under.append((q.x, q.y, z, lo, nm, top))
            hit = [u for u in under if u[3] is not None]
            share = len(hit) / len(under)
            if len(hit) * piece.length / (n - 1) < 3.0 or share < SHARE:
                continue
            if osm in INSIDE:
                continue
            out.append({"osm": osm, "kind": kind, "class": cls_of(sg), "name": tg.get("name", ""), "width": tg.get("width"),
                        "line": piece, "under": under, "meshes": sorted({u[4] for u in hit}), "share": share,
                        "soffit": min(u[3] - u[2] for u in hit), "tunnel": tunnel, "seg": sg, "range": (a, b)})
    return out


def cls_of(sg):
    return sg["class"]


def num(v):
    try:
        return float(str(v).split()[0].replace(",", "."))
    except (TypeError, ValueError):
        return None


def floor_of(p, T, strips=()):
    """The passage's floor along its points ([[x, y, z]]) and whether nav.js should take it for the ground there.
    Where the landmark draws a floor over the way (a gate's stone platform, a passage's paving: the top of a
    mesh from 0.6 m under the ground to 1.5 m over it, with room over it, or a surface the game walks there, a
    flight of steps up to a portico: game.json surfaces) that floor; elsewhere the ground, but
    through a building (a building passage) where the bare-earth model under it departs from the line between
    the ground at its two ends by more than DIP (a guess under the solids: under the Rijksmuseum it dips 2 m)
    that line, and the ground there is the passage's floor (landmarks.json passages[].floor)."""
    U = p["under"]
    za, zb = T(*U[0][:2]), T(*U[-1][:2])
    line = [za + (zb - za) * k / max(1, len(U) - 1) for k in range(len(U))]
    dip = p["kind"] == "building_passage" and max(abs(u[2] - z) for u, z in zip(U, line)) > DIP
    out = []
    for (x, y, z, lo, nm, top), zl in zip(U, line):
        f = zl if dip else z
        hs = [h for st in strips if (h := strip_height(st, x, y)) is not None and f - 0.6 <= h <= f + 2.5]
        if hs:
            f = max(hs)  # a walked surface the city lays there (a flight of steps up to a portico, its floor)
        elif top is not None and f - 0.6 <= top <= f + 1.5 and (lo is None or lo - top > OVER):
            f = top  # the landmark's own floor
        out.append([x, y, f])
    return out, dip


def piece_of(p, pts):
    """A game.json path piece for a passage game_data.py dropped (as game_data.py writes them; "lp": put back here)."""
    sg, cls = p["seg"], p["class"]
    line = LineString([q[:2] for q in pts])
    n = max(2, int(line.length / 8) + 1)
    out = []
    for k in range(n):
        q = line.interpolate(k / (n - 1), normalized=True)
        j = min(range(len(pts)), key=lambda i: (pts[i][0] - q.x) ** 2 + (pts[i][1] - q.y) ** 2)
        out += [round(q.x * 10), round(q.y * 10), round(pts[j][2] * 10)]
    if cls in FOOT:
        return "foot", {"c": cls, "p": out, "lp": 1}
    v = (sg["speed"] or 0) / 3.6 or ROAD[cls]
    way = road_rules.oneway(sg["acc"], sum(p["range"]) / 2)
    return "road", {"c": cls, "v": round(min(v, ROAD[cls] + 3), 1), "p": out, **({"o": way} if way else {}), "lp": 1}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--city", default="all")
    ap.add_argument("--survey", action="store_true", help="list the passages, write nothing")
    a = ap.parse_args()
    ids = sorted(os.listdir(os.path.join(ROOT, "cities"))) if a.city == "all" else [a.city]
    for cid in ids:
        gp = os.path.join(ROOT, "web", "data", cid, "game.json")
        lp = os.path.join(ROOT, "web", "data", cid, "landmarks.json")
        if not (os.path.exists(gp) and os.path.exists(lp)):
            continue
        C = City(cid)
        game, lm = json.load(open(gp)), json.load(open(lp))
        if not lm.get("meshes"):
            continue
        segs = segments(C)
        tags = osm_tags(C, {i for s in segs for i in s["osm"]})
        ps = passages(C, game, lm, tags, segs)
        T = Terrain(C, game)
        print(f"{cid}: {len(segs)} tunnel or covered segments, {len(ps)} under a landmark")
        listed, added = [], {"foot": [], "road": []}
        for p in ps:
            pts, dip = floor_of(p, T, [st for st in game.get("surfaces", []) if st.get("type") == "strip"])
            z = [q[2] for q in pts]
            clear = min((u[3] - q[2] for u, q in zip(p["under"], pts) if u[3] is not None), default=None)
            back = p["tunnel"] and (p["class"] in FOOT or p["class"] in ROAD) and p["osm"] not in NOT_YET
            print(f"  w{p['osm']} {p['kind']} {p['class']} {p['name']!r} {p['line'].length:.0f} m, {100 * p['share']:.0f}% under "
                  f"{', '.join(p['meshes'][:4])}; floor {min(z):.1f}..{max(z):.1f}, clear {clear:.1f} m; "
                  f"{'put back in the paths' if back else 'in the paths'}; "
                  f"at {pts[0][0]:.0f},{pts[0][1]:.0f} -> {pts[-1][0]:.0f},{pts[-1][1]:.0f}")
            w = num(p["width"]) or WIDTH.get(p["class"], 6.5)
            step = max(1, len(pts) // max(2, int(p["line"].length / 2)))
            keep = pts[::step] + ([pts[-1]] if (len(pts) - 1) % step else [])
            listed.append({"osm": int(p["osm"]), "name": p["name"], "class": p["class"], "kind": p["kind"], "w": round(w, 1),
                           "floor": dip, **({"open": False, "needs": NOT_YET[p["osm"]]} if p["osm"] in NOT_YET else {}),
                           "pts": [[round(v, 2) for v in q] for q in keep]})
            if back:
                k, piece = piece_of(p, pts)
                added[k].append(piece)
        if a.survey:
            continue
        for k in ("foot", "road"):
            game["paths"][k] = [q for q in game["paths"][k] if not q.get("lp")] + added[k]
        if listed:
            lm["passages"] = listed
        else:
            lm.pop("passages", None)
        json.dump(game, open(gp, "w"), separators=(",", ":"))  # as game_data.py and landmarks.py write them
        json.dump(lm, open(lp, "w"), separators=(",", ":"))
        print(f"{cid}: {len(listed)} passages listed in landmarks.json, {len(added['foot'])} footways and {len(added['road'])} roads put back in game.json")


if __name__ == "__main__":
    main()
