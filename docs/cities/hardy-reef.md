# Hardy Reef

Viewer: `web/reef/index.html?city=hardy-reef`. Config: `cities/hardy-reef/city.json`. Checks:
`cities/hardy-reef/analysis/` (`optics.json`, `poi_check.json`).

![Reefworld from the water at the spawn](../images/reef/site-hardy-reef-pontoon.jpg)
![The Reefworld pontoon on the channel wall, Hardy Reef to the right](../images/reef/site-hardy-reef-channel.jpg)

Both screenshots use the two viewer changes proposed below (`harbour.pontoon.exact`, `harbour.nav_cell`); without
them the pontoon sits 620 m away on the other side of the channel.

## Area

28.2 x 27.6 km (bbox 149.03-149.30 E, 19.62-19.87 S; origin 149.165 E, 19.745 S): Hardy Reef with Heart Reef, Hook
Reef across the channel, Line Reef to the north and Bait Reef to the west. The first config ran 6 km further south over
open water 40-80 m deep; the box was moved north and west to take in all of Line Reef and Bait Reef. There is no land.

## Data

- Terrain: AusSeabed GBR 30 m (2020), grid C (148-154 E, 18-24 S, read from the COG header), cached in
  `data/raw/_gbr/C.tif` and shared with the Whitsundays and Heron Island. Range -84.3 to +1.5 m MSL, no no-data.
- Imagery: 14 Sentinel-2 L2A scenes, all MGRS tile 55KGU (one tile covers the box, so no seam), 1 Oct 2025 to
  6 Oct 2026, cloud 0-8.4% (`optics.json` lists the product ids). No-data share 0.
- Tide: MSQ predictions for Bugatti Reef Outer, 2025 and 2026, fitted to 0.8 and 0.7 cm RMS (largest error 3.7 cm);
  range -1.52 to +1.87 m about MSL. Bugatti Reef is on the outer reef 120 km east-south-east; it was chosen over
  Shute Harbour (73 km south-west, on the mainland) because MSQ's 2026 tidal planes give the outer reef a smaller tide
  (spring range 2.08 m at Bugatti, 2.4 m at Hook Island, 2.77 m at Shute Harbour). MSQ publishes nothing for Hardy Reef.

## Optics (compared with the Whitsundays)

| | Hardy Reef | Whitsundays |
|---|---|---|
| Rinf blue / green / red | 0.0279 / 0.0141 / 0.0055 | 0.0264 / 0.0156 / 0.0013 |
| Kd blue / green (fit) | 0.063 / 0.076 /m | 0.054 / 0.080 /m |
| Kd red (fit, used) | 0.209, 0.40 | 0.193, 0.40 |
| sand albedo blue / green | 0.202 / 0.205 | 0.117 / 0.175 |
| sand brightness spread 1-15 m, raw to inverted | blue 62 to 31%, green 113 to 15% | blue 103 to 43%, green 136 to 29% |

- Rinf is plausible and bluer offshore: blue:green 1.98 against 1.69, green lower. Red Rinf (0.0055) is high for clear
  deep water; it is probably residual glint or an atmospheric offset in L2A over the open sea.
- Green Kd is lower than in the Whitsundays (0.076 against 0.080) and close to pure sea water, as expected offshore.
- **Blue Kd is not plausible** (0.063, higher than the inner Whitsundays). The bright-floor blue reflectance is flat from
  1 to 5 m (0.094-0.098) and only then falls: the reef flat has little bare sand, so the brightest floor changes with
  depth and the fit reads substrate as attenuation. Fitted over 2-8 m blue gives 0.034-0.038 /m, over 4-16 m 0.062. The
  method is left as it is; a substrate-independent estimate (Lyzenga's ratio method on sand patches, or a fixed
  blue:green ratio) is the fix.
- Habitat: with the Whitsundays thresholds only 0.9% of the shallow floor came out as reef, because the inverted floor
  is brighter here. `build_marine.py` now scales the thresholds by the scene's fitted sand albedo (factor 1.391; 1.0 for
  the Whitsundays, whose output is unchanged). Reef is now 11% of the shallow floor (3.1% of the box), on reef crests
  and Hook Reef's patch reefs; sand 15%, rubble 70%. Still inferred, not surveyed.
- `ground.jpg` and `habitat.png` (previews checked): no seam (one tile), no cloud residue or glint visible on the reefs;
  the deep floor is the smoothed fill with its usual rings. Heart Reef is a 2-3 pixel bright speck in its pool in the
  composite and is not resolved as a heart.

## Places

All positions are OpenStreetMap objects (Nominatim, also in Overture 2026-10-21.0), checked on the built terrain
(`pipeline/check_marine.py`):

| POI | kind | depth on the 30 m model |
|---|---|---|
| Reefworld (node 2360082104, man_made=pier, floating=yes) | pontoon | 7 m on the wall top; 0.8-38 m within 90 m |
| Heart Reef (node 3502863694) | reef | 4.9 m |
| Hardy, Hook, Line, Bait reefs (ways) | reef | 1.8-4.5 m |
| Bait Reef, west side (nominal) | anchorage | 6.9 m |
| Toward Airlie Beach (nominal) | gate | 70 m |

Not mapped: the channel and the lagoon have no name in OSM or Overture. OSM also has 'Hardy Reef Pontoon' (node
5611360021, tourism=attraction) 1 km east on the reef flat; which pontoon it stands for is not stated, so it is left out.

Spawn: in the water, 12 m deep, 30 m off the south end of the pontoon, facing north to it (the site has no land). Start:
260 m up south-east of Heart Reef looking north-west over its pool toward the channel.

## Harbour layout (checked with `window.__boats` in the viewer)

- Current viewer: the pontoon search for 9-18 m water with 60 m of room cannot use the wall (7 to 32 m within 60 m), so
  it puts Reefworld 620 m west on Hook Reef's side; the day cruise and the dive tender are dropped (the 300 m channel has
  no cell left in the 120 m navigation grid after erosion). Fleet at Bait Reef, yacht traffic, 6 public moorings and the
  scenic helicopter and seaplane work.
- With the two proposed changes: pontoon, helipad, helicopter, seaplane and docked day cat on the mapped position;
  day cruise (22.3 km, 5 waypoints) and dive tender (15.4 km) routes found. The pontoon's own shuttle is still dropped:
  it routes through `moorings.slice(-2)`, the last two public moorings (on Hardy's far side), not the pontoon's.

## Viewer changes this site needs

1. `harbour.pontoon.exact` (boats.js, pontoon placement): `const p = pt.exact ? [best.x, best.n] : (nav.anchorage(...) || ...)`.
2. `harbour.nav_cell` (boats/nav.js): `createNav(ctx, CELL = ctx.S.harbour?.nav_cell || 120)` with the clearance
   samples at `Math.round(CELL * 5 / 12)` (50 m at 120 m, so the Whitsundays grid is unchanged). Hardy uses 60.
3. The pontoon shuttle should use the moorings made around the pontoon, not the last two in the list.
4. The gear crate is placed on the sea floor under the spawn (12 m down); at a site without land it belongs on the
   pontoon deck.

## Known problems

- Aerial views above about 150 m are dominated by the ocean's ring moire (software WebGL2); the reef shows through it.
- Under water there is no coral or fish yet (`life.js`); the floor is the inverted Sentinel-2 colour with caustics.
- Blue Kd (above). The 30 m model smooths the channel wall; the real wall is steeper.
