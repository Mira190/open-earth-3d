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

# ---- the reef and alpine sites (web/reef/weather.js): written as "weather" at the top of cities/<id>/city.json and
# copied into web/data/<id>/scene.json (pipeline/marine_meta.py passes it through on a rebuild). Read November 2026.
# bom.gov.au refuses automated reads, so the Australian numbers are the Bureau's as Wikipedia's climate boxes cite
# them, or as its station pages are indexed by search engines; where a row could not be read it is left out (the
# weather then has no fog or thunder from the season there, and the wind its default), or derived as noted.
# elev_m: the station's height, so the air cools 6.5 degrees a kilometre above it (weather.js's snow line).
NZ_SNOW_SHAPE = [0, 0, 0.1, 0.6, 1.4, 2.2, 2.6, 2.3, 1.6, 1.0, 0.2, 0]   # Queenstown's frost-day shape (above), for an annual count
def spread(total, shape):
    k = total / sum(shape)
    return [round(v * k, 2) for v in shape]
SE_TRADES = 135   # the south-east trades, the Reef's usual wind most of the year: a judgement, no rose was read
GREEN_ISLAND = {"rain_days": [16.0, 15.7, 15.1, 14.4, 10.1, 7.2, 5.7, 4.5, 4.2, 6.2, 8.3, 10.9], "threshold_mm": 1.0, "drizzle": 0.25,
                "temp_max": [31.1, 30.4, 29.2, 27.9, 25.8, 24.0, 23.5, 24.6, 27.3, 29.7, 31.2, 31.7],
                "temp_min": [25.3, 25.4, 24.8, 24.0, 22.6, 21.4, 20.2, 20.4, 21.6, 23.1, 24.2, 25.1],
                "wind_ms": [6.4, 6.8, 8.8, 9.4, 9.6, 10.4, 9.5, 8.9, 7.3, 6.8, 6.3, 5.9], "wind_from_deg": SE_TRADES, "elev_m": 3,
                "source": "Bureau of Meteorology: Green Island (031192), temperatures and the mean of the 9 am and 3 pm winds, 1993-2010; days with at least 1 mm from Cairns Aero (031011), 1991-2020 (the island has no rain-day row; it is a little drier)",
                "more": "Read from the Bureau's station page as search engines index it (bom.gov.au refuses automated reads) and Wikipedia's Cairns climate box, November 2026."}
HAMILTON = {"rain_days": [13.0, 13.8, 14.3, 12.2, 10.8, 7.4, 6.0, 3.3, 2.7, 3.6, 5.4, 7.6], "threshold_mm": 1.0, "drizzle": 0.25,
            "temp_max": [29.9, 29.7, 28.9, 27.0, 24.4, 22.3, 21.5, 22.9, 25.3, 27.4, 28.7, 29.9],
            "temp_min": [24.9, 24.9, 24.5, 22.9, 20.6, 18.9, 18.0, 18.5, 20.2, 22.1, 23.4, 24.6],
            "wind_from_deg": SE_TRADES, "elev_m": 4,
            "source": "Bureau of Meteorology, Hamilton Island Airport (033106), 2002-2024, days with at least 1 mm (via Wikipedia's climate box)",
            "more": "No wind row could be read: the weather's default mean wind. November 2026."}
# Lady Elliot Island's temperatures are the Bureau's (039059, 1939-2026); its rain days were not readable, so they are its
# monthly rain (mm, the same table) at Heron Island's ratio of rain days to rain (84.7 days to 1034 mm a year)
LE_MM = [113.5, 157.2, 125.6, 102.5, 118.8, 88.3, 87.4, 55.5, 38.1, 57.4, 66.6, 93.2]
LADY_ELLIOT = {"rain_days": [round(v * 84.7 / 1034.3, 1) for v in LE_MM], "threshold_mm": 1.0, "drizzle": 0.25,
               "temp_max": [29.3, 29.2, 28.4, 26.6, 24.1, 22.0, 21.3, 22.1, 23.9, 25.7, 27.3, 28.7],
               "temp_min": [24.0, 24.1, 23.5, 21.9, 19.6, 17.6, 16.7, 17.3, 18.8, 20.5, 22.0, 23.3],
               "wind_ms": [5.9] * 12, "wind_from_deg": SE_TRADES, "elev_m": 3,
               "source": "Bureau of Meteorology, Lady Elliot Island (039059), temperatures and rain 1939-2026; rain days derived from its rain at Heron Island's ratio",
               "more": "Wind: Heron Island's annual mean (21.5 and 20.7 km/h at 9 am and 3 pm, 1962-2010), 80 km away. Read from the Bureau's pages as search engines index them, November 2026."}
# Heron Island (039122): only the annual rows and a few months could be read; the rest is Lady Elliot's shape,
# 80 km away, the four known months of rain days kept (January 7.9, April 10.1, September 3.5, December 6.5)
HERON_DAYS = [round(v * 84.7 / sum(LE_MM), 1) for v in LE_MM]
for i, v in ((0, 7.9), (3, 10.1), (8, 3.5), (11, 6.5)):
    HERON_DAYS[i] = v
HERON = {"rain_days": HERON_DAYS, "threshold_mm": 1.0, "drizzle": 0.25,
         "temp_max": [round(v + 0.4, 1) for v in LADY_ELLIOT["temp_max"]], "temp_min": [round(v + 0.1, 1) for v in LADY_ELLIOT["temp_min"]],
         "wind_ms": [5.9] * 12, "wind_from_deg": SE_TRADES, "elev_m": 3,
         "source": "Bureau of Meteorology, Heron Island Research Station (039122): 84.7 days a year with at least 1 mm (1956-2007), mean maxima 29.8 (January) and 21.5 (July)",
         "more": "The months not readable follow Lady Elliot Island's (039059) shape, shifted to Heron's January and July temperatures. November 2026."}
MILFORD = {"rain_days": [16.3, 12.8, 14.4, 13.3, 15.6, 14.6, 14.4, 16.0, 17.6, 17.6, 15.3, 16.9], "threshold_mm": 1.0, "drizzle": 0.3,
           "temp_max": [19.5, 20.0, 18.5, 15.9, 12.5, 9.3, 9.2, 11.2, 13.2, 15.0, 16.4, 18.5],
           "temp_min": [10.7, 10.7, 9.2, 7.0, 4.9, 2.3, 1.6, 2.7, 4.1, 5.8, 7.6, 9.7],
           "wind_ms": [2.4, 2.3, 2.1, 2.1, 2.2, 2.3, 2.4, 2.3, 2.3, 2.5, 2.5, 2.5], "wind_from_deg": 320, "elev_m": 3,
           "snow_days": spread(4, NZ_SNOW_SHAPE), "thunder_days": [round(22 / 12, 2)] * 12, "fog_days": spread(2, [0.5, 0.5, 1, 1.5, 2, 2, 2, 1.5, 1, 0.5, 0.5, 0.5]),
           "source": "NIWA, Milford Sound Airport (agents 4107, 18309, 40987), 1991-2020, days with at least 1 mm (via Wikipedia's climate box)",
           "more": "Wind: the automatic station's mean of hourly winds; north-westerly, along the fiord (NIWA, The Climate and Weather of Southland, figure 8). Days a year with snow 4, thunder 22, fog 2 (its table 19), spread over the months: snow by Queenstown's frost-day shape, thunder evenly (the fronts off the Tasman), fog toward winter, a judgement. November 2026."}
TEKAPO = {"rain_days": [4.9, 4.4, 4.8, 5.9, 7.8, 7.2, 6.8, 7.2, 6.4, 7.3, 5.9, 6.2], "threshold_mm": 1.0, "drizzle": 0.3,
          "temp_max": [22.2, 22.2, 19.5, 15.3, 11.5, 7.4, 6.6, 8.8, 12.4, 15.2, 17.3, 20.1],
          "temp_min": [8.5, 8.2, 6.0, 3.5, 1.4, -1.9, -2.8, -1.2, 1.0, 2.8, 4.5, 6.8],
          "wind_ms": [4.4, 3.6, 3.6, 3.2, 3.1, 3.0, 3.1, 3.2, 4.3, 4.4, 4.5, 4.1], "wind_from_deg": 315, "elev_m": 762,
          "snow_days": spread(12, NZ_SNOW_SHAPE), "thunder_days": spread(2, [1, 1, 0.5, 0, 0, 0, 0, 0, 0, 0.3, 0.6, 1]), "fog_days": spread(0.3, [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0]),
          "source": "NIWA, Lake Tekapo, 762 m (agents 4616, 4970, 24945), 1991-2020, days with at least 1 mm (via Wikipedia's climate box)",
          "more": "Wind: NIWA, The Climate and Weather of Canterbury (2016), table 1; its bearing the nor'wester's, as at Aoraki (no rose for Tekapo: a judgement). Days a year with snow 12, thunder 2, fog 0.3 (table 20), spread over the months by a chosen shape. November 2026."}
PUKAKI = {"rain_days": [11.3, 9.0, 10.0, 11.5, 15.2, 14.2, 13.2, 13.6, 15.0, 15.8, 13.5, 13.8], "threshold_mm": 1.0, "drizzle": 0.3,
          "temp_max": [20.4, 20.8, 18.4, 14.9, 11.0, 7.9, 7.2, 9.1, 11.8, 14.0, 16.3, 18.5],
          "temp_min": [8.7, 8.5, 6.5, 4.0, 1.3, -1.4, -2.2, -0.8, 1.5, 3.1, 5.0, 7.0],
          "wind_ms": [3.4, 2.9, 2.8, 2.3, 2.3, 2.0, 1.9, 2.0, 3.0, 3.2, 3.3, 3.1], "wind_from_deg": 305, "elev_m": 765,
          "snow_days": spread(24, NZ_SNOW_SHAPE), "thunder_days": spread(9, [1.5, 1.5, 1, 0.5, 0.3, 0.2, 0.2, 0.3, 0.5, 1, 1.2, 1.5]), "fog_days": spread(2, [0.5, 0.5, 1, 1.5, 2, 2, 2, 1.5, 1, 0.5, 0.5, 0.5]),
          "source": "NIWA, Mount Cook Village, 765 m, 1991-2020, days with at least 1 mm (via Wikipedia's climate box; the head of the lake, wetter than its south end)",
          "more": "Wind and its bearing: NIWA, The Climate and Weather of Canterbury (2016), table 1 and figure 5. Days a year with snow 24, thunder 9, fog 2 (table 20), spread over the months by a chosen shape. November 2026."}
REEFS = {"green-island": GREEN_ISLAND, "whitsundays": HAMILTON, "hardy-reef": HAMILTON, "heron-island": HERON,
         "lady-elliot-island": LADY_ELLIOT, "milford-sound": MILFORD, "lake-tekapo": TEKAPO, "lake-pukaki": PUKAKI}

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


def write_reef(city, w):
    """A reef or alpine site: "weather" at the top of cities/<id>/city.json, and in web/data/<id>/scene.json."""
    path = os.path.join(ROOT, "cities", city, "city.json")
    text = open(path, encoding="utf8").read()
    line = f'"weather": {one_line(w)}'
    m = re.search(r'^(\s*)"weather": \{.*\},?$', text, re.M)
    if m:
        text = text[:m.start()] + m.group(1) + line + ("," if m.group(0).rstrip().endswith(",") else "") + text[m.end():]
    else:
        g = re.search(r'^(\s*)"region": .*,$', text, re.M) or re.search(r'^(\s*)"name": .*,$', text, re.M)
        text = text[:g.end()] + f'\n{g.group(1)}{line},' + text[g.end():]
    json.loads(text)
    open(path, "w", encoding="utf8").write(text)
    out = os.path.join(ROOT, "web", "data", city, "scene.json")
    scene = json.load(open(out, encoding="utf8"))
    if scene.get("weather") == w:
        return 0
    raw = open(out, encoding="utf8").read()
    scene["weather"] = w
    json.dump(scene, open(out, "w", encoding="utf8"), **({"separators": (",", ":")} if "\n" not in raw.strip() else {"indent": 1}))
    return 1


def main(cities):
    for city in [c for c in cities if c in REEFS] or ([] if cities else sorted(REEFS)):
        print(f"{city}: {write_reef(city, REEFS[city])} changes in scene.json")
    cities = [c for c in cities if c not in REEFS]
    if not cities and any(c in REEFS for c in sys.argv[1:]):
        return
    for city in cities or sorted(c for c in CLIMATE if c not in PARKED):  # (parked cities wait: AGENTS.md)
        w = CLIMATE.get(city)
        if w and not write_city(city, w):
            print(f"{city}: no game section")
            continue
        print(f"{city}: {sync_game(city)} changes in game.json")


if __name__ == "__main__":
    main(sys.argv[1:])
