"""Triangle-mesh builder for parametric landmarks (cities/<id>/city.py).

A Mesh dumps to the JSON layout web/data/<city>/landmarks.json uses:
positions in metres in the city's local frame (x east, y north, z up).
"""
import numpy as np


class Mesh:
    def __init__(self, name, mat, smooth, floodlit=False):
        self.name, self.mat, self.smooth, self.floodlit, self.v, self.i = name, mat, smooth, floodlit, [], []

    def tri(self, a, b, c):
        n = len(self.v)
        self.v += [a, b, c]
        self.i += [n, n + 1, n + 2]

    def quad(self, a, b, c, d):
        self.tri(a, b, c)
        self.tri(a, c, d)

    def grid(self, pts):
        """pts[r][c] -> smooth shared-vertex triangles."""
        n0 = len(self.v)
        rows, cols = len(pts), len(pts[0])
        self.v += [p for r in pts for p in r]
        for r in range(rows - 1):
            for c in range(cols - 1):
                a, b = n0 + r * cols + c, n0 + r * cols + c + 1
                d, e = a + cols, b + cols
                self.i += [a, b, e, a, e, d]

    def box(self, p0, p1, w, h, up=(0, 0, 1)):
        """Square-ish beam from p0 to p1, w wide and h deep (flat shaded)."""
        p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
        ax = p1 - p0
        L = np.linalg.norm(ax)
        if L < 1e-6:
            return
        ax /= L
        side = np.cross(ax, up)
        if np.linalg.norm(side) < 1e-6:
            side = np.cross(ax, (1, 0, 0))
        side /= np.linalg.norm(side)
        top = np.cross(side, ax)
        o = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        c0 = [p0 + side * sx * w / 2 + top * sy * h / 2 for sx, sy in o]
        c1 = [p1 + side * sx * w / 2 + top * sy * h / 2 for sx, sy in o]
        for k in range(4):
            j = (k + 1) % 4
            self.quad(c0[k], c0[j], c1[j], c1[k])
        self.quad(c0[3], c0[2], c0[1], c0[0])
        self.quad(c1[0], c1[1], c1[2], c1[3])

    def dump(self):
        v = np.round(np.asarray(self.v, float), 2)
        return {"name": self.name, "material": self.mat, "smooth": self.smooth, "floodlit": self.floodlit,
                "position": v.ravel().tolist(), "index": self.i}
