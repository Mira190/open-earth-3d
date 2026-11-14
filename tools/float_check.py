"""Landmark geometry that hangs in the air: a sign tower whose legs miss the roof, a box off its wall.

Every landmark mesh of a city (web/data/<id>/landmarks.json) is split into its connected pieces. A piece is
held if it reaches the ground, or meets a building's solid (its outline, from its base to its roof), or
touches a piece that is held. What is left is listed with its mesh, its place and how far it hangs over
whatever is under it. Boxes are compared by their bounds, so a thing that only passes near another counts as
touching it: this finds what stands clear in the air, which is what the eye catches, not every loose end.

    python tools/float_check.py shibuya              # every landmark mesh
    python tools/float_check.py shibuya 368 -1002 260  # within 260 m of a point
Exits 1 when something floats (pieces under MIN_M across are left out: a bolt, a lamp's glass).
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "blender"))
MIN_M = 0.5        # a piece smaller than this in every direction is not reported
TOUCH = 0.35       # two pieces whose bounds come this close hold each other
REACH = 0.8        # a piece this near a solid's wall or roof is fixed to it


def pieces(m):
    """A mesh's connected pieces: (lo, hi) bounds of each, joined where triangles share a point (to the centimetre)."""
    P = np.asarray(m["position"], float).reshape(-1, 3)
    I = np.asarray(m.get("index") or np.arange(len(P)), np.int64).reshape(-1, 3)
    _, inv = np.unique(np.round(P, 2), axis=0, return_inverse=True)
    inv = inv.ravel()
    parent = np.arange(inv.max() + 1)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for a, b, c in inv[I]:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[find(rc)] = ra
    root = np.array([find(a) for a in inv])
    out = []
    for r in np.unique(root):
        Q = P[root == r]
        out.append((Q.min(0), Q.max(0)))
    return out


def main():
    import archkit as ak
    import hero_open as HP
    from shapely import STRtree
    from shapely.geometry import Polygon, box
    city = sys.argv[1]
    near = [float(v) for v in sys.argv[2:5]] if len(sys.argv) >= 5 else None
    L = json.load(open(os.path.join(ROOT, "web", "data", city, "landmarks.json")))
    T = HP.Ground(city)
    solids = [s for s in ak.load_solids(city) if len(s["ring"]) >= 3]
    polys = [Polygon(s["ring"]).buffer(REACH) for s in solids]
    tree = STRtree(polys)
    items = []
    for m in L["meshes"]:
        for lo, hi in pieces(m):
            items.append((m["name"], lo, hi))
    n = len(items)
    lo = np.array([i[1] for i in items]); hi = np.array([i[2] for i in items])
    rect = [box(lo[i, 0] - TOUCH, lo[i, 1] - TOUCH, hi[i, 0] + TOUCH, hi[i, 1] + TOUCH) for i in range(n)]
    held = np.zeros(n, bool)
    under = np.full(n, np.nan)       # the gap to what lies under a piece's middle (ground or the highest roof there)
    for i in range(n):
        cx, cy = (lo[i, 0] + hi[i, 0]) / 2, (lo[i, 1] + hi[i, 1]) / 2
        g = min(T(x, y) for x in (lo[i, 0], hi[i, 0], cx) for y in (lo[i, 1], hi[i, 1], cy))
        top = g
        if lo[i, 2] <= g + 0.6:
            held[i] = True
        for k in tree.query(rect[i], predicate="intersects"):
            s = solids[k]
            z0, z1 = s["ground"] + s["base"], s["ground"] + s["top"]
            top = max(top, z1) if z1 <= lo[i, 2] + 0.5 else top
            if lo[i, 2] <= z1 + REACH and hi[i, 2] >= z0 - 0.5:
                held[i] = True
        under[i] = lo[i, 2] - top
    rt = STRtree(rect)
    front = list(np.flatnonzero(held))
    while front:
        i = front.pop()
        for k in rt.query(rect[i], predicate="intersects"):
            if not held[k] and lo[k, 2] <= hi[i, 2] + TOUCH and hi[k, 2] >= lo[i, 2] - TOUCH:
                held[k] = True
                front.append(k)
    bad = []
    for i in np.flatnonzero(~held):
        size = hi[i] - lo[i]
        c = (lo[i] + hi[i]) / 2
        if size.max() < MIN_M or (near and np.hypot(c[0] - near[0], c[1] - near[1]) > near[2]):
            continue
        bad.append((items[i][0], c, size, under[i]))
    bad.sort(key=lambda b: -b[2].max())
    for name, c, size, gap in bad:
        print(f"FLOATS {name}: at ({c[0]:.1f}, {c[1]:.1f}, {c[2]:.1f}), {size[0]:.1f} x {size[1]:.1f} x {size[2]:.1f} m, {gap:.1f} m over what is under it")
    print(f"{city}: {n} pieces in {len(L['meshes'])} landmark meshes, {len(bad)} floating")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
