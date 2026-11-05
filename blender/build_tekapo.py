"""Build Lake Tekapo's landmarks: web/data/lake-tekapo/models/tekapo-*.glb (meshopt-compressed).

    pip install bpy==5.2.3 pillow
    python pipeline/tekapo_landmarks.py        # measure first (cities/lake-tekapo/analysis/landmarks.json)
    python blender/build_tekapo.py              # build the four models
    python blender/build_tekapo.py --render     # and render stills into docs/images/lake-tekapo

- The Church of the Good Shepherd (1935; R.S.D. Harman after Esther Hope's sketches): poured concrete faced
  with local boulders left with their lichen, buttresses down the sides, a slate roof (1957, replacing the oak
  shingles), a small belfry to the left of the entrance, a concrete cross on the north gable, and the plate-glass
  window above the altar that frames the lake (Heritage New Zealand, list no. 311). Footprint 10.1 x 6.4 m from
  OpenStreetMap, long axis at 16.5 degrees; ridge 6.1 m and eaves about 3 m above the ground from LINZ's LiDAR.
  The interior is there behind the glass: cream rough-plastered walls, dark rimu trusses, pews and the altar.
- The sheepdog statue (Innes Elliott; cast in London from a plaster sent in 1966): a bronze New Zealand collie,
  modelled on a dog called Haig, standing on a cairn of local stone; 3.1 m to the top from the LiDAR.
- The footbridge over the Tekapo River (opened 2015): a 123 m steel girder deck on three piers, from the 0.075 m
  aerial photographs (2025-26) and OpenStreetMap; its deck rises from 8.2 m to 10.8 m above the river (the DSM).
- The University of Canterbury Mt John Observatory: every building on the summit from its OpenStreetMap
  footprint, raised to its LiDAR height, with a dome where a telescope stands (the MOA 1.8 m, the 1 m McLellan,
  the Boller & Chivens and Optical Craftsmen 0.6 m, the Astrograph, and the small round domes).

Each model is in the frame of its anchor in cities/lake-tekapo/city.json `landmarks`: x east, y north, z up in
Blender, so x east, y up, -z north in the glTF; z = 0 at the landmark's `ground_m`. Orientation is baked in,
so a model needs only its position. Textures are drawn here (numpy + Pillow): the boulder facing with its lichen,
the slates, the decking.
"""
import argparse
import json
import math
import os
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_vehicles import lin, setup_render, render  # noqa: E402
from meshopt import compress  # noqa: E402  (build_vehicles puts pipeline/ on the path)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "web", "data", "lake-tekapo", "models")
DOCS = os.path.join(ROOT, "docs", "images", "lake-tekapo")
TEX = os.path.join(ROOT, "data", "raw", "lake-tekapo", "tex")
CITY = os.path.join(ROOT, "cities", "lake-tekapo")
RNG = np.random.default_rng(1935)


# ------------------------------------------------------------ textures
def tileable_noise(n, octaves, seed, base=4):
    """Fractal value noise that tiles, in [0, 1]."""
    r = np.random.default_rng(seed)
    out = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        k = base * 2 ** o
        g = r.random((k, k))
        x = np.arange(n) * k / n
        i0 = np.floor(x).astype(int)
        f = x - i0
        f = f * f * (3 - 2 * f)
        i1 = (i0 + 1) % k
        a = g[np.ix_(i0, i0)] * (1 - f)[None, :] + g[np.ix_(i0, i1)] * f[None, :]
        b = g[np.ix_(i1, i0)] * (1 - f)[None, :] + g[np.ix_(i1, i1)] * f[None, :]
        out += amp * (a * (1 - f)[:, None] + b * f[:, None])
        tot += amp
        amp *= 0.5
    return out / tot


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.dstack([-dx, dy, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def save(arr, name):
    os.makedirs(TEX, exist_ok=True)
    p = os.path.join(TEX, name)
    Image.fromarray(arr).save(p, quality=90)
    return p


def boulder_texture(n=1024, stones=110, seed=7):
    """Rounded boulders set in mortar, tiling: Voronoi cells with a domed height, each stone its own
    greywacke grey, brown or ochre, with crustose lichen (pale grey-green and orange) on some.
    Returns (albedo path, normal path)."""
    r = np.random.default_rng(seed)
    # a jittered grid, alternate rows offset as coursed rubble is: even spacing that tiles
    k = int(round(math.sqrt(stones)))
    stones = k * k
    gy, gx = np.mgrid[0:k, 0:k].astype(np.float64)
    gx += 0.5 * (gy % 2)
    pts = np.column_stack([(gx.ravel() + 0.5 + (r.random(stones) - 0.5) * 0.55) * n / k,
                           (gy.ravel() + 0.5 + (r.random(stones) - 0.5) * 0.45) * n / k]) % n
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    d1 = np.full((n, n), 1e9, np.float32)
    d2 = np.full((n, n), 1e9, np.float32)
    idx = np.zeros((n, n), np.int32)
    for k, (px, py) in enumerate(pts):
        dx = np.abs(xx - px)
        dy = np.abs(yy - py)
        dx = np.minimum(dx, n - dx)
        dy = np.minimum(dy, n - dy)
        dd = np.sqrt(dx * dx + dy * dy)
        m1 = dd < d1
        d2 = np.where(m1, d1, np.minimum(d2, dd))
        idx = np.where(m1, k, idx)
        d1 = np.where(m1, dd, d1)
    # rounded boulders, not Voronoi cells: each stone a lumpy disc of its own size, mortar between
    nn = np.full(stones, 1e9)
    for k in range(stones):
        dx = np.abs(pts[:, 0] - pts[k, 0])
        dy = np.abs(pts[:, 1] - pts[k, 1])
        dx = np.minimum(dx, n - dx)
        dy = np.minimum(dy, n - dy)
        dd = np.sqrt(dx * dx + dy * dy)
        dd[k] = 1e9
        nn[k] = dd.min()
    lump = tileable_noise(n, 3, seed + 5, 32)
    cell = n / math.sqrt(stones)
    rad = (0.5 * cell + 0.15 * nn[idx]) * (0.82 + 0.3 * lump)
    rad = np.minimum(rad, (d1 + d2) / 2 - cell * 0.03)   # never past the border with the next stone: a joint between
    edge = rad - d1                              # inside the stone by this many px
    mortar_w = 0.0
    dome = np.clip(d1 / rad, 0, 1)
    dome = np.sqrt(np.clip(1 - dome ** 2.2, 0, 1))
    noise = tileable_noise(n, 6, seed + 1, 8)
    fine = tileable_noise(n, 4, seed + 2, 64)
    height = np.where(edge > mortar_w, 0.35 + 0.65 * dome, 0.15 * fine) + 0.08 * noise + 0.04 * fine
    # colours: per stone
    pal = np.array([[int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)] for h in (
        "#7d776d", "#6a645b", "#857c6e", "#5e5850", "#8f8573", "#7a6a57", "#6f736e", "#948a78", "#5f6261", "#857560", "#a09583")])
    sid = idx % len(pal)
    tint = 0.85 + 0.3 * r.random(stones)[idx]
    col = pal[sid] * tint[..., None]
    col *= (0.82 + 0.3 * dome)[..., None] * (0.9 + 0.2 * noise)[..., None]
    # lichen: on stones' upper, exposed faces, in blotches
    blot = tileable_noise(n, 5, seed + 3, 16)
    has = (r.random(stones) < 0.45)[idx]
    grey_l = (blot > 0.6) & has & (edge > mortar_w)
    orange_l = (tileable_noise(n, 5, seed + 4, 24) > 0.72) & has & (edge > mortar_w)
    col = np.where(grey_l[..., None], col * 0.6 + np.array([0.68, 0.70, 0.60]) * 0.4, col)
    col = np.where(orange_l[..., None], col * 0.6 + np.array([0.78, 0.56, 0.25]) * 0.4, col)
    mortar = np.array([0.56, 0.54, 0.50]) * (0.8 + 0.3 * fine)[..., None]
    col = np.where((edge > mortar_w)[..., None], col, mortar)
    ao = np.clip(0.62 + 0.38 * np.clip((edge + cell * 0.03) / (cell * 0.1), 0, 1), 0, 1)
    col *= ao[..., None]
    alb = (np.clip(col, 0, 1) * 255).astype(np.uint8)
    return save(alb, "boulders.jpg"), save(normal_from_height(height, 6.0), "boulders_n.jpg")


def slate_texture(n=1024, rows=12, seed=11):
    """Rectangular slates laid in courses, each lapping the one below (a step in the height),
    blue-grey with a little variety. Tiles 1 x 1 in UV (3.0 m across x 2.4 m up the slope)."""
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    ch = n / rows
    row = (yy // ch).astype(int)
    fy = (yy % ch) / ch
    cols = 10
    cw = n / cols
    off = (row % 2) * cw / 2
    col_i = ((xx + off) // cw).astype(int) % cols
    fx = ((xx + off) % cw) / cw
    key = row * cols + col_i
    shade = 0.82 + 0.3 * r.random(rows * cols + cols)[key]
    base = np.array([0.30, 0.33, 0.37]) * shade[..., None]
    fine = tileable_noise(n, 4, seed, 32)
    base *= (0.9 + 0.2 * fine)[..., None]
    gap = (fx < 0.025) | (fx > 0.975)
    base = np.where(gap[..., None], base * 0.35, base)
    base = np.where((fy > 0.92)[..., None], base * 0.55, base)    # the shadow under the course above
    h = fy * 0.6 + 0.1 * fine - gap * 0.3
    return save((np.clip(base, 0, 1) * 255).astype(np.uint8), "slate.jpg"), save(normal_from_height(h, 3.0), "slate_n.jpg")


def deck_texture(n=512, seed=13):
    """Composite decking boards across the bridge, pale grey (the aerial photographs)."""
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    boards = 8
    fy = (yy % (n / boards)) / (n / boards)
    fine = tileable_noise(n, 4, seed, 16)
    c = np.array([0.62, 0.60, 0.56]) * (0.9 + 0.15 * fine)[..., None]
    c = np.where(((fy < 0.04) | (fy > 0.96))[..., None], c * 0.4, c)
    return save((c * 255).astype(np.uint8), "deck.jpg")


# ------------------------------------------------------------ materials
MAT = {}


def mat(name, color, rough=0.6, metal=0.0, alpha=1.0, tex=None, normal=None, emit=None, cull=True, transmit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*lin(color), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if tex:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(tex)
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if normal:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(normal)
        t.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if emit:
        b.inputs["Emission Color"].default_value = (*lin(emit), 1)
        b.inputs["Emission Strength"].default_value = 1.0
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    if transmit:
        b.inputs["Transmission Weight"].default_value = transmit
    m.use_backface_culling = cull
    MAT[name] = m
    return m


# ------------------------------------------------------------ mesh building (x east, y north, z up)
class Mesh:
    def __init__(self):
        self.v, self.f, self.m, self.uv, self.s = [], [], [], [], []

    def quad(self, pts, material, uv=None, smooth=False):
        base = len(self.v)
        self.v += [tuple(map(float, p)) for p in pts]
        self.f.append(list(range(base, base + len(pts))))
        self.m.append(material)
        self.uv.append(uv)
        self.s.append(smooth)

    def add_bm(self, bm, material, M=Matrix(), smooth=False, uvscale=None):
        bm.verts.index_update()
        base = len(self.v)
        for v in bm.verts:
            self.v.append(tuple(M @ v.co))
        for f in bm.faces:
            ids = [base + v.index for v in f.verts]
            self.f.append(ids)
            self.m.append(material)
            self.s.append(smooth(f.normal) if callable(smooth) else smooth)
            self.uv.append(box_uv([self.v[i] for i in ids], uvscale) if uvscale else None)
        bm.free()

    def build(self, name):
        me = bpy.data.meshes.new(name + "_mesh")
        me.from_pydata(self.v, [], self.f)
        names = list(dict.fromkeys(self.m))
        for n in names:
            me.materials.append(MAT[n])
        me.polygons.foreach_set("material_index", [names.index(n) for n in self.m])
        me.polygons.foreach_set("use_smooth", self.s)
        layer = me.uv_layers.new(name="UV")
        flat = []
        for ids, u in zip(self.f, self.uv):
            flat.extend(u if u is not None else box_uv([self.v[i] for i in ids], 1.0))
        layer.data.foreach_set("uv", np.asarray(flat, np.float32).ravel())
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def box_uv(pts, scale):
    """Box-projected UVs at `scale` metres per tile, chosen from the face normal."""
    P = np.array(pts)
    nrm = np.cross(P[1] - P[0], P[2] - P[0]) if len(P) >= 3 else np.array([0, 0, 1.0])
    ax = int(np.argmax(np.abs(nrm)))
    if ax == 2:
        uv = P[:, [0, 1]]
    elif ax == 0:
        uv = P[:, [1, 2]]
    else:
        uv = P[:, [0, 2]]
    return [tuple(c) for c in uv / scale]


def cube(size, M=Matrix()):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return bm


def T(loc=(0, 0, 0), rz=0.0, rx=0.0, ry=0.0):
    return Matrix.Translation(loc) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y") @ Matrix.Rotation(rx, 4, "X")


def prism(mesh, material, ring, z0, z1, uvscale=None, top=True, bottom=False):
    """A vertical prism over a ring of [x, y] (counter-clockwise)."""
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        mesh.quad([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], material,
                  box_uv([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1)], uvscale) * 1 if uvscale else None)
    if top:
        mesh.quad([(p[0], p[1], z1) for p in ring], material, [tuple(np.array(p) / (uvscale or 1)) for p in ring])
    if bottom:
        mesh.quad([(p[0], p[1], z0) for p in ring[::-1]], material)


def fix_uv_quads(mesh):
    """box_uv on a whole face (prism() passed three points' UVs for four corners)."""
    for k, (ids, u) in enumerate(zip(mesh.f, mesh.uv)):
        if u is not None and len(u) != len(ids):
            mesh.uv[k] = None


def ccw(ring):
    a = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
    return ring if a > 0 else ring[::-1]


def obj_from_bm(name, bm, material):
    me = bpy.data.meshes.new(name + "_mesh")
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MAT[material])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def apply_boolean(target, cutter, op="DIFFERENCE"):
    mod = target.modifiers.new("b", "BOOLEAN")
    mod.operation = op
    mod.object = cutter
    mod.solver = "EXACT"
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter)


def lancet(w, h, spring, depth, M, segs=8):
    """A pointed (equilateral) arch opening as a solid for cutting: width w, total height h, the arch
    springing at `spring`; along local x (across), z up, extruded along local y by depth."""
    r = w
    pts = [(-w / 2, 0), (w / 2, 0), (w / 2, spring)]
    for k in range(1, segs):
        a = math.radians(60) * k / segs
        pts.append((w / 2 - r + r * math.cos(a), spring + r * math.sin(a)))
    pts.append((0, spring + r * math.sin(math.radians(60))))
    for k in range(segs - 1, 0, -1):
        a = math.radians(60) * k / segs
        pts.append((-(w / 2 - r + r * math.cos(a)), spring + r * math.sin(a)))
    pts.append((-w / 2, spring))
    sc = (h - spring) / (r * math.sin(math.radians(60))) if h > spring else 1
    pts = [(x, z if z <= spring else spring + (z - spring) * sc) for x, z in pts]
    bm = bmesh.new()
    vs = [bm.verts.new((x, -depth / 2, z)) for x, z in pts]
    face = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, depth, 0), verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return bm, pts


# ------------------------------------------------------------ the church
def build_church(meas):
    th = math.radians(16.5)                      # the long axis' bearing (altar end)
    R = Matrix.Rotation(-th, 4, "Z")             # church frame (x across to the east side, y toward the altar) -> site
    L, W, t = 10.1, 5.6, 0.5                     # walls outside, and their thickness (concrete + boulder facing)
    eave, ridge = 3.0, 6.05
    half = W / 2
    stone, plaster, rimu, slate, conc, glass, oak, floor_m = "Stone", "Plaster", "Rimu", "Slate", "Concrete", "Glass", "Oak", "Floor"
    parts = []

    # the shell: a solid of the walls with the gables, then the openings cut out of it
    def gable_solid(w2, l2, e, rdg, z0=-0.6):
        bm = bmesh.new()
        prof = [(-w2, z0), (w2, z0), (w2, e), (0, rdg), (-w2, e)]
        vs = [bm.verts.new((x, -l2, z)) for x, z in prof]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        bmesh.ops.translate(bm, vec=(0, 2 * l2, 0), verts=[e2 for e2 in ext["geom"] if isinstance(e2, bmesh.types.BMVert)])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return bm

    shell = obj_from_bm("church_shell", gable_solid(half, L / 2, eave, ridge), stone)
    inner = obj_from_bm("church_inner", gable_solid(half - t, L / 2 - t, eave + 0.1, ridge - t * 1.2, z0=0.0), stone)
    apply_boolean(shell, inner)
    # openings: the door in the south gable, three lancets a side, the altar window in the north gable
    cuts = []
    bm, door_pts = lancet(1.15, 2.45, 1.75, 2.0, Matrix.Translation((0, -L / 2, 0)))
    cuts.append(bm)
    lancets = []
    for side in (-1, 1):
        for y in (-2.6, 0.0, 2.6):
            M = Matrix.Translation((side * half, y, 1.25)) @ Matrix.Rotation(math.pi / 2, 4, "Z")
            bm, pts = lancet(0.46, 1.3, 0.95, 2.0, M)
            cuts.append(bm)
            lancets.append((side, y, pts))
    AW, AH, AS = 2.7, 1.55, 1.15                 # the altar window: width, height, sill
    cuts.append(cube((AW, 2.0, AH), Matrix.Translation((0, L / 2, AS + AH / 2))))
    cuts.append(cube((0.42, 2.0, 0.85), Matrix.Translation((0, -L / 2, 3.55))))   # a small window high in the south gable
    for bm in cuts:
        apply_boolean(shell, obj_from_bm("cut", bm, stone))

    # stone outside, plaster inside: by which side of the wall a face is on
    me = shell.data
    if "Plaster" not in [m.name for m in me.materials]:
        me.materials.append(MAT[plaster])
    pi_ = [m.name for m in me.materials].index(plaster)
    for p in me.polygons:
        c = p.center
        inside = abs(c.x) < half - t + 0.02 and abs(c.y) < L / 2 - t + 0.02 and c.z > 0.01
        if inside and (abs(p.normal.x) > 0.5 or abs(p.normal.y) > 0.5 or p.normal.z < -0.5):
            p.material_index = pi_
    shell_mesh = Mesh()
    me.calc_loop_triangles()
    for p in me.polygons:
        pts = [tuple(me.vertices[i].co) for i in p.vertices]
        shell_mesh.quad(pts, me.materials[p.material_index].name, box_uv(pts, 2.4))
    bpy.data.objects.remove(shell)

    m = shell_mesh
    # buttresses: three a side between the lancets, stepped, with sloping weatherings
    for side in (-1, 1):
        for y in (-3.9, -1.3, 1.3, 3.9):
            for z0, z1, d in ((-0.4, 1.4, 0.45), (1.4, 2.5, 0.32)):
                bm = cube((d, 0.48, z1 - z0), Matrix.Translation((side * (half + d / 2 - 0.02), y, (z0 + z1) / 2)))
                m.add_bm(bm, stone, uvscale=2.4)
                # the weathering: a wedge of concrete on top of each stage
                bm = bmesh.new()
                x0, x1 = side * (half - 0.02), side * (half + d - 0.02)
                vs = [bm.verts.new(v) for v in ((x0, y - 0.26, z1), (x1, y - 0.26, z1), (x0, y - 0.26, z1 + 0.28),
                                                 (x0, y + 0.26, z1), (x1, y + 0.26, z1), (x0, y + 0.26, z1 + 0.28))]
                for f in ((0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (0, 2, 5, 3)):
                    bm.faces.new([vs[i] for i in f])
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
                m.add_bm(bm, conc, uvscale=1.0)
    # gable copings (concrete, pale in the aerial photographs) and the eaves' kneelers
    for yend in (-L / 2, L / 2):
        for s in (-1, 1):
            a = Vector((s * (half + 0.12), yend, eave - 0.05))
            b = Vector((0, yend, ridge + 0.12))
            d = (b - a)
            ln = d.length
            bm = cube((ln + 0.25, t + 0.16, 0.22))
            M = Matrix.Translation((a + b) / 2) @ Matrix.Rotation(s * math.atan2(d.z, abs(d.x)), 4, "Y")
            bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
            m.add_bm(bm, conc, uvscale=1.0)
        for s in (-1, 1):
            m.add_bm(cube((0.55, t + 0.16, 0.3), Matrix.Translation((s * (half + 0.05), yend, eave - 0.1))), conc, uvscale=1.0)
    # the roof: slates on two planes between the gables, with a ridge capping
    over = 0.32
    rl = L / 2 - t / 2
    for s in (-1, 1):
        x0, z0 = s * (half + over), eave - over * (ridge - eave) / half
        x1, z1 = 0.0, ridge + 0.06
        up = Vector((x1 - x0, 0, z1 - z0)).normalized()
        nrm = Vector((s * up.z, 0, -s * up.x * -1)) if False else Vector((-up.z * -s, 0, up.x * -s)).normalized()
        nrm = Vector((s * abs(up.z), 0, abs(up.x)))
        th_ = 0.09
        pts = [(x0, -rl, z0), (x0, rl, z0), (x1, rl, z1), (x1, -rl, z1)]
        if s < 0:
            pts = pts[::-1]
        slope = math.hypot(x1 - x0, z1 - z0)
        uv = [(0, 0), (2 * rl / 3.0, 0), (2 * rl / 3.0, slope / 2.4), (0, slope / 2.4)]
        if s < 0:
            uv = uv[::-1]
        m.quad(pts, slate, uv)
        lo = [(p[0] - nrm.x * th_, p[1], p[2] - nrm.z * th_) for p in pts]
        m.quad(lo[::-1], rimu, None)           # sarking under the slates, seen from inside
        m.quad([pts[0], lo[0], lo[1], pts[1]] if s > 0 else [pts[3], pts[2], lo[2], lo[3]], slate)  # the eave's edge
    bm = cube((0.26, 2 * rl + 0.1, 0.16), Matrix.Translation((0, 0, ridge + 0.1)) @ Matrix.Rotation(math.pi / 4, 4, "Y"))
    m.add_bm(bm, conc, uvscale=1.0)
    # the concrete cross on the north gable
    cy = L / 2
    m.add_bm(cube((0.16, 0.16, 1.0), Matrix.Translation((0, cy, ridge + 0.62))), conc, uvscale=1.0)
    m.add_bm(cube((0.58, 0.16, 0.15), Matrix.Translation((0, cy, ridge + 0.82))), conc, uvscale=1.0)
    # the belfry: a small stone bellcote rising from the roofline on the west side by the south gable, to the left of
    # the door as you face it (Heritage New Zealand), corbelled out over the wall from the eave
    bx, by = -half * 0.5, -L / 2 + 0.9
    bw, bd, bh = 0.75, 0.7, 6.3
    zb = eave + (ridge - eave) * (1 - (abs(bx) + bw / 2) / half) - 0.15
    pier = cube((bw, bd, bh - zb), Matrix.Translation((bx, by, (bh + zb) / 2)))
    pier_o = obj_from_bm("belfry", pier, stone)
    bm, _ = lancet(0.42, 0.85, 0.5, 2.0, Matrix.Translation((bx, by, bh - 1.15)))
    apply_boolean(pier_o, obj_from_bm("cut", bm, stone))
    me = pier_o.data
    for p in me.polygons:
        pts = [tuple(me.vertices[i].co) for i in p.vertices]
        m.quad(pts, stone, box_uv(pts, 2.4))
    bpy.data.objects.remove(pier_o)
    for s in (-1, 1):                            # its little gabled cap
        pts = [(bx - bw / 2 - 0.1, by + s * (bd / 2 + 0.08), bh), (bx + bw / 2 + 0.1, by + s * (bd / 2 + 0.08), bh),
               (bx + bw / 2 + 0.1, by, bh + 0.45), (bx - bw / 2 - 0.1, by, bh + 0.45)]
        m.quad(pts if s < 0 else pts[::-1], conc)
    for s in (-1, 1):
        m.quad([(bx + s * (bw / 2 + 0.1), by - bd / 2 - 0.08, bh), (bx + s * (bw / 2 + 0.1), by + bd / 2 + 0.08, bh),
                (bx + s * (bw / 2 + 0.1), by, bh + 0.45)][::s], conc)
    bell = bmesh.new()
    bmesh.ops.create_cone(bell, cap_ends=True, segments=16, radius1=0.17, radius2=0.09, depth=0.28)
    m.add_bm(bell, "Bronze", Matrix.Translation((bx, by, bh - 0.85)), smooth=True)
    # the door (oak, boarded) and the glass
    m.quad([(-0.56, -L / 2 + 0.28, 0), (0.56, -L / 2 + 0.28, 0), (0.56, -L / 2 + 0.28, 2.3), (-0.56, -L / 2 + 0.28, 2.3)][::-1], oak,
           [(0, 0), (1, 0), (1, 2), (0, 2)][::-1])
    door_poly = [(x, -L / 2 + 0.3, z) for x, z in door_pts]
    m.quad(door_poly[::-1], oak)
    for side, y, pts in lancets:
        x = side * (half - 0.15)
        poly = [(x, y + px * side, z + 1.25) for px, z in pts]
        m.quad(poly if side > 0 else poly[::-1], glass)
        m.quad(poly[::-1] if side > 0 else poly, glass)
    for yy, ww, hh, zz in ((L / 2 - 0.12, AW, AH, AS), (-L / 2 + 0.25, 0.42, 0.85, 3.13)):
        g = [(-ww / 2, yy, zz), (ww / 2, yy, zz), (ww / 2, yy, zz + hh), (-ww / 2, yy, zz + hh)]
        m.quad(g, "ClearGlass" if ww > 1 else glass)
        m.quad(g[::-1], "ClearGlass" if ww > 1 else glass)
    for xm in (-AW / 6, AW / 6):                 # the altar window's two mullions (timber)
        m.add_bm(cube((0.08, 0.14, AH), Matrix.Translation((xm, L / 2 - 0.12, AS + AH / 2))), rimu, uvscale=1.0)
    # inside: floor, trusses, pews, the altar
    m.add_bm(cube((W - 2 * t, L - 2 * t, 0.06), Matrix.Translation((0, 0, 0.03))), floor_m, uvscale=1.2)
    for y in (-3.0, -1.0, 1.0, 3.0):
        zc = eave + 0.55
        m.add_bm(cube((W - 2 * t, 0.16, 0.22), Matrix.Translation((0, y, zc))), rimu, uvscale=1.0)
        for s in (-1, 1):
            a = Vector((s * (half - t), y, eave - 0.2))
            b = Vector((0, y, ridge - 0.65))
            d = b - a
            bm = cube((d.length, 0.14, 0.2))
            bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ Matrix.Rotation(s * math.atan2(d.z, abs(d.x)), 4, "Y"),
                                verts=bm.verts)
            m.add_bm(bm, rimu, uvscale=1.0)
    for row in range(6):
        y = -3.0 + row * 0.95
        for s in (-1, 1):
            x = s * 1.25
            m.add_bm(cube((1.55, 0.36, 0.06), Matrix.Translation((x, y, 0.45))), oak, uvscale=1.0)
            m.add_bm(cube((1.55, 0.05, 0.42), Matrix.Translation((x, y - 0.2, 0.72))), oak, uvscale=1.0)
            for e in (-1, 1):
                m.add_bm(cube((0.06, 0.42, 0.9), Matrix.Translation((x + e * 0.78, y - 0.02, 0.45))), oak, uvscale=1.0)
    m.add_bm(cube((1.7, 0.7, 0.95), Matrix.Translation((0, L / 2 - t - 0.6, 0.475))), oak, uvscale=1.0)
    m.add_bm(cube((1.9, 0.9, 0.04), Matrix.Translation((0, L / 2 - t - 0.6, 0.97))), "Linen", uvscale=1.0)
    m.add_bm(cube((2.8, 1.6, 0.18), Matrix.Translation((0, L / 2 - t - 0.8, 0.09))), conc, uvscale=1.0)

    # turn the whole church to its bearing
    m.v = [tuple(R @ Vector(p)) for p in m.v]
    # re-project UVs for the faces given none (box UVs depend on orientation only for the scale, so keep the walls' own)
    return [m.build("Church_of_the_Good_Shepherd")]


# ------------------------------------------------------------ the sheepdog statue
def metaball_mesh(name, elements, res=0.012):
    mb = bpy.data.metaballs.new(name + "_mb")
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = 0.6
    ob = bpy.data.objects.new(name + "_mbo", mb)
    bpy.context.scene.collection.objects.link(ob)
    for kind, co, r, size, rot in elements:
        e = mb.elements.new()
        e.type = kind
        e.co = co
        e.radius = r
        if size:
            e.size_x, e.size_y, e.size_z = size
        if rot is not None:
            e.rotation = rot
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    return me


# A metaball's surface lies where its field falls to the threshold: at the default stiffness (2) and a threshold of
# 0.6, (1 - (d/r)^2)^3 = 0.3, so d = 0.575 r. These take the radii and semi-axes you see and convert.
SEEN = 0.575


def capsule(a, b, r):
    """A capsule between two points with the radius you see."""
    a, b = Vector(a), Vector(b)
    d = b - a
    q = Vector((1, 0, 0)).rotation_difference(d.normalized())
    return ("CAPSULE", (a + b) / 2, r / SEEN, (d.length / 2, 1, 1), q)


def ell(c, _r, s, rot=None):
    """An ellipsoid at c with the semi-axes s you see."""
    return ("ELLIPSOID", Vector(c), 1.0, tuple(v / SEEN for v in s), rot)


def build_collie(meas):
    """A New Zealand collie standing four-square and alert, head up, looking out; about life size
    (0.55 m at the withers), on a cairn of local stone so the top is at the LiDAR's 3.1 m."""
    top = meas["top_m"]
    E = []
    # body: barrel, deep chest, the ruff of the coat at the neck, loin and croup
    E += [ell((0.02, 0, 0.47), 0, (0.26, 0.11, 0.12)), ell((0.20, 0, 0.47), 0, (0.13, 0.12, 0.15)),
          ell((-0.22, 0, 0.47), 0, (0.13, 0.105, 0.11)), ell((0.31, 0, 0.58), 0, (0.10, 0.11, 0.13)),
          ell((0.27, 0, 0.42), 0, (0.08, 0.08, 0.08))]
    # neck and head carried high, alert; a defined stop, a tapering muzzle, the nose
    E += [capsule((0.31, 0, 0.60), (0.38, 0, 0.71), 0.08), ell((0.42, 0, 0.77), 0, (0.095, 0.078, 0.082)),
          ell((0.49, 0, 0.76), 0, (0.06, 0.052, 0.05)), capsule((0.50, 0, 0.75), (0.585, 0, 0.74), 0.032),
          ell((0.60, 0, 0.743), 0, (0.022, 0.02, 0.018)), ell((0.47, 0, 0.72), 0, (0.05, 0.042, 0.028))]
    for s in (-1, 1):
        E += [ell((0.40, s * 0.055, 0.855), 0, (0.03, 0.022, 0.05)),                   # semi-erect ears
              ell((0.42, s * 0.062, 0.89), 0, (0.03, 0.024, 0.018))]                  # their tips folding forward
        # front legs: elbow, forearm, a slight slope at the pastern, the paw
        E += [ell((0.24, s * 0.08, 0.38), 0, (0.06, 0.04, 0.08)), capsule((0.245, s * 0.075, 0.34), (0.25, s * 0.07, 0.09), 0.033),
              capsule((0.25, s * 0.07, 0.09), (0.265, s * 0.068, 0.035), 0.028), ell((0.28, s * 0.068, 0.02), 0, (0.042, 0.03, 0.02))]
        # hind legs: thigh, second thigh angled back to the hock, then the rear pastern down
        E += [ell((-0.27, s * 0.085, 0.37), 0, (0.10, 0.055, 0.12)), capsule((-0.28, s * 0.08, 0.30), (-0.37, s * 0.075, 0.14), 0.038),
              capsule((-0.37, s * 0.075, 0.14), (-0.34, s * 0.07, 0.035), 0.03), ell((-0.32, s * 0.07, 0.02), 0, (0.042, 0.03, 0.02)),
              ell((-0.33, s * 0.075, 0.22), 0, (0.04, 0.03, 0.05))]                    # the feathering behind
    # the tail, a full brush carried low with an upward swirl at the tip
    tail = [(-0.40, 0, 0.51), (-0.47, 0, 0.45), (-0.52, 0, 0.37), (-0.545, 0, 0.29), (-0.55, 0, 0.22), (-0.535, 0, 0.16), (-0.50, 0, 0.13)]
    for i, (a, b) in enumerate(zip(tail[:-1], tail[1:])):
        E.append(capsule(a, b, 0.05 - 0.004 * i))
    me = metaball_mesh("collie", E)
    dog = Mesh()
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    # the cairn: boulders stacked into a tapering pier, its top flat where the dog stands
    cairn_h = top - 0.93
    stones = Mesh()
    r = np.random.default_rng(1966)
    nl = int(cairn_h / 0.2)
    for layer in range(nl):
        z = cairn_h * layer / nl
        rad = 0.82 - 0.27 * layer / nl
        k = int(2 * math.pi * rad / 0.24)
        for j in range(k):
            a = j * 2 * math.pi / k + r.random() * 0.3 + layer * 0.7
            sz = 0.15 + 0.07 * r.random()
            s = bmesh.new()
            bmesh.ops.create_icosphere(s, subdivisions=1, radius=sz)
            sx, sy, sz_ = 0.8 + 0.5 * r.random(), 0.8 + 0.4 * r.random(), 0.5 + 0.25 * r.random()
            for v in s.verts:
                v.co *= 1 + 0.35 * (r.random() - 0.5)
                v.co.x *= sx
                v.co.y *= sy
                v.co.z *= sz_
            bmesh.ops.transform(s, matrix=T((math.cos(a) * rad, math.sin(a) * rad, z + sz * 0.5), rz=r.random() * 6), verts=s.verts)
            stones.add_bm(s, ("Rock", "Rock2", "Rock3")[int(r.random() * 3)], smooth=False, uvscale=1.2)
    core = bmesh.new()
    bmesh.ops.create_cone(core, cap_ends=True, segments=18, radius1=0.8, radius2=0.53, depth=cairn_h)
    stones.add_bm(core, "Mortar", Matrix.Translation((0, 0, cairn_h / 2)), uvscale=1.2)
    cap = bmesh.new()
    bmesh.ops.create_cone(cap, cap_ends=True, segments=9, radius1=0.56, radius2=0.5, depth=0.12)
    stones.add_bm(cap, "Rock", Matrix.Translation((0, 0, cairn_h + 0.05)), uvscale=1.0)
    # the paved round about it (the aerial photographs: a ring of paving about 6 m across)
    pave = bmesh.new()
    bmesh.ops.create_circle(pave, cap_ends=True, segments=36, radius=3.0)
    stones.add_bm(pave, "Paving", Matrix.Translation((0, 0, 0.02)), uvscale=1.5)
    head = math.radians(20)
    M = Matrix.Rotation(math.pi / 2 - head, 4, "Z")          # the dog's x (forward) to its bearing
    dog.add_bm(bm, "Bronze", Matrix.Translation((0, 0, cairn_h + 0.11)) @ M, smooth=True)
    return [stones.build("Sheepdog_cairn"), dog.build("Sheepdog_bronze")]


# ------------------------------------------------------------ the footbridge
def build_footbridge(meas):
    (ax, ay), (bx, by) = meas["ends"]
    water = meas["water_m"]
    z0 = water                                   # model z = 0 at the river (city.json ground_m)
    A, B = Vector((ax, ay)), Vector((bx, by))
    u = (B - A).normalized()
    v = Vector((-u.y, u.x))
    L = (B - A).length
    s0, s1 = 4.5, L - 4.0                        # the deck's ends: the way runs on to the paths
    prof = np.array(meas["dsm_profile_m"])
    # deck top: the DSM along the way, less the balustrade's share, smoothed to a gentle camber
    ts = np.linspace(0, 1, len(prof))
    c = np.polyfit(ts, prof - 0.55, 2)
    deck = lambda s: float(np.polyval(c, s / L)) - z0
    piers = [s0 + 27.5, s0 + 50.0, s0 + 100.0]
    m = Mesh()
    n = 64
    W = 3.0
    ss = np.linspace(s0, s1, n)
    P = lambda s, off, z: (A.x + u.x * s + v.x * off, A.y + u.y * s + v.y * off, z)
    for i in range(n - 1):
        sa, sb = ss[i], ss[i + 1]
        za, zb = deck(sa), deck(sb)
        m.quad([P(sa, -W / 2, za), P(sb, -W / 2, zb), P(sb, W / 2, zb), P(sa, W / 2, za)], "Decking",
               [(sa / 3, 0), (sb / 3, 0), (sb / 3, 1), (sa / 3, 1)])
        # the girder: a trapezoid box under the deck, painted
        gd = 0.95
        for o0, o1, d0, d1 in ((-W / 2, -0.9, 0.1, gd), (0.9, W / 2, gd, 0.1)):
            m.quad([P(sa, o0, za - d0), P(sa, o1, za - d1), P(sb, o1, zb - d1), P(sb, o0, zb - d0)][::-1], "Girder")
        m.quad([P(sa, -0.9, za - gd), P(sa, 0.9, za - gd), P(sb, 0.9, zb - gd), P(sb, -0.9, zb - gd)][::-1], "Girder")
        for side in (-1, 1):
            o = side * W / 2
            m.quad([P(sa, o, za - 0.1), P(sb, o, zb - 0.1), P(sb, o, zb), P(sa, o, za)][::side], "Girder")
            # balustrade: a mesh infill (semi-transparent) and a timber handrail on posts
            m.quad([P(sa, o * 0.97, za), P(sb, o * 0.97, zb), P(sb, o * 0.97, zb + 1.1), P(sa, o * 0.97, za + 1.1)], "Mesh")
            m.quad([P(sa, o * 0.97, za + 1.1), P(sb, o * 0.97, zb + 1.1), P(sb, o * 0.97, zb), P(sa, o * 0.97, za)], "Mesh")
            rail = bmesh.new()
            bmesh.ops.create_cube(rail, size=1)
            mid = (sa + sb) / 2
            ang = math.atan2(zb - za, sb - sa)
            bmesh.ops.scale(rail, vec=(sb - sa + 0.01, 0.09, 0.06), verts=rail.verts)
            bmesh.ops.transform(rail, matrix=Matrix.Translation(P(mid, o * 0.97, (za + zb) / 2 + 1.13)) @ Matrix.Rotation(math.atan2(u.y, u.x), 4, "Z")
                                @ Matrix.Rotation(-ang, 4, "Y"), verts=rail.verts)
            m.add_bm(rail, "Handrail", uvscale=1.0)
    for s in np.arange(s0, s1, 1.6):
        for side in (-1, 1):
            z = deck(s)
            post = cube((0.06, 0.06, 1.12), Matrix.Translation(P(s, side * W / 2 * 0.97, z + 0.56)))
            m.add_bm(post, "Steel", uvscale=1.0)
    for s in piers:
        z = deck(s) - 0.95
        p = bmesh.new()
        bmesh.ops.create_cone(p, cap_ends=True, segments=20, radius1=0.65, radius2=0.65, depth=z + 3.0)
        bmesh.ops.scale(p, vec=(1.0, 1.6, 1.0), verts=p.verts)
        m.add_bm(p, "Concrete", Matrix.Translation(P(s, 0, (z - 3.0) / 2)) @ Matrix.Rotation(math.atan2(u.y, u.x), 4, "Z"),
                 smooth=lambda nn: abs(nn.z) < 0.7, uvscale=1.5)
        m.add_bm(cube((1.0, 2.4, 0.4), Matrix.Translation(P(s, 0, z - 0.2)) @ Matrix.Rotation(math.atan2(u.y, u.x), 4, "Z")), "Concrete", uvscale=1.5)
    for s, back in ((s0, -1), (s1, 1)):
        z = deck(s)
        m.add_bm(cube((3.0, W + 0.8, z + 2.0), Matrix.Translation(P(s + back * 1.5, 0, (z - 2.0) / 2)) @ Matrix.Rotation(math.atan2(u.y, u.x), 4, "Z")),
                 "Concrete", uvscale=1.5)
    return [m.build("Tekapo_footbridge")]


# ------------------------------------------------------------ the observatory
def build_observatory(meas):
    g0 = meas["ground_m"]
    m = Mesh()
    domed = 0
    for b in meas["buildings"]:
        ring = ccw([tuple(p) for p in b["ring"]])
        z0 = b["ground_m"] - g0
        name = b["name"] or ""
        tele = any(k in name for k in ("Telescope", "Astrograph", "Metre")) or (b["round"] > 0.9 and b["top_m"] > 1.6)
        roof = max(2.4, b["roof_m"]) if not tele else max(2.4, b["roof_m"])
        if b["round"] > 0.9:
            roof = min(roof, max(0.6, b["top_m"] - b["dims_m"][0] / 2))
        cafe = "Caf" in name
        wall = "Glass" if cafe else "WhitePaint"
        prism(m, wall, ring, z0 - 1.5, z0 + roof, uvscale=None, top=False)
        m.quad([(p[0], p[1], z0 + roof) for p in ring], "Roof")
        # a parapet
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        inner = [(cx + (p[0] - cx) * 0.94, cy + (p[1] - cy) * 0.94) for p in ring]
        if b["round"] < 0.9 and not cafe:
            for i in range(len(ring)):
                a, c = ring[i], ring[(i + 1) % len(ring)]
                ia, ic = inner[i], inner[(i + 1) % len(ring)]
                m.quad([(a[0], a[1], z0 + roof + 0.3), (c[0], c[1], z0 + roof + 0.3), (ic[0], ic[1], z0 + roof + 0.3),
                        (ia[0], ia[1], z0 + roof + 0.3)], "WhitePaint")
                m.quad([(a[0], a[1], z0 + roof), (c[0], c[1], z0 + roof), (c[0], c[1], z0 + roof + 0.3), (a[0], a[1], z0 + roof + 0.3)], "WhitePaint")
        if not tele:
            continue
        domed += 1
        rmax = b["dims_m"][0] / 2
        r = min(rmax, max(1.0, b["top_m"] - roof + 0.6), 4.8)
        if b["round"] > 0.9:
            r = rmax
        cx, cy = b["top_at"] if b["round"] < 0.9 else (cx, cy)
        base = max(roof, b["top_m"] - r)
        if base > roof + 0.05:
            d = bmesh.new()
            bmesh.ops.create_cone(d, cap_ends=False, segments=32, radius1=r, radius2=r, depth=base - roof)
            m.add_bm(d, "WhitePaint", Matrix.Translation((cx, cy, z0 + (roof + base) / 2)), smooth=lambda nn: abs(nn.z) < 0.7)
        s = bmesh.new()
        bmesh.ops.create_uvsphere(s, u_segments=36, v_segments=18, radius=r)
        bmesh.ops.delete(s, geom=[v for v in s.verts if v.co.z < -1e-4], context="VERTS")
        slit_az = math.radians(30 + 47 * domed)
        sm = Mesh()
        sm.add_bm(s, "Dome", Matrix.Translation((cx, cy, z0 + base)), smooth=True)
        for k, ids in enumerate(sm.f):         # the shutter: a band of faces across the crown, darker
            cpt = sum((Vector(sm.v[i]) for i in ids), Vector()) / len(ids) - Vector((cx, cy, z0 + base))
            side = cpt.x * math.cos(slit_az) + cpt.y * math.sin(slit_az)
            across = -cpt.x * math.sin(slit_az) + cpt.y * math.cos(slit_az)
            if abs(across) < r * 0.16 and side > -r * 0.2:
                sm.m[k] = "Shutter"
        base_i = len(m.v)
        m.v += sm.v
        for ids, mm, s_ in zip(sm.f, sm.m, sm.s):
            m.f.append([base_i + i for i in ids])
            m.m.append(mm)
            m.s.append(s_)
            m.uv.append(None)
    fix_uv_quads(m)
    return [m.build("Mt_John_Observatory")]


# ------------------------------------------------------------ main
def materials():
    alb, nrm = boulder_texture()
    sl, sln = slate_texture()
    dk = deck_texture()
    mat("Stone", "#ffffff", 0.88, tex=alb, normal=nrm)
    mat("Plaster", "#e8dfc9", 0.92)
    mat("Rimu", "#4a2a1c", 0.55)
    mat("Slate", "#ffffff", 0.62, tex=sl, normal=sln)
    mat("Concrete", "#b9b4aa", 0.85)
    mat("Glass", "#c9b47a", 0.15, alpha=0.6, cull=False)
    mat("ClearGlass", "#dfe9ee", 0.03, alpha=0.18, cull=False)
    mat("Oak", "#4b3423", 0.6)
    mat("Floor", "#7a5536", 0.55)
    mat("Linen", "#f2efe6", 0.9)
    mat("Bronze", "#3e3324", 0.5, metal=1.0)
    mat("Rock", "#6f695e", 0.92)
    mat("Rock2", "#5d5a55", 0.9)
    mat("Rock3", "#7d7262", 0.92)
    mat("Mortar", "#6f6a60", 0.95)
    mat("Paving", "#b9b2a5", 0.9, tex=alb)
    mat("Decking", "#ffffff", 0.75, tex=dk)
    mat("Girder", "#e9ebea", 0.5, metal=0.2)
    mat("Steel", "#b8bcbf", 0.35, metal=0.9)
    mat("Handrail", "#8a6a48", 0.55)
    mat("Mesh", "#9aa0a3", 0.4, metal=0.8, alpha=0.32, cull=False)
    mat("WhitePaint", "#eeeeea", 0.7)
    mat("Roof", "#8e9193", 0.8)
    mat("Glass", "#c9b47a", 0.15, alpha=0.6, cull=False)
    mat("Dome", "#e2e5e7", 0.3, metal=0.7)
    mat("Shutter", "#9da3a8", 0.45, metal=0.6)


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_image_format="JPEG",
                              export_jpeg_quality=85, export_cameras=False, export_lights=False, export_extras=False,
                              export_animations=False)
    compress(path)
    print(f"  {os.path.relpath(path, ROOT)}: {os.path.getsize(path) / 1e6:.2f} MB")


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MAT.clear()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["church", "collie", "footbridge", "observatory"])
    ap.add_argument("--render", action="store_true", help="also render stills into docs/images/lake-tekapo")
    ap.add_argument("--samples", type=int, default=64)
    a = ap.parse_args()
    meas = json.load(open(os.path.join(CITY, "analysis", "landmarks.json")))["landmarks"]
    os.makedirs(OUT, exist_ok=True)
    jobs = {"church": (build_church, "church-good-shepherd", "tekapo-church.glb"),
            "collie": (build_collie, "sheepdog-statue", "tekapo-collie.glb"),
            "footbridge": (build_footbridge, "footbridge", "tekapo-footbridge.glb"),
            "observatory": (build_observatory, "mt-john-observatory", "tekapo-observatory.glb")}
    for key, (fn, mid, fname) in jobs.items():
        if a.only and a.only != key:
            continue
        clear()
        materials()
        objs = fn(meas[mid])
        tris = 0
        for o in objs:
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
        print(f"{key}: {tris} triangles")
        export(objs, os.path.join(OUT, fname))
        if a.render:
            still(key, objs, a.samples)


VIEWS = {   # camera position and target in the model's frame (x east, y north, z up)
    "church": [((-9.0, -14.0, 2.6), (0.6, 0.0, 3.0), 35), ((2.0, 13.0, 1.7), (0.0, 0.0, 2.6), 28)],
    "collie": [((2.6, -4.2, 2.6), (0.0, 0.0, 2.2), 45), ((1.6, 0.6, 2.75), (0.0, 0.0, 2.6), 35)],
    "footbridge": [((40.0, -45.0, 14.0), (0.0, 0.0, 9.0), 30)],
    "observatory": [((95.0, -85.0, 32.0), (0.0, 5.0, 3.0), 30), ((40.0, -40.0, 18.0), (-20.0, 30.0, 4.0), 28)],
}


def still(key, objs, samples):
    from mathutils import Vector as V
    setup_render(samples=samples, res=(1440, 900), sun=(28, 120))
    g = bpy.data.objects.new("ground", bpy.data.meshes.new("ground"))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=600)
    bm.to_mesh(g.data)
    bm.free()
    g.data.materials.append(mat("Tussock", "#9b8a5c", 0.95))
    bpy.context.scene.collection.objects.link(g)
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(0.6)
    sun.rotation_euler = (math.radians(62), 0, math.radians(140))
    bpy.context.scene.collection.objects.link(sun)
    os.makedirs(DOCS, exist_ok=True)
    for k, (pos, tgt, lens) in enumerate(VIEWS[key]):
        cam = bpy.data.objects.new(f"cam{k}", bpy.data.cameras.new(f"cam{k}"))
        bpy.context.scene.collection.objects.link(cam)
        cam.data.lens = lens
        cam.location = V(pos)
        cam.rotation_euler = (V(tgt) - V(pos)).to_track_quat("-Z", "Y").to_euler()
        bpy.context.scene.camera = cam
        render(os.path.join(DOCS, f"model-{key}{'' if k == 0 else '-' + str(k + 1)}.jpg"))


if __name__ == "__main__":
    main()
