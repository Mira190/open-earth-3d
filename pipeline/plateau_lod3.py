"""PLATEAU's finest building models (LOD3 / LOD4 3D Tiles 1.1: glTF with Draco, EXT_mesh_features and
EXT_structural_metadata) for the landmarks a city builds from them, such as Senso-ji's halls and gates.

    python pipeline/plateau_lod3.py --city asakusa

city.json `plateau_lod3`: {"tileset": <url of the ward's tileset.json>, "buildings": {key: [lon, lat]},
"radius_m", "attribution"}. For each key, the building whose LOD3 mesh covers that point (its name
and gml:id in the batch metadata) is taken from the deepest tiles over it and written, in the
city's local frame (x east, y north, z up, metres of the vertical datum), to
data/raw/<city>/lod3/<key>.json as {"name", "gml_id", "attributes", "lod", "positions", "faces",
"normals"}. Tiles are cached in data/raw/<city>/lod3/tiles/.

MLIT Project PLATEAU, CC BY 4.0. Frame: glTF y-up with the node's translation, turned z-up into ECEF.
"""
import json
import math
import os
import struct
import urllib.request

import DracoPy
import numpy as np
from pyproj import Transformer

from cityctx import city_args

ECEF_TO_LL = Transformer.from_crs("EPSG:4978", "EPSG:6697", always_xy=True)   # JGD2011 geographic 3D: lon, lat, ellipsoidal h
GEOID = None


def geoid_offset(lon, lat):
    """Ellipsoidal height of T.P. 0 m here: PLATEAU's tiles are in ellipsoidal heights, the scene in
    T.P. (GSI). From pyproj's GSIGEO grid when it has it, else the GSI geoid at Tokyo (about 36.7 m)."""
    try:
        t = Transformer.from_crs("EPSG:6697", "EPSG:6697+6695", always_xy=True)
        _, _, h = t.transform(lon, lat, 0.0)
        if math.isfinite(h) and abs(h) < 200:
            return -h
    except Exception:
        pass
    return 36.7


def get(url, path):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"})
        with urllib.request.urlopen(req, timeout=120) as r, open(path + ".part", "wb") as f:
            f.write(r.read())
        os.replace(path + ".part", path)
    return path


def leaves_over(tileset, lon, lat):
    """Content URIs of the deepest tiles whose region holds the point."""
    L, B = math.radians(lon), math.radians(lat)
    best, out = -1, []

    def walk(n, d):
        nonlocal best, out
        r = n["boundingVolume"].get("region")
        if r and not (r[0] <= L <= r[2] and r[1] <= B <= r[3]):
            return
        if "content" in n:
            if d > best:
                best, out = d, []
            if d == best:
                out.append(n["content"]["uri"])
        for c in n.get("children", []):
            walk(c, d + 1)

    walk(tileset["root"], 0)
    return out


def read_glb(blob):
    """(ECEF vertices [n, 3], faces [m, 3], feature id per vertex, feature table rows)."""
    jl = struct.unpack("<I", blob[12:16])[0]
    js = json.loads(blob[20:20 + jl])
    bl = struct.unpack("<I", blob[20 + jl:24 + jl])[0]
    binc = blob[28 + jl:28 + jl + bl]
    M = np.eye(4)   # the node's transform, in glTF's y-up space
    for n in js.get("nodes", []):
        if "matrix" in n:
            M = np.array(n["matrix"], float).reshape(4, 4).T
        elif "translation" in n:
            M[:3, 3] = n["translation"]
    verts, faces, fids, base = [], [], [], 0
    for mesh in js["meshes"]:
        for prim in mesh["primitives"]:
            dr = prim["extensions"]["KHR_draco_mesh_compression"]
            view = js["bufferViews"][dr["bufferView"]]
            off = view.get("byteOffset", 0)
            m = DracoPy.decode(binc[off:off + view["byteLength"]])
            p = m.points.astype(np.float64)
            # the node's transform, then glTF's y-up to 3D Tiles' z-up: ECEF
            q = (np.c_[p, np.ones(len(p))] @ M.T)[:, :3]
            verts.append(np.c_[q[:, 0], -q[:, 2], q[:, 1]])
            faces.append(np.asarray(m.faces).reshape(-1, 3) + base)
            uid = dr["attributes"].get("_FEATURE_ID_0")
            a = next((a for a in m.attributes if a.get("unique_id") == uid), None) if uid is not None else None
            if a is None:
                a = next(a for a in m.attributes if a["attribute_type"] == 4)
            fids.append(np.asarray(a["data"]).ravel().astype(int))
            base += len(p)
    rows = property_table(js, binc)
    return np.vstack(verts), np.vstack(faces), np.concatenate(fids), rows


def property_table(js, binc):
    """The EXT_structural_metadata property table as a list of dicts (strings and scalars)."""
    md = js["extensions"]["EXT_structural_metadata"]
    cls = md["schema"]["classes"]
    tab = md["propertyTables"][0]
    props = cls[tab["class"]]["properties"]
    n = tab["count"]
    view = lambda i: (lambda v: binc[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]])(js["bufferViews"][i])
    cols = {}
    for name, spec in tab["properties"].items():
        t = props[name]
        if t["type"] == "STRING":
            vals = view(spec["values"])
            offs = np.frombuffer(view(spec["stringOffsets"]), dtype={"UINT32": np.uint32, "UINT64": np.uint64, "UINT16": np.uint16, "UINT8": np.uint8}[spec.get("stringOffsetType", "UINT32")])
            cols[name] = [vals[offs[i]:offs[i + 1]].decode("utf8") for i in range(n)]
        elif t["type"] == "SCALAR":
            dt = {"INT8": np.int8, "UINT8": np.uint8, "INT16": np.int16, "UINT16": np.uint16, "INT32": np.int32, "UINT32": np.uint32,
                  "FLOAT32": np.float32, "FLOAT64": np.float64, "INT64": np.int64, "UINT64": np.uint64}[t["componentType"]]
            cols[name] = np.frombuffer(view(spec["values"]), dtype=dt)[:n].tolist()
    return [{k: v[i] for k, v in cols.items()} for i in range(n)]


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    cfg = city.cfg["plateau_lod3"]
    d = os.path.join(city.raw, "lod3")
    ts = json.load(open(get(cfg["tileset"], os.path.join(d, "tileset.json"))))
    base = cfg["tileset"].rsplit("/", 1)[0]
    for key, (lon, lat) in cfg["buildings"].items():
        tx, ty = city.fwd.transform(lon, lat)
        found = None
        for uri in leaves_over(ts, lon, lat):
            blob = open(get(f"{base}/{uri}", os.path.join(d, "tiles", uri)), "rb").read()
            ecef, F, fid, rows = read_glb(blob)
            lo, la, h = ECEF_TO_LL.transform(ecef[:, 0], ecef[:, 1], ecef[:, 2])
            x, y = city.fwd.transform(lo, la)
            # the feature whose footprint is nearest the point
            best = None
            for k in np.unique(fid):
                sel = fid == k
                dd = float(np.min(np.hypot(x[sel] - tx, y[sel] - ty)))
                cx, cy = float(np.mean(x[sel])), float(np.mean(y[sel]))
                inside = (x[sel].min() <= tx <= x[sel].max()) and (y[sel].min() <= ty <= y[sel].max())
                score = (0 if inside else 1, math.hypot(cx - tx, cy - ty))
                if best is None or score < best[0]:
                    best = (score, k)
            if best is None:
                continue
            k = best[1]
            vsel = np.nonzero(fid == k)[0]
            remap = -np.ones(len(fid), int)
            remap[vsel] = np.arange(len(vsel))
            fs = F[(fid[F[:, 0]] == k)]
            off = geoid_offset(lon, lat)
            P = np.c_[x[vsel], y[vsel], h[vsel] - off]
            row = rows[k] if k < len(rows) else {}
            attrs = json.loads(row.get("attributes") or "{}") if isinstance(row.get("attributes"), str) else {}
            found = {"name": attrs.get("gml:name") or attrs.get("name") or "", "gml_id": row.get("gml_id", ""), "lod": row.get("_lod"),
                     "attributes": {k2: v for k2, v in attrs.items() if not isinstance(v, (dict, list))},
                     "geoid_m": round(off, 2), "positions": np.round(P, 3).ravel().tolist(), "faces": remap[fs].ravel().tolist()}
            break
        if not found:
            print(f"{key}: no LOD3 building at {lon}, {lat}")
            continue
        json.dump(found, open(os.path.join(d, f"{key}.json"), "w"), ensure_ascii=False, separators=(",", ":"))
        P = np.asarray(found["positions"]).reshape(-1, 3)
        print(f"{key}: {found['name'] or '(no name)'} LOD{found['lod']}, {len(found['faces']) // 3} triangles, "
              f"x {P[:, 0].min():.1f}..{P[:, 0].max():.1f} y {P[:, 1].min():.1f}..{P[:, 1].max():.1f} z {P[:, 2].min():.1f}..{P[:, 2].max():.1f}")


if __name__ == "__main__":
    main()
