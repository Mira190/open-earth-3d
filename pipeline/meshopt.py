"""The last step of every build that writes a shared model (blender/build_vehicles.py, build_trees.py,
build_people.py, pipeline/fetch_people.py): meshopt-compress the .glb in place (pipeline/meshopt_glb.mjs,
issue 148). Needs Node; a file already compressed is left as it is."""
import os
import subprocess

MJS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "meshopt_glb.mjs")


def compress(*paths):
    paths = [p for p in paths if p and os.path.exists(p)]
    if paths:
        subprocess.run(["node", MJS, *paths], check=True)
