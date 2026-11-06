"""Clean an aerial photograph for the ground at eye level (pipeline/alpine_detail.py, issue #228):

1. Parked cars out of the roads and car parks. Seen from eye level, a car printed in a 0.3 m photograph is a grey or
   coloured smear on the tarmac. On the sealed ground (within 16 m of a road's line in roads.json: the streets, the
   highway, the car parks' aisles and the parking along them), a car is a compact blob that differs from the tarmac round it (brighter, darker or
   more coloured than the median over 12 m) and is at least 1.2 m across, so the painted lines (a pixel or two wide) stay.
   Each blob, with its shadow and a pixel's margin, is filled from the tarmac round it (normalised convolution: the
   blurred colour of the unmasked pixels nearby, with the photograph's own fine grain laid back on).
2. Printed shadows lifted. The photograph's shadows (of buildings, at the hour it was flown) double up with the
   viewer's own when the sun is elsewhere. Next to a building (within 10 m of a footprint in structures.json, not on its
   roof or the road), deep grey shadows on open ground, under half as bright as the ground round them, are brightened
   part of the way toward it.

    clean(rgb, x0, y1, px, out_dir) -> rgb, report
"""
import json
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def _raster(lines_or_polys, x0, y1, px, shape, width_m=None, fill=False):
    """Draw lines (with width) or polygons into a mask in the photograph's pixels."""
    H, W = shape
    im = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(im)
    to = lambda p: ((p[0] - x0) / px, (y1 - p[1]) / px)
    for g in lines_or_polys:
        pts = [to(p) for p in g]
        if len(pts) < 2:
            continue
        if fill:
            d.polygon(pts, fill=255)
        else:
            d.line(pts, fill=255, width=max(1, int(round(width_m / px))), joint="curve")
    return np.array(im) > 0


def clean(rgb, x0, y1, px, out_dir):
    H, W = rgb.shape[:2]
    rep = {}
    roads = json.load(open(os.path.join(out_dir, "roads.json"))).get("lines", [])
    # the sealed ground: 10 m either side of a street's line, 16 m along the service roads and car parks' aisles
    street = [l["p"] for l in roads if l.get("c") in ("primary", "trunk", "secondary", "tertiary", "residential", "unclassified")]
    service = [l["p"] for l in roads if l.get("c") == "service"]
    road = _raster(street, x0, y1, px, (H, W), width_m=20) | _raster(service, x0, y1, px, (H, W), width_m=32)
    sp = os.path.join(out_dir, "structures.json")
    st = [s["p"] for s in json.load(open(sp)).get("structures", [])] if os.path.exists(sp) else []
    foot = _raster(st, x0, y1, px, (H, W), fill=True) if st else np.zeros((H, W), bool)
    road &= ~ndimage.binary_dilation(foot, iterations=int(round(1.5 / px)))    # never a roof, nor the eaves round it
    f = rgb.astype(np.float32) / 255.0
    lum = f @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    mx, mn = f.max(2), f.min(2)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    # ---- 1. cars on the tarmac
    # the tarmac round each pixel: the median over 12 m (a row of parked cars is mostly car over less), worked out at a
    # quarter of the resolution and brought back up
    def med(a, m):
        q = 4
        h4, w4 = -(-a.shape[0] // q), -(-a.shape[1] // q)
        pad = np.pad(a, ((0, h4 * q - a.shape[0]), (0, w4 * q - a.shape[1])), mode="edge")
        small = pad.reshape(h4, q, w4, q).mean((1, 3))
        sm = ndimage.median_filter(small, size=max(3, int(round(m / px / q)) | 1))
        return ndimage.zoom(sm, q, order=1)[:a.shape[0], :a.shape[1]]
    bg = med(lum, 12.0)
    bgs = med(sat, 12.0)
    tarmac = road & (bgs < 0.42) & (bg > 0.25) & (bg < 0.92)
    odd = tarmac & ((np.abs(lum - bg) > 0.12) | (sat - bgs > 0.18))
    odd = ndimage.binary_opening(odd, iterations=max(1, int(round(0.45 / px))))      # the painted lines go
    odd = ndimage.binary_closing(odd, iterations=2)
    lab, n = ndimage.label(odd)
    cars = np.zeros_like(odd)
    kept = 0
    if n:
        sizes = ndimage.sum(odd, lab, range(1, n + 1))
        objs = ndimage.find_objects(lab)
        thick = ndimage.distance_transform_edt(odd)
        for i, (sz, sl) in enumerate(zip(sizes, objs), 1):
            a_m2 = sz * px * px
            half = float(thick[sl][lab[sl] == i].max()) * px        # the blob's half-thickness
            # a car or a van with its shadow (3 to 40 m2), or a row of them parked side by side or nose in (a row to 1500 m2):
            # at least 1.2 m thick and no thicker than a row of cars with its shadows
            if 3 <= a_m2 <= 1500 and 0.6 <= half <= 4.0:
                # and parked on tarmac: most of a 1.5 m ring round it is tarmac (a roof or a garden bed has lawn round it)
                blob = lab[sl] == i
                pad = int(round(1.5 / px))
                y0_, y1_ = max(0, sl[0].start - pad), min(H, sl[0].stop + pad)
                x0_, x1_ = max(0, sl[1].start - pad), min(W, sl[1].stop + pad)
                big = np.zeros((y1_ - y0_, x1_ - x0_), bool)
                big[sl[0].start - y0_:sl[0].stop - y0_, sl[1].start - x0_:sl[1].stop - x0_] = blob
                ring = ndimage.binary_dilation(big, iterations=pad) & ~big
                if ring.any() and (tarmac[y0_:y1_, x0_:x1_][ring] | odd[y0_:y1_, x0_:x1_][ring]).mean() > 0.7:
                    cars[sl] |= blob
                    kept += 1
    cars = ndimage.binary_dilation(cars, iterations=max(1, int(round(0.6 / px))))
    rep["cars"] = kept
    if cars.any():
        keep = (~cars).astype(np.float32)
        sigma = 1.6 / px
        num = np.stack([ndimage.gaussian_filter(f[..., b] * keep, sigma) for b in range(3)], -1)
        den = ndimage.gaussian_filter(keep, sigma)[..., None]
        fill = num / np.maximum(den, 1e-4)
        # the tarmac's own grain: the photograph's fine detail from a nearby clean patch (shifted 3 m along x)
        sh = int(round(3.0 / px))
        detail = f - np.stack([ndimage.gaussian_filter(f[..., b], 1.5) for b in range(3)], -1)
        grain = np.roll(detail, sh, axis=1) * (~np.roll(cars, sh, axis=1))[..., None]
        f = np.where(cars[..., None], np.clip(fill + grain * 0.8, 0, 1), f)
    # ---- 2. printed shadows next to buildings
    if st:
        near = ndimage.binary_dilation(foot, iterations=int(round(10 / px))) & ~ndimage.binary_dilation(foot, iterations=2)
        lum = f @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        mx, mn = f.max(2), f.min(2)
        sat = (mx - mn) / np.maximum(mx, 1e-3)
        ref = ndimage.percentile_filter(lum, 70, size=int(round(8 / px)) | 1)
        # (only the deep, grey shadows cast on open ground; a tree, a dark roof or a hedge is green or coloured)
        dark = near & (lum < ref * 0.5) & (sat < 0.25) & ~road
        dark = ndimage.binary_opening(dark, iterations=3)
        w = ndimage.gaussian_filter(dark.astype(np.float32), 0.5 / px)
        gain = np.clip(ref / np.maximum(lum, 1e-3), 1, 2.0)
        lift = 1 + (gain - 1) * 0.45 * w
        f = np.clip(f * lift[..., None], 0, 1)
        rep["shadow_px"] = int(dark.sum())
    return (f * 255 + 0.5).astype(np.uint8), rep


if __name__ == "__main__":
    # clean an existing patch in place: python pipeline/aerial_clean.py web/data/lake-tekapo detail_township.webp
    import sys
    out_dir, name = sys.argv[1], sys.argv[2]
    scene = json.load(open(os.path.join(out_dir, "scene.json")))
    a = [a for a in scene["detail"] if a["file"] == name][0]
    Image.MAX_IMAGE_PIXELS = None
    rgb = np.array(Image.open(os.path.join(out_dir, name)).convert("RGB"))
    out, rep = clean(rgb, a["x0"], a["y1"], a["px_m"], out_dir)
    Image.fromarray(out).save(os.path.join(out_dir, name), quality=80, method=6)
    print(name, rep)
