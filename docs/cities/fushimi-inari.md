# Fushimi Inari: the shrine and the mountain of torii

A map of Fushimi Inari Taisha and Inari-yama, 2.2 × 1.3 km, from JR Inari station to the summit
(一ノ峰, 233 m). It is one of the Kyoto maps beside [Central Kyoto](kyoto.md) and
[Higashiyama](higashiyama.md); figures and sources are in [kyoto-sights.md](kyoto-sights.md).

## Data

The sources are those of the other Kyoto maps:

- **Buildings**: 5,331 Overture footprints. 93.7% of the footprint area has a height from PLATEAU
  Kyoto City 2022 (CC BY 4.0).
- **Terrain**: GSI DEM5A laser terrain.
- **Imagery**: GSI aerial photographs at zoom 18.
- **Paths**: OpenStreetMap's paths, lamps and torii round the mountain, kept in
  `cities/fushimi-inari/inari_osm.json` (ODbL).

## What is built in code (`cities/fushimi-inari/city.py`, `pipeline/kyotokit.py`)

- **The Romon (楼門, 1589)**: a two-storey gate of about 14 m, vermilion under hinoki bark, with its
  corridors out to the ends of the mapped outline.
- **The foxes**: one either side of the gate, on tall plinths, sculpted as signed distance fields
  (`pipeline/sculptkit.py`). The one on the right as you face the gate holds a jewel; the one on the
  left holds a key. Each wears a red bib.
- **The worship halls**: the open outer worship hall (外拝殿, 1840) with gilt lanterns under its eaves,
  and the inner worship hall.
- **The main hall (本殿)**: rebuilt in 1499, with its front slope carried out over the steps.
- **The Senbon Torii**: one torii at a time along each of the two mapped tunnels, at the count OSM's
  survey gives, from a note on the ways (2014): 382 in one and 399 in the other.
- **The mountain's torii**: placed along the shortest mapped footpaths from the Okusha Hohaisho by
  Kumataka-sha to Yotsutsuji, then round the summit by the 三ノ峰, 二ノ峰 and 一ノ峰 shrines and back. They
  stand about 0.65 m apart, with random gaps and none within 7 m of a shrine. That makes about 3,150, a
  third of the roughly 10,000 on the mountain; the side paths have none.
- **How the torii are drawn**:
  - Four sizes, instanced (`landmarks.json` "props").
  - Each is vermilion, with black feet and a black lintel, and a ring at the heads of its pillars (稲荷鳥居).
  - A donor's name runs in black down the back of each pillar, so it shows as you come down.
- **The great torii** on the Omotesando.
- **Stone lanterns** at the 154 lamps OpenStreetMap maps along the paths, lit after dark.

## The game: Fushimi Inari on Foot

From Hommachi-dori, south of JR Inari station (where the player's car has a kerb with room to drive off), through the Romon, you meet a shrine attendant, then a shopkeeper at the mouth
of the Senbon Torii, then a hiker resting at Yotsutsuji, where Kyoto opens out to the west.

## What is approximate

- **The torii**:
  - Their sizes are four stand-ins; no published list of the size grades (号) was found.
  - The spacing on the mountain paths, and where the gaps fall, is not surveyed.
  - The Senbon Torii's counts come from OSM's survey note, not from the shrine.
- **The halls**: their heights are read from photographs and PLATEAU's blocks.
- **The Romon**: its width is the usual three bays, about 10 m.
- **The torii and the game**: the torii are props, not solid. Walkers pass between the pillars, and
  through them where a path bends.
