"""Put the Shinkai pilgrimage models (pipeline/shinkai.py) into a built city's landmarks.json without a
full rebuild, to look at them in the viewer and the game: runs the hooks on the raw Overture layers and
the built terrain, then appends the meshes and materials to web/data/<city>/landmarks.json and the
walkable strips to game.json's surfaces. For looking only; the city's own build (build_scene.py,
landmarks.py, game_data.py) is what is committed.

    python pipeline/fetch_overture.py --city shibuya --only building water land_use segment
    python tools/shinkai_preview.py --city shibuya
"""
import argparse
import base64
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import shinkai  # noqa: E402
from archkit import Terrain  # noqa: E402
from cityctx import City  # noqa: E402
from japankit import overture  # noqa: E402
from woods import cleared  # noqa: E402


class Ctx:
    def __init__(self, C):
        self.city, self.landmarks, self.labels, self.hidden = C, {}, {}, []
        self.T = Terrain(C.id)

    def ground(self, x, y):
        return self.T(x, y)

    def hide(self, part):
        self.hidden.append(part)


def carve(C, T, cell):
    """Apply shinkai.adjust_terrain to an encoded terrain block (terrain.json, game.json's)."""
    import numpy as np
    sc = T.get("scale", 0.1)
    d = (np.frombuffer(base64.b64decode(T["data"]), "<i2").astype(float) * sc).reshape(T["ny"], T["nx"])
    d = shinkai.adjust_terrain(d, C, cell)
    T["data"] = base64.b64encode(np.round(d / sc).astype("<i2").tobytes()).decode()


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--city", default="shibuya")
    a = ap.parse_args()
    C = City(a.city)
    out = lambda f: os.path.join(C.out, f)
    G = json.load(open(out("game.json")))
    carve(C, G["terrain"], G["terrain"]["cell"])
    S0 = json.load(open(out("scene.json")))
    TJ = json.load(open(out("terrain.json")))
    carve(C, TJ, S0["terrain"]["cell"])
    json.dump(TJ, open(out("terrain.json"), "w"))
    ctx = Ctx(C)
    B = json.load(open(out("buildings.json")))["s"]
    hide = []
    for b in overture(C, "building", f"name = '{shinkai.GORYOTEI}'"):
        c = b["geom"].centroid
        near = [i for i, q in enumerate(B) if abs(sum(q[4][0::2]) / len(q[4][0::2]) / 10 - c.x) < 3 and abs(sum(q[4][1::2]) / len(q[4][1::2]) / 10 - c.y) < 3]
        hide += near
        shinkai.building(b, None, b["geom"], [[None, None, B[i][3] / 10]for i in near], ctx)
    shinkai.finalize(ctx)
    s = ctx.landmarks.get("shinkai", {})
    print(json.dumps({k: (v if k != "ponds" else f"{len(v)} ponds") for k, v in s.items()}, ensure_ascii=False)[:1500])
    print("labels:", ctx.labels)
    path = os.path.join(C.out, "landmarks.json")
    L = json.load(open(path))
    L["meshes"] = [m for m in L["meshes"] if not m["name"].startswith("shinkai")]
    ms = shinkai.meshes(ctx.landmarks)
    L["meshes"] += [m.dump() for m in ms]
    L["materials"].update(shinkai.MATERIALS)
    L["hidden"] = sorted(set(L.get("hidden", [])) | set(hide))
    json.dump(L, open(path, "w"), separators=(",", ":"))
    print(f"{len(ms)} meshes, {sum(len(m.i) for m in ms) // 3} triangles -> {path}")
    sc = json.load(open(out("scene.json")))
    sc.setdefault("landmarks", {})["shinkai"] = s
    json.dump(sc, open(out("scene.json"), "w"), separators=(",", ":"))
    G["surfaces"] = [q for q in G["surfaces"] if not q["name"].startswith("Shinanomachi")] + shinkai.surfaces(ctx.landmarks)
    json.dump(G, open(out("game.json"), "w"), separators=(",", ":"))
    P = json.load(open(out("places.json")))
    clear = shinkai.woods_clear(sc)
    w = P.get("woods", [])
    keep = []
    for i in range(0, len(w), 4):
        x, y = w[i] / 10, w[i + 1] / 10
        if not cleared(clear, x, y):
            keep += w[i:i + 4]
    print(f"woods: {len(w) // 4 - len(keep) // 4} trees cleared")
    P["woods"] = keep
    json.dump(P, open(out("places.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
