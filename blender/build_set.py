"""Build the story's own set dressing for tonight: web/assets/story/set.glb (web/game/past.js draws it, a story
episode's `set` places it).

  lift      the lift's doors at the back of its lobby: a stone wall, a steel portal with its two leaves shut on a line
            of light, the floor indicator over them with its arrow, the lift's name in lit letters over that, the call
            plate, a mat with a lit edge, two posts and a rope, and the lobby's downlights
  skysign   the same name in larger lit letters with an arrow, for over the lobby's opening on the street

Life size in metres; each stands at its origin on the floor and faces -Y (the way you come to it), +Z up. Colour is
in the vertices; the page lights them itself, so a letter that is meant to be lit is simply bright.

    blender -b -P blender/build_set.py                  # or: pip install bpy==5.2.3; python blender/build_set.py
    blender -b -P blender/build_set.py -- --preview DIR # also render a still of each into DIR
"""
import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_past import blob, box, lathe  # noqa: E402
from build_stop import ROOT, compress, hexc, join, make, preview  # noqa: E402

OUT = os.path.join(ROOT, "web", "assets", "story")


def text(body, size, at, col, depth=0.012, name="text"):
    """Letters standing on the wall plane, facing -Y: Blender's own face, turned from a curve into a mesh."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.size, cu.extrude, cu.align_x, cu.align_y = body, size, depth, "CENTER", "BOTTOM"
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    V = np.array([v.co[:] for v in me.vertices], float)
    F = [tuple(p.vertices) for p in me.polygons]
    bpy.data.objects.remove(ob)
    V = np.c_[V[:, 0] + at[0], -V[:, 2] + at[1], V[:, 1] + at[2]]  # (written in x-y, stood up into x-z)
    out = make(name, V, F, np.tile(col, (len(V), 1)))
    for p in out.data.polygons:
        p.use_smooth = False
    return out


def arrow(x, z, s, col, y=-0.02):
    """An up arrow: a head and a stem."""
    V = np.array([(x - s, y, z), (x + s, y, z), (x, y, z + s * 1.1), (x - s * 0.32, y, z - s * 0.9), (x + s * 0.32, y, z - s * 0.9), (x + s * 0.32, y, z), (x - s * 0.32, y, z)])
    ob = make("arrow", V, [(0, 1, 2), (3, 4, 5, 6)], np.tile(col, (7, 1)))
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def lift():
    stone, steel, leaf, dark, lit, amber, mat, rope = (hexc(h) for h in (0x2b2f36, 0xc3c8ce, 0x9aa0a8, 0x101216, 0xfff3d2, 0xffb45a, 0x1b1d22, 0x8a2f2a))
    parts = [box(-2.9, 0.0, 0.0, 2.9, 0.14, 3.3, stone, "lift")]
    # the portal: jambs and lintel proud of the wall, the two leaves in it, shut on a line of light
    parts += [box(-1.22, -0.2, 0.0, -1.06, 0.02, 2.44, steel), box(1.06, -0.2, 0.0, 1.22, 0.02, 2.44, steel), box(-1.22, -0.2, 2.3, 1.22, 0.02, 2.44, steel)]
    parts += [box(-1.06, -0.08, 0.0, -0.012, -0.03, 2.3, leaf), box(0.012, -0.08, 0.0, 1.06, -0.03, 2.3, leaf), box(-0.012, -0.06, 0.0, 0.012, -0.04, 2.3, lit)]
    for x in (-0.54, 0.54):  # a kick plate and a rail on each leaf
        parts += [box(x - 0.48, -0.085, 0.0, x + 0.48, -0.08, 0.22, steel), box(x - 0.4, -0.11, 1.02, x + 0.4, -0.085, 1.06, steel)]
    # over the doors: the indicator (an arrow and the floor it goes to), and over that the lift's name, lit
    parts += [box(-0.5, -0.03, 2.52, 0.5, 0.0, 2.78, dark), arrow(-0.3, 2.65, 0.075, amber, y=-0.035), text("46F", 0.15, (0.12, -0.035, 2.575), amber)]
    parts += [box(-2.3, -0.03, 2.88, 2.3, 0.0, 3.26, dark), text("SHIBUYA SKY", 0.25, (0.0, -0.035, 2.95), lit, depth=0.02)]
    # the call plate, its button a ring of light
    parts += [box(1.4, -0.03, 1.0, 1.56, 0.0, 1.32, steel), lathe([(0.03, 0.0, amber), (0.03, 0.012, amber), (0.0, 0.013, lit)], seg=12)]
    b = parts.pop()
    b.rotation_euler = (math.pi / 2, 0, 0)
    b.location = (1.48, -0.03, 1.16)
    bpy.context.view_layer.objects.active = b
    bpy.ops.object.select_all(action="DESELECT")
    b.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True)
    parts.append(b)
    # the way to it: a mat with a lit edge, two posts and the rope between them and the wall
    parts += [box(-1.25, -2.4, 0.0, 1.25, -0.2, 0.02, mat), box(-1.25, -2.46, 0.0, 1.25, -2.4, 0.03, amber)]
    for x in (-1.5, 1.5):
        parts.append(lathe([(0.16, 0.0, steel), (0.16, 0.03, steel), (0.025, 0.05, steel), (0.025, 0.92, steel), (0.045, 0.94, steel), (0.045, 0.99, steel), (0.0, 1.0, steel)], seg=12, at=(x, -2.2, 0)))
        for k in range(6):  # the rope, sagging from the post back to the wall
            t0, t1 = k / 6, (k + 1) / 6
            sag = lambda t: 0.9 - 0.22 * math.sin(math.pi * t)
            parts.append(box(x - 0.018, -2.2 + t0 * 2.0, sag(t0) - 0.018, x + 0.018, -2.2 + t1 * 2.0, sag(t0) + 0.018, rope))
    # the lobby's downlights, in the ceiling over the mat
    for x in (-1.6, 0.0, 1.6):
        for y in (-0.9, -2.6):
            parts.append(lathe([(0.0, 3.28, lit), (0.14, 3.28, lit), (0.16, 3.3, steel)], seg=14, at=(x, y, 0)))
    parts.append(blob(2.6, 1.6, at=(0, -1.3), dark=0.35))
    return join("lift", parts)


def skysign():
    dark, lit, amber = hexc(0x101216), hexc(0xfff3d2), hexc(0xffb45a)
    return join("skysign", [box(-3.6, 0.0, 0.0, 3.6, 0.12, 1.1, dark, "skysign"), text("SHIBUYA SKY", 0.62, (0.5, -0.03, 0.25), lit, depth=0.04), arrow(-3.0, 0.58, 0.26, amber, y=-0.04)])


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    obs = [lift(), skysign()]
    if "--preview" in argv:
        for ob, s in zip(obs, (0.3, 0.2)):
            ob.scale = (s, s, s)
            ob.location = (0, 0, -0.4)
        preview(argv[argv.index("--preview") + 1], obs)
        return
    path = os.path.join(OUT, "set.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_vertex_color="ACTIVE", export_normals=True,
                              export_materials="EXPORT", export_cameras=False, export_lights=False, export_animations=False, export_texcoords=False)
    compress(path)
    print(f"  {os.path.relpath(path, ROOT)}: {os.path.getsize(path) / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
