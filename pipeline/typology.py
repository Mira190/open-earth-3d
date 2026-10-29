"""What a building looks like when the open data only says what it is: its roof
shape when none is mapped, its facade style, storey height and ground floor, its
roof material, and the frontages that get shopfronts and awnings.

The rules are per region (a city's "architecture" key in city.json picks one;
"architecture_overrides" adjusts it). Roof-shape priors come from the roof
shapes mapped in OpenStreetMap across each metro area (Overture roof_shape,
measured in October 2026: Greater Sydney n = 5,762; Kyoto n = 21,188; Tokyo 23
wards n = 5,142), so the mix of inferred roofs matches the mix that mappers
record. Every choice that is drawn rather than ruled takes a fixed hash of the
building's id, so a rebuild gives the same city.
"""
import colorsys
import math

import numpy as np

# facade styles; the viewer and Blender read the same codes
STYLES = ["plain", "house", "terrace", "apartment", "office", "glass", "heritage", "retail", "industrial", "civic",
          "machiya", "mixed", "stone", "haussmann"]
STYLE_CODE = {s: i for i, s in enumerate(STYLES)}
ROOF_MATERIALS = ["membrane", "gravel", "concrete", "tile", "metal", "slate", "kawara", "copper", "glass", "green", "zinc"]

HOUSE = {"house", "detached", "semidetached_house", "bungalow", "cabin", "farm", "static_caravan"}
TERRACE = {"terrace"}
FLATS = {"apartments", "residential", "dormitory", "hotel"}
SMALL = {"garage", "garages", "shed", "carport", "shelter", "toilets", "kiosk", "hut", "service", "greenhouse", "roof",
         "parking", "storage_tank", "silo", "transformer_tower", "bunker", "guardhouse", "boathouse"}
NO_WINDOWS = {"garage", "garages", "shed", "carport", "roof", "service", "greenhouse", "parking", "storage_tank", "silo",
              "transformer_tower", "bunker", "bridge_structure", "grandstand"}
COMMERCIAL = {"office", "commercial", "retail", "supermarket", "industrial", "warehouse", "manufacture"}
HERITAGE = {"church", "cathedral", "chapel", "synagogue", "mosque", "temple", "shrine", "public", "government", "civic",
            "museum", "train_station", "university", "college", "library", "courthouse", "townhall"}
INSTITUTION = {"school", "hospital", "kindergarten", "fire_station", "police", "sports_centre", "transportation",
               "military", "stadium"}

REGIONS = {
    "default": {
        "pitch": {"tile": 30, "metal": 20, "slate": 35, "kawara": 25, "copper": 35},
        "roof_cap_m": 6.0,
        # roof priors by group: shape -> probability
        "roofs": {
            "house": {"gabled": 0.55, "hipped": 0.35, "flat": 0.1},
            "terrace": {"gabled": 0.6, "hipped": 0.1, "flat": 0.3},
            "flats_low": {"flat": 0.5, "hipped": 0.3, "gabled": 0.2},
            "small": {"flat": 0.55, "skillion": 0.3, "gabled": 0.15},
            "worship": {"gabled": 0.8, "hipped": 0.1, "flat": 0.1},
            "civic_low": {"flat": 0.5, "hipped": 0.25, "gabled": 0.25},
            "commercial_low": {"flat": 0.7, "gabled": 0.15, "hipped": 0.1, "skillion": 0.05},
            "unknown_low": {"flat": 0.35, "hipped": 0.35, "gabled": 0.3},
        },
        "pitched_material": {"tile": 0.6, "metal": 0.3, "slate": 0.1},
        "awning": 0.0,
        "signage": 0.0,
        "machiya": False,
        "storefront_classes": {"retail", "commercial", "office", "hotel", "supermarket"},
        "ridge_follows_street": {"terrace"},
    },
    # Sydney: hipped detached houses and semis (63% and 86% hipped of mapped roofs),
    # terracotta tile or Colorbond steel; street awnings over CBD shopfronts
    "sydney": {
        # Federation and interwar houses 30-35 degrees, Victorian terraces 30-40 (typology research);
        # sheet metal runs flatter than tile
        "pitch": {"tile": 30, "metal": 22, "slate": 35, "copper": 35},
        "pitch_by_group": {"terrace": 33, "flats_low": 25, "commercial_low": 20, "small": 12},
        "roofs": {
            "house": {"hipped": 0.6, "gabled": 0.32, "flat": 0.05, "skillion": 0.03},
            "semi": {"hipped": 0.82, "gabled": 0.1, "flat": 0.05, "skillion": 0.03},
            "terrace": {"gabled": 0.55, "skillion": 0.15, "hipped": 0.1, "flat": 0.2},
            "flats_low": {"hipped": 0.55, "gabled": 0.15, "flat": 0.3},
            "commercial_low": {"flat": 0.65, "gabled": 0.2, "hipped": 0.1, "skillion": 0.05},
            "unknown_low": {"hipped": 0.45, "gabled": 0.3, "flat": 0.25},
        },
        "pitched_material": {"tile": 0.55, "metal": 0.4, "slate": 0.05},
        # Federation houses: Marseilles terracotta 0.75; terraces: corrugated iron 0.55, slate 0.3
        "material_by_group": {
            "house": {"tile": 0.68, "metal": 0.24, "slate": 0.08}, "semi": {"tile": 0.7, "metal": 0.22, "slate": 0.08},
            "terrace": {"metal": 0.55, "slate": 0.3, "tile": 0.15}, "flats_low": {"tile": 0.62, "metal": 0.33, "slate": 0.05},
            "commercial_low": {"metal": 0.8, "tile": 0.15, "slate": 0.05}, "small": {"metal": 0.92, "tile": 0.08},
            "worship": {"slate": 0.6, "tile": 0.25, "copper": 0.15}, "civic_low": {"slate": 0.45, "tile": 0.35, "metal": 0.2},
            "unknown_low": {"tile": 0.5, "metal": 0.42, "slate": 0.08},
        },
        "awning": 0.8,
        "storefront_classes": {"retail", "commercial", "office", "hotel", "supermarket", "apartments"},
        # wall colours from the typology research: painted stucco and sandstock brick on
        # terraces, red face brick and roughcast on Federation houses, liver and cream brick
        # on interwar and post-war flats, precast and concrete offices, Sydney sandstone
        "palettes": {
            "terrace": ["#e1d4b8", "#c2aa8b", "#b18d6c", "#8e4f3e", "#a8705a", "#e6e0d3", "#d6c6af", "#9c6b52"],
            "house": ["#8e4f3e", "#8c5136", "#d6c6af", "#e2ddd2", "#cfc6b8", "#a8705a", "#b9a48f"],
            "apartment": ["#584338", "#d6c6af", "#8c5136", "#e0dbd0", "#cfc6b8", "#bfb7aa", "#a8826b", "#e8e4dc"],
            "office": ["#b9ac93", "#adadad", "#c9c2b5", "#9c9a92", "#8d8a83", "#d2cbbd", "#a69e8e"],
            "heritage": ["#c7a97f", "#a79072", "#c8a978", "#bf9f70", "#b8956a"],
            "retail": ["#e1d4b8", "#c2aa8b", "#d6c6af", "#b9a48f", "#e6e0d3"],
        },
    },
    # Japan: gabled houses (Kyoto 82-89%, Tokyo 60% gabled and 31% hipped), kawara or
    # sheet-metal roofs; flat concrete roofs from three or four floors up
    "japan": {
        "pitch": {"kawara": 24, "metal": 18, "slate": 24, "copper": 30},
        "roofs": {
            "house": {"gabled": 0.6, "hipped": 0.3, "flat": 0.1},
            "terrace": {"gabled": 0.85, "hipped": 0.05, "flat": 0.1},
            "flats_low": {"flat": 0.6, "gabled": 0.25, "hipped": 0.15},
            "commercial_low": {"flat": 0.6, "gabled": 0.3, "hipped": 0.1},
            "unknown_low": {"gabled": 0.55, "hipped": 0.25, "flat": 0.2},
            "worship": {"hipped": 0.55, "gabled": 0.45},
        },
        "pitched_material": {"kawara": 0.4, "metal": 0.6},
        "material_by_group": {
            "house": {"metal": 0.6, "kawara": 0.4}, "terrace": {"kawara": 0.7, "metal": 0.3}, "worship": {"kawara": 0.75, "copper": 0.25},
            "small": {"metal": 0.9, "kawara": 0.1}, "unknown_low": {"metal": 0.55, "kawara": 0.45},
        },
        "awning": 0.15,
        "signage": 1.0,
        "ridge_follows_street": {"terrace", "house"},
        "water_tanks": 0.3,
        # ceramic siding on houses (over 80% of new exteriors), tile and painted concrete on
        # mansions and offices, all low chroma (the Tokyo and Kyoto colour rules)
        "palettes": {
            "house": ["#d9d5cf", "#cfc7bb", "#ccc8b9", "#a1917d", "#e3e3e3", "#bdb5a8", "#606060"],
            "terrace": ["#e3e3e3", "#cfc7bb", "#a79072", "#392f2b", "#d9d5cf"],
            "apartment": ["#a1917d", "#cec7ba", "#705c4d", "#e3e3e3", "#d9d5cf", "#b9b2a6", "#897667"],
            "office": ["#a1917d", "#8d949f", "#c8c8c8", "#b4b0a8", "#9fa3a6", "#cec7ba"],
            "retail": ["#cec7ba", "#c8c8c8", "#e3e3e3", "#8d949f"],
            "mixed": ["#cec7ba", "#8d949f", "#c8c8c8", "#e3e3e3", "#a1917d", "#b9b2a6"],
            "machiya": ["#392f2b", "#4a3b2e", "#733529"],
            "civic": ["#584338", "#e3e3e3", "#c8c8c8"],
        },
    },
    # Paris: the Haussmann block (building rules of 1859, 1884 and 1902): six or seven floors of
    # Lutetian limestone ashlar under a mansard of zinc over slate, shops and an entresol at street
    # level. Roofs over surveyed eaves are measured (LiDAR HD); the priors below only serve the
    # few buildings the LiDAR does not see. Zinc covers about 80% of Paris roofs (APUR); the
    # land tax files give the material of half the buildings.
    "paris": {
        "pitch": {"zinc": 40, "slate": 45, "tile": 35, "metal": 30, "copper": 40},
        "roof_cap_m": 9.0,
        "roofs": {
            "house": {"mansard": 0.35, "gabled": 0.35, "hipped": 0.3},
            "terrace": {"mansard": 0.5, "gabled": 0.3, "flat": 0.2},
            "flats_low": {"mansard": 0.55, "flat": 0.3, "gabled": 0.15},
            "small": {"flat": 0.5, "skillion": 0.35, "gabled": 0.15},
            "worship": {"gabled": 0.8, "hipped": 0.2},
            "civic_low": {"mansard": 0.4, "flat": 0.4, "hipped": 0.2},
            "commercial_low": {"flat": 0.6, "mansard": 0.25, "skillion": 0.15},
            "unknown_low": {"mansard": 0.4, "flat": 0.35, "gabled": 0.25},
        },
        "pitched_material": {"zinc": 0.7, "slate": 0.25, "tile": 0.05},
        "material_by_group": {"worship": {"slate": 0.6, "copper": 0.2, "zinc": 0.2}, "small": {"zinc": 0.8, "tile": 0.2}},
        "awning": 0.45,
        "storefront_classes": {"retail", "commercial", "office", "hotel", "supermarket", "apartments"},
        "haussmann": True,
        # roofs slope to the street and the courtyard between party walls; they sit behind the
        # cornice with no eaves past the wall; cadastral outlines carry jogs of a few centimetres
        "ridge_follows_street": {"apartments", "residential", "commercial", "retail", "office", "hotel", "house", "terrace", ""},
        "overhang_scale": 0.0,
        "roof_simplify_m": 0.25,
        # Lutetian limestone, fresh to weathered; painted render on the older faubourg houses;
        # millstone grit (meulière) and brick are rare inside the boulevards
        "palettes": {
            "haussmann": ["#e4d8bf", "#dccfb3", "#e9dfca", "#d6c7a9", "#cfc0a3", "#ded3bd", "#e6dcc7", "#d2c4a8"],
            "apartment": ["#e1d6c1", "#d8ccb4", "#e8e0cf", "#cdbfa6", "#e5ded2", "#d3c7b2", "#bfae92"],
            "heritage": ["#d9cbac", "#cfbf9e", "#e0d4b9", "#c9b893"],
            "office": ["#d8cfbf", "#c9c2b5", "#e0d8c8", "#bfb7a8", "#a9a49a"],
            "civic": ["#ddd1b8", "#d2c5a9", "#e3d9c4"],
            "retail": ["#e1d6c1", "#d8ccb4", "#e6dcc7"],
            "house": ["#e6ddcc", "#d8c9ad", "#c2a17f", "#e3d6bd"],
        },
    },
}
# a city without an "architecture" key takes its country's rules
BY_COUNTRY = {"AU": "sydney", "JP": "japan", "FR": "paris"}
# and some cities differ from their country: Kyoto keeps machiya and bans lit and rooftop
# signs; Osaka's Minami is the most signed of the four
BY_CITY = {"kyoto": {"machiya": True, "signage": 0.35}, "osaka": {"signage": 1.4}}


PALETTES = {
    "plain": ["#aaa49a", "#bdb6aa", "#9c9a92", "#b2aca0"],
    "house": ["#b9a48f", "#a8826b", "#cfc6b8", "#9e7a66", "#e2ddd2", "#8b5e4b"],
    "terrace": ["#a8705a", "#9c6b52", "#d8cdb8", "#c9b79c", "#e6e0d3", "#8f5f4a", "#b9a88a"],
    "apartment": ["#cfc6b8", "#b9a48f", "#d9d2c3", "#c4b39c", "#e0dbd0", "#a8826b", "#bfb7aa"],
    "office": ["#b4b0a8", "#c9c2b5", "#9c9a92", "#d2cbbd", "#8d8a83", "#bfb8a8"],
    "glass": ["#5d6a73", "#8a949a", "#3e4a52", "#a7adb0", "#6b7a84", "#4f5b60"],
    "heritage": ["#c8a978", "#bf9f70", "#d0b386", "#b8956a"],
    "retail": ["#d2cbbd", "#c9c2b5", "#bdb6aa", "#e0d8c8"],
    "industrial": ["#9aa1a6", "#a8a49c", "#8c8f8f", "#b7b2a6"],
    "civic": ["#c9c2b5", "#b4a48e", "#d6cfc0", "#bcb3a3"],
    "machiya": ["#4a3b2e", "#5a4a3a", "#3f342b"],
    "mixed": ["#d8d4cb", "#c2c3c0", "#e6e3dc", "#a9abaa", "#cfc9bd"],
    "stone": ["#b9ad9c", "#a99d8b"],
    "haussmann": ["#e4d8bf", "#dccfb3", "#d6c7a9", "#e6dcc7"],
}


def region_name(cfg):
    return cfg.get("architecture") or BY_COUNTRY.get(cfg.get("country_code", ""), "default")


def region(cfg):
    """the region's rules with the city's overrides applied"""
    base = dict(REGIONS["default"])
    base["name"] = region_name(cfg)
    reg = REGIONS.get(base["name"], {})
    for k, v in reg.items():
        base[k] = ({**base[k], **v} if isinstance(v, dict) and isinstance(base.get(k), dict) else v)
    for k, v in list(BY_CITY.get(cfg.get("id", ""), {}).items()) + list(cfg.get("architecture_overrides", {}).items()):
        base[k] = ({**base[k], **v} if isinstance(v, dict) and isinstance(base.get(k), dict) else v)
    return base


def unit(seed, salt):
    """a fixed number in [0, 1) for a building and a purpose"""
    x = (seed * 2654435761 + salt * 40503 + 0x9E3779B9) & 0xFFFFFFFF
    x ^= x >> 16
    x = (x * 0x45D9F3B) & 0xFFFFFFFF
    x ^= x >> 16
    return x / 2 ** 32


def draw(probs, u):
    acc = 0.0
    for k, p in probs.items():
        acc += p
        if u < acc:
            return k
    return next(iter(probs))


def roof_group(cls, floors, top, area):
    """which prior a building takes, or a ruled shape: None means flat by rule"""
    if floors >= 5 or top >= 20 or area >= 2000:
        return None
    if cls in COMMERCIAL and area > 600:
        return None
    if cls in SMALL:
        return "small"
    if cls in {"church", "cathedral", "chapel", "synagogue", "temple", "shrine", "mosque"}:
        return "worship"
    if cls == "semidetached_house":
        return "semi" if floors <= 3 else None
    if cls in HOUSE:
        return "house" if floors <= 3 and area < 600 else None
    if cls in TERRACE:
        return "terrace" if floors <= 4 else None
    if cls in FLATS:
        return "flats_low" if floors <= 4 and area < 900 else None
    if cls in HERITAGE or cls in INSTITUTION:
        return "civic_low" if floors <= 3 else None
    if cls in COMMERCIAL:
        return "commercial_low" if floors <= 3 else None
    if not cls:
        return "unknown_low" if top <= 12 and area < 400 else None
    return "unknown_low" if top <= 10 and area < 300 else None


def infer_roof(R, cls, floors, top, area, seed):
    """(shape, source) for a solid whose roof shape is not mapped"""
    g = roof_group(cls, floors, top, area)
    if g is None:
        return "flat", "rule"
    pri = R["roofs"].get(g) or REGIONS["default"]["roofs"].get(g) or {"flat": 1.0}
    return draw(pri, unit(seed, 1)), "prior"


# roof colours by material, (hex, weight): COLORBOND steel (BlueScope's published values;
# weights estimated), terracotta new to weathered, slate, Japanese kawara and sheet metal
ROOF_COLOURS = {
    "metal": [("#323233", 0.22), ("#e4e2d5", 0.15), ("#4b4c46", 0.14), ("#bdbfba", 0.12), ("#6d6c6e", 0.1), ("#888b8a", 0.08),
              ("#b1ada3", 0.05), ("#6c6153", 0.05), ("#5e1d0e", 0.04), ("#e9dcb8", 0.05)],
    "tile": [("#b76248", 0.3), ("#9a4832", 0.3), ("#a8573d", 0.2), ("#6b4f42", 0.1), ("#4a4743", 0.1)],
    "slate": [("#404857", 0.5), ("#4a4f5a", 0.3), ("#3d434c", 0.2)],
    "kawara": [("#6d6d6d", 0.5), ("#474848", 0.3), ("#5a5c5e", 0.2)],
    "copper": [("#4c8479", 1.0)],
    # rolled zinc, weathered to its blue-grey patina; Paris roofers' slate is Angers blue-black
    "zinc": [("#6f7a80", 0.35), ("#7d878c", 0.3), ("#636d73", 0.2), ("#8a9296", 0.15)],
}
JAPAN_METAL = [("#3c3c3c", 0.35), ("#606060", 0.25), ("#4f463e", 0.2), ("#939393", 0.2)]


def roof_colour(R, material, photo_hex, seed, evidence):
    """the roof's colour: its photo median leaned towards the material's own colours,
    a little when the photo showed the material, more when the material was drawn"""
    pal = JAPAN_METAL if material == "metal" and "kawara" in R["pitched_material"] else ROOF_COLOURS.get(material)
    if not pal or not photo_hex or len(photo_hex) != 7:
        return photo_hex
    u, acc, pick = unit(seed, 9), 0.0, pal[-1][0]
    tot = sum(w for _, w in pal)
    for hx, w in pal:
        acc += w / tot
        if u < acc:
            pick = hx
            break
    w = 0.2 if evidence else 0.6
    a = [int(photo_hex[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(pick[i:i + 2], 16) for i in (1, 3, 5)]
    return "#%02x%02x%02x" % tuple(round(x * (1 - w) + y * w) for x, y in zip(a, b))


def roof_material(R, shape, mapped_material, roof_hex, top, seed, group=None):
    """Roof material: the mapped value; else the photo's colour where it is clear
    (terracotta red, or a dark neutral for slate and kawara); else a draw from the
    region's mix for the building's group, since a 1 m photo median is too washed
    out to tell sheet metal from weathered tile."""
    m = {"roof_tiles": "tile", "tile": "tile", "metal": "metal", "slate": "slate", "concrete": "concrete",
         "glass": "glass", "grass": "green", "copper": "copper", "gravel": "gravel", "tar_paper": "membrane",
         "asphalt": "membrane", "eternit": "slate", "stone": "slate", "plants": "green", "thatch": "tile", "zinc": "zinc"}.get(mapped_material or "")
    japan = "kawara" in R["pitched_material"]
    if m:
        return "kawara" if japan and m == "tile" else m  # roof tiles in Japan are kawara, not terracotta
    if shape == "flat":
        u = unit(seed, 7)
        return "gravel" if u < 0.25 else "concrete" if u < 0.55 else "membrane"
    if shape in ("dome", "onion", "spherical"):
        return "copper"
    r, g, b = (int(roof_hex[i:i + 2], 16) / 255 for i in (1, 3, 5)) if roof_hex and len(roof_hex) == 7 else (0.5, 0.5, 0.5)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    if colour_says(R, roof_hex):
        return "tile" if not japan and s > 0.1 else "kawara" if japan else "slate"
    mix = R.get("material_by_group", {}).get(group) or R["pitched_material"]
    return draw(mix, unit(seed, 8))


def colour_says(R, roof_hex):
    """does the photo's colour itself show the material (terracotta red, or a dark neutral)?"""
    if not roof_hex or len(roof_hex) != 7:
        return False
    h, s, v = colorsys.rgb_to_hsv(*(int(roof_hex[i:i + 2], 16) / 255 for i in (1, 3, 5)))
    japan = "kawara" in R["pitched_material"]
    return ((h < 0.1 or h > 0.95) and s > 0.22 and not japan) or (s < 0.1 and v < 0.32)


def roof_height(R, shape, material, half_width, wall_room, mapped):
    """roof height in metres: mapped, else the region's pitch over half the
    building's width, capped so walls keep 2.4 m and roofs stay under the cap"""
    if mapped:
        return min(mapped, max(wall_room - 2.4, 0.0))
    if shape in ("dome", "onion", "spherical"):
        h = half_width * (1.1 if shape == "onion" else 1.0)
    else:
        pitch = R["pitch"].get(material, 25 if shape != "skillion" else 10)
        if shape == "skillion":
            pitch = min(pitch, 12)
            half_width *= 2  # a skillion rises across the whole width
        h = math.tan(math.radians(pitch)) * half_width
    return min(h, max(wall_room - 2.4, 0.0), R["roof_cap_m"] if shape not in ("dome", "onion", "spherical") else 1e9)


def facade_style(R, cls, top, floors, area, facade_material, name, seed, overrides, narrow=False):
    """the facade style; narrow: a footprint at most 7 m wide and at least 2.5 times as deep"""
    if name and name in overrides:
        return overrides[name]
    if cls in NO_WINDOWS or (cls in SMALL and top < 6):
        return "plain"
    if facade_material == "glass" or top >= 80 or (cls in {"office", "commercial"} and top >= 40 and unit(seed, 3) < 0.85):
        return "glass"
    # Paris: a stone block of five to eight floors on a street is a Haussmann building, whatever its use
    if R.get("haussmann") and (cls in FLATS | {"commercial", "retail", "office", ""} or not cls) and 13 <= top <= 38 \
            and (floors or round(top / 3.2)) >= 4 and facade_material in (None, "stone", "plaster") and area >= 80:
        return "haussmann"
    if facade_material in ("stone", "brick") and cls in HERITAGE | {"", None} and top <= 50:
        return "heritage"
    if cls in {"church", "cathedral", "chapel", "synagogue", "temple", "shrine", "mosque"}:
        return "civic" if R.get("name") == "japan" else "heritage"
    if cls in HERITAGE:
        return "heritage" if top <= 50 else "office"
    if R.get("machiya") and (cls in HOUSE | TERRACE or not cls) and narrow and (floors or 2) <= 2 and top <= 9:
        return "machiya"
    if cls in HOUSE:
        return "house"
    if cls in TERRACE:
        return "terrace"
    if cls in FLATS:
        return "apartment"
    if R.get("name") == "japan" and cls in {"commercial", "retail"} and 3 <= (floors or top / 3.3) <= 10 and top < 40:
        return "mixed"
    if cls in {"office", "commercial"}:
        return "office"
    if cls in {"retail", "supermarket"}:
        return "retail" if top < 12 else "office"
    if cls in {"industrial", "warehouse", "manufacture"}:
        return "industrial"
    if cls in INSTITUTION:
        return "civic"
    if cls in SMALL:
        return "plain"
    # no class: judge by size (in Japan most buildings carry no class at all)
    if top < 10 and area < 250 or R.get("name") == "japan" and top < 10.5 and area < 300:
        return "house"
    if R.get("name") == "japan" and top < 40:
        u = unit(seed, 4)
        return "mixed" if u < 0.3 else "apartment" if u < 0.8 else "office"
    if top >= 40:
        return "glass" if unit(seed, 3) < 0.5 else "office"
    if top >= 15:
        return "office" if unit(seed, 4) < 0.5 else "apartment"
    return "apartment" if unit(seed, 4) < 0.6 else "office"


# eaves past the walls on pitched roofs, metres: Federation houses 0.45-0.6, shallow on
# terraces between party walls, deep (0.6-0.9) on machiya
OVERHANG = {"house": 0.45, "terrace": 0.25, "apartment": 0.35, "civic": 0.35, "heritage": 0.3, "office": 0.3, "retail": 0.3,
            "industrial": 0.3, "plain": 0.15, "machiya": 0.75, "mixed": 0.3, "haussmann": 0.45}

STOREY = {"plain": 3.0, "house": 2.9, "terrace": 3.2, "apartment": 3.0, "office": 3.8, "glass": 3.9, "heritage": 4.6,
          "retail": 4.2, "industrial": 6.0, "civic": 4.0, "machiya": 2.9, "mixed": 3.3, "stone": 4.0, "haussmann": 3.05}
# the tallest storey a style takes from a floor count; above the top floor the rest of the
# wall is attic or parapet (a residential floor-count height includes 2.8 m of roof)
STOREY_MAX = {"plain": 6.0, "house": 3.3, "terrace": 3.5, "apartment": 3.3, "office": 4.4, "glass": 4.5, "heritage": 5.5,
              "retail": 5.0, "industrial": 8.0, "civic": 5.0, "machiya": 3.2, "mixed": 3.8, "stone": 6.0, "haussmann": 3.4}
STOREFRONT_STYLES = {"office", "glass", "retail", "apartment", "heritage", "mixed", "haussmann"}


def storeys(style, wall_h, floors, storefront):
    """(storey height, ground-floor height) that fit the wall height and floor count"""
    s0 = STOREY[style]
    g_extra = 1.1 if storefront else (0.6 if style in ("office", "glass", "heritage", "civic") else 0.0)
    if style == "haussmann":  # the shop and its entresol share one tall stone base
        g_extra = 2.6 if storefront else 1.2
    if floors and floors > 0:
        if floors == 1:
            return round(min(max(wall_h, 2.6), 8.0), 2), round(min(max(wall_h, 2.6), 8.0), 2)
        s = min((wall_h - g_extra) / floors, STOREY_MAX[style])
        if 2.5 <= s:
            return round(s, 2), round(s + g_extra, 2)
    n = max(1, round((wall_h - g_extra) / s0))
    s = (wall_h - g_extra) / n
    s = min(max(s, 2.6), 6.5)
    return round(s, 2), round(s + g_extra, 2)


def jitter(hex_colour, seed):
    """a per-building colour variation: hue +-0.015, saturation +-8%, value +-9%"""
    r, g, b = (int(hex_colour[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    h = (h + (unit(seed, 11) - 0.5) * 0.03) % 1
    s = min(max(s * (1 + (unit(seed, 12) - 0.5) * 0.16), 0), 1)
    v = min(max(v * (1 + (unit(seed, 13) - 0.5) * 0.18), 0), 1)
    return "#%02x%02x%02x" % tuple(int(round(c * 255)) for c in colorsys.hsv_to_rgb(h, s, v))


def frontages(ring, roads, max_d=14.0, main_only=False):
    """edges of a footprint ring (n, 2) that face a road within max_d metres:
    a list of edge indices. roads: a cKDTree over road sample points, their unit
    directions and whether each is a main street"""
    tree, dirs, pts, main = roads
    out = []
    n = len(ring)
    for k in range(n):
        a, b = ring[k], ring[(k + 1) % n]
        d = b - a
        L = math.hypot(*d)
        if L < 3.0:
            continue
        mid = (a + b) / 2
        nrm = np.array([d[1], -d[0]]) / L  # outward for an anticlockwise ring
        probe = mid + nrm * max_d * 0.5
        dist, j = tree.query(probe)
        if dist > max_d * 0.6:
            continue
        to_road = pts[j] - mid
        if to_road @ nrm < 2.0:
            continue
        if abs(dirs[j] @ (d / L)) < 0.75:  # the road runs along this edge
            continue
        if main_only and not main[j]:
            continue
        out.append(k)
    return out
