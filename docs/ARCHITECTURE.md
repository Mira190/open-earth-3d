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
| Rasters | `fetch_tiles.py` | Imagery tiles, the DEM (`dem.tif` + `dem.json`, from an ArcGIS ImageServer or an OGC WCS), and Terrarium tiles for the radar check |
| People | `fetch_people.py` | `web/assets/people/`: the game's characters, animations and crowd copies (Quaternius CC0 packs) |
| Base map | `fetch_world.py` | `web/data/world.json`, Natural Earth land, lakes and borders for the globe |
| Scene | `build_scene.py` | `scene.json`, `buildings.json`, `places.json`, `terrain.json`, ground tiles; `cities/<id>/analysis/height_model.json` |
| Landmarks | `landmarks.py` | `landmarks.json`, from the city's `landmark_meshes` hook |
| Game | `game_data.py` | `game.json`: walking terrain, water mask, walkable surfaces, paths, wharves, ferry routes, NPCs and quests |

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
    footprint_src, osm_id, wall_colour, roof_colour, open_data_top_m]`.
  - `s`: one row per solid, `[building, base_dm, min_dm, top_dm, ring_dm,
    ...holes_dm]`.

  A building with OSM parts has several solids.
- `places.json`
  - `places`: `{name, lep, period, from, to, area_m2, polygons}`. `lep` means
    "protected by the city's rule".
  - `piers`: rings.
  - `trees`: flat `[x, y, z, h]` in decimetres.
- `terrain.json`: a 10 m grid, int16 decimetres, little-endian, base64,
  starting at the north-west corner.
- `scene.json`: the frame, the terrain grid, the ground tiles, storey
  heights, landmark anchors, labels, sources, the published-heights summary,
  and a `city` block. That block is a copy of the config fields the viewer
  needs: tour, start, protection, labels and regions.
- `landmarks.json`: `materials` and `meshes`. Each mesh is `{name, material,
  position, index, smooth, floodlit}`, with positions in the local frame.
- `uncertainty.json`: per-place 90% ranges by month, the buildings that shade
  each place, and the fix list. It is written by `analysis/uncertainty.js`.

## Viewer

`web/index.html` is one page with three views. A route script picks one:
- `#<id>` opens a built city's 3D model;
- `#play-<id>` opens its game;
- anything else shows the globe.

The views switch in place, without reloading the page.

- **`world.js`** builds the city scene the model viewer and the game share:
  - terrain tiles under the imagery;
  - extruded buildings, with a facade shader for windows, lit windows at night
    and the height-source colours;
  - landmarks, trees, piers and water;
  - sky, sun and shadows.

  `setSun()` lights the scene for any sun position.

- **`globe.js`** draws the Natural Earth map onto an equirectangular canvas.
  It textures a sphere with it and shades day and night from the subsolar
  point (`Sun.subsolar`). City markers are HTML buttons projected onto the
  sphere and hidden on the far side. Each live city shows its local time and
  sun altitude.
- **`city.js`** is the model viewer. It drives everything city-specific from
  `scene.city`. It also builds a 2 m
  surface model for ray casting, so the panel's numbers do not depend on the
  shadow map's resolution.
- **`sun.js`** works in the browser and in Node, so the viewer and the
  analyses share it:
  - solar position (the NOAA equations);
  - local time for any IANA time zone, via `Intl`;
  - the surface model (`buildDSM`, with building ids for shade attribution);
  - ray casting (`castRay`, `sunlit`, `blocker`, `fractionSunlit`, `litMask`).

  Ray casting skips empty space with 8-cell block maxima.

- **`game/`** is the game; [GAME.md](GAME.md) describes it:
  - navigation;
  - people (`people.js`): skinned characters near the player, instanced crowd
    copies further away, all recoloured from one palette per character;
  - crowd and traffic (`actors.js`): walkers who step aside for each other and
    sit on benches in the sun or the shade, and cars on the left;
  - helicopter and ferries;
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
- one building mesh with face-corner colours;
- trees, piers and landmarks;
- a water plane.

It lights the scene with a sun lamp placed by the same NOAA equations, in the
city's time zone, and a physical sky. It renders each view in `city.json`
`renders` with Cycles, and writes `render_log.json` with timings and counts.
