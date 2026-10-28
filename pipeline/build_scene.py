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
import shapely.prepared
from PIL import Image, ImageDraw
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree
from shapely import wkb as swkb
from shapely.geometry import Polygon, box

from cityctx import ROOT, City, city_args, polygons

DEM_CELL = 5.0       # m, building bases and analysis
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

def load_dem(C, cell=DEM_CELL):
    """The city's DEM resampled to the local frame; row 0 is the north edge."""
    meta = json.load(open(os.path.join(C.raw, "dem.json")))
    im = np.asarray(Image.open(os.path.join(C.raw, "dem.tif")), dtype=np.float32)
    mx0, my0, mx1, my1 = meta["bbox"]
    h, w = im.shape
    nx, ny = int((C.x1 - C.x0) / cell) + 1, int((C.y1 - C.y0) / cell) + 1
    gx, gy = np.meshgrid(C.x0 + np.arange(nx) * cell, C.y1 - np.arange(ny) * cell)
    lon, lat = C.inv.transform(gx.ravel(), gy.ravel())
    mx = np.asarray(lon) * 20037508.342789 / 180
    my = np.log(np.tan((90 + np.asarray(lat)) * np.pi / 360)) * 6378137
    col = (mx - mx0) / (mx1 - mx0) * w - 0.5
    row = (my1 - my) / (my1 - my0) * h - 0.5
    return map_coordinates(im, [row, col], order=1, mode="nearest").reshape(ny, nx)


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


FACADE = {"brick": "#9c6b52", "glass": "#7d93a3", "plaster": "#d9d2c3", "concrete": "#b4b0a8", "stone": "#c9ad7f",
          "metal": "#9aa1a6", "timber_framing": "#8a6a4d"}
HERITAGE = {"church", "cathedral", "public", "government", "train_station", "university", "college", "civic", "museum"}


def wall_colour(b, cls, top, seed):
    """Overture facade colour or material when mapped, else a class palette."""
    if b.get("facade_color") and str(b["facade_color"]).startswith("#") and len(b["facade_color"]) == 7:
        return b["facade_color"]
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


def roof_colour(C, ortho, geom, top):
    """Median aerial-photo colour inside the footprint; tall towers lean in a
    non-true orthophoto, so they get a neutral roof instead."""
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
    ki = np.where(np.isin(src, ["mapped", "floors", "plateau"]))[0]
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


# ---------------------------------------------------------------- measured heights (PLATEAU)

class Plateau:
    """Surveyed building heights from a city's `plateau` block (see pipeline/fetch_plateau.py).

    PLATEAU's LOD2 outlines are roof faces: one building is several faces at different heights
    (a podium and its tower, a penthouse). A footprint is cut along those faces, tallest first,
    so each piece takes the surveyed height of the face above it. Faces smaller than a few
    per cent of the footprint are rooftop plant, and are absorbed by the main piece. A footprint
    that fewer than half the faces cover keeps its other height source. PLATEAU buildings that no
    Overture footprint covers (newer or missing in OSM) are added as their own buildings."""
    MERGE_M, MIN_PIECE_M2, MIN_PIECE_SHARE = 1.5, 8.0, 0.04

    def __init__(self, C):
        path = os.path.join(C.raw, "plateau.json")
        self.tree = None
        if not C.cfg.get("plateau") or not os.path.exists(path):
            return
        self.polys, self.h = [], []
        # footprints inside these discs belong to a parametric landmark (a lattice tower), not to a building
        holes = [(C.fwd.transform(*e["at"]), e["radius_m"]) for e in C.cfg["plateau"].get("exclude", [])]
        for f in json.load(open(path)):
            g = C.to_local(Polygon(f["rings"][0], f["rings"][1:]))
            if any(math.hypot(g.centroid.x - c[0], g.centroid.y - c[1]) < r for c, r in holes):
                continue
            if not g.is_valid:
                g = g.buffer(0)
            if not g.is_empty and f["h"] > 0.5:
                self.polys.append(g)
                self.h.append(f["h"])
        self.tree = shapely.STRtree(self.polys)
        print(f"plateau: {len(self.polys)} footprints indexed")

    def pieces(self, q):
        """[(polygon, height)] covering q, or None if PLATEAU does not cover at least half of it."""
        if self.tree is None or q.area < 1:
            return None
        cand = []
        for i in self.tree.query(q):
            x = q.intersection(self.polys[i])
            if x.area >= self.MIN_PIECE_M2:
                cand.append((self.h[i], x))
        if not cand or shapely.union_all([x for _, x in cand]).area < 0.5 * q.area:
            return None
        cand.sort(key=lambda t: -t[0])
        taken, out = Polygon(), []
        for h, x in cand:  # tallest first, so a tower is not buried under its podium's face
            x = x.difference(taken)
            if x.area >= self.MIN_PIECE_M2:
                out.append([h, x])
                taken = taken.union(x)
        main = max(out, key=lambda t: t[1].area)
        # rooftop plant is small and only a few metres above the roof; a small face that stands
        # well above the main roof is a spire or a dome (the Diet's tower, Tokyo Station's domes)
        out = [t for t in out if t is main or t[1].area >= self.MIN_PIECE_SHARE * q.area or (t[0] >= main[0] + 8.0 and t[1].area >= 25.0)]
        taken = shapely.union_all([t[1] for t in out])
        rest = q.difference(taken)
        out.sort(key=lambda t: -t[0])
        merged = []
        for h, x in out:  # faces within MERGE_M of each other become one solid
            for m in merged:
                if abs(m[0] - h) < self.MERGE_M:
                    m[1] = m[1].union(x)
                    break
            else:
                merged.append([h, x])
        if rest.area > 0:  # uncovered remainder (walls, overhang): the height of the main piece
            m = min(merged, key=lambda t: abs(t[0] - main[0]))
            m[1] = m[1].union(rest)
        return [(g, round(h, 1)) for h, x in merged for g in polygons(x) if g.area >= 1]

    def additions(self, covered, min_area=40.0):
        """PLATEAU footprints that the Overture buildings (union `covered`) do not cover."""
        if self.tree is None:
            return []
        prep = shapely.prepared.prep(covered)
        out, kept_ix = [], set()
        for i in sorted(range(len(self.polys)), key=lambda i: -self.polys[i].area):
            p = self.polys[i]
            if p.area < min_area or (prep.intersects(p) and p.intersection(covered).area > 0.25 * p.area):
                continue
            if any(p.intersection(q).area > 0.4 * p.area for q in (self.polys[j] for j in self.tree.query(p) if j in kept_ix)):
                continue
            out.append((p, self.h[i]))
            kept_ix.add(i)
        return out


# ---------------------------------------------------------------- city hooks

class Ctx:
    """What cities/<id>/city.py hooks may use and fill in."""

    def __init__(self, C, dem_land):
        self.city, self.dem_land = C, dem_land
        self.landmarks, self.labels = {}, {}
        self.polygons = polygons

    def ground(self, x, y):
        return float(sample(self.city, self.dem_land, x, y)[0])


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
    wcfg = cfg.get("water", {})
    wclasses, wmin = set(wcfg.get("classes", ["ocean", "bay", "water"])), wcfg.get("min_area_m2", 5000)
    seas = [C.to_local(swkb.loads(bytes(r["wkb"]))) for r in rows(con, raw("water")) if r["class"] in wclasses]
    sea = [p for g in seas for p in polygons(g.intersection(extent.buffer(50))) if p.area > wmin]
    water = raster_mask(sea, dem.shape[1], dem.shape[0], DEM_CELL, C.x0, C.y1)
    dem_land = dem.copy()
    dem[water] = -4.0
    ctx = Ctx(C, dem_land)

    tiles, ortho = ground_tiles(C)

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
    plateau = Plateau(C)
    blds = rows(con, raw("building"))
    parts = defaultdict(list)
    for p in rows(con, raw("building_part")):
        parts[p["building_id"]].append(p)
    meta, solids, first_solid, geo, ml_raw, floor_res = [], [], {}, {}, {}, []
    if plateau.tree is not None:  # surveyed buildings that Overture lacks
        covered = shapely.union_all([C.to_local(swkb.loads(bytes(b["wkb"]))).buffer(0) for b in blds])
        extra = [(q, h) for q, h in plateau.additions(covered) if extent.contains(q.centroid)]
        for k, (q, h) in enumerate(extra):
            ll = shapely.transform(q, lambda c: np.column_stack(C.inv.transform(c[:, 0], c[:, 1])))
            blds.append({"id": f"{k:08x}-plateau", "name": None, "class": None, "subtype": None, "height": h, "min_height": None,
                         "num_floors": None, "min_floor": None, "roof_height": None, "is_underground": False, "has_parts": False,
                         "src": "PLATEAU", "record_id": None, "height_src": "PLATEAU", "wkb": shapely.to_wkb(ll)})
        print(f"plateau: {len(extra)} buildings added that Overture does not have")
    for b in blds:
        if b["is_underground"]:
            continue
        g = C.to_local(swkb.loads(bytes(b["wkb"])))
        if not extent.contains(g.centroid):
            continue
        cls = b["class"] or b["subtype"] or ""
        top_b = H.resolve(b, cls)
        bi = len(meta)
        if b["has_parts"] and parts.get(b["id"]):
            geoms = []
            for p in parts[b["id"]]:
                if p["is_underground"]:
                    continue
                pg = C.to_local(swkb.loads(bytes(p["wkb"])))
                h, src = H.resolve(p, cls, parent=top_b)
                geoms += [[q, H.min_height(p, cls), h, src, p["name"]] for q in polygons(pg)]
        else:
            geoms = [[q, H.min_height(b, cls), top_b[0], top_b[1], None] for q in polygons(g)]
        if adjust:
            geoms = adjust(b, cls, g, geoms, ctx)
        # a surveyed height beats every other source, except a landmark's own model
        cut = []
        for gm in geoms:
            pc = plateau.pieces(gm[0]) if gm[3] != "parametric" else None
            cut += [[q, gm[1], max(h, gm[1] + 1.0), "plateau", gm[4]] for q, h in pc] if pc else [gm]
        geoms = cut
        for q, h0, h1, src, pname in geoms:
            if pname in labels_cfg and labels_cfg[pname] not in ctx.labels:
                c = q.centroid
                ctx.labels[labels_cfg[pname]] = [round(c.x, 1), round(c.y, 1), round(ctx.ground(c.x, c.y) + h1, 1)]
        top, srcs, first = 0.0, Counter(), len(solids)
        for q, h0, h1, src, _ in geoms:
            q = q.simplify(0.15, preserve_topology=True)
            if q.is_empty or q.area < 2 or h1 <= h0:
                continue
            q = shapely.geometry.polygon.orient(q, 1.0)
            cs = np.asarray(q.exterior.coords)
            zb = max(float(np.min(sample(C, dem_land, cs[:, 0], cs[:, 1]))), 0.0)
            solids.append([bi, round(zb * 10), round(h0 * 10), round(h1 * 10), ring(q.exterior.coords)] +
                          [ring(r.coords) for r in q.interiors if len(r.coords) > 3])
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
        meta.append([b["name"] or "", cls, round(top, 1), b["num_floors"] or 0, srcs.most_common(1)[0][0], b["src"][0], rid.split("@")[0],
                     wall_colour(b, cls, top, seed), roof_colour(C, ortho, g if isinstance(g, Polygon) else g.convex_hull, top), round(top, 1)])
        first_solid[bi] = first
        if b["height_src"] == "Microsoft ML Buildings" and b["height"]:
            ml_raw[bi] = float(b["height"])
        if b["height_src"] == "OpenStreetMap" and b["height"] and b["num_floors"] and not b["has_parts"]:
            floor_res.append(math.log(H.storey_height(cls, b["num_floors"]) / b["height"]))

    model = impute_heights(meta, solids, first_solid, geo, ml_raw)
    model["residuals"]["floors"] = np.round(floor_res, 3).tolist()
    if floor_res:
        model["cv"]["floors_vs_surveyed"] = {"n": len(floor_res), "median_factor": round(float(np.exp(np.median(np.abs(floor_res)))), 3),
                                             "median_bias": round(float(np.median(floor_res)), 3)}
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
            if r.get("how") == "name" and r.get("error_pct", 0) < -40 and r.get("osm_id") in by_osm:
                bi = by_osm[r["osm_id"]]
                tallest = max(own(bi), key=lambda k: solids[k][3])
                solids[tallest][3] = round(r["ref_m"] * 10)
                fixes.append(f'{r["name"]}: {meta[bi][9]} -> {r["ref_m"]} m')
                meta[bi][2], meta[bi][4] = r["ref_m"], "reference"
                if labels_cfg.get(meta[bi][0]) in ctx.labels:
                    ctx.labels[labels_cfg[meta[bi][0]]][2] = round(solids[tallest][1] / 10 + r["ref_m"], 1)
    print("reference corrections:", fixes)
    src_count = Counter(m[4] for m in meta)
    share = Counter()
    for i, m in enumerate(meta):
        share[m[4]] += geo[i][0]
    tot = sum(share.values())
    print(f"buildings: {len(meta)} with {len(solids)} solids; by height source {dict(src_count)}")
    print("footprint area share by height source:", {k: round(v / tot, 3) for k, v in share.items()})

    before = set(ctx.labels)
    if C.hook("finalize"):
        C.hook("finalize")(ctx)
    # labels the landmark hook adds go first: the viewer hides a label that would overlap an earlier one
    ctx.labels = {k: v for k, v in ctx.labels.items() if k not in before} | {k: v for k, v in ctx.labels.items() if k in before}

    # public places named in the config (largest polygon of that name and class)
    lu = rows(con, raw("land_use"))
    places = []
    for pc in cfg.get("places", []):
        cands = [r for r in lu if (r["name"] or "").startswith(pc["name"]) and r["class"] == pc.get("class", r["class"])]
        if not cands:
            print("place not found:", pc["name"])
            continue
        geom = max((C.to_local(swkb.loads(bytes(r["wkb"]))) for r in cands), key=lambda q: q.area).intersection(extent)
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

    keep = ("id", "name", "country", "timezone", "locale", "description", "vertical_datum", "year", "tour", "start", "protection",
            "minor_labels", "place_labels", "sun_hours_region", "renders")
    scene = {
        "city": {k: cfg[k] for k in keep if k in cfg} | {"lat": C.lat0, "lon": C.lon0},
        "frame": {"proj": C.proj, "lon0": C.lon0, "lat0": C.lat0, "x": [C.x0, C.x1], "y": [C.y0, C.y1], "units": f"m, z = {cfg.get('vertical_datum', 'm')}"},
        "terrain": {"file": "terrain.json", "nx": tg.shape[1], "ny": tg.shape[0], "cell": TERRAIN_CELL, "scale": 0.1,
                    "origin": "north-west, row-major, rows go south", "bare_earth": cfg["terrain"].get("bare_earth", False)},
        "ground": tiles,
        "storey": {k: {"per_floor_m": a, "plus_m": b} for k, (a, b) in H.storey.items()},
        "height_sources": dict(src_count),
        "landmarks": ctx.landmarks,
        "labels": ctx.labels,
        "sources": {
            **({"heights": cfg["plateau"]["attribution"]} if cfg.get("plateau") else {}),
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
    json.dump(scene, open(os.path.join(C.out, "scene.json"), "w"), separators=(",", ":"))
    json.dump({"fields": ["name", "class", "top_m", "floors", "height_src", "footprint_src", "osm_id", "wall", "roof", "open_data_top_m"], "b": meta,
               "s_fields": ["building", "base_dm", "min_dm", "top_dm", "ring_dm", "...holes_dm"], "s": solids},
              open(os.path.join(C.out, "buildings.json"), "w"), separators=(",", ":"))
    json.dump({"piers": piers, "places": places, "trees": trees}, open(os.path.join(C.out, "places.json"), "w"), separators=(",", ":"))
    write_index()
    for f in sorted(os.listdir(C.out)):
        print(f"  {f}: {os.path.getsize(os.path.join(C.out, f)) / 1e6:.2f} MB")


def write_index():
    """web/data/cities.json: the globe's list, with each city marked built or not."""
    idx = json.load(open(os.path.join(ROOT, "cities", "index.json"), encoding="utf8"))
    for c in idx["cities"]:
        c["built"] = os.path.exists(os.path.join(ROOT, "web", "data", c["id"], "scene.json"))
        c["game"] = os.path.exists(os.path.join(ROOT, "web", "data", c["id"], "game.json"))
    os.makedirs(os.path.join(ROOT, "web", "data"), exist_ok=True)
    json.dump(idx["cities"], open(os.path.join(ROOT, "web", "data", "cities.json"), "w"), indent=1)


if __name__ == "__main__":
    build(city_args(__doc__.splitlines()[0])[0])
