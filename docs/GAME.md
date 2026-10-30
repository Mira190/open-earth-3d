# The game: Sydney, Melbourne, the bayside and Hong Kong on foot, and by car

The city model becomes a place you can be in. In Sydney you walk the centre as
a surveyor, talk to the people who know it, climb the Opera House steps, catch
the ferry, and fly a helicopter under the Harbour Bridge. In Melbourne you check
the winter sun on Federation Square, take a river shuttle down the Yarra, and
fly past the Arts Centre spire. On Melbourne's bayside you wait on the St Kilda
Pier viewing platform after the real sunset while little penguins come ashore,
walk into Luna Park through Mr Moon's mouth, and walk the row of Brighton
bathing boxes. In Hong Kong you cross the harbour on the Star Ferry, ride the
Peak Tram and dodge the double-deck trams. The world is the same open-data
model as the viewer. In Sydney that means:

- 7,962 buildings from OpenStreetMap;
- the NSW bare-earth terrain;
- the real sun in Sydney's time zone.

Everything the characters tell you about the city is computed from the model
while you play.

Open it from the title screen (**Play** on a destination's card), from the 3D
model (the **Play** chip), or directly at `web/index.html#play-sydney`, `#play-melbourne`,
`#play-melbourne-bayside` or `#play-hong-kong`.

| Talking to an NPC | On the bridge deck at golden hour |
|---|---|
| ![](images/sydney/game-dialogue.jpg) | ![](images/sydney/game-bridge.jpg) |
| **Under the Harbour Bridge** | **Bird's-eye view from the helicopter** |
| ![](images/sydney/game-heli.jpg) | ![](images/sydney/game-birdseye.jpg) |
| **The Cross Harbour ferry leaving Circular Quay** | **The map, with live ferries and fast travel** |
| ![](images/sydney/game-ferry.jpg) | ![](images/sydney/game-map.jpg) |
| **Martin Place, 21 June, 12:30: the sun meter** | **After dark over the harbour: the moon in its real phase, the stars and the north shore's lights** |
| ![](images/sydney/game-martin-place.jpg) | ![](images/sydney/game-night.jpg) |
| **Surveying from the trig station at mid-arch** | **The height challenge** |
| ![](images/sydney/game-trig.jpg) | ![](images/sydney/game-guess.jpg) |
| **Photo mode: a saved picture, captioned with the time and the sun** | **Driving your car up a city street** |
| ![](images/sydney/game-photo.jpg) | ![](images/sydney/game-drive.jpg) |
| **A taxi pulls in at the kerb** | **From the back seat, the driver at the wheel** |
| ![](images/sydney/game-taxi.jpg) | ![](images/sydney/game-backseat.jpg) |
| **Silver gulls fighting over a box of chips by the Opera Bar** | |
| ![](images/sydney/game-gulls.jpg) | |
| **The Opera House's Monumental Steps** | **Melbourne: Hannah explains DDO10 in City Square** |
| ![](images/sydney/game-steps.jpg) | ![](images/melbourne/game-dialogue.jpg) |
| **The river shuttle on the Yarra** | **Past the Arts Centre spire** |
| ![](images/melbourne/game-river.jpg) | ![](images/melbourne/game-heli.jpg) |
| **The bayside: the Brighton bathing boxes** | **From the St Kilda Pier viewing platform at night: penguins on the breakwater** |
| ![](images/melbourne-bayside/game-boxes.jpg) | ![](images/melbourne-bayside/game-penguins.jpg) |
| **Mr Moon's gate at Luna Park** | **The pier's approach over the sand** |
| ![](images/melbourne-bayside/game-luna-park.jpg) | ![](images/melbourne-bayside/game-pier.jpg) |
| **Hong Kong: the Star Ferry at Tsim Sha Tsui** | **The Peak Tram** |
| ![](images/hong-kong/game-ferry.jpg) | ![](images/hong-kong/game-peak-tram.jpg) |

## Playing

| Keys | What they do |
|---|---|
| <kbd>W A S D</kbd> or arrows | Walk relative to the camera. Drag to look around; scroll to zoom. |
| <kbd>Shift</kbd> · <kbd>X</kbd> · <kbd>Space</kbd> | Sprint while held (7 m/s) · switch between running (4.5 m/s) and walking (1.4 m/s) · jump. A chip under the sun indicator shows the gait. |
| <kbd>E</kbd> | Talk, board a ferry or wait for one, board the helicopter, drive your car, get in a taxi, get out, take a lift, look at something up close |
| <kbd>Y</kbd> · <kbd>N</kbd> | Raise your hand at the kerb and a taxi pulls in · the phone: order a ride, bring your car |
| <kbd>Q</kbd> | Survey lens: the building in front of you, its height and where the height comes from |
| <kbd>G</kbd> | Height challenge: guess the height of the building in front of you, then see how good the data is |
| <kbd>E</kbd> at a △ | Survey the view from a trig station |
| <kbd>T</kbd> | Switch which survey line the route and the beam follow |
| <kbd>O</kbd> | Photo mode: the world holds still while you set the sun, the lens and the angle, and save a picture |
| <kbd>M</kbd> · <kbd>P</kbd> · <kbd>Esc</kbd> | Map with waypoints and fast travel · passport of stamps · menu (time of day, any time and date, clock speed, crowds, sound) |
| <kbd>R</kbd> | Unstick yourself |
| Helicopter | <kbd>Space</kbd> climb, <kbd>C</kbd> or <kbd>Shift</kbd> descend, <kbd>W</kbd>/<kbd>S</kbd> forward/back, <kbd>A</kbd>/<kbd>D</kbd> turn, <kbd>V</kbd> chase, cockpit or bird's-eye view (drag to look round the cockpit) |
| Ferry | <kbd>F</kbd> skip ahead, <kbd>H</kbd> take the helm for the approach to the next wharf |
| Funicular | <kbd>E</kbd> board at a station and get off at the other end, <kbd>F</kbd> skip ahead |
| Your car | <kbd>W</kbd>/<kbd>S</kbd> drive, brake and (stopped) reverse, <kbd>A</kbd>/<kbd>D</kbd> steer, <kbd>Space</kbd> handbrake, <kbd>H</kbd> horn, <kbd>V</kbd> from the driver's seat, <kbd>R</kbd> back on the road, <kbd>E</kbd> get out |
| Taxi or ride | <kbd>F</kbd> skip the trip, <kbd>V</kbd> from the back seat, <kbd>E</kbd> get out when it has stopped |

On a phone you get a joystick and buttons. Camera moves (the start, fast travel, a
survey) end at once on any key or drag.

While a city loads, the loader shows how much of its data has arrived and names
each step. For the cities that have one (Tokyo, Osaka and Kyoto so far), a
recorded flyover plays behind it: a 14 s spiral from high over the whole model
down to the title screen's camera, so when it ends the live title screen takes
over from its last frame. If the city is ready first, **Start** (or any key)
goes straight in. `tools/flyover.js <city>` records it in the game itself, at
8 frames a second interpolated to 30, as an H.264 MP4 and a VP9 WebM with a
poster; `web/flyover.js` plays it. A visitor who prefers reduced motion gets
the plain loader. The model viewer plays the same video, then its short
establishing shot.

### Cars, taxis and rides

Every city's game has the same three ways to go by road:

- **Your car** waits at the kerb near the start, marked **C** on the map, and stays
  where you leave it. <kbd>E</kbd> beside it walks you round to the driver's door.
  It handles like an arcade racer rather than a simulator. Steering lightens with
  speed, and the tyres pull the car round to where it points up to about 1 g, so a
  bend taken too fast runs wide. The handbrake lets the tail step out into a drift.
  It pulls through five gears, to 100 km/h in about 5 s and on to 150. It stops
  from 100 km/h in about 30 m, and holding <kbd>S</kbd> at a standstill reverses.
  It hits buildings, the landmarks and other cars, stops for people, won't go over
  the water's edge, and follows kerbs, ramps and bridge decks. In the driver's
  seat (<kbd>V</kbd>) you see the dashboard and the wheel turning. The phone
  brings it to the nearest kerb if you have walked far from it.
- **A taxi:** stand at the kerb and press <kbd>Y</kbd>. You raise your hand, and
  the nearest free taxi coming your way, by road, pulls in on your side of the
  street with its hazard lights on. If none is close, one comes round the corner.
  Get in with <kbd>E</kbd>. The driver asks where to: your waypoint, the next
  step of the survey, your car, the nearest landmarks, the wharves you have used,
  or where you started.
- **A ride:** order one on the phone (<kbd>N</kbd>), as GTA VI's Ryde Me app does.
  Choose where to go first, and a private-hire car is sent from a few hundred
  metres away. The phone shows its driver, colour, model and number plate, and
  how far away it is.

The driver takes you by road, along a route over the street network, keeping to
the lane, slowing for bends and for the traffic, and signalling into the kerb at
the end. On the way they talk about what you are passing, as the people on the
footways do, so each remark is a fact from the model, such as a building's height
and where it comes from. <kbd>F</kbd> skips the trip, as in GTA V: the camera
rises, crosses the city and comes down behind the car at the kerb. The traffic
keeps to the city's side of the road: the left in Australia, Japan and Hong
Kong, and the right in Paris, where the cars are left-hand drive.

The survey comes in lines. After a welcome, three surveys run side by side, in
any order, and a report back waits for all three. The Sydney survey has seven
stamps, and an eighth for the locals:
- **Welcome** (Ava, at Circular Quay): she sets out the three surveys and asks
  which you want to start with.
- **The harbour** (Marco, at the Opera House), two stamps:
  - hear how the shells are cut from one sphere, and climb the Monumental Steps;
  - ride the ferry to Milsons Point, then walk up the bridge approach to the
    middle of the arch.
- **The air** (Sam, at the Kirribilli helipad): fly under the deck and land in the
  Domain.
- **The ground** (Priya, in Martin Place), two stamps:
  - find a spot that gets sun at lunchtime on the winter solstice;
  - then, with Tom, use the survey lens on three buildings whose heights come from
    different sources.
- **Report back** (Ava): opens once the three surveys are done.
- **The locals** (Jess, a waiter at the Opera Bar), on the side: walk up to the
  silver gulls fighting over a box of hot chips by the water.

A step counts whether its line is tracked or not. If you stand in the sun in Martin
Place on the way to the ferry, the ground survey moves on. <kbd>T</kbd>, or a tap
on a survey's name in the quest card, chooses the line that the route, the beam and
the minimap's star follow. The other lines show as hollow stars.

Docking a ferry by hand earns an extra stamp. After the survey, the city is free
roam, with two things to do in it at any time:

- **Trig stations.** Five survey points round the harbour, each a △ on the map: the
  bridge at mid-arch, Observatory Hill, Barangaroo Reserve, Mrs Macquarie's Chair and
  the Opera House steps. At one, <kbd>E</kbd> turns you once round on the spot. The
  camera turns with you, and the buildings in sight are named with their heights and
  sources. Your field notes then give:
  - how many buildings are in sight within 3 km;
  - the tallest of them, and where its height comes from;
  - how the heights in sight were measured.

  Surveying all five earns the Trig master stamp.
- **Height challenge.** Aim at a building, press <kbd>G</kbd>, and guess its height.
  The answer comes with the data's own error: a floor-count height is good to about
  ±20% nine times in ten, and an estimate to much less. A guess inside that range is
  as good as the data, and the score says so.

The Melbourne survey has the same shape and six stamps:
- **Welcome** (Mia, at Federation Square).
- **The square** (Hannah, in City Square): how DDO10 protects public spaces from
  new shadow, and a sunny spot on Federation Square at lunchtime on 22 June.
- **The river** (Arjun, at Federation Wharf), two stamps:
  - the river shuttle to Crown Landing;
  - Sophie's helicopter past the Arts Centre spire to Birrarung Marr.
- **The heights** (Jun, in Birrarung Marr): the survey lens on three height
  sources.
- **Report back** (Mia).

Melbourne has no ferry through the city, so the shuttle is invented and says
so.

The bayside survey is one line of four stamps, taken in order:
1. Walk out along St Kilda Pier to the kiosk.
2. Hear from Tash, an Earthcare volunteer, about the colony, then wait on the
   viewing platform after sunset until penguins come ashore near you. One
   choice in the dialogue sets the clock to ten minutes before today's sunset.
3. Walk into Luna Park through Mr Moon's mouth.
4. Walk the row of Brighton bathing boxes, from the first to the last.

The bayside has no ferries and no real helipad. The pad at Elwood is invented
and says so. Places you have visited become fast-travel stops on the map.

The Hong Kong survey has six:
1. Take the Star Ferry from Central's Pier 7 to Tsim Sha Tsui.
2. Find a surveyed and a LiDAR-measured height with the survey lens at the
   Clock Tower, then take the ferry on to Wan Chai.
3. Fly from the Convention Centre heliport between the towers and land in
   Tamar Park.
4. Find a sunny spot in Statue Square at noon on 21 December, among the bank
   towers.
5. Ride the Peak Tram from Garden Road to the Peak.
6. Meet Mrs Fong at the lookout, and stay for the 8 pm light show.

The Star Ferry's routes are real; its timetable and which vessel runs which
route are not.

The Paris survey has seven stamps, written as three lines after a welcome on the
Pont des Arts (see [the Paris case study](cities/paris.md#6-paris-on-foot)):
- **The river:** Bernard, a bouquiniste, and the survey lens on a LiDAR-measured
  roof; the Batobus from Saint-Germain-des-Prés to Notre-Dame; Léa, a carpenter
  on the cathedral's roof.
- **The Left Bank:** a chair in the sun in the Luxembourg at noon on 21 December;
  Karim's café and Nadia's bakery.
- **The tower:** fly under the Eiffel Tower's first floor and land in the
  Tuileries.
- **Report back** to Camille.

On the Seine the helicopter takes the nearest span to fly under, and a step can
name its span (`"surface"`).

The Amsterdam survey has eight stamps, written as three lines after a welcome on
the Dam (see [the Amsterdam case study](cities/amsterdam.md#6-amsterdam-on-foot)):
- **The canal ring:** Pieter, a building historian on the Herengracht, sends you
  to find a step gable, a neck gable and a bell gable with the survey lens (a
  `gable` step: the lens names a house's gable and when that type was built);
  Femke plays the Westertoren's carillon, and the Anne Frank House is two doors
  down.
- **The IJ:** Joost puts you on GVB's free F3 ferry to Buiksloterweg; Noor at the
  Eye shows you the A'DAM Toren.
- **The winter sun:** a spot in direct sun on the Rembrandtplein between 10:00
  and 14:00 on 21 December, when the sun stands 14 degrees high at noon; then a
  stroopwafel at the Albert Cuyp market.
- **Report back** to Sanne on the Dam.

Amsterdam has no helicopter: no pad in the old city, and none is invented.

**Tokyo Pilgrimage** (Shibuya and Shinjuku, see [the case study](cities/shibuya.md#7-tokyo-pilgrimage))
is a walk, not a survey: a welcome at Hachiko, then five lines in any order and a
report back.
- **Shibuya:** walk out onto the scramble, read the arch over Center Gai, take the
  lift up SHIBUYA SKY, ride the escalator out onto the roof and stand at SKY EDGE.
- **Sangenjaya:** the backstreets a game called Yongen-Jaya, a snack bar's front, the bathhouse,
  and the triangle after dark.
- **Your Name:** climb the 52 steps of Suga Shrine's 男坂 and read an ema.
- **Shinjuku:** Kabukicho's arch after dark.
- **Aoyama:** the ginkgo avenue at Jingu Gaien.

Walking into a neighbourhood puts its name up on a station sign. <kbd>E</kbd> at a
spot (an ema, a vending machine, a shop front) reads it. Conversations come up in
bubbles as you pass.

The menu (<kbd>Esc</kbd>) lets you play as either surveyor.

**Photo mode** (<kbd>O</kbd>, or **Photo** on a phone) stops the world: the
people, the traffic and the ferries hold still, and the HUD goes. You control the
camera and the shot:
- **Camera:** drag to turn round the focus and scroll to come closer. <kbd>W A S D</kbd>
  and <kbd>Space</kbd>/<kbd>C</kbd> move the focus up to 300 m from you.
- **Time:** moves the sun for the picture, and the clock stays there when you leave.
- **Lens:** the field of view, shown as a full-frame focal length.
- **Extras:** Turntable circles slowly, Grid shows the thirds, and Show me hides
  your surveyor.

**Save photo** (<kbd>Enter</kbd>) writes a PNG. Its caption gives the place, the
date and time, the sun's height and the data credit.

## What we took from other games, and where this one is different

A research pass looked at the games people compare this to. The sources are
listed at the end.

| Game | What we took | What this does that it can't |
|---|---|---|
| **Microsoft Flight Simulator** | Hand-built landmarks over generated filler; an assisted helicopter, since players find hovering hard. | Its buildings are generated, and it shipped errors that open data can contain. A two-storey building tagged as 212 floors in OpenStreetMap reached the sim as a Melbourne monolith. Sydney's Harbour Bridge was a flat auto-generated span until World Update VII. Here every height has a source, outliers are capped, the towers are checked against published heights, and the bridge is built to its published geometry. |
| **Sketchbook** (three.js sandbox) | Assisted helicopter flight: the rotor cancels gravity so it hovers with no input, levels itself, damps drift and spools up before take-off. You walk to the door instead of teleporting in, and <kbd>E</kbd> to use. | Its world is an empty sandbox. Here the world is a real city with things to do. |
| **GTA V** | A clock running 30 times real time, so a day lasts 48 minutes. A minimap with a GPS route along the street network, which in a car keeps to the roads. A waypoint you click on the map. A crowd and traffic density setting. Hailing a taxi at the kerb, telling the driver where to go, and skipping the trip. A view from the driver's seat. | Its city is a caricature. Here the streets, wharves and sun are real, the traffic keeps to the city's side of the road at Overture speed limits, and crowds keep left as Australians do. |
| **GTA VI** (trailers and previews; it comes out on 19 November 2026) | Ryde Me, the ride-hailing app on the phone: say where, and a car comes for you. Cars with interiors you can see into, and bodies that move on their springs. | Its taxi driver can talk to you on the way. Here what the driver says is a fact about the street you are on, worked out from the model. |
| **Arcade racers** (Need for Speed, Burnout, Forza Horizon) | Handling for fun rather than a tyre model: speed-sensitive steering, grip of about 1 g that bends the car's path round to where it points, a handbrake drift, a view that widens with speed, and an engine note that climbs through the gears. | They are set on closed roads. Here you drive the real streets, among traffic that keeps to its lane. |
| **Ship Simulator Extremes** | Docking as the skill moment: the ferry runs on autopilot across open water, then you bring her alongside and are scored. | Reviewers found its long cruises boring. Here the open-water legs can be skipped, and docking is optional. |
| **Assassin's Creed Discovery Tour** | Guided learning by place: each stop is a person who explains what is in front of you, with "behind the data" honesty. | Its narration was called dry. Here the lines are short and come from the model, such as the share of Martin Place in sun on 21 June at 12:30, computed while you stand there. |
| **A Short Hike, Animal Crossing** | One-breath dialogue lines that you can finish with a tap, a voice beep pitched per character, and small tasks with small rewards (passport stamps). | Their worlds are invented. Here a favour is a fact about a real place. |
| **Assassin's Creed viewpoints** | Climb to a high point, and the camera turns once round you while the names fill in. | Its viewpoints reveal what designers placed there. Here what is named is what is in sight from that spot: a line of sight through the model to each roof, with the source of each height. |
| **GTA V character switch** | The fast-travel camera goes up, across the city and down onto the player, instead of cutting. | Its sky camera hides streaming. Here it keeps the city in one piece, and the cruise height clears the tallest roof on the route. |
| **GeoGuessr** | A guess scored against the answer. | Here the answer has error bars and the score shows them. For an estimated height, a good eye can be as good as the data. |
| **Breath of the Wild** | After a short prologue, the main quests open together and can be done in any order. | Its quests end in invented places. Here each line ends in a fact about a real one. A step from one line completes while you follow another, because both are a position, a time or a sun angle in the same model. |
| **Ghost of Tsushima photo mode** | The world holds still, and you change the time of day and the lens. | Its light is art-directed. Here the sun for the time you choose is the computed one, and the saved picture's caption says when and how high it was. |
| **Bruno Simon's portfolio, slowroads, Streets GL** | Instanced crowds, cars and street furniture. Detail only near the player. A hint to lower the density when the frame rate drops. | Streets GL needs a discrete GPU. This runs on a phone, with lower density there. |
| **GTA V's scenario points, The Sims, Unreal's Smart Objects and Detour Crowd** | Benches as places to sit. Each has two seats that a passer-by claims, walks to, sits on and leaves, and each advertises what it offers. Walkers look a few seconds ahead and step aside for each other and for you. | Their people pick seats by script or by invented needs. Here they pick by the sun the model computes. At 12:30 on the winter solstice every sitter around Martin Place is on a sunny bench, though only 55% of the benches there are in sun. On a January afternoon, 92% of the benches are in sun but only 21% of the sitters. |
| **Persona 5** | A city told district by district, each a few streets drawn closely: Shibuya's crossing, a quiet residential neighbourhood, Shinjuku at night. A district's name comes up as you arrive. Passers-by talk among themselves and you catch a line as you pass. Things to examine with one button: a vending machine, a sign, a shop front. | Its Tokyo is renamed and redrawn. Here the names are the real ones and the streets are measured. The arrival card is drawn like Tokyo's own platform signs (駅名標), with the line's colour and the stations either side. There is no calendar, no social ranks and no combat, the clock is the real sun, and the people are our own. Persona's characters and art are not used. |
| **Unreal Engine** | The CharacterMovementComponent's capsule sweep: slide along a wall, stop in a corner, push out of anything you start inside, step up what is low enough. The SpringArm's probe sphere for the camera. Re-written from the documentation, since the engine's code can't be copied into an open project. | Its collision is whatever the level designer built. Here it is the published footprints, so walking into a wall tests the open data. [docs/ENGINES.md](ENGINES.md) is the full study of what else to take from Unreal and other engines. |

## How it works

All of this is driven by `cities/<id>/city.json` (`game` block) and the files the
pipeline writes. The only city-specific code is landmark geometry in
`cities/<id>/city.py`:
- Sydney's bridge, Opera House and steps;
- Melbourne's spire and Flinders Street Station;
- the bayside's bathing boxes, Scenic Railway and Mr Moon.

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
  - **Rail** (`game.rail`): the Overture rail lines of the configured classes,
    chained across the junctions where OpenStreetMap breaks them into through
    routes. A funicular's route runs from its lower end with its profile made
    monotonic (bridging the dips under its viaducts), and the piece left over
    beside it is its passing loop.
  - **NPCs:** snapped to open ground.
  - **Boardwalks:** walkways at deck height over rocks, water or sand. They
    are mapped lines found by name, or lines given in the local frame, buffered
    to their width. The game draws them as timber decks.
  - **Wildlife:** a colony on a mapped class of infrastructure. It has burrows
    on the rocks, and landing places on their seaward edge with open water 6, 20
    and 40 m out. Its rocks are a no-go area, and footways across them are
    dropped.
  - **Flocks:** a spot snapped to open ground, with places on the seawall
    within `perch_m` where the birds stand. A quest step that visits a flock is
    given its position.
  - **Travel points and links:** fast-travel points on the ground, and
    neighbouring cities named in the menu.
- **Opera House steps** (`city.py`): the Monumental Steps are 85 m wide and run
  17.6 m from the forecourt to a landing, as measured on the NSW aerial photo:
  three flights of 0.39 m treads and 15 cm risers, between landings 1.6 m deep.
  A short ramp at the foot meets the forecourt, where the 5 m terrain dips up
  to 2 m into the vehicle concourse entrance. From the landing, a flight in
  front of each hall climbs 11.6 m to the upper podium. Each flight is a
  walkable strip whose profile follows every riser, so feet land on the
  treads, and the landing is one too. Footways that cross them are draped onto
  them, so the crowd uses them too. Each tread has a pale nosing over a darker
  riser, with the shadow under the nosing drawn on it, so the steps read as
  steps from any side and any distance. A strip's slab stops at the lowest
  point of its surface in each 2 m cell, so a walker on a stair never meets a
  lip above the knee.
- **Bridge deck** (`city.py`):
  - The deck runs level across the arch and pylons.
  - The approach viaducts then descend at 5% until they meet the ground, the
    way the real approaches continue to the Cahill Expressway and North Sydney.
  - People and cars use the same surface, so you can walk across with the
    traffic.
- **Rail** (`web/game/rail.js`): double-deck trams on every through route,
  keeping to the side of the road the city drives on (`keep`), stopping every
  `stop_every_m` and for anyone on the track ahead, and ringing their gong as
  they pull away. A funicular's two cars hang on one cable: one climbs while the
  other comes down, and they pass at the loop. You ride it like a ferry, from
  station to station, and the HUD shows your height and the gradient.
- **Navigation** (`web/game/nav.js`):
  - **Grids:** the 2 m surface model (terrain plus buildings, with building ids)
    runs the sun meter and the survey lens. The 5 m water mask keeps walkers out
    of the water.
  - **The ground you stand on is the ground that is drawn:** the same two
    triangles per 5 m cell as the terrain tiles, so feet never float over a
    slope or sink into it. Beside the water the drawn ground goes down the bank
    to the modelled bottom. A walker stops at the waterline, or at the top of a
    bank steeper than 40° (a quay wall, a castle moat's stone side).
  - **Starting places:** the start, NPCs, getting off a ferry and fast travel
    take the nearest firm spot: not on the bank, not inside someone else. The
    start also needs room to walk away, and a few steps clear towards its
    view, so you never begin shut in or at the very edge of a quay.
  - **Piers and decks:** piers are 2.2 m decks, or level with the quay they
    meet where that is higher, so stepping down onto a pier is never a step you
    can't climb back. The bridge deck is a walkable strip.
  - **Wharves:** each wharf has a landing, the nearest place on foot to its
    terminal. You board from there where the mapped terminal is out on the
    water (Circular Quay's wharves, Central Pier 7).
  - **Bridges and viaducts** (`web/game/decks.js`): a mapped footway or road
    that crosses the water, or runs more than 2.5 m above the ground drawn
    under it, is on a deck.
    - The deck is drawn as a concrete slab with parapets, with columns under
      the high spans.
    - A bridge over the water is laid between its banks, slightly crowned. The
      data lifts a bridge one level (6 m), which over a canal is a hump in the
      air. Where a ferry's course passes under it, the span rises to clear the
      boats.
    - Viaducts (an expressway, several levels up) keep their mapped height.
      Stubs that end over the water at nothing are cut back to the bank.
    - The crowd and the traffic keep to the decks, the sun meter sees their
      shade, and you can walk them (but not the expressways). In Osaka this is
      what joins the city across its rivers: from the start on the Dotonbori,
      every NPC can now be reached on foot.
  - **Everything else on the ground:** passers-by, cars, trees, benches and
    street lamps stand on the ground drawn under them, not on the heights of
    the survey grid. Walls reach down to the ground drawn round them, where a
    slope or a moat's edge falls below the building's base. Land below the
    level of the sea (behind Osaka's river walls, in an underpass) is kept just
    above the water, which lies level everywhere.
  - **Landmarks:** the landmark meshes are rasterised as height intervals in 2 m
    cells, so the helicopter can pass under the deck but not through the arch.
  - **No-go areas:** walkers are stopped at the edge of a colony's rocks, with
    the city's note. A boardwalk across them stays walkable.
- **Collision** (`web/game/collision.js`): every building solid is a prism, its
  published footprint between two heights, and each landmark cell is a box.
  - **Walking:** the walker is a 0.35 m capsule, moved the way Unreal's
    CharacterMovementComponent moves one:
    - it is swept against the walls between knee and head;
    - it slides along what it hits and stops in a corner;
    - it is pushed out if it starts inside;
    - anything lower than a 0.75 m step is left to the floor, which also comes
      from the exact footprints.
  - **Camera:** a 0.25 m probe sphere is swept from the player to the camera
    against walls, roofs and soffits, as Unreal's SpringArm does.
  - **Measured against the old 2 m grid:** 120 walks into walls at random
    angles ended inside a footprint 50 times before and never now. The closest
    approach is now the capsule radius. See
    [ENGINES.md](ENGINES.md#1-movement-and-collision-built).
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
  - **Sitting:** there is no clip for it.
    - The legs are bent over the idle pose: each thigh is aimed forward and
      each shin straight down.
    - The feet are IK targets in these rigs, so they are moved to the ends of
      the shins, and the body is lowered until they touch the ground.
    - The far copies bend their legs the same way in the vertex shader.
  - **Near and far:** the 14 nearest passers-by (6 on a phone) are fully
    skinned. Everyone further away is an instanced copy of the same character,
    simplified by vertex clustering. Its legs, knees and arms swing in the
    vertex shader, and the shadows move with them. That is one draw call per
    character for hundreds of people.
- **Crowd** (`web/game/actors.js`):
  - **Walking:** pedestrians follow the footways, keeping left.
  - **Stepping aside:** each walker looks four seconds ahead for anyone it will
    pass closer than 0.6 m, the player included.
    - It steps aside within the footway's width, choosing the side by where the
      other person is now. If both judged by where the other will be, each
      would mirror the other's sidestep, and they would cross into each other.
    - If it can't get round, it slows to the other person's pace.
    - This is RVO and Detour Crowd confined to the footway.
    - With 40 walkers on one footway, pairs walked through each other 2.8
      times a tick before, and never now. People used to freeze when you stood
      among them; now they walk round you.
  - **Benches:** the benches are smart objects.
    - 1,375 of Sydney's 1,862 benches and 891 of Melbourne's 1,181 can be
      reached from a footway in a straight line that is clear of walls, water
      and steps.
    - Each faces its footway, or turns round to face the water when there is
      water behind it. Each has a backrest and two seats.
    - A walker passing a bench with a free seat may claim the seat, walk over,
      sit for 25 to 75 seconds and walk on.
  - **Sun or shade:** the game re-tests the benches near you against the sun,
    about 60 a second, with the same ray cast as the sun meter.
    - Whether people want the sun depends on the city's average daily top for
      the month, against a comfortable 22 °C. That is the `climate` block in
      `game.json`, from the Bureau of Meteorology.
    - People lean towards the sun when it is low.
    - Greet someone on a bench and they tell you when the sun reaches it or
      leaves it today.

    Around Martin Place:

    | Time | Benches in sun | Sitters in sun |
    |---|---|---|
    | 21 June, 12:30 | 55% | 100% |
    | 15 January, 14:00 | 92% | 21% |
- **Penguins** (`web/game/penguins.js`): one instanced mesh draws the colony.
  - **Day:** all but a few birds (5% at St Kilda) are at sea.
  - **Dusk:** after sunset, rafts of neighbours gather off the landing place
    nearest their burrows. Each raft swims in at its own time, between 20 and
    120 minutes after sunset, and the birds waddle home at 0.35 m/s.
  - **Night:** birds near you call, a bray synthesised in `audio.js`. They catch
    a little of the platform's low light.
  - **Dawn:** each bird leaves for the sea 30 to 90 minutes before sunrise.
  - **Clock jumps:** when the clock jumps rather than runs, each bird is placed
    where it would be by then.
  - **Quest step:** a `penguins` step completes when enough birds are ashore
    near you.
- **Gulls** (`web/game/gulls.js`): a flock of silver gulls works a spot on the
  ground (`game.flocks`), Sydney's round a dropped box of hot chips by the Opera
  Bar. Four instanced meshes draw them: bodies, legs and each wing.
  - **On the ground:** they peck at the chips, squabble over them with their
    wings up, and now and then make off with one. A few stand on the seawall
    beside the spot, looking out over the water.
  - **In the air:** they circle, flapping and gliding, hang in the wind over the
    chips before they land, and cast their shadows on the broadwalk.
  - **You:** walk into them and they go up, the rest of the flock a moment
    after; they come back once you have moved on. Their calls are synthesised
    in `audio.js`.
  - **The map:** a gull marks the flock on the map and the minimap, and a label
    names it in the street. A `visit` step with `flock` goes to it.
- **Traffic** (`web/game/actors.js`):
  - **Pedestrians and cars:** both spawn within about 450 m of the player.
  - **Cars:** sedans, hatchbacks, SUVs, vans, the city's taxis and its buses,
    all modelled in Blender (see [the vehicles](#the-vehicles)). Each model is
    instanced three times, full detail within 35 m, a fifth of the triangles to
    110 m and about 1,000 beyond, so a street of 150 cars costs a few draw
    calls. Paint is glossy, glass is dark, wheels and trim are metal, and the
    occlusion baked in Blender darkens the wheel arches and the underside.
  - **Driving:** they keep left, brake for the cars ahead and for the player,
    and keep bumper-to-bumper gaps, so a bus queues its full length back.
  - **After dark:** headlights, tail lights and the taxis' roof signs light up.
- **Vehicles** (`web/game/vehicles.js`): the helicopter and ferries every city
  shares, modelled in Blender (see [the vehicles](#the-vehicles)). If their
  files can't be loaded, stand-ins built from `web/game/kit.js` take their
  place: lofted hulls, lathes, slabs, fins, rods and tubes at real dimensions,
  merged into one mesh per material, adapted from the vessel kit of an earlier
  reef scene.
  - **Helicopter:** the assisted model, with collisions against buildings and
    landmark solids. It slides along a wall it meets at a glancing angle and
    bounces off a hard hit.
  - **Getting in,** as in GTA and Sketchbook: <kbd>E</kbd> walks you round to
    the pilot's door (round the nose from the far side). The door swings open
    on its hinge, you step up onto the skid and slide into the seat, and the
    door shuts at once. A line on screen says what is happening, the camera
    swings round to watch, and the rotor spools up until it can lift at 90%.
    Getting out is the same the other way round, once you have landed. The
    moves are in the helicopter's own frame, so they work wherever it lands.
  - **The cockpit view** (<kbd>V</kbd>): the pilot's eyes, pitching and
    banking with the cabin, past the instrument panel and through the
    windscreen. Drag to look round; in flight the view drifts back to
    straight ahead.
  - **Ferries:** double-ended, like Sydney's, so they reverse without turning.
    The city's `ferry_style` picks the model (`"model": "harbour"` or
    `"river"`, else by its length) and the livery: Sydney Ferries' green and
    cream with a gold band on the 34 m harbour ferry, and an invented navy
    shuttle on the Yarra, the 22 m river model. Navigation and deck lights come
    on after dark. Each ferry slows into its wharf and waits. You can take the
    helm into a wharf by hand.
- **Water:** the same `web/water.js` sea as the model viewer. The waves follow
  the city's wind, the shore foam follows the kind of shore, and the city
  shows in the water. The ground gets a wet band at the waterline.
  - **Wakes:** the sea keeps a foam field round the camera, 1 m a texel at
    street level. Each frame an overhead camera draws the ferries' wakes, the
    foam round their hulls and the helicopter's downwash into it, and the
    surface turns it into lacy, churned foam that rides the waves.
  - **Turbid water:** a muddy river scatters light back, so the Yarra reads
    brown from above, as in the aerial photo its colours come from. A clear
    harbour reads dark.
- **Trees** (`web/trees.js`): every mapped tree, grown in Blender by
  `blender/build_trees.py` (see [the trees](#the-trees)).
- **Sky and light** (`web/game/atmosphere.js`):
  - **Clouds:** the sky's own cloud layer drifts over the city.
  - **Night sky:** the stars stand where they are for the city and the time:
    the brightest named stars (the Southern Cross and the Pointers among them)
    and a scatter of fainter ones crowding the Milky Way. They turn with the
    sidereal time.
  - **Moon:** placed by a low-precision lunar ephemeris (to about a degree) and
    lit from the sun's direction, so it shows its real phase.
  - **Post stack:** the frame goes through three.js's own effect passes: an HDR
    bloom (lamps and lit windows after dark, glints by day), the world's tone
    curve, a light grade and a vignette. The scene renders into it with a reversed
    32-bit float depth buffer where the GPU has `EXT_clip_control`, which resolves
    millimetres at two kilometres, so distant walls and roofs do not fight over
    pixels. The sky is given back its blue by day (`game.sky.saturation`).
- **Sun and time:**
  - **Clock:** the game starts at Sydney's actual time. If it's dark there, the
    title screen offers the morning first. The title screen and the menu offer:
    - the time now;
    - sunrise, morning, noon, golden hour, sunset, blue hour and night, each shown
      with its clock time on the day. These are worked out from the sun, so a blue
      hour is a blue hour in Paris in June and in Sydney in winter
      (`Sun.presetTime` in `web/sun.js`).

    The menu also has a slider for any time of the day and a date. Changing the
    hour keeps a quest's date.
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
- **Camera shots** (`web/cine.js`, shared with the model viewer):
  - **How they work:** a shot maps progress (0 to 1) to a camera pose. The director
    plays one at a time on the game clock. A key or a drag skips it, and a skipped
    shot still does what it was for (a skipped fast travel still moves you). With
    reduced motion, every shot is a cut.
  - **Start:** from the title orbit, the camera closes in over the player at height,
    drops down beside them and swings in behind. It ends exactly on the chase camera,
    and you can walk while it moves.
  - **Fast travel:** the camera rises over the player and crosses the city. It cruises
    110 m above the tallest roof on the route, read from the surface model's 16 m block
    maxima. It comes down behind the player, who faces the way they flew.
  - **Trig stations:** one turn on the spot, over the player's shoulder with a longer
    lens. The names are the result of a line of sight through the 2 m surface model to
    just under each roof within 3 km. The surface model includes the Opera House
    shells and the bridge deck.
  - **Buildings:** no shot puts the camera inside one. Each pose is kept 3 m above the
    surface model under it.
- **Neighbourhoods** (`web/game/places.js`, game.json `areas`, `spots`, `chatter`):
  - **Areas:** a circle round a station. Walking in puts up its sign: the name, its
    reading, the line's colour band and the stations either side. Where circles
    overlap, the smaller one wins. A sign waits until a camera move ends.
  - **Spots:** <kbd>E</kbd> within a few metres opens a few lines. A spot with
    `"pick": 1` shows one of its lines at random (each ema on the rack is a
    different wish). A quest step `{"type": "spot", "spot": id}` waits for one.
  - **Chatter:** a conversation at a place, one line every few seconds in a bubble
    over where it is said, once you are within earshot. It stays quiet for a while
    after it ends.
- **Lifts and escalators:**
  - **Lifts** (game.json `lifts`): a list of stops, each a point with a height.
    <kbd>E</kbd> at a stop takes you to the next one. The camera climbs the
    building with you, and the time is shortened from the lift's own speed
    (`m_per_min`). The player arrives facing the stop's `face`.
  - **Escalators:** a walkable strip with `moving_ms` carries whoever stands on its
    moving stretch (`moving_u`) along its axis. You can walk on it too.
  - **High floors:** a travel point with a height (`[x, y, z]`) lands you on a roof.
    `always: true` lists it on the map before you have been there.
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
| **The river shuttle** | **The traffic: sedan, taxi, hatchback, SUV, van and bus** |
| ![](images/vehicles/ferry_river.jpg) | ![](images/vehicles/cars.jpg) |
| **Rotor wash over the harbour** | **A Kelvin wake at 16 knots** |
| ![](images/sydney/game-rotorwash.jpg) | ![](images/sydney/game-wake.jpg) |

All of them are modelled in Blender from code by `blender/build_vehicles.py`,
with no hand modelling and no stock assets. The script bakes their ambient
occlusion in Cycles and writes `web/assets/vehicles/`. Every city's game loads
the same files, and `blender/build_scene.py` places the helicopter and ferries
in the city's Cycles renders where the game puts them.

- **Helicopter:** a light twin-engine helicopter in the H135 class.
  - 10.7 m long, with a 10.2 m four-blade main rotor and a ducted tail fan.
  - The fuselage is a parametric surface. Its windows are cut along the
    surface, with rubber gaskets, and a lined cabin sits behind them. Inside are
    seats, an instrument panel with screens and the controls. You can see
    yourself at the controls.
  - The pilot's door is a part of its own (`Door_Pilot`), cut from the skin and
    the lining along its seam and hinged on an upright line ahead of its front
    edge, so all of it swings out clear of the pillar. Grid points next to a
    cut move onto the outline, so the door's edges and the windows' edges
    follow their curves. A frame with a rubber seal lines the opening. The
    model marks the way in: where to stand, the step, and the floor under the
    pilot's hips, where a seated person's feet go.
  - Details: skids with steps, twin exhausts, a camera turret, a searchlight,
    wire-strike cutters, antennas and lights.
  - About 105,000 triangles up close and 12,000 beyond 90 m.
- **Ferry:** a double-ended harbour ferry, 34 m long with a 9.6 m beam.
  - A glazed main cabin with rows of seats, an open upper deck with benches,
    railings, lifebuoys and life rafts, a wheelhouse and a radar mast.
  - About 35,000 triangles up close and 6,000 beyond 260 m.
- **River shuttle:** a double-ended river boat, 22 m long with a 6.6 m beam.
  - A low freeboard for the river walls, with a second rubbing strake.
  - One long saloon glazed from a low sill to the roof, with seats facing the
    windows and a door near each end on both sides.
  - Open decks at both ends with railings, benches, bollards and lifebuoys;
    a railed roof with life rafts and a small wheelhouse amidships.
  - About 27,000 triangles up close and 4,600 beyond 260 m.
- **Cars:** a sedan, a taxi (the sedan with a roof sign), a hatchback, an SUV,
  a van and a 12 m low-floor bus.
  - Each body is one parametric surface: the roof and floor lines are curves
    along the car, and each section is a rounded box that narrows above the
    beltline. Lamps and trim lie on that surface. The wheel arches are cut and
    lined, and so are the window openings: the glass sits in them, framed in
    black outside and in.
  - The side windows run from the beltline to the roof. Each car has a cabin
    behind its glass: front seats, a rear bench (the van has a bulkhead
    instead), a dashboard with its instruments and centre console, and a
    steering wheel on its own node, raked back along the column, which the game
    turns. The traffic's glass is dark, so the traffic leaves the cabins out.
  - About 23,000 triangles each up close, with two decimated copies for
    distance, and 2,300 for a cabin. The occlusion is baked into the vertex
    colours, since the instanced traffic has no textures. `vehicles.json`
    gives each car's length, width, height, axles, wheels, seats and steering
    wheel, for collisions and for seating people.
  - The tail of every car used to close inwards: where a section shrinks to a
    point, the builder turned the last ring of faces the wrong way, so from
    behind you could see into an empty shell. The faces now point out, and the
    traffic draws the inside of a car dark, so a gap anywhere reads as shadow.
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
  - **Your car, taxis and rides** (`web/game/cars.js`): the wheels are split
    off the body at load time, so they roll and steer. The body leans on its
    springs, diving under braking and rolling out of turns. The brake lights
    brighten when braking, the indicators blink when pulling in, and a taxi's
    roof sign is lit while it is for hire. After dark the headlamps light the
    road. People sit in the seats with their feet on the floor, and the driver's
    hands are on the wheel. The inside of the shell is a dark lining, and the
    cabin is mirrored where traffic keeps right.
  - **Water:** the helicopter's downwash throws a ring of spray off the water
    (dust over land). The ferries leave a Kelvin wake, the 19.5° V that every
    ship makes in deep water, as wide as the hull at the start, with churned
    water down the middle and a bow wave at the leading end. All of it is foam
    in the sea's wake field, so it rides the waves.

A city chooses its look in `game.vehicles` in `city.json`. Every key is
optional, and a city with no config gets the defaults:

```json
"vehicles": {
  "helicopter": {"livery": "survey", "registration": "VH-OEH", "logo": "OPEN EARTH 3D"},
  "ferry": {"livery": "harbour"},
  "cars": {"taxi": {"colours": ["#f4c20d"], "share": 0.1}, "bus": {"colour": "#eef0ef", "band": "#f08a00"}},
  "car": {"model": "Car_Hatch", "colour": "#c8372d", "seat": "#34363a"}
}
```

- **Liveries:** `vehicles.json` lists them: `survey`, `rescue`, `news` and
  `executive` for the helicopter, and `harbour`, `bay`, `river` and `commuter`
  for the ferry. A city can also give its own colours, such as
  `{"livery": {"hull": "#f08c1e", "band": "#1f2328"}}`. Without a ferry
  livery, the ferries take `ferry_style`'s colours.
- **Registration:** defaults to the country's nationality mark.
- **Cars:** the taxis' colours and their share of the traffic, the buses'
  colour and band, and optionally `colours` for private cars. Sydney's taxis
  come in any colour, mostly white, silver or black; Melbourne's are yellow
  and its buses carry the PTV orange. The taxis you hail are the taxis in the
  traffic, so they come in the same colours.
- **Your car:** `car` picks its model (`Car_Sedan`, `Car_Hatch`, `Car_SUV` or
  `Car_Van`), its paint and its seats.
- **The side of the road:** `game.keep` (`left` or `right`) sets it. Without
  one, a city takes its trams' side, else its country's rule of the road.

To change the models for every city, edit `blender/build_vehicles.py` and run:

```bash
pip install bpy==5.2.3
python blender/build_vehicles.py            # about 6 minutes; --render also renders the images above
python blender/build_vehicles.py --only cars  # one kind: helicopter, ferry, ferry_river or cars
```

## The main characters

| The surveyors you play: standing, and mid-stride (Cycles) |
|---|
| ![](images/people/H_Surveyor_W_Idle.jpg) ![](images/people/H_Surveyor_W_Walk.jpg) ![](images/people/H_Surveyor_M_Idle.jpg) ![](images/people/H_Surveyor_M_Walk.jpg) |

The two surveyors you play are Microsoft Rocketbox avatars (MIT, © 2020 Microsoft;
`web/assets/people/LICENSE-Rocketbox.txt`): construction workers in hi-vis vests,
hard hats, gloves and radios, made by artists and rigged on a 3ds Max Biped.
`blender/build_people.py` builds them:
- **Clips:** Rocketbox's own motion capture on the same skeleton: a neutral idle,
  walk, fast run, wave, talking and listening gestures, a nod, and checking
  documents. Each clip is copied onto the avatar bone by bone in world space,
  because the avatars' bind pose and the clips' rest pose differ, so local
  rotations would not carry over. The figure stands and moves as it was
  captured.
- **In place:** the walk and the run come with their root motion extracted onto
  a helper, so they play in place; the helper gives each gait's ground speed,
  and the game plays the cycle at the speed you move.
- **Size:** about 8,500 triangles and 2.4 MB each, with WebP textures. The
  exporter bakes every bone's channels on every frame; channels that only hold
  a bone's rest value (the face, and every translation but the hips') are
  dropped afterwards.

The game loads the surveyor you play, and the other when you switch in the
menu. If their files do not load, the earlier characters stand in.

```
python pipeline/fetch_rocketbox.py               # the avatars and clips, into data/raw (once)
python blender/build_people.py --preview         # -> web/assets/people/H_*.glb, docs/images/people/
```

## The trees

| The six species (Cycles render) | Afternoon traffic under plane trees, a palm and a jacaranda |
|---|---|
| ![](images/trees/trees.jpg) | ![](images/sydney/game-traffic.jpg) |

`blender/build_trees.py` grows six species: London plane, elm, eucalyptus,
Moreton Bay fig, jacaranda and Canary Island date palm.
- **Growth:** points are scattered through the shell of the species' crown
  shape (an ellipsoid, a vase, clumps, a dome or an umbrella), clustered into
  limbs and twigs, and branches grow from the trunk out to each cluster. Each
  point carries a card with a spray of leaves from a leaf atlas that the
  script also draws. The cards' normals point out of the crown, so it lights
  as one mass.
- **Detail:** the full tree (1,500–2,800 triangles) within 130 m, a sparse one
  with bigger cards to 520 m, and a trunk with a crown hull beyond.
- **In the game and the model:** `web/trees.js` draws every mapped tree,
  instanced per species and distance. Each tree takes a species from the
  city's mix by a hash of its position, a size from its height and a turn of
  its own. The wind sways the crowns and flutters the leaves, the leaf cards
  cut out their shadows, and jacarandas flower from mid October to November
  in the south (May and June in the north).
- **Mix:** OpenStreetMap rarely says what species a tree is, so each city
  sets a mix in `city.json` (`"trees": {"mix": {"plane": 0.3, ...}}`).

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
- **Night.** The street lights, the traffic's lights and the towers' lights come from
  `night.json` ([NIGHT.md](NIGHT.md)), styled by `city.json` `night`; `night_ambient` adds
  a quarter of its old lift on top (neon, signs), and a landmark material can carry
  `emissive` and `glow` so signs light up.
- **Neighbourhoods.** `areas` (station signs), `spots` and `chatter` live in `city.json`
  `game`, or a city's `game_extras` hook returns them with positions measured from its
  landmarks. [Tokyo Pilgrimage](cities/shibuya.md#7-tokyo-pilgrimage) is the example.

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

The camera shots were checked the same way:
- the start: it lands on the chase camera;
- a fast-travel hop: the player arrives, and also arrives when the hop is skipped
  with a key;
- a survey at the bridge and at Observatory Hill: the right buildings are named, and
  the field notes are written;
- the height challenge: the guess is scored against the band of the height's source.

A Hong Kong script plays its six stamps the same way: both Star Ferry routes,
the landing in Tamar Park, the sun step in Statue Square on 21 December, the
five-minute Peak Tram ride (boarding, the climb to 397 m, getting off at the
Peak) and the last talk at the lookout. A Melbourne script plays its six stamps the same way: the sun step at
Federation Square on 22 June, the river shuttle to Crown Landing, and the
flight to Birrarung Marr. A Paris script plays its seven: the Batobus to
Notre-Dame, the winter sun in the Luxembourg, and the flight under the Eiffel
Tower's first floor to the Tuileries. An Amsterdam script plays its eight: it
finds the three gables through the lens itself, from 14 m out in front of each
house, rides the F3 across the IJ and finds the December sun on the
Rembrandtplein.

A bayside script walks all four stamps on foot:
- **The pier:** it walks up the approach from the promenade and along the pier
  to the kiosk. It checks that the breakwater rocks refuse a walker and the
  viewing platform does not.
- **The penguins:** it takes the dusk choice and walks out to the platform. It
  checks that the step waits for dark, then sets the clock to 100 minutes after
  sunset, when 14 birds are ashore within 40 m.
- **Luna Park:** it walks in through Mr Moon's mouth.
- **The boxes:** it walks the row of boxes on the sand.

It found three faults, each now fixed:
- the pier could not be reached from the shore;
- the Scenic Railway's trestles blocked the gate;
- birds walked hundreds of metres from a random landing place. A further script docks a ferry by hand. Phone layout, the routes into the game
and the menus are checked in a phone-sized browser.

A cars script drives each part of the new road travel, in Sydney and in Paris:
- **Walking:** you stop at the side or the back of a parked or passing car (at
  half its length plus your own radius), and the camera rises over a car rather
  than ending up inside one.
- **Your car:** you get in at the driver's door. It reaches 72 km/h in 3 s and
  132 in 8, tops out near 155, and stops from 155 km/h in 68 m. Full lock at
  60 km/h turns it 62° in 2 s without losing speed. A handbrake turn spins it
  85° while it slides on the way it was going. It reverses, and its turning
  circle is a 5 m radius.
- **A taxi:** hailed from the kerb, the nearest one coming your way (400 to
  700 m off by road in the runs) pulls in beside you. You get in, the driver offers seven places, drives off round
  the car parked ahead of it, and arrives. A skipped trip arrives too, and the
  taxi drives away once you get out.
- **A ride:** ordered on the phone, it is sent with a driver, a model and a
  plate, and set off from a few hundred metres away.
- **Seats:** in a moving car the passenger's and the driver's hips stay on the
  cushions (0.6 m up), the heads under the roof, and the driver's hands on the
  wheel.
- **Paris:** the traffic keeps right, the taxi's wheel is on the left, and you
  sit behind the passenger, on the kerb side.

A Shibuya script checks the walk's moving parts:
- **SHIBUYA SKY:** <kbd>E</kbd> at the street door offers the lift, which lands
  you on 46F at the escalator's foot; standing still, the escalator carries you
  5.5 m up to the deck in 20 s; you then walk out across the roof.
- **The 男坂:** from the lane at its foot you walk onto the first step and up all
  52 to the approach, with your feet on each tread.
- **Places:** the station sign comes up after the start, and every spot answers
  <kbd>E</kbd> where it stands.

It found four faults, each now fixed:
- a strip's slab topped each 2 m cell at the surface's height at the cell's
  centre, so on a 30° escalator the cell ahead stood above the knee and stopped
  the rider halfway. A slab now tops out at the lowest point of the surface in
  its cell;
- each of the roof's solids stood on its own ground, a few centimetres off the
  drawn deck, so at the escalator's foot the floor of its well was the higher
  floor and the escalator never took you;
- the cut that sets the stairs into the slope dug the lane at their foot by up to
  0.8 m;
- an NPC stood in the lift's door, so <kbd>E</kbd> talked to her instead.

`tools/game_check.js <city>` is the smoke test for every city's game. It starts
the game, walks for four seconds, talks to the first quest giver, flies the
helicopter up and lets the ferries run for 40 s, with a screenshot after each
step. It fails on any page error. All eight cities pass it.

## Limitations

- **Tree species:** guessed from a mix per city, since the data rarely names
  them; a tree's height is a 7–14 m spread.
- **Night sky:** the bright stars are real, the faint ones are a random
  scatter, and the moon's place is good to about a degree.

- **Close-up ground:** at street level the aerial imagery is still the weak
  point. The drawn streets help on paths and roads. Plazas and courtyards that
  OpenStreetMap maps only as areas still show the photo.
- **People:** the characters are low-poly, with simple faces, and there are 13
  base bodies. Distant walkers swing rigid legs and arms instead of playing the
  full animation. The box-built figures return if the character files cannot
  be loaded.
- **No rigid-body physics:** walls are exact, but the landmarks (the Opera
  House shells, the bridge steel) still collide as 2 m boxes. The floor is found
  under the walker's centre, not under the whole capsule. There is no ragdoll or
  car damage. [ENGINES.md](ENGINES.md#roadmap) lists the next steps.
- **Driving:**
  - Your car is three circles down its length against the walls, so its corners
    can touch a wall before the circles do.
  - Cars push you aside instead of knocking you down, and stop dead for people.
  - The traffic keeps to its lane. It swings out round a car pulled in at the
    kerb but never overtakes, so a car stopped in the lane holds up the queue
    behind it.
  - One-way streets and turn restrictions are not in the routes, and nothing
    stops at junctions or lights.
  - Only roads at about your height count as the kerb, so a taxi won't stop on
    a flyover above you. A destination is reached at its nearest street, so a
    landmark across a plaza is a short walk from where you get out.
  - Seen from a seat, the edges of the window openings still step slightly,
    because the body is cut cell by cell.
  - You can't steal or hail a car from the traffic other than a taxi, and the
    taxis have no fares.
- **Crowd:**
  - Walkers avoid each other along the footway lines, not across open plazas,
    and they don't avoid cars.
  - Bench shade counts buildings and landmarks but not trees.
  - Whether people want sun is a rule of thumb, the month's average top against
    22 °C, not the day's weather.
- **Ferry timetable:** the routes follow the inner-harbour services, but the
  timetable is invented. Ferries run at 1.5 times real speed.
- **Vessels on the water:** a ferry rides the mean water level and does not
  pitch or roll on the waves. Its wake is foam drawn into the sea's wake field,
  not waves of its own.
- **Two ferry models for every city:** a Sydney-style double-ended harbour ferry
  and a river shuttle, in each city's livery. A city whose boats look
  different, such as catamarans, gets the nearer of the two.
- **Penguins:** the birds walk straight from the water's edge to their burrows,
  through each other. The burrows are spread over the mapped rocks, not at the
  colony's real nest boxes, which are not mapped. The game shows 160 of about
  1,400 birds.
- **Piers:** the passers-by keep to the shore, because footways over water are
  dropped unless they are flagged as bridges.
- **Trams and the funicular:** the trams are ambient: you can't ride them.
  The Peak Tram skips its intermediate stops, and both of its cars face uphill.
- **One ferry for every city:** the ferry is a Sydney-style double-ended vessel
  in each city's livery. A city whose boats look different, such as river buses
  or catamarans, still gets this hull.
- **Interiors:** buildings have no interiors you can enter; the rooms seen
  through their windows are drawn by the shader. You walk on roofs as the
  surface model has them, so a pitched roof is a slope in steps of one cell.
- **Lines of sight:** trees are not in the surface model, so a building behind a
  tree still counts as in sight. Each building is sighted at one point, just under the
  roof of its tallest part.
- **The edge of the model:** the last few hundred metres fade into haze, so the city
  does not end in a cliff over a flat sea. The haze hides the edge; it does not fill
  it. There is nothing of the city beyond the frame, and the wharves and streets
  near the frame look hazy from a distance.

## Sources

- Persona 5's Tokyo and the real places: [Kotaku](https://kotaku.com/persona-5s-in-game-locations-compared-to-the-real-world-1787125885),
  [TheGamer](https://www.thegamer.com/persona-5-locations-visit-real-world-counterparts/),
  [Megami Tensei Wiki: Yongen-Jaya](https://megatenwiki.com/wiki/Yongen-Jaya).
- Unreal Engine's CharacterMovementComponent and SpringArm: see
  [ENGINES.md](ENGINES.md#sources).

- Microsoft Flight Simulator buildings and the Melbourne tower:
  [TechCrunch](https://techcrunch.com/2020/08/17/meet-the-startup-that-helped-microsoft-build-the-world-of-flight-simulator),
  [The Register](https://www.theregister.com/2020/08/20/flight_simulator_bing_fawkner_tower/).
- The Sydney World Update and the earlier flat bridge:
  [UploadVR](https://uploadvr.com/microsoft-flight-simulator-world-update-australia/).
- Helicopters in the 40th Anniversary Edition:
  [VGC](https://www.videogameschronicle.com/news/microsoft-flight-simulators-40th-anniversary-update-adds-helicopters-and-gliders).
- GeoFS: [instructions](https://www.geo-fs.com/pages/instructions.php).
- Sketchbook: [source](https://github.com/swift502/Sketchbook) (`Helicopter.ts`, `Character.ts`).
- GTA VI's Ryde Me app and its cars:
  [allthings.how](https://allthings.how/gta-6-ryde-me-how-the-taxi-app-handles-fast-travel-in-leonida/),
  [Beebom](https://beebom.com/gta-6-taxi-app-lets-you-fast-travel-around-leonida/),
  [Jalopnik](https://www.jalopnik.com/2246099/gta-6-race-track-new-details/).
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
