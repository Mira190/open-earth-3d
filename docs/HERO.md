# Hero levels

A hero level is a small place, two or three hundred metres across, where a map's game starts and
where the model is built to be looked at from eye level: the landmark modelled finely against its
published dimensions and photographs, real surface materials, the street's furniture, light that
reads at day, dusk and night. The rest of the map stays as it is round it.

| Map | Hero level | Built by |
|---|---|---|
| Tokyo, Marunouchi & Ginza | Tokyo Station's Marunouchi building and its plaza | `cities/tokyo/station.py` |
| Shibuya | (its own session) | |
| Shinjuku | (its own session) | |

## Why Tokyo Station

The game already started on the Marunouchi side of Tokyo Station. The station is the most
recognisable building in the district, and the plaza in front of it is a closed, walkable room.
It is about 300 m wide, between the station's 335 m front and the Marunouchi and Shin-Marunouchi
towers.

The other candidate was the Ginza 4-chome crossing, with Wako's clock tower. It needs four
landmark buildings and a crossing's traffic and signage before it reads. The station needs one
building and a plaza, so one session can take it to finished.

## What AAA cities do, and what was taken

None of the studios below published assets that can be used. What was taken from them is the way
they build a city, not how their cities look.

- **Like a Dragon / Yakuza (Kamurocho).** One small district built at very high density, every
  frontage its own. Taken: the level's scope. One room is finished to the bar; the rest of the
  map is left as the open-data model.
- **Marvel's Spider-Man 2 (Insomniac).** Modular building kits, and fake interiors behind windows
  drawn with cubemaps.
  - Taken: the facade as a kit. One bay, opening and storey grammar is applied to the measured
    outline, so the station follows OpenStreetMap/PLATEAU's footprint instead of a hand layout.
  - Interior mapping is already in `web/buildings.js` for the generic buildings. The station's
    windows are real openings: a 0.45 m deep reveal, a sash and glass, with a share lit after dark.
- **UE5 City Sample (The Matrix Awakens).** Rule-built buildings from kits, with detail by LOD.
  Taken: detail by tier. The finest meshes (sashes, reveals, kerbs) carry `detail` and are not
  drawn on the low tier.
- **Cyberpunk 2077, Ghostwire: Tokyo.** Layered materials, grime at the foot of walls, wet streets
  that reflect. Taken:
  - weathering at the foot of each wall in the PBR shader (`grime_m`);
  - the wet-street mirror already in `web/mirror.js`, which the plaza's paving takes because it
    is `street_lit` paving.
- **GTA V.** Hand-made LOD chains, decals and props. Taken: street furniture as instanced props,
  one draw call per part (`landmarks.json` `props`).

In the browser:

- **PBR textures.** three.js `MeshStandardMaterial` with colour, normal and roughness maps from
  Poly Haven (CC0; ambientCG is also CC0 and is the next source), shipped as WebP.
- **KTX2/Basis.** Not adopted yet: there is no encoder in the pipeline. WebP keeps the downloads
  small (1.8 MB for every set at both sizes). The GPU cost is bounded by size per tier: 512 px and
  no roughness map on phones. KTX2 would cut that GPU memory by about 4–8×; it is the next step if
  phones need it.
- **SSR, GTAO, light probes.** The game already has contact shadows (`web/game/ao.js`), the wet
  mirror and an environment from its sky. Nothing new was added.

## The shared PBR surfaces (`web/pbr.js`)

A landmark material names a set, and the textures are repeated every `tile_m` metres of the
mesh's texture coordinates:

```json
"pbr": {"set": "brick", "tile_m": [1.4, 1.4], "vary": 0.2, "grime_m": 1.6, "grime_z": 3.2, "normal": 1}
```

- **Sets.** `web/assets/pbr/`, fetched and sized by `python pipeline/fetch_pbr.py`. Sources and
  licence are in `web/assets/pbr/LICENSE-PolyHaven.txt`.

  | Set | Poly Haven texture |
  |---|---|
  | `brick` | `red_brick` |
  | `granite_paving` | `granite_tile` |
  | `slate` | `roof_slates_03` |
  | `stucco` | `plastered_wall_04` |
  | `concrete_pavers` | `concrete_pavers_02` |

  To add a set, add it to `SETS` and run the script.
- **Colour and roughness.** The maps are divided by their set's mean (`sets.json`), so a material
  still averages to its own `color` and `roughness`. A city tunes a surface by its colour, and the
  mesh reads the same before its maps arrive.
- **Breaking the repeat.**
  - `vary` adds a slow variation of tone, taken from the world position.
  - `grime_m` darkens and roughens the foot of a wall, `grime_m` metres up from `grime_z`.
- **By tier.** High and medium load 1024 px colour, normal and roughness maps. The low tier loads
  512 px colour and normal maps only. Meshes marked `detail` (`meshkit.Mesh.detail`) are not drawn
  on the low tier.

## Tokyo Station (`cities/tokyo/station.py`)

The station's solids from its OpenStreetMap/PLATEAU outline (r4856156) are hidden, and the station
is drawn on them.

- **Wings.**
  - Three storeys of openings about every 3.6 m: real holes 0.45 m deep, each with a sash,
    transom and glass.
  - Stone work round each opening: sills, lintels and keystones.
  - Stone courses at the plinth, at each storey's sills and at the first floor's imposts.
  - Quoins at the corners and a moulded cornice at 16.7 m. JR East gives about 16.7 m for the
    eaves; this figure is unverified.
  - Slate roofs with dormers.
- **Dome pavilions.**
  - Regular octagons fitted to the mapped octagons, about 22 m across.
  - An attic of round windows up to 24.6 m.
  - Slate domes with copper hips and dormers, up to 34.8 m. JR East gives about 34.8 m to the top
    of the dome without the finial. Above that, a lantern and the finial.
- **Central pavilion.** About 28 m, under its own steep roof, with the porch's stone piers.
- **After dark.** The scheme is LPA's, from 2012. Brick and stone are floodlit warm, falling off
  up the building, and about 62% of the windows are lit. No colour temperature is published;
  about 3000 K is assumed.
- **Plaza.** The plaza opened on 7 December 2017. Sources: Tokyo Metropolitan Government, JSCE
  award, trafficnews.
  - White granite paving from the facade to the street.
  - Two lawns with granite kerbs.
  - The zelkova rows on the axis to the Palace.
  - Three-lamp posts along the rows, and bollards at the street.
- **Not yet built.**
  - The dome interiors: the eagles and zodiac reliefs.
  - The station's signage.
  - The north and south transport plazas' bus and taxi pools.
  - The exact bay rhythm. The Shinkenchiku 2012/11 drawings would give it.

### Checked

- Stills at day, dusk and night, on a desktop and a phone, before and after:
  `tools/game_shot.js tokyo tools/views/tokyo-hero.json`.
- `tools/game_check.js` checks that the PBR surfaces load and repeat in metres.
- Not checked: a real GPU, WebGPU, Safari and iOS.
