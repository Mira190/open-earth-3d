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
The hooks below chain the shared file's, shinkai's and tocho's.
"""
import importlib.util
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


def adjust_building(b, cls, g, geoms, ctx):
    return tocho.building(b, shinkai.building(b, cls, g, _m.adjust_building(b, cls, g, geoms, ctx), ctx), ctx)


def adjust_terrain(dem, C, cell):
    return shinkai.adjust_terrain(_m.adjust_terrain(dem, C, cell), C, cell)


def finalize(ctx):
    _m.finalize(ctx)
    shinkai.finalize(ctx)


def landmark_meshes(scene):
    mats, meshes, extra = _m.landmark_meshes(scene)
    tm, th = tocho.meshes("shinjuku")  # the Tokyo Metropolitan Government Building (cities/shinjuku/tocho.py)
    extra = {**extra, "hidden": sorted(set(extra.get("hidden", [])) | set(th))}
    return {**mats, **shinkai.MATERIALS, **tocho.MATERIALS}, meshes + shinkai.meshes(scene["landmarks"]) + tm, extra


def retop(sd):
    """pipeline/retop.py: the Metropolitan Government Building's parts at their own heights."""
    return tocho.retop(sd)


def landmark_glows(scene):
    return _m.landmark_glows(scene) + shinkai.glows(scene["landmarks"])


def game_surfaces(scene):
    return _m.game_surfaces(scene) + shinkai.surfaces(scene["landmarks"])


woods_clear = shinkai.woods_clear
