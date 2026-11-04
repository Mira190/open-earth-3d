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
  `?weather=clear|overcast|drizzle|rain|live|off`.
- **Automated runs** (`navigator.webdriver`: the checks, stills and films) keep a clear sky unless
  they ask, so their frames stay comparable. `tools/game_shot.js` takes `"weather"` per view.

## When the device cannot carry it

Rain is the dearest thing the game draws: on the high tier a wet street draws the scene a second
time for its reflections (`web/mirror.js`), the occlusion map draws it again from above, and the
streaks are thousands of blended quads; a wet street keeps its puddles' noise and reflections for
minutes after the rain. So the weather has a guard (`weather.js`, `guard`), and weather that a device
cannot carry is not started:

| When | What happens |
| --- | --- |
| The low tier (`web/quality.js`: a software renderer, a phone, 4 GB of memory or less) | The season's weather starts **off**: a clear sky and dry streets, and the wet look's shader code is not even compiled (`arm`). A toast says so and points at the menu |
| In rain or on a wet street, under 28 fps for two 4 s windows running | **Light**: no reflections of the city in the street (the second render), half the streaks, no splashes, the occlusion map redrawn every 1.2 s or 8 m |
| Still under 24 fps | **Off**, with a toast |
| Dry, and already under 24 fps for two windows | **Off** before any rain comes: it would only make it worse |

The frame rate is the frame's own time (not the game's step, which is capped at 50 ms), counted only
in play: not on the title screen, in the menu, in photo mode or in a hidden tab, and not in the first
10 s after the title, while shaders compile and tiles load. What the guard decided is remembered
(`localStorage` `oe3d-weather-guard`: `light` or `off`), so the next visit starts there. A weather
picked in the menu, which now also has **Off**, is the visitor's: kept as picked, and the guard may
lighten it but never turns it off; picking one forgets what the guard remembered. `?weather=` counts
as a pick. Automated runs keep the full weather unless the address carries `?weatherguard`;
`tools/game_check.js` drives the guard with given frame times (`guard(dt, idle, frame)`) and checks
it lightens, turns off, remembers, says so and comes back on.

The same idea as the dynamic quality scaling of console and PC games (Unreal's scalability groups
and dynamic resolution, Unity's Adaptive Performance), cut down to the one system that costs the most
and can go without being missed: the weather steps down before anything else does, by measured frame
time rather than by the device's name.

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
