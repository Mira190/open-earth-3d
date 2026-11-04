# Tsukishima

A map of Tokyo ([Tokyo as maps](tokyo-maps.md)): Tsukishima, Tsukuda and Kachidoki on the islands at
the Sumida's mouth, with Tsukiji across the river. Frame: 1.8 × 1.6 km round 139.783 E, 35.664 N.

## Data

Overture Maps 2026-10-21.0 footprints and water, Project PLATEAU LOD2 heights (CC BY 4.0, via
indigo-lab's vector tiles), GSI DEM5A terrain and GSI aerial photographs. 67% of the footprint area
stands at a PLATEAU-surveyed height. The Sumida, the canals and the bay are drawn as water.

## Dressing and landmarks (`cities/tsukishima/city.py`)

- **Monja Street** (西仲通り): the buildings within 9 m of Nishinaka-dori, from the station end to
  Tsukishima 3-chome, get boards and blade signs of monjayaki, okonomiyaki and teppanyaki shops
  (typical trades, no real shop's sign), and the street has a lit gate at the station end.
- **The bridges over the water** (`districtkit.water_bridges`): every bridge OpenStreetMap outlines
  over the water, or maps only as centre lines (one per carriageway, joined by name), as a girder
  deck in its own colour with railings and piers. The decks are the game's road (`game_surfaces`).
  The ends stand at the banks' height (at least 3.5 m), with a crown of 2% of the length.
- **Kachidoki Bridge** (1940; Important Cultural Property): two steel tied arches of 86 m with
  hangers and bracing over the road, either side of the 44 m bascule, and the four control houses on
  its piers (Tokyo Metropolitan Government; Kachidoki Bridge Museum).
- **Tsukuda**: the vermilion Tsukuda Kobashi over the moat, and Sumiyoshi Shrine's torii by the river.

## Game

Tsukishima on Foot starts at the station. A monja shop owner sends you down the street and up to a
tsukudani maker in Tsukuda; he sends you to the shrine and along the river terrace to a runner, who
sends you to the bridge museum's guide at Kachidoki Bridge.

## Not checked

- Monja Street's line is placed from OpenStreetMap's street parallel to Kiyosumi-dori, not from a
  named street; the signs' density against photographs.
- Bridge widths come from OpenStreetMap's lines and outlines, some with their approach ramps.
- Traffic: the clip check found cars meeting head-on on a one-way street near the start once in
  two runs (a car facing against the one-way).
