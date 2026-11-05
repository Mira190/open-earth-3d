"""Which bridges over the water each built city draws (issue 122): the bridges OpenStreetMap maps over a
city's water (pipeline/bridges.py, with the city's city.json "bridges", on the flat ground), and for each whether a landmark's
deck in web/data/<id>/game.json (surfaces) or landmarks.json stands on it. A bridge with neither is drawn
by nothing: the game's road crosses the water on nothing.

Needs data/raw/<id>/overture_{water,infrastructure}.parquet (fetch_overture.py --only water infrastructure).

    python tools/bridge_survey.py                 # every city with the layers
    python tools/bridge_survey.py asakusa tokyo
"""
import json
import os
import sys

import numpy as np
from shapely.geometry import Point

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pipeline"))
import bridges  # noqa: E402
import districtkit as dk  # noqa: E402
from cityctx import City  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


class Flat:
    def __init__(self, C):
        self.city = C

    def ground(self, x, y):
        return 0.0


def decks(C):
    """Centres and outlines of the walkable decks the built game has (strips), as (origin, axis, half_width, length)."""
    path = os.path.join(C.out, "game.json")
    if not os.path.exists(path):
        return []
    g = json.load(open(path, encoding="utf8"))
    out = []
    for s in g.get("surfaces", []):
        if s.get("type") == "strip" and s.get("profile"):
            us = [p[0] for p in s["profile"]]
            out.append((np.asarray(s["origin"][:2], float), np.asarray(s["axis"], float), float(s["half_width"]), min(us), max(us)))
    return out


def on_deck(b, ds):
    c = np.asarray(b["centre"], float)
    for o, ax, hw, u0, u1 in ds:
        d = c - o
        u, v = float(d @ ax), float(d[0] * -ax[1] + d[1] * ax[0])
        if u0 - 2 <= u <= u1 + 2 and abs(v) <= hw + 4:
            return True
    return False


def main():
    ids = sys.argv[1:] or sorted(d for d in os.listdir(os.path.join(ROOT, "cities")) if os.path.isdir(os.path.join(ROOT, "cities", d)))
    total = 0
    for cid in ids:
        C = City(cid)
        if not all(os.path.exists(os.path.join(C.raw, f"overture_{n}.parquet")) for n in ("water", "infrastructure")):
            continue
        cfg = bridges.config(C)
        try:
            bs = dk.water_bridges(Flat(C), classes=tuple(cfg.get("classes", bridges.CLASSES)), min_m2=cfg.get("min_m2", 150.0), widths=cfg.get("widths"))
        except ValueError:
            bs = []
        left = [b for b in bs if b["name"] in set(cfg.get("skip", [])) or bridges.elevated(C, b)]   # left out on purpose
        bs = [b for b in bs if b not in left]
        ds = decks(C)
        missing = [b for b in bs if not on_deck(b, ds)]
        total += len(missing)
        print(f"{cid:20s} {len(bs):3d} over the water, {len(bs) - len(missing):3d} with a deck, {len(missing):3d} drawn by nothing"
              + (f" ({len(left)} viaducts or skipped)" if left else ""))
        for b in missing:
            print(f"    {b['name'] or '(no name)':28s} {b['length_m']:6.1f} x {b['width_m']:4.1f} m at {b['centre']}")
    print(f"{total} bridges drawn by nothing")


if __name__ == "__main__":
    main()
