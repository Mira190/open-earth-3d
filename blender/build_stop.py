"""Build what hangs in the air of a stopped world: web/assets/stop/stop.glb (web/game/stopfx.js).

Things a player walks up to at eye height, so they are modelled, not cards:

  ginkgo    a ginkgo leaf: the fan with its notch, cupped, on its stalk; the veins run out from the stalk
  zelkova   a zelkova (keyaki) leaf, the tree of Shibuya's avenues: toothed, folded along its midrib, curled
  bill      a handbill caught by the wind: an A5 sheet, bowed, one corner turned up
  pigeon    a rock dove taking off: the body with its fanned tail, and each wing in two parts (arm and hand,
            pigeon_arm_l/r and pigeon_hand_l/r), each with its origin at its joint, so the page can hold a
            bird at any point of its beat. It faces Blender's -Y (three.js +Z); +X is its left.

Leaves and bill are a unit across (the page sizes them) and lie in the ground plane. The pigeon is life size
in metres. Colour is in the vertices: the leaves' is a pattern near white, which the page tints leaf by leaf.

    blender -b -P blender/build_stop.py                  # or: pip install bpy==5.2.3; python blender/build_stop.py
    blender -b -P blender/build_stop.py -- --preview DIR # also render a still of each into DIR
"""
import math
import os
import sys

import bpy
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from meshopt import compress  # noqa: E402

OUT = os.path.join(ROOT, "web", "assets", "stop")


def lin(c):  # sRGB (0..1) to the linear colour a vertex carries
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hexc(h):
    return np.array([(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255])


def mix(a, b, t):
    t = np.clip(np.asarray(t, float), 0, 1)[..., None]
    return np.asarray(a) * (1 - t) + np.asarray(b) * t


def smooth(e0, e1, x):
    t = np.clip((np.asarray(x, float) - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def grid_faces(nu, nv, wrap=False):
    """Quads of a (nu x nv) grid of vertices laid out row-major; wrap joins the last column to the first."""
    f = []
    for i in range(nu - 1):
        for j in range(nv if wrap else nv - 1):
            a, b = i * nv + j, i * nv + (j + 1) % nv
            f.append((a, b, b + nv, a + nv))
    return f


def make(name, verts, faces, cols, subsurf=0):
    """A mesh object from vertices (n,3), faces and a colour per vertex (sRGB, n,3)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], faces)
    att = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    rgba = np.concatenate([lin(cols), np.ones((len(verts), 1))], axis=1)
    att.data.foreach_set("color", rgba.ravel())
    me.color_attributes.active_color = att
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if subsurf:
        m = ob.modifiers.new("s", "SUBSURF")
        m.levels = subsurf
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=m.name)
    mat = bpy.data.materials.get("stop") or material()
    ob.data.materials.append(mat)
    return ob


def material():
    mat = bpy.data.materials.new("stop")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = "Col"
    nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    mat.use_backface_culling = False
    return mat


def join(name, parts):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    parts[0].name = parts[0].data.name = name
    return parts[0]


# ---- leaves and paper --------------------------------------------------------------------------------------------

def stalk(p0, p1, r, col):
    """A leaf's stalk: a three-sided rod from p0 to p1."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    ax = (p1 - p0) / np.linalg.norm(p1 - p0)
    a = np.cross(ax, [0, 0, 1])
    a /= np.linalg.norm(a)
    b = np.cross(ax, a)
    ring = [a * math.cos(t) * r + b * math.sin(t) * r for t in (0, 2.094, 4.189)]
    v = [p0 + q for q in ring] + [p1 + q * 0.7 for q in ring]
    f = [(i, (i + 1) % 3, 3 + (i + 1) % 3, 3 + i) for i in range(3)] + [(0, 2, 1), (3, 4, 5)]
    return np.array(v), f, np.tile(col, (6, 1))


def ginkgo():
    """The fan: rays from the top of the stalk, the margin wavy and notched in the middle, the blade cupped."""
    na, nr, half = 25, 6, math.radians(80)
    th = np.linspace(-half, half, na)
    t = th / half
    notch = 0.26 * np.exp(-(t / 0.07) ** 2)
    edge = 0.72 * (1 - 0.13 * t ** 2 - notch + 0.022 * np.sin(th * 13) + 0.012 * np.sin(th * 31 + 1))
    V, C = [], []
    gold, base, rim = hexc(0xffffff), hexc(0xc9d28a), hexc(0xe2c79a)
    for i in range(na):
        for j in range(nr):
            u = j / (nr - 1)
            r = 0.02 + (edge[i] - 0.02) * u ** 0.85
            x, y = math.sin(th[i]) * r, math.cos(th[i]) * r
            z = 0.10 * r * r + 0.055 * abs(x) ** 1.5 + 0.02 * math.sin(th[i] * 5) * u * u  # cupped, its lobes lifted, rippled at the margin
            V.append((x, y - 0.36, z))
            c = mix(base, gold, smooth(0.0, 0.45, u))
            c = mix(c, rim, smooth(0.86, 1.0, u) * 0.8)
            C.append(c * (0.93 if i % 2 else 1.0))  # the veins: every ray a shade from its neighbour
    sv, sf, sc = stalk((0, -0.36 + 0.03, 0.0), (0.02, -0.64, 0.035), 0.012, hexc(0xb9bf7c))
    n = len(V)
    return make("ginkgo", np.vstack([V, sv]), grid_faces(na, nr) + [tuple(k + n for k in q) for q in sf], np.vstack([C, sc]))


def zelkova():
    """Ovate, long-pointed and toothed; folded along the midrib and curled from stalk to tip."""
    nl, nw = 23, 7
    V, C = [], []
    blade, rib, rim = hexc(0xffffff), hexc(0xd9c8a8), hexc(0xcbb49a)
    for i in range(nl):
        s = i / (nl - 1)
        w = 0.215 * (math.sin(math.pi * s ** 0.8) ** 0.85) * (1 - 0.25 * s)
        w *= 1.0 if i % 2 else 0.86  # the teeth
        if i in (0, nl - 1):
            w = 0.0
        y = -0.42 + 0.84 * s
        bend = 0.16 * (s - 0.45) ** 2 * 4 * 0.5
        for j in range(nw):
            a = j / (nw - 1) * 2 - 1
            x = a * w
            z = bend + 0.34 * abs(x) + 0.012 * math.sin(s * 44) * abs(a)  # the fold, and a swell between the side veins
            V.append((x + 0.03 * math.sin(s * 2.4), y, z))
            c = mix(blade, rim, smooth(0.75, 1.0, abs(a)) * 0.7)
            c = mix(rib, c, smooth(0.0, 0.3, abs(a)))
            C.append(c * (0.94 if i % 2 else 1.0))  # side veins, one to a tooth
    sv, sf, sc = stalk((0, -0.42, 0.014), (-0.01, -0.5, 0.03), 0.01, hexc(0xb8a280))
    n = len(V)
    return make("zelkova", np.vstack([V, sv]), grid_faces(nl, nw) + [tuple(k + n for k in q) for q in sf], np.vstack([C, sc]))


def bill():
    """An A5 sheet in the wind: bowed across, one corner turned up; a block of colour and lines of grey for its print."""
    nx, ny, w, h = 9, 15, 0.705, 1.0
    V, C = [], []
    paper, ink, block = hexc(0xf2efe6), hexc(0x9c9a94), hexc(0xc8412f)
    for i in range(ny):
        v = i / (ny - 1)
        for j in range(nx):
            u = j / (nx - 1)
            x, y = (u - 0.5) * w, (v - 0.5) * h
            z = 0.10 * math.sin(math.pi * u) * (0.6 + 0.4 * v) + 0.05 * math.sin(v * 3.4 + 0.5)
            k = max(0.0, u + v - 1.45) / 0.55  # the turned-up corner
            z += 0.22 * k * k
            V.append((x, y, z))
            inset = 0.12 < u < 0.88
            c = block if (v > 0.74 and v < 0.93 and inset) else ink if (inset and v < 0.66 and i % 2 == 1 and v > 0.08) else paper
            C.append(c)
    return make("bill", np.array(V), grid_faces(ny, nx), np.array(C))


# ---- the pigeon --------------------------------------------------------------------------------------------------
# Bird space: f forward, x to its left, u up. Blender: (x, -f, u).

GREY, DARK, PALE, BAR = hexc(0x7d8794), hexc(0x4a505c), hexc(0xaab2bd), hexc(0x23262c)
GREEN, PURPLE, WHITE, BEAK = hexc(0x2f6b58), hexc(0x6b3f72), hexc(0xe8e8e4), hexc(0x2a2a2e)


def body():
    # stations along the bird: forward, height of the spine, half width, half height
    st = [(-0.105, 0.004, 0.006, 0.004), (-0.085, 0.002, 0.026, 0.020), (-0.045, -0.004, 0.044, 0.040),
          (-0.005, -0.008, 0.053, 0.051), (0.035, -0.006, 0.055, 0.054), (0.070, 0.004, 0.047, 0.048),
          (0.096, 0.022, 0.032, 0.034), (0.114, 0.042, 0.024, 0.026), (0.130, 0.056, 0.0235, 0.0235),
          (0.146, 0.060, 0.020, 0.020), (0.158, 0.058, 0.011, 0.011), (0.165, 0.056, 0.003, 0.003)]
    seg = 12
    V, C = [], []
    for f, u0, rx, ru in st:
        for k in range(seg):
            a = k / seg * 2 * math.pi
            x, u = math.sin(a) * rx, u0 + math.cos(a) * ru * (1.0 if math.cos(a) > 0 else 1.08)  # fuller below: the breast
            V.append((x, -f, u))
            up = math.cos(a)
            c = mix(GREY, PALE, smooth(0.2, -0.8, up) * 0.55)          # paler under
            c = mix(c, WHITE, smooth(-0.06, -0.09, f) * smooth(0.2, 0.9, up))  # the white rump
            neck = smooth(0.066, 0.086, f) * smooth(0.126, 0.108, f)
            c = mix(c, mix(GREEN, PURPLE, smooth(0.3, -0.5, up)), neck)  # the sheen of the neck: green above, purple at the breast
            c = mix(c, DARK, smooth(0.112, 0.126, f))                    # the head
            C.append(c)
    faces = grid_faces(len(st), seg, wrap=True)
    n = len(V)
    faces += [tuple(range(seg - 1, -1, -1)), tuple(range(n - seg, n))]
    b = make("pigeon", np.array(V), faces, np.array(C), subsurf=1)

    # the bill, with the white cere at its root
    V, C, seg2 = [], [], 6
    for f, u0, r, c in [(0.158, 0.057, 0.0075, WHITE), (0.166, 0.0555, 0.0062, WHITE), (0.172, 0.054, 0.0045, BEAK), (0.186, 0.049, 0.0008, BEAK)]:
        for k in range(seg2):
            a = k / seg2 * 2 * math.pi
            V.append((math.sin(a) * r, -f, u0 + math.cos(a) * r * 0.8))
            C.append(c)
    bk = make("beak", np.array(V), grid_faces(4, seg2, wrap=True) + [tuple(range(18, 24))], np.array(C))

    # an eye each side: orange, as a rock dove's is
    eyes = []
    for sx in (1, -1):
        V = [(sx * 0.0185 + dx * 0.0042, -0.139 + df * 0.0042, 0.0635 + du * 0.0042) for dx, df, du in
             [(1 * sx, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]]
        F = [(0, 1, 3), (0, 3, 2), (0, 2, 4), (0, 4, 1)] if sx > 0 else [(0, 3, 1), (0, 2, 3), (0, 4, 2), (0, 1, 4)]
        eyes.append(make("eye", np.array(V), F, np.tile(hexc(0xd9772b), (5, 1))))

    # the tail, fanned as it is at take-off: twelve feathers, a dark band at their ends
    na, nr, half = 25, 6, math.radians(38)
    V, C = [], []
    for i in range(na):
        th = -half + 2 * half * i / (na - 1)
        scallop = 0.006 * abs(math.sin(i / (na - 1) * math.pi * 6))
        L = 0.118 * (1 - 0.10 * (th / half) ** 2) - scallop
        for j in range(nr):
            s = j / (nr - 1)
            r = 0.012 + L * s
            x, f = math.sin(th) * r, -0.088 - math.cos(th) * r
            u = 0.006 - 0.035 * s * s + 0.012 * math.cos(th / half * math.pi / 2) * (1 - s * 0.4)  # arched across, drooping at the end
            V.append((x, -f, u))
            c = mix(GREY, BAR, smooth(0.62, 0.74, s))
            c = mix(c, GREY, smooth(0.93, 1.0, s) * 0.6)
            C.append(c * (0.95 if (i // 2) % 2 else 1.0))
    tl = make("tail", np.array(V), grid_faces(na, nr), np.array(C))
    return join("pigeon", [b, bk, tl] + eyes)


ARM = 0.115  # shoulder to wrist


def wing_colour(span_all, chord):
    """span_all 0 at the shoulder, 1 at the tip; chord 0 at the leading edge, 1 at the trailing."""
    c = mix(PALE, GREY, smooth(0.0, 0.25, chord) * 0.25)
    bars = (smooth(0.52, 0.57, chord) * smooth(0.70, 0.65, chord) + smooth(0.80, 0.85, chord) * smooth(0.97, 0.93, chord)) * smooth(0.52, 0.40, span_all)
    c = mix(c, BAR, bars)                                                 # the two bars across the secondaries
    c = mix(c, DARK, smooth(0.45, 0.95, span_all) * smooth(0.15, 0.6, chord))  # the primaries darken to their tips
    return c


def wing(side):
    """A wing in two parts, each from its own joint outwards along x (to the bird's left when side is 1)."""
    out = []
    # the arm: shoulder to wrist, the secondaries behind it
    nx, nc = 7, 13
    V, C = [], []
    for i in range(nx):
        s = i / (nx - 1)
        le, te = 0.030 + 0.026 * s, -0.092 + 0.004 * s - 0.004 * abs(math.sin(s * math.pi * 5))
        for j in range(nc):
            t = j / (nc - 1)
            f = le + (te - le) * t
            u = 0.016 * math.sin(math.pi * t ** 0.7) * (1 - 0.3 * s) - 0.006 * t  # cambered
            V.append((side * (s * ARM), -f, u))
            C.append(wing_colour(s * 0.36, t))
    out.append(make("pigeon_arm_" + ("l" if side > 0 else "r"), np.array(V), grid_faces(nx, nc), np.array(C)))
    # the hand: the ten primaries, their ends parted a little
    nx, HAND = 21, 0.205
    V, C = [], []
    for i in range(nx):
        s = i / (nx - 1)
        le = 0.056 - 0.118 * s ** 1.7
        te = -0.088 + 0.026 * s - 0.010 * abs(math.sin(s * math.pi * 10)) * (0.4 + s)
        te = min(te, le - 0.004)
        for j in range(nc):
            t = j / (nc - 1)
            f = le + (te - le) * t
            u = 0.013 * math.sin(math.pi * t ** 0.7) * (1 - s) - 0.006 * t + 0.02 * s * s  # the tips bend up under load
            V.append((side * (s * HAND), -f, u))
            C.append(wing_colour(0.36 + 0.64 * s, t))
    out.append(make("pigeon_hand_" + ("l" if side > 0 else "r"), np.array(V), grid_faces(nx, nc), np.array(C)))
    return out


def pigeon():
    b = body()
    for side in (1, -1):
        arm, hand = wing(side)
        arm.parent, hand.parent = b, arm
        arm.location = (side * 0.036, -0.045, 0.026)  # the shoulder
        hand.location = (side * ARM, 0, 0)            # the wrist
    return b


def preview(folder, obs):
    """A still of each, lit plainly, to look at before it goes in the game."""
    os.makedirs(folder, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in [e.identifier for e in type(sc.render).bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x, sc.render.resolution_y = 1100, 800
    sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.52, 0.56, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (0.7, 0.2, 0.6)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    for ob in obs:
        ob.hide_render = True
        for c in ob.children_recursive:
            c.hide_render = True
    for ob in obs:
        ob.hide_render = False
        for c in ob.children_recursive:
            c.hide_render = False
        d = 0.75 if ob.name == "pigeon" else 2.2
        for name, pos in (("a", (d * 0.7, -d * 0.75, d * 0.55)), ("b", (-d * 0.2, -d * 0.3, d))):
            cam.location = pos
            v = -np.array(pos)
            cam.rotation_euler = (math.atan2(math.hypot(v[0], v[1]), -v[2]), 0, math.atan2(v[0], -v[1]) * -1 + 0)
            cam.rotation_euler = __import__("mathutils").Vector(v).to_track_quat("-Z", "Y").to_euler()
            sc.render.filepath = os.path.join(folder, f"{ob.name}_{name}.png")
            bpy.ops.render.render(write_still=True)
        ob.hide_render = True
        for c in ob.children_recursive:
            c.hide_render = True


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    obs = [ginkgo(), zelkova(), bill(), pigeon()]
    if "--preview" in argv:
        # a wing pose to look at: mid upstroke
        for ob in bpy.data.objects:
            if ob.name.startswith("pigeon_arm"):
                ob.rotation_euler = (0, (-0.6 if ob.name.endswith("l") else 0.6), 0)
            if ob.name.startswith("pigeon_hand"):
                ob.rotation_euler = (0, (0.35 if ob.name.endswith("l") else -0.35), 0)
        preview(argv[argv.index("--preview") + 1], obs)
        return
    path = os.path.join(OUT, "stop.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_vertex_color="ACTIVE", export_normals=True,
                              export_materials="EXPORT", export_cameras=False, export_lights=False, export_animations=False, export_texcoords=False)
    compress(path)
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
    print(f"  {os.path.relpath(path, ROOT)}: {os.path.getsize(path) / 1e3:.0f} kB, {tris} triangles")


if __name__ == "__main__":
    main()
