# The Philosopher's Path: the canal walk from Ginkaku-ji to Nanzen-ji

A Kyoto map of its own (#164), next to [Kyoto](kyoto.md), [Higashiyama](higashiyama.md) and
[Fushimi Inari](fushimi-inari.md). It covers about 135.784–135.800 E and 35.006–35.030 N (1.4 × 2.6 km):
the Philosopher's Path (哲学の道) along the Lake Biwa Canal's branch from Ginkaku-ji past Honen-in,
Otoyo-jinja, Nyakuoji and Eikan-do, Nanzen-ji with its Sanmon and the brick aqueduct, and the Keage
Incline.

**Why a map of its own** (recorded in [higashiyama.md](higashiyama.md)): growing Higashiyama to reach the
path would have taken it from about 3.3 to 11.6 km², and every visit to Kiyomizu-dera would have loaded
three times the buildings and ground. A district of its own loads only for those who choose it. The
cost is one more game check on the runs that shared code needs.

## Data

| | |
|---|---|
| Buildings | 10,204 (Overture footprints; 93.7% of the footprint area at a PLATEAU-measured height) |
| Heights and roofs | Project PLATEAU Kyoto City 2022 (MLIT, CC BY 4.0), LOD1 heights and LOD2 roof shapes |
| Terrain | GSI DEM5A, 5 m bare earth from airborne laser survey (GSI terms of use, compatible with CC BY 4.0) |
| Imagery | GSI seamless aerial photographs, zoom 18 |
| Fine detail | OpenStreetMap (ODbL), `cities/tetsugaku/north_osm.json` and `south_osm.json` (`pipeline/osm_detail.py`): the path's named ways, the aqueduct (w190871337), the Sanmon (w190876301), the Keage Incline (w378872665, w378872666), the Kannon-den (銀閣) |
| Far land | Copernicus DEM GLO-30 and ESA WorldCover past the frame (`pipeline/far_land.py`) |

## What is built in code (`cities/tetsugaku/city.py`)

- **The path's cherries**: a cherry every 4 to 5 m along both banks of the path where OpenStreetMap names
  it, as photographs show them: a single row on each side of the canal and the walk, kept a road's half
  width off the streets the path runs beside (242 trees; `landmarks.json` "trees"). The cherries were first planted in 1922 by the painter Hashimoto Kansetsu and his
  wife (関雪桜). A tree area 7 m either side of the path (`trees.areas` "Philosopher's Path cherries")
  makes them, and the trees mapped there, Somei-yoshino with a few maples. They flower with Kyoto's
  cherries (from 26 March). The path is not lit after dark, so they have no yozakura lighting; Maruyama
  Park in Higashiyama has it. Temple areas give Ginkaku-ji, Honen-in, Eikan-do (its maples) and Nanzen-ji
  their own mixes, outlined from OpenStreetMap (`pipeline/tree_areas.py`).
- **Nanzen-ji's Sanmon (三門, 1628)**: five bays and three doors, two storeys, about 22 m high (the temple),
  on its mapped outline: the lower storey's posts, brackets and pent roof of tiles; the upper storey with
  its balcony and railing (where Goemon looks out in the kabuki play), white walls and lattice doors, and
  its hipped-and-gabled roof.
- **The aqueduct (水路閣, 1888)**: red brick on granite springers, a row of round arches along the mapped
  line, about 9 m high, the canal's channel on top behind a granite coping.
- **The Keage Incline (1891–1948)**: its two rails on sleepers down the mapped lines, 2.5 m apart, and a
  boat (三十石舟) on its cradle halfway down.
- **Ginkaku (the Kannon-den, 1489)**: the lower storey in the shoin manner, the upper a Zen hall with its
  bell-shaped windows, under a shingle roof with the bronze phoenix.

## The game: The Philosopher's Path on Foot

From the bridge below Ginkaku-ji, a student starts you south along the canal to a retired canal keeper
near Nyakuoji, who sends you on to a photographer at the Keage Incline.

## What is approximate

- The cherries' spacing is read from photographs; the trees are not surveyed one by one, and the path's
  southern stretch, which OpenStreetMap does not name, has only the trees the data maps there.
- The Sanmon's width and depth come from its mapped outline (traced at the eaves); its storey heights
  are proportions of the published 22 m.
- The aqueduct's arch count is its mapped length over a 4.5 m span read from photographs; its 9 m height is
  the figure usually quoted.
- The Kannon-den's height (10.5 m) is an estimate from photographs.
- Not checked on: a real GPU, WebGPU, Safari or iOS.

## Stills

Desktop (1440×900) and phone (390×844), day, dusk and night (`tools/views/tetsugaku-164.json`).

![The path in early April, along the canal and from above](../images/tetsugaku/path.jpg)
![Nanzen-ji's Sanmon and the aqueduct](../images/tetsugaku/nanzenji.jpg)
![The Keage Incline and Ginkaku](../images/tetsugaku/incline-ginkaku.jpg)
![On a phone](../images/tetsugaku/phone.jpg)
