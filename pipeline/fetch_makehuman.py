"""Download the CC0 data blender/build_people.py builds the main characters from, into
data/raw/ (git-ignored):

- data/raw/makehuman/mpfb/data: the assets bundled with MPFB (MakeHuman's Blender extension),
  from its release on extensions.blender.org: the base mesh, the macro targets, the
  game-engine rig and its weights. Only this data folder is kept; MPFB's code (GPL) is neither
  kept nor run.
- data/raw/makehuman/assets: the folders the characters use from the MakeHuman system asset
  pack (skins, eyes, brows, lashes, hair, clothes, shoes), read out of the 280 MB zip with
  HTTP range requests.
- data/raw/makehuman/LICENSE.ASSETS.txt: MPFB's licence, which puts all of the above under CC0.
- data/raw/mesh2motion: Mesh2Motion's human animation libraries (CC0) and their licence.

    python pipeline/fetch_makehuman.py
"""
import hashlib
import io
import os
import sys
import zipfile

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rangezip import RangeFile  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
MPFB_ZIP = ("https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/"
            "add-on-mpfb-v2.0.18.zip?repository=%2Fapi%2Fv1%2Fextensions%2F&blender_version_min=4.2.0")
MPFB_SHA256 = "c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad"
MPFB_LICENSE = "https://raw.githubusercontent.com/makehumancommunity/mpfb2/master/LICENSE.md"
SYSTEM_ASSETS = "https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip"
M2M = "https://raw.githubusercontent.com/scottpetrovic/mesh2motion-app/main/"
M2M_FILES = ["static/animations/human-base-animations.glb", "static/animations/human-addon-animations.glb", "LICENSE-CC0.MD"]


def asset_folders():
    """Every asset folder a character in blender/build_people.py names."""
    sys.path.insert(0, os.path.join(ROOT, "blender"))
    src = open(os.path.join(ROOT, "blender", "build_people.py"), encoding="utf8").read()
    start = src.index("CHARACTERS = {")
    ns = {}
    exec(src[start:src.index("\n}\n", start) + 3], ns)   # only the CHARACTERS literal
    out = {"eyes/low-poly"}
    for spec in ns["CHARACTERS"].values():
        for k in ("skin", "eyes", "brows", "lashes", "hair"):
            out.add(os.path.dirname(spec[k]))
        out.update(os.path.dirname(c) for c in spec["clothes"])
    return sorted(out)


def fetch_mpfb():
    dst = os.path.join(RAW, "makehuman", "mpfb", "data")
    if os.path.exists(os.path.join(dst, "3dobjs", "base.obj")):
        print("MPFB data: present"); return
    print("MPFB 2.0.18 from extensions.blender.org")
    r = requests.get(MPFB_ZIP, timeout=600); r.raise_for_status()
    if hashlib.sha256(r.content).hexdigest() != MPFB_SHA256:
        raise SystemExit("MPFB download does not match its published sha256")
    z = zipfile.ZipFile(io.BytesIO(r.content))
    for i in z.infolist():
        if i.is_dir() or not i.filename.startswith("data/"):
            continue                    # the data only: no code is kept
        out = os.path.join(RAW, "makehuman", "mpfb", i.filename)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, "wb").write(z.read(i))
    lic = requests.get(MPFB_LICENSE, timeout=60); lic.raise_for_status()
    open(os.path.join(RAW, "makehuman", "LICENSE.ASSETS.txt"), "w", encoding="utf8").write(lic.text)


def fetch_assets():
    folders = asset_folders()
    out = os.path.join(RAW, "makehuman", "assets")
    z = zipfile.ZipFile(RangeFile(SYSTEM_ASSETS))
    n = 0
    for i in z.infolist():
        if i.is_dir() or not any(i.filename.startswith(f + "/") for f in folders):
            continue
        dst = os.path.join(out, i.filename)
        if os.path.exists(dst) and os.path.getsize(dst) == i.file_size:
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, "wb").write(z.read(i))
        n += 1
    print(f"system assets: {len(folders)} folders, {n} files fetched")


def fetch_m2m():
    out = os.path.join(RAW, "mesh2motion")
    os.makedirs(out, exist_ok=True)
    for f in M2M_FILES:
        dst = os.path.join(out, os.path.basename(f).replace("LICENSE-CC0.MD", "LICENSE-CC0.md"))
        if os.path.exists(dst):
            continue
        r = requests.get(M2M + f, timeout=300); r.raise_for_status()
        open(dst, "wb").write(r.content)
    print("Mesh2Motion animations: present")


if __name__ == "__main__":
    fetch_mpfb()
    fetch_assets()
    fetch_m2m()
