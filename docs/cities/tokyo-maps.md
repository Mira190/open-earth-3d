# Tokyo as maps

Tokyo is one destination on the globe with several maps, each a walkable district of its own
built from open data under the real sun. The title screen draws them as a subway map; choosing a
station goes into that district.

| Map | id | Districts on the subway map | Landmarks built in code |
|---|---|---|---|
| Marunouchi & Ginza 丸の内・銀座 | `tokyo` | Marunouchi, Ginza | Tokyo Tower |
| Shibuya 渋谷 | `shibuya` | Shibuya, Harajuku, Sangenjaya | SHIBUYA SKY, the scramble and Hachiko, Center Gai's arch, Yoyogi's gymnasiums |
| Shinjuku 新宿 | `shinjuku` | Shinjuku, Yotsuya | Suga Shrine's stairs, Kabukicho's arch, the east exit's screens, the Docomo tower's clock |
| Asakusa 浅草 | `asakusa` | Asakusa, Oshiage · Skytree | Senso-ji (Kaminarimon, Hozomon, pagoda, main hall), Tokyo Skytree, the Asahi flame |
| Akihabara 秋葉原 | `akihabara` | Akihabara | Electric Town's signs and prints, Kanda Myojin's Zuishinmon, Nikolai-do's dome |
| Ueno 上野 | `ueno` | Ueno | Shinobazu Pond's water and lotus, Bentendo, Toshogu's Konjiki-den, Kan'ei-ji's pagoda, Saigo's statue, Ameyoko's signs and gate |
| Ikebukuro 池袋 | `ikebukuro` | Ikebukuro | Sunshine 60-dori's and Otome Road's signs, the stores' roof names, GLOBAL RING |
| Jinbocho 神保町 | `jinbocho` | Jinbocho | The book town's signs and carts, the Catholic Kanda Church, Nikolai-do (shared with Akihabara) |
| Roppongi 六本木 | `roppongi` | Roppongi | Maman, the Mohri Garden's pond, the National Art Center's glass wave, Keyakizaka's lights, the crossing's signs |
| Tsukishima 月島 | `tsukishima` | Tsukishima | Monja Street's signs and gate, the river's bridges, Kachidoki Bridge, Tsukuda Kobashi and Sumiyoshi Shrine's torii |
| Odaiba お台場 | `odaiba` | Odaiba | The Rainbow Bridge and its approach, Fuji TV's sphere, the Statue of Liberty, the Yurikamome's guideway |
| Shinagawa 品川 | `shinagawa` | Shinagawa | Takanawa Gateway Station's roof, Shinagawa-shuku's signs and lanterns |

Shibuya and Shinjuku were one map, 5.4 × 6.2 km from Sangenjaya to Yotsuya, until they were split
in two by the rule above (issue #85). Shibuya runs 4.45 × 4.0 km from Sangenjaya to Harajuku and
Meiji Jingu; Shinjuku 4.5 × 3.07 km from Tokyo Opera City to Yotsuya and from Jingu Gaien and
Aoyama-itchome to Kabukicho. They overlap by about 0.7 km over Meiji Jingu's woods and Yoyogi Park's
north end, so the boundary falls in the trees rather than through a street. Both keep the one map's
frame (the same origin; each map's extent is its own), so a coordinate means the same place in both,
the landmarks are built by one file (`cities/shibuya/city.py`, loaded by `cities/shinjuku/city.py`),
and the game's points kept their ids. An old link to a point that moved, `#play-shibuya@t-suga`,
opens `#play-shinjuku@t-suga` (`moved` in `cities/index.json`, read by the router in
`web/index.html`), and a saved game whose position is no longer in its map starts at the map's start.

Every district on the subway map now has its map.

The district maps after the first four share their parts in `pipeline/districtkit.py` (ponds above
the sea, a pagoda, a bronze figure, stone lanterns, an octagonal hall, a street's gate) on top of
`pipeline/japankit.py`. A map whose ponds stand above the sea (Ueno's Shinobazu) draws them at
their own level and gives them to the game as water through a `game_ponds` hook in its `city.py`.
A map on the water (Tsukishima, Odaiba) builds the bridges OpenStreetMap maps over it
(`districtkit.water_bridges`): from a bridge's outline, or from its centre lines joined by name, a
girder deck that is the game's road (`game_surfaces`). The maps built before them (Asakusa's Sumida
bridges, Marunouchi's moats) do not draw their bridges yet.

## How games draw Tokyo, and what was taken from them

Surveyed before building (design only; no assets, art or names were taken):

- **Persona 5** (Atlus, 2016; Royal 2019). Tokyo is a set of small, dense district maps
  (Shibuya, Shinjuku, Akihabara, Asakusa, Ueno, Ikebukuro, Odaiba, Jinbocho, Kanda, Tsukishima,
  Kichijoji…), each reached from a stylised subway map; more districts open as the story goes
  on. Adopted: the subway map as the way in, districts as separate maps, districts still to come
  shown greyed on the map, station signs when you enter an area (`game.areas`).
- **Yakuza / Like a Dragon** (Sega): one district rebuilt very densely (Kamurocho is Kabukicho)
  rather than a whole city thinly. Adopted: a map is a district small enough to dress street by
  street (Akihabara is 1.8 × 1.5 km).
- **Ghostwire: Tokyo** (Tango Gameworks, 2022) and **The World Ends with You** (Square Enix,
  2007): Shibuya's real street plan as the level, with the place names kept. Adopted: real names
  on the signs, the real plan from OpenStreetMap.

## The subway map

`cities/index.json` `groups.Tokyo` holds the districts (`name`, `native`, `lat`, `lon`, `map`: the
map that holds it, `travel`: a travel point in that map's game to start at, `note` for one not
built) and the lines (`colour`, `stops` as `[lat, lon]`, `loop`). Stations and lines are drawn at
their real positions (an equirectangular projection at Tokyo's latitude), with the built maps'
extents shaded behind them. The lines are JR's Yamanote Line and Tokyo Metro's Ginza, Hanzomon,
Yurakucho, Hibiya and Marunouchi lines and the Yurikamome, in their own colours; station positions are the
stations' own (OpenStreetMap), rounded.

`pipeline/build_scene.py` copies the group onto each member in `web/data/cities.json`
(`group_meta`). `web/title.js` draws the map in the destination card (`metroHTML`); a station
with a map shows Play and Explore, and Play opens `#play-<map>@<travel id>`, which the router in
`web/index.html` passes to the game (`window.OE_ARRIVE`) to start at that travel point. In the
game's menu, the other maps of the group are listed to go on to.

Any group can be drawn this way by giving it `"kind": "metro"`.
