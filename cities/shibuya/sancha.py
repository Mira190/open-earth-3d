"""Sangenjaya's backstreet front that pilgrims come for: the snack bar New Marina (スナック ニューマリーナ,
三軒茶屋 2-14-21), whose front a game gave its café, and the takoyaki stand beside it (たこはる), as they stand.

From a photograph of the front (the owner's, 2026): a two-storey house, the ground floor faced in orange-brown
brick tile, the upper floor rendered grey and stepping out over it; a steel roller shutter under a red dome
awning with a scalloped edge and the bar's name in white; a brick pier, then the door set in white-painted
brick with a bamboo blind beside it; a rust-brown duct hood on the wall, an air conditioner's outdoor unit and
two notices at the left; red clay pavers out to the lane. To the right the takoyaki stand: a dark plank front
with its name chalked in white, a red awning, a round sign on a bracket, a red paper lantern and a standing
table with two stools. Dimensions are read off the photograph against the shutter (about 2.3 m to its head).

The game's café is only its framing here: the same front seen from the lane, warm light at the door after
dark. Nothing of the game's art, name or logo is drawn.

    draw(path)                      the front's own texture sheet (yongen.jpg)
    meshes(K, m, block, quad)       the front on the wall m = {at, normal, len, z, top_m} (scene landmarks.yongen.marina)
    glows(m)                        its light on the lane after dark (web/night.js)
"""
import math

import numpy as np

MATERIALS = {
    "yongen": {"color": "#ffffff", "roughness": 0.8, "metalness": 0.0, "map": "yongen.jpg", "emissive_map": True, "glow": 1.1},
    "awning_red": {"color": "#c2343a", "roughness": 0.62, "metalness": 0.0},
    "awning_trim": {"color": "#f1ece2", "roughness": 0.7, "metalness": 0.0},
    "render_grey": {"color": "#8d8982", "roughness": 0.95, "metalness": 0.0},
    "duct_rust": {"color": "#6f4330", "roughness": 0.7, "metalness": 0.3},
    "ac_white": {"color": "#d9d8d2", "roughness": 0.6, "metalness": 0.1},
    "lantern_red": {"color": "#d8242a", "roughness": 0.7, "metalness": 0.0, "emissive": "#ff4a30", "glow": 1.5},
    "door_lamp": {"color": "#fff0d0", "roughness": 0.5, "metalness": 0.0, "emissive": "#ffc070", "glow": 2.4},
}

PX = 128   # pixels a metre on the sheet
# (key, width m, height m): each drawn at PX and packed on shelves
CELLS = [("brick", 2.0, 3.0), ("white", 1.6, 3.0), ("shutter", 1.6, 2.3), ("door", 0.8, 2.05), ("sudare", 0.45, 1.5),
         ("tako", 3.3, 2.25), ("paving", 5.6, 1.7), ("name", 1.5, 0.62), ("lantern", 0.34, 0.6), ("round", 0.5, 0.5),
         ("notice", 0.3, 0.42), ("grille", 0.8, 0.6)]
FINE = {"tako": 2, "name": 3, "lantern": 4, "round": 4}   # the lettered cells, drawn that many times finer
SHEET, SHEET_H = 1024, 2048


def layout():
    rects, x, y, row = {}, 0, 0, 0
    for k, w, h in CELLS:
        w, h = int(round(w * PX * FINE.get(k, 1))), int(round(h * PX * FINE.get(k, 1)))
        if x + w > SHEET:
            x, y, row = 0, y + row + 4, 0
        rects[k] = (x, y, w, h)
        x, row = x + w + 4, max(row, h)
    assert y + row <= SHEET_H, "the Sangenjaya sheet is full"
    return rects


def uv(key, crop=(0.0, 0.0, 1.0, 1.0)):
    """Texture coordinates [bottom-left, bottom-right, top-right, top-left] of a cell, or of a part of it."""
    x, y, w, h = layout()[key]
    u0, u1 = (x + w * crop[0]) / SHEET, (x + w * crop[2]) / SHEET
    v0, v1 = 1 - (y + h * (1 - crop[1])) / SHEET_H, 1 - (y + h * (1 - crop[3])) / SHEET_H
    return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]


def bricks(d, rect, rng, face, joint, bw, bh, jitter=14):
    """Running bond: bricks bw x bh pixels in a field of `joint`, each a little off the face colour."""
    x, y, w, h = rect
    d.rectangle([x, y, x + w, y + h], fill=joint)
    r = 0
    for yy in range(y, y + h, bh):
        off = -(bw // 2) if r % 2 else 0
        for xx in range(x + off, x + w, bw):
            c = tuple(int(np.clip(v + rng.integers(-jitter, jitter + 1), 0, 255)) for v in face)
            d.rectangle([max(x, xx + 1), yy + 1, min(x + w, xx + bw - 2), min(y + h, yy + bh - 2)], fill=c)
        r += 1


def draw(path, font):
    from PIL import Image, ImageDraw
    R = layout()
    img = Image.new("RGB", (SHEET, SHEET_H), (110, 100, 92))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(2014)
    # the ground floor's brick tile: orange-brown stretchers, 21 x 6 cm, pale joints; darker with damp at the foot
    bricks(d, R["brick"], rng, (178, 96, 58), (196, 170, 150), 27, 8, 18)
    x, y, w, h = R["brick"]
    for k in range(40):
        d.line([(x, y + h - k), (x + w, y + h - k)], fill=(60, 40, 30), width=1) if k % 3 == 0 and k < 30 else None
    # the door's surround: brick painted white, the paint worn at the edges
    bricks(d, R["white"], rng, (226, 224, 216), (188, 186, 180), 27, 8, 6)
    # the roller shutter: cream slats 7.5 cm deep, a shadow under each, the lock rail and the letter slot
    x, y, w, h = R["shutter"]
    d.rectangle([x, y, x + w, y + h], fill=(206, 198, 180))
    for yy in range(y, y + h, 10):
        d.line([(x, yy), (x + w, yy)], fill=(150, 142, 126), width=2)
        d.line([(x, yy + 3), (x + w, yy + 3)], fill=(224, 217, 200), width=1)
    d.rectangle([x, y + h - 26, x + w, y + h], fill=(178, 170, 152))
    d.rectangle([x + w // 2 - 22, y + int(h * 0.52), x + w // 2 + 22, y + int(h * 0.52) + 7], fill=(96, 92, 84))
    d.rectangle([x, y, x + 5, y + h], fill=(140, 134, 120))
    d.rectangle([x + w - 5, y, x + w, y + h], fill=(140, 134, 120))
    # the door: dark stained wood, a long handle, a small pink plate at eye height
    x, y, w, h = R["door"]
    d.rectangle([x, y, x + w, y + h], fill=(52, 36, 28))
    for xx in range(x + 8, x + w, 17):
        d.line([(xx, y + 6), (xx, y + h - 6)], fill=(42, 28, 22), width=2)
    d.rectangle([x + 3, y + 3, x + w - 3, y + h - 3], outline=(34, 24, 18), width=3)
    d.rounded_rectangle([x + w - 20, y + int(h * 0.42), x + w - 14, y + int(h * 0.6)], 3, fill=(170, 150, 110))
    d.rounded_rectangle([x + 22, y + int(h * 0.36), x + 44, y + int(h * 0.36) + 16], 5, fill=(236, 168, 176))
    # the bamboo blind beside the door
    x, y, w, h = R["sudare"]
    d.rectangle([x, y, x + w, y + h], fill=(186, 156, 104))
    for yy in range(y, y + h, 4):
        d.line([(x, yy), (x + w, yy)], fill=(150, 120, 74), width=1)
    for xx in (x + w // 4, x + 3 * w // 4):
        d.line([(xx, y), (xx, y + h)], fill=(110, 84, 50), width=2)
    # the takoyaki stand's front: dark planks, its name chalked on them, the octopus in red
    x, y, w, h = R["tako"]
    d.rectangle([x, y, x + w, y + h], fill=(44, 36, 32))
    for xx in range(x, x + w, 36):
        d.line([(xx, y), (xx, y + h)], fill=(30, 24, 22), width=4)
        d.line([(xx + 14, y), (xx + 14, y + h)], fill=(52, 43, 38), width=2)
    f = font("rocknroll", 60)
    d.text((x + int(w * 0.36), y + int(h * 0.2)), "NANIWANO AJI", font=f, fill=(236, 232, 224), anchor="mm")
    f = font("yomogi", 140)
    d.text((x + int(w * 0.3), y + int(h * 0.48)), "たこ", font=f, fill=(236, 232, 224), anchor="mm")
    d.text((x + int(w * 0.38), y + int(h * 0.78)), "はる", font=f, fill=(236, 232, 224), anchor="mm")
    ox, oy = x + int(w * 0.6), y + int(h * 0.42)   # the octopus: a round head, eight short arms
    d.ellipse([ox - 52, oy - 60, ox + 52, oy + 32], fill=(214, 44, 48))
    for k in range(8):
        a = math.pi * (0.1 + 0.8 * k / 7)
        d.line([(ox + 44 * math.cos(a), oy + 16), (ox + 80 * math.cos(a), oy + 44 + 28 * math.sin(a))], fill=(214, 44, 48), width=12)
    for sx in (-18, 18):
        d.ellipse([ox + sx - 8, oy - 24, ox + sx + 8, oy - 8], fill=(250, 246, 240))
        d.ellipse([ox + sx - 4, oy - 20, ox + sx + 4, oy - 12], fill=(20, 20, 20))
    # the forecourt: red clay pavers, 20 x 10 cm, laid in rows across the front
    bricks(d, R["paving"], rng, (150, 62, 50), (104, 78, 70), 26, 13, 14)
    # the bar's name on the awning: white on its red, スナック over ニューマリーナ
    x, y, w, h = R["name"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(194, 52, 58))
    d.text((x + int(w * 0.34), y + int(h * 0.26)), "スナック", font=font("kurenaido", 78), fill=(250, 246, 240), anchor="mm")
    d.text((x + w // 2, y + int(h * 0.68)), "ニューマリーナ", font=font("kurenaido", 100), fill=(250, 246, 240), anchor="mm")
    # the paper lantern's face: たこ焼 in black down its red
    x, y, w, h = R["lantern"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(216, 36, 42))
    for yy in range(y + 16, y + h, 24):
        d.line([(x, yy), (x + w, yy)], fill=(196, 28, 36), width=3)
    f = font("syuku", 88)
    for i, ch in enumerate("たこ焼"):
        d.text((x + w // 2, y + h * (0.2 + 0.3 * i)), ch, font=f, fill=(250, 246, 236), anchor="mm")
    # the round sign on its bracket
    x, y, w, h = R["round"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(70, 62, 56))
    d.ellipse([x + 1, y + 1, x + w - 1, y + h - 1], fill=(246, 240, 228), outline=(170, 40, 40), width=14)
    f = font("yomogi", 80)
    d.text((x + w // 2, y + h // 2 - 40), "たこ", font=f, fill=(40, 30, 26), anchor="mm")
    d.text((x + w // 2, y + h // 2 + 44), "はる", font=f, fill=(40, 30, 26), anchor="mm")
    # a notice taped to the brick: lines of small print, a red heading (not to be read)
    x, y, w, h = R["notice"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(244, 242, 236))
    d.rectangle([x + 4, y + 4, x + w - 4, y + 9], fill=(200, 60, 60))
    for yy in range(y + 14, y + h - 5, 4):
        d.line([(x + 4, yy), (x + w - 4 - (yy * 7) % 9, yy)], fill=(120, 120, 124), width=1)
    # the outdoor unit's grille
    x, y, w, h = R["grille"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(214, 213, 207))
    d.ellipse([x + 12, y + 8, x + 12 + h - 16, y + h - 8], fill=(168, 168, 164), outline=(120, 120, 118), width=2)
    for yy in range(y + 8, y + h - 6, 5):
        d.line([(x + 6, yy), (x + w - 6, yy)], fill=(150, 150, 146), width=1)
    img.save(path, quality=90)


def meshes(K, m):
    mid, n, z, L = np.asarray(m["at"], float), np.asarray(m["normal"], float), m["z"], m["len"]
    n = n / np.hypot(*n)
    t = np.array([-n[1], n[0]])                    # along the wall, left to right seen from the lane
    hl = L / 2 - 0.05
    P = lambda a, u, zz: np.array([*(mid + t * a + n * u), z + zz])   # a along the wall, u out from it, zz above the paving

    def box(mat, a0, a1, u0, u1, z0, z1):
        c = [P(a, u, zz) for zz in (z0, z1) for u in (u0, u1) for a in (a0, a1)]   # index z*4 + u*2 + a
        for i, j, k, l in ((0, 1, 5, 4), (3, 2, 6, 7), (1, 3, 7, 5), (2, 0, 4, 6), (4, 5, 7, 6), (2, 3, 1, 0)):
            mat.quad(c[i], c[j], c[k], c[l])

    def face(mat, a0, a1, u, z0, z1, key, crop=(0.0, 0.0, 1.0, 1.0)):
        mat.quad(P(a0, u, z0), P(a1, u, z0), P(a1, u, z1), P(a0, u, z1), uv(key, crop))

    Y, Yl = K("yongen"), K("yongen", "lit")
    split = min(1.0, hl - 2.4)                     # the bar's front to the left of it, the takoyaki stand to the right
    # --- the ground floor's skin: brick tile, the shutter, the pier, the white surround and the door
    zf = 2.95                                      # the upper floor's underside
    a_sh0, a_sh1 = split - 3.4, split - 1.8        # the shutter
    a_d0, a_d1 = split - 0.95, split - 0.15        # the door, set back in the white brick
    face(Y, -hl, a_sh0, 0.06, 0, zf, "brick", (0, 0, min(1.0, (a_sh0 + hl) / 2.0), zf / 3.0))
    face(Y, a_sh0, a_sh1, 0.03, 0, 2.3, "shutter")
    face(Y, a_sh0, a_sh1, 0.06, 2.3, zf, "brick", (0, 0.72, 0.8, 0.94))
    face(Y, a_sh1, a_sh1 + 0.3, 0.08, 0, zf, "brick", (0.8, 0, 0.95, zf / 3.0))            # the pier
    box(K("render_grey"), a_sh1, a_sh1 + 0.3, 0.0, 0.08, 0, zf)
    face(Y, a_sh1 + 0.3, a_d0, 0.06, 0, zf, "white", (0, 0, (a_d0 - a_sh1 - 0.3) / 1.6, zf / 3.0))
    face(Y, a_d0, a_d1, 0.0, 0, 2.05, "door")
    face(Y, a_d0, a_d1, 0.06, 2.05, zf, "white", (0.3, 0.7, 0.8, 1.0))
    face(Y, a_d1, split, 0.06, 0, zf, "white", (0.5, 0, 0.5 + (split - a_d1) / 1.6, zf / 3.0))
    for a in (a_d0, a_d1):                         # the door's reveals
        s = 1 if a == a_d0 else -1
        Y.quad(P(a, 0.06, 0), P(a, 0.0, 0), P(a, 0.0, 2.05), P(a, 0.06, 2.05), uv("white", (0, 0, 0.05, 0.68))) if s > 0 else \
            Y.quad(P(a, 0.0, 0), P(a, 0.06, 0), P(a, 0.06, 2.05), P(a, 0.0, 2.05), uv("white", (0, 0, 0.05, 0.68)))
    face(Y, a_d1 + 0.12, min(split - 0.05, a_d1 + 0.57), 0.085, 0.55, 2.05, "sudare")
    box(K("wood_dark"), a_d1 + 0.02, a_d1 + 0.1, 0.06, 0.1, 1.25, 1.75)                     # the small wooden plate by the door
    # --- the upper floor stepping out over the bar, rendered grey, and its windows' sills
    box(K("render_grey"), -hl, split + 0.2, 0.0, 0.62, zf, zf + 1.35)
    box(K("render_grey"), -hl, split + 0.2, 0.0, 0.16, zf + 1.35, min(m["top_m"], zf + 4.4))
    box(K("steel_dark"), a_sh1 - 0.9, a_sh1 + 1.3, 0.16, 0.2, zf + 1.75, zf + 3.0)          # the upper window
    box(K("ac_white"), a_sh1 - 0.95, a_sh1 + 1.35, 0.16, 0.26, zf + 1.66, zf + 1.75)
    # --- the dome awning over the shutter: eight ribbed gores, a scalloped edge with a white trim, the name on it
    ac, Rr, D, Hh, zb = (a_sh0 + a_sh1) / 2, (a_sh1 - a_sh0) / 2 + 0.22, 1.02, 0.86, 2.22
    dome = lambda ph, th, k=1.0: P(ac - Rr * k * math.cos(ph) * math.cos(th), 0.05 + D * k * math.sin(ph) * math.cos(th), zb + Hh * k * math.sin(th))
    G, T = 8, 5
    A = K("awning_red")
    for g in range(G):
        p0, p1 = math.pi * g / G, math.pi * (g + 1) / G
        for j in range(T):
            t0, t1 = math.pi / 2 * j / T, math.pi / 2 * (j + 1) / T
            A.quad(dome(p0, t0), dome(p1, t0), dome(p1, t1), dome(p0, t1))
        # the valance: two scallops a gore, each a shallow curve of three facets
        for s in range(2):
            q0, q1 = p0 + (p1 - p0) * s / 2, p0 + (p1 - p0) * (s + 1) / 2
            for e in range(3):
                r0, r1 = q0 + (q1 - q0) * e / 3, q0 + (q1 - q0) * (e + 1) / 3
                d0, d1 = 0.1 + 0.07 * math.sin(math.pi * e / 3), 0.1 + 0.07 * math.sin(math.pi * (e + 1) / 3)
                top0, top1 = dome(r0, 0), dome(r1, 0)
                A.quad(top0 - [0, 0, d0], top1 - [0, 0, d1], top1, top0)
                K("awning_trim").quad(top0 - [0, 0, d0 + 0.018], top1 - [0, 0, d1 + 0.018], top1 - [0, 0, d1], top0 - [0, 0, d0])
    # (the name: on the gores that face down the lane to the right, where the photograph has it)
    na, nb = math.pi * 0.52, math.pi * 0.86
    Yl.quad(dome(na, 0.12, 1.02), dome(nb, 0.12, 1.02), dome(nb, 0.62, 1.02), dome(na, 0.62, 1.02), uv("name"))
    # --- the duct hood on the wall, rust brown, turning down over the awning's left
    a_du = a_sh0 - 0.75
    box(K("duct_rust"), a_du, a_du + 0.55, 0.06, 0.5, 2.0, zf + 0.1)
    box(K("duct_rust"), a_du - 0.04, a_du + 0.59, 0.06, 0.56, 1.86, 2.0)
    # --- at the left: the downpipe, the outdoor unit on its blocks, two notices on the brick
    K("ac_white").tube([P(a_sh0 - 0.12, 0.14, 2.3), P(a_sh0 - 0.12, 0.14, 1.05), P(a_sh0 - 0.2, 0.3, 0.85)], 0.045, 8)
    if a_sh0 - 1.0 > -hl:
        a_ac0, a_ac1 = max(-hl + 0.05, a_sh0 - 1.25), a_sh0 - 0.3
        box(K("stone"), a_ac0 + 0.05, a_ac1 - 0.05, 0.5, 0.86, 0.0, 0.12)
        box(K("ac_white"), a_ac0, a_ac1, 0.48, 0.88, 0.12, 0.82)
        face(Y, a_ac0 + 0.04, a_ac1 - 0.04, 0.885, 0.16, 0.78, "grille")
        for k, zz in enumerate((1.05, 1.62)):
            face(Y, a_ac0 + 0.1, a_ac0 + 0.4, 0.075, zz, zz + 0.42, "notice")
    # --- a lamp over the door: the warm light the front is remembered by
    box(K("steel_dark"), a_d0 + 0.3, a_d0 + 0.5, 0.06, 0.2, 2.34, 2.38)
    box(K("door_lamp", "lit"), a_d0 + 0.32, a_d0 + 0.48, 0.09, 0.19, 2.2, 2.34)
    # --- the takoyaki stand: its plank front, the red awning, the round sign, the lantern, the table and stools
    a_t1 = min(hl, split + 3.3)
    face(Y, split + 0.02, a_t1, 0.1, 0, 2.25, "tako", (0, 0, (a_t1 - split) / 3.3, 1))
    box(K("wood_dark"), split, split + 0.06, 0.0, 0.14, 0, 2.3)
    box(K("steel_dark"), split, a_t1, 0.0, 0.5, 2.3, 2.42)                                   # its eave
    for k in range(2):                                                                       # the awning, let down at a slope
        a0, a1 = split + 0.05 + k * (a_t1 - split - 0.05) / 2, split + 0.05 + (k + 1) * (a_t1 - split - 0.05) / 2
        A.quad(P(a0, 0.95, 2.36), P(a1, 0.95, 2.36), P(a1, 0.1, 2.7), P(a0, 0.1, 2.7))
        A.quad(P(a0, 0.95, 2.24), P(a1, 0.95, 2.24), P(a1, 0.95, 2.36), P(a0, 0.95, 2.36))
    ar = split + 0.45                                                                        # the round sign, read from both ways along the lane
    box(K("steel_dark"), ar - 0.015, ar + 0.015, 0.1, 0.75, 2.12, 2.15)
    Yl.quad(P(ar + 0.02, 0.2, 1.6), P(ar + 0.02, 0.7, 1.6), P(ar + 0.02, 0.7, 2.1), P(ar + 0.02, 0.2, 2.1), uv("round"))
    Yl.quad(P(ar - 0.02, 0.7, 1.6), P(ar - 0.02, 0.2, 1.6), P(ar - 0.02, 0.2, 2.1), P(ar - 0.02, 0.7, 2.1), uv("round"))
    al = a_t1 - 0.55                                                                         # the lantern under the eave
    lx, ly, _ = P(al, 0.42, 0)
    K("lantern_red", "lit").lathe([(z + 1.52, 0.05), (z + 1.57, 0.14), (z + 1.78, 0.17), (z + 2.0, 0.14), (z + 2.05, 0.05)], (float(lx), float(ly)), 12)
    K("steel_dark").lathe([(z + 2.05, 0.06), (z + 2.09, 0.06)], (float(lx), float(ly)), 8)
    K("steel_dark").lathe([(z + 1.48, 0.06), (z + 1.52, 0.06)], (float(lx), float(ly)), 8)
    K("steel_dark").tube([P(al, 0.42, 2.09), P(al, 0.42, 2.3)], 0.008, 4)
    Yl.quad(P(al - 0.1, 0.595, 1.6), P(al + 0.1, 0.595, 1.6), P(al + 0.1, 0.595, 1.98), P(al - 0.1, 0.595, 1.98), uv("lantern", (0.1, 0.05, 0.9, 0.95)))
    at0, at1 = split + 0.2, split + 1.3                                                      # the standing table and two stools
    box(K("wood_dark"), at0, at1, 0.45, 0.95, 1.0, 1.05)
    for a in (at0 + 0.08, at1 - 0.08):
        K("steel_dark").tube([P(a, 0.7, 0.0), P(a, 0.7, 1.0)], 0.025, 6)
        fx, fy, _ = P(a, 0.7, 0)
        K("steel_dark").lathe([(z, 0.2), (z + 0.03, 0.2)], (float(fx), float(fy)), 12)
    for a in (at0 + 0.25, at1 - 0.2):
        sx, sy, _ = P(a, 1.3, 0)
        K("steel_dark").lathe([(z, 0.17), (z + 0.03, 0.17), (z + 0.04, 0.03), (z + 0.66, 0.03), (z + 0.68, 0.16), (z + 0.74, 0.16)], (float(sx), float(sy)), 12)
    # --- the forecourt's pavers, from the wall out to the lane's kerb
    Y.quad(P(-hl, 1.75, 0.035), P(min(hl, split + 1.3), 1.75, 0.035), P(min(hl, split + 1.3), 0.0, 0.035), P(-hl, 0.0, 0.035),
           uv("paving", (0, 0, min(1.0, (min(hl, split + 1.3) + hl) / 5.6), 1)))
    return {"door": [float(v) for v in P((a_d0 + a_d1) / 2, 0, 0)[:2]], "awning": [float(v) for v in P(ac, 0.6, 0)[:2]]}


def glows(m):
    """The door lamp's pool on the pavers and the lantern's red, from dusk to closing."""
    mid, n = np.asarray(m["at"], float), np.asarray(m["normal"], float)
    t = np.array([-n[1], n[0]])
    split = min(1.0, m["len"] / 2 - 2.45)
    door, lant = mid + t * (split - 0.55) + n * 1.0, mid + t * (split + 2.6) + n * 0.8
    return [[round(float(door[0]), 1), round(float(door[1]), 1), 5.0, "#ffc27a", 0.34], [round(float(lant[0]), 1), round(float(lant[1]), 1), 3.5, "#ff6a4a", 0.22]]
