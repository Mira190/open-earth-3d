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
down to a floor of 4 m, which every kind reaches by REACH_M out. The water shader uses the
same depths to decide how much of the bottom shows through.
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
# Decks over the water that OpenStreetMap does not map as a pier polygon (issue 50): a car park
# that is a pier (Hong Kong's Pier No. 3, man_made=pier), a car park, helipad or apron out on the
# water, and a pier mapped as a line (Tokyo's finger piers on the Sumida). Overture's base water
# runs straight over them, so without a deck the photograph of the car park shows through the water.
DECK_CLASSES = {"parking", "helipad", "heliport", "apron"}
DECK_IN_WATER = 0.5  # a mapped area this much in the water is a deck over it
ROOF_ELE_M = 10.0  # a pad mapped this high (ele) is on a roof, not a deck (Hong Kong's Sky Shuttle Heliport)
LINE_PIER_HALF_M = 1.5  # a pier mapped as a line, with nothing on it: a 3 m jetty
ROAD_HALF_M = 3.0  # half a road's width on a pier, past the road's centre line
PATH_HALF_M = 1.0  # half a footpath's
PATHS = {"footway", "path", "pedestrian", "cycleway", "steps", "bridleway", "sidewalk", "crosswalk"}
ROAD_ON_PIER_M = 15.0  # a road this near a line pier, out over the water, runs along its deck
LINE_PIER_MAX_HALF_M = 12.0


def _num(v):
    try:
        return float(str(v).split(";")[0])
    except (TypeError, ValueError):
        return None


def deck_like(r):
    """Whether an Overture infrastructure row stands at the waterfront's level: not underground
    (level < 0, parking=underground: Amsterdam's garages under its canals), not on a roof (a
    building tag, or mapped high: a rooftop heliport)."""
    tags = dict(r.get("source_tags") or {})
    lv = r.get("level")
    if (lv is not None and lv < 0) or tags.get("parking") in ("underground", "multi-storey", "rooftop") or tags.get("location") in ("underground", "roof", "rooftop"):
        return False
    if any((_num(x) or 0) < 0 for x in str(tags.get("level", "")).split(";") if x):
        return False
    if tags.get("building") or (_num(tags.get("ele")) or 0) > ROOF_ELE_M or tags.get("aeroway") == "helipad" and tags.get("location") == "roof":
        return False
    return True


def decks(C, con, raw, rows, sea):
    """Deck polygons (local frame) for the structures over the water that are not pier polygons:
    any area tagged man_made=pier whatever its Overture class, areas of DECK_CLASSES mostly in the
    water and at ground level (deck_like), the water part of each line pier, as wide as the
    roads that run along it over the water (a service road down a finger pier), else a 3 m jetty,
    and the wharf decks mapped as buildings (wet_buildings.py).
    pipeline/build_scene.py adds them to the piers."""
    path = raw("infrastructure")
    if not sea or not os.path.exists(path):
        return []
    wet = shapely.union_all(sea)
    shapely.prepare(wet)
    con_cols = {d[0] for d in con.execute(f"DESCRIBE SELECT * FROM '{path}'").fetchall()}
    tagged = "source_tags" in con_cols
    out, lines = [], []
    for r in rows(con, path, "class, wkb" + (", level, source_tags" if tagged else "")):
        tags = dict(r.get("source_tags") or {})
        pier = r["class"] == "pier" or tags.get("man_made") == "pier"
        if not pier and r["class"] not in DECK_CLASSES:
            continue
        g = C.to_local(swkb.loads(bytes(r["wkb"])))
        if pier and r["class"] == "pier":
            lines += [g] if g.geom_type == "LineString" else [q for q in getattr(g, "geoms", []) if q.geom_type == "LineString"]
            continue  # its polygons are the mapped piers already
        if not pier and not (tagged and deck_like(r)):
            continue  # without the tags, nothing tells a garage under a canal from a car park on a pier
        for p in polygons(g):
            if p.area > 20 and wet.intersection(p).area >= DECK_IN_WATER * p.area:
                out.append(p)
    if lines:
        roads, widths = [], []
        seg = raw("segment")
        if os.path.exists(seg):
            for r in rows(con, seg, "subtype, class, road_flags, level_rules, wkb"):
                if r["subtype"] != "road" or any((lv.get("value") or 0) != 0 for lv in r["level_rules"] or []):
                    continue
                if any(set(f.get("values") or []) & {"is_bridge", "is_tunnel"} for f in r["road_flags"] or []):
                    continue
                roads.append(C.to_local(swkb.loads(bytes(r["wkb"]))))
                widths.append(PATH_HALF_M if r["class"] in PATHS else ROAD_HALF_M)
        tree = shapely.STRtree(roads) if roads else None
        # a road out on the open water, not one along the quay nor one on a mapped pier (which is
        # its own deck: the outline of a wharf mapped as a line beside it is not widened by it)
        mapped = [p for r in rows(con, path, "class, wkb") if r["class"] == "pier"
                  for p in polygons(C.to_local(swkb.loads(bytes(r["wkb"]))))]
        open_water = wet.buffer(-4.0)
        if mapped:
            open_water = open_water.difference(shapely.union_all(mapped).buffer(2.0))
        for ln in lines:
            if not wet.intersects(ln):
                continue
            half = LINE_PIER_HALF_M
            if tree is not None:
                near = ln.buffer(ROAD_ON_PIER_M)
                for i in tree.query(near):
                    on = roads[i].intersection(near).intersection(open_water)
                    if on.is_empty or on.length < 10:
                        continue
                    # the points alongside the pier, not past either end of it (a path turning off it)
                    pts = [q for q in (on.interpolate(d) for d in np.arange(0, on.length, 2.0)) if 1.0 < ln.project(q) < ln.length - 1.0]
                    if len(pts) >= 5:
                        half = max(half, min(LINE_PIER_MAX_HALF_M, max(ln.distance(q) for q in pts) + widths[i]))
            out += [p for p in polygons(ln.buffer(half, cap_style="flat").intersection(wet.buffer(half))) if p.area > 20]
    # a wharf deck mapped as a building (pipeline/wet_buildings.py: Garden Island's cruiser wharf)
    import wet_buildings
    out += wet_buildings.decks(C, con, raw, sea)
    return out


SLOPES = {"sand": 0.04, "rock": 0.25, "built": 1.0}  # depth per metre from the shore
FLOOR_M = 4.0
# the bottom reaches the floor this far out whatever the kind of shore (web/water.js SHORE_REACH):
# shore.png encodes the distance only to 63.5 m, and a beach's slope alone (0.04) would reach the
# floor only at 100 m, so the water would stay shallow out across the bay, in a wedge for every
# stretch of sand that is the nearest shore (issue 39). Within the reach a beach keeps its slope
# at the waterline and curves down to the floor; rock and seawalls reach it sooner by themselves.
REACH_M = 60.0
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
    # a beach the map does not have (city.json water.sand: [{ring: [[lon, lat], ...], note}]), which would otherwise be
    # shored as a quay
    for b in cfg.get("water", {}).get("sand", []):
        sand.extend(polygons(C.to_local(shapely.Polygon(b["ring"])).buffer(0).intersection(extent)))
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
    return profile(np.maximum(sm["signed"][r, c], 0.0), slope)


def profile(d, slope):
    """Modelled depth (m) at d metres from the shore off a shore of this slope: the slope at the
    waterline, curving down to FLOOR_M by REACH_M (web/water.js computes the same)."""
    d = np.asarray(d, float)
    return np.minimum(FLOOR_M, slope * d + np.maximum(0.0, FLOOR_M - slope * REACH_M) * (d / REACH_M) ** 2)


PAD_APRON_M = 14.0  # a helipad on or by the water stands on an apron this far round it (game_data.py)


def water_floor(sm, water, gx, gy, x0, y1):
    """The game's ground under the water (game_data.py terrain): the modelled bottom, and just
    under the surface off a quay, as in the viewer's terrain. gx, gy: the cells' centres."""
    floor = -depth_at(sm, gx, gy, x0, y1)
    edge = water & ndimage.binary_dilation(~water)
    floor[edge] = np.maximum(floor[edge], -QUAY_SHELF_M)
    return floor


def pad_aprons(grid, water, gx, gy, helipads):
    """Raise the water cells within PAD_APRON_M of each helipad to the pad's height, in place: a
    floating pad, one whose own cell is water. A pad on land (as the Hong Kong Convention and
    Exhibition Centre's, on its roof by the harbour) gets none, so the harbour beside it keeps its
    bottom. Only the pads given, which are the ones the game data lists: a pad a city leaves out
    gets no apron (pipeline/pad_discs.py lowers old ones)."""
    for hp in helipads:
        x, y, z = hp["at"]
        d = np.hypot(gx - x, gy - y)
        if not water.flat[int(np.argmin(d))]:
            continue
        near = water & (d < PAD_APRON_M)
        grid[near] = np.maximum(grid[near], max(z, 0.0))
    return grid


def from_png(path, x0, y1, cfg):
    """shore_map() read back from shore.png (for pipeline/game_data.py)."""
    a = np.asarray(Image.open(path).convert("RGBA")).astype(float)
    signed = (a[..., 0] - 128) / 2
    return {"signed": signed, "sand": a[..., 1] > 127, "rock": a[..., 2] > 127, "nx": a.shape[1], "ny": a.shape[0],
            "slopes": SLOPES | cfg.get("water", {}).get("shore_slopes", {})}
