"""Measure Lake Pukaki's landmarks for the Blender models (blender/build_pukaki.py): footprints and the Hooker Valley's
footbridges from OpenStreetMap (read through Overture Maps), heights from LINZ's 1 m LiDAR (DSM minus DEM, CC BY 4.0).
Writes cities/lake-pukaki/analysis/landmarks.json.

    python pipeline/pukaki_landmarks.py

The same measures as Lake Tekapo's (pipeline/tekapo_landmarks.py): each footprint in its landmark's own frame (metres,
x east, y north, on the point in city.json `landmarks`), the ground under it, the highest point above that ground and
the median roof. A bridge: its ends, its span, the banks' heights at its ends from the DEM and the lowest water under it.
"""
import json
import os
import sys

import duckdb
import numpy as np
from pyproj import Transformer
from shapely.geometry import shape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tekapo_landmarks import NZ, RELEASE, buildings, lidar, local, measure  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CITY = os.path.join(ROOT, "cities", "lake-pukaki")


def overture(theme, kind, cols, lon0, lat0, lon1, lat1, where="TRUE"):
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("CREATE OR REPLACE SECRET anon (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2');")
    q = f"""SELECT {cols}, ST_AsGeoJSON(geometry) FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme={theme}/type={kind}/*', hive_partitioning=1)
      WHERE bbox.xmin > {lon0} AND bbox.xmax < {lon1} AND bbox.ymin > {lat0} AND bbox.ymax < {lat1} AND {where}"""
    return con.execute(q).fetchall()


def bridges(lon, lat, r=0.004):
    """Footway segments flagged as bridges near a point: the bridged part of each, as lon/lat points."""
    out = []
    for sid, name, cls, flags, g in overture("transportation", "segment", "id, names.primary, class, road_flags", lon - r, lat - r, lon + r, lat + r,
                                             "subtype = 'road'"):
        geom = shape(json.loads(g))
        for f in flags or []:
            if "is_bridge" not in (f.get("values") or []):
                continue
            a, b = (f.get("between") or [0, 1])
            pts = [geom.interpolate(t, normalized=True) for t in np.linspace(a, b, 24)]
            out.append({"id": sid, "name": name, "class": cls, "pts": [(p.x, p.y) for p in pts]})
    return out


def bridge(lon, lat, near):
    """The bridge nearest the point: its ends and centreline in the landmark's frame, its span, the DEM at its ends
    (the banks) and the lowest DEM under it (the river), and the DSM along it (a swing bridge's deck is a thin line the
    1 m DSM catches only in part)."""
    to = local(lon, lat)
    cands = bridges(lon, lat)
    if not cands:
        return None
    best = min(cands, key=lambda b: min(np.hypot(*np.subtract(to.transform(*p), (0, 0))) for p in b["pts"]))
    loc = [to.transform(*p) for p in best["pts"]]
    span = float(sum(np.hypot(loc[i + 1][0] - loc[i][0], loc[i + 1][1] - loc[i][1]) for i in range(len(loc) - 1)))
    R = int(span / 2 + 25)
    S, D, T = lidar(lon, lat, R)
    back = Transformer.from_crs(to.target_crs, 4326, always_xy=True)
    def at(A, x, y):
        X, Y = NZ.transform(*back.transform(x, y))
        c, r = ~T * (X, Y)
        return float(A[int(r), int(c)])
    dem = [at(D, x, y) for x, y in loc]
    dsm = [at(S, x, y) for x, y in loc]
    return {"overture_id": best["id"], "name": best["name"], "ends": [[round(v, 2) for v in loc[0]], [round(v, 2) for v in loc[-1]]],
            "line": [[round(x, 2), round(y, 2)] for x, y in loc], "span_m": round(span, 1),
            "bank_m": [round(dem[0], 2), round(dem[-1], 2)], "river_m": round(min(dem), 2),
            "dsm_profile_m": [round(v, 2) for v in dsm], "dem_profile_m": [round(v, 2) for v in dem]}


def main():
    cfg = json.load(open(os.path.join(CITY, "city.json")))
    P = {p["id"]: p for p in cfg["pois"]}
    out = {"note": "Measured by pipeline/pukaki_landmarks.py: footprints and bridges from OpenStreetMap via Overture Maps " + RELEASE
                   + " (ODbL), heights from LINZ's New Zealand LiDAR 1 m DSM and DEM (CC BY 4.0, national composites). Rings are in"
                   " each landmark's local frame (m, x east, y north). top_m is the highest DSM point above the median DEM ground under"
                   " the footprint; roof_m the median height over the footprint.", "landmarks": {}}
    # the buildings: the Hermitage, the visitor centre, the salmon shop (their names in OpenStreetMap)
    for key, poi, names, r in (("hermitage", "hermitage", ("The Hermitage hotel", "The Hermitage"), 200),
                               ("visitor-centre", "visitor-centre", ("Lake Pukaki Information Centre", "Lake Pukaki Visitor Centre"), 40),
                               ("salmon-shop", "salmon-shop", ("Mt Cook Alpine Salmon",), 40)):
        lon, lat = P[poi]["lonlat"]
        d = r / 111000
        bs = buildings(lon - d * 1.4, lat - d, lon + d * 1.4, lat + d)
        b = [b for b in bs if b["name"] in names]
        if not b:
            print("no footprint for", key, [x["name"] for x in bs]); continue
        S, D, T = lidar(lon, lat, r)
        m = measure(max(b, key=lambda x: x["geom"].area), S, D, T, local(lon, lat))
        m["lonlat"] = [lon, lat]
        # the Hermitage's neighbours on its terrace (its wings are separate footprints in OpenStreetMap)
        if key == "hermitage":
            to = local(lon, lat)
            wings = [measure(x, S, D, T, to) for x in bs if x is not b[0] and x["geom"].distance(b[0]["geom"]) < 0.0004]
            m["neighbours"] = [w for w in wings if w]
            # the height over every square metre of the hotel and its attached wings (DSM - DEM), for the model's
            # massing, in the landmark's frame, where the height is over 2 m
            import rasterio.features
            import shapely
            from shapely.ops import unary_union
            parts = unary_union([b[0]["geom"]] + [x["geom"] for x in bs if x is not b[0] and x["geom"].distance(b[0]["geom"]) < 0.00002])
            g_nz = shapely.transform(parts, lambda c: np.column_stack(NZ.transform(c[:, 0], c[:, 1])))
            mask = rasterio.features.geometry_mask([g_nz], S.shape, T, invert=True)
            rr, cc = np.nonzero(mask & ((S - D) > 2.0))
            X, Y = T * (cc + 0.5, rr + 0.5)
            lo, la = Transformer.from_crs(2193, 4326, always_xy=True).transform(X, Y)
            lx, ly = to.transform(lo, la)
            g0 = float(np.median(D[mask]))
            m["cells_ground_m"] = round(g0, 2)
            # [x, y, height over the DEM in decimetres, the DEM less cells_ground_m in decimetres]
            m["cells"] = [[round(float(x), 2), round(float(y), 2), int(round(float(h) * 10)), int(round((float(g) - g0) * 10))]
                          for x, y, h, g in zip(lx, ly, (S - D)[rr, cc], D[rr, cc])]
        out["landmarks"][key] = m
    # the tahr statue: a place in Overture if there is one; its ground and height from the LiDAR
    lon, lat = P["visitor-centre"]["lonlat"]
    rows = overture("places", "place", "id, names.primary", lon - 0.006, lat - 0.004, lon + 0.006, lat + 0.004, "lower(names.primary) LIKE '%tahr%'")
    out["landmarks"]["tahr-statue"] = {"overture": [{"id": i, "name": n, "lonlat": shape(json.loads(g)).coords[0]} for i, n, g in rows]}
    # the Hooker Valley's three footbridges
    for key in ("lower-hooker-bridge", "hooker-bluff-bridge", "upper-hooker-bridge"):
        lon, lat = P[key]["lonlat"]
        b = bridge(lon, lat, P[key])
        if b:
            b["lonlat"] = [lon, lat]
        out["landmarks"][key] = b
        print(key, b and b["span_m"])
    os.makedirs(os.path.join(CITY, "analysis"), exist_ok=True)
    path = os.path.join(CITY, "analysis", "landmarks.json")
    json.dump(out, open(path, "w"), indent=1)
    print(path)


if __name__ == "__main__":
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    if os.path.exists("/root/.ccr/ca-bundle.crt"):
        os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")
    main()
