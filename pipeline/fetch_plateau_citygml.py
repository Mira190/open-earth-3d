"""Measured building heights and footprints from Project PLATEAU (MLIT, Japan's
open 3D city models, CC BY 4.0 / PLATEAU site policy), for the 3rd-mesh files of
the national CityGML archive that cover a city's bbox.

    python pipeline/fetch_plateau_citygml.py --city osaka        # -> data/raw/osaka/plateau_bldg.json

The CityGML archive is over a gigabyte, so this reads only the mesh files inside the
bbox out of the zip with HTTP range requests (pipeline/rangezip.py).

city.json:  "plateau": {"url": "<citygml zip>", "dataset": "...", "year": 2017, "licence": "..."}

Each building row: [plateau_id, name, usage_code, measured_height_m, storeys, ground_z,
solid_height_m, structure_code, survey_year, [lon, lat, lon, lat, ...]]
measured_height_m is PLATEAU's measuredHeight where surveyed (else None); solid_height_m
is the top of its LOD1 block above the ground, which every building has.
"""
import json
import os
import re
import time
import zipfile
from multiprocessing import Pool

from cityctx import city_args
from rangezip import RangeFile

B = re.compile(r"<bldg:Building gml:id=.*?</bldg:Building>", re.S)
POS = re.compile(r"<gml:posList>([^<]*)</gml:posList>")
G = lambda tag: re.compile(rf"<{tag}[^>]*>([^<]*)</{tag}>")
RX = {k: G(t) for k, t in dict(id='gen:value', name='gml:name', usage='bldg:usage', h='bldg:measuredHeight', st='bldg:storeysAboveGround',
                               struct='uro:buildingStructureType', year='uro:surveyYear').items()}
FOOT = re.compile(r"<bldg:lod0FootPrint>(.*?)</bldg:lod0FootPrint>", re.S)
SOLID = re.compile(r"<bldg:lod1Solid>(.*?)</bldg:lod1Solid>", re.S)
ID = re.compile(r'name="建物ID">\s*<gen:value>([^<]*)</gen:value>')


def mesh_bounds(code):
    """lon0, lat0, lon1, lat1 of a JIS X 0410 3rd-mesh code (8 digits)."""
    p, u, q, v, r, w = int(code[:2]), int(code[2:4]), int(code[4]), int(code[5]), int(code[6]), int(code[7])
    lat, lon = p / 1.5 + q * 5 / 60 + r * 30 / 3600, 100 + u + v * 7.5 / 60 + w * 45 / 3600
    return lon, lat, lon + 45 / 3600, lat + 30 / 3600


def parse(text):
    out = []
    for m in B.finditer(text):
        b = m.group(0)
        foot = FOOT.search(b)
        solid = SOLID.search(b)
        if not foot or not solid:
            continue
        ring = POS.search(foot.group(1))
        if not ring:
            continue
        v = [float(x) for x in ring.group(1).split()]
        lat, lon, z0 = v[0::3], v[1::3], v[2::3]
        zt = max(float(x) for p in POS.findall(solid.group(1)) for x in p.split()[2::3])
        g = {k: (rx.search(b).group(1) if rx.search(b) else None) for k, rx in RX.items()}
        pid = ID.search(b)
        num = lambda s: float(s) if s not in (None, "") else None
        out.append([pid.group(1) if pid else None, g["name"], g["usage"], num(g["h"]), int(g["st"]) if g["st"] else None, round(min(z0), 2),
                    round(zt - min(z0), 2), g["struct"], int(g["year"]) if g["year"] else None,
                    [round(c, 7) for xy in zip(lon, lat) for c in xy]])
    return out


def one(args):
    url, entry, path = args
    if os.path.exists(path):
        return path, len(json.load(open(path)))
    t = time.time()
    z = zipfile.ZipFile(RangeFile(url))
    rows = parse(z.read(entry).decode("utf8"))
    json.dump(rows, open(path, "w"), separators=(",", ":"), ensure_ascii=False)
    print(f"  {os.path.basename(path)}: {len(rows)} buildings in {time.time() - t:.0f} s", flush=True)
    return path, len(rows)


def main():
    C, _ = city_args(__doc__.splitlines()[0])
    C.ensure_dirs()
    cfg = C.cfg["plateau"]
    w, s, e, n = C.cfg["bbox"]
    z = zipfile.ZipFile(RangeFile(cfg["url"]))
    todo = []
    for info in z.infolist():
        if "/udx/bldg/" in info.filename and info.filename.endswith(".gml"):
            a = mesh_bounds(os.path.basename(info.filename)[:8])
            if a[0] < e and a[2] > w and a[1] < n and a[3] > s:
                todo.append(info.filename)
    cache = os.path.join(C.raw, "plateau")
    os.makedirs(cache, exist_ok=True)
    print(f"{len(todo)} mesh files cover the bbox")
    jobs = [(cfg["url"], f, os.path.join(cache, os.path.basename(f)[:8] + ".json")) for f in todo]
    with Pool(4) as pool:
        done = pool.map(one, jobs, chunksize=1)
    rows = [r for p, _ in done for r in json.load(open(p))]
    json.dump({"source": cfg.get("dataset"), "rows": rows}, open(os.path.join(C.raw, "plateau_bldg.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    got = sum(1 for r in rows if r[3] is not None)
    print(f"plateau: {len(rows)} buildings, {got} with a measured height")


if __name__ == "__main__":
    main()
