"""Refresh the city settings scene.json carries (its "city" block: the tour, the light show, the labels'
lists, the renders...; and its "trees", the species mix) from cities/<id>/city.json, without rebuilding the scene. build_scene.py writes
the same block from the same keys (cityctx.SCENE_CITY_KEYS); everything else in scene.json is kept.

    python pipeline/scene_config.py --city shibuya
"""
import json
import os

from cityctx import SCENE_CITY_KEYS, city_args


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    path = os.path.join(city.out, "scene.json")
    scene = json.load(open(path, encoding="utf8"))
    blk = scene["city"]
    changed = []
    for k in SCENE_CITY_KEYS:
        if k in city.cfg and blk.get(k) != city.cfg[k]:
            blk[k] = city.cfg[k]
            changed.append(k)
        elif k not in city.cfg and k in blk:
            del blk[k]
            changed.append(k)
    if scene.get("trees") != city.cfg.get("trees", {}):     # build_scene.py copies it whole
        scene["trees"] = city.cfg.get("trees", {})
        changed.append("trees")
    json.dump(scene, open(path, "w"), separators=(",", ":"))   # as build_scene.py writes it
    print(f"{path}: {', '.join(changed) or 'already current'}")


if __name__ == "__main__":
    main()
