"""The decks the airborne LiDAR sees over the Shuto's lines by the palace moats (#307): where the Inner Circular Route
dives into its tunnels (Chiyoda, Kasumigaseki) and the junctions stack ramps over it (Takebashi, Miyakezaka,
Daikancho), compare game.json's expressway lines with the layers of points over them.

Source: 東京都デジタルツイン実現プロジェクト 区部点群データ (tokyopc-23ku-2024, CC BY 4.0), the same sheets as
cities/tokyo/shuto_lidar.py. Only the sheets over AREAS are fetched; each area's points are kept in
data/raw/tokyo/lidar/moat_<area>.npz.

For every STEP metres of each motorway line in an area: the line's height in game.json, the ground (class 2), and the
layers of non-ground points within R metres in plan (heights with at least MIN_N points in a 0.25 m bin, merged
within 0.75 m), highest first. A line whose height is on none of the layers is either in a tunnel or a cutting (under
the ground or a deck) or off its deck.

    python3 tools/shuto_moat_layers.py            fetch (once) and print
    python3 tools/shuto_moat_layers.py --json F   also write the table to F
"""
import json
import os
import subprocess
import sys
import zipfile

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "cities", "tokyo"))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
RAW = os.path.join(ROOT, "data", "raw", "tokyo", "lidar")
AREAS = {   # local m [x0, y0, x1, y1]
    "takebashi": [-620, 2150, 220, 2420],
    "daikancho": [-1260, 2020, -620, 2250],
    "miyakezaka": [-1280, 820, -880, 1180],
    "hanzomon": [-1620, 980, -1420, 1320],
}
STEP, R, MIN_N = 12.0, 2.0, 12


def fetch():
    import laspy
    import shapely
    from pyproj import Transformer
    from shapely.geometry import box
    import shuto_lidar as SL
    C = SL.city()
    os.makedirs(RAW, exist_ok=True)
    to_local = Transformer.from_crs("EPSG:6677", C.proj, always_xy=True)
    for name, b in AREAS.items():
        out = os.path.join(RAW, f"moat_{name}.npz")
        if os.path.exists(out):
            continue
        ring = np.array(box(*b).exterior.coords)
        found = SL.sheets(C, [np.column_stack([ring, np.zeros(len(ring))])])
        X, Y, Z, K = [], [], [], []
        for mesh, url in sorted(found.items()):
            zp = os.path.join(RAW, mesh + ".zip")
            print(f"{name}: {mesh} {url}", flush=True)
            if not os.path.exists(zp):
                subprocess.run(["curl", "-sS", "-m", "1200", "--retry", "4", "-o", zp + ".part", url], check=True)
                os.rename(zp + ".part", zp)
            with zipfile.ZipFile(zp) as z:
                las_name = next(n for n in z.namelist() if n.lower().endswith(".las"))
                z.extract(las_name, RAW)
            las = laspy.read(os.path.join(RAW, las_name))
            x, y = to_local.transform(np.asarray(las.x), np.asarray(las.y))
            m = (x > b[0]) & (x < b[2]) & (y > b[1]) & (y < b[3])
            X.append(x[m]); Y.append(y[m]); Z.append(np.asarray(las.z)[m]); K.append(np.asarray(las.classification)[m])
            os.remove(os.path.join(RAW, las_name))
        np.savez_compressed(out, x=np.concatenate(X).astype(np.float32), y=np.concatenate(Y).astype(np.float32),
                            z=np.concatenate(Z).astype(np.float32), c=np.concatenate(K))
    for f in os.listdir(RAW):   # the sheets are shared between areas: drop them once every area is cut
        if f.endswith(".zip") and not f.startswith("moat_"):
            os.remove(os.path.join(RAW, f))


def layers(z):
    if len(z) < MIN_N:
        return []
    h, e = np.histogram(z, bins=np.arange(z.min() - 0.25, z.max() + 0.5, 0.25))
    peaks = [(e[i] + 0.125, h[i]) for i in range(len(h)) if h[i] >= MIN_N and h[i] == h[max(0, i - 2):i + 3].max()]
    out = []
    for zz, n in peaks:
        if out and zz - out[-1][0] < 0.75:
            if n > out[-1][1]:
                out[-1] = (zz, n)
            continue
        out.append((zz, n))
    return [(round(float(zz), 1), int(n)) for zz, n in sorted(out, key=lambda t: -t[0])]


def main():
    from scipy.spatial import cKDTree
    fetch()
    G = json.load(open(os.path.join(ROOT, "web", "data", "tokyo", "game.json"), encoding="utf8"))
    table = []
    for name, b in AREAS.items():
        d = np.load(os.path.join(RAW, f"moat_{name}.npz"))
        x, y, z, c = d["x"], d["y"], d["z"], d["c"]
        ng = c != 2
        T, Tg = cKDTree(np.column_stack([x[ng], y[ng]])), cKDTree(np.column_stack([x[~ng], y[~ng]]))
        zn, zg = z[ng], z[~ng]
        print(f"== {name}")
        for li, o in enumerate(G["paths"]["road"]):
            if o["c"] not in ("motorway", "motorway_link"):
                continue
            p = np.asarray(o["p"], float).reshape(-1, 3) / 10
            inb = (p[:, 0] > b[0]) & (p[:, 0] < b[2]) & (p[:, 1] > b[1]) & (p[:, 1] < b[3])
            if inb.sum() < 2:
                continue
            s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p[:, :2], axis=0).T))])
            print(f"  line {li} ({p[0, 0]:.0f}, {p[0, 1]:.0f}) -> ({p[-1, 0]:.0f}, {p[-1, 1]:.0f})")
            for t in np.arange(0, s[-1] + 0.1, STEP):
                q = np.array([np.interp(t, s, p[:, k]) for k in range(3)])
                if not (b[0] < q[0] < b[2] and b[1] < q[1] < b[3]):
                    continue
                gi = Tg.query_ball_point(q[:2], 4.0)
                g = float(np.median(zg[gi])) if gi else None
                L = layers(zn[T.query_ball_point(q[:2], R)])
                on = any(abs(zz - q[2]) < 1.0 for zz, _ in L)
                table.append({"area": name, "line": li, "s": round(float(t), 1), "x": round(float(q[0]), 1), "y": round(float(q[1]), 1),
                              "z": round(float(q[2]), 1), "ground": None if g is None else round(g, 1), "layers": L, "on": on})
                print(f"    s {t:6.0f}  ({q[0]:7.1f}, {q[1]:7.1f})  line {q[2]:5.1f}  ground {('%.1f' % g) if g is not None else '  -  '}"
                      f"  {'on ' if on else 'OFF'}  layers {L[:4]}")
    if "--json" in sys.argv:
        json.dump(table, open(sys.argv[sys.argv.index("--json") + 1], "w"))


if __name__ == "__main__":
    main()
