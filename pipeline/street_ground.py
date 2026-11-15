"""A built city's walking ground levelled under its streets and footways, without a rebuild.

The game walks and drives on a 5 m grid of the bare-earth survey (game.json "terrain", game_data.py), drawn as two
triangles a cell. A 5 m survey cannot hold an edge: where a street runs along a terrace, a retaining wall, a
station's podium or a railway's embankment, the drop is smeared over the cell next to it, so the carriageway's far
lane climbs a slope of 50 % or more that the street does not have, and a footway beside it tilts and creases. From
first principles the ground of a street is the street's: level across it, and along it a line as smooth
as the survey allows. So, for each road and footway where it lies on the ground (not on a deck or over a tunnel):

  - its level along it is read where it is (the weighted median of the grid's nodes round each metre of it, the
    nearest counting most: the terrace the street is on, not the one beside it), then smoothed: a running median
    over 13 m (no spike or pit survives), then a Gaussian of SIGMA_M (the median's treads rounded off: a
    street's grade changes over tens of metres, not in a step);
  - every node within its half width and PIN_M of its line is set to that level; past it, over FEATHER_M, the
    nodes are drawn towards it less and less, so that the drop a smeared survey put in the street goes into the
    building or the bank beside it (where the walls are drawn down to whichever ground is drawn); a node there more
    than BANK_M off the street's level is the bank's own slope or a wall, and stays;
  - where several meet (a junction, a footway beside a road) the nearest lines count most.

The levelling is kept only where it makes the whole map's streets more even (fewer cross-falls of over 15 %, no more
creases of over 15 %); otherwise the survey stays as it is (see run()).

Left as they are: the water, the hero levels (docs/HERO.md: each is draped on the ground the game had when it was
built, and is rebuilt on its own), the ground under a landmark laid on it (paving, a plinth, a planter: a mesh within
1.5 m of the ground), a city's fine patches, and any node a street would move more than MAX_MOVE_M (an underpass, a
cutting the data maps on the ground), and any node where the lines that reach it disagree on its level by more
than SPREAD_M (two levels, a footbridge over a street). The heights stay to the decimetre, as game_data.py writes
them: in centimetres the game's pack grew by a third (170 kB in Shibuya) for creases of 2 % that no one feels.

The points of the paths and the props laid on the old ground (within 15 cm of it) are laid on the new, as
refresh_terrain.py does; the viewer's 10 m grid (terrain.json) takes every other node. A second run changes nothing
("levelled" in game.json's terrain); --force levels again, --measure only prints how even the streets are.

    python pipeline/street_ground.py --city shibuya
    python pipeline/street_ground.py --live            # the live cities (cities/index.json less its parked ones)
    python pipeline/street_ground.py --live --measure

Run it after game_data.py (and refresh_terrain.py), then pipeline/pack.py.
"""
import argparse
import base64
import json
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# half the width of a carriageway by class (m): a street's own width where the data has it (cw), these otherwise
ROAD_HW = {"motorway": 7.0, "trunk": 6.5, "primary": 6.0, "secondary": 5.0, "tertiary": 4.5, "residential": 3.0,
           "unclassified": 3.0, "living_street": 3.0, "service": 2.5}
FOOT_HW = {"pedestrian": 2.5, "footway": 1.0, "path": 1.0, "cycleway": 1.25, "living_street": 3.0}  # (steps are left alone)
PIN_M = 2.5          # past the half width, the nodes still set to the street's level (half a cell: the triangles
                     # under the carriageway's edge)
FEATHER_M = 2.5      # and past that, drawn towards it less and less
BANK_M = 1.5         # a node in that feather further off the street's level is a bank's or a wall's: left
ON_GROUND_M = 0.3    # a line's point within this of the ground lies on it (otherwise a deck, a ramp, a tunnel)
SPREAD_M = 0.4       # where the lines that reach a node disagree on its level by more (a street under a footbridge, a
                     # cutting with stairs down its sides, lines at two levels), it is left
EDGE_M = 12.0        # the levelling fades out over this towards the nodes left as they are
MAX_MOVE_M = 4.0     # a node a street would move further is left (an underpass, a cutting)
LANDMARK_M = 1.5     # a landmark's mesh this near the ground is laid on it: the ground under it stays
MEDIAN_N, SIGMA_M = 13, 5.0  # the smoothing along a line (samples a metre apart)
VERSION = 1


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


def protected(game, scene, landmarks, G):
    """The nodes the streets leave as they are (see the module's note)."""
    ny, nx, cell = G.ny, G.nx, G.cell
    wm = game["water"]
    keep = np.unpackbits(np.frombuffer(base64.b64decode(wm["bits"]), np.uint8))[:nx * ny].reshape(ny, nx).astype(bool)
    gy, gx = np.mgrid[0:ny, 0:nx]
    X, Y = G.x0 + gx * cell, G.y1 - gy * cell
    for h in game.get("hero", []):
        if h.get("at") and h.get("r"):
            keep |= np.hypot(X - h["at"][0], Y - h["at"][1]) < h["r"] + 2 * cell
    for p in game.get("patches", []):
        x1, y1 = p["x0"] + p["nx"] * p["cell"], p["y0"] + p["ny"] * p["cell"]
        keep |= (X > p["x0"] - cell) & (X < x1 + cell) & (Y > p["y0"] - cell) & (Y < y1 + cell)
    # the landmarks laid on the ground: their triangles near it, drawn on the node grid (a pixel a node) and grown a node
    img = Image.new("L", (nx, ny), 0)
    d = ImageDraw.Draw(img)
    for m in (landmarks or {}).get("meshes", []):
        P = np.asarray(m["position"], np.float64).reshape(-1, 3)
        I = np.asarray(m["index"], np.int64).reshape(-1, 3) if m.get("index") else np.arange(len(P)).reshape(-1, 3)
        if not len(I):
            continue
        low = P[:, 2] - G.at(P[:, 0], P[:, 1]) < LANDMARK_M
        tri = I[low[I].any(1)]
        px, py = (P[:, 0] - G.x0) / cell, (G.y1 - P[:, 1]) / cell
        for a, b, c in tri:
            d.polygon([(px[a], py[a]), (px[b], py[b]), (px[c], py[c])], fill=1, outline=1)
    lm = np.asarray(img, bool)
    keep |= ndimage.binary_dilation(lm, iterations=1)
    return keep


def level(T, G, game, keep):
    """The grid with its streets levelled, and the per-node weight of the change (0 where nothing moved)."""
    ny, nx, cell = G.ny, G.nx, G.cell
    num, den, sq = np.zeros((ny, nx)), np.zeros((ny, nx)), np.zeros((ny, nx))
    umin = np.full((ny, nx), np.inf)
    for kind in ("road", "foot"):
        for e in game["paths"][kind]:
            hw = half_width(e, kind)
            if hw is None:
                continue
            for xy in runs(e, G):
                z = smooth(G.street(xy[:, 0], xy[:, 1]))
                c, r = (xy[:, 0] - G.x0) / cell, (G.y1 - xy[:, 1]) / cell
                R = int(np.ceil((hw + PIN_M + FEATHER_M) / cell)) + 1
                for dr in range(-R, R + 1):
                    for dc in range(-R, R + 1):
                        rr, cc = np.round(r).astype(int) + dr, np.round(c).astype(int) + dc
                        ok = (rr >= 0) & (rr < ny) & (cc >= 0) & (cc < nx)
                        u = np.hypot((cc - c) * cell, (rr - r) * cell) - hw  # past the carriageway's edge
                        ok &= u < PIN_M + FEATHER_M
                        if not ok.any():
                            continue
                        rr, cc, u, zz = rr[ok], cc[ok], u[ok], z[ok]
                        w = 1.0 / (0.5 + np.maximum(u + hw, 0)) ** 3
                        np.add.at(num, (rr, cc), w * zz)
                        np.add.at(den, (rr, cc), w)
                        np.add.at(sq, (rr, cc), w * zz * zz)
                        np.minimum.at(umin, (rr, cc), u)
    has = den > 0
    target = np.where(has, num / np.where(has, den, 1), T)
    alpha = np.clip(1 - (umin - PIN_M) / FEATHER_M, 0, 1)
    move = np.abs(target - T)
    spread = np.sqrt(np.maximum(np.where(has, sq / np.where(has, den, 1), 0) - np.where(has, target, 0) ** 2, 0))
    alpha[~has | keep | (move > MAX_MOVE_M) | ((umin > PIN_M) & (move > BANK_M)) | (spread > SPREAD_M)] = 0
    # and towards what is left as it is, less and less over EDGE_M, so that a street comes into a hero level or onto a
    # landmark's paving on the ground as it was there, without a crease where the two meet
    alpha *= np.clip(ndimage.distance_transform_edt(~keep) * cell / EDGE_M - 0.2, 0, 1)
    return T + alpha * (target - T), alpha


def evenness(T, G, game, centre, radius, keep):
    """How even the streets' ground is: along each road and footway on the ground within radius of centre (outside the
    nodes left as they are), every metre, the cross-fall over the half width each side (counts over 6 and 15 %), the change
    of grade between the 3 m before and after (counts over 6 and 15 %), and the height off a 20 m running mean (rms, cm)."""
    G2 = Ground(T, G.x0, G.y1, G.cell)
    n = cross = crease = cross2 = crease2 = 0
    sq = 0.0
    for kind in ("road", "foot"):
        for e in game["paths"][kind]:
            hw = half_width(e, kind)
            if hw is None:
                continue
            for xy in runs(e, G):
                far = np.hypot(xy[:, 0] - centre[0], xy[:, 1] - centre[1]) > radius
                rc = np.clip(np.round((G.y1 - xy[:, 1]) / G.cell).astype(int), 0, G.ny - 1), np.clip(np.round((xy[:, 0] - G.x0) / G.cell).astype(int), 0, G.nx - 1)
                use = ~far & ~keep[rc]
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


def run(cid, measure=False, force=False, radius=300.0):
    out = os.path.join(ROOT, "web", "data", cid)
    gp, sp, tp, lp = (os.path.join(out, f) for f in ("game.json", "scene.json", "terrain.json", "landmarks.json"))
    game, scene = json.load(open(gp, encoding="utf8")), json.load(open(sp, encoding="utf8"))
    landmarks = json.load(open(lp, encoding="utf8")) if os.path.exists(lp) else None
    t = game["terrain"]
    T = grid(t)
    G = Ground(T, scene["frame"]["x"][0], scene["frame"]["y"][1], t["cell"])
    keep = protected(game, scene, landmarks, G)
    centre = game["start"]["at"]
    rep = {"city": cid, "done": bool(t.get("levelled")), "before": evenness(T, G, game, centre, radius, keep)}
    if measure or (t.get("levelled") and not force):
        return rep
    new, alpha = level(T, G, game, keep)
    moved = alpha > 0
    rep["nodes"] = int((np.abs(new - T) >= 0.005).sum())
    rep["moved_max_m"] = round(float(np.abs(new - T).max()), 2)
    rep["after"] = evenness(new, G, game, centre, radius, keep)
    # kept only if it makes the whole map's streets more even: fewer steep cross-falls and no more sharp creases (a
    # survey that is already a smooth surface, Sydney's from stereo imagery over hills its streets cross on the slant,
    # is terraced by a 5 m grid holding each street level across, and left as surveyed)
    b, a = evenness(T, G, game, centre, 1e9, keep), evenness(new, G, game, centre, 1e9, keep)
    rep["map"] = {k: [b[k], a[k]] for k in ("crossfall_over_15pc", "creases_over_15pc")}
    if a["creases_over_15pc"] > b["creases_over_15pc"] or a["crossfall_over_15pc"] > b["crossfall_over_15pc"]:
        rep["kept_as_surveyed"] = True
        return rep
    # the paths' and the props' points on the old ground, onto the new (within 15 cm of it: a deck stays)
    Gn = Ground(new, G.x0, G.y1, G.cell)
    pts = 0
    def reground(flat):
        nonlocal pts
        a = np.asarray(flat, np.float64).reshape(-1, 3) / 10
        if not len(a):
            return
        on = np.abs(a[:, 2] - G.at(a[:, 0], a[:, 1])) < 0.15
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
    # the viewer's 10 m grid: every other node where the game's moved
    if os.path.exists(tp):
        V = json.load(open(tp, encoding="utf8"))
        vs = scene["terrain"].get("scale", 0.1)
        v = np.frombuffer(base64.b64decode(V["data"]), "<i2").reshape(V["ny"], V["nx"]).astype(np.float64) * vs
        step = int(round(scene["terrain"]["cell"] / t["cell"]))
        sub, m = new[::step, ::step][:v.shape[0], :v.shape[1]], moved[::step, ::step][:v.shape[0], :v.shape[1]]
        v[:sub.shape[0], :sub.shape[1]][m] = sub[m]
        V["data"] = encode(v, vs)
        json.dump(V, open(tp, "w", encoding="utf8"))
        rep["viewer_nodes"] = int(m.sum())
    return rep


def live():
    idx = json.load(open(os.path.join(ROOT, "cities", "index.json"), encoding="utf8"))
    parked = set(idx.get("parked", []))
    return [c["id"] for c in idx["cities"] if c.get("status") == "live" and c["id"] not in parked and os.path.exists(os.path.join(ROOT, "web", "data", c["id"], "game.json"))]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--city")
    ap.add_argument("--live", action="store_true", help="every live city")
    ap.add_argument("--measure", action="store_true", help="only print how even the streets round the start are")
    ap.add_argument("--force", action="store_true", help="level a city again")
    ap.add_argument("--radius", type=float, default=300.0, help="the measure's radius round the start (m)")
    a = ap.parse_args()
    for cid in (live() if a.live else [a.city]):
        print(json.dumps(run(cid, a.measure, a.force, a.radius)), flush=True)


if __name__ == "__main__":
    main()
