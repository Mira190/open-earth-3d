"""Compare game.json's expressway lines with a copy from before (shuto.py --game): points moved, and grades made
steeper than MAX by the move.
    python3 tools/shuto_grades.py BEFORE.json [web/data/tokyo/game.json]
"""
import json
import sys

import numpy as np

MAX = 0.12


def main():
    a = json.load(open(sys.argv[1]))
    b = json.load(open(sys.argv[2] if len(sys.argv) > 2 else "web/data/tokyo/game.json"))
    moved, steep = [], []
    for k, (oa, ob) in enumerate(zip(a["paths"]["road"], b["paths"]["road"])):
        if ob["c"] != "motorway":
            continue
        pa, pb = (np.asarray(o["p"], float).reshape(-1, 3) / 10 for o in (oa, ob))
        d = pb[:, 2] - pa[:, 2]
        moved += list(d[np.abs(d) > 0.05])
        s = np.hypot(*np.diff(pb[:, :2], axis=0).T)
        g, ga = (np.abs(np.diff(p[:, 2])) / np.maximum(s, 0.5) for p in (pb, pa))
        steep += [(round(float(g[i]), 2), round(float(ga[i]), 2), k, pb[i].round(1).tolist()) for i in np.nonzero((g > MAX) & (g > ga + 0.02) & (s > 2))[0]]
    m = np.array(moved)
    print(f"{len(m)} points moved, dz 5/25/50/75/95%: {np.percentile(m, [5, 25, 50, 75, 95]).round(1).tolist() if len(m) else []}")
    print(f"{len(steep)} grades over {MAX:.0%} made steeper:")
    for q in sorted(steep, reverse=True):
        print("  ", q)


if __name__ == "__main__":
    main()
