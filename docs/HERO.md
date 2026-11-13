# Hero levels: a street modelled finely

Asked for in November 2026 for Tokyo's live maps: one small level per map, a street or a crossing some
200-300 m across, that reads at eye level as a photograph or a current game does, while the rest of
the map stays as it is around it. Shinjuku's is Kabukicho Ichibangai (`cities/shinjuku/hero.py`);
Shibuya's scramble and Marunouchi-Ginza's are built by their own sessions on the same kit; Kyoto's two (Yasaka-dori, the
Omotesando of Fushimi Inari) are below.

| What | Where |
|---|---|
| The loader, in every map's game | `web/game/hero.js` (`OEHero`), started by `web/game/game.js` from `game.hero` |
| The kit: geometry by material, the atlas, the bake, Blender and the export | `blender/hero_kit.py` |
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

## Kyoto: Yasaka-dori (Higashiyama) and the Omotesando (Fushimi Inari)

Two levels where their maps' games start, on a kit of Japanese traditional pieces over the same loader:
`blender/hero_wa.py` (town-house fronts, tiled roofs and eaves, lattices, noren, paper lanterns, torii, stone
lanterns, stone fences, banners), `cities/higashiyama/hero.py` and `cities/fushimi-inari/hero.py`. Their stills:
`tools/views/higashiyama-hero.json`, `tools/views/fushimi-inari-hero.json`.

### Only what a walker can see (issue 358, from first principles)

A level is looked at from its street, so the street decides what exists. `hero_wa.Site.seen` answers, offline,
whether a point can be seen from any eye point along the level's line (1.7 m over the ground, every 4 to 5 m):
a sight line is blocked by a building's solid when it passes under its top. The build asks it for every wall,
gable and roof triangle near the street:

- a wall facing the lane within 7.5 m is a full front; another wall is dressed (boards, plaster, a timber frame:
  a few quads) only if it can be seen, and not built at all otherwise. On Yasaka-dori that is 47 fronts and
  about 200 side walls of the 70 buildings' 300-odd; the backs and the walls between neighbours cost nothing;
- a roof triangle is tiled only if it can be seen, and only the eaves of those get round tiles and a gutter;
- the paving is not laid under the buildings.

Memory follows the same rule at run time. The level is fetched within 260 m and freed past 520 m (`hero.js`).
Its finest geometry (lattice bars, the eaves' round tiles, rafters: materials named `*_fine`, a third of
Yasaka-dori's triangles) is never sent to the GPU on the low tier: at a phone's resolution a 3 cm bar at 10 m is
under a pixel, and the drawn paper behind it carries the pattern. On the low tier the normal and roughness maps
are dropped and the colour maps halved (no side over 1024 on the lean sub-tier). Light after dark is in the
vertices, so a phone computes none of it.

Materials added to the loader's names: `paper*` and `lamp*` (a shoji, a lantern) show their own colour by day
and are lit as dusk falls; `*_fine` as above.

### Yasaka-dori

The lane from Higashioji-dori up to the Yasaka Pagoda (Hokan-ji), 170 m, 4.5 to 6.5 m between its fronts,
rising 9 m: the game starts at its foot, and the pagoda at the end of the stone lane is Kyoto's most
photographed street view. Sannenzaka and Ninenzaka were the other candidates: they begin 250 m from the start,
out of its sight, and their flights of steps need the surface model changed.

On each front the city's solids give: a stone footing, posts and beams a bay (about 1.9 m) apart, and bay by bay
a lattice over lit paper, a sliding lattice door under a noren, a shop's window onto its shelves, or plaster
over a boarded foot, some behind the curved bamboo guard (inuyarai); the tiled pent roof with its rafters and
round eave tiles; on two-storey houses plaster above with a slit window (mushiko-mado) or a lattice window,
some with a bamboo blind; a carved name board, an andon or a round paper lantern at the door, a copper rain
pipe. The side walls a walker sees are charred boards under plaster in a timber frame; the roofs are the
buildings' own roof meshes again in tile. The lane is granite setts wall to wall with manholes; at the doors,
tea-house benches under red parasols and red fire buckets. The city's older dressing of the lane (its setts,
flat lattices, noren and lanterns) is in meshes of its own (`yhero_*`) and hidden while the level is shown.
The lane's line is OpenStreetMap's, moved to the middle of the gap between the mapped fronts (it hugs the
south row); no generated street lamp stands on it (`night.clear`).

Facts used: the lane east of Higashioji-dori is narrow, one-way and stone-paved, climbing gently east
([Wikipedia](https://ja.wikipedia.org/wiki/八坂通)); its wires run under the eaves, with no poles on the lane
(Kyoto City's pole-removal plan shows Yasaka-dori as the example of eaves wiring,
[plan](https://www.city.kyoto.lg.jp/kensetu/cmsfiles/contents/0000250/250605/keikaku.pdf)), so none is built;
the district is the Sanneizaka preservation district, whose plan asks for gabled roofs in Japanese tile, tiled
pent roofs, lime plaster or Kyoto earthen walls, cedar boards at the ground floor, projecting or flat lattices,
sliding lattice doors, and timber in bengara or bare
([Kyoto City](https://www.city.kyoto.lg.jp/tokei/page/0000281761.html)); the pagoda is five storeys of three
bays, 6.4 m square at its foot, rebuilt in 1440, its height published as anything from 36.4 m to 46 m
([National Diet Library](https://crd.ndl.go.jp/reference/entry/index.php?page=ref_view&id=1000061716)).

Not checked, and invented: which house has which bays, the shops' names and noren (Kyoto's trades, not the real
tenants), the benches and buckets (placed by a seeded draw), the stone's colour and bond, the houses' heights
(PLATEAU's and estimates, some taller than the two storeys that stand there), and the pagoda itself, which
stays the city's landmark model.

### The Omotesando of Fushimi Inari Taisha

From the first great torii by JR Inari station to the Romon gate's steps, 140 m rising 7 m, with the second
torii and the gate on one straight line behind the first. The Senbon Torii are the shrine's most photographed
place, but they stand 350 m further in, behind the halls, out of sight of the start; the game now starts under
the first torii, which frames the whole approach.

Built: the two torii on OpenStreetMap's gate lines (vermilion posts with black feet and ring caps, tie beam
and wedges, the lintels curving up to their ends under a black top, a plaque; floodlights at their feet, baked);
stone flags 9 m wide between kerb stones, gravel either side; stone lanterns in pairs every 12 m, lit after
dark; stone fences on the lines OpenStreetMap maps as fences and walls, with donors' names on their pillars;
the shrine's name pillar by the first torii; offering banners. The city's own torii and the approach's paving
are hidden while the level is shown (`inari_otorii_*`, `shero_*`).

Facts used: first torii, second torii, Romon and the halls stand on one line
([Wikipedia](https://ja.wikipedia.org/wiki/伏見稲荷大社)); the torii are reinforced concrete, dedicated in 1972
(the first) and 1960 (the second), of the Inari kind (ring caps under the lintel, black feet, a black top), on
no base stones; the Romon is of 1589, its steps of 1694; the buildings that stood either side of the approach
were taken down in 2020 and 2024, which is why its sides are open
([the shrine](https://inari.jp/trip/map01/), Wikipedia).

Not found, and estimated: the torii's heights and spans (from OpenStreetMap's widths, 11.5 m and 11 m, and one
guide's 9 m), the plaque's wording, the lanterns' number and spacing, the banners, the name pillar's size, the
paving's stone and pattern.

### Research for these two

| Work | What it published | Taken |
|---|---|---|
| *Ghost of Tsushima* (Sucker Punch; J. Patry, SIGGRAPH 2021, [slides](https://advances.realtimerendering.com/s2021/jpatry_advances2021/index.html)) | Stylised realism carried by light and atmosphere; indirect light from probes for a changing hour | Light first: paper and lanterns that come on at dusk, their light baked into the lane |
| *Assassin's Creed Shadows* (Ubisoft, [Inside Anvil](https://news.ubisoft.com/en-us/article/6u0kflsdY20YlnZks7rUeG/inside-anvil-the-technology-powering-assassins-creed-shadows)) | Kyoto at micropolygon detail with ray-traced light, on hardware a browser does not have | The opposite budget: real geometry only where the eye resolves it (bars, eave tiles near the walker), drawn surfaces elsewhere, nothing for what is hidden |
| *Sekiro* (FromSoftware, [CEDEC+KYUSHU 2021](https://www.siliconera.com/sekiro-environments-were-designed-to-reflect-culture/)) | Places dressed so they read as lived in; landmarks framed from where the player stands | The start moved so the first frame is the level's landmark down its axis; doors dressed with what people use |

Textures added, all CC0 1.0 from ambientCG at 1K: `PavingStones128` (setts), `PavingStones077` (flags),
`Gravel023`, `Concrete036` (weathered stone), `RoofingTiles013A` (the nearest to fired grey tile: ambientCG has
no true kawara), `Planks023A` (boards, tinted dark), `PaintedWood009C` (tinted vermilion), `Bamboo001C`. The
shop names, noren, lantern papers and boards are drawn in Python with Shippori Mincho (SIL OFL, `pipeline/adkit.py`).

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
