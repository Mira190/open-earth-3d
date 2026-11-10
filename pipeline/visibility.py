"""The city's occluders, distilled for the page's visibility sweep (issue 358, B1): a raster of how high
the buildings stand, shrunk so that it never claims more than the walls drawn, written to
web/data/<city>/vis.bin and read by web/visibility-worker.js.

    python pipeline/visibility.py shibuya        # one city
    python pipeline/visibility.py                # every live city whose vis.bin is missing or stale
    python pipeline/visibility.py --check        # exit 1 if a live city's vis.bin is missing or stale

The city is static, so what hides what never changes. The page asks "what can be seen from where the
camera is" a few times a second in a Worker, by sweeping a horizon outward over this raster (the 2.5D
occluder shadows of Wonka and Schmalstieg 1999; the from-region margin by occluder shrinking of Wonka,
Wimmer and Schmalstieg 2000; the potentially visible set of Teller and Sequin 1991 computed per cell was
tried first and hid a fifth as much: docs/PERFORMANCE.md). No code was taken from any of them.

What occludes, and what does not (everything errs towards hiding less):
  - a building solid that stands on the ground (min_dm 0), is not replaced by a landmark's own model
    (scene.json hidden_solids, landmarks.json hidden and demolished), is not a canopy (class "roof"), has no road passage through it and is at
    least 2 m tall, up to its eaves (the lowest eave of any solid touching the pixel);
  - only pixels that lie wholly inside those solids: the union (walls that meet within 4 cm are one wall)
    shrunk by half the diagonal of a 0.5 m pixel, then the pixels whose centres are in it;
  - the 1 m pixel written is the lowest of its four 0.5 m pixels and of the ring round them, so a sample
    every 0.7 m along a line meets no pixel higher than the walls there. The Worker shrinks further by how
    far the camera may move before the next answer, and adds the terrain;
  - landmarks, trees, bridges, canopies, vehicles and people hide nothing;
  - a city with occluders under 5% of its frame (Queenstown) gets a header and no raster.

The file: gzip( "OEVS" | u32 header length | header JSON | pad to 8 | w * h bytes ), rows from the south.
A byte is 0 for no occluder, else the top is z0 + (byte - 1) * q metres (rounded down, capped at 254).
(Row or column differences made the gzip larger, not smaller: the bytes are stored as they are.) The
header's sha256 is of the inputs (buildings.json and the hidden solids), for --check.
"""
import gzip
import hashlib
import json
import os
import struct
import subprocess
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "web", "data")
FINE = 0.5         # the raster the solids are drawn at (m)
VERSION = 1
MIN_SOLID = 0.05   # the least share of the frame under occluders for a raster to be worth its download and memory


def inputs_sha(city):
    d = os.path.join(DATA, city)
    h = hashlib.sha256(f"oe-vis-{VERSION}".encode())
    h.update(open(os.path.join(d, "buildings.json"), "rb").read())
    scene = json.load(open(os.path.join(d, "scene.json"), encoding="utf8"))
    h.update(json.dumps([scene["frame"], sorted(hidden_solids(city, scene))]).encode())
    return h.hexdigest()


def hidden_solids(city, scene):
    """The solids the page does not draw: scene.json hidden_solids, and landmarks.json "hidden" and
    "demolished" (world.js adds them when it loads)."""
    out = set(scene.get("hidden_solids") or [])
    try:
        L = json.load(open(os.path.join(DATA, city, "landmarks.json"), encoding="utf8"))
        out |= set(L.get("hidden") or []) | set(L.get("demolished") or [])
    except OSError:
        pass
    return out


def occluders(B, scene, hidden):
    """The occluders' tops (m above datum, NaN where none) at FINE m, row 0 at the south: the lowest eave of
    any solid that touches a pixel, kept only where the pixel lies wholly inside the solids that occlude."""
    from rasterio import features
    from rasterio.transform import Affine
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    fr = scene["frame"]
    x0, x1, y0, y1 = fr["x"][0], fr["x"][1], fr["y"][0], fr["y"][1]
    w, h = int(round((x1 - x0) / FINE)), int(round((y1 - y0) / FINE))
    tr = Affine(FINE, 0, x0, 0, FINE, y0)
    passages = set(B.get("passages") or [])
    eave = {r[0]: r[2] for r in B.get("r") or []}
    solid = []
    for si, s in enumerate(B["s"]):
        if si in hidden or si in passages or s[2] != 0 or B["b"][s[0]][1] == "roof" or s[3] < 20 or len(s[4]) < 6:
            continue
        ring = np.asarray(s[4], np.float64).reshape(-1, 2) / 10
        holes = [np.asarray(q, np.float64).reshape(-1, 2) / 10 for q in s[5:]]
        p = Polygon(ring, [q for q in holes if len(q) >= 3])
        if not p.is_valid:
            p = p.buffer(0)
        if p.is_empty:
            continue
        solid.append(((s[1] + min(s[3], eave.get(si, s[3]))) / 10, p))
    if not solid:
        return np.full((h, w), np.nan, np.float32)
    solid.sort(key=lambda q: -q[0])   # the tallest first: a pixel two solids touch ends with the lower top
    H = features.rasterize(((p, top) for top, p in solid), out_shape=(h, w), transform=tr, fill=np.nan, all_touched=True, dtype="float32")
    u = unary_union([p.buffer(0.02, join_style=2) for _, p in solid]).buffer(-0.02 - FINE * 0.71, join_style=2)
    inside = features.rasterize([(u, 1)], out_shape=(h, w), transform=tr, fill=0, all_touched=False, dtype="uint8") if not u.is_empty else np.zeros((h, w), np.uint8)
    H[inside == 0] = np.nan
    return H


def bake(city):
    from scipy.ndimage import minimum_filter
    d = os.path.join(DATA, city)
    scene = json.load(open(os.path.join(d, "scene.json"), encoding="utf8"))
    B = json.load(open(os.path.join(d, "buildings.json"), encoding="utf8"))
    fr = scene["frame"]
    H = occluders(B, scene, hidden_solids(city, scene))
    none = np.isnan(H)
    if none.all():
        return None
    z0 = float(np.floor(np.nanmin(H)))
    span = float(np.nanmax(H)) - z0
    q = 1.0 if span <= 250 else 2.0 if span <= 500 else 4.0   # (a mountain town: coarser steps, each top rounded down)
    v = np.where(none, 0, np.minimum(254, np.floor((np.nan_to_num(H) - z0) / q)) + 1).astype(np.uint8)
    g = minimum_filter(v, size=3, mode="constant", cval=0)     # each 0.5 m pixel and the ring round it
    h2, w2 = g.shape[0] // 2 * 2, g.shape[1] // 2 * 2
    out = g[:h2, :w2].reshape(h2 // 2, 2, w2 // 2, 2).min(axis=(1, 3))
    zmax = float(max([(s[1] + s[3]) / 10 for s in B["s"]] + [0]))
    try:
        L = json.load(open(os.path.join(d, "landmarks.json"), encoding="utf8"))
        zmax = max([zmax] + [float(np.max(np.asarray(m["position"])[2::3])) for m in L.get("meshes", []) if m.get("position")])
    except OSError:
        pass
    solid_share = float((out > 0).mean())
    if solid_share < MIN_SOLID:
        # too few buildings to hide anything (a lake town): a header alone, and the page draws everything
        return {"format": "oe-vis", "v": VERSION, "city": city, "empty": True, "w": 0, "h": 0,
                "solid": round(solid_share, 4), "sha256": inputs_sha(city)}, np.zeros((0, 0), np.uint8)
    head = {"format": "oe-vis", "v": VERSION, "city": city, "x0": fr["x"][0], "y0": fr["y"][0], "px": 2 * FINE, "w": int(out.shape[1]), "h": int(out.shape[0]),
            "z0": z0, "q": q, "zmax": round(zmax + 5, 1), "shrunk_m": round(FINE * 0.71 + FINE, 2),
            "solid": round(solid_share, 4), "sha256": inputs_sha(city)}
    return head, out


def write(city, head, out):
    rows = np.ascontiguousarray(out)
    hj = json.dumps(head, separators=(",", ":")).encode()
    pre = b"OEVS" + struct.pack("<I", len(hj)) + hj
    pre += b"\0" * ((-len(pre)) % 8)
    path = os.path.join(DATA, city, "vis.bin")
    tmp = path + ".tmp"
    open(tmp, "wb").write(gzip.compress(pre + rows.tobytes(), 9, mtime=0))
    os.replace(tmp, path)
    return path


def read(city):
    """(header, raster) of a city's vis.bin, or None."""
    path = os.path.join(DATA, city, "vis.bin")
    if not os.path.exists(path):
        return None
    raw = gzip.open(path).read()
    n = struct.unpack("<I", raw[4:8])[0]
    head = json.loads(raw[8:8 + n])
    start = 8 + n + (-(8 + n)) % 8
    a = np.frombuffer(raw, np.uint8, head["w"] * head["h"], start).reshape(head["h"], head["w"])
    return head, a


def stale(city):
    got = read(city)
    if got is None:
        return "missing"
    return None if got[0].get("sha256") == inputs_sha(city) and got[0].get("v") == VERSION else "stale"


def live():
    return subprocess.run(["bash", os.path.join(ROOT, "tools", "live_cities.sh")], stdout=subprocess.PIPE, check=True, text=True).stdout.split()


def main(argv):
    named = [a for a in argv if not a.startswith("--")]
    if "--check" in argv:
        bad = [(c, s) for c in (named or live()) if (s := stale(c))]
        for c, s in bad:
            print(f"FAIL vis    {c}: vis.bin {s}; run python pipeline/visibility.py {c}")
        if not bad:
            print(f"ok   vis    {len(named or live())} cities' occluder rasters match their buildings")
        return 1 if bad else 0
    for city in named or [c for c in live() if stale(c)]:
        t = time.time()
        got = bake(city)
        if got is None:
            print(f"{city}: no occluders")
            continue
        head, out = got
        path = write(city, head, out)
        back = read(city)
        if not np.array_equal(back[1], out):
            raise SystemExit(f"{path}: does not read back")
        if head.get("empty"):
            print(f"{city}: {100 * head['solid']:.1f}% occluder, under {100 * MIN_SOLID:g}%: no raster (the page draws everything)")
            continue
        print(f"{city}: {head['w']} x {head['h']} px, {100 * head['solid']:.1f}% occluder, steps of {head['q']:g} m from {head['z0']:g} m; "
              f"{os.path.getsize(path) / 1e3:.0f} kB in {time.time() - t:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
