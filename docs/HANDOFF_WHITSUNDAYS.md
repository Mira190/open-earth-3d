# Handoff: Whitsundays and the Great Barrier Reef

Branch `claude/laughing-mccarthy-fxznj8` (pushed). A marine world, separate from the city viewer: `web/reef/`,
three.js r186 (vendored in `web/vendor/three`), WebGPU with automatic WebGL2 fallback, all materials in TSL.
**The water is the hard part and the part most worth a stronger model.** Read "Water: what is real and what is a hack" first.

## Run it
```bash
cd web && python3 -m http.server 8800
# http://localhost:8800/reef/index.html?city=whitsundays      (WASD + drag; player module spawns on Whitehaven)
# headless: NODE_PATH=$(npm root -g) node tools/reef_shot.js "still=1&gl=1&freeze=5&x=900&y=450&z=-2&pitch=-14&yaw=70" out.png
```
Query: `gl=1` force WebGL2, `still=1` two frames then stop, `freeze=<s>` fixed wave clock, `time=<ISO>` sun/moon, `exp`, `wind` 0..1,
`tide` m, `mods=` comma list (default `life,boats,player,game`), `post=0`. Coordinates: x east, y north, z up (z<0 under water);
yaw 90 looks west. **WebGPU cannot be tested in the sandbox** (SwiftShader loses the device); everything was verified on software
WebGL2 only. First job on a machine with a GPU: open it in Chrome and check the WebGPU path (TSL `Loop`, `select`, `.level(0)` in vertex stage).

## Data pipeline (`pipeline/`, config in `cities/whitsundays/city.json`)
1. `fetch_gbr_bathy.py` AusSeabed GBR 30 m (zip of 4 COGs, each deflated whole: streams ~780 MB, crops). Includes land elevation.
2. `fetch_sentinel.py` Sentinel-2 L2A from Earth Search, 28 scenes, per pixel the darkest 60% in NIR (glint/cloud), median. Cached stack in `data/raw`.
3. `fetch_overture.py` (existing) water/land/buildings: fetched but **not yet used** by the marine build.
4. `build_marine.py` writes `web/data/<id>/`: `terrain.bin` (int16 dm, 30 m), `ground.jpg` (10 m), `habitat.png`, `scene.json`; `cities/<id>/analysis/optics.json`.
   - Inverts the water column (Maritorena 1994) to get the sea floor's own colour. Rinf is a smoothed local map of deep water; Kd per band fitted on sand vs depth.
   - Measured: Kd blue 0.054, green 0.080 /m. Red fit (0.19) is unreliable, so **0.40 (pure-water a_w(665 nm)) is used as a floor**. Sand-brightness depth spread: blue 103% raw to 43% inverted, green 136% to 29%. Not solved, only reduced.
   - Habitat classes are **inferred** from floor colour + depth (thresholds in the script), not surveyed. Allen Coral Atlas would be the right source (site reachable, API not tried).
   - Land colour gain 1.6; deep floor beyond ~25 m is filled with smoothed colour (invisible anyway).
5. `hardy-reef` (outer reef, Heart Reef, 70 km off) is configured in `cities/hardy-reef/`; raw bathymetry and Sentinel-2 are downloaded in `data/raw/hardy-reef` (git-ignored) but **`build_marine.py --city hardy-reef` has not been run** and the viewer has no start view/POIs for it.

## Viewer files (`web/reef/`)
| File | Role |
|---|---|
| `main.js` | renderer, scene, modules via `ctx` (`init(ctx)` returns `{update}`), fly camera, `?still` test mode |
| `env.js` | wave bank (3 bands), sky/moon/stars, **`medium()` = water column, installed as `scene.fogNode`**, `caustic()`, sun from `window.Sun` |
| `ocean.js` | radial mesh around camera, Gerstner displacement, foam from compression + shore, Snell's window from below |
| `world.js` | 30 m terrain chunks with LOD + skirts, height half-float texture, habitat lookup |
| `shore.js` | 2 m detail patch (bicubic + dunes), sand ripple normals, wet sand |
| `post.js` | bloom, underwater light shafts (14-step march), vignette |
| `boats.js` + `boats/` | merged from `claude/reef-boats`: vessels, buoyancy, wake, AI traffic, drivable boats/aircraft |
| `player.js` `people.js` `looks.js` `gear.js` `dive.js` `hud.js` `fx.js` | merged from `claude/reef-player`: Quaternius people on r186, snorkel/freedive/scuba with dive tables, HUD, `?autotest=1` (35 pass) |
| `life.js` | **not merged**: corals, fish, turtles, trees, plankton. Agent `a060886d9f1a6916b` was still running at handoff; its branch will be a `worktree-agent-a060886d9f1a6916b` or similar; check `git branch -r` |
| `game.js` | **not written**: NPCs, quests, dialogue (see below) |

## Water: what is real and what is a hack
Real (physically derived, keep):
- Seen-through-water floor: `R = A e^(-K(Lw+m z)) + Rinf(1-e^(-K(Lw+m z)))`, same formula the build inverts, so the surface view should reproduce the satellite. `m` = sun slant after Snell (n 1.34). Veil is the closed-form single-scatter integral (`env.js` medium).
- Caustics = 1/|det(I - 0.25 D H)| from the Hessian of the same wave bank, sun-direction shifted, fading with depth (`env.caustic`).
- Foam from the Jacobian of the Gerstner horizontal displacement; Fresnel; Snell's window and TIR from below.

Hacks / known weak spots (where to spend effort):
1. **Underwater veil boost 3.6x and an eye-adaptation 2.4x** in `medium()`: tuned by eye so horizontal views are not black. Needs a proper radiance-distribution model (radiance ~ nadir x ~2 sideways, x n^2 under the surface).
2. **No refraction**: the floor seen through the surface is not displaced by waves; only caustics carry the wave signal. A screen-space refraction pass would fix it; careful with the depth-based medium.
3. **Wave count is small (33 sines), not FFT.** Tidewater's idea (3-band cascaded FFT + Gerstner swell) needs WebGPU compute; keep the sine bank as the WebGL2 fallback. Radial ring mesh shows moire at distance; per-wave fade helps, not solved.
4. **Foam has no memory** (no persistence/advection); shore foam is analytic bands on the swash, not a simulation. The boats' wake foam is a separate texture (`boats/wake.js`; hooked by wrapping ocean materials, see its header; a native hook in `ocean.js` is cleaner).
5. **Tide**: `env.u.tide` is a manual uniform (default 0). Whitsunday tides are ~3-4 m spring range and Hill Inlet's swirl depends on it. No tide model yet (needs verified constituents for Shute Harbour / Hamilton; do not invent).
6. **30 m terrain** limits shorelines; `shore.js` fakes detail near the camera. The water's depth lookup uses the coarse texture, so water edge and detail sand can disagree by tens of cm.
7. Kd is **one scene-wide value**; the sea is clearer offshore (Rinf varies, Kd does not). Sentinel-2 vertical seam at the MGRS tile overlap is reduced but visible in `ground.jpg`.
8. Ripple/glitter aliasing at range; sun glitter uses a huge power term. Night is very dark (moon only brightens the hemisphere light).
9. Habitat map -> coral placement depends on thresholds that were not validated.

## Remaining plan
1. Merge `life.js` branch; check `?mods=life` frame time and that corals look right under the water column (red is gone below ~5 m; colours rely on blue/teal/yellow).
2. `game.js`: NPCs near spawn (skipper, ranger, Ngaro Elder, dive instructor), quest journal. Player API: `ctx.spawnPerson(role, {x, north, heading})`, `ctx.player.addInteractable({x, north, radius, label, action})`, `ctx.hud.say/prompt`, `ctx.player.onChange`, `life.nearestCreature` / `life.species` for a fish-ID survey. Lines should be **computed from the model** (e.g. share of red left at 8 m from `env.u.K` and `lightPath`).
   Verified facts only (Wikipedia, fetched): 74 continental islands; Whitsunday Island 109 km2; Cook named the passage 3 June 1770; Ngaro and Gia are the Traditional Owners ("canoe people"); Whitehaven 7 km, 98% silica, stays cool underfoot; GBR 2,300 km, 2,900 reefs, ~400 coral species, 1,500+ fish species, six turtle species; mass bleaching 1998, 2002, 2006, 2016, 2017, 2020, 2022; inner reefs spawn the week after the October full moon (late Oct 2026 is that week). Stinger season Oct to May is from general knowledge, not yet cited. **Anything about Ngaro history beyond that needs a Traditional Owner or a primary source; do not invent quotes or ceremony.**
3. Build `hardy-reef` (add `start`, pontoon site, Heart Reef) and give the globe a second marker.
4. Check on WebGPU; add `docs/cities/whitsundays.md` (method, optics.json numbers, checks), README row + screenshots in `docs/images/reef/`.
5. Performance pass: draw calls (terrain chunks), per-frame allocations, mobile.

## Repo notes
- Shared files touched: `web/globe.js` (opens `c.viewer` pages), `cities/index.json` and `web/data/cities.json` (whitsundays entry). `.gitignore` ignores `.claude/worktrees/`.
- `web/vendor/three/` is three r186 + a few addons; extend with files from `npm i three@0.186.1`.
- Commits end with the Co-Authored-By / Claude-Session lines the harness asks for.
