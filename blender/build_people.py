"""The game's main characters (the surveyors you play), from Microsoft Rocketbox (MIT): its
avatars, made by artists and rigged on a 3ds Max Biped, with its motion-captured clips on the
same skeleton. Each clip is copied onto the avatar bone by bone in world space (the avatars'
bind pose and the clips' rest pose differ, so local rotations would not carry over), with the
walk, run and sprint kept in place and their ground speed read from the clip's own extracted
root motion. Textures are shrunk and written as WebP inside one glTF binary per character.

    pip install bpy==5.2.3                       # Blender as a Python module
    python pipeline/fetch_rocketbox.py           # the avatars and clips, into data/raw/rocketbox (once)
    python blender/build_people.py --preview     # -> web/assets/people/H_*.glb, docs/images/people/

Rocketbox is (c) 2020 Microsoft under the MIT licence; web/assets/people/LICENSE-Rocketbox.txt
carries its notice.
"""
import argparse
import json
import math
import os
import struct
import sys

import bpy
import numpy as np
from mathutils import Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RB = os.path.join(ROOT, "data", "raw", "rocketbox", "Assets")
FPS = 30

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

CHARACTERS = {
    "H_Surveyor_W": {"label": "Surveyor (woman)", "avatar": "Professions/Construction_Female_01", "sex": "f"},
    "H_Surveyor_M": {"label": "Surveyor (man)", "avatar": "Professions/Construction_Male_08", "sex": "m"},
}

# the old characters' bone names (people.js: accessories, the head turn, the seated legs) on this
# rig, as three.js names its nodes (spaces become underscores)
BONE_ALIAS = {"Head": "Bip01_Head", "Chest": "Bip01_Spine2", "Abdomen": "Bip01_Spine", "WristR": "Bip01_R_Hand", "WristL": "Bip01_L_Hand",
              "UpperLeg.L": "Bip01_L_Thigh", "LowerLeg.L": "Bip01_L_Calf", "Foot.L": "Bip01_L_Foot",
              "UpperLeg.R": "Bip01_R_Thigh", "LowerLeg.R": "Bip01_R_Calf", "Foot.R": "Bip01_R_Foot"}


def import_fbx(path):
    """The objects an FBX brings in, and its actions."""
    before_o, before_a = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in bpy.data.objects if o not in before_o], [a for a in bpy.data.actions if a not in before_a]


def load_avatar(cid, spec):
    """The avatar's armature and mesh, its textures relinked from the Textures folder (the FBX
    points at the artists' own paths) and its specular maps dropped."""
    folder = os.path.join(RB, "Avatars", spec["avatar"])
    name = os.path.basename(spec["avatar"])
    objs, _ = import_fbx(os.path.join(folder, "Export", f"{name}.fbx"))
    arm = next(o for o in objs if o.type == "ARMATURE")
    for o in objs:
        if o.type == "EMPTY":
            bpy.data.objects.remove(o)
    for im in bpy.data.images:
        p = os.path.join(folder, "Textures", os.path.basename(im.filepath))
        if os.path.exists(p):
            im.filepath = p
            im.reload()
    for m in bpy.data.materials:   # the specular maps (and any texture whose file is missing) go
        for n in list(m.node_tree.nodes):
            if n.type == "TEX_IMAGE" and n.image and ("_specular" in os.path.basename(n.image.filepath) or not os.path.exists(n.image.filepath)):
                m.node_tree.nodes.remove(n)
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Roughness"].default_value = 0.7
    arm.name = f"{cid}_Rig"
    return arm


def rot(m):
    return m.to_3x3().normalized().to_quaternion()


def copy_clip(src, tgt, action, name, helper=None, helper_action=None, loop=False, still=False):
    """Bake a clip onto the avatar: every bone takes the source bone's world orientation (one
    skeleton design, so the bones' axes agree), the pelvis the source's position less its
    forward drift, and the rest follows the avatar's own bone lengths. Returns the action, its
    length in frames and the ground speed (m/s) from the extracted root motion, if any. A clip
    that stands still is cut to MAX_FRAMES and keyed every second frame (it moves slowly)."""
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
    prev = {}
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
            if n == pelvis:
                pb.location = L.translation
                pb.keyframe_insert("location", frame=f - f0)
    tgt.animation_data.action = None
    return act, last - f0, speed


def animate(rig, sex):
    """Every clip in CLIPS on the character, as NLA tracks named for the game, and the ground
    speed of the walk, run and sprint."""
    sc = bpy.context.scene
    sc.render.fps = FPS
    speeds = {}
    for game_name, (clip, kind) in CLIPS.items():
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
def export(rig, path, colour_px=1024, data_px=512):
    """The character as glTF binary: the rig, its mesh and its clips; textures shrunk to
    colour_px (normal maps to data_px) and written as WebP."""
    for im in bpy.data.images:
        w, h = im.size
        lim = data_px if "_normal" in im.name else colour_px
        if max(w, h) > lim:
            im.scale(max(1, lim * w // max(w, h)), max(1, lim * h // max(w, h)))
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for c in rig.children:
        c.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_skins=True,
                              export_animations=True, export_animation_mode="NLA_TRACKS", export_optimize_animation_size=True,
                              export_image_format="WEBP", export_image_quality=80, export_morph=False, export_yup=True)
    before = os.path.getsize(path)
    slim_glb(path)
    print(f"wrote {path} ({os.path.getsize(path) / 1e6:.2f} MB; {before / 1e6:.2f} MB as exported)")


def slim_glb(path, eps=1e-5):
    """Drop the animation channels that hold the node's own value throughout (the exporter bakes
    every bone's translation, rotation and scale on every frame, the face's included), which is
    what three.js shows without them, then repack the binary."""
    data = open(path, "rb").read()
    jlen = struct.unpack("<I", data[12:16])[0]
    j = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack("<I", data[off:off + 4])[0]
    buf = data[off + 8:off + 8 + blen]
    acc, bvs, nodes = j["accessors"], j["bufferViews"], j["nodes"]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
    def values(ai):
        a = acc[ai]
        v = bvs[a["bufferView"]]
        return np.frombuffer(buf, dtype="<f4", count=a["count"] * width[a["type"]],
                             offset=v.get("byteOffset", 0) + a.get("byteOffset", 0)).reshape(a["count"], -1)
    rest = {"translation": [0, 0, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1]}
    for anim in j["animations"]:
        keep = []
        for ch in anim["channels"]:
            out = values(anim["samplers"][ch["sampler"]]["output"])
            t = ch["target"]
            own = np.array(nodes[t["node"]].get(t["path"], rest[t["path"]]), dtype=np.float64)
            tol = {"translation": 1e-3, "scale": 1e-4}.get(t["path"], eps)   # the bake's float noise, in the rig's units
            if np.abs(out - own).max() > tol and not (t["path"] == "rotation" and np.abs(out + own).max() <= tol):
                keep.append(ch)
        used = sorted({ch["sampler"] for ch in keep})
        remap = {o: n for n, o in enumerate(used)}
        anim["samplers"] = [anim["samplers"][o] for o in used]
        for ch in keep:
            ch["sampler"] = remap[ch["sampler"]]
        anim["channels"] = keep
    # the accessors still in use, and their buffer views, repacked in order
    refs = set()
    for m in j.get("meshes", []):
        for pr in m["primitives"]:
            refs.update(pr["attributes"].values())
            if "indices" in pr:
                refs.add(pr["indices"])
    for sk in j.get("skins", []):
        if "inverseBindMatrices" in sk:
            refs.add(sk["inverseBindMatrices"])
    for anim in j["animations"]:
        for sm in anim["samplers"]:
            refs.update((sm["input"], sm["output"]))
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
    j["bufferViews"] = [bvs[o] for o in views]
    j["accessors"] = [dict(acc[o], bufferView=vmap[acc[o]["bufferView"]]) for o in sorted(refs)]
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
    for anim in j["animations"]:
        for sm in anim["samplers"]:
            sm["input"], sm["output"] = amap[sm["input"]], amap[sm["output"]]
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
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
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
