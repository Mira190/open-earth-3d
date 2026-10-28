"""A city's configuration and local frame, shared by the pipeline, the analyses
and the Blender script.

Every city lives in cities/<id>/: city.json (bounding box, data sources, places,
tour), optional hooks in city.py, and reference tables. Raw downloads go to
data/raw/<id>/ and the built scene to web/data/<id>/.

The frame is a transverse Mercator centred on the city's origin (x east, y north,
z up, metres), so it has no grid rotation and its scale error is tiny over a
few kilometres.
"""
import argparse
import importlib.util
import json
import os

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class City:
    def __init__(self, cid):
        self.id = cid
        self.dir = os.path.join(ROOT, "cities", cid)
        path = os.path.join(self.dir, "city.json")
        if not os.path.exists(path):
            raise SystemExit(f"no city config at {path}; see docs/ADDING_A_CITY.md")
        self.cfg = json.load(open(path, encoding="utf8"))
        self.raw = os.path.join(ROOT, "data", "raw", cid)
        self.out = os.path.join(ROOT, "web", "data", cid)
        self.analysis = os.path.join(self.dir, "analysis")
        self.lon0, self.lat0 = self.cfg["origin"]
        self.x0, self.x1, self.y0, self.y1 = self.cfg["extent_m"]
        self.proj = (f"+proj=tmerc +lat_0={self.lat0} +lon_0={self.lon0} +k=1 +x_0=0 +y_0=0 "
                     "+ellps=WGS84 +units=m +no_defs")
        self.fwd = Transformer.from_crs("EPSG:4326", self.proj, always_xy=True)
        self.inv = Transformer.from_crs(self.proj, "EPSG:4326", always_xy=True)
        self.hooks = None
        hp = os.path.join(self.dir, "city.py")
        if os.path.exists(hp):
            spec = importlib.util.spec_from_file_location(f"city_{cid.replace('-', '_')}", hp)
            self.hooks = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.hooks)

    def hook(self, name):
        """A function from cities/<id>/city.py, or None."""
        return getattr(self.hooks, name, None) if self.hooks else None

    def file(self, *parts):
        return os.path.join(self.dir, *parts)

    def to_local(self, geom):
        return shapely.transform(geom, lambda c: np.column_stack(self.fwd.transform(c[:, 0], c[:, 1])))

    def ensure_dirs(self):
        for d in (self.raw, self.out, self.analysis):
            os.makedirs(d, exist_ok=True)


def polygons(geom):
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    if hasattr(geom, "geoms"):
        return [p for g in geom.geoms for p in polygons(g)]
    return []


def city_args(description, extra=None):
    """Parse --city (default sydney) plus any extra arguments; returns (City, args)."""
    ap = argparse.ArgumentParser(description=description)
    ap.add_argument("--city", default="sydney", help="city id, a folder in cities/")
    if extra:
        extra(ap)
    a = ap.parse_args()
    return City(a.city), a
