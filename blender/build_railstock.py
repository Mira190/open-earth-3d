"""The main-line rolling stock the cities' games share: a 20 m JR East commuter car (the E233 and E235
families) and Sydney Trains' Waratah double-deck car, modelled in Blender from code from published
dimensions and photographs, with ambient occlusion baked into the vertex colours, written as glTF binary
for three.js (web/game/trains.js runs them; without this file it draws its own box models).

    pip install bpy==5.2.3
    python blender/build_railstock.py                 # -> web/assets/vehicles/railstock.glb, railstock.json
    python blender/build_railstock.py --preview dir   # Cycles stills instead

Each type has three bodies: `<Type>_Head` (a driving car, its cab at +z; the game turns it about for the
tail), `<Type>_Mid` and `<Type>_Pan` (a motor car with its pantograph raised to the wire), and a
decimated `_LOD1` of each for distance. Origin on the rail head under the car's middle; +z forward, +y up,
+x to the left.

The liveries are not in the model: every surface that takes a line's colour has a material of its own
(`Door`, `Band`, `Band2`, `Top`, `Face`), and the game paints them from the stock's own colours, so the
Yamanote, Keihin-Tohoku and Tokaido lines share one model.

    Commuter   JR East's 20 m four-door stock (E233, E235): body 19.5 m, 2.95 m wide over the widened
               sides (2.80 m at the sill), roof 3.62 m over the rail, floor 1.13 m; four pairs of sliding
               doors a side, 1.3 m wide and 1.85 m high, their centres 4.82 m apart; windows from 1.93 to
               2.85 m; bolsterless bogies 13.8 m apart with a 2.1 m wheelbase and 860 mm wheels; one
               roof-mounted air-conditioning unit; a single-arm pantograph. A flat cab face raked back
               above the waist, its upper part a black glazed mask wrapped round the corners, the line's
               colour under it, the headlamp clusters at its lower corners, a snowplough skirt and a
               tight-lock coupler.
    Waratah    Sydney Trains' A and B sets: 20.4 m over the couplers, 3.03 m wide, 4.41 m high; full
               skirts to 0.4 m over the rail hiding the bogies; a vestibule over each bogie with a pair of
               yellow plug doors a side; two decks between them, each one band of dark glass with slim
               black pillars; a cab leaning back from a yellow nose, its wrap-round windscreen in a black
               mask.

Sources: the Japanese Wikipedia articles on the E233 and E235 series (the railway's tables: lengths,
widths, heights, floor, door widths and spacing, bogie centres, wheelbase, wheels) and Wikipedia's
Sydney Trains A & B sets article; photographs on Wikimedia Commons for the faces, roofs, underfloor
equipment and bogies. What the tables do not give is read off photographs and is approximate. No logo,
lettering or number of either railway is reproduced.
"""
import argparse
import json
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_vehicles as V  # noqa: E402  (the shared mesh helpers, the bake and the export)
from build_vehicles import Mesh, T, box, cyl, tube, loft, material, HALF  # noqa: E402

OUT = V.OUT
TAU = 2 * math.pi


# ------------------------------------------------------------ materials (the game replaces them by name)
def materials():
    material("Steel", "#c3c8cb", rough=0.32, metal=0.85)            # stainless (the commuter) or painted steel
    material("Roof", "#7c8084", rough=0.75, metal=0.2)
    material("RoofKit", "#b9bdbf", rough=0.5, metal=0.4)            # the air conditioners' shells
    material("Grille", "#2a2d30", rough=0.6, metal=0.4)
    material("Under", "#26292c", rough=0.8, metal=0.2)              # underfloor equipment
    material("Bogie", "#33363a", rough=0.7, metal=0.3)
    material("Wheel", "#5a5754", rough=0.45, metal=0.8)
    material("Rubber", "#141516", rough=0.9)
    material("Black", "#0d0f11", rough=0.35, metal=0.2)             # seals, frames, pillars
    material("Mask", "#07090b", rough=0.08, metal=0.1, coat=1.0)    # the glazed black of a cab face
    material("Screen", "#0b1418", rough=0.04, metal=0.3)            # the driver's windscreen
    material("Window", "#1a2a30", rough=0.05, metal=0.3)            # a saloon window (the game lights it)
    material("Display", "#ff9a2a", rough=0.4, emit="#ff9a2a")       # destination displays
    material("Lamp", "#fff4dc", rough=0.1, emit="#fff4dc")          # headlamps
    material("LampTail", "#c81a10", rough=0.2, emit="#ff2a1c")
    material("Insulator", "#d9d4c8", rough=0.25)
    material("Panto", "#8a8f93", rough=0.4, metal=0.7)
    material("Door", "#8fc31f", rough=0.35, metal=0.2)              # the line's colours, painted by the game
    material("Band", "#00a7e3", rough=0.35, metal=0.1)
    material("Band2", "#0d6b38", rough=0.35, metal=0.1)
    material("Top", "#8fc31f", rough=0.35, metal=0.1)
    material("Face", "#8fc31f", rough=0.3, metal=0.1, coat=0.5)
    material("FaceLow", "#d6d9db", rough=0.35, metal=0.3)           # the cab face's lower part


# ------------------------------------------------------------ the body: sections, walls with openings, cab
class Body:
    """A car body from a half cross-section given as 'rungs' (y, z) from the bottom to the top: each rung is a
    pair of points (+y, z) and (-y, z). Between the rungs at z0 and z1 the sides are flat walls at y = +-hw,
    cut with openings (windows and doors, each with its reveal and what sits in it); below and above, the
    section is lofted along x through the walls' own grid lines, so the skin has no cracks."""

    def __init__(self, mesh, rungs, z0, z1, hw, mat_low, mat_up):
        self.m, self.r, self.z0, self.z1, self.hw = mesh, rungs, z0, z1, hw
        self.i0 = next(i for i, (y, z) in enumerate(rungs) if abs(z - z0) < 1e-6)
        self.i1 = next(i for i, (y, z) in enumerate(rungs) if abs(z - z1) < 1e-6)
        self.mat_low, self.mat_up = mat_low, mat_up  # material of a loft face from (y, z) of its middle

    def ring(self, x, sy=1.0, zf=None, xf=None):
        """The full ring at x (left side bottom to top, then right top to bottom), shaped by a width scale, a
        height map and a forward shift by height (the cab's rounding and rake)."""
        pts = []
        for side in (1, -1):
            seq = self.r if side == 1 else self.r[::-1]
            for y, z in seq:
                zz = zf(z) if zf else z
                pts.append((x + (xf(zz) if xf else 0), side * y * sy, zz))
        return pts

    def add_wall_zs(self, zs):
        """Give the section a rung at every height the walls are cut at, so the ends and the cab meet them."""
        have = {round(z, 5) for y, z in self.r[self.i0:self.i1 + 1]}
        new = [(self.hw, z) for z in zs if self.z0 < z < self.z1 and round(z, 5) not in have]
        self.r = sorted(self.r[:self.i1] + new, key=lambda p: p[1]) + self.r[self.i1:] if new else self.r
        self.i1 = next(i for i, (y, z) in enumerate(self.r) if abs(z - self.z1) < 1e-6)

    def skin(self, xs):
        """The lower and upper lofts through the stations xs (the walls between them are made by wall())."""
        lo, up = self.r[:self.i0 + 1], self.r[self.i1:]
        # lower: left side from the wall down, across the bottom, up the right side to the wall;
        # upper: right side from the wall up, over the roof, down the left side to the wall
        lo_strip = [(y, z) for (y, z) in reversed(lo)] + [(-y, z) for (y, z) in lo]
        up_strip = [(-y, z) for (y, z) in up] + [(y, z) for (y, z) in reversed(up)]
        for strip, matf in ((lo_strip, self.mat_low), (up_strip, self.mat_up)):
            rows = [[self.m.vert((x, y, z)) for (y, z) in strip] for x in xs]
            n = len(strip)
            for a, b in zip(rows[:-1], rows[1:]):
                for k in range(n - 1):
                    y, z = (strip[k][0] + strip[k + 1][0]) / 2, (strip[k][1] + strip[k + 1][1]) / 2
                    self.m.face([a[k], b[k], b[k + 1], a[k + 1]], matf(y, z), True)

    def cap(self, ring, mat_at, flip=False):
        """Close an end with quads between its rungs (ring() as built: left bottom->top, right top->bottom)."""
        n = len(self.r)
        L, R = ring[:n], ring[n:][::-1]
        ids = [(self.m.vert(L[k]), self.m.vert(R[k])) for k in range(n)]
        for k in range(n - 1):
            z = (L[k][2] + L[k + 1][2]) / 2
            f = [ids[k][0], ids[k + 1][0], ids[k + 1][1], ids[k][1]]
            self.m.face(f[::-1] if flip else f, mat_at(z), False)

    def loft_rings(self, rings, mat_at, smooth=True):
        """Quads between full rings of the same layout; mat_at(y, z) for each face."""
        rows = [[self.m.vert(p) for p in r] for r in rings]
        n = len(rings[0])
        for ra, rb, a, b in zip(rings[:-1], rings[1:], rows[:-1], rows[1:]):
            for k in range(n):
                k2 = (k + 1) % n
                y, z = (ra[k][1] + ra[k2][1]) / 2, (ra[k][2] + ra[k2][2]) / 2
                self.m.face([a[k], a[k2], b[k2], b[k]], mat_at(y, z), smooth)


def wall(mesh, side, y, x0, x1, z0, z1, openings, mat, step=0.6, zextra=()):
    """A flat side wall at y (side +1 left, -1 right) from x0 to x1 and z0 to z1, cut by openings
    [(xa, xb, za, zb, depth, reveal_mat, fill)]; fill(mesh, side, y_back, xa, xb, za, zb) puts what sits in
    the opening (glass, a door's leaves). Returns the x grid lines used (for the lofts above and below)."""
    xs = {x0, x1}
    zs = {z0, z1} | {z for z in zextra if z0 < z < z1}
    for (xa, xb, za, zb, *_r) in openings:
        xs |= {xa, xb}
        zs |= {za, zb}
    k = 1
    while x0 + k * step < x1 - 0.05:
        xs.add(round(x0 + k * step, 4))
        k += 1
    xs = sorted(xs)
    zs = sorted(zs)
    # drop near-duplicates
    def dedupe(v):
        out = [v[0]]
        for a in v[1:]:
            if a - out[-1] > 1e-4:
                out.append(a)
        return out
    xs, zs = dedupe(xs), dedupe(zs)
    vid = {}

    def V_(x, z):
        key = (round(x, 5), round(z, 5))
        if key not in vid:
            vid[key] = mesh.vert((x, y, z))
        return vid[key]

    def inside(xm, zm):
        return any(xa < xm < xb and za < zm < zb for (xa, xb, za, zb, *_r) in openings)
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            xm, zm = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if inside(xm, zm):
                continue
            q = [V_(xs[i], zs[j]), V_(xs[i + 1], zs[j]), V_(xs[i + 1], zs[j + 1]), V_(xs[i], zs[j + 1])]
            mesh.face(q[::-1] if side > 0 else q, mat(xm, zm) if callable(mat) else mat, False)
    for (xa, xb, za, zb, depth, rmat, fill) in openings:
        yb = y - side * depth
        # the reveal: four faces from the wall's plane back to the opening's depth, through the wall's own
        # grid points on its edges so they join without cracks
        ex = [x for x in xs if xa - 1e-6 <= x <= xb + 1e-6]
        ez = [z for z in zs if za - 1e-6 <= z <= zb + 1e-6]
        loops = ([(x, za) for x in ex] + [(xb, z) for z in ez[1:]] + [(x, zb) for x in ex[::-1][1:]] + [(xa, z) for z in ez[::-1][1:]])
        for (pa, pb) in zip(loops, loops[1:] + loops[:1]):
            if pa == pb:
                continue
            a0, b0 = V_(*pa), V_(*pb)
            a1, b1 = mesh.vert((pa[0], yb, pa[1])), mesh.vert((pb[0], yb, pb[1]))
            f = [a0, a1, b1, b0]
            mesh.face(f if side > 0 else f[::-1], rmat, False)
        if fill:
            fill(mesh, side, yb, xa, xb, za, zb)
    return xs, zs


def pane(mat, inset=0.0):
    """An opening's fill: a flat pane at the back of the reveal."""
    def f(mesh, side, yb, xa, xb, za, zb):
        q = [mesh.vert((xa + inset, yb, za + inset)), mesh.vert((xb - inset, yb, za + inset)),
             mesh.vert((xb - inset, yb, zb - inset)), mesh.vert((xa + inset, yb, zb - inset))]
        mesh.face(q[::-1] if side > 0 else q, mat, False)
    return f


def rrect_panel(mesh, mat, side, y, xc, zc, w, h, rc, t=0.006, seg=4):
    """A thin rounded-rectangle panel standing proud of a wall at y (outward by side)."""
    pts = []
    for (cx, cz, a0) in ((w / 2 - rc, h / 2 - rc, 0), (-(w / 2 - rc), h / 2 - rc, HALF), (-(w / 2 - rc), -(h / 2 - rc), math.pi), (w / 2 - rc, -(h / 2 - rc), 3 * HALF)):
        for s in range(seg + 1):
            a = a0 + HALF * s / seg
            pts.append((xc + cx + rc * math.cos(a), zc + cz + rc * math.sin(a)))
    front = [mesh.vert((x, y + side * t, z)) for x, z in pts]
    back = [mesh.vert((x, y, z)) for x, z in pts]
    mesh.face(front[::-1] if side > 0 else front, mat, False)
    n = len(pts)
    for k in range(n):
        k2 = (k + 1) % n
        f = [back[k], back[k2], front[k2], front[k]]
        mesh.face(f[::-1] if side > 0 else f, mat, False)


def sheet(mesh, mat, f, nu, nv, thick):
    """A plate from a surface f(u, v) -> (x, y, z) over [0, 1]^2, given thickness along +x behind it (front faces +x)."""
    front = [[mesh.vert(f(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    back = [[mesh.vert((lambda p: (p[0] - thick, p[1], p[2]))(f(i / nu, j / nv))) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            mesh.face([front[i][j], front[i + 1][j], front[i + 1][j + 1], front[i][j + 1]], mat, True)
            mesh.face([back[i][j], back[i][j + 1], back[i + 1][j + 1], back[i + 1][j]], mat, True)
    for i in range(nu):  # bottom and top edges
        mesh.face([front[i][0], back[i][0], back[i + 1][0], front[i + 1][0]], mat, False)
        mesh.face([front[i][nv], front[i + 1][nv], back[i + 1][nv], back[i][nv]], mat, False)
    for i in (0, nu):
        mesh.face([front[i][j] for j in range(nv + 1)] + [back[i][j] for j in range(nv, -1, -1)], mat, False)


def helix(mesh, mat, c, r, h, turns, wire):
    pts = [(c[0] + r * math.cos(TAU * turns * t), c[1] + r * math.sin(TAU * turns * t), c[2] + h * t) for t in [i / (turns * 10) for i in range(int(turns * 10) + 1)]]
    tube(mesh, mat, pts, wire, segs=6)


# ------------------------------------------------------------ shared running gear and roof kit
def wheelset(m, x, gauge_y=0.585, r=0.43):
    for s in (1, -1):
        y = s * gauge_y
        cyl(m, "Wheel", r, 0.13, T((x, y, r), (HALF, 0, 0)), segs=24)                    # tread
        cyl(m, "Wheel", r + 0.028, 0.022, T((x, y - s * 0.07, r), (HALF, 0, 0)), segs=24)  # flange (inboard)
        cyl(m, "Bogie", 0.33, 0.135, T((x, y + s * 0.005, r), (HALF, 0, 0)), segs=20)      # the disc, painted
        cyl(m, "Wheel", 0.13, 0.2, T((x, y, r), (HALF, 0, 0)), segs=14)                    # hub
    cyl(m, "Wheel", 0.08, 1.3, T((x, 0, r), (HALF, 0, 0)), segs=10)                        # axle


def bogie(m, xc, wb=2.1, motor=True, frame_y=1.0, top=0.95):
    for dx in (-wb / 2, wb / 2):
        x = xc + dx
        wheelset(m, x)
        for s in (1, -1):
            y = s * frame_y
            box(m, "Bogie", (0.36, 0.22, 0.26), T((x, y, 0.43)), bevel=0.02)                # axle box
            cyl(m, "Under", 0.095, 0.05, T((x, y + s * 0.13, 0.43), (HALF, 0, 0)), segs=12)   # its end cap
            helix(m, "Bogie", (x + 0.0, y, 0.55), 0.085, 0.2, 4, 0.016)                     # the coil spring on it
            box(m, "Under", (0.16, 0.12, 0.3), T((x - math.copysign(0.42, dx), s * 0.75, 0.48)), bevel=0.01)  # tread brake unit
        if motor:
            cyl(m, "Under", 0.24, 0.62, T((x - math.copysign(0.48, dx), 0.12, 0.45), (HALF, 0, 0)), segs=16)  # traction motor
            box(m, "Under", (0.32, 0.28, 0.36), T((x, -0.42, 0.43)), bevel=0.03)             # gearbox
    for s in (1, -1):
        y = s * frame_y
        # the side frame: deep and low in the middle, rising thin over the axle boxes
        secs = []
        for t in [i / 12 for i in range(13)]:
            x = xc - wb / 2 - 0.35 + (wb + 0.7) * t
            u = abs(x - xc) / (wb / 2 + 0.35)
            zc = 0.60 + 0.16 * max(0.0, u - 0.45) / 0.55
            hh = 0.30 - 0.14 * max(0.0, u - 0.45) / 0.55
            secs.append([(x, y - 0.11, zc - hh / 2), (x, y + 0.11, zc - hh / 2), (x, y + 0.11, zc + hh / 2), (x, y - 0.11, zc + hh / 2)])
        loft(m, "Bogie", secs, caps=True, smooth=False)
        cyl(m, "Rubber", 0.27, 0.2, T((xc, y, top - 0.12)), segs=20)                           # air spring
        cyl(m, "Bogie", 0.30, 0.03, T((xc, y, top - 0.235)), segs=20)
        tube(m, "Under", [(xc - 0.3, y + s * 0.18, 0.62), (xc + 0.9, y + s * 0.2, top - 0.05)], 0.04, segs=8)  # yaw damper
    box(m, "Bogie", (0.5, 2.1, 0.26), T((xc, 0, 0.6)), bevel=0.02)                                 # transom


def under_kit(m, boxes, z_top):
    """Underfloor equipment: (x0, x1, height, y_out, depth, finned)."""
    for (x0, x1, h, yo, d, fins) in boxes:
        for s in (1, -1) if yo is None else (yo,):
            ya = abs(1.25 if yo is None else 1.25)
            y = s * (ya - d / 2)
            box(m, "Under", (x1 - x0, d, h), T(((x0 + x1) / 2, y, z_top - h / 2)), bevel=0.015)
            if fins:
                n = int((x1 - x0) / 0.07)
                for k in range(n):
                    box(m, "Grille", (0.012, 0.05, h * 0.8), T((x0 + 0.04 + k * (x1 - x0 - 0.08) / max(1, n - 1), s * (ya + 0.02), z_top - h / 2)))
            else:
                # a seam and a pair of latches on the face
                box(m, "Black", ((x1 - x0) * 0.96, 0.006, 0.012), T(((x0 + x1) / 2, s * ya, z_top - h * 0.3)))
                for e in (-0.3, 0.3):
                    box(m, "Black", (0.05, 0.01, 0.04), T(((x0 + x1) / 2 + e * (x1 - x0), s * ya, z_top - h * 0.62)))


def pantograph(m, px, z_base, z_wire, flip=False):
    """A single-arm pantograph standing on four insulators, its head pressed to the wire."""
    sd = -1 if flip else 1
    for dx in (-0.42, 0.42):
        for dy in (-0.45, 0.45):
            cyl(m, "Insulator", 0.055, 0.2, T((px + dx, dy, z_base + 0.1)), segs=10)
            for k in range(3):
                cyl(m, "Insulator", 0.1, 0.022, T((px + dx, dy, z_base + 0.04 + k * 0.06)), segs=12)
    zb = z_base + 0.22
    for dy in (-0.45, 0.45):
        box(m, "Panto", (1.1, 0.07, 0.06), T((px, dy, zb)))
    for dx in (-0.48, 0.48):
        box(m, "Panto", (0.07, 0.97, 0.06), T((px + dx, 0, zb)))
    hinge = (px - sd * 0.45, 0, zb + 0.08)
    h = z_wire - 0.05 - zb
    knee = (px + sd * 0.95, 0, zb + 0.08 + h * 0.5)
    head = (px - sd * 0.02, 0, z_wire - 0.08)
    box(m, "Panto", (0.3, 0.6, 0.12), T((hinge[0], 0, hinge[2])), bevel=0.02)               # the hinge and its spring box
    tube(m, "Panto", [hinge, knee], lambda t: 0.055 - 0.02 * t, segs=8)                       # lower arm
    tube(m, "Panto", [(hinge[0] + sd * 0.12, 0.12, hinge[2] + 0.04), (knee[0] - sd * 0.15, 0.06, knee[2] - 0.02)], 0.014, segs=6)  # balance rod
    for dy in (-0.28, 0.28):
        tube(m, "Panto", [knee, (head[0], dy, head[2] - 0.03)], 0.022, segs=6)              # upper arm, a V
    cyl(m, "Panto", 0.04, 0.2, T(knee, (HALF, 0, 0)), segs=8)
    box(m, "Panto", (0.08, 0.7, 0.05), T((head[0], 0, head[2] - 0.03)))
    for dx in (-0.14, 0.14):
        box(m, "Panto", (0.06, 1.25, 0.05), T((head[0] + dx, 0, head[2] + 0.02)))           # collector strips
        for s in (1, -1):
            pts = [(head[0] + dx, s * (0.62 + 0.36 * math.sin(a)), head[2] + 0.02 - 0.18 * (1 - math.cos(a))) for a in [i / 6 * HALF for i in range(7)]]
            tube(m, "Panto", pts, 0.016, segs=6)                                               # the horns
    return head


def aircon(m, xc, z_roof, length=4.2, width=2.15, h=0.32, fans=(-1.0, 1.0)):
    box(m, "RoofKit", (length, width, h), T((xc, 0, z_roof + h / 2 - 0.02)), bevel=0.06, segs=3)
    for fx in fans:
        cyl(m, "Grille", 0.44, 0.02, T((xc + fx, 0, z_roof + h - 0.005)), segs=28)
        cyl(m, "RoofKit", 0.08, 0.04, T((xc + fx, 0, z_roof + h)), segs=12)
        for k in range(8):
            a = k / 8 * math.pi
            box(m, "RoofKit", (0.86, 0.025, 0.02), T((xc + fx, 0, z_roof + h + 0.005), (0, 0, a)))
    for s in (1, -1):  # the condensers' louvres down each side
        for k in range(int((length - 0.8) / 0.09)):
            box(m, "Grille", (0.03, 0.012, h * 0.55), T((xc - length / 2 + 0.4 + k * 0.09, s * (width / 2 + 0.003), z_roof + h * 0.48)))


# ------------------------------------------------------------ the commuter car (E233 / E235)
C = dict(L=19.5, hw=1.475, z0=1.12, z1=3.02, top=3.62, floor=1.13, bogies=6.9, wb=2.1)
C_RUNGS = [(1.25, 0.95), (1.34, 0.955), (1.40, 0.975), (1.44, 1.01), (1.465, 1.06), (1.475, 1.12),
           (1.475, 1.42), (1.475, 1.56), (1.475, 1.93), (1.475, 2.85), (1.475, 3.02),
           (1.468, 3.10), (1.45, 3.18), (1.42, 3.25), (1.36, 3.33), (1.31, 3.38), (1.24, 3.43), (1.10, 3.51),
           (0.85, 3.575), (0.55, 3.607), (0.2, 3.62)]
C_DOORS = [-7.23, -2.41, 2.41, 7.23]


def door_pair(m, side, yb, xc, z0, z1, width, win=(0.62, 0.40, 0.74), leaf="Door"):
    """Two sliding leaves filling a door opening at yb, each with its window; the line between them black."""
    for e in (-1, 1):
        xa, xb = (xc - width / 2, xc - 0.006) if e < 0 else (xc + 0.006, xc + width / 2)
        q = [m.vert((xa, yb, z0)), m.vert((xb, yb, z0)), m.vert((xb, yb, z1)), m.vert((xa, yb, z1))]
        m.face(q[::-1] if side > 0 else q, leaf, False)
        wz, ww, wh = win
        cx = xc + e * width / 4
        rrect_panel(m, "Black", side, yb, cx, z0 + wz + wh / 2 + 0.2, ww + 0.05, wh + 0.05, 0.06, t=0.004)
        rrect_panel(m, "Window", side, yb + side * 0.004, cx, z0 + wz + wh / 2 + 0.2, ww, wh, 0.05, t=0.003)
    box(m, "Rubber", (0.02, 0.012, z1 - z0), T((xc, yb + side * 0.006, (z0 + z1) / 2)))


def build_commuter(role):
    m = Mesh()
    L, hw, z0, z1, top = C["L"], C["hw"], C["z0"], C["z1"], C["top"]
    head = role == "head"
    xe = L / 2
    x_nose = 9.45 if head else xe

    def mat_low(y, z):
        return "Steel"

    def mat_up(y, z):
        if z > 3.4 and abs(y) < 1.3:
            return "Roof"
        return "Steel"
    body = Body(m, C_RUNGS, z0, z1, hw, mat_low, mat_up)
    # the side walls and their openings
    wins = [(-9.3, -8.2), (-6.26, -3.38), (-1.44, 1.44), (3.38, 6.26)]
    wins += [] if head else [(8.2, 9.3)]
    wz0, wz1 = 1.93, 2.85
    xs_all = set()
    for side in (1, -1):
        y = side * hw
        ops = []
        for (xa, xb) in wins:
            def glass(mesh, sd, yb, a, b, za, zb):
                pane("Window")(mesh, sd, yb, a, b, za, zb)
                if b - a > 2.0:   # a mullion halves the wide windows
                    box(mesh, "Black", (0.05, 0.03, zb - za), T(((a + b) / 2, yb + sd * 0.01, (za + zb) / 2)))
            ops.append((xa, xb, wz0, wz1, 0.035, "Black", glass))
        for xc in C_DOORS:
            def door(mesh, sd, yb, a, b, za, zb, xc=xc):
                door_pair(mesh, sd, yb, xc, za, zb, b - a)
            ops.append((xc - 0.65, xc + 0.65, C["floor"], 2.98, 0.03, "Steel", door))
        if head:
            ops.append((7.95, 8.38, wz0, wz1, 0.035, "Black", pane("Window")))
            def crew(mesh, sd, yb, a, b, za, zb):
                q = [mesh.vert((a, yb, za)), mesh.vert((b, yb, za)), mesh.vert((b, yb, zb)), mesh.vert((a, yb, zb))]
                mesh.face(q[::-1] if sd > 0 else q, "Steel", False)
                rrect_panel(mesh, "Black", sd, yb, (a + b) / 2, 2.4, 0.46, 0.74, 0.05, t=0.004)
                rrect_panel(mesh, "Window", sd, yb + sd * 0.004, (a + b) / 2, 2.4, 0.42, 0.7, 0.04, t=0.003)
            ops.append((8.62, 9.18, C["floor"], 2.95, 0.02, "Black", crew))
        xs, zs = wall(m, side, y, -xe, x_nose, z0, z1, ops, "Steel", zextra=[z for _, z in body.r])
        xs_all |= set(xs)
        body.add_wall_zs(zs)
        # bands: under the windows and along the cant, broken by the doors (whose leaves carry their own)
        gaps = [(xc - 0.65, xc + 0.65) for xc in C_DOORS] + ([(8.62, 9.18)] if head else [])
        def strip(mat, za, zb, xa=-xe + 0.05, xb=x_nose - 0.02, t=0.003):
            cuts = sorted(g for g in gaps if g[1] > xa and g[0] < xb)
            a = xa
            for g0, g1 in cuts + [(xb, xb)]:
                if g0 - a > 0.02:
                    box(m, mat, (g0 - a, t, zb - za), T(((a + g0) / 2, side * (hw + t / 2), (za + zb) / 2)))
                a = max(a, g1)
        strip("Band", 1.66, 1.80)
        strip("Band2", 1.56, 1.66)
        strip("Top", 2.92, 3.0)
        # the leaves' share of the bands, on the door at its own depth
        for xc in C_DOORS:
            for mat, za, zb in (("Band", 1.66, 1.80), ("Band2", 1.56, 1.66)):
                for e in (-1, 1):
                    box(m, mat, (0.63, 0.003, zb - za), T((xc + e * 0.33, side * (hw - 0.03 + 0.0015), (za + zb) / 2)))
        # the rain gutter along the cant, drip rails over the doors, the side destination display
        box(m, "Steel", (L - 0.1 if not head else L - 0.4, 0.035, 0.03), T((-0.15 if head else 0, side * 1.43, 3.26)))
        for xc in C_DOORS:
            box(m, "Steel", (1.45, 0.025, 0.018), T((xc, side * (hw + 0.012), 3.0)))
        box(m, "Black", (0.95, 0.03, 0.22), T((-4.82 if side > 0 else 4.82, side * (hw + 0.015), 2.95 - 0.0)), bevel=0.01)
        box(m, "Display", (0.86, 0.01, 0.15), T((-4.82 if side > 0 else 4.82, side * (hw + 0.031), 2.95)))
        # the car's lower edge: a black sill line
        box(m, "Black", (L - (0.5 if head else 0.1), 0.012, 0.025), T((-0.25 if head else 0, side * 1.468, 1.075)))
    xs = sorted(x for x in xs_all if -xe - 1e-6 <= x <= x_nose + 1e-6)
    body.skin(xs)
    # the far end: the end wall, the gangway's frame and bellows, the coupler
    body.cap(body.ring(-xe), lambda z: "Steel", flip=True)
    ends = [-1] if head else [-1, 1]
    for e in ends:
        if e > 0:
            body.cap(body.ring(xe), lambda z: "Steel")
        x = e * xe
        box(m, "Black", (0.06, 1.3, 2.05), T((x + e * 0.03, 0, 2.15)))
        for k in range(4):
            box(m, "Rubber", (0.05, 1.2 - k * 0.02, 1.95 - k * 0.02), T((x + e * (0.08 + k * 0.05), 0, 2.15)), bevel=0.012)
        box(m, "Black", (0.04, 0.85, 1.75), T((x + e * 0.01, 0, 2.05)))
        box(m, "Under", (0.5, 0.22, 0.2), T((x + e * 0.12, 0, 0.86)))                     # semi-permanent coupler
        for s in (1, -1):
            tube(m, "Black", [(x - e * 0.05, s * 0.5, 0.9), (x + e * 0.18, s * 0.42, 0.75), (x + e * 0.25, s * 0.3, 0.72)], 0.025, segs=6)
            tube(m, "Steel", [(x + e * 0.01, s * 1.0, 1.2), (x + e * 0.01, s * 1.0, 2.9)], 0.015, segs=6)  # end grab rail
    if head:
        cab_commuter(m, body)
    # the roof: one air-conditioning unit, a pantograph on a motor car, antennas over a cab
    aircon(m, -0.5 if role == "pan" else 0.0, top)
    if role == "pan":
        pantograph(m, 5.4, top, 5.0)
        for s in (1, -1):
            tube(m, "Panto", [(5.4, s * 0.45, top + 0.12), (5.4, s * 0.62, top + 0.02), (9.4, s * 0.62, top - 0.01)], 0.03, segs=8)  # roof conduits
        cyl(m, "Insulator", 0.06, 0.25, T((3.6, 0.5, top + 0.12)), segs=10)               # lightning arrester
        for k in range(4):
            cyl(m, "Insulator", 0.09, 0.02, T((3.6, 0.5, top + 0.04 + k * 0.05)), segs=12)
        box(m, "RoofKit", (1.2, 0.5, 0.1), T((2.4, -0.45, top + 0.03)), bevel=0.02)
    if head:
        for (x, y, h) in ((7.2, 0.3, 0.35), (6.6, -0.35, 0.22)):
            cyl(m, "Black", 0.012, h, T((x, y, top + h / 2)), segs=6)
            box(m, "Black", (0.18, 0.12, 0.03), T((x, y, top + 0.01)))
        box(m, "RoofKit", (0.6, 0.4, 0.15), T((5.7, 0, top + 0.05)), bevel=0.03)
    # running gear and underfloor
    motor = role == "pan" or role == "mid"
    for xc in (-C["bogies"], C["bogies"]):
        bogie(m, xc, C["wb"], motor=motor)
    kit = [(-4.9, -3.1, 0.5, 1, 0.8, True), (-2.8, -1.0, 0.45, 1, 0.7, False), (-0.6, 1.6, 0.52, 1, 0.9, motor),
           (2.0, 3.0, 0.4, 1, 0.6, False), (3.3, 4.9, 0.48, 1, 0.75, False),
           (-4.8, -3.4, 0.42, -1, 0.7, False), (-3.1, -1.2, 0.5, -1, 0.85, True), (-0.4, 0.8, 0.36, -1, 0.55, False),
           (1.2, 3.4, 0.46, -1, 0.8, False), (3.7, 4.8, 0.38, -1, 0.6, False)]
    under_kit(m, kit, 0.95)
    box(m, "Under", (L * 0.6, 0.7, 0.08), T((0, 0, 0.9)))                                       # cable trays down the middle
    return m


def cab_commuter(m, body):
    """The cab at +x: the body rounds in plan and rakes back above the waist; its upper part is the black
    glazed mask (wrapping round the corners), the line's colour under it, the light lower face below."""
    hw, top = C["hw"], C["top"]
    x0, rc = 9.45, 0.31
    thetas = [i / 7 * math.radians(84) for i in range(8)]
    rake, zr = 0.11, 1.56

    def zone(y, z):
        if z < 1.42:
            return "FaceLow"
        if z < 1.56:
            return "Face"
        if z < 3.38:
            return "Mask"
        return "Roof" if abs(y) < 1.0 else "Mask"
    rings = []
    for th in thetas:
        inset = rc * (1 - math.cos(th))
        x = x0 + rc * math.sin(th)
        sy = (hw - inset) / hw
        top_in = 0.18 * (1 - math.cos(th))
        f = math.sin(th)
        rings.append(body.ring(x, sy,
                               zf=lambda z, ti=top_in: z - ti * max(0.0, z - 2.9) / (top - 2.9),
                               xf=lambda z, f=f: -rake * f * max(0.0, z - zr) / (top - zr)))
    body.loft_rings(rings, lambda y, z: zone(y, z) if True else "Steel")
    # the first ring meets the side walls in steel: repaint the faces between the first two rings by height
    body.cap(rings[-1], lambda z: zone(0, z))
    xt = x0 + rc * math.sin(thetas[-1])

    def fx(z):  # the face's x at height z
        return xt - rake * max(0.0, z - zr) / (top - zr)
    ang = math.atan(rake / (top - zr))

    def on_face(mat, w, h, y, z, d=0.006, depth=0.01, bevel=0.0):
        box(m, mat, (depth, w, h), T((fx(z) + d, y, z), (0, -ang if z > zr else 0, 0)), bevel=bevel)
    on_face("Screen", 2.2, 1.05, 0, 2.38, d=0.004)
    on_face("Black", 2.26, 1.11, 0, 2.38, d=0.0)
    on_face("Black", 1.5, 0.24, 0, 3.15, d=0.003)
    on_face("Display", 1.38, 0.16, 0, 3.15, d=0.009)
    for s in (1, -1):  # the wipers, parked
        tube(m, "Black", [(fx(1.92) + 0.03, s * 0.55, 1.92), (fx(2.1) + 0.03, s * 0.05, 2.05)], 0.012, segs=5)
        # headlamp cluster: a black housing with two round lamps and the tail lamp beside them
        box(m, "Black", (0.05, 0.62, 0.26), T((xt + 0.01, s * 0.92, 1.24)), bevel=0.02)
        for dy in (-0.1, 0.1):
            cyl(m, "Lamp", 0.07, 0.03, T((xt + 0.035, s * 0.92 + dy, 1.26), (0, HALF, 0)), segs=16)
            cyl(m, "Steel", 0.085, 0.02, T((xt + 0.03, s * 0.92 + dy, 1.26), (0, HALF, 0)), segs=16)
        box(m, "LampTail", (0.03, 0.16, 0.07), T((xt + 0.035, s * 0.92 - s * 0.24, 1.25)))
        tube(m, "Steel", [(xt - 0.3, s * 1.32, 1.3), (xt - 0.2, s * 1.36, 1.3), (xt - 0.2, s * 1.36, 2.6), (xt - 0.3, s * 1.32, 2.6)], 0.014, segs=6)  # grab rail
        box(m, "Black", (0.4, 0.1, 0.03), T((8.9, s * 1.42, 0.9)))                                 # the crew's step
    # the snowplough skirt: a plate bowed forward in plan and leaning back, its wings swept round to the sides
    def plough(u, v):
        y = (u - 0.5) * 2.7
        a = abs(y) / 1.35
        z = 0.26 + 0.68 * v
        return (9.5 + 0.30 * (1 - a ** 2.2) - 0.16 * v - 0.25 * a ** 6, y, z)
    sheet(m, "Under", plough, 16, 3, 0.05)
    for k in range(4):
        z = 0.34 + k * 0.15
        pts = [(lambda p: (p[0] + 0.012, p[1], p[2]))(plough(u / 12, (z - 0.26) / 0.68)) for u in range(1, 12)]
        tube(m, "Black", pts, 0.012, segs=5, caps=False)
    box(m, "Rubber", (0.06, 1.6, 0.06), T((9.78, 0, 0.27)))
    box(m, "Under", (0.75, 0.16, 0.14), T((9.85, 0, 0.86)))
    box(m, "Bogie", (0.18, 0.32, 0.32), T((10.18, 0, 0.86)), bevel=0.02)
    for s in (1, -1):
        tube(m, "Rubber", [(9.75, s * 0.35, 0.95), (9.98, s * 0.38, 0.8), (10.05, s * 0.36, 0.62)], 0.025, segs=6)


# ------------------------------------------------------------ the Waratah double-deck car
W = dict(L=19.9, hw=1.515, z0=0.42, z1=3.62, top=4.41, floor=1.15, bogies=7.2, wb=2.5)
W_RUNGS = [(1.40, 0.39), (1.48, 0.395), (1.505, 0.405), (1.515, 0.42),
           (1.515, 1.2), (1.515, 1.3), (1.515, 2.04), (1.515, 2.66), (1.515, 3.46), (1.515, 3.62),
           (1.50, 3.75), (1.46, 3.90), (1.39, 4.04), (1.29, 4.16), (1.15, 4.27), (0.98, 4.35), (0.77, 4.40), (0.5, 4.41)]


def band_of_glass(n, pane_w, pitch, pillar="Black"):
    def f(mesh, side, yb, xa, xb, za, zb):
        pane("Window")(mesh, side, yb, xa, xb, za, zb)
        for k in range(1, n):
            x = xa + (xb - xa) * k / n
            box(mesh, pillar, (0.07, 0.03, zb - za), T((x, yb + side * 0.012, (za + zb) / 2)))
    return f


def build_waratah(role):
    m = Mesh()
    L, hw, z0, z1, top = W["L"], W["hw"], W["z0"], W["z1"], W["top"]
    head = role == "head"
    xe = L / 2
    x_nose = 9.0 if head else xe

    def mat_up(y, z):
        return "Roof" if abs(y) < 1.2 else "Steel"
    body = Body(m, W_RUNGS, z0, z1, hw, lambda y, z: "Steel", mat_up)
    xs_all = set()
    for side in (1, -1):
        y = side * hw
        ops = [(-5.25, 5.25, 1.2, 2.04, 0.03, "Black", band_of_glass(5, 1.98, 2.04)),
               (-5.25, 5.25, 2.66, 3.46, 0.03, "Black", band_of_glass(5, 1.98, 2.04))]
        for xc in (-6.95, 6.95):
            def door(mesh, sd, yb, a, b, za, zb, xc=xc):
                door_pair(mesh, sd, yb, xc, za, zb, b - a, win=(0.55, 0.42, 1.25))
            ops.append((xc - 0.8, xc + 0.8, W["floor"], 3.16, 0.025, "Black", door))
        for xc in ([-8.85] if head else [-8.85, 8.85]):
            ops.append((xc - 0.42, xc + 0.42, 2.28, 3.1, 0.03, "Black", pane("Window")))
        if head:
            ops.append((7.9, 8.38, 1.9, 3.0, 0.03, "Black", pane("Window")))
        xs, zs = wall(m, side, y, -xe, x_nose, z0, z1, ops, "Steel", zextra=[z for _, z in body.r])
        xs_all |= set(xs)
        body.add_wall_zs(zs)
        # the yellow line along the foot of the side, and a black sill under the doors
        a = -xe + 0.1
        for g0, g1 in [(-7.75, -6.15), (6.15, 7.75), (x_nose - 0.05, x_nose)]:
            if g0 - a > 0.02:
                box(m, "Door", (g0 - a, 0.004, 0.05), T(((a + g0) / 2, side * (hw + 0.002), 0.66)))
            a = g1
        box(m, "Steel", (L - (1.6 if head else 0.2), 0.03, 0.03), T((-0.8 if head else 0, side * 1.47, 3.95)))  # rain strip
        box(m, "Black", (0.9, 0.025, 0.2), T((-4.0 * side, side * (hw + 0.012), 3.53)), bevel=0.01)
        box(m, "Display", (0.82, 0.01, 0.13), T((-4.0 * side, side * (hw + 0.027), 3.53)))
    xs = sorted(x for x in xs_all if -xe - 1e-6 <= x <= x_nose + 1e-6)
    body.skin(xs)
    body.cap(body.ring(-xe), lambda z: "Steel", flip=True)
    for e in ([-1] if head else [-1, 1]):
        if e > 0:
            body.cap(body.ring(xe), lambda z: "Steel")
        x = e * xe
        box(m, "Black", (0.06, 1.3, 2.4), T((x + e * 0.03, 0, 2.4)))
        for k in range(4):
            box(m, "Rubber", (0.05, 1.2 - k * 0.02, 2.3 - k * 0.02), T((x + e * (0.08 + k * 0.05), 0, 2.4)), bevel=0.012)
        box(m, "Under", (0.5, 0.25, 0.22), T((x + e * 0.1, 0, 0.85)))
    if head:
        cab_waratah(m, body)
    for x in (-7.6, 7.6) if not head else (-7.6, 6.4):
        aircon(m, x, top - 0.03, length=2.8, width=2.0, h=0.14, fans=(-0.6, 0.6))
    if role == "pan":
        pantograph(m, 3.6, top - 0.02, 5.25)
        for s in (1, -1):
            tube(m, "Panto", [(3.6, s * 0.45, top + 0.12), (3.6, s * 0.6, top + 0.02), (-5.8, s * 0.6, top + 0.0)], 0.03, segs=8)
    for xc in (-W["bogies"], W["bogies"]):
        bogie(m, xc, W["wb"], motor=role != "head", frame_y=1.0, top=0.9)
    return m


def cab_waratah(m, body):
    hw, top = W["hw"], W["top"]
    x0, rc = 9.0, 0.85
    thetas = [i / 9 * math.radians(80) for i in range(10)]
    rake, zr = 0.95, 1.3

    def zone(y, z):
        if z < 1.3:
            return "Face"
        if z < 3.55:
            return "Mask"
        return "Face"
    rings = []
    for th in thetas:
        inset = rc * (1 - math.cos(th))
        f = math.sin(th)
        top_in = 0.55 * (1 - math.cos(th))
        rings.append(body.ring(x0 + rc * f, (hw - inset) / hw,
                               zf=lambda z, ti=top_in: z - ti * max(0.0, z - 3.0) / (top - 3.0),
                               xf=lambda z, f=f: -rake * f * f * max(0.0, z - zr) / (top - zr)))
    body.loft_rings(rings, zone)
    body.cap(rings[-1], lambda z: zone(0, z))
    xt = x0 + rc * math.sin(thetas[-1])
    ang = math.atan(rake / (top - zr))

    def fx(z):
        return xt - rake * max(0.0, z - zr) / (top - zr)

    def on_face(mat, w, h, y, z, d=0.006, depth=0.01):
        box(m, mat, (depth, w, h), T((fx(z) + d, y, z), (0, -ang if z > zr else 0, 0)))
    on_face("Screen", 2.3, 1.25, 0, 2.55, d=0.006)
    on_face("Black", 1.5, 0.22, 0, 3.38, d=0.004)
    on_face("Display", 1.38, 0.15, 0, 3.38, d=0.009)
    for s in (1, -1):
        tube(m, "Black", [(fx(2.0) + 0.03, s * 0.6, 2.0), (fx(2.2) + 0.03, s * 0.08, 2.18)], 0.012, segs=5)
        box(m, "Black", (0.05, 0.5, 0.22), T((xt + 0.01, s * 0.95, 1.0)), bevel=0.02)
        for dy in (-0.11, 0.11):
            cyl(m, "Lamp", 0.065, 0.03, T((xt + 0.035, s * 0.95 + dy, 1.0), (0, HALF, 0)), segs=16)
        box(m, "LampTail", (0.03, 0.12, 0.06), T((xt + 0.035, s * 0.6, 1.0)))
    # the anti-climber, coupler and obstacle deflector
    box(m, "Under", (0.25, 2.4, 0.22), T((xt + 0.05, 0, 0.62)), bevel=0.02)
    for k in range(3):
        box(m, "Black", (0.03, 2.3, 0.025), T((xt + 0.18, 0, 0.55 + k * 0.07)))
    secs = [[(x, -w / 2, 0.2), (x, w / 2, 0.2), (x, w / 2, 0.45), (x, -w / 2, 0.45)] for (x, w) in ((xt - 0.6, 2.7), (xt + 0.05, 2.4), (xt + 0.3, 1.6))]
    loft(m, "Under", secs, caps=True, smooth=False)
    box(m, "Under", (0.7, 0.18, 0.16), T((xt + 0.35, 0, 0.85)))
    box(m, "Bogie", (0.2, 0.34, 0.34), T((xt + 0.68, 0, 0.85)), bevel=0.02)


# ------------------------------------------------------------ build, bake, export
TYPES = {"Commuter": build_commuter, "Waratah": build_waratah}
ROLES = {"Head": "head", "Mid": "mid", "Pan": "pan"}


def weld(ob):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    bm.to_mesh(ob.data)
    bm.free()


def build_all():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    V.MAT.clear()
    materials()
    objs = {}
    for k, (t, fn) in enumerate(TYPES.items()):
        for j, (r, role) in enumerate(ROLES.items()):
            name = f"{t}_{r}"
            ob = fn(role).build(name)
            weld(ob)
            ob.location = V.to_blender((0, (k * 3 + j) * 6.0, 0))
            objs[name] = ob
    return objs


def stage_preview(samples, res):
    V.setup_render(samples, res, sun=(32, 215))
    V.ground_plane("Ground", 400, material("Ballast", "#57524c", 0.95))
    V.sun_lamp(32, 215, 3.6)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", help="render stills into this folder instead of exporting")
    ap.add_argument("--samples", type=int, default=24)
    ap.add_argument("--bake-samples", type=int, default=96)
    a = ap.parse_args()
    objs = build_all()
    if a.preview:
        os.makedirs(a.preview, exist_ok=True)
        stage_preview(a.samples, (1280, 720))
        shots = [("commuter_head", (16, -9, 2.2), (5, 0, 1.9), 35), ("commuter_side", (0, -11, 1.8), (0, 0, 1.9), 40),
                 ("commuter_pan", (4, 7.5 - 12 + 6 * 2, 4.5), (4, 12, 3.0), 30), ("commuter_low", (11.5, -3.2, 0.6), (6.5, 0, 0.8), 40),
                 ("waratah_head", (17, 18 - 9, 2.2), (6, 18, 2.2), 35), ("waratah_side", (0, 24 - 13, 2.0), (0, 24, 2.2), 40)]
        for name, loc, tgt, lens in shots:
            V.camera("Cam", loc, tgt, lens)
            V.render(os.path.join(a.preview, f"{name}.jpg"))
        return
    meshes = list(objs.values())
    V.bake_vertex_ao(meshes, 0.6, a.bake_samples)
    info = {"note": "The main-line cars the cities share, built by blender/build_railstock.py: per type a driving car (its cab at "
                    "+z; the game turns it about for the tail), a middle car and a motor car with its pantograph; web/game/trains.js "
                    "paints the materials Door, Band, Band2, Top and Face in each stock's colours.",
            "axes": "+z forward, +y up, +x left; origin on the rail head under the car's middle",
            "file": "railstock.glb", "lod1_m": 70, "models": {}}
    for name in list(objs):
        lo = V.lod_copy(objs[name], f"{name}_LOD1", 0.16)
        info["models"][name] = {"triangles": V.triangles([objs[name]]), "lod1_triangles": V.triangles([lo])}
        objs[f"{name}_LOD1"] = lo
    for ob in objs.values():
        ob.location = (0, 0, 0)
    path = os.path.join(OUT, "railstock.glb")
    V.select(list(objs.values()))
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_vertex_color="ACTIVE",
                              export_materials="EXPORT", export_cameras=False, export_lights=False, export_animations=False,
                              export_extras=False)
    V.compress(path)
    print(f"  {os.path.relpath(path, V.ROOT)}: {os.path.getsize(path) / 1e6:.2f} MB")
    with open(os.path.join(OUT, "railstock.json"), "w") as f:
        json.dump(info, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
