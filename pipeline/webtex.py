"""Ship a city's pictures as WebP (issue 335): the landmark textures (landmarks.json materials' "map")
and the woods mask (scene.json "woods"), a third of their JPEG and PNG size or less on the wire.

- A JPEG (a drawn atlas, a screen sheet, a photograph) becomes a lossy WebP at QUALITY: about 40 dB
  PSNR against the JPEG it replaces, at 40-50% of its size.
- A PNG (a cutout, or a data image such as woods.png, whose channels are weights and heights) becomes a
  lossless WebP with its colours kept exactly under clear pixels, so it decodes to the same values.
A file is replaced only when the WebP is at least SAVE smaller. Every current browser decodes WebP in an
<img> and in createImageBitmap (Safari since 14), and Blender reads it, so nothing that loads these by name
changes. The aerial ground tiles (ground_*.jpg) are left as they are: WebP saves only about a tenth on them.

pipeline/landmarks.py calls landmark_maps() after a city's landmark_assets hook and pipeline/woods.py
calls convert() on its mask, so a build writes WebP itself. For data already built:

    python pipeline/webtex.py --city shibuya    # converts in place, rewrites the JSON, then run pipeline/pack.py
"""
import json
import os

from PIL import Image

QUALITY = 88
SAVE = 0.1


def convert(out_dir, name):
    """name (a file in out_dir) as WebP when that is SAVE smaller; returns the name to use."""
    stem, ext = os.path.splitext(name)
    if ext.lower() not in (".jpg", ".jpeg", ".png") or stem.startswith("ground_"):
        return name
    src, dst = os.path.join(out_dir, name), os.path.join(out_dir, stem + ".webp")
    if not os.path.exists(src):
        return name
    im = Image.open(src)
    im.load()
    if ext.lower() == ".png":
        im = im.convert("RGBA" if "A" in im.getbands() or "transparency" in im.info else "RGB")
        im.save(dst, "WEBP", lossless=True, exact=True, method=6, quality=100)
    else:
        im.convert("RGB").save(dst, "WEBP", quality=QUALITY, method=6)
    if os.path.getsize(dst) > (1 - SAVE) * os.path.getsize(src):
        os.remove(dst)
        return name
    os.remove(src)
    return stem + ".webp"


def landmark_maps(out_dir, materials, files=None):
    """Convert the pictures materials name (only those in files, when given: the ones a build just wrote)
    and point the materials at the WebP. Returns {old name: new name}."""
    names = {m["map"] for m in materials.values() if m.get("map")}
    if files is not None:
        names &= set(files)
    done = {}
    for n in sorted(names):
        new = convert(out_dir, n)
        if new != n:
            done[n] = new
    for m in materials.values():
        if m.get("map") in done:
            m["map"] = done[m["map"]]
    return done


def main():
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from cityctx import city_args
    city, _ = city_args(__doc__.splitlines()[0])
    out = city.out
    path = os.path.join(out, "landmarks.json")
    if os.path.exists(path):
        lm = json.load(open(path))
        before = {m["map"]: os.path.getsize(os.path.join(out, m["map"])) for m in lm.get("materials", {}).values()
                  if m.get("map") and os.path.exists(os.path.join(out, m["map"]))}
        done = landmark_maps(out, lm.get("materials", {}))
        if done:
            json.dump(lm, open(path, "w"), separators=(",", ":"))
        for a, b in done.items():
            print(f"{a} {before[a] / 1e3:.0f} kB -> {b} {os.path.getsize(os.path.join(out, b)) / 1e3:.0f} kB")
    path = os.path.join(out, "scene.json")
    scene = json.load(open(path))
    w = scene.get("woods")
    if w and w.get("file"):
        size = os.path.getsize(os.path.join(out, w["file"])) if os.path.exists(os.path.join(out, w["file"])) else 0
        new = convert(out, w["file"])
        if new != w["file"]:
            print(f"{w['file']} {size / 1e3:.0f} kB -> {new} {os.path.getsize(os.path.join(out, new)) / 1e3:.0f} kB")
            w["file"] = new
            json.dump(scene, open(path, "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
