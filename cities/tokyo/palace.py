"""The Imperial Palace (宮殿, Kyūden, 1968, Yoshimura Junzō): its wings round their courts under broad green
copper roofs, in place of the boxes OpenStreetMap's 43 parts build (relation 1968066).

The wings are the union of the mapped parts' footprints, their courts the holes in it. Each wing has pale
walls to its eaves at 9 m (the mapped parts' walls) and a hipped roof of equal pitches that follows every
turn of the outline (archkit.outline_roof), its broad eaves 2.4 m out, rising to the mapped tops of 15 to
17 m (the Seiden, the hall of state, highest). The roofs are copper gone green; the walls the pale
concrete and the bronze-framed glass of the photographs (Imperial Household Agency).
"""
import numpy as np

import archkit as ak

OSM = "r1968066"
EAVE = 9.0          # m over the ground: the mapped parts' walls
OVER = 2.4          # m, the eaves out from the walls
MATERIALS = {
    "kyuden_copper": {"color": "#5f8b7b", "roughness": 0.55, "metalness": 0.35},
    "kyuden_wall": {"color": "#d6d0c2", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffe2b8", "glow": 0.18},
    "kyuden_soffit": {"color": "#8a7a62", "roughness": 0.8, "metalness": 0.0},
    "kyuden_base": {"color": "#9c968a", "roughness": 0.92, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.5, "block_m": 1.1},
}


def meshes():
    """(materials, meshes, hidden solids)."""
    import shapely
    from shapely.geometry import Polygon
    parts = [s for s in ak.load_solids("tokyo") if s["osm"] == OSM]
    if not parts:
        return {}, [], []
    polys = [Polygon(s["ring"], s["holes"]).buffer(0) for s in parts]
    wings = shapely.union_all([p.buffer(0.3, join_style="mitre") for p in polys]).buffer(-0.3, join_style="mitre")
    K = ak.Kit("kyuden", floodlit={"kyuden_wall"}, uv={"kyuden_base"})
    for wing in getattr(wings, "geoms", [wings]):
        if wing.geom_type != "Polygon" or wing.area < 50:
            continue
        mine = [s for s, p in zip(parts, polys) if p.intersects(wing)]
        g = float(np.median([s["ground"] for s in mine]))
        g0 = min(s["ground"] for s in mine)
        top = max(s["ground"] + s["top"] for s in mine)
        w = 2 * wing.area / max(wing.length, 1.0)     # the wing's mean width
        rings = [ak.simplify(list(wing.exterior.coords), 0.4)] + [ak.simplify(list(h.coords), 0.4) for h in wing.interiors if Polygon(h).area > 20]
        for r in rings:
            ak.prism(K["kyuden_base"], ak.WORLD, r, g0 - 0.5, g + 0.8, top=False)
            ak.prism(K["kyuden_wall"], ak.WORLD, r, g + 0.8, g + EAVE - 0.3, top=False)
        rise = float(np.clip(top - (g + EAVE), 2.5, 0.42 * (w + 2 * OVER)))
        ak.outline_roof(K["kyuden_copper"], rings[0], g + EAVE, 0.62, over=OVER, rise_max=rise, k=1.25, holes=rings[1:],
                        soffit=K["kyuden_soffit"], wall_z=g + EAVE - 0.3, cell=2.5)
    return MATERIALS, K.out(), [s["si"] for s in parts]
