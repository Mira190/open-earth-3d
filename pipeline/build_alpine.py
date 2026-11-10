"""Build an alpine site's scene (a glacial lake and its mountains) from the LINZ downloads.

    python pipeline/fetch_linz.py --city lake-pukaki
    python pipeline/fetch_overture.py --city lake-pukaki --only water segment building land land_use infrastructure
    python pipeline/build_alpine.py --city lake-pukaki

Reads data/raw/<id>/linz/ (fetch_linz.py) and the Overture layers, and writes web/data/<id>/ for
the reef viewer (reef/index.html, site kind "alpine"):

- `terrain.bin`  the height grid: int16 little-endian, `units_m` a step, row 0 the northernmost,
                 `cell_m` a cell, gzip-wrapped (the viewer inflates it with DecompressionStream).
                 Heights are metres above the main lake's surface, so the lake is the viewer's
                 water level 0 and the sea-level code (swimming, boats, the water column) works as
                 it is; `datum_m` is the lake's surface above NZVD2016.
- `ground_<i>.webp` the ground colour at `px_m`, in horizontal strips (each within the texture size
                 a phone holds): the satellite mosaic on land; under the lakes the silt and gravel
                 of their own shores, since the water's colour comes from the water (env.js).
- `cover.png`    one land-cover class per ground pixel (COVER below), from the imagery's colour,
                 the slope, the height and OpenStreetMap's mapped glaciers, scree, scrub and woods.
- `roads.json`, `structures.json`  OpenStreetMap's roads and tracks as lines, and its building footprints.
- `scene.json`   the frame, grids, lakes, the main lake's optics, POIs, spawn.

The lakes: the LiDAR has no returns over water, so every lake is a hole in the DEM. The main
lake is the hole that holds `lakes[].seed`; the others are the holes inside OpenStreetMap water
polygons. A lake's surface is the median height of the ground round its hole (the shore on the
day of the LiDAR capture). No open survey of the lake beds exists, so the beds are synthesised:
depth grows from the shore with the distance to it, to the published maximum depth (`max_depth_m`,
with its source) at the point farthest from any shore. In glacial-flour water the bed is out of
sight a few metres down, so the shape only matters near the shore.
"""
import gzip
import json
import math
import os

import duckdb
import numpy as np
import rasterio
import shapely
from PIL import Image
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from scipy import ndimage
from shapely import wkb as swkb

from cityctx import city_args, polygons

# land-cover classes in cover.png (the viewer's alpine terrain material and flora read them)
COVER = {0: "lake", 1: "river and stream", 2: "snow and ice", 3: "debris-covered ice", 4: "rock and cliff",
         5: "scree and moraine", 6: "riverbed gravel", 7: "tussock grassland", 8: "alpine herbfield",
         9: "shrub and scrub", 10: "forest", 11: "pasture", 12: "wetland", 13: "road", 14: "built", 15: "shore"}
STRIP = 4096      # max texture side for a ground strip (WebGL2 guarantees 4096 on phones)


def mosaic(paths, dst_tf, shape, crs, resampling, bands=1, dtype=np.float32):
    """Reproject each NZTM sheet into the local frame and keep the first valid value per cell."""
    out = np.full((bands, *shape), np.nan, np.float32)
    for p in paths:
        if not os.path.exists(p):      # a sheet the LiDAR composite does not hold (fetch_linz.py skips it)
            continue
        with rasterio.open(p) as s:
            for b in range(bands):
                tmp = np.full(shape, np.nan, np.float32)
                reproject(rasterio.band(s, b + 1), tmp, src_transform=s.transform, src_crs=s.crs, src_nodata=s.nodata,
                          dst_transform=dst_tf, dst_crs=crs, dst_nodata=np.nan, resampling=resampling)
                if s.nodata is None and s.dtypes[0] == "uint8":
                    # imagery: black is outside the sheet
                    if b == 0:
                        valid = tmp > 0
                    tmp[~valid] = np.nan
                m = np.isnan(out[b]) & np.isfinite(tmp)
                out[b][m] = tmp[m]
    return out if bands > 1 else out[0]


def overture(city, layer, where="TRUE"):
    path = os.path.join(city.raw, f"overture_{layer}.parquet")
    if not os.path.exists(path):
        return []
    con = duckdb.connect()
    rows = con.execute(f"SELECT name, class, subtype, wkb FROM '{path}' WHERE {where}").fetchall()
    return [(n, c, s, city.to_local(swkb.loads(bytes(w)))) for n, c, s, w in rows]


def burn(geoms, tf, shape, value=1, all_touched=False):
    geoms = [g for g in geoms if g is not None and not g.is_empty]
    if not geoms:
        return np.zeros(shape, np.uint8)
    return rasterize([(g, value) for g in geoms], out_shape=shape, transform=tf, fill=0, all_touched=all_touched, dtype=np.uint8)


def ring_level(z, hole, width=2):
    ring = ndimage.binary_dilation(hole, iterations=width) & ~hole & np.isfinite(z)
    return float(np.median(z[ring])) if ring.any() else float("nan")


def lake_bed(hole, level, max_depth, cell):
    """Depth from the shore: the distance to the nearest shore, normalised by the farthest such
    distance in the lake, through a profile that steepens near the shore (a glacial trough)."""
    d = ndimage.distance_transform_edt(hole) * cell
    dmax = d.max() or 1.0
    f = d / dmax
    shape = 1 - (1 - np.clip(f, 0, 1)) ** 2.2     # steep sides, broad flat floor
    return level - max_depth * shape


def encode_heights(q):
    """int16 heights as the residual of the plane through the left, upper and upper-left cells
    (left only on the top row, upper only in the first column), all the low bytes then all the high
    bytes: 3.4 MB gzipped where the plain grid is 5.9 MB. web/reef/alpine/data.js reverses it."""
    p = np.zeros_like(q)
    p[1:, 1:] = q[1:, :-1] + q[:-1, 1:] - q[:-1, :-1]
    p[0, 1:] = q[0, :-1]
    p[1:, 0] = q[:-1, 0]
    r = (q - p).astype("<i2").view(np.uint8).reshape(-1, 2)
    return np.concatenate([r[:, 0], r[:, 1]]).tobytes()


def river_snow(cover):
    """Snow read off a river: white water in a gorge (the Hooker under its lower bridge) is bright and grey, so the
    colour rule takes it for snow, and on ground steeper than the riverbed rule allows nothing takes it back. A snow
    pixel with no more than three others in its 5 x 5 window (a snowfield is a patch, not a string) beside a river
    or riverbed pixel is river (issue #232). In place; returns how many."""
    snow = cover == 2
    near_river = ndimage.maximum_filter(np.isin(cover, (1, 6)).astype(np.uint8), size=3).astype(bool)
    lone = ndimage.uniform_filter(snow.astype(np.float32), size=5) * 25 <= 4.5
    m = snow & near_river & lone
    cover[m] = 1
    return int(m.sum())


def mode_filter(c, size=3, keep=()):
    """The commonest class in each size x size window (classes in `keep`, thin lines such as roads
    and streams, are left where they are), so the cover reads as patches, not pixel noise."""
    best, cnt = c.copy(), np.zeros(c.shape, np.float32)
    for k in np.unique(c):
        f = ndimage.uniform_filter((c == k).astype(np.float32), size)
        m = f > cnt
        best[m], cnt[m] = k, f[m]
    for k in keep:
        best[c == k] = k
    return best


def slope_deg(z, cell):
    gy, gx = np.gradient(z, cell)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    cfg = city.cfg
    city.ensure_dirs()
    raw = os.path.join(city.raw, "linz")
    T, I = cfg["terrain"], cfg["imagery"]
    cell, px = T.get("cell_m", 30), I.get("pixel_m", 10)
    W, H = round((city.x1 - city.x0) / cell), round((city.y1 - city.y0) / cell)
    GW, GH = round((city.x1 - city.x0) / px), round((city.y1 - city.y0) / px)
    tf, tfg = from_origin(city.x0, city.y1, cell, cell), from_origin(city.x0, city.y1, px, px)
    print(f"grid {W} x {H} at {cell} m, ground {GW} x {GH} at {px} m")

    # ---- terrain: the LiDAR composite, the 8 m contour DEM where it has no data on land
    z = mosaic([os.path.join(raw, f"dem_{s}.tif") for s in T["sheets"]], tf, (H, W), city.proj, Resampling.average)
    z8 = mosaic([os.path.join(raw, f"dem8_{s}.tif") for s in T["sheets"]], tf, (H, W), city.proj, Resampling.average)
    water_polys = [g for n, c, s, g in overture(city, "water", "class IN ('lake','water','reservoir','pond','river','canal','basin')")
                   if g.geom_type in ("Polygon", "MultiPolygon")]
    named_water = [(n, g) for n, c, s, g in overture(city, "water", "name IS NOT NULL")
                   if g.geom_type in ("Polygon", "MultiPolygon")]
    wmask = burn(water_polys, tf, (H, W)).astype(bool)
    main_cfg = next(l for l in cfg["lakes"] if l.get("main"))
    SEA = bool(main_cfg.get("sea"))          # a fiord or a sound: the main water is the sea itself
    # a lake is a gap in the LiDAR; the sea is where neither the LiDAR nor the contour DEM has a height (the LiDAR
    # reaches only part of a fiord's frame, so its gaps alone say nothing there)
    hole = ~np.isfinite(z) & ~np.isfinite(z8) if SEA else ~np.isfinite(z)
    print(f"{'no height in either DEM (the sea)' if SEA else 'LiDAR gaps'}: {hole.mean() * 100:.1f}% of the frame")

    # ---- lakes: each OpenStreetMap lake outline, with the LiDAR gaps it holds. The LiDAR is flattened to the
    # water's surface near the shores and blank further out; the surface is the median of what it has inside.
    lab, n = ndimage.label(hole)
    seed = shapely.Point(*city.fwd.transform(*main_cfg["seed"]))
    cands = [(nm, g) for nm, c, s, g in overture(city, "water", "class IN ('lake','water','reservoir')")
             if g.geom_type in ("Polygon", "MultiPolygon") and g.area >= 20000]
    sea_m = None
    if SEA:
        # the sea: the cells with no height, and the cells OpenStreetMap's sea holds that the DEMs put within a metre
        # of sea level (the LiDAR's flattened water, a beach at low tide), joined to the seed. The coast is the DEMs',
        # not the mapped outline's: a mapped coast a few cells out would cut the foot off a cliff
        zc = np.where(np.isfinite(z), z, z8)
        ocean = [g for nm, c, s, g in overture(city, "water", "class IN ('ocean','sea','bay','strait','fjord')")
                 if g.geom_type in ("Polygon", "MultiPolygon")]
        low = burn(ocean, tf, (H, W)).astype(bool) & (np.nan_to_num(zc, nan=0.0) < main_cfg.get("shore_m", 1.0))
        slab, _ = ndimage.label(hole | low)
        sj, si = int((city.y1 - seed.y) / cell), int((seed.x - city.x0) / cell)
        if not slab[sj, si]:
            raise SystemExit("the sea's seed is on land")
        sea_m = slab == slab[sj, si]
        cands.insert(0, (main_cfg.get("name"), None))
    elif not any(g.contains(seed) for nm, g in cands):
        raise SystemExit("no OpenStreetMap lake holds the main lake's seed")
    else:
        cands.sort(key=lambda t: (not t[1].contains(seed), -t[1].area))
    lakes, lakeid = [], np.zeros((H, W), np.uint8)
    bed = np.full((H, W), np.nan, np.float32)
    zf = z.copy()
    for li, (name, g) in enumerate(cands[:250]):
        main = len(lakes) == 0
        conf = main_cfg if main else next((l for l in cfg["lakes"] if l.get("name") == name), {})
        if g is None:                       # the sea
            m, level = sea_m, float(main_cfg.get("level_nzvd", 0.0))
        else:
            m = burn([g], tf, (H, W)).astype(bool) & (lakeid == 0)
            if m.sum() < 8:
                continue
            # the LiDAR gaps that lie mostly inside the outline belong to the lake
            touched = np.unique(lab[m & hole]) if not SEA else []
            for k in [k for k in touched if k > 0]:
                comp = lab == k
                if (comp & m).sum() >= 0.3 * comp.sum():
                    m |= comp
            zl = np.where(np.isfinite(z), z, z8) if SEA else z
            inner = ndimage.binary_erosion(m, iterations=1) & np.isfinite(zl)
            vals = zl[inner] if inner.sum() >= 20 else zl[ndimage.binary_dilation(m, iterations=2) & ~m & np.isfinite(zl)]
            if vals.size == 0:
                continue
            level = float(np.median(vals))
        area = float(m.sum() * cell * cell)
        maxd = conf.get("max_depth_m") or max(3.0, min(60.0, 0.04 * math.sqrt(area)))
        if g is None:
            # a fiord's bed: a glacial trough, deepening from the walls to the published depth over `trough_m`
            # (about half the fiord's width), and held there out to sea
            f = np.clip(ndimage.distance_transform_edt(m) * cell / conf.get("trough_m", 700.0), 0, 1)
            bed[m] = (level - maxd * (1 - (1 - f) ** 2.2))[m]
        else:
            bed[m] = lake_bed(m, level, maxd, cell)[m]
        lakeid[m] = len(lakes) + 1
        js, is_ = np.nonzero(m)
        c = g.representative_point() if g is not None else seed
        lakes.append({"id": conf.get("id") or (name or f"lake-{li}").lower().replace(" ", "-"), "name": name or conf.get("name"),
                      "main": main, "level_nzvd": round(level, 2), "area_km2": round(area / 1e6, 3), "max_depth_m": round(float(maxd), 1),
                      "depth_src": conf.get("depth_src", "synthesised from the lake's area (no open survey)"),
                      "box": [round(city.x0 + is_.min() * cell), round(city.y1 - (js.max() + 1) * cell),
                              round(city.x0 + (is_.max() + 1) * cell), round(city.y1 - js.min() * cell)],
                      "centre": [round(c.x), round(c.y)]})
        if len(lakes) >= 255:
            break
    datum = lakes[0]["level_nzvd"]
    for l in lakes:
        l["level"] = round(l["level_nzvd"] - datum, 2)
    print(f"main lake surface {datum:.2f} m above NZVD2016 (median of the LiDAR's flattened water)")
    for l in lakes[:12]:
        print(f"lake {l['name']}: {l['area_km2']:.2f} km2, surface {l['level_nzvd']:.1f} m, bed to {l['max_depth_m']:.0f} m")
    print(f"{len(lakes)} lakes")
    # gaps that are not lakes: the contour DEM, or the nearest valid cell where it has none
    gap = ~np.isfinite(zf) & (lakeid == 0)
    zf[gap] = z8[gap]
    still = ~np.isfinite(zf)
    if still.any():
        idx = ndimage.distance_transform_edt(still, return_distances=False, return_indices=True)
        zf[still] = zf[idx[0][still], idx[1][still]]
    zf[np.isfinite(bed)] = bed[np.isfinite(bed)]
    lakemask = lakeid > 0
    Image.fromarray(lakeid).save(os.path.join(city.out, "lakes.png"), optimize=True)
    h = zf - datum
    units = 0.125
    q = np.clip(np.round(h / units), -32768, 32767).astype(np.int32)
    with gzip.open(os.path.join(city.out, "terrain.bin.gz"), "wb", compresslevel=9) as f:
        f.write(encode_heights(q))
    print(f"terrain {h.min():.0f} .. {h.max():.0f} m about the lake")

    # ---- ground colour
    img = mosaic([os.path.join(raw, f"img_{s}.tif") for s in I["sheets"]], tfg, (GH, GW), city.proj, Resampling.cubic, bands=3)
    miss = ~np.isfinite(img[0])
    if miss.any():
        idx = ndimage.distance_transform_edt(miss, return_distances=False, return_indices=True)
        img = img[:, idx[0], idx[1]]
    rgb = np.clip(img, 0, 255).astype(np.uint8).transpose(1, 2, 0)
    # lakes at the ground's resolution
    up = lambda a, order=0: ndimage.zoom(a.astype(np.float32), (GH / H, GW / W), order=order)
    lake_g = up(lakemask) > 0.5
    hg = up(h, 1)
    sl = slope_deg(hg, px)

    # ---- the mosaic's own shadows (imagery.deshadow): under a fiord's walls the photograph is in blue shade for good,
    # and the viewer lights the land itself, so shade printed into the colour is a second shadow that never moves.
    # A shaded pixel (blue over green, dark, not water) takes the sunlit colour of what stands there (bush below the
    # bush line, scrub above it, rock where it is steep or high), with the photograph's own light and dark kept as texture
    shade_g = None
    if I.get("deshadow"):
        D = I["deshadow"] if isinstance(I["deshadow"], dict) else {}
        bush = D.get("bush_line_m", 950)
        f = rgb.astype(np.float32) / 255.0
        l0 = (f ** 2.2) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        elev0 = hg + datum
        shade = (f[..., 2] > f[..., 1] * D.get("blue_over_green", 0.96)) & (l0 < D.get("max_lum", 0.30)) & ~lake_g
        shade = ndimage.binary_opening(shade, iterations=1)
        sunlit_bush = (f[..., 1] > f[..., 0] * 1.08) & (f[..., 1] > f[..., 2] * 1.15) & (elev0 < bush) & ~shade & ~lake_g & (l0 > 0.012) & (l0 < 0.12)
        ref_bush = np.median(f[sunlit_bush], axis=0) if sunlit_bush.sum() > 500 else np.array([0.20, 0.30, 0.14], np.float32)
        ref_scrub = ref_bush * np.array([1.35, 1.2, 1.0], np.float32)
        ref_rock = np.array(D.get("rock_rgb", [0.47, 0.45, 0.42]), np.float32)
        ref_snow = np.array([0.90, 0.92, 0.95], np.float32)
        tex = np.clip(l0 / np.maximum(ndimage.gaussian_filter(l0, 8), 1e-4), 0.55, 1.6) ** 0.6
        rocky = (sl > D.get("rock_slope_deg", 60)) | (elev0 > bush + 350)
        kind = np.where(rocky, 4, np.where(elev0 < bush, 10, 9)).astype(np.uint8)
        kind[shade & (elev0 > bush + 250) & (l0 > D.get("snow_lum", 0.13))] = 2      # snow in shade: bright for a shadow
        new = np.where((kind == 4)[..., None], ref_rock, np.where((kind == 10)[..., None], ref_bush, np.where((kind == 2)[..., None], ref_snow, ref_scrub))) * tex[..., None]
        k = ndimage.gaussian_filter(shade.astype(np.float32), 1.2)[..., None]
        rgb = np.clip((f * (1 - k) + new * k) * 255, 0, 255).astype(np.uint8)
        shade_g, shade_kind = shade, kind
        print(f"deshadow: {shade.mean() * 100:.1f}% of the ground was in the mosaic's shade; sunlit bush {np.round(ref_bush * 255).astype(int).tolist()}")

    # ---- land cover
    lin = (rgb.astype(np.float32) / 255.0) ** 2.2
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    mx, mn = lin.max(2), lin.min(2)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
    cover = np.full((GH, GW), 7, np.uint8)                  # tussock by default
    elev = hg + datum
    cover[(elev > 1500) & (sat < 0.45)] = 8                  # alpine herbfield above the tussock
    green = (g > r * 1.08) & (g > b * 1.15)
    cover[green & (lum > 0.05) & (elev < 900) & (sl < 8)] = 11     # irrigated pasture on the flats
    cover[green & (lum <= 0.05)] = 9                         # dark green: scrub
    grey = sat < 0.18
    cover[grey & (lum > 0.08) & (lum < 0.45)] = 5            # grey ground: scree, moraine, shingle
    cover[(sl > 42) & (lum < 0.5)] = 4                       # cliffs
    snow = (lum > 0.42) & (sat < 0.25)
    cover[snow] = 2
    def osm(cls, value, subtype=None):
        where = f"class IN ({','.join(repr(c) for c in cls)})"
        geoms = [gm for n, c, s, gm in overture(city, "land", where) if gm.geom_type in ("Polygon", "MultiPolygon")]
        m = burn(geoms, tfg, (GH, GW)).astype(bool)
        return m
    gl = osm(["glacier"], 2)
    cover[gl & snow] = 2
    cover[gl & ~snow & (lum < 0.25)] = 3                     # the debris-covered tongues of the Tasman and Hooker
    cover[gl & ~snow & (lum >= 0.25)] = 2
    sc = osm(["scree", "shingle", "bare_rock", "rock", "stone"], 5) & ~gl
    cover[sc & ~snow] = 5
    cover[osm(["scrub", "heath"], 9) & ~snow & ~gl] = 9
    cover[osm(["wood", "forest", "tree", "tree_row"], 10) & ~snow & ~gl] = 10
    cover[osm(["wetland"], 12)] = 12
    rivers = [gm for n, c, s, gm in overture(city, "water", "class IN ('river','stream','canal')") if gm.geom_type in ("Polygon", "MultiPolygon")]
    riv = burn(rivers, tfg, (GH, GW)).astype(bool)
    # braided riverbeds: grey, flat, low, in a river polygon or OSM shingle on a valley floor
    bed_g = (grey | riv) & (sl < 4) & (lum > 0.08) & ~lake_g
    cover[bed_g & (riv | osm(["shingle"], 6))] = 6
    lines = [gm for n, c, s, gm in overture(city, "water", "class IN ('river','stream','canal')") if gm.geom_type in ("LineString", "MultiLineString")]
    cover[burn([l.buffer(4) for l in lines], tfg, (GH, GW)).astype(bool) & ~lake_g & (sl < 30)] = 1
    roads = overture(city, "segment")
    road_geoms = [gm.buffer({"primary": 4.5, "secondary": 4, "tertiary": 3.5, "residential": 3.5, "unclassified": 3, "service": 2.5}.get(c, 0))
                  for n, c, s, gm in roads if c in ("primary", "secondary", "tertiary", "residential", "unclassified", "service")]
    cover[burn(road_geoms, tfg, (GH, GW), all_touched=True).astype(bool)] = 13
    blds = [gm for n, c, s, gm in overture(city, "building")]
    cover[burn(blds, tfg, (GH, GW), all_touched=True).astype(bool)] = 14
    if shade_g is not None:
        # what was in shade is classed by where it stands (its colour said nothing), and green ground under the
        # bush line is bush whether OpenStreetMap has drawn the wood or not
        keep = np.isin(cover, (1, 13, 14))
        bl = I["deshadow"].get("bush_line_m", 950) if isinstance(I["deshadow"], dict) else 950
        # under the bush line a wall is bare only where it stands past 60 degrees: beech and rata hold on anything less
        cover[(cover == 4) & (elev < bl) & (sl < 60) & ~shade_g] = 10
        cover[shade_g & ~keep] = shade_kind[shade_g & ~keep]
        cover[green & (elev < I["deshadow"].get("bush_line_m", 950) if isinstance(I["deshadow"], dict) else green & (elev < 950)) & ~keep & (sl < 50) & ~snow] = 10
    cover = mode_filter(cover, 3, keep=(1, 13, 14))
    cover[lake_g] = 0
    shore = ndimage.binary_dilation(lake_g, iterations=3) & ~lake_g & (cover != 13) & (cover != 14)
    cover[shore & (sl < 12)] = 15

    # under the lakes: the colour of their own shore (gravel and silt), pushed out under the water
    land_near = ~lake_g
    idx = ndimage.distance_transform_edt(~(land_near & ~ndimage.binary_dilation(lake_g, iterations=1)), return_distances=False, return_indices=True)
    under = rgb[idx[0], idx[1]].astype(np.float32)
    silt = np.array([150, 146, 136], np.float32)
    dist = ndimage.distance_transform_edt(lake_g) * px
    k = np.clip(dist / 60.0, 0, 1)[..., None]
    under = under * (1 - k) + silt * k
    rgb[lake_g] = under[lake_g].astype(np.uint8)

    # ---- write the ground in strips, and the cover
    # strips end on a boundary of four terrain chunks (64 cells each), so every chunk and every merged block of
    # 4 x 4 far chunks draws from one strip (web/reef/alpine/terrain.js)
    block_px = int(round(4 * 64 * cell / px))
    step = (STRIP // block_px) * block_px
    strips = []
    for i in range(int(math.ceil(GH / step))):
        a, b2 = i * step, min(GH, (i + 1) * step)
        name = f"ground_{i}.webp"
        Image.fromarray(rgb[a:b2]).save(os.path.join(city.out, name), quality=82, method=6)
        strips.append({"file": name, "row0": a, "rows": b2 - a})
    # the cover at twice the ground's pixel (20 m), within a phone's texture size; the classes only steer detail
    cpx = px * 2
    cov2 = mode_filter(cover, 2, keep=(13,))[::2, ::2]
    print(f"cover: {river_snow(cov2)} snow pixels along the rivers taken for river")
    Image.fromarray(cov2).save(os.path.join(city.out, "cover.png"), optimize=True)
    for stale in ("terrain.bin", "ground.jpg", "habitat.png"):
        p = os.path.join(city.out, stale)
        if os.path.exists(p):
            os.remove(p)

    # ---- roads and tracks as lines (the viewer drapes them; the game walks them)
    keepcls = ("primary", "secondary", "tertiary", "residential", "unclassified", "service", "track", "path", "footway", "cycleway", "steps")
    lines_out = []
    for n, c, s, gm in roads:
        if c not in keepcls:
            continue
        for ln in (gm.geoms if hasattr(gm, "geoms") else [gm]):
            ln = ln.simplify(2.0)
            co = [[round(x, 1), round(y, 1)] for x, y in ln.coords if city.x0 <= x <= city.x1 and city.y0 <= y <= city.y1]
            if len(co) >= 2:
                lines_out.append({"c": c, "n": n, "p": co})
    json.dump({"lines": lines_out}, open(os.path.join(city.out, "roads.json"), "w"), separators=(",", ":"))

    # ---- buildings: footprints with a height guessed from their kind (no DSM read yet)
    bout = []
    for n, c, s, gm in overture(city, "building"):
        for p in polygons(gm):
            co = [[round(x, 1), round(y, 1)] for x, y in p.exterior.simplify(0.5).coords[:-1]]
            if len(co) >= 3 and city.x0 <= co[0][0] <= city.x1 and city.y0 <= co[0][1] <= city.y1:
                bout.append({"n": n, "c": c, "p": co})
    json.dump({"structures": bout}, open(os.path.join(city.out, "structures.json"), "w"), separators=(",", ":"))

    # ---- scene.json
    from marine_meta import meta
    optics = cfg.get("optics") or {"K": [0.9, 0.55, 0.62], "Rinf": [0.035, 0.085, 0.095], "g": 2.2}
    scene = {
        "id": city.id, "name": cfg["name"], "native": cfg.get("native"), "kind": "alpine", "origin": cfg["origin"],
        "timezone": cfg["timezone"], "extent_m": cfg["extent_m"], "vertical_datum": cfg.get("vertical_datum"),
        "terrain": {"file": "terrain.bin.gz", "w": W, "h": H, "cell_m": cell, "x0": city.x0, "y1": city.y1, "units_m": units,
                    "datum_m": round(datum, 2), "bytes": int(W * H * 2), "encoding": "plane-residual, byte planes, gzip"},
        "ground": {"strips": strips, "w": GW, "h": GH, "px_m": px},
        "cover": {"file": "cover.png", "w": int(cov2.shape[1]), "h": int(cov2.shape[0]), "px_m": cpx, "classes": {str(k): v for k, v in COVER.items()}},
        "lakes": lakes, "lake_ids": "lakes.png", "optics": optics, "roads": "roads.json", "structures": "structures.json",
        "start": cfg.get("start", {}),
        **({"biome": cfg["biome"]} if cfg.get("biome") else {}),
        "sources": [T["attribution"], I["attribution"], "OpenStreetMap contributors via Overture Maps (ODbL): glaciers, scree, scrub, woods, water, roads, buildings, places"]
                   + [l["depth_src"] for l in lakes if l["main"]],
    }
    scene.update(meta(city))
    old = os.path.join(city.out, "scene.json")
    if os.path.exists(old):                       # the aerial patches (alpine_detail.py) are kept across a rebuild
        prev = json.load(open(old))
        if prev.get("detail"):
            scene["detail"] = prev["detail"]
    json.dump(scene, open(os.path.join(city.out, "scene.json"), "w"), indent=1)
    stats = {COVER[k]: round(float((cover == k).mean() * 100), 2) for k in COVER}
    os.makedirs(city.analysis, exist_ok=True)
    json.dump({"datum_m": datum, "lakes": lakes, "cover_pct": stats}, open(os.path.join(city.analysis, "build.json"), "w"), indent=1)
    print("cover %:", stats)
    sizes_out = {f: os.path.getsize(os.path.join(city.out, f)) for f in os.listdir(city.out)}
    print("files:", {k: f"{v / 1e6:.2f} MB" for k, v in sorted(sizes_out.items())})


if __name__ == "__main__":
    main()
