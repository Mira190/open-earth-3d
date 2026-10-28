# Handoff: the Great Barrier Reef sites (Whitsundays and four more)

Branch `claude/zen-albattani-ywr26e` (pushed), which grew from `claude/laughing-mccarthy-fxznj8` with `main` merged in.
A marine world separate from the city viewer: `web/reef/`, three.js r186 (vendored in `web/vendor/three`), WebGPU
with an automatic WebGL2 fallback, all materials in TSL. **WebGPU is still untested**: everything was verified on
software WebGL2 in a headless browser. The first job on a machine with a GPU is to open each site in Chrome and
check the WebGPU path (TSL `Loop`, `select`, `.level()` in the vertex stage, `fwidth`, the viewport textures).

## Sites

| id | What | Tide gauge (MSQ) | Notes |
|---|---|---|---|
| `whitsundays` | Whitehaven Beach, Hill Inlet, Whitsunday Passage, Hamilton Island; 33 × 33 km | Shute Harbour | [docs/cities/whitsundays.md](cities/whitsundays.md) |
| `hardy-reef` | Heart Reef, the Reefworld pontoon on the channel wall, Hook/Line/Bait reefs; no land | Bugatti Reef Outer | player spawns on the pontoon deck |
| `green-island` | the cay off Cairns, Arlington Reef, Michaelmas Cay | Cairns Beacon C1 | jetty on its mapped OSM line |
| `heron-island` | the cay on the Tropic of Capricorn, Wistari Reef | Bundaberg port | reef flat dries at low tide |
| `lady-elliot-island` | the southernmost coral cay | Waddy Point (K'gari) | no aircraft (land planes only) |

All five are in `cities/index.json` and `web/data/cities.json` with `group: "Great Barrier Reef"`; the globe shows
one marker that opens a list of them.

## Run and test
```bash
cd web && python3 -m http.server 8800
# http://localhost:8800/reef/index.html?city=whitsundays
# headless: NODE_PATH=$(npm root -g) node tools/reef_shot.js "still=1&gl=1&freeze=5&x=900&y=450&z=60&pitch=-8&yaw=70" out.png
# state:    NODE_PATH=$(npm root -g) node tools/page_eval.js "reef/index.html?..." "<expression>"   (PORT= for another server)
```
- `?player=1&autotest=1` → `window.__autotest` (39 checks; holds the tide at MSL while it runs).
- `?gametest=1` → `window.__gametest` (Whitsundays 64; every other site 30-39); `lifestub=1`, `life=0`, `gamesite=generic`.
- Query keys: `gl=1`, `still=1`, `freeze=<s>` (wave clock), `time=<ISO>` (the model clock: sun, moon, tide), `tide=<m>`
  (fixes the tide), `wind=0..1`, `exp`, `post=0`, `bloom=0`, `shafts=0`, `mods=` (default `life,boats,player,game`),
  `odbg=1..7` (ocean debug: glitter, foam, refracted frame, slope variance, normal, height, reflection),
  `lifecam=<species>`, `boatcam=<name>`, `gameshot=...`. Coordinates: x east, y north, z up (z < 0 under water);
  yaw 90 looks west.

## Data pipeline (`pipeline/`, config in `cities/<id>/city.json`)
1. `fetch_gbr_bathy.py <id>`: AusSeabed GBR 30 m; grid extents from the COG headers, one inflated grid cached in
   `data/raw/_gbr/<letter>.tif` per grid and shared, resumable.
2. `fetch_sentinel.py --city <id>`: Sentinel-2 L2A from Earth Search, whole passes that cover every tile (no seam
   from mixed dates), per pixel the darkest in the near infrared; B1-B4 and B8, and each scene's sun angle.
3. `build_marine.py --city <id>`: terrain (no-data filled from the nearest cell), the floor colour inverted through
   the water column, habitat, optics, cays rebuilt from their OSM outlines; calls `marine_meta.py`.
   **Kd** comes from QAA (Lee et al. 2002/2014; Kd from Lee et al. 2005) on the deep water's colour, unless the depth fit
   passes a quality test (`qaa.py`); red is held at pure water's 0.40. Both are in `analysis/optics.json`.
4. `marine_meta.py --city <id>`: POIs, spawn and the harbour layout into `scene.json`, no raw data needed.
5. `fetch_tide.py --city <id>`: Maritime Safety Queensland's 10-minute predictions through the Queensland open data
   portal's **datastore API** (the CSV downloads are behind a bot check: do not try to get round it), fitted to 60
   constituents per year → `tide.json`. Time base AEST, checked against NASA GOT4.10c (M2 phase).
6. `check_marine.py --city <id>`: POIs, pontoon and spawn against the built terrain.

`city.json` blocks for a marine site: `pois` (`lonlat` or nominal `xy`, `kind`, `src`), `poi_sources`, `spawn`
(`poi` or `x`/`y`, `heading`, `deck: "pontoon"`), `harbour` (`fleets`, `marina` {`at`, `from`, `fingers`, `boats`},
`pontoon` {`at`, `exact`, `heading`, `name`}, `parked`, `moorings`, `traffic` routes by POI id, `scenic`, `nav_cell`),
`tide` {`gauge`, `years`: resource ids, `note`}.

## Viewer (`web/reef/`)
| File | Role |
|---|---|
| `main.js` | renderer, modules via `ctx` (`init(ctx)` returns `{update}`), the model clock (`ctx.clockMs`), the tide (`ctx.tide`), light and the eye's adaptation, the torch, fly camera |
| `env.js` | sky, wave bank (swell + chop), `medium()` = the water column (installed as `scene.fogNode`) with the directional light field under water, caustics, the torch (`env.torch`) |
| `ripples.js` | periodic wave tiles rendered each frame to mipmapped gradient/Hessian textures: ripples (0.3-2.4 m) and the chop's shading at range (3-24 m) |
| `ocean.js` | radial mesh, Gerstner displacement, Cox-Munk sun and moon glitter with Smith masking, refraction, foam (whitecaps by wind, breakers by H/d), Snell's window |
| `world.js` | terrain chunks with LOD and far 4 × 4 blocks, water heights (hollows the sea cannot reach are dry), habitat |
| `shore.js` | 2 m detail patch near the camera |
| `post.js` | bloom, light shafts, vignette, night vision (Purkinje shift, kept in bright pixels and the torch beam) |
| `tide.js` | the tide from `tide.json`: `at(ms)`, `turns(ms, n)`, `rising(ms)` |
| `boats.js` + `boats/` | vessels, wakes, AI traffic over the open water (A*, 120 m cells or `nav_cell`, routes planned for the lowest tide), drivable boats and aircraft, `deckAt` for walkable decks, far LOD |
| `player.js` `people.js` `looks.js` `gear.js` `dive.js` `hud.js` `fx.js` | the player (walk, wade, swim, snorkel, free-dive, scuba; decks; climb out), Quaternius people, HUD |
| `life.js` + `life/` | corals, seagrass, fish, sharks, rays, turtles, the manta, island trees, plankton, coral spawning; `ctx.life` API (header of life.js) |
| `game.js` + `game/` | people, dialogue, quests, journal (J), map and travel (T), boarding; one content file per site; every line computed or cited ([docs/GAME_REEF.md](GAME_REEF.md)) |

## What is real and what is still a hack
Real (derived, keep): the water-column model and its inversion; Kd from QAA; caustics from the wave Hessian; glitter
as the Cox-Munk distribution of the slope variance a pixel cannot show (mips and faded waves feed it); whitecap cover
(Monahan) and breaking (McCowan); the radiance distribution under water (Lee's rrs conversion, clear-water ratios);
the moon (Allen's phase law) and twilight; the tide (MSQ, 1-3 cm RMS); the sea reaching only connected hollows.

Weak spots, in order of value:
1. **WebGPU untested** (above).
2. **The swell is four waves**: their interference is regular; a cascaded FFT ocean (WebGPU compute) with the sine bank
   kept for WebGL2 is the right next step. The chop and ripples are tiles already.
3. **Foam has no memory** (no advection or persistence); the wake field (`boats/wake.js`) is the only foam with history.
4. **One Kd per site**, and QAA's green Kd is probably high (surface reflectance keeps some sky glint); habitat is inferred
   from colour and depth, not surveyed (the Allen Coral Atlas is the right source). The Whitsundays' `ground.jpg` has a
   few fill discs in 6-7 m water north-west of Whitsunday Island.
5. **30 m terrain**: shorelines rely on `shore.js`; tidal flats at Hill Inlet are right in kind, not in detail.
6. **Night**: the adaptation curve and the torch strength are judged by eye; coral spawning colours are physically
   absorbed by the water beyond a metre or two.
7. **Life**: shapes, colours, densities and behaviours are approximations (life.js header lists what is sourced).
   Island vegetation is being made per site (coral cays have Pisonia forest, not hoop pine).
8. **Performance**: about 230 objects in view at the start view after the vessel and herd LOD; the terrain chunks
   near the camera and the vessels are the next targets; mobile is untested.

## Open items
- Per-site flora and fauna for the cays (in progress at handoff: a `life` block in `city.json` read by life.js).
- QPWS pages (Ngaro Sea Trail, Nara Inlet cultural site) are behind Cloudflare; read them in a normal browser before
  adding Ngaro content beyond the mapped lookout names. **Do not invent Ngaro history, quotes or ceremony.**
- Fix the Chalkies anchorage nominal spot (boats find depth 570 m away); OSM beach markers at South Whitehaven, Chance Bay
  and Catseye sit behind the sand (`check_marine.py` lists them).

## Repo notes
- Commits: author Mira190, subject and body only, no trailers (AGENTS.md).
- Shared files touched: `web/globe.js` and `web/index.html` (grouped markers), `cities/index.json`, `web/data/cities.json`, README.
- `web/vendor/three/` is three r186 + a few addons; extend with files from `npm i three@0.186.1`.
