"""Build a marine city's scene from the raw downloads: bathymetry, Sentinel-2, land cover.

    python pipeline/build_marine.py --city whitsundays

Reads data/raw/<id>/ (fetch_gbr_bathy.py, fetch_sentinel.py, ESA WorldCover) and writes
web/data/<id>/:

- `terrain.bin`  the height grid: int16 little-endian decimetres, row 0 the northernmost,
                 `terrain.cell_m` per cell, from the survey bathymetry (sea) and its DEM (land).
- `ground.jpg`   the ground colour at 10 m: what a diver sees on the sea floor, and the
                 satellite colour on land. The sea floor is *not* the satellite image. The sea
                 hides the floor behind its own colour, so the image is inverted through the
                 water column (below) to get the floor's own colour, and the viewer puts the
                 water back with the same optics. A render from above reproduces the satellite.
- `habitat.png`  one class per 10 m pixel (see HABITAT in this file).
- `scene.json`   the frame, grids, water optics (measured from the imagery) and provenance.
- `analysis/optics.json` in cities/<id>/: the numbers behind the optics, so they can be checked.

Water-column model (Maritorena et al. 1994): the reflectance seen from above a floor of
albedo A at depth z is  R = A e^(-g Kd z) + Rinf (1 - e^(-g Kd z)),  with Rinf the reflectance
of optically deep water, Kd the diffuse attenuation, and g about 2.2 for the sun's down path
plus the sensor's up path. Rinf comes from the deepest water in the scene; Kd from how the
brightest (sandy) floor darkens with depth, one band at a time.
"""
import json
import math
import os

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from scipy import ndimage

from cityctx import city_args

G = 2.2
WORLDCOVER = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
# classes in habitat.png
HABITAT = {0: "deep water", 1: "sand", 2: "reef and rock", 3: "seagrass and algae", 4: "rubble",
           10: "forest", 11: "shrub", 12: "grass", 13: "beach and bare", 14: "mangrove", 15: "built", 16: "wetland"}


def reproj(path, dst_tf, shape, crs, resampling, nodata=None, band=1):
    out = np.zeros(shape, np.float32)
    with rasterio.open(path) as s:
        reproject(rasterio.band(s, band), out, src_transform=s.transform, src_crs=s.crs, src_nodata=nodata,
                  dst_transform=dst_tf, dst_crs=crs, resampling=resampling)
    return out


def worldcover(bbox, dst_tf, shape, crs):
    """ESA WorldCover 10 m land cover (CC BY 4.0), 3-degree tiles, read as COGs."""
    w, s, e, n = bbox
    out = np.zeros(shape, np.uint8)
    tiles = set()
    for lat in (s, n):
        for lon in (w, e):
            tiles.add(f"{'S' if lat < 0 else 'N'}{int(math.floor(lat / 3) * 3 * (-1 if lat < 0 else 1)):02d}"
                      f"{'E' if lon >= 0 else 'W'}{int(math.floor(lon / 3) * 3):03d}")
    for t in sorted(tiles):
        tmp = np.zeros(shape, np.float32)
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
            with rasterio.open(WORLDCOVER.format(tile=t)) as src:
                reproject(rasterio.band(src, 1), tmp, src_transform=src.transform, src_crs=src.crs, src_nodata=0,
                          dst_transform=dst_tf, dst_crs=crs, resampling=Resampling.nearest)
        out = np.where(tmp > 0, tmp.astype(np.uint8), out)
    return out


def rinf_map(refl, deep, sigma_px=120, step=4):
    """Rinf varies across a scene (clear offshore water, greener inshore), so it is the
    reflectance of the deep water (>40 m, where the floor is invisible) smoothed over about
    1.2 km by normalised convolution, and the scene median where there is no deep water."""
    w = deep.astype(np.float32)
    num = ndimage.gaussian_filter((refl * w)[::step, ::step], sigma_px / step, mode="nearest")
    den = ndimage.gaussian_filter(w[::step, ::step], sigma_px / step, mode="nearest")
    m = np.where(den > 2e-3, num / np.maximum(den, 1e-6), float(np.median(refl[deep])))
    return ndimage.zoom(m, step, order=1)[:refl.shape[0], :refl.shape[1]].astype(np.float32)


def fit_kd(depth, refl, rinf, nir, water, lo, hi, pct=90):
    """Kd from the brightest 10% of pixels in each half-metre of depth (sandy floor): the log of
    (R - Rinf) falls linearly with depth, at slope -g Kd."""
    xs, ys = [], []
    a = refl - rinf
    for z0 in np.arange(lo, hi, 0.5):
        m = water & (depth >= z0) & (depth < z0 + 0.5) & (nir < 0.01)
        if m.sum() < 800:
            continue
        v = a[m]
        v = v[v >= np.percentile(v, pct)]
        xs.append(z0 + 0.25)
        ys.append(math.log(max(float(np.median(v)), 1e-5)))
    p = np.polyfit(xs, ys, 1)
    res = np.array(ys) - np.polyval(p, xs)
    return -p[0] / G, float(math.exp(p[1])), float(res.std()), len(xs)


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def main():
    city, a = city_args("Build a marine city's scene")
    cfg = city.cfg
    os.makedirs(city.out, exist_ok=True)
    os.makedirs(city.analysis, exist_ok=True)
    s2 = np.load(os.path.join(city.raw, "s2.npz"))
    H, W = s2["blue"].shape
    px = float(s2["pixel_m"])
    tf10 = from_origin(city.x0, city.y1, px, px)
    bathy = os.path.join(city.raw, "bathy.tif")

    # ---- terrain at 30 m, in the local frame
    cell = cfg["terrain"]["pixel_m"]
    tw, th = int(math.ceil((city.x1 - city.x0) / cell)), int(math.ceil((city.y1 - city.y0) / cell))
    z30 = reproj(bathy, from_origin(city.x0, city.y1, cell, cell), (th, tw), city.proj, Resampling.bilinear, nodata=-9999)
    (np.round(z30 * 10).clip(-32000, 32000).astype("<i2")).tofile(os.path.join(city.out, "terrain.bin"))
    # and at 10 m for the colour work
    z10 = reproj(bathy, tf10, (H, W), city.proj, Resampling.bilinear, nodata=-9999)
    depth = -z10
    wc = worldcover(cfg["bbox"], tf10, (H, W), city.proj)

    # ---- reflectance and the optics of the water
    refl = {k: s2[k].astype(np.float32) * 1e-4 for k in ("blue", "green", "red", "nir")}
    water = (depth > 0.2) & (wc != 10) & (wc != 30) & (wc != 20)
    deep = (depth > 40) & water & (refl["blue"] > 0)
    rinf = {k: rinf_map(refl[k], deep) for k in ("blue", "green", "red")}
    bands = {"blue": (2, 20), "green": (2, 12), "red": (0.5, 4)}
    # red is absorbed by the water itself (a_w(665 nm) = 0.41 /m, Pope & Fry 1997); the
    # imagery's red band is too weak and too noisy to fit, so red uses that as a floor
    kd_floor = {"red": 0.40}
    kd, optics = {}, {}
    for k, (lo, hi) in bands.items():
        fit, sand, sd, n = fit_kd(depth, refl[k], rinf[k], refl["nir"], water, lo, hi)
        kd[k] = max(fit, kd_floor.get(k, 0))
        optics[k] = {"Rinf_median": float(np.median(rinf[k])), "Kd_fit": fit, "Kd": kd[k], "sand_albedo": sand,
                     "fit_resid_sd_ln": sd, "depth_bins": n, "fit_depth_m": [lo, hi]}
        print(k, "Rinf %.4f  Kd fit %.3f used %.3f /m  sand albedo %.3f" % (optics[k]["Rinf_median"], fit, kd[k], sand), "resid", round(sd, 3))

    # ---- invert the water column: the floor's own colour
    albedo, valid = {}, {}
    for k in ("blue", "green", "red"):
        tr = np.exp(-G * kd[k] * np.clip(depth, 0, None))
        A = (refl[k] - rinf[k] * (1 - tr)) / np.maximum(tr, 1e-3)
        ok = water & (tr > 0.18) & (refl[k] > 0)
        albedo[k], valid[k] = A, ok
    # where the signal is gone (deep, or red below a few metres) borrow from what is known:
    # nearest valid blue/green, and red from green at the local red:green ratio
    def fill(A, ok, sigmas=(6, 20, 70, 220), step=3):
        """Extend a quantity from where it is known to where it is not: normalised convolution
        at growing radii (the finest radius that has enough neighbours wins), so deep floors,
        which the imagery cannot see, get a smooth plausible colour instead of a hard edge."""
        w = ok.astype(np.float32)
        small, ws = (A * w)[::step, ::step], w[::step, ::step]
        out = np.full(small.shape, float(np.median(A[ok])), np.float32)
        done = np.zeros(small.shape, bool)
        for sg in sigmas:
            num, den = ndimage.gaussian_filter(small, sg / step), ndimage.gaussian_filter(ws, sg / step)
            take = (den > 0.04) & ~done
            out[take] = (num / np.maximum(den, 1e-6))[take]
            done |= take
        return ndimage.zoom(out, step, order=1)[:A.shape[0], :A.shape[1]]
    # confidence: 1 where the floor shows through well, fading to 0 where its signal is gone
    def conf(k):
        tr = np.exp(-G * kd[k] * np.clip(depth, 0, None))
        return np.clip((tr - 0.10) / 0.25, 0, 1) * water
    cb, cg = conf("blue"), conf("green")
    A_b = cb * albedo["blue"] + (1 - cb) * fill(albedo["blue"], cb > 0.5)
    A_g = cg * albedo["green"] + (1 - cg) * fill(albedo["green"], cg > 0.5)
    ratio = np.where(valid["red"] & valid["green"], albedo["red"] / np.maximum(albedo["green"], 0.01), 0.0)
    wgt = (valid["red"] & valid["green"]).astype(np.float32)
    num = ndimage.gaussian_filter(ratio * wgt, 25)
    den = ndimage.gaussian_filter(wgt, 25)
    local_ratio = np.where(den > 0.02, num / np.maximum(den, 1e-6), np.nan)
    gl = np.nanmedian(local_ratio)
    local_ratio = np.where(np.isnan(local_ratio), gl, local_ratio)
    A_r = np.where(valid["red"], albedo["red"], A_g * np.clip(local_ratio, 0.3, 1.1))
    A_b, A_g, A_r = [np.clip(x, 0.005, 0.9) for x in (A_b, A_g, A_r)]

    # ---- ground colour: floor albedo under water, surface reflectance on land
    land = ~water
    gain = 1.6  # satellite surface reflectance reads dark; lift it to a photographic exposure
    land_rgb = np.stack([refl["red"], refl["green"], refl["blue"]], -1) * gain
    sea_rgb = np.stack([A_r, A_g, A_b], -1)
    # the 0.2 m intertidal margin blends between the two
    mix = np.clip((depth + 0.2) / 0.8, 0, 1)[..., None]
    rgb = np.where(land[..., None], land_rgb, sea_rgb * mix + land_rgb * (1 - mix))
    img = (srgb(rgb) * 255 + 0.5).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(city.out, "ground.jpg"), quality=88, optimize=True)

    # ---- habitat: an inference from the floor's colour and depth, not a survey. Dark floors in
    # shallow water are hard substrate with coral and algae; bright ones are sand; a green cast on
    # a mid-tone floor is seagrass or algae. The Allen Coral Atlas maps this properly.
    bright = (A_r + A_g + A_b) / 3
    gb = A_g / (A_b + 1e-3)
    hab = np.zeros((H, W), np.uint8)
    sea = water & (depth < 25)
    hab[sea] = 4
    hab[sea & (bright >= 0.105)] = 1
    hab[sea & (bright < 0.10) & (bright >= 0.06) & (gb > 1.45)] = 3
    hab[sea & (bright < 0.06)] = 2
    hab[water & (depth >= 25)] = 0
    hab = ndimage.median_filter(hab, size=3)
    lc = {10: 10, 20: 11, 30: 12, 40: 12, 50: 15, 60: 13, 90: 16, 95: 14, 100: 11}
    for k, v in lc.items():
        hab[~water & (wc == k)] = v
    sandy_land = ~water & (srgb(land_rgb).mean(-1) > 0.62) & (z10 < 5)
    hab[sandy_land] = 13
    Image.fromarray(hab).save(os.path.join(city.out, "habitat.png"), optimize=True)
    share = {HABITAT[k]: round(float((hab == k).mean()), 4) for k in HABITAT if (hab == k).any()}
    print("habitat share", share)

    # ---- a check the inversion has to pass: the brightest floor (sand) should have the same
    # albedo at every depth once the water is taken out. Raw reflectance falls with depth;
    # the inverted albedo should not.
    check = {}
    for k, A in (("blue", albedo["blue"]), ("green", albedo["green"])):
        rows = []
        for z0, z1 in ((1, 3), (3, 6), (6, 10), (10, 15)):
            m = water & (depth >= z0) & (depth < z1) & (refl["nir"] < 0.01)
            thr = np.percentile(refl[k][m], 90)
            top = m & (refl[k] >= thr)
            rows.append({"depth_m": [z0, z1], "raw_reflectance": float(np.median(refl[k][top])),
                         "inverted_albedo": float(np.median(A[top]))})
        raw = [r["raw_reflectance"] for r in rows]
        inv = [r["inverted_albedo"] for r in rows]
        check[k] = {"bins": rows, "spread_raw_pct": float(100 * (max(raw) - min(raw)) / np.mean(raw)),
                    "spread_inverted_pct": float(100 * (max(inv) - min(inv)) / np.mean(inv))}
        print(k, "sand brightness spread across 1-15 m: raw %.0f%% -> inverted %.0f%%" % (check[k]["spread_raw_pct"], check[k]["spread_inverted_pct"]))
    json.dump({"band": optics, "g": G, "scenes": json.loads(str(s2["scenes"])),
               "depth_check": check, "note": "Rinf: reflectance of deep water (>40 m), smoothed. Kd: diffuse attenuation, from how the brightest floor darkens with depth; red uses the pure-water absorption as a floor."},
              open(os.path.join(city.analysis, "optics.json"), "w"), indent=1)
    scene = {
        "id": city.id, "name": cfg["name"], "kind": "marine", "origin": cfg["origin"], "timezone": cfg["timezone"],
        "extent_m": cfg["extent_m"], "vertical_datum": cfg.get("vertical_datum"),
        "terrain": {"file": "terrain.bin", "w": tw, "h": th, "cell_m": cell, "x0": city.x0, "y1": city.y1, "units_m": 0.1},
        "ground": {"file": "ground.jpg", "w": W, "h": H, "px_m": px},
        "habitat": {"file": "habitat.png", "classes": HABITAT},
        "start": cfg.get("start"),
        "optics": {"K": [kd["red"], kd["green"], kd["blue"]],
                   "Rinf": [float(np.median(rinf[k])) for k in ("red", "green", "blue")], "g": G},
        "sources": {"terrain": cfg["terrain"]["attribution"], "imagery": cfg["imagery"]["attribution"],
                    "landcover": "ESA WorldCover 10 m 2021 v200 (CC BY 4.0)"},
    }
    json.dump(scene, open(os.path.join(city.out, "scene.json"), "w"), indent=1)
    np.savez_compressed("/tmp/q/benthic.npz", A_r=A_r, A_g=A_g, A_b=A_b, depth=depth, wc=wc)
    print("scene.json written")


if __name__ == "__main__":
    main()
