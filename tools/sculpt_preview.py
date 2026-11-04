"""A quick still of a sculpted mesh (pipeline/sculptkit.py) without the browser: front, side, three-quarter
and back views, orthographic, lit by a key and a fill light, to check a statue's shape while modelling it.
  python3 tools/sculpt_preview.py cities/shibuya/hachiko.py out.png      # the module's sculpt()
"""
import importlib.util
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))


def render(v, t, worn, yaw, size=420, pitch=0.12):
    cy, sy, cp, sp = np.cos(yaw), np.sin(yaw), np.cos(pitch), np.sin(pitch)
    # camera looks along -x' after turning the model by yaw about z and tilting by pitch
    x = v[:, 0] * cy - v[:, 1] * sy
    y = v[:, 0] * sy + v[:, 1] * cy
    z = v[:, 2]
    x, z = x * cp - z * sp, x * sp + z * cp
    P = np.stack([y, z, x], 1)   # screen right, up, depth toward the viewer
    lo, hi = P[:, :2].min(0), P[:, :2].max(0)
    s = (size - 20) / (hi - lo).max()
    sx = (P[:, 0] - (lo[0] + hi[0]) / 2) * s + size / 2
    syy = size / 2 - (P[:, 1] - (lo[1] + hi[1]) / 2) * s
    n = np.cross(P[t[:, 1]] - P[t[:, 0]], P[t[:, 2]] - P[t[:, 0]])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    key, fill = np.array([0.5, 0.6, 0.62]), np.array([-0.6, 0.2, 0.75])
    key, fill = key / np.linalg.norm(key), fill / np.linalg.norm(fill)
    shade = 0.15 + 0.75 * np.clip(n @ key, 0, 1) + 0.25 * np.clip(n @ fill, 0, 1)
    img = np.full((size, size, 3), 235.0)
    zb = np.full((size, size), -1e9)
    base = np.where(worn[:, None], np.array([196, 150, 92]), np.array([104, 84, 64]))
    for k in np.argsort(-n[:, 2] * 0):
        if n[k, 2] <= 0:
            continue
        a, b, c = t[k]
        xs, ys = np.array([sx[a], sx[b], sx[c]]), np.array([syy[a], syy[b], syy[c]])
        x0, x1 = int(max(0, xs.min())), int(min(size - 1, xs.max() + 1))
        y0, y1 = int(max(0, ys.min())), int(min(size - 1, ys.max() + 1))
        if x1 < x0 or y1 < y0:
            continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2])
        if abs(d) < 1e-9:
            continue
        w0 = ((ys[1] - ys[2]) * (X - xs[2]) + (xs[2] - xs[1]) * (Y - ys[2])) / d
        w1 = ((ys[2] - ys[0]) * (X - xs[2]) + (xs[0] - xs[2]) * (Y - ys[2])) / d
        w2 = 1 - w0 - w1
        m = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not m.any():
            continue
        depth = w0 * P[a, 2] + w1 * P[b, 2] + w2 * P[c, 2]
        sub = zb[y0:y1 + 1, x0:x1 + 1]
        m &= depth > sub
        sub[m] = depth[m]
        img[y0:y1 + 1, x0:x1 + 1][m] = base[k] * shade[k]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def main():
    path, out = sys.argv[1], sys.argv[2]
    spec = importlib.util.spec_from_file_location("sculpted", os.path.abspath(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    v, t, worn = mod.sculpt()
    print(f"{len(v)} vertices, {len(t)} triangles")
    views = [render(v, t, worn, yaw) for yaw in (np.pi, np.pi / 2, np.pi * 0.75, 0.0)]   # front, his left side, three-quarter, back
    sheet = Image.new("RGB", (420 * len(views), 420))
    for k, im in enumerate(views):
        sheet.paste(im, (420 * k, 0))
    sheet.save(out)


if __name__ == "__main__":
    main()
