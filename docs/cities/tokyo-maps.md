# Tokyo as maps

Tokyo is one destination on the globe with several maps, each a walkable district of its own
built from open data under the real sun. The title screen draws them as a subway map; choosing a
station goes into that district.

| Map | id | Districts on the subway map | Landmarks built in code |
|---|---|---|---|
| Marunouchi & Ginza 丸の内・銀座 | `tokyo` | Marunouchi, Ginza | Tokyo Tower |
| Shibuya & Shinjuku 渋谷・新宿 | `shibuya` | Shibuya, Harajuku, Shinjuku, Sangen-jaya | Suga Shrine's stairs, SHIBUYA SKY, the scramble |
| Asakusa 浅草 | `asakusa` | Asakusa, Oshiage · Skytree | Senso-ji (Kaminarimon, Hozomon, pagoda, main hall), Tokyo Skytree, the Asahi flame |
| Akihabara 秋葉原 | `akihabara` | Akihabara | Electric Town's signs and prints, Kanda Myojin's Zuishinmon, Nikolai-do's dome |

Next in line, grey on the map: Ueno, Ikebukuro, Jinbocho, Roppongi, Tsukishima, Odaiba,
Shinagawa.

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
Yurakucho and Hibiya lines and the Yurikamome, in their own colours; station positions are the
stations' own (OpenStreetMap), rounded.

`pipeline/build_scene.py` copies the group onto each member in `web/data/cities.json`
(`group_meta`). `web/title.js` draws the map in the destination card (`metroHTML`); a station
with a map shows Play and Explore, and Play opens `#play-<map>@<travel id>`, which the router in
`web/index.html` passes to the game (`window.OE_ARRIVE`) to start at that travel point. In the
game's menu, the other maps of the group are listed to go on to.

Any group can be drawn this way by giving it `"kind": "metro"`.
