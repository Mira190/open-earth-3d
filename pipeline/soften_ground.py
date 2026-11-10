"""The open ground of a built city without the aerial photograph's blotches, without a rebuild (issue #354).

Seen from eye level or low from the air, the photograph draped on the ground reads as dirt wherever it is not a road
or a roof: tree crowns and their shadows, cars, the roofs that lean out of their footprints, each a smear, worst on a
slope. pipeline/aerial_clean.py soften() keeps the open ground's colour at the scale of a slope or a lawn and a
little of its detail, and leaves the roads, the roofs and anything vividly coloured as photographed. build_scene.py
does it in a full build for a city whose city.json has imagery.soften; this does the same to a city as built, from
its own files: the ground tiles (scene.json "ground"), the building footprints (buildings.json) and the roads, paths
and rails (game.json). It then records imagery.soften in city.json, so the next full build gives the same ground, and
"softened" in scene.json, so a second run changes nothing.

    python pipeline/soften_ground.py --city kyoto
    python pipeline/soften_ground.py --all            # every built city with a photographed ground
    python pipeline/soften_ground.py --all --measure  # only print how blotchy each city's open ground is

Run pipeline/pack.py after it (scene.json changes).
"""
import argparse
import json
import os
import re

import numpy as np
from PIL import Image

import aerial_clean
from aerial_clean import _raster
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROAD_W = {"motorway": 16, "trunk": 12, "primary": 12, "secondary": 10, "tertiary": 8, "residential": 6, "unclassified": 6,
          "living_street": 5, "service": 4.5, "pedestrian": 5, "footway": 2.5, "path": 2, "steps": 2.5, "cycleway": 3, "track": 3}
SIGMA_M, KEEP = 6.0, 0.15


def masks(out):
    """The footprints and the roads, paths and rails of a built city, in the local frame (m)."""
    B = json.load(open(os.path.join(out, "buildings.json")))
    k = B["s_fields"].index("ring_dm")
    rings = [list(zip([v / 10 for v in s[k][0::2]], [v / 10 for v in s[k][1::2]])) for s in B["s"]]
    lines = []
    gp = os.path.join(out, "game.json")
    if os.path.exists(gp):
        G = json.load(open(gp))
        for kind in ("road", "foot"):
            for r in G.get("paths", {}).get(kind, []):
                p = r["p"]
                lines.append(([(p[i] / 10, p[i + 1] / 10) for i in range(0, len(p), 3)], ROAD_W.get(r.get("c"), 5)))
        for rail in (G.get("rail") or {}).values():
            for l in rail.get("lines", []) + rail.get("loops", []):
                p = l["p"]
                lines.append(([(p[i] / 10, p[i + 1] / 10) for i in range(0, len(p), 3)], 4.0))
    return rings, lines


def run(cid, measure=False, force=False):
    out = os.path.join(ROOT, "web", "data", cid)
    sp, cp = os.path.join(out, "scene.json"), os.path.join(ROOT, "cities", cid, "city.json")
    if not os.path.exists(sp) or not os.path.exists(os.path.join(out, "buildings.json")):
        return None
    S = json.load(open(sp))
    cfg = json.load(open(cp)) if os.path.exists(cp) else {}
    tiles = S.get("ground") or []
    if cfg.get("imagery", {}).get("type") not in ("xyz", "stac_cog") or not tiles:
        return None
    x0, x1 = min(t["x0"] for t in tiles), max(t["x1"] for t in tiles)
    y0, y1 = min(t["y0"] for t in tiles), max(t["y1"] for t in tiles)
    first = Image.open(os.path.join(out, tiles[0]["file"]))
    px = (tiles[0]["x1"] - tiles[0]["x0"]) / first.size[0]
    W, H = int(round((x1 - x0) / px)), int(round((y1 - y0) / px))
    ortho = np.zeros((H, W, 3), np.uint8)
    place = []
    for t in tiles:
        im = np.asarray(Image.open(os.path.join(out, t["file"])).convert("RGB"))
        c, r = int(round((t["x0"] - x0) / px)), int(round((y1 - t["y1"]) / px))
        h, w = min(im.shape[0], H - r), min(im.shape[1], W - c)
        ortho[r:r + h, c:c + w] = im[:h, :w]
        place.append((t, r, c, im.shape[0], im.shape[1]))
    rings, lines = masks(out)
    built = ndimage.binary_dilation(_raster(rings, x0, y1, px, (H, W), fill=True), iterations=max(1, int(round(2.0 / px))))
    sealed = np.zeros((H, W), bool)
    for w in sorted({wd for _, wd in lines}):
        sealed |= _raster([p for p, wd in lines if wd == w], x0, y1, px, (H, W), width_m=w + 2.0)
    # (the land only: the sea's pixels are under the water plane)
    land = np.ones((H, W), bool)
    shp = os.path.join(out, "shore.png")
    if os.path.exists(shp):
        fr = S["frame"]
        sh = np.asarray(Image.open(shp).convert("RGBA"))[..., 0] > 128
        im = Image.fromarray((~sh).astype(np.uint8) * 255).resize((int(round((fr["x"][1] - fr["x"][0]) / px)), int(round((fr["y"][1] - fr["y"][0]) / px))), Image.NEAREST)
        a = np.asarray(im) > 0
        c, r = int(round((fr["x"][0] - x0) / px)), int(round((y1 - fr["y"][1]) / px))
        if c == 0 and r == 0 and a.shape == land.shape:
            land = a
    open_ = ~(built | sealed) & land
    before = aerial_clean.blotch(ortho, open_, px)
    rep = {"city": cid, "open_share": round(float(open_.mean()), 2), "blotch": round(before, 1), "done": bool(S.get("softened"))}
    if measure or (S.get("softened") and not force):
        return rep
    soft, _ = aerial_clean.soften(ortho, x0, y1, px, rings, lines, SIGMA_M, KEEP)
    rep["after"] = round(aerial_clean.blotch(soft, open_, px), 1)
    for t, r, c, h, w in place:
        tile = np.zeros((h, w, 3), np.uint8)
        hh, ww = min(h, H - r), min(w, W - c)
        tile[:hh, :ww] = soft[r:r + hh, c:c + ww]
        im = Image.fromarray(tile)
        im.save(os.path.join(out, t["file"]), quality=88, optimize=True)
        if t.get("avif"):
            im.save(os.path.join(out, t["avif"]), quality=66, speed=4)
    lo = S.get("ground_lo")
    if lo:
        m = int(round((lo["x1"] - lo["x0"]) / (W * px) * W / (Image.open(os.path.join(out, lo["file"])).size[0])))
        small = Image.fromarray(soft).resize(Image.open(os.path.join(out, lo["file"])).size, Image.LANCZOS)
        small.save(os.path.join(out, lo["file"]), quality=75, optimize=True)
        if lo.get("avif"):
            small.save(os.path.join(out, lo["avif"]), quality=45, speed=4)
    S["softened"] = {"sigma_m": SIGMA_M, "keep": KEEP}
    json.dump(S, open(sp, "w"), separators=(",", ":"), ensure_ascii=False)
    if cfg and not cfg["imagery"].get("soften"):  # (put in as text: the file keeps its layout)
        t = open(cp, encoding="utf8").read()
        m = re.search(r'"imagery"\s*:\s*\{', t)
        add = '"soften": {"sigma_m": %s, "keep": %s},' % (SIGMA_M, KEEP)
        t = t[:m.end()] + ("\n    " + add if t[m.end()] == "\n" else add + " ") + t[m.end():]
        json.loads(t)
        open(cp, "w", encoding="utf8").write(t)
    return rep


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--city")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--measure", action="store_true")
    ap.add_argument("--force", action="store_true", help="soften a city again")
    a = ap.parse_args()
    ids = sorted(os.listdir(os.path.join(ROOT, "web", "data"))) if a.all else [a.city]
    for cid in ids:
        rep = run(cid, a.measure, a.force)
        if rep:
            print(json.dumps(rep), flush=True)


if __name__ == "__main__":
    main()
