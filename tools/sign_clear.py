"""Signs and screens that something stands in front of: a facade's fins across a screen, a frame over a print.

Every face of a landmark mesh that carries a picture (a material with a `map`, or the screens) is sampled on a
grid; from each sample a ray goes out along the face's normal for REACH metres. A sample is covered when the ray
meets a triangle of another opaque landmark mesh. A face with more than SHARE of its samples covered is listed.
Glass in front of a picture is not counted (materials with an opacity under 0.6).

    python tools/sign_clear.py shibuya            # exits 1 when a picture is covered
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REACH = 2.5       # how far in front of a picture a thing counts as covering it (m)
SHARE = 0.1       # the share of a face that may be covered (a frame's lip, a lamp's arm, a neighbour's edge)
MIN_M2 = 4.0      # faces smaller than this are not checked (a shop's name plate)
GRID = 9


def tris(m):
    P = np.asarray(m["position"], float).reshape(-1, 3)
    I = np.asarray(m.get("index") or np.arange(len(P)), np.int64).reshape(-1, 3)
    return P[I]


def hits(o, d, T):
    """Whether each ray o[i] + s d (0.03 < s < REACH) meets any triangle of T (n, 3, 3): Moeller-Trumbore."""
    a, e1, e2 = T[:, 0], T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    h = np.cross(d, e2)
    det = (e1 * h).sum(1)
    ok = np.abs(det) > 1e-9
    inv = np.where(ok, 1.0 / np.where(ok, det, 1), 0)
    out = np.zeros(len(o), bool)
    for i, p in enumerate(o):
        s = p - a
        u = (s * h).sum(1) * inv
        q = np.cross(s, e1)
        v = (q @ d) * inv
        t = (q * e2).sum(1) * inv
        out[i] = bool((ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0.03) & (t < REACH)).any())
    return out


def main():
    city = sys.argv[1]
    L = json.load(open(os.path.join(ROOT, "web", "data", city, "landmarks.json")))
    M = L["materials"]
    pic = lambda m: bool(M.get(m["material"], {}).get("map")) or "screen" in m["material"] and "frame" not in m["material"]
    solid = [m for m in L["meshes"] if M.get(m["material"], {}).get("opacity", 1) >= 0.6 and not M.get(m["material"], {}).get("cutout")]
    T_all = [(m["name"], tris(m)) for m in solid]
    bad = []
    for m in L["meshes"]:
        if not pic(m):
            continue
        T = tris(m)
        # faces: pairs of triangles in one plane are taken one triangle at a time; a covered picture shows on both
        for k in range(0, len(T), 2):
            q = T[k:k + 2].reshape(-1, 3)
            n = np.cross(T[k, 1] - T[k, 0], T[k, 2] - T[k, 0])
            area = np.linalg.norm(n) / 2 * len(T[k:k + 2])
            if area < MIN_M2:
                continue
            n = n / np.linalg.norm(n)
            lo, hi = q.min(0), q.max(0)
            a, b, c = T[k]
            S = []
            for i in range(GRID):
                for j in range(GRID - i):
                    u, v = (i + 0.33) / GRID, (j + 0.33) / GRID
                    S.append(a + (b - a) * u + (c - a) * v)
            S = np.array(S)
            # (a picture is drawn on both of its sides, and one of them is its wall or its box: the side that is
            # looked at is the freer one)
            best = None
            for sgn in (1, -1):
                cov, by = np.zeros(len(S), bool), {}
                for name, To in T_all:
                    if name == m["name"]:
                        continue
                    tl, th = To.min(1), To.max(1)
                    near = ((th >= lo - REACH) & (tl <= hi + REACH)).all(1)
                    if not near.any():
                        continue
                    h = hits(S, n * sgn, To[near])
                    if h.any():
                        by[name] = int(h.sum())
                        cov |= h
                if best is None or cov.mean() < best[0].mean():
                    best = (cov, by)
            cov, by = best
            if cov.mean() > SHARE:
                bad.append((cov.mean(), m["name"], (lo + hi) / 2, area, by))
    bad.sort(key=lambda r: -r[0])
    for share, name, c, area, by in bad:
        print(f"COVERED {name}: {share * 100:.0f}% of a {area:.0f} m2 face at ({c[0]:.1f}, {c[1]:.1f}, {c[2]:.1f}) by {', '.join(sorted(by, key=by.get, reverse=True)[:3])}")
    print(f"{city}: {len(bad)} pictures with something in front")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
