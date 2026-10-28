"""PLATEAU 3D Tiles zip backend for pipeline/fetch_plateau.py (city.json plateau.zip).

PLATEAU publishes a *_3dtiles-mvt_*.zip for every city, with Draco-compressed b3dm building
meshes and each building's `bldg:measuredHeight` in the batch table. read() takes the tiles
that touch the bounding box and returns [{h, rings}] in longitude and latitude, the shape
fetch_plateau.py writes to plateau.json, with each footprint taken from the upward-facing
triangles of its mesh, and the building's use, storeys and name where the batch table has them.

With `plateau.roofs: true`, the LOD2 tiles of the wards that have them are read too, and
each building's roof is measured from its mesh (roof_of): flat, gabled (ridge along the
footprint's long axis), gabled_across, hipped, half-hipped or skillion, with its pitch and its
height from eave to ridge. Gables are told from hips by the wall area standing above the
eave, against the triangle a gable on the short side would make.

Frame: tiles are glTF y-up with a CESIUM_RTC centre in ECEF; the tile frame is rotated to
z-up (x, -z, y) and added to the centre, then converted to longitude and latitude.
The zip is large (Kyoto: 1.8 GB), so the tiles inside the bbox are read out of it with HTTP
range requests (pipeline/rangezip.py); a copy at data/raw/<city>/plateau_3dtiles.zip is used
instead if there is one.
"""
import json
import math
import os
import re
import struct
import sys
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor

import DracoPy
import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import Polygon

from rangezip import RangeFile


ECEF_TO_LL = Transformer.from_crs("EPSG:4978", "EPSG:4326", always_xy=True)
LEVELS = ("lod1", "lod2_no_texture", "lod2")  # prefer the smallest tiles that carry heights


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
        extra = {key: at.get(attr) for key, attr in (("name", "gml:name"), ("usage", "bldg:usage"), ("storeys", "bldg:storeysAboveGround"))}
        out.append((at.get("gml:id", ""), float(height), {k: v for k, v in extra.items() if v not in (None, "")}, g))
    return out


def above(z, a, zc):
    """Area of the part of a planar triangle (vertex heights z, area a) above the plane z = zc."""
    lo, mid, hi = np.sort(z)
    if zc >= hi:
        return 0.0
    if zc <= lo:
        return a
    if zc <= mid:  # one vertex below: the part below is a small triangle at that vertex
        return a * (1 - (zc - lo) ** 2 / ((mid - lo + 1e-9) * (hi - lo + 1e-9)))
    return a * (hi - zc) ** 2 / ((hi - mid + 1e-9) * (hi - lo + 1e-9))


def roof_of(P, F, foot):
    """{roof, pitch (deg), roof_h (m)} of one LOD2 building: P [n, 3] local metres, z up;
    F [m, 3] its triangles; foot its footprint. None if it has no roof to speak of."""
    a, b, c = P[F[:, 0]], P[F[:, 1]], P[F[:, 2]]
    n = np.cross(b - a, c - a)
    A = np.linalg.norm(n, axis=1) / 2
    ok = A > 1e-4
    nz = np.where(ok, n[:, 2] / (2 * A + 1e-12), 0)
    slope = np.degrees(np.arccos(np.clip(nz, -1, 1)))
    roof = ok & (nz > 0.26)  # facing up and under 75 degrees; walls are near vertical
    wall = ok & (np.abs(nz) < 0.1)
    plan = A * nz
    if plan[roof].sum() < 4:
        return None
    flat = roof & (slope < 6)
    sl = roof & ~flat
    if plan[flat].sum() > 0.7 * plan[roof].sum() or not sl.any():
        return {"roof": "flat"}
    zs = P[F[sl]][:, :, 2]
    eave, ridge = np.percentile(zs.min(axis=1), 10), zs.max()
    if ridge - eave < 0.4:
        return {"roof": "flat"}
    w = plan[sl]
    order = np.argsort(slope[sl])
    pitch = slope[sl][order][np.searchsorted(np.cumsum(w[order]), w.sum() / 2)]  # area-weighted median
    q = np.asarray(foot.minimum_rotated_rectangle.exterior.coords)[:4]
    e1, e2 = q[1] - q[0], q[2] - q[1]
    L, W = np.hypot(*e1), np.hypot(*e2)
    axis, short = (e1 / max(L, 1e-9), W) if L >= W else (e2 / max(W, 1e-9), L)
    hn = n[sl, :2] / (np.linalg.norm(n[sl, :2], axis=1, keepdims=True) + 1e-12)
    if np.linalg.norm((hn * w[:, None]).sum(axis=0)) > 0.8 * w.sum():
        shape = "skillion"  # one plane
    else:
        gable = sum(above(P[f][:, 2], ar, eave + 0.15) for f, ar in zip(F[wall], A[wall]))
        ratio = gable / max(short * (ridge - eave), 1.0)
        along = w[np.abs(hn @ axis) > math.cos(math.radians(45))].sum() / w.sum()  # slopes facing the ends
        shape = ("gabled" if along < 0.5 else "gabled_across") if ratio > 0.55 else "half-hipped" if ratio > 0.2 else "hipped"
    return {"roof": shape, "pitch": round(float(pitch), 1), "roof_h": round(float(ridge - eave), 2)}


def roofs_in_tile(blob, city):
    """{gml:id: roof_of(...)} for the buildings of one LOD2 tile."""
    bt, ecef, faces, bid = decode_b3dm(blob)
    lon, lat, h = ECEF_TO_LL.transform(ecef[:, 0], ecef[:, 1], ecef[:, 2])
    x, y = city.fwd.transform(lon, lat)
    P = np.c_[x, y, h]
    fb = bid[faces[:, 0]]
    out = {}
    for k in np.unique(fb):
        if k >= len(bt):
            continue
        F = faces[fb == k]
        a, b, c = (P[F[:, i], :2] for i in range(3))
        up = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0]) > 1e-6
        foot = shapely.unary_union([Polygon(P[f, :2]) for f in F[up]]).buffer(0.02).buffer(-0.02)
        if foot.is_empty or foot.area < 3:
            continue
        r = roof_of(P, F, foot)
        if r:
            out[bt[k].get("gml:id", "")] = r
    return out


def read(city, cfg):
    path = os.path.join(city.raw, "plateau_3dtiles.zip")
    src = path if os.path.exists(path) else cfg["zip"]
    local = threading.local()

    def archive():  # one reader per thread: a zip reader keeps a position in its file
        if not hasattr(local, "z"):
            local.z = zipfile.ZipFile(src if src == path else RangeFile(src))
        return local.z
    z = archive()
    names = set(z.namelist())
    root = next(n for n in names if n.endswith("/") and n.count("/") == 1)
    wards = sorted({m.group(1) for n in names if (m := re.match(re.escape(root) + r"(bldg_\d+_[a-z-]+)_lod\d", n))})
    w, s, e, n = city.cfg["bbox"]
    bbox = [w - 0.002, s - 0.002, e + 0.002, n + 0.002]
    jobs, roof_jobs = [], []
    for ward in wards:
        for lv in LEVELS:
            ts = f"{root}{ward}_{lv}/tileset.json"
            if ts in names:
                jobs += [f"{root}{ward}_{lv}/{uri}" for uri in tile_uris(json.loads(z.read(ts)), bbox)]
                break
        ts = f"{root}{ward}_lod2_no_texture/tileset.json"
        if cfg.get("roofs") and ts in names:
            roof_jobs += [f"{root}{ward}_lod2_no_texture/{uri}" for uri in tile_uris(json.loads(z.read(ts)), bbox)]
    print(f"{len(jobs)} tiles in {len(wards)} wards" + (f", and {len(roof_jobs)} LOD2 tiles for the roofs" if roof_jobs else ""))
    out, seen, roofs = [], set(), {}
    with ThreadPoolExecutor(min(os.cpu_count() or 4, 8)) as ex:
        for i, got in enumerate(ex.map(lambda j: roofs_in_tile(archive().read(j), city), roof_jobs)):
            roofs.update(got)
            if i % 200 == 0:
                print(f"  {i}/{len(roof_jobs)} LOD2 tiles, {len(roofs)} roofs", file=sys.stderr)
        for i, got in enumerate(ex.map(lambda j: buildings_in_tile(archive().read(j), city), jobs)):
            for gid, h, extra, g in got:
                if gid in seen:
                    continue
                seen.add(gid)
                if g.geom_type != "Polygon":
                    g = max(g.geoms, key=lambda q: q.area)
                rings = []
                for r in [g.exterior] + list(g.interiors):
                    lon, lat = city.inv.transform(*np.asarray(r.coords).T)
                    rings.append([(round(float(a), 7), round(float(b), 7)) for a, b in zip(lon, lat)])
                out.append({"h": h, "rings": rings, **extra, **roofs.get(gid, {})})
            if i % 200 == 0:
                print(f"  {i}/{len(jobs)} tiles, {len(out)} buildings", file=sys.stderr)
    if roofs:
        print(f"roofs measured for {sum(1 for f in out if 'roof' in f)} of {len(out)} buildings")
    return out
