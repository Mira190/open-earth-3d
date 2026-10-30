"""The city at night, as it looks from the air: what web/night.js lights.

    python pipeline/night_lights.py --city sydney    # after game_data.py (it also runs at its end)
    python pipeline/night_lights.py --all

Reads web/data/<city>/game.json and writes web/data/<city>/night.json:
  roads   the mapped road network the street lights and the traffic follow: three numbers
          per road, its class (an index into `classes`), its speed in dm/s and how many of
          the points in `pts` are its own, base64 int16 little-endian. Each polyline is
          simplified to within 1 m across and 0.5 m in height (Ramer-Douglas-Peucker),
          which keeps a straight street to its ends and a curve to its bends. Bridge
          parts carry their deck's height and tunnels are already gone (game_data.py)
  pts     the roads' points, base64 int16 little-endian: x and y in quarter metres, z in
          decimetres
  lamps   the street lamps OpenStreetMap maps (game.json props), in the same units
  style   the city's lights: the colours of its street lamps and their shares, the
          colours on its motorways, the side its traffic keeps to, the height from which
          its towers carry aircraft warning lights and whether they flash, and the glow
          its lights put in the haze. From city.json "night", over defaults by country
"""
import argparse
import base64
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "living_street"]
XY, Z = 0.25, 0.1  # metres per unit

# Street lighting by country, as it reads in night photographs from the air. Colours are sRGB
# for the lamp's light; shares need not sum to one. Sodium is the orange of high-pressure
# sodium (about 2100 K), the rest LED and metal halide at roughly 3000, 4000 and 5000 K.
SODIUM, K3000, K4000, K5000 = "#ff9b42", "#ffc58c", "#ffdcb4", "#fff0e2"
STYLE = {
    "Japan": {"street": [[K4000, 0.45], [K5000, 0.35], [K3000, 0.12], [SODIUM, 0.08]],
              "highway": [[SODIUM, 0.55], [K5000, 0.45]], "aviation": {"from_m": 60, "flash": True},
              "skyglow": "#1d2230"},
    "China": {"street": [[SODIUM, 0.55], [K3000, 0.2], [K5000, 0.25]],
              "highway": [[SODIUM, 0.8], [K5000, 0.2]], "aviation": {"from_m": 90, "flash": False},
              "skyglow": "#2a2119"},
    "France": {"street": [[SODIUM, 0.45], [K3000, 0.45], [K4000, 0.1]],
               "highway": [[SODIUM, 0.7], [K3000, 0.3]], "aviation": {"from_m": 100, "flash": False},
               "skyglow": "#2b2118"},
    "Netherlands": {"street": [[K3000, 0.55], [K4000, 0.3], [SODIUM, 0.15]],
                    "highway": [[SODIUM, 0.4], [K4000, 0.6]], "aviation": {"from_m": 100, "flash": False},
                    "skyglow": "#241f1b"},
    "Australia": {"street": [[K3000, 0.45], [K4000, 0.4], [SODIUM, 0.15]],
                  "highway": [[K4000, 0.6], [SODIUM, 0.4]], "aviation": {"from_m": 110, "flash": False},
                  "skyglow": "#1c1d22"},
}
DEFAULT = {"street": [[K3000, 0.5], [K4000, 0.35], [SODIUM, 0.15]], "highway": [[SODIUM, 0.5], [K4000, 0.5]],
           "aviation": {"from_m": 100, "flash": False}, "skyglow": "#231f1c"}
LEFT = {"Australia", "Japan", "United Kingdom", "Ireland", "New Zealand", "Singapore", "Malaysia", "Indonesia",
        "Thailand", "India", "South Africa", "China"}  # China: Hong Kong and Macau keep left


def rdp(p, tol_xy=1.0, tol_z=0.5):
    """Ramer-Douglas-Peucker on an (n, 3) polyline in metres; returns the indices kept."""
    n = len(p)
    if n < 3:
        return list(range(n))
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        seg = p[b, :2] - p[a, :2]
        L = np.hypot(*seg)
        q = p[a + 1:b]
        if L < 1e-6:
            dxy = np.hypot(*(q[:, :2] - p[a, :2]).T)
        else:
            d = q[:, :2] - p[a, :2]
            dxy = np.abs(seg[0] * d[:, 1] - seg[1] * d[:, 0]) / L
        t = np.clip(((q[:, :2] - p[a, :2]) @ seg) / max(L * L, 1e-9), 0, 1)
        dz = np.abs(q[:, 2] - (p[a, 2] + t * (p[b, 2] - p[a, 2])))
        err = np.maximum(dxy / tol_xy, dz / tol_z)
        i = int(np.argmax(err))
        if err[i] > 1:
            k = a + 1 + i
            keep[k] = True
            stack += [(a, k), (k, b)]
    return list(np.nonzero(keep)[0])


def pack(a):
    return base64.b64encode(np.asarray(a, "<i2").tobytes()).decode()


def build(cid, game):
    cfg = json.load(open(os.path.join(ROOT, "cities", cid, "city.json"), encoding="utf8"))
    country = cfg.get("country", "")
    style = json.loads(json.dumps(STYLE.get(country, DEFAULT)))
    style["keep"] = (game.get("keep") or ((game.get("rail") or {}).get("tram") or {}).get("keep")
                     or ("left" if country in LEFT else "right"))
    style |= cfg.get("night", {})
    roads, pts = [], []
    n0 = 0
    for r in game["paths"]["road"]:
        if r["c"] not in CLASSES or len(r["p"]) < 6:
            continue
        p = np.array(r["p"], float).reshape(-1, 3) / 10
        n0 += len(p)
        k = rdp(p)
        q = p[k]
        roads += [CLASSES.index(r["c"]), round(r.get("v", 9) * 10), len(q)]
        pts += [v for x, y, z in q for v in (round(x / XY), round(y / XY), round(z / Z))]
    lamps = game.get("props", {}).get("street_lamp", [])
    lamps = [round(v * 0.1 / (Z if i % 3 == 2 else XY)) for i, v in enumerate(lamps)]
    out = {"note": "Street lights, traffic and tower lights for web/night.js, from game.json (pipeline/night_lights.py)",
           "classes": CLASSES, "units": [XY, Z], "roads": pack(roads), "pts": pack(pts), "lamps": pack(lamps), "style": style}
    print(f"{cid}: {len(roads) // 3} roads, {n0} points simplified to {len(pts) // 3}, {len(lamps) // 3} mapped lamps,"
          f" keeps {style['keep']}")
    return out


def write(out_dir, game):
    cid = os.path.basename(os.path.normpath(out_dir))
    path = os.path.join(out_dir, "night.json")
    json.dump(build(cid, game), open(path, "w"), separators=(",", ":"))
    print(f"{path}: {os.path.getsize(path) / 1e3:.0f} kB")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--city")
    ap.add_argument("--all", action="store_true", help="every city with a game.json")
    a = ap.parse_args()
    data = os.path.join(ROOT, "web", "data")
    ids = sorted(c for c in os.listdir(data) if os.path.exists(os.path.join(data, c, "game.json"))) if a.all else [a.city]
    if not ids or ids == [None]:
        sys.exit("give --city <id> or --all")
    for cid in ids:
        d = os.path.join(data, cid)
        write(d, json.load(open(os.path.join(d, "game.json"))))


if __name__ == "__main__":
    main()
