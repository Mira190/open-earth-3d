"""Each game city's climate (rain, and for the live cities temperature, wind, snow, thunder and fog), for the game's weather (web/game/weather.js).

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
JMA_MORE = ("temperatures, wind, and days with snow (any solid precipitation seen, sleet and flurries among them), "
            "thunder and fog: the same JMA 1991-2020 table (data.jma.go.jp/stats/etrn/view/nml_sfc_ym.php), read November 2026")
# Days a month a typhoon passes near: JMA counts about three approaches a year to Kanto-Koshin and to Kinki
# (1991-2020), nearly all from July to October; the split by month is a chosen shape, not a table.
TYPHOON = [0, 0, 0, 0, 0.1, 0.2, 0.4, 0.9, 1.0, 0.6, 0.1, 0]
TOKYO = {"rain_days": [5.3, 6.1, 10.3, 10.9, 11.1, 12.8, 12.0, 9.4, 12.3, 11.8, 8.2, 5.8], "threshold_mm": 0.5,
         "drizzle": 0.55, "source": f"Tokyo (Kitanomaru Park): {JMA}",
         "temp_max": [9.8, 10.9, 14.2, 19.4, 23.6, 26.1, 29.9, 31.3, 27.5, 22.0, 16.7, 12.0],
         "temp_min": [1.2, 2.1, 5.0, 9.8, 14.6, 18.5, 22.4, 23.5, 20.3, 14.8, 8.8, 3.8],
         "wind_ms": [2.7, 3.0, 3.1, 3.2, 3.1, 2.8, 3.2, 2.9, 2.7, 2.6, 2.5, 2.6], "wind_from_deg": 338,
         "snow_days": [2.8, 3.5, 1.4, 0.1, 0, 0, 0, 0, 0, 0, 0, 0.6],
         "thunder_days": [0.2, 0.2, 0.5, 1.1, 1.6, 1.2, 2.5, 3.2, 2.5, 0.8, 0.4, 0.2],
         "fog_days": [0, 0, 0, 0.4, 0.2, 0.1, 0.1, 0, 0.1, 0.1, 0.4, 0], "typhoon_days": TYPHOON,
         "more": f"Tokyo: {JMA_MORE}. The wind's bearing is the commonest of the year (NNW; southerly from May to August)."}
KYOTO = {"rain_days": [8.1, 8.9, 11.2, 10.6, 10.8, 13.2, 12.6, 9.3, 11.1, 9.4, 7.4, 8.2], "threshold_mm": 0.5,
         "drizzle": 0.5, "source": f"Kyoto: {JMA}",
         "temp_max": [9.1, 10.0, 14.1, 20.1, 25.1, 28.1, 32.0, 33.7, 29.2, 23.4, 17.3, 11.6],
         "temp_min": [1.5, 1.6, 4.3, 9.2, 14.5, 19.2, 23.6, 24.7, 20.7, 14.4, 8.4, 3.5],
         "wind_ms": [1.7, 1.8, 2.0, 2.1, 2.1, 2.0, 1.9, 2.1, 1.9, 1.7, 1.5, 1.6], "wind_from_deg": 10,
         "snow_days": [16.3, 14.2, 6.8, 0.4, 0, 0, 0, 0, 0, 0, 0, 6.9],
         "thunder_days": [0.1, 0.1, 0.4, 1.1, 1.6, 1.7, 4.9, 5.1, 2.6, 1.0, 0.4, 0.5],
         "fog_days": [0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.1, 0.1], "typhoon_days": TYPHOON,
         "more": f"Kyoto: {JMA_MORE}. Its thunder and fog counts carry JMA's mark for a normal from incomplete observations."}
# Queenstown: NIWA's Otago report gives 12 days of snow, 5 of thunder and 1 of fog a year in the town with no
# split by month. The snow days are spread over the months in proportion to NIWA's ground-frost days
# (1991-2020: 0.1, 0.2, 1.1, 5.9, 13.3, 21.0, 24.5, 21.5, 15.1, 9.9, 3.9, 0.3), a chosen shape; thunder evenly
# over the warmer half; the fog days are the lake's and the valley's autumn and winter mornings, set above
# the town station's one a year so that the mist the place is known for is seen (a judgement).
QUEENSTOWN = {"rain_days": [7.6, 6.5, 7.3, 7.3, 9.7, 8.6, 7.8, 8.1, 8.3, 8.4, 7.7, 8.7], "threshold_mm": 1.0, "drizzle": 0.35,
              "source": "NIWA, Queenstown Airport (agents 5450 and 5451), 1991-2020 normals, days with at least 1 mm (via Wikipedia's climate table)",
              "temp_max": [22.0, 21.8, 19.1, 15.2, 11.9, 8.6, 8.2, 10.2, 13.0, 15.4, 17.5, 20.2],
              "temp_min": [9.9, 9.5, 7.3, 4.5, 2.3, -0.4, -1.4, 0.2, 2.4, 4.4, 6.2, 8.5],
              "wind_ms": [3.9, 3.7, 3.4, 3.1, 2.8, 2.8, 2.7, 2.8, 3.3, 3.7, 3.9, 3.8], "wind_from_deg": 250,
              "snow_days": [0, 0, 0.1, 0.6, 1.4, 2.2, 2.6, 2.3, 1.6, 1.0, 0.2, 0],
              "thunder_days": [0.7, 0.7, 0.5, 0.3, 0.2, 0.2, 0.2, 0.3, 0.4, 0.5, 0.5, 0.5],
              "fog_days": [0, 0.2, 0.6, 1.5, 2.5, 2.5, 2.5, 1.2, 0.4, 0, 0, 0], "snow_share": 0.8,
              "more": "Queenstown: temperatures NIWA 1991-2020 (Queenstown Aero, max_ and min_air_temperature_1991-2020.xlsx); wind NIWA, The Climate and Weather of Otago (2015), table 1, km/h as m/s; snow, thunder and fog from its table 20 (12, 5 and 1 days a year), spread by month as pipeline/weather_climate.py says."}
# Sydney: the Bureau's tables no longer list thunder or fog days. Wikipedia's Climate of Sydney gives 20 to 25
# thunder days and about 15 fog days a year; they are spread by month in the shape of a secondary table
# (climates.com, Sydney area, percent of days), scaled to 22 and 15 a year.
SYDNEY = {"rain_days": [8.2, 9.0, 10.1, 7.9, 7.9, 9.3, 7.2, 5.6, 5.8, 7.6, 8.7, 7.9], "threshold_mm": 1.0,
          "drizzle": 0.3, "source": "Bureau of Meteorology, Sydney (Observatory Hill), 1991-2020, days with at least 1 mm",
          "temp_max": [27.0, 26.8, 25.7, 23.6, 20.9, 18.3, 17.9, 19.3, 21.6, 23.2, 24.2, 25.7],
          "temp_min": [20.0, 19.9, 18.4, 15.3, 12.3, 10.0, 8.9, 9.7, 12.3, 14.6, 16.6, 18.4],
          "wind_ms": [3.7, 3.5, 3.2, 3.1, 3.2, 3.5, 3.9, 4.3, 4.3, 4.3, 4.2, 4.1], "wind_from_deg": 45,
          "thunder_days": [2.3, 2.1, 1.8, 1.7, 1.3, 0.9, 0.9, 1.3, 1.7, 2.3, 2.6, 3.1],
          "fog_days": [0.3, 0.6, 1.3, 1.9, 2.9, 2.2, 1.9, 1.6, 0.9, 0.6, 0.6, 0.3],
          "more": "Sydney: temperatures the Bureau's 1991-2020 statistics for Observatory Hill (066062); wind the mean of its 9 am and 3 pm speeds (1955-1992); thunder and fog days as pipeline/weather_climate.py says (annual totals from Wikipedia's Climate of Sydney, the split by month a secondary table's shape)."}
# Kamakura has no JMA station with normals of its own; Yokohama (47670), 17 km north on the same bay shore, stands for it.
KAMAKURA = {"rain_days": [5.7, 6.3, 11.0, 10.7, 11.1, 13.5, 12.0, 8.8, 12.7, 12.1, 8.6, 6.2], "threshold_mm": 0.5,
            "drizzle": 0.55, "source": f"Yokohama, for Kamakura: {JMA}",
            "temp_max": [10.2, 10.8, 14.0, 18.9, 23.1, 25.5, 29.4, 31.0, 27.3, 22.0, 17.1, 12.5],
            "temp_min": [2.7, 3.1, 6.0, 10.7, 15.5, 19.1, 22.9, 24.3, 21.0, 15.7, 10.1, 5.2],
            "wind_ms": [3.6, 3.7, 3.9, 3.9, 3.6, 3.2, 3.4, 3.4, 3.4, 3.4, 3.3, 3.4], "wind_from_deg": 0,
            "snow_days": [4.9, 7.0, 3.4, 0.1, 0, 0, 0, 0, 0, 0, 0, 2.3], "snow_share": 0.3,
            "thunder_days": [0.2, 0.3, 0.9, 1.1, 1.5, 0.8, 2.0, 2.8, 2.3, 0.8, 0.6, 0.5],
            "fog_days": [0.1, 0.4, 0.6, 0.6, 0.3, 0.3, 0.2, 0.2, 0.2, 0.3, 0.7, 0.1], "typhoon_days": TYPHOON,
            "more": f"Yokohama, for Kamakura: {JMA_MORE}. The wind's bearing is the commonest of the year (north; south-west from June to August). A smaller share of its snow days bring snow that falls as snow (snow_share): the coast is milder than the station."}
CLIMATE = {
    "kamakura": KAMAKURA,
    "tokyo": TOKYO, "shibuya": TOKYO, "shinjuku": TOKYO, "asakusa": TOKYO, "akihabara": TOKYO, "ueno": TOKYO, "ikebukuro": TOKYO, "jinbocho": TOKYO, "roppongi": TOKYO, "tsukishima": TOKYO, "odaiba": TOKYO, "shinagawa": TOKYO,
    "osaka": {"rain_days": [6.4, 7.3, 10.3, 10.0, 10.4, 12.3, 11.3, 7.8, 10.6, 9.2, 7.0, 7.1], "threshold_mm": 0.5,
              "drizzle": 0.5, "source": f"Osaka: {JMA}"},
    "kyoto": KYOTO, "higashiyama": KYOTO, "fushimi-inari": KYOTO, "tetsugaku": KYOTO,
    "queenstown": QUEENSTOWN,
    "hong-kong": {"rain_days": [5.7, 7.97, 10.5, 11.37, 15.37, 19.33, 18.43, 17.5, 14.9, 7.83, 5.7, 5.3], "threshold_mm": 0.1,
                  "drizzle": 0.3, "source": "Hong Kong Observatory, 1991-2020 normals, days with at least 0.1 mm"},
    "paris": {"rain_days": [9.9, 9.1, 9.5, 8.6, 9.2, 8.3, 7.4, 8.1, 7.5, 9.5, 10.4, 11.4], "threshold_mm": 1.0,
              "drizzle": 0.5, "source": "Météo-France, Paris-Montsouris, 1991-2020 normals, days with at least 1 mm"},
    "amsterdam": {"rain_days": [12.2, 10.8, 9.7, 8.6, 8.9, 9.7, 10.9, 11.6, 10.9, 12.4, 13.4, 14.1], "threshold_mm": 1.0,
                  "drizzle": 0.55, "source": "KNMI, Amsterdam Airport Schiphol, 1991-2020 normals, days with at least 1 mm"},
    "sydney": SYDNEY,
}
MELBOURNE = {"rain_days": [8.3, 7.5, 8.4, 9.9, 12.0, 13.0, 14.0, 14.8, 13.9, 12.5, 10.8, 9.9], "threshold_mm": 0.2,
             "drizzle": 0.6, "source": "Bureau of Meteorology, Melbourne, 1991-2020, days with at least 0.2 mm"}
CLIMATE["melbourne"] = CLIMATE["melbourne-bayside"] = MELBOURNE
PARKED = set(json.load(open(os.path.join(ROOT, "cities", "index.json"), encoding="utf8")).get("parked", []))


def one_line(v):
    return json.dumps(v, ensure_ascii=False, separators=(", ", ": "))


def write_city(city, w):
    path = os.path.join(ROOT, "cities", city, "city.json")
    text = open(path, encoding="utf8").read()
    line = f'"weather": {one_line(w)}'
    # the key just inside "game", on one line or over several: replaced in place, or put there
    m = re.search(r'^(\s*)"weather": \{', text, re.M)
    if m:
        depth, k = 0, m.end() - 1
        while True:
            depth += {"{": 1, "}": -1}.get(text[k], 0)
            k += 1
            if depth == 0:
                break
        text = text[:m.start()] + m.group(1) + line + text[k:]
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
    for city in cities or sorted(c for c in CLIMATE if c not in PARKED):  # (parked cities wait: AGENTS.md)
        w = CLIMATE.get(city)
        if w and not write_city(city, w):
            print(f"{city}: no game section")
            continue
        print(f"{city}: {sync_game(city)} changes in game.json")


if __name__ == "__main__":
    main(sys.argv[1:])
