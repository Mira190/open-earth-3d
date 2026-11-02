"""Programmes for a city's big LED screens: the keyframes web/world.js plays ("led_screen").

A sheet is a grid of cells, each a keyframe; a clip is `frames` cells in a row, and a screen plays
its clips in turn (world.js pushes slowly into each keyframe and wipes to the next). The pictures
are original and the brands invented: the screens of a real crossing show adverts, music, films and
public notices, and these are stand-ins of those kinds, not copies of any.

    sheet = draw_sheet(CLIPS, cols=4, cell=(512, 340))     # a PIL image
    sheet.save("screens.jpg", quality=88)

Each clip is (name, [keyframe, ...]); a keyframe is a function f(img, rng) that draws into an RGB
image of the cell's size at twice the resolution (the sheet is drawn large and scaled down, so
edges and type are smooth). The helpers below are the kit: gradients, glows, rings, bokeh, light
streaks, a synthwave grid, stars, and a few product shapes (a can, a phone, a shoe, a lipstick,
a cup, a figure).
"""
import math
import os
import urllib.request

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_URL = "https://raw.githubusercontent.com/google/fonts/main/{}"
# display faces for the screens: Google Fonts, SIL Open Font License, fetched once into data/raw/fonts
FONTS = {
    "dela": "ofl/delagothicone/DelaGothicOne-Regular.ttf",          # heavy Japanese display
    "zen": "ofl/zenkakugothicnew/ZenKakuGothicNew-Black.ttf",       # black Japanese gothic
    "rounded": "ofl/mplusrounded1c/MPLUSRounded1c-ExtraBold.ttf",   # rounded Japanese
    "mincho": "ofl/shipporimincho/ShipporiMincho-Bold.ttf",         # Japanese serif
    "anton": "ofl/anton/Anton-Regular.ttf",                         # condensed Latin display
    "bebas": "ofl/bebasneue/BebasNeue-Regular.ttf",                 # tall Latin caps
    "monoton": "ofl/monoton/Monoton-Regular.ttf",                   # neon-tube Latin
    "dot": "ofl/dotgothic16/DotGothic16-Regular.ttf",               # dot-matrix
    "reggae": "ofl/reggaeone/ReggaeOne-Regular.ttf",                # playful Japanese
}


def font(name, size):
    d = os.path.join(ROOT, "data", "raw", "fonts")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, os.path.basename(FONTS[name]))
    if not os.path.exists(path):
        req = urllib.request.Request(FONT_URL.format(FONTS[name]), headers={"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()  # all of it before the file exists: a broken download leaves no empty font behind
        with open(path + ".part", "wb") as f:
            f.write(data)
        os.replace(path + ".part", path)
    return ImageFont.truetype(path, int(size))


def rgb(c):
    if isinstance(c, str):
        c = c.lstrip("#")
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
    return tuple(int(v) for v in c)


# ---------------------------------------------------------------- backgrounds and light

def gradient(img, c0, c1, angle=90.0, c2=None):
    """A linear gradient across the whole image (angle in degrees: 90 runs top to bottom)."""
    w, h = img.size
    a = math.radians(angle)
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    t = ((x - w / 2) * math.cos(a) + (y - h / 2) * math.sin(a)) / (abs(w * math.cos(a)) + abs(h * math.sin(a))) + 0.5
    t = np.clip(t, 0, 1)[..., None]
    c0, c1 = np.array(rgb(c0), np.float32), np.array(rgb(c1), np.float32)
    if c2 is None:
        out = c0 + (c1 - c0) * t
    else:
        c2 = np.array(rgb(c2), np.float32)
        out = np.where(t < 0.5, c0 + (c1 - c0) * t * 2, c1 + (c2 - c1) * (t - 0.5) * 2)
    img.paste(Image.fromarray(out.astype(np.uint8)))


def add_light(img, layer, k=1.0):
    """Add a light layer (RGB) to the image, as light adds: screen-blended so it never clips harshly."""
    if k != 1.0:
        layer = Image.eval(layer, lambda v: int(min(255, v * k)))
    img.paste(ImageChops.screen(img, layer))


def glow(img, draw_fn, radius, k=1.0, sharp=True):
    """Draw shapes onto a black layer, blur it into a glow and add it; then add the shapes themselves."""
    layer = Image.new("RGB", img.size, (0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    add_light(img, layer.filter(ImageFilter.GaussianBlur(radius)), k)
    if sharp:
        add_light(img, layer)


def blob(img, xy, r, colour, k=1.0):
    """A soft round light (radial glow)."""
    x, y = xy
    glow(img, lambda d: d.ellipse([x - r * 0.5, y - r * 0.5, x + r * 0.5, y + r * 0.5], fill=rgb(colour)), r * 0.45, k, sharp=False)


def rings(img, xy, radii, colour, width, k=1.0):
    x, y = xy
    glow(img, lambda d: [d.ellipse([x - r, y - r, x + r, y + r], outline=rgb(colour), width=int(width)) for r in radii], width * 2.5, k)


def bokeh(img, rng, n, colours, rmin, rmax, k=0.6):
    w, h = img.size
    layer = Image.new("RGB", img.size, (0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(n):
        r = rmin + (rmax - rmin) * rng.random() ** 2
        x, y = rng.random() * w, rng.random() * h
        c = rgb(colours[int(rng.integers(len(colours)))])
        a = 0.25 + 0.75 * rng.random()
        d.ellipse([x - r, y - r, x + r, y + r], fill=tuple(int(v * a) for v in c))
    add_light(img, layer.filter(ImageFilter.GaussianBlur(rmin * 0.4)), k)


def streaks(img, rng, n, colour, angle=-20.0, k=0.8):
    """Light streaks across the frame (a motion-graphics swoosh)."""
    w, h = img.size
    a = math.radians(angle)
    ux, uy = math.cos(a), math.sin(a)

    def fn(d):
        for _ in range(n):
            cx, cy, L = rng.random() * w, rng.random() * h, (0.3 + 0.6 * rng.random()) * w
            d.line([(cx - ux * L / 2, cy - uy * L / 2), (cx + ux * L / 2, cy + uy * L / 2)], fill=rgb(colour), width=int(2 + 5 * rng.random()))
    glow(img, fn, 6, k)


def stars(img, rng, n, top=1.0):
    w, h = img.size
    d = ImageDraw.Draw(img)
    for _ in range(n):
        x, y, b = rng.random() * w, rng.random() * h * top, 120 + int(135 * rng.random() ** 3)
        r = 0.8 + 1.8 * rng.random() ** 6
        d.ellipse([x - r, y - r, x + r, y + r], fill=(b, b, min(255, b + 20)))


def synth_grid(img, horizon, colour, k=1.0):
    """A glowing perspective grid running to the horizon (y as a fraction of the height)."""
    w, h = img.size
    hy = h * horizon

    def fn(d):
        for i in range(-14, 15):
            d.line([(w / 2 + i * w * 0.012, hy), (w / 2 + i * w * 0.22, h)], fill=rgb(colour), width=3)
        for j in range(1, 12):
            y = hy + (h - hy) * (j / 11) ** 2.2
            d.line([(0, y), (w, y)], fill=rgb(colour), width=3)
    glow(img, fn, 7, k)


def stripes(img, box, colour, n=7, slant=0.35):
    """Zebra bars, as on the crossing (a band of white bars across a box)."""
    x0, y0, x1, y1 = box
    d = ImageDraw.Draw(img)
    bw = (x1 - x0) / (2 * n)
    for i in range(n):
        a = x0 + (2 * i + 0.5) * bw
        d.polygon([(a, y1), (a + bw, y1), (a + bw + (y1 - y0) * slant, y0), (a + (y1 - y0) * slant, y0)], fill=rgb(colour))


# ---------------------------------------------------------------- type

def text(img, xy, s, face, size, fill="#ffffff", anchor="mm", glow_c=None, glow_r=0, k=1.0, max_w=None, stroke=0, stroke_c=None, spacing=0):
    """Type at xy; shrunk to max_w if given; with a coloured glow behind it when glow_c is given."""
    d = ImageDraw.Draw(img)
    f = font(face, size)
    if max_w:
        while d.textlength(s, font=f) + spacing * len(s) > max_w and size > 8:
            size *= 0.94
            f = font(face, size)
    if spacing:
        total = d.textlength(s, font=f) + spacing * (len(s) - 1)
        x = xy[0] - total / 2 if anchor[0] == "m" else xy[0]
        for ch in s:
            text(img, (x, xy[1]), ch, face, size, fill, "l" + anchor[1], glow_c, glow_r, k, stroke=stroke, stroke_c=stroke_c)
            x += d.textlength(ch, font=f) + spacing
        return size
    if glow_c:
        glow(img, lambda dd: dd.text(xy, s, font=f, fill=rgb(glow_c), anchor=anchor), glow_r or size * 0.18, k, sharp=False)
    d.text(xy, s, font=f, fill=rgb(fill), anchor=anchor, stroke_width=int(stroke), stroke_fill=rgb(stroke_c) if stroke_c else None)
    return size


def vtext(img, xy, s, face, size, fill="#ffffff", gap=1.05, glow_c=None):
    """Japanese set top to bottom from xy (the top centre)."""
    x, y = xy
    for ch in s:   # the long vowel mark turns with the line
        text(img, (x, y + size / 2), "｜" if ch == "ー" else ch, face, size, fill, glow_c=glow_c)
        y += size * gap


def pill(img, box, fill, s, face, size, fg):
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=(y1 - y0) / 2, fill=rgb(fill))
    text(img, ((x0 + x1) / 2, (y0 + y1) / 2), s, face, size, fg, max_w=(x1 - x0) * 0.86)


# ---------------------------------------------------------------- shapes

def can(img, cx, cy, h, body, accent, label, face="anton"):
    """A drink can standing, lit from the left: a bright band, a dark edge, the label."""
    w = h * 0.42
    m = Image.new("L", img.size, 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], radius=w * 0.12, fill=255)
    xs = np.clip((np.arange(img.size[0]) - (cx - w / 2)) / w, 0, 1)[None, :, None]
    base = np.array(rgb(body), np.float32)
    shade = 0.55 + 0.75 * np.exp(-((xs - 0.3) / 0.12) ** 2) + 0.25 * np.exp(-((xs - 0.8) / 0.08) ** 2) - 0.35 * xs
    arr = np.clip(base * shade, 0, 255) * np.ones((img.size[1], 1, 1))
    layer = Image.fromarray(arr.astype(np.uint8))
    img.paste(layer, (0, 0), m)
    dd = ImageDraw.Draw(img)
    dd.rectangle([cx - w / 2, cy - h * 0.05, cx + w / 2, cy + h * 0.12], fill=rgb(accent))
    dd.ellipse([cx - w / 2, cy - h / 2 - w * 0.08, cx + w / 2, cy - h / 2 + w * 0.12], fill=(200, 204, 210))
    text(img, (cx, cy + h * 0.035), label, face, h * 0.12, "#ffffff", max_w=w * 0.9)


def phone(img, cx, cy, h, screen_fn, frame="#1b1d22"):
    w = h * 0.48
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], radius=w * 0.16, fill=rgb(frame), outline=(90, 94, 104), width=max(2, int(h * 0.008)))
    sx0, sy0, sx1, sy1 = cx - w / 2 + h * 0.02, cy - h / 2 + h * 0.02, cx + w / 2 - h * 0.02, cy + h / 2 - h * 0.02
    scr = Image.new("RGB", (int(sx1 - sx0), int(sy1 - sy0)))
    screen_fn(scr)
    m = Image.new("L", scr.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, scr.size[0] - 1, scr.size[1] - 1], radius=w * 0.13, fill=255)
    img.paste(scr, (int(sx0), int(sy0)), m)
    d.ellipse([cx - h * 0.018, cy - h / 2 + h * 0.035, cx + h * 0.018, cy - h / 2 + h * 0.07], fill=(10, 10, 12))


def soft_shape(img, colour, draw_fn, r):
    """Shapes drawn on a mask, rounded by a blur and a threshold (organic silhouettes), then filled."""
    m = Image.new("L", img.size, 0)
    draw_fn(ImageDraw.Draw(m))
    m = m.filter(ImageFilter.GaussianBlur(r)).point(lambda v: 255 if v > 110 else int(v * 255 / 110) if v > 90 else 0)
    img.paste(Image.new("RGB", img.size, rgb(colour)), (0, 0), m)


def shoe(img, cx, cy, L, upper, sole, accent):
    """A running shoe in profile, toe to the right: a low upper over a thick sole, the swoosh of its stripe."""
    s = L / 100
    P = lambda pts: [(cx + (x - 50) * s, cy + (y - 20) * s) for x, y in pts]
    soft_shape(img, sole, lambda d: d.polygon(P([(0, 26), (4, 33), (90, 33), (100, 28), (98, 22), (2, 22)]), fill=255), 1.5 * s)
    soft_shape(img, upper, lambda d: d.polygon(P([(3, 23), (1, 10), (6, 2), (16, -2), (24, 0), (28, 6), (44, 8), (62, 10), (78, 14), (92, 18), (98, 23)]), fill=255), 2.0 * s)
    d = ImageDraw.Draw(img)
    d.line(P([(12, 18), (36, 9), (60, 16), (84, 20)]), fill=rgb(accent), width=int(3.5 * s), joint="curve")
    for k in range(4):
        d.line(P([(30 + k * 4, 6 + k * 0.5), (34 + k * 4, 10 + k * 0.5)]), fill=(255, 255, 255), width=max(1, int(1.2 * s)))
    d.line(P([(4, 28), (96, 28)]), fill=rgb(accent), width=max(1, int(1.4 * s)))


def lipstick(img, cx, cy, h, case, colour):
    w = h * 0.22
    d = ImageDraw.Draw(img)
    d.rectangle([cx - w / 2, cy, cx + w / 2, cy + h * 0.5], fill=rgb(case))
    d.rectangle([cx - w / 2, cy - h * 0.02, cx + w / 2, cy + h * 0.03], fill=(230, 196, 120))
    d.rectangle([cx - w * 0.38, cy - h * 0.25, cx + w * 0.38, cy - h * 0.02], fill=(214, 180, 110))
    d.polygon([(cx - w * 0.33, cy - h * 0.25), (cx + w * 0.33, cy - h * 0.25), (cx + w * 0.33, cy - h * 0.4), (cx - w * 0.33, cy - h * 0.5)], fill=rgb(colour))
    d.rectangle([cx - w / 2 + w * 0.12, cy + h * 0.02, cx - w / 2 + w * 0.22, cy + h * 0.5], fill=(255, 255, 255))


def cup(img, cx, cy, h, body, band, label):
    """An instant-noodle cup with its lid and steam."""
    d = ImageDraw.Draw(img)
    w0, w1 = h * 0.62, h * 0.48
    d.polygon([(cx - w0 / 2, cy - h / 2), (cx + w0 / 2, cy - h / 2), (cx + w1 / 2, cy + h / 2), (cx - w1 / 2, cy + h / 2)], fill=rgb(body))
    d.polygon([(cx - w0 * 0.47, cy - h * 0.1), (cx + w0 * 0.47, cy - h * 0.1), (cx + w0 * 0.43, cy + h * 0.12), (cx - w0 * 0.43, cy + h * 0.12)], fill=rgb(band))
    d.ellipse([cx - w0 / 2 - 6, cy - h / 2 - h * 0.06, cx + w0 / 2 + 6, cy - h / 2 + h * 0.06], fill=(236, 232, 224))
    text(img, (cx, cy + h * 0.01), label, "dela", h * 0.14, body, max_w=w0 * 0.8)

    def steam(dd):
        for k in (-1, 0, 1):
            pts = [(cx + k * w0 * 0.22 + math.sin(t * 1.3 + k) * h * 0.05, cy - h / 2 - h * 0.1 - t * h * 0.09) for t in np.linspace(0, 4, 20)]
            dd.line(pts, fill=(255, 255, 255), width=int(h * 0.025))
    glow(img, steam, h * 0.03, 0.55, sharp=False)


def figure(img, cx, top, h, colour, coat=True, arms_up=False):
    """A person's silhouette standing, rounded like a photograph's (a model in a long coat, or a
    singer with an arm up)."""
    s = h / 100

    def fn(d):
        d.ellipse([cx - 6.5 * s, top, cx + 6.5 * s, top + 15 * s], fill=255)                                   # head
        d.polygon([(cx - 3 * s, top + 12 * s), (cx + 3 * s, top + 12 * s), (cx + 3.5 * s, top + 19 * s), (cx - 3.5 * s, top + 19 * s)], fill=255)
        if coat:   # shoulders, a coat to the knee, legs below
            d.polygon([(cx - 15 * s, top + 21 * s), (cx - 9 * s, top + 18 * s), (cx + 9 * s, top + 18 * s), (cx + 15 * s, top + 21 * s),
                       (cx + 17 * s, top + 46 * s), (cx + 19 * s, top + 72 * s), (cx - 19 * s, top + 72 * s), (cx - 17 * s, top + 46 * s)], fill=255)
            d.polygon([(cx - 8 * s, top + 70 * s), (cx - 1.5 * s, top + 70 * s), (cx - 3.5 * s, top + 98 * s), (cx - 7.5 * s, top + 98 * s)], fill=255)
            d.polygon([(cx + 1.5 * s, top + 70 * s), (cx + 8 * s, top + 70 * s), (cx + 10 * s, top + 97 * s), (cx + 6 * s, top + 98 * s)], fill=255)
            d.ellipse([cx - 10 * s, top + 95 * s, cx - 2 * s, top + 100 * s], fill=255)
            d.ellipse([cx + 4 * s, top + 95 * s, cx + 12 * s, top + 100 * s], fill=255)
        else:      # a jacket, the waist, legs apart
            d.polygon([(cx - 14 * s, top + 21 * s), (cx - 8 * s, top + 18 * s), (cx + 8 * s, top + 18 * s), (cx + 14 * s, top + 21 * s),
                       (cx + 11 * s, top + 52 * s), (cx - 11 * s, top + 52 * s)], fill=255)
            d.polygon([(cx - 10 * s, top + 50 * s), (cx + 10 * s, top + 50 * s), (cx + 13 * s, top + 98 * s), (cx + 6 * s, top + 98 * s), (cx, top + 62 * s),
                       (cx - 6 * s, top + 98 * s), (cx - 13 * s, top + 98 * s)], fill=255)
            if not arms_up:
                for k in (-1, 1):
                    d.line([(cx + k * 13 * s, top + 22 * s), (cx + k * 15 * s, top + 40 * s), (cx + k * 13 * s, top + 54 * s)], fill=255, width=int(5 * s))
        if arms_up:
            d.line([(cx + 11 * s, top + 22 * s), (cx + 20 * s, top + 8 * s), (cx + 23 * s, top - 9 * s)], fill=255, width=int(5.5 * s))
            d.ellipse([cx + 20 * s, top - 13 * s, cx + 27 * s, top - 6 * s], fill=255)
            d.line([(cx - 11 * s, top + 22 * s), (cx - 16 * s, top + 38 * s), (cx - 9 * s, top + 33 * s)], fill=255, width=int(5.5 * s))
    soft_shape(img, colour, fn, 1.6 * s)


# ---------------------------------------------------------------- the sheet

def draw_sheet(clips, cols=4, cell=(512, 340), seed=2026, scale=2, size=None):
    """All the clips' keyframes in a grid of cells, left to right and down; returns (image, layout)
    with layout = {"sheet": [cols, rows, cell w / image w, cell h / image h], "frames": n, "clips": [names]}."""
    frames = max(len(k) for _, k in clips)
    n = len(clips) * frames
    rows = math.ceil(n / cols)
    W, H = size or (cols * cell[0], rows * cell[1])
    sheet = Image.new("RGB", (W, H), (0, 0, 0))
    rng = np.random.default_rng(seed)
    for ci, (_, keys) in enumerate(clips):
        for fi in range(frames):
            k = ci * frames + fi
            img = Image.new("RGB", (cell[0] * scale, cell[1] * scale), (0, 0, 0))
            keys[min(fi, len(keys) - 1)](img, rng)
            sheet.paste(img.resize(cell, Image.LANCZOS), ((k % cols) * cell[0], (k // cols) * cell[1]))
    return sheet, {"sheet": [cols, rows, cell[0] / W, cell[1] / H], "frames": frames, "clips": [c for c, _ in clips]}
