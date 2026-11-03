"""A plan of part of a city's game: the aerial imagery the ground is draped with, the roads a car
can drive (grey), the game's start (red ring, with a line the way it faces), its wharves' landings
(blue), helipads (orange H), NPCs (yellow) and extra points (magenta crosses), with a 50 m grid.
Used to place starts, pads and NPCs on open ground.
  python3 tools/plan_map.py sydney 120 205 [half_m=250] [out.png] [x,y x,y ...]
"""
import json
import math
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    a = sys.argv[1:]
    city, cx, cy = a[0], float(a[1]), float(a[2])
    half = float(a[3]) if len(a) > 3 else 250.0
    out = a[4] if len(a) > 4 else f"{city}-plan.png"
    extra = [tuple(map(float, s.split(","))) for s in a[5:]]
    d = os.path.join(ROOT, "web", "data", city)
    scene = json.load(open(os.path.join(d, "scene.json")))
    G = json.load(open(os.path.join(d, "game.json")))
    px = 1000 / (2 * half)  # pixels per metre
    img = Image.new("RGB", (1000, 1000), (40, 40, 40))
    X = lambda x: (x - (cx - half)) * px
    Y = lambda y: ((cy + half) - y) * px
    for t in scene["ground"]:
        if t["x1"] < cx - half or t["x0"] > cx + half or t["y1"] < cy - half or t["y0"] > cy + half:
            continue
        im = Image.open(os.path.join(d, t["file"])).convert("RGB")
        w, h = im.size
        # the part of this tile inside the view
        x0, x1 = max(t["x0"], cx - half), min(t["x1"], cx + half)
        y0, y1 = max(t["y0"], cy - half), min(t["y1"], cy + half)
        box = (int((x0 - t["x0"]) / (t["x1"] - t["x0"]) * w), int((t["y1"] - y1) / (t["y1"] - t["y0"]) * h),
               int((x1 - t["x0"]) / (t["x1"] - t["x0"]) * w), int((t["y1"] - y0) / (t["y1"] - t["y0"]) * h))
        piece = im.crop(box).resize((max(1, round((x1 - x0) * px)), max(1, round((y1 - y0) * px))))
        img.paste(piece, (round(X(x0)), round(Y(y1))))
    dr = ImageDraw.Draw(img, "RGBA")
    for i in range(-20, 21):  # 50 m grid
        gx = math.floor(cx / 50) * 50 + i * 50
        gy = math.floor(cy / 50) * 50 + i * 50
        dr.line([(X(gx), 0), (X(gx), 1000)], fill=(255, 255, 255, 40))
        dr.line([(0, Y(gy)), (1000, Y(gy))], fill=(255, 255, 255, 40))
    for r in G["paths"]["road"]:
        p = r["p"]
        pts = [(X(p[i] / 10), Y(p[i + 1] / 10)) for i in range(0, len(p), 3)]
        if len(pts) > 1:
            dr.line(pts, fill=(160, 160, 160, 150), width=2)
    for w in G.get("wharves", []):
        x, y = w.get("berth", w["terminal"])
        dr.ellipse([X(x) - 7, Y(y) - 7, X(x) + 7, Y(y) + 7], outline=(60, 140, 255), width=3)
        dr.text((X(x) + 9, Y(y) - 6), w["name"], fill=(120, 180, 255))
    for h in G.get("helipads", []):
        x, y = h["at"][:2]
        dr.ellipse([X(x) - 10, Y(y) - 10, X(x) + 10, Y(y) + 10], outline=(255, 150, 0), width=3)
        dr.text((X(x) - 3, Y(y) - 6), "H", fill=(255, 150, 0))
    for n in G.get("npcs", []):
        x, y = n["at"][:2]
        dr.ellipse([X(x) - 4, Y(y) - 4, X(x) + 4, Y(y) + 4], fill=(255, 220, 0))
        dr.text((X(x) + 6, Y(y) - 6), n["id"], fill=(255, 230, 80))
    s = G["start"]
    x, y = s["at"]
    dr.ellipse([X(x) - 9, Y(y) - 9, X(x) + 9, Y(y) + 9], outline=(255, 40, 40), width=3)
    if s.get("facing"):
        fx, fy = s["facing"]
        L = math.hypot(fx - x, fy - y) or 1
        dr.line([(X(x), Y(y)), (X(x + (fx - x) / L * 40), Y(y + (fy - y) / L * 40))], fill=(255, 40, 40), width=3)
    for i, (x, y) in enumerate(extra):
        dr.line([(X(x) - 8, Y(y) - 8), (X(x) + 8, Y(y) + 8)], fill=(255, 0, 255), width=3)
        dr.line([(X(x) - 8, Y(y) + 8), (X(x) + 8, Y(y) - 8)], fill=(255, 0, 255), width=3)
        dr.text((X(x) + 9, Y(y) + 2), str(i + 1), fill=(255, 120, 255))
    dr.text((8, 8), f"{city} centre {cx:.0f},{cy:.0f} +/-{half:.0f} m, grid 50 m", fill=(255, 255, 255))
    img.save(out)
    print(out)


if __name__ == "__main__":
    main()
