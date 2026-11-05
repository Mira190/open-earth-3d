# Queenstown (Tāhuna)

> Queenstown on Lake Wakatipu, from Fernhill to Frankton Arm and the Kelvin Peninsula:
> 6.2 × 4.8 km and 4,071 buildings. 97.6% of the footprint area has its roof measured by
> LINZ's 2021 LiDAR. The buildings stand on LINZ's 1 m bare-earth terrain under its 2026
> aerial photos. The Remarkables, Cecil and Walter Peaks and Ben Lomond rise past the frame,
> from LINZ's national 8 m DEM under its 10 m satellite mosaic. The scene's 0 m is the
> lake's surface (309.2 m above the sea). Every number here comes from the scripts in
> `analysis/` with `--city queenstown`, and their outputs are in `cities/queenstown/analysis/`.

| Blue hour from the Skyline deck (the game's start) | The same view from above, as in the reference photograph |
|---|---|
| ![](../images/queenstown/game-start-blue.jpg) | ![](../images/queenstown/ref1-blue-hour.jpg) |
| **Day from the deck** | **The bay from the Fernhill side** |
| ![](../images/queenstown/game-start-day.jpg) | ![](../images/queenstown/ref2-fernhill.jpg) |
| **The TSS Earnslaw at Steamer Wharf** | **Night from Bob's Peak** |
| ![](../images/queenstown/game-earnslaw.jpg) | ![](../images/queenstown/night.jpg) |
| **The Skyline Gondola and its towers** | **The Earnslaw (Blender)** |
| ![](../images/queenstown/gondola.jpg) | ![](../images/vehicles/ferry_steamer.jpg) |

Phone (390 × 844), from the start on the deck: day, dusk, night.

| Day | Dusk | Night |
|---|---|---|
| ![](../images/queenstown/phone-day.jpg) | ![](../images/queenstown/phone-dusk.jpg) | ![](../images/queenstown/phone-night.jpg) |

Open it from the globe, or at `web/index.html#queenstown`. The game is at `#play-queenstown`.

## 1. The reference

The owner set the bar with two photographs: the blue-hour view from Bob's Peak, with the town lit
amber under the snow on the Remarkables, and a clear day over Queenstown Bay from the Fernhill
side. The first is the place the town is best known for. It is where the game starts, and it is
the model viewer's opening shot. The second is the tour's second stop. Matched to them:

- **The start** is on the Skyline viewing deck in front of the complex on Bob's Peak, facing
  south-east over the town, the bay, the Gardens peninsula and the Kelvin Peninsula to the
  Remarkables. The deck is a landmark (`cities/queenstown/city.py`, `DECK`): timber boards, steel
  posts down the slope and a glass balustrade. The game walks it as a strip. Its place and size
  are indicative. Its level is the ground at its back edge, and it stands west of the gondola's
  last tower, clear of the cable.
- **The lake** is a saturated blue with turquoise over the shallows (`water.colour`,
  `shallow_colour`, `scatter`).
- **The air** is clear: `far.clarity` 2.2 stretches every haze distance (the fog and the far
  land's air), so the Remarkables 10 to 15 km away stand out as they do in the photographs. This
  is a chosen value. Any city can set it in far.json, through `far` in its city.json.
- **The light**: the city keys its own grade (`game.look.grade`): a brighter, more saturated blue
  hour, a vivid day and warm amber street lamps (`night.street`).

Games looked at for the arrival, for their design only: Microsoft Flight Simulator's photogrammetry
approach into Queenstown sets the town in its mountains. The vista points of open-world games such
as Assassin's Creed and Ghost of Tsushima start the player where the whole map can be read.
Nothing was taken from either but that idea.

## 2. The data

| What | Source | Licence |
|---|---|---|
| Terrain | LINZ, Otago - Queenstown LiDAR 1m DEM (2021), flown 12–13 March 2021 for LINZ, Landpro and QLDC; COGs in NZTM2000 on `nz-elevation` (AWS) | CC BY 4.0 |
| Roofs | LINZ, Otago - Queenstown LiDAR 1m DSM (2021): the median of the surface model inside each footprint, over the lowest ground under it | CC BY 4.0 |
| Ground | LINZ, Queenstown 0.1m Urban Aerial Photos (2026), February–March 2026, read at 0.42 m from the COGs' overviews; the 2021 urban photos fill the rest | CC BY 4.0 |
| Footprints, roads, water, places | Overture Maps 2026-10-21.0 (OpenStreetMap and others) | ODbL and others, as Overture lists them |
| The gondola | OpenStreetMap `aerialway=gondola` with its pylons and stations (via Overture) | ODbL |
| The land past the frame | LINZ, New Zealand Contour-Interpolated 8m DEM (read at 32 m); LINZ, New Zealand 10m Satellite Imagery (2025–2026); ESA WorldCover 2021; NASA Black Marble | CC BY 4.0; CC BY 4.0; CC BY 4.0; public domain |
| Climate | NIWA, Queenstown Airport, 1991–2020 normals (via Wikipedia's climate table) | — |

### New in the pipeline

- **LINZ COGs** (`terrain`, `surface_check` and `imagery` of type `stac_cog`, `pipeline/fetch_tiles.py`).
  The fetcher lists a STAC collection's items that meet the bbox and reads each over HTTP range
  requests, at the resolution asked. A decimated read takes the overviews, so 0.1 m photos come
  in at 0.42 m without downloading the full resolution. A boundless read would bypass the
  overviews, so the window is clipped instead. The imagery is cut into Web Mercator tiles, which
  the build reads as it reads an XYZ service. Nodata over the lake is set just under the lake's
  surface (`water_m`).
- **An inland lake as the scene's 0 m** (`datum_offset_m` 309.2). This is the median DEM height
  along the survey's water edge on the day the LiDAR was flown. The far land takes the offset too,
  so the lake past the frame is the water plane.
- **The far land, finer and measured** (`far` in city.json: `nh`, `nc`, `half_m`, `mesh`,
  `relief`, `colour`, `clarity`). A 1024 height grid over 72 km (70 m cells), a 640-line mesh, the
  national bare-earth DEM in place of the global surface model, and the satellite mosaic's colour
  in place of the land-cover palette. The mesh's size is read from far.json (`web/farland.js`).
- **Terraces from the LiDAR** (`cities/queenstown/gondola.py massing()`). The Skyline complex
  steps down the side of Bob's Peak. Drawn as one block it would stand 21 m tall over the lowest
  ground under it. Instead, its roof levels are read from the surface model in 3 m cells,
  quantised to 1.5 m and joined into 19 terraces, each standing on the ground under it
  (`massing.json`).

## 3. The landmarks

- **The Skyline Gondola.** The line, its towers and its stations are OpenStreetMap's, measured by
  `gondola.py` into `gondola.json`. The line runs 620 m in plan and 754 m along the slope, rising
  430 m from the Brecon Street station (36 m above the lake) to the top station. Doppelmayr
  publish 760 m inclined and 438 m up (release, June 2023). The towers' heights are the laser's
  highest return within 4 m of each mapped tower where it caught the lattice (14.3, 21.7 and
  16.5 m). Elsewhere a tower is as tall as the cable needs to keep the cabins 5 m over the ground.
  The cable sags 2.5% of the span. The surface model along the line is no guide to the trees,
  because it caught the cable and the cabins. Doppelmayr's line has 10 towers; OpenStreetMap maps
  6, and the model draws those 6. The towers are tubular masts with a crossarm, a platform, a
  ladder and a sheave train over each track. In the game, 35 ten-seat cabins
  (`web/game/rail.js`, kind `gondola`) go up one side and down the other, at 5 m/s, slowing
  round each station's bullwheel. You can ride one between the stations.
- **The TSS Earnslaw** (`blender/build_vehicles.py`, `ferry_steamer.glb`), 51.2 × 7.3 m with
  2.1 m draught (Wikipedia, citing the NZ National Maritime Museum). The model has a plumb stem,
  a white hull with a red boot-topping and portholes, glazed main and upper saloons, an open
  promenade, a varnished kauri wheelhouse forward on the boat deck, and the raked red funnel with
  a black top. Wikipedia and RealNZ say red since the 1984 refit. The black top is not in a
  source and is drawn from photographs. She also has cowl ventilators, a whistle, the mast and
  stays, two lifeboats in davits, liferafts, lifebuoys, an anchor and capstan, and the ensign
  aft. She is shared, like the other ferries. In the game (`ferry_style.model: "steamer"`) she is
  single-ended: she lies alongside as she came in, swings round slowly once under way, sails bow
  first, and puffs coal smoke from her funnel.

Eichardt's (Heritage NZ List 7439), St Peter's (List 2341) and Williams Cottage (List 2336) are
their mapped footprints with their LiDAR heights. They are named and labelled, and the game's
lakefront walk takes you past them. Modelling them finely is a follow-up (see section 6).

## 4. Queenstown on Foot

You start on the Skyline deck. Aroha welcomes you, and there are three walks, in any order:

- **The hill.** Hemi, further along the deck, keeps you there until the Remarkables turn pink
  ("Wait here till dusk" sets the time). Then you ride the gondola down to Mei at Brecon Street,
  and back up.
- **The lake.** Callum, at Steamer Wharf, puts you on the Earnslaw across Frankton Arm to the
  Kelvin Heights jetty and back. Then you walk Marine Parade past Eichardt's to Williams Cottage
  and out to the point of the Gardens.
- **The air.** Sophie flies from the Recreation Ground.

Your car waits at Brecon Street by the gondola's bottom station (`start.car`). Skyline Road, the
service road up Bob's Peak, is mapped as a track, and so is the unnamed track that carries it down
to Lomond Crescent. The game drives both (`drive_named`, `drive_tracks`), so a taxi can come up to
the top. The real road is private.

The Earnslaw's real run is to Walter Peak, beyond the map's edge across the lake. In the game she
crosses to Kelvin Heights at her service speed of 13 knots, and `ferry_note` says so. The lines
are sourced: Tāhuna, "shallow bay"; Rākaihautū and the lake; the seiche (26.7 min, about 200 mm,
told as the giant's breathing); William Rees's woolshed, which became Eichardt's; the Earnslaw
built in Dunedin, carried in pieces by rail to Kingston and launched there in 1912, burning about
1.5 t of coal a return trip (RealNZ).

## 5. Checks

- Heights: 3,831 of 4,117 solids are measured by the LiDAR, and 240 are estimated from their
  neighbours. These are mostly buildings that went up after the March 2021 flight: 119 footprints
  have no roof in the surface model (`analysis/lidar_heights.json`).
- `tools/game_check.js queenstown`: walk, talk, the helicopter, the Earnslaw, the car, a taxi and
  a ride, the junctions, rain, and a lost WebGL context.
- Stills: desktop 1440 × 900 and phone 390 × 844, day, dusk and night, on llvmpipe at the
  desktop tier.
- Not checked: a real GPU, WebGPU, Safari or iOS.

## 6. Limitations and follow-ups

- Eichardt's, St Peter's, Williams Cottage and the Steamer Wharf building are not yet modelled
  from their heritage listings.
- The gondola has the 6 towers OpenStreetMap maps, not Doppelmayr's 10. The cabins' colours are
  a guess.
- The deck's place and size are indicative, not surveyed.
- 153,000 trees are planted from the canopy model, most of them on Bob's Peak and Ben Lomond's
  lower slopes. That is many more than any other city. A small device keeps a third of them, and
  only those near the camera are drawn.
