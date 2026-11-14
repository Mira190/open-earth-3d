"""Shibuya's Shuto Expressway (Route 3 along Roppongi-dori and Tamagawa-dori, the Ohashi JCT, the Central Circular
Route's ramps) on the road surface measured from Tokyo's airborne LiDAR (#432).

The data puts the expressway's lines a level (6 m) at a time over the ground. Where they stack or merge at a
junction, the decks that drew from them came within head room of one another, and decks.js's grading could not put
them apart without the real levels. Those levels are measured from the same survey as Tokyo's expressway:
東京都デジタルツイン実現プロジェクト 区部点群データ (Tokyo Metropolitan Government, tokyopc-23ku-2024, CC BY 4.0).

    python cities/tokyo/shuto_lidar.py --city shibuya   fetch the sheets under the lines (data/raw/shibuya/lidar), measure,
                                                       write cities/shibuya/shuto_lidar.json
    python cities/shibuya/shuto_levels.py               put game.json's elevated expressway lines on those samples
                                                       (cities/tokyo/shuto.py on_lidar: the line whose data height is
                                                       nearest, eased out past the survey and to the ramps' feet), then
    python pipeline/pack.py                            repack game.bin

Run it again after any step that writes web/data/shibuya/game.json's roads (game_data.py), as Tokyo's
`shuto.py --game` is.
"""
import base64
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GAME = os.path.join(ROOT, "web", "data", "shibuya", "game.json")
sys.path.insert(0, os.path.join(ROOT, "cities", "tokyo"))
import shuto  # noqa: E402


def ground(G):
    t = G["terrain"]
    T = np.frombuffer(base64.b64decode(t["data"]), "<i2").reshape(t["ny"], t["nx"]) * t["scale"]
    x0, _, _, y1 = json.load(open(os.path.join(HERE, "city.json"), encoding="utf8"))["extent_m"]
    cell = t["cell"]
    return lambda x, y: float(T[int(np.clip(round((y1 - y) / cell), 0, t["ny"] - 1)), int(np.clip(round((x - x0) / cell), 0, t["nx"] - 1))])


if __name__ == "__main__":
    G = json.load(open(GAME, encoding="utf8"))
    shuto.use("shibuya", ground(G))
    if shuto.lidar() is None:
        sys.exit("no cities/shibuya/shuto_lidar.json: run cities/tokyo/shuto_lidar.py --city shibuya first")
    n = shuto.on_lidar(G)
    json.dump(G, open(GAME, "w"), separators=(",", ":"))   # as game_extras.py writes it
    print(f"{n} expressway points put on the LiDAR's heights -> {GAME}")
