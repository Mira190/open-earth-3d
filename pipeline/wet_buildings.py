"""Buildings out on the water that are not buildings: wharf decks and vessels (issue 65).

The open data maps some things that float or stand over the water as buildings, and drawn as
buildings they are white blocks with windows standing in the harbour:

- a wharf deck that a machine-learned footprint (Microsoft's, in Overture) took for a building:
  Garden Island's cruiser wharf in Sydney, a 2,440 m2 slab joined to the shore. Such a footprint,
  large (DECK_M2) and running onto the land (DECK_LAND_M, its mean width ashore), becomes a deck:
  it is added to the piers (pipeline/shore.py decks) and its solid is not drawn;
- the deck of a bridge or an elevated expressway that a machine-learned footprint took for a
  building: one BRIDGE_WET over the water and BRIDGE_COVER under a road Overture flags as a bridge
  or puts above the ground (Osaka's Hanshin loop over the Higashi-Yokobori). Its solid is not drawn:
  the game draws the deck (web/game/decks.js), and the viewer has the photograph of it;
- a building OpenStreetMap puts under the water (layer below 0, location=underground) that
  Overture does not mark underground: Amsterdam's Albert Cuypgarage, a car park under a canal. Not drawn;
- a vessel: OpenStreetMap's building=ship, boat, houseboat or barge (Sydney's museum ships at
  Darling Harbour, the Paris bateaux and peniches, Amsterdam's houseboats), floating=yes, a
  building class the city lists in water.floating, and any other machine-learned footprint out on
  the water (the boats moored along the Seine and the Sumida when the imagery was taken). It
  floats at the waterline and is drawn with a hull: a dark hull to its freeboard with a deck on
  it, and a lighter superstructure set in from the sides and shorter than the hull.

A building counts as out on the water when WET_SHARE of its footprint is in the city's water and
less than ON_PIER of it on a mapped pier (a houseboat when BOAT_SHARE is in the water, wherever
its outline falls) (a shed or a terminal on a pier stands on its deck, and
Hong Kong's ferry piers, building=yes on piles, stay buildings). OpenStreetMap's tags come from
its API for those buildings only, cached in data/raw/<id>/osm_wet_buildings.json.

    python pipeline/wet_buildings.py --city sydney     # or --city all; rewrites buildings.json

mark() rewrites a built city's web/data/<id>/buildings.json and scene.json in place (a deck's
solids are given no height and hidden, as a demolished building's are; a vessel's become its
hull, with its superstructure added as a new building at the end, so no index moves) and running
it again changes nothing. pipeline/build_scene.py leaves the decks out and floats the vessels in
the first place, then runs it; pipeline/refresh_piers.py runs it on a built city.
"""
import argparse
import json
import os
import time
import urllib.request

import duckdb
import numpy as np
import shapely
from shapely import affinity
from shapely import wkb as swkb
from shapely.geometry import Polygon, box

from cityctx import City, polygons

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.openstreetmap.org/api/0.6"
UA = "open-earth-3d (https://github.com/Mira190/open-earth-3d)"

WET_SHARE = 0.8      # this much of a footprint in the water: it is out on the water
ON_PIER = 0.5        # this much on a mapped pier: it stands on the pier's deck
BOAT_SHARE = 0.4     # a building classed a houseboat (or a city's floating class) this much in the water floats
DECK_M2 = 1000.0     # a machine-learned footprint this large, joined to the land, is a deck
DECK_LAND_M = 1.0    # joined to the land: the part ashore at least this wide on average
VESSEL_TAGS = {"ship", "boat", "houseboat", "barge"}
SHIP_M2 = 600.0      # a vessel this large is a ship: a higher freeboard and a superstructure amidships
HULL = ["#1f2a36", "#26282a", "#213a30", "#5a2626", "#2e3f56", "#2b2d33"]  # painted steel, dark
GREY = "#6c7277"     # a warship's
CABIN = ["#e7e3da", "#e7e3da", "#d9d2c3", "#efece6", "#6c5844", "#33493a"]  # white and cream; wood and green on houseboats
DECK = "#7c6d5b"     # the hull's top round the superstructure: worn timber and steel
HULL_CLASS, CABIN_CLASS = "vessel_hull", "vessel"
BRIDGE_WET = 0.2     # a machine-learned footprint this much over the water ...
BRIDGE_COVER = 0.5   # ... and this much under a bridge's or an elevated road's deck is that deck
LEAN_M = 2.5         # per level of a raised road: how far an aerial photograph may lean its deck
ROAD_HALF_M = {"motorway": 9.0, "trunk": 8.0, "primary": 7.0, "secondary": 6.0, "tertiary": 5.0}  # half a deck's width, a little generous


def rows(con, path, cols="*"):
    if not os.path.exists(path):
        return []
    cur = con.execute(f"SELECT {cols} FROM '{path}'")
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def _get(url):
    for k in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            return json.load(urllib.request.urlopen(req, timeout=120))
        except Exception as e:  # (the API is busy now and then: wait and ask again)
            if k == 4:
                raise
            print(f"  {e}: again in {2 ** k} s")
            time.sleep(2 ** k)


def _num(v):
    try:
        return float(str(v).strip())
    except ValueError:
        return None


def osm_tags(C, records):
    """OpenStreetMap tags by Overture record id ('w123@4', 'r456@2'), cached; {} where unknown.
    Without the network the cache (or nothing) is used: such buildings then go by Overture's class."""
    path = os.path.join(C.raw, "osm_wet_buildings.json")
    have = json.load(open(path)) if os.path.exists(path) else {}
    want = {}
    for rec in records:
        key = (rec or "").split("@")[0]
        if key[:1] in ("w", "r") and key[1:].isdigit() and key not in have:
            want.setdefault(key[0], []).append(key[1:])
    try:
        for kind, ids in want.items():
            name = {"w": "ways", "r": "relations"}[kind]
            for k in range(0, len(ids), 200):
                part = ids[k:k + 200]
                got = _get(f"{API}/{name}.json?{name}={','.join(part)}")
                for e in got.get("elements", []):
                    have[f"{kind}{e['id']}"] = e.get("tags") or {}
                for i in part:
                    have.setdefault(f"{kind}{i}", {})
                time.sleep(1)
    except Exception as e:  # offline: carry on with what is cached
        print(f"wet buildings: OpenStreetMap tags not fetched ({e}); going by Overture's classes")
        return {k: v for k, v in have.items()}
    if want:
        os.makedirs(C.raw, exist_ok=True)
        json.dump(have, open(path, "w"), sort_keys=True)
    return have


_seen = {}


def classify(C, con=None, raw=None, sea=None):
    """{Overture building id: {"kind": "deck" | "vessel", "geom", "ship", "height", "warship"}} for
    the buildings out on the water (module docstring). sea: the water polygons (build_scene.water_polygons)."""
    if C.id in _seen:  # (the build asks twice: for the piers and for the buildings)
        return _seen[C.id]
    _seen[C.id] = out = _classify(C, con, raw, sea)
    return out


def _classify(C, con, raw, sea):
    con = con or duckdb.connect()
    raw = raw or (lambda n: os.path.join(C.raw, f"overture_{n}.parquet"))
    if sea is None:
        from build_scene import water_polygons
        sea = water_polygons(C, con, raw, box(C.x0, C.y0, C.x1, C.y1))
    if not sea or not os.path.exists(raw("building")):
        return {}
    wet = shapely.union_all(sea)
    shapely.prepare(wet)
    piers = [p for r in rows(con, raw("infrastructure"), "class, wkb") if r["class"] == "pier"
             for p in polygons(C.to_local(swkb.loads(bytes(r["wkb"]))))]
    pier = shapely.union_all(piers) if piers else None
    floating = set(C.cfg.get("water", {}).get("floating", []))
    extent = box(C.x0, C.y0, C.x1, C.y1)
    out = {}
    # the decks of the bridges and elevated roads (Overture: is_bridge, or a level above the ground),
    # as wide as the road, for the machine-learned footprints that are one of them
    raised = []
    for r in rows(con, raw("segment"), "subtype, class, road_flags, level_rules, wkb"):
        if r["subtype"] != "road":
            continue
        if not (any("is_bridge" in (f.get("values") or []) for f in r["road_flags"] or []) or any((lv.get("value") or 0) > 0 for lv in r["level_rules"] or [])):
            continue
        # the photograph the footprint was traced from leans a raised deck off its plan, more the higher it is
        level = max([lv.get("value") or 0 for lv in r["level_rules"] or []] + [1])
        raised.append(C.to_local(swkb.loads(bytes(r["wkb"]))).buffer(ROAD_HALF_M.get(r["class"], 4.0) + LEAN_M * level, cap_style="flat"))
    raised_tree = shapely.STRtree(raised) if raised else None
    cand = []
    for r in rows(con, raw("building"), "id, class, src, record_id, height, height_src, is_underground, wkb"):
        if r["is_underground"]:
            continue
        g = C.to_local(swkb.loads(bytes(r["wkb"])))
        if g.is_empty or g.area < 8 or not extent.contains(g.centroid) or not wet.intersects(g):
            continue
        share = wet.intersection(g).area / g.area
        if r["src"] != "OpenStreetMap" and share >= BRIDGE_WET and raised_tree is not None:
            near = [raised[i] for i in raised_tree.query(g)]
            if near and shapely.union_all(near).intersection(g).area >= BRIDGE_COVER * g.area:
                out[r["id"]] = {"kind": "bridge", "geom": g}  # the deck of an expressway over a river (Osaka's Higashi-Yokobori)
                continue
        # a building the data calls a houseboat is one wherever its outline falls: half on a canal's mapped
        # edge, or over the jetty it is moored to (Amsterdam)
        boat = r["class"] in floating or r["class"] == "houseboat"
        osm = r["src"] == "OpenStreetMap"
        if share < (BOAT_SHARE if boat or osm else WET_SHARE):
            continue  # (OpenStreetMap's own buildings are looked up from BOAT_SHARE: a boat or a garage under a canal)
        if not boat and pier is not None and pier.intersects(g) and pier.intersection(g).area >= ON_PIER * g.area:
            continue
        cand.append((r, g, share))
    tags = osm_tags(C, [r["record_id"] for r, _, _ in cand if r["src"] == "OpenStreetMap"])
    for r, g, share in cand:
        osm = r["src"] == "OpenStreetMap"
        t = tags.get((r["record_id"] or "").split("@")[0], {}) if osm else {}
        mapped_h = r["height"] if r["height"] and r["height_src"] == "OpenStreetMap" else None
        if osm:
            if any((_num(x) or 0) < 0 for x in str(t.get("layer", "")).split(";") if x) or t.get("location") == "underground":
                out[r["id"]] = {"kind": "under", "geom": g}  # under the water: Amsterdam's Albert Cuypgarage, layer=-1
                continue
            if not (t.get("building") in VESSEL_TAGS or t.get("floating") == "yes" or t.get("seamark:type") == "hulk"
                    or r["class"] in floating or r["class"] == "houseboat"):
                continue
            if share < WET_SHARE and not (r["class"] in floating or r["class"] == "houseboat" or t.get("building") in VESSEL_TAGS):
                continue  # mapped as a building over the water: a pier terminal on piles, a pavilion
            ship = t.get("building") == "ship" or g.area >= SHIP_M2
            war = t.get("ship:type") in ("destroyer", "frigate", "patrol_boat", "submarine", "corvette", "cruiser") or "military" in t
            out[r["id"]] = {"kind": "vessel", "geom": g, "ship": ship, "height": mapped_h, "warship": war,
                            "houseboat": t.get("building") == "houseboat" or r["class"] == "houseboat"}
            continue
        ashore = [p for p in polygons(g.difference(wet)) if p.length > 0]
        land_w = max([2 * p.area / p.length for p in ashore] or [0.0])
        if g.area >= DECK_M2 and land_w >= DECK_LAND_M:
            out[r["id"]] = {"kind": "deck", "geom": g}
        else:
            out[r["id"]] = {"kind": "vessel", "geom": g, "ship": g.area >= SHIP_M2, "height": None, "warship": False, "houseboat": False}
    return out


def decks(C, con, raw, sea):
    """The deck polygons among the buildings out on the water (for shore.decks)."""
    return [q for o in classify(C, con, raw, sea).values() if o["kind"] == "deck" for q in polygons(o["geom"])]


# ------------------------------------------------------------------------- buildings.json
def _poly(s):
    rings = [[(r[k] / 10, r[k + 1] / 10) for k in range(0, len(r), 2)] for r in s[4:]]
    P = Polygon(rings[0], [h for h in rings[1:] if len(h) >= 3])
    return P if P.is_valid else P.buffer(0)


def _ring(coords):
    return [v for x, y in list(coords)[:-1] for v in (round(x * 10), round(y * 10))]


def superstructure(P, ship, houseboat):
    """The superstructure's footprint on a hull P: set in from the sides, and amidships on a ship."""
    rect = P.minimum_rotated_rectangle
    cs = np.asarray(rect.exterior.coords)[:4]
    e = [np.hypot(*(cs[(i + 1) % 4] - cs[i])) for i in range(2)]
    k = int(np.argmax(e))
    ang = np.degrees(np.arctan2(*(cs[(k + 1) % 4] - cs[k])[::-1]))
    length, width = max(e), min(e)
    inset = float(np.clip(0.12 * width, 0.35, 2.0))
    along = 0.5 if ship else 0.92 if houseboat else 0.72
    c = P.centroid
    q = affinity.rotate(affinity.scale(affinity.rotate(P, -ang, origin=c), along, 1.0, origin=c), ang, origin=c)
    q = q.intersection(P.buffer(-inset, join_style="mitre"))
    q = max(polygons(q), key=lambda p: p.area, default=None)
    if q is None or q.area < 4 or q.area < 0.15 * P.area:
        return None, length
    return shapely.geometry.polygon.orient(q.simplify(0.15), 1.0), length


def mark(C, wet=None):
    """Rewrite web/data/<id>/buildings.json and scene.json for the buildings out on the water:
    decks not drawn, vessels given a hull. Returns (decks, vessels)."""
    bpath, spath = os.path.join(C.out, "buildings.json"), os.path.join(C.out, "scene.json")
    if not os.path.exists(bpath):
        return 0, 0
    wet = classify(C) if wet is None else wet
    if not wet:
        return 0, 0
    B = json.load(open(bpath, encoding="utf8"))
    S = json.load(open(spath, encoding="utf8"))
    styles, shapes, srcs = B.get("styles", []), B.get("roof_shapes", []), B.get("roof_sources", [])
    plain = styles.index("plain") if "plain" in styles else 0
    flat = shapes.index("flat") if "flat" in shapes else 0
    rule = srcs.index("rule") if "rule" in srcs else None
    geoms, idx = [], []
    for k, s in enumerate(B["s"]):
        try:
            P = _poly(s)
        except (ValueError, IndexError):
            continue
        if not P.is_empty:
            geoms.append(P)
            idx.append(k)
    tree = shapely.STRtree(geoms)
    hidden = set(S.get("hidden_solids", []))
    done = {bi for bi, m in enumerate(B["b"]) if len(m) > 1 and m[1] in (HULL_CLASS, CABIN_CLASS)}
    drop, n_deck, n_vessel = set(), 0, 0
    for o in wet.values():
        g = o["geom"]
        # the solids that are this footprint, or a piece of it (PLATEAU and the survey cut footprints): mostly
        # inside it, so a real building a small footprint touches or sits within is left alone
        ks = [idx[i] for i in tree.query(g) if geoms[i].intersection(g).area >= 0.6 * geoms[i].area]
        if not ks:
            continue
        if o["kind"] in ("deck", "bridge", "under"):
            for k in ks:
                s = B["s"][k]
                if k not in hidden or s[3] != s[2]:
                    s[3] = s[2]
                    hidden.add(k)
                    drop.add(k)
                    n_deck += 1
            continue
        bis = {B["s"][k][0] for k in ks}
        if bis & done:
            continue
        P = shapely.union_all([geoms[idx.index(k)] for k in ks])
        P = max(polygons(P), key=lambda p: p.area)
        cabin, length = superstructure(P, o["ship"], o.get("houseboat"))
        free = float(np.clip(0.055 * length, 2.0, 4.0)) if o["ship"] else 0.9 if o.get("houseboat") else 1.2
        if o.get("height"):
            top = max(o["height"], free + 1.8)
        else:
            top = free + (float(np.clip(0.07 * length, 3.0, 9.0)) if o["ship"] else 2.4)
        bi = min(bis)
        meta = B["b"][bi]
        seed = int(meta[14]) if len(meta) > 14 and isinstance(meta[14], (int, float)) else bi
        # the hull: every solid of the building, floating at the waterline to its freeboard
        for k in ks:
            s = B["s"][k]
            s[1], s[2], s[3] = 0, 0, round(free * 10)
            drop.add(k)
        for b in bis:
            m = B["b"][b]
            m[1], m[2], m[3] = HULL_CLASS, round(free, 1), 0
            m[7], m[8] = GREY if o.get("warship") else HULL[seed % len(HULL)], DECK
            if len(m) > 16:
                m[10], m[11], m[12], m[15] = plain, round(free, 2), round(free, 2), flat
                if rule is not None:
                    m[16] = rule
        # the superstructure: a new building at the end
        if cabin is not None:
            c = list(meta)
            c[1], c[2], c[3] = CABIN_CLASS, round(top, 1), 0
            c[7] = "#8a9096" if o.get("warship") else CABIN[(seed // 7) % (len(CABIN) if o.get("houseboat") else 4)]
            c[8] = "#9a9c9c"
            if len(c) > 16:
                c[10], c[11], c[12], c[15] = plain, round(top - free, 2), round(top - free, 2), flat
                if rule is not None:
                    c[16] = rule
            B["b"].append(c)
            B["s"].append([len(B["b"]) - 1, 0, round(free * 10), round(top * 10), _ring(cabin.exterior.coords)])
        n_vessel += 1
    if drop:
        # no pitched roof, shopfront or rooftop plant on a hull or a deck
        B["r"] = [r for r in B.get("r", []) if r[0] not in drop]
        for key in ("f", "p"):
            if key in B:
                B[key] = [row for row in B[key] if row[0] not in drop]
    if n_deck or n_vessel:
        S["hidden_solids"] = sorted(hidden)
        with open(bpath, "w") as f:
            json.dump(B, f, separators=(",", ":"))
        with open(spath, "w") as f:
            json.dump(S, f, separators=(",", ":"))
    return n_deck, n_vessel


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--city", required=True, help="a city id, or all")
    a = ap.parse_args()
    ids = [e["id"] for e in json.load(open(os.path.join(ROOT, "cities", "index.json")))["cities"]] if a.city == "all" else [a.city]
    for cid in ids:
        C = City(cid)
        if not os.path.exists(os.path.join(C.raw, "overture_building.parquet")):
            print(f"{cid}: no Overture buildings in {C.raw} (fetch_overture.py --only building water land infrastructure)")
            continue
        d, v = mark(C)
        print(f"{cid}: {d} deck solids hidden, {v} vessels given a hull")


if __name__ == "__main__":
    main()
