# Tokyo: Marunouchi to Tokyo Tower

Tokyo is the first city here where the open data includes a measured height for
almost every building. This note records what the model is built from, what was
checked and what was not. Every number comes from the scripts in `pipeline/` and
`analysis/` run with `--city tokyo`; outputs are in `cities/tokyo/analysis/`.

## 1. What is in it

- **Area:** 3.2 × 4.8 km, from Nihonbashi and Shimbashi in the east to Tokyo Tower
  in the west, and from the Imperial Palace and Hibiya Park south to Hinode Pier.
- **Buildings:** about 15,400, with 19,000 solids.
- **Heights:** 76% of the footprint area stands at a height measured by Project
  PLATEAU's LOD2 survey. The rest comes from OpenStreetMap, floor counts, or an
  estimate from neighbours (19% of the area, the weakest part; the neighbour
  estimator's cross-validated median error factor is 1.36).
- **Landmark:** Tokyo Tower is built from published dimensions (333 m, decks at
  150 m and 250 m, an 80 m base), anchored at its published coordinates. It is
  an approximation of the lattice, not a scan.

## 2. Sources

| Layer | Source | Licence |
|---|---|---|
| Building heights, massing | Project PLATEAU Tokyo 23 wards LOD2 (MLIT), read as the vector tiles published by indigo-lab | CC BY 4.0 (PLATEAU), MIT (tiles) |
| Footprints, names, roads, water, parks | Overture Maps, release 2026-10-21.0 (OpenStreetMap) | ODbL |
| Terrain | GSI DEM5A, 5 m airborne laser survey, bare earth (10 m DEM where 5A has no data) | GSI terms of use |
| Aerial photos | GSI seamless photos, zoom 17 | GSI terms of use |

## 3. How PLATEAU is used

PLATEAU's outlines are roof faces: one tower is a podium face and a tower face.
`pipeline/build_scene.py` (class `Plateau`) cuts each Overture footprint along
those faces, tallest first, so a podium and its tower each get their own height.
Faces that are small and only a few metres above the main roof (plant rooms) are
absorbed. A small face more than 8 m above the main roof is kept: it is a spire
or a dome (the Diet's tower, Tokyo Station's domes). PLATEAU buildings that no
Overture footprint covers are added: 1,400 of them.

PLATEAU measures to about 2020. A tower finished since then appears only if
Overture or OpenStreetMap has it.

## 4. Checks

- **PLATEAU against OpenStreetMap:** `analysis/plateau_check.py` compares the two
  on 135 buildings of 20 m and over that carry both. Median disagreement
  2.8%, 96 within 10%, 110 within 20%, 10 more than 40% short and 10 more than 40%
  tall. The big misses are mostly OpenStreetMap tagging a podium or a neighbour's
  height, and new towers that PLATEAU predates. OpenStreetMap is the independent
  source here, but it is not a survey either.
- **Terrain:** GSI DEM5A is airborne laser bare earth. No second independent
  elevation source was compared (Australian cities use a LiDAR identify service),
  so the check in `docs/ADDING_A_CITY.md` for terrain is not met for Tokyo yet.
- **Not done:** published tower heights by street address. Japanese addresses do
  not match `analysis/heights.py`'s Western matching. The checks above stand in.

## 5. Sun and the rules

Tokyo has no rule that protects sun on public places. 日影規制 (Building
Standards Act, art. 56-2) limits hours of shadow on neighbouring land in
designated zones, and does not apply in commercial districts such as Marunouchi.
The places in the model (Hibiya Park, the Palace plaza, Marunouchi Central
Plaza) carry a lunch-hour window of 12:00 to 13:00 that this project chose, so
"test a new tower" answers what a rule would cost. It is not law. Tokyo keeps
standard time all year.

## 6. The game

**Tokyo on Foot** has nine stamps: Tokyo Station, Marunouchi, the Imperial
Palace, Hibiya Park, Ginza, the water bus, a helicopter flight, Tokyo Tower and
the survey itself. The people are Tokyo's: a station attendant who points and
calls, a salaryman who explains the air rights above Tokyo Station, a Palace
runner, a Hibiya Park regular, an office worker, a yakitori master under the
Yurakucho tracks, a water-bus captain, a helicopter pilot, a Tokyo Tower guide
and a schoolgirl. The crowd takes its palette from `OEPeople` style `tokyo`: dark
suits, navy blazers, black hair, many office workers. Names and place labels are
bilingual. The water-bus piers are real (OpenStreetMap), the vessel names are
Tokyo Cruise's, and the timetable is invented. The helipad in Hibiya Park is a
game device; no real heliport is in the area.

## 7. Limits

- The aerial photos are not true orthophotos, and tall towers lean in them; roof
  colours of towers over 40 m are neutral.
- Tokyo Tower is not a scan. The lattice is regular, the observatories are boxes.
- 19% of the footprint area still has an estimated height. Look for the green
  tint under **Height sources**.
- Names from OpenStreetMap are mostly Japanese; English labels were added by hand
  for about twenty landmarks.
