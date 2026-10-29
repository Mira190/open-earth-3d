"""Measured building heights: a mapping agency's survey (a city's `survey` block,
pipeline/fetch_survey.py) and a LiDAR surface model (its `surface_check` block,
pipeline/fetch_tiles.py).

A mapping agency's building blocks, each with a measured top level, replace the
open-data heights wherever they cover a footprint. Hong Kong's Lands Department
draws a building as blocks: a podium, and the towers standing on it, each with its
own top level in mPD. An Overture footprint is cut along those blocks, tallest
first, so a tower is not buried under its podium; each piece takes the top of the
block above it. Blocks smaller than a few per cent of the footprint are rooftop
plant and are absorbed, unless they stand well clear of the main roof (a spire).
Blocks no Overture footprint covers (buildings missing from OpenStreetMap) are
added as buildings of their own.

Each block goes to the open-data footprint it fits best, so where OpenStreetMap
maps a podium round its towers, the towers' blocks are cut into the towers alone.

A footprint the blocks cover less than half of is measured from the LiDAR surface
model instead, where the city has one: the median surface inside the outline drawn
1 m in, so walls, eaves and the odd overhanging tree drop out. A result under 2.5 m
is not a roof (a building put up after the flight, or a canopy the laser saw
through), and the footprint keeps its other height source. A surveyed piece the
laser saw far lower (its 90th percentile over 15 m and a quarter below the survey)
on a block surveyed before the flight takes the LiDAR height too: the block's
outline takes in a lower building. On a block surveyed after the flight, the
survey is newer than the laser and stands.

Tops are absolute (`absolute: true`, in the city's vertical datum) or heights above
the ground. An absolute top becomes a height above the lowest ground under the
piece, the same base pipeline/build_scene.py gives every solid.
"""
import json
import os

import numpy as np
import shapely
from PIL import Image, ImageDraw
from shapely.geometry import Polygon

from cityctx import polygons


class Survey:
    MERGE_M, MIN_PIECE_M2, MIN_PIECE_SHARE, SPIRE_M = 1.5, 8.0, 0.04, 8.0
    LIDAR_MIN_M, LIDAR_INSET_M = 2.5, 1.0
    # a surveyed piece the laser saw far lower, on a block surveyed before the flight, is a block
    # outline drawn round more than one building (a low block under its high block's top)
    LIDAR_LOWER_M, LIDAR_LOWER_SHARE = 15.0, 0.25

    def __init__(self, C, ground, dsm=None, dsm_cell=1.0):
        """ground(xs, ys) -> bare-earth heights at the ring's vertices (the build's own sampler);
        dsm: a LiDAR surface model on the local frame's grid (row 0 at the north edge), or None."""
        self.C, self.ground, self.tree, self.dsm, self.cell = C, ground, None, dsm, dsm_cell
        self.used, self.lidar_n, self.lowered, self.owner = set(), 0, [], {}
        sc = C.cfg.get("surface_check") or {}
        self.flight_ms = sc.get("flown_ms")  # when the LiDAR was flown (epoch ms), to tell new buildings from coarse blocks
        cfg = C.cfg.get("survey")
        path = os.path.join(C.raw, "survey.json")
        if not cfg or not os.path.exists(path):
            return
        self.cfg, self.absolute = cfg, cfg.get("absolute", False)
        self.polys, self.top, self.rec = [], [], []
        for r in json.load(open(path, encoding="utf8")):
            g = C.to_local(Polygon(r["rings"][0], r["rings"][1:]))
            if not g.is_valid:
                g = g.buffer(0)
            for q in polygons(g):
                if q.area >= 2:
                    self.polys.append(q)
                    self.top.append(float(r["top"]))
                    self.rec.append(r)
        self.tree = shapely.STRtree(self.polys)
        print(f"survey: {len(self.polys)} blocks indexed")

    def base(self, q):
        """The ground a solid on q stands on: the lowest bare earth under its outline, as build_scene.py takes it."""
        cs = np.asarray(q.simplify(0.15, preserve_topology=True).exterior.coords)
        return max(float(np.min(self.ground(cs[:, 0], cs[:, 1]))), 0.0)

    def height(self, i, q):
        return self.top[i] - self.base(q) if self.absolute else self.top[i]

    def claim(self, footprints):
        """Give each block to the open-data building it fits best (intersection over union), so a
        tower block is cut into the tower's own footprint and not also into a podium footprint
        mapped round it. footprints: [(key, polygon)]."""
        if self.tree is None:
            return
        best = {}
        for key, g in footprints:
            for p in polygons(g):
                for i in self.tree.query(p):
                    inter = p.intersection(self.polys[i]).area
                    if inter <= 0:
                        continue
                    iou = inter / (p.area + self.polys[i].area - inter)
                    if iou > best.get(i, (0, None))[0]:
                        best[i] = (iou, key)
        self.owner = {i: k for i, (_, k) in best.items()}

    def pieces(self, q, key=None):
        """[(polygon, height above its ground, block index)] covering q, or None if the survey covers
        less than half of it. With a key, blocks claimed by another building are left out."""
        if self.tree is None or q.area < 1:
            return None
        cand = []
        for i in self.tree.query(q):
            if key is not None and self.owner.get(i, key) != key:
                continue
            x = q.intersection(self.polys[i])
            if x.area >= self.MIN_PIECE_M2:
                cand.append((self.top[i], i, x))
        if not cand or shapely.union_all([x for _, _, x in cand]).area < 0.5 * q.area:
            return None
        cand.sort(key=lambda t: -t[0])
        taken, out = Polygon(), []
        for top, i, x in cand:  # tallest first
            x = x.difference(taken)
            if x.area >= self.MIN_PIECE_M2:
                out.append([top, i, x])
                taken = taken.union(x)
        main = max(out, key=lambda t: t[2].area)
        out = [t for t in out if t is main or t[2].area >= self.MIN_PIECE_SHARE * q.area or (t[0] >= main[0] + self.SPIRE_M and t[2].area >= 25.0)]
        rest = q.difference(shapely.union_all([t[2] for t in out]))
        merged = []
        for top, i, x in sorted(out, key=lambda t: -t[0]):  # blocks within MERGE_M of each other become one solid
            for m in merged:
                if abs(m[0] - top) < self.MERGE_M:
                    m[2] = m[2].union(x)
                    break
            else:
                merged.append([top, i, x])
        if rest.area > 0:  # walls and overhangs the blocks miss: the nearest-height piece
            m = min(merged, key=lambda t: abs(t[0] - main[0]))
            m[2] = m[2].union(rest)
        res = []
        for top, i, x in merged:
            self.used.add(i)
            for g in polygons(x):
                if g.area >= 1:
                    res.append((g, round(self.height(i, g), 1), i))
        return res

    def surface(self, q, inset=None):
        """The LiDAR surface model's values inside q drawn `inset` m in (all of q if that leaves nothing)."""
        if self.dsm is None:
            return np.zeros(0, np.float32)
        C, c = self.C, self.cell
        inner = q.buffer(-(self.LIDAR_INSET_M if inset is None else inset))
        g = inner if inner.area >= 4 * c * c else q
        x0, y0, x1, y1 = g.bounds
        c0, r0 = max(int((x0 - C.x0) / c), 0), max(int((C.y1 - y1) / c), 0)
        c1, r1 = min(int(np.ceil((x1 - C.x0) / c)) + 1, self.dsm.shape[1]), min(int(np.ceil((C.y1 - y0) / c)) + 1, self.dsm.shape[0])
        if c1 <= c0 or r1 <= r0:
            return np.zeros(0, np.float32)
        img = Image.new("L", (c1 - c0, r1 - r0), 0)
        d = ImageDraw.Draw(img)
        for p in polygons(g):
            d.polygon([((x - C.x0) / c - c0 - 0.5, (C.y1 - y) / c - r0 - 0.5) for x, y in p.exterior.coords], fill=1)
            for r in p.interiors:
                d.polygon([((x - C.x0) / c - c0 - 0.5, (C.y1 - y) / c - r0 - 0.5) for x, y in r.coords], fill=0)
        return self.dsm[r0:r1, c0:c1][np.asarray(img, bool)]

    def measured(self, q):
        """q's roof height above its ground from the LiDAR surface model, or None."""
        v = self.surface(q)
        if len(v) < 4:
            return None
        h = float(np.median(v)) - self.base(q)
        return round(h, 1) if h >= self.LIDAR_MIN_M else None

    def lower(self, g, h, i):
        """The LiDAR height for a surveyed piece the laser saw far lower, or None to keep the survey."""
        if self.dsm is None or not self.flight_ms or not self.rec[i].get("date") or self.rec[i]["date"] >= self.flight_ms:
            return None
        v = self.surface(g)
        if len(v) < 8:
            return None
        base = self.base(g)
        p90 = float(np.percentile(v, 90)) - base
        if p90 >= self.LIDAR_MIN_M and h - p90 > max(self.LIDAR_LOWER_M, self.LIDAR_LOWER_SHARE * h):
            return round(float(np.median(v)) - base, 1)
        return None

    def apply(self, geoms, hidden=(), key=None):
        """Cut every solid in geoms ([polygon, min_height, height, source, part_name, record]) along the blocks,
        or measure it from the LiDAR surface model, except a landmark's own parts (parametric, or
        hidden for a landmark to draw instead). Returns (new geoms, the surveyed storeys of the
        largest piece or None)."""
        if self.tree is None and self.dsm is None:
            return geoms, None
        out, best = [], (0.0, None)
        for gm in geoms:
            own = gm[3] == "parametric" or id(gm[0]) in hidden
            pc = self.pieces(gm[0], key) if not own else None
            if pc:
                for g, h, i in pc:
                    lo = self.lower(g, h, i)
                    if lo is not None and lo > gm[1] + 1.0:
                        self.lowered.append([self.rec[i].get("name"), round(h, 1), lo])
                        out.append([g, gm[1], lo, "lidar", *gm[4:]])
                        continue
                    out.append([g, gm[1], max(h, gm[1] + 1.0), "survey", *gm[4:]])
                    if g.area > best[0]:
                        best = (g.area, self.rec[i].get("floors"))
                continue
            h = self.measured(gm[0]) if not own and gm[3] not in ("verified", "reference") else None
            if h is not None and h > gm[1] + 1.0:
                self.lidar_n += 1
                out.append([gm[0], gm[1], h, "lidar", *gm[4:]])
            else:
                out.append(gm)
        return out, best[1]

    def additions(self, covered, extent, min_area=30.0):
        """Blocks the open-data footprints (union `covered`) do not cover: [(polygon, record)]."""
        if self.tree is None:
            return []
        parts = polygons(covered)
        ptree = shapely.STRtree(parts)
        out, kept = [], []
        for i in sorted(range(len(self.polys)), key=lambda i: -self.polys[i].area):
            p = self.polys[i]
            if p.area < min_area or not extent.contains(p.centroid):
                continue
            near = ptree.query(p, predicate="intersects")
            if len(near) and shapely.union_all([parts[k] for k in near]).intersection(p).area > 0.25 * p.area:
                continue
            if any(p.intersection(self.polys[j]).area > 0.4 * p.area for j in kept):
                continue
            kept.append(i)
            out.append((p, self.rec[i]))
        return out

    def summary(self):
        s = {"lidar_measured_solids": self.lidar_n, "lidar_lowered": self.lowered}
        if self.tree is not None:
            s |= {"blocks": len(self.polys), "blocks_used": len(self.used), "source": self.cfg.get("attribution")}
        return s
