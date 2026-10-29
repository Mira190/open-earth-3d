# Architecture

One config per city and one build. The outputs are plain JSON and JPEG files
that three consumers read: the browser, the analyses and Blender. Nothing is
modelled by hand except the landmarks. Those are code, and their dimensions
come from published figures.

```
cities/<id>/city.json ──┐                                      ┌─► web/          globe.js, city.js, sun.js
cities/<id>/city.py ────┤                                      │
Overture Maps (S3) ─────┼─► pipeline/fetch_*.py ─► data/raw/<id>/ ─► pipeline/build_scene.py ─► web/data/<id>/ ─┼─► analysis/     *.py, *.js
imagery, terrain ───────┘                                      ▲               │                  │
                                         analysis/heights.py ──┘               └─► pipeline/landmarks.py         └─► blender/      bpy + Cycles
```

## The local frame

Each city has a transverse Mercator centred on `origin`: x east, y north,
z up, in metres. It has no grid rotation, and its scale error over a few
kilometres is a few parts per million. Coordinates are integers in decimetres
in the shipped files.

three.js is y-up, so the viewer draws a local point `(x, y, z)` at
`(x, z, -y)`. Blender is z-up and uses the local frame as it is.

## Pipeline

| Step | Script | Output |
|---|---|---|
| Vector data | `fetch_overture.py` | Buildings, building parts, water, land, land use, infrastructure, addresses and road segments in the bbox (DuckDB, anonymous S3) |
| Measured heights | `fetch_plateau.py` (backends `plateau_citygml.py`, `plateau_3dtiles.py`, vector tiles) | `data/raw/<id>/plateau.json`: Project PLATEAU footprints with measured heights, from a city's CityGML or 3D Tiles zip (HTTP range reads of the parts inside the bbox, no full download) or a vector-tile mirror of the LOD2 roof faces |
| Rasters | `fetch_tiles.py` | Imagery tiles, the DEM (`dem.tif` + `dem.json`, from an ArcGIS ImageServer or an OGC WCS), and Terrarium tiles for the radar check |
| People | `fetch_people.py` | `web/assets/people/`: the game's characters, animations and crowd copies (Quaternius CC0 packs) |
| Base map | `fetch_world.py` | `web/data/world.json`, Natural Earth land, lakes and borders for the globe |
| Scene | `build_scene.py` | `scene.json`, `buildings.json`, `places.json`, `terrain.json`, `shore.png`, ground tiles; `cities/<id>/analysis/height_model.json` and `roof_model.json` |
| Roofs and facades | `roofs.py`, `typology.py` (called by `build_scene.py`) | Per building: a facade style, storeys, colours. Per pitched solid: a roof mesh (straight skeleton). Also shopfront frontages and rooftop plant. See [BUILDINGS.md](BUILDINGS.md) |
| Landmarks | `landmarks.py` | `landmarks.json`, from the city's `landmark_meshes` hook |
| Game | `game_data.py` | `game.json`: walking terrain, water mask, walkable surfaces, paths, wharves, ferry routes, boardwalks, wildlife and no-go areas, travel points, NPCs and quests |

`build_scene.py` also writes `web/data/cities.json` from `cities/index.json`,
and marks each city built or not.

### Ground

The ground tiles are the aerial photo, resampled into the local frame at 1 m
per pixel, where the city has openly licensed imagery. Where it has none
(Melbourne), the build draws them from the vector data instead:
- land use and land cover;
- water;
- roads with their kerbs and footpaths;
- footways, cycleways and rail;
- piers;
- footprints, with contact shading and fine noise so the surface reads at
  street level.

Roofs then get neutral colours rather than a sampled photo.

### Heights: the ladder

Each building takes the best evidence available. The source is stored with the
height, and the viewer shows it.

1. **verified**: a cited, one-by-one lookup (`verified_heights.csv`).
2. **reference**: a published height, used when the open data is more than
   40% short and the match is by name (`heights.json`).
2b. **plateau** (cities with a `plateau` block): the height Project PLATEAU measured
   from the air. It replaces an OSM height or floor count, unless OSM has the building
   more than 30% (plus 6 m) taller than the survey, which means the building is newer than
   the survey and OSM keeps it. **plateau_lod1** is PLATEAU's block height for a building
   with no survey record.
3. **mapped**: an OpenStreetMap `height`.
4. **floors**: OSM `building:levels` × the calibrated storey height, plus any
   roof height.
5. **ml**: the Microsoft ML height. Its measured bias is removed, and it is
   blended with the neighbour estimate.
6. **estimate**: the weighted median of known heights within 60 m. Neighbours
   of a similar footprint and the same building type weigh more.

Missing heights are not missing at random: mappers tag the prominent towers
first. The build measures this bias with the ML heights, which are an
independent measurement inside the unknown population, and corrects it per
band of neighbourhood height, shrunk towards no correction where data is thin.

Plausibility caps stop an estimate from turning a kiosk or an untagged
heritage building into a tower. The caps come from the known heights, not
constants.

Every estimator is cross-validated on the buildings with known heights. The
residuals go to `height_model.json`, and `uncertainty.js` resamples them.

### Files

- `buildings.json`
  - `b`: one row per building, `[name, class, top_m, floors, height_src,
    footprint_src, osm_id, wall_colour, roof_colour, open_data_top_m, style,
    storey_m, ground_floor_m, roof_material, seed, roof_shape, roof_src]`.
    The last seven are integer codes: `styles`, `roof_materials`,
    `roof_shapes` and `roof_sources` list them.
  - `s`: one row per solid, `[building, base_dm, min_dm, top_dm, ring_dm,
    ...holes_dm]`.
  - `r`: one row per solid with a pitched roof, `[solid, top_dm, eave_dm,
    shape, x0_dm, y0_dm, xyz, triangles, roof_triangles]`.
    - `xyz` is int16 little-endian, base64: `(x - x0, y - y0, z above the
      solid's base)` in decimetres.
    - `triangles` are vertex indices, base64: uint8 under 256 vertices, else
      uint16.
    - The first `roof_triangles` triangles are roof. The rest are gable
      walls and soffits.
    - The solid's walls stop at `eave_dm`. `Sun.unpackRoof` (`sun.js`)
      decodes a row.
  - `f`: shopfront edges, `[solid, edge, flags, ...]`. Flag 1 is a shopfront
    and flag 2 an awning; the edge is counted along the outer ring.
  - `p`: rooftop plant, `[solid, kind, x_dm, y_dm, w_dm, d_dm, h_dm,
    angle_cdeg]`. Kind 0 is a plant box, 1 a plant room and 2 a water tank.

  A building with OSM parts has several solids. Viewers and Blender treat a
  file without `r`, `f`, `p` or the style fields as flat-roofed and guess
  styles from class and height.
- `places.json`
  - `places`: `{name, lep, period, from, to, area_m2, polygons}`. `lep` means
    "protected by the city's rule".
  - `piers`: rings.
  - `trees`: flat `[x, y, z, h]` in decimetres.
- `terrain.json`: a 10 m grid, int16 decimetres, little-endian, base64,
  starting at the north-west corner. Under the water the bottom is modelled, as
  below.
- `shore.png`: the shoreline at 2.5 m per pixel (`pipeline/shore.py`):
  - red is 128 + 2 × the signed distance to the shoreline (water positive,
    0.5 m steps, ±64 m);
  - green is sand on land, and in the water whether the nearest shore is sand;
  - blue is rock or a mapped cliff, the same way.

  There is no open bathymetry for the harbour or the river, so each water cell's
  depth is its distance to the nearest shore times a slope for that kind of
  shore, down to 4 m:
  - 0.04 off a beach;
  - 0.25 off rock;
  - 1.0 off a seawall or any other built edge.

  The first grid point out from the land is at most 0.3 m deep (a shelf), so on
  the 5 m grid the waterline falls at the quay's edge rather than up to a cell
  inland. Without it Osaka's river walk along the Dotonbori went under the water.
  The water shader uses the same slopes for how much of the bottom shows.
  Sydney's map holds 25 sand and 220 rock polygons from Overture's land cover.
  Melbourne's sand is sports fields, away from the river.
- `scene.json`: the frame, the terrain grid, the ground tiles, storey
  heights, landmark anchors, labels, sources, the published-heights summary,
  and a `city` block. That block is a copy of the config fields the viewer
  needs: tour, start, protection, labels and regions. It also has:
  - `shore`: where `shore.png` lies, and its slopes;
  - `water`: the city's wave and colour settings from `city.json`;
  - `hidden_solids`: the solids a parametric landmark draws instead. Sydney
    Tower's shaft, turret and mast stay in `buildings.json`, so the surface
    model and every analysis still have the tower's shadow, but the renderers
    skip them.
- `landmarks.json`: `materials` and `meshes`. Each mesh is `{name, material,
  position, index, smooth, floodlit}`, with positions in the local frame, and
  `uv` (metres) where its material has a surface pattern. Materials are
  `{color, roughness, metalness}`, optionally with a `pattern`:
  - `chevron_tiles`: the Opera House roof;
  - `deck_zones`: a deck in strips across its width;
  - `railing`: bars cut out of a strip.

  The meshes are built with `pipeline/meshkit.py`, the landmarks' counterpart
  of the vehicles' `web/game/kit.js`: boxes, tubes, lathes, swept sections,
  panels and railings at real dimensions, one material per mesh.
- `uncertainty.json`: per-place 90% ranges by month, the buildings that shade
  each place, and the fix list. It is written by `analysis/uncertainty.js`.

## Viewer

`web/index.html` is one page with three views. three.js r186 loads as ES modules
through an import map (cdnjs for the core, jsDelivr for the addons and
three-mesh-bvh), and a small module exposes them as the global `THREE` the app's
scripts use. Colour management is left off: the scripts convert their sRGB
colours to linear themselves, as they did on r128. The sky keeps r128's output too:
r183 made the Sky shader's radiance linear and its sun disc far brighter, and the
environment map turned that disc into a second sun, over-lighting noon and
darkening dawn. With r128's tone curve and disc restored, a game frame differs
from r128's by 5 levels in 255 at the mean. A route script picks a view:
- `#<id>` opens a built city's 3D model;
- `#play-<id>` opens its game;
- anything else shows the globe.

The views switch in place, without reloading the page.

- **`world.js`** builds the city scene the model viewer and the game share:
  - terrain tiles under the imagery;
  - the buildings from **`buildings.js`**: walls in runs of whole bays, LOD2
    roofs with eaves, parapets, awnings and instanced rooftop plant, in one
    mesh. Its facade shader draws floors, windows, curtain walls,
    shopfronts, glass with a room behind it, lights by the local hour, and
    the height-source colours ([BUILDINGS.md](BUILDINGS.md));
  - landmarks with their surface patterns, piers and water;
  - trees (`trees.js`): the six species of `blender/build_trees.py`, in the
    city's mix, instanced per species and per distance (full within 130 m,
    sparse to 520 m, a crown hull beyond), with wind in the vertex shader,
    cut-out leaf shadows and jacarandas that flower in season;
  - sky, sun and shadows;
  - the edge haze. Over the last 250 to 500 m of the frame, everything fades into
    the fog colour, and beyond the frame there is only haze. It is three.js's fog
    chunks with the frame written in, so every fogged material takes it,
    reflections included. Within about 150 m of the camera it is held off, unless
    the camera itself is outside the model.

  Each building gets one of 13 facade styles from `typology.py` (terrace,
  machiya, curtain wall, ribbon office and others), with its storeys, a
  ground floor and shopfronts on the edges that face a street. Patterns fade
  to their average colour where a storey covers only a few pixels, and every
  hash is keyed by integer bay, storey and building id, so distant facades
  neither shimmer nor speckle. Flat roofs sit behind a parapet and coping;
  pitched roofs come as meshes in `buildings.json` `r`, carved inside the
  building's stated height, so the outline keeps it.

- **`water.js`** is the sea and the river for every city, after Tidewater
  (github.com/dgreenheck/tidewater, MIT), ported from WebGPU compute to WebGL2:
  - **Spectrum:** JONSWAP with the Horvath directional spread and the TMA depth
    correction. It is seeded on the CPU from the city's wind speed, wind
    direction, fetch and depth (`city.json` `water.waves`).
  - **Waves:** three FFT cascades, 256² (128² on a software renderer or a
    small screen). Each frame and cascade runs one pass that evolves the
    spectrum into four packed complex fields, 2 × log₂N Stockham inverse-FFT
    passes, and one pass that writes displacement, slopes and foam. Foam is
    made where the surface compresses and decays over time.
  - **Check:** a single wave mode comes back from the GPU as A·cos(k·x − ωt)
    to within 0.3 mm, so the FFT's orientation, direction of travel and
    dispersion are right.
  - **Surface:** a polar grid that follows the camera, each cascade faded
    where the grid is too coarse for it, and the heights calmed within 14 m of
    the shore so the water never climbs the land.
  - **Shading:** the scene's own lights on a physical material (ior 1.33):
    sun glints, the sky, unresolved slope as roughness (Cox–Munk), and a
    half-resolution planar reflection of the city, broken up by the ripples
    (off on software renderers and small screens). The output is
    premultiplied: the reflection adds on top, and the bottom shows through
    what the water column and the surface's reflection leave.
  - **Shore:** foam by the kind of shore and the size of the waves:
    - a faint broken lap against a seawall;
    - splash off rock;
    - swash lines running in on a beach.

    The ground gets a wet band at the waterline and the swash on sand.
    `?water=flat` restores the old flat sheet, which is also the fallback
    where the GPU cannot render to float targets.
  - **Wakes:** a foam field round the camera, 1 m a texel at street level and
    wider from the air. Each frame an orthographic camera looking straight down
    draws everything on the wake layer (layer 5) into it: the ferries' wake
    ribbons, the foam round their hulls and the helicopter's downwash rings.
    The surface samples it at each point's rest position and turns it into
    lacy, churned foam that rides the waves.
  - **Turbid water:** where `clarity_m` is under 2 m the water column scatters
    light back, so a muddy river shows the colour picked from its aerial photo
    instead of reading black from above.

  Sydney's settings (a 5 m/s north-easterly over 4 km) give a significant wave
  height of 0.19 m, close to the fetch-limited estimate of 0.16 m. The Yarra's
  (4 m/s over 0.5 km) give 0.05 m.

  `setSun()` lights the scene for any sun position.

- **`globe.js`** draws the Natural Earth map onto an equirectangular canvas.
  It textures a sphere with it and shades day and night from the subsolar
  point (`Sun.subsolar`). City markers are HTML buttons projected onto the
  sphere and hidden on the far side. Each live city shows its local time and
  sun altitude.
- **`city.js`** is the model viewer. It drives everything city-specific from
  `scene.city`. Picking a building goes through a bounding-volume hierarchy
  (three-mesh-bvh) over the extruded buildings. One ray against Sydney's 178,683
  building triangles takes 0.04 ms instead of 13 ms. It also builds a 2 m
  surface model for ray casting, so the panel's numbers do not depend on the
  shadow map's resolution.
- **`cine.js`** holds the camera moves the viewer and the game share. A shot maps
  progress (0 to 1) to a camera pose, as a spiral round a centre that may move. The
  director plays one shot at a time and fires its cues; a skipped shot still fires
  them. The moves are:
  - the viewer's flyover, from above the model onto the first tour stop;
  - the game's start, fast travel and trig-station surveys.
- **`sun.js`** works in the browser and in Node, so the viewer and the
  analyses share it:
  - solar position (the NOAA equations);
  - local time for any IANA time zone, via `Intl`;
  - the surface model (`buildDSM`, with building ids for shade attribution).
    Solids with a pitched roof rise to their eaves and then follow the roof's
    triangles (`roofs(B)` once per city);
  - ray casting (`castRay`, `sunlit`, `blocker`, `fractionSunlit`, `litMask`).

  Ray casting skips empty space with 8-cell block maxima.

- **`sun-gpu.js`** is the same ray caster as a WebGL2 fragment shader. Each
  output pixel is one ground point, and it counts the sun positions that point
  sees. The surface model and the block maxima are float textures, so the result
  matches `sun.js` ray for ray: 87,000 of 87,000 test rays agree. The viewer uses
  it for the sun-hours map, with 2 m cells every 10 minutes, against 8 m every 20
  minutes on the CPU. A software renderer (SwiftShader, llvmpipe) is slower than
  `sun.js`, so it gets the CPU path, as does any GPU whose texture limit is
  smaller than the surface model.

- **`game/`** is the game; [GAME.md](GAME.md) describes it:
  - navigation;
  - people (`people.js`): skinned characters near the player, instanced crowd
    copies further away, all recoloured from one palette per character;
  - crowd and traffic (`actors.js`): walkers who step aside for each other and
    sit on benches in the sun or the shade, and the shared Blender cars, taxis
    and buses of `web/assets/vehicles/cars.glb` on the left, one instanced mesh
    per model and distance, with a tone shader that paints each car and lights
    its lamps after dark (box cars where the models can't be loaded);
  - helicopter and ferries (`vehicles.js`): the shared Blender models in the
    city's liveries, the harbour ferry or the river shuttle as `ferry_style`
    asks, with stand-ins built from `kit.js`, a kit of parts at real
    dimensions, where the models can't be loaded;
  - sky and light (`atmosphere.js`): clouds, the stars and the moon in their
    real places, and the post stack (three.js's EffectComposer: HDR bloom,
    the output tone curve, a grade and a vignette);
  - wildlife (`penguins.js`): a colony of little penguins in one instanced
    mesh. They are out at sea by day, come ashore in rafts after the real
    sunset and walk to burrows on the mapped rocks (`game.wildlife`);
  - HUD;
  - sound.

### "Test a new tower"

The test follows the wording of a typical sun-access rule. A place fails if
its **total shadow**, shaded area × time across its protected hours, goes up.
The check runs on the solstice and equinox dates that fall in each place's
period, every 15 minutes. The tower replaces the buildings whose footprint
centre lies on its site, so a redevelopment can also remove shadow.

Each result is re-run on four height-error scenarios drawn from the measured
errors. The protected times can be read as standard time or clock time; the
city's `protection.default_time_basis` sets the default.

## Analyses

All analyses take `--city <id>` and write `cities/<id>/analysis/<name>.json`.

| Script | Question |
|---|---|
| `heights.py` | How far are the open-data heights from published ones? |
| `data_quality.py` | How good are the ML heights, and is the global terrain bare earth? |
| `dem_check.py` | Does the terrain agree with an independent elevation service? |
| `radar_check.py` | Does the building mass agree with the radar surface the terrain was rejected for? |
| `sun_access.js` | How much sun does each place get on the 21st of each month? |
| `error_budget.js` | Are the numerical choices (sample spacing, cell size, time step) and the model edge negligible? |
| `uncertainty.js` | What range of answers do the height errors allow? Which buildings shade each place? Which heights are worth verifying? |
| `time_basis.js` | How much does reading a rule's times as standard or clock time change the answer? |

## Blender

`blender/build_scene.py` imports `bpy` and reads the same `web/data/<id>`
files. It builds the same scene:
- terrain tiles with the imagery;
- the buildings from `blender/buildings.py`: the same walls, roofs, parapets,
  awnings and plant, with a node facade shader (windows by floor and bay, lit
  at night);
- trees, piers and landmarks, with the same geometry as the browser (the
  surface patterns are the browser's only);
- a water plane, 10 cm above sea level so that it does not share a plane with
  the shore cells.

It skips `hidden_solids`, and draws a tower that OSM maps twice only once, since
Cycles shades coincident faces black.

It lights the scene with a sun lamp placed by the same NOAA equations, in the
city's time zone, and a physical sky. It renders each view in `city.json`
`renders` with Cycles, and writes `render_log.json` with timings and counts.

Two more scripts build what every city shares, from code, with no stock assets:
- `blender/build_vehicles.py`: the helicopter, the harbour ferry, the river
  shuttle and the traffic (sedan, taxi, hatchback, SUV, van and bus), with
  ambient occlusion baked in Cycles and decimated copies for distance, into
  `web/assets/vehicles/` with a manifest, `vehicles.json`.
- `blender/build_trees.py`: six tree species grown from points in their crown
  shapes, with a leaf atlas it draws itself, in three levels of detail, into
  `web/assets/trees/` with `trees.json`.
