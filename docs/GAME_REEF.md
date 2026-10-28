# The reef game

The game layer of the reef viewer (`web/reef/game.js`, `web/reef/game/`). You meet people at real
places, ask them things, take on small quests, board the boats and aircraft, and travel between the
Queensland reef sites. It follows the Sydney game's rule: everything a character says about the place is
computed from the model while you play, or carries a source you can open from the dialogue and the journal.

| Kim, the ranger, on Whitehaven Beach | Mia at Hill Inlet Lookout: the inlet at this tide |
|---|---|
| ![](images/reef/game-dialogue.jpg) | ![](images/reef/game-lookout.jpg) |
| **8 m down with Raf: the slate works out where the red went** | **The map: the site at this tide, people, objective, reef sites** |
| ![](images/reef/game-dive.jpg) | ![](images/reef/game-map.jpg) |

## Playing

| Keys | What they do |
|---|---|
| <kbd>E</kbd> | Talk, read a sign, board a boat, fly the helicopter or the amphibian, log an animal for the survey; on a line, go on |
| <kbd>1</kbd>–<kbd>4</kbd> · <kbd>Enter</kbd> · <kbd>Esc</kbd> | Answer · go on · close |
| <kbd>J</kbd> | Journal: quests, the survey log, field notes with their sources |
| <kbd>T</kbd> | Map: the site drawn from the model at the current tide, the reef sites, named places near you |
| <kbd>F</kbd> | Step off a boat or out of a landed aircraft (the boats' own key) |

The player's own keys are unchanged (WASD, Shift, Space, Ctrl/C, V, F/G, Q, B, H, M). On a phone, the
Journal and Map buttons sit under the clock, you tap a line to go on and tap an answer. The tracked step
shows top left (below the dive gauge when you are diving) with a marker on the compass and a diamond over
the target. Progress is saved in the browser per site (`localStorage` key `oe3d-reef-game-<site>`).

## The Whitsundays

| Who | Where (POI) | What |
|---|---|---|
| Kim, ranger | Whitehaven Beach, by the spawn | the silica sand, whose Country it is, stingers, the reef's health, the survey, where to go |
| Jo, day-boat skipper | South Whitehaven Beach | boat runs (Hill Inlet Lookout, the dive boat, Chance Bay, back up the beach), the islands, a scenic flight |
| Mia, guide | Hill Inlet Lookout | the inlet's sand and water at this tide and at the next turn of the tide |
| Raf, dive instructor | on a catamaran anchored off South Whitehaven | down to 8 m to see where the red went; the spawning-night snorkel |
| Signs | the three lookouts on Whitsunday Island with Ngaro names, and Hill Inlet Lookout | the name as mapped, the height in the model, what is in sight over the terrain |

Quests:

1. **Whitehaven sand.** Walk 200 m of the beach, then tell Kim. She explains the silica.
2. **Hill Inlet from above.** Get up to the lookout (Jo can drop you on the beach below it), hear Mia, and
   look out over the inlet.
3. **Fish ID survey.** With a mask on, get within a few metres of up to five species and log them (E). It
   needs `ctx.life`; without it the quest shows as unavailable.
4. **Where did the red go?** Raf kits you up, waits at 8 m, and writes the light left at your depth on a
   slate. Then come up slowly.
5. **Scenic flight.** Take the helicopter (Whitehaven helipad) or the amphibian, fly over Hill Inlet above
   100 m and along Whitehaven, land and step out.
6. **Lookouts with Ngaro names.** Read the three signs.
7. **Stinger suit** (October to May). Suit up at the dive kit. Kim also calls out if you head into the
   water without one.
8. **Spawning night** (only when `ctx.life.spawning.active`). Raf gives the night's sunset and moonrise;
   you can skip ahead to after dark (the page reloads with `?time=`, so the sun, moon, tide and clock
   agree), then snorkel over reef habitat for 20 s.

A site without its own file gets `game/generic.js`: a ranger at the spawn who knows the model (size,
share of sea, depth, height), the reef's health facts, Surf Life Saving Queensland's stinger advice if the
site is north of Bustard Heads, the survey, and the map.

## Where every fact comes from

Cited pages were fetched and read on 2026-10-28; a line says only what its page says.

| Line | Source |
|---|---|
| Whitehaven: seven kilometres; 98% pure silica; holds less heat, comfortable barefoot; no silica in local rocks, thought to be carried by currents over millions of years; fine enough to damage phones and cameras; named in 1879 by Staff Commander E. P. Bedwell after Whitehaven in Cumberland | [Wikipedia: Whitehaven Beach](https://en.wikipedia.org/wiki/Whitehaven_Beach) |
| Ngaro and Gia peoples, the Traditional Owners, also called canoe people; 74 continental islands; Cook sailed through on Sunday 3 June 1770 and named Whitsundays' Passage | [Wikipedia: Whitsunday Islands](https://en.wikipedia.org/wiki/Whitsunday_Islands) |
| Marine stingers in the islands' waters October to May | [Wikipedia: Whitsunday Islands National Park](https://en.wikipedia.org/wiki/Whitsunday_Islands_National_Park) |
| Full-body stinger suit in the ocean in the season; box jellyfish and irukandji; November to May from Bustard Heads north (generic sites) | [Surf Life Saving Queensland, 31 Oct 2023](https://lifesaving.com.au/news/swimmers-urged-to-take-advice-during-marine-stinger-season) |
| Mass bleaching 1998, 2002, 2006, 2016, 2017, 2020, March 2022; 2,900 reefs, 900 islands, 2,300 km, 400 coral species, 1,500+ fish species; fringing reefs on high islands; inner reefs spawn the week after the October full moon | [Wikipedia: Great Barrier Reef](https://en.wikipedia.org/wiki/Great_Barrier_Reef) |
| 2024: bleaching on 73% of surveyed reefs, the fifth widespread event since 2016 | [CSIRO, Reef Snapshot, 17 Apr 2024](https://www.csiro.au/en/news/All/News/2024/April/Reef-snapshot-details-widespread-coral-bleaching-on-the-Great-Barrier-Reef) |
| Spawning in the evening or at night, cued by the dark between sunset and moonrise | [Wikipedia: Coral](https://en.wikipedia.org/wiki/Coral) |
| Water absorbs red first | [Wikipedia: Color of water](https://en.wikipedia.org/wiki/Color_of_water) |
| Tide height, rising or falling, next high or low | [Maritime Safety Queensland, Shute Harbour predictions (CC BY 4.0)](https://www.data.qld.gov.au/dataset/7993f06a-f666-4231-8b9e-7f36ebaadae7/resource/0cde2f64-1684-4cc1-bbde-abe97871b862), fitted in `tide.json`; Shute Harbour is 25 km west, so times differ by minutes |

Computed while you play (shown as "computed: …"):

- **Light at depth** (Raf's slate): the share of red, green and blue left at your depth is
  `exp(-K · depth · lightPath)` with `K = env.u.K` (the per-band attenuation fitted to the Sentinel-2
  imagery, red floored at pure water's absorption; `cities/<site>/analysis/optics.json`) and
  `lightPath = env.u.lightPath` (the sun's slant under water after Snell's law). That is the light term of
  `env.js medium()`, the one the renderer uses. At 8 m with a high sun: about 4% red, 52% green, 65% blue;
  red halves every 1.7 m. A torch 1 m away crosses 2 m of water: `exp(-2 K_red)`, 45% of its red.
- **Hill Inlet**: the cells of the 30 m survey grid within 900 m of the inlet between −2.5 and +2.5 m,
  and the share of them below the tide now and at the next high or low water.
- **Places**: distances and bearings between OpenStreetMap POIs (scene.json) and you; heights of lookouts
  from the terrain; "in sight" is a line-of-sight test over the terrain grid.
- **Sun and moon**: `sun.js` for sunset; moonrise from the same moon the viewer draws (env.js setSun).
- **Wind** from the wave bank (boats.js), **water temperature** from the dive computer (dive.js).
- **The site**: size, share of sea, deepest and highest point from the terrain grid (generic ranger).

The Ngaro and Gia content is only what the pages above say plus the lookout names as mapped. The
Queensland Parks and Wildlife Service pages on the Ngaro Sea Trail could not be fetched from the sandbox
(HTTP 403), so nothing from them is used. No character speaks as or for Traditional Owners.

## Boarding and travel

- Within about 3 m of a boardable hull (tinnie, yacht, catamaran, day boat, the amphibian, the parked
  helicopter), standing, wading or swimming at the surface: **E: board …** or **E: fly …**. Moving boats
  (over 1.5 m/s) and the scenic aircraft on their loops are not offered. Raf's dive boat stays at anchor.
- **F** steps off (boats.js decides when that is allowed in the air). You land beside the hull: in the
  water if it is deep enough, on the ground if it is walkable, otherwise on the nearest beach.
- **T** lists every `data/cities.json` entry whose `viewer` is `reef/index.html`; a site is offered as
  soon as its `data/<id>/scene.json` exists. Travel reloads with `?city=<id>`, keeps settings (`gl`, `exp`,
  `mute`, `wind`, `time`, …) and drops positions and test keys.
- Flying the helicopter or the amphibian to within 700 m of the model's edge offers the nearest other
  ready site ahead of you (or says none is built yet).

## For developers

- Content: `game/<site>.js` exports `default (G) => ({ sources, npcs, quests, signs, start })`. NPCs are
  placed by POI through `G.landSpot` (dry at high water with `msl: true`, near water with `wet`); a quest
  step has `text`, `target`, and completes by `check`, `on: { board | leave | talk | sign | species }` or
  `talkTo: <npc>` (which opens that person's dialogue at `node`).
- `G` (also `window.__game.G`) has the helpers: `poi`, `where`, `light`, `tideTurns`, `sunset`,
  `moonrise`, `lineOfSight`, `start/advance/complete`, `note`, `transfer`, `skipTo`.
- `?gametest=1` runs a scripted test (59 checks on the Whitsundays with `lifestub=1`, 56 without `ctx.life`, 30 with
  `gamesite=generic`) and sets `window.__gametest`; `?gameshot=dialogue|journal|map|lookout|red|board`
  sets up the screenshots; `?lifestub=1` installs `game/life_stub.js`; `?gamereset=1` forgets progress.

```bash
cd web && python3 -m http.server 8813 &
PORT=8813 NODE_PATH=$(npm root -g) node tools/page_eval.js "reef/index.html?still=1&gl=1&gametest=1&lifestub=1&mute=1" "window.__gametest.fail"
PORT=8813 NODE_PATH=$(npm root -g) node tools/reef_shot.js "still=1&gl=1&gameshot=dialogue&mute=1&time=2026-10-28T05:30:00Z" out.png 1500 0
```
