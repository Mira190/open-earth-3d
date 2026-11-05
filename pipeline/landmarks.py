"""Parametric landmark meshes for a city, from the hooks in cities/<id>/city.py
(landmark_meshes(scene) -> (materials, meshes)). Cities without hooks get an
empty file. The output is shared by the web viewer and the Blender script, so
both show the same geometry. A city whose materials take an image (`map`) draws it
with landmark_assets(out_dir, scene), which writes the image next to landmarks.json.
landmark_glows(scene) -> [[x, y, radius m, colour, strength(, on hour, off hour)], ...] adds the light
a landmark's screens and signs throw on the street after dark (web/night.js), while they are on. landmark_demolished(scene) ->
[solid index, ...] names solids of the built city that have been pulled down since its survey:
the viewer and the game neither draw them nor let them stand in the surface model (web/world.js),
until the city's next build leaves them out itself.
landmark_meshes may return a third item, more keys for landmarks.json: "hidden", solids of the built city that a
landmark mesh draws instead (not drawn, but kept in the surface model, as scene.json's hidden_solids); "props", street furniture
drawn once per kind and instanced at every [x, y, z, heading(, scale across)] in "at", within
"far" metres; "clip", regions ({ring, holes}) where the viewer does not draw the ground above
the water (under paving, and in front of a seawall) (web/world.js); "seawalls", the face of a
seawall the landmark draws itself, polylines [[x, y], ...] with the water on their right, where a
walker stops at its edge (web/quays.js); "trees", a landmark's own trees, [x, y, z, height] in decimetres as
places.json's, standing at z (a roof garden's, on its terraces), drawn after the woods' in the city's mix (web/world.js).

    python pipeline/landmarks.py --city sydney      # reads/writes web/data/<city>
"""
import json
import os

import bridges
from cityctx import city_args


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    scene = json.load(open(os.path.join(city.out, "scene.json")))
    hook = city.hook("landmark_meshes")
    got = hook(scene) if hook else ({}, [])
    materials, meshes, extra = got if len(got) == 3 else (*got, {})  # extra: "props", "clip" (see above)
    bm, bmeshes = bridges.meshes(scene)   # the bridges over the water the city does not draw itself (bridges.py)
    materials, meshes = {**materials, **bm}, list(meshes) + bmeshes
    if city.hook("landmark_assets"):
        for f in city.hook("landmark_assets")(city.out, scene) or []:
            print(f"{f}: {os.path.getsize(os.path.join(city.out, f)) / 1e6:.2f} MB")
    out = {"materials": materials, "meshes": [m.dump() for m in meshes],
           "notes": "Parametric; dimensions from published figures, anchors from OpenStreetMap footprints." if meshes else "No parametric landmarks."}
    out.update(extra)
    if city.hook("landmark_glows"):
        out["glows"] = city.hook("landmark_glows")(scene)
    if bridges.glows(scene):
        out["glows"] = out.get("glows", []) + bridges.glows(scene)
    if city.hook("landmark_demolished"):
        out["demolished"] = city.hook("landmark_demolished")(scene)
    path = os.path.join(city.out, "landmarks.json")
    # the passages through the landmarks (pipeline/landmark_passages.py): kept until that script measures them
    # again on the new meshes, which it does here when the segments it reads are cached (data/raw/<id>)
    old = json.load(open(path)) if os.path.exists(path) else {}
    if old.get("passages"):
        out["passages"] = old["passages"]
    json.dump(out, open(path, "w"), separators=(",", ":"))
    for p in extra.get("props", []):
        print(f"  props: {len(p['at'])} x {p['name']} ({sum(len(q['index']) // 3 for q in p['parts'])} triangles each)")
    print(f"{sum(len(m.v) for m in meshes)} vertices, {sum(len(m.i) for m in meshes) // 3} triangles -> {path}"
          f" ({os.path.getsize(path) / 1e6:.2f} MB)")
    if os.path.exists(os.path.join(city.raw, "overture_passages.json")):
        import subprocess
        import sys
        subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "landmark_passages.py"), "--city", city.id], check=True)
    elif out.get("passages"):
        print("  passages kept from before: run pipeline/landmark_passages.py to measure them on the new meshes")


if __name__ == "__main__":
    main()
