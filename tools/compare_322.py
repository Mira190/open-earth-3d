"""Before/after sheets for #322/#323: each view of tools/views/fidelity-322.json, main's still beside this branch's at
day, dusk and night, from tools/fidelity_290_shots.py's BEFORE and AFTER folders.
    python3 tools/compare_322.py BEFORE AFTER OUT city size
"""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    before, after, out, city, size = sys.argv[1:6]
    V = json.load(open(os.path.join(ROOT, "tools", "views", "fidelity-322.json")))[city]
    times = ["day", "dusk", "night"]
    cw = 360 if size == "desktop" else 150
    rows = []
    for v in V:
        for t in times:
            pair = []
            for d in (before, after):
                f = os.path.join(d, city, size, f"{v['name']}-{t}.png")
                im = Image.open(f).convert("RGB") if os.path.exists(f) else Image.new("RGB", (cw, cw), "grey")
                pair.append(im.resize((cw, int(cw * im.height / im.width))))
            rows.append((f"{v['name']} {t}", pair))
    ch = rows[0][1][0].height
    cols = 3
    S = Image.new("RGB", (cols * 2 * cw + (cols - 1) * 8, (ch + 18) * len(V)), "white")
    D = ImageDraw.Draw(S)
    for i, (label, pair) in enumerate(rows):
        r, c = divmod(i, cols)
        x, y = c * (2 * cw + 8), r * (ch + 18)
        D.text((x + 4, y + 2), f"{label}: main | this branch", fill="black")
        S.paste(pair[0], (x, y + 16)); S.paste(pair[1], (x + cw, y + 16))
    S.save(out, quality=86)


if __name__ == "__main__":
    main()
