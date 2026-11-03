"""Copy what the game's people say from cities/<id>/city.json into web/data/<id>/game.json, so
rewritten dialogue shows without rebuilding the game data, which pipeline/game_data.py writes
from the raw downloads. Everything else in game.json stays: where the NPCs stand (snapped to
open ground by game_data.py), the paths, the water, the wharves.

Copies: the title card (title, local_name, water_name, greeting, blurb, under_bridge_note), the
crowd's small talk, the quest lines and quests (a step that visits a flock keeps the place
game_data.py found for it), the NPCs (all but where they stand), the travel names, the areas,
the regulars and the funicular's name and note; and the spots and overheard chatter a city's
landmarks add (city.py game_extras, run on the built scene.json as game_data.py runs it).
tools/voice_check.py checks the result.

    python pipeline/game_text.py                  # every city with a game
    python pipeline/game_text.py shibuya tokyo
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cityctx import City  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOP = ("title", "local_name", "water_name", "greeting", "blurb", "under_bridge_note", "smalltalk", "lines", "areas", "regulars")


def update(city):
    cfg = os.path.join(ROOT, "cities", city, "city.json")
    out = os.path.join(ROOT, "web", "data", city, "game.json")
    if not os.path.exists(cfg) or not os.path.exists(out):
        return None
    g = json.load(open(cfg, encoding="utf8")).get("game")
    if not g:
        return None
    game = json.load(open(out, encoding="utf8"))
    before = json.dumps(game, sort_keys=True)
    for k in TOP:
        if k in g:
            game[k] = g[k]
    # the NPCs: everything but where they stand, which game_data.py snapped to open ground
    have = {n["id"]: n for n in game.get("npcs", [])}
    if set(have) != {n["id"] for n in g.get("npcs", [])}:
        raise SystemExit(f"{city}: the NPCs in city.json are not the ones in game.json; rebuild with pipeline/game_data.py")
    game["npcs"] = [dict(n, at=have[n["id"]]["at"]) for n in g.get("npcs", [])]
    # the quests, with a flock's place as game_data.py found it
    flocks = {f["id"]: f["at"] for f in game.get("flocks", [])}
    quests = json.loads(json.dumps(g.get("quests", [])))
    for q in quests:
        for st in q.get("steps", []):
            if st.get("flock") in flocks:
                st["at"] = flocks[st["flock"]]
    game["quests"] = quests
    names = {t["id"]: t["name"] for t in g.get("travel", [])}
    for t in game.get("travel", []):
        if t["id"] in names:
            t["name"] = names[t["id"]]
    fun = (g.get("rail") or {}).get("funicular")
    if fun and "funicular" in (game.get("rail") or {}):
        for k in ("name", "note"):
            if k in fun:
                game["rail"]["funicular"][k] = fun[k]
    # what the landmarks add: spots to look at and conversations to overhear (city.py game_extras)
    C = City(city)
    if C.hook("game_extras"):
        extras = C.hook("game_extras")(json.load(open(os.path.join(C.out, "scene.json"), encoding="utf8")))
        for k in ("spots", "chatter"):
            if k in extras or k in g:
                game[k] = json.loads(json.dumps(g.get(k, []) + extras.get(k, [])))
    if json.dumps(game, sort_keys=True) == before:
        return False
    json.dump(game, open(out, "w"), separators=(",", ":"))  # as game_data.py writes it
    return True


def main(cities):
    for city in cities or sorted(os.listdir(os.path.join(ROOT, "cities"))):
        r = update(city)
        if r is not None:
            print(f"{city}: {'text updated' if r else 'already up to date'}")


if __name__ == "__main__":
    main(sys.argv[1:])
