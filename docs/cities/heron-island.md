# Heron Island

Viewer: `web/reef/index.html?city=heron-island`. Config: `cities/heron-island/city.json`. Checks:
`cities/heron-island/analysis/` (`optics.json`, `poi_check.json`).

![Heron Island from the north-west at high tide](../images/reef/site-heron-island-aerial.jpg)
![The cay, its jetty and the reef flat drying at low tide](../images/reef/site-heron-island-low-tide.jpg)

## Area

19.4 x 14.3 km (bbox 151.82-152.01 E, 23.39-23.52 S; origin 151.915 E, 23.455 S): Heron Reef with the cay at its western
end, Wistari Reef across the channel to the south-west, and the open water around them.

## Data

- Terrain: AusSeabed GBR 30 m, grid C, the cache shared with Hardy Reef and the Whitsundays. Range -52.1 to +11.6 m;
  no no-data. The +11.6 m is the forest canopy; the cay is rebuilt from its OpenStreetMap outline (`build_marine.py`
  cays(): beach from 0 m at the waterline to the highest astronomical tide, 1.81 m above MSL from MSQ's tidal planes, at
  the vegetation line, interior 3.0 m; Wikipedia gives 3.6 m for the highest point near the western tip, about 3 m for
  the southern dune ridge and about 1 m for the north-eastern dunes). 242 cells, 187 inland.
- The first build left the box's east column and south row (812 cells) at -3200 m: the frame's corners reached a pixel
  past the crop. The crop now has two pixels to spare and `build_marine.py` fills any cell the survey does not cover
  from its nearest covered neighbour.
- Imagery: 14 Sentinel-2 passes over MGRS tiles 56KLU and 56KLV (28 products), 3 Oct 2025 to 20 Sep 2026, bands B1-B4
  and B8. The first
  search stopped at 100 results (the oldest months fell off); `fetch_sentinel.py` now follows the STAC result pages
  (119 scenes, 40 passes covering both tiles).
- Tide: MSQ predictions for Bundaberg's standard port gauge at Burnett Heads, 2025 and 2026, fitted to 1.4 cm RMS (largest
  error 5.7 cm); range -1.53 to +1.80 m about MSL. MSQ refers Heron Island to Gladstone (80 km west-south-west, in the Port
  Curtis harbour: 33 minutes later, range x 0.71). Burnett Heads (153 km south-south-east) is closer to Heron in both size
  (spring high and low water +1.16 / -1.17 m against Heron's +1.21 / -1.09 m and Gladstone's +1.62 / -1.62 m) and timing
  (about 10 minutes early where Gladstone is 33 minutes late). Neither is an offshore gauge. The portal's 2024 and 2025
  resources of the separate 'Burnett Heads' storm-surge gauge contain Bugatti Reef Outer's file and are not used.

## Optics

Kd comes from two independent estimates (`pipeline/qaa.py`, `build_marine.py`): the depth fit (how the brightest floor
darkens with depth) and QAA (Lee's quasi-analytical algorithm on water deeper than 40 m, with Lee et al. 2005 for Kd).
QAA is used unless the fit passes a quality test (residual sd of ln(R - Rinf) at most 0.06 and the inverted sand
brightness within 20% across 1-15 m); red keeps the pure-water floor, 0.40 /m.

| Kd /m | fit | QAA | used | sand spread 1-15 m: raw, with fit, with QAA |
|---|---|---|---|---|
| blue (492 nm) | 0.063 (sd 0.092) | 0.054 | 0.054 QAA | 78%, 32%, 23% |
| green (560 nm) | 0.099 (sd 0.193) | 0.091 | 0.091 QAA | 128%, 52%, 44% |
| red (665 nm) | 0.189 | 0.341 | 0.40 floor | |

- The Whitsundays for comparison (QAA from a fresh composite; rebuilt with it since): fit 0.054 / 0.080, QAA 0.090 / 0.108. QAA
  against QAA, Heron's water is clearer in both bands. The depth fit read the bright reef-flat sand at 0-3 m over the
  darker floors at 8-20 m as attenuation; QAA flattens the sand better in both bands.
- Green is still the weakest check of the sites (44%): the 6-10 m bin inverts to 0.64, too bright for real sand, so green
  Kd is probably still high. Heron's near-infrared offset is the smallest of the sites (0.0008), so less of the L2A sky
  reflection is taken out before QAA.
- QAA inputs: Rrs 0.0093 / 0.0075 / 0.0026 / 0.0004 /sr at 443 / 492 / 560 / 665 nm, mean solar zenith 46.1 degrees (the
  clearest passes here are winter ones); a(492) 0.033 /m, bb(560) 0.0036 /m, eta 1.89. At 30 m deep instead of 40 m:
  0.054 / 0.092; there is no water deeper than 60 m in the box.
- Rinf 0.0245 / 0.0091 / 0.0021: the lowest green of the sites, oceanic water.
- Habitat (scaled by 2.477): shallow floor sand 36%, rubble 34%, reef 24% (mostly the reef slopes and crest), seagrass
  and algae 6%.
- `ground.jpg` and `habitat.png` (previews checked): no seam, no cloud residue on the reef; a purple cast at the reef's
  north-east edge, as in parts of the Whitsundays.

## Places

| POI | source | check on the built terrain |
|---|---|---|
| Heron Island (way 723708198) | OSM | 3.0 m |
| Beach, north shore (relation 10558459) | OSM | 1.1 m |
| Jetty (ferry terminal node 4058359824, pier way 1023505426) | OSM | 3.1 m deep, land within 300 m |
| Heron Island Helipad (way 544294114) | OSM | 2.4 m |
| Wreck of HMCS Protector (way 569784277) | OSM (Nominatim) | 3.5 m deep, at the channel entrance |
| Heron Island Research Station (way 1218662882) | OSM (Nominatim) | 3.0 m |
| Heron Reef (relation 10033046, unnamed in OSM), Wistari Reef (way 403368963) | OSM | 2.3 and 3.3 m deep |
| West of the cay, off the channel | nominal | 8.9 m |
| Gate toward Gladstone | nominal | 29 m |

Spawn: upper sand of the north shore, 1.9 m (above the highest tide), facing the sea. Start: 130 m up north-west of the
cay looking south-east across the island and Heron Reef. At low tide the reef flat dries around the cay, as it does.

## Harbour layout (checked with `window.__boats`, viewer 782bbd9)

Two yachts with tenders west of the cay, the jetty without moored boats (`marina.boats: false`; the real jetty has no
marina berths), the helicopter on its pad, five public moorings, the island launch from the gate to the jetty, a yacht and
a dive boat (all routes connect) and a scenic helicopter. The player starts walking on the north beach.

## Known problems

- Green Kd (above); QAA rests on Sentinel-2 L2A over water, which keeps some sky reflection. Habitat inferred, not
  surveyed. No dive sites mapped.
- The interior height (3.0 m) flattens the real 1-3.6 m relief.
