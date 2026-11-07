# The look of a place: grade, neon, wet streets, crowd and sound

Shibuya's scramble is the reference: a hero shot by day, at dusk, at night and at night in the
rain, extending the title screen's lens (`web/lens.js`) rather than restyling it. What is built
here is general: every city's game takes the grade, every city with big LED screens
(`pipeline/screens.py`: Shibuya, Shinjuku, Osaka, Akihabara, Hong Kong) has their light, and any
city can key its own look in `game.look` in `cities/<id>/city.json`.

## What a browser can do now: the survey

Before building, we looked at what renders in a browser on ordinary hardware in 2026.

| Work | What it does | Licence | Here |
|---|---|---|---|
| three.js [SSRNode](https://threejs.org/docs/pages/SSRNode.html) and [SSGINode](https://app.unpkg.com/three@0.184.0/files/examples/jsm/tsl/display/SSGINode.js) (`examples/jsm/tsl/display`) | screen-space reflections and global illumination as TSL nodes, with MRT normals and temporal filtering | MIT | Not adopted: they are WebGPU node-material passes. The game renders through `WebGLRenderer` with an `EffectComposer` stack (bloom, the title's lens) and a reversed float depth buffer; moving it to `WebGPURenderer` is a separate project. SSR also misses everything off screen, and at a crossing the screens behind the camera are half of what a wet street reflects. |
| [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) | merged effect passes (SMAA, SSAO, depth of field, tone mapping) for WebGL | zlib | Not adopted: a second post stack beside three.js's own would double the passes the low tier pays for. Its ideas (merge effects into one pass, keep the HDR chain half-float) are already how `lens.js` works. |
| [realism-effects](https://www.npmjs.com/package/realism-effects) (0beqz) | SSGI, SSR, TRAA and motion blur for WebGL | MIT | Not adopted: built on pmndrs/postprocessing, and its last public release predates three.js r160; the v2 rewrite is unfinished. |
| [N8AO](https://github.com/N8python/n8ao) | fast screen-space ambient occlusion for three.js from the depth buffer alone: normals rebuilt from depth, half-resolution option, depth-aware denoise and upsample | CC0 1.0 | **Adopted** in its approach (`web/game/ao.js`, issue 138), written here rather than imported: N8AO reads ordinary and logarithmic depth but not three.js r186's reversed float depth, which the game draws with. The composer's target now resolves its depth for it on the medium and high tiers. |
| three.js [GTAOPass](https://threejs.org/docs/#examples/en/postprocessing/GTAOPass) (r186, `examples/jsm/postprocessing`) and GTAONode (TSL) | ground-truth AO (Jimenez et al. 2016) with Poisson denoise | MIT | Not adopted: the pass draws the scene again for its own depth and normals (a second pass over the whole city), and the node is WebGPU-only. Its horizon search is a better integral than a sample disc; worth a second look if the game moves to `WebGPURenderer`. |
| three.js [SAOPass](https://threejs.org/docs/#examples/en/postprocessing/SAOPass) (Scalable Ambient Obscurance, McGuire, Mara and Luebke, HPG 2012) | AO from a depth and a normal pass | MIT | Not adopted as a pass (it also draws the scene again for depth and normals); its falloff and estimator are the ones `ao.js` uses. |
| [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) SSAOEffect | SSAO with a normal pass, in its own effect stack | zlib | Not adopted, for the reason above: a second post stack, and a normal pass. |
| [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) | a progressive path tracer for three.js scenes | MIT | Not in the game: a reference renderer for checking a grade against ground truth, too slow for play. |
| three.js `RectAreaLight` with [linearly transformed cosines](https://eheitz.github.io/research_ltc/) (Heitz, Dupuy, Hill and Neubelt, SIGGRAPH 2016) | analytic area lights: the right spread, falloff and specular shape for a rectangle of light | MIT (three.js and its LTC tables) | **Adopted** (`web/neon.js`): each big screen near the camera is an area light in the colour it is playing. |
| three.js `Reflector` (planar reflection with an oblique clip plane, Lengyel) | a mirror drawn from a mirrored camera | MIT | **Adopted** in its mechanism (`web/mirror.js`): the mirrored camera and its texture matrix, sampled by the ground's own materials in the puddles, with a clipping plane in place of the oblique near plane. |
| Screen-space planar reflections (Far Cry 5's, Unity URP SSPR) | a planar reflection by scattering the frame along the mirror | various | Not adopted: it needs compute or atomics that WebGL 2 lacks. |
| Light probes (three.js `LightProbe`, irradiance volumes) | baked indirect light | MIT | Not needed yet: the scramble's indirect light at night is mostly the screens' and the shopfronts', which the area lights and the light card carry directly. |

## What was built

### The grade through the day (`web/game/atmosphere.js`)

The title's lens takes an exposure, a white balance, a saturation and a contrast keyed on the
sun's height: by day a little warmth and contrast; in the golden hour (sun at 3°) warmer; in the
blue hour (−4°) a lift and a cool balance, so the dusk sky and the first lights read together
rather than the street going grey; at night (−12°) the deepest contrast, with `uNightTone`
taking the shadows to blue and the lights to amber as before. Bloom keeps its high threshold
(6 by day, 1.6 at night), so lit walls do not bloom; only lamps, signs and screens do. A city
keys its own: `game.look.grade: {night, blue, golden, day}`, each `{ev, tint, sat, contrast}`.

### The screens light the street (`web/neon.js`)

Each LED screen's programme is followed on the CPU: the mean colour of every keyframe in its
sheet, the clip it is on, its hours and brightness, and the synchronised slot when all the
crossing's screens play together. The nearest screens, weighted by their size, drive a fixed
set of area lights (high tier 8, medium 4, low none), which fade from one screen to the next as
the camera moves. A screen lights the crowd, the cars, the asphalt and the facades across from
it, never what is behind it, and by day very little. The street's static pools of the screens'
light (`night.js`) stay for the far city and the low tier.

A square with no street lamp in it (the scramble) gets a light card after dark
(`game.look.fill`): a large area light over its middle, standing for the shopfronts,
floodlights and signs round it.

### The camera (`web/game/atmosphere.js` camFx)

Depth of field and motion blur only where a camera would show them: photo mode gets an
Aperture slider (f/1.4 to f/16, focused on the focus point, the circle of confusion of a
full-frame lens at the chosen focal length), and the opening shot of a city has a shallow focus
and the camera's motion blur as it cranes in. In play there is neither. Both read a distance
pass drawn only while they are on.

The motion blur takes 12 taps along each pixel's motion, offset per pixel by interleaved gradient
noise (Jimenez, *Next Generation Post Processing in Call of Duty: Advanced Warfare*, SIGGRAPH 2014),
so its steps dissolve into a fine grain instead of standing as copies. Its streak is held to 1.2% of
the frame. A sample further off than the pixel itself is weighted down, so a far surface doesn't
smear over a near one (the background-over-foreground rule of McGuire et al., *A Reconstruction
Filter for Plausible Motion Blur*, I3D 2012, in its simplest form). A camera that jumps more than
5% of the frame in a frame (a cut, or the first frame after a stall) draws no blur. Before issue
265 it took 8 even taps up to 3% of the frame: the arrival onto Queenstown's Skyline deck drew
each edge of the rock and the deck as a row of jagged copies.

### Steep ground (`web/world.js` STEEP_ROCK, every city)

The aerial photograph is taken from straight above, so on a face steeper than about 45 degrees
each of its pixels is drawn over 1.4 to 4 metres of slope, smeared down the fall line. There the
photograph gives way to rock, blended in between 44 and 60 degrees of slope: the photograph's own
tone, blurred to some 30 m, kept to a weathered schist's albedo, with a detail projected along the
face's three axes (triplanar mapping, so nothing stretches) and a foliation's bands. The game's
ground keeps its pavers off those faces (`oeSteep`). Near the camera, where a photo pixel is
magnified past about four screen pixels, its detail is taken towards the mean over a few of its
pixels and the sky's blue is taken out of its baked shadows: the drawn grain and pavers carry the
detail there instead of a smear of the photo's roof shadows and kerb lines.

### Wet streets (`web/mirror.js`, with the weather of #95)

When the ground is wet (`OEWeather.uniforms.uWet`, the weather's), the high tier draws the city a
second time, at half size, from the camera mirrored in the ground under it, and the ground tiles,
paving and road markings take that picture by Fresnel's law for water: clear in the puddles,
blurred and smeared down the frame on the wet film between them, wavering with the asphalt's
grain and, in the rain, with rings in the puddles. Screens, signs, lamps and headlights then
reflect as long images, as they do in a photograph of Shibuya in the rain. Below the high tier
the wet street (darker, smoother: the weather's own patch) reflects the sky and, through its
lower roughness, the screens' area lights.

### Contact shadows (`web/game/ao.js`, issue 138)

By day the facades and street corners read flat because nothing darkened where they meet. On
the medium and high tiers one pass after the scene is drawn (before the bloom) adds ambient
occlusion from the depth buffer alone, the city is not drawn a second time: at half the screen's
size each pixel's position comes from depth and its normal from its neighbours, a spiral of 16
samples (8 on the medium tier) in a disc of up to 1.8 m near the camera and a little more further
off gathers the occlusion with SAO's falloff, two depth-aware blurs take the noise out, and a
depth-aware upsample darkens the frame by it. It fades out between 160 and 420 m, so the far city
keeps the photograph's light, and is a third weaker at night, when the light is the street's own.
The low tier is untouched.

A frame-time budget (20 ms on the high tier, 25 ms on the medium) watches the frame: over it for
three seconds, AO steps down to the lite level and then off; when stepping down did not make the
frame faster, AO was not the cost and comes back. `?ao=0` turns it off, `?ao=1` keeps it whatever
the budget, `?ao=show` shows the occlusion alone; stills take `"ao"` in their views
(`tools/game_shot.js`) and `tools/ao_cost.js` measures what each level costs.

### The crowd (`web/game/game.js`, `game.crowd`)

On the medium and high tiers a city has room for its peak crowd (`pedestrians_peak`: Shibuya
1,600 walkers, drawn skinned near the camera and as instanced low-detail copies beyond); the low
tier keeps its usual number (640), so a phone draws no more people than before. How many are out
follows the hour (`hours`: the morning commute, lunch, the evening peak, the last trains),
Friday and Saturday nights (`weekend_night`) and the weekend (`weekend`; the Shibuya
Redevelopment Association counted 260,000 people a day on weekdays and 390,000 on holidays in
2014). The crowd's looks are the `tokyo` style of `web/game/people.js`; the NPCs are cast
Rocketbox avatars.

### The crossing's sound (`web/game/audio.js`, `game.look.sound`)

All synthesised, no recordings: the crowd's murmur (noise through two voice bands pulsing at a
syllable's rate) as loud as there are people round you; the screens' music, muffled across the
street, while they play (9:00 to midnight); and now and then the station's two-note chime
and an announcement too far off to make out. All of it is heard from the camera, so a film hears
what it sees. The walk signals' bird calls are no longer part of it: they play at every
signalled crossing, from the signal heads (`web/game/walkcalls.js`, [GAME.md](GAME.md), "Walk
signals' calls"), and `sound.signal` is ignored.

## Frame time by tier

Measured with `tools/scramble_shot.js` (the median of a run of frames at each view). In this
repository's checks that is Mesa's llvmpipe, a software renderer, which is only good for
comparing one build with another; a real GPU was not available to measure.

Shibuya, from the middle of the scramble at 21:00, 1440×900, median frame (ms), November 2026:

| Tier | main before | this change |
|---|---|---|
| low | 750, 750 | 700, 733 |
| medium | | 1,750 |
| high | 1,467 | 2,217 |

The low tier is unchanged or a little faster (no area lights, no mirror, the crowd thinned by the
hour). On the high tier the software renderer pays for every area light in every lit fragment
and for the larger crowd; on a GPU those are cheap, but this was not measured on one. A device
that runs slowly can drop a tier in About.

## Stills and the film

The film: `cities/shibuya/scramble_film.json`, 20 s of the scramble at dusk (17:08 to 17:13 on
30 October) under the game's own grade (`"grade": "game"`):
`xvfb-run -a node tools/city_film.js shibuya --spec cities/shibuya/scramble_film.json --out <dir>`.


`tools/scramble_shot.js` takes stills from free cameras with the world running, at the hours
and weather a views file names (`tools/views/shibuya-scramble.json`: from Hachiko, from the
middle of the scramble and from the Starbucks window over it, by day, at dusk, at night and at
night in the rain).
