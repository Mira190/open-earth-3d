"""Storeys counted again on buildings built before typology.storeys() learned to doubt a floor count of one.

    python pipeline/restorey.py --city paris        # or --city all

A register that records a whole block as one floor (Paris has about 1,600 at 15-30 m, Osaka and
Hong Kong a few hundred) used to give it one storey as tall as its wall, up to 8 m. storeys()
now counts the storeys from the style's storey height when a one-floor record sits on a wall
taller than two of the style's tallest storeys, and build_scene.py writes those. This pass
gives the same storeys to a buildings.json written before that, without the raw downloads: a
stale record is one floor with the storey and ground floor equal to the old rule's
min(max(wall, 2.6), 8.0); its wall is that value, or above 8 m the one build_scene.py measured
(the eaves of its tallest solid over its lowest base). web/buildings.js applies the same rule to
any file still left stale.

Rewrites web/data/<city>/buildings.json in place; running it again, or on a file
build_scene.py has written since, changes nothing.
"""
import argparse
import json
import os
from collections import defaultdict

import typology

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def wall_height(B, ks, eaves):
    """the wall build_scene.py gave storeys(): its tallest solid's eaves (its top when flat) over
    the building's lowest base, at least 2.4 m"""
    S = B["s"]
    top = max(S[k][3] for k in ks)
    eave = top
    for k in ks:
        if S[k][3] >= top - 0.1 and k in eaves:
            eave = eaves[k]
    return max((eave - min(S[k][2] for k in ks)) / 10, 2.4)


def mark(out_dir):
    path = os.path.join(out_dir, "buildings.json")
    if not os.path.exists(path):
        return 0
    B = json.load(open(path, encoding="utf8"))
    styles = B.get("styles", [])
    by_b = defaultdict(list)
    for k, s in enumerate(B["s"]):
        by_b[s[0]].append(k)
    eaves = {r[0]: r[2] for r in B.get("r", [])}
    fronted = {B["s"][r[0]][0] for r in B.get("f", [])}
    n = 0
    for bi, m in enumerate(B["b"]):
        if len(m) < 13 or m[3] != 1 or m[11] != m[12] or not by_b.get(bi):
            continue
        style = styles[m[10]]
        if style not in typology.STOREY_MAX:
            continue
        wall = wall_height(B, by_b[bi], eaves)
        if abs(round(min(max(wall, 2.6), 8.0), 2) - m[11]) > 0.06:  # not the old rule's: built since, or changed by a later pass
            continue
        if m[11] < 8.0:
            wall = m[11]  # exact, where the old rule kept the wall
        if wall <= 2 * typology.STOREY_MAX[style]:
            continue
        storey, ground = typology.storeys(style, wall, 1, bi in fronted)
        if (storey, ground) != (m[11], m[12]):
            m[11], m[12] = storey, ground
            n += 1
    if n:
        with open(path, "w") as f:
            json.dump(B, f, separators=(",", ":"))
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--city", required=True, help="a city id, or all")
    a = ap.parse_args()
    data = os.path.join(ROOT, "web", "data")
    ids = sorted(d for d in os.listdir(data) if os.path.exists(os.path.join(data, d, "buildings.json"))) if a.city == "all" else [a.city]
    for cid in ids:
        print(f"{cid}: {mark(os.path.join(data, cid))} buildings' storeys counted again")


if __name__ == "__main__":
    main()
