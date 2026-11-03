"""Shinjuku, a map of Tokyo: what the generic pipeline cannot know from open data.

Shinjuku and Shibuya were one map until they were split (issue #85), and they still share one frame:
the same origin, so a local coordinate means the same place in both. Their landmarks are built by one
file, cities/shibuya/city.py, loaded here with CITY = "shinjuku": each landmark is built in the map
whose data holds it. This map gets Suga Shrine and its stairs in Yotsuya (the 男坂 of Your Name),
Kabukicho Ichibangai's arch, the screens over the east exit, the shop signs of Kabukicho, Golden Gai and
2-chome, the Docomo tower's clock, and the poles and wires round the shrine.
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
