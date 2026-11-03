"""Side-by-side stills of a city against reference photographs from the same viewpoints.

  python3 tools/compare_sheet.py views shibuya out_dir            # writes out_dir/views.json for tools/game_shot.js
  xvfb-run -a node tools/game_shot.js shibuya out_dir/views.json out_dir/desktop 1440x900
  xvfb-run -a node tools/game_shot.js shibuya out_dir/views.json out_dir/phone 390x844
  python3 tools/compare_sheet.py sheets shibuya out_dir photos_dir # out_dir/<id>.jpg: the photo beside day, dusk, night

tools/compare/<city>.json: the views (camera, target, photo file, credit) and the times of day.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def spec(city):
    return json.load(open(os.path.join(ROOT, "tools", "compare", f"{city}.json"), encoding="utf8"))


def views(city, out):
    S = spec(city)
    os.makedirs(out, exist_ok=True)
    vs = [{"name": f"{v['id']}_{t}", "cam": v["cam"], "tgt": v["tgt"], "time": tm, "date": S.get("date")}
          for v in S["views"] for t, tm in S["times"].items()]
    json.dump(vs, open(os.path.join(out, "views.json"), "w"), indent=1)
    print(len(vs), "views ->", os.path.join(out, "views.json"))


def fit(im, w, h):
    """Cover w x h, cropped to the middle."""
    k = max(w / im.width, h / im.height)
    im = im.resize((int(im.width * k + 0.5), int(im.height * k + 0.5)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def lens(im, v, S, kind):
    """The desktop still cropped to the photo's lens: its horizontal field from the 35 mm-equivalent focal
    length, against the game's (its vertical field and the still's shape)."""
    import math
    if kind != "desktop" or not v.get("mm"):
        return im
    hm = 2 * math.atan(math.tan(math.radians(S.get("model_vfov_deg", 55)) / 2) * im.width / im.height)
    hp = 2 * math.atan(18.0 / v["mm"])
    k = min(1.0, math.tan(hp / 2) / math.tan(hm / 2))
    w, h = int(im.width * k), int(im.height * k)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def sheets(city, out, photos):
    S = spec(city)
    font = None
    for f in (os.path.join(ROOT, "data", "raw", "fonts", "ZenKakuGothicNew-Black.ttf"), os.path.join(ROOT, "web", "assets", "fonts", "inter-tight-400-latin.woff2")):
        try:
            font = ImageFont.truetype(f, 22)
            break
        except OSError:
            continue
    for kind, (w, h) in (("desktop", (720, 450)), ("phone", (300, 650))):
        d_in = os.path.join(out, kind)
        if not os.path.isdir(d_in):
            continue
        for v in S["views"]:
            cells = [("photo", Image.open(os.path.join(photos, v["photo"])).convert("RGB"), v["credit"])]
            cells += [(t, lens(Image.open(os.path.join(d_in, f"{v['id']}_{t}.png")).convert("RGB"), v, S, kind), f"model, {t}") for t in S["times"]
                      if os.path.exists(os.path.join(d_in, f"{v['id']}_{t}.png"))]
            sheet = Image.new("RGB", (w * len(cells) + 8 * (len(cells) - 1), h + 40), (14, 16, 20))
            dr = ImageDraw.Draw(sheet)
            for k, (_, im, cap) in enumerate(cells):
                sheet.paste(fit(im, w, h), (k * (w + 8), 0))
                dr.text((k * (w + 8) + 8, h + 8), cap, font=font, fill=(220, 222, 226))
            path = os.path.join(out, f"{v['id']}_{kind}.jpg")
            sheet.save(path, quality=86)
            print(path)


if __name__ == "__main__":
    cmd, city, out = sys.argv[1:4]
    if cmd == "views":
        views(city, out)
    else:
        sheets(city, out, sys.argv[4])
