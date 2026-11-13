"""Fishing spots (docs/FISHING.md): snap a city's spots to the water's edge and write what the game loads.

A city opts in with a "fishing" block in the "game" block of cities/<id>/city.json: the spots
(where people do fish from the shore, each with a source), the species of that water with their
legal lengths and when they bite, and the rigs. Cities without the block get nothing, and their
game never fetches a byte of this.

Writes
  - web/data/<id>/game.json "fishing": {"v", "file", "spots": [{"id", "name", "at", "h"}]}: only where the
    spots are, so the game can tell when you are near one without loading anything;
  - web/data/<id>/fishing.json: the rest (species, rigs, rules, notes, each spot's schools), fetched
    with web/game/fishing.js the first time you come within reach of a spot.

A spot's "at" in city.json is where people stand, to within a few tens of metres. It is moved to
the land cell on the water's edge nearest to it that has open water in front (the game's 5 m water
mask, the same one a walker stops at), "h" is the heading out over that water, and "schools" are
points in it within a cast where fish hold, placed by a fixed seed so every build agrees.

    python pipeline/fishing.py                 # every city with a fishing block
    python pipeline/fishing.py sydney          # these cities
    python pipeline/fishing.py --check         # exit 1 if a city's files are not what this would write

A reef or alpine site (web/reef/, no game.json) has its "fishing" block at the top of its city.json. Its spots
are a POI (where people stand; web/reef/fishing.js finds the water's edge from the model's ground at run time)
or a ship's deck ("vessel", "deck": carried with her), and its rules may name marine reserves, where the game
refuses a line: a reserve's "lonlat" boundary is projected into the site's frame and closed over land by
"land_xy". It writes web/data/<id>/fishing.json and a pointer in scene.json "fishing".
"""
import base64
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = 1
SNAP_M = 60.0        # how far a spot may be moved to reach the edge
FETCH_M = 30.0       # open water a spot needs in front of it
CAST_M = (7.0, 27.0)  # the nearest and furthest a cast lands (fishing.js casts the same range)
SPECIES_KEYS = ("id", "share", "name", "sci", "cm", "g_per_cm3", "legal", "fight", "bite", "when", "depth", "bottom", "rigs", "nibbles", "note", "look")


_GRIDS = {}


def _grid(game):
    """The water mask as rows of booleans and the terrain as rows of metres."""
    if id(game) in _GRIDS:
        return _GRIDS[id(game)]
    wm, t = game["water"], game["terrain"]
    raw = base64.b64decode(wm["bits"])
    water = [[(raw[(r * wm["nx"] + c) >> 3] >> (7 - ((r * wm["nx"] + c) & 7))) & 1 for c in range(wm["nx"])] for r in range(wm["ny"])]
    tb = base64.b64decode(t["data"])
    ground = lambda r, c: int.from_bytes(tb[2 * (r * t["nx"] + c):2 * (r * t["nx"] + c) + 2], "little", signed=True) * t["scale"]
    _GRIDS[id(game)] = (water, ground)
    return water, ground


def _rand(seed):
    """A small fixed generator (the same one the browser's modules use), so builds agree."""
    s = [seed & 0xFFFFFFFF]

    def nxt():
        s[0] = (s[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return s[0] / 4294967296
    return nxt


def clutter(game, places):
    """Where the benches, lamp posts and trees stand, on a 4 m grid: a spot keeps a cell clear of them,
    so nobody casts through a bench or with a trunk between them and the camera."""
    cells = set()
    for flat in (game.get("props") or {}).values():
        if isinstance(flat, list):
            for i in range(0, len(flat) - 2, 3):
                cells.add((int(flat[i] / 10 // 4), int(flat[i + 1] / 10 // 4)))
    for k in ("trees", "woods"):
        flat = (places or {}).get(k) or []
        for i in range(0, len(flat) - 3, 4):
            cells.add((int(flat[i] / 10 // 4), int(flat[i + 1] / 10 // 4)))
    return cells


def snap(game, frame, at, busy=frozenset()):
    """The edge cell nearest to `at` with open water in front and nothing standing in the way:
    (x, y, z, heading, fetch) or None."""
    water, ground = _grid(game)
    cell, nx, ny = game["water"]["cell"], game["water"]["nx"], game["water"]["ny"]
    x0, y1 = frame["x"][0], frame["y"][1]
    wet = lambda x, y: (lambda r, c: 0 <= r < ny and 0 <= c < nx and water[r][c])(int((y1 - y) // cell), int((x - x0) // cell))
    col, row, reach = int((at[0] - x0) // cell), int((y1 - at[1]) // cell), int(SNAP_M // cell)
    best = None
    for r in range(max(1, row - reach), min(ny - 1, row + reach + 1)):
        for c in range(max(1, col - reach), min(nx - 1, col + reach + 1)):
            if water[r][c] or not (water[r - 1][c] or water[r + 1][c] or water[r][c - 1] or water[r][c + 1]):
                continue
            cx, cy = x0 + (c + 0.5) * cell, y1 - (r + 0.5) * cell
            d = math.hypot(cx - at[0], cy - at[1])
            if d > SNAP_M:
                continue
            # (the 4 m cell and the eight round it: 4 to 8 m clear of a trunk, a bench or a post)
            if any((int(cx // 4) + i, int(cy // 4) + j) in busy for i in (-1, 0, 1) for j in (-1, 0, 1)):
                d += 2 * SNAP_M                       # only if nowhere within reach is clear
            # out over the water: away from the land round it, towards the water round it
            vx = vy = 0.0
            for rr in range(max(0, r - 8), min(ny, r + 9)):
                for cc in range(max(0, c - 8), min(nx, c + 9)):
                    if water[rr][cc]:
                        vx += cc - c
                        vy -= rr - r
            n = math.hypot(vx, vy)
            if n == 0:
                continue
            ux, uy = vx / n, vy / n
            fetch = 0.0
            for i in range(1, int(60 / 2.5) + 1):
                if wet(cx + ux * i * 2.5, cy + uy * i * 2.5):
                    fetch = i * 2.5
                elif i > 2:
                    break
            if fetch < FETCH_M:
                continue
            if best is None or d < best[0]:
                best = (d, cx, cy, max(0.0, ground(r, c)), math.atan2(ux, uy), fetch, math.hypot(cx - at[0], cy - at[1]))
    if not best:
        return None
    return {"at": [round(best[1], 1), round(best[2], 1)], "z": round(best[3], 2), "h": round(best[4], 3), "fetch_m": best[5], "moved_m": round(best[6], 1), "clear": best[0] < 2 * SNAP_M, "wet": wet}


def build(city, game=None):
    """(game.json's fishing block, fishing.json) for a city, or None when it has no fishing.
    game: the game data in hand, else web/data/<city>/game.json."""
    cfg_path = os.path.join(ROOT, "cities", city, "city.json")
    out = os.path.join(ROOT, "web", "data", city)
    if not os.path.exists(cfg_path) or (game is None and not os.path.exists(os.path.join(out, "game.json"))):
        return None
    F = (json.load(open(cfg_path, encoding="utf8")).get("game") or {}).get("fishing")
    if not F:
        return None
    if game is None:
        game = json.load(open(os.path.join(out, "game.json"), encoding="utf8"))
    frame = json.load(open(os.path.join(out, "scene.json"), encoding="utf8"))["frame"]
    pp = os.path.join(out, "places.json")
    busy = clutter(game, json.load(open(pp, encoding="utf8")) if os.path.exists(pp) else None)
    species = {s["id"] for s in F["species"]}
    rigs = {r["id"] for r in F["rigs"]}
    for s in F["species"]:
        for k in ("id", "name", "sci", "cm", "fight", "when", "rigs", "note"):
            if k not in s:
                raise SystemExit(f"{city}: species {s.get('id')} has no \"{k}\"")
        if not (s["cm"][0] < s["cm"][1] < s["cm"][2]):
            raise SystemExit(f"{city}: species {s['id']}: cm must be [smallest, usual, largest]")
        for r in s["rigs"]:
            if r not in rigs:
                raise SystemExit(f"{city}: species {s['id']} names a rig that is not listed: {r}")
    spots, pointers = [], []
    for i, sp in enumerate(F["spots"]):
        hit = snap(game, frame, sp["at"], busy)
        if not hit:
            raise SystemExit(f"{city}: no edge with {FETCH_M:.0f} m of open water within {SNAP_M:.0f} m of spot {sp['id']} at {sp['at']}")
        for k in sp.get("species", []):
            if k not in species:
                raise SystemExit(f"{city}: spot {sp['id']} names a species that is not listed: {k}")
        rnd, wet, schools = _rand(9000 + 77 * i + sum(map(ord, sp["id"]))), hit.pop("wet"), []
        if not hit.pop("clear"):
            print(f"{city}: {sp['id']}: no edge clear of trees, benches and posts within {SNAP_M:.0f} m; the nearest is used")
        for _ in range(60):
            if len(schools) == sp.get("schools", 3):
                break
            a, d = hit["h"] + (rnd() - 0.5) * 1.2, CAST_M[0] + 2 + rnd() * (CAST_M[1] - CAST_M[0] - 4)
            x, y = hit["at"][0] + math.sin(a) * d, hit["at"][1] + math.cos(a) * d
            if wet(x, y) and all(math.hypot(x - q[0], y - q[1]) > 6 for q in schools):
                schools.append([round(x, 1), round(y, 1)])
        spot = dict({k: v for k, v in sp.items() if k not in ("at", "schools")}, at=hit["at"], z=hit["z"], h=hit["h"], schools=schools)
        spots.append(spot)
        pointers.append({"id": sp["id"], "name": sp["name"], "at": hit["at"], "h": hit["h"]})
        print(f"{city}: {sp['id']} at {hit['at']} (moved {hit['moved_m']} m), heading {math.degrees(hit['h']):.0f}, {hit['fetch_m']:.0f} m of water, {len(schools)} schools")
    data = {"v": VERSION, "water": F["water"], "rules": F["rules"], "rigs": F["rigs"],
            "species": [{k: s[k] for k in SPECIES_KEYS if k in s} for s in F["species"]], "spots": spots, "sources": F.get("sources", [])}
    return {"v": VERSION, "file": "fishing.json", "spots": pointers}, data


def dump(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def apply(city, game=None, check=False):
    """Write a city's fishing files (or, with check, compare them). game: the game.json object in
    hand (pipeline/game_data.py and game_text.py pass theirs and write it themselves)."""
    built = build(city, game)
    out = os.path.join(ROOT, "web", "data", city)
    path = os.path.join(out, "fishing.json")
    if built is None:
        return None
    pointer, data = built
    if check:
        have = json.load(open(os.path.join(out, "game.json"), encoding="utf8")).get("fishing")
        ok = have == pointer and os.path.exists(path) and open(path, encoding="utf8").read() == dump(data)
        if not ok:
            print(f"{city}: fishing data is stale; run python pipeline/fishing.py {city} and python pipeline/pack.py {city}")
        return ok
    open(path, "w", encoding="utf8").write(dump(data))
    if game is not None:
        game["fishing"] = pointer
        return True
    gp = os.path.join(out, "game.json")
    text = open(gp, encoding="utf8").read()
    g = json.loads(text)
    if g.get("fishing") != pointer:
        g["fishing"] = pointer
        # game.json is written compact or spaced by the step that made it: keep its style
        open(gp, "w", encoding="utf8").write(json.dumps(g, ensure_ascii=False) if '": ' in text[:2000] else dump(g))
        print(f"{city}: game.json fishing block written; run python pipeline/pack.py {city}")
    return True


def build_reef(site):
    """(scene.json's fishing pointer, fishing.json) for a reef or alpine site, or None without a fishing block."""
    path = os.path.join(ROOT, "cities", site, "city.json")
    out = os.path.join(ROOT, "web", "data", site)
    if not os.path.exists(path) or not os.path.exists(os.path.join(out, "scene.json")) or os.path.exists(os.path.join(out, "game.json")):
        return None
    cfg = json.load(open(path, encoding="utf8"))
    F = cfg.get("fishing")
    if not F:
        return None
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from cityctx import City
    city = City(site)
    scene = json.load(open(os.path.join(out, "scene.json"), encoding="utf8"))
    pois = {p["id"]: p for p in scene.get("pois", [])}
    species, rigs = {s["id"] for s in F["species"]}, {r["id"] for r in F["rigs"]}
    for s in F["species"]:
        for r in s["rigs"]:
            if r not in rigs:
                raise SystemExit(f"{site}: species {s['id']} names a rig that is not listed: {r}")
    spots, pointers = [], []
    for sp in F["spots"]:
        for k in sp.get("species", []) + sp.get("only", []):
            if k not in species:
                raise SystemExit(f"{site}: spot {sp['id']} names a species that is not listed: {k}")
        spot = {k: v for k, v in sp.items() if k != "poi"}
        if "poi" in sp:
            p = pois.get(sp["poi"])
            if not p:
                raise SystemExit(f"{site}: spot {sp['id']} names an unknown POI: {sp['poi']}")
            spot["at"] = [p["x"], p["y"]]
        elif "vessel" not in sp:
            raise SystemExit(f"{site}: spot {sp['id']} has neither a POI nor a vessel")
        spot.setdefault("schools", [])
        spots.append(spot)
        pointers.append({k: spot[k] for k in ("id", "name", "at", "vessel") if k in spot})
    rules = json.loads(json.dumps(F["rules"]))
    for r in rules.get("reserves", []):
        xy = [[round(v, 1) for v in city.fwd.transform(lon, lat)] for lon, lat in r.pop("lonlat")]
        r["xy"] = xy + r.pop("land_xy", [])
    data = {"v": VERSION, "water": F["water"], "rules": rules, "rigs": F["rigs"],
            "species": [{k: s[k] for k in SPECIES_KEYS if k in s} for s in F["species"]], "spots": spots, "sources": F.get("sources", [])}
    return {"v": VERSION, "file": "fishing.json", "spots": pointers}, data


def apply_reef(site, check=False):
    built = build_reef(site)
    if built is None:
        return None
    pointer, data = built
    out = os.path.join(ROOT, "web", "data", site)
    path, sp = os.path.join(out, "fishing.json"), os.path.join(out, "scene.json")
    scene = json.load(open(sp, encoding="utf8"))
    if check:
        ok = scene.get("fishing") == pointer and os.path.exists(path) and open(path, encoding="utf8").read() == dump(data)
        if not ok:
            print(f"{site}: fishing data is stale; run python pipeline/fishing.py {site}")
        return ok
    open(path, "w", encoding="utf8").write(dump(data))
    if scene.get("fishing") != pointer:
        scene["fishing"] = pointer
        json.dump(scene, open(sp, "w", encoding="utf8"), indent=1)   # (as marine_meta.py writes it)
    print(f"{site}: {len(data['spots'])} spots, {len(data['species'])} species, {len(data['rules'].get('reserves', []))} reserves")
    return True


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check = "--check" in sys.argv
    cities = args or sorted(d for d in os.listdir(os.path.join(ROOT, "cities")) if os.path.exists(os.path.join(ROOT, "cities", d, "city.json")))
    bad = [c for c in cities if apply(c, check=check) is False or apply_reef(c, check=check) is False]
    if check and bad:
        sys.exit(1)


if __name__ == "__main__":
    main()
