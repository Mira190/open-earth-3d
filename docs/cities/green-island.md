# Green Island

Viewer: `web/reef/index.html?city=green-island`. Config: `cities/green-island/city.json`. Checks:
`cities/green-island/analysis/` (`optics.json`, `poi_check.json`).

![Green Island from the north-west, with its jetty](../images/reef/site-green-island-aerial.jpg)
![The spawn on the western beach, looking out along the jetty](../images/reef/site-green-island-beach.jpg)

## Area

26.6 x 33.6 km (bbox 145.89-146.14 E, 16.535-16.84 S; origin 146.015 E, 16.6875 S): Green Island and its reef, and the
Arlington reef complex to the north (Arlington Reef, Upolu Cay, Vlasoff Reef, Michaelmas Reef and Cay), the offshore
reefs of the Cairns day trips. The Cairns waterfront (27 km south-west) is left out: reaching it as well would take
about 45 km, and 20 km of turbid inshore water would bias the one scene-wide Kd that the reefs are inverted with; the town
would also be flat, with no buildings in this pipeline. Boats from Cairns enter through a gate in the south-west corner.

## Data

- Terrain: AusSeabed GBR 30 m, grid A (142-147 E, 10-17 S, read from the COG header), cached in `data/raw/_gbr/A.tif`.
  Range -70.1 to +19.7 m (the top is the canopy on Green Island, below); no no-data. The crop is cut on whole grid
  pixels with two to spare; the first crop's transform carried a fractional offset (up to half a pixel).
- The cays: the survey model's land on Green Island is the forest canopy, 15-20 m high. `build_marine.py` rebuilds
  Green Island, Michaelmas Cay and Upolu Cay from their OpenStreetMap outlines: beach from 0 m at the mapped waterline to
  the highest astronomical tide (1.56 m above MSL, MSQ) at the vegetation line, the vegetated interior to 3.0 m
  (assumed: no published survey height was found), the reef flat around it held below -0.3 m.
- Imagery: 14 Sentinel-2 passes, each covering both MGRS tiles 55KCB and 55KDB (28 products), 19 Oct 2025 to 26 Oct
  2026, cloud limit 20% (at 12% only 7 passes cover both tiles). No-data share 0. Bands B1-B4 and B8.
- Seam: the first composite (the clearest 14 scenes of each tile, as for the Whitsundays) changed character at the
  western edge of 55KDB, where the tile overlap starts and the pixels see the union of two sets of dates. `fetch_sentinel.py`
  now keeps whole passes and mosaics their tiles into one layer; the seam is no longer visible in `ground.jpg` or
  `habitat.png`, and the blue band's column-to-column change across the tile edge equals its typical value.
- Tide: MSQ predictions for Cairns Beacon C1 (open water in Trinity Bay, 18 km west-south-west), 2025 and 2026, fitted to
  1.7 and 1.4 cm RMS (largest error 6.2 cm); range -1.55 to +1.66 m about MSL. MSQ lists Green Island as a secondary
  place of Cairns with high and low water 6 minutes earlier; the beacon's tide runs about 6 minutes ahead of the Cairns
  inlet gauge's, with 4% less M2.

## Optics

Kd comes from two independent estimates (`pipeline/qaa.py`, `build_marine.py`): the depth fit (how the brightest floor
darkens with depth) and QAA (Lee's quasi-analytical algorithm on water deeper than 40 m, with Lee et al. 2005 for Kd).
QAA is used unless the fit passes a quality test (residual sd of ln(R - Rinf) at most 0.06 and the inverted sand
brightness within 20% across 1-15 m); red keeps the pure-water floor, 0.40 /m.

| Kd /m | fit | QAA | used | sand spread 1-15 m: raw, with fit, with QAA |
|---|---|---|---|---|
| blue (492 nm) | 0.054 (sd 0.119) | 0.056 | 0.056 QAA | 88%, 27%, 25% |
| green (560 nm) | 0.098 (sd 0.062) | 0.090 | 0.090 QAA | 134%, 20%, 18% |
| red (665 nm) | 0.199 | 0.299 | 0.40 floor | |

The Whitsundays for comparison (QAA from a fresh composite; rebuilt with it since): fit 0.054 / 0.080, QAA 0.090 / 0.108. QAA
against QAA, the water here is clearer than the inner Whitsundays' in both bands. The depth fit had green higher (0.098):
the brightest shallow floors are the cays' white sand and the reef-flat sand while the floors at 8-12 m are darker lagoon
and seagrass, so it read substrate as attenuation; QAA also flattens the sand slightly better (18% against 20%).

- QAA inputs: deep-water reflectance less a near-infrared offset of 0.0046, Rrs 0.0105 / 0.0082 / 0.0031 / 0.0005 /sr at
  443 / 492 / 560 / 665 nm, mean solar zenith 33.8 degrees; a(492) 0.035 /m, bb(560) 0.0043 /m, eta 1.88. Water deeper
  than 40 m covers 3.0 million pixels; at 30 m and 60 m QAA gives 0.060 / 0.092 and 0.051 / 0.087.
- Rinf (the inversion's deep-water reflectance) 0.0304 / 0.0145 / 0.0063.
- Habitat (scaled by 1.727): shallow floor sand 44%, rubble 31%, reef 17%, seagrass and algae 8%. Inferred, not surveyed.
- `ground.jpg` and `habitat.png` (previews checked): no seam after the pass fix, no cloud residue visible on the reefs;
  the deep floor is the smoothed fill with its olive rings.

## Places

| POI | source | check on the built terrain |
|---|---|---|
| Green Island (way 104227384) | OSM | 3.0 m, forest |
| Western beach (relation 9767809, unnamed) | OSM | 0.8 m, beach |
| Green Island jetty, shore end and outer end (way 144064542, ferry terminal node 5877123720) | OSM | 1.3 m; 4.9 m deep |
| Green Island helipad (way 700778220) | OSM | 0.6 m |
| Viewpoint, south-east shore (node 6221607877) | OSM | 1.2 m |
| Green Island reef (relation 14074188, unnamed) | OSM | 1.4 m deep |
| Snorkelling beside the jetty | nominal, where QPWS describes snorkelling | 1.5 m deep, reef flat |
| Arlington Reef, Vlasoff Reef, Michaelmas Reef | OSM | 2.2-4.1 m deep |
| Michaelmas Cay, Upolu Cay (islets) | OSM | 1.6 m (sand cays at HAT) |
| Anchorages west of Green Island and west of Michaelmas Cay | nominal | 7.8 m; 17 m, the boats anchor 120 m east in 8.6 m |
| Gate toward Cairns | nominal | 14.3 m |

No dive or snorkel sites are mapped in OSM or Overture here. Spawn: on the upper sand of the western beach south of the
jetty (1.8 m, above the highest tide), facing west; the player starts walking (checked in the viewer). Start: 120 m up
north-west of the cay, looking south-east at the island and jetty.

## Harbour layout (checked with `window.__boats`, viewer 782bbd9)

Three yachts at the Green Island anchorage and two at Michaelmas Cay with tenders, the jetty along its mapped line
(`marina.from`, the shore end added from the same OSM way) with two moored yachts and a cat, the helicopter on its pad,
the seaplane at the jetty, three public moorings, and all five traffic routes connected (ferry from the gate to the
jetty, Michaelmas Cay cruise, two yachts, the dive tender), plus the scenic helicopter and seaplane. The Michaelmas
anchorage was moved 260 m west into 17 m of water: from its first spot the router snapped to a navigable cell the
rising tide had opened at the reef edge, cut off from the open water, and the three routes to it were dropped.

## Known problems

- QAA rests on Sentinel-2 L2A over water, which keeps some sky reflection; green Kd from QAA is probably on the high side.
- Habitat is inferred, not surveyed. The cays' interior height (3.0 m) is an assumption.
- Upolu Cay is 5 cells of the 30 m grid; Michaelmas Cay 27.
- The viewer's router snaps a stop to the nearest navigable cell even when that cell is cut off (above); a snap that
  prefers cells connected to the rest of the water would make nominal stops less fragile.
