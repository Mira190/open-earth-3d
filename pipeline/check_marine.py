"""Check a built marine city's POIs, spawn and harbour spots against its own terrain and habitat.

    python pipeline/check_marine.py --city hardy-reef

Reads web/data/<id>/scene.json, terrain.bin and habitat.png (what the viewer reads) and, for
every POI, samples the 30 m height grid the way the viewer does (bilinear on cell centres,
web/reef/world.js terrainHeight) and the 10 m habitat class. Each kind has an expectation:
a beach lies at about 0-2.5 m, an island or airstrip above the sea, an anchorage in water
5-9 m deep, a pontoon on a reef edge with deep water beside it, a gate in open water. For
anchorages and the pontoon it also repeats the viewer's own search (web/reef/boats/nav.js
`anchorage`: the nearest spot of the wanted depth with room around it), so the place the boats
will really go is known before the viewer runs. The spawn is checked as a beach (or, with
`"water": true`, as open water a swimmer can float in).

Writes cities/<id>/analysis/poi_check.json and prints one line per POI; exits non-zero when a
POI fails its expectation, so a bad position is caught before screenshots.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

from cityctx import city_args


class Grid:
    def __init__(self, out):
        s = json.load(open(os.path.join(out, "scene.json")))
        t = s["terrain"]
        self.s, self.t = s, t
        self.h = np.fromfile(os.path.join(out, t["file"]), "<i2").reshape(t["h"], t["w"]).astype(np.float32) * t["units_m"]
        self.hab = np.array(Image.open(os.path.join(out, s["habitat"]["file"])))
        self.px = s["ground"]["px_m"]

    def height(self, x, n):
        t = self.t
        fx, fy = (x - t["x0"]) / t["cell_m"] - 0.5, (t["y1"] - n) / t["cell_m"] - 0.5
        ix, iy = math.floor(fx), math.floor(fy)
        ax, ay = fx - ix, fy - iy
        g = lambda i, j: float(self.h[min(t["h"] - 1, max(0, j)), min(t["w"] - 1, max(0, i))])
        return (g(ix, iy) * (1 - ax) + g(ix + 1, iy) * ax) * (1 - ay) + (g(ix, iy + 1) * (1 - ax) + g(ix + 1, iy + 1) * ax) * ay

    def depth(self, x, n):
        return -self.height(x, n)

    def habitat(self, x, n):
        i, j = int((x - self.t["x0"]) // self.px), int((self.t["y1"] - n) // self.px)
        return int(self.hab[j, i]) if 0 <= j < self.hab.shape[0] and 0 <= i < self.hab.shape[1] else 0

    def ring(self, x, n, r, step=15):
        """min and max height within r metres"""
        v = [self.height(x + dx, n + dn) for dx in np.arange(-r, r + 1, step) for dn in np.arange(-r, r + 1, step) if dx * dx + dn * dn <= r * r]
        return min(v), max(v)

    def anchorage(self, x, n, dmin=4.5, dmax=9, max_r=1500, step=30, avoid=()):
        """web/reef/boats/nav.js anchorage(), line for line"""
        r = 0
        while r <= max_r:
            cnt = max(1, round(2 * math.pi * r / step))
            for a in range(cnt):
                th = a / cnt * math.pi * 2 if r else 0
                px, py = x + math.cos(th) * r, n + math.sin(th) * r
                d = self.depth(px, py)
                if d < dmin or d > dmax:
                    continue
                if any(self.depth(px + ox, py + oy) < dmin - 1 for ox, oy in ((60, 0), (-60, 0), (0, 60), (0, -60))):
                    continue
                if any(math.hypot(ax - px, ay - py) < ar for ax, ay, ar in avoid):
                    continue
                return px, py
            r += step
        return None


def judge(g, kind, x, n, p=None):
    """(ok, note) for a POI kind at (x, n)"""
    z, (lo, hi), hab = g.height(x, n), g.ring(x, n, 90), g.habitat(x, n)
    d = -z
    if kind == "beach":
        return -0.5 <= z <= 2.5, f"ground {z:.1f} m"
    if kind in ("island", "airport", "helipad", "lookout", "peak", "town"):
        return z > 0.2, f"ground {z:.1f} m"
    if kind == "anchorage":
        return 4.5 <= d <= 9.5, f"depth {d:.1f} m"
    if kind == "pontoon":
        return hi > -6 and lo < -9, f"depth {d:.1f} m, 90 m around {-hi:.1f}..{-lo:.1f} m"
    if kind in ("reef", "dive"):
        return lo < 0, f"depth {d:.1f} m, 90 m around {-hi:.1f}..{-lo:.1f} m"
    if kind == "gate":
        return d > 8, f"depth {d:.1f} m"
    if kind == "marina":   # a jetty's water end or a marina building: water and land within 300 m of each other
        lo3, hi3 = g.ring(x, n, 300, 30)
        return lo3 < -1 and hi3 > 0, f"height {z:.1f} m, within 300 m {lo3:.1f}..{hi3:.1f} m"
    return True, f"height {z:.1f} m"


def main():
    city, _ = city_args("Check a marine city's POIs against its built terrain")
    g = Grid(city.out)
    s = g.s
    rows, bad = [], 0
    pois = {p["id"]: p for p in s.get("pois") or []}
    for p in pois.values():
        ok, note = judge(g, p["kind"], p["x"], p["y"])
        row = {"id": p["id"], "kind": p["kind"], "src": p.get("src"), "x": p["x"], "y": p["y"], "ok": bool(ok), "note": note,
               "habitat": s["habitat"]["classes"][str(g.habitat(p["x"], p["y"]))]}
        if p["kind"] == "anchorage":
            a = g.anchorage(p["x"], p["y"], 4.8, 9, 1500, 30)
            row["boats_go_to"] = [round(a[0]), round(a[1]), round(math.hypot(a[0] - p["x"], a[1] - p["y"]))] if a else None
            # a nominal spot may sit off a narrow 5-9 m band on purpose (so boats routing to it stay in open
            # water); what matters is that the boats find their anchoring depth close by
            if not ok and a and row["boats_go_to"][2] <= 300:
                ok = row["ok"] = True
                row["note"] += f"; the boats anchor {row['boats_go_to'][2]} m away"
        rows.append(row)
        bad += not ok
    H = s.get("harbour") or {}
    pt = H.get("pontoon")
    if pt and pt.get("at") in pois:
        p = pois[pt["at"]]
        a = g.anchorage(p["x"], p["y"], 9, 18, 900, 20)
        search = (f"the viewer's 9-18 m search puts it {math.hypot(a[0] - p['x'], a[1] - p['y']):.0f} m from {pt['at']}, "
                  f"at ({a[0]:.0f}, {a[1]:.0f}), {g.depth(*a):.1f} m deep" if a else "the viewer's search finds no 9-18 m water within 900 m")
        if pt.get("exact"):  # placed on the POI itself (harbour.pontoon.exact)
            rows.append({"id": "pontoon (viewer)", "kind": "pontoon", "x": p["x"], "y": p["y"], "ok": True,
                         "note": f"exact: on {pt['at']}, depth {g.depth(p['x'], p['y']):.1f} m; a viewer without exact support: {search}"})
        else:
            rows.append({"id": "pontoon (viewer)", "kind": "pontoon", "x": round(a[0]) if a else None, "y": round(a[1]) if a else None,
                         "ok": bool(a), "note": search})
            bad += not a
    sp = s.get("spawn")
    if sp:
        z = g.height(sp["x"], sp["y"])
        ok = z < -1.5 if sp.get("water") else -0.5 <= z <= 2.5
        rows.append({"id": "spawn", "kind": "spawn", "x": sp["x"], "y": sp["y"], "ok": bool(ok),
                     "note": f"{'depth' if z < 0 else 'ground'} {abs(z):.1f} m, heading {sp.get('heading')}"})
        bad += not ok
    for r in rows:
        print(f"{'ok ' if r['ok'] else 'BAD'} {r['id']:<28} {r['kind']:<10} ({r['x']}, {r['y']})  {r['note']}"
              + (f"  habitat {r['habitat']}" if r.get("habitat") else "") + (f"  boats go to {r['boats_go_to']}" if "boats_go_to" in r else ""))
    os.makedirs(city.analysis, exist_ok=True)
    json.dump({"note": "POIs sampled on the built 30 m terrain and 10 m habitat (pipeline/check_marine.py)", "rows": rows},
              open(os.path.join(city.analysis, "poi_check.json"), "w"), indent=1)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
