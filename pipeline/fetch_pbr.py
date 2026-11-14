"""Tiled PBR surfaces for the landmarks (web/assets/pbr/), from Poly Haven's CC0 textures.

Each set is a colour map, an OpenGL normal map and a roughness map, written as WebP at two sizes:
1024 px for the high and medium tiers and 512 px for the low one (web/world.js, landmarks.json
material key "pbr": {"set": <name>, "tile_m": [w, h]}). The sets are shared: every city's landmarks
name them, none keeps a copy of its own. Poly Haven's textures are CC0 (public domain); the
licence and the source of each set are written to web/assets/pbr/LICENSE-PolyHaven.txt.

    python pipeline/fetch_pbr.py            # fetches what is missing
    python pipeline/fetch_pbr.py --force    # fetches them all again
"""
import io
import os
import sys
import urllib.request

from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "assets", "pbr")
UA = {"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"}

# name in the app: (Poly Haven id, what it stands for)
SETS = {
    "brick": ("red_brick", "pressed red brick in a fine joint (Tokyo Station's 1914 walls)"),
    "granite_paving": ("granite_tile", "sawn granite slabs (a plaza's paving)"),
    "slate": ("roof_slates_03", "natural slate roofing (the station's domes and roofs)"),
    "stucco": ("plastered_wall_04", "smooth render and dressed artificial stone (trim, bands, cornices)"),
    "concrete_pavers": ("concrete_pavers_02", "square concrete pavers (footways)"),
    "lawn": ("leafy_grass", "a mown lawn (a plaza's lawns)"),
}
MAPS = {"col": "Diffuse", "nrm": "nor_gl", "rgh": "Rough"}
SIZES = {"1k": 1024, "512": 512}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def main():
    import json
    force = "--force" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    lines = ["Poly Haven textures (https://polyhaven.com), CC0 1.0 Universal (public domain):",
             "https://polyhaven.com/license . Converted to WebP at 1024 and 512 px by pipeline/fetch_pbr.py.", ""]
    for name, (pid, what) in SETS.items():
        lines.append(f"{name}: {pid}  https://polyhaven.com/a/{pid}  ({what})")
        if not force and all(os.path.exists(os.path.join(OUT, f"{name}_{m}_{s}.webp")) for m in MAPS for s in SIZES):
            continue
        files = json.loads(get(f"https://api.polyhaven.com/files/{pid}"))
        for m, key in MAPS.items():
            src = Image.open(io.BytesIO(get(files[key]["2k"]["jpg"]["url"])))
            src = src.convert("L" if m == "rgh" else "RGB")
            for s, px in SIZES.items():
                im = src.resize((px, px), Image.LANCZOS)
                f = os.path.join(OUT, f"{name}_{m}_{s}.webp")
                im.save(f, "WEBP", quality=90 if m == "nrm" else 82, method=6)
                print(f"{f}: {os.path.getsize(f) / 1e3:.0f} kB")
    open(os.path.join(OUT, "LICENSE-PolyHaven.txt"), "w").write("\n".join(lines) + "\n")
    # each set's mean linear colour and mean roughness: a material's own colour and roughness (landmarks.json)
    # are what it averages to, so the textures add only their detail and the mesh reads the same without them
    import numpy as np
    means = {}
    for name in SETS:
        a = np.asarray(Image.open(os.path.join(OUT, f"{name}_col_512.webp")).convert("RGB"), dtype=np.float64) / 255
        lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4).reshape(-1, 3).mean(0)
        r = np.asarray(Image.open(os.path.join(OUT, f"{name}_rgh_512.webp")).convert("L"), dtype=np.float64).mean() / 255
        means[name] = {"mean": [round(float(x), 4) for x in lin], "rough": round(float(r), 3)}
    json.dump(means, open(os.path.join(OUT, "sets.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
