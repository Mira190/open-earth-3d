"""A landmark's massing measured by airborne LiDAR: its footprint cut into zones by roof level, each
with its measured height, for a landmark hook to build on (the landmark's own outline and the open
data's single height cannot show a stepped section: a wing with a lower gallery along it, a pavilion
an attic higher than the body).

A city lists the footprints in cities/<id>/city.py as massing_footprints() -> {name: [ring [(lon, lat)],
...]} (or {name: {"rings": [...], "grow_m": m}}, to let a footprint take in the flat roofs beside it); this reads a surface model (first returns) and the bare earth over each footprint, finds the
roof levels that cover enough of it (peaks of the height histogram), gives every cell the nearest one,
cleans the labels and writes cities/<id>/massing.json:

  {name: {"source", "fetched", "zones": [{"z": roof (scene datum), "ground": bare earth under it,
          "area_m2", "rings": [[(lon, lat), ...], ...]}, ...]}}

It also surveys the solids whose height the build could only guess (an estimate from their neighbours or
an ML height, where the survey had no roof to measure) and lists those where the laser sees bare ground
under the whole footprint, as "absent": [[lon, lat, area m²], ...] (a basin's coping or a garden's
paving mapped as a building and given 10.8 m). A city drops them with absent_solids() in its
landmark_demolished hook.

Sources: France's IGN LiDAR HD (MNS and MNT, Licence Ouverte / Etalab 2.0) where the city has an
"ign" block; other cities can add their own surface model here.

    python pipeline/lidar_massing.py --city paris
"""
import json
import os
import time

import numpy as np
import shapely
from PIL import Image
from pyproj import Transformer
from scipy import ndimage
from shapely.geometry import Polygon, box

import fetch_ign
from cityctx import city_args

SOURCE = "IGN LiDAR HD surface (MNS) and bare-earth (MNT) models at 0.5 m, Licence Ouverte / Etalab 2.0"
CELL = 0.5      # m: the surface model's pixel
MIN_ZONE = 25.0  # m²: a level must cover this much of the footprint to be a zone of its own
STEP = 1.6       # m: roof levels closer than this are one level


def levels(z, min_cells):
    """The roof levels of an array of heights: the peaks of its 0.2 m histogram (smoothed), merged
    when closer than STEP, kept when they cover min_cells."""
    lo, hi = np.floor(z.min()), np.ceil(z.max()) + 0.2
    h, e = np.histogram(z, bins=np.arange(lo, hi + 0.2, 0.2))
    hs = ndimage.gaussian_filter1d(h.astype(float), 2.0)
    peaks = [i for i in range(1, len(hs) - 1) if hs[i] >= hs[i - 1] and hs[i] > hs[i + 1]]
    peaks.sort(key=lambda i: -hs[i])
    out = []
    for i in peaks:
        c = (e[i] + e[i + 1]) / 2
        if all(abs(c - o) >= STEP for o in out):
            out.append(c)
    # the cells each level would take, and drop those too small to stand alone
    while True:
        lab = np.argmin(np.abs(z[:, None] - np.array(out)[None]), axis=1)
        n = np.bincount(lab, minlength=len(out))
        if n.min() >= min_cells or len(out) == 1:
            return np.array(out)
        out.pop(int(np.argmin(n)))


def zones(name, rings_ll, mns_fetch, datum, frame, grow=0.0):
    """The zones of one footprint: [{z, ground, area_m2, rings}] in lon/lat (frame: the city's local
    transverse Mercator, where the cells are laid out in metres). grow: metres the footprint may grow
    into the flat roofs that adjoin it (a mapped outline that leaves out part of a pavilion); a roof is
    flat where its 1.5 m neighbourhood varies by less than 0.3 m, which a tree's crown never does."""
    fwd = Transformer.from_crs("EPSG:4326", frame, always_xy=True)
    inv = Transformer.from_crs(frame, "EPSG:4326", always_xy=True)
    foot = shapely.union_all([Polygon([fwd.transform(*p) for p in r]).buffer(0) for r in rings_ll])
    pad = 2 + grow
    x0, y0, x1, y1 = foot.bounds
    x0, y0 = np.floor(x0) - pad, np.floor(y0) - pad
    nx, ny = int(np.ceil((x1 + pad - x0) / CELL)), int(np.ceil((y1 + pad - y0) / CELL))
    xs, ys = x0 + (np.arange(nx) + 0.5) * CELL, y0 + (np.arange(ny) + 0.5) * CELL
    X, Y = np.meshgrid(xs, ys)
    surf, bare = mns_fetch(X, Y)
    surf, bare = surf - datum, bare - datum
    inside = shapely.contains_xy(foot.buffer(-0.4), X, Y)
    if grow > 0:
        m1, m2 = ndimage.uniform_filter(surf, 3), ndimage.uniform_filter(surf * surf, 3)
        flat = (np.sqrt(np.maximum(m2 - m1 * m1, 0)) < 0.3) & (surf - bare > 6.0)
        near = shapely.contains_xy(foot.buffer(grow), X, Y)
        # the flat cells connected to the footprint, then closed over the parapets and lanterns between them
        lab, _ = ndimage.label((flat & near) | inside)
        keep = np.unique(lab[inside & (lab > 0)])
        add = ndimage.binary_closing(np.isin(lab, keep) & near, iterations=3) & near
        cells = [box(xs[c] - CELL / 2, ys[r] - CELL / 2, xs[c] + CELL / 2, ys[r] + CELL / 2) for r, c in zip(*np.nonzero(add & ~inside))]
        if cells:
            extra = shapely.union_all(cells).buffer(0.5, join_style="mitre").buffer(-1.0, join_style="mitre").buffer(0.5, join_style="mitre")
            foot = shapely.union_all([foot, extra]).buffer(0)
        inside = shapely.contains_xy(foot.buffer(-0.4), X, Y)
    # a cell less than 2.5 m over the bare earth is an open court (or a tree's gap), not a roof
    roofed = inside & (surf - bare > 2.5)
    lv = levels(surf[roofed], MIN_ZONE / CELL ** 2)
    lab = np.full(surf.shape, -1)
    lab[roofed] = np.argmin(np.abs(surf[roofed][:, None] - lv[None]), axis=1)
    # clean the labels: each cell takes its 5 x 5 neighbourhood's most common level (edges, parapets, lanterns)
    clean = lab.copy()
    for k in range(len(lv)):
        cnt = ndimage.uniform_filter((lab == k).astype(float), 5)
        if k == 0:
            best, bestc = np.zeros_like(cnt, int), cnt
        else:
            m = cnt > bestc
            best[m], bestc[m] = k, cnt[m]
    clean[roofed] = best[roofed]
    out = []
    for k, z in enumerate(lv):
        m = clean == k
        if m.sum() * CELL ** 2 < MIN_ZONE:
            continue
        cells = [box(xs[c] - CELL / 2, ys[r] - CELL / 2, xs[c] + CELL / 2, ys[r] + CELL / 2) for r, c in zip(*np.nonzero(m))]
        g = shapely.union_all(cells).buffer(0.6, join_style="mitre").buffer(-0.6, join_style="mitre")
        g = g.intersection(foot).simplify(0.6)
        polys = [p for p in getattr(g, "geoms", [g]) if p.geom_type == "Polygon" and p.area >= MIN_ZONE / 2]
        if not polys:
            continue
        zr = float(np.median(surf[m]))
        out.append({"z": round(zr, 1), "ground": round(float(np.percentile(bare[m], 5)), 1),
                    "area_m2": round(sum(p.area for p in polys)),
                    "rings": [[[round(v, 7) for v in inv.transform(*c)] for c in p.exterior.coords][:-1] for p in polys]})
    out.sort(key=lambda q: q["z"])
    print(f"  {name}: {len(out)} zones, roofs at " + ", ".join(f"{q['z']:.1f} m ({q['area_m2']} m²)" for q in out))
    return out


def ign_fetcher(C, rings_ll, tmp, pad_deg=0.0002):
    """Sample IGN LiDAR HD's MNS and MNT at 0.5 m over the footprints' bbox (Lambert-93)."""
    lon = [p[0] for r in rings_ll for p in r]
    lat = [p[1] for r in rings_ll for p in r]
    bb = fetch_ign.lambert_bbox([min(lon), min(lat), max(lon), max(lat)], pad_deg=pad_deg)
    rasters = {}
    for key in ("mns", "mnt"):
        path = os.path.join(tmp, f"massing_{key}.tif")
        got, size = fetch_ign.wms_bil(fetch_ign.LIDAR[key], "EPSG:2154", bb, CELL, path)
        rasters[key] = (np.asarray(Image.open(path)), got)
    to_l93 = Transformer.from_crs(C.proj, "EPSG:2154", always_xy=True)

    def sample(X, Y):
        E, N = to_l93.transform(X, Y)
        res = []
        for key in ("mns", "mnt"):
            a, (gx0, gy0, gx1, gy1) = rasters[key]
            c = np.clip(((E - gx0) / CELL).astype(int), 0, a.shape[1] - 1)
            r = np.clip(((gy1 - N) / CELL).astype(int), 0, a.shape[0] - 1)
            res.append(a[r, c].astype(float))
        return res
    return sample


def survey_absent(C):
    """Solids of the built city with a guessed height ("estimate", "ml") where the surface model stands
    within 1 m of the bare earth over the footprint: [[lon, lat, area m²], ...] of their centroids."""
    import archkit as ak
    from concurrent.futures import ThreadPoolExecutor
    B = json.load(open(os.path.join(C.out, "buildings.json")))
    inv = Transformer.from_crs(C.proj, "EPSG:4326", always_xy=True)
    to_l93 = Transformer.from_crs(C.proj, "EPSG:2154", always_xy=True)
    guessed = [s for s in ak.load_solids(C.id) if B["b"][B["s"][s["si"]][0]][4] in ("estimate", "ml")]

    def one(s):
        P = Polygon(s["ring"]).buffer(0)
        core = P.buffer(-0.5) if P.buffer(-0.5).area > 2 else P
        x0, y0, x1, y1 = P.bounds
        E, N = to_l93.transform([x0 - 1, x1 + 1, x0 - 1, x1 + 1], [y0 - 1, y0 - 1, y1 + 1, y1 + 1])
        bb = [min(E), min(N), max(E), max(N)]
        d = {}
        for key in ("mns", "mnt"):
            tmp = os.path.join(C.raw, f"absent_{s['si']}_{key}.tif")
            got, _ = fetch_ign.wms_bil(fetch_ign.LIDAR[key], "EPSG:2154", bb, CELL, tmp)
            d[key] = (np.asarray(Image.open(tmp)).astype(float), got)
            os.remove(tmp)
        xs, ys = np.meshgrid(np.arange(x0, x1, CELL / 2), np.arange(y0, y1, CELL / 2))
        m = shapely.contains_xy(core, xs, ys)
        if not m.any():
            return None
        e, n = to_l93.transform(xs[m], ys[m])
        v = []
        for key in ("mns", "mnt"):
            a, (gx0, gy0, gx1, gy1) = d[key]
            v.append(a[np.clip(((gy1 - n) / CELL).astype(int), 0, a.shape[0] - 1), np.clip(((e - gx0) / CELL).astype(int), 0, a.shape[1] - 1)])
        h = v[0] - v[1]
        if np.median(h) < 1.0 and np.percentile(h, 90) < 2.0:
            lon, lat = inv.transform(*ak.ring_centroid(s["ring"]))
            return [round(lon, 7), round(lat, 7), round(P.area)]
        return None

    with ThreadPoolExecutor(4) as ex:
        got = [g for g in ex.map(one, guessed) if g]
    print(f"  {len(got)} of {len(guessed)} solids with a guessed height stand on bare ground")
    return got


def absent_solids(city_id, tol_m=1.0):
    """The built city's solids the LiDAR survey found absent (massing.json "absent"), as solid indices."""
    import archkit as ak
    import cityctx
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cities", city_id, "massing.json")
    if not os.path.exists(path):
        return []
    gone = json.load(open(path)).get("absent", {}).get("solids", [])
    if not gone:
        return []
    C = cityctx.City(city_id)
    pts = [C.fwd.transform(lon, lat) + (a,) for lon, lat, a in gone]
    out = []
    for s in ak.load_solids(city_id):
        cx, cy = ak.ring_centroid(s["ring"])
        if any(abs(cx - x) < tol_m and abs(cy - y) < tol_m and abs(abs(ak.ring_area(s["ring"])) - a) <= max(2.0, 0.1 * a) for x, y, a in pts):
            out.append(s["si"])
    return out


def main():
    C, a = city_args(__doc__.splitlines()[0], lambda ap: ap.add_argument("--only", choices=["massing", "absent"]))
    hook = C.hook("massing_footprints")
    if not hook:
        raise SystemExit(f"{C.id}: no massing_footprints() in cities/{C.id}/city.py")
    if not C.cfg.get("ign"):
        raise SystemExit(f"{C.id}: only IGN LiDAR HD is wired up so far")
    C.ensure_dirs()
    path = os.path.join(os.path.dirname(C.file("city.json")), "massing.json")
    out = json.load(open(path)) if os.path.exists(path) else {}
    for name, spec in (hook().items() if a.only != "absent" else ()):
        rings, grow = (spec["rings"], spec.get("grow_m", 0.0)) if isinstance(spec, dict) else (spec, 0.0)
        sample = ign_fetcher(C, rings, C.raw, pad_deg=0.0002 + grow / 70000)
        out[name] = {"source": SOURCE, "fetched": time.strftime("%Y-%m-%d"),
                     "zones": zones(name, rings, sample, C.cfg.get("datum_offset_m", 0.0), C.proj, grow)}
    if a.only != "massing":
        out["absent"] = {"source": SOURCE, "fetched": time.strftime("%Y-%m-%d"),
                         "solids": survey_absent(C)}
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"-> {path}")


if __name__ == "__main__":
    main()
