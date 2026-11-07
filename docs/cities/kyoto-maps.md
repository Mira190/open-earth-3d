# Kyoto as maps

Kyoto is one destination on the globe with four maps, each a walkable district of the city built
from open data under the real sun, as Tokyo is ([Tokyo as maps](tokyo-maps.md)). The title screen,
the game (the Districts button, B) and the 3D model's district bar draw them as one railway map
(`web/metro.js`, `groups.Kyoto` in `cities/index.json` with `kind: "metro"`); choosing a station goes
into that district, at its own travel point.

A map is a district of Kyoto, never a city of its own: the centre's map is called Central Kyoto 洛中
(it was called "Kyoto", which read as if it were the whole city and as if Kiyomizu-dera were missing
from it), and every page names a map as its district and its city: "Higashiyama, Kyoto, Japan" on
the game's title card, "Higashiyama, Kyoto" in the tab and on photos (`CITY.place`, `web/world.js`).
Tokyo's maps follow the same rule: Marunouchi & Ginza, Shibuya and Shinjuku are districts of Tokyo.

| Map | id | Ward | Stations on the railway map (travel point) |
|---|---|---|---|
| Central Kyoto 洛中 | `kyoto` | Shimogyo, Nakagyo, Kamigyo | Kyoto Station (the start), Higashi Honganji (`k-honganji`), Shijo · Nishiki Market (`k-nishiki`), Nijo Castle (`k-nijo`), Imperial Palace (`k-gosho`) |
| Higashiyama 東山 | `higashiyama` | Higashiyama | Yasaka Pagoda (the start), Gion · Yasaka Shrine (`h-yasaka`), Ninenzaka · Sannenzaka (`h-ninenzaka`; Sannenzaka has `h-sannenzaka` on the game's map), Kiyomizu-dera (`h-kiyomizu`) |
| Fushimi Inari 伏見稲荷 | `fushimi-inari` | Fushimi | Fushimi Inari Taisha (the start, JR Inari), Yotsutsuji · Mount Inari (`f-yotsutsuji`); the Romon and the Senbon Torii are on the game's map |
| Philosopher's Path 哲学の道 | `tetsugaku` | Sakyo | Ginkaku-ji (the start), the Philosopher's Path (`t-path`), Nanzen-ji (`t-nanzenji`); Eikan-do and the Keage Incline are on the game's map |

The lines are the JR Nara Line, the Keihan Main Line, the Karasuma and Tozai subway lines and Kyoto
City Bus route 100 (Kyoto Station, Gojozaka for Kiyomizu, Gion, Okazaki, Ginkakuji-michi), drawn from
their stations' positions; the colours tell the lines apart and are not the operators' own.

Each map's travel points are in `game.travel` of its `cities/<id>/city.json`, on a footway of the
map, and `python pipeline/game_sync.py <id>` copies them, set on the built terrain, into
`web/data/<id>/game.json` without the raw downloads that `pipeline/game_data.py` needs (then
`python pipeline/pack.py`). Each is marked `check`, so `tools/game_check.js` travels to it and checks
that it lands on walkable ground.
