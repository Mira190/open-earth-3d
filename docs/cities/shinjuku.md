# Shinjuku: the stairs of Your Name, Kabukicho and the east exit

A map of Tokyo ([Tokyo as maps](tokyo-maps.md)): Shinjuku from Tokyo Opera City and Nishi-Shinjuku's
towers to Yotsuya, and from Jingu Gaien and Aoyama-itchome in the south to Kabukicho in the north,
with Shinjuku Gyoen, 2-chome and Golden Gai between. It is the real city first: Overture's footprints
at the heights Project PLATEAU surveyed, on GSI's laser-scanned bare earth, under the real sun. On top
of that sit the places a film and a game made famous, ten years on: Suga Shrine's 男坂 in Yotsuya is the
staircase on the poster of *Your Name* (君の名は。, 2016), and Kabukicho and 2-chome are streets
*Persona 5* (2016) drew. Every number comes from the scripts in `pipeline/` and `analysis/` run with
`--city shinjuku`; outputs are in `cities/shinjuku/analysis/`.

Until November 2026 this was the north half of one map with Shibuya; it was split in two
([Tokyo as maps](tokyo-maps.md)). The two maps share one frame, so `cities/shibuya/city.py` builds
the landmarks of both (`cities/shinjuku/city.py` loads it with `CITY = "shinjuku"`), and the pictures
taken before the split are still in `docs/images/shibuya/`.

| The 男坂 at dusk, rendered in Cycles (`blender/build_scene.py`) | Kabukicho's arch at night, in Cycles |
|---|---|
| ![](../images/shibuya/cycles-suga-stairs.jpg) | ![](../images/shibuya/cycles-kabukicho.jpg) |
| **The 男坂 from the lane at its foot, late afternoon** | **Halfway up: red rails on both sides and down the middle** |
| ![](../images/shibuya/suga-stairs.jpg) | ![](../images/shibuya/suga-stairs-mid.jpg) |
| **The approach: the great torii, the banners, Mr Sato** | **The hall** |
| ![](../images/shibuya/suga-approach.jpg) | ![](../images/shibuya/suga-hall.jpg) |
| **Reading an ema of 2026, under Yotsuya-sanchome's station sign** | **The precinct from the air** |
| ![](../images/shibuya/game-ema.jpg) | ![](../images/shibuya/suga-aerial.jpg) |
| **Kabukicho's arch** | **Overheard at the foot of the stairs** |
| ![](../images/shibuya/kabukicho-night.jpg) | ![](../images/shibuya/game-stairs-talk.jpg) |

## 1. The short answer

- **Scope.** 4.5 × 3.07 km (`extent_m` −1200 to 3300 east, 230 to 3300 north of the shared origin at
  139.6965 E, 35.6685 N): 26,697 buildings in 29,016 solids, 901 of them PLATEAU buildings that
  Overture does not have.
- **Heights.** 84.5% of the footprint area stands at a PLATEAU surveyed height, 3.1% at an
  OpenStreetMap height, 1.5% at a floor count and 10.9% at an estimate from the neighbours (cross-
  validated median error factor 1.22). 17 buildings that OpenStreetMap maps much taller than the survey
  keep the mapped height: they were built since (the Tokyu Kabukicho Tower among them).
- **Terrain.** GSI's 5 m airborne-laser DEM. Against GSI's elevation service at 521 points it agrees to
  a median of −0.01 m, and 98.7% within a metre. AWS's Terrarium tiles read 7.4 m too high at the
  median, because they are a surface model.
- **Suga Shrine.** The 男坂's 52 steps in three flights, with landings and red iron handrails, set into
  the slope; the 女坂; the hall, the great torii, the temizuya, lanterns, komainu, the Tenpaku Inari and
  about 400 ema of 2026 on the rack. Section 3.
- **Shinjuku.** Kabukicho Ichibangai's red arch (1969); the screens over the east exit, Cross Shinjuku
  Vision's bend and its cat, and Unica Vision (section 4); the Docomo tower's clock (15 m across,
  150 m up) and mast to 272 m; shop signs in Kabukicho, Golden Gai and 2-chome; utility poles and their
  wires in the lanes round the shrine.
- **Game.** *Tokyo Pilgrimage: Shinjuku*: a welcome at the east exit, then three walks in any order.
  Section 5.

## 2. Sources

| Layer | Source | Licence |
|---|---|---|
| Building heights, massing | Project PLATEAU Tokyo 23 wards LOD2 (MLIT), read as the vector tiles published by indigo-lab | CC BY 4.0 (PLATEAU), MIT (tiles) |
| Footprints, names, roads, steps, water, parks | Overture Maps, release 2026-10-21.0 (OpenStreetMap) | ODbL |
| Points in the shrine precinct | OpenStreetMap nodes (the temizuya, the fire brigade's mound, the subsidiary shrines) | ODbL |
| Terrain | GSI DEM5A, 5 m airborne laser survey, bare earth (10 m DEM where 5A has no data) | GSI terms of use |
| Aerial photos | GSI seamless photos, zoom 17 | GSI terms of use |
| Lettering on ema, plaques and signs | Google Fonts (see [Shibuya](shibuya.md#2-sources)) | SIL Open Font License |

The terrain is cut where the stairs are set into the slope (`adjust_terrain`): the terrain under each
tread is lowered by the least change to the grid that clears it, and each grid point moves in proportion
to how far it stands above the treads, so the hillside beside the stairs takes the cut and the lane at the
foot barely moves. The checks compare the uncut DEM.

## 3. Suga Shrine and the 男坂

### 3.1 The stairs

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

### 3.2 The precinct

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

### 3.3 The ema of 2026

The rack carries about 400 ema, two-sided pentagons. The front is the shrine's own
design, the 男坂 painted in colour; the back is a wish, in Japanese, Chinese,
Korean, English, Spanish and French, many for the film's tenth anniversary
(26 August 2026). The wishes were written for this model: no official
anniversary ema had been announced when it was built, and none is a quotation from
the film. There is no character art. The doodles are comets, braided cords and
stairs. In the game, <kbd>E</kbd> at the rack reads one at random, with an English
gloss.

## 4. Shinjuku's east exit after dark

The same kit (`pipeline/screens.py`, `pipeline/adkit.py`) lights the plaza at Shinjuku's east
exit, the Shinjuku map's busiest corner. Its screens have a sheet of their own (`screens_east.jpg`,
2048 × 1024, six clips) and a material of their own (`screens_east`).

| Screen | Where | Size | Source |
|---|---|---|---|
| Cross Shinjuku Vision | the roof of the Cross Shinjuku building (新宿3-23-18, OpenStreetMap w153133263), bent round its corner over the plaza | 18.96 × 8.16 m, 154.71 m², 6 mm pitch | [AV Watch](https://av.watch.impress.co.jp/docs/news/1337489.html), [DIME](https://dime.jp/genre/1179382/) |
| Unica Vision, three screens | the rounded front of the Shinjuku Unica building (新宿3-23-7) towards Yasukuni-dori and Seibu-Shinjuku station | 13.12 × 7.38 m each, 10 mm pitch since November 2024; 7:00-1:00 | Unica and Sekishin media sheets, [DreamNews](https://www.dreamnews.jp/press/0000240807/) |

- **The bend.** Cross Shinjuku Vision is one screen bent round a corner, built as a strip along
  its foot line with the corner rounded (`path`, `round`): about 7.4 m on the face to the south
  and 11.6 m on the face to the east, its picture running across the bend.
- **Pictures drawn for the bend.** The screen is known for pictures that seem to stand out of it
  from the plaza, above all a giant calico cat (Cross Space, 2021). That production is the
  operator's and is not copied; the screen plays a giant calico cat of our own drawing in the same
  manner (`k_cat_a`, `k_cat_b`): it lies in a room whose back wall stands behind the bend, so the
  bend reads as the room's front corner, looks round at the plaza with its paws over the edge, then
  leans out over the corner with a meow and reaches for the plaza with a paw. Then a goldfish tank
  with a fish swimming out over its corner, and a wave breaking over it. Between them the screen
  plays the same invented music and film adverts as Shibuya's.
- **Unica Vision's three screens** play together (one phase), and their light stays on past
  midnight: `web/night.js` takes a screen's hours across midnight (7:00-1:00).

What could not be checked: the height of the Cross Shinjuku building (16.9 m in OpenStreetMap,
which also gives it 11 floors, so it is probably taller: the screen stands on the 16.9 m roof,
in front of its western neighbour's wall, and the 新宿オカダヤ building to the east hides the far
end of the bend from some of the plaza); how long each leg of the bend is; how the Unica screens are spaced round their front and
how high up it they are (estimated from photographs).

## 5. Tokyo Pilgrimage: Shinjuku

Nao, a pilgrimage guide (Aoi's colleague in Shibuya), meets you at the east exit, under the corner
screen; then three lines run side by side, and a report back waits for all of them:

| Line | Who | What you do |
|---|---|---|
| Welcome | Nao at the east exit | Stand under the cat on the corner screen, meet Officer Ono at the Kabukicho koban |
| Shinjuku | Mika, a bartender in 2-chome; Officer Ono at the koban | See Kabukicho's arch after dark |
| Your Name | Xiaoyu, a pilgrim from Shanghai; Mr Sato, a Yotsuya resident | Climb the 男坂, read an ema, stand at the foot of the stairs (a choice sets the clock to dusk) |
| Aoyama | Rin, a high-school student | Walk the ginkgo avenue at Jingu Gaien |

Eight areas put up their station signs as you walk in: Shinjuku, Shinjuku-sanchome, Tochomae,
Shinjuku-gyoemmae, Yotsuya-sanchome, Yoyogi, Shinanomachi and Aoyama-itchome. The helipad on Shinjuku
Gyoen's lawn is a game device; there is no heliport there. Travel points: the east exit, Tochomae, Suga
Shrine and the foot of the 男坂, Kabukicho and Aoyama-itchome; `#play-shinjuku@t-suga` starts at the
shrine. The people are original characters. None stands for a real shop's staff.

## 6. Sun

Tokyo protects no park's sunlight (see [Tokyo](tokyo.md#5-sun-and-the-rules)). The places carry this
project's lunch-hour window, noon to 13:00, as a thought experiment. `analysis/sun_access.js` gives the
mean share of each place in direct sun over the window, December and June:

| Place | December | June |
|---|---:|---:|
| Shinjuku Gyoen | 91% | 98% |
| Suga Park | 24% | 100% |

Suga Park, a small park in the shrine's neighbourhood, is the case a rule would be about: two buildings
of 9 m put three quarters of it in shade at a winter lunchtime, when the sun is 31° up.

## 7. Limits

- The aerial photos are not true orthophotos, and the towers lean in them.
- The shrine's buildings and the district pieces are built from published figures and photographs, not
  surveys. The 男坂 is the closest: its step count, width, length and handrails are published.
- 10.9% of the footprint area has an estimated height. Look for the green tint under **Height sources**.
- Shop signs and shop fronts are indicative; the screens' programmes are invented.

## 8. Reproducing it

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  python pipeline/fetch_overture.py --city shinjuku
python pipeline/fetch_tiles.py --city shinjuku
python pipeline/fetch_plateau.py --city shinjuku
python pipeline/build_scene.py --city shinjuku
python pipeline/landmarks.py --city shinjuku      # the landmark code is cities/shibuya/city.py
python pipeline/game_data.py --city shinjuku
python pipeline/night_lights.py --city shinjuku   # after game_data.py: it reads game.json
python analysis/data_quality.py --city shinjuku
python analysis/dem_check.py --city shinjuku
node analysis/sun_access.js --city shinjuku
node analysis/uncertainty.js --city shinjuku 40
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
- The Docomo tower's clock and mast: [GO TOKYO](https://www.gotokyo.org/en/spot/117/index.html),
  [TV Tokyo](https://www.tv-tokyo.co.jp/adomachi/backnumber/20030201/25809.html),
  [SkyscraperPage](https://skyscraperpage.com/b3286).
- Kabukicho's arch: [Sanshin Shoji](https://san-tatsu.jp/pressrelease/462363/),
  [Wikipedia](https://www.wikiwand.com/en/articles/Kabukicho).
- The ginkgo avenue at Jingu Gaien: [Minato City](https://www.city.minato.tokyo.jp/kouhou/kuse/koho/konjaku/konjaku19.html).
