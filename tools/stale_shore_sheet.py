"""A contact sheet of tools/stale_shore.py's clusters for a city: each over the aerial photograph,
with the Overture water (blue), the built water mask's edge (red) and the cluster's box (yellow).

    python tools/stale_shore_sheet.py amsterdam out.png [--min-cells 8] [--max 12]
"""
import argparse
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stale_shore  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("city"); ap.add_argument("out")
    ap.add_argument("--min-cells", type=int, default=8)
    ap.add_argument("--max", type=int, default=12)
    ap.add_argument("--zoom", type=int, default=0)
    a = ap.parse_args()
    found = stale_shore.scan(a.city, a.min_cells)[:a.max]
    tiles = []
    with tempfile.TemporaryDirectory() as tmp:
        for k, f in enumerate(found):
            x0, y0, x1, y1 = f["box"]
            m = 60
            span = max(x1 - x0, y1 - y0) + 2 * m
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            bx = [cx - span / 2, cy - span / 2, cx + span / 2, cy + span / 2]
            px = span / 400
            p = os.path.join(tmp, f"{k}.png")
            cmd = [sys.executable, os.path.join(HERE, "coast_overlay.py"), a.city, *map(str, bx), p, "--px", str(px)]
            if a.zoom:
                cmd += ["--zoom", str(a.zoom)]
            subprocess.run(cmd, check=True, capture_output=True)
            im = Image.open(p).convert("RGB").resize((400, 400))
            d = ImageDraw.Draw(im)
            tr = lambda x, y: ((x - bx[0]) / px, (bx[3] - y) / px)
            d.rectangle([tr(x0, y1), tr(x1, y0)], outline=(255, 230, 0), width=2)
            d.rectangle([0, 0, 400, 18], fill=(0, 0, 0))
            d.text((4, 3), f"{k} ({f['x']}, {f['y']}) {f['cells']} cells: {', '.join(f['kinds'])}", fill=(255, 255, 255))
            tiles.append(im)
    cols = 4
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * 400, max(1, rows) * 400))
    for k, im in enumerate(tiles):
        sheet.paste(im, ((k % cols) * 400, (k // cols) * 400))
    sheet.save(a.out)
    print(a.out, len(tiles))


if __name__ == "__main__":
    main()
