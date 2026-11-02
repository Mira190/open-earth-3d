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
    "tile": {"color": "#f1eee6", "roughness": 0.35, "metalness": 0.0, "pattern": "chevron_tiles", "lid_m": 2.6, "chevron_m": 1.8, "emissive": "#fff4e6", "glow": 1.0},
    "tile_edge": {"color": "#d6ccb8", "roughness": 0.7, "metalness": 0.0},
    # topaz glass on bronze mullions, lit warm from the foyers after dark
    "glass": {"color": "#22170f", "roughness": 0.05, "metalness": 0.3, "emissive": "#ffc27a", "glow": 0.5,
              "pattern": "topaz_glass", "frame": "#4a3a2a", "transom_m": 2.7},
    "mullion": {"color": "#4d3c2b", "roughness": 0.5, "metalness": 0.7},
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
    # held back by the fine walking levels (walk_patch), where the walls and parapets stand up
    "lc_tread": {"color": "#b8a08c", "roughness": 0.8, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 0.0], "decal": True, "street_lit": True},
    "lc_riser": {"color": "#7e6154", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [1.2, 0.0], "stair": "riser", "decal": True},
    "lc_wall": {"color": "#a8897a", "roughness": 0.85, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.6, "block_m": 2.4, "street_lit": True, "solid": False},
    "lc_soffit": {"color": "#c9c1b3", "roughness": 0.9, "metalness": 0.0, "solid": False},
    "lc_fascia": {"color": "#a57c66", "roughness": 0.85, "metalness": 0.0, "pattern": "granite", "joints_m": [1.25, 3.6], "solid": False},
    "lc_shop": {"color": "#16110d", "roughness": 0.08, "metalness": 0.3, "emissive": "#ffc27a", "glow": 0.45, "solid": False},
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
# Sydney Opera House 034.jpg"), but the 5 m DEM dips 3 m in it where the vehicle concourse runs in
# underneath: there the paving keeps the forecourt's level
FORECOURT = [(258, 396), (348, 400), (350, 446), (258, 446)]
FORECOURT_M = 3.45
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
# No levels are published. They follow from the steps OpenStreetMap counts and the 5 m DEM: 13 risers
# of 15 cm down from the broadwalk (2.8 m on the DEM) put the concourse at 0.85 m, 7 risers up from it
# put the walkway at 1.90 m (the DEM, which barely resolves it, has 1.7 to 1.9 m), and the 20 risers
# down from the forecourt (3.45 m) are then 13 cm each. The ramp from Circular Quay comes down beside
# the first retaining wall. `fence_near` picks the forecourt's balustrade (an Overture fence, from
# OpenStreetMap) as the concourse's eastern edge; `hold_m` is how far in from it the forecourt keeps
# its level, where the 5 m DEM slopes down into the concourse
LOWER = {"fence_near": (233.0, 430.0), "walk_m": 1.90, "floor_m": 0.85, "riser_m": 0.15, "tread_m": 0.45, "up_risers": 13,
         "hold_m": 9.0, "recess_m": 5.0, "slab_m": 0.35, "parapet_m": 1.05, "wall_parapet_m": 0.9, "column_every_m": 8.4}
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
    z_foot = float(np.percentile([ctx.ground(*(top + f * u_foot + l * v)) for v in np.linspace(-hw, hw, 9)], 75))  # bury few treads
    a0 = top + f * (u_foot - STEPS["apron"])
    z_apron = min(z_foot, max(0.5, min(ctx.ground(*(a0 + l * v)) for v in np.linspace(-hw, hw, 9))))  # the lowest forecourt
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


def landmark_meshes(scene):
    """(materials, meshes) for pipeline/landmarks.py."""
    lm = scene["landmarks"]
    meshes = []
    if "opera_house" in lm:
        o = lm["opera_house"]
        meshes += opera_house(o)
        meshes += steps_mesh(o["steps"], "opera_steps")
        for hall, st in o["upper_steps"].items():
            meshes += steps_mesh(st, f"opera_steps_{hall}")
        meshes += podium_mesh(o)
    mats = {k: dict(v) for k, v in MATERIALS.items()}
    if "opera_house" in lm:
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
    return mats, meshes, extra


# ---------------------------------------------------------------- Opera House

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


def opera_house(o):
    """The three groups of shells on the ridges OSM maps, each shell two halves on the one sphere
    radius, and side shells on the flanks between the shells that stand back to back: tiled,
    with the precast edge of each shell along the legs of its arch and a cap along its ridge, and
    the glass walls that close their mouths, topaz glass on bronze mullions fanning out from the
    foot of each mouth (and closing a nested shell's back, inside the mouth of the one behind)."""
    shells = Mesh("opera_shells", "tile", True, floodlit=True, uv=True)
    rims, caps = Mesh("opera_shell_rims", "tile_edge", False), Mesh("opera_shell_ridges", "tile_edge", True)
    glass = Mesh("opera_glass", "glass", False, floodlit=True, uv=True)
    for hall, ridges in o["halls"].items():
        z0 = o["podium"]["low_m" if hall == "restaurant" else "top_m"]  # the restaurant stands on the lower landing
        backs = []  # each shell's back edges, west and east: from J down to the pedestal
        for k, (J, T, peds) in enumerate(hall_shells(hall, ridges, z0)):
            f = (T[:2] - J[:2]) / np.linalg.norm(T[:2] - J[:2])
            across = np.array([f[1], -f[0], 0.0])
            below = np.array([*((J[:2] + T[:2]) / 2), z0 - 30.0])
            legs, edges = [], []
            for P in peds:
                c = sphere_centre(P, T, J, R_SHELL, below - (P + T + J) / 3)
                pts = shell_half(P, T, J, c, across)
                shells.grid(pts, shell_uv(pts))
                leg = [r[0] for r in pts]  # the free edge, from the pedestal up to the tip
                inner = [q - (q - c) / R_SHELL * 1.1 for q in leg]  # the shell's thickness: the precast ribs under the tiles
                for i in range(len(leg) - 1):
                    rims.quad(leg[i], leg[i + 1], inner[i + 1], inner[i])
                legs.append([q - (q - c) / R_SHELL * 0.7 for q in leg])  # the glass stands a little inside the edge
                edges.append([r[-1] for r in pts][::-1])
            caps.sweep(pts[-1], [(-0.65, -0.25), (0.65, -0.25), (0.65, 0.12), (0.3, 0.3), (-0.3, 0.3), (-0.65, 0.12)])
            mouth(glass, np.array([T[0], T[1], z0]), legs[0] + legs[1][::-1][1:])
            if k > 1:  # a nested shell's back, in the mouth of the one behind: glazed down to the podium
                for e in edges:
                    mouth(glass, np.array([J[0], J[1], z0]), e)
            backs.append(edges)
        for side in (0, 1):  # side shells between the back-to-back pair
            faces, foot, outline = side_shell(backs[0][side][0], backs[0][side], backs[1][side], z0, SIDE_GLASS_M[hall])
            for pts in faces:
                shells.grid(pts, shell_uv(pts))
                caps.sweep([r[-1] for r in pts], [(-0.35, -0.2), (0.35, -0.2), (0.35, 0.08), (-0.35, 0.08)])
            mouth(glass, foot, outline)
    return [shells, rims, caps, glass]


def mouth(glass, foot, arch):
    """A glass wall hung from a shell's arch (points from one foot over to the other): a curtain of
    panes down to a line on the podium from one end of the arch through `foot`, under the tip, to
    the other. The bronze mullions that close in towards the foot, one at every second point of the
    arch, and the transoms are drawn on the glass (web/world.js "topaz_glass": u counts the mullions,
    v is metres above the datum)."""
    z0 = foot[2]
    ground = lambda q: np.array([q[0], q[1], z0])
    run = lambda pts: np.concatenate([[0.0], np.cumsum([np.linalg.norm(q - p) for p, q in zip(pts, pts[1:])])])
    sa, line = run(arch), [ground(arch[0]), foot, ground(arch[-1])]
    sl = run(line)
    t = sa / sa[-1] * sl[-1]
    seg = np.minimum(np.searchsorted(sl, t, side="right") - 1, len(line) - 2)
    bottom = [line[k] + (line[k + 1] - line[k]) * ((tt - sl[k]) / max(sl[k + 1] - sl[k], 1e-9)) for k, tt in zip(seg, t)]
    for k in range(len(arch) - 1):
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

    def level_base(x, y):
        """The paving's level: the ground, held up to the level behind where the DEM sags towards
        the seawall, and down to the level in front where it climbs a garden's bank or a wall;
        and the forecourt's level out to its edge over the Lower Concourse, where the 5 m DEM
        slopes down into it."""
        z = ctx.ground(x, y)
        p = Point(x, y)
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
        if forecourt.contains(p):
            z = FORECOURT_M
        return z
    # the Lower Concourse on its own levels: the walkway along the seawall, the concourse below it,
    # the steps between them and up to the broadwalk (pieces of paving, each with its level)
    lc = lower_concourse(ctx, line, fence, rwalls, deck_u, level_base) if fence is not None else None
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
            z = level_out(*p) if prec.contains(Point(*p)) else behind(np.asarray(p), n, 3.0)
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
    out = {"seawalls": seawalls, "skirts": skirts, "deck": deck_out, "level": lv, "clip": clip, "props": props, "parts": parts,
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


def lower_concourse(ctx, line, F, rwalls, deck_u, level_base):
    """The Lower Concourse as pieces of paving on their own levels (LOWER): the walkway along the
    seawall, down to the concourse at its retaining walls, or by broad steps where none is mapped;
    the ramp down to it from Circular Quay; the concourse, out to the forecourt's balustrade; and
    the flight at its north end up to the broadwalk. Each piece is flat or a profile along the
    seawall (s, metres along it). Also the faces between the pieces, the parapets along the tops
    of the retaining walls, and the forecourt's edge over the concourse, sampled along its
    balustrade."""
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
    # the flight up to the broadwalk at the north end, along the balustrade up to its last corner, from
    # the concourse to the paving beyond (13 risers in OSM; more or fewer if the levels ask it)
    d_end = F.project(Point(F.coords[-2])) if len(F.coords) > 2 else F.length
    fq = lambda d: np.asarray(F.interpolate(min(max(d, 0.0), F.length)).coords[0])
    ft = lambda d: (fq(d + 0.5) - fq(d - 0.5)) / (np.linalg.norm(fq(d + 0.5) - fq(d - 0.5)) or 1)
    z_top = level_base(*(fq(d_end) + ft(d_end - 1) * 6))  # the broadwalk, beyond the balustrade's last corner
    # sample along the seawall every metre, up to the balustrade's last corner, and as far as the
    # concourse is wide enough to walk (it narrows between the last retaining wall and the balustrade)
    S = list(np.arange(s_a, s_b, 1.0)) + [s_b]
    Fp = {s: F_at(s) for s in S}
    S = [s for s in S if Fp[s] is not None and F.project(Point(*Fp[s])) <= d_end + 0.05]
    if len(S) < 10:
        return None
    Wp = {s: W(s) for s in S}
    wide = [s for s in S if np.linalg.norm(Fp[s] - Wp[s]) >= 1.8]
    s_end = wide[-1] if wide else S[-1]
    S = [s for s in S if s <= s_end]
    # the flight up to the broadwalk (13 risers in OSM; more or fewer if the levels ask it), along the
    # balustrade at the concourse's north end
    d_end = F.project(Point(*Fp[s_end]))
    n_up = L["up_risers"] if 0.1 < (z_top - floor) / L["up_risers"] < 0.2 else max(1, round((z_top - floor) / riser))
    r_up, t_up = (z_top - floor) / n_up, 0.45
    d_f0 = d_end - n_up * t_up
    s_f0 = R.project(Point(*fq(d_f0)))
    floor_prof = [[s_a, z_south], [s_r1, floor], [s_f0, floor]]
    zc = lambda s: float(np.interp(s, *zip(*floor_prof)))
    pn, nn = frame(s_end + 1.5)
    z_north = level_base(*(pn + nn * 1.5))
    walk_prof = [[s_a, z_south], [s_a + 12, walk], [s_end - 12, walk], [s_end, z_north]]
    zw = lambda s: float(np.interp(s, *zip(*walk_prof)))
    S_walk = list(np.arange(s_a, s_end, 1.0)) + [s_end]
    ring = lambda a, b: Polygon([tuple(q) for q in list(a) + list(b)[::-1]]).buffer(0)
    walkway = ring([frame(s)[0] for s in S_walk], [W(s) for s in S_walk]).intersection(deck_u)
    band = ring([Wp[s] for s in S], [Fp[s] for s in S]).intersection(deck_u).difference(walkway)
    # where no retaining wall is mapped, broad steps down from the walkway (7 risers between its level and the concourse's)
    n_t = max(1, round((walk - floor) / riser))
    gaps, prev = [], s_r1
    for a, b in cover[1:] + [(s_f0, s_f0)]:
        if a - prev > 2.0:
            gaps.append((prev + 0.3, min(a, s_f0) - 0.3))
        prev = max(prev, b)
    off = lambda s, d: Wp[s] + frame(s)[1] * d
    pieces, faces, treads = [], [], []
    for g0, g1 in gaps:
        Sg = [s for s in S if g0 <= s <= g1]
        if len(Sg) < 2:
            continue
        for k in range(n_t - 1):
            q = ring([off(s, k * tread) for s in Sg], [off(s, (k + 1) * tread) for s in Sg]).intersection(band)
            if q.area > 0.3:
                treads.append(q)
                pieces.append({"poly": q, "z": round(walk - (k + 1) * (walk - floor) / n_t, 3), "kind": "tread"})
            for s0, s1 in zip(Sg, Sg[1:]):  # the riser at its back edge
                za = walk - k * (walk - floor) / n_t
                if k and np.linalg.norm(off(s1, k * tread) - Wp[s1]) < np.linalg.norm(Fp[s1] - Wp[s1]) - 0.3:
                    faces.append([off(s0, k * tread), off(s1, k * tread), za - (walk - floor) / n_t, za, "riser"])
        k = n_t - 1
        for s0, s1 in zip(Sg, Sg[1:]):
            if np.linalg.norm(off(s1, k * tread) - Wp[s1]) < np.linalg.norm(Fp[s1] - Wp[s1]) - 0.3:
                faces.append([off(s0, k * tread), off(s1, k * tread), floor, floor + (walk - floor) / n_t, "riser"])
    # the flight at the north end, its treads square to the balustrade, across the concourse
    def cut_at(d):  # from the balustrade at d out across the concourse
        q, t = fq(d), ft(d)
        return q + np.array([t[1], -t[0]]) * 0.5, q - np.array([t[1], -t[0]]) * 20
    for k in range(n_up):
        a, b = d_f0 + k * t_up, (d_f0 + (k + 1) * t_up) if k < n_up - 1 else d_end + 30
        (a0, a1), (b0, b1) = cut_at(a), cut_at(b)
        q = band.intersection(Polygon([tuple(a0), tuple(a1), tuple(b1), tuple(b0)]).buffer(0))
        if q.area > 0.2:
            pieces.append({"poly": q, "z": round(floor + (k + 1) * r_up, 3), "kind": "flight"})
        seg = shapely.LineString([a0, a1]).intersection(band.buffer(0.05))
        for g in getattr(seg, "geoms", [seg]):
            if g.geom_type == "LineString" and g.length > 0.3:
                c = list(g.coords)
                faces.append([np.asarray(c[0]), np.asarray(c[-1]), floor + k * r_up, floor + (k + 1) * r_up, "riser"])
    flight = shapely.union_all([p["poly"] for p in pieces if p["kind"] == "flight"])
    conc = band.difference(shapely.union_all(treads + [flight]))
    # what the pieces leave between them (slivers along their shared edges) goes to the concourse
    rest = shapely.union_all([walkway, band]).difference(shapely.union_all([walkway, conc] + treads + [flight]))
    conc = shapely.union_all([conc] + [q for q in Polygon_pieces(rest) if q.area > 1e-4]).buffer(0)
    pieces = [{"poly": walkway, "s": walk_prof, "kind": "walkway"}, {"poly": conc, "s": floor_prof, "kind": "concourse"}] + pieces
    # along the walkway's inner edge: a retaining wall down to the concourse (or the steps' top riser, or the flight's side)
    in_gap = lambda s: any(g0 <= s <= g1 for g0, g1 in gaps)
    parapets, run = [], []
    for s0, s1 in zip(S, S[1:]):
        sm = (s0 + s1) / 2
        lo = (walk - (walk - floor) / n_t) if in_gap(sm) else zc(sm)
        if sm >= s_f0:  # beside the flight: its tread there
            lo = piece_level({"ref": R, "pieces": [p for p in pieces if p["kind"] == "flight"]}, *(Wp[s0] + frame(s0)[1] * 0.4))
        top = zw(sm)
        if abs(top - lo) > 0.02:
            faces.append([Wp[s0], Wp[s1], min(lo, top), max(lo, top), "wall" if abs(top - lo) > 0.3 else "riser"])
        if top - lo > 0.6:  # a parapet on the walkway along its top
            run.append([*(Wp[s0] - frame(s0)[1] * 0.2), top])
        elif run:
            parapets.append(run)
            run = []
    if run:
        parapets.append(run)
    print(f"  the Lower Concourse: walkway {walkway.area:.0f} m2 at {walk} m, concourse {conc.area:.0f} m2 at {floor} m "
          f"(the ramp down to it {s_r1 - s_a:.0f} m), {len(treads)} treads of broad steps in {len(gaps)} places, "
          f"a flight of {n_up} risers of {r_up * 100:.0f} cm up to {z_top:.2f} m")
    return {"ref": R, "pieces": pieces, "faces": faces, "parapets": parapets, "fence": F,
            "union": shapely.union_all([p["poly"] for p in pieces]).buffer(0)}


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
    """The Lower Concourse for scene.json: the reference line, the pieces, the faces between them,
    the parapets, and the forecourt's edge over the concourse along its balustrade, every metre:
    [x, y, ex, ey (in under the forecourt), floor, forecourt]."""
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
    return {"ref": [r2(c) for c in lc["ref"].coords], "pieces": pieces,
            "faces": [[r2(a), r2(b), round(float(lo), 3), round(float(hi), 3), k] for a, b, lo, hi, k in lc["faces"]],
            "parapets": [[[round(float(v), 2) for v in q] for q in run] for run in lc["parapets"]], "edge": edge}


def lower_loaded(lower):
    """concourse_out()'s dump with its shapes rebuilt, for piece_level()."""
    if "_ref" not in lower:
        lower["_ref"] = shapely.LineString(lower["ref"])
        lower["_pieces"] = [dict(pc, poly=Polygon(pc["ring"], pc["holes"]).buffer(0)) for pc in lower["pieces"]]
    return {"ref": lower["_ref"], "pieces": lower["_pieces"]}


def walk_patch(lc, deck_u, rest, L):
    """The levels the game walks on over the Lower Concourse and round it, every half metre, in
    centimetres (-32768 where there is no paving): sharp at its walls and steps, which the 5 m
    walking grid would smooth into slopes, and up to the tops of the parapets along the walkway
    and the forecourt's edge, which hold a walker back. web/game/nav.js takes it over the grid."""
    import base64
    from shapely import contains_xy
    x0, y0, x1, y1 = lc["union"].buffer(6).bounds
    cell = 0.5
    x0, y0 = math.floor(x0), math.floor(y0)
    nx, ny = int((x1 - x0) / cell) + 1, int((y1 - y0) / cell) + 1
    gx, gy = np.meshgrid(x0 + (np.arange(nx) + 0.5) * cell, y0 + (np.arange(ny) + 0.5) * cell)
    z = np.full(gx.shape, np.nan)
    paved = contains_xy(deck_u, gx, gy)
    for j, i in zip(*np.nonzero(paved)):
        z[j, i] = rest(gx[j, i], gy[j, i])
    for pc in lc["pieces"]:
        inside = contains_xy(pc["poly"], gx, gy)
        if "z" in pc:
            z[inside] = pc["z"]
        else:
            s = shapely.line_locate_point(lc["ref"], shapely.points(gx[inside], gy[inside]))
            z[inside] = np.interp(s, *zip(*pc["s"]))
    # the parapets: along the walkway's inner edge, and the forecourt's along its balustrade
    for runp in L["parapets"]:
        for a, b in zip(runp, runp[1:]):
            g = shapely.LineString([a[:2], b[:2]]).buffer(0.25)
            on = contains_xy(g, gx, gy)
            z[on] = np.fmax(z[on], max(a[2], b[2]) + LOWER["wall_parapet_m"])
    for e0, e1 in zip(L["edge"], L["edge"][1:]):
        if abs(e0[5] - e0[4]) < 0.25:
            continue
        g = Polygon([e0[:2], e1[:2], [e1[0] + e1[2] * 0.4, e1[1] + e1[3] * 0.4], [e0[0] + e0[2] * 0.4, e0[1] + e0[3] * 0.4]]).buffer(0.1)
        on = contains_xy(g, gx, gy)
        z[on] = np.fmax(z[on], max(e0[5], e1[5]) + LOWER["parapet_m"])
    data = np.where(np.isnan(z), -32768, np.round(z * 100)).astype("<i2")
    return {"x0": x0, "y0": y0, "cell": cell, "nx": nx, "ny": ny, "encoding": "int16le-base64 cm, rows from y0 north, -32768 none",
            "data": base64.b64encode(data.tobytes()).decode()}


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
    return meshes, {"props": props, "clip": b["clip"]}


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
    fascia, soffit, shop = Mesh("lc_fascia", "lc_fascia", False, uv=True), Mesh("lc_soffit", "lc_soffit", False), Mesh("lc_shopfronts", "lc_shop", False, floodlit=True)
    floor_m, cols = Mesh("lc_colonnade_floor", "flagstone", True, uv=True), Mesh("lc_columns", "lc_soffit", True)
    rec, slab, ph = LOWER["recess_m"], LOWER["slab_m"], LOWER["parapet_m"]
    colonnade = lambda e: e[5] - e[4] > 2.3
    run, next_col = 0.0, 4.0
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
        inside = colonnade(e0) and colonnade(e1)
        if inside:
            s0, s1 = e0[5] - slab, e1[5] - slab
            fascia.quad(P(q0, s0), P(q1, s1), P(q1, top1), P(q0, top0), [[run, s0], [run + L1, s1], [run + L1, top1], [run, top0]])
            b0, b1 = q0 + n0 * rec, q1 + n1 * rec
            soffit.quad(P(q0, s0), P(q1, s1), P(b1, s1), P(b0, s0))
            shop.quad(P(b0, e0[4]), P(b1, e1[4]), P(b1, s1), P(b0, s0))
            floor_m.quad(P(q0, e0[4] + 0.03), P(q1, e1[4] + 0.03), P(b1, e1[4] + 0.03), P(b0, e0[4] + 0.03), [uv(*q0), uv(*q1), uv(*b1), uv(*b0)])
            for kk, (ea, eb) in enumerate(((E[k - 1] if k else None, e0), (e1, E[k + 2] if k + 2 < len(E) else None))):
                if ea is None or eb is None or not (colonnade(ea) and colonnade(eb)):  # the colonnade's end: closed
                    e = e0 if kk == 0 else e1
                    qq, nn = np.array(e[:2]), np.array(e[2:4])
                    fascia.quad(P(qq, e[4] - 0.3), P(qq + nn * rec, e[4] - 0.3), P(qq + nn * rec, e[5] - slab), P(qq, e[5] - slab),
                                [[0, e[4]], [rec, e[4]], [rec, e[5]], [0, e[5]]])
            deep = all(colonnade(E[j]) for j in range(max(k - 2, 0), min(k + 4, len(E))))
            while deep and next_col <= run + L1:  # a mushroom column every few metres, just in from the fascia
                t = (next_col - run) / max(L1, 1e-6)
                c = q0 + (q1 - q0) * t + (n0 + (n1 - n0) * t) * 1.1
                zf, zs = e0[4] + (e1[4] - e0[4]) * t, s0 + (s1 - s0) * t
                cols.lathe([(zf - 0.1, 0.24), (zs - 0.75, 0.24), (zs - 0.35, 0.55), (zs - 0.08, 1.05), (zs, 1.1)], c, segs=14)
                next_col += LOWER["column_every_m"]
            if not deep:
                next_col = max(next_col, run + L1 + 2.0)
        else:
            near = E[max(k - 2, 0):k + 4]  # down past the lowest floor beside it (a flight's treads step between the samples)
            lo0 = lo1 = min(min(e[4], e[5]) for e in near) - 0.4
            fascia.quad(P(q0, lo0), P(q1, lo1), P(q1, top1), P(q0, top0), [[run, lo0], [run + L1, lo1], [run + L1, top1], [run, top0]])
            next_col = run + L1 + 4.0
        run += L1
    return [m for m in (flags, treads, risers, walls, par, fascia, soffit, shop, floor_m, cols, bed) if m.v]


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
