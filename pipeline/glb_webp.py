"""Re-encode the PNG textures inside a .glb as WebP (EXT_texture_webp), as blender/build_people.py's
export already writes the people's (issue 148). blender/build_trees.py runs it on trees.glb before
pipeline/meshopt.py: the leaf atlas is 1.3 MB as a PNG and 0.29 MB as a WebP at quality 92 with its
alpha (the leaves' cut-out) kept exact. Every browser the site runs on decodes WebP.

    python pipeline/glb_webp.py web/assets/trees/trees.glb [--quality 92]
"""
import argparse
import io
import json
import struct

from PIL import Image


def webp(path, quality=92):
    b = open(path, "rb").read()
    jl = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    if "EXT_meshopt_compression" in j.get("extensionsUsed", []) or len(j.get("buffers", [])) != 1:
        raise SystemExit(f"{path}: convert before meshopt_glb.mjs, on the file as exported")
    bl = struct.unpack("<I", b[20 + jl:24 + jl])[0]
    blob = b[28 + jl:28 + jl + bl]
    done = {}
    for i, im in enumerate(j.get("images", [])):
        if im.get("mimeType") != "image/png" or "bufferView" not in im:
            continue
        v = j["bufferViews"][im["bufferView"]]
        src = Image.open(io.BytesIO(blob[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]))
        out = io.BytesIO()
        src.save(out, "WEBP", quality=quality, alpha_quality=100, method=6, exact=True)
        done[im["bufferView"]] = out.getvalue()
        im["mimeType"] = "image/webp"
    if not done:
        return 0
    for t in j.get("textures", []):  # the texture takes its image through the extension, as Blender writes it
        if "source" in t and j["images"][t["source"]]["mimeType"] == "image/webp":
            t.setdefault("extensions", {})["EXT_texture_webp"] = {"source": t.pop("source")}
    parts, off = [], 0
    for k, v in enumerate(j["bufferViews"]):  # the BIN again, with the images replaced
        data = done.get(k, blob[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]])
        pad = -off % 4
        parts.append(b"\0" * pad)
        off += pad
        v["byteOffset"], v["byteLength"] = off, len(data)
        parts.append(data)
        off += len(data)
    new = b"".join(parts)
    new += b"\0" * (-len(new) % 4)
    j["buffers"][0]["byteLength"] = len(new)
    for key in ("extensionsUsed", "extensionsRequired"):
        j[key] = sorted(set(j.get(key, [])) | {"EXT_texture_webp"})
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    open(path, "wb").write(struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(new)) + struct.pack("<II", len(js), 0x4E4F534A) + js
                           + struct.pack("<II", len(new), 0x004E4942) + new)
    return len(done)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--quality", type=int, default=92)
    a = ap.parse_args()
    for f in a.files:
        print(f"{f}: {webp(f, a.quality)} images as WebP")
