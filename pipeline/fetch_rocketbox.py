"""Download the Microsoft Rocketbox avatars and clips that blender/build_people.py builds the
main characters and the NPCs from, into data/raw/rocketbox (git-ignored): a sparse checkout of
the repository with only each avatar's FBX and its colour and normal maps, the clips the
characters use, and the licence (MIT, (c) 2020 Microsoft).

    python pipeline/fetch_rocketbox.py

The NPCs are the characters named R_<avatar>[_<head>][_<tag>...] in the cities' game.npcs
(cities/*/city.json): the Rocketbox avatar, optionally wearing another avatar's head (named by
its Rocketbox model code, such as f003 or m024) and retouched by tags (build_people.py: HAIR,
CLOTH, PATTERN, "bare", "plain"). npc_cast() reads them; build_people.py builds the same list.
"""
import ast
import glob
import json
import os
import re
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, "data", "raw", "rocketbox")
REPO = "https://github.com/microsoft/Microsoft-Rocketbox"
# R_<avatar folder name>[_<head's model code>][_<tag>]...: Female_Adult_09_f011_grey
NPC_ID = re.compile(r"^R_([A-Za-z]+(?:_[A-Za-z]+)*_\d\d)(?:_([fm]\d{3}))?((?:_[a-z]+)*)$")


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


def avatar_folders(listing):
    """Every avatar's folder under Assets/Avatars by its name, and by the model code its head
    texture carries (f003_head_color.tga: f003), from the paths of the repository's files."""
    by_name, by_code = {}, {}
    for p in listing:
        m = re.match(r"Assets/Avatars/(\w+/(\w+))/Textures/([a-z]+\d{3})a?_head_color", p)
        if m:
            by_name[m.group(2)] = m.group(1)
            by_code.setdefault(m.group(3), m.group(1))
    return by_name, by_code


def npc_cast(listing):
    """{id: {avatar, head, tags, sex, clips, cities}} for every R_ character a city's NPCs name,
    with the avatar and the head as folders under Assets/Avatars; listing is the repository's
    file paths (git ls-tree, or the files on disk)."""
    by_name, by_code = avatar_folders(listing)
    cast = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "cities", "*", "city.json"))):
        city = os.path.basename(os.path.dirname(path))
        for n in (json.load(open(path, encoding="utf8")).get("game") or {}).get("npcs", []):
            look = n.get("look") or {}
            cid = look.get("character", "")
            if not cid.startswith("R_"):
                continue
            m = NPC_ID.match(cid)
            if not m or m.group(1) not in by_name or (m.group(2) and m.group(2) not in by_code):
                raise SystemExit(f"{city}: npc {n['id']}: no Rocketbox avatar for {cid}")
            spec = cast.setdefault(cid, {"avatar": by_name[m.group(1)], "head": by_code[m.group(2)] if m.group(2) else None,
                                         "tags": [t for t in m.group(3).split("_") if t],
                                         "sex": "f" if "Female" in m.group(1) else "m", "clips": set(), "cities": set()})
            spec["cities"].add(city)
            if look.get("clip"):
                spec["clips"].add(look["clip"])
    return cast


def main():
    characters, clips, npc_clips = literals("CHARACTERS", "CLIPS", "NPC_CLIPS")
    if not os.path.isdir(os.path.join(DST, ".git")):
        subprocess.run(["git", "clone", "--depth", "1", "--filter=blob:none", "--no-checkout", REPO, DST], check=True)
    listing = git("ls-tree", "-r", "--name-only", "HEAD", "Assets/Avatars").split("\n")
    cast = npc_cast(listing)
    avatars = {spec["avatar"]: spec["sex"] for spec in characters.values()}
    for spec in cast.values():
        avatars[spec["avatar"]] = spec["sex"]
        if spec["head"]:
            avatars[spec["head"]] = spec["sex"]
    paths = ["/LICENSE.md"]
    for avatar in avatars:
        folder = f"Assets/Avatars/{avatar}"
        name = os.path.basename(avatar)
        paths.append(f"/{folder}/Export/{name}.fbx")
        for t in listing:
            if t.startswith(f"{folder}/Textures/") and ("_color" in t or "_normal" in t) and "_wrinkle" not in t:
                paths.append("/" + t)
    # the main characters' clips for their sex, and the NPCs' for every sex in the cast
    wanted = [(spec["sex"], clip) for spec in characters.values() for clip in clips.values()]
    wanted += [(sex, clip) for sex in {s["sex"] for s in cast.values()} for clip in npc_clips.values()]
    for sex, (clip, kind) in wanted:
        paths.append(f"/Assets/Animations/all_animations_max_motextr_{kind}/{sex}_{clip}.max.fbx")
    git("sparse-checkout", "set", "--no-cone", *sorted(set(paths)))
    git("checkout", "-q", "HEAD")
    print(f"{len(set(paths))} paths in {DST}: {len(avatars)} avatars, {len(cast)} NPC characters")


if __name__ == "__main__":
    main()
