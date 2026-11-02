"""Covered walkways (arcades) as canopies over the street, not solid blocks.

    python pipeline/arcades.py --city kyoto       # after game_data.py; or --city all

A covered shopping street or a covered pavement (Kyoto's Shijo and Kawaramachi arcades,
Osaka's shotengai, a station's covered walk) comes in the open data as a building: a
long, thin footprint from OpenStreetMap (building=roof) or Project PLATEAU, extruded from
the ground. Drawn and walked that way it is a wall several hundred metres long down the
pavement, and it closes off whole blocks (central Kyoto between Shijo, Kawaramachi, Sanjo
and Shinkyogoku had no way in on foot).

A solid is taken for a canopy when its footprint is thin (twice its area over its
perimeter, its mean width, at most 5 m), a mapped footway (game.json paths) runs inside
it along at least 60% of its length, and it is either mapped as a roof (class "roof") or
an unnamed PLATEAU footprint no taller than 20 m (a named or taller one is a building a
passage runs through: a department store, a station). Its solid then starts at a soffit
(min_dm) under its measured top (soffit_dm), and it is drawn as a
plain canopy (class "roof", style "plain": no windows, an underside; web/buildings.js),
and walked under (web/game/nav.js reads min_dm as every solid's).

Rewrites web/data/<city>/buildings.json in place; running it again changes nothing.
"""
import argparse
import json
import os

import shapely
from shapely.geometry import LineString, Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDTH_M, ALONG, TALL_M = 5.0, 0.6, 20.0


def soffit_dm(height_m):
    """A canopy's underside: its roof at the measured top, a quarter of the height deep (0.5-3 m),
    and never lower than 2.5 m over the street."""
    return round(10 * max(2.5, height_m - max(0.5, min(3.0, 0.25 * height_m))))


def mark(out_dir):
    bpath, gpath = os.path.join(out_dir, "buildings.json"), os.path.join(out_dir, "game.json")
    if not (os.path.exists(bpath) and os.path.exists(gpath)):
        return 0
    B, G = json.load(open(bpath, encoding="utf8")), json.load(open(gpath, encoding="utf8"))
    foot = []
    for o in G.get("paths", {}).get("foot", []):
        p = o["p"]
        if len(p) >= 6:
            foot.append(LineString([(p[i] / 10, p[i + 1] / 10) for i in range(0, len(p), 3)]))
    if not foot:
        return 0
    tree = shapely.STRtree(foot)
    plain = B["styles"].index("plain") if "plain" in B.get("styles", []) else None
    n = 0
    for s in B["s"]:
        bi, ring = s[0], s[4]
        meta = B["b"][bi]
        height = (s[3] - s[2]) / 10
        try:
            P = Polygon([(ring[k] / 10, ring[k + 1] / 10) for k in range(0, len(ring), 2)],
                        [[(h[k] / 10, h[k + 1] / 10) for k in range(0, len(h), 2)] for h in s[5:] if len(h) >= 6])
            if not P.is_valid:
                P = P.buffer(0)
        except ValueError:
            continue
        if P.is_empty or P.length < 40 or 2 * P.area / P.length > WIDTH_M:
            continue
        roof = meta[1] == "roof"
        if s[2] > 0 and not roof:
            continue  # already raised: part of a building over a passage
        if not roof and (meta[0] or meta[6] or meta[5] != "P" or height > TALL_M):
            continue
        inside = sum(foot[i].intersection(P).length for i in tree.query(P))
        if inside < ALONG * P.length / 2:
            continue
        lo = soffit_dm(height)
        if s[2] >= lo or s[3] - lo < 3:
            continue
        s[2] = lo
        meta[1] = "roof"
        if plain is not None and len(meta) > 10:
            meta[10] = plain
        n += 1
    if n:
        with open(bpath, "w") as f:
            json.dump(B, f, separators=(",", ":"))
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--city", required=True, help="a city id, or all")
    a = ap.parse_args()
    data = os.path.join(ROOT, "web", "data")
    ids = sorted(d for d in os.listdir(data) if os.path.exists(os.path.join(data, d, "game.json"))) if a.city == "all" else [a.city]
    for cid in ids:
        print(f"{cid}: {mark(os.path.join(data, cid))} covered walkways raised to canopies")


if __name__ == "__main__":
    main()
