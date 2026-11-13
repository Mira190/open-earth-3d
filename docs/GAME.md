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

The characters talk like the locals they are: who they are, what this street is,
what is worth seeing at this hour and season, and where to go next. A guide's first
meeting is two or three lines before the first choice. Numbers they give (a height,
the share of a square in sun at noon on the solstice, tonight's sunset) are still
computed while you play, but nobody in the game talks about open data, LiDAR,
PLATEAU or how the map was built: that belongs in the model viewer's tour and its
Sources panel, and in these docs. `tools/voice_check.py` reads every line the
characters say, in every city and reef site, and fails on a short list of such
words (it runs in `tools/check.sh`). Rewritten lines reach `web/data/<id>/game.json`
with `python pipeline/game_text.py`, without rebuilding the game data.

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

A game can also start from a postcard: the title screen's pile of them
([POSTCARDS.md](POSTCARDS.md)) opens a city at `#play-<city>@pc-<spot>.<light>`, on the spot
where the photograph was taken, with "As on the postcard" offered as the time to start at. A
map's passport lists the postcards that have come from it.

## Playing

| Keys | What they do |
|---|---|
| <kbd>W A S D</kbd> or arrows | Walk relative to the camera. Drag to look around; scroll to zoom. |
| <kbd>Shift</kbd> · <kbd>X</kbd> · <kbd>Space</kbd> | Sprint while held (8.5 m/s) · switch between running (6 m/s) and walking (1.4 m/s) · jump. A chip under the sun indicator shows the gait. The run is the pace of the surveyors' run clip (5.4 to 5.8 m/s), so the feet keep to the ground. |
| <kbd>E</kbd> | Talk, board a ferry or wait for one, board the helicopter, drive your car, get in a taxi, get out, take a lift, look at something up close |
| <kbd>Y</kbd> · <kbd>N</kbd> | Raise your hand at the kerb and a taxi pulls in · the phone: order a ride, bring your car |
| <kbd>Q</kbd> | Survey lens: the building in front of you, its height and where the height comes from |
| <kbd>G</kbd> | Height challenge: guess the height of the building in front of you, then see how good the data is |
| <kbd>E</kbd> at a △ | Survey the view from a trig station |
| <kbd>T</kbd> | Switch which walk the route and the beam follow |
| <kbd>O</kbd> | Photo mode: the world holds still while you set the sun, the lens and the angle, and save a picture |
| <kbd>J</kbd> | Diary: today's date, weather and calendar, who is free, the work on offer, and pass the time (see [Daily life](#daily-life-the-day-the-diary-bonds-skills-and-jobs)) |
| <kbd>M</kbd> · <kbd>P</kbd> · <kbd>Esc</kbd> | Map: pick a landmark, a trig station, a wharf or any spot and travel there at once (double-click goes straight there), or set a waypoint; scroll or pinch to zoom, drag to pan · passport of stamps · menu (time of day, any time and date, clock speed, crowds, sound) |
| <kbd>E</kbd> at a `≈` | Fish from the shore, at the spots Sydney and Queenstown have for now: <kbd>Space</kbd> casts, strikes and winds ([docs/FISHING.md](FISHING.md)) |
| <kbd>R</kbd> | Unstick yourself |
| Helicopter | <kbd>Space</kbd> climb, <kbd>C</kbd> or <kbd>Shift</kbd> descend, <kbd>W</kbd>/<kbd>S</kbd> forward/back, <kbd>A</kbd>/<kbd>D</kbd> turn, <kbd>V</kbd> chase, cockpit or bird's-eye view (drag to look round the cockpit) |
| Ferry | <kbd>F</kbd> skip ahead, <kbd>H</kbd> take the helm for the approach to the next wharf |
| Funicular | <kbd>E</kbd> board at a station and get off at the other end, <kbd>F</kbd> skip ahead |
| Your car | <kbd>W</kbd>/<kbd>S</kbd> drive, brake and (stopped) reverse, <kbd>A</kbd>/<kbd>D</kbd> steer, <kbd>Space</kbd> handbrake, <kbd>H</kbd> horn, <kbd>V</kbd> from the driver's seat, <kbd>R</kbd> back on the road, <kbd>E</kbd> get out |
| Taxi or ride | <kbd>F</kbd> skip the trip, <kbd>V</kbd> from the back seat, <kbd>E</kbd> get out when it has stopped |

On a phone you get a joystick and buttons. Camera moves (the start, fast travel, a
survey) end at once on any key or drag.

While a city loads, the loader shows how much of its data has arrived and names
each step, on a card over the city's **survey plate** (`web/plate.js`): the
model's own ground imagery assembling tile by tile as it arrives, at full
resolution, under a survey grid (a line every 250 m, every kilometre marked)
with the city's landmarks pinned on it one after another, a scale bar, the
city's coordinates, its building count and the sources of its imagery and
heights. The tiles are the files the city loads next, so they come from the
cache, and everything that moves (a slow drift, the scan line, the pins) is a
CSS transform or opacity that the compositor runs on its own thread, so the
plate keeps moving while the city is parsed and built. A visitor who prefers
reduced motion gets it still. The loader stays up until the scene has been
drawn twice (its shaders compiled first with `compileAsync`), so the hand-over
never shows a black frame; `tools/load_check.js` checks that, and `check.sh`
runs it. The plate replaced a recorded flyover video, which was soft,
stuttered while the city built and flashed black at the hand-over;
`tools/flyover.js` can still record one for a film.

### Where you start

Every city starts you where visitors go first, with a quick way out by air, water
and road: the helicopter on a pad a short walk away (the first pad in
`game.helipads`, a game pad where the city has none there), a ferry landing near
where the city has ferries, and a kerb close by for a taxi. The lead's welcome
says where each is. Sydney starts on West Circular Quay facing the Opera House,
Paris on the Pont d'Iéna at the foot of the Eiffel Tower, Tokyo on the Marunouchi
plaza in front of the station, Kyoto on the station plaza below Kyoto Tower,
Osaka on the Dotonbori (its pad is on an open lot a block north-east), Shibuya at the Hachiko-side kerb of the scramble as its walk turns green (its pad is the roof of SHIBUYA SKY, a lift ride up),
Hong Kong at the Star Ferry's Pier 7, Melbourne in Federation Square, the bayside
at St Kilda Pier and Amsterdam on the Dam. Heron Island and Whitsundays start on
the beach by their helipad.

One helicopter serves every pad. Walk or ride towards another pad while it stands
shut down more than 700 m away and it is waiting there when you are within 300 m,
so the pilots' quests at the other pads still find it. `tools/start_probe.js`
finds open ground for a pad near a point, `tools/start_shot.js` takes stills of a
start and its helicopter, and `tools/plan_map.py` draws the start, pads, wharves,
roads and NPCs on the aerial imagery.

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
- **The autopilot** (<kbd>J</kbd> at the wheel, **Auto** on a phone): the car drives
  itself. With a waypoint set on the map it goes there; with none it asks where to,
  by name (the next step of your walk, the nearest landmarks, the wharves, where you
  started), and which way: the quickest, or the scenic one by the water and the
  landmark streets (<kbd>Shift</kbd>+<kbd>J</kbd> asks even with a waypoint set). It is
  the taxis' driver at your own wheel: it pulls out from the kerb, keeps its lane,
  queues, waits at red lights, gives way at junctions, goes round a jam and pulls in
  at the kerb when it gets there. <kbd>J</kbd> again, the wheel, the brake or the
  handbrake gives the car back to you as it is moving, at the speed it had. The
  screen shows where it is going, how long and how far, the next turn and what the
  driver is doing; the gold route on the map and the
  minimap is its own. While it drives the camera is a film of the drive: behind, a
  front quarter, a crane, the side, an orbit, with a cut between them; a drag of the
  view gives the camera back to you for eight seconds, and <kbd>V</kbd> sits you in
  the seat. Set a new waypoint while it drives to the old one and it goes on to the
  new.
- **Driver assists** when you drive yourself, each a toggle: **lane keeping**
  (<kbd>I</kbd>) holds the car in the lane of the road it is on, and lets go when you
  steer past half lock, change lanes or turn at a junction; **adaptive cruise**
  (<kbd>K</kbd>) holds the speed you were doing when you set it (30 km/h at least),
  keeps a gap to the car ahead, slows for a bend and stops at a red light, a level
  crossing or a wall across the lane (a street shut off at its end); the accelerator adds to it and the brake ends it. On a phone the **Lens**
  button at the wheel steps through them (lane keeping, both, none), and **Run** is
  the autopilot's **Auto**.

The streets round you have somewhere to go. Most cars are on a trip, into town in
the morning and out to the map's edges in the evening, so the main roads carry more
than the back streets; cars stand parked along the kerbs that have room, pull in at
the end of a trip and pull out again with their indicators on; buses stop at their
stops while people get on and off, taxis wait at the kerb by the places people go,
and vans stop for a delivery with their hazards on; brake lights come on
as a car slows, indicators before a turn or a lane change, and the bodies dip and
lean on their springs. In rain, snow or fog everybody drives slower with longer gaps
and headlamps on, the wet road throws spray up behind the wheels, and your own car
takes longer to stop and runs wider through a bend. At a level crossing the traffic
stops for the alarm and never queues across the rails. A driver held up behind your
car stopped in the lane sounds the horn after five seconds, not before.
- **A taxi:** stand at the kerb and press <kbd>Y</kbd>. You raise your hand, and
  the quickest free taxi coming your way, by road, pulls in on your side of the
  street with its hazard lights on. If none is close, one comes round the corner.
  Get in with <kbd>E</kbd>. The driver asks where to: your waypoint, the next
  step of your walk, your car, the nearest landmarks, the wharves you have used,
  or where you started. Each is driven to the kerb nearest it that a road from
  here reaches, never one on a piece of road cut off from the streets (a drive
  mapped at a building's level, as at Shibuya Hikarie; `cars.js` router groups);
  should none be found the driver says so and asks again, and you stay in. Out
  on the way (held up in a jam, say), the taxi stands in its lane while you are
  beside it: <kbd>E</kbd>, <kbd>Y</kbd> or a ride ordered on the phone gets you
  back into it, where you were going offered first, rather than another taxi.
- **A ride:** order one on the phone (<kbd>N</kbd>), as GTA VI's Ryde Me app does.
  Choose where to go first, and a private-hire car sets out for the nearest kerb.
  The phone shows it as a ride app does: a map framed on the car, the pick-up
  and you, with the route it still has to drive, the car moving along it, the
  pick-up pin and a dotted walk to it from your blue dot; the time it will take,
  the driver with a rating, the car and its number plate. On the way the map
  follows the car to where you are going. The minimap draws the same route and
  opens out to hold the car, and the walk to the pick-up gets the gold route.

A taxi or a ride reaches you within half a minute. The router searches the street
network backwards from the pick-up for points 110 to 270 m away by road (40 to
110 m where none of those is near enough in time), following the one-way streets;
each is timed by driving its route in a dry run (the driver's own rules, nothing
in the way), with 1 s added for each set of traffic lights near the pick-up and
1.8 s for each car already queued at a signalled arm on its way (`OECars.queueing`:
it waits behind a queue, never round it; #143), and
the one that takes 10 to 20 s, out of your sight where it can be and not where a
car of the traffic or a queue would be in its way as it sets out, is chosen,
leaving the rest of the half minute for the traffic you can see. The same time is
what the phone shows: it counts down as the car comes and, held up behind the
traffic, rises as it waits, as an app's does, and with the queues still ahead
of it as they grow and clear; stopped at a red light, or queued
behind cars that are, it shows the time to that light's green (`junctions.js`
`toGreen`) and a moment for the queue to move off, and behind a car stuck at a wall
or stopped for good, the few seconds before its driver swings out round it. Coming
up to traffic lights it asks for its green, as a bus with priority does, from 12 s
out at its speed (in your sight or out of it), so that the lights have changed by the
time it gets there: the other road's green ends once it has run 4 s, through amber
as ever, and its own green is held while it comes (up to 6 s past its end); at a
scramble a walk not yet started waits for its turn, one under way runs its course.
A ride you are in asks for its greens the same way. It
stops at a red line only in your sight. Its driver goes into a junction as the
traffic does, asking `junctions.js` for its way across (none crossing it already
in, the longest waiting first, giving way to the main road), so a car of the
traffic never enters the same junction across it. Held more than 10 s behind a
queue in view, it looks for another way from where it stands round the piece of
road the queue is on, and takes it if it is no more than 300 m longer (and so with
you in it, on the way to where you are going, up to a quarter longer); queued 8 s
within 45 m of the pick-up, it stops there and you walk the last metres. Where the kerb it
is to pull in at is taken, by your own car or one stopped there for good (10 s),
it pulls in just behind, and drives round one only waiting in the traffic; held
up near the end for 8 s, it stops where it is with its hazards on. Where no car
can reach your kerb in time (a dead end the near side of the street faces into,
a stub no road feeds) the pick-up of a ride ordered on the phone moves to the kerb across the
street or a street round the corner, as a ride app moves it (a taxi you hail keeps your kerb, or
the one across the street: it pulls in beside you, #209); in streets as slow as Shibuya's a car
can set out from just round the corner, 15 to 40 m off; and where the one-way
streets leave next to no way in, the search goes back along any street, as the
router does. Rather than none, a slow ride comes, the phone saying how slow.
Running more than six seconds late in a jam and out of the camera's view, it
moves on along its route to a clear stretch of road, as games keep the cars that
come for you on time. A driver waits five minutes at the pick-up.

The driver takes you by road, along a route over the street network, keeping to
the lane, slowing for bends and for the traffic, and signalling into the kerb at
the end. A car stopped in the lane, such as yours left in the road, is driven
round over the centre line, by the driver and by the traffic, once nothing is
coming the other way. While the car coming for you is out of your sight (more than
40 m off and off the screen, or more than 120 m off), neither the traffic nor the
lights hold it up, so it comes in good time, as it would in a game; in your sight
it queues, stops at the lights and never steps further into another car. On the way they talk about what you are passing, as the people on the
footways do: what that building is, and how tall. <kbd>F</kbd> skips the trip, as in GTA V: the camera
rises, crosses the city and comes down behind the car at the kerb. The traffic
keeps to the city's side of the road: the left in Australia, Japan and Hong
Kong, and the right in Paris, where the cars are left-hand drive.

The walks come in lines. After a welcome, three walks run side by side, in
any order, and a report back waits for all three. Sydney has seven
stamps, and an eighth for the locals:
- **Welcome** (Ava, at Circular Quay): she sets out the three walks and asks
  which you want to start with.
- **The harbour** (Marco, at the Opera House), two stamps:
  - hear how the shells are cut from one sphere, and climb the Monumental Steps;
  - ride the ferry to Milsons Point, then walk up the bridge approach to the
    middle of the arch.
- **The air** (Sam, at the Kirribilli helipad): fly under the deck and land in the
  Domain.
- **The ground** (Priya, in Martin Place), two stamps:
  - find a spot that gets sun at lunchtime on the winter solstice;
  - then Tom, a Hyde Park regular, tells you about the park and sends you across
    College Street to St Mary's Cathedral.
- **Report back** (Ava): opens once the three walks are done.
- **The locals** (Jess, a waiter at the Opera Bar), on the side: walk up to the
  silver gulls fighting over a box of hot chips by the water.

A step counts whether its line is tracked or not. If you stand in the sun in Martin
Place on the way to the ferry, the ground walk moves on. <kbd>T</kbd>, or a tap
on a walk's name in the quest card, chooses the line that the route, the beam and
the minimap's star follow. The other lines show as hollow stars.

Docking a ferry by hand earns an extra stamp. After the walks, the city is free
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

Melbourne has the same shape and six stamps:
- **Welcome** (Mia, at Federation Square).
- **The square** (Hannah, in City Square): how DDO10 protects public spaces from
  new shadow, and a sunny spot on Federation Square at lunchtime on 22 June.
- **The river** (Arjun, at Federation Wharf), two stamps:
  - the river shuttle to Crown Landing;
  - Sophie's helicopter past the Arts Centre spire to Birrarung Marr.
- **The gardens** (Jun, a city gardener in Birrarung Marr): up the hill to
  Fitzroy Gardens and Cook's Cottage.
- **Report back** (Mia).

Melbourne has no ferry through the city, so the shuttle is invented and says
so.

The bayside is one line of four stamps, taken in order:
1. Walk out along St Kilda Pier to the kiosk.
2. Hear from Tash, an Earthcare volunteer, about the colony, then wait on the
   viewing platform after sunset until penguins come ashore near you. One
   choice in the dialogue sets the clock to ten minutes before today's sunset.
3. Walk into Luna Park through Mr Moon's mouth.
4. Walk the row of Brighton bathing boxes, from the first to the last.

The bayside has no ferries and no real helipad. The pad at Elwood is invented
and says so. Its six shore stops are on the map from the start, to travel to at
any time.

Hong Kong has six:
1. Take the Star Ferry from Central's Pier 7 to Tsim Sha Tsui.
2. Hear about the Clock Tower from Wing, walk east along the Tsim Sha Tsui
   promenade for the view of Central, then take the ferry on to Wan Chai.
3. Fly from the Convention Centre heliport between the towers and land in
   Tamar Park.
4. Find a sunny spot in Statue Square at noon on 21 December, among the bank
   towers.
5. Ride the Peak Tram from Garden Road to the Peak.
6. Meet Mrs Fong at the lookout, and stay for the 8 pm light show.

The Star Ferry's routes are real; its timetable and which vessel runs which
route are not.

Paris has seven stamps, written as three lines after a welcome on the
Pont d'Iéna (see [the Paris case study](cities/paris.md#6-paris-on-foot)):
- **The river:** Bernard, a bouquiniste, on reading the roofs of Paris; the Batobus from Saint-Germain-des-Prés to Notre-Dame; Léa, a carpenter
  on the cathedral's roof.
- **The Left Bank:** a chair in the sun in the Luxembourg at noon on 21 December;
  Karim's café and Nadia's bakery.
- **The tower:** fly under the Eiffel Tower's first floor and land in the
  Tuileries.
- **Report back** to Camille.

On the Seine the helicopter takes the nearest span to fly under, and a step can
name its span (`"surface"`).

Amsterdam has eight stamps, written as three lines after a welcome on
the Dam (see [the Amsterdam case study](cities/amsterdam.md#6-amsterdam-on-foot)):
- **The canal ring:** Pieter, a building historian on the Herengracht, sends you
  to find a step gable, a neck gable and a bell gable with the lens (a
  `gable` step: the lens names a house's gable and when that type was built);
  Femke plays the Westertoren's carillon, and the Anne Frank House is two doors
  down.
- **The IJ:** Joost puts you on GVB's free F3 ferry to Buiksloterweg; Noor at the
  Eye shows you the A'DAM Toren.
- **The winter sun:** a spot in direct sun on the Rembrandtplein between 10:00
  and 14:00 on 21 December, when the sun stands 14 degrees high at noon; then a
  stroopwafel at the Albert Cuyp market.
- **Report back** to Sanne on the Dam.

Amsterdam has no real helipad in the old city. The pad on the Dam is a game device, so that the city can be seen from the air.

**Tokyo Pilgrimage** (two maps of Tokyo, see the case studies of
[Shibuya](cities/shibuya.md#7-tokyo-pilgrimage-shibuya) and [Shinjuku](cities/shinjuku.md#5-tokyo-pilgrimage-shinjuku))
is a pilgrimage: in Shibuya a welcome across the scramble by QFRONT, in Shinjuku at the east exit, then
lines in any order and a report back.
- **Shibuya:** cross the scramble to Aoi and back to Hachiko, read the arch over Center Gai, take the
  lift up SHIBUYA SKY, ride the escalator up the north edge onto the roof, stand at SKY EDGE and ride
  down the west edge facing Shinjuku.
- **Sangenjaya:** the backstreets a game called Yongen-Jaya, a snack bar's front, the bathhouse,
  and the triangle after dark.
- **Your Name** (Shinjuku): climb the 52 steps of Suga Shrine's 男坂 and read an ema.
- **Shinjuku:** Kabukicho's arch after dark.
- **Aoyama** (Shinjuku): the ginkgo avenue at Jingu Gaien.

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

### Arriving and getting started

Starting a game is one calm camera move, about 3.6 s, from the title shot down to
over the player's shoulder (`craneIn` in `web/game/game.js`). It dollies in along
the bearing the title camera is already on and turns about the player by at most
50°, spread evenly over the move, so it never swings round them, spins or changes
direction; the horizon stays level. The distance closes on a log scale, so the
approach is a steady glide rather than a rush at the end, and the point the camera
looks at closes on the player faster than the camera does, so the view hardly
turns. The player turns to face the way the shot looks, as near the start's own
view as that allows with a few steps clear in front. `calmElevation` keeps the
line 8 m clear of the roofs while it is far out, as an envelope whose elevation
changes no faster than a set rate, so it comes over a tower without a jolt. Any
key or tap settles it in 0.7 s; with `prefers-reduced-motion` it is a cut under a
short fade. The fast-travel hop follows the same rules: one even turn of at most
45° a second, up and down on a log scale (the old one plunged at the end), and over
tall blocks it cranes up over the player before it pulls back and takes up to
6.5 s rather than tilt fast. `tools/arrival_shot.js <city> <out> [desktop|phone]
[travel id]` follows the camera frame by frame through the arrival and a hop to
the farthest travel point, prints each move's peak turn and pitch rates, and
fails above 45° and 60° a second.

A city can open on a shot of its own (`game.start.shot` in `city.json`, #110):
`look` is the point the title frames (absolute metres), `dur` the move's length
(4.2 s), `walk_in` when a scramble at the start turns its walk green (2.2 s into
the move) and `sway_deg` the title camera's gentle sway. The title camera then sits
behind the start's own view, turned by up to 30° and raised as far as it takes to
frame the point clear of the towers in front of it (`openingView`, which scores a
fan of lines over the DSM), and sways rather than orbits, so Play cranes straight
down to over the shoulder: the look holds on the point while the camera comes down
to the street, then tilts down to the player, the line kept 24 m over the roofs
(their screens and signs are not in the DSM), and hands over without a cut. Shibuya
uses it: the title looks over the station to QFRONT's screen, the crane comes down
over the scramble as every arm turns red and the walk turns green, and the crowd
gathered at the kerbs of every crosswalk (`crowd.muster`, twenty at yours) steps out
round you as control comes, a couple of seconds into the walk; a car moving in or
near the box as the walk is forced green comes back elsewhere (`clearBox`). The travel menu's
Shibuya stop is the same kerb, and Aoi, the guide the onboarding sends you to,
waits across the diagonal by QFRONT, so the first walk is the crossing.
`game.start.car` puts your car at a kerb away from the start when the start's own
kerb is no place for it (Shibuya's: at the scramble's mouth; it waits by Hachiko),
and no car is left within 36 m of a scramble when another kerb will do.
`tools/opening_shot.js <city> <out> [WxH] [times]` takes stills of the shot (as Play
is pressed, in the crane, at the street, the hand-over and 3 s on), and
`tools/game_check.js` checks that the game opens at the scramble's kerb, in its
walk, with walkers round you.

A map with an overture (`game.overture`, so far Shibuya) plays it in place of the
opening shot the first time you play that map: about forty seconds cut to a score, from the
map's signature sights down to your shoulder, after which the onboarding goes on as
below. Any key or tap eases down to you in under a second; "Play the opening" in the
menu plays it again. See [OVERTURE.md](OVERTURE.md).

The first time a browser plays any map (or reef site), a short tour of the HUD
follows the arrival (`web/onboard.js`): walking and looking, the map, travel,
taxis and rides, the passport, the phone, photo mode, the menu and the route line,
one step each, pointing at the control with a ring and a card, with touch wording
on a phone. Enter or → moves on, ← goes back, Esc or "Skip tour" ends it. The flag
(`oe3d-onboard` in `localStorage`) is shared by every map, so on a later one the
title card offers "Skip the intro", ticked, and the guide greets you with a short
local welcome instead. "Show the intro again" in the menu runs the tour at any
time. While the tour shows nothing can be started (no talk, no boarding), and it
carries `data-hush`, so the area sign waits for it.

### Weather

Rain, drizzle and overcast come as each city's climate brings them for the date on the game's
clock (Tokyo's June rainy season about half its days), or as chosen in the menu's Weather row or a
quest (Kaede waits for the rain in Shinjuku Gyoen's shelter). Rain falls round you but not under a
roof or a tree, the ground darkens and holds puddles with rings in them, the crowd puts up
umbrellas and the light goes soft and grey-blue. How it works, what it learnt from and its sources:
[WEATHER.md](WEATHER.md).

## What we took from other games, and where this one is different

A research pass looked at the games people compare this to. The sources are
listed at the end.

| Game | What we took | What this does that it can't |
|---|---|---|
| **Microsoft Flight Simulator** | Hand-built landmarks over generated filler; an assisted helicopter, since players find hovering hard. | Its buildings are generated, and it shipped errors that open data can contain. A two-storey building tagged as 212 floors in OpenStreetMap reached the sim as a Melbourne monolith. Sydney's Harbour Bridge was a flat auto-generated span until World Update VII. Here every height has a source, outliers are capped, the towers are checked against published heights, and the bridge is built to its published geometry. |
| **Sketchbook** (three.js sandbox) | Assisted helicopter flight: the rotor cancels gravity so it hovers with no input, levels itself, damps drift and spools up before take-off. You walk to the door instead of teleporting in, and <kbd>E</kbd> to use. | Its world is an empty sandbox. Here the world is a real city with things to do. |
| **GTA V** | A clock running 30 times real time, so a day lasts 48 minutes. A minimap with a GPS route along the street network, which in a car keeps to the roads. A waypoint you click on the map. A crowd and traffic density setting. Hailing a taxi at the kerb, telling the driver where to go, and skipping the trip. A view from the driver's seat. | Its city is a caricature. Here the streets, wharves and sun are real, the traffic keeps to the city's side of the road at Overture speed limits, and crowds keep left as Australians do. |
| **GTA VI** (trailers and previews; it comes out on 19 November 2026) | Ryde Me, the ride-hailing app on the phone: say where, and a car comes for you. Cars with interiors you can see into, and bodies that move on their springs. | Its taxi driver can talk to you on the way. Here what the driver says is a fact about the street you are on, worked out from the model. |
| **Red Dead Redemption 2** (the cinematic camera on a waypoint), **Final Fantasy XV** (the Regalia's Auto, with Ignis at the wheel) | A waypoint on the map, one button, and the ride goes there by road while the camera cuts between film shots; touching the controls gives it back at once. Auto and Manual as two ways to use one car, with the time to each place shown. | Their roads are empty enough to follow a line. Here the car is in the traffic: it queues, waits at the lights and gives way by the same rules as every other car, and its screen says what it is doing and why. |
| **Arcade racers** (Need for Speed, Burnout, Forza Horizon) | Handling for fun rather than a tyre model: speed-sensitive steering, grip of about 1 g that bends the car's path round to where it points, a handbrake drift, a view that widens with speed, and an engine note that climbs through the gears. | They are set on closed roads. Here you drive the real streets, among traffic that keeps to its lane. |
| **Ship Simulator Extremes** | Docking as the skill moment: the ferry runs on autopilot across open water, then you bring her alongside and are scored. | Reviewers found its long cruises boring. Here the open-water legs can be skipped, and docking is optional. |
| **Assassin's Creed Discovery Tour** | Guided learning by place: each stop is a person who explains what is in front of you, with "behind the data" honesty. | Its narration was called dry. Here the lines are short and come from the model, such as the share of Martin Place in sun on 21 June at 12:30, computed while you stand there. |
| **Mini Tokyo 3D** (MIT; three.js on a map) and **Densha de GO!** | From Mini Tokyo 3D: every train of a line drawn on its real track from a timetable, as a function of the clock. From Densha de GO!: the station as the place where the railway is felt, with its chime, its announcement and the melody before the doors close. Ideas only; no code or assets. | Mini Tokyo 3D draws trains as coloured boxes on a map seen from above. Here you stand on the platform: the cars have their doors and liveries, and you hear them pass. |
| **A Short Hike, Animal Crossing** | One-breath dialogue lines that you can finish with a tap, a voice beep pitched per character, and small tasks with small rewards (passport stamps). | Their worlds are invented. Here a favour is a fact about a real place. |
| **Assassin's Creed viewpoints** | Climb to a high point, and the camera turns once round you while the names fill in. | Its viewpoints reveal what designers placed there. Here what is named is what is in sight from that spot: a line of sight through the model to each roof, with the source of each height. |
| **GTA V character switch** | The fast-travel camera goes up, across the city and down onto the player, instead of cutting. | Its sky camera hides streaming. Here it keeps the city in one piece, and the cruise height clears the tallest roof on the route. |
| **Game Accessibility Guidelines, `prefers-reduced-motion`, app coach marks** | Camera moves that never spin or whip (a capped turn and pitch rate, a level horizon, no reversal), skippable at once, and a cut for players who ask for less motion. A first-run tour that points at one control at a time and can be skipped. | The arrival and the hops are measured frame by frame against those limits (`tools/arrival_shot.js`), and the tour runs once across every map rather than once per map. |
| **Genshin Impact, Breath of the Wild, Flight Simulator's world map** | Travel from the map at any time, to a named place or (Flight Simulator) to any spot you pick. | Their travel points are unlocked by finding them, and they drop you on a waypoint. Here every landmark is open from the start, as a sightseer would want, and you arrive placed to see it. |
| **Google Earth's fly-to** | Arriving framed on the place: back from it by its size, looking at it. | Its camera floats free. Here the arrival is a spot you can stand on, picked by a line of sight through the city's surface model and its trees, with the sun behind you. |
| **GeoGuessr** | A guess scored against the answer. | Here the answer has error bars and the score shows them. For an estimated height, a good eye can be as good as the data. |
| **Breath of the Wild** | After a short prologue, the main quests open together and can be done in any order. | Its quests end in invented places. Here each line ends in a fact about a real one. A step from one line completes while you follow another, because both are a position, a time or a sun angle in the same model. |
| **Ghost of Tsushima photo mode** | The world holds still, and you change the time of day and the lens. | Its light is art-directed. Here the sun for the time you choose is the computed one, and the saved picture's caption says when and how high it was. |
| **Bruno Simon's portfolio, slowroads, Streets GL** | Instanced crowds, cars and street furniture. Detail only near the player. A hint to lower the density when the frame rate drops. | Streets GL needs a discrete GPU. This runs on a phone, with lower density there. |
| **GTA V's scenario points, The Sims, Unreal's Smart Objects and Detour Crowd** | Benches as places to sit. Each has two seats that a passer-by claims, walks to, sits on and leaves, and each advertises what it offers. Walkers look a few seconds ahead and step aside for each other and for you. | Their people pick seats by script or by invented needs. Here they pick by the sun the model computes. At 12:30 on the winter solstice every sitter around Martin Place is on a sunny bench, though only 55% of the benches there are in sun. On a January afternoon, 92% of the benches are in sun but only 21% of the sitters. |
| **Persona 5** | A city told district by district, each a few streets drawn closely: Shibuya's crossing, a quiet residential neighbourhood, Shinjuku at night. A district's name comes up as you arrive. Passers-by talk among themselves and you catch a line as you pass. Things to examine with one button: a vending machine, a sign, a shop front. | Its Tokyo is renamed and redrawn. Here the names are the real ones and the streets are measured. The arrival card is drawn like Tokyo's own platform signs (駅名標), with the line's colour and the stations either side. The day in parts, the ranks and the calendar came later, learned from its design ([Daily life](#daily-life-the-day-the-diary-bonds-skills-and-jobs)): here the calendar is the real one, the clock is the real sun, nothing has a deadline, and the people are our own. No combat. Persona's characters and art are not used. |
| **Unreal Engine** | The CharacterMovementComponent's capsule sweep: slide along a wall, stop in a corner, push out of anything you start inside, step up what is low enough. The SpringArm's probe sphere for the camera. Re-written from the documentation, since the engine's code can't be copied into an open project. | Its collision is whatever the level designer built. Here it is the published footprints, so walking into a wall tests the open data. [docs/ENGINES.md](ENGINES.md) is the full study of what else to take from Unreal and other engines. |
| **Unreal's City Sample (Mass traffic and crowd), GTA V's road nodes** | Street furniture placed by rule from the road network, a set distance behind the kerb, and registered as obstacles the traffic and the crowd keep clear of; a lane that never lets a car move into another, and a place to wait off a busy berth or junction. Ideas only: no code or assets taken. | Their furniture is generated. Here it is mapped (OpenStreetMap's lamps, benches and trees), so it is moved only as far as it must be out of the road as the game draws it, and left out where no kerb is near (`web/streets.js`, `pipeline/kerbside.py`). |
| **Half-Life 2, The Last of Us, GTA V's enterable interiors** | Doors that open as you walk up to them, with no key to press, timed so they are open before you reach them; a room's name as you step in; seated people at their tables and in the pews. Ideas only: no code or assets taken. | Their rooms are designed. Here a room is the real one behind a real facade: St Peter's, Williams Cottage and the Skyline restaurant are drawn inside the shells measured from LiDAR, with their real doors and windows, and the restaurant's glass looks out over the lake as it is. |
| **Tesla FSD** (AI Day 2021 and 2022: the planning talks) | The planner run for every car round it, not only for itself: each car's way ahead is known and read by the others, and where two ways meet one asserts and the other yields, by the same rule read from both sides, rather than both reacting to what is in front of them. A car that can no longer stop goes; one in the junction goes before one coming. Ideas only (its software is proprietary). | It learns from fleet video; here every car's intent is exact (its route, its movement through the junction), so nothing has to be guessed from a camera. |
| **Baidu Apollo** (EM planner, Apache-2.0), **SUMO** (EPL-2.0), **A/B Street** (Apache-2.0), **Autonomous Intersection Management** (Dresner and Stone) | Apollo: another car's way projected onto your own as the stretch it blocks, and a go-first or yield decision on it. SUMO and A/B Street: keep the box clear (no car into a junction whose way across is blocked or whose exit has no room), and break a deadlock by someone backing off, never by driving through. AIM: a reservation for the way across, which `junctions.js` already makes. Re-written from the papers and documentation; no code taken. | They simulate traffic for planners to study. Here the same rules drive the taxi you are sitting in. |
| **Real traffic control and dispatch**: SCATS (Sydney), SCOOT (UK), Japan's UTMS/MODERATO and VICS, max-pressure control, Uber's and DiDi's dispatch | SCATS's and actuated signals' gap-out (already here); max-pressure: serve the phase whose queues are longest and not blocked beyond; VICS: congestion shared with every navigator, so a ride goes round a jam; the box-junction rule (the UK's rule 174, Japan's Road Traffic Act article 50): no car in without room beyond. Algorithms from the papers; the systems themselves are proprietary. | They run real cities from loop detectors; here every queue is known exactly, so the controller needs no detector model. |

## Daily life: the day, the diary, bonds, skills and jobs

Issue #357. Until this, the game was a place without a loop: quests gave stamps, and there was
no progression, no one to get to know, no calendar, no money and no reason to come back
tomorrow. The loop below is learned from daily-life games, Persona 5 first among them, and from
what works in a browser in a short session. Their designs were studied; nothing of their look,
characters, music or assets is used.

### What was studied, and what was adopted

| Game | How its loop works | Adopted here | Left out, and why |
|---|---|---|---|
| **Persona 5 / Royal** (Atlus) | A calendar whose days have slots, and nearly every choice spends one. Confidants deepen over ten ranks; each rank is a scene and unlocks an ability. They keep weekdays and weather (one is out only when it rains, others stay in). Five social stats with named levels, raised by daily acts, gate some ranks. Part-time jobs pay and raise stats. Rain is a bonus (more from studying), not a lock. One theme re-arranged for rain and night. The interface is treated as entertainment in itself: one key colour, lines that lead the eye, everything in motion. | The day in four slots (morning, daytime, evening, night). Bonds with ranks, each rank a short scene, a true fact about the street you stand on, and at set ranks an ability. People free at their own hours, on their own days, some only in the rain. Five skills with named levels that gate some ranks and jobs. Jobs that pay. Rain and night as bonuses. A score that changes with the hour and the weather. A card for the new day and motion in every menu, in this project's own type and its one accent (the sun's amber). | The deadline. Critics call its calendar the most stressful thing in it, with content missed for good, and its own mobile spin-off dropped the calendar. Here spending a slot is the player's choice ("pass the time"), nobody can be missed for good, and no day is ever lost. Ten ranks become five: a browser session is ten minutes, not a hundred hours. No combat, no arcana, none of its art, type or music. |
| **Yakuza / Like a Dragon** substories | Found by walking past them: a small zone, two people arguing. Tone is budgeted between comic and moving. Rewards are small and useful. | Requests and events start where you walk into them (a spot's prompt, a line in a bubble), not from a list. The diary lists them only after you have met them. Small, useful rewards: a discount, a key, a shortcut. | Their length and fights. |
| **Shenmue** | People and shops keep hours on a running clock. The first game left players standing about until an appointment; the second added a wait that skips to the hour, and jobs to fill the time. | Shops and people keep hours; the diary says who is about and when. "Pass the time" from the first day, and jobs are there to fill it. | A mandatory job. |
| **A Short Hike** | A tiny world where exploring pays with something unique each time, so the player is never "just travelling". | Each skill grows only the first time a thing is done in a place (a spot read, a line ridden, a dish tried), so going somewhere new always pays. | |
| **Alba: A Wildlife Adventure** | Photograph the island's animals to fill a book; an hour or two long. | The photo job: a list of real subjects to photograph, with more for the hour that suits each. | |
| **GeoGuessr** | A guess scored by distance from the truth. Players build real knowledge: the sun's side, the driving side, the street furniture. | The guide job: point the way to a landmark by its true bearing, scored by the angle you are off. The sun and the streets are the real ones, so the knowledge is real. (The height challenge already scored a guess against the data's own error.) | |
| **Pokémon GO, Ingress** | Stops at real places of note; a streak that restarts rather than breaks; weather and the hour change what appears; events on real dates, announced ahead. | Events at real places on their real dates, listed ahead in the diary ("in 5 days"). Weather and the hour change who is free. A count of days in each city that never resets and never breaks. | Streak pressure, and anything that asks for a location. |
| **Animal Crossing** | The real clock and calendar; shops with hours; events on real dates; people change the clock to escape waiting. | The game opens on the city's real date and hour, so its calendar is the real one. Changing the clock is in the menu and is no cheat: every event can be visited by setting its date. | Locking events to the device's clock. |
| **Wordle** | One small thing a day, the same for everyone, done in three minutes. | Today's page in the diary is the same for everyone in that city on that date: the same weather, the same events, the same people free. | |

Sources for the above are listed under [Sources](#sources) ("Daily life").

### The design in one page

- **Time gates what is on, never whether you may explore.** The streets, the ferries and the
  helicopter are open at every hour. The hour changes who is free to talk, which shops are open,
  which jobs are offered and what is on.
- **The calendar is the real one.** The game opens on the city's own date and hour. Events are
  at their real places on their real dates; the menu's date takes you to any of them.
- **A slot is spent by choice.** Time passes on the running clock (a day in 48 minutes at 30×),
  or at once with "pass the time" in the diary. Getting to know someone takes the rest of the
  slot.
- **Everything is a true thing about a real place.** A rank's scene carries a fact that can be
  checked; a job is a real bearing, a real distance, a real hour of light.
- **Short sessions.** Something finishes within ten minutes: a rank, a job, a dish, a page of
  the diary.

| The card for a new day | The diary's page for today |
|---|---|
| ![](images/life/day-card.jpg) | ![](images/life/diary-today.jpg) |
| **A rank earned (Kyoto)** | **The passport's skills, under the stamps** |
| ![](images/life/rank-up.jpg) | ![](images/life/passport.jpg) |
| **A job in hand: which way is the Imperial Palace?** | |
| ![](images/life/job.jpg) | |

| On a phone: the day's card | The people you know | The work on offer | A job in hand | A rank | Messages |
|---|---|---|---|---|---|
| ![](images/life/day-card-phone.jpg) | ![](images/life/people-phone.jpg) | ![](images/life/work-phone.jpg) | ![](images/life/job-phone.jpg) | ![](images/life/rank-up-phone.jpg) | ![](images/life/messages-phone.jpg) |

### The day and the diary

A day has four parts, set by the sun of the city's own date (`web/game/day.js`): **morning**
from half an hour before sunrise, **daytime** from 10:30, **evening** from golden hour and
**night** from the end of dusk. A card comes up for each new day (the weekday, the date, the
sun's arc from sunrise to sunset with the sun on it, the weather, what is on) and a smaller one
for each new part of it. The card never takes the controls.

The **diary** (<kbd>J</kbd>, or **Diary** beside Map and Passport) opens on today: the date,
the hour and the weather, your wallet, the four parts of the day with their hours, what is on
the calendar today and in the next three weeks, who is free to talk now, what work and which
counters are open, and **pass the time**: on to the start of any other part of the day,
tomorrow's if today's has gone. Its other pages are People, Work and Pages (what you did, day
by day). Each city counts your days in it; the count never resets.

### Bonds

A map's cast are people to get to know (`web/game/bonds.js`). Each has **five ranks**. When
someone is free (their own parts of the day, their weekdays, some only when it is dry or only
when it rains) and has nothing waiting on you, talking to them offers the time: "Spend the
evening with Aoi". The scene is two or three lines, a question, and one fact about the place
that goes into the diary. A good answer to the question means the hour did not slip by;
otherwise the clock moves on to the next part of the day. Between ranks they may ask something
of you (see where the river comes back up, guess a tower's height, photograph 109, run a
jacket across the scramble), and some ranks give an ability:

| Ability | What it does |
|---|---|
| `fare` | A share off every taxi and ride on that map |
| `tip` | A share more for every job |
| `job` | A job of theirs, in the diary under Work |
| `xp` | Points in a skill |
| `filter` | Night film: photographs after sunset come out tungsten-balanced, and the caption says so |

Quests always come first: a person who has a walk to give you gives it, whatever the hour.
Nobody is ever missed for good, and there is no deadline.

### The passport's skills

Five skills grow by what you do, most of all the first time you do a thing in a place
(`web/game/life.js`), and are drawn under the stamps in the passport:

| Skill | Grows by | Levels |
|---|---|---|
| **Eye** | the height challenge, by how close the guess | Rough guess · To the storey · To the metre · Plumb line · Surveyor's eye |
| **Bearings** | trig stations, spots read, stamps, pointing the way | Visitor · Finds the way · Knows the streets · Walking map · True north |
| **Light** | sun studies, photographs at golden or blue hour | Daylight · Reads the shade · Golden hour · Blue hour · Master of light |
| **Lines** | ferries, the funicular and the gondola, lifts, taxis and rides, each route the first time | Passenger · Commuter · Regular · Knows the timetable · Line captain |
| **Taste** | dishes tried at the counters | Curious · A second helping · Regular · Knows the counter · Local palate |

Skills and the wallet (one per currency) go with you from map to map; the people, the jobs and
the diary belong to each map. A skill's level gates a few ranks and jobs.

### Work, counters and the calendar

Jobs are taken from the diary's Work page, one at a time and once in each part of the day
(`web/game/jobs.js`). Each uses what the game already had:

- **Delivery:** from one real door to another against a clock, by any means. A taxi is quicker
  and costs its fare. On time pays in full, with time to spare a quarter more, late six tenths.
- **Cab fare:** in your own car: stop at the pick-up, drive your passenger where they say.
- **Show the way:** a visitor asks where a landmark is; turn to face its true bearing and
  press <kbd>E</kbd>. Within 8° pays in full, and the answer says how far off you were and how
  far away it is.
- **Photographs:** a list of real subjects to take in photo mode, a quarter more for each taken
  at golden or blue hour.

Money is in the city's own (yen, dollars). Taxis and rides now charge a fare on arrival (flag
fall and a rate a kilometre); short of it, the driver lets the rest go. **Counters** keep hours
and sell a dish or a keepsake, each with a line about it. The **calendar** is events at their
real places on their real dates, with the hours they run: walk up while one is on and
<kbd>E</kbd> joins it, and it is kept in the diary. Each event carries the source of its dates.

### The score

`web/game/music.js` composes the music in code with Web Audio: no recordings and nothing taken
from any game or artist. The owner's direction (9 November): soothing light music, close and
quiet like ASMR, so that playing is restful. So every voice is soft (felt piano, soft electric
keys, marimba and kalimba, a breathy flute, warm chorused pads, a sine bass), every attack is
slow, nothing is plucked or struck hard, and almost no energy is left above 4 kHz
(`tools/music_check.js` fails a case with more than 3%). A low room tone breathes under it, and
rain adds sparse soft drops.

| Part of the day | Tempo and mode (default palette) | By palette |
|---|---|---|
| Morning | 71 bpm, C lydian | Tokyo B flat major, Kyoto D yo, Sydney D lydian, Queenstown F lydian |
| Daytime | 75 bpm, G major | Tokyo F, Kyoto D yo, Sydney A, Queenstown C |
| Evening | 64 bpm, D dorian | Tokyo D minor, Kyoto D in, Sydney E mixolydian, Queenstown G dorian |
| Night | 54 bpm, A minor | Tokyo G minor, Kyoto D in, Sydney B dorian, Queenstown D minor |

Rain slows it by about 6%, closes the tone and drops the last of the percussion; a car adds a
soft pulse; a talk ducks it 5 dB; a calendar event lifts it a little. A change is taken up on
the next bar line and cross-fades over three or four bars. A new day, a rank, a job done and a
message each have a soft sting of two or three notes in the key that is playing. The game
tells it the state once a second (`life.js`); it starts with the game's sound, is silenced by
the Sound switch, and has its own **Music** volume in the menu (kept in the browser).
`OEMusic.bounce(seconds, states)` renders it offline for a film or a test.

### Fireworks

An event can put fireworks in the sky while it is on and the sun is down (`"fx": "fireworks"`,
`web/game/fx.js`): Sydney's New Year's Eve over the Harbour Bridge, Jingu Gaien's August
display on the Shinjuku map, Queenstown's New Year over the lake. One additive cloud of points,
nothing allocated after the first shell, nothing running when no such event is on.

### The walks of Tokyo and Kyoto, in lines

The Tokyo and Kyoto maps had their walks in one chain, or hardly any. They now run in lines as
Sydney's do (a welcome, lines side by side in any order, a report back):

- **Tokyo (Marunouchi-Ginza):** welcome (Haruka) → Marunouchi and the Palace (Kenji, Daichi,
  Sachiko) | Ginza and Yurakucho (Yui; a new walk under the arches with Ishikawa) | the water
  and the air (Ishikawa, Captain Aoki, Ren) → report back.
- **Kyoto:** welcome at the station (Haruka) → the temple and the low city (Sozen, Tanaka) |
  the market (Mrs Nakamura, ending at Nishiki's painted shutters after dark) | the castle and
  the winter sun (Ken, Yui) → report back.
- **Higashiyama:** the pagoda → the lanes | the temple → below the pagoda after dark.
- **Fushimi Inari:** the Romon → the gates | the mountain → the Romon after dark.
- **The Philosopher's Path:** welcome (Haruka) → the water (Kenji, under the aqueduct) | the
  incline (Sumire, under the Sanmon) → a last walk with Haruka.

Shibuya and Shinjuku already had theirs. Every live map now has a `life.json` as well: four
people to know (three on the two small Kyoto maps), four or five jobs, counters and a calendar.

### What is left

- Trains: a "catch the right train" job waits for trains that keep a timetable (the Enoden).
- The autopilot (issue #355) could drive a fare or a delivery; the jobs only set the waypoint.
- A forecast ability (tomorrow's weather in the diary) waits for the weather's forecast.
- A room or an album for keepsakes: they are listed in the passport, not shown.
- The people's models do not change place by the hour; their hours gate the talk, not where
  they stand.
- Not checked: a real GPU, Safari and iOS, and the music by ear on phone speakers.

### The phone

The phone (<kbd>N</kbd>) is the hub: beside the ride app it lists Messages, Diary, Work, Map
and Camera (`web/game/phone.js`). Messages come as a part of the day begins: someone you know
is free, something on the calendar has started, something is on tomorrow.

### How it is built

| File | What it holds |
|---|---|
| `web/game/life.js` | the save (`oe3d-life` in `localStorage`), the event bus (`life.emit`), the skills' rules, the wallet and fares |
| `web/game/day.js` | the parts of the day, the calendar, the cards, the diary and its pages |
| `web/game/bonds.js` | ranks, hours, requests, abilities, the People page |
| `web/game/jobs.js` | the four kinds of job, counters, events, the Work page, the passport's skills |
| `web/game/phone.js` | the phone's home rows and messages |
| `web/game/music.js` | the score |
| `web/game/fx.js` | fireworks for the calendar |
| `web/game/style.js`, `web/game/life.css` | the banner for a rank, a level and a job done; every style of the above |
| `cities/<id>/life.json` | a map's people, jobs, counters and calendar, written by hand |
| `pipeline/life.py` | checks it and writes `web/data/<id>/life.json` |

`game.js` only lends these the clock, the HUD and the player, tells them what happens
(`life.emit('guess' | 'survey' | 'spot' | 'stamp' | 'sun' | 'photo' | 'ride' | ...)`) and asks
what <kbd>E</kbd> does at a place of theirs. A map without a `life.json` still has the day, the
diary, the skills and the wallet.

**Writing a map's life.** Copy the shape of `cities/shibuya/life.json`. Places are never
measured: `{"npc": id}`, `{"spot": id}`, `{"travel": id}`, `{"label": "QFRONT"}`,
`{"wharf": id}`, `{"viewpoint": id}` or `{"lonlat": [lon, lat]}`, with `"d": [dx, dy]` to step aside; the game
stands each on the nearest firm ground. `python pipeline/life.py --city <id>` fails on a person
who is not one of the map's NPCs, fewer than five ranks, a rank without a fact, an event
without a source, a place outside the map, and any line that talks about the data
(`tools/voice_check.py`'s list). `tools/life_step.js` plays a day, a rank, a job, a dish, an
event and the save in `tools/game_check.js`; `tools/life_shot.js <city> <out> [WxH]` takes
stills of every screen.

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
    a 10 m cell. Along a quay (`web/quays.js`) the points just out in the water
    are raised to the quay's level and the water starts 0.15 m short of the
    wall's face as drawn, so a walker stops with the toes at the coping's edge
    (`tools/game_check.js` walks up to one in every city).
  - **Fine walking levels** (`patches`, a city's `game_patches`): levels every
    half metre where walls and steps are too sharp for the 5 m grid. Where a
    slab stands over the paving (Sydney's forecourt over the colonnade),
    `upper` holds the slab's level in a block of the grid and `clear_m` the
    room under it: the ground is the slab, and `nav.floorAt` offers the floor
    under it too, so a walker goes under or over; the camera stays under the
    slab when the walker is. A landmark can give low ceilings of its own along a line
    (`landmarks.json` "ceilings": `[{pts: [[x, y, z], ...], half_width, clear_m}]`, Fushimi Inari's
    torii tunnels): `nav.ceilingAt` keeps the camera `clear_m` over the line's height within
    `half_width` of it. `walks` names routes `tools/game_check.js` walks
    on foot ([[x, y], ...], `from_m`, `to_m`; `face: true` for a walk to a
    seawall's edge).
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
  - **Benches and street lamps:** from OpenStreetMap, moved out of the
    carriageways (`pipeline/kerbside.py`; `web/streets.js` does the same in the
    browser, for data built before). The trees in `places.json` too, once
    `game_data.py` has the roads (`python pipeline/kerbside.py --all --write`
    does it to the data as it stands). Many lamps are mapped as
    nodes of the road itself, and trees in kerb build-outs and medians. Each is
    moved to the nearest place clear of every road's band at its level (the
    road as the game draws it, grown to the outer side of a car pulled in at the
    kerb), or left out where none is within 6 m. Before this, Sydney had 60
    mapped lamps, 433 trees and 22 benches in a carriageway; Paris 720 lamps and
    1,947 trees; Amsterdam 470 lamps and 2,159 trees.
  - **Rail** (`game.rail`): the Overture rail lines of the configured classes,
    chained across the junctions where OpenStreetMap breaks them into through
    routes. A funicular's route runs from its lower end with its profile made
    monotonic (bridging the dips under its viaducts), and the piece left over
    beside it is its passing loop. A railway (`rail.train`, `pipeline/game_rail.py`)
    is the longest through route with the distance `s` measured along it: its
    passing loops (a second track whose two ends meet it), the stretches where the
    rails lie in a street (within 2.5 m of a road's centre line and 20° of its
    direction for 60 m), its stations (the config's, found by name among the mapped
    stations, each with the side and the ends of its mapped platform), its platforms
    (walkable strips in `surfaces`) and its level crossings: every point where a road
    or a path of the game's network crosses the line on the level, as `gated` (a
    road), `foot` (a path) or `street` (a side street meeting street-running rails).
    The line's level is the ground's, smoothed, on 16 cm of ballast and held to the
    road's level at each crossing.
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
    neighbouring cities named in the menu. You arrive at a travel point facing its `look`
    `[x, y]` (`game.travel` in `city.json`: the Senbon Torii's mouths), or else the nearest
    landmark's label within 200 m, not wherever you last faced.
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
- **A railway** (`rail.train`, the first on a Japanese map: the Enoden at
  [Kamakura](cities/kamakura.md)). One track, trains both ways, passing in the
  loops.
  - **The timetable is a function of the railway's clock.** A run of each
    direction is integrated once from the speed limits (the line's 45 km/h, 15 km/h
    in the street, 25 km/h through the points, and each curve's: 0.65 m/s² sideways,
    which is 15 km/h on the Enoden's 28 m curves) and the stops; every train is
    that run shifted by the headway, and the two directions' runs are set against
    each other so that they are in each loop together, each waiting for the other
    as on the real line. A crossing's alarm, the next arrival at a platform and the
    trains themselves all follow from the clock. So the clock can be run eight
    times as fast (waiting on a platform: E, "wait for it"; aboard: F), slowed to a
    stand (someone or a car on the rails ahead of a train in the street: on a single
    track, when one train is late they all are) or set (`rail.cue`, for a film or a
    photo spot's arrival) and no two trains can meet outside a loop.
    `tools/game_check.js` counts the meets of two headways and where they happen.
  - **The trains** are two-car articulated sets coupled in twos (`sets`), of the
    series the city names (`series`). Each body is placed from the set's shared
    bogie to its own, so a set bends in the middle through a curve. The bodies are
    `assets/vehicles/trains.glb` (`blender/build_trains.py`, below); until it has
    loaded, and where it does not, a kit-built body stands in.
  - **Riding**: on a platform the prompt gives the next train's time and offers to
    wait for it; with a train in, E boards it. V goes from the chase view to the
    window seat on the side the city names (`scenic_bearing_deg`: the sea) and to
    the cab behind the driver; drag to look round. E gets you off at any station
    onto its platform; at the last station on the map the train puts you off as its
    doors close, because it runs on past the frame. A quest's `rail` step
    (`{from, to}`, station ids) is a ride.
  - **Level crossings.** A gated crossing has, on each approach, a post on the left
    of the road (Japan keeps left) with the cross (two boards 1.2 × 0.18 m at 75°),
    two red lamps flashing in turn 50 times a minute, the speaker, and a barrier arm
    in yellow and black across the road, 0.8 m up when down; a path's crossing has
    the post alone. The alarm starts 26 s before the train's nose is at the crossing,
    the arms start down 7 s later and take 6 s (the ministry's standard is 15 s from
    alarm to arm down and 20 s more to the train; these are the minimums, to keep a
    game's wait short), and they rise 1.5 s after the tail is clear. The bell is the
    electronic one: 700 and 750 Hz together, 130 strokes a minute
    (`web/game/audio.js` `kan`), by the clock, so every crossing strikes together.
  - **Who waits.** The crowd walks up to 0.7 m short of the gates and waits there
    (`rail.gateAhead`, the crowd's `gate` hook in `web/game/actors.js`); someone
    between the gates when the alarm starts walks on out. On foot an arm holds you
    back, and a train pushes you off the rails as a car does. The traffic is given
    each body of a train, and each closed crossing as a bar across the road once no
    car is between its gates (`cars.extra`), so it queues at the gates and behind a
    train in the street. What the driving code reads directly:
    `rail.crossings` (`{id, x, y, z, h, half_m, width_m, kind, closed, arm, t}`:
    `closed` from the first stroke of the bell until the arms are up again),
    `rail.crossingClosed(x, y, r)` and `rail.trainBoxes()`.
  - **The line** is drawn from the same data: rails, sleepers and ballast on open
    track and rails alone in a street, the contact wire 4.9 m over the rails hung
    from a pole every 36 m on the side away from the platform, and each platform
    with its end ramps, yellow line and a shelter.
- **Trains** (`web/game/trains.js`): a main line's trains past its station, on the tracks
  `game.json` "trains" carries (Tokyo's through Yurakucho and Shimbashi, `cities/tokyo/rail.py`; Sydney's City
  Circle through Circular Quay, `cities/sydney/rail.py`; both built with `pipeline/railkit.py`).
  A station's `style` picks its announcements: JR East's in Japanese and English, or Sydney
  Trains' in English.
  - A service is a stock, a number of cars, a headway and an offset; a train's place is a
    function of the time alone (cruise, brake at 0.9 m/s², stand, pull away at each of its halts),
    so there is no state to keep and a harness can ask where any train is at any second.
  - A track's halts are its `stops` (`{station, m, platform, side, psd}`: the station's id, where a
    train's middle rests, the platform's number, +1 when the platform is on the train's left, and the
    platform doors' leaves, `{off, u}`: the doors' line off the track and each door's middle along
    it); `stations` lists the stations (`{id, name, native, at, hear_m, r}`). The first pass's one
    `station` and a track's `stop_m` and `platform` still read as one halt. A service's `stop_at`
    names the stations it stops at, where not all of its track's.
  - **Doors.** A standing train's doors on the platform's side open a second after it stops and
    close before it pulls away (the lit doorway drawn over the closed door, instanced); the platform
    doors' two leaves slide apart behind the cabinets with them.
  - **Riding** (`api.ride`): where the city has no `rail.js` line, the game boards and rides these
    trains through rail.js's interface (`cars`, `stations`, `stationOf`, `towards`, `nextStop`,
    `eta`, `departsIn`, `riderPos`, `alightAt`, `events`): a car is a whole train standing at a
    station with another station ahead of it on the map; you stand in its third car by the doors.
    A station on a viaduct (`deck`) is only its platforms' level, not the street under it.
    `tools/trains_step.js` rides one stop and checks the doors open.
  - The cars ride on their two bogies along the course and are instanced, one draw call per
    material of each kind of car. They are drawn only between the sheds' mouths at the ends
    (`hide_m`).
  - The commuter cars (E233 and E235) and Sydney's Waratah are modelled in Blender
    (`blender/build_railstock.py` -> `web/assets/vehicles/railstock.glb`): a real cross-section
    with widened sides, windows and doors set back in the skin, a cab face raked back with its
    black glazed mask wrapped round the corners, headlamp clusters, a snowplough skirt and a
    tight-lock coupler, bolsterless bogies with coil springs, air springs, motors and brake
    units, underfloor equipment, the air conditioners and a single-arm pantograph on its
    insulators. Occlusion is baked into the vertex colours; a decimated copy is drawn beyond
    60 to 85 m (40 m on the low tier). One model serves every line: the surfaces that take a
    line's colour (`Door`, `Band`, `Band2`, `Top`, `Face`) are painted from the stock in
    `STOCK`. Until the file has come, or where it cannot, the cars are box models drawn in code.
    The high-speed train is still drawn in code.
  - The windows show the saloon by interior mapping: each pixel of the glass follows the ray
    from the eye into a box the size of the car's inside and shades the floor, the ceiling
    and its lamps, the bench seats and far windows, and the adverts over them; dim behind the
    reflections by day, the carriage's own light after dark. A double-decker has two decks.
  - Sound (`audio.js`): the three nearest trains have a voice each (rumble, rail joints,
    motors, a Shinkansen's air), panned left or right of the camera. Within the station's
    hearing the platform plays its chime, announcement, door chime and departure melody. The
    words are spoken by `speechSynthesis` where the browser has a voice for the language, and
    always captioned (`#g-announce`). Nothing sounds between trains.
  - A strip the data knows nothing of (a platform, its stairs) is marked `"mapped": false`:
    `decks.js` then leaves the mapped footways that pass under it on the ground.
  - Check: `xvfb-run -a node tools/trains_check.js tokyo` (or `sydney`) (the step `tools/game_check.js`
    runs, on its own).
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
  - **Strips meet their banks:** a deck drawn from a mapped outline (an
    Amsterdam canal bridge) can end a metre or four short of the quay the 5 m
    water mask draws, or below the ground where the bank rises to it. Each end
    over the water is carried on along the axis to the first firm ground within
    12 m, no steeper than 1 in 4, and drawn there in the deck's stone; where the
    ground under a deck stands up to a step above it, the deck is raised to it,
    so a walker there is on the deck (Torensluis). The Magere Brug, Leidsebrug,
    Halvemaansbrug, Brug 72 and Torensluis are crossed down their middles.
  - **Covered walkways are canopies** (`pipeline/arcades.py`): an arcade over a
    pavement comes in the open data as a long thin building from the ground
    (Kyoto's Shijo, Kawaramachi and Shinkyogoku arcades, Osaka's shotengai). A
    footprint at most 6 m wide on average (5 m left out Osaka's main arcades,
    Shinsaibashi-suji, Ebisubashi-suji and Sennichimae, whose footprints take in
    the wider squares where two covered streets cross), with a mapped footway inside along
    most of its length, mapped as a roof or an unnamed PLATEAU footprint no
    taller than 20 m, starts a quarter of its height (0.5-3 m) under its top,
    and is drawn without windows and with an underside. Walled in by them, the
    blocks between Shijo, Kawaramachi, Sanjo and Shinkyogoku had no way in; 24
    in Kyoto, 86 in Osaka, 55 in Shibuya, 20 in Tokyo and a few elsewhere are
    canopies now.
  - **Roofs on posts** (`pipeline/arcades.py`, #245 and #246): every other
    OpenStreetMap `building=roof` (a park's shelter, a station's or a petrol
    station's canopy, a shrine's open pavilion) stands on posts, unless it lies
    inside a taller building. Each run then finishes the roofs on posts and the
    gates, on what an earlier run opened:
    - **Colour.** OSM `building:colour` when mapped; else the precinct's palette
      (`city.json` `roofs.palette`, by precinct name: Kiyomizu-dera is a temple,
      but its gates and pavilions are vermilion); else a shrine's vermilion
      (`#c4482a`, the torii models' `torii_shu`) in a Shinto precinct or on a
      `building=shrine`, a temple's aged timber (`#6a5444`) in a Buddhist one or
      on a `building=temple`. Bicycle stands, smoking shelters and the like stay
      painted steel. The tags and the precincts (`amenity=place_of_worship`,
      `landuse=religious`, with their religion) come from the OpenStreetMap API
      by `pipeline/roof_osm.py` into `cities/<id>/roofs_osm.json` (ODbL); the
      Overpass mirrors refuse this environment. Higashiyama: Kiyomizu's Nio-mon,
      West Gate and bell tower and Yasaka's pavilions vermilion, Kennin-ji's and
      Chion-in's gates timber; Fushimi Inari's halls vermilion; Shinjuku's
      Hanazono-jinja; the Philosopher's Path's 120 roofs in temple precincts timber.
    - **Height.** A pavilion under 400 m² whose top is PLATEAU's, a lidar's or a
      guess (all of which take a tree over a small roof as its top) is no taller
      than its kind stands over the highest ground under it: a bell tower
      4.5 m + 0.6 m per metre of the square root of its area, a font's pavilion
      3 m + 0.4, a dance stage or votive hall 4.5 m + 0.45, anything else
      4 m + 0.5. A pitched roof drops with it, whole while its eaves stay at least
      55% of the way up, shallower when they would not. Higashiyama's bell
      towers stood 15-21 m tall over 16-25 m² and stand 7-9 m; Shinjuku's
      shrine fonts stood 18.5 m. Gates keep their measured tops.
    - **Inner posts.** A roof over 400 m² stands on rows of posts inside its
      outline too (`buildings.json` `inner_posts`, by building, which
      `web/buildings.js` draws and `web/game/nav.js` walks round): one row down
      the middle of a canopy narrower than 24 m (a platform's, a bus stand's),
      else rows every 10 m across, at 10 m along; 1.5 m inside the edge, 4 m off
      a road's centre line, 1.2 m off a footway and not inside another building.
      Tokyo Station's 5,000 m² platform canopies have 24-36 each.
    - **Closed roofs.** A roof the city names (`city.json` `roofs.closed`) is a
      building again: Shinjuku's Sumitomo Triangle Plaza (r11664668) is a glass
      atrium closed on every side, opened in 2020 between the Sumitomo Building's
      wings, and stands as glass from the ground. Its roof (#258, against a
      photograph from above: Akonnchiroll, CC BY-SA 4.0, compared) is faceted
      glass rising from eaves at 4.5 m to its top by the tower, each corner of
      its outline as high as it is near the tower; the tower's own low PLATEAU
      solids, which PLATEAU files with the tower, are the atrium's other wings
      (`roofs.atrium_parts`).
    - **Glazed roofs.** A roof the city names as glazed (`roofs.glazed`) is glass
      spanning between the buildings either side, with no posts under it: the
      Opera City Galleria's roof (w787547154, 186 × 13 m at 26 m between the New
      National Theatre and Opera City Tower), which had stood on a row of posts
      down the walkway.
    - **Pitched roofs on pavilions** (#258). A pavilion under 900 m² drawn as a
      flat slab takes its mapped `roof:shape` (with `roof:material` and
      `roof:colour`), or, in a temple's or a shrine's precinct or on a temple or
      a shrine, a hipped roof of grey kawara (a hip-and-gable's nearest), its
      eaves at least 2.4 m up and its fascia lowered under them. Yasaka-jinja's
      Buden (w105449709), which a photograph shows under dark grey tiles, and
      140 others across the live cities (Shibuya waits for the overture
      session).
    - **Low structures.** A building under 2.6 m with no name or class (a vent's
      or a stair's cover, a shed, a kiosk's back) and a subway entrance's cover
      under 4.5 m are drawn plain, without a storey of windows (Marunouchi's
      solid 18776, a 2.4 m block beside Tokyo Station's M8 exit, and the exit
      itself).

    ![Roofs on posts at day, dusk and night: Yasaka's dance stage, a bell tower in Higashiyama, Tokyo Station's platform canopies, Shinjuku's Triangle Plaza closed in glass, Kyoto Station's bus stands](images/roofs/open-roofs.jpg)
    ![On a phone](images/roofs/phone.jpg)
    ![Yasaka-jinja's Buden: a photograph (Jakub Hałun, CC BY 4.0) and its pitched roof now (#258)](images/roofs/buden.jpg)
    ![The Sumitomo Triangle Plaza's sloping glass, day and dusk (#258)](images/roofs/sumitomo-atrium.jpg)
    ![The Opera City Galleria's glazed roof, day, dusk and night (#258)](images/roofs/galleria.jpg)
  - **Precinct walls are walls** (`pipeline/walls.py`): the earthen walls round
    the Kyoto Gosho and the Sento Gosho come in the open data as buildings 3 m
    wide and hundreds of metres long, with a height estimated from the houses
    nearby (8.7 m), and were drawn as office blocks. They are 4.5 m walls with a
    tiled coping and the Gosho's five white lines now, and still walls to a
    walker: the way in is by the gates `arcades.py` opens. 12 in Kyoto (with
    Sanjusangen-do's Taiko-bei), 3 in Shibuya (Meiji Jingu), 2 in Osaka and one
    each in Tokyo, Sydney, Melbourne and Amsterdam.
  - **Wharves:** each wharf has a landing, the nearest place on foot to its
    terminal. You board from there where the mapped terminal is out on the
    water (Circular Quay's wharves, Central Pier 7).
  - **Bridges and viaducts** (`web/game/decks.js`): a mapped footway or road
    that crosses the water, or runs more than 2.5 m above the ground drawn
    under it, is on a deck.
    - The deck is drawn as a concrete slab with parapets, with columns under
      the high spans. An expressway is mapped over the road it follows (Shuto
      Route 3 over Route 246), so a column under its middle would stand in that
      road's lanes: each column in a carriageway, at any level it passes
      (`OEDecks.clearColumns`, against streets.js's carriageways), moves across
      under the deck to a clear spot (a median) as a slim pier, or becomes a
      portal, a leg each side clear of the roads and a cap beam over the road
      with 4.7 m under it, or is left out. Columns, signal poles and walk-signal
      posts are solid (the posts), like lamp posts and trunks.
    - A road dipping into the ground beside a deck (a rail cutting under the
      street) is carried over it on the deck, and a road's deck is graded
      smoothly, so a car on it doesn't bob over the survey's heights.
    - A bridge over the water is laid between its banks, slightly crowned. The
      data lifts a bridge one level (6 m), which over a canal is a hump in the
      air. Where a ferry's course passes under it, the span rises to clear the
      boats.
    - Viaducts (an expressway, several levels up) keep their mapped height.
      Stubs that end over the water at nothing are cut back to the bank.
    - Under a deck over the water the aerial photograph has the same bridge or
      expressway, draped on the modelled bottom, and it showed through the
      water as a road on the riverbed (Tokyo's Nihonbashi under the Shuto,
      Osaka's Higashi-Yokobori under the Hanshin loop). `game.js` draws the
      decks over the water into a mask, a little wider than each deck and more
      so the higher it stands (a photograph leans a raised deck off its plan),
      and the water closes over the bottom there (`water.js` `setCover`). The
      viewer, which draws no decks, keeps the photograph as the bridge (issue 65).
    - A deck the data's levels make climb steeper than 1 in 3.3 (outside
      steps) is graded evenly from end to end; a line along a strip that the
      data puts up to 4 m past its edge, far below it, is on the strip's level
      beside it. Together these join the Harbour Bridge cycleway: mapped a metre
      outside the deck, its approach was given the ground's height plus a level
      and dropped 30 m in 23 m off the deck; it now runs from the deck down to
      its north end at Milsons Point.
    - The crowd and the traffic keep to the decks, the sun meter sees their
      shade, and you can walk them (but not the expressways). The traffic's
      router (route.js) looks for a car's floor along each road, which takes the
      expressways' decks (`nav.floorAt(x, y, z, true)`), at the height the car
      drives at: on a deck the line's, on the ground the ground's, since a hill
      road's straight line between two of its points cuts under the brow of the
      hill. Before (issue #119) it looked for a walker's floor at the line's
      height, so it kept the traffic off the whole Shuto and Hanshin
      expressways and Hong Kong's hill roads, though their decks were built and
      drawn. Road pieces the traffic keeps off, before and after: Osaka 139 to
      15, Tokyo 79 to 6, Hong Kong 47 to 4 (`tools/road_walls.js`); none is left
      with no floor at its height (`tools/deck_gaps.js` lists any, with the decks
      at each spot and why). A main road whose second lane runs into a solid
      between its junctions (a tower beside an expressway's deck: Sydney's
      Cahill Expressway passes one at 33 m) has one lane there, so no car waits
      at the facade for room in the first (game.js; Sydney 11 pieces, Hong Kong
      17, Tokyo 30, Osaka 42). In Osaka this is
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
    Where a walker meets them, up to 3.5 m over the floor below, the collision world
    has them in 0.25 m cells instead (`landmarkCells` in `nav.js`): each cell's
    heights split where there is 0.4 m of room between them, 0.1 m added above and
    below, and the cells merged into rectangles along rows and then down columns.
    In 2 m cells, per material, a 0.5 m lantern or a 4.2 m ema rack stood as a box
    up to 4 m across and the rack's roof came down to head height (issue #91). Each
    triangle is sampled in rows along its longest edge, every 0.22 m, so a long thin
    one costs its area; a flat top only round its edges, since its sides are
    triangles of their own. What lies under a walkable strip (the stone of a flight
    of steps) is the strip's slab and is left out. The fine cells are laid tile by
    tile (32 m), the first time a query touches a tile or a few milliseconds a frame
    ahead of the walker or the car (`nav.prefetch`).
  - **Start-up sweeps:** at the start the game looks over the whole city for where
    trees, lamps, poles and benches can stand, which stretches of footway the crowd
    keeps to and where roads are cut at walls (`nav.withoutFine`). Away from the
    landmarks that needs only the 2 m surface model. Where a landmark's 2 m cell
    says a sweep is stopped, the triangles its fine cells are laid from are asked
    again: whether any comes within the radius between knee and head, with the
    fine cells' margins. So a crowd's way through a gate's passage or between
    lanterns is kept where a walker gets through (issue #141). Laying the fine
    cells of every tile the sweeps meet cost 1.8 s more at Kyoto's start and
    1.0 s at Paris's; reading the triangles costs about 30 ms.
  - **Landmark floors:** a landmark's flat top within a step of the ground is a
    floor when it covers 2 m² and reaches a fine cell round each of its cells. A
    material that says `"floor": false` is never one, however wide its top (a
    wide, low offering box).
  - **No-go areas:** walkers are stopped at the edge of a colony's rocks, with
    the city's note. A boardwalk across them stays walkable. A landmark's own
    water that the city's water leaves out (Higashi Honganji's moat in Kyoto) is
    `keep_off` in `game.json`: rings at half a metre, where a walker on the
    ground stops without a word; its bridges are left out of them, and the
    crowd's footways that cross them are dropped (`pipeline/game_extras.py`).
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
  - **Lamp posts and tree trunks** are solid (`OEStreets.posts`, circles in an
    8 m grid): you walk round them, your car hits them ("Careful! That was a
    lamp post."), the crowd steps round them and the traffic brakes for one in
    its way.
  - **What can move gives way to what can't:** a car's body is pushed out of
    the other cars and the people first, then the walls, and the posts and
    trunks last, and a car that shoves you on foot is followed by a push out of
    the posts. The last push is the one that holds, so a traffic car pressing in
    can't drive yours, or you, into a trunk (#96). A move that would leave the
    car where it can't stand (a drop, the water's edge) is refused whole, the
    heading with it, so it can't turn on the spot into a trunk either.
    `tools/clip_check.js` presses
    a car's box into yours, nose to a trunk, at five offsets and three angles.
  - **Measured against the old 2 m grid:** 120 walks into walls at random
    angles ended inside a footprint 50 times before and never now. The closest
    approach is now the capsule radius. See
    [ENGINES.md](ENGINES.md#1-movement-and-collision-built).
- **People** (`web/game/people.js`, assets from `pipeline/fetch_people.py`):
  - **Characters:** 13 rigged characters from Quaternius's Ultimate Modular Men
    and Women packs (CC0): office workers, a suit, a hoodie, beachwear,
    hikers, hi-vis workers. They have realistic proportions and 5,000–10,000
    triangles each, and make up the crowd. The surveyors and the NPCs are
    Rocketbox avatars ([The main characters](#the-main-characters),
    [The NPCs](#the-npcs)).
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
    - You never step aside for them, so a walker with you on its course goes round you
      at once, a body's width clear where the footway allows, else sidling past shoulder
      to shoulder; where there is no room at all (you in the middle of a torii tunnel
      1.5 m wide) it turns back within a second, and whoever comes on behind it turns too.
      Before, it stood in front of you for up to 13 s before it turned
      (`tools/crowd_yield.js`: you stood on a footway, walkers sent at you along it).
    - The NPCs you talk to stand as posts: the crowd walks round them, not through them.
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
  - **Driving:** they keep to the city's side, drive a one-way street only its
    way, brake for the cars ahead and for the player, and keep bumper-to-bumper
    gaps, so a bus queues its full length back. A car looks ahead along its own
    lane, round the bend and across the junction it is taking (points every
    1.5 m, 3 m far from the camera), not along a straight line from its bonnet,
    so a car waiting in the oncoming lane round a corner doesn't stop it. Where
    two cars come into each other's way, the one already in the junction, or
    nearer the point where their ways meet, goes first.
  - **Junctions** (`web/game/junctions.js`): see [Junctions and traffic
    lights](#junctions-and-traffic-lights).
  - **Unsticking:** a car waiting on someone standing in the road edges up to
    them (never into them) after a few seconds and the walker turns back, and a
    walker a car has come up against, or who has stepped up against a standing
    car, takes a step out of its footprint; a car waiting at its line
    that a bus can't swing past backs off a metre; a car in a junction stopped
    behind one waiting at another of its lines asks it to back off, and after
    8 s goes on as if it weren't there. A step taken back because it would
    have gone deeper into another car counts as held by that car (#144: it
    was taken back unseen, the time never counted, and a car on its way out of
    a junction against the nose of one waiting at another arm's line, which
    waited for that very movement, stood for good, holding the junction and
    its queues through green after green). A car held 3 s by another that is
    stopped too has one of them give way and back off a metre or two: the one
    not in the junction for the one in it, of two in it the one that went in
    later (of two that went in the same second, side by side from one arm, the
    later in the traffic's list; never one at the very start of its piece, with no
    room behind it to back into: then the other). Two in a junction stopped nose to nose, each
    the car ahead of the other (their ways cross and each path sees the other),
    wait 4 s, and then the one that can't back off (or else the one that went in
    first) goes on as if the other
    weren't there, and if the other can't back off for the queue behind it, squeezes
    past it after 20 s. A car held more than 10 s by a lamp post or a trunk on its
    way edges past it (Asakusa had one stand ten minutes in a junction). A car that can't back off because a stopped car is behind it asks
    that one to back off first, so a short queue makes room (each car backs off
    at most 6 s before it has moved on again). Two still held for 15 s (10 s in
    a junction, 25 s by one that only inches along): out of view, behind the
    camera or more than 200 m off, the held one leaves the traffic and comes
    back elsewhere; in view they wait, and only after 90 s squeeze past each
    other. A car held 1.5 s part way across to another lane goes back to its
    own; and out of sight, a car stopped 45 s that is not in a queue comes back
    elsewhere.
  - **Never through anything:** a car never moves into another car, your car,
    a ride, a person, an NPC, a lamp post or a trunk; it waits, and turns round
    if the way stays blocked (but for the squeeze past, under Unsticking). One caught up with another gets out without going
    into a third; two still caught after 4 s part (out of sight, one leaves the
    traffic). A ride and the traffic see each other along their ways and give way by one rule
    (see [How the drivers see and give way](#how-the-drivers-see-and-give-way)); the ride's
    driver never steps further into a car of the traffic in your sight and swings out round a
    stopped car only when nothing is coming the other way. None is put on the road on top of your car or a ride, and your
    car is brought to a kerb clear of the traffic, the posts and the trees.
    Your car meets another as a box against a box, corners included. The crowd
    keeps out of your car and a ride as it does the traffic's.
  - **The autopilot is that driver in your own car** (`autopilot.js`, `game.js`
    `pilotTo`, `pilotStep`). A route from the piece of road the car is on, the way it
    faces, to the kerb nearest the place (`cars.js` router). The scenic way is the same
    search with each piece of road's cost weighted (`autopilot.js scenic`): 0.42 where
    water lies within 100 m of it, 0.55 within 70 m of a landmark; it is taken where it
    is no more than twice as far and does run more by the water. Parked at the kerb
    where the route starts, the car pulls out as a taxi does. Anywhere else it is first
    driven onto the lane through its own pedals, by pure pursuit of a point 5 m and a
    second ahead (`autopilot.js join`, Coulter 1992), at 4 m/s and stopping for
    anything in front; within 1.2 m and 0.45 rad of the lane the driver takes it, and
    the last of the offset is eased out over a second. From then on the car is carried
    along the driver's line (`cars.js drive.follow`), its own state kept up to date, so
    that the wheel handed back finds it moving as it was. The driver is the ride's
    (`game.js driverStep`: the way round a jam, the three-point turn, backing off for a
    car that waits on it), in a strict mode (`cars.js chauffeur`, `strict`): its guard
    against stepping into a car reads its body as it is turned as well as along its
    way, and by any step at all, so that creeping out of a tangle it never clips a car
    on a bend. The traffic reads it as it reads a ride with you in it (its way ahead,
    its way across a junction), under its own name. It asks for no green ahead: it
    waits at lights as you would. The next turn is read from the route
    (`autopilot.js turns`: the heading 12 m after each junction against 12 m before;
    0.42 rad is a turn, 2.5 a U-turn). The film is six shots on the chase camera's own
    rig, so it stays out of walls as that does (`autopilot.js film`); with reduced
    motion the shots hold still and there is no orbit.
  - **A ride drives like a car** (`cars.js` path, chauffeur): its route is taken
    as a curve, the points averaged over a few metres (more the further it is
    held off the line), so the heading turns smoothly and always faces the way
    it moves; on the inside of a hairpin it keeps within the turn's radius, and
    it covers its speed along its own lane, not the line's. Its heading turns no
    faster than a 4.5 m turning circle allows, its height is averaged over 4 m
    either side, and it eases across the road (to the kerb, out round a stopped
    car) at a rate that grows with its speed and eases in as it gets there. A
    stopped car it has begun to swing out round stays one while it stands
    there, so it doesn't swing in and out from frame to frame. The router takes
    a U-turn (at a junction, or at the end of the street it sets out on) only
    where going round the block is over 400 m longer, and the driver makes one
    as a loop across the road ahead of the turning point, not a turn on the spot.
    A ride stuck in a queue on the piece of road it is on (where no other way
    round starts) turns round in the road once the car in front hasn't moved
    for 20 s, on a two-way street with nothing coming: a three-point turn
    (forward across on full lock, back on the other lock, forward into the far
    lane; a 5 m turning radius), with a short straight back first where the
    car in front is close, each pose tried first against the traffic, your car
    and the kerbs. A queue held at a red or a scramble's walk is waited out.
  - **Streets kept to the vehicles that fit them (#202):** at the start each
    street of a lane each way or narrower is measured every 3 m for the widest
    body its lane has room for (in its lane, half way in, or in the middle, as
    a car between two facades edges in). A vehicle wider than that isn't put
    on it and doesn't turn into it when there is another way; a street with
    room for no vehicle is one a car can't get along, as a road the data runs
    through a building is.
  - **The crowd and the walls:** a footway that runs into a building (an arcade,
    a station's concourse; the model's buildings are solid) ends at its wall,
    and a walker stepping aside keeps in from a wall beside the footway. Before
    this, about one walker in nine in Sydney's centre was inside a building.
  - **After dark:** headlights, tail lights and the taxis' roof signs light up.

#### How the drivers see and give way

Before, a ride's driver judged the cars round it by where their centres were across from its
lane, along a straight line from its bonnet, and the traffic saw a ride only along a straight
line from its own. A car turning across the ride, or one the ride came round a corner to, was
seen late or not at all; the traffic didn't hold back for a ride on the move at all, leaving it
to the ride's driver. Two would end nose to nose, each waiting for the other, and after a few
seconds one drove through the other. In Shibuya (`tools/ride_overlap.js`, two runs of eight trips
from the scramble) a ride went into a car of the traffic 9 times in 4,400 s, up to 2.3 m deep,
once head on down a one-way street, and 10 of the 16 trips hadn't arrived after five minutes. The planners of self-driving cars do it another
way (Tesla's interaction search, Apollo's ST graph: see [the table above](#what-we-took-from-other-games-and-where-this-one-is-different)):
every car's intent is read by the others, and where two ways meet one goes and the other
yields. In this game every car's intent is exact, so:

- **Each car looks along its way.** The traffic's cars already did (points every 1.5 m from the
  bumper, round the corner and across the junction); a ride's driver now does too
  (`cars.js` `look`, `crossGap`), and publishes that way (`st.ps`) for the traffic to read. A
  car at an angle is caught by its box, not its centre.
- **One rule for who goes first, read from both sides** (`actors.js` `first`, given to the
  ride's driver as `junctions.first`): where each one's way runs into the other, the one that
  can no longer stop (braking at 4 m/s²) goes; then the one already in the junction (of two in
  it, the one in first); then the one nearer the place; at a dead heat, a ride before the
  traffic. The one that goes isn't braked for; the other stops short of it. The traffic reads a
  ride with you in it as one of its own (its way, its movement, its line, stopped or moving) and
  never steps into it. A ride on its way to you is left to its own driver as before ("soft": the
  traffic doesn't wait on it, and wedged a second it goes on at a crawl), so that it comes within
  the half minute in Tokyo's tangled streets; held to the rule, it stood two minutes in a knot of
  cars giving way to each other in Shinjuku's game check.
- **Keep the box clear.** A car of the traffic doesn't go into a junction whose way across is
  blocked by a ride or your car standing there, or by a car waiting at another of its lines with
  its nose in the way (after 3 s that one is asked to back off a metre or two; after 12 s the car
  goes in all the same, so a busy arm never shuts a movement out). A ride's driver waits at the
  line for room beyond the junction, as the traffic does (`junctions.room`).
- **Back off, never through.** Nose to nose with a car that waits on it in turn, a ride's driver
  backs off a metre or two along its way if the road behind is clear, else asks that car to
  (`junctions.makeWay`); wedged against one that won't move off, it asks again every 2 s, and only
  after 20 s (a knot nothing undoes, neither able to back off) goes on at a crawl. A ride stopped
  for a moment on its way still counts as on the move to the traffic, so both read the same rule. It no longer creeps into a car at an
  angle to it after 8 s.
- **Brake early and gently.** The traffic's speed was a limit read off the gap ahead, so a car
  kept its speed until the last metres and then braked at up to 8 m/s². The Intelligent Driver
  Model's interaction term (Treiber, Hennecke and Helbing 2000: the gap a driver wants grows with
  its speed and with how fast it closes) is now a second limit, for the traffic (`actors.js`
  `idm`: stopping 2.6 m short, a 0.8 s time gap, 2.5 m/s² to pull away, 3 m/s² to brake): a car
  starts to brake for a queue or a red seen 40 m off. (A ride's driver keeps the old limit alone:
  with the model it crept up a stop-and-go queue more slowly, was held long enough to read a car in
  the queue as stopped for good, and went round it.) It is never faster than the old limit, so the queues and the waits at the lights are as
  before; only the braking is earlier and softer, as a passenger feels it.
- **Get out of your way.** Driving at the traffic, your car used to meet a car that only braked for
  something in its own lane ahead. Now a driver watches where your car will pass it (issue 335,
  `actors.js` `DODGE_T`). If that point is within 2.2 s and close enough to touch, the driver swings
  1.2 m out of the way. It swings to the kerb, or out over the centre line when you pass on the kerb
  side and nothing is coming the other way. It brakes hard unless you are coming up from behind,
  keeps this up for at least 1.2 s, and sounds its horn. A bus's horn is lower, and a far one is
  fainter (`audio.js` `honk(gain, pitch)`). The idea is taken from the reaction step in
  [Slop New York](https://github.com/mrdoob/slop-newyork) (MIT; `traffic.js`, where a driver notices
  the player a set time before contact and keeps the move up for a minimum time). No code is copied.
  `tools/game_check.js` puts your car 26 m ahead of a moving car in its lane, coming at it at
  10 m/s. Within a second that car must slow by at least 2 m/s, move 0.4 m aside and sound its horn.
- **Break the rings.** Round Shibuya station the queues waited for room behind queues that waited
  for room, round a block and back, and nothing moved: one car stood 220 s at its line. The
  traffic wanders, so a car held 5 s at its line for want of room, its light green, takes another
  way out that has room (`outOfRing` in `tools/traffic_check.js`). Cars still jammed at the end of
  `traffic_check.js`'s three Shibuya runs went from 25, 7 and 7 to 3, 4 and 3.
- **People look both ways where nothing is marked.** Where a footway steps onto a road with no
  signals and no zebra, the crowd stepped out regardless and every car stopped for it, one after
  another (a queue east of the station stood for the people crossing for minutes). Now a walker
  waits at the kerb while a car would reach the place within 3.5 s, as the law asks of someone
  crossing away from a crossing (Japan's Road Traffic Act, article 13; the Highway Code, rule 7),
  and after 20 s takes its chance at walking pace, the cars braking for it. At zebras and signals
  nothing changes. The places are found a metre at a time along a footway the first time someone
  walks it, and only those near you are kept.
- **Signals that read their queues** (capacity-aware max-pressure, Varaiya 2013, with Gregoire et
  al.'s rule for full roads beyond). The lights already ended a green early when nobody came on it
  (gap-out, as SCATS and vehicle-actuated signals do). Now each arm counts the cars queued at its
  line every frame (`a.qn`, from the traffic), and whether the head of its queue waits for room
  beyond (`a.full`). A green whose queues are all blocked beyond ends after 8 s when another phase
  has cars waiting (serving it moves nobody); one whose queue is more than twice the next phase's
  runs on, up to 1.6 times its green, and then ends after the walkers' flash. A scramble keeps its
  own order and walk. It reads only the queues at hand, nothing to forecast or store.
- **No way against a one-way street.** Where the one-way streets leave no legal way (7% of
  random trips in Shibuya), the router searched any street at the same cost, and a trip could
  drive 300 m against the traffic, head on into it. Now a metre against a one-way street costs 25,
  and a banned turn 400 m, so the way found breaks the rules for the fewest metres it must. (The
  way a ride comes for you is searched as before: out of your sight it comes in good time, and held
  to this a hailed taxi in Shinjuku was given a kerb 31 m from you.)
- **Back out of a one-way street (#283).** A car or a ride blocked on a one-way street (a jam
  that won't clear, a wall across it) couldn't turn round: a turn in the road would put it head on
  into the traffic in its one lane, so it stood until out of sight. Now it backs along its lane to
  the junction behind and takes another way out there, as a driver does (`actors.js` `reverse`,
  `game.js` `reversePoses`: straight back, then the tail swung away from the way out on its lock,
  then forward into that way's lane on a curve no tighter than its lock). The cars stopped behind
  it on the street back out first; a ride asks a car in its way to back off and never drives into
  it, and the traffic sees where it goes next and stops short of it. A junction more than 80 m
  back, it waits as before. A car facing one that won't give way on a street too narrow to turn
  in backs out the same way (`tools/reverse_step.js`).
- **Single-track manners on narrow stretches.** Of two coming at each other where a street has
  room for one, the one in the stretch goes first; of two both in it or both short of it, the one
  nearer the far end (its passing place); and none waits on one standing outside the stretch,
  queued at its own line, which waits its turn once the other is in. One waiting there is no
  longer counted as queueing (it is not behind the other), so after 20 s it backs out or turns
  round; the check holds it to 30 s.
- **A bus takes a corner as a bus does.** The traffic took a junction's corner at its full
  50 km/h: a bus's heading swung 15 to 25 degrees in a tenth of a second. Now a bus looks along its
  way from its middle on and takes each bend at no more than 1.6 m/s² of sideways pull, braking for
  it in time and gathering speed out of it gently (the bend read over 6 m either side, since the
  roads' lines meet at sharp corners). At a tight corner, a turn on the kerb side, it swings up to
  1.5 m wide, its front axle following that path (on past the next piece of road, which inside a
  junction can be a few metres long) and its rear axle drawn after it along the body, so it comes
  round over its wheelbase; where that would put its body into a post its lane's own pose keeps
  clear of, it keeps to the lane's pose. `tools/bus_turn.js` in Tokyo: the biggest jump in heading
  3 to 6 degrees a tenth of a second (10 to 25 before), the rear axle's sideways slip 0.06 to
  0.5 m/s, turns taken at 2 to 4 m/s. The cars were slowed the same way at first (3.5 m/s², a
  corner at 19 km/h, as a ride's driver takes it), but the queues at the lights grew with it and a
  taxi in Shinjuku took 50 s to come, not 10: the junctions' timings want tuning to it first, so the
  cars keep their speed round a corner for now (a follow-up).
- **A short piece out of a signal clears first.** Shinjuku's junction 1103, 27 m from the scramble
  1105, has no signals; between its line and 1105's there is room for one car. A car out of 1105's
  turn waited there to give way, and the queue behind it at 1105 stood through its greens, a minute
  at a time. Now at a junction without signals the arm of a piece too short to wait on (12 m
  between the lines), out of a signalled junction just behind, ranks first, so it clears the box
  behind as the box-junction rule asks (`junctions.js` `rankOf`): the head of 1105's arm 2 stood
  24 s at most in a run where it had stood 56 s. A scramble walker stood still in the gutter a pace
  from its spot counts as at the kerb, not out crossing: it held the all-red after the walk 10 to
  15 s at a time.

#### Where the traffic is going, the kerb, the weather and level crossings

- **Trips** (`trips.js`, #355). The cars used to pick an exit at random at every
  junction. Now seven in ten are bound for a place: one of up to eight ends of the
  main roads at the map's edge, or one of up to sixteen streets with kerb room near
  the places the map names (the start, the landmarks, the wharves). Three quarters of
  the trips go into town from 06:30 to 09:30, a quarter from 16:00 to 19:30, half at
  other hours, six in ten late at night; a trip into town ends, more often than not,
  in the part of town the car is in. No route is kept and nothing is searched while
  the game runs: for each place a field is worked out once, the first time a car is
  sent there (a search back from it over the street network, the one-way streets and
  the roads to keep off respected, a back street dearer than its length), and at a
  junction a car looks each exit up in it and takes the one that brings it nearest,
  an exit 64 m dearer a third as likely (`junctions.js choose`). A car comes into the
  traffic on a main road more often than a back street, facing the way its place
  lies. The cost each frame is unchanged: a look-up per exit, where a car picked one
  anyway.
- **The kerb** (`actors.js kerbLo`, `parkNow`). A street has room for parked cars
  where a taxi's place at the kerb (`cars.js kerbOf`) is 2.3 m or more from the middle
  of the lane: not a motorway or a trunk road, not two lanes each way, not a narrowed
  lane, not a two-way back street (the one-way ones have room). About one car in six
  is parked there when it comes into the traffic (fewer in the morning, more in the
  evening), three in ten at most, clear of junctions by 22 m, of crossings, of other
  cars by a bumper's room, of posts, walls and people. A parked car takes no step: it
  is drawn, and the traffic, the crowd, the rides and you keep out of its footprint.
  A car within 300 m by road of the end of a trip into town takes the first room at
  the kerb it passes: it indicates, slows, moves across over its last 13 m (no faster
  sideways than a third of its speed) and stands; one that finds a parked car in its
  way across drives on. Its time up (minutes in the morning, under three in the
  evening) and the lane clear behind for 28 m or 3 s, it indicates, pulls out and
  drives off on a new trip. So the kerbs fill in the morning and empty in the
  evening, and the cars that leave them are the evening's flow out of town. A city
  sets its own share (`game.json` `vehicles.cars.parked`); Japan's maps keep one car
  in twenty at the kerb, as its streets do, the others one in six. A way into a place
  and out of it is swept first (the car's places 3, 6 and 9 m off, part way across),
  so that none drives through the car parked next to it; a car boxed in for two
  minutes, out of your sight, leaves the traffic.
- **Buses, taxis and vans.** The mapped bus stops (`props.bus_stop`,
  `pipeline/kerb_stops.py`, from OpenStreetMap by way of Overture Maps) are each put
  on the piece of road within 14 m, for the traffic on the pole's side; not one
  within 30 m of the junction ahead. A bus coming up to one indicates, stops with
  its front door at the pole and stands 8 to 18 s, longer the more get on: up to
  three of the people walking within 16 m of the door walk to it and board, and up
  to two get off and walk away along the footway (`actors.js` crowd `board`; only
  within 150 m of you). A taxi at the end of a trip waits at the kerb a minute or so,
  as at a rank, before it goes on. A van stops at the kerb every minute or two for a
  delivery of 12 to 40 s with its hazards on.
- **The weather** (`cars.js setWeather`). The weather's one state (`weather.js`) is
  read four times a second into the drivers' own numbers: grip (the state's, where it
  has one: 0.7 wet, 0.4 on snow), pace (0.6 + 0.4 of the grip, less in fog under
  180 m), the speed through a bend (the square root of the grip), the gap (0.9 longer
  for each unit of grip lost), headlamps on by day in rain, snow or fog. The traffic,
  the rides, the autopilot and the cruise read them; your own car feels a little over
  half of the grip lost (0.87 wet, 0.73 on snow) in its tyres and its brakes. Spray:
  one set of 192 points, drawn once for all the cars within 70 m of you on a wet road,
  a puff behind a rear wheel that rises, drifts back and fades in 0.8 s; none is made
  until it first rains.
- **Level crossings** (`junctions.js addRail`). The railway is `rail.js`'s; to the
  traffic one of its crossings is a crossing between junctions whose lights are the
  railway's state: amber for the first three seconds of its alarm (a car that can
  stop does; one on the rails drives on), red while it is shut. The stop line is
  2.5 m short of the rail corridor. Open, the keep-clear rule holds: no car, ride or
  autopilot goes onto the rails unless there is room for the whole of it beyond them.
- **Feel** (`actors.js toneMaterial`, `place`). Each car's brake lights and
  indicators are two numbers in an instanced attribute no car's paint used: the tail
  lamps light when it brakes at 1.2 m/s² or more or stands held, the amber lamps of
  one side flash 85 times a minute into the kerb, out of it, across to another lane
  and from 35 m before a turn until it is through. Within 160 m of you a car's body
  pitches with its acceleration and rolls out of its turns. A driver sounds the horn
  for cause only: to get out of your car's way (as before), and once after five
  seconds stopped behind your car in its lane.
- **What it costs a frame.** Trips put more of the traffic in town, round you, where each
  car has more to look at: about 0.65 ms a frame more in Shinjuku in the morning
  (`NOTRIPS=1 tools/traffic_profile.js`; the parked cars cost nothing measurable). It is paid
  back where nobody sees it: a car out of the camera's view, 70 m or more from it and 60 m
  from you, takes a step every second frame, and past 300 m every fourth (every fourth from
  120 m jammed the junctions three times as often: their turns and reservations want the
  finer steps). Measured at 08:00 over a minute of play, the traffic update a frame:
  Shinjuku 4.55 ms against main's 5.74, Sydney 3.05 against 3.81; and over ten minutes of
  Shinjuku's morning (`tools/traffic_check.js`, the clock held) 4.9% of the car-time
  jammed for half a minute or more against main's 4.8%, the longest stand 99 s against 114 s.

**The soak (#355).** Every live map's traffic run for half an hour of the game's clock at 08:00, 10:00, 18:00 and
23:00, the hour held (`tools/traffic_soak.sh`, `tools/traffic_check.js` with `CLOCK_HOLD`), on the trips, the kerb
and the weather as they first landed (main at 80afa1a2). *Standing*: the share of the cars' time stood still;
*jammed*: still 30 s or more; *at the kerb*: parked cars on average, left out of the two.

| city | hour | standing | jammed | jammed at the end | longest still | km/h | at the kerb | update |
|---|---|---|---|---|---|---|---|---|
| fushimi-inari | 08:00 | 26% | 6.8% | 13 | 191 s | 23 | 1 | 1.42 ms |
| fushimi-inari | 10:00 | 26% | 7.0% | 12 | 436 s | 23 | 1 | 1.41 ms |
| fushimi-inari | 18:00 | 27% | 6.2% | 14 | 135 s | 23 | 4 | 1.37 ms |
| fushimi-inari | 23:00 | 30% | 16.9% | 15 | 1382 s | 23 | 3 | 1.48 ms |
| higashiyama | 08:00 | 34% | 3.4% | 0 | 100 s | 21 | 2 | 1.42 ms |
| higashiyama | 10:00 | 35% | 2.5% | 0 | 89 s | 21 | 2 | 1.69 ms |
| higashiyama | 18:00 | 27% | 0.6% | 0 | 51 s | 22 | 7 | 1.47 ms |
| higashiyama | 23:00 | 26% | 0.1% | 0 | 52 s | 22 | 7 | 1.62 ms |
| kamakura | 08:00 | 38% | 15.9% | 24 | 1011 s | 18 | 0 | 2.06 ms |
| kamakura | 10:00 | 30% | 1.3% | 0 | 421 s | 20 | 7 | 2.08 ms |
| kamakura | 18:00 | 37% | 14.8% | 22 | 874 s | 19 | 8 | 2.13 ms |
| kamakura | 23:00 | 42% | 23.7% | 26 | 1478 s | 18 | 8 | 2.07 ms |
| kyoto | 08:00 | 18% | 0.3% | 0 | 86 s | 28 | 2 | 2.75 ms |
| kyoto | 10:00 | 18% | 0.6% | 0 | 89 s | 28 | 6 | 4.31 ms |
| kyoto | 18:00 | 17% | 0.9% | 2 | 90 s | 29 | 5 | 2.64 ms |
| kyoto | 23:00 | 24% | 6.4% | 4 | 371 s | 27 | 6 | 3.12 ms |
| queenstown | 08:00 | 25% | 1.3% | 10 | 84 s | 12 | 0 | 1.60 ms |
| queenstown | 10:00 | 24% | 1.0% | 0 | 72 s | 13 | 1 | 1.47 ms |
| queenstown | 18:00 | 23% | 0.8% | 0 | 66 s | 13 | 0 | 1.48 ms |
| queenstown | 23:00 | 24% | 1.3% | 0 | 80 s | 12 | 0 | 1.49 ms |
| shibuya | 08:00 | 28% | 9.6% | 28 | 222 s | 25 | 4 | 5.23 ms |
| shibuya | 10:00 | 31% | 11.3% | 53 | 338 s | 24 | 16 | 5.13 ms |
| shibuya | 18:00 | 28% | 8.9% | 38 | 224 s | 25 | 16 | 5.14 ms |
| shibuya | 23:00 | 32% | 11.8% | 26 | 217 s | 24 | 16 | 5.39 ms |
| shinjuku | 08:00 | 28% | 5.1% | 12 | 120 s | 26 | 10 | 5.32 ms |
| shinjuku | 10:00 | 29% | 5.8% | 17 | 119 s | 25 | 11 | 4.83 ms |
| shinjuku | 18:00 | 29% | 5.2% | 15 | 127 s | 25 | 11 | 4.84 ms |
| shinjuku | 23:00 | 28% | 5.1% | 4 | 107 s | 26 | 12 | 5.42 ms |
| sydney | 08:00 | 17% | 0.1% | 0 | 66 s | 29 | 8 | 3.11 ms |
| sydney | 10:00 | 17% | 0.1% | 0 | 63 s | 29 | 12 | 2.64 ms |
| sydney | 18:00 | 18% | 0.4% | 0 | 89 s | 29 | 18 | 2.99 ms |
| sydney | 23:00 | 15% | 0.2% | 0 | 66 s | 31 | 30 | 2.52 ms |
| tetsugaku | 08:00 | 14% | 0.4% | 0 | 66 s | 29 | 0 | 1.20 ms |
| tetsugaku | 10:00 | 13% | 0.2% | 0 | 65 s | 30 | 4 | 1.16 ms |
| tetsugaku | 18:00 | 16% | 0.3% | 0 | 47 s | 29 | 4 | 1.17 ms |
| tetsugaku | 23:00 | 18% | 1.2% | 0 | 137 s | 28 | 4 | 1.35 ms |
| tokyo | 08:00 | 19% | 0.5% | 3 | 71 s | 31 | 20 | 4.28 ms |
| tokyo | 10:00 | 21% | 1.4% | 13 | 1578 s | 30 | 20 | 4.10 ms |
| tokyo | 18:00 | 22% | 1.2% | 1 | 57 s | 30 | 19 | 4.04 ms |
| tokyo | 23:00 | 22% | 0.9% | 0 | 65 s | 30 | 19 | 3.96 ms |

Most maps run free: Sydney, Tetsugaku, Higashiyama, Queenstown and Kyoto by day stay under 1-3% jammed and no car
stands more than a minute and a half. Where they did not, the same runs on main from before the trips (84829ade)
tell what is the trips' and what is not:

| map, hour | jammed, the soak | main before the trips | after the fix below |
|---|---|---|---|
| Kamakura 08:00 | 15.9%, longest 1011 s | 1.5%, 421 s | 1.8% |
| Kamakura 23:00 | 23.7%, longest 1478 s | 1.1%, 120 s | 11.4%, and 4.7% in a second run |
| Fushimi Inari 23:00 | 16.9%, longest 1382 s | 8.1%, 235 s | 5.6% |
| Shibuya 10:00 | 11.3%, longest 338 s | 9.2%, 236 s | |
| Tokyo 10:00 | 1.4%, one car 1578 s | 0.7%, 76 s | |

Kamakura's gridlock was a knot across two junctions about 20 m apart on road 191 (junctions 90 and 91): a car in 90's
box waiting to cross into 91, behind one stood in 91 behind a car held at 90's light, a light that cannot change while
90's box is taken. Main crosses two junctions that close as one, and seldom met it; the trips send cars through the
pair in ways main seldom did. Nothing undid it, so now a car stood 90 s anywhere in a junction's box backs out, or
leaves the traffic (as one stood 20 s at a wall in a junction already did). Shibuya's share is main's own (#348).
Kamakura at night is still above main's, and varies from run to run: left open in #355.

#### Junctions and traffic lights

Before, a junction was a lock: one car at a time held the node it came up to,
and every node where two road pieces met was one, even a bend. Queues reached
back into the junction behind, cars stopped half way through a turn, jams
locked solid, and a car stuck behind one turned round in the road after 10 s.
Sydney's traffic stood still a third of the time.

- **The rules of the road are data.** `pipeline/road_rules.py` reads Overture's
  segments and infrastructure (OpenStreetMap, ODbL): a segment whose access is
  denied heading backward (or forward), for everyone or for motor vehicles, is
  one-way, and the road pieces in `game.json` carry `"o": 1` or `-1`;
  `traffic_signals`, `stop` and `give_way` points go into `props`. Sydney has
  788 signals and 914 of its 1957 road pieces are one-way, Osaka 1837 and
  4886, Paris 1456 and 3364. A banned turn (Overture's
  `prohibited_transitions`: OpenStreetMap's `no_right_turn`, `no_u_turn`,
  `only_straight_on` and the like, for motor traffic at all times) is matched
  to the road pieces cut from its two segments at the connector between them
  and written on the piece it starts from as `"nt": [[end, piece, end entered,
  steps]]`: Sydney has 185, Hong Kong 612, Melbourne 343, Osaka 368.
  `game_data.py` writes the same as it builds.
- **Rules by the hour.** Overture keeps OSM's conditional restrictions as
  `when.during`, an opening_hours value with its spaces dropped
  (`Mo-Fr07:30-08:30`, `07:30-08:3016:00-18:00`). `road_rules.py` reads the days
  and times (`windows`: a day mask and minutes, a range past midnight split onto
  the next day; sunrise, public holidays and months are left out) and writes a
  turn banned at some hours as `"ntw"` (as `"nt"`, with the times) and a street
  shut to cars at some hours as `"tb": [[way, shut, times]]`: shut while the
  times last (`access=no @ (...)`: Japan's school roads on weekday mornings, a
  shopping street by day), or, on a street shut to cars but for its deliveries,
  open only then (Amsterdam's streets, `motor_vehicle=no` with
  `delivery @ (07:00-11:00)`). Rules for lorries, bicycles or by weight alone
  don't count. `junctions.js` goes by the game's clock (`setClock`, from
  `game.js`): a car coming up to a junction doesn't choose a way closed at that
  hour if there is another, the rides' router goes round, and no car is put on
  a shut street; one already on it drives out. Tokyo has 26 such streets and one
  timed turn, Shibuya and Shinjuku 29 streets, Osaka 24, Kyoto 4 and 3 turns,
  Sydney and Amsterdam 7, Hong Kong 5, Paris 2; Overture's release carries few
  timed turn bans anywhere (6 in all the cities).
- **Lanes from the data.** Overture's segments don't carry OSM's `lanes` or
  `turn:lanes`, but each names the OSM ways it was cut from.
  `pipeline/road_lanes.py` reads those ways' tags from the OpenStreetMap API by
  id (its multi-fetch, a few hundred at a time: about 40 requests for Sydney;
  Overpass is not reachable from the build machine) and writes `"tl"`, the
  arrows at a piece's end where the OSM way itself ends, and `"nl"`, the lanes
  each way where tagged (1 or 2). Sydney has 609 of its 1957 pieces with a
  count and 71 with arrows, Melbourne 1853 and 128, Hong Kong 1242 and 109;
  Japan's cities tag almost no arrows. The traffic reads the arrows, and the
  counts where they take a main road down to one lane each way (the game draws
  a minor road one lane wide each way, so a count of two there is left alone).
  Along a road between junctions (pieces joined where only two meet) the counts
  are smoothed: a stretch of two shorter than 120 m between stretches of one has
  one, and a stretch of one shorter than 40 m between stretches of two keeps two,
  so nobody has to merge and pull out again within a few metres. A car in the
  second lane looks along the road past the pieces between junctions to where
  that lane ends (`junctions.js laneRun`) and moves across from 90 m (and 2 s at
  its speed) before it; a junction lets two movements go side by side onto a
  road only where its second lane runs on 60 m. With the counts read the first
  time (#51) Sydney's jams under `traffic_check.js` went from 1.2% to 3.4%, as
  cars had to merge within a few metres; with the smoothing and the look ahead
  they are 1.2% (three places, 150 s each; main without the counts 1.7%).
- **Crossings between junctions.** A pedestrian crossing (OSM's
  `highway=crossing`, Overture's infrastructure class `crossing`) is sorted by
  its tags (Overture keeps them as `source_tags`) into one with signals
  (`crossing=traffic_signals`, `crossing:signals=yes`, a pelican, puffin, toucan
  or pegasus) and a zebra (`crossing=zebra` or `marked`, `crossing_ref=zebra`,
  zebra markings): `props.crossing_signals` and `props.crossing_zebra`. One
  more than 16 m from any junction's node and 12 m from its piece's ends is a
  junction of its own with no way to turn (`junctions.js`, `j.mid`), an arm for
  the traffic heading each way, its stop line 3 to 3.6 m back from the
  stripes. One with signals keeps the traffic's green until a walker presses
  the button, and then for no more than 5 s (4 s at least): amber, 2 s all
  red, the walk for 4 s, its figure flashing for 2 s more (no one stepping out
  in its last 3 s of green), 2 s all red, and back, so its cars wait 10 s; it
  has the junctions' lanterns and a walk signal on each kerb. At a
  zebra the traffic gives way at the line to anyone of the crowd on the
  stripes or walking out onto them (and
  after 15 s waiting on one who stands there, edges on, braking for them as for
  anyone in the road). Sydney has 97 crossings with signals between junctions
  and 63 zebras; the others are at junctions, whose arms have walk signals
  already. A ride's driver (`cars.js chauffeur`) keeps to them too: the router
  notes the crossings along a route (`route.mids`), and in your sight the driver
  stops at a crossing's red, and at a zebra gives way while someone is on the
  stripes or stepping onto them (`onStripes`, from the traffic), braking as hard
  as it brakes for a red; it holds a crossing's green while it comes, as at a
  junction, but never cuts the walk short. The app's time counts their lights
  near you as it counts a junction's.
- **A junction** is a node where three or more pieces end, or a few such nodes
  joined by pieces under 24 m and no more than 42 m across: a divided road
  crossing another is two to four nodes and one junction. Its arms are the
  pieces out of it. A car coming up an arm picks its exit (ahead more often than
  a turn, a main road more often than a lane, never back the way it came, never
  a banned turn) and the pieces across to it. The rides' router (`cars.js`)
  keeps to the banned turns too.
- **Lanes.** A motorway, trunk or primary road, and a one-way secondary, has
  two lanes each way: the first beside the centre line (on a one-way street, on
  the keep side), the second 3 m out towards the kerb (on a one-way street,
  across on the other side). A one-way road of one lane (a ramp, a narrow
  one-way street) is driven on its line, the middle of its carriageway, not
  1.7 m to the keep side (#177); a car eases across to it, at a lane change's
  rate, where it comes onto such a road from another, and a ride's driver
  follows the same lanes (`cars.js` `laneAt`). Where OpenStreetMap paints arrows on the lanes
  (`turn:lanes`, written on the road pieces as `"tl"` by
  `pipeline/road_lanes.py`), a movement goes from the lanes whose arrows show
  its way, the half of the road's lanes on the first lane's side standing for
  the first lane and the other half for the second. Elsewhere a turn across the
  oncoming traffic goes from the lane nearer the middle of the road (on a
  two-way road the first, on a one-way street the second), a turn the other way
  from the lane nearer the kerb, and straight ahead onto a road of the same
  kind with two lanes from either, each lane with its own way across, so two
  cars go through side by side. Two side by side need the room beyond (two
  lanes, 60 m long); else the movement keeps to the one lane. Two movements
  from one arm in different lanes go together unless their ways across come
  within a car's width. A car
  moves across to the lane its movement needs from 150 m out, and to the first
  where its road narrows; otherwise into the other lane when the car ahead is
  slow and there is room beside it there (0.8 m plus 0.9 s of its speed, ahead
  and behind), at most every 4 s, never in a junction or in the last 8 m before
  a line. It noses across at up to 1.3 m/s sideways, slowly while barely
  moving. A car that reaches the line in a lane its exit can't go from picks an
  exit that can, or waits to move across. A second lane ends before a junction
  where a car waiting in it would stand in another arm's way, or where two
  roads come in side by side (a merge). This is SUMO's lane-change model
  (LC2013, EPL-2.0) cut down to its strategic and speed-gain changes; no code
  is taken from it.
- **Its ways across** are worked out the first time a car comes up to it: each
  movement's lane, smoothed round the corner as the cars drive it, from its
  arm's stop line to its exit's. Two movements whose ways come within 2.8 m of
  each other cross. Each stop line starts at half the widest road crossing
  there plus a crosswalk, and is set back until a car waiting at it is clear of
  every other arm's ways (a turning bus included).
- **Going in.** A car decides at its comfortable braking distance from the line.
  It goes in only if its light is green (or amber and it can't stop at 4 m/s²),
  it has stopped at a stop sign, no movement in the junction crosses its way, no
  car that has waited longer at a line crosses it, and on a lesser road or past
  a give-way sign no car is coming on the main road within 3 s. And only if
  there is room for it beyond the junction, up to the next junction's line, so
  a queue never reaches back into the box: SUMO's *keep clear*. An exit that is
  a short piece running straight on into another (a slip, a loop back, as at
  Roppongi's line 619 into 572) counts the room on those pieces too, up to the
  next junction's line. A junction just
  beyond, too close to wait between, is crossed with this one or not at all.
  A bus has the junction to itself. A car gives its movement up once its rear
  is past the stop line on its exit. When the lights change before it gets
  there and it can still stop, it stops. A car given its way across while
  still short of its line, then stopped there 4 s behind a car that is not in
  the junction (one waiting at another of its lines, where two roads come in
  side by side, for this very movement to clear), gives the movement up and
  waits its turn.
- **Signals** go where OpenStreetMap maps them (a mapped point within 22 m of a
  junction's node), or, in a city without the data, at a junction of two main
  roads. The arms take two phases, the main road's axis and the cross road's:
  green, amber (3 s, 4 s where the limit is over 60 km/h), 1 s all red. They
  are a game's lights, not a city's: nobody waits at a red longer than 10 s
  (`junctions.js` `RED`), the real cycle of a minute or two scaled down. As a
  real actuated controller's maximum green starts timing when a car calls on a
  conflicting phase (NEMA TS 2), a green ends in time for the first car to come
  up to the other phase's red (or the first walker to press for the walk it
  gives) to have its green within 10 s, its amber and all red counted against
  that, after 4 s of green at least. With nobody waiting on the other, a phase
  is green for 8 to 15 s on the main road (13 s on a primary) and 5 to 10 s on the
  cross road (8 s on a tertiary), and stays green for up to 12 s more, as the side
  roads of SCATS (Sydney's adaptive signals) are skipped when no one is there.
  It also gaps out as SCATS and vehicle-actuated signals do: when someone waits
  on another phase and no car is coming on this one (none within 12 s of its
  line), its green ends after 5 s, the walk over 3 s before. You are seen as the
  traffic is: at the wheel, coming slowly up to a line or stopped there, a call
  for your phase; on foot beside a road near its junction or crossing, the
  button (`game.js` `youAtLights`), so the 10 s holds for you too.
  `tools/traffic_check.js` measures the waits at a red, for cars and walkers,
  a scramble's apart, and names the junctions of the longest;
  `tools/wait_sweep.sh` runs it over every city. Taxis and rides stop for a
  red light and at a stop sign too, while in sight. Your own car doesn't: drive over a line on red and you hear about it.
- **Turn arrows.** A big junction of two main roads (four arms or more, the
  main road secondary or above and two-way, the cross road tertiary or above)
  gets a third phase after the main road's: the turn across the oncoming
  traffic (right where the traffic keeps left, left where it keeps right) on an
  arrow while everything else is red, for 4 to 4.5 s, ended after 3 s when no
  one is left to turn and after 2 s when a car comes up to the cross road. As
  SCATS runs a lagging right-turn phase, it comes only when a car waits to turn
  there, and only while nobody waits on the cross road (the 10 s holds for
  them); after it the cross road's turn comes only if someone waits for it, the
  main road's green again if not. The turners keep their green from the main
  road's phase into it while the straight-ahead traffic beside them goes amber
  and red. On the main road's green they filter through the oncoming traffic as
  before. Sydney has 22 such junctions of its 166 with signals.
- **Walk signals.** Where a footway of the crowd crosses an arm's road at a
  junction with signals (between the junction and just past the stop line), a
  walker coming up to the kerb while that arm's traffic may go stops there and
  presses the button, which calls the phase that holds that traffic; they cross
  on the walk, which shows while the arm's traffic is red and another phase
  (not the arrow) is green, and ends 3 s before that phase can. Someone already
  out in the road (over a median, say) walks on. Turning cars still give way to
  people on the crossing.
- **Scrambles** (歩車分離 with diagonal crosswalks). Shibuya's crossing (scene
  `landmarks.scramble`, with its six mapped crosswalks, the one diagonal from
  Hachiko to QFRONT among them) and the junctions a city lists in
  `game.scrambles` in `city.json` run a fourth phase after the traffic's two:
  every arm red and every walk signal green together for as long as its longest
  crosswalk takes at its crowd's brisk pace (1.45 m/s, plus 5 s to step out; 15 s
  at the least and 32 s at the most: 28 s at Shibuya's, 15 s at the small ones
  round it, #199), the green figures flashing for the last 6, then 8 s for the main road and 6 s for the cross
  road (the real cycle is about two minutes with 40 to 50 s of walk; the game
  keeps the walk, which its crowd needs to cross, and cuts the traffic's turns
  to a few seconds). The all-red round the walk is 4 s and is held up to 25 s
  more while anyone is still out on the road, and no car goes into the box while
  anyone is out crossing it until its green has run 2 s (`junctions.js` `may`,
  #197). The walk is the one wait longer
  than 10 s (`RED`): a car coming up as it starts waits for its crowd. Nobody
  walks in the traffic's phases. A ride's priority, or you waiting at the wheel,
  never shortens a walk under way, but one not yet started waits for your turn;
  you on foot at its kerb bring the walk on next, the cross road's turn skipped
  (never the same turn twice running, so standing there doesn't starve a road),
  and
  a car caught in the box when the walk comes on stays put while the crowd flows
  round it. The scramble's stop lines stand behind its crosswalks (OSM puts
  Shibuya's signals at them, 30 m out, so a scramble always has signals), and a
  mid-block signal mapped on one of its crosswalks is folded in.
  - *Its crowd* (`actors.js`, plazas). Near the player about a third of the
    crowd belongs to the scramble (a landmark's six times a smaller one's share):
    massed on the pavement behind the kerbs where the crosswalks land, deeper
    the more there are, facing the road. When the walk comes on they step out
    after a moment's reaction, the front rows first, and only with the time to
    reach the far kerb; they cross freely in the stripes' full width rather than
    in single file, keep apart, and step a little to the left on meeting someone
    coming the other way, so lanes form as they do in a real counterflow. On the
    far side each strolls to a kerb of that corner and waits again. The rest of
    the crowd still walks the footways; more of it gathers round the scramble,
    crosses on the same walk with time to make the far kerb, waits at a line's
    end that would step straight into the road, and spreads across the stripes.
  - *The other scrambles* listed: Shibuya's Dogenzaka-shita and three on
    Koen-dori (Inokashira-dori Iriguchi, Jinnan 1-chome, Kinro Fukushi
    Kaikan-mae), the four in a row along Shinjuku-dori from Alta, Ginza's
    Sukiyabashi and Asakusa's Kaminarimon-mae. Each is named in a published list
    of Tokyo's scramble crossings, or has both diagonals mapped in OSM, or both.
    Not listed: Jingumae (Omotesando and Meiji-dori), reported as not a
    pedestrian-only phase; Ginza 4-chome, Akihabara's Chuo-dori and Ikebukuro's
    east exit (on Meiji-dori), for which neither a source nor a mapped diagonal
    was found; Ueno, Roppongi and Jinbocho have none either.
  - *From games and research.* Persona 5 and The World Ends with You make the
    scramble a set piece, with the crowd as silhouettes or flat figures that
    part for you; Ghostwire: Tokyo empties it. Here the crowd is people who keep
    the signals. The crossing behaviour follows Helbing and Molnár's social forces
    (repulsion between bodies, a small sidestep bias that makes lanes form); the
    ShibuyaSocial model, learnt from 8K video of this crossing, and Zanlungo,
    Feliciani, Nishinari and others' crossing-flow experiments (stripes form even
    at fairly low density) confirm the patterns to aim for. Ideas only; no code or
    data from any of them.
  - *A crowd that masses.* Games settle a crowd that bunches up by giving an agent
    that arrives somewhere a place to stand and making it stand there, rather than
    letting every body push towards a goal it cannot reach. Unreal's Mass splits its
    avoidance into a moving and a standing processor, the standing agents softer to
    pass and nudged aside rather than steering; Detour Crowd and Unreal's queues stop
    an agent that reaches the one ahead; Moussaïd, Helbing and Theraulaz (PNAS 2011)
    model a walker as slowing to keep a safe distance to the first body in its way,
    from which queues and stop-and-go waves follow. Here, from them (ideas only, no
    code):
    - A walker short of its spot at a kerb that has covered no ground for a second,
      the crowd in its way, stands where it is, at the back of them, instead of
      walking on the spot into their backs.
    - A footway walker slowed to a crawl by the crowd at a scramble's kerb just
      ahead joins it where it stands, rather than creeping into it and turning back.
    - When the walk comes on, the crowd sets off as a wave from the front: each row
      later by how deep it stands, and only once whoever stands in front of it has
      stepped off (never held more than 4 s by that).
    - Shibuya, within 40 m of you over a minute (`tools/crowd_press.js`): the time the
      scramble's crowd spent pressing without getting anywhere on its way to a kerb
      went from 143 walker-seconds to 19 (the longest from 27 s to 2 s), and the
      footways' walkers from 19% of their time to 1.5% (the longest from 18 s to 2 s).
    - `tools/crowd_film.js` films the crowd massed nearest you, to see it move.
  - `tools/scramble_step.js`, run by `tools/game_check.js` in every city with a
    scramble, checks that in the walk every arm's light is red, the walk signals
    are green and the crowd is out on the crosswalks and the diagonals; that in
    the traffic's phases nobody steps out or is still out on the road once the
    green has run 2 s; and that no car moves through the box while anyone is on it.
  - `tools/scramble_cars.js` prints the cars in and near the box over a cycle and
    what holds each.
- **The signal heads** are instanced, a handful of draw calls for a city's
  thousands. Each arm with signals has a pole at the kerb by its stop line with
  a lantern facing the traffic, and a second across the junction; a main road's
  pole carries a mast arm with a lantern over the lane. Lanterns have visors
  over the lamps, and in Australia and the Netherlands a black target board with
  a thin white rim (black from behind). Japan's lights are horizontal (green,
  amber, red from the left) on arms over the road; France's have no board and
  no mast. A city can set its own in `game.signals` in `city.json` (`layout`,
  `pole`, `housing`, `board`, `border`, `mast`: the road rank from which an arm
  has one). The lit lamp blooms, and after dark it glows towards the traffic
  facing it, not from behind. An arm with a turn arrow has an arrow lantern
  beside the one over its lane: red, amber and green arrows, dark while the
  turn filters on the main road's green. Japan's is a row of green arrows (left,
  ahead, right) under the lantern, the turn's lit on its phase. Every arm's
  crossing has a walk signal on a post on each kerb, facing across: a red
  figure standing over a green one walking, the red flashing while those
  already out finish crossing. The lamps change only when a signal does.
- **Walk signals' calls** (`web/game/walkcalls.js`, the sounds in `web/game/audio.js`,
  all synthesised with Web Audio, no recordings). Each walk-signal head
  (`junctions.heads.peds`; its crosswalk runs to the head on the far kerb, or a
  scramble's along `j.walks`) is a speaker 3.3 m up, heard from the camera, fading with distance and panned
  left or right; the game's sound switch mutes them. A city gets its country's
  sound (`game.signals.sound` overrides it):
  - **Japan** (視覚障害者用付加装置, the National Police Agency's guideline of
    October 2003, renewed in 2019 and March 2024 (警察庁丁規発第52号), as the
    prefectures' police publish it): the *異種鳴き交わし方式*. Only while the
    walk is steady green (not while it flashes). A crosswalk's two ends answer
    each other about 1.5 s apart, one with the single call and the other with
    the double. The guideline leaves the axis to each prefecture; we follow
    Kagawa's published rule (the only one we found written down): a crosswalk
    running north-south plays the chick, "piyo" from its north end and
    "piyo-piyo" from its south end; one running east-west the cuckoo, "kakko"
    from its west end and "ka-kakko" from its east end. At a scramble
    (歩車分離, scramble and pedestrian-only phases) the four play in turn round
    all its crosswalks, piyo, piyo-piyo, kakko, ka-kakko, 1.5 s apart, and its
    diagonals have none (the guideline's own rule; a crosswalk passing within
    6 m of the junction's middle counts as a diagonal). The guideline asks for timer
    switches and lower volume where the calls disturb residents at night, and
    the published lists (Toyama's, for one) run most from 7:00 to 20:00 or
    21:00. Minato ward notes that most in Tokyo stop at night and early in the
    morning. So the calls play from 7:00 to 20:00, are softer in the hour
    either side, and are off from 21:00 to 6:00. The push-button that brings
    them back at night isn't modelled. The chick is a sine chirp (2.3 kHz up to
    3.3 kHz and down to 2 kHz in 0.13 s, a touch of its octave). The cuckoo is
    two sine notes a major third apart (830 Hz, then 665 Hz held longer).
  - **Australia**: the push-button box's slow locator tick on red, the falling
    "zap" as the walk comes on, then its rapid tick through the green.
    **Hong Kong**: slow pips on red, rapid pips on green. **The Netherlands**:
    the *rateltikker*, a slow knock on red and a fast rattle on green. These
    are heard only within about 20 m of the box, the nearest two at a time, at
    half volume from 23:00 to 6:00. **France** has none by default: Paris's
    *répétiteurs sonores* speak only when a blind walker's remote control asks
    them to.
  - `tools/game_check.js` checks it in every city with signals: by day, at the
    principal scramble if the city has one (otherwise at the nearest
    signalled junction), the country's calls play during the walk and
    none in the traffic's turn, none from a scramble's diagonals, and none
    while the game is muted (`tools/walkcalls_step.js`; on its own, quicker:
    `xvfb-run -a node tools/walkcalls_check.js shibuya osaka sydney`).
    `node tools/walkcalls_wav.js out.wav` renders every kind offline to a WAV
    to listen to.

`tools/traffic_check.js <city>` measures the flow headless at three places (the
game's own frame loop stopped), with the surveyor on a kerb beside the roads,
not standing in one. Sydney before the junctions, with them (the first two
columns, measured then), and now with the banned turns, the lanes, the arrows,
the walk signals and the unsticking above, against main just before (150 cars
over 112 s at each place):

| | Before | Junctions | Main before this | This, before the rides' changes | Main with the rides' changes | Now |
|---|---|---|---|---|---|---|
| Standing still | 39% of the time | 25% | 21% | 19% | 27% | 28% |
| Jammed (still 30 s or more) | 13.4% | 2.5% | 3.8% | 0.7% | 3.8% | 4.2% |
| Mean speed | 18 km/h | 23 km/h | 26 km/h | 26 km/h | 21 km/h | 21 km/h |
| Longest still | 150 s | 111 s | 138 s | 72 s | 144 s | 150 s |
| Red lights run | (no lights) | 0 | 0 | 0 | 0 | 0 |

Main took in the rides' work (a step into another car taken back, cars kept
off posts and trunks, a ride's priority at a red) while this was being
finished; with both, the jams are back to about main's own, and a few cars
stand the whole run where a car leaving a junction is caught against the
queue coming into it on a short arm (`tools/traffic_why.js sydney 2` shows
one). That is left for the follow-up issue.

The other cities, jammed share and longest still, main before this and this
branch before the rides' changes:
Tokyo 0.9% and 76 s, now 0.8% and 50 s; Osaka 1.5% and 105 s, 1.2% and 74 s;
Paris 3.1% and 120 s, 2.6% and 104 s; Hong Kong 5.0% and 138 s, 3.8% and 116 s;
Kyoto 6.2% and 148 s, 1.8% and 89 s; Melbourne 4.9% and 121 s, 2.7% and 146 s;
Shibuya 2.7% and 103 s, 1.0% and 105 s; Amsterdam none either way; Melbourne's
bayside, over six places, 2.9% and 140 s, now 3.2% and 146 s. A run is the
same each time only roughly: a small change anywhere moves every car after it,
so a single run's jams swing by a few points either way, and the cars caught
up in a crowded junction in one run are elsewhere in the next. No junction now
lets in two movements that cross (Melbourne's bayside did, on main: a car let
in by one way that asked again by another wasn't checked).

**The jams brought back down (issue #51).** `tools/traffic_why.js` found
three knots behind the 150 s stands. Two cars at an angle (a bus leaving a
junction beside the queue coming in round a bend) read as touching though
nearly a metre apart, because footprints were told apart only on the moving
car's axes; the bus was held in the junction and, having it to itself, locked
it. The overlap test now separates on both cars' axes. The swing out round a
car parked beside the lane was measured from where the car already was, so it
stopped half way out and stood behind the parked one for good. And a car that
left a junction onto a short stub ending in nothing turned round at full
speed and was found over the junction's line: such stubs are now left out
when there is another way, a car slows to turn round at a road's end, and it
never turns at speed. A car that has gone nowhere for a minute (a minute and
a half in a queue), however it edged or turned where it stood, comes back
elsewhere when out of sight. Sydney with these alone: jammed 0.9% (3.6% on
main), longest still 60 s (150 s), cars over a line 5 (24). With the lane
arrows and the crossings between junctions (whose red lights hold the traffic
as the real ones do) every city under `tools/traffic_all.sh`, three places
each, against main before (jammed, longest still): Sydney 2.1% and 89 s
(3.6% and 150 s); Melbourne 2.0% and 68 s (1.5% and 129 s); Melbourne's
bayside 5.7% and 148 s (3.1% and 140 s); Hong Kong 4.0% and 144 s (4.7% and
147 s); Tokyo 1.7% and 90 s (0.9% and 62 s); Shibuya 4.0% and 140 s (2.9% and
130 s); Osaka 2.0% and 89 s (2.0% and 93 s); Kyoto 1.6% and 88 s (1.0% and
79 s); Paris 3.0% and 91 s (2.6% and 79 s); Amsterdam 0.8% and 71 s (0.9% and
85 s). No junction lets in two movements that cross, no car runs a red. Kyoto
and Osaka fail the wall check on main as here. A single run swings by a point
or two with any change (Sydney's six places measured 1.2% to 1.9% between
equivalent versions), so read these as a direction, not a decimal.

The traffic's update costs about 3.2 ms a frame for 150 cars on the software
renderer here, against 3.4 ms on main with the rides' changes (2.2 ms against
2.6 ms before them), measured the same way: the way ahead is sampled walking a line's
segments on from the last point instead of searching them for every point, the
cars more than 160 m from the eye (along x and y) take a step of two frames
every second frame, and the signal heads re-light only a junction whose signals
changed. The lanes, arrows and walk signals cost less than that saved. The low
quality tier runs a third of the cars.
- **Vehicles** (`web/game/vehicles.js`): the helicopter and ferries every city
  shares, modelled in Blender (see [the vehicles](#the-vehicles)). If their
  files can't be loaded, stand-ins built from `web/game/kit.js` take their
  place: lofted hulls, lathes, slabs, fins, rods and tubes at real dimensions,
  merged into one mesh per material, adapted from the vessel kit of an earlier
  reef scene.
  - **Ferries keep apart:** under way a vessel keeps to the starboard side of
    its course by up to its beam, as far as the water allows (the whole hull
    and half a metre round it over open water, worked out every 10 m of each
    leg), so two on the same course pass port to port, close to the banks in a
    river as narrow as the Dotonbori. Where the end of a leg left the hull over
    the bank, the vessel berths short of it. A berth takes one vessel at a time: one bound for
    a busy berth waits off it, behind any others waiting there on other routes
    (a hull length and 30 m farther off for each), one closing on another ahead
    on the same leg keeps its distance, and none starts out alongside another.
    A leg too narrow to pass along has a passing place where the two hulls stay
    clear all the way past, measured hull against hull (on a bend a hull's ends
    swing out of its line); one leaving a berth waits for a vessel still coming
    in past it, but not for one lying there or off the berth waiting for it;
    so on a narrow leg the place to wait off a busy berth is one where the one
    leaving can go by (else the passing place), and one waiting there stays put
    until the one leaving is past it; one that came up as the berth turned busy,
    too late to stop there, stops at the next such place nearer the berth, or
    goes slowly astern to one behind it. One leaving along the same leg towards
    a vessel coming in doesn't make the berth busy for it: they pass, and on a
    leg as short as Amsterdam's F3 ferry across the IJ the two no longer hold
    each other at the passing place for good. Shared narrow water, where a course runs
    head-on against another route's (Paris's two Batobus routes along the same
    stretch of the Seine), is taken one way at a time, as a single-track
    railway's section is: each course's stretches, longer than two hull lengths,
    where a hull would come within a metre of one on the other course, are
    worked out when the city loads; one in the stretch, or too near to stop
    short of it, holds it, of two closing on it the nearer goes first, and the
    other waits just short of it, where it is clear of the other course all
    along. One lying still across another route's course is stopped short of,
    and after half a minute held, two held by each other go on by; one held by
    a vessel waiting for its own reasons edges by it if their hulls need come no
    nearer than touching, and else waits on, up to two minutes. Two under
    way on courses that meet within 8 s: the one that can stop short of the
    other's course gives way; one lying still, or at its berth, sets off only
    when nothing coming by would meet it in the next 30 s; and a place to wait
    off a berth keeps 3 m clear of every course out of it, other routes' too.
    Before
    this, Sydney's Sirius and Charlotte lay in the same berth at Circular Quay,
    two of Tokyo's water buses waited on top of each other off Hinode, and
    Tokyo's ferries and Osaka's Dotonbori boats could end up each waiting on the
    other for good.
  - **Helicopter:** the assisted model, with collisions against buildings and
    landmark solids. It slides along a wall it meets at a glancing angle and
    bounces off a hard hit. The flight handles the way the helicopters of
    open-world games do (GTA V, Just Cause), the way a pilot flies a
    coordinated turn (issue 335; `vehicles.js` `helicopter`, measured by
    `tools/heli_feel.js`, filmed by `tools/heli_film.js`):
    - the way it goes follows the nose: the sideways slip dies away in a
      quarter of a second. Before, the old velocity carried on as it turned,
      so after a turn at speed it drifted backwards and sideways like a puck
      on ice (160° off its nose; now 12°);
    - let go of the stick and it settles to a hover in 3.5 s (it coasted for
      10.6 s). Pull back while going forward and it brakes hard (2 s from top
      speed) before it backs away, slowly (12 m/s at most);
    - it turns 1.3 rad/s at a hover and 0.75 at top speed, in a banked arc,
      rather than spinning at the same rate however fast it went;
    - the attitude comes from the flight: nose down to speed up and to hold
      speed against the drag, nose up (a flare) to brake, and banked by as much
      as the turn needs (tan bank = speed × turn rate / g, up to about 29°).
  - **The chase camera in the air** rides on the helicopter, its climbs eased.
    Before, a lag behind it, eased frame by frame, grew with its speed and with
    the frame time: at speed with uneven frames the helicopter wobbled in the
    picture by 6 cm a frame (now 1 mm). The camera swings back behind it 0.9 s
    after you let go of the mouse (1.6 s before), faster the faster it flies,
    and looks a little ahead into a turn. It sits 20 m back (24 before), pulls
    back by up to 4 m and the lens widens by up to 6° with speed.
  - **Changing view** (<kbd>V</kbd>: chase, cockpit, bird's-eye) is a 0.45 s
    ease-out from the old view to the new, which travels with the helicopter,
    not a cut. The reef sites' helicopter (`reef/boats/control.js`) also turns
    more slowly at speed and banks by what the turn needs.
  - **Getting in,** as in GTA and Sketchbook: <kbd>E</kbd> walks you round to
    the pilot's door (round the nose from the far side). The door swings open
    on its hinge, you step up onto the skid and slide into the seat, and the
    door shuts at once. A line on screen says what is happening, the camera
    swings round to watch, and the rotor spools up until it can lift at 90%.
    Getting out is the same the other way round, once you have landed. The
    moves are in the helicopter's own frame, so they work wherever it lands.
  - **The cockpit view** (<kbd>V</kbd>): the pilot's eyes, pitching with the
    cabin and banking with it by half: the bank still reads, but the whole
    city doesn't swing round the screen. The view looks past the instrument
    panel and through the windscreen. Drag to look round; in flight the view
    drifts back to straight ahead.
    - **What the pilot sees** (issue 335). Flight sims' pilot views (MSFS's VFR
      view) show mostly the world outside, and their players' most common
      complaint is an eye too low, too close to the panel, or looking at the
      controls. Ours had the opposite fault: the eye was level with the
      windscreen's top under a low cabin roof, 0.4 m behind the glass. A centre
      post ran down the middle 0.8 m away, and the painted nose cap closed the
      view ahead. The cabin was rebuilt in `blender/build_vehicles.py`:
      - **A one-piece bubble windscreen**, as the H125's and H130's are. The
        windscreen runs on over the nose cap almost to the tip. Its two halves
        overlap over the middle, and its gasket runs round the outside only, so
        there is no centre post.
      - **The instrument panel and glare shield** sit 10 cm lower and are
        shallower.
      - **`Eye_Pilot`** moves 0.14 m forward and 0.10 m down: leaning to the
        cyclic, under the windscreen's top.
      - **In the game** (`game.js` `COCKPIT`): a 66° lens looking almost level.
        While the view is up, the glass is thinned to faint reflections (its
        clear coat mirrored the sky from inside), and the outer skin is drawn
        from outside only, so the gap in the lining under the nose is a chin
        window onto the ground. The lining is a cabin's dark grey, not near
        black.
      - **The pitot tubes** are short and sit on the roof's front edge, above the
        pilot's view, as on the H125. They ran half a metre forward over the
        glass, two bars across the cockpit view.
      - **The foot of the view** is cleared. The game leaves out the gaskets
        (a black arc round the nose), the lining of the nose's lower half, and
        the wire cutter under the nose (a grey fin through the chin window),
        all built as their own materials (`Gasket_Chin`, `Lining_Nose`,
        `Cutter`). With them gone the pilot looks down through the nose to
        the ground. From outside they are all there. `PICK` in
        `tools/cockpit_shot.js` names what of the helicopter is under a point
        of the picture, which found them.
      What still frames the view is the A-pillar between the windscreen and the
      pilot's door, which the door's seam leaves no room to narrow.
      `tools/cockpit_shot.js` takes stills of the variants from the same place
      over Sydney Harbour.
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
  - **GPS route:** the way you can actually go, drawn on the minimap and in the
    world (see **Routes** below).
  - **Dialogue:** typewriter text.
  - **Stamps:** saved in the browser. Your position, car and clock are saved every 30 seconds of play and whenever the tab is hidden or closed, so **Continue** on the title returns you to where you stopped.
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
    maxima. It comes down behind the player, who faces the way they flew, or, at a
    landmark, faces it with the camera swung round behind them.
  - **Trig stations:** one turn on the spot, over the player's shoulder with a longer
    lens. The names are the result of a line of sight through the 2 m surface model to
    just under each roof within 3 km. The surface model includes the Opera House
    shells and the bridge deck.
  - **Buildings:** no shot puts the camera inside one. Each pose is kept 3 m above the
    surface model under it.
- **The whole city on the big map** (`region` in `web/game/game.js`): a city drawn as maps
  of its own (a metro group in `cities/index.json`: Kyoto, Tokyo) is one world on the big
  map, as the world maps of Genshin Impact, Breath of the Wild and Ghost of Tsushima are:
  the entry point you chose is no commitment, because the map always shows where else you
  can go. Zoom out past this map, or press "All of Kyoto" over its corner, and the other
  districts are where they really are: each map's frame (`frame_m` in `cities.json`, written
  by `pipeline/build_scene.py`), dashed, its name in its corner, its stations as accent
  diamonds and the railway lines between them drawn faintly underneath. A district wholly
  out of view is a chip on the map's edge pointing to it with its distance, as games point
  to an objective off screen; the travel list has them under "Elsewhere in Kyoto". Picking
  one, or a spot inside another map, shows its card (the guide's line for it) and **Go to
  Higashiyama** saves here and loads that map at that station (`#play-<map>@<travel id>`).
  On the title screen, Play on such a city names the station it starts at
  (`web/metro.js`), so it reads as a choice made, not a default. Check:
  `tools/region_map_shot.js` (stills and the trip) and the region step of
  `tools/game_check.js`.
- **Map travel** (`travelTo` in `web/game/game.js`): the map lists every landmark the
  city labels (`scene.labels`), its travel points, trig stations and wharves, your car
  and the start, nearest first within a group; a pin on the map does the same, and a
  click anywhere else drops a waypoint you can travel to. It works at any time on foot,
  in your car (the car comes too, parked at the kerb nearest the spot) and in a taxi
  (it lets you out and drives off). From the helicopter, a ferry or the funicular you
  get off first. Where a landmark puts you:
  - **How far back:** about 1.4 times its height, or twice its breadth and 40 m when
    that is more (45 to 520 m; a tower taller than that allows is not tried nearer). The breadth is the median, over 16 bearings, of how far
    the surface model stays above 30% of its height out from its label, a street's gap
    ending it.
  - **What it is:** its body is the surface model's cells of its own buildings (named as
    its label, in either script, within 150 m), or of the buildings under its label, and the
    high part within 40 m of its label whatever building those cells were drawn for (Shibuya
    Scramble Square's floors over the station). Its tops are sampled, and along its edges
    its walls at a quarter and 60% of their height. A part over its roofs that the surface
    model leaves out (HEP FIVE's wheel, a mast) is a column of points at its label up to the
    label's height, as many as the buildings have; with no buildings under it (the Eiffel
    Tower's open iron), the column is all there is. Each point weighs by its height: a tower
    is known by its upper floors, not the podium round its foot.
  - **Which side:** spots on four rings round it (0.45, 0.7, 1 and 1.35 times the distance
    back) are scored on what the camera behind you will see from there: the share of the
    body's points in the frame (for the screen's own shape, a phone's narrow one too) with a
    clear line to them from the lens, every 2 m through the surface model until it meets the
    body itself (a wall of it in front of a point counts as seen, but not in front of a point
    of the part over its roofs) and through the mapped trees' crowns; less the share the
    frame's edges cut off, and more again for its upper third off the top; and more for
    filling a good part of the frame's height. A slot down a street of offices sees only its
    top over the roofs, so a square, a riverbank or a wide road that sees it whole wins.
    When no ring sees 60% of it (a short building among towers), every open spot on a grid
    round it is tried. Then the sun behind you by day, open ground round the spot (the share
    of two rings 6 and 14 m out with nothing over 3 m; wholly open counts for as much as half the
    landmark in sight), the street rather than a roof, out from under a walkway or a flyover
    (for you and the camera), out of the haze the model's edge fades into (standing in it
    veils everything round you, the near things too), and room behind you for the chase
    camera (the same test the camera rig makes, and no crown in front of the lens). A spot
    whose camera is blocked is tried again a few steps either side, nearer and further.
  - **Fronts and hand-picked spots** (`arrivals` in `cities/<id>/city.json`, keyed by the
    label as shown): for the few landmarks the search gets wrong, `front` is the compass
    bearing the landmark's front faces (the National Diet looks east over its garden), and
    the arrival keeps within `arc` degrees of it (70 by default), preferring straight in
    front; `dist` sets how far back to stand; `top` frames a lower part than the label's
    top, in metres above the ground (Kabuki-za's theatre rather than the tower behind it);
    and `at` is a spot `[x, y]` in the local frame to stand on, facing the landmark, or facing
    `look` `[x, y]` where the landmark's middle is the wrong thing to face (Fushimi Inari's
    Senbon Torii: at the mouths of the two tunnels, looking in, not at their middle in the woods).
    `python pipeline/scene_config.py --city <id>` copies them into `scene.json` without
    rebuilding the scene, and `node tools/arrival_probe.js <city> <names>` prints where
    each arrival lands, its best-scored spots, and a character map of the surface model,
    the water and the main roads round it, for choosing them.
  - **The camera:** behind you and a little to one side, so the landmark stands just off
    your shoulder, at the pitch that puts its top a little under the frame's top edge. A
    camera can't go under your head to look up (it would be in the ground), so for a tall
    landmark it stays just over your head and tilts up instead, by up to 15°, which puts you
    low in the frame under it; the tilt eases off when you move, steer or drag the view.
  - `tools/travel_shot.js <city> <out> [width height]` takes a still on arrival at each
    landmark and prints how much of its body the camera sees (the same measure, from the
    camera the game drew with); under 30% is a MISS. `ARRIVALS='{"Label": {...}}'` tries
    `arrivals` entries before they go in `city.json`, here and in `arrival_probe.js`, which
    also prints the body each landmark was given.
  - **Zoom and pan:** the wheel (or a trackpad pinch, or <kbd>+</kbd> and <kbd>−</kbd>) zooms
    the map about the pointer, from the whole city to about a metre a screen pixel; a drag
    pans it, and on a phone two fingers pinch and pan. Buttons in its corner zoom in, out
    and back to the whole city. The names are laid out afresh at each zoom, so the ones
    the whole city crowds out come back as you zoom in, and a picked place's card follows
    its pin. The zoom is kept while the map is closed. `tools/map_shot.js <city> <out>
    [phone]` takes stills of it at the whole city, zoomed into the thickest pins, panned
    and with a pin picked.
- **Neighbourhoods** (`web/game/places.js`, game.json `areas`, `spots`, `chatter`):
  - **Areas:** a circle round a station. Walking in puts up its sign: the name, its
    reading, the line's colour band and the stations either side. Where circles
    overlap, the smaller one wins. A sign waits until a camera move ends.
  - **Spots:** <kbd>E</kbd> within a few metres opens a few lines. A spot with
    `"pick": 1` shows one of its lines at random. A quest step
    `{"type": "spot", "spot": id}` waits for one.
  - **Look closer:** a spot with a `look` is a photo spot. <kbd>E</kbd> brings the eye
    to about a metre off the thing, the walker out of the way, and you look along it:
    <kbd>A</kbd>/<kbd>D</kbd> (or the stick, or the panel's arrows) along,
    <kbd>W</kbd>/<kbd>S</kbd> between its rails, a drag turns your head, <kbd>Enter</kbd>
    saves a photo and <kbd>E</kbd> or <kbd>Esc</kbd> steps back. The panel reads out what
    hangs in the middle of the view: at Suga Shrine's ema rack, the wish on the ema you
    are looking at (`look.tablets` place each ema as the mesh hangs it, from
    `rack_layout` in `cities/shibuya/city.py`). The atlas holds each ema at 192 by 128 px
    for its 15 by 10 cm, 1280 px a metre, more than a 1440 px wide desktop shows of it
    from 0.95 m.
  - **Up close** (game.json `close`, a spot's `reach`, from the landmark builders'
    `game_extras`): the things people walk up to, each a point on the thing, where a
    walker starts towards it, how near they must get and how near they cannot.
    `tools/game_check.js` walks up to every one (`tools/close_step.js`;
    `tools/close_check.js <city> <out>` alone, with a still of each).
    `python pipeline/game_extras.py --city <id>` rebuilds them, the spots, the chatter and
    the walkable surfaces from `scene.json` in seconds, without the raw downloads.
  - **Chatter:** a conversation at a place, one line every few seconds in a bubble
    over where it is said, once you are within earshot. It stays quiet for a while
    after it ends.
- **Lifts and escalators:**
  - **Lifts** (game.json `lifts`): a list of stops, each a point with a height.
    <kbd>E</kbd> at a stop takes you to the next one. The camera climbs the
    building with you, and the time is shortened from the lift's own speed
    (`m_per_min`). The player arrives facing the stop's `face`.
    A stop with no footway near it (Queenstown's glass lift down to the luge track) is joined to the route network
    over the ground, and the gold line breaks at a lift on the minimap and the map as in the world. A start up on a
    deck (`game.start.z`, Queenstown's Skyline deck) spawns on the floor at that level, and `tools/game_check.js`
    measures its kerb from the foot of the lift that serves it. Every lift is ridden up and down in the check.
  - **Landings past the frame** (game.json `outposts`, `pipeline/outposts.py`): a ferry can call at a wharf beyond the
    map's edge. Its leg is routed over the real lake past the frame, the far wharf and the ground round it are a tile
    of their own (`web/outposts.js`), and the game walks there as anywhere. <kbd>F</kbd> skips a long crossing in
    about 40 s, and waiting for the boat takes about a minute at most. The check sails there, goes ashore and walks
    to the landing's largest building.
  - **Escalators:** a walkable strip with `moving_ms` carries whoever stands on its
    moving stretch (`moving_u`) along its axis, so a way down is a strip whose axis
    points down the flight (SHIBUYA SKY's west escalator). You can walk on it too.
    `tools/game_check.js` stands on each and checks that it carries you to its far end.
  - **High floors:** a travel point with a height (`[x, y, z]`) lands you on a roof.
    `always: true` lists it on the map before you have been there.
- **Sound** (`web/game/audio.js`): synthesised with Web Audio, with no files.
  - no ambience bed: the low rumble under everything was taken out (the owner found it strange); the city is heard in its crowds, traffic, screens and signals;
  - footsteps on the walk cycle;
  - rotor chop at the blade-pass rate;
  - ferry engine and horn;
  - dialogue beeps.
  - the score is its own module (`web/game/music.js`, see [The score](#the-score)).

### Doors and rooms

A city can open its landmarks to walk into (Queenstown's St Peter's, Williams Cottage and the Skyline
restaurant: `cities/queenstown/interiors.py`, issue #315). Its builder draws each room inside the
landmark's shell, with the shell's walls cut where its door and windows are (`pipeline/archkit.py`
`holed_wall`, `reveal`, `pane`), and gives the game three things:

- **The floor**, a strip (game.json `surfaces`), so that a walker stands on it at its own level, whatever
  the bare earth under the building does. Walls, pews, tables and counters are landmark meshes and stop a
  walker as any landmark does (`web/game/nav.js`). The collision world's cells are a quarter of a metre, and
  a wall at an angle to them takes up to a cell more each side of a doorway in it: a real door narrower than
  about 1.25 m (Williams Cottage's, 0.95 m, on walls at 44 degrees to the grid) would not let a walker 0.7 m
  across through. So a door gives its doorway's frame (`frames`: `{a, b, t, z0, z1, top}`, the two jambs'
  faces on the wall's middle line, the wall's thickness, the sill, the head and the wall's top;
  `interiors.py doorway()`), and nav.js leaves the quarter-metre cells out within 0.6 m of the opening along
  the wall and 0.3 m off its faces, from the sill up, and stands the jambs and the head there as exact boxes
  (#326). `tools/game_check.js` checks each frame: a walker stands in the opening, and the wall 0.2 m past
  each jamb is solid. The Skyline restaurant's 1.8 m sliding doors give none: its planted bed comes within
  the frame's reach of the glass.
- **The doors** (game.json `doors`: `{id, name, at, reach, time, leaves, frames}`). Each leaf is the landmark's own
  mesh, drawn shut, and not a wall. `web/game/doors.js` swings it on its hinge (`hinge`, `deg`) or slides it
  (`slide`) as someone on foot comes within `reach` metres, sooner the faster they come, and shuts it a moment
  after they have gone. Only you open them: the locals stand or sit where they are, and a diner at a table by the door would otherwise hold it open.
- **The rooms** (game.json `interiors`: `{id, name, note, floor, height, ring, door, way}`). Stepping into
  one shows its name. `way` is a walk from in front of the door to the room's middle, which
  `tools/interior_step.js` (in `tools/game_check.js`) walks in and back out, checking the door was open in
  the doorway, the walker ended on the room's floor, and the door shut behind.

Inside, a room's meshes take only part of the sky's light (`Mesh.sky`) with the floor's colour coming back
up. After dark its walls, floor and lamps glow warm (floodlit materials), and lamps and stained glass glow by
day too (`glow_day`). The furnishings carry `far` (110 m; 60% of that on a small device, `web/world.js`), so
a phone draws the room's shell and lit windows from across town and its pews and tables only nearby. An NPC
with `sit` (`{face: [dx, dy]}`, at `[x, y, z]`) is placed exactly there, seated, facing that way.
One with `stand` (`{face}`, at `[x, y, z]`) stands exactly there on their feet: behind a bar, on a stage.

A hall on a podium that is itself a building (the Opera House's) gives its floor as a strip too, level with the
roof it lies on: near a strip on a roof `web/game/nav.js` reads the landmark's walls, doors and furniture into
its quarter-metre cells from the deck up, and not as 2 m cells from the ground under the building. A room may
open off another (the stalls off the foyers): `tools/interior_step.js` asks only that you have left the room
you walked out of.

### Seats and shows

A city can offer seats to take and a performance to watch from them (game.json `seats` and `shows`, from its
landmark builder; `web/game/show.js`). Sydney's are in the Opera House (`cities/sydney/opera_inside.py`): the
stalls of both halls, chairs along the northern foyers' glass, a table at Bennelong.

- **A seat** (`{id, name, verb, at, face, eye, pitch, show}`): within a metre and a half, <kbd>E</kbd> offers
  its `verb` ("Take your seat", "Sit at the table"). Seated you look out through your own eyes from `eye`
  metres over the seat, the way it faces; drag to turn your head; <kbd>E</kbd> stands you up where you were.
  Your own figure is not drawn from the seat (photo mode draws it again).
- **A show** (`{id, venue, title, act, by, sung, stage, singer, dim, bpm, a_hz, end_beat, melody, bars, lines}`)
  begins when you take a seat that names it. The house lights (`dim`, mesh names) go down as the oboe gives
  the A, the house claps the conductor in, and the scene is sung by the NPC `singer` on the stage, with its
  lines as surtitles: the line as sung and, under it, in English. It ends in applause and plays again while
  you keep your seat. The city's score rests while it plays (`web/game/life.js`).
- **Nothing is recorded.** The voice is synthesised in the browser as a source and filter: a sawtooth
  through five formant band-passes (the alto table in the Csound manual's appendix "Formant Values": numbers,
  used as data), with vibrato that comes in a fifth of a second after a note's start, a glide between slurred
  notes, a breath of noise and a lift near 3 kHz, the singer's formant. Under it the cellos' ostinato and
  pizzicato strings are plucked triangle and sawtooth tones, the tambourine and the applause are filtered
  noise, and the hall is a convolution with 1.5 s of decaying noise. Sydney's show is the Habanera from
  *Carmen* (Bizet, 1875; libretto by Meilhac and Halévy; the tune after Iradier's *El arreglito*, 1863): music
  and words are in the public domain. The notes (`cities/sydney/opera_score.json`) were transcribed from a lead
  sheet and checked against the themes in Barlow and Morgenstern's dictionary; the syllables under them outside
  the first phrase and the refrain were set by count, not from the vocal score, and the major-key repeat, the
  chorus's in the opera, is given to the soloist. The English lines are this project's own. What was looked at
  and not adopted: Pink Trombone (Neil Thapen, MIT), an articulatory model, heavier than a formant voice needs.
- `tools/seat_step.js` (in `tools/game_check.js`; on its own, `tools/seat_probe.js`) takes one seat of each
  kind: the action must offer it, you must be seated at it looking its way with your eyes 0.8 to 1.5 m over
  it, and stand up on foot; at a show the clock must run, the lights go down, the singer sing and the first
  line's surtitle read as written.

## Routes

The gold line (`web/game/route.js`) leads to the objective, or to a waypoint
clicked on the map, by the way you are going, and only where you can go. Every
point of it is tested with the same nav (`web/game/nav.js`) that moves the
walker, the car and the helicopter, so it never runs through a building, off a
drop or into the water.

- **On foot:** over a network built from the mapped footways and streets, behind
  the title screen in slices (a second and a half of work in Amsterdam on a
  desktop, two in Paris; the line shows once it is done):
  - the lines are split where they cross at about the same height (not where a
    bridge passes over a street) and where one ends on another, so a route can
    turn there;
  - each stretch is walked in 2 m steps with the walker's own test, moved up to
    3 m sideways off a wall it grazes, and cut where it runs through a building
    the model shows as solid (an arcade, a passage under offices: in Sydney one
    mapped footway in ten runs into a building somewhere);
  - the walkable surfaces the lines don't cover (the Harbour Bridge's whole deck,
    Amsterdam's 224 and Paris's 28 bridge decks, the Opera House steps) get a
    lattice of lines 6 m apart; lifts (SHIBUYA SKY) are links the line breaks at;
  - loose ends, and pieces of the network cut off from the rest, are joined to the
    nearest other piece within 12 m by a straight line a walker can walk, or round
    whatever is in the way over the ground (a tunnel cut out of the data, the end of
    a deck);
  - from where you stand onto the network, and from it to the target, an A*
    search over a 1.25 m grid of the ground, walked as the walker walks (no step
    higher than a kerb, no drop either way). A target inside a building is reached
    at the nearest place to stand. Where the network has no way and the target is
    within 1.5 km, the search goes over the ground all the way;
  - where there is no way on foot at all (across the IJ, the harbour), the line
    leads to the wharf of a ferry that calls nearest the target, and says so. A
    step that needs the helicopter (fly under the bridge, land in the Domain)
    leads to the helicopter first.
- **By car:** the road route the taxis drive (`OECars.router`), on your side of
  the road, drawn on the lane. A road the car doesn't fit along (a building over it
  in the model, a motorway viaduct, which isn't drivable) costs twenty times its
  length, so the route takes it only where there is no other way; the traffic
  doesn't turn into one.
- **Flying:** an A* search over the tallest thing in each 16 m cell (terrain,
  roofs, decks and the landmarks' solids, widened by a cell), where each metre the
  way rises over the usual 120 m costs as much as a long way round: it goes round
  a tower, over a low district. The height keeps 30 m over whatever is near, climbs
  and comes down no steeper than the helicopter, lifts straight off and comes
  straight down onto a spot with room for the rotor: a helipad near the target
  (not one mapped under a tower), else level open ground with nothing over it within
  7.5 m. A step to fly under a span comes in low and goes straight across under it
  at the height with most room, clear of the pylons, the legs and the arches.
- **By ferry:** the vessel's own course through the water, to the stop nearest the
  target.
- **Drawn:** a quiet band laid on the ground, half a metre wide on foot and wider
  by car, on the floor under each point (street, deck, quay), and in the air
  turned to the camera. Slow, faint chevrons drift the way to go, a soft amber
  edge holds it on pale stone, it fades in a few metres ahead of you, out with
  distance (to a fifth by 320 m, 900 m in the air) and over the last ten metres,
  and at night it turns a dimmer, warmer amber, as sodium light on stone. The
  stretch behind you disappears as you go. It is worked out again when the target
  moves, when you stray from it (6 m on foot, 14 m by car, 70 m in the air) and as
  a ride goes on.
- **Shown:** the menu's Route line is On, Only when I ask or Off, remembered in
  the browser (`oe-route-line`). When it isn't On, <kbd>L</kbd> or Show route in
  the quest card brings the line up for eight seconds. Whichever, the minimap
  keeps the route, as the quiet reference. The line eases out while a
  conversation, the menu, a map, photo mode or a camera shot is up, and comes back
  after. As in most open-world games' GPS lines (a setting to turn the world line
  off, the minimap kept), learned from their design, not their look. The reef sites
  have no line in the world (a compass and a marker), so the setting is the cities'.
- **The crowd and the traffic** walk and drive the same data: the crowd now keeps
  to the footways where a walker can stand (cut where they run into a building),
  and the traffic doesn't turn into a road a car doesn't fit along.
  - A walker keeps 0.6-1.8 m left of its line, and up to 1.5 m more to dodge.
    Every third step it looks beside itself and 1.5 m ahead for a wall at that
    offset (`clear`, nav's room for a body 0.3 m round), and takes the nearest
    offset with room, in towards the line or past it; its offset moves there no
    faster than a sidestep, so it closes in on a facade and never jumps. In the
    game check 2 to 4 walkers in 2,000-3,000 are in a wall at a time.
  - A car looks along its way ahead every half second (every frame on a road
    route.js flags) for a wall at its lane: where there is room down the middle
    of the street it keeps to the middle; where there isn't, it brakes as for a
    car stopped there, and after a second and a half stopped it turns round, or
    out of sight leaves the traffic for elsewhere. A car on a flagged road when
    the flags arrive (a second or two after the start) leaves it at once if it is
    out of sight. In Shibuya the share of car-time inside a wall fell from 2.5%
    to 0.5% (`tools/traffic_check.js`, which now counts it).
  - How far in from its lane it moves for a facade is measured from its own
    lane, not from where it already is (it stayed half way in, brushing the
    house), and it stays in until its back has passed the place, however long it
    waits there (a car stopped in a queue beside a house drifted back out into
    it once a timer ran out). On Osaka's narrow streets the car-time in a wall
    fell from 0.8-1.1% to 0.2-0.5% at `traffic_check.js`'s places; it now lists
    where (`in a wall at ...`: the road, the lane, how far from its line, what holds
    the car and what it is in).
  - **Roads into a building** (`pipeline/road_passages.py`, run by
    `tools/road_passages.sh <city|all>`): where the data runs a road into a
    building or a canopy's post, the traffic used to stop at the wall
    (`cutAtWalls`) or keep off the road (route.js). `tools/road_walls.js` lists
    each such stretch with what is in the way, by the game's own collision; then
    a footprint that only clips the road (at most a quarter of it, at most a
    metre deep into a tall one) stands back from it; a road into or through a
    building with 2.5 m of it over a 4.5 m clearance gets a passage, with a
    ceiling (Osaka's OCAT bus terminal and Minatomachi River Place, the roads
    under the Loop Line's viaduct, an elevated road past a tower in Sydney); a
    main road (motorway to secondary) through a lower building trims it; and an
    arcade's post in a carriageway is left out (buildings.json `no_posts`, an
    Osaka shotengai). A lane between buildings on both sides that is only too
    narrow for a car (an alley) is left as it is, and so is a road through a row
    of low houses or a landmark. A one-way road that comes to a wall, or whose
    only ways on are roads the traffic keeps off, is kept off too (route.js), back
    up the one-way roads that lead only there, so no car waits at its end in
    sight. An elevated road with no deck under it where it runs into a tower
    (Sydney's at 22 and 33 m through one building) is measured from its own
    height, and a building with roads through it at two levels is carved for each
    in turn (`road_passages.sh` repeats until nothing changes). Footprints stood
    back, passages and posts left out: Osaka 491, 86, 22; Shibuya 151, 29;
    Kyoto 120, 19; Shinjuku 106, 23; Ikebukuro 51, 23, 3; Tokyo 42, 38, 2;
    Asakusa 26, 8; Roppongi 26, 6; Ueno 23, 5; Amsterdam 19, 28; Melbourne 18,
    10; Paris 17, 14; Akihabara 15, 5; Shinagawa 14, 19; Hong Kong 13, 15;
    Jinbocho 11, 3; Sydney 11, 9; Tsukishima 5, 5, 3. What `road_walls.js` still
    lists afterwards is mostly alleys and roads through landmarks (Odaiba's 41
    stretches, Amsterdam 32, Paris 21: issue #120). The
    game check counts the car-seconds in a wall (at most 1%), the cars waiting at
    a wall and the one-way roads into one.
  - **Passages through landmarks** (`pipeline/landmark_passages.py`, issues #120
    and #127): OpenStreetMap maps a way through a building as
    `tunnel=building_passage` and one under a roof open at the sides as
    `covered=yes`; Overture flags both (`is_tunnel`, `is_covered`) and names the
    ways, and `game_data.py` drops every `is_tunnel` piece with the city's real
    tunnels. The script reads the flagged segments (Overture on S3, cached in
    `data/raw/<id>/overture_passages.json`) and the ways' tags (OSM API by id,
    `osm_passages.json`), keeps the parts at the ground under a landmark's mesh,
    lists them in `landmarks.json` `passages` (points at the floor, width, and
    whether it is a floor through a building) and puts the dropped ones back in
    `game.json`'s paths (appended, marked `lp`). Through a building whose
    bare-earth model departs from the line between the passage's ends (under the
    Rijksmuseum it dips 2 m), `nav.js` takes the passage's floor for the ground
    in its corridor and 3 m either side. `pipeline/landmarks.py` measures them
    again after each rebuild. Ways that only run into a landmark's inside (a
    museum's doors, the Eiffel Tower's pillar) are left out (`INSIDE`), and ways
    a model doesn't open yet are listed `open: false` with what they need
    (`NOT_YET`: Central Plaza and the ICC's walk in Hong Kong, Crown's riverside
    walk in Melbourne, the Tombori River Walk in Osaka, Kiyomizu-dera's corridor and west gate; issue #161). Opened in the models: the Rijksmuseum's two side arches
    lead into aisles for walkers (the footways OSM maps 7.8 m either side of the
    cycle path), open to the cycle passage through an arcade, their outer walls
    glass, and the passage's vault now springs from the street's level, not the
    dip under the building (it sat 2 m low); the Imperial Palace's gates (Kyoto)
    stand on a 0.3 m platform a walker steps onto, face out of the wall they
    stand in (a near-square outline left the bays across the way), and a gate
    under 11 m has three bays, not five too narrow to pass; Saint-Sulpice's
    loggia (Paris) is recessed between the towers where OSM maps its walk, up a
    flight of steps across the front, square to the towers (8 degrees off north).
    Passages: Amsterdam 3, Kyoto 11, Paris 7, Sydney 11 (under the Harbour
    Bridge's approaches), Hong Kong 4, Melbourne 2, Akihabara 1, Asakusa 1
    (Nakamise under the Hozomon), Osaka 1. A wall beside a raised floor (a strip
    up to 3 m over the ground) is laid into fine cells from that floor, so that
    its 2 m cells don't come down to the head of someone on it.
- **Helipads on roofs:** a pad the data puts on the ground inside a building's
  footprint (Hong Kong's hospital and tower pads) is on the roof: there if it is
  clear above for the rotor, else on the nearest open ground with clear sky
  within 120 m (`game.js`; `pipeline/game_data.py` puts new data on the roof).

We looked at what navigates a 3D world in a browser before building this:
Recast/Detour (zlib licence) and its WebAssembly build recast-navigation-js
(MIT), three-pathfinding (MIT), PathFinding.js (MIT) and ngraph.path (MIT), with
GTA V's GPS, the ground guide lines of Marvel's Spider-Man and Watch Dogs, and the
"highway in the sky" of flight displays for the look. A navmesh baked for tens of
square kilometres of city would be slow to make in a browser and would duplicate
the game's collision, which is already exact; so the network here is the mapped
data, proved walkable by that collision, and no library code was taken. From the
games: the line on the ground with chevrons that run the way to go (Spider-Man,
Watch Dogs), the route that keeps to the roads in a car (GTA V), and for the
helicopter a line ahead in the air rather than a pointer.

## The vehicles

| The helicopter (Cycles render) | The ferry (Cycles render) |
|---|---|
| ![](images/vehicles/helicopter.jpg) | ![](images/vehicles/ferry.jpg) |
| **The river shuttle** | **The traffic: sedan, taxi, hatchback, SUV, van and bus** |
| ![](images/vehicles/ferry_river.jpg) | ![](images/vehicles/cars.jpg) |
| **Rotor wash over the harbour** | **A Kelvin wake at 16 knots** |
| ![](images/sydney/game-rotorwash.jpg) | ![](images/sydney/game-wake.jpg) |
| **The lake steamer (Queenstown's TSS Earnslaw)** | |
| ![](images/vehicles/ferry_steamer.jpg) | |

**The lake steamer** (`ferry_steamer.glb`, `ferry_style.model: "steamer"`) is the only single-ended
vessel: `vehicles.json` marks it `single_ended`, so it lies alongside as it came in, swings round
at no more than 8° a second once under way (slow ahead while it does), always leads with its bow,
and puffs coal smoke from `Funnel_Top`: soft puffs in the world's frame that rise, spread and drift
astern, darker by night.

**The gondola** (`rail.gondola`, `web/game/rail.js`) is a detachable gondola: cabins on a loop of
cable, up on the right and down on the left, slowing through each station round its bullwheel. A
cabin in a station can be boarded (E), and you ride standing in it to the other station. The line
is the city's (`game_rail` in `city.py`), the cable's profile with its sag between the towers.

**The trains** (`assets/vehicles/trains.glb`, 1.0 MB, `blender/build_trains.py`) are the Enoshima
Electric Railway's stock, one body of each two-car articulated set, about 17,000 triangles each with
a 7,000 to 8,400-triangle copy for distance past 170 m (its outside only, flat faces merged): the 300 series' last set (305, 1960; 24.1 m, 2.4 m
wide, pale green and cream, three windows in a flat face), the 1000 series (1979; 25.4 m, dark green
and cream with a gold line) and the second 500 series (2006; 25.4 m, 2.5 m wide, one curved
windscreen, a single-arm pantograph). Lengths, widths, roof heights, bogie centres (8.7 and 9.5 m),
wheelbases, wheels (860 mm) and floor heights (1.07 to 1.1 m) are the published ones (the Japanese
Wikipedia articles on each series quote the railway's tables); the faces, liveries and roofs follow
photographs on Wikimedia Commons; window heights, post widths, the underfloor boxes and the seats
are read off photographs and approximate. A body has its walls with real window openings, doors,
the floor, long seats, stanchions, strap rails and the cab's glazed partition, so the views from the
seat and from behind the driver look out through it. No lettering or logo of the railway is
reproduced: a set carries its number only. Ambient occlusion is baked into the vertex colours.

**The helicopter comes after the game opens (issue 148).** Its model is 3.7 MB, more than any city's
buildings once packed, and most games start on foot. `OEVehicles.load(..., { heli: 'later' })` leaves
it out of the wait; the game asks for it (`heli.want()`) once the helicopter is within 800 m of you
or you get in (`heliToPad`, `enterHeli`). Until it has come the pad stands empty; if you climb in
first, the kit-built helicopter stands in and the model takes its place once you are out and the
engine is off.

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
    hands are on the wheel. The top of the head keeps 6 cm under the roof over
    it, measured from the head as it sits: a tall person sinks up to 8 cm into
    the cushion, and one still too tall for that car sits a little smaller, so
    any of the crowd's characters can drive a ride. The inside of the shell is a
    dark lining, and the cabin is mirrored where traffic keeps right.
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

## The NPCs

| Every city's NPCs as the game draws them, waiting at their posts (`web/game/lineup.html?city=…`) |
|---|
| ![](images/people/npcs.jpg) |

**Loaded as you come near (issue 148).** Only the NPCs within 300 m of the start are loaded before the
game opens; the others are nobody until you first come within 300 m of them (`npcStream` in
`game.js`, twice a second, from the player or the helicopter), and then their character is fetched
and put in their place. One that can't be loaded stands in as a simple figure, as before. In a
city of a dozen NPCs that is half a megabyte to a few megabytes off the wait; `__game.npcsReady()`
loads all of them at once for the tools that look at them (`npc_shot.js`, `talk_shot.js`).

The people who send you out are Rocketbox avatars too, cast city by city for who
they are: police, pilots, a paramedic's jumpsuit for a bridge climber, a white
naval uniform for a water-bus captain, a chef, salarymen, students.
- **Cast in `city.json`:** an NPC's `look.character` names
  `R_<avatar>[_<head>][_<tag>...]`. `R_Security_Female_01_f003_plain` is Rocketbox's
  Security_Female_01 in her uniform, wearing Female_Adult_03's head (heads go by
  Rocketbox's model code) with the lettering taken off: Haruka, Tokyo Station's
  attendant. `blender/build_people.py --npcs` builds every character the cities
  name, one file each, and a character two cities name is built once.
- **Heads:** Rocketbox has 115 avatars but only four East Asian women's faces and
  four men's, so the Japanese and Hong Kong NPCs wear those heads on the bodies their
  jobs need, with hats, glasses or a mask where a face comes round twice in a city.
  Every avatar of a sex has the same skeleton (the build checks), so a head fits any
  body. The body's bare skin (hands, and arms or legs of the same tone) takes the new
  face's colour.
- **Tags:** `grey`, `white`, `brown` recolour the hair, on the scalp and the hair
  cards; `dark` and `navy` dye white cloth (Brother Sozen's robe is a dyed kurta);
  `bare` takes off a hat or helmet; `plain` covers lettering, badges and another
  country's flag with the cloth beside them (`INSIGNIA`), and takes off any weapon;
  `leopard` and `mariniere` print the pattern over the top, from where each texel
  sits on the body, as the shader paints the crowd's (Fumi's cardigan, Camille's
  Breton top).
- **Clips:** one file per sex (`R_clips_f.glb`, `R_clips_m.glb`, 2 MB each) drives
  every NPC of that sex: the gestures, and what each does while it waits
  (`look.clip`): `Documents` (writing on a clipboard), `Reading`, `Phone`, `Photo`,
  `Drink`, `Work`, `Present`, `LookAround`, `Thoughtful`, `Stretch`, `Cheer`. The clips
  are baked on one avatar; a bone that holds still keeps a key, so an avatar whose
  rest pose differs still takes the clip's pose. Each eases back into its first pose
  over its last 0.8 s, so the loop doesn't jump (the surveyors' idles too). The phone,
  camera, clipboard, book and cup sit in the hand's grip, worked out from its finger
  bones.
- **Accessories:** hats and glasses made for the crowd's characters are fitted to a
  real head axis by axis from where its eyes are; an apron hangs from the hips.
- **Materials:** the FBX importer leaves Metallic unset, which glTF reads as fully
  metallic; the build makes every material plain cloth and skin.
- **Size:** 0.3–0.7 MB each (WebP textures: 1024 px colour, 512 px hair cards, 256 px
  normal maps; normals and skin weights stored as bytes). A city loads its own NPCs
  and the clips for their sexes, about 6–8 MB.
- **Kept:** Kuidaore Taro, Dotonbori's mechanical drum-playing doll, stays a doll
  on the crowd's character. If an NPC's file doesn't load, it stands in as a simple
  figure without taking the others with it.

To recast an NPC, change its `look` in `cities/<id>/city.json` and run:

```
python pipeline/fetch_rocketbox.py               # the avatars and clips the cast needs
python blender/build_people.py --npcs            # -> web/assets/people/R_*.glb (--only R_... for some)
python pipeline/npc_looks.py                     # the looks into web/data/<city>/game.json
```

`web/game/lineup.html?city=tokyo` shows a city's NPCs in a row, as above, and
`xvfb-run -a node tools/npc_shot.js tokyo out_dir all 18:30` takes a still of each in the
game beside the surveyor, at the hour given (`… 390x844` for a phone).

## The trees

| The seven species (Cycles render) | Afternoon traffic under plane trees, a palm and a jacaranda |
|---|---|
| ![](images/trees/trees.jpg) | ![](images/sydney/game-traffic.jpg) |

`blender/build_trees.py` grows seven species: London plane, elm, eucalyptus,
Moreton Bay fig, jacaranda, Canary Island date palm and Japanese maple (momiji).
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
  cut out their shadows, jacarandas flower from mid October to November
  in the south (May and June in the north), and maples turn red from mid
  November to mid December in the north (late April to May in the south),
  over a fortnight either side.
- **Mix:** OpenStreetMap rarely says what species a tree is, so each city
  sets a mix in `city.json` (`"trees": {"mix": {"plane": 0.3, ...}}`), and
  places with their own (a garden's maples) in `"areas": [{"at": [x, y],
  "radius": m, "mix": {...}}]`. `pipeline/scene_config.py` refreshes it
  without a rebuild.

## Per-city flavour

Everything a city's game says and wears is in `cities/<id>/city.json`, not in code.
[Osaka on Foot](cities/osaka.md#8-osaka-on-foot) is the example:
- **People.** An NPC's `look` takes a character: a Rocketbox NPC (`R_…`, see
  [The NPCs](#the-npcs)), or one of the crowd's with skin, hair and clothes and a
  `pattern` (`leopard`, `tiger`, `kuidaore`, `pinstripe`, `plaid`) painted on the top in
  the shader. `clip` is what it does while it waits, and `acc` a list of accessories
  attached to bones (`visor`, `hachimaki`, `jingasa`, `mask`, `lanyard`, `sunglasses`,
  `umbrella`, `flag`, `drum`, and more in `web/game/people.js`).
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
  landmarks. [Tokyo Pilgrimage](cities/shibuya.md#7-tokyo-pilgrimage-shibuya) is the example.

## Testing

The game exposes a test hook (`window.__game.advance(seconds, keys)`) that runs
the simulation at a fixed 30 Hz without rendering. A Playwright script plays
the whole survey this way. Between steps the page keeps drawing and, unpaused,
simulates in real time. So `tools/game_check.js` holds the world still
(`window.__game.hold(true)`, as a pause does) while the NPCs' characters and the
helicopter's model load. Otherwise what the next steps meet would depend on how
long the files took on that machine, and a change that only made loading faster
would send the traffic another way. It checks:

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
   - **St Mary's:** walking to the cathedral completes Tom's walk.
4. All seven stamps are awarded.

The camera shots were checked the same way:
- the start: it lands on the chase camera;
- a fast-travel hop: the player arrives, and also arrives when the hop is skipped
  with a key;
- a survey at the bridge and at Observatory Hill: the right buildings are named, and
  the field notes are written;
- the height challenge: the guess is scored against the band of the height's source.

Driving is checked in every live city by `tools/game_check.js` through
`tools/autopilot_step.js` (alone: `tools/autopilot_probe.js <city>`):
- **the autopilot:** from the driver's seat it takes a place 250 m or more off by
  road and sets off within 20 s; its screen has the time left, the distance and the
  next turn, and the film cuts between shots; a touch of the wheel hands the car back
  at the speed it had with no jump in its place, and it takes the car again; it never
  drives more than 0.15 m into a car, crosses no red line, never stands more than
  100 s, and within 420 s has pulled in within 40 m of the end of its way;
- **the assists:** with both on and no key held for 40 s, lane keeping is at work for
  5 s or more and keeps the car within 1.2 m of the lane's middle once settled; the
  cruise keeps to its speed, clear of the traffic and behind every red line; a touch
  of the brake ends it;
- **the weather:** the same traffic for 25 s dry and 25 s in the rain must be slower
  in the rain, with the drivers' pace under 1, the gap's factor over 1 and the lamps
  on, and the cars near you must throw up spray;
- **a level crossing** put on the busiest long street near you, open for 30 s, shut
  for 30 s and open again: no car on the rails while it is shut, none standing on
  them at any time, and the traffic across again within 20 s of its opening.

`tools/trips_probe.js <city>` reports where the traffic went at an hour (the share
of car time on the main roads, the cars across a cordon round you, the cars that
pulled in to the kerb and out of it), with `TRIPS=0` the same with random turns;
`tools/kerb_shot.js` takes stills of the parked cars; `tools/autopilot_film.js`
films a drive with the HUD (`WEATHER=rain` in the rain).

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
  you before 46F's north door at the escalator's foot; standing still, the escalator
  carries you 9 m up to the deck in about 35 s, and the one down the west edge brings
  you back (`tools/game_check.js` rides every escalator, up and down).
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

`tools/route_check.js <city>` checks the routes. On foot it routes from the start
to every NPC and between 30 pairs of random places on the footways, and measures
the stretches of each where a walker can't stand (at most one sample, 0.5 m, at a
time: a corner grazed, never a wall crossed). For each place it finds no route
to, a search over the ground itself says whether a walker could get there at all;
it fails on one the walker could reach. It flies from the helipad to every NPC
and a few places, every 2 m clear of buildings, landmarks and decks, and flies
the quest's pass under its span; it drives from your car to each, every point
with room for the car. `tools/route_shot.js <city>` takes stills of the line on
foot, by car and in the air, at any time of day.

`tools/game_check.js <city>` is the smoke test for every city's game. It starts
the game, walks for four seconds, talks to the first quest giver, checks the gold
route on foot to the farthest NPC a walker can reach (and that it is drawn in the
air in the helicopter and on the road in the car), flies the
helicopter up and lets the ferries run for 40 s. Then it gets into your car at the
driver's door, drives off, brakes to a stop and gets out. It hails a taxi from the
kerb where the car was parked, gets in the back, picks the first place the driver
offers, rides for 20 s, skips the trip and gets out, and orders a ride on the phone.
Last it watches the nearest junction with signals for 80 s: its lights must go
through their phases, no car may cross its line on red, and the traffic must be
moving; the crowd's footways must cross at the signals, with walk signals, and
the nearest junction's walk must turn on and off within 75 s; a junction with a
turn arrow must have its arrow lanterns. Seated at the wheel and in the back, each head must be under the roof.
There is a screenshot after each step, and it fails on any page error.
`tools/check.sh` runs it for every city whenever the game changes, at 10:00 in
each city's time zone: `GAME_TIME=22:40` (or `YYYY-MM-DDTHH:MM`) pins the page's
clock to another local hour (`tools/pin_clock.js`), and `GAME_TIME=live` leaves the
real one, which a city starting at `"time": "live"` would otherwise play at.

The check plays in lockstep (#243): the world is held for the whole run (`__game.hold`), so only the
check's own `advance()` calls move it, a thirtieth of a second at a time, and a run on a loaded
machine plays the same traffic as one on an idle machine. Held, the page's frames still draw, but they
neither step the world, ease the camera (which the traffic reads for what is in view), tick a
conversation nor lay landmark tiles: `advance()` lays the tiles round you at the end of each call, all
of them, as a player's frames lay them a few ms at a time (a query over a box wider than the 96 m that
`need()` lays still meets the tiles already laid, so what the traffic met depended on how far the frames
had got). Before the first step the world's clock and the title's orbit go back to zero
(`__game.hold(true, true)`: the arrival sets out from the orbit's pose), the route network is built (it
fills in the roads a car can't get along as it goes), the helicopter is on its pad, and the game's clock
is set to `GAME_TIME`'s minute at Play (it is read from a `Date` that runs on at the real rate during the
load). Dispatch's tie-breaks draw from a seeded run. `GAME_LOCKSTEP=0`
leaves the frames running the world, as a player's do. `tools/lockstep_probe.js <city> [steps]` loads
a city twice, steps both the same way with real time between the steps, and compares a digest of the
crowd, the traffic and the lights after each step.

`tools/traffic_check.js <city> [seconds] [places]` measures the traffic (see
[Junctions and traffic lights](#junctions-and-traffic-lights)), with the
update's cost a frame, the lane changes and the walkers waiting at a kerb;
`tools/traffic_why.js <city> [place] [seconds] [still]` lists the cars standing
at the end of a run with what holds each (the car in front and what holds that
one, the light, the movement it waits for, the lane), and the cars caught up in
one another; `tools/junction_held.js <city> [seconds] [places] [junction ids]`
watches every car stopped at a signalled line and every movement in a
junction, and lists the cars held through more than two greens of their own
light and the movements standing in a junction for more than two of its
cycles, each with what holds it and every movement in the junction then
(`tools/game_check.js` runs the same watch, `tools/junction_held_step.js`, for
three minutes where you are, and fails on any); `tools/traffic_profile.js <city> [seconds]` runs the browser's
profiler over the traffic and lists its functions and busiest lines; and
`tools/signal_shot.js <city> out [count|ids|arrows<n>] [HH:MM,...] [WxH]` takes
a driver's view of the nearest junctions with signals (or with a turn arrow) at
the times given, or with `VIEW=kerb` a walker's view of a crossing.

`tools/clip_check.js <city>` counts what passes through what (furniture in the
road, cars in posts, walls and each other, walkers in walls, ferries in each
other, heads through roofs); `tools/check.sh` runs it with the game check.
`tools/stand_clip.js <city> [radius]` walks out from each travel place, the
start and every landmark's deck (in steps of a quarter metre, as a walker goes,
60 m round) and at every spot reached looks down from head height through what
the page draws: a surface over the walker's feet is a body sunk into it (the
roof a step west of Circular Quay's jacaranda lookout, a hall's floor over its
podium, setts over a lane the 5 m ground runs under). What it found and nav.js
now holds: a strip's mesh is walked only within the strip's outline (the rest
is a landmark's solid); a flat top with no headroom under it is solid through;
paving (a `decal` material, or `pave`) is stood on; walkers keep out of a
strip's or a deck's body, a deck's parapets and a flight's handrail.
`tools/ride_probe.js <city> [seconds] [DEST]` rides one taxi frame by frame
(hailed at the start, to the first destination whose name holds DEST) and fails
if it or any car of the traffic goes into a column, a signal pole, a walk-signal
post, a lamp post or a trunk, or if the taxi bumps (over 4 m/s² up or down),
lurches (its speed along its own track changing over 15 m/s² in a frame),
judders (its track going back or stalling while under way) or snaps round faster
than a car can steer.
`tools/ride_check.js <city> [N] [signals]` hails a taxi and orders a ride N times each at
kerbs round the start and says how long each took against what the phone said,
and what held it up (at the line: a red, an amber, a stop sign or the junction's
turn), and how many times it re-routed round a jam; `signals` keeps only the rides
past traffic lights near you. It seeds `Math.random` and takes `GAME_TIME`, so a
run is the same each time, and fails when more than one ride in ten is late or
more than 8 s off what the phone said. `tools/wall_stops.js <city> [seconds]
[places]` lists where the traffic stops at a wall across its way, and what the
wall is (a building, a canopy's post, a landmark); `tools/road_walls.js <city>`
lists every stretch where the game cuts a road at a wall, or a car doesn't fit
along it, with what is in the way (`--json` for `pipeline/road_passages.py`). `tools/passage_check.js <city...>`
walks every passage through a city's landmarks end to end both ways (`tools/passage_walk.js`, also a step of
`game_check.js`), and `tools/what_blocks.js <city> '[[x, y, z, r]]'` lists the floor and the collision boxes a
body meets at a point. `tools/ferry_check.js <city> [seconds]` runs the ferries for 15 minutes of game
time and fails if two hulls overlap or a vessel never calls, which is what a
deadlock or a meeting at a shared berth takes to show.

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
  - Lanes come from the road's class: two each way on a main road, one
    elsewhere, so a wide residential street still carries one file and a
    six-lane motorway two. OSM's counts (`"nl"`) only take a main road down to one lane
    each way, smoothed along the road (see
    [Junctions and traffic lights](#junctions-and-traffic-lights)). There are no turn pockets.
    What jammed Hong Kong after the counts (issue #128) was
    elsewhere: at the start your car was parked at a junction's mouth, on a 31 m
    piece between two junctions, and every car behind it waited on it for good
    (your car is now parked half a car's length and 12 m clear of a junction
    ahead of it and 24 m of one behind, where a taxi hailed beside it pulls in,
    on the roads round about when the nearest is all junction); and
    two one-way roads merging into nothing (a road the data has lost between
    them) held their cars at the end, so they are kept off now, with the one-way
    roads that lead only there (route.js). Jammed (still 30 s or more) under
    `tools/traffic_check.js hong-kong 150 6`: 6.9% on main, 5.3% with the merge
    fix alone; the start's jammed car-seconds fell from about 2,800 to 330 with
    the parking fix (`tools/traffic_why.js hong-kong 0`). Scaling the car count
    to the lane-metres near you was tried and left out: it took Hong Kong's 170
    cars down by 1 to 3%, too little to show. `traffic_check.js` also
    reports the cars on a motorway and on a deck at each place.
  - The arrow phase follows the main road's on every big junction alike; the
    real plans (SCATS's, Tokyo's) are not open data. None of the game's cities
    publishes its signal timings (a request to NSW for Sydney's was refused,
    as Vienna's was); the crowd-sourced Better Intersections map, built on
    OpenStreetMap, was checked (#82): it is crowd-sourced stopwatch timings of the walk
    signals, mostly in Sydney, with its code under the AGPL-3.0 and
    no licence stated for the timings, so the game doesn't take them; they could serve to check
    the walkers' waits (#108) against. Banned turns and street closures at some hours follow the
    game's clock; ones only for some vehicles (lorries, by weight) are left out.
  - Walkers cross where their footways cross a road; they wait for a walk
    signal at junctions with signals and at crossings with signals between
    junctions. The crowd doesn't seek out a crossing, and the rides' and your
    own car's driver (`cars.js`) don't yet stop for a crossing between
    junctions.
  - A few awkward corners (a turning circle, two lines meeting at a very sharp
    angle, a loop back past another junction's entry) can still hold two cars;
    in view they wait up to 90 s before squeezing past each other.
    `tools/overlap_probe.js` prints the last seconds of both cars of every pair
    that comes to overlap, and with `WATCH=x,y,r` the lines and cars at a place.
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
- **The railway:** trains appear and leave at the edges of the frame. The doors
  do not open, the pantographs do not follow the wire's height, and there are no
  signals. A train does not brake for a car or a person on a gated crossing (it
  pushes a walker aside); in the street it waits. Your own car is not stopped by a
  closed crossing. Platforms on a curve are drawn in straight pieces. A path's
  crossing has a post and no arm, though the Enoden's official crossings all have
  both: the data does not tell an official crossing from a garden gate's.
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

- Trains: [Mini Tokyo 3D](https://github.com/nagix/mini-tokyo-3d) (Akihiko Kusanagi, MIT: trains on
  their tracks from the timetable; ideas only), JR East's releases on platform doors
  ([2021](https://www.jreast.co.jp/press/2021/20210406_ho01.pdf)) and
  [鉄道コム on Yurakucho's](https://www.tetsudo.com/report/105/) (the Yamanote Line's in 2014),
  [Wikipedia, E235 series](https://en.wikipedia.org/wiki/E235_series) (20 m cars, 2.95 m wide, 3.62 m
  high), the Tokaido Shinkansen's loading gauge (25 m cars, 3.36 m wide, 16 cars); the high-speed
  train drawn on it is this project's own design, not a model of an operator's stock.
  The modelled cars (`blender/build_railstock.py`): the Japanese Wikipedia articles on the
  [E233](https://ja.wikipedia.org/wiki/JR東日本E233系電車) and [E235](https://ja.wikipedia.org/wiki/JR東日本E235系電車)
  series (body 19.5 m, 2.95 m over the widened sides, floor 1.13 m, doors 1.3 m by 1.85 m 4.82 m
  apart, bogie centres 13.8 m, wheelbase 2.1 m, 860 mm wheels), Wikipedia's
  [Sydney Trains A & B sets](https://en.wikipedia.org/wiki/Sydney_Trains_A_%26_B_sets) (20.4 m,
  3.03 m, 4.41 m), and photographs on Wikimedia Commons for the faces, roofs, bogies and
  underfloor equipment; no logo, lettering or number is reproduced. Interior mapping after
  Joost van Dongen's "Interior Mapping" (2008), written here from the idea.
- Scrambles: [LIVE JAPAN on Shibuya Crossing](https://livejapan.com/en/in-tokyo/in-pref-tokyo/in-shibuya/article-a0002128/)
  (the cycle and the walk), [Wikipedia, Shibuya Crossing](https://en.wikipedia.org/wiki/Shibuya_Crossing)
  (1,000 to 3,000 people a walk), [乗りものニュース on its single diagonal](https://trafficnews.jp/post/122022),
  [JAF Mate on Tokyo's scramble crossings](https://jafmate.jp/essay/road_trivia_20231225.html)
  (Dogenzaka-shita, Koen-dori, Shinjuku-dori's four from Alta, Sukiyabashi),
  [JAF Mate on Jingumae](https://jafmate.jp/car/surveyteam_20241105.html) (not a pedestrian-only phase),
  [ShibuyaSocial](https://arxiv.org/html/2512.18550v1) and the crossing-flow stripe experiments
  of Zanlungo, Feliciani, Nishinari et al. Ideas only.
- Walk signals' calls: the National Police Agency on [audible pedestrian signals](https://www.npa.go.jp/bureau/traffic/seibi2/annzen-shisetu/hyoushiki-shingouki/onkyou.html)
  (the 2003 notice; 21,644 in Japan, 99% of them bird calls); the guideline as Shimane's police
  publish it, [視覚障害者用付加装置に関する設置・運用指針](https://www.pref.shimane.lg.jp/police/06_information_disclosure/kunrei_tsuutatsu/koutsuu/koutsuu.data/k-kisei_shisetu_09.pdf)
  (the two ways of answering, about 1.5 s apart, the scramble's round and its silent diagonals,
  the speaker 3.3 m up, sound only on the steady green, timer switches at night); Kagawa's police on
  [which axis plays which](https://www.pref.kagawa.lg.jp/police/kokikaku/koutsuuanzen/koutsuu/otonoderusingou.html);
  Toyama's police [list of sites and their hours](https://police.pref.toyama.jp/documents/3562/r080331shikaku.pdf);
  Minato ward's [assembly paper](https://gikai2.city.minato.tokyo.jp/voices/GikaiDoc/attach/Nittei/Nt183_20190312_giun_01.pdf)
  (night stops in Tokyo). Facts only: every sound is synthesised, no recording is used.
- Junctions: [SUMO, Intersections](https://sumo.dlr.de/docs/Simulation/Intersections.html)
  (movements as lanes across the junction, their foes, and *keep clear*: no
  car into a junction it can't leave). Ideas only; no SUMO code (EPL-2.0) is used.
- Signals: [SCATS](https://en.wikipedia.org/wiki/Sydney_Coordinated_Adaptive_Traffic_System),
  [Transport Victoria on SCATS](https://transport.vic.gov.au/road-and-active-transport/business/road-and-traffic-management/traffic-lights/signal-coordination-and-automation/scats)
  (phases extended, ended early or skipped by demand).
- Lane counts and arrows: OpenStreetMap's [`lanes`](https://wiki.openstreetmap.org/wiki/Key:lanes) and
  [`turn:lanes`](https://wiki.openstreetmap.org/wiki/Key:turn) read by way id from the
  [OSM API](https://wiki.openstreetmap.org/wiki/API_v0.6) (`ways.json`, `nodes.json`; within its
  [usage policy](https://operations.osmfoundation.org/policies/api/): a few dozen requests a city,
  a User-Agent naming the project, cached in `data/raw/<id>/osm_ways.json`). The ways are named by
  Overture's segment `sources[].record_id`. Data © OpenStreetMap contributors (ODbL).
- Crossings: OSM's [`highway=crossing`](https://wiki.openstreetmap.org/wiki/Tag:highway%3Dcrossing)
  and [`crossing=*`](https://wiki.openstreetmap.org/wiki/Key:crossing) tags, as Overture's
  infrastructure `source_tags`. Data © OpenStreetMap contributors (ODbL), via Overture.
- Passages through landmarks: OpenStreetMap's [`tunnel=building_passage`](https://wiki.openstreetmap.org/wiki/Tag:tunnel%3Dbuilding_passage)
  and [`covered=yes`](https://wiki.openstreetmap.org/wiki/Key:covered), read by way id from the OSM API as for the
  lanes (cached in `data/raw/<id>/osm_passages.json`), on Overture's segments flagged `is_tunnel` and `is_covered`
  ([road flags](https://docs.overturemaps.org/schema/reference/transportation/segment/)). Data © OpenStreetMap
  contributors (ODbL).
- One-way streets: [Overture roads guide](https://docs.overturemaps.org/guides/transportation/roads/)
  and [access rules](https://docs.overturemaps.org/schema/reference/transportation/types/access_rules)
  (a heading-scoped denial is a one-way street). Data © OpenStreetMap contributors (ODbL), via Overture.

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
- Tesla FSD planning: AI Day 2021
  ([video](https://www.youtube.com/watch?v=j0z4FweCy4M), planning from about 1:13:00) and AI Day 2022
  ([video](https://www.youtube.com/watch?v=ODSJsviD_SU), interaction search from about 1:04:00).
- Red Dead Redemption 2's cinematic camera riding to a waypoint:
  [GameSpot](https://gamespot.com/articles/red-dead-2-guide-heres-how-to-set-your-horse-to-fo/1100-6462864/).
  Final Fantasy XV's Auto and Manual driving: [Fextralife](https://finalfantasyxv.wiki.fextralife.com/Regalia).
- Pure pursuit (the autopilot's steering onto its lane): R. C. Coulter, *Implementation of the Pure Pursuit
  Path Tracking Algorithm*, CMU-RI-TR-92-01, 1992
  ([Robotics Institute](https://www.ri.cmu.edu/publications/implementation-of-the-pure-pursuit-path-tracking-algorithm/)).
  Lane centring and adaptive cruise as two separate assists, each handed back by the wheel or the brake:
  [openpilot](https://github.com/commaai/openpilot) (MIT; its design read, no code taken).
- Baidu Apollo EM motion planner: [arXiv 1807.08048](https://arxiv.org/abs/1807.08048),
  [source](https://github.com/ApolloAuto/apollo) (Apache-2.0).
- SUMO junctions and keep-clear: [Intersections](https://sumo.dlr.de/docs/Simulation/Intersections.html),
  [source](https://github.com/eclipse-sumo/sumo) (EPL-2.0).
- A/B Street gridlock: [docs](https://a-b-street.github.io/docs/tech/trafficsim/gridlock.html),
  [source](https://github.com/a-b-street/abstreet) (Apache-2.0).
- Autonomous Intersection Management: [Dresner and Stone, JAIR 2008](https://jair.org/index.php/jair/article/view/10542).
- Real traffic control: SCATS ([overview](https://en.wikipedia.org/wiki/Sydney_Coordinated_Adaptive_Traffic_System),
  [survey](https://arxiv.org/pdf/1904.08117)); SCOOT ([TRL LR1014](https://www.trl.co.uk/uploads/trl/documents/LR1014.pdf));
  UTMS and MODERATO ([JICA report](https://openjicareport.jica.go.jp/pdf/12340022_02.pdf)); VICS ([how it works](https://www.vics.or.jp/en/structure/));
  max-pressure ([Varaiya](https://link.springer.com/10.1007/978-1-4614-6243-9_2), capacity-aware: [Gregoire et al.](https://arxiv.org/pdf/1309.6484));
  actuated control ([FHWA signal timing manual](https://ops.fhwa.dot.gov/publications/fhwahop08024/chapter5.htm));
  box junctions ([Highway Code rule 174](https://theorytest.org.uk/hwc/highway-code/rule-174.html)); dispatch
  ([Uber matching](https://www.uber.com/us/en/marketplace/matching/)).

**Daily life** (issue #357; read for their design, nothing taken from their art, characters or music):

- Persona 5 Royal's confidants, ranks and abilities: [GGRecon](https://ggrecon.com/guides/persona-5-royal-confidant-guide-igor-fool); who is free on which days and in which weather: [ClutchPoints](https://clutchpoints.com/gaming/sadayo-kawakami-confidant-guide); the five social stats and the ranks they gate: [Push Square](https://www.pushsquare.com/guides/persona-5-royal-confidants-guide-where-to-find-all-confidants-and-how-to-rank-up-fast); rain as a bonus: [RPG Site](https://www.rpgsite.net/feature/13328-persona-5-royal-stats-guide-increase-knowledge-guts-proficiency-kindness-and-charm-fast); part-time jobs: [RPG Site](https://www.rpgsite.net/feature/5481-persona-5-royal-jobs-guide-part-time-job-list-unlocks); the rain arrangement of its night theme: [Megami Tensei Wiki](https://megatenwiki.com/wiki/Persona_5_Original_Soundtrack).
- Its interface as "graphical entertainment", one key colour and lines that lead the eye: Masayoshi Suto, via [Siliconera](https://www.siliconera.com/?p=668266); how hard its menus were to make readable: Katsura Hashino, via [PC Gamer](https://www.pcgamer.com/games/rpg/persona-series-director-says-atluss-flashy-menus-are-actually-really-annoying-to-design).
- The calendar as pressure: [Vice](https://vice.com/en/article/persona-5-is-the-most-stressful-game-ive-played-in-years), [Gamers with Glasses](https://www.gamerswithglasses.com/features/take-your-time-scheduling-life-in-the-persona-series); the mobile game that dropped it: [PC Gamer](https://www.pcgamer.com/games/rpg/persona-5-the-phantom-x-had-a-hard-time-doing-away-with-the-series-iconic-calendar-system-it-was-very-difficult-to-convince-the-team).
- Yakuza's substories, found by walking into them: [TheSixthAxis](https://www.thesixthaxis.com/2018/10/16/the-yakuza-series-greatest-strength-is-the-people-you-meet-on-the-street/); their tone budgeted: [Automaton](https://automaton-media.com/en/interviews/like-a-dragon-infinite-wealths-sicko-snap-was-created-to-solve-a-very-real-problem-during-development/).
- Shenmue's schedules: [PC Gamer](https://pcgamer.com/the-secret-lives-of-shenmues-npcs); the wait it lacked: [Push Square](https://www.pushsquare.com/news/2018/04/shenmue_i_and_ii_will_not_add_time_skip_to_the_first_game); its jobs: [Kotaku](https://kotaku.com/shenmues-much-hated-forklifts-feel-revolutionary-today-1833817433).
- A Short Hike: "Crafting a Tiny Open World", [GDC 2020](https://gdcvault.com/play/1026613/Independent-Games-Summit-Crafting-A); rewards that make exploring more than travelling: [GamesRadar](https://www.gamesradar.com/games/open-world/some-open-world-games-can-make-it-feel-like-youre-not-really-exploring-youre-just-traveling-a-short-hike-creator-says-finding-unique-ways-of-rewarding-players-is-key-which-dark-souls-and-breath-of-the-wild-nailed). Alba: [Game Informer](https://gameinformer.com/review/alba-a-wildlife-adventure/alba-a-wildlife-adventure-review-a-good-deed).
- GeoGuessr's ladder of real knowledge: [GeoTips](https://geotips.net/). Pokémon GO's daily bonus and weather: [Niantic](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/105-daily-bonuses/), [Pokémon](https://www.pokemon.com/uk/strategy/work-with-weather-in-pokemon-go). Animal Crossing's hours and dated events: [Nookipedia](https://nookipedia.com/wiki/Event/New_Horizons). Wordle: [Pocket Gamer](https://www.pocketgamer.biz/news/78481/gdc-josh-wardle-shares-his-incorrect-tips-for-wordles-success/).
- The calendars' dates: each event in `cities/<id>/life.json` carries its own `source`.
