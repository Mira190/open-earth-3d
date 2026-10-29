"""Turn a city's raw downloads into the scene shared by the web viewer, the
analyses and the Blender script: footprints with resolved heights and their
provenance, bare-earth terrain, aerial imagery tiles, water, piers, trees,
public places and landmark anchors.

    python pipeline/build_scene.py --city sydney      # data/raw/<city> -> web/data/<city>

Heights are resolved from the best evidence available (see docs/ARCHITECTURE.md):
a cited verification or published height, an OSM-surveyed height, an OSM floor
count times a calibrated storey height, a bias-corrected ML height blended with
neighbours, or an estimate from nearby known heights. Every estimator is
cross-validated; the residuals go to cities/<city>/analysis/height_model.json.
"""
import base64
import csv
import json
import math
import os
from collections import Counter, defaultdict

import duckdb
import numpy as np
import shapely
import shapely.affinity
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.ndimage import map_coordinates
from pyproj import Transformer
from scipy.spatial import cKDTree
from shapely import wkb as swkb
from shapely.geometry import Polygon, box
from shapely.ops import polylabel

import roofs
import typology
from measured import IGNHeights
from cityctx import ROOT, City, city_args, polygons
from shore import FLOOR_M, QUAY_SHELF_M, SHORE_CELL, depth_at, raised_classes, shore_map, without_raised
from survey import Survey

DEM_CELL = 5.0       # m, building bases and analysis
LIDAR_CELL = 1.0     # m, a LiDAR surface model sampled under footprints
TERRAIN_CELL = 10.0  # m, shipped mesh grid
TILE_W, TILE_H, IMG_M = 1000, 1200, 1.0  # ground tiles: metres and metres per pixel

RESIDENTIAL = {"apartments", "residential", "house", "hotel", "dormitory", "terrace", "semidetached_house", "detached", "bungalow"}
SMALL = {"garage", "garages", "shed", "carport", "shelter", "toilets", "kiosk", "hut", "service", "greenhouse", "roof"}
GROUPS = {"house": {"house", "detached", "terrace", "semidetached_house", "bungalow"}, "small": SMALL,
          "res": {"apartments", "residential", "hotel", "dormitory"}, "com": {"office", "commercial", "retail"}}
ML_BINS = [0, 6, 9, 12, 16, 25, 1e9]
MISSING_BANDS = [0, 15, 30, 1e9]
DEFAULT_STOREY = {"res": (3.0, 2.8), "non": (3.9, 0.0)}  # height = floors * a + b


def rows(con, path, cols="*"):
    cur = con.execute(f"SELECT {cols} FROM '{path}'")
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def ring(coords):
    a = np.asarray(coords)[:-1]
    return [int(round(v * 10)) for xy in a for v in xy]  # decimetres, flat x,y list


# ---------------------------------------------------------------- terrain

def load_dem(C, cell=DEM_CELL, name="dem", absolute=False):
    """The city's DEM (or another raster fetch_tiles.py wrote, such as a LiDAR surface model "dsm")
    resampled to the local frame; row 0 is the north edge. Heights are in the
    scene's datum: the source's minus the city's `datum_offset_m` (0 for a coastal city; an inland
    city puts its river's normal level at 0, where the viewer's water plane is). absolute=True
    keeps the source's datum, for comparisons with other elevation sources."""
    meta = json.load(open(os.path.join(C.raw, f"{name}.json")))
    im = np.asarray(Image.open(os.path.join(C.raw, f"{name}.tif")), dtype=np.float32)
    mx0, my0, mx1, my1 = meta["bbox"]
    h, w = im.shape
    nx, ny = int((C.x1 - C.x0) / cell) + 1, int((C.y1 - C.y0) / cell) + 1
    gx, gy = np.meshgrid(C.x0 + np.arange(nx) * cell, C.y1 - np.arange(ny) * cell)
    lon, lat = C.inv.transform(gx.ravel(), gy.ravel())
    if meta.get("crs", "EPSG:3857") == "EPSG:3857":
        mx = np.asarray(lon) * 20037508.342789 / 180
        my = np.log(np.tan((90 + np.asarray(lat)) * np.pi / 360)) * 6378137
    else:  # the local frame is WGS84, taken as the DEM's own realisation (frame_crs: GDA2020 in Australia, within
        # 0.5 m; RGF93 in France), converted to the DEM's CRS
        mx, my = Transformer.from_crs(meta.get("frame_crs", "EPSG:7844"), meta["crs"], always_xy=True).transform(np.asarray(lon), np.asarray(lat))
    col = (np.asarray(mx) - mx0) / (mx1 - mx0) * w - 0.5
    row = (my1 - np.asarray(my)) / (my1 - my0) * h - 0.5
    z = map_coordinates(im, [row, col], order=1, mode="nearest").reshape(ny, nx) - C.cfg.get("datum_offset_m", 0.0)
    if name == "dem":
        z = level_areas(C, raise_mapped(C, z, cell), cell)
    return z + C.cfg.get("datum_offset_m", 0.0) if absolute else z


def raise_mapped(C, dem, cell):
    """Structures a bare-earth DEM flattens to the water, raised from their mapped outlines
    (terrain.raise: [{class, crest_m, slope_m}], Overture infrastructure classes such as a
    breakwater): the ground climbs from the outline to crest_m, slope_m in from it."""
    rules = C.cfg.get("terrain", {}).get("raise", [])
    path = os.path.join(C.raw, "overture_infrastructure.parquet")
    if not rules or not os.path.exists(path):
        return dem
    ny, nx = dem.shape
    con = duckdb.connect()
    for rule in rules:
        polys = [p for r in rows(con, path) if r["class"] == rule["class"]
                 for p in polygons(C.to_local(swkb.loads(bytes(r["wkb"]))))]
        inside = raster_mask(polys, nx, ny, cell, C.x0, C.y1)
        d = ndimage.distance_transform_edt(inside) * cell
        dem = np.where(inside, np.maximum(dem, rule["crest_m"] * np.minimum(1.0, d / rule.get("slope_m", 4.0))), dem)
    return dem


def level_areas(C, dem, cell):
    """Ground a bare-earth DEM gets wrong, levelled (terrain.level: [{ring, z_m, feather_m}], ring in
    longitude and latitude): where a laser survey's filter took out a large structure and the gap
    was interpolated into a false terrace. The ground inside the ring goes to z_m, blended with the
    DEM over feather_m inside its edge."""
    rules = C.cfg.get("terrain", {}).get("level", [])
    ny, nx = dem.shape
    for rule in rules:
        inside = raster_mask([C.to_local(Polygon(rule["ring"]))], nx, ny, cell, C.x0, C.y1)
        w = np.minimum(1.0, ndimage.distance_transform_edt(inside) * cell / rule.get("feather_m", 8.0))
        dem = np.where(inside, dem + (rule["z_m"] - dem) * w, dem)
    return dem


def water_polygons(C, con, raw, extent):
    """The city's water bodies in the local frame: Overture water of the configured classes and
    size, less the islands mapped in them (a river polygon can enclose its islands) and any
    body whose centre falls in an `exclude` box ([west, south, east, north]: water kept at
    another level than the scene's, such as a polder's ponds)."""
    wcfg = C.cfg.get("water", {})
    wclasses, wmin = set(wcfg.get("classes", ["ocean", "bay", "water"])), wcfg.get("min_area_m2", 5000)
    boxes = [shapely.box(*e["box"]) for e in wcfg.get("exclude", [])]
    seas = [g for g in (swkb.loads(bytes(r["wkb"])) for r in rows(con, raw("water")) if r["class"] in wclasses)
            if not any(b.contains(g.centroid) for b in boxes)]
    seas = [C.to_local(g) for g in seas]
    sea = [p for g in seas for p in polygons(g.intersection(extent.buffer(50))) if p.area > wmin]
    isles = [C.to_local(swkb.loads(bytes(r["wkb"]))) for r in rows(con, raw("land"), "class, wkb") if r["class"] in ("island", "islet")]
    # an island that covers the model is the land the city stands on (Honshu, for Osaka), not one in its water
    isles = [g for g in isles if g.geom_type in ("Polygon", "MultiPolygon") and g.intersects(extent) and g.intersection(extent).area < 0.9 * extent.area]
    if isles:
        land = shapely.union_all(isles)
        sea = [p for g in sea for p in polygons(g.difference(land)) if p.area > wmin]
    return without_raised(C, con, raw("infrastructure"), rows, sea)  # less the breakwaters the terrain raises


def raster_mask(polys, nx, ny, cell, x0, y1):
    img = Image.new("L", (nx, ny), 0)
    d = ImageDraw.Draw(img)
    tr = lambda cs: [((x - x0) / cell, (y1 - y) / cell) for x, y in cs]
    for p in polys:
        if p.is_empty:
            continue
        d.polygon(tr(p.exterior.coords), fill=1)
        for r in p.interiors:
            d.polygon(tr(r.coords), fill=0)
    return np.asarray(img, dtype=bool)


def sample(C, grid, x, y, cell=DEM_CELL):
    c = np.clip((np.atleast_1d(x) - C.x0) / cell, 0, grid.shape[1] - 1)
    r = np.clip((C.y1 - np.atleast_1d(y)) / cell, 0, grid.shape[0] - 1)
    return map_coordinates(grid, [r, c], order=1, mode="nearest")


# ---------------------------------------------------------------- imagery

def ground_tiles(C):
    z, ext = C.cfg["imagery"]["zoom"], C.cfg["imagery"].get("format", "jpg")
    d = os.path.join(C.raw, "imagery", str(z))
    names = [f.rsplit(".", 1)[0].split("_") for f in os.listdir(d) if f.endswith("." + ext)]
    xs = sorted({int(a) for a, _ in names})
    ys = sorted({int(b) for _, b in names})
    mosaic = np.zeros(((ys[-1] - ys[0] + 1) * 256, (xs[-1] - xs[0] + 1) * 256, 3), np.uint8)
    for tx in xs:
        for ty in ys:
            p = os.path.join(d, f"{tx}_{ty}.{ext}")
            if os.path.exists(p):
                mosaic[(ty - ys[0]) * 256:(ty - ys[0] + 1) * 256, (tx - xs[0]) * 256:(tx - xs[0] + 1) * 256] = \
                    np.asarray(Image.open(p).convert("RGB"))
    n = 2 ** z * 256
    tiles = []
    ortho = np.zeros((int((C.y1 - C.y0) / IMG_M), int((C.x1 - C.x0) / IMG_M), 3), np.uint8)
    for j, ty0 in enumerate(np.arange(C.y1, C.y0, -TILE_H)):
        for i, tx0 in enumerate(np.arange(C.x0, C.x1, TILE_W)):
            w, h = int(TILE_W / IMG_M), int(TILE_H / IMG_M)
            gx, gy = np.meshgrid(tx0 + (np.arange(w) + 0.5) * IMG_M, ty0 - (np.arange(h) + 0.5) * IMG_M)
            lon, lat = C.inv.transform(gx.ravel(), gy.ravel())
            px = (np.asarray(lon) + 180) / 360 * n - xs[0] * 256 - 0.5
            py = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n - ys[0] * 256 - 0.5
            rgb = np.stack([map_coordinates(mosaic[:, :, k], [py, px], order=1).reshape(h, w) for k in range(3)], -1)
            hh, ww = min(h, ortho.shape[0] - j * h), min(w, ortho.shape[1] - i * w)
            ortho[j * h:j * h + hh, i * w:i * w + ww] = rgb[:hh, :ww]
            name = f"ground_{i}_{j}.jpg"
            Image.fromarray(rgb).save(os.path.join(C.out, name), quality=82, optimize=True)
            tiles.append({"file": name, "x0": float(tx0), "x1": float(tx0 + TILE_W), "y0": float(ty0 - TILE_H), "y1": float(ty0)})
    return tiles, ortho


# the ground drawn from the vector data, for cities without open aerial imagery
SYNTH = {
    "base": "#cdc8bd", "lawn": "#9db37a", "garden": "#8fab6e", "pitch": "#8db36a", "paving": "#dad4c7", "ballast": "#8e8a83",
    "dirt": "#b7a68c", "wood": "#6f8c58", "sand": "#d9c9a0", "wetland": "#7d9474", "rock": "#a29c92", "water": "#456a78",
    "kerb": "#bdb7ac", "asphalt": "#55595e", "service": "#6a6e72", "foot": "#d6cfc2", "cycle": "#c4b4a2", "rail": "#6d655e",
    "building": "#8f8b84", "pier": "#a08f76",
}
LANDUSE_FILL = {"park": "lawn", "grass": "lawn", "meadow": "lawn", "recreation_ground": "lawn", "village_green": "lawn", "cemetery": "lawn",
                "garden": "garden", "flowerbed": "garden", "allotments": "garden", "plant_nursery": "garden", "pitch": "pitch",
                "pedestrian": "paving", "plaza": "paving", "railway": "ballast", "construction": "dirt", "brownfield": "dirt", "greenfield": "dirt"}
LAND_FILL = {"forest": "wood", "wood": "wood", "scrub": "wood", "shrub": "wood", "heath": "wood", "grass": "lawn", "grassland": "lawn",
             "sand": "sand", "beach": "sand", "wetland": "wetland", "rock": "rock", "scree": "rock", "bare_rock": "rock"}
ROAD_W = {"motorway": 16, "trunk": 14, "primary": 13, "secondary": 11, "tertiary": 9, "residential": 7, "unclassified": 7,
          "living_street": 6, "service": 4, "unknown": 5}
FOOT_W = {"footway": 2.5, "pedestrian": 4, "path": 2, "steps": 3, "cycleway": 2, "track": 3}


def synth_ground(C, con, raw, extent):
    """Ground tiles drawn from land use, land, water, roads, footways, rail and footprints,
    with fine noise and contact shading around buildings so it reads as a surface."""
    from PIL import ImageFilter
    w, h = int((C.x1 - C.x0) / IMG_M), int((C.y1 - C.y0) / IMG_M)
    img = Image.new("RGB", (w, h), SYNTH["base"])
    d = ImageDraw.Draw(img)
    P = lambda cs: [((x - C.x0) / IMG_M, (C.y1 - y) / IMG_M) for x, y in cs]

    def fill(geom, colour):
        for p in polygons(geom.intersection(extent)):
            if p.is_empty or len(p.exterior.coords) < 4:
                continue
            d.polygon(P(p.exterior.coords), fill=colour)
            for r in p.interiors:
                d.polygon(P(r.coords), fill=SYNTH["base"])

    def stroke(geom, colour, width):
        for ln in getattr(geom, "geoms", [geom]):
            if ln.geom_type == "LineString" and len(ln.coords) > 1:
                d.line(P(ln.coords), fill=colour, width=max(1, int(round(width / IMG_M))), joint="curve")
    local = lambda r: C.to_local(swkb.loads(bytes(r["wkb"])))
    lu = sorted(rows(con, raw("land_use")), key=lambda r: -swkb.loads(bytes(r["wkb"])).area)  # small ones on top
    for r in lu:
        if r["class"] in LANDUSE_FILL:
            fill(local(r), SYNTH[LANDUSE_FILL[r["class"]]])
    for r in rows(con, raw("land")):
        if r["class"] in LAND_FILL:
            g = local(r)
            if g.geom_type in ("Polygon", "MultiPolygon"):
                fill(g, SYNTH[LAND_FILL[r["class"]]])
    for r in rows(con, raw("water")):
        g = local(r)
        if g.geom_type in ("Polygon", "MultiPolygon") and r["class"] not in ("strait", "sea", "ocean"):
            fill(g, SYNTH["water"])
    segs = rows(con, raw("segment"), "class, subtype, road_flags, wkb")
    tunnel = lambda r: any("is_tunnel" in (f.get("values") or []) and (f.get("between") or [0, 1]) == [0, 1] for f in (r["road_flags"] or []))
    roads = [(local(r), r) for r in segs if r["subtype"] == "road" and not tunnel(r)]
    for g, r in roads:  # footpaths and kerbs either side of the carriageway first
        if r["class"] in ROAD_W and r["class"] != "service":
            stroke(g, SYNTH["kerb"], ROAD_W[r["class"]] + 5)
    for g, r in roads:
        if r["class"] in FOOT_W:
            stroke(g, SYNTH["cycle" if r["class"] == "cycleway" else "foot"], FOOT_W[r["class"]])
    for g, r in sorted(roads, key=lambda q: ROAD_W.get(q[1]["class"], 0)):
        if r["class"] in ROAD_W:
            stroke(g, SYNTH["service" if r["class"] == "service" else "asphalt"], ROAD_W[r["class"]])
    for r in segs:
        if r["subtype"] == "rail" and not tunnel(r):
            stroke(local(r), SYNTH["rail"], 1.5)
    rock_classes = raised_classes(C.cfg)
    for r in rows(con, raw("infrastructure")):
        if r["class"] == "pier" or r["class"] in rock_classes:
            g = local(r)
            if g.geom_type in ("Polygon", "MultiPolygon"):
                fill(g, SYNTH["pier" if r["class"] == "pier" else "rock"])
    # footprints, and contact shading around them
    mask = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mask)
    for r in rows(con, raw("building"), "is_underground, wkb"):
        if r["is_underground"]:
            continue
        for p in polygons(local(r).intersection(extent)):
            if p.is_empty or len(p.exterior.coords) < 4:
                continue
            d.polygon(P(p.exterior.coords), fill=SYNTH["building"])
            md.polygon(P(p.exterior.coords), fill=255)
    a = np.asarray(img).astype(np.float32)
    ao = np.asarray(mask.filter(ImageFilter.GaussianBlur(4 / IMG_M))).astype(np.float32) / 255
    a *= (1 - 0.22 * ao)[..., None]
    rng = np.random.default_rng(7)
    coarse = np.asarray(Image.fromarray(rng.normal(0, 1, (h // 16 + 1, w // 16 + 1)).astype(np.float32)).resize((w, h), Image.BILINEAR))
    a *= (1 + 0.035 * coarse)[..., None]
    a += rng.normal(0, 3.0, (h, w, 1))
    ortho = np.asarray(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.5)))
    tiles = []
    for j, ty0 in enumerate(np.arange(C.y1, C.y0, -TILE_H)):
        for i, tx0 in enumerate(np.arange(C.x0, C.x1, TILE_W)):
            tw, th = int(TILE_W / IMG_M), int(TILE_H / IMG_M)
            tile = np.full((th, tw, 3), 128, np.uint8)
            part = ortho[j * th:(j + 1) * th, i * tw:(i + 1) * tw]
            tile[:part.shape[0], :part.shape[1]] = part
            name = f"ground_{i}_{j}.jpg"
            Image.fromarray(tile).save(os.path.join(C.out, name), quality=80, optimize=True)
            tiles.append({"file": name, "x0": float(tx0), "x1": float(tx0 + TILE_W), "y0": float(ty0 - TILE_H), "y1": float(ty0)})
    return tiles, ortho


FACADE = {"brick": "#9c6b52", "glass": "#7d93a3", "plaster": "#d9d2c3", "concrete": "#b4b0a8", "stone": "#c9ad7f",
          "metal": "#9aa1a6", "timber_framing": "#8a6a4d"}
HERITAGE = {"church", "cathedral", "public", "government", "train_station", "university", "college", "civic", "museum"}


def muted(hex_colour):
    """A mapped colour as a facade would show it. OSM colours are often names
    turned into pure hues ("blue" -> #0000ff); real cladding is far less
    saturated, so cap saturation at 0.35 and brightness between 0.2 and 0.8 (hue kept)."""
    import colorsys
    r, g, b = (int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    r, g, b = colorsys.hsv_to_rgb(h, min(s, 0.35), min(max(v, 0.2), 0.8))  # and "black" is dark grey glass, not a hole
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def wall_colour(b, cls, top, seed):
    """Overture facade colour (muted) or material when mapped, else a class palette."""
    if b.get("facade_color") and str(b["facade_color"]).startswith("#") and len(b["facade_color"]) == 7:
        return muted(b["facade_color"])
    if b.get("facade_material") in FACADE:
        return FACADE[b["facade_material"]]
    if cls in HERITAGE:
        pal = ["#c8a978", "#bf9f70", "#d0b386"]
    elif top >= 45:
        pal = ["#6f8494", "#5d7181", "#8a98a1", "#9b9a92", "#7c8c96", "#a8a294", "#566a78", "#b3ab9b"]
    elif cls in RESIDENTIAL:
        pal = ["#b9a48f", "#a8826b", "#cfc6b8", "#c4b39c", "#9e7a66"]
    else:
        pal = ["#bdb6aa", "#c9c2b5", "#aaa49a", "#d2cbbd"]
    return pal[seed % len(pal)]


ROOFS = ["#8d8f8f", "#9a9690", "#7f8285", "#a39d93", "#6f7275", "#a6a29a"]


def roof_colour(C, ortho, geom, top):
    """Median aerial-photo colour inside the footprint; tall towers lean in a
    non-true orthophoto, so they get a neutral roof instead (as does every roof
    when the ground is drawn rather than photographed)."""
    if C.cfg["imagery"]["type"] != "xyz":
        return ROOFS[int(abs(geom.centroid.x * 7 + geom.centroid.y * 13)) % len(ROOFS)]
    if top > 40:
        return "#8d8f8f"
    x0, y0, x1, y1 = geom.bounds
    c0, r0 = int((x0 - C.x0) / IMG_M), int((C.y1 - y1) / IMG_M)
    c1, r1 = int(math.ceil((x1 - C.x0) / IMG_M)), int(math.ceil((C.y1 - y0) / IMG_M))
    c0, r0, c1, r1 = max(c0, 0), max(r0, 0), min(c1, ortho.shape[1]), min(r1, ortho.shape[0])
    if c1 - c0 < 1 or r1 - r0 < 1:
        return "#8d8f8f"
    m = raster_mask(polygons(geom.buffer(-0.8)) or polygons(geom), c1 - c0, r1 - r0, IMG_M, C.x0 + c0 * IMG_M, C.y1 - r0 * IMG_M)
    px = ortho[r0:r1, c0:c1][m]
    if len(px) < 3:
        return "#8d8f8f"
    return "#%02x%02x%02x" % tuple(np.median(px, axis=0).astype(int))


# ---------------------------------------------------------------- heights

class Heights:
    def __init__(self, cfg):
        st = cfg.get("storey", {})
        self.storey = {k: tuple(st.get(k, v)) for k, v in DEFAULT_STOREY.items()}

    def storey_height(self, cls, floors):
        a, b = self.storey["res" if cls in RESIDENTIAL else "non"]
        return floors * a + b

    def resolve(self, rec, cls, parent=None):
        """(height above ground, source) for a building or part, best evidence first."""
        if rec.get("height") and rec.get("height_src") == "OpenStreetMap":
            return float(rec["height"]), "mapped"
        if rec.get("height") and rec.get("height_src") == "PLATEAU":
            return float(rec["height"]), "plateau"
        if rec.get("num_floors"):
            return self.storey_height(cls, rec["num_floors"]) + float(rec.get("roof_height") or 0), "floors"
        if rec.get("height"):
            return float(rec["height"]), "ml"
        if parent is not None:
            return parent
        if cls in SMALL:
            return 3.0, "default"
        if cls in GROUPS["house"]:
            return 7.0, "default"
        return 10.0, "default"

    def min_height(self, rec, cls):
        if rec.get("min_height"):
            return float(rec["min_height"])
        if rec.get("min_floor"):
            return rec["min_floor"] * self.storey["res" if cls in RESIDENTIAL else "non"][0]
        return 0.0


def group(cls):
    return next((g for g, members in GROUPS.items() if cls in members), "other" if cls else "none")


def impute_heights(meta, solids, first_solid, geo, ml_raw):
    """Replace building-type defaults and raw ML heights with estimates from evidence.

    Known heights are OSM-surveyed heights and floor counts. A building without one
    takes the weighted median of known heights within 60 m, where neighbours with a
    similar footprint area and the same kind of building weigh more. A building with
    only an ML height blends that estimate with its ML height after removing the ML
    bias measured on buildings that have both. Both estimators are cross-validated on
    the known buildings, and the residuals are kept for the uncertainty analysis.

    Missing heights are not missing at random: mappers tag prominent towers first, so
    a building left without any height among towers is more often a low one. ML heights
    are an independent measurement inside that unknown population, so the ratio of
    neighbour estimate to calibrated ML height, unknown vs known buildings, per band of
    neighbourhood height, measures the bias and corrects it."""
    n = len(meta)
    area = np.array([geo[i][0] for i in range(n)])
    cx = np.array([geo[i][1] / max(geo[i][0], 1e-9) for i in range(n)])
    cy = np.array([geo[i][2] / max(geo[i][0], 1e-9) for i in range(n)])
    logh = np.log(np.maximum([m[2] for m in meta], 0.5))
    src = np.array([m[4] for m in meta])
    grp = np.array([group(m[1]) for m in meta])
    ki = np.where(np.isin(src, ["mapped", "floors", "plateau", "plateau_lod1", "lidar", "bdtopo", "survey", "3dbag"]))[0]
    if len(ki) < 20:
        print("height imputation skipped: fewer than 20 buildings with known heights")
        return {"known_buildings": int(len(ki)), "applied": {}, "residuals": {"estimate": [], "ml": []}, "cv": {}}
    tree = cKDTree(np.c_[cx[ki], cy[ki]])
    by_group = {g: float(np.median(logh[ki][grp[ki] == g])) for g in set(grp[ki])}

    def has_neighbours(i):
        return any(ki[j] != i for j in tree.query_ball_point([cx[i], cy[i]], 60.0))

    def neighbours(i):
        idx = np.array([ki[j] for j in tree.query_ball_point([cx[i], cy[i]], 60.0) if ki[j] != i], dtype=int)
        if not len(idx):
            return by_group.get(grp[i], float(np.median(logh[ki])))
        w = np.exp(-np.abs(np.log(area[idx] / area[i])) / 0.7) * (1 + (grp[idx] == grp[i]))
        o = np.argsort(logh[idx])
        cw = np.cumsum(w[o])
        return float(logh[idx][o][np.searchsorted(cw, cw[-1] / 2)])

    def calibrate(train, x):
        ml, truth = np.array([ml_raw[i] for i in train]), np.exp(logh[train])
        out = np.empty(len(x))
        for a, b in zip(ML_BINS[:-1], ML_BINS[1:]):
            m = (ml >= a) & (ml < b)
            r = float(np.median(truth[m] / ml[m])) if m.sum() >= 5 else 1.5
            sel = (x >= a) & (x < b)
            out[sel] = x[sel] * r
        return out

    # cross-validation on the known buildings (leave-one-out for neighbours, 5-fold for the ML bias)
    nb = np.array([neighbours(i) for i in ki])
    res_est = nb - logh[ki]
    overlap = np.array([i for i in ki if i in ml_raw], dtype=int)
    has_ml = len(overlap) >= 25
    res_ml, res_raw, missing, cap_unknown = np.array([]), np.array([]), [], float(np.exp(np.percentile(logh[ki], 75)))
    if has_ml:
        fold = np.random.default_rng(0).integers(0, 5, len(overlap))
        cal = np.empty(len(overlap))
        for f in range(5):
            cal[fold == f] = calibrate(overlap[fold != f], np.array([ml_raw[i] for i in overlap[fold == f]]))
        nb_o = np.array([neighbours(i) for i in overlap])
        res_ml = 0.5 * np.log(cal) + 0.5 * nb_o - logh[overlap]
        res_raw = np.log([ml_raw[i] for i in overlap]) - logh[overlap]

        # informative missingness: neighbour / calibrated-ML ratio, unknown vs known population.
        # OSM footprints only (Microsoft-only footprints are a different population, often
        # unmapped sheds), and only where known neighbours exist.
        unknown_ml = np.array([i for i in range(n) if src[i] == "ml" and i in ml_raw and meta[i][5] == "O" and has_neighbours(i)], dtype=int)
        nb_u = np.array([neighbours(i) for i in unknown_ml])
        r_u = nb_u - np.log(calibrate(overlap, np.array([ml_raw[i] for i in unknown_ml]))) if len(unknown_ml) else np.array([])
        r_k = nb_o - np.log(calibrate(overlap, np.array([ml_raw[i] for i in overlap])))
        with_nb = np.array([has_neighbours(i) for i in overlap])
        nb_k, r_k = nb_o[with_nb], r_k[with_nb]
        for a, b in zip(MISSING_BANDS[:-1], MISSING_BANDS[1:]):
            la, lb = np.log(a) if a > 0 else -np.inf, np.log(b)
            mu = (nb_u >= la) & (nb_u < lb) if len(nb_u) else np.zeros(0, bool)
            mk = (nb_k >= la) & (nb_k < lb)
            raw = float(np.median(r_u[mu]) - np.median(r_k[mk])) if mu.sum() >= 3 and mk.sum() >= 3 else 0.0
            w = mu.sum() / (mu.sum() + 10)  # shrink small samples towards no correction
            missing.append({"neighbourhood_m": [a, b if b < 1e9 else None], "unknown_n": int(mu.sum()), "known_n": int(mk.sum()),
                            "raw_ratio": round(float(np.exp(raw)), 3), "correction": round(float(np.exp(max(raw, 0.0) * w)), 3)})
        unk_osm = np.array([i for i in range(n) if src[i] == "ml" and i in ml_raw and meta[i][5] == "O"], dtype=int)
        if len(unk_osm):
            cap_unknown = float(calibrate(overlap, np.array([ml_raw[i] for i in unk_osm])).max())

    def missing_adj(est):
        for band, (a, b) in zip(missing, zip(MISSING_BANDS[:-1], MISSING_BANDS[1:])):
            if a <= np.exp(est) < b:
                return band["correction"], band["raw_ratio"]
        return 1.0, 1.0

    # evidence bounds: small structures (canopies, sheds, shelters) stay within what known
    # small structures reach, and no untagged building exceeds the tallest bias-corrected ML
    # height measured among untagged OSM buildings: the unknown population is rarely towers
    small_known = np.exp(logh[ki][grp[ki] == "small"])
    cap_small = float(np.percentile(small_known, 95)) if len(small_known) >= 10 else 8.0
    capped, applied, adj_of = Counter(), Counter(), {}

    def own(i):
        return range(first_solid[i], first_solid[i + 1] if i + 1 < n else len(solids))

    for i in range(n):
        if src[i] not in ("default", "ml"):
            continue
        est = neighbours(i)
        adj_of[i] = missing_adj(est)
        est -= np.log(adj_of[i][0])
        if src[i] == "ml" and has_ml:
            est = 0.5 * np.log(calibrate(overlap, np.array([ml_raw[i]]))[0]) + 0.5 * est
        cap = cap_small if grp[i] == "small" else cap_unknown
        if est > np.log(cap):
            est = np.log(cap)
            capped["small" if grp[i] == "small" else "unknown"] += 1
        new = float(np.exp(est))
        f = new / max(meta[i][2], 0.5)
        for k in own(i):
            solids[k][3] = max(solids[k][2] + 10, round(solids[k][3] * f))
        meta[i][2] = meta[i][9] = round(new, 1)
        meta[i][4] = "estimate" if src[i] == "default" else "ml"
        applied[meta[i][4]] += 1

    res_default = np.array([np.log(3.0 if grp[i] == "small" else 7.0 if grp[i] == "house" else 10.0) for i in ki]) - logh[ki]
    stat = lambda r: {"median_factor": round(float(np.exp(np.median(np.abs(r)))), 3), "p90_factor": round(float(np.exp(np.percentile(np.abs(r), 90))), 3),
                      "median_bias": round(float(np.median(r)), 3), "n": int(len(r))} if len(r) else None
    return {"known_buildings": int(len(ki)), "applied": dict(applied), "missingness": missing,
            "caps_m": {"small_structures": round(cap_small, 1), "untagged": round(cap_unknown, 1)}, "capped": dict(capped),
            # per building: [correction applied, raw ratio measured]; the truth may lie anywhere between
            "missing_correction": {str(i): [round(a, 3), round(r, 3)] for i, (a, r) in adj_of.items() if a > 1.0},
            "cv": {"type_defaults": stat(res_default), "neighbours": stat(res_est), "raw_ml": stat(res_raw), "ml_blend": stat(res_ml)},
            "residuals": {"estimate": np.round(res_est, 3).tolist(), "ml": np.round(res_ml, 3).tolist()}}


# ---------------------------------------------------------------- measured heights (Project PLATEAU)

# PLATEAU's building use (bldg:usage) as the Overture class the typology rules know, for the
# buildings Overture leaves unclassed. Government offices (421) are modern offices here, and supply
# and treatment plants (453) are industrial.
PLATEAU_USAGE = {"401": "office", "402": "commercial", "403": "hotel", "404": "commercial", "411": "house", "412": "apartments",
                 "413": "house", "414": "apartments", "415": "house", "421": "office", "422": "school", "431": "warehouse",
                 "441": "industrial", "453": "industrial"}


class Plateau:
    """Measured building heights from Project PLATEAU (data/raw/<id>/plateau.json, written by
    pipeline/fetch_plateau.py from the city's `plateau` block).

    Each feature is a footprint with a height: a whole building (CityGML, 3D Tiles), or one roof
    face of a building (the LOD2 vector tiles, where a podium and its tower are separate faces).
    A footprint is cut along the features over it, tallest first, so each piece takes the height
    of the feature above it. Pieces smaller than a few per cent of the footprint are rooftop
    plant and are absorbed by the main piece. A whole building counts only where most of it lies
    in the footprint, or most of the footprint in it, so a neighbour's overlapping edge does not
    become a tier of its own. A footprint that the features cover less than half
    of keeps its other height source. PLATEAU buildings that no Overture footprint covers (newer
    or missing in OSM) are added as buildings of their own."""
    MERGE_M, MIN_PIECE_M2, MIN_PIECE_SHARE = 1.5, 8.0, 0.04
    SPIRE_M2 = 25.0  # a roof face this large standing 8 m or more over the main roof is a tower, not plant
    key, label, footprint = "plateau", "PLATEAU", "P"
    keep_newer_osm = True  # PLATEAU was surveyed in 2017-2021: an OSM height far above it is usually a newer tower
    cut_parts = False      # a building's parts are re-cut only where its roof faces differ in height
    CFG, FILE, TIERS = "plateau", "plateau.json", False  # the city.json block, the data file, features are roof tiers

    def __init__(self, C):
        self.tree, self.polys, self.feats, self.roofs = None, [], [], False
        self.cfg = C.cfg.get(self.CFG) or {}
        self.faces = self.TIERS or "tiles" in self.cfg  # the vector tiles hold roof faces; the archives whole buildings
        path = os.path.join(C.raw, self.FILE)
        if not self.cfg or not os.path.exists(path):
            return
        # footprints inside these discs belong to a parametric landmark (a lattice tower), not to a building
        holes = [(C.fwd.transform(*e["at"]), e["radius_m"]) for e in self.cfg.get("exclude", [])]
        for f in json.load(open(path)):
            g = C.to_local(Polygon(f["rings"][0], f["rings"][1:]))
            if any(math.hypot(g.centroid.x - c[0], g.centroid.y - c[1]) < r for c, r in holes):
                continue
            if not g.is_valid:
                g = g.buffer(0)
            if not g.is_empty and f["h"] > 0.5:
                self.polys.append(g)
                self.feats.append(f)
        self.h = [f["h"] for f in self.feats]
        self.roofs = any("roof" in f for f in self.feats)
        self.tree = shapely.STRtree(self.polys)
        print(f"{self.key}: {len(self.polys)} footprints indexed")

    def source(self, i):
        """'plateau' for a surveyed height, 'plateau_lod1' for a block height without a survey record."""
        return "plateau" if self.feats[i].get("measured", True) else "plateau_lod1"

    def named(self, name):
        """The PLATEAU feature with this exact name, or None (for city.py hooks)."""
        return next((f for f in self.feats if f.get("name") == name), None)

    def roof_at(self, q, *_):
        """The roof PLATEAU's LOD2 model measured over most of footprint q, {roof, pitch, roof_h},
        or None (fetch_plateau.py measures them with plateau.roofs)."""
        if not self.roofs:
            return None
        best, best_a = None, 0.5 * q.area
        for i in self.tree.query(q):
            if "roof" in self.feats[i]:
                a = q.intersection(self.polys[i]).area
                if a > best_a:
                    best, best_a = i, a
        return None if best is None else {k: self.feats[best].get(k) for k in ("roof", "pitch", "roof_h", "direction")}

    def match(self, g):
        """The PLATEAU feature of the building that is the same as footprint g (at least half of
        one lies in the other), or None: its storeys, use and name."""
        if self.tree is None:
            return None
        best, best_a = None, 0.0
        for j in self.tree.query(g):
            a = g.intersection(self.polys[j]).area
            if a > best_a and (a >= 0.5 * self.polys[j].area or a >= 0.5 * g.area):
                best, best_a = j, a
        return None if best is None else self.feats[best]

    def pieces(self, q):
        """[(polygon, height, source)] covering q, or None if PLATEAU does not cover at least half of it."""
        if self.tree is None or q.area < 1:
            return None
        cand = []
        for i in self.tree.query(q):
            x = q.intersection(self.polys[i])
            # a whole building (not a roof face) counts only if most of it lies in q or most of q in it:
            # the sliver where a neighbour's outline overlaps q's is misregistration, not a taller tier
            if x.area >= self.MIN_PIECE_M2 and (self.faces or x.area >= 0.5 * min(self.polys[i].area, q.area)):
                cand.append((self.h[i], x, i))
        if not cand or shapely.union_all([x for _, x, _ in cand]).area < 0.5 * q.area:
            return None
        cand.sort(key=lambda t: -t[0])
        taken, out = Polygon(), []
        for h, x, i in cand:  # tallest first, so a tower is not buried under its podium's face
            x = x.difference(taken)
            if x.area >= self.MIN_PIECE_M2:
                out.append([h, x, i])
                taken = taken.union(x)
        if not out:
            return None
        main = max(out, key=lambda t: t[1].area)
        # rooftop plant is small and only a few metres above the roof; a small face that stands
        # well above the main roof is a spire or a dome (the Diet's tower, Tokyo Station's domes)
        out = [t for t in out if t is main or t[1].area >= self.MIN_PIECE_SHARE * q.area or (self.faces and t[0] >= main[0] + 8.0 and t[1].area >= self.SPIRE_M2)]
        rest = q.difference(shapely.union_all([t[1] for t in out]))
        out.sort(key=lambda t: -t[0])
        merged = []
        for h, x, i in out:  # faces within MERGE_M of each other become one solid
            for m in merged:
                if abs(m[0] - h) < self.MERGE_M:
                    m[1] = m[1].union(x)
                    break
            else:
                merged.append([h, x, self.source(i)])
        if rest.area > 0:  # uncovered remainder (walls, overhang): the height of the main piece
            m = min(merged, key=lambda t: abs(t[0] - main[0]))
            m[1] = m[1].union(rest)
        return [(g, round(h, 1), src) for h, x, src in merged for g in polygons(x) if g.area >= 1]

    def additions(self, covered):
        """[(polygon, feature)]: PLATEAU footprints that the Overture buildings (union `covered`)
        leave mostly uncovered, from `plateau.add_min_m2` (default 40 m²) up."""
        if self.tree is None:
            return []
        min_area = self.cfg.get("add_min_m2", 40.0)
        # the union is one huge multipolygon in a big city: test each footprint against its neighbours only
        parts = polygons(covered)
        ptree = shapely.STRtree(parts)
        out, kept_ix = [], set()
        for i in sorted(range(len(self.polys)), key=lambda i: -self.polys[i].area):
            p = self.polys[i]
            if p.area < min_area or self.h[i] < 2.0 or p.geom_type != "Polygon":
                continue
            near = ptree.query(p, predicate="intersects")
            if len(near) and shapely.union_all([parts[k] for k in near]).intersection(p).area > 0.25 * p.area:
                continue
            if any(p.intersection(self.polys[j]).area > 0.4 * p.area for j in self.tree.query(p) if j in kept_ix):
                continue
            out.append((p, self.feats[i]))
            kept_ix.add(i)
        return out


class BAG3D(Plateau):
    """Measured buildings from the 3DBAG (data/raw/<id>/3dbag.json, written by
    pipeline/fetch_3dbag.py from the city's `bag3d` block): one feature per LOD1.3 roof level
    of each building in the Netherlands' cadastral register, its top measured by the national
    airborne LiDAR (AHN3 to AHN5), with the roof its LOD2.2 model has over it. The tiers cut a
    footprint as PLATEAU's roof faces do."""
    key, label, footprint = "3dbag", "3DBAG", "D"
    keep_newer_osm = False  # the BAG and AHN (2014-2023) are newer and better than OSM's height tags here
    CFG, FILE, TIERS = "bag3d", "3dbag.json", True
    # the 3DBAG draws a tower or a spire as a stack of small tiers (a few m2 each): keep those that
    # stand 8 m or more over the main roof, where chimneys and dormers never reach
    MIN_PIECE_M2, SPIRE_M2 = 4.0, 6.0

    def source(self, i):
        return "3dbag"


# ---------------------------------------------------------------- city hooks

class Ctx:
    """What cities/<id>/city.py hooks may use and fill in."""

    def __init__(self, C, dem_land):
        self.city, self.dem_land = C, dem_land
        self.landmarks, self.labels = {}, {}
        self.signs = []   # facade candidates a city hook may collect (cities/osaka/city.py)
        self.polygons = polygons
        # parts a parametric landmark draws instead: kept in the surface model for the sun
        # analyses, skipped by the renderers (scene.json "hidden_solids")
        self.hidden = set()

    def hide(self, part):
        self.hidden.add(id(part[0]))

    def ground(self, x, y):
        return float(sample(self.city, self.dem_land, x, y)[0])


# ---------------------------------------------------------------- roofs, facades, rooftops

PARAPET_STYLES = {"office", "glass", "apartment", "heritage", "retail", "civic", "mixed", "industrial"}


def road_index(C, con, path):
    """road sample points every 3 m with their directions, for shopfront frontages and ridge lines"""
    if not os.path.exists(path):
        return None
    pts, dirs, main = [], [], []
    for r in rows(con, path, "class, subtype, wkb"):
        if r["subtype"] != "road" or r["class"] in ("footway", "path", "steps", "cycleway", "bridleway", "track", "unknown", None):
            continue
        g = C.to_local(swkb.loads(bytes(r["wkb"])))
        for line in (g.geoms if hasattr(g, "geoms") else [g]):
            if line.length < 1:
                continue
            for d in np.arange(0, line.length, 3.0):
                a, b2 = line.interpolate(d), line.interpolate(min(d + 1.0, line.length))
                v = np.array([b2.x - a.x, b2.y - a.y])
                n = np.hypot(*v)
                if n > 1e-6:
                    pts.append((a.x, a.y))
                    dirs.append(v / n)
                    main.append(r["class"] in ("primary", "secondary", "tertiary", "pedestrian", "living_street", "trunk"))
    if not pts:
        return None
    pts = np.array(pts)
    return cKDTree(pts), np.array(dirs), pts, np.array(main)


ROOF_SRC = ["rule", "prior", "mapped", "measured"]


def pack_roof(pos, idx):
    """a roof mesh as [x0_dm, y0_dm, positions, indices]: positions int16 little-endian
    (x - x0, y - y0, z), indices uint8 when there are fewer than 256 vertices, else uint16,
    both base64 (the terrain grid's encoding)"""
    q = np.asarray(pos, np.int64).reshape(-1, 3)
    x0, y0 = int(q[0, 0]), int(q[0, 1])
    q[:, 0] -= x0
    q[:, 1] -= y0
    ib = np.asarray(idx, "<u2" if len(q) > 255 else "u1")
    return [x0, y0, base64.b64encode(q.astype("<i2").tobytes()).decode(), base64.b64encode(ib.tobytes()).decode()]


NO_TAGS = {"roof_shape": None, "roof_height": None, "roof_direction": None, "roof_orientation": None, "roof_material": None,
           "num_floors": None, "parametric": False, "part": False, "measured": None}


def pad_records(meta, solids, sinfo, bextra):
    """roof tags and facade data for buildings and solids added after the main loop
    (a city hook, a surveyed source): none mapped, a seed from the index"""
    sinfo += [dict(NO_TAGS, parametric=solids[k][0] < len(meta) and meta[solids[k][0]][4] == "parametric")
              for k in range(len(sinfo), len(solids))]
    bextra += [{"seed": (bi * 2654435761) & 0xFFFFFF, "facade_color": None, "facade_material": None} for bi in range(len(bextra), len(meta))]


def dress_buildings(C, meta, solids, sinfo, bextra, roads, hidden=()):
    """Roof meshes, facade styles, storeys, wall colours, shopfront frontages and
    rooftop plant for the finished buildings. Returns (roof rows, frontage rows,
    prop rows, a summary for height_model.json)."""
    pad_records(meta, solids, sinfo, bextra)
    R = typology.region(C.cfg)
    overrides = C.cfg.get("building_styles", {})
    by_b = defaultdict(list)
    for k, s in enumerate(solids):
        by_b[s[0]].append(k)
    roof_rows, front_rows, prop_rows = [], [], []
    roofed = set()
    stat = Counter()
    # Paris roofs carry dormers on the street and chimney stacks on the party walls: both need
    # every footprint, to tell a street front from a wall shared with the next building
    nb = None
    if R.get("haussmann"):
        fps = [Polygon(np.array(s[4]).reshape(-1, 2) / 10) for s in solids]
        nb = (shapely.STRtree(fps), fps)
    for bi, m in enumerate(meta):
        ks = by_b.get(bi, [])
        if not ks:
            continue
        cls, floors, seed = m[1], int(m[3] or 0), bextra[bi]["seed"]
        polys = {k: Polygon(np.array(solids[k][4]).reshape(-1, 2) / 10,
                            [np.array(h).reshape(-1, 2) / 10 for h in solids[k][5:]]) for k in ks}
        area_b = sum(p.area for p in polys.values())
        top_b = max((solids[k][3] - solids[k][2]) / 10 + solids[k][2] / 10 for k in ks)
        parametric = any(sinfo[k]["parametric"] for k in ks)
        _, long_b, short_b = roofs.long_axis(np.array(solids[ks[0]][4]).reshape(-1, 2) / 10)
        narrow = short_b <= 7.0 and long_b >= 2.5 * short_b
        year = bextra[bi].get("year")
        style = "plain" if parametric else typology.facade_style(R, cls, top_b, floors, area_b, bextra[bi]["facade_material"], m[0], seed,
                                                            overrides, narrow, year=year, width=short_b)
        main_shape, main_src, main_mat = "flat", "rule", None
        eave_main = top_b
        for k in ks:
            s, info, poly = solids[k], sinfo[k], polys[k]
            if parametric or k in hidden:  # a landmark draws it; the analyses keep it as it is
                continue
            h0, top = s[2] / 10, s[3] / 10
            mapped, meas = info["roof_shape"], info.get("measured")
            if mapped:
                shape, src = mapped.replace("half_hipped", "half-hipped"), "mapped"
            elif meas:  # measured from a LOD2 model
                shape, src = meas["roof"], "measured"
            elif len(ks) > 1 and not (top_b < 12 and area_b < 600):
                shape, src = "flat", "rule"  # parts of a larger building keep flat roofs unless mapped
            else:
                shape, src = typology.infer_roof(R, cls, floors, top_b, area_b, seed + k)
            if shape in ("flat", "sawtooth") or shape not in roofs.CODES and shape not in ("spherical",):
                if shape not in ("flat",):
                    stat["unsupported:" + shape] += 1
                shape = "flat"
            mat = typology.roof_material(R, shape, info["roof_material"], m[8], top, seed, typology.roof_group(cls, floors, top_b, area_b))
            if shape != "flat":
                rings = [np.array(s[4]).reshape(-1, 2) / 10] + [np.array(h).reshape(-1, 2) / 10 for h in s[5:]]
                room = top - h0
                cap = min(R["roof_cap_m"] if shape not in ("dome", "onion", "spherical") else 60.0,
                          room - (2.0 if cls in typology.SMALL else 2.4))
                axis, across = None, info["roof_orientation"] == "across"
                if shape == "gabled_across":  # measured: the ridge runs across the long axis
                    shape, across = "gabled", True
                gable = shape in ("gabled", "half-hipped", "gambrel", "round", "saltbox")
                if gable and not info["roof_orientation"] and (src != "measured" or not meas.get("oriented", True)):
                    _, long_side, short_side = roofs.long_axis(rings[0])
                    if cls in R.get("ridge_follows_street", ()) and roads is not None:
                        dist, j = roads[0].query(np.array(poly.centroid.coords[0]))
                        if dist < 30:
                            axis = roads[1][j]
                    # a narrow, deep house (a terrace, a machiya) carries its ridge across, along the street
                    if axis is None and short_side < 7.5 and long_side > 1.8 * short_side:
                        across = True
                rm, built, rh = None, "flat", 0.0
                if cap >= 0.8:
                    pitch = R.get("pitch_by_group", {}).get(typology.roof_group(cls, floors, top_b, area_b), R["pitch"].get(mat, 25))
                    mh = float(info["roof_height"]) if info["roof_height"] else None
                    if R.get("roof_simplify_m"):  # a region's footprints with jogs too small to roof
                        q_ = Polygon(rings[0], rings[1:]).simplify(R["roof_simplify_m"])
                        if q_.geom_type == "Polygon" and len(q_.exterior.coords) > 3:
                            rings = [np.asarray(q_.exterior.coords)[:-1]] + [np.asarray(h.coords)[:-1] for h in q_.interiors if len(h.coords) > 3]
                    if src == "measured":
                        pitch, mh = min(max(meas.get("pitch") or pitch, 5.0), 60.0), meas.get("roof_h") or mh
                    for attempt in (0, 1):
                        rr = rings if attempt == 0 else [np.asarray(Polygon(rings[0]).simplify(0.6).exterior.coords)[:-1]]
                        if attempt and len(rr[0]) < 3:
                            break
                        rm, built, rh = roofs.roof_mesh(rr, shape, pitch=pitch, cap=cap, height=min(mh, cap) if mh else None,
                                                        direction=info["roof_direction"] if info["roof_direction"] is not None or src != "measured" else meas.get("direction"),
                                                        across=across, axis=axis,
                                                        overhang=typology.OVERHANG.get(style, 0.0) * R.get("overhang_scale", 1.0) if not info["part"] else 0.0)
                        if rm is not None and roofs.check(rm, rr, rh, built):
                            break
                        rm = None
                if rm is None or rh < 0.5:
                    stat["fallback_flat"] += rm is None and cap >= 0.8
                    stat["too_low"] += cap < 0.8 or (rm is not None and rh < 0.5)
                    shape = "flat"
                else:
                    eave = top - rh
                    v = np.asarray(rm.v)
                    q = np.c_[np.round(v[:, :2] * 10), np.round((eave + v[:, 2]) * 10)].astype(int)
                    uniq, remap = {}, []
                    for p_ in q.tolist():  # shared corners once
                        remap.append(uniq.setdefault(tuple(p_), len(uniq)))
                    pos = [c for p_ in uniq for c in p_]
                    idx = [remap[i] for t in rm.roof + rm.wall for i in t]
                    roof_rows.append([k, s[3], round(eave * 10), roofs.CODES[built]] + pack_roof(pos, idx) + [len(rm.roof)])
                    roofed.add(k)
                    # dormers light the attic floor of a mansard, and of any roof tall enough to hold one
                    if nb is not None and not info["part"] and (built in ("mansard", "gambrel") or built in ("gabled", "hipped") and rh >= 2.6):
                        prop_rows += mansard_props(k, s, eave, top, nb, roads, seed)
                    # Amsterdam: a canal house's street front ends in the gable of its century
                    if style == "grachtenpand" and roads is not None and not info["part"] and built in ("gabled", "gabled_across", "half-hipped", "gambrel"):
                        ax, _, _ = roofs.long_axis(rr[0])
                        rdir = np.asarray(axis, float) if axis is not None else np.array([-ax[1], ax[0]]) if across or built == "gabled_across" else ax
                        prop_rows += gable_props(k, s, eave, rh, rdir, roads, year, seed, cls == "warehouse" or "pakhuis" in (m[0] or "").lower())
                    shape = built
                    if top >= top_b - 0.01:
                        eave_main = eave
            stat[f"{src}:{shape}"] += 1
            if top >= top_b - 0.01 or main_mat is None:
                main_shape, main_src, main_mat = shape, src, mat
        # facade: storeys over the wall height, shopfronts on street frontages
        storefront_ok = style in typology.STOREFRONT_STYLES and (cls in R["storefront_classes"] or (not cls and top_b >= 12))
        # flats and unclassed buildings have shops only on main streets
        main_only = cls in typology.FLATS or not cls
        fronts = {}
        if storefront_ok and roads is not None:
            for k in ks:
                if solids[k][2] == 0:
                    e = typology.frontages(np.array(solids[k][4]).reshape(-1, 2) / 10, roads, main_only=main_only)
                    if e:
                        fronts[k] = e
        awning = bool(fronts) and typology.unit(seed, 21) < R["awning"]
        if style == "machiya" and roads is not None:  # the street pent roof (hisashi) over a machiya front
            for k in ks:
                e = typology.frontages(np.array(solids[k][4]).reshape(-1, 2) / 10, roads)
                if e:
                    fronts[k] = e
            awning = bool(fronts)
        for k, es in fronts.items():
            flag = (2 if awning else 0) + (0 if style == "machiya" else 1)
            front_rows.append([k] + [v for e in es for v in (e, flag)])
        wall_h = max(eave_main - min(solids[k][2] for k in ks) / 10, 2.4)
        storey, ground = typology.storeys(style, wall_h, floors, bool(fronts))
        pal = R.get("palettes", {}).get(style) or typology.PALETTES[style]
        fc, fmat = bextra[bi]["facade_color"], bextra[bi]["facade_material"]
        if fc and str(fc).startswith("#") and len(fc) == 7:
            wall = fc
        elif fmat in FACADE:
            wall = typology.jitter(FACADE[fmat], seed)
        else:
            wall = typology.jitter(pal[seed % len(pal)], seed)
        m[7] = wall
        if main_shape != "flat" and main_mat:  # the roof's colour leans towards its material's
            m[8] = typology.roof_colour(R, main_mat, m[8], seed, typology.colour_says(R, m[8]))
        m += [typology.STYLE_CODE[style], storey, ground, typology.ROOF_MATERIALS.index(main_mat or "membrane"), seed & 0xFFFF,
              roofs.CODES.get(main_shape, 0), ROOF_SRC.index(main_src)]
        # rooftop plant on flat roofs
        if style in PARAPET_STYLES and not parametric:
            for k in ks:
                if k in roofed:
                    continue
                prop_rows += rooftop(k, solids[k], polys[k], style, seed, top_b, floors, R)
    return roof_rows, front_rows, prop_rows, dict(stat)


def mansard_props(k, s, eave, top, nb, roads, seed):
    """A Paris mansard's dormers and chimney stacks, as rooftop rows with an absolute base (dm).
    Dormers (kind 3): one row per edge that faces a street, a dormer every 2.9 m bay, its face
    0.25 m behind the facade so it stands proud of the steep lower slope; the row is the first dormer plus a count, a step (dm) and a
    bitmask of the bays left without one. Stacks (kind 4): a masonry stack on each long wall
    shared with the next building, rising 2.2 m over the roof, where the flues are gathered."""
    tree, fps = nb
    ring = np.array(s[4]).reshape(-1, 2) / 10
    base = s[1] / 10
    n = len(ring)
    front = set(typology.frontages(ring, roads)) if roads is not None else set()
    out = []
    for e in range(n):
        a, b = ring[e], ring[(e + 1) % n]
        d = b - a
        L = math.hypot(*d)
        if L < 3.0:
            continue
        u = d / L
        nrm = np.array([u[1], -u[0]])  # outward for an anticlockwise ring
        ang = round(math.degrees(math.atan2(u[1], u[0])) * 100)
        if e in front:
            bays = min(int((L - 1.2) / 2.9), 30)
            if bays < 1:
                continue
            gaps = sum(1 << j for j in range(bays) if typology.unit(seed + e, 40 + j) < 0.12)  # bays without a dormer
            step = (L - 1.2) / bays
            c = a + u * (0.6 + step / 2) - nrm * 0.75
            out.append([k, 3, round(c[0] * 10), round(c[1] * 10), 12, 10, 21, ang, round((base + eave + 0.3) * 10), bays, round(step * 10), gaps])
            continue
        mid = (a + b) / 2
        probe = shapely.geometry.Point(*(mid + nrm * 0.8))
        shared = [j for j in tree.query(probe, predicate="intersects") if fps[j].area > 30]
        if not shared or L < 5.0:
            continue
        c = mid - nrm * 0.4
        w = min(4.2, 0.35 * L)
        out.append([k, 4, round(c[0] * 10), round(c[1] * 10), round(w * 10), 7, round((top - eave + 2.2) * 10), ang,
                    round((base + eave + 0.4) * 10)])
    return out


def gable_props(k, s, eave, rh, rdir, roads, year, seed, warehouse):
    """A canal house's gables, as rooftop rows with an absolute base (dm): on each street front
    where the roof ends in a gable (the ridge runs back from the street), a slab in the plane of
    the front from the eaves to 0.9 m over the ridge, cut to the outline of the gable its year
    calls for (typology.gable_type; a cornice front is the eaves wall raised 0.5-2.3 m).
    Rows (kind 5): [k, 5, x, y, width, thickness, height (dm), angle (centidegrees), base (dm), type]."""
    ring = np.array(s[4]).reshape(-1, 2) / 10
    n = len(ring)
    out = []
    for e in typology.frontages(ring, roads):
        a, b = ring[e], ring[(e + 1) % n]
        L = math.hypot(*(b - a))
        u = (b - a) / L
        if not 3.0 <= L <= 14.0 or abs(u @ rdir) > 0.35:  # too wide or narrow, or an eaves front
            continue
        t = typology.gable_type(year, seed + 7 * e, warehouse)
        if t is None:
            continue
        H = rh + 0.9 if t != "cornice" else min(rh, 1.8) + 0.5
        c = (a + b) / 2 + np.array([u[1], -u[0]]) * 0.03  # just proud of the front
        out.append([k, 5, round(c[0] * 10), round(c[1] * 10), round(L * 10), 4, round(H * 10),
                    round(math.degrees(math.atan2(u[1], u[0])) * 100), round((s[1] / 10 + eave) * 10), typology.GABLES.index(t)])
    return out


FAMILY = {"gabled_across": "gabled", "saltbox": "gabled", "half-hipped": "hipped", "pyramidal": "hipped"}


def score_roofs(pairs):
    """[(truth, prediction)] -> flat-or-pitched and shape-family agreement"""
    if not pairs:
        return {"n": 0}
    fam = lambda x: FAMILY.get(x, x)
    pitched = lambda x: x != "flat"
    conf = Counter((pitched(t), pitched(p)) for t, p in pairs)
    n, tp, tn = len(pairs), conf[(True, True)], conf[(False, False)]
    return {"n": n, "flat_vs_pitched_accuracy": round((tp + tn) / n, 3),
            "exact_shape_accuracy": round(sum(t == p for t, p in pairs) / n, 3),
            "family_accuracy": round(sum(fam(t) == fam(p) for t, p in pairs) / n, 3),
            "pitched_recall": round(tp / max(1, tp + conf[(True, False)]), 3), "flat_recall": round(tn / max(1, tn + conf[(False, True)]), 3),
            "confusion_pitched": {"true_pitched_pred_pitched": tp, "true_pitched_pred_flat": conf[(True, False)],
                                  "true_flat_pred_flat": tn, "true_flat_pred_pitched": conf[(False, True)]},
            "truth": dict(Counter(map(fam, (t for t, _ in pairs))).most_common())}


def validate_roof_rules(C, meta, solids, sinfo, bextra):
    """Predict every mapped roof shape, and every roof a LOD2 model measured, with the rules
    alone and score them; and where a roof is both mapped and measured, how the two agree."""
    R = typology.region(C.cfg)
    first = {}
    for k, s in enumerate(solids):
        first.setdefault(s[0], k)
    mapped, measured, both = [], [], []
    for bi, m in enumerate(meta):
        k = first.get(bi)
        if k is None or sinfo[k]["part"] or sinfo[k]["parametric"]:
            continue
        truth, meas = sinfo[k]["roof_shape"], sinfo[k].get("measured")
        truth = truth and truth.replace("half_hipped", "half-hipped")
        if not truth and not meas:
            continue
        area = Polygon(np.array(solids[k][4]).reshape(-1, 2) / 10).area
        pred, _ = typology.infer_roof(R, m[1], int(m[3] or 0), m[2], area, bextra[bi]["seed"] + k)
        if truth:
            mapped.append((truth, pred))
        if meas:
            measured.append((meas["roof"], pred))
        if truth and meas:
            both.append((truth, meas["roof"]))
    out = score_roofs(mapped)
    if measured:
        out["vs_measured"] = score_roofs(measured)
    if both:
        out["measured_vs_mapped"] = score_roofs(both)
    return out


def rooftop(k, s, poly, style, seed, top_b, floors, R):
    """deterministic plant on a flat roof: a plant room on towers, boxes elsewhere,
    water tanks where the region has them. Rows: [solid, kind, x, y, w, d, h (dm), angle (centidegrees)]"""
    top = s[3] / 10
    if top < 6 or poly.area < 60:
        return []
    inner = poly.buffer(-2.0)
    if inner.is_empty or inner.area < 8:
        return []
    inner = max(polygons(inner), key=lambda p: p.area)
    ax, _, _ = roofs.long_axis(np.asarray(poly.exterior.coords)[:-1])
    ang = math.degrees(math.atan2(ax[1], ax[0]))
    perp = np.array([-ax[1], ax[0]])
    out, placed = [], []
    rng = np.random.default_rng(seed * 7919 + k)

    def fits(cx, cy, w, d):
        q = shapely.affinity.rotate(box(cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2), ang, origin=(cx, cy))
        if not inner.contains(q) or any(q.intersects(p) for p in placed):
            return False
        placed.append(q.buffer(0.8))
        return True

    x0, y0, x1, y1 = inner.bounds
    if top >= 30:  # plant room / lift overrun
        c = polylabel(inner, 0.5)
        L = np.asarray(inner.exterior.coords) @ ax
        Wd = np.asarray(inner.exterior.coords) @ perp
        w, d = min(np.ptp(L) * 0.45, 22.0), min(np.ptp(Wd) * 0.45, 16.0)
        h = 2.6 + 1.6 * rng.random()
        for f in (1.0, 0.75, 0.55):
            if w * f > 3 and d * f > 3 and fits(c.x, c.y, w * f, d * f):
                out.append([k, 1, round(c.x * 10), round(c.y * 10), round(w * f * 10), round(d * f * 10), round(h * 10), round(ang * 100)])
                break
    n = int(min(10, poly.area / (350 if style not in ("apartment",) else 700)))
    if R.get("water_tanks") and 4 <= (floors or top / 3.2) <= 15 and typology.unit(seed, 31) < R["water_tanks"]:
        for _ in range(20):
            cx, cy = x0 + (x1 - x0) * rng.random(), y0 + (y1 - y0) * rng.random()
            w = 2.0 + rng.random() * 1.5
            if fits(cx, cy, w, w * 0.8):
                out.append([k, 2, round(cx * 10), round(cy * 10), round(w * 10), round(w * 8), round((2.2 + rng.random()) * 10), round(ang * 100)])
                break
    tries = 0
    while n > 0 and tries < 60:
        tries += 1
        cx, cy = x0 + (x1 - x0) * rng.random(), y0 + (y1 - y0) * rng.random()
        w, d = 1.4 + rng.random() * 2.6, 1.1 + rng.random() * 1.8
        if fits(cx, cy, w, d):
            out.append([k, 0, round(cx * 10), round(cy * 10), round(w * 10), round(d * 10), round((0.9 + rng.random() * 1.2) * 10), round(ang * 100)])
            n -= 1
    return out


# ---------------------------------------------------------------- main

def build(C):
    C.ensure_dirs()
    cfg = C.cfg
    H = Heights(cfg)
    con = duckdb.connect()
    con.execute("LOAD spatial")
    extent = box(C.x0, C.y0, C.x1, C.y1)
    raw = lambda name: os.path.join(C.raw, f"overture_{name}.parquet")

    # terrain and water (water sits below a water plane at 0 m)
    dem = load_dem(C)
    sea = water_polygons(C, con, raw, extent)
    water = raster_mask(sea, dem.shape[1], dem.shape[0], DEM_CELL, C.x0, C.y1)
    dem_land = dem.copy()
    floating = set(cfg.get("water", {}).get("floating", []))
    # the bottom under the water, modelled from the distance to each kind of shore (shore.py)
    sm = shore_map(C, con, raw, rows, raster_mask, polygons, sea, extent, cfg)
    wr, wc = np.nonzero(water)
    dem[water] = -depth_at(sm, C.x0 + (wc + 0.5) * DEM_CELL, C.y1 - (wr + 0.5) * DEM_CELL, C.x0, C.y1)
    # the first point out from a quay stays just under the surface, so on the 5 m grid the waterline
    # falls at the quay's edge and not up to a cell inland (a river walk beside a canal would go under)
    edge = water & ndimage.binary_dilation(~water)
    dem[edge] = np.maximum(dem[edge], -QUAY_SHELF_M)
    sm["image"].save(os.path.join(C.out, "shore.png"), optimize=True)
    ctx = Ctx(C, dem_land)

    tiles, ortho = ground_tiles(C) if cfg["imagery"]["type"] == "xyz" else synth_ground(C, con, raw, extent)

    # piers and wharves as thin decks just above high water
    piers = []
    for r in rows(con, raw("infrastructure")):
        if r["class"] != "pier":
            continue
        for p in polygons(C.to_local(swkb.loads(bytes(r["wkb"])))):
            if p.area > 20 and extent.contains(p.centroid):
                piers.append(ring(p.simplify(0.3).exterior.coords))

    # street and park trees mapped in OSM (points and tree rows), as x, y, ground, height in dm;
    # height is not mapped for most, so it is a 7-14 m spread seeded by the feature id
    trees = []
    for r in rows(con, raw("land")):
        if r["subtype"] != "tree":
            continue
        g = C.to_local(swkb.loads(bytes(r["wkb"])))
        pts = [g] if g.geom_type == "Point" else [g.interpolate(d) for d in np.arange(0, g.length, 9)] if g.geom_type == "LineString" else []
        for k, q in enumerate(pts):
            if not extent.contains(q):
                continue
            seed = (int(r["id"].replace("-", "")[:8], 16) + k * 7919) % 1000
            gz = ctx.ground(q.x, q.y)
            if gz < 0.5:
                continue
            trees += [round(q.x * 10), round(q.y * 10), round(gz * 10), round(70 + seed % 70)]
    print(f"trees: {len(trees) // 4}")

    # buildings: parts replace their outline (Overture/OSM convention)
    labels_cfg = cfg.get("labels", {})
    adjust = C.hook("adjust_building")
    # a measured source: PLATEAU (Japan), or BD TOPO with LiDAR HD (France); same interface
    plateau = IGNHeights(C) if cfg.get("ign") else BAG3D(C) if cfg.get("bag3d") else Plateau(C)
    ctx.plateau = plateau
    blds = rows(con, raw("building"))
    parts = defaultdict(list)
    for p in rows(con, raw("building_part")):
        parts[p["building_id"]].append(p)
    meta, solids, first_solid, geo, ml_raw, floor_res, sinfo, bextra, hidden_solids = [], [], {}, {}, {}, [], [], [], []
    plateau_vs_osm, n_newer = [], 0
    if plateau.tree is not None:  # surveyed buildings that Overture lacks
        covered = shapely.union_all([C.to_local(swkb.loads(bytes(b["wkb"]))).buffer(0) for b in blds])
        extra = [(q, f) for q, f in plateau.additions(covered) if extent.contains(q.centroid)]
        for k, (q, f) in enumerate(extra):
            ll = shapely.transform(q, lambda c: np.column_stack(C.inv.transform(c[:, 0], c[:, 1])))
            blds.append({"id": f"{k:08x}-{plateau.key}", "name": f.get("name"), "class": f.get("class") or PLATEAU_USAGE.get(f.get("usage")),
                         "subtype": None, "height": f["h"], "min_height": None, "num_floors": f.get("storeys"), "min_floor": None, "roof_height": None,
                         "is_underground": False, "has_parts": False, "src": plateau.label, "record_id": None, "height_src": plateau.label,
                         "wkb": shapely.to_wkb(ll)})
        print(f"{plateau.key}: {len(extra)} buildings added that Overture does not have")
    # surveyed heights (survey.py): blocks cut the footprints; blocks missing from the open data are added
    lidar = None  # a LiDAR surface model measures the buildings the survey misses (survey.py)
    if cfg.get("surface_check") and os.path.exists(os.path.join(C.raw, "dsm.json")):
        lidar = load_dem(C, LIDAR_CELL, "dsm")
    survey = Survey(C, lambda x, y: sample(C, dem_land, x, y), lidar, LIDAR_CELL)
    if survey.tree is not None:
        covered = shapely.union_all([C.to_local(swkb.loads(bytes(b["wkb"]))).buffer(0) for b in blds if not b["is_underground"]])
        extra = survey.additions(covered, extent)
        for k, (q, r) in enumerate(extra):
            ll = shapely.transform(q, lambda c: np.column_stack(C.inv.transform(c[:, 0], c[:, 1])))
            blds.append({"id": f"{k:08x}-survey", "name": r.get("name") or r.get("name_local"), "class": None, "subtype": None, "height": None,
                         "min_height": None, "num_floors": r.get("floors"), "min_floor": None, "roof_height": None, "is_underground": False,
                         "has_parts": False, "src": "survey", "record_id": None, "height_src": None, "wkb": shapely.to_wkb(ll)})
        print(f"survey: {len(extra)} blocks added that Overture does not have")
    survey.claim([(b["id"], C.to_local(swkb.loads(bytes(b["wkb"])))) for b in blds if not b["is_underground"]])
    for b in blds:
        if b["is_underground"]:
            continue
        # ids of solids a hook hid: only this building's, since Python reuses the ids of freed objects
        ctx.hidden.clear()
        g = C.to_local(swkb.loads(bytes(b["wkb"])))
        if not extent.contains(g.centroid):
            continue
        cls = b["class"] or b["subtype"] or ""
        pl = plateau.match(g)
        if pl is not None:  # the survey's record of the building: its use and storeys where Overture has none
            cls = cls or pl.get("class") or PLATEAU_USAGE.get(pl.get("usage"), "")
            if not b["num_floors"] and pl.get("storeys"):
                b["num_floors"] = pl["storeys"]
        top_b = H.resolve(b, cls)
        # PLATEAU's measured height outranks OSM heights and floor counts (a block height without a
        # survey record, plateau_lod1, is a coarser measurement). A building that OSM has much taller
        # than the survey is newer than the survey (a tower built on a site that was empty or low),
        # so OSM keeps it.
        pcs = plateau.pieces(g)
        if pcs:
            top_p = max(h for _, h, _ in pcs)
            if top_b[1] in ("mapped", "floors") and top_b[0] > 1.3 * top_p + 6 and plateau.keep_newer_osm:
                n_newer += 1
                pcs = None
            else:
                if b["height"] and b["height_src"] == "OpenStreetMap":
                    plateau_vs_osm.append(math.log(b["height"] / top_p))
                top_b = (top_p, next(src for _, h, src in pcs if h == top_p))
        bi = len(meta)
        if b["has_parts"] and parts.get(b["id"]):
            geoms = []
            for p in parts[b["id"]]:
                if p["is_underground"]:
                    continue
                pg = C.to_local(swkb.loads(bytes(p["wkb"])))
                h, src = H.resolve(p, cls, parent=top_b)
                geoms += [[q, H.min_height(p, cls), h, src, p["name"], p] for q in polygons(pg)]
            if pcs and (len({h for _, h, _ in pcs}) > 1 or plateau.cut_parts):
                # roof faces at several heights (a podium and its tower): each part is cut along the faces over it
                cut = []
                for gm in geoms:
                    pc = plateau.pieces(gm[0])
                    cut += [[q, gm[1], max(h, gm[1] + 1.0), src, gm[4], gm[5]] for q, h, src in pc] if pc else [gm]
                geoms = cut
            elif pcs and geoms:
                # one surveyed height for the whole building: parts mapped with floor counts can miss
                # it by 10% or more (the tower parts), so the parts of that tower scale up to it
                m = max(g_[2] for g_ in geoms)
                if m > 0 and top_b[0] > 1.05 * m:
                    for g_ in geoms:
                        if g_[2] >= 0.8 * m:
                            g_[2], g_[3] = round(g_[2] * top_b[0] / m, 1), top_b[1]
        elif pcs:
            h0 = H.min_height(b, cls)
            geoms = [[q, h0, max(h, h0 + 1.0), src, None, b] for q, h, src in pcs]
        else:
            geoms = [[q, H.min_height(b, cls), top_b[0], top_b[1], None, b] for q in polygons(g)]
        # measured heights first, so a city's hooks see (and may hide) the measured solids
        geoms, s_floors = survey.apply(geoms, ctx.hidden, b["id"])
        if adjust:
            geoms = adjust(b, cls, g, geoms, ctx)
        for q, h0, h1, src, pname, *_ in geoms:
            if pname in labels_cfg and labels_cfg[pname] not in ctx.labels:
                c = q.centroid
                ctx.labels[labels_cfg[pname]] = [round(c.x, 1), round(c.y, 1), round(ctx.ground(c.x, c.y) + h1, 1)]
        top, srcs, first = 0.0, Counter(), len(solids)
        for q, h0, h1, src, _, *rec in geoms:
            hidden = id(q) in ctx.hidden
            q = q.simplify(0.15, preserve_topology=True)
            if q.is_empty or q.area < 2 or h1 <= h0:
                continue
            if hidden:
                hidden_solids.append(len(solids))
            q = shapely.geometry.polygon.orient(q, 1.0)
            cs = np.asarray(q.exterior.coords)
            # a building of a class that floats (water.floating: Amsterdam's houseboats) sits on the
            # water; others stand on the lowest ground under them
            zb = 0.0 if cls in floating else max(float(np.min(sample(C, dem_land, cs[:, 0], cs[:, 1]))), 0.0)
            solids.append([bi, round(zb * 10), round(h0 * 10), round(h1 * 10), ring(q.exterior.coords)] +
                          [ring(r.coords) for r in q.interiors if len(r.coords) > 3])
            r0 = rec[0] if rec else b  # roof tags of the part, else of the building
            sinfo.append({k: r0.get(k) for k in ("roof_shape", "roof_height", "roof_direction", "roof_orientation", "roof_material", "num_floors")}
                         | {"parametric": src == "parametric", "part": bool(rec) and r0 is not b,
                            "measured": plateau.roof_at(q, src, pl, h0, h1) if src != "parametric" and not hidden else None})
            if src == "lidar" and not hidden and sinfo[-1]["measured"] and not sinfo[-1]["roof_material"]:
                sinfo[-1]["roof_material"] = sinfo[-1]["measured"].get("material")  # the land tax files' roof material
            top = max(top, h1)
            srcs[src] += q.area
            a0 = geo.setdefault(bi, [0.0, 0.0, 0.0])
            a0[0] += q.area
            a0[1] += q.centroid.x * q.area
            a0[2] += q.centroid.y * q.area
        if not srcs:
            continue
        if b["name"] in labels_cfg and labels_cfg[b["name"]] not in ctx.labels:
            c = g.centroid
            ctx.labels[labels_cfg[b["name"]]] = [round(c.x, 1), round(c.y, 1), round(ctx.ground(c.x, c.y) + top, 1)]
        rid = b["record_id"] or ""
        seed = int(b["id"].replace("-", "")[:8], 16)
        meta.append([b["name"] or "", cls, round(top, 1), b["num_floors"] or s_floors or 0, srcs.most_common(1)[0][0], b["src"][0], rid.split("@")[0],
                     None, roof_colour(C, ortho, g if isinstance(g, Polygon) else g.convex_hull, top), round(top, 1)])
        bextra.append({"seed": seed & 0xFFFFFF, "facade_color": b.get("facade_color"), "facade_material": b.get("facade_material"),
                       "year": (pl or {}).get("year")})
        first_solid[bi] = first
        if b["height_src"] == "Microsoft ML Buildings" and b["height"]:
            ml_raw[bi] = float(b["height"])
        if b["height_src"] == "OpenStreetMap" and b["height"] and b["num_floors"] and not b["has_parts"]:
            floor_res.append(math.log(H.storey_height(cls, b["num_floors"]) / b["height"]))

    if plateau.tree is not None:
        print(f"{plateau.key}: {n_newer} OSM buildings are much taller than the survey and kept (built since)")
    model = impute_heights(meta, solids, first_solid, geo, ml_raw)
    model["residuals"]["floors"] = np.round(floor_res, 3).tolist()
    if floor_res:
        model["cv"]["floors_vs_surveyed"] = {"n": len(floor_res), "median_factor": round(float(np.exp(np.median(np.abs(floor_res)))), 3),
                                             "median_bias": round(float(np.median(floor_res)), 3)}
    if plateau_vs_osm:
        r = np.array(plateau_vs_osm)
        model["cv"][f"osm_vs_{plateau.key}"] = {"n": len(r), "median_factor": round(float(np.exp(np.median(np.abs(r)))), 3),
                                                "p90_factor": round(float(np.exp(np.percentile(np.abs(r), 90))), 3),
                                                "median_bias": round(float(np.median(r)), 3)}
        model["residuals"][f"osm_vs_{plateau.key}"] = np.round(r, 3).tolist()
    json.dump(model, open(os.path.join(C.analysis, "height_model.json"), "w"), indent=1)
    print("height imputation:", {k: v for k, v in model.items() if k not in ("residuals", "missing_correction")})

    def own(bi):
        return range(first_solid[bi], first_solid[bi + 1] if bi + 1 < len(meta) else len(solids))

    by_osm = {m[6]: i for i, m in enumerate(meta) if m[6]}
    # heights verified one by one for the buildings that move sun-access answers most
    # (analysis/uncertainty.js ranks them); each row cites its source
    verified = []
    vpath = C.file(cfg.get("verified_heights", "verified_heights.csv"))
    if os.path.exists(vpath):
        for r in csv.DictReader(open(vpath, encoding="utf8")):
            bi = by_osm.get(r["osm_id"])
            if bi is None:
                continue
            h = float(r["height_m"]) if r["height_m"] else H.storey_height(meta[bi][1], int(r["floors"]))
            f = h / max(meta[bi][2], 0.5)
            for k in own(bi):
                solids[k][3] = max(solids[k][2] + 10, round(solids[k][3] * f))
            verified.append(f'{r["name"]}: {meta[bi][2]} -> {round(h, 1)} m')
            meta[bi][2], meta[bi][4] = round(h, 1), "verified"
            meta[bi][0] = meta[bi][0] or r["name"]
            if r["floors"]:
                meta[bi][3] = int(r["floors"])
    print("verified:", verified)

    # published heights for towers whose open-data height is grossly short and that matched by name
    fixes = []
    ref_path = os.path.join(C.analysis, "heights.json")
    if os.path.exists(ref_path):
        for r in json.load(open(ref_path))["rows"]:
            # by name, and not a row excluded as ambiguous (its address or point cannot pick the building)
            if r.get("how") == "name" and r.get("match") == "address" and r.get("error_pct", 0) < -40 and r.get("osm_id") in by_osm:
                bi = by_osm[r["osm_id"]]
                if meta[bi][4] == "verified":  # a cited lookup outranks a list
                    continue
                tallest = max(own(bi), key=lambda k: solids[k][3])
                solids[tallest][3] = round(r["ref_m"] * 10)
                fixes.append(f'{r["name"]}: {meta[bi][9]} -> {r["ref_m"]} m')
                meta[bi][2], meta[bi][4] = r["ref_m"], "reference"
                if labels_cfg.get(meta[bi][0]) in ctx.labels:
                    ctx.labels[labels_cfg[meta[bi][0]]][2] = round(solids[tallest][1] / 10 + r["ref_m"], 1)
    print("reference corrections:", fixes)

    # roofs, facades and rooftops on the finished heights
    roads = road_index(C, con, raw("segment"))
    roof_rows, front_rows, prop_rows, roof_stat = dress_buildings(C, meta, solids, sinfo, bextra, roads, set(hidden_solids))
    roof_check = validate_roof_rules(C, meta, solids, sinfo, bextra)
    json.dump({"note": "Roof shapes: mapped (Overture roof_shape), else ruled flat, else drawn from the region's prior. "
                       "The check predicts each mapped roof as if it were not mapped.",
               "counts": roof_stat, "check": roof_check, "roofs_built": len(roof_rows), "rooftop_props": len(prop_rows),
               "frontage_solids": len(front_rows), "skeleton_failures": roofs.FAILS},
              open(os.path.join(C.analysis, "roof_model.json"), "w"), indent=1)
    print(f"roofs: {len(roof_rows)} built; {roof_stat}")
    print("roof rules against mapped and measured roofs:", roof_check)
    src_count = Counter(m[4] for m in meta)
    share = Counter()
    for i, m in enumerate(meta):
        share[m[4]] += geo[i][0]
    tot = sum(share.values())
    print(f"buildings: {len(meta)} with {len(solids)} solids; by height source {dict(src_count)}")
    print("footprint area share by height source:", {k: round(v / tot, 3) for k, v in share.items()})

    before = set(ctx.labels)
    # the finished buildings, for a hook that reports on them
    ctx.meta, ctx.solids, ctx.roof_rows, ctx.prop_rows = meta, solids, roof_rows, prop_rows
    ctx.roof_shapes, ctx.roof_sources = list(roofs.CODES), ROOF_SRC
    if C.hook("finalize"):
        C.hook("finalize")(ctx)
    # labels the landmark hook adds go first: the viewer hides a label that would overlap an earlier one
    ctx.labels = {k: v for k, v in ctx.labels.items() if k not in before} | {k: v for k, v in ctx.labels.items() if k in before}

    # public places named in the config: the largest land-use polygon of that name and class,
    # with "source": "land" the largest land-cover polygon instead (a beach),
    # or for "source": "water" (a river corridor) every water polygon of that name, widened by buffer_m
    lu, wat, land = rows(con, raw("land_use")), None, None
    places = []
    for pc in cfg.get("places", []):
        if pc.get("source") == "water":
            wat = wat or rows(con, raw("water"))
            cands = [r for r in wat if (r["name"] or "").startswith(pc["name"]) and r["class"] == pc.get("class", r["class"])]
        elif pc.get("source") == "land":
            land = land or rows(con, raw("land"))
            cands = [r for r in land if (r["name"] or "").startswith(pc["name"]) and r["class"] == pc.get("class", r["class"])]
        else:
            cands = [r for r in lu if (r["name"] or "").startswith(pc["name"]) and r["class"] == pc.get("class", r["class"])]
        if not cands:
            print("place not found:", pc["name"])
            continue
        geoms = [C.to_local(swkb.loads(bytes(r["wkb"]))) for r in cands]
        if pc.get("source") == "water":
            geom = shapely.union_all(geoms).buffer(pc.get("buffer_m", 0.0)).intersection(extent)
        else:
            geom = max(geoms, key=lambda q: q.area).intersection(extent)
        polys = [p.simplify(0.5) for p in polygons(geom) if p.area > 50]
        places.append({"name": pc.get("label", pc["name"]), "lep": pc.get("protected", False), "period": pc.get("period"), "from": pc.get("from"),
                       "to": pc.get("to"), "area_m2": round(sum(p.area for p in polys)),
                       "polygons": [[ring(p.exterior.coords)] + [ring(r.coords) for r in p.interiors] for p in polys]})

    # terrain grid shipped to the browser (10 m): int16 decimetres, little-endian, base64 in JSON
    step = int(TERRAIN_CELL / DEM_CELL)
    tg = dem[::step, ::step]
    json.dump({"encoding": "int16le-base64", "nx": tg.shape[1], "ny": tg.shape[0],
               "data": base64.b64encode(np.round(tg * 10).astype("<i2").tobytes()).decode()},
              open(os.path.join(C.out, "terrain.json"), "w"))

    keep = ("id", "name", "country", "country_code", "timezone", "locale", "description", "vertical_datum", "year", "tour", "start", "protection",
            "light_show", "minor_labels", "place_labels", "sun_hours_region", "renders", "night_ambient")
    scene = {
        "city": {k: cfg[k] for k in keep if k in cfg} | {"lat": C.lat0, "lon": C.lon0, "architecture": typology.region_name(cfg),
                                                         "signage": typology.region(cfg)["signage"]},
        "frame": {"proj": C.proj, "lon0": C.lon0, "lat0": C.lat0, "x": [C.x0, C.x1], "y": [C.y0, C.y1], "units": f"m, z = {cfg.get('vertical_datum', 'm')}"},
        "terrain": {"file": "terrain.json", "nx": tg.shape[1], "ny": tg.shape[0], "cell": TERRAIN_CELL, "scale": 0.1,
                    "origin": "north-west, row-major, rows go south", "bare_earth": cfg["terrain"].get("bare_earth", False)},
        "ground": tiles,
        "shore": {"file": "shore.png", "cell": SHORE_CELL, "nx": sm["nx"], "ny": sm["ny"], "x0": C.x0, "y1": C.y1,
                  "encoding": "r: 128 + 2 x signed distance to the shoreline (m, water positive); g: sand; b: rock",
                  "slopes": sm["slopes"], "floor_m": FLOOR_M} | sm["counts"],
        "water": {k: v for k, v in cfg.get("water", {}).items() if k in ("waves", "colour", "shallow_colour", "clarity_m")},
        "trees": cfg.get("trees", {}),
        "hidden_solids": hidden_solids,
        "storey": {k: {"per_floor_m": a, "plus_m": b} for k, (a, b) in H.storey.items()},
        "height_sources": dict(src_count),
        **({"survey": survey.summary()} if survey.tree is not None or lidar is not None else {}),
        "landmarks": ctx.landmarks,
        "labels": ctx.labels,
        "sources": {
            **({"heights": cfg["plateau"]["attribution"]} if cfg.get("plateau") else {}),
            **({"heights": cfg["ign"]["attribution"]} if cfg.get("ign", {}).get("attribution") else {}),
            **({"heights": cfg["survey"]["attribution"]} if survey.tree is not None else {}),
            **({"lidar_heights": f'{cfg["surface_check"]["name"]}: the median roof inside each footprint the survey misses'} if lidar is not None else {}),
            "buildings": f"Overture Maps Foundation, release {cfg['overture_release']} (OpenStreetMap contributors, ODbL; Microsoft ML Buildings, ODbL)",
            "terrain": cfg["terrain"].get("attribution", cfg["terrain"]["type"]),
            "imagery": cfg["imagery"].get("attribution", ""),
            "places": "Overture base land use (OpenStreetMap, ODbL)" + (f"; rules: {cfg['protection']['title']}" if cfg.get("protection") else ""),
            "trees": "Overture base land, tree points and rows (OpenStreetMap, ODbL); heights not mapped",
        } | cfg.get("sources", {}),
    }
    if os.path.exists(ref_path):
        acc = json.load(open(ref_path))
        scene["sources"]["reference_heights"] = cfg.get("reference_heights", {}).get("source", "published heights")
        scene["accuracy"] = {"summary": acc["summary"], "note": acc["note"], "method": acc.get("method"), "source": cfg.get("reference_heights", {}).get("source"),
                             "rows": [[r["name"], r["ref_m"], r.get("model_m"), r.get("error_pct"), r["match"], r.get("how")] for r in acc["rows"]]}
    lid_path = os.path.join(C.analysis, "lidar_heights.json")  # analysis/lidar_heights.py
    if os.path.exists(lid_path):
        lh = json.load(open(lid_path, encoding="utf8"))
        scene["lidar_check"] = {"source": lh.get("lidar"), "survey": lh["model_vs_lidar_m"].get("survey"), "towers_100m": lh.get("towers_100m_vs_lidar"),
                                "open_data_vs_survey": lh.get("open_data_vs_survey")}
    json.dump(scene, open(os.path.join(C.out, "scene.json"), "w"), separators=(",", ":"))
    json.dump({"fields": ["name", "class", "top_m", "floors", "height_src", "footprint_src", "osm_id", "wall", "roof", "open_data_top_m",
                          "style (index in styles)", "storey_m", "ground_floor_m", "roof_material (index)", "seed", "roof_shape (index)",
                          "roof_src (index)"], "b": meta,
               "s_fields": ["building", "base_dm", "min_dm", "top_dm", "ring_dm", "...holes_dm"], "s": solids,
               "styles": typology.STYLES, "roof_shapes": list(roofs.CODES), "roof_materials": typology.ROOF_MATERIALS,
               "roof_sources": ROOF_SRC,
               "r_fields": ["solid", "top_dm", "eave_dm", "shape", "x0_dm", "y0_dm",
                            "xyz: int16le base64, (x - x0, y - y0, z above the solid's base) in dm",
                            "triangles: base64 vertex indices, uint8 below 256 vertices else uint16le",
                            "roof_triangles (the rest are walls and soffits)"],
               "r": roof_rows,
               "f_fields": ["solid", "edge, flags (1 shopfront, 2 awning) ..."], "f": front_rows,
               "p_fields": ["solid", "kind (0 plant box, 1 plant room, 2 water tank, 3 dormers, 4 chimney stack)", "x_dm", "y_dm", "w_dm", "d_dm",
                            "h_dm", "angle_cdeg", "base_dm (absolute; else the solid's deck)",
                            "dormers: count, step_dm along the angle, bitmask of bays left empty"], "p": prop_rows},
              open(os.path.join(C.out, "buildings.json"), "w"), separators=(",", ":"))
    json.dump({"piers": piers, "places": places, "trees": trees}, open(os.path.join(C.out, "places.json"), "w"), separators=(",", ":"))
    write_index()
    for f in sorted(os.listdir(C.out)):
        print(f"  {f}: {os.path.getsize(os.path.join(C.out, f)) / 1e6:.2f} MB")


def write_index():
    """web/data/cities.json: the globe's list, with each city marked built or not."""
    idx = json.load(open(os.path.join(ROOT, "cities", "index.json"), encoding="utf8"))
    for c in idx["cities"]:
        own = os.path.join(ROOT, "cities", c["id"], "city.json")
        if "timezone" not in c and os.path.exists(own):  # the globe shows each site's local time
            c["timezone"] = json.load(open(own, encoding="utf8")).get("timezone")
        scene = os.path.join(ROOT, "web", "data", c["id"], "scene.json")
        c["built"] = os.path.exists(scene)
        c["game"] = os.path.exists(os.path.join(ROOT, "web", "data", c["id"], "game.json"))
        if c["built"]:  # the title screen's figures: buildings and the extent of the model
            sc = json.load(open(scene, encoding="utf8"))
            if "height_sources" in sc:
                c["buildings"] = sum(sc["height_sources"].values())
            x0, x1, y0, y1 = sc["extent_m"] if "extent_m" in sc else (*sc["frame"]["x"], *sc["frame"]["y"])
            c["extent_km"] = [round((x1 - x0) / 1000, 1), round((y1 - y0) / 1000, 1)]
    os.makedirs(os.path.join(ROOT, "web", "data"), exist_ok=True)
    json.dump(idx["cities"], open(os.path.join(ROOT, "web", "data", "cities.json"), "w"), indent=1)


if __name__ == "__main__":
    build(city_args(__doc__.splitlines()[0])[0])
