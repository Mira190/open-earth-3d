"""Sentinel-2 L2A surface reflectance for a marine city, as one clean 10 m composite.

Open imagery for the sea: ESA Sentinel-2 (CC BY 4.0 / Copernicus open licence), read as
Cloud-Optimized GeoTIFFs from the Earth Search STAC on AWS. Water is a hard target:
sun glint, whitecaps and cloud shadow all brighten it. So for every pixel this picks the
darkest-in-NIR clear observations of the last year (glint and cloud are bright in NIR, and
water absorbs NIR completely), and takes the median of the best three.

    python pipeline/fetch_sentinel.py --city whitsundays

writes data/raw/<id>/s2.npz: blue, green, red, nir as uint16 reflectance x 10000 on the
city's local grid (x east, y north, `pixel_m` per pixel, row 0 = northernmost), plus
`scenes`, the list of Sentinel-2 product ids used (the provenance).

Where the area spans two MGRS tiles, the unit is a satellite pass, not a scene: the clearest
passes that cover every tile are kept and their tiles mosaicked, so the tiles' overlap sees
the same dates as the rest of the area and the composite has no seam at the tile edge.
"""
import json
import os
import sys

import numpy as np
import rasterio
import requests
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

from cityctx import city_args

STAC = "https://earth-search.aws.element84.com/v1/search"
BANDS = ["blue", "green", "red", "nir"]


def search(bbox, since, max_cloud, limit=100):
    """All matching items, following the STAC 'next' links (a page holds at most `limit`; two MGRS
    tiles over a year at a loose cloud limit fill more than one page)."""
    body = {"collections": ["sentinel-2-l2a"], "bbox": bbox, "limit": limit,
            "datetime": f"{since}T00:00:00Z/..", "query": {"eo:cloud_cover": {"lt": max_cloud}},
            "sortby": [{"field": "properties.datetime", "direction": "desc"}]}
    out = []
    while body:
        r = requests.post(STAC, json=body, timeout=60)
        r.raise_for_status()
        page = r.json()
        out += page["features"]
        nxt = next((l for l in page.get("links", []) if l.get("rel") == "next"), None)
        body = {**body, **nxt["body"]} if nxt and nxt.get("body") and page["features"] else None
    return out


def main():
    def extra(ap):
        ap.add_argument("--scenes", type=int, default=14, help="clearest passes kept (each covers every MGRS tile of the area)")
        ap.add_argument("--recomposite", action="store_true", help="redo the composite from the downloaded stack")
    city, a = city_args("Sentinel-2 composite for a marine city", extra)
    cfg = city.cfg["imagery"]
    px = cfg.get("pixel_m", 10.0)
    if a.recomposite:
        return composite(city.raw, px, city.x0, city.y1)
    W = int(round((city.x1 - city.x0) / px))
    H = int(round((city.y1 - city.y0) / px))
    dst_tf = from_origin(city.x0, city.y1, px, px)
    items = search(city.cfg["bbox"], cfg.get("since", "2025-10-01"), cfg.get("max_cloud", 12))
    # Keep whole passes, not scenes per tile: one satellite pass images the neighbouring MGRS tiles
    # at the same moment, so a pixel in the tiles' overlap and one outside it see the same dates.
    # (Keeping the clearest scenes of each tile on its own gave the overlap the union of two sets of
    # dates, and the composite changed character at the tile edge: a seam.) A pass counts only if
    # every tile that touches the area is in it under the cloud limit; its tiles are mosaicked into
    # one layer of the stack.
    tiles = sorted({f["id"].split("_")[1] for f in items})
    passes = {}
    for f in items:
        sat, _, day = f["id"].split("_")[:3]
        passes.setdefault((sat, day), []).append(f)
    full = [fs for fs in passes.values() if sorted(f["id"].split("_")[1] for f in fs) == tiles]
    full.sort(key=lambda fs: max(f["properties"]["eo:cloud_cover"] for f in fs))
    chosen = full[:a.scenes]
    print(len(items), "scenes found in", len(passes), "passes over", len(tiles), "tiles;", len(full), "passes cover every tile;",
          len(chosen), "used")

    n = len(chosen)
    stack_path = os.path.join(city.raw, "s2_stack.npy")
    stack = np.lib.format.open_memmap(stack_path, mode="w+", dtype=np.uint16, shape=(n, 5, H, W))  # bands + scene class
    tmp = np.zeros((H, W), np.uint16)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2"):
        for i, fs in enumerate(chosen):
            for f in fs:
                take = None   # this tile fills what the pass's earlier tiles left empty, the same pixels in every band
                for b, name in enumerate(BANDS + ["scl"]):
                    for attempt in range(4):  # the bucket occasionally drops a range request
                        try:
                            with rasterio.open(f["assets"][name]["href"]) as src:
                                reproject(source=rasterio.band(src, 1), destination=tmp, dst_transform=dst_tf,
                                          dst_crs=city.proj, resampling=Resampling.nearest if name == "scl" else Resampling.bilinear,
                                          src_nodata=0, dst_nodata=0)
                            break
                        except Exception as e:  # rasterio raises several types for network faults
                            if attempt == 3:
                                raise
                            print("  retry", name, e.__class__.__name__, flush=True)
                    if take is None:
                        take = (stack[i, 0] == 0) & (tmp > 0)
                    stack[i, b][take] = tmp[take]
                print(f"  {i + 1}/{n} {f['id']} cloud {f['properties']['eo:cloud_cover']:.1f}%", flush=True)
    stack.flush()
    json.dump([f["id"] for fs in chosen for f in fs], open(os.path.join(city.raw, "s2_scenes.json"), "w"))
    composite(city.raw, px, city.x0, city.y1)


def composite(raw, px, x0, y1, keep=0.6):
    """Per pixel: of the clear observations keep the darkest `keep` share in NIR (glint and
    thin cloud are bright in NIR, and water absorbs NIR completely), then take the median."""
    stack = np.load(os.path.join(raw, "s2_stack.npy"), mmap_mode="r")
    n, _, H, W = stack.shape
    scenes = open(os.path.join(raw, "s2_scenes.json")).read()
    out = {name: np.zeros((H, W), np.uint16) for name in BANDS}
    for r0 in range(0, H, 200):  # strips keep memory small
        st = np.asarray(stack[:, :, r0:r0 + 200]).astype(np.float32)
        # clear observations: not no-data, saturated, shadow, cloud (8, 9), thin cirrus (10) or snow
        valid = (st[:, 0] > 0) & ~np.isin(st[:, 4], [0, 1, 3, 8, 9, 10, 11])
        nir = np.where(valid, st[:, 3], np.inf)
        rank = np.argsort(np.argsort(nir, axis=0), axis=0)
        cnt = valid.sum(axis=0)
        take = valid & (rank < np.maximum(2, np.ceil(cnt * keep)))
        for b, name in enumerate(BANDS):
            v = np.where(take, st[:, b], np.nan)
            with np.errstate(all="ignore"):
                m = np.nanmedian(v, axis=0)
            out[name][r0:r0 + 200] = np.nan_to_num(m, nan=0).astype(np.uint16)
    np.savez_compressed(os.path.join(raw, "s2.npz"), **out, pixel_m=px, x0=x0, y1=y1, scenes=scenes)
    print("s2.npz", W, H, "no-data share", float((out["blue"] == 0).mean()))


if __name__ == "__main__":
    main()
