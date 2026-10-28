"""Triangle-mesh kit for parametric landmarks (cities/<id>/city.py).

The same idea as web/game/kit.js, the vehicles' kit: a few primitives at real dimensions, lofted, lathed, swept and extruded, with the small parts
(rails, mullions, lamps, cables) that make a structure read as built, each mesh one
material so the browser draws it in one call.

A Mesh dumps to the JSON layout web/data/<city>/landmarks.json uses: positions in metres
in the city's local frame (x east, y north, z up), and, where a mesh has them, texture
coordinates in metres for the material's surface pattern (web/world.js PATTERNS).
"""
import math

import numpy as np


class Mesh:
    def __init__(self, name, mat, smooth, floodlit=False, uv=False):
        self.name, self.mat, self.smooth, self.floodlit, self.v, self.i, self.t = name, mat, smooth, floodlit, [], [], []
        self.keep_uv = uv  # write texture coordinates (for a patterned material)

    def _uv(self, uvs, n):
        if uvs is not None:
            self.t += [list(map(float, u)) for u in uvs]
        else:
            self.t += [[0.0, 0.0]] * n

    def tri(self, a, b, c, uvs=None):
        n = len(self.v)
        self.v += [a, b, c]
        self.i += [n, n + 1, n + 2]
        self._uv(uvs, 3)

    def quad(self, a, b, c, d, uvs=None):
        n = len(self.v)
        self.v += [a, b, c, d]
        self.i += [n, n + 1, n + 2, n, n + 2, n + 3]
        self._uv(uvs, 4)

    def grid(self, pts, uvs=None):
        """pts[r][c] -> smooth shared-vertex triangles; uvs[r][c] optional."""
        n0 = len(self.v)
        rows, cols = len(pts), len(pts[0])
        self.v += [p for r in pts for p in r]
        self._uv([u for r in uvs for u in r] if uvs is not None else None, rows * cols)
        for r in range(rows - 1):
            for c in range(cols - 1):
                a, b = n0 + r * cols + c, n0 + r * cols + c + 1
                d, e = a + cols, b + cols
                self.i += [a, b, e, a, e, d]

    def box(self, p0, p1, w, h, up=(0, 0, 1)):
        """Square-ish beam from p0 to p1, w wide and h deep (flat shaded). UVs: u along the
        beam and v around it, in metres."""
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
        widths = [w, h, w, h]
        v0 = 0.0
        for k in range(4):
            j = (k + 1) % 4
            self.quad(c0[k], c0[j], c1[j], c1[k], [[0, v0], [0, v0 + widths[k]], [L, v0 + widths[k]], [L, v0]])
            v0 += widths[k]
        self.quad(c0[3], c0[2], c0[1], c0[0], [[0, 0], [w, 0], [w, h], [0, h]])
        self.quad(c1[0], c1[1], c1[2], c1[3], [[0, 0], [w, 0], [w, h], [0, h]])

    def tube(self, path, r, sides=6):
        """A round section of radius r swept along a polyline (rails, cables, mullions)."""
        P = [np.asarray(p, float) for p in path]
        if len(P) < 2:
            return
        rings, s = [], 0.0
        for k, p in enumerate(P):
            t = P[min(k + 1, len(P) - 1)] - P[max(k - 1, 0)]
            t = t / (np.linalg.norm(t) or 1)
            ref = np.array([0, 0, 1.0]) if abs(t[2]) < 0.9 else np.array([1.0, 0, 0])
            u = np.cross(t, ref)
            u /= np.linalg.norm(u)
            v = np.cross(t, u)
            if k:
                s += np.linalg.norm(p - P[k - 1])
            rings.append(([p + r * (math.cos(a) * u + math.sin(a) * v) for a in np.linspace(0, 2 * math.pi, sides + 1)], s))
        self.grid([rg for rg, _ in rings], [[[s, j * 2 * math.pi * r / sides] for j in range(sides + 1)] for _, s in rings])

    def lathe(self, profile, centre, segs=32):
        """A surface of revolution about the vertical through centre (x, y); profile is
        [(z, radius)] from the bottom up. UVs: u around (m at the largest radius), v up the
        profile (m along it)."""
        cx, cy = centre
        rmax = max(r for _, r in profile)
        pts, uvs, s = [], [], 0.0
        for k, (z, r) in enumerate(profile):
            if k:
                s += math.hypot(z - profile[k - 1][0], r - profile[k - 1][1])
            a = [2 * math.pi * j / segs for j in range(segs + 1)]
            pts.append([[cx + r * math.cos(q), cy + r * math.sin(q), z] for q in a])
            uvs.append([[q * rmax, s] for q in a])
        self.grid(pts, uvs)

    def sweep(self, path, shape):
        """A closed 2D section swept along a polyline, sharing vertices along it (beams,
        rails, kerbs). shape: [(side, up)] in metres around the path, side horizontal."""
        P = [np.asarray(p, float) for p in path]
        rings = []
        for k, p in enumerate(P):
            t = P[min(k + 1, len(P) - 1)] - P[max(k - 1, 0)]
            side = np.cross(t, (0, 0, 1.0))
            side /= np.linalg.norm(side) or 1
            up = np.cross(side, t / (np.linalg.norm(t) or 1))
            rings.append([p + side * a + up * b for a, b in list(shape) + [shape[0]]])
        self.grid(rings)

    def panel(self, path, height):
        """A vertical strip along a polyline, for a cut-out pattern (a railing's bars): UVs
        are metres along the path and metres up."""
        P = [np.asarray(p, float) for p in path]
        s, pts, uvs = 0.0, [], []
        for k, p in enumerate(P):
            if k:
                s += float(np.linalg.norm(p - P[k - 1]))
            pts.append([p, p + np.array([0, 0, height])])
            uvs.append([[s, 0.0], [s, height]])
        self.grid(pts, uvs)

    def rails(self, path, height, post_every=2.5, post=0.06, rail=0.05, rails=2):
        """A railing along a polyline of 3D points: posts and horizontal rails."""
        P = [np.asarray(p, float) for p in path]
        up = np.array([0, 0, 1.0])
        for k in range(1, rails + 1):
            for a, b in zip(P, P[1:]):
                self.box(a + up * height * k / rails, b + up * height * k / rails, rail, rail)
        for a, b in zip(P, P[1:]):
            L = np.linalg.norm(b - a)
            for t in np.arange(0, L, post_every):
                q = a + (b - a) * t / L
                self.box(q, q + up * height, post, post)

    def dump(self):
        v = np.round(np.asarray(self.v, float), 2)
        out = {"name": self.name, "material": self.mat, "smooth": self.smooth, "floodlit": self.floodlit,
               "position": v.ravel().tolist(), "index": self.i}
        t = np.asarray(self.t, float)
        if self.keep_uv and len(t) == len(self.v):
            out["uv"] = np.round(t, 2).ravel().tolist()
        return out
