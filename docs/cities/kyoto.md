# Kyoto: a city with measured heights

Central Kyoto, from Kyoto Station in the south to the edge of the Imperial Gardens in
the north (3.0 × 5.0 km). Every number here comes from the scripts in `pipeline/` and
`analysis/` run with `--city kyoto`; outputs are in `cities/kyoto/analysis/`.

## 1. What is different from Sydney

Sydney's heights were the weak point: OpenStreetMap carried a height for few buildings, and
the rest came from floor counts, a machine-learning estimate or neighbours. Kyoto has a
better source. **Project PLATEAU** (MLIT, CC BY 4.0) publishes every building of the city
with a height measured from aerial survey, as CityGML and as 3D Tiles.

| | Sydney | Kyoto |
|---|---|---|
| Buildings | 7,962 | 65,749 |
| Footprint area with a surveyed or measured height | see [Sydney](sydney.md) | **93.4%** (PLATEAU) |
| Terrain | NSW 5 m bare earth (stereo) | GSI DEM5A, 5 m bare earth (airborne laser) |
| Imagery | NSW Imagery | GSI seamless aerial photographs, zoom 17 |

PLATEAU also gives a test of the other sources. Against the 29 buildings of 20 m and taller
that OpenStreetMap contributors gave a `height` (`analysis/plateau_check.py`, output in
`cities/kyoto/analysis/heights.json`), PLATEAU is taller by a median of 6.6 m (21%), and 8 of
the 29 are more than 40% taller. Many of the OSM values are exactly 31 m, the figure usually
quoted as Kyoto's height cap, so they may have been tagged from the rule rather than measured;
PLATEAU may also include rooftop plant. We have not checked which is right for any of these
buildings, so on the tallest blocks the model's heights could be too high by several metres.

## 2. How PLATEAU gets in

1. `pipeline/fetch_plateau.py` (the `zip` backend, `pipeline/plateau_3dtiles.py`) reads the
   `b3dm` tiles that touch the bounding box out of the city's 3D Tiles zip (1.8 GB) with HTTP
   range requests, so only those tiles come down. It
   decodes their Draco meshes with DracoPy, takes each building's footprint from its
   upward-facing triangles and its `bldg:measuredHeight` from the batch table, and writes
   `data/raw/kyoto/plateau.json` (80,867 footprints). Tokyo uses the same file from a
   vector-tile mirror.
2. `build_scene.py`'s `Plateau` class cuts each Overture footprint along the PLATEAU faces and
   gives every piece the measured height (source `plateau`). PLATEAU buildings that no Overture
   footprint covers (1,267) are added as buildings of their own.
3. A parametric landmark is never overwritten: PLATEAU records Kyoto Tower and the
   9-storey building under it as one 130.5 m building, which would have extruded the whole
   hotel block to 131 m. `cities/kyoto/city.py` cuts the block to 31 m and builds the tower
   from its published figures (131 m to the spire, observation deck at 100 m).

PLATEAU's survey is from 2020–2021, so newer buildings are missing or low: 6,938 Overture
buildings (5.8% of the footprint area) match nothing and fall back to neighbour estimates.

## 2a. Roofs, measured

The same zip has LOD2 meshes for the central wards, with real roof surfaces. With
`plateau.roofs` set, `plateau_3dtiles.py` reads those tiles too (2,135 inside the bbox) and
measures each building's roof from its triangles: flat, gabled along or across the
footprint, hipped, half-hipped or skillion, with the pitch and the height from eave to ridge
([BUILDINGS.md](../BUILDINGS.md#measured-roofs) has the method). 79,889 of the 80,870
PLATEAU buildings get one, and a measured roof outranks the rules:

- 46,239 solids carry a pitched roof. Ridges mostly run across the footprint (25,668) rather
  than along it (12,801), as the narrow, deep lots of machiya would have it.
- The median pitch is 20.7°, close to the 4/10 slope of kawara.
- On the 324 buildings that OSM also maps, the two agree on flat or pitched for 89%, and on
  the shape family for 85%.
- Against the measured roofs, the inference rules that dress Osaka and Tokyo get flat or
  pitched right 67% of the time (59,505 buildings), and the shape family 49%.

## 3. Terrain

The terrain check compares the GSI DEM5A grid with GSI's own elevation service at 376 open
points: median difference 0.05 m, 93% within 1 m, largest 6.7 m. This is **not independent**:
the service serves the same laser survey, at 1 m where flown. It confirms that the stitching
and the projection are right, not that the survey is. Terrarium (a surface model, which
includes buildings) is used by `radar_check.py` as the independent test of building mass.

Kyoto is 25–80 m above sea level, and the viewer's water plane is at 0 m, so rivers and ponds
are left to the aerial photograph (`water.classes` is empty) and `water.sea` is false: no sea
is drawn past the model's edge. Where the 5 m laser DEM has no data (1% of the stitched
tiles, mostly the river beds), the nearest cell fills it. The branch that added Kyoto set
those cells to sea level, 25–80 m below the ground around them.

## 4. Sun on public places

Kyoto has no statutory sun window for public places. The places listed (Kyoto Gyoen, Kamo
Park, Umekoji Park, Maruyama Park, Shosei-en) are measured for 10:00–14:00 and none is
marked protected. Mean share in direct sun (trees are not modelled): the Imperial Gardens
87% in January, 86% in December, 93% in June. Shosei-en is the most shaded of the five,
at 77–79% in winter. The surface model follows the measured roofs, which lowers it under
every ridge and moves the places by up to 3 points (Shosei-en) against flat blocks.

## 5. The game: Kyoto on Foot

Six people, a quest chain from Kyoto Station through Higashi Honganji, Karasuma-Shijo,
Nishiki Market and Nijo Castle to the Imperial Gardens, a helicopter from Umekoji Park, and a
crowd dressed from a Japanese palette (dark hair, suits, school uniforms). Several characters
are in Kyoto from Tokyo: a salaryman who came down on the Nozomi, and a student on her
school trip. What they say about the model is computed from it; the cultural facts (Goei-do
rebuilt in 1895, Nijo Castle 1603, Kyoto's narrow deep machiya) are common knowledge, not
verified for this project.

## 6. What is not verified

- The 31 m height cap in the tour is the figure usually quoted for the busiest districts under
  Kyoto's 2007 landscape policy; the district map was not checked. The counts of buildings
  above 31 m (1,340) and 45 m (65) are from the model, and inherit the PLATEAU question in section 1.
- The Kyoto Tower radii and observation-deck shape are an approximation.
- The `accuracy` panel compares PLATEAU with OSM-mapped heights, not with published tower heights.
