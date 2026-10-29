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
- `scene.json`   the frame, grids, water optics (measured from the imagery) and provenance,
                 plus the POIs, spawn and harbour layout from city.json (marine_meta.py).
- `analysis/optics.json` in cities/<id>/: the numbers behind the optics, so they can be checked.

Water-column model (Maritorena et al. 1994): the reflectance seen from above a floor of
albedo A at depth z is  R = A e^(-g Kd z) + Rinf (1 - e^(-g Kd z)),  with Rinf the reflectance
of optically deep water, Kd the diffuse attenuation, and g about 2.2 for the sun's down path
plus the sensor's up path. Rinf comes from the deepest water in the scene. Kd comes from the
colour of that deep water through Lee's quasi-analytical algorithm (qaa.py), unless the site's
own fit of how the brightest (sandy) floor darkens with depth passes a quality test; both are
recorded in optics.json.
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
from marine_meta import meta
from qaa import WAVE, deep_water_kd

G = 2.2
WORLDCOVER = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
# classes in habitat.png
HABITAT = {0: "deep water", 1: "sand", 2: "reef and rock", 3: "seagrass and algae", 4: "rubble",
           10: "forest", 11: "shrub", 12: "grass", 13: "beach and bare", 14: "mangrove", 15: "built", 16: "wetland"}
# 90th percentile of the floor albedo 1-10 m deep (mean of red, green, blue) in the Whitsundays, where the
# habitat thresholds were set; read back from that build's ground.jpg and terrain.bin (its Kd from the depth
# fit, 0.054 blue and 0.080 green). The Whitsundays rebuilt with QAA's Kd read 1.23 times it.
BRIGHT_REF = 0.1593


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


def fill_nodata(z, below=-9000.0):
    """Cells the survey grid does not cover come out of the reprojection at its no-data value
    (-9999; the Whitsundays' westmost column, where the box meets the bbox edge, read -3200 m once
    clipped). They take the value of the nearest covered cell. Returns (z, number filled)."""
    bad = ~np.isfinite(z) | (z < below)
    if not bad.any() or bad.all():
        return z, 0
    idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
    return z[tuple(idx)], int(bad.sum())


def cays(city, cfg, z, tf):
    """Rebuild the land of low coral cays from their mapped outlines.

    The survey model's land on a vegetated cay is a surface model: the forest canopy, 10-20 m above
    the sea on islands whose ground is a few metres high (Heron Island's highest point is 3.6 m). Its
    30 m cells also smear that canopy over the beach and the reef flat around it. For each cay named
    in city.json (terrain.cays.islands) this takes the island outline and its beach from OpenStreetMap
    (Overture base land, fetch_overture.py --only land) and rebuilds the ground: the beach rises from
    0 m (MSL) at the mapped waterline to `hat_m` (the highest astronomical tide above MSL, from MSQ's
    tidal planes) at the vegetation line, the vegetated interior from there to `top_m` within 40 m;
    an islet without a beach ring is sand up to `hat_m`. Within 60 m outside the waterline the sea
    floor is held below -0.3 m, easing to the median depth of the reef flat 60-150 m out.
    Returns (z, report)."""
    import duckdb
    import shapely
    from rasterio.features import rasterize
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    rows = con.execute(f"SELECT name, class, ST_AsWKB(ST_GeomFromWKB(wkb)) FROM '{os.path.join(city.raw, 'overture_land.parquet')}'"
                       " WHERE class IN ('islet', 'island', 'beach')").fetchall()
    geoms = [(n, c, city.to_local(shapely.from_wkb(bytes(g)))) for n, c, g in rows]
    px = tf.a
    hat, top = cfg["hat_m"], cfg["top_m"]
    z = z.copy()
    report = {}
    for name in cfg["islands"]:
        isl = [g for n, c, g in geoms if n == name and c in ("islet", "island")]
        if not isl:
            raise SystemExit(f"cay {name!r} is not in overture_land.parquet; run fetch_overture.py --only land")
        isl = shapely.union_all(isl)
        # the beach ring around the vegetation; a 'beach' that covers the island's middle as well is an outline of the
        # whole cay (Lady Elliot has one), not its beach, and is left out
        mid = isl.representative_point()
        beach = shapely.union_all([g for n, c, g in geoms if c == "beach" and g.intersects(isl.buffer(30)) and not g.contains(mid)]
                                  or [shapely.Polygon()])
        ras = lambda geom: rasterize([geom], out_shape=z.shape, transform=tf, all_touched=False).astype(bool) if not geom.is_empty \
            else np.zeros(z.shape, bool)
        inside = ras(isl.union(beach) if not beach.is_empty else isl)
        if not inside.any():   # smaller than a cell: take the cell under its centre
            c = isl.representative_point()
            i, j = int((c.x - tf.c) / px), int((tf.f - c.y) / px)
            inside[j, i] = True
        veg = inside & ~ras(beach) if not beach.is_empty else np.zeros(z.shape, bool)
        d_in = ndimage.distance_transform_edt(inside) * px                    # from the waterline, inland
        d_out = ndimage.distance_transform_edt(~inside) * px                  # from the waterline, seaward
        if veg.any():
            d_veg = ndimage.distance_transform_edt(veg) * px                  # inside the vegetation, from its edge
            to_veg = ndimage.distance_transform_edt(~veg) * px                # on the beach, to the vegetation
            new = np.where(veg, hat + (top - hat) * np.clip(d_veg / 40, 0, 1), hat * d_in / np.maximum(d_in + to_veg, 1e-3))
        else:
            new = hat * np.clip(d_in / 30, 0, 1)
        z = np.where(inside, new, z)
        ring = (d_out > 60) & (d_out < 150) & (z < 0)
        flat = float(np.median(z[ring])) if ring.any() else -1.0
        near = (d_out > 0) & (d_out <= 60)
        cap = -0.3 + (flat + 0.3) * d_out / 60
        z = np.where(near, np.minimum(z, cap), z)
        report[name] = {"cells": int(inside.sum()), "vegetated": int(veg.sum()), "reef_flat_m": round(flat, 2)}
    return z, report


def rinf_map(refl, deep, sigma_px=120, step=4):
    """Rinf varies across a scene (clear offshore water, greener inshore), so it is the
    reflectance of the deep water (>40 m, where the floor is invisible) smoothed over about
    1.2 km by normalised convolution, and the scene median where there is no deep water."""
    w = deep.astype(np.float32)
    num = ndimage.gaussian_filter((refl * w)[::step, ::step], sigma_px / step, mode="nearest")
    den = ndimage.gaussian_filter(w[::step, ::step], sigma_px / step, mode="nearest")
    m = np.where(den > 2e-3, num / np.maximum(den, 1e-6), float(np.median(refl[deep])))
    return ndimage.zoom(m, step, order=1)[:refl.shape[0], :refl.shape[1]].astype(np.float32)


def fit_kd(depth, refl, rinf, nir, water, lo, hi, pct=90, min_px=800, floor=0.0):
    """Kd from the brightest 10% of pixels in each half-metre of depth (sandy floor): the log of
    (R - Rinf) falls linearly with depth, at slope -g Kd. A depth bin needs `min_px` pixels; a small
    site (one cay and its reef) has too few, so with fewer than 6 bins the fit retries with 200."""
    xs, ys = [], []
    a = refl - rinf
    for z0 in np.arange(lo, hi, 0.5):
        m = water & (depth >= z0) & (depth < z0 + 0.5) & (nir < 0.01)
        if m.sum() < min_px:
            continue
        v = a[m]
        v = v[v >= np.percentile(v, pct)]
        xs.append(z0 + 0.25)
        ys.append(math.log(max(float(np.median(v)), 1e-5)))
    if len(xs) < 6 and min_px > 200:
        return fit_kd(depth, refl, rinf, nir, water, lo, hi, pct, 200, floor)
    if len(xs) < 2:
        return float("nan"), float("nan"), float("nan"), len(xs)
    p = np.polyfit(xs, ys, 1)
    if -p[0] / G < floor:   # held at the floor's slope, with the intercept that fits best with it
        q = [-G * floor, float(np.mean(np.array(ys) + G * floor * np.array(xs)))]
        res = np.array(ys) - np.polyval(q, xs)
        return float(-p[0] / G), float(math.exp(q[1])), float(res.std()), len(xs)
    res = np.array(ys) - np.polyval(p, xs)
    return -p[0] / G, float(math.exp(p[1])), float(res.std()), len(xs)


def sand_spread(refl, rinf, kd, water, depth, nir):
    """The depth check for one band and one Kd: the spread (max - min over the mean, %) of the
    brightest floor's inverted albedo in four depth bins across 1-15 m. A Kd that takes the water
    out correctly leaves the same sand equally bright at every depth."""
    vals = []
    for z0, z1 in ((1, 3), (3, 6), (6, 10), (10, 15)):
        m = water & (depth >= z0) & (depth < z1) & (nir < 0.01)
        if m.sum() < 50:
            continue
        top = m & (refl >= np.percentile(refl[m], 90))
        tr = np.exp(-G * kd * depth[top])
        vals.append(float(np.median((refl[top] - rinf[top] * (1 - tr)) / np.maximum(tr, 1e-3))))
    return round(100 * (max(vals) - min(vals)) / np.mean(vals), 1) if len(vals) > 1 else None


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
    with rasterio.open(bathy) as b:
        grid_letter = b.tags().get("GBR_GRID")  # fetch_gbr_bathy.py tags the crop with its source grid

    # ---- terrain at 30 m, in the local frame
    cell = cfg["terrain"]["pixel_m"]
    tw, th = int(math.ceil((city.x1 - city.x0) / cell)), int(math.ceil((city.y1 - city.y0) / cell))
    tf30 = from_origin(city.x0, city.y1, cell, cell)
    z30, gaps = fill_nodata(reproj(bathy, tf30, (th, tw), city.proj, Resampling.bilinear, nodata=-9999))
    # and at 10 m for the colour work
    z10, _ = fill_nodata(reproj(bathy, tf10, (H, W), city.proj, Resampling.bilinear, nodata=-9999))
    if gaps:
        print(f"terrain: {gaps} cells outside the survey grid filled from the nearest covered cell")
    cay_cfg = cfg["terrain"].get("cays")
    if cay_cfg:
        z30, cay_report = cays(city, cay_cfg, z30, tf30)
        z10, _ = cays(city, cay_cfg, z10, tf10)
        print("cays rebuilt:", cay_report)
    (np.round(z30 * 10).clip(-32000, 32000).astype("<i2")).tofile(os.path.join(city.out, "terrain.bin"))
    depth = -z10
    wc = worldcover(cfg["bbox"], tf10, (H, W), city.proj)

    # ---- reflectance and the optics of the water
    refl = {k: s2[k].astype(np.float32) * 1e-4 for k in ("blue", "green", "red", "nir")}
    water = (depth > 0.2) & (wc != 10) & (wc != 30) & (wc != 20)
    deep = (depth > 40) & water & (refl["blue"] > 0)
    rinf = {k: rinf_map(refl[k], deep) for k in ("blue", "green", "red")}
    bands = {"blue": (2, 20), "green": (2, 12), "red": (0.5, 4)}
    # Kd cannot be lower than the water's own absorption (Pope & Fry 1997: a_w = 0.0150 /m at 490 nm, 0.0619 at
    # 560 nm, 0.429 at 665 nm, where 0.40 has always been used). Red is too weak and noisy to fit anywhere, so it
    # always takes its floor; blue and green take theirs where the fit falls below it, which happens when the
    # brightest floor gets brighter with depth (Lady Elliot Island: a dark reef flat ringed by a pale sand apron),
    # and the sand albedo is then the intercept at the floor's slope
    kd_floor = {"blue": 0.0150, "green": 0.0619, "red": 0.40}
    # The depth fit reads a change of floor type with depth as attenuation. qaa.py derives Kd from water too
    # deep to show its floor (Lee's QAA_v6 and Kd model). Rule, per band: QAA, unless the site's own depth fit
    # passes a quality test, in which case the fit (measured on the site's floor) is kept. The test: the
    # bright-floor profile is straight (residual sd of ln(R - Rinf) at most 0.06) and the inversion with the
    # fit leaves the sand's brightness within 20% across 1-15 m (the depth check below). Without QAA (too
    # little deep water, no coastal band) the fit, held at the floor. Red keeps the pure-water floor: its fit is
    # too weak to test, and QAA's red rests on an Rrs(665) of a few 1e-4 /sr that the atmospheric correction's
    # residual dominates (0.30-1.16 /m across the five sites); QAA's red is recorded.
    q = deep_water_kd(s2, depth)
    q_kd = {k: q["band"][WAVE[k]]["Kd"] for k in bands} if q else {}
    kd, optics = {}, {}
    num = lambda v: None if v != v else v   # a failed fit (nan) is written as null
    for k, (lo, hi) in bands.items():
        fit, sand, sd, n = fit_kd(depth, refl[k], rinf[k], refl["nir"], water, lo, hi, floor=0.0 if k == "red" else kd_floor[k])
        o = {"Rinf_median": float(np.median(rinf[k])), "Kd_fit": num(fit), "Kd_qaa": q_kd.get(k), "sand_albedo": sand,
             "fit_resid_sd_ln": num(sd), "depth_bins": n, "fit_depth_m": [lo, hi]}
        if k != "red" and fit == fit:
            o["depth_check_fit_pct"] = sand_spread(refl[k], rinf[k], max(fit, kd_floor[k]), water, depth, refl["nir"])
            if k in q_kd:
                o["depth_check_qaa_pct"] = sand_spread(refl[k], rinf[k], q_kd[k], water, depth, refl["nir"])
        passes = k != "red" and fit == fit and fit >= kd_floor[k] and sd <= 0.06 and o.get("depth_check_fit_pct", 1e9) <= 20
        if k == "red":
            kd[k], o["Kd_choice"] = kd_floor[k], "pure-water floor"
        elif passes:
            kd[k], o["Kd_choice"] = fit, "fit (passes the test)"
        elif k in q_kd:
            kd[k], o["Kd_choice"] = max(q_kd[k], kd_floor[k]), "qaa"
        elif fit == fit:
            kd[k], o["Kd_choice"] = max(fit, kd_floor[k]), "fit (no QAA)"
        else:
            kd[k], o["Kd_choice"] = kd_floor[k], "pure-water floor"
        o["Kd"] = kd[k]
        optics[k] = o
        print(k, "Rinf %.4f  Kd fit %.3f  QAA %s  used %.3f /m (%s)  resid %.3f" % (
            o["Rinf_median"], fit, "%.3f" % q_kd[k] if k in q_kd else "-", kd[k], o["Kd_choice"], sd),
            "  depth check fit %s / QAA %s" % (o.get("depth_check_fit_pct"), o.get("depth_check_qaa_pct")))

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
    # The thresholds were set on the Whitsundays floors. Where the inverted floor reads brighter or darker
    # overall (other water, a carbonate reef flat instead of mud and silica sand), they are scaled by the
    # brightness of the scene's own bright floor, the 90th percentile of the floor albedo 1-10 m deep, so a
    # class boundary stays at the same share of it: k = 1 for the Whitsundays' first build (to within the JPEG
    # rounding of the reference) and 1.23 for its rebuild with QAA's Kd, 1.18 at Hardy Reef. The green-cast
    # test (green over blue) is not scaled: a Kd that rises more in blue than in green makes the deeper floor
    # read bluer, which took the Whitsundays' seagrass class from 4.1% to 1.4% (most of what it lost lay
    # 11-23 m deep, where the floor colour is mostly the fill, not a seen floor).
    bright = (A_r + A_g + A_b) / 3
    k_hab = float(np.percentile(bright[water & (depth > 1) & (depth < 10)], 90)) / BRIGHT_REF
    bright = bright / k_hab
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
    # land that WorldCover calls water or leaves out (a sand cay, an intertidal bank) is bare ground, not deep water
    hab[~water & (hab == 0)] = 13
    Image.fromarray(hab).save(os.path.join(city.out, "habitat.png"), optimize=True)
    share = {HABITAT[k]: round(float((hab == k).mean()), 4) for k in HABITAT if (hab == k).any()}
    print("habitat share", share, "thresholds scaled by %.3f" % k_hab)

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
               "depth_check": check, "habitat_scale": k_hab, "habitat_share": share, "terrain_grid": grid_letter, "qaa": q,
               "note": "Rinf: reflectance of deep water (>40 m), smoothed. Kd: diffuse attenuation. Kd_fit: from how the brightest floor darkens with depth (2-20 m blue, 2-12 m green, 0.5-4 m red). Kd_qaa: from the deep water's colour, QAA_v6 and Lee et al. 2005 (qaa.py). Kd: QAA unless the fit passes the quality test (residual sd of ln(R - Rinf) at most 0.06 and depth check at most 20%); red keeps the pure-water floor 0.40 (QAA red recorded). depth_check_*_pct: the sand brightness spread across 1-15 m after inversion with that Kd."},
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
    scene.update(meta(city))
    json.dump(scene, open(os.path.join(city.out, "scene.json"), "w"), indent=1)
    print("scene.json written")


if __name__ == "__main__":
    main()
