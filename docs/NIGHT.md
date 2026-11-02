# The city at night

After dark every city shows its lights the way an aerial photograph does: lines of
street lights along every mapped road, the pavement and the foot of the buildings lit
under them, the traffic's headlights and tail lights, office towers lit floor by floor
with their crowns lit, red lights on the tallest tops, and over it all a deep blue sky
with the city's glow low on the horizon. The model viewer and the game share all of it
(`web/night.js`, `web/world.js`, `web/buildings.js`, `web/lens.js`).

![Tokyo at 21:00 from 350 m: streets lit, offices lit by the floor, crowns lit](images/night/tokyo-night.jpg)

| Sydney: the Harbour Bridge, its traffic and the CBD in the harbour | Paris at 23:30: the street grid from 1.5 km |
|---|---|
| ![](images/night/sydney-bridge.jpg) | ![](images/night/paris-night.jpg) |
| **Paris at dusk: the boulevards light the lower floors** | **The game: Tokyo from the helicopter** |
| ![](images/night/paris-dusk.jpg) | ![](images/night/tokyo-game-heli.jpg) |

Before this, the night was a grey dusk: the same Tokyo view at 21:00.

![Tokyo before: grey buildings, faint windows, a blue fog wall](images/night/before-tokyo.jpg)

## What makes a night city read as premium

We looked at how night cityscapes are photographed and lit, and at how real-time
renderers draw night cities, before deciding what to draw.

- **The sky is never black.** Photographers shoot cities in the blue hour, or expose a
  night so that the sky stays a deep blue: the sky and the artificial light are then of
  similar brightness, both read, and the warm lights stand against a cool sky
  ([Mark Gray](https://blog.markgray.com.au/blog/blue-hour-photography),
  [Zoner](https://learn.zoner.com/making-the-most-of-the-blue-hour/),
  [Amateur Photographer](https://amateurphotographer.com/technique/get-better-night-shots-cities/)).
  The orange–blue split does most of the work.
- **A hierarchy of light, not an even grid.** Facade lighting designers contrast the
  parts of a building: the body is left dark with its windows, and the light goes to the
  crown, the verticals and the entrances, mostly in white light with its temperature
  varied rather than in colour
  ([Masterlight](https://masterlight.ee/facade-lighting-design/),
  [Alcon Lighting](https://www.alconlighting.com/blog/?p=9725),
  [IADA 2025, ZILART Tower](https://ad-c.org/winner/zilart-platinum-winner-architectural-and-facade-lighting-category-iada-2025/)).
  A tower drawn as a grid of equally bright windows looks cheap.
- **Offices light by the floor, homes by the room.** A tenant's floor, or the cleaners
  going up the building, light whole storeys; flats light one window or two. From across
  a city an office tower reads in bands.
- **Fewer windows lit, and brighter.** In an aerial photograph of a business district
  two hours after sunset most of a tower is dark, its lit floors bright against it, in
  bands and in runs, some brighter than the rest; offices are under cool white
  fluorescent or LED light and homes mostly warm. A tower lit everywhere at one level
  reads as a light grey block. In Japan many homes are lit by daylight-white ceiling
  lights (6500 K is a standard option of the ceiling fixtures sold there;
  [Village House](https://www.villagehouse.jp/blog/en/interior-design/how-to-choose-the-perfect-lighting-for-your-home/)),
  and the flats of Hong Kong's estates by tubes, so their windows read cool too.
- **Landmarks floodlit from below.** Osaka Castle's keep is lit every night to Motoko
  Ishii's design, converted to LED in 2023
  ([Lumenpulse](https://www.lumenpulse.com/projects/589/osaka-castle),
  [MONDO\*DR Awards 2024](https://mondodrawards.com/2024/?p=3536)): white walls bright,
  the copper roofs catching the light, the stone base lit warm. Kyoto Tower is floodlit
  white, and Tokyo Tower has Ishii's *Landmark Light* (1989): orange sodium lamps from
  October to early July and white metal halide in summer
  ([Tokyo Metropolitan Government](https://www.tokyoupdates.metro.tokyo.lg.jp/en/post-346/),
  [ECD](https://www.ecdonline.com.au/content/efficiency-renewables/article/motoko-ishii-lights-up-sparc-2-13-732541313)).
- **Glass reflects.** At night a curtain wall is a dark mirror: blue sky above, the
  city's glow and its neighbours' lights below.
- **Many lights as materials, not light sources.** Real-time night cities draw street
  lights, windows and traffic as emissive materials rather than one light per lamp
  (the Unreal Engine *City Lights* tool reports 1–1.5 ms for a whole city this way;
  [forum](https://forums.unrealengine.com/t/released-city-lights-night-city-traffic-streetlights-and-lit-windows-without-light-actors-ue-5-1-to-5-8/2841691)),
  and per-building window lighting is procedural (Chandler, Yang and Ren 2015, cited by
  [Hlavová, *Rendering Night Cities*, 2025](https://dcgi.fel.cvut.cz/en/theses/2025/hlavoter/)).
  Faking night by thickening the haze is a known mistake
  ([Planetside forum](https://planetside.co.uk/forums/index.php?msg=271595)).

No code was taken from any of these; the ideas are general. What was adopted, and where:

| Idea | Here |
|---|---|
| A sky that stays blue, warm low down | `world.js`: after dark the sky shader blends to a designed night sky, deep blue overhead and the city's glow over the horizon (`style.skyglow`); the haze at the model's edge is the night's blue |
| Warm lights against cool shadows | `lens.js` `uNightTone`: at night the grade takes the shadows to blue and the lights to amber |
| A hierarchy on the towers | `night.js`: crowns lit on 60% of the towers over 60 m (a wash up the top storeys and a line along the parapet, mostly white); `buildings.js`: lobbies lit all night |
| Offices by the floor, homes by the room | `buildings.js`: an office's lit rooms follow its floors, and offices empty through the evening; each building keeps its own evening; each lit run has its own brightness, a few floors bright |
| Fewer windows lit, and brighter | `buildings.js`: lit rooms 1.6 times as bright as before and fewer of them (an office two thirds as many at 19:00, three quarters at 21:00); offices under cool white, a floor in four warmer; homes warm, or cool in Japan and Hong Kong; `world.js`: the landmark towers' curtain walls (Hong Kong's) light in runs under cool white too |
| Landmarks floodlit from below | `world.js` `flood`: a landmark's walls lit full, the undersides of its eaves more, its roofs at a graze, fading up the building; Osaka Castle (its stone base too), Kyoto Tower, Tokyo Tower (its colour by the season) and the Harbour Bridge's arch |
| Glass that reflects | the environment light is drawn from the night sky, so curtain walls mirror blue above and warm below |
| Lights as materials | `night.js`: lamps, traffic and tower lights are points and strips in three draw calls; the light on the ground is one texture |

## The pieces

**Street lights.** A lamp every 28 to 44 m along each mapped road by its class, at the
kerb, on one side of a small street and staggered along both sides of a large one, 5 to
13 m up, in the city's mix of high-pressure sodium and LED. The lamps OpenStreetMap
maps (park paths, footways) are lit too. A lamp is a point of light that keeps its size
on screen as it recedes and dims more slowly than the inverse square, so the far city
still sparkles; it is brightest seen from the side, as a lamp's lens is.

**The light on the ground.** Every lamp's pool, stretched along its road and centred a
little out over it, is splatted once into a map over the model's frame (2048 texels on
the long side, 1024 on the low tier) and kept as square roots in 8 bits, with mipmaps.
The ground adds it to what it reflects, so lit asphalt shows the photo's road markings;
piers and bridge decks do too. Building walls add the light in front of them, fading up
the lower floors. A coarse mip of the same map is the glow of a busy district. Where
pools overlap (a boulevard's two rows, a bridge, a junction) the light rolls off on a
soft knee instead of adding up to white.

**Traffic.** Cars as points of light moving at the road's speed on its side of the road,
white where they come towards the camera and red where they go away, as many as the hour
has (rush hours full, three in the morning a sixth). Motorways run one way along each
mapped carriageway. In the game the real cars near the player take over within their
radius of the camera (`game.crowd.radius_m` plus 100 m; 550 m by default).

**The towers.** Red aircraft warning lights at the corners of every top above the
country's height (60 m in Japan, where they flash together forty times a minute; 90 to
110 m elsewhere, steady), and lit crowns.

**The windows.** An office lights by the floor, in runs of six bays, and a home by the
room. The share of rooms lit follows the hour: offices four floors in five at 17:00,
three in four at 18:00, half at 19:00, a third at 20:00, a fifth at 21:00 and a few all night;
homes up to under half through the evening. Each building takes 0.3 to 1.7 times that
share, so one tower works late beside another all but empty. A lit run has its own
brightness, most at room light and one in ten bright, and its own light: offices cool
white (4000 to 5000 K) with a floor in four warmer, homes warm with a share under cool
ceiling lights (0.55 in Japan, 0.6 in Hong Kong, 0.15 elsewhere). Once a run is under a
pixel the facade takes the mean of all that, so a far tower keeps its own tone.

**Floodlit landmarks.** A landmark's floodlit material with `flood` is lit from below
(`world.js`): walls full, the undersides of eaves a little more, roofs facing up at a
graze, falling off up the building, and the light comes back off the surface in its
pattern (the courses of a stone base, the tiles of a roof). Osaka Castle's keep is lit
warm white with its copper roofs and its stone base lit; Kyoto Tower white with its deck's
windows lit; Tokyo Tower orange, white in summer (`emissive_dates`); the Harbour Bridge's
arch softly from its deck. Without `flood` a floodlit material glows evenly, as signs and
screens do (the Eiffel Tower's gold, Hong Kong's frames and crowns).

**Poles.** The generated lamps stand on poles with an arm out over the road, in
instanced batches of 300 m squares drawn within 500 m of the camera. No pole stands in a
carriageway: a lamp whose kerb would put it on a road crossing its own at the same level
(where a street meets a junction) is left out, 4 to 6 per cent of them in each city; a road
alongside (a dual carriageway's other half) does not count. A city can keep a square clear of poles
(`night.clear` in `city.json`, as Shibuya does over the scramble, whose paved crossing is far
wider than its streets).

**Big screens and lit signs.** A landmark can carry LED screens (`led_screen`, below) and
lit signs, and say how much light they throw on the street in front of them
(`landmarks.json` `glows`: `[x, y, radius m, colour, strength, on hour, off hour]`). A glow
without hours goes into the same light map as the lamps' pools; one with hours (a screen that
plays from 9:00 to midnight) goes into a map of its own, a quarter as fine, that is switched
with them. Either way it is in the screen's mean colour, so the pavement of a crossing ringed
by screens takes their colour while they play.

**When.** Everything fades in as the street lights come on, about when the sun sets.
Offices empty through the evening to a few floors lit all night (the windows, above).

**The night sky and the haze.** The sky's own model lifts a night sky to a grey tenth
of the day's, which lit every glass tower as if under an overcast evening. After dark it
now blends to the designed sky. The environment light is drawn from it, after the haze
for the hour is set: it used to keep the previous hour's haze, so a night kept the day's
bright horizon in every reflection (the cause of the grey nights in the game too).

## LED screens

Real-time cities usually draw a big screen as a texture that never changes, or as a video
(which needs a video per screen and stalls on a phone). Here a screen plays a programme from
one image, as broadcast graphics are built from keyframes:

- **One sheet of keyframes.** `pipeline/adkit.py` draws every clip's keyframes into one JPEG
  (`screens.jpg`, 2048 px square, 0.6 MB in Shibuya): gradients, light, type and a few product
  shapes, in a grid of cells. A city writes its clips in its `city.py`; the brands, music and
  films are invented.
- **A playlist per screen.** The material (`pattern: "led_screen"` in `landmarks.json`) lists
  each screen: its shape, phase, playlist (a bit mask over the clips), hours, brightness,
  whether it joins the synchronised slot, its height and LED pitch. A mesh's texture
  coordinate u carries the screen's number in its integer part, so every screen of a city is
  one draw call.
- **Motion from stills.** The shader holds each keyframe for `frame_s` seconds, pushes slowly
  into it, and wipes to the next along a slant with a bright edge; the cell is cropped to the
  screen's shape (cover). Every `sync[1]` seconds the screens that join play the same clip for
  `sync[2]` seconds, as the screens round Shibuya's crossing do.
- **Light, not paint.** The picture is emissive: bright enough to read in the sun, dimmed
  after dark as real screens are, off outside its hours; from close by its LEDs show as a grid
  of dots at the pixel pitch, which fades out before it can shimmer.
- **Placed on the built city.** `pipeline/screens.py` (`ScreenSet`) puts a site's screens on
  the facades of their buildings in `buildings.json` at their published sizes, builds the
  faces, frames and roof stands, writes the material and sheet, and the light they throw. A
  screen bent round a corner is a strip along its foot line (`path`, `round`). A city can have
  several sites, each its own material and sheet (Shibuya's crossing and Shinjuku's east exit);
  each gets a shader program of its own (`customProgramCacheKey`, as the screen count is in it).
  Used by Shibuya and Shinjuku (`cities/shibuya/city.py`) and Dotonbori (`cities/osaka/city.py`).
- **Blender.** `blender/build_scene.py` shows each screen's first keyframe, lit day and night.

## The data

`pipeline/night_lights.py` writes `web/data/<city>/night.json` from the city's
`game.json` (it runs at the end of `pipeline/game_data.py`, or on its own with
`--city <id>` or `--all`): the roads, simplified to within 1 m across and 0.5 m in
height, with their class and speed; the mapped lamps; and the city's style. Bridge parts
keep their deck's height and tunnels are left out (`game_data.py`). 50 to 310 kB a city.

The style comes from defaults by country, overridden by a `night` block in
`cities/<id>/city.json`:

| Key | Meaning |
|---|---|
| `street`, `highway` | `[[colour, share], ...]`: the street lamps' colours, and the motorways' and trunk roads' |
| `keep` | the side traffic keeps to (else `game.keep`, the tram's, or by country) |
| `aviation` | `{from_m, flash}`: the height from which tops carry red lights, and whether they flash |
| `crown` | `{from_m, share, colours}`: which towers have their crowns lit, and in what light |
| `skyglow` | the colour the city's lights give the sky low down |

| Country | Street lights | Motorways | Aircraft lights |
|---|---|---|---|
| Japan | mostly 4000–5000 K LED, a little sodium | half sodium | from 60 m, flashing |
| Hong Kong | mostly sodium, some LED | sodium | from 90 m; crowns in colour too |
| France | sodium and 3000 K | mostly sodium | from 100 m |
| Netherlands | 3000 K LED, some sodium | 4000 K | from 100 m |
| Australia | 3000–4000 K LED, some sodium | 4000 K | from 110 m |

## Checking it

```bash
python3 -m http.server 8800 --directory web &
QUERY=water=high xvfb-run -a node tools/city_shot.js tokyo views.json out 1440 900
```

`tools/city_shot.js` takes its stills at the desktop tier (`TIER` for the others) and with
Mesa's llvmpipe under `xvfb-run`; `QUERY=water=high` adds the water's reflection, which a
software renderer leaves out. The stills here were taken that way. Not checked: a real
GPU, Safari and iOS.
