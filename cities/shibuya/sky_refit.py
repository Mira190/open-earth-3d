"""SHIBUYA SKY's channels cut into a built Shibuya, without the raw downloads build_scene.py needs.

    python cities/shibuya/sky_refit.py      # then: python pipeline/landmarks.py --city shibuya,
                                            # python pipeline/game_extras.py --city shibuya, python pipeline/pack.py

city.py's sky_building cuts the channels down the roof's west and north edges to the 46F level when the
scene is built. This does the same to web/data/shibuya/buildings.json as it stands (built when the roof
had a pit for an escalator in its middle), keeping every solid's index, since other files name solids by
index: the deck's solids lose the channels, the solid PLATEAU surveyed 9 m lower along those edges becomes
the channels' floor, and the old pit's solid is filled to the deck again. scene.json's
landmarks.shibuya_sky is written again from city.py's sky_record, and game.json's travel to the roof from game_extras. It runs once: on a file that already has the channels it stops.
"""
import importlib.util
import json
import os
import sys

from shapely.geometry import Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
spec = importlib.util.spec_from_file_location("shibuya_city", os.path.join(ROOT, "cities", "shibuya", "city.py"))
city = importlib.util.module_from_spec(spec)
spec.loader.exec_module(city)

OUT = os.path.join(ROOT, "web", "data", "shibuya")


def poly(s):
    ring = lambda f: [(f[i] / 10, f[i + 1] / 10) for i in range(0, len(f), 2)]
    return Polygon(ring(s[4]), [ring(h) for h in s[5:]])


def flat(p):
    """A polygon back to the solid's rings in decimetres (shell counter-clockwise, holes clockwise)."""
    from shapely.geometry.polygon import orient
    p = orient(p.simplify(0.05, preserve_topology=True), 1.0)
    dm = lambda cs: [int(round(v * 10)) for x, y in list(cs)[:-1] for v in (x, y)]
    return [dm(p.exterior.coords)] + [dm(h.coords) for h in p.interiors]


def main():
    bpath, spath = os.path.join(OUT, "buildings.json"), os.path.join(OUT, "scene.json")
    B, S = json.load(open(bpath)), json.load(open(spath))
    old = S["landmarks"]["shibuya_sky"]
    bi = next(i for i, b in enumerate(B["b"]) if b[0] == city.SCRAMBLE_SQ)
    idx = [i for i, s in enumerate(B["s"]) if s[0] == bi]
    deck_dm = int(round(old["deck_z"] * 10))
    z0_dm = deck_dm - int(round(city.SKY["floor_46_below_m"] * 10))
    ps = {i: poly(B["s"][i]) for i in idx}
    main_i = max(idx, key=lambda i: ps[i].area)
    ring = [[round(x, 2), round(y, 2)] for x, y in ps[main_i].exterior.coords]
    import numpy as np
    toward = old.get("toward") or [round(float(v), 1) for v in np.asarray(old["centre"]) + 100 * (np.asarray(old["a1"]) + np.asarray(old["a2"]))]
    plan = city.sky_plan(ring, toward)
    chan = city.sky_channel_poly(plan)
    from shapely.ops import unary_union
    shell = Polygon(city.largest(unary_union([p.buffer(0.1, join_style=2) for p in ps.values()]).buffer(-0.1, join_style=2)).exterior.coords)  # the roof's outline
    if any(B["s"][i][1] + B["s"][i][3] == z0_dm for i in idx):
        raise SystemExit("buildings.json already has SHIBUYA SKY's channels: nothing to do")
    # the piece PLATEAU has 9 m lower is the one that lies most in the channels
    floor_i = max((i for i in idx if i != main_i), key=lambda i: ps[i].intersection(chan).area / ps[i].area)
    pit_i = [i for i in idx if i not in (main_i, floor_i) and B["s"][i][1] + B["s"][i][3] < deck_dm - 1]
    for i in idx:
        s = B["s"][i]
        if i == floor_i:
            p = city.largest(shell.intersection(chan))
            top = z0_dm
        elif i == main_i:
            p = city.largest(ps[i].union(ps[floor_i].difference(chan)).difference(chan))
            top = deck_dm
        elif i in pit_i:
            p, top = ps[i], deck_dm              # the old escalator pit, filled to the deck again
        else:
            p = city.largest(ps[i].difference(chan))
            top = deck_dm
        if p is None:
            raise SystemExit(f"solid {i} would vanish in the channels")
        B["s"][i] = [s[0], s[1], s[2], top - s[1], *flat(p)]
        print(f"solid {i}: {ps[i].area:7.1f} m² -> {p.area:7.1f} m², top {(top) / 10:.1f} m")
    rec = city.sky_record({"ring": ring, "toward": toward, "deck_z": old["deck_z"], "ground_m": old["ground_m"],
                           "deck_m": old["deck_m"], "roof_top_m": old["roof_top_m"]})
    rec["door"], rec["door_z"] = old["door"], old["door_z"]
    S["landmarks"]["shibuya_sky"] = rec
    json.dump(B, open(bpath, "w"), separators=(",", ":"))
    json.dump(S, open(spath, "w"), separators=(",", ":"))
    # the roof's place to travel to (game_data.py takes it from game_extras; pipeline/game_extras.py leaves travel as it is)
    gpath = os.path.join(OUT, "game.json")
    G = json.load(open(gpath))
    new = {t["id"]: t for t in city.game_extras(S).get("travel", [])}
    G["travel"] = [new.get(t["id"], t) for t in G["travel"]]
    json.dump(G, open(gpath, "w"), separators=(",", ":"))
    print("->", bpath, spath, gpath)


if __name__ == "__main__":
    main()
