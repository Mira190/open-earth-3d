"""Re-height a built city's solids from its city.py hook, without rebuilding the scene: for a landmark
whose open-data heights were wrong when the city was built (Osaka's Namba Parks took its tower's 155 m
for every terrace), once the hook that build_scene.py calls (adjust_building) has learnt the right ones.
retop(solid) -> (min_height_m, top_m[, height_src]) above the solid's ground, or None to leave it;
solid is archkit.load_solids()'s record. With a height source (a police box's "typical" 6 m), the
building takes it, and its storeys are counted again for the new wall (typology.storeys). Rewrites web/data/<city>/buildings.json as build_scene.py writes it
(every solid's base, min and top in decimetres; a building's top_m follows its tallest solid). The
analyses (cities/<id>/analysis) keep the heights they were run with until they run again.

    python pipeline/retop.py --city osaka
"""
import json
import os

import archkit as ak
import typology
from cityctx import city_args


def main():
    city, _ = city_args(__doc__.splitlines()[0])
    hook = city.hook("retop")
    if not hook:
        raise SystemExit(f"cities/{city.id}/city.py has no retop hook")
    path = os.path.join(city.out, "buildings.json")
    B = json.load(open(path))
    changed, tops, srcs = 0, {}, {}
    for sd in ak.load_solids(city.id):
        got = hook(sd)
        if got is None:
            continue
        mn, top = (int(round(v * 10)) for v in got[:2])
        if len(got) > 2:
            srcs[B["s"][sd["si"]][0]] = got[2]
        s = B["s"][sd["si"]]
        if (s[2], s[3]) != (mn, top):
            s[2], s[3] = mn, top
            changed += 1
        tops[s[0]] = max(tops.get(s[0], 0), top)
    fronts = {B["s"][f[0]][0] for f in B.get("f", []) if any(fl & 1 for fl in f[2::2])}
    for bi, top in tops.items():
        b = B["b"][bi]
        b[2] = round(top / 10, 1)
        if bi in srcs:
            b[4] = srcs[bi]
            b[11], b[12] = typology.storeys(B["styles"][b[10]], b[2], b[3] or None, bi in fronts)
    json.dump(B, open(path, "w"), separators=(",", ":"))
    print(f"{changed} solids re-heighted in {len(tops)} buildings -> {path}")


if __name__ == "__main__":
    main()
