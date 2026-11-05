"""Refresh the walkable surfaces in a city's game.json from its game_surfaces hook, without the raw data.

    python pipeline/game_surfaces.py --city higashiyama

pipeline/game_data.py writes game.json from the raw downloads (data/raw/<id>/), which a fresh checkout
doesn't have. When only a city's own strips change (a stage, a gallery: cities/<id>/city.py
game_surfaces), this puts the hook's strips, and the bridges' (pipeline/bridges.py), in place of the
old ones and leaves the rest of game.json as it is. The paths draped on the surfaces keep the heights
game_data.py gave them: rerun game_data.py when a strip moves under a mapped way.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cityctx import City  # noqa: E402
import bridges  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", required=True)
    a = ap.parse_args()
    C = City(a.city)
    path = os.path.join(C.out, "game.json")
    game = json.load(open(path))
    scene = json.load(open(os.path.join(C.out, "scene.json")))
    hook = C.hook("game_surfaces")
    surfaces = (hook(scene) if hook else []) + bridges.surfaces(scene)
    print(f"{a.city}: {len(game.get('surfaces', []))} surfaces -> {len(surfaces)}: " + ", ".join(s.get("name", "?") for s in surfaces))
    game["surfaces"] = surfaces
    json.dump(game, open(path, "w"), separators=(",", ":"))   # as game_data.py writes it


if __name__ == "__main__":
    main()
