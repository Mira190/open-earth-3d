"""A phone's district: a live map cut to the part round where its game starts, as packs of its own
(issues 443, 406, 335; docs/PERFORMANCE.md, "A phone's district").

    python pipeline/district.py                 # every live city whose district is missing or stale
    python pipeline/district.py shibuya         # this city's
    python pipeline/district.py --check         # exit 1 if a live city's district is missing or stale

An iPhone's tab is killed when the page grows past what the system grants it, and what a map costs the
page scales with the map: the 2 m surface model, the walking model and the collision world, the inland
water's rasters, the packs as decoded and the objects parsed from them. A phone's game therefore loads a
district: the same map, cut here, offline, to a rectangle of four to five square kilometres round the
spawn (cities/<id>/city.json "phone_district": {"x": [x0, x1], "y": [y0, y1]}, local metres; without it, a
kilometre each way from game.start.at), and the play area is that rectangle. The page loads
web/data/<id>/d/ in place of the whole map's packs (web/world.js load):

    scene.bin       frame = the district; "world" = the whole map's frame (the ground, the aerial tiles,
                    the haze at the edge and the land past it are drawn as on the whole map); the inland
                    water clipped; the woods' and the shore's rasters cropped (woods.webp, shore.png here)
    buildings.bin   the solids that touch the district or the 200 m past its edge (scenery: the streets
                    a player at the edge looks down), and past that the skyline alone (30 m and taller:
                    what shows over the street wall and through the haze), the rows renumbered
    landmarks.bin   the meshes that touch the district or that band, and past it those 40 m and taller
    game.bin        the walking terrain and the water mask cropped, roads and footways clipped at the
                    edge (their run through the band kept apart, paths.far, to paint the streets there),
                    props inside it, and the play that can be finished inside it: people, spots,
                    travel points, stations, wharves and ferry routes, and the quests whose every step
                    lies inside (a line keeps its quests up to the first that does not)
    places.bin      places, piers and grass inside, trees to the band's edge
    vis.bin         the occluder raster (pipeline/visibility.py) cropped
    district.json   the rectangle, what was kept and cut, the bytes, and the inputs' fingerprint

Everything keeps its coordinates: the district is the same map with less in it, so the page's code is the
same and only the amount differs. The whole map's JSON stays the source; nothing here is edited by hand.
pipeline/pack.py runs this for the live cities when their packs change, and --check with its own.
"""
import base64
import gzip
import hashlib
import io
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "web", "data")
VERSION = 1
DIR = "d"
SOURCES = ("scene.json", "buildings.json", "landmarks.json", "game.json", "places.json")
SKYLINE_DM = 300       # a solid past the district is kept when it stands this tall (30 m: what a phone's first level draws there, quality.js MAP)
LANDMARK_M = 40        # and a landmark's mesh when it does
BAND_M = 200          # past the edge, this far, the streets are still built (walls, trees, landmarks): scenery, not walked
EDGE_M = 60            # inland water is clipped this far past the edge, so no channel ends in sight of it
SNAP_M = 10            # the rectangle lies on the terrain's 10 m grid (and so on the 5 m, 2.5 m and 2 m ones)


def live():
    return subprocess.run(["bash", os.path.join(ROOT, "tools", "live_cities.sh")], stdout=subprocess.PIPE, check=True, text=True).stdout.split()


def cities(named=()):
    """The live cities with a game (a district is a game's)."""
    return [c for c in (named or live()) if os.path.exists(os.path.join(DATA, c, "game.json"))]


def spec(city):
    try:
        return json.load(open(os.path.join(ROOT, "cities", city, "city.json"), encoding="utf8")).get("phone_district")
    except (OSError, ValueError):
        return None


def inputs_sha(city):
    h = hashlib.sha256(f"oe-district-{VERSION}".encode())
    h.update(json.dumps(spec(city), sort_keys=True).encode())
    d = os.path.join(DATA, city)
    for n in SOURCES + ("vis.bin",):
        p = os.path.join(d, n)
        h.update(open(p, "rb").read() if os.path.exists(p) else b"-")
    scene = json.load(open(os.path.join(d, "scene.json"), encoding="utf8"))
    for k in ("woods", "shore"):
        f = (scene.get(k) or {}).get("file")
        if f and os.path.exists(os.path.join(d, f)):
            h.update(open(os.path.join(d, f), "rb").read())
    return h.hexdigest()


def stale(city):
    try:
        meta = json.load(open(os.path.join(DATA, city, DIR, "district.json"), encoding="utf8"))
    except (OSError, ValueError):
        return "missing"
    if any(not os.path.exists(os.path.join(DATA, city, DIR, f)) for f in meta.get("files", {})):
        return "missing"
    return None if meta.get("sha256") == inputs_sha(city) else "stale"


# ------------------------------------------------------------------ geometry

class Rect:
    def __init__(self, x0, x1, y0, y1):
        self.x0, self.x1, self.y0, self.y1 = x0, x1, y0, y1

    def has(self, x, y, m=0.0):
        return self.x0 - m <= x <= self.x1 + m and self.y0 - m <= y <= self.y1 + m

    def touches(self, ax, ay, bx, by, m=0.0):
        """Whether the box (ax, ay)..(bx, by) overlaps it."""
        return bx >= self.x0 - m and ax <= self.x1 + m and by >= self.y0 - m and ay <= self.y1 + m

    def grown(self, m):
        return Rect(self.x0 - m, self.x1 + m, self.y0 - m, self.y1 + m)

    def scaled(self, k):
        return Rect(self.x0 * k, self.x1 * k, self.y0 * k, self.y1 * k)


def box_of(flat, stride=2):
    xs, ys = flat[0::stride], flat[1::stride]
    return min(xs), min(ys), max(xs), max(ys)


def rect_for(city, scene, game):
    """The district's rectangle: city.json's, else a kilometre each way from the start; inside the map's
    frame and on its 10 m grid."""
    fx, fy = scene["frame"]["x"], scene["frame"]["y"]
    s = spec(city)
    if s:
        x0, x1, y0, y1 = s["x"][0], s["x"][1], s["y"][0], s["y"][1]
    else:
        ax, ay = game["start"]["at"][:2]
        x0, x1, y0, y1 = ax - 1000, ax + 1000, ay - 1000, ay + 1000
    snap = lambda v, o: o + round((v - o) / SNAP_M) * SNAP_M
    x0, x1 = max(fx[0], snap(x0, fx[0])), min(fx[0] + ((fx[1] - fx[0]) // SNAP_M) * SNAP_M, snap(x1, fx[0]))
    y1, y0 = min(fy[1], snap(y1, fy[1])), max(fy[1] - ((fy[1] - fy[0]) // SNAP_M) * SNAP_M, snap(y0, fy[1]))
    ax, ay = game["start"]["at"][:2]
    if not (x0 + 100 < ax < x1 - 100 and y0 + 100 < ay < y1 - 100):
        raise SystemExit(f"{city}: the game's start {ax, ay} is not well inside the district {x0, x1, y0, y1}")
    num = lambda v: int(v) if float(v).is_integer() else float(v)
    return Rect(num(x0), num(x1), num(y0), num(y1))


def clip_line(p, R, stride=3):
    """The pieces of a polyline (flat, `stride` values a point, x and y first) inside R, cut at its edge with
    the other values interpolated; integers stay integers."""
    n = len(p) // stride
    pts = [p[i * stride:(i + 1) * stride] for i in range(n)]
    ints = all(isinstance(v, int) for v in p)
    out, cur = [], []

    def seg(a, b):
        # Liang-Barsky: the part of a..b inside R as (t0, t1), or None
        t0, t1 = 0.0, 1.0
        dx, dy = b[0] - a[0], b[1] - a[1]
        for d, lo, hi, v in ((dx, R.x0, R.x1, a[0]), (dy, R.y0, R.y1, a[1])):
            if d == 0:
                if v < lo or v > hi:
                    return None
                continue
            ta, tb = (lo - v) / d, (hi - v) / d
            if ta > tb:
                ta, tb = tb, ta
            t0, t1 = max(t0, ta), min(t1, tb)
            if t0 > t1:
                return None
        return t0, t1

    def at(a, b, t):
        if t <= 0:
            return list(a)
        if t >= 1:
            return list(b)
        q = [a[k] + (b[k] - a[k]) * t for k in range(stride)]
        return [int(round(v)) for v in q] if ints else [round(v, 3) for v in q]

    for i in range(n - 1):
        a, b = pts[i], pts[i + 1]
        s = seg(a, b)
        if s is None:
            if len(cur) > 1:
                out.append(cur)
            cur = []
            continue
        t0, t1 = s
        if t0 > 0 or not cur:
            if len(cur) > 1:
                out.append(cur)
            cur = [at(a, b, t0)]
        q = at(a, b, t1)
        if q != cur[-1]:
            cur.append(q)
        if t1 < 1:
            if len(cur) > 1:
                out.append(cur)
            cur = []
    if len(cur) > 1:
        out.append(cur)
    return [[v for q in piece for v in q] for piece in out]


def clip_line_outside(p, R, stride=3):
    """The pieces of a polyline outside R (the rest of clip_line's), cut at its edge."""
    n = len(p) // stride
    pts = [p[i * stride:(i + 1) * stride] for i in range(n)]
    ints = all(isinstance(v, int) for v in p)

    def at(a, b, t):
        q = [a[k] + (b[k] - a[k]) * t for k in range(stride)]
        return [int(round(v)) for v in q] if ints else [round(v, 3) for v in q]

    def inside(a, b):
        t0, t1 = 0.0, 1.0
        for d, lo, hi, v in ((b[0] - a[0], R.x0, R.x1, a[0]), (b[1] - a[1], R.y0, R.y1, a[1])):
            if d == 0:
                if v < lo or v > hi:
                    return None
                continue
            ta, tb = (lo - v) / d, (hi - v) / d
            if ta > tb:
                ta, tb = tb, ta
            t0, t1 = max(t0, ta), min(t1, tb)
            if t0 > t1:
                return None
        return t0, t1
    out, cur = [], []

    def close():
        nonlocal cur
        if len(cur) > 1:
            out.append(cur)
        cur = []
    for i in range(n - 1):
        a, b = pts[i], pts[i + 1]
        s = inside(a, b)
        if s is None:
            if not cur:
                cur = [list(a)]
            cur.append(list(b))
            continue
        t0, t1 = s
        if t0 > 0:
            if not cur:
                cur = [list(a)]
            cur.append(at(a, b, t0))
        close()
        if t1 < 1:
            cur = [at(a, b, t1), list(b)]
    close()
    return [[v for q in piece for v in q] for piece in out if any(piece[k] != piece[0] for k in range(1, len(piece)))]


def clip_ring(pts, R):
    """A ring of points (x, y, attributes...) clipped to R (Sutherland-Hodgman), the attributes interpolated."""
    def cut(P, inside, cross):
        out = []
        for i, a in enumerate(P):
            b = P[(i + 1) % len(P)]
            ia, ib = inside(a), inside(b)
            if ia:
                out.append(a)
            if ia != ib:
                t = cross(a, b)
                out.append(tuple(a[k] + (b[k] - a[k]) * t for k in range(len(a))))
        return out
    P = [tuple(p) for p in pts]
    for axis, lim, sign in ((0, R.x0, 1), (0, R.x1, -1), (1, R.y0, 1), (1, R.y1, -1)):
        if len(P) < 3:
            return []
        P = cut(P, lambda p: sign * (p[axis] - lim) >= 0, lambda a, b: (lim - a[axis]) / (b[axis] - a[axis]))
    out = []
    for p in P:   # (points doubled along the edge go)
        if not out or abs(p[0] - out[-1][0]) > 1e-6 or abs(p[1] - out[-1][1]) > 1e-6:
            out.append(p)
    return out if len(out) >= 3 else []


# ------------------------------------------------------------------ the cuts

def cut_buildings(B, scene, LM, R):
    """The solids that touch the district and the skyline past it, with their buildings, roofs, fronts and
    rooftop plant; every row index renumbered. Returns the cut pack and the old-to-new solid index."""
    Rd = R.grown(BAND_M).scaled(10)
    keep, far = [], 0
    for si, s in enumerate(B["s"]):
        ax, ay, bx, by = box_of(s[4])
        if Rd.touches(ax, ay, bx, by):
            keep.append(si)
        elif s[3] >= SKYLINE_DM:
            keep.append(si)
            far += 1
    smap = {si: i for i, si in enumerate(keep)}
    bkeep = sorted({B["s"][si][0] for si in keep})
    bmap = {bi: i for i, bi in enumerate(bkeep)}
    out = dict(B)
    out["b"] = [B["b"][bi] for bi in bkeep]
    out["s"] = [[bmap[B["s"][si][0]]] + B["s"][si][1:] for si in keep]
    for k in ("r", "f", "p"):
        if k in B:
            out[k] = [[smap[row[0]]] + row[1:] for row in B[k] if row[0] in smap]
    if "passages" in B:
        out["passages"] = [smap[si] for si in B["passages"] if si in smap]
    for k in ("inner_posts", "no_posts"):
        if isinstance(B.get(k), dict):
            out[k] = {str(bmap[int(bi)]): v for bi, v in B[k].items() if int(bi) in bmap}
    known = {"fields", "b", "s_fields", "s", "styles", "roof_shapes", "roof_materials", "roof_sources", "r_fields", "r", "f_fields", "f",
             "p_fields", "p", "passages", "inner_posts", "no_posts", "note"}
    odd = [k for k in B if k not in known]
    if odd:
        raise SystemExit(f"buildings.json has keys this cut does not know: {odd} (pipeline/district.py cut_buildings)")
    return out, smap, {"buildings": len(bkeep), "solids": len(keep), "skyline": far}


def mesh_box(m):
    p = m["position"]
    return min(p[0::3]), min(p[1::3]), max(p[0::3]), max(p[1::3]), min(p[2::3]), max(p[2::3])


def cut_landmarks(LM, smap, R):
    out = dict(LM)
    R = R.grown(BAND_M)   # (with the scenery past the edge)
    meshes, far = [], 0
    for m in LM.get("meshes", []):
        if not m.get("position"):
            continue
        ax, ay, bx, by, z0, z1 = mesh_box(m)
        if R.touches(ax, ay, bx, by):
            meshes.append(m)
        elif z1 - z0 >= LANDMARK_M and not m.get("detail") and not m.get("far"):
            meshes.append(m)
            far += 1
    out["meshes"] = meshes
    props = []
    for pr in LM.get("props", []):
        at = [a for a in pr.get("at", []) if R.has(a[0], a[1])]
        if at:
            props.append(dict(pr, at=at))
    if "props" in LM:
        out["props"] = props
    used = {m["material"] for m in meshes} | {p["material"] for pr in props for p in pr.get("parts", [])}
    out["materials"] = {k: v for k, v in LM.get("materials", {}).items() if k in used}
    for k in ("hidden", "demolished"):
        if k in LM:
            out[k] = [smap[si] for si in LM[k] if si in smap]
    if "clip" in LM:
        out["clip"] = [c for c in LM["clip"] if R.touches(*box_of([v for q in c["ring"] for v in q]))]
    for k in ("water_cover", "seawalls"):
        if k in LM:
            out[k] = [r for r in LM[k] if R.touches(*box_of([v for q in r for v in q[:2]]), m=EDGE_M)]
    for k in ("treeless", "bare"):   # rings in decimetres: no tree, no lamp or bench of the map's
        if k in LM:
            out[k] = [r for r in LM[k] if R.scaled(10).touches(*box_of(r))]
    if "passages" in LM:
        out["passages"] = [p for p in LM["passages"] if any(R.has(q[0], q[1]) for q in p["pts"])]
    if "trees" in LM:
        out["trees"] = cut_trees(LM["trees"], R)
    if "glows" in LM:
        out["glows"] = [g for g in LM["glows"] if R.has(g[0], g[1], 400)]
    known = {"materials", "meshes", "notes", "hidden", "demolished", "trees", "clip", "props", "glows", "water_cover", "seawalls", "treeless", "bare", "passages"}
    odd = [k for k in LM if k not in known]
    if odd:
        raise SystemExit(f"landmarks.json has keys this cut does not know: {odd} (pipeline/district.py cut_landmarks)")
    return out, {"meshes": len(meshes), "skyline_meshes": far, "materials": len(out["materials"])}


def cut_trees(T, R):
    """Trees as [x_dm, y_dm, ...] rows of four, flat or nested: those inside."""
    Rd = R.scaled(10)
    if T and isinstance(T[0], list):
        return [t for t in T if Rd.has(t[0], t[1])]
    out = []
    for i in range(0, len(T), 4):
        if Rd.has(T[i], T[i + 1]):
            out += T[i:i + 4]
    return out


def poly_touches(polys, R, scale=10):
    Rd = R.scaled(scale)
    return any(Rd.touches(*box_of(ring)) for poly in polys for ring in poly)


def poly_centre(polys):
    xs = [v for poly in polys for v in poly[0][0::2]]
    ys = [v for poly in polys for v in poly[0][1::2]]
    return sum(xs) / len(xs) / 10, sum(ys) / len(ys) / 10


def cut_places(P, R):
    out = dict(P)
    out["places"] = [p for p in P.get("places", []) if poly_touches(p["polygons"], R)]
    for k in ("trees", "woods"):
        if k in P:
            out[k] = cut_trees(P[k], R.grown(BAND_M))
    if "piers" in P:
        out["piers"] = [r for r in P["piers"] if R.scaled(10).touches(*box_of(r))]
    if "grass" in P:
        out["grass"] = {sp: [dict(a, polygons=[pl for pl in a["polygons"] if poly_touches([pl], R)]) for a in areas if poly_touches(a["polygons"], R)]
                        for sp, areas in P["grass"].items()}
    known = {"places", "trees", "woods", "piers", "grass", "note"}
    odd = [k for k in P if k not in known]
    if odd:
        raise SystemExit(f"places.json has keys this cut does not know: {odd} (pipeline/district.py cut_places)")
    return out


def crop_grid(nx, ny, cell, F, R):
    """Columns and rows of a node grid over the frame F (north-west origin, rows going south) that lie on R."""
    c0, c1 = round((R.x0 - F["x"][0]) / cell), round((R.x1 - F["x"][0]) / cell)
    r0, r1 = round((F["y"][1] - R.y1) / cell), round((F["y"][1] - R.y0) / cell)
    if not (0 <= c0 < c1 < nx and 0 <= r0 < r1 < ny):
        raise SystemExit(f"a {nx} x {ny} grid at {cell} m does not hold the district")
    return c0, c1, r0, r1


def cut_inland(inland, R):
    """The inland water's bodies clipped EDGE_M past the district, bank and water heights with them."""
    E = R.grown(EDGE_M)
    bodies = []
    for b in inland.get("bodies", []):
        rings, bz, wz = [], [], []
        for i, r in enumerate(b["rings"]):
            n = len(r) // 2
            pts = [(r[2 * k], r[2 * k + 1], b["bz"][i][k], b["wz"][i][k]) for k in range(n)]
            c = clip_ring(pts, E)
            if not c:
                if i == 0:
                    break    # (the outline is outside: so are its holes)
                continue
            rings.append([round(v, 2) for p in c for v in p[:2]])
            bz.append([round(p[2], 2) for p in c])
            wz.append([round(p[3], 2) for p in c])
        if rings:
            bodies.append(dict(b, rings=rings, bz=bz, wz=wz))
    out = dict(inland, bodies=bodies)
    if "decks" in inland:
        out["decks"] = [d for d in inland["decks"] if E.touches(*box_of(d))]
    return out


def crop_raster(src, dst, meta, R, lossless=True):
    """An image over meta's x0, y1, cell, nx, ny cropped to R; the new meta."""
    from PIL import Image
    im = Image.open(src)
    cell = meta["cell"]
    c0, r0 = max(0, int((R.x0 - meta["x0"]) // cell)), max(0, int((meta["y1"] - R.y1) // cell))
    c1 = min(meta["nx"], int(-(-(R.x1 - meta["x0"]) // cell)))
    r1 = min(meta["ny"], int(-(-(meta["y1"] - R.y0) // cell)))
    sx, sy = im.width / meta["nx"], im.height / meta["ny"]
    out = im.crop((round(c0 * sx), round(r0 * sy), round(c1 * sx), round(r1 * sy)))
    if dst.endswith(".webp"):
        out.save(dst, "WEBP", lossless=True, quality=100, method=6, exact=True)
    else:
        out.save(dst, optimize=True)
    num = lambda v: int(v) if float(v).is_integer() else v
    return dict(meta, file=f"{DIR}/{os.path.basename(dst)}", nx=c1 - c0, ny=r1 - r0, x0=num(meta["x0"] + c0 * cell), y1=num(meta["y1"] - r0 * cell))


def cut_scene(scene, smap, R, city, out_dir):
    out = dict(scene)
    F = scene["frame"]
    out["frame"] = dict(F, x=[R.x0, R.x1], y=[R.y0, R.y1])
    out["world"] = {"x": F["x"], "y": F["y"]}
    out["district"] = {"of": city, "v": VERSION}
    out["terrain"] = dict(scene["terrain"], x0=F["x"][0], y1=F["y"][1])
    if "hidden_solids" in scene:
        out["hidden_solids"] = [smap[si] for si in scene["hidden_solids"] if si in smap]
    if scene.get("inland"):
        out["inland"] = cut_inland(scene["inland"], R)
    for k in ("woods", "shore"):
        m = scene.get(k)
        if m and m.get("file") and os.path.exists(os.path.join(DATA, city, m["file"])):
            out[k] = crop_raster(os.path.join(DATA, city, m["file"]), os.path.join(out_dir, m["file"]), m, R.grown(BAND_M if k == "woods" else EDGE_M))
    return out


def b64_bytes(s):
    return base64.b64decode(s)


def cut_game(G, P, scene, R, city):
    """The game inside the district. Returns the cut game and what was left out, by kind."""
    out = dict(G)
    F = scene["frame"]
    cut = {}
    inr = lambda at, m=0.0: bool(at) and R.has(at[0], at[1], m)

    # ---- the walking terrain and the water mask, on the same 5 m nodes
    t = G.get("terrain")
    if t:
        c0, c1, r0, r1 = crop_grid(t["nx"], t["ny"], t["cell"], F, R)
        raw = b64_bytes(t["data"])
        nx, ny = c1 - c0 + 1, r1 - r0 + 1
        rows = [raw[2 * (r * t["nx"] + c0):2 * (r * t["nx"] + c1 + 1)] for r in range(r0, r1 + 1)]
        out["terrain"] = dict(t, nx=nx, ny=ny, data=base64.b64encode(b"".join(rows)).decode())
        w = G.get("water")
        if w and w.get("bits") is not None:
            if (w["nx"], w["ny"]) != (t["nx"], t["ny"]):
                raise SystemExit(f"{city}: the water mask is not on the terrain's grid")
            bits = b64_bytes(w["bits"])
            packed = bytearray((nx * ny + 7) // 8)
            for r in range(ny):
                for c in range(nx):
                    i = (r + r0) * w["nx"] + c + c0
                    if (bits[i >> 3] >> (7 - (i & 7))) & 1:
                        j = r * nx + c
                        packed[j >> 3] |= 1 << (7 - (j & 7))
            out["water"] = dict(w, nx=nx, ny=ny, bits=base64.b64encode(bytes(packed)).decode())
    # patches and upper floors of the terrain keep their own boxes: those that touch
    for k in ("patches", "upper"):
        if isinstance(G.get(k), list):
            out[k] = [p for p in G[k] if "x0" not in p or R.touches(p["x0"], p.get("y0", p.get("y1", 0) - p["ny"] * p["cell"]),
                                                                     p["x0"] + p["nx"] * p["cell"], p.get("y1", p.get("y0", 0) + p["ny"] * p["cell"]))]

    # ---- roads and footways, cut at the edge (an end there is an open end, as at the whole map's edge)
    Rd = R.scaled(10)
    paths = {}
    for kind, rows in (G.get("paths") or {}).items():
        keep = []
        for row in rows:
            for piece in clip_line(row["p"], Rd, 3):
                keep.append(dict(row, p=piece))
        paths[kind] = keep
    if "paths" in G:
        # and past the edge, to the end of the scenery band, the same roads and footways to be painted on the ground
        # there (game.js streetTexture) and nothing else: no one walks or drives them
        Bd = R.grown(BAND_M).scaled(10)
        far = {}
        for kind, rows in G["paths"].items():
            far[kind] = [dict(row, p=q) for row in rows for piece in clip_line(row["p"], Bd, 3) for q in clip_line_outside(piece, Rd, 3)]
        paths["far"] = far
        out["paths"] = paths

    # ---- street furniture: [x_dm, y_dm, z_dm] rows
    if "props" in G:
        out["props"] = {k: [v for i in range(0, len(flat), 3) if Rd.has(flat[i], flat[i + 1]) for v in flat[i:i + 3]] for k, flat in G["props"].items()}

    # ---- things at a point: kept where the point is inside
    def by_at(key, at=lambda o: o.get("at"), m=0.0):
        if not isinstance(G.get(key), list):
            return
        keep = [o for o in G[key] if inr(at(o), m)]
        if len(keep) != len(G[key]):
            cut[key] = [o.get("id") or o.get("name") or "" for o in G[key] if not inr(at(o), m)]
        out[key] = keep
    for key in ("helipads", "travel", "npcs", "spots", "chatter", "close", "scrambles", "viewpoints", "flocks", "doors", "seats", "hero", "boardwalks", "wildlife", "areas"):
        by_at(key)
    # (and any other list of things with a place, one that was added after this was written)
    for key, v in G.items():
        if key not in out or out[key] is not G[key] or not isinstance(v, list) or key in ("quests", "lines", "surfaces", "lifts", "wharves", "ferries", "interiors", "shows", "nogo"):
            continue
        if v and all(isinstance(o, dict) and isinstance(o.get("at"), list) and len(o["at"]) >= 2 for o in v):
            by_at(key)
    if isinstance(G.get("lifts"), list):
        out["lifts"] = [l for l in G["lifts"] if all(inr(s.get("at")) for s in l.get("stops", []))]
    if isinstance(G.get("interiors"), list):
        doors = {d.get("id") for d in out.get("doors", [])}
        gone = {d.get("id") for d in G.get("doors", [])} - doors
        out["interiors"] = [i for i in G["interiors"] if not (set(i.get("doors", [])) & gone) and (not i.get("at") or inr(i["at"]))]
    if isinstance(G.get("shows"), list):
        out["shows"] = [s for s in G["shows"] if not s.get("at") or inr(s["at"])]
    # strips and decks walked on: by their origin (a strip that starts inside is whole: the bridge's deck)
    if isinstance(G.get("surfaces"), list):
        def s_at(s):
            if s.get("origin"):
                return s["origin"]
            ring = s.get("ring") or s.get("polygon") or s.get("outline")
            if ring:
                flat = [v for q in ring for v in (q if isinstance(q, list) else [q])]
                ax, ay, bx, by = box_of(flat)
                return [(ax + bx) / 2, (ay + by) / 2]
            return s.get("at")
        keep = [s for s in G["surfaces"] if s_at(s) is None or inr(s_at(s), 150)]
        cut["surfaces"] = len(G["surfaces"]) - len(keep)
        out["surfaces"] = keep
    if isinstance(G.get("nogo"), list):
        out["nogo"] = [n for n in G["nogo"] if not isinstance(n, dict) or not n.get("ring") or R.touches(*box_of([v for q in n["ring"] for v in q]))]

    # ---- wharves and ferry routes: a route keeps the run of stops from its first that lie inside with the
    # water between them
    if isinstance(G.get("wharves"), list):
        ok = lambda w: inr(w.get("terminal")) and inr(w.get("berth"))
        wh = {w["id"] for w in G["wharves"] if ok(w)}
        routes = []
        for f in G.get("ferries", []):
            legs = []
            for leg in f.get("legs", []):
                if leg["from"] in wh and leg["to"] in wh and all(R.has(q[0], q[1]) for q in leg["path"]):
                    legs.append(leg)
            # the longest chain of legs that follow one another
            best, run = [], []
            for leg in legs:
                run = run + [leg] if run and run[-1]["to"] == leg["from"] else [leg]
                if len(run) > len(best):
                    best = run
            if best:
                stops = [best[0]["from"]] + [l["to"] for l in best]
                if stops[0] == stops[-1] and len(stops) > 2:
                    stops = stops[:-1]
                routes.append(dict(f, stops=stops, legs=best))
        used = {s for f in routes for s in f["stops"]}
        cut["wharves"] = [w["id"] for w in G["wharves"] if w["id"] not in used]
        out["wharves"] = [w for w in G["wharves"] if w["id"] in used]
        out["ferries"] = routes
    wharves = {w["id"] for w in out.get("wharves", [])}

    # ---- trains: the stations inside; a track keeps its stops at them (the trains run the whole course)
    tr = G.get("trains")
    stations = set()
    if isinstance(tr, dict):
        st = [s for s in tr.get("stations", []) if inr(s.get("at"))]
        stations = {s["id"] for s in st}
        cut["stations"] = [s["id"] for s in tr.get("stations", []) if s["id"] not in stations]
        tracks = [dict(k, stops=[s for s in k.get("stops", []) if s.get("station") in stations]) if "stops" in k else k for k in tr.get("tracks", [])]
        out["trains"] = dict(tr, stations=st, tracks=tracks)

    # ---- quests: a line keeps its quests up to the first that cannot be finished inside
    npcs = {n["id"] for n in out.get("npcs", [])}
    spots = {s["id"] for s in out.get("spots", [])}
    flocks = {f.get("id") for f in out.get("flocks", [])}
    places = {p["name"] for p in P.get("places", []) if inr(poly_centre(p["polygons"]))}
    strips = [s.get("name", "") for s in out.get("surfaces", [])]

    def can(s):
        ty = s.get("type")
        if "npc" in s and s["npc"] not in npcs:
            return False
        if "spot" in s and s["spot"] not in spots:
            return False
        if "flock" in s and s["flock"] not in flocks:
            return False
        if "place" in s and s["place"] not in places:
            return False
        if "at" in s and not inr(s["at"]):
            return False
        if "surface" in s and not any(n == s["surface"] or n.startswith(s["surface"] + ",") for n in strips):
            return False
        if ty == "ride":
            ends = {s.get("from"), s.get("to")}
            if not (ends <= wharves or ends <= stations):
                return False
            if ends <= wharves and not any(set(f["stops"]) >= ends for f in out.get("ferries", [])):
                return False
        if ty == "under_bridge" and not any(s.get("fly_under") for s in out.get("surfaces", [])):
            return False
        if ty not in ("visit", "talk", "spot", "surface", "ride", "land", "sun", "under_bridge", "photo", "penguins"):
            raise SystemExit(f"{city}: a quest step of type {ty!r}, which pipeline/district.py cut_game does not know")
        return True
    quests, dead = [], set()
    for q in G.get("quests", []):
        line = q.get("line")
        if line in dead or q.get("giver") not in npcs or not all(can(s) for s in q.get("steps", [])):
            dead.add(line)
            continue
        quests.append(q)
    lines_with = {q.get("line") for q in quests}
    cut["quests"] = [q["id"] for q in G.get("quests", []) if q not in quests]
    lines = []
    for l in G.get("lines", []):
        if l["id"] not in lines_with:
            continue
        l = dict(l)
        if "after" in l:
            l["after"] = [a for a in l["after"] if a in lines_with]
        lines.append(l)
    # (a choice that sends the player along a line that is not here goes too)
    for i, q in enumerate(quests):
        if "choices" in q:
            quests[i] = dict(q, choices=[c for c in q["choices"] if c.get("action") != "track" or c.get("line") in lines_with])
    if "quests" in G:
        out["quests"] = quests
    if "lines" in G:
        out["lines"] = lines
    return out, cut


def crop_vis(city, R, dst):
    """vis.bin (pipeline/visibility.py) cropped to the district: the same bytes, fewer of them."""
    src = os.path.join(DATA, city, "vis.bin")
    if not os.path.exists(src):
        return False
    raw = gzip.open(src).read()
    n = struct.unpack("<I", raw[4:8])[0]
    head = json.loads(raw[8:8 + n])
    if head.get("empty") or not head.get("w"):
        shutil.copyfile(src, dst)
        return True
    start = 8 + n + (-(8 + n)) % 8
    w, h, px = head["w"], head["h"], head["px"]
    c0, c1 = max(0, int((R.x0 - head["x0"]) // px)), min(w, int(-(-(R.x1 - head["x0"]) // px)))
    r0, r1 = max(0, int((R.y0 - head["y0"]) // px)), min(h, int(-(-(R.y1 - head["y0"]) // px)))   # (rows from the south)
    rows = b"".join(raw[start + r * w + c0:start + r * w + c1] for r in range(r0, r1))
    head = dict(head, x0=head["x0"] + c0 * px, y0=head["y0"] + r0 * px, w=c1 - c0, h=r1 - r0)
    hb = json.dumps(head, separators=(",", ":")).encode()
    pre = raw[:4] + struct.pack("<I", len(hb)) + hb
    pre += b"\0" * ((-len(pre)) % 8)
    open(dst, "wb").write(gzip.compress(pre + rows, 9, mtime=0))
    return True


def build(city):
    sys.path.insert(0, os.path.join(ROOT, "pipeline"))
    import pack
    d = os.path.join(DATA, city)
    load = lambda n: json.load(open(os.path.join(d, n), encoding="utf8"))
    scene, B, LM, G, P = (load(n) for n in SOURCES)
    R = rect_for(city, scene, G)
    out_dir = os.path.join(d, DIR)
    tmp = tempfile.mkdtemp(prefix=f"district-{city}-")
    stage = os.path.join(tmp, DIR)
    os.makedirs(stage)
    try:
        B2, smap, nb = cut_buildings(B, scene, LM, R)
        LM2, nl = cut_landmarks(LM, smap, R)
        S2 = cut_scene(scene, smap, R, city, stage)
        P2 = cut_places(P, R)
        G2, gone = cut_game(G, P2, scene, R, city)
        G2["district"] = {"x": [R.x0, R.x1], "y": [R.y0, R.y1], "cut": {k: v for k, v in gone.items() if v}}
        files = {}
        for name, obj in (("scene.json", S2), ("buildings.json", B2), ("landmarks.json", LM2), ("game.json", G2), ("places.json", P2)):
            src = os.path.join(tmp, name)
            json.dump(obj, open(src, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
            pack.pack_file(src, os.path.join(stage, name[:-5] + ".bin"), name)
        crop_vis(city, R, os.path.join(stage, "vis.bin"))
        for f in sorted(os.listdir(stage)):
            files[f] = os.path.getsize(os.path.join(stage, f))
        whole = sum(os.path.getsize(os.path.join(d, n[:-5] + ".bin")) for n in SOURCES if os.path.exists(os.path.join(d, n[:-5] + ".bin")))
        fx, fy = scene["frame"]["x"], scene["frame"]["y"]
        meta = {"note": "A phone's district of this map (pipeline/district.py): the packs here are cut from the whole map's and are never edited by hand.",
                "v": VERSION, "x": [R.x0, R.x1], "y": [R.y0, R.y1],
                "km2": round((R.x1 - R.x0) * (R.y1 - R.y0) / 1e6, 2), "of_km2": round((fx[1] - fx[0]) * (fy[1] - fy[0]) / 1e6, 2),
                "kept": dict(nb, **nl, quests=[q["id"] for q in G2.get("quests", [])]), "cut": G2["district"]["cut"],
                "files": files, "bytes": sum(files.values()), "whole_bytes": whole, "sha256": inputs_sha(city)}
        json.dump(meta, open(os.path.join(stage, "district.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
        if os.path.isdir(out_dir):
            shutil.rmtree(out_dir)
        shutil.copytree(stage, out_dir)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return meta


def main(argv):
    named = [a for a in argv if not a.startswith("--")]
    if "--check" in argv:
        bad = [(c, s) for c in cities(named) if (s := stale(c))]
        for c, s in bad:
            print(f"FAIL district {c}: {DIR}/ {s}; run python pipeline/district.py {c}")
        if not bad:
            print(f"ok   district {len(cities(named))} cities' phone districts match their packs")
        return 1 if bad else 0
    for c in cities(named):
        if not named and not stale(c):
            continue
        m = build(c)
        k = m["kept"]
        print(f"{c}: district {m['km2']} of {m['of_km2']} km2, {k['solids']} solids ({k['skyline']} skyline), {k['meshes']} landmark meshes, "
              f"quests {', '.join(k['quests']) or 'none'}; {m['bytes'] / 1e6:.2f} MB of packs for {m['whole_bytes'] / 1e6:.2f}")
        for kind, v in m["cut"].items():
            print(f"    cut {kind}: {v if isinstance(v, int) else ', '.join(map(str, v))}")
    if not ("--no-index" in argv):
        from build_scene import write_index
        write_index()
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.join(ROOT, "pipeline"))
    sys.exit(main(sys.argv[1:]))
