"""The trains the Japanese maps' games share: the Enoshima Electric Railway's (Enoden's) rolling stock,
modelled in Blender from code from published dimensions and photographs, with ambient occlusion baked
into the vertex colours, written as glTF binary for three.js (web/game/rail.js runs them).

    pip install bpy==5.2.3
    python blender/build_trains.py                # -> web/assets/vehicles/trains.glb, trains.json
    python blender/build_trains.py --preview dir  # quick renders instead

Every Enoden set is two bodies on three bogies, the middle one shared (an articulated set, 連接車). One
body is modelled per series, its cab ahead (+z in the model, +x here) and its articulated end behind;
the game stands a second one back to back with it to make the set, and couples two sets into the
four-car trains that run by day. A body's origin is on the rail head under its middle.

    Enoden_300    300 series, set 305 (305-355), 1960, the last of the series: 24.1 m over the set, 2.4 m
                  wide, roof 3.41 m; a body's side reads d1D5D3 from the cab (crew door, a window, a
                  single-leaf door 0.92 m wide, five windows 0.8 m wide, a door, three windows); a flat
                  face of three windows, the middle one wide; twin sealed-beam headlamps low on the face;
                  a diamond pantograph over each cab; pale green below and above a cream window band.
    Enoden_1000   1000 series (1001-1051), 1979: 25.4 m, 2.4 m wide, roof 3.4 m; d1D3D2 with plug doors
                  1.0 m wide and windows 1.05 m wide; a flat face of three panes behind which the
                  destination shows; a round headlamp and a square tail lamp at each lower corner; dark
                  green with a cream window band and a thin gold line.
    Enoden_500    500 series, second generation (501-551), 2006: 25.4 m, bodies 12.2 m, 2.5 m wide, roof
                  3.515 m; double-leaf doors; one large curved windscreen; a single-arm pantograph; a
                  skirt under the face; green and cream with a gold line.

Each has `<name>_LOD1`, a decimated copy for distance. Sources: the Japanese Wikipedia articles on each
series (which quote the railway's own tables: lengths, widths, heights, bogie centres 8.7 and 9.5 m,
wheelbases 1.65 and 1.6 m, wheels 860 mm, floors 1.1 and 1.07 m over the rail) and photographs on
Wikimedia Commons for the faces, the liveries and the roofs. What the tables do not give is read off
photographs and is approximate: the height of the window band, the post widths, the door heights, the
shape of the roof's ends, the underfloor boxes, the seats. No logo or lettering of the railway is
reproduced; a set carries its number only.
"""
import argparse
import json
import math
import os
import sys

import bpy
import bmesh
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_vehicles as V  # noqa: E402  (the shared mesh helpers, the bake and the export)
from build_vehicles import Mesh, T, box, cyl, tube, loft, cabin, rounded_rect, material, HALF  # noqa: E402

OUT = V.OUT
WHEEL_R = 0.43          # 860 mm wheels
GAUGE = 1.067

SERIES = {
    "Enoden_300": dict(number="305", set_m=24.1, width=2.4, roof=3.41, floor=1.10, bogies=8.7, wheelbase=1.65, corner=0.28,
                       body="#3f7a52", band="#efe3bf", upper="#3f7a52", roofc="#8b908c", line=None,
                       side=["d", "w", "D", "w", "w", "w", "w", "w", "D", "w", "w", "w"], win=0.80, door=0.92, crew=0.52, post=0.16,
                       sill=1.98, head=2.86, cant=3.02, face="three", lamps="twin_low", panto="diamond", skirt=False),
    "Enoden_1000": dict(number="1001", set_m=25.4, width=2.4, roof=3.40, floor=1.07, bogies=9.5, wheelbase=1.60, corner=0.14,
                        body="#1f5a3c", band="#f1e7c6", upper="#1f5a3c", roofc="#9a9d9a", line="#c9a84a",
                        side=["d", "w", "D", "w", "w", "w", "D", "w", "w"], win=1.05, door=1.00, crew=0.50, post=0.22,
                        sill=1.92, head=2.77, cant=3.0, face="panes", lamps="corner", panto="diamond", skirt=False),
    "Enoden_500": dict(number="501", set_m=25.4, width=2.5, roof=3.515, floor=1.07, bogies=9.5, wheelbase=1.65, corner=0.5,
                       body="#2a6a47", band="#f3ead0", upper="#2a6a47", roofc="#a4a8a6", line="#c9a84a",
                       side=["d", "w", "D", "w", "w", "w", "D", "w", "w"], win=1.0, door=1.30, crew=0.50, post=0.22,
                       sill=1.92, head=2.82, cant=3.08, face="screen", lamps="round_low", panto="single", skirt=True),
}


def materials(S, key):
    k = key.split("_")[1]
    material(f"Body_{k}", S["body"], rough=0.38, coat=0.4)
    material(f"Band_{k}", S["band"], rough=0.42, coat=0.3)
    material(f"Roof_{k}", S["roofc"], rough=0.75)
    if S["line"]:
        material(f"Line_{k}", S["line"], rough=0.35, metal=0.6)
    if "Glass" not in V.MAT:
        material("Glass", "#1c2a2c", rough=0.08, alpha=0.32, cull=False)
        material("Under", "#2b2b2a", rough=0.8)
        material("Steel", "#55585a", rough=0.5, metal=0.7)
        material("Tyre", "#8d8f8f", rough=0.35, metal=0.8)
        material("Lining", "#d9d6c8", rough=0.8)
        material("Floor", "#6f6a5f", rough=0.85)
        material("Seat", "#2f6a4d", rough=0.9)
        material("Rail", "#b9bcbd", rough=0.3, metal=0.8)
        material("Rubber", "#1b1b1b", rough=0.9)
        material("Board", "#f4f2ea", rough=0.6)
        material("Ink", "#1a1a1a", rough=0.6)
        material("Light_Head", "#fff3d2", rough=0.2, emit="#fff3d2")
        material("Light_Tail", "#c8201a", rough=0.3, emit="#7a0d0a")
        material("Light_Cabin", "#fff8e6", rough=0.5, emit="#fff1cf")
    return f"Body_{k}", f"Band_{k}", f"Roof_{k}", (f"Line_{k}" if S["line"] else None)


def side_layout(S, length):
    """The openings along one side from the cab's corner back, as (x0, x1, kind) in metres from the front of
    the side's straight run: the tokens' widths with equal posts between, the slack shared by both ends."""
    w = {"d": S["crew"], "w": S["win"], "D": S["door"]}
    need = sum(w[t] for t in S["side"]) + S["post"] * (len(S["side"]) - 1)
    post = S["post"]
    if need > length - 0.5:  # too tight for the published widths: narrower posts, then narrower windows
        post = max(0.07, (length - 0.5 - sum(w[t] for t in S["side"])) / (len(S["side"]) - 1))
        need = sum(w[t] for t in S["side"]) + post * (len(S["side"]) - 1)
        if need > length - 0.3:
            k = (length - 0.3 - post * (len(S["side"]) - 1) - sum(w[t] for t in S["side"] if t != "w")) / sum(w[t] for t in S["side"] if t == "w")
            w["w"] *= k
            need = length - 0.3
    x, out = (length - need) * 0.45, []
    for t in S["side"]:
        out.append((x, x + w[t], t))
        x += w[t] + post
    return out


def build_body(key):
    S = SERIES[key]
    body, band, roofm, line = materials(S, key)
    m, glass = Mesh(), Mesh()
    L, W, fl = S["set_m"] / 2 - 0.12, S["width"], S["floor"]
    hl, hw, rc = L / 2, W / 2, S["corner"]
    sill, head, cant, top = S["sill"], S["head"], S["cant"], S["roof"]
    sole = fl - 0.28                       # the bottom of the body's side
    outline = rounded_rect(hl, hw, rc, step=0.25)
    c = rc * HALF                          # arc length of a corner
    Ls, Wf = 2 * (hl - rc), 2 * (hw - rc)  # the straight runs of a side and of an end
    per = 4 * c + 2 * Ls + 2 * Wf
    u_left = lambda x: c + x               # x m back from the front of the left side
    u_right = lambda x: 3 * c + 2 * Ls + Wf - x
    u_front = lambda y: per - Wf / 2 + y   # y m to the left of the middle of the face (wraps past per)
    u_rear = lambda y: 2 * c + Ls + Wf / 2 - y
    lay = side_layout(S, Ls)
    S["_layout"] = lay

    # ---- the walls: below the sill, the window band, over the windows; the doors' leaves and the glass
    low, mid = [], []
    for x0, x1, t in lay:
        for u in (u_left, u_right):
            a, b = sorted((u(x0), u(x1)))
            if t == "w":
                mid.append((a, b, sill, head))
            elif t == "D":
                low.append((a, b, fl + 0.02, sill))
                mid.append((a, b, sill, head - 0.04))
            else:
                mid.append((a + 0.06, b - 0.06, sill + 0.05, head - 0.1))
    # the face
    if S["face"] == "three":
        for y0, y1 in ((-0.42, 0.42), (0.55, Wf / 2 - 0.02), (-Wf / 2 + 0.02, -0.55)):
            mid.append((u_front(y0) % per, u_front(y1) % per, sill + 0.02, head - 0.04))
    elif S["face"] == "panes":
        for y0, y1 in ((-0.55, 0.55), (0.63, Wf / 2 + c * 0.35), (-Wf / 2 - c * 0.35, -0.63)):
            mid.append((u_front(y0) % per, u_front(y1) % per, sill - 0.12, head + 0.02))
    else:  # one screen round the corners
        mid.append((u_front(-Wf / 2 - c * 0.75) % per, u_front(Wf / 2 + c * 0.75) % per, sill - 0.2, head + 0.02))
    # the gangway at the articulated end
    low.append((u_rear(0.4), u_rear(-0.4), fl + 0.02, sill))
    mid.append((u_rear(0.4), u_rear(-0.4), sill, head - 0.1))
    cabin(m, outline, sole, sill, low, body, "Lining", glass="Rubber", thick=0.06)
    cabin(glass, outline, sill, head, mid, band, "Lining", glass="Glass", thick=0.06)
    cabin(m, outline, head, cant, [], S["upper"] and body, "Lining", thick=0.06)
    # ---- door leaves: a leaf in each lower opening (the band's door glass is already there), a dark gangway
    for x0, x1, t in lay:
        if t != "D":
            continue
        for sy in (1, -1):
            xm = hl - rc - (x0 + x1) / 2
            leaves = 2 if S["door"] > 1.2 else 1
            for k in range(leaves):
                wl = (x1 - x0) / leaves
                xc = xm + (k - (leaves - 1) / 2) * wl
                box(m, body, (wl - 0.03, 0.035, sill - fl - 0.04), T((xc, sy * (hw - 0.035), (sill + fl) / 2)), bevel=0.008)
                box(m, "Rubber", (0.025, 0.05, head - fl - 0.1), T((xc - wl / 2 + 0.01, sy * (hw - 0.03), (head + fl) / 2)))
            box(m, "Steel", (x1 - x0 + 0.1, 0.05, 0.03), T((xm, sy * (hw - 0.02), fl + 0.0)))  # the step plate
    if key == "Enoden_300":  # its "bus windows": the upper third fixed in rubber, a bar across each
        for x0, x1, t in lay:
            if t == "w":
                for sy in (1, -1):
                    box(m, band, (x1 - x0, 0.03, 0.035), T((hl - rc - (x0 + x1) / 2, sy * (hw - 0.03), sill + (head - sill) * 0.64)))
    box(m, "Rubber", (0.3, 0.9, head - fl), T((-hl - 0.12, 0, (head + fl) / 2)), bevel=0.03)  # the bellows
    m.face([m.vert(p) for p in ((-hl + 0.03, -0.4, fl), (-hl + 0.03, 0.4, fl), (-hl + 0.03, 0.4, head - 0.1), (-hl + 0.03, -0.4, head - 0.1))], "Rubber", False)
    # a line along the sill, and the sole bar
    if line:
        for sy in (1, -1):
            box(m, line, (Ls, 0.012, 0.045), T((0, sy * (hw + 0.004), sill - 0.1)))
    for sy in (1, -1):
        box(m, "Under", (Ls + rc, 0.05, 0.14), T((0, sy * (hw - 0.03), sole - 0.06)))

    # ---- the roof: an arc from cant rail to cant rail, rounded down over the cab
    def section(x, k=1.0, drop=0.0):
        pts = []
        for i in range(13):
            a = -1 + 2 * i / 12
            y = a * (hw - 0.01) * k
            z = cant - drop + (top - cant) * (1 - abs(a) ** 2.4) * k
            pts.append((x, y, z))
        return pts + [(x, pts[-1][1], cant - 0.06 - drop), (x, pts[0][1], cant - 0.06 - drop)]
    nose = 0.9 if S["face"] != "panes" else 0.45
    secs = [section(-hl + 0.02), section(hl - nose)]
    for i in range(1, 6):
        t = i / 5
        secs.append(section(hl - nose + nose * math.sin(t * HALF) * 0.98, k=1 - 0.16 * t * t, drop=0.03 * t))
    loft(m, roofm, secs, caps=True, smooth=True)
    # the ceiling inside, and its lights
    box(m, "Lining", (L - 0.2, W - 0.14, 0.03), T((0, 0, cant - 0.08)))
    for sy in (0.45, -0.45):
        box(m, "Light_Cabin", (L - 3.2, 0.09, 0.02), T((-0.4, sy, cant - 0.1)))
    # on the roof: the air conditioner, its cover's louvres, and the pantograph over the cab end
    ac = (3.0, 1.5, 0.3) if key != "Enoden_500" else (3.6, 1.7, 0.32)
    acx = -1.4 if key != "Enoden_500" else 0.0
    box(m, roofm, ac, T((acx, 0, top + ac[2] / 2 - 0.03)), bevel=0.06)
    for i in range(6):
        box(m, "Under", (0.32, ac[1] * 0.8, 0.012), T((acx - ac[0] / 2 + 0.35 + i * (ac[0] - 0.7) / 5, 0, top + ac[2] - 0.02)))
    px, pz = hl - 2.9, top + 0.02
    for sy in (0.42, -0.42):
        box(m, "Under", (1.7, 0.07, 0.06), T((px, sy, pz + 0.03)))
        for sx in (-0.7, 0.7):
            cyl(m, "Board", 0.045, 0.1, T((px + sx, sy, pz + 0.1)), segs=8)
    wire = 4.9 - 0.02                    # the collector's height over the rail head (the game's contact wire)
    if S["panto"] == "diamond":
        for sy in (0.36, -0.36):
            for sx in (1, -1):
                tube(m, "Steel", [(px + sx * 0.75, sy, pz + 0.16), (px + sx * 0.05, sy * 0.85, pz + (wire - pz) * 0.52), (px + sx * 0.0, sy * 0.7, wire - 0.08)], 0.018, segs=6)
        tube(m, "Steel", [(px, -0.36, pz + (wire - pz) * 0.52), (px, 0.36, pz + (wire - pz) * 0.52)], 0.014, segs=6)
    else:
        tube(m, "Steel", [(px + 0.8, 0, pz + 0.16), (px - 0.35, 0, pz + (wire - pz) * 0.55), (px + 0.05, 0, wire - 0.08)], 0.024, segs=6)
        tube(m, "Steel", [(px + 0.55, 0.12, pz + 0.16), (px - 0.3, 0.05, pz + (wire - pz) * 0.5)], 0.012, segs=6)
    for dx in (-0.12, 0.12):
        tube(m, "Steel", [(px + dx, -0.62, wire - 0.1), (px + dx, -0.48, wire - 0.02), (px + dx, 0.48, wire - 0.02), (px + dx, 0.62, wire - 0.1)], 0.014, segs=6)

    # ---- the face: lamps, the number board, the wiper, the coupler, and a skirt on the newest
    xf = hl + 0.012
    if S["lamps"] == "twin_low":
        for sy in (0.72, -0.72):
            box(m, "Steel", (0.05, 0.42, 0.2), T((xf, sy, sill - 0.5)), bevel=0.02)
            for dy in (-0.09, 0.09):
                cyl(m, "Light_Head", 0.07, 0.04, T((xf + 0.03, sy + dy, sill - 0.5), rot=(0, HALF, 0)), segs=12)
            cyl(m, "Light_Tail", 0.055, 0.03, T((xf + 0.02, sy, sill - 0.74), rot=(0, HALF, 0)), segs=10)
    elif S["lamps"] == "corner":
        for sy in (0.82, -0.82):
            cyl(m, "Light_Head", 0.09, 0.04, T((xf + 0.02, sy, sill - 0.48), rot=(0, HALF, 0)), segs=14)
            box(m, "Light_Tail", (0.03, 0.14, 0.1), T((xf + 0.015, sy - math.copysign(0.2, sy), sill - 0.48)))
    else:
        for sy in (0.78, -0.78):
            cyl(m, "Light_Head", 0.085, 0.05, T((xf - 0.02, sy, sill - 0.52), rot=(0, HALF, 0)), segs=14)
            cyl(m, "Light_Tail", 0.05, 0.04, T((xf - 0.02, sy - math.copysign(0.2, sy), sill - 0.52), rot=(0, HALF, 0)), segs=10)
    bz = sill - 0.2 if S["face"] == "three" else sill - 0.42   # the number's board: under the middle window
    box(m, "Board", (0.02, 0.5, 0.17), T((xf, 0, bz)))
    V.text_mesh(m, S["number"], "Ink", 0.13, T((xf + 0.012, 0, bz), rot=(HALF, 0, HALF)))
    for sy in (1, -1):  # and on each side by the cab
        V.text_mesh(m, S["number"], "Ink" if S["band"] else body, 0.13, T((hl - rc - 0.9, sy * (hw + 0.006), sill - 0.32), rot=(HALF, 0, 0 if sy < 0 else math.pi)))
    tube(m, "Rubber", [(xf + 0.02, -0.3, sill + 0.04), (xf + 0.03, -0.12, sill + 0.4)], 0.007, segs=5)   # the wiper, parked low
    box(m, "Steel", (0.5, 0.28, 0.24), T((hl + 0.28, 0, 0.72)), bevel=0.03)   # the tight-lock coupler and its draft gear
    box(m, "Under", (0.5, 0.5, 0.2), T((hl - 0.1, 0, 0.74)))
    if S["skirt"]:
        loft(m, "Steel", [[(hl + 0.05, -hw + 0.1, 0.32), (hl + 0.05, hw - 0.1, 0.32), (hl + 0.05, hw - 0.1, sole), (hl + 0.05, -hw + 0.1, sole)],
                          [(hl - 0.5, -hw + 0.02, 0.32), (hl - 0.5, hw - 0.02, 0.32), (hl - 0.5, hw - 0.02, sole), (hl - 0.5, -hw + 0.02, sole)]], caps=True, smooth=False)
    else:
        tube(m, "Under", [(hl + 0.1, -0.85, 0.36), (hl + 0.2, 0, 0.3), (hl + 0.1, 0.85, 0.36)], 0.03, segs=6)  # the obstacle deflector

    # ---- under the floor: the frame, the boxes, and the bogies (this body's own, and its half of the shared one)
    box(m, "Under", (L - 0.1, W - 0.5, 0.2), T((0, 0, sole - 0.02)))
    for x, lx, ly in ((0.6, 1.8, 0.7), (-1.6, 1.4, 0.6), (-3.0, 0.9, 0.7)):
        for sy in (1, -1):
            box(m, "Under", (lx, ly * 0.55, 0.42), T((x, sy * (hw - 0.42), sole - 0.33)), bevel=0.02)

    def axle(x):
        cyl(m, "Steel", 0.07, GAUGE + 0.3, T((x, 0, WHEEL_R), rot=(HALF, 0, 0)), segs=8)
        for sy in (1, -1):
            cyl(m, "Tyre", WHEEL_R, 0.12, T((x, sy * (GAUGE / 2 + 0.03), WHEEL_R), rot=(HALF, 0, 0)), segs=20)
            cyl(m, "Under", 0.12, 0.2, T((x, sy * (GAUGE / 2 + 0.2), WHEEL_R), rot=(HALF, 0, 0)), segs=10)  # the axle box

    def bogie(xc, half=False):
        wb = S["wheelbase"]
        for x in ((xc + wb / 2,) if half else (xc - wb / 2, xc + wb / 2)):
            axle(x)
        x0, x1 = (xc, xc + wb / 2 + 0.45) if half else (xc - wb / 2 - 0.45, xc + wb / 2 + 0.45)
        for sy in (1, -1):
            box(m, "Under", (x1 - x0, 0.1, 0.2), T(((x0 + x1) / 2, sy * (GAUGE / 2 + 0.22), WHEEL_R + 0.12)), bevel=0.02)
            if not half:
                box(m, "Steel", (0.34, 0.16, 0.22), T((xc, sy * (GAUGE / 2 + 0.22), WHEEL_R + 0.3)))  # the bolster's spring
        if not half:
            box(m, "Under", (0.5, GAUGE + 0.5, 0.16), T((xc, 0, WHEEL_R + 0.22)))
    bogie(-hl - 0.06 + S["bogies"])
    bogie(-hl - 0.06, half=True)

    # ---- inside: the floor, the long seats under the windows between the doors, stanchions, the straps' rails,
    # the cab's partition with its windows (a passenger sees the line ahead through it), the driver's desk
    box(m, "Floor", (L - 0.14, W - 0.14, 0.04), T((0, 0, fl)))
    cabx = hl - 1.45
    spans, prev = [], None
    for x0, x1, t in lay:
        if t == "w":
            prev = [x0, x1] if prev is None else [prev[0], x1]
        else:
            if prev is not None:
                spans.append(prev)
            prev = None
    if prev is not None:
        spans.append(prev)
    for x0, x1 in spans:
        a, b = hl - rc - x1 - 0.04, min(cabx - 0.1, hl - rc - x0 + 0.04)
        if b - a < 0.6:
            continue
        for sy in (1, -1):
            box(m, "Seat", (b - a, 0.44, 0.1), T(((a + b) / 2, sy * (hw - 0.3), fl + 0.42)), bevel=0.03)
            box(m, "Seat", (b - a, 0.1, 0.42), T(((a + b) / 2, sy * (hw - 0.11), fl + 0.68)), bevel=0.03)
            box(m, "Lining", (b - a, 0.4, 0.38), T(((a + b) / 2, sy * (hw - 0.28), fl + 0.2)))
            for xe in (a, b):
                tube(m, "Rail", [(xe, sy * (hw - 0.5), fl + 0.05), (xe, sy * (hw - 0.5), cant - 0.1)], 0.016, segs=6, caps=False)
    for sy in (0.62, -0.62):
        tube(m, "Rail", [(-hl + 0.5, sy, cant - 0.22), (cabx - 0.2, sy, cant - 0.22)], 0.014, segs=6, caps=False)
        x = -hl + 0.9
        while x < cabx - 0.4:
            box(m, "Lining", (0.02, 0.02, 0.16), T((x, sy, cant - 0.3)))
            cyl(m, "Lining", 0.045, 0.014, T((x, sy, cant - 0.42), rot=(HALF, 0, 0)), segs=8)
            x += 0.32
    pw = W - 0.14
    # (left third: the driver's back, glazed from the sill; the middle: the cab's door, glazed lower; the right third)
    for y0, y1, zb in ((pw * 0.14, pw / 2, sill - 0.1), (-pw * 0.12, pw * 0.12, fl + 0.9), (-pw / 2, -pw * 0.14, sill - 0.1)):
        box(m, "Lining", (0.04, y1 - y0, zb - fl), T((cabx, (y0 + y1) / 2, (zb + fl) / 2)))
        glass.face([glass.vert(q) for q in ((cabx, y0 + 0.03, zb), (cabx, y1 - 0.03, zb), (cabx, y1 - 0.03, head - 0.05), (cabx, y0 + 0.03, head - 0.05))], "Glass", False)
    for y in (-pw / 2 + 0.02, -pw * 0.13, pw * 0.13, pw / 2 - 0.02):
        box(m, "Lining", (0.05, 0.05, cant - 0.08 - fl), T((cabx, y, (cant - 0.08 + fl) / 2)))
    box(m, "Lining", (0.05, pw, cant - 0.08 - head + 0.05), T((cabx, 0, (cant - 0.08 + head - 0.05) / 2)))
    box(m, "Under", (0.5, 0.9, 0.3), T((hl - 0.55, 0.55, sill - 0.42)), bevel=0.03)   # the driver's desk, on the left
    cyl(m, "Under", 0.07, 0.2, T((hl - 0.6, 0.72, sill - 0.2)), segs=8)                # the brake handle's stand
    box(m, "Seat", (0.4, 0.42, 0.08), T((hl - 1.05, 0.55, fl + 0.55)), bevel=0.02)
    m.merge(glass)
    return m, S


def build_trains():
    objs, info = {}, {"note": "The trains the Japanese maps share, built by blender/build_trains.py: one body of each two-car articulated set, its cab at +z; "
                              "web/game/rail.js stands two back to back as a set and couples sets into trains.",
                      "axes": "+z forward (the cab), +y up, +x left; origin on the rail head under the body's middle", "models": {}}
    for k, key in enumerate(SERIES):
        m, S = build_body(key)
        ob = m.build(key)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bm.to_mesh(ob.data)
        bm.free()
        ob.location = V.to_blender((0, k * 8.0 - 8, 0))
        objs[key] = ob
        hl, rc = (S["set_m"] / 2 - 0.12) / 2, S["corner"]
        wins = [hl - rc - (x0 + x1) / 2 for x0, x1, t in S["_layout"] if t == "w"]
        seat = min(wins, key=lambda x: abs(x + 0.5))
        info["models"][key] = {"number": S["number"], "seat_m": round(seat, 2), "set_m": S["set_m"], "body_m": round(S["set_m"] / 2 - 0.12, 2), "width_m": S["width"], "roof_m": S["roof"],
                               "floor_m": S["floor"], "bogie_centres_m": S["bogies"], "wheelbase_m": S["wheelbase"], "wheel_m": 2 * WHEEL_R,
                               "side": "".join(S["side"]), "livery": {"body": S["body"], "band": S["band"], "roof": S["roofc"], **({"line": S["line"]} if S["line"] else {})}}
    return objs, info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", help="render quick previews into this folder instead of exporting")
    ap.add_argument("--bake-samples", type=int, default=96)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    V.MAT.clear()
    objs, info = build_trains()
    if a.preview:
        os.makedirs(a.preview, exist_ok=True)
        V.setup_render(24, (1280, 720))
        V.ground_plane("Ground", 80, material("Ground", "#8a8a84", rough=0.9))
        V.sun_lamp(38, 140)
        for name, loc, tgt, lens in (("front34", (14, -17, 3.2), (0, -8, 1.8), 40), ("side", (0, -30, 2.4), (0, -8, 1.8), 55), ("row", (16, 6, 5), (0, 0, 1.6), 40),
                                     ("face", (11, -8, 2.2), (5, -8, 2.0), 50), ("inside", (2.5, -8.3, 2.5), (5.8, -8, 2.3), 18), ("rear", (-14, -17, 4), (0, -8, 1.8), 45)):
            V.camera("Cam", loc, tgt, lens)
            V.render(os.path.join(a.preview, f"trains_{name}.jpg"))
        return
    V.bake_vertex_ao(list(objs.values()), 0.8, a.bake_samples)
    for name in list(objs):
        lo = V.lod_copy(objs[name], f"{name}_LOD1", 0.14)
        info["models"][name].update({"triangles": V.triangles([objs[name]]), "lod1_triangles": V.triangles([lo])})
        objs[lo.name] = lo
    for ob in objs.values():
        ob.location = (0, 0, 0)
    path = os.path.join(OUT, "trains.glb")
    V.select(list(objs.values()))
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_vertex_color="ACTIVE", export_materials="EXPORT",
                              export_cameras=False, export_lights=False, export_animations=False)
    V.compress(path)
    print(f"  {os.path.relpath(path, V.ROOT)}: {os.path.getsize(path) / 1e6:.2f} MB")
    json.dump(info, open(os.path.join(OUT, "trains.json"), "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: {kk: v[kk] for kk in ("triangles", "lod1_triangles")} for k, v in info["models"].items()}))


if __name__ == "__main__":
    main()
