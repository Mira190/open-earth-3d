"""Views for checking the open sea past the model's frame (issue 57), for tools/city_shot.js:
  above            the city from 14 km up at noon
  out-<side>       from 2.5 km up inside the frame, looking out past each of its edges an hour
                   before sunset
  stop-NN-<when>-<face>  each tour stop's camera turned toward the sun (sun) and away from it
                   (away), an hour after sunrise and an hour before sunset, on the stop's date
                   (what tools/glare_probe.js --tour measures, as stills only and much faster)

    python3 tools/sea_views.py <city> [above,out,tour] > views.json
    xvfb-run -a node tools/city_shot.js <city> views.json out_dir 1440 900
"""
import json
import sys

city = sys.argv[1]
want = set((sys.argv[2] if len(sys.argv) > 2 else "above,out,tour").split(","))
f = json.load(open(f"web/data/{city}/scene.json"))["frame"]
tour = json.load(open(f"cities/{city}/city.json")).get("tour", [])
cx, cy = (f["x"][0] + f["x"][1]) / 2, (f["y"][0] + f["y"][1]) / 2
hx, hy = (f["x"][1] - f["x"][0]) / 2, (f["y"][1] - f["y"][0]) / 2
views = []
if "above" in want:
    views.append({"name": "above", "cam": [cx, cy - 6000, 14000], "tgt": [cx, cy, 0], "date": [3, 21], "time": "12:00"})
if "out" in want:
    for name, (dx, dy) in {"north": (0, 1), "east": (1, 0), "south": (0, -1), "west": (-1, 0)}.items():
        views.append({"name": f"out-{name}", "cam": [cx - dx * hx * 0.5, cy - dy * hy * 0.5, 2500],
                      "tgt": [cx + dx * (hx + 2500), cy + dy * (hy + 2500), 0], "date": [3, 21], "time": "sunset-60"})
if "tour" in want:
    for i, s in enumerate(tour):
        if not s.get("cam"):
            continue
        for when, t in (("sunrise", "sunrise+60"), ("sunset", "sunset-60")):
            for face in ("sun", "away"):
                views.append({"name": f"stop-{i + 1:02d}-{when}-{face}", "cam": s["cam"], "tgt": s["tgt"],
                              "date": s.get("date", [3, 21]), "time": t, "face": face})
print(json.dumps(views, indent=1))
