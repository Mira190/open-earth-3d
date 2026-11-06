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

### The National Diet Building

The Diet's 26 mapped solids are drawn in granite by `cities/tokyo/diet.py` and
hidden (they stay in the surface model): courses over a plinth, three storeys of
tall windows between string courses, cornice and parapets, the chambers'
measured skylit roofs, the east porch's square columns, and the tower: a square
base, the colonnade of its upper stage between corner piers and the stepped
pyramid to the lantern at 65.45 m (House of Representatives, the building's
fact sheet: 206.36 by 88.63 m). The storeys and the tower's stages are taken
from photographs.

### The palace moats and their bridges

GSI's laser DEM has no returns from water, and its gaps are filled from the castle's banks, so the
moats read several metres above the streets beside them (the Wadakura moat at 6.8 m against banks of
2.8 m) and Wadakura-bashi and the Seimon Ishibashi ramped down to the banks. `cities/tokyo/moats.py`
makes each moat water at its own level: the twelve Outer Garden moats at the levels the Ministry of
the Environment publishes (Kokyo Gaien National Garden Office, 皇居外苑濠 濠別管理方針, March 2010:
水面標高 T.P. m): Wadakura, Babasaki and Hibiya 1.43 m, Kikyo, Otemachi and Shimizu 1.87 m, Hamaguri
2.37 m, Gaisen 2.85 m, Sakurada and the Nijubashi moat 3.82 m, Hanzo and Chidorigafuchi 15.98 m. The
moats inside the palace, which have no published level, stand at their low bank less 1.7 m, the median
of the Outer Garden moats' banks over their water. The ground under each moat goes down to a bed, the
DEM's fill that bled onto the banks beside them is taken off (a point within 10 m of a moat stands no
higher than the bank 12 m back), dressed stone walls stand from the water to the bank, and the game
treats the moats as water at their level. The bridges over them now meet their banks where they are
(Wadakura-bashi at 2.7 and 2.9 m) instead of a river's 3.5 m embankment.

The Seimon Tetsubashi (二重橋) is level, without a crown, at the Seimon terrace's 16.7 m (GSI's laser over
the flat terrace at its south end; the palace side reads 16.5 to 17 m). The 5 m DEM spreads the Nijubashi
moat's walls over 15 to 18 m of slope, which had set the deck from 15.3 down to 10.1 m. Within 40 m of the
bridge (fading over 30 m more) the walls now stand to the terrace, read 18 m back from the shore, and the
ground behind them is the terrace's (`moats.py` WALLED).

![The Seimon Tetsubashi level between the Nijubashi moat's walls](../images/tokyo/nijubashi-level.jpg) The outlines are
OpenStreetMap's (ODbL); `python cities/tokyo/moats.py` writes `cities/tokyo/moats.json`, and
`pipeline/refresh_terrain.py --city tokyo --hook`, `pipeline/refresh_bridges.py`, `pipeline/landmarks.py`
and `pipeline/game_extras.py` bring a built city up to it.

![Wadakura-bashi level with its banks over the Wadakura moat at 1.43 m](../images/tokyo/moats-wadakura-bashi.jpg)
![The Seimon Ishibashi over the Nijubashi moat at 3.82 m](../images/tokyo/moats-seimon-ishibashi.jpg)

### Nihonbashi's bronzes

Nihonbashi (1911, Tsumaki Yorinaka; the bronzes by Watanabe Osao) carries, from its photographs, the
two lamp standards over its middle pier on granite pedestals, each with a pair of winged kirin back to
back, and at its four ends granite pillars with their lamps and the lions holding the City of Tokyo's
crest. The figures are sculpted fields (`pipeline/sculptkit.py`) in `pipeline/bridges.py` (city.json
bridges forms `"statues"`); every bridge with bronze lamps (Nihonbashi, Tokiwabashi, the Seimon
Ishibashi, the Nijubashi) has turned candelabra with glass globes, and the bridges' lamps glow after
dark. The Shuto Expressway over Nihonbashi is not drawn.

![Nihonbashi at dusk: the kirin on the middle lamp standards and the lions at the ends](../images/tokyo/nihonbashi-bronzes-dusk.jpg)

### The Nihonbashi River in the viewer (#246)

In software stills (llvmpipe) the water seemed to add nothing over the Nihonbashi River. Measured again: at
the river's middle (1420, 1565) the ground is below the water (-0.05 m and the bed at -4 m), and hiding the
water changes 17,790 pixels of a 1440 × 900 still; the earlier test was aimed at (1420, 1590), on the
bank, where the ground is 3.9 m up. Under the Shuto's deck the river is in shade, and the water's own colour
there is close to the bed's, so it reads as dark either way. The quays now raise only the grid points by the
bank (`web/quays.js`, [ARCHITECTURE.md](../ARCHITECTURE.md)). Not checked on a real GPU.

### The slab by the M8 exit (#246)

Solid 18776, a PLATEAU block of 15 × 5 m and 2.4 m beside Tokyo Station's M8 exit at (583, 1400), has no
name or class: a vent's or a stair's cover. It was drawn as a one-storey house with windows under the trees;
it is drawn plain now, and so is the M8 exit's own cover (`pipeline/arcades.py`, low structures). Not
checked against a photograph: Wikimedia Commons refused this session's requests.

### The Imperial Palace

The Kyūden (1968, Yoshimura Junzō) was 43 mapped parts with flat tops. `cities/tokyo/palace.py` draws
its wings, the union of those footprints with the courts as holes, with pale walls to their eaves at
9 m and green copper hipped roofs that follow every turn of the outline (`archkit.outline_roof`) up to
the mapped tops of 15 to 17 m. An unnamed 64 m² outline in the east court that the build gave its
neighbours' 22 m is left out.

![The Imperial Palace's wings under their outline roofs](../images/tokyo/imperial-palace-roofs.jpg)

The Kabuki-za's roof garden, with the white PLATEAU block hidden:

![Kabuki-za's roof garden](../images/tokyo/kabukiza-roof-garden.jpg)

## 2. Sources

| Layer | Source | Licence |
|---|---|---|
| Building heights, massing | Project PLATEAU Tokyo 23 wards LOD2 (MLIT), read as the vector tiles published by indigo-lab | CC BY 4.0 (PLATEAU), MIT (tiles) |
| Footprints, names, roads, water, parks | Overture Maps, release 2026-10-21.0 (OpenStreetMap) | ODbL |
| Terrain | GSI DEM5A, 5 m airborne laser survey, bare earth (10 m DEM where 5A has no data) | GSI terms of use |
| Aerial photos | GSI seamless photos, zoom 17 | GSI terms of use |
| Shuto Expressway (Nihonbashi) | Overture Maps segments (OpenStreetMap); heights from photographs | ODbL |
| Palace moats' water levels | Ministry of the Environment, Kokyo Gaien National Garden Office: 皇居外苑濠 濠別管理方針 (March 2010) | Government publication, cited |

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

The integrated build runs the sun analysis for Tokyo for the first time
(`analysis/sun_access.js`, `cities/tokyo/analysis/sun_access.json`). Mean share
of each place in direct sun over the window, December and June: Hibiya Park 75%
and 93%, Marunouchi Central Plaza 28% and 98%, Shiba Park 33% and 94%, the
Palace plaza 100% in both. Between its towers, Marunouchi Central Plaza is the
place where a new tower would matter most in winter.

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
Tokyo Cruise's, and the timetable is invented. The boats are the shared harbour
ferry in an approximate white and navy. The trees are the shared set's ginkgos,
zelkovas, planes, camphors and pines, and Somei-yoshino cherries in flower from 24 March at
Chidorigafuchi and along its moat walk, in Kitanomaru, Hibiya and Shiba parks and on the
streets. The pads on the Marunouchi plaza (where the game now starts, in front of the station) and in Hibiya Park are game devices; no real
heliport is in the area.

## 7. Limits

- The aerial photos are not true orthophotos, and tall towers lean in them; roof
  colours of towers over 40 m are neutral.
- Tokyo Tower is not a scan. The lattice is regular, the observatories are boxes.
- 19% of the footprint area still has an estimated height. Look for the green
  tint under **Height sources**.
- Names from OpenStreetMap are mostly Japanese; English labels were added by hand
  for about twenty landmarks.
