"""The shoreline, for the water and ground shaders (web/water.js) and the underwater terrain.

shore.png covers the city's frame at SHORE_CELL metres per pixel:
  r  signed distance to the shoreline, 128 + 2 d (0.5 m steps, water positive, +-64 m)
  g  sand (Overture land subtype "sand": beaches and sand) on land; in the water, whether
     the nearest shore is sand
  b  rock (subtypes "rock", and mapped cliffs) on land; in the water, whether the nearest
     shore is rock

There is no open bathymetry for the harbour or the river, so the bottom is modelled: each
water cell's depth is its distance to the nearest shore times a slope for that kind of
shore (gentle off a beach, steep off rock, a sheer wall off a seawall or a built edge),
down to a floor of 4 m. The water shader uses the same slopes to decide how much of the
bottom shows through.
"""
import os

import numpy as np
import shapely
from PIL import Image
from scipy import ndimage
from shapely import wkb as swkb

from cityctx import polygons

SHORE_CELL = 2.5  # m


def raised_classes(cfg):
    """Infrastructure classes the terrain raises (breakwaters, city.json terrain.raise): drawn
    and shored as rock."""
    return {r["class"] for r in cfg.get("terrain", {}).get("raise", [])}


def without_raised(C, con, path, rows, sea):
    """The water polygons with the structures the terrain raises (breakwaters) cut out: the
    water theme often runs straight over them."""
    classes = raised_classes(C.cfg)
    if not classes or not os.path.exists(path):
        return sea
    cut = shapely.union_all([C.to_local(swkb.loads(bytes(r["wkb"]))) for r in rows(con, path) if r["class"] in classes])
    return [q for p in sea for q in polygons(p.difference(cut)) if q.area > 1]
SLOPES = {"sand": 0.04, "rock": 0.25, "built": 1.0}  # depth per metre from the shore
FLOOR_M = 4.0
QUAY_SHELF_M = 0.3  # the terrain's first point out from the land is at most this deep (build_scene.py, game_data.py)


def shore_map(C, con, raw, rows, raster_mask, polygons, sea, extent, cfg):
    """Rasterise the water and the shore kinds; returns the arrays and the image."""
    nx, ny = int(round((C.x1 - C.x0) / SHORE_CELL)), int(round((C.y1 - C.y0) / SHORE_CELL))
    wet = raster_mask(sea, nx, ny, SHORE_CELL, C.x0, C.y1)
    sand, rock = [], []
    for r in rows(con, raw("land")):
        if r["subtype"] not in ("sand", "rock") and r["class"] != "cliff":
            continue
        g = C.to_local(swkb.loads(bytes(r["wkb"])))
        if r["class"] == "cliff":
            g = g.buffer(2.0)
        if g.intersects(extent):
            (sand if r["subtype"] == "sand" else rock).extend(polygons(g.intersection(extent)))
    # structures the terrain raises (breakwaters) are rock armour
    rock += [p for r in rows(con, raw("infrastructure")) if r["class"] in raised_classes(cfg)
             for p in polygons(C.to_local(swkb.loads(bytes(r["wkb"]))).intersection(extent))]
    S = raster_mask(sand, nx, ny, SHORE_CELL, C.x0, C.y1) & ~wet
    R = raster_mask(rock, nx, ny, SHORE_CELL, C.x0, C.y1) & ~wet & ~S
    # distances between pixel centres; the shoreline is half a pixel from either side
    d_in, (iy, ix) = ndimage.distance_transform_edt(wet, return_indices=True)
    d_out = ndimage.distance_transform_edt(~wet)
    signed = np.where(wet, d_in - 0.5, -(d_out - 0.5)) * SHORE_CELL
    # a beach or rock polygon rarely meets the water polygon exactly: grow them a few metres
    grow = np.ones((5, 5), bool)
    Sg, Rg = ndimage.binary_dilation(S, grow), ndimage.binary_dilation(R, grow)
    sand_near = np.where(wet, Sg[iy, ix], S)
    rock_near = np.where(wet, Rg[iy, ix] & ~Sg[iy, ix], R)
    img = np.zeros((ny, nx, 4), np.uint8)
    img[..., 0] = np.clip(np.round(128 + 2 * signed), 0, 255)
    img[..., 1] = np.round(255 * np.clip(ndimage.gaussian_filter(sand_near.astype(float), 1.0), 0, 1))
    img[..., 2] = np.round(255 * np.clip(ndimage.gaussian_filter(rock_near.astype(float), 1.0), 0, 1))
    img[..., 3] = 255
    slopes = SLOPES | cfg.get("water", {}).get("shore_slopes", {})
    return {"wet": wet, "signed": signed, "sand": sand_near, "rock": rock_near, "image": Image.fromarray(img, "RGBA"),
            "slopes": slopes, "nx": nx, "ny": ny, "counts": {"sand_polygons": len(sand), "rock_polygons": len(rock)}}


def depth_at(sm, x, y, x0, y1):
    """Modelled water depth (m, positive down) at local points, from a shore_map()."""
    c = np.clip(((np.asarray(x) - x0) / SHORE_CELL).astype(int), 0, sm["nx"] - 1)
    r = np.clip(((y1 - np.asarray(y)) / SHORE_CELL).astype(int), 0, sm["ny"] - 1)
    s = sm["slopes"]
    slope = np.where(sm["sand"][r, c], s["sand"], np.where(sm["rock"][r, c], s["rock"], s["built"]))
    return np.minimum(FLOOR_M, np.maximum(sm["signed"][r, c], 0.0) * slope)


def from_png(path, x0, y1, cfg):
    """shore_map() read back from shore.png (for pipeline/game_data.py)."""
    a = np.asarray(Image.open(path).convert("RGBA")).astype(float)
    signed = (a[..., 0] - 128) / 2
    return {"signed": signed, "sand": a[..., 1] > 127, "rock": a[..., 2] > 127, "nx": a.shape[1], "ny": a.shape[0],
            "slopes": SLOPES | cfg.get("water", {}).get("shore_slopes", {})}
