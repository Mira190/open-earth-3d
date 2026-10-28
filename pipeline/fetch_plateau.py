"""Measured building heights from Project PLATEAU (MLIT's open 3D city models, CC BY 4.0).

PLATEAU publishes every building of a city with a measured height, surveyed from aerial
photographs or laser data, as CityGML and as 3D Tiles. The 3D Tiles zip is the cheap way in:
each b3dm tile holds Draco-compressed building meshes and, in its batch table, each building's
`bldg:measuredHeight`. This script reads the tiles that touch the city's bounding box, takes
every building's footprint from its upward-facing triangles, and writes footprint + height to
data/raw/<city>/plateau_bldg.parquet. build_scene.py matches those footprints to Overture's.

city.json:
    "plateau": {"zip": "<url of the *_3dtiles-mvt_*.zip>", "source": "Project PLATEAU Kyoto City 2022 (CC BY 4.0)"}

    python pipeline/fetch_plateau.py --city kyoto
    python pipeline/fetch_plateau.py --city kyoto --zip /path/to/the.zip     # a copy you already have

The zip is large (Kyoto: 1.8 GB). It is downloaded once to data/raw/<city>/plateau_3dtiles.zip.

Frame: tiles are glTF y-up with a CESIUM_RTC centre in ECEF; the tile frame is rotated to z-up
(x, -z, y) and added to the centre, then converted to longitude, latitude and ellipsoidal height.
"""
import json
import math
import os
import re
import struct
import sys
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import DracoPy
import duckdb
import numpy as np
import requests
import shapely
from pyproj import Transformer
from shapely.geometry import Polygon

from cityctx import city_args

ECEF_TO_LL = Transformer.from_crs("EPSG:4978", "EPSG:4326", always_xy=True)
LEVELS = ("lod1", "lod2_no_texture", "lod2")  # prefer the smallest tiles that carry heights


def download(url, path):
    """Stream a large file to disk, resuming a partial download."""
    have = os.path.getsize(path) if os.path.exists(path) else 0
    h = requests.head(url, allow_redirects=True, timeout=60)
    total = int(h.headers.get("content-length") or h.headers.get("x-goog-stored-content-length") or 0)
    if total and have == total:
        return
    hdr = {"Range": f"bytes={have}-"} if have else {}
    with requests.get(url, stream=True, headers=hdr, timeout=120) as r:
        r.raise_for_status()
        with open(path, "ab" if have else "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    print(f"downloaded {os.path.getsize(path) / 1e9:.2f} GB -> {path}")


def region_hits(region, bbox):
    w, s, e, n = (math.degrees(v) for v in region[:4])
    return not (e < bbox[0] or w > bbox[2] or n < bbox[1] or s > bbox[3])


def tile_uris(tileset, bbox):
    """b3dm URIs of all tiles in a tileset.json whose region touches the bbox."""
    out = []

    def walk(t):
        bv = t.get("boundingVolume", {})
        if "region" in bv and not region_hits(bv["region"], bbox):
            return
        uri = (t.get("content") or {}).get("uri")
        if uri and uri.endswith(".b3dm"):
            out.append(uri)
        for c in t.get("children", []):
            walk(c)

    walk(tileset["root"])
    return out


def decode_b3dm(blob):
    """(batch attributes, ECEF vertices [n, 3], faces [m, 3], batch id per vertex)."""
    ftj, ftb, btj, btb = struct.unpack("<4I", blob[12:28])
    bt = json.loads(blob[28 + ftj + ftb:28 + ftj + ftb + btj])["attributes"]
    glb = blob[28 + ftj + ftb + btj + btb:]
    jl = struct.unpack("<I", glb[12:16])[0]
    js = json.loads(glb[20:20 + jl])
    bl = struct.unpack("<I", glb[20 + jl:24 + jl])[0]
    binc = glb[28 + jl:28 + jl + bl]
    rtc = np.array(js["extensions"]["CESIUM_RTC"]["center"])
    verts, faces, bids, base = [], [], [], 0
    for prim in js["meshes"][0]["primitives"]:
        view = js["bufferViews"][prim["extensions"]["KHR_draco_mesh_compression"]["bufferView"]]
        off = view.get("byteOffset", 0)
        m = DracoPy.decode(binc[off:off + view["byteLength"]])
        p = m.points.astype(np.float64)
        verts.append(np.c_[p[:, 0], -p[:, 2], p[:, 1]] + rtc)
        faces.append(np.asarray(m.faces) + base)
        # the generic attribute (type 4) is the batch id
        bid = next(a["data"] for a in m.attributes if a["attribute_type"] == 4)
        bids.append(np.asarray(bid).ravel().astype(int))
        base += len(p)
    return bt, np.vstack(verts), np.vstack(faces), np.concatenate(bids)


def buildings_in_tile(blob, city):
    """Footprint (local frame), height and class of each building in one tile."""
    bt, ecef, faces, bid = decode_b3dm(blob)
    lon, lat, h = ECEF_TO_LL.transform(ecef[:, 0], ecef[:, 1], ecef[:, 2])
    x, y = city.fwd.transform(lon, lat)
    xy = np.c_[x, y]
    z = np.asarray(h)
    a, b, c = (xy[faces[:, k]] for k in range(3))
    # upward-facing triangles: the roof, whose projection is the footprint (flat in LOD1)
    nz = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    top = nz > 1e-6
    by_b = {}
    for f in np.nonzero(top)[0]:
        by_b.setdefault(bid[faces[f, 0]], []).append(f)
    out = []
    for k, fs in by_b.items():
        if k >= len(bt):
            continue
        tris = [Polygon(xy[faces[f]]) for f in fs]
        g = shapely.unary_union([t for t in tris if t.area > 1e-4]).buffer(0.02).buffer(-0.02)
        if g.is_empty or g.area < 3:
            continue
        at = bt[k]
        height = at.get("bldg:measuredHeight")
        if not height:
            continue
        out.append((at.get("gml:id", ""), float(height), int(at.get("bldg:class") or 0), g))
    return out


def main():
    city, a = city_args(__doc__.splitlines()[0], lambda ap: ap.add_argument("--zip", help="a local copy of the PLATEAU 3D Tiles zip"))
    cfg = city.cfg.get("plateau")
    if not cfg:
        raise SystemExit(f"{city.id}: no plateau block in city.json")
    city.ensure_dirs()
    path = a.zip or os.path.join(city.raw, "plateau_3dtiles.zip")
    if not a.zip:
        download(cfg["zip"], path)
    z = zipfile.ZipFile(path)
    names = set(z.namelist())
    root = next(n for n in names if n.endswith("/") and n.count("/") == 1)
    wards = sorted({m.group(1) for n in names if (m := re.match(re.escape(root) + r"(bldg_\d+_[a-z-]+)_lod\d", n))})
    w, s, e, n = city.cfg["bbox"]
    bbox = [w - 0.002, s - 0.002, e + 0.002, n + 0.002]
    jobs = []
    for ward in wards:
        for lv in LEVELS:
            ts = f"{root}{ward}_{lv}/tileset.json"
            if ts in names:
                for uri in tile_uris(json.loads(z.read(ts)), bbox):
                    jobs.append((ward, lv, f"{root}{ward}_{lv}/{uri}"))
                break
    print(f"{len(jobs)} tiles in {len({j[0] for j in jobs})} wards: {dict(Counter((j[0], j[1]) for j in jobs))}")
    blobs = (z.read(j[2]) for j in jobs)
    rows, seen = [], set()
    with ThreadPoolExecutor(os.cpu_count() or 4) as ex:
        for i, got in enumerate(ex.map(lambda b: buildings_in_tile(b, city), blobs)):
            for gid, h, cls, g in got:
                if gid in seen:
                    continue
                seen.add(gid)
                lon, lat = city.inv.transform(*np.asarray(g.exterior.coords).T) if g.geom_type == "Polygon" else (None, None)
                if lon is None:
                    g = max(g.geoms, key=lambda q: q.area)
                    lon, lat = city.inv.transform(*np.asarray(g.exterior.coords).T)
                rows.append((gid, h, cls, Polygon(zip(lon, lat)).wkb))
            if i % 200 == 0:
                print(f"  {i}/{len(jobs)} tiles, {len(rows)} buildings", file=sys.stderr)
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    con.execute("CREATE TABLE b (gml_id VARCHAR, height DOUBLE, bldg_class INTEGER, wkb BLOB)")
    con.executemany("INSERT INTO b VALUES (?, ?, ?, ?)", rows)
    out = os.path.join(city.raw, "plateau_bldg.parquet")
    con.execute(f"COPY b TO '{out}' (FORMAT parquet)")
    hs = np.array([r[1] for r in rows])
    print(f"{len(rows)} PLATEAU buildings, measured height median {np.median(hs):.1f} m, max {hs.max():.1f} m -> {out}")


if __name__ == "__main__":
    main()
