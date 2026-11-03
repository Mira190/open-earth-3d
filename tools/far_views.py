"""Views for checking the land past the model's frame (issue 78), for tools/city_shot.js:
  far-<side>-<when>   from high over the frame's centre (600 m over the frame's longer half
                      width, at least 1.2 km), looking out past each edge at the horizon, at
                      noon (day), 15 minutes after sunset (dusk) and 21:30 (night)
  far-above-<when>    the city and its surroundings from 14 km up, day and night
  far-low-<side>      from 300 m over the frame's edge, looking out along the ground at noon

    python3 tools/far_views.py <city> [day,dusk,night] [north,east,south,west] > views.json
    xvfb-run -a node tools/city_shot.js <city> views.json out_dir 1440 900
"""
import json
import sys

city = sys.argv[1]
whens = (sys.argv[2] if len(sys.argv) > 2 else "day,dusk,night").split(",")
sides = (sys.argv[3] if len(sys.argv) > 3 else "north,east,south,west").split(",")
f = json.load(open(f"web/data/{city}/scene.json"))["frame"]
cx, cy = (f["x"][0] + f["x"][1]) / 2, (f["y"][0] + f["y"][1]) / 2
hx, hy = (f["x"][1] - f["x"][0]) / 2, (f["y"][1] - f["y"][0]) / 2
TIME = {"day": "12:00", "dusk": "sunset+15", "night": "21:30"}
DIRS = {"north": (0, 1), "east": (1, 0), "south": (0, -1), "west": (-1, 0)}
z = max(1200, max(hx, hy) + 600)
views = []
for when in whens:
    for name in sides:
        dx, dy = DIRS[name]
        views.append({"name": f"far-{name}-{when}", "cam": [cx - dx * hx * 0.3, cy - dy * hy * 0.3, z],
                      "tgt": [cx + dx * (hx + 9000), cy + dy * (hy + 9000), 0], "date": [3, 21], "time": TIME[when]})
for when in ("day", "night"):
    if when in whens:
        views.append({"name": f"far-above-{when}", "cam": [cx, cy - 9000, 14000], "tgt": [cx, cy + 2000, 0], "date": [3, 21], "time": TIME[when]})
if "day" in whens:
    for name in sides:
        dx, dy = DIRS[name]
        views.append({"name": f"far-low-{name}", "cam": [cx + dx * (hx - 200), cy + dy * (hy - 200), 300], "agl": True,
                      "tgt": [cx + dx * (hx + 6000), cy + dy * (hy + 6000), 100], "date": [3, 21], "time": "12:00"})
print(json.dumps(views, indent=1))
