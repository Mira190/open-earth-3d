"""Take the canopy's trees off what a city's woods_clear hook clears, without the raw data.

    python pipeline/woods_clear.py --city fushimi-inari

pipeline/woods.py plants the canopy's trees from the raw canopy model (data/raw/<id>/chm.npz), which a
fresh checkout doesn't have, and leaves out those in a city's woods_clear circles and rings. When only
the hook changes (a new landmark in a wood, a torii tunnel), this applies it to the trees already in
web/data/<id>/places.json ("woods") and updates scene.json's count, as woods.py would have.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cityctx import City  # noqa: E402
from woods import cleared  # noqa: E402
from shapely import STRtree  # noqa: E402
from shapely.geometry import Point, Polygon  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", required=True)
    a = ap.parse_args()
    C = City(a.city)
    scene_path, places_path = (os.path.join(C.out, f) for f in ("scene.json", "places.json"))
    scene, places = json.load(open(scene_path)), json.load(open(places_path))
    hook = C.hook("woods_clear")
    if not hook:
        raise SystemExit(f"{a.city}: no woods_clear hook")
    clear = hook(scene)
    rings = [Polygon(c) for c in clear if isinstance(c[0], (list, tuple))]
    circles = [c for c in clear if not isinstance(c[0], (list, tuple))]
    tree = STRtree(rings)
    t = places.get("woods", [])

    def gone(x, y):   # as woods.cleared, with an index over the rings
        p = Point(x, y)
        return any(rings[i].contains(p) for i in tree.query(p)) or cleared(circles, x, y)
    keep = [t[i:i + 4] for i in range(0, len(t), 4) if not gone(t[i] / 10, t[i + 1] / 10)]
    print(f"{a.city}: {len(t) // 4} trees from the canopy -> {len(keep)}")
    places["woods"] = [v for q in keep for v in q]
    json.dump(places, open(places_path, "w"), separators=(",", ":"))
    if "woods" in scene:
        scene["woods"]["trees"] = len(keep)
        json.dump(scene, open(scene_path, "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
