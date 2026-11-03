"""The words on the shop signs that web/buildings.js paints on Japanese mixed-use facades.

The facade shader puts signs on some floors and a vertical sign down a corner bay of each such
building. Their lettering is sampled from this atlas, so a sign reads as real words: the kinds of
business a Japanese street's signs name (no shop's or brand's name), set with Google Fonts under
the SIL Open Font License (pipeline/japankit.py fetches them into data/raw/fonts).

The atlas is COLS cells across and ROWS down, CELL px a side, white on black (a grey PNG):
  rows 0 .. len(WORDS)-1   a word for a panel across a floor, a character a cell from the left;
                           the last column is filled with grey len*16, so the shader knows how many
                           characters the word has and can centre it
  the rows after           two-character words for the floors of a vertical sign, four to a row

    python pipeline/sign_glyphs.py      # writes web/assets/signs/glyphs.png
"""
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import japankit as jk  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "assets", "signs", "glyphs.png")
CELL, COLS, ROWS = 64, 8, 32

# words across a floor's sign panel (up to seven characters), with the face each is set in
WORDS = [("居酒屋", "zen"), ("焼肉", "dela"), ("寿司", "mincho"), ("ラーメン", "dela"), ("カラオケ", "rocknroll"),
         ("歯科医院", "zen"), ("不動産", "zen"), ("美容室", "mplus"), ("中華料理", "zen"), ("喫茶店", "mincho"),
         ("そば処", "mincho"), ("うどん", "mplus"), ("焼鳥", "dela"), ("書店", "mincho"), ("眼科", "zen"),
         ("内科", "zen"), ("学習塾", "zen"), ("英会話", "mplus"), ("薬局", "zen"), ("整骨院", "zen"),
         ("マッサージ", "rocknroll"), ("麻雀", "dela")]
# two-character words down a vertical sign, one floor's tenant each
PAIRS = ["焼肉", "寿司", "歯科", "麻雀", "酒場", "珈琲", "中華", "和食", "整体", "美容", "薬局", "書店",
         "眼科", "内科", "質屋", "囲碁", "将棋", "鮮魚", "天丼", "餃子", "定食", "洋食", "花屋", "時計",
         "眼鏡", "古着", "金券", "両替", "写真", "画廊", "茶房", "酒店", "文具", "英語", "料亭", "割烹",
         "鍼灸", "接骨", "旅館", "宿泊"]
PAIR_FONTS = ["zen", "mincho", "dela", "zen", "mplus"]


def glyph(img, d, col, row, ch, fname):
    x, y = col * CELL, row * CELL
    size = int(CELL * 0.86)
    d.text((x + CELL / 2, y + CELL / 2), ch, font=jk.font(fname if jk.covers(fname, ch) else jk.FALLBACK, size), fill=255, anchor="mm")


def main():
    assert len(WORDS) + (len(PAIRS) + 3) // 4 <= ROWS and all(len(w) < COLS for w, _ in WORDS)
    img = Image.new("L", (COLS * CELL, ROWS * CELL), 0)
    d = ImageDraw.Draw(img)
    for r, (w, fname) in enumerate(WORDS):
        for c, ch in enumerate(w):
            glyph(img, d, c, r, ch, fname)
        d.rectangle([(COLS - 1) * CELL, r * CELL, COLS * CELL - 1, (r + 1) * CELL - 1], fill=len(w) * 16)
    for k, w in enumerate(PAIRS):
        r, c = len(WORDS) + k // 4, (k % 4) * 2
        for j, ch in enumerate(w):
            glyph(img, d, c + j, r, ch, PAIR_FONTS[k % len(PAIR_FONTS)])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, optimize=True)
    print(f"{OUT}: {len(WORDS)} words, {len(PAIRS)} pairs, {os.path.getsize(OUT) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
