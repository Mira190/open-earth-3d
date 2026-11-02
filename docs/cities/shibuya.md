# Shibuya & Shinjuku: the stairs of Your Name, SHIBUYA SKY and a game's Tokyo

Shibuya and Shinjuku are the real city first: Overture's footprints at the heights
Project PLATEAU surveyed, on GSI's laser-scanned bare earth, under the real sun.
On top of that sit the places a film and a game made famous, ten years on. Suga
Shrine's 男坂 in Yotsuya is the staircase on the poster of *Your Name* (君の名は。,
2016). Shibuya's scramble, Center Gai, Sangenjaya's backstreets and Kabukicho are the
streets *Persona 5* (2016) redrew as its Tokyo. This note records how those places
were built, from what, and what is not known. Every number comes from the scripts
in `pipeline/` and `analysis/` run with `--city shibuya`; outputs are in
`cities/shibuya/analysis/`.

![Sangenjaya to Shinjuku from the south-east, with Yoyogi Park and Meiji Jingu](../images/shibuya/overview.jpg)

| The 男坂 at dusk, rendered in Cycles (`blender/build_scene.py`) | Kabukicho's arch at night, in Cycles |
|---|---|
| ![](../images/shibuya/cycles-suga-stairs.jpg) | ![](../images/shibuya/cycles-kabukicho.jpg) |

![SHIBUYA SKY's roof in Cycles: GEO COMPASS, the deck, the hammocks, the escalator's well and SKY EDGE's light lines](../images/shibuya/cycles-shibuya-sky.jpg)

| The 男坂 from the lane at its foot, late afternoon | Halfway up: red rails on both sides and down the middle |
|---|---|
| ![](../images/shibuya/suga-stairs.jpg) | ![](../images/shibuya/suga-stairs-mid.jpg) |
| **The approach: the great torii, the banners, Mr Sato** | **The hall** |
| ![](../images/shibuya/suga-approach.jpg) | ![](../images/shibuya/suga-hall.jpg) |
| **Reading an ema of 2026, under Yotsuya-sanchome's station sign** | **The precinct from the air** |
| ![](../images/shibuya/game-ema.jpg) | ![](../images/shibuya/suga-aerial.jpg) |
| **SHIBUYA SKY: SKY EDGE at sunset** | **Riding up from 46F** |
| ![](../images/shibuya/sky-edge.jpg) | ![](../images/shibuya/sky-escalator.jpg) |
| **The roof: GEO COMPASS, the escalator's well, the hammocks** | **CROSSING LIGHT** |
| ![](../images/shibuya/sky-aerial.jpg) | ![](../images/shibuya/sky-night.jpg) |
| **The scramble** | **Center Gai's arch at dusk** |
| ![](../images/shibuya/scramble.jpg) | ![](../images/shibuya/center-gai.jpg) |
| **Sangenjaya after dark** | **Kabukicho's arch** |
| ![](../images/shibuya/yongen-night.jpg) | ![](../images/shibuya/kabukicho-night.jpg) |
| **Walking into Shibuya: the station sign, Hachiko and Aoi** | **Overheard at the foot of the stairs** |
| ![](../images/shibuya/game-sign.jpg) | ![](../images/shibuya/game-stairs-talk.jpg) |

## 1. The short answer

- **Scope.** 5.4 × 6.2 km, from Sangenjaya in the south-west to Shinjuku and
  Yotsuya in the north-east, with Shibuya, Harajuku and Aoyama between: 90,304
  buildings in 94,916 solids. 1,915 of them are PLATEAU buildings that Overture
  does not have.
- **Heights.** 85.6% of the footprint area stands at a PLATEAU surveyed height,
  3.4% at an OpenStreetMap height, 1.1% at a floor count and 9.9% at an estimate
  from the neighbours. 38 buildings that OpenStreetMap maps much taller than the
  survey keep the mapped height: they were built since (the Tokyu Kabukicho
  Tower among them).
- **Terrain.** GSI's 5 m airborne-laser DEM. Against GSI's elevation service at
  1,051 points it agrees to a median of 0.01 m, and 98% within a metre. AWS's
  global Terrarium tiles read 6.1 m too high at the median, because they are a
  surface model.
- **Suga Shrine.** The 男坂's 52 steps in three flights, with landings and red
  iron handrails, set into the slope; the 女坂; the hall, the great torii, the
  temizuya, lanterns, komainu, the Tenpaku Inari and about 400 ema of 2026 on the
  rack. Section 4.
- **SHIBUYA SKY.** The open roof of Shibuya Scramble Square, 229 m up: deck, glass
  fence, SKY EDGE, GEO COMPASS, CLOUD HAMMOCK, the escalator from 46F and the 18
  searchlights. In the game you take the lift up and ride the escalator out.
  Section 5.
- **A game's Tokyo, as it is.** The scramble's crossings and Hachiko, the Center
  Gai arch, the big screens and SHIBUYA109, Sangenjaya's lanes, Kabukicho's arch,
  the Docomo tower's clock, and shop signs and utility poles in the
  neighbourhoods. Section 6.
- **Game.** *Tokyo Pilgrimage*: a welcome at Hachiko, then five walks in any
  order. Section 7.

## 2. Sources

| Layer | Source | Licence |
|---|---|---|
| Building heights, massing | Project PLATEAU Tokyo 23 wards LOD2 (MLIT), read as the vector tiles published by indigo-lab | CC BY 4.0 (PLATEAU), MIT (tiles) |
| Footprints, names, roads, steps, water, parks | Overture Maps, release 2026-10-21.0 (OpenStreetMap) | ODbL |
| Points in the shrine precinct | OpenStreetMap nodes (the temizuya, the fire brigade's mound, the subsidiary shrines) | ODbL |
| Terrain | GSI DEM5A, 5 m airborne laser survey, bare earth (10 m DEM where 5A has no data) | GSI terms of use |
| Aerial photos | GSI seamless photos, zoom 17 | GSI terms of use |
| Lettering on ema, plaques and signs | Google Fonts (Yomogi, Zen Kurenaido, Klee One, Yuji Syuku, Shippori Mincho, DotGothic16, RocknRoll One, Ma Shan Zheng, ZCOOL KuaiLe, Long Cang, LXGW WenKai TC, Nanum Pen Script, Caveat, Kalam) | SIL Open Font License |

## 3. Heights and terrain

PLATEAU covers the whole area; `pipeline/build_scene.py` cuts each Overture
footprint along PLATEAU's roof faces, as in [Tokyo](tokyo.md#3-how-plateau-is-used).

- **PLATEAU against OpenStreetMap.** `analysis/plateau_check.py` compares the two
  on the 1,018 buildings of 20 m and over that carry both: median disagreement
  6.8%, 656 within 10%, 870 within 20%, 19 more than 40% short and 29 more than
  40% tall. The largest misses are a tag on the wrong part (a 27 m tag on a
  176 m tower's podium) and buildings OpenStreetMap maps as a single height where
  PLATEAU has the tower.
- **The estimate.** 9.9% of the footprint area, mostly small buildings PLATEAU's
  tiles miss. The neighbour estimator's cross-validated median error factor is
  1.19 (90th percentile 1.76).
- **Terrain.** `analysis/dem_check.py` samples GSI's elevation service, which
  serves the 1 m laser DEM where it was flown and DEM5 elsewhere, at 1,051 points:
  median difference −0.01 m, 90th percentile 0.28 m, 98.4% within 1 m. That is the
  same agency's survey, so it checks the reading of the tiles more than the
  survey.
- **Cuts.** The stairs are set into the slope (`adjust_terrain` in
  `cities/shibuya/city.py`): the terrain under each tread is lowered by the least
  change to the grid that clears it, and each grid point moves in proportion to
  how far it stands above the treads, so the hillside beside the stairs takes the
  cut and the lane at the foot barely moves. The checks compare the uncut DEM.

## 4. Suga Shrine and the 男坂

### 4.1 The stairs

The 男坂 is the staircase the film's two leads pass on, and the one on its poster.
The Tokyo stairs database gives it as 52 stone steps, 3.6 m wide, about 16 m long,
at about 27°, with red iron handrails on both sides and down the middle. The model
puts OpenStreetMap's line for the steps on GSI's DEM, which rises 6.8 m from the
lane to the approach (the database gives 6.1 m). The steps take that rise, so they
meet the street and the approach exactly:

| | Model |
|---|---|
| Steps | 52: flights of 18, 16 and 15 up to the approach, and 3 more to the ridge road |
| Riser, tread | 0.139 m, 0.273 m |
| Landings | two, 1.32 m deep |
| Width, length | 3.6 m, 16 m |
| Handrails | red iron, both sides and down the middle |

In the game the stairs are a walkable surface whose profile follows every riser,
so feet land on the treads, and the crowd's footways are draped onto it.

### 4.2 The precinct

The approach runs from the head of the 男坂 to the hall, along OpenStreetMap's
path; the hall stands on OpenStreetMap's footprint and faces the torii. From the
stairs: the great torii (1990, vermilion, myojin style, with its green plaque),
the shrine's banners, the temizuya on the right with the く組 fire brigade's
ladder mound beside it, stone lanterns and two pairs of komainu, the ema rack, the
haiden with its green copper irimoya roof, chidori gable and karahafu over the
porch, and the honden behind it. Beside them: the Daikoku and Sorei shrines and
the Tenpaku Inari with its small torii and foxes. The OpenStreetMap nodes place
the temizuya, the mound and the subsidiary shrines; lanterns and komainu are
placed by a clearance search against the precinct's buildings. The hall is
reinforced concrete since the post-war rebuilding; its roof's proportions are an
approximation from photographs, with the ridge at PLATEAU's 10.5 m.

### 4.3 The ema of 2026

The rack carries about 400 ema, two-sided pentagons. The front is the shrine's own
design, the 男坂 painted in colour; the back is a wish, in Japanese, Chinese,
Korean, English, Spanish and French, many for the film's tenth anniversary
(26 August 2026). The wishes were written for this model: no official
anniversary ema had been announced when it was built, and none is a quotation from
the film. There is no character art. The doodles are comets, braided cords and
stairs. In the game, <kbd>E</kbd> at the rack reads one at random, with an English
gloss.

## 5. SHIBUYA SKY

The open deck on the roof of Shibuya Scramble Square (opened 1 November 2019):
about 2,500 m² at 229 m. Visitors ride the lifts of SKY GATE from 14F to 45F at
360 m a minute, and climb from the 46F gallery to the roof on an escalator walled
in glass.

- **The deck** is put at PLATEAU's lower roof tier (227.1 m above the ground) and
  GEO COMPASS reaches its top tier. Scramble Square's solids each stand on their
  own ground, a few centimetres apart; their heights are set so that every top is
  at one level, the one the deck is drawn at, so feet, boards and the escalator
  meet. PLATEAU has a 190 m² band along the west and north edges 9 m lower; it is
  under the edge of the deck here and is raised to it.
- **On the roof:** the deck boards, the glass fence on steel posts (lowest at SKY
  EDGE, the corner over the scramble), light lines in the floor fanning out to
  that corner, GEO COMPASS (a raised square with a compass on its floor and steps
  up each side), CLOUD HAMMOCK's nets, and the 18 searchlights of CROSSING LIGHT,
  which the light show turns on after dark.
- **The escalator** rises 5.5 m at 30° from a landing on 46F, in a well cut into
  the roof, with glass balustrades and black handrails. In the game it is a
  walkable surface that moves at 0.5 m/s: stand on it and it carries you up.
- **Estimates.** The plan of the roof furniture is drawn from photographs and the
  GSI aerial photo, whose view of the tower leans. The escalator's rise, angle and
  speed and the fence heights are estimates.

## 6. A game's Tokyo, as it is

*Persona 5* drew its Tokyo from these streets and renamed some of them: Sangenjaya
became Yongen-Jaya, and Center Gai became Central Street. The model keeps the real
names and the real geometry, and leaves out what belongs to the game: no
characters, logos, invented shops or interface. What is built:

- **The scramble.** The crossings are found where OpenStreetMap's footway
  crossings share nodes with the roads around the junction, and drawn as 0.45 m
  zebra bars. Hachiko sits on his pedestal (the statue since 1948), with its
  plaque.
- **Center Gai's arch**, lit after dark, and **SHIBUYA109**'s vertical sign. The big
  screens are in section 6a.
- **Sangenjaya**, the triangle between Setagaya-dori and Route 246: the front of a
  snack bar the game's café is drawn on (New Marina), the bathhouse Chiyo-no-yu
  with its noren, the coin laundry and vending machines beside it, the meat shop on
  the corner, and utility poles with their wires down the lanes. The Carrot Tower
  stands over it in its own colour.
- **Shinjuku:** Kabukicho Ichibangai's red arch (1969), and the Docomo tower's clock
  (15 m across, 150 m up) and mast to 272 m.
- **Signs.** About 1,560 shop signs on street fronts in the districts. They are
  indicative, not the real shops' signs.

- **The crossing after dark** is section 6a.

Two things are left out on purpose: the Godzilla head on the Toho building and
Okamoto Taro's mural *Myth of Tomorrow* in the station passage are artworks the
model does not reproduce. The green Aoi-gaeru train car that stood by Hachiko until
2020 has gone to Odate and is not shown.

## 6a. The crossing after dark, as it stands in 2026

![From Hachiko at 20:15: Q'S EYE and its banner on QFRONT's glass, SHIBUYA TSUTAYA, Q'S WALL, the Nishimura banner, Rakuten Vision and the arch](../images/shibuya/crossing-night.jpg)

| The scramble from the air at 20:15 | CROSSING LIGHT over SHIBUYA SKY, 20:31 |
|---|---|
| ![](../images/shibuya/crossing-aerial-night.jpg) | ![](../images/shibuya/crossing-light.jpg) |
| **Hachiko Square, the hoarding round the Toyoko site behind it** | |
| ![](../images/shibuya/hachiko-night.jpg) | |

The scramble is lit by its screens. Each one stands on its own building at its published size,
and plays a programme drawn for this model. The brands, music, films and games are invented, and
the ward's notices are generic. The screens play from 9:00 to midnight, as the operators run
them, and are dark after that.

| Screen | Where | Size (w × h) | Source |
|---|---|---|---|
| Q'S EYE, and its banner screen | NW, built into QFRONT's glass over the diagonal | 12.96 × 7.289 m, banner 12.96 × 5.33 m | Tokyu OOH media sheet (spec of 15 Aug 2025) |
| Rakuten Vision (formerly Mighty Vision, DHC Channel) | W corner, Taiseido building at Center Gai's mouth | 10.24 × 5.76 m | Mainichi Kokoku sheet, 2024 |
| Shibuya Ekimae Vision, and its banner screen | SW, roof of the Shibuya Ekimae building | 21.6 × 12.144 m over 21.6 × 4.176 m | Tokyu OOH; traffic news, 2018 |
| Shibuhachi Hit Vision | SW, roof of the Oto building, south of it | 24.32 × 17.28 m | HIT |
| Starts Vision SHIBUYA (formerly Glico Vision) | NE, top of the Sanzenri building beside MAGNET | 6.356 × 3.456 m | Shibuya Television |
| 109 Forum Vision, and its banner screen | NE, MAGNET by SHIBUYA109 | 8.64 × 4.8 m | media sheet |
| Shibuya Scramble Square Vision | SE, lower floors of the east tower, behind its glass | 552.6 m² in a 25.24 × 40.05 m box; 13.79 × 20.24 m on the east face | Tokyu OOH; Panasonic |
| Shibuya Nishiguchi Sky Vision (May 2026) | W, roof of the Shibuya Mitsubishi building | 15.2 × 11.4 m | Shibuya Television |
| Synchro7 | E, seven faces on three buildings at Miyamasuzaka-shita | not published: estimated | HIT |

- **Together.** The five screens in the standard synchronised slot (Q'S EYE, the Ekimae vision,
  Rakuten, Starts and 109 Forum) play the same clip together. The real slot is 15 seconds, four
  times an hour; the model runs it for 18 seconds every two and a half minutes, so a visit
  catches it. Synchro7's seven faces always play as one.
- **Lit signs.** These are lit from outside:
  - QFRONT's Q'S WALL prints, on both glass side walls (the real lamps: 11 and 8).
  - The Ekimae building's 25 × 4 m vertical board.
  - The Nishimura building's 7.6 × 14.6 m banner.
  - MAGNET's 18.25 × 3.71 m banner and a wall ad.

  These are lit boxes:
  - MAGNET's name over its corner, in words and not its logo.
  - SHIBUYA TSUTAYA's name on QFRONT (placement estimated).
  - SHIBU HACHI BOX, the ward's tourist information on Hachiko Square since October 2020.

  The trades' stacked signs (袖看板) and lit prints on the fronts round the crossing are
  indicative.
- **Light on the street.** Each screen throws a pool of light on the street in front of it, in
  the mean colour of its programme. No street-lamp pole stands in the scramble.
- **The old Tokyu Toyoko site.** The West and South buildings behind Hachiko closed in 2020 and
  have been pulled down. The South building was gone by January 2026. The second phase of Shibuya
  Scramble Square has been building on the site since May 2025, due in fiscal 2031. PLATEAU's
  survey still has the twelve solids standing, and OpenStreetMap has removed them. They are left
  out here (`landmarks.json` `demolished`), and the site is a construction site: a hoarding with
  the developer's notice, floodlights and a tower crane. The crane's place and height are
  illustrative.
- **Hachiko Square.** Hachiko has faced east, towards the station, since May 1989, when his
  pedestal was lowered so people could touch him. Metal benches ring him. The station's Hachiko
  gate moved to the Miyamasuzaka side on 26 January 2025, and the *Hachiko Family* tile relief
  was taken down from February 2025, so neither is drawn.
- **SHIBUYA SKY's CROSSING LIGHT.** Its 18 searchlights put on a show from 19:00, on the hour and
  the half hour, to 22:00 (`light_show` `every`, `until`). Each show's length and the beams'
  movement are illustrative.
- **Closed and gone.** Seibu Shibuya's A and B buildings closed at the end of September 2026; no
  screen or lit sign is drawn on them. Coca-Cola's transparent screen on QFRONT's roof (2020) is
  not drawn: whether it is still there could not be confirmed.

What could not be checked: how high up its wall most screens sit, and which way the roof
screens face (both estimated from photographs); the outline of Scramble Square's irregular
screen, which is stepped here; the trees and night lighting of Hachiko Square; the colours of
the Center Gai arch; and where Scramble Square's colour lighting is on the tower.

## 6b. Shinjuku's east exit after dark

The same kit (`pipeline/screens.py`, `pipeline/adkit.py`) lights the plaza at Shinjuku's east
exit, in the north of the model. Its screens have a sheet of their own (`screens_east.jpg`,
2048 × 1024, six clips) and a material of their own (`screens_east`).

| Screen | Where | Size | Source |
|---|---|---|---|
| Cross Shinjuku Vision | the roof of the Cross Shinjuku building (新宿3-23-18, OpenStreetMap w153133263), bent round its corner over the plaza | 18.96 × 8.16 m, 154.71 m², 6 mm pitch | [AV Watch](https://av.watch.impress.co.jp/docs/news/1337489.html), [DIME](https://dime.jp/genre/1179382/) |
| Unica Vision, three screens | the rounded front of the Shinjuku Unica building (新宿3-23-7) towards Yasukuni-dori and Seibu-Shinjuku station | 13.12 × 7.38 m each, 10 mm pitch since November 2024; 7:00-1:00 | Unica and Sekishin media sheets, [DreamNews](https://www.dreamnews.jp/press/0000240807/) |

- **The bend.** Cross Shinjuku Vision is one screen bent round a corner, built as a strip along
  its foot line with the corner rounded (`path`, `round`): about 7.4 m on the face to the south
  and 11.6 m on the face to the east, its picture running across the bend.
- **Pictures drawn for the bend.** The screen is known for pictures that seem to stand out of it
  from the plaza, above all a 3D cat, which is the operator's and is not copied. In its place, a
  goldfish tank whose back wall stands behind the bend, so that the bend reads as the tank's front
  corner, with a fish swimming out over it; and a wave breaking over the corner. Between them
  the screen plays the same invented music and film adverts as Shibuya's.
- **Unica Vision's three screens** play together (one phase), and their light stays on past
  midnight: `web/night.js` takes a screen's hours across midnight (7:00-1:00).

What could not be checked: the height of the Cross Shinjuku building (16.9 m in OpenStreetMap,
lower than its neighbour to the west, so the screen stands in front of that neighbour's wall
there); how long each leg of the bend is; how the Unica screens are spaced round their front and
how high up it they are (estimated from photographs).

## 7. Tokyo Pilgrimage

The game is a walk, not a survey. Aoi, a pilgrimage guide at Hachiko, welcomes you;
then five lines run side by side, and a report back waits for all of them:

| Line | Who | What you do |
|---|---|---|
| Shibuya | Shun at Center Gai, Yuna at the SKY GATE door, Taro at SKY EDGE | Walk onto the scramble, read the arch, take the lift, ride the escalator onto the roof, stand at SKY EDGE |
| Sangenjaya | Haru, a Sangenjaya local; Mr Tanaka, a regular at the bathhouse | Find the snack bar's front, walk the triangle after dark |
| Your Name | Xiaoyu, a pilgrim from Shanghai; Mr Sato, a Yotsuya resident | Climb the 男坂, read an ema, stand at the foot of the stairs (a choice sets the clock to dusk) |
| Shinjuku | Mika, a bartender in 2-chome; Officer Ono at the koban | See Kabukicho's arch after dark |
| Aoyama | Rin, a high-school student | Walk the ginkgo avenue at Jingu Gaien |

The people are original characters. None stands for a real shop's staff.

What the game took from *Persona 5*, and what it does instead:
- **Neighbourhoods with names.** Walking into one puts its name up as Tokyo's
  platforms sign theirs (駅名標): the name, its reading, the line's colour band
  and the stations either side. Ten areas, from Shibuya and Sangenjaya to
  Shinanomachi.
- **Things to look at.** <kbd>E</kbd> at a spot reads it: an ema, the offertory
  box, the temizuya, Hachiko, a vending machine (a can of cold green tea, 150 yen),
  GEO COMPASS, a hammock.
- **Overheard talk.** Pilgrims on the stairs, office workers at the scramble,
  visitors on the roof: their conversation comes up in bubbles as you pass.
- **No calendar, no ranks, no combat.** The clock is the real sun, and the numbers
  people tell you come from the model.

The crowd uses the `tokyo` style. The helicopter's registration is JA26SB; taxis
come in Tokyo's dark navy, yellow, white and green, and buses in white with a red
band. The helipad in Yoyogi Park is a game device; there is no heliport there.

## 8. Sun

Tokyo protects no park's sunlight (see [Tokyo](tokyo.md#5-sun-and-the-rules)). The
places carry this project's lunch-hour window, noon to 13:00, as a thought
experiment. Miyashita Park is a roof garden on a mall; its sun is read at the
ground here, so treat it with care.

`analysis/sun_access.js` gives the mean share of each place in direct sun over the
window, December and June:

| Place | December | June | Where the shade comes from |
|---|---:|---:|---|
| Yoyogi Park | 94% | 99% | a 91 m building, the NHK Hall, Park Court Shibuya The Tower |
| Shinjuku Gyoen | 91% | 98% | the garden's own greenhouse and buildings |
| Jingu-dori Park | 77% | 100% | one 32 m building beside it |
| Miyashita Park | 81% | 88% | the hotel tower and the mall it stands on, read at the ground |
| Suga Park | 23% | 100% | two 9 m buildings |

Suga Park, a small park in the shrine's neighbourhood, is the case a rule would
be about: two buildings of 9 m put three quarters of it in shade at a winter
lunchtime, when the sun is 31° up. Their PLATEAU heights could be 9 to 10 m, and
that alone moves December between 17% and 28% (`analysis/uncertainty.js`). The
error budget (`analysis/error_budget.js`) puts the production settings within
0.4 points of a finer reference for every place but Suga Park (1.7 points, from
its size).

## 9. Limits

- The aerial photos are not true orthophotos, and the towers lean in them.
- The shrine's buildings, SHIBUYA SKY's furniture and the district pieces are
  built from published figures and photographs, not surveys. The 男坂 is the
  closest: its step count, width, length and handrails are published.
- 9.9% of the footprint area has an estimated height. Look for the green tint under
  **Height sources**.
- Shop signs and shop fronts are indicative; the screens' programmes are invented.
- The searchlights' times and movement are illustrative.

## 10. Reproducing it

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  python pipeline/fetch_overture.py --city shibuya
python pipeline/fetch_tiles.py --city shibuya
python pipeline/fetch_plateau.py --city shibuya
python pipeline/build_scene.py --city shibuya
python pipeline/landmarks.py --city shibuya       # also draws atlas.jpg (fonts are fetched to data/raw/fonts)
python pipeline/game_data.py --city shibuya
python analysis/data_quality.py --city shibuya
python analysis/dem_check.py --city shibuya
python analysis/plateau_check.py --city shibuya
node analysis/sun_access.js --city shibuya
python blender/build_scene.py --city shibuya
```

## Sources

- Suga Shrine: [the shrine](https://sugajinjya.or.jp/), its
  [amulets and ema](https://sugajinjya.or.jp/amulet/),
  [Wikipedia (ja)](https://ja.wikipedia.org/wiki/%E9%A0%88%E8%B3%80%E7%A5%9E%E7%A4%BE),
  [jinja-dego](https://jinja-dego.com/kiminonawa-sugajinja/),
  [Walkerplus](https://www.walkerplus.com/trend/matome/article/142038/),
  [jinjamemo](https://jinjamemo.com/archives/yotsuyasugajinja.html),
  [burariwalking](https://burariwalking.hatenablog.com/entry/2025/01/09/%E3%80%90%E6%9D%B1%E4%BA%AC%E9%83%BD%E6%96%B0%E5%AE%BF%E5%8C%BA_%E9%A0%88%E8%B3%80%E7%A5%9E%E7%A4%BE%E3%80%91%E6%9D%B1%E4%BA%AC%E3%83%BB%E5%9B%9B%E8%B0%B7%E7%B7%8F%E9%8E%AE%E5%AE%88%E3%81%AF),
  [Atlas Obscura](https://www.atlasobscura.com/places/suga-shrine-staircase).
- The 男坂: [Tokyo stairs database, 0008 須賀神社 男坂](https://blog.goo.ne.jp/tokyostair/e/bcf61c460347c8f4d8f87c364500b562).
- *Your Name*'s tenth anniversary: [BSC Kids](https://www.bsckids.com/2026/06/sensation-your-name-to-be-rerelased-for-10th-anniversary/).
- SHIBUYA SKY: [SHIBUYA SKY](https://www.shibuya-scramble-square.com/sky/about/?page=1),
  [Wikipedia (ja)](https://ja.wikipedia.org/wiki/SHIBUYA_SKY).
- The Docomo tower's clock and mast: [GO TOKYO](https://www.gotokyo.org/en/spot/117/index.html),
  [TV Tokyo](https://www.tv-tokyo.co.jp/adomachi/backnumber/20030201/25809.html),
  [SkyscraperPage](https://skyscraperpage.com/b3286).
- Kabukicho's arch: [Sanshin Shoji](https://san-tatsu.jp/pressrelease/462363/),
  [Wikipedia](https://www.wikiwand.com/en/articles/Kabukicho).
- The ginkgo avenue at Jingu Gaien: [Minato City](https://www.city.minato.tokyo.jp/kouhou/kuse/koho/konjaku/konjaku19.html).
- The crossing's screens and signs: [Wikipedia (ja), 渋谷スクランブル交差点](https://ja.wikipedia.org/wiki/%E6%B8%8B%E8%B0%B7%E3%82%B9%E3%82%AF%E3%83%A9%E3%83%B3%E3%83%96%E3%83%AB%E4%BA%A4%E5%B7%AE%E7%82%B9),
  the media sheets at [ooh-cmedia.com](https://www.ooh-cmedia.com/media/shibuya-synchronized-broadcast/)
  ([Q'S EYE](https://www.ooh-cmedia.com/media/qs-eye/), [Ekimae Vision](https://www.ooh-cmedia.com/media/shibuya-station-front-vision/),
  [Starts Vision](https://www.ooh-cmedia.com/media/starts-vision-shibuya/), [109 Forum Vision](https://www.ooh-cmedia.com/media/shibuya-109forum-vision/),
  [Scramble Square Vision](https://www.ooh-cmedia.com/media/shibuya-scramble-square-vision/), [Q'S WALL](https://www.ooh-cmedia.com/media/shibuya-qs-wall/),
  [Ekimae long board](https://www.ooh-cmedia.com/media/shibuya-ekimae-bldg-long-board/), [Nishimura building](https://www.ooh-cmedia.com/media/shibuya-nishimura-bld/),
  [MAGNET wall jack](https://www.ooh-cmedia.com/media/shibuya-magnet-by-shibuya109-wall-jack/)),
  [HIT: Shibuhachi Hit Vision](https://www.hit-ad.co.jp/digital-billboards/shibuyaled.html) and [Synchro7](https://www.hit-ad.co.jp/digital-billboards/synchro7_shibuya.html),
  [Shibuya Television: west exit Sky Vision](https://www.sib.tv/news/10408/), [Panasonic](https://www2.panasonic.biz/jp/solution/outside/works/ShibuyaSSVision.html),
  [traffic news, 2018](https://trafficnews.jp/post/82440), [AdverTimes](https://www.advertimes.com/?p=494293).
- The Toyoko site and Phase II: [traffic news](https://trafficnews.jp/post/548718), [traffic news](https://trafficnews.jp/post/653174);
  Seibu Shibuya's closing: [Fashionsnap](https://www.fashionsnap.com/article/2026-03-25/seibu-shibuya-close/).
- Hachiko Square: [Wikipedia (ja), 忠犬ハチ公](https://ja.wikipedia.org/wiki/%E5%BF%A0%E7%8A%AC%E3%83%8F%E3%83%81%E5%85%AC),
  [san-tatsu](https://san-tatsu.jp/collects/381997/), [SHIBU HACHI BOX](https://travel.watch.impress.co.jp/docs/news/1276219.html),
  [the Hachiko gate's move](https://tabiris.com/?p=54640), [the relief](https://www.tokyoartbeat.com/articles/-/hachiko-family-news-202501).
- CROSSING LIGHT: [enjoytokyo](https://www.enjoytokyo.jp/article/202710/), [nippon.com](https://www.nippon.com/en/articles/-/17056),
  [Impress Watch](https://www.watch.impress.co.jp/docs/news/1214693.html).
- *Persona 5*'s Tokyo and the real places: [Kotaku](https://kotaku.com/persona-5s-in-game-locations-compared-to-the-real-world-1787125885),
  [TheGamer](https://www.thegamer.com/persona-5-locations-visit-real-world-counterparts/),
  [Megami Tensei Wiki: Yongen-Jaya](https://megatenwiki.com/wiki/Yongen-Jaya),
  [rinblog: Sangenjaya](https://rinblog.org/en/p5r-seichi-sangenjaya-en/).
