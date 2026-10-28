# Learning from game engines

This is a study of how Unreal Engine 5, other engines and a few well-known games
solve the problems this game has: moving a character through a city, keeping the
camera out of walls, filling streets with people, letting the player talk to them,
and giving the player things to do. Each section says:

- what the engine does;
- what this repository does today;
- how to bring the idea across, and which files it touches.

The first piece is built: Unreal-style capsule collision against the exact building
footprints (section 1). The rest is a plan, ordered by value for effort at the end.

## Ground rules

**No engine code is copied.** The Unreal Engine EULA lets you share engine code only
with people who hold their own licence for the same version. Public source has to go
through a fork of Epic's GitHub repository. Snippets of up to 30 lines may be posted
"for the sole purpose of discussing" them, and not to let unlicensed people
"reconstruct any larger portion" (EULA §4(a)). Valve's Source SDK licence covers
modifying a Valve game on the Source engine. So for Unreal and Source this project
re-implements from the documented behaviour and never pastes code. Code under
permissive licences can be used or ported with attribution:

| Project | Licence | What it offers |
|---|---|---|
| Godot | MIT | `CharacterBody3D.move_and_slide`, navigation |
| RVO2 (in Godot) | Apache-2.0 | Reciprocal velocity obstacles for crowds |
| Recast/Detour | zlib | Navmesh and Detour Crowd. It powers Unreal's and Godot's navigation |
| recast-navigation-js | MIT | Recast/Detour compiled to WebAssembly |
| Jolt Physics (JoltPhysics.js) | MIT | Rigid bodies, `CharacterVirtual` |
| Rapier | Apache-2.0 | Rigid bodies, a kinematic character controller |
| Yuka | MIT | Steering, state machines and goal-driven agents for the web |

**No build step.** The viewer is classic `<script>` tags with three.js r128 from a
CDN. A library has to load from a CDN at a pinned version, either as a classic
script or through `import()` of an ES module. WebAssembly physics costs megabytes:
Rapier is about 4.3 MB with its WASM inlined, Jolt about 3 MB, and Recast about
1 MB. They should load only when a feature needs them. three-mesh-bvh, the usual
choice for capsule-vs-mesh collision in three.js, needs three r159 or later since
0.8.1. The last release whose declared range includes r128 is 0.5.24.

**Everything stays testable.** The game runs headless at a fixed 30 Hz through
`window.__game.advance(seconds, keys)`. Every system below has to work under that
hook, so it can be checked in Playwright without a GPU.

## What the game has today

| Area | Today | Where |
|---|---|---|
| Walking | Capsule sweep with wall sliding against the exact footprints (section 1). The floor is the highest surface within a 0.75 m step. | `nav.js`, `collision.js`, `game.js` `walkStep` |
| Helicopter | Assisted flight, as in Sketchbook. A 3.2 m circle slides along walls. | `vehicles.js` |
| Ferries | Routes found by the pipeline, docking by hand | `vehicles.js` |
| Camera | Third-person orbit. It rises over walls, then a 0.25 m probe sphere pulls it in. | `game.js` `updateCamera`, `nav.clearFraction` |
| Characters | Rigged glTF characters (CC0) with an `AnimationMixer`. Idle, walk, run, wave and sit, cross-faded by speed. Head turns towards a look target. | `people.js` |
| Crowd | 360 pedestrians on footway lines, keeping left. Skinned near the player (14 nearest), instanced far. They stop when the player is within 1.3 m. They don't avoid each other. | `actors.js`, `people.js` |
| Traffic | 150 cars on road lines at Overture speed limits, braking for whatever is ahead | `actors.js` |
| NPCs | 8 people placed by the city config. They face and look at the player, and talk in typewriter dialogue. | `game.js`, `hud.js`, `city.json` |
| Interaction | One `currentAction()` picks the nearest NPC, vehicle, wharf or passer-by by distance. It doesn't check facing or line of sight. | `game.js` |
| Quests | Seven step types (`talk`, `ride`, `surface`, `under_bridge`, `land`, `sun`, `inspect`), checked in code | `game.js`, `city.json` |
| Input | Key codes read directly (`k('KeyW')`) wherever they are needed, plus a touch joystick | `game.js` |
| Street furniture | 1,862 benches and 963 street lamps from OpenStreetMap. Lamps light at night. Benches are props at a random rotation, and nobody sits on them. | `game.js`, `game.json` |
| Time | A 30× clock. Variable `dt` (up to 50 ms) in play, a fixed 30 Hz in tests. | `game.js` |

## 1. Movement and collision (built)

**Unreal.** The CharacterMovementComponent (CMC) moves a capsule by sweeping it.
`SafeMoveUpdatedComponent` makes the move and, if the capsule starts inside
something, calls `ResolvePenetration` and tries again. `SlideAlongSurface` slides the
rest of a blocked move along the surface it hit. `TwoWallAdjust` handles the second
wall when the slide runs into another. `StepUp` climbs obstacles up to a maximum step
height. `FindFloor` sweeps down for the floor. A floor counts as walkable up to an
angle of about 45°. Ledges are handled by `bCanWalkOffLedges` and a perch radius.
Godot's `move_and_slide` does the same with up to 6 slides, a 45° floor angle and a
0.001 m safe margin. Source's `TryPlayerMove` clips the velocity against up to five
planes, with an 18-unit (0.46 m) step.

**Before this change.** A walker was tested at four points 0.35 m around its centre
against the 2 m surface model. Blocked moves were retried along each axis. A 2 m
cell is wider than a pavement, so walls were found up to a metre early or late.

**Now.** `web/game/collision.js` is a small physics scene for this world:

- **Prisms.** Every solid is a vertical prism: a footprint extruded between two
  heights. That covers the 8,308 building solids as published (with holes and
  raised parts), and the landmark and deck cells from `nav.js` as boxes. Walls are
  bucketed in an 8 m grid.
- **Capsule sweep.** A circle is swept in plan against the walls whose height range
  overlaps the capsule, from knee to head.
- **Slide and corners.** The rest of a blocked move slides along the wall
  (`SlideAlongSurface`). In a corner, sliding along one wall would push into the
  other, so the move stops (`TwoWallAdjust`).
- **Unstick.** A capsule that starts inside a wall is pushed out
  (`ResolvePenetration`).
- **Steps.** Walls lower than a step are left to the floor query, the way `StepUp`
  leaves them to the step height.
- **Speed.** The player's speed becomes the distance actually moved, as the CMC
  recomputes velocity after the move, so the walk cycle slows against a wall.
- **Floors.** Floors use the exact footprints too. A podium you can step onto is
  found even where a tower part overlaps it.
- **Helicopter.** It slides along a tower it meets at a glancing angle, instead of
  bouncing back.
- **Camera.** The camera probe is the SpringArmComponent's sphere sweep: 0.25 m
  against walls, roofs and soffits.

Measured headless in Chromium, the old and new code on the same scenarios:

| Test | Before | After |
|---|---|---|
| 120 walks into building walls at random angles (up to 60° off square): ended inside a footprint | 50 | **0** |
| Same: came within 0.3 m of a wall (clipping into it on screen) | 87 | **0** |
| Same: closest approach to a wall | 0.81 m *inside* | **0.351 m** (the capsule radius is 0.35 m) |
| Same: distance slid along the wall in 3 s, worst 10% | 1.24 m | **2.92 m** |
| A minute of random walking from each of 8 wharves: ticks inside a building | 229 | **0** |
| Camera with its back to a wall, 40 places: camera inside a building | 2 | **0** |
| Helicopter into a tower at 35° for 10 s: distance along the wall | 15.5 m (bounced) | **196.8 m** (slid) |
| Walking from the top of the Opera House steps onto the podium | Blocked by a 2 m cell | Walks on |
| North approach to mid-arch on the bridge deck | 115 s | 117 s |
| Flying under the bridge deck: crossing event | Fires | Fires |
| Simulation cost per 30 Hz tick | 1.01 ms | 0.98–1.14 ms |

Building the collision world takes about 150 ms for the buildings. A walker sweep
or a camera probe costs a few microseconds.

**Next for movement:**

- **Landmarks as meshes.** The Opera House shells and the bridge steel are still
  2 m boxes, so walking along them is a staircase. A capsule-vs-triangle test can run
  on the landmark meshes alone, a few thousand triangles. Write it by hand, or use
  three-mesh-bvh after a three.js upgrade (section 9).
- **The floor under the capsule, not its centre.** `FindFloor` sweeps the whole
  capsule down, so a character keeps standing with its edge on a roof or step (the
  "perch radius"). Today you drop off when your centre crosses the edge.
- **Movement modes as a state machine.** Unreal's newer Mover plugin (still
  experimental in 5.8) has one active mode at a time, transitions between modes, and
  "layered moves" such as a jump or a launch. The game already has modes (foot,
  heli, ferry, helm, falling) spread through `game.js`. Making each a small object
  with `enter`, `tick` and `exit` would make new modes easy to add, such as
  swimming, a bicycle or the Pylon Lookout stairs.
- **Feel.** Source's ground friction and acceleration constants give a responsive
  start and stop. The current speed easing is close; tuning it against those curves
  is cheap.

## 2. Camera

**Engines.**
- **Unreal's SpringArm.** It sweeps a probe sphere, which is now built here. It also
  has camera lag with a maximum distance, so the camera trails fast moves without
  losing the player.
- **Unreal's Gameplay Cameras.** Still experimental in 5.8. A camera director picks
  one camera rig at a time, and each rig has its own enter and exit transitions.
- **Unity's Cinemachine.** Its Deoccluder has three strategies: pull forward,
  preserve height and preserve distance. It also has a dead zone and damping that
  differs while the target is hidden.

**Here.** `updateCamera` already does a version of "preserve height": it tries
raising the pitch before pulling in. Modes switch by code paths, not by blends.

**Bring across:**

- **Rigs per mode, blended.** Foot, heli chase, bird's-eye, ferry, helm and
  dialogue. Today switching mode jumps the camera.
- **A dialogue rig.** An over-the-shoulder two-shot when talking, framing the NPC
  and what they are talking about (the Opera House, the bridge). The NPC's look
  target already gives the subject.
- **Damping when occluded,** so the camera doesn't pop when a lamp post or a
  hanger passes between it and the player.
- **Photo mode,** as in Marvel's Spider-Man (added in patch 1.04). Freeze the
  simulation, free the camera within a radius, set the date and time, and keep the
  real shadows. Nothing else can show the exact sun on a real place, so this fits
  the project well. The share card can carry the sun position and the time.

Files: `game.js` (camera), a new `camera.js` once rigs exist.

## 3. Input

**Unreal's Enhanced Input:**
- Input Actions carry a bool, 1D, 2D or 3D value.
- Mapping contexts are stacked by priority, so "helicopter" can override "on foot"
  without either knowing about the other.
- Modifiers clean raw input (dead zone, negate, swizzle).
- Triggers decide when an action fires: pressed, released, hold, tap, double tap.

**Here,** key codes are read in place (`k('KeyW')`, `k('Space')`), and each mode
interprets them. Space means jump on foot and climb in the helicopter. That works,
but it makes rebinding and gamepads hard.

**Bring across:** an `input.js` with:
- named actions (`move`, `look`, `jump`, `interact`, `lens`, `lift`);
- one mapping context per mode (foot, heli, ferry, helm, dialogue, menu);
- a hold trigger for "hold E to get out", so you don't step out of a hovering
  helicopter by accident;
- the Gamepad API behind the same actions, with a dead-zone modifier;
- the touch joystick feeding the `move` action.

Rebinding then becomes a table in the menu.

## 4. Characters and animation

**Unreal:**
- **Blend spaces** blend clips by parameters such as speed and direction.
- **Distance matching** plays starts and stops by the distance left, so feet don't
  slide (`AdvanceTimeByDistanceMatching`).
- **Stride and orientation warping** stretch the stride to the actual speed and turn
  the legs towards the direction of travel.
- **Full Body IK in Control Rig** plants feet on steps and slopes.
- **Motion Matching** (declared production-ready in 5.4) picks frames from a large motion
  database. It is too heavy for a phone browser, and the data doesn't exist for
  these characters.

**Here,** `people.js` cross-fades Idle, Walk and Run and scales playback by speed.
That is a one-dimensional blend in steps. The head already turns towards a look
target, which is a small IK.

**Bring across, in this order:**
1. **A real speed blend:** walk and run weighted together between 1.5 and 3 m/s,
   instead of a switch at 2.1 m/s. `AnimationAction.setEffectiveWeight` does it in
   r128.
2. **Foot IK on steps.** The Opera House steps and the bridge approach are strips
   with a known height profile, so the height under each foot is one
   `stripHeight` call. Two-bone IK on the legs keeps feet on the risers.
3. **Distance-matched stops.** When the input stops, choose a deceleration that
   ends on a planted foot.
4. **Turn in place** before walking off at more than 90° from the facing.
5. **Sitting.** The `sit` mode exists but is only used on the ferry. It is the
   animation half of section 5's smart objects.

## 5. Crowds and traffic

**Unreal's City Sample** (*The Matrix Awakens*):
- **Mass and ZoneGraph.** Crowds and traffic both run on Mass, an entity system.
  They move along ZoneGraph lanes, a light corridor graph. Spawners for crowds,
  intersections, traffic and parked cars place agents along the lanes.
- **StateTree** drives the crowd's behaviour. Traffic doesn't use it.
- **Mass LOD** is computed separately for drawing and simulation. Near people are
  full characters and distant ones are vertex-animated static meshes.
- **Avoidance.** Unreal offers RVO in the CMC (it ignores the navmesh) or Detour
  Crowd (velocity sampling biased towards the desired direction), one or the other.
  Unity and Godot (RVO2) avoid with reciprocal velocity obstacles too.

**GTA V** fills its streets from **scenario points**. Points such as
`PROP_HUMAN_SEAT_BENCH`, `WORLD_HUMAN_SMOKING` and `WORLD_HUMAN_DRINKING` carry:
- a ped model set;
- a time window;
- a probability and a radius;
- how long the ped stays.

Scenario density is a separate knob from ambient walkers. **The Sims** puts the
choice in the objects. Each object *advertises* which needs it satisfies, the
advertisement weakens with distance, and a Sim picks what makes it happiest
(Forbus and Wright, 2001). **Unreal's Smart Objects** formalise the same idea:
find, claim, use, release.

**Here,** the architecture is already the City Sample's in miniature:
- footway and road lines are the lanes;
- people near the player are skinned and people further away are instanced;
- cars brake for what is ahead.

What is missing:

- **Avoidance.** Pedestrians walk through each other. Agents already sit on a line
  with a lateral offset (`side`, keeping left), so avoidance can stay
  one-dimensional and cheap:
  - each tick, look up neighbours in a spatial hash;
  - for each one ahead on the same line within the time horizon, shift the offset
    away and ease the speed. This is RVO restricted to the footway width.
  - Do the same for the player instead of the current "stop within 1.3 m".

  360 agents with a hash cost far less than a millisecond. The full RVO2 algorithm
  (Apache-2.0) can be ported later for plazas such as Martin Place, where people
  aren't on lines.
- **Scenario points from open data.** The pipeline already reads OpenStreetMap
  benches. It could also emit points for:
  - viewpoints (`tourism=viewpoint`);
  - bus stops (`highway=bus_stop`, wait for the bus);
  - café seating (`amenity=cafe` + `outdoor_seating`);
  - artworks (`tourism=artwork`, stop and look);
  - the wharves (wait for the ferry).

  Each point gets a type, a facing (a bench faces the footway or the water), a time
  window and a probability, as GTA's do. Walkers claim a free point, walk to it,
  play `sit` or `idle`, and release it. The pipeline should give benches their real
  facing too: today they are drawn at a random rotation.
- **Sun-aware choices.** This is something no other city game can do. A point can
  advertise "sun" or "shade". The sun model already answers whether a spot is lit
  (`Sun.sunlit` through the surface model). So on a winter lunchtime people take
  the sunny benches in Martin Place, and on a summer afternoon the shaded ones,
  using the same computation as the sun-access analysis. It also makes the
  analysis visible: you can see the planning rule at work in where people sit.
- **Density by place and time.** Make the 450 m spawn radius an "active area" in
  the sense of Left 4 Dead's director, which populates the areas around the players
  and deletes wanderers that leave. Weight spawns by footfall: more at Circular
  Quay at 8:30 and 17:30, and on the Opera House steps at sunset.

Files: `pipeline/game_data.py` (scenario points, bench facing), `actors.js`
(avoidance, claims), `people.js` (sitting and idles in the crowd renderer).

## 6. NPCs and interaction

**Unreal:**
- **AI Perception** gives agents senses: sight, hearing, damage, touch.
- **StateTree** is a hierarchical state machine with selectors.
- **EQS** scores candidate points or actors with tests.
- **Gameplay Tags** are hierarchical labels (`Quest.Survey.Ferry`) with any/all/none
  queries.
- **The Gameplay Ability System** owns abilities and their costs and cooldowns.

Lyra's interaction pattern traces for interactable targets and shows a prompt for
the best one.

**Here,** NPCs stand still all day. `currentAction()` picks the nearest NPC within
3.2 m by distance, even through a wall. Quest steps are seven types checked in code.

**Bring across:**

- **Interaction scoring, EQS-style.** Score candidates by distance and by the angle
  from the camera's forward direction. Require a clear line from the player's eyes
  using `col.sweepSphere`, so you can't talk through a wall. Show the prompt for the
  winner, and give a world-space highlight to the runner-up.
- **NPC routines with a StateTree.** Each NPC gets a schedule over the 48-minute day.
  For example, Priya is at Martin Place at lunchtime and at Wynyard after work, and
  the map tells you where she is now. States: idle, notice (sight cone and
  distance: turn and wave), talk, walk to the next place along the footway graph
  (Dijkstra already exists for the GPS), resume. A small table-driven state machine
  in `npc.js` is enough. No library is needed.
- **Quests as tag conditions.** Steps become conditions on tags and facts:
  - `ride` becomes "has `Ride.circular-quay.milsons-point`";
  - `sun` becomes "`Sun.Lit` at a place in a window";
  - `under_bridge` becomes the event `Flight.UnderDeck`.

  New quests can then be written in `city.json` without new code, which keeps to
  the project's "a new city is a config file" rule.
- **Branching dialogue.** Lines can depend on tags: what you have seen, the time
  of day, whether it is sunny where you stand. Today lines come from the model; let
  them also come from your history.
- **Abilities.** The survey lens can become an ability with a short cooldown and an
  owner, the way GAS models them. That makes room for more, such as a level that
  measures a building's height by triangulation, or a sun compass. Each one teaches
  a real surveying method.

## 7. Gameplay

The best structures to borrow are the ones that turn real places into goals:

- **Viewpoints** (*Assassin's Creed*): climbing a viewpoint and synchronising
  unfogs that part of the map. Sydney has real ones:
  - the Pylon Lookout;
  - Observatory Hill;
  - Mrs Macquarie's Chair;
  - Sydney Tower Eye.

  Here the reveal can be the actual **viewshed**: ray-cast the surface model from
  the viewpoint and unfog exactly the cells you can see. That is the same code as
  the sun meter, with the viewpoint in place of the sun.
- **A career** (*Microsoft Flight Simulator 2024*): a certification tree, flights
  earning XP and reputation, and difficulty-rated missions. Here: surveyor grades.
  The ferry helm, helicopter landings and the sun-access checks become licences
  with a score, as the docking score already is.
- **A director** (*Left 4 Dead*): it paces play by tracking each player's intensity.
  There is no combat here, but a director can schedule the city's real rhythms:
  - the ferry horn on departure;
  - buskers at Circular Quay;
  - the 6 pm commuter rush;
  - golden-hour prompts at the right place for the date;
  - New Year's Eve fireworks at midnight on 31 December.
- **Photo challenges:** "photograph the Opera House with the sun behind the
  shells". This works because the sun's azimuth for any date is known, and the
  game can tell you where to stand and when.
- **Fix the map:** the honest version of a collectible. The lens already shows
  where each height comes from. A player who finds a building that looks wrong can
  flag it, and the game can export the flags as a list for OpenStreetMap mappers.

## 8. World, streaming and effects

**Unreal's World Partition:**
- streams grid cells by distance from streaming sources;
- builds HLODs (instanced, merged or simplified) for far cells;
- turns sets of content on and off with Data Layers;
- packages reusable groups as Level Instances.

**Here,** each city is one area of a few kilometres, loaded at once. That is right
for Sydney, but it caps the size of a city, and the planned list includes New York
and Tokyo.

**Bring across:**
- **Tiles.** Cut `buildings.json` into tiles of about 500 m with their own geometry
  and collision prisms. `collision.js` already buckets by grid, so a tile can add
  and remove its prisms.
- **Far tiles.** Load one merged, simplified mesh per far tile. The ground already
  switches tiles by distance (`groundLod`), so this extends a working pattern.
- **Data layers** for night lamps and events.
- **Landmarks** as level instances per city, as `city.py` already is.
- **Particles,** Niagara-style, as small GPU systems: rotor downwash on water, bow
  spray, gulls (boids), fireworks.
- **Sound,** MetaSounds-style. It is already synthesised. Add positional audio
  (`PannerNode` with HRTF) and occlusion from `col.sweepSphere`, so a busker behind
  a building is muffled.

## 9. Architecture

**Unreal's gameplay framework** splits rules (GameMode), shared state (GameState), a
player's intent (PlayerController), the body (Pawn) and behaviour (Components).
Ticks run in groups, and physics can sub-step.

**Here,** `game.js` is 1,128 lines that hold all of these. The split that pays off
first:

| Module | Holds |
|---|---|
| `input.js` | Actions and mapping contexts (section 3) |
| `movement.js` | Movement modes: walking, falling, heli, ferry, helm (section 1) |
| `camera.js` | Rigs and blends (section 2) |
| `interact.js` | Scoring and prompts (section 6) |
| `quests.js` | Tag conditions, steps, stamps (section 6) |
| `game.js` | Wiring, the frame loop and the HUD |

Two more changes:

- **A fixed timestep everywhere.** Tests run at a fixed 30 Hz, but play uses the
  frame's `dt`. A fixed-step accumulator with interpolated rendering makes play
  behave exactly as tested, and keeps the helicopter and docking consistent between
  a phone at 30 fps and a desktop at 144.
- **A data-oriented crowd.** Mass, Unity DOTS and bitECS all keep agents in flat
  arrays. The crowd's 360 objects work today. When avoidance and scenario points
  add per-tick work, typed arrays (structure of arrays) are the cheap step. A small
  hand-written layout is enough; bitECS is MPL-2.0, which would be fine unmodified.

**Rigid-body physics** (Chaos in Unreal) isn't needed for anything the game does
now: cars are kinematic on lanes and people are capsules. If driving, ragdolls or
loose props come later, load Jolt (MIT, `CharacterVirtual`, vehicles) lazily for
that mode only.

**Three.js** r128 is from 2021. Moving to a current release brings:
- three-mesh-bvh;
- cascaded shadow maps;
- the WebGPU renderer.

It also means importing the examples as ES modules through an import map. That
needs no build step, but every `THREE.*` example global changes. This is worth
doing as one dedicated change, not mixed with features.

**Tests.** `GAME.md` describes Playwright scripts that play the whole survey, but
they aren't in the repository. Commit them, with the collision checks from
section 1, as the equivalent of Unreal's functional tests.

## Roadmap

Ordered by value for effort. Effort: S is a day or less, M a few days, L a week or
more.

| # | What | From | Files | Effort |
|---|---|---|---|---|
| 1 | ✅ Capsule sweep, wall slide, depenetration, exact floors, camera probe, helicopter slide | Unreal CMC, SpringArm | `collision.js`, `nav.js`, `game.js`, `vehicles.js` | done |
| 2 | Commit the Playwright survey and collision tests | Unreal functional tests | `tests/` | S |
| 3 | Crowd avoidance on lanes, and around the player | RVO, Detour Crowd | `actors.js` | S–M |
| 4 | Interaction scoring with line of sight | Lyra, EQS | `game.js` → `interact.js` | S |
| 5 | Input actions, mapping contexts, gamepad, hold to exit | Enhanced Input | `input.js` | S–M |
| 6 | Scenario points from OSM, with bench facing and sun-aware choice | GTA scenarios, The Sims, Smart Objects | `game_data.py`, `actors.js`, `people.js` | M |
| 7 | Fixed timestep and a module split | Unreal framework, physics sub-stepping | `game.js` | M |
| 8 | NPC routines over the day | StateTree, AI Perception | `npc.js`, `city.json` | M |
| 9 | Quests as tag conditions | Gameplay Tags | `quests.js`, `city.json` | M |
| 10 | Speed blend, foot IK on steps, turn in place | Blend spaces, Control Rig, distance matching | `people.js` | M |
| 11 | Viewpoints with a real viewshed, and photo mode | Assassin's Creed, Spider-Man | `game.js`, `sun.js`, `hud.js` | M |
| 12 | Camera rigs per mode, blended, with a dialogue rig | Gameplay Cameras, Cinemachine | `camera.js` | M |
| 13 | Landmark collision on the meshes | CMC against complex collision | `collision.js` | M |
| 14 | three.js upgrade with import maps | — | all of `web/` | L |
| 15 | Tiles and far meshes for larger cities | World Partition, HLOD | pipeline, `world.js` | L |
| 16 | Rigid bodies, only if driving or ragdolls are added | Chaos, Jolt | lazy-loaded | L |

## Sources

Checked in October 2026. Unreal's online documentation serves 5.8.

- Unreal Engine EULA (May 2023 text), §4(a) and §5(a):
  [PDF](https://cdn1.epicgames.com/eulatracking-download/unreal_engine/en/v2/r1/7be11df29cd87f4c3fe0032ad5bc3220.pdf).
- CharacterMovementComponent:
  [API](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UCharacterMovementComponent),
  [SafeMoveUpdatedComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UMovementComponent/SafeMoveUpdatedComponent),
  [walkable slope](https://dev.epicgames.com/documentation/en-us/unreal-engine/walkable-slope-in-unreal-engine).
- Mover: [concepts](https://dev.epicgames.com/documentation/en-us/unreal-engine/mover-features-and-concepts-in-unreal-engine),
  [5.8 release notes](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-8-release-notes).
- [SpringArmComponent](https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/USpringArmComponent),
  [Gameplay Cameras](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-camera-system-overview),
  [Enhanced Input](https://dev.epicgames.com/documentation/en-us/unreal-engine/enhanced-input-in-unreal-engine).
- [Gameplay Ability System](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-ability-system-for-unreal-engine),
  [Gameplay Tags](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-gameplay-tags-in-unreal-engine).
- [StateTree](https://dev.epicgames.com/documentation/en-us/unreal-engine/state-tree-in-unreal-engine),
  [EQS](https://dev.epicgames.com/documentation/en-us/unreal-engine/environment-query-system-overview-in-unreal-engine),
  [Smart Objects](https://dev.epicgames.com/documentation/unreal-engine/smart-objects-in-unreal-engine---overview),
  [AI Perception](https://dev.epicgames.com/documentation/en-us/unreal-engine/ai-perception-in-unreal-engine).
- [City Sample](https://dev.epicgames.com/documentation/unreal-engine/city-sample-project-unreal-engine-demonstration?lang=en-US),
  [Mass](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-mass-gameplay-in-unreal-engine),
  [avoidance](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-avoidance-with-the-navigation-system-in-unreal-engine),
  [Recast/Detour](https://github.com/recastnavigation/recastnavigation).
- [Motion Matching](https://dev.epicgames.com/documentation/en-us/unreal-engine/motion-matching-in-unreal-engine),
  [distance matching](https://dev.epicgames.com/documentation/unreal-engine/distance-matching-in-unreal-engine),
  [pose warping](https://dev.epicgames.com/documentation/en-us/unreal-engine/pose-warping-in-unreal-engine),
  [Full Body IK](https://dev.epicgames.com/documentation/en-us/unreal-engine/control-rig-full-body-ik-in-unreal-engine),
  [blend spaces](https://dev.epicgames.com/documentation/en-us/unreal-engine/blend-spaces-in-unreal-engine).
- [World Partition](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine),
  [HLOD](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition---hierarchical-level-of-detail-in-unreal-engine),
  [Data Layers](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition---data-layers-in-unreal-engine).
- Godot: [CharacterBody3D](https://docs.godotengine.org/en/stable/classes/class_characterbody3d.html),
  [third-party licences](https://github.com/godotengine/godot/blob/master/thirdparty/README.md).
- Unity: [CharacterController](https://docs.unity.com/en-us/engine/current/manual/physics-section/physics-overview/character-control-section/class-character-controller),
  [Cinemachine Deoccluder](https://docs.unity3d.com/Packages/com.unity.cinemachine@3.1/manual/CinemachineDeoccluder.html).
- Source SDK 2013: [movement code](https://github.com/ValveSoftware/source-sdk-2013/tree/master/src/game/shared),
  [licence](https://github.com/ValveSoftware/source-sdk-2013/blob/master/LICENSE).
- GTA V scenario points, from community tools (Rockstar publishes no documentation):
  [CodeWalker types](https://github.com/dexyfex/CodeWalker/blob/master/CodeWalker.Core/GameFiles/MetaTypes/MetaTypes.cs),
  [scenario list](https://github.com/DurtyFree/gta-v-data-dumps/blob/master/scenariosCompact.json).
- The Sims: Forbus and Wright,
  [Some notes on programming objects in The Sims](https://qrg.northwestern.edu/papers/Files/Programming_Objects_in_The_Sims.pdf).
- Left 4 Dead: Booth,
  [The AI Systems of Left 4 Dead](https://steamcdn-a.akamaihd.net/apps/valve/2009/ai_systems_of_l4d_mike_booth.pdf).
- Assassin's Creed viewpoints:
  [Ubisoft](https://www.ubisoft.com/en-us/game/assassins-creed/news/6ogkWkxq1HusqpqGtQvCpn/assassins-creed-shadows-summer-roadmap-update).
  Spider-Man photo mode:
  [PlayStation Blog](https://blog.playstation.com/2018/09/07/marvels-spider-man-swings-into-stores/).
- Microsoft Flight Simulator 2024 career:
  [Xbox Wire](https://news.xbox.com/en-us/2024/11/15/microsoft-flight-simulator-2024-creating-career-mode-for-all-players/).
- Libraries:
  [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js),
  [Rapier character controller](https://rapier.rs/docs/user_guides/javascript/character_controller),
  [Jolt CharacterVirtual](https://jrouwe.github.io/JoltPhysics/class_character_virtual.html),
  [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh),
  [Yuka](https://github.com/Mugen87/yuka),
  [bitECS](https://github.com/NateTheGreatt/bitECS).
