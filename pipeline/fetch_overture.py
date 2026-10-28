"""Buildings, building parts, water, land, land use, piers, addresses and roads
for a city's bounding box from Overture Maps (anonymous S3 read with DuckDB).

Overture buildings are mostly OpenStreetMap footprints (ODbL) with some
Microsoft ML footprints (ODbL); most of the few heights it carries are
Microsoft ML estimates (height_src says which). Base water, land, land use and
infrastructure are OSM-derived; addresses come from Overture's address theme.

    python pipeline/fetch_overture.py --city sydney

If your environment injects AWS credentials, unset them first, e.g.
    env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN python ...
"""
import os
import time

import duckdb

from cityctx import city_args

COMMON = """id, names.primary AS name, height, min_height, num_floors, min_floor, roof_shape, roof_height,
  roof_direction, roof_color, roof_material, facade_color, facade_material, is_underground,
  sources[1].dataset AS src, sources[1].record_id AS record_id,
  coalesce(list_filter(sources, lambda s: s.property = '/properties/height')[1].dataset, sources[1].dataset) AS height_src,
  ST_AsWKB(geometry) AS wkb"""


def queries(root):
    base = lambda t: f"read_parquet('{root}/theme={t}/*', hive_partitioning=1)"
    simple = "id, names.primary AS name, class, subtype, ST_AsWKB(geometry) AS wkb"
    return {
        "building": f"SELECT {COMMON}, class, subtype, has_parts FROM {base('buildings/type=building')}",
        "building_part": f"SELECT {COMMON}, building_id FROM {base('buildings/type=building_part')}",
        "water": f"SELECT {simple} FROM {base('base/type=water')}",
        "land": f"SELECT {simple} FROM {base('base/type=land')}",
        "land_use": f"SELECT {simple} FROM {base('base/type=land_use')}",
        "infrastructure": f"SELECT {simple} FROM {base('base/type=infrastructure')}",
        "address": f"SELECT id, number, street, unit, postcode, ST_AsWKB(geometry) AS wkb FROM {base('addresses/type=address')}",
        "segment": f"SELECT {simple} FROM {base('transportation/type=segment')}",
    }


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    city.ensure_dirs()
    root = f"s3://overturemaps-us-west-2/release/{city.cfg['overture_release']}"
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("CREATE OR REPLACE SECRET anon (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2');")
    w, s, e, n = city.cfg["bbox"]
    # intersects the bbox (not contained): edge features are clipped later
    where = f" WHERE bbox.xmax > {w} AND bbox.xmin < {e} AND bbox.ymax > {s} AND bbox.ymin < {n}"
    for name, q in queries(root).items():
        t = time.time()
        extra = " AND (subtype IN ('road', 'rail'))" if name == "segment" else ""
        path = os.path.join(city.raw, f"overture_{name}.parquet")
        con.execute(f"COPY ({q}{where}{extra}) TO '{path}' (FORMAT parquet)")
        cnt = con.execute(f"SELECT count(*) FROM '{path}'").fetchone()[0]
        print(f"{name}: {cnt} features in {time.time() - t:.0f} s -> {path}")


if __name__ == "__main__":
    main()
