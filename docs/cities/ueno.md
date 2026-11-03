# Ueno

A map of Tokyo ([Tokyo as maps](tokyo-maps.md)): Ueno Park on its hill, Shinobazu Pond below it,
and Ameyoko's market along the tracks from Ueno to Okachimachi, with Yushima and the University of
Tokyo's hospital to the west. Frame: 1.9 × 1.8 km round 139.7735 E, 35.713 N.

## Data

Overture Maps 2026-10-21.0 footprints, Project PLATEAU LOD2 heights (CC BY 4.0, via indigo-lab's
vector tiles), GSI DEM5A terrain and GSI aerial photographs, as for the other Tokyo maps. 86% of the
footprint area stands at a PLATEAU-surveyed height.

## Landmarks (`cities/ueno/city.py`, parts in `pipeline/districtkit.py`)

Built in code on OpenStreetMap's footprints and positions, whose plain solids are hidden:

| Landmark | Published | How it is built |
|---|---|---|
| Shinobazu Pond 不忍池 | three ponds: lotus, boats, cormorants (Tokyo Metropolitan Park Association) | each pond a sheet of water at its own low shore, about 4.7-4.9 m T.P. (the 15th percentile of the laser ground round it), the grid cut 0.6 m under it; the lotus pond's beds dry and brown, as from October to May |
| Bentendo 弁天堂 | octagonal hall of Benzaiten, Kan'ei-ji; rebuilt 1958 | an eight-sided vermilion hall on a stone podium, its sweeping roof and gilt jewel, facing the causeway |
| Kan'ei-ji's five-storey pagoda 旧寛永寺五重塔 | 1639, 36.4 m (Taito City; Important Cultural Property) | five storeys of vermilion walls under tiled roofs that run up into the storey above, the sorin and its nine rings |
| Ueno Toshogu 上野東照宮 | 1651, gongen style, gold leaf renewed 2013 (Ueno Toshogu) | worship hall, stone passage and main hall under copper roofs, gilt bays drawn as panels of lattice, doors and coloured carving; the Karamon where OpenStreetMap has it, the enclosure fence along OpenStreetMap's wall, and 36 stone and bronze lanterns along the approach (the real approach has about 200) |
| Saigo Takamori 西郷隆盛像 | Takamura Koun, 1898; 3.7 m of bronze (Taito City) | a robed figure and the dog Tsun on a granite pedestal of about 4 m, looking south |
| Ameyoko アメ横 | the post-war market along the Yamanote line, about 400 shops | boards and blade signs on the street fronts within 38 m of the lane (fish, dried food, sweets, shoes, spices, standing bars: typical trades, no real shop's sign), and the lit gate at the Ueno end where OpenStreetMap has it |

## Game

Ueno on Foot starts at the station's Park exit. A volunteer guide from the National Museum sends you
down to Ameyoko, where a fishmonger sends you to the gate and up the steps to Saigo; on the park line,
the boat keeper at the boat pond sends you to Bentendo and the lotus, and a shrine attendant to the
gilt hall and the pagoda. Station signs for Ueno, Okachimachi, Yushima and Nezu; travel points at
the Park exit, Saigo, Ameyoko's gate, Bentendo, the Toshogu approach and the National Museum.
The ponds are water to the game: no walking on them.

## Not checked

- The pagoda's and the hall's proportions against measured drawings; the Toshogu's three halls are
  fitted to OpenStreetMap's footprint in proportions from photographs.
- The trees are the shared elms, planes and maples: the shared set has no cherry, and Ueno's
  cherries are what the park is known for.
- The Tokyo National Museum's and the Hyokeikan's roofs are PLATEAU's blocks, not built in code.
