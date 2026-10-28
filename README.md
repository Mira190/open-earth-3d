# Open Earth 3D

**The Earth in 3D, city by city, from open data and the real sun.**

Open Earth 3D rebuilds real cities in 3D from open data. Buildings and their
heights come from OpenStreetMap and Overture Maps. They stand on bare-earth
terrain under aerial imagery, and the sun is computed for any date and time.
Every building's height carries its source and a measured error, and every
shadow comes from ray casting rather than a render. The result is a model you
can check, as well as look at.

It started with Sydney, as an answer to the "Opus 5.5 + Blender made a 3D
Sydney" demos: the same city, rebuilt so that it can be checked. It grows from
there one city at a time. Each new city is a config file and a few checks, not
a new codebase.

![The globe landing page: live and planned cities, with today's day and night](docs/images/globe.jpg)

| Sydney in the browser | Height sources | Testing a tower against the planning rule |
|---|---|---|
| ![](docs/images/sydney/screenshot-overview.jpg) | ![](docs/images/sydney/screenshot-provenance.jpg) | ![](docs/images/sydney/screenshot-tower.jpg) |

![Cycles render of Sydney from the Blender script](docs/images/sydney/overview.jpg)

## Play it: Sydney on Foot

The model is also a game. You walk central Sydney as a surveyor, talk to the
people who know it, ride the Cross Harbour ferry, walk up onto the Harbour
Bridge with the traffic, fly a helicopter under its deck, and find a sunny spot
in Martin Place on the winter solstice. Everything the characters tell you is
computed from the model as you play. Open **Play** on the globe, or go to
`#play-sydney`. [docs/GAME.md](docs/GAME.md) covers:
- the controls;
- what we took from Flight Simulator, Sketchbook, GTA, Ship Simulator and the
  Discovery Tour;
- where this game does better than they do.

| Under the Harbour Bridge | The Cross Harbour ferry | Talking to the Opera House guide |
|---|---|---|
| ![](docs/images/sydney/game-heli.jpg) | ![](docs/images/sydney/game-ferry.jpg) | ![](docs/images/sydney/game-dialogue.jpg) |

## Cities

| City | Status | What's in it |
|---|---|---|
| **Sydney**, Australia | **Live** | 7,962 buildings and 6,096 trees across 3.0 × 4.8 km. The Opera House and Harbour Bridge are built to their published geometry. Sun access is tested on the public places protected by Sydney LEP 2012 cl. 6.18. Heights are checked against 35 published towers (median error 4.5%). [Case study](docs/cities/sydney.md) |
| **Kyoto**, Japan | **Live** | 68,431 buildings across 3.0 × 5.0 km, 94% of the footprint area with a height measured from the air by Project PLATEAU. GSI laser terrain and aerial photographs. A game with Kyoto people, some in town from Tokyo. [Case study](docs/cities/kyoto.md) |
| Melbourne, Australia | Planned | ELVIS LiDAR; City of Melbourne open 3D massing |
| New York, United States | Planned | NYC Open Data footprints with LiDAR roof heights; USGS 3DEP 1 m DEM |
| London, United Kingdom | Planned | Environment Agency 1 m LiDAR DTM; open imagery still to find |
| Paris, France | Planned | IGN RGE ALTI, BD ORTHO and BD TOPO heights |
| Amsterdam, Netherlands | Planned | AHN LiDAR, PDOK imagery, 3D BAG heights |
| Tokyo, Japan | Planned | Project PLATEAU 3D city models (CC BY 4.0); GSI elevation tiles |
| Hong Kong, China | Planned | Lands Department 3D spatial data and LiDAR DTM |
| Singapore | Planned | OSM heights; open bare-earth DEM and imagery still to find |

The planned list is a roadmap. None of those data sources has been verified
for this project yet. The order favours cities whose open data includes
measured heights (LiDAR or 3D cadastre), because heights are the weak point
of a footprint-only model (see [what the Sydney study found](docs/cities/sydney.md#52-heights-where-they-come-from-matters-more-than-how-many-there-are)).

## What every city gets

- **Buildings with provenance.** Each height has a source:
  - verified from a cited source;
  - published;
  - surveyed in OpenStreetMap;
  - a floor count times a calibrated storey height;
  - a bias-corrected ML height blended with its neighbours;
  - or an estimate from nearby known heights.

  Every estimator is cross-validated, and missing heights are corrected for not
  being missing at random. The viewer can colour buildings by source.
- **Bare-earth terrain and aerial imagery** from the best open source for the
  place, checked against an independent elevation service where one exists.
- **The real sun.** The NOAA solar position (about 0.01°) is computed in the
  city's own time zone, with daylight saving taken from the platform's time
  zone database. The viewer adds live shadow maps, a sky model and lit windows
  after dark.
- **Shadow analysis** by ray casting through a 2 m surface model:
  - sun now on each public place;
  - a sun-hours map for any day;
  - a "test a new tower" check, where the city has a sun-access rule.
- **Uncertainty.** A Monte Carlo over the measured height errors gives a 90%
  range for each place's sun. It also names the buildings that shade each
  place, and ranks the heights worth verifying next.
- **A guided tour** written in the city's config, with numbers filled in from
  the model.
- **A Blender twin.** `blender/build_scene.py` rebuilds the same scene
  headless with `bpy` from the same files, and renders it in Cycles.

## Run it

The built Sydney scene is in the repository, so the viewer runs straight away:

```bash
cd web && python -m http.server 8000
# open http://localhost:8000 for the globe, #sydney for the 3D model, #play-sydney for the game
```

To rebuild a city from the raw data (about 2 minutes for Sydney), run:

```bash
pip install -r requirements.txt

# downloads (Overture over anonymous S3; unset injected AWS credentials if your shell has any)
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  python pipeline/fetch_overture.py --city sydney
python pipeline/fetch_tiles.py --city sydney         # imagery, terrain, Terrarium tiles
python pipeline/fetch_world.py                        # the globe's base map (once)

# build
python pipeline/build_scene.py --city sydney          # -> web/data/sydney
python pipeline/landmarks.py --city sydney            # -> web/data/sydney/landmarks.json
python analysis/heights.py --city sydney              # published heights vs model
python pipeline/build_scene.py --city sydney          # again, to apply reference corrections
python pipeline/game_data.py --city sydney            # paths, water, wharves, ferry routes for the game
```

`heights.py` reads the built scene, and `build_scene.py` uses its name matches
to correct towers that the open data gets grossly wrong. On a fresh checkout,
that is why the build runs twice. The scores always use the uncorrected
open-data heights.

Checks and analyses all take `--city` and write to `cities/<city>/analysis/`:

```bash
python analysis/data_quality.py --city sydney    # ML heights vs floor counts; Terrarium vs bare earth
python analysis/dem_check.py --city sydney       # terrain vs an independent elevation service
python analysis/radar_check.py --city sydney     # building mass vs the 2000 SRTM radar surface
node analysis/sun_access.js --city sydney        # sun on each place, 21st of every month
node analysis/error_budget.js --city sydney      # numerical error and model-edge effects
node analysis/uncertainty.js --city sydney 40    # Monte Carlo ranges, shade attribution, fix list
node analysis/time_basis.js --city sydney        # standard vs clock time readings of a rule
```

To render in Blender (Python 3.13):

```bash
pip install bpy==5.2.3
python blender/build_scene.py --city sydney --samples 48   # views from city.json -> docs/images/sydney
```

## Add a city

1. Create `cities/<id>/city.json`. It holds:
   - a bounding box and origin;
   - imagery and terrain services;
   - water classes and storey heights;
   - public places, labels, a tour and Blender views.

   The schema is in [docs/ADDING_A_CITY.md](docs/ADDING_A_CITY.md).
2. Optionally add `cities/<id>/city.py` for landmark geometry and per-building
   fixes, and `reference_heights.csv` and `verified_heights.csv` for checks.
3. Run the pipeline and the checks, and read what they say about the data.
4. Mark the city `live` in `cities/index.json`.

The globe picks it up from `web/data/cities.json`.

## How it fits together

```
cities/<id>/city.json ─┐
Overture Maps ─────────┼─► pipeline/ ─► web/data/<id>/ ─┬─► web/  (globe, 3D model viewer, game; world.js, sun.js)
imagery + terrain ─────┘                                ├─► analysis/  (Python and Node checks)
                                                        └─► blender/   (bpy + Cycles)
```

The same files feed the browser, the analyses and Blender, so what you see is
what was measured. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers:
- the local frame;
- the height ladder;
- the file formats;
- the sun and shadow code.

| Path | What |
|---|---|
| `cities/` | One folder per city: `city.json`, optional `city.py` hooks, reference tables, analysis outputs; `index.json` lists live and planned cities |
| `pipeline/` | Downloads (Overture, imagery, terrain, Natural Earth), scene build, landmark meshes |
| `web/` | `index.html` (globe, model and game views), `globe.js`, `world.js` (the city scene the model and the game share), `city.js` (model viewer), `game/` (the game), `sun.js` (solar position, time zones, surface model, ray casting), built data in `web/data/` |
| `analysis/` | Height accuracy, data quality, terrain and radar checks, sun access, error budget, uncertainty, time basis |
| `blender/` | Headless Blender rebuild and Cycles renders |
| `docs/` | Architecture, the game, adding a city, per-city case studies, images |

## Data and licences

Each city lists its sources in `city.json`, and the viewer shows them in its
Data tab. The shared sources are:

- **Buildings, land use, water, trees, piers, addresses:** Overture Maps
  Foundation. These are OpenStreetMap contributors (ODbL) and Microsoft ML
  Buildings (ODbL). A derived database must stay under ODbL.
- **The globe's base map:** Natural Earth (public domain).
- **Fonts:** Google Fonts (Bricolage Grotesque, Public Sans, JetBrains Mono).
- **3D library:** three.js r128 (MIT), loaded from a CDN.

Sydney also uses these sources:
- NSW Spatial Services imagery and 5 m elevation (CC BY 4.0).
- Geoscience Australia 5 m LiDAR DEM (for the terrain check).
- Wikipedia's *List of tallest buildings in Sydney* (CC BY-SA), for reference
  heights.
- Sydney LEP 2012 cl. 6.18, for the protected places. Their windows were
  transcribed from secondary sources, so check the official text before
  relying on them.

No licence has been chosen for the code yet. Until one is added, the default
copyright applies.

## Limitations

- **Open-data heights are uneven.** In central Sydney, 4% of the footprint area
  has a surveyed, published or verified height. 81% has a floor count, which
  converts to a height within 6% (median, against published tower heights).
  The remaining 14% is estimated, with a measured error. Other cities will
  differ, and the share is the first thing to check.
- **Footprints are extrusions.** Setbacks, podiums and roof shapes appear only
  where OpenStreetMap maps building parts. Landmarks need hand-written geometry
  from published dimensions.
- **Rules are transcribed, not interpreted.** A sun-access rule is encoded as
  places, periods and windows. How a court reads it (clock or standard time,
  which baseline) is reported as a range, not decided.
- **One time slice.** The model is the open data as of its Overture release,
  not the city on a given date.
