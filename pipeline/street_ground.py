"""A city's walking ground graded under its streets: each carriageway level across and smooth along.

The game walks and drives on a 5 m grid of the bare-earth survey (game.json "terrain", game_data.py), drawn as two
triangles a cell. A 5 m survey cannot hold an edge: where a street runs along a terrace, a retaining wall, a
station's podium or a railway's embankment, the drop is smeared over the cell next to it, so the carriageway's far
lane climbs a slope of 50 % or more that the street does not have; and on a hillside a street that crosses the slope
tilts with it. From first principles the ground of a street is the street's: level across it from building line to
building line, and along it a line as smooth as the survey allows. So (level()):

  - a street (a road, or a footway wide enough to hold: a pedestrian street) where it lies on the ground, not on a
    deck or over a tunnel, has its level read along it where it is (the weighted median of the grid's nodes round each
    metre of it, the nearest counting most: the terrace the street is on, not the one beside it), then smoothed: a
    running median over 13 m (no spike or pit survives), then a Gaussian of SIGMA_M (a street's grade changes over
    tens of metres, not in a step). The long grade is the survey's own: nothing is terraced along it;
  - every node within its half width and PIN_M of its line is set to that level: a cell past the kerb, so that no
    triangle under the carriageway or the pavement beside it keeps a corner on the bank. Past it, over FEATHER_M, the
    nodes are drawn towards it less and less, so that the difference goes into the building or the bank beside the
    street (where the walls are drawn down to whichever ground is drawn); a node there more than BANK_M off the
    street's level is the bank's own slope or a wall, and stays;
  - a footpath is narrower than a cell and cannot be held level on its own account. Where it runs beside a street at
    the street's level it is the street's pavement and takes its level; elsewhere it keeps its own smoothed profile;
    and it counts for little in a node a street reaches (FOOT_WEIGHT);
  - where several lines meet, the nearest count most. Streets that meet on a hill, each level across, part by their
    grade times the way from the corner: that much disagreement is a junction's and is blended; more is two levels (a
    street under a footbridge, a cutting with stairs down its sides), and the node is left;
  - a pit by a street a node or two wide (a hole in the survey, a trench dug when it flew) is filled to the ground
    round it.

Three earlier rules made Sydney's hillside streets worse than surveyed (issue 524), and are gone: half a cell of
pinned ground past the kerb (the outer lane and the pavement rose and fell with the grid's corners, the terraces);
footpaths levelled like streets (three benches down a hillside where there is one street); and every node where two
lines disagreed by 0.4 m left as surveyed (a hole in the grading at each junction on a slope).

The survey is kept, as game_data.py wrote it, in cities/<id>/ground_survey.json (not served), and every grading
starts from it: a change to the method needs no rebuild of the city, and a second run writes the same.

It is kept only where it makes the whole map's carriageways more even than the survey (fewer cross-falls of over
15 %, no more creases of over 15 %; see run()). --check holds a map to that (tools/check.sh): the ground graded by
the method as it is now, the roads' cross-falls and creases within their limits map-wide and round the start, and the
floor a graded hero level draws level across too.

Left as they are: the water; a hero level that draws its own ground (docs/HERO.md) unless its entry says "graded":
true (Shibuya's Scramble: its builder drapes the level on game.json's terrain, so it is rebuilt after this, and its
floor exported again, pipeline/hero_floor.py); the ground under a landmark's flat faces near the ground (paving, a
plinth, a planter: within LANDMARK_M of it; a wall's face holds no ground); the ground under a building's part that
stands over it (its clearance); a city's fine patches; any node a street would move more than MAX_MOVE_M (an
underpass, a cutting the data maps on the ground). A line that runs onto such ground fades out over EDGE_M along it;
one that runs beside it (at an embankment's foot) is levelled up to it; towards the water everything fades, and a
shore stays as surveyed. The heights stay to the
decimetre, as game_data.py writes them: in centimetres the game's pack grew by a third for creases of 2 % that no
one feels.

The points of the paths and the props laid on the old ground (within 15 cm of it) are laid on the new, as
refresh_terrain.py does; the viewer's 10 m grid (terrain.json) takes every other node.

    python pipeline/street_ground.py --city shibuya
    python pipeline/street_ground.py --live            # the live cities (cities/index.json less its parked ones)
    python pipeline/street_ground.py --live --measure  # only print how even the streets are
    python pipeline/street_ground.py --live --check
    python pipeline/street_ground.py --city sydney --force   # grade again from the kept survey

game_data.py runs it as its last step, on the grid it has just written. Run it again (--force) after a step that
changes what it leaves alone (landmarks.py, a hero level's entry), then pipeline/pack.py; and after it, for a hero
level marked "graded", blender/build_hero.py, tools/hero_ground_probe.js and pipeline/hero_floor.py.
"""
import argparse
import base64
import json
import os
import zlib

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# half the width of a carriageway by class (m): a street's own width where the data has it (cw), these otherwise
ROAD_HW = {"motorway": 7.0, "trunk": 6.5, "primary": 6.0, "secondary": 5.0, "tertiary": 4.5, "residential": 3.0,
           "unclassified": 3.0, "living_street": 3.0, "service": 2.5}
FOOT_HW = {"pedestrian": 2.5, "footway": 1.0, "path": 1.0, "cycleway": 1.25, "living_street": 3.0}  # (steps are left alone)
STREET_FOOT = ("pedestrian", "living_street")  # the footways wide enough to grade as streets
PIN_M = 5.0          # past the half width, the nodes still set to the street's level: a cell, so that no triangle under
                     # the carriageway or the pavement beside it has a corner left on the bank (with half a cell the
                     # outer lane and the pavement rose and fell with the grid's corners, a scallop every few metres)
FOOT_PIN_M = 3.5     # the same for a footpath (its own half width is a metre)
FEATHER_M = 2.5      # and past that, drawn towards it less and less
SIDE_M = 3.5         # a footpath this far past a street's band, or nearer, may be the street's pavement
AGREE_M = 0.6        # and is, where its own ground is within this of the street's level
FOOT_WEIGHT = 0.05   # a footpath's say in a node a street reaches too
PIT_M = 1.0          # a node this far under the median of the eight round it, by a street, is a pit: filled
BANK_M = 1.5         # a node in that feather further off the street's level is a bank's or a wall's: left
ON_GROUND_M = 0.3    # a line's point within this of the ground lies on it (otherwise a deck, a ramp, a tunnel)
SPREAD_M = 0.4       # where the lines that reach a node disagree on its level by more (a street under a footbridge, a
                     # cutting with stairs down its sides, lines at two levels), it is left
JUNCTION_M = 10.0    # (more where the lines are steep: a junction on a hill, see level())
EDGE_M = 12.0        # a line's levelling fades out over this, along it, towards ground left as it is
MAX_MOVE_M = 4.0     # a node a street would move further is left (an underpass, a cutting)
LANDMARK_M = 1.5     # a landmark's flat face this near the ground stands on it: the ground under it stays
PAVING_M = 0.5       # and one this near is the ground there (paving): the nodes a cell round it stay too
MEDIAN_N, SIGMA_M = 13, 5.0  # the smoothing along a line (samples a metre apart)
COVER = 0.4          # the share of a node's cell a landmark's flat faces cover for the node to be the landmark's
VERSION = 2


def grid(t):
    return np.frombuffer(base64.b64decode(t["data"]), "<i2").reshape(t["ny"], t["nx"]).astype(np.float64) * t["scale"]


def encode(a, scale):
    return base64.b64encode(np.round(a / scale).astype("<i2").tobytes()).decode()


class Ground:
    """The grid as the game walks it: each cell split from its north-east to its south-west corner (nav.js terrain)."""

    def __init__(self, T, x0, y1, cell):
        self.T, self.x0, self.y1, self.cell = T, x0, y1, cell
        self.ny, self.nx = T.shape

    def at(self, x, y):
        T = self.T
        c = np.clip((np.asarray(x) - self.x0) / self.cell, 0, self.nx - 1.001)
        r = np.clip((self.y1 - np.asarray(y)) / self.cell, 0, self.ny - 1.001)
        c0, r0 = c.astype(int), r.astype(int)
        fc, fr = c - c0, r - r0
        a, b, d, e = T[r0, c0], T[r0, c0 + 1], T[r0 + 1, c0], T[r0 + 1, c0 + 1]
        up = fc + fr <= 1
        return np.where(up, a + fc * (b - a) + fr * (d - a), e + (1 - fc) * (d - e) + (1 - fr) * (b - e))

    def street(self, x, y):
        """The level of a street at each (x, y): the weighted median of the 4 x 4 nodes round it, the nearest
        counting most (a node 1.5 m off counts 1/e of one under it), so that a street beside a smeared drop takes the
        terrace it lies on."""
        c = (x - self.x0) / self.cell
        r = (self.y1 - y) / self.cell
        c0, r0 = np.floor(c).astype(int) - 1, np.floor(r).astype(int) - 1
        vals, wts = [], []
        for dr in range(4):
            for dc in range(4):
                rr, cc = np.clip(r0 + dr, 0, self.ny - 1), np.clip(c0 + dc, 0, self.nx - 1)
                d = np.hypot((cc - c) * self.cell, (rr - r) * self.cell)
                vals.append(self.T[rr, cc]); wts.append(np.exp(-(d / 1.5) ** 2) + 1e-9)
        V, W = np.stack(vals, 1), np.stack(wts, 1)
        o = np.argsort(V, 1)
        V, W = np.take_along_axis(V, o, 1), np.take_along_axis(W, o, 1)
        cw = np.cumsum(W, 1)
        k = (cw < cw[:, -1:] / 2).sum(1)
        return V[np.arange(len(V)), k]


def half_width(e, kind):
    if kind == "road":
        return e["cw"] / 2 if e.get("cw") else ROAD_HW.get(e.get("c", ""), 3.5)
    return FOOT_HW.get(e.get("c", ""))


def runs(e, G):
    """The pieces of a line (game.json path, decimetres) that lie on the ground, each resampled every metre: [(xy, n)]."""
    p = np.asarray(e["p"], np.float64).reshape(-1, 3) / 10
    on = np.abs(p[:, 2] - G.at(p[:, 0], p[:, 1])) < ON_GROUND_M
    out, cur = [], []
    for i in range(len(p) - 1):
        if not (on[i] and on[i + 1]):
            if len(cur) > 1:
                out.append(np.array(cur))
            cur = []
            continue
        a, b = p[i, :2], p[i + 1, :2]
        n = max(1, int(np.ceil(np.hypot(*(b - a)))))
        seg = a + (b - a) * (np.arange(n + 1)[:, None] / n)
        cur.extend(seg if not cur else seg[1:])
    if len(cur) > 1:
        out.append(np.array(cur))
    return out


def smooth(z):
    if len(z) >= 3:
        z = ndimage.median_filter(z, size=min(MEDIAN_N, len(z) if len(z) % 2 else len(z) - 1), mode="nearest")
        z = ndimage.gaussian_filter1d(z, SIGMA_M, mode="nearest")
    return z


def draws_ground(out, h):
    """Does a hero level draw ground (a material named ground*, docs/HERO.md)? Tokyo's Marunouchi draws the station's
    building only: the ground round it is the game's own, levelled with the rest."""
    import struct
    path = os.path.join(out, h.get("glb", ""))
    if not h.get("glb") or not os.path.exists(path):
        return True
    b = open(path, "rb").read(1 << 22)
    n = struct.unpack("<I", b[12:16])[0]
    return any("ground" in (m.get("name") or "").lower() for m in json.loads(b[20:20 + n]).get("materials", []))


def protected(game, scene, landmarks, G, out=""):
    """The nodes the streets leave as they are (see the module's note)."""
    ny, nx, cell = G.ny, G.nx, G.cell
    wm = game["water"]
    keep = np.unpackbits(np.frombuffer(base64.b64decode(wm["bits"]), np.uint8))[:nx * ny].reshape(ny, nx).astype(bool)
    gy, gx = np.mgrid[0:ny, 0:nx]
    X, Y = G.x0 + gx * cell, G.y1 - gy * cell
    for h in game.get("hero", []):
        if h.get("at") and h.get("r") and draws_ground(out, h) and not h.get("graded"):
            keep |= np.hypot(X - h["at"][0], Y - h["at"][1]) < h["r"] + 2 * cell
    for p in game.get("patches", []):
        if p.get("hero"):
            continue  # (a hero level's drawn ground, pipeline/hero_floor.py: the level's, kept by the line above)
        x1, y1 = p["x0"] + p["nx"] * p["cell"], p["y0"] + p["ny"] * p["cell"]
        keep |= (X > p["x0"] - cell) & (X < x1 + cell) & (Y > p["y0"] - cell) & (Y < y1 + cell)
    # the landmarks laid on the ground: their flat triangles near it (a wall's face holds no ground: the street at its
    # foot is the street's), drawn on the node grid (a pixel a node). Paving, setts, a plinth's foot (within PAVING_M
    # of the ground) are the ground there, and the nodes a cell round them stay too, so that no triangle rises through
    # them; what stands higher (a planter's soil, an embankment's ballast) keeps the nodes under it only. A face that
    # covers little of a node's cell (a guard rail's cap, a plinth's strip along a wall) holds no ground
    K = 5  # (drawn at a pixel a metre; a node is the landmark's where its faces cover COVER of the node's cell)
    img, img2 = Image.new("L", (nx * K, ny * K), 0), Image.new("L", (nx * K, ny * K), 0)
    d, d2 = ImageDraw.Draw(img), ImageDraw.Draw(img2)
    for m in (landmarks or {}).get("meshes", []):
        P = np.asarray(m["position"], np.float64).reshape(-1, 3)
        I = np.asarray(m["index"], np.int64).reshape(-1, 3) if m.get("index") else np.arange(len(P)).reshape(-1, 3)
        if not len(I):
            continue
        dz = P[:, 2] - G.at(P[:, 0], P[:, 1])
        n = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]])
        flat = np.abs(n[:, 2]) > 0.7 * np.maximum(np.linalg.norm(n, axis=1), 1e-9)
        low, laid = (dz < LANDMARK_M)[I].any(1) & flat, (np.abs(dz) < PAVING_M)[I].all(1) & flat
        px, py = ((P[:, 0] - G.x0) / cell + 0.5) * K, ((G.y1 - P[:, 1]) / cell + 0.5) * K
        for (a, b, c), on in zip(I[low], laid[low]):
            tri = [(px[a], py[a]), (px[b], py[b]), (px[c], py[c])]
            d.polygon(tri, fill=1)
            if on:
                d2.polygon(tri, fill=1)
    cover = lambda im: np.asarray(im, np.float64).reshape(ny, K, nx, K).mean((1, 3)) >= COVER
    img, img2 = cover(img), cover(img2)
    pav = np.asarray(img2, bool)
    # (the cell round paving: a node beside it at the paving's own level, a square's edge; not the street at the foot
    # of an embankment whose top the paving is)
    Tp, ring = np.pad(np.where(pav, G.T, np.inf), 1, constant_values=np.inf), np.zeros((ny, nx), bool)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            ring |= np.abs(Tp[1 + dr:1 + dr + ny, 1 + dc:1 + dc + nx] - G.T) < PAVING_M
    laid = np.asarray(img, bool) | pav | ring
    laid &= ~keep  # (the nodes that only a landmark keeps: level() gives those far over a street back to the street)
    # and under a building's part that stands over the ground (min_dm: a bridge between two blocks, an upper floor over
    # a street): its clearance stays as surveyed (Shibuya's over Route 246 by Mark City is 1.6 m over the road, and 10 cm
    # more ground under it left the traffic no room, so the trunk road was kept off and the streets round it jammed)
    bp = os.path.join(out, "buildings.json")
    if out and os.path.exists(bp):
        B = json.load(open(bp, encoding="utf8"))
        f = B["s_fields"]
        k_min, k_ring = f.index("min_dm"), f.index("ring_dm")
        img = Image.new("L", (nx, ny), 0)
        d = ImageDraw.Draw(img)
        for sd in B["s"]:
            if sd[k_min] > 0:
                r = sd[k_ring]
                d.polygon([((r[i] / 10 - G.x0) / cell, (G.y1 - r[i + 1] / 10) / cell) for i in range(0, len(r) - 1, 2)], fill=1, outline=1)
        keep |= ndimage.binary_dilation(np.asarray(img, bool), iterations=1)
    return keep | laid, laid & ~keep


def survey_path(cid):
    return os.path.join(ROOT, "cities", cid, "ground_survey.json")


def save_survey(cid, t):
    """The grid as game_data.py wrote it, before any grading, kept beside the city's sources (not served): every grading
    starts from it, so a change to the method needs no rebuild of the city."""
    raw = base64.b64decode(t["data"])
    json.dump({"note": "The game's 5 m walking grid as surveyed (game_data.py), before pipeline/street_ground.py graded its streets.",
               "cell": t["cell"], "nx": t["nx"], "ny": t["ny"], "scale": t["scale"], "encoding": "int16le-zlib-base64",
               "data": base64.b64encode(zlib.compress(raw, 9)).decode()}, open(survey_path(cid), "w", encoding="utf8"))


def load_survey(cid, t):
    sv = json.load(open(survey_path(cid), encoding="utf8"))
    assert (sv["nx"], sv["ny"], sv["cell"]) == (t["nx"], t["ny"], t["cell"]), "the kept survey is not this grid's: rebuild with game_data.py"
    return np.frombuffer(zlib.decompress(base64.b64decode(sv["data"])), "<i2").reshape(sv["ny"], sv["nx"]).astype(np.float64) * sv["scale"]


def update_survey(cid, cells, values):
    """The kept survey set at `cells` (a mask of the grid) to `values` (the grid's own integers): for a step that moves
    the ground itself after game_data.py (refresh_terrain.py), so that the next grading starts from it."""
    if not os.path.exists(survey_path(cid)):
        return False
    sv = json.load(open(survey_path(cid), encoding="utf8"))
    g = np.frombuffer(zlib.decompress(base64.b64decode(sv["data"])), "<i2").reshape(sv["ny"], sv["nx"]).copy()
    g[cells] = values[cells]
    sv["data"] = base64.b64encode(zlib.compress(g.astype("<i2").tobytes(), 9)).decode()
    json.dump(sv, open(survey_path(cid), "w", encoding="utf8"))
    return True


def graded(e, kind):
    """Is a line a street with a width a 5 m grid can hold level (a carriageway, a pedestrian street)? A footpath is
    narrower than a cell: it is smoothed along, and takes the level of the street it runs beside."""
    return kind == "road" or e.get("c") in STREET_FOOT


def splat(G, lines, reach=0.0):
    """Each line's level laid on the nodes round it. lines: [(xy, z, hw, pin, weight, fade)], a point every metre; fade
    0 to 1, how much of the line's say is left there (see level()). Returns the weighted sums (level, weight, level
    squared, fade), per node how far past the nearest line's pinned band it lies (<= 0 inside it), and the steepest
    grade of the lines that reach it."""
    ny, nx, cell = G.ny, G.nx, G.cell
    num, den, sq, fd = np.zeros((ny, nx)), np.zeros((ny, nx)), np.zeros((ny, nx)), np.zeros((ny, nx))
    umin, gmax = np.full((ny, nx), np.inf), np.zeros((ny, nx))
    for xy, z, hw, pin, wt, fade in lines:
        grade = np.abs(np.gradient(z)) if len(z) > 1 else np.zeros(len(z))
        c, r = (xy[:, 0] - G.x0) / cell, (G.y1 - xy[:, 1]) / cell
        far = hw + pin + reach + FEATHER_M
        R = int(np.ceil(far / cell)) + 1
        for dr in range(-R, R + 1):
            for dc in range(-R, R + 1):
                rr, cc = np.round(r).astype(int) + dr, np.round(c).astype(int) + dc
                d = np.hypot((cc - c) * cell, (rr - r) * cell)  # from the line
                ok = (rr >= 0) & (rr < ny) & (cc >= 0) & (cc < nx) & (d < far)
                if not ok.any():
                    continue
                rr, cc, d, zz = rr[ok], cc[ok], d[ok], z[ok]
                w = wt / (0.5 + d) ** 3
                np.add.at(num, (rr, cc), w * zz)
                np.add.at(den, (rr, cc), w)
                np.add.at(sq, (rr, cc), w * zz * zz)
                np.add.at(fd, (rr, cc), w * fade[ok])
                np.minimum.at(umin, (rr, cc), d - hw - pin - reach)
                np.maximum.at(gmax, (rr, cc), grade[ok])
    return num, den, sq, fd, umin, gmax


def nodes_of(G, xy):
    return (np.clip(np.round((G.y1 - xy[:, 1]) / G.cell).astype(int), 0, G.ny - 1),
            np.clip(np.round((xy[:, 0] - G.x0) / G.cell).astype(int), 0, G.nx - 1))


def level(T, G, game, keep, on=None, laid=None, water=None):
    """The grid with its streets graded, and the per-node weight of the change (0 where nothing moved). T is the survey;
    `on` the ground the lines lie on now (the survey's own, or an earlier grading's); `laid` the nodes of `keep` that
    only a landmark's flat faces keep."""
    ny, nx, cell = G.ny, G.nx, G.cell
    on = on or G
    streets, paths = [], []
    for kind in ("road", "foot"):
        for e in game["paths"][kind]:
            hw = half_width(e, kind)
            if hw is None:
                continue
            for xy in runs(e, on):
                (streets if graded(e, kind) else paths).append((xy, hw))
    # the streets: each level across at its own smoothed profile, out to the building line (PIN_M past the kerb)
    lines = [(xy, smooth(G.street(xy[:, 0], xy[:, 1])), hw, PIN_M, 1.0, np.ones(len(xy))) for xy, hw in streets]
    acc = splat(G, lines)
    # a landmark's flat face holds the ground under it where it is the street's own paving, or stands clear of the
    # street. Where it lies in a street's band and more than PAVING_M over the street's level it is something that
    # stands beside the street (a railway embankment's top at the carriageway's edge, Shibuya's north of the station):
    # the survey smeared its height over the street's outer lane, and the street takes those nodes back, so that the
    # drop is inside the landmark's own walls
    freed = np.zeros((ny, nx), bool)  # (those nodes: an embankment is higher than a street may move its own ground)
    if laid is not None:
        sure = acc[1] > 0
        over = T - np.where(sure, acc[0] / np.where(sure, acc[1], 1), T)
        freed = laid & sure & (acc[4] <= 0) & (over > PAVING_M)
        keep = keep & ~freed
    # where a line runs onto ground left as it is (a hero level's, a landmark's paving), its say fades over EDGE_M
    # along it, so that it comes onto that ground as it was there, without a crease where the two meet. Along it, not
    # round it: a street that runs beside such ground (at an embankment's foot, along a quay) is levelled up to it.
    def fade(xy):
        inside = keep[nodes_of(G, xy)]
        return np.clip(ndimage.distance_transform_edt(~inside) / EDGE_M - 0.2, 0, 1) if inside.any() else np.ones(len(xy))
    fd = splat(G, [(xy, z, hw, pin, wt, fade(xy)) for xy, z, hw, pin, wt, _ in lines])[3]
    # the streets' level where a footpath may run beside one (SIDE_M past the band), as a field to read it from
    far = splat(G, lines, SIDE_M)
    has = far[1] > 0
    Zs = np.where(has, far[0] / np.where(has, far[1], 1), np.nan)
    Zs = Zs[tuple(ndimage.distance_transform_edt(~has, return_distances=False, return_indices=True))]
    beside = Ground(Zs, G.x0, G.y1, cell)
    # the footpaths: narrower than a cell, so not held level on their own account. One that runs beside a street at the
    # street's level (within AGREE_M: a pavement, not a walk on top of the wall over it) is the street's, and takes its
    # level; elsewhere it keeps its own smoothed profile. Either way it counts for little where a street reaches
    # (FOOT_WEIGHT): the carriageway is the street's.
    flines = []
    for xy, hw in paths:
        own = smooth(G.street(xy[:, 0], xy[:, 1]))
        zs = beside.at(xy[:, 0], xy[:, 1])
        near = has[nodes_of(G, xy)] & (far[4][nodes_of(G, xy)] < 0) & (np.abs(own - zs) < AGREE_M)
        if len(near) > 9:
            near = ndimage.binary_opening(ndimage.binary_closing(near, np.ones(9)), np.ones(9))
        w = ndimage.gaussian_filter1d(near.astype(float), 4.0, mode="nearest")
        z = w * zs + (1 - w) * own
        flines.append((xy, ndimage.gaussian_filter1d(z, 2.0, mode="nearest") if len(z) > 2 else z, hw, FOOT_PIN_M, FOOT_WEIGHT, fade(xy)))
    accf = splat(G, flines)
    num, den, sq = (a + b for a, b in zip(acc[:3], accf[:3]))
    fd = fd + accf[3]
    umin, gmax = np.minimum(acc[4], accf[4]), np.maximum(acc[5], accf[5])
    has = den > 0
    target = np.where(has, num / np.where(has, den, 1), T)
    alpha = np.clip(1 - umin / FEATHER_M, 0, 1) * np.where(has, fd / np.where(has, den, 1), 0)
    move = np.abs(target - T)
    spread = np.sqrt(np.maximum(np.where(has, sq / np.where(has, den, 1), 0) - np.where(has, target, 0) ** 2, 0))
    # (where graded streets meet, each level across, their levels part by the grade times the way from the corner: that
    # much disagreement is a junction's, blended; more is two levels)
    two = spread > SPREAD_M + gmax * JUNCTION_M
    alpha[~has | keep | ((move > MAX_MOVE_M) & ~freed) | ((umin > 0) & (move > BANK_M)) | two] = 0
    # towards the water the grading fades over EDGE_M whichever way the street runs: a shore falls to the water as
    # surveyed (a street along a quay would otherwise lift the beach beside it to its own level)
    if water is not None and water.any():
        alpha *= np.clip(ndimage.distance_transform_edt(~water) * cell / EDGE_M - 0.2, 0, 1)
    new = T + alpha * (target - T)
    # a pit by a street, a node or two wide and more than PIT_M under the nodes round it (a hole in the survey, a trench
    # dug when it flew: a construction site's, Sakuragaoka's south of Shibuya Station, 3 m deep under a street that runs
    # level over it), filled to the ground round it; a bank (high on one side, low on the other) is no pit
    # (where a main road runs down at the pit's own level it is a cutting or an underpass's ramp, and stays)
    near = np.isfinite(umin) & (umin < FEATHER_M) & ~keep
    cut = np.zeros((ny, nx), bool)
    for e in game["paths"]["road"]:
        if e.get("c") not in ("motorway", "trunk", "primary"):
            continue
        q = np.asarray(e["p"], np.float64).reshape(-1, 3) / 10
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                rr, cc = np.round((G.y1 - q[:, 1]) / cell).astype(int) + dr, np.round((q[:, 0] - G.x0) / cell).astype(int) + dc
                ok = (rr >= 0) & (rr < ny) & (cc >= 0) & (cc < nx)
                rr, cc = rr[ok], cc[ok]
                cut[rr, cc] |= np.abs(T[rr, cc] - q[ok, 2]) < 1.5
    near &= ~cut
    for _ in range(3):
        P = np.pad(new, 1, mode="edge")
        ring = np.stack([P[1 + dr:1 + dr + ny, 1 + dc:1 + dc + nx] for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc])
        med = np.median(ring, axis=0)
        # (two of the eight round it as low at most, the two along a trench a node wide: on a bank's slope three or more
        # are lower, and it is no pit; and no deeper than a street's own MAX_MOVE_M)
        low = (ring < new[None] + 0.3).sum(0)
        pit = near & (new < med - PIT_M) & (low <= 2) & (med - new <= MAX_MOVE_M)
        if not pit.any():
            break
        new[pit] = med[pit]
        alpha[pit] = 1.0
    return new, alpha


def evenness(T, G, game, centre, radius, keep, on=None, kinds=("road", "foot")):
    """How even the streets' ground is: along each road and footway on the ground within radius of centre (outside the
    nodes left as they are), every metre, the cross-fall over the half width each side (counts over 6 and 15 %), the change
    of grade between the 3 m before and after (counts over 6 and 15 %), and the height off a 20 m running mean (rms, cm).
    `on` is the ground the lines lie on (see level())."""
    G2 = Ground(T, G.x0, G.y1, G.cell)
    n = cross = crease = cross2 = crease2 = 0
    sq = 0.0
    for kind in kinds:
        for e in game["paths"][kind]:
            hw = half_width(e, kind)
            if hw is None:
                continue
            for xy in runs(e, on or G):
                far = np.hypot(xy[:, 0] - centre[0], xy[:, 1] - centre[1]) > radius
                use = ~far & ~keep[nodes_of(G, xy)]
                if use.sum() < 12:
                    continue
                z = G2.at(xy[:, 0], xy[:, 1])
                t = np.gradient(xy, axis=0)
                t /= np.maximum(np.hypot(t[:, 0], t[:, 1]), 1e-6)[:, None]
                nrm = np.stack([-t[:, 1], t[:, 0]], 1) * min(hw, 3.0)
                zl, zr = G2.at(*(xy + nrm).T), G2.at(*(xy - nrm).T)
                cf = np.abs(zl - zr) / (2 * min(hw, 3.0))
                g = np.full(len(z), np.nan)
                g[3:-3] = (z[6:] - z[3:-3]) / 3 - (z[3:-3] - z[:-6]) / 3
                m = ndimage.uniform_filter1d(z, size=21, mode="nearest")
                n += use.sum(); cross += (cf[use] > 0.06).sum(); crease += (np.abs(g[use]) > 0.06).sum()
                cross2 += (cf[use] > 0.15).sum(); crease2 += (np.abs(g[use]) > 0.15).sum()
                sq += ((z - m)[use] ** 2).sum()
    return {"samples": int(n), "crossfall_over_6pc": int(cross), "creases_over_6pc": int(crease),
            "crossfall_over_15pc": int(cross2), "creases_over_15pc": int(crease2), "off_mean_cm": round(float(np.sqrt(sq / max(n, 1))) * 100, 2)}


def report(T, G, game, centre, radius, keep, on):
    """The roads' and the footways' evenness apiece: a car feels the first, and a 5 m grid can hold only the first level."""
    return {k: evenness(T, G, game, centre, radius, keep, on, (k,)) for k in ("road", "foot")}


def run(cid, measure=False, force=False, radius=300.0):
    out = os.path.join(ROOT, "web", "data", cid)
    gp, sp, tp, lp = (os.path.join(out, f) for f in ("game.json", "scene.json", "terrain.json", "landmarks.json"))
    game, scene = json.load(open(gp, encoding="utf8")), json.load(open(sp, encoding="utf8"))
    landmarks = json.load(open(lp, encoding="utf8")) if os.path.exists(lp) else None
    t = game["terrain"]
    Tc = grid(t)  # the ground as it is now: the lines lie on it
    if not t.get("levelled") and not measure:
        save_survey(cid, t)  # fresh from game_data.py
    T = load_survey(cid, t) if os.path.exists(survey_path(cid)) else Tc
    x0, y1 = scene["frame"]["x"][0], scene["frame"]["y"][1]
    G, Gc = Ground(T, x0, y1, t["cell"]), Ground(Tc, x0, y1, t["cell"])
    keep, laid = protected(game, scene, landmarks, G, out)
    centre = game["start"]["at"]
    rep = {"city": cid, "graded": t.get("levelled", 0), "radius_m": radius, "now": report(Tc, G, game, centre, radius, keep, Gc),
           "map_now": report(Tc, G, game, centre, 1e9, keep, Gc)}
    if measure or (t.get("levelled") == VERSION and not force):
        return rep
    wm = game["water"]
    water = np.unpackbits(np.frombuffer(base64.b64decode(wm["bits"]), np.uint8))[:T.size].reshape(T.shape).astype(bool)
    new, alpha = level(T, G, game, keep, Gc, laid, water)
    new = np.round(new / t["scale"]) * t["scale"]  # (as it is written, so that what is measured is what is walked)
    rep["nodes"] = int((np.abs(new - T) >= 0.005).sum())
    rep["moved_max_m"] = round(float(np.abs(new - T).max()), 2)
    rep["surveyed"] = report(T, G, game, centre, radius, keep, Gc)
    rep["after"] = report(new, G, game, centre, radius, keep, Gc)
    # kept only if it makes the whole map's carriageways more even: fewer steep cross-falls and no more sharp creases
    # than the survey has (a footway is narrower than a cell, and where one crosses a street's bank it gains a crease
    # the survey's slope did not have: reported, not a reason to leave the cars on a tilted road)
    b, a = report(T, G, game, centre, 1e9, keep, Gc), report(new, G, game, centre, 1e9, keep, Gc)
    rep["map"] = {kind: {k: [b[kind][k], a[kind][k]] for k in ("samples", "crossfall_over_15pc", "creases_over_15pc")} for kind in b}
    if a["road"]["creases_over_15pc"] > b["road"]["creases_over_15pc"] or a["road"]["crossfall_over_15pc"] > b["road"]["crossfall_over_15pc"]:
        rep["kept_as_surveyed"] = True
        return rep
    # the paths' and the props' points on the old ground, onto the new (within 15 cm of it: a deck stays)
    Gn = Ground(new, x0, y1, t["cell"])
    pts = 0
    def reground(flat):
        nonlocal pts
        a = np.asarray(flat, np.float64).reshape(-1, 3) / 10
        if not len(a):
            return
        on = np.abs(a[:, 2] - Gc.at(a[:, 0], a[:, 1])) < 0.15
        nz = np.round(Gn.at(a[:, 0], a[:, 1]) * 10)
        ch = on & (nz != np.round(a[:, 2] * 10))
        for i in np.nonzero(ch)[0]:
            flat[3 * i + 2] = int(nz[i])
        pts += int(ch.sum())
    for kind in game["paths"].values():
        for e in kind:
            reground(e["p"])
    for flat in game.get("props", {}).values():
        reground(flat)
    rep["points"] = pts
    t.update(data=encode(new, t["scale"]), levelled=VERSION)
    json.dump(game, open(gp, "w", encoding="utf8"), separators=(",", ":"), ensure_ascii=False)
    # the viewer's 10 m grid: every other node where the game's changed
    if os.path.exists(tp):
        V = json.load(open(tp, encoding="utf8"))
        vs = scene["terrain"].get("scale", 0.1)
        v = np.frombuffer(base64.b64decode(V["data"]), "<i2").reshape(V["ny"], V["nx"]).astype(np.float64) * vs
        step = int(round(scene["terrain"]["cell"] / t["cell"]))
        moved = np.abs(new - Tc) >= 0.005
        sub, m = new[::step, ::step][:v.shape[0], :v.shape[1]], moved[::step, ::step][:v.shape[0], :v.shape[1]]
        v[:sub.shape[0], :sub.shape[1]][m] = sub[m]
        V["data"] = encode(v, vs)
        json.dump(V, open(tp, "w", encoding="utf8"))
        rep["viewer_nodes"] = int(m.sum())
    return rep


class Floor(Ground):
    """The ground with the hero levels' drawn floors over it (game.json "patches" marked smooth, pipeline/hero_floor.py),
    read as nav.js reads them: what is walked and driven on inside a level."""

    def __init__(self, T, x0, y1, cell, game):
        super().__init__(T, x0, y1, cell)
        self.patches = []
        for p in game.get("patches", []):
            if p.get("smooth"):
                z = np.frombuffer(base64.b64decode(p["data"]), "<i2").reshape(p["ny"], p["nx"]).astype(np.float64)
                self.patches.append((p, np.where(z == -32768, np.nan, z / 100)))
        self.lifts = [(h["at"], h["r"], h.get("lift", 0.0)) for h in game.get("hero", []) if h.get("at") and h.get("r")]

    def at(self, x, y):
        x, y = np.asarray(x, np.float64), np.asarray(y, np.float64)
        z = super().at(x, y)
        for p, Z in self.patches:
            fx, fy = (x - p["x0"]) / p["cell"] - 0.5, (y - p["y0"]) / p["cell"] - 0.5
            ok = (fx >= 0) & (fy >= 0) & (fx < p["nx"] - 1) & (fy < p["ny"] - 1)
            c0, r0 = np.clip(np.floor(fx).astype(int), 0, p["nx"] - 2), np.clip(np.floor(fy).astype(int), 0, p["ny"] - 2)
            tx, ty = fx - c0, fy - r0
            v = (Z[r0, c0] * (1 - tx) + Z[r0, c0 + 1] * tx) * (1 - ty) + (Z[r0 + 1, c0] * (1 - tx) + Z[r0 + 1, c0 + 1] * tx) * ty
            z = np.where(ok & np.isfinite(v), v, z)
        return z


# what tools/check.sh holds a live map's carriageways to (shares of the samples a metre apart along every road on the
# ground): the graded maps stand at 0.6 to 1.3 % and 0.12 to 0.16 % map-wide, the surveys at 2.7 to 7.3 % and 0.2 to 0.8 %
MAX_CROSSFALL_15 = 0.016    # cross-falls of over 15 %, map-wide
MAX_CREASES_15 = 0.0025     # changes of grade of over 15 % in 3 m, map-wide
MAX_START_CROSSFALL_15 = 0.01  # cross-falls of over 15 % within 300 m of the start
MAX_LEVEL_CROSSFALL_15 = 0.02  # and on the floor a graded hero level draws (the Scramble, issue 522)


def check(cid):
    """Is the map's ground graded by this method, and its carriageways as even as that leaves them? Lines of 'ok' or
    'FAIL' (tools/check.sh)."""
    out = os.path.join(ROOT, "web", "data", cid)
    game, scene = json.load(open(os.path.join(out, "game.json"), encoding="utf8")), json.load(open(os.path.join(out, "scene.json"), encoding="utf8"))
    lp = os.path.join(out, "landmarks.json")
    landmarks = json.load(open(lp, encoding="utf8")) if os.path.exists(lp) else None
    t = game["terrain"]
    fails = []
    if t.get("levelled") != VERSION:
        fails.append(f"its ground is not graded by this method (terrain.levelled {t.get('levelled')}, method {VERSION}): python pipeline/street_ground.py --city {cid}, then pipeline/pack.py")
    if not os.path.exists(survey_path(cid)):
        return [f"FAIL {cid}: no kept survey ({os.path.relpath(survey_path(cid), ROOT)}): the ground cannot be graded again"]
    Tc, T = grid(t), load_survey(cid, t)
    x0, y1 = scene["frame"]["x"][0], scene["frame"]["y"][1]
    G, Gc = Ground(T, x0, y1, t["cell"]), Ground(Tc, x0, y1, t["cell"])
    keep, _ = protected(game, scene, landmarks, G, out)
    centre = game["start"]["at"]
    m, s0 = evenness(Tc, G, game, centre, 1e9, keep, Gc, ("road",)), evenness(T, G, game, centre, 1e9, keep, Gc, ("road",))
    near = evenness(Tc, G, game, centre, 300.0, keep, Gc, ("road",))
    share = lambda e, k: e[k] / max(e["samples"], 1)
    for e, k, lim, what in ((m, "crossfall_over_15pc", MAX_CROSSFALL_15, "of its roads tilt over 15 % across"),
                            (m, "creases_over_15pc", MAX_CREASES_15, "of its roads crease over 15 %"),
                            (near, "crossfall_over_15pc", MAX_START_CROSSFALL_15, "of the roads within 300 m of the start tilt over 15 % across")):
        if share(e, k) > lim:
            fails.append(f"{share(e, k):.2%} {what} ({e[k]} of {e['samples']} m; at most {lim:.2%})")
    for k in ("crossfall_over_15pc", "creases_over_15pc"):
        if m[k] > s0[k]:
            fails.append(f"its roads are less even than the survey's ({k} {s0[k]} -> {m[k]})")
    # the floor a graded hero level draws: its carriageways as walked (the level's own patch over the grid)
    lv = ""
    F = Floor(Tc, x0, y1, t["cell"], game)
    for h in game.get("hero", []):
        if h.get("graded") and h.get("at") and h.get("r"):
            e = floor_evenness(F, game, h["at"], h["r"] - 5.0, Gc)
            lv += f"; {h['id']}'s drawn floor {e['crossfall_over_15pc']} of {e['samples']} m over 15 %"
            if share(e, "crossfall_over_15pc") > MAX_LEVEL_CROSSFALL_15:
                fails.append(f"{share(e, 'crossfall_over_15pc'):.2%} of the roads on {h['id']}'s drawn floor tilt over 15 % across ({e['crossfall_over_15pc']} of {e['samples']} m; at most {MAX_LEVEL_CROSSFALL_15:.0%}): rebuild the level on the graded ground (docs/HERO.md)")
    if fails:
        return [f"FAIL {cid}: {f}" for f in fails]
    return [f"ok   {cid}: roads over 15 % across {m['crossfall_over_15pc']} of {m['samples']} m (surveyed {s0['crossfall_over_15pc']}), creases over 15 % {m['creases_over_15pc']} (surveyed {s0['creases_over_15pc']}), off a 20 m mean {m['off_mean_cm']} cm{lv}"]


def floor_evenness(F, game, centre, radius, on):
    """evenness() of the roads within radius of centre, on a floor read through F.at (a hero level's)."""
    n = cross = cross6 = 0
    for e in game["paths"]["road"]:
        hw = half_width(e, "road")
        for xy in runs(e, on):
            use = np.hypot(xy[:, 0] - centre[0], xy[:, 1] - centre[1]) < radius
            if use.sum() < 12:
                continue
            t = np.gradient(xy, axis=0)
            t /= np.maximum(np.hypot(t[:, 0], t[:, 1]), 1e-6)[:, None]
            nrm = np.stack([-t[:, 1], t[:, 0]], 1) * min(hw, 3.0)
            cf = np.abs(F.at(*(xy + nrm).T) - F.at(*(xy - nrm).T)) / (2 * min(hw, 3.0))
            n += use.sum(); cross += (cf[use] > 0.15).sum(); cross6 += (cf[use] > 0.06).sum()
    return {"samples": int(n), "crossfall_over_15pc": int(cross), "crossfall_over_6pc": int(cross6)}


def live():
    idx = json.load(open(os.path.join(ROOT, "cities", "index.json"), encoding="utf8"))
    parked = set(idx.get("parked", []))
    return [c["id"] for c in idx["cities"] if c.get("status") == "live" and c["id"] not in parked and os.path.exists(os.path.join(ROOT, "web", "data", c["id"], "game.json"))]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--city")
    ap.add_argument("--live", action="store_true", help="every live city")
    ap.add_argument("--measure", action="store_true", help="only print how even the streets round the start are")
    ap.add_argument("--force", action="store_true", help="grade a city again")
    ap.add_argument("--check", action="store_true", help="fail where a map's ground is not graded by this method, or its roads are not as even as that leaves them (tools/check.sh)")
    ap.add_argument("--radius", type=float, default=300.0, help="the measure's radius round the start (m)")
    a = ap.parse_args()
    if a.check:
        lines = [ln for cid in (live() if a.live else [a.city]) for ln in check(cid)]
        print("\n".join(lines))
        raise SystemExit(any(ln.startswith("FAIL") for ln in lines))
    for cid in (live() if a.live else [a.city]):
        print(json.dumps(run(cid, a.measure, a.force, a.radius)), flush=True)


if __name__ == "__main__":
    main()
