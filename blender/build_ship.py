"""The fiord's ship: a steel motor vessel in the style of a traditional New Zealand coastal trading scow,
modelled in Blender from code (headless, no hand modelling, no stock assets) on the helpers of
build_vehicles.py, with ambient occlusion baked in Cycles, written as glTF binary for three.js.

    pip install bpy==5.2.3
    python blender/build_ship.py                  # -> web/assets/vehicles/ship_scow.glb, ship_scow_far.glb, ship_scow.json
    python blender/build_ship.py --preview DIR    # quick Cycles previews into DIR instead of exporting
    python blender/build_ship.py --render         # also the two beauty shots -> docs/images/milford-sound/

The vessel is fictional and true to type: "PIOPIOTAHI" of Invercargill, 40.6 m overall with her bowsprit
(38 m on deck, 36 m on the waterline), 9.6 m in the beam at the deck (10 m over the rails), drawing 2.6 m. The type is the scow-styled overnight cruise vessel that
works Milford Sound: published figures for the 40 m class give a length of 37 to 40 m and a beam near
10 m, a steel hull built at Bluff in 2000 as a replica of a trading scow, about 60 berths, and a
staysail-schooner rig (vesselfinder.com and magicport.ai vessel records, the New Zealand Herald's launch
report, operators' own descriptions; searched 2026-11-09). The sources disagree on the length by a few
metres and none gives a deck plan, so the layout here is a naval architect's ordinary one for the type and
not a survey of any ship; no real ship's name or operator's livery is used.

What she carries: a full-bodied hull with a raked stem, flare forward and a raked transom; a dark navy
hull over red boot topping with a white waterline; bulwarks with a varnished cap rail, freeing ports and
a rubbing strake; a planked deck; a glazed saloon with side decks under the upper deck's overhang; a
wheelhouse with wrap-round windows, wipers and bridge wings; a lounge abaft it; an open after upper deck
with benches; twin exhaust stacks; three raked masts with shrouds (ratlines on the fore), stays, booms,
lowered gaffs and furled sails; a bowsprit with bobstay; a knuckle-boom deck crane and a tender in chocks
on the foredeck, kayaks racked on the lounge roof; windlass, anchors in their hawse pipes, bitts,
fairleads, tyre fenders, lifebuoys, liferaft canisters, portholes, draft marks, name boards on the bows
and the name and port on the transom, a radar scanner, searchlight, aerials, and the New Zealand ensign.

Model axes, as build_vehicles.py's: glTF +z forward (the bow), +y up, +x to port; the origin is on the
centreline at the waterline, amidships of the hull. Nodes: `Body` (hull and houses, AO baked), `Trim_Rig`
(wires, rails and small fittings), `Trim_Name` (lettering), `radar` (spins about its own +y), `flag`
(the ensign, a 16 x 8 grid with its origin at the hoist, to wave in a vertex shader), `light_port`,
`light_starboard`, `light_mast`, `light_stern` (small emissive lamps), and empties `Helm`, `Bow`,
`Stern`, `Stack_Port`, `Stack_Starboard`. Glass is the material `Window`; the cabins' ceiling lights are
`Light_Cabin` (emissive), so a viewer can light the windows at night.
"""
import argparse
import json
import math
import os
import random
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_vehicles as V  # noqa: E402
from build_vehicles import (Mesh, T, box, cyl, sphere, tube, loft, revolve, cabin, window_band, slab, railing,  # noqa: E402
                            rounded_rect, offset_outline, material, empty, text_mesh, TAU, HALF, ROOT)

OUT = os.path.join(ROOT, "web", "assets", "vehicles")
DOCS = os.path.join(ROOT, "docs", "images", "milford-sound")
NAME, PORT = "PIOPIOTAHI", "INVERCARGILL"

HL, HB, KEEL = 18.0, 4.8, -2.6          # half-length on the waterline datum, half-beam, keel (m)
D1 = 2.1                                # main deck amidships, above the waterline
D2 = 4.55                               # the saloon's top
U = D2 + 0.16                           # upper deck
WH_TOP = U + 2.55                       # wheelhouse roof (underside)
LG_TOP = U + 2.1                        # lounge roof (underside)
BULWARK = 1.0


# ------------------------------------------------------------ the hull's lines
def sheer(x):
    return D1 + 1.25 * max(0.0, (x - 6) / (HL - 6)) ** 2 + 0.35 * max(0.0, (-x - 12) / (HL - 12)) ** 2


def half_b(x):
    """Half-breadth at the sheer: a full entrance (a scow's bluff bow, eased to a stem), a long parallel
    body, the quarters drawn in a little to a wide transom."""
    t = x / HL
    if t > 0.38:
        q = min(1.0, (t - 0.38) / 0.62)
        return HB * max(0.03 / HB, (1 - q ** 2.3) ** 0.62)
    if t < -0.6:
        q = min(1.0, (-0.6 - t) / 0.4)
        return HB * (1 - 0.24 * q ** 2)
    return HB


def keel_at(x):
    t = x / HL
    return KEEL + 2.0 * max(0.0, (t - 0.78) / 0.22) ** 2 + 2.25 * max(0.0, (-t - 0.7) / 0.3) ** 1.5


def hull_pt(x, z):
    """A point on the port side of the hull's skin at station x and height z (z may run up the bulwark)."""
    t = x / HL
    b, sh, k = half_b(x), sheer(x), keel_at(x)
    fwd = max(0.0, (t - 0.38) / 0.62)
    fl = 1 - 0.30 * fwd                                   # the waterline is finer than the deck forward: flare
    if z < 0:
        q = min(1.0, -z / max(-k, 0.3))
        p = 2.9 - 1.5 * fwd                               # a round bilge amidships, a V forward
        w = b * fl * (1 - q ** p) ** (1 / p)
    elif z <= sh:
        w = b * (fl + (1 - fl) * (z / sh) ** 0.8)
    else:
        w = b * (1 + 0.035 * (z - sh)) + 0.01 * (z - sh)
    rake = 0.42 * max(0.0, (t - 0.55) / 0.45) ** 1.5      # the stem rakes forward
    aft = 0.22 * max(0.0, (-t - 0.8) / 0.2)               # the transom rakes aft
    return (x + rake * (z if z > 0 else 0.6 * z) - aft * max(0.0, z), w, z)


def side(x, z, sy=1, out=0.0):
    p = hull_pt(x, z)
    return (p[0], sy * (p[1] + out), p[2])


def side_angle(x, z):
    """The skin's heading in plan at (x, z) on the port side: the angle of its tangent from +x."""
    a, b = hull_pt(x - 0.3, z), hull_pt(x + 0.3, z)
    return math.atan2(b[1] - a[1], b[0] - a[0])


def ship_materials():
    material("Hull", "#111c31", 0.42, 0.0, coat=0.35)
    material("Hull_B", "#121e34", 0.45, 0.0, coat=0.3)        # alternate plates, a shade apart
    material("Boot", "#7a211c", 0.75)
    material("Band", "#e9e7e0", 0.5)
    material("Strake", "#101216", 0.7)
    material("Bulwark_In", "#e7e2d3", 0.55)
    material("Timber", "#8a5a2c", 0.38, coat=0.5)             # varnished cap rails, spars' bands, benches
    material("Deck_A", "#a98960", 0.8)
    material("Deck_B", "#9c7c55", 0.82)
    material("Deck_C", "#b3946c", 0.78)
    material("Cabin", "#f3f1ea", 0.45, coat=0.25)
    material("Trim", "#f6f4ee", 0.45)
    material("Deck_Steel", "#5f6a6a", 0.8)                     # painted steel decks: the roofs
    material("Interior", "#4a443c", 0.85, cull=False)
    material("Window", "#1b2830", 0.05, 0.0, alpha=0.55)
    material("Window_Far", "#2a3a44", 0.1)                    # the far model's glazing: a dark band, opaque
    material("Mast", "#d8c59a", 0.5, coat=0.2)                 # buff spars
    material("Sail", "#e6dcc6", 0.9)
    material("Sail_Tie", "#1c2a45", 0.8)
    material("Wire", "#2a2e33", 0.4, 0.7)
    material("Rail", "#e9e7e1", 0.3, 0.6)
    material("Metal_Dark", "#2a2e33", 0.42, 0.7)
    material("Machinery", "#44524f", 0.6, 0.2)
    material("Stack", "#16233a", 0.45, coat=0.3)
    material("Stack_Top", "#131313", 0.7)
    material("Crane", "#e8b020", 0.5, coat=0.2)
    material("Rust", "#3e2b27", 0.9)
    material("Rust_Light", "#1c2334", 0.8)                     # the faint end of a streak on the navy
    material("Brass", "#8f7238", 0.35, 0.8)
    material("Fender", "#141516", 0.85)
    material("Rope", "#b9a57c", 0.95)
    material("Buoy", "#f2601e", 0.5)
    material("Raft", "#f1f1ee", 0.5)
    material("Rib", "#8b9399", 0.7)
    material("Kayak_A", "#d8352a", 0.4, coat=0.3)
    material("Kayak_B", "#f0b51d", 0.4, coat=0.3)
    material("Kayak_C", "#2f8f5b", 0.4, coat=0.3)
    material("Seat", "#2f4f6b", 0.7)
    material("Lettering", "#f4f2ea", 0.5)
    material("Name_Board", "#101a2c", 0.5, coat=0.3)
    material("Light_Cabin", "#f3eadc", 0.4, emit="#ffe2b3")
    material("Light_Red", "#b3121a", 0.2, emit="#ff2a2a")
    material("Light_Green", "#0f8a3a", 0.2, emit="#2aff6a")
    material("Light_White", "#d8dde0", 0.15, emit="#ffffff")
    material("Lens", "#cfd8dc", 0.1, 0.0)


def flag_material():
    """The New Zealand ensign as a small texture: the Union Flag in the canton, the Southern Cross's
    four red stars edged white on the blue fly."""
    from PIL import Image, ImageDraw
    W, H = 512, 256
    blue, red, white = (1, 33, 105), (200, 16, 46), (255, 255, 255)
    im = Image.new("RGB", (W, H), blue)
    d = ImageDraw.Draw(im)
    cw, ch = W // 2, H // 2
    d.line([(0, 0), (cw, ch)], fill=white, width=26)
    d.line([(0, ch), (cw, 0)], fill=white, width=26)
    d.line([(0, 0), (cw, ch)], fill=red, width=9)
    d.line([(0, ch), (cw, 0)], fill=red, width=9)
    d.rectangle([cw // 2 - 21, 0, cw // 2 + 21, ch], fill=white)
    d.rectangle([0, ch // 2 - 21, cw, ch // 2 + 21], fill=white)
    d.rectangle([cw // 2 - 13, 0, cw // 2 + 13, ch], fill=red)
    d.rectangle([0, ch // 2 - 13, cw, ch // 2 + 13], fill=red)
    d.rectangle([cw, 0, W, H], fill=blue)
    d.rectangle([0, ch, W, H], fill=blue)

    def star(cx, cy, r, col):
        pts = []
        for k in range(10):
            a = -math.pi / 2 + k * math.pi / 5
            rr = r if k % 2 == 0 else r * 0.42
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        d.polygon(pts, fill=col)
    for cx, cy, r in ((384, 44, 17), (438, 104, 15), (332, 116, 17), (384, 206, 19)):
        star(cx, cy, r + 5, white)
        star(cx, cy, r, red)
    path = os.path.join(tempfile.gettempdir(), "ensign_nz.png")
    im.save(path)
    img = bpy.data.images.load(path)
    img.pack()
    m = material("Flag", "#ffffff", 0.85, cull=False)
    nt = m.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    return m


def torus(mesh, mat, R, r, centre, axis, segs=16, rsegs=8):
    revolve(mesh, mat, [(R + r * math.cos(t), r * math.sin(t)) for t in np.linspace(0, TAU, rsegs, endpoint=False)][::-1],
            centre, axis, segs=segs)


def frame_at(x, z, sy, out=0.0):
    """A transform whose local x runs aft-to-forward along the hull's skin at (x, z), local z up and local
    y out of the hull, on the side sy (+1 port, -1 starboard)."""
    a = side_angle(x, z) * sy
    p = side(x, z, sy, out)
    return Matrix.Translation(p) @ Matrix.Rotation(a, 4, "Z") @ Matrix.Diagonal((1, sy, 1, 1))


def build(far=False):
    """The ship as objects and the sidecar's facts. `far`: the distant model, the same lines with the
    small things left off."""
    ship_materials()
    flag_material()
    rnd = random.Random(7)
    body, rig, name = Mesh(), Mesh(), Mesh()
    fine = not far
    if far:
        rig = body

    # ---- the hull: sections from the transom to the stem, rows from the keel to the sheer
    if far:
        xs = list(np.concatenate([np.linspace(-HL, -HL + 5, 4), np.linspace(-HL + 7, 6, 5), np.linspace(8, HL, 9)]))
        zr = [None, -1.6, -0.6, 0.22, 0.34, 1.1, None]
    else:
        xs = list(np.concatenate([np.linspace(-HL, -HL + 5, 12), np.linspace(-HL + 5.5, 6.5, 30), np.linspace(7, HL - 3, 22), np.linspace(HL - 2.8, HL, 14)]))
        zr = [None, -2.2, -1.8, -1.4, -1.0, -0.6, -0.3, 0.0, 0.22, 0.34, 0.7, 1.0, 1.35, 1.7, None]

    def section(x):
        k, sh = keel_at(x), sheer(x)
        out = []
        for i, z in enumerate(zr):
            z = k if i == 0 else sh if z is None else min(max(z, k + 0.02 * i), sh - 0.02 * (len(zr) - i))
            out.append(hull_pt(x, z))
        return out
    secs = [section(x) for x in xs]

    def skin(z, i, r):
        if z < 0.22:
            return "Boot"
        if z < 0.34:
            return "Band"
        return "Hull" if far or (int((xs[i] + 40) // 2.9) + r) % 2 == 0 else "Hull_B"
    for sy in (1, -1):
        ids = [[body.vert((p[0], sy * p[1], p[2])) for p in s] for s in secs]
        for i in range(len(secs) - 1):
            for r in range(len(zr) - 1):
                f = [ids[i][r], ids[i + 1][r], ids[i + 1][r + 1], ids[i][r + 1]]
                body.face(f if sy > 0 else f[::-1], skin((secs[i][r][2] + secs[i][r + 1][2]) / 2, i, r), True)
    for i in range(len(secs) - 1):                     # the keel plate
        a, b = secs[i], secs[i + 1]
        kq = [body.vert((a[0][0], a[0][1], a[0][2])), body.vert((a[0][0], -a[0][1], a[0][2])), body.vert((b[0][0], -b[0][1], b[0][2])), body.vert((b[0][0], b[0][1], b[0][2]))]
        body.face(kq[::-1], "Boot", False)
    # the transom: boot, band and navy by rows
    s0 = secs[0]
    for r in range(len(zr) - 1):
        a, b = s0[r], s0[r + 1]
        q = [body.vert((a[0], a[1], a[2])), body.vert((b[0], b[1], b[2])), body.vert((b[0], -b[1], b[2])), body.vert((a[0], -a[1], a[2]))]
        body.face(q, skin((a[2] + b[2]) / 2, 0, 0), False)

    # ---- the planked deck: strips fore and aft, a plank each, in three tones
    plank = 0.16 if fine else 2 * HB
    ny = int(math.ceil(2 * HB / plank))
    for j in range(ny):
        y0, y1 = -HB + j * plank, min(HB, -HB + (j + 1) * plank)
        mat = "Deck_A" if far else rnd.choice(("Deck_A", "Deck_A", "Deck_B", "Deck_C"))
        prev = None
        for x in xs:
            px, w, z = hull_pt(x, sheer(x))
            w -= 0.03
            a, b = max(y0, -w), min(y1, w)
            cur = (body.vert((px, a, z)), body.vert((px, b, z))) if b > a + 1e-4 else None
            if prev and cur:
                body.face([prev[0], cur[0], cur[1], prev[1]], mat, False)
            prev = cur

    # ---- bulwarks all round with a varnished cap, the rubbing strake, freeing ports with their rust
    def run(z_of, out=0.0, sy=1, x0=-HL, x1=HL):
        return [side(x, z_of(x), sy, out) for x in xs if x0 - 1e-6 <= x <= x1 + 1e-6]
    for sy in (1, -1):
        lo, hi = run(sheer, 0, sy), run(lambda x: sheer(x) + BULWARK, 0, sy)
        ilo, ihi = run(sheer, -0.07, sy), run(lambda x: sheer(x) + BULWARK, -0.07, sy)
        a, b = [body.vert(p) for p in lo], [body.vert(p) for p in hi]
        c, d = [body.vert(p) for p in ilo], [body.vert(p) for p in ihi]
        for i in range(len(lo) - 1):
            f = [a[i], a[i + 1], b[i + 1], b[i]]
            body.face(f if sy > 0 else f[::-1], "Hull" if far or int((xs[i] + 40) // 2.9) % 2 else "Hull_B", True)
            g = [c[i + 1], c[i], d[i], d[i + 1]]
            body.face(g if sy > 0 else g[::-1], "Bulwark_In", True)
        tube(body, "Timber", [(p[0], p[1] - sy * 0.035, p[2] + 0.03) for p in hi], 0.075, segs=6 if fine else 4)
        tube(body, "Strake", run(lambda x: sheer(x) - 0.08, 0.02, sy), 0.09, segs=6 if fine else 4)
        if fine:
            tube(body, "Strake", run(lambda x: 1.05, 0.015, sy, -HL + 1.5, HL - 4.5), 0.05, segs=5)
    # the transom's bulwark and cap
    tl, tr = side(-HL, sheer(-HL), 1), side(-HL, sheer(-HL), -1)
    th, thr = side(-HL, sheer(-HL) + BULWARK, 1), side(-HL, sheer(-HL) + BULWARK, -1)
    body.face([body.vert(tl), body.vert(th), body.vert(thr), body.vert(tr)], "Hull", False)
    body.face([body.vert((tl[0] + 0.07, tl[1], tl[2])), body.vert((tr[0] + 0.07, tr[1], tr[2])), body.vert((thr[0] + 0.07, thr[1], thr[2])), body.vert((th[0] + 0.07, th[1], th[2]))], "Bulwark_In", False)
    tube(body, "Timber", [(th[0] + 0.03, th[1], th[2] + 0.03), (thr[0] + 0.03, thr[1], thr[2] + 0.03)], 0.075, segs=6)
    if fine:
        for sy in (1, -1):
            for x in np.arange(-15.0, 13.5, 3.1):
                M = frame_at(x, sheer(x) + 0.09, sy, 0.012)
                box(body, "Metal_Dark", (0.55, 0.02, 0.13), M)
                # a rust streak below each freeing port, fading down the plating
                L = 0.55 + 0.5 * rnd.random()
                for k, (w0, mat) in enumerate(((0.045, "Rust"), (0.13, "Rust_Light"))):
                    M2 = frame_at(x + 0.12 * (rnd.random() - 0.5), sheer(x) - 0.22 - L * (0.25 if k == 0 else 0.5), sy, 0.006 + 0.002 * (1 - k))
                    box(body, mat, (w0, 0.004, L * (0.5 if k == 0 else 1.0)), M2)
        # portholes along the lower deck, brass-rimmed
        for x in np.arange(-13.5, 9.5, 2.3):
            for sy in (1, -1):
                M = frame_at(x, 1.38, sy, 0.012) @ T((0, 0, 0), (HALF, 0, 0))
                cyl(body, "Brass", 0.165, 0.03, M, segs=14)
                cyl(body, "Window", 0.125, 0.045, M, segs=14)
        # draft marks at the stem and the stern post, and the load line amidships
        for sy in (1, -1):
            for x in (HL - 1.6, -HL + 1.2):
                for k in range(6):
                    box(body, "Lettering", (0.16, 0.006, 0.05), frame_at(x, 0.3 + 0.2 * k, sy, 0.01))
                    box(body, "Lettering", (0.05, 0.006, 0.1), frame_at(x - 0.11, 0.3 + 0.2 * k, sy, 0.01))
            torus(body, "Lettering", 0.15, 0.012, side(0.0, 0.75, sy, 0.012), (0, 1, 0), segs=16, rsegs=4)
            box(body, "Lettering", (0.42, 0.006, 0.025), frame_at(0.0, 0.75, sy, 0.012))

    # ---- the houses
    def shifted(o, dx):
        return [(x + dx, y) for x, y in o]

    def per_of(o):
        return sum(math.dist(o[i], o[(i + 1) % len(o)]) for i in range(len(o)))

    def house(outline_args, dx, z0, z1, zb, zt, pane, post, wall="Cabin"):
        if far:
            o = shifted(rounded_rect(*outline_args, step=3.0), dx)
            slab(body, o, z0, z1, wall, wall, wall)
            slab(body, offset_outline(o, 0.03), zb, zt, "Window_Far", "Window_Far", "Window_Far")
            return o
        o = shifted(rounded_rect(*outline_args), dx)
        cabin(body, o, z0, z1, window_band(per_of(o), zb, zt, pane=pane, post=post), wall, "Interior")
        return o

    # the saloon on the main deck, side decks outboard of it
    house((10.0, HB - 1.25, 1.0), -3.75, D1, D2, D1 + 0.95, D2 - 0.5, 1.25, 0.32)
    up = shifted(rounded_rect(11.2, HB - 0.12, 1.3, step=0.6 if fine else 3.0), -4.3)
    slab(body, up, D2, U, "Deck_Steel", "Trim", "Cabin")
    if fine:
        # the upper deck is planked too: strips laid over the steel
        for j in range(int(2 * (HB - 0.3) / 0.16)):
            y0 = -(HB - 0.3) + j * 0.16
            x0, x1 = -15.2, 6.5
            inset = max(0.0, abs(y0 + 0.08) - (HB - 1.5))      # the rounded corners
            body_m = rnd.choice(("Deck_A", "Deck_B", "Deck_C", "Deck_A"))
            q = [body.vert((x0 + inset, y0, U + 0.012)), body.vert((x1 - inset, y0, U + 0.012)), body.vert((x1 - inset, y0 + 0.16, U + 0.012)), body.vert((x0 + inset, y0 + 0.16, U + 0.012))]
            body.face(q, body_m, False)
        for x in np.arange(-15.0, 6.6, 2.35):                   # stanchions under the overhang
            for sy in (1, -1):
                cyl(body, "Cabin", 0.055, D2 - D1, T((x, sy * (HB - 0.42), (D1 + D2) / 2)), segs=8)
        for y in (-1.6, 1.6):                                   # the saloon's ceiling lights
            box(body, "Light_Cabin", (17.5, 0.2, 0.03), T((-3.75, y, D2 - 0.05)))
        # doors in the saloon's sides and its after end
        for sy in (1, -1):
            for x in (-11.0, 3.2):
                box(body, "Timber", (0.85, 0.05, 1.95), T((x, sy * (HB - 1.25 + 0.02), D1 + 1.0)))
                box(body, "Window", (0.45, 0.06, 0.55), T((x, sy * (HB - 1.25 + 0.025), D1 + 1.45)))
                sphere(body, "Brass", 0.035, T((x + 0.3, sy * (HB - 1.25 + 0.06), D1 + 1.0)), segs=6, rings=4)
    # the wheelhouse forward on the upper deck: wrap-round windows, a roof with a visor, bridge wings
    house((2.6, 3.0, 0.55), 3.6, U, WH_TOP, U + 1.05, U + 2.2, 0.82, 0.13)
    slab(body, shifted(rounded_rect(3.0, 3.35, 0.7, step=0.4 if fine else 3.0), 3.75), WH_TOP, WH_TOP + 0.14, "Deck_Steel", "Trim", "Cabin")
    # the lounge abaft it
    house((4.4, 2.5, 0.5), -3.5, U, LG_TOP, U + 0.95, U + 1.8, 1.05, 0.25)
    slab(body, shifted(rounded_rect(4.65, 2.75, 0.6, step=0.4 if fine else 3.0), -3.5), LG_TOP, LG_TOP + 0.12, "Deck_Steel", "Trim", "Cabin")
    if fine:
        box(body, "Light_Cabin", (3.6, 0.2, 0.03), T((3.6, 0, WH_TOP - 0.05)))
        box(body, "Light_Cabin", (7.5, 0.2, 0.03), T((-3.5, 0, LG_TOP - 0.05)))
        # wipers on the wheelhouse's forward panes, and its doors to the wings
        for y in (-1.9, -0.95, 0.0, 0.95, 1.9):
            box(rig, "Metal_Dark", (0.02, 0.03, 0.62), T((6.235, y + 0.12, U + 1.5), (0.5, 0, 0)))
            box(rig, "Metal_Dark", (0.04, 0.08, 0.05), T((6.23, y, U + 1.14)))
        for sy in (1, -1):
            box(body, "Timber", (0.75, 0.05, 1.9), T((2.0, sy * 3.02, U + 0.98)))
            box(body, "Window", (0.42, 0.06, 0.6), T((2.0, sy * 3.025, U + 1.5)))
            # the wing's dodger: a solid screen at the deck's edge by the wheelhouse
            box(body, "Cabin", (2.6, 0.05, 1.05), T((4.4, sy * (HB - 0.2), U + 0.53)))
            box(body, "Timber", (2.7, 0.12, 0.05), T((4.4, sy * (HB - 0.2), U + 1.08)))
        # the helm: console, wheel and the master's chair, seen through the glass
        box(body, "Interior", (0.7, 4.4, 1.0), T((5.4, 0, U + 0.5)))
        torus(body, "Timber", 0.36, 0.03, (4.95, 0, U + 1.12), (1, 0, 0), segs=16, rsegs=6)
        box(body, "Seat", (0.55, 0.55, 0.12), T((4.2, 0, U + 0.8)))
        box(body, "Seat", (0.1, 0.55, 0.7), T((3.95, 0, U + 1.15)))
        cyl(body, "Metal_Dark", 0.05, 0.75, T((4.2, 0, U + 0.38)), segs=8)
        # the saloon's tables and seats, shapes behind the windows
        for x in np.arange(-11.5, 4.5, 2.6):
            for sy in (1, -1):
                box(body, "Timber", (1.3, 0.8, 0.06), T((x, sy * 2.35, D1 + 0.76)))
                box(body, "Seat", (0.5, 1.6, 0.85), T((x + 1.0, sy * 2.35, D1 + 0.43)))
                box(body, "Seat", (0.5, 1.6, 0.85), T((x - 1.0, sy * 2.35, D1 + 0.43)))
    # rails round the upper deck (open aft and along the sides), and the roofs' low rails
    if fine:
        ro = offset_outline(up, -0.1)
        keep = [p for p in ro if p[0] < 3.05]                 # the dodgers take over by the wheelhouse
        keep.sort(key=lambda p: (math.atan2(p[1], p[0] + 4.3)) % TAU)
        railing(rig, keep, U, h=1.08, spacing=1.2, closed=False)
        railing(rig, [p for p in offset_outline(shifted(rounded_rect(4.65, 2.75, 0.6, step=0.6), -3.5), -0.08)], LG_TOP + 0.12, h=0.55, spacing=1.5)
        fr = [(5.75, -3.25), (6.6, -2.6), (6.72, 0.0), (6.6, 2.6), (5.75, 3.25)]
        railing(rig, fr, WH_TOP + 0.14, h=0.5, spacing=1.3, closed=False)
        # benches on the open after deck, slatted, back to back on the centreline and along the rails
        for x in np.arange(-14.6, -8.6, 1.9):
            for sy, yy in ((1, 0.33), (-1, -0.33), (1, HB - 0.75), (-1, -(HB - 0.75))):
                if (abs(yy) > 1 and x > -11.5) or (abs(yy) < 1 and abs(x + 11.2) < 1.1):
                    continue                                   # the liferafts' place, and the mizzen's
                inward = -sy if abs(yy) > 1 else sy
                for k in range(3):
                    box(body, "Timber", (1.6, 0.11, 0.04), T((x, yy + inward * (0.12 + 0.14 * k) * (1 if abs(yy) > 1 else 1), U + 0.46)))
                box(body, "Timber", (1.6, 0.05, 0.34), T((x, yy - inward * 0.02, U + 0.72), (inward * -0.12, 0, 0)))
                for dx in (-0.7, 0.7):
                    box(body, "Metal_Dark", (0.05, 0.45, 0.44), T((x + dx, yy + inward * 0.22, U + 0.22)))
        # the companion ladder from the after upper deck down to the main deck, on the port quarter
        for k in range(11):
            box(body, "Timber", (0.26, 0.8, 0.04), T((-15.75 - 0.2 * k, 3.2, U - 0.1 - 0.215 * k)))
        for dy in (-0.42, 0.42):
            box(body, "Trim", (2.9, 0.05, 0.2), T((-16.8, 3.2 + dy, U - 1.25), (0, -0.82, 0)))
            tube(rig, "Rail", [(-15.6, 3.2 + dy, U + 0.95), (-17.9, 3.2 + dy, D1 + 0.95)], 0.025, segs=6)

    # ---- twin exhaust stacks abaft the lounge roof's middle, clear of the main boom
    stacks = {}
    for sy, nm in ((1, "Stack_Port"), (-1, "Stack_Starboard")):
        sx, syy, z0, z1 = -6.3, sy * 1.75, LG_TOP + 0.12, LG_TOP + 1.75
        n = 14 if fine else 8
        secs_s = []
        for k in range(5):
            z = z0 + (z1 - z0) * k / 4
            secs_s.append([(sx - 0.1 * (z - z0) + 0.5 * math.cos(a), syy + 0.3 * math.sin(a), z) for a in np.linspace(0, TAU, n, endpoint=False)])
        loft(body, "Stack", secs_s[:4], caps=False)
        loft(body, "Band", secs_s[3:], caps=True, cap_mat="Stack_Top")
        for dx in (-0.16, 0.16):
            tube(body, "Stack_Top", [(sx - 0.17 + dx, syy, z1 - 0.1), (sx - 0.25 + dx, syy, z1 + 0.3), (sx - 0.5 + dx, syy, z1 + 0.5)], 0.075, segs=8 if fine else 5)
        stacks[nm] = (sx - 0.5, syy, z1 + 0.5)

    # ---- masts, spars, sails and standing rigging
    wire_segs = 4
    def mast(x, z0, top, r0, boom_len, boom_h, chain_y, chain_z, ratlines=False):
        rake = math.tan(math.radians(3.0))
        def at(z):
            return (x - (z - z0) * rake, 0.0, z)
        tube(body, "Mast", [at(z0), at(z0 + (top - z0) * 0.5), at(top - 1.5)], lambda t: r0 * (1 - 0.3 * t), segs=12 if fine else 6)
        tube(body, "Trim", [at(top - 1.5), at(top)], lambda t: r0 * (0.7 - 0.3 * t), segs=10 if fine else 5)   # the white masthead
        hounds = z0 + (top - z0) * 0.8
        if fine:
            sphere(body, "Brass", r0 * 0.5, T(at(top + 0.03)), segs=8, rings=5)                         # the truck
            cyl(body, "Timber", r0 * 1.25, 0.25, T(at(hounds)), segs=12)                                 # the hounds' band
            cyl(body, "Timber", r0 * 1.3, 0.3, T(at(z0 + boom_h)), segs=12)
            # crosstrees
            cz = z0 + (top - z0) * 0.62
            box(body, "Mast", (0.09, 2.6, 0.07), T(at(cz)))
        # boom, lowered gaff and the furled sail between them
        g = at(z0 + boom_h)
        b0, b1 = (g[0] - r0 - 0.05, 0, g[2]), (g[0] - r0 - boom_len, 0, g[2] + 0.06 * boom_len)
        tube(body, "Mast", [b0, b1], 0.11, segs=10 if fine else 5)
        if fine:
            n = 26
            pts = [(b0[0] + (b1[0] - b0[0]) * (0.03 + 0.9 * k / n), 0, b0[2] + (b1[2] - b0[2]) * (0.03 + 0.9 * k / n) + 0.27) for k in range(n + 1)]
            ph = rnd.random() * 6

            def sail_r(t):      # a harbour stow: fullest at the mast, tapering aft, creased where the gaskets bind it
                env = min(1.0, t / 0.06) ** 0.5 * min(1.0, (1 - t) / 0.1) ** 0.5
                return max(0.05, (0.2 - 0.06 * t + 0.012 * math.sin(31 * t + ph) - 0.022 * math.cos(TAU * 6 * t) ** 8) * env)
            tube(body, "Sail", pts, sail_r, segs=12)
            for k in range(6):
                t = (k + 0.5) / 6 if k else 0.09
                q = pts[min(n, int(round(t * n)))]
                torus(body, "Sail_Tie", sail_r(min(n, int(round(t * n))) / n) + 0.004, 0.014, (q[0], 0, q[2]), (1, 0, 0), segs=12, rsegs=4)
            g0 = (b0[0] - 0.1, 0, b0[2] + 0.52)
            g1 = (b0[0] - boom_len * 0.78, 0, b1[2] + 0.4)
            tube(body, "Mast", [g0, g1], 0.075, segs=8)                                                 # the gaff, lowered on the sail
            tube(rig, "Wire", [b1, at(top - 0.4)], 0.012, segs=wire_segs, caps=False)                   # topping lift
            tube(rig, "Wire", [g1, at(hounds + 0.6)], 0.01, segs=wire_segs, caps=False)                 # peak halyard
            tube(rig, "Rope", [(b1[0] + 0.3, 0, b1[2] - 0.12), (b1[0] + 0.8, 0, z0 + 0.3)], 0.02, segs=5)   # the sheet to its horse
            # shrouds: three a side from the hounds to the chainplates, deadeyes and lanyards at their feet
            for sy in (1, -1):
                feet = []
                for dx in (0.75, -0.15, -1.05):
                    fx = x + dx
                    f = (fx, sy * chain_y(fx), chain_z(fx) if callable(chain_z) else chain_z)
                    feet.append(f)
                    tube(rig, "Wire", [at(hounds), (f[0], f[1], f[2] + 0.55)], 0.014, segs=wire_segs, caps=False)
                    tube(rig, "Rope", [(f[0], f[1], f[2] + 0.55), f], 0.03, segs=5)
                    for dz in (0.5, 0.18):
                        cyl(rig, "Metal_Dark", 0.07, 0.05, T((f[0], f[1], f[2] + dz), (HALF, 0, 0)), segs=8)
                # a cap shroud over the crosstree to the masthead
                cz = z0 + (top - z0) * 0.62
                tip = (at(cz)[0], sy * 1.3, cz)
                tube(rig, "Wire", [at(top - 0.3), tip, (feet[1][0], feet[1][1] * 0.97, feet[1][2] + 0.6)], 0.01, segs=wire_segs, caps=False)
                if ratlines:
                    h = at(hounds)
                    n_r = int((hounds - feet[0][2] - 1.2) / 0.4)
                    for k in range(n_r):
                        t = (0.9 + 0.4 * k) / (hounds - feet[0][2])
                        pts = [tuple(np.array(f) + (np.array(h) - np.array(f)) * t + np.array((0, 0, 0.55 * (1 - t)))) for f in feet]
                        tube(rig, "Rope", pts, 0.011, segs=3, caps=False, smooth=False)
        return at

    # (the fore shrouds come down to the bulwark's cap; the main and mizzen to the upper deck's edge)
    fore = mast(12.0, sheer(12.0), 19.6, 0.2, 4.6, 3.3, lambda fx: hull_pt(fx, sheer(fx) + BULWARK)[1] - 0.06, lambda fx: sheer(fx) + BULWARK + 0.05, ratlines=True)
    main = mast(0.15, U, 22.0, 0.22, 6.0, LG_TOP - U + 1.95, lambda fx: HB - 0.22, U + 0.05)
    mizz = mast(-11.2, U, 17.6, 0.18, 5.6, 2.75, lambda fx: HB - 0.22, U + 0.05)
    # the bowsprit, with a bobstay to the stem and whisker stays to the bows
    stem = side(HL, sheer(HL) + BULWARK, 1)
    sp0, sp1 = (stem[0] - 1.6, 0, stem[2] - 0.1), (stem[0] + 2.0, 0, stem[2] + 0.45)
    tube(body, "Mast", [sp0, sp1], lambda t: 0.15 - 0.05 * t, segs=10 if fine else 5)
    bow_x = sp1[0]
    if fine:
        cut = hull_pt(HL, 0.25)
        tube(rig, "Wire", [(sp1[0] - 0.15, 0, sp1[2] - 0.08), (cut[0] + 0.02, 0, 0.25)], 0.018, segs=wire_segs, caps=False)
        for sy in (1, -1):
            w = side(HL - 3.0, sheer(HL - 3.0) + 0.5, sy, 0.02)
            tube(rig, "Wire", [(sp1[0] - 0.15, 0, sp1[2]), w], 0.012, segs=wire_segs, caps=False)
        # the stays: jib stay and fore stay (each with a furled headsail), triatics between the mastheads, backstays
        jib0, jib1 = (sp1[0] - 0.2, 0, sp1[2] + 0.05), fore(19.6 - 0.5)
        stay0, stay1 = (stem[0] - 0.25, 0, stem[2] + 0.1), fore(sheer(12.0) + (19.6 - sheer(12.0)) * 0.8)
        for a, b, rr in ((jib0, jib1, 0.085), (stay0, stay1, 0.095)):
            tube(rig, "Wire", [a, b], 0.014, segs=wire_segs, caps=False)
            va, vb = Vector(a), Vector(b)
            pts = [tuple(va.lerp(vb, 0.06 + 0.62 * k / 12)) for k in range(13)]
            tube(body, "Sail", pts, lambda t: rr * (1.0 - 0.75 * t) + 0.012 * math.sin(23 * t), segs=7)
        tube(rig, "Wire", [fore(19.3), main(21.7)], 0.012, segs=wire_segs, caps=False)
        tube(rig, "Wire", [main(21.7), mizz(17.3)], 0.012, segs=wire_segs, caps=False)
        tube(rig, "Wire", [fore(15.5), main(U + 9.0)], 0.01, segs=wire_segs, caps=False)
        for sy in (1, -1):
            q = side(-HL + 0.6, sheer(-HL) + BULWARK + 0.05, sy, -0.06)
            tube(rig, "Wire", [mizz(17.3), q], 0.012, segs=wire_segs, caps=False)
        # signal halyards and a string of small flags' worth of line from the main crosstree
        tube(rig, "Rope", [(main(15.0)[0], 1.25, 15.0 + 0.1), (0.4, 2.9, WH_TOP + 0.2)], 0.008, segs=3, caps=False)

    # ---- the foredeck: windlass, chain, anchors in the hawse, bitts, fairleads, hatch, crane and tender
    def deck_z(x):
        return sheer(x)
    if fine:
        wx = 14.6
        wz = deck_z(wx)
        box(body, "Machinery", (1.3, 2.3, 0.22), T((wx, 0, wz + 0.11)))
        cyl(body, "Machinery", 0.33, 1.25, T((wx, 0, wz + 0.62), (HALF, 0, 0)), segs=16)
        for sy in (1, -1):
            cyl(body, "Metal_Dark", 0.4, 0.2, T((wx, sy * 0.8, wz + 0.62), (HALF, 0, 0)), segs=16)      # the gypsies
            cyl(body, "Metal_Dark", 0.23, 0.32, T((wx, sy * 1.12, wz + 0.62), (HALF, 0, 0)), segs=12)   # warping drums
            box(body, "Machinery", (0.5, 0.14, 0.75), T((wx, sy * 0.52, wz + 0.5)))
            # the chain forward to the hawse pipe, and the anchor home in it outside
            hx = 16.3
            hp = side(hx, deck_z(hx) + 0.12, sy, -0.75)
            tube(rig, "Metal_Dark", [(wx + 0.3, sy * 0.8, wz + 0.9), (wx + 0.9, sy * 0.85, wz + 0.42), hp], 0.05, segs=6)
            cyl(body, "Metal_Dark", 0.17, 0.12, T(hp), segs=10)
            ho = side(hx, 1.75, sy, 0.03)
            M = frame_at(hx, 1.75, sy, 0.04)
            torus(body, "Metal_Dark", 0.24, 0.07, ho, (0, sy, 0.25), segs=14, rsegs=6)
            box(body, "Metal_Dark", (0.16, 0.14, 1.15), M @ T((0, 0.06, -0.45)))                        # the shank
            box(body, "Metal_Dark", (1.15, 0.2, 0.22), M @ T((0, 0.08, -1.02)))                         # the head
            for dx in (-0.48, 0.48):
                box(body, "Metal_Dark", (0.2, 0.16, 0.75), M @ T((dx, 0.1, -0.72), (0, dx * 0.5, 0)))   # the flukes
            for k, (w0, L, mat) in enumerate(((0.12, 0.7, "Rust"), (0.3, 1.2, "Rust_Light"))):
                box(body, mat, (w0, 0.004, L), frame_at(hx, 1.75 - 1.15 - L / 2, sy, 0.007 - 0.002 * k))
            # bitts (double bollards) forward and aft, fairleads on the rail
            for bx in (11.0, 16.6, -14.9, -17.0):
                by = sy * (hull_pt(bx, deck_z(bx))[1] - 0.55)
                bz = deck_z(bx)
                box(body, "Metal_Dark", (0.95, 0.34, 0.08), T((bx, by, bz + 0.04)))
                for dx in (-0.28, 0.28):
                    cyl(body, "Metal_Dark", 0.1, 0.5, T((bx + dx, by, bz + 0.3)), segs=10)
                    cyl(body, "Metal_Dark", 0.14, 0.05, T((bx + dx, by, bz + 0.55)), segs=10)
                fz = deck_z(bx) + BULWARK + 0.1
                fp = side(bx + 0.9, fz, sy, -0.04)
                box(body, "Metal_Dark", (0.5, 0.2, 0.1), T(fp))
                for dx in (-0.2, 0.2):
                    cyl(body, "Metal_Dark", 0.05, 0.16, T((fp[0] + dx, fp[1], fp[2] + 0.1)), segs=8)
        # a cargo hatch with its coaming and tarpaulin battens, abaft the foremast
        hz = deck_z(9.6)
        box(body, "Bulwark_In", (2.2, 2.6, 0.5), T((9.6, 0.0, hz + 0.25)))
        box(body, "Sail_Tie", (2.3, 2.7, 0.08), T((9.6, 0.0, hz + 0.54)), bevel=0.03)
        for dy in (-0.8, 0.0, 0.8):
            box(body, "Timber", (2.34, 0.07, 0.03), T((9.6, dy, hz + 0.6)))
        # the capstan aft, the stern's mooring gear
        cyl(body, "Machinery", 0.3, 0.7, T((-16.2, 0, D1 + sheer(-16.2) - D1 + 0.35)), segs=14)
        cyl(body, "Metal_Dark", 0.38, 0.08, T((-16.2, 0, sheer(-16.2) + 0.74)), segs=14)
        # ---- the deck crane on the port side of the foredeck: pedestal, slewing column, knuckle boom, stowed forward
        cx, cy = 8.3, 2.75
        cz = deck_z(cx)
        cyl(body, "Machinery", 0.34, 1.5, T((cx, cy, cz + 0.75)), segs=14)
        cyl(body, "Metal_Dark", 0.44, 0.16, T((cx, cy, cz + 1.56)), segs=16)
        box(body, "Crane", (0.5, 0.5, 1.7), T((cx, cy, cz + 2.45)), bevel=0.04)
        p0 = Vector((cx + 0.1, cy, cz + 3.15))
        p1 = p0 + Vector((4.4, 0, 1.15))
        p2 = p1 + Vector((2.6, 0, -1.55))
        for a, b, w in ((p0, p1, 0.3), (p1, p2, 0.22)):
            mid, dvec = (a + b) / 2, b - a
            ang = -math.atan2(dvec.z, dvec.x)
            box(body, "Crane", (dvec.length + 0.2, w * 0.8, w), T(tuple(mid), (0, ang, 0)), bevel=0.03)
        cyl(body, "Metal_Dark", 0.14, 0.42, T(tuple(p1), (HALF, 0, 0)), segs=10)
        tube(body, "Lens", [(cx + 0.3, cy, cz + 2.0), tuple(p0 + Vector((1.9, 0, 0.35)))], 0.07, segs=8)           # the lift ram
        tube(body, "Metal_Dark", [(cx + 0.3, cy, cz + 2.0), tuple(p0 + Vector((1.0, 0, 0.12)))], 0.1, segs=8)
        tube(body, "Lens", [tuple(p1 + Vector((-1.6, 0, -0.55))), tuple(p1 + Vector((0.9, 0, -0.62)))], 0.055, segs=8)
        tube(rig, "Wire", [tuple(p2), tuple(p2 + Vector((0, 0, -0.9)))], 0.012, segs=4)
        box(body, "Crane", (0.16, 0.12, 0.28), T(tuple(p2 + Vector((0, 0, -1.0)))))                              # the hook block
        torus(body, "Metal_Dark", 0.07, 0.02, tuple(p2 + Vector((0, 0, -1.22))), (0, 1, 0), segs=10, rsegs=4)
        # ---- the tender: a rigid inflatable in chocks on the starboard side, its outboard tilted
        tx, ty = 8.9, -2.55
        tz = deck_z(tx) + 0.5
        path = [(tx - 1.9, ty + 0.72), (tx + 0.6, ty + 0.74), (tx + 1.6, ty + 0.55), (tx + 2.15, ty), (tx + 1.6, ty - 0.55), (tx + 0.6, ty - 0.74), (tx - 1.9, ty - 0.72)]
        tube(body, "Rib", [(x, y, tz + 0.12 * max(0, x - tx - 0.6)) for x, y in path], 0.24, segs=10)
        box(body, "Machinery", (3.3, 1.2, 0.12), T((tx - 0.2, ty, tz - 0.14)))
        box(body, "Rib", (0.12, 1.3, 0.5), T((tx - 1.85, ty, tz + 0.05)))
        box(body, "Seat", (0.6, 0.8, 0.5), T((tx - 0.5, ty, tz + 0.15)))
        box(body, "Metal_Dark", (0.35, 0.3, 0.55), T((tx - 2.15, ty, tz + 0.5), (0, -0.5, 0)), bevel=0.05)
        tube(body, "Metal_Dark", [(tx - 2.2, ty, tz + 0.3), (tx - 2.65, ty, tz - 0.25)], 0.05, segs=6)
        for dx in (-1.3, 1.2):
            box(body, "Timber", (0.16, 1.7, 0.3), T((tx + dx, ty, deck_z(tx + dx) + 0.15)))
        # kayaks racked two high on the lounge roof, each side of the centreline
        col = ("Kayak_A", "Kayak_B", "Kayak_C", "Kayak_B", "Kayak_A", "Kayak_C", "Kayak_A", "Kayak_B")
        k = 0
        for sy in (1, -1):
            for tier in (0, 1):
                for row in (0, 1):
                    kx, ky, kz = -1.6, sy * (0.75 + 0.62 * row), LG_TOP + 0.45 + 0.42 * tier
                    secs_k = []
                    for s in np.linspace(-1, 1, 11):
                        r = max(0.04, (1 - s * s) ** 0.6)
                        secs_k.append([(kx + 2.15 * s, ky + 0.27 * r * math.cos(a), kz + 0.15 * r * math.sin(a)) for a in np.linspace(0, TAU, 8, endpoint=False)])
                    loft(body, col[k % len(col)], secs_k, caps=True)
                    cyl(body, "Metal_Dark", 0.2, 0.02, T((kx - 0.1, ky, kz + 0.14)), segs=8)
                    k += 1
            for dx in (-2.8, -0.4):
                for yy in (0.42, 1.72):
                    cyl(rig, "Rail", 0.03, 1.05, T((kx + 1.6 + dx, sy * yy, LG_TOP + 0.62)), segs=6)
                for tier in (0, 1):
                    box(rig, "Rail", (0.05, 1.36, 0.04), T((kx + 1.6 + dx, sy * 1.07, LG_TOP + 0.28 + 0.42 * tier)))
        # tyre fenders slung along the rubbing strake, four a side
        for sy in (1, -1):
            for x in (-12.5, -5.0, 2.5, 9.5):
                p = side(x, sheer(x) - 0.55, sy, 0.16)
                a = side_angle(x, 1.5) * sy
                torus(body, "Fender", 0.27, 0.12, p, (-math.sin(a), sy * math.cos(a), 0), segs=14, rsegs=6)
                top = side(x, sheer(x) + BULWARK, sy, 0.0)
                tube(rig, "Rope", [(p[0], p[1], p[2] + 0.3), (top[0], top[1], top[2])], 0.018, segs=4)
        # lifebuoys on the upper deck's rails and the wheelhouse, liferaft canisters in cradles
        for sy in (1, -1):
            for x in (-13.5, -1.0):
                torus(body, "Buoy", 0.3, 0.075, (x, sy * (HB - 0.16), U + 0.62), (0, 1, 0), segs=16, rsegs=6)
                for a in (0, HALF, 2 * HALF, 3 * HALF):
                    box(body, "Raft", (0.2, 0.17, 0.2), T((x + 0.3 * math.cos(a), sy * (HB - 0.16), U + 0.62 + 0.3 * math.sin(a))))
            for x in (-8.9, -10.3):
                cyl(body, "Raft", 0.31, 1.15, T((x - 0.0, sy * (HB - 0.85), U + 0.5), (0, HALF, 0)) if False else T((x, sy * (HB - 0.85), U + 0.5), (HALF, 0, 0)), segs=14)
                for dy in (-0.35, 0.35):
                    torus(body, "Metal_Dark", 0.32, 0.015, (x, sy * (HB - 0.85) + dy, U + 0.5), (0, 1, 0), segs=14, rsegs=4)
                    box(body, "Metal_Dark", (0.6, 0.06, 0.2), T((x, sy * (HB - 0.85) + dy, U + 0.1)))
        # on the wheelhouse roof: the radar mast with its platform, searchlight, aerials, domes, the horn
        rx = 3.0
        tube(body, "Trim", [(rx, 0, WH_TOP + 0.14), (rx, 0, WH_TOP + 2.3)], 0.09, segs=10)
        box(body, "Trim", (0.9, 0.9, 0.06), T((rx + 0.1, 0, WH_TOP + 1.42)))
        for sy in (1, -1):
            tube(rig, "Rail", [(rx, 0, WH_TOP + 0.9), (rx + 0.1, sy * 0.4, WH_TOP + 1.4)], 0.025, segs=5)
            tube(rig, "Rail", [(rx, sy * 1.0, WH_TOP + 2.0), (rx, sy * 1.0, WH_TOP + 2.02)], 0.03, segs=5)
            tube(rig, "Wire", [(rx, sy * 2.2, WH_TOP + 0.14), (rx, sy * 2.2, WH_TOP + 3.4)], lambda t: 0.014 - 0.008 * t, segs=4)   # whip aerials
            sphere(body, "Raft", 0.17, T((rx - 1.0, sy * 1.3, WH_TOP + 0.5), scale=(1, 1, 0.8)), segs=10, rings=6)                  # sat domes
            cyl(body, "Trim", 0.04, 0.4, T((rx - 1.0, sy * 1.3, WH_TOP + 0.3)), segs=6)
        box(body, "Trim", (0.06, 2.0, 0.06), T((rx, 0, WH_TOP + 2.0)))
        cyl(body, "Metal_Dark", 0.14, 0.22, T((5.7, 1.6, WH_TOP + 0.55), (0, HALF, 0)), segs=12)                    # searchlight
        cyl(body, "Light_White", 0.125, 0.02, T((5.82, 1.6, WH_TOP + 0.55), (0, HALF, 0)), segs=12)
        tube(body, "Metal_Dark", [(5.7, 1.6, WH_TOP + 0.14), (5.7, 1.6, WH_TOP + 0.45)], 0.03, segs=6)
        cyl(body, "Brass", 0.06, 0.5, T((5.4, -1.5, WH_TOP + 0.3), (0, HALF, 0)), segs=8, r2=0.11)                  # the horn
        # nav light boxes on the wings, the ensign staff, the stern rail's light
        for sy, mat in ((1, "Light_Red"), (-1, "Light_Green")):
            box(body, "Metal_Dark", (0.55, 0.06, 0.34), T((5.2, sy * (HB - 0.16), U + 1.42)))
            box(body, "Metal_Dark", (0.06, 0.2, 0.34), T((4.95, sy * (HB - 0.08), U + 1.42)))
        # the names: boards on the bows, the name and port on the transom
        for sy in (1, -1):
            x = 13.6
            z = sheer(x) + 0.52
            a = side_angle(x, z) * sy
            p = side(x, z, sy, 0.035)
            R = Matrix.Rotation(a, 4, "Z")
            box(body, "Name_Board", (3.6, 0.05, 0.5), Matrix.Translation(p) @ R, bevel=0.012)
            box(body, "Brass", (3.68, 0.03, 0.58), Matrix.Translation(side(x, z, sy, 0.02)) @ R)
            ex = R @ Vector((-sy, 0, 0))
            M = Matrix((ex, Vector((0, 0, 1)), R @ Vector((0, sy, 0)))).transposed().to_4x4()
            M.translation = Vector(side(x, z, sy, 0.065))
            text_mesh(name, NAME, "Lettering", 0.36, M)
        tz0 = sheer(-HL) + 0.45
        for txt, z, size in ((NAME, tz0, 0.42), (PORT, tz0 - 0.6, 0.26)):
            upv = Vector((-0.22, 0, 1)).normalized()            # the transom's own rake
            M = Matrix((Vector((0, -1, 0)), upv, Vector((0, -1, 0)).cross(upv))).transposed().to_4x4()
            M.translation = Vector((hull_pt(-HL, z)[0] - 0.012, 0, z))
            text_mesh(name, txt, "Lettering", size, M)

    # ---- separate nodes: the radar scanner, the ensign, the lamps
    objs = {"Body": body.build("Body")}
    info_lights = {}
    if fine:
        objs["Trim_Rig"] = rig.build("Trim_Rig")
        objs["Trim_Name"] = name.build("Trim_Name")
        radar = Mesh()
        ro = (3.1, 0, WH_TOP + 1.45)
        cyl(radar, "Metal_Dark", 0.13, 0.22, T((ro[0], 0, ro[2] + 0.11)), segs=12)
        box(radar, "Raft", (0.2, 1.9, 0.13), T((ro[0], 0, ro[2] + 0.3)), bevel=0.04)
        objs["radar"] = radar.build("radar", origin=ro)
        # the ensign on its staff at the taffrail
        sx = hull_pt(-HL, sheer(-HL) + BULWARK)[0] + 0.2
        s0 = sheer(-HL) + BULWARK
        staff = Mesh()
        tube(body if False else staff, "Trim", [(sx, 0, s0 - 0.6), (sx - 0.5, 0, s0 + 2.6)], 0.03, segs=6)
        sphere(staff, "Brass", 0.05, T((sx - 0.5, 0, s0 + 2.63)), segs=6, rings=4)
        objs["Trim_Staff"] = staff.build("Trim_Staff")
        flag = Mesh()
        fw, fh, nx, nz = 1.6, 0.8, 16, 8
        hoist = (sx - 0.47, 0, s0 + 1.72)
        grid = [[flag.vert((hoist[0] - 0.03 - fw * i / nx - 0.16 * (j / nz - 1) * 0, 0, hoist[2] + fh * j / nz)) for i in range(nx + 1)] for j in range(nz + 1)]
        for j in range(nz):
            for i in range(nx):
                uv = [(i / nx, j / nz), ((i + 1) / nx, j / nz), ((i + 1) / nx, (j + 1) / nz), (i / nx, (j + 1) / nz)]
                flag.face([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]], "Flag", True, uv=uv)
        objs["flag"] = flag.build("flag", origin=hoist)
        lamps = {"light_port": ((5.2, HB - 0.11, U + 1.42), "Light_Red"), "light_starboard": ((5.2, -(HB - 0.11), U + 1.42), "Light_Green"),
                 "light_mast": (tuple(np.array(fore(14.5)) + np.array((0.24, 0, 0))), "Light_White"),
                 "light_stern": ((hull_pt(-HL, s0)[0] - 0.05, 0, s0 + 0.12), "Light_White")}
        for nm, (p, mat) in lamps.items():
            m = Mesh()
            sphere(m, mat, 0.085, T(p), segs=10, rings=6)
            objs[nm] = m.build(nm, origin=p)
            info_lights[nm] = p
        tube_m = Mesh()
        box(tube_m, "Metal_Dark", (0.12, 0.3, 0.3), T(tuple(np.array(fore(14.5)) + np.array((0.12, 0, 0)))))
        objs["Trim_Lampbox"] = tube_m.build("Trim_Lampbox")
    helm = (4.3, 0.0, U)
    anchors = {"Helm": helm, "Bow": (hull_pt(HL, 0)[0], 0, 0), "Stern": (-HL, 0, 0), **stacks}
    if fine:
        for k, p in anchors.items():
            objs[k] = empty(k, p)

    def g(p):       # vehicle frame -> the model's (glTF) frame: x port, y up, z forward
        return [round(float(p[1]), 3), round(float(p[2]), 3), round(float(p[0]), 3)]
    wl = [[round(float(x), 2), round(hull_pt(x, 0.0)[1], 2)] for x in np.linspace(HL, -HL, 25)]
    info = {
        "name": NAME, "port": PORT,
        "note": "A fictional 40 m steel motor vessel in the style of a New Zealand trading scow, true to the type of the "
                "overnight cruise vessels that work Milford Sound; built by blender/build_ship.py",
        "frame": "glTF: +z forward (the bow), +y up, +x to port; metres; origin on the centreline at the waterline, amidships of the hull",
        "length_overall_m": round(bow_x + HL + 0.22 * (sheer(-HL) + BULWARK), 2), "length_on_deck_m": round(hull_pt(HL, sheer(HL))[0] + HL + 0.22 * sheer(-HL), 2),
        "length_waterline_m": round(hull_pt(HL, 0)[0] + HL, 2),
        "beam_m": round(2 * HB * (1 + 0.035 * BULWARK) + 0.02, 2), "draft_m": -KEEL, "freeboard_m": D1, "bulwark_m": BULWARK,
        "air_draft_m": 22.05, "main_deck_m": D1, "upper_deck_m": round(U, 2), "wheelhouse_roof_m": round(WH_TOP + 0.14, 2),
        "decks": [
            {"name": "main deck, port side", "x0": HB - 1.2, "x1": HB - 0.1, "z0": -13.5, "z1": 6.2, "y": D1},
            {"name": "main deck, starboard side", "x0": -(HB - 0.1), "x1": -(HB - 1.2), "z0": -13.5, "z1": 6.2, "y": D1},
            {"name": "after deck", "x0": -3.3, "x1": 3.3, "z0": -17.6, "z1": -13.9, "y": round(sheer(-16), 2)},
            {"name": "foredeck", "x0": -1.3, "x1": 1.3, "z0": 6.6, "z1": 8.3, "y": round(sheer(7.4), 2),
             "note": "the deck rises forward with the sheer: y = 2.1 + 1.25 * ((z - 6) / 12)^2 for z > 6; clear ground runs "
                     "on the centreline from the saloon's front to the hatch (z 8.4), then round it to the windlass at z 13.9"},
            {"name": "upper deck, aft (open, benches at z -14.6..-8.9)", "x0": -(HB - 0.35), "x1": HB - 0.35, "z0": -15.2, "z1": -8.1, "y": round(U + 0.012, 3)},
            {"name": "upper deck, port side", "x0": 3.2, "x1": HB - 0.35, "z0": -8.1, "z1": 5.6, "y": round(U + 0.012, 3)},
            {"name": "upper deck, starboard side", "x0": -(HB - 0.35), "x1": -3.2, "z0": -8.1, "z1": 5.6, "y": round(U + 0.012, 3)},
        ],
        "helm": g(helm), "eye_height_m": 1.65,
        "passenger_spots": [g((-9.4, HB - 0.75, U + 0.012)), g((-9.4, -(HB - 0.75), U + 0.012)), g((4.4, HB - 0.6, U + 0.012)),
                            g((7.4, 0.0, sheer(7.4))), g((-16.9, -1.5, sheer(-16.9)))],
        "bow": g((hull_pt(HL, 0)[0], 0, 0)), "stern": g((-HL, 0, 0)), "waterline": wl,
        "waterline_note": "the port half of the waterline as [z (forward), x (half-breadth)] from the bow to the stern",
        "masts": {"fore": g(fore(19.6)), "main": g(main(22.0)), "mizzen": g(mizz(17.6))},
        "exhausts": {k: g(p) for k, p in stacks.items()},
        "nodes": {"radar": "the scanner; spins about its own +y", "flag": "the ensign, 16 x 8 quads, origin at the hoist; the fly trails aft (-z)",
                  "light_port": "red", "light_starboard": "green", "light_mast": "white masthead light on the foremast", "light_stern": "white",
                  "Body": "hull, decks, houses, spars (ambient occlusion baked)", "Trim_Rig": "wires, rails, small fittings",
                  "Trim_Name": "lettering", "Helm / Bow / Stern / Stack_Port / Stack_Starboard": "empties"},
        "materials": {"glass": "Window", "cabin_lights": "Light_Cabin (emissive ceiling strips: scale its emissive to light the windows at night)",
                      "lamps": ["Light_Red", "Light_Green", "Light_White"], "flag": "Flag (textured, double-sided)"},
        "lights": {k: g(p) for k, p in info_lights.items()},
    }
    return objs, info


# ------------------------------------------------------------ previews, export
SHOTS = [("bow34", (44, -32, 7.5), (0, 0, 6.5), 36), ("beam", (0, -62, 5), (0.5, 0, 8.5), 34), ("stern34", (-40, 26, 8), (0, 0, 6), 36),
         ("foredeck", (22, -9, 9.5), (6, 0, 5.0), 30), ("high", (-22, -30, 26), (1, 0, 4), 34), ("aft_deck", (-24, 6, 9.5), (-8, 0, 5.5), 30)]


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    V.MAT.clear()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", help="render quick previews into this folder instead of exporting")
    ap.add_argument("--far", action="store_true", help="with --preview: the far model")
    ap.add_argument("--render", action="store_true", help="also render the beauty shots into docs/images/milford-sound")
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--bake-samples", type=int, default=96)
    ap.add_argument("--shots", nargs="*")
    a = ap.parse_args()
    if a.preview:
        fresh()
        objs, info = build(far=a.far)
        print("triangles", V.triangles(objs.values()))
        os.makedirs(a.preview, exist_ok=True)
        V.stage("ship", min(a.samples, 32), (1280, 720))
        bpy.context.scene.view_settings.exposure = -1.0
        for nm, loc, tgt, lens in SHOTS:
            if a.shots and nm not in a.shots:
                continue
            V.camera("Cam", loc, tgt, lens)
            V.render(os.path.join(a.preview, f"ship_{'far_' if a.far else ''}{nm}.jpg"))
        return
    os.makedirs(OUT, exist_ok=True)
    # the far model first: the same lines, small things left off, no baked map
    fresh()
    objs, _ = build(far=True)
    far_tris = V.triangles(objs.values())
    if far_tris > 6000:
        lo = V.lod_copy(objs["Body"], "Body_Far", 5800 / far_tris)
        bpy.data.objects.remove(objs["Body"])
        objs = {"Body": lo}
        lo.name = "Body"
        far_tris = V.triangles([lo])
    V.export(objs, os.path.join(OUT, "ship_scow_far.glb"))
    fresh()
    objs, info = build()
    trims = [o for k, o in objs.items() if k.startswith("Trim")]
    meshes = [o for k, o in objs.items() if o.type == "MESH" and o not in trims and k != "flag"]
    V.bake_ao(meshes, trims, 2048, 2.5, a.bake_samples)
    info["triangles"] = V.triangles(objs.values())
    info["far_triangles"] = far_tris
    info["far_file"] = "ship_scow_far.glb"
    info["file"] = "ship_scow.glb"
    V.export(objs, os.path.join(OUT, "ship_scow.glb"))
    info["bytes"] = os.path.getsize(os.path.join(OUT, "ship_scow.glb"))
    info["far_bytes"] = os.path.getsize(os.path.join(OUT, "ship_scow_far.glb"))
    with open(os.path.join(OUT, "ship_scow.json"), "w") as f:
        json.dump(info, f, indent=1)
        f.write("\n")
    print("triangles", info["triangles"], "far", far_tris)
    if a.render:
        os.makedirs(DOCS, exist_ok=True)
        V.stage("ship", a.samples, (1600, 900))
        bpy.context.scene.view_settings.exposure = -1.0
        for nm, out in (("bow34", "ship-bow.jpg"), ("beam", "ship-beam.jpg")):
            _, loc, tgt, lens = next(s for s in SHOTS if s[0] == nm)
            V.camera("Cam", loc, tgt, lens)
            V.render(os.path.join(DOCS, out))


if __name__ == "__main__":
    main()
