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
sys.path.insert(0, HERE)

import adkit as ad  # noqa: E402
import hero_parts as hp  # noqa: E402

ID = "quay-west"
Y0, Y1 = 164.0, 299.0             # the level along the quay
ZB = 3.0                          # the fronts' foot, under the paving
ZF = 4.0                          # the museum's ground floor
STOREY = 4.3                      # its storey (six in the wings, five in the pavilions: photographs)
WING_TOP, PAV_TOP = ZF + 27.4, ZF + 21.4      # over the floor, as the photographs' proportions give them against the tower's 35 m
A0, B0 = (-225.79, 173.13), (-219.54, 248.95)   # the wings' harbour face, south to north (OSM's building parts)
WALL = ((-185.16, 172.86), (-178.71, 246.85))   # the lawn's retaining wall (OSM barrier=retaining_wall)
RAIL_IN = 0.3                     # the balustrade's line, in from the quay's face
KERB, KUP = 1.0, 0.16            # the quay's kerb stone, which the balustrade stands on: its width and upstand
# the Mordant Wing in the front's frame (u along from the old building's south corner, out towards the water), from
# OpenStreetMap's outline: the entrance block's two ends and its face; the north block's end and face; and, by
# design after photographs, the glazed entrance's head and the hall's back wall (museum.py gives the same to the city)
MORDANT = {"entrance": (81.6, 95.0, 20.8), "north": (112.7, 14.9), "glass_top": ZF + 7.2, "hall_back": 9.5}


def materials(K):
    import hero_tex
    for key, (make, rep) in hero_tex.SETS.items():
        K.register(key, rep, make)
    T = K.tint_to
    return {
        "ground_herring": {"tex": "syd_herring", "rough": 0.78},
        "ground_header": {"tex": "syd_header", "rough": 0.72, "maps": "cn"},
        "ground_kerb": {"tex": "syd_concrete", "tint": (0.24, 0.235, 0.225), "rough": 0.7, "maps": "c"},
        "ground_iron": {"map": "atlas", "rough": 0.5, "metal": 0.7},
        "ground_stain": {"color": (0.05, 0.05, 0.05), "rough": 0.6, "alpha": 0.22},
        "lawn_grass": {"tex": "grass", "tint": T("grass", (62, 92, 40)), "rough": 0.95, "maps": "cn"},
        "stone_sand": {"tex": "syd_sandstone", "rough": 0.88, "bump": 0.8},
        "stone_sand_d": {"tex": "syd_sandstone", "tint": (0.92, 0.915, 0.9), "rough": 0.88, "bump": 0.8},
        "stone_parapet": {"tex": "syd_parapet", "rough": 0.9, "maps": "c"},
        "stone_plinth": {"tex": "granite", "tint": T("granite", (104, 72, 62)), "rough": 0.3, "maps": "c"},
        "conc_seat": {"tex": "syd_concrete", "tint": (0.4, 0.38, 0.34), "rough": 0.7, "maps": "c"},
        "conc_wall": {"tex": "syd_seawall", "rough": 0.8, "maps": "cr"},
        "grc_white": {"tex": "syd_concrete", "tint": (0.86, 0.855, 0.84), "rough": 0.55, "maps": "c"},
        "grc_grey": {"tex": "syd_concrete", "tint": (0.062, 0.068, 0.082), "rough": 0.6, "maps": "c"},
        "grc_raw": {"tex": "syd_concrete", "tint": (0.6, 0.6, 0.58), "rough": 0.7, "maps": "c"},
        "grc_black": {"color": (0.022, 0.022, 0.026), "rough": 0.5},
        "paint_white": {"color": (0.9, 0.9, 0.88), "rough": 0.5},
        "paint_pile": {"color": (0.82, 0.83, 0.82), "rough": 0.6},
        "paint_orange": {"color": (0.9, 0.24, 0.03), "rough": 0.55},
        "floor_hall": {"color": (0.36, 0.355, 0.35), "rough": 0.18},
        "wood_bench": {"color": (0.3, 0.17, 0.09), "rough": 0.65},
        "metal_rail": {"color": (0.03, 0.055, 0.045), "rough": 0.45, "metal": 0.6},
        "metal_pole": {"color": (0.03, 0.055, 0.045), "rough": 0.45, "metal": 0.6},
        "metal_steel": {"color": (0.62, 0.63, 0.64), "rough": 0.3, "metal": 1.0},
        "metal_dark": {"color": (0.035, 0.037, 0.04), "rough": 0.45, "metal": 0.7},
        "metal_bronze": {"color": (0.13, 0.09, 0.05), "rough": 0.4, "metal": 0.9},
        "iron_black": {"color": (0.02, 0.02, 0.022), "rough": 0.55, "metal": 0.6},
        "paint_yellow": {"color": (0.85, 0.6, 0.02), "rough": 0.5},
        "rubber": {"color": (0.02, 0.02, 0.02), "rough": 0.9},
        "glass_green": {"color": (0.03, 0.07, 0.065), "rough": 0.05, "metal": 0.6},
        "glass_dark": {"color": (0.02, 0.03, 0.04), "rough": 0.04, "metal": 0.5},
        "glass_hall": {"color": (0.03, 0.04, 0.045), "rough": 0.03, "metal": 0.2, "alpha": 0.3},
        "atlas_flat": {"map": "atlas", "rough": 0.8},
        "atlas_cloth": {"map": "atlas", "rough": 0.9},
        "atlas_bronze": {"map": "atlas", "rough": 0.38, "metal": 0.85},
        "win_glass": {"map": "atlas", "tint": (0.3, 0.3, 0.32), "rough": 0.06, "metal": 0.0, "emissive": True, "glow": 1.0},
        "glow_ember": {"map": "atlas", "rough": 0.1, "metal": 1.0, "emissive": True, "glow": 0.55},
        "glow_lamp": {"color": (1.0, 0.95, 0.85), "emissive": (1.0, 0.86, 0.66), "glow": 6.0},
        "glow_up": {"color": (1.0, 0.9, 0.7), "emissive": (1.0, 0.8, 0.55), "glow": 4.0},
        "lamp_globe": {"color": (0.8, 0.8, 0.78), "rough": 0.35, "emissive": (1.0, 0.9, 0.74), "glow": 5.0},
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
    """A tall banner for the quay's flagpoles: this project's own designs (the harbour's arcs, a sun over water,
    a field of sails), not an exhibition's poster."""
    from PIL import Image, ImageDraw, ImageFilter

    def draw(img, r):
        x, y, w, h = r
        pal = [((238, 232, 220), (196, 62, 38), (22, 46, 70)), ((20, 58, 88), (240, 170, 60), (238, 232, 220)), ((204, 84, 52), (246, 236, 214), (36, 40, 52))][i]
        bg, ac, ink = pal
        im = Image.new("RGB", (w, h), bg)
        d = ImageDraw.Draw(im)
        if i == 0:
            for k in range(7):
                rr = w * (0.45 + 0.3 * k)
                d.arc([w * 0.5 - rr, h * 0.62 - rr * 0.6, w * 0.5 + rr, h * 0.62 + rr], 205, 335, fill=ac if k % 2 else ink, width=7)
        elif i == 1:
            d.ellipse([w * 0.2, h * 0.2, w * 0.8, h * 0.2 + w * 0.6], fill=ac)
            for k in range(9):
                yy = h * (0.5 + 0.045 * k)
                d.line([(xx, yy + 7 * math.sin(xx / w * 9 + k)) for xx in range(0, w + 1, 8)], fill=bg if k % 2 else (58, 110, 140), width=9)
        else:
            for k in range(5):
                x0, y0 = w * (0.12 + 0.17 * k), h * (0.62 - 0.06 * k)
                d.polygon([(x0, y0), (x0 + w * 0.3, y0), (x0 + w * 0.02, y0 - h * (0.2 + 0.03 * k))], fill=ac if k % 2 else ink)
        im = im.filter(ImageFilter.GaussianBlur(0.6))
        img.paste(im, (x, y))
        ad.text(img, (x + w / 2, y + h * 0.9), ("CIRCULAR QUAY", "SYDNEY HARBOUR", "THE ROCKS")[i], "bebas", w * 0.15, fill=ink if i != 1 else bg, max_w=w * 0.86)
        ad.text(img, (x + w / 2, y + h * 0.1), ("WARRANE", "TALLAWOLADAH", "GADIGAL COUNTRY")[i], "bebas", w * 0.1, fill=ink if i != 1 else bg, max_w=w * 0.86)
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
    """Brook Andrew's Warrang on the wing's wall: a great arrow pointing down, a dark timber frame round gold and
    black bands, on the concrete."""
    from PIL import Image, ImageDraw
    x, y, w, h = r
    draw_stone((150, 150, 144))(img, r)
    im = Image.new("RGB", (w, h), (0, 0, 0))
    mask = Image.new("L", (w, h), 0)
    d, dm = ImageDraw.Draw(im), ImageDraw.Draw(mask)
    outer = [(0.3, 0.03), (0.7, 0.03), (0.7, 0.47), (0.97, 0.47), (0.5, 0.97), (0.03, 0.47), (0.3, 0.47)]
    inner = [(0.37, 0.09), (0.63, 0.09), (0.63, 0.53), (0.82, 0.53), (0.5, 0.87), (0.18, 0.53), (0.37, 0.53)]
    dm.polygon([(w * a, h * b) for a, b in inner], fill=255)
    d.rectangle([0, 0, w, h], fill=(18, 16, 14))
    for k in range(-8, 14):
        y0 = h * 0.1 * k
        d.polygon([(0, y0 + h * 0.2), (w, y0 - h * 0.18), (w, y0 - h * 0.13), (0, y0 + h * 0.25)], fill=(206, 170, 62))
    ImageDraw.Draw(img).polygon([(x + w * a, y + h * b) for a, b in outer], fill=(44, 38, 34))
    img.paste(im, (x, y), mask)


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

    # the quay's face: the game's shore raster (the wall quays.js draws stands on it), which steps every 2.5 m, read
    # as what a quay is, a few straight runs, and stood just outside the raster's line so that it covers that wall
    def _shore(self):
        from PIL import Image
        from shapely.geometry import LineString
        sc = json.load(open(os.path.join(ROOT, "web", "data", "sydney", "scene.json")))["shore"]
        px = np.asarray(Image.open(os.path.join(ROOT, "web", "data", "sydney", sc["file"])))[:, :, 0].astype(float)
        D = (px - 128) / 2
        cs, x0, y1 = sc["cell"], sc["x0"], sc["y1"]

        def dist(x, y):
            c, r = (x - x0) / cs - 0.5, (y1 - y) / cs - 0.5
            c0, r0 = int(c), int(r)
            fc, fr = c - c0, r - r0
            return (D[r0, c0] * (1 - fc) + D[r0, c0 + 1] * fc) * (1 - fr) + (D[r0 + 1, c0] * (1 - fc) + D[r0 + 1, c0 + 1] * fc) * fr
        ys = np.arange(Y0 - 6, Y1 + 6.01, 0.5)
        xs = []
        for y in ys:
            x = -200.0
            while x < -130 and dist(x, y) < 0:
                x += 0.1
            xs.append(x)
        xs = np.array(xs)
        runs = np.array(LineString(np.c_[xs, ys]).simplify(0.6).coords)        # the straight runs
        line = np.interp(ys, runs[:, 1], runs[:, 0])
        k = np.hanning(13); k /= k.sum()                                        # the corners between them, eased over 3 m
        line = np.convolve(np.pad(line, 6, mode="edge"), k, mode="valid")
        self._ey, self._ex = ys, line + max(0.0, float(np.percentile(xs - line, 96))) + 0.12
        self.YN = Y1 - 6.0        # where the level's edge ends (the landing beyond is the map's)

    def edge(self, y):
        return float(np.interp(y, self._ey, self._ex))

    def lift(self, x, y):
        """How far the paving rises to the kerb: the map's own quay has a coping over the ground, 0.1 to 0.3 m here
        (hero_coping.json: read from the running game), on the shore raster's stepped line; the pavers climb over
        it in their last metre and a half, flush with the kerb's top."""
        d = self.edge(y) - x
        t = min(1.0, max(0.0, (d - 2.0) / 1.4))
        return (self.kerb_up(y) - 0.04) * (1 - t * t * (3 - 2 * t)) if y < self.YN + 2 else 0.0

    def kerb_up(self, y):
        """The kerb's top over the ground at y: over the map's coping wherever that is higher than the kerb's own upstand."""
        if not hasattr(self, "_cop"):
            pts = np.array(json.load(open(os.path.join(HERE, "hero_coping.json")))["points"])
            ys = np.arange(Y0 - 6, Y1 + 6.01, 0.5)
            raw = np.array([max([KUP] + [h + 0.035 for _, py, h in pts if abs(py - yy) < 4.0]) for yy in ys])
            k = np.hanning(17); k /= k.sum()
            self._cop = ys, np.maximum(raw, np.convolve(np.pad(raw, 8, mode="edge"), k, mode="valid"))
        return float(np.interp(y, *self._cop))

    def gz(self, x, y):
        return self.G.z(x, y) + self.lift(x, y)

    def edge_frame(self, y):
        """(point on the quay's face, tangent, outward normal) at y."""
        t = hp.unit([self.edge(y + 0.5) - self.edge(y - 0.5), 1.0])
        return np.array([self.edge(y), y]), t, np.array([t[1], -t[0]])

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
        for i in range(3):
            A.cell(f"banner{i}", 224, 720, draw_banner(i))
        A.cell("pylon", 192, 640, draw_pylon)
        A.cell("ember", 384, 384, draw_ember)
        A.cell("doors", 512, 384, draw_doors)
        A.cell("arrow", 320, 384, draw_arrow)
        for i in range(4):
            A.cell(f"art{i}", 224, 288, draw_art(i))
        A.cell("clock", 320, 320, draw_clock)
        A.cell("letters_grey", 640, 256, draw_words(["Museum of", "Contemporary", "Art"], (70, 74, 82), (244, 244, 240), face="anton", align="l"))
        A.cell("letters_white", 512, 256, draw_words(["Museum of", "Contemporary", "Art Australia"], (246, 246, 243), (16, 16, 16), face="anton", align="l"))
        for i in range(6):
            A.cell(f"room_d{i}", 96, 192, draw_room(rng, False))
        for i in range(4):
            A.cell(f"room_l{i}", 96, 192, draw_room(rng, True))
        for i, n in enumerate(self.plaques):
            A.cell(f"plaque{i}", 192, 192, draw_plaque(n["tags"]["name"]))
        for i in range(3):
            A.cell(f"relief{i}", 160, 160, draw_relief(i))
        A.cell("cover", 128, 128, draw_cover)
        A.cell("flag_au", 192, 96, draw_flag("au"))
        A.cell("flag_ab", 192, 96, draw_flag("aboriginal"))
        A.cell("letters", 1280, 136, draw_words(["MUSEUM OF CONTEMPORARY ART"], (58, 42, 34), (196, 160, 104), pad=0.2))
        A.cell("drain", 256, 32, draw_drain)

    # -- what you walk on
    def ground(self):
        from shapely.geometry import LineString, Polygon, box
        from shapely.ops import unary_union
        G, geo, rep = self.G, self.geo, self.rep
        ys = np.arange(Y0, Y1 + 0.01, 1.0)
        shore = [(self.edge(y), y) for y in ys]
        land = Polygon([(-236, Y0)] + [(x - KERB, y) for x, y in shore] + [(-236, Y1)])
        full = Polygon([(-236, Y0)] + shore + [(-236, Y1)])
        mca = Polygon(next(w for w in self.ways(name="Museum of Contemporary Art"))["xy"]).buffer(0.25, join_style=2)
        site = land.difference(mca).buffer(0)
        site = max(getattr(site, "geoms", [site]), key=lambda p: p.area)
        lawn = Polygon(next(w for w in self.ways(name="Tallawoladah Lawn"))["xy"]).intersection(site)
        lawn_k = lawn.buffer(0.3, join_style=2)
        kerb = lawn_k.difference(lawn).intersection(site)
        prom = site.difference(lawn_k)
        # the pavers: a herringbone at 45 degrees to the quay, darker soldier courses across it every 7.4 m, one
        # along the kerb and one round the lawn
        qd = hp.unit([self.edge(Y1 - 40) - self.edge(Y0 + 30), Y1 - Y0 - 70])
        along = math.atan2(qd[1], qd[0])
        bands = [LineString([(-260, y - 26), (-120, y + 9)]).buffer(0.2, cap_style=2) for y in np.arange(Y0 - 20, Y1 + 30, 7.4)]
        edge_course = LineString([(x - KERB - 0.3, y) for x, y in shore]).buffer(0.3, cap_style=2)
        lawn_course = lawn_k.buffer(0.4, join_style=2).difference(lawn_k)
        band = unary_union(bands + [edge_course, lawn_course]).intersection(prom)
        hp.pave(geo, "ground_herring", G, prom.difference(band), rep["syd_herring"], rot=along + math.pi / 4)
        hp.pave(geo, "ground_header", G, band, rep["syd_header"], rot=along)
        for mat in ("ground_herring", "ground_header"):       # (the rise to the kerb, over the map's own coping)
            for q in geo.parts[mat]["p"]:
                q[2] += self.lift(q[0], q[1])
        hp.pave(geo, "ground_kerb", G, kerb, rep["syd_concrete"], dz=0.07)
        hp.pave(geo, "lawn_grass", G, lawn, rep["grass"], dz=0.05)
        self.prom, self.lawn, self.site = prom, lawn, site
        A, rng = self.A, self.rng
        # the Writers Walk: bronze discs in the paving, where OpenStreetMap maps each
        for i, n in enumerate(self.plaques):
            x, y = n["xy"]
            hp.disc(geo, "atlas_bronze", (x, y), 0.36, G.z(x, y) + 0.066, uv=A.uv(f"plaque{i}"))
            hp.disc(geo.fine, "metal_bronze", (x, y), 0.385, G.z(x, y) + 0.058)
        # a slot drain along the foot of the slope, covers where OpenStreetMap maps them, stains
        wd = hp.unit(np.subtract(WALL[1], WALL[0]))
        for y in np.arange(WALL[0][1] + 0.5, WALL[1][1] - 1.0, 1.0):
            x = self.wall_x(y) + 0.95
            hp.decal(geo, "ground_iron", G, (x + wd[0] * 0.5, y + 0.5), wd, 1.0 / wd[1], 0.13, uv=A.uv("drain"), dz=0.062)
        for n in self.nodes(man_made="manhole"):
            if site.contains(box(n["xy"][0] - 0.4, n["xy"][1] - 0.4, n["xy"][0] + 0.4, n["xy"][1] + 0.4)):
                hp.decal(geo, "ground_iron", G, n["xy"], (1, 0), 0.7, 0.7, uv=A.uv("cover"), dz=0.062)
        for y in (181.0, 226.5, 268.0):
            x = self.edge(y) - 6.0
            hp.decal(geo, "ground_iron", G, (x, y), (1, 0), 0.6, 0.6, uv=A.uv("cover"), dz=0.062)
        from shapely.geometry import Point
        for _ in range(34):
            y = Y0 + 4 + rng.random() * (Y1 - Y0 - 8)
            x = self.wall_x(y) + 1.5 + rng.random() * (self.edge(y) - self.wall_x(y) - 4)
            if prom.contains(Point(x, y).buffer(1.0)):
                hp.blob(geo, "ground_stain", G, (x, y), 0.1 + rng.random() * 0.3, rng)

    # -- the museum's sandstone front
    def band(self, F, u0, u1, out, z0, z1, faces=("front",), o0=None):
        """The stone under a coping, with the rain's runs down it: the parapet texture laid once up the band."""
        L = self.rep["syd_parapet"]
        P = F.P
        n = max(1, int(math.ceil((u1 - u0) / 3.0)))
        if "front" in faces:
            for i in range(n):
                ua, ub = u0 + (u1 - u0) * i / n, u0 + (u1 - u0) * (i + 1) / n
                self.geo.quad("stone_parapet", P(ua, out, z0), P(ub, out, z0), P(ub, out, z1), P(ua, out, z1),
                              uv=[(ua / L, 0), (ub / L, 0), (ub / L, 1), (ua / L, 1)], n=F.N)
        if o0 is not None:
            d = out - o0
            if "left" in faces:
                self.geo.quad("stone_parapet", P(u0, o0, z0), P(u0, out, z0), P(u0, out, z1), P(u0, o0, z1), uv=[(0.3, 0), (0.3 + d / L, 0), (0.3 + d / L, 1), (0.3, 1)])
            if "right" in faces:
                self.geo.quad("stone_parapet", P(u1, out, z0), P(u1, o0, z0), P(u1, o0, z1), P(u1, out, z1), uv=[(0.6, 0), (0.6 + d / L, 0), (0.6 + d / L, 1), (0.6, 1)])

    def bays(self, F, u0, u1, out, n, floors, top, small_top=False, lit=0.22, end=1.5, attic=2.4, ground=True):
        """A front of n bays as the building has them: each a recess running up through the storeys between flat
        piers, a pair of steel windows to a storey in it with a stone spandrel under each; a row of small windows
        over the recesses where small_top; a granite base, a string course and the stained attic under the coping."""
        geo, A, rng, rep = self.geo, self.A, self.rng, self.rep["syd_sandstone"]
        mat, dk = "stone_sand", "stone_sand_d"
        RD = 0.32                                    # the recess
        f0 = 0 if ground else 1
        nf = floors - (1 if small_top else 0)
        bw = (u1 - u0 - 2 * end) / n
        sw = min(3.05, bw - 1.05)                    # a recess's width
        za = ZF + 1.0 + STOREY * f0
        zb = ZF + 1.0 + STOREY * (nf - 1) + 2.85
        strips, small = [], []
        for b in range(n):
            uc = u0 + end + bw * (b + 0.5)
            strips.append((uc - sw / 2, uc + sw / 2, za, zb))
            if small_top:
                z0 = ZF + 1.25 + STOREY * nf
                for s in (-1, 1):
                    w0 = uc + s * 0.16 if s > 0 else uc - 0.16 - 1.1
                    small.append((w0, w0 + 1.1, z0, z0 + 1.45))
        z_att = top - attic
        hp.wall(geo, mat, F, u0, u1, ZB, z_att, out, rep, holes=strips + small)
        for (s0, s1, _, _) in strips:
            wins = []
            for f in range(f0, nf):
                z0 = ZF + 1.0 + STOREY * f
                for s in (-1, 1):
                    w0 = (s0 + s1) / 2 + 0.14 if s > 0 else (s0 + s1) / 2 - 0.14 - (sw / 2 - 0.32)
                    wins.append((w0, w0 + sw / 2 - 0.32, z0, z0 + 2.85))
            hp.wall(geo, dk, F, s0, s1, za, zb, out - RD, rep, holes=wins, ao=0.82)
            hp.fbox(geo, mat, F, s0 - 0.01, s0, out - RD, out, za, zb, rep, faces=("right",), ao=0.8)
            hp.fbox(geo, mat, F, s1, s1 + 0.01, out - RD, out, za, zb, rep, faces=("left",), ao=0.8)
            hp.fbox(geo, mat, F, s0, s1, out - RD, out, zb, zb + 0.01, rep, faces=("bottom",), ao=0.6)
            hp.fbox(geo, dk, F, s0, s1, out - RD, out + 0.05, za - 0.16, za, rep, faces=("front", "top", "left", "right"))
            for (w0, w1, z0, z1) in wins:
                on = rng.random() < lit
                key = f"room_l{int(rng.integers(4))}" if on else f"room_d{int(rng.integers(6))}"
                hp.window(geo, F, w0, w1, z0, z1, out - RD, 0.1, dk, rep, uv=A.uv(key), bars=(1, 3), sill=False, frame="metal_dark",
                          emit=(A.mean[key], 0.5) if on else None)
        for (w0, w1, z0, z1) in small:
            on = rng.random() < lit
            key = f"room_l{int(rng.integers(4))}" if on else f"room_d{int(rng.integers(6))}"
            hp.window(geo, F, w0, w1, z0, z1, out, 0.22, mat, rep, uv=A.uv(key), bars=(1, 1), frame="metal_dark", emit=(A.mean[key], 0.5) if on else None)
        # the base in polished granite, the string course, the attic with the rain's runs, the coping
        hp.fbox(geo, "stone_plinth", F, u0 - 0.02, u1 + 0.02, out, out + 0.1, ZB, ZF + 0.84, self.rep["granite"], faces=("front", "left", "right", "top"))
        hp.fbox(geo, dk, F, u0 - 0.06, u1 + 0.06, out, out + 0.16, z_att - 0.26, z_att, rep)
        self.band(F, u0, u1, out + 0.02, z_att, top)
        hp.fbox(geo, dk, F, u0 - 0.14, u1 + 0.14, out - 0.5, out + 0.2, top, top + 0.16, rep)
        self.geo.walls.append((F.P(u0, out, 0)[:2], F.P(u1, out, 0)[:2], ZF, top))

    def museum(self):
        geo, F, A, rep = self.geo, self.F, self.A, self.rep["syd_sandstone"]
        SK = 0.55                          # the skin, in front of the city's wall
        # the wings between the pavilions and the tower: six storeys, the top one's windows small
        self.bays(F, 15.6, 32.0, SK, 4, 6, WING_TOP, small_top=True, attic=3.0, end=1.3)
        self.bays(F, 45.2, 62.0, SK, 4, 6, WING_TOP, small_top=True, attic=3.0, end=1.3)
        # the end pavilions, 9.3 m forward and a storey lower: front and both returns, and a roof
        for (ua, ub) in ((1.5, 15.6), (62.0, 76.0)):
            PO = 9.3
            self.bays(F, ua, ub, PO, 3, 5, PAV_TOP)
            south = hp.Frame(F.P(ua, 0, 0), F.P(ua, PO, 0))            # faces south
            north = hp.Frame(F.P(ub, PO, 0), F.P(ub, 0, 0))            # faces north
            self.bays(south, 0.0, PO, 0.0, 2, 5, PAV_TOP, end=1.0)
            self.bays(north, 0.0, PO, 0.0, 2, 5, PAV_TOP, end=1.0)
            geo.quad("stone_sand_d", F.P(ua, 0, PAV_TOP - 0.2), F.P(ub, 0, PAV_TOP - 0.2), F.P(ub, PO, PAV_TOP - 0.2), F.P(ua, PO, PAV_TOP - 0.2),
                     n=(0, 0, 1.0), uv=[(0, 0), (4, 0), (4, 3), (0, 3)])
        # the south end of the main block, seen from First Fleet Park
        se = hp.Frame((-240.52, 174.36), (-225.79, 173.13))
        self.bays(se, 0.0, se.len - 0.3, 0.55, 3, 6, WING_TOP, small_top=True, attic=3.0, end=1.2)
        self.tower()
        # the cafe's flat white canopies along the wings' feet, either side of the tower
        for (ua, ub) in ((17.2, 31.2), (46.0, 60.4)):
            hp.fbox(geo, "paint_white", F, ua, ub, SK, SK + 4.6, ZF + 3.35, ZF + 3.55)
            for u in np.linspace(ua + 0.4, ub - 0.4, 5):
                geo.cylinder("metal_steel", F.P(u, SK + 4.3, ZB), 0.05, ZF + 3.35 - ZB, segs=6, cap=False)
            for u in np.linspace(ua + 1.6, ub - 1.6, 4):      # its downlights
                hp.disc(geo, "glow_lamp", F.P(u, SK + 2.4, 0)[:2], 0.08, ZF + 3.345, n=(0, 0, -1.0), segs=8)
                geo.emitters.append((F.P(u, SK + 2.4, ZF + 3.3), np.array([0, 0, -1.0]), 1.0, np.array([1.0, 0.85, 0.62]) * 16))
        # the floor of glass on the roof (2012), set back, under a white slab
        for (ua, ub) in ((2.0, 31.0), (46.2, 75.0)):
            hp.fbox(geo, "glass_green", F, ua, ub, -14.0, -2.2, WING_TOP, WING_TOP + 4.0, faces=("front", "left", "right"))
            for u in np.arange(ua, ub + 0.01, (ub - ua) / round((ub - ua) / 2.4)):
                hp.fbox(geo.fine, "metal_dark", F, u - 0.035, u + 0.035, -2.2, -2.12, WING_TOP, WING_TOP + 4.0, faces=("front", "left", "right"))
            hp.fbox(geo, "paint_white", F, ua - 1.4, ub + 1.4, -15.0, -0.4, WING_TOP + 4.0, WING_TOP + 4.4)

    def tower(self):
        geo, F, A, rep = self.geo, self.F, self.A, self.rep["syd_sandstone"]
        mat, dk, u0, u1, out = "stone_sand", "stone_sand_d", 32.0, 45.2, 2.6
        uc = (u0 + u1) / 2
        top = ZF + 33.3
        # the face: three strips of windows between slim piers, storey by storey, over the entrance
        strips = [uc - 1.75, uc, uc + 1.75]
        holes = []
        for f in range(1, 6):
            z0 = ZF + 1.6 + STOREY * f
            for us in strips:
                holes.append((us - 0.55, us + 0.55, z0, z0 + 2.75))
        door = (uc - 2.6, uc + 2.6, ZB, ZF + 6.2)
        hp.wall(geo, mat, F, u0, u1, ZB, top - 2.6, out, rep, holes=holes + [door])
        self.band(F, u0, u1, out + 0.01, top - 2.6, top, faces=("front", "left", "right"), o0=out - 4.0)
        hp.fbox(geo, mat, F, u0, u1, out - 4.0, out, ZB, top - 2.6, rep, faces=("left", "right"))      # its flanks, down to the wings and over their roofs
        for (w0, w1, z0, z1) in holes:
            on = self.rng.random() < 0.3
            key = f"room_l{int(self.rng.integers(4))}" if on else f"room_d{int(self.rng.integers(6))}"
            hp.window(geo, F, w0, w1, z0, z1, out, 0.4, mat, rep, uv=A.uv(key), bars=(1, 3), sill=False, frame="metal_dark", emit=(A.mean[key], 0.5) if on else None)
            hp.fbox(geo, "metal_bronze", F, w0, w1, out - 0.34, out - 0.26, z1, z1 + STOREY - 2.75, faces=("front",))   # a bronze spandrel
        for us in (uc - 0.875, uc + 0.875):       # the slim piers between the strips
            hp.fbox(geo, dk, F, us - 0.3, us + 0.3, out, out + 0.3, ZF + 6.4, ZF + 26.6, rep, faces=("front", "left", "right", "top"))
        for s in (-1, 1):                         # the great piers, stepped back twice as they rise (fluted in plan), and the shoulders
            for (a_, b_, o_, zt) in ((2.75, 4.9, 0.95, ZF + 30.4), (3.0, 4.65, 1.25, ZF + 29.2), (3.3, 4.35, 1.5, ZF + 27.6)):
                a, b = uc + s * a_, uc + s * b_
                hp.fbox(geo, mat, F, min(a, b), max(a, b), out, out + o_, ZB, zt, rep, faces=("front", "left", "right", "top"))
            c, d = uc + s * 4.9, uc + s * 6.6
            hp.fbox(geo, dk, F, min(c, d), max(c, d), out, out + 0.3, ZF + 26.8, ZF + 27.1, rep)
        for s, (a, b) in ((-1, (u0, uc - 4.9)), (1, (uc + 4.9, u1))):
            hp.fbox(geo, "stone_plinth", F, a, b, out, out + 0.1, ZB, ZF + 0.84, self.rep["granite"], faces=("front", "left", "right", "top"))
        # the carved panels, the clock, the stepped top, the stub and its pole
        for i, us in enumerate(strips):
            geo.quad("atlas_flat", F.P(us - 0.62, out + 0.02, ZF + 26.9), F.P(us + 0.62, out + 0.02, ZF + 26.9), F.P(us + 0.62, out + 0.02, ZF + 28.14), F.P(us - 0.62, out + 0.02, ZF + 28.14), uv=A.uv(f"relief{i}"))
        hp.disc(geo, "atlas_flat", F.P(uc, out + 0.04, 0)[:2], 1.3, ZF + 31.2, uv=A.uv("clock"), n=F.N, segs=32)
        for k, (ins, z0, z1) in enumerate(((3.1, top, top + 0.9), (3.6, top + 0.9, top + 1.8))):
            hp.fbox(geo, mat if k else dk, F, uc - 6.6 + ins, uc + 6.6 - ins, out - 4.0, out + 0.1 - 0.25 * k, z0, z1, rep)
        hp.fbox(geo, dk, F, u0 - 0.12, u1 + 0.12, out - 4.1, out + 0.16, top, top + 0.14, rep)
        hp.fbox(geo, mat, F, uc - 1.1, uc + 1.1, out - 3.2, out - 1.0, top + 1.8, top + 4.6, rep)
        hp.fbox(geo, dk, F, uc - 1.25, uc + 1.25, out - 3.35, out - 0.85, top + 4.6, top + 4.85, rep)
        pole = F.P(uc, out - 2.1, top + 4.85)
        geo.tube("paint_white", [pole, pole + [0, 0, 7.5]], 0.06, segs=6)
        self.flag(pole + [0, 0, 5.3], "flag_au", 3.2)
        for s, key in ((-1, "flag_au"), (1, "flag_ab")):      # the wings' roofs carry one each
            p = F.P(uc + s * 9.5, -3.0, WING_TOP + 4.4)
            geo.tube("paint_white", [p, p + [0, 0, 6.0]], 0.045, segs=6)
            self.flag(p + [0, 0, 4.2], key, 2.4)
        # the entrance: a portal of polished brown granite two storeys high, bronze doors under a bronze grille, the
        # name in bronze letters over them
        for s in (-1, 1):
            a, b = uc + s * 2.6, uc + s * 1.75
            hp.fbox(geo, "stone_plinth", F, min(a, b), max(a, b), out - 0.9, out + 0.06, ZB, ZF + 6.2, self.rep["granite"], faces=("front", "left", "right"))
        hp.fbox(geo, "stone_plinth", F, uc - 1.75, uc + 1.75, out - 0.9, out + 0.06, ZF + 4.7, ZF + 6.2, self.rep["granite"], faces=("front", "bottom"))
        geo.quad("atlas_flat", F.P(uc - 1.7, out + 0.07, ZF + 5.2), F.P(uc + 1.7, out + 0.07, ZF + 5.2), F.P(uc + 1.7, out + 0.07, ZF + 5.56), F.P(uc - 1.7, out + 0.07, ZF + 5.56), uv=A.uv("letters"))
        geo.quad("atlas_bronze", F.P(uc - 1.75, out - 0.85, ZB), F.P(uc + 1.75, out - 0.85, ZB), F.P(uc + 1.75, out - 0.85, ZF + 4.7), F.P(uc - 1.75, out - 0.85, ZF + 4.7), uv=A.uv("doors"))
        for us in np.linspace(uc - 0.8, uc + 0.8, 2):   # the portal's downlights
            geo.emitters.append((F.P(us, out - 0.4, ZF + 4.6), np.array([0, 0, -1.0]), 1.0, np.array([1.0, 0.85, 0.62]) * 20))
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

    # -- the Mordant Wing (Sam Marshall, 2012): on OpenStreetMap's outline, stacked as the photographs show it
    def mordant(self):
        geo, F, A = self.geo, self.F, self.A
        c = self.rep["syd_concrete"]
        M = MORDANT
        e0, e1, eo = M["entrance"]            # the entrance block along the front, and its face
        n1, no = M["north"]                   # the north block's end and face
        gz, bz = M["glass_top"], M["hall_back"]
        full = ("front", "left", "right", "bottom", "top")
        # the dark box by the old building, over the way through to George Street, with the name on it
        hp.fbox(geo, "grc_grey", F, 76.4, e0 + 3.4, 2.0, eo - 1.6, gz - 0.6, ZF + 14.2, c, faces=full)
        geo.quad("atlas_flat", F.P(76.9, eo - 1.57, ZF + 8.6), F.P(e0 + 3.0, eo - 1.57, ZF + 8.6), F.P(e0 + 3.0, eo - 1.57, ZF + 11.9), F.P(76.9, eo - 1.57, ZF + 11.9), uv=A.uv("letters_grey"))
        hp.fbox(geo, "grc_raw", F, 76.3, e0, 6.2, 6.45, ZB, gz - 0.6, c, faces=("front",))       # the way's back wall
        hp.fbox(geo, "grc_raw", F, e0 - 0.25, e0, 6.45, eo - 3.4, ZB, gz - 0.6, c, faces=("left", "front"))
        # the glazed entrance, two storeys high, set back under the white box
        self.hall(F, e0, e1, eo - 3.4, bz, gz)
        # the white boxes, a ribbon of glass between them, and the black one on top with its glazed corner
        hp.fbox(geo, "grc_white", F, e0 + 2.9, e1, 6.0, eo, gz, ZF + 12.4, c, faces=full)
        for z0, z1, o in ((ZF + 12.4, ZF + 14.6, eo - 1.0),):
            geo.quad("glass_dark", F.P(e0 + 3.4, o, z0), F.P(e1 - 0.4, o, z0), F.P(e1 - 0.4, o, z1), F.P(e0 + 3.4, o, z1))
            geo.quad("glass_dark", F.P(e0 + 3.4, 8.0, z0), F.P(e0 + 3.4, o, z0), F.P(e0 + 3.4, o, z1), F.P(e0 + 3.4, 8.0, z1))
        hp.fbox(geo, "grc_white", F, e0 + 1.9, e1, 6.0, eo - 0.6, ZF + 14.6, ZF + 19.8, c, faces=full)
        hp.fbox(geo, "grc_black", F, e0 - 2.6, e1, 3.0, eo - 1.8, ZF + 14.2, ZF + 25.4, faces=("front", "left", "right", "top"))
        geo.quad("glass_dark", F.P(e0 + 2.4, eo - 1.77, ZF + 20.6), F.P(e1 - 2.0, eo - 1.77, ZF + 20.6), F.P(e1 - 2.0, eo - 1.77, ZF + 24.8), F.P(e0 + 2.4, eo - 1.77, ZF + 24.8))
        for u in np.arange(e0 + 2.4, e1 - 1.9, 2.75):
            hp.fbox(geo.fine, "metal_dark", F, u - 0.03, u + 0.03, eo - 1.77, eo - 1.72, ZF + 20.6, ZF + 24.8, faces=("front", "left", "right"))
        # north of the entrance: the white wall of precast panels with the name at eye level, and the arrow on its
        # concrete foot; the dark storeys set back above
        wt = ZF + 17.0
        hp.fbox(geo, "grc_white", F, e1, n1, 0.0, no, ZB, wt, c, faces=("front", "left", "right", "top"))
        hp.fbox(geo, "grc_white", F, e1 - 0.02, e1, no, eo - 3.4, ZB, gz, c, faces=("left",))
        geo.quad("atlas_flat", F.P(e1 + 0.6, no + 0.03, ZF + 0.9), F.P(e1 + 4.4, no + 0.03, ZF + 0.9), F.P(e1 + 4.4, no + 0.03, ZF + 2.8), F.P(e1 + 0.6, no + 0.03, ZF + 2.8), uv=A.uv("letters_white"))
        hp.fbox(geo, "grc_raw", F, e1 + 5.2, e1 + 10.4, no, no + 0.05, ZB, ZF + 5.3, c, faces=("front", "left", "right", "top"))
        geo.quad("atlas_flat", F.P(e1 + 5.9, no + 0.08, ZF + 0.5), F.P(e1 + 9.7, no + 0.08, ZF + 0.5), F.P(e1 + 9.7, no + 0.08, ZF + 5.06), F.P(e1 + 5.9, no + 0.08, ZF + 5.06), uv=A.uv("arrow"))
        hp.fbox(geo, "grc_black", F, e1 + 1.5, n1, 0.0, no - 2.0, wt, ZF + 22.6, faces=("front", "left", "right", "top"))
        for u in np.arange(e1 + 3.54, n1 - 0.5, 3.54):      # the panels' joints
            hp.fbox(geo.fine, "metal_dark", F, u - 0.012, u + 0.012, no, no + 0.006, ZB, wt, faces=("front",))
        for zz in (ZF + 5.3, ZF + 11.2):
            hp.fbox(geo.fine, "metal_dark", F, e1, n1, no, no + 0.006, zz - 0.012, zz + 0.012, faces=("front",))
        self.geo.walls.append((F.P(e1, no, 0)[:2], F.P(n1, no, 0)[:2], ZF, wt))
        self.geo.walls.append((F.P(e0, eo - 3.4, 0)[:2], F.P(e1, eo - 3.4, 0)[:2], ZF, gz))

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
            geo.quad("atlas_flat", F.P(uc - 1.15, back + 0.04, zf + 1.2), F.P(uc + 1.15, back + 0.04, zf + 1.2), F.P(uc + 1.15, back + 0.04, zf + 4.2), F.P(uc - 1.15, back + 0.04, zf + 4.2), uv=A.uv(f"art{i % 4}"))
            q = [F.P(uc - 1.3, back + 1.6, top - 0.255), F.P(uc - 1.3, back + 1.9, top - 0.255), F.P(uc + 1.3, back + 1.9, top - 0.255), F.P(uc + 1.3, back + 1.6, top - 0.255)]
            geo.quad("glow_lamp", *q, n=(0, 0, -1.0))
            geo.emitters.append((F.P(uc, back + 1.75, top - 0.4), np.array([0, 0, -1.0]), 1.0, np.array([1.0, 0.9, 0.74]) * 30))
            geo.emitters.append((F.P(uc, out + 0.3, top - 1.0), hp.unit(np.r_[F.n, -0.7]), 1.0, np.array([1.0, 0.9, 0.74]) * 24))   # (what spills out through the glass)
        hp.fbox(geo, "metal_bronze", F, u1 - 5.4, u1 - 2.2, back + 2.6, back + 3.5, zf, zf + 1.05, faces=("front", "left", "right", "top"))    # the desk
        # the glass, frameless but for its head and fins; the door's portal in the fine model
        geo.quad("glass_hall", F.P(u0, out, ZB), F.P(u1, out, ZB), F.P(u1, out, top), F.P(u0, out, top), n=F.N)
        hp.fbox(geo, "metal_dark", F, u0, u1, out - 0.06, out + 0.06, top - 0.16, top, faces=("front", "bottom"))
        for u in np.arange(u0, u1 + 0.01, (u1 - u0) / 5):
            hp.fbox(geo, "metal_steel", F, u - 0.012, u + 0.012, out - 0.3, out, ZB, top, faces=("left", "right"))
        um = (u0 + u1) / 2
        hp.fbox(geo.fine, "metal_dark", F, um - 1.6, um + 1.6, out, out + 0.08, zf + 2.5, zf + 2.72)
        for u in (um - 1.6, um, um + 1.6):
            hp.fbox(geo.fine, "metal_dark", F, u - 0.03, u + 0.03, out, out + 0.06, ZB, zf + 2.5, faces=("front", "left", "right"))

    # -- the water's edge: the kerb, the concrete face down to the water, the fender piles, the balustrade
    def quay_edge(self):
        geo, G = self.geo, self.G
        L = 2.0
        ys = np.arange(Y0, self.YN + 0.01, L)
        tl = self.rep["syd_seawall"]
        P3 = lambda y, off, z: np.r_[self.edge_frame(y)[0] + self.edge_frame(y)[2] * off, z]
        zq = lambda y: max(G.z(self.edge(y) - 1.6, y), G.z(self.edge(y) - KERB - 0.05, y)) + 0.025     # (a finger over the pavers that meet it)
        s = 0.0
        for i, (ya, yb) in enumerate(zip(ys[:-1], ys[1:])):
            a, b = P3(ya, 0, 0), P3(yb, 0, 0)
            ln = np.linalg.norm(b - a)
            za, zb_ = zq(ya) + 0.1, zq(yb) + 0.1
            # the face, from under the kerb to a metre under the water; the kerb's own face over it
            geo.quad("conc_wall", a + [0, 0, -1.4], b + [0, 0, -1.4], b + [0, 0, zb_ - 0.3], a + [0, 0, za - 0.3],
                     uv=[(s / tl, 1 - (za + 1.2) / 4.0), ((s + ln) / tl, 1 - (zb_ + 1.2) / 4.0), ((s + ln) / tl, 1.0), (s / tl, 1.0)])
            oa, ob = P3(ya, 0.06, 0), P3(yb, 0.06, 0)
            ia, ib = P3(ya, -KERB, 0), P3(yb, -KERB, 0)
            za, zb_ = za + self.kerb_up(ya) - 0.1, zb_ + self.kerb_up(yb) - 0.1          # the kerb's top: an upstand, over the map's own coping
            geo.quad("ground_kerb", oa + [0, 0, za - 0.7], ob + [0, 0, zb_ - 0.7], ob + [0, 0, zb_], oa + [0, 0, za], uv=[(s, 0), (s + ln, 0), (s + ln, 0.7), (s, 0.7)])
            geo.quad("ground_kerb", P3(ya, 0, za - 0.7), P3(yb, 0, zb_ - 0.7), ob + [0, 0, zb_ - 0.7], oa + [0, 0, za - 0.7], n=(0, 0, -1.0))
            geo.quad("ground_kerb", ia + [0, 0, za], ib + [0, 0, zb_], ob + [0, 0, zb_], oa + [0, 0, za], n=(0, 0, 1.0), uv=[(s, 0), (s + ln, 0), (s + ln, KERB), (s, KERB)])
            geo.quad("ground_kerb", ib + [0, 0, zb_ - 0.4], ia + [0, 0, za - 0.4], ia + [0, 0, za], ib + [0, 0, zb_], uv=[(s, 0), (s + ln, 0), (s + ln, 0.4), (s, 0.4)], ao=0.75)
            s += ln
        # fender piles, white, standing off the face, a ladder at every third
        for k, y in enumerate(np.arange(Y0 + 7.0, self.YN - 3, 13.5)):
            p = P3(y, 0.32, -1.5)
            geo.cylinder("paint_pile", p, 0.17, zq(y) + 2.2, segs=10)
            geo.cylinder("iron_black", p + [0, 0, zq(y) + 2.2], 0.19, 0.12, segs=10)
            for zz in (0.9, zq(y) - 0.3):       # its brackets to the wall
                geo.box("iron_black", P3(y, 0.16, zz), (np.r_[self.edge_frame(y)[2], 0], np.r_[self.edge_frame(y)[1], 0]), (0.34, 0.1, 0.1))
            if k % 3 == 1:
                t = np.r_[self.edge_frame(y)[1], 0]
                for sgn in (-0.22, 0.22):
                    b0 = P3(y + 1.2, 0.12, 0) + t * sgn
                    geo.fine.tube("metal_steel", [b0 + [0, 0, -1.2], b0 + [0, 0, zq(y) + 0.1]], 0.02, segs=5)
                for zz in np.arange(-1.0, zq(y), 0.3):
                    b0 = P3(y + 1.2, 0.12, zz)
                    geo.fine.tube("metal_steel", [b0 - t * 0.22, b0 + t * 0.22], 0.014, segs=4)
        self.rail()

    def rail(self):
        """The quay's cast-iron balustrade (photographs: dark posts two metres apart with ball heads, a round top
        rail, a flat rail under it and one at the foot, a diagonal cross with a ring in each panel), on the kerb."""
        geo, G = self.geo, self.G
        mat = "metal_rail"
        ys = list(np.arange(Y0 + 0.4, self.YN - 0.2, 2.0))
        pts = []
        for y in ys:
            c, t, n = self.edge_frame(y)
            p = c - n * RAIL_IN
            pts.append(np.r_[p, G.z(self.edge(y) - 1.6, y) + self.kerb_up(y)])
        for i, p in enumerate(pts):
            geo.lathe(mat, p, [(0.075, 0.0), (0.075, 0.06), (0.05, 0.1), (0.042, 0.98), (0.06, 1.0), (0.06, 1.04), (0.03, 1.07)], segs=6)
            geo.lathe(mat, p + [0, 0, 1.07], [(0.0, 0.0), (0.05, 0.03), (0.062, 0.075), (0.05, 0.12), (0.0, 0.145)], segs=6)
        for a, b in zip(pts[:-1], pts[1:]):
            geo.tube(mat, [a + [0, 0, 0.99], b + [0, 0, 0.99]], 0.027, segs=5)
            for zz in (0.14, 0.78):
                geo.tube(mat, [a + [0, 0, zz], b + [0, 0, zz]], 0.016, segs=4)
            # the panel's cross and ring: seen as lines from more than a few metres, so in the fine model
            m = (a + b) / 2 + [0, 0, 0.46]
            d = hp.unit(b - a)
            fine = geo.fine
            for sg in (1, -1):
                fine.tube(mat, [a + [0, 0, 0.46 - sg * 0.3], m - d * 0.12 * 1 + [0, 0, -sg * 0.036]], 0.011, segs=4)
                fine.tube(mat, [m + d * 0.12 + [0, 0, sg * 0.036], b + [0, 0, 0.46 + sg * 0.3]], 0.011, segs=4)
            ring = [m + d * 0.125 * math.cos(th) + np.array([0, 0, 0.125 * math.sin(th)]) for th in np.linspace(0, 2 * math.pi, 13)]
            fine.tube(mat, ring, 0.011, segs=4)
        # lifebuoys on the rail, orange, every 40 m
        for y in np.arange(Y0 + 18, self.YN - 5, 41.0):
            c, t, n = self.edge_frame(y + 1.0)
            m = np.r_[c - n * (RAIL_IN + 0.07), G.z(self.edge(y) - 1.6, y) + self.kerb_up(y) + 0.46]
            T3 = np.r_[t, 0]
            ring = [m + T3 * 0.3 * math.cos(th) + np.array([0, 0, 0.3 * math.sin(th)]) for th in np.linspace(0, 2 * math.pi, 15)]
            geo.tube("paint_orange", ring, 0.055, segs=6)
            for th in (0.8, 2.4, 3.9, 5.5):
                q = m + T3 * 0.3 * math.cos(th) + np.array([0, 0, 0.3 * math.sin(th)])
                d = T3 * -math.sin(th) + np.array([0, 0, math.cos(th)])
                geo.fine.tube("paint_white", [q - d * 0.05, q + d * 0.05], 0.058, segs=6)

    # -- the lawn's seat wall
    def planting(self):
        geo, G, rng = self.geo, self.G, self.rng
        rc = self.rep["syd_concrete"]
        (xa, ya), (xb, yb) = WALL
        W = hp.Frame((xb, yb), (xa, ya))          # facing east (the quay)
        n = int(W.len / 3.0)
        for i in range(n):
            u0, u1 = W.len * i / n, W.len * (i + 1) / n
            za = min(G.z(*W.P(u, o, 0)[:2]) for u in (u0, u1) for o in (-0.3, 0.3)) - 0.15
            zt = max(G.z(*W.P(u, -0.3, 0)[:2]) for u in (u0, u1)) + 0.45
            hp.fbox(geo, "conc_seat", W, u0 + 0.006, u1 - 0.006, -0.3, 0.3, za, zt, rc, faces=("front", "back", "left", "right", "top"))
        self.geo.walls.append(((xa, ya), (xb, yb), G.z(xa, ya), G.z(xa, ya) + 0.5))

    # -- what stands on the promenade
    def globe(self, x, y, z):
        """One of the quay's ball lights: a white globe on a slender dark post."""
        geo = self.geo
        c = np.array([x, y, z])
        geo.lathe("metal_pole", c, [(0.1, 0.0), (0.1, 0.08), (0.06, 0.14), (0.045, 3.3), (0.07, 3.34), (0.11, 3.4), (0.11, 3.44)], segs=8)
        H, R = 3.44 + 0.22, 0.25
        prof = [(R * math.sin(a), H - R * math.cos(a)) for a in np.linspace(0.25, math.pi, 8)]
        geo.lathe("lamp_globe", c, prof, segs=12)
        k = np.array([1.0, 0.88, 0.7]) * 52
        geo.emitters.append((c + [0, 0, H - 0.3], np.array([0, 0, -1.0]), 1.0, k))
        for th in np.linspace(0, 2 * math.pi, 5)[:-1]:
            d = np.array([math.cos(th), math.sin(th), -0.25])
            geo.emitters.append((c + [0, 0, H] + d * 0.3, hp.unit(d), 1.0, k * 0.55))

    def banner_pole(self, x, y, z, hd, i):
        """A white flagpole with a tall banner flown from a top arm and held at its foot (the quay's are 10 m)."""
        geo, A = self.geo, self.A
        c = np.array([x, y, z])
        geo.lathe("paint_white", c, [(0.11, 0.0), (0.11, 0.3), (0.085, 0.36), (0.05, 10.2), (0.0, 10.3)], segs=8)
        s = np.array([math.cos(hd), math.sin(hd), 0.0])
        bw, bh, bz = 1.25, 4.4, 5.3
        for zz in (bz - 0.03, bz + bh + 0.03):
            geo.tube("paint_white", [c + [0, 0, zz], c + s * (bw + 0.16) + [0, 0, zz]], 0.02, segs=5)
        n = 5
        (ua, va), (ub, _), (_, vb), _ = A.uv(f"banner{i % 3}")
        nrm = np.array([-s[1], s[0], 0.0])
        for k in range(n):        # hung with a belly in it
            t0, t1 = k / n, (k + 1) / n
            w0, w1 = 0.07 * math.sin(t0 * math.pi), 0.07 * math.sin(t1 * math.pi)
            a0, b0 = c + s * 0.12 + nrm * w0 + [0, 0, bz + bh * t0], c + s * (0.12 + bw) + nrm * w0 * 1.6 + [0, 0, bz + bh * t0]
            a1, b1 = c + s * 0.12 + nrm * w1 + [0, 0, bz + bh * t1], c + s * (0.12 + bw) + nrm * w1 * 1.6 + [0, 0, bz + bh * t1]
            v0, v1 = va + (vb - va) * t0, va + (vb - va) * t1
            o = nrm * 0.006        # (printed on both sides: two faces a hair apart, each read from its own side)
            geo.quad("atlas_cloth", a0 - o, b0 - o, b1 - o, a1 - o, uv=[(ua, v0), (ub, v0), (ub, v1), (ua, v1)])
            geo.quad("atlas_cloth", b0 + o, a0 + o, a1 + o, b1 + o, uv=[(ua, v0), (ub, v0), (ub, v1), (ua, v1)])

    def furniture(self):
        geo, G, A, rng = self.geo, self.G, self.A, self.rng
        self.lamps = []
        # the ball lights along the balustrade, a banner pole between each pair
        for i, y in enumerate(np.arange(Y0 + 5.0, self.YN - 2, 16.5)):
            c, t, n = self.edge_frame(y)
            p = c - n * 1.75
            self.globe(p[0], p[1], self.gz(*p))
            self.lamps.append(tuple(p))
            y2 = y + 8.25
            if y2 < self.YN - 2:
                c2, t2, n2 = self.edge_frame(y2)
                q = c2 - n2 * 1.8
                self.banner_pole(q[0], q[1], self.gz(*q), math.atan2(-n2[1], -n2[0]), i)
            if i in (1, 4, 6):
                b = c - n * 2.0 + t * 3.0
                hp.bin_(geo, (b[0], b[1]), self.gz(*b))
        # the lawn side: globes along the seat wall's foot, facing the others
        for y in np.arange(WALL[0][1] + 9.0, WALL[1][1] - 4, 22.0):
            x = self.wall_x(y) + 1.6
            self.globe(x, y, G.z(x, y) + 0.03)
        hd0 = lambda y: math.atan2(self.edge_frame(y)[2][1], self.edge_frame(y)[2][0])
        for nd in self.nodes(amenity="bench"):
            x, y = nd["xy"]
            if Y0 < y < self.YN - 4:
                x = min(x, self.edge(y) - 2.5)
                hp.bench(geo, (x, y), hd0(y), self.gz(x, y) + 0.04, metal="metal_rail")
        for y in (190.5, 192.9, 241.0, 243.4, 263.5):       # more of them, facing the water (not mapped: placed)
            x = self.edge(y) - 2.5
            hp.bench(geo, (x, y), hd0(y), self.gz(x, y) + 0.04, metal="metal_rail")
        from shapely.geometry import Point
        inner = self.site.buffer(-0.3)
        for nd in self.nodes(barrier="bollard"):
            x, y = nd["xy"]
            if Y0 < y < Y1 - 0.5 and inner.contains(Point(x, y)):
                hp.bollard(geo, (x, y), G.z(x, y) + 0.03, band="paint_white")
        # wayfinding pylons
        for (x, y, hd) in ((self.wall_x(170.0) + 2.6, 170.0, 0.2), (-178.5, 270.0, -0.3)):
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

    # -- the light after dark that is not a lamp's
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
            up(F, u, 0.45 + 5.4)
        for u in np.arange(47.3, 61.0, 4.2):
            up(F, u, 0.45 + 5.4)
        for (ua, ub) in ((1.5, 15.6), (62.0, 76.0)):
            for u in np.arange(ua + 2.4, ub, 4.6):
                up(F, u, 9.3 + 2.6)
        for u in (34.0, 43.2):
            up(F, u, 2.6 + 3.4, 1.8)
        # the wing's white wall
        for u in np.arange(MORDANT["entrance"][1] + 2.5, MORDANT["north"][0] - 1, 5.0):
            up(F, u, MORDANT["north"][1] + 2.4, 0.5)


def build(K):
    """(geo, atlas, materials, meta) for blender/build_hero.py."""
    mats = materials(K)          # (first: it registers the level's own drawn surfaces with the kit)
    L = Level(K)
    geo, atlas = L.build()
    meta = {"id": ID, "at": [-195.0, 230.0], "r": 85.0, "z": 4.0, "glb": f"hero/{ID}.glb", "fine": f"hero/{ID}_fine.glb",
            "cell": 44.0, "fine_cell": 22.0, "bake_gain": 0.6}
    return geo, atlas, mats, meta
