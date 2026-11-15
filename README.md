# Blue Hour

One story, in episodes, on one map: the Shibuya Scramble, rebuilt from open data and played in a
browser. Seven evenings at the crossing, one camera with seven frames left in it: the world stops,
and someone who should not be there asks you for a photograph. [docs/STORY.md](docs/STORY.md) is the
story bible; episode 1 is built.

The map is Sangenjaya to Shibuya, Harajuku and Yoyogi Park: some 48,000 buildings at
PLATEAU-surveyed heights, the scramble and Hachiko modelled finely as a hero level, SHIBUYA SKY's
roof, Center Gai, the trains, the traffic and a crowd, by day, at dusk, at night and in the rain.
It is three.js in one page, with no build step.

## Run it

The built map is in the repository:

```bash
python3 -m http.server 8800 --directory web
# http://localhost:8800/            the story
# http://localhost:8800/?walk=1     the same map without the story: walk, drive, fly, ride the trains
```

It needs WebGL 2. A phone loads its own district of the map (`web/data/shibuya/d/`).

## Check it

```bash
pip install -r requirements.txt     # the static checks need numpy, shapely, pyproj and pillow
tools/check.sh static               # the checks that open no browser
tools/check.sh story                # the first episode played through in Chromium (needs Playwright)
tools/check.sh                      # what this branch changed against origin/main
```

[docs/CHECKS.md](docs/CHECKS.md) lists every check and what runs on main after landing. For a
visual change, take stills and look at them: `tools/game_shot.js`, `tools/story_play.js`.

## Rebuild the map

Only needed to change the data. The raw downloads go to `data/raw/shibuya/`, the outputs to
`web/data/shibuya/`.

```bash
# downloads (Overture over anonymous S3; unset injected AWS credentials if your shell has any)
env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  python pipeline/fetch_overture.py --city shibuya
python pipeline/fetch_tiles.py --city shibuya        # GSI aerial photographs and terrain
python pipeline/fetch_plateau.py --city shibuya      # PLATEAU building heights

python pipeline/build_scene.py --city shibuya        # buildings, terrain, ground, scene
python pipeline/landmarks.py --city shibuya          # the landmarks, from cities/shibuya/city.py
python pipeline/game_data.py --city shibuya          # paths, roads, the game's data
python pipeline/game_text.py shibuya                 # the game's and the story's text, from city.json alone
python pipeline/pack.py                              # the .bin packs, vis.bin, skyvis.webp and the phone's district
python blender/build_hero.py --city shibuya          # the hero level (pip install bpy==5.2.3)
```

The shared models are built by `blender/build_vehicles.py`, `build_trees.py`, `build_trains.py`,
`build_railstock.py` and `build_people.py`. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes
the pipeline and the renderer, [docs/HERO.md](docs/HERO.md) the hero level,
[docs/cities/shibuya.md](docs/cities/shibuya.md) the map and its sources.

## Online, and its version

Every push to main publishes `web/` to GitHub Pages through `.github/workflows/pages.yml`. Each
deploy gets a version: the major.minor in `VERSION` plus the workflow's run number (`0.1.42`),
written with the commit and the build time to `web/version.json` and tagged. `vercel.json` deploys
the same folder on Vercel from main.

## The world before

Until November 2026 this repository was Open Earth 3D: a globe, some twenty-five city maps, reef
and alpine sites, films, fishing, postcards and a city model viewer. All of it is kept at the tag
`archive/world-2026-11`:

```bash
git checkout archive/world-2026-11
```

Some of the docs still describe that wider world where the code they explain is shared; each says
so at its top.

## Data and licences

- **Buildings, land use, water, roads, trees:** Overture Maps Foundation, which is OpenStreetMap
  contributors (ODbL) and Microsoft ML Buildings (ODbL). A derived database must stay under ODbL.
- **Building heights and massing:** MLIT Project PLATEAU, Tokyo 23 wards LOD2 building models
  (CC BY 4.0; 出典：国土交通省 PLATEAU), read as the vector tiles published by indigo-lab (MIT).
- **Terrain:** Geospatial Information Authority of Japan (GSI), Fundamental Geospatial Data DEM5A,
  5 m airborne laser survey, bare earth; the 10 m DEM where 5A is absent (GSI terms of use).
- **Aerial photographs:** GSI seamless photographs (GSI terms of use, source attribution).
- **Landmarks:** modelled in code from published dimensions and checked against photographs:
  SHIBUYA SKY (229 m), the scramble's screens at their operators' published sizes, Yoyogi National
  Gymnasium from OpenStreetMap and Tange's drawings. Signs, screens and shop fronts are indicative.
- **Reference photographs** (for checking models, never as textures): Wikimedia Commons
  (`tools/commons.py`) and Openverse (`tools/photos.py`); each photograph's author, licence and
  page are in [docs/cities/shibuya.md](docs/cities/shibuya.md).
- **Woods and park canopy:** Meta and World Resources Institute High Resolution Canopy Height Maps
  (Tolan et al. 2024, CC BY 4.0), through `pipeline/woods.py`.
- **Land past the map's frame:** Copernicus DEM GLO-30 (© DLR e.V. 2010-2014 and © Airbus Defence
  and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA); ESA
  WorldCover 10 m 2021 v200 (CC BY 4.0); the annual VIIRS night lights of 2024 (Elvidge et al.
  2021; Earth Observation Group, Colorado School of Mines; CC BY 4.0), through
  `pipeline/far_land.py`. Open water past the frame: Overture's base water and land themes (ODbL),
  through `pipeline/open_sea.py`.
- **People:** Microsoft Rocketbox avatars and animations (MIT, © 2020 Microsoft;
  `web/assets/people/LICENSE-Rocketbox.txt`) for the people you play and meet; Quaternius, Ultimate
  Modular Men and Women (CC0 1.0), for the crowd.
- **Vehicles, trains and trees:** modelled from code in this repository (`blender/build_vehicles.py`,
  `build_trains.py`, `build_railstock.py`, `build_trees.py`), with no third-party assets.
- **Surfaces:** Poly Haven's CC0 textures for the landmarks' tiled PBR materials
  (`pipeline/fetch_pbr.py`).
- **Water:** the wave spectrum and FFT are ported from Tidewater by Daniel Greenheck
  (github.com/dgreenheck/tidewater, MIT, © 2026 DRG Software Solutions LLC); its licence notice is
  at the top of `web/water.js`.
- **3D library:** three.js r186 (MIT) and three-mesh-bvh (MIT), vendored in `web/vendor`.
- **Fonts:** Google Fonts under the SIL Open Font License, for the interface and for the lettering
  on signs, plaques and ema (listed in `cities/shibuya/city.json` `sources.fonts`).

No licence has been chosen for the code yet. Until one is added, the default copyright applies.

## Limitations

- **Heights are measured, shapes are inferred.** PLATEAU gives each building's height and massing;
  most roof shapes and every facade outside the hero level are drawn from rules.
- **The hero level is small.** The hundred metres round the scramble are modelled finely; the rest
  of the map is the open data as it is.
- **One time slice.** The map is the open data as of its release, not the place on a given date.
- **Not checked on real hardware here.** The checks run Chromium on a software renderer; a real
  GPU, WebGPU, Safari and iOS are checked by hand.
