"""The last step of every build that writes a shared model (blender/build_vehicles.py, build_trees.py,
build_people.py, pipeline/fetch_people.py): meshopt-compress the .glb in place (pipeline/meshopt_glb.mjs,
issue 148). Needs Node; a file already compressed is left as it is. Then split() writes the parts of a model that the
pages load before they can be played and after (pipeline/split_glb.mjs, issue 335)."""
import os
import subprocess

MJS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "meshopt_glb.mjs")


def compress(*paths):
    paths = [p for p in paths if p and os.path.exists(p)]
    if paths:
        subprocess.run(["node", MJS, *paths], check=True)


SPLIT_MJS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "split_glb.mjs")
# a model's parts: (file, top node names, flags). The pages load the first before they can be played (the traffic's far
# cars, the trees' mid and far models with the leaf atlas) and the rest after (actors.js, trees.js)
PARTS = {
    "cars.glb": [("cars_far.glb", "_LOD2$", ["--near-box"])],
    "trees.glb": [("trees_far.glb", "_LOD[12]$", []), ("trees_near.glb", "_LOD0$", ["--no-images"])],
}


def split(*paths, out_dir=None):
    """Write the parts of each model in PARTS beside it (or into out_dir: tools/check.sh compares them)."""
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    for p in paths:
        for name, pattern, flags in PARTS.get(os.path.basename(p), []):
            subprocess.run(["node", SPLIT_MJS, p, os.path.join(out_dir or os.path.dirname(p), name), pattern, *flags], check=True)


if __name__ == "__main__":
    import sys
    # python pipeline/meshopt.py split <model.glb> ... [--out dir]
    args = sys.argv[1:]
    if args[:1] == ["split"]:
        out = args[args.index("--out") + 1] if "--out" in args else None
        split(*[a for a in args[1:] if a.endswith(".glb")], out_dir=out)
