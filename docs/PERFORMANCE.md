# Performance on ordinary devices

The rule: cut what a player cannot see (GPU memory nobody samples, triangles smaller than a pixel,
work repeated for nothing), never what they can. Every change here is measured before and after, and
checked in stills from the same viewpoints.

## Measuring

- `tools/tex_mem.js` hooks every 2D texture upload in the page and sums the GPU memory per texture
  (mips included), with the image each came from. `STACK=1` names the script line that made a
  generated one; `OWNERS=1` lists which mesh and material holds a texture of each size in the game.
- `tools/far_cost.js` counts one frame's triangles and draw calls from a viewpoint, and for every mesh
  (each instance of an instanced one) how many of its triangles lie past 300 m, 800 m and 2 km.
- `tools/frame_cost.js` lists every framebuffer one frame draws into (size, format, MSAA), the draws and
  triangles into each, the full-screen passes and the bytes they write, the pixels shaded and the main thread's
  time a frame; `tools/frame_sweep.sh` makes a table of it for every live city and tier.
- `tools/views/sydney-vram.json`: a street view and an aerial view at day and night, for
  `tools/game_shot.js` before and after.

## GPU memory

Sydney's game on the high tier at 1440 × 900 held **456 MB** of textures, the title screen **195 MB**,
none of it block-compressed. What was cut, with no change on screen:

| What | Before | After | How |
|---|---|---|---|
| The sun's shadow map | 64 MB RGBA8 colour beside the 48 MB depth | 16 MB R8 colour | three.js r186 gives a PCF shadow map's render target an RGBA8 colour texture it never reads (only the depth texture is sampled). `world.js` `leanShadowMap` makes the target first, with a one-byte colour texture, and WebGLShadowMap keeps it (it builds its own only while `shadow.map` is null). A framebuffer's attachments must share a size, so the colour cannot go entirely. |
| The water's cover mask (`world.js` `waterCover`) | 40 MB RGBA8 | 10 MB R8 | a mask read as `.r` |
| The title's clouds (`earth.js`) | 43 MB RGBA8 | 11 MB R8 | a grey image read as `.r` (the 8K night lights already were) |
| The vessels' baked AO (`game/vehicles.js` `dress`) | 21 MB RGBA8 each (2048 px) | 5 MB R8 | three.js reads an AO map's `.r` |

Result: the game **456 → 362 MB**, the title **195 → 163 MB**. A rerun of the same build differs from
itself as much as before differs from after (moving crowd, cars and clouds), and the shadows match.

### KTX2 / Basis Universal: tried, not adopted for photographs

The biggest textures are aerial photographs (twelve 1000 × 1200 ground tiles per city, 6 MB each on
the GPU; the roofs' 2560 × 4096 composite of them; the sea) and the globe's Blue Marble. Encoded with
Basis Universal 1.x (Apache-2.0, through the MIT `ktx2-encoder` package's WASM build) and transcoded
back with three.js's `basis_transcoder`, one Sydney tile (JPEG 414 KB) gave:

| Mode | File | Against the source | GPU |
|---|---|---|---|
| ETC1S, quality 255 | 321 KB | PSNR 27.7 dB, SSIM 0.944: visibly softer and blockier | ÷ 12 |
| ETC1S, quality 128 | 222 KB | 24.9 dB | ÷ 12 |
| UASTC, effort 2, Zstandard | 1,565 KB | 42.4 dB, SSIM 0.999: indistinguishable | ÷ 4 |
| UASTC with RDO λ 3 | 1,424 KB | 36.5 dB | ÷ 4 |

For a photograph KTX2 trades either the picture (ETC1S) or the download, 3.5 times the JPEG (UASTC),
for GPU memory. Both break the rule, so the photographs stay JPEG. KTX2 remains the right format for
textures authored for it in the Blender builds (where UASTC's size is close to the PNG it replaces),
and real-time GPU block compression of a decoded JPEG (as Ludicon's spark.js does) would get the
memory without the download; neither is done yet.

## Work done for nothing each frame

Two more, the same picture to the bit:

- **The post stack's second multisampled buffer** (`world.js` `leanComposer`, used by the game, the viewer and
  the title). An EffectComposer clones its target for the other half of its ping-pong pair, so with 4x MSAA every
  full-screen pass after the scene (AO mix, highlights, bloom composite, lens, output) wrote four samples a
  pixel into an RGBA16F target and resolved them. A triangle that covers the frame gives all four samples the
  same value. Now only the scene draws into the multisampled target, and the passes take turns between two
  single-sampled ones. The second MSAA colour-and-depth buffer is gone: 62 MB at 1440 x 900, about 250 MB
  at 2880 x 1800 on a high-DPI screen.
- **The buildings in cells** (`buildings.js` `cells`). The city's walls and roofs were one mesh (Sydney:
  572,000 triangles across 5.7 km), so the GPU drew all of it twice every frame: once for the view and once for
  the sun's shadow map, which covers 340 m round a walker. The same triangles now go out as meshes over a grid
  of about 64 cells. They share the one geometry's vertex buffers (only the indices are new), and frustum
  culling drops the cells behind the camera and outside the shadow box. The one mesh stays out of the scene,
  for picking and its bounds tree. Sydney's game from the street went from **5.40 to 4.42 million triangles a
  frame** (shadow pass 2.08 to 1.57, view 3.31 to 2.84) for 29 more draw calls. The viewer's software-rendered
  frame went from 269 to 121 ms.

- **The static instanced props in cells** (`buildings.js` `cellInstances`): the rooftop plant, tanks, dormers,
  chimney stacks and gables (`buildings.js`), the landmarks' street furniture (`world.js`) and the game's benches
  and lamp posts (`game/game.js`). An instanced mesh is culled as a whole against a sphere round every instance,
  so a city's plant boxes were drawn into the view and the shadow map wherever the camera stood. Each is now
  split in place over a 400 m grid: the mesh keeps one cell's instances and takes the rest as child instanced
  meshes with the same geometry and material, so the cells outside the view or the shadow box are dropped.
  Each cell is a draw call, and on an old device draw calls cost the CPU more than small triangles cost the
  GPU, so only a mesh of 30,000 triangles or more is split. A first try at 250 m on every mesh of 48 instances
  or more saved 0.29 million triangles for up to 292 more draws, too many. Sydney from the street now draws
  **4.31 → 4.09 and 4.75 → 4.58 million triangles** (two views facing each other) for 40 and 81 more draws.
  The street lamps after dark were already drawn by cell (`night.js`).

- **The sun's shadow, split by what moves** (`world.js` `shadowCache`, `trees.js` `shadowCount`). A frame-by-frame
  count of the shadow pass on foot in Sydney (`tools/frame_cost.js` with `FOOT=1 FREEZE=1`, and a split by caster)
  found it was not the buildings: those were already culled by cell. It was the trees within 520 m, which are
  drawn whole (their instances are re-sorted as the camera moves, so frustum culling is off for them) into a map
  180 m round the player, the traffic signals of the whole city, the crowd and the cars. Three changes:
  - the trees: each re-sort writes the near and mid trees nearest first by their distance from the eye in the
    light's plane, and the shadow pass draws only the first so many that can reach the shadow camera's box, with
    30 m for a crown and its sway and room for the sun's turn since the sort (a turn of 3 degrees re-sorts). The
    view draws them all. 0.35 to 0.20 million triangles.
  - the traffic signals' poles, arms and housings (`game/junctions.js`) go in cells, like the props above.
  - the still casters (buildings, props, landmarks, signals, benches, lamp posts: `world.js` `still()`, or
    `userData.shadowStatic`) are drawn into a depth map of their own only when the light's pose or one of them
    changes (the sun steps every quarter second of the game's clock; a lift car moving; a landmark shown or
    hidden), and copied into the shadow map with a framebuffer blit in place of its clear each frame, before
    the moving casters are drawn over it. Three.js's own shadow pass draws both halves with its own materials.
    `fitShadow` keeps 5% more room than asked and holds the box still while the view moves inside that room and
    the sun has not stepped, so a walker does not slide it a texel every few frames. `?shadowcache=off` turns it
    off.

  Sydney on foot, one frame without a refresh: the shadow pass went from about **1.47 to 1.16 million
  triangles**, the still casters' share drawn about four times a second instead of sixty. Stills with the cache on
  and off match to the bit from the air and in every shadow on the ground on foot (the rest is wind, waves and the
  crowd). What is left is the crowd (about 0.6 million; people only stand round the player, so the box covers
  them) and the cars. Not measurable here: the time a blit of a 4096 px depth map takes on a phone's GPU, against
  the triangles it saves; on the low tier the map is 2048 px, a quarter of the bytes.

What the shadow pass still draws is mostly instanced props, trees and people spread over the whole city. An
instanced mesh is culled as a whole, so these are drawn in full however small the shadow box.

## The far trees as impostors

Past the mid distance (520 m; a wood's trees from 200 m) a tree was a trunk and an 80-triangle crown hull in its
species' one colour. Now each species' mid-distance model (its real leaf cards, in the season's colours) is drawn
once, at load, into an atlas from three heights (level, 40 and 80 degrees up; 256 px a view, 128 on a small
screen), and each far tree is one camera-facing quad (`web/trees.js`, `bakeFar`). The quad blends the two
nearest heights, is mirrored for every other tree and tinted per tree, and is lit by the sun as a round crown (a
spheroid normal, as the near trees' cards are). Where a yozakura is lit after dark it is uplit too. The alpha is
scaled by the mip level, so a crown keeps its density at a distance rather than thinning to twigs. The atlas is
drawn again only when the season's look changes. `?impostors=off` keeps the hulls.

Sydney's game on foot, high tier, 1440 x 900: **3.75 → 3.14 million triangles** a frame (−16%) and 456 → 450 draws.
The stills from the air at day, dusk and night, on a desktop and a phone, show the far trees with their leaves,
species colours and light, where the hulls were smooth green domes.

Adopted from: octahedral impostors (Ryan Brucks, for Fortnite) and
[agargaro/octahedral-impostor](https://github.com/agargaro/octahedral-impostor) (MIT) for the idea; no code was
taken. A tree is near enough to round that three heights and a mirror do here instead of an octahedral grid.

## What cannot be seen is not drawn (issue 358, B1)

From a street the street wall hides most of the city, and the city never changes. Frustum culling cannot
know that: it drops what is behind the camera, not what is behind a building.

**Measured first** (`tools/far_cost.js`, the street, high tier, 1440 x 900): Shibuya draws 7.74 million
triangles a frame. The crowd's instanced meshes are about 2.5 million of the view and 2.5 million again of the
shadow pass (about 1,500 triangles a walker, every mesh drawn at its full count with the walkers out of
reach scaled to nothing); the buildings' cells are 0.89 million of the view (0.76 million of them past
300 m) and 0.24 million of the shadow pass. Sydney draws 2.71 million, 0.13 million of them buildings. So
hiding buildings alone is worth a twentieth of Shibuya's frame; the crowd and the cars are the prize, and
they need the instance compaction of issue 352 before a hidden walker stops costing its vertices.

**Tried first, not adopted: a set per cell, computed offline** (the potentially visible set of Quake, Teller
and Sequin 1991; for cities, Wonka, Wimmer and Schmalstieg 2000, "Visibility preprocessing with occluder
fusion for urban walkthroughs"). For it to be conservative for a whole 64 m viewer cell, the occluders must be
shrunk by the spacing of the eye points sampled in the cell, and the cell's answer is the union over all of
them. On Shibuya that hid a walker in 13 to 17% of the ground cells within 270 m, where a single eye point hides
81%: Tokyo's buildings are 6 to 10 m wide, shrinking by 2 m leaves 12% of the frame as occluder against 33%,
and a 64 m cell sees round every corner in it. Without the shrinking (no longer conservative) it reached 42 to
58%. Smaller cells mean megabytes of sets per map, and an hour of baking for each.

**Adopted: the occluders baked offline, the sweep from where the camera is.** What is static and expensive to
get right is the occluder model, so that is what the pipeline distils:

- `pipeline/visibility.py` writes `web/data/<city>/vis.bin` (made by `python pipeline/pack.py` with the packs,
  checked by `--check`): the height of the buildings at 1 m, one byte a pixel. Only solids that stand on the
  ground, are not replaced by a landmark's model, are not canopies and have no road through them, up to their
  eaves; only pixels wholly inside them (the union, with walls that meet within 4 cm as one, shrunk by half a
  0.5 m pixel's diagonal, then each 1 m pixel the lowest of its four and the ring round them). Landmarks, trees,
  bridges, vehicles and people hide nothing. 60 to 660 kB a city, 1.1 MB for Shibuya, fetched by the Worker after
  play has begun; Queenstown has too few buildings (1.6% of its frame) to be worth one and gets a header.
- `web/visibility-sweep.js` (in `visibility-worker.js`): from the camera, 720 wedges march outward over a
  min-pyramid of that raster and the terrain, keeping the horizon. Behind an occluder of top *o* at distance
  *d*, nothing below *e + (o - e) r / d* can be seen at distance *r* (occluder shadows, Wonka and Schmalstieg
  1999). A wedge's occluder is the lowest along the whole chord across it, so it holds for every ray inside.
  The answer is a grid of 16 m cells: the height under which nothing in the cell can be seen. 13 to 19 ms in
  Node on this machine, off the main thread.
- `web/visibility.js` (`OEVis`): asks for a sweep when the camera nears the edge of the last one's margin. The
  occluders are shrunk by that margin first (1, 2, 4 or 8 m, by the camera's speed), which makes what is hidden
  from the sweep's point hidden from every point within the margin (occluder shrinking, from the same 2000
  paper), and the eye is taken a metre higher than the camera, since a higher eye sees everything a lower one
  does. An answer is used only while the camera is within its margin and no higher: outside it, with no
  answer yet, inside a building or a room, or faster than a sweep can follow, everything is drawn as before.
  So the worst case is the old frame. `OEVis.gate(mesh)` hides a static mesh (layer 0 off, so that a prop
  cell's child cells are still drawn) while every 16 m cell it touches is hidden to its height there;
  `OEVis.seen(x, y, top, reach)` is the same question for one moving thing, for the crowd and the cars.
- The sun's shadow needs every caster, seen or not (a tower behind the street wall still shades the street):
  `world.js` shows the gated meshes again round the shadow pass, outside the shadow cache. The view's list is
  made before the shadow pass in the same render call, so it keeps the gates. The water's and the wet street's
  mirrors take the gates as they are: in a 2.5D city what a mirror in the ground shows of a thing can be seen
  directly too.

No code was taken from the papers; the method is theirs, the 2.5D horizon form is the old viewshed sweep of
terrain analysis.

**Proof.** `tools/vis_unit.js` (in `tools/check.sh`): in every live city, exact rays from eyes anywhere within
a sweep's margin to random points up to 1.5 km away; of 2,600 to 6,600 rays a city that reach their point, none
is reported hidden. `tools/vis_check.js`: walks and drives each map's own footways and roads, and at each stop
draws the same held instant with the gates and without, four ways round, from the sweep's point and from the
edge of its margin; the two frames must match to the pixel (the page's clock is stopped for the pair, or the
water's waves differ between any two frames).

What the harness measured, 960 x 600, high tier, 15:30, a mean over about 96 frames a map from a walker's eye,
a camera behind one and a driver's (every pass of the frame: the view, the shadow map, the reflections):

| Map | Stops | Frames compared | Frames that differ | Triangles a frame, all drawn → gated | Draws | Static meshes hidden |
|---|---|---|---|---|---|---|
| Shibuya | 25 | 100 | 0 | 7.58 → 7.25 M | 389 → 354 | 129 of 205 |
| Shinjuku | 24 | 96 | 0 | 4.07 → 3.89 M | 324 → 295 | 109 of 180 |
| Tokyo (Marunouchi) | 24 | 96 | 0 | 3.73 → 3.57 M | 400 → 375 | 90 of 178 |
| Kyoto | 24 | 95 | 0 | 3.82 → 3.42 M | 459 → 450 | 31 of 74 |
| Sydney | 23 | 92 | 0 | 3.84 → 3.79 M | 497 → 479 | 67 of 148 |
| Higashiyama | 25 | 98 | 0 | 3.47 → 3.44 M | 270 → 266 | 14 of 42 |
| Philosopher's Path | 25 | 100 | 0 | 3.21 → 3.18 M | 366 → 361 | 16 of 47 |
| Fushimi Inari | 25 | 100 | 0 | 3.62 → 3.61 M | 295 → 290 | 18 of 42 |
| Queenstown | no raster: nothing gated | | | | | |

Shibuya again at 21:30 (15 stops, 60 frames, none differ: 7.43 → 7.06 M, 355 → 317 draws) and on the low tier
at 390 x 844 (15 stops, 60 frames, none differ: 3.66 → 3.55 M, 27 of 72 static meshes hidden). Kamakura came
onto main while this ran: its raster is baked and passes the exact-ray check; the harness has not walked it.

So the static meshes alone give 1 to 10% of the triangles and up to 35 draws: the street wall hides half to two
thirds of them, but they were a small part of the frame. A stop where the camera stood inside a building's
footprint (a footway mapped through a block: five of 195) got no answer and drew everything, as it should; the
first run of the harness found exactly that case as missing towers in Sydney, which is why the camera is now
tested against the solids themselves.

**The crowd and the cars** (after issue 352 put the walkers drawn at the front of their meshes). They are chosen in
the game's step, before the camera moves for the frame, so they ask `OEVis.seenNext(x, y, top, height)`: the
answer counts only while the camera has a tenth of a second's travel of its margin left, and the thing's height
gives how far its shadow reaches under the sun now (`OEVis.cot`, set by the game). The step also moves the crowd,
so two frames of it cannot be compared to the pixel; `tools/vis_check.js` instead casts rays from the camera to
the feet, waist, head and shoulders of every walker within 450 m that the question leaves out, against the walls
and the ground as drawn, and each must be stopped. Stops among the crowd near each map's start, and the others:

| Map | Walkers within 450 m | Left out as hidden | Of those, in plain sight |
|---|---|---|---|
| Shibuya | 4,001 | 2,639 | 0 |
| Shinjuku | 3,705 | 2,652 | 0 |
| Tokyo | 2,998 | 1,829 | 0 |
| Kyoto | 1,269 | 997 | 0 |
| Kamakura | 985 | 420 | 0 |
| Sydney | 770 | 599 | 0 |

(The static meshes again compared to the pixel at every stop: none differ, Kamakura included.)

**What it does not do yet.** The trees are re-sorted every 12 m the camera moves, further than an answer holds,
so they are not gated; the far ones are two triangles each already. The landmarks are one mesh a material
across the map and cannot be hidden in parts. Not checked: a real GPU, Safari or iOS (the Worker needs `DecompressionStream`: Safari 16.4), a phone's memory
with the 18 MB raster of the largest map and its shrunk copy (the low tier keeps one copy, the others two).

## The rest of issue 358's Layer B and C, as measured

**B2, the sky the ground sees** (`pipeline/skyvis.py`, `web/data/<city>/skyvis.webp`; on by default since the look stream (issue 353)
agreed to it at 0.6, a pure scalar; `?skyvis=off` leaves it out). For each point of the ground, the horizon in 16 directions out to 300 m
over the 2 m surface model, and from it the share of a uniform sky's light on a level surface there (the mean of
cos² of the horizon's elevation: horizon-based ambient occlusion, Bavoil, Sainz and Dimitrov 2008, on a height
field as Timonen and Westerholm 2010; the method only). One channel, 4 m a pixel, lossy WebP at quality 80
(234 kB for Shibuya, 3 in 255 off on average; lossless was six times that, and a second height and the ground's
level in the other channels three times, for things only a tree's crown would read). `world.js` `skyLit` reads
it in the materials that take the street lights (the ground and what is paved on it) and multiplies the indirect
diffuse light alone, within 500 m of the camera: further off the aerial photograph carries its own shade. Shibuya's
ground sees 54% of the sky on average, a canyon like Center Gai a third. It is the soft shade that screen-space
AO gave only within a few metres of each pixel and computed again every frame; with it the AO pass can shrink to
contact shadows (issue 352's to decide). The walls already carried a per-vertex openness (`buildings.js`).

**B4, the sun's shadow past the shadow map** (`visibility-sweep.js` `sunShadow`, `world.js` `farSun`; a prototype,
`?farsun=on`, or `?farsun=all` to see the field everywhere). The shadow map covers 180 to 340 m round the
player; past it nothing was shaded by the sun, and a tower outside the box threw no shadow into it. Instead of
horizon angles stored per texel for every azimuth of the sun's track (megabytes a map), a Worker sweeps the
game's own 2 m surface model once along the sun's direction: a cell's shadow height is the higher of the top and
the shadow height one step towards the sun, less the sun's climb over the step. 1 to 1.6 s for Shibuya on this
machine under a software renderer's load, off the main thread, again when the sun has turned 0.4 degrees; the
result is an RG16F texture at 4 m (4.4 MB), the height under which the sun is hidden, as a roof sees it and as
the ground and walls do. The lit materials of the ground and the buildings multiply the sun's light by it
outside the shadow map's box. At 13:00 on 10 November it shades 54% of Shibuya's open ground. **Not judged yet:**
the stills taken so far (from over the roofs, and in two alleys inside the box) show no artefact and little
of the far ground; it needs views down long streets and a film at walking, driving and flying speed before it
is on by default, and the shadow box could then shrink (issue 352, item 5).

**B3, a far shell of the buildings: measured, not built.** The buildings' cells are 0.89 of Shibuya's 7.7 million
triangles from the street and 0.5 once B1 hides what the street wall covers; Sydney's are 0.13 of 2.7. A shell
of flat-roofed blocks merged by height within 500 m cells comes to 584,000 triangles for Shibuya against the
1.96 million drawn now (37,576 polygons from 49,950 solids: Tokyo's houses stand apart and differ in height,
so merging buys little) and 122,000 against 455,000 for Sydney. Drawn in place of the cells past 500 m it would save about 0.3 million
triangles a frame on Shibuya, 4%, for a megabyte more to download or a second build at load, and a second
facade to keep equal at day, dusk and night (the far windows are lit by the facade's shader). The walls'
splits at 8, 24, 48 m (for the openness) are another 0.1 million. Worth doing after the crowd (2.5 million in
the view and as many in the shadow pass) no longer dwarfs it.

**C1, a cached far layer: not built, for the same reason.** With the crowd within 450 m and the near field
drawn every frame, a cube map of what lies past 250 m, one face a frame, would replace about 0.5 million
triangles a frame on Shibuya (7%) and the shading of the far pixels, against a seam between two layers under
4x MSAA, the water, the night's additive lights and everything that moves out there at a sixth of the frame
rate. The frame is fill-bound on the measured device (issue 358's telemetry), which the pixel budget of issue
352 addresses directly.
## The frame budget (issue 352)

A frame costs the pixels shaded times the work on each, the draws and triangles submitted, and the main
thread's time. `tools/frame_cost.js` prints all of them (the pixels shaded: every full-screen pass's
viewport, and each target the scene's geometry is drawn into once per MSAA sample; the main thread: the time
inside the frame's `requestAnimationFrame` callbacks), and `tools/frame_sweep.sh` runs it on foot, with the
clock held, for every live city on each tier. Software-renderer frame times are not in the tables: they only
compare one build with another.

### One full-resolution pass after the scene

After the scene was drawn, four passes each drew the whole frame again into a full-size RGBA16F target: the
contact shadows' mix, the highlights' roll-off, the bloom's blend and the lens. Each did a few arithmetic
operations a pixel; what they cost was the 8 bytes a pixel written and read back four times, which is what a
phone's tile-based GPU and any integrated GPU's memory bandwidth pay for.

Now (`web/game/atmosphere.js`, `web/lens.js`, `web/game/ao.js`) nothing after the scene runs at the frame's
full size but the last pass, the lens, which writes the canvas. As it reads the scene's own target it applies
the contact shadows (upsampled by depth from their half-size texture), rolls the highlights off and adds the
bloom's half-size composite, then grades as before. The bloom's bright pass, at half size, reads the scene
directly and rolls the highlights off for itself (four taps, each rolled off, so a one-pixel glint blooms as
it did). The game no longer builds an `EffectComposer`; the stack keeps a composer's shape (`passes`,
`addPass`, `render`) for the films' director and the checks. A camera effect (photo mode's depth of field,
an opening shot's motion blur, an overture's painted look) or a film's own lens brings a full-size pass or two
back for as long as it is on, through two targets that are only made then (20 MB at 1440 x 900 that play no
longer holds).

With it:

- The low tier's bloom ran in full although `TIERS.low.bloom` says none. It now runs from a quarter of the
  frame (four levels in place of five from a half), and only from dusk to dawn: by day nothing reaches its
  threshold but the sun's glints. Night stills on the low tier match main's.
- The canvas was created multisampled on the medium and high tiers, though with the post stack the only thing
  drawn to it is the lens's triangle. It is now single-sampled there (the scene's own target keeps the tier's
  MSAA): at 1440 x 900 that is a 4x colour and depth buffer the browser no longer allocates and resolves.
- The contact shadows' passes draw one triangle over the frame, as the others do, rather than two (no
  diagonal seam shaded twice).

Sydney's game on foot, high tier, 1440 x 900, 15:30 (`FOOT=1 FREEZE=1 tools/frame_cost.js sydney`):

| | main | after |
|---|---|---|
| full-size passes after the scene | 4 | 1 |
| full-screen passes in all (45 of them the ocean's 128 px transform) | 69 | 66 |
| bytes the full-screen passes write a frame | 70.1 MB | 40.4 MB |
| pixels shaded (passes, and geometry targets per sample) | 31.3 M | 27.4 M |
| draws, triangles | 420, 3.33 M | 416, 3.31 M |

Stills of the same views before and after (a street by day, at dusk and at night on each tier, and the city
from the air by day and at night) differ only in what moves between two runs: the clouds, the trees in the
wind, the waves and the traffic. Not measurable here: what the bandwidth saved is worth in milliseconds on a
phone's GPU or an integrated one.

### Resolution that goes both ways

`shed()` stepped down every four seconds below 24 frames a second (the rain's extras, the weather, the wet
street's mirror, then pixels to 85% and 70%) and never came back; the contact shadows had a budget of their
own beside it. Both are replaced by one governor (`web/quality.js` `OEQuality.governor`, ticked by
`game.js`):

- It holds a smoothed frame time against a target: the display's own interval, or the frame-rate cap's (the
  menu's Frame rate: 30, 60 or the display's; 60 by default, so a 120 or 144 Hz display draws every second
  frame of the game, not twice the frames for the same picture).
- `governor.scale` is the scene's resolution against the canvas's, in steps of a twentieth between the tier's
  ceiling and 0.6. The post stack draws the scene, the occlusion and the bloom at that scale; the canvas and
  the interface stay at the display's resolution, and the lens upscales with a contrast-adaptive sharpening
  (the limiter of AMD's FidelityFX RCAS, MIT, written here: four more taps, only while the scale is under 1).
- `governor.extras` (1, 0.5, 0) is how much of what a frame can do without is drawn: at 0.5 no far rain or
  splashes, no wet-street mirror, the lighter contact shadows; at 0 no weather's drops and no contact shadows.
- Down: resolution to 0.8, then the extras, then resolution to 0.6. Up: vertical sync hides headroom, so after
  four calm seconds it tries a step up; a try that does not fit is taken back and the next waits twice as long
  (to a minute). Extras return at full resolution after a longer calm (the weather keeps what it shed until
  the next visit, as before). A display that cannot be met even at the floor is given half its rate as the
  target, where frames are even, and resolution comes back against that.
- The tier's pixels have a ceiling. The high tier was `min(dpr, 2)` of the display with 4x MSAA: 8.3 million
  pixels on a 4K display, 14.7 million on a 5K one at 2x. The canvas is now held to a 4K display's pixels and
  the scene inside it to 2560 x 1440's (the governor's ceiling), so a 4K display draws the scene at two
  thirds of its size and the lens brings it up.

`tools/governor_probe.js` feeds it frames on a clock of its own (fast: it stays; 40 ms: 1.00 to 0.80, extras
to 0, 0.60, then half rate and back up; fast again: 1.00 with every extra) and takes stills at 1.0, 0.8 and
0.6; `tools/game_check.js` checks the order and the way back in every city. Not checkable here: how it
feels on a real display, where the frame time is a GPU's and not a simulation's.

### Scene renders nobody sees

- **The sea, inland.** The ocean's wave transform (45 passes into 128 px targets), its wake field and, on a
  GPU that affords it, a second draw of the city for its reflection ran every frame in every city, Fushimi
  Inari's hillside included. An occlusion query had been tried for this (below) and reported water where
  there was none. The world now asks the terrain, with no GPU at all (`world.js` `seaInView`): the sea shows
  where the ground is at its level, so a map with no such ground never draws or updates it, and elsewhere the
  ground is sampled under a grid of rays through the frame and along the frame's sector out to 13 km.
  Buildings in the way are not counted, so it errs towards drawing; with none in sight the waves, wakes and
  reflection rest, and the sheet keeps the waves it had for the frame that brings it back.
- **The wake field** was drawn by handing the whole world to the renderer with a camera that sees one layer:
  every object of the scene graph visited for a handful of wake meshes. It is now drawn from the list of wake
  meshes (`water.js` `wakeScene`), and not at all when none is shown.
- **The reflection** is redrawn every frame only while the camera moves; while it stands still, every third.
- **The wet street's mirror** already drew every other frame at a third of the size; it now rests when the
  frame is all sky.

### Instances that are not drawn

The crowd's instanced meshes were never culled, a hidden walker was a model scaled to nothing (its vertices
still run, in the view and in the shadow map), and every instance buffer was uploaded whole every frame. Now
(`people.js` `crowdRenderer`) each character's drawn walkers are the first `mesh.count` slots: a walker out
for the hour, near enough to be a skinned person, or out of the camera's sight by more than a shadow's
length (30 m) changes places with the last one drawn, colours and all, and only the drawn range of the
matrices and the gait is uploaded. The cars' models were already packed each frame; they take the same sight
test and upload only the slots taken (`actors.js`).

### The main thread

- No vector is made per walker per frame (`people.js`), and the shadow cache compares the still casters'
  state in two buffers it keeps instead of two arrays of some twenty numbers a caster made and dropped every
  frame (`world.js`).
- The frame's HUD nodes are looked up once and their text is written only when it changes (a text node
  replaced with the same words is still a style and layout pass); the minimap repaints 30 times a second at
  most (`game.js`, `hud.js`).

### Before and after

On foot at the start, 15:30, clock held, high tier, 1440 x 900 (`FOOT=1 FREEZE=1 tools/frame_cost.js`); main is
0dd48803:

| | Sydney, main | Sydney, after | Shibuya, main | Shibuya, after |
|---|---|---|---|---|
| full-screen passes | 69 | 66 | 71 | 18 |
| full-size passes after the scene | 4 | 1 | 4 | 1 |
| bytes the full-screen passes write a frame | 70 MB | 40 MB | 90 MB | 29 MB |
| draws | 420 | 416 | 420 | 360 |
| triangles | 3.33 M | 3.26 M | 7.61 M | 4.34 M |
| pixels shaded | 31.3 M | 27.4 M | 33.7 M | 26.4 M |

Sydney keeps its sea (the harbour is in the frame); Shibuya, with no ground at sea level, loses the ocean's 45
passes and its sheet, and two fifths of its triangles were walkers and cars outside the frame. Stills of
the scramble by day and in the rain at night, and of Sydney's quay and the city from the air, match main's:
the same people in the same places.

## Next, by what it saves for what it risks

Measured on Sydney's game, high tier, 1440 x 900, from the street, after the work above: 4.42 million triangles,
849 draws, 78 full-screen passes.

1. **Per-instance culling for the static instanced props** (rooftop plant, gable bodies, landmark street
   furniture, benches, lamp posts). three.js r186's `BatchedMesh` culls each instance against the camera, the
   shadow camera included (`perObjectFrustumCulled`), and sorts them; an `InstancedMesh` is all or nothing.
   Most of the 1.5 million shadow-pass triangles are these. No visual change.
2. **A cached shadow map for what does not move.** Done (above), as a copy of the cached depth under each frame's
   moving casters rather than two maps, so the lit shaders are unchanged.
3. **Impostors for the far trees.** Done (below).
4. **The ocean's FFT** draws 45 full-screen passes a frame into 128 x 128 RGBA32F targets (256 x 256 on a large
   screen with a hardware GPU). Its outputs are already half float, and the butterflies stay 32-bit where the GPU
   can render to it, because seven butterfly stages in half float would put noise in the waves. At 128 x 128 the
   passes cost little, so this stays as it is.

   *Tried, not adopted (and since done another way, from the terrain: "Scene renders nobody sees" above):*
   skipping the waves and the water's reflection while no water is on screen, found with an
   occlusion query round the water's draw. In Shibuya's streets, with no water in the picture (checked by painting
   the water red), the query still reported samples drawn every frame, so it would rarely switch off. The one large
   saving would have been the reflection's second render, and only the high tier on a large screen has that: an old
   device already goes without it.
5. **Shader precision on the low tier.** Mobile GPUs run `mediump` at twice the rate of `highp`. The world-space
   maths (positions kilometres from the origin, the reversed depth) must stay `highp`; colour and lighting need
   not. Go shader by shader, with stills.
6. **4x MSAA on a high-DPI screen.** At two device pixels a CSS pixel the edges are already sampled twice in
   each direction, so 2x MSAA there would likely look the same for half the samples. That is a visual change,
   however small, so it needs stills side by side first.

## Far geometry: what games do, and what this game draws

One frame of Sydney's game from the street draws **5.3 million triangles** on the high tier and **4.6
million on the low tier on a phone** (about 2 million of them the shadow map's). Of the view pass,
**60% lies past 300 m and a third past 800 m**: mostly thousands of instanced far trees (an 80-triangle
crown hull each, 7,352 of them), street props and the building chunks. That is the part an old device
pays for and a player cannot tell apart from a picture.

How games handle the distance:

- **Impostors.** A far object becomes a quad showing a picture of it baked from many directions
  (octahedral impostors, Ryan Brucks for Fortnite; SpeedTree's billboard LOD). The three.js library
  [agargaro/octahedral-impostor](https://github.com/agargaro/octahedral-impostor) draws a forest of
  200,000 trees with a meshoptimizer LOD from 15 to 100 m and impostors beyond; the
  [cinevva write-up (2026)](https://app.cinevva.com/blog/2026-05-04-open-world-browser-part-19-imposters) found
  hemi-octahedral grids stop the flicker at the poles. Licence to be checked before any code is taken.
- **Hierarchical LOD.** Unreal's World Partition merges a far cell's meshes into one proxy with baked
  textures; GTA V chains LOD and "SLOD" models, with night lights as sprites at range.
- **Backdrops.** Games with a bounded playable area paint or bake what lies beyond it into cards or a
  sky dome (the city skyline in Persona 5's Tokyo, the far ranges in Genshin Impact's regions). This
  game already does it for the land past the model's frame (`farland.js`: terrain and land cover from
  open data, lit and hazed with the scene). Inside the frame the helicopter reaches everywhere, so a
  backdrop there has to be distance-based, which is an impostor or an HLOD.
- **Not this:** a mobile team's write-up ([Game Developer](https://gamedeveloper.com/production/fake-it-til-you-make-it-faking-extended-draw-distance-in-mobile-games))
  found HLOD unsuitable for their case and faked distance with fog and shaders; the haze here already
  does that past the frame.

Next, in order of value: impostors for the far trees (the largest share, and the case the technique was
built for), screen-size culling for small instanced props once they are under a pixel, and limiting the
shadow pass to casters whose shadow lands inside the shadow camera's sharp range. Each must pass the
same before-and-after stills.

## The build stage (issue 327)

The telemetry's desktop loads spent about 10 s between "decoded" and "built". `tools/start_profile.js LOAD=1
PROFILE=1` now prints the load's stages, the build's time by the loader's step and a profile of the build as a
whole; `tools/stage_sweep.sh` gives one line a city; `tools/reef_load.js` does the same for a reef or alpine
site. What the build spent its time on (Kyoto, llvmpipe), and what was done:

- **A GPU read back, 5.1 s.** The haze at the model's edge was read from twelve pixels of the sky drawn on the
  GPU (`readPixels`), which waited for every shader and upload queued before it; an asynchronous read only moved
  the wait to `getBufferSubData`. world.js now evaluates the sky's shader (three.js r186's Sky with this app's
  changes, clouds included) for those pixels on the CPU (`hazeOf`). `tools/haze_check.js` holds it to the GPU's
  read: 80 of 80 suns, clear and cloudy, within 0.03 of a 2% tolerance. A clock set from the menu no longer
  stalls a frame either.
- **The inland water's levels, 1.2 s.** `inland.js` looked its ring points up through a Map keyed by strings,
  a million times in `raise()`: a dense grid now.
- **The city's shaders, after everything else.** They now compile from the moment every light is in place
  (the car's headlamp and the helicopter's searchlight are put in the world at the start for that), behind
  the surface model, the footways, the people and the traffic, one program in flight at a time (a synchronous
  GL call there waits for one at most). Where the GPU compiles in parallel the two overlap.
- Still on the CPU: the buildings (4 s in Kyoto, already in slices between frames), the surface model and the
  walking network (nav.js, 2 to 3 s), the footways (1.5 s). The next step would be a Worker for the buildings'
  geometry (follow-up issue).

Every live city, llvmpipe, 960×600, high tier, the median of two runs (`tools/stage_sweep.sh`), main → after:

| city | playable (s) | build, decoded → built (s) |
|---|---|---|
| fushimi-inari | 9.4 → 8.5 | 3.3 → 2.7 |
| higashiyama | 11.8 → 10.1 | 5.6 → 3.2 |
| kyoto | 27.9 → 23.8 | 18.1 → 9.9 |
| queenstown | 17.1 → 15.4 | 7.6 → 5.7 |
| shibuya | 21.5 → 19.4 | 12.1 → 9.2 |
| shinjuku | 18.9 → 16.3 | 9.7 → 6.8 |
| sydney | 17.2 → 15.9 | 7.3 → 6.5 |
| tetsugaku | 10.8 → 9.4 | 5.0 → 3.3 |
| tokyo | 20.3 → 20.0 | 12.3 → 8.9 |

The reef and alpine sites build in 1.7 to 4.3 s; their wait is after "built", in three.js's WebGL backend
compiling (`_completeCompile`, 11.6 s of Lake Tekapo's load), much of it in the first frame after
`compileAsync`, and in Tekapo's detail photograph (`terrain.prepare`). On a device with WebGPU, as the
telemetry's desktop has, the backend is another one; a follow-up issue holds it.
