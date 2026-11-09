"""Valid footprints for the solids in buildings.json.

A solid's rings are stored in whole decimetres. Rounding a valid footprint to that grid (and a source footprint that
was never valid) leaves some rings crossing or touching themselves, a hole touching its shell, or a hole of fewer than
three distinct points. The two readers of a ring then disagree about what it covers: the browser draws it through
three.js's earcut, which fills such a shape its own way, while the game's collision tests points by the even-odd rule.
Where they differ, a block is drawn where the collision has open roof, and a helicopter set down there, or a walker,
stands inside it (Shibuya's Scramble Square block, 2026-11). valid_rings() gives a solid one valid polygon in
decimetres, so both read the same shape.

    python pipeline/solid_rings.py shibuya [more city ids]   # repair web/data/<id>/buildings.json in place, then pack
    python pipeline/solid_rings.py --check [city ids]          # fail on a solid that is not valid (tools/check.sh: live cities)
"""
import json
import os
import sys

import shapely
import shapely.errors
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _pts(r):
    return [(r[k], r[k + 1]) for k in range(0, len(r) - 1, 2)]


def _flat(coords):
    a = list(coords)[:-1]
    return [int(round(v)) for xy in a for v in xy]


def _distinct(r):
    return len(set(_pts(r)))


def _polygon(rings):
    return Polygon(_pts(rings[0]), [_pts(h) for h in rings[1:]])


def _largest(g):
    polys = [p for p in getattr(g, "geoms", [g]) if p.geom_type == "Polygon" and not p.is_empty]
    for p in getattr(g, "geoms", []):
        if p.geom_type in ("MultiPolygon", "GeometryCollection"):
            polys += [q for q in p.geoms if q.geom_type == "Polygon"]
    return max(polys, key=lambda p: p.area) if polys else None


def valid_rings(rings):
    """rings: [outer, *holes], each a flat [x, y, x, y, ...] list of decimetres. Returns rings of one valid polygon
    (the outer anticlockwise, as the build writes them), the same rings when they are valid already, or None when
    nothing of the footprint is left."""
    holes = [h for h in rings[1:] if _distinct(h) >= 3]
    rings = [rings[0]] + holes
    if _distinct(rings[0]) < 3:
        return None
    p = _polygon(rings)
    if p.is_valid:
        return rings
    g = shapely.make_valid(p)
    q = _largest(g)
    # a ring that crosses itself comes apart into pieces (a bow tie into two triangles): pieces that meet at a point
    # or nearly are closed up into one by 0.2 m, so that no part of the block is lost; else the largest
    parts = [r for r in getattr(g, "geoms", [g]) if r.geom_type == "Polygon" and r.area > 200]
    if len(parts) > 1:
        c = _largest(shapely.union_all(parts).buffer(2, join_style="mitre").buffer(-2, join_style="mitre"))
        if c is not None and c.area >= 0.98 * sum(r.area for r in parts):
            q = c
    for _ in range(4):
        if q is None or q.area < 1:
            return None
        q = orient(q, 1.0)
        out = [_flat(q.exterior.coords)] + [_flat(r.coords) for r in q.interiors]
        out = [out[0]] + [h for h in out[1:] if _distinct(h) >= 3]
        if _distinct(out[0]) >= 3 and _polygon(out).is_valid:
            return out
        # rounded back to the grid it broke again: settle it on the grid
        try:
            q = _largest(shapely.set_precision(shapely.make_valid(_polygon(out)), 1.0))
        except shapely.errors.GEOSException:
            q = _largest(shapely.make_valid(Polygon(_pts(out[0]))))  # (the shell alone, its holes given up)
    return [_flat(q.exterior.coords)] if q is not None and q.area >= 1 and Polygon(q.exterior).is_valid else None


def _edges(r):
    p = _pts(r)
    return [(p[k], p[(k + 1) % len(p)]) for k in range(len(p))]


def remap_edges(old, new, ks):
    """The edges of the outer ring `new` that stand where the edges `ks` of `old` stood: each to the edge of the same
    direction whose midpoint is nearest, within a metre (10 dm), else None. A shopfront row (buildings.json "f") names
    the edges of its solid's outer ring by index, and the browser reads them from the ring it is given."""
    oe, ne = _edges(old), _edges(new)
    out = []
    for k in ks:
        if k >= len(oe):
            out.append(None)
            continue
        (ax, ay), (bx, by) = oe[k]
        mx, my, dx, dy = (ax + bx) / 2, (ay + by) / 2, bx - ax, by - ay
        best, bd = None, 10.0
        for j, ((cx, cy), (ex, ey)) in enumerate(ne):
            fx, fy = ex - cx, ey - cy
            if dx * fx + dy * fy <= 0.9 * (dx * dx + dy * dy) ** 0.5 * (fx * fx + fy * fy) ** 0.5:
                continue
            d = ((cx + ex) / 2 - mx) ** 2 + ((cy + ey) / 2 - my) ** 2
            d = d ** 0.5
            if d < bd:
                best, bd = j, d
        out.append(best)
    return out


def repair(city):
    path = os.path.join(ROOT, "web", "data", city, "buildings.json")
    B = json.load(open(path, encoding="utf8"))
    fixed = lost = 0
    fronts = {f[0]: f for f in B.get("f", [])}
    for si, s in enumerate(B["s"]):
        rings = s[4:]
        out = valid_rings(rings)
        if out is None:
            # (kept, so that every solid keeps its index: hidden_solids and the game name solids by it)
            lost += 1
            continue
        if out != rings:
            f = fronts.get(si)
            if f is not None and out[0] != rings[0]:
                ks, fl = f[1::2], f[2::2]
                to = remap_edges(rings[0], out[0], ks)
                kept = {}
                for k, v in zip(to, fl):
                    if k is not None:
                        kept[k] = kept.get(k, 0) | v
                f[1:] = [x for k in sorted(kept) for x in (k, kept[k])]
            s[4:] = out
            fixed += 1
    if "f" in B:
        B["f"] = [f for f in B["f"] if len(f) > 1]
    if fixed:
        json.dump(B, open(path, "w", encoding="utf8"), separators=(",", ":"))
    print(f"{city}: {fixed} of {len(B['s'])} solids made valid, {lost} left as they were (nothing left of them)")
    return fixed


def check(city):
    B = json.load(open(os.path.join(ROOT, "web", "data", city, "buildings.json"), encoding="utf8"))
    bad = [i for i, s in enumerate(B["s"]) if valid_rings(s[4:]) != s[4:]]
    bad += [f[0] for f in B.get("f", []) if any(k >= len(B["s"][f[0]][4]) // 2 for k in f[1::2])]  # (a front past its ring's end)
    print(f"{'FAIL' if bad else 'ok  '} {city}: {len(bad)} of {len(B['s'])} solids not valid on their grid"
          + (f" (first {bad[:5]}; python pipeline/solid_rings.py {city}, then pipeline/pack.py)" if bad else ""))
    return not bad


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--check":
        ok = [check(c) for c in args[1:]]
        sys.exit(0 if all(ok) else 1)
    for c in args:
        repair(c)
