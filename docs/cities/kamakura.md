# Shichirigahama: Kamakura's Shonan coast along the Enoden

The first map of Kamakura (#354, part of #351): the coast of Sagami Bay from Enoshima Station and
Koshigoe's street-running rails, past Kamakurakokomae Station and its level crossing, along
Shichirigahama's beach to the cape at Inamuragasaki. It is the first map with a railway you can ride
and level crossings (`web/game/rail.js`, "train"; [GAME.md](../GAME.md)).

The crossing east of Kamakurakokomae Station (鎌倉高校前1号踏切) is known the world over from an anime's
opening sequence. What is built here is the place: the road falling to the sea, the track, the gates, the
train, Route 134, the sea wall, the bay. No characters, frames, logos or art from any anime are in the
map, the rule [Shinjuku's pilgrimage sites](shinjuku.md) follow (`pipeline/shinkai.py`).

## The frame

139.4861–139.5279 E, 35.2978–35.3132 N: 3.8 km along the coast by 1.7 km, the origin at 139.5070 E,
35.3055 N. Chosen from the data:

- **West edge**: just west of the Enoden's Enoshima Station (139.4875 E), so that the whole street-running
  section between Enoshima and Koshigoe is in the frame with the station's passing loop, where trains meet.
  The edge is close to the boundary of Kamakura and Fujisawa, so nearly every building has Kamakura's survey.
- **East edge**: past the cape at Inamuragasaki (139.526 E) and Inamuragasaki Station's loop, as far as the
  Gokurakuji depot's throat. Gokurakuji Station and its tunnel are 100 m further and belong to the next map
  east (Hase and the Great Buddha).
- **South and north**: 850 m either side, which takes in the surf line and 400 m of sea to the south, and
  the first ridge with Kamakura High School and the Shichirigahama housing estates to the north. Half the
  frame is sea.
- **Enoshima is outside**, 700 m beyond the south-west corner. The island is in Fujisawa City, whose own
  PLATEAU release (2025, checked on the G-spatial catalogue on 9 November 2026) covers it; it is to be a
  map of its own. Here it is part of the far view.

The group "Kamakura" in `cities/index.json` is the Enoden's line with the stations as districts, so that
Enoshima, Hase and the Great Buddha, and Tsurugaoka Hachimangu can follow as maps of their own.

## Data

| | |
|---|---|
| Buildings | 7,380 (Overture 2026-10-21.0 footprints, plus 613 that only PLATEAU has); 89.4% of the footprint area at a PLATEAU-measured height, 1.7% from mapped floors, 8.9% estimated from neighbours |
| Heights and roofs | Project PLATEAU Kamakura City 2024 (MLIT, CC BY 4.0; G-spatial `plateau-14204-kamakura-shi-2024`), the 3D Tiles archive read by range requests: every building's `measuredHeight`, and the LOD2 roof of the 520 buildings in the frame that have a LOD2 model |
| Terrain | GSI DEM5A, 5 m bare earth from airborne laser survey (GSI terms of use, compatible with CC BY 4.0); the sea is the 10 m DEM and sea level |
| Imagery | GSI seamless aerial photographs, zoom 18 (GSI terms of use, compatible with CC BY 4.0) |
| Roads, rail, land use, water | Overture Maps 2026-10-21.0 (OpenStreetMap-derived layers, ODbL) |
| Fine detail | OpenStreetMap (ODbL), `cities/kamakura/*_osm.json` in four boxes (`pipeline/osm_detail.py`): the stations, the level crossings (node 3937261506 is the Kamakurakokomae crossing), platforms, signals |
| Far land | Copernicus DEM GLO-30 and ESA WorldCover past the frame (`pipeline/far_land.py`): Enoshima, the Shonan shore, Hakone and Izu |

### What the data check found

- **PLATEAU's 2024 archive has a new layout**: no root folder, one tileset for the whole city
  (`<prefix>_bldg_3dtiles_lod1/`). `pipeline/plateau_3dtiles.py` now reads both layouts.
- **LOD2 covers little of this coast.** The 2024 LOD2 tileset carries every building, but 95% of those in
  the frame are the LOD1 block standing in (`uro:geometrySrcDescLod2` "未作成", code 999). The reader took a
  block for a measured flat roof, which made 6,364 houses flat; it now skips the buildings with no LOD2
  model, and their roofs come from the Japanese rules (gables and hips on houses), as elsewhere.
- **Storeys of 9999** are PLATEAU's "unknown" and are dropped (they had made 300 towers).
- **The orthophoto** in the same release (819 MB of GeoTIFF, CC BY 4.0 under the PLATEAU site policy) is
  finer than GSI's seamless photo. The pipeline has no reader for it yet; the ground here is GSI's.
- **Terrain against GSI's elevation API** (`analysis/dem_check.py`, 141 points): median difference
  −0.03 m, median absolute 0.19 m, 97% within 1 m.
- The hill road down to the crossing (日坂, Nissaka) falls 11% in the model, from 15.1 m to 10.2 m at
  Route 134 over 57 m.

## The Enoden

`game.rail.train` runs the Enoshima Electric Railway on Overture's line (`pipeline/game_rail.py`,
`web/game/rail.js`; how it works is in [GAME.md](../GAME.md)): 4.4 km of single track in the frame with the
passing loops at Enoshima Station, the Minegahara signal stop and Inamuragasaki Station, where the trains of
the two directions meet as on the real line; five stations; 444 m in the street between Enoshima and
Koshigoe; 12 gated crossings and 7 on paths. A train each way every 12 minutes (14 on the real timetable
since March 2023), 45 km/h at most and 15 km/h in the street (the speed marker at Koshigoe). The trains are
the 300 series' set 305, the 1000 series and the second 500 series, two-car articulated sets coupled in twos
(`blender/build_trains.py`; sources there and in GAME.md).

Sources: the Japanese Wikipedia articles 江ノ島電鉄線, 江ノ島電鉄300形電車, 1000形, 500形 (2代), 鎌倉高校前駅,
鎌倉高校前1号踏切, 踏切警報機 and 遮断機 (CC BY-SA, facts only); the Enoden's published timetables; MLIT's
interpretation standard for railway technical regulations, article 62 (the crossings' alarm and barrier
times, lamp and arm requirements); JIS E 3701 and makers' catalogues for the cross's boards. Photographs on
Wikimedia Commons were looked at for the faces, liveries and the crossing's furniture; none is reproduced.

## The place round the crossing (`cities/kamakura/city.py`)

- **The set.** Within 330 m of the crossing every road OpenStreetMap maps is laid as paving on its centre
  line: Route 134 (two lanes of 3.5 m and their shoulders, 9.6 m), the hill road 日坂 (6.2 m), the lanes off
  them, and the pavement between Route 134 and the track. The 10 m and 5 m terrain grids cannot hold a road
  6 m wide on a hillside, so the ground under each road, and a cell either side, is set to the laser
  terrain's height on its centre line, smoothed over 6 m (`adjust_terrain`, `set.json`), and the paving is
  draped on it.
- **At the crossing**: the deck between the rails, the stop lines 4.3 m either side, the zebra on the uphill
  side, the convex mirror at the east kerb, a warning sign up the hill. The gates, lamps and bell are the
  railway's (`rail.js`).
- **The sea wall** along Route 134's sea side (0.9 m, with a rail) and the concrete revetment below it down
  to the sand; the steps to the beach where OpenStreetMap maps them (way 390559761).
- **The beaches** are not in the map's land cover. They are outlined from the laser terrain (the land under
  4.2 m within 110 m of the sea, less Koshigoe harbour's quays; `water.sand`), so the shore is sand with
  surf, not a quay wall.
- **Sheds over the track** (14 footprints PLATEAU maps within 1.9 m of the line: platform shelters) are
  left out; the platforms and their shelters are the railway's.
- **Black kites** (tobi) wheel over the coast (`game.flocks`, `kind: "black_kite"`; Kamakura City warns
  beachgoers about them).

## The far view

- **Enoshima** (700 m past the frame): its relief from GSI's laser terrain every 10 m
  (`enoshima_dem.json`), the Sea Candle (59.8 m, its top 119.6 m above the sea: the operator's figures; on
  OpenStreetMap's outline, way 1311985404), the road bridge and the footbridge from Katase and the
  harbour's breakwater (OpenStreetMap, `enoshima_osm.json`).
- **Mount Fuji**: the far land reaches 80 km here (`far.half_m`), on Copernicus GLO-30, and is lowered by
  the Earth's curve less refraction (`far.curvature`). The summit stands at bearing 275.2° and 70.7 km from
  the crossing, 2.73° over the horizon (3,776 m less 335 m of curve; the true figure is 2.8°: the 156 m
  cells round the summit off). It shows in clear air (`far.clarity` 1.8, a chosen value).

## The ground

The aerial photograph is softened on open ground (`imagery.soften`): draped on these hillsides, its tree
crowns, shadows and leaning roofs read as dirt. See [ADDING_A_CITY.md](../ADDING_A_CITY.md), `imagery`.

## Approximate

- Roofs outside the LOD2 area are inferred, not measured.
- The sea's waves and colours are chosen values (`water.waves`, `colour`): a south-south-westerly sea
  breeze and a southerly swell.
- The set's widths (Route 134 9.6 m, the hill road 6.2 m) are a class's, not surveyed; Route 134's centre line
  is drawn dashed white (the real one is solid). The mirror's and the sign's places are from photographs.
- A path's crossing has a post and no arm; the Enoden's official crossings all have both, and the data does
  not tell them from a garden gate's.
- Enoshima's surface is three plain materials by slope and height (wood, rock, town); its buildings are not
  modelled. The Sea Candle is a lathed shape of its outline, not its lattice.
- Fuji has no snow: the land cover is a summer's. The seasons belong to the weather work (#356).
- The cast: Rocketbox has no school uniform; Mio wears a white shirt and dark trousers.
- Tree species are not mapped; the mix is a guess at the coast's planting (black pines on the capes and
  along Route 134, evergreen oaks behind).
- The helicopter's pad on Kamakura High School's ground is the game's, not a real pad.

## Not checked

A real GPU, WebGPU, Safari and iOS.
