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
    "awning_pale": {"color": "#d6d3c8", "roughness": 0.7, "metalness": 0.0},
    "render_grey": {"color": "#8d8982", "roughness": 0.95, "metalness": 0.0},
    "duct_rust": {"color": "#6f4330", "roughness": 0.7, "metalness": 0.3},
    "ac_white": {"color": "#d9d8d2", "roughness": 0.6, "metalness": 0.1},
    "lantern_red": {"color": "#d8242a", "roughness": 0.7, "metalness": 0.0, "emissive": "#ff4a30", "glow": 1.5},
    "awning_ochre": {"color": "#c4a048", "roughness": 0.75, "metalness": 0.0},
    "stucco_beige": {"color": "#cdbfa8", "roughness": 0.95, "metalness": 0.0},
    "wood_weathered": {"color": "#6b5a48", "roughness": 0.92, "metalness": 0.0},
    "concrete_stain": {"color": "#8f8a80", "roughness": 0.95, "metalness": 0.0},
    "door_lamp": {"color": "#fff0d0", "roughness": 0.5, "metalness": 0.0, "emissive": "#ffc070", "glow": 2.4},
    # (what stands in a lane two metres wide is drawn but not walled: walkers would be shut out of the lane)
    "stair_steel": {"color": "#55595c", "roughness": 0.6, "metalness": 0.45, "solid": False},
    "stair_rail": {"color": "#e4e2dc", "roughness": 0.55, "metalness": 0.2, "solid": False},
    "siding_blue": {"color": "#a9b6bc", "roughness": 0.85, "metalness": 0.0},
    "deck_grey": {"color": "#9a968e", "roughness": 0.95, "metalness": 0.0, "solid": False},
    "tube_lamp": {"color": "#f4f8ff", "roughness": 0.4, "metalness": 0.0, "emissive": "#e8f2ff", "glow": 1.8, "solid": False},
    "yongen_lane": {"color": "#ffffff", "roughness": 0.8, "metalness": 0.0, "map": "yongen.jpg", "emissive_map": True, "glow": 1.1, "solid": False},
    "net_frame": {"color": "#3d4640", "roughness": 0.7, "metalness": 0.4},
    "cage_net": {"color": "#22302a", "roughness": 0.95, "metalness": 0.0, "opacity": 0.38, "solid": False},
    "hm_yellow": {"color": "#f2c200", "roughness": 0.6, "metalness": 0.0, "emissive": "#f2c200", "glow": 0.55},   # (floodlit from its cornice after dark)
    "pot_green": {"color": "#3f5a32", "roughness": 0.9, "metalness": 0.0, "solid": False},
}

PX = 128   # pixels a metre on the sheet
# (key, width m, height m): each drawn at PX and packed on shelves
CELLS = [("brick", 2.0, 3.0), ("white", 1.6, 3.0), ("shutter", 1.6, 2.3), ("door", 0.8, 2.05), ("sudare", 0.45, 1.5),
         ("tako", 3.3, 2.25), ("paving", 5.6, 1.7), ("name", 1.5, 0.62), ("lantern", 0.34, 0.6), ("round", 0.5, 0.5),
         ("notice", 0.3, 0.42), ("grille", 0.8, 0.6), ("goodday", 1.5, 0.75),
         ("corr_brown", 1.6, 2.2), ("corr_rust", 2.0, 2.4), ("corr_galv", 2.0, 2.6), ("chiyo_board", 1.55, 0.68),
         ("puku_awn", 7.8, 0.72), ("puku_v", 0.75, 3.1), ("noren", 1.0, 0.9),
         ("siding", 2.0, 2.0), ("sash", 1.2, 1.0), ("door_al", 0.8, 2.0), ("tile_wall", 1.0, 1.0), ("tile_floor", 1.0, 1.0),
         ("bar0", 0.4, 0.95), ("bar1", 0.4, 0.95), ("bar2", 0.4, 0.95), ("bar3", 0.4, 0.95), ("arrow", 0.9, 0.3),
         ("hm_wall", 12.0, 3.2), ("hm_v", 0.7, 3.6), ("cinema_v", 0.7, 3.6), ("batting", 2.6, 0.7), ("shopfront", 3.2, 2.6)]
FINE = {"tako": 2, "name": 3, "lantern": 4, "round": 4, "goodday": 3, "chiyo_board": 3, "puku_v": 2, "noren": 2,
        "bar0": 3, "bar1": 3, "bar2": 3, "bar3": 3, "arrow": 2, "hm_v": 2, "cinema_v": 2, "batting": 3}   # the lettered cells, drawn that many times finer
SHEET, SHEET_H = 2048, 4096


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
    # the left bay's name on its pale awning: green serif, stepped down to the right, SINCE 1986 under it
    x, y, w, h = R["goodday"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(214, 211, 200))
    f = font("mincho", 92)
    d.text((x + int(w * 0.36), y + int(h * 0.24)), "Good-day", font=f, fill=(40, 110, 70), anchor="mm")
    d.text((x + int(w * 0.6), y + int(h * 0.56)), "Good-day", font=f, fill=(40, 110, 70), anchor="mm")
    d.text((x + int(w * 0.62), y + int(h * 0.86)), "SINCE 1986", font=font("mincho", 44), fill=(150, 132, 84), anchor="mm")
    # Chiyo-no-yu's fence: corrugated sheet, its ribs 7.6 cm apart, each in its own weather
    def corrugated(rect, base, rust):
        x, y, w, h = rect
        d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=base)
        for xx in range(x, x + w, 10):
            d.line([(xx, y), (xx, y + h)], fill=tuple(max(0, v - 34) for v in base), width=3)
            d.line([(xx + 5, y), (xx + 5, y + h)], fill=tuple(min(255, v + 22) for v in base), width=2)
        for k in range(int(w * h * rust / 900)):       # rust and streaks, run down from the fixings
            rx, ry = x + int(rng.integers(0, w)), y + int(rng.integers(0, h))
            d.line([(rx, ry), (rx + int(rng.integers(-2, 3)), min(y + h, ry + int(rng.integers(8, 60))))], fill=(118, 70, 40), width=int(rng.integers(1, 4)))
        for yy in (y + 18, y + h - 22):                 # the screws along the rails
            for xx in range(x + 14, x + w, 40):
                d.ellipse([xx - 2, yy - 2, xx + 2, yy + 2], fill=(70, 60, 54))
    corrugated(R["corr_brown"], (112, 82, 70), 0.05)
    corrugated(R["corr_rust"], (128, 104, 86), 1.0)
    corrugated(R["corr_galv"], (168, 174, 178), 0.06)
    # the hand-painted board over the boarded alley: 千代の湯 in green and 入口 in red, (コインランドリー),
    # and the request to keep off a private way
    x, y, w, h = R["chiyo_board"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(226, 220, 204))
    d.rectangle([x + 4, y + 4, x + w - 4, y + h - 4], outline=(160, 150, 130), width=4)
    for k in range(18):                                 # its weathering
        rx, ry = x + int(rng.integers(0, w)), y + int(rng.integers(0, h))
        d.ellipse([rx, ry, rx + 6, ry + 4], fill=(196, 188, 170))
    f = font("klee", 62)
    d.text((x + int(w * 0.36), y + int(h * 0.2)), "千代の湯", font=f, fill=(46, 104, 52), anchor="mm")
    d.text((x + int(w * 0.72), y + int(h * 0.2)), "入口", font=f, fill=(178, 40, 36), anchor="mm")
    d.text((x + w // 2, y + int(h * 0.47)), "（コインランドリー）", font=font("klee", 50), fill=(46, 104, 52), anchor="mm")
    f = font("klee", 36)
    d.text((x + w // 2, y + int(h * 0.71)), "私有地に付き利用者以外", font=f, fill=(34, 32, 30), anchor="mm")
    d.text((x + w // 2, y + int(h * 0.88)), "の通行はお断り致します", font=f, fill=(34, 32, 30), anchor="mm")
    # Pukuichi's awning: ochre canvas, white lettering, the round gold crest with 福一 between ぷく and いち
    x, y, w, h = R["puku_awn"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(196, 160, 72))
    for xx in range(x, x + w, int(w / 7.8)):          # the canvas's seams, about a metre apart
        d.line([(xx, y), (xx, y + h)], fill=(182, 146, 62), width=2)
    d.text((x + w // 2, y + int(h * 0.15)), "鉄板・広島府中焼き", font=font("mincho", 13), fill=(250, 246, 232), anchor="mm")
    def crest(cx, cy, r, ring, ink):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ring)
        d.ellipse([cx - r + 3, cy - r + 3, cx + r - 3, cy + r - 3], outline=ink, width=2)
        d.ellipse([cx - r * 0.72, cy - r * 0.72, cx + r * 0.72, cy + r * 0.72], outline=ink, width=2)
        d.text((cx, cy), "福一", font=font("mincho", int(r * 0.7)), fill=ink, anchor="mm")
    f = font("kurenaido", 54)
    d.text((x + w // 2 - 46, y + int(h * 0.6)), "ぷく", font=f, fill=(250, 246, 232), anchor="rm")
    crest(x + w // 2, y + int(h * 0.58), 36, (214, 176, 84), (250, 238, 200))
    d.text((x + w // 2 + 46, y + int(h * 0.6)), "いち", font=f, fill=(250, 246, 232), anchor="lm")
    # its vertical sign on the corner: orange-red, 鉄板 広島府中焼き small, then ぷく, the crest, いち
    x, y, w, h = R["puku_v"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(222, 74, 40))
    d.rectangle([x + 4, y + 4, x + w - 4, y + h - 4], outline=(246, 230, 214), width=3)
    f = font("mincho", 30)
    for i, (a_, b_) in enumerate((("鉄", "広"), ("板", "島"), ("", "府"), ("", "中"), ("", "焼"), ("", "き"))):
        if a_: d.text((x + w * 0.7, y + 30 + i * 34), a_, font=f, fill=(250, 244, 236), anchor="mm")
        d.text((x + w * 0.38, y + 30 + i * 34), b_, font=f, fill=(250, 244, 236), anchor="mm")
    f = font("kurenaido", 112)
    d.text((x + w // 2, y + int(h * 0.42)), "ぷ", font=f, fill=(250, 244, 236), anchor="mm")
    d.text((x + w // 2, y + int(h * 0.55)), "く", font=f, fill=(250, 244, 236), anchor="mm")
    crest(x + w // 2, y + int(h * 0.68), 54, (240, 160, 70), (250, 238, 214))
    d.text((x + w // 2, y + int(h * 0.81)), "い", font=f, fill=(250, 244, 236), anchor="mm")
    d.text((x + w // 2, y + int(h * 0.93)), "ち", font=f, fill=(250, 244, 236), anchor="mm")
    # white noren over the glass, in five panels, the crest faint on the middle one
    x, y, w, h = R["noren"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(240, 238, 230))
    for k in range(1, 5):
        d.line([(x + w * k / 5, y + 16), (x + w * k / 5, y + h)], fill=(196, 194, 186), width=3)
    d.rectangle([x, y, x + w, y + 10], fill=(214, 212, 204))
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
    draw_more(d, R, rng, font)
    img.save(path, quality=90)


def draw_more(d, R, rng, font):
    """The cells of the stops past New Marina: the stair corner, the fork and the passage, Hanamasa's block."""
    def fit(name, size, text, maxw):
        """The font at `size` or smaller, so that `text` is at most maxw pixels wide."""
        while size > 8 and d.textlength(text, font=font(name, size)) > maxw:
            size = int(size * 0.92)
        return font(name, size)
    # the stair corner's lap siding: pale blue-grey boards 18 cm deep, each with its shadow line, weathered at the foot
    x, y, w, h = R["siding"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(170, 182, 188))
    for yy in range(y, y + h, 23):
        c = tuple(int(np.clip(v + rng.integers(-5, 6), 0, 255)) for v in (172, 184, 190))
        d.rectangle([x, yy, x + w, yy + 20], fill=c)
        d.line([(x, yy + 21), (x + w, yy + 21)], fill=(118, 128, 134), width=2)
    for k in range(60):                                 # streaks under the sills, and dust
        rx, ry = x + int(rng.integers(0, w)), y + int(rng.integers(0, h))
        d.line([(rx, ry), (rx, min(y + h, ry + int(rng.integers(6, 30))))], fill=(150, 160, 164), width=1)
    # an aluminium sash: two panes of frosted glass, the frame, the crescent lock, a grille of bars outside
    x, y, w, h = R["sash"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(176, 178, 176))
    for k in range(2):
        x0 = x + 8 + k * (w - 16) // 2
        d.rectangle([x0 + 3, y + 8, x0 + (w - 16) // 2 - 3, y + h - 8], fill=(198, 204, 202))
        for yy in range(y + 10, y + h - 10, 4):
            d.line([(x0 + 4, yy), (x0 + (w - 16) // 2 - 4, yy)], fill=(206, 211, 209), width=1)
    d.rectangle([x + w // 2 - 4, y + h // 2 - 3, x + w // 2 + 4, y + h // 2 + 3], fill=(120, 120, 118))
    for xx in range(x + 10, x + w, 16):
        d.line([(xx, y + 2), (xx, y + h - 2)], fill=(120, 124, 124), width=3)
    # the door on the landing: aluminium, a frosted pane, a lever
    x, y, w, h = R["door_al"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(160, 162, 160))
    d.rectangle([x + 10, y + 12, x + w - 10, y + int(h * 0.55)], fill=(196, 202, 200))
    d.rectangle([x + 10, y + int(h * 0.6), x + w - 10, y + h - 10], fill=(150, 152, 150))
    d.rectangle([x + w - 22, y + int(h * 0.52), x + w - 12, y + int(h * 0.55)], fill=(80, 80, 80))
    # the passage: walls in small cream tiles to shoulder height, the floor in grey quarry tiles, worn down the middle
    x, y, w, h = R["tile_wall"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(170, 164, 150))
    for yy in range(y, y + h, 13):
        for xx in range(x, x + w, 13):
            c = tuple(int(np.clip(v + rng.integers(-8, 9), 0, 255)) for v in (226, 218, 196))
            d.rectangle([xx + 1, yy + 1, xx + 11, yy + 11], fill=c)
    x, y, w, h = R["tile_floor"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(84, 80, 76))
    for yy in range(y, y + h, 32):
        for xx in range(x, x + w, 32):
            c = tuple(int(np.clip(v + rng.integers(-10, 11), 0, 255)) for v in (122, 116, 110))
            d.rectangle([xx + 2, yy + 2, xx + 29, yy + 29], fill=c)
    # the stand signs at the fork, each a lit box with a bar's name down it (the names are the bars in the lane,
    # Overture places 2026-10; the colours are indicative)
    bars = [("もつ焼き", "勝利", (250, 246, 232), (170, 30, 30)), ("鶏籠", "", (24, 24, 26), (250, 220, 120)),
            ("Jackie", "", (40, 30, 70), (255, 170, 220)), ("Had A", "Good Day", (236, 236, 228), (30, 70, 60))]
    for i, (a_, b_, bg, fg) in enumerate(bars):
        x, y, w, h = R[f"bar{i}"]
        d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=bg)
        d.rectangle([x + 6, y + 6, x + w - 6, y + h - 6], outline=fg, width=5)
        latin = a_.isascii()
        if latin:
            d.text((x + w // 2, y + int(h * 0.36)), a_, font=fit("rocknroll", 46, a_, w - 24), fill=fg, anchor="mm")
            if b_:
                d.text((x + w // 2, y + int(h * 0.56)), b_, font=fit("rocknroll", 34, b_, w - 24), fill=fg, anchor="mm")
        else:
            txt = a_ + b_
            f = font("mincho", min(96, int((h - 60) / max(1, len(txt)))))
            for k, ch in enumerate(txt):
                d.text((x + w // 2, y + 40 + (h - 80) * (k + 0.5) / len(txt)), ch, font=f, fill=fg, anchor="mm")
    x, y, w, h = R["arrow"]                             # a hand-lettered board with an arrow into the lane
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(244, 240, 228))
    d.text((x + int(w * 0.33), y + h // 2), "この先 呑み処", font=fit("klee", 40, "この先 呑み処", int(w * 0.58)), fill=(40, 36, 32), anchor="mm")
    d.polygon([(x + w - 60, y + 18), (x + w - 14, y + h // 2), (x + w - 60, y + h - 18)], fill=(190, 40, 36))
    d.rectangle([x + w - 78, y + h // 2 - 7, x + w - 58, y + h // 2 + 7], fill=(190, 40, 36))
    # Hanamasa's sign wall: navy brush letters on yellow, two storeys high, a navy rule under them
    x, y, w, h = R["hm_wall"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(242, 194, 0))
    f = fit("syuku", int(h * 0.62), "肉のハナマサ", int(w * 0.9))
    d.text((x + w // 2, y + int(h * 0.46)), "肉のハナマサ", font=f, fill=(28, 38, 92), anchor="mm")
    d.rectangle([x + 20, y + h - 30, x + w - 20, y + h - 18], fill=(28, 38, 92))
    for k in range(240):                                # grime from the gutter
        rx, ry = x + int(rng.integers(0, w)), y + int(rng.integers(0, 24))
        d.line([(rx, ry), (rx, ry + int(rng.integers(4, 40)))], fill=(214, 172, 20), width=1)
    # its blade: yellow, the name down it in navy
    def blade(key, bg, fg, rule, text, faded):
        x, y, w, h = R[key]
        d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=bg)
        d.rectangle([x + 8, y + 8, x + w - 8, y + h - 8], outline=rule, width=6)
        f = font("mincho", int(w * 0.62))
        for k, ch in enumerate(text):
            d.text((x + w // 2, y + 30 + (h - 60) * (k + 0.5) / len(text)), ch, font=f, fill=fg, anchor="mm")
        for k in range(int(faded * 900)):               # sun and rain: the paint gone in flecks, rust from the frame
            rx, ry = x + int(rng.integers(0, w)), y + int(rng.integers(0, h))
            d.ellipse([rx, ry, rx + int(rng.integers(2, 7)), ry + int(rng.integers(2, 6))], fill=(204, 196, 178))
        for k in range(int(faded * 40)):
            rx = x + int(rng.integers(0, w))
            d.line([(rx, y), (rx + int(rng.integers(-2, 3)), y + int(rng.integers(20, 160)))], fill=(150, 108, 70), width=2)
    blade("hm_v", (242, 194, 0), (28, 38, 92), (28, 38, 92), "肉のハナマサ", 0.0)
    # the cinema's blade, still hanging since it closed in 2014: 三軒茶屋シネマ, its red letters faded on cream
    blade("cinema_v", (222, 214, 194), (176, 92, 80), (150, 120, 100), "三軒茶屋シネマ", 1.0)
    # the batting centre's yellow board over the shuttered stair
    x, y, w, h = R["batting"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(240, 200, 30))
    d.rectangle([x + 8, y + 8, x + w - 8, y + h - 8], outline=(190, 40, 30), width=6)
    f = fit("rocknroll", int(h * 0.5), "三軒茶屋バッティングセンター", w - 60)
    d.text((x + w // 2, y + h // 2), "三軒茶屋バッティングセンター", font=f, fill=(190, 40, 30), anchor="mm")
    for k in range(300):
        rx, ry = x + int(rng.integers(0, w)), y + int(rng.integers(0, h))
        d.ellipse([rx, ry, rx + 4, ry + 3], fill=(214, 180, 60))
    # the supermarket's glass front: lit shelves and price cards, the automatic doors
    x, y, w, h = R["shopfront"]
    d.rectangle([x - 2, y - 2, x + w + 2, y + h + 2], fill=(46, 48, 50))
    d.rectangle([x + 6, y + 6, x + w - 6, y + h - 6], fill=(214, 216, 208))
    for k in range(5):                                  # shelves seen through the glass
        yy = y + 40 + k * (h - 80) // 5
        d.rectangle([x + 10, yy, x + w - 10, yy + 6], fill=(150, 150, 146))
        for xx in range(x + 14, x + w - 20, 18):
            c = tuple(int(v) for v in rng.integers(60, 240, 3))
            d.rectangle([xx, yy - 26, xx + 12, yy - 2], fill=c)
    for xx in range(x, x + w, w // 4):                  # mullions
        d.rectangle([xx - 3, y, xx + 3, y + h], fill=(46, 48, 50))
    for k in range(6):                                  # red and yellow price cards on the glass
        px = x + 30 + k * (w - 60) // 6
        d.rectangle([px, y + h - 90, px + 44, y + h - 40], fill=(230, 40, 30) if k % 2 else (250, 210, 0))
def meshes(K, m):
    mid, n, z, L = np.asarray(m["at"], float), np.asarray(m["normal"], float), m["z"], m["len"]
    n = n / np.hypot(*n)
    t = np.array([-n[1], n[0]])                    # along the wall, left to right seen from the lane
    hl = L / 2 - 0.05
    P = lambda a, u, zz: np.array([*(mid + t * a + n * (u + 0.1)), z + zz])   # a along the wall, u out from it (a hand clear of the surveyed wall, which is not quite straight), zz above the paving

    def box(mat, a0, a1, u0, u1, z0, z1):
        c = [P(a, u, zz) for zz in (z0, z1) for u in (u0, u1) for a in (a0, a1)]   # index z*4 + u*2 + a
        for i, j, k, l in ((0, 1, 5, 4), (3, 2, 6, 7), (1, 3, 7, 5), (2, 0, 4, 6), (4, 5, 7, 6), (2, 3, 1, 0)):
            mat.quad(c[i], c[j], c[k], c[l])

    def face(mat, a0, a1, u, z0, z1, key, crop=(0.0, 0.0, 1.0, 1.0)):
        mat.quad(P(a0, u, z0), P(a1, u, z0), P(a1, u, z1), P(a0, u, z1), uv(key, crop))

    Y, Yl = K("yongen"), K("yongen", "lit")
    split = hl - 0.9                               # the house's two bays to the left of it, the takoyaki stand's fence to the right
    # --- the ground floor's skin: brick tile, the shutter, the pier, the white surround and the door
    zf = 2.95                                      # the upper floor's underside
    a_sh0, a_sh1 = split - 3.4, split - 1.8        # the shutter
    a_d0, a_d1 = split - 0.95, split - 0.15        # the door, set back in the white brick
    face(Y, -hl, a_sh0, 0.06, 0, zf, "brick", (0, 0, min(1.0, (a_sh0 + hl) / 2.0), zf / 3.0))
    face(Y, a_sh0, a_sh1, 0.03, 0, 2.3, "shutter")
    face(Y, a_sh0, a_sh1, 0.06, 2.3, zf, "brick", (0, 0.72, 0.8, 0.94))
    face(Y, a_sh1, a_sh1 + 0.3, 0.08, 0, zf, "brick", (0.8, 0, 0.95, zf / 3.0))            # the pier
    box(K("render_grey"), a_sh1, a_sh1 + 0.3, -0.1, 0.08, 0, zf)
    face(Y, a_sh1 + 0.3, a_d0, 0.06, 0, zf, "white", (0, 0, (a_d0 - a_sh1 - 0.3) / 1.6, zf / 3.0))
    face(Y, a_d0, a_d1, 0.0, 0, 2.05, "door")
    face(Y, a_d0, a_d1, 0.06, 2.05, zf, "white", (0.3, 0.7, 0.8, 1.0))
    face(Y, a_d1, split, 0.06, 0, zf, "white", (0.5, 0, 0.5 + (split - a_d1) / 1.6, zf / 3.0))
    Wp = K("awning_trim")                          # the door's reveals, in the surround's white paint
    Wp.quad(P(a_d0, 0.06, 0), P(a_d0, 0.0, 0), P(a_d0, 0.0, 2.05), P(a_d0, 0.06, 2.05))
    Wp.quad(P(a_d1, 0.0, 0), P(a_d1, 0.06, 0), P(a_d1, 0.06, 2.05), P(a_d1, 0.0, 2.05))
    Wp.quad(P(a_d0, 0.0, 2.05), P(a_d1, 0.0, 2.05), P(a_d1, 0.06, 2.05), P(a_d0, 0.06, 2.05))
    face(Y, a_d1 + 0.12, min(split - 0.05, a_d1 + 0.57), 0.085, 0.55, 2.05, "sudare")
    box(K("wood_dark"), a_d1 + 0.02, a_d1 + 0.1, 0.06, 0.1, 1.25, 1.75)                     # the small wooden plate by the door
    # --- the upper floor stepping out over the bar, rendered grey, and its windows' sills
    box(K("render_grey"), -hl, split + 0.2, -0.1, 0.62, zf, zf + 1.35)
    box(K("render_grey"), -hl, split + 0.2, -0.1, 0.16, zf + 1.35, min(m["top_m"], zf + 4.4))
    box(K("steel_dark"), a_sh1 - 0.9, a_sh1 + 1.3, 0.16, 0.2, zf + 1.75, zf + 3.0)          # the upper window
    box(K("ac_white"), a_sh1 - 0.95, a_sh1 + 1.35, 0.16, 0.26, zf + 1.66, zf + 1.75)
    # --- the dome awning over the shutter: eight ribbed gores, a scalloped edge with a white trim, the name on it
    def awning(ac, Rr, D, Hh, zb, A, trim):
        dome = lambda ph, th, k=1.0: P(ac - Rr * k * math.cos(ph) * math.cos(th), 0.05 + D * k * math.sin(ph) * math.cos(th), zb + Hh * k * math.sin(th))
        G, T = 8, 5
        for g in range(G):
            p0, p1 = math.pi * g / G, math.pi * (g + 1) / G
            for j in range(T):
                t0, t1 = math.pi / 2 * j / T, math.pi / 2 * (j + 1) / T
                A.quad(dome(p0, t0), dome(p1, t0), dome(p1, t1), dome(p0, t1))
            # the valance: two scallops a gore, each a shallow curve of three facets
            for s_ in range(2):
                q0, q1 = p0 + (p1 - p0) * s_ / 2, p0 + (p1 - p0) * (s_ + 1) / 2
                for e in range(5):
                    r0, r1 = q0 + (q1 - q0) * e / 5, q0 + (q1 - q0) * (e + 1) / 5
                    d0, d1 = 0.09 + 0.08 * math.sin(math.pi * e / 5) ** 0.6, 0.09 + 0.08 * math.sin(math.pi * (e + 1) / 5) ** 0.6
                    top0, top1 = dome(r0, 0), dome(r1, 0)
                    A.quad(top0 - [0, 0, d0], top1 - [0, 0, d1], top1, top0)
                    trim.quad(top0 - [0, 0, d0 + 0.018], top1 - [0, 0, d1 + 0.018], top1 - [0, 0, d1], top0 - [0, 0, d0])
        return dome

    def wrap(dome, p0, p1, t0, t1, key, N=8, M=3, Y=Y):
        """Lettering laid on an awning: in strips that follow its curve, a finger clear of the cloth."""
        for i in range(N):
            for j in range(M):
                a, b, c, e = p0 + (p1 - p0) * i / N, p0 + (p1 - p0) * (i + 1) / N, t0 + (t1 - t0) * j / M, t0 + (t1 - t0) * (j + 1) / M
                Y.quad(dome(a, c, 1.02), dome(b, c, 1.02), dome(b, e, 1.02), dome(a, e, 1.02), uv(key, (i / N, j / M, (i + 1) / N, (j + 1) / M)))

    A = K("awning_red")
    dome = awning((a_sh0 + a_sh1) / 2, (a_sh1 - a_sh0) / 2 + 0.22, 1.02, 0.86, 2.22, A, K("awning_trim"))
    # (the name: on the gores that face down the lane to the right, where the photograph has it)
    na, nb = math.pi * 0.52, math.pi * 0.86
    wrap(dome, na, nb, 0.12, 0.62, "name", Y=Yl)   # (lit from within after dark, as the awning is in photographs of the evening)
    # the awning's own light: a strip lamp under its rim, on to closing, that washes the shutter and the name
    box(K("door_lamp", "lit"), a_sh0 + 0.1, a_sh1 - 0.1, 0.55, 0.62, 2.16, 2.19)
    # --- the left bay, Good-day Good-day SINCE 1986: a wide shutter under a pale dome awning in a dark frame
    a_g1 = a_sh0 - 0.9
    a_g0 = max(-hl + 0.5, a_g1 - 2.3)
    face(Y, a_g0, a_g1, 0.075, 0, 2.3, "shutter")
    gd = awning((a_g0 + a_g1) / 2, (a_g1 - a_g0) / 2 + 0.15, 0.95, 0.9, 2.22, K("awning_pale"), K("steel_dark"))
    wrap(gd, math.pi * 0.3, math.pi * 0.7, 0.1, 0.7, "goodday")
    box(K("steel_dark"), a_g0 - 0.38, a_g0 - 0.1, 0.06, 0.1, 1.2, 1.75)                       # the notice case on the corner pier
    K("ac_white").tube([P(a_g0 - 0.05, 0.12, 2.9), P(a_g0 - 0.05, 0.12, 0.1)], 0.04, 8)     # its drain pipe
    # --- the duct hood on the wall, rust brown, turning down over the awning's left
    a_du = a_sh0 - 0.75
    box(K("duct_rust"), a_du, a_du + 0.55, 0.06, 0.5, 2.0, zf + 0.1)
    box(K("duct_rust"), a_du - 0.04, a_du + 0.59, 0.06, 0.56, 1.86, 2.0)
    # --- at the left: the downpipe, the outdoor unit on its blocks, two notices on the brick
    K("ac_white").tube([P(a_sh0 - 0.08, 0.14, 2.3), P(a_sh0 - 0.08, 0.14, 1.05), P(a_sh0 - 0.2, 0.3, 0.85)], 0.045, 8)
    if True:
        a_ac0, a_ac1 = a_sh0 - 0.88, a_sh0 - 0.14
        box(K("stone"), a_ac0 + 0.05, a_ac1 - 0.05, 0.5, 0.86, 0.0, 0.12)
        box(K("ac_white"), a_ac0, a_ac1, 0.48, 0.88, 0.12, 0.82)
        face(Y, a_ac0 + 0.04, a_ac1 - 0.04, 0.885, 0.16, 0.78, "grille")
        for k, zz in enumerate((0.95, 1.4)):
            face(Y, a_ac0 + 0.15, a_ac0 + 0.45, 0.075, zz, zz + 0.42, "notice")
    # --- a lamp over the door: the warm light the front is remembered by
    box(K("steel_dark"), a_d0 + 0.3, a_d0 + 0.5, 0.06, 0.2, 2.34, 2.38)
    box(K("door_lamp", "lit"), a_d0 + 0.32, a_d0 + 0.48, 0.09, 0.19, 2.2, 2.34)
    # --- the takoyaki stand: its plank front, the red awning, the round sign, the lantern, the table and stools
    a_t1 = split + 3.3                             # (its fence runs on past this house's corner, along its own lot)
    face(Y, split + 0.02, a_t1, 0.1, 0, 2.25, "tako", (0, 0, (a_t1 - split) / 3.3, 1))
    box(K("wood_dark"), split, split + 0.06, 0.0, 0.14, 0, 2.3)
    box(K("steel_dark"), split, a_t1, 0.0, 0.3, 2.3, 2.38)                                   # its eave
    for k in range(2):                                                                       # the awning, let down at a slope
        a0, a1 = split + 0.05 + k * (a_t1 - split - 0.05) / 2, split + 0.05 + (k + 1) * (a_t1 - split - 0.05) / 2
        A.quad(P(a0, 0.8, 2.3), P(a1, 0.8, 2.3), P(a1, 0.05, 2.52), P(a0, 0.05, 2.52))
        A.quad(P(a1, 0.8, 2.3), P(a0, 0.8, 2.3), P(a0, 0.05, 2.52), P(a1, 0.05, 2.52))   # (its underside, seen from the table)
        A.quad(P(a0, 0.8, 2.19), P(a1, 0.8, 2.19), P(a1, 0.8, 2.3), P(a0, 0.8, 2.3))
    ar = split + 0.45                                                                        # the round sign, read from both ways along the lane
    box(K("steel_dark"), ar - 0.015, ar + 0.015, 0.1, 0.75, 2.12, 2.15)
    Yl.quad(P(ar + 0.02, 0.7, 1.6), P(ar + 0.02, 0.2, 1.6), P(ar + 0.02, 0.2, 2.1), P(ar + 0.02, 0.7, 2.1), uv("round"))
    Yl.quad(P(ar - 0.02, 0.2, 1.6), P(ar - 0.02, 0.7, 1.6), P(ar - 0.02, 0.7, 2.1), P(ar - 0.02, 0.2, 2.1), uv("round"))
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
    for a0 in np.arange(-hl, split, 5.6):
        a1 = min(split, a0 + 5.6)
        Y.quad(P(a0, 1.75, 0.035), P(a1, 1.75, 0.035), P(a1, 0.0, 0.035), P(a0, 0.0, 0.035), uv("paving", (0, 0, (a1 - a0) / 5.6, 1)))
    box(K("stone"), -hl, split, 1.75, 1.87, -0.05, 0.05)                                     # the kerb to the lane
    return {"door": [float(v) for v in P((a_d0 + a_d1) / 2, 0, 0)[:2]]}


def chiyo(K, c):
    """Chiyo-no-yu's street face as it stands (photographs of 2019 to 2025): not a building front but a fence of
    corrugated sheet on a timber frame, across the lane from New Marina. The alley through it to the bath and the
    coin laundry is boarded up with brown ribbed sheet (since 2024; the bath has been closed since 2021), under the
    hand-painted board that still names it. Rusty sheet with timber battens to the left, galvanised to the right,
    and the bath's chimney behind (its height is an estimate: no figure is published)."""
    mid, n, z = np.asarray(c["at"], float), np.asarray(c["normal"], float), c["z"]
    n = n / np.hypot(*n)
    t = np.array([-n[1], n[0]])
    P = lambda a, u, zz: np.array([*(mid + t * a + n * (u + 0.35)), z + zz])
    Y, W = K("yongen"), K("wood_weathered")

    def box(mat, a0, a1, u0, u1, z0, z1):
        cc = [P(a, u, zz) for zz in (z0, z1) for u in (u0, u1) for a in (a0, a1)]
        for i, j, k, l in ((0, 1, 5, 4), (3, 2, 6, 7), (1, 3, 7, 5), (2, 0, 4, 6), (4, 5, 7, 6), (2, 3, 1, 0)):
            mat.quad(cc[i], cc[j], cc[k], cc[l])

    def sheet(key, a0, a1, z1, w_m, u=0.0):
        """Corrugated sheet from a0 to a1, z1 high, its image repeated every w_m metres along."""
        a = a0
        while a < a1 - 1e-3:
            b = min(a1, a + w_m)
            Y.quad(P(a, u, 0), P(b, u, 0), P(b, u, z1), P(a, u, z1), uv(key, (0, 0, (b - a) / w_m, 1)))
            a = b

    s0, s1 = -1.95, -0.35                          # the boarded alley, 1.6 m wide
    L = c["len"] / 2
    a_l, a_r = max(-L + 0.3, s0 - 5.0), min(L - 0.3, s1 + 4.5)
    sheet("corr_rust", a_l, s0 - 0.12, 2.4, 2.0)
    sheet("corr_brown", s0, s1, 2.2, 1.6, u=-0.04)
    sheet("corr_galv", s1 + 0.12, a_r, 2.6, 2.0)
    for a in (s0 - 0.12, s1):                      # the alley's posts, its lintel and the rail along the top
        box(W, a, a + 0.12, -0.08, 0.06, 0, 2.95)
    box(W, s0 - 0.25, s1 + 0.25, -0.08, 0.06, 2.2, 2.32)
    box(W, a_l, s0 - 0.12, 0.0, 0.06, 2.36, 2.46)
    for zz in (0.62, 1.55):                        # battens across the rusty sheet
        box(W, a_l + 0.1, s0 - 0.2, 0.0, 0.05, zz, zz + 0.1)
    bw = 1.55                                      # the board, on two struts over the lintel
    bc = (s0 + s1) / 2
    Y.quad(P(bc - bw / 2, 0.1, 2.3), P(bc + bw / 2, 0.1, 2.3), P(bc + bw / 2, 0.1, 2.98), P(bc - bw / 2, 0.1, 2.98), uv("chiyo_board"))
    box(W, bc - bw / 2 - 0.03, bc + bw / 2 + 0.03, -0.02, 0.07, 2.27, 3.01)   # (3 cm behind the picture: no depth fight)
    # the chimney behind: a tapering concrete stack, stained, its top banded
    cx, cy, _ = P(-0.6, -9.0, 0)
    K("concrete_stain").lathe([(z, 0.75), (z + 17.0, 0.48), (z + 17.2, 0.56), (z + 17.6, 0.56), (z + 17.6, 0.0)], (float(cx), float(cy)), 4)
    return {"alley": [float(v) for v in P(bc, 0.6, 0)[:2]]}


# Pukuichi (鉄板・広島府中焼き ぷくいち, 三軒茶屋2-11-14, 土屋ビル1F): where the street the pilgrims start on runs
# north from Route 246. The model's building there (three storeys, 11.1 m) has a 13.6 m face onto the lane,
# east, with the Darts Cafe's corner across it, as in the photographs (rinblog 2025, zukkazu 2019); its lot's
# address (GSI) is 15 m away. No source gives the frontage: four shutters, about 2 m each, read off the photos.
PUKUICHI = {"at": [-2467.2, -2888.4], "normal": [0.946, -0.323], "len": 13.6, "z": 33.8, "top_m": 11.1}


def pukuichi(K, w=PUKUICHI):
    """The front as it stands: four roller shutters across two bays under one long ochre canvas awning with the
    shop's name, the vertical sign on the south corner, an outside stair at the north end."""
    mid, n, z = np.asarray(w["at"], float), np.asarray(w["normal"], float), w["z"]
    n = n / np.hypot(*n)
    t = np.array([-n[1], n[0]])                    # north along the lane
    P = lambda a, u, zz: np.array([*(mid + t * a + n * (u + 0.08)), z + zz])
    Y, Yl, S = K("yongen"), K("yongen", "lit"), K("stucco_beige")

    def box(mat, a0, a1, u0, u1, z0, z1):
        cc = [P(a, u, zz) for zz in (z0, z1) for u in (u0, u1) for a in (a0, a1)]
        for i, j, k, l in ((0, 1, 5, 4), (3, 2, 6, 7), (1, 3, 7, 5), (2, 0, 4, 6), (4, 5, 7, 6), (2, 3, 1, 0)):
            mat.quad(cc[i], cc[j], cc[k], cc[l])

    hl = w["len"] / 2
    a0 = -hl + 0.35                                # the south corner, where the vertical sign stands
    bays = [(a0 + 0.3, a0 + 2.3), (a0 + 2.45, a0 + 4.45), (a0 + 4.9, a0 + 6.9), (a0 + 7.05, a0 + 9.05)]
    a1 = a0 + 9.35
    edges = [a0] + [v for b in bays for v in b] + [a1]
    for k in range(0, len(edges), 2):              # the piers between the shutters, and the band over them
        box(S, edges[k], edges[k + 1], -0.05, 0.16, 0, 2.7)
    box(S, a0, a1, -0.05, 0.16, 2.55, 2.75)
    for b0, b1 in bays:                            # the shutters, set back 4 cm in their openings
        Y.quad(P(b0, 0.12, 0), P(b1, 0.12, 0), P(b1, 0.12, 2.55), P(b0, 0.12, 2.55), uv("shutter"))
    # the awning: a sloped canvas top and a vertical valance with the name, the length of the two bays
    zt, zb, out = 3.95, 2.75, 0.95                 # (the valance a metre tall, as in the photographs)
    A = K("awning_ochre")
    zv = zt - 0.15
    A.quad(P(a0, 0.16, zt), P(a1, 0.16, zt), P(a1, out, zv), P(a0, out, zv))
    A.quad(P(a1, 0.16, zt), P(a0, 0.16, zt), P(a0, out, zv), P(a1, out, zv))
    A.quad(P(a1, out, zb), P(a0, out, zb), P(a0, 0.16, zb), P(a1, 0.16, zb))    # its underside
    Y.quad(P(a0, out, zb), P(a1, out, zb), P(a1, out, zv), P(a0, out, zv), uv("puku_awn"))
    A.quad(P(a0, 0.16, zt), P(a0, out, zv), P(a0, out, zb), P(a0, 0.16, zb))     # its ends
    A.quad(P(a1, out, zv), P(a1, 0.16, zt), P(a1, 0.16, zb), P(a1, out, zb))
    # the vertical sign, standing out from the corner, read from both ways along the lane (each face on the side it faces)
    av, zv0, zv1 = a0 + 0.05, 3.9, 7.0
    box(K("steel_dark"), av - 0.06, av + 0.06, 0.1, 0.95, zv0 - 0.05, zv1 + 0.05)
    Yl.quad(P(av + 0.065, 0.95, zv0), P(av + 0.065, 0.2, zv0), P(av + 0.065, 0.2, zv1), P(av + 0.065, 0.95, zv1), uv("puku_v"))
    Yl.quad(P(av - 0.065, 0.2, zv0), P(av - 0.065, 0.95, zv0), P(av - 0.065, 0.95, zv1), P(av - 0.065, 0.2, zv1), uv("puku_v"))
    # the outside stair at the north end, a steel flight with a white rail up to the first floor
    s0, s1 = a1 + 0.3, min(hl - 0.1, a1 + 3.6)
    St = K("steel_dark")
    for k in range(14):
        a = s0 + (s1 - s0) * k / 14
        box(St, a, a + (s1 - s0) / 14 + 0.02, 0.1, 1.05, 0.22 * k + 0.18, 0.22 * k + 0.22)
    K("ac_white").tube([P(s0, 1.08, 0.95), P(s1, 1.08, 3.1 + 0.95)], 0.025, 6)
    return {"front": [float(v) for v in P((a0 + a1) / 2, 2.0, 0)[:2]]}


def pukuichi_spot():
    """Where to stand to look at the front, and the label over it."""
    w = PUKUICHI
    mid, n = np.asarray(w["at"], float), np.asarray(w["normal"], float)
    t = np.array([-n[1], n[0]])
    a = -w["len"] / 2 + 0.35 + 4.7
    at = mid + t * a + n * 2.2
    return [round(float(at[0]), 2), round(float(at[1]), 2), w["z"]]


def glows(m):
    """The door lamp's pool on the pavers and the lantern's red, from dusk to closing."""
    mid, n = np.asarray(m["at"], float), np.asarray(m["normal"], float)
    t = np.array([-n[1], n[0]])
    split = m["len"] / 2 - 0.95
    door, lant = mid + t * (split - 0.5) + n * 1.3, mid + t * (split + 2.75) + n * 0.8
    awn = mid + t * (split - 2.6) + n * 1.4                       # under the red awning, its strip lamp on the pavers
    return [[round(float(door[0]), 1), round(float(door[1]), 1), 7.0, "#ffc27a", 0.75], [round(float(lant[0]), 1), round(float(lant[1]), 1), 4.0, "#ff6a4a", 0.3],
            [round(float(awn[0]), 1), round(float(awn[1]), 1), 4.0, "#ff9a7a", 0.35]]


# ---------------------------------------------------------------- the stops past New Marina (#359)
#
# Placed on the model's buildings from Overture's places (release 2026-10-21) and pilgrims' descriptions: the lane
# from Pukuichi runs north past Chiyo-no-yu and the Thai restaurant Siam Talart (2-14-19) and bends north-east at a
# small two-storey house; there a narrower lane forks off east, where the bars are (2-14-14 to 2-14-18, 2-13-5), and
# runs on between two houses under a covered stretch towards Setagaya-dori and the station. Hanamasa (2-14-6) is the
# old Sangenjaya Cinema's building (closed 2014), its blade still hanging beside the supermarket's, and the batting
# centre's stair goes up from the slot to its north to the cages on the roof.

# the stair corner: the lane face of the two-storey house at the bend (the model's 2889, 6.3 m), and the small block
# at the corner in front of it (2897), from its outline in the building data
STAIR_CORNER = {"wall": [[-2435.6, -2828.7], [-2439.6, -2837.4]], "z": 33.04, "top_m": 6.3,
                "block": [[-2438.0, -2839.9], [-2441.0, -2838.6], [-2441.8, -2840.3], [-2439.0, -2841.7]], "block_top": 6.4}
# the fork: the mouth of the bars' lane, between the corner block and the low house to the south (2896)
FORK = {"at": [-2443.2, -2841.9], "z": 33.3, "into": [0.97, -0.25]}
# the covered passage: the lane between two houses (2891 west, 2884 east) from its south end to its north
PASSAGE = {"s": [-2429.8, -2828.9], "n": [-2426.5, -2820.9], "z": 32.85, "west": [[-0.62, 0.72], [-1.43, 9.25]], "east": 0.86, "top_m": 7.0}
# Hanamasa's roof: its outline and the solid's base (the model's 2921, 19.9 m from the building data)
HANAMASA_ROOF = {"ring": [[-2475.8, -2847.3], [-2472.3, -2847.4], [-2468.9, -2832.7], [-2489.6, -2831.6], [-2490.0, -2847.0]], "z": 33.3 + 19.9}


def _frame(mid, n, z):
    """P(a, u, zz) on a wall: a along it (left to right seen from outside), u out from it, zz up; and a box maker."""
    mid, n = np.asarray(mid, float), np.asarray(n, float)
    n = n / np.hypot(*n)
    t = np.array([-n[1], n[0]])
    P = lambda a, u, zz: np.array([*(mid + t * a + n * u), z + zz])

    def box(mat, a0, a1, u0, u1, z0, z1):
        cc = [P(a, u, zz) for zz in (z0, z1) for u in (u0, u1) for a in (a0, a1)]
        for i, j, k, l in ((0, 1, 5, 4), (3, 2, 6, 7), (1, 3, 7, 5), (2, 0, 4, 6), (4, 5, 7, 6), (2, 3, 1, 0)):
            mat.quad(cc[i], cc[j], cc[k], cc[l])
    return P, box


def _tiled(mat, P, a0, a1, u, z0, z1, key, w_m, h_m):
    """A face from a0 to a1 and z0 to z1, the cell `key` repeated every w_m by h_m metres."""
    a = a0
    while a < a1 - 1e-3:
        b = min(a1, a + w_m)
        zz = z0
        while zz < z1 - 1e-3:
            ze = min(z1, zz + h_m)
            mat.quad(P(a, u, zz), P(b, u, zz), P(b, u, ze), P(a, u, ze), uv(key, (0, 0, (b - a) / w_m, (ze - zz) / h_m)))
            zz = ze
        a = b


def _outward(p, q, ring):
    """The outward normal of the edge p->q of a ring."""
    p, q = np.asarray(p, float), np.asarray(q, float)
    d = (q - p) / np.hypot(*(q - p))
    n = np.array([d[1], -d[0]])
    c = np.mean(np.asarray(ring, float), axis=0)
    return n if np.dot((p + q) / 2 - c, n) > 0 else -n


def stair_corner(K, w=STAIR_CORNER):
    """The house at the bend, as pilgrims photograph it (2016 to 2025): pale blue-grey lap siding, aluminium sashes
    behind bars, and a steel stair with a white rail climbing its lane face to a door on the first floor; the small
    block at the corner painted the same, an arrow board to the bars' lane on it."""
    (p, q), z = w["wall"], w["z"]
    p, q = np.asarray(p, float), np.asarray(q, float)
    d = (q - p) / np.hypot(*(q - p))
    n = np.array([-d[1], d[0]]) if np.dot(np.array([-d[1], d[0]]), np.array([-1.0, 0.4])) > 0 else np.array([d[1], -d[0]])   # out to the lane, west
    L = float(np.hypot(*(q - p)))
    P, box = _frame((p + q) / 2, n, z)
    Y, Yl, S = K("yongen"), K("yongen", "lit"), K("stair_steel")
    hl = L / 2
    _tiled(Y, P, -hl, hl, 0.05, 0, w["top_m"] - 0.25, "siding", 2.0, 2.0)
    box(K("awning_trim"), -hl, hl, 0.0, 0.1, w["top_m"] - 0.3, w["top_m"] - 0.15)          # the fascia board under the eaves
    # the ground floor at the corner end: a door and a barred sash; the first floor: two sashes and the landing's door
    a_c = hl                                                        # (left to right seen from the lane: the corner is at +hl)
    Y.quad(P(a_c - 2.6, 0.07, 0), P(a_c - 1.8, 0.07, 0), P(a_c - 1.8, 0.07, 2.0), P(a_c - 1.8 - 0.8, 0.07, 2.0), uv("door_al"))
    Y.quad(P(a_c - 1.5, 0.07, 0.9), P(a_c - 0.3, 0.07, 0.9), P(a_c - 0.3, 0.07, 1.9), P(a_c - 1.5, 0.07, 1.9), uv("sash"))
    for a0 in (-0.6, 1.6):
        Y.quad(P(a0, 0.07, 3.6), P(a0 + 1.2, 0.07, 3.6), P(a0 + 1.2, 0.07, 4.6), P(a0, 0.07, 4.6), uv("sash"))
        box(K("ac_white"), a0 - 0.05, a0 + 1.25, 0.05, 0.14, 3.52, 3.58)                     # its sill
    a_l0, a_l1 = -hl + 0.2, -hl + 1.45                              # the landing at the far end, the door on it
    Y.quad(P(a_l0 + 0.25, 0.07, 2.8), P(a_l0 + 1.05, 0.07, 2.8), P(a_l0 + 1.05, 0.07, 4.8), P(a_l0 + 0.25, 0.07, 4.8), uv("door_al"))
    box(K("ac_white"), a_l0, a_l1, 0.05, 0.7, 5.0, 5.06)                                     # a little canopy over it
    # the stair: fourteen risers of 20 cm up from the middle of the face to the landing, open treads on two stringers
    W0, W1, rise, run, N = 0.12, 0.92, 0.2, 0.25, 14
    a_f = a_l1 + run * N                                            # its foot
    for k in range(N):
        a1 = a_f - run * k
        box(S, a1 - run - 0.02, a1, W0, W1, rise * (k + 1) - 0.04, rise * (k + 1))
    for u in (W0, W1):                                              # the stringers, sloping plates
        S.quad(P(a_f, u, 0), P(a_l1, u, rise * N - 0.05), P(a_l1, u, rise * N + 0.18), P(a_f, u, 0.23))
        S.quad(P(a_l1, u, rise * N - 0.05), P(a_f, u, 0), P(a_f, u, 0.23), P(a_l1, u, rise * N + 0.18))
    box(S, a_l0, a_l1, W0, W1, rise * N - 0.06, rise * N)                                     # the landing
    for a in (a_l0 + 0.05, a_l1 - 0.05):                                                    # its posts
        K("stair_steel").tube([P(a, W1, 0), P(a, W1, rise * N)], 0.04, 6)
    R = K("stair_rail")
    R.tube([P(a_f, W1, 0.9), P(a_l1, W1, rise * N + 0.9), P(a_l0, W1, rise * N + 0.9), P(a_l0, 0.08, rise * N + 0.9)], 0.024, 6)
    for k in range(0, N + 1, 3):                                    # its balusters
        a = a_f - run * k
        R.tube([P(a, W1, rise * k), P(a, W1, rise * k + 0.9)], 0.012, 4)
    # under the stair: the gas meter on the wall, and a row of pots
    box(K("ac_white"), a_f - 1.6, a_f - 1.25, 0.05, 0.25, 1.1, 1.55)
    for k, a in enumerate((a_f - 0.4, a_f - 0.9, a_f - 2.3)):
        x_, y_, _ = P(a, 0.35, 0)
        K("stone").lathe([(z, 0.12), (z + 0.26, 0.16), (z + 0.28, 0.0)], (float(x_), float(y_)), 10)
        K("pot_green").lathe([(z + 0.26, 0.15), (z + 0.45, 0.2), (z + 0.6, 0.0)], (float(x_), float(y_)), 8)
    # the corner block: its two faces onto the lanes painted the same, the arrow board on the one the lane meets
    ring = w["block"]
    for i in range(len(ring)):
        a_, b_ = np.asarray(ring[i], float), np.asarray(ring[(i + 1) % len(ring)], float)
        nn = _outward(a_, b_, ring)
        if np.dot(nn, np.array([-0.6, -0.8])) < 0.2 and np.dot(nn, np.array([-1.0, 0.3])) < 0.5:
            continue                                                # (only the faces seen from the lanes: west and south)
        Lb = float(np.hypot(*(b_ - a_)))
        Pb, boxb = _frame((a_ + b_) / 2, nn, z + 0.2)
        _tiled(Y, Pb, -Lb / 2, Lb / 2, 0.05, -0.2, w["block_top"] - 0.25, "siding", 2.0, 2.0)
        if np.dot(nn, np.array([-1.0, 0.3])) > 0.5:
            Yl.quad(Pb(-0.45, 0.08, 1.5), Pb(0.45, 0.08, 1.5), Pb(0.45, 0.08, 1.8), Pb(-0.45, 0.08, 1.8), uv("arrow"))
    return {"stair": [float(v) for v in P(0.6, 2.6, 0)[:2]]}


def stair_corner_spot():
    """Where to stand for the game's framing: in the lane south of the bend, looking up it at the stair."""
    (p, q), z = STAIR_CORNER["wall"], STAIR_CORNER["z"]
    p, q = np.asarray(p, float), np.asarray(q, float)
    at = q + (q - p) / np.hypot(*(q - p)) * 3.0 + np.array([-3.2, 0.6])
    return [round(float(at[0]), 2), round(float(at[1]), 2), z]


def fork(K, w=FORK):
    """The mouth of the bars' lane: four lit stand signs, one for each bar in it (their names; the colours indicative)."""
    at, f, z = np.asarray(w["at"], float), np.asarray(w["into"], float), w["z"]
    f = f / np.hypot(*f)
    side = np.array([f[1], -f[0]])                                  # to the south side of the lane
    Yl = K("yongen_lane", "lit")
    spots = [(0.2, 1.3, 0.0), (1.8, 1.45, 0.2), (0.6, -1.2, -0.1), (3.6, 1.4, 0.35)]
    for i, (along, across, turn) in enumerate(spots):
        c = at + f * along + side * across
        fa = -f * math.cos(turn) + side * math.sin(turn)            # each faces back out to the main lane
        fa = fa / np.hypot(*fa)
        Pf, boxf = _frame(c, fa, z)
        boxf(K("stair_steel"), -0.22, 0.22, -0.17, 0.17, 0.0, 0.06)                          # the weighted foot
        boxf(K("stair_steel"), -0.21, 0.21, -0.16, 0.16, 0.06, 0.08)
        boxf(K("yongen_lane"), -0.2, 0.2, -0.15, 0.15, 0.08, 1.03)
        Yl.quad(Pf(-0.2, 0.152, 0.08), Pf(0.2, 0.152, 0.08), Pf(0.2, 0.152, 1.03), Pf(-0.2, 0.152, 1.03), uv(f"bar{i}"))
        Yl.quad(Pf(0.2, -0.152, 0.08), Pf(-0.2, -0.152, 0.08), Pf(-0.2, -0.152, 1.03), Pf(0.2, -0.152, 1.03), uv(f"bar{i}"))
    return {"fork": [float(v) for v in at[:2]]}


def passage(K, w=PASSAGE):
    """The covered stretch of the bars' lane, under the first floor that joins the two houses: cream tile to shoulder
    height, grey quarry tile underfoot, two fluorescent tubes. About 1.5 to 2.3 m wide (the two houses' walls)."""
    S0, N0, z = np.asarray(w["s"], float), np.asarray(w["n"], float), w["z"]
    f = (N0 - S0) / np.hypot(*(N0 - S0))
    e = np.array([f[1], -f[0]])                                     # across, to the east
    P = lambda s, ee, zz: np.array([*(S0 + f * s + e * ee), z + zz])
    (w0, s0), (w1, s1) = w["west"]
    ew = lambda s: w0 + (w1 - w0) * (s - s0) / (s1 - s0) + 0.04
    ee = w["east"] - 0.04
    Y, D = K("yongen_lane"), K("deck_grey")
    sa, sb, hc = 0.9, 8.3, 2.45
    for k in range(int(math.ceil(sb - sa))):                        # in metre bays
        a, b = sa + k, min(sb, sa + k + 1)
        Y.quad(P(a, ew(a), 0), P(b, ew(b), 0), P(b, ew(b), 1.5), P(a, ew(a), 1.5), uv("tile_wall", (0, 0, b - a, 1)))   # the west wall, facing east
        Y.quad(P(b, ee, 0), P(a, ee, 0), P(a, ee, 1.5), P(b, ee, 1.5), uv("tile_wall", (0, 0, b - a, 1)))               # the east wall, facing west
        D.quad(P(a, ew(a), 1.5), P(b, ew(b), 1.5), P(b, ew(b), hc), P(a, ew(a), hc))
        D.quad(P(b, ee, 1.5), P(a, ee, 1.5), P(a, ee, hc), P(b, ee, hc))
        Y.quad(P(a, ee, 0.03), P(b, ee, 0.03), P(b, ew(b), 0.03), P(a, ew(a), 0.03), uv("tile_floor", (0, 0, 1, b - a)))   # the floor
        D.quad(P(a, ew(a), hc), P(b, ew(b), hc), P(b, ee, hc), P(a, ee, hc))                                             # the ceiling, seen from under
    # the first floor over it, closing the gap between the two roofs, and its faces over the two mouths
    top = w["top_m"]
    for s_, sgn in ((sa, -1), (sb, 1)):
        D.quad(P(s_, ew(s_) if sgn < 0 else ee, hc), P(s_, ee if sgn < 0 else ew(s_), hc), P(s_, ee if sgn < 0 else ew(s_), top), P(s_, ew(s_) if sgn < 0 else ee, top))
    D.quad(P(sa, ew(sa), top), P(sa, ee, top), P(sb, ee, top), P(sb, ew(sb), top))
    for s_ in (2.6, 6.2):                                           # the tubes
        c0, c1 = (ew(s_) + ee) / 2 - 0.06, (ew(s_) + ee) / 2 + 0.06
        T = K("tube_lamp", "lit")
        T.quad(P(s_ - 0.6, c0, hc - 0.05), P(s_ + 0.6, c0, hc - 0.05), P(s_ + 0.6, c1, hc - 0.05), P(s_ - 0.6, c1, hc - 0.05))
        T.quad(P(s_ - 0.6, c1, hc - 0.05), P(s_ + 0.6, c1, hc - 0.05), P(s_ + 0.6, c0, hc - 0.05), P(s_ - 0.6, c0, hc - 0.05))
    return {"passage": [float(v) for v in P((sa + sb) / 2, (ew((sa + sb) / 2) + ee) / 2, 0)[:2]]}


def passage_points():
    w = PASSAGE
    S0, N0 = np.asarray(w["s"], float), np.asarray(w["n"], float)
    return S0, N0


def hanamasa(K, h, roof=HANAMASA_ROOF):
    """Hanamasa's block as it stands: the supermarket's glass front under its yellow sign wall, two storeys high with
    the name in navy brush letters; its yellow blade and, at the corner beside it, the cinema's faded blade, still up
    since Sangenjaya Cinema closed in 2014. In the slot to the north, the batting centre's stair behind a lowered
    shutter under its yellow board, its flights climbing the slot to the cages on the roof, whose net frame stands
    over the parapet. The centre was shut by 2024."""
    P, box = _frame(h["at"], h["normal"], h["z"])
    Y, Yl = K("yongen"), K("yongen", "lit")
    hl = h["len"] / 2
    _tiled(Yl, P, -hl + 0.4, hl - 0.4, 0.08, 0.0, 2.6, "shopfront", 3.2, 2.6)
    box(K("steel_dark"), -hl + 0.2, hl - 0.2, 0.0, 0.14, 2.6, 3.0)                            # the head over the glass
    box(K("hm_yellow", "lit"), -hl + 0.1, hl - 0.1, 0.0, 0.3, 3.0, 9.4)                       # the sign wall
    Yl.quad(P(-6.0, 0.31, 4.55), P(6.0, 0.31, 4.55), P(6.0, 0.31, 7.75), P(-6.0, 0.31, 7.75), uv("hm_wall"))
    # the two blades at the north corner: the supermarket's, then the cinema's at the very edge
    for a_, key, lit in ((-hl + 1.5, "hm_v", True), (-hl + 0.35, "cinema_v", False)):
        M = Yl if lit else Y
        box(K("steel_dark"), a_ - 0.07, a_ + 0.07, 0.3, 1.05, 9.7, 13.5)
        M.quad(P(a_ + 0.075, 1.05, 9.8), P(a_ + 0.075, 0.35, 9.8), P(a_ + 0.075, 0.35, 13.4), P(a_ + 0.075, 1.05, 13.4), uv(key))
        M.quad(P(a_ - 0.075, 0.35, 9.8), P(a_ - 0.075, 1.05, 9.8), P(a_ - 0.075, 1.05, 13.4), P(a_ - 0.075, 0.35, 13.4), uv(key))
    # the slot to the north (to the left seen from the street): the batting centre's shutter, its board, its stair
    g0, g1 = -hl - 3.15, -hl - 0.1
    _tiled(Y, P, g0 + 0.05, g1, -0.1, 0.0, 2.5, "shutter", 1.6, 2.3)
    box(K("steel_dark"), g0, g1, -0.15, 0.05, 2.5, 2.7)
    Y.quad(P(g0 + 0.2, 0.06, 2.75), P(g1 - 0.2, 0.06, 2.75), P(g1 - 0.2, 0.06, 3.45), P(g0 + 0.2, 0.06, 3.45), uv("batting"))
    S = K("net_frame")
    lanes = [(g0 + 0.2, (g0 + g1) / 2 - 0.05), ((g0 + g1) / 2 + 0.05, g1 - 0.2)]
    zt = roof["z"] - h["z"]                                         # the roof over the street, here
    flights = int(math.ceil(zt / 2.6))
    rise = zt / flights
    for k in range(flights):                                        # scissor flights, alternately in and out of the slot
        a0, a1 = lanes[k % 2]
        u_lo, u_hi = (-1.2, -6.4) if k % 2 == 0 else (-6.4, -1.2)
        z0 = rise * k
        for j in range(12):
            u = u_lo + (u_hi - u_lo) * j / 12
            box(S, a0, a1, min(u, u + (u_hi - u_lo) / 12), max(u, u + (u_hi - u_lo) / 12), z0 + rise * (j + 1) / 12 - 0.04, z0 + rise * (j + 1) / 12)
        S.tube([P(a1 if k % 2 == 0 else a0, u_lo, z0 + 0.9), P(a1 if k % 2 == 0 else a0, u_hi, z0 + rise + 0.9)], 0.025, 5)
        box(S, g0 + 0.2, g1 - 0.2, min(u_hi, u_hi + 0.9 * np.sign(u_hi - u_lo)), max(u_hi, u_hi + 0.9 * np.sign(u_hi - u_lo)), z0 + rise - 0.06, z0 + rise)
    # the cages' net frame on the roof: posts round the parapet, rails, and the netting on its sides and over the top
    ring = [np.asarray(v, float) for v in roof["ring"]]
    zr, H = roof["z"], 7.0
    N_ = K("cage_net")
    tops = []
    for i in range(len(ring)):
        a_, b_ = ring[i], ring[(i + 1) % len(ring)]
        Ls = float(np.hypot(*(b_ - a_)))
        m = max(1, int(round(Ls / 4.5)))
        for j in range(m):
            p0, p1 = a_ + (b_ - a_) * j / m, a_ + (b_ - a_) * (j + 1) / m
            S.tube([np.array([*p0, zr]), np.array([*p0, zr + H])], 0.09, 6)
            S.tube([np.array([*p0, zr + H]), np.array([*p1, zr + H])], 0.05, 5)
            S.tube([np.array([*p0, zr + H * 0.5]), np.array([*p1, zr + H * 0.5])], 0.035, 5)
            N_.quad(np.array([*p0, zr + 0.4]), np.array([*p1, zr + 0.4]), np.array([*p1, zr + H]), np.array([*p0, zr + H]))
            N_.quad(np.array([*p1, zr + 0.4]), np.array([*p0, zr + 0.4]), np.array([*p0, zr + H]), np.array([*p1, zr + H]))
        tops.append(np.array([*a_, zr + H]))
    c = np.mean(ring, axis=0)
    for i in range(len(ring)):                                      # the top net, a fan from the middle, seen from both sides
        a_, b_ = tops[i], tops[(i + 1) % len(tops)]
        cc = np.array([*c, zr + H])
        N_.quad(a_, b_, cc, cc)
        N_.quad(b_, a_, cc, cc)
    return {"slot": [float(v) for v in P((g0 + g1) / 2, 2.0, 0)[:2]]}


def hanamasa_spot(h):
    """Across the street from the block, where the sign wall, both blades and the slot are in one frame."""
    P, _ = _frame(h["at"], h["normal"], h["z"])
    at = P(-h["len"] / 2 + 0.5, 4.5, 0)
    return [round(float(at[0]), 2), round(float(at[1]), 2), h["z"]]


def glows_more(h=None):
    """The light of the stops past New Marina after dark: the bars' stand signs, the passage's tubes, the supermarket
    (open all night)."""
    out = []
    f = np.asarray(FORK["into"], float)
    at = np.asarray(FORK["at"], float) + f / np.hypot(*f) * 1.4
    out.append([round(float(at[0]), 1), round(float(at[1]), 1), 4.5, "#ffd8a0", 0.35, 17, 1])
    S0, N0 = passage_points()
    for k in (0.32, 0.72):
        p = S0 + (N0 - S0) * k
        out.append([round(float(p[0]), 1), round(float(p[1]), 1), 3.2, "#eef4ff", 0.45])
    if h:
        P, _ = _frame(h["at"], h["normal"], h["z"])
        for a in (-4.0, 0.0, 4.0):
            p = P(a, 2.4, 0)
            out.append([round(float(p[0]), 1), round(float(p[1]), 1), 6.0, "#f4f6ff", 0.4])
    return out


def frames(lm):
    """The photo spots' frames: {eye, look, note} in absolute metres, the angle each stop is known by from a game,
    taken at eye height from where a pilgrim stands to take it."""
    out = {}
    w = PUKUICHI
    P, _ = _frame(w["at"], w["normal"], w["z"])
    hl = w["len"] / 2
    out["pukuichi"] = {"eye": P(-hl - 3.0, 3.2, 1.6), "look": P(hl - 2.0, 0.6, 2.4), "note": "Up the street from Route 246, the shop on your left."}
    y = lm.get("yongen", {})
    if "marina" in y:
        m = y["marina"]
        P, _ = _frame(m["at"], m["normal"], m["z"])
        hl = m["len"] / 2
        out["marina"] = {"eye": P(-hl - 2.0, 2.4, 1.55), "look": P(hl - 1.5, 0.4, 2.0), "note": "From the corner, both awnings down the lane to the door."}
        if "chiyo" in y:
            c = y["chiyo"]
            Pc, _ = _frame(c["at"], c["normal"], c["z"])
            out["chiyo"] = {"eye": Pc(0.6, 5.2, 1.6), "look": Pc(-1.15, 0.35, 2.3), "note": "Across the lane from the board, the boarded alley under it."}
    (p, q) = [np.asarray(v, float) for v in STAIR_CORNER["wall"]]
    sp = stair_corner_spot()
    mid = (p + q) / 2
    out["stair_corner"] = {"eye": [sp[0], sp[1], sp[2] + 1.6], "look": [float(mid[0]), float(mid[1]), STAIR_CORNER["z"] + 2.2], "note": "The bend, the stair going up the blue-grey wall."}
    at, f = np.asarray(FORK["at"], float), np.asarray(FORK["into"], float)
    f = f / np.hypot(*f)
    e0, l0 = at - f * 4.5 + np.array([f[1], -f[0]]) * 0.4, at + f * 7.0
    out["fork"] = {"eye": [float(e0[0]), float(e0[1]), FORK["z"] + 1.6], "look": [float(l0[0]), float(l0[1]), FORK["z"] + 1.1], "note": "The signs at the mouth of the bars' lane."}
    S0, N0 = passage_points()
    g = (N0 - S0) / np.hypot(*(N0 - S0))
    e1 = S0 - g * 4.2 + np.array([g[1], -g[0]]) * 0.5
    out["passage"] = {"eye": [float(e1[0]), float(e1[1]), PASSAGE["z"] + 1.6], "look": [float(N0[0]), float(N0[1]), PASSAGE["z"] + 1.3], "note": "Into the covered stretch, the short cut to the station."}
    if "hanamasa" in y:
        h = y["hanamasa"]
        P, _ = _frame(h["at"], h["normal"], h["z"])
        hl = h["len"] / 2
        out["hanamasa"] = {"eye": P(hl - 3.0, 7.0, 1.6), "look": P(-hl - 1.0, 0.0, 5.0), "note": "The yellow wall, the two blades and the batting centre's stair."}
    return {k: {kk: ([round(float(c), 2) for c in vv] if kk != "note" else vv) for kk, vv in v.items()} for k, v in out.items()}
