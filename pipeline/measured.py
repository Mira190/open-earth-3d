"""Measured building heights and roofs for France, from IGN (Licence Ouverte 2.0), read from
the files pipeline/fetch_ign.py writes. build_scene.py uses this source in place of
PLATEAU (the same interface: match, pieces, additions, named) when city.json has an
"ign" block.

  BD TOPO   cadastral footprints with the eaves height ("hauteur": ground to the gutter,
            from stereo photogrammetry), floor counts, construction dates, use, and wall
            and roof materials from the Fichiers fonciers (the land tax files)
  LiDAR HD  the normalised surface model (MNH, 0.5 m pixels): every return's height above
            the bare earth, flown in winter (Paris: 2 and 3 March 2023)

What the LiDAR gives each Overture footprint:
  * its top: the 95th percentile inside the footprint, inset 0.6 m so walls, cornices and
    street trees stay out (chimneys and lift overruns are under 5% of a roof)
  * its parts: a footprint whose heights fall into levels with a clear gap between them
    (a cathedral's towers over its nave, a block's wings) is cut into one piece per level;
    a level at ground height is an open courtyard and is cut out
  * its roof: the BD TOPO eaves and the LiDAR top give the roof's height; the profile
    from the walls inwards gives its shape. A mansard (the Paris roof since the 1850s)
    reaches most of its height within 3 m of the facade; a hipped or gabled roof rises
    steadily to its ridge; a flat roof has under 1.2 m between eaves and top.
"""
import json
import os

import numpy as np
import shapely
from PIL import Image, ImageDraw
from pyproj import Transformer
from scipy import ndimage
from shapely.geometry import Polygon, box

Image.MAX_IMAGE_PIXELS = None

# Fichiers fonciers material codes (DGFiP MAJIC): walls 1 stone, 2 millstone grit (meulière),
# 3 concrete, 4 brick, 5 breeze block, 6 timber, 9 other; roofs 1 tile, 2 slate, 3 zinc or
# aluminium, 4 concrete, 9 other. BD TOPO joins up to two codes ("23": slate and zinc), "00"
# is unknown.
WALLS = {"1": "stone", "2": "meuliere", "3": "concrete", "4": "brick", "5": "block", "6": "timber"}
ROOFS = {"1": "tile", "2": "slate", "3": "zinc", "4": "concrete"}
# BD TOPO use and nature -> the OSM building classes the pipeline knows
USAGE = {"Résidentiel": "apartments", "Commercial et services": "commercial", "Sportif": "sports_centre",
         "Industriel": "industrial", "Agricole": "farm_auxiliary"}
NATURE = {"Eglise": "church", "Chapelle": "chapel", "Monument": "monument", "Tour, donjon": "tower", "Serre": "greenhouse",
          "Château": "castle", "Arc de triomphe": "monument", "Industriel, agricole ou commercial": "commercial"}


def materials(code, table):
    """The materials a Fichiers fonciers code names, main first."""
    return [table[c] for c in (code or "") if c in table]


class IGNHeights:
    """BD TOPO buildings and LiDAR HD heights over a city's extent."""
    key, label, footprint = "ign", "BD TOPO", "B"
    # the LiDAR is recent (2023) and BD TOPO carries what was built since: an OSM height far above
    # both is a spire or a chimney counted as the building's top, not a newer tower
    keep_newer_osm = False
    # the LiDAR covers every part: each mapped building part takes its own measured top
    cut_parts = True
    INSET_M = 0.6
    GAP_M = 3.0             # levels are split where no more than 0.5% of the heights fall in a 3 m band
    MIN_PIECE_M2, MIN_PIECE_SHARE = 30.0, 0.05
    COURTYARD_M = 1.5       # a level below this is open ground inside the footprint
    ROOF_M = 2.8            # the median LiDAR top over the BD TOPO eaves, central Paris (25,591 buildings)

    def __init__(self, C):
        self.C, self.rows, self.polys, self.tree, self.mnh = C, [], [], None, None
        self.cfg = C.cfg.get("ign") or {}
        path = os.path.join(C.raw, "bdtopo_batiment.json")
        if not self.cfg or not os.path.exists(path):
            return
        extent = box(C.x0, C.y0, C.x1, C.y1).buffer(60)
        holes = [(C.fwd.transform(*e["at"]), e["radius_m"]) for e in self.cfg.get("exclude", [])]
        for r in json.load(open(path))["buildings"]:
            ps = [Polygon(ring) for ring in r["rings"]]
            g = C.to_local(shapely.union_all([p if p.is_valid else p.buffer(0) for p in ps]))
            if not g.is_valid:
                g = g.buffer(0)
            if g.is_empty or not extent.intersects(g) or any(np.hypot(g.centroid.x - c[0], g.centroid.y - c[1]) < rad for c, rad in holes):
                continue
            self.rows.append(r)
            self.polys.append(g)
        self.tree = shapely.STRtree(self.polys)
        print(f"ign: {len(self.polys)} BD TOPO footprints indexed")
        mp = os.path.join(C.raw, "lidar_mnh.tif")
        if os.path.exists(mp):
            self.mnh = np.asarray(Image.open(mp), dtype=np.float32)
            meta = json.load(open(mp.replace(".tif", ".json")))
            self.bbox, (self.w, self.h) = meta["bbox"], meta["size"]
            self.px = (self.bbox[2] - self.bbox[0]) / self.w
            self.to_r = Transformer.from_crs(C.proj, meta["crs"], always_xy=True)
            self.from_r = Transformer.from_crs(meta["crs"], C.proj, always_xy=True)
            print(f"ign: LiDAR HD MNH {self.w} x {self.h} px at {self.px} m")

    # ------------------------------------------------------------ BD TOPO records
    def _record(self, r):
        year = r.get("date_d_apparition")
        cls = NATURE.get(r.get("nature")) or USAGE.get(r.get("usage_1") or "", "")
        return {"class": cls, "storeys": r.get("nombre_d_etages"), "name": None, "eaves_m": r.get("hauteur"),
                "year": int(year[:4]) if year else None, "walls": materials(r.get("materiaux_des_murs"), WALLS),
                "roofs": materials(r.get("materiaux_de_la_toiture"), ROOFS), "rnb": (r.get("identifiants_rnb") or "").split("/")[0],
                "h": r.get("hauteur")}

    def match(self, g):
        """The BD TOPO record of the building that is the same as footprint g (at least half of
        one lies in the other), or None: its class, storeys, eaves height, year and materials."""
        if self.tree is None:
            return None
        best, best_a = None, 0.0
        for j in self.tree.query(g):
            a = g.intersection(self.polys[j]).area
            if a > best_a and (a >= 0.5 * self.polys[j].area or a >= 0.5 * g.area):
                best, best_a = j, a
        return None if best is None else self._record(self.rows[best])

    def named(self, name):
        return None

    # ------------------------------------------------------------ LiDAR samples
    def _window(self, q):
        """(heights, mask, distance to the footprint's edge in metres, window origin) for q, or None."""
        if self.mnh is None or q.is_empty:
            return None
        x0, y0, x1, y1 = self.bbox
        rings = []
        for p in getattr(q, "geoms", [q]):
            if p.geom_type == "Polygon" and p.area >= 1:
                rings.append([np.c_[self.to_r.transform(*np.asarray(p.exterior.coords).T)]]
                             + [np.c_[self.to_r.transform(*np.asarray(r.coords).T)] for r in p.interiors])
        if not rings:
            return None
        allxy = np.vstack([r[0] for r in rings])
        c0, c1 = int((allxy[:, 0].min() - x0) / self.px) - 1, int(np.ceil((allxy[:, 0].max() - x0) / self.px)) + 2
        r0, r1 = int((y1 - allxy[:, 1].max()) / self.px) - 1, int(np.ceil((y1 - allxy[:, 1].min()) / self.px)) + 2
        c0, r0, c1, r1 = max(c0, 0), max(r0, 0), min(c1, self.w), min(r1, self.h)
        if c1 - c0 < 2 or r1 - r0 < 2:
            return None
        im = Image.new("L", (c1 - c0, r1 - r0), 0)
        d = ImageDraw.Draw(im)
        tr = lambda a: [((x - x0) / self.px - c0, (y1 - y) / self.px - r0) for x, y in a]
        for ext, *hs in rings:
            d.polygon(tr(ext), fill=1)
            for hh in hs:
                d.polygon(tr(hh), fill=0)
        m = np.asarray(im, bool)
        if m.sum() < 8:
            return None
        v = self.mnh[r0:r1, c0:c1]
        dist = ndimage.distance_transform_edt(m) * self.px
        return v, m & np.isfinite(v) & (v > -5), dist, (c0, r0)

    def lidar(self, q):
        """{top, p50, p25, n} of the LiDAR heights inside q (inset), or None."""
        w = self._window(q)
        if w is None:
            return None
        v, m, dist, _ = w
        s = v[m & (dist >= self.INSET_M)]
        if len(s) < 8:
            s = v[m]
        if len(s) < 8:
            return None
        p25, p50, p95 = np.percentile(s, [25, 50, 95])
        return {"top": float(p95), "p50": float(p50), "p25": float(p25), "n": int(len(s))}

    # ------------------------------------------------------------ the PLATEAU interface
    def pieces(self, q):
        """[(polygon, height, source)] covering q (less any open courtyard), or None where the
        LiDAR does not cover it. One piece unless the heights fall into levels."""
        if self.tree is None or q.area < 1:
            return None
        rec = self.match(q)
        eaves = (rec or {}).get("eaves_m")
        # no LiDAR here (IGN blanks a few sensitive sites, the Élysée among them): the surveyed eaves
        # and the median measured roof
        fallback = [(p, round(eaves + self.ROOF_M, 1), "bdtopo") for p in _polys(q)] if eaves and eaves > 2 else None
        w = self._window(q) if self.mnh is not None else None
        if w is None:
            return fallback
        v, m, dist, org = w
        inner = m & (dist >= self.INSET_M)
        s = v[inner] if inner.sum() >= 8 else v[m]
        if len(s) < 8:
            return fallback
        top = float(np.percentile(s, 95))
        if fallback and top < 0.6 * eaves - 1.0:
            return fallback
        if q.area < 250 or top - float(np.percentile(s, 10)) < 6.0:
            if top < self.COURTYARD_M:
                return None  # nothing standing: built since the flight, or not a building
            return [(p, round(top, 1), "lidar") for p in _polys(q)]
        levels = self._levels(s)
        if len(levels) == 1:
            return [(p, round(top, 1), "lidar") for p in _polys(q)]
        # each pixel to its level, a majority filter against speckle (chimneys, parapets)
        sm = ndimage.median_filter(np.where(m, v, 0.0), size=3)
        lab = np.full(v.shape, -1, int)
        for i, (lo, hi) in enumerate(levels):
            lab[m & (sm >= lo) & (sm < hi)] = i
        out = []
        for i, (lo, hi) in enumerate(levels):
            mask = ndimage.binary_opening(lab == i, iterations=2)
            if mask.sum() * self.px ** 2 < self.MIN_PIECE_M2:
                continue
            poly = self._polygon(mask, org).intersection(q)
            poly = poly.buffer(0.5).buffer(-0.5).intersection(q)
            if poly.is_empty or poly.area < max(self.MIN_PIECE_M2, self.MIN_PIECE_SHARE * q.area):
                continue
            vals = v[mask & m]
            out.append([float(np.percentile(vals, 90)), poly])
        if not out:
            return [(p, round(top, 1), "lidar") for p in _polys(q)]
        out.sort(key=lambda t: -t[0])
        taken, res = Polygon(), []
        for h, poly in out:  # tallest first; the rest of the footprint goes to the largest standing piece
            x = poly.difference(taken)
            if x.area >= self.MIN_PIECE_M2:
                res.append([h, x])
                taken = taken.union(x)
        standing = [t for t in res if t[0] >= self.COURTYARD_M]
        if not standing:
            return None
        court = shapely.union_all([t[1] for t in res if t[0] < self.COURTYARD_M]) if len(standing) < len(res) else Polygon()
        rest = q.difference(taken)
        if rest.area > 0:
            main = max(standing, key=lambda t: t[1].area)
            main[1] = main[1].union(rest.difference(court))
        return [(g, round(h, 1), "lidar") for h, x in standing for g in _polys(x.buffer(0)) if g.area >= 2]

    def _levels(self, s):
        """[(low, high)] height bands separated by gaps of GAP_M with almost no returns."""
        lo, hi = float(np.percentile(s, 0.5)), float(np.percentile(s, 99.5))
        bins = np.arange(np.floor(lo) - 1, np.ceil(hi) + 2, 1.0)
        hist, _ = np.histogram(s, bins)
        empty = hist <= 0.005 * len(s)
        cuts, run = [], 0
        for k, e in enumerate(empty):
            run = run + 1 if e else 0
            if run == int(self.GAP_M):
                cuts.append(bins[k - run + 1])
        edges = [-1e9] + cuts + [1e9]
        out = []
        for a, b in zip(edges[:-1], edges[1:]):
            n = ((s >= a) & (s < b)).sum()
            if n * self.px ** 2 >= self.MIN_PIECE_M2 and n >= self.MIN_PIECE_SHARE * len(s):
                out.append((a, b))
        if not out:
            return [(-1e9, 1e9)]
        # bands too small to stand alone join the band below them
        out[0] = (-1e9, out[0][1])
        out[-1] = (out[-1][0], 1e9)
        return [(a, out[i + 1][0] if i + 1 < len(out) else b) for i, (a, b) in enumerate(out)]

    def _polygon(self, mask, org):
        """A raster mask as a polygon in the local frame: row runs joined."""
        c0, r0 = org
        x0, y1 = self.bbox[0], self.bbox[3]
        boxes = []
        for r in range(mask.shape[0]):
            row = mask[r]
            if not row.any():
                continue
            d = np.diff(np.r_[0, row.astype(np.int8), 0])
            for a, b in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]):
                boxes.append(box(x0 + (c0 + a) * self.px, y1 - (r0 + r + 1) * self.px, x0 + (c0 + b) * self.px, y1 - (r0 + r) * self.px))
        g = shapely.union_all(boxes).simplify(self.px * 0.75)
        return shapely.transform(g, lambda c: np.column_stack(self.from_r.transform(c[:, 0], c[:, 1])))

    def additions(self, covered):
        """BD TOPO buildings that no Overture footprint covers by more than a quarter, with a
        LiDAR height: [(polygon, record)]."""
        if self.tree is None:
            return []
        min_area = self.cfg.get("add_min_m2", 25.0)
        parts = _polys(covered)
        ptree = shapely.STRtree(parts)
        out = []
        for p, r in zip(self.polys, self.rows):
            if p.area < min_area or p.geom_type != "Polygon":
                continue
            near = ptree.query(p, predicate="intersects")
            if len(near) and shapely.union_all([parts[k] for k in near]).intersection(p).area > 0.25 * p.area:
                continue
            L = self.lidar(p)
            h = L["top"] if L else r.get("hauteur")
            if not h or h < 2.0:
                continue
            out.append((p, self._record(r) | {"h": round(h, 1)}))
        return out

    # ------------------------------------------------------------ roofs
    def roof(self, q, rec, h0, h1):
        """(shape, roof height, material) of a solid's roof from its LiDAR profile and the BD TOPO
        eaves: ("flat", 0, material) for a flat roof, None where the LiDAR does not see it.

        The profile is the median height in bands of distance from the walls. A roof that does
        not rise from its eaves to its core is flat, whatever plant stands on it. One that
        gains most of its height within 2.6 m of the facade is a mansard (a steep brisis under a
        low terrasson); one that rises steadily is hipped. Where more than a third of the
        outline is a party wall against the next building, the ends are gables (a gambrel, or a
        gabled roof), as on a Paris street, where roofs slope to the street and the courtyard."""
        w = self._window(q)
        if w is None:
            return None
        v, m, dist, _ = w
        if m.sum() < 30:
            return None
        band = lambda a, b: v[m & (dist >= a) & (dist < b)]
        med = lambda x: float(np.median(x)) if len(x) >= 6 else None
        dmax = float(dist[m].max())
        e1, e2 = med(band(0.4, 1.2)), med(band(1.6, 2.6))
        core = med(band(max(3.0, 0.6 * dmax), 1e9))
        eaves = rec.get("eaves_m") if rec else None
        if not eaves or not (h0 + 2.0 <= eaves <= h1 - 0.3):
            edge = band(0.25, 1.0)
            eaves = float(np.percentile(edge, 10)) if len(edge) >= 8 else None
        mats = (rec or {}).get("roofs") or []
        if eaves is None or e1 is None:
            return None
        if h1 - eaves < 1.2:
            return "flat", 0.0, None
        # the roof's core over the eaves: a flat deck stays near the eaves, whatever plant stands on it
        rise = (core if core is not None else float(np.percentile(v[m], 75))) - eaves
        if rise < 1.0:
            return "flat", 0.0, None
        rh = h1 - eaves
        steep = (e2 - eaves) / rh if e2 is not None else 0.0
        party = self.party_share(q)
        if steep >= 0.55 and dmax >= 3.0:
            shape = "gambrel" if party >= 0.35 else "mansard"
        else:
            shape = "gabled" if party >= 0.35 else "hipped"
        mat = next((x for x in mats if x in ("zinc", "slate", "tile")), None)
        return shape, round(rh, 1), mat

    def party_share(self, q):
        """The share of q's outline that runs along another BD TOPO building (within 0.6 m)."""
        if self.tree is None:
            return 0.0
        rim = q.exterior.buffer(0.6) if q.geom_type == "Polygon" else q.boundary.buffer(0.6)
        others = [self.polys[j] for j in self.tree.query(rim) if self.polys[j].intersection(q).area < 0.5 * min(q.area, self.polys[j].area)]
        if not others:
            return 0.0
        shared = rim.intersection(shapely.union_all(others)).area / 0.6  # the neighbour fills the outer half of the band
        return min(1.0, shared / max(q.length if q.geom_type == "Polygon" else q.boundary.length, 1.0))


def _polys(g):
    if g.geom_type == "Polygon":
        return [g]
    return [p for x in getattr(g, "geoms", []) for p in _polys(x)]
