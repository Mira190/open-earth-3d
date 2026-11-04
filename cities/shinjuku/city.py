"""Shinjuku, a map of Tokyo: what the generic pipeline cannot know from open data.

Shinjuku and Shibuya were one map until they were split (issue #85), and they still share one frame:
the same origin, so a local coordinate means the same place in both. Their landmarks are built by one
file, cities/shibuya/city.py, loaded here with CITY = "shinjuku": each landmark is built in the map
whose data holds it. This map gets Suga Shrine and its stairs in Yotsuya (the 男坂 of Your Name),
Kabukicho Ichibangai's arch, the screens over the east exit, the shop signs of Kabukicho, Golden Gai and
2-chome, the Docomo tower's clock, and the poles and wires round the shrine.

On top of those, the places of Makoto Shinkai's films that are in this map (pipeline/shinkai.py, issue
#86): Shinjuku Gyoen's shelter of The Garden of Words, its wisteria trellis, the Kyu-Goryotei and the
Japanese garden's ponds, and the Shinanomachi Station footbridge of Your Name. The Tokyo Metropolitan
Government Building is drawn on its OpenStreetMap parts at their own heights (cities/shinjuku/tocho.py).
Kabukicho and the east exit at street level (cities/shinjuku/kabukicho.py): the arch as it stands now in
place of the shared file's simple one, the tenant stacks and lamps of Ichibangai, Central Road and
Sakura-dori, the kaiju on the Toho building's terrace, Studio Alta's cleared lot and the Unica building's
names. The hooks below chain the shared file's, shinkai's, tocho's and kabukicho's.
"""
import importlib.util
import math
import os

_SHARED = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "shibuya", "city.py")
_spec = importlib.util.spec_from_file_location("city_shibuya_for_shinjuku", _SHARED)
_m = importlib.util.module_from_spec(_spec)
_m.CITY = "shinjuku"   # read by the shared file before anything is built
_spec.loader.exec_module(_m)

# every hook the pipeline looks for (city.hook), and whatever else the shared file defines
globals().update({k: v for k, v in vars(_m).items() if not k.startswith("_")})

import shinkai  # noqa: E402  (pipeline/ is on the path of every script that loads a city)

_tspec = importlib.util.spec_from_file_location("shinjuku_tocho", os.path.join(os.path.dirname(os.path.abspath(__file__)), "tocho.py"))
tocho = importlib.util.module_from_spec(_tspec)
_tspec.loader.exec_module(tocho)

_kspec = importlib.util.spec_from_file_location("shinjuku_kabukicho", os.path.join(os.path.dirname(os.path.abspath(__file__)), "kabukicho.py"))
kabukicho = importlib.util.module_from_spec(_kspec)
_kspec.loader.exec_module(kabukicho)
_KB = {}

# the arch is kabukicho.py's, drawn as it stands; the shared file's stays the Shibuya-era sketch, so it is
# not built here (districts_meshes looks it up in the shared module when it runs)
_m.kabukicho_gate = lambda K, c: None
_open_fronts = _m.open_fronts


def _fronts_off_the_canyon(sites):
    """The shared shop signs everywhere but along Kabukicho's canyon, where kabukicho.py puts its own."""
    keep = _open_fronts(sites)
    canyon = _KB.get("canyon")
    if not canyon:
        return keep
    import numpy as np
    pts = np.asarray(canyon, float)
    return [s for s in keep if np.hypot(pts[:, 0] - s[0], pts[:, 1] - s[1]).min() > 6.0]


_m.open_fronts = _fronts_off_the_canyon


def kabukicho_build(lm):
    """Kabukicho's street-level build, made once (its canyon sites are read by the shared shop signs)."""
    if "kabukicho_gate" not in lm:
        return None
    if "build" not in _KB:
        b = kabukicho.Build("shinjuku", lm)
        _KB["build"], _KB["out"] = b, b.meshes()
        _KB["canyon"] = b.info.get("canyon")
    return _KB["build"]


def adjust_building(b, cls, g, geoms, ctx):
    return tocho.building(b, shinkai.building(b, cls, g, _m.adjust_building(b, cls, g, geoms, ctx), ctx), ctx)


def adjust_terrain(dem, C, cell):
    return shinkai.adjust_terrain(_m.adjust_terrain(dem, C, cell), C, cell)


def finalize(ctx):
    _m.finalize(ctx)
    shinkai.finalize(ctx)


def landmark_meshes(scene):
    kb = kabukicho_build(scene["landmarks"])   # first: the shared shop signs leave its canyon to it
    mats, meshes, extra = _m.landmark_meshes(scene)
    tm, th = tocho.meshes("shinjuku")  # the Tokyo Metropolitan Government Building (cities/shinjuku/tocho.py)
    extra = {**extra, "hidden": sorted(set(extra.get("hidden", [])) | set(th))}
    if kb:
        km, kh, _, kp = _KB["out"]
        meshes, mats = meshes + km, {**mats, **kabukicho.MATERIALS}
        extra["hidden"] = sorted(set(extra["hidden"]) | set(kh))
        extra["props"] = extra.get("props", []) + kp
    return {**mats, **shinkai.MATERIALS, **tocho.MATERIALS}, meshes + shinkai.meshes(scene["landmarks"]) + tm, extra


def landmark_assets(out_dir, scene):
    out = _m.landmark_assets(out_dir, scene) or []
    kb = kabukicho_build(scene["landmarks"])
    return out + ([kb.draw(out_dir)] if kb else [])


def landmark_demolished(scene):
    """Studio Alta, pulled down in 2025-26 (kabukicho.py)."""
    kb = kabukicho_build(scene["landmarks"])
    return sorted(kb.gone) if kb else []


def retop(sd):
    """pipeline/retop.py: the Metropolitan Government Building's parts at their own heights."""
    return tocho.retop(sd)


def landmark_glows(scene):
    kb = kabukicho_build(scene["landmarks"])
    return _m.landmark_glows(scene) + shinkai.glows(scene["landmarks"]) + (kb.glows() if kb else [])


def game_surfaces(scene):
    return _m.game_surfaces(scene) + shinkai.surfaces(scene["landmarks"])


woods_clear = shinkai.woods_clear


def game_extras(scene):
    """The shared file's spots, with Kabukicho's arch, the kaiju and Studio Alta's lot from kabukicho.py
    (the shared file's arch spot stood at its own sketch)."""
    out = _m.game_extras(scene)
    kb = kabukicho_build(scene["landmarks"])
    if not kb:
        return out
    spots, close, chatter = kabukicho.extras(kb.info, _m.spot, _m.close_to, _m.talk)
    old = {"kabukicho"}
    out["spots"] = [s for s in out.get("spots", []) if s["id"] not in old] + spots
    out["close"] = [c for c in out.get("close", []) if not c.get("name", "").startswith("Kabukicho Ichibangai arch")] + close
    gate = scene["landmarks"].get("kabukicho_gate", {}).get("at")
    if gate:   # the shared chatter at the old arch: kabukicho.py has its own there
        out["chatter"] = [c for c in out.get("chatter", []) if math.hypot(c["at"][0] - gate[0], c["at"][1] - gate[1]) > 25]
    out["chatter"] = out.get("chatter", []) + chatter
    return out
