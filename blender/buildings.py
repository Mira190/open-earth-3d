"""The buildings of a city for the Blender twin: the walls, LOD2 roofs, parapets,
rooftop plant and awnings that web/buildings.js draws, from the same
buildings.json, and a facade shader built from nodes. Floors follow each
building's storey and ground-floor heights, every wall run between sharp corners
holds a whole number of bays, and windows are punched, curtain wall or shopfront
by style; at night a share of rooms is lit (set_lighting, per view).

The style tables mirror web/buildings.js; change both together.
"""
import base64
import math

import bpy
import numpy as np
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

STYLES = ["plain", "house", "terrace", "apartment", "office", "glass", "heritage", "retail", "industrial", "civic",
          "machiya", "mixed", "stone"]
# bay width m, window width (share of a bay), sill and head (shares of a storey)
GRID = {"plain": (0, 0, 0, 0), "house": (3.3, 0.42, 0.3, 0.8), "terrace": (2.8, 0.44, 0.24, 0.86), "apartment": (3.0, 0.5, 0.27, 0.86),
        "office": (3.0, 0.68, 0.25, 0.9), "glass": (1.5, 1.0, 0.0, 1.0), "heritage": (3.6, 0.4, 0.22, 0.84), "retail": (4.2, 0.42, 0.34, 0.8),
        "industrial": (6.0, 0.72, 0.64, 0.88), "civic": (3.6, 0.88, 0.32, 0.8), "machiya": (1.8, 0.72, 0.3, 0.76),
        "mixed": (2.8, 0.7, 0.22, 0.86), "stone": (0, 0, 0, 0)}
REGION_GRID = {"japan": {"house": (1.82, 0.62, 0.3, 0.8), "terrace": (1.82, 0.7, 0.28, 0.82), "apartment": (3.6, 0.76, 0.02, 0.86),
                         "office": (3.2, 0.7, 0.22, 0.88), "mixed": (2.8, 0.74, 0.2, 0.86), "machiya": (1.97, 0.86, 0.3, 0.82)}}
PARAPET = {"office": 1.1, "glass": 1.2, "apartment": 1.0, "heritage": 1.3, "retail": 0.9, "civic": 1.0, "mixed": 1.0, "industrial": 0.5}
LEVELS = [0, 8, 24, 48, 96, 192, 384]


def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def inset(r, d):
    """inward mitre offset of a ring (n, 2); None if it folds (as web/buildings.js inset)"""
    n = len(r)
    out = np.zeros_like(r)
    for k in range(n):
        a, b = r[k] - r[k - 1], r[(k + 1) % n] - r[k]
        la, lb = np.hypot(*a), np.hypot(*b)
        if la < 1e-6 or lb < 1e-6:
            return None
        n1, n2 = np.array([-a[1], a[0]]) / la, np.array([-b[1], b[0]]) / lb
        m = n1 + n2
        ml = np.hypot(*m)
        if ml < 1e-6:
            return None
        m /= ml
        c = m @ n1
        if c < 0.35:
            return None
        out[k] = r[k] + m * d / c
    area = lambda q: 0.5 * float(np.dot(q[:, 0], np.roll(q[:, 1], -1)) - np.dot(np.roll(q[:, 0], -1), q[:, 1]))
    for k in range(n):
        if (r[(k + 1) % n] - r[k]) @ (out[(k + 1) % n] - out[k]) <= 0:
            return None
    a0, a1 = area(r), area(out)
    return out if np.sign(a0) == np.sign(a1) and abs(a1) > 0.25 * abs(a0) else None


class Geo:
    """vertices, faces and per-vertex attributes for one mesh object"""

    def __init__(self):
        self.v, self.f, self.col, self.fac, self.win, self.flr, self.rnd, self.nfl = [], [], [], [], [], [], [], []

    def add(self, p, col, fac=(0, 0), win=(0, 0, 0, -1), flr=(3, 3, 0, 0), rnd=0.0, nfl=0.0):
        self.v.append(tuple(p))
        self.col.append(list(col) + [1])
        self.fac.append(fac)
        self.win.append(win)
        self.flr.append(flr)
        self.rnd.append(rnd)
        self.nfl.append(nfl)
        return len(self.v) - 1

    def object(self, name, mat):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        for nm, data, kind in (("col", self.col, "FLOAT_COLOR"), ("win", self.win, "FLOAT_COLOR"), ("flr", self.flr, "FLOAT_COLOR")):
            a = me.color_attributes.new(nm, kind, "POINT")
            a.data.foreach_set("color", np.asarray(data, np.float32).ravel())
        a = me.attributes.new("fac", "FLOAT2", "POINT")
        a.data.foreach_set("vector", np.asarray(self.fac, np.float32).ravel())
        for nm, data in (("rnd", self.rnd), ("nfl", self.nfl)):
            a = me.attributes.new(nm, "FLOAT", "POINT")
            a.data.foreach_set("value", np.asarray(data, np.float32))
        me.validate()
        ob = bpy.data.objects.new(name, me)
        ob.data.materials.append(mat)
        bpy.context.collection.objects.link(ob)
        return ob


def _node(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def _math(nt, op, a, b=None):
    n = _node(nt, "ShaderNodeMath", operation=op)
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            n.inputs[i].default_value = x
        else:
            nt.links.new(x, n.inputs[i])
    return n.outputs[0]


def facade_material():
    """walls: wall colour, or glass where the facade grid puts a window; lit rooms at night"""
    mat = bpy.data.materials.new("facades")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = _node(nt, "ShaderNodeOutputMaterial")
    attr = lambda name: _node(nt, "ShaderNodeAttribute", attribute_name=name)
    fac, flr, win, rnd, col = attr("fac"), attr("flr"), attr("win"), attr("rnd"), attr("col")
    sx = _node(nt, "ShaderNodeSeparateXYZ")
    nt.links.new(fac.outputs["Vector"], sx.inputs[0])
    s, h = sx.outputs[0], sx.outputs[1]
    sf = _node(nt, "ShaderNodeSeparateXYZ")
    nt.links.new(flr.outputs["Vector"], sf.inputs[0])
    storey, ground, nb, shop = sf.outputs[0], sf.outputs[1], sf.outputs[2], flr.outputs["Alpha"]
    sw = _node(nt, "ShaderNodeSeparateXYZ")
    nt.links.new(win.outputs["Vector"], sw.inputs[0])
    ww, sill, head, mode = sw.outputs[0], sw.outputs[1], sw.outputs[2], win.outputs["Alpha"]
    M = lambda op, a, b=None: _math(nt, op, a, b)
    lt = M("LESS_THAN", h, ground)
    q = M("ADD", M("MULTIPLY", lt, M("DIVIDE", h, ground)),
          M("MULTIPLY", M("SUBTRACT", 1.0, lt), M("ADD", 1.0, M("DIVIDE", M("SUBTRACT", h, ground), storey))))
    fy, fl, fx, bay = M("FRACT", q), M("FLOOR", q), M("FRACT", s), M("FLOOR", s)
    inrun = M("MULTIPLY", M("GREATER_THAN", s, 0.0), M("LESS_THAN", s, nb))
    punch = M("MULTIPLY", M("MULTIPLY", M("LESS_THAN", M("ABSOLUTE", M("SUBTRACT", fx, 0.5)), M("MULTIPLY", ww, 0.5)),
                            M("GREATER_THAN", fy, sill)), M("LESS_THAN", fy, head))
    curt = M("MULTIPLY", M("MULTIPLY", M("GREATER_THAN", fx, 0.035), M("LESS_THAN", fx, 0.965)), M("GREATER_THAN", fy, 0.24))
    is_curt = M("GREATER_THAN", mode, 0.5)
    shopw = M("MULTIPLY", M("MULTIPLY", M("LESS_THAN", fl, 0.5), shop),
              M("MULTIPLY", M("MULTIPLY", M("GREATER_THAN", fx, 0.05), M("LESS_THAN", fx, 0.95)),
                M("MULTIPLY", M("GREATER_THAN", fy, 0.06), M("LESS_THAN", fy, 0.8))))
    grid = M("MAXIMUM", M("ADD", M("MULTIPLY", punch, M("SUBTRACT", 1.0, is_curt)), M("MULTIPLY", curt, is_curt)), shopw)
    nfl = attr("nfl")
    on_floor = M("LESS_THAN", fl, M("SUBTRACT", nfl.outputs["Fac"], 0.5))
    w = M("MULTIPLY", M("MULTIPLY", M("MULTIPLY", grid, inrun), M("GREATER_THAN", mode, -0.5)), on_floor)
    # lit rooms: a fixed random number per window against the share occupied now
    cell = _node(nt, "ShaderNodeCombineXYZ")
    nt.links.new(bay, cell.inputs[0])
    nt.links.new(fl, cell.inputs[1])
    nt.links.new(M("MULTIPLY", rnd.outputs["Fac"], 997.0), cell.inputs[2])
    noise = _node(nt, "ShaderNodeTexWhiteNoise", noise_dimensions="3D")
    nt.links.new(cell.outputs[0], noise.inputs["Vector"])
    occ = _node(nt, "ShaderNodeValue", name="occupancy", label="occupancy")
    night = _node(nt, "ShaderNodeValue", name="night", label="night")
    lit = M("MULTIPLY", M("LESS_THAN", noise.outputs["Value"], occ.outputs[0]), night.outputs[0])
    wall = _node(nt, "ShaderNodeBsdfPrincipled")
    nt.links.new(col.outputs["Color"], wall.inputs["Base Color"])
    wall.inputs["Roughness"].default_value = 0.85
    glass = _node(nt, "ShaderNodeBsdfPrincipled")
    glass.inputs["Base Color"].default_value = (0.05, 0.06, 0.07, 1)
    glass.inputs["Roughness"].default_value = 0.06
    nt.links.new(M("ADD", 0.12, M("MULTIPLY", is_curt, 0.55)), glass.inputs["Metallic"])
    glass.inputs["Emission Color"].default_value = (1.0, 0.7, 0.42, 1)
    nt.links.new(M("MULTIPLY", lit, 0.7), glass.inputs["Emission Strength"])
    mix = _node(nt, "ShaderNodeMixShader")
    nt.links.new(w, mix.inputs[0])
    nt.links.new(wall.outputs[0], mix.inputs[1])
    nt.links.new(glass.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    return mat


def simple(name, colour=None, rough=0.8, metal=0.0, vcol=False, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if colour:
        bsdf.inputs["Base Color"].default_value = (*lin(colour), 1)
    if vcol:
        a = _node(nt, "ShaderNodeAttribute", attribute_name="col")
        nt.links.new(a.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def set_lighting(hour, night):
    """the share of rooms lit at this local hour (offices and homes together) and whether it is night"""
    mat = bpy.data.materials.get("facades")
    if not mat:
        return
    work = max(0.0, min(1.0, (hour - 7) / 1.5)) * max(0.0, min(1.0, (20 - hour) / 2))
    evening = max(0.0, min(1.0, (hour - 17) / 2)) * max(0.0, min(1.0, (24 - hour) / 1.5)) + (0.5 if hour < 1.5 else 0.0)
    mat.node_tree.nodes["occupancy"].outputs[0].default_value = 0.05 + 0.35 * work + 0.3 * evening
    mat.node_tree.nodes["night"].outputs[0].default_value = 1.0 if night else 0.0


def unpack_roof(r):
    """a shipped roof row to [solid, top, eave, shape, xyz (absolute dm, flat), triangles (flat), n_roof]"""
    if len(r) != 9 or not isinstance(r[6], str):
        return r
    q = np.frombuffer(base64.b64decode(r[6]), "<i2").astype(np.int64).reshape(-1, 3)
    q[:, 0] += r[4]
    q[:, 1] += r[5]
    tri = np.frombuffer(base64.b64decode(r[7]), "<u2" if len(q) > 255 else "u1").astype(np.int64)
    return r[:4] + [q.ravel(), tri, r[8]]


def add_buildings(B, scene, small=False):
    """the buildings as four objects (facades, roofs, trim, rooftop plant); returns triangle counts"""
    meta, solids = B["b"], B["s"]
    has_style = "style" in B.get("fields", [])
    region = scene["city"].get("architecture", "")
    grids = {**GRID, **REGION_GRID.get(region, {})}
    roof_of = {r[0]: unpack_roof(r) for r in B.get("r", [])}
    front_of = {f[0]: dict(zip(f[1::2], f[2::2])) for f in B.get("f", [])}
    walls, roofs, trim = Geo(), Geo(), Geo()
    deck = {}

    def info(bi):
        m = meta[bi]
        style = (B["styles"][m[10]] if isinstance(m[10], int) else m[10]) if has_style else "apartment"
        storey = m[11] if has_style else 3.2
        ground = m[12] if has_style else 3.6
        seed = (m[14] if has_style else bi * 2654435761 % 65535) % 997 / 997
        return style, storey, ground, seed, lin(m[7] or "#bdb6aa"), lin(m[8] or "#8d8f8f")

    for si, s in enumerate(solids):
        bi = s[0]
        style, storey, ground, seed, wall_c, roof_c = info(bi)
        g0, zb, zt = s[1] / 10, (s[1] + s[2]) / 10, (s[1] + s[3]) / 10
        rings = [np.asarray(r, float).reshape(-1, 2) / 10 for r in s[4:]]
        r = roof_of.get(si)
        eave = max(g0 + r[2] / 10, zb + 0.1) if r else zt
        windows = style not in ("plain", "stone") and meta[bi][4] != "parametric"
        g = grids.get(style, GRID["plain"])
        bay_w = g[0] * (0.92 + 0.16 * seed)
        mode = 1.0 if style == "glass" else 0.0
        fronts = front_of.get(si, {})
        for o, ring in enumerate(rings):
            n = len(ring)
            d = np.roll(ring, -1, axis=0) - ring
            L = np.hypot(d[:, 0], d[:, 1])
            e = d / np.maximum(L, 1e-9)[:, None]
            sharp = [(e[k - 1] @ e[k]) < 0.866 or L[k] < 0.05 or L[k - 1] < 0.05 for k in range(n)]
            start = sharp.index(True) if any(sharp) else 0
            runs = []
            for t in range(n):
                k = (start + t) % n
                if t == 0 or sharp[k]:
                    runs.append([])
                runs[-1].append(k)
            levels = [zb + lv for lv in LEVELS if lv < eave - zb] + [eave]
            for run in runs:
                total = float(sum(L[k] for k in run))
                nb = math.floor((total - 1.2) / bay_w + 0.5) if bay_w > 0 and windows else 0
                ht = eave - g0
                q_top = ht / ground if ht < ground else 1 + (ht - ground) / storey
                n_floors = max(0, math.floor(q_top - g[3] + 1 + 1e-3))
                facade = nb >= 1 and eave - zb >= 2.2
                scale = nb / (total - 1.2) if facade else 1.0
                u = 0.0
                for k in run:
                    if L[k] < 0.05:
                        continue
                    a, b = ring[k], ring[(k + 1) % n]
                    s0 = (u - 0.6) * scale if facade else u
                    s1 = (u + L[k] - 0.6) * scale if facade else u + L[k]
                    shop = 1.0 if o == 0 and fronts.get(k, 0) & 1 else 0.0
                    win = (g[1], g[2], g[3], mode) if facade else (0, 0, 0, -1)
                    prev = None
                    for z in levels:
                        ia = walls.add((a[0], a[1], z), wall_c, (s0, z - g0), win, (storey, ground, nb, shop), seed, n_floors)
                        ib = walls.add((b[0], b[1], z), wall_c, (s1, z - g0), win, (storey, ground, nb, shop), seed, n_floors)
                        if prev:
                            walls.f.append((prev[0], prev[1], ib, ia))
                        prev = (ia, ib)
                    u += L[k]
        if r:  # the pipeline's roof mesh: roof faces, then gable walls
            pos = np.asarray(r[4], float).reshape(-1, 3) / 10
            pos[:, 2] += g0
            tri = np.asarray(r[5], int).reshape(-1, 3)
            for t, (i, j, k) in enumerate(tri):
                tgt, c = (roofs, roof_c) if t < r[6] else (walls, wall_c)
                ids = [tgt.add(pos[q], c) for q in (i, j, k)]
                tgt.f.append(tuple(ids))
            continue
        # flat roof: a parapet round a deck where the building is big enough
        par = PARAPET.get(style, 0) if s[3] - s[2] >= 50 and not small else 0
        inner = [inset(q, 0.3) for q in rings] if par else None
        if inner and any(x is None for x in inner):
            inner = None
        zd = zt - par if inner else zt
        loops = [[Vector((p[0], p[1], zd)) for p in q] for q in (inner or rings)]
        flat = [p for loop in loops for p in loop]
        base = len(roofs.v)
        for p in flat:
            roofs.add(p, roof_c)
        for t in tessellate_polygon(loops):
            a, b, c = (flat[i] for i in t)
            ccw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0
            roofs.f.append((base + t[0], base + t[1], base + t[2]) if ccw else (base + t[0], base + t[2], base + t[1]))
        deck[si] = zd
        if inner:
            tc = lin("#d6d2c8")
            for ring, inn in zip(rings, inner):
                n = len(ring)
                for k in range(n):
                    j = (k + 1) % n
                    q = [trim.add((*inn[k], zd), wall_c), trim.add((*inn[k], zt), wall_c), trim.add((*inn[j], zt), wall_c), trim.add((*inn[j], zd), wall_c)]
                    trim.f.append(tuple(q))
                    c = [trim.add((*ring[k], zt), tc), trim.add((*ring[j], zt), tc), trim.add((*inn[j], zt), tc), trim.add((*inn[k], zt), tc)]
                    trim.f.append(tuple(c))
    # awnings over shopfronts
    awn = lin("#3b3f43")
    for si, fr in front_of.items():
        s = solids[si]
        ring = np.asarray(s[4], float).reshape(-1, 2) / 10
        style, storey, ground, seed, _, _ = info(s[0])
        for k, fl in fr.items():
            if not fl & 2:
                continue
            a, b = ring[k], ring[(k + 1) % len(ring)]
            L = np.hypot(*(b - a))
            if L < 3:
                continue
            u = (b - a) / L
            nrm = np.array([u[1], -u[0]])
            dep, z0 = 2.4 + 0.5 * seed, s[1] / 10 + min(ground, 4.6) - 0.55
            p = [a + u * 0.25 + nrm * 0.05, b - u * 0.25 + nrm * 0.05, b - u * 0.25 + nrm * dep, a + u * 0.25 + nrm * dep]
            v = [trim.add((*q, z), awn) for z in (z0, z0 + 0.28) for q in p]
            trim.f += [(v[4], v[5], v[6], v[7]), (v[3], v[2], v[1], v[0]), (v[3], v[7], v[6], v[2]), (v[0], v[4], v[7], v[3]), (v[2], v[6], v[5], v[1])]
    walls.object("facades", facade_material())
    roofs.object("roofs", simple("roofs", rough=0.72, vcol=True))
    trim.object("trim", simple("trim", rough=0.75, vcol=True))
    # rooftop plant: boxes on the decks
    plant = Geo()
    kinds = {0: lin("#a3a7a8"), 1: lin("#b9b6ae"), 2: lin("#cfd6d8")}
    for p in B.get("p", []):
        if p[0] not in deck:
            continue
        z = deck[p[0]] + (1.0 if p[1] == 2 else 0.0)
        cx, cy, w, d, h, ang = p[2] / 10, p[3] / 10, p[4] / 10, p[5] / 10, p[6] / 10, math.radians(p[7] / 100)
        ca, sa = math.cos(ang), math.sin(ang)
        corners = [(cx + ca * x - sa * y, cy + sa * x + ca * y) for x, y in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
        v = [plant.add((x, y, zz), kinds[p[1]]) for zz in (z, z + h) for x, y in corners]
        plant.f += [(v[4], v[5], v[6], v[7]), (v[0], v[1], v[5], v[4]), (v[1], v[2], v[6], v[5]), (v[2], v[3], v[7], v[6]), (v[3], v[0], v[4], v[7])]
    if plant.f:
        plant.object("rooftop_plant", simple("plant", rough=0.6, metal=0.3, vcol=True))
    return {"wall_faces": len(walls.f), "roof_faces": len(roofs.f), "trim_faces": len(trim.f), "plant_boxes": len(B.get("p", []))}
