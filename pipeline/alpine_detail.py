"""Aerial detail for an alpine site: LINZ's rural aerial photos (0.3 m) at the places people stand, as
patches the terrain draws over the 10 m satellite colour when the camera is near.

    python pipeline/alpine_detail.py --city lake-pukaki

city.json:
  "detail": [{"id": "peters-lookout", "centre": [lon, lat], "size_m": [3000, 3000], "px_m": 0.75,
              "collection": "https://nz-imagery.s3.ap-southeast-2.amazonaws.com/canterbury/mackenzie_2021_0.3m/rgb/2193/"}]

For each area: the STAC items of the collection that touch it, each read at the patch's resolution from its
COG overviews, reprojected into the site's frame and mosaicked. The photos are another year and another grade
than the satellite mosaic, so the patch keeps its own detail (above about 40 m) and takes the mosaic's colour
below that (a low-pass transfer), and fades into the mosaic over its outer 12% (web/reef/alpine/terrain.js).
Writes web/data/<id>/detail_<area>.webp and the areas into scene.json "detail".
"""
import json
import math
import os
import urllib.request
import concurrent.futures as cf

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_origin, Affine
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds
from scipy import ndimage

from cityctx import city_args

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
if os.path.exists("/root/.ccr/ca-bundle.crt"):
    os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")
UA = {"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"}


def items(collection):
    cache = {}
    col = json.load(urllib.request.urlopen(urllib.request.Request(collection + "collection.json", headers=UA)))
    hrefs = [l["href"] for l in col["links"] if l["rel"] == "item"]

    def get(h):
        for k in range(4):
            try:
                return json.load(urllib.request.urlopen(urllib.request.Request(collection + h[2:], headers=UA), timeout=60))
            except Exception:
                pass
        return None
    with cf.ThreadPoolExecutor(32) as ex:
        out = [i for i in ex.map(get, hrefs) if i]
    return out


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    cfg = city.cfg
    raw = os.path.join(city.raw, "detail")
    os.makedirs(raw, exist_ok=True)
    out_areas = []
    mosaic_cache = {}
    scene_path = os.path.join(city.out, "scene.json")
    scene = json.load(open(scene_path))
    g = scene["ground"]
    ground = np.concatenate([np.array(Image.open(os.path.join(city.out, s["file"])).convert("RGB")) for s in g["strips"]], 0)
    for a in cfg.get("detail", []):
        cx, cy = city.fwd.transform(*a["centre"])
        w, h = a["size_m"]
        px = a["px_m"]
        x0, y1 = round(cx - w / 2), round(cy + h / 2)
        W, H = int(round(w / px)), int(round(h / px))
        tf = from_origin(x0, y1, px, px)
        cache = os.path.join(raw, f"{a['id']}.npy")
        if os.path.exists(cache):
            img = np.load(cache)
        else:
            col = a["collection"]
            if col not in mosaic_cache:
                mosaic_cache[col] = items(col)
            # the area in NZTM, with a margin for the rotation between the frames
            e0, n0, e1, n1 = transform_bounds(city.proj, "EPSG:2193", x0 - 50, y1 - h - 50, x0 + w + 50, y1 + 50)
            from pyproj import Transformer
            to2193 = Transformer.from_crs(4326, 2193, always_xy=True)
            hit = []
            for it in mosaic_cache[col]:
                b = it["bbox"]
                be0, bn0 = to2193.transform(b[0], b[1]); be1, bn1 = to2193.transform(b[2], b[3])
                if be1 > e0 and be0 < e1 and bn1 > n0 and bn0 < n1:
                    hit.append(it)
            print(f"{a['id']}: {len(hit)} photo tiles", flush=True)
            img = np.full((3, H, W), np.nan, np.float32)

            def read(it):
                href = it["assets"]["visual"]["href"]
                href = href if href.startswith("http") else col + href[2:]
                for k in range(4):
                    try:
                        with rasterio.open("/vsicurl/" + href) as r:
                            win = from_bounds(e0, n0, e1, n1, r.transform).intersection(rasterio.windows.Window(0, 0, r.width, r.height))
                            f = max(1, int(px / r.res[0] * 0.9))
                            ow, oh = max(1, int(win.width // f)), max(1, int(win.height // f))
                            data = r.read([1, 2, 3], window=win, out_shape=(3, oh, ow), resampling=Resampling.average)
                            t0 = r.window_transform(win) * Affine.scale(win.width / ow, win.height / oh)
                            return data, t0, r.crs
                    except Exception as e:
                        err = e
                print(f"  {it['id']}: {err}")
                return None
            with cf.ThreadPoolExecutor(8) as ex:
                parts = [p for p in ex.map(read, hit) if p is not None]
            for data, t0, crs in parts:
                for b in range(3):
                    tmp = np.full((H, W), np.nan, np.float32)
                    src = data[b].astype(np.float32)
                    src[data.sum(0) == 0] = np.nan
                    reproject(src, tmp, src_transform=t0, src_crs=crs, src_nodata=np.nan, dst_transform=tf, dst_crs=city.proj,
                              dst_nodata=np.nan, resampling=Resampling.bilinear)
                    m = np.isnan(img[b]) & np.isfinite(tmp)
                    img[b][m] = tmp[m]
            np.save(cache, img)
        miss = ~np.isfinite(img[0])
        if miss.mean() > 0.5:
            print(f"{a['id']}: the photos cover only {(1 - miss.mean()) * 100:.0f}%, skipped")
            continue
        # the satellite mosaic under the patch, at the patch's resolution
        gi0 = (x0 - city.x0) / g["px_m"]; gj0 = (city.y1 - y1) / g["px_m"]
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        gx = gi0 + (xx + 0.5) * px / g["px_m"] - 0.5
        gy = gj0 + (yy + 0.5) * px / g["px_m"] - 0.5
        lin = lambda v: (np.clip(v, 0, 255) / 255.0) ** 2.2
        sat = np.stack([ndimage.map_coordinates(lin(ground[..., b].astype(np.float32)), [gy, gx], order=1, mode="nearest") for b in range(3)])
        if miss.any():
            for b in range(3):
                img[b][miss] = (sat[b][miss] ** (1 / 2.2)) * 255
        L = lin(img)
        sigma = 40.0 / px
        lo_photo = np.stack([ndimage.gaussian_filter(L[b], sigma) for b in range(3)])
        lo_sat = np.stack([ndimage.gaussian_filter(sat[b], sigma) for b in range(3)])
        matched = L * (lo_sat + 1e-3) / (lo_photo + 1e-3)
        rgb = (np.clip(matched, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8).transpose(1, 2, 0)
        name = f"detail_{a['id']}.webp"
        Image.fromarray(rgb).save(os.path.join(city.out, name), quality=80, method=6)
        out_areas.append({"id": a["id"], "file": name, "x0": x0, "y1": y1, "w": W, "h": H, "px_m": px,
                          "src": a.get("src", "Toitū Te Whenua LINZ rural aerial photos (CC BY 4.0)")})
        print(f"{a['id']}: {W} x {H} at {px} m, {os.path.getsize(os.path.join(city.out, name)) / 1e6:.2f} MB", flush=True)
    scene["detail"] = out_areas
    json.dump(scene, open(scene_path, "w"), indent=1)


if __name__ == "__main__":
    main()
