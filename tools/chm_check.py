"""How well the open canopy height models read a city's surveyed trees.

    python tools/chm_check.py --city sydney

For each surveyed tree (pipeline/plateau_veg.py: PLATEAU's or a council's inventory) this reads the
highest canopy within RADIUS_M of the trunk from Meta and WRI's High Resolution Canopy Height Maps,
version 1 (2024, ~1 m) and version 2 (CHMv2, 2026, ~1 m), both CC BY 4.0 on the AWS Registry of
Open Data, read anonymously with HTTP range requests. It prints the correlation, the median
absolute error and the share within 3 m of the survey, so that a model is used for a city's trees
only where it reads them.
"""
import argparse
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
from cityctx import City  # noqa: E402
import plateau_veg  # noqa: E402

MODELS = {
    "v1": ("https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/{}.tif", 9),
    "v2": ("https://dataforgood-fb-data.s3.amazonaws.com/forests/v2/global/dinov3_global_chm_v2_ml3/chm/{}.tif", 10),
}
RADIUS_M = 2.5


def quadkey(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return "".join(str(((x >> (i - 1)) & 1) + 2 * ((y >> (i - 1)) & 1)) for i in range(z, 0, -1))


def sample(url, z, lon, lat):
    """The highest canopy (m) within RADIUS_M of each point, from the model's tiles over them."""
    import rasterio
    from pyproj import Transformer
    from rasterio.windows import from_bounds
    to3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    X, Y = to3857.transform(lon, lat)
    X, Y = np.asarray(X), np.asarray(Y)
    out = np.full(len(X), np.nan)
    keys = np.array([quadkey(a, b, z) for a, b in zip(lon, lat)])
    pad = RADIUS_M / math.cos(math.radians(float(np.mean(lat)))) + 2  # mercator metres per ground metre
    for k in sorted(set(keys)):
        sel = keys == k
        with rasterio.open("/vsicurl/" + url.format(k)) as r:
            win = from_bounds(X[sel].min() - pad, Y[sel].min() - pad, X[sel].max() + pad, Y[sel].max() + pad, r.transform)
            win = win.round_offsets().round_lengths()
            a = r.read(1, window=win, boundless=True, fill_value=0).astype(np.float32)
            t = r.window_transform(win)
            rx = t.a
            k_px = max(1, int(round(pad / rx)))
            col = ((X[sel] - t.c) / rx).astype(int)
            row = ((t.f - Y[sel]) / -t.e).astype(int)
            vals = []
            for c0, r0 in zip(col, row):
                w = a[max(0, r0 - k_px):r0 + k_px + 1, max(0, c0 - k_px):c0 + k_px + 1]
                vals.append(float(w.max()) if w.size else np.nan)
            out[sel] = vals
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--city", required=True)
    ap.add_argument("--n", type=int, default=3000, help="trees to sample (a fixed random subset)")
    a = ap.parse_args()
    C = City(a.city)
    S = np.array(plateau_veg.surveyed_trees(C), np.float64)
    if not len(S):
        sys.exit(f"{a.city}: no surveyed trees")
    idx = np.random.default_rng(0).permutation(len(S))[:a.n]
    S = S[idx]
    for name, (url, z) in MODELS.items():
        m = sample(url, z, S[:, 0], S[:, 1])
        ok = np.isfinite(m)
        h, g = S[ok, 2], m[ok]
        seen = g >= 2
        err = np.abs(g - h)
        print(f"{a.city} {name}: {ok.sum()} trees; the model sees {seen.mean():.0%} of them (>= 2 m); "
              f"correlation {np.corrcoef(h, g)[0, 1]:.2f}, median |error| {np.median(err):.1f} m, within 3 m {np.mean(err <= 3):.0%}; "
              f"survey median {np.median(h):.1f} m, model median {np.median(g):.1f} m")


if __name__ == "__main__":
    main()
