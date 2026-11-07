"""Copy the parts of cities/<id>/city.json's game that need no raw data into web/data/<id>/game.json:
its title and its travel points (each set on the built terrain, as pipeline/game_data.py sets them).
A renamed map or a new district on its city's map (cities/index.json groups) then shows without
rebuilding the game data, which game_data.py writes from the raw downloads. Everything else stays.

    python pipeline/game_sync.py kyoto higashiyama
    python pipeline/game_sync.py                    # every city with a game
Then python pipeline/pack.py, which repacks game.bin.
"""
import base64
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ground_fn(data):
    """The bare terrain under (x, y) in the map's frame, bilinear, as web/sun.js terrainAt reads it."""
    scene = json.load(open(os.path.join(data, "scene.json"), encoding="utf8"))
    tm = scene["terrain"]
    t = json.load(open(os.path.join(data, tm["file"]), encoding="utf8"))
    nx, ny, cell = t["nx"], t["ny"], tm["cell"]
    D = np.frombuffer(base64.b64decode(t["data"]), dtype="<i2").astype(np.float64).reshape(ny, nx) * tm["scale"]
    x0, y1 = scene["frame"]["x"][0], scene["frame"]["y"][1]

    def ground(x, y):
        c = min(max((x - x0) / cell, 0), nx - 1.001)
        r = min(max((y1 - y) / cell, 0), ny - 1.001)
        c0, r0 = int(c), int(r)
        fc, fr = c - c0, r - r0
        top = D[r0, c0] * (1 - fc) + D[r0, c0 + 1] * fc
        bot = D[r0 + 1, c0] * (1 - fc) + D[r0 + 1, c0 + 1] * fc
        return max(0.0, top * (1 - fr) + bot * fr)
    return ground


def main(cities):
    for city in cities or sorted(os.listdir(os.path.join(ROOT, "cities"))):
        cfg = os.path.join(ROOT, "cities", city, "city.json")
        data = os.path.join(ROOT, "web", "data", city)
        out = os.path.join(data, "game.json")
        if not os.path.exists(cfg) or not os.path.exists(out):
            continue
        gcfg = json.load(open(cfg, encoding="utf8")).get("game") or {}
        game = json.load(open(out, encoding="utf8"))
        changed = []
        if gcfg.get("title") and game.get("title") != gcfg["title"]:
            game["title"] = gcfg["title"]
            changed.append("title")
        if "travel" in gcfg:
            ground = ground_fn(data)
            travel = [dict(t, at=[t["at"][0], t["at"][1], round(ground(*t["at"][:2]), 1)]) for t in gcfg["travel"]]
            # keep the points city.json does not name (city.py game_extras adds some: a deck up a tower)
            own = {t["id"] for t in travel}
            travel += [t for t in game.get("travel", []) if t["id"] not in own]
            if travel != game.get("travel"):
                game["travel"] = travel
                changed.append(f"{len(travel)} travel points")
        if changed:
            json.dump(game, open(out, "w"), separators=(",", ":"))   # as game_data.py writes it
        print(f"{city}: {', '.join(changed) or 'nothing to update'}")


if __name__ == "__main__":
    main(sys.argv[1:])
