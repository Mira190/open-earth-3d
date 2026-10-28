# Sydney on Foot: the game

The city model becomes a place you can be in. You walk central Sydney as a
surveyor, talk to the people who know it, catch the ferry, and fly a helicopter
under the Harbour Bridge. The world is the same open-data model as the viewer:

- 7,962 buildings from OpenStreetMap;
- the NSW bare-earth terrain;
- the real sun in Sydney's time zone.

Everything the characters tell you about the city is computed from the model
while you play.

Open it from the globe (**Play** on the Sydney card), from the 3D model (the
**Play** chip), or directly at `web/index.html#play-sydney`.

| Talking to an NPC | On the bridge deck at golden hour |
|---|---|
| ![](images/sydney/game-dialogue.jpg) | ![](images/sydney/game-bridge.jpg) |
| **Under the Harbour Bridge** | **Bird's-eye view from the helicopter** |
| ![](images/sydney/game-heli.jpg) | ![](images/sydney/game-birdseye.jpg) |
| **Cross Harbour ferry, Opera House behind** | **The map, with live ferries and fast travel** |
| ![](images/sydney/game-ferry.jpg) | ![](images/sydney/game-map.jpg) |
| **Martin Place, 21 June, 12:30: the sun meter** | **After dark: lit windows and street lamps** |
| ![](images/sydney/game-martin-place.jpg) | ![](images/sydney/game-night.jpg) |

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

The survey has seven stamps:
1. Get your bearings at Circular Quay.
2. Hear how the Opera House shells are cut from one sphere.
3. Ride the ferry to Milsons Point.
4. Walk up the bridge approach to the middle of the arch.
5. Fly under the deck and land in the Domain.
6. Find a spot in Martin Place that gets sun at lunchtime on the winter solstice.
7. Use the survey lens on three buildings whose heights come from different sources.

Docking a ferry by hand earns an extra stamp. After the survey, the city is
free roam.

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
pipeline writes. The only Sydney-specific code is the bridge and Opera House
geometry in `cities/sydney/city.py`.

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
- **People and traffic** (`web/game/actors.js`):
  - **Player and NPCs:** articulated rigs.
  - **Crowd and cars:** instanced meshes animated in the vertex shader, a few
    draw calls for hundreds.
  - **Spawning:** both spawn within about 450 m of the player.
  - **Cars:** brake for the cars ahead and for the player.
  - **Headlights:** come on after sunset.
- **Vehicles** (`web/game/vehicles.js`):
  - **Helicopter:** the assisted model, with collisions against buildings and
    landmark solids.
  - **Ferries:** double-ended, like Sydney's, so they reverse without turning.
    Each slows into its wharf and waits. You can take the helm into a wharf by
    hand.
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

## Per-city flavour

Everything a city's game says and wears is in `cities/<id>/city.json`, not in code.
[Osaka on Foot](cities/osaka.md#8-osaka-on-foot) is the example:
- **People.** An NPC's `look` takes a character, skin, hair and clothes, plus a
  `pattern` (`leopard`, `tiger`, `kuidaore`, `pinstripe`, `plaid`) painted on the
  top in the shader, and `acc`, a list of accessories attached to bones (`visor`,
  `hachimaki`, `jingasa`, `mask`, `lanyard`, `tako_tray`, `umbrella`, `flag`, `drum`, and
  more in `web/game/people.js`).
- **Crowd.** `crowd.style` gives the crowd's skin, hair, top and leg colours, the
  weight of each character, and the share who wear a pattern, a mask or an umbrella.
- **Words.** `blurb`, `smalltalk` and `passerby` replace the Sydney defaults, and quest
  text takes the same `{...}` tokens (`{share:plateau}`, `{landmark:castle.ground_m}`,
  `{sun:Place|M-D|HH:MM}`) so numbers come from the model.
- **Boats.** A route is a list of landings. Make each route two or three stops long and
  put the landings a quest uses at the ends, so the boat at a landing is the one that goes
  where the quest wants.
- **Night.** `night_ambient` lifts the light after dark, and a landmark material can carry
  `emissive` and `glow` so signs light up.

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

A second script docks a ferry by hand. Phone layout, the routes into the game
and the menus are checked in a phone-sized browser.

## Limitations

- **Close-up ground:** at street level the aerial imagery is still the weak
  point. The drawn streets help on paths and roads. Plazas and courtyards that
  OpenStreetMap maps only as areas still show the photo.
- **Boxy people:** characters are box rigs with no clothing or faces. That is a
  deliberate style, and cheap to instance.
- **No physics engine:** collisions use the surface model, which is 2 m. There
  is no ragdoll or car damage, and pedestrians don't avoid each other.
- **Ferry timetable:** the routes follow the inner-harbour services, but the
  timetable is invented. Ferries run at 1.5 times real speed.
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
