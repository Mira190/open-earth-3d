"""Postcards: the stills the title screen's postcards show (web/postcards.js, docs/POSTCARDS.md).

A city names its postcard spots in cities/<id>/postcards.json: where the photographer stands ("at", with "z" for a
deck or a roof rather than the street), what the camera looks at ("look", "lookUp" metres over the ground the
photographer stands on), a name and a line of the diary for each light.

  python pipeline/postcards.py views <city> [--draft]   # the views for tools/game_shot.js, to stdout
  python pipeline/postcards.py pack <city> <png dir>    # the stills as WebP in web/data/<city>/postcards/
  python pipeline/postcards.py index                    # web/data/postcards.json, which the pages read

tools/postcards.sh <city>... runs the three for each city. A still is taken at each of four lights, on the clock
of the day it is rendered: dawn, day, dusk and night. The page shows the one whose light matches the real sun
over that city at the minute the postcard is dated.
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIGHTS = {"dawn": "sunrise+25", "day": "11:00", "dusk": "sunset+8", "night": "sunset+100"}  # (night by the sun, not the clock: at 21:00 a southern summer is still in twilight)
SIZE = (960, 640)


GLOW = {"dawn": 0.0, "day": 0.0, "dusk": 0.008, "night": 0.012}  # the plush's own light, as from the street or a phone after dark


def spots(city):
    return json.loads((ROOT / "cities" / city / "postcards.json").read_text())["spots"]


def friend(city):
    """The traveller in the map's stills (tools/plush.js, Mugi) and its colour there: {kind, name, what, scarf}."""
    return json.loads((ROOT / "cities" / city / "postcards.json").read_text()).get("plush")


def views(city, draft=False):
    out, toy = [], friend(city)
    for i, s in enumerate(spots(city)):
        for light, time in LIGHTS.items():
            if draft and light != "day":
                continue
            v = {"name": f"{s['id']}-{light}", "at": s["at"], "look": s["look"], "eye": s["at"][:2],
                 "eyeUp": s.get("up", 1.65), "lookUp": s.get("lookUp", 1.65), "time": s.get(light, time), "fov": s.get("fov", 46), "apart": 7}
            if draft and s.get("clear"):
                v["clear"] = s["clear"]  # the stand moved to the clearest view within that far, and printed
            if toy:  # a spot's "plush" moves it: {"side": -1 | 1, "x", "y", "tilt", "fstop"}; false leaves it out
                if s.get("plush") is not False:
                    v["plush"] = {"kind": toy["kind"], "scarf": toy.get("scarf"), "side": 1 if i % 2 == 0 else -1, "glow": GLOW[light], **(s.get("plush") or {})}
                    # from a deck, a roof or a lookout (a railing between it and the view), or tilted up steeply at a
                    # tower, it is held up to the view; elsewhere it sits in the scene
                    up = math.degrees(math.atan2(s.get("lookUp", 1.65) - 0.38, math.hypot(s["look"][0] - s["at"][0], s["look"][1] - s["at"][1])))
                    if "mode" not in v["plush"] and ("z" in s or up > 20):
                        v["plush"]["mode"] = "held"
                    if v["plush"].get("mode") != "held":  # the lens down at the traveller's eye, as a photograph of a toy is taken
                        v["eyeUp"] = v["plush"].get("eyeUp", 0.38)
                v["apart"] = 10  # (and nobody close to the lens: a stranger at the frame's edge took the picture from the toy)
            if "z" in s:
                v["z"] = s["z"]
            else:
                v["street"] = True
            if light == "day" and "day" not in s and s.get("pm"):
                v["time"] = "15:00"  # a view that looks east is lit in the afternoon
            out.append(v)
    return out


def pack(city, src):
    from PIL import Image
    dst = ROOT / "web" / "data" / city / "postcards"
    dst.mkdir(parents=True, exist_ok=True)
    want = {f"{s['id']}-{light}" for s in spots(city) for light in LIGHTS}
    for old in dst.glob("*.webp"):
        if old.stem not in want:
            old.unlink()
    n = 0
    for name in sorted(want):
        png = Path(src) / f"{name}.png"
        if not png.exists():
            print(f"{city}: no still for {name}", file=sys.stderr)
            continue
        im = Image.open(png).convert("RGB")
        w, h = im.size
        tw = min(w, round(h * SIZE[0] / SIZE[1]))  # the middle of the frame, at 3:2
        th = round(tw * SIZE[1] / SIZE[0])
        im = im.crop(((w - tw) // 2, (h - th) // 2, (w - tw) // 2 + tw, (h - th) // 2 + th)).resize(SIZE, Image.LANCZOS)
        im.save(dst / f"{name}.webp", "WEBP", quality=80, method=6)
        n += 1
    print(f"{city}: {n} stills in {dst.relative_to(ROOT)}")


def index():
    live = json.loads((ROOT / "web" / "data" / "cities.json").read_text())
    out = {"note": "Postcard spots for web/postcards.js, written by pipeline/postcards.py from cities/<id>/postcards.json.",
           "lights": list(LIGHTS), "cities": {}}
    for c in live:
        f = ROOT / "cities" / c["id"] / "postcards.json"
        if not (f.exists() and c.get("game")):
            continue
        have = ROOT / "web" / "data" / c["id"] / "postcards"
        ss = []
        for s in spots(c["id"]):
            missing = [light for light in LIGHTS if not (have / f"{s['id']}-{light}.webp").exists()]
            if missing:
                print(f"{c['id']}: {s['id']} has no still for {', '.join(missing)}; left out", file=sys.stderr)
                continue
            o = {"id": s["id"], "name": s["name"], "at": s["at"][:2] + ([s["z"]] if "z" in s else []), "look": s["look"], "lines": s.get("lines", {})}
            if s.get("native"):
                o["native"] = s["native"]
            ss.append(o)
        if ss:
            out["cities"][c["id"]] = ss
            if friend(c["id"]):
                out.setdefault("friends", {})[c["id"]] = {k: friend(c["id"])[k] for k in ("kind", "name", "what")}
    (ROOT / "web" / "data" / "postcards.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n")
    print("web/data/postcards.json:", ", ".join(f"{k} {len(v)}" for k, v in out["cities"].items()))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "views":
        print(json.dumps(views(sys.argv[2], "--draft" in sys.argv)))
    elif cmd == "pack":
        pack(sys.argv[2], sys.argv[3])
    elif cmd == "index":
        index()
    else:
        sys.exit(__doc__)
