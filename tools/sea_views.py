"""Views for checking the open sea past the model's frame (issue 57): the city from 14 km up at
noon, and from 1.2 km up over the frame's centre looking out past each of its four edges an hour
before sunset. Writes one views.json per city for tools/city_shot.js.

    python3 tools/sea_views.py <city> > views.json
"""
import json
import sys

city = sys.argv[1]
f = json.load(open(f"web/data/{city}/scene.json"))["frame"]
cx, cy = (f["x"][0] + f["x"][1]) / 2, (f["y"][0] + f["y"][1]) / 2
hx, hy = (f["x"][1] - f["x"][0]) / 2, (f["y"][1] - f["y"][0]) / 2
views = [{"name": "above", "cam": [cx, cy - 6000, 14000], "tgt": [cx, cy, 0], "date": [3, 21], "time": "12:00"}]
for name, (dx, dy) in {"north": (0, 1), "east": (1, 0), "south": (0, -1), "west": (-1, 0)}.items():
    views.append({"name": f"out-{name}", "cam": [cx + dx * hx * 0.3, cy + dy * hy * 0.3, 1200],
                  "tgt": [cx + dx * (hx + 6000), cy + dy * (hy + 6000), 0], "date": [3, 21], "time": "sunset-60"})
print(json.dumps(views, indent=1))
