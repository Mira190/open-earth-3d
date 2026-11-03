#!/usr/bin/env python3
"""Before/after sheets from two runs of tools/style_shots.sh: per city and view group, the
desktop stills at day, dusk and night in rows, before on the left and after on the right, and
the phone stills in a strip (before above, after below). JPEG, for docs/images/.
  python3 tools/style_compare.py before_dir after_dir out_dir [--groups open,machiya]
"""
import argparse, os
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('before'); ap.add_argument('after'); ap.add_argument('out')
ap.add_argument('--groups', help='view groups to include (default: every group but the opening view)')
ap.add_argument('--width', type=int, default=720, help='width of one desktop still')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
TIMES = ['day', 'dusk', 'night']
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18)
except OSError:
    font = ImageFont.load_default()


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 12 + 11 * len(text), 30], fill=(0, 0, 0))
    d.text((6, 4), text, fill=(255, 255, 255), font=font)


def load(path, w):
    im = Image.open(path).convert('RGB')
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


for city in sorted(os.listdir(a.after)):
    da, db = os.path.join(a.after, city, 'desktop'), os.path.join(a.before, city, 'desktop')
    if not os.path.isdir(da) or not os.path.isdir(db):
        continue
    groups = sorted({f.rsplit('-', 1)[0] for f in os.listdir(da) if f.endswith('.png')})
    groups = [g for g in groups if (g in a.groups.split(',') if a.groups else g != 'open')]
    for g in groups:
        rows = []
        for t in TIMES:
            f = f'{g}-{t}.png'
            if not (os.path.exists(os.path.join(db, f)) and os.path.exists(os.path.join(da, f))):
                continue
            l, r = load(os.path.join(db, f), a.width), load(os.path.join(da, f), a.width)
            label(l, f'before · {t}'); label(r, f'after · {t}')
            row = Image.new('RGB', (2 * a.width + 6, l.height), (20, 20, 20))
            row.paste(l, (0, 0)); row.paste(r, (a.width + 6, 0)); rows.append(row)
        if rows:
            sheet = Image.new('RGB', (rows[0].width, sum(r.height for r in rows) + 6 * (len(rows) - 1)), (20, 20, 20))
            y = 0
            for r in rows:
                sheet.paste(r, (0, y)); y += r.height + 6
            sheet.save(os.path.join(a.out, f'{city}-{g}-desktop.jpg'), quality=80, optimize=True)
        # the phone strip
        pa, pb = os.path.join(a.after, city, 'phone'), os.path.join(a.before, city, 'phone')
        cells = [(load(os.path.join(p, f'{g}-{t}.png'), 260), w, t) for w, p in (('before', pb), ('after', pa)) for t in TIMES
                 if os.path.exists(os.path.join(p, f'{g}-{t}.png'))]
        if len(cells) == 6:
            h = cells[0][0].height
            strip = Image.new('RGB', (3 * 260 + 12, 2 * h + 6), (20, 20, 20))
            for k, (im, w, t) in enumerate(cells):
                label(im, f'{w} · {t}')
                strip.paste(im, ((k % 3) * 266, (k // 3) * (h + 6)))
            strip.save(os.path.join(a.out, f'{city}-{g}-phone.jpg'), quality=80, optimize=True)
