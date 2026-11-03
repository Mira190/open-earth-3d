"""Find signs whose words read mirrored, in every city's built landmarks (web/data/<id>/landmarks.json).

Signs are drawn double-sided, so a face seen from behind shows its picture mirrored. Two faults make
that happen:
  - a face whose picture runs against its own winding (u x v points into the face): mirrored from the
    front it was built to be read from;
  - a sign read from both sides (a blade standing out from a wall, a box sign) built as two faces back
    to back where each face sits on the far side of the other: from either side the near face is seen
    from behind, so both sides read mirrored.
Meshes whose material has a picture (a "map": sign atlases, the LED screens' programmes) are looked
at; the aerial photo draped on a landmark's ground is not a picture to read.

    python3 tools/sign_check.py [city ...]      # exits 1 if anything is mirrored
"""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "web", "data")


def faces(mesh):
    """Each triangle as (centroid, unit normal by winding, uv-orientation sign, uv rect key, area)."""
    P = np.asarray(mesh["position"], float).reshape(-1, 3)
    T = np.asarray(mesh["uv"], float).reshape(-1, 2)
    I = np.asarray(mesh["index"], int).reshape(-1, 3)
    out = []
    for i, j, k in I:
        a, b, c = P[i], P[j], P[k]
        n = np.cross(b - a, c - a)
        ln = np.linalg.norm(n)
        if ln < 1e-6:
            continue
        n = n / ln
        e1, e2 = b - a, c - a
        du1, dv1 = T[j] - T[i]
        du2, dv2 = T[k] - T[i]
        det = du1 * dv2 - du2 * dv1
        if abs(det) < 1e-9:   # one colour, no picture
            continue
        dpdu = (e1 * dv2 - e2 * dv1) / det
        dpdv = (e2 * du1 - e1 * du2) / det
        o = float(np.dot(np.cross(dpdu, dpdv), n))
        uvk = tuple(np.round(np.r_[T[[i, j, k]].min(axis=0), T[[i, j, k]].max(axis=0)], 3))
        out.append([(a + b + c) / 3, n, o, uvk, ln / 2, {i, j, k}])
    # a quad's two triangles (written one after the other, sharing an edge and a picture) as one face,
    # centred on its four corners, so the twin of a two-sided sign lies straight behind it
    merged, q = [], 0
    while q < len(out):
        f = out[q]
        g = out[q + 1] if q + 1 < len(out) else None
        if g is not None and g[3] == f[3] and len(f[5] & g[5]) == 2 and np.dot(f[1], g[1]) > 0.99:
            vs = sorted(f[5] | g[5])
            merged.append((P[vs].mean(axis=0), f[1], min(f[2], g[2]), f[3], f[4] + g[4]))
            q += 2
        else:
            merged.append(tuple(f[:5]))
            q += 1
    return merged


def check(city):
    path = os.path.join(DATA, city, "landmarks.json")
    if not os.path.exists(path):
        return []
    L = json.load(open(path))
    mats = L.get("materials", {})
    bad = []
    for mesh in L.get("meshes", []):
        m = mats.get(mesh.get("material"), {})
        if not m.get("map") or m["map"].startswith("ground") or not mesh.get("uv"):   # a picture, not the aerial photo
            continue
        F = faces(mesh)
        if not F:
            continue
        flipped = [f for f in F if f[2] < 0]
        for f in flipped:
            bad.append((mesh["name"], "picture against its winding", f[0]))
        # back-to-back pairs: same picture, opposite normals, centroids close
        C = np.array([f[0] for f in F])
        N = np.array([f[1] for f in F])
        by = {}
        for idx, f in enumerate(F):
            by.setdefault(f[3], []).append(idx)
        for idxs in by.values():
            idxs = [i for i in idxs if F[i][4] > 0.1]   # sign-sized faces, not a rope's or a lantern's slivers
            if len(idxs) < 2:
                continue
            for x in idxs:
                for y in idxs:
                    if y <= x or np.dot(N[x], N[y]) > -0.9:
                        continue
                    d = C[x] - C[y]
                    if np.linalg.norm(d) > 1.0:
                        continue
                    sep = float(np.dot(d, N[x]))   # x should stand in front of y, along x's normal
                    if np.linalg.norm(d - sep * N[x]) > 0.05:   # not its twin: another sign crossing it
                        continue
                    if sep < -0.01:
                        bad.append((mesh["name"], "back-to-back faces swapped", C[x]))
    return bad


def main():
    cities = sys.argv[1:] or sorted(d for d in os.listdir(DATA) if os.path.isdir(os.path.join(DATA, d)))
    total = 0
    for c in cities:
        bad = check(c)
        total += len(bad)
        if bad:
            kinds = {}
            for name, why, at in bad:
                kinds.setdefault((name, why), []).append(at)
            for (name, why), ats in kinds.items():
                print(f"{c}: {name}: {len(ats)} faces, {why}, e.g. at {np.round(ats[0], 1).tolist()}")
        else:
            print(f"ok {c}: signs read the right way round")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
