# Paris: every roof measured

Central Paris from the Eiffel Tower to the Île Saint-Louis, and from the Arc de
Triomphe to the Tour Montparnasse: 5.6 × 4.0 km of the densest city in this
project. It is the first city here where the open data is a laser survey of every
roof. IGN, France's mapping agency, flew its LiDAR HD over Paris on 2 and 3 March
2023 and publishes the result under the Licence Ouverte. The model takes each
building's height from that survey, cuts monuments and courtyards from it, and reads
each roof's shape from the laser's profile over the surveyed eaves.

![Paris at dusk, from the south-east](../images/paris/overview.jpg)

| The Eiffel Tower | The Île de la Cité | Zinc mansards on the Left Bank |
|---|---|---|
| ![](../images/paris/eiffel.jpg) | ![](../images/paris/cite.jpg) | ![](../images/paris/roofs.jpg) |

<!-- SUMMARY -->

## 1. Data

| What | Source | Licence |
|---|---|---|
| Footprints | OpenStreetMap via Overture Maps (release 2026-10-21.0); IGN BD TOPO where Overture has none | ODbL; Licence Ouverte 2.0 |
| Heights | IGN LiDAR HD normalised surface model (MNH), 0.5 m, flown 2-3 March 2023 | Licence Ouverte 2.0 |
| Eaves, floors, dates, use, materials | IGN BD TOPO `batiment` (WFS on the Géoplateforme); materials from the Fichiers fonciers | Licence Ouverte 2.0 |
| Terrain | IGN LiDAR HD bare earth (MNT), resampled to 2 m | Licence Ouverte 2.0 |
| Terrain check | IGN RGE ALTI 1 m, an earlier, independent bare-earth model | Licence Ouverte 2.0 |
| Aerial photographs | IGN BD ORTHO, zoom 17 (0.8 m) | Licence Ouverte 2.0 |
| Bridges, Batobus stops, places | OpenStreetMap via Overture | ODbL |

Everything comes from IGN's Géoplateforme (`data.geopf.fr`), with no key:
`pipeline/fetch_ign.py` pages through the BD TOPO WFS (36,871 buildings in the
bounding box) and reads the LiDAR rasters from the WMS-R as float32 BIL in tiles of
2,500 pixels. The LiDAR's flight dates come from IGN's own metadata layer
(`IGNF_LIDAR-HD_METADONNEE:metadata`, mission 22LHDKE).

### The scene's zero is the Seine

The viewer draws water at 0 m. Sydney and Melbourne sit on the sea; Paris sits
26.9 m above it. So the scene's datum is the Seine's level on the day of the LiDAR
flight, measured from the data itself: the LiDAR terrain is hydro-flattened over the
river, and its median over the 985,000 one-metre cells of the Seine (islands cut
out) is 26.9 m NGF-IGN69; 87% of the cells lie within 0.5 m of it.
`datum_offset_m` in `city.json` subtracts it from the terrain, so every height in
the scene is a height above the river. The elevation checks add it back.

### The islands

Overture's polygon for the Seine has no holes: the Île de la Cité and the Île
Saint-Louis are inside it. They are mapped separately as islets, so the pipeline now
cuts every mapped island and islet out of a city's water.

## 2. Heights

<!-- HEIGHTS -->

## 3. Roofs

<!-- ROOFS -->

## 4. Terrain

<!-- TERRAIN -->

## 5. Landmarks

<!-- LANDMARKS -->

## 6. Paris on Foot

<!-- GAME -->

## 7. Limitations

<!-- LIMITS -->

## 8. Reproducing it

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  python pipeline/fetch_overture.py --city paris
python pipeline/fetch_ign.py --city paris        # BD TOPO buildings and LiDAR HD (about 600 MB)
python pipeline/fetch_tiles.py --city paris      # BD ORTHO, LiDAR terrain, Terrarium
python pipeline/build_scene.py --city paris      # about 8 minutes
python pipeline/landmarks.py --city paris
python analysis/heights.py --city paris
python analysis/lidar_check.py --city paris
python analysis/dem_check.py --city paris
python analysis/data_quality.py --city paris
python analysis/radar_check.py --city paris
node analysis/sun_access.js --city paris
node analysis/error_budget.js --city paris
node analysis/time_basis.js --city paris
node analysis/uncertainty.js --city paris 40
python pipeline/game_data.py --city paris
```
