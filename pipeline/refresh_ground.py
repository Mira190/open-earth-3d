"""Repaint a built city's drawn ground (web/data/<id>/ground_*.jpg, for cities whose imagery is
"synth") where its city.json imagery.paint says, without the full rebuild.

Each rule names the fill it paints ("fill") and the fill the land use drew there ("over"), both
keys of build_scene.SYNTH. Inside the ring, a pixel that is the "over" colour under the drawn
ground's shading and noise (the same colour scaled by its brightness) takes the "fill" colour at
that brightness, so the contact shading round buildings and the grain stay; footways, roads and
footprints drawn over it keep their own colours. Running it again changes nothing, and a full
build draws the same fill (build_scene.synth_ground draws imagery.paint in place of the land use).

    python pipeline/refresh_ground.py --city melbourne
"""
import json
import os

import numpy as np
import shapely
from PIL import Image

from build_scene import SYNTH, paint_rings, raster_mask
from cityctx import city_args

TOL = 0.035  # how far (in shares of the brightness) a pixel may be off the "over" colour and still be it


def rgb(hexstr):
    return np.array([int(hexstr[i:i + 2], 16) for i in (1, 3, 5)], float)


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    rules = C.cfg.get("imagery", {}).get("paint", [])
    if not rules:
        raise SystemExit(f"{C.id}: no imagery.paint in city.json, nothing to repaint")
    scene = json.load(open(os.path.join(C.out, "scene.json"), encoding="utf8"))
    rings = paint_rings(C)
    for rule, ring in zip(rules, rings):
        over, fill = rgb(SYNTH[rule["over"]]), rgb(SYNTH[rule["fill"]])
        changed = 0
        for t in scene["ground"]:
            if not ring["poly"].intersects(shapely.box(t["x0"], t["y0"], t["x1"], t["y1"])):
                continue
            path = os.path.join(C.out, t["file"])
            im = Image.open(path).convert("RGB")
            a = np.asarray(im).astype(float)
            h, w = a.shape[:2]
            cell = (t["x1"] - t["x0"]) / w
            inside = raster_mask([ring["poly"]], w, h, cell, t["x0"], t["y1"])
            k = a.mean(-1) / over.mean()  # the shading and grain, as a scale on the colour
            off = np.abs(a - k[..., None] * over).max(-1) / np.maximum(1.0, k * over.mean())
            wgt = np.clip(1.0 - (off - TOL) / TOL, 0.0, 1.0) * inside  # (paving and footways are 0.09 and more off dirt)
            a2 = a + wgt[..., None] * (k[..., None] * (fill - over))
            n = int((wgt > 0.5).sum())
            if n > 16:  # (a few pixels' JPEG noise on a second run is not a fill)
                Image.fromarray(np.clip(np.round(a2), 0, 255).astype(np.uint8)).save(path, quality=80, optimize=True)
                changed += n
        print(f"{C.id}: {rule.get('name', 'paint')}: {changed} px from {rule['over']} to {rule['fill']}")


if __name__ == "__main__":
    main()
