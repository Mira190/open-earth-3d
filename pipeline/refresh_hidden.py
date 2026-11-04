"""Rewrite a built city's scene.json hidden_solids (the measured solids a landmark mesh draws instead:
not drawn, but kept in the surface model) where the city's hook refresh_hidden(scene, solids) ->
(solid indices to show, to hide) says, without rebuilding the scene. The hook applies the same rule
as the city's adjust_building to the solids of web/data/<id>/buildings.json.

    python pipeline/refresh_hidden.py --city amsterdam
"""
import json
import os

import archkit as ak
from cityctx import city_args


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    hook = C.hook("refresh_hidden")
    if not hook:
        print(f"{C.id}: no refresh_hidden hook")
        return
    path = os.path.join(C.out, "scene.json")
    scene = json.load(open(path, encoding="utf8"))
    show, hide = hook(scene, ak.load_solids(C.id))
    before = set(scene.get("hidden_solids", []))
    after = (before - set(show)) | set(hide)
    scene["hidden_solids"] = sorted(after)
    json.dump(scene, open(path, "w"), separators=(",", ":"))
    print(f"{path}: {len(before)} -> {len(after)} hidden ({len(before - after)} shown again, {len(after - before)} newly hidden)")


if __name__ == "__main__":
    main()
