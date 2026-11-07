"""The Shuto Expressway's deck heights from Tokyo's airborne LiDAR, where no drawing gives them: Edobashi JCT,
the Inner Circular Route (C1) west along the Nihonbashi River to Kandabashi JCT, and Route 1 north out of
Edobashi, as far as the map reaches.

Source: 東京都デジタルツイン実現プロジェクト 区部点群データ (Tokyo Metropolitan Government, 2023 survey,
published 2024 on G空間情報センター as `tokyopc-23ku-2024`), CC BY 4.0. Each sheet of the 1:500 map grid
(400 x 300 m, JGD2011 plane zone IX, heights T.P.) is a LAS file of about 50 points/m^2. Only the sheets under the
expressway are fetched: their index is the dataset's vector tiles (Vectortile/23ku/lp, a polygon per sheet with
its download URL).

    python cities/tokyo/shuto_lidar.py            fetch the sheets (data/raw/tokyo/lidar), keep the points within
                                                  14 m of the expressway, measure, write shuto_lidar.json
    python cities/tokyo/shuto_lidar.py --measure  measure again from the kept points

The measure: along each elevated motorway line of game.json (its plan; its heights are the data's levels, 6 m a
level, which stand 6-8 m over the real decks here), every STEP metres, the points within R_ALONG metres along the
line and HALF_SPAN across it, from LOW over the ground to HIGH over the line's data height, ground returns left out.
The road's surface is the densest 0.25 m layer there (of two near-equal layers the lower: a lorry's roof stands over
the road); its height is the median of the points within 0.3 m of that layer. Vehicles are sparse, the parapets
narrow, the river returns little. A sample with fewer than MIN_N points in the layer, or more than JUMP metres off
its neighbours, is dropped and the line interpolated over it. Where two lines pass one over the other (Edobashi
JCT), the airborne scanner saw only the upper deck: a line the data puts lower but which measures the same as a
line over it takes the upper deck's height less the data's difference between them (n = -1).

shuto_lidar.json keeps [x, y, road z T.P., n, data z] samples in the local frame; cities/tokyo/shuto.py reads them
for the stretch over Nihonbashi and puts game.json's expressway lines on them (decks.js draws those viaducts).
The LiDAR's ground returns agree with the game's terrain grid near the lines (median 0.00 m, quartiles -0.07 and
+0.10 m), so both are T.P.
"""
import gzip
import json
import math
import os
import subprocess
import sys
import zipfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
RAW = os.path.join(ROOT, "data", "raw", "tokyo", "lidar")
OUT = os.path.join(HERE, "shuto_lidar.json")
INDEX = "https://gic-tokyo.s3.ap-northeast-1.amazonaws.com/2024/dig/Vectortile/23ku/lp/14/{x}/{y}.pbf"
REGION = (150.0, 1500.0)       # the elevated lines east of x and north of y (local m): Kandabashi to Edobashi and on
KEEP_M = 14.0                  # points kept within this of a line, in plan
STEP = 6.0                     # m between samples
R_ALONG = 3.0
HALF_SPAN = 2.5                # across: about a lane either side of the centre line
LOW = 3.0                      # m over the ground under the line
HIGH = 2.5                     # m over the line's data height
MIN_N = 25
JUMP = 1.5
DATA_STEP = 5.0                # m: the data puts the other line about a level (6 m) over it
OVER_RUN = 9.0                 # m: a run of samples this near another line's (the decks side by side or crossing)
MAX_GRADE = 0.12               # rise over run between samples of one deck at most
OVER = 3.5                     # m, in plan: a line this near another (decks overlapping), under it
MIN_AREA = 0.01                # a sheet must hold this share of the lines' buffer to be fetched


def lines():
    """The elevated motorway lines of game.json in the region: [(N, 3) array] in the local frame."""
    g = json.load(open(os.path.join(ROOT, "web", "data", "tokyo", "game.json"), encoding="utf8"))
    out = []
    for o in g["paths"]["road"]:
        if o["c"] != "motorway":
            continue
        p = np.asarray(o["p"], float).reshape(-1, 3) / 10
        m = (p[:, 2] > 8) & (p[:, 0] > REGION[0]) & (p[:, 1] > REGION[1])
        if m.sum() >= 2:
            out.append(p[m])
    return out


def city():
    sys.path.insert(0, os.path.join(ROOT, "pipeline"))
    import cityctx
    return cityctx.City("tokyo")


def sheets(C, L):
    """The 1:500 sheets under the lines: {mesh: url}."""
    import mapbox_vector_tile as mvt
    import shapely
    from shapely.geometry import LineString, Polygon
    U = shapely.union_all([LineString(np.column_stack(C.inv.transform(p[:, 0], p[:, 1]))).buffer(0.00015) for p in L])
    n = 2 ** 14
    tile = lambda lon, lat: (int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))
    x0, y1 = tile(*U.bounds[:2])
    x1, y0 = tile(*U.bounds[2:])
    found = {}
    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            b = subprocess.run(["curl", "-sS", "-m", "60", INDEX.format(x=tx, y=ty)], capture_output=True, check=True).stdout
            try:
                b = gzip.decompress(b)
            except OSError:
                pass
            for layer in mvt.decode(b).values():
                ext = layer.get("extent", 4096)
                for ft in layer["features"]:
                    ring = []
                    for X, Y in ft["geometry"]["coordinates"][0]:
                        yy = ty + (1 - Y / ext)
                        ring.append(((tx + X / ext) / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy / n))))))
                    P = Polygon(ring).buffer(0)
                    if P.intersection(U).area / U.area >= MIN_AREA:
                        found[ft["properties"]["MESH_NO"]] = ft["properties"]["URL"]
    return found


def fetch(C, L):
    """Each sheet's points within KEEP_M of a line, as data/raw/tokyo/lidar/<mesh>.npz (x, y, z local, class)."""
    import laspy
    import shapely
    from pyproj import Transformer
    from shapely.geometry import LineString
    os.makedirs(RAW, exist_ok=True)
    keep = shapely.union_all([LineString(p[:, :2]).buffer(KEEP_M) for p in L])
    shapely.prepare(keep)
    to_local = Transformer.from_crs("EPSG:6677", C.proj, always_xy=True)   # JGD2011 / Japan Plane Rectangular CS IX
    for mesh, url in sorted(sheets(C, L).items()):
        npz = os.path.join(RAW, mesh + ".npz")
        if os.path.exists(npz):
            continue
        zp = os.path.join(RAW, mesh + ".zip")
        print(f"{mesh}: fetching {url}")
        if not os.path.exists(zp):
            subprocess.run(["curl", "-sS", "-m", "1200", "--retry", "4", "-o", zp + ".part", url], check=True)
            os.rename(zp + ".part", zp)
        with zipfile.ZipFile(zp) as z:
            name = next(n for n in z.namelist() if n.lower().endswith(".las"))
            z.extract(name, RAW)
        las = laspy.read(os.path.join(RAW, name))
        x, y = to_local.transform(np.asarray(las.x), np.asarray(las.y))
        z, cls = np.asarray(las.z), np.asarray(las.classification)
        bx = keep.bounds
        m = (x > bx[0]) & (x < bx[2]) & (y > bx[1]) & (y < bx[3])
        idx = np.nonzero(m)[0]
        inside = shapely.contains_xy(keep, x[idx], y[idx])
        idx = idx[inside]
        np.savez_compressed(npz, x=x[idx].astype(np.float32), y=y[idx].astype(np.float32), z=z[idx].astype(np.float32), c=cls[idx])
        os.remove(zp)
        os.remove(os.path.join(RAW, name))
        print(f"  {len(idx)} of {len(x)} points kept")


def terrain():
    """game.json's terrain grid as a function (x, y) -> z."""
    import base64
    g = json.load(open(os.path.join(ROOT, "web", "data", "tokyo", "game.json"), encoding="utf8"))
    t = g["terrain"]
    T = np.frombuffer(base64.b64decode(t["data"]), "<i2").reshape(t["ny"], t["nx"]) * t["scale"]
    C = json.load(open(os.path.join(HERE, "city.json"), encoding="utf8"))
    x0, _, _, y1 = C["extent_m"]
    cell = t["cell"]
    return lambda x, y: float(T[int(np.clip(round((y1 - y) / cell), 0, t["ny"] - 1)), int(np.clip(round((x - x0) / cell), 0, t["nx"] - 1))])


def fits(zs, j):
    """Does sample j sit on its own line's run, within JUMP of its measured neighbours' median? (Two lines merging
    meet at one height whatever the data says, and are not one over the other.)"""
    nb = np.concatenate([zs[max(0, j - 3):j], zs[j + 1:j + 4]])
    nb = nb[np.isfinite(nb)]
    return len(nb) >= 3 and abs(zs[j] - np.median(nb)) <= JUMP


def runs(line, zs):
    """The line's measured samples split where it would climb or fall steeper than MAX_GRADE between them."""
    idx = [i for i in range(len(zs)) if np.isfinite(zs[i])]
    out = []
    for i in idx:
        if out:
            j = out[-1][-1]
            d = math.hypot(line[i][0] - line[j][0], line[i][1] - line[j][1])
            if abs(zs[i] - zs[j]) <= MAX_GRADE * max(d, STEP):
                out[-1].append(i)
                continue
        out.append([i])
    return out


def occluded(raw):
    """Where a line passes under another, the scanner saw the upper deck. Two cases:
    - a run of the line's samples (split where it would be steeper than MAX_GRADE) that mostly measures the same as
      samples within OVER_RUN of a line the data puts DATA_STEP m or more higher, when the line has other runs: the
      run is dropped and the line interpolated over it from those;
    - otherwise a sample measuring the same as a sample within OVER of such a line, unless it sits on its own line's
      run: it takes that deck's height less the data's difference between the two lines (and n = -1)."""
    from scipy.spatial import cKDTree
    flat = [(i, j) for i, (_, line, zs) in enumerate(raw) for j in range(len(line)) if np.isfinite(zs[j])]
    T = cKDTree([raw[i][1][j][:2] for i, j in flat])

    def over(i, j, r):
        q, zq = raw[i][1][j], raw[i][2][j]
        for k in T.query_ball_point(q[:2], r):
            i2, j2 = flat[k]
            o, zo = raw[i2][1][j2], raw[i2][2][j2]
            if i2 != i and o[4] - q[4] >= DATA_STEP and abs(zo - zq) < 0.6 and o[3] != -1:
                return o, zo
        return None

    dropped = 0
    for i, (_, line, zs) in enumerate(raw):
        rs = runs(line, zs)
        if len(rs) < 2:
            continue
        bad = [r for r in rs if sum(over(i, j, OVER_RUN) is not None for j in r) >= 0.5 * len(r)]
        if len(bad) < len(rs):
            for r in bad:
                for j in r:
                    zs[j] = np.nan
                dropped += len(r)
    n = 0
    for i, (_, line, zs) in enumerate(raw):
        for j in range(len(line)):
            if not np.isfinite(zs[j]):
                continue
            hit = over(i, j, OVER)
            if hit and not fits(zs, j):
                o, zo = hit
                zs[j], line[j][3] = zo - (o[4] - line[j][4]), -1
                n += 1
    print(f"{dropped} samples in runs under another deck dropped, {n} under another deck from its height")


def measure(L):
    from scipy.spatial import cKDTree
    ground = terrain()
    parts = [np.load(os.path.join(RAW, f)) for f in sorted(os.listdir(RAW)) if f.endswith(".npz")]
    X = np.concatenate([np.column_stack([p["x"], p["y"]]) for p in parts]).astype(float)
    Z = np.concatenate([p["z"] for p in parts]).astype(float)
    C = np.concatenate([p["c"] for p in parts])
    tree = cKDTree(X)
    samples, lines_out, raw = [], [], []
    for p in L:
        seg = np.hypot(*np.diff(p[:, :2], axis=0).T)
        s = np.concatenate([[0], np.cumsum(seg)])
        if s[-1] < STEP:
            continue
        line = []
        for t in np.arange(0, s[-1] + 1e-6, STEP):
            k = min(int(np.searchsorted(s, t, side="right")) - 1, len(p) - 2)
            f = (t - s[k]) / max(seg[k], 1e-9)
            c = p[k] + (p[k + 1] - p[k]) * f
            ax = (p[k + 1, :2] - p[k, :2]) / max(seg[k], 1e-9)
            near = tree.query_ball_point(c[:2], math.hypot(R_ALONG, HALF_SPAN))
            if not near:
                line.append([c[0], c[1], None, 0, c[2]])
                continue
            near = np.asarray(near)
            d = X[near] - c[:2]
            u, v = d @ ax, d @ np.array([-ax[1], ax[0]])
            g = max(ground(c[0], c[1]), 1.0)   # over the river the grid is its bed: the water stands about T.P. 1 m
            sel = near[(np.abs(u) <= R_ALONG) & (np.abs(v) <= HALF_SPAN) & (Z[near] >= g + LOW) & (Z[near] <= c[2] + HIGH) & (C[near] != 2)]
            if len(sel) < MIN_N:
                line.append([c[0], c[1], None, int(len(sel)), c[2]])
                continue
            z = Z[sel]
            h, e = np.histogram(z, bins=np.arange(z.min() - 0.125, z.max() + 0.375, 0.25))
            # the road is the densest layer; of two near-equal layers, the lower (a truck's roof is above the road)
            top = h.max()
            k0 = int(np.nonzero(h >= 0.7 * top)[0][0])
            zm = (e[k0] + e[k0 + 1]) / 2
            lay = z[np.abs(z - zm) <= 0.3]
            line.append([c[0], c[1], float(np.median(lay)) if len(lay) >= MIN_N else None, int(len(lay)), c[2]])
        # drop jumps against the neighbours' median, then fill by interpolation along the line
        zs = np.array([q[2] if q[2] is not None else np.nan for q in line], float)
        for i in range(len(zs)):
            nb = zs[max(0, i - 3):i + 4]
            nb = nb[np.isfinite(nb)]
            if np.isfinite(zs[i]) and len(nb) >= 3 and abs(zs[i] - np.median(nb)) > JUMP:
                zs[i] = np.nan
        raw.append((p, line, zs))
    occluded(raw)
    for p, line, zs in raw:
        ok = np.isfinite(zs)
        if ok.sum() < 2:
            continue
        idx = np.arange(len(zs))
        # interpolated between measured samples, never under the ground (over the river, the water) less LOW; the
        # unmeasured ends are left out (shuto.py brings a line from its last sample to where it meets the ground)
        filled = np.maximum(np.interp(idx, idx[ok], zs[ok]), [max(ground(q[0], q[1]), 1.0) + LOW for q in line])
        i0, i1 = int(idx[ok][0]), int(idx[ok][-1])
        samples += [[round(q[0], 1), round(q[1], 1), round(float(zz), 2), (int(q[3]) if q[3] != -1 else -1) if o else 0, round(float(q[4]), 2)]
                    for q, zz, o in list(zip(line, filled, ok))[i0:i1 + 1]]
        lines_out.append({"from": [round(float(p[0, 0]), 1), round(float(p[0, 1]), 1)], "to": [round(float(p[-1, 0]), 1), round(float(p[-1, 1]), 1)],
                          "measured": int((ok & np.array([q[3] != -1 for q in line])).sum()), "under": int(sum(q[3] == -1 for q in line)), "of": len(zs),
                          "data_z": [round(float(min(q[4] for q in line)), 1), round(float(max(q[4] for q in line)), 1)],
                          "lidar_z": [round(float(filled.min()), 1), round(float(filled.max()), 1)]})
    json.dump({"note": "The Shuto Expressway's road surface measured from 東京都デジタルツイン実現プロジェクト 区部点群データ "
               "(Tokyo Metropolitan Government, tokyopc-23ku-2024, CC BY 4.0) by cities/tokyo/shuto_lidar.py: samples "
               "[x, y, road z T.P., points in the road's layer (0: interpolated, -1: under another deck), the data's z] in the local frame.",
               "samples": samples, "lines": lines_out}, open(OUT, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    for q in lines_out:
        print(f"{q['from']} -> {q['to']}: {q['measured']}/{q['of']} measured, {q['under']} under a deck, data {q['data_z']} m, lidar {q['lidar_z']} m")
    print(f"{len(samples)} samples -> {OUT}")


if __name__ == "__main__":
    L = lines()
    if "--measure" not in sys.argv:
        fetch(city(), L)
    measure(L)
