"""People for the game: rigged, animated characters from Quaternius's Ultimate Modular
Men and Ultimate Modular Women packs (CC0 1.0, public domain;
https://quaternius.com/packs/ultimatemodularcharacters.html and .../ultimatemodularwomen.html).
Realistic proportions and everyday clothes, 5,000 to 10,000 triangles each, no textures.

    python pipeline/fetch_people.py      # -> web/assets/people/

writes:

- `<Name>.glb`: the character as one skinned mesh, one draw call. Each vertex carries a
  palette index (`_MAT`) instead of a material, so the game can recolour skin, hair and
  clothes per person: one character file makes many different people.
- `anims_M.glb`, `anims_W.glb`: the animations the game uses, once per pack (the men
  share one skeleton, the women another).
- `crowd.glb`: a low-detail copy of every character for the distant crowd, standing in
  the pack's neutral pose, simplified by vertex clustering. Each vertex carries a body
  part (`_PART`: thigh, shin or arm), so the game can swing legs and arms in the vertex
  shader and draw hundreds of people with one instanced draw call per character.
- `people.json`: the list, the palettes and which entries are skin, hair and clothes.

The pack's glTF files embed their buffers as base64. This rewrites them as binary GLB
with only what the game uses: no UVs (there are no textures), and 8-bit normals, joints
and weights (KHR_mesh_quantization). Weapons in the pack (the suit's pistol) are left out.
"""
import base64
import json
import os
import struct
import sys
import time

import numpy as np
import requests

from cityctx import ROOT

DRIVE = "https://drive.usercontent.google.com/download?id={}&export=download"
# file ids in the packs' "Individual Characters/glTF" folders on Google Drive
# (men: drive.google.com/drive/folders/1qpSIycVWTwhKMgyA_bEFHPh1CfBBBa09,
#  women: drive.google.com/drive/folders/1_FIjjIVE0SkQIrwgWJ3Q8NQku25ll5a2)
# Recolourable palette entries are "<part>/<material>", part being the mesh node's
# suffix (Body, Feet, Head, Legs). Skin is always recolourable; "brows" follow the hair.
CHARACTERS = {
    "M_Casual2": ("1Jn7kULNmrtqP8BUUL19h8MhbdOnwPFhv", {"hair": ["Head/Hair"], "brows": ["Head/Eyebrows"], "top": ["Body/LightBrown"], "legs": ["Legs/LightBlue"]}),
    "M_Hoodie": ("1em1So1xwwQNfHJYMvzKcXkZllvtxpKP5", {"hair": ["Head/Hair"], "brows": ["Head/Eyebrows"], "top": ["Body/Purple"], "legs": ["Legs/LightBlue"]}),
    "M_Suit": ("1NhXHnGU0zK9hBrT5FoZp8nTz_EmvTPg5", {"hair": ["Head/Hair"], "brows": ["Head/Eyebrows"]}),
    "M_Worker": ("14d8n7IDnnlnGt_uiATnNg3uvi_4dyd9V", {"brows": ["Head/Eyebrows", "Head/Moustache"]}),
    "M_Beach": ("1IL1YJPJvNkuGnKI69-W-VMBIDCo-u49N", {"hair": ["Head/Hair"], "brows": ["Head/Eyebrows"], "top": ["Body/LightBrown"], "legs": ["Legs/Red_Dark"]}),
    "M_Adventurer": ("1fzSq1Rr037f7QkfXPWEAzmbLMNx-FpPA", {"hair": ["Head/Hair"], "brows": ["Head/Eyebrows"]}),
    "M_Punk": ("1yHWu5ezXq4dYBcn4sWiNd16YN9fMtXo0", {}),
    "W_Casual": ("18b3WwlrwrFYWAM7BcnjWeIxKJyxAQiGh", {"hair": ["Head/Hair_Blond"], "brows": ["Head/Hair_Brown"], "top": ["Body/White"], "legs": ["Legs/Orange"]}),
    "W_Formal": ("1iayBzVv_zLjuPtaNPouw_auwKlQLLmes", {"hair": ["Head/Red"], "top": ["Body/LimeGreen", "Legs/LimeGreen"]}),
    "W_Suit": ("1GjWtofxjmPku25cXJxHrzLLeUbXw7A_s", {"hair": ["Head/Hair_Blond"], "brows": ["Head/Hair_Brown"]}),
    "W_Worker": ("1iwF_fqDErPH9uyol6NmS-MnzGgsZ5ejV", {"hair": ["Head/DarkBrown"]}),
    "W_Adventurer": ("1uxAFnDp73NO1c16LvHHjAYh1-deMNk5I", {"hair": ["Head/Hair_Brown"]}),
    "W_Punk": ("1ITb_iFiroAsmjQI38z_p6nNXinwliVLA", {}),
}
WEAPONS = {"Pistol", "Revolver", "Sword", "Knife", "Gun", "Shotgun"}
ANIM_SOURCE = {"M": "M_Casual2", "W": "W_Casual"}
ANIMS = ["Idle", "Idle_Neutral", "Walk", "Run", "Wave", "Interact"]
CLASSES = ["keep", "skin", "hair", "brows", "top", "legs"]
POSE = "Idle_Neutral"          # the crowd's standing pose
CELL = 0.055                   # crowd simplification grid, m
# crowd body parts, as the game's shader reads them: 1/2 left/right thigh, 5/6 shin and
# foot, 3/4 arm and hand, 0 everything else
ARM = ("UpperArm", "LowerArm", "Wrist", "Index", "Middle", "Ring", "Pinky", "Thumb")


def part_of(joint):
    base, _, side = joint.partition(".")
    if side not in ("L", "R"):
        return 0
    left = side == "L"
    if base == "UpperLeg":
        return 1 if left else 2
    if base in ("LowerLeg", "Foot", "Toe"):
        return 5 if left else 6
    if base.rstrip("0123456789") in ARM:
        return 3 if left else 4
    return 0


def fetch(name, fid, cache):
    path = os.path.join(cache, f"{name}.gltf")
    if not os.path.exists(path):
        for attempt in range(4):
            r = requests.get(DRIVE.format(fid), timeout=120)
            if r.status_code == 200 and r.content[:1] == b"{":
                open(path, "wb").write(r.content)
                break
            time.sleep(2 ** attempt)
        else:
            raise SystemExit(f"could not download {name}")
    return json.load(open(path))


# ------------------------------------------------------------ reading glTF accessors
DTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def reader(g):
    raw = base64.b64decode(g["buffers"][0]["uri"].split(",", 1)[1])

    def read(i):
        a = g["accessors"][i]
        v = g["bufferViews"][a["bufferView"]]
        dt, n = np.dtype(DTYPE[a["componentType"]]), WIDTH[a["type"]]
        start = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = v.get("byteStride", dt.itemsize * n)
        out = np.lib.stride_tricks.as_strided(np.frombuffer(raw, dt, offset=start), (a["count"], n), (stride, dt.itemsize)).copy()
        if a.get("normalized"):
            out = out.astype(np.float32) / np.iinfo(dt).max
        return out
    return raw, read


# ------------------------------------------------------------ writing GLB
class GLB:
    def __init__(self):
        self.blob, self.views, self.accessors = bytearray(), [], []

    def add(self, arr, comp, typ, target=None, normalized=False, stride=None, minmax=False):
        """One accessor in its own buffer view; `stride` pads each element to 4 bytes."""
        arr = np.ascontiguousarray(arr)
        n = WIDTH[typ]
        rows = arr.reshape(len(arr), n) if n > 1 else arr.reshape(len(arr), 1)
        data = rows.tobytes()
        if stride:
            pad = np.zeros((len(rows), stride), np.uint8)
            pad[:, :rows.itemsize * n] = np.frombuffer(data, np.uint8).reshape(len(rows), -1)
            data = pad.tobytes()
        while len(self.blob) % 4:
            self.blob += b"\0"
        view = {"buffer": 0, "byteOffset": len(self.blob), "byteLength": len(data)}
        if stride:
            view["byteStride"] = stride
        if target:
            view["target"] = target
        self.blob += data
        self.views.append(view)
        acc = {"bufferView": len(self.views) - 1, "componentType": comp, "count": len(rows), "type": typ}
        if normalized:
            acc["normalized"] = True
        if minmax:
            acc["min"], acc["max"] = rows.min(0).tolist(), rows.max(0).tolist()
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def write(self, path, doc):
        doc["accessors"], doc["bufferViews"] = self.accessors, self.views
        doc["buffers"] = [{"byteLength": len(self.blob)}]
        js = json.dumps(doc, separators=(",", ":")).encode()
        js += b" " * (-len(js) % 4)
        blob = bytes(self.blob) + b"\0" * (-len(self.blob) % 4)
        out = (struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob)) + struct.pack("<II", len(js), 0x4E4F534A) + js
               + struct.pack("<II", len(blob), 0x004E4942) + blob)
        open(path, "wb").write(out)
        return len(out)


def q8(v):
    """Unit vectors to normalised int8."""
    v = v / np.maximum(1e-9, np.linalg.norm(v, axis=1, keepdims=True))
    return np.clip(np.round(v * 127), -127, 127).astype(np.int8)


# ------------------------------------------------------------ the character as one mesh
def merge(g, read, name, classes):
    nodes, skinned = g["nodes"], []
    for nd in nodes:
        if "mesh" not in nd or nd["name"] in WEAPONS:
            continue
        if "skin" not in nd:
            sys.exit(f"{name}: {nd['name']} is not skinned")
        skinned.append(nd)
    palette, P, N, J, Wt, M, I = [], [], [], [], [], [], []
    for nd in skinned:
        part = nd["name"].split("_")[-1]
        for p in g["meshes"][nd["mesh"]]["primitives"]:
            mat = g["materials"][p["material"]]
            key = f"{part}/{mat['name']}"
            if key not in [e["key"] for e in palette]:
                cls = "skin" if mat["name"].startswith("Skin") else next((c for c, keys in classes.items() if key in keys), "keep")
                palette.append({"key": key, "rgb": [round(c, 4) for c in mat["pbrMetallicRoughness"]["baseColorFactor"][:3]], "class": cls})
            k = [e["key"] for e in palette].index(key)
            a = p["attributes"]
            base = sum(len(x) for x in P)
            P.append(read(a["POSITION"]))
            N.append(read(a["NORMAL"]))
            J.append(read(a["JOINTS_0"]).astype(np.uint8))
            Wt.append(read(a["WEIGHTS_0"]))
            M.append(np.full(len(P[-1]), k, np.uint8))
            I.append(read(p["indices"]).ravel().astype(np.uint32) + base)
    for c, keys in classes.items():
        for key in keys:
            if key not in [e["key"] for e in palette]:
                sys.exit(f"{name}: no palette entry {key}")
    P, N, J, Wt, M, I = (np.concatenate(x) for x in (P, N, J, Wt, M, I))
    if len(P) > 65535:
        sys.exit(f"{name}: {len(P)} vertices")
    return palette, P, N, J, Wt, M, I


def weights8(w):
    """Weights to normalised uint8 that still sum to exactly 255."""
    w = w / np.maximum(1e-9, w.sum(1, keepdims=True))
    q = np.floor(w * 255).astype(np.int32)
    rest = 255 - q.sum(1)
    order = np.argsort(-(w * 255 - q), axis=1)
    for r in range(4):
        sel = rest > r
        q[sel, order[sel, r]] += 1
    return q.astype(np.uint8)


def write_character(path, g, ibm, palette, P, N, J, Wt, M, I):
    glb = GLB()
    attrs = {"POSITION": glb.add(P.astype(np.float32), 5126, "VEC3", 34962, minmax=True),
             "NORMAL": glb.add(q8(N), 5120, "VEC3", 34962, normalized=True, stride=4),
             "JOINTS_0": glb.add(J, 5121, "VEC4", 34962),
             "WEIGHTS_0": glb.add(weights8(Wt), 5121, "VEC4", 34962, normalized=True),
             "_MAT": glb.add(M, 5121, "SCALAR", 34962, stride=4)}
    idx = glb.add(I.astype(np.uint16), 5123, "SCALAR", 34963)
    skin = g["skins"][0]
    ibm = glb.add(ibm, 5126, "MAT4")
    nodes = []
    for nd in g["nodes"]:  # keep the hierarchy (bone names drive the animations); one node gets the mesh
        n = {k: v for k, v in nd.items() if k not in ("mesh", "skin")}
        nodes.append(n)
    holder = next(i for i, nd in enumerate(g["nodes"]) if "mesh" in nd and nd["name"].endswith("_Body"))
    nodes[holder]["mesh"], nodes[holder]["skin"] = 0, 0
    doc = {"asset": {"version": "2.0", "generator": "open-earth-3d fetch_people.py", "copyright": "Quaternius, CC0 1.0"},
           "extensionsUsed": ["KHR_mesh_quantization"], "extensionsRequired": ["KHR_mesh_quantization"],
           "scene": 0, "scenes": g["scenes"], "nodes": nodes,
           "materials": [{"name": "Body", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.85}}],
           "meshes": [{"name": "Body", "primitives": [{"attributes": attrs, "indices": idx, "material": 0}],
                       "extras": {"palette": [e["rgb"] for e in palette], "classes": [e["class"] for e in palette]}}],
           "skins": [{**{k: v for k, v in skin.items() if k != "inverseBindMatrices"}, "inverseBindMatrices": ibm}]}
    return glb.write(path, doc)


# ------------------------------------------------------------ posing (for the crowd copy)
def quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def pose_matrices(g, read, anim, t=0.0):
    """World matrices of every node at time `t` of `anim` (linear keys, normalised lerp for rotations)."""
    trs = [{"t": nd.get("translation", [0, 0, 0]), "r": nd.get("rotation", [0, 0, 0, 1]), "s": nd.get("scale", [1, 1, 1])} for nd in g["nodes"]]
    a = next(x for x in g["animations"] if x["name"] == anim)
    for ch in a["channels"]:
        path = {"translation": "t", "rotation": "r", "scale": "s"}.get(ch["target"]["path"])
        if path:
            smp = a["samplers"][ch["sampler"]]
            ts, vs = read(smp["input"])[:, 0], read(smp["output"])
            k = int(np.clip(np.searchsorted(ts, t) - 1, 0, max(0, len(ts) - 2)))
            f = 0.0 if len(ts) < 2 else float(np.clip((t - ts[k]) / max(1e-9, ts[k + 1] - ts[k]), 0, 1))
            v = vs[k] if len(ts) < 2 else vs[k] * (1 - f) + vs[k + 1] * f
            if path == "r":
                if len(ts) > 1 and np.dot(vs[k], vs[k + 1]) < 0:
                    v = vs[k] * (1 - f) - vs[k + 1] * f
                v = v / np.linalg.norm(v)
            trs[ch["target"]["node"]][path] = v.tolist()
    local = []
    for t in trs:
        m = np.eye(4)
        m[:3, :3] = quat_mat(t["r"]) * np.array(t["s"])
        m[:3, 3] = t["t"]
        local.append(m)
    parent = {c: i for i, nd in enumerate(g["nodes"]) for c in nd.get("children", [])}
    world = [None] * len(local)

    def get(i):
        if world[i] is None:
            world[i] = local[i] if i not in parent else get(parent[i]) @ local[i]
        return world[i]
    return [get(i) for i in range(len(local))]


def ground_speed(g, read, anim):
    """The speed an in-place clip walks at: how fast the planted foot slides backwards."""
    a = next(x for x in g["animations"] if x["name"] == anim)
    dur = max(float(read(s["input"]).max()) for s in a["samplers"])
    foot = next(j for j in g["skins"][0]["joints"] if g["nodes"][j]["name"] == "Foot.L")
    ts = np.linspace(0, dur, 121)
    pos = np.array([pose_matrices(g, read, anim, t)[foot][:3, 3] for t in ts])
    v = -np.gradient(pos[:, 2], ts)
    planted = pos[:, 1] < pos[:, 1].min() + 0.015
    return round(float(np.median(v[planted])), 3), round(dur, 3)


def crowd_copy(g, read, P, N, J, Wt, M, I):
    skin = g["skins"][0]
    ibm = read(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    world = pose_matrices(g, read, POSE)
    jm = np.stack([world[j] @ ibm[k] for k, j in enumerate(skin["joints"])])        # (joints, 4, 4)
    w = Wt / np.maximum(1e-9, Wt.sum(1, keepdims=True))
    mats = np.einsum("vk,vkij->vij", w, jm[J.astype(int)])                          # blended per vertex
    pos = np.einsum("vij,vj->vi", mats[:, :3, :3], P) + mats[:, :3, 3]
    names = [g["nodes"][j]["name"] for j in skin["joints"]]
    dominant = J[np.arange(len(J)), np.argmax(Wt, 1)]
    part = np.array([part_of(names[d]) for d in dominant], np.uint8)
    joint_at = {g["nodes"][j]["name"]: world[j][:3, 3] for j in skin["joints"]}
    pivots = {k: [round(float((joint_at[f"{j}.L"][i] + joint_at[f"{j}.R"][i]) / 2), 4) for i in (1, 2)]  # [height, forward]
              for k, j in (("hip", "UpperLeg"), ("knee", "LowerLeg"), ("shoulder", "UpperArm"))}
    # vertex clustering, never across palette entries or body parts
    cell = np.floor(pos / CELL).astype(np.int64)
    key = (((cell[:, 0] + 1000) * 4000 + (cell[:, 1] + 1000)) * 4000 + (cell[:, 2] + 1000)) * 64 + M.astype(np.int64) * 8 + part
    uniq, inv = np.unique(key, return_inverse=True)
    cnt = np.bincount(inv)
    cpos = np.stack([np.bincount(inv, pos[:, k]) / cnt for k in range(3)], 1)
    cm = np.zeros(len(uniq), np.uint8)
    cm[inv] = M
    cp = np.zeros(len(uniq), np.uint8)
    cp[inv] = part
    t = inv[I.reshape(-1, 3)]
    keep = (t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])
    t = t[keep]
    _, first = np.unique(np.sort(t, 1), axis=0, return_index=True)
    t = t[np.sort(first)]
    # normals from the simplified surface, area weighted
    fn = np.cross(cpos[t[:, 1]] - cpos[t[:, 0]], cpos[t[:, 2]] - cpos[t[:, 0]])
    vn = np.zeros_like(cpos)
    for k in range(3):
        np.add.at(vn, t[:, k], fn)
    return cpos.astype(np.float32), vn, cm, cp, t.astype(np.uint16), pivots


def main():
    out = os.path.join(ROOT, "web", "assets", "people")
    cache = os.path.join(ROOT, "data", "raw", "people")
    os.makedirs(out, exist_ok=True)
    os.makedirs(cache, exist_ok=True)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))
    total, info, crowd, speeds = 0, {}, GLB(), {}
    crowd_nodes, crowd_meshes = [], []
    for name, (fid, classes) in CHARACTERS.items():
        g = fetch(name, fid, cache)
        raw, read = reader(g)
        palette, P, N, J, Wt, M, I = merge(g, read, name, classes)
        total += write_character(os.path.join(out, f"{name}.glb"), g, read(g["skins"][0]["inverseBindMatrices"]), palette, P, N, J, Wt, M, I)
        cpos, cn, cm, cp, ct, piv = crowd_copy(g, read, P, N, J, Wt, M, I)
        attrs = {"POSITION": crowd.add(cpos, 5126, "VEC3", 34962, minmax=True),
                 "NORMAL": crowd.add(q8(cn), 5120, "VEC3", 34962, normalized=True, stride=4),
                 "_MAT": crowd.add(cm, 5121, "SCALAR", 34962, stride=4),
                 "_PART": crowd.add(cp, 5121, "SCALAR", 34962, stride=4)}
        crowd_meshes.append({"name": name, "primitives": [{"attributes": attrs, "indices": crowd.add(ct.ravel(), 5123, "SCALAR", 34963), "material": 0}],
                             "extras": {"palette": [e["rgb"] for e in palette], "classes": [e["class"] for e in palette], **piv}})
        crowd_nodes.append({"name": name, "mesh": len(crowd_meshes) - 1})
        info[name] = {"pack": name[0], "triangles": len(I) // 3, "crowd_triangles": len(ct), "height_m": round(float(P[:, 1].max()), 2),
                      "palette": [e["key"] for e in palette], "classes": [e["class"] for e in palette], **piv}
        print(f"{name:13s} {len(I) // 3:6d} triangles, crowd copy {len(ct):5d}, {len(palette)} colours")
        for pack, src in ANIM_SOURCE.items():
            if name == src:
                write_anims(os.path.join(out, f"anims_{pack}.glb"), g, read)
                total += os.path.getsize(os.path.join(out, f"anims_{pack}.glb"))
                speeds[pack] = {clip: ground_speed(g, read, clip) for clip in ("Walk", "Run")}
                print(f"  pack {pack}: walk {speeds[pack]['Walk']}, run {speeds[pack]['Run']} (m/s, s)")
    total += crowd.write(os.path.join(out, "crowd.glb"), {
        "asset": {"version": "2.0", "generator": "open-earth-3d fetch_people.py", "copyright": "Quaternius, CC0 1.0"},
        "extensionsUsed": ["KHR_mesh_quantization"], "extensionsRequired": ["KHR_mesh_quantization"],
        "scene": 0, "scenes": [{"nodes": list(range(len(crowd_nodes)))}], "nodes": crowd_nodes, "meshes": crowd_meshes,
        "materials": [{"name": "Body", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.85}}]})
    json.dump({"source": "Quaternius, Ultimate Modular Men and Ultimate Modular Women (CC0 1.0)",
               "urls": ["https://quaternius.com/packs/ultimatemodularcharacters.html", "https://quaternius.com/packs/ultimatemodularwomen.html"],
               "animations": ANIMS, "anims": {k: f"anims_{k}.glb" for k in ANIM_SOURCE}, "crowd": "crowd.glb",
               "ground_speed": {k: {c: v[0] for c, v in d.items()} for k, d in speeds.items()},
               "classes": CLASSES, "characters": info}, open(os.path.join(out, "people.json"), "w"), indent=1)
    print(f"{len(CHARACTERS)} characters, {len(ANIMS)} animations: {total / 1e6:.2f} MB -> {out}")


def write_anims(path, g, read):
    """The animations alone: the node hierarchy and the kept clips' keyframes."""
    missing = [a for a in ANIMS if a not in {x["name"] for x in g["animations"]}]
    if missing:
        sys.exit(f"animations missing: {missing}")
    glb, anims, inputs = GLB(), [], {}
    for a in g["animations"]:
        if a["name"] not in ANIMS:
            continue
        samplers, channels = [], []
        for ch in a["channels"]:
            s = a["samplers"][ch["sampler"]]
            inp, outp = read(s["input"]), read(s["output"])
            typ, prop = g["accessors"][s["output"]]["type"], ch["target"]["path"]
            if np.abs(outp - outp[:1]).max() < 1e-6:  # constant: one key is enough
                inp, outp, ikey = inp[:1], outp[:1], ("const",)
            else:
                ikey = (s["input"],)
            if ikey not in inputs:
                inputs[ikey] = glb.add(inp.astype(np.float32), 5126, "SCALAR", minmax=True)
            if prop == "rotation":  # core glTF allows normalised int16 rotations
                o = glb.add(np.clip(np.round(outp * 32767), -32767, 32767).astype(np.int16), 5122, typ, normalized=True)
            else:
                o = glb.add(outp.astype(np.float32), 5126, typ)
            samplers.append({"input": inputs[ikey], "output": o, "interpolation": s.get("interpolation", "LINEAR")})
            channels.append({"sampler": len(samplers) - 1, "target": ch["target"]})
        anims.append({"name": a["name"], "channels": channels, "samplers": samplers})
    nodes = [{k: v for k, v in nd.items() if k not in ("mesh", "skin")} for nd in g["nodes"]]
    glb.write(path, {"asset": {"version": "2.0", "generator": "open-earth-3d fetch_people.py", "copyright": "Quaternius, CC0 1.0"},
                     "scene": 0, "scenes": g["scenes"], "nodes": nodes, "animations": anims})


if __name__ == "__main__":
    main()
