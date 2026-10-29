"""Measured building heights from Project PLATEAU (MLIT Japan) for a city's bounding box.

PLATEAU's building models carry a surveyed `measuredHeight`. The city's `plateau` block names
one of three sources, and each is written to data/raw/<city>/plateau.json as footprints in
longitude and latitude with their heights, `[{h, rings, measured?, name?, usage?, storeys?,
ground?}]`, which build_scene.py's Plateau class reads:

  * `citygml`: a city's CityGML zip (plateau_citygml.py), read with HTTP range requests. One
    feature per building, with its use, storeys and name, and the LOD1 block height
    (measured: false) where there is no survey record.
  * `zip`: a city's 3D Tiles zip (plateau_3dtiles.py), also read with range requests. One
    feature per building, its footprint the roof of its mesh.
  * `tiles`: a vector-tile mirror of the LOD2 models (attribute `z`, the height in metres).
    One feature per roof face, so a podium and its tower are two.

    python pipeline/fetch_plateau.py --city tokyo
"""
import json
import math
import os


from cityctx import city_args
from fetch_tiles import get, tile_range

EXTENT = 4096


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    city.ensure_dirs()
    cfg = city.cfg["plateau"]
    for key, name in (("citygml", "plateau_citygml"), ("zip", "plateau_3dtiles")):
        if key in cfg:  # an archive of the city's own: any PLATEAU city outside the vector-tile mirror
            out = __import__(name).read(city, cfg)
            json.dump(out, open(os.path.join(city.raw, "plateau.json"), "w"), separators=(",", ":"), ensure_ascii=False)
            print(f"plateau: {len(out)} footprints from the {key} archive")
            return
    import mapbox_vector_tile  # only the vector-tile backend needs it
    z = cfg["zoom"]
    xs, ys = tile_range(city.cfg["bbox"], z, pad=0)
    w, s, e, n = city.cfg["bbox"]
    out, seen = [], set()
    d = os.path.join(city.raw, "plateau_mvt")
    os.makedirs(d, exist_ok=True)
    for tx in xs:
        for ty in ys:
            p = os.path.join(d, f"{z}_{tx}_{ty}.pbf")
            if not get(cfg["tiles"].format(z=z, x=tx, y=ty), p):
                continue
            layer = mapbox_vector_tile.decode(open(p, "rb").read()).get("bldg")
            if not layer:
                continue
            n2 = 2 ** z
            for f in layer["features"]:
                h = f["properties"].get("z")
                if h is None or f["geometry"]["type"] not in ("Polygon", "MultiPolygon"):
                    continue
                polys = [f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Polygon" else f["geometry"]["coordinates"]
                for poly in polys:
                    rings = []
                    for r in poly:
                        pts = []
                        for px, py in r:
                            fx, fy = tx + px / EXTENT, ty + 1 - py / EXTENT  # mapbox_vector_tile flips y: py grows north
                            lon = fx / n2 * 360 - 180
                            lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * fy / n2))))
                            pts.append((round(lon, 7), round(lat, 7)))
                        rings.append(pts)
                    c = rings[0][0]
                    key = (round(c[0], 6), round(c[1], 6), float(h))
                    if key in seen or not (w - 0.002 < c[0] < e + 0.002 and s - 0.002 < c[1] < n + 0.002):
                        continue  # tiles overlap at the edges, so a footprint can appear twice
                    seen.add(key)
                    out.append({"h": float(h), "rings": rings})
    json.dump(out, open(os.path.join(city.raw, "plateau.json"), "w"), separators=(",", ":"))
    print(f"plateau: {len(out)} footprints from {len(xs) * len(ys)} tiles")


if __name__ == "__main__":
    main()
