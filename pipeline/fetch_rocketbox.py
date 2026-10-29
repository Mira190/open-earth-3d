"""Download the Microsoft Rocketbox avatars and clips that blender/build_people.py builds the
main characters from, into data/raw/rocketbox (git-ignored): a sparse checkout of the
repository with only each avatar's FBX and its colour and normal maps, the clips the
characters use, and the licence (MIT, (c) 2020 Microsoft).

    python pipeline/fetch_rocketbox.py
"""
import ast
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, "data", "raw", "rocketbox")
REPO = "https://github.com/microsoft/Microsoft-Rocketbox"


def literals(*names):
    """The named top-level literals of blender/build_people.py, read without running it."""
    tree = ast.parse(open(os.path.join(ROOT, "blender", "build_people.py"), encoding="utf8").read())
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and node.targets[0].id in names:
            out[node.targets[0].id] = ast.literal_eval(node.value)
    return [out[n] for n in names]


def git(*args):
    return subprocess.run(["git", "-C", DST, *args], check=True, capture_output=True, text=True).stdout


def main():
    characters, clips = literals("CHARACTERS", "CLIPS")
    if not os.path.isdir(os.path.join(DST, ".git")):
        subprocess.run(["git", "clone", "--depth", "1", "--filter=blob:none", "--no-checkout", REPO, DST], check=True)
    paths = ["/LICENSE.md"]
    for spec in characters.values():
        folder = f"Assets/Avatars/{spec['avatar']}"
        name = os.path.basename(spec["avatar"])
        paths.append(f"/{folder}/Export/{name}.fbx")
        for t in git("ls-tree", "--name-only", "HEAD", f"{folder}/Textures/").split():
            if t.endswith(("_color.tga", "_normal.tga")):
                paths.append("/" + t)
        for clip, kind in clips.values():
            paths.append(f"/Assets/Animations/all_animations_max_motextr_{kind}/{spec['sex']}_{clip}.max.fbx")
    git("sparse-checkout", "set", "--no-cone", *sorted(set(paths)))
    git("checkout", "-q", "HEAD")
    print(f"{len(set(paths))} paths in {DST}")


if __name__ == "__main__":
    main()
