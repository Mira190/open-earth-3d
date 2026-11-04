# Higashiyama: Kiyomizu-dera and the stone lanes

A map of Kyoto's Higashiyama, 1.8 × 1.8 km from Gojo-dori to Yasaka Shrine: Kiyomizu-dera on its
hillside, the preserved lanes of Sannenzaka (産寧坂) and Ninenzaka (二寧坂), and the Yasaka Pagoda. It
is one of the Kyoto maps (`cities/index.json`, group Kyoto) beside [Central Kyoto](kyoto.md) and
[Fushimi Inari](fushimi-inari.md). The figures and their sources are in [kyoto-sights.md](kyoto-sights.md).

## Data

| | |
|---|---|
| Buildings | 7,090 (Overture footprints; 94.6% of the footprint area at a PLATEAU-measured height) |
| Heights and roofs | Project PLATEAU Kyoto City 2022 (MLIT, CC BY 4.0), LOD1 heights and LOD2 roof shapes |
| Terrain | GSI DEM5A, 5 m bare earth from airborne laser survey; the lanes climb about 60 m to the temple |
| Imagery | GSI seamless aerial photographs, zoom 18 |
| Fine detail | OpenStreetMap (ODbL) round the temple and the lanes, `cities/higashiyama/kiyomizu_osm.json` (`pipeline/osm_detail.py`) |

The machiya rules of the Kyoto map (`architecture_overrides`: two-storey wooden fronts, few signs)
apply here too.

## What is built in code (`cities/higashiyama/city.py`, `pipeline/kyotokit.py`)

Each building stands on the footprint OpenStreetMap maps for it, facing the way it faces; its PLATEAU
block is hidden from the renderers and kept in the surface model.

- **The Main Hall (本堂, 1633)**: about 36 m across and 31 m deep, about 18 m high (National Diet
  Library; the temple). The floor is set level with the hillside behind the hall, from the laser terrain.
  The body sits under a hipped roof of hinoki bark, with the wing corridors running forward either side
  of the stage under their own gabled roofs.
- **The Stage (舞台)**: about 200 m² of hinoki boards (the temple), on the mapped outline. Below it
  stands a lattice of keyaki pillars on stone footings, tied by through-beams (懸造) every 2.4 m in both
  directions, from the slope up to the floor. The model's pillars stand on a regular 3.2–3.8 m grid
  wherever the ground is more than 1.2 m below the floor. The temple counts 18 pillars under the stage;
  the grid is close to that, not a survey of where each one stands.
- **Vermilion buildings**: the Deva Gate (仁王門, two storeys, about 10 × 5 m, 14 m high), the West
  Gate, the Three-storey Pagoda (about 31 m), the Bell Tower, the Sutra Hall, the Founder's Hall and the
  Todoroki Gate. The Koyasu Pagoda, about 15 m, stands across the valley.
- **Bare timber buildings**: the Okunoin, with its own small stage facing the Main Hall, and the
  Asakura-do, Shaka-do and Amida-do.
- **The Otowa Falls**: three streams from the rock under a timber roof, at the OSM node 音羽の滝 不動明王.
- **The Yasaka Pagoda (八坂の塔, 1440)**: five storeys, 46 m, bare timber and white plaster under tiles.
- **Yasaka Koshin-do (八坂庚申堂)**: strings of kukurizaru, cloth monkeys bound hand and foot, on frames
  at its gate on Yasaka-dori (at the OSM node 庚申堂). The frames' size and the colours are read from photographs.
- **The lanes**: stone setts along OpenStreetMap's lines for 産寧坂, 二寧坂, 一念坂, 清水坂 and 八坂通,
  and stone steps on the mapped flights of steps. Every low building whose front faces a lane gets:
  - a lattice (格子) over the ground floor;
  - a noren in the doorway, with words drawn in open fonts (清水焼, 八ツ橋, 七味, 抹茶...);
  - a paper lantern at every other door, lit after dark.

  The words on the noren are typical of the street, not the real shops' names.

## The game: Higashiyama on Foot

- **The route**: it starts on Higashioji-dori at the foot of Yasaka-dori, looking up the street to the
  pagoda (the lane itself is too narrow to park the player's car in), and climbs Ninenzaka and Sannenzaka to a
  Kiyomizu-yaki potter, then Kiyomizu-zaka to a monk at the Deva Gate.
- **Koshin-do**: the first quest stops at the kukurizaru, where *Crimson School Trip* (2018) puts Shinichi
  and Ran with the pagoda behind them.
- **The Conan quest**: Mika, a Detective Conan fan on her pilgrimage, sends you to three spots:
  - **the Stage**, walkable as a strip at the floor's height;
  - **the Okunoin's stage**, the view from which the whole Main Hall is photographed;
  - **the Otowa Falls**.
- **Conan in Kyoto**: Kiyomizu-dera is in *Crossroad in the Ancient Capital* (2003). In *Crimson School
  Trip* (2018), Shinichi and Ran are photographed with the stage behind them. The game names these
  places and copies nothing of the films' art.

## Reference games: what was taken and what was not

*Assassin's Creed Shadows* (2025), *Like a Dragon: Ishin!* (2023) and *Onimusha: Way of the Sword*
(2026) all build Kiyomizu-dera ([kyoto-sights.md](kyoto-sights.md#6-kyoto-in-video-games-what-to-learn-not-copy)).
Taken as ideas only, in this project's own look:

- Landmarks as compass points, visible from the lanes.
- Detail spent in the first 3 m of the shop fronts.
- Lanterns at dusk.

Not taken: any of their art, models or layouts. Their shortened climbs are not taken either: here the
climb is the real one.

## What is approximate

- The stage's pillar positions follow a regular grid, not a survey.
- The roofs' curves are the shared temple roof profile, not measured.
- The Okunoin's stage is sized from its footprint.
- The Yasaka Pagoda's first-storey width is an estimate from its 13.5 m footprint, which is traced at
  the eaves.
- Jishu-jinja is under restoration until about 2027–28 and is left as PLATEAU's blocks.
- Trees come from the canopy model. The shared trees have no cedar or cypress, so the hillside woods
  stand in as elms and plane trees, with maples red from mid November.
- Not checked on: a real GPU, WebGPU, Safari or iOS.
