"""Build a map's hero level (docs/HERO.md): cities/<id>/hero.py's build(kit) -> geometry, atlas and
materials; the light after dark and the corners' occlusion baked into its vertices (hero_kit.bake);
exported as one glTF binary with WebP textures into web/data/<id>/hero/<level>.glb, meshopt-compressed; its
finest parts (geo.fine), when it has any, as <level>_fine.glb beside it.

    pip install bpy==5.2.3
    python blender/build_hero.py --city shinjuku
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import hero_kit as K  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--city", required=True)
    ap.add_argument("--no-meshopt", action="store_true")
    a = ap.parse_args()
    spec = importlib.util.spec_from_file_location("hero_level", os.path.join(ROOT, "cities", a.city, "hero.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    t0 = time.time()
    geo, atlas, materials, meta = mod.build(K)
    tris, verts = geo.count()
    print(f"{meta['id']}: {tris} triangles, {verts} vertices, {len(geo.parts)} materials, {len(geo.emitters)} lights to bake ({time.time() - t0:.1f} s)")
    t1 = time.time()
    bakes = K.bake(geo, gain=meta.get("bake_gain", 0.6))
    print(f"baked in {time.time() - t1:.1f} s")
    out_dir = os.path.join(ROOT, "web", "data", a.city, "hero")
    os.makedirs(out_dir, exist_ok=True)
    tmp = os.path.join(ROOT, "data", "raw", "hero", a.city)
    os.makedirs(tmp, exist_ok=True)
    atlas_path = os.path.join(tmp, f"{meta['id']}_atlas.png")
    atlas.img.save(atlas_path)
    origin = (meta["at"][0], meta["at"][1], meta.get("z", 30.0))
    # the level, and its finest parts as a model of their own (geo.fine: fetched and drawn only near the camera,
    # never on a phone; plain materials only, so that no texture is carried twice)
    models = [(geo, bakes, f"{meta['id']}.glb", meta.get("cell"))]
    fine = geo._fine
    if fine is not None and fine.parts:
        bad = [k for k in fine.parts if materials[k].get("tex") or materials[k].get("map")]
        if bad:
            raise SystemExit(f"fine parts must be in plain materials (no texture): {bad}")
        ft, fv = fine.count()
        print(f"{meta['id']} fine: {ft} triangles, {fv} vertices, {len(fine.parts)} materials")
        models.append((fine, K.bake(fine, gain=meta.get("bake_gain", 0.6)), f"{meta['id']}_fine.glb", meta.get("fine_cell", 24.0)))
    for g, bk, fname, cell in models:
        K.build_blender(g, bk, materials, atlas_path, name=meta["id"], origin=origin, cell=cell)
        glb = os.path.join(out_dir, fname)
        K.export(glb)
        if not a.no_meshopt:
            subprocess.run(["node", os.path.join(ROOT, "pipeline", "meshopt_glb.mjs"), glb], check=True)
        print(f"-> {glb} ({os.path.getsize(glb) / 1e6:.2f} MB) in {time.time() - t0:.0f} s")
    json.dump(meta, open(os.path.join(tmp, f"{meta['id']}.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
