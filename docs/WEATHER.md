# Weather

The game has weather in every city: clear, overcast, drizzle and rain (`web/game/weather.js`).
Issue #95; it started from Shinjuku Gyoen's rainy-season mornings, where Kaede's quest offers
"Wait for the rain in the shelter".

Shinjuku in the June rain, desktop (the street and Gyoen's shelter at day, dusk and night, the
crowd under umbrellas, the pond) and phone:

![Shinjuku in the rain, desktop](images/weather/shinjuku-rain-desktop.jpg)
![Shinjuku in the rain, phone](images/weather/shinjuku-rain-phone.jpg)

## What decides it

- **The season.** `game.weather` in `cities/<id>/city.json` holds the city's mean number of days a
  month with measurable rain, from the national weather service's 1991–2020 normals, with the
  threshold that service counts from (`pipeline/weather_climate.py` lists each source). Each day of
  the year is wet or dry by a hash of its date, so a date always has the same weather; a wet day's
  rain comes in showers from a smooth noise over the hours, and some wet days stay a drizzle
  (`drizzle`, the share of them). Dry days are sometimes grey. Tokyo in June is wet about four days
  in ten: the tsuyu.
- **A choice.** The pause menu's Weather row (kept for the next visit), a quest choice
  (`"action": "set_weather", "weather": "rain", "date": [6, 18], "time": "08:10"`), or the page's
  `?weather=clear|overcast|drizzle|rain|live`.
- **Automated runs** (`navigator.webdriver`: the checks, stills and films) keep a clear sky unless
  they ask, so their frames stay comparable. `tools/game_shot.js` takes `"weather"` per view.

To change a city's climate, edit the table in `pipeline/weather_climate.py` and run
`python pipeline/weather_climate.py`; it writes `city.json` and copies the numbers (and every
quest's `choices`) into `web/data/<id>/game.json`. `pipeline/game_data.py` passes `weather` through.

## What it looks like

| Part | How | Tiers |
| --- | --- | --- |
| Rain streaks | Instanced quads in two shells round the camera (9 m and 30 m), world-stable (they wrap, they don't ride with the camera), each a drop's path over a 1/33 s shutter relative to the camera so a moving camera slants them, at least a pixel wide with alpha falling with their real width | high 6000 + 9000, medium 4000 + 5000, low 2200 + 2200 |
| Rain occlusion | A height map of the scene from straight above, 80 m round the camera, redrawn when the camera moves 4 m or every half second: no rain under a roof, a deck, a bridge or a tree | 256², low 128² every 1.2 s |
| Splashes | Rings and crowns popping on the tops of things within 16 m, their height from the occlusion map | 700 / 420 / 200 |
| Wet ground | Darker where porous, roughness down to 0.38, puddles in the low spots of a noise on roads and paving (0.035 roughness, flat, rippled), filling as the wetness rises and drying slowly after | all |
| Ripples | Expanding rings, one drop per cell in three offset grids, on puddles, ponds (`sk_pond`, any landmark water), rivers and the sea | all |
| Overcast light | Sun ×0.18 at full cloud, sky light up and greyer, a closer grey-blue haze (warm at night with the city in it), the sky's clouds up to 0.97 and its blue down, no stars or moon, the lens a little cooler with a touch more contrast and exposure lifted so it never goes grey | all |
| Umbrellas | The crowd puts them up as the rain comes on (fewer in a drizzle): Tokyo, Kyoto and Osaka mostly clear vinyl, elsewhere black, navy and a few colours; on the skinned people near you and the instanced crowd further off | all |
| Sound | Rain hiss and patter (synthesised noise), a drumming roof and drips under one, muffled in a car or the helicopter | all |

One shared state, `OEWeather.U` (`uOeWet`, `uOeRain`, `uOeOvercast`, `uOeT`), is what every patched
shader reads. `OEWeather.patch(shader, {puddles, porous, water})` makes any `MeshStandardMaterial`
wet; `OEWeather.GLSL` has `oePuddle(xz)` and `oeRipple(xz, camD)` for a city's own look (Shibuya's
wet-street reflections, #112, read the same wetness).

## What was surveyed, and what was adopted

Nothing was copied; the techniques are the published ones, written for this engine.

- **Tatarchuk, "Artist-Directable Real-Time Rain Rendering in City Environments"** (ATI ToyShop,
  SIGGRAPH 2006 course notes). Adopted: rain as camera-relative streaks stretched by motion blur, in
  layers near and far, and a top-down depth map to keep rain out from under cover. Not adopted: its
  pre-rendered rain textures and its light-dependent drop shading (we light the drops by the haze's
  colour, which tracks the hour).
- **Sébastien Lagarde, "Water drop" series** (2012–13, on wet surfaces in physically based
  rendering). Adopted: wetness darkens porous albedo and lowers roughness; puddles are a separate,
  near-mirror layer that fills the low spots first; rain ripples as procedural expanding rings.
- **Rain occlusion maps** in Frostbite and Unreal Engine's weather work: the same top-down height map
  idea; here it also seats the splashes.
- **three.js examples and community demos** (instanced particle rain, `Reflector` puddles): the
  instancing is the same; a planar reflector per puddle was rejected as too costly for every city on
  a phone. Screen-space reflections are left to #112 on the medium tier and up.
- **The three.js precipitation "skills" collection** (GPL-3.0) and **Godot "Rain Puddles" shader**
  (MIT, ripple data texture): read for comparison, no code taken; their licences are noted so that
  no one copies from them without carrying the licence.
- **Climate data**: Japan Meteorological Agency, Hong Kong Observatory, Météo-France, KNMI and the
  Bureau of Meteorology 1991–2020 normals, as their climate tables give them.

## Not yet

- Drips off a particular eave, and streams off a roof's edge: under a roof you hear drips, but they
  are not drawn.
- The quest NPCs keep their own looks (no umbrellas); the crowd carries them.
- Walls and roofs don't darken; the ground, paving landmarks, ponds and water do.
- Reef sites (`web/reef`) and the model viewer (`web/city.js`) have no weather.
- Not checked on a real GPU, WebGPU, Safari or iOS.
