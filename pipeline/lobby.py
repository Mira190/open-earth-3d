"""A lift's street door set inside its building: a lobby cut into the ground floor.

    python pipeline/lobby.py --city shibuya        # then: python pipeline/pack.py

A lift in game.json "lifts" whose first stop stands on the pavement outside the building it climbs (SHIBUYA
SKY's stood three metres off Scramble Square's north face, a door to nowhere in the open air) and is named
in cities/<city>/city.json game.lobbies ({lift id: {"w", "d", "h"}}, metres: the opening's width, how far in
it goes, its height) gets what the real building has: a way in. The nearest face of the nearest building is opened: the solid is kept whole from h
upwards (a passage, so it gets a ceiling: buildings.json "passages"), a new solid is the same footprint
with the lobby taken out of it from the ground to h, and the stop is moved to the back of the lobby, where
the lift's doors would be. Roofs, plant and frontages stay with the solid they were on.

Rewrites web/data/<city>/buildings.json and game.json; a lift whose stop is already under a passage is left alone, so running it again changes nothing.
"""
import argparse
import json
import os

from shapely.geometry import Point, Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def poly(s):
    ring = lambda r: [(r[i] / 10, r[i + 1] / 10) for i in range(0, len(r), 2)]
    return Polygon(ring(s[4]), [ring(h) for h in s[5:]]).buffer(0)


def dm(coords):
    out = []
    for x, y in list(coords)[:-1]:
        out += [round(x * 10), round(y * 10)]
    return out


def cut(B, lift):
    stop, L = lift["stops"][0], lift["stops"][0]["lobby"]
    p = Point(stop["at"][0], stop["at"][1])
    passages = set(B.get("passages", []))
    if any(B["s"][k][2] > 0 and poly(B["s"][k]).contains(p) for k in passages):
        return False  # (cut already)
    k = min((k for k, s in enumerate(B["s"]) if s[2] == 0 and s[3] / 10 > L["h"] + 6 and abs(s[4][0] / 10 - p.x) < 300 and abs(s[4][1] / 10 - p.y) < 300),
            key=lambda k: poly(B["s"][k]).distance(p))
    s, P = B["s"][k], poly(B["s"][k])
    # the face nearest the stop, its direction and the way in
    ext = P.exterior
    foot = ext.interpolate(ext.project(p))
    a, b = ext.interpolate(max(0, ext.project(p) - 0.5)), ext.interpolate(min(ext.length, ext.project(p) + 0.5))
    ux, uy = b.x - a.x, b.y - a.y
    n = (ux * ux + uy * uy) ** 0.5
    ux, uy = ux / n, uy / n
    nx, ny = -uy, ux
    if not P.contains(Point(foot.x + nx * 0.5, foot.y + ny * 0.5)):
        nx, ny = -nx, -ny
    w, d = L["w"] / 2, L["d"]
    room = Polygon([(foot.x - ux * w - nx * 1.0, foot.y - uy * w - ny * 1.0), (foot.x + ux * w - nx * 1.0, foot.y + uy * w - ny * 1.0),
                    (foot.x + ux * w + nx * d, foot.y + uy * w + ny * d), (foot.x - ux * w + nx * d, foot.y - uy * w + ny * d)])
    low = P.difference(room)
    if low.geom_type != "Polygon":
        raise SystemExit(f"{lift['id']}: the lobby would cut its building in two")
    B["s"].append([s[0], s[1], 0, round(L["h"] * 10), dm(low.exterior.coords)] + [dm(h.coords) for h in low.interiors])
    s[2] = round(L["h"] * 10)
    B["passages"] = sorted(passages | {k})
    z = stop["at"][2] if len(stop["at"]) > 2 else None
    stop["at"] = [round(foot.x + nx * (d - 1.6), 2), round(foot.y + ny * (d - 1.6), 2)] + ([z] if z is not None else [])
    stop["door"] = [round(foot.x, 2), round(foot.y, 2)]  # (the opening in the face: where the way in is, for a goal or a sign)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--city", required=True)
    a = ap.parse_args()
    d = os.path.join(ROOT, "web", "data", a.city)
    B = json.load(open(os.path.join(d, "buildings.json"), encoding="utf8"))
    raw = open(os.path.join(d, "game.json"), encoding="utf8").read()
    G = json.loads(raw)
    cfg = json.load(open(os.path.join(ROOT, "cities", a.city, "city.json"), encoding="utf8"))
    for l in G.get("lifts", []):  # (cities/<city>/city.json game.lobbies: {lift id: {w, d, h}})
        if l["id"] in cfg.get("game", {}).get("lobbies", {}):
            l["stops"][0]["lobby"] = cfg["game"]["lobbies"][l["id"]]
    n = sum(cut(B, l) for l in G.get("lifts", []) if l["stops"][0].get("lobby"))
    if n:
        json.dump(B, open(os.path.join(d, "buildings.json"), "w"), separators=(",", ":"))
        open(os.path.join(d, "game.json"), "w", encoding="utf8").write(json.dumps(G, ensure_ascii=False, separators=(",", ":")))
    print(f"{a.city}: {n} lobbies cut", [(l["id"], l["stops"][0]["at"]) for l in G.get("lifts", [])])


if __name__ == "__main__":
    main()
