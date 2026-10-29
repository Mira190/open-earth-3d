"""Measured buildings for a Dutch city from the 3DBAG (the city's `bag3d` block).

The 3DBAG (3dbag.nl, TU Delft and 3DGI, CC BY 4.0) models every building in the
Netherlands' cadastral register (BAG) from the national airborne LiDAR (AHN), at three
levels of detail: LOD1.2 (one block), LOD1.3 (one block per roof level) and LOD2.2 (the
roof's planes). Its tiles are CityJSON in RD New with NAP heights.

For each building this writes, per LOD1.3 roof level (a "tier"):
  rings   the tier's outline, lon/lat
  h       its top above the building's ground (b3_h_maaiveld): the highest point of the
          LOD2.2 roof over the tier where that roof is pitched, else the tier's own level
  roof, pitch, roof_h
          the roof the LOD2.2 model has over the tier, measured from its triangles by the
          same classifier as PLATEAU's LOD2 roofs (plateau_3dtiles.roof_of); a skillion also
          gets the direction its slope faces (degrees clockwise from north)
  storeys, year, survey_year, id
          the 3DBAG's estimate of the floors, the BAG's original year of construction
          (None for 1005, the BAG's mark for an unknown old date), the year of the point
          cloud the building was modelled from (AHN3 2014 to AHN5 2023), the BAG id

    python pipeline/fetch_3dbag.py --city amsterdam

Writes data/raw/<city>/3dbag.json (and caches the tiles in data/raw/<city>/3dbag/).
"""
import gzip
import hashlib
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import duckdb
import numpy as np
import requests
import shapely
import shapely.affinity
from pyproj import Transformer
from shapely.geometry import Polygon

from cityctx import city_args, polygons
from fetch_ign import lambert_bbox
from plateau_3dtiles import roof_of

UA = {"User-Agent": "open-earth-3d research prototype"}
UNKNOWN_YEAR = 1005  # the BAG's construction year for a building whose date is not known


def tiles(cfg, raw, bbox_rd):
    """[(tile_id, url, sha256)] of the 3DBAG tiles over bbox_rd, from the release's tile index."""
    path = os.path.join(raw, "tile_index.fgb")
    if not os.path.exists(path):
        r = requests.get(cfg["index"], headers=UA, timeout=300)
        r.raise_for_status()
        open(path, "wb").write(r.content)
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial")
    x0, y0, x1, y1 = bbox_rd
    return con.execute(f"SELECT tile_id, cj_download, cj_sha256 FROM ST_Read('{path}') "
                       f"WHERE ST_Intersects(geom, ST_MakeEnvelope({x0}, {y0}, {x1}, {y1}))").fetchall()


def download(job, d):
    tid, url, sha = job
    path = os.path.join(d, tid.replace("/", "-") + ".city.json.gz")
    if os.path.exists(path) and hashlib.sha256(open(path, "rb").read()).hexdigest() == sha:
        return path
    for attempt in range(4):
        try:
            # the bytes as stored: some tiles are served with Content-Encoding: gzip, which
            # requests would otherwise undo
            r = requests.get(url, headers=UA, timeout=300, stream=True)
            r.raise_for_status()
            body = r.raw.read(decode_content=False)
            if hashlib.sha256(body).hexdigest() != sha:
                raise IOError(f"{tid}: checksum mismatch")
            open(path, "wb").write(body)
            return path
        except (requests.RequestException, IOError):
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def triangulate(V, face):
    """Triangles (index triples into V) of one planar CityJSON face: [outer ring, holes...]."""
    outer = face[0]
    if len(face) == 1 and len(outer) == 3:
        return [tuple(outer)]
    if len(face) == 1 and len(outer) == 4:
        return [(outer[0], outer[1], outer[2]), (outer[0], outer[2], outer[3])]
    P = V[outer]
    n = np.zeros(3)
    for i in range(len(P)):  # Newell's normal
        a, b = P[i], P[(i + 1) % len(P)]
        n += [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]
    keep = [k for k in range(3) if k != int(np.argmax(np.abs(n)))]  # drop the dominant axis
    rings = [[tuple(V[i][keep]) for i in r] for r in face]
    try:
        poly = Polygon(rings[0], rings[1:])
        tri = shapely.constrained_delaunay_triangles(poly)
    except Exception:
        return []
    look = {}
    for r in face:
        for i in r:
            look.setdefault(tuple(V[i][keep]), i)
    out = []
    for t in shapely.get_parts(tri):
        cs = list(t.exterior.coords)[:3]
        ix = [look.get(c) for c in cs]
        if None not in ix:
            a, b, c = V[ix]
            # the triangulation works in a projected plane: keep the face's own winding (outward)
            out.append(tuple(ix) if np.dot(np.cross(b - a, c - a), n) >= 0 else (ix[0], ix[2], ix[1]))
    return out


def solid(geom, lod):
    g = next((g for g in geom if g["lod"] == lod), None)
    if g is None:
        return None, None
    faces = [f for shell in g["boundaries"] for f in shell]
    vals = [v for shell in g["semantics"]["values"] for v in shell]
    surf = g["semantics"]["surfaces"]
    return faces, [surf[v]["type"] if v is not None else None for v in vals]


def buildings(path, to_ll):
    """The features of one tile (see the module docstring)."""
    cj = json.load(gzip.open(path))
    sc, tr = np.array(cj["transform"]["scale"]), np.array(cj["transform"]["translate"])
    V = np.asarray(cj["vertices"], dtype=np.float64) * sc + tr
    objs = cj["CityObjects"]
    out = []
    for oid, b in objs.items():
        if b["type"] != "Building":
            continue
        a = b["attributes"]
        ground = a.get("b3_h_maaiveld")
        if ground is None or a.get("b3_pw_onvoldoende"):
            continue
        year = a.get("oorspronkelijkbouwjaar")
        common = {"id": a.get("identificatie", oid), "storeys": a.get("b3_bouwlagen"),
                  "year": None if year in (None, UNKNOWN_YEAR) else year, "survey_year": a.get("b3_pw_datum")}
        for cid in b.get("children", []):
            p = objs[cid]
            f13, s13 = solid(p.get("geometry", []), "1.3")
            f22, s22 = solid(p.get("geometry", []), "2.2")
            if not f13:
                continue
            # the LOD2.2 model as triangles, roof and wall, for the roof classifier
            T, roof_t = [], []
            for f, s in zip(f22 or [], s22 or []):
                if s in ("RoofSurface", "WallSurface"):
                    for t in triangulate(V, f):
                        T.append(t)
                        roof_t.append(s == "RoofSurface")
            T = np.asarray(T, dtype=np.int64).reshape(-1, 3)
            roof_t = np.asarray(roof_t, bool)
            cen = V[T].mean(axis=1) if len(T) else np.zeros((0, 3))
            tiers = [(f, V[f[0]][:, 2].mean()) for f, s in zip(f13, s13) if s == "RoofSurface"]
            for f, z in tiers:
                try:
                    q = Polygon(V[f[0]][:, :2], [V[r][:, :2] for r in f[1:]])
                    if not q.is_valid:
                        q = q.buffer(0)
                except Exception:
                    continue
                for g in polygons(q):
                    if g.area < 2:
                        continue
                    rec = dict(common)
                    if len(T):
                        inside = shapely.contains_xy(g.buffer(0.3), cen[:, 0], cen[:, 1])
                        F = T[inside]
                        if len(F):
                            o = V[F].reshape(-1, 3).min(axis=0) * [1, 1, 0]
                            P = V - o
                            m = roof_of(P, F, shapely.affinity.translate(g, -o[0], -o[1]))
                            if m and m["roof"] == "skillion":  # the way its one slope faces, degrees from north
                                Fr = F[roof_t[inside]]
                                nv = np.cross(V[Fr[:, 1]] - V[Fr[:, 0]], V[Fr[:, 2]] - V[Fr[:, 0]])
                                up = nv[:, 2] > 0.26 * np.linalg.norm(nv, axis=1)
                                sx, sy = nv[up, 0].sum(), nv[up, 1].sum()
                                m["direction"] = round(float(np.degrees(np.arctan2(sx, sy)) % 360), 1)
                            if m:
                                rec.update(m)
                            top = V[T[inside & roof_t]][:, :, 2].max() if (inside & roof_t).any() else z
                            z = top if m and m.get("roof") != "flat" else z
                    h = float(z) - ground
                    if h < 1.0:
                        continue
                    lon, lat = to_ll(*np.asarray(g.exterior.coords).T)
                    rings = [[[round(x, 7), round(y, 7)] for x, y in zip(lon, lat)]]
                    for hole in g.interiors:
                        hx, hy = to_ll(*np.asarray(hole.coords).T)
                        rings.append([[round(x, 7), round(y, 7)] for x, y in zip(hx, hy)])
                    out.append(rec | {"rings": rings, "h": round(h, 2), "ground_nap": round(ground, 2)})
    return out


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    cfg = C.cfg["bag3d"]
    d = os.path.join(C.raw, "3dbag")
    os.makedirs(d, exist_ok=True)
    bbox_rd = lambert_bbox(C.cfg["bbox"], pad_deg=0.001, crs="EPSG:28992")
    jobs = tiles(cfg, C.raw, bbox_rd)
    t = time.time()
    with ThreadPoolExecutor(6) as ex:
        paths = list(ex.map(lambda j: download(j, d), jobs))
    print(f"3dbag: {len(paths)} tiles in {time.time() - t:.0f} s")
    to_ll = Transformer.from_crs("EPSG:28992", "EPSG:4326", always_xy=True).transform
    w, so, e, n = C.cfg["bbox"]
    uniq = {}
    for p in paths:
        for f in buildings(p, to_ll):
            lon, lat = f["rings"][0][0]
            if not (w - 0.002 <= lon <= e + 0.002 and so - 0.002 <= lat <= n + 0.002):
                continue
            # a building on a tile edge is in both tiles: keep one copy of each tier
            uniq.setdefault((f["id"], round(f["h"], 1), lon, lat), f)
    feats = list(uniq.values())
    json.dump(feats, open(os.path.join(C.raw, "3dbag.json"), "w"), separators=(",", ":"))
    n_b = len({f["id"] for f in feats})
    roofs = sum("roof" in f for f in feats)
    print(f"3dbag: {n_b} buildings, {len(feats)} tiers, {roofs} with a measured roof -> {os.path.join(C.raw, '3dbag.json')}")


if __name__ == "__main__":
    main()
