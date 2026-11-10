"""How much of the sky the ground of a city sees, baked once (issue 358, B2): web/data/<city>/skyvis.webp
and skyvis.json, read by web/world.js for the ambient light on the ground and what stands on it.

    python pipeline/skyvis.py shibuya       # one city
    python pipeline/skyvis.py               # every live city whose texture is missing or stale
    python pipeline/skyvis.py --check       # exit 1 if a live city's is missing or stale

A street canyon is darker than a square under the same sky, because its ground sees less of the sky. The
page had that only from screen-space ambient occlusion, which looks a few metres round each pixel and is
computed again every frame. The city is static, so here it is computed once, over the surface model (the
terrain with the buildings on it, at 2 m): for each point, the horizon in 16 directions out to 300 m, and
from it the share of a uniform sky's light that reaches a level surface there (the mean of cos^2 of the
horizon's elevation: the horizon-based form of Bavoil, Sainz and Dimitrov 2008, on a height field as in
Timonen and Westerholm 2010; the method only, no code).

The texture is one channel, 4 m a pixel over the scene's frame, north up: the share seen from 1.5 m above the
ground, 0..255 for none..all. Under a building it is the open ground round it, blurred, so that a wall's foot
reads the street's value and the picture compresses (lossy WebP, quality 80: 3 in 255 off on average;
lossless was six times the bytes). A second height and the ground's level were tried in the other channels
and left out: three times the download for things only a tree's crown would read.
"""
import hashlib
import json
import os
import subprocess
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "web", "data")
VERSION = 1
PX = 2.0           # the surface model (m)
OUT_PX = 4.0       # the texture (m)
DIRS = 16
STEPS = (2, 4, 6, 8, 11, 15, 20, 27, 36, 48, 64, 85, 112, 150, 200, 300)   # m along each direction
EYE = 1.5          # m above the ground


def inputs_sha(city):
    d = os.path.join(DATA, city)
    h = hashlib.sha256(f"oe-skyvis-{VERSION}".encode())
    h.update(open(os.path.join(d, "buildings.json"), "rb").read())
    game = json.load(open(os.path.join(d, "game.json"), encoding="utf8"))
    h.update(game["terrain"]["data"].encode())
    return h.hexdigest()


def surface(city):
    """(ground, top, built) at PX m, row 0 at the north: the game's terrain, the surface with the buildings
    on it (each solid to its top), and where a building stands."""
    import base64
    from rasterio import features
    from rasterio.transform import Affine
    from scipy.ndimage import map_coordinates
    from shapely.geometry import Polygon
    sys.path.insert(0, os.path.join(ROOT, "pipeline"))
    import visibility
    d = os.path.join(DATA, city)
    scene = json.load(open(os.path.join(d, "scene.json"), encoding="utf8"))
    game = json.load(open(os.path.join(d, "game.json"), encoding="utf8"))
    B = json.load(open(os.path.join(d, "buildings.json"), encoding="utf8"))
    fr = scene["frame"]
    x0, x1, y0, y1 = fr["x"][0], fr["x"][1], fr["y"][0], fr["y"][1]
    w, h = int(round((x1 - x0) / PX)), int(round((y1 - y0) / PX))
    t = game["terrain"]
    z = np.frombuffer(base64.b64decode(t["data"]), "<i2").astype(np.float32).reshape(t["ny"], t["nx"]) * t["scale"]
    xs = (np.arange(w) + 0.5) * PX / t["cell"]
    ys = (np.arange(h) + 0.5) * PX / t["cell"]
    ground = map_coordinates(z, np.meshgrid(ys, xs, indexing="ij"), order=1, mode="nearest").astype(np.float32)
    hidden = visibility.hidden_solids(city, scene)
    shapes = []
    for si, s in enumerate(B["s"]):
        if si in hidden or len(s[4]) < 6 or s[3] <= s[2]:
            continue
        ring = np.asarray(s[4], np.float64).reshape(-1, 2) / 10
        p = Polygon(ring, [np.asarray(q, np.float64).reshape(-1, 2) / 10 for q in s[5:] if len(q) >= 6])
        if not p.is_valid:
            p = p.buffer(0)
        if not p.is_empty:
            shapes.append(((s[1] + s[3]) / 10, s[2] == 0, p))
    tr = Affine(PX, 0, x0, 0, -PX, y1)
    shapes.sort(key=lambda q: q[0])   # the lowest first: a pixel two solids cover ends with the higher top
    top = features.rasterize(((p, zt) for zt, _, p in shapes), out_shape=(h, w), transform=tr, fill=-1e6, dtype="float32") if shapes else np.full((h, w), -1e6, np.float32)
    grounded = [(p, 1) for _, g, p in shapes if g]
    built = features.rasterize(grounded, out_shape=(h, w), transform=tr, fill=0, dtype="uint8") if grounded else np.zeros((h, w), np.uint8)
    return (x0, x1, y0, y1), ground, np.maximum(top, ground), built


def sky_share(surf, eye):
    """The share of a uniform sky's light on a level surface at height `eye` (an array) over each pixel."""
    h, w = surf.shape
    acc = np.zeros((h, w), np.float32)
    pad = int(max(STEPS) / PX) + 2
    S = np.pad(surf, pad, mode="edge")
    for k in range(DIRS):
        a = 2 * np.pi * (k + 0.5) / DIRS
        best = np.zeros((h, w), np.float32)                       # the largest tangent of the horizon so far (level: 0)
        for d in STEPS:
            dx, dy = int(round(np.cos(a) * d / PX)), int(round(-np.sin(a) * d / PX))   # (rows go south)
            run = float(np.hypot(dx, dy)) * PX
            if not run:
                continue
            np.maximum(best, (S[pad + dy: pad + dy + h, pad + dx: pad + dx + w] - eye) / run, out=best)
        acc += 1.0 / (1.0 + best * best)                          # cos^2 of the elevation whose tangent is `best`
    return acc / DIRS


def bake(city):
    from scipy.ndimage import distance_transform_edt, gaussian_filter
    frame, ground, top, built = surface(city)
    vis = sky_share(top, ground + EYE)
    # under a building: the open ground round it, blurred (and the nearest of that where none is near)
    if built.any() and not built.all():
        free = (built == 0).astype(np.float32)
        num, den = gaussian_filter(vis * free, 3), gaussian_filter(free, 3)
        soft = np.where(den > 1e-3, num / np.maximum(den, 1e-3), 0)
        idx = distance_transform_edt(den <= 1e-3, return_distances=False, return_indices=True)
        vis = np.where(built > 0, soft[idx[0], idx[1]], vis)
    f = int(OUT_PX / PX)
    h, w = ground.shape
    h2, w2 = h // f * f, w // f * f
    grey = np.clip(np.round(vis[:h2, :w2].reshape(h2 // f, f, w2 // f, f).mean(axis=(1, 3)) * 255), 0, 255).astype(np.uint8)
    meta = {"note": "Sky visibility of the ground (pipeline/skyvis.py, issue 358): the share of the sky's light that reaches a level "
                    "surface 1.5 m above the ground, 0..255, north up, over x..y.",
            "v": VERSION, "x": [frame[0], frame[0] + w2 * PX], "y": [frame[3] - h2 * PX, frame[3]], "px": OUT_PX,
            "eye_m": EYE, "mean": round(float(vis.mean()), 3), "sha256": inputs_sha(city)}
    return meta, grey


def stale(city):
    d = os.path.join(DATA, city)
    try:
        meta = json.load(open(os.path.join(d, "skyvis.json"), encoding="utf8"))
    except (OSError, ValueError):
        return "missing"
    if not os.path.exists(os.path.join(d, "skyvis.webp")):
        return "missing"
    return None if meta.get("sha256") == inputs_sha(city) and meta.get("v") == VERSION else "stale"


def live():
    return subprocess.run(["bash", os.path.join(ROOT, "tools", "live_cities.sh")], stdout=subprocess.PIPE, check=True, text=True).stdout.split()


def main(argv):
    from PIL import Image
    named = [a for a in argv if not a.startswith("--")]
    if "--check" in argv:
        bad = [(c, s) for c in (named or live()) if (s := stale(c))]
        for c, s in bad:
            print(f"FAIL skyvis {c}: skyvis.webp {s}; run python pipeline/skyvis.py {c}")
        if not bad:
            print(f"ok   skyvis {len(named or live())} cities' sky visibility matches their buildings and terrain")
        return 1 if bad else 0
    for city in named or [c for c in live() if stale(c)]:
        t = time.time()
        meta, rgb = bake(city)
        d = os.path.join(DATA, city)
        Image.fromarray(rgb, "L").save(os.path.join(d, "skyvis.webp"), quality=80, method=6)
        with open(os.path.join(d, "skyvis.json"), "w", encoding="utf8") as f:
            json.dump(meta, f, indent=1)
            f.write("\n")
        print(f"{city}: {rgb.shape[1]} x {rgb.shape[0]} px, the ground sees {100 * meta['mean']:.0f}% of the sky on average; "
              f"{os.path.getsize(os.path.join(d, 'skyvis.webp')) / 1e3:.0f} kB in {time.time() - t:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
