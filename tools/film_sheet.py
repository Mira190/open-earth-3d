"""A film's contact sheet: one frame from the middle of each shot, two to a row, 1440 px wide.

    python3 tools/film_sheet.py shibuya            # web/films/shibuya.mp4 -> docs/images/films/shibuya.jpg
    python3 tools/film_sheet.py shibuya --at 0.5   # where in each shot the frame is taken (0..1)

Reads the shots from the film's cue sheet (web/films/<id>.json), so it matches the cut as encoded.
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')


def main():
    film = sys.argv[1]
    at = float(sys.argv[sys.argv.index('--at') + 1]) if '--at' in sys.argv else 0.5
    cue = json.load(open(os.path.join(ROOT, 'web', 'films', f'{film}.json')))
    mp4 = os.path.join(ROOT, 'web', 'films', f'{film}.mp4')
    w = 720
    h = round(w * cue['size'][1] / cue['size'][0])
    frames = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, s in enumerate(cue['shots']):
            t = s['t0'] + at * (s['t1'] - s['t0'])
            out = os.path.join(tmp, f'{i}.png')
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{t:.3f}', '-i', mp4, '-frames:v', '1',
                            '-vf', f'scale={w}:{h}', out], check=True)
            frames.append(Image.open(out).convert('RGB'))
    rows = (len(frames) + 1) // 2
    sheet = Image.new('RGB', (2 * w, rows * (h + 1) - 1), (12, 12, 14))
    for i, f in enumerate(frames):
        sheet.paste(f, ((i % 2) * w, (i // 2) * (h + 1)))
    dst = os.path.join(ROOT, 'docs', 'images', 'films', f'{film}.jpg')
    sheet.save(dst, quality=86)
    print(f'{dst}: {len(frames)} shots')


if __name__ == '__main__':
    main()
