# Asakusa

A map of Tokyo ([Tokyo as maps](tokyo-maps.md)): Asakusa and the Sumida, with Tokyo Skytree
across the river. Frame: 2.6 × 1.64 km round 139.8015 E, 35.712 N.

## Data

The same sources as the other Tokyo maps:

- Footprints: Overture Maps 2026-10-21.0 (OpenStreetMap, ODbL).
- Heights: MLIT Project PLATEAU, Tokyo 23 wards, LOD2 (CC BY 4.0), via indigo-lab's vector
  tiles (MIT). The Skytree's own PLATEAU blocks are excluded within 30 m of its centre.
- Terrain: GSI DEM5A, 5 m laser bare earth; GSI aerial photographs.

## Landmarks (`cities/asakusa/city.py`)

Built in code and placed on OpenStreetMap's footprints, whose plain solids are hidden. Sizes from
Senso-ji's own guide (senso-ji.jp/guide), eaves and roof extents measured from PLATEAU's survey:

| Landmark | Published | Measured from PLATEAU (Taito City 2025, LOD2) |
|---|---|---|
| Kaminarimon 雷門 (1960), 切妻造 八脚門, clay 本瓦 | 11.4 m across, 69.3 m² (about 6.1 m deep), 11.7 m; lantern 3.9 m, 3.3 m across, 700 kg, 雷門 front, 風雷神門 back; Fujin 2.18 m (right), Raijin 2.09 m (left); Tenryu and Kinryu behind | eaves 8.2 m, roof 12.5 × 17.5 m, top 12.4 m |
| Hozomon 宝蔵門 (1964), 五間三戸 重層門, 入母屋, titanium tiles (2007) | 21.1 m across (upper 20.0 m), 173.6 m² a floor (about 8.2 m deep), 21.7 m; Nio 5.45 m; 小舟町 lantern 3.75 m; bronze lanterns 2.75 m; sandals 4.5 × 1.5 m | lower eaves 9.2 m, roof 19.4 × 31.8 m |
| Five-storey pagoda 五重塔 (1973), titanium tiles (2017) | 53.32 m above the ground: a 5 m podium and the 48.32 m tower, its sorin 15.07 m | (LOD2 too coarse to use) |
| Main hall 本堂 (1958), 和様三手先 入母屋, titanium tiles (2010) | 34.5 m across, 32.7 m deep, 29.4 m to the ridge; 志ん橋 lantern 4.5 m, 3.5 m across | eaves 12.9 m, the porch's 10.1 m, roof 52 × 49 m, top 29.3 m |
| Tokyo Skytree | 634 m; a triangle 68 m a side at the foot, round by about 320 m; Tembo Deck 340-350 m, Galleria 445-450 m | |
| Flamme d'Or | about 44 m long, on the 44.1 m hall (OpenStreetMap) | |

Bay counts, eave overhangs, roof curvature, the statues' colours and the incense burner are not
published; they follow the gate and hall types and photographs.

### Open data for these buildings, and what was used

| Source | What it has here | Licence | Used |
|---|---|---|---|
| PLATEAU Taito City 2025, 3D Tiles LOD2/LOD3/LOD4 (`13106_taito-ku_city_2025_citygml_1_op_bldg_3dtiles_lod3_no_texture`) | Senso-ji's four structures at LOD2 (LOD3 and LOD4 tiles fall back to LOD2 here): real roof outlines, eaves and ridge heights | CC BY 4.0 (PLATEAU site policy) | yes: `pipeline/plateau_lod3.py` measures eaves and roof extents |
| PLATEAU Tokyo 23 wards LOD2 vector tiles (indigo-lab) | one height per footprint | CC BY 4.0 / MIT | yes: every building's height |
| Tokyo Metropolitan Government's 23-ward airborne LiDAR, 2024 (G空間情報センター `tokyopc-23ku-2024`), at least 16 points/m² and a 0.25 m DSM | the finest measure of the roofs' curves and the pagoda's taper | CC BY 4.0 | not yet: the next step for roof curvature |
| OpenStreetMap (via Overture) | footprints, the names, 11.7 m, 21.7 m, 53.32 m, 29.4 m | ODbL | yes: anchors |
| Sketchfab photogrammetry ("Asakusa Kaminarimon/Thunder Gate", "Japan Sensoji") | full scans | not stated; download needs an account | no |

## Game

Asakusa on Foot: a rickshaw puller at the Kaminarimon, Nakamise, the incense burner and an
omikuji at the main hall, the Sumida River water bus between Asakusa, Komagatabashi and Nitenmon
piers (OpenStreetMap), and the Skytree's lift from its foot to the Tembo Deck and the Galleria
at 600 m a minute.

Persona 5 sends its players to Asakusa by a book; its Asakusa is the Kaminarimon, Nakamise and
the Skytree across the river. Nothing of the game's art is used.

## Not checked

The roof shapes against photographs at close range; the lantern words' orientation from every
side; the water bus route against Tokyo Cruise's timetable (it is not real).
