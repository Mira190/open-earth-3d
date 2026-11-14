"""The street's close-up surfaces (web/surface.js): photographed asphalt and concrete from Poly Haven
(CC0), packed for the ground shader, one texture per surface and size.

At eye level a street is a few metres of ground filling half the frame, and what reads as real there is
what a photograph of asphalt has and a procedural grain has not: the aggregate's stones, their glint
and their pits, the tar's cracks, the polish of the wheel tracks. Each surface here is a scanned PBR set
(colour, OpenGL normal, roughness) packed into one RGBA image the ground shader samples in metres:

  R  the colour's luminance over its mean, times 0.5 (0.5 is the surface's average: the shader
     multiplies the city's own colour by 2R, so a city keeps its asphalt's tone and takes the detail)
  G  roughness
  B  the normal's x, A the normal's y (OpenGL: +y up the image), z rebuilt in the shader

Written as WebP (quality 88) at 1024 px (high tier) and 512 px (medium; the low tier, phones among them,
loads none: web/surface.js). Sources (all CC0, polyhaven.com/license):
  asphalt  Poly Haven "Asphalt 02" (Rob Tuytel), 3 x 3 m: weathered grey asphalt, coarse aggregate,
           tar cracks
  concrete Poly Haven "Concrete Floor Worn 001", 3 x 3 m (scaled to 2 m: paving slabs' grain)

    python pipeline/surfaces.py            # fetch (cached in .cache/surfaces) and write web/assets/surface/
"""
import io
import json
import os
import urllib.request

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "assets", "surface")
CACHE = os.path.join(ROOT, ".cache", "surfaces")
UA = "open-earth-3d (https://github.com/Mira190/open-earth-3d)"
SURFACES = {
    # name: (Poly Haven id, the tile's size in metres as the shader repeats it)
    "asphalt": ("asphalt_02", 3.0),
    "concrete": ("concrete_floor_worn_001", 2.0),
}
SIZES = (1024, 512)


def fetch(asset, kind):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{asset}_{kind}_1k.jpg")
    if not os.path.exists(path):
        url = f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/{asset}/{asset}_{kind}_1k.jpg"
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
            f.write(r.read())
    return Image.open(path).convert("RGB")


def pack(asset):
    col = np.asarray(fetch(asset, "diff"), np.float32) / 255.0
    nrm = np.asarray(fetch(asset, "nor_gl"), np.float32) / 255.0
    rough = np.asarray(fetch(asset, "rough"), np.float32)[..., 0] / 255.0
    lin = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    # the luminance over its mean, with its biggest swings (a stain the size of the tile) taken out, so the
    # tile does not show as a repeating blotch: the shader brings its own large-scale variation
    from PIL import ImageFilter
    big = np.asarray(Image.fromarray((lum / lum.max() * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(64)), np.float32) / 255.0 * lum.max()
    rel = lum / np.maximum(big, 1e-4)
    r = np.clip(rel * 0.5, 0, 1)
    rgba = np.stack([r, rough, nrm[..., 0], nrm[..., 1]], -1)
    return Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA")


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for name, (asset, metres) in SURFACES.items():
        im = pack(asset)
        for s in SIZES:
            im.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f"{name}_{s}.webp"), quality=88, alpha_quality=90, method=6, exact=True)
        meta[name] = {"source": f"https://polyhaven.com/a/{asset}", "licence": "CC0", "metres": metres}
        print(name, [os.path.getsize(os.path.join(OUT, f"{name}_{s}.webp")) // 1024 for s in SIZES], "KB")
    with open(os.path.join(OUT, "surfaces.json"), "w") as f:
        json.dump(meta, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
