# The game: Sydney on Foot and Melbourne on Foot

The city model becomes a place you can be in. In Sydney you walk the centre as
a surveyor, talk to the people who know it, climb the Opera House steps, catch
the ferry, and fly a helicopter under the Harbour Bridge. In Melbourne you check
the winter sun on Federation Square, take a river shuttle down the Yarra, and
fly past the Arts Centre spire. The world is the same open-data model as the
viewer. In Sydney that means:

- 7,962 buildings from OpenStreetMap;
- the NSW bare-earth terrain;
- the real sun in Sydney's time zone.

Everything the characters tell you about the city is computed from the model
while you play.

Open it from the globe (**Play** on a city card), from the 3D model (the
**Play** chip), or directly at `web/index.html#play-sydney` or `#play-melbourne`.

| Talking to an NPC | On the bridge deck at golden hour |
|---|---|
| ![](images/sydney/game-dialogue.jpg) | ![](images/sydney/game-bridge.jpg) |
| **Under the Harbour Bridge** | **Bird's-eye view from the helicopter** |
| ![](images/sydney/game-heli.jpg) | ![](images/sydney/game-birdseye.jpg) |
| **The Cross Harbour ferry leaving Circular Quay** | **The map, with live ferries and fast travel** |
| ![](images/sydney/game-ferry.jpg) | ![](images/sydney/game-map.jpg) |
| **Martin Place, 21 June, 12:30: the sun meter** | **After dark from Bennelong Point: the city's lights in the harbour** |
| ![](images/sydney/game-martin-place.jpg) | ![](images/sydney/game-night.jpg) |
| **The Opera House's Monumental Steps** | **Melbourne: Hannah explains DDO10 in City Square** |
| ![](images/sydney/game-steps.jpg) | ![](images/melbourne/game-dialogue.jpg) |
| **The river shuttle on the Yarra** | **Past the Arts Centre spire** |
| ![](images/melbourne/game-river.jpg) | ![](images/melbourne/game-heli.jpg) |

## Playing

| Keys | What they do |
|---|---|
| <kbd>W A S D</kbd> or arrows | Walk relative to the camera. Drag to look around; scroll to zoom. |
| <kbd>Shift</kbd> · <kbd>X</kbd> · <kbd>Space</kbd> | Sprint · walk instead of jog · jump |
| <kbd>E</kbd> | Talk, board a ferry or wait for one, fly the helicopter, get out |
| <kbd>Q</kbd> | Survey lens: the building in front of you, its height and where the height comes from |
| <kbd>M</kbd> · <kbd>P</kbd> · <kbd>Esc</kbd> | Map with waypoints and fast travel · passport of stamps · menu (time of day, clock speed, crowds, sound) |
| <kbd>R</kbd> | Unstick yourself |
| Helicopter | <kbd>Space</kbd> climb, <kbd>C</kbd> or <kbd>Shift</kbd> descend, <kbd>W</kbd>/<kbd>S</kbd> forward/back, <kbd>A</kbd>/<kbd>D</kbd> turn, <kbd>V</kbd> bird's-eye view |
| Ferry | <kbd>F</kbd> skip ahead, <kbd>H</kbd> take the helm for the approach to the next wharf |

On a phone you get a joystick and buttons.

The Sydney survey has seven stamps:
1. Get your bearings at Circular Quay.
2. Hear how the Opera House shells are cut from one sphere, and climb the
   Monumental Steps to the podium.
3. Ride the ferry to Milsons Point.
4. Walk up the bridge approach to the middle of the arch.
5. Fly under the deck and land in the Domain.
6. Find a spot in Martin Place that gets sun at lunchtime on the winter solstice.
7. Use the survey lens on three buildings whose heights come from different sources.

Docking a ferry by hand earns an extra stamp. After the survey, the city is
free roam.

The Melbourne survey has six:
1. Meet Mia at Federation Square.
2. Hear from Hannah in City Square how DDO10 protects public spaces from new
   shadow.
3. Find a sunny spot on Federation Square at lunchtime on 22 June.
4. Take the river shuttle from Federation Wharf to Crown Landing.
5. Fly from the Yarra helipad past the Arts Centre spire to Birrarung Marr.
6. Use the survey lens on three height sources.

Melbourne has no ferry through the city, so the shuttle is invented and says
so.

The menu (<kbd>Esc</kbd>) lets you play as either surveyor.

## What we took from other games, and where this one is different

A research pass looked at the games people compare this to. The sources are
listed at the end.

| Game | What we took | What this does that it can't |
|---|---|---|
| **Microsoft Flight Simulator** | Hand-built landmarks over generated filler; an assisted helicopter, since players find hovering hard. | Its buildings are generated, and it shipped errors that open data can contain. A two-storey building tagged as 212 floors in OpenStreetMap reached the sim as a Melbourne monolith. Sydney's Harbour Bridge was a flat auto-generated span until World Update VII. Here every height has a source, outliers are capped, the towers are checked against published heights, and the bridge is built to its published geometry. |
| **Sketchbook** (three.js sandbox) | Assisted helicopter flight: the rotor cancels gravity so it hovers with no input, levels itself, damps drift and spools up before take-off. You walk to the door instead of teleporting in, and <kbd>E</kbd> to use. | Its world is an empty sandbox. Here the world is a real city with things to do. |
| **GTA V** | A clock running 30 times real time, so a day lasts 48 minutes. A minimap with a GPS route along the street network. A waypoint you click on the map. A crowd and traffic density setting. Skip-the-trip travel. | Its city is a caricature. Here the streets, wharves and sun are real, the traffic drives on the left at Overture speed limits, and crowds keep left as Australians do. |
| **Ship Simulator Extremes** | Docking as the skill moment: the ferry runs on autopilot across open water, then you bring her alongside and are scored. | Reviewers found its long cruises boring. Here the open-water legs can be skipped, and docking is optional. |
| **Assassin's Creed Discovery Tour** | Guided learning by place: each stop is a person who explains what is in front of you, with "behind the data" honesty. | Its narration was called dry. Here the lines are short and come from the model, such as the share of Martin Place in sun on 21 June at 12:30, computed while you stand there. |
| **A Short Hike, Animal Crossing** | One-breath dialogue lines that you can finish with a tap, a voice beep pitched per character, and small tasks with small rewards (passport stamps). | Their worlds are invented. Here a favour is a fact about a real place. |
| **Bruno Simon's portfolio, slowroads, Streets GL** | Instanced crowds, cars and street furniture. Detail only near the player. A hint to lower the density when the frame rate drops. | Streets GL needs a discrete GPU. This runs on a phone, with lower density there. |

## How it works

All of this is driven by `cities/<id>/city.json` (`game` block) and the files the
pipeline writes. The only city-specific code is landmark geometry in
`cities/<id>/city.py`:
- Sydney's bridge, Opera House and steps;
- Melbourne's spire.

- **Game data** (`pipeline/game_data.py` writes `web/data/<city>/game.json`):
  - **Water mask:** 5 m.
  - **Walking terrain:** 5 m. It drops at the seawall instead of sloping across
    a 10 m cell.
  - **Footways and roads:** 3D polylines.
    - Bridge parts follow the deck surface, using Overture's `is_bridge` flags
      and levels.
    - Tunnel parts are dropped (`is_tunnel`).
  - **Ferry berths:** placed next to the Overture ferry terminals named in the
    config.
  - **Ferry routes:**
    - Found by a shortest path through open water, weighted to keep to the
      middle of the channel and away from piers.
    - Smoothed only as far as the route still stays at least 4 m from land.
  - **Benches and street lamps:** from OpenStreetMap.
  - **NPCs:** snapped to open ground.
- **Opera House steps** (`city.py`): the Monumental Steps are 90 m wide and run
  40 m from the forecourt to the podium, as measured on the NSW aerial photo.
  They climb in two flights of 15 cm risers, with a landing between them and
  one at the top. A short ramp at the foot meets the forecourt, where the 5 m
  terrain dips up to 2 m into the vehicle concourse entrance. They are a walkable strip whose profile follows every riser,
  so feet land on the treads. Footways that cross them are draped onto them,
  so the crowd uses them too. The risers are a darker granite, so the steps
  read from a distance.
- **Bridge deck** (`city.py`):
  - The deck runs level across the arch and pylons.
  - The approach viaducts then descend at 5% until they meet the ground, the
    way the real approaches continue to the Cahill Expressway and North Sydney.
  - People and cars use the same surface, so you can walk across with the
    traffic.
- **Navigation** (`web/game/nav.js`): the 2 m surface model (terrain plus
  buildings, with building ids) does three jobs:
  - walls;
  - low roofs you can step onto;
  - the sun meter.

  Piers are 2.2 m decks, and the bridge deck is a walkable strip. The landmark
  meshes are rasterised as height intervals, so the helicopter can pass under
  the deck but not through the arch.
- **People** (`web/game/people.js`, assets from `pipeline/fetch_people.py`):
  - **Characters:** 13 rigged characters from Quaternius's Ultimate Modular Men
    and Women packs (CC0): office workers, a suit, a hoodie, beachwear,
    hikers, hi-vis workers. They have realistic proportions and 5,000–10,000
    triangles each.
  - **One draw call each:** the pipeline merges each character into one skinned
    mesh. Every vertex indexes a small palette, so skin, hair and clothes are
    recoloured per person, and 13 files make a varied crowd.
  - **Animation:** walk, jog, idle and wave clips. Their playback speed is
    matched to the ground speed, measured from how fast the planted foot slides
    in each clip, so feet don't skate. NPCs turn their heads to look at you and
    wave when you talk to them, and passers-by wave back when greeted.
  - **Near and far:** the 14 nearest passers-by (6 on a phone) are fully
    skinned. Everyone further away is an instanced copy of the same character,
    simplified by vertex clustering. Its legs, knees and arms swing in the
    vertex shader, and the shadows move with them. That is one draw call per
    character for hundreds of people.
- **Traffic** (`web/game/actors.js`):
  - **Pedestrians and cars:** both spawn within about 450 m of the player.
  - **Cars:** brake for the cars ahead and for the player.
  - **Headlights:** come on after sunset.
- **Vehicles** (`web/game/vehicles.js`): the helicopter and ferries every city
  shares, modelled in Blender (see [the vehicles](#the-vehicles)). If their
  files can't be loaded, stand-ins built from `web/game/kit.js` take their
  place: lofted hulls, lathes, slabs, fins, rods and tubes at real dimensions,
  merged into one mesh per material, adapted from the vessel kit of an earlier
  reef scene.
  - **Helicopter:** the assisted model, with collisions against buildings and
    landmark solids.
  - **Ferries:** double-ended, like Sydney's, so they reverse without turning.
    The size and livery come from the city's `ferry_style`: Sydney Ferries'
    green and cream with a gold band, and an invented navy shuttle on the Yarra.
    Each one has:
    - a lofted hull with antifouling, a boot stripe and a sheer band;
    - a rubbing strake;
    - a windowed saloon;
    - an upper deck with rails, benches and lifebuoys;
    - a wheelhouse at each end;
    - a mast and flag;
    - navigation and deck lights that come on after dark.

    Each ferry slows into its wharf and waits. You can take the helm into a
    wharf by hand.
- **Water:** the same `web/water.js` sea as the model viewer. The waves follow
  the city's wind, the shore foam follows the kind of shore, and the city
  shows in the water. The ground gets a wet band at the waterline.
- **Sun and time:**
  - **Clock:** the game starts at Sydney's actual time. If it's dark there, the
    title screen offers 9 am first.
  - **Sun meter:** ray-casts from where you stand four times a second through
    the same surface model the sun-access analysis uses. The Opera House shells
    and the bridge deck are added so they shade you too.
- **Ground** (`web/game/game.js`): close up, the 1 m aerial photo is blurred
  and has the photo's own shadows baked in. Near the player, the ground blends
  into streets drawn from the footway and road data at 0.5 m per pixel, with
  kerbs and centre lines, so the real-time shadows read correctly.
- **HUD** (`web/game/hud.js`):
  - **Minimap:** drawn once from the data, with the heading up.
  - **GPS route:** Dijkstra over the footway and road graph.
  - **Dialogue:** typewriter text.
  - **Stamps:** saved in the browser.
- **Sound** (`web/game/audio.js`): synthesised with Web Audio, with no files.
  - harbour ambience;
  - footsteps on the walk cycle;
  - rotor chop at the blade-pass rate;
  - ferry engine and horn;
  - dialogue beeps.

## The vehicles

| The helicopter (Cycles render) | The ferry (Cycles render) |
|---|---|
| ![](images/vehicles/helicopter.jpg) | ![](images/vehicles/ferry.jpg) |
| **Rotor wash over the harbour** | **A Kelvin wake at 16 knots** |
| ![](images/sydney/game-rotorwash.jpg) | ![](images/sydney/game-wake.jpg) |

Both are modelled in Blender from code by `blender/build_vehicles.py`, with no
hand modelling and no stock assets. The script bakes their ambient occlusion in
Cycles and writes `web/assets/vehicles/`. Every city's game loads the same two
files, and `blender/build_scene.py` places them in the city's Cycles renders where
the game puts them.

- **Helicopter:** a light twin-engine helicopter in the H135 class.
  - 10.7 m long, with a 10.2 m four-blade main rotor and a ducted tail fan.
  - The fuselage is a parametric surface. Its windows are cut along the
    surface, with rubber gaskets, and a lined cabin sits behind them. Inside are
    seats, an instrument panel with screens and the controls. You can see
    yourself at the controls.
  - Details: skids with steps, twin exhausts, a camera turret, a searchlight,
    wire-strike cutters, antennas and lights.
  - About 100,000 triangles up close and 12,000 beyond 90 m.
- **Ferry:** a double-ended harbour ferry, 34 m long with a 9.6 m beam.
  - A glazed main cabin with rows of seats, an open upper deck with benches,
    railings, lifebuoys and life rafts, a wheelhouse and a radar mast.
  - About 35,000 triangles up close and 6,000 beyond 260 m.
- **What the game adds:**
  - **Paint:** the livery is repainted from the city's config. The paint has a
    clear coat that reflects the real sky.
  - **Names:** the registration on the tail boom (by country, so `VH-` in
    Australia and `JA` in Japan) and each vessel's name on its hull are drawn
    at load time.
  - **Rotor:** the blades droop at rest, spin up with the engine, cone as they
    lift and blur into a disc. The disc tilts with the controls.
  - **Lights:** position lights, a flashing beacon and strobes, and after dark a
    searchlight that lights the ground. The ferries' sidelights swap ends when
    they reverse, so red is always to port. Their cabins light up after dark.
  - **Water:** the helicopter's downwash throws a ring of spray off the water
    (dust over land). The ferries leave a Kelvin wake, the 19.5° V that every
    ship makes in deep water, with churned water down the middle and a bow
    wave at the leading end.

A city chooses its look in `game.vehicles` in `city.json`. Every key is
optional, and a city with no config gets the defaults:

```json
"vehicles": {
  "helicopter": {"livery": "survey", "registration": "VH-OEH", "logo": "OPEN EARTH 3D"},
  "ferry": {"livery": "harbour"}
}
```

- **Liveries:** `vehicles.json` lists them: `survey`, `rescue`, `news` and
  `executive` for the helicopter, and `harbour`, `bay`, `river` and `commuter`
  for the ferry. A city can also give its own colours, such as
  `{"livery": {"hull": "#f08c1e", "band": "#1f2328"}}`.
- **Registration:** defaults to the country's nationality mark.

To change the models for every city, edit `blender/build_vehicles.py` and run:

```bash
pip install bpy==5.2.3
python blender/build_vehicles.py            # about 5 minutes; --render also renders the two images above
```

## Testing

The game exposes a test hook (`window.__game.advance(seconds, keys)`) that runs
the simulation at a fixed 30 Hz without rendering. A Playwright script plays
the whole survey this way. It checks:

1. Walking moves you along the ground.
2. You can't walk into buildings or the harbour.
3. Each quest step completes:
   - **Ferry:** the right ferry is offered at the wharf, waiting can be
     skipped, you board, the ride arrives at Milsons Point, and you get off.
   - **Bridge:** you walk 650 m up the north approach to mid-arch, on the deck
     surface.
   - **Helicopter:** it takes off, flies under the deck (the crossing event
     fires), and lands in the Domain.
   - **Sun:** with the time set to 21 June at 12:30, a sunlit spot in Martin
     Place completes the step.
   - **Survey lens:** it finds a surveyed, a floor-count and an estimated
     height.
4. All seven stamps are awarded.

A Melbourne script plays its six stamps the same way: the sun step at
Federation Square on 22 June, the river shuttle to Crown Landing, and the
flight to Birrarung Marr. A further script docks a ferry by hand. Phone layout, the routes into the game
and the menus are checked in a phone-sized browser.

## Limitations

- **Close-up ground:** at street level the aerial imagery is still the weak
  point. The drawn streets help on paths and roads. Plazas and courtyards that
  OpenStreetMap maps only as areas still show the photo.
- **People:** the characters are low-poly, with simple faces, and there are 13
  base bodies. Distant walkers swing rigid legs and arms instead of playing the
  full animation. The box-built figures return if the character files cannot
  be loaded.
- **No physics engine:** collisions use the surface model, which is 2 m. There
  is no ragdoll or car damage, and pedestrians don't avoid each other.
- **Ferry timetable:** the routes follow the inner-harbour services, but the
  timetable is invented. Ferries run at 1.5 times real speed.
- **Vessels on the water:** a ferry rides the mean water level and does not
  pitch or roll on the waves.
- **One ferry for every city:** the ferry is a Sydney-style double-ended vessel
  in each city's livery. A city whose boats look different, such as river buses
  or catamarans, still gets this hull.
- **Interiors:** buildings are extrusions with no interiors. Roofs are flat,
  except where OpenStreetMap maps building parts.

## Sources

- Microsoft Flight Simulator buildings and the Melbourne tower:
  [TechCrunch](https://techcrunch.com/2020/08/17/meet-the-startup-that-helped-microsoft-build-the-world-of-flight-simulator),
  [The Register](https://www.theregister.com/2020/08/20/flight_simulator_bing_fawkner_tower/).
- The Sydney World Update and the earlier flat bridge:
  [UploadVR](https://uploadvr.com/microsoft-flight-simulator-world-update-australia/).
- Helicopters in the 40th Anniversary Edition:
  [VGC](https://www.videogameschronicle.com/news/microsoft-flight-simulators-40th-anniversary-update-adds-helicopters-and-gliders).
- GeoFS: [instructions](https://www.geo-fs.com/pages/instructions.php).
- Sketchbook: [source](https://github.com/swift502/Sketchbook) (`Helicopter.ts`, `Character.ts`).
- GTA V time scale:
  [alt:V docs](https://docs.altv.mp/gta/articles/references/time-and-date.html).
- GTA V GPS: [Grand Theft Wiki](https://www.grandtheftwiki.com/GPS).
- Ship Simulator Extremes:
  [SimFlight](https://www.simflight.com/2010/09/22/ship-simulator-extremes-demo-release/),
  [Armchair General review](https://armchairgeneral.com/ship-simulator-extremes-pc-game-review.htm).
- Assassin's Creed Discovery Tour:
  [Push Square](https://www.pushsquare.com/news/2018/02/hands_on_assassins_creed_origins_discovery_tour_is_a_thoughtful_and_interesting_addition).
- A Short Hike dialogue: [comparison](https://vghpe.github.io/posts/compare-dilalogue).
- Animal Crossing favours: [Nookipedia](https://nookipedia.com/wiki/Favor).
- slowroads: [web.dev](https://web.dev/slow-roads/).
- Streets GL: [source](https://github.com/strandedkitty/streets-gl).
