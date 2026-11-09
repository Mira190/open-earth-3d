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

## Approximate

- Roofs outside the LOD2 area are inferred, not measured.
- The sea's waves and colours are chosen values (`water.waves`, `colour`): a south-south-westerly sea
  breeze and a southerly swell.
- Tree species are not mapped; the mix is a guess at the coast's planting (black pines on the capes and
  along Route 134, evergreen oaks behind).
- The helicopter's pad on Kamakura High School's ground is the game's, not a real pad.

## Not checked

A real GPU, WebGPU, Safari and iOS.
