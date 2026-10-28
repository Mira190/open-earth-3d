"""An independent check of the model's building mass, from data rejected as terrain.

Over a city centre the AWS Terrarium tiles are often a radar surface model
(SRTM, February 2000) that includes buildings, smoothed over ~30 m. Subtracting
the bare-earth DEM leaves a "building excess" measured by a sensor that knows
nothing about OpenStreetMap. Averaged over city blocks, it should track the mean
height of the model's buildings.

Two results:
  * agreement: correlation and slope between block-mean model height and the
    radar excess across the analysis region (a slope near 1 means no systematic
    height bias, given the radar's age and smoothing);
  * detection power: put a known open-data miss back at its open-data height
    (city.json "radar_test_building", else the largest reference correction) and
    see where its block ranks among the residuals.

    python analysis/radar_check.py --city sydney      # -> cities/<city>/analysis/radar_check.json
"""
import json
import os
import sys
import warnings

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))
from build_scene import load_dem  # noqa: E402
from cityctx import city_args  # noqa: E402
from fetch_tiles import tile_xy  # noqa: E402

CELL = 5.0
warnings.filterwarnings("ignore", category=RuntimeWarning)


def terrarium_grid(C, nx, ny):
    gx, gy = np.meshgrid(C.x0 + np.arange(nx) * CELL, C.y1 - np.arange(ny) * CELL)
    lon, lat = C.inv.transform(gx.ravel(), gy.ravel())
    out, tiles = np.empty(lon.size, np.float32), {}
    for k, (lo, la) in enumerate(zip(lon, lat)):
        x, y = tile_xy(lo, la, 15)
        key = (int(x), int(y))
        if key not in tiles:
            tiles[key] = np.asarray(Image.open(os.path.join(C.raw, "terrarium", "15", f"{key[0]}_{key[1]}.png")).convert("RGB")).astype(np.float32)
        r, g, b = tiles[key][int((y % 1) * 256), int((x % 1) * 256)]
        out[k] = r * 256 + g + b / 256 - 32768
    return out.reshape(ny, nx)


def model_grid(C, nx, ny, B):
    """Height above ground (max over solids) and the owning building, on the 5 m grid."""
    h, owner = Image.new("F", (nx, ny), 0.0), Image.new("I", (nx, ny), -1)
    dh, do = ImageDraw.Draw(h), ImageDraw.Draw(owner)
    for s in sorted(B["s"], key=lambda s: s[3]):  # tallest last, so max wins
        pts = [((s[4][k] / 10 - C.x0) / CELL, (C.y1 - s[4][k + 1] / 10) / CELL) for k in range(0, len(s[4]), 2)]
        if len(pts) >= 3:
            dh.polygon(pts, fill=s[3] / 10)
            do.polygon(pts, fill=s[0])
    return np.asarray(h, np.float32), np.asarray(owner)


def blocks(a, blk):
    ny, nx = (a.shape[0] // blk) * blk, (a.shape[1] // blk) * blk
    return np.nanmean(a[:ny, :nx].reshape(ny // blk, blk, nx // blk, blk), axis=(1, 3))


def test_building(C, B):
    name = C.cfg.get("radar_test_building")
    if name:
        return next(i for i, m in enumerate(B["b"]) if m[0] == name)
    fixed = [i for i, m in enumerate(B["b"]) if m[4] == "reference"]
    return max(fixed, key=lambda i: B["b"][i][2] - B["b"][i][9]) if fixed else None


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    if json.load(open(os.path.join(C.raw, "dem.json"))).get("source") == "terrarium":
        raise SystemExit(f"{C.id}: terrain is Terrarium itself, so there is no independent excess to measure")
    B = json.load(open(os.path.join(C.out, "buildings.json")))
    dem = load_dem(C)
    ny, nx = dem.shape
    excess = terrarium_grid(C, nx, ny) - dem
    land = dem > 1.0
    h, owner = model_grid(C, nx, ny, B)
    tb = test_building(C, B)
    variants = [("model", h)]
    if tb is not None:
        h_open = h.copy()
        h_open[owner == tb] = B["b"][tb][9]
        variants.append(("model_with_test_missing", h_open))
    rx0, rx1, ry0, ry1 = C.cfg.get("analysis_region", C.cfg["extent_m"])
    out = {"note": "SRTM (Feb 2000) surface excess over the bare-earth DEM vs block-mean model height, analysis region, land blocks only",
           "test_building": B["b"][tb][0] if tb is not None else None, "scales": []}
    for blk in (20, 30, 40):
        E, L = blocks(np.where(land, excess, np.nan), blk), blocks(land.astype(float), blk)
        sel = np.zeros_like(E, bool)
        sel[int((C.y1 - ry1) / CELL) // blk:int((C.y1 - ry0) / CELL) // blk, int((rx0 - C.x0) / CELL) // blk:int((rx1 - C.x0) / CELL) // blk] = True
        sel &= L > 0.8
        row = {"block_m": blk * CELL, "blocks": int(sel.sum())}
        for name, H in variants:
            M = blocks(H, blk)
            slope, icpt = np.polyfit(M[sel], E[sel], 1)
            res = E - (slope * M + icpt)
            row[name] = {"r": round(float(np.corrcoef(M[sel], E[sel])[0, 1]), 3), "slope": round(float(slope), 3), "intercept_m": round(float(icpt), 1),
                         "rmse_m": round(float(np.sqrt(np.mean(res[sel] ** 2))), 1)}
            if tb is not None:
                qr, qc = (np.argwhere(owner == tb).mean(axis=0) // blk).astype(int)
                row[name].update({"test_block_residual_m": round(float(res[qr, qc]), 1), "test_block_rank": int((res[sel] > res[qr, qc]).sum()) + 1})
        out["scales"].append(row)
        print(json.dumps(row))
    json.dump(out, open(os.path.join(C.analysis, "radar_check.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
