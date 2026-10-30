"""Copy each NPC's look from cities/<id>/city.json into web/data/<id>/game.json, so a recast
NPC (a new character, clip or accessory) shows without rebuilding the game data, which
pipeline/game_data.py writes from the raw downloads. Everything else in game.json stays.

    python pipeline/npc_looks.py                  # every city with NPCs
    python pipeline/npc_looks.py tokyo osaka
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(cities):
    for city in cities or sorted(os.listdir(os.path.join(ROOT, "cities"))):
        cfg = os.path.join(ROOT, "cities", city, "city.json")
        out = os.path.join(ROOT, "web", "data", city, "game.json")
        if not os.path.exists(cfg) or not os.path.exists(out):
            continue
        looks = {n["id"]: n.get("look", {}) for n in (json.load(open(cfg, encoding="utf8")).get("game") or {}).get("npcs", [])}
        game = json.load(open(out, encoding="utf8"))
        changed = [n["id"] for n in game.get("npcs", []) if n["id"] in looks and n.get("look") != looks[n["id"]]]
        for n in game.get("npcs", []):
            if n["id"] in looks:
                n["look"] = looks[n["id"]]
        if changed:
            json.dump(game, open(out, "w"), separators=(",", ":"))   # as game_data.py writes it
        print(f"{city}: {len(changed)} of {len(game.get('npcs', []))} NPCs' looks updated")


if __name__ == "__main__":
    main(sys.argv[1:])
