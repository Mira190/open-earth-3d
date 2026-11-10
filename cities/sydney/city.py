"""Sydney: what the generic pipeline cannot know from open data.

Building adjustments (called by pipeline/build_scene.py):
  * Sydney Opera House: the outline becomes the upper podium the halls stand on; the
    Monumental Steps climb from the forecourt to a lower landing, and a flight from there to
    the podium in front of each hall. The shells are parametric, on the ridges OSM maps for
    the roof.
  * Harbour Bridge pylons: OSM maps each abutment base to the full 89 m, but the deck
    passes through them, so the base stops at the deck and the towers start there.

Parametric landmarks (called by pipeline/landmarks.py), placed with anchors measured
from the data:
  Sydney Opera House  every shell is cut from a sphere of radius 75.2 m (Utzon's
                      "spherical solution"): two spherical triangles, mirror images that
                      meet along the shell's ridge, each with its ribs fanning out from the
                      pedestal where the leg of the shell's arch stands. OSM maps the roof in
                      detail, traced from aerial imagery, with a maintenance walkway along
                      every ridge; those walkways place the shells: four over the Concert
                      Hall on a ridge line 124 m long, four over the Joan Sutherland Theatre,
                      turned 22 degrees from it, and the restaurant's two, back to back.
                      Each hall's first shell faces the forecourt and stands back to back with
                      the next; the rest face the harbour, each nested in the mouth of the one
                      behind it. Where each shell's pedestals stand, and how wide it spans, is
                      measured on the NSW aerial photo from the outline of the OSM roof parts.
                      The highest shell stands 67 m above sea level (Wikipedia), over the
                      Concert Hall; the Joan Sutherland Theatre's tallest, 61 m, was measured
                      with the NSW LiDAR point cloud by flatcad.com ("Are the Sydney Opera
                      House shells really cut from one sphere?", 2026), which also fits
                      spheres of 75.2 m to them. The other tips, how high the back-to-back
                      shells meet, and the side shells on the flanks between them, with glass
                      under them, are taken from a photograph of the Concert Hall side on
                      (Wikimedia Commons, "Sydney Opera House Sails.jpg"): an approximation,
                      not survey data.
                      The shells carry "a subtle chevron pattern composed of 1,056,006
                      tiles in two colours: glossy white and matte cream", laid in sheets
                      on the ground (Wikipedia, Sydney Opera House, revision 1382109423);
                      the pattern's lid size here is an approximation. The glass walls are
                      topaz glass on bronze mullions, hung from the shells in pleats; the
                      podium and the steps are clad in pink granite aggregate from Tarana
                      (Wikipedia).
                      The Monumental Steps are "nearly 100 m wide and two storeys high"
                      (UNESCO). Measured on the NSW aerial photo, they are 85 m wide and climb
                      in three flights of 0.39 m treads, between landings 1.6 m deep, from the
                      forecourt to the landing 17.6 m in; the flights up to the halls are 11.6 m
                      deep. The 15 cm riser is assumed, which puts the landing 10.1 m above sea
                      level and the podium 14.4 m, close to the podium's height in the
                      photograph. A forecourt apron ramps up to the first tread where the 5 m
                      DEM dips at the foot (the vehicle concourse runs in under the forecourt),
                      which would leave the first riser a wall.
  Harbour Bridge      arch span 503 m between bearings, crown 134 m above sea level,
                      28 panels, trusses 30 m apart, deck 49 m wide with 49 m
                      clearance; alignment from the two pylon footprints in OSM. The deck
                      carries, west to east, the cycleway, the North Shore railway, the six
                      original lanes, lanes 7 and 8 (the former tram tracks) and the
                      footway (Wikipedia, Sydney Harbour Bridge, revision 1381717237); the
                      widths of those strips are approximations that add up to 48.8 m.
  Sydney Tower        309 m to the top of the lightning rod, with a golden turret
                      (Wikipedia, Sydney Tower, revision 1381960211); the shaft, turret and
                      mast take their sizes and heights from the OSM parts they replace.
                      The cable stays form a hyperboloid as photographed; their number here
                      is not from a cited source.
"""
import math

import numpy as np
import shapely
import shapely.ops
from shapely.geometry import Point, Polygon
from shapely.geometry.polygon import orient

from meshkit import Mesh

OPERA = "Sydney Opera House"
PYLONS = ("Sydney Harbour Bridge - South Pylons", "Sydney Harbour Bridge - North Pylons")
BRIDGE_DECK_TOP = 52.0  # 49 m clearance plus the deck structure
R_SHELL = 75.2
# the deck from its western edge: (width m, kind); see the docstring
DECK_ZONES = [(0.5, "parapet"), (3.5, "cycleway"), (0.4, "barrier"), (10.0, "rail"), (0.6, "barrier"), (20.4, "lanes6"),
              (0.6, "barrier"), (6.8, "lanes2"), (0.6, "barrier"), (4.9, "footway"), (0.5, "parapet")]
MATERIALS = {
    "tile": {"color": "#f1eee6", "roughness": 0.35, "metalness": 0.0, "pattern": "chevron_tiles", "lid_m": 2.3, "chevron_m": 1.8, "emissive": "#fff4e6", "glow": 1.0},
    "tile_edge": {"color": "#d6ccb8", "roughness": 0.7, "metalness": 0.0},
    # topaz glass on bronze mullions, lit warm from the foyers after dark
    "glass": {"color": "#3a2616", "roughness": 0.05, "metalness": 0.3, "emissive": "#ffc27a", "glow": 0.16, "opacity": 0.5,
              "pattern": "topaz_glass", "frame": "#4a3a2a", "transom_m": 2.7},
    "mullion": {"color": "#4d3c2b", "roughness": 0.5, "metalness": 0.7},
    # under the tiles: the precast ribs, off-form concrete, lit warm from the foyers after dark
    "rib": {"color": "#cfc5b3", "roughness": 0.9, "metalness": 0.0, "emissive": "#ffc98a", "glow": 0.42},
    # the bronze louvre walls round the nested shells: blades every 0.3 m
    "louvre": {"color": "#4a3a2b", "roughness": 0.5, "metalness": 0.6, "pattern": "granite", "joints_m": [0.0, 0.3]},
    # reconstituted granite (u, v metres): the podium's panels; treads with a pale nosing; risers
    # darker, with the shadow under the nosing (v from the riser's foot to its top, 0 to 1)
    "podium": {"color": "#a57c66", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [1.25, 3.6]},
    "granite": {"color": "#b39684", "roughness": 0.8, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 0.0], "stair": "tread"},
    # paving laid over a roof: drawn in front of it (web/world.js)
    "paving": {"color": "#b39684", "roughness": 0.8, "metalness": 0.0, "pattern": "granite", "joints_m": [1.5, 1.5], "decal": True},
    "granite_riser": {"color": "#7e6154", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 0.0], "stair": "riser"},
    # the arch after dark: lit from the deck and the pylons, a soft wash fading towards the crown
    # (the steel under the deck stays dark; "flood" is set from the bridge's heights in landmark_meshes)
    "steel": {"color": "#8e959a", "roughness": 0.55, "metalness": 0.4, "emissive": "#f1e6d4", "glow": 0.2},
    "deck": {"color": "#5e6164", "roughness": 0.85, "metalness": 0.1, "pattern": "deck_zones", "zones": DECK_ZONES},
    "rail": {"color": "#55504a", "roughness": 0.4, "metalness": 0.8},
    "railing": {"color": "#8e959a", "roughness": 0.55, "metalness": 0.4, "pattern": "railing", "bar_m": 0.13, "rails_m": [0.08, 1.25]},
    "barrier": {"color": "#b9b4aa", "roughness": 0.85, "metalness": 0.0},
    "lamp": {"color": "#d9d4c8", "roughness": 0.4, "metalness": 0.2},
    "tower": {"color": "#c9cdd0", "roughness": 0.6, "metalness": 0.1},
    "turret": {"color": "#c9a04a", "roughness": 0.25, "metalness": 0.85},
    "turret_glass": {"color": "#6e5524", "roughness": 0.1, "metalness": 0.7},
    "cable": {"color": "#a3aaaf", "roughness": 0.45, "metalness": 0.6},
    # Bennelong Point: the forecourt's and the broadwalk's pink granite flags, the seawall (the
    # broadwalk's in the podium's aggregate, Sydney Cove's and Farm Cove's in sandstone) with its
    # tidal band, its coping, and the street furniture
    "flagstone": {"color": "#b49c89", "roughness": 0.78, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 2.4], "decal": True, "street_lit": True},
    "seabed": {"color": "#2e3836", "roughness": 1.0, "metalness": 0.0, "solid": False},  # the harbour's silt at the seawall's foot
    "seawall_opera": {"color": "#9f8574", "roughness": 0.85, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.9, "block_m": 2.4, "tide": True},
    "seawall_sandstone": {"color": "#9a8a74", "roughness": 0.9, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.55, "block_m": 1.3, "tide": True},
    "seawall_sandstone_dry": {"color": "#a08a6c", "roughness": 0.92, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.8, "block_m": 2.2},
    # the Tarpeian Wall: a quarried face, its beds a metre or so deep and long; the garden's edge on top
    "tarpeian": {"color": "#a3865f", "roughness": 0.95, "metalness": 0.0, "pattern": "ashlar", "course_m": 1.1, "block_m": 6.5},
    # (its map, the aerial photo's tile under it, is set by landmark_meshes)
    "garden_edge": {"color": "#ffffff", "roughness": 0.95, "metalness": 0.0},
    # the Lower Concourse: "paving, steps and walls of solid granite" (Design 5, 2020), the steps laid
    # like the paving (walked on, not solids), the walls in courses; the forecourt's soffit and the
    # colonnade's "unpainted mushroom columns" in off-form concrete; the shopfronts behind them. Not
    # solids for the game's 2 m collision cells, which would fill the narrow concourse: the walker is
    # held back by the fine walking levels (walk_patch), where the walls and parapets stand up. The game's
    # camera, which the patch does not hold, stops at the walls, the fascia, the soffit and the shopfronts
    # ("camera": web/game/nav.js), so it does not rise through the forecourt over the colonnade
    "lc_tread": {"color": "#b8a08c", "roughness": 0.8, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 0.0], "decal": True, "street_lit": True},
    "lc_riser": {"color": "#7e6154", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 0.0], "stair": "riser", "decal": True},
    "lc_wall": {"color": "#a8897a", "roughness": 0.85, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.6, "block_m": 2.4, "street_lit": True, "solid": False, "camera": True},
    "lc_soffit": {"color": "#a69d90", "roughness": 0.9, "metalness": 0.0, "solid": False, "camera": True, "emissive": "#ffd8a8", "glow": 0.14},  # off-form concrete (its meshes take SKY_UNDER of the sky); after dark, the downlights' light back off the flags
    "lc_floor": {"color": "#b49c89", "roughness": 0.78, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 2.4], "decal": True,
                 "emissive": "#ffd8a8", "glow": 0.12, "street_lit": True},  # the colonnade's flags: their pools of light under the downlights (landmark_glows)
    # the downlights in the soffit over the colonnade, a row of them between the columns (lc_downlights)
    "lc_downlight": {"color": "#bdb8ae", "roughness": 0.4, "metalness": 0.0, "emissive": "#ffe3bd", "glow": 2.2, "solid": False},
    "lc_fascia": {"color": "#a57c66", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [1.25, 3.6], "solid": False, "camera": True},
    "lc_bronze": {"color": "#5a4029", "roughness": 0.4, "metalness": 0.8, "solid": False},  # the stairwell's handrail
    # the shopfronts: glass between bronze mullions, a kick plate at the foot, most panes lit after dark
    "lc_shop": {"color": "#1d1712", "roughness": 0.08, "metalness": 0.3, "pattern": "curtain_wall", "bay_m": 2.1, "storey_m": 2.4,
                "spandrel": 0.12, "mullion_m": 0.09, "frame": "#5a4029", "lit_share": 0.85, "lit_k": 0.32,
                "warm_share": 1.0, "emissive": "#ffc27a", "glow": 0.12, "solid": False, "camera": True},
    "coping": {"color": "#c2ad9b", "roughness": 0.75, "metalness": 0.0, "pattern": "granite", "joints_m": [1.5, 0.0], "street_lit": True},
    "bollard": {"color": "#1d1f21", "roughness": 0.45, "metalness": 0.6},
    "post": {"color": "#2b2f30", "roughness": 0.5, "metalness": 0.55},
    "globe": {"color": "#f3efe4", "roughness": 0.3, "metalness": 0.0, "emissive": "#ffe2b0", "glow": 1.6},
    "floodlamp": {"color": "#3d4043", "roughness": 0.4, "metalness": 0.6, "emissive": "#fff4dc", "glow": 0.9},
    "timber": {"color": "#7d5d40", "roughness": 0.75, "metalness": 0.0},
    "umbrella": {"color": "#f2efe8", "roughness": 0.85, "metalness": 0.0},
    "canopy": {"color": "#e9e7e1", "roughness": 0.7, "metalness": 0.0},
    "furniture": {"color": "#5f6263", "roughness": 0.5, "metalness": 0.5},
    "pylon": {"color": "#202224", "roughness": 0.5, "metalness": 0.2},
    "panel": {"color": "#e8e4da", "roughness": 0.6, "metalness": 0.0, "emissive": "#fff6e8", "glow": 0.5},
    "colonnade": {"color": "#a58b78", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 0.0]},
    "opening": {"color": "#16110d", "roughness": 0.08, "metalness": 0.3, "emissive": "#ffc27a", "glow": 0.45},
}
SYDNEY_TOWER = "Sydney Tower"  # the turret part's name; the shaft and mast are unnamed parts above 200 m beside it
# The shells, hall by hall from south to north, one per ridge OSM maps (the restaurant's two share
# one): which way each faces (-1 the forecourt, 1 the harbour), its tip in m AHD, and its side
# feet, in metres back from the tip along the ridge and half the span across it; see the docstring
SHELLS = {
    "concert": [(-1, 42.4, 16.5, 15.2), (1, 67.0, 16.3, 24.9), (1, 51.2, 18.1, 27.4), (1, 41.1, 20.0, 24.5)],
    "joan_sutherland": [(-1, 39.1, 14.0, 11.3), (1, 61.1, 12.5, 19.4), (1, 47.0, 11.8, 21.5), (1, 38.0, 13.5, 18.2)],
    "restaurant": [(-1, 28.0, 19.0, 14.0), (1, 26.0, 10.6, 11.5)],
}
HALL_NAMES = {"concert": "Concert Hall", "joan_sutherland": "Joan Sutherland Theatre"}
RESTAURANT_SPLIT = 0.65  # how far along the restaurant's ridge its two shells meet, back to back
JUNCTION_M = {"concert": 23.0, "joan_sutherland": 20.5, "restaurant": 8.0}  # how high above the podium the back-to-back shells' ridges meet
SIDE_GLASS_M = {"concert": 6.0, "joan_sutherland": 5.5, "restaurant": 3.0}  # the glass under the side shells, at its highest
NESTED_BACK, NESTED_RISE = 4.0, 0.5  # a nested shell's ridge goes back into the mouth of the one behind this far behind where it comes out, to this share of its tip's height
# The podium's north end, under each hall's harbour-facing mouth, as photographed from the Northern
# Broadwalk (Wikimedia Commons, "AUS Sydney, Central Business District, Sydney Opera House 033.jpg",
# "... 035.jpg", "... 036.jpg"): it steps back as it rises, in three tiers clad in vertical granite
# panels, each over a band of glass under a sloping hood (the ground floor's shopfronts, the foyers'
# windows), and on top the foyer's curved band of glass leans out under a bronze rim, roofed in glass
# back to the shell's own glass wall. Each tier as [offset out from the podium's mapped edge, m;
# height]: placed from those photographs, not measured; the second tier's band is SLOT_M
NORTH_TIERS = {"ground_glass": (1.6, 3.0), "tier1": 2.4, "tier2": 1.2, "hood": (0.5, 0.8), "top_tier_m": 1.6,
               "bowl_out": 2.0, "bowl_up": 3.6, "roof_up": 5.0, "reach_m": 16.0, "panel_m": 1.8}
# the dark band of glass along the podium's outer walls, m AHD: placed from photographs (Wikimedia
# Commons, "AUS Sydney, Central Business District, Sydney Opera House 028.jpg"), not measured
SLOT_M = (9.6, 10.5)
# Monumental Steps, measured on the aerial photo along the axis of the podium's south edge: the
# flights in metres from the top riser, the tread, the width and its offset from the podium's axis,
# and how far inside the podium's mapped edge the top riser is; the riser is assumed
STEPS = {"flights": [(-17.6, -15.6), (-14.0, -8.0), (-6.4, 0.0)], "tread": 0.39, "riser": 0.15, "width": 85.0, "lateral": -0.4,
         "inside": 2.8, "apron": 8.0}
# The halls stand on the upper podium, and a flight climbs to it in front of each, measured on the
# aerial photo in the Monumental Steps' frame (metres from their top riser along their axis, and
# across from their centre line): where its foot is, and its two ends across. The restaurant stays
# on the lower landing, west of the Concert Hall's flight, as far as `behind_restaurant`.
UPPER = {"flights": {"concert": (24.4, -12.0, 11.0), "joan_sutherland": (34.4, 11.0, 44.0)}, "run": 11.6, "risers": 29, "behind_restaurant": 50.0}

# Bennelong Point round the Opera House (bennelong()): the paved precinct, from the Lower Concourse
# on East Circular Quay round the broadwalk to the forecourt's east edge, in local metres; the
# seawall is followed from Circular Quay round the point into Farm Cove (SEAWALL_AREA). The road
# down to the Man O'War Steps and the Royal Botanic Garden stay as the aerial photo shows them.
PRECINCT = [(138, 328), (205, 350), (255, 383), (300, 394), (346, 398), (350, 470), (482, 470), (482, 722), (118, 722), (118, 328)]
SEAWALL_AREA = [(140, 300), (490, 300), (490, 722), (118, 722), (118, 335)]
# The forecourt is level in the photographs (Wikimedia Commons, "AUS Sydney, Central Business District,
# Sydney Opera House 034.jpg"), at RL 4.500 at its western edge, the "Upper Concourse" over the Lower
# Concourse (Humphrey & Edwards Architects, "Sydney Opera House Lower Concourse Improvements", drawing
# 49HE001-3225 rev D, "Detail Section - Shade Structure", 2019, in the SSD-9794 application; levels in
# AHD, the model's datum). The 5 m DEM has 4.3 to 4.5 m where the forecourt stands on the rock, at the
# foot of the Monumental Steps, but sags to 3.4 m where it spans the vehicle concourse and the Lower
# Concourse (the bare-earth models take the slab out; Geoscience Australia's 5 m LiDAR DEM drops to
# 0.1 m in its middle). The paving keeps the forecourt's level there and on the Upper Concourse along
# its balustrade (from the forecourt's south edge to UPPER_TO_Y), and eases to the DEM's level beyond,
# over UPPER_EASE_M (up from Circular Quay East, down to the Northern Broadwalk)
FORECOURT = [(258, 396), (348, 400), (350, 446), (258, 446)]
FORECOURT_M = 4.50
UPPER_TO_Y = 468.0
UPPER_EASE_M = 30.0
PRECINCT_FURNITURE = {"shelter", "roof"}  # Overture classes in the precinct drawn as furniture, not solids
SEAWALL_SAG_M = 7.0      # the 5 m DEM sags towards the water this far in from a seawall: the paving keeps the level behind
SEAWALL_FOOT_M = -2.2    # the seawall face goes down below low water
CLIP_OUT_M = 16.0        # the terrain is not drawn this far out from the seawall (no ramp up out of the water)
EDGE_HOLD_M = 12.0       # the paving keeps the level this far in from a garden's bank or a wall, where the DEM climbs it
PIER_DECK_M = 2.2        # as the viewer draws the piers (web/world.js)
# The Tarpeian Wall: the sandstone cliff cut in the 1880s under the Royal Botanic Garden, about 10 m
# high along the forecourt's south side; the 5 m DEM draws it as a slope. Where the garden behind an
# edge of the paving stands more than CLIFF_M above it, the edge is a cliff up to the garden's level
# CLIFF_BACK_M behind (where the slope levels off), capped back to there over the DEM's slope
CLIFF_M = 3.0
CLIFF_BACK_M = (6.0, 9.0, 12.0, 15.0)
# The Lower Concourse (Opera Bar, Opera Kitchen), between the seawall and the forecourt's western
# edge. As the Opera House's own visitor map draws it ("Ramp down to Opera Bar", "Stairs down to Lower
# Concourse") and its heritage statement describes it (Design 5, "Lower Concourse Improvements", 2020:
# "the raised walkway along the sea wall", "the stepped higher part of the uncovered Lower Concourse",
# the colonnade of "mushroom columns" under "the parapet spandrel to the Forecourt above"), it lies
# below both: a walkway along the seawall, retaining walls (OpenStreetMap, the lower side on their
# right) or broad steps down from it, the concourse, and over it the forecourt's edge on columns.
# Its levels are from the same section (49HE001-3225 rev D; Luchetti Krelle's DA.102 rev C, approved
# under SSD-9794-Mod-1 in 2026, has the same): the concourse ("Ground Lvl FFL") at 0.600, the walkway
# ("Sea Wall Promenade FFL") at 1.580, the soffit of the forecourt over it ("Ground Level FCL") at
# 3.000, 2.4 m clear, under a slab 1.5 m deep to the Upper Concourse at 4.500. The 7 risers OpenStreetMap
# counts from the concourse up to the walkway are then 14 cm. The ramp from Circular Quay comes down
# beside the first retaining wall. `fence_near` picks the forecourt's balustrade (an Overture fence,
# from OpenStreetMap) as the concourse's eastern edge; `hold_m` is how far in from it the Upper
# Concourse is held at the forecourt's level. At the north end a flight of 13 risers climbs east from
# the walkway's end to the Northern Broadwalk (OpenStreetMap maps its two lanes as two ways of 13
# steps, near `north_near`; the aerial photo, NSW Imagery at 7.5 cm, shows one flight 8 m wide), and
# from the forecourt a stairwell of 20 risers goes down to the concourse (OpenStreetMap way 1118329015,
# near `well`; "Stair to Circular Quay" beside the car park's entrance on Luchetti Krelle's lower
# level plan DA.101, SSD-9794-Mod-1, 2025): an opening in the forecourt 10.7 m long along the way
# (u from its upper end, v across to the east), measured on the same photo, and 3.0 m across, as the
# plan and OpenStreetMap's outline of it (way 1118329050) have it; one straight flight down it to the
# south-south-west, the full width between its balustrades, with no void beside it; and from the
# landing at its foot a lobby whose doors open west onto the colonnade, the passage west under the
# forecourt that OpenStreetMap maps as a covered footway (way 1118329034). The colonnade is 5.8 m deep
# from the forecourt's edge to the shopfronts and its mushroom columns stand 7.2 m apart (four 1.8 m
# pavers), 1.8 m in from the edge, their shafts 0.38 m across (DA.131, Opera Kitchen, 1:50; DA.101
# has 5.9 m to the back-of-house wall at the Opera Bar)
LOWER = {"fence_near": (233.0, 430.0), "walk_m": 1.58, "floor_m": 0.60, "riser_m": 0.15, "tread_m": 0.45, "up_risers": 13,
         "hold_m": 9.0, "recess_m": 5.8, "slab_m": 1.50, "parapet_m": 1.05, "wall_parapet_m": 0.9, "column_every_m": 7.2,
         "column_in_m": 1.8, "column_r_m": 0.19,
         "north_near": (249.5, 502.0), "north_tread_m": 0.40,
         "well": {"near": (241.0, 432.0), "risers": 20, "open_u": (-2.0, 8.7), "open_v": (-0.6, 2.4), "stair_v": (-0.6, 2.4),
                  "top_u": -1.2, "foot_u": 7.9, "land_u": 10.7, "passage_v": -14.0, "rail_m": 1.0}}
# The share of the sky's light that reaches the surfaces under the forecourt's slab (world.js "sky"):
# the colonnade's floor and shopfronts see it through the 2.4 m opening across the 5 m recess, about
# a third of the sky; the soffit faces down and takes only what comes back off the paving outside.
# After dark the downlights in the soffit light the colonnade's floor, and the soffit and the columns
# catch their spill (the materials' glow)
SKY_UNDER = {"soffit": 0.3, "columns": 0.45, "floor": 0.35, "shopfront": 0.35, "passage": 0.2}
# The colonnade after dark (issue #141): a downlight in the soffit every 3.6 m (between the 7.2 m bays'
# columns and over them), each throwing a pool on the flags (landmark_glows, web/night.js)
DOWNLIGHT_EVERY_M, DOWNLIGHT_R_M, DOWNLIGHT_POOL = 3.6, 0.1, (3.2, "#ffd8a8", 0.55)
DOWNLIGHTS = []  # (x, y) of each, as concourse_meshes lays them (landmark_glows reads them)
# Overture infrastructure drawn in the precinct, by (subtype, class)
STREET_FURNITURE = {("pedestrian", "bench"): "bench", ("barrier", "bollard"): "bollard", ("transportation", "street_lamp"): "lamp",
                    ("tower", "lighting"): "floodlight", ("pedestrian", "information"): "pylon"}


# ---------------------------------------------------------------- build_scene hooks

BRIDGEPORT = "w387782067"  # 38-42 Bridge Street


def adjust_building(b, cls, g, geoms, ctx):
    """geoms: [polygon, min_height, height, source, part_name] per solid."""
    if (b.get("record_id") or "").split("@")[0] == BRIDGEPORT:
        # OSM maps only its top floors, from 45 m: the sandstone building stands on Bridge Street's corner
        # with Loftus Street (converted to flats in 1998, three storeys added)
        for q in geoms:
            q[1] = 0.0
    if b["name"] == OPERA:
        return opera_podium(g, geoms, ctx)
    if cls in PRECINCT_FURNITURE and Polygon(PRECINCT).contains(g.centroid):
        # the Opera Bar's umbrellas, the Opera Kitchen's canopy, the western colonnade and the small
        # canopies on the broadwalk are drawn as what they are (bennelong_meshes), not as solids
        ctx.landmarks.setdefault("precinct_parts", []).append(
            {"osm": (b["record_id"] or "").split("@")[0], "class": cls, "top_m": round(max(q[2] for q in geoms), 1),
             "ring": [[round(x, 2), round(y, 2)] for x, y in orient(max(ctx.polygons(g), key=lambda q: q.area), 1.0).exterior.coords]})
        return []
    turret = next((q for q in geoms if q[4] == SYDNEY_TOWER), None)
    if turret is not None:  # the shaft, turret and mast become one parametric tower
        c = turret[0].centroid
        near = [q for q in geoms if q[2] > 200 and q[0].centroid.distance(c) < 12]
        rest = [q for q in geoms if q not in near]
        shaft = max((q for q in near if q[4] != SYDNEY_TOWER and q[0].area > 50), key=lambda q: q[0].area)
        g0 = ctx.ground(c.x, c.y)
        podium = max((q[2] for q in rest if q[0].contains(c)), default=0.0)
        ctx.landmarks["sydney_tower"] = {"at": [round(c.x, 1), round(c.y, 1)], "ground_m": round(g0, 1), "podium_m": round(g0 + podium, 1),
                                         "shaft_r": round(math.sqrt(shaft[0].area / math.pi), 2), "turret_r": round(math.sqrt(turret[0].area / math.pi), 2),
                                         "turret_m": [round(g0 + turret[1], 1), round(g0 + turret[2], 1)], "top_m": round(g0 + max(q[2] for q in near), 1)}
        for q in near:  # still in the surface model: the tower's shadow counts in the analyses
            ctx.hide(q)
        return geoms
    if b["name"] in PYLONS:
        ctx.landmarks.setdefault("bridge_pylons", {})[b["name"].split(" - ")[1].split()[0].lower()] = \
            [round(g.centroid.x, 1), round(g.centroid.y, 1)]
        for s in geoms:  # the unnamed base part stops at the deck; the named towers start there
            if s[4]:
                s[1] = BRIDGE_DECK_TOP
            else:
                s[2] = BRIDGE_DECK_TOP
    return geoms


def finalize(ctx):
    """Bridge alignment from the pylon footprints, and labels for both landmarks."""
    pl = ctx.landmarks.get("bridge_pylons", {})
    if "south" in pl and "north" in pl:
        s, n = np.array(pl["south"]), np.array(pl["north"])
        d = n - s
        u = d / np.linalg.norm(d)
        ctx.landmarks["harbour_bridge"] = {
            "south_pylons": pl["south"], "north_pylons": pl["north"],
            "pylon_spacing_m": round(float(np.linalg.norm(d)), 1),
            "bearing_deg": round(math.degrees(math.atan2(d[0], d[1])), 2),
            # published: arch span 503 m, crown 134 m above sea level, deck clearance 49 m,
            # deck 49 m wide, arch trusses 30 m apart, pylons 89 m
            "span_m": 503.0, "crown_m": 134.0, "deck_m": 49.0, "deck_width_m": 49.0, "truss_spacing_m": 30.0,
            "approach_ground_south": round(ctx.ground(*(s - u * 120)), 1),
            "approach_ground_north": round(ctx.ground(*(n + u * 120)), 1),
        }
        ctx.landmarks["harbour_bridge"]["deck_profile"] = deck_profile(ctx, (s + n) / 2, u, float(np.linalg.norm(d)) / 2)
        m = (s + n) / 2
        ctx.labels["Sydney Harbour Bridge"] = [round(float(m[0]), 1), round(float(m[1]), 1), 142.0]
    if "sydney_tower" in ctx.landmarks:
        t = ctx.landmarks["sydney_tower"]
        ctx.labels["Sydney Tower"] = [t["at"][0], t["at"][1], t["top_m"] - 30.0]
    if "opera_house" in ctx.landmarks:
        o = ctx.landmarks["opera_house"]
        ctx.labels["Sydney Opera House"] = [o["centroid"][0], o["centroid"][1], 72.0]
        ctx.landmarks["bennelong"] = bennelong(ctx)
        for m in ctx.meta:  # the podium in its pink granite: the walls, and the deck's paving for its roof
            if m[0] == OPERA:
                m[7], m[8] = MATERIALS["podium"]["color"], MATERIALS["granite"]["color"]


def opera_podium(g, geoms, ctx):
    """The Opera House's outline becomes its podium on two levels: the lower landing, at the top
    of the Monumental Steps, which climb to it from the forecourt (they take the strip of the
    outline they cross), and the upper podium the halls stand on, with a flight up to it in front
    of each. The ridges of the roof come from its OSM parts; landmark_meshes() builds the shells
    on them."""
    rect = g.minimum_rotated_rectangle
    cs = np.asarray(rect.exterior.coords)[:4]
    e1, e2 = cs[1] - cs[0], cs[2] - cs[1]
    axis = e1 if np.linalg.norm(e1) > np.linalg.norm(e2) else e2
    o = ctx.landmarks["opera_house"] = {
        "centroid": [round(g.centroid.x, 1), round(g.centroid.y, 1)],
        "axis_deg": round(math.degrees(math.atan2(axis[1], axis[0])), 2),
        "length_m": round(max(np.linalg.norm(e1), np.linalg.norm(e2)), 1),
        "width_m": round(min(np.linalg.norm(e1), np.linalg.norm(e2)), 1),
        "halls": opera_ridges(geoms),
    }
    c, f, l = opera_frame(o)
    top = c - f * (o["length_m"] / 2 - STEPS["inside"]) + l * STEPS["lateral"]
    st = o["steps"] = monumental_steps(ctx, top, f, l)
    z_low = st["z_top"]
    box = lambda u0, u1, v0, v1: Polygon([top + f * u0 + l * v0, top + f * u1 + l * v0, top + f * u1 + l * v1, top + f * u0 + l * v1])
    run, n = UPPER["run"], UPPER["risers"]
    upper = [box(UPPER["behind_restaurant"], 500, -500, 500)]
    for hall, (u0, v0, v1) in UPPER["flights"].items():
        upper.append(box(u0 + run + 0.03, 500, v0, v1 if hall == "concert" else 500))
    upper = shapely.union_all(upper)
    lower = g.intersection(box(0.03, 500, -500, 500)).difference(upper)
    # the upper podium is the building's one solid (as the whole podium was, so the solids after it,
    # and the roofs drawn from their order, stay as they were): its deck is where build_scene puts
    # the solid's top, to the decimetre, and the flights climb to it
    pod = orient(max(ctx.polygons(g.intersection(upper)), key=lambda p: p.area), 1.0)
    zb = max(min(ctx.ground(x, y) for x, y in pod.simplify(0.15, preserve_topology=True).exterior.coords), 0.0)  # as build_scene takes it
    z_up = (round(zb * 10) + round((z_low + n * STEPS["riser"] - zb) * 10)) / 10
    o["upper_steps"] = {hall: flight(top + f * (u0 + run) + l * (v0 + v1) / 2, f, (v1 - v0) / 2, z_low, [(-run, 0.0)], run / (n - 1),
                                     (z_up - z_low) / n, z_low - 0.5) for hall, (u0, v0, v1) in UPPER["flights"].items()}
    # the landing is walked as a strip, the width of the outline there, as far as the Concert Hall's flight
    across = [[(np.asarray(c) - top) @ l for c in shapely.LineString([top + f * u - l * 200, top + f * u + l * 200]).intersection(g).coords]
              for u in np.arange(0.5, UPPER["flights"]["concert"][0] + run, 2.0)]
    v0, v1 = max(min(a) for a in across) + 0.3, min(max(a) for a in across) - 0.3  # the narrowest
    u1 = UPPER["flights"]["concert"][0] + run
    o["landing"] = {"origin": [round(v, 2) for v in top + l * (v0 + v1) / 2], "axis": st["axis"], "half_width": round((v1 - v0) / 2, 2),
                    "z_top": z_low, "base_m": st["base_m"], "profile": [[0.0, z_low], [round(u1, 2), z_low]]}
    rings, decks = [], {z_low: [], z_up: []}
    for geom, z in ((lower, z_low), (pod, z_up)):
        for p in ctx.polygons(geom):
            if p.area < 2:
                continue
            p = orient(p, 1.0)
            rings.append({"top_m": z, "ring": [[round(x, 2), round(y, 2), round(ctx.ground(x, y), 2), int(g.exterior.distance(Point(x, y)) < 0.3)]
                                               for x, y in p.exterior.coords]})
            decks[z].append([[round(x, 2), round(y, 2)] for x, y in p.exterior.coords])
    o["podium"] = {"low_m": z_low, "top_m": z_up, "rings": rings, "decks": [decks[z_low], decks[z_up]]}
    return [[pod, 0.0, z_up - zb, "parametric", None]]


def opera_ridges(geoms):
    """The ridges of the roof: OSM maps a maintenance walkway along each, as a thin part (about
    1.2 m wide) with no roof shape. Grouped by bearing into the halls, the longest run first: the
    Concert Hall, the Joan Sutherland Theatre, then the restaurant; each [x0, y0, x1, y1] from
    its south end, the hall's ridges from south to north."""
    strips = []
    for q in geoms:
        if len(q) < 6 or q[5].get("roof_shape"):
            continue
        cs = np.asarray(q[0].minimum_rotated_rectangle.exterior.coords)[:4]
        e1, e2 = cs[1] - cs[0], cs[2] - cs[1]
        L, W = max(np.linalg.norm(e1), np.linalg.norm(e2)), min(np.linalg.norm(e1), np.linalg.norm(e2))
        if W > 2.5 or L < 8.0:
            continue
        ax = (e1 if np.linalg.norm(e1) > np.linalg.norm(e2) else e2) / L
        ax = ax if ax[1] > 0 else -ax
        c = np.array(q[0].centroid.coords[0])
        strips.append((math.degrees(math.atan2(ax[0], ax[1])), c - ax * L / 2, c + ax * L / 2))
    groups = []
    for brg, a, b in sorted(strips, key=lambda t: t[0]):
        if groups and brg - groups[-1][-1][0] < 4.0:
            groups[-1].append((brg, a, b))
        else:
            groups.append([(brg, a, b)])
    groups.sort(key=lambda gr: -sum(np.linalg.norm(b - a) for _, a, b in gr))
    if len(groups) != len(SHELLS) or [len(gr) for gr in groups] != [len(SHELLS["concert"]), len(SHELLS["joan_sutherland"]), 1]:
        raise SystemExit(f"Opera House: expected the roof's ridges in OSM as 4, 4 and 1 walkways, found {[len(gr) for gr in groups]}")
    out = {}
    for name, gr in zip(SHELLS, groups):
        ax = sum(b - a for _, a, b in gr)
        ax /= np.linalg.norm(ax)
        out[name] = [[round(float(v), 2) for v in (*a, *b)] for _, a, b in sorted(gr, key=lambda t: float(t[1] @ ax))]
    return out


def opera_frame(o):
    """Centroid, forward (towards the harbour, north) and lateral (east) unit vectors."""
    c = np.array(o["centroid"], float)
    ang = math.radians(o["axis_deg"])
    f = np.array([math.cos(ang), math.sin(ang)])
    if f[1] < 0:
        f = -f
    return c, f, np.array([f[1], -f[0]])


def monumental_steps(ctx, top, f, l):
    """The Monumental Steps as a strip climbing north from the forecourt to the lower landing:
    origin at the top riser's centre (top), u from the foot (negative) to 0 at the top riser."""
    u_foot = STEPS["flights"][0][0]
    hw = STEPS["width"] / 2
    # from the forecourt's level (FORECOURT_M; the DEM has 4.3 m at their foot, the 75th percentile across
    # it), across a level apron
    z_foot = z_apron = FORECOURT_M
    low = min(ctx.ground(*(top + f * u + l * v)) for u in np.arange(u_foot - STEPS["apron"], 1, 2.0) for v in np.linspace(-hw, hw, 17))
    return flight(top, f, hw, z_foot, STEPS["flights"], STEPS["tread"], STEPS["riser"], min(low, z_foot) - 0.5, (STEPS["apron"], z_apron))


def flight(top, f, hw, z_foot, flights, tread, riser, base, apron=None):
    """A stair as a strip, origin at its top riser's centre and u along f: flights [(u0, u1)] of
    treads `tread` deep (each ending in the riser onto the landing or the top), from z_foot;
    `apron` (length, height) ramps up to the first riser from the ground in front."""
    risers = []
    for a, b in flights:
        n = max(1, round((b - a) / tread))
        risers += [a + (b - a) * k / n for k in range(n + 1)]
    z_top = z_foot + riser * len(risers)
    u_foot = flights[0][0]
    out = [[round(u_foot - apron[0], 2), round(apron[1], 3)]] if apron else []
    out.append([round(u_foot - 0.02, 2), round(z_foot, 3)])
    for j, u in enumerate(risers):
        out += [[round(u, 2), round(z_foot + j * riser, 3)], [round(u + 0.02, 2), round(z_foot + (j + 1) * riser, 3)]]
    out.append([1.0, round(z_top, 3)])
    return {"origin": [round(top[0], 2), round(top[1], 2)], "axis": [round(f[0], 5), round(f[1], 5)], "half_width": round(hw, 2),
            "z_foot": round(z_foot, 2), "z_top": round(z_top, 2), "base_m": round(base, 2), "risers": len(risers), "profile": out}


def deck_profile(ctx, mid, ax, half_pylons):
    """Road deck height along the bridge axis, [[u, z], ...] from south to north: level
    across the arch and the pylons, then down the approach viaducts at 5% until it meets
    the ground (the real approaches run on to the Cahill Expressway and North Sydney)."""
    flat = half_pylons + 40.0
    prof = {}
    for sign in (-1, 1):
        pts = [(flat, BRIDGE_DECK_TOP)]
        u = flat
        while u < flat + 900:
            u += 10.0
            z = BRIDGE_DECK_TOP - 0.05 * (u - flat)
            g = ctx.ground(*(mid + ax * sign * u))
            if z <= g + 0.5:
                pts.append((u, round(g, 1)))
                break
            pts.append((u, round(z, 1)))
        prof[sign] = pts
    south = [[-u, z] for u, z in reversed(prof[-1])]
    return south + [[u, z] for u, z in prof[1]]


def deck_at(profile, u):
    us = [p[0] for p in profile]
    return float(np.interp(u, us, [p[1] for p in profile]))


def game_surfaces(scene):
    """Walkable and drivable surfaces above the terrain, for the game (pipeline/game_data.py).
    `mesh` names the landmark mesh the surface stands for (the game walks on the surface,
    not the mesh); `fly_under` marks a span the helicopter can be flown under; `drape`
    puts every footway that crosses the surface onto it."""
    out = []
    h = scene["landmarks"].get("harbour_bridge")
    if h and "deck_profile" in h:
        s, n = np.array(h["south_pylons"], float), np.array(h["north_pylons"], float)
        m = (s + n) / 2
        ax = (n - s) / np.linalg.norm(n - s)
        out.append({"name": "Sydney Harbour Bridge deck", "type": "strip", "origin": [round(m[0], 1), round(m[1], 1)],
                    "axis": [round(ax[0], 5), round(ax[1], 5)], "half_width": h["deck_width_m"] / 2,
                    "profile": h["deck_profile"], "thickness": 3.0, "mesh": "bridge_deck", "fly_under": True, "label": "Harbour Bridge"})
    o = scene["landmarks"].get("opera_house") or {}
    if o.get("steps"):
        st = o["steps"]
        out.append({"name": "Opera House steps", "type": "strip", "origin": st["origin"], "axis": st["axis"],
                    "half_width": st["half_width"], "profile": st["profile"], "thickness": round(st["z_top"] - st["base_m"], 1),
                    "mesh": "opera_steps", "drape": True})
    if o.get("landing"):
        st = o["landing"]
        out.append({"name": "Opera House podium", "type": "strip", "origin": st["origin"], "axis": st["axis"], "half_width": st["half_width"],
                    "profile": st["profile"], "thickness": round(st["z_top"] - st["base_m"], 1), "mesh": "opera_steps_landing", "drape": True})
    for hall, st in (o.get("upper_steps") or {}).items():
        out.append({"name": f"Opera House steps, {HALL_NAMES[hall]}", "type": "strip", "origin": st["origin"], "axis": st["axis"],
                    "half_width": st["half_width"], "profile": st["profile"], "thickness": round(st["z_top"] - st["base_m"], 1),
                    "mesh": f"opera_steps_{hall}"})
    if o.get("halls"):
        out += opera_rooms(o)["surfaces"]
    return out


def game_ground(grid, gx, gy, water, scene):
    """The game walks on the paving round the Opera House at the level it is drawn (bennelong()),
    not on the DEM, which sags towards the seawall and dips where the vehicle concourse runs in
    under the forecourt; and off the seawall the bottom drops away, so a walker stops at its top
    instead of walking down a slope into the water."""
    b = scene["landmarks"].get("bennelong")
    if not b:
        return grid
    from shapely import contains_xy
    deck = shapely.union_all([Polygon(d["ring"], d["holes"]).buffer(0) for d in b["deck"]])
    x0, y0, x1, y1 = deck.bounds
    box_ = (gx > x0 - 20) & (gx < x1 + 20) & (gy > y0 - 20) & (gy < y1 + 20)
    idx = np.nonzero(box_)
    on = contains_xy(deck, gx[idx], gy[idx]) & ~water[idx]
    grid = grid.copy()
    for r, c in zip(idx[0][on], idx[1][on]):
        grid[r, c] = level_at(b["level"], gx[r, c], gy[r, c])
    if b.get("lower"):  # the Lower Concourse's pieces, on their own levels (nav.js walks on b["patch"] there)
        lc = lower_loaded(b["lower"])
        u = shapely.union_all([pc["poly"] for pc in lc["pieces"]])
        on = contains_xy(u, gx[idx], gy[idx]) & ~water[idx]
        for r, c in zip(idx[0][on], idx[1][on]):
            grid[r, c] = piece_level(lc, gx[r, c], gy[r, c])
    wall = shapely.MultiLineString([[p[:2] for p in w] for w in b["seawalls"]]).buffer(6.0)
    off = contains_xy(wall, gx[idx], gy[idx]) & water[idx]
    grid[idx[0][off], idx[1][off]] = np.minimum(grid[idx[0][off], idx[1][off]], SEAWALL_FOOT_M)
    return grid


def game_patches(scene):
    """Fine walking levels over the 5 m grid (pipeline/game_data.py, web/game/nav.js): the paving
    round the Lower Concourse, with its walls and steps, every half metre."""
    b = scene["landmarks"].get("bennelong") or {}
    return [b["patch"]] if b.get("patch") else []


def xy(p):
    return [round(float(p[0]), 2), round(float(p[1]), 2)]


def close_to(name, at, z, start, within=1.5, keep=0.0):
    """A thing to walk up to (game.json "close"): `at` on it at the floor's height z, the walk starting
    at `start`; tools/close_step.js must get within `within` m and never nearer than `keep`."""
    return {"name": name, "at": [*xy(at), round(float(z), 2)], "from": xy(start), "within": within, **({"keep": keep} if keep else {})}


def strip_z(st, u):
    """The height of a flight's strip u metres along its axis from its origin."""
    p = st["profile"]
    return float(np.interp(u, [q[0] for q in p], [q[1] for q in p]))


def face_of(ring, out):
    """The midpoint and outward normal of the longest edge of a footprint whose outward normal is
    within 30 degrees of `out`."""
    pts = [np.asarray(p, float) for p in ring]
    c = np.mean(pts, axis=0)
    best = None
    for a, b in zip(pts, pts[1:] + pts[:1]):
        L = float(np.linalg.norm(b - a))
        if L < 1.0:
            continue
        n = np.array([(b - a)[1], -(b - a)[0]]) / L
        if np.dot((a + b) / 2 - c, n) < 0:
            n = -n
        if n @ out > 0.86 and (best is None or L > best[2]):
            best = ((a + b) / 2, n, L)
    return best


def game_extras(scene):
    """The things people come to see up close (game.json "close"): up the Monumental Steps from the
    forecourt, landing by landing, to the lower landing; up the Concert Hall's flight to the podium and
    to the glass walls of the foyers under the tips of the first shells; a mushroom column of the
    colonnade on the Lower Concourse; the foot of the Harbour Bridge's south pylon in Dawes Point Park;
    and Westfield's front on Pitt Street Mall, the way in to Sydney Tower."""
    import archkit as ak
    lm = scene["landmarks"]
    close = []
    o = lm.get("opera_house")
    if o:
        st = o["steps"]
        O, f = np.asarray(st["origin"], float), np.asarray(st["axis"], float)
        u_foot = STEPS["flights"][0][0]
        landing1 = (STEPS["flights"][0][1] + STEPS["flights"][1][0]) / 2
        landing2 = (STEPS["flights"][1][1] + STEPS["flights"][2][0]) / 2
        for name, u, start in (("Monumental Steps, the first landing", landing1, u_foot - 3.0),
                               ("Monumental Steps, the second landing", landing2, landing2 - 5.3),
                               ("Monumental Steps, the top: the lower landing", 1.5, -4.0)):
            close.append(close_to(name, O + f * u, strip_z(st, u), O + f * start, 1.0))
        c = o["upper_steps"]["concert"]
        C = np.asarray(c["origin"], float)
        u0 = c["profile"][0][0]
        close.append(close_to("Concert Hall flight, halfway up", C + f * u0 / 2, strip_z(c, u0 / 2), C + f * (u0 - 4.0), 1.0))
        for hall in ("concert", "joan_sutherland"):  # the first shell faces the forecourt: its glass comes down to the podium under its tip
            _, T, _ = hall_shells(hall, o["halls"][hall], o["podium"]["top_m"])[0]
            close.append(close_to(f"{HALL_NAMES[hall]} foyer glass, under the first shell", T[:2], o["podium"]["top_m"], T[:2] - f * 5.5, 1.0, 0.1))
    b = lm.get("bennelong") or {}
    if b.get("lower"):
        E = b["lower"]["edge"]
        cols = colonnade_columns(E)
        if cols:
            x, y, zf, _ = cols[len(cols) * 2 // 3]
            e = min(E, key=lambda e: (e[0] - x) ** 2 + (e[1] - y) ** 2)
            n = np.asarray(e[2:4], float)  # in under the forecourt: the concourse is open on the other side
            close.append(close_to("Lower Concourse colonnade, a mushroom column", (x, y), zf, np.array([x, y]) - n * 4.5, 1.0, 0.3))
    if "harbour_bridge" in lm:
        T = ak.Terrain("sydney")
        base = [q for q in ak.load_solids("sydney") if q["name"] == PYLONS[0] and q["base"] < 1.0]
        if base:
            ring = max(base, key=lambda q: abs(ak.ring_area(q["ring"])))["ring"]
            h = lm["harbour_bridge"]
            ax = np.asarray(h["north_pylons"], float) - np.asarray(h["south_pylons"], float)
            ax /= np.linalg.norm(ax)
            for name, out in (("Harbour Bridge south pylon, its foot facing the harbour", ax), ("Harbour Bridge south pylon, its east foot", np.array([ax[1], -ax[0]]))):
                face = face_of(ring, out)
                if face:
                    m, n, _ = face
                    close.append(close_to(name, m, T(*m), m + n * 5.0, 1.0, 0.1))
    t = lm.get("sydney_tower")
    if t:
        T = ak.Terrain("sydney")
        under = [q for q in ak.load_solids("sydney") if q["base"] < 1.0 and q["top"] < 60 and Polygon(q["ring"]).buffer(0).contains(Point(*t["at"]))]
        if under:
            face = face_of(max(under, key=lambda q: abs(ak.ring_area(q["ring"])))["ring"], np.array([-1.0, 0.0]))  # Pitt Street Mall, on its west
            if face:
                m, n, _ = face
                close.append(close_to("Sydney Tower, Westfield's doors on Pitt Street Mall", m, T(*m), m + n * 5.0, 1.0, 0.1))
    out = {"close": close}
    if o:  # the rooms inside the Opera House, their doors, the seats you can take and the evening's performance
        r = opera_rooms(o)
        out.update(doors=r["doors"], interiors=r["rooms"], seats=r["seats"], shows=r["shows"])
    return out


def landmark_glows(scene):
    """The pools of light the Lower Concourse's downlights throw on its flags (web/night.js), from
    the downlights landmark_meshes laid."""
    R, hexc, k = DOWNLIGHT_POOL
    return [[x, y, R, hexc, k] for x, y in DOWNLIGHTS]


def landmark_meshes(scene):
    """(materials, meshes) for pipeline/landmarks.py."""
    DOWNLIGHTS.clear()
    lm = scene["landmarks"]
    meshes = []
    if "opera_house" in lm:
        o = lm["opera_house"]
        inside = opera_rooms(o)
        meshes += opera_house(o, inside["gaps"]) + inside["meshes"]
        meshes += steps_mesh(o["steps"], "opera_steps")
        for hall, st in o["upper_steps"].items():
            meshes += steps_mesh(st, f"opera_steps_{hall}")
        meshes += podium_mesh(o)
    mats = {k: dict(v) for k, v in MATERIALS.items()}
    if "opera_house" in lm:
        mats.update({k: dict(v) for k, v in _inside().MATERIALS.items()})
        # the sails are lit from floodlights on the podium (web/world.js "flood"): full at their
        # feet, falling off up the shells to half at the crowns, the tiles facing up
        # at a graze catching most of it, as the photographs of the sails at night show
        top = max(v[2] for m in meshes if m.name == "opera_shells" for v in m.v)
        mats["tile"]["flood"] = [o["podium"]["top_m"], round(top, 1), 0.8, 0.5]
        mats["tile"]["glow"] = 0.8  # (lit evenly at 1.0 the sails were a flat white, the shells' curves lost)
    if "harbour_bridge" in lm:
        meshes += harbour_bridge(lm["harbour_bridge"])
        mats["steel"]["flood"] = [lm["harbour_bridge"]["deck_m"], lm["harbour_bridge"]["crown_m"], 0.6, 0.55]
    if "sydney_tower" in lm:
        meshes += sydney_tower(lm["sydney_tower"])
    extra = {}
    if "bennelong" in lm:
        m, extra = bennelong_meshes(lm["bennelong"], lm.get("opera_house"), scene.get("ground", []))
        meshes += m
        mats["garden_edge"] = dict(MATERIALS["garden_edge"])  # (bennelong_meshes gives it its ground tile)
    if "opera_house" in lm:  # the halls' seats and their audience, instanced
        extra = dict(extra, props=list(extra.get("props", [])) + opera_rooms(lm["opera_house"])["props"])
    return mats, meshes, extra


# ---------------------------------------------------------------- Opera House

_ROOMS = {}


def _inside():
    import importlib.util
    import os
    import sys
    if "sydney_opera_inside" not in sys.modules:
        spec = importlib.util.spec_from_file_location("sydney_opera_inside", os.path.join(os.path.dirname(os.path.abspath(__file__)), "opera_inside.py"))
        sys.modules["sydney_opera_inside"] = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sys.modules["sydney_opera_inside"])
    return sys.modules["sydney_opera_inside"]


def opera_rooms(o):
    """The rooms inside the Opera House (opera_inside.py), fitted under the shells as they are built here: made once a run."""
    if "all" not in _ROOMS:
        ext = [m for m in opera_house(o) if m.name in ("opera_shells", "opera_shell_ribs", "opera_louvres")]
        _ROOMS["all"] = _inside().build(o, hall_shells, ext)
    return _ROOMS["all"]


def sphere_centre(a, b, c, r, inward):
    """Centre of the radius-r sphere through a, b, c on the side of `inward`."""
    ab, ac = b - a, c - a
    n = np.cross(ab, ac)
    n2 = np.dot(n, n)
    cc = a + (np.dot(ac, ac) * np.cross(n, ab) + np.dot(ab, ab) * np.cross(ac, n)) / (2 * n2)  # circumcentre
    rc = np.linalg.norm(cc - a)
    n = n / math.sqrt(n2)
    if np.dot(n, inward) < 0:
        n = -n
    return cc + n * math.sqrt(max(r * r - rc * rc, 0.0))


def slerp(p, q, t):
    """From vector p to vector q (the same length) round the circle through both, a fraction t."""
    cw = np.dot(p, q) / (np.linalg.norm(p) * np.linalg.norm(q))
    w = math.acos(min(1.0, max(-1.0, cw)))
    if w < 1e-6:
        return p + (q - p) * t
    return (math.sin((1 - t) * w) * p + math.sin(t * w) * q) / math.sin(w)


def shell_half(P, T, J, c, across, n=22):
    """Rows of points on one half of a shell: the triangle on the sphere about c (radius
    R_SHELL) with its pedestal P on the podium, its tip T and the back end of its ridge J. The
    ribs fan out from the pedestal to the ridge T..J, which is where the half meets its mirror
    image: a circle in the hall's vertical plane (normal `across`), so both halves share it.
    Rows run from the pedestal to the ridge, columns from the tip to J: the first column is the
    shell's free edge (the leg of its arch), the last its back edge."""
    cr = c - across * np.dot(c - T, across)  # the ridge circle's centre
    return [[c + slerp(P - c, cr + slerp(T - cr, J - cr, j / n) - c, i / n) for j in range(n + 1)] for i in range(n + 1)]


def side_shell(J, back_a, back_b, z0, gap, n=12):
    """A side shell on a hall's flank, between two shells that stand back to back: a smaller lobe
    facing out, two faces that meet along a crease from the shells' junction J down towards the
    podium. Each face runs along one shell's back edge (back_a, back_b: points from J down to its
    pedestal) to where that edge comes within `gap` of the podium; under the side shell is glass.
    Returns the faces' rows of points (from J; columns from the back edge to the crease), the
    glass wall's foot, and its outline from one pedestal round to the other."""
    mid = (back_a[-1] + back_b[-1]) / 2
    out = mid[:2] - (J[:2] - mid[:2]) / np.linalg.norm(J[:2] - mid[:2]) * 1.5  # the crease comes down a little outside the pedestals' line
    B = np.array([*out, z0 + gap * 0.55])
    faces, corners = [], []
    for e in (back_a, back_b):
        k = next(i for i, q in enumerate(e) if q[2] <= z0 + gap)
        corners.append(k)
        rail = [e[int(x)] + (e[min(int(x) + 1, k)] - e[int(x)]) * (x - int(x)) for x in np.linspace(0, k, n + 1)]
        c = sphere_centre(J, e[k], B, R_SHELL, np.array([*mid[:2], z0 - 30.0]) - (J + e[k] + B) / 3)
        rows = []
        for i in range(n + 1):
            p, q = rail[i], J + (B - J) * i / n
            row = []
            for j in range(n + 1):
                w = j / n
                r = p + (q - p) * w
                row.append(r + (c + (r - c) * R_SHELL / np.linalg.norm(r - c) - r) * 4 * w * (1 - w))  # bowed onto its sphere between the edges
            rows.append(row)
        faces.append(rows)
    outline = back_a[corners[0]:][::-1] + faces[0][-1][1:] + faces[1][-1][::-1][1:] + back_b[corners[1]:][1:]
    return faces, np.array([*out, z0]), outline


def hall_shells(hall, ridges, z0):
    """The shells of a hall from SHELLS on its ridges, as 3D points: the back end of its ridge J
    (where it meets the shell it stands back to back with, or goes into the mouth of the one
    behind it), its tip T, and its pedestals on the hall's west and east flanks, where the legs
    of its arch stand."""
    R = [(np.array(r[:2]), np.array(r[2:])) for r in ridges]
    if hall == "restaurant":  # one ridge for both
        a, b = R[0]
        m = a + (b - a) * RESTAURANT_SPLIT
        R = [(a, m), (m, b)]
    h = R[-1][1] - R[0][0]
    east = np.array([h[1], -h[0]]) / np.linalg.norm(h)
    junction = (R[0][1] + R[1][0]) / 2
    out = []
    for k, ((facing, tip_m, back, half), (s, e)) in enumerate(zip(SHELLS[hall], R)):
        tip = s if facing < 0 else e
        if k < 2:  # back to back
            J = np.array([*junction, z0 + JUNCTION_M[hall]])
        else:  # nested: its ridge goes back into the mouth of the one behind
            f = (e - s) / np.linalg.norm(e - s)
            J = np.array([*(s - f * NESTED_BACK), z0 + NESTED_RISE * (tip_m - z0)])
        f = (tip - J[:2]) / np.linalg.norm(tip - J[:2])
        foot = tip - f * back
        out.append((J, np.array([*tip, tip_m]), [np.array([*(foot + east * sd * half), z0]) for sd in (-1, 1)]))
    return out


def shell_point(P, T, J, c, across, a, b):
    """A point of a shell's half (shell_half): a of the way up the rib from the pedestal P to the point b of the
    way along the ridge from the tip T to its back end J."""
    cr = c - across * np.dot(c - T, across)
    return c + slerp(P - c, cr + slerp(T - cr, J - cr, b) - c, a)


RIB_M = (0.28, 0.7, 1.5)  # the ribs under the tiles: the groove between two, and a rib's depth at the pedestal and at the ridge


def shell_ribs(m, P, T, J, c, across, bays, rows=12):
    """The underside of one half of a shell: its precast ribs fanning out from the pedestal, side by side, each a
    rounded trough deepening towards the ridge with a narrow groove between it and the next (The Arup Journal,
    1973: the ribs' centre lines 3.65 degrees apart, their section from a solid T at the pedestal to an open Y,
    deeper towards the ridge). u counts the ribs, v is metres up the rib."""
    g, d0, d1 = RIB_M
    sec = [(0.0, 0.0), (0.16, 1.0), (0.84, 1.0), (1.0, 0.0)]  # across a rib: (share of its width, share of its depth)
    for k in range(bays):
        cols = []
        for s, dk in sec:
            col, v = [], 0.0
            for i in range(rows + 1):
                a = 0.04 + 0.96 * i / rows  # (the ribs run into the pedestal's fan)
                q = shell_point(P, T, J, c, across, a, (k + s) / bays)
                q = q + (c - q) / R_SHELL * (g + dk * (d0 + (d1 - d0) * a - g) * min(1.0, a * 6))
                if col:
                    v += float(np.linalg.norm(q - col[-1][0]))
                col.append((q, [k + s, v]))
            cols.append(col)
        m.grid([[q for q, _ in col] for col in cols], [[t for _, t in col] for col in cols])
        for i in (0, rows):  # each rib's ends closed, up to the tiles: at the ridge beam, and where it runs into the pedestal
            top = [shell_point(P, T, J, c, across, 0.04 + 0.96 * i / rows, (k + s_) / bays) for s_, _ in sec]
            for a_, b_ in zip(range(3), range(1, 4)):
                m.quad(cols[a_][i][0], cols[b_][i][0], top[b_], top[a_], [cols[a_][i][1], cols[b_][i][1], cols[b_][i][1], cols[a_][i][1]])


def louvre_wall(m, leg, back, n=10):
    """The bronze louvre wall that closes a shell's mouth round the shell nested in it (shells A2, A3, B2 and B3
    have louvre walls where the others have glass: The Arup Journal, 1973): from the leg of the shell's arch
    (pedestal to tip) across to the back edge of the nested shell (its pedestal up to the back end of its ridge)."""
    at = lambda e, t: e[min(int(t * (len(e) - 1)), len(e) - 2)] + (e[min(int(t * (len(e) - 1)), len(e) - 2) + 1] - e[min(int(t * (len(e) - 1)), len(e) - 2)]) * (t * (len(e) - 1) - min(int(t * (len(e) - 1)), len(e) - 2))
    for k in range(n):
        a0, a1, b0, b1 = at(leg, k / n), at(leg, (k + 1) / n), at(back, k / n), at(back, (k + 1) / n)
        m.quad(b0, a0, a1, b1, [[0.0, b0[2]], [float(np.linalg.norm(a0 - b0)), a0[2]], [float(np.linalg.norm(a1 - b1)), a1[2]], [0.0, b1[2]]])


def opera_house(o, gaps=()):
    """The three groups of shells on the ridges OSM maps, each shell two halves on the one sphere
    radius, and side shells on the flanks between the shells that stand back to back: tiled,
    with the precast edge of each shell along the legs of its arch and a cap along its ridge; under the tiles
    the ribs, fanning from the pedestals; and what closes their mouths: glass walls, topaz glass on bronze mullions
    fanning out from the foot of each mouth, in the first and the last shell of a hall, and bronze louvre walls
    round the shells nested in the others."""
    shells = Mesh("opera_shells", "tile", True, floodlit=True, uv=True)
    rims, caps = Mesh("opera_shell_rims", "tile_edge", False), Mesh("opera_shell_ridges", "tile_edge", True)
    glass = Mesh("opera_glass", "glass", False, floodlit=True, uv=True)
    ribs = Mesh("opera_shell_ribs", "rib", True, floodlit=True, uv=True)
    ribs.sky, ribs.bounce = 0.5, MATERIALS["granite"]["color"]
    louvres = Mesh("opera_louvres", "louvre", False, uv=True)
    deep = RIB_M[2] + 0.1
    for hall, ridges in o["halls"].items():
        z0 = o["podium"]["low_m" if hall == "restaurant" else "top_m"]  # the restaurant stands on the lower landing
        backs = []  # each shell's back edges, west and east: from J down to the pedestal
        all_legs = []
        built = hall_shells(hall, ridges, z0)
        for k, (J, T, peds) in enumerate(built):
            f = (T[:2] - J[:2]) / np.linalg.norm(T[:2] - J[:2])
            across = np.array([f[1], -f[0], 0.0])
            below = np.array([*((J[:2] + T[:2]) / 2), z0 - 30.0])
            legs, edges, outer = [], [], []
            for P in peds:
                c = sphere_centre(P, T, J, R_SHELL, below - (P + T + J) / 3)
                pts = shell_half(P, T, J, c, across)
                uv = shell_uv(pts)
                shells.grid(pts, uv)
                shell_ribs(ribs, P, T, J, c, across, round(uv[0][-1][0]))
                leg = [r[0] for r in pts]  # the free edge, from the pedestal up to the tip
                depth = [RIB_M[0] + (RIB_M[1] + (RIB_M[2] - RIB_M[1]) * i / (len(leg) - 1) - RIB_M[0]) * min(1.0, i / (len(leg) - 1) * 6) + 0.1 for i in range(len(leg))]
                inner = [q - (q - c) / R_SHELL * d for q, d in zip(leg, depth)]  # the shell's thickness: the precast ribs under the tiles
                for i in range(len(leg) - 1):
                    rims.quad(leg[i], leg[i + 1], inner[i + 1], inner[i])
                back = [r[-1] for r in pts]
                binner = [q - (q - c) / R_SHELL * d for q, d in zip(back, depth)]
                for i in range(len(back) - 1):  # and along its back edge
                    rims.quad(back[i + 1], back[i], binner[i], binner[i + 1])
                legs.append([q - (q - c) / R_SHELL * 0.7 for q in leg])  # the glass stands a little inside the edge
                outer.append(leg)
                edges.append(back[::-1])
            caps.sweep(pts[-1], [(-0.65, -0.25), (0.65, -0.25), (0.65, 0.12), (0.3, 0.3), (-0.3, 0.3), (-0.65, 0.12)])
            if k == 0 or k == len(built) - 1:  # the first and the last shell's mouths: glass
                mouth(glass, np.array([T[0], T[1], z0]), legs[0] + legs[1][::-1][1:],
                      z0 + NORTH_TIERS["roof_up"] if hall != "restaurant" and k else None, gaps)
            backs.append(edges)
            all_legs.append(legs)
        for k in range(1, len(built) - 1):  # round a nested shell, in the mouth of the one behind: louvres
            for side in (0, 1):
                louvre_wall(louvres, all_legs[k][side], backs[k + 1][side][::-1])
        for side in (0, 1):  # side shells between the back-to-back pair
            faces, foot, outline = side_shell(backs[0][side][0], backs[0][side], backs[1][side], z0, SIDE_GLASS_M[hall])
            for pts in faces:
                shells.grid(pts, shell_uv(pts))
                caps.sweep([r[-1] for r in pts], [(-0.35, -0.2), (0.35, -0.2), (0.35, 0.08), (-0.35, 0.08)])
            mouth(glass, foot, outline)
    return [shells, rims, caps, glass, ribs, louvres]


def mouth(glass, foot, arch, stop=None, gaps=()):
    """A glass wall hung from a shell's arch (points from one foot over to the other): a curtain of
    panes down to a line on the podium from one end of the arch through `foot`, under the tip, to
    the other. The bronze mullions that close in towards the foot, one at every second point of the
    arch, and the transoms are drawn on the glass (web/world.js "topaz_glass": u counts the mullions,
    v is metres above the datum)."""
    z0 = foot[2]
    ground = lambda q: np.array([q[0], q[1], z0])
    if stop is not None:  # down to `stop`, where the foyer's own glass takes over (north_tiers), and no lower than the arch
        ground = lambda q: np.array([q[0], q[1], min(stop, q[2])])
        foot = np.array([foot[0], foot[1], stop])
    run = lambda pts: np.concatenate([[0.0], np.cumsum([np.linalg.norm(q - p) for p, q in zip(pts, pts[1:])])])
    sa, line = run(arch), [ground(arch[0]), foot, ground(arch[-1])]
    sl = run(line)
    t = sa / sa[-1] * sl[-1]
    seg = np.minimum(np.searchsorted(sl, t, side="right") - 1, len(line) - 2)
    bottom = [line[k] + (line[k + 1] - line[k]) * ((tt - sl[k]) / max(sl[k + 1] - sl[k], 1e-9)) for k, tt in zip(seg, t)]
    foot_of = list(bottom)
    for (gx, gy), r, h in gaps:  # a doorway through the glass (opera_inside.py): the glass stops at its portal's head
        bottom = [np.array([b[0], b[1], max(b[2], z0 + h)]) if math.hypot(b[0] - gx, b[1] - gy) < r else b for b in bottom]
    lift = [b[2] > f[2] + 0.01 for b, f in zip(bottom, foot_of)]
    for k in range(len(arch) - 1):
        if lift[k] != lift[k + 1]:  # beside the opening the glass comes down to the podium again, square (no slope over the doorway)
            b0, b1 = (np.array([b[0], b[1], max(bottom[k][2], bottom[k + 1][2])]) for b in (bottom[k], bottom[k + 1]))
            glass.quad(b0, b1, foot_of[k + 1], foot_of[k], [[k / 2, b0[2]], [(k + 1) / 2, b1[2]], [(k + 1) / 2, foot_of[k + 1][2]], [k / 2, foot_of[k][2]]])
            bottom[k], bottom[k + 1] = (b0, bottom[k + 1]) if lift[k + 1] else (bottom[k], b1)
            glass.quad(arch[k], arch[k + 1], b1, b0, [[k / 2, arch[k][2]], [(k + 1) / 2, arch[k + 1][2]], [(k + 1) / 2, b1[2]], [k / 2, b0[2]]])
            continue
        glass.quad(arch[k], arch[k + 1], bottom[k + 1], bottom[k],
                   [[k / 2, arch[k][2]], [(k + 1) / 2, arch[k + 1][2]], [(k + 1) / 2, bottom[k + 1][2]], [k / 2, bottom[k][2]]])


def shell_uv(pts):
    """Texture coordinates for one half from shell_half(), its rows from the pedestal: u counts
    the rib bays across it (the ribs fan out from the pedestal), v is metres along a rib."""
    rows, cols = len(pts), len(pts[0])
    edge = sum(np.linalg.norm(pts[-1][j + 1] - pts[-1][j]) for j in range(cols - 1))
    bays = max(3, round(edge / 4.2))
    uv = [[[0.0, 0.0] for _ in range(cols)] for _ in range(rows)]
    for j in range(cols):
        v = 0.0
        for r in range(rows):
            if r:
                v += np.linalg.norm(pts[r][j] - pts[r - 1][j])
            uv[r][j] = [bays * j / (cols - 1), v]
    return uv


def steps_mesh(st, name):
    """Solid granite steps from the profile: treads with a nosing that overhangs the riser, the
    risers, and the cheek walls either side. UVs in metres across the steps (u) and from the
    front of each tread (v), or up a riser from its foot to its top (0 to 1)."""
    o, f = np.array(st["origin"], float), np.array(st["axis"], float)
    l, hw, base = np.array([f[1], -f[0]]), st["half_width"], st.get("base_m", st["z_foot"] - 0.5)
    treads, risers = Mesh(name, "granite", False, uv=True), Mesh(f"{name}_risers", "granite_riser", False, uv=True)
    walls = Mesh(f"{name}_walls", "podium", False, uv=True)
    NOSE, LIP = 0.03, 0.035  # the nosing's overhang and depth

    def P(u, v, z):
        xy = o + f * u + l * v
        return np.array([xy[0], xy[1], z])

    def face(m, a, b, c, d, out, uv):  # a quad wound so its normal points along `out`
        if np.dot(np.cross(b - a, c - a), out) < 0:
            a, b, c, d, uv = d, c, b, a, uv[::-1]
        m.quad(a, b, c, d, uv)
    up, south, east = np.array([0, 0, 1.0]), np.array([-f[0], -f[1], 0]), np.array([l[0], l[1], 0])
    prof = st["profile"]
    for (u0, z0), (u1, z1) in zip(prof, prof[1:]):
        u1 = min(u1, 0.0)  # the podium takes over at the top riser
        if u1 <= u0:
            continue
        for sd in (-1, 1):  # the cheek walls, under every tread and riser
            face(walls, P(u0, sd * hw, base), P(u1, sd * hw, base), P(u1, sd * hw, z1), P(u0, sd * hw, z0), sd * east,
                 [[u0, base], [u1, base], [u1, z1], [u0, z0]])
        if abs(z1 - z0) < 1e-6 or u1 - u0 > 1.0:  # a tread, a landing or the apron ramp
            n0 = u0 - NOSE if abs(z1 - z0) < 1e-6 and u0 > prof[1][0] else u0  # every tread above the first riser overhangs it
            d = u1 - n0
            face(treads, P(n0, -hw, z0), P(u1, -hw, z1), P(u1, hw, z1), P(n0, hw, z0), up, [[-hw, 0], [-hw, d], [hw, d], [hw, 0]])
            if n0 < u0:  # the nosing's front and its underside, in the riser's shade
                face(risers, P(n0, -hw, z0 - LIP), P(n0, hw, z0 - LIP), P(n0, hw, z0), P(n0, -hw, z0), south, [[-hw, 0.75], [hw, 0.75], [hw, 1], [-hw, 1]])
                face(risers, P(n0, -hw, z0 - LIP), P(u0, -hw, z0 - LIP), P(u0, hw, z0 - LIP), P(n0, hw, z0 - LIP), -up,
                     [[-hw, 1], [-hw, 1], [hw, 1], [hw, 1]])
        else:  # a riser
            face(risers, P(u0, -hw, z0), P(u0, hw, z0), P(u1, hw, z1), P(u1, -hw, z1), south, [[-hw, 0], [hw, 0], [hw, 1], [-hw, 1]])
    face(walls, P(prof[0][0], -hw, base), P(prof[0][0], hw, base), P(prof[0][0], hw, prof[0][1]), P(prof[0][0], -hw, prof[0][1]), south,
         [[-hw, base], [hw, base], [hw, prof[0][1]], [-hw, prof[0][1]]])
    return [treads, risers, walls]


def podium_mesh(o):
    """The podium's walls on both levels, clad in granite panels (just proud of the building's
    own walls, which the analyses keep), with a low upstand and a bronze handrail along its
    edges: round the outside, and along the upper podium above the lower landing, except at the
    tops of the flights."""
    tops = [o["steps"]] + list(o["upper_steps"].values())

    def at_top(m):  # the middle of an edge at the top of a flight
        for st in tops:
            so, f = np.array(st["origin"]), np.array(st["axis"])
            if abs((m - so) @ f) < 0.3 and abs((m - so) @ np.array([f[1], -f[0]])) < st["half_width"] + 0.1:
                return True
        return False
    clad, upstand, rail = Mesh("opera_podium", "podium", False, uv=True), Mesh("opera_podium_upstand", "podium", False), Mesh("opera_podium_rail", "mullion", False)
    slots = Mesh("opera_podium_slots", "opening", False, floodlit=True)
    # paving on the landing (the strip the game walks on) and over the upper podium's roof, in metres
    # along and across the steps
    landing, deck, st = Mesh("opera_steps_landing", "paving", False, uv=True), Mesh("opera_podium_deck", "paving", False, uv=True), o["landing"]
    so, f = np.array(st["origin"]), np.array(st["axis"])
    l = np.array([f[1], -f[0]])
    for m, rings, z in ((landing, o["podium"]["decks"][0], o["podium"]["low_m"]), (deck, o["podium"]["decks"][1], o["podium"]["top_m"] + 0.02)):
        for ring in rings:
            for t in shapely.constrained_delaunay_triangles(Polygon(ring)).geoms:
                cs = np.asarray(t.exterior.coords)[:3]
                (ax, ay), (bx, by) = cs[1] - cs[0], cs[2] - cs[0]
                if ax * by - ay * bx < 0:  # anticlockwise from above: facing up
                    cs = cs[::-1]
                m.tri(*[np.array([*c, z]) for c in cs], [[(c - so) @ l, (c - so) @ f] for c in cs])
    north = north_end(o)
    for level in o["podium"]["rings"]:
        top, ring, run = level["top_m"], level["ring"], 0.0
        upper = top > o["podium"]["low_m"] + 0.1
        for p, q in zip(ring, ring[1:]):
            p, q = np.array(p), np.array(q)
            e = q[:2] - p[:2]
            L = float(np.linalg.norm(e))
            if L < 0.05:
                continue
            out = np.array([e[1], -e[0]]) / L  # the ring runs anticlockwise: outward is to its right
            run += L
            if at_top((p[:2] + q[:2]) / 2):
                continue  # the flight covers the wall below it, and its top stays open
            if upper and p[3] and q[3] and north((p[:2] + q[:2]) / 2, out) is not None:
                continue  # the north end's tiers (north_tiers)
            a, b = p[:2] + out * 0.04, q[:2] + out * 0.04
            clad.quad(np.array([*a, p[2] - 0.5]), np.array([*b, q[2] - 0.5]), np.array([*b, top]), np.array([*a, top]),
                      [[run - L, p[2] - 0.5], [run, q[2] - 0.5], [run, top], [run - L, top]])
            if upper and p[3] and q[3] and out[1] > -0.6 and L > 1.0:  # the foyers' slot of glass along the outer walls, not on the south front
                sa, sb = p[:2] + out * 0.07, q[:2] + out * 0.07
                slots.quad(np.array([*sa, SLOT_M[0]]), np.array([*sb, SLOT_M[0]]), np.array([*sb, SLOT_M[1]]), np.array([*sa, SLOT_M[1]]))
            if not (p[3] and q[3] or upper):
                continue  # inside the outline, the lower landing's edge is the foot of the upper podium's wall
            a, b = p[:2] - out * 0.2, q[:2] - out * 0.2
            upstand.box(np.array([*a, top + 0.25]), np.array([*b, top + 0.25]), 0.4, 0.5)
            rail.rails([np.array([*a, top]), np.array([*b, top])], 1.05, post_every=3.0, post=0.05, rail=0.06, rails=1)
    return [clad, upstand, rail, landing, deck, slots] + north_tiers(o, north)


def north_end(o):
    """A test for the podium's north end: f(midpoint, outward normal) of an edge of the upper
    podium's outline -> the foot line of the glass wall in the mouth it stands in front of (the
    harbour-facing shell of the Concert Hall or the Joan Sutherland Theatre), or None."""
    feet = []
    for hall in ("concert", "joan_sutherland"):
        if hall not in o["halls"]:
            continue
        J, T, peds = hall_shells(hall, o["halls"][hall], o["podium"]["top_m"])[-1]
        f = (T[:2] - J[:2]) / np.linalg.norm(T[:2] - J[:2])
        feet.append((shapely.LineString([peds[0][:2], T[:2], peds[1][:2]]), f, (peds[0][:2] + peds[1][:2]) / 2))

    def test(m, out):
        for line, f, c in feet:
            if (m - c) @ f > 0 and out @ f > 0.2 and line.distance(Point(*m)) < NORTH_TIERS["reach_m"]:
                return line
        return None
    return test


def north_tiers(o, north):
    """The podium's north end (NORTH_TIERS): the tiers stepping back as they rise, each over a band
    of glass under a hood, and the foyer's leaning band of glass with its bronze rim and its glass
    roof back to the shell's glass wall."""
    N = NORTH_TIERS
    ring = next(level["ring"] for level in o["podium"]["rings"] if level["top_m"] > o["podium"]["low_m"] + 0.1)
    top = o["podium"]["top_m"]
    t1, t2 = SLOT_M[0], top - N["top_tier_m"]
    g_out, g_h = N["ground_glass"]
    hood_out, hood_h = N["hood"]
    # runs of consecutive edges at the north end, with their vertices' outward normals averaged
    P = [np.array(p, float) for p in ring]
    sel = []
    for k in range(len(P) - 1):
        e = P[k + 1][:2] - P[k][:2]
        L = np.linalg.norm(e)
        out = np.array([e[1], -e[0]]) / (L or 1)
        sel.append(L > 0.05 and P[k][3] and P[k + 1][3] and north((P[k][:2] + P[k + 1][:2]) / 2, out) is not None)
    runs, cur = [], []
    for k, on in enumerate(sel):
        if on:
            cur = cur or [k]
            cur.append(k + 1)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    clad = Mesh("opera_north_tiers", "podium", False, uv=True)
    shop = Mesh("opera_north_windows", "opening", False, floodlit=True)
    glass = Mesh("opera_north_glass", "glass", False, floodlit=True, uv=True)
    rim = Mesh("opera_north_rim", "mullion", True)
    for idx in runs:
        V = [P[k] for k in idx]
        n = []
        for i in range(len(V)):
            a, b = V[max(i - 1, 0)][:2], V[min(i + 1, len(V) - 1)][:2]
            t = (b - a) / (np.linalg.norm(b - a) or 1)
            n.append(np.array([t[1], -t[0]]))
        s = np.concatenate([[0.0], np.cumsum([np.linalg.norm(V[i + 1][:2] - V[i][:2]) for i in range(len(V) - 1)])])
        X = lambda i, d, z: np.array([*(V[i][:2] + n[i] * d), z])
        # the profile from the broadwalk up: (d out, z) pairs, each pair of rows a face
        prof = lambda g: [
            ("shop", (g_out, g - 0.4), (g_out, g + g_h)),
            ("clad", (g_out, g + g_h), (N["tier1"] + hood_out, g + g_h)),
            ("clad", (N["tier1"] + hood_out, g + g_h), (N["tier1"], g + g_h + hood_h)),
            ("clad", (N["tier1"], g + g_h + hood_h), (N["tier1"], t1)),
            ("clad", (N["tier1"], t1), (N["tier2"] - 0.3, t1)),
            ("shop", (N["tier2"] - 0.3, t1), (N["tier2"] - 0.3, SLOT_M[1])),
            ("clad", (N["tier2"] - 0.3, SLOT_M[1]), (N["tier2"] + hood_out, SLOT_M[1])),
            ("clad", (N["tier2"] + hood_out, SLOT_M[1]), (N["tier2"], SLOT_M[1] + hood_h)),
            ("clad", (N["tier2"], SLOT_M[1] + hood_h), (N["tier2"], t2)),
            ("clad", (N["tier2"], t2), (0.0, t2)),
            ("clad", (0.0, t2), (0.0, top)),
            ("glass", (0.0, top), (N["bowl_out"], top + N["bowl_up"])),
        ]
        for i in range(len(V) - 1):
            pa, pb = prof(V[i][2]), prof(V[i + 1][2])
            for (kind, a0, a1), (_, b0, b1) in zip(pa, pb):
                q = [X(i, *a0), X(i + 1, *b0), X(i + 1, *b1), X(i, *a1)]
                if kind == "clad":
                    clad.quad(*q, [[s[i], a0[1]], [s[i + 1], b0[1]], [s[i + 1], b1[1]], [s[i], a1[1]]])
                elif kind == "shop":
                    shop.quad(*q)
                else:
                    glass.quad(*q, [[s[i] / N["panel_m"], a0[1]], [s[i + 1] / N["panel_m"], b0[1]], [s[i + 1] / N["panel_m"], b1[1]], [s[i] / N["panel_m"], a1[1]]])
            # the foyer's glass roof, from the rim back to the shell's glass wall
            line = north((V[i][:2] + V[i + 1][:2]) / 2, n[i])
            if line is not None:
                ra, rb = X(i, N["bowl_out"], top + N["bowl_up"]), X(i + 1, N["bowl_out"], top + N["bowl_up"])
                ia, ib = (np.array([*np.asarray(shapely.ops.nearest_points(line, Point(*r[:2]))[0].coords[0]), top + N["roof_up"]]) for r in (ra, rb))
                glass.quad(ra, rb, ib, ia, [[s[i] / N["panel_m"], 0], [s[i + 1] / N["panel_m"], 0], [s[i + 1] / N["panel_m"], 1], [s[i] / N["panel_m"], 1]])
        rim.tube([X(i, N["bowl_out"], top + N["bowl_up"] + 0.08) for i in range(len(V))], 0.14, sides=6)
    print(f"  the podium's north end: {len(runs)} runs of tiers along {sum(np.linalg.norm(P[k + 1][:2] - P[k][:2]) for k, on in enumerate(sel) if on):.0f} m")
    return [m for m in (clad, shop, glass, rim) if m.v]


# ---------------------------------------------------------------- Harbour Bridge

def harbour_bridge(h):
    s, n = np.array(h["south_pylons"], float), np.array(h["north_pylons"], float)
    m = (s + n) / 2
    ax = (n - s) / np.linalg.norm(n - s)
    lat = np.array([ax[1], -ax[0]])
    half = h["span_m"] / 2
    z_bear, z_crown = 4.0, h["crown_m"]
    deck_under = h["deck_m"]
    deck_top = deck_under + 3.0
    panels = 28
    end_depth = 57.0
    crown_depth = 18.0

    def P(u, v, z):
        xy = m + ax * u + lat * v
        return np.array([xy[0], xy[1], z])

    def bottom(u):
        return z_bear + (z_crown - crown_depth - z_bear) * (1 - (u / half) ** 2)

    def top(u):
        z_end = z_bear + end_depth
        return z_end + (z_crown - z_end) * (1 - (u / half) ** 2)

    steel, deck = Mesh("bridge_steel", "steel", False, floodlit=True), Mesh("bridge_deck", "deck", False, uv=True)
    # the steel inside the deck's depth; named under the deck strip, whose slab the game uses for it
    under_steel = Mesh("bridge_deck_steel", "steel", False)
    us = np.linspace(-half, half, panels + 1)
    for v in (-h["truss_spacing_m"] / 2, h["truss_spacing_m"] / 2):
        for k in range(panels):
            u0, u1 = us[k], us[k + 1]
            steel.box(P(u0, v, bottom(u0)), P(u1, v, bottom(u1)), 3.5, 4.0)    # bottom chord
            steel.box(P(u0, v, top(u0)), P(u1, v, top(u1)), 2.5, 3.0)          # top chord
            if k % 2 == 0:                                                     # Warren diagonals
                steel.box(P(u0, v, bottom(u0)), P(u1, v, top(u1)), 1.6, 1.6)
            else:
                steel.box(P(u0, v, top(u0)), P(u1, v, bottom(u1)), 1.6, 1.6)
        for u in us:
            steel.box(P(u, v, bottom(u)), P(u, v, top(u)), 1.8, 1.8)           # verticals
            zb = bottom(u)
            if zb > deck_top + 1:                                              # hangers down to the deck
                steel.box(P(u, v, deck_top), P(u, v, zb), 0.8, 0.8)
            elif zb < deck_under - 1:                                          # posts up to the deck
                steel.box(P(u, v, zb), P(u, v, deck_under), 1.4, 1.4)
    tsp = h["truss_spacing_m"] / 2
    for k in range(panels):                                                    # top lateral bracing
        u0, u1 = us[k], us[k + 1]
        steel.box(P(u0, -tsp, top(u0)), P(u1, tsp, top(u1)), 0.9, 0.9)
        steel.box(P(u0, tsp, top(u0)), P(u1, -tsp, top(u1)), 0.9, 0.9)
        steel.box(P(u0, -tsp, top(u0)), P(u0, tsp, top(u0)), 1.0, 1.0)
    # deck: level across the arch and pylons, then the approach viaducts down to the ground
    w = h["deck_width_m"] / 2
    prof = h.get("deck_profile") or [[-np.linalg.norm(n - s) / 2 - 190, deck_top], [np.linalg.norm(n - s) / 2 + 190, deck_top]]
    slab = 0.5  # the deck slab; under it, inside the deck's depth, the steel that carries it
    run = 0.0  # metres along the deck, for the lane markings
    for (u0, z0), (u1, z1) in zip(prof[:-1], prof[1:]):
        a0, a1, b0, b1 = P(u0, -w, z0), P(u1, -w, z1), P(u0, w, z0), P(u1, w, z1)
        under = lambda p: p - np.array([0, 0, deck_top - deck_under])
        soffit = lambda p: p - np.array([0, 0, slab])
        seg = float(np.linalg.norm(a1 - a0))
        deck.quad(a0, b0, b1, a1, [[run, 0], [run, 2 * w], [run + seg, 2 * w], [run + seg, 0]])
        run += seg
        under_steel.quad(soffit(a1), soffit(b1), soffit(b0), soffit(a0))
        deck.quad(a0, a1, under(a1), under(a0))
        deck.quad(b1, b0, under(b0), under(b1))
    # the deck's steel, seen from below: edge girders behind the fascias, stringers along the
    # deck, and a cross girder at every panel point (the hangers' spacing) along its length
    depth = deck_top - deck_under - slab
    along = lambda v: [P(u, v, z - slab) for u, z in prof]
    for v in (-w + 0.35, w - 0.35):
        under_steel.sweep(along(v), [(-0.3, -depth), (0.3, -depth), (0.3, 0.0), (-0.3, 0.0)])
    for v in np.linspace(-w + 5, w - 5, 7):
        under_steel.sweep(along(v), [(-0.22, -1.2), (0.22, -1.2), (0.22, 0.0), (-0.22, 0.0)])
    panel = h["span_m"] / panels
    for u in np.arange(np.ceil(prof[0][0] / panel) * panel, prof[-1][0], panel):
        zc = deck_at(prof, u) - slab - depth / 2
        under_steel.box(P(u, -w + 0.65, zc), P(u, w - 0.65, zc), 0.7, depth)
    deck.quad(P(prof[0][0], w, prof[0][1]), P(prof[0][0], -w, prof[0][1]),
              P(prof[0][0], -w, prof[0][1] - 3), P(prof[0][0], w, prof[0][1] - 3))
    deck.quad(P(prof[-1][0], -w, prof[-1][1]), P(prof[-1][0], w, prof[-1][1]),
              P(prof[-1][0], w, prof[-1][1] - 3), P(prof[-1][0], -w, prof[-1][1] - 3))
    half_pyl = np.linalg.norm(n - s) / 2
    furniture = deck_furniture(P, prof, w)
    for sign, g in ((-1, h["approach_ground_south"]), (1, h["approach_ground_north"])):  # approach piers
        end = abs(prof[0][0] if sign < 0 else prof[-1][0])
        for u in np.arange(half_pyl + 40, end - 15, 45):
            zt = deck_at(prof, sign * u) - 3.0
            for v in (-w + 4, w - 4):
                steel.box(P(sign * u, v, g - 5), P(sign * u, v, zt), 4.0, 4.0)
    return [steel, deck, under_steel] + furniture


def deck_furniture(P, prof, w):
    """On the deck: the railway's two tracks, the concrete barriers between the strips, a
    railing along both edges and lamp standards; P(u, v, z) with v from the deck's centre
    (east positive), prof the deck profile [[u, z]], w the half width."""
    # named under the deck strip ("bridge_deck"), so the game walks them as part of the deck
    rails, barriers, railings, lamps, heads = (Mesh("bridge_deck_rails", "rail", False), Mesh("bridge_deck_barriers", "barrier", False),
                                              Mesh("bridge_deck_railings", "railing", False, uv=True), Mesh("bridge_deck_lamps", "lamp", False),
                                              Mesh("bridge_deck_lamp_heads", "lamp", False, floodlit=True))
    edges, v = [], 0.0
    for width, kind in DECK_ZONES:
        edges.append((v - w, v + width - w, kind))
        v += width
    along = lambda vv, dz: [P(u, vv, z + dz) for u, z in prof]
    for v0, v1, kind in edges:
        if kind == "rail":  # standard gauge, two tracks
            for tc in (v0 + (v1 - v0) * 0.25, v0 + (v1 - v0) * 0.75):
                for r in (-0.7175, 0.7175):
                    rails.sweep(along(tc + r, 0.0), [(-0.035, 0.0), (0.035, 0.0), (0.035, 0.16), (-0.035, 0.16)])
        if kind == "barrier":  # a New Jersey profile, 0.9 m high
            hw = (v1 - v0) / 2
            barriers.sweep(along((v0 + v1) / 2, 0.0), [(-hw, 0.0), (hw, 0.0), (hw * 0.55, 0.3), (hw * 0.3, 0.9), (-hw * 0.3, 0.9), (-hw * 0.55, 0.3)])
    for vv in (-w + 0.25, w - 0.25):  # railings: a strip with the bars cut out by the material
        railings.panel(along(vv, 0.0), 1.3)
    # lamps on the barriers either side of the six lanes, every 36 m along the deck
    lane = next(e for e in edges if e[2] == "lanes6")
    for vb, side in ((lane[0] - 0.3, 1), (lane[1] + 0.3, -1)):
        run = 0.0
        for (u0, z0), (u1, z1) in zip(prof[:-1], prof[1:]):
            L = math.hypot(u1 - u0, z1 - z0)
            for t in np.arange((-run) % 36.0, L, 36.0):
                u, z = u0 + (u1 - u0) * t / L, z0 + (z1 - z0) * t / L
                base, top = P(u, vb, z + 0.9), P(u, vb, z + 9.0)
                lamps.box(base, top, 0.22, 0.22)
                end = P(u, vb + side * 2.2, z + 9.3)
                lamps.box(top, end, 0.14, 0.14)
                heads.box(end - np.array([0, 0, 0.2]), end + np.array([0, 0, 0.05]), 0.7, 0.35)
            run += L
    return [rails, barriers, railings, lamps, heads]


# ---------------------------------------------------------------- Sydney Tower

def sydney_tower(t):
    """Shaft, golden turret, mast and the cable stays, on the replaced OSM parts' sizes."""
    cx, cy = t["at"]
    z_pod, (z_t0, z_t1), z_top = t["podium_m"], t["turret_m"], t["top_m"]
    rs, rt = t["shaft_r"], t["turret_r"]
    shaft, turret, glazing, mast, cables = (Mesh("sydney_tower_shaft", "tower", True), Mesh("sydney_tower_turret", "turret", True, floodlit=True),
                                            Mesh("sydney_tower_glazing", "turret_glass", True), Mesh("sydney_tower_mast", "tower", True),
                                            Mesh("sydney_tower_cables", "cable", False))
    shaft.lathe([(z_pod - 1.0, rs), (z_t0 + 1.0, rs)], (cx, cy), 28)
    h = z_t1 - z_t0
    # the turret: a flared underside, two glazed bands of levels between gold bands, and a cap
    prof = [(z_t0, rs), (z_t0 + 0.18 * h, rt * 0.94), (z_t0 + 0.24 * h, rt), (z_t0 + 0.30 * h, rt), (z_t0 + 0.52 * h, rt),
            (z_t0 + 0.58 * h, rt * 1.01), (z_t0 + 0.80 * h, rt * 1.01), (z_t0 + 0.86 * h, rt * 0.97), (z_t1, rt * 0.55), (z_t1 + 0.6, rs * 0.4)]
    turret.lathe(prof, (cx, cy), 48)
    for z0, z1 in ((z_t0 + 0.31 * h, z_t0 + 0.51 * h), (z_t0 + 0.59 * h, z_t0 + 0.79 * h)):
        glazing.lathe([(z0, rt * 1.012), (z1, rt * 1.012)], (cx, cy), 48)
    # the mast with the lightning rod, tapering to the published 309 m
    mast.lathe([(z_t1 + 0.5, rs * 0.32), (z_t1 + 0.55 * (z_top - z_t1), 0.9), (z_top - 4.0, 0.35), (z_top, 0.08)], (cx, cy), 12)
    # cable stays from under the turret down to the podium roof, twisted into a hyperboloid
    n, twist, r_top, r_bot, z_c = 36, math.radians(55), rs + 0.6, rs + 16.0, z_t0 - 12.0
    for k in range(n):
        a = 2 * math.pi * k / n
        top = (cx + r_top * math.cos(a), cy + r_top * math.sin(a), z_c)
        bot = (cx + r_bot * math.cos(a + twist), cy + r_bot * math.sin(a + twist), z_pod + 0.5)
        cables.tube([top, bot], 0.12, 4)
    return [shaft, turret, glazing, mast, cables]


# ---------------------------------------------------------------- Bennelong Point

def bennelong(ctx):
    """The ground round the Opera House as built, from the Overture release the city uses: the
    seawall along the shore of the precinct (polylines with the level of their top), the paving
    (polygons less the Opera House, the steps, the gardens and the buildings), the street
    furniture OpenStreetMap maps there, the regions where the terrain is not drawn (under the
    paving, and out in front of the seawall, where it would slope up out of the water), and the
    faces along the paving's other edges down or up to the ground beyond."""
    import duckdb
    from shapely import wkb as swkb
    C = ctx.city
    con = duckdb.connect()
    con.execute("LOAD spatial")
    area, prec = Polygon(SEAWALL_AREA), Polygon(PRECINCT)
    sea = shapely.union_all([p for p in ctx.sea if p.intersects(area.buffer(60))]).intersection(area.buffer(60))
    land = orient(max(ctx.polygons(area.difference(sea)), key=lambda q: q.area), 1.0)
    # the seawall: the land's edge where the water is just outside it, in runs of points under 2.5 m apart
    ring = np.asarray(land.exterior.segmentize(2.5).coords)
    walls, run = [], []
    for a, b in zip(ring, ring[1:]):
        e = b - a
        n = np.array([e[1], -e[0]]) / (np.linalg.norm(e) or 1)  # outward: the ring is anticlockwise
        m = (a + b) / 2
        if sea.contains(Point(*(m + n * 1.0))) and area.buffer(-1).contains(Point(*m)):
            run = run or [a]
            run.append(b)
        elif run:
            walls.append(run)
            run = []
    if run:
        walls.append(run)
    walls = [w for w in walls if len(w) > 2]
    line = shapely.MultiLineString([[tuple(p) for p in w] for w in walls])

    def behind(p, n, d=SEAWALL_SAG_M):  # the ground's level behind the sag towards the water
        return max(ctx.ground(*(p - n * d)), ctx.ground(*(p - n * (d + 3))))
    # what the paving covers: the precinct's land less the Opera House (its podium and steps draw
    # their own), the gardens and lawns, and the buildings that stay solids
    o = ctx.landmarks["opera_house"]
    st = o["steps"]
    sf, so = np.array(st["axis"]), np.array(st["origin"])
    sl = np.array([sf[1], -sf[0]])
    u0 = st["profile"][0][0]
    steps = Polygon([so + sf * u0 + sl * st["half_width"], so + sl * st["half_width"], so - sl * st["half_width"], so + sf * u0 - sl * st["half_width"]])
    opera = shapely.union_all([Polygon([r[:2] for r in rr["ring"]]) for rr in o["podium"]["rings"]] + [steps]).buffer(0.05)
    raw = lambda name: f"{C.raw}/overture_{name}.parquet"
    green = []
    for cl, sub, w in con.execute(f"SELECT class, subtype, wkb FROM '{raw('land_use')}'").fetchall():
        if cl in ("park", "garden", "grass", "meadow", "village_green", "recreation_ground", "botanical_garden"):
            green += ctx.polygons(C.to_local(swkb.loads(bytes(w))).intersection(area))
    for cl, sub, w in con.execute(f"SELECT class, subtype, wkb FROM '{raw('land')}'").fetchall():
        if sub in ("grass", "forest", "shrub") or cl in ("grass", "wood", "forest", "scrub"):
            green += ctx.polygons(C.to_local(swkb.loads(bytes(w))).intersection(area))
    solids = [Polygon(np.asarray(sd[4]).reshape(-1, 2) / 10) for sd in ctx.solids
              if prec.buffer(20).contains(Point(*(np.asarray(sd[4][:2]) / 10)))]
    cut = shapely.union_all([opera] + [g.buffer(0) for g in green] + [q.buffer(0.05) for q in solids if q.is_valid])
    deck = land.intersection(prec).difference(cut)
    deck = [orient(p.simplify(0.05), 1.0) for p in ctx.polygons(deck) if p.area > 6]
    near, forecourt = line.buffer(SEAWALL_SAG_M + 0.5), Polygon(FORECOURT)
    deck_u = shapely.union_all(deck)
    # the paving's other edges (the gardens, the road, the Tarpeian Wall): not the seawall, not the Opera House
    inner = deck_u.boundary.difference(line.buffer(0.3)).difference(opera.buffer(0.6))
    near_in = inner.buffer(EDGE_HOLD_M)

    def nearest(geom, x, y):
        q = np.asarray(shapely.ops.nearest_points(geom, Point(x, y))[0].coords[0])
        v = np.array([x, y]) - q
        return q, v, float(np.linalg.norm(v))

    # the forecourt's western balustrade over the Lower Concourse, and the retaining walls between it and the seawall
    fence, rwalls = concourse_lines(ctx, con, raw("infrastructure"), deck_u, line)
    plaza = fence.buffer(-LOWER["hold_m"], single_sided=True).intersection(deck_u) if fence is not None else Polygon()
    # the forecourt and the Upper Concourse along its balustrade, at the forecourt's level (FORECOURT_M)
    south = shapely.box(-1e4, FORECOURT[0][1], 1e4, UPPER_TO_Y)  # (from the forecourt's south edge: not Circular Quay East)
    upper = shapely.union_all([forecourt, plaza.intersection(south)]).buffer(0)
    steps_lines = []  # the flights OpenStreetMap maps (Overture segments of class steps) round the concourse
    for (w,) in con.execute(f"SELECT wkb FROM '{raw('segment')}' WHERE class = 'steps'").fetchall():
        g = C.to_local(swkb.loads(bytes(w)))
        if g.geom_type == "LineString" and fence is not None and g.distance(fence) < 25:
            steps_lines.append(g)

    holds = []  # [(polygon, level)]: paving held at a level (the top of the flight at the north end)

    def level_base(x, y):
        """The paving's level: the ground, held up to the level behind where the DEM sags towards
        the seawall, and down to the level in front where it climbs a garden's bank or a wall;
        and the forecourt's level out to its edge over the Lower Concourse, where the 5 m DEM
        slopes down into it."""
        z = ctx.ground(x, y)
        p = Point(x, y)
        for poly, zh in holds:
            if poly.contains(p):
                return zh
        if near.contains(p):
            q, v, L = nearest(line, x, y)
            if L > 1e-6:
                z = max(z, behind(np.array([x, y]), -v / L, max(SEAWALL_SAG_M - L, 0.0)))
        if near_in.contains(p) and deck_u.contains(p):
            q, v, L = nearest(inner, x, y)
            if L > 1e-6:
                z = min(z, ctx.ground(*(q + v / L * EDGE_HOLD_M)))
        if plaza.contains(p) and 0.5 < fence.project(p) < fence.length - 0.5:  # (not round its ends)
            q, v, L = nearest(fence, x, y)
            if L > 1e-6:
                z = max(z, ctx.ground(*(q + v / L * LOWER["hold_m"])), ctx.ground(*(q + v / L * (LOWER["hold_m"] + 3))))
        if upper.contains(p):
            return FORECOURT_M
        d = upper.distance(p)
        if d < UPPER_EASE_M and z < FORECOURT_M and deck_u.contains(p):  # easing to the DEM's level beyond
            t = 1.0 - d / UPPER_EASE_M
            z += (FORECOURT_M - z) * t * t * (3 - 2 * t)
        return z
    # the Lower Concourse on its own levels: the walkway along the seawall, the concourse below it,
    # the steps between them and up to the broadwalk (pieces of paving, each with its level)
    lc = lower_concourse(ctx, line, fence, rwalls, deck_u, level_base, steps_lines, holds) if fence is not None else None
    pieces_u = lc["union"] if lc else Polygon()
    others = deck_u.difference(pieces_u.buffer(0.01))

    def level(x, y):
        """The paving's level as drawn: on the Lower Concourse's pieces their own, elsewhere level_base."""
        if lc and pieces_u.contains(Point(x, y)):
            return piece_level(lc, x, y)
        return level_base(x, y)

    def level_rest(x, y):
        """The level the paving round the Lower Concourse's pieces is drawn at (a smooth grid),
        carried in under them from the nearest paving that is not a piece, so that a grid point in
        the concourse does not pull the forecourt's edge down towards it."""
        p = Point(x, y)
        if not (lc and pieces_u.contains(p)) or others.is_empty:
            return level_out(x, y)
        q, v, L = nearest(others, x, y)
        return level_base(*(q - v / (L or 1) * 0.4))

    def level_out(x, y):  # outside the paving: the level just inside its nearest edge
        p = Point(x, y)
        if deck_u.contains(p):
            return level(x, y)
        q, v, L = nearest(deck_u.boundary, x, y)
        q = q - v / (L or 1) * 0.4
        return level(*q)
    # the seawall's top: the paving's level in the precinct, elsewhere the ground behind the sag
    seawalls = []
    for w in walls:
        pts = []
        for k, p in enumerate(w):
            a, b = w[max(k - 1, 0)], w[min(k + 1, len(w) - 1)]
            e = np.asarray(b) - np.asarray(a)
            n = np.array([e[1], -e[0]]) / (np.linalg.norm(e) or 1)
            # (the paving's level just inland: on its edge, the Lower Concourse's pieces are not found)
            z = level_out(*(np.asarray(p) - n * 0.6)) if prec.contains(Point(*p)) else behind(np.asarray(p), n, 3.0)
            pts.append([round(float(p[0]), 2), round(float(p[1]), 2), round(max(z, 1.0), 2)])
        zs = np.array([q[2] for q in pts])
        zs = np.convolve(np.pad(zs, 2, mode="edge"), np.ones(5) / 5, mode="valid")  # a level coping, not every bump of the DEM
        for q, z in zip(pts, zs):
            q[2] = round(float(z), 2)
        seawalls.append(pts)
    # Where the terrain is not drawn (the viewer's ground shader discards it, web/world.js "clip"):
    # out from the seawall, where it would slope up out of the water between the last point on land
    # and the first in the water, and under the paving, which it would show through.
    rings = lambda p: {"ring": [[round(x, 1), round(y, 1)] for x, y in p.exterior.coords],
                       "holes": [[[round(x, 1), round(y, 1)] for x, y in h.coords] for h in p.interiors]}
    clip = [rings(p) for p in ctx.polygons(sea.intersection(line.buffer(CLIP_OUT_M)).simplify(0.2)) if p.area > 4]
    # and the bottom there, at the seawall's foot: without it the strip where the ground is not drawn
    # was open under the water, and the sky's colour showed through it as a pale band along the wall,
    # widest in the corner west of the walkway's round end (issue 84)
    seabed = list(clip)
    clip += [rings(p) for p in ctx.polygons(deck_u.buffer(-0.15).simplify(0.2)) if p.area > 4]
    # and under the Monumental Steps and their apron, where the DEM's bumps in the forecourt (the car
    # park's vent) came up through the apron as a pale strip of the aerial photo
    clip += [rings(p) for p in ctx.polygons(steps.buffer(-0.1).simplify(0.2)) if p.area > 4]
    # and along its other edges a face from the paving to the ground beyond, where they differ: the
    # Tarpeian Wall's sandstone below the garden, a kerb at the road
    skirts = []
    for ln in (inner.geoms if hasattr(inner, "geoms") else [inner]):
        if ln.length < 1.0:
            continue
        pts = []
        for d in np.arange(0, ln.length + 1e-6, 2.0):
            q = np.asarray(ln.interpolate(min(d, ln.length)).coords[0])
            _, v, L = nearest(deck_u, *(q + np.array([0.01, 0.0])))
            t = np.asarray(ln.interpolate(min(d + 0.5, ln.length)).coords[0]) - np.asarray(ln.interpolate(max(d - 0.5, 0)).coords[0])
            n = np.array([t[1], -t[0]]) / (np.linalg.norm(t) or 1)
            if deck_u.contains(Point(*(q + n * 0.5))):
                n = -n  # out of the paving
            zl = level_out(*q)
            out = [ctx.ground(*(q + n * k)) for k in (1.0, 3.0, 6.0)]
            top, back = max(zl, out[0] + 0.05), None
            if max(ctx.ground(*(q + n * k)) for k in CLIFF_BACK_M) - zl > CLIFF_M:
                # a cliff: up to the garden's level where its slope levels off, capped back to there
                K = next((k for k in CLIFF_BACK_M if ctx.ground(*(q + n * (k + 3))) - ctx.ground(*(q + n * k)) < 0.6), CLIFF_BACK_M[-1])
                bq = q + n * K
                top, back = max(top, ctx.ground(*bq)), [round(float(bq[0]), 2), round(float(bq[1]), 2), round(ctx.ground(*bq) - 0.05, 2)]
            pts.append([round(float(q[0]), 2), round(float(q[1]), 2), round(min(zl, out[0]) - 0.3, 2), round(top, 2)] + (back or []))
        # the cliff's top evened out along it, as a quarried face runs
        tops = np.array([p[3] for p in pts])
        if len(tops) > 4:
            sm = np.convolve(np.pad(tops, 2, mode="edge"), np.ones(5) / 5, mode="valid")
            for p, t in zip(pts, sm):
                if len(p) > 4:
                    p[3] = round(float(max(t, p[6] + 0.05)), 2)
        skirts.append(pts)
    # the street furniture OpenStreetMap maps there (Overture infrastructure), standing on the paving
    paved = shapely.union_all(deck).buffer(0.5)
    props = {}
    for sub, cl, w in con.execute(f"SELECT subtype, class, wkb FROM '{raw('infrastructure')}'").fetchall():
        kind = STREET_FURNITURE.get((sub, cl))
        g = C.to_local(swkb.loads(bytes(w))) if kind else None
        if g is None or g.geom_type != "Point" or not area.contains(g):
            continue
        if kind in ("pylon", "bench", "bollard") and (opera.contains(g) or not paved.buffer(25).contains(g)):
            continue  # inside the building, or out in the garden
        x, y = g.x, g.y
        d = line.project(g)
        q = np.asarray(line.interpolate(d).coords[0])
        heading = math.atan2(q[1] - y, q[0] - x)  # facing the nearest water
        z = level_out(x, y) if paved.contains(g) else ctx.ground(x, y)
        if sea.contains(g):
            z = PIER_DECK_M  # on a pier
        if kind == "floodlight":  # its lamps face the shells
            heading = math.atan2(o["centroid"][1] - y, o["centroid"][0] - x)
        props.setdefault(kind, []).append([round(x, 2), round(y, 2), round(z, 2), round(heading, 3)])
    parts = []
    for part in ctx.landmarks.pop("precinct_parts", []):
        c = Polygon(part["ring"]).centroid
        part["z"] = round(level_out(c.x, c.y), 2)
        parts.append(part)
    # the paving's level on the DEM's 5 m grid over the paving, in centimetres (landmark_meshes drapes on it)
    bx0, by0, bx1, by1 = shapely.union_all(deck).bounds
    gx0, gy0 = math.floor(bx0 / 5) * 5 - 5, math.floor(by0 / 5) * 5 - 5
    nx, ny = int((bx1 - gx0) // 5) + 3, int((by1 - gy0) // 5) + 3
    grid = np.array([[level_rest(gx0 + i * 5, gy0 + j * 5) for i in range(nx)] for j in range(ny)])
    # the DEM's pits and spikes in the forecourt (the vehicle concourse and the loading dock's ramp
    # run in under it, the car park's vent stands on it), levelled to the paving round them
    from scipy import ndimage
    for _ in range(3):
        med = ndimage.median_filter(grid, size=5, mode="nearest")
        grid = np.where(np.abs(grid - med) > 0.6, med, grid)
    import base64
    lv = {"x0": gx0, "y0": gy0, "cell": 5, "nx": nx, "ny": ny, "encoding": "int16le-base64 cm, rows from y0 north",
          "data": base64.b64encode(np.round(grid * 100).astype("<i2").tobytes()).decode()}
    # the paving draped on the grid: all but the Lower Concourse's pieces, which are drawn on their own levels
    drape = [q for p in deck for q in ctx.polygons(p.difference(pieces_u)) if q.area > 0.5] if lc else deck
    deck_out = [{"ring": [[round(x, 2), round(y, 2)] for x, y in p.exterior.coords],
                 "holes": [[[round(x, 2), round(y, 2)] for x, y in h.coords] for h in p.interiors]} for p in drape]
    print(f"Bennelong Point: {len(walls)} seawall runs, {line.length:.0f} m; paving {sum(p.area for p in deck):.0f} m2 in {len(deck)} pieces; "
          f"{ {k: len(v) for k, v in props.items()} }; {len(parts)} furniture parts; {len(clip)} clip regions; "
          f"paving {grid[grid > -50].min():.1f} to {grid.max():.1f} m")
    print(f"  the Tarpeian Wall: a cliff along {sum(1 for sk in skirts for p in sk if len(p) > 4) * 2} m of the paving's edge")
    out = {"seawalls": seawalls, "skirts": skirts, "deck": deck_out, "level": lv, "clip": clip, "seabed": seabed, "props": props, "parts": parts,
           "axis": o["steps"]["axis"], "origin": o["steps"]["origin"]}
    if lc:
        out["lower"] = concourse_out(lc, level_base)
        lv2 = dict(lv)  # (level_at caches the decoded grid in the dict it is given)
        out["patch"] = walk_patch(lc, deck_u, lambda x, y: level_at(lv2, x, y), out["lower"])
    return out



def concourse_lines(ctx, con, path, deck_u, line):
    """The forecourt's balustrade over the Lower Concourse (oriented with the forecourt on its
    right) and the retaining walls between it and the seawall, from Overture's infrastructure."""
    from shapely import wkb as swkb
    fences, rwalls = [], []
    for cl, w in con.execute(f"SELECT class, wkb FROM '{path}' WHERE class IN ('fence', 'retaining_wall')").fetchall():
        g = ctx.city.to_local(swkb.loads(bytes(w)))
        if g.geom_type == "LineString" and g.distance(line) < 30 and deck_u.buffer(5).intersects(g):
            (fences if cl == "fence" else rwalls).append(g)
    at = Point(*LOWER["fence_near"])
    fence = min(fences, key=lambda g: g.distance(at), default=None)
    if fence is None or fence.distance(at) > 5:
        return None, []
    a, b = (np.asarray(fence.interpolate(t, normalized=True).coords[0]) for t in (0.49, 0.51))
    right = np.array([b[1] - a[1], a[0] - b[0]]) / np.linalg.norm(b - a)
    if line.distance(Point(*((a + b) / 2 + right * 3))) < line.distance(Point(*((a + b) / 2))):
        fence = shapely.LineString(list(fence.coords)[::-1])
    rwalls = [g for g in rwalls if g.distance(fence) < 15 and g.distance(line) < 15]
    return fence, rwalls


def lower_concourse(ctx, line, F, rwalls, deck_u, level_base, steps=(), holds=None):
    """The Lower Concourse as pieces of paving on their own levels (LOWER): the walkway along the
    seawall, down to the concourse at its retaining walls, or by broad steps where none is mapped;
    the ramp down to it from Circular Quay; the concourse, out to the forecourt's balustrade; the
    flight at its north end up to the Northern Broadwalk (north_flight()); and the stairwell down
    from the forecourt (stairwell()). Each piece is flat or a profile along the seawall (s, metres
    along it). Also the parapets along the tops of the retaining walls."""
    L = LOWER
    R = max(line.geoms, key=lambda r: sum(r.distance(Point(c)) < 25 for c in F.coords))
    if R.project(Point(F.coords[-1])) < R.project(Point(F.coords[0])):
        R = shapely.LineString(list(R.coords)[::-1])  # s runs with the balustrade, from Circular Quay to the north end
    mid = np.asarray(R.interpolate(0.5, normalized=True).coords[0])
    t0 = np.asarray(R.interpolate(R.project(Point(*mid)) + 1).coords[0]) - mid
    side = 1.0 if deck_u.contains(Point(*(mid + np.array([-t0[1], t0[0]]) / np.linalg.norm(t0) * 2))) else -1.0

    def frame(s):  # the seawall's point at s and the normal in over the land
        s = min(max(s, 0.0), R.length)
        a, b = (np.asarray(R.interpolate(min(max(q, 0.0), R.length)).coords[0]) for q in (s - 1.5, s + 1.5))
        t = (b - a) / (np.linalg.norm(b - a) or 1)
        return np.asarray(R.interpolate(s).coords[0]), np.array([-t[1], t[0]]) * side
    # the retaining walls: how far in from the seawall each stands, along it (short returns at their
    # ends left out); where two overlap, the one nearer the seawall is the walkway's edge
    per, cover = [], []
    for g in rwalls:
        c = [np.asarray(q) for q in g.coords]
        while len(c) > 2 and np.linalg.norm(c[1] - c[0]) < 2.5:
            c = c[1:]
        while len(c) > 2 and np.linalg.norm(c[-1] - c[-2]) < 2.5:
            c = c[:-1]
        dense = shapely.LineString(c).segmentize(0.5)
        sd = sorted((R.project(Point(q)), R.distance(Point(q))) for q in dense.coords)
        per.append((np.array([a for a, _ in sd]), np.array([b for _, b in sd])))
        cover.append((sd[0][0], sd[-1][0]))
    if not per:
        return None
    cover.sort()
    grid_s = np.arange(cover[0][0], max(b for _, b in cover) + 0.5, 0.5)
    best = np.full(len(grid_s), np.nan)
    for ss, dd in per:
        on = (grid_s >= ss[0]) & (grid_s <= ss[-1])
        d = np.interp(grid_s[on], ss, dd)
        best[on] = np.where(np.isnan(best[on]), d, np.minimum(best[on], d))
    ok = ~np.isnan(best)
    S_w, D_w = grid_s[ok], best[ok]
    width = lambda s: float(np.interp(s, S_w, D_w))
    s_a, s_r1 = cover[0][0], cover[0][1]  # the first wall: the ramp comes down beside it
    s_b = R.project(Point(F.coords[-1]))

    def F_at(s):  # where the normal in from the seawall at s meets the balustrade
        p, n = frame(s)
        hit = shapely.LineString([p + n * 0.3, p + n * 45]).intersection(F)
        pts = [np.asarray(q.coords[0]) for q in getattr(hit, "geoms", [hit]) if not q.is_empty and q.geom_type == "Point"]
        return min(pts, key=lambda q: np.linalg.norm(q - p)) if pts else None
    W = lambda s: frame(s)[0] + frame(s)[1] * width(s)
    walk, floor, riser, tread = L["walk_m"], L["floor_m"], L["riser_m"], L["tread_m"]
    z_south = level_base(*(frame(s_a)[0] + frame(s_a)[1] * 1.5))
    # sample along the seawall every metre, up to the balustrade's last corner, and as far as the
    # concourse is wide enough to walk (it narrows between the last retaining wall and the balustrade)
    d_end = F.project(Point(F.coords[-2])) if len(F.coords) > 2 else F.length
    S = list(np.arange(s_a, s_b, 1.0)) + [s_b]
    Fp = {s: F_at(s) for s in S}
    S = [s for s in S if Fp[s] is not None and F.project(Point(*Fp[s])) <= d_end + 0.05]
    if len(S) < 10:
        return None
    Wp = {s: W(s) for s in S}
    wide = [s for s in S if np.linalg.norm(Fp[s] - Wp[s]) >= 1.8]
    s_end = wide[-1] if wide else S[-1]
    S = [s for s in S if s <= s_end]
    floor_prof = [[s_a, z_south], [s_r1, floor], [s_end, floor]]
    zc = lambda s: float(np.interp(s, *zip(*floor_prof)))
    walk_prof = [[s_a, z_south], [s_a + 12, walk], [s_end, walk]]
    zw = lambda s: float(np.interp(s, *zip(*walk_prof)))
    S_walk = list(np.arange(s_a, s_end, 1.0)) + [s_end]
    ring = lambda a, b: Polygon([tuple(q) for q in list(a) + list(b)[::-1]]).buffer(0)
    walkway = ring([frame(s)[0] for s in S_walk], [W(s) for s in S_walk]).intersection(deck_u)
    band = ring([Wp[s] for s in S], [Fp[s] for s in S]).intersection(deck_u).difference(walkway)
    # where no retaining wall is mapped, broad steps down from the walkway (7 risers between its level and the concourse's)
    n_t = max(1, round((walk - floor) / riser))
    gaps, prev = [], s_r1
    for a, b in cover[1:] + [(s_end, s_end)]:
        if a - prev > 2.0:
            gaps.append((prev + 0.3, min(a, s_end) - 0.3))
        prev = max(prev, b)
    off = lambda s, d: Wp[s] + frame(s)[1] * d
    pieces, treads = [], []
    for g0, g1 in gaps:
        Sg = [s for s in S if g0 <= s <= g1]
        if len(Sg) < 2:
            continue
        for k in range(n_t - 1):
            q = ring([off(s, k * tread) for s in Sg], [off(s, (k + 1) * tread) for s in Sg]).intersection(band)
            if q.area > 0.3:
                treads.append(q)
                pieces.append({"poly": q, "z": round(walk - (k + 1) * (walk - floor) / n_t, 3), "kind": "tread"})
    # the flight at the north end, from the walkway's end up east to the Northern Broadwalk
    flight, n_up, r_up, z_top, north_route = north_flight(L, steps, deck_u, walk, level_base, R, holds, F)
    for k, (q, z) in enumerate(flight):
        pieces.append({"poly": q, "z": z, "kind": "flight"})
    fl = shapely.union_all([q for q, _ in flight]) if flight else Polygon()
    ends = list(holds[-2:]) if flight and holds else []  # the landing at its top and the walkway's round end at its foot
    # the stairwell from the forecourt down to the concourse, and the passage at its foot
    well = stairwell(L["well"], steps, F, floor)
    if well:
        for q, z, kind in well["pieces"]:
            pieces.append({"poly": q, "z": z, "kind": kind})
    conc = band.difference(shapely.union_all(treads + [fl]))
    walkway = walkway.difference(fl)
    # what the pieces leave between them (slivers along their shared edges) goes to the concourse
    rest = shapely.union_all([walkway, band]).difference(shapely.union_all([walkway, conc, fl] + treads))
    conc = shapely.union_all([conc] + [q for q in Polygon_pieces(rest) if q.area > 1e-4]).buffer(0)
    pieces = [{"poly": walkway, "s": walk_prof, "kind": "walkway"}, {"poly": conc, "s": floor_prof, "kind": "concourse"}] + pieces
    # those two on their own levels too (the paving's 5 m grid would slope between them)
    for poly, z in ends:
        q = poly.difference(shapely.union_all([p["poly"] for p in pieces]).buffer(0.01)).buffer(0)
        q = shapely.union_all([g for g in Polygon_pieces(q) if g.area > 1.0])
        if not q.is_empty:
            pieces.append({"poly": q, "z": round(z, 3), "kind": "landing"})
    # along the walkway's inner edge: a retaining wall down to the concourse (or the steps' top riser)
    in_gap = lambda s: any(g0 <= s <= g1 for g0, g1 in gaps)
    parapets, run = [], []
    for s0, s1 in zip(S, S[1:]):
        sm = (s0 + s1) / 2
        lo = (walk - (walk - floor) / n_t) if in_gap(sm) else zc(sm)
        top = zw(sm)
        if top - lo > 0.6 and not fl.buffer(0.6).contains(Point(*Wp[s0])):  # a parapet on the walkway along its top
            run.append([*(Wp[s0] - frame(s0)[1] * 0.2), top])
        elif run:
            parapets.append(run)
            run = []
    if run:
        parapets.append(run)
    print(f"  the Lower Concourse: walkway {walkway.area:.0f} m2 at {walk} m, concourse {conc.area:.0f} m2 at {floor} m "
          f"(the ramp down to it {s_r1 - s_a:.0f} m), {len(treads)} treads of broad steps in {len(gaps)} places, "
          f"a flight of {n_up} risers of {r_up * 100:.1f} cm up to the Northern Broadwalk at {z_top:.2f} m"
          + (f", a stairwell of {len(well['treads']) + 1} risers of {well['riser'] * 100:.1f} cm down from the forecourt" if well else ", no stairwell"))
    # walks for the game's check: up the flight at the north end; and at the seawall, along the walkway
    walks = []
    if north_route:
        walks.append({"name": "up the flight at the Lower Concourse's north end to the Northern Broadwalk",
                      "path": [[round(float(v), 2) for v in q] for q in north_route], "from_m": walk, "to_m": round(z_top, 2)})
    sm = (s_a + s_end) / 2
    p, nn = frame(sm)
    walks.append({"name": "across the walkway to the seawall, stopping at its edge", "face": True,
                  "path": [[round(float(v), 2) for v in q] for q in (p + nn * 4.0, p - nn * 1.5)], "from_m": walk, "to_m": walk})
    return {"ref": R, "pieces": pieces, "parapets": parapets, "fence": F, "well": well, "floor_prof": floor_prof, "walks": walks,
            "union": shapely.union_all([p["poly"] for p in pieces]).buffer(0)}


def north_flight(L, steps, deck_u, walk, level_base, R, holds=None, F=None):
    """The flight at the Lower Concourse's north end: the two ways of 13 steps OpenStreetMap maps
    near L["north_near"] are its two lanes; it climbs from the walkway's end up to the broadwalk, 13 treads of L["north_tread_m"], as wide as the two lanes
    and a metre beyond each, up to the broadwalk's level 8 m beyond its top (the 5 m DEM sags towards
    the concourse nearer), at which the paving at its top is held (holds). Returns ([(tread polygon,
    level)], risers, riser, level at its top)."""
    at = Point(*L["north_near"])
    ways = sorted((g for g in steps if g.distance(at) < 6.0 and 2.0 < g.length < 9.0), key=lambda g: -g.length)[:2]
    n = L["up_risers"]
    if not ways:
        return [], n, 0.0, walk, None
    g = ways[0]
    a0, a1 = (np.asarray(g.coords[0]), np.asarray(g.coords[-1]))
    if level_base(*a0) > level_base(*a1):
        a0, a1 = a1, a0
    ax = (a1 - a0) / np.linalg.norm(a1 - a0)  # up the flight: its foot is the end where the ground is lower
    cx = np.array([-ax[1], ax[0]])
    uv = lambda q: ((np.asarray(q) - a0) @ ax, (np.asarray(q) - a0) @ cx)
    ends = [uv(q) for w in ways for q in (w.coords[0], w.coords[-1])]
    low_u = [min(uv(w.coords[0])[0], uv(w.coords[-1])[0]) for w in ways]
    u0 = min(low_u) - 0.6
    v0, v1 = min(v for _, v in ends) - 1.0, max(v for _, v in ends) + 1.0
    t = L["north_tread_m"]
    u1 = u0 + n * t
    P = lambda u, v: a0 + ax * u + cx * v
    z_top = level_base(*P(u1 + 8.0, (v0 + v1) / 2))
    r = (z_top - walk) / n
    vm = max((v0 + 1.5, v1 - 1.5), key=lambda v: F.distance(Point(*P(u1, v))) if F is not None else 0.0)  # (the lane away from the balustrade)
    route = [P(u0 - 2.0, vm), P(u1 + 2.5, vm)]
    if holds is not None:
        box_ = lambda ua, ub, va, vb: Polygon([P(ua, va), P(ub, va), P(ub, vb), P(ua, vb)])
        holds.append((box_(u1 - 0.05, u1 + 6.0, v0 - 2.0, v1 + 2.0).intersection(deck_u), z_top))
        # and the walkway's round end at its foot and beside it, on the walkway's level, as photographed
        holds.append((shapely.union_all([box_(u0 - 8.0, u0 + 0.05, v0 - 6.0, v1 + 8.0), box_(u0, u1, v1 - 0.05, v1 + 6.0)]).intersection(deck_u), walk))
    out = []
    keep = deck_u.difference(F.buffer(-40, single_sided=True).buffer(0.15)) if F is not None else deck_u  # not past the balustrade
    for k in range(n):
        q = Polygon([P(u0 + k * t, v0), P(u0 + (k + 1) * t, v0), P(u0 + (k + 1) * t, v1), P(u0 + k * t, v1)]).intersection(keep)
        q = max(Polygon_pieces(q), key=lambda g: g.area) if Polygon_pieces(q) else Polygon()
        if q.area > 0.05:
            out.append((q, round(walk + (k + 1) * r, 3)))
    return out, n, r, z_top, route


def stairwell(W, steps, F, floor):
    """The stairwell from the forecourt down to the Lower Concourse (LOWER["well"]): on the
    OpenStreetMap way near W["near"], u from its upper end down it, v across to the east. The
    opening in the forecourt (open_u by open_v); the top landing at the forecourt's level; the
    flight down it (stair_v, the opening's width), W["risers"] treads from top_u to foot_u; the
    landing at its foot, at the concourse's level, the landing carried on under the
    forecourt to land_u; and from the landing a passage west under the forecourt to the
    balustrade (passage_v), through the colonnade. Returns the pieces drawn in the opening
    [(polygon, level, kind)], and the parts under the forecourt."""
    at = Point(*W["near"])
    cand = [g for g in steps if g.distance(at) < 4.0 and g.length > 6.0]
    if not cand:
        return None
    g = min(cand, key=lambda q: q.distance(at))
    a, b = np.asarray(g.coords[0]), np.asarray(g.coords[-1])
    if b[1] > a[1]:  # the way goes down to the south (OpenStreetMap: incline down from its north end)
        a, b = b, a
    d = (b - a) / np.linalg.norm(b - a)
    c = np.array([-d[1], d[0]])  # across, to the east of a way going south
    if c[0] < 0:
        c = -c
    P = lambda u, v: tuple(a + d * u + c * v)
    rect = lambda u0, u1, v0, v1: Polygon([P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)])
    (ou0, ou1), (ov0, ov1), (sv0, sv1) = W["open_u"], W["open_v"], W["stair_v"]
    n, tu, fu = W["risers"], W["top_u"], W["foot_u"]
    t = (fu - tu) / (n - 1)  # the last riser at the foot
    top = FORECOURT_M
    rz = (top - floor) / n
    pieces, treads = [], []
    pieces.append((rect(ou0, tu, sv0, sv1), top, "well_landing"))
    for k in range(n - 1):
        q = rect(tu + k * t, tu + (k + 1) * t, sv0, sv1)
        treads.append(q)
        pieces.append((q, round(top - (k + 1) * rz, 3), "well_tread"))
    opening = rect(ou0, ou1, ov0, ov1)
    floor_in = opening.difference(shapely.union_all([p for p, _, _ in pieces])).buffer(0)
    pieces.append((floor_in, floor, "well_floor"))
    # under the forecourt: the landing carried on beyond the opening, and the passage west to the balustrade
    landing = rect(fu, W["land_u"], ov0, sv1).difference(opening)
    passage = rect(fu, W["land_u"], W["passage_v"], ov0 + 0.01)
    side = F.buffer(-40, single_sided=True)  # the forecourt's side of the balustrade
    passage = passage.intersection(side.buffer(0.3))
    return {"pieces": pieces, "treads": treads, "riser": rz, "opening": opening, "under": shapely.union_all([landing, passage]).buffer(0),
            "passage": passage, "rail": shapely.LineString([P(ou0, sv0), P(ou0, ov0), P(ou1, ov0), P(ou1, ov1), P(ou0, ov1)]),
            "u": [round(v, 4) for v in d], "a": [round(v, 2) for v in a],
            "route": [P(ou0 - 2.5, (sv0 + sv1) / 2), P(tu, (sv0 + sv1) / 2), P(fu + 1.2, (sv0 + sv1) / 2), P(fu + 1.4, ov0 - 1.0)]}


def piece_level(lc, x, y):
    """The level of the Lower Concourse's piece at (x, y) (lower_concourse(), or its dump from
    concourse_out(), whose pieces carry `poly` once prepared)."""
    p = Point(x, y)
    best, bd = None, 1e9
    for pc in lc["pieces"]:
        poly = pc["poly"]
        d = 0.0 if poly.contains(p) else poly.distance(p)
        if d < bd:
            best, bd = pc, d
            if d == 0.0:
                break
    if best is None:
        return 0.0
    if "z" in best:
        return best["z"]
    s = lc["ref"].project(p)
    return float(np.interp(s, *zip(*best["s"])))


def concourse_out(lc, level_base):
    """The Lower Concourse for scene.json: the reference line, the pieces, the parapets, the
    forecourt's edge over the concourse along its balustrade, every metre: [x, y, ex, ey (in under
    the forecourt), floor, forecourt]; what lies under the forecourt at the concourse's level (the
    colonnade, where the forecourt stands a storey above, and the stairwell's passage and landing);
    the stairwell; and walks for the game's check."""
    F = lc["fence"]
    edge = []
    for d in np.arange(0.0, F.length + 1e-6, 1.0):
        q = np.asarray(F.interpolate(d).coords[0])
        a, b = (np.asarray(F.interpolate(min(max(t, 0.0), F.length)).coords[0]) for t in (d - 0.5, d + 0.5))
        t = (b - a) / (np.linalg.norm(b - a) or 1)
        e = np.array([t[1], -t[0]])  # to its right: the forecourt
        edge.append([round(float(q[0]), 2), round(float(q[1]), 2), round(float(e[0]), 3), round(float(e[1]), 3),
                     round(piece_level(lc, *(q - e * 0.3)) if lc["union"].distance(Point(*(q - e * 0.3))) < 0.2 else level_base(*(q - e * 0.3)), 2),
                     round(level_base(*(q + e * 0.6)), 2)])
    r2 = lambda q: [round(float(q[0]), 2), round(float(q[1]), 2)]
    rings = lambda p: [{"ring": [r2(c) for c in g.exterior.coords], "holes": [[r2(c) for c in h.coords] for h in g.interiors]}
                       for g in Polygon_pieces(p) if g.area > 0.05]
    pieces = []
    for pc in lc["pieces"]:
        for r in rings(pc["poly"]):
            pieces.append(dict(r, kind=pc["kind"], **({"z": pc["z"]} if "z" in pc else {"s": [[round(a, 2), round(b, 3)] for a, b in pc["s"]]})))
    # under the forecourt at the concourse's level: the colonnade, between its columns and its shopfronts
    zone = []
    for e0, e1 in zip(edge, edge[1:]):
        if storey_over(e0) and storey_over(e1):
            q0, q1, n0, n1 = (np.array(v) for v in (e0[:2], e1[:2], e0[2:4], e1[2:4]))
            zone.append(Polygon([q0 - n0 * 0.05, q1 - n1 * 0.05, q1 + n1 * LOWER["recess_m"], q0 + n0 * LOWER["recess_m"]]).buffer(0.02))
    under = []
    if zone:
        for r in rings(shapely.union_all(zone).buffer(0).difference(lc["union"])):
            under.append(dict(r, kind="colonnade", s=[[round(a, 2), round(b, 3)] for a, b in lc["floor_prof"]]))
    out = {"ref": [r2(c) for c in lc["ref"].coords], "pieces": pieces,
           "parapets": [[[round(float(v), 2) for v in q] for q in run] for run in lc["parapets"]], "edge": edge}
    w = lc.get("well")
    if w:
        for r in rings(w["under"].difference(shapely.union_all(zone) if zone else Polygon())):
            under.append(dict(r, kind="passage", z=LOWER["floor_m"]))
        out["well"] = {"opening": [r2(c) for c in w["opening"].exterior.coords], "passage": [r2(c) for c in w["passage"].exterior.coords],
                       "rail": [r2(c) for c in w["rail"].coords], "top_m": FORECOURT_M, "floor_m": LOWER["floor_m"],
                       "risers": len(w["treads"]) + 1, "riser_m": round(w["riser"], 4)}
        out["walks"] = [{"name": "down the stairwell from the forecourt to the Lower Concourse",
                         "path": [r2(q) for q in w["route"]], "from_m": FORECOURT_M, "to_m": LOWER["floor_m"]}]
        out["walks"].append({"name": "back up the stairwell to the forecourt",
                             "path": [r2(q) for q in w["route"][::-1]], "from_m": LOWER["floor_m"], "to_m": FORECOURT_M})
    out["walks"] = out.get("walks", []) + lc.get("walks", [])
    # and into the colonnade from the concourse, and along the forecourt over it
    mids = [k for k in range(2, len(edge) - 2) if all(storey_over(edge[j]) for j in range(k - 8, k + 9) if 0 <= j < len(edge))]
    if mids:
        k = mids[len(mids) // 2]
        q, n_ = np.array(edge[k][:2]), np.array(edge[k][2:4])
        t_ = np.array([-n_[1], n_[0]])
        out["walks"].append({"name": "from the concourse in under the colonnade", "path": [r2(q - n_ * 3.0), r2(q + n_ * 3.2)],
                             "from_m": edge[k][4], "to_m": edge[k][4]})
        out["walks"].append({"name": "along the forecourt over the colonnade", "path": [r2(q + n_ * 2.5 - t_ * 5.0), r2(q + n_ * 2.5 + t_ * 5.0)],
                             "from_m": edge[k][5], "to_m": edge[k][5]})
    out["under"] = under
    return out


def storey_over(e):
    """Is the forecourt's edge sample e (concourse_out()'s) a storey over the concourse, with room for
    the colonnade under its slab?"""
    return e[5] - e[4] - LOWER["slab_m"] > 2.2


def colonnade_columns(E):
    """The colonnade's mushroom columns: [x, y, floor, soffit] every LOWER["column_every_m"] along the
    forecourt's edge (concourse_out()'s), just in from its fascia, where it runs on for a few metres."""
    out, run, next_col = [], 0.0, 4.0
    for k in range(len(E) - 1):
        e0, e1 = E[k], E[k + 1]
        q0, q1, n0, n1 = (np.array(v, float) for v in (e0[:2], e1[:2], e0[2:4], e1[2:4]))
        L1 = float(np.linalg.norm(q1 - q0))
        if storey_over(e0) and storey_over(e1):
            deep = all(storey_over(E[j]) for j in range(max(k - 2, 0), min(k + 4, len(E))))
            while deep and next_col <= run + L1:
                t = (next_col - run) / max(L1, 1e-6)
                c = q0 + (q1 - q0) * t + (n0 + (n1 - n0) * t) * LOWER["column_in_m"]
                out.append([float(c[0]), float(c[1]), e0[4] + (e1[4] - e0[4]) * t, e0[5] - LOWER["slab_m"] + (e1[5] - e0[5]) * t])
                next_col += LOWER["column_every_m"]
            if not deep:
                next_col = max(next_col, run + L1 + 2.0)
        else:
            next_col = run + L1 + 4.0
        run += L1
    return out


def lower_loaded(lower):
    """concourse_out()'s dump with its shapes rebuilt, for piece_level()."""
    if "_ref" not in lower:
        lower["_ref"] = shapely.LineString(lower["ref"])
        lower["_pieces"] = [dict(pc, poly=Polygon(pc["ring"], pc["holes"]).buffer(0)) for pc in lower["pieces"]]
        lower["_under"] = [dict(pc, poly=Polygon(pc["ring"], pc["holes"]).buffer(0)) for pc in lower.get("under", [])]
    return {"ref": lower["_ref"], "pieces": lower["_pieces"], "under": lower["_under"]}


def walk_patch(lc, deck_u, rest, L):
    """The levels the game walks on over the Lower Concourse and round it, every half metre, in
    centimetres (-32768 where there is no paving): sharp at its walls and steps, which the 5 m
    walking grid would smooth into slopes, and up to the tops of the parapets along the walkway,
    the forecourt's edge and the stairwell, which hold a walker back. Where the forecourt stands
    over the concourse (the colonnade, the stairwell's passage) the walk is on two floors: `data`
    the concourse's, `upper` the forecourt's (a block of the grid from column i0, row j0; -32768
    elsewhere). web/game/nav.js takes it over the grid. `walks`: routes the game's check walks
    (tools/game_check.js)."""
    import base64
    from shapely import contains_xy
    x0, y0, x1, y1 = lc["union"].buffer(6).bounds
    cell = 0.5
    x0, y0 = math.floor(x0), math.floor(y0)
    nx, ny = int((x1 - x0) / cell) + 1, int((y1 - y0) / cell) + 1
    gx, gy = np.meshgrid(x0 + (np.arange(nx) + 0.5) * cell, y0 + (np.arange(ny) + 0.5) * cell)
    z = np.full(gx.shape, np.nan)
    paved = contains_xy(deck_u.buffer(0.6), gx, gy)  # (out over the seawall's coping: the walker stops at its face, web/quays.js)
    for j, i in zip(*np.nonzero(paved)):
        z[j, i] = rest(gx[j, i], gy[j, i])
    ref = shapely.LineString(L["ref"])

    def fill(arr, pc, mask=None):
        poly = Polygon(pc["ring"], pc["holes"]).buffer(0)
        inside = contains_xy(poly, gx, gy) & (mask if mask is not None else True)
        if "z" in pc:
            arr[inside] = pc["z"]
        else:
            s = shapely.line_locate_point(ref, shapely.points(gx[inside], gy[inside]))
            arr[inside] = np.interp(s, *zip(*pc["s"]))
        return inside
    for pc in L["pieces"]:
        fill(z, pc)
    # under the forecourt: the concourse's level below, the forecourt's above
    up = np.full(gx.shape, np.nan)
    two = np.zeros(gx.shape, bool)
    for pc in L.get("under", []):
        low = np.full(gx.shape, np.nan)
        inside = fill(low, pc)
        up[inside] = z[inside]
        z[inside] = low[inside]
        two |= inside
    # what holds a walker back: on the floor below where there are two, else the one floor
    def raise_(mask, h):
        lo = mask & ~two
        z[lo] = np.fmax(z[lo], h if np.isscalar(h) else h[lo])
        hi = mask & two
        up[hi] = np.fmax(up[hi], h if np.isscalar(h) else h[hi])
    # the parapets: along the walkway's inner edge, and the forecourt's along its balustrade
    for runp in L["parapets"]:
        for a, b in zip(runp, runp[1:]):
            g = shapely.LineString([a[:2], b[:2]]).buffer(0.4)
            on = contains_xy(g, gx, gy)
            z[on] = np.fmax(z[on], max(a[2], b[2]) + LOWER["wall_parapet_m"])
    for e0, e1 in zip(L["edge"], L["edge"][1:]):
        if abs(e0[5] - e0[4]) < 0.25:
            continue
        g = Polygon([e0[:2], e1[:2], [e1[0] + e1[2] * 0.5, e1[1] + e1[3] * 0.5], [e0[0] + e0[2] * 0.5, e0[1] + e0[3] * 0.5]]).buffer(0.2)  # (two cells: no gap on a diagonal)
        raise_(contains_xy(g, gx, gy), max(e0[5], e1[5]) + LOWER["parapet_m"])
    # the colonnade's columns, and the stairwell's balustrade round the opening on the forecourt
    for x, y, zf, zs in colonnade_columns(L["edge"]):
        on = contains_xy(Point(x, y).buffer(0.45), gx, gy)
        z[on] = np.fmax(z[on], zs)
    w = L.get("well")
    if w:
        g = shapely.LineString(w["rail"]).buffer(0.5).difference(Polygon(w["opening"]))
        raise_(contains_xy(g, gx, gy), w["top_m"] + LOWER["well"]["rail_m"])
    enc = lambda a: base64.b64encode(np.where(np.isnan(a), -32768, np.round(a * 100)).astype("<i2").tobytes()).decode()
    out = {"x0": x0, "y0": y0, "cell": cell, "nx": nx, "ny": ny, "encoding": "int16le-base64 cm, rows from y0 north, -32768 none",
           "data": enc(z)}
    if two.any():  # within its own bounds: i0, j0 the first column and row
        J, I = np.nonzero(two)
        j0, j1, i0, i1 = int(J.min()), int(J.max()) + 1, int(I.min()), int(I.max()) + 1
        out["upper"] = {"i0": i0, "j0": j0, "nx": i1 - i0, "ny": j1 - j0, "data": enc(np.where(two, up, np.nan)[j0:j1, i0:i1])}
        out["clear_m"] = round(FORECOURT_M - LOWER["slab_m"] - LOWER["floor_m"], 2)  # under the slab, over the floor
    if L.get("walks"):
        out["walks"] = L["walks"]
    return out




def level_at(lv, x, y):
    """The paving's level from bennelong()'s grid, bilinear."""
    import base64
    if "_z" not in lv:
        lv["_z"] = np.frombuffer(base64.b64decode(lv["data"]), "<i2").reshape(lv["ny"], lv["nx"]) / 100.0
    z, c = lv["_z"], lv["cell"]
    fx, fy = (x - lv["x0"]) / c, (y - lv["y0"]) / c
    i, j = min(max(int(fx), 0), lv["nx"] - 2), min(max(int(fy), 0), lv["ny"] - 2)
    tx, ty = min(max(fx - i, 0.0), 1.0), min(max(fy - j, 0.0), 1.0)
    return float((z[j, i] * (1 - tx) + z[j, i + 1] * tx) * (1 - ty) + (z[j + 1, i] * (1 - tx) + z[j + 1, i + 1] * tx) * ty)


def bennelong_meshes(b, o, ground=()):
    """The precinct from bennelong(): the paving draped on its level, the seawall with its coping,
    the Opera Bar's umbrellas, the canopies and the western colonnade as meshes; the street
    furniture as props drawn once per kind and instanced (web/world.js); and the regions where the
    ground is not drawn (clip)."""
    meshes = []
    lv = b["level"]
    so, sf = np.array(b["origin"], float), np.array(b["axis"], float)
    sl = np.array([sf[1], -sf[0]])
    uv = lambda x, y: [float((np.array([x, y]) - so) @ sl), float((np.array([x, y]) - so) @ sf)]  # along and across the steps' axis
    # the paving: a 4 m grid clipped to the outline, so it follows its level
    pave = Mesh("bennelong_paving", "flagstone", True, uv=True)
    for d in b["deck"]:
        poly = Polygon(d["ring"], d["holes"]).buffer(0)  # (valid again after rounding)
        x0, y0, x1, y1 = poly.bounds
        G = 4.0
        for gx in np.arange(math.floor(x0 / G) * G, x1, G):
            for gy in np.arange(math.floor(y0 / G) * G, y1, G):
                cell = shapely.box(gx, gy, gx + G, gy + G)
                if not poly.intersects(cell):
                    continue
                piece = cell if poly.contains(cell) else cell.intersection(poly)
                for q in Polygon_pieces(piece):
                    for t in shapely.constrained_delaunay_triangles(q).geoms:
                        cs = np.asarray(t.exterior.coords)[:3]
                        (ax, ay), (bx, by) = cs[1] - cs[0], cs[2] - cs[0]
                        if abs(ax * by - ay * bx) < 1e-6:
                            continue
                        if ax * by - ay * bx < 0:
                            cs = cs[::-1]
                        pave.tri(*[np.array([x, y, level_at(lv, x, y) + 0.03]) for x, y in cs], [uv(x, y) for x, y in cs])
    pave.weld()
    meshes.append(pave)
    if b.get("lower"):
        meshes += concourse_meshes(b["lower"], uv, lv, [Polygon(d["ring"], d["holes"]).buffer(0) for d in b["deck"]])
    # the harbour's bottom at the seawall's foot, out across the strip where the ground is not drawn
    bed = Mesh("seawall_bed", "seabed", False)
    for r in b.get("seabed", []):
        poly = Polygon(r["ring"], r["holes"]).buffer(0)
        for t in shapely.constrained_delaunay_triangles(poly).geoms if not poly.is_empty else []:
            cs = np.asarray(t.exterior.coords)[:3]
            (ax, ay), (bx, by) = cs[1] - cs[0], cs[2] - cs[0]
            if ax * by - ay * bx < 0:
                cs = cs[::-1]
            bed.tri(*[np.array([x, y, SEAWALL_FOOT_M]) for x, y in cs])
    if bed.v:
        meshes.append(bed)
    # the seawall: its face from the coping down below low water, and the coping, a little proud
    walls = {k: Mesh(f"seawall_{k}", f"seawall_{k}", False, uv=True) for k in ("opera", "sandstone")}
    coping = Mesh("seawall_coping", "coping", False, uv=True)
    opera = shapely.union_all([Polygon([r[:2] for r in rr["ring"]]) for rr in o["podium"]["rings"]]).buffer(45) if o else None
    for w in b["seawalls"]:
        P = [np.array(p, float) for p in w]
        run = 0.0
        for k in range(len(P) - 1):
            a, c = P[k], P[k + 1]
            e = c[:2] - a[:2]
            L = float(np.linalg.norm(e))
            if L < 1e-3:
                continue
            n = np.array([e[1], -e[0]]) / L  # out over the water
            mid = (a[:2] + c[:2]) / 2
            kind = "opera" if opera is not None and opera.contains(Point(*mid)) and mid[1] > 470 else "sandstone"
            top_a, top_c = a[2] - 0.16, c[2] - 0.16
            fa, fc = a[:2] + n * 0.02, c[:2] + n * 0.02
            walls[kind].quad(np.array([*fa, SEAWALL_FOOT_M]), np.array([*fc, SEAWALL_FOOT_M]), np.array([*fc, top_c]), np.array([*fa, top_a]),
                             [[run, SEAWALL_FOOT_M], [run + L, SEAWALL_FOOT_M], [run + L, top_c], [run, top_a]])
            # the coping: 0.6 m deep, its nosing 8 cm out over the face and 16 cm deep
            ia, ic, oa, oc = a[:2] - n * 0.55, c[:2] - n * 0.55, a[:2] + n * 0.1, c[:2] + n * 0.1
            coping.quad(np.array([*ia, a[2]]), np.array([*oa, a[2]]), np.array([*oc, c[2]]), np.array([*ic, c[2]]),
                        [[run, -0.55], [run, 0.1], [run + L, 0.1], [run + L, -0.55]])
            coping.quad(np.array([*oa, top_a]), np.array([*oc, top_c]), np.array([*oc, c[2]]), np.array([*oa, a[2]]),
                        [[run, 0.0], [run + L, 0.0], [run + L, 0.16], [run, 0.16]])
            # its back, down under the paving as drawn (on its 5 m grid it can lie lower than the coping)
            ba, bc = min(level_at(lv, *ia), a[2]) - 0.5, min(level_at(lv, *ic), c[2]) - 0.5
            coping.quad(np.array([*ic, bc]), np.array([*ia, ba]), np.array([*ia, a[2]]), np.array([*ic, c[2]]),
                        [[run + L, 0.0], [run, 0.0], [run, 0.16], [run + L, 0.16]])
            run += L
    meshes += [walls["opera"], walls["sandstone"], coping]
    # the faces along the paving's other edges, down or up to the ground beyond: the Tarpeian
    # Wall's sandstone below the Royal Botanic Garden, a kerb elsewhere
    # the cliff's top: the garden as the aerial photo shows it, on the tile under the cliff
    caps = [p for pts in b["skirts"] for p in pts if len(p) > 4]
    tile = next((t for t in ground if caps and all(t["x0"] <= p[k] <= t["x1"] and t["y0"] <= p[k + 1] <= t["y1"] for p in caps for k in (0, 4))), None)
    if tile:
        MATERIALS["garden_edge"]["map"] = tile["file"]
    tuv = (lambda q: [(q[0] - tile["x0"]) / (tile["x1"] - tile["x0"]), (q[1] - tile["y0"]) / (tile["y1"] - tile["y0"])]) if tile else (lambda q: [0.0, 0.0])
    cap = Mesh("bennelong_garden_edge", "garden_edge", False, uv=True)
    for kind, mat in (("tarpeian", "tarpeian"), ("cliff", "seawall_sandstone_dry"), ("kerb", "coping")):
        m = Mesh(f"bennelong_{kind}", mat, False, uv=True)
        for pts in b["skirts"]:
            run = 0.0
            # from under the paving as it is drawn (its 5 m grid, smoothed, can lie a metre or two under the level at its edge)
            pts = [[p[0], p[1], min(p[2], level_at(lv, p[0], p[1]) - 0.5)] + list(p[3:]) for p in pts]
            for a, c in zip(pts, pts[1:]):
                L = math.hypot(c[0] - a[0], c[1] - a[1])
                tall = max(a[3] - level_at(lv, *a[:2]), c[3] - level_at(lv, *c[:2])) > 1.2
                is_ = len(a) > 4 and len(c) > 4 if kind == "tarpeian" else (not (len(a) > 4 and len(c) > 4) and tall == (kind == "cliff"))
                if not is_:
                    run += L
                    continue
                m.quad(np.array([a[0], a[1], a[2]]), np.array([c[0], c[1], c[2]]), np.array([c[0], c[1], c[3]]), np.array([a[0], a[1], a[3]]),
                       [[run, a[2]], [run + L, c[2]], [run + L, c[3]], [run, a[3]]])
                if kind == "tarpeian":  # its top, back over the DEM's slope to the garden's level
                    q = [np.array([a[0], a[1], a[3]]), np.array([c[0], c[1], c[3]]), np.array(c[4:7]), np.array(a[4:7])]
                    if np.cross(q[1] - q[0], q[3] - q[0])[2] < 0:
                        q = q[::-1]
                    cap.quad(*q, [tuv(v) for v in q])
                run += L
        meshes.append(m)
    meshes.append(cap)
    # the furniture OpenStreetMap outlines as buildings
    umbrellas = []
    for part in b["parts"]:
        ring = np.array(part["ring"], float)
        poly = Polygon(ring)
        if part["class"] == "shelter" and poly.area < 40:  # the Opera Bar's square umbrellas
            mr = np.asarray(poly.minimum_rotated_rectangle.exterior.coords)[:4]
            e = mr[1] - mr[0]
            c = poly.centroid
            umbrellas.append([round(c.x, 2), round(c.y, 2), part["z"], round(math.atan2(e[1], e[0]), 3), round(math.sqrt(poly.area) / 4.6, 3)])
        elif poly.minimum_rotated_rectangle.length > 70:  # long and thin: the western colonnade
            meshes += colonnade(ring, part["z"], o)
        else:
            meshes += canopy(ring, part["z"], min(part["top_m"], 3.6), part["osm"])
    props = [dict(name=k, at=v, parts=[m.dump() for m in PROP_MODELS[k]()], far=FAR.get(k, 600)) for k, v in b["props"].items() if k in PROP_MODELS]
    if umbrellas:
        props.append(dict(name="umbrella", at=umbrellas, parts=[m.dump() for m in umbrella_model()], far=900))
    # the seawall's face as drawn (2 cm out from its line, the water on the right), where the game's
    # walker stops with its toes at the coping's edge (web/quays.js "faces")
    faces = []
    for w in b["seawalls"]:
        P = np.array([p[:2] for p in w], float)
        if len(P) < 2:
            continue
        line = shapely.LineString(P).offset_curve(-0.02)  # (shapely: negative offsets to the right)
        for g in getattr(line, "geoms", [line]):
            if not g.is_empty and g.length > 0.5:
                faces.append([[round(x, 2), round(y, 2)] for x, y in g.coords])
    return meshes, {"props": props, "clip": b["clip"], "seawalls": faces}


def concourse_meshes(L, uv, lv, drape):
    """The Lower Concourse from concourse_out(): its pieces of paving on their own levels (the
    walkway and the concourse in flags, the steps' treads), the faces between them (risers, and the
    retaining walls in granite courses), the parapets along the walkway's inner edge, and the
    forecourt's edge over the concourse: its parapet and fascia, and where the forecourt stands a
    storey above the concourse, the colonnade under it, a soffit on mushroom columns with the
    shopfronts behind."""
    lc = lower_loaded(L)
    flags, treads = Mesh("lc_paving", "flagstone", True, uv=True), Mesh("lc_treads", "lc_tread", False, uv=True)
    G = 3.0
    for pc in lc["pieces"]:
        poly, m = pc["poly"], (treads if pc["kind"] in ("tread", "flight") else flags)
        zf = (lambda x, y, z=pc["z"]: z) if "z" in pc else (lambda x, y, prof=pc["s"]: float(np.interp(lc["ref"].project(Point(x, y)), *zip(*prof))))
        x0, y0, x1, y1 = poly.bounds
        for gx in np.arange(math.floor(x0 / G) * G, x1, G):
            for gy in np.arange(math.floor(y0 / G) * G, y1, G):
                cell = shapely.box(gx, gy, gx + G, gy + G)
                if not poly.intersects(cell):
                    continue
                for q in Polygon_pieces(cell.intersection(poly)):
                    for t in shapely.constrained_delaunay_triangles(q).geoms:
                        cs = np.asarray(t.exterior.coords)[:3]
                        (ax, ay), (bx, by) = cs[1] - cs[0], cs[2] - cs[0]
                        if abs(ax * by - ay * bx) < 1e-6:
                            continue
                        if ax * by - ay * bx < 0:
                            cs = cs[::-1]
                        m.tri(*[np.array([x, y, zf(x, y) + 0.03]) for x, y in cs], [uv(x, y) for x, y in cs])
    flags.weld()
    treads.weld()
    # the faces between pieces of different levels, and between a piece and the paving round it: along
    # every piece's edge, from its own level to its neighbour's, drawn once from the higher side
    # (a riser up to 30 cm, a granite wall above that)
    risers, walls = Mesh("lc_risers", "lc_riser", False, uv=True), Mesh("lc_walls", "lc_wall", False, uv=True)
    zof = lambda pc, x, y: pc["z"] if "z" in pc else float(np.interp(lc["ref"].project(Point(x, y)), *zip(*pc["s"])))
    rest = shapely.union_all(drape) if drape else Polygon()
    fence = shapely.LineString([e[:2] for e in L["edge"]])  # the forecourt's edge: its fascia, below

    under = shapely.union_all([pc["poly"] for pc in lc["under"]]) if lc["under"] else Polygon()

    def neighbour(x, y, me):
        p = Point(x, y)
        for pc in lc["pieces"]:
            if pc is not me and pc["poly"].contains(p):
                return zof(pc, x, y), False
        if rest.contains(p):
            return level_at(lv, x, y), True
        return None, False
    run = 0.0
    for pc in lc["pieces"]:
        for ring, hole in [(r, k > 0) for poly in Polygon_pieces(pc["poly"]) for k, r in enumerate([poly.exterior] + list(poly.interiors))]:
            line = shapely.LineString(ring.coords).segmentize(1.0)
            c = np.asarray(line.coords)
            ccw = shapely.LinearRing(ring.coords).is_ccw
            for a, b in zip(c, c[1:]):
                e = b - a
                n = float(np.linalg.norm(e))
                if n < 1e-3:
                    continue
                m = (a + b) / 2
                out = np.array([e[1], -e[0]]) / n * (1 if ccw else -1)  # to its right on an anticlockwise ring: outside
                if hole:
                    out = -out
                zi = zof(pc, *(m - out * 0.15))
                zo, is_rest = neighbour(*(m + out * 0.25), pc)
                if zo is None or abs(zi - zo) < 0.03 or not (zi > zo or is_rest):
                    continue
                if is_rest and fence.distance(Point(*m)) < 0.4:
                    continue  # the forecourt's edge: its fascia
                lo, hi = min(zi, zo), max(zi, zo) + 0.03
                if is_rest and under.contains(Point(*(m + out * 0.25))):
                    lo = zo - LOWER["slab_m"]  # where the floor goes on under the forecourt: the slab's edge over it
                mesh = walls if hi - lo > 0.33 else risers
                mesh.quad(np.array([*a, lo - 0.3]), np.array([*b, lo - 0.3]), np.array([*b, hi]), np.array([*a, hi]),
                          [[run, lo - 0.3], [run + n, lo - 0.3], [run + n, hi], [run, hi]] if mesh is walls else [[run, 0.0], [run + n, 0.0], [run + n, 1.0], [run, 1.0]])
                run += n
    # under it all, a dark bed, so that a hairline between two pieces shows shadow and not the water
    bed = Mesh("lc_bed", "lc_riser", False)
    low = min(min(pc["s"], key=lambda q: q[1])[1] if "s" in pc else pc["z"] for pc in lc["pieces"]) - 0.35
    u = shapely.union_all([pc["poly"] for pc in lc["pieces"]])
    for q in Polygon_pieces(u.buffer(3.0).intersection(shapely.union_all([u, rest]).buffer(0.5))):
        for t in shapely.constrained_delaunay_triangles(q).geoms:
            cs = np.asarray(t.exterior.coords)[:3]
            bed.tri(*[np.array([x, y, low]) for x, y in cs])
    # the parapets along the walkway's inner edge, over the retaining walls
    par = Mesh("lc_parapets", "lc_wall", False, uv=True)
    h = LOWER["wall_parapet_m"]
    for runp in L["parapets"]:
        for p, q in zip(runp, runp[1:]):
            par.box(np.array([p[0], p[1], p[2] + h / 2 - 0.15]), np.array([q[0], q[1], q[2] + h / 2 - 0.15]), 0.32, h + 0.3)
    # the forecourt's edge over the concourse
    E = L["edge"]
    fascia, soffit, shop = Mesh("lc_fascia", "lc_fascia", False, uv=True), Mesh("lc_soffit", "lc_soffit", False, floodlit=True), Mesh("lc_shopfronts", "lc_shop", False, floodlit=True, uv=True)
    floor_m, cols = Mesh("lc_colonnade_floor", "lc_floor", True, floodlit=True, uv=True), Mesh("lc_columns", "lc_soffit", True, floodlit=True)
    rec, slab, ph = LOWER["recess_m"], LOWER["slab_m"], LOWER["parapet_m"]
    well = L.get("well")
    # the passage to the stairwell, through the shopfronts, and the stairwell's opening: no shopfront or soffit across them
    door = shapely.union_all([Polygon(well["passage"]), Polygon(well["opening"])]).buffer(0.05) if well else Polygon()
    run = 0.0
    downs = Mesh("lc_downlights", "lc_downlight", False, floodlit=True)
    next_light = DOWNLIGHT_EVERY_M / 2
    for k in range(len(E) - 1):
        e0, e1 = E[k], E[k + 1]
        q0, q1 = np.array(e0[:2]), np.array(e1[:2])
        n0, n1 = np.array(e0[2:4]), np.array(e1[2:4])
        L1 = float(np.linalg.norm(q1 - q0))
        if abs(e0[5] - e0[4]) < 0.25 and abs(e1[5] - e1[4]) < 0.25:
            run += L1
            continue
        P = lambda q, z: np.array([q[0], q[1], z])
        top0, top1 = e0[5] + ph, e1[5] + ph
        # the parapet: its top, and its face to the forecourt
        fascia.quad(P(q0, top0), P(q1, top1), P(q1 + n1 * 0.3, top1), P(q0 + n0 * 0.3, top0), [[run, 0], [run + L1, 0], [run + L1, 0.3], [run, 0.3]])
        fascia.quad(P(q0 + n0 * 0.3, e0[5] - 0.1), P(q1 + n1 * 0.3, e1[5] - 0.1), P(q1 + n1 * 0.3, top1), P(q0 + n0 * 0.3, top0),
                    [[run, e0[5]], [run + L1, e1[5]], [run + L1, top1], [run, top0]])
        inside = storey_over(e0) and storey_over(e1)
        if inside:
            s0, s1 = e0[5] - slab, e1[5] - slab
            fascia.quad(P(q0, s0), P(q1, s1), P(q1, top1), P(q0, top0), [[run, s0], [run + L1, s1], [run + L1, top1], [run, top0]])
            b0, b1 = q0 + n0 * rec, q1 + n1 * rec
            if not Polygon([q0, q1, b1, b0]).intersects(Polygon(well["opening"]) if well else Polygon()):
                soffit.quad(P(q0, s0), P(q1, s1), P(b1, s1), P(b0, s0))
                # the downlights: every DOWNLIGHT_EVERY_M along the colonnade, in the middle of its depth
                while next_light <= run + L1:
                    f = (next_light - run) / L1
                    c = q0 + (q1 - q0) * f + (n0 + (n1 - n0) * f) * rec * 0.5
                    zc = s0 + (s1 - s0) * f - 0.02
                    if zc - (e0[4] + (e1[4] - e0[4]) * f) < 1.8:  # (no colonnade under the edge here)
                        next_light += DOWNLIGHT_EVERY_M
                        continue
                    ring = [c + DOWNLIGHT_R_M * np.array([math.cos(a), math.sin(a)]) for a in np.linspace(0, 2 * math.pi, 9)[:-1]]
                    for a, b in zip(ring, ring[1:] + ring[:1]):
                        downs.tri(P(c, zc), P(b, zc), P(a, zc))  # (facing down)
                    DOWNLIGHTS.append((round(float(c[0]), 1), round(float(c[1]), 1)))
                    next_light += DOWNLIGHT_EVERY_M
            else:
                next_light = max(next_light, run + L1 + DOWNLIGHT_EVERY_M / 2)
            if not door.intersects(shapely.LineString([b0, b1])):
                shop.quad(P(b0, e0[4]), P(b1, e1[4]), P(b1, s1), P(b0, s0), [[run, 0.0], [run + L1, 0.0], [run + L1, s1 - e1[4]], [run, s0 - e0[4]]])
            floor_m.quad(P(q0, e0[4] + 0.03), P(q1, e1[4] + 0.03), P(b1, e1[4] + 0.03), P(b0, e0[4] + 0.03), [uv(*q0), uv(*q1), uv(*b1), uv(*b0)])
            for kk, (ea, eb) in enumerate(((E[k - 1] if k else None, e0), (e1, E[k + 2] if k + 2 < len(E) else None))):
                if ea is None or eb is None or not (storey_over(ea) and storey_over(eb)):  # the colonnade's end: closed
                    e = e0 if kk == 0 else e1
                    qq, nn = np.array(e[:2]), np.array(e[2:4])
                    fascia.quad(P(qq, e[4] - 0.3), P(qq + nn * rec, e[4] - 0.3), P(qq + nn * rec, e[5] - slab), P(qq, e[5] - slab),
                                [[0, e[4]], [rec, e[4]], [rec, e[5]], [0, e[5]]])
        else:
            near = E[max(k - 2, 0):k + 4]  # down past the lowest floor beside it (a flight's treads step between the samples)
            lo0 = lo1 = min(min(e[4], e[5]) for e in near) - 0.4
            fascia.quad(P(q0, lo0), P(q1, lo1), P(q1, top1), P(q0, top0), [[run, lo0], [run + L1, lo1], [run + L1, top1], [run, top0]])
        run += L1
    # under the slab they see the sky only between the columns, the soffit not at all (its light is
    # what comes back up off the concourse): the share of the sky's light each takes (world.js "sky"),
    # the view factors of a 5 m recess under a 2.4 m opening
    soffit.sky, cols.sky, floor_m.sky, shop.sky = SKY_UNDER["soffit"], SKY_UNDER["columns"], SKY_UNDER["floor"], SKY_UNDER["shopfront"]
    soffit.bounce = cols.bounce = shop.bounce = MATERIALS["flagstone"]["color"]  # (off the forecourt's pink granite)
    for x, y, zf, zs in colonnade_columns(E):  # the mushroom columns, just in from the fascia
        r = LOWER["column_r_m"]
        cols.lathe([(zf - 0.1, r), (zs - 0.75, r), (zs - 0.35, 0.55), (zs - 0.08, 1.05), (zs, 1.1)], np.array([x, y]), segs=14)
    out = [flags, treads, risers, walls, par, fascia, soffit, shop, floor_m, cols, bed, downs]
    if well:
        out += well_meshes(well, lc, uv)
    return [m for m in out if m.v]


def well_meshes(W, lc, uv):
    """The stairwell's passage under the forecourt (concourse_out() "well"): its floor in flags, its
    ceiling, its side walls in granite from the shopfronts to the landing at the flight's foot, with
    the landing's ceiling and walls; and the balustrade round the opening on the forecourt, a granite
    upstand under a bronze rail."""
    floor_, top = W["floor_m"], W["top_m"]
    ceil = top - LOWER["slab_m"]
    pas = Mesh("lc_well_floor", "lc_floor", True, floodlit=True, uv=True)
    lid = Mesh("lc_well_ceiling", "lc_soffit", False, floodlit=True)
    side = Mesh("lc_well_walls", "lc_wall", False, uv=True)
    rail = Mesh("lc_well_rail", "lc_wall", False, uv=True)
    bronze = Mesh("lc_well_bronze", "lc_bronze", False)
    opening = Polygon(W["opening"])
    for pc in lc["under"]:
        if pc["kind"] != "passage":
            continue
        for t in shapely.constrained_delaunay_triangles(pc["poly"]).geoms:
            cs = np.asarray(t.exterior.coords)[:3]
            (ax, ay), (bx, by) = cs[1] - cs[0], cs[2] - cs[0]
            if ax * by - ay * bx < 0:
                cs = cs[::-1]
            pas.tri(*[np.array([x, y, floor_ + 0.03]) for x, y in cs], [uv(x, y) for x, y in cs])
            lid.tri(*[np.array([x, y, ceil]) for x, y in cs[::-1]])
        # its walls: along every edge that is not open to the colonnade, the opening or the other part
        others = shapely.union_all([q["poly"] for q in lc["under"] if q is not pc] + [opening]).buffer(0.05)
        ring = shapely.LineString(pc["poly"].exterior.coords).segmentize(1.0)
        c = np.asarray(ring.coords)
        ccw = pc["poly"].exterior.is_ccw
        run = 0.0
        for a, b in zip(c, c[1:]):
            e = b - a
            n = float(np.linalg.norm(e))
            if n < 1e-3:
                continue
            out = np.array([e[1], -e[0]]) / n * (1 if ccw else -1)
            if others.contains(Point(*((a + b) / 2 + out * 0.2))):
                run += n
                continue
            side.quad(np.array([*b, floor_ - 0.1]), np.array([*a, floor_ - 0.1]), np.array([*a, ceil]), np.array([*b, ceil]),
                      [[run + n, floor_], [run, floor_], [run, ceil], [run + n, ceil]])
            run += n
    # the slab's edge round the opening, where the passage or the landing runs on under the slab: its
    # 1.5 m from their ceiling up to the forecourt (without it, nothing is drawn between the two and the
    # stair looks into the slab's body, issue #141)
    under = shapely.union_all([pc["poly"] for pc in lc["under"] if pc["kind"] == "passage"]).buffer(0.02)
    oc = np.asarray(opening.exterior.segmentize(1.0).coords)
    occw = opening.exterior.is_ccw
    run = 0.0
    for a, b in zip(oc, oc[1:]):
        e = b - a
        n = float(np.linalg.norm(e))
        if n < 1e-3:
            continue
        out = np.array([e[1], -e[0]]) / n * (1 if occw else -1)  # out of the opening, into the slab
        if under.contains(Point(*((a + b) / 2 + out * 0.3))) and not opening.contains(Point(*((a + b) / 2 + out * 0.3))):
            side.quad(np.array([*a, ceil - 0.02]), np.array([*b, ceil - 0.02]), np.array([*b, top + 0.02]), np.array([*a, top + 0.02]),
                      [[run, ceil], [run + n, ceil], [run + n, top], [run, top]])
        run += n
    # the balustrade round the opening: a granite upstand, a bronze rail on it
    r = np.asarray(W["rail"], float)
    h = LOWER["well"]["rail_m"]
    for a, b in zip(r, r[1:]):
        e = (b - a) / (np.linalg.norm(b - a) or 1)
        o = np.array([e[1], -e[0]])
        if opening.contains(Point(*((a + b) / 2 + o * 0.3))):
            o = -o  # out onto the forecourt
        a2, b2 = a + o * 0.14, b + o * 0.14
        rail.box(np.array([*a2, top + (h - 0.25) / 2]), np.array([*b2, top + (h - 0.25) / 2]), 0.26, h - 0.25 + 0.05)
        bronze.box(np.array([*a2, top + h - 0.08]), np.array([*b2, top + h - 0.08]), 0.08, 0.16)
    pas.sky = lid.sky = side.sky = SKY_UNDER["passage"]
    lid.bounce = side.bounce = MATERIALS["flagstone"]["color"]  # (in under the forecourt, lit from the colonnade's end)
    return [pas, lid, side, rail, bronze]


def Polygon_pieces(g):
    return [q for q in (g.geoms if hasattr(g, "geoms") else [g]) if q.geom_type == "Polygon" and q.area > 1e-4]


FAR = {"bollard": 260, "bench": 350, "pylon": 350, "lamp": 900, "floodlight": 1600}  # drawn within this many metres


def cuboid(m, c, size, yaw=0.0):
    """An upright box centred at c (x, y, z of its centre) of size (x, y, z), turned yaw about z."""
    ca, sa = math.cos(yaw), math.sin(yaw)
    hx, hy, hz = (s / 2 for s in size)
    P = lambda x, y, z: np.array([c[0] + x * ca - y * sa, c[1] + x * sa + y * ca, c[2] + z])
    v = [P(x, y, z) for z in (-hz, hz) for y in (-hy, hy) for x in (-hx, hx)]
    for a, b_, c_, d in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        m.quad(v[a], v[b_], v[c_], v[d])


def sphere(m, c, r, segs=10):
    m.lathe([(c[2] - r * math.cos(t), r * math.sin(t) + 1e-3) for t in np.linspace(0, math.pi, segs // 2 + 1)], (c[0], c[1]), segs)


def bollard_model():
    m = Mesh("bollard", "bollard", True)
    m.lathe([(0.0, 0.095), (0.88, 0.095), (0.93, 0.085), (0.98, 0.055), (1.0, 0.001)], (0, 0), 10)
    return [m]


def bench_model():
    """A slatted timber bench on steel frames, 1.8 m long, facing +x."""
    seat, frame = Mesh("bench_slats", "timber", False), Mesh("bench_frame", "furniture", False)
    for x in (-0.18, -0.09, 0.0, 0.09, 0.18):
        cuboid(seat, (x, 0, 0.44), (0.075, 1.8, 0.035))
    for z in (0.62, 0.74, 0.86):
        cuboid(seat, (-0.27 - (z - 0.62) * 0.25, 0, z), (0.03, 1.8, 0.08))
    for y in (-0.75, 0.75):
        cuboid(frame, (0.0, y, 0.21), (0.42, 0.05, 0.05))
        cuboid(frame, (0.17, y, 0.21), (0.05, 0.05, 0.42))
        cuboid(frame, (-0.17, y, 0.21), (0.05, 0.05, 0.42))
        cuboid(frame, (-0.3, y, 0.66), (0.04, 0.05, 0.5), 0.0)
    return [seat, frame]


def lamp_model():
    """A globe lamp on a slim post, 4 m."""
    post, globe = Mesh("lamp_post", "post", True), Mesh("lamp_globe", "globe", True, floodlit=True)
    post.lathe([(0.0, 0.11), (0.35, 0.09), (0.45, 0.06), (3.55, 0.05), (3.62, 0.075), (3.7, 0.075)], (0, 0), 8)
    sphere(globe, (0, 0, 3.94), 0.25, 12)
    return [post, globe]


def floodlight_model():
    """One of the masts that floodlight the shells: a tapered pole 11 m tall, a crossbar and three
    lamps turned towards +x."""
    pole, lamps = Mesh("floodlight_pole", "post", True), Mesh("floodlight_lamps", "floodlamp", False, floodlit=True)
    pole.lathe([(0.0, 0.2), (0.4, 0.17), (11.0, 0.08), (11.05, 0.001)], (0, 0), 8)
    cuboid(pole, (0.0, 0.0, 10.7), (0.12, 1.5, 0.12))
    for y in (-0.6, 0.0, 0.6):
        cuboid(lamps, (0.2, y, 10.95), (0.32, 0.38, 0.3))
    return [pole, lamps]


def pylon_model():
    """A wayfinding pylon: a dark slab with a lit panel on each face."""
    body, face = Mesh("pylon_body", "pylon", False), Mesh("pylon_panel", "panel", False, floodlit=True)
    cuboid(body, (0, 0, 1.2), (0.24, 0.85, 2.4))
    for x in (-0.125, 0.125):
        cuboid(face, (x, 0, 1.45), (0.012, 0.66, 1.5))
    return [body, face]


PROP_MODELS = {"bollard": bollard_model, "bench": bench_model, "lamp": lamp_model, "floodlight": floodlight_model, "pylon": pylon_model}


def umbrella_model():
    """The Opera Bar's square market umbrella, 4.6 m across (scaled to each one's outline), with a
    table and four stools under it."""
    cloth, pole, furn = Mesh("umbrella_canopy", "umbrella", False), Mesh("umbrella_pole", "post", True), Mesh("umbrella_tables", "furniture", True)
    h, apex, eave = 2.3, 3.05, 2.45
    corners = [np.array([sx * h, sy * h, eave]) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    top = np.array([0.0, 0.0, apex])
    for k in range(4):
        a, b_ = corners[k], corners[(k + 1) % 4]
        cloth.tri(top, a, b_)
        cloth.quad(a, b_, b_ - np.array([0, 0, 0.22]), a - np.array([0, 0, 0.22]))  # the valance
    pole.tube([(0, 0, 0.0), (0, 0, apex + 0.12)], 0.035, 6)
    furn.lathe([(0.0, 0.25), (0.05, 0.25), (0.06, 0.04), (0.7, 0.04), (0.72, 0.42), (0.76, 0.42), (0.77, 0.001)], (0.0, 0.0), 12)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        furn.lathe([(0.0, 0.16), (0.04, 0.16), (0.05, 0.025), (0.62, 0.025), (0.63, 0.19), (0.68, 0.19), (0.69, 0.001)],
                   (0.85 * math.cos(a), 0.85 * math.sin(a)), 8)
    return [cloth, pole, furn]


def canopy(ring, z0, h, name):
    """A flat canopy on slim posts over its outline (the Opera Kitchen's, and two small ones on the
    western broadwalk)."""
    slab, posts = Mesh(f"canopy_{name}", "canopy", False), Mesh(f"canopy_{name}_posts", "post", True)
    poly = orient(Polygon(ring).simplify(0.2), 1.0)
    t0, t1 = z0 + h - 0.22, z0 + h
    for t in shapely.constrained_delaunay_triangles(poly).geoms:
        cs = np.asarray(t.exterior.coords)[:3]
        (ax, ay), (bx, by) = cs[1] - cs[0], cs[2] - cs[0]
        if ax * by - ay * bx < 0:
            cs = cs[::-1]
        slab.tri(*[np.array([x, y, t1]) for x, y in cs])
        slab.tri(*[np.array([x, y, t0]) for x, y in cs[::-1]])
    cs = np.asarray(poly.exterior.coords)
    for a, b_ in zip(cs, cs[1:]):
        slab.quad(np.array([*a, t0]), np.array([*b_, t0]), np.array([*b_, t1]), np.array([*a, t1]))
    inner = poly.buffer(-0.35)
    if not inner.is_empty:
        ln = inner.exterior
        for d in np.arange(0, ln.length, 4.5):
            q = ln.interpolate(d)
            posts.tube([(q.x, q.y, z0), (q.x, q.y, t0)], 0.05, 6)
    return [slab, posts]


def colonnade(ring, z0, o):
    """The western colonnade (2006, Utzon's last addition): a verandah 45 m long and 5 m deep
    along the podium, its flat roof edged in the podium's concrete panels on ten pairs of square
    columns 3 m high, 400 mm across, and the nine openings it shades, three doors and six windows
    1.95 m wide and 2.1 m high, cut into the podium wall behind it (Architecture Australia, May 2006)."""
    roof, cols, glass = Mesh("colonnade_roof", "colonnade", False, uv=True), Mesh("colonnade_columns", "colonnade", False), Mesh("colonnade_openings", "opening", False, floodlit=True)
    poly = Polygon(ring)
    mr = np.asarray(poly.minimum_rotated_rectangle.exterior.coords)[:4]
    e1, e2 = mr[1] - mr[0], mr[2] - mr[1]
    ax, cr = (e1, e2) if np.linalg.norm(e1) > np.linalg.norm(e2) else (e2, e1)
    L, D = float(np.linalg.norm(ax)), float(np.linalg.norm(cr))
    ax, cr = ax / L, cr / D
    c = np.asarray(poly.minimum_rotated_rectangle.centroid.coords[0])
    if (np.array(o["centroid"]) - c) @ cr > 0:  # cr points out, away from the podium
        cr = -cr
    D = min(D, 5.0)
    back = c - cr * D / 2  # the podium wall
    zc, zr = z0 + 3.0, z0 + 3.6
    P = lambda u, v, z: np.array([*(back + ax * u + cr * v), z])
    # the roof slab and its fascia of panels
    for z, flip in ((zr, False), (zc, True)):
        q = [P(-L / 2, 0, z), P(L / 2, 0, z), P(L / 2, D, z), P(-L / 2, D, z)]
        roof.quad(*(q[::-1] if flip else q), [[0, 0], [L, 0], [L, D], [0, D]][::-1] if flip else [[0, 0], [L, 0], [L, D], [0, D]])
    for (u0, v0), (u1, v1) in (((-L / 2, D), (L / 2, D)), ((L / 2, 0), (L / 2, D)), ((-L / 2, D), (-L / 2, 0))):
        roof.quad(P(u0, v0, zc), P(u1, v1, zc), P(u1, v1, zr), P(u0, v0, zr), [[0, zc], [L, zc], [L, zr], [0, zr]])
    for i in range(10):
        u = -L / 2 + L * (i + 0.5) / 10
        for du in (-0.5, 0.5):
            cuboid(cols, (*(back + ax * (u + du) + cr * (D - 0.45)), z0 + 1.5), (0.4, 0.4, 3.0), math.atan2(ax[1], ax[0]))
    # the openings in the wall behind, in the bays between the column pairs
    for i in range(9):
        u = -L / 2 + L * (i + 1) / 10
        door = i in (1, 4, 7)
        w, h, sill = (2.4, 2.6, 0.0) if door else (1.95, 2.1, 0.5)
        glass.quad(P(u - w / 2, 0.06, z0 + sill), P(u + w / 2, 0.06, z0 + sill), P(u + w / 2, 0.06, z0 + sill + h), P(u - w / 2, 0.06, z0 + sill + h))
    return [roof, cols, glass]
