"""Add a built Tokyo district map to cities/index.json: its entry in the cities list (after the last Tokyo
map) and its station on the subway map turned from grey to lit (the district's "map" set, its "note"
dropped), keeping the file's layout; then rewrite web/data/cities.json.

    python tools/add_district.py ueno Ueno 上野 35.713 139.7735 "tagline" "summary" [--district Ueno] [--travel t-id]
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))


def main():
    ap = argparse.ArgumentParser()
    for k in ("id", "name", "native", "lat", "lon", "tagline", "summary"):
        ap.add_argument(k)
    ap.add_argument("--district", action="append", default=[], help="a district on the subway map this map holds (by name; default the map's name)")
    a = ap.parse_args()
    p = os.path.join(ROOT, "cities", "index.json")
    s = open(p, encoding="utf8").read()
    idx = json.loads(s)
    if not any(c["id"] == a.id for c in idx["cities"]):
        last = [c for c in idx["cities"] if c.get("group") == "Tokyo"][-1]
        anchor = f'      "summary": {json.dumps(last["summary"], ensure_ascii=False)}\n    }},\n'
        assert anchor in s, "the last Tokyo map's entry not found as written"
        entry = {"id": a.id, "name": a.name, "native": a.native, "country": "Japan", "lat": float(a.lat), "lon": float(a.lon), "status": "live",
                 "group": "Tokyo", "tagline": a.tagline, "summary": a.summary}
        body = ",\n".join(f"      {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in entry.items())
        s = s.replace(anchor, anchor + "    {\n" + body + "\n    },\n", 1)
    for name in a.district or [a.name]:
        m = re.search(r'(\{\n\s*"name": ' + re.escape(json.dumps(name, ensure_ascii=False)) + r',\n(?:[^{}]*?))\n(\s*)\}', s)
        assert m, f"district {name} not on the subway map"
        block = m.group(1)
        nb = re.sub(r',\n\s*"note": "[^"]*"', "", block)
        if '"map"' not in nb:
            nb = nb.replace(f'"lon": ', '"lon": ', 1)
            nb = re.sub(r'("lon": [0-9.]+)', r'\1,\n' + " " * 10 + f'"map": "{a.id}"', nb, count=1)
        s = s.replace(block, nb, 1)
    json.loads(s)
    open(p, "w", encoding="utf8").write(s)
    import build_scene
    build_scene.write_index()
    print(f"{a.id}: in cities/index.json and web/data/cities.json")


if __name__ == "__main__":
    main()
