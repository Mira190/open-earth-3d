"""Landings past the frame: a small tile of ground the game can sail to and walk on, far from the
model (a lake steamer's far wharf, an island a harbour ferry calls at).

The model's frame is a few kilometres across, and past it there is only the far land
(pipeline/far_land.py), a height grid seen through haze. Some of a city's real journeys end
beyond it: the TSS Earnslaw's run from Queenstown is to Walter Peak, 13 km across Lake Wakatipu.
An outpost carries just enough for that: its own terrain on a fine grid, the latest aerial photo
draped on it, its water, its wharf as a walkable deck, and its buildings, all in the city's local
frame. The game draws it in a hole cut in the far land (web/outposts.js, web/farland.js), walks
on it (web/game/nav.js) and sails to it on a ferry leg routed over the real lake past the frame.

city.json game.outposts: [{
  id, name,
  bbox: [w, s, e, n]          the tile (WGS84); its outer `band_m` blends to the far land's surface
  cell_m: 2                   the terrain grid
  band_m: 60                  the blend to the far land at the tile's edge (web/outposts.js)
  terrain: {collection, crs, pixel_m, name}   a STAC collection of DEM COGs (default: far.relief)
  imagery: {collection, crs, pixel_m, name, scale}   a STAC collection of aerial photo COGs (scale: to 0..255)
  wharf: {id, name, terminal: [lon, lat]}     a ferry wharf there (game.wharves names it with "outpost")
  buildings: {record_id: {name, eaves_m, ridge_m, wall}}   what the footprints cannot say
  water_m: the lake's surface on the terrain's datum (default: the city's datum_offset_m, so 0 m)
}]

From Overture (OpenStreetMap-derived, ODbL): the water (the lake's polygon, which also gives the
water mask past the frame for the ferry's route), the buildings, the piers and the ferry
terminal. Written into web/data/<id>/game.json "outposts" (the terrain in centimetres and the
water and building masks, base64), the photo to web/data/<id>/outpost_<oid>.jpg, and the wharf
and the ferry legs that call there into game.json's "wharves" and "ferries".

    python pipeline/outposts.py --city queenstown          # after game_data.py; game_data.py runs it too

If your environment injects AWS credentials, unset them first (see fetch_overture.py).
"""
import base64
import json
import math
import os

import numpy as np
import shapely
from PIL import Image
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from shapely import wkb as swkb
from shapely.geometry import LineString, Point, Polygon, box

from cityctx import city_args

ROUTE_CELL = 10.0     # the ferry's routing grid past the frame (m)
CLEAR_M = 30.0        # a steamer keeps this far off the shore out on the lake
BAND_M = 60.0
UA = {"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"}


def overture(C, name, bbox, cache):
    """Overture's features of a theme that meet bbox, cached in data/raw/<city>/."""
    path = os.path.join(C.raw, f"outpost_{cache}.parquet")
    q = {
        "building": "theme=buildings/type=building", "infrastructure": "theme=base/type=infrastructure", "water": "theme=base/type=water",
    }[name]
    if not os.path.exists(path):
        import duckdb
        os.makedirs(C.raw, exist_ok=True)
        con = duckdb.connect()
        con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
        con.execute("CREATE OR REPLACE SECRET anon (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2');")
        root = f"s3://overturemaps-us-west-2/release/{C.cfg['overture_release']}"
        w, s, e, n = bbox
        con.execute(f"""COPY (SELECT id, names.primary AS name, class, sources[1].record_id AS record_id, ST_AsWKB(geometry) AS wkb
            FROM read_parquet('{root}/{q}/*', hive_partitioning=1)
            WHERE bbox.xmax > {w} AND bbox.xmin < {e} AND bbox.ymax > {s} AND bbox.ymin < {n}) TO '{path}' (FORMAT parquet)""")
    import duckdb
    rows = duckdb.connect().execute(f"SELECT id, name, class, record_id, wkb FROM '{path}'").fetchall()
    return [{"id": r[0], "name": r[1], "class": r[2], "record_id": r[3], "geom": C.to_local(swkb.loads(bytes(r[4])))} for r in rows]


def local_box(C, bbox, cell):
    """The tile's grid in the local frame, snapped to the cell: (x0, y1, nx, ny)."""
    xs, ys = C.fwd.transform([bbox[0], bbox[2], bbox[0], bbox[2]], [bbox[1], bbox[1], bbox[3], bbox[3]])
    x0, x1 = math.floor(min(xs) / cell) * cell, math.ceil(max(xs) / cell) * cell
    y0, y1 = math.floor(min(ys) / cell) * cell, math.ceil(max(ys) / cell) * cell
    return x0, y1, int(round((x1 - x0) / cell)), int(round((y1 - y0) / cell))


def warp(C, src, ok, sbox, crs, x0, y1, nx, ny, cell, bands=1):
    """A STAC mosaic (stac_mosaic's array, mask and box) resampled onto the local grid; NaN where it has none."""
    from rasterio.transform import from_origin
    from rasterio.warp import Resampling, reproject
    out = []
    px = (sbox[2] - sbox[0]) / src.shape[2]
    for k in range(bands):
        s = np.where(ok, src[k], np.nan).astype(np.float32)
        d = np.full((ny, nx), np.nan, np.float32)
        reproject(s, d, src_transform=from_origin(sbox[0], sbox[3], px, px), src_crs=crs, dst_transform=from_origin(x0, y1, cell, cell),
                  dst_crs=C.proj, resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
        out.append(d)
    return np.stack(out)


def rasterise(polys, x0, y1, nx, ny, cell):
    """Polygons (local) to a boolean grid, sampled at cell centres."""
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    shapes = [(p, 1) for p in polys if not p.is_empty]
    if not shapes:
        return np.zeros((ny, nx), bool)
    return rasterize(shapes, out_shape=(ny, nx), transform=from_origin(x0, y1, cell, cell), fill=0, dtype="uint8").astype(bool)


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def bits(mask):
    return base64.b64encode(np.packbits(mask.ravel().astype(np.uint8)).tobytes()).decode()


def mosaic(C, key, cfg, bbox, bands, pad_m):
    """fetch_tiles.stac_mosaic, cached in data/raw/<city>/ (the COGs are read over HTTP range requests)."""
    path = os.path.join(C.raw, f"outpost_{key}.npz")
    if os.path.exists(path):
        f = np.load(path)
        return f["a"], f["ok"], list(f["box"])
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fetch_tiles import stac_mosaic
    a, ok, sbox = stac_mosaic(cfg["collection"], bbox, cfg["crs"], cfg.get("pixel_m", 8), bands=bands, pad_m=pad_m)
    os.makedirs(C.raw, exist_ok=True)
    np.savez_compressed(path, a=a, ok=ok, box=np.array(sbox))
    return a, ok, sbox


def build_one(C, o, lake_polys):
    cell = o.get("cell_m", 2.0)
    x0, y1, nx, ny = local_box(C, o["bbox"], cell)
    datum = o.get("water_m", C.cfg.get("datum_offset_m", 0.0))
    tile = box(x0, y1 - ny * cell, x0 + nx * cell, y1)
    # the water: the lake, and anything else Overture maps as water over the tile
    feats = overture(C, "water", o["bbox"], f"{o['id']}_water")
    water_polys = [f["geom"] for f in feats if f["geom"].geom_type in ("Polygon", "MultiPolygon")] + lake_polys
    water = rasterise([shapely.intersection(p, tile.buffer(cell)) for p in water_polys], x0, y1, nx, ny, cell)
    # the terrain: the DEM less the datum; under the water a bottom shelving away from the shore
    tc = o.get("terrain") or C.cfg["far"]["relief"]
    a, ok, sbox = mosaic(C, f"{o['id']}_dem", tc, o["bbox"], 1, 100)
    z = warp(C, a, ok, sbox, tc["crs"], x0, y1, nx, ny, cell)[0] - datum
    if np.isnan(z).any():
        z = z[tuple(ndimage.distance_transform_edt(np.isnan(z), return_distances=False, return_indices=True))]
    off = ndimage.distance_transform_edt(water) * cell
    z = np.where(water, -np.minimum(0.6 + off * 0.12, 6.0), np.maximum(z, 0.35))  # (no deeper than the far land's lake, -6 m: the same water at the seam)
    # a contour-interpolated DEM is terraced on gentle ground: a little smoothing on land, none at the shore
    zs = ndimage.gaussian_filter(z, 1.2)
    z = np.where(water | (ndimage.distance_transform_edt(~water) * cell < 6), z, zs)
    # the photo
    im = o["imagery"]
    ipx = im.get("pixel_m", 0.5)
    rgb, ok2, sbox2 = mosaic(C, f"{o['id']}_photo", im, o["bbox"], 3, 50)
    rgb = rgb * im.get("scale", 1.0)  # (LINZ's RGBNIR photos are 16-bit: scale 1/256)
    pnx, pny = int(round(nx * cell / ipx)), int(round(ny * cell / ipx))
    col = warp(C, rgb, ok2, sbox2, im["crs"], x0, y1, pnx, pny, ipx, bands=3)
    col = np.nan_to_num(col, nan=90.0)
    photo = np.clip(np.moveaxis(col, 0, -1), 0, 255).astype(np.uint8)
    name = f"outpost_{o['id']}.jpg"
    Image.fromarray(photo).save(os.path.join(C.out, name), quality=86, optimize=True)
    # the buildings: footprints with a pitched roof; roof colour from the photo, walls and heights judged
    over = o.get("buildings", {})
    blds, solid = [], []
    for f in overture(C, "building", o["bbox"], f"{o['id']}_building"):
        g = f["geom"]
        if g.geom_type == "MultiPolygon":
            g = max(g.geoms, key=lambda q: q.area)
        if g.geom_type != "Polygon" or g.area < 8 or not tile.buffer(-BAND_M).contains(g.centroid):
            continue
        cfg = over.get(f["record_id"] or "", {})
        g = g.simplify(0.3)
        ring = list(g.exterior.coords)[:-1]
        if Polygon(ring).exterior.is_ccw is False:
            ring = ring[::-1]
        inner = g.buffer(-0.8)
        mask = rasterise([inner if not inner.is_empty else g], x0, y1, pnx, pny, ipx)
        roof = np.median(photo[mask], axis=0) if mask.any() else np.array([120, 110, 100])
        area = g.area
        eaves = cfg.get("eaves_m", 2.6 if area < 120 else 3.0)
        ridge = cfg.get("ridge_m", eaves + min(4.0, 0.9 + math.sqrt(area) * 0.18))
        gz = float(np.min([z[min(ny - 1, max(0, int((y1 - y) / cell))), min(nx - 1, max(0, int((x - x0) / cell)))] for x, y in ring]))
        blds.append({"ring": [[round(x, 2), round(y, 2)] for x, y in ring], "z": round(max(gz, 0.35), 2), "eaves_m": eaves, "ridge_m": round(ridge, 2),
                     "roof": "#%02x%02x%02x" % tuple(int(v) for v in roof), "wall": cfg.get("wall", "#ece8dc"),
                     **({"name": cfg["name"]} if "name" in cfg else ({"name": f["name"]} if f["name"] else {})), "source": f["record_id"]})
        solid.append(g.buffer(0.2))
    blocked = rasterise(solid, x0, y1, nx * 2, ny * 2, cell / 2)
    # the wharf: Overture's pier polygon nearest the terminal, as a deck (a strip surface) and its berth
    surfaces, wharf = [], None
    if "wharf" in o:
        w = o["wharf"]
        term = C.to_local(Point(*w["terminal"]))
        infra = overture(C, "infrastructure", o["bbox"], f"{o['id']}_infrastructure")
        piers = [f["geom"] for f in infra if f["class"] == "pier"]
        polys = [p for p in piers if p.geom_type == "Polygon"]
        lines = [p for p in piers if p.geom_type == "LineString"]
        deck = min(polys, key=lambda p: p.distance(term)) if polys else min(lines, key=lambda p: p.distance(term)).buffer(2.0, cap_style=2)
        rect = deck.minimum_rotated_rectangle
        cs = list(rect.exterior.coords)[:4]
        e1, e2 = np.subtract(cs[1], cs[0]), np.subtract(cs[2], cs[1])
        long_, short = (e1, e2) if np.linalg.norm(e1) >= np.linalg.norm(e2) else (e2, e1)
        L, W = float(np.linalg.norm(long_)), float(np.linalg.norm(short))
        ax = long_ / L
        c = np.array(rect.centroid.coords[0])
        # the axis points from the shore out into the lake
        a_end, b_end = c - ax * L / 2, c + ax * L / 2
        def wet(p):
            return bool(water[min(ny - 1, max(0, int((y1 - p[1]) / cell))), min(nx - 1, max(0, int((p[0] - x0) / cell)))])
        if wet(a_end) and not wet(b_end):
            ax = -ax
        deck_z = float(o.get("deck_m", 1.3))
        surfaces.append({"name": f"{w['name']} wharf", "type": "strip", "origin": [round(c[0], 2), round(c[1], 2)], "axis": [round(ax[0], 5), round(ax[1], 5)],
                         "half_width": round(max(W, 3.0) / 2, 2), "profile": [[round(-L / 2, 2), deck_z], [round(L / 2, 2), deck_z]],
                         "thickness": 0.4, "drape": False, "fly_under": False, "label": f"the {w['name']} wharf", "outpost": o["id"], "timber": True})
        # the berth: alongside the deck's outer half, a beam and a half off its side, on the side with more water
        side = np.array([-ax[1], ax[0]])
        def clear_at(p):
            r, k = int((y1 - p[1]) / cell), int((p[0] - x0) / cell)
            return off[r, k] if 0 <= r < ny and 0 <= k < nx else 0
        cand = [c + ax * (L / 4) + side * s * (W / 2 + 6.0) for s in (1, -1)]
        berth = max(cand, key=clear_at)
        wharf = {"id": w["id"], "name": w["name"], "terminal": [round(term.x, 1), round(term.y, 1)], "berth": [round(float(berth[0]), 1), round(float(berth[1]), 1)],
                 "dist_m": round(float(np.hypot(berth[0] - term.x, berth[1] - term.y)), 1), "outpost": o["id"]}
    meta = {"id": o["id"], "name": o["name"], "x0": x0, "y1": y1, "nx": nx, "ny": ny, "cell": cell, "band_m": o.get("band_m", BAND_M),
            "z": b64(np.round(z * 100).astype(np.int16)), "water": bits(water), "blocked": bits(blocked), "image": name,
            "buildings": blds, "sources": {"terrain": tc.get("name", tc["collection"]), "imagery": im.get("name", im["collection"]),
                                           "features": f"Overture Maps {C.cfg['overture_release']} (OpenStreetMap and others; ODbL)"}}
    print(f"outpost {o['id']}: {nx} x {ny} cells of {cell} m, water {water.mean() * 100:.0f}%, {len(blds)} buildings, photo {pnx} x {pny} px"
          + (f", berth {wharf['berth']}" if wharf else ""))
    return meta, surfaces, wharf, water


def route_leg(C, G, outs, a, b, lake_polys, frame):
    """A ferry leg from berth a to berth b over the frame's water, the lake past it and an outpost's water:
    the shortest way that keeps off the shore (CLEAR_M out on the lake), on a ROUTE_CELL grid; then
    string-pulled and smoothed as game_data.py's legs are. Returns (points, length, min clearance)."""
    xs = [a[0], b[0], frame[0], frame[1]] + [o[0]["x0"] for o in outs] + [o[0]["x0"] + o[0]["nx"] * o[0]["cell"] for o in outs]
    ys = [a[1], b[1], frame[2], frame[3]] + [o[0]["y1"] for o in outs] + [o[0]["y1"] - o[0]["ny"] * o[0]["cell"] for o in outs]
    gx0, gx1 = math.floor(min(xs) / ROUTE_CELL) * ROUTE_CELL - 200, math.ceil(max(xs) / ROUTE_CELL) * ROUTE_CELL + 200
    gy0, gy1 = math.floor(min(ys) / ROUTE_CELL) * ROUTE_CELL - 200, math.ceil(max(ys) / ROUTE_CELL) * ROUTE_CELL + 200
    nx, ny = int((gx1 - gx0) / ROUTE_CELL), int((gy1 - gy0) / ROUTE_CELL)
    wet = rasterise(lake_polys, gx0, gy1, nx, ny, ROUTE_CELL)
    # in the frame, the game's own 5 m mask; in an outpost, its own
    wm = G["water"]
    fb = np.unpackbits(np.frombuffer(base64.b64decode(wm["bits"]), np.uint8))[: wm["nx"] * wm["ny"]].reshape(wm["ny"], wm["nx"]).astype(bool)
    cx = gx0 + (np.arange(nx) + 0.5) * ROUTE_CELL
    cy = gy1 - (np.arange(ny) + 0.5) * ROUTE_CELL
    X, Y = np.meshgrid(cx, cy)
    inF = (X > frame[0]) & (X < frame[1]) & (Y > frame[2]) & (Y < frame[3])
    fc = np.clip(((X - frame[0]) / wm["cell"]).astype(int), 0, wm["nx"] - 1)
    fr = np.clip(((frame[3] - Y) / wm["cell"]).astype(int), 0, wm["ny"] - 1)
    wet = np.where(inF, fb[fr, fc], wet)
    for meta, water in outs:
        inO = (X > meta["x0"]) & (X < meta["x0"] + meta["nx"] * meta["cell"]) & (Y < meta["y1"]) & (Y > meta["y1"] - meta["ny"] * meta["cell"])
        oc = np.clip(((X - meta["x0"]) / meta["cell"]).astype(int), 0, meta["nx"] - 1)
        orr = np.clip(((meta["y1"] - Y) / meta["cell"]).astype(int), 0, meta["ny"] - 1)
        wet = np.where(inO, water[orr, oc], wet)
    clear = ndimage.distance_transform_edt(wet) * ROUTE_CELL
    cell = lambda x, y: (min(ny - 1, max(0, int((gy1 - y) / ROUTE_CELL))), min(nx - 1, max(0, int((x - gx0) / ROUTE_CELL))))
    rr, cc = np.nonzero(wet)
    idx = -np.ones(wet.shape, int)
    idx[rr, cc] = np.arange(len(rr))
    cost_cell = 1.0 + 300.0 / np.maximum(clear[rr, cc], 10.0)  # well off the shore out on the lake
    src, dst, wt = [], [], []
    for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
        r2, c2 = rr + dr, cc + dc
        ok = (r2 < ny) & (c2 >= 0) & (c2 < nx)
        j = np.full(len(rr), -1)
        j[ok] = idx[r2[ok], c2[ok]]
        ok = j >= 0
        d = math.hypot(dr, dc) * ROUTE_CELL
        src.append(np.nonzero(ok)[0]); dst.append(j[ok]); wt.append(d * 0.5 * (cost_cell[ok] + cost_cell[j[ok]]))
    src, dst, wt = np.concatenate(src), np.concatenate(dst), np.concatenate(wt)
    graph = coo_matrix((np.r_[wt, wt], (np.r_[src, dst], np.r_[dst, src])), shape=(len(rr), len(rr))).tocsr()

    def node(p):
        r0, c0 = cell(*p)
        if idx[r0, c0] >= 0:
            return idx[r0, c0]
        return int(np.argmin((rr - r0) ** 2 + (cc - c0) ** 2))
    s, t = node(a), node(b)
    _, pred = dijkstra(graph, indices=s, return_predecessors=True)
    path, k = [], t
    while k != s and k >= 0:
        path.append(k)
        k = pred[k]
    if k < 0:
        raise SystemExit(f"no water route between {a} and {b}")
    pts = [tuple(a)] + [(gx0 + (cc[k] + 0.5) * ROUTE_CELL, gy1 - (rr[k] + 0.5) * ROUTE_CELL) for k in [s] + path[::-1]] + [tuple(b)]

    def seg_clear(p, q, need):
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        return all(clear[cell(p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u)] >= need for u in np.linspace(0, 1, max(2, int(L / 5))))
    out, i = [pts[0]], 0
    while i < len(pts) - 1:
        j = len(pts) - 1
        need = lambda i, j: CLEAR_M if 30 < i and j < len(pts) - 30 else 10.0
        while j > i + 1 and not seg_clear(pts[i], pts[j], need(i, j)):
            j -= 1
        out.append(pts[j])
        i = j
    dense = [out[0]]
    for p, q in zip(out[:-1], out[1:]):
        k = max(1, int(math.hypot(q[0] - p[0], q[1] - p[1]) / 20))
        dense += [(p[0] + (q[0] - p[0]) * u / k, p[1] + (q[1] - p[1]) * u / k) for u in range(1, k + 1)]
    sm = dense
    for _ in range(3):
        nxt = [sm[0]]
        for p, q in zip(sm[:-1], sm[1:]):
            nxt += [(0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]), (0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1])]
        nxt.append(sm[-1])
        sm = nxt
    line = LineString(sm)
    n = max(2, int(line.length / 5))
    res = [line.interpolate(k / n, normalized=True) for k in range(n + 1)]
    inner = [clear[cell(p.x, p.y)] for p in res if min(p.distance(Point(a)), p.distance(Point(b))) > 60]
    return [[round(p.x, 1), round(p.y, 1)] for p in res], round(line.length, 1), float(min(inner) if inner else 0.0)


def apply(C, out):
    """Add the city's outposts to a game.json dict `out` (from game_data.py, or the built file): the
    outposts, their wharves' decks as surfaces, the wharves, and the ferry legs that call there."""
    cfgs = C.cfg.get("game", {}).get("outposts", [])
    if not cfgs:
        return out
    G = out
    frame = [C.x0, C.x1, C.y0, C.y1]
    # the lakes past the frame: Overture's water over the box from the frame to every outpost
    lon, lat = C.inv.transform([C.x0, C.x1], [C.y0, C.y1])
    bb = [min(lon + [o["bbox"][0] for o in cfgs]), min(lat + [o["bbox"][1] for o in cfgs]), max(lon + [o["bbox"][2] for o in cfgs]), max(lat + [o["bbox"][3] for o in cfgs])]
    lakes = [f["geom"] for f in overture(C, "water", bb, "corridor_water") if f["class"] in ("lake", "reservoir", "bay", "ocean", "sea", "strait")
             and f["geom"].geom_type in ("Polygon", "MultiPolygon")]
    built = [build_one(C, o, lakes) for o in cfgs]
    out["outposts"] = [m for m, _, _, _ in built]
    out["surfaces"] = [s for s in out.get("surfaces", []) if not s.get("outpost")] + [s for _, ss, _, _ in built for s in ss]
    wharves = {w["id"]: w for w in out.get("wharves", []) if not w.get("outpost")}
    for _, _, w, _ in built:
        if w:
            wharves[w["id"]] = w
    keep = [w["id"] for w in C.cfg["game"].get("wharves", [])]
    out["wharves"] = [wharves[k] for k in keep if k in wharves]
    oids = {w["id"] for _, _, w, _ in built if w}
    outs = [(m, water) for m, _, _, water in built]
    ferries = []
    for f in C.cfg["game"].get("ferries", []):
        stops = [s for s in f["stops"] if s in wharves]
        old = next((x for x in out.get("ferries", []) if x["route"] == f["route"]), None)
        legs = []
        for a, b in zip(stops[:-1], stops[1:]):
            prev = old and next((l for l in old["legs"] if l["from"] == a and l["to"] == b), None)
            if prev and a not in oids and b not in oids:
                legs.append(prev)
                continue
            pts, length, worst = route_leg(C, G, outs, wharves[a]["berth"], wharves[b]["berth"], lakes, frame)
            legs.append({"from": a, "to": b, "length_m": length, "min_clearance_m": worst, "path": pts})
            print(f"  {f['route']}: {a} -> {b}: {length:.0f} m past the frame, min clearance {worst:.0f} m")
        ferries.append({"route": f["route"], "stops": stops, "vessels": f.get("vessels", ["Ferry"]), "legs": legs})
    out["ferries"] = ferries
    return out


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    path = os.path.join(C.out, "game.json")
    G = json.load(open(path))
    apply(C, G)
    for k in ("ferry_note", "ferry_speed_ms", "ferry_dwell_s"):
        if k in C.cfg["game"]:
            G[k] = C.cfg["game"][k]
    json.dump(G, open(path, "w"), separators=(",", ":"))
    print(f"{path}: {os.path.getsize(path) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
