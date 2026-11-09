"""Rebuild a built city's aerial ground tiles from its imagery with their AVIF beside the JPEG, and the
low-resolution overview (scene.json "ground_lo"), without the full rebuild (issue 335). A full build
(build_scene.py) writes the same. The imagery is fetched again when it is not in data/raw.

    python pipeline/ground_avif.py --city shibuya

The tiles are drawn from the source imagery as the build draws them: the JPEG comes out as it was
(checked: the same pixels), the AVIF is encoded from the source, not from the JPEG.
"""
import json
import os

from build_scene import ground_overview, ground_tiles
from cityctx import city_args
from fetch_tiles import fetch_xyz, imagery_stac


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    im = C.cfg["imagery"]
    d = os.path.join(C.raw, "imagery", str(im["zoom"]))
    if not (os.path.isdir(d) and os.listdir(d)):
        if im["type"] == "xyz":
            fetch_xyz(C.cfg["bbox"], im["url"], im["zoom"], im.get("format", "jpg"), d)
        elif im["type"] == "stac_cog":
            imagery_stac(C.cfg["bbox"], im, d)
        else:
            raise SystemExit(f"{C.id}: imagery {im['type']} is drawn by the build, not fetched; rebuild with build_scene.py")
    path = os.path.join(C.out, "scene.json")
    scene = json.load(open(path, encoding="utf8"))
    tiles, ortho = ground_tiles(C)
    old = {t["file"]: t for t in scene["ground"]}
    if set(old) != {t["file"] for t in tiles}:
        raise SystemExit(f"{C.id}: the tiles drawn now ({len(tiles)}) are not the ones built ({len(old)}); rebuild with build_scene.py")
    scene["ground"] = [dict(old[t["file"]], avif=t["avif"]) for t in tiles]
    scene["ground_lo"] = ground_overview(C, ortho)
    with open(path, "w", encoding="utf8") as f:
        json.dump(scene, f, separators=(",", ":"))  # (as build_scene.py writes it)
    jpg = sum(os.path.getsize(os.path.join(C.out, t["file"])) for t in tiles)
    avif = sum(os.path.getsize(os.path.join(C.out, t["avif"])) for t in tiles)
    print(f"{C.id}: {len(tiles)} tiles, JPEG {jpg / 1e6:.2f} MB, AVIF {avif / 1e6:.2f} MB; overview "
          f"{os.path.getsize(os.path.join(C.out, scene['ground_lo']['avif'])) / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
