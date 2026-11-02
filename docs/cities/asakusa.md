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

Built in code and placed on OpenStreetMap's footprints, whose plain solids are hidden:

| Landmark | Published figures used | Source |
|---|---|---|
| Kaminarimon 雷門 | 11.7 m; the lantern 3.9 m tall, 3.3 m across, about 700 kg; 雷門 front, 風雷神門 back | Senso-ji; OpenStreetMap |
| Hozomon 宝蔵門 | 21.7 m; the 小舟町 lantern 3.75 m; straw sandals 4.5 m | Senso-ji; OpenStreetMap |
| Five-storey pagoda 五重塔 | 53.32 m to the finial | Senso-ji; OpenStreetMap |
| Main hall 本堂 | 29.4 m | OpenStreetMap |
| Tokyo Skytree | 634 m; a triangle 68 m a side at the foot, round by about 320 m; Tembo Deck 340-350 m, Galleria 445-450 m | Tobu Tower Skytree; Britannica |
| Flamme d'Or | about 44 m long, on the 44.1 m hall | photographs; OpenStreetMap |

The approach's axis is measured from the Kaminarimon's footprint to the main hall's. PLATEAU's
roof survey stops short of the ridges' ornaments and the finial (it gives the pagoda 37.9 m), so
the published heights are used. Roof proportions, the brackets and the Skytree's diagrid are
approximations, not surveys.

After dark the Skytree is lit in Iki's pale blue and Miyabi's purple on alternate days (material
`emissive_cycle`, read by `web/world.js`), the temple is floodlit from below and the lanterns glow.

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
