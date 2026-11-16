"""The far crowd built from the scanned cast (issue 475).

    python pipeline/crowd_cast.py            # -> web/assets/people/crowd_cast.glb, people.json "crowd_cast"
    python pipeline/crowd_cast.py --check    # exit 1 if a live city's cast member has no far copy

The nearest walkers are the NPCs' Rocketbox cast (web/game/people.js crowdRenderer, "real"); everyone further
off was an instanced low-detail doll recoloured from a palette (crowd.glb), and across a street a doll read as a
different kind of person from the scanned one beside it. This file holds a far copy of each cast member instead,
drawn instanced as the dolls were, so a walker is the same person, the same height and the same clothes on both
sides of the step:

- the geometry: the avatar stood in the first frame of Idle_Neutral and simplified to about TRIANGLES triangles before the hair cards are doubled
  (the dolls are 1,350 to 2,250), its texture seams, picture borders and swung body parts kept
  (pipeline/crowd_cast.mjs, meshoptimizer's simplifier). The hair cards are lit as one head of hair and drawn
  from both sides, as people.js roundHair does for the near walker.
- the picture: the avatar's own colour maps, the body's at BODY px and the head's and hair cards' at HEAD px, laid
  out in one CELL picture a character (WebP, the hair cards' cut-out in its alpha), the cards' tone matched to
  the hair painted on the head under them (people.js matchHair). A walker 30 m off is about 55 px tall on a
  desktop or a phone, so the body's picture has two texels a pixel there; no normal map (its relief is finer
  than a pixel at that range).
- the cast: every NPC the live cities name in everyday clothes, as game.js realCast chooses them (uniforms and
  work clothes stay with the NPCs). A city that comes back off the parked list: run this again.

Reads the NPC files blender/build_people.py --npcs wrote (no Blender needed); build_people.py --npcs runs it last.
The file is meshopt-compressed (pipeline/meshopt_glb.mjs), as every shared model is.
"""
import io
import json
import os
import re
import struct
import subprocess
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PEOPLE = os.path.join(ROOT, "web", "assets", "people")
TRIANGLES = 1000
BODY, HEAD = 128, 64
CELL = (BODY, BODY + HEAD)          # w, h: the body over the head and the hair cards side by side
KEEP = 204   # (as blender/build_people.py KEEP)
HIGH_CAST = 16   # (as web/game/game.js HIGH_CAST)
UNIFORM = re.compile(r"Police|Pilot|Security|Construction|Delivery|Gardener|Worker|Nurse|Chef")   # (as game.js realCast)


def live_cities():
    idx = json.load(open(os.path.join(ROOT, "cities", "index.json")))
    parked = set(idx.get("parked", []))
    return [c["id"] for c in idx["cities"] if c.get("status") == "live" and c["id"] not in parked]


def cast(info):
    """The NPCs the live cities' crowds draw their near walkers from (game.js realCast: a city's own and the
    casts game.crowd.real_from names)."""
    want = set()
    for cid in live_cities():
        g = json.load(open(os.path.join(ROOT, "cities", cid, "city.json"))).get("game", {})
        want |= {cid, *g.get("crowd", {}).get("real_from", [])}
    npcs = info["npcs"]["characters"]
    names = {n for n, c in npcs.items() if set(c.get("cities", [])) & want and not UNIFORM.search(n)}
    # ... or the cast a map names for its streets (game.crowd.cast: as many of each sex as the desktop draws, HIGH_CAST)
    named = set()
    for cid in live_cities():
        cc = json.load(open(os.path.join(ROOT, "cities", cid, "city.json"))).get("game", {}).get("crowd", {}).get("cast")
        if cc:
            named |= set(cc.get("f", [])[:HIGH_CAST // 2]) | set(cc.get("m", [])[:HIGH_CAST // 2])
    return sorted((named if named else names) & set(npcs))


def glb_parts(path):
    data = open(path, "rb").read()
    jl = struct.unpack("<I", data[12:16])[0]
    j = json.loads(data[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack("<I", data[off:off + 4])[0]
    return j, data[off + 8:off + 8 + bl]


def images(path):
    """Each material's colour map, by material name (images are never meshopt-encoded)."""
    j, b = glb_parts(path)
    out = {}
    for m in j["materials"]:
        t = m.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if not t:
            continue
        tex = j["textures"][t["index"]]
        src = tex.get("source", tex.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))
        v = j["bufferViews"][j["images"][src]["bufferView"]]
        out[m["name"]] = Image.open(io.BytesIO(b[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]])).convert("RGBA")
    return out


def lum(c):
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def sample(im, uv):
    a = np.asarray(im, dtype=np.float32) / 255
    h, w = a.shape[:2]
    x = np.clip((uv[:, 0] % 1) * w, 0, w - 1).astype(int)
    y = np.clip((uv[:, 1] % 1) * h, 0, h - 1).astype(int)
    return a[y, x]


def far_copy(name, sex):
    g = json.loads(subprocess.run(["node", os.path.join(ROOT, "pipeline", "crowd_cast.mjs"), os.path.join(PEOPLE, f"{name}.glb"),
                                   os.path.join(PEOPLE, f"R_clips_{sex}.glb"), str(TRIANGLES)],
                                  check=True, capture_output=True, text=True).stdout)
    ims = images(os.path.join(PEOPLE, f"{name}.glb"))
    by = {p["kind"]: p for p in g["parts"]}
    cell = Image.new("RGBA", CELL, (0, 0, 0, 255))
    # (rect: x, y, w, h in the cell's pixels)
    rects = {"body": (0, 0, BODY, BODY), "head": (0, BODY, HEAD, HEAD), "hair": (HEAD, BODY, HEAD, HEAD)}
    pos, nrm, uv, part, idx = [], [], [], [], []
    # a body whose picture marks its skin in its alpha (build_people.py skin_mask: KEEP, cloth 255) carries the mark into
    # the cell, where the head and the hair are marked too: the crowd's change of clothes leaves all three as they are
    # (people.js DRESS). The cards' cut-out stays under the cut-off (0.4) where it was under half.
    masked = "body" in by and np.asarray(ims[by["body"]["material"]])[..., 3].min() < 255
    for kind in ("body", "head", "hair"):
        p = by.get(kind)
        if not p:
            continue
        x0, y0, w, h = rects[kind]
        src = ims[p["material"]]
        P = np.array(p["pos"], np.float32).reshape(-1, 3)
        N = np.array(p["nrm"], np.float32).reshape(-1, 3)
        U = np.array(p["uv"], np.float32).reshape(-1, 2)
        I = np.array(p["idx"], np.int64).reshape(-1, 3)
        if kind == "hair":
            # the cards' tone against the hair painted on the head under them (people.js matchHair), and the cut-out's
            # hidden texels in the cards' own mean colour, so the smaller pictures' edges don't darken
            a = np.asarray(src, dtype=np.float32) / 255
            opaque = a[..., 3] > 0.5
            mean = a[opaque][:, :3].mean(0) if opaque.any() else np.array([0.1, 0.08, 0.07])
            hp = by.get("head")
            if hp:
                HP = np.array(hp["pos"], np.float32).reshape(-1, 3)
                HU = np.array(hp["uv"], np.float32).reshape(-1, 2)
                c = sample(src, U)
                sel = c[:, 3] > 0.5
                if sel.sum() >= 12:
                    near = np.argmin(((P[sel][:, None, :] - HP[None, :, :]) ** 2).sum(2), 1)
                    under = sample(ims[hp["material"]], HU[near])
                    k = float(lum(under[:, :3].sum(0)) / max(1e-4, lum(c[sel][:, :3].sum(0))))
                    if not 0.8 < k < 1.2:
                        a[..., :3] *= min(1.6, max(0.7, k))
                        mean *= min(1.6, max(0.7, k))
            a[~opaque, :3] = mean
            if masked:
                a[..., 3] *= KEEP / 255
            src = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), "RGBA")
            # lit as one head of hair: every normal out from the middle of the cards; both sides drawn
            mid = (P.min(0) + P.max(0)) / 2
            N = (P - mid) / np.maximum(1e-6, np.linalg.norm(P - mid, axis=1, keepdims=True))
            I = np.concatenate([I, I[:, [0, 2, 1]]])
        elif not (masked and kind == "body"):
            src = src.copy()
            src.putalpha(KEEP if masked else 255)
        cell.paste(src.resize((w, h), Image.LANCZOS), (x0, y0))
        base = sum(len(q) for q in pos)
        pos.append(P); nrm.append(N); part.append(np.array(p["part"], np.uint8)); idx.append(I + base)
        uv.append(np.stack([(x0 + np.clip(U[:, 0], 0, 1) * w) / CELL[0], (y0 + np.clip(U[:, 1], 0, 1) * h) / CELL[1]], 1))
    return {"pos": np.concatenate(pos), "nrm": np.concatenate(nrm), "uv": np.concatenate(uv), "part": np.concatenate(part),
            "idx": np.concatenate(idx), "pivots": {**g["pivots"], **({"mask": 1} if masked else {})}, "cell": cell}


class GLB:
    def __init__(self):
        self.bin, self.views, self.acc = bytearray(), [], []

    def add(self, arr, ctype, typ, target=None, normalized=False, minmax=False, stride=None):
        arr = np.ascontiguousarray(arr)
        self.bin.extend(b"\0" * (-len(self.bin) % 4))
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": arr.nbytes}
        if target:
            v["target"] = target
        if stride:
            v["byteStride"] = stride
        self.views.append(v)
        self.bin.extend(arr.tobytes())
        n = len(arr) if stride is None else arr.nbytes // stride
        a = {"bufferView": len(self.views) - 1, "componentType": ctype, "count": n, "type": typ}
        if normalized:
            a["normalized"] = True
        if minmax:
            a["min"], a["max"] = arr.min(0).tolist(), arr.max(0).tolist()
        self.acc.append(a)
        return len(self.acc) - 1

    def image(self, im):
        b = io.BytesIO()
        im.save(b, "WEBP", quality=88, method=6, exact=True)
        self.bin.extend(b"\0" * (-len(self.bin) % 4))
        self.views.append({"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(b.getvalue())})
        self.bin.extend(b.getvalue())
        return len(self.views) - 1

    def write(self, path, doc):
        self.bin.extend(b"\0" * (-len(self.bin) % 4))
        doc.update(bufferViews=self.views, accessors=self.acc, buffers=[{"byteLength": len(self.bin)}])
        js = json.dumps(doc, separators=(",", ":")).encode()
        js += b" " * (-len(js) % 4)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(self.bin)))
            f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack("<II", len(self.bin), 0x004E4942)); f.write(self.bin)


def main():
    path = os.path.join(PEOPLE, "people.json")
    info = json.load(open(path))
    names = cast(info)
    if "--check" in sys.argv:   # (tools/check.sh: a cast member with no far copy is drawn as a doll far off)
        have = set(info.get("crowd_cast", {}).get("characters", {}))
        if set(names) - have or not os.path.exists(os.path.join(PEOPLE, "crowd_cast.glb")):
            print(f"FAIL crowd_cast.glb has no far copy of {sorted(set(names) - have)}: python3 pipeline/crowd_cast.py")
            return 1
        print(f"ok   far crowd: a copy of each of the {len(names)} cast members (crowd_cast.glb)")
        return 0
    glb, nodes, meshes, mats, texs, imgs, chars = GLB(), [], [], [], [], [], {}
    for name in names:
        c = info["npcs"]["characters"][name]
        f = far_copy(name, c["sex"])
        n4 = np.zeros((len(f["nrm"]), 4), np.int8)
        n4[:, :3] = np.round(f["nrm"] * 127)
        p4 = np.zeros((len(f["part"]), 4), np.uint8)
        p4[:, 0] = f["part"]
        attrs = {"POSITION": glb.add(f["pos"].astype("<f4"), 5126, "VEC3", 34962, minmax=True),
                 "NORMAL": glb.add(n4, 5120, "VEC3", 34962, normalized=True, stride=4),
                 "TEXCOORD_0": glb.add(np.round(f["uv"] * 65535).astype("<u2"), 5123, "VEC2", 34962, normalized=True),
                 "_PART": glb.add(p4, 5121, "SCALAR", 34962, stride=4)}
        ind = glb.add(f["idx"].astype("<u2").ravel(), 5123, "SCALAR", 34963)
        imgs.append({"bufferView": glb.image(f["cell"]), "mimeType": "image/webp", "name": name})
        texs.append({"sampler": 0, "extensions": {"EXT_texture_webp": {"source": len(imgs) - 1}}})
        mats.append({"name": name, "pbrMetallicRoughness": {"baseColorTexture": {"index": len(texs) - 1}, "metallicFactor": 0, "roughnessFactor": 0.7},
                     "alphaMode": "MASK", "alphaCutoff": 0.4})
        h = float(f["pos"][:, 1].max())
        meshes.append({"name": name, "primitives": [{"attributes": attrs, "indices": ind, "material": len(mats) - 1}],
                       "extras": {**f["pivots"], "height_m": round(h, 3)}})
        nodes.append({"name": name, "mesh": len(meshes) - 1, "extras": {**f["pivots"], "height_m": round(h, 3)}})
        chars[name] = {"triangles": len(f["idx"]), "height_m": round(h, 3)}
        print(f"{name:34s} {c['triangles']:6d} -> {len(f['idx']):5d} triangles, {h:.2f} m")
    out = os.path.join(PEOPLE, "crowd_cast.glb")
    glb.write(out, {"asset": {"version": "2.0", "generator": "open-earth-3d pipeline/crowd_cast.py"},
                    "extensionsUsed": ["EXT_texture_webp"], "extensionsRequired": ["EXT_texture_webp"],
                    "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": meshes,
                    "materials": mats, "textures": texs, "images": imgs,
                    "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}]})
    subprocess.run(["node", os.path.join(ROOT, "pipeline", "meshopt_glb.mjs"), out], check=True)
    info["crowd_cast"] = {
        "note": "The far crowd: a simplified copy of each NPC the live cities' crowds cast, stood in Idle_Neutral, with one "
                f"{CELL[0]}x{CELL[1]} picture a character (pipeline/crowd_cast.py; people.js crowdRenderer). Pivots: [height, forward], m.",
        "file": "crowd_cast.glb", "cell": list(CELL), "characters": chars}
    json.dump(info, open(path, "w"), indent=1)
    print(f"wrote {out} ({os.path.getsize(out) / 1e3:.0f} kB, {len(names)} characters)")


if __name__ == "__main__":
    sys.exit(main())
