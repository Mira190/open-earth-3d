"""The game's main characters (the surveyors you play and the people who give quests), built
in Blender from MakeHuman's CC0 data: the base mesh shaped by its macro targets (gender, age,
muscle, weight, height, proportions, ancestry), the game-engine skeleton and its weights, and
CC0 skins, eyes, brows, lashes, hair, clothes and shoes fitted with their MHCLO references.
No MakeHuman or MPFB code runs: this script reads their data files (CC0, see
data/raw/makehuman/LICENSE.ASSETS.txt) and does the shaping, rigging and fitting itself.

    pip install bpy==5.2.3                       # Blender as a Python module
    python pipeline/fetch_makehuman.py           # the data, into data/raw/makehuman (once)
    python blender/build_people.py --preview     # Cycles stills of each character -> docs/images/people/

Units: MakeHuman's files are in decimetres with y up (the OBJ frame); Blender here is metres
with z up, the character facing -y, feet on the ground at z = 0.
"""
import argparse
import gzip
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "makehuman")
MPFB = os.path.join(RAW, "mpfb", "data")         # MPFB's bundled assets (CC0): base mesh, targets, rigs
ASSETS = os.path.join(RAW, "assets")             # the MakeHuman system asset pack (CC0): skins, clothes, hair
SCALE = 0.1                                      # decimetres -> metres

# ------------------------------------------------------------------ the characters
# macro values are MakeHuman's 0..1 sliders: gender 0 female .. 1 male; age 0.5 is 25 years,
# 1.0 is 90; muscle, weight, proportions and height 0.5 average. race weights sum to 1.
CHARACTERS = {
    "H_Surveyor_W": {
        "label": "Surveyor (woman)",
        "macro": {"gender": 0.0, "age": 0.53, "muscle": 0.6, "weight": 0.45, "proportions": 0.75, "height": 0.62,
                  "cupsize": 0.45, "firmness": 0.55, "race": {"asian": 0.35, "caucasian": 0.55, "african": 0.1}},
        "skin": "skins/young_caucasian_female/young_caucasian_female.mhmat",
        "eyes": "eyes/materials/brown.mhmat",
        "brows": "eyebrows/eyebrow010/eyebrow010.mhclo",
        "lashes": "eyelashes/eyelashes01/eyelashes01.mhclo",
        "hair": "hair/ponytail01/ponytail01.mhclo",
        "clothes": ["clothes/female_casualsuit01/female_casualsuit01.mhclo", "clothes/shoes02/shoes02.mhclo"],
        "vest": "#d7f531", "hardhat": "#f2f2ee",
    },
    "H_Surveyor_M": {
        "label": "Surveyor (man)",
        "macro": {"gender": 1.0, "age": 0.58, "muscle": 0.62, "weight": 0.52, "proportions": 0.7, "height": 0.6,
                  "cupsize": 0.5, "firmness": 0.5, "race": {"asian": 0.3, "caucasian": 0.5, "african": 0.2}},
        "skin": "skins/young_caucasian_male/young_caucasian_male.mhmat",
        "eyes": "eyes/materials/brown.mhmat",
        "brows": "eyebrows/eyebrow001/eyebrow001.mhclo",
        "lashes": "eyelashes/eyelashes01/eyelashes01.mhclo",
        "hair": "hair/short02/short02.mhclo",
        "clothes": ["clothes/male_worksuit01/male_worksuit01.mhclo", "clothes/shoes01/shoes01.mhclo"],
        "vest": "#f07a1a", "hardhat": "#f2f2ee",
    },
}


# ------------------------------------------------------------------ MakeHuman files
def read_obj(path):
    """Vertices, texture coordinates and faces (vertex and uv indices, from 0) of an OBJ, with
    each face's group."""
    v, vt, faces, group = [], [], [], None
    with open(path, encoding="utf8", errors="replace") as f:
        for line in f:
            if line.startswith("v "):
                v.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("vt "):
                vt.append([float(x) for x in line.split()[1:3]])
            elif line.startswith("g "):
                group = line.split(None, 1)[1].strip()
            elif line.startswith("f "):
                vi, ti = [], []
                for p in line.split()[1:]:
                    a = p.split("/")
                    vi.append(int(a[0]) - 1)
                    ti.append(int(a[1]) - 1 if len(a) > 1 and a[1] else -1)
                faces.append((vi, ti, group))
    return np.array(v, dtype=np.float64), np.array(vt, dtype=np.float64), faces


def read_target(path):
    """A .target(.gz): offsets for some vertices, OBJ frame, decimetres."""
    op = gzip.open if path.endswith(".gz") else open
    idx, d = [], []
    with op(path, "rt") as f:
        for line in f:
            p = line.split()
            if len(p) == 4 and not line.startswith("#"):
                idx.append(int(p[0])); d.append([float(p[1]), float(p[2]), float(p[3])])
    return np.array(idx, dtype=np.int64), np.array(d, dtype=np.float64).reshape(-1, 3)


def read_mhmat(path):
    """Key-value lines of a material; texture paths resolved next to the file."""
    out, base = {}, os.path.dirname(path)
    with open(path, encoding="utf8", errors="replace") as f:
        for line in f:
            p = line.strip().split(None, 1)
            if len(p) == 2 and not p[0].startswith("#"):
                out[p[0]] = p[1].strip()
    for k in list(out):
        if k.endswith("Texture"):
            out[k] = os.path.join(base, os.path.basename(out[k]))
    return out


def read_mhclo(path):
    """A fitted asset: per vertex three base-mesh references, their weights and an offset (or a
    single reference), the scale references, the base-mesh vertices it hides, and its files."""
    info = {"refs": [], "weights": [], "offsets": [], "delete": [], "scale": {}}
    section = None
    base = os.path.dirname(path)
    with open(path, encoding="utf8", errors="replace") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            p = s.split()
            if p[0] == "verts":
                section = "verts"; continue
            if p[0] == "delete_verts":
                section = "delete"; continue
            numeric = p[0].lstrip("-").replace(".", "", 1).isdigit()
            if section == "verts" and numeric:
                if len(p) == 1:
                    info["refs"].append([int(p[0])] * 3); info["weights"].append([1, 0, 0]); info["offsets"].append([0, 0, 0])
                else:
                    info["refs"].append([int(x) for x in p[0:3]]); info["weights"].append([float(x) for x in p[3:6]])
                    info["offsets"].append([float(x) for x in p[6:9]])
                continue
            if section == "delete":
                toks, i = p, 0
                while i < len(toks):
                    if i + 2 < len(toks) and toks[i + 1] == "-":
                        info["delete"].extend(range(int(toks[i]), int(toks[i + 2]) + 1)); i += 3
                    else:
                        info["delete"].append(int(toks[i])); i += 1
                continue
            if section == "delete":
                section = None
            if p[0] in ("x_scale", "y_scale", "z_scale"):
                info["scale"][p[0][0]] = (int(p[1]), int(p[2]), float(p[3]))
            elif p[0] in ("obj_file", "material", "name", "z_depth"):
                info[p[0]] = os.path.join(base, p[1]) if p[0] in ("obj_file", "material") else p[1]
    for k in ("refs", "weights", "offsets"):
        info[k] = np.array(info[k], dtype=np.float64 if k != "refs" else np.int64)
    return info


# ------------------------------------------------------------------ shaping: macro targets
_MACRO = None


def macro_parts(name, value):
    """MakeHuman's macro interpolation: the two named targets either side of the value and
    their weights (an empty name is the neutral shape)."""
    out = []
    for part in _MACRO["macrotargets"][name]["parts"]:
        lo, hi = part["lowest"], part["highest"]
        if lo < value < hi:
            t = (value - lo) / (hi - lo)
            if part["low"]:
                out.append((part["low"], 1 - t))
            if part["high"]:
                out.append((part["high"], t))
    return out


def macro_targets(m, cutoff=0.01):
    """The weighted target files for a set of macro values, as MakeHuman combines them."""
    global _MACRO
    if _MACRO is None:
        _MACRO = json.load(open(os.path.join(MPFB, "targets", "macrodetails", "macro.json")))
    c = {k: macro_parts(k, m[k]) for k in ("gender", "age", "muscle", "weight", "proportions", "height", "cupsize", "firmness")}
    out = []
    for race, rw in m["race"].items():
        if rw > 1e-4:
            for a, aw in c["age"]:
                for g, gw in c["gender"]:
                    out.append((f"macrodetails/{race}-{g}-{a}", rw * gw * aw))
    for g, gw in c["gender"]:
        for a, aw in c["age"]:
            for mu, mw in c["muscle"]:
                for w, ww in c["weight"]:
                    base = gw * aw * mw * ww
                    out.append((f"macrodetails/universal-{g}-{a}-{mu}-{w}", base))
                    for h, hw in c["height"]:
                        out.append((f"macrodetails/height/{g}-{a}-{mu}-{w}-{h}", base * hw))
                    for pr, pw in c["proportions"]:
                        if a != "baby":
                            out.append((f"macrodetails/proportions/{g}-{a}-{mu}-{w}-{pr}", base * pw))
                    if g == "female":
                        for cu, cw in c["cupsize"]:
                            for fi, fw in c["firmness"]:
                                name = f"breast/female-{a}-{mu}-{w}-{cu}-{fi}"
                                if "averagecup-averagefirmness" not in name and a != "baby":
                                    out.append((name, aw * mw * ww * cw * fw))
    return [(n, w) for n, w in out if w > cutoff]


def shaped_base(macro):
    """The base mesh's vertices (OBJ frame, decimetres) with the macro targets applied."""
    v, vt, faces = read_obj(os.path.join(MPFB, "3dobjs", "base.obj"))
    shaped = v.copy()
    for name, w in macro_targets(macro):
        path = os.path.join(MPFB, "targets", name + ".target.gz")
        if not os.path.exists(path):
            print("  missing target", name); continue
        idx, d = read_target(path)
        shaped[idx] += w * d
    return shaped, vt, faces


def to_blender(p):
    """OBJ frame (decimetres, y up, facing +z) -> Blender (metres, z up, facing -y)."""
    p = np.asarray(p)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1) * SCALE


def group_ranges(name, groups):
    return np.concatenate([np.arange(a, b + 1) for a, b in groups[name]])


# ------------------------------------------------------------------ Blender helpers
def new_mesh(name, verts, faces, uvs=None, face_uvs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(x) for x in verts], [], [tuple(f) for f in faces])
    if uvs is not None:
        layer = me.uv_layers.new(name="UVMap")
        loop_uv = []
        for fu in face_uvs:
            loop_uv.extend(fu)
        coords = uvs[np.array(loop_uv)]
        layer.data.foreach_set("uv", coords.ravel())
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def image(path, colour=True):
    im = bpy.data.images.load(path, check_existing=True)
    if not colour:
        im.colorspace_settings.name = "Non-Color"
    return im


def material(name, mh, *, rough=0.6, alpha=False, sheen=0.0):
    """A Principled material from a .mhmat: colour (with ambient occlusion multiplied in),
    normal map, and an alpha cut-out for brows, lashes and hair."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    if sheen:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    col = None
    if mh.get("diffuseTexture") and os.path.exists(mh["diffuseTexture"]):
        tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = image(mh["diffuseTexture"])
        col = tex.outputs["Color"]
        if alpha:
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        if mh.get("aomapTexture") and os.path.exists(mh["aomapTexture"]):
            ao = nt.nodes.new("ShaderNodeTexImage"); ao.image = image(mh["aomapTexture"], colour=False)
            mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            nt.links.new(col, mix.inputs[6]); nt.links.new(ao.outputs["Color"], mix.inputs[7])
            col = mix.outputs[2]
        nt.links.new(col, bsdf.inputs["Base Color"])
    else:
        c = [float(x) for x in mh.get("diffuseColor", "0.8 0.8 0.8").split()[:3]]
        bsdf.inputs["Base Color"].default_value = (*c, 1)
    if mh.get("normalmapTexture") and os.path.exists(mh["normalmapTexture"]):
        nm = nt.nodes.new("ShaderNodeTexImage"); nm.image = image(mh["normalmapTexture"], colour=False)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = float(mh.get("normalmapIntensity", 1.0))
        nt.links.new(nm.outputs["Color"], nmap.inputs["Color"]); nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    if alpha:
        m.blend_method = "HASHED" if hasattr(m, "blend_method") else None
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "DITHERED"
    return m


# ------------------------------------------------------------------ one character
def build(cid, spec):
    t0 = time.time()
    groups = json.load(open(os.path.join(MPFB, "mesh_metadata", "basemesh_vertex_groups.json")))
    shaped, vt, faces = shaped_base(spec["macro"])
    # the body: the base mesh's 'body' faces; its helper and joint geometry only places the rig and the clothes
    body_faces = [f for f in faces if f[2] == "body"]
    used = np.unique(np.concatenate([f[0] for f in body_faces]))
    vb = to_blender(shaped)
    ground = vb[used, 2].min()
    vb[:, 2] -= ground
    remap = -np.ones(len(vb), dtype=np.int64); remap[used] = np.arange(len(used))
    body = new_mesh(f"{cid}_Body", vb[used], [[remap[i] for i in f[0]] for f in body_faces], vt, [f[1] for f in body_faces])

    # the skeleton: each bone's head and tail at the centre of a joint cube (or the mean of listed vertices)
    rig_def = json.load(open(os.path.join(MPFB, "rigs", "standard", "rig.game_engine.json")))
    def place(e):
        if e["strategy"] == "CUBE":
            return vb[group_ranges(e["cube_name"], groups)].mean(axis=0)
        return vb[np.array(e["vertex_indices"])].mean(axis=0)
    arm = bpy.data.armatures.new(f"{cid}_Rig")
    rig = bpy.data.objects.new(f"{cid}_Rig", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, b in rig_def.items():
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = Vector(place(b["head"])), Vector(place(b["tail"]))
        if (eb.tail - eb.head).length < 1e-4:
            eb.tail = eb.head + Vector((0, 0, 0.02))
        eb.roll = b.get("roll", 0.0)
    for name, b in rig_def.items():
        if b["parent"]:
            arm.edit_bones[name].parent = arm.edit_bones[b["parent"]]
            arm.edit_bones[name].use_connect = bool(b.get("use_connect"))
    bpy.ops.object.mode_set(mode="OBJECT")

    # weights, by base-mesh vertex; kept per vertex for the fitted assets
    wdef = json.load(open(os.path.join(MPFB, "rigs", "standard", "weights.game_engine.json")))["weights"]
    bones = list(rig_def)
    W = np.zeros((len(vb), len(bones)), dtype=np.float32)
    for j, bn in enumerate(bones):
        for vi, w in wdef.get(bn, []):
            W[vi, j] += w
    skin_object(body, W[used], bones, rig)

    # skin
    skin = read_mhmat(os.path.join(ASSETS, spec["skin"]))
    body.data.materials.append(material(f"{cid}_Skin", skin, rough=0.5, sheen=0.1))

    # eyes, brows, lashes, hair, clothes: fitted to the shaped body
    hidden = set()
    parts = [("Eyes", "eyes/low-poly/low-poly.mhclo", spec["eyes"]), ("Brows", spec["brows"], None),
             ("Lashes", spec["lashes"], None), ("Hair", spec["hair"], None)]
    parts += [(os.path.basename(c).split(".")[0], c, None) for c in spec["clothes"]]
    for label, rel, mat_override in parts:
        if not os.path.exists(os.path.join(ASSETS, rel)):
            print(f"  missing {rel} (python pipeline/fetch_makehuman.py)"); continue
        clo = read_mhclo(os.path.join(ASSETS, rel))
        av, avt, afaces = read_obj(clo["obj_file"])
        n = len(av)
        r, w, off = clo["refs"][:n], clo["weights"][:n], clo["offsets"][:n]
        # scale of the offsets: the distance between two reference vertices, against its value
        # when the asset was made, per axis
        s = np.ones(3)
        for k, ax in (("x", 0), ("y", 1), ("z", 2)):
            if k in clo["scale"]:
                a, b, den = clo["scale"][k]
                s[ax] = abs(shaped[a, ax] - shaped[b, ax]) / den
        fit = (shaped[r] * w[:, :, None]).sum(axis=1) + off * s
        fb = to_blender(fit); fb[:, 2] -= ground
        ob = new_mesh(f"{cid}_{label}", fb, [f[0] for f in afaces], avt if len(avt) else None,
                      [f[1] for f in afaces] if len(avt) else None)
        aw = (W[r] * w[:, :, None]).sum(axis=1)
        skin_object(ob, aw, bones, rig)
        mh = read_mhmat(os.path.join(ASSETS, mat_override) if mat_override else clo["material"])
        cut = label in ("Brows", "Lashes", "Hair") or mh.get("transparent") == "True"
        ob.data.materials.append(material(f"{cid}_{label}", mh, rough=0.45 if label == "Eyes" else 0.75, alpha=cut, sheen=0.3 if label not in ("Eyes",) else 0))
        if label not in ("Eyes", "Brows", "Lashes", "Hair"):
            hidden.update(clo["delete"])
    if spec.get("vest"):
        vest(cid, spec["vest"], vb, used, remap, body_faces, W, bones, rig, groups)
    if spec.get("hardhat"):
        hardhat(cid, spec["hardhat"], vb, groups, bones, rig)
    # the skin the clothes cover goes, so it can't show through when the body bends
    if hidden:
        hide = np.zeros(len(vb), dtype=bool); hide[list(hidden)] = True
        drop = [remap[i] for i in np.nonzero(hide)[0] if remap[i] >= 0]
        import bmesh
        bm = bmesh.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in drop], context="VERTS")
        bm.to_mesh(body.data); bm.free()
    tris = sum(len(p.vertices) - 2 for o in rig.children for p in o.data.polygons)
    print(f"{cid}: {tris} triangles, {len(bones)} bones, {time.time() - t0:.1f} s")
    return rig


def lin(hex_):
    h = hex_.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def flat_material(name, hex_, rough=0.6, metal=0.0, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(hex_)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = lin(hex_)
        b.inputs["Emission Strength"].default_value = emit
    return m


def vest(cid, colour, vb, used, remap, body_faces, W, bones, rig, groups):
    """A hi-vis vest, lofted round the torso: rings from the hip to the shoulders, each following
    the body's own cross-section at its height (the torso without the arms) and pushed out over
    the clothes. Below the armpits the rings close; above, the sides open for the arms, the top
    row stays whole as the yoke over the shoulders, and a V opens at the neck. Two reflective
    bands run round it on whole rows, so they stay straight."""
    from mathutils import kdtree
    lead = np.array(bones)[W.argmax(axis=1)]
    body = np.zeros(len(vb), dtype=bool); body[used] = True
    torso = body & np.isin(lead, ["pelvis", "spine_01", "spine_02", "spine_03", "clavicle_l", "clavicle_r"]) & (W.max(axis=1) > 0)
    J = lambda g: vb[group_ranges(g, groups)].mean(axis=0)
    z_hip, z_sh = J("joint-pelvis")[2], J("joint-l-shoulder")[2]
    z0, z1 = z_hip + 0.03, z_sh + 0.035
    z_arm = z_sh - 0.10
    NZ, NA, OFF = 14, 72, 0.022
    ang = np.linspace(0, 2 * np.pi, NA, endpoint=False)
    P = vb[torso]
    rings = []
    for z in np.linspace(z0, z1, NZ):
        slab = P[np.abs(P[:, 2] - z) < 0.02]
        cx, cy = slab[:, 0].mean(), slab[:, 1].mean()
        th = np.arctan2(slab[:, 0] - cx, -(slab[:, 1] - cy)) % (2 * np.pi)   # 0 at the front (-y), pi/2 the left (+x)
        rr = np.hypot(slab[:, 0] - cx, slab[:, 1] - cy)
        r = np.full(NA, np.nan)
        for i, a in enumerate(ang):
            d = np.abs((th - a + np.pi) % (2 * np.pi) - np.pi)
            if (d < 0.14).any():
                r[i] = rr[d < 0.14].max()
        ok = ~np.isnan(r)
        r = np.interp(ang, ang[ok], r[ok], period=2 * np.pi)
        r = (np.roll(r, 1) + 2 * r + np.roll(r, -1)) / 4 + OFF                # smooth round the ring
        rings.append(np.stack([cx + r * np.sin(ang), cy - r * np.cos(ang), np.full(NA, z)], axis=1))
    verts = np.concatenate(rings)
    zs = np.linspace(z0, z1, NZ)
    faces, mats = [], []
    bands = (z0 + (z_arm - z0) * 0.25, z0 + (z_arm - z0) * 0.75)
    for j in range(NZ - 1):
        zc = (zs[j] + zs[j + 1]) / 2
        for i in range(NA):
            a = (ang[i] + np.pi / NA) % (2 * np.pi)
            side = abs(np.sin(a)) > 0.78
            if z_arm < zc < zs[-3] and side:
                continue                                                      # the armholes
            vneck = np.radians(6 + 20 * max(0.0, (zc - (z_arm + 0.02)) / (z1 - z_arm)))
            if zc > z_arm + 0.02 and min(a, 2 * np.pi - a) < vneck:
                continue                                                      # the V at the front
            faces.append([j * NA + i, j * NA + (i + 1) % NA, (j + 1) * NA + (i + 1) % NA, (j + 1) * NA + i])
            mats.append(1 if any(abs(zc - b) < (zs[1] - zs[0]) * 0.55 for b in bands) else 0)
    me = bpy.data.meshes.new(f"{cid}_Vest")
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(f"{cid}_Vest", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(flat_material(f"{cid}_Vest", colour, rough=0.55, emit=0.12))
    ob.data.materials.append(flat_material(f"{cid}_Reflective", "#c9ccd0", rough=0.25, metal=0.6))
    for p, m in zip(me.polygons, mats):
        p.material_index = m
        p.use_smooth = True
    # the cut edges follow the grid in steps: smooth them along themselves into curves
    import bmesh
    bm = bmesh.new(); bm.from_mesh(me)
    edge_verts = [v for v in bm.verts if v.is_boundary and z0 + 0.01 < v.co.z]
    for _ in range(6):
        new = {}
        for v in edge_verts:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                new[v] = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
        for v, c in new.items():
            v.co = c
    bm.to_mesh(me); bm.free()
    sol = ob.modifiers.new("Thickness", "SOLIDIFY"); sol.thickness = 0.005; sol.offset = 1
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=sol.name)
    # weights from the nearest torso vertices
    idx = np.nonzero(torso)[0]
    kd = kdtree.KDTree(len(idx))
    for k, vi in enumerate(idx):
        kd.insert(Vector(vb[vi]), k)
    kd.balance()
    Wv = np.zeros((len(ob.data.vertices), len(bones)), dtype=np.float32)
    for n, v in enumerate(ob.data.vertices):
        near = kd.find_n(v.co, 4)
        tot = 0.0
        for co, k, dist in near:
            w = 1.0 / (dist + 1e-3); Wv[n] += w * W[idx[k]]; tot += w
        Wv[n] /= tot
    skin_object(ob, Wv, bones, rig)


def hardhat(cid, colour, vb, groups, bones, rig):
    """A hard hat: a dome over the crown and a short brim with a longer peak at the front, sized
    to the head and carried by the head bone."""
    top = vb[group_ranges("joint-head-2", groups)].mean(axis=0)
    r = 0.126
    c = Vector((top[0], top[1] + 0.006, top[2] - 0.062))
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.005], context="VERTS")
    for v in bm.verts:
        v.co.x *= 0.93; v.co.y *= 1.08; v.co.z *= 0.95
    # the brim: a ring round the rim, out a little at the sides and further at the front (-y)
    rim = [e for e in bm.edges if e.is_boundary]
    ext = bmesh.ops.extrude_edge_only(bm, edges=rim)
    for v in [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]:
        d = Vector((v.co.x, v.co.y, 0)).normalized()
        out = 0.022 + 0.045 * max(0.0, -d.y) ** 2
        v.co += d * out
        v.co.z -= 0.012
    bmesh.ops.translate(bm, verts=bm.verts, vec=c)
    me = bpy.data.meshes.new(f"{cid}_Hardhat"); bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(f"{cid}_Hardhat", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(flat_material(f"{cid}_Hardhat", colour, rough=0.35))
    sol = ob.modifiers.new("Thickness", "SOLIDIFY"); sol.thickness = 0.004
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=sol.name)
    Wh = np.zeros((len(me.vertices), len(bones)), dtype=np.float32); Wh[:, bones.index("head")] = 1
    skin_object(ob, Wh, bones, rig)


def skin_object(ob, W, bones, rig, keep=4):
    """Vertex groups from a weight matrix (the strongest `keep` per vertex, normalised), an
    armature modifier, and the rig as parent."""
    for bn in bones:
        ob.vertex_groups.new(name=bn)
    top = np.argsort(-W, axis=1)[:, :keep]
    for vi in range(W.shape[0]):
        ws = W[vi, top[vi]]
        tot = ws.sum()
        if tot <= 0:
            continue
        for j, wv in zip(top[vi], ws / tot):
            if wv > 1e-4:
                ob.vertex_groups[bones[j]].add([vi], float(wv), "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE"); mod.object = rig
    ob.parent = rig


# ------------------------------------------------------------------ animation: Mesh2Motion's CC0 clips, retargeted
M2M = os.path.join(ROOT, "data", "raw", "mesh2motion")           # human-base-animations.glb, human-addon-animations.glb (CC0)
# the game's clip name -> the source clip; women walk and run with the library's women's cycles
CLIPS = {"Idle": "Idle_Subtle", "Idle_Neutral": "Idle_A", "Walk": "Walk", "Run": "Jog", "Sprint": "Sprint",
         "Wave": "Greeting", "Talk": "Idle_Talking", "Listen": "Idle Listening", "Nod": "Head Nod", "Interact": "Interact"}
CLIPS_W = {"Walk": "Walk_Female", "Run": "Run_Female"}
FPS = 30


def import_skeleton(path):
    """A source GLB's armature (its meshes dropped) and its actions."""
    before_o, before_a = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before_o]
    arm = next(o for o in new if o.type == "ARMATURE")
    for o in new:
        if o.type == "MESH":
            bpy.data.objects.remove(o)
    return arm, {a.name: a for a in bpy.data.actions if a not in before_a}


def child_of(name, bones):
    """The next joint along a bone in the Unreal-style skeleton both rigs share."""
    side = name[-2:] if name.endswith(("_l", "_r")) else ""
    stem = name[:-2] if side else name
    chain = {"pelvis": "spine_01", "spine_01": "spine_02", "spine_02": "spine_03", "spine_03": "neck_01", "neck_01": "head",
             "head": "head_leaf", "clavicle": "upperarm", "upperarm": "lowerarm", "lowerarm": "hand", "hand": "middle_01",
             "thigh": "calf", "calf": "foot", "foot": "ball", "ball": "ball_leaf"}
    if stem in chain:
        c = chain[stem]
    elif stem.rsplit("_", 1)[-1].isdigit():   # fingers: index_01 -> index_02 -> index_03 -> index_04_leaf
        f, k = stem.rsplit("_", 1)
        c = f"{f}_{int(k) + 1:02d}" + ("_leaf" if int(k) + 1 == 4 else "")
    else:
        return None
    c = c if c == "head_leaf" else c + side
    return c if c in bones else None


def rot(m):
    return m.to_3x3().normalized().to_quaternion()


def retarget(src, rig, action, name):
    """Bake a source clip onto the character's rig. Each bone's rest direction is first turned
    onto the source's (the rigs rest in different poses), then follows the source's rotation
    from rest, in world space; the pelvis also takes the source's movement, scaled by hip
    height. The result is an action of local rotations (and the pelvis's location)."""
    sc = bpy.context.scene
    src.animation_data_create()
    src.animation_data.action = action
    f0, f1 = (int(round(x)) for x in action.frame_range)
    Ms, Mt = src.matrix_world.copy(), rig.matrix_world.copy()
    Mt_rot_inv = rot(Mt).inverted()
    sb, tb = src.data.bones, rig.data.bones
    names = sorted((b.name for b in tb if b.name in sb), key=lambda n: len(tb[n].parent_recursive))
    def dir_src(b):
        c = child_of(b.name, sb)
        return ((Ms @ (sb[c].head_local if c else b.tail_local)) - (Ms @ b.head_local)).normalized()
    def dir_tgt(b):
        return ((Mt @ b.tail_local) - (Mt @ b.head_local)).normalized()
    rs0 = {n: rot(Ms @ sb[n].matrix_local) for n in names}
    rt0 = {n: dir_tgt(tb[n]).rotation_difference(dir_src(sb[n])) @ rot(Mt @ tb[n].matrix_local) for n in names}
    k = (Mt @ tb["pelvis"].head_local).z / max(1e-6, (Ms @ sb["pelvis"].head_local).z)
    hs0 = Ms @ sb["pelvis"].head_local
    act = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    prev = {}
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        P = {}
        for n in names:
            b = tb[n]
            rt = Mt_rot_inv @ (rot(Ms @ src.pose.bones[n].matrix) @ rs0[n].inverted() @ rt0[n])
            par = b.parent
            Pp = P.get(par.name, par.matrix_local) if par else None
            if n == "pelvis":
                head = Mt.inverted() @ ((Mt @ b.head_local) + ((Ms @ src.pose.bones[n].head) - hs0) * k)
            elif par:
                head = (Pp @ par.matrix_local.inverted() @ b.matrix_local).translation
            else:
                head = b.head_local.copy()
            P[n] = Matrix.Translation(head) @ rt.to_matrix().to_4x4()
            L = (b.matrix_local.inverted() @ par.matrix_local @ Pp.inverted() @ P[n]) if par else b.matrix_local.inverted() @ P[n]
            q = L.to_quaternion()
            if n in prev and prev[n].dot(q) < 0:
                q.negate()
            prev[n] = q
            pb = rig.pose.bones[n]
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f - f0)
            if n == "pelvis":
                pb.location = L.translation
                pb.keyframe_insert("location", frame=f - f0)
    return act, f1 - f0


def ground_speed(rig, act, frames):
    """How fast a foot planted on the ground slides back through the cycle (m/s): the speed the
    character must move for the feet not to slip."""
    rig.animation_data.action = act
    sc = bpy.context.scene
    ys, zs = {"ball_l": [], "ball_r": []}, {"ball_l": [], "ball_r": []}
    for f in range(frames + 1):
        sc.frame_set(f)
        for n in ys:
            p = rig.matrix_world @ rig.pose.bones[n].head
            ys[n].append(p.y); zs[n].append(p.z)
    v = []
    for n in ys:
        z = np.array(zs[n]); y = np.array(ys[n])
        low = z < z.min() + 0.03
        for i in range(frames):
            if low[i] and low[i + 1]:
                v.append((y[i + 1] - y[i]) * FPS)
    return float(np.median(v)) if v else 0.0


def animate(rig, female):
    """Every clip in CLIPS on the character, as NLA tracks named for the game, and the ground
    speed of the walk, run and sprint."""
    sc = bpy.context.scene
    sc.render.fps = FPS
    sources = {}
    for f in ("human-base-animations.glb", "human-addon-animations.glb"):
        arm, acts = import_skeleton(os.path.join(M2M, f))
        for a in acts.values():
            sources[a.name] = (arm, a)
    speeds = {}
    for game_name, src_name in CLIPS.items():
        src_name = (CLIPS_W if female else {}).get(game_name, src_name)
        if src_name not in sources:
            print("  no clip", src_name); continue
        arm, a = sources[src_name]
        act, n = retarget(arm, rig, a, game_name)
        if game_name in ("Walk", "Run", "Sprint"):
            speeds[game_name] = round(ground_speed(rig, act, n), 3)
        track = rig.animation_data.nla_tracks.new()
        track.name = game_name
        track.strips.new(game_name, 0, act)
        rig.animation_data.action = None
    for arm, _ in {id(v[0]): v for v in sources.values()}.values():
        bpy.data.objects.remove(arm)
    return speeds


# ------------------------------------------------------------------ export
def export(rig, path, colour_px=1024, data_px=512):
    """The character as glTF binary: the rig, its meshes (one skin) and its clips; textures
    shrunk to colour_px (normal and other data maps to data_px) and written as WebP, which
    keeps the alpha of brows, lashes and hair."""
    for im in bpy.data.images:
        w, h = im.size
        lim = data_px if im.colorspace_settings.name == "Non-Color" else colour_px
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
    print(f"wrote {path} ({os.path.getsize(path) / 1e6:.2f} MB)")


# ------------------------------------------------------------------ preview
def preview(rig, path):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 900, 1200
    sc.render.film_transparent = False
    world = bpy.data.worlds.new("Studio"); sc.world = world; world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.66, 0.70, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    sun = bpy.data.objects.new("Key", bpy.data.lights.new("Key", "SUN")); sc.collection.objects.link(sun)
    sun.data.energy = 3.2; sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); sc.collection.objects.link(cam)
    cam.data.lens = 70
    cam.location = (0.9, -4.6, 1.15); cam.rotation_euler = (math.radians(88), 0, math.radians(11))
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("wrote", path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="character ids")
    ap.add_argument("--preview", action="store_true", help="Cycles stills -> docs/images/people/")
    ap.add_argument("--pose", help="preview a clip at a frame instead of the rest pose, e.g. Walk:10")
    ap.add_argument("--no-export", action="store_true", help="build (and preview) without writing the GLB")
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    heroes = {}
    for cid, spec in CHARACTERS.items():
        if args.only and cid not in args.only:
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        rig = build(cid, spec)
        speeds = animate(rig, spec["macro"]["gender"] < 0.5)
        print(f"  ground speeds {speeds}")
        if args.preview:
            out = os.path.join(ROOT, "docs", "images", "people"); os.makedirs(out, exist_ok=True)
            name = f"{cid}.png"
            if args.pose:
                clip, frame = args.pose.split(":")
                track = rig.animation_data.nla_tracks[clip]
                rig.animation_data.action = track.strips[0].action
                bpy.context.scene.frame_set(int(frame))
                name = f"{cid}_{clip}{frame}.png"
            for t in rig.animation_data.nla_tracks:   # the rest pose, or the one clip asked for
                t.mute = True
            if not args.pose:
                for pb in rig.pose.bones:
                    pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
            preview(rig, os.path.join(out, name))
            for t in rig.animation_data.nla_tracks:
                t.mute = False
            rig.animation_data.action = None
        if not args.no_export:
            out = os.path.join(ROOT, "web", "assets", "people"); os.makedirs(out, exist_ok=True)
            export(rig, os.path.join(out, f"{cid}.glb"))
            body = bpy.data.objects[f"{cid}_Body"]
            heroes[cid] = {"file": f"{cid}.glb", "label": spec["label"], "ground_speed": speeds,
                           "height_m": round(max((body.matrix_world @ v.co).z for v in body.data.vertices), 3),
                           "triangles": sum(len(p.vertices) - 2 for o in rig.children for p in o.data.polygons),
                           "clips": [t.name for t in rig.animation_data.nla_tracks]}
    if heroes and not args.no_export:
        write_people_json(heroes)


# the old characters' bone names (people.js: accessories, the head turn, the seated legs) on this rig
BONE_ALIAS = {"Head": "head", "Chest": "spine_03", "Abdomen": "spine_01", "WristR": "hand_r", "WristL": "hand_l",
              "UpperLeg.L": "thigh_l", "LowerLeg.L": "calf_l", "Foot.L": "foot_l", "UpperLeg.R": "thigh_r", "LowerLeg.R": "calf_r", "Foot.R": "foot_r"}


def write_people_json(heroes):
    """The main characters in web/assets/people/people.json, under "heroes" (kept apart from the
    crowd's "characters", which the crowd draws from)."""
    path = os.path.join(ROOT, "web", "assets", "people", "people.json")
    info = json.load(open(path))
    old = info.get("heroes", {}).get("characters", {})
    info["heroes"] = {
        "note": "The main characters: built by blender/build_people.py from MakeHuman's CC0 base mesh, targets, rig, skins, "
                "clothes and hair, with Mesh2Motion's CC0 animations retargeted. Textured, so not recoloured per look.",
        "source": "MakeHuman (CC0 1.0): base mesh, targets, game-engine rig, system assets; Mesh2Motion (CC0 1.0): animations",
        "bones": BONE_ALIAS,
        "characters": {**old, **heroes},
    }
    json.dump(info, open(path, "w"), indent=1)
    print("updated", path)


if __name__ == "__main__":
    main()
