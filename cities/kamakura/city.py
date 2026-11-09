"""Shichirigahama, a map of Kamakura: what the generic pipeline cannot know from open data.

The model is the real coast: Overture footprints at Project PLATEAU's surveyed heights on GSI's laser terrain,
and the Enoden's line from Overture's rail (pipeline/game_rail.py). Sources and what is approximate:
docs/cities/kamakura.md.

  * The Enoden's platform shelters and the sheds over its track are mapped as buildings (PLATEAU's "普通無壁舎",
    wall-less sheds). As solid blocks they would stand on the platforms and the rails, so every footprint
    within TRACK_CLEAR_M of the line's centre is left out; the platforms and their shelters are drawn from the
    line itself (web/game/rail.js).
"""
import glob
import json
import os

from shapely.geometry import LineString
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
TRACK_CLEAR_M = 1.9      # a car's half width (1.2 to 1.25 m) and the gap to a platform's edge

_track = None


def track(C):
    """The Enoden's tracks in the local frame, from the OpenStreetMap extract kept beside this file."""
    global _track
    if _track is None:
        lines = []
        for f in sorted(glob.glob(os.path.join(HERE, "*_osm.json"))):
            for w in json.load(open(f, encoding="utf8"))["ways"]:
                if w["tags"].get("railway") in ("light_rail", "rail", "tram") and len(w["ll"]) > 1:
                    lines.append(C.to_local(LineString(w["ll"])))
        _track = unary_union(lines)
    return _track


def adjust_building(b, cls, g, geoms, ctx):
    if g.distance(track(ctx.city)) < TRACK_CLEAR_M:
        return []
    return None
