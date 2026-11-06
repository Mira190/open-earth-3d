"""Covered walkways (arcades) and gates as canopies over the way through, not solid blocks.

    python pipeline/arcades.py --city kyoto       # after game_data.py; or --city all

A covered shopping street or a covered pavement (Kyoto's Shijo and Kawaramachi arcades,
Osaka's shotengai, a station's covered walk) comes in the open data as a building: a
long, thin footprint from OpenStreetMap (building=roof) or Project PLATEAU, extruded from
the ground. Drawn and walked that way it is a wall several hundred metres long down the
pavement, and it closes off whole blocks (central Kyoto between Shijo, Kawaramachi, Sanjo
and Shinkyogoku had no way in on foot).

A solid is taken for a canopy when its footprint is thin (twice its area over its
perimeter, its mean width, at most 6 m: an arcade's footprint takes in the wider squares where
two covered streets cross, as Ebisubashi-suji's does at Namba, 5.7 m), a mapped footway (game.json paths) runs inside
it along at least 60% of its length, and it is either mapped as a roof (class "roof") or
an unnamed PLATEAU footprint no taller than 20 m (a named or taller one is a building a
passage runs through: a department store, a station). Its solid then starts at a soffit
(min_dm) under its measured top (soffit_dm), and it is drawn as a
plain canopy (class "roof", style "plain": no windows, an underside; web/buildings.js),
and walked under (web/game/nav.js reads min_dm as every solid's).

A gate is the same: a gatehouse comes in the data as a building from the ground, so the
mapped path through it (Kyoto Gosho's Gishumon and Kenshunmon, Nijo Castle's Higashi Ote-mon)
runs into a wall, and a walled precinct has no way in. A building named as a gate (its name
ends in 門, or its class is "gate"), no bigger than 400 m2 and not a home, shop or hotel, that
a mapped footway crosses, starts at the height of its opening: 55% of its height, between
2.5 and 6 m, and at least 0.6 m under its eaves (gate_soffit_dm).

Any other roof (OpenStreetMap building=roof: a park's shelter, a station's or a bus stop's
canopy, a petrol station's roof, a shrine's open pavilion, a subway entrance's cover) is a roof
on posts too, wherever it stands, unless most of its footprint lies inside a taller building
(a roof mapped over a terrace or on top of a block: hidden, and nothing to walk under). Its
underside is open_soffit_dm, under its eaves when it has a pitched roof, and never lower than 2.2 m.
A roof whose height is no measurement at all (height_src "estimate" or "ml": build_scene.py
takes it from the buildings within 60 m, so a subway entrance's cover in Marunouchi came out
77 m tall) is held to what a canopy is: 4 m under 60 m2, else 8 m; and a small roof (under
60 m2) at most 8 m whatever its source (PLATEAU measures a tree over a shelter as its top).
Its fascia and posts take a dark timber or steel colour (FRAME), its roof keeps its own.

Rewrites web/data/<city>/buildings.json in place; running it again changes nothing.
"""
import argparse
import json
import os

import shapely
from shapely.geometry import LineString, Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDTH_M, ALONG, TALL_M = 6.0, 0.6, 20.0
SMALL_M2, SMALL_TOP_M, GUESS_SMALL_M, GUESS_M, MIN_CLEAR_DM = 60.0, 8.0, 4.0, 8.0, 22
GUESSED = {"estimate", "ml"}
FRAME = "#5b564f"  # a roof on posts: dark timber or painted steel, under a roof of its own colour


def roof_top_dm(meta, area_m2, top_dm):
    """A roof's top, held to a canopy's when it was never measured, or measured over a tree."""
    cap = (GUESS_SMALL_M if area_m2 < SMALL_M2 else GUESS_M) if meta[4] in GUESSED else (SMALL_TOP_M if area_m2 < SMALL_M2 else None)
    return min(top_dm, round(10 * cap)) if cap is not None else top_dm


def soffit_dm(height_m):
    """A canopy's underside: its roof at the measured top, a quarter of the height deep (0.5-3 m),
    and never lower than 2.5 m over the street."""
    return round(10 * max(2.5, height_m - max(0.5, min(3.0, 0.25 * height_m))))


def open_soffit_dm(height_m):
    """A roof on posts: a thinner one than an arcade's, its fascia 15% of its height (0.35-1.5 m) deep."""
    return round(10 * (height_m - max(0.35, min(1.5, 0.15 * height_m))))


def gate_soffit_dm(height_m, eave_m):
    """A gate's opening: 55% of its height (2.5-6 m), under its eaves; None when there is no headroom."""
    z = min(max(2.5, min(6.0, 0.55 * height_m)), eave_m - 0.6)
    return round(10 * z) if z >= 2.2 else None


GATE_CLASSES = {"", "yes", "roof", "gate", "shrine", "temple", "religious", "castle", "ruins", "historic"}


def is_gate(meta, P):
    name = (meta[0] or "").strip()
    return (meta[1] == "gate" or name.endswith("門")) and meta[1] in GATE_CLASSES and P.area <= 400


def open_roof(B, s, si, P, polys, solid_tree, eave, plain):
    """A roof from the ground (building=roof) lifted onto posts: True when it was changed."""
    for j in solid_tree.query(P):
        o = B["s"][j]
        if j != si and polys[j] is not None and B["b"][o[0]][1] != "roof" and o[2] <= 30 and o[3] >= s[3] - 10:
            if polys[j].intersection(P).area > 0.5 * P.area:
                return False  # inside a taller building: a roof over its terrace, or on top of it
    meta = B["b"][s[0]]
    if eave is None:  # (a pitched roof keeps the top its roof record was built to)
        top = roof_top_dm(meta, P.area, s[3])
        if top < s[3]:
            s[3] = top
            meta[2] = meta[9] = round(top / 10, 1)
    lo = open_soffit_dm(s[3] / 10)
    if eave is not None:
        lo = min(lo, eave - 5)
    if s[3] - lo < 3:
        lo = s[3] - 3
    if lo < MIN_CLEAR_DM:
        return False
    s[2] = lo
    if len(meta) > 7:
        meta[7] = FRAME  # its fascia and posts (web/buildings.js draws both in the wall's colour)
    if plain is not None and len(meta) > 10 and eave is None:
        meta[10] = plain
    return True


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
    eaves = {id(B["s"][r[0]]): r[2] for r in B.get("r", [])}  # a roofed solid's eaves, decimetres over its base
    polys = []
    for s in B["s"]:
        ring = s[4]
        try:
            P = Polygon([(ring[k] / 10, ring[k + 1] / 10) for k in range(0, len(ring), 2)],
                        [[(h[k] / 10, h[k + 1] / 10) for k in range(0, len(h), 2)] for h in s[5:] if len(h) >= 6])
            if not P.is_valid:
                P = P.buffer(0)
        except ValueError:
            P = None
        polys.append(None if P is None or P.is_empty else P)
    solid_tree = shapely.STRtree([P if P is not None else Polygon() for P in polys])
    for si, s in enumerate(B["s"]):
        bi = s[0]
        meta = B["b"][bi]
        height = (s[3] - s[2]) / 10
        P = polys[si]
        if P is None:
            continue
        if is_gate(meta, P) and s[2] == 0 and any(foot[i].crosses(P) for i in tree.query(P)):
            r = eaves.get(id(s))
            lo = gate_soffit_dm(height, (r - s[2]) / 10 if r is not None else height)
            if lo is not None and s[3] - lo >= 5:
                s[2] = lo
                meta[1] = "roof"
                n += 1
            continue
        roof = meta[1] == "roof"
        if P.length < 40 or 2 * P.area / P.length > WIDTH_M:
            if roof and s[2] == 0 and open_roof(B, s, si, P, polys, solid_tree, eaves.get(id(s)), plain):
                n += 1
            continue
        if s[2] > 0 and not roof:
            continue  # already raised: part of a building over a passage
        if not roof and (meta[0] or meta[6] or meta[5] != "P" or height > TALL_M):
            continue
        inside = sum(foot[i].intersection(P).length for i in tree.query(P))
        if inside < ALONG * P.length / 2:
            if roof and s[2] == 0 and open_roof(B, s, si, P, polys, solid_tree, eaves.get(id(s)), plain):
                n += 1
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
        print(f"{cid}: {mark(os.path.join(data, cid))} covered walkways and gates opened to walk under")


if __name__ == "__main__":
    main()
