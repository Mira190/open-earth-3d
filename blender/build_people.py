"""The game's main characters (the surveyors you play), from Microsoft Rocketbox (MIT): its
avatars, made by artists and rigged on a 3ds Max Biped, with its motion-captured clips on the
same skeleton. Each clip is copied onto the avatar bone by bone in world space (the avatars'
bind pose and the clips' rest pose differ, so local rotations would not carry over), with the
walk, run and sprint kept in place and their ground speed read from the clip's own extracted
root motion. Textures are shrunk and written as WebP inside one glTF binary per character.

The NPCs (--npcs) are Rocketbox avatars too: every R_<avatar>[_<head>][_<tag>...] character a
city's game.npcs names (pipeline/fetch_rocketbox.py, npc_cast). An avatar can wear another
avatar's head (by its model code: R_Pilot_Female_01_f003 is the pilot with Female_Adult_03's
head; every avatar of a sex has the same skeleton, so a head fits any body), and tags retouch
it: HAIR recolours the hair, CLOTH the clothes, PATTERN prints a pattern over the top, "bare"
takes off a hat or helmet, "plain" covers lettering and badges (INSIGNIA); a swapped head's
skin tone carries to the hands. The NPCs carry no clips of their own: one file per sex
(R_clips_f.glb, R_clips_m.glb) holds the gestures and what each NPC does while it waits
(NPC_CLIPS, city.json look.clip), and drives them all.

    pip install bpy==5.2.3                       # Blender as a Python module
    python pipeline/fetch_rocketbox.py           # the avatars and clips, into data/raw/rocketbox (once)
    python blender/build_people.py --preview     # -> web/assets/people/H_*.glb, docs/images/people/
    python blender/build_people.py --npcs        # -> web/assets/people/R_*.glb (--only R_... for some)

Rocketbox is (c) 2020 Microsoft under the MIT licence; web/assets/people/LICENSE-Rocketbox.txt
carries its notice.
"""
import argparse
import glob
import json
import math
import os
import re
import struct
import sys

import bpy
import numpy as np
from mathutils import Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RB = os.path.join(ROOT, "data", "raw", "rocketbox", "Assets")
FPS = 30
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
from fetch_rocketbox import npc_cast  # noqa: E402  (the cities' NPC characters; no bpy there)

# the game's clip name -> the Rocketbox clip (f_ or m_ prefixed by the avatar's sex) and its folder:
# 'static' clips stand in place, 'xy' clips carry their root motion on a separate helper. The game
# runs at 4.5 m/s and sprints at 7, so both use the 5.4 m/s fast run (the 2.8 m/s jog would race)
CLIPS = {"Idle": ("idle_neutral_01", "static"), "Idle_Neutral": ("idle_neutral_02", "static"),
         "Walk": ("walk_neutral_01", "xy"), "Run": ("run_fast_01", "xy"), "Sprint": ("run_fast_01", "xy"),
         "Wave": ("wave_01", "static"), "Talk": ("gestic_talk_neutral_01", "static"),
         "Listen": ("gestic_listen_neutral_01", "static"), "Nod": ("gestic_listen_accept_01", "static"),
         "Interact": ("documents_check", "static")}
LOOPS = {"Idle", "Idle_Neutral", "Walk", "Run", "Sprint", "Talk", "Listen"}
MAX_FRAMES = 12 * FPS
LOOP_BLEND = 24   # frames

CHARACTERS = {
    "H_Surveyor_W": {"label": "Surveyor (woman)", "avatar": "Professions/Construction_Female_01", "sex": "f"},
    "H_Surveyor_M": {"label": "Surveyor (man)", "avatar": "Professions/Construction_Male_08", "sex": "m"},
}

# the NPCs' clips: the main characters' gestures (NPC_BASE, in every NPC's file), and what an NPC
# does while it waits (city.json look.clip; in a sex's file when one of its NPCs uses it)
NPC_CLIPS = {"Idle": ("idle_neutral_01", "static"), "Idle_Neutral": ("idle_neutral_02", "static"),
             "Walk": ("walk_neutral_01", "xy"), "Wave": ("wave_01", "static"), "Talk": ("gestic_talk_neutral_01", "static"),
             "Listen": ("gestic_listen_neutral_01", "static"), "Nod": ("gestic_listen_accept_01", "static"),
             "Documents": ("documents_note", "static"), "Reading": ("documents_check", "static"),
             "Phone": ("cell_phone_textmessage", "static"), "Photo": ("take_picture", "static"), "Work": ("work_mid", "static"),
             "Drink": ("drink_idle", "static"), "Stretch": ("idle_stretch_arms_01", "static"),
             "Present": ("gestic_presentation_left_01", "static"), "Cheer": ("cheer_01", "static"),
             "LookAround": ("idle_look_around_01", "static"), "Thoughtful": ("gestic_thoughtful_01", "static")}
NPC_BASE = ["Idle", "Idle_Neutral", "Walk", "Wave", "Talk", "Listen", "Nod"]
LOOPS |= set(NPC_CLIPS) - {"Wave", "Nod"}   # what an NPC does while it waits goes round and round
# hair tags: the colour the hair (and the brows) takes, in sRGB
HAIR = {"grey": (0.60, 0.60, 0.62), "white": (0.80, 0.80, 0.80), "brown": (0.33, 0.19, 0.10)}
# cloth tags: light, unsaturated cloth (a white shirt or robe) dyed this colour
CLOTH = {"dark": (0.085, 0.085, 0.095), "navy": (0.07, 0.09, 0.17)}
# the "plain" tag: lettering and badges that say who the avatar was (SECURITY, PARAMEDIC, another
# country's flag), and any weapon, go. The badges by texture: boxes (x0, y0, x1, y1, from the top left, as a fraction of the
# texture) each covered with the cloth (dx, dy) beside it
INSIGNIA = {
    "m220_body_color.tga": [(0.095, 0.490, 0.185, 0.550, 0, 0.065), (0.812, 0.490, 0.888, 0.565, 0, 0.08)],   # Police_Male_01's sleeves
    "f170_body_color.tga": [(0.410, 0.222, 0.565, 0.282, 0, -0.065), (0.372, 0.458, 0.442, 0.503, 0, -0.046)],   # Security_Female_01
    "f170_hat_color.tga": [(0.515, 0.745, 0.685, 0.840, 0, -0.1)],
    "f154_body_color_blue.tga": [(0.382, 0.262, 0.608, 0.342, 0, -0.08), (0.545, 0.478, 0.615, 0.555, 0.07, 0),   # Medical_Female_03
                                 (0.820, 0.507, 0.893, 0.593, -0.08, 0)],
}
WEAPON = re.compile(r"_(pistol|shotgun|machinegun|combat_knife)$")   # what "plain" also takes off
# pattern tags: printed over the top (the shirt, jumper or cardigan), as people.js paints the old
# characters' (PAT_GLSL), from where each texel is on the body in the bind pose: three.js model
# space, metres, y up, z forward
PATTERN = {"leopard", "mariniere"}
TOP_BONES = {"Bip01 Spine", "Bip01 Spine1", "Bip01 Spine2", "Bip01 Neck", "Bip01 L Clavicle", "Bip01 R Clavicle",
             "Bip01 L UpperArm", "Bip01 R UpperArm", "Bip01 L Forearm", "Bip01 R Forearm"}

# the old characters' bone names (people.js: accessories, the head turn, the seated legs) on this
# rig, as three.js names its nodes (spaces become underscores)
BONE_ALIAS = {"Head": "Bip01_Head", "Chest": "Bip01_Spine2", "Abdomen": "Bip01_Spine", "Hips": "Bip01_Pelvis", "WristR": "Bip01_R_Hand", "WristL": "Bip01_L_Hand",
              "UpperLeg.L": "Bip01_L_Thigh", "LowerLeg.L": "Bip01_L_Calf", "Foot.L": "Bip01_L_Foot",
              "UpperLeg.R": "Bip01_R_Thigh", "LowerLeg.R": "Bip01_R_Calf", "Foot.R": "Bip01_R_Foot",
              "UpperArm.L": "Bip01_L_UpperArm", "LowerArm.L": "Bip01_L_Forearm", "Wrist.L": "Bip01_L_Hand",
              "UpperArm.R": "Bip01_R_UpperArm", "LowerArm.R": "Bip01_R_Forearm", "Wrist.R": "Bip01_R_Hand"}


def import_fbx(path):
    """The objects an FBX brings in, and its actions."""
    before_o, before_a = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in bpy.data.objects if o not in before_o], [a for a in bpy.data.actions if a not in before_a]


def import_avatar(avatar):
    """An avatar's armature and mesh, its textures relinked from the Textures folder (the FBX
    points at the artists' own paths)."""
    folder = os.path.join(RB, "Avatars", avatar)
    name = os.path.basename(avatar)
    objs, _ = import_fbx(os.path.join(folder, "Export", f"{name}.fbx"))
    arm = next(o for o in objs if o.type == "ARMATURE")
    mesh = next(o for o in objs if o.type == "MESH")
    for o in objs:
        if o.type == "EMPTY":
            bpy.data.objects.remove(o)
    for im in bpy.data.images:
        p = os.path.join(folder, "Textures", os.path.basename(im.filepath))
        if os.path.exists(p) and im.filepath != p:
            im.filepath = p
            im.reload()
    return arm, mesh


def clean_materials():
    """The specular maps (and any texture whose file is missing) go, and every material takes
    one roughness, a plain specular and no metal: the FBX importer leaves Metallic unset, which
    glTF reads as fully metallic, lit only by its reflections."""
    for m in bpy.data.materials:
        for n in list(m.node_tree.nodes):
            if n.type == "TEX_IMAGE" and n.image and ("_specular" in os.path.basename(n.image.filepath) or not os.path.exists(n.image.filepath)):
                m.node_tree.nodes.remove(n)
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Roughness"].default_value = 0.7
            for k, v in (("Metallic", 0.0), ("Specular IOR Level", 0.5)):
                for link in list(bsdf.inputs[k].links):
                    m.node_tree.links.remove(link)
                bsdf.inputs[k].default_value = v


def load_avatar(cid, spec):
    """The avatar's armature, with its mesh, and its specular maps dropped."""
    arm, _ = import_avatar(spec["avatar"])
    clean_materials()
    arm.name = f"{cid}_Rig"
    return arm


def rot(m):
    return m.to_3x3().normalized().to_quaternion()


def copy_clip(src, tgt, action, name, helper=None, helper_action=None, loop=False, still=False):
    """Bake a clip onto the avatar: every bone takes the source bone's world orientation (one
    skeleton design, so the bones' axes agree), the pelvis the source's position less its
    forward drift, and the rest follows the avatar's own bone lengths. Returns the action, its
    length in frames and the ground speed (m/s) from the extracted root motion, if any. A clip
    that stands still is cut to MAX_FRAMES and keyed every second frame (it moves slowly); if it
    loops, it eases back into its first pose over its last LOOP_BLEND frames, so it doesn't jump."""
    sc = bpy.context.scene
    src.animation_data_create()
    src.animation_data.action = action
    if action.slots:
        src.animation_data.action_slot = action.slots[0]
    if helper is not None and helper_action is not None:
        helper.animation_data_create()
        helper.animation_data.action = helper_action
        if helper_action.slots:
            helper.animation_data.action_slot = helper_action.slots[0]
    f0, f1 = (int(round(x)) for x in action.frame_range)
    if still:
        f1 = min(f1, f0 + MAX_FRAMES)       # long idles and gestures, cut to a loop's length
    last = f1 - 1 if loop else f1          # a loop's last frame repeats its first
    Mt = tgt.matrix_world.copy()
    Mt_inv, Mt_rot_inv = Mt.inverted(), rot(Mt).inverted()
    tb = tgt.data.bones
    # the body's bones; the face's (under the head) keep their rest pose, which keeps the files small
    face = {c.name for c in tb["Bip01 Head"].children_recursive}
    names = sorted((b.name for b in tb if b.name in src.data.bones and b.name not in face), key=lambda n: len(tb[n].parent_recursive))
    pelvis = "Bip01 Pelvis"
    # the pelvis's drift over the clip (an in-place clip should have none), removed linearly
    sc.frame_set(f0); p0 = src.matrix_world @ src.pose.bones[pelvis].head
    sc.frame_set(f1); p1 = src.matrix_world @ src.pose.bones[pelvis].head
    drift = (p1 - p0) / max(1, f1 - f0); drift.z = 0
    speed = 0.0
    if helper is not None:
        sc.frame_set(f0); h0 = helper.matrix_world.translation.copy()
        sc.frame_set(f1); h1 = helper.matrix_world.translation.copy()
        speed = math.hypot(h1.x - h0.x, h1.y - h0.y) / ((f1 - f0) / FPS)
    act = bpy.data.actions.new(name)
    tgt.animation_data_create()
    tgt.animation_data.action = act
    for pb in tgt.pose.bones:
        pb.rotation_mode = "QUATERNION"
    prev, keyed = {}, {}
    for f in sorted(set(range(f0, last + 1, 2 if still else 1)) | {last}):
        sc.frame_set(f)
        Ms = src.matrix_world.copy()
        P = {}
        for n in names:
            b = tb[n]
            r = Mt_rot_inv @ rot(Ms @ src.pose.bones[n].matrix)
            par = b.parent
            Pp = P.get(par.name, par.matrix_local) if par else None
            if n == pelvis:
                head = Mt_inv @ ((Ms @ src.pose.bones[n].head) - drift * (f - f0))
            elif par:
                head = (Pp @ par.matrix_local.inverted() @ b.matrix_local).translation
            else:
                head = b.head_local.copy()
            P[n] = Matrix.Translation(head) @ r.to_matrix().to_4x4()
            L = (b.matrix_local.inverted() @ par.matrix_local @ Pp.inverted() @ P[n]) if par else b.matrix_local.inverted() @ P[n]
            q = L.to_quaternion()
            if n in prev and prev[n].dot(q) < 0:
                q.negate()
            prev[n] = q
            pb = tgt.pose.bones[n]
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f - f0)
            keyed.setdefault(f, {})[n] = (q.copy(), L.translation.copy() if n == pelvis else None)
            if n == pelvis:
                pb.location = L.translation
                pb.keyframe_insert("location", frame=f - f0)
    if loop and still:   # ease the end into the start (a no-op where the clip already loops)
        first = keyed[f0]
        for f, pose in keyed.items():
            w = (f - (last - LOOP_BLEND)) / LOOP_BLEND
            if w <= 0:
                continue
            w = w * w * (3 - 2 * w)
            for n, (q, loc) in pose.items():
                q0, loc0 = first[n]
                if q0.dot(q) < 0:
                    q0 = -q0
                pb = tgt.pose.bones[n]
                pb.rotation_quaternion = q.slerp(q0, w)
                pb.keyframe_insert("rotation_quaternion", frame=f - f0)
                if loc is not None:
                    pb.location = loc.lerp(loc0, w)
                    pb.keyframe_insert("location", frame=f - f0)
    tgt.animation_data.action = None
    return act, last - f0, speed


def animate(rig, sex, clips=CLIPS):
    """Every clip in clips on the character, as NLA tracks named for the game, and the ground
    speed of the walk, run and sprint."""
    sc = bpy.context.scene
    sc.render.fps = FPS
    speeds = {}
    for game_name, (clip, kind) in clips.items():
        path = os.path.join(RB, "Animations", f"all_animations_max_motextr_{kind}", f"{sex}_{clip}.max.fbx")
        if not os.path.exists(path):
            print("  no clip", path); continue
        objs, acts = import_fbx(path)
        src = next(o for o in objs if o.type == "ARMATURE")
        helper = next((o for o in objs if o.name.startswith("MotionExtractionHelper")), None)
        action = next(a for a in acts if a.name.startswith(src.name + "|"))
        h_action = next((a for a in acts if helper and a.name.startswith(helper.name + "|")), None)
        act, n, speed = copy_clip(src, rig, action, game_name, helper, h_action, loop=game_name in LOOPS, still=kind == "static")
        if game_name in ("Walk", "Run", "Sprint"):
            speeds[game_name] = round(speed, 3)
        track = rig.animation_data.nla_tracks.new()
        track.name = game_name
        track.strips.new(game_name, 0, act)
        for o in objs:
            bpy.data.objects.remove(o)
    return speeds


# ------------------------------------------------------------------ export
def export(rig, path, colour_px=1024, data_px=512, mesh=True, clips=True, shared=False):
    """The character as glTF binary: the rig, its mesh (unless not mesh: a file of clips) and
    its clips (unless not clips: an NPC, which takes its sex's); textures shrunk to colour_px
    (normal maps to data_px) and written as WebP. shared: the clips drive other avatars (see
    slim_glb)."""
    for im in bpy.data.images:
        w, h = im.size
        f = os.path.basename(im.filepath)
        lim = data_px if "_normal" in im.name + f else colour_px // 2 if not clips and "_opacity" in f else colour_px
        if max(w, h) > lim:
            im.scale(max(1, lim * w // max(w, h)), max(1, lim * h // max(w, h)))
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for c in rig.children:
        c.select_set(mesh)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_skins=True,
                              export_animations=clips, export_animation_mode="NLA_TRACKS", export_optimize_animation_size=True,
                              export_image_format="WEBP", export_image_quality=80, export_morph=False, export_yup=True,
                              **({} if clips and mesh else {"export_vertex_color": "NONE"}))
    before = os.path.getsize(path)
    slim_glb(path, shared=shared, quantize=not clips)
    print(f"wrote {path} ({os.path.getsize(path) / 1e6:.2f} MB; {before / 1e6:.2f} MB as exported)")


def quantize_mesh(j, buf):
    """Store the mesh's normals as normalised bytes (KHR_mesh_quantization), its texture
    coordinates as normalised 16-bit integers and its skin weights as normalised bytes that
    still add up to one: about half the mesh's size, nothing anyone can see. The new data goes
    at the end of buf (a bytearray); the float data is left for the repack to drop."""
    acc, bvs = j["accessors"], j["bufferViews"]
    width = {"VEC2": 2, "VEC3": 3, "VEC4": 4}
    def read(a):
        v = bvs[a["bufferView"]]
        return np.frombuffer(bytes(buf), dtype="<f4", count=a["count"] * width[a["type"]],
                             offset=v.get("byteOffset", 0) + a.get("byteOffset", 0)).reshape(a["count"], -1)
    def add(arr, ctype, typ, stride=None):
        buf.extend(b"\0" * (-len(buf) % 4))
        bvs.append({"buffer": 0, "byteOffset": len(buf), "byteLength": arr.nbytes, **({"byteStride": stride} if stride else {})})
        buf.extend(arr.tobytes())
        acc.append({"bufferView": len(bvs) - 1, "componentType": ctype, "count": len(arr), "type": typ, "normalized": True})
        return len(acc) - 1
    done = {}
    for m in j.get("meshes", []):
        for pr in m["primitives"]:
            at = pr["attributes"]
            for k in ("TEXCOORD_1", "COLOR_0", "COLOR_1"):
                at.pop(k, None)
            for k in ("NORMAL", "TEXCOORD_0", "WEIGHTS_0"):
                if k not in at or acc[at[k]]["componentType"] != 5126:
                    continue
                if at[k] in done:
                    at[k] = done[at[k]]
                    continue
                v = read(acc[at[k]])
                if k == "NORMAL":   # padded to four bytes a vertex, as attributes must be
                    q = np.zeros((len(v), 4), dtype="i1")
                    q[:, :3] = np.round(v / np.linalg.norm(v, axis=1, keepdims=True).clip(1e-6) * 127)
                    q = add(q, 5120, "VEC3", stride=4)
                elif k == "TEXCOORD_0":
                    if v.min() < 0 or v.max() > 1:
                        continue
                    q = add(np.round(v * 65535).astype("<u2"), 5123, "VEC2")
                else:
                    w = np.round(v / v.sum(1, keepdims=True).clip(1e-6) * 255).astype(np.int32)
                    w[np.arange(len(w)), w.argmax(1)] += 255 - w.sum(1)   # the largest takes the rounding
                    q = add(w.astype("u1"), 5121, "VEC4")
                done[at[k]] = q
                at[k] = q
    j.setdefault("extensionsUsed", []).append("KHR_mesh_quantization")
    j.setdefault("extensionsRequired", []).append("KHR_mesh_quantization")


def slim_glb(path, eps=1e-5, shared=False, quantize=False):
    """Drop the animation channels that hold the node's own value throughout (the exporter bakes
    every bone's translation, rotation and scale on every frame, the face's included), which is
    what three.js shows without them, then repack the binary. Hair cards (the *_opacity
    materials) are cut out at an alpha threshold rather than blended.

    shared: the clips will drive other avatars of the same sex, whose rest pose may not be this
    one's, so a body bone's rotation that holds still is kept as one key rather than dropped,
    and its rotations are stored as normalised 16-bit integers. Translations stay each
    avatar's own (bone lengths), but the pelvis's."""
    data = open(path, "rb").read()
    jlen = struct.unpack("<I", data[12:16])[0]
    j = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack("<I", data[off:off + 4])[0]
    buf = data[off + 8:off + 8 + blen]
    if quantize:
        buf = bytearray(buf)
        quantize_mesh(j, buf)
        buf = bytes(buf)
    acc, bvs, nodes = j["accessors"], j["bufferViews"], j["nodes"]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
    def values(ai):
        a = acc[ai]
        v = bvs[a["bufferView"]]
        return np.frombuffer(buf, dtype="<f4", count=a["count"] * width[a["type"]],
                             offset=v.get("byteOffset", 0) + a.get("byteOffset", 0)).reshape(a["count"], -1)
    # the face's bones: under the head, each avatar's own
    face, stack = set(), [i for i, n in enumerate(nodes) if n.get("name") == "Bip01 Head"]
    while stack:
        for c in nodes[stack.pop()].get("children", []):
            face.add(c); stack.append(c)
    rest = {"translation": [0, 0, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1]}
    anims = []   # per animation: [(channel target, interpolation, times, values)]
    for anim in j.get("animations", []):
        keep = []
        for ch in anim["channels"]:
            sm = anim["samplers"][ch["sampler"]]
            t, out = values(sm["input"]), values(sm["output"])
            tg = ch["target"]
            own = np.array(nodes[tg["node"]].get(tg["path"], rest[tg["path"]]), dtype=np.float64)
            tol = {"translation": 1e-3, "scale": 1e-4}.get(tg["path"], eps)   # the bake's float noise, in the rig's units
            moves = np.abs(out - own).max() > tol and not (tg["path"] == "rotation" and np.abs(out + own).max() <= tol)
            if moves:
                keep.append((tg, sm.get("interpolation", "LINEAR"), t, out))
            elif shared and tg["path"] == "rotation" and tg["node"] not in face:
                keep.append((tg, "LINEAR", t[:1], out[:1]))
        anims.append(keep)
    # the accessors still in use (meshes, skins), and their buffer views, repacked in order
    refs = set()
    for m in j.get("meshes", []):
        for pr in m["primitives"]:
            refs.update(pr["attributes"].values())
            if "indices" in pr:
                refs.add(pr["indices"])
    for sk in j.get("skins", []):
        if "inverseBindMatrices" in sk:
            refs.add(sk["inverseBindMatrices"])
    amap = {o: n for n, o in enumerate(sorted(refs))}
    views = sorted({acc[a]["bufferView"] for a in refs} | {im["bufferView"] for im in j.get("images", []) if "bufferView" in im})
    vmap, out_buf = {}, bytearray()
    for o in views:
        v = dict(bvs[o])
        chunk = buf[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]
        out_buf += b"\0" * (-len(out_buf) % 4)
        v["byteOffset"] = len(out_buf)
        out_buf += chunk
        vmap[o] = len(vmap)
        bvs[o] = v
    new_views = [bvs[o] for o in views]
    new_acc = [dict(acc[o], bufferView=vmap[acc[o]["bufferView"]]) for o in sorted(refs)]
    def add(arr, ctype, typ, normalized=False, minmax=False):
        out_buf.extend(b"\0" * (-len(out_buf) % 4))
        new_views.append({"buffer": 0, "byteOffset": len(out_buf), "byteLength": arr.nbytes})
        out_buf.extend(arr.tobytes())
        a = {"bufferView": len(new_views) - 1, "componentType": ctype, "count": len(arr), "type": typ}
        if normalized:
            a["normalized"] = True
        if minmax:
            a["min"], a["max"] = [float(arr.min())], [float(arr.max())]
        new_acc.append(a)
        return len(new_acc) - 1
    for anim, keep in zip(j.get("animations", []), anims):
        times, anim["samplers"], anim["channels"] = {}, [], []
        for tg, interp, t, out in keep:
            tt = np.ascontiguousarray(t, dtype="<f4").reshape(-1)
            key = tt.tobytes()
            if key not in times:   # channels with the same times share them
                times[key] = add(tt, 5126, "SCALAR", minmax=True)
            if shared and tg["path"] == "rotation":   # normalised int16: 1/32767 is finer than the bake
                q = out / np.linalg.norm(out, axis=1, keepdims=True)
                o = add(np.round(q * 32767).astype("<i2"), 5122, "VEC4", normalized=True)
            else:
                o = add(np.ascontiguousarray(out, dtype="<f4"), 5126, {3: "VEC3", 4: "VEC4"}[out.shape[1]])
            anim["samplers"].append({"input": times[key], "output": o, "interpolation": interp})
            anim["channels"].append({"sampler": len(anim["samplers"]) - 1, "target": tg})
    j["bufferViews"], j["accessors"] = new_views, new_acc
    for im in j.get("images", []):
        if "bufferView" in im:
            im["bufferView"] = vmap[im["bufferView"]]
    for m in j.get("meshes", []):
        for pr in m["primitives"]:
            pr["attributes"] = {k: amap[a] for k, a in pr["attributes"].items()}
            if "indices" in pr:
                pr["indices"] = amap[pr["indices"]]
    for sk in j.get("skins", []):
        if "inverseBindMatrices" in sk:
            sk["inverseBindMatrices"] = amap[sk["inverseBindMatrices"]]
    for mat in j.get("materials", []):   # hair cards: cut out, both sides
        if mat.get("name", "").endswith("_opacity") and "glasses" not in mat["name"]:
            mat.update(alphaMode="MASK", alphaCutoff=0.4, doubleSided=True)
    out_buf += b"\0" * (-len(out_buf) % 4)
    j["buffers"][0]["byteLength"] = len(out_buf)
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(out_buf)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(out_buf), 0x004E4942)); f.write(out_buf)


def write_people_json(heroes):
    """The main characters in web/assets/people/people.json, under "heroes" (kept apart from the
    crowd's "characters", which the crowd draws from)."""
    path = os.path.join(ROOT, "web", "assets", "people", "people.json")
    info = json.load(open(path))
    info["heroes"] = {
        "note": "The main characters, built by blender/build_people.py from Microsoft Rocketbox avatars and their "
                "motion-captured clips. Textured, so not recoloured per look.",
        "source": "Microsoft Rocketbox (MIT, (c) 2020 Microsoft): avatars and animations; see LICENSE-Rocketbox.txt",
        "bones": BONE_ALIAS,
        "characters": heroes,
    }
    json.dump(info, open(path, "w"), indent=1)
    print("updated", path)


# ------------------------------------------------------------------ the NPCs
HEADISH = re.compile(r"_(head|opacity)$")   # a head's materials: the face and scalp, and the hair cards and lashes
HAT = re.compile(r"_(hat|helmet)$")


def drop_faces(obj, pred):
    """Delete obj's faces whose material's name pred accepts (and what only they used)."""
    import bmesh
    names = [s.name for s in obj.material_slots]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if pred(names[f.material_index])], context="FACES")
    bm.to_mesh(obj.data)
    bm.free()


def swap_head(arm, mesh, donor):
    """Put the donor avatar's head (face, scalp, hair cards, lashes) on this one in place of its
    own. Every avatar of a sex has the same skeleton, so the donor's head bone is where this
    one's is; the move between them is applied anyway, and its vertex groups join by name."""
    da, dm = import_avatar(donor)
    drop_faces(dm, lambda n: not HEADISH.search(n))
    drop_faces(mesh, lambda n: bool(HEADISH.search(n)))
    to = (arm.matrix_world @ arm.data.bones["Bip01 Head"].matrix_local) @ (da.matrix_world @ da.data.bones["Bip01 Head"].matrix_local).inverted()
    dm.data.transform(mesh.matrix_world.inverted() @ to @ dm.matrix_world)
    for md in list(dm.modifiers):
        dm.modifiers.remove(md)
    dm.parent = None
    dm.matrix_world = mesh.matrix_world
    bpy.ops.object.select_all(action="DESELECT")
    dm.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.join()
    bpy.data.objects.remove(da)


def base_image(mat):
    """The image node feeding a material's base colour."""
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    link = bsdf and next(iter(bsdf.inputs["Base Color"].links), None)
    return link.from_node if link and link.from_node.type == "TEX_IMAGE" else None


def pixels(im):
    a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(im.size[1], im.size[0], 4)   # rows from the bottom, as v runs


def put_pixels(im, px):
    im.pixels.foreach_set(px.astype(np.float32).ravel())
    im.update()


def luma(px):
    return px[..., 0] * 0.299 + px[..., 1] * 0.587 + px[..., 2] * 0.114


def fix_hair_cards(mesh):
    """The hair cards (the *_opacity materials) take their alpha from their own texture's alpha
    (the importer wires the texture's colour to it), and the texels they cut away take the hair's
    colour, so the cut edges don't pick up the magenta the artists left there."""
    for slot in mesh.material_slots:
        mat = slot.material
        if not mat or not mat.name.endswith("_opacity"):
            continue
        node, bsdf = base_image(mat), mat.node_tree.nodes.get("Principled BSDF")
        if not node:
            continue
        for link in list(bsdf.inputs["Alpha"].links):
            if link.from_node is not node:
                mat.node_tree.nodes.remove(link.from_node)
        mat.node_tree.links.new(node.outputs["Alpha"], bsdf.inputs["Alpha"])
        px = pixels(node.image)
        solid = px[..., 3] > 0.5
        if solid.any():
            px[~solid, :3] = np.median(px[solid, :3], axis=0)
            put_pixels(node.image, px)


def uv_mask(mesh, polys, w, h, grow=4):
    """Where the given faces lie on a w x h texture, grown a few texels (rows from the bottom)."""
    from PIL import Image, ImageDraw, ImageFilter
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    uv = mesh.data.uv_layers.active.data
    for p in polys:
        d.polygon([(uv[i].uv[0] * w, uv[i].uv[1] * h) for i in p.loop_indices], fill=255)
    if grow:
        im = im.filter(ImageFilter.MaxFilter(2 * grow + 1))
    return np.asarray(im, dtype=np.float32) / 255


def scalp(arm, mesh):
    """The head's faces that carry hair, by where they are in the bind pose: above the brows,
    behind the line of the ears or out beyond the cheeks; the eyes never."""
    bone = lambda n: arm.matrix_world @ arm.data.bones[n].head_local
    eye = (bone("Bip01 REye") + bone("Bip01 LEye")) / 2
    fwd = eye - bone("Bip01 Head")
    fwd.z = 0
    fwd.normalize()
    side = fwd.cross((0, 0, 1))
    eyes = {mesh.vertex_groups[n].index for n in ("Bip01 REye", "Bip01 LEye") if n in mesh.vertex_groups}
    vs, M = mesh.data.vertices, mesh.matrix_world
    out = []
    for p in mesh.data.polygons:
        if not HEADISH.search(mesh.material_slots[p.material_index].name):
            continue
        if any(g.group in eyes and g.weight > 0.3 for i in p.vertices for g in vs[i].groups):
            continue
        c = M @ p.center
        if c.z - eye.z > 0.018 or (c - eye).dot(fwd) < -0.06 or abs((c - eye).dot(side)) > 0.072:
            out.append(p)
    return out


def retouch_hair(arm, mesh, tag):
    """Recolour the hair (HAIR[tag]) where it is painted on the scalp and on the hair cards,
    keeping each strand's light and dark."""
    polys = scalp(arm, mesh)
    for slot in mesh.material_slots:
        mat = slot.material
        node = mat and base_image(mat)
        if not node or not HEADISH.search(mat.name):
            continue
        px = pixels(node.image)
        L = luma(px)
        if mat.name.endswith("_head"):
            # the dark texels there and just round it (the fringe's ends): hair, not skin
            region = uv_mask(mesh, [p for p in polys if mesh.material_slots[p.material_index].material is mat], *node.image.size, grow=node.image.size[0] // 40)
            m = region * np.clip((0.40 - L) / 0.18, 0, 1)
        else:   # every dark texel, the cut-away ones too, so the cards' edges don't darken
            m = np.clip((0.45 - L) / 0.2, 0, 1)
        if not (m > 0.5).any():
            continue
        new = np.array(HAIR[tag]) * (0.55 + 0.45 * np.clip(L / np.median(L[m > 0.5]), 0.3, 2.2))[..., None]
        px[..., :3] = px[..., :3] * (1 - m[..., None]) + np.clip(new, 0, 1) * m[..., None]
        put_pixels(node.image, px)


def dye(mesh, colour):
    """Light, unsaturated cloth on the body's texture (a white shirt or robe) takes the colour,
    keeping its folds."""
    for slot in mesh.material_slots:
        node = slot.material and not HEADISH.search(slot.material.name) and base_image(slot.material)
        if not node or not slot.material.name.endswith("_body"):
            continue
        px = pixels(node.image)
        L, mx, mn = luma(px), px[..., :3].max(-1), px[..., :3].min(-1)
        m = np.clip((L - 0.42) / 0.2, 0, 1) * np.clip((0.3 - (mx - mn) / (mx + 1e-4)) / 0.12, 0, 1)
        if not (m > 0.5).any():
            continue
        new = np.array(colour) * np.clip(L / np.median(L[m > 0.5]), 0.4, 1.6)[..., None]
        px[..., :3] = px[..., :3] * (1 - m[..., None]) + new * m[..., None]
        put_pixels(node.image, px)


def plain(mesh):
    """Cover the avatar's lettering and badges (INSIGNIA) with the cloth beside them, feathered
    at the edges."""
    done = set()
    for slot in mesh.material_slots:
        for n in (slot.material.node_tree.nodes if slot.material else []):
            im = n.image if n.type == "TEX_IMAGE" else None
            boxes = im and INSIGNIA.get(os.path.basename(im.filepath))
            if not boxes or im.name in done:
                continue
            done.add(im.name)
            px = pixels(im)
            H, W = px.shape[:2]
            for x0, y0, x1, y1, dx, dy in boxes:
                c0, c1, r0, r1 = int(x0 * W), int(x1 * W), int((1 - y1) * H), int((1 - y0) * H)   # rows from the bottom
                sc, sr = int(dx * W), -int(dy * H)
                yy, xx = np.mgrid[r0:r1, c0:c1]
                edge = np.minimum.reduce([xx - c0, c1 - 1 - xx, yy - r0, r1 - 1 - yy]) / max(2, W // 400)
                w = np.clip(edge, 0, 1)[..., None]
                px[r0:r1, c0:c1, :3] = px[r0:r1, c0:c1, :3] * (1 - w) + px[r0 + sr:r1 + sr, c0 + sc:c1 + sc, :3] * w
            put_pixels(im, px)


def position_map(mesh, mat, w, h):
    """Where each texel of a material's w x h texture is on the body in the bind pose (three.js
    model space), and which texels a face covers: every triangle rasterised in UV space."""
    M = mesh.matrix_world
    uv = mesh.data.uv_layers.active.data
    pos = np.zeros((h, w, 3), np.float32)
    cov = np.zeros((h, w), bool)
    mesh.data.calc_loop_triangles()
    for t in mesh.data.loop_triangles:
        if mesh.material_slots[t.material_index].material is not mat:
            continue
        P = np.array([tuple(M @ mesh.data.vertices[v].co) for v in t.vertices])
        P = P[:, [0, 2, 1]] * (1, 1, -1)   # Blender's z-up, -y-forward world to three.js's
        T = np.array([(uv[l].uv[0] * w, uv[l].uv[1] * h) for l in t.loops])
        x0, y0 = np.floor(T.min(0)).astype(int)
        x1, y1 = np.ceil(T.max(0)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w - 1), min(y1, h - 1)
        if x1 < x0 or y1 < y0:
            continue
        yy, xx = np.mgrid[y0:y1 + 1, x0:x1 + 1] + 0.5
        (ax, ay), (bx, by), (cx, cy) = T
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-9:
            continue
        l0 = ((by - cy) * (xx - cx) + (cx - bx) * (yy - cy)) / d
        l1 = ((cy - ay) * (xx - cx) + (ax - cx) * (yy - cy)) / d
        l2 = 1 - l0 - l1
        inside = (l0 >= -0.01) & (l1 >= -0.01) & (l2 >= -0.01)
        sub = pos[y0:y1 + 1, x0:x1 + 1]
        sub[inside] = (l0[..., None] * P[0] + l1[..., None] * P[1] + l2[..., None] * P[2])[inside]
        cov[y0:y1 + 1, x0:x1 + 1] |= inside
    return pos, cov


def print_pattern(mesh, kind):
    """Print a pattern over the top: the cloth whose colour is the colour of the body's middle
    (the faces moved only by the spine), not the hands; its folds stay."""
    vs = mesh.data.vertices
    group = lambda names: {mesh.vertex_groups[n].index for n in mesh.vertex_groups.keys() if any(k in n for k in names)}
    torso, hands = group(("Spine",)), group((" Hand", " Finger"))
    weight = lambda i, gs: sum(g.weight for g in vs[i].groups if g.group in gs)
    for slot in mesh.material_slots:
        mat = slot.material
        node = mat and mat.name.endswith("_body") and base_image(mat)
        if not node:
            continue
        w, h = node.image.size
        mine = [p for p in mesh.data.polygons if mesh.material_slots[p.material_index].material is mat]
        px = pixels(node.image)
        seed_m = uv_mask(mesh, [p for p in mine if all(weight(i, torso) > 0.8 for i in p.vertices)], w, h, grow=0) > 0.5
        if seed_m.sum() < 1000:
            continue
        seed = np.median(px[seed_m, :3], axis=0)
        bare = uv_mask(mesh, [p for p in mine if any(weight(i, hands) > 0.3 for i in p.vertices)], w, h, grow=2)
        pos, cov = position_map(mesh, mat, w, h)
        m = cov * np.clip(1 - (np.linalg.norm(px[..., :3] - seed, axis=-1) - 0.08) / 0.06, 0, 1) * (1 - bare)
        x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
        if kind == "leopard":   # tan, with black rosettes round brown hearts; the grid of the old characters' shader, warped
            f = 52
            sv = np.sin(x * f + 0.7 * np.sin(y * f * 1.7)) * np.sin(y * f + 1.7 + 0.7 * np.sin(z * f * 1.3)) * np.sin(z * f - 0.6 + 0.7 * np.sin(x * f * 1.9))
            ss = lambda a, b, v: np.clip((v - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((v - a) / (b - a), 0, 1))
            col = np.array([0.79, 0.64, 0.40]) * np.ones_like(pos)
            col = col * (1 - ss(0.07, 0.13, sv))[..., None] + np.array([0.07, 0.06, 0.05]) * ss(0.07, 0.13, sv)[..., None]
            col = col * (1 - ss(0.26, 0.34, sv))[..., None] + np.array([0.42, 0.24, 0.09]) * ss(0.26, 0.34, sv)[..., None]
        else:   # the marinière: Breton stripes, navy on white, round the body
            band = np.clip((np.abs(np.mod(y * 28, 1) - 0.5) - 0.15) / 0.04, 0, 1)
            col = np.array([0.94, 0.93, 0.90]) * (1 - band[..., None]) + np.array([0.10, 0.13, 0.26]) * band[..., None]
        shade = np.clip(luma(px) / max(1e-3, np.median(luma(px)[m > 0.5])), 0.7, 1.25)[..., None]   # the folds, not a print underneath
        px[..., :3] = px[..., :3] * (1 - m[..., None]) + np.clip(col * shade, 0, 1) * m[..., None]
        put_pixels(node.image, px)


def skin_like(px):
    r, g, b = px[..., 0], px[..., 1], px[..., 2]
    return (r > g) & (g > b) & (r - b > 0.06) & (r > 0.2) & (r < 0.97)


def match_skin(arm, mesh):
    """After a head swap, the body's bare skin (the hands, and arms or legs of the same tone)
    takes the new face's colour, channel by channel: a hand painted for one face would not
    match another's."""
    hands = {mesh.vertex_groups[n].index for n in mesh.vertex_groups.keys() if " Hand" in n or " Finger" in n}
    vs = mesh.data.vertices
    hair = {p.index for p in scalp(arm, mesh)}
    face_ref = body = None
    for slot in mesh.material_slots:
        mat = slot.material
        node = mat and base_image(mat)
        if node and mat.name.endswith("_head"):
            polys = [p for p in mesh.data.polygons if mesh.material_slots[p.material_index].material is mat and p.index not in hair]
            px = pixels(node.image)
            m = (uv_mask(mesh, polys, *node.image.size, grow=0) > 0.5) & skin_like(px) & (luma(px) > 0.3)
            if m.sum() > 500:
                face_ref = np.median(px[m, :3], axis=0)
        elif node and mat.name.endswith("_body"):
            body = (mat, node)
    if face_ref is None or body is None:
        return
    mat, node = body
    polys = [p for p in mesh.data.polygons if mesh.material_slots[p.material_index].material is mat
             and sum(g.weight for i in p.vertices for g in vs[i].groups if g.group in hands) > 0.5 * len(p.vertices)]
    px = pixels(node.image)
    m = (uv_mask(mesh, polys, *node.image.size, grow=0) > 0.5) & skin_like(px)
    if m.sum() < 500:
        return
    ref = np.median(px[m, :3], axis=0)
    near = np.clip(1 - np.linalg.norm(px[..., :3] - ref, axis=-1) / 0.22, 0, 1) * skin_like(px)
    gain = np.clip(face_ref / np.maximum(ref, 0.02), 0.3, 3)
    px[..., :3] = px[..., :3] * (1 - near[..., None]) + np.clip(px[..., :3] * gain, 0, 1) * near[..., None]
    put_pixels(node.image, px)


SKELETON = {}   # sex -> the first NPC's bind pose, to check the others against


def same_skeleton(cid, arm, sex):
    """Warn when an avatar's skeleton differs from the first of its sex: its clips would still
    turn its bones right, but its own bone lengths would show."""
    pose = {b.name: np.array(b.matrix_local) for b in arm.data.bones}
    ref = SKELETON.setdefault(sex, pose)
    worst = max((np.abs(pose[n] - ref[n]).max() for n in pose if n in ref), default=0)
    if worst > 0.05:
        print(f"  {cid}: its skeleton is not the first {sex} NPC's (off by up to {worst:.2f} cm)")


def build_npc(cid, spec):
    """An NPC: the avatar, with the head it wears, without a hat if bare, its hair and clothes
    retouched by its tags."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    arm, mesh = import_avatar(spec["avatar"])
    if spec["head"]:
        swap_head(arm, mesh, spec["head"])
    if "bare" in spec["tags"]:
        drop_faces(mesh, lambda n: bool(HAT.search(n)))
    clean_materials()
    fix_hair_cards(mesh)
    if spec["head"]:
        match_skin(arm, mesh)
    for tag in spec["tags"]:
        if tag in HAIR:
            retouch_hair(arm, mesh, tag)
        elif tag in CLOTH:
            dye(mesh, CLOTH[tag])
        elif tag == "plain":
            drop_faces(mesh, lambda n: bool(WEAPON.search(n)))
            plain(mesh)
        elif tag in PATTERN:
            print_pattern(mesh, tag)
        elif tag != "bare":
            raise SystemExit(f"{cid}: no tag {tag} (HAIR, CLOTH, PATTERN, bare or plain)")
    same_skeleton(cid, arm, spec["sex"])
    arm.name = f"{cid}_Rig"
    return arm, mesh


def build_npcs(only=None, clips=True):
    """Every NPC the cities name, and the clips for each sex; people.json's "npcs"."""
    listing = [os.path.relpath(p, os.path.dirname(RB)).replace(os.sep, "/")
               for p in glob.glob(os.path.join(RB, "Avatars", "*", "*", "Textures", "*"))]
    cast = npc_cast(listing)
    out = os.path.join(ROOT, "web", "assets", "people")
    path = os.path.join(out, "people.json")
    info = json.load(open(path))
    sec = info.get("npcs", {})
    chars = {}
    for cid, spec in cast.items():
        if only and cid not in only:   # as built before
            chars[cid] = sec.get("characters", {}).get(cid)
            continue
        rig, mesh = build_npc(cid, spec)
        tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
        export(rig, os.path.join(out, f"{cid}.glb"), clips=False, data_px=256)
        chars[cid] = {"file": f"{cid}.glb", "sex": spec["sex"], "avatar": spec["avatar"], "head": spec["head"], "tags": spec["tags"],
                      "height_m": round(max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices), 3), "triangles": tris,
                      "cities": sorted(spec["cities"])}
        print(f"{cid}: {tris} triangles")
    clip_files = dict(sec.get("clips", {}))
    for sex in sorted({s["sex"] for s in cast.values()}) if clips else []:
        names = NPC_BASE + sorted({c for s in cast.values() if s["sex"] == sex for c in s["clips"]} - set(NPC_BASE))
        bad = [c for c in names if c not in NPC_CLIPS]
        if bad:
            raise SystemExit(f"no clip {bad} in NPC_CLIPS")
        avatar = next(s["avatar"] for s in cast.values() if s["sex"] == sex)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        rig = load_avatar(f"R_clips_{sex}", {"avatar": avatar})
        speeds = animate(rig, sex, {c: NPC_CLIPS[c] for c in names})
        export(rig, os.path.join(out, f"R_clips_{sex}.glb"), mesh=False, shared=True)
        clip_files[sex] = {"file": f"R_clips_{sex}.glb", "clips": [t.name for t in rig.animation_data.nla_tracks], "ground_speed": speeds}
    if not only:   # files of characters no city names any more
        for f in glob.glob(os.path.join(out, "R_*.glb")):
            name = os.path.basename(f)[:-4]
            if name not in chars and not name.startswith("R_clips_"):
                os.remove(f)
                print("removed", f)
    info["npcs"] = {
        "note": "The NPCs: Microsoft Rocketbox avatars built by blender/build_people.py --npcs for the characters the cities' "
                "game.npcs name (R_<avatar>[_<head>][_<tag>...]). Each sex's clips are in one file that drives them all.",
        "source": "Microsoft Rocketbox (MIT, (c) 2020 Microsoft): avatars and animations; see LICENSE-Rocketbox.txt",
        "bones": BONE_ALIAS,
        "clips": clip_files,
        "characters": {k: chars[k] for k in sorted(chars) if chars[k]},
    }
    json.dump(info, open(path, "w"), indent=1)
    print("updated", path)


# ------------------------------------------------------------------ preview
def preview(rig, path):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 600, 1000
    world = bpy.data.worlds.new("Studio"); sc.world = world; world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.66, 0.70, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    sun = bpy.data.objects.new("Key", bpy.data.lights.new("Key", "SUN")); sc.collection.objects.link(sun)
    sun.data.energy = 3.2; sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); sc.collection.objects.link(cam)
    cam.data.lens = 70
    cam.location = (1.6, -5.2, 1.0); cam.rotation_euler = (math.radians(88.5), 0, math.radians(17))
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("wrote", path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="character ids")
    ap.add_argument("--preview", action="store_true", help="Cycles stills of Idle and Walk -> docs/images/people/")
    ap.add_argument("--no-export", action="store_true", help="build (and preview) without writing the GLB")
    ap.add_argument("--npcs", action="store_true", help="the NPCs the cities name (R_*), and their clips, instead")
    ap.add_argument("--no-clips", action="store_true", help="with --npcs: leave the clip files as they are")
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    if args.npcs:
        return build_npcs(args.only, clips=not args.no_clips)
    path = os.path.join(ROOT, "web", "assets", "people", "people.json")
    heroes = dict(json.load(open(path)).get("heroes", {}).get("characters", {}))
    for cid, spec in CHARACTERS.items():
        if args.only and cid not in args.only:
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        rig = load_avatar(cid, spec)
        speeds = animate(rig, spec["sex"])
        mesh = next(c for c in rig.children if c.type == "MESH")
        tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
        print(f"{cid}: {tris} triangles, {len(rig.data.bones)} bones, ground speeds {speeds}")
        if args.preview:
            out = os.path.join(ROOT, "docs", "images", "people"); os.makedirs(out, exist_ok=True)
            for clip, frame in (("Idle", 20), ("Walk", 10)):
                for t in rig.animation_data.nla_tracks:
                    t.mute = t.name != clip
                bpy.context.scene.frame_set(frame)
                preview(rig, os.path.join(out, f"{cid}_{clip}.png"))
            for t in rig.animation_data.nla_tracks:
                t.mute = False
        if not args.no_export:
            out = os.path.join(ROOT, "web", "assets", "people")
            export(rig, os.path.join(out, f"{cid}.glb"))
            heroes[cid] = {"file": f"{cid}.glb", "label": spec["label"], "avatar": spec["avatar"], "ground_speed": speeds,
                           "height_m": round(max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices), 3), "triangles": tris,
                           "clips": [t.name for t in rig.animation_data.nla_tracks]}
    if not args.no_export:
        write_people_json(heroes)


if __name__ == "__main__":
    main()
