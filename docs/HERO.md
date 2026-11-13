# Hero levels: a street modelled finely

Asked for in November 2026 for Tokyo's live maps: one small level per map, a street or a crossing some
200-300 m across, that reads at eye level as a photograph or a current game does, while the rest of
the map stays as it is around it. Shinjuku's is Kabukicho Ichibangai (`cities/shinjuku/hero.py`);
Shibuya's scramble and Marunouchi-Ginza's are built by their own sessions on the same kit. Kamakura's is
the hill road above the Kamakurakokomae crossing (`cities/kamakura/hero.py`), the first by a map's spawn;
Tetsugaku's is the head of the Philosopher's Path (`cities/tetsugaku/hero.py`).

| What | Where |
|---|---|
| The loader, in every map's game | `web/game/hero.js` (`OEHero`), started by `web/game/game.js` from `game.hero` |
| The kit: geometry by material, the atlas, the bake, Blender and the export | `blender/hero_kit.py` |
| Parts for a level in the open: ground draped on the terrain, retaining walls, hedges and shrubs, utility poles and wires, signs | `blender/hero_parts.py` |
| The build | `python blender/build_hero.py --city <id>` (needs `pip install bpy==5.2.3` and Node) |
| A map's level | `cities/<id>/hero.py` (`build(kit)` returns geometry, atlas, materials and its centre) |
| Its place in the game | `cities/<id>/city.json` `game.hero` (copied into `game.json` by `pipeline/game_text.py`) |
| Its stills | `tools/views/<id>-hero.json`, taken with `tools/scramble_shot.js` (which waits for a hero level to load) |
| Its check | `tools/game_check.js`: walked up to, it loads and shows and hides what it replaces; left, it is let go |

## How it works

**Drawn over the city, not instead of it.** A hero level's fronts stand a few centimetres in front of the
city's own walls (the shop fronts 0.5 m, the floors above 0.22 m), and its paving 4 cm over the ground,
so the city's buildings, ground, collision and surface model need no change, and the level can come and
go. Its glass and its recesses lie between its face and the city's wall. What the city draws that the
level draws again finely (Kabukicho's tenant stacks and fascias on Ichibangai) is built into landmark
meshes of their own (`kbhero_*`, `cities/shinjuku/kabukicho.py` `in_hero`) and hidden while the level is
shown (`game.hero[].hide`).

**Streamed.** It is fetched when the camera comes within 260 m of its edge, shown within 420 m, and let go
(geometry and textures freed) past 520 m. On the low tier (phones) every texture is halved before it is
sent to the GPU, a quarter of the memory, and on a phone's lean sub-tier no side is over 1024; it is resized by
`createImageBitmap`, not through a full-size canvas. Its shaders are compiled and its textures sent in idle time
before it is first shown (`world.js` `upload`, `compile`), so it does not stall a frame.

**Light baked into the vertices.** After dark a street like Ichibangai is lit by its signs and shop
fronts, not by its lamps. Each lit face (a sign's panel, a fascia, a shop's glass, a vending machine,
a lantern) is a set of small area lights a metre apart, in the mean colour of what is drawn on it; every
vertex of the level sums them (the cosine at the light and at the vertex over the square of the
distance, `hero_kit.bake`), and the corners' occlusion from the walls is added, into its `_BAKE`
attribute. `hero.js` adds that light in the surface's own colour after dark (`uNight`) and lets the
occlusion take the sky's light by day. The city's street lights (`world.js` `streetLit`) still reach it,
at the share `game.hero[].street` gives (Kabukicho 0.35), since its own lamps are baked. No lightmap
texture, no second UV set, and nothing for a phone to compute.

**Materials by name** (Blender's, kept in the glTF): `glow*` lit signs (their emissive at
`game.hero[].glow`: by day and by night), `tube*` neon tubes (which stutter now and then), `win*`
windows (dark glass by day, rooms lit after dark), `ground*` what you walk on (wet in the rain; on the high
tier it takes the wet street's reflection, `mirror.js`). A material's tint (the building's colour over a
shared texture) travels in its glTF extras.

**Textures.** CC0 PBR sets from ambientCG at 1K (colour, normal, and roughness packed into glTF's
metallic-roughness image), as WebP inside the model: `PavingStones136` (Ichibangai is paved: OpenStreetMap
`surface=paving_stones`, and the ward's plans keep both streets paved), `Tiles036` (the small square
facing tiles of Japan's mixed-use buildings), `Plaster001`, `Concrete034`, `Tiles138`. Everything
drawn (sign panels with the tenants' names, shop interiors, rooms behind the windows, vending machine
fronts, menu boards, air conditioners, manhole covers, grates) is one atlas, drawn in Python with the
project's open fonts (`pipeline/adkit.py`).

## Kabukicho Ichibangai (Shinjuku)

From Yasukuni-dori's pavement through the red arch to Sakura-dori, 130 m of a street 8.1-9.4 m between
its fronts (OpenStreetMap; the arch's posts stand 8.6 m apart). Chosen over Omoide Yokocho by the west
exit: its alleys are roofed and lit from inside, and show little from the chase camera, while
Ichibangai is Kabukicho's threshold, its most photographed view, and the street the Shinjuku map's walks
already lead to. Night is its hero shot.

On each of the 34 fronts PLATEAU's solids give the street (`kabukicho.canyon_fronts`): the street floor's
shop front set back between dark tiled pilasters, glazed onto a lit interior (a ramen counter, a
drugstore's shelves, a bar, a lobby), aluminium mullions, a step, a lit fascia with the tenant's name,
and a noren, a half-drawn shutter or a menu board now and then; the floors above in tile or render in the
building's colour, windows set into them with frames and sills, rooms lit after dark, the names of bars
and karaoke rooms in the lower windows, air conditioners on brackets with their pipes, a drain pipe,
cable runs, a parapet and its coping; and the tenant stack standing out from the front, a panel a floor,
the real tenants' names where OpenStreetMap maps them, some edged in neon. On the street: paving, manholes
down its middle, grates along its kerbless edges, stains, shallow puddles, vending machines in clusters
of one to three, the lantern lamps, bins, beer crates, bicycles and cones.

Facts used (sources in the research below): Ichibangai 261 m long, paved, 8.1-9.4 m wide in its south
half and 9.5-11.4 m in its north; both streets planned as pedestrian zones with unified lamps and
continuous paving (Shinjuku City, Kabukicho design guideline); projecting signs asked to relate in colour
and light, "light overflowing" at night (Shinjuku City outdoor advertising guideline), and signs measured
above 1,000 cd/m² (J. Illum. Eng. Inst. Japan 106(1), 2022).

What could not be checked: the lamps' design on Ichibangai since the ward's renewal (the model keeps the
two-lantern post of `kabukicho.py`), the paving's colour and pattern (the texture is a grey interlocking
block), which fronts have shutters, vending machines and air conditioners where (placed by a seeded
draw, not from photographs), and the buildings' heights: about 20 of the 28 fronts stand at heights
estimated from their neighbours, not surveyed by PLATEAU.

## Only what the first frame sees (issue 358)

The levels by a map's spawn (Kamakura's first) apply issue 358's rule to detail: memory and shading go to
what the player can see, and the rest of the map pays nothing.

- **The level is the spawn's view, not a radius.** It is drawn from where the game opens: the road ahead, the
  walls and banks that face it, what stands in front of the horizon. Nothing behind the camera, behind a
  wall's face or past the first bend is modelled. Nissaka is 34,000 triangles and a 3.9 MB file.
- **Fine textures only there.** Seven 1K PBR sets and one 1K atlas exist only while the level is loaded
  (about 120 MB of GPU memory on a desktop with their mipmaps); on the low tier their normal and roughness
  maps are dropped and the colour halved (about 11 MB), and all of it is freed 520 m away (`hero.js`).
- **Light is distilled offline.** The street lights' pools on the road are in the vertices (`hero_kit.bake`):
  no light is added to the frame for them.
- **One surface, not layers.** The asphalt of the hill road and the lanes that meet it is one mesh on a 1 m
  grid cut to the roads' outline (`hero_parts.Parts.cover`), so the terrain cannot show through it and no
  pixel of road is shaded twice; markings and patches are the only overdraw.
- **Measured.** `tools/mem_check.js kamakura` (an iPhone emulated, low tier) peaks at 379 MB of GPU memory
  with the level loaded, under the 700 MB budget.

## Nissaka and the Kamakurakokomae crossing (Kamakura)

The game opens on the hill road 日坂 above the Enoden's crossing 鎌倉高校前1号踏切, looking down it to
Route 134 and the bay: the coast's most photographed 60 m, and all of it in the first frame. The spawn was
moved 15 m down the hill, to (-446.2, 153), below the fork of the upper lane, so that the first frame is
the view the photographs take. The level (`cities/kamakura/hero.py`) runs from Route 134 over the crossing
to 66 m up the hill, with 30 m of each lane that meets it and 100 m of Route 134.

Built from the set's measured profiles (`cities/kamakura/set.json`: each road's centre line every metre
on GSI's 5 m laser terrain; the buildings' outlines; the railway's line) and placed from photographs:

- the road as one asphalt surface with trench patches, sealed cracks, the white edge lines, the zebra and
  stop lines, manholes, gullies and the long grate across the east lane's mouth; the crossing's yellow
  non-slip deck with a green strip on the west for people on foot, and the rails' flangeways;
- east: the dark rubble retaining wall under the house at the corner (battered, to the platform at 13.35 m:
  the building's base in the data is 13.0 m), a band of blocks and a glass balustrade with planting on it,
  the tan stone garage at its upper end with its shutter to the lane; a low wall and a green bank above;
- west: a raised pavement on a kerb, a split-face block wall with a clipped hedge and a timber rail, two
  notice boards (a map and a manners board, both drawn here with our own wording), the convex mirror on its
  orange post, bollards;
- overhead: six concrete utility poles with crossarms, insulators, two transformers and three LED street
  lights (baked), their wires, and the thick bundle that sags across the road above the crossing;
- signs: the pedestrian crossing's blue pentagon, no parking, the track's "keep out" boards and pipe fences;
- Route 134 with a solid centre line (the city's own was dashed) and the promenade's paving and bollards.

The gates, lamps, bell, track bed, catenary and trains stay the railway's (`web/game/rail.js`); the level
hides the set's own deck, paint, mirror and warning sign while it is shown.

Photographs looked at (Wikimedia Commons; none is reproduced, and no texture is taken from one):

| File | Author | Licence | Used for |
|---|---|---|---|
| 鎌倉高校前1号踏切20190626-P1030450.jpg | くろふね | CC BY 4.0 | the classic view: both sides' walls, the mirror, the boards, the deck's colours, the wires |
| 鎌倉高校前1号踏切.jpg | サイエンス | CC BY-SA 4.0 | the deck, the fences and boards by the track, the grate, the rubble wall's batter |
| Kamakura koukou mae Fumikiri - 02.jpg | Quercus acuta | CC0 | from further up: the bank, the lane's mouth, the poles' places |
| Kamakura High School Front Level Crossing (53150242045).jpg | Dick Thomas Johnson | CC BY 2.0 | the pavement, the kerb, the block wall, the mirror's post, the glass balustrade |

Textures: ambientCG (CC0 1.0) `Bricks089` (rubble), `Bricks066` (blocks), `Tiles143` (the garage's stone),
`Grass004` (its roughness raised: scanned at 0.26, it shone like plastic), `Asphalt031`, `Concrete034`; and a
leaf texture drawn in `hero_parts.leaf_texture` for the hedges and shrubs (no CC0 hedge was found there).

Not as it is, or not checked: the heights of the walls come from the terrain behind them, not a survey; the
garage's size, the boards' wording and the poles' exact places are read off photographs; the house behind
the wall is the city's plain solid; the hedges are clipped volumes, not leaves; the notice boards are our
own drawing, not the real ones; the terrain's fold where the upper lane forks is the 5 m grid's.

## The head of the Philosopher's Path (Tetsugaku)

哲学の道 begins at Ginkakuji-bashi, where the Lake Biwa Canal's branch (疏水分線) turns south along the foot
of the hills. The view from the bridge down its first hundred metres is the photograph everyone takes of
the path. The game opened 75 m to the west, on the road, with its back to the canal; it now opens on the
path's first slabs at (282.3, 1015.3), looking down it, and Haruka, who greets you, stands there too. The
level (`cities/tetsugaku/hero.py`) is the 115 m from the bridge past the second bridge to the third.

Built on the canal's own banks (`scene.json` `inland`: the channel's outline with each bank's and the
water's height, from OpenStreetMap's line and GSI's laser terrain) and placed from photographs:

- the canal's walls: random rubble, battered, dark and wet at the waterline and green above, under a granite
  edging (drawn in front of the plain walls `web/inland.js` gives every channel);
- the path on the west bank: moss at the wall's top, compacted earth, the two rows of granite slabs (458
  stones, each of its own length, the rows out of step), a verge of moss and litter, azaleas, timber posts
  with a rope, three granite benches, the black litter bins, a walkers' board, four vending machines (lit
  after dark, baked), and at the bridge the boulder and the timber post with the path's name;
- the east bank: a mossy verge with shrubs, the lane's asphalt, three utility poles with street lights;
- a granite balustrade on each bridge's edges over the water.

**No railing.** Every walled channel was given a steel railing along its walls. The path has none
(OpenStreetMap maps ropes and hedges there, `barrier=rope`, and no photograph shows one), so a channel can
now go without: `water.inland.lines[].rail: false` in `city.json`, carried by `pipeline/inland_water.py`
into `scene.json` and read by `web/inland.js`, which also leaves the generic railing off a bridge over
such a channel. It is off for the whole 疏水分線, not only inside the level.

Photographs looked at (Wikimedia Commons; none is reproduced):

| File | Author | Licence | Used for |
|---|---|---|---|
| Philosopher’s Walk and Biwako Canal from Ginkakujibashi Bridge.JPG | そらみみ | CC BY-SA 3.0 | the view itself: walls, the hedge at the wall's top, slabs, the boulder and post, posts and rope |
| Ginkakujibashi Bridge from Philosopher’s Walk.JPG | そらみみ | CC BY-SA 3.0 | the bridge's balustrade and its wing wall |
| Tetsugaku-no-michi - Philosopher's Walk - Kyoto.jpg | Gzzz | CC BY 4.0 | the slabs' sizes and two rows, the earth, the moss on the edging, posts and rope |

Textures (ambientCG, CC0 1.0): `Bricks089` (the walls, tinted green), `Granite001A` (slabs, edging,
balustrades, benches), `Ground069` (the earth), `Moss001` and `Ground068` (their gloss taken off), `Asphalt031`.

Not as it is, or not checked: the houses and shops along the path are the city's plain solids (the timber
shop fronts of the photographs are not modelled); the cherries are the city's trees, in the season's
colours; the canal's width and the banks' heights are the map's (3.5 m; 1.0 m down to the water); the slabs'
sizes are drawn from a range, not surveyed; the bridges' balustrades are one design for all three, taken
from Ginkakuji-bashi's; the vending machines' and benches' places are OpenStreetMap's to within a few metres.

## Research: how the games build a street like this, and what runs in a browser

Learned from, never copied (no look, asset or layout of theirs is used):

| Work | What it does at street level | Adopted here |
|---|---|---|
| *Like a Dragon* / *Yakuza*, Kamurocho (Ryu Ga Gotoku Studio; Dragon Engine) | Kabukicho itself, reduced to a few blocks; reusable pieces built round the multi-tenant *zakkyo* building, one tenant a floor; an engine made "for a nighttime mecca", its lighting set per time of day after measuring Kabukicho's lamps ([80.lv](https://80.lv/articles/like-a-dragon-devs-on-the-effective-reuse-of-kamuroch-map-assets), [Automaton](https://automaton-media.com/en/news/like-a-dragon-graphics-switch-to-the-dragon-engine-was-a-big-part-of-the-series-graphical-evolution-devs-say/)) | A front made of the same few parts (shop front, floors, stack) varied per building; a small, dense level rather than a large thin one; light set by the hour |
| *Ghostwire: Tokyo* (Tango Gameworks, UE 4.27) | City blocks as level units with merged materials and batch-built LODs; landmarks by hand; rain's wetness as global material parameters; ray-traced reflections, with screen-space ones smearing on wet streets ([4Gamer, CEDEC 2022](https://www.4gamer.net/games/514/G051472/20220607065/), [Unreal Engine](https://www.unrealengine.com/developer-interviews/ghostwire-taps-into-the-charm-of-tokyo-to-deliver-a-compelling-experience)) | One model per level, merged by material (40 draw calls for the street); wetness from the weather's global state (`weather.js`); planar rather than screen-space reflection for a flat street (`mirror.js`) |
| *Cyberpunk 2077* (CD Projekt Red) | Buildings and adverts placed by hand; decals over low texture density; props of known size to set the scale; colours grouped so the eye can rest ([80.lv](https://80.lv/articles/interview-how-cyberpunk-2077-s-night-city-was-built-almost-entirely-by-hand/)) | Stains, manholes and grates as decals over the paving; vending machines, crates, bicycles and cones at their real sizes; the signs' colours by trade, not at random |
| *Marvel's Spider-Man* and *Spider-Man 2* (Insomniac) | Buildings from shared kits; windows widely thought to be interior-mapped in the first, real interiors ray-traced in the second ([GDC](https://gdcvault.com/play/1026495), [Game Developer](https://gamedeveloper.com/programming/interior-mapping-rendering-real-rooms-without-geometry)) | Windows show rooms (a drawn room per window from a set of 16, lit or dark); parallax interior mapping is the next step (Marunouchi's session builds it for all three levels) |
| UE5 *City Sample* (Epic) | Shape-grammar buildings from modular kits (corner, wall, entrance modules), street decals and props as meshes, light from sun, sky and emissive surfaces ([Epic](https://dev.epicgames.com/documentation/unreal-engine/city-sample-project-unreal-engine-demonstration)) | The front as a grammar (street floor, floors, parapet, stack); emissive surfaces as the night's light, baked |

In a browser (three.js r186, `WebGLRenderer`):

| Technique | Licence | Here |
|---|---|---|
| Baked light: three.js `lightMap`, or bakers such as pmndrs/react-three-lightmap | MIT | Baked offline into vertex attributes instead: no second UV set or texture, and smooth for light that changes over metres |
| CC0 PBR textures: ambientCG, Poly Haven | CC0 1.0 | Adopted (ambientCG, 1K, WebP) |
| `KTX2Loader` with Basis Universal (GPU-compressed textures) | MIT, Apache-2.0 | Not yet: the transcoder and an encoder are not in the repository; halving on the low tier stands in. The first thing to add for phones' memory |
| Interior mapping (van Dongen 2008; mohsenheydari/three-interior-mapping, three-fenestra) | technique free; MIT | Next, shared (Marunouchi's session) |
| `DecalGeometry` | MIT | Not needed: the level's decals lie on its own flat paving |
| `Reflector`-style planar reflection | MIT | Already the game's (`mirror.js`); the level's paving takes it |
| `SSRPass`, SSR/SSGI nodes | MIT | Not adopted: desktop-only, or WebGPU-only |
| `UnrealBloomPass` | MIT | The game's own bloom: the lit signs bloom at night |
| `LightProbe` | MIT | Not needed: the bake carries the street's own light |
