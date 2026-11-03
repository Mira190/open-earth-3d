"""A plan of the built city round a point: the footprints of buildings.json (named ones labelled,
shaded by height), the game's roads and footpaths, and the landmarks' crossings, with a 10 m grid.
Used to place the scramble's buildings, signs and street furniture on the data.
  python3 tools/scramble_plan.py shibuya 368 -1000 [half_m=130] [out.png]
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    a = sys.argv[1:]
    city, cx, cy = a[0], float(a[1]), float(a[2])
    half = float(a[3]) if len(a) > 3 else 130.0
    out = a[4] if len(a) > 4 else "plan.png"
    D = os.path.join(ROOT, "web", "data", city)
    B = json.load(open(os.path.join(D, "buildings.json")))
    G = json.load(open(os.path.join(D, "game.json")))
    S = json.load(open(os.path.join(D, "scene.json")))
    px = 2000 / (2 * half)
    img = Image.new("RGB", (2000, 2000), "#f4f2ee")
    d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype(os.path.join(ROOT, "data/raw/fonts/KleeOne-SemiBold.ttf"), 18)
    except OSError:
        f = ImageFont.load_default()
    P = lambda x, y: ((x - cx + half) * px, (cy + half - y) * px)
    for k in range(-int(half) // 10 * 10, int(half) + 1, 10):
        c = "#d8d4cc" if k % 50 else "#b0aaa0"
        d.line([P(cx + k, cy - half), P(cx + k, cy + half)], fill=c)
        d.line([P(cx - half, cy + k), P(cx + half, cy + k)], fill=c)
    for kind, col, w in (("road", "#9a9a9a", 5), ("foot", "#7fb27f", 2)):
        for r in G["paths"][kind]:
            p = r["p"] if isinstance(r, dict) else r
            pts = [P(p[i] / 10, p[i + 1] / 10) for i in range(0, len(p), 3)]
            if len(pts) > 1:
                d.line(pts, fill=col, width=w)
    labels = []
    for s in B["s"]:
        r = s[4]
        xs, ys = [v / 10 for v in r[0::2]], [v / 10 for v in r[1::2]]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        if abs(mx - cx) > half + 60 or abs(my - cy) > half + 60:
            continue
        top = s[3] / 10
        g = int(max(60, 230 - top * 2.2))
        d.polygon([P(x, y) for x, y in zip(xs, ys)], fill=(g, g, int(g * 1.05) % 256), outline="#333")
        nm = B["b"][s[0]][0] or B["b"][s[0]][6]
        labels.append((P(mx, my), f"{nm} {top:.0f}m #{s[0]}"))
    for (x, y), t in labels:
        d.text((x - 40, y - 8), t, fill="#a00000", font=f)
    sc = S.get("landmarks", {}).get("scramble") or {}
    for ab in sc.get("lines", []):
        d.line([P(*ab[0]), P(*ab[1])], fill="#0050ff", width=4)
    if sc.get("node"):
        x, y = P(*sc["node"])
        d.ellipse([x - 8, y - 8, x + 8, y + 8], outline="#0050ff", width=3)
    for pt in a[5:]:
        x, y = P(*map(float, pt.split(",")))
        d.line([x - 10, y - 10, x + 10, y + 10], fill="#e000e0", width=3)
        d.line([x - 10, y + 10, x + 10, y - 10], fill="#e000e0", width=3)
    img.save(out)
    print(out)


if __name__ == "__main__":
    main()
