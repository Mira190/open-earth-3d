# Lady Elliot Island

Viewer: `web/reef/index.html?city=lady-elliot-island`. Config: `cities/lady-elliot-island/city.json`. Checks:
`cities/lady-elliot-island/analysis/` (`optics.json`, `poi_check.json`).

![Lady Elliot Island and its airstrip from the south-west](../images/reef/site-lady-elliot-island-aerial.jpg)
![On the western beach at low tide](../images/reef/site-lady-elliot-island-beach.jpg)

## Area

12 x 12 km (bbox 152.655-152.775 E, 24.06-24.17 S; origin 152.715 E, 24.115 S) centred on the island: its platform reef,
about 1.3 km across, and the shelf around it, mostly 30-55 m deep (5th to 95th percentile 28-56 m). No other reef lies in
the box; Lady Musgrave Island, the nearest, is 40 km north-west.

## Data

- Terrain: AusSeabed GBR 30 m, grid D (150-156 E, 23-29 S), cached in `data/raw/_gbr/D.tif`. Range -100.1 to +9.2 m;
  no no-data. The +9.2 m is the canopy: the island is rebuilt from its OpenStreetMap outline (`build_marine.py` cays():
  beach from 0 m at the waterline to the highest astronomical tide, 1.41 m above MSL from MSQ's tidal planes, at the
  vegetation line, interior 3.0 m, an assumption, no survey height found). 504 cells, 400 of them inland.
- Imagery: 14 Sentinel-2 scenes, all MGRS tile 56KMU, 10 Oct 2025 to 20 Sep 2026 (`optics.json` lists them), bands
  B1-B4 and B8. No seam. The terrain crop is now cut on whole grid pixels (the first carried a fractional offset).
- Tide: MSQ predictions for Waddy Point (K'gari), 114 km south-south-east on the open-ocean coast, 2025 and 2026,
  fitted to 3.2 cm RMS (largest error 10 cm); range -1.07 to +1.24 m about MSL. MSQ lists Lady Elliot Island as a secondary
  place of Bundaberg (Burnett Heads, 80 km south-south-west, at a river mouth): high water 24 and low water 33 minutes
  earlier, 0.74 of its range. Waddy Point runs about 25 minutes ahead of Burnett Heads, as Lady Elliot does, and its tide
  is closer in size (spring high and low water +0.63 / -0.62 m against Lady Elliot's +0.87 / -0.86 m and Burnett Heads'
  +1.16 / -1.17 m), so it was chosen; heights at the island are about a third larger than Waddy Point's.

## Optics

Kd comes from two independent estimates (`pipeline/qaa.py`, `build_marine.py`): the depth fit (how the brightest floor
darkens with depth) and QAA (Lee's quasi-analytical algorithm on water deeper than 40 m, with Lee et al. 2005 for Kd).
QAA is used unless the fit passes a quality test (residual sd of ln(R - Rinf) at most 0.06 and the inverted sand
brightness within 20% across 1-15 m); red keeps the pure-water floor, 0.40 /m.

| Kd /m | fit | QAA | used | sand spread 1-15 m: raw, with fit, with QAA |
|---|---|---|---|---|
| blue (492 nm) | -0.013 (sd 0.36) | 0.047 | 0.047 QAA | 36%, 48% (at the 0.015 floor), 104% |
| green (560 nm) | 0.016 (sd 0.30) | 0.085 | 0.085 QAA | 72%, 67% (at the 0.0619 floor), 112% |
| red (665 nm) | 0.135 | 0.326 | 0.40 floor | |

- The site's own fit fails: the brightest floor gets brighter with depth (a dark reef flat ringed by a pale sand apron),
  and there are under 1,000 shallow pixels per metre of depth. The last build held blue and green at the pure-water
  absorption (0.015 and 0.062 /m), the clearest water physically possible; QAA replaces that with a measured value.
- The depth check is no test here: it assumes the brightest floor at each depth is the same sand, and here it is not.
  With QAA's Kd the apron at 10-15 m inverts to the albedo of pale carbonate sand (0.17 blue, 0.31 green) and the reef
  flat at 1-6 m stays dark (0.07-0.11), which is what the two floors are; the spread grows because they differ.
- Against the Whitsundays (QAA 0.090 / 0.108, from a fresh composite) this is the clearest water of the five sites in
  blue (0.047).
- QAA inputs: deep-water reflectance less a near-infrared offset of 0.0054, Rrs 0.0094 / 0.0065 / 0.0021 / 0.0003 /sr at
  443 / 492 / 560 / 665 nm, mean solar zenith 39.1 degrees; a(492) 0.031 /m, bb(560) 0.0029 /m, eta 1.95. At 30 m and
  60 m deep instead of 40 m: 0.048 / 0.086 and 0.048 / 0.085.
- Rinf: 0.0259 / 0.0121 / 0.0065 (offset included).
- Habitat (scaled by 1.107): shallow floor sand 58%, seagrass and algae 22%, rubble 15%, reef 5%.

## Places

| POI | source | check on the built terrain |
|---|---|---|
| Lady Elliot Island (way 15703996) | OSM | 3.0 m |
| Western beach (relation 13651843, unnamed) | OSM | 0.8 m, beach |
| Lady Elliot Island airstrip (aerodrome way 582781803, runway way 33686280) | OSM | 3.0 m |
| Old Lady Elliot Lighthouse (way 437359875) | OSM (Nominatim) | 2.3 m, west shore |
| Lady Elliot Island reef (relation 6492561, unnamed) | OSM | about 0 m (reef flat, dries at low tide) |
| West side, off the reef edge | nominal | 7.9 m |
| Gate toward Bundaberg | nominal | 27 m |

Spawn: on the upper sand of the western beach below the old lighthouse, 1.6 m (above the highest tide), facing the sea.
Start: 140 m up south-west of the island looking north-east across the cay and the airstrip.

## Harbour layout (checked with `window.__boats`)

Two yachts with tenders off the west side, one public mooring on the reef edge, a yacht and a dive boat between the gate
and the anchorage (both routes connect). No aircraft: the island is served by land planes on its airstrip, and the viewer
has only a seaplane and a helicopter.

## Known problems

- QAA rests on Sentinel-2 L2A over water, which keeps some sky reflection; habitat is inferred, not surveyed. No dive
  sites are mapped.
- The island's interior height is an assumption.
- A view from the beach shows the island as a wide sand plain: the 30 m terrain and the shore patch carry no vegetation
  until `life.js` adds trees.
