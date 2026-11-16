"""Does a story's flight clear the buildings? For every frame with a `flight` in cities/<city>/city.json, the
helicopter's path through each shot (a Catmull-Rom curve through the shot's `guide` points, as web/game/overture.js
flies it) is walked a metre at a time against the map's solids: it fails where a solid within MARGIN metres of the
path (LOW metres where it lifts off and comes down to land) stands higher than the helicopter's skids less CLEAR metres. Exits 1 on a failure.

    python tools/flight_clear.py [city]
"""
import json
import os
import sys

from shapely.geometry import Point, Polygon
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOW = 9.0
MARGIN, CLEAR = 16.0, 10.0  # (room that is seen to be room: twice a rotor, and a storey or three under the skids)


def curve(P, n=40):
    out = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for k in range(n):
            t = k / n
            out.append(tuple(0.5 * ((2 * p1[a]) + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t * t + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t ** 3) for a in range(3)))
    return out + [tuple(P[-1])]


def main():
    city = sys.argv[1] if len(sys.argv) > 1 else "shibuya"
    B = json.load(open(os.path.join(ROOT, "web", "data", city, "buildings.json"), encoding="utf8"))
    cfg = json.load(open(os.path.join(ROOT, "cities", city, "city.json"), encoding="utf8"))
    polys = [Polygon([(s[4][i] / 10, s[4][i + 1] / 10) for i in range(0, len(s[4]), 2)]).buffer(0) for s in B["s"]]
    tops = [(s[1] + s[3]) / 10 for s in B["s"]]
    lows = [(s[1] + s[2]) / 10 for s in B["s"]]
    tree = STRtree(polys)
    bad = 0
    for ep in cfg["game"]["story"]["episodes"]:
        for fi, fr in enumerate(ep["frames"]):
            for shot in (fr.get("flight") or {}).get("shots", []):
                g = [p for p in shot.get("guide", []) if isinstance(p[0], (int, float))]
                if len(g) < 2 or g[0] == g[-1]:
                    continue
                hits = []
                for x, y, z in curve(g):
                    m = LOW if z < g[-1][2] + 25 or z < g[0][2] + 8 else MARGIN  # (coming down to land, and lifting off: a rotor's width and a little)
                    for k in tree.query(Point(x, y).buffer(m)):
                        if tops[k] > z - CLEAR and lows[k] < z + 3 and polys[k].distance(Point(x, y)) < m:
                            if tops[k] - z > -CLEAR + 0.5 and not (abs(z - tops[k]) < 2.5 and (x, y, z) in (tuple(g[0]), tuple(g[-1]))):  # (not the roof or the ground it stands on)
                                hits.append((round(x), round(y), round(z), round(tops[k])))
                                break
                # (the pad it leaves and the ground it lands on are within a few metres of its skids by design)
                hits = [h for h in hits if not (h[3] - h[2] < 3 and (abs(h[2] - g[0][2]) < 6 or abs(h[2] - g[-1][2]) < 6))]
                print(f"frame {fi + 1} {shot['id']}: {'clear' if not hits else f'{len(hits)} m too close, first at {hits[0][:3]} under a top of {hits[0][3]} m'}")
                bad += bool(hits)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
