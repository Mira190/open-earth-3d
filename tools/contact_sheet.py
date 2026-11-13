"""Lay stills side by side for a before/after look: python tools/contact_sheet.py out.png cols width img1 [img2 ...]
Each still is scaled to `width` px wide and labelled with its file name (a "-" leaves a gap)."""
import sys
from PIL import Image, ImageDraw
out, cols, width, files = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4:]
ims = []
for f in files:
    if f == '-':
        ims.append((None, '')); continue
    im = Image.open(f).convert('RGB')
    ims.append((im.resize((width, round(im.height * width / im.width))), f.rsplit('/', 1)[-1].rsplit('.', 1)[0]))
h = max(i.height for i, _ in ims if i)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * width, rows * (h + 18)), (12, 12, 14))
d = ImageDraw.Draw(sheet)
for k, (im, name) in enumerate(ims):
    x, y = (k % cols) * width, (k // cols) * (h + 18)
    if im:
        sheet.paste(im, (x, y + 18))
    d.text((x + 4, y + 3), name, fill=(220, 220, 220))
sheet.save(out)
