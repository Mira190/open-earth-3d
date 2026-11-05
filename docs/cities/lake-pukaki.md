# Lake Pukaki: an alpine lake and Aoraki / Mount Cook from open data

> Lake Pukaki and Aoraki / Mount Cook, 38 × 84 km of the Mackenzie District in Canterbury, rebuilt from LINZ's LiDAR
> terrain and aerial photos, a summer satellite mosaic, mapped places, and the real sun, moon and stars. Open it from
> the globe (**Mackenzie**), or `web/reef/index.html?city=lake-pukaki`. Paths are relative to the repository root.

| The view up the lake from Peter's Lookout (a long lens, late afternoon) | On the phone |
|---|---|
| ![](../images/lake-pukaki/hero.jpg) | ![](../images/lake-pukaki/phone.jpg) |
| **From 2 km up over the south end** | **In the tussock by the lookout** |
| ![](../images/lake-pukaki/aerial.jpg) | ![](../images/lake-pukaki/ground.jpg) |
| **Dusk on the south shore** | **The dark-sky reserve's night** |
| ![](../images/lake-pukaki/dusk.jpg) | ![](../images/lake-pukaki/night.jpg) |

## 1. Which area, and why

The lake and the mountain it is famous for belong together, so the frame runs from the south shore up the lake and
the Tasman Valley to Aoraki and the Main Divide. NZTM2000 E 1352000–1390000 and N 5098000–5182000 is turned into the
site's own frame: a transverse Mercator on its centre (170.1506°E, 43.8576°S; `pipeline/cityctx.py`), x −19.2 to 19.2
km and y −42.24 to 42.24 km. That is Mackenzie District, Canterbury, from the Pukaki Dam and the visitor centre on the
south shore to the névé of the Tasman Glacier, with the West Coast's side of the Divide at the western edge.

Lake Tekapo, 25 km east across the basin, is a separate map in the same **Mackenzie** group. It is built in its own
session on this site's pipeline and viewer. Folding it into this frame would double the data for a separate view.

## 2. What is in it

| Layer | Source (licence) | In the model |
|---|---|---|
| Terrain | Toitū Te Whenua LINZ, *New Zealand LiDAR 1m DEM*: the national composite of every capture, here Canterbury – Mackenzie 2015 in the south and 2020 captures in the north (CC BY 4.0), read from its Cloud-Optimized GeoTIFF overviews at 16 m. Where it has gaps on land: *New Zealand Contour-Interpolated 8m DEM* (Geographx, CC BY 4.0) | `terrain.bin.gz`: 1280 × 2816 cells at 30 m, in 0.125 m steps above the lake's surface (section 3) |
| Ground colour | LINZ, *New Zealand 10m Satellite Imagery (2025–2026)*: a colour-balanced summer Sentinel-2 mosaic (CC BY 4.0) | `ground_0..2.webp` at 10 m, in strips a phone can hold |
| Aerial detail | LINZ, *Mackenzie 0.3m Rural Aerial Photos (2021)* and *Canterbury 0.3m Rural Aerial Photos (2015–2016)* (CC BY 4.0) | `detail_*.webp` at 0.75–0.9 m round Peter's Lookout, the south shore, Mount Cook Village and the Hooker Valley, loaded as the camera comes near (section 4) |
| Lakes, glaciers, scree, scrub, woods, roads, tracks, buildings, places | OpenStreetMap contributors (ODbL), read through Overture Maps 2026-10-21.0 | 29 lakes in `lakes.png`; land cover in `cover.png` (with the imagery); `roads.json`; `structures.json`; 51 POIs in `cities/lake-pukaki/city.json` |
| The lake's water | Sentinel-2 L2A over open water (Earth Search), the mosaic's own lake colour, and the published Secchi depth | `scene.json` optics (section 5) |
| Sun, moon, stars | NOAA solar position (`web/sun.js`); the moon from its age; the sky's rotation from sidereal time; the Milky Way on the J2000 galactic plane | the light, the sky, the night (section 6) |

Build:

```bash
python pipeline/fetch_linz.py --city lake-pukaki
python pipeline/fetch_overture.py --city lake-pukaki --only water segment building land land_use infrastructure
python pipeline/build_alpine.py --city lake-pukaki
python pipeline/alpine_detail.py --city lake-pukaki
python pipeline/far_land.py --city lake-pukaki
python pipeline/alpine_snow.py --city lake-pukaki
python pipeline/marine_meta.py --city lake-pukaki
```

`alpine_snow.py` maps the season's snow from the latest clear Sentinel-2 passes. For this build that is 22 and
24 October 2026, two relative orbits, because one swath covers only part of the frame. Snow is NDSI > 0.4 with B08 >
0.11, cloud is excluded by the scene classification layer, and the result is `snow.png` at 20 m. The summer mosaic
alone shows the end of summer's snowline. The viewer lays the spring snow over it from June to November, at half
strength in December, and drops it from January to March.

`far_land.py` adds the land past the frame. For an alpine site that is a ring 100 km either side of the centre:
Copernicus GLO-30 relief at 195 m, and WorldCover's classes coloured from the site's own imagery. `web/reef/farland.js`
lowers it by the lake's height, so it meets the frame's edge. Landmark models are placed from city.json
`landmarks` ({id, glb, lonlat, ground_m, walk?: "deck"}; `web/reef/alpine/landmarks.js`). Lupin drifts the land cover
cannot tell come from `flora.lupins` ({lonlat, r_m, density}). `tools/site_shots.js` renders a site's `shots` on a
desktop and a phone.

The last command refreshes the POIs, spawn and helicopter after a `city.json` edit, with no raw data needed.

## 3. Terrain and lakes

The LiDAR has no returns over water. Near the shores it is flattened to the water's surface; further out it is
blank. Each OpenStreetMap lake outline (and the LiDAR gaps inside it) is a lake. Its surface is the median of the
flattened LiDAR inside it:

| Lake | Surface (m NZVD2016) | Area in the model | Bed |
|---|---|---|---|
| Lake Pūkaki | 525.8 | 172.7 km² (Wikipedia gives 178.7 km² over the whole operating range) | to 70 m, the depth Lakes380 publishes |
| Tasman Lake | 704.0 | 8.1 km² | synthesised |
| Hooker Lake | 866.5 | 1.8 km² | synthesised |
| Mueller Lake | 753.0 | 1.0 km² | synthesised |

The whole grid is shifted so that Pukaki's surface is 0. The reef viewer's water code then works as it is: swimming,
the water column, boats and the helicopter's height. Only the main lake is that water. Everywhere else the bed the
water code sees is held above it, so the land below the lake's level stays dry: the Pukaki flats past the dam and the
West Coast's valleys, down to 70 m above the sea. The other lakes have their own flat surfaces (`web/reef/alpine/lakes.js`).

No open survey of the lake beds exists. Each bed is synthesised: depth grows from the shore with the distance to it,
steep at the sides and flat in the middle, to the lake's maximum depth. In glacial-flour water you see a metre or two
down at most, so only the shallow shelf shows.

The grid is stored as the residual of the plane through each cell's left, upper and upper-left neighbours, with all
the low bytes and then all the high bytes, gzipped: 3.4 MB where the plain grid is 5.9 MB
(`build_alpine.py encode_heights`, `web/reef/alpine/data.js decodeHeights`).

## 4. Land cover and the ground up close

`cover.png` holds one class per 20 m (`build_alpine.py COVER`): lake, river, snow and ice, debris-covered ice, rock and
cliff, scree and moraine, riverbed gravel, tussock, alpine herbfield, scrub, forest, pasture, wetland, road, built, shore.
The classes come from the imagery's colour (lightness, saturation, green), the slope and the height, with
OpenStreetMap's mapped glaciers, scree and shingle, scrub and heath, and woods on top, and a 3 × 3 majority filter.
They steer the detail only: the colour is always the imagery's.

The ground's detail is layered by distance:
- **Beyond a few km:** the 10 m colour.
- **Within 1.5 km of the four aerial patches:** the 0.75 m photos, colour-matched to the mosaic below 40 m (a low-pass
  transfer), so a 2021 summer photo sits in the 2025–26 mosaic without a seam.
- **Within about 1 km:** grain and relief by class: hummocks in tussock, stones in scree, strata in rock, glints in snow.
- **Within 240 m:** a 2 m patch on a bicubic read of the grid plus that relief. Its CPU twin (`terrain.heightAt`) is
  the surface the player and the people stand on.
- **Within 40 m:** a turf of short grass on the grassy classes (and on "built" ground where the imagery is green):
  tufts of 15 blades 9–28 cm tall, five or six a square metre near the eye (fewer on a phone) and thinning outward. The blades are a
  living spring green, each its own shade, one in twelve dry straw, leaning a third of the way toward the colour of the
  10 m mosaic under the tuft and darker at the foot: from the side a blade shows its own green, not the litter and soil
  the satellite mixes in from above. The shader shrinks them to nothing before 40 m, so the turf has no edge as the
  camera moves.
- **Within 100–220 m:** plants and stones, placed by tile (`web/reef/alpine/flora.js`):
  - tussock clumps of 64 blades near and 18 further out, swaying in rolling gusts and lit through from behind;
  - matagouri on scrub: a metre-high tangle of crooked grey twigs with spines, greener at the tips;
  - stones on scree, moraine and gravel, few inside a lupin stand.
- **Russell lupins, to 340 m:** in drifts (below).

Every placement draws from one integer hash per tile. Until November 2026 it returned values from −0.5 to 0.5 rather
than 0 to 1 (a signed XOR), so half of every draw passed every test: tussock stood at nearly every spot, stones were
smaller than meant, no matagouri was ever placed, and every lupin came out purple or violet. It is unsigned now, and
the thresholds were set again for about the density the tussock and stones had.

Lupins flower from September to February (NZPCN), from November to February on the Mackenzie's riverflats (DOC's
braided river field guide), and are at their best from mid-November to the end of December. The share in flower
follows the clock's month. Their colours run blue to purple in wild stands, with pinks, white and a little yellow;
no count of the shares is published, so the mix is a judgement from photographs.

They grow in drifts, as on the shore in photographs: on the shore and the riverbed gravel, on the road verges, and on
the grass, tussock and scrub slopes above a shore, a lake or a riverbed (full within 30 m of the water, thinning out to
90 m), wherever a low-frequency noise (stands tens of metres across, ragged at the edges) says a stand is. The site's
`flora.lupins` patches are stands on top of that, and the only ones on "built" ground (the grounds of the Church of the
Good Shepherd). In a full stand they stand 1.4 plants a square metre, touching. Each stand is mostly one colour, with a
second and a few odd plants of any colour. A plant is a clump: nine spikes of 0.5–1.1 m, the tallest in the middle,
nearly as thick as their foot for most of their length and tapering to buds, florets raised in whorls, speckled paler
(the banner petals) and opening from the foot up, over a mound of palmate leaves (fans of 11 leaflets on their stalks).
Three forms by distance, from one set of spots so that a plant stays put as it changes form: whole plants within 12 m,
plainer ones (five cone spikes, six leaves) to 55 m, and beyond, out to 340 m, patches of nine spikes over small leaf
domes, 1.4 m across, one instance each, so the drifts on a shore a few hundred metres below a lookout still read as a
band of colour. The far ring is filled a few milliseconds a frame and swapped in when done. A phone gets fewer and
nearer.

## 5. The lake's colour

Glacial flour makes the water bright and opaque. The values used:
- **Attenuation** `K` = 5.0, 3.6 and 3.9 per metre for red, green and blue. The green value is Kd = 1.7 / Secchi
  depth (Poole and Atkins), on the published means of 0.5 m (Irwin 1978) and 0.41 m (James and Graynoth 2002). Those two
  figures were read in search excerpts only; the papers' pages refused the fetch. Red and blue are in the ratios QAA
  gives. QAA alone gives 0.16 per metre on the lake's Sentinel-2 colour, and misses most of the flour's scattering.
- **Colour of deep water** `Rinf` = 0.03, 0.27 and 0.49. The mosaic's own lake colour, linearised (0.001, 0.111,
  0.249), is raised to match photographs taken at the lake: the satellite looks straight down, and from the shore the
  milky water is brighter against the tussock than the mosaic has it.

The numbers are in `cities/lake-pukaki/analysis/optics.json`. The lake reflects the mountains (a planar reflection,
`?mirror=0` turns it off). The wind breaks the image into a blur of sky, and a rough lake reflects less at a grazing
view than a flat one, so the turquoise holds.

## 6. Air, light and sky

`web/reef/alpine/atmos.js` is one model for the sky dome, the sky the lakes reflect, and the haze between the eye and
the land, so a ridge 70 km away fades into the sky behind it:
- **The model:** single scattering in an atmosphere of air molecules (Rayleigh: 5.802, 13.558, 33.1 × 10⁻⁶ m⁻¹, scale
  height 8 km) and aerosol (Mie: 2.2 × 10⁻⁶ m⁻¹, scale height 1.2 km, g = 0.78; set low for the Mackenzie's clear, dry
  air). It runs over a curved Earth, with an ozone layer.
- **The column of air** along a ray is the Chapman function, by Schüler's approximation, continued below the horizon
  through the ray's lowest point.
- **Multiple scattering** is one isotropic term.
- **No look-up tables:** it is the same single pass on WebGPU and WebGL2.
- **The constants are the standard ones** (Bruneton and Neyret 2008, Hillaire 2020). The implementation is this
  project's own; no code was taken.

The **photographic response** is a deliberate departure from the physics. Three display primaries sampling Rayleigh's
spectrum give a clear sky too much green, and a camera shows it bluer and brighter than its true share of the
light. So the sky and the haze share one gain and tint (`PHOTO` in atmos.js). The look was set against photographs of
the lake: the classic long-lens view from Peter's Lookout, with tawny tussock, the road, turquoise water, Aoraki
filling the frame and cumulus building on the Divide.

**Twilight** takes over once the sun is low:
- a warm glow over the sun's point on the horizon;
- a deep blue zenith;
- opposite the sun, the pink anti-twilight arch over the Earth's shadow;
- brightness from the reef viewer's measured skylight curve (`main.js skyLight`), so dusk joins the day and the night.

**Night** is the Aoraki Mackenzie International Dark Sky Reserve (Bortle 2):
- the Milky Way laid on the J2000 galactic plane, brighter and wider toward the bulge in Sagittarius, with dust lanes;
- the Magellanic Clouds at their real positions (circumpolar, due south);
- stars from a hashed grid: the positions and counts are not a catalogue;
- the sky turned by sidereal time for the clock.

**The light on the land** (`web/reef/alpine/light.js`):
- the sun's colour through the air to the eye's height;
- the sky's irradiance from the same model;
- a golden bounce off the tussock;
- the mountains' shadows from a pass that marches every cell's ray toward the sun over the height grid, with the
  Earth's curve and the sun's disc. It runs again only when the sun has moved.

**Clouds** (`web/reef/alpine/clouds.js`, `?clouds=0..1`) are soft-edged cumulus puffs over the high peaks, with flat
bases at about 2,350 m: the cloud a westerly builds on the Divide on a fine day. They are sheets facing the camera, not
volumes.

**Tone and exposure:**
- tone mapping is the title screen's curve family (Khronos PBR Neutral), not ACES, which turns the sky and the lake grey-teal;
- exposure opens up as the light goes, as a photographer's does, until the eye's own adaptation takes over at dusk;
- the depth buffer is logarithmic, so a far shore never flickers into its lake. Three.js r186 cannot resolve a
  reversed float depth buffer from a multisampled pass on WebGL2.

## 7. The game

`web/reef/game/lake-pukaki.js`; every line is computed from the model or cites a page that was read (docs/GAME_REEF.md).
The people are Microsoft Rocketbox avatars (MIT, the same files as the cities' NPCs; `web/reef/people.js` builds one
when a person's look names it). You walk in hiking clothes; an alpine site has no stinger season and no sea temperature.

![Hana at Peter's Lookout](../images/lake-pukaki/hana.jpg)


| Who | Where | What |
|---|---|---|
| Hana, Department of Conservation ranger | Peter's Lookout, by the spawn | the lake's colour, size, levels and hydro storage, the drowned island on the five-pound note; Aoraki's height and summits, how far it is over the model, its height in the model; the lupins in their season |
| Tom, stargazing guide | the south shore by the visitor centre | the dark-sky reserve; tonight's sunset and moonrise; how high the Milky Way's centre stands now, from the sky the viewer draws; can wait for dark with you |
| Mia, helicopter pilot | the pad at Glentanner | the Tasman Glacier; a flight round Aoraki |
| Eli, a walker | White Horse Hill | the Hooker Valley Track |
| Signs | Peter's Lookout; the Alpine Memorial | the board's height, the peaks in sight over the terrain with their heights; the memorial's inscription |

Quests:
- **The view up the lake:** read the board, then line Aoraki up over the water.
- **Lupins on the shore:** walk down from the lookout to the water.
- **Aoraki from the air:** take the helicopter, come within 2 km of the summit above 3,000 m, land and step out.
- **The Hooker Valley:** the Alpine Memorial, the bridges, the lake.
- **A dark night:** be on the south shore after nautical dusk.

No character speaks as or for Ngāi Tahu. Aoraki's place in their tradition is left to sources this build did not read in full.

Sources read on 2026-11-05:
- Wikipedia: *Lake Pukaki*, *Aoraki / Mount Cook*, *Tasman Glacier*, *Hooker Valley Track*, *Aoraki Mackenzie International Dark Sky Reserve*.
- Lakes380's Lake Pukaki datasheet.
- NZPCN's *Lupinus polyphyllus*.

## 8. Checked, and not

- **Checked:** `?gametest=1` on this site (32 checks, including the lint of every line and source) and on the
  Whitsundays (66, unchanged).
- **Checked:** stills on a desktop (1440 × 900) and a phone (390 × 844) at day, dusk and night, in software WebGL2 (Mesa).
- **Not checked:** a real GPU, WebGPU, Safari or iOS. The planar reflection renders the scene twice; on a slow device
  turn it off with `?mirror=0` and the plants with `?flora=0`.
- **Open:** the Hermitage and the visitor centre as models; SH80 as a road surface with markings; cars on the highway;
  a real star catalogue; volumetric clouds (issue #204).
