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
