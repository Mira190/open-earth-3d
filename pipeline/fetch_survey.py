"""Surveyed building heights for a city, from the feature service in its city.json
`survey` block, where a mapping agency publishes building outlines with measured
top levels (Hong Kong's Lands Department does, for every building block).

  survey  "arcgis_features": an ArcGIS FeatureServer layer queried by the bbox,
          `fields` naming the attributes: top (absolute top level, in the city's
          vertical datum), base, floors, name, name_local, kind (block type),
          status and date (when the block was surveyed, epoch milliseconds);
          `keep_status` lists the statuses kept, `skip_kinds` the block types
          dropped (temporary structures).

    python pipeline/fetch_survey.py --city hong-kong

Writes data/raw/<city>/survey.json: [{id, rings (lon, lat), top, base, floors, name,
name_local, kind, date}], one record per block. pipeline/build_scene.py cuts the open-data
footprints along these blocks (see pipeline/survey.py).
"""
import json
import os
import time

import requests

from cityctx import city_args

UA = {"User-Agent": "open-earth-3d research prototype"}


def query(url, params):
    for attempt in range(5):
        try:
            r = requests.get(url, params=params, timeout=120, headers=UA)
            if r.status_code == 200:
                return r.json()
        except (requests.RequestException, ValueError):
            pass
        time.sleep(2 ** attempt)
    raise RuntimeError(f"failed: {url} {params}")


def arcgis_features(bbox, cfg):
    url = cfg["url"].rstrip("/") + "/query"
    f = cfg["fields"]
    w, s, e, n = bbox
    out, offset = [], 0
    while True:
        d = query(url, dict(where="1=1", geometry=f"{w},{s},{e},{n}", geometryType="esriGeometryEnvelope", inSR=4326,
                            spatialRel="esriSpatialRelIntersects", outFields="*", outSR=4326, f="geojson",
                            resultOffset=offset, resultRecordCount=cfg.get("page", 2000), orderByFields="OBJECTID"))
        feats = d.get("features", [])
        out += feats
        offset += len(feats)
        if not feats or not (d.get("exceededTransferLimit") or d.get("properties", {}).get("exceededTransferLimit")) and len(feats) < cfg.get("page", 2000):
            break
    keep, skip = set(cfg.get("keep_status", [])), set(cfg.get("skip_kinds", []))
    recs = []
    for ft in out:
        p, g = ft["properties"], ft["geometry"]
        if not g or p.get(f["top"]) is None:
            continue
        if keep and p.get(f.get("status")) not in keep:
            continue
        if p.get(f.get("kind")) in skip:
            continue
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
        for k, rings in enumerate(polys):
            recs.append({"id": f'{ft.get("id", p.get("OBJECTID"))}' + (f"-{k}" if len(polys) > 1 else ""), "rings": rings,
                         "top": float(p[f["top"]]), "base": p.get(f.get("base")), "floors": p.get(f.get("floors")),
                         "name": p.get(f.get("name")), "name_local": p.get(f.get("name_local")), "kind": p.get(f.get("kind")),
                         "date": p.get(f.get("date"))})
    return len(out), recs


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    city.ensure_dirs()
    cfg = city.cfg.get("survey")
    if not cfg:
        raise SystemExit(f"{city.id} has no survey block in city.json")
    t = time.time()
    if cfg["type"] == "arcgis_features":
        n, recs = arcgis_features(city.cfg["bbox"], cfg)
    else:
        raise SystemExit(f"unknown survey type {cfg['type']}")
    path = os.path.join(city.raw, "survey.json")
    json.dump(recs, open(path, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
    print(f"survey: {n} features, {len(recs)} blocks kept in {time.time() - t:.0f} s -> {path}")


if __name__ == "__main__":
    main()
