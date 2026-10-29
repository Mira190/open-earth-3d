# The Whitsundays: a marine world from open data

> The Whitsunday Islands and the inner Great Barrier Reef, 33 × 33 km around Whitehaven Beach, rebuilt from
> survey bathymetry, a Sentinel-2 composite, mapped places and the official tide, and lit by the real sun and
> moon. Open it from the globe, or `web/reef/index.html?city=whitsundays`. Paths are relative to the repository root.

## 1. What is in it

| Layer | Source | In the model |
|---|---|---|
| Sea floor and land heights | AusSeabed / Geoscience Australia, *Great Barrier Reef Bathymetry 2020*, 30 m (not for navigation) | `terrain.bin`: 1114 × 1107 cells at 30 m, decimetres about MSL |
| Colour of the sea floor and the land | Sentinel-2 L2A (Copernicus open licence) via Earth Search on AWS: 22 scenes from 11 passes, 27 March to 11 October 2026. A pass's two MGRS tiles (55KFT and 55KGT) are taken together, so both sides of the tile edge see the same dates; these are all the passes since 1 October 2025 with both tiles under 12% cloud (none from October to late March). Bands B2, B3, B4, B8 at 10 m and B1 (443 nm) for the water's optics | `ground.jpg` at 10 m, the sea floor *inverted through the water column* (section 2) |
| Land cover | ESA WorldCover 10 m 2021 v200 (CC BY 4.0) | `habitat.png` land classes |
| Places | OpenStreetMap (ODbL), read through Overture Maps 2026-10-21.0 | 33 POIs in `cities/whitsundays/city.json`: beaches, lookouts (some with their Ngaro names as mapped), peaks, the Hamilton Island marina and airport, the Whitehaven Beach helipad, and nominal anchorages |
| Tide | Maritime Safety Queensland, Shute Harbour predicted interval data (CC BY 4.0), Queensland open data portal | `tide.json`: 60 constituents per year (section 4) |
| Sun and moon | NOAA solar position (`web/sun.js`); the moon from its age and the sun's position | the light, the sky, glitter, caustics, the night |

Build: `pipeline/fetch_gbr_bathy.py`, `fetch_sentinel.py`, `build_marine.py` (which calls `qaa.py` and
`marine_meta.py`), `fetch_tide.py`, all with `--city whitsundays` (the bathymetry fetcher takes the id as its
argument); `check_marine.py` checks the POIs on the result.

## 2. The water column

The satellite does not see the sea floor; it sees the floor through the water. The build inverts the water
column (Maritorena et al. 1994) to get the floor's own colour, and the viewer puts the same water back:

    R = A e^(-g Kd z) + Rinf (1 - e^(-g Kd z))

`Rinf` is the reflectance of optically deep water (deeper than 40 m, smoothed into a map), `Kd` the diffuse
attenuation, and g = 2.2 for the sun's path down and the sensor's path up. `Kd` comes from the colour of the
deep water: Lee's quasi-analytical algorithm (QAA_v6) gives its absorption and backscattering, and Lee et al.
(2005) turn those into Kd (`pipeline/qaa.py`). The first build fitted Kd from how the brightest (sandy) floor
darkens with depth; that fit is still made and is used only if it passes a test (the profile is straight,
residual sd of ln(R - Rinf) at most 0.06, and it leaves the sand within 20% across 1-15 m). Here it fails: the
residual sd is 0.16 in blue and 0.10 in green, most likely because the brightest shallow floor (pale silica
sand) is not the floor that is brightest deeper down. From `cities/whitsundays/analysis/optics.json`:

| Band | Kd used (1/m) | Depth fit | QAA | Rinf (median) | Note |
|---|---|---|---|---|---|
| Blue (492 nm) | **0.090** | 0.061 (first build 0.054) | 0.090 | 0.028 | QAA; the fit fails the test |
| Green (560 nm) | **0.108** | 0.086 (first build 0.080) | 0.108 | 0.017 | QAA; the fit fails the test |
| Red (665 nm) | **0.40** | 0.20 | 1.16 | 0.0017 | pure water's absorption at 665 nm: the fit is unreliable over 0.5-4 m, and QAA's red rests on an Rrs(665) of 3e-4 /sr |

QAA's inputs: the median reflectance of 4.45 million pixels deeper than 40 m, less their near-infrared reading
(0.0004) as an offset, divided by π: Rrs 0.0081, 0.0084, 0.0048 and 0.0003 /sr at 443, 492, 560 and 665 nm, with
the scenes' mean solar zenith angle of 38°. The 22 scenes span two tiles whose atmospheric corrections differ:
west of x ≈ -2.3 km (just west of Hill Inlet) the water reads about 0.003 higher in the near infrared and 0.0035
in blue. The line crosses Whitsunday Island and water mostly too deep for its floor to show, and the local
`Rinf` map takes most of the offset up: no step shows in `ground.jpg`.

The check is whether sand looks the same at every depth once the water is taken out. The spread of sand
brightness across 1-15 m falls from 101% (raw) to 18% in blue and from 130% to 29% in green. With the depth fit
it would be 38% and 31%, and with the first build's Kd 47% and 37% (that build, on its own composite, reported
43% and 29%). What is left in green is the 6-10 m floor reading brighter (0.33) than the floors above and below
it (0.25-0.29): QAA's green may be a little high, as the surface-reflectance product keeps some sky reflection.

**Habitat** classes come from the inverted floor colour and depth with thresholds in `build_marine.py`; they
are *inferred, not surveyed*: deep water 59.2%, rubble 12.3%, sand 6.2%, reef and rock 5.1%, seagrass and algae
1.4%, forest 13.3%, beach and bare 1.5%, mangrove 0.5%. The brightness thresholds scale with the scene's bright
floor, which reads 1.23 times the first build's with the new Kd. The green-cast test for seagrass does not
scale, and the deeper floor now reads bluer: the first build's 4.1% of seagrass lay mostly 11-23 m deep, where
the floor colour is mostly filled in rather than seen, and three quarters of it is now rubble. Beach and bare
gained the intertidal margin that the land cover calls water (it was deep water before). The Allen Coral Atlas
would be the right source for the reef classes.

## 3. How the water is drawn

Everything below is derived from the same few quantities, not tuned per view.

- **Waves.** Swell and wind chop are 13 Gerstner waves that move the surface, the boats and the swimmer. The
  short waves are tiles: ripples (0.3-2.4 m, 32 waves) and, for the chop's shading at range, a coarser tile
  (3-24 m, 32 waves), each rendered every frame into mipmapped gradient (and, for the ripples, Hessian)
  textures. Mip levels average what a pixel covers, so distant water and distant caustics settle to their
  mean instead of shimmering. A wave fades from the shading when its phase moves more than about a radian per
  pixel, and from the mesh when the rings no longer sample it twice.
- **Sun and moon glitter** follow Cox and Munk (1954): the slopes a pixel cannot show (the variance the mips
  lose, and the waves that faded) are a Gaussian slope distribution around the slope it can show, with Smith
  shadowing and masking. One law gives tight sparkle at your feet and a broad glitter path at the horizon, and
  the moon's silver path at 2.3e-6 of the light. The ripples calm with the wind as the Cox-Munk variance does.
- **Whitecaps** form where the crests compress the water most; their threshold follows the wind so the cover
  stays near Monahan and O'Muircheartaigh's (1980) 3.84e-6 U^3.41. **Breakers** form where the wave height
  passes 0.78 of the depth (McCowan) and ride the crests.
- **Caustics** are 1/|det(I - c D H)| from the Hessian of the same waves, shifted toward the sun and fading
  with depth; the light shafts under water march through the same field.
- **Refraction.** From above, the frame behind the water is resampled along each pixel's normal by an amount
  that grows with the water the ray crosses. From below: Snell's window, total internal reflection beyond it,
  and a window edge as ragged as the slopes under the pixel.
- **The light field under water.** Just under the surface the upwelling radiance is about 1.9 times the
  water-leaving radiance the satellite sees (rrs = Rrs / (0.52 + 1.7 Rrs), Lee et al. 2002). In clear water
  the horizontal radiance is about three times the nadir and the zenith some tens of times (the asymptotic
  distributions measured since Tyler 1960). The veil a diver sees and the mirror beyond Snell's window follow
  that distribution.
- **Light and the eye.** The sun, the moon (Allen's phase law) and the sky (through civil, nautical and
  astronomical twilight to starlight) light the scene in true proportion. An adapting eye leaves everything
  brighter than sunset alone, shows a moonlit beach at about a tenth of its day brightness, and fades colour
  toward blue past a few hundred times adaptation (the Purkinje shift).

## 4. The tide

The terrain is in m MSL, and Whitsunday tides run to about 4 m at springs, so the waterline, Hill Inlet's
sand banks and the reef flats all move through the day. `pipeline/fetch_tide.py` reads Maritime Safety
Queensland's official 10-minute predictions for Shute Harbour through the open data portal's datastore API
and fits 60 harmonic constituents to each year:

| Year | Samples | Fit RMS | Largest error | Range about MSL | M2 |
|---|---|---|---|---|---|
| 2025 | 52 560 | 2.4 cm | 9.4 cm | -1.83 to +2.20 m | 0.98 m |
| 2026 | 52 560 | 2.4 cm | 8.9 cm | -1.85 to +2.31 m | 0.99 m |

The portal's API does not state the time base. MSQ publishes in AEST, and that was checked: the fitted M2
Greenwich phase is 24.6° (2025) and 24.7° (2026). NASA's GOT4.10c global model (public domain) gives 17° to 54°
in the nearest ocean cells, and a UTC time base would have put the phase near 315°. Shute Harbour is on the
mainland 25 km west of Whitehaven, so on the islands' eastern shores the times and heights differ by some
minutes and centimetres. The viewer evaluates the tide for its clock every frame (`?tide=` fixes it).

## 5. Checks

**Summits.** The 30 m terrain against the elevations OpenStreetMap carries for the island summits:

| Summit | OSM ele (m) | Model, highest cell within 150 m | Difference |
|---|---|---|---|
| Babieca Summit | 191 | 208 | +17 |
| Bolton Hill | 205 | 200 | -5 |
| Whitsunday Craig | 354 | 340 | -14 |
| Passage Peak | 235 | 211 | -24 |
| Whitsunday Peak | 435 | 415 | -20 |
| Mount Robinson | 390 | 388 | -2 |
| Whitsunday Cairn | 385 | 346 | -39 |

Median -14 m. A 30 m grid cuts sharp summits, so a negative bias is expected; the island shapes are right.

**Places.** `pipeline/check_marine.py` samples every POI on the built terrain
(`cities/whitsundays/analysis/poi_check.json`): Whitehaven Beach is at 0.8 m, Betty's Beach 0.2 m, and the
spawn 2.1 m (1.2 m in the first build; the terrain moved, below). Four mapped beach points lie outside the
-0.5 to 2.5 m a beach is checked for, as in the first build: South Whitehaven 9.3 m, Chance Bay 9.2 m, Catseye
4.7 m and Chalkies -1.6 m. They are OpenStreetMap's points for the beaches, which sit behind the sand or just
off it. The anchorages are 5.4 m deep at Cid Harbour, 4.6 m at Tongue Bay, 4.8 m at South Whitehaven and 7.3 m
at Nara Inlet. The nominal Chalkies anchorage is 40.6 m deep, and the boats anchor 570 m north-north-east of it
at 5-9 m. Three nominal spots were wrong and are fixed: the South Whitehaven anchorage stood on
land, and three of the boats' old hard-coded spots (Tongue Bay, Chalkies, the Hamilton marina) were 2-3.5 km
from the mapped places.

**The terrain's edges and position.** The first build cropped the survey grid at the bounding box: its west
edge column was no-data (-3200 m, filled from its neighbours afterwards), and the crop window was rounded to
whole pixels while the box corner was kept as the origin, which put the terrain 5.6 m south and 5.2 m west of
where it belongs. `fetch_gbr_bathy.py` now crops on whole pixels with two to spare, and `build_marine.py` fills
any cell outside the survey from the nearest covered one (none here). The move changes half the cells by less
than 0.1 m and 1% by more than 3.4 m (on steep shores and cliffs).

**The player** (`?autotest=1&player=1`): 39 checks, from walking and wading to scuba hover and climbing out
onto the marina jetty, all pass. On this build the game test (`?gametest=1`, 59 checks) passes too, and all
nine AI boat routes connect at tides of -1.8, 0 and +2.3 m.

## 6. Known problems

- WebGPU is untested here: everything was checked on software WebGL2 in a headless browser.
- The swell is four waves; their interference is regular. The chop and ripples are broadband tiles, but a
  cascaded FFT ocean (WebGPU compute) would be the right way, with the sine bank kept for WebGL2.
- Foam has no memory: no advection, no persistence behind a breaking wave.
- Kd is one value for the whole area; the water is clearer offshore. The two Sentinel-2 tiles' atmospheric
  corrections differ (section 2); it no longer shows as a seam in `ground.jpg`.
- Shorelines come from a 30 m grid; `shore.js` adds 2 m detail near the camera, and the water's depth lookup
  uses the coarse grid, so the waterline and the detailed sand can disagree by tens of centimetres.
- Habitat classes are inferred, not surveyed.
- The tide is Shute Harbour's, not the islands' own.
