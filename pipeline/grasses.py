"""Where a city's grasses grow, from open data: the outlines web/world.js plants a grass over (places.json "grass").

A grass is one of the shared trees that are grasses (blender/build_trees.py: tussock, susuki, lomandra). Its settings in
cities/<id>/city.json trees.<species> say where, as rules over Overture's base land and land use (OpenStreetMap, ODbL):

    "open": [{"land": ["scrub", "grassland"],   # Overture base land classes (natural=*) ...
              "land_use": ["meadow"],            # ... and/or land use classes (landuse=*, leisure=*)
              "near_water_m": 10,                # only where it comes within this far of a river, canal or stream
              "within": "Barangaroo Reserve",    # only inside this place (places.json, by name)
              "min_m2": 20,                      # leave out the smaller pieces
              "per_ha": 2500}]                   # clumps a hectare (web/world.js)

The outlines are the polygons (or their parts inside the place, or the parts near the water) inside the city's frame,
less the water itself, simplified to half a metre: places.json "grass" {species: [{per_ha, polygons}]} in decimetre
rings as "places". build_scene.py keeps the key when it writes places.json again; run python pipeline/pack.py after.

    python pipeline/grasses.py --city kyoto
"""
import json
import os

import duckdb
import shapely
from shapely import wkb as swkb

from cityctx import city_args, polygons

GRASSES = ("tussock", "susuki", "lomandra")


def ring(coords):
    a = list(coords)[:-1]
    return [int(round(v * 10)) for xy in a for v in xy]


def fetch(city):
    """Overture's land, land use and water over the city's bounding box: cached in data/raw/<id>/grass_overture.json."""
    path = os.path.join(city.raw, "grass_overture.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf8"))
    b = city.cfg["bbox"]
    root = f"s3://overturemaps-us-west-2/release/{city.cfg['overture_release']}"
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("CREATE OR REPLACE SECRET anon (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2');")
    out = []
    for theme in ("land", "land_use", "water"):
        q = (f"SELECT id, names.primary, subtype, class, ST_AsWKB(geometry) FROM read_parquet('{root}/theme=base/type={theme}/*', hive_partitioning=1)"
             f" WHERE bbox.xmin < {b[2]} AND bbox.xmax > {b[0]} AND bbox.ymin < {b[3]} AND bbox.ymax > {b[1]}")
        for r in con.execute(q).fetchall():
            g = swkb.loads(bytes(r[4]))
            if g.geom_type in ("Polygon", "MultiPolygon"):
                out.append({"theme": theme, "id": r[0], "name": r[1], "subtype": r[2], "class": r[3], "wkt": shapely.to_wkt(g, rounding_precision=7)})
    os.makedirs(city.raw, exist_ok=True)
    json.dump(out, open(path, "w", encoding="utf8"))
    return out


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    trees = city.cfg.get("trees", {})
    want = {sp: trees[sp]["open"] for sp in GRASSES if isinstance(trees.get(sp), dict) and isinstance(trees[sp].get("open"), list)}
    ppath = os.path.join(city.out, "places.json")
    P = json.load(open(ppath, encoding="utf8"))
    if not want:
        if P.pop("grass", None) is not None:
            json.dump(P, open(ppath, "w", encoding="utf8"), separators=(",", ":"))
        print("no grass from open data in", city.id)
        return
    feats = [dict(f, geom=city.to_local(shapely.from_wkt(f["wkt"]))) for f in fetch(city)]
    frame = shapely.box(city.x0, city.y0, city.x1, city.y1)
    water_all = shapely.union_all([f["geom"] for f in feats if f["theme"] == "water"]).buffer(0)
    rivers = shapely.union_all([f["geom"] for f in feats if f["theme"] == "water" and f["subtype"] in ("river", "canal", "stream")]).buffer(0)
    place_geom = {}
    for p in P.get("places", []):
        gs = [shapely.Polygon([(r[i] / 10, r[i + 1] / 10) for i in range(0, len(r), 2)], [[(h[i] / 10, h[i + 1] / 10) for i in range(0, len(h), 2)] for h in poly[1:]])
              for poly in p["polygons"] for r in poly[:1]]
        place_geom[p["name"]] = shapely.union_all(gs).buffer(0)
    grass = {}
    for sp, rules in want.items():
        grass[sp] = []
        for rule in rules:
            pick = [f["geom"] for f in feats if (f["theme"] == "land" and f["class"] in rule.get("land", []))
                    or (f["theme"] == "land_use" and f["class"] in rule.get("land_use", []))]
            g = shapely.union_all(pick).buffer(0).intersection(frame) if pick else shapely.Polygon()
            if rule.get("within"):
                if rule["within"] not in place_geom:
                    print(f"  {sp}: place {rule['within']!r} not in places.json")
                    continue
                g = g.intersection(place_geom[rule["within"]])
            if rule.get("near_water_m") is not None:
                g = g.intersection(rivers.buffer(rule["near_water_m"]))
            g = g.difference(water_all)
            polys = [q.simplify(0.5) for q in polygons(g) if q.area >= rule.get("min_m2", 20)]
            polys = [q for q in polys if q.is_valid and not q.is_empty and q.geom_type == "Polygon"]
            area = sum(q.area for q in polys)
            print(f"  {sp}: {len(polys)} outlines, {area:,.0f} m2 at {rule.get('per_ha', 1500)}/ha (~{area / 1e4 * rule.get('per_ha', 1500):,.0f} clumps)"
                  f" from {'+'.join(rule.get('land', []) + rule.get('land_use', []))}")
            if polys:
                grass[sp].append({"per_ha": rule.get("per_ha", 1500), "area_m2": round(area),
                                  "polygons": [[ring(q.exterior.coords)] + [ring(r.coords) for r in q.interiors] for q in polys]})
    old = P.get("grass")
    P["grass"] = {k: v for k, v in grass.items() if v}
    if not P["grass"]:
        del P["grass"]
    if P.get("grass") == old:
        print("unchanged:", ppath)
        return
    json.dump(P, open(ppath, "w", encoding="utf8"), separators=(",", ":"))
    print("->", ppath)


if __name__ == "__main__":
    main()
