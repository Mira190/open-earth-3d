#!/usr/bin/env python3
"""Views for tools/city_shot.js that look at a city's own facade styles: the opening view and a
close oblique view over the densest block of the city's most characteristic style (machiya,
haussmann, grachtenpand, mixed, terrace...), each at day, dusk and night.
  python3 tools/style_views.py kyoto > views.json            # or: --style machiya
"""
import argparse, json, math, sys
from collections import Counter, defaultdict

PREF = ['machiya', 'haussmann', 'grachtenpand', 'mixed', 'terrace', 'heritage', 'house', 'apartment']
TIMES = [('day', '10:30'), ('dusk', 'sunset+15'), ('night', 'sunset+150')]  # well after dusk, whatever the tour's date

ap = argparse.ArgumentParser()
ap.add_argument('city')
ap.add_argument('--style', action='append', help='styles to frame (default: the city\'s most characteristic)')
ap.add_argument('--n', type=int, default=1, help='how many styles to frame by default')
ap.add_argument('--data', default='web/data')
ap.add_argument('--times', default='day,dusk,night', help='which of day, dusk and night')
a = ap.parse_args()
TIMES = [t for t in TIMES if t[0] in a.times.split(',')]
B = json.load(open(f'{a.data}/{a.city}/buildings.json'))
styles = B.get('styles') or []
style_of = [styles[m[10]] if len(m) > 10 and isinstance(m[10], int) and m[10] < len(styles) else None for m in B['b']]
count = Counter(s for s in style_of if s)
want = a.style or [s for s in PREF if count.get(s, 0) >= 30][:a.n]

# a centroid and a top per building, from its solids; and the solids on a 50 m grid for sight lines
cx, cy, top = defaultdict(float), defaultdict(float), defaultdict(float)
nn = Counter()
bot = defaultdict(lambda: 1e9)
grid = defaultdict(list)
solids = defaultdict(list)
sol_id = {}
for si, s in enumerate(B['s']):
    solids[s[0]].append(s); sol_id[id(s)] = si
    b, r = s[0], s[4]
    xs, ys = [v / 10 for v in r[0::2]], [v / 10 for v in r[1::2]]
    cx[b] += sum(xs); cy[b] += sum(ys); nn[b] += len(xs)
    top[b] = max(top[b], s[3] / 10); bot[b] = min(bot[b], s[1] / 10)
    for gi in range(math.floor(min(xs) / 50), math.floor(max(xs) / 50) + 1):
        for gj in range(math.floor(min(ys) / 50), math.floor(max(ys) / 50) + 1):
            grid[(gi, gj)].append((xs, ys, (s[1] + s[3]) / 10))


# the street frontages of each solid (edge indices), from the pipeline
fronts = {f[0]: set(f[1::2]) for f in B.get('f', [])}


def inside(xs, ys, x, y):
    c, n = False, len(xs)
    for k in range(n):
        j = k - 1
        if (ys[k] > y) != (ys[j] > y) and x < (xs[j] - xs[k]) * (y - ys[k]) / (ys[j] - ys[k]) + xs[k]:
            c = not c
    return c


def roof_at(x, y):
    """the top of the solids over (x, y), above the datum (bases are)"""
    return max([t for xs, ys, t in grid[(math.floor(x / 50), math.floor(y / 50))] if inside(xs, ys, x, y)], default=0.0)


def clear(cam, tgt, ground):
    """no solid between the camera and 85% of the way to the target (heights above the ground)"""
    for k in range(0, 18):
        t = k / 20
        x, y, z = (cam[i] + (tgt[i] - cam[i]) * t for i in range(3))
        if roof_at(x, y) > z + ground + 1:
            return False
    return True


views = [{'name': f'open-{t}', 'time': tm} for t, tm in TIMES]
CELL = 120
for st in want:
    cells = Counter()
    for b, s in enumerate(style_of):
        if s == st and nn[b]:
            cells[(math.floor(cx[b] / nn[b] / CELL), math.floor(cy[b] / nn[b] / CELL))] += 1
    if not cells:
        continue
    (i, j), _ = cells.most_common(1)[0]
    xs = [(cx[b] / nn[b], cy[b] / nn[b], top[b], bot[b], b) for b, s in enumerate(style_of) if s == st and nn[b]
          and (math.floor(cx[b] / nn[b] / CELL), math.floor(cy[b] / nn[b] / CELL)) == (i, j)]
    x = sum(p[0] for p in xs) / len(xs); y = sum(p[1] for p in xs) / len(xs)
    # a street view: across the street from a frontage of one of the style's buildings near the block's
    # middle, a little along it, at a first-floor window's height, with nothing in between; failing
    # that, from the south-east and round the compass, higher and higher, until one sees it
    cam = None
    for bx, by, bt, base, b in sorted(xs, key=lambda p: math.hypot(p[0] - x, p[1] - y))[:40]:
        tz = max(3.0, min(bt * 0.55, 14.0))
        for sol in solids[b]:
            r = sol[4]
            pts = [(r[k] / 10, r[k + 1] / 10) for k in range(0, len(r), 2)]
            edges = sorted(range(len(pts)), key=lambda k: -math.dist(pts[k], pts[(k + 1) % len(pts)]))
            edges = [k for k in edges if k in fronts.get(sol_id[id(sol)], ())] + edges
            for k in edges[:6]:
                (ax, ay), (qx, qy) = pts[k], pts[(k + 1) % len(pts)]
                L = math.dist((ax, ay), (qx, qy))
                if L < 6:
                    continue
                ex, ey = (qx - ax) / L, (qy - ay) / L
                mx, my = (ax + qx) / 2, (ay + qy) / 2
                for d, along, h in ((30, 16, 9), (40, 22, 12), (55, 30, 16)):
                    c = [mx + ey * d + ex * along, my - ex * d + ey * along, h]
                    t = [mx + ey * 0.5, my - ex * 0.5, tz]
                    if all(roof_at(c[0] + ox, c[1] + oy) < base + 0.5 for ox, oy in ((0, 0), (6, 0), (-6, 0), (0, 6), (0, -6))) \
                            and clear(c, t, base):
                        cam, tgt = c, t
                        break
                if cam:
                    break
            if cam:
                break
        if cam:
            break
    if not cam:
        bx, by, bt, base, b = min(xs, key=lambda p: math.hypot(p[0] - x, p[1] - y))
        tgt = [bx, by, max(4.0, bt * 0.6)]  # (tops are heights above the base)
        for d, h in ((90, 30), (110, 40), (140, 55), (180, 75), (240, 110)):
            for k in range(8):
                a = math.radians(-50 + 45 * k)
                c = [bx + d * math.cos(a), by + d * math.sin(a), max(h, tgt[2] + 15)]
                if roof_at(c[0], c[1]) - base < c[2] - 15 and clear(c, tgt, base):
                    cam = c
                    break
            if cam:
                break
        cam = cam or [bx + 120, by - 160, 120]
    for t, tm in TIMES:
        views.append({'name': f'{st}-{t}', 'cam': [round(cam[0]), round(cam[1]), round(cam[2])],
                      'tgt': [round(tgt[0]), round(tgt[1]), round(tgt[2])], 'agl': True, 'time': tm})
json.dump(views, sys.stdout, indent=1)
