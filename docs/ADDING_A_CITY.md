# Adding a city

A city is a folder in `cities/`. The pipeline, the analyses, the viewer and the
Blender script all read the same config, so adding a city doesn't need code
changes. A city needs code only for what open data cannot know, such as a
landmark's real geometry. The checklist at the end is the bar for marking a
city live.

## 1. Pick the area and the data

Start with the data, not the skyline.

- **Footprints** come from Overture for every city. Check how many buildings
  carry an OpenStreetMap `height` or `building:levels` tag: this is the single
  biggest factor in accuracy (see the [Sydney study](cities/sydney.md)). If the
  city publishes measured heights (LiDAR roof heights, a 3D cadastre, PLATEAU,
  3D BAG), plan to bring them in as a reference table, or as a `survey`
  block (an ArcGIS feature service of building outlines with surveyed top
  levels, as Hong Kong's Lands Department publishes). A LiDAR surface model
  (`surface_check`) measures the buildings a survey misses and checks every
  roof (`analysis/lidar_heights.py`).
- **Terrain must be bare earth.** The global fallback, AWS Terrarium, is a
  surface model over many city centres. It includes the buildings, which would
  float every building and double-count its height. Look for the national or
  state DEM service first.
- **Imagery** must be an XYZ tile service whose licence allows reuse. 1 m per
  pixel or better (zoom 17 at mid latitudes) is enough for ground and roof
  colour. Many cities have none: Melbourne's aerial tiles are licensed and
  paid. Then set `imagery.type` to `synth`, and the build draws the ground from
  the vector data instead (section 2). Don't fall back on a commercial basemap
  whose terms forbid redistribution: the tiles end up in the repository.
- **An independent check** for the terrain (a LiDAR identify service) and for
  heights (a list of published tower heights with street addresses) is what
  turns a model into one you can check.

Keep the area to a few kilometres on a side. The viewer ray-casts a 2 m
surface model in the browser, and Sydney's 3.0 × 4.8 km is a comfortable size.

## 2. Write `cities/<id>/city.json`

Use a lower-case id with hyphens (`new-york`). Copy `cities/sydney/city.json`
and change it. All coordinates in the scene frame are metres east (x) and
north (y) of `origin`, with z in metres of the vertical datum.

| Field | Required | Meaning |
|---|---|---|
| `id`, `name`, `country`, `country_code` | yes | Identity; `id` matches the folder |
| `timezone`, `locale` | yes | IANA time zone (`Europe/London`) and a BCP 47 locale for zone names. Daylight saving comes from the time zone database, so no rules are needed |
| `description` | yes | One or two sentences for the title card |
| `bbox` | yes | `[west, south, east, north]` in degrees; what the fetchers download |
| `origin` | yes | `[lon, lat]` of the local frame's centre |
| `extent_m` | yes | `[x0, x1, y0, y1]` in metres: the area that is built and shipped |
| `overture_release` | yes | An Overture release, for example `2026-10-21.0` |
| `vertical_datum` | no | A label for heights, such as `m AHD` |
| `datum_offset_m` | no | For an inland city: the height of the scene's 0 m in the terrain's datum. The viewer's water plane is at 0, so set it to the river's level (Paris: 26.9, the Seine in NGF-IGN69) and every height in the scene is above the river; `load_dem` subtracts it, and the elevation checks add it back. Say where the level comes from in a `datum_note` |
| `year` | no | Year for dates in the viewer and analyses (default: this year) |
| `imagery` | yes | `{type: "xyz", url, zoom, format, attribution}`; the URL uses `{z}`, `{x}` and `{y}`. Or `{type: "synth", attribution}`: no imagery, and the ground is drawn from Overture land use, land, water, roads, footways, rail and footprints |
| `terrain` | yes | `{type: "arcgis_image", url, pixel_m, bare_earth, attribution}` for an ArcGIS ImageServer `exportImage`; `{type: "wcs", url, coverage, crs, pixel_deg, fill_below_m, fill_above_m, bare_earth, attribution}` for an OGC WCS 1.0.0 `GetCoverage` in geographic coordinates (GDA94 is converted from GDA2020, about 1.5 m); pixels below `fill_below_m` or above `fill_above_m`, and non-finite ones, are voids filled from their neighbours; `{type: "gsi_dem_png", url, zoom, fallback: {url, zoom}, bare_earth, attribution}` for GSI (Japan) elevation tiles, 5 m laser DEM with the 10 m DEM filling gaps (`holes: "sea_level"` where neither covers the sea, else the nearest cell); `{type: "wms_bil", url, layer, crs, pixel_m, bare_earth, attribution}` for an OGC WMS that serves float32 BIL in a projected CRS (IGN's LiDAR HD bare earth in Lambert-93 for France), read in tiles; `{type: "tile_index", index, url_field, crs, frame_crs, pixel_m, bare_earth, attribution}` for zipped GeoTIFF tiles in a projected CRS listed in a GeoJSON index, mosaicked at `pixel_m` (Hong Kong's LiDAR); or `{type: "terrarium"}` as a last resort. `frame_crs` is the datum the local frame's coordinates are taken in when converting to `crs` (default GDA2020, `EPSG:7844`; `EPSG:4326` elsewhere). `raise` `[{class, crest_m, slope_m, note}]` lifts the mapped outlines of an Overture infrastructure class that a bare-earth DEM flattens, such as a breakwater. Each rises from its edge to `crest_m` over `slope_m`, and the water polygon is cut back from it. The crest is a chosen height, so say so in the `note` |
| `survey` | no | Surveyed building heights: `{type: "arcgis_features", url, fields: {top, base, floors, name, name_local, kind, status, date}, keep_status, skip_kinds, absolute, attribution}`, an ArcGIS FeatureServer layer of building outlines (`pipeline/fetch_survey.py`). `absolute: true` when `top` is a level in the vertical datum rather than a height. The build cuts footprints along these blocks (`pipeline/survey.py`) |
| `surface_check` | no | A LiDAR surface model, fetched like a `tile_index` terrain: `{type, index, url_field, crs, frame_crs, pixel_m, name, flown, flown_ms}`. It measures footprints the survey misses, lowers surveyed pieces the laser saw far lower on blocks surveyed before `flown_ms`, and checks every roof (`analysis/lidar_heights.py`) |
| `terrain_check` | no | An independent elevation source for `analysis/dem_check.py`: `{type: "arcgis_identify", url, field, name}` (a raster service sampled on a grid) or `{type: "arcgis_points", url, field, name}` (surveyed spot heights from a feature layer); `{type: "gsi_dem_png", url, zoom, name}` for GSI PNG tiles (a coarser, older Japanese DEM); `{type: "gsi_elevation_api", url, name}`, GSI's elevation lookup (the 1 m laser DEM where flown); or `{type: "wms_bil", url, layer, crs, pixel_m, name}`, another DEM from a WMS (IGN's RGE ALTI against Paris's LiDAR terrain) |
| `plateau` | no | Project PLATEAU's measured building heights, from one of: `{citygml}`, a city's CityGML zip (one feature per building, with its use, storeys and the LOD1 block height where there is no survey record); `{zip}`, a city's 3D Tiles zip; or `{tiles, zoom}`, a vector-tile mirror of the LOD2 models (one feature per roof face). Both zips are read with HTTP range requests, only the parts inside the bbox. Also `attribution`; `exclude` (`[{at, radius_m}]`, footprints a parametric landmark stands for); `add_min_m2` (the smallest PLATEAU building that Overture lacks to add, default 40). With `roofs: true` and a `zip`, the LOD2 tiles are read too and each building's roof is measured from its mesh; a measured roof outranks the inferred one ([BUILDINGS.md](BUILDINGS.md#measured-roofs)). `fetch_plateau.py` writes them to `plateau.json`, and `build_scene.py` gives every footprint they cover the measured height (source `plateau`; `plateau_lod1` for a block height), cut into tiers where the roof faces differ |
| `ign` | no | France's measured buildings from IGN (Licence Ouverte), used in place of `plateau`: `{bdtopo: {layer}, lidar: {layers, pixel_m}, exclude, attribution}`. `fetch_ign.py` downloads BD TOPO buildings (eaves heights, floors, dates, use, materials) and the LiDAR HD rasters; `pipeline/measured.py` gives each footprint its LiDAR top (source `lidar`), cuts footprints whose heights fall into levels into pieces, drops open courtyards, and profiles each roof over its surveyed eaves (roof source `measured`). Where the LiDAR is blank, the eaves plus the median measured roof (source `bdtopo`) |
| `water` | no | `{classes, min_area_m2}`: Overture water classes drawn as water, less the islands mapped in them (`island`, `islet`). Also how the water looks (`web/water.js`): `waves` `{wind_ms, wind_from_deg, fetch_km, depth_m, cascades_m, choppiness}` for a typical wind over the water's longest reach; optionally `swell_m`, `swell_from_deg` and `swell_wind_ms` for an ocean swell; `colour` and `shallow_colour` (sRGB hex); `clarity_m` (how far you see into the water; under 2 m the water scatters light back and shows its `colour` from above, as a muddy river does); `shore_slopes` `{sand, rock, built}` to override the modelled bottom's depth per metre from each kind of shore (default 0.04, 0.25, 1.0). The waves and colours are chosen values, so say so in a `note`. `sea: false` for an inland city: the water plane stops at the model's edge instead of running to the horizon |
| `trees` | no | `{mix: {species: weight}}`: the species the mapped trees are drawn as, from `plane`, `elm`, `gum`, `fig`, `jacaranda` and `palm` (the shared trees of `blender/build_trees.py`). Species are rarely mapped, so the mix is a guess at the city's street and park trees; without it the default mix in `web/assets/trees/trees.json` applies |
| `storey` | no | `{res: [a, b], non: [a, b]}`: height = floors × a + b. Calibrate it against buildings that have both a surveyed height and floors |
| `architecture` | no | The rules that dress the buildings (roof-shape priors, pitches, wall palettes, window grids, shopfronts, awnings, signs): `sydney`, `japan`, `paris` or `default`. Without it the city takes its `country_code`'s rules (AU, JP, FR), else `default`. See [BUILDINGS.md](BUILDINGS.md) |
| `architecture_overrides` | no | Changes to those rules for this city, such as `{"awning": 0.5, "signage": 0.3, "machiya": true, "roofs": {"house": {"gabled": 0.7, "hipped": 0.3}}}` |
| `building_styles` | no | `{"OSM building name": "style"}` for buildings the rules would get wrong, such as a bridge pylon (`stone`) |
| `labels` | no | `{"OSM building name": "Label shown"}` |
| `minor_labels` | no | Labels drawn in the lighter style |
| `place_labels` | no | Names from `places` to label on the ground |
| `places` | no | Public places: `{name, class, protected, period, from, to}`. `name` is matched to the start of an Overture land-use name with that `class`. With `source: "land"`, the name is matched in Overture's land cover instead (a beach). With `source: "water"`, every water polygon of that name is joined and widened by `buffer_m` (a river corridor), and `label` renames it. `period` is `all`, a range `MM-DD..MM-DD`, a single day `MM-DD`, or a comma-separated list of those (`04-22,09-22`); `from` and `to` are local `HH:MM`. A protected place with a period is tested by "test a new tower" |
| `protection` | no | The rule behind the places: `{title, summary, source_note, reading_note, default_time_basis: "standard" or "clock", test_dates, tip, unprotected_label}`. `test_dates` (`[[M, D], ...]`) are the days the tower test samples; by default, the solstices and equinoxes. Set it when the rule names its own days |
| `analysis_region` | no | `[x0, x1, y0, y1]`: the dense core, used by the data-quality and radar checks |
| `sun_hours_region` | no | `[x0, x1, y0, y1]`: the area of the viewer's sun-hours map |
| `reference_heights` | no | `{file, source}`: published heights; see below. A `match_name` column in the CSV (the building's name as mapped) finds a building without a street address |
| `light_show` | no | A nightly light show (`web/lights.js`): `{name, start: "HH:MM", minutes, beams: [landmark keys], lasers: [[key, key], ...], note}`. Searchlights rise from the landmarks' published tops, lasers join them and the floodlit landmarks cycle through colours |
| `verified_heights` | no | A CSV of heights verified one by one, each with its source |
| `check_points` | no | `{name: [lon, lat]}`: points where terrain sources are compared |
| `radar_test_building` | no | The building `radar_check.py` removes to test detection (default: the largest reference correction) |
| `start` | no | `{date: [M, D], time, cam, tgt}`: the opening view |
| `tour` | no | Stops: `{title, text, date: [M, D], from, to, hold, cam, tgt}`, or `place` instead of `cam`/`tgt`, plus `provenance: true` to colour by height source. See the tokens below |
| `renders` | no | Blender views: `{name, cam, tgt, date: [Y, M, D], time}` |
| `sources` | no | Extra lines for the viewer's source list, such as `{landmarks: "..."}` |
| `game` | no | The game, if the city has one: `title`; `local_name` (what passers-by are called, such as `Melburnian`); `water_name`; `start` (`at`, `facing`); `wharves` (`id`, `name`, Overture `terminal` name); `ferries` (`route`, `stops`, `vessels`); `ferry_speed_ms`; `helipads` (`from_data: true` takes a mapped helipad, the one nearest `near` if given); `crowd` (`pedestrians`, `cars`, `radius_m`); `climate` (`mean_max_c`: the twelve monthly mean daily maximum temperatures in °C, and their `source`), which decides whether the crowd looks for sun or shade on the benches; `blurb` (the title screen's line); `boardwalks` (`name` of a mapped walkway line, or a `line` in the local frame, and `width_m`: walkable timber decks at the pier deck height); `wildlife` (a colony: `kind: "little_penguin"`, `name`, `on` (the infrastructure class it lives on), `colony_near`, `within_m`, `seaward_bearing_deg`, `count`, `show`, `height_m`, `ashore_after_sunset_min`, `leave_before_sunrise_min`, `day_ashore_share`, `viewing` (the name of its mapped viewing platform), `viewing_note`, `keep_off_note`, `note`, `source`); `travel` (`id`, `name`, `at`: fast-travel points, unlocked by visiting); `links` (`id`, `name`, `how`: neighbouring cities in the menu); `npcs` (`id`, `name`, `role`, `at`, `look`, `idle` lines); `quests` (`id`, `giver`, `title`, `stamp`, `talk` lines, optional `choices`, `steps`). A `look` names a `character` from `web/assets/people/people.json` and recolours it: `skin`, `hair`, `top`, `legs` (sRGB hex). Step types: `talk`, `ride`, `surface`, `under_bridge`, `land`, `sun`, `inspect`, `visit` (`at` and `radius`, or a `place`; with `after_dark: true` only once the sun is down) and `penguins` (`count` birds ashore within `radius`). A choice can carry an `action`: `set_time` (`date`, `time`) or `dusk` (ten minutes before today's sunset). `ferry_style` `{model, length_m, beam_m, hull, trim, upper, flag, note}` picks the shared ferry (`model`: `harbour` for the 34 m harbour ferry or `river` for the 22 m river shuttle; without it, by `length_m`), sizes it and gives it the city's livery. A wharf whose terminal name several berths share takes `near` `[x, y]`: the berth nearest it. `rail` `{tram: {class, keep, gauge_m, length_m, width_m, height_m, speed_ms, spacing_m, stop_every_m, liveries, min_length_m, note}, funicular: {class, climb: true, name, stations, gauge_m, length_m, width_m, height_m, livery, trim, speed_ms, dwell_s, car_names, note}}` runs trams and a funicular on the Overture rail lines of those classes (`web/game/rail.js`); a `rail` step `{from, to}` rides the funicular between its stations. `vehicles` picks the look of the shared vehicles: `helicopter` (`livery`, `registration`, `logo`), `ferry` (`livery`) and `cars` (`taxi`: `colours`, `share`; `bus`: `colour`, `band`; `colours` for private cars); without a ferry livery the ferries take `ferry_style`'s colours. `sky` `{clouds, cloud_density, post}` sets the game's cloud cover (0–1, default 0.3) and can turn the post stack off. `shade_landmarks` lists landmark mesh name prefixes that shade the sun meter, and `under_bridge_note` is the line shown on flying under a `fly_under` surface. NPC lines take the tour tokens, plus `{time}`, `{sun_line}`, `{share:source}`, `{sunset}`, and `{penguins_from}` and `{penguins_to}` (when tonight's first and last rafts come in). See the Sydney, Melbourne, Melbourne Bayside and Hong Kong configs and [GAME.md](GAME.md). Flavour keys: `greeting` or `smalltalk` (the crowd's lines), `player_looks`; `crowd.style`, a preset's name from `web/game/people.js` (`tokyo`, `kyoto`) or `{skin, hair, tops, legs, weights, scale, patterns, acc}` (the crowd's palette and the share wearing a pattern or an accessory); an NPC's `look` may also carry `pattern` (`leopard`, `tiger`, `kuidaore`, `pinstripe`, `plaid`) and `acc` (accessory ids, see `web/game/people.js`); see Osaka's config. |

Tour text can hold tokens that the viewer fills in from the model:

| Token | Becomes |
|---|---|
| `{buildings}` | The number of buildings |
| `{sun:Place\|M-D\|HH:MM}` | Percent of a place in direct sun at that local time |
| `{landmark:key.field}` | A value from the scene's `landmarks` block, such as `{landmark:harbour_bridge.bearing_deg}` |
| `{acc:field}` | A field of the published-heights summary, such as `{acc:median_abs_error_pct}` |
| `{share:source}` | The percent of footprint area whose height comes from that source, such as `{share:lidar}` |

Write tour text that the model can back up. If a stop quotes a number, prefer
a token, so that the number changes when the data does.

The game's helicopter and ferries are shared by every city: the models are in
`web/assets/vehicles`, built by `blender/build_vehicles.py`. Don't add models
for one city. Choose a livery, a registration and a logo in `game.vehicles`, or
improve the shared models for every city. See
[the vehicles](GAME.md#the-vehicles).

## 3. Optional: `cities/<id>/city.py`

These hooks run inside the build. Each is optional.

```python
def adjust_building(b, cls, g, geoms, ctx):
    """Called for every building. b: the Overture record; cls: its class;
    g: its footprint in the local frame; geoms: [polygon, min_height, height,
    source, part_name] per solid. Return a new geoms list, or None to keep it."""

def finalize(ctx):
    """Called once after all buildings. Fill ctx.landmarks (anchors for the
    landmark meshes and tour tokens) and ctx.labels ({name: [x, y, z]})."""

def landmark_meshes(scene):
    """Called by pipeline/landmarks.py with the built scene.json.
    Return (materials, meshes): materials {key: {color, roughness, metalness,
    pattern}}, meshes a list of meshkit.Mesh (set floodlit=True to light it after
    dark, uv=True to keep texture coordinates for a patterned material)."""
```

```python
def game_surfaces(scene):
    """Called by pipeline/game_data.py. Walkable surfaces above the terrain, such as
    a bridge deck or a flight of steps: [{name, type: "strip", origin, axis,
    half_width, profile: [[u, z], ...], thickness, mesh, fly_under, drape, label}].
    People and cars use them, and the helicopter collides with their underside.
    mesh: the landmark mesh (name prefix) the surface stands for, which the game
    walks on as the strip rather than as a solid; fly_under: a span the
    helicopter can be flown under (a quest step); drape: every footway crossing
    the surface is put onto it (steps); label: a short name for messages."""
```

The game turns each landmark mesh into one height interval per 2 m cell, so
keep parts at different heights in separate meshes. Steel inside a deck merged
with an arch above it would become a solid block between them. Give every
part that sits inside a walkable surface's slab that surface's `mesh` prefix:
Sydney's deck furniture and the steel under its deck are `bridge_deck_*`. The
game then covers them with the slab and walks on the surface.

`ctx.ground(x, y)` gives the bare-earth height. `ctx.polygons(geom)` splits
any geometry into polygons. Labels that `finalize` adds take priority in the
viewer. Build landmarks from published dimensions, and place them with anchors
measured from the data (footprint centroids, bearings), never from guesses.

`pipeline/meshkit.py` has the parts landmarks are made of:
- `box`, `tube`, `lathe` (a surface of revolution), `sweep` (a section along a
  path), `panel` (a strip for a cut-out pattern) and `rails`;
- `grid`, `quad` and `tri` for anything else.

Every part takes metres. Build the small parts too: the railings, lamps,
mullions and deck markings are what make a structure read as built, and they
cost little when each material is one mesh.

A material's `pattern` is drawn by the browser from the mesh's UVs
(`web/world.js` `PATTERNS`). Its settings sit next to it in the material:
- `chevron_tiles` with `lid_m` and `chevron_m`: a tiled shell. u counts the
  bays between ribs, and v is metres along a rib.
- `deck_zones` with `zones: [[width_m, kind], ...]`: lanes (`lanes6`,
  `lanes2`), `rail`, `cycleway`, `footway`, `barrier` and `parapet` across a
  deck. u is metres along it, and v is metres across.
- `railing` with `bar_m` and `rails_m: [bottom, top]`: bars cut out of a
  `panel`.

When a landmark replaces the solids OSM maps for it, as Sydney Tower does, keep
the solids and call `ctx.hide(solid)` on each of them (entries of `geoms`) in
`adjust_building`. The surface
model and the analyses still see their shadow. The renderers skip them
(`hidden_solids` in `scene.json`) and draw the landmark instead.

## 4. Optional: reference tables

`reference_heights.csv` has the columns `name, height_m, floors, year, address,
exclude`, and optionally `lon, lat`. `analysis/heights.py` finds each address
in Overture's address points (or takes the point, where the list gives
coordinates), matches the tallest building at it, and scores the open-data
height. A reason in `exclude` keeps a row out of the summary: use it when an
address cannot identify its building, for example two towers on one address.
Rows that match by name and are more than 40% short are corrected in the next
build, unless they are excluded.

`verified_heights.csv` has the columns `osm_id, name, floors, height_m,
source, note`. Give a height, or a floor count to multiply by the storey
height. Use it for the few buildings `analysis/uncertainty.js` ranks as moving
the answers most. Cite a source for every row.

## 5. Build and check

```bash
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  python pipeline/fetch_overture.py --city <id>
python pipeline/fetch_tiles.py --city <id>
python pipeline/fetch_survey.py --city <id>       # if there is a survey block
python pipeline/fetch_plateau.py --city <id>      # if the city has a plateau block (Japan)
python pipeline/fetch_ign.py --city <id>          # if the city has an ign block (France)
python pipeline/build_scene.py --city <id>
python pipeline/landmarks.py --city <id>
python analysis/heights.py --city <id>            # if there is a reference table
python pipeline/build_scene.py --city <id>        # applies reference corrections
python analysis/data_quality.py --city <id>
python analysis/dem_check.py --city <id>          # if there is a terrain_check
python analysis/lidar_heights.py --city <id>      # if there is a surface_check
python analysis/lidar_check.py --city <id>        # if the city has an ign block: open data against the LiDAR
node analysis/error_budget.js --city <id>
node analysis/time_basis.js --city <id>
python analysis/radar_check.py --city <id>        # unless the terrain is Terrarium
node analysis/sun_access.js --city <id>
node analysis/uncertainty.js --city <id> 40       # writes the viewer's uncertainty ranges
python blender/build_scene.py --city <id>         # if renders are configured
python pipeline/game_data.py --city <id>          # if the city has a game block
```

Then open `web/` with `python -m http.server` and go to `#<id>`.

`build_scene.py` also writes `cities/<id>/analysis/roof_model.json`. It holds the
roof shapes it built and how it chose them, and a check: every mapped roof shape
predicted by the rules alone. If the flat-or-pitched score is poor, adjust the
region's priors in `architecture_overrides`. To look at the buildings up close
from the command line, use `tools/city_shot.js`; it screenshots views that you
list in a JSON file.

## 6. Mark it live

Add or update the city in `cities/index.json` with `"status": "live"` and a
one-line `summary`, and `native` for its name in the local script if that is not
Latin (大阪). The build writes `web/data/cities.json`, which the title screen reads,
with the building count and the model's extent for the destination card. A city
with no built scene stays on the globe as planned.

## Checklist before a city goes live

- [ ] The terrain is bare earth, and `dem_check.py` (or another independent
      source) agrees to within about a metre at the median.
- [ ] `data_quality.py` has been read. You know what share of the heights are
      ML estimates, and how they compare with floor counts.
- [ ] `heights.py` has run against published heights, if any exist, and the
      gross misses are corrected or explained.
- [ ] Every number in the tour is either a token or checked by hand.
- [ ] Every rule behind `places` is cited in `protection.source_note`,
      including how it was transcribed.
- [ ] The sources and their licences show in the viewer's Data tab, and in a
      case study in `docs/cities/<id>.md`.
