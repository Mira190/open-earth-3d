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
  trains  a railway's tracks, its station and what runs on them (web/game/trains.js), and "travel", the
          builders' places to travel to (a platform)

    python pipeline/game_extras.py --city shibuya     # after landmarks.py; game_data.py does the same
"""
import json
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
        for k, v in C.hook("game_extras")(scene).items():
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
