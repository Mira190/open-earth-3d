"""Circular Quay West, the Sydney map's hero level (python blender/build_hero.py --city sydney; docs/HERO.md).

Why here: the game starts on the quay in front of the Museum of Contemporary Art, and the walk north along
the water from there, the Opera House across the cove on the right, the sandstone museum over its lawn on
the left, is the most photographed quayside in the country. 140 m of it is small enough to build to the
centimetre: from First Fleet Park's edge to the taxi rank under the Overseas Passenger Terminal.

What is built, on OpenStreetMap's survey of the place (cities/sydney/hero_osm.json, pipeline/hero_osm.py) and
the game's own ground (hero_ground.json, tools/ground_probe.js):

  * the museum's harbour front (the Maritime Services Board building, W. H. Withers and D. Baxter, built
    1946-52): Maroubra sandstone ashlar over a granite base, its two end pavilions (which the city's model
    leaves out) standing 9.3 m forward of the wings, paired steel windows between piers at a 4.3 m storey,
    the tower with its three window strips, the three carved panels, the clock, the stepped top and its
    flags, and the glass floor added on the roof; proportioned from photographs over the measured plan;
  * the Mordant Wing north of it (Sam Marshall, 2012), in outline: white, grey and black boxes over a glazed
    entrance, the lettering, and Brook Andrew's arrow on its wall;
  * Tallawoladah Lawn, the forecourt and the seat wall (the palms along it are the map's own trees: city.json
    trees.areas);
  * the promenade: sawn granite in bands, the Writers Walk's bronze plaques where they lie (eight of them
    here, by name), drains and covers, the sandstone coping, the timber fender, mooring bollards, ladders;
  * on it: the quay's tall lamp posts with their banners, benches, bins, wayfinding pylons, the bollards
    across the taxi rank, and Lindy Lee's perforated steel ovoid, lit from inside after dark.

Nothing here is a logo; the lettering is the buildings' own names. The banners' and pylons' designs are
this project's.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "blender"))

import adkit as ad  # noqa: E402
import hero_parts as hp  # noqa: E402

ID = "quay-west"
Y0, Y1 = 164.0, 299.0             # the level along the quay
ZB = 3.0                          # the fronts' foot, under the paving
ZF = 4.0                          # the museum's ground floor
STOREY = 4.3                      # its storey (six in the wings' 25.7 m, from photographs)
A0, B0 = (-225.79, 173.13), (-219.54, 248.95)   # the wings' harbour face, south to north (OSM's building parts)
WALL = ((-185.16, 172.86), (-178.71, 246.85))   # the lawn's retaining wall (OSM barrier=retaining_wall)
SAND = (216, 176, 118)            # Maroubra sandstone (sRGB): the grey ashlar texture is tinted to it
SAND_D = (202, 160, 102)


def materials(K):
    T = K.tint_to
    return {
        "ground_granite": {"tex": "granite_pave", "tint": T("granite_pave", (122, 120, 117)), "rough": 0.6},
        "ground_granite_dark": {"tex": "granite_pave", "tint": T("granite_pave", (66, 66, 70)), "rough": 0.5},
        "ground_fore": {"tex": "granite_pave", "tint": T("granite_pave", (138, 129, 114)), "rough": 0.7},
        "ground_kerb": {"tex": "stone", "tint": T("stone", (150, 132, 102)), "rough": 0.75, "maps": "cn"},
        "ground_iron": {"map": "atlas", "rough": 0.5, "metal": 0.7},
        "ground_stain": {"color": (0.05, 0.05, 0.05), "rough": 0.6, "alpha": 0.28},
        "lawn_grass": {"tex": "grass", "tint": T("grass", (66, 96, 42)), "rough": 0.95, "maps": "cn"},
        "stone_ashlar": {"tex": "ashlar", "tint": T("ashlar", SAND), "rough": 0.85, "bump": 0.7},
        "stone_ashlar_d": {"tex": "ashlar", "tint": T("ashlar", SAND_D), "rough": 0.85, "bump": 0.7},
        "stone_rubble": {"tex": "rubble", "tint": T("rubble", (204, 172, 124)), "rough": 0.9, "maps": "cn"},
        "stone_coping": {"tex": "stone", "tint": T("stone", (156, 134, 100)), "rough": 0.8, "maps": "cn"},
        "stone_plinth": {"tex": "granite", "tint": T("granite", (122, 88, 80)), "rough": 0.35, "maps": "c"},
        "grc_white": {"tex": "conc", "tint": T("conc", (236, 236, 232)), "rough": 0.6, "maps": "c"},
        "grc_grey": {"tex": "conc", "tint": T("conc", (92, 94, 98)), "rough": 0.6, "maps": "c"},
        "grc_black": {"color": (0.03, 0.03, 0.035), "rough": 0.45},
        "paint_white": {"color": (0.9, 0.9, 0.88), "rough": 0.5},
        "floor_hall": {"color": (0.42, 0.41, 0.4), "rough": 0.22},
        "wood_bench": {"color": (0.36, 0.2, 0.1), "rough": 0.65},
        "wood_wharf": {"tex": "deck", "tint": T("deck", (112, 96, 84)), "rough": 0.9, "maps": "c"},
        "metal_pole": {"color": (0.1, 0.105, 0.11), "rough": 0.45, "metal": 0.8},
        "metal_steel": {"color": (0.62, 0.63, 0.64), "rough": 0.3, "metal": 1.0},
        "metal_dark": {"color": (0.035, 0.037, 0.04), "rough": 0.45, "metal": 0.7},
        "metal_bronze": {"color": (0.13, 0.09, 0.05), "rough": 0.4, "metal": 0.9},
        "iron_black": {"color": (0.02, 0.02, 0.022), "rough": 0.55, "metal": 0.6},
        "rubber": {"color": (0.02, 0.02, 0.02), "rough": 0.9},
        "paint_yellow": {"color": (0.85, 0.6, 0.02), "rough": 0.5},
        "glass_green": {"color": (0.03, 0.07, 0.065), "rough": 0.05, "metal": 0.6},
        "glass_dark": {"color": (0.02, 0.03, 0.04), "rough": 0.04, "metal": 0.5},
        "glass_hall": {"color": (0.03, 0.04, 0.045), "rough": 0.03, "metal": 0.2, "alpha": 0.32},
        "atlas_flat": {"map": "atlas", "rough": 0.8},
        "atlas_cloth": {"map": "atlas", "rough": 0.9},
        "atlas_bronze": {"map": "atlas", "rough": 0.38, "metal": 0.85},
        "win_glass": {"map": "atlas", "tint": (0.3, 0.3, 0.32), "rough": 0.06, "metal": 0.0, "emissive": True, "glow": 1.0},
        "glow_ember": {"map": "atlas", "rough": 0.1, "metal": 1.0, "emissive": True, "glow": 0.55},
        "glow_lamp": {"color": (1.0, 0.95, 0.85), "emissive": (1.0, 0.86, 0.66), "glow": 6.0},
        "glow_up": {"color": (1.0, 0.9, 0.7), "emissive": (1.0, 0.8, 0.55), "glow": 4.0},
    }


# ---------------------------------------------------------------- the atlas

def _box(r):
    x, y, w, h = r
    return [x, y, x + w - 1, y + h - 1]


def draw_room(rng, lit):
    from PIL import ImageDraw

    def draw(img, r):
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        if not lit:
            # dark glass: the room's depth, a blind half down now and then
            for j in range(h):
                v = int(16 + 10 * (1 - j / h))
                d.line([x, y + j, x + w - 1, y + j], fill=(v, v + 2, v + 5))
            if rng.random() < 0.5:
                bh = int(h * (0.2 + 0.4 * rng.random()))
                d.rectangle([x, y, x + w - 1, y + bh], fill=(52, 50, 46))
                for j in range(0, bh, 5):
                    d.line([x, y + j, x + w - 1, y + j], fill=(40, 38, 35))
            return
        c = (255, 222, 170) if rng.random() < 0.7 else (228, 236, 255)
        k = 0.6 + 0.4 * rng.random()
        c = tuple(int(v * k) for v in c)
        d.rectangle(_box(r), fill=c)
        d.rectangle([x, y, x + w - 1, y + int(h * 0.12)], fill=tuple(min(255, int(v * 1.25)) for v in c))   # the ceiling's light
        d.rectangle([x, y + int(h * 0.78), x + w - 1, y + h - 1], fill=tuple(int(v * 0.45) for v in c))       # a desk, a plinth
    return draw


def draw_stone(tone=(214, 172, 112)):
    """A sandstone ground for carved and drawn things: flat tone with a little grain."""
    def draw(img, r):
        x, y, w, h = r
        rng = np.random.default_rng(w * 31 + h)
        a = np.clip(np.asarray(tone)[None, None, :] + rng.normal(0, 5, (h, w, 1)), 0, 255).astype(np.uint8)
        from PIL import Image
        img.paste(Image.fromarray(a, "RGB"), (x, y))
    return draw


def draw_clock(img, r):
    from PIL import ImageDraw
    draw_stone()(img, r)
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    cx, cy, R = x + w / 2, y + h / 2, w * 0.46
    for k in range(12):
        a = math.radians(k * 30)
        r0, r1 = R * (0.74 if k % 3 == 0 else 0.82), R * 0.97
        d.line([cx + math.sin(a) * r0, cy - math.cos(a) * r0, cx + math.sin(a) * r1, cy - math.cos(a) * r1], fill=(18, 16, 14), width=max(3, int(w * 0.035)))
    for a, ln, wd in ((math.radians(305), 0.5, 0.05), (math.radians(48), 0.8, 0.035)):   # ten past ten
        d.line([cx, cy, cx + math.sin(a) * R * ln, cy - math.cos(a) * R * ln], fill=(18, 16, 14), width=max(3, int(w * wd)))
    d.ellipse([cx - w * 0.03, cy - w * 0.03, cx + w * 0.03, cy + w * 0.03], fill=(18, 16, 14))


def draw_relief(kind):
    """One of the tower's three carved panels (a flower, a ship's wheel, an anchor), as incised stone."""
    from PIL import ImageDraw

    def draw(img, r):
        draw_stone((205, 162, 104))(img, r)
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        cx, cy, R = x + w / 2, y + h / 2, w * 0.36
        dk, lt = (150, 112, 66), (236, 198, 140)
        d.rectangle([x + 3, y + 3, x + w - 4, y + h - 4], outline=dk, width=3)
        if kind == 0:
            for k in range(4):
                a = math.radians(45 + 90 * k)
                px, py = cx + math.cos(a) * R * 0.55, cy + math.sin(a) * R * 0.55
                d.ellipse([px - R * 0.42, py - R * 0.42, px + R * 0.42, py + R * 0.42], outline=dk, width=4)
            d.ellipse([cx - R * 0.2, cy - R * 0.2, cx + R * 0.2, cy + R * 0.2], fill=lt, outline=dk, width=3)
        elif kind == 1:
            d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=dk, width=6)
            d.ellipse([cx - R * 0.3, cy - R * 0.3, cx + R * 0.3, cy + R * 0.3], outline=dk, width=4)
            for k in range(8):
                a = math.radians(45 * k)
                d.line([cx, cy, cx + math.cos(a) * R * 1.22, cy + math.sin(a) * R * 1.22], fill=dk, width=4)
        else:
            d.line([cx, cy - R, cx, cy + R], fill=dk, width=7)
            d.line([cx - R * 0.5, cy - R * 0.62, cx + R * 0.5, cy - R * 0.62], fill=dk, width=6)
            d.ellipse([cx - R * 0.16, cy - R * 1.22, cx + R * 0.16, cy - R * 0.9], outline=dk, width=4)
            d.arc([cx - R * 0.85, cy - R * 0.1, cx + R * 0.85, cy + R * 1.05], 10, 170, fill=dk, width=7)
    return draw


def draw_words(lines, bg, fg, face="bebas", pad=0.14, stone=False, align="m"):
    def draw(img, r):
        from PIL import ImageDraw
        x, y, w, h = r
        if stone:
            draw_stone(bg)(img, r)
        else:
            ImageDraw.Draw(img).rectangle(_box(r), fill=bg)
        n = len(lines)
        lh = h * (1 - 2 * pad) / n
        for i, s in enumerate(lines):
            if align == "m":
                ad.text(img, (x + w / 2, y + h * pad + lh * (i + 0.5)), s, face, lh * 0.92, fill=fg, max_w=w * 0.92)
            else:
                ad.text(img, (x + w * 0.07, y + h * pad + lh * (i + 0.5)), s, face, lh * 0.92, fill=fg, anchor="lm", max_w=w * 0.88)
    return draw


def draw_lobby(rng, warm=True):
    """A glazed ground floor seen from outside: a lit hall, a desk, pictures on the back wall, people's shapes."""
    from PIL import ImageDraw

    def draw(img, r):
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        top, bot = ((255, 236, 200), (190, 150, 105)) if warm else ((236, 240, 246), (150, 156, 165))
        for j in range(h):
            t = j / h
            d.line([x, y + j, x + w - 1, y + j], fill=tuple(int(top[k] * (1 - t) + bot[k] * t) for k in range(3)))
        for k in range(6):       # pictures on the far wall
            px = x + int(w * (0.05 + 0.155 * k)); pw = int(w * 0.09); py = y + int(h * 0.3)
            d.rectangle([px, py, px + pw, py + int(h * 0.26)], fill=tuple(int(v) for v in rng.integers(30, 220, 3)))
        d.rectangle([x + int(w * 0.62), y + int(h * 0.7), x + int(w * 0.9), y + int(h * 0.84)], fill=(60, 52, 44))      # the desk
        d.rectangle([x, y + int(h * 0.86), x + w - 1, y + h - 1], fill=tuple(int(v * 0.55) for v in bot))            # the floor
        for k in range(5):       # people, as shapes against the light
            px = x + int(w * (0.1 + 0.8 * rng.random())); ph = int(h * (0.3 + 0.06 * rng.random()))
            ad.figure(img, px, y + int(h * 0.9) - ph, ph, (40, 38, 42), coat=bool(rng.random() < 0.5))
        for k in range(1, 6):    # the glazing's mullions
            mx = x + int(w * k / 6)
            d.rectangle([mx - 1, y, mx + 1, y + h - 1], fill=(30, 30, 32))
    return draw


def draw_plaque(name):
    """A Writers Walk plaque: a bronze disc, the writer's name round a quotation's lines (not transcribed)."""
    from PIL import ImageDraw

    def draw(img, r):
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        d.rectangle(_box(r), fill=(96, 70, 38))
        cx, cy, R = x + w / 2, y + h / 2, w * 0.49
        d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(122, 90, 48), outline=(70, 50, 26), width=3)
        d.ellipse([cx - R * 0.9, cy - R * 0.9, cx + R * 0.9, cy + R * 0.9], outline=(160, 124, 70), width=2)
        ad.text(img, (cx, cy - R * 0.52), name.upper(), "bebas", h * 0.13, fill=(214, 178, 110), max_w=w * 0.62)
        for i in range(6):       # the quotation, as lines of raised type
            ww = R * (1.25 - 0.1 * abs(i - 2.5))
            yy = cy - R * 0.22 + i * R * 0.15
            for sx in np.arange(cx - ww / 2, cx + ww / 2, 7):
                d.line([sx, yy, sx + 4, yy], fill=(176, 140, 82), width=2)
        ad.text(img, (cx, cy + R * 0.74), "WRITERS WALK", "bebas", h * 0.07, fill=(186, 150, 90))
    return draw


def draw_banner(i):
    from PIL import ImageDraw

    def draw(img, r):
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        bg, fg, ac = [((14, 60, 92), (240, 236, 224), (240, 150, 40)), ((196, 62, 38), (250, 240, 226), (20, 40, 60))][i]
        d.rectangle(_box(r), fill=bg)
        for k in range(5):       # the harbour's arcs: sails and a bridge's arch, abstracted
            rr = w * (0.5 + 0.28 * k)
            d.arc([x + w * 0.5 - rr, y + h * 0.78 - rr * 0.5, x + w * 0.5 + rr, y + h * 0.78 + rr * 0.9], 200, 340, fill=ac if k % 2 else fg, width=3)
        ad.vtext(img, (x + w / 2, y + h * 0.3), "SYDNEY" if i == 0 else "HARBOUR", "bebas", w * 0.42, fill=fg, gap=0.95)
        ad.text(img, (x + w / 2, y + h * 0.94), "CIRCULAR QUAY" if i == 0 else "THE ROCKS", "bebas", w * 0.13, fill=fg, max_w=w * 0.9)
    return draw


def draw_pylon(img, r):
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle(_box(r), fill=(24, 26, 30))
    d.rectangle([x, y, x + w - 1, y + int(h * 0.07)], fill=(232, 150, 30))
    ad.text(img, (x + w / 2, y + h * 0.13), "i", "bebas", h * 0.08, fill=(240, 240, 236))
    rows = [("↑", "The Rocks", "3 min"), ("↑", "Overseas Passenger Terminal", "2 min"), ("←", "Museum of Contemporary Art", "1 min"),
            ("↓", "Circular Quay ferries", "2 min"), ("↓", "Circular Quay station", "4 min"), ("→", "Opera House", "12 min")]
    for i, (_, name, t) in enumerate(rows):
        yy = y + h * (0.24 + 0.085 * i)
        ad.text(img, (x + w * 0.1, yy), name, "bebas", h * 0.036, fill=(236, 236, 230), anchor="lm", max_w=w * 0.62)
        ad.text(img, (x + w * 0.92, yy), t, "bebas", h * 0.03, fill=(150, 156, 164), anchor="rm")
        d.line([x + w * 0.1, yy + h * 0.036, x + w * 0.92, yy + h * 0.036], fill=(60, 64, 70), width=1)
    d.rectangle([x + int(w * 0.1), y + int(h * 0.78), x + int(w * 0.9), y + int(h * 0.95)], fill=(40, 60, 72))     # a map, as a field
    d.line([x + w * 0.2, y + h * 0.93, x + w * 0.5, y + h * 0.8, x + w * 0.85, y + h * 0.86], fill=(220, 200, 150), width=3)
    d.ellipse([x + w * 0.46, y + h * 0.845, x + w * 0.54, y + h * 0.865], fill=(232, 150, 30))


def draw_flag(kind):
    from PIL import ImageDraw

    def draw(img, r):
        x, y, w, h = r
        d = ImageDraw.Draw(img)
        if kind == "aboriginal":
            d.rectangle([x, y, x + w - 1, y + h // 2], fill=(12, 12, 12))
            d.rectangle([x, y + h // 2, x + w - 1, y + h - 1], fill=(204, 30, 26))
            R = h * 0.26
            d.ellipse([x + w / 2 - R, y + h / 2 - R, x + w / 2 + R, y + h / 2 + R], fill=(255, 210, 0))
        else:
            d.rectangle(_box(r), fill=(1, 33, 105))
            cw, ch = w // 2, h // 2
            d.line([x, y, x + cw, y + ch], fill=(255, 255, 255), width=max(3, h // 10)); d.line([x, y + ch, x + cw, y], fill=(255, 255, 255), width=max(3, h // 10))
            d.line([x, y, x + cw, y + ch], fill=(200, 16, 46), width=max(1, h // 28)); d.line([x, y + ch, x + cw, y], fill=(200, 16, 46), width=max(1, h // 28))
            d.rectangle([x + cw // 2 - h // 12, y, x + cw // 2 + h // 12, y + ch], fill=(255, 255, 255)); d.rectangle([x, y + ch // 2 - h // 12, x + cw, y + ch // 2 + h // 12], fill=(255, 255, 255))
            d.rectangle([x + cw // 2 - h // 24, y, x + cw // 2 + h // 24, y + ch], fill=(200, 16, 46)); d.rectangle([x, y + ch // 2 - h // 24, x + cw, y + ch // 2 + h // 24], fill=(200, 16, 46))
            def star(cx, cy, R, n=7):
                pts = []
                for k in range(2 * n):
                    a = math.pi * k / n - math.pi / 2
                    rr = R if k % 2 == 0 else R * 0.45
                    pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
                d.polygon(pts, fill=(255, 255, 255))
            star(x + cw * 0.5, y + h * 0.76, h * 0.14)
            for sx, sy, sr in ((0.75, 0.18, 0.06), (0.63, 0.45, 0.06), (0.87, 0.4, 0.06), (0.75, 0.8, 0.06), (0.8, 0.56, 0.03)):
                star(x + w * sx, y + h * sy, h * sr, 7 if sr > 0.04 else 5)
    return draw


def draw_ember(img, r):
    """The ovoid's skin: mirror-polished steel pierced by thousands of small holes, in drifts (they glow after dark)."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle(_box(r), fill=(120, 124, 128))
    rng = np.random.default_rng(88)
    for _ in range(9000):
        cx, cy = rng.random() * w, rng.random() * h
        k = 0.5 + 0.5 * math.sin(cx / w * 12.566 + math.sin(cy / h * 9.42) * 1.6)
        if rng.random() > 0.15 + 0.85 * k * k:
            continue
        rr = 0.5 + 1.3 * rng.random() ** 4
        d.ellipse([x + cx - rr, y + cy - rr, x + cx + rr, y + cy + rr], fill=(255, 224, 168))


def draw_art(i):
    """A large canvas on a gallery wall: fields of colour, soft-edged."""
    def draw(img, r):
        from PIL import Image, ImageFilter
        x, y, w, h = r
        rng = np.random.default_rng(300 + i)
        pal = [[(196, 70, 44), (228, 190, 120), (40, 52, 70)], [(30, 70, 96), (190, 200, 196), (214, 150, 60)],
               [(222, 214, 196), (60, 60, 58), (150, 50, 44)], [(74, 96, 66), (216, 196, 150), (28, 30, 36)]][i % 4]
        im = Image.new("RGB", (w, h), pal[1])
        from PIL import ImageDraw
        d = ImageDraw.Draw(im)
        for k in range(7):
            c = pal[int(rng.integers(3))]
            x0, y0 = rng.random() * w, rng.random() * h
            d.rectangle([x0 - w * 0.3 * rng.random(), y0 - h * 0.2 * rng.random(), x0 + w * 0.4 * rng.random(), y0 + h * 0.35 * rng.random()], fill=c)
        im = im.filter(ImageFilter.GaussianBlur(w * 0.03))
        img.paste(im, (x, y))
    return draw


def draw_doors(img, r):
    """The tower's entrance: three pairs of bronze doors, glazed, under a bronze grille."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle(_box(r), fill=(52, 38, 24))
    for k in range(3):
        x0 = x + int(w * (0.03 + 0.325 * k)); ww = int(w * 0.295)
        d.rectangle([x0, y + int(h * 0.04), x0 + ww, y + int(h * 0.26)], fill=(30, 24, 18), outline=(96, 70, 40), width=3)   # the grille over them
        for j in range(1, 9):
            xx = x0 + ww * j // 9
            d.line([xx, y + int(h * 0.04), xx, y + int(h * 0.26)], fill=(96, 70, 40), width=2)
        for leaf in range(2):
            lx = x0 + leaf * ww // 2
            d.rectangle([lx + 2, y + int(h * 0.3), lx + ww // 2 - 2, y + h - 3], fill=(70, 50, 28), outline=(110, 82, 46), width=3)
            d.rectangle([lx + 10, y + int(h * 0.34), lx + ww // 2 - 10, y + int(h * 0.8)], fill=(20, 24, 26))            # its glass
            d.rectangle([lx + 10, y + int(h * 0.34), lx + ww // 2 - 10, y + int(h * 0.42)], fill=(34, 40, 44))
            hx = lx + (ww // 2 - 16 if leaf == 0 else 16)
            d.rectangle([hx - 2, y + int(h * 0.52), hx + 2, y + int(h * 0.68)], fill=(170, 136, 80))                      # the pull


def draw_arrow(img, r):
    """Brook Andrew's Warrang on the wing's wall: a great arrow pointing down, banded."""
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle(_box(r), fill=(150, 150, 146))
    pts = [(0.28, 0.06), (0.72, 0.06), (0.72, 0.5), (0.95, 0.5), (0.5, 0.95), (0.05, 0.5), (0.28, 0.5)]
    d.polygon([(x + w * a, y + h * b) for a, b in pts], fill=(52, 50, 50))
    inner = [(0.36, 0.14), (0.64, 0.14), (0.64, 0.56), (0.78, 0.56), (0.5, 0.84), (0.22, 0.56), (0.36, 0.56)]
    d.polygon([(x + w * a, y + h * b) for a, b in inner], fill=(26, 26, 26))
    for k in range(-6, 10):
        y0 = y + h * (0.14 + 0.07 * k)
        d.polygon([(x + w * 0.37, y0), (x + w * 0.63, y0 - h * 0.06), (x + w * 0.63, y0 - h * 0.03), (x + w * 0.37, y0 + h * 0.03)], fill=(214, 186, 60))
    d.rectangle([x + int(w * 0.36), y, x + int(w * 0.64), y + int(h * 0.13)], fill=(150, 150, 146))


def draw_cover(img, r):
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle(_box(r), fill=(44, 42, 40))
    for i in range(0, w, 10):
        for j in range(0, h, 10):
            if (i // 10 + j // 10) % 2:
                d.rectangle([x + i + 2, y + j + 2, x + i + 7, y + j + 7], fill=(64, 62, 58))
    d.rectangle([x + 2, y + 2, x + w - 3, y + h - 3], outline=(24, 23, 22), width=3)


def draw_drain(img, r):
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle(_box(r), fill=(70, 70, 70))
    for i in range(0, w, 8):
        d.rectangle([x + i + 1, y + 4, x + i + 4, y + h - 5], fill=(10, 10, 10))


def draw_buoy(img, r):
    from PIL import ImageDraw
    x, y, w, h = r
    d = ImageDraw.Draw(img)
    d.rectangle(_box(r), fill=(236, 190, 30))
    cx, cy, R = x + w / 2, y + h * 0.56, w * 0.36
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(214, 40, 30))
    d.ellipse([cx - R * 0.55, cy - R * 0.55, cx + R * 0.55, cy + R * 0.55], fill=(236, 190, 30))
    for a in (45, 135, 225, 315):
        d.pieslice([cx - R, cy - R, cx + R, cy + R], a - 9, a + 9, fill=(250, 250, 250))
    d.ellipse([cx - R * 0.55, cy - R * 0.55, cx + R * 0.55, cy + R * 0.55], fill=(236, 190, 30))
    ad.text(img, (cx, y + h * 0.1), "LIFEBUOY", "bebas", h * 0.12, fill=(20, 20, 20))


# ---------------------------------------------------------------- the level

class Level:
    def __init__(self, K):
        self.K = K
        self.geo = K.Geo()
        self.A = K.Atlas(2048)
        self.G = hp.Ground(os.path.join(HERE, "hero_ground.json"))
        self.osm = json.load(open(os.path.join(HERE, "hero_osm.json")))
        self.rng = np.random.default_rng(2026)
        self.rep = {k: v[1] for k, v in K.TEXTURES.items()}
        self.F = hp.Frame(A0, B0)
        self._shore()

    # the quay's edge: the shoreline of the game's own shore raster (the wall quays.js draws stands on it)
    def _shore(self):
        from PIL import Image
        sc = json.load(open(os.path.join(ROOT, "web", "data", "sydney", "scene.json")))["shore"]
        px = np.asarray(Image.open(os.path.join(ROOT, "web", "data", "sydney", sc["file"])))[:, :, 0].astype(float)
        D = (px - 128) / 2
        cs, x0, y1 = sc["cell"], sc["x0"], sc["y1"]

        def dist(x, y):
            c, r = (x - x0) / cs - 0.5, (y1 - y) / cs - 0.5
            c0, r0 = int(c), int(r)
            fc, fr = c - c0, r - r0
            return (D[r0, c0] * (1 - fc) + D[r0, c0 + 1] * fc) * (1 - fr) + (D[r0 + 1, c0] * (1 - fc) + D[r0 + 1, c0 + 1] * fc) * fr
        ys = np.arange(Y0 - 4, Y1 + 4.01, 0.5)
        xs = []
        for y in ys:
            x = -200.0
            while x < -140 and dist(x, y) < 0:
                x += 0.1
            xs.append(x)
        xs = np.array(xs)
        k = np.ones(9) / 9       # (the raster's 2.5 m steps, smoothed to the wall's line)
        xs = np.convolve(np.pad(xs, 4, mode="edge"), k, mode="valid")
        self._ey, self._ex = ys, xs

    def edge(self, y):
        return float(np.interp(y, self._ey, self._ex))

    def wall_x(self, y):
        (xa, ya), (xb, yb) = WALL
        return xa + (xb - xa) * (y - ya) / (yb - ya)

    def ways(self, **tags):
        return [w for w in self.osm["ways"] if all(w["tags"].get(k) == v for k, v in tags.items())]

    def nodes(self, **tags):
        return [n for n in self.osm["nodes"] if all(n["tags"].get(k) == v for k, v in tags.items())]

    def build(self):
        self.cells()
        self.ground()
        self.museum()
        self.mordant()
        self.quay_edge()
        self.planting()
        self.furniture()
        self.night()
        return self.geo, self.A

    # -- the atlas
    def cells(self):
        A, rng = self.A, np.random.default_rng(11)
        self.plaques = [n for n in self.nodes(historic="memorial") if n["tags"].get("memorial") == "plaque" and n["tags"].get("name")
                        and Y0 < n["xy"][1] < Y1 and n["xy"][0] > self.wall_x(n["xy"][1]) - 2]
        # (tallest first: the atlas is packed in shelves)
        A.cell("pylon", 192, 640, draw_pylon)
        A.cell("ember", 384, 384, draw_ember)
        for i in range(2):
            A.cell(f"banner{i}", 128, 368, draw_banner(i))
        A.cell("doors", 512, 384, draw_doors)
        for i in range(4):
            A.cell(f"art{i}", 224, 288, draw_art(i))
        A.cell("clock", 320, 320, draw_clock)
        A.cell("arrow", 256, 256, draw_arrow)
        A.cell("letters_grey", 640, 256, draw_words(["Museum of", "Contemporary", "Art"], (58, 60, 64), (244, 244, 240), face="anton", align="l"))
        A.cell("letters_white", 512, 256, draw_words(["Museum of", "Contemporary", "Art Australia"], (240, 240, 236), (16, 16, 16), face="anton", align="l"))
        for i in range(6):
            A.cell(f"room_d{i}", 96, 192, draw_room(rng, False))
        for i in range(4):
            A.cell(f"room_l{i}", 96, 192, draw_room(rng, True))
        for i, n in enumerate(self.plaques):
            A.cell(f"plaque{i}", 192, 192, draw_plaque(n["tags"]["name"]))
        for i in range(3):
            A.cell(f"relief{i}", 160, 160, draw_relief(i))
        A.cell("buoy", 128, 160, draw_buoy)
        A.cell("cover", 128, 128, draw_cover)
        A.cell("flag_au", 192, 96, draw_flag("au"))
        A.cell("flag_ab", 192, 96, draw_flag("aboriginal"))
        A.cell("letters", 1280, 136, draw_words(["MUSEUM OF CONTEMPORARY ART"], (206, 164, 106), (48, 32, 18), stone=True, pad=0.12))
        A.cell("drain", 256, 32, draw_drain)

    # -- what you walk on
    def ground(self):
        from shapely.geometry import Polygon, box
        G, geo, rep = self.G, self.geo, self.rep
        ys = np.arange(Y0, Y1 + 0.01, 1.0)
        land = Polygon([(-236, Y0)] + [(self.edge(y) - 0.72, y) for y in ys] + [(-236, Y1)])
        mca = Polygon(next(w for w in self.ways(name="Museum of Contemporary Art"))["xy"]).buffer(0.25, join_style=2)
        site = land.difference(mca).buffer(0)
        site = max(getattr(site, "geoms", [site]), key=lambda p: p.area)
        lawn = Polygon(next(w for w in self.ways(name="Tallawoladah Lawn"))["xy"]).intersection(site)
        kerb = lawn.buffer(0.32, join_style=2).difference(lawn).intersection(site)
        east = Polygon([(self.wall_x(Y0 - 5) + 0.3, Y0 - 5), (0, Y0 - 5), (0, Y1 + 5), (self.wall_x(Y1 + 5) + 0.3, Y1 + 5)])
        north = box(-300, 252.0, 0, Y1 + 5)       # the wing's forecourt is the promenade's granite too
        prom = site.intersection(east.union(north)).difference(lawn.buffer(0.32, join_style=2))
        fore = site.difference(prom).difference(lawn.buffer(0.32, join_style=2))
        bands = [box(-300, y, 0, y + 0.62) for y in np.arange(Y0 + 3.0, Y1, 7.4)]
        from shapely.ops import unary_union
        band = unary_union(bands).intersection(prom)
        hp.pave(geo, "ground_granite", G, prom.difference(band), rep["granite_pave"], rot=True)
        hp.pave(geo, "ground_granite_dark", G, band, rep["granite_pave"], rot=True)
        hp.pave(geo, "ground_fore", G, fore, rep["granite_pave"])
        hp.pave(geo, "ground_kerb", G, kerb, rep["stone"] * 0.5, dz=0.07)
        hp.pave(geo, "lawn_grass", G, lawn, rep["grass"], dz=0.05)
        self.prom, self.lawn, self.site = prom, lawn, site
        A, rng = self.A, self.rng
        # the Writers Walk: bronze discs in the paving, where OpenStreetMap maps each
        for i, n in enumerate(self.plaques):
            x, y = n["xy"]
            hp.disc(geo, "atlas_bronze", (x, y), 0.36, G.z(x, y) + 0.066, uv=A.uv(f"plaque{i}"))
            hp.disc(geo.fine, "metal_bronze", (x, y), 0.385, G.z(x, y) + 0.058)
        # a slot drain along the foot of the slope, covers where OpenStreetMap maps them, stains, shallow puddles
        wd = hp.unit(np.subtract(WALL[1], WALL[0]))
        for y in np.arange(WALL[0][1] + 0.5, WALL[1][1] - 1.0, 1.0):
            x = self.wall_x(y) + 0.75
            hp.decal(geo, "ground_iron", G, (x + wd[0] * 0.5, y + 0.5), wd, 1.0 / wd[1], 0.13, uv=A.uv("drain"), dz=0.062)
        for n in self.nodes(man_made="manhole"):
            if site.contains(box(n["xy"][0] - 0.4, n["xy"][1] - 0.4, n["xy"][0] + 0.4, n["xy"][1] + 0.4)):
                hp.decal(geo, "ground_iron", G, n["xy"], (1, 0), 0.7, 0.7, uv=A.uv("cover"), dz=0.062)
        for y in (181.0, 226.5, 268.0):
            x = self.edge(y) - 6.0
            hp.decal(geo, "ground_iron", G, (x, y), (1, 0), 0.6, 0.6, uv=A.uv("cover"), dz=0.062)
        from shapely.geometry import Point
        for _ in range(26):
            y = Y0 + 4 + rng.random() * (Y1 - Y0 - 8)
            x = self.wall_x(y) + 1.5 + rng.random() * (self.edge(y) - self.wall_x(y) - 4)
            if prom.contains(Point(x, y).buffer(1.0)):
                hp.blob(geo, "ground_stain", G, (x, y), 0.08 + rng.random() * 0.22, rng)

    # -- the museum's sandstone front
    def bays(self, F, u0, u1, out, n, floors, top, small_top=False, lit=0.22, end=1.25, pier=0.95, name="ashlar"):
        """A front of n bays between piers: a granite base, paired windows at each storey, a parapet. The wall
        at `out`, the piers 0.3 m proud of it."""
        geo, A, rng, rep = self.geo, self.A, self.rng, self.rep["ashlar"]
        mat = "stone_ashlar"
        zf = lambda u: min(self.G.z(*F.P(u, out, 0)[:2]), ZF) - 0.4
        bw = (u1 - u0 - 2 * end + pier) / n
        holes = []
        for b in range(n):
            uc = u0 + end - pier / 2 + bw * (b + 0.5)
            for f in range(floors):
                z0 = ZF + 1.3 + STOREY * f
                hgt = 1.55 if (small_top and f == floors - 1) else 2.55
                for s in (-1, 1):
                    w0 = uc + s * 0.19 if s > 0 else uc - 0.19 - 1.14
                    holes.append((w0, w0 + 1.14, z0, z0 + hgt))
        hp.wall(geo, mat, F, u0, u1, ZB, top, out, rep, holes=holes, zf=None)
        for (w0, w1, z0, z1) in holes:
            on = rng.random() < lit
            key = f"room_l{int(rng.integers(4))}" if on else f"room_d{int(rng.integers(6))}"
            hp.window(geo, F, w0, w1, z0, z1, out, 0.3, mat, rep, uv=A.uv(key), bars=(1, 3 if z1 - z0 > 2 else 1),
                      emit=(A.mean[key], 0.5) if on else None)
        # the piers, the end ones broader; their heads stop a course under the parapet
        us = [u0 + end / 2] + [u0 + end - pier / 2 + bw * b for b in range(1, n)] + [u1 - end / 2]
        for i, uc in enumerate(us):
            w = end if i in (0, len(us) - 1) else pier
            hp.fbox(geo, "stone_ashlar_d" if i % 2 else mat, F, uc - w / 2, uc + w / 2, out, out + 0.3, ZB, top - 1.5, rep, faces=("front", "left", "right", "top"))
        # the base in polished granite, the string course over the ground floor's heads, the parapet and its coping
        hp.fbox(geo, "stone_plinth", F, u0 - 0.02, u1 + 0.02, out, out + 0.38, ZB, ZF + 0.95, self.rep["granite"], faces=("front", "left", "right", "top"))
        hp.fbox(geo, mat, F, u0 - 0.05, u1 + 0.05, out, out + 0.4, top - 1.5, top - 1.28, rep)
        hp.fbox(geo, mat, F, u0 - 0.05, u1 + 0.05, out, out + 0.34, top - 1.28, top - 0.1, rep, faces=("front", "left", "right"))
        hp.fbox(geo, "stone_ashlar_d", F, u0 - 0.12, u1 + 0.12, out - 0.5, out + 0.46, top - 0.1, top + 0.12, rep)
        self.geo.walls.append((F.P(u0, out, 0)[:2], F.P(u1, out, 0)[:2], ZF, top))

    def museum(self):
        geo, F, A, rep = self.geo, self.F, self.A, self.rep["ashlar"]
        SK = 0.45                          # the skin, in front of the city's wall
        wing_top, pav_top = ZF + 25.7, ZF + 23.2
        # the wings between the pavilions and the tower
        self.bays(F, 15.6, 32.0, SK, 4, 6, wing_top, small_top=True)
        self.bays(F, 45.2, 62.0, SK, 4, 6, wing_top, small_top=True)
        # the end pavilions, 9.3 m forward: front and both returns, and a roof
        for (ua, ub) in ((1.5, 15.6), (62.0, 76.0)):
            PO = 9.3
            self.bays(F, ua, ub, PO, 3, 5, pav_top)
            south = hp.Frame(F.P(ua, 0, 0), F.P(ua, PO, 0))            # faces south
            north = hp.Frame(F.P(ub, PO, 0), F.P(ub, 0, 0))            # faces north
            self.bays(south, 0.0, PO, 0.0, 2, 5, pav_top, end=1.1)
            self.bays(north, 0.0, PO, 0.0, 2, 5, pav_top, end=1.1)
            geo.quad("stone_ashlar_d", F.P(ua, 0, pav_top - 0.2), F.P(ub, 0, pav_top - 0.2), F.P(ub, PO, pav_top - 0.2), F.P(ua, PO, pav_top - 0.2),
                     n=(0, 0, 1.0), uv=[(0, 0), (4, 0), (4, 3), (0, 3)])
        # the south end of the main block, seen from First Fleet Park
        se = hp.Frame((-240.52, 174.36), (-225.79, 173.13))
        self.bays(se, 0.0, se.len - 0.3, 0.45, 3, 6, wing_top, small_top=True)
        self.tower()
        # the floor of glass on the roof (2012), set back, under a white slab
        for (ua, ub) in ((2.0, 31.0), (46.2, 75.0)):
            hp.fbox(geo, "glass_green", F, ua, ub, -14.0, -2.2, wing_top, wing_top + 4.3, faces=("front", "left", "right"))
            for u in np.arange(ua, ub + 0.01, (ub - ua) / round((ub - ua) / 2.4)):
                hp.fbox(geo.fine, "metal_dark", F, u - 0.035, u + 0.035, -2.2, -2.12, wing_top, wing_top + 4.3, faces=("front", "left", "right"))
            hp.fbox(geo, "paint_white", F, ua - 1.4, ub + 1.4, -15.0, -0.6, wing_top + 4.3, wing_top + 4.75)

    def tower(self):
        geo, F, A, rep = self.geo, self.F, self.A, self.rep["ashlar"]
        mat, u0, u1, out = "stone_ashlar", 32.0, 45.2, 2.6
        uc = (u0 + u1) / 2
        top = ZF + 33.3
        sh_top = ZF + 27.6                 # the shoulders either side of the great piers
        # the face: three strips of windows between slim piers, storey by storey, over the entrance
        strips = [uc - 2.05, uc, uc + 2.05]
        holes = []
        for f in range(1, 6):
            z0 = ZF + 1.6 + STOREY * f
            for us in strips:
                holes.append((us - 0.62, us + 0.62, z0, z0 + 2.75))
        door = (uc - 3.1, uc + 3.1, ZB, ZF + 5.0)
        hp.wall(geo, mat, F, u0, u1, ZB, top, out, rep, holes=holes + [door])
        for (w0, w1, z0, z1) in holes:
            on = self.rng.random() < 0.3
            key = f"room_l{int(self.rng.integers(4))}" if on else f"room_d{int(self.rng.integers(6))}"
            hp.window(geo, F, w0, w1, z0, z1, out, 0.35, mat, rep, uv=A.uv(key), bars=(1, 3), sill=False, emit=(A.mean[key], 0.5) if on else None)
            hp.fbox(geo, "metal_bronze", F, w0, w1, out - 0.3, out - 0.22, z1, z1 + STOREY - 2.75, faces=("front",))   # a bronze spandrel
        for us in (uc - 1.025, uc + 1.025):       # the slim piers between the strips
            hp.fbox(geo, "stone_ashlar_d", F, us - 0.3, us + 0.3, out, out + 0.32, ZF + 5.2, ZF + 26.8, rep, faces=("front", "left", "right", "top"))
        for s in (-1, 1):                         # the great piers and the shoulders
            a = uc + s * 3.3
            b = uc + s * 5.3
            hp.fbox(geo, mat, F, min(a, b), max(a, b), out, out + 0.7, ZB, ZF + 30.6, rep, faces=("front", "left", "right", "top"))
            hp.fbox(geo, "stone_ashlar_d", F, min(a, b) - 0.1, max(a, b) + 0.1, out, out + 0.8, ZF + 30.6, ZF + 30.95, rep)
            c, d = uc + s * 5.3, uc + s * 6.6
            hp.fbox(geo, "stone_ashlar_d", F, min(c, d), max(c, d), out, out + 0.25, sh_top, sh_top + 0.3, rep)
        hp.fbox(geo, "stone_plinth", F, u0, uc - 3.1, out, out + 0.82, ZB, ZF + 0.95, self.rep["granite"], faces=("front", "left", "right", "top"))
        hp.fbox(geo, "stone_plinth", F, uc + 3.1, u1, out, out + 0.82, ZB, ZF + 0.95, self.rep["granite"], faces=("front", "left", "right", "top"))
        # the carved panels, the clock, the stepped top, the stub and its pole
        for i, us in enumerate(strips):
            geo.quad("atlas_flat", F.P(us - 0.72, out + 0.02, ZF + 27.0), F.P(us + 0.72, out + 0.02, ZF + 27.0), F.P(us + 0.72, out + 0.02, ZF + 28.44), F.P(us - 0.72, out + 0.02, ZF + 28.44), uv=A.uv(f"relief{i}"))
        hp.disc(geo, "atlas_flat", F.P(uc, out + 0.03, 0)[:2], 1.42, ZF + 30.45, uv=A.uv("clock"), n=F.N, segs=32)
        for k, (ins, z0, z1) in enumerate(((3.1, top, top + 0.9), (3.6, top + 0.9, top + 1.8))):
            hp.fbox(geo, mat if k else "stone_ashlar_d", F, uc - 6.6 + ins, uc + 6.6 - ins, out - 4.0, out + 0.1 - 0.25 * k, z0, z1, rep)
        hp.fbox(geo, "stone_ashlar_d", F, u0 - 0.1, u1 + 0.1, out - 0.4, out + 0.12, top - 0.25, top, rep)
        hp.fbox(geo, mat, F, uc - 1.1, uc + 1.1, out - 3.2, out - 1.0, top + 1.8, top + 4.6, rep)
        hp.fbox(geo, "stone_ashlar_d", F, uc - 1.25, uc + 1.25, out - 3.35, out - 0.85, top + 4.6, top + 4.85, rep)
        pole = F.P(uc, out - 2.1, top + 4.85)
        geo.tube("paint_white", [pole, pole + [0, 0, 7.5]], 0.06, segs=6)
        self.flag(pole + [0, 0, 5.3], "flag_au", 3.2)
        for s, key in ((-1, "flag_au"), (1, "flag_ab")):      # the wings' roofs carry one each
            p = F.P(uc + s * 9.5, -3.0, ZF + 30.4)
            geo.tube("paint_white", [p, p + [0, 0, 6.0]], 0.045, segs=6)
            self.flag(p + [0, 0, 4.2], key, 2.4)
        # the entrance: bronze doors glazed onto the hall, the name over them, a canopy
        geo.quad("atlas_bronze", F.P(door[0], out - 0.85, ZB), F.P(door[1], out - 0.85, ZB), F.P(door[1], out - 0.85, ZF + 5.0), F.P(door[0], out - 0.85, ZF + 5.0), uv=A.uv("doors"))
        for us in np.linspace(door[0], door[1], 4):
            hp.fbox(geo, "metal_bronze", F, us - 0.09, us + 0.09, out - 0.85, out - 0.7, ZB, ZF + 5.0, faces=("front", "left", "right"))
        hp.fbox(geo, mat, F, door[0] - 0.01, door[0], out - 0.9, out, ZB, ZF + 5.0, rep, faces=("right",), ao=0.7)
        hp.fbox(geo, mat, F, door[1], door[1] + 0.01, out - 0.9, out, ZB, ZF + 5.0, rep, faces=("left",), ao=0.7)
        hp.fbox(geo, mat, F, door[0], door[1], out - 0.9, out, ZF + 5.0, ZF + 5.01, rep, faces=("bottom",), ao=0.6)
        geo.quad("atlas_flat", F.P(uc - 5.2, out + 0.72, ZF + 5.3), F.P(uc + 5.2, out + 0.72, ZF + 5.3), F.P(uc + 5.2, out + 0.72, ZF + 6.4), F.P(uc - 5.2, out + 0.72, ZF + 6.4), uv=A.uv("letters"))
        hp.fbox(geo, mat, F, uc - 5.3, uc + 5.3, out, out + 0.7, ZF + 5.0, ZF + 6.7, rep, faces=("front", "left", "right", "top", "bottom"))
        hp.fbox(geo, "paint_white", F, uc - 4.4, uc + 4.4, out, out + 3.4, ZF + 4.45, ZF + 4.62)
        for us in (uc - 4.1, uc + 4.1):
            geo.cylinder("metal_steel", F.P(us, out + 3.1, ZB), 0.06, ZF + 4.45 - ZB, segs=8, cap=False)
        for us in np.linspace(uc - 3.2, uc + 3.2, 4):   # the canopy's downlights
            hp.disc(geo, "glow_lamp", F.P(us, out + 1.8, 0)[:2], 0.09, ZF + 4.445, n=(0, 0, -1.0), segs=10)
            geo.emitters.append((F.P(us, out + 1.8, ZF + 4.4), np.array([0, 0, -1.0]), 1.0, np.array([1.0, 0.85, 0.62]) * 28))
        self.geo.walls.append((F.P(u0, out, 0)[:2], F.P(u1, out, 0)[:2], ZF, top))

    def flag(self, p, key, w):
        """A flag flying from p on a north-easter: three panels with a wave in them."""
        geo, A = self.geo, self.A
        d = np.array([-0.82, -0.57, 0.0])       # downwind
        s = np.array([-d[1], d[0], 0.0])
        h = w / 2
        n = 6
        uv = A.uv(key)
        (ua, va), (ub, _), (_, vb), _ = uv
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            w0, w1 = math.sin(t0 * 7.0) * 0.16 * t0, math.sin(t1 * 7.0) * 0.16 * t1
            a, b = p + d * w * t0 + s * w0 - [0, 0, 0.1 * t0], p + d * w * t1 + s * w1 - [0, 0, 0.1 * t1]
            geo.quad("atlas_cloth", a, b, b + [0, 0, h], a + [0, 0, h],
                     uv=[(ua + (ub - ua) * t0, va), (ua + (ub - ua) * t1, va), (ua + (ub - ua) * t1, vb), (ua + (ub - ua) * t0, vb)])

    # -- the Mordant Wing, in outline
    def mordant(self):
        geo, F, A = self.geo, self.F, self.A
        c = self.rep["conc"]
        z = ZB
        # the grey box by the old building, with the name on it, over a dark soffit
        hp.fbox(geo, "grc_grey", F, 76.4, 84.0, 0.0, 17.2, ZF + 5.2, ZF + 13.4, c, faces=("front", "left", "right", "bottom", "top"))
        geo.quad("atlas_flat", F.P(77.0, 17.23, ZF + 8.0), F.P(83.4, 17.23, ZF + 8.0), F.P(83.4, 17.23, ZF + 10.6), F.P(77.0, 17.23, ZF + 10.6), uv=A.uv("letters_grey"))
        # the glazed entrance, set back under the white box
        self.hall(F, 76.4, 93.6, 15.6, 8.4, ZF + 5.2)
        hp.fbox(geo, "grc_white", F, 84.0, 93.6, 4.0, 20.9, ZF + 5.2, ZF + 10.8, c, faces=("front", "left", "right", "bottom", "top"))
        geo.quad("glass_dark", F.P(84.4, 19.4, ZF + 10.8), F.P(93.2, 19.4, ZF + 10.8), F.P(93.2, 19.4, ZF + 14.0), F.P(84.4, 19.4, ZF + 14.0))
        geo.quad("glass_dark", F.P(93.2, 19.4, ZF + 10.8), F.P(93.2, 6.0, ZF + 10.8), F.P(93.2, 6.0, ZF + 14.0), F.P(93.2, 19.4, ZF + 14.0))
        hp.fbox(geo, "grc_white", F, 84.0, 93.6, 4.0, 20.9, ZF + 14.0, ZF + 19.6, c, faces=("front", "left", "right", "bottom", "top"))
        hp.fbox(geo, "grc_black", F, 77.5, 92.0, 2.0, 18.6, ZF + 13.4, ZF + 23.6, faces=("front", "left", "right", "top"))
        geo.quad("glass_dark", F.P(79.0, 18.63, ZF + 19.9), F.P(91.0, 18.63, ZF + 19.9), F.P(91.0, 18.63, ZF + 23.0), F.P(79.0, 18.63, ZF + 23.0))
        # north of the entrance: the white wall with the name at eye level, the concrete wall with the arrow
        hp.fbox(geo, "grc_white", F, 93.6, 111.4, 0.0, 15.0, z, ZF + 16.2, c, faces=("front", "left", "right", "top"))
        geo.quad("atlas_flat", F.P(94.3, 15.03, ZF + 1.0), F.P(98.3, 15.03, ZF + 1.0), F.P(98.3, 15.03, ZF + 3.0), F.P(94.3, 15.03, ZF + 3.0), uv=A.uv("letters_white"))
        geo.quad("atlas_flat", F.P(101.0, 15.04, ZF + 0.4), F.P(105.6, 15.04, ZF + 0.4), F.P(105.6, 15.04, ZF + 5.0), F.P(101.0, 15.04, ZF + 5.0), uv=A.uv("arrow"))
        hp.fbox(geo, "grc_black", F, 95.0, 111.4, 0.0, 13.0, ZF + 16.2, ZF + 22.0, faces=("front", "left", "right", "top"))
        for u in np.arange(93.6 + 3.56, 111.3, 3.56):      # the panels' joints
            hp.fbox(geo.fine, "metal_dark", F, u - 0.012, u + 0.012, 15.0, 15.006, z, ZF + 16.2, faces=("front",))
        for zz in (ZF + 5.4, ZF + 10.8):
            hp.fbox(geo.fine, "metal_dark", F, 93.6, 111.4, 15.0, 15.006, zz - 0.012, zz + 0.012, faces=("front",))
        self.geo.walls.append((F.P(93.6, 15.0, 0)[:2], F.P(111.4, 15.0, 0)[:2], ZF, ZF + 16))
        self.geo.walls.append((F.P(76.4, 15.6, 0)[:2], F.P(93.6, 15.6, 0)[:2], ZF, ZF + 5))

    def hall(self, F, u0, u1, out, back, top):
        """A glazed ground floor with its room behind the glass, as geometry (so that it moves as you pass):
        a polished floor, a white back wall hung with canvases, a desk, a ceiling of light."""
        geo, A = self.geo, self.A
        zf = ZF + 0.03
        hp.fbox(geo, "floor_hall", F, u0, u1, back, out, ZB, zf, faces=("top",))
        hp.fbox(geo, "paint_white", F, u0, u1, back - 0.2, back, zf, top, faces=("front",))
        hp.fbox(geo, "paint_white", F, u0 - 0.2, u0, back, out, zf, top, faces=("right",))
        hp.fbox(geo, "paint_white", F, u1, u1 + 0.2, back, out, zf, top, faces=("left",))
        hp.fbox(geo, "paint_white", F, u0, u1, back, out, top - 0.25, top, faces=("bottom",))
        n = 4
        for i in range(n):       # the canvases, and a strip of light over each
            uc = u0 + (u1 - u0) * (i + 0.5) / n
            geo.quad("atlas_flat", F.P(uc - 1.2, back + 0.04, zf + 1.1), F.P(uc + 1.2, back + 0.04, zf + 1.1), F.P(uc + 1.2, back + 0.04, zf + 4.1), F.P(uc - 1.2, back + 0.04, zf + 4.1), uv=A.uv(f"art{i % 4}"))
            q = [F.P(uc - 1.4, back + 1.6, top - 0.255), F.P(uc - 1.4, back + 1.9, top - 0.255), F.P(uc + 1.4, back + 1.9, top - 0.255), F.P(uc + 1.4, back + 1.6, top - 0.255)]
            geo.quad("glow_lamp", *q, n=(0, 0, -1.0))
            geo.emitters.append((F.P(uc, back + 1.75, top - 0.4), np.array([0, 0, -1.0]), 1.0, np.array([1.0, 0.9, 0.74]) * 26))
            geo.emitters.append((F.P(uc, out + 0.3, top - 1.0), hp.unit(np.r_[F.n, -0.7]), 1.0, np.array([1.0, 0.9, 0.74]) * 22))   # (what spills out through the glass)
        hp.fbox(geo, "metal_bronze", F, u1 - 6.0, u1 - 2.4, back + 2.6, back + 3.5, zf, zf + 1.05, faces=("front", "left", "right", "top"))    # the desk
        # the glass, in a dark frame; its mullions in the fine model
        geo.quad("glass_hall", F.P(u0, out, ZB), F.P(u1, out, ZB), F.P(u1, out, top), F.P(u0, out, top), n=F.N)
        hp.fbox(geo, "metal_dark", F, u0, u1, out - 0.06, out + 0.06, top - 0.22, top, faces=("front", "bottom"))
        for u in np.arange(u0, u1 + 0.01, (u1 - u0) / 6):
            hp.fbox(geo, "metal_dark", F, u - 0.04, u + 0.04, out - 0.07, out + 0.07, ZB, top, faces=("front", "left", "right"))
        hp.fbox(geo.fine, "metal_dark", F, u0, u1, out - 0.04, out + 0.04, zf + 2.6, zf + 2.66, faces=("front", "top", "bottom"))

    # -- the water's edge
    def quay_edge(self):
        geo, G = self.geo, self.G
        rs = self.rep["stone"]
        L = 1.3
        ys = np.arange(Y0, Y1 - 6, L)
        for i, y in enumerate(ys):
            x = self.edge(y + L / 2)
            t = hp.unit([self.edge(y + L) - self.edge(y), L])
            nrm = np.array([t[1], -t[0]])
            c = np.array([x, y + L / 2]) - nrm * 0.36 + nrm * 0.3 * 0
            zq = G.z(x - 1.6, y + L / 2)
            geo.box("stone_coping", (c[0] + nrm[0] * 0.02, c[1] + nrm[1] * 0.02, zq - 0.3), (np.r_[t, 0], np.r_[nrm, 0]), (L - 0.025, 1.0, 0.47), uvm=1 / rs,
                    faces=("+u", "-u", "+v", "-v", "top"))
            if i % 11 == 5:
                hp.mooring_bollard(geo, c - nrm * 0.05, zq + 0.17)
            if i % 31 == 12:      # a ladder's hoops over the coping, and a lifebuoy on its post behind
                for s in (-0.25, 0.25):
                    b = np.r_[c + t * s + nrm * 0.42, zq + 0.17]
                    geo.fine.tube("paint_yellow", [b + np.r_[nrm, 0] * 0.1 - [0, 0, 1.2], b + np.r_[nrm, 0] * 0.1 + [0, 0, 0.7], b + np.r_[nrm, 0] * -0.1 + [0, 0, 0.95], b - np.r_[nrm, 0] * 0.55 + [0, 0, 0.9], b - np.r_[nrm, 0] * 0.6], 0.022, segs=5)
                p = np.r_[c - nrm * 1.3 + t * 1.2, G.z(*(c - nrm * 1.3 + t * 1.2))]
                geo.cylinder("paint_yellow", p, 0.035, 1.25, segs=8, cap=False)
                e, s2 = np.r_[nrm, 0], np.r_[t, 0]
                geo.box("paint_yellow", p + [0, 0, 1.2], (s2, e), (0.6, 0.16, 0.75))
                q0 = p + e * 0.085 - s2 * 0.3 + [0, 0, 1.2]
                geo.quad("atlas_flat", q0 + s2 * 0.6, q0, q0 + [0, 0, 0.75], q0 + s2 * 0.6 + [0, 0, 0.75], uv=self.A.uv("buoy"))
        # the hardwood fender along the wall's face under the coping
        pts = [np.array([self.edge(y) + 0.32, y, G.z(self.edge(y) - 1.6, y) - 0.22]) for y in np.arange(Y0, Y1 - 5.9, 2.6)]
        for a, b in zip(pts[:-1], pts[1:]):
            t = hp.unit((b - a)[:2])
            geo.box("wood_wharf", (a + b) / 2 - [0, 0, 0.36], (np.r_[t, 0], np.r_[t[1], -t[0], 0]), (np.linalg.norm(b - a) - 0.03, 0.3, 0.3), uvm=1 / self.rep["deck"],
                    faces=("+v", "top", "bot", "+u", "-u"))

    # -- the lawn's wall and the palms
    def planting(self):
        geo, G, rng = self.geo, self.G, self.rng
        rr = self.rep["rubble"]
        (xa, ya), (xb, yb) = WALL
        W = hp.Frame((xb, yb), (xa, ya))          # facing east (the quay)
        n = int(W.len / 2.0)
        for i in range(n):
            u0, u1 = W.len * i / n, W.len * (i + 1) / n
            za = min(G.z(*W.P(u, o, 0)[:2]) for u in (u0, u1) for o in (-0.3, 0.3)) - 0.15
            zt = max(G.z(*W.P(u, -0.3, 0)[:2]) for u in (u0, u1)) + 0.46
            hp.fbox(geo, "stone_rubble", W, u0, u1, -0.26, 0.26, za, zt, rr, faces=("front", "back", "left", "right"))
            hp.fbox(geo, "stone_coping", W, u0 + 0.008, u1 - 0.008, -0.33, 0.33, zt, zt + 0.09, self.rep["stone"], faces=("front", "back", "left", "right", "top"))
        self.geo.walls.append(((xa, ya), (xb, yb), G.z(xa, ya), G.z(xa, ya) + 0.5))

    # -- what stands on the promenade
    def furniture(self):
        geo, G, A, rng = self.geo, self.G, self.A, self.rng
        self.lamps = []
        for i, y in enumerate(np.arange(Y0 + 8.0, Y1 - 12, 21.0)):
            x = self.edge(y) - 3.3
            hd = math.atan2(1.0, self.edge(y + 1) - self.edge(y)) - math.pi / 2     # towards the water
            hp.lamp_post(geo, (x, y), hd, G.z(x, y) + 0.03, low=(-1.0, 4.7), banner=(A.uv("banner0"), A.uv("banner1"), 0.8, 2.3, 5.2))
            self.lamps.append((x, y))
            if i in (1, 4):
                hp.bin_(geo, (x - 0.2, y + 1.6), G.z(x - 0.2, y + 1.6) + 0.03)
        for nd in self.nodes(amenity="bench"):
            x, y = nd["xy"]
            if Y0 < y < Y1 - 4:
                x = min(x, self.edge(y) - 1.75)
                hp.bench(geo, (x, y), 0.0, G.z(x, y) + 0.04)
        for y in (190.5, 192.6, 241.0, 243.1, 263.5):       # more of them, facing the water (not mapped: placed)
            x = self.edge(y) - 1.75
            hp.bench(geo, (x, y), 0.0, G.z(x, y) + 0.04)
        from shapely.geometry import Point
        inner = self.site.buffer(-0.3)
        for nd in self.nodes(barrier="bollard"):
            x, y = nd["xy"]
            if Y0 < y < Y1 - 0.5 and inner.contains(Point(x, y)):
                hp.bollard(geo, (x, y), G.z(x, y) + 0.03, band="paint_white")
        # wayfinding pylons
        for (x, y, hd) in ((self.wall_x(170.0) + 2.2, 170.0, 0.2), (-178.5, 266.0, -0.3)):
            c = np.array([x, y, G.z(x, y) + 0.03])
            f = np.array([math.cos(hd), math.sin(hd), 0.0]); s = np.array([-f[1], f[0], 0.0])
            geo.box("metal_dark", c, (s, f), (0.62, 0.14, 2.3))
            for sg in (1, -1):
                q = c + f * sg * 0.073
                a, b = (q - s * 0.29, q + s * 0.29) if sg > 0 else (q + s * 0.29, q - s * 0.29)
                geo.quad("atlas_flat", a + [0, 0, 0.22], b + [0, 0, 0.22], b + [0, 0, 2.26], a + [0, 0, 2.26], uv=A.uv("pylon"))
        # Lindy Lee's ovoid on the wing's forecourt: mirror steel, pierced, lit from inside after dark
        art = next((n["xy"] for n in self.nodes(tourism="artwork") if "Starlight" in n["tags"].get("name", "")), (-188.3, 259.7))
        c = np.array([art[0], art[1], G.z(*art) + 2.25])
        P, N, U, tri = [], [], [], []
        nu, nv = 28, 18
        (ua, va), (ub, _), (_, vb), _ = A.uv("ember")
        rx, ry, rz = 1.25, 0.95, 2.3
        for j in range(nv + 1):
            ph = math.pi * j / nv
            for i in range(nu + 1):
                th = 2 * math.pi * i / nu
                d = np.array([math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), -math.cos(ph)])
                egg = 1.0 - 0.16 * d[2]            # fuller at the foot
                P.append(c + d * [rx * egg, ry * egg, rz]); N.append(hp.unit(d / [rx, ry, rz]))
                U.append((ua + (ub - ua) * i / nu, va + (vb - va) * j / nv))
        for j in range(nv):
            for i in range(nu):
                a = j * (nu + 1) + i
                tri += [(a, a + 1, a + nu + 2), (a, a + nu + 2, a + nu + 1)]
        geo.mesh("glow_ember", P, tri, n=N, uv=U)
        for k in range(10):
            th = 2 * math.pi * k / 10
            n = np.array([math.cos(th), math.sin(th), 0.0])
            geo.emitters.append((c + n * [rx, ry, 0] * 1.05 - [0, 0, 0.6], hp.unit(n - [0, 0, 0.5]), 1.0, np.array([1.0, 0.8, 0.5]) * 9))

    # -- the light after dark that is not a lamp post's
    def night(self):
        geo, G, F = self.geo, self.G, self.F
        # the museum's front is washed from the ground: up-lights in the forecourt's paving
        def up(F_, u, out, k=1.0):
            p = F_.P(u, out, 0)
            z = G.z(p[0], p[1])
            hp.disc(geo, "glow_up", p[:2], 0.11, z + 0.055, segs=10)
            geo.fine.lathe("metal_dark", (p[0], p[1], z + 0.04), [(0.11, 0.0), (0.11, 0.022), (0.15, 0.022), (0.15, 0.0)], segs=12)
            for dz, kk in ((0.4, 70.0), (3.0, 150.0)):       # (a narrow beam up the wall: a near and a far lobe)
                geo.emitters.append((np.array([p[0], p[1], z + dz]) + F_.N * (1.0 + dz), hp.unit(-F_.N * 0.5 + [0, 0, 0.87]), 1.0, np.array([1.0, 0.78, 0.5]) * kk * k))
        for u in np.arange(17.6, 31.0, 4.1):
            up(F, u, 0.45 + 2.6)
        for u in np.arange(47.3, 61.0, 4.2):
            up(F, u, 0.45 + 2.6)
        for (ua, ub) in ((1.5, 15.6), (62.0, 76.0)):
            for u in np.arange(ua + 2.4, ub, 4.6):
                up(F, u, 9.3 + 2.6)
        for u in (34.0, 43.2):
            up(F, u, 2.6 + 3.4, 1.8)
        # the wing's white wall
        for u in np.arange(96.0, 111.0, 5.0):
            up(F, u, 15.0 + 2.4, 0.5)


def build(K):
    """(geo, atlas, materials, meta) for blender/build_hero.py."""
    L = Level(K)
    geo, atlas = L.build()
    meta = {"id": ID, "at": [-195.0, 230.0], "r": 85.0, "z": 4.0, "glb": f"hero/{ID}.glb", "fine": f"hero/{ID}_fine.glb",
            "cell": 44.0, "fine_cell": 22.0, "bake_gain": 0.6}
    return geo, atlas, materials(K), meta
