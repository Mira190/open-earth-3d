"""The game-facing part of a marine city's scene.json: points of interest, the player's spawn,
and the harbour layout (anchorages, marina, pontoon, traffic) that the reef viewer's modules read.

These come from cities/<id>/city.json and need no raw data, so they can be refreshed without
rebuilding the terrain and imagery:

    python pipeline/marine_meta.py --city whitsundays

build_marine.py calls `meta()` when it writes scene.json.

A POI is {id, name, kind, lonlat: [lon, lat] | xy: [x, north], src, note?}. `lonlat` is
projected into the local frame; `xy` is taken as it is (for nominal spots such as an anchorage
that the viewer searches for the right depth near). Kinds the viewer understands: beach, bay,
inlet, lookout, point, peak, island, anchorage, marina, airport, helipad, pontoon, reef, dive,
gate, town, cultural. The output POI always has `x` and `y` (metres east and north of the origin, rounded
to 1 m) and keeps `lonlat` when it was given.
"""
import json
import os

from cityctx import city_args


def poi(city, p):
    out = {k: v for k, v in p.items() if k not in ("xy",)}
    if "lonlat" in p:
        x, y = city.fwd.transform(*p["lonlat"])
    else:
        x, y = p["xy"]
    out["x"], out["y"] = round(float(x)), round(float(y))
    if not (city.x0 <= out["x"] <= city.x1 and city.y0 <= out["y"] <= city.y1):
        raise SystemExit(f"POI {p['id']} at ({out['x']}, {out['y']}) is outside the city's extent")
    return out


def meta(city):
    cfg = city.cfg
    pois = [poi(city, p) for p in cfg.get("pois", [])]
    ids = {p["id"] for p in pois}
    if len(ids) != len(pois):
        raise SystemExit("duplicate POI ids")
    spawn = dict(cfg.get("spawn") or {})
    if spawn.get("poi") and "x" not in spawn:
        p = next(p for p in pois if p["id"] == spawn["poi"])
        spawn["x"], spawn["y"] = p["x"], p["y"]
    harbour = cfg.get("harbour")
    if harbour:
        # every POI a harbour entry names must exist
        def refs(o):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k in ("at", "around") and isinstance(v, str):
                        yield v
                    elif k == "route":
                        yield from v
                    else:
                        yield from refs(v)
            elif isinstance(o, list):
                for v in o:
                    yield from refs(v)
        missing = sorted({r for r in refs(harbour) if r not in ids})
        if missing:
            raise SystemExit(f"harbour refers to unknown POIs: {missing}")
    out = {"pois": pois, "spawn": spawn or None, "harbour": harbour, "start": cfg.get("start")}
    if cfg.get("region"):
        out["region"] = cfg["region"]
    if cfg.get("life"):
        out["life"] = life(city, cfg["life"])
    return out


def life(city, block):
    """The site's life profile for web/reef/life.js (see web/reef/life/profile.js), passed through as it is,
    except that a `clear` polygon given as `lonlat` (an airstrip to keep bare) is projected to `xy` and grown
    by `pad` metres."""
    from shapely.geometry import Polygon
    out = json.loads(json.dumps(block))
    for c in (out.get("flora") or {}).get("clear", []):
        if "lonlat" in c:
            poly = Polygon([city.fwd.transform(lon, lat) for lon, lat in c.pop("lonlat")])
            if c.get("pad"):
                poly = poly.buffer(c["pad"], join_style=2)
            c["xy"] = [[round(float(x), 1), round(float(y), 1)] for x, y in poly.exterior.coords[:-1]]
    return out


def main():
    city, _ = city_args("Refresh the POIs, spawn and harbour layout in a marine city's scene.json")
    path = os.path.join(city.out, "scene.json")
    scene = json.load(open(path))
    scene.update(meta(city))
    json.dump(scene, open(path, "w"), indent=1)
    print(f"{path}: {len(scene['pois'])} POIs, spawn {scene['spawn']}")


if __name__ == "__main__":
    main()
