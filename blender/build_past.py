"""Build what only the camera sees: web/assets/past/past.glb (web/game/past.js, a story frame's `relic`).

The story's camera sees the evening it was loaded for. Through its finder, things of 1964 that are gone from the
street stand where they stood; each is what a frame's photograph is of, and a piece of the case:

  postbox   the round red pillar box of a Showa street corner
  board     a standing signboard for the planetarium's evening lecture: a star chart under a white band
  shoeshine a shoeshine boy's box with its foot-rest, his stool and a tin of polish
  dome      the planetarium's dome on its drum, as it stood on the roof east of the station
  river     the river open to the sky between its stone walls, and the bridge over it with its parapets
  umbrella  a black umbrella leaned against a rail
  lamp      the red lamp of a police box on its iron post
  tram      a street tram of the Tamagawa line, green over cream, at its stop

Each is life size in metres, stands on the ground at its origin (the dome: its drum's foot), +Z up, and carries its
colour in its vertices; the page draws them in the tones of an old print, inside the finder only.

    blender -b -P blender/build_past.py                  # or: pip install bpy==5.2.3; python blender/build_past.py
    blender -b -P blender/build_past.py -- --preview DIR # also render a still of each into DIR
"""
import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_stop import ROOT, compress, grid_faces, hexc, join, make, mix, preview, smooth  # noqa: E402

OUT = os.path.join(ROOT, "web", "assets", "past")


def box(x0, y0, z0, x1, y1, z1, col, name="b", rot=0.0, at=(0, 0, 0)):
    V = np.array([(x, y, z) for z in (z0, z1) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))], float)
    c, s = math.cos(rot), math.sin(rot)
    V = np.c_[V[:, 0] * c - V[:, 1] * s + at[0], V[:, 0] * s + V[:, 1] * c + at[1], V[:, 2] + at[2]]
    F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = make(name, V, F, np.tile(col, (8, 1)))
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def lathe(profile, seg=20, name="l", at=(0, 0, 0)):
    """profile: [(radius, z, colour)] from the bottom up; closed at both ends."""
    V, C = [], []
    for r, z, c in profile:
        for k in range(seg):
            a = k / seg * 2 * math.pi
            V.append((math.cos(a) * r + at[0], math.sin(a) * r + at[1], z + at[2]))
            C.append(c)
    n = len(V)
    return make(name, np.array(V), grid_faces(len(profile), seg, wrap=True) + [tuple(range(seg - 1, -1, -1)), tuple(range(n - seg, n))], np.array(C))


def postbox():
    red, dark, pale = hexc(0xb3261e), hexc(0x2c2a28), hexc(0xe9e3d2)
    body = lathe([(0.26, 0, dark), (0.26, 0.12, dark), (0.205, 0.13, red), (0.205, 1.02, red), (0.27, 1.04, red), (0.275, 1.09, red), (0.2, 1.17, red), (0.09, 1.23, red), (0.0, 1.245, red)], name="postbox")
    slot = box(-0.1, -0.215, 0.86, 0.1, -0.2, 0.9, dark)
    lip = box(-0.12, -0.24, 0.905, 0.12, -0.2, 0.925, red)
    plate = box(-0.07, -0.213, 0.52, 0.07, -0.2, 0.74, pale)
    return join("postbox", [body, slot, lip, plate, blob(0.55, 0.5)])


def board():
    """An A-frame board: on each face a night sky with its stars and a white band for the evening's title."""
    night, star, band, wood = hexc(0x16234f), hexc(0xf3ecd2), hexc(0xece6d6), hexc(0x6b5338)
    parts = []
    rng = np.random.default_rng(64)
    for side in (1, -1):
        nx, nz = 13, 21
        V, C = [], []
        for i in range(nz):
            v = i / (nz - 1)
            for j in range(nx):
                u = j / (nx - 1)
                V.append(((u - 0.5) * 0.6, side * (0.22 * (1 - v) + 0.012), 0.08 + v * 1.1))
                c = band if v > 0.8 else star if (0.06 < v < 0.76 and 0.08 < u < 0.92 and rng.random() < 0.11) else night
                C.append(c)
        parts.append(make("face", np.array(V), grid_faces(nz, nx), np.array(C)))
        for x in (-0.31, 0.29):
            parts.append(box(x, side * 0.23 - 0.015, 0, x + 0.02, side * 0.23 + 0.015, 0.1, wood))
    parts.append(box(-0.31, -0.02, 1.17, 0.31, 0.02, 1.2, wood))
    parts.append(blob(0.6, 0.55))
    return join("board", parts)


def shoeshine():
    wood, dark, tin, cloth = hexc(0x7a5a3a), hexc(0x3e2c1c), hexc(0xb8b2a0), hexc(0x8a2f2a)
    parts = [box(-0.24, -0.15, 0, 0.24, 0.15, 0.27, wood, "shoeshine"), box(-0.25, -0.16, 0.27, 0.25, 0.16, 0.295, dark)]
    # the foot-rest: a sole-shaped block on a post
    parts += [box(-0.03, -0.03, 0.295, 0.03, 0.03, 0.42, dark), box(-0.05, -0.13, 0.42, 0.05, 0.13, 0.45, wood)]
    # the stool beside it, a cloth over it
    sx = 0.55
    parts += [box(sx - 0.15, -0.15, 0.24, sx + 0.15, 0.15, 0.28, wood), box(sx - 0.12, -0.13, 0.28, sx + 0.1, 0.11, 0.295, cloth)]
    for dx, dy in ((-0.13, -0.13), (0.1, -0.13), (-0.13, 0.1), (0.1, 0.1)):
        parts.append(box(sx + dx, dy, 0, sx + dx + 0.03, dy + 0.03, 0.24, dark))
    parts.append(lathe([(0.045, 0, tin), (0.045, 0.03, tin), (0.0, 0.031, dark)], seg=10, at=(0.05, -0.3, 0)))  # the tin of polish
    parts.append(box(-0.2, -0.36, 0, -0.04, -0.3, 0.05, dark))  # the brush
    parts.append(blob(0.75, 0.5, at=(0.25, 0)))
    return join("shoeshine", parts)


def dome():
    """The planetarium: a ribbed hemisphere of pale metal on a low drum, twenty metres across."""
    R, pale, rib, drum, door = 10.0, hexc(0xcfd6d8), hexc(0x9aa6ab), hexc(0xd8d0bd), hexc(0x4a4f57)
    prof = [(R + 0.6, 0, drum), (R + 0.6, 3.2, drum), (R + 0.2, 3.4, rib)]
    for k in range(1, 13):
        a = k / 12 * math.pi / 2
        prof.append((math.cos(a) * R, 3.4 + math.sin(a) * R, pale if k % 2 else mix(pale, rib, 0.35)))
    ob = lathe(prof, seg=36, name="dome")
    # its ribs: every third meridian a shade darker
    att = ob.data.color_attributes["Col"]
    n = len(ob.data.vertices)
    col = np.zeros(n * 4)
    att.data.foreach_get("color", col)
    col = col.reshape(n, 4)
    for i in range(n):
        if (i % 36) % 3 == 0 and ob.data.vertices[i].co.z > 3.3:
            col[i, :3] *= 0.72
    att.data.foreach_set("color", col.ravel())
    return join("dome", [ob, box(-1.6, -R - 0.7, 0, 1.6, -R - 0.55, 2.6, door)])


def river():
    """Thirty-six metres of the river open between its walls, running along y, and the bridge across the middle."""
    water, glint, stone, dark, rail = hexc(0x23423f), hexc(0x6f9c98), hexc(0x9a9484), hexc(0x55514a), hexc(0x7b766a)
    L, W = 18.0, 2.6
    nx, ny = 7, 49
    V, C = [], []
    for i in range(ny):
        v = i / (ny - 1)
        for j in range(nx):
            u = j / (nx - 1)
            V.append(((u - 0.5) * 2 * W, (v - 0.5) * 2 * L, 0.06 + 0.012 * math.sin(v * 60 + u * 9)))
            C.append(mix(water, glint, 0.5 + 0.5 * math.sin(v * 75 + math.sin(u * 7) * 2.5)) * (0.75 + 0.25 * math.sin(u * math.pi)))
    parts = [make("river", np.array(V), grid_faces(ny, nx), np.array(C))]
    for side in (-1, 1):  # the walls: coursed stone, a darker course every third
        for k in range(18):
            y0 = -L + k * 2.0
            parts.append(box(side * W - 0.2, y0, 0, side * W + 0.2, y0 + 1.96, 0.55, stone if k % 3 else dark))
    # the bridge: its deck, the parapets with their posts, and the name posts at its four corners
    parts.append(box(-W - 0.9, -2.2, 0.5, W + 0.9, 2.2, 0.72, stone))
    for sy in (-2.2, 2.05):
        parts.append(box(-W - 0.9, sy, 1.42, W + 0.9, sy + 0.15, 1.56, rail))
        for k in range(9):
            x = -W - 0.8 + k * (2 * W + 1.6) / 8
            parts.append(box(x - 0.06, sy + 0.02, 0.72, x + 0.06, sy + 0.13, 1.42, rail))
        for x in (-W - 1.05, W + 0.75):
            parts.append(box(x, sy - 0.08, 0.5, x + 0.3, sy + 0.23, 1.78, dark))
    return join("river", parts)


def umbrella():
    """Closed and leaned: the canopy furled round its shaft, the crook of the handle uppermost."""
    black, wood, tipc = hexc(0x15161a), hexc(0x6b4a2c), hexc(0xb9b4a6)
    lean = math.radians(18)
    prof = [(0.006, 0.0, tipc), (0.008, 0.06, tipc), (0.022, 0.09, black), (0.05, 0.42, black), (0.04, 0.7, black), (0.014, 0.74, black), (0.011, 0.86, wood), (0.0, 0.862, wood)]
    ob = lathe(prof, seg=10, name="umbrella")
    # the crook: three short lengths turning over
    parts = [ob, box(-0.012, -0.012, 0.85, 0.012, 0.012, 0.93, wood), box(-0.012, -0.012, 0.93, 0.07, 0.012, 0.955, wood), box(0.05, -0.012, 0.87, 0.074, 0.012, 0.955, wood)]
    u = join("umbrella", parts)
    u.rotation_euler = (lean, 0, 0)
    bpy.context.view_layer.objects.active = u
    u.select_set(True)
    bpy.ops.object.transform_apply(rotation=True)
    return u


def lamp():
    """The red globe that marks a police box, on a bracket at the head of a post."""
    iron, red, glow = hexc(0x2a2c2e), hexc(0xc2281f), hexc(0xff6a4a)
    post = lathe([(0.11, 0, iron), (0.11, 0.1, iron), (0.045, 0.14, iron), (0.04, 2.5, iron), (0.06, 2.52, iron), (0.0, 2.56, iron)], seg=10, name="lamp")
    arm = box(0.0, -0.02, 2.36, 0.34, 0.02, 2.4, iron)
    cap = lathe([(0.0, 2.36, iron), (0.11, 2.34, iron), (0.12, 2.3, iron)], seg=12, at=(0.34, 0, 0))
    globe = lathe([(0.03, 2.02, red)] + [(0.13 * math.sin(k / 8 * math.pi) + 0.012, 2.3 - 0.28 * (1 - k / 8) if False else 2.02 + 0.28 * k / 8, mix(glow, red, abs(k / 8 - 0.5) * 2)) for k in range(1, 8)] + [(0.05, 2.3, red)], seg=14, at=(0.34, 0, 0))
    return join("lamp", [post, arm, cap, globe, blob(0.4, 0.4)])


def quads(name, Q):
    """A mesh of quads that share no vertices, each one colour: Q is [(four points, colour)]. Bands of colour stay
    crisp (a shared vertex would blend its neighbours), and a flat panel is lit as a flat panel."""
    V, F, C = [], [], []
    for pts, col in Q:
        n = len(V)
        V += [tuple(p) for p in pts]
        F.append(tuple(range(n, n + len(pts))))
        C += [col] * len(pts)
    ob = make(name, np.array(V, float), F, np.array(C, float))
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def blob(rx, ry, at=(0, 0), dark=0.6, name="shadow"):
    """What a thing puts on the ground under it: a soft dark patch, densest in the middle and gone at its edge."""
    seg, rings = 24, [(0.0, dark), (0.45, dark * 0.85), (0.78, dark * 0.4), (1.0, 0.0)]
    V, A = [], []
    for r, al in rings:
        for k in range(seg):
            t = k / seg * 2 * math.pi
            V.append((at[0] + math.cos(t) * rx * max(r, 0.02), at[1] + math.sin(t) * ry * max(r, 0.02), 0.035))
            A.append(al)
    ob = make(name, np.array(V), grid_faces(len(rings), seg, wrap=True) + [tuple(range(seg - 1, -1, -1))], np.tile(hexc(0x05060a), (len(V), 1)))
    att = ob.data.color_attributes["Col"]
    col = np.zeros(len(V) * 4)
    att.data.foreach_get("color", col)
    col = col.reshape(len(V), 4)
    col[:, 3] = A
    att.data.foreach_set("color", col.ravel())
    return ob


def tram():
    """A street tram of the Tamagawa line as it ran to Shibuya until 1969, standing along x on its rails: twelve
    metres, its ends rounded in plan, green to the waist and cream above, a row of lit windows with their pillars, a
    door at each end, a cambered grey roof with its bow collector and a destination box over each front, a lamp
    and a fender at each end, two bogies on eight wheels; under it the rails in their bed of setts, and its shadow."""
    green, door, cream, glass, glass2, roofc, dark, steel, lampc, sett, sett2 = (hexc(h) for h in (0x2f5a45, 0x274b3a, 0xe6dcc0, 0xf2d79a, 0xd9c88e, 0x7f8482, 0x1f2123, 0x8d9296, 0xfff2c8, 0x4a4c50, 0x55585d))
    W = 1.16

    def half(x):
        ax = abs(x)
        return W if ax <= 5.3 else W * math.sqrt(max(0.1, 1 - ((ax - 5.3) / 0.78) ** 2 * 0.62))

    edges = [-6.0, -5.85, -5.65, -5.45, -5.3, -4.72, -4.56]
    for k in range(8):
        edges += [-4.4 + k * 1.1, -4.4 + k * 1.1 + 0.95]
    xs = sorted(set(round(x, 3) for x in edges + [-x for x in edges]))
    panes = [(-4.4 + k * 1.1, -4.4 + k * 1.1 + 0.95) for k in range(8)]
    ZS = [0.42, 0.6, 1.5, 1.58, 2.32, 2.5]

    def profile(w):  # up the right side, over the roof, down the left
        pts = [(w, z, "side") for z in ZS]
        pts += [(w * math.cos(k / 12 * math.pi), 2.5 + 0.3 * math.sin(k / 12 * math.pi), "roof") for k in range(1, 12)]
        pts += [(-w, z, "side") for z in reversed(ZS)]
        return pts

    def colour(x, z, kind):
        ax = abs(x)
        if kind == "roof" or z > 2.5:
            return roofc
        if z < 0.6:
            return dark
        if z < 1.5:
            return door if 4.72 < ax < 5.3 else green
        if z < 1.58:
            return cream
        if z < 2.32:
            if ax > 5.3:
                return glass2
            if 4.72 < ax < 5.3:
                return glass
            return glass if any(a <= x <= b for a, b in panes) else cream
        return cream

    Q = []
    for x0, x1 in zip(xs[:-1], xs[1:]):
        p0, p1 = profile(half(x0)), profile(half(x1))
        for i in range(len(p0) - 1):
            kind = "roof" if "roof" in (p0[i][2], p0[i + 1][2]) and not (p0[i][2] == "side" and p0[i + 1][2] == "side") else "side"
            zc, xc = (p0[i][1] + p0[i + 1][1]) / 2, (x0 + x1) / 2
            Q.append(([(x0, p0[i][0], p0[i][1]), (x1, p1[i][0], p1[i][1]), (x1, p1[i + 1][0], p1[i + 1][1]), (x0, p0[i + 1][0], p0[i + 1][1])], colour(xc, zc, kind)))
    for end in (-1, 1):  # the fronts: a fan from the middle of each, in the same bands (the windscreen in its place)
        x, pr = end * 6.0, profile(half(6.0))
        for i in range(len(pr) - 1):
            zc = (pr[i][1] + pr[i + 1][1]) / 2
            tri = [(x, pr[i][0], pr[i][1]), (x, pr[i + 1][0], pr[i + 1][1]), (x + end * 0.06, 0.0, 1.55)]
            Q.append((tri if end > 0 else tri[::-1], colour(x, zc, "roof" if pr[i][2] == "roof" and pr[i + 1][2] == "roof" else "side")))
        Q.append(([(x, -0.9, 0.0), (x, 0.9, 0.0), (x, 0.9, 0.42), (x, -0.9, 0.42)], dark))
    parts = [quads("tram", Q), box(-5.9, -1.05, 0.05, 5.9, 1.05, 0.42, dark)]
    for end in (-1, 1):
        parts.append(box(end * 6.05 - 0.05, -0.16, 0.92, end * 6.05 + 0.05, 0.16, 1.2, lampc))                     # the lamp
        parts.append(box(end * 6.12 - 0.05, -1.0, 0.42, end * 6.12 + 0.05, 1.0, 0.56, steel))                     # the fender
        parts.append(box(end * 5.62 - 0.3, -0.5, 2.74, end * 5.62 + 0.3, 0.5, 2.98, cream))                       # the destination box
        parts.append(box(end * 5.93 - 0.02 if end > 0 else end * 5.93 - 0.02, -0.42, 2.78, end * 5.93 + 0.02, 0.42, 2.94, dark))
        parts.append(box(end * 3.7 - 1.0, -0.86, 0.12, end * 3.7 + 1.0, 0.86, 0.4, hexc(0x2b2d30)))               # a bogie
        for wx in (-0.62, 0.62):
            for wy in (-0.74, 0.74):                                                                                # its wheels: ten-sided, on the rails
                cx, r = end * 3.7 + wx, 0.34
                ring = [(cx + math.cos(k / 10 * 2 * math.pi) * r, r + math.sin(k / 10 * 2 * math.pi) * r) for k in range(10)]
                Qw = [([(ring[k][0], wy - 0.06, ring[k][1]), (ring[(k + 1) % 10][0], wy - 0.06, ring[(k + 1) % 10][1]), (ring[(k + 1) % 10][0], wy + 0.06, ring[(k + 1) % 10][1]), (ring[k][0], wy + 0.06, ring[k][1])], steel) for k in range(10)]
                Qw += [([(px, wy + s * 0.06, pz) for px, pz in (ring if s > 0 else ring[::-1])], dark) for s in (-1, 1)]
                parts.append(quads("wheel", Qw))
    # the bow collector: its frame up from the roof and the bar across the top
    parts += [box(-0.6, -0.05, 2.8, 0.6, 0.05, 2.86, dark), box(0.5, -0.45, 2.86, 0.56, -0.39, 3.9, dark), box(0.5, 0.39, 2.86, 0.56, 0.45, 3.9, dark), box(0.46, -0.7, 3.88, 0.6, 0.7, 3.94, steel)]
    # the rails in their bed of setts, a tram's length and half as much again each way
    parts.append(box(-11.0, -1.2, 0.0, 11.0, 1.2, 0.03, sett))
    for k in range(44):
        if k % 2:
            parts.append(box(-11.0 + k * 0.5, -1.2, 0.03, -11.0 + k * 0.5 + 0.47, 1.2, 0.034, sett2))
    for y in (-0.74, 0.74):
        parts.append(box(-11.0, y - 0.035, 0.0, 11.0, y + 0.035, 0.07, steel))
    parts.append(blob(7.0, 2.0, dark=0.7))
    return join("tram", parts)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    obs = [postbox(), board(), shoeshine(), dome(), river(), umbrella(), lamp(), tram()]
    if "--preview" in argv:
        for ob, s in zip(obs, (0.55, 0.5, 0.6, 0.03, 0.035, 0.7, 0.28, 0.1)):  # (the preview's camera stands at one distance: each brought to a size it sees)
            ob.scale = (s, s, s)
            ob.location = (0, 0, -0.3)
        preview(argv[argv.index("--preview") + 1], obs)
        return
    path = os.path.join(OUT, "past.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_vertex_color="ACTIVE", export_normals=True,
                              export_materials="EXPORT", export_cameras=False, export_lights=False, export_animations=False, export_texcoords=False)
    compress(path)
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
    print(f"  {os.path.relpath(path, ROOT)}: {os.path.getsize(path) / 1e3:.0f} kB, {tris} triangles")


if __name__ == "__main__":
    main()
