"""Tokyo's hero level: Tokyo Station's Marunouchi building, where the game starts (docs/HERO.md).

The building is generated once, by cities/tokyo/station.py, at two levels. Its landmark model (level "far") is
what the map and the viewer hold at every distance. This is the other (level "hero"): the same walls with every
frame, sash, baluster and bracket, edges chamfered, the occlusion of recesses and eaves and the floodlights'
light baked into the vertices, on scanned brick, cast stone and slate; streamed by web/game/hero.js when the
player is near and let go when they leave, its finest parts a model of their own that a phone never fetches.
The forecourt's ground stays the landmark model's.

    python blender/build_hero.py --city tokyo
"""
import importlib.util
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(HERE)), "pipeline"))
ID = "marunouchi"

# CC0 surfaces (ambientCG) this level adds to the kit's: id, metres one repeat covers
TEXTURES = {
    "tks_brick": ("Bricks059", 0.85),          # even red facing brick in stretcher bond, pale joints
    "tks_slate": ("RoofingTiles014A_grey", 2.2),   # rectangular roofing tiles in courses, their fired red taken out (below)
}
# the station's materials (station.py MATERIALS) as the kit's: by hero.js's names (lamp*: lit as dusk falls)
MAT = {
    "tks_brick": "wall_brick", "tks_reveal": "wall_brick", "tks_stone": "stone_cast", "tks_stone_fine": "stone_plain",
    "tks_slate": "roof_slate", "tks_copper": "metal_copper", "tks_pent": "metal_pent", "tks_soffit": "lamp_soffit",
    "tks_sash": "paint_sash", "tks_glass": "lamp_room", "tks_glass_dark": "glass_dark", "tks_glass_small": "glass_dark",
    "tks_door": "lamp_door", "tks_clock": "lamp_clock", "tks_sign": "lamp_sign", "tks_iron": "metal_iron",
    "tks_iron_fine": "metal_iron", "tks_canopy": "paint_canopy",
    # the dome halls (station.hall)
    # (room*: lit by its own lamps by day as well, web/game/hero.js)
    "tks_hall_wall": "room_plaster", "tks_hall_white": "room_white", "tks_hall_relief": "room_relief", "tks_hall_stone": "room_stone",
    "tks_hall_green": "room_green", "tks_hall_rib": "room_rib", "tks_hall_ceiling": "room_ceiling", "tks_hall_light": "room_tube", "tks_hall_day": "room_day",
    "tks_hall_floor_a": "room_floor_a", "tks_hall_floor_b": "room_floor_b", "tks_hall_floor_c": "room_floor_c",
}
FINE_OK = ("stone_plain", "paint_sash", "metal_iron", "stone_bench", "room_relief")   # plain materials: what the fine model may carry
REPEAT = {"wall_brick": 0.85, "roof_slate": 2.2}


def materials(K):
    T = K.tint_to
    return {
        "wall_brick": {"tex": "tks_brick", "tint": T("tks_brick", (150, 80, 58)), "rough": 0.85, "bump": 1.0},
        # (cast stone is even in tone: a scanned concrete's mottling read as blotches on it, so it is its colour alone)
        "stone_cast": {"color": (0.66, 0.5, 0.36), "rough": 0.78},
        "stone_plain": {"color": (0.66, 0.5, 0.36), "rough": 0.78},
        "stone_bench": {"color": (0.42, 0.41, 0.39), "rough": 0.6},
        "roof_slate": {"tex": "tks_slate", "tint": T("tks_slate", (62, 62, 66)), "rough": 0.85, "maps": "cn", "bump": 0.5},
        "metal_copper": {"color": (0.085, 0.12, 0.105), "rough": 0.45, "metal": 0.6},
        "metal_pent": {"color": (0.1, 0.07, 0.05), "rough": 0.45, "metal": 0.6},
        "metal_iron": {"color": (0.02, 0.022, 0.025), "rough": 0.45, "metal": 0.7},
        "paint_sash": {"color": (0.82, 0.8, 0.74), "rough": 0.5},
        "paint_canopy": {"color": (0.72, 0.72, 0.7), "rough": 0.4, "metal": 0.2},
        "glass_dark": {"color": (0.014, 0.02, 0.026), "rough": 0.06, "metal": 0.7},
        "lamp_room": {"color": (0.014, 0.02, 0.026), "rough": 0.06, "metal": 0.7, "emissive": (1.0, 0.66, 0.34), "glow": 1.1},
        "lamp_door": {"color": (0.014, 0.02, 0.026), "rough": 0.06, "metal": 0.7, "emissive": (1.0, 0.7, 0.38), "glow": 2.2},
        "lamp_soffit": {"color": (0.7, 0.66, 0.58), "rough": 0.8, "emissive": (1.0, 0.72, 0.42), "glow": 0.8},
        "lamp_clock": {"color": (0.86, 0.82, 0.72), "rough": 0.5, "emissive": (1.0, 0.86, 0.62), "glow": 1.6},
        "lamp_sign": {"map": "atlas", "rough": 0.5, "emissive": True, "glow": 1.0},
        # the halls: yolk-yellow plaster, white mouldings and reliefs, pale stone, the roundels' green, lit ceilings
        "room_plaster": {"color": (0.69, 0.46, 0.11), "rough": 0.85},
        "room_white": {"color": (0.81, 0.77, 0.67), "rough": 0.7},
        "room_relief": {"color": (0.81, 0.77, 0.67), "rough": 0.7},
        "room_stone": {"color": (0.6, 0.54, 0.44), "rough": 0.6},
        "room_green": {"color": (0.27, 0.36, 0.28), "rough": 0.8},
        "room_rib": {"color": (0.14, 0.04, 0.022), "rough": 0.7},
        "room_floor_a": {"color": (0.6, 0.56, 0.48), "rough": 0.35},
        "room_floor_b": {"color": (0.27, 0.26, 0.24), "rough": 0.35},
        "room_floor_c": {"color": (0.045, 0.045, 0.05), "rough": 0.3},
        "room_ceiling": {"color": (0.86, 0.81, 0.7), "rough": 0.8, "emissive": (1.0, 0.8, 0.52), "glow": 0.5},
        "room_tube": {"color": (0.92, 0.86, 0.74), "rough": 0.4, "emissive": (1.0, 0.76, 0.46), "glow": 2.0},
        "room_day": {"color": (0.58, 0.67, 0.72), "rough": 0.2, "emissive": (0.6, 0.72, 0.82), "glow": 0.25},
    }


def grey_slate(K):
    """ambientCG's RoofingTiles014A is a fired clay tile; slate has its relief and courses, not its colour. A tint
    cannot take a hue out (the sunlit side still read pink), so the colour image is made grey once, as a texture
    of its own beside the source in data/raw, with the source's normal and roughness."""
    import shutil
    from PIL import Image
    K.TEXTURES["_tile_src"] = ("RoofingTiles014A", 2.2)
    src = K.fetch_texture("_tile_src")
    d = os.path.join(K.TEX_DIR, "RoofingTiles014A_grey")
    os.makedirs(d, exist_ok=True)
    col = os.path.join(d, "RoofingTiles014A_grey_1K-JPG_Color.jpg")
    if not os.path.exists(col):
        Image.open(src["Color"]).convert("L").convert("RGB").save(col, quality=92)
        for k in ("NormalGL", "Roughness"):
            shutil.copy(os.path.join(os.path.dirname(src["Color"]), f"RoofingTiles014A_1K-JPG_{k}.jpg"), os.path.join(d, f"RoofingTiles014A_grey_1K-JPG_{k}.jpg"))
    del K.TEXTURES["_tile_src"]


def build(K):
    """(geo, atlas, materials, meta) for blender/build_hero.py."""
    grey_slate(K)
    K.TEXTURES.update(TEXTURES)
    spec = importlib.util.spec_from_file_location("tokyo_station", os.path.join(HERE, "station.py"))
    ST = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ST)
    _mats, meshes, _hidden, _trees, _props = ST.meshes(level="hero")
    geo = K.Geo()
    g_z = None
    for m in meshes:
        if m.mat in ST.GROUND or m.mat not in MAT:
            continue
        key = MAT[m.mat]
        fine = bool(getattr(m, "detail", False)) and key in FINE_OK
        P = np.asarray(m.v, float)
        tri = np.asarray(m.i, int).reshape(-1, 3)
        # normals: each face's own, summed at the vertices it shares (a quad's two triangles, a lathe's rings)
        fn = np.cross(P[tri[:, 1]] - P[tri[:, 0]], P[tri[:, 2]] - P[tri[:, 0]])
        keep = np.linalg.norm(fn, axis=1) > 1e-7   # (a sliver left where a floor's figure was cut on the ground's triangles has no face)
        tri, fn = tri[keep], fn[keep]
        if not len(tri):
            continue
        N = np.zeros_like(P)
        for k in range(3):
            np.add.at(N, tri[:, k], fn)
        ln = np.linalg.norm(N, axis=1)
        N = N / np.where(ln > 1e-9, ln, 1.0)[:, None]
        uv = np.asarray(m.t, float) if len(m.t) == len(m.v) else P[:, :2]
        if key in REPEAT:
            uv = uv / REPEAT[key]
        ao = np.ones(len(P))
        for i, v in getattr(m, "ao", {}).items():
            ao[i] = v
        ao = np.where(N[:, 2] < -0.5, np.minimum(ao, 0.72), ao)   # (what faces down sees little sky)
        (geo.fine if fine else geo).mesh(key, P, [tuple(t) for t in tri], n=N, uv=uv, ao=ao)
        g_z = float(P[:, 2].min()) if g_z is None else min(g_z, float(P[:, 2].min()))
    # the floodlights at the foot of each bay (LPA's 2012 scheme, warm): small lights tilted up at the wall
    for x, y, z, nx, ny in ST.FLOODS:
        n = np.array([-nx * 0.5, -ny * 0.5, 0.87])
        geo.emitters.append((np.array([x, y, z]), n / np.linalg.norm(n), 0.5, np.array([1.0, 0.7, 0.42]) * 150.0))
    # the halls' lamps: on the first cornice and under the drum, and down the vestibules' ceilings
    # (each shines every way: down on the floor, up into the dome, and across onto the walls, as a cove's light does
    # once it has bounced)
    for x, y, z, power in ST.LAMPS:
        for d, k in (((0.0, 0.0, -1.0), 1.0), ((0.0, 0.0, 1.0), 0.6), ((1.0, 0.0, 0.0), 0.5), ((-1.0, 0.0, 0.0), 0.5), ((0.0, 1.0, 0.0), 0.5), ((0.0, -1.0, 0.0), 0.5)):
            geo.emitters.append((np.array([x, y, z]), np.array(d), 0.6, np.array([1.0, 0.8, 0.56]) * power * k))
    # the transport plazas at real sizes: a pole with its round sign and timetable at each mapped stand, and granite
    # benches under the shelters (plain materials, in the fine model: a phone goes without them)
    F = geo.fine
    for x, y, z in ST.STOPS:
        F.tube("metal_iron", [(x, y, z), (x, y, z + 2.75)], 0.035, segs=6)
        F.box("paint_sash", (x, y, z + 2.25), ((1, 0), (0, 1)), (0.46, 0.04, 0.46))
        F.box("paint_sash", (x, y, z + 1.15), ((1, 0), (0, 1)), (0.36, 0.05, 0.62))
        F.cylinder("metal_iron", (x, y, z), 0.16, 0.06, segs=10)
    for x, y, z, h in ST.BENCHES:
        ax = ((np.cos(h), np.sin(h)), (-np.sin(h), np.cos(h)))
        F.box("stone_bench", (x, y, z + 0.34), ax, (1.9, 0.46, 0.1))
        for s in (-0.7, 0.7):
            F.box("stone_bench", (x + ax[0][0] * s, y + ax[0][1] * s, z), ax, (0.12, 0.4, 0.34))
    atlas = K.Atlas(size=1024, height=256)
    atlas.cell("signs", 1024, 256, lambda img, r: img.paste(ST.sign_image(), (r[0], r[1])))
    P_all = np.concatenate([np.asarray(g["p"], float) for g in geo.parts.values()])
    c = (P_all[:, :2].min(0) + P_all[:, :2].max(0)) / 2
    r = float(np.linalg.norm(P_all[:, :2].max(0) - P_all[:, :2].min(0)) / 2)
    meta = {"id": ID, "at": [round(float(c[0]), 1), round(float(c[1]), 1)], "r": round(r, 0), "z": round(g_z or 3.0, 1),
            "glb": f"hero/{ID}.glb", "fine": f"hero/{ID}_fine.glb", "cell": 48.0, "fine_cell": 24.0, "bake_gain": 1.0,
            "sky_rays": 12, "sky_reach": 4.0, "sky_strength": 0.8}   # (the sky's light occluded, ray-cast: hero_kit.sky_occlusion, in place of the corners' rule of thumb)
    return geo, atlas, materials(K), meta
