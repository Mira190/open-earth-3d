"""A city's big LED screens: placed on the built city, built as meshes, and played by web/world.js.

The screens a place is famous for at night (Shibuya's crossing, Shinjuku's east exit, Dotonbori)
are described in their city's city.py as a list of specs, one per screen, at the size and height
its operator publishes; this module puts them on the facades of their buildings in
web/data/<city>/buildings.json, builds their faces and frames, and writes the material that plays
their programmes (world.js "led_screen") and the light they throw on the street (web/night.js).
The programmes are clips drawn with pipeline/adkit.py: original pictures and invented brands.

A spec:
    name          the screen's name
    building      a building's name in buildings.json, or its OpenStreetMap id ("w123") where it has none
    w, h          width and height, metres
    z             the foot above the street; negative: the top that far below the roof
    roof, lift    standing on the roof, its foot `lift` metres above it (default 1.2)
    along         metres along the face, to the right seen from in front
    toward        the point the face looks to (default: the site's node); pick takes the next best face
    edge          two points: the face itself, where the footprint rounds a front off
    near          picks among buildings of the same name (the closest)
    path, round   a screen bent round a corner: the points of its foot, left to right seen from in
                  front, and the radius the corners are rounded to; its picture runs across the bends
    parts         an irregular screen cut out of its box: [[u0, u1, v0, v1], ...] (fractions)
    clips         the names of the clips it plays, in turn; phase s, its offset in the programme
    hours         [on, off] (default 9-24); sync: joins the site's synchronised slot (default true)
    pitch         LED pitch, m; bright, brightness; off, how far the face stands off the wall;
    frame         the dark frame round it, m

    S = ScreenSet("shibuya", SPECS, CLIPS, material={...}, sync=("sync", 150.0, 18.0))
    S.meshes(K, node)                 # K(material) -> meshkit.Mesh, one mesh per material
    materials["screens"] = S.material(node)
    glows += S.glows(node)
"""
import math
import os

import numpy as np
from shapely.geometry import Point, Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BUILT = {}

# the frames and roof stands every screen site uses (a city's MATERIALS may already have them)
MATERIALS = {
    "screen_frame": {"color": "#1c1e22", "roughness": 0.5, "metalness": 0.4},
    "steel_dark": {"color": "#3a3e43", "roughness": 0.5, "metalness": 0.5},
}


# ---------------------------------------------------------------- the built city

def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) or 1.0)


def left_of(f):
    return np.array([-f[1], f[0]])


def frame(o, f):
    """(u, v, z) -> point: u along the unit vector f from o, v to its left, z absolute."""
    o, f = np.asarray(o, float)[:2], unit(f)[:2]
    l = left_of(f)
    return lambda u, v, z: np.array([o[0] + f[0] * u + l[0] * v, o[1] + f[1] * u + l[1] * v, z])


def block(m, P, u0, u1, v0, v1, z0, z1):
    """A box in frame P, faces wound outward."""
    c = [P(u, v, z) for z in (z0, z1) for v in (v0, v1) for u in (u0, u1)]
    for a, b, cc, d in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
        m.quad(c[a], c[b], c[cc], c[d])


def buildings(city):
    """The built city (web/data/<city>/buildings.json): its buildings' records and solids."""
    if city not in _BUILT:
        import json
        B = json.load(open(os.path.join(ROOT, "web", "data", city, "buildings.json")))
        solids = {}
        for bi, base, mn, top, ring, *holes in B["s"]:
            r = np.asarray(ring, float).reshape(-1, 2) / 10.0
            solids.setdefault(bi, []).append({"ring": r, "base": base / 10.0, "min": mn / 10.0, "top": top / 10.0})
        _BUILT[city] = {"b": B["b"], "s": solids, "s_list": B["s"]}
    return _BUILT[city]


def building_index(city, key):
    """A building by its name, or by its OpenStreetMap id ("w123...") when it has none."""
    B = buildings(city)
    field = 6 if key[:1] in "wr" and key[1:].isdigit() else 0
    out = [i for i, b in enumerate(B["b"]) if b[field] == key]
    if not out:
        raise KeyError(f"{city}: no building {key!r} in buildings.json")
    return out


def facing_edges(g, toward, min_len=3.0):
    """Exterior edges of polygon g, best facing the point `toward` first: (score, midpoint, outward normal, length)."""
    cs = np.asarray(g.exterior.coords)
    ccw = g.exterior.is_ccw
    out = []
    for a, b in zip(cs[:-1], cs[1:]):
        e = b - a
        L = float(np.linalg.norm(e))
        if L < min_len:
            continue
        n = np.array([e[1], -e[0]]) / L if ccw else np.array([-e[1], e[0]]) / L
        mid = (a + b) / 2
        dirn = unit(np.asarray(toward) - mid)
        out.append((float(n @ dirn) * min(L, 30.0), mid, n, L))
    return sorted(out, key=lambda r: -r[0])


def facade(city, name, toward, near=None, pick=0, min_len=4.0, edge=None):
    """The face of a building that best faces the point `toward`: (midpoint, outward normal, length,
    ground z, top z). `near` picks among buildings of the same name (the closest); pick takes the
    next best face. `edge`, two points, gives the face itself, for a front the footprint rounds off
    (its normal is the side towards `toward`)."""
    B = buildings(city)
    idx = building_index(city, name)
    if near is not None:
        idx.sort(key=lambda i: min(np.hypot(*(s["ring"].mean(0) - near)) for s in B["s"].get(i, [])))
    solids = B["s"].get(idx[0], [])
    if edge is not None:
        a, b = np.asarray(edge, float)
        n = left_of(unit(b - a))
        if n @ (np.asarray(toward) - (a + b) / 2) < 0:
            n = -n
        top = max(solids, key=lambda q: q["top"])
        return (a + b) / 2, n, float(np.linalg.norm(b - a)), top["base"], top["base"] + top["top"]
    # the faces of the building's outline (its solids overlap, and a face inside it is no face), each
    # as high as the tallest solid behind it
    from shapely.ops import unary_union
    polys = [(Polygon(q["ring"]).buffer(0), q) for q in solids]
    outline = unary_union([g for g, _ in polys if g.area >= 20] or [g for g, _ in polys])
    best = []
    for g in getattr(outline, "geoms", [outline]):
        for sc, mid, n, L in facing_edges(g.simplify(0.3), toward, min_len):
            inside = Point(*(np.asarray(mid) - np.asarray(n) * 0.6))
            behind = [q for gq, q in polys if gq.buffer(0.3).contains(inside)] or [max(solids, key=lambda q: q["top"])]
            q = max(behind, key=lambda q: q["base"] + q["top"])
            best.append((sc * (1 + 0.02 * (q["top"] - q["min"])), mid, n, L, q["base"], q["base"] + q["top"]))
    best.sort(key=lambda r: -r[0])
    _, mid, n, L, z0, z1 = best[pick]
    return np.asarray(mid), np.asarray(n), L, z0, z1


def place(city, sc, node):
    """Where a screen or sign goes: (centre of its foot on the face, outward normal, along-face unit
    vector, foot z, ground z, top of the building)."""
    toward = np.asarray(sc.get("toward", node), float)
    if "path" in sc:   # a bent screen: its own foot line; the ground and roof of its building
        solids = buildings(city)["s"].get(building_index(city, sc["building"])[0], [])
        top = max(solids, key=lambda q: q["base"] + q["top"])
        z0, z1 = min(q["base"] for q in solids), top["base"] + top["top"]
        pts = np.asarray(sc["path"], float)
        L = np.cumsum([0.0] + [float(np.linalg.norm(b - a)) for a, b in zip(pts[:-1], pts[1:])])
        mid = np.array([np.interp(L[-1] / 2, L, pts[:, 0]), np.interp(L[-1] / 2, L, pts[:, 1])])
        t = unit(pts[-1] - pts[0])
        n = np.array([t[1], -t[0]])
        if n @ (toward - mid) < 0:
            n = -n
        t = left_of(n)
    else:
        mid, n, L, z0, z1 = facade(city, sc["building"], toward, sc.get("near"), sc.get("pick", 0), edge=sc.get("edge"))
        t = left_of(n)
    if sc.get("roof"):
        base = z1 + sc.get("lift", 1.2)
    else:
        base = z0 + sc["z"] if sc["z"] >= 0 else z1 + sc["z"] - sc["h"]   # above the street, or down from the roof
    return mid + t * sc.get("along", 0.0), n, t, base, z0, z1


def bend(points, radius, steps=6):
    """A foot line with its corners rounded: the points of arcs of `radius` in place of each corner."""
    p = [np.asarray(q, float) for q in points]
    out = [p[0]]
    for a, b, c in zip(p, p[1:], p[2:]):
        d0, d1 = unit(b - a), unit(c - b)
        turn = math.acos(max(-1.0, min(1.0, float(d0 @ d1))))
        if radius <= 0 or turn < 1e-3:
            out.append(b)
            continue
        cut = min(radius * math.tan(turn / 2), 0.45 * np.linalg.norm(b - a), 0.45 * np.linalg.norm(c - b))
        p0, p1 = b - d0 * cut, b + d1 * cut
        for k in range(steps + 1):   # a quadratic Bezier through the corner: close to the arc, tangent at both ends
            s = k / steps
            out.append((1 - s) ** 2 * p0 + 2 * (1 - s) * s * b + s ** 2 * p1)
    out.append(p[-1])
    return out


# ---------------------------------------------------------------- a site's screens

class ScreenSet:
    """The screens of one site (a crossing, a plaza, a canal), their programme and their light.

    city      the city whose buildings.json they stand on
    specs     the screens (module docstring)
    clips     [(name, [keyframe, ...]), ...], the keyframes f(img, rng) drawn with adkit
    material  the face's material: its colour and finish and the sheet's file ("map")
    sync      (clip, period s, length s): the joint slot of the screens with "sync", or None
    cell      a keyframe's size in the sheet, px; cols, cells to a row; seed, the drawing's
    """

    def __init__(self, city, specs, clips, material, sync=None, cell=(512, 340), cols=4, seed=1999, frame_s=4.0):
        self.city, self.specs, self.clips, self.base = city, specs, clips, dict(material)
        self.sync, self.cell, self.cols, self.seed, self.frame_s = sync, cell, cols, seed, frame_s
        self.frames = max(len(k) for _, k in clips)
        rows = math.ceil(len(clips) * self.frames / cols)
        if len(clips) > 24:
            raise ValueError("world.js plays at most 24 clips to a sheet")
        self.size = (cols * cell[0], 1 << max(8, math.ceil(math.log2(rows * cell[1]))))   # a power of two high
        self._placed, self._sheet = None, None

    def clip_index(self, name):
        return [c for c, _ in self.clips].index(name)

    def placed(self, node):
        """Every screen, placed: centre of its foot, outward normal, size, programme."""
        if self._placed is not None:
            return self._placed
        node = np.asarray(node, float)
        out = []
        for sc in self.specs:
            c, n, t, base, z0, z1 = place(self.city, sc, node)
            s = {"name": sc["name"], "at": c, "normal": n, "w": sc["w"], "h": sc["h"], "z0": base, "ground": z0,
                 "clips": [self.clip_index(k) for k in sc["clips"]], "hours": sc.get("hours", [9, 24]),
                 "sync": 1 if sc.get("sync", True) else 0, "pitch": sc.get("pitch", 0.016), "bright": sc.get("bright", 1.0),
                 "phase": sc.get("phase", 0.0), "off": sc.get("off", 0.6), "frame": sc.get("frame", 0.35), "roof": sc.get("roof", False),
                 "parts": sc.get("parts", [[0.0, 1.0, 0.0, 1.0]]), "top": z1}
            if "path" in sc:
                foot = bend(sc["path"], sc.get("round", 0.0))
                # stood off its walls by `off`, each point along the mean of the normals either side
                ns = [np.array([unit(b - a)[1], -unit(b - a)[0]]) for a, b in zip(foot[:-1], foot[1:])]
                if ns[len(ns) // 2] @ n < 0:
                    ns = [-q for q in ns]
                pn = [ns[0]] + [unit(a + b) for a, b in zip(ns[:-1], ns[1:])] + [ns[-1]]
                s["path"] = [p + q * s["off"] for p, q in zip(foot, pn)]
                s["path_n"] = pn
                s["w"] = float(sum(np.linalg.norm(b - a) for a, b in zip(s["path"][:-1], s["path"][1:])))
            out.append(s)
        self._placed = out
        return out

    def meshes(self, K, node, face="screens"):
        """Each screen: its LED face, whose texture coordinates carry the screen's number (u's integer
        part) for world.js to play its programme, on a dark frame standing off the wall, or on a steel
        frame on the roof; an irregular screen is the parts of its box (its picture runs across the
        whole box); a bent screen is a strip along its foot line, on a dark back with legs to the roof."""
        F = K(face)
        for i, s in enumerate(self.placed(node)):
            n, w, h, z0 = s["normal"], s["w"], s["h"], s["z0"]
            if "path" in s:
                pts, pn = s["path"], s["path_n"]
                L = np.cumsum([0.0] + [float(np.linalg.norm(b - a)) for a, b in zip(pts[:-1], pts[1:])])
                for k, (a, b) in enumerate(zip(pts[:-1], pts[1:])):
                    u0, u1 = i + max(L[k] / L[-1], 0.0005), i + min(L[k + 1] / L[-1], 0.9995)
                    A, Bp = np.array([*a, z0]), np.array([*b, z0])
                    F.quad(A, Bp, Bp + [0, 0, h], A + [0, 0, h], [[u0, 0.0], [u1, 0.0], [u1, 1.0], [u0, 1.0]])
                    m = (a + b) / 2
                    P = frame(m, unit(pn[k] + pn[k + 1]))
                    seg = float(np.linalg.norm(b - a))
                    block(K("screen_frame"), P, -0.6, -0.12, -seg / 2 - 0.02, seg / 2 + 0.02, z0 - 0.35, z0 + h + 0.35)
                    if s["roof"] and (k % 3 == 0 or k == len(pts) - 2):
                        K("steel_dark").tube([P(-0.7, 0.0, s["top"] - 0.3), P(-0.7, 0.0, z0 + h)], 0.14, 6)
                        K("steel_dark").tube([P(-3.2, 0.0, s["top"] - 0.3), P(-0.7, 0.0, z0 + h * 0.7)], 0.09, 4)
                continue
            c = s["at"] + n * s["off"]
            P = frame(c, n)
            fw = s["frame"]
            if s["roof"]:   # a roof screen stands back from the parapet on legs, braced behind
                P = frame(s["at"] - n * 2.0, n)
                for v in np.linspace(-w / 2 + 0.8, w / 2 - 0.8, max(2, int(w / 4.5) + 1)):
                    K("steel_dark").tube([P(-0.3, v, s["top"] - 0.3), P(-0.3, v, z0 + h)], 0.16, 6)
                    K("steel_dark").tube([P(-3.0, v, s["top"] - 0.3), P(-0.3, v, z0 + h * 0.7)], 0.1, 4)
                block(K("screen_frame"), P, -0.7, 0.03, -w / 2 - 0.3, w / 2 + 0.3, z0 - 0.3, z0 + h + 0.3)
            elif fw > 0:
                # the frame's front stands 10 cm behind the face: closer, the two fight in the depth buffer from afar
                block(K("screen_frame"), P, -s["off"], 0.03, -w / 2 - fw, w / 2 + fw, z0 - fw, z0 + h + fw)
            for u0, u1, v0, v1 in s["parts"]:   # left to right seen from in front
                a, b = P(0.125, -w / 2 + u0 * w, z0), P(0.125, -w / 2 + u1 * w, z0)
                F.quad(a + [0, 0, v0 * h], b + [0, 0, v0 * h], b + [0, 0, v1 * h], a + [0, 0, v1 * h],
                       [[i + max(u0, 0.0005), v0], [i + min(u1, 0.9995), v0], [i + min(u1, 0.9995), v1], [i + max(u0, 0.0005), v1]])

    def material(self, node):
        """The "led_screen" pattern's programme for these screens (world.js)."""
        cols, cell = self.cols, self.cell
        rows = math.ceil(len(self.clips) * self.frames / cols)
        W, H = self.size
        m = dict(self.base)
        m.update({"sheet": [cols, rows, cell[0] / W, cell[1] / H], "frames": self.frames, "cell_aspect": round(cell[0] / cell[1], 4), "frame_s": self.frame_s})
        if self.sync:
            m["sync"] = [self.clip_index(self.sync[0]), self.sync[1], self.sync[2]]
        m.update({"screens": [[round(s["w"] / s["h"], 4), round(s["phase"], 2), sum(1 << c for c in s["clips"]), len(set(s["clips"])), s["hours"][0], s["hours"][1],
                               s["bright"], s["sync"], round(s["h"], 2), s["pitch"], 0, 0] for s in self.placed(node)]})
        return m

    def sheet(self):
        """The keyframes of every clip, in a sheet a power of two high (the material's map)."""
        if self._sheet is None:
            import adkit
            from PIL import Image
            img, _ = adkit.draw_sheet(self.clips, cols=self.cols, cell=self.cell, seed=self.seed)
            sheet = Image.new("RGB", self.size, (0, 0, 0))
            sheet.paste(img, (0, 0))
            self._sheet = sheet
        return self._sheet

    def glows(self, node):
        """The light each screen throws on the street in front of it: a pool in the mean colour of its
        programme, as wide as the screen is high above the street, and as strong as it is large."""
        arr = np.asarray(self.sheet(), np.float32) / 255.0
        cols, (cw, ch) = self.cols, self.cell
        out = []
        for s in self.placed(node):
            cells = [k * self.frames + f for k in s["clips"] for f in range(self.frames)]
            lin = np.mean([(arr[(c // cols) * ch:(c // cols + 1) * ch, (c % cols) * cw:(c % cols + 1) * cw] ** 2.2).mean((0, 1)) for c in cells], 0)
            lin = 0.55 * lin / max(lin.max(), 1e-6) + 0.45 * np.array([1.0, 0.86, 0.72])   # many pictures over an evening: their colour, mostly
            col = "#" + "".join(f"{int(min(255, 255 * (v / max(lin.max(), 1e-6)) ** (1 / 2.2))):02x}" for v in lin)
            rise = s["z0"] + s["h"] / 2 - s.get("ground", s["z0"] - 3.0)
            g = s["at"] + s["normal"] * (0.6 * rise + 4.0)
            area = s["w"] * s["h"] * sum((u1 - u0) * (v1 - v0) for u0, u1, v0, v1 in s["parts"])
            out.append([round(float(g[0]), 1), round(float(g[1]), 1), round(max(s["w"] * 1.1, rise * 1.2, 18.0), 1), col,
                        round(min(0.9, 0.0016 * area * s["bright"] * float(lin.mean() / max(lin.max(), 1e-6)) + 0.08), 3), *s["hours"]])
        return out
