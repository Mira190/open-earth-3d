"""The Akita who walks: web/assets/animals/akita.glb, a dog a story can give the player as a guide
(web/game/companion.js). He is the dog the bronze on Hachiko Square is of: his head is the statue's own sculpt
(cities/shibuya/hachiko.py head(): broad skull, short blunt muzzle, the left ear bent forward as it was in
life), on a standing body sculpted the same way (pipeline/sculptkit.py), then rigged and given his clips here.

Sizes: a male Akita Inu stands 64 to 70 cm at the withers (the Japan Kennel Club's standard: 67 cm, 3 cm either
way) and is a little longer than tall (10:11); Hachiko himself was measured at 64 cm and 41 kg. This one stands
0.65 m at the withers and 0.72 m from breast to rump, his tail curled over his back.

Coat: red fawn over the back, the outer legs and the skull, with urajiro (the standard's word: whitish fur) on the
sides of the muzzle, the cheeks, under the jaw and neck, the chest, the belly, the inside and the lower half of
the legs and the underside of the tail. Hachiko's coat was a pale cream fawn (his mounted hide is in the National
Museum of Nature and Science, Ueno); the fawn here is kept light for that.

Clips, all on the spot (the page moves him): `idle` (standing, the tail moving), `walk` (a four-beat walk at
WALK_SPEED), `trot` (diagonal pairs at TROT_SPEED) and `sit` (as the statue sits). The legs are placed by
inverse kinematics in his sagittal plane, so a paw on the ground stays on it and travels back at the clip's speed.

    pip install bpy==5.2.3
    python blender/build_dog.py            # -> web/assets/animals/akita.glb (meshopt-compressed)
"""
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
sys.path.insert(0, os.path.join(ROOT, "cities", "shibuya"))
import sculptkit as sk  # noqa: E402
import hachiko as statue  # noqa: E402  (his head)

OUT = os.path.join(ROOT, "web", "assets", "animals", "akita.glb")
CELL = 0.011          # the sculpt's grid
FPS = 30
WALK_SPEED, WALK_T = 0.95, 0.74      # m/s over the ground, and one stride's seconds
TROT_SPEED, TROT_T = 2.3, 0.44
HEAD_AT = (0.47, 0.0, 0.83)          # the middle of his skull, standing
LEG_Y, HIND_Y = 0.10, 0.11

# the joints, standing: (x forward, z up) in his sagittal plane; metres
HIPS = (-0.25, 0.46)
CHEST = (0.20, 0.50)
NECK0, NECK1, NOSE = (0.24, 0.56), (0.40, 0.78), (0.62, 0.80)
TAIL0, TAIL1, TAIL2 = (-0.40, 0.56), (-0.45, 0.70), (-0.33, 0.79)
SHOULDER, ELBOW, WRIST = (0.22, 0.46), (0.22, 0.25), (0.22, 0.04)
HIP, STIFLE, HOCK, TOE = (-0.25, 0.44), (-0.20, 0.30), (-0.33, 0.16), (-0.30, 0.03)


def body():
    """The dog standing, as a signed distance field: x forward, y to his left, z up from the ground."""
    L = sk.mirror_v
    chest = sk.ellipsoid((0.19, 0.0, 0.50), (0.20, 0.16, 0.185))
    trunk = sk.capsule((0.16, 0.0, 0.51), (-0.24, 0.0, 0.50), 0.162, 0.14)
    rump = sk.ellipsoid((-0.27, 0.0, 0.49), (0.155, 0.148, 0.158))
    withers = sk.ellipsoid((0.17, 0.0, 0.60), (0.12, 0.10, 0.07))
    neck = sk.capsule((0.24, 0.0, 0.57), (0.41, 0.0, 0.79), 0.138, 0.115)
    ruff = sk.ellipsoid((0.33, 0.0, 0.64), (0.10, 0.12, 0.12))
    shoulders = L(sk.ellipsoid((0.21, LEG_Y, 0.47), (0.085, 0.065, 0.14)))
    upper_f = L(sk.capsule((0.22, LEG_Y, 0.44), (0.22, LEG_Y, 0.25), 0.064, 0.05))
    lower_f = L(sk.capsule((0.22, LEG_Y, 0.25), (0.22, LEG_Y, 0.07), 0.05, 0.043))
    paws_f = L(sk.ellipsoid((0.245, LEG_Y, 0.032), (0.062, 0.046, 0.032)))
    thighs = L(sk.ellipsoid((-0.25, HIND_Y, 0.40), (0.125, 0.078, 0.155)))
    shanks = L(sk.capsule((-0.21, HIND_Y, 0.31), (-0.33, HIND_Y, 0.165), 0.062, 0.04))
    hocks = L(sk.capsule((-0.33, HIND_Y, 0.165), (-0.315, HIND_Y, 0.06), 0.039, 0.036))
    paws_h = L(sk.ellipsoid((-0.285, HIND_Y, 0.03), (0.06, 0.044, 0.03)))
    tail = sk.path([(-0.39, 0.0, 0.55), (-0.46, 0.0, 0.66), (-0.44, 0.02, 0.77), (-0.35, 0.05, 0.82), (-0.26, 0.07, 0.78), (-0.25, 0.08, 0.70), (-0.30, 0.07, 0.66)],
                   [0.055, 0.062, 0.064, 0.062, 0.056, 0.046, 0.034])
    head = statue.posed(statue.head(), HEAD_AT, 0.0, -4.0)
    eyes = statue.posed(sk.mirror_v(sk.ellipsoid((0.093, 0.057, 0.009), (0.013, 0.015, 0.013))), HEAD_AT, 0.0, -4.0)
    b = sk.smooth_union(0.05, chest, trunk, rump, withers, neck, ruff, shoulders, thighs)
    legs = sk.smooth_union(0.025, upper_f, lower_f, paws_f, shanks, hocks, paws_h)
    d = sk.smooth_union(0.035, b, legs)
    d = sk.smooth_union(0.045, d, head)
    d = sk.smooth_union(0.03, d, tail)
    d = sk.roughen(d, 0.0025, 0.016, seed=1923)   # (the coat's lie: thick fur is never a smooth skin)
    return sk.union(d, eyes)


def coat(v, n):
    """Each vertex's colour (linear RGB): red fawn, the urajiro, the black of the nose, the eyes and the lips."""
    s = lambda x, a, b: np.clip((x - a) / (b - a), 0.0, 1.0) ** 2 * (3 - 2 * np.clip((x - a) / (b - a), 0.0, 1.0))
    x, y, z = v[:, 0], v[:, 1], v[:, 2]
    # the head's own frame (hachiko.posed: yaw 0, pitch -4)
    cp, sp = math.cos(math.radians(-4.0)), math.sin(math.radians(-4.0))
    hx0, hz0 = x - HEAD_AT[0], z - HEAD_AT[2]
    hx, hz, hy = hx0 * cp + hz0 * sp, -hx0 * sp + hz0 * cp, y
    on_head = s(x, 0.36, 0.42)
    on_tail = (x < -0.3) & (z > 0.56)
    white = np.maximum.reduce([
        s(-n[:, 2], 0.15, 0.6) * (1 - on_head),                       # whatever faces the ground: belly, brisket, under the tail
        (1 - s(z, 0.2, 0.31)) * (1 - on_tail),                        # the legs' lower half
        s(x, 0.27, 0.36) * (1 - s(z, 0.5, 0.62)) * (1 - on_head),     # the breast
        s(np.abs(y) * 0 + (0.105 - np.abs(np.abs(y) - 0.02)), 0.0, 0.03) * (1 - s(z, 0.3, 0.42)) * (np.abs(y) < 0.085),  # the legs' inner faces
        on_head * s(hx, 0.02, 0.07) * (1 - s(hz, -0.03, 0.0)),        # the muzzle's sides and the cheeks
        on_head * (1 - s(hz, -0.085, -0.05)),                         # under the jaw
    ])
    red = np.array([0.46, 0.27, 0.125])
    cream = np.array([0.80, 0.72, 0.58])
    c = red[None] * (1 - white[:, None]) + cream[None] * white[:, None]
    c *= (0.9 + 0.1 * s(n[:, 2], -0.2, 0.8))[:, None]                 # (a touch deeper where the coat turns under)
    dark = np.array([0.012, 0.01, 0.01])
    nose = on_head * (1 - s(np.sqrt((hx - 0.238) ** 2 + hy ** 2 + (hz + 0.035) ** 2), 0.024, 0.034))
    eye = np.zeros(len(v))
    for sg in (-1, 1):
        eye = np.maximum(eye, 1 - s(np.sqrt((hx - 0.093) ** 2 + (hy - sg * 0.057) ** 2 + (hz - 0.009) ** 2), 0.016, 0.022))
    lips = on_head * (1 - s(np.abs(hz + 0.08), 0.004, 0.009)) * s(hx, 0.11, 0.14) * (1 - s(np.abs(hy), 0.03, 0.05))
    k = np.maximum.reduce([nose, eye * on_head, lips * 0.8])
    c = c * (1 - k[:, None]) + dark[None] * k[:, None]
    gloss = np.maximum(nose, eye * on_head)
    return c, gloss


# ------------------------------------------------------------------ the poses
def rot2(p, a):
    c, s = math.cos(a), math.sin(a)
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c)


def add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def ang(v):
    return math.atan2(v[1], v[0])


def wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


def ik(root, target, l1, l2, knee_forward):
    """Two bones from root to target in the plane: the angles of the first and of the second."""
    d = sub(target, root)
    L = max(abs(l1 - l2) + 1e-3, min(l1 + l2 - 1e-4, math.hypot(*d)))
    base = ang(d)
    a = math.acos(max(-1.0, min(1.0, (l1 * l1 + L * L - l2 * l2) / (2 * l1 * L))))
    best = None
    for sgn in (1, -1):
        a1 = base + sgn * a
        knee = add(root, (l1 * math.cos(a1), l1 * math.sin(a1)))
        end = add(root, (L * math.cos(base), L * math.sin(base)))
        side = (knee[0] - (root[0] + end[0]) / 2)
        if best is None or (side > best[0]) == knee_forward:
            best = (side, a1, ang(sub(end, knee)))
    return best[1], best[2]


L_UP, L_LO = math.dist(SHOULDER, ELBOW), math.dist(ELBOW, WRIST)
L_TH, L_SH = math.dist(HIP, STIFLE), math.dist(STIFLE, HOCK)
FOOT = sub(TOE, HOCK)


def pose(root=(0.0, 0.0), pitch=0.0, fore=((0, 0), (0, 0)), hind=((0, 0), (0, 0)), foot=(0.0, 0.0), neck=0.0, head=0.0, tail=0.0, wag=0.0, head_yaw=0.0):
    """One frame: each bone's turn from standing, in the sagittal plane (radians, nose up), and the hips' move.
    root: the hips' offset; pitch: the trunk's; fore, hind: each paw's offset from where it stands (left, right);
    foot: each hind foot's turn (toe down negative); neck, head: turns over the trunk's; tail: the tail's lift;
    wag: its swing to his left; head_yaw: the head's turn to his left."""
    hips = add(HIPS, root)
    at = lambda j: add(hips, rot2(sub(j, HIPS), pitch))
    out = {"hips": pitch, "spine": pitch, "neck": pitch + neck, "head": pitch + neck + head, "tail1": pitch + tail, "tail2": pitch + tail * 1.5}
    for i, side in enumerate("LR"):
        a1, a2 = ik(at(SHOULDER), add(WRIST, fore[i]), L_UP, L_LO, knee_forward=False)
        out["upper_f." + side] = wrap(a1 - ang(sub(ELBOW, SHOULDER)))
        out["lower_f." + side] = wrap(a2 - ang(sub(WRIST, ELBOW)))
        toe = add(TOE, hind[i])
        hock = sub(toe, rot2(FOOT, foot[i]))
        a1, a2 = ik(at(HIP), hock, L_TH, L_SH, knee_forward=True)
        out["thigh." + side] = wrap(a1 - ang(sub(STIFLE, HIP)))
        out["shank." + side] = wrap(a2 - ang(sub(HOCK, STIFLE)))
        out["foot." + side] = foot[i]
    return {"root": root, "turn": out, "wag": wag, "head_yaw": head_yaw}


def step(u, duty, sweep, lift):
    """A paw's offset through one stride (u in 0..1): on the ground travelling back, then lifted forward."""
    u %= 1.0
    if u < duty:
        return (sweep * (0.5 - u / duty), 0.0)
    w = (u - duty) / (1 - duty)
    e = w * w * (3 - 2 * w)
    return (sweep * (-0.5 + e), lift * math.sin(math.pi * w) ** 1.2)


def toe_turn(u, duty, amount):
    """The hind foot's turn through the stride: the toe trails as it leaves the ground."""
    u %= 1.0
    if u < duty:
        return -amount * 0.5 * max(0.0, (u / duty - 0.6) / 0.4)
    w = (u - duty) / (1 - duty)
    return -amount * (0.5 + 0.5 * math.sin(math.pi * w)) * (1 - w)


def clip_gait(T, speed, duty, phases, lift, drop, bob, nod):
    """A walking clip's frames: phases (LF, RF, LH, RH)."""
    n = int(round(T * FPS))
    sweep = speed * T * duty
    frames = []
    for f in range(n):
        u = f / n
        lf, rf, lh, rh = (step(u + p, duty, sweep, lift) for p in phases)
        w = 2 * math.pi * u
        frames.append(pose(root=(0.0, -drop + bob * math.cos(2 * w)), pitch=math.radians(0.8) * math.sin(2 * w + 0.6),
                           fore=(lf, rf), hind=(add(lh, (0.02, 0)), add(rh, (0.02, 0))), foot=(toe_turn(u + phases[2], duty, 0.9), toe_turn(u + phases[3], duty, 0.9)),
                           neck=math.radians(nod) * math.sin(2 * w + 1.2) - math.radians(4), head=math.radians(3) + math.radians(nod * 0.5) * math.sin(2 * w + 2.0),
                           tail=math.radians(2) * math.sin(2 * w), wag=math.radians(5) * math.sin(w)))
    return frames


def clip_idle(T=2.0):
    n = int(round(T * FPS))
    out = []
    for f in range(n):
        w = 2 * math.pi * f / n
        out.append(pose(root=(0.0, -0.006 + 0.003 * math.sin(w)), pitch=math.radians(0.4) * math.sin(w), neck=math.radians(1.2) * math.sin(w + 0.8),
                        head=math.radians(1.0) * math.sin(w + 1.6), wag=math.radians(10) * math.sin(2 * w), tail=math.radians(1.5) * math.sin(w)))
    return out


def clip_sit(T=2.4):
    """As the statue sits: on his haunches, the forelegs long and straight under his chest, his head up."""
    n = int(round(T * FPS))
    out = []
    P = math.radians(33)
    for f in range(n):
        w = 2 * math.pi * f / n
        br = math.sin(w)
        out.append(pose(root=(-0.02, -0.30 + 0.002 * br), pitch=P + math.radians(0.5) * br, fore=((-0.07, 0.0), (-0.07, 0.0)), hind=((0.24, 0.0), (0.24, 0.0)),
                        foot=(ang((1.0, -0.06)) - ang(FOOT), ang((1.0, -0.06)) - ang(FOOT)), neck=-math.radians(17) + math.radians(1) * br, head=-math.radians(14),
                        tail=-math.radians(8), wag=math.radians(7) * math.sin(w)))
    return out


CLIPS = {
    "idle": clip_idle,
    "walk": lambda: clip_gait(WALK_T, WALK_SPEED, 0.62, (0.5, 0.0, 0.25, 0.75), 0.05, 0.022, 0.004, 2.5),
    "trot": lambda: clip_gait(TROT_T, TROT_SPEED, 0.44, (0.0, 0.5, 0.5, 0.0), 0.075, 0.03, 0.012, 1.5),
    "sit": clip_sit,
}

BONES = [  # name, head, tail (x, z), y, parent
    ("hips", HIPS, (HIPS[0] + 0.12, HIPS[1]), 0.0, None),
    ("spine", (HIPS[0] + 0.12, HIPS[1]), CHEST, 0.0, "hips"),
    ("neck", NECK0, NECK1, 0.0, "spine"),
    ("head", NECK1, NOSE, 0.0, "neck"),
    ("tail1", TAIL0, TAIL1, 0.0, "hips"),
    ("tail2", TAIL1, TAIL2, 0.03, "tail1"),
] + [b for side, sg in (("L", 1), ("R", -1)) for b in [
    ("upper_f." + side, SHOULDER, ELBOW, sg * LEG_Y, "spine"),
    ("lower_f." + side, ELBOW, WRIST, sg * LEG_Y, "upper_f." + side),
    ("thigh." + side, HIP, STIFLE, sg * HIND_Y, "hips"),
    ("shank." + side, STIFLE, HOCK, sg * HIND_Y, "thigh." + side),
    ("foot." + side, HOCK, TOE, sg * HIND_Y, "shank." + side),
]]


def main():
    import bpy
    from mathutils import Matrix, Vector

    print("sculpting ...")
    v, t = sk.mesh(body(), (-0.56, -0.24, -0.02), (0.76, 0.24, 1.02), CELL)
    v = sk.relax(v, t, 0.45, 2)
    v[:, 2] -= v[:, 2].min()   # (his paws on the ground)
    fn = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    vn = np.zeros_like(v)
    for k in range(3):
        np.add.at(vn, t[:, k], fn)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
    col, gloss = coat(v, vn)
    print(f"  {len(v)} vertices, {len(t)} triangles; {v[:, 2].max():.3f} m to his ears, {v[:, 0].max() - v[:, 0].min():.3f} m long")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    me = bpy.data.meshes.new("Akita")
    me.from_pydata(v.tolist(), [], t.tolist())
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ca = me.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", np.c_[col, 1 - 0.55 * gloss].ravel().tolist())   # (alpha: the roughness, lower on the nose and the eyes)
    ob = bpy.data.objects.new("Akita", me)
    bpy.context.scene.collection.objects.link(ob)

    mat = bpy.data.materials.new("Coat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    attr = mat.node_tree.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Color"
    mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.86
    bsdf.inputs["Metallic"].default_value = 0.0
    me.materials.append(mat)

    arm = bpy.data.armatures.new("AkitaRig")
    rig = bpy.data.objects.new("AkitaRig", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, h, tl, y, parent in BONES:
        b = arm.edit_bones.new(name)
        b.head, b.tail = (h[0], y, h[1]), (tl[0], y, tl[1])
        b.roll = 0.0
        if parent:
            b.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")

    # the skin: Blender's own weights from the bones' heat
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    W = np.zeros((len(v), len(BONES)))
    names = [g.name for g in ob.vertex_groups]
    for vert in me.vertices:
        for g in vert.groups:
            W[vert.index, [b[0] for b in BONES].index(names[g.group])] = g.weight
    lost = int((W.sum(1) < 1e-6).sum())
    print(f"  weights: {lost} vertices without a bone")
    if lost > len(v) * 0.01:
        raise SystemExit("the automatic weights failed")
    # a side's leg is never moved by the other side's bones (the heat crosses between legs that stand close)
    for j, (name, *_rest) in enumerate(BONES):
        if name.endswith(".L") or name.endswith(".R"):
            wrong = (v[:, 1] < -0.012) if name.endswith(".L") else (v[:, 1] > 0.012)
            g = ob.vertex_groups[name]
            idx = np.nonzero(wrong & (W[:, j] > 0))[0]
            if len(idx):
                g.remove(idx.tolist())
    # the head is one piece: its skull, ears and muzzle turn together
    hd = np.nonzero(v[:, 0] > HEAD_AT[0] - 0.06 + (0.80 - v[:, 2]) * 0.6)[0]
    for g in ob.vertex_groups:
        if g.name != "head":
            g.remove(hd.tolist())
    ob.vertex_groups["head"].add(hd.tolist(), 1.0, "REPLACE")
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.ops.object.vertex_group_limit_total(limit=4)

    # the clips
    rest = {b.name: b.matrix_local.to_3x3() for b in arm.bones}
    parent = {b[0]: b[4] for b in BONES}
    rig.animation_data_create()
    roty = lambda a: Matrix.Rotation(-a, 3, "Y")   # (nose up, in the plane x forward, z up)
    rotz = lambda a: Matrix.Rotation(a, 3, "Z")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    for cname, make in CLIPS.items():
        frames = make()
        act = bpy.data.actions.new(cname)
        rig.animation_data.action = act
        last = {}
        for f, fr in enumerate(frames + frames[:1]):   # (the first frame again at the end: the loop closes)
            D = {}
            for name, *_r in BONES:
                d = roty(fr["turn"][name])
                if name.startswith("tail"):
                    d = rotz(fr["wag"] * (1.0 if name == "tail1" else 1.6)) @ d
                if name == "head":
                    d = rotz(fr["head_yaw"]) @ d
                D[name] = d
            for name, *_r in BONES:
                pb = rig.pose.bones[name]
                R = rest[name]
                Dp = D[parent[name]] if parent[name] else Matrix.Identity(3)
                q = (R.inverted() @ Dp.inverted() @ D[name] @ R).to_quaternion()
                if name in last and last[name].dot(q) < 0:
                    q.negate()
                last[name] = q.copy()
                pb.rotation_quaternion = q
                pb.keyframe_insert("rotation_quaternion", frame=f)
                if name == "hips":
                    pb.location = R.inverted() @ Vector((fr["root"][0], 0.0, fr["root"][1]))
                    pb.keyframe_insert("location", frame=f)
        rig.animation_data.action = None
        tr = rig.animation_data.nla_tracks.new()
        tr.name = cname
        tr.strips.new(cname, 0, act)
        print(f"  clip {cname}: {len(frames)} frames")
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)

    bpy.context.scene.render.fps = FPS
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_skins=True, export_animations=True,
                              export_animation_mode="NLA_TRACKS", export_optimize_animation_size=True, export_vertex_color="ACTIVE",
                              export_all_vertex_colors=False, export_materials="EXPORT", export_morph=False, export_yup=True)
    raw = os.path.getsize(OUT)
    import meshopt
    meshopt.compress(OUT)
    print(f"wrote {os.path.relpath(OUT, ROOT)}: {raw / 1024:.0f} kB, {os.path.getsize(OUT) / 1024:.0f} kB compressed")


if __name__ == "__main__":
    main()
