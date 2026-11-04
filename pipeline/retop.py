"""Re-height a built city's solids from its city.py hook, without rebuilding the scene: for a landmark
whose open-data heights were wrong when the city was built (Osaka's Namba Parks took its tower's 155 m
for every terrace), once the hook that build_scene.py calls (adjust_building) has learnt the right ones.
retop(solid) -> (min_height_m, top_m) above the solid's ground, or None to leave it; solid is
archkit.load_solids()'s record. Rewrites web/data/<city>/buildings.json as build_scene.py writes it
(every solid's base, min and top in decimetres; a building's top_m follows its tallest solid). The
analyses (cities/<id>/analysis) keep the heights they were run with until they run again.

    python pipeline/retop.py --city osaka
"""
import json
import os

import archkit as ak
from cityctx import city_args


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    hook = city.hook("retop")
    if not hook:
        raise SystemExit(f"cities/{city.id}/city.py has no retop hook")
    path = os.path.join(city.out, "buildings.json")
    B = json.load(open(path))
    changed, tops = 0, {}
    for sd in ak.load_solids(city.id):
        got = hook(sd)
        if got is None:
            continue
        mn, top = (int(round(v * 10)) for v in got)
        s = B["s"][sd["si"]]
        if (s[2], s[3]) != (mn, top):
            s[2], s[3] = mn, top
            changed += 1
        tops[s[0]] = max(tops.get(s[0], 0), top)
    for bi, top in tops.items():
        B["b"][bi][2] = round(top / 10, 1)
    json.dump(B, open(path, "w"), separators=(",", ":"))
    print(f"{changed} solids re-heighted in {len(tops)} buildings -> {path}")


if __name__ == "__main__":
    main()
