"""Parametric landmark meshes for a city, from the hooks in cities/<id>/city.py
(landmark_meshes(scene) -> (materials, meshes)). Cities without hooks get an
empty file. The output is shared by the web viewer and the Blender script, so
both show the same geometry. A city whose materials take an image (`map`) draws it
with landmark_assets(out_dir, scene), which writes the image next to landmarks.json.

    python pipeline/landmarks.py --city sydney      # reads/writes web/data/<city>
"""
import json
import os

from cityctx import city_args


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    scene = json.load(open(os.path.join(city.out, "scene.json")))
    hook = city.hook("landmark_meshes")
    materials, meshes = hook(scene) if hook else ({}, [])
    if city.hook("landmark_assets"):
        for f in city.hook("landmark_assets")(city.out, scene) or []:
            print(f"{f}: {os.path.getsize(os.path.join(city.out, f)) / 1e6:.2f} MB")
    out = {"materials": materials, "meshes": [m.dump() for m in meshes],
           "notes": "Parametric; dimensions from published figures, anchors from OpenStreetMap footprints." if meshes else "No parametric landmarks."}
    path = os.path.join(city.out, "landmarks.json")
    json.dump(out, open(path, "w"), separators=(",", ":"))
    print(f"{sum(len(m.v) for m in meshes)} vertices, {sum(len(m.i) for m in meshes) // 3} triangles -> {path}"
          f" ({os.path.getsize(path) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
