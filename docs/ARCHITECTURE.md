# Architecture

One config per city and one build. The outputs are plain JSON and JPEG files
that three consumers read: the browser, the analyses and Blender. Nothing is
modelled by hand except the landmarks. Those are code, and their dimensions
come from published figures.

```
cities/<id>/city.json ──┐                                      ┌─► web/          title.js, city.js, sun.js
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
| Measured heights (France) | `fetch_ign.py` | `data/raw/<id>/bdtopo_batiment.json` (IGN BD TOPO buildings over WFS) and `lidar_mnh.tif`, `lidar_mnt.tif` (IGN LiDAR HD over WMS-R, float32 BIL in tiles); read by `measured.py` behind the PLATEAU interface |
| Rasters | `fetch_tiles.py` | Imagery tiles, the DEM (`dem.tif` + `dem.json`, from an ArcGIS ImageServer, an OGC WCS, an OGC WMS serving float BIL or a GeoJSON index of GeoTIFF tiles), a LiDAR surface model where the city has one (`dsm.tif`), and Terrarium tiles for the radar check |
| Measured buildings (the Netherlands) | `fetch_3dbag.py` | `data/raw/<id>/3dbag.json`: the 3DBAG's CityJSON tiles (from the release's `tile_index.fgb`) as one feature per LOD1.3 roof level, with its LiDAR top and the roof its LOD2.2 model has over it; read by `build_scene.BAG3D` behind the PLATEAU interface |
| Surveyed heights | `fetch_survey.py` | `survey.json`: a mapping agency's building blocks with surveyed top levels (Hong Kong's Lands Department) |
| People | `fetch_people.py` | `web/assets/people/`: the game's characters, animations and crowd copies (Quaternius CC0 packs) |
| Open water past the frame | `open_sea.py` | `sea.jpg`: Overture's ocean, bays, straits (and, where the city draws them, rivers and lakes) 40 km either side of the frame, for the edge haze (`web/world.js` `edgeHaze`, issue 57) |
| Base map | `fetch_world.py` | `web/data/world.json`, Natural Earth land, lakes and borders for the globe |
| Scene | `build_scene.py` | `scene.json`, `buildings.json`, `places.json`, `terrain.json`, `shore.png`, ground tiles; `cities/<id>/analysis/height_model.json` and `roof_model.json` |
| Levelled ground | `refresh_terrain.py` | Applies a city's `terrain.level` (ground a bare-earth survey got wrong: glass it saw through, a building it filtered out) to a built `terrain.json`, `game.json` (walking ground, paths, props) and the landmarks in `scene.json` without a rebuild, from the DEM alone (`fetch_tiles.py --only dem`); then `landmarks.py` and `game_extras.py` |
| Roofs and facades | `roofs.py`, `typology.py` (called by `build_scene.py`) | Per building: a facade style, storeys, colours. Per pitched solid: a roof mesh (straight skeleton). Also shopfront frontages and rooftop plant. See [BUILDINGS.md](BUILDINGS.md) |
| Landmarks | `landmarks.py` | `landmarks.json`, from the city's `landmark_meshes` hook, and any images its materials use (`landmark_assets`: a texture atlas of signs and plaques; a sheet of screen keyframes drawn with `adkit.py`); with `landmark_glows`, the light its screens throw on the street, and with `landmark_demolished`, the surveyed buildings pulled down since |
| Game | `game_data.py` | `game.json`: walking terrain, water mask, walkable surfaces, paths, wharves, ferry routes, boardwalks, wildlife, flocks and no-go areas, travel points, NPCs and quests, and what the city's `game_extras` hook places from its landmarks (lifts, spots, overheard talk) |
| Woods | `woods.py` (run by `game_data.py`) | `woods.png` and `woods` in `places.json`: in every mapped wood, forest, scrub, park, garden, cemetery and temple ground, the trees planted from an open canopy height model (Meta and WRI, CC BY 4.0) and a mask of the ground under that canopy, which the ground shader draws as a wood's floor instead of the photo's tree tops. See [Woods](#woods-and-park-canopy) below |
| Night | `night_lights.py` (run by `game_data.py`) | `night.json`: the roads simplified for the street lights and the traffic, the mapped lamps, and the city's lighting style (lamp colours, keep side, aircraft lights, crowns, sky glow). See [NIGHT.md](NIGHT.md) |

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
2c. **lidar** and **bdtopo** (cities with an `ign` block): the 95th percentile of IGN's LiDAR HD
   inside the footprint, every part measured on its own and footprints cut into
   levels where the laser sees them; **bdtopo** where the LiDAR is blank, BD TOPO's
   surveyed eaves plus the median measured roof. An OSM height far above the laser
   is a spire, not a newer building, so the laser wins.
2d. **survey** and **lidar** (cities with a `survey` or `surface_check` block, `survey.py`):
   - a mapping agency's surveyed top level. Each footprint is cut along the
     agency's building blocks, tallest first, and each block goes to the
     footprint it fits best, so a tower's block is not cut into a podium
     mapped round it;
   - the median roof of a LiDAR surface model, for footprints the survey
     covers less than half of, and for surveyed pieces the laser saw far
     lower on blocks surveyed before the flight.

   These replace the open-data heights below them.
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
  - `piers`: rings. The mapped pier polygons, and the decks Overture's water runs over
    that OpenStreetMap maps otherwise (`pipeline/shore.py` `decks`): any area tagged
    `man_made=pier` whatever its class (Hong Kong's Pier No. 3 car park), car parks,
    helipads and aprons mostly in the water and at ground level (not underground, as
    Amsterdam's garages under its canals, nor on a roof), and piers mapped as lines, as
    wide as the road down them (Tokyo's finger piers) or else a 3 m jetty. The infrastructure
    layer keeps OSM's tags (`source_tags`) and `level` for this. `pipeline/refresh_piers.py`
    rewrites them without a rebuild; `tools/stale_shore.py` lists where mapped land still
    lies under the built water, and `tools/coast_overlay.py` draws the water, the mask and
    the decks over the aerial photograph to check a coastline (issue 50).
  - `trees`: flat `[x, y, z, h]` in decimetres.
  - `woods`: the trees planted from the canopy (`pipeline/woods.py`), the same
    way, with the height the canopy model measured.
- `woods.png`: the ground under the woods' and parks' canopy at 2 m a pixel,
  from the north-west corner: `r` how much of the ground the wood's floor
  covers, `g` the canopy's height times 8 (m), `b` a footway under the trees,
  `a` inside a wood or park.
- `terrain.json`: a 10 m grid, int16 decimetres, little-endian, base64,
  starting at the north-west corner. Under the water the bottom is modelled, as
  below.
- `shore.png`: the shoreline at 2.5 m per pixel (`pipeline/shore.py`):
  - red is 128 + 2 × the signed distance to the shoreline (water positive,
    0.5 m steps, ±64 m);
  - green is sand on land, and in the water whether the nearest shore is sand;
  - blue is rock or a mapped cliff, the same way.

  There is no open bathymetry for the harbour or the river, so each water cell's
  depth is modelled from its distance to the nearest shore and a slope for that
  kind of shore, down to 4 m:
  - 0.04 off a beach;
  - 0.25 off rock;
  - 1.0 off a seawall or any other built edge.

  Every kind reaches the 4 m floor by 60 m out (`shore.py` `REACH_M`, `water.js`
  `SHORE_REACH`): a beach keeps its slope at the waterline and curves down to the
  floor, inside the ±64 m that red encodes. Beyond that the kind of the nearest
  shore no longer shows. On a straight slope the water off a beach stayed 2.5 m
  deep out across the bay, in a pale wedge for every stretch of sand (issue 39).
  Along the frame's edge haze the water closes over the bottom, which hazes out
  there while open sea above it does not. Out where the floor is reached the
  water hides the bottom altogether, as the open sea past the frame (which has
  none under it) does; letting a tenth of the aerial photo through there read
  as a straight band where the two met at the frame (issue 57).

  The first grid point out from the land is at most 0.3 m deep (a shelf), so on
  the 5 m grid the waterline falls at the quay's edge rather than up to a cell
  inland. Without it Osaka's river walk along the Dotonbori went under the water.
  The water shader uses the same slopes for how much of the bottom shows.

  Sydney's map holds 25 sand and 220 rock polygons from Overture's land cover.
  Melbourne's sand is sports fields, away from the river.

  **Quays** (`web/quays.js`, for the viewer and the game). The terrain grids
  (10 m in the viewer, 5 m round the player in the game) cannot turn a corner at
  a quay wall: between the last point on land and the first in the water the
  ground sloped up out of the water for up to a cell, draped with the aerial
  photo as a grey ramp. Along every shore `shore.png` does not mark as sand or
  rock, the browser now builds the seawall from the same map:
  - *the shoreline:* the zero of the signed distance, smoothed a little (two
    [1 2 1] passes, so the half-metre steps don't wobble a straight wall),
    traced by marching squares, chained and simplified (Douglas–Peucker,
    0.35 m), in pieces no longer than 6 m;
  - *the wall:* a face of dressed stone in courses (the `ashlar` pattern, with
    the tidal band up to the city's high water and grime in streaks above it)
    from below the modelled bottom up under a coping 0.9 m deep, 0.2 m out in
    the water from the line. The coping sits on the highest drawn ground behind
    it, so the ground never shows through it;
  - *the ground:* the grid points out in the water within 1.5 coarse cells of a
    quay (and points beside one that lie below the water, where the DEM took the
    river for land) are raised to the quay's level, so the ground meets the wall
    level; the ground shader discards it above the water from a quarter metre
    behind the shoreline out (a 2.5 m mask of the band along the quays), and the
    bottom is drawn under the cells it opens;
  - *walking:* along a quay a walker stops with the toes at the coping's edge,
    its centre 0.15 m short of the wall's face as drawn (`water()`, measured to
    the faces the walls stand on and to a landmark's own seawall, landmarks.json
    `seawalls`, rather than to the 2.5 m shoreline map, whose zero lies 0.2 m
    behind the face), not at the 5 m water mask's bank, and the walker walks on
    the raised grid (`game/nav.js`).

  The quay's level is the land behind it: the fine grid's points more than
  0.75 m in from the shore and above the water within 1.6 cells, nearer ones
  counting more, at least 0.4 m. A shore whose land is more than 9 m up (a
  hillside down to a moat) is left as it was, and so is a landmark's own
  seawall (`landmarks.json` `clip`: Bennelong Point). The city's stone is
  `water.seawall` in `city.json` (copied to `scene.json`). Sydney has 26 km of
  seawall, Amsterdam 140 km of canal walls, Osaka 33 km, Tokyo 22 km, Paris
  18 km, Melbourne 17 km, Hong Kong 16 km and the bayside 5 km. It takes 0.3–1 s
  at load. `?quays=off` leaves them out, to compare. The method is the
  standard one (marching squares on a distance field, as in d3-contour or
  scikit-image's `find_contours`); no outside code is used.
- `scene.json`: the frame, the terrain grid, the ground tiles, storey
  heights, landmark anchors, labels, sources, the published-heights summary,
  and a `city` block. That block is a copy of the config fields the viewer
  needs: tour, start, protection, labels and regions. It also has:
  - `shore`: where `shore.png` lies, and its slopes;
  - `water`: the city's wave and colour settings from `city.json`, and the
    stone of its seawalls (`seawall`);
  - `hidden_solids`: the solids a parametric landmark draws instead. Sydney
    Tower's shaft, turret and mast stay in `buildings.json`, so the surface
    model and every analysis still have the tower's shadow, but the renderers
    skip them.
- `landmarks.json`: `materials` and `meshes`. Each mesh is `{name, material,
  position, index, smooth, floodlit}`, with positions in the local frame, and
  `uv` (metres) where its material has a surface pattern. Materials are
  `{color, roughness, metalness}`, optionally with a `pattern`:
  - `chevron_tiles`: the Opera House roof;
  - `granite`: reconstituted granite, its slab joints, and on a stair the
    nosing of each tread and the shadow under it on each riser;
  - `deck_zones`: a deck in strips across its width;
  - `railing`: bars cut out of a strip.

  A material with `decal: true` is paving laid over a roof: it is drawn in
  front of the roof, and the game does not count it as a solid.

  The meshes are built with `pipeline/meshkit.py`, the landmarks' counterpart
  of the vehicles' `web/game/kit.js`: boxes, tubes, lathes, swept sections,
  panels and railings at real dimensions, one material per mesh.
- `uncertainty.json`: per-place 90% ranges by month, the buildings that shade
  each place, and the fix list. It is written by `analysis/uncertainty.js`.

## Viewer

`web/index.html` is one page with three views, in one look: the title screen's
blue-black and off-white type, the sun's amber as the one accent, and glass and
hairlines instead of boxes (`title.css` styles the title screen, the page's own
stylesheet the model and the game). three.js r186 loads as ES modules
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
  - trees (`trees.js`): the seven species of `blender/build_trees.py`, in the
    city's mix (and an area's own), instanced per species and per distance (full within 130 m,
    sparse to 520 m, a crown hull beyond), with wind in the vertex shader,
    cut-out leaf shadows, jacarandas that flower and maples that redden in season; the trees
    planted from a wood's canopy after them, sized by their measured height,
    without palms, stepping down sooner (full within 72 m, sparse to 200 m, half of them as hulls beyond), thinning out to 900 m, further from higher up (600 m and a
    third of them on a small device) where the photo's canopy takes over;
  - under a wood's canopy (`woods.png`), the ground near the camera drawn as a
    wood's floor (bare earth, leaf litter, moss, a compacted path) instead of
    the photo's tree tops, and further off the photo's canopy turned from its
    teal to the leaves' green;
  - the ground's aerial photos, with their haze taken out: the city's tiles are
    measured as they load (the darkest 2% and the mean saturation), and the
    shader takes back a share of that black level and restores some colour;
  - sky, sun and shadows. The shadow map follows the camera in whole texels
    along the sun's axes and changes size in steps, so shadow edges hold still
    as the camera moves. The sky is three.js's Preetham sky (Sky.js, MIT) with
    terms of our own: the blue hour (`twilight`), the night sky, and a golden
    hour (`uGold`) from just under the horizon to about 12° up, where the
    Preetham sky on its own is a flat grey-beige. That term keeps each pixel's
    brightness and gives it the hue a clear golden hour has: amber along the
    horizon toward the sun, blue overhead and away from it, and once the sun is
    down a peach Belt of Venus low across from it;
  - the edge haze. Over the last 250 to 500 m of the frame, everything fades into
    the fog colour, and beyond the frame there is only haze. It is three.js's fog
    chunks with the frame written in, so every fogged material takes it,
    reflections included. Within about 150 m of the camera it is held off, unless
    the camera itself is outside the model. In the game, the haze takes the sky's
    colour at the horizon (read back from the sky when the sun moves) and the
    sky's last few degrees fade into it, so the city meets the sky without a band.
    Over the sea the frame does not end: past its edge, where there is real open
    water, the water carries on to the horizon under the ordinary distance fog,
    darkening a little toward a distant sea's tone, and only over land does it
    haze out with the edge. Where the open water is comes from the city's
    `sea.jpg` (`pipeline/open_sea.py`): a land and water mask 40 km either side
    of the frame's centre at about 39 m a pixel, from Overture's base water
    theme (OpenStreetMap's coastline and water, ODbL): the ocean, bays and
    straits, less the islands in them, and for a city that draws its own rivers
    and lakes, its rivers and canals from 2 ha and its lakes and reservoirs from
    1 km² too, any water narrower than 160 m left out (a JPEG without chroma subsampling).
    Its channels are the mask blurred by 60 m, 450 m and 2.2 km; the shader
    goes from red at the frame to green 2.5 km out and blue 9 km out, so near the
    frame the sea follows the real shore (North Sydney stays land, the harbour
    runs on west to Parramatta) and far out it meets the haze over land in a
    soft gradient. Over land past the frame the haze settles from the horizon's
    tone at the frame to a distant shore's, a little darker and greener
    (`SEA_LAND`), which the distance's own fog takes back to the horizon, so an
    island or a headland out there reads as land in the haze rather than a pale
    blob. Only the water's materials take it (`OE_SEA`), and the haze makes
    the water opaque, so nothing shows through it from below. The ground's photo
    tiles are drawn only within the frame: their grid overhangs it by up to
    800 m, which lay over the open sea past it and cut it off along a straight
    line (Melbourne's bay). Until issue 57
    the edge was extruded: each point past the frame copied the shoreline at
    the frame, so the sea past it was straight bands with hard sides, sea where
    land should be, and streaks out from the corners. Before and after, from
    above and from the tour cameras toward and away from a low sun:
    `docs/images/sea-edge/*-compare.jpg` (`tools/sea_views.py` writes the views
    for `tools/city_shot.js`).

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
  - **Glitter:** where the waves are smaller than a pixel, the sun's lobe they
    average to, seen at a grazing angle, is hundreds of times a white wall
    (the 1 / 4 cos θv of the microfacet model). With a low sun over the water
    it filled a band from the horizon down as one blown slab, and the bloom
    carried it up into the sky as a column (issue 42). `oeGlitter` draws that
    lobe the way a photograph shows it: as facets, a pattern anchored to the
    water two or three pixels across (two octaves chosen by distance, so it
    holds still as the camera moves), the stronger the lobe the more of them
    lit, so the path is dense in its middle and sparkles at its fringe, with
    dark water between; two layers drifting with the wind make them twinkle.
    Where the FFT resolves the waves they make their own glints. Every glint
    rolls off from 6 toward 24, still white after the tone curve, so the
    bloom (ceiling 64) makes each a small star rather than a veil. The flat
    sheet takes the same (`patchGlitter`). The idea, a stochastic set of
    facets whose density follows the lobe, is from the glint literature
    (Jakob et al. 2014, "Discrete stochastic microfacet models"; Zirr and
    Kaplanyan 2016, "Real-time rendering of procedural multiscale
    materials"; Bruneton, Neyret and Holzschuch 2010 for the ocean's
    geometry-to-BRDF hand-over); no code is taken from them. The reef
    sites' ocean (`reef/ocean.js`) has its own Cox–Munk glitter from the
    resolved slope variance. `tools/glare_probe.js <city> --tour` checks
    every tour stop, and each stop's camera turned to a low sun, for a
    glare that blooms.
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

- **`night.js`** is the city after dark, as an aerial photograph shows it: street
  lights along every mapped road and the light they put on the ground and the lower
  floors, the traffic's head and tail lights, lit crowns and red aircraft lights on
  the towers, from `night.json`. `world.js` builds it and gives the ground, piers,
  bridge decks and walls its light map; after dark the sky turns to a designed night
  sky and the lens grades shadows blue and lights amber. See [NIGHT.md](NIGHT.md).

- **`lights.js`** is a city's nightly light show, where its config has one
  (`light_show`): searchlights from the landmarks' published tops, lasers
  between them and the floodlit landmarks cycling through colours, for a few
  minutes from the show's start time after dark. The viewer and the game share
  it.

- **`earth.js`** draws the title screen's Earth, its air and the sky, and the lens.
  By day it shows this month's Blue Marble, by night the Black Marble's lights.
  The clouds cast shadows, and the air scatters the sun (`Sun.subsolar`) by single
  scattering through a shell. The Milky Way and the Yale catalogue's stars are
  turned by the sidereal time, and bloom, a flare and the Neutral tone curve
  finish the frame.
- **`title.js`** directs the title screen: the boot and the sound gate, then a
  cold open planned on the real sky (a night pass towards the sunrise), the title
  card and the menu. A destination's beacon, reticle and card show its local time
  and sun, and the dive to it hands over to the model's loader. `score.js` is its
  synthesised sound. [TITLE.md](TITLE.md) has the details.
- **`glcare.js`** keeps a lost WebGL context from leaving a black canvas in the
  model viewer and the game (the title has its own, in `earth.js` and `title.js`).
  A phone that puts the tab away, a driver reset or memory running short takes the
  context; the frame loop then holds under a note in the loader's veil. three.js
  rebuilds its own state on `webglcontextrestored`, but every render target comes
  back empty, so `world.js` (`restoreGPU`) makes the sky's light (the PMREM
  target) and the haze again and redraws the shadow map; the post stack, the
  bloom and the water's FFT and wakes are drawn afresh each frame anyway. The
  next frames are read back, and a context that stays away 8 s, or frames that
  come back black, reload the page with the note (once a minute at most; after
  that the note offers a Reload button). The reef pages run on WebGPURenderer,
  which cannot restore a lost device, so they reload with the same note.
  `tools/tour_check.js` and `tools/game_check.js` lose the context on purpose
  (`tools/glcare_step.js`) and check the next frame is drawn and lit as before.
- **`lens.js`** is the title screen's lens as a pass: the tone curve, grade,
  flare, grain and vignette. The model viewer, the game and the city films end
  their frame on it, so every city is seen as the Earth is on the title. It also
  keeps bad pixels out of the picture. Every built-in three.js material ends in
  a guard (`guardShaders`, added to the dithering chunk) that writes no NaN and
  nothing past 1024. The bloom's bright pass drops NaN by its bits and holds a
  highlight's peak to 64 (`tameBloom`), and the lens reads its input the same
  way. On a real GPU one NaN pixel (from a zero-length normal, say) became the
  bloom's ceiling under `min()`'s IEEE minNum rule. That made a ball of blue
  light that flashed over Tokyo's palace and Kyoto's roofs as the tour moved.
  The tests use bits (`floatBitsToUint`), because a compiler's fast maths can
  fold `isnan()` away. The grain and dither use pcg3d, an integer hash (Jarzynski
  and Olano, "Hash Functions for GPU Rendering", JCGT 2020; written here from the
  paper). The old `fract(sin(x) * 43758.5)` lost its precision on GPUs at
  full-frame arguments and drew diagonal streaks across the sky.
- **`film.js`** plays a city's film (`films/<id>.mp4`, rendered from the city's
  own game by `tools/city_film.js`): a silent teaser in the destination card and
  a theatre with titles set as type from the film's cue sheet. [FILMS.md](FILMS.md)
  has the details.
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
  - gulls (`gulls.js`): a flock of silver gulls round a box of chips, which
    goes up when you walk into it (`game.flocks`);
  - rail (`rail.js`), where the city has it: street trams and a funicular on
    the rail lines OpenStreetMap maps;
  - neighbourhoods (`places.js`), where the city names them: a station sign as
    you walk into an area, things to look at up close, and conversations you
    overhear in passing;
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

## Woods and park canopy

An aerial photograph of a wood shows the tops of its trees. Draped on the terrain
and seen from the ground, that canopy turned into a lumpy teal surface (graded,
and in a wall's shade a deep blue band), and only the trees OpenStreetMap maps one
by one stood on it: in the Kyoto Gyoen a few dozen where the photo shows
thousands (issue #54). `pipeline/woods.py` fixes this for every city:

- **Where:** Overture's land (`forest`, `wood`, `scrub`, `shrubbery`) and land use
  (`park`, `garden`, `cemetery`, `grave_yard`, `religious`, `recreation_ground`,
  `village_green`, `nature_reserve`, `grass`, ...), minus buildings, water and
  roads.
- **The canopy:** Meta and the World Resources Institute's [High Resolution
  Canopy Height Maps](https://sustainability.atmeta.com/blog/2024/04/22/using-artificial-intelligence-to-map-the-earths-forests/)
  (Tolan et al. 2024, *Remote Sensing of Environment* 300; about 1 m, global,
  from Maxar imagery of 2009-2020; CC BY 4.0), read straight from its public
  bucket (`s3://dataforgood-fb-data/forests/v1/alsgedi_global_v6_float/chm/`,
  one cloud-optimised GeoTIFF per zoom-9 quadkey) and cached in
  `data/raw/<id>/chm.npz`. Where the city has an aerial photo, a pale grey patch
  wider than about 7 m (gravel, paving, a roof) is not taken as canopy, whatever
  the model says. The model underestimates the tallest trees (its paper reports
  a mean absolute error of about 2.8 m against airborne lidar), so heights run
  a little low.
- **The trees:** the canopy's local maxima, tallest first (the usual
  individual-tree detection from a canopy height model), then the rest of the
  canopy filled at random (a Poisson-disc fill), each tree kept 3.6-6.5 m from
  the others by its height, off the footways, and 3.5 m clear of the mapped
  trees. A tree in the fill is as tall as the canopy top around it.
- **The floor:** the canopy's footprint, its small gaps closed and specks
  dropped, is `woods.png`. The ground shader (`world.js` `woodsFloor`, in the
  viewer and the game) draws it as the floor the city's park trees stand on,
  in patches at the albedos they have: bare earth, leaf litter and moss (Japan,
  Hong Kong), lawn in shade worn to earth (Australia, the Netherlands), or a
  Paris garden's stabilised sand and gravel (`FLOOR` in `woods.py`, or
  `trees.floor` in `city.json`), darker under a tall canopy, with a compacted gravel and
  earth path where a mapped footway runs under the trees. Within the distance
  the trees are drawn to, and only with the camera among the trees (below
  about 60 m above the floor); from further or higher, the photo's canopy,
  turned green, which shows the undergrowth between the crowns.
- **Shadows in a park:** the photos' shadows on a park's gravel are skylight
  blue, the same teal; inside a wood or park (`woods.png`'s alpha) the shader
  takes their colour out near the camera, where the scene casts its own.

Considered and not adopted: drawing the canopy from the photo alone (its
greenness picks up lawns and misses trees in shade), and the 10 m global canopy
height of Lang et al. 2023 (ETH, CC BY 4.0), too coarse for single trees. The
species are still the city's mix of the six shared trees (`web/assets/trees/`):
no pine, zelkova or camphor yet.

