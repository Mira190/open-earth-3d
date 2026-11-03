"""Each game city's rain climate, for the game's weather (web/game/weather.js).

The numbers are the mean count of days a month with measurable rain, from each national weather
service's 1991-2020 normals, as their climate tables give them (read from the Wikipedia climate
boxes that cite them, November 2026). The threshold differs by service (Japan's count starts at
0.5 mm, Hong Kong's at 0.1 mm, Melbourne's at 0.2 mm, the others at 1 mm), so it is kept with the
numbers and weather.js discounts a low one. "drizzle" is the share of wet days that stay a drizzle
rather than a rain, a judgement from each climate's character (Tokyo's tsuyu and Amsterdam's
North Sea rain mostly fine and long, Hong Kong's and Sydney's mostly showers and downpours).

This writes "weather" into cities/<id>/city.json (game) and copies it, with every quest's
"choices", into web/data/<id>/game.json, so the weather (and a quest's "Wait for the rain") shows
without rebuilding the game data, which pipeline/game_data.py writes from the raw downloads
(it passes "weather" through as well).

    python pipeline/weather_climate.py              # every game city
    python pipeline/weather_climate.py shinjuku
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

JMA = "Japan Meteorological Agency, 1991-2020 normals, days with at least 0.5 mm"
TOKYO = {"rain_days": [5.3, 6.1, 10.3, 10.9, 11.1, 12.8, 12.0, 9.4, 12.3, 11.8, 8.2, 5.8], "threshold_mm": 0.5,
         "drizzle": 0.55, "source": f"Tokyo (Kitanomaru Park): {JMA}"}
CLIMATE = {
    "tokyo": TOKYO, "shibuya": TOKYO, "shinjuku": TOKYO, "asakusa": TOKYO, "akihabara": TOKYO,
    "osaka": {"rain_days": [6.4, 7.3, 10.3, 10.0, 10.4, 12.3, 11.3, 7.8, 10.6, 9.2, 7.0, 7.1], "threshold_mm": 0.5,
              "drizzle": 0.5, "source": f"Osaka: {JMA}"},
    "kyoto": {"rain_days": [8.1, 8.9, 11.2, 10.6, 10.8, 13.2, 12.6, 9.3, 11.1, 9.4, 7.4, 8.2], "threshold_mm": 0.5,
              "drizzle": 0.5, "source": f"Kyoto: {JMA}"},
    "hong-kong": {"rain_days": [5.7, 7.97, 10.5, 11.37, 15.37, 19.33, 18.43, 17.5, 14.9, 7.83, 5.7, 5.3], "threshold_mm": 0.1,
                  "drizzle": 0.3, "source": "Hong Kong Observatory, 1991-2020 normals, days with at least 0.1 mm"},
    "paris": {"rain_days": [9.9, 9.1, 9.5, 8.6, 9.2, 8.3, 7.4, 8.1, 7.5, 9.5, 10.4, 11.4], "threshold_mm": 1.0,
              "drizzle": 0.5, "source": "Météo-France, Paris-Montsouris, 1991-2020 normals, days with at least 1 mm"},
    "amsterdam": {"rain_days": [12.2, 10.8, 9.7, 8.6, 8.9, 9.7, 10.9, 11.6, 10.9, 12.4, 13.4, 14.1], "threshold_mm": 1.0,
                  "drizzle": 0.55, "source": "KNMI, Amsterdam Airport Schiphol, 1991-2020 normals, days with at least 1 mm"},
    "sydney": {"rain_days": [8.2, 9.0, 10.1, 7.9, 7.9, 9.3, 7.2, 5.6, 5.8, 7.6, 8.7, 7.9], "threshold_mm": 1.0,
               "drizzle": 0.3, "source": "Bureau of Meteorology, Sydney (Observatory Hill), 1991-2020, days with at least 1 mm"},
}
MELBOURNE = {"rain_days": [8.3, 7.5, 8.4, 9.9, 12.0, 13.0, 14.0, 14.8, 13.9, 12.5, 10.8, 9.9], "threshold_mm": 0.2,
             "drizzle": 0.6, "source": "Bureau of Meteorology, Melbourne, 1991-2020, days with at least 0.2 mm"}
CLIMATE["melbourne"] = CLIMATE["melbourne-bayside"] = MELBOURNE


def one_line(v):
    return json.dumps(v, ensure_ascii=False, separators=(", ", ": "))


def write_city(city, w):
    path = os.path.join(ROOT, "cities", city, "city.json")
    text = open(path, encoding="utf8").read()
    line = f'"weather": {one_line(w)}'
    # the key on a line of its own, just inside "game": replaced in place, or put there
    m = re.search(r'^(\s*)"weather": \{.*\},?$', text, re.M)
    if m:
        old = m.group(0)
        text = text.replace(old, f'{m.group(1)}{line}{"," if old.rstrip().endswith(",") else ""}', 1)
    else:
        g = re.search(r'^(\s*)"game": \{\n(\s*)', text, re.M)
        if not g:
            return False
        text = text[:g.end()] + f'{line},\n{g.group(2)}' + text[g.end():]
    json.loads(text)  # still JSON
    open(path, "w", encoding="utf8").write(text)
    return True


def sync_game(city):
    cfg = json.load(open(os.path.join(ROOT, "cities", city, "city.json"), encoding="utf8")).get("game") or {}
    out = os.path.join(ROOT, "web", "data", city, "game.json")
    if not os.path.exists(out):
        return 0
    game = json.load(open(out, encoding="utf8"))
    changed = 0
    if cfg.get("weather") and game.get("weather") != cfg["weather"]:
        game["weather"] = cfg["weather"]
        changed += 1
    choices = {q["id"]: q.get("choices") for q in cfg.get("quests", [])}
    for q in game.get("quests", []):
        c = choices.get(q["id"])
        if c is not None and q.get("choices") != c:
            q["choices"] = c
            changed += 1
    style = (cfg.get("crowd") or {}).get("style")
    if style is not None and (game.get("crowd") or {}).get("style") != style:
        game.setdefault("crowd", {})["style"] = style
        changed += 1
    if changed:
        json.dump(game, open(out, "w"), separators=(",", ":"))  # as game_data.py writes it
    return changed


def main(cities):
    for city in cities or sorted(CLIMATE):
        w = CLIMATE.get(city)
        if w and not write_city(city, w):
            print(f"{city}: no game section")
            continue
        print(f"{city}: {sync_game(city)} changes in game.json")


if __name__ == "__main__":
    main(sys.argv[1:])
