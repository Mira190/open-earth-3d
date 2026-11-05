"""Measure Lake Tekapo's landmarks for the Blender models (blender/build_tekapo.py): footprints from
OpenStreetMap (read through Overture Maps), heights from LINZ's 1 m LiDAR (DSM minus DEM, CC BY 4.0).
Writes cities/lake-tekapo/analysis/landmarks.json.

    python pipeline/tekapo_landmarks.py

Each landmark's footprint is in its own local frame (metres, x east, y north, on the landmark's
lon/lat in city.json `landmarks`), with the ground under it, the highest point above that ground,
and, for the observatory's buildings, where the highest point is (a dome's crown) and the height of
the rest of the roof.
"""
import json
import os

import duckdb
import numpy as np
import rasterio
import rasterio.features
import shapely
from pyproj import Transformer
from shapely.geometry import shape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CITY = os.path.join(ROOT, "cities", "lake-tekapo")
LIDAR = "https://nz-elevation.s3.ap-southeast-2.amazonaws.com/new-zealand/new-zealand/{kind}_1m/2193/{sheet}.tiff"
RELEASE = "2026-10-21.0"
NZ = Transformer.from_crs(4326, 2193, always_xy=True)


def local(lon, lat):
    return Transformer.from_crs(4326, f"+proj=tmerc +lat_0={lat} +lon_0={lon} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs",
                                always_xy=True)


def sheet(x, y):
    """The NZ Topo50 sheet of an NZTM point (24 x 36 km tiles; BX16's corner is E 1372000 N 5190000)."""
    col, row = int((x - 1372000) // 24000), int((5190000 - y) // 36000)
    return ["BW", "BX", "BY", "BZ", "CA"][row + 1] + str(16 + col)


def lidar(lon, lat, r):
    """DSM and DEM windows (2r+1 m square) around a point, and the window's NZTM transform."""
    x, y = NZ.transform(lon, lat)
    out = {}
    for kind in ("dsm", "dem"):
        with rasterio.open("/vsicurl/" + LIDAR.format(kind=kind, sheet=sheet(x, y))) as d:
            row, col = d.index(x, y)
            win = ((row - r, row + r + 1), (col - r, col + r + 1))
            out[kind] = d.read(1, window=win).astype(np.float64)
            out["T"] = d.window_transform(win)
    return out["dsm"], out["dem"], out["T"]


def buildings(lon0, lat0, lon1, lat1):
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("CREATE OR REPLACE SECRET anon (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2');")
    q = f"""SELECT id, names.primary, sources[1].dataset, ST_AsGeoJSON(geometry)
      FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=buildings/type=building/*', hive_partitioning=1)
      WHERE bbox.xmin > {lon0} AND bbox.xmax < {lon1} AND bbox.ymin > {lat0} AND bbox.ymax < {lat1}"""
    return [{"id": i, "name": n, "src": s, "geom": shape(json.loads(g))} for i, n, s, g in con.execute(q).fetchall()]


def measure(b, S, D, T, to_local):
    g_nz = shapely.transform(b["geom"], lambda c: np.column_stack(NZ.transform(c[:, 0], c[:, 1])))
    g_lo = shapely.transform(b["geom"], lambda c: np.column_stack(to_local.transform(c[:, 0], c[:, 1])))
    m = rasterio.features.geometry_mask([g_nz], S.shape, T, invert=True)
    if m.sum() < 2:
        return None
    h = np.where(m, S - D, np.nan)
    ground = float(np.nanmedian(np.where(m, D, np.nan)))
    k = np.nanargmax(h)
    r, c = np.unravel_index(k, h.shape)
    px, py = T * (c + 0.5, r + 0.5)
    lon, lat = Transformer.from_crs(2193, 4326, always_xy=True).transform(px, py)
    cx, cy = to_local.transform(lon, lat)
    rect = list(g_lo.minimum_rotated_rectangle.exterior.coords)
    dims = sorted(float(np.hypot(rect[i + 1][0] - rect[i][0], rect[i + 1][1] - rect[i][1])) for i in range(2))
    return {"id": b["id"], "name": b["name"], "src": b["src"],
            "ring": [[round(x, 2), round(y, 2)] for x, y in g_lo.exterior.coords][:-1],
            "area_m2": round(g_lo.area, 1), "dims_m": [round(v, 1) for v in dims],
            "round": round(4 * np.pi * g_lo.area / g_lo.length ** 2, 2),
            "ground_m": round(ground, 1), "top_m": round(float(np.nanmax(h)), 1),
            "roof_m": round(float(np.nanpercentile(h, 50)), 1),
            "top_at": [round(cx, 1), round(cy, 1)]}


def main():
    cfg = json.load(open(os.path.join(CITY, "city.json")))
    L = {l["id"]: l for l in cfg["landmarks"]}
    out = {"note": "Measured by pipeline/tekapo_landmarks.py: footprints from OpenStreetMap via Overture Maps " + RELEASE
                   + " (ODbL), heights from LINZ's New Zealand LiDAR 1 m DSM and DEM (CC BY 4.0; national composites, sheet BY17 from the"
                   " 2015 Mackenzie capture). Rings are in each landmark's local frame (m, x east, y north). top_m is the highest DSM"
                   " point above the median DEM ground under the footprint; roof_m the median height over the footprint.",
           "landmarks": {}}

    # the church: its footprint, ridge height, and the profile along its long axis
    lon, lat = L["church-good-shepherd"]["lonlat"]
    S, D, T = lidar(lon, lat, 14)
    bs = [b for b in buildings(lon - 0.0004, lat - 0.0003, lon + 0.0004, lat + 0.0003) if b["name"] == "Church of the Good Shepherd"]
    out["landmarks"]["church-good-shepherd"] = measure(bs[0], S, D, T, local(lon, lat))

    # the sheepdog statue: no footprint; the object's height over its 4 m neighbourhood
    lon, lat = L["sheepdog-statue"]["lonlat"]
    S, D, T = lidar(lon, lat, 3)
    out["landmarks"]["sheepdog-statue"] = {"ground_m": round(float(np.median(D)), 1), "top_m": round(float((S - D).max()), 1)}

    # the footbridge: span from the OpenStreetMap way, deck height from the DSM along it
    lon, lat = L["footbridge"]["lonlat"]
    a, b = (170.4802444, -44.0048895), (170.4818887, -44.0049085)   # the MacLaren Footbridge way's end nodes (OSM, via Overture)
    to = local(lon, lat)
    ax, ay = to.transform(*a)
    bx, by = to.transform(*b)
    S, D, T = lidar(lon, lat, 75)
    xs = np.linspace(0, 1, 60)
    prof = []
    for t in xs:
        plon, plat = Transformer.from_crs(to.target_crs, 4326, always_xy=True).transform(ax + (bx - ax) * t, ay + (by - ay) * t)
        X, Y = NZ.transform(plon, plat)
        c, r = ~T * (X, Y)
        prof.append(float(S[int(r), int(c)]))
    out["landmarks"]["footbridge"] = {"ends": [[round(ax, 2), round(ay, 2)], [round(bx, 2), round(by, 2)]],
                                      "span_m": round(float(np.hypot(bx - ax, by - ay)), 1),
                                      "dsm_profile_m": [round(v, 2) for v in prof],
                                      "water_m": round(float(np.percentile(D, 5)), 2)}

    # the observatory: every building on the summit
    lon, lat = L["mt-john-observatory"]["lonlat"]
    S, D, T = lidar(lon, lat, 320)
    to = local(lon, lat)
    obs = [measure(b, S, D, T, to) for b in buildings(lon - 0.0045, lat - 0.0035, lon + 0.0045, lat + 0.0035)]
    out["landmarks"]["mt-john-observatory"] = {"ground_m": round(float(D[320, 320]), 1),
                                               "buildings": sorted([o for o in obs if o], key=lambda o: -o["area_m2"])}

    os.makedirs(os.path.join(CITY, "analysis"), exist_ok=True)
    path = os.path.join(CITY, "analysis", "landmarks.json")
    json.dump(out, open(path, "w"), indent=1)
    print(path)


if __name__ == "__main__":
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    if os.path.exists("/root/.ccr/ca-bundle.crt"):
        os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")
    main()
