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
- `tools/reef_frame.js` does the same for a reef or alpine site on the WebGPU backend the visitors get: every render
  and compute pass of a frame with who asked for it, its target, draws, triangles, pixels and bytes written, and the
  GPU's time inside it by timestamp query; `ABLATE=1` adds what each thing in the scene costs.
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
outside the shadow map's box. At 13:00 on 10 November it shades 54% of Shibuya's open ground. **Judged, and left
off (issue 375):** a film driving down Shibuya's streets at 16:00, and stills down Dogenzaka and from 260 m over the
roofs at 12:30 and 15:30 (`tools/views/shibuya-farsun-375.json`), with it on and off: no artefact, and almost no
difference either. The mean of each frame moved by under 0.1 of 255 and no pixel by more than 15; even
`?farsun=all` (the field everywhere, the shadow map's own box included) darkened the view from the air by 0.8 of
255. Past the box the haze and the aerial photographs' own shade carry the far city, so the Worker's sweep (a second
or more of a core each time the sun turns 0.4 degrees) and the 4.4 MB field buy nothing a player sees. It stays a
flag; it earns its place only if the shadow box shrinks (issue 375, item 2), when the ground between the smaller
box and the haze would need it.

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
  splashes, no wet-street mirror, the lighter contact shadows and two MSAA samples in place of four; at 0 no
  weather's drops, no contact shadows and no MSAA (the sharpened upscale and the lens's grain hide the edges
  there more cheaply than four samples a pixel).
- The display's interval is taken only from gaps between animation frames shorter than a 60 Hz display's (a
  90, 120 or 144 Hz display); otherwise it is a 60 Hz display's. The first version took the shortest gap seen,
  and on a device that cannot keep up that gap is the frame's own time: it aimed at the slowness itself and
  stopped stepping down after one step (found with `tools/governor_probe.js` once the software renderer's
  frames had become fast enough to fall under the 100 ms it accepted).
- Down: resolution to 0.8, then the extras, then resolution to 0.6. Up: vertical sync hides headroom, so after
  four calm seconds it tries a step up; a try that does not fit is taken back and the next waits twice as long
  (to a minute). Extras return at full resolution after a longer calm (the weather keeps what it shed until
  the next visit, as before). A display that cannot be met even at the floor is given half its rate as the
  target, where frames are even, and resolution comes back against that.
- The tier's pixels have a ceiling. The high tier was `min(dpr, 2)` of the display with 4x MSAA: 8.3 million
  pixels on a 4K display, 14.7 million on a 5K one at 2x. The canvas is now held to a 4K display's pixels and
  the scene inside it to 2560 x 1440's (the governor's ceiling), so a 4K display draws the scene at two
  thirds of its size and the lens brings it up.

- It runs on the title's orbit as well as in play (the telemetry's slowest frames were Shibuya's title screen,
  where nothing held them), reports each step to the telemetry (scale, what was shed, MSAA, the cap) and keeps
  the scale the device held on each map (`localStorage` `oe3d-gov-<city>`), so the next visit starts there
  and climbs again if it can.

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
test and upload only the slots taken (`actors.js`). Both also ask the precomputed visibility
(`visibility.js` `OEVis.seen`, issue 358) with the shadow's reach for the sun's height: a walker or a car
behind the buildings, whose shadow cannot reach anything seen, takes no slot. Shibuya's scramble on foot then
draws 2.91 million triangles in 315 draws (7.60 million in 415 on main at the start of this issue).

### The main thread

- No vector is made per walker per frame (`people.js`), and the shadow cache compares the still casters'
  state in two buffers it keeps instead of two arrays of some twenty numbers a caster made and dropped every
  frame (`world.js`).
- The frame's HUD nodes are looked up once and their text is written only when it changes (a text node
  replaced with the same words is still a style and layout pass); the minimap repaints 30 times a second at
  most (`game.js`, `hud.js`).

### Lights that are dark

Every light in the scene is in every lit shader whatever its intensity. `tools/light_cost.js` takes them out and
measures (Shibuya's scramble at 13:00, high tier, software renderer, median frame): the two spotlights (the
car's headlamp, the helicopter's searchlight) and the night's fill, dark by day, cost nothing that can be
measured. The screens' eight area lights and the light card did: 3,557 ms with them, 3,058 ms without, a seventh
of the frame, for a light held to 6% of its night's strength by day. Rather than a second set of programs for
the day (compiled ahead, twice the shaders), the area lights' loop passes over a light whose colour is zero
(`lens.js` `loopAreaLights`: a test of a uniform), and the screens' light fades to nothing in full daylight
(`neon.js`). The same view then takes 3,053 ms with every dark light in the scene, and taking them out gains
nothing more. Day, dusk and night stills of the scramble match.

### Every live city, before and after

On foot at the start, 15:30, clock held, 1440 x 900 (`tools/frame_sweep.sh`), main (0dd48803) → after
(90aa3ea0; Kamakura is new since). The sea's cities (Sydney, Tokyo, Queenstown, Kamakura) keep the ocean's 45
small passes while water is in the frame; the others have none. The low tier's frame by day in a city with no
sea is the scene and one pass.

| city | tier | full-screen passes | draws | triangles (M) | pixels shaded (M) | passes write (MB) |
|---|---|---|---|---|---|---|
| fushimi-inari | high | 69 → 18 | 260 → 194 | 2.06 → 0.74 | 31.06 → 26.39 | 70 → 29 |
| fushimi-inari | medium | 67 → 16 | 284 → 196 | 2.06 → 0.75 | 15.24 → 10.57 | 65 → 24 |
| fushimi-inari | low | 63 → 1 | 243 → 198 | 1.90 → 0.56 | 11.44 → 6.69 | 47 → 5 |
| higashiyama | high | 69 → 18 | 323 → 235 | 2.85 → 1.33 | 31.06 → 26.39 | 70 → 29 |
| higashiyama | medium | 67 → 16 | 316 → 228 | 2.83 → 1.31 | 15.24 → 10.57 | 65 → 24 |
| higashiyama | low | 63 → 1 | 310 → 210 | 2.75 → 1.20 | 11.44 → 6.69 | 47 → 5 |
| kamakura | high | new: 66 | new: 196 | new: 0.69 | new: 27.18 | new: 40 |
| kamakura | medium | new: 64 | new: 216 | new: 0.69 | new: 11.35 | new: 36 |
| kamakura | low | new: 49 | new: 194 | new: 0.55 | new: 7.48 | new: 16 |
| kyoto | high | 69 → 18 | 373 → 279 | 2.91 → 1.78 | 31.06 → 26.39 | 70 → 29 |
| kyoto | medium | 67 → 16 | 333 → 277 | 2.83 → 1.77 | 15.24 → 10.57 | 65 → 24 |
| kyoto | low | 63 → 1 | 322 → 293 | 2.63 → 1.66 | 11.44 → 6.69 | 47 → 5 |
| queenstown | high | 69 → 66 | 610 → 555 | 3.82 → 2.77 | 31.33 → 27.44 | 70 → 40 |
| queenstown | medium | 67 → 64 | 608 → 549 | 3.78 → 2.73 | 15.50 → 11.61 | 65 → 36 |
| queenstown | low | 63 → 49 | 632 → 525 | 2.50 → 1.40 | 11.70 → 7.74 | 47 → 16 |
| shibuya | high | 69 → 18 | 415 → 360 | 7.60 → 3.50 | 31.06 → 26.39 | 70 → 29 |
| shibuya | medium | 67 → 16 | 417 → 372 | 7.61 → 3.53 | 15.24 → 10.57 | 65 → 24 |
| shibuya | low | 63 → 1 | 373 → 304 | 4.23 → 2.47 | 11.44 → 6.69 | 47 → 5 |
| shinjuku | high | 69 → 18 | 370 → 301 | 3.99 → 2.43 | 31.06 → 26.39 | 70 → 29 |
| shinjuku | medium | 67 → 16 | 356 → 310 | 3.96 → 2.46 | 15.24 → 10.57 | 65 → 24 |
| shinjuku | low | 63 → 1 | 317 → 253 | 3.69 → 2.17 | 11.44 → 6.69 | 47 → 5 |
| sydney | high | 69 → 66 | 419 → 416 | 3.19 → 2.17 | 31.33 → 27.44 | 70 → 40 |
| sydney | medium | 67 → 64 | 417 → 414 | 3.19 → 2.16 | 15.50 → 11.61 | 65 → 36 |
| sydney | low | 63 → 49 | 436 → 386 | 3.13 → 2.02 | 11.70 → 7.74 | 47 → 16 |
| tetsugaku | high | 69 → 18 | 452 → 386 | 2.91 → 1.97 | 31.06 → 26.39 | 70 → 29 |
| tetsugaku | medium | 67 → 16 | 450 → 384 | 2.90 → 1.96 | 15.24 → 10.57 | 65 → 24 |
| tetsugaku | low | 63 → 1 | 503 → 374 | 2.59 → 1.66 | 11.44 → 6.69 | 47 → 5 |
| tokyo | high | 69 → 66 | 595 → 596 | 4.35 → 2.68 | 31.33 → 27.44 | 70 → 40 |
| tokyo | medium | 67 → 64 | 593 → 586 | 4.35 → 2.66 | 15.50 → 11.61 | 65 → 36 |
| tokyo | low | 63 → 49 | 542 → 554 | 3.98 → 2.35 | 11.70 → 7.74 | 47 → 16 |

The main thread's time in the frame's callbacks was 10 to 105 ms before and 12 to 105 ms after on the software
renderer, with a run-to-run spread as large as any difference (the rasteriser's threads share the cores): it
says nothing either way here. What changed on the main thread is in "The main thread" above; a browser's
profiler on a real device is where to measure it.

Stills of the same views before and after differ only in what moves between two runs: Sydney's quay at day,
dusk and night on each tier and on a phone, the city from the air, Shibuya's scramble by day, at dusk, at
night and in the rain (the same people in the same places).

## The frame budget, second round (issue 375)

**The contact shadows reuse the frames before** (`web/game/ao.js`). The occlusion is still taken at half size from
the scene's depth, but with 6 samples on high and 4 on medium (16 and 8 before), its spiral and radii turned on each
frame (interleaved gradient noise moved by the frame, Jimenez 2014); a resolve pass then reprojects the last frame's
result with the last frame's view and projection (`uReproj`: this frame's view space to the last frame's clip space,
composed on the CPU so the shader never handles kilometre coordinates), keeps it where the distance it stored is the
distance this point had then, clamps it to this frame's 3 x 3 neighbours' mean plus or minus their spread (variance
clipping, Salvi 2016) and blends it in at 0.8 (0.48 within 6 m of the camera, rising to 0.8 by 25 m, where the
player and the walkers beside them move and a lagging contact shadow shows most). One depth-aware blur follows, not
two. A cut (a jump of 30 m or a turn of more than 45 degrees in a frame, a resize, a frame without it) starts the
history again. Per half-size pixel: 6 occlusion taps and 11 in the resolve in place of 16 occlusion taps; four
half-size passes in place of five (Shibuya on foot: 17 full-screen passes writing 26.4 MB a frame, 18 and 28.8 MB
before). `?aotaa=off` draws each frame from scratch as before.

Judged in motion with `tools/ao_film.js` (on foot with the camera swinging round, and driving your car, 30 frames a
second of game time, each saved): side by side with `?aotaa=off` and with `?ao=show` (the occlusion alone). The mean
change between consecutive frames of the occlusion alone was 2.64 of 255 with the history and 2.68 without, its 99th
percentile 12.7 and 13.7: no more shimmer, and none on the railings and kerbs. The first version (range clamp, 0.9)
left the player's own contact shadow faint and a short trail behind it; the variance clip and the lower weight near
the camera took both out. No ghost behind the car. Not judged on a real GPU's frame rate, where the history's
weight would be tuned again.

**The sea's reflection leaves out the walkers, the traffic and the street furniture** (`water.js`: objects flagged
`userData.noRefl` where they are added: the crowd and its umbrellas, the cars, benches and lamp posts, the landmarks'
street furniture). On Sydney's quay it took the reflection's second draw from 127 draws to 119; its 1.24 million
triangles are the buildings and the trees, which the water should show.

**The crowd's umbrellas are packed** (`people.js`) as the crowd is: those held this frame are the first `count`
slots, with their holder's colour, and only those slots are uploaded. Before, every walker had a slot, scaled to
nothing when not held, and the whole buffer went to the GPU every frame of rain.

**The model viewer and the title have one full-size pass after the scene** (`lens.js` `stack`, used by `city.js`
and `earth.js`): the scene into its target, the bloom's chain at half size with `bright()` as its first pass, and the
lens, which adds the bloom's sum as it reads the scene. The bloom's full-size blend and the second full-size target
are gone; `world.js` `leanComposer` and `lens.js` `tameBloom` with them. Sydney's viewer by day, at dusk and at night
and the title's Earth match main's within 1.4 and 2.4 of 255 on average (the clouds and the title's text fading in).

**One ladder, started low** (`quality.js` `rung`, `startLow`; `game.js`). Every system that sheds registers a rung:
its value with every extra, at half of them and with none. The weather (light, then off), the wet street's mirror,
the contact shadows (full, lite, off) and MSAA (the tier's, two, none) as before; now also the sun's shadow map (the
tier's, half, 1024 on a side: `world.js` `setShadowSize`, the map and the still casters' cache made again at the next
shadow pass), the sea's reflection (every frame while the camera moves, every second, none: `water.js` `reflEvery`)
and the crowd (whole, whole, three in four). A device with no record of its own starts at 0.8 of the scene's
resolution with half the extras, and tries a step up every second and a half until one does not fit; a fast device
is at its ceiling in about thirteen seconds (`governor.simulate`). The record kept per map is now the scale and the
extras (`oe3d-gov-<city>`: `0.85/0.5`), and a device that has one starts there. Under automation the governor stands
still, as before, so checks and stills start at the ceiling. `tools/game_check.js` sees the shadow map, the
reflection and the crowd move with the extras and come back.

**Not done** (left in issue 375): shadow cascades (item 2: with the far sun's field showing so little past the box,
the case for a far cascade is weaker than it looked; the 4096 map's cached depth blitted every frame is still not
measured, and the ladder now halves the map on a device that is short), and `BatchedMesh` with per-instance culling of
the props in the shadow box (item 3). Temporal anti-aliasing from the same history in place of MSAA on medium and low
(the second half of item 1) waits for jittered projection, which the history above does not yet need.

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

The reef and alpine sites build in 1.7 to 4.3 s; their wait was after "built", in three.js's WebGL backend
compiling (`_completeCompile`, 11.6 s of Lake Tekapo's load), much of it in the first frame after
`compileAsync`, and in Tekapo's detail photograph (`terrain.prepare`). On a device with WebGPU, as the
telemetry's desktop has, the backend is another one; a follow-up issue holds it.

## The build in a Worker (issue 344)

After issue 327 the build's main-thread time in a large city was mostly the buildings' geometry (4 to 7 s on
llvmpipe), the walking model's 2 m surface model and the landmarks laid on its grid (1 to 1.5 s in Kyoto and Sydney:
twenty million points sampled on their triangles), and the footways. The worker that decodes the packs
(`pack-worker.js`) now keeps its copy of `buildings.bin` and, in the game, of `landmarks.bin`, and builds from them
once the ground is final (after the inland water levels it, before the aerial imagery is draped), so the work
overlaps the page's own:

- **The walls, roofs, decks, posts and awnings** (`buildings-geo.js`, split from `buildings.js` with no three.js in
  it; the triangulation is three.js's own Earcut, imported into the worker), sent back as packed vertex arrays
  handed over. The page only makes the BufferGeometry, the facade material and the rooftop plant.
- **The game's 2 m surface model** with the building on top of each cell (`Sun.buildDSM`), on the walking ground.
- **The landmarks on the walking grid** (`game/navcells.js`, split from `nav.js`): their height intervals, tops
  and paving, as typed arrays the page turns back into `nav.js`'s Maps.

Without a Worker, or if it fails, the page builds each itself as before. `tools/build_hash.js` fingerprints the
built walls: byte-identical to main in the viewer and the game, and with `Worker` taken away; the surface model and
the landmark cells were compared cell by cell (Kyoto, Sydney, Queenstown, Fushimi Inari).

Every live city, llvmpipe, 960x600, high tier, one run each (`tools/stage_sweep.sh`; on this machine the time to
playable swings by several seconds between runs, mostly one texture upload after the build), main -> after:

| city | build, decoded -> built (s) | playable (s) |
|---|---|---|
| fushimi-inari | 3.9 -> 3.6 | 11.6 -> 13.3 (12.2, 12.7 again; main 11.6, 12.4) |
| higashiyama | 4.7 -> 4.6 | 13.4 -> 15.8 |
| kamakura | 4.4 -> 3.9 | 11.7 -> 13.2 |
| kyoto | 14.8 -> 13.0 | 35.4 -> 46.0 |
| queenstown | 8.5 -> 7.3 | 50.8 -> 22.5 |
| shibuya | 14.6 -> 12.4 | 28.7 -> 28.9 |
| shinjuku | 10.2 -> 9.9 | 49.3 -> 58.1 |
| sydney | 13.0 -> 11.3 | 38.8 -> 39.1 |
| tetsugaku | 5.2 -> 4.6 | 13.1 -> 14.3 (12.7, 13.2 again; main 13.2, 37.1) |
| tokyo | 15.7 -> 13.3 | 34.5 -> 36.4 |

The build stage is shorter everywhere, by 1.5 to 2.4 s in the large cities; the time to playable here is
dominated by the GPU's share after it, which a software renderer makes noisy. Still on the main thread: the footways
(`OERoute.walkable` and `cutAtWalls`, 2 s in Kyoto) and the collision world (1.2 s), both built from the live walking
model's queries; a follow-up issue holds them.

## The reef and alpine sites' compile (issue 343)

After issue 327 a reef or alpine site built in 2 to 4 s and then spent most of its load compiling: Lake Tekapo linked 247
WebGL programs, 117 of them in the first frames (one frame of 32 s on llvmpipe, the lake's mirror compiling on the spot),
and waited up to 19 s more for the aerial detail photograph. `tools/reef_load.js` now counts the programs linked in each
loader step. What was done, for every site:

- **The detail photograph does not hold the loader.** It is asked for as soon as the camera is placed, decoded off the
  page's thread (an ImageBitmap), at most 4096 px a side below the high tier, and fades in when it comes; stills, films
  and tools under automation still wait for it (`?detail=later` loads as a visitor). Its placeholder is in the
  photograph's colour space, so the land's programs are not made again when it comes.
- **The precompile compiles what the frames draw.** A frame's work bar the drawing runs first (the player's view, the
  land's chunks, the plants' patches, the water's tiles); then, at once and side by side, the scene into the post
  chain's own target (a program is made for its target: the canvas's was compiled again by the first frame), the lake's
  mirror as its reflector draws it (half-float, layer 0, from below the water), and the land's hidden detail patches.
- **One program where there was one per mesh.** three.js r186 puts an InstancedMesh's matrices (and a skeleton's
  bones) in a uniform array when they fit a uniform block, with the array's name and length written into the shader:
  every instanced mesh linked its own program. The reef page sets the backend's uniform-block limit to 0 for these
  (`?ubo=1`: as before), so they come as instanced attributes and a bone texture, the same code for every mesh.
- **Uniforms, not constants:** each lake's id and level (22 programs at Tekapo), and the land strips' offsets.

Stills from the same views (desktop and phone; day, dusk and night; Tekapo, Pukaki, Milford, Whitsundays) are identical
to main's pixel for pixel. Every site, llvmpipe, 1440x900, high tier, `tools/reef_load.js`, the second of two runs
(the first of each pair warms the cache), main -> after:

| site | programs (in the first frames) | ready (s) |
|---|---|---|
| whitsundays | 68 (32) -> 57 (14) | 12.7 -> 12.2 |
| hardy-reef | 59 (46) -> 56 (15) | 8.5 -> 9.6 |
| green-island | 64 (29) -> 55 (13) | 12.9 -> 11.2 |
| heron-island | 48 (35) -> 46 (13) | 7.1 -> 7.6 |
| lady-elliot-island | 45 (27) -> 42 (11) | 7.3 -> 7.4 |
| lake-pukaki | 85 (48) -> 50 (16) | 24.4 -> 15.7 |
| lake-tekapo | 247 (117) -> 49 (10) | 28.3 -> 15.8 |
| milford-sound | 67 (36) -> 53 (17) | 13.9 -> 10.7 |

On the reefs the total is within the runs' noise, but the programs the first frames compile on the spot (a frozen
frame) are a third of what they were; on the alpine sites the load is shorter by 3 to 12 s. What the first frames still
compile: the bloom chain's small passes, and what is hidden at the precompile (a character shown on the first frame).
On WebGPU (the telemetry's desktops) pipelines compile asynchronously and the per-mesh variants cost the same way; not
measurable here (#320).

## The alpine sites' frame (Milford Sound)

The owner found Milford Sound slow on a desktop with WebGPU. Where a frame went (`tools/reef_parts.js`, llvmpipe, the
view from 500 m over the head of the fiord, without the mirror and the post chain): the land's shader, two thirds of
it. What was done, for every alpine site (Tekapo, Pukaki and Milford share `alpine/terrain.js`):

- **Branches on what a fragment shows.** The land's shader computed every layer for every fragment and chose with
  `select` and `mix`: the close-up grain (five noises, wanted within 60 m), the chipseal and its lines (beyond the
  roads), the bump of the relief (sixteen hash reads and eight texture reads, wanted within 900 m), a fiord's rock
  (eight noises) on the bush and its bush on the rock. Each is now inside an `If` on its weight or its distance. The
  branches follow the picture in big coherent regions, so a GPU's threads agree and the skipped work is not paid.
  Derivatives (`fwidth`) and implicit-level texture reads stay outside them (`toVar()` puts a node on the stack where
  it is made): WGSL refuses both in non-uniform control flow, and the terrain's shadow is read at level 0 for that.
- **The crowns.** A fiord's bush was four MaterialX worley noises a fragment (27 cells each). It is now one
  2 × 2 × 2 cellular noise of two octaves that also returns the direction to the nearest point, which is the crown's
  slope, so the sunlit side needs no second pair of evaluations: about a fortieth of the work for the same picture.
- **Pixels.** The high tier drew the display's own pixels at up to 2× however large the window, so a Retina laptop at
  full screen drew 13 million pixels four samples each. It now stops at a 1440p display's pixels, as the cities' scene
  does (`reef/tier.js`).
- **The governor.** The viewer now runs `OEQuality.governor()` as the cities' game does (its form since issue 382 is in
  the next section: the scene's target scaled inside the canvas and sharpened up, under the frame-rate cap, from an
  opening budget). Stills, films and the checks keep the tier's pixels.

Frame time at equal pixels, llvmpipe, 1200 × 750, high tier (`tools/reef_cost.js`), before → after: the ship shot
1743 → 1205 ms, the aerial 2927 → 1440 ms. The base's own runs varied by a fifth between passes. Not measured: a real
GPU. `tools/reef_webgpu.js` runs the page on WebGPU here (Chromium's Dawn over lavapipe, headless) and checks that
every WGSL module compiles: 101 for Milford's game, 281 for Tekapo's, none with an error, and naga agrees. It cannot
take a still (the canvas reads back empty), so the picture is checked with `tools/reef_shot.js` on WebGL2.

## The reef and alpine sites on WebGPU (issue 382)

The telemetry's first day with frame costs named the device behind the slowest samples: an Apple M3 at a pixel
ratio of 2, tier high, on the WebGPU pages (the Whitsundays at 20 to 30 frames a second, Lake Pukaki at 12, Milford
Sound at 5) with the main thread idle. Those pages had no pixel budget, no governor and no frame cap, and the telemetry
could not see inside their frames.

### Measuring a WebGPU frame

`tools/reef_frame.js` runs a site on the WebGPU backend (Chromium's Dawn on SwiftShader here, which has
`timestamp-query`) and wraps the page's WebGPU calls from outside: each render and compute pass of one frame with the
node or file that asked for it, its target (size, formats, samples), its draws and triangles, the pixels its target
holds per sample, the bytes its attachments take, and the GPU's time inside it. `ABLATE=1` hides each thing in the
scene in turn and prints what the passes cost without it. SwiftShader is a CPU: its times compare one pass with another
and one build with another; the counts are exact.

### What it found

The scene's pass, at four samples of half-float colour and depth, was **ended and begun again six times a frame**.
The sea's refraction (`ocean.js`) reads the frame behind the water through three.js's viewport nodes, and each of its
two depth reads and its colour read, for the water's back faces and again for its front, copied the framebuffer on its
own; a copy cannot happen inside a pass, so the backend ends the pass, copies, and begins it again with `load`. On a
tile-based GPU (every Apple one, every phone) a pass that ends stores all four samples of colour and depth to memory
and one that begins loads them back: 96 bytes a pixel each time. On the M3's full-screen Retina canvas (5.9 million
pixels) that was about 3.4 GB of memory traffic a frame before anything was shaded, a third of a 100 GB/s memory's
second, which alone holds a frame near 30 ms. Each site's start at 960 x 540, high tier, the governor at its ceiling
(`tools/reef_frame.js <site> start high 2`; the counts scale with the pixels; before: main as the telemetry saw it,
b0313a6e; after: this work merged with main's lighter land shader). Pixels in targets: every pass's target, each sample
counted; bytes: what those targets hold, which a pass that is ended and begun again stores and loads:

| site | passes (over the whole frame) | pixels in targets | bytes | draws | triangles | SwiftShader GPU ms |
|---|---|---|---|---|---|---|
| Milford Sound | 49 (13) → 44 (8) | 17.0 M → 6.6 M | 185 → 67 MB | 362 | 0.95 M | 35 500 → 24 900 |
| Lake Pukaki | 49 (13) → 44 (8) | 16.9 M → 6.5 M | 184 → 65 MB | 716 | 3.6 M | 15 600 → 15 700 |
| Whitsundays | 47 (12) → 42 (7) | 15.9 M → 5.5 M | 177 → 58 MB | 196 | 1.6 M | 5 580 → 5 440 |
| Hardy Reef | 47 (12) → 42 (7) | 15.9 M → 5.5 M | 177 → 58 MB | 170 | 0.38 M | 4 920 → 4 800 |

SwiftShader's times barely move, as they should not: a CPU has no tile memory to store and reload, and the land is
shaded the same at the same pixels (runs here vary by a fifth or more under load, so Milford's drop says little; main's
land shader is measured in the section above). What the bytes save is a tile GPU's memory traffic, which only a real
device's telemetry can time; what the governor saves is pixels, which the lab holds at its ceiling.

By object (`ABLATE=1`, Milford Sound's start, after main's lighter land shader of the section above): the land is
88% of the frame's GPU time, the water and its mirror (which draws the land again) 14%, the sky and the far land 7%
each; at Lake Pukaki the land, the plants and the mirror lead. So what pays is fewer of the land's pixels, drawn once.

### What was done

- **One copy behind the water** (`reef/behind.js`): one node pair for the colour and the depth behind the water,
  copied once a render, both in the one break of the pass. The sea looks as it did (stills below).
- **The governor** (`OEQuality.governor`, the city game's, unchanged): the scene's pass is drawn at `governor.scale`
  of the canvas and the last pass brings it up with the contrast-adaptive sharpening of the game's lens (RCAS, MIT),
  so the canvas, the interface and the edges stay at the display's resolution. Its ceiling is the tier's scene
  budget (2560 x 1440 on high, the cities' own; the canvas within a 4K display's pixels), its floor half the canvas.
  Its extras are the lake's mirror at half its size again and the two ripple tiles at every second frame (third at
  0). It runs under the game's frame-rate cap (60 unless the player chose otherwise), so a 120 Hz laptop draws every
  second frame, evenly.
- **Start low, remember.** A device new to a site starts within an opening budget (1920 x 1080 of scene pixels on
  high), not at the ceiling, and is granted more as its frames allow; the scale it held is kept for its next visit
  (`localStorage` `oe3d-scale:<site>:<tier>`). The M3's first frames at Milford were its slowest.
- **The mirror while the eye is still**: redrawn every third frame (it renders the land again); every frame as soon as
  the camera moves.
- **Telemetry**: the page reports its own GPU frame (`OETelemetry.gpu`; docs/OBSERVABILITY.md), the release
  (`version.js` now loads on the reef page and finds `version.json` from its own folder) and the kind of site.

Together, on the M3 at full screen: the scene's pixels from 5.9 million (one frame before main's budget) to 2.1
million at the start, the ceiling 3.7 million, the floor 1.5 million; the memory traffic of the breaks from about 3.4 GB
a frame to 0.2 GB at the start. Main's lighter land shader (the section above) cut the shading of each of those
pixels by a third to a half on top.

The reef gametest steps the governor on every site (slow frames take the resolution down and shed the extras, fast
frames bring them back, the scene's target following each step); `tools/telemetry_check.js` checks that a reef site's
time events carry its kind and its own draws, triangles and pixels; `tools/reef_pair.sh` compares stills of two builds.
Stills of Milford Sound, Lake Pukaki, the Whitsundays and Hardy Reef at day and dusk, on a desktop (1440 x 900) and a
phone (390 x 844), match main's to the pixel (at most 0.01% of pixels differ by more than 8 of 255, on the sea); the
governor stands still at its ceiling under automation, so these are the full-resolution picture. Not checked here: a
real GPU, Safari, iOS. The owner's own play, read back from PostHog (`fps`, `gpu_ms`, `bound`, `scale` by `site`), is
the real check.

## On a phone: the memory budget (the iPhone "A problem repeatedly occurred")

Shibuya's game, opened on an iPhone in Safari, ended in the full-page "A problem repeatedly occurred": iOS had
killed the tab's WebContent process more than once. iOS kills a tab that grows past about 1-1.5 GB (less on an older
phone), and a WebGL page's textures and buffers count against it as much as its script heap does. Measured on the
phone tier (an iPhone emulated, `tools/mem_check.js`, the low tier `quality.js` gives a phone), Shibuya's game held
**865 MB** of WebGL memory and over **800 MB** of script, most of it never seen on a 390 × 844 screen.

The rule is the same one the rest of this file keeps: a phone is given a lighter set, never a broken one. A phone's
low tier is marked `lean` in `quality.js` (`city().lean`: a touch screen under 600 px, or a device that reports 4 GB
or less), and the loader (`world.js`) reads its `budget` and does less there, the picture unchanged where it can be and
gently lighter where it cannot:

- **The walls' shading lives on the GPU alone.** The buildings are one geometry of a few million vertices with eight
  attributes (position, normal, colour, the facade's two, the window pack's two, the height source). Once uploaded,
  the six the shader reads back from the GPU are let go on the main thread (`BufferAttribute.onUpload`), and so are the
  drawn cells' indices; the picking mesh keeps only what a pick reads (position, index, the building id). In Shibuya
  this is **201 → 64 MB** of script memory. A geometry held only on the GPU cannot be rebuilt after a lost context, so
  there the game reloads the view (the note in `glcare.js`) instead of restoring it in place — `Wd.gpuOnly`.
- **The ground aerial is streamed.** A city's twenty-odd 1 km aerial tiles are 6 MB each on the GPU (122 MB in
  Shibuya, 170 in Queenstown). On a phone only the `budget.groundTiles` nearest the camera keep their own picture; the
  rest show the frame's low overview, one image for them all, and swap in and out as the camera moves
  (`world.js` `groundKeep`, called from the game's `groundLod`). The street-marking overlay a tile draws when you
  stand on it (`game.js` `streetTexture`) is drawn at a coarser 0.75 m a pixel on a phone and let go when you walk away.
- **Textures are capped by the tier, decorations more.** The low tier's largest texture is 2048 on a side
  (`renderer.capabilities.maxTextureSize`), so three.js scales a larger picture down as it uploads it; the ground
  aerial and the data masks (`shore`, `woods`, read by the pixel) keep clear of it. A landmark's decorative images —
  the big LED screens, signage atlases, plaques — are drawn at most 1024 on a phone (Shibuya's `screens.webp` is 2048,
  21 MB; there 1024, 5), the picture drawn once at its own size and let go. A text sign stays legible: these are seen
  across a street, not read.

Measured on the phone tier, the game on foot with the NPCs, the helicopter and the near car and tree models all
loaded (`tools/mem_check.js <city>`; the peak GPU memory it was asked for, summed per texture, buffer and renderbuffer
as each is uploaded and freed, and the JS heap of the page and its Workers once it has settled, a collection after the
run):

| Map (phone tier) | Peak GPU, MB | Settled JS heap, MB | Peak JS heap, MB |
|---|---|---|---|
| Shibuya (before) | 865 | — | 814 |
| Shibuya | 575 | 542 | 818 |
| Tokyo (Marunouchi-Ginza) | 586 | 807 | 1192 |
| Kyoto | 618 | 668 | 981 |
| Queenstown | 606 | 499 | 600 |
| Sydney | 531 | 462 | 604 |
| Shinjuku | 498 | 430 | 574 |
| Kamakura | 366 | 208 | 274 |
| Tetsugaku | 297 | 223 | 311 |
| Higashiyama | 294 | 208 | 350 |
| Fushimi Inari | 260 | 156 | 221 |

The budget (`quality.js` `budget`, `tools/mem_check.js` defaults) is **700 MB of peak GPU memory and 880 MB of
settled heap**, just above the heaviest maps (Kyoto's GPU, Tokyo's heap). What is left on the large maps is their
own: the buildings' few million vertices on the GPU (about 175 MB in Shibuya, all eight attributes read by the
facade shader), and in the script heap the walking model's solids (`collision.js` prisms, `nav.js` fine cells and
tiles, `navcells.js` maps: about 150 MB in Tokyo) and the landmarks' meshes, which the walking model reads. Those
are the next cuts (a per-distance building LOD; a packed collision store), not done here.

`tools/check.sh` runs `tools/mem_check.js` for each live city it checks (a step in `run_city`) and fails a city whose
peak GPU memory or settled heap goes over the budget (`MEM_GPU`, `MEM_HEAP`), so a change that re-inflates a phone's
memory cannot land silently. The budget is a regression ceiling set above the heaviest live city, not a hard iOS
number — that cannot be read from Chromium. The largest maps (Kyoto, Tokyo, Shinjuku, Shibuya) sit nearest it; their
few-million-vertex building geometry is the floor, and a per-distance building LOD would be the next cut.

**Not checked here: a real iPhone or Safari.** These are emulated under Chromium with Mesa's llvmpipe; the numbers are
what WebGL was asked for and what V8's heap holds, not what iOS accounts. The owner's own play on a phone is the real
check.

### Round 2 (issue 406): what the player cannot see takes no memory

Round 1 left the large maps just under the budget, and hero levels are being added at every spawn. This round
asked where the bytes are from first principles: a heap snapshot of Tokyo on the phone tier, summed by the path
that holds each array buffer (`tools/heap_owners.js`, from `SNAP=file tools/mem_check.js`), and the sampling
profile of the page's live objects (`SAMPLE=1`). What it found and what was done:

| What | Where it was | Cut |
|---|---|---|
| The collision world's solids | an object and nested ring arrays per solid (`collision.js` prisms), about 100 MB of Tokyo's objects | a struct of typed arrays (heights, box, tag, id, a run of walls), the walls written as a solid is added |
| The collision world's walls | 72 MB in Tokyo: nine in ten solids are upright boxes (a landmark's 2 m and fine cells, a canopy's posts), four walls each with their buckets and marks | `addBox()` keeps the box alone; the queries read its four walls from it |
| The ground clip mask (`world.js` CLIP) | an RGBA canvas at half a metre kept as image data: 45 MB on the page and again on the GPU in Tokyo | one byte a texel on the GPU (R8), a bit a texel for `near()` |
| The piers' deck heights | a Float32 over the whole 2 m model (15 MB, also where a map has none) | a grid over the piers' bounds alone |
| The landmarks' nav cells (`navcells.js`) | unpacked from the worker's packed arrays into Maps of arrays, 30 MB in Tokyo | read in place: sorted keys, a binary search |
| The walls' picking copy and bounds-tree | position, index and building id kept on the page for the survey lens, and a bounds-tree built for it (3-4 s in a Worker) | the game picks from its collision world (`collision.js` `pick`, `tools/pick_check.js`: 94% of 720 rays name the same building); the picking index goes, and on a phone the positions and ids once uploaded |
| The NPCs' pictures on a phone | 1024 a side, 5.3 MB each with mipmaps, twenty-odd characters: 127 MB of Tokyo's GPU | 512 a side on the phone tier (stills at two metres show no difference); the characters you play keep theirs |

The collision world answers as it did: `tools/build_hash.js` now fingerprints it (Kyoto's identical before and
after), and a randomised comparison of every query against the old store differs only where a circle starts inside
a cluster of fine boxes and two pushes out tie (27 of 300,000), where either answer is as good. Building it is
quicker too: Kyoto's walking model (`nav:` in the console) 1257 -> 844 ms.

Every live map on the phone tier, before (main at the start of the round) and after (`tools/mem_check.js`):

| Map (phone tier) | Peak GPU, MB | Settled JS heap, MB | Peak JS heap, MB |
|---|---|---|---|
| Tokyo (Marunouchi-Ginza) | 577 -> 493 | 793 -> 569 | 1261 -> ~900 (noisy: 827-1067) |
| Kyoto | 620 -> 570 | 669 -> 437 | 960 -> 808 |
| Shibuya | 576 -> 529 | 544 -> 384 | 767 -> 695 |
| Queenstown | 607 -> 513 | 500 -> 454 | 575 -> 578 |
| Sydney | 531 -> 418 | 465 -> 374 | 641 -> 538 |
| Shinjuku | 507 -> 433 | 438 -> 319 | 554 -> 542 |
| Kamakura | 367 -> 327 | 210 -> 181 | 297 -> 289 |
| Tetsugaku | 297 -> 273 | 225 -> 190 | 349 -> 284 |
| Higashiyama | 293 -> 261 | 208 -> 165 | 340 -> 317 |
| Fushimi Inari | 263 -> 239 | 156 -> 137 | 208 -> 192 |

(Tokyo's after includes main's new Marunouchi hero level, merged during the round.) The budget is lowered to
**620 MB peak GPU and 620 MB settled heap** (`quality.js` `budget`, `tools/mem_check.js` defaults), a tenth above
the heaviest map, so the room made here is for the hero levels and cannot creep back unnoticed.

What is left, by size: the buildings' vertex buffers on the GPU (Kyoto 325 MB: 5.3 million vertices, 45 bytes
each; Kyoto has 65,738 buildings, so the building id does not fit 16 bits there; a coarser set for the far cells on
the phone tier is the cut), the ground aerial and sea textures, the surface model (`DSM` data and ids, 29 MB in
Tokyo, needed), the quays' distance fields (25 MB in Tokyo), the landmarks' fine-cell triangles kept per tile
(`nav.js` `tileTris`, 14 MB of small arrays) and the streets' carriageways (15 MB). And the load's peak heap, still
300-400 MB above the settled one on the large maps while the worker's arrays and the page's copies overlap.

### The last CPU of the city build (issue 404), measured

With the console's new `nav:` and `footways:` lines (desktop tier, llvmpipe): Kyoto's walking model 844 ms, of which
the landmarks' coarse cells and tile sort (`nav.js` `landmarkCells`) 451 ms; the footways people can walk 490 ms and
the roads cut at the walls 231 ms. Tokyo: 1756 ms, `landmarkCells` 1327 ms, footways 796 ms, roads 239 ms. The
collision world's own build is now the small part. What remains reads the whole walking model (the ground, strips,
roofs, piers, decks, landmark cells): moving it to a Worker means a second walking model there (a hundred MB more at
the load's peak, against this round's aim), so the better cut is to bake its result offline into `game.bin` with the
inputs' fingerprint and fall back to the live build when they differ. Not done in this round.

