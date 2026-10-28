"""Two data traps a "just use the open data" city model falls into, measured.

1. Overture building heights are mostly Microsoft ML estimates. Where a
   building also has an OpenStreetMap floor count, compare the two.
2. Global terrain tiles (AWS Terrarium) can be a surface model in a city centre:
   they include the buildings. Compare them with the city's bare-earth DEM on
   land in its analysis region, under buildings and on open ground, and at its
   check points.

    python analysis/data_quality.py --city sydney      # -> cities/<city>/analysis/data_quality.json
"""
import json
import os
import statistics as st
import sys

import duckdb
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))
from build_scene import DEM_CELL, Heights, load_dem, sample  # noqa: E402
from cityctx import city_args  # noqa: E402
from fetch_tiles import tile_xy  # noqa: E402


def ml_vs_floors(C, con):
    H = Heights(C.cfg)
    bld = f"'{C.raw}/overture_building.parquet'"
    rows = con.execute(f"""SELECT height, num_floors, class FROM {bld}
        WHERE height_src = 'Microsoft ML Buildings' AND height > 0 AND num_floors >= 3""").fetchall()
    ratio = [h / H.storey_height(c or "", f) for h, f, c in rows]
    tall = [h / H.storey_height(c or "", f) for h, f, c in rows if f >= 15]
    tot = con.execute(f"SELECT count(*), count(height), count(CASE WHEN height_src = 'Microsoft ML Buildings' AND height IS NOT NULL THEN 1 END) FROM {bld}").fetchone()
    return {
        "buildings": tot[0], "with_height": tot[1], "height_is_ml": tot[2],
        "ml_with_floor_count": len(rows),
        "median_ml_over_floor_height": round(st.median(ratio), 2) if ratio else None,
        "share_ml_below_half": round(sum(r < 0.5 for r in ratio) / len(ratio), 2) if ratio else None,
        "towers_15_floors_plus": len(tall),
        "towers_median_ml_over_floor_height": round(st.median(tall), 2) if tall else None,
    }


def terrarium_vs_dem(C):
    meta = json.load(open(os.path.join(C.raw, "dem.json")))
    if meta.get("source") == "terrarium":
        return {"skipped": "the city's terrain is Terrarium itself; there is no bare-earth DEM to compare with"}
    dem = load_dem(C)
    tiles = {}

    def terr_at(lon, lat, z=15):
        x, y = tile_xy(lon, lat, z)
        key = (int(x), int(y))
        if key not in tiles:
            tiles[key] = np.asarray(Image.open(os.path.join(C.raw, "terrarium", str(z), f"{key[0]}_{key[1]}.png")).convert("RGB")).astype(float)
        r, g, b = tiles[key][int((y % 1) * 256), int((x % 1) * 256)]
        return r * 256 + g + b / 256 - 32768

    def dem_at(lon, lat):
        x, y = C.fwd.transform(lon, lat)
        return float(sample(C, dem, x, y)[0])

    # land in the analysis region (the dense core), every 25 m, split into points
    # under a building footprint and open ground: a bare-earth model has no excess
    # on either, a surface model has a large one under buildings
    B = json.load(open(os.path.join(C.out, "buildings.json")))
    img = Image.new("L", (dem.shape[1], dem.shape[0]), 0)
    d = ImageDraw.Draw(img)
    for s in B["s"]:
        pts = [((s[4][k] / 10 - C.x0) / DEM_CELL, (C.y1 - s[4][k + 1] / 10) / DEM_CELL) for k in range(0, len(s[4]), 2)]
        if len(pts) >= 3:
            d.polygon(pts, fill=1)
    built = np.asarray(img, bool)
    x0, x1, y0, y1 = C.cfg.get("analysis_region", C.cfg["extent_m"])
    diffs = {"built": [], "open": []}
    for y in np.arange(y0, y1, 25.0):
        for x in np.arange(x0, x1, 25.0):
            r, c = int(round((C.y1 - y) / DEM_CELL)), int(round((x - C.x0) / DEM_CELL))
            if dem[r, c] <= 1.0:
                continue  # water
            lon, lat = C.inv.transform(x, y)
            diffs["built" if built[r, c] else "open"].append(terr_at(lon, lat) - float(dem[r, c]))
    stats = lambda v: {"samples": len(v), "median_excess_m": round(st.median(v), 1), "p90_excess_m": round(float(np.percentile(v, 90)), 1)} if v else None
    pts = C.cfg.get("check_points", {})
    return {
        "region_m": [x0, x1, y0, y1],
        "land": stats(diffs["built"] + diffs["open"]), "under_buildings": stats(diffs["built"]), "open_ground": stats(diffs["open"]),
        "points": {k: {"terrarium_m": round(terr_at(*v), 1), "dem_m": round(dem_at(*v), 1)} for k, v in pts.items()},
    }


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    con = duckdb.connect()
    out = {"ml_heights": ml_vs_floors(C, con), "terrain": terrarium_vs_dem(C)}
    json.dump(out, open(os.path.join(C.analysis, "data_quality.json"), "w"), indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
