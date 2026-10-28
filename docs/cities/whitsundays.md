# The Whitsundays: a marine world from open data

> The Whitsunday Islands and the inner Great Barrier Reef, 33 × 33 km around Whitehaven Beach, rebuilt from
> survey bathymetry, a Sentinel-2 composite, mapped places and the official tide, and lit by the real sun and
> moon. Open it from the globe, or `web/reef/index.html?city=whitsundays`. Paths are relative to the repository root.

## 1. What is in it

| Layer | Source | In the model |
|---|---|---|
| Sea floor and land heights | AusSeabed / Geoscience Australia, *Great Barrier Reef Bathymetry 2020*, 30 m (not for navigation) | `terrain.bin`: 1114 × 1107 cells at 30 m, decimetres about MSL |
| Colour of the sea floor and the land | Sentinel-2 L2A (Copernicus open licence) via Earth Search on AWS: 28 scenes, 8 October 2025 to 11 October 2026, 14 each on MGRS tiles 55KFT and 55KGT | `ground.jpg` at 10 m, the sea floor *inverted through the water column* (section 2) |
| Land cover | ESA WorldCover 10 m 2021 v200 (CC BY 4.0) | `habitat.png` land classes |
| Places | OpenStreetMap (ODbL), read through Overture Maps 2026-10-21.0 | 33 POIs in `cities/whitsundays/city.json`: beaches, lookouts (some with their Ngaro names as mapped), peaks, the Hamilton Island marina and airport, the Whitehaven Beach helipad, and nominal anchorages |
| Tide | Maritime Safety Queensland, Shute Harbour predicted interval data (CC BY 4.0), Queensland open data portal | `tide.json`: 60 constituents per year (section 4) |
| Sun and moon | NOAA solar position (`web/sun.js`); the moon from its age and the sun's position | the light, the sky, glitter, caustics, the night |

Build: `pipeline/fetch_gbr_bathy.py`, `fetch_sentinel.py`, `build_marine.py` (which calls `marine_meta.py`),
`fetch_tide.py`, all with `--city whitsundays` (the bathymetry fetcher takes the id as its argument).

## 2. The water column

The satellite does not see the sea floor; it sees the floor through the water. The build inverts the water
column (Maritorena et al. 1994) to get the floor's own colour, and the viewer puts the same water back:

    R = A e^(-g Kd z) + Rinf (1 - e^(-g Kd z))

`Rinf` is the reflectance of optically deep water (deeper than 40 m, smoothed into a map), `Kd` the diffuse
attenuation, fitted per band from how the brightest (sandy) floor darkens with depth, and g = 2.2 for the
sun's path down and the sensor's path up. From `cities/whitsundays/analysis/optics.json`:

| Band | Kd (1/m) | Rinf (median) | Note |
|---|---|---|---|
| Blue | 0.054 | 0.026 | fitted on 2-20 m |
| Green | 0.080 | 0.016 | fitted on 2-12 m |
| Red | **0.40** | 0.0013 | the fit (0.19) is unreliable over 0.5-4 m; pure water's absorption at 665 nm is used as a floor |

The check is whether sand looks the same at every depth once the water is taken out. It is reduced, not solved:
the spread of sand brightness across 1-15 m falls from 103% to 43% in blue and from 136% to 29% in green.

**Habitat** classes come from the inverted floor colour and depth with thresholds in `build_marine.py`; they
are *inferred, not surveyed*: deep water 60.6%, rubble 9.7%, sand 5.6%, reef and rock 5.6%, seagrass and algae
4.1%, forest 13.3%, mangrove 0.5%. The Allen Coral Atlas would be the right source for the reef classes.

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
| Whitsunday Craig | 354 | 341 | -13 |
| Passage Peak | 235 | 213 | -22 |
| Whitsunday Peak | 435 | 416 | -19 |
| Mount Robinson | 390 | 388 | -2 |
| Whitsunday Cairn | 385 | 347 | -38 |

Median -13 m. A 30 m grid cuts sharp summits, so a negative bias is expected; the island shapes are right.

**Places.** Every POI was checked against the terrain: Whitehaven Beach is at -0.2 m, Betty's Beach 0.4 m,
Catseye Beach 3.5 m. Three nominal spots were wrong and are fixed: the South Whitehaven anchorage stood on
land, and three of the boats' old hard-coded spots (Tongue Bay, Chalkies, the Hamilton marina) were 2-3.5 km
from the mapped places. The west edge column of the terrain was nodata (-3200 m) and is filled from its
neighbours.

**The player** (`?autotest=1&player=1`): 39 checks, from walking and wading to scuba hover and climbing out
onto the marina jetty, all pass.

## 6. Known problems

- WebGPU is untested here: everything was checked on software WebGL2 in a headless browser.
- The swell is four waves; their interference is regular. The chop and ripples are broadband tiles, but a
  cascaded FFT ocean (WebGPU compute) would be the right way, with the sine bank kept for WebGL2.
- Foam has no memory: no advection, no persistence behind a breaking wave.
- Kd is one value for the whole area; the water is clearer offshore. The Sentinel-2 seam at the MGRS tile
  overlap is reduced but visible in `ground.jpg`.
- Shorelines come from a 30 m grid; `shore.js` adds 2 m detail near the camera, and the water's depth lookup
  uses the coarse grid, so the waterline and the detailed sand can disagree by tens of centimetres.
- Habitat classes are inferred, not surveyed.
- The tide is Shute Harbour's, not the islands' own.
