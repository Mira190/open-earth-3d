# Hero levels: a street modelled finely

Asked for in November 2026 for Tokyo's live maps: one small level per map, a street or a crossing some
200-300 m across, that reads at eye level as a photograph or a current game does, while the rest of
the map stays as it is around it. Shinjuku's is Kabukicho Ichibangai (`cities/shinjuku/hero.py`);
Shibuya's scramble is built by its own session on the same kit; Marunouchi-Ginza's (Tokyo Station) is drawn as
landmark meshes, below. Sydney's is Circular Quay West, where its game starts (`cities/sydney/hero.py`), and
Queenstown's the Skyline deck on Bob's Peak (`cities/queenstown/hero.py`): stone, timber and a water's edge
rather than a street of signs.

| What | Where |
|---|---|
| The loader, in every map's game | `web/game/hero.js` (`OEHero`), started by `web/game/game.js` from `game.hero` |
| The kit: geometry by material, the atlas, the bake, Blender and the export | `blender/hero_kit.py` |
| Parts: paving laid on the game's ground, a wall's frame with openings, windows, lamp posts, benches, bollards | `blender/hero_parts.py` |
| The measured things under a level: OpenStreetMap's map of its rectangle, in local metres | `python pipeline/hero_osm.py --city <id> --box x0 y0 x1 y1` -> `cities/<id>/hero_osm.json` |
| The ground a level is laid on: the game's own walking surface, sampled | `node tools/ground_probe.js <id> x0 y0 x1 y1 > cities/<id>/hero_ground.json` |
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

**What cannot be seen costs nothing** (issue 358, from first principles). A level is paid for in four
currencies: bytes fetched, memory held, triangles drawn and pixels shaded. Each is spent only where the eye is:

| Cost | What decides it | How the level spends it |
|---|---|---|
| Fetched and held at all | how far the level is | nothing within 260 m: nothing fetched; past 520 m: everything freed |
| The finest geometry (glazing bars, a railing's rails, bench arms, joints) | whether it covers a pixel | a second model, `<id>_fine.glb` (`Geo.fine`, plain materials only, so no texture is held twice): fetched only when the camera is inside the level, each 22 m square of it drawn only within `fine_m` (70 m) of the camera, and never fetched on the low tier |
| Triangles and draws behind you | the view | the level is cut into squares (`meta["cell"]`, one mesh per material and square), so three.js's frustum test leaves out what is off screen; at Sydney's start about half the level |
| Texture memory | the screen's pixels, not the texture's | a material carries only the maps that show (`maps`: `"c"`, `"cn"`, `"cnr"`): bark, grass and distant render have no roughness map; on the low tier no normal or roughness maps at all and every colour map halved, on a phone's lean sub-tier no side over 1024 |
| Light after dark | nothing per frame | baked into the vertices, below: no light is evaluated at run time |

Measured on Sydney's level (`tools/mem_check.js`, the phone tier): see the numbers in its section below.

**Light baked into the vertices.** After dark a street like Ichibangai is lit by its signs and shop
fronts, not by its lamps. Each lit face (a sign's panel, a fascia, a shop's glass, a vending machine,
a lantern) is a set of small area lights a metre apart, in the mean colour of what is drawn on it; every
vertex of the level sums them (the cosine at the light and at the vertex over the square of the
distance, `hero_kit.bake`), and the corners' occlusion from the walls is added, into its `_BAKE`
attribute. `hero.js` adds that light in the surface's own colour after dark (`uNight`) and lets the
occlusion take the sky's light by day. The city's street lights (`world.js` `streetLit`) still reach it,
at the share `game.hero[].street` gives (Kabukicho 0.35), since its own lamps are baked. No lightmap
texture, no second UV set, and nothing for a phone to compute.

**Materials by name** (Blender's, kept in the glTF): `win*` windows (the rooms' light is turned up with the
night; a `tint` darkens the glass by day), `glow*` lit signs (their emissive at
`game.hero[].glow`: by day and by night), `tube*` neon tubes (which stutter now and then), `win*`
windows (dark glass by day, rooms lit after dark), `ground*` what you walk on (wet in the rain; on the high
tier it takes the wet street's reflection, `mirror.js`). A material's tint (the building's colour over a
shared texture) travels in its glTF extras.

**Textures.** CC0 PBR sets from ambientCG at 1K (colour, normal, and roughness packed into glTF's
metallic-roughness image), as WebP inside the model: `PavingStones136` (Ichibangai is paved: OpenStreetMap
`surface=paving_stones`, and the ward's plans keep both streets paved), `Tiles036` (the small square
facing tiles of Japan's mixed-use buildings), `Plaster001`, `Concrete034`, `Tiles138`; and for stone, timber and a water's edge `Bricks066` (smooth coursed ashlar),
`Bricks083` (squared rubble), `PavingStones125A` (sawn granite planks), `PavingStones131` (setts), `Grass004`,
`Planks040` (grooved deck boards), `Granite005A`, `Travertine009` (sawn bedded stone), `Rock051` (schist) and
`Bark014`. A grey texture is brought to a stone's colour by a tint computed from its mean
(`hero_kit.tint_to(key, sRGB)`), so one ashlar serves Sydney's sandstone and a bluestone alike. Everything
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

## Circular Quay West (Sydney)

From First Fleet Park's edge to the taxi rank under the Overseas Passenger Terminal: 135 m of the quay in
front of the Museum of Contemporary Art, where the Sydney map's game starts (the start was moved 15 m, from
the lawn's path down onto the promenade, so that the first frame looks along it to the harbour). Chosen over
George Street in The Rocks, 100 m west: the quay is what the start already faces, it holds the map's two
most photographed things in one view (the museum's sandstone front and the Opera House across the cove), and
its ground, edge and furniture are all in the open, where a level's detail shows.

What is measured, and from where:

| Thing | Source |
|---|---|
| The museum's outline, its end pavilions (9.3 m forward, 14 m wide), the tower's face (13.2 m, 1.6 m proud), the lawn, the retaining wall's line, every tree, bench, bollard, cover and artwork, the eight Writers Walk plaques here by name | OpenStreetMap (`cities/sydney/hero_osm.json`, ODbL) |
| The ground: the lawn at 3.9-4.0 m, the promenade at 2.5 m, the slope between | the game's own surface (`hero_ground.json`: NSW Spatial Services' 5 m elevation, softened, the quay raised to its wall) |
| The quay's edge | the game's shore raster (`shore.png`), smoothed to the wall's line |
| The front's composition and heights: three bays to a pavilion and four to a wing, paired windows, a 4.3 m storey, pavilions 23 m, wings 26 m, the tower 35 m (the same as the map's own figure), the glass floor on the roof | photographs on Wikimedia Commons: "Museum of Contemporary Art Australia, Sydney, 2023" (CC BY-SA 4.0), "The Museum of Contemporary Art, Sydney (former MSB Building)" (CC BY-SA 4.0), "(1)Museum of Contemporary Art-3" (CC BY-SA 3.0); looked at, not copied into the model |

The city's model has the museum as four plain blocks without its end pavilions or the Mordant Wing; the
level builds both as its own shells (they have no collision: issue 426), and skins the rest 0.45 m in
front of the city's walls. The entrance hall behind the Mordant Wing's glass is a room in geometry (floor,
back wall hung with canvases, a ceiling of light), so that it shifts as you walk past, which a picture of a
room does not. The two rows of palms along the lawn's wall are the map's own trees (an area in `city.json`
`trees.areas` makes them palms where they were jacarandas), so that they move in the wind and are not drawn twice.

After dark: the lamp posts' luminaires, the up-lights along the museum's foot, the hall's ceiling and the
steel ovoid's holes are the bake's lights; a fifth of the windows are lit.

What could not be checked: the lamp posts' and benches' design (Sydney's quay posts are drawn as a tapered
dark post with two outreach luminaires and a banner pair; the banners' and pylons' graphics are this
project's), the paving's bond and colour (a grey sawn granite with darker bands), the height of the lawn's
wall (the game's softened ground makes the 1.5 m drop a 7% ramp, so the wall is drawn as a 0.45 m seat wall),
the Mordant Wing's exact massing (boxes after photographs), the ovoid's dimensions, whether the quay's edge
here has a rail (OpenStreetMap maps fences only at the wharves: none is drawn), and the palms' species (the
shared palm is a date palm; the real ones are slender fan palms).

## Research: how the games build a street like this, and what runs in a browser

Learned from, never copied (no look, asset or layout of theirs is used):

| Work | What it does at street level | Adopted here |
|---|---|---|
| *Like a Dragon* / *Yakuza*, Kamurocho (Ryu Ga Gotoku Studio; Dragon Engine) | Kabukicho itself, reduced to a few blocks; reusable pieces built round the multi-tenant *zakkyo* building, one tenant a floor; an engine made "for a nighttime mecca", its lighting set per time of day after measuring Kabukicho's lamps ([80.lv](https://80.lv/articles/like-a-dragon-devs-on-the-effective-reuse-of-kamuroch-map-assets), [Automaton](https://automaton-media.com/en/news/like-a-dragon-graphics-switch-to-the-dragon-engine-was-a-big-part-of-the-series-graphical-evolution-devs-say/)) | A front made of the same few parts (shop front, floors, stack) varied per building; a small, dense level rather than a large thin one; light set by the hour |
| *Ghostwire: Tokyo* (Tango Gameworks, UE 4.27) | City blocks as level units with merged materials and batch-built LODs; landmarks by hand; rain's wetness as global material parameters; ray-traced reflections, with screen-space ones smearing on wet streets ([4Gamer, CEDEC 2022](https://www.4gamer.net/games/514/G051472/20220607065/), [Unreal Engine](https://www.unrealengine.com/developer-interviews/ghostwire-taps-into-the-charm-of-tokyo-to-deliver-a-compelling-experience)) | One model per level, merged by material (40 draw calls for the street); wetness from the weather's global state (`weather.js`); planar rather than screen-space reflection for a flat street (`mirror.js`) |
| *Cyberpunk 2077* (CD Projekt Red) | Buildings and adverts placed by hand; decals over low texture density; props of known size to set the scale; colours grouped so the eye can rest ([80.lv](https://80.lv/articles/interview-how-cyberpunk-2077-s-night-city-was-built-almost-entirely-by-hand/)) | Stains, manholes and grates as decals over the paving; vending machines, crates, bicycles and cones at their real sizes; the signs' colours by trade, not at random |
| *Marvel's Spider-Man* and *Spider-Man 2* (Insomniac) | Buildings from shared kits; windows widely thought to be interior-mapped in the first, real interiors ray-traced in the second ([GDC](https://gdcvault.com/play/1026495), [Game Developer](https://gamedeveloper.com/programming/interior-mapping-rendering-real-rooms-without-geometry)) | Windows show rooms (a drawn room per window from a set of 16, lit or dark); parallax interior mapping is now shared in `web/interior.js` |
| UE5 *City Sample* (Epic) | Shape-grammar buildings from modular kits (corner, wall, entrance modules), street decals and props as meshes, light from sun, sky and emissive surfaces ([Epic](https://dev.epicgames.com/documentation/unreal-engine/city-sample-project-unreal-engine-demonstration)) | The front as a grammar (street floor, floors, parapet, stack); emissive surfaces as the night's light, baked |

In a browser (three.js r186, `WebGLRenderer`):

| Technique | Licence | Here |
|---|---|---|
| Baked light: three.js `lightMap`, or bakers such as pmndrs/react-three-lightmap | MIT | Baked offline into vertex attributes instead: no second UV set or texture, and smooth for light that changes over metres |
| CC0 PBR textures: ambientCG, Poly Haven | CC0 1.0 | Adopted (ambientCG, 1K, WebP) |
| `KTX2Loader` with Basis Universal (GPU-compressed textures) | MIT, Apache-2.0 | Not yet: the transcoder and an encoder are not in the repository; halving on the low tier stands in. The first thing to add for phones' memory |
| Interior mapping (van Dongen 2008; mohsenheydari/three-interior-mapping, three-fenestra) | technique free; MIT | Built, shared: `web/interior.js` (the Marunouchi section below) |
| `DecalGeometry` | MIT | Not needed: the level's decals lie on its own flat paving |
| `Reflector`-style planar reflection | MIT | Already the game's (`mirror.js`); the level's paving takes it |
| `SSRPass`, SSR/SSGI nodes | MIT | Not adopted: desktop-only, or WebGPU-only |
| `UnrealBloomPass` | MIT | The game's own bloom: the lit signs bloom at night |
| `LightProbe` | MIT | Not needed: the bake carries the street's own light |

## Marunouchi: Tokyo Station, drawn as landmark meshes

A hero level is a small place, two or three hundred metres across, where a map's game starts and
where the model is built to be looked at from eye level: the landmark modelled finely against its
published dimensions and photographs, real surface materials, the street's furniture, light that
reads at day, dusk and night. The rest of the map stays as it is round it.

Marunouchi's level is the one landmark, so it is built as the map's landmark meshes
(`cities/tokyo/station.py`, `pipeline/landmarks.py`) rather than as a streamed street on the kit
above: it is always on screen from the plaza, and it takes the shared PBR surfaces (`web/pbr.js`) and
rooms behind its glass (`web/interior.js`), which the kit's `win*` materials can take too.

### Why Tokyo Station

The game already started on the Marunouchi side of Tokyo Station. The station is the most
recognisable building in the district, and the plaza in front of it is a closed, walkable room.
It is about 300 m wide, between the station's 335 m front and the Marunouchi and Shin-Marunouchi
towers.

The other candidate was the Ginza 4-chome crossing, with Wako's clock tower. It needs four
landmark buildings and a crossing's traffic and signage before it reads. The station needs one
building and a plaza, so one session can take it to finished.

### What AAA cities do, and what was taken

None of the studios below published assets that can be used. What was taken from them is the way
they build a city, not how their cities look.

- **Like a Dragon / Yakuza (Kamurocho).** One small district built at very high density, every
  frontage its own. Taken: the level's scope. One room is finished to the bar; the rest of the
  map is left as the open-data model.
- **Marvel's Spider-Man 2 (Insomniac).** Modular building kits, and fake interiors behind windows
  drawn with cubemaps.
  - Taken: the facade as a kit. One bay, opening and storey grammar is applied to the measured
    outline, so the station follows OpenStreetMap/PLATEAU's footprint instead of a hand layout.
  - Interior mapping is already in `web/buildings.js` for the generic buildings. The station's
    windows are real openings: a 0.45 m deep reveal, a sash and glass, with a share lit after dark,
    and behind the glass a room drawn by interior mapping (`web/interior.js`, below).
- **UE5 City Sample (The Matrix Awakens).** Rule-built buildings from kits, with detail by LOD.
  Taken: detail by tier. The finest meshes (sashes, reveals, kerbs) carry `detail` and are not
  drawn on the low tier.
- **Cyberpunk 2077, Ghostwire: Tokyo.** Layered materials, grime at the foot of walls, wet streets
  that reflect. Taken:
  - weathering at the foot of each wall in the PBR shader (`grime_m`);
  - the wet-street mirror already in `web/mirror.js`, which the plaza's paving takes because it
    is `street_lit` paving.
- **GTA V.** Hand-made LOD chains, decals and props. Taken: street furniture as instanced props,
  one draw call per part (`landmarks.json` `props`).

In the browser:

- **PBR textures.** three.js `MeshStandardMaterial` with colour, normal and roughness maps from
  Poly Haven (CC0; ambientCG is also CC0 and is the next source), shipped as WebP.
- **KTX2/Basis.** Not adopted yet: there is no encoder in the pipeline. WebP keeps the downloads
  small (1.8 MB for every set at both sizes). The GPU cost is bounded by size per tier: 512 px and
  no roughness map on phones. KTX2 would cut that GPU memory by about 4–8×; it is the next step if
  phones need it.
- **SSR, GTAO, light probes.** The game already has contact shadows (`web/game/ao.js`), the wet
  mirror and an environment from its sky. Nothing new was added.

### The shared PBR surfaces (`web/pbr.js`)

A landmark material names a set, and the textures are repeated every `tile_m` metres of the
mesh's texture coordinates:

```json
"pbr": {"set": "brick", "tile_m": [1.4, 1.4], "vary": 0.2, "grime_m": 1.6, "grime_z": 3.2, "normal": 1}
```

- **Sets.** `web/assets/pbr/`, fetched and sized by `python pipeline/fetch_pbr.py`. Sources and
  licence are in `web/assets/pbr/LICENSE-PolyHaven.txt`.

  | Set | Poly Haven texture |
  |---|---|
  | `brick` | `red_brick` |
  | `granite_paving` | `granite_tile` |
  | `slate` | `roof_slates_03` |
  | `stucco` | `plastered_wall_04` |
  | `concrete_pavers` | `concrete_pavers_02` |

  To add a set, add it to `SETS` and run the script.
- **Colour and roughness.** The maps are divided by their set's mean (`sets.json`), so a material
  still averages to its own `color` and `roughness`. A city tunes a surface by its colour, and the
  mesh reads the same before its maps arrive.
- **Breaking the repeat.**
  - `vary` adds a slow variation of tone, taken from the world position.
  - `grime_m` darkens and roughens the foot of a wall, `grime_m` metres up from `grime_z`.
- **By tier.** High and medium load 1024 px colour, normal and roughness maps. The low tier loads
  512 px colour and normal maps only. Meshes marked `detail` (`meshkit.Mesh.detail`) are not drawn
  on the low tier.

### Rooms behind the glass (`web/interior.js`)

A landmark material with `"interior": {"room_m": [w, h, d], "win_m": [w, h]}` draws a box room behind
its glass: a ray from the eye through the pane meets the back wall, the floor, the ceiling or a side
wall. The glass's texture coordinates are metres from the opening's left jamb and sill. By day the room
is dim; after dark it takes the material's floodlit glow as its lamps, brightest under the ceiling's
light. Each room's walls are a shade of their own, some with a cabinet or a picture. Where a window
is a pixel or two the room fades to its mean colour.

### Floodlighting from below (`web/world.js` `floodFrom`)

`"flood": [from_m, to_m, roof, top, cone_m]` lights a material from the foot of its walls. The fifth
value, `cone_m`, stands a fitting every `cone_m` metres along the wall's foot, and each throws a cone
of light up the wall: bright over the fitting, widening and evening out as it rises. This is the
scalloped light a floodlit facade shows in night photographs. The station's brick and stone take one
at every 3.6 m bay.

While this was built, the floodlit copy of every landmark material was found to have lost its
shader: its `onBeforeCompile` had ended up inside a comment. So since 8 November, every city's
floodlit landmarks had lost their pattern and their fall-off after dark. It is code again.

### Tokyo Station (`cities/tokyo/station.py`)

The station's solids from its OpenStreetMap/PLATEAU outline (r4856156) are hidden, and the station
is drawn on them.

- **Wings.**
  - Three storeys of openings about every 3.6 m: real holes 0.45 m deep, each with a sash,
    transom and glass.
  - Stone work round each opening: sills, lintels and keystones.
  - Stone courses at the plinth, at each storey's sills and at the first floor's imposts.
  - Quoins at the corners and a moulded cornice at 16.7 m. JR East gives about 16.7 m for the
    eaves; this figure is unverified.
  - Slate roofs with dormers.
- **Dome pavilions.**
  - Regular octagons fitted to the mapped octagons, about 22 m across.
  - An attic of round windows up to 24.6 m.
  - Slate domes with copper hips and dormers, up to 34.8 m. JR East gives about 34.8 m to the top
    of the dome without the finial. Above that, a lantern and the finial.
- **Central pavilion.** About 28 m, under its own steep roof, with the porch's stone piers.
- **After dark.** The scheme is LPA's, from 2012. Brick and stone are floodlit warm, falling off
  up the building, and about 62% of the windows are lit. No colour temperature is published;
  about 3000 K is assumed.
- **Plaza.** The plaza opened on 7 December 2017. Sources: Tokyo Metropolitan Government, JSCE
  award, trafficnews.
  - White granite paving from the facade to the street.
  - Two lawns with granite kerbs.
  - The zelkova rows on the axis to the Palace.
  - Three-lamp posts along the rows, and bollards at the street.
- **Not yet built.**
  - The dome interiors: the eagles and zodiac reliefs.
  - The station's signage.
  - The north and south transport plazas' bus and taxi pools.
  - The exact bay rhythm. The Shinkenchiku 2012/11 drawings would give it.

#### Checked

- Stills at day, dusk and night, on a desktop and a phone, before and after:
  `tools/game_shot.js tokyo tools/views/tokyo-hero.json`.
- `tools/game_check.js` checks that the PBR surfaces load and repeat in metres.
- Starting the game on the plaza turned up a traffic bug, which is now fixed: a car parked at the kerb
  could be asked to back out of a one-way street, and then stood there for good
  (`web/game/actors.js` `canReverse`).
- The game still starts south of the plaza, by the south dome, where it did. Started on the plaza
  itself, the game check's traffic steps watch the junctions round it, and one of them
  (junction 1465) holds two cars in its box each waiting on the other for over a minute: a knot in the
  shared traffic, not in the level. The plaza start comes back once that is undone (issue 412).
- Not checked: a real GPU, WebGPU, Safari and iOS.
