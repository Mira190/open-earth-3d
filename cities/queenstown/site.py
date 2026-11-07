"""The Skyline site's ground on Bob's Peak: a drawn floor round the restaurant (issue 269).

At 1 m a pixel, the aerial photograph under the Skyline complex shows the restaurant's leaning roof and its
shadow draped on the slope, and the game's near-ground shader reads the photograph's grey roofs as paving.
Round the restaurant the ground is drawn instead: a floor mesh laid on the game's 5 m terrain (the triangles the
ground tiles near the player are drawn with, so it lies exactly on them), painted from what is mapped and
measured there, and the photograph is not drawn under it (landmarks.json "clip", web/world.js).

  the luge tracks   OpenStreetMap's Arrow and Dart tracks (attraction=summer_toboggan, surface=paved): asphalt
                    2.2 m wide between low concrete kerbs, as Skyline's tracks are built;
  the footways      OpenStreetMap's footways and steps round the complex (paving stones, concrete);
  schist            Otago schist where the 5 m terrain is steeper than about 35 degrees, and scattered
                    outcrops; schist chip round the buildings' feet;
  tussock           the rest: the short tussock grassland of Bob's Peak (OpenStreetMap's natural=grassland
                    there), straw-gold clumps over darker ground;
  forest floor      under the canopy the woods map has (the Douglas fir below the deck): needle litter.

The painting is albedo only: the scene lights it and casts its own shadows. OpenStreetMap data (ODbL) is fetched
once into site_osm.json:

    python cities/queenstown/site.py --fetch
"""
import base64
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(ROOT, "web", "data", "queenstown")
OSM = os.path.join(HERE, "site_osm.json")
IMAGE = "skyline_site.jpg"
MPP = 0.07                 # metres per pixel of the painting
BBOX = (168.6440, -45.0292, 168.6545, -45.0238)   # what is fetched (lon, lat)
LUGE_W, KERB_W = 2.2, 0.22                         # the track's asphalt and each kerb (m)

# the site: round the restaurant's terraces (massing.json), out to the luge tracks' first bends and down the slope
# under the deck to the lift's foot and the trees (local metres, x east, y north)
RING = [(-1068, 470), (-1060, 452), (-1040, 446), (-1012, 444), (-992, 441), (-972, 438), (-952, 440), (-936, 452),
        (-928, 472), (-926, 500), (-930, 528), (-944, 548), (-972, 556), (-1004, 552), (-1036, 548), (-1060, 536),
        (-1072, 510), (-1074, 488)]

MATERIALS = {
    # the drawn floor: its painting (landmark_assets), laid over the terrain, under the street lights after dark
    "site_floor": {"color": "#ffffff", "roughness": 0.92, "metalness": 0.0, "map": IMAGE, "decal": True, "street_lit": True},
    # the luge tracks: asphalt (its aggregate, u along and v across in metres) between precast concrete kerbs in
    # 1 m lengths; low enough to step over, so not walls to the game's walkers (nav.js)
    "luge_asphalt": {"color": "#3d3e40", "roughness": 0.88, "metalness": 0.0, "pattern": "granite", "joints_m": [0, 0], "decal": True,
                     "street_lit": True},
    "luge_kerb": {"color": "#a8a399", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [1.0, 0], "street_lit": True,
                  "solid": False},
}


# ---------------------------------------------------------------- fetching OpenStreetMap's ways

def fetch():
    import urllib.request
    import pyproj
    url = "https://api.openstreetmap.org/api/0.6/map.json?bbox=" + ",".join(map(str, BBOX))
    req = urllib.request.Request(url, headers={"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"})
    d = json.loads(urllib.request.urlopen(req, timeout=120).read())
    scene = json.load(open(os.path.join(DATA, "scene.json")))
    tr = pyproj.Transformer.from_crs("EPSG:4326", scene["frame"]["proj"], always_xy=True)
    nodes = {e["id"]: e for e in d["elements"] if e["type"] == "node"}
    out = {"source": "OpenStreetMap contributors (ODbL), " + url, "ways": []}
    for e in d["elements"]:
        if e["type"] != "way":
            continue
        t = e.get("tags", {})
        if t.get("attraction") == "summer_toboggan":
            kind = "luge"
        elif t.get("highway") in ("footway", "path", "steps", "track", "cycleway"):
            kind = t["highway"]
        elif t.get("natural") == "grassland":
            kind = "grassland"
        elif "building" in t:
            kind = "building"
        else:
            continue
        pts = [tr.transform(nodes[n]["lon"], nodes[n]["lat"]) for n in e["nodes"] if n in nodes]
        w = {"id": e["id"], "kind": kind, "p": [[round(x, 2), round(y, 2)] for x, y in pts]}
        for k in ("tunnel", "bridge", "surface", "layer", "name"):
            if k in t:
                w[k] = t[k]
        out["ways"].append(w)
    json.dump(out, open(OSM, "w"), indent=0)
    print(f"{len(out['ways'])} ways -> {OSM}")


# ---------------------------------------------------------------- the ground it lies on

class Ground5:
    """The game's 5 m terrain (game.json), drawn as the ground tiles near the player draw it: each cell two
    triangles split from its south-west to its north-east corner (web/sun.js terrainTri)."""

    def __init__(self):
        scene = json.load(open(os.path.join(DATA, "scene.json")))
        t = json.load(open(os.path.join(DATA, "game.json")))["terrain"]
        self.nx, self.ny, self.cell = int(t["nx"]), int(t["ny"]), float(t["cell"])
        self.x0, self.y1 = scene["frame"]["x"][0], scene["frame"]["y"][1]
        self.d = np.frombuffer(base64.b64decode(t["data"]), "<i2").astype(float).reshape(self.ny, self.nx) * float(t["scale"])

    def node(self, c, r):
        return self.x0 + c * self.cell, self.y1 - r * self.cell, float(self.d[r, c])

    def __call__(self, x, y):
        c, r = (np.asarray(x, float) - self.x0) / self.cell, (self.y1 - np.asarray(y, float)) / self.cell
        c0, r0 = np.floor(c).astype(int), np.floor(r).astype(int)
        fc, fr = c - c0, r - r0
        D = self.d
        a, b, d, e = D[r0, c0], D[r0, c0 + 1], D[r0 + 1, c0], D[r0 + 1, c0 + 1]
        return np.where(fc + fr <= 1, a + fc * (b - a) + fr * (d - a), e + (1 - fc) * (d - e) + (1 - fr) * (b - e))


def site_polygon():
    from shapely.geometry import Polygon
    return Polygon(RING).buffer(0)


def bounds():
    x0, y0, x1, y1 = site_polygon().bounds
    x0, y0 = math.floor(x0) - 1, math.floor(y0) - 1
    x1, y1 = math.ceil(x1) + 1, math.ceil(y1) + 1
    return x0, y0, x1, y1


# ---------------------------------------------------------------- the painting

def _noise(shape, scale_px, seed):
    """Smooth value noise (0..1) with features scale_px pixels across."""
    rng = np.random.default_rng(seed)
    h, w = shape
    gh, gw = int(h / scale_px) + 3, int(w / scale_px) + 3
    g = rng.random((gh, gw))
    yy = np.arange(h) / scale_px
    xx = np.arange(w) / scale_px
    y0, x0 = yy.astype(int), xx.astype(int)
    fy, fx = yy - y0, xx - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]
    d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy)[:, None] + (c * (1 - fx) + d * fx) * fy[:, None]


def _fbm(shape, scale_px, seed, octaves=4):
    out, amp, tot = np.zeros(shape), 1.0, 0.0
    for k in range(octaves):
        out += amp * _noise(shape, max(1.0, scale_px / 2 ** k), seed + 17 * k)
        tot += amp
        amp *= 0.5
    return out / tot


def _hex(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def _lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def _photo(x0, y0, x1, y1):
    """The aerial photograph over the box at 1 m a pixel (linear RGB), from the ground tiles."""
    from PIL import Image
    scene = json.load(open(os.path.join(DATA, "scene.json")))
    W, H = int(x1 - x0), int(y1 - y0)
    out = np.zeros((H, W, 3))
    for t in scene["ground"]:
        if t["x1"] <= x0 or t["x0"] >= x1 or t["y1"] <= y0 or t["y0"] >= y1:
            continue
        im = Image.open(os.path.join(DATA, t["file"])).convert("RGB")
        sx, sy = im.width / (t["x1"] - t["x0"]), im.height / (t["y1"] - t["y0"])
        a, b = max(x0, t["x0"]), min(x1, t["x1"])
        c, d = max(y0, t["y0"]), min(y1, t["y1"])
        crop = im.crop((round((a - t["x0"]) * sx), round((t["y1"] - d) * sy), round((b - t["x0"]) * sx), round((t["y1"] - c) * sy)))
        crop = crop.resize((int(b - a), int(d - c)), Image.LANCZOS)
        out[int(y1 - d):int(y1 - d) + crop.height, int(a - x0):int(a - x0) + crop.width] = _lin(np.asarray(crop, float) / 255)
    return out


def paint(out_path):
    """The site's floor as an image over bounds(), north up, MPP metres a pixel.

    Its colour over a few metres is the aerial photograph's, so that from the air the floor reads as the
    photograph does and its edge does not show; where the photograph has the restaurant's roofs and their shadow
    (round the footprints) that colour is filled in from the ground about it. Over it, at a scale the photograph
    cannot carry, the drawn detail: tussock clumps, schist, the luge tracks with their kerbs, the footways."""
    from PIL import Image, ImageDraw, ImageFilter
    from scipy import ndimage
    x0, y0, x1, y1 = bounds()
    W, H = int(round((x1 - x0) / MPP)), int(round((y1 - y0) / MPP))
    px = lambda x, y: ((x - x0) / MPP, (y1 - y) / MPP)
    osm = json.load(open(OSM))["ways"]
    massing = json.load(open(os.path.join(HERE, "massing.json")))["buildings"]
    bld = [w for w in osm if w["kind"] == "building"]
    rings = [t["ring"] for M in massing.values() for t in M["tiers"]] + [w["p"] for w in bld]
    G = Ground5()

    # ---- the colour over a few metres: the photograph's, the roofs and their shadow filled in
    P = _photo(x0, y0, x1, y1)
    Hm, Wm = P.shape[:2]
    foot = Image.new("L", (Wm, Hm), 0)
    dr = ImageDraw.Draw(foot)
    for r in rings:
        if len(r) >= 3:
            dr.polygon([(x - x0, y1 - y) for x, y in r], fill=255)
    foot = np.asarray(foot) > 0
    L = P @ np.array([0.2126, 0.7152, 0.0722])
    sat = (P.max(-1) - P.min(-1)) / np.maximum(P.max(-1), 1e-3)
    dist = ndimage.distance_transform_edt(~foot)
    # the canopy (woods map) at 1 m: the firs' own shade is kept
    scene = json.load(open(os.path.join(DATA, "scene.json")))
    wd = scene["woods"]
    woods = Image.open(os.path.join(DATA, wd["file"])).convert("RGBA")
    c0, r0 = int((x0 - wd["x0"]) / wd["cell"]), int((wd["y1"] - y1) / wd["cell"])
    c1, r1 = int(math.ceil((x1 - wd["x0"]) / wd["cell"])), int(math.ceil((wd["y1"] - y0) / wd["cell"]))
    wcrop = woods.crop((c0, r0, c1, r1)).getchannel("R")
    can1 = np.asarray(wcrop.resize((Wm, Hm), Image.BILINEAR), float) / 255
    open_ = can1 < 0.15
    blue = P[..., 2] > 0.5 * (P[..., 0] + P[..., 1]) * 1.05
    dark = L < 0.6 * ndimage.gaussian_filter(L, 8)
    roofy = ((dist < 30) & (L < 0.12) & (sat < 0.35)) | ((dist < 45) & (dark | blue) & open_)   # the roofs, their shadow (skylit: blue)
    built = (L > 0.28) & (sat < 0.16) & open_          # concrete and asphalt worn pale: the luge tracks and paving, drawn from the map
    bad = ndimage.binary_dilation(foot, iterations=5) | ndimage.binary_opening(roofy, iterations=1) | ndimage.binary_dilation(built, iterations=1)
    bad = ndimage.binary_dilation(bad, iterations=2)
    good = (~bad).astype(float)
    fill = P.copy()
    for sig in (3, 6, 12, 24):                                      # normalised convolution, wider each pass
        num = np.stack([ndimage.gaussian_filter(fill[..., k] * good, sig) for k in range(3)], -1)
        den = ndimage.gaussian_filter(good, sig)[..., None]
        est = num / np.maximum(den, 1e-6)
        fill = np.where(good[..., None] > 0, fill, np.where(den > 0.02, est, fill))
        good = np.maximum(good, (den[..., 0] > 0.02).astype(float))
    macro = np.stack([ndimage.gaussian_filter(fill[..., k], 1.4) for k in range(3)], -1)
    # brought to the albedo the game's near ground gives the photograph (game.js: a soft knee from 0.28)
    Lm = macro @ np.array([0.2126, 0.7152, 0.0722])
    knee = np.where(Lm > 0.28, (0.28 + (Lm - 0.28) * 0.3) / np.maximum(Lm, 1e-4), 1.0)
    macro = macro * (0.5 + 0.5 * knee[..., None])
    macro = np.stack([np.asarray(Image.fromarray(macro[..., k].astype(np.float32), mode="F").resize((W, H), Image.BILINEAR)) for k in range(3)], -1)

    # the terrain's slope at each pixel (from the 5 m triangles, sampled on a 1 m lattice and enlarged)
    gx = np.arange(x0, x1 + 1)
    gy = np.arange(y1, y0 - 1, -1)
    XX, YY = np.meshgrid(gx, gy)
    Z = G(XX, YY)
    slope = np.degrees(np.arctan(np.hypot(np.gradient(Z, axis=1), np.gradient(Z, axis=0))))
    slope = np.asarray(Image.fromarray(slope.astype(np.float32), mode="F").resize((W, H), Image.BILINEAR))
    # the canopy from the woods map (r: ground cover under the canopy)
    canopy = np.asarray(wcrop.resize((W, H), Image.BILINEAR), float) / 255
    canopy = np.clip(canopy * 1.6, 0, 1)

    shape = (H, W)
    yy, xx = np.mgrid[0:H, 0:W]
    # ---- the drawn detail, as a factor about 1 on the colour, by what grows or lies there
    # tussock: clumps a few tens of centimetres across, gold at their tips, the ground between darker
    clump = _noise(shape, 0.3 / MPP, 1) * 0.65 + _noise(shape, 0.12 / MPP, 2) * 0.35
    blades = np.clip((clump - 0.36) / 0.28, 0, 1)
    tus = (0.7 + 0.42 * blades)[..., None] * np.array([1.04, 1.0, 0.9]) ** (blades[..., None] * 2 - 1)
    tus = tus * (0.9 + 0.2 * _noise(shape, 0.05 / MPP, 5))[..., None]
    # schist on the steepest ground and in outcrops: platy foliation, lichen, dark joints (its own colour)
    out_n = _fbm(shape, 7.0 / MPP, 6)
    rock = np.clip((slope - 40) / 8, 0, 1) * 0.8 + np.clip((out_n - 0.74) / 0.06, 0, 1) * 0.9
    rock = np.clip(rock, 0, 1) * (1 - canopy)
    fol = np.sin((xx * 0.8 + yy * 0.6) * MPP * 2 * math.pi / 0.16 + 7 * _noise(shape, 1.1 / MPP, 7))
    sch = _lin(_hex("#8a877f"))[None, None] * (0.86 + 0.14 * fol[..., None])
    li = np.clip((_fbm(shape, 0.7 / MPP, 8) - 0.56) / 0.14, 0, 1)
    sch = sch * (1 - 0.5 * li[..., None]) + _lin(_hex("#9c9b78"))[None, None] * 0.5 * li[..., None]
    sch = sch * np.where(np.abs(_noise(shape, 0.8 / MPP, 9) - 0.5) < 0.018, 0.45, 1.0)[..., None]
    sch *= (0.86 + 0.28 * _noise(shape, 0.035 / MPP, 10))[..., None]
    # under the firs: needle litter over the photograph's colour
    lit = (0.75 + 0.5 * _fbm(shape, 0.5 / MPP, 11))[..., None] * (0.85 + 0.3 * _noise(shape, 0.05 / MPP, 12))[..., None]
    natural = macro * (tus * (1 - canopy[..., None]) + lit * canopy[..., None])
    img = natural * (1 - rock[..., None]) + (0.5 * sch + 0.5 * sch * macro / np.maximum(macro.mean(-1, keepdims=True), 1e-3) * 0.9) * rock[..., None]

    # ---- what is built, drawn from OpenStreetMap at the painting's scale
    def mask(draw_fn, blur=0.0):
        m = Image.new("L", (W, H), 0)
        draw_fn(ImageDraw.Draw(m))
        if blur:
            m = m.filter(ImageFilter.GaussianBlur(blur / MPP))
        return np.asarray(m, float) / 255

    def line(d, p, w, fill=255):
        q = [px(*a) for a in p]
        d.line(q, fill=fill, width=max(1, int(round(w / MPP))), joint="curve")
        r = w / MPP / 2
        for a in (q[0], q[-1]):
            d.ellipse([a[0] - r, a[1] - r, a[0] + r, a[1] + r], fill=fill)

    above = [w for w in osm if w.get("tunnel") != "yes" and w.get("bridge") != "yes" and w.get("layer", "0") == "0"]
    # schist chip round the buildings' feet (1.5 m out)
    chip = mask(lambda d: [d.polygon([px(*a) for a in r], fill=255) for r in rings if len(r) >= 3])
    chip = ndimage.binary_dilation(chip > 0.5, iterations=int(1.5 / MPP)).astype(float)
    chip = ndimage.gaussian_filter(chip, 0.15 / MPP)
    chip_c = _lin(_hex("#7a776f")) * (0.8 + 0.4 * _noise(shape, 0.03 / MPP, 13))[..., None]
    img = img * (1 - chip[..., None]) + chip_c * chip[..., None]
    # footways and steps: grey pavers (0.6 x 0.3 m) or concrete
    fw = [w for w in above if w["kind"] in ("footway", "steps") and len(w["p"]) > 1]
    pav = mask(lambda d: [line(d, w["p"], 2.0 if w["kind"] == "footway" else 1.8) for w in fw])
    ju, jv = (xx * MPP) % 0.6, ((yy * MPP) + 0.3 * ((xx * MPP // 0.6) % 2)) % 0.3
    jt = (np.minimum(ju, 0.6 - ju) < 0.012) | (np.minimum(jv, 0.3 - jv) < 0.012)
    pav_c = _lin(_hex("#8c8881"))[None, None] * (0.9 + 0.2 * _noise(shape, 0.3 / MPP, 14))[..., None] * np.where(jt, 0.75, 1.0)[..., None]
    img = img * (1 - pav[..., None]) + pav_c * pav[..., None]
    # paths and tracks: compacted schist gravel and earth
    pth = [w for w in above if w["kind"] in ("path", "track", "cycleway") and len(w["p"]) > 1]
    pm = mask(lambda d: [line(d, w["p"], 1.3 if w["kind"] != "track" else 3.2) for w in pth], blur=0.15)
    gr = _lin(_hex("#857868")) * (0.8 + 0.4 * _noise(shape, 0.04 / MPP, 15))[..., None]
    img = img * (1 - pm[..., None]) + gr * pm[..., None]
    # the luge tracks (drawn as geometry too, luge_meshes; here for the distance, where those are a line)
    lg = [smooth(w["p"]) for w in above if w["kind"] == "luge" and len(w["p"]) > 1]
    kerb = mask(lambda d: [line(d, p, LUGE_W + 2 * KERB_W + 0.1) for p in lg])
    asph = mask(lambda d: [line(d, p, LUGE_W) for p in lg])
    img = img * (1 - kerb[..., None]) + _lin(_hex("#a29d93"))[None, None] * kerb[..., None]
    img = img * (1 - asph[..., None]) + (_lin(_hex("#3f4042")) * (0.85 + 0.3 * _noise(shape, 0.03 / MPP, 17))[..., None]) * asph[..., None]

    # toward the edge (the last 6 m) the floor gives way to the photograph's own colour, so its outline does not show
    poly = site_polygon()
    edge = Image.new("L", (W, H), 0)
    ImageDraw.Draw(edge).polygon([px(x, y) for x, y in list(poly.exterior.coords)], fill=255)
    din = ndimage.distance_transform_edt(np.asarray(edge) > 0) * MPP
    raw = np.stack([np.asarray(Image.fromarray(ndimage.gaussian_filter(P[..., k], 1.0).astype(np.float32), mode="F").resize((W, H), Image.BILINEAR)) for k in range(3)], -1)
    f = np.clip(1 - din / 6.0, 0, 1)[..., None] ** 1.5 * 0.7
    img = img * (1 - f) + raw * (0.75 + 0.25 * tus) * f
    Image.fromarray((_srgb(img) * 255).astype(np.uint8)).save(out_path, quality=84, optimize=True, progressive=True)
    return W, H


def smooth(p, step=0.5, window=7.0):
    """A mapped line resampled every step metres and smoothed over window metres (its ends kept): the luge
    tracks' nodes, traced from imagery, wander a metre either side of the track's line."""
    q = np.asarray(p, float)
    seg = np.hypot(*np.diff(q, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    if s[-1] < 2 * step:
        return q.tolist()
    t = np.linspace(0, s[-1], max(2, int(s[-1] / step) + 1))
    r = np.stack([np.interp(t, s, q[:, 0]), np.interp(t, s, q[:, 1])], -1)
    k = max(1, int(window / step / 2))
    pad = np.vstack([np.repeat(r[:1], k, 0) * 2 - r[k:0:-1], r, np.repeat(r[-1:], k, 0) * 2 - r[-2:-k - 2:-1]])  # mirrored about the ends
    w = np.hanning(2 * k + 3)[1:-1]
    w /= w.sum()
    out = np.stack([np.convolve(pad[:, j], w, mode="valid") for j in range(2)], -1)
    out[0], out[-1] = r[0], r[-1]
    return out.tolist()


# ---------------------------------------------------------------- the mesh

def _earclip(poly):
    """Triangles of a simple polygon [(x, y), ...] (counter-clockwise)."""
    p = list(poly)
    if len(p) < 3:
        return []
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(p, p[1:] + p[:1]))
    if area < 0:
        p = p[::-1]
    idx = list(range(len(p)))
    tris, guard = [], 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        for k in range(len(idx)):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % len(idx)]
            a, b, c = p[i0], p[i1], p[i2]
            if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-12:
                continue

            def inside(q):
                d1 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])
                d2 = (c[0] - b[0]) * (q[1] - b[1]) - (c[1] - b[1]) * (q[0] - b[0])
                d3 = (a[0] - c[0]) * (q[1] - c[1]) - (a[1] - c[1]) * (q[0] - c[0])
                return d1 > 0 and d2 > 0 and d3 > 0

            if any(inside(p[j]) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append((a, b, c))
            idx.pop(k)
            break
        else:
            break
    if len(idx) == 3:
        tris.append(tuple(p[j] for j in idx))
    return tris


def floor_mesh():
    """The floor: the 5 m terrain's triangles inside the site, cut at its edge, with a skirt down from the edge
    (where the viewer's 10 m ground stands lower than the 5 m one) so no crack shows along it."""
    from shapely.geometry import Polygon
    from meshkit import Mesh

    class FloorMesh(Mesh):   # texture coordinates over the painting (0..1), finer than meshkit's centimetres
        def dump(self):
            out = super().dump()
            out["uv"] = np.round(np.asarray(self.t, float), 5).ravel().tolist()
            return out

    G = Ground5()
    poly = site_polygon()
    x0, y0, x1, y1 = bounds()
    W, H = x1 - x0, y1 - y0
    m = FloorMesh("skyline_site_floor", "site_floor", True, uv=True)
    at = {}

    def vid(x, y, z):
        k = (round(x, 3), round(y, 3))
        if k not in at:
            at[k] = len(m.v)
            m.v.append([x, y, z])
            m.t.append([(x - x0) / W, (y - y0) / H])
        return at[k]

    c_lo, c_hi = int((x0 - G.x0) // G.cell), int((x1 - G.x0) // G.cell) + 1
    r_lo, r_hi = int((G.y1 - y1) // G.cell), int((G.y1 - y0) // G.cell) + 1
    for r in range(r_lo, r_hi):
        for c in range(c_lo, c_hi):
            a, b, d, e = G.node(c, r), G.node(c + 1, r), G.node(c, r + 1), G.node(c + 1, r + 1)
            # (rows go south: a north-west, b north-east, d south-west, e south-east; split south-west to north-east)
            for tri in ((a, b, d), (b, e, d)):
                T = Polygon([q[:2] for q in tri])
                cut = T.intersection(poly)
                if cut.is_empty or cut.area < 1e-4:
                    continue
                # the triangle's plane
                (ax, ay, az), (bx, by, bz), (cx, cy, cz) = tri
                n = np.cross([bx - ax, by - ay, bz - az], [cx - ax, cy - ay, cz - az])
                zf = lambda x, y: az - (n[0] * (x - ax) + n[1] * (y - ay)) / n[2]
                parts = [cut] if cut.geom_type == "Polygon" else [g for g in getattr(cut, "geoms", []) if g.geom_type == "Polygon"]
                for P in parts:
                    if abs(P.area - T.area) < 1e-6:
                        pts = [q[:2] for q in tri]
                        tris = [tuple(pts)] if (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[1][1] - pts[0][1]) * (pts[2][0] - pts[0][0]) > 0 else [tuple(pts[::-1])]
                    else:
                        tris = _earclip(list(P.exterior.coords)[:-1])
                    for t in tris:
                        m.i += [vid(x, y, zf(x, y)) for x, y in t]
    # the skirt: from the edge down 2 m, facing out
    ring = list(poly.exterior.coords)[:-1]
    if Polygon(ring).exterior.is_ccw is False:
        ring = ring[::-1]
    for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
        L = math.hypot(bx - ax, by - ay)
        n = max(1, int(L / 2.5))
        for k in range(n):
            p0 = (ax + (bx - ax) * k / n, ay + (by - ay) * k / n)
            p1 = (ax + (bx - ax) * (k + 1) / n, ay + (by - ay) * (k + 1) / n)
            z0, z1 = float(G(*p0)), float(G(*p1))
            q = len(m.v)
            for (x, y), z in ((p0, z0), (p1, z1), (p1, z1 - 2.0), (p0, z0 - 2.0)):
                m.v.append([x, y, z])
                m.t.append([(x - x0) / W, (y - y0) / H])
            m.i += [q, q + 3, q + 2, q, q + 2, q + 1]
    return m


def luge_meshes():
    """The luge tracks inside the site as built: the asphalt a few centimetres over the floor and a kerb each side,
    0.22 m wide and 0.1 m over the asphalt, along OpenStreetMap's lines smoothed (smooth)."""
    from shapely.geometry import LineString
    from meshkit import Mesh
    G = Ground5()
    poly = site_polygon()
    osm = json.load(open(OSM))["ways"]
    asph = Mesh("skyline_luge_asphalt", "luge_asphalt", True, uv=True)
    kerb = Mesh("skyline_luge_kerb", "luge_kerb", False, uv=True)
    hw = LUGE_W / 2
    for w in osm:
        if w["kind"] != "luge" or w.get("tunnel") == "yes" or w.get("layer", "0") != "0" or len(w["p"]) < 2:
            continue
        cut = LineString(smooth(w["p"])).intersection(poly.buffer(-0.6))
        for part in ([cut] if cut.geom_type == "LineString" else list(getattr(cut, "geoms", []))):
            if part.geom_type != "LineString" or part.length < 2:
                continue
            q = np.asarray(part.coords)
            seg = np.hypot(*np.diff(q, axis=0).T)
            s_ = np.concatenate([[0], np.cumsum(seg)])
            t = np.linspace(0, s_[-1], max(2, int(s_[-1] / 0.5) + 1))
            c = np.stack([np.interp(t, s_, q[:, 0]), np.interp(t, s_, q[:, 1])], -1)
            d = np.gradient(c, axis=0)
            d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
            n = np.stack([-d[:, 1], d[:, 0]], -1)
            L, R = c + n * hw, c - n * hw
            zl, zr = G(L[:, 0], L[:, 1]) + 0.04, G(R[:, 0], R[:, 1]) + 0.04
            rows = [[[*L[k], zl[k]], [*R[k], zr[k]]] for k in range(len(t))]
            asph.grid(rows, [[[t[k], 0.0], [t[k], LUGE_W]] for k in range(len(t))])
            for side, E, ze in ((1, L, zl), (-1, R, zr)):
                O = E + n * side * KERB_W
                zo = G(O[:, 0], O[:, 1]) + 0.04
                for k in range(len(t) - 1):
                    a, b = k, k + 1
                    pts = lambda P, z, h: ([*P[a], z[a] + h], [*P[b], z[b] + h])
                    i0, i1 = pts(E, ze, 0.1)
                    o0, o1 = pts(O, zo, 0.1)
                    e0, e1 = pts(E, ze, -0.05)
                    f0, f1 = pts(O, zo, -0.05)
                    u0, u1 = t[a], t[b]
                    kerb.quad(i0, i1, o1, o0, [[u0, 0], [u1, 0], [u1, KERB_W], [u0, KERB_W]])   # its top
                    kerb.quad(e0, e1, i1, i0, [[u0, 0], [u1, 0], [u1, 0.15], [u0, 0.15]])        # its face to the track
                    kerb.quad(o0, o1, f1, f0, [[u0, 0], [u1, 0], [u1, 0.15], [u0, 0.15]])        # its back
    return [m for m in (asph, kerb) if m.v]


def clip_regions():
    """Where the photograph is not drawn: the site, 0.4 m in from the floor's edge (which overlaps the ground)."""
    inner = site_polygon().buffer(-0.4, join_style=2)
    return [{"ring": [[round(x, 2), round(y, 2)] for x, y in list(inner.exterior.coords)[:-1]]}]


if __name__ == "__main__":
    sys.path.insert(0, os.path.join(ROOT, "pipeline"))
    if "--fetch" in sys.argv:
        fetch()
    if "--paint" in sys.argv:
        print(paint(sys.argv[sys.argv.index("--paint") + 1]))
