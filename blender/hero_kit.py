"""The kit a hero level is built from (blender/build_hero.py; web/game/hero.js draws it; docs/HERO.md).

A hero level is a small piece of a map modelled finely: the fronts of a street's buildings with their
shop fronts, windows, sign stacks, air conditioners and pipes, the street's paving with its manholes,
grates and puddles, and what stands on it (lamps, vending machines, bins, bicycles, cones). It is drawn
over the city's own model, a few centimetres in front of its walls, so that the city underneath needs
no change and the hero level can be let go when the player leaves.

Everything is in the city's local frame (x east, y north, z up, metres), built here as plain lists by
material (Geo), then made into Blender meshes and exported as one glTF binary (export). Its materials:

  * surfaces in CC0 PBR textures from ambientCG (TEXTURES: colour, normal and roughness at 1K, tinted
    per building), on texture coordinates in metres;
  * an atlas of everything drawn (Atlas: sign panels, shop interiors, vending machine fronts, menus),
    which the lit materials (glow*) also take as their emissive map;
  * plain metals, plastics and rubber.

The light the signs and shop fronts throw after dark, and the occlusion of the street's corners, are
baked into every vertex (bake: a sum over the lit faces, each a set of small area lights, with the
cosines at both ends and an inverse square; and an occlusion from the distance to the walls and the
ground), and exported as the _BAKE attribute hero.js reads. The material names follow hero.js's
conventions (glow*, tube*, win*, ground*).
"""
import math
import os
import zipfile
import urllib.request

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX_DIR = os.path.join(ROOT, "data", "raw", "hero_tex")
UA = {"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"}

# CC0 materials (ambientCG, https://ambientcg.com, CC0 1.0): id, metres one repeat covers
TEXTURES = {
    "asphalt": ("Asphalt031", 2.5),       # fine grey asphalt
    "tile": ("Tiles036", 0.9),            # small square facing tiles, the Japanese mixed-use building's skin
    "conc": ("Concrete034", 3.0),         # smooth cast concrete and render
    "dark": ("Tiles138", 1.6),            # dark granite-like tiles, a shop front's base and pilasters
    "plaster": ("Plaster001", 2.5),       # rendered wall
    "paver": ("PavingStones136", 2.0),    # interlocking blocks: Ichibangai is paved, not asphalted (OSM surface=paving_stones)
    # stone, timber and the water's edge (Sydney's quay, Queenstown's deck and wharf)
    "ashlar": ("Bricks066", 3.2),         # smooth dressed blocks in even courses: tinted, a sandstone or a bluestone front
    "rubble": ("Bricks083", 2.2),         # squared rubble in lime mortar: a seat wall, a colonial cottage, a schist wall when tinted grey
    "granite_pave": ("PavingStones125A", 2.4), # sawn granite planks in a bond: a modern quay's paving
    "sett": ("PavingStones131", 1.6),     # granite setts
    "grass": ("Grass004", 2.6),           # mown lawn
    "deck": ("Planks040", 1.8),           # grooved hardwood deck boards
    "granite": ("Granite005A", 1.5),      # polished granite: a plinth, a kerb
    "stone": ("Travertine009", 2.2),      # sawn bedded stone: copings, steps, pavers
    "schist": ("Rock051", 2.4),           # foliated grey-green schist: Otago's stone
    "bark": ("Bark014", 1.2),             # a trunk
}


def fetch_texture(key, size="1K"):
    """The colour, normal (OpenGL) and roughness images of a TEXTURES entry, fetched once into data/raw."""
    tid, _ = TEXTURES[key]
    d = os.path.join(TEX_DIR, tid)
    if not os.path.exists(os.path.join(d, f"{tid}_{size}-JPG_Color.jpg")):
        os.makedirs(d, exist_ok=True)
        req = urllib.request.Request(f"https://ambientcg.com/get?file={tid}_{size}-JPG.zip", headers=UA)
        z = os.path.join(d, "src.zip")
        with urllib.request.urlopen(req, timeout=120) as r, open(z, "wb") as f:
            f.write(r.read())
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if n.endswith((".jpg", ".png")) and not n.startswith(("/", "..")):
                    zf.extract(n, d)
        os.remove(z)
    out = {k: os.path.join(d, f"{tid}_{size}-JPG_{k}.jpg") for k in ("Color", "NormalGL", "Roughness")}
    # glTF's metallic-roughness image: occlusion (unused: 1), roughness, metalness (0), as one RGB image
    orm = os.path.join(d, f"{tid}_{size}_ORM.png")
    if not os.path.exists(orm):
        from PIL import Image
        r = Image.open(out["Roughness"]).convert("L")
        Image.merge("RGB", (Image.new("L", r.size, 255), r, Image.new("L", r.size, 0))).save(orm)
    out["ORM"] = orm
    # (a grey texture comes as a one-channel JPEG, which the exporter cannot write as WebP)
    from PIL import Image
    for k in ("Color", "NormalGL"):
        im = Image.open(out[k])
        if im.mode != "RGB":
            rgb = out[k][:-4] + "_rgb.png"
            if not os.path.exists(rgb):
                im.convert("RGB").save(rgb)
            out[k] = rgb
    return out


def tint_to(key, srgb):
    """The tint that brings a TEXTURES entry's mean colour to an sRGB colour (0-255): a grey ashlar made a
    sandstone, a paving made lighter. It may pass 1: hero.js sets it as the material's colour factor."""
    from PIL import Image
    a = np.asarray(Image.open(fetch_texture(key)["Color"]).convert("RGB").resize((64, 64)), float) / 255.0
    lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return tuple(float(v) for v in np.round(lin(np.asarray(srgb, float) / 255.0) / lin(a).reshape(-1, 3).mean(0), 3))


def unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 0 else v


# ---------------------------------------------------------------- geometry by material

class Geo:
    """Triangles by material: positions, normals, uvs; and the lit faces (emitters) for the bake."""

    def __init__(self):
        self.parts = {}      # material -> {"p": [], "n": [], "uv": [], "ao": [], "tri": []}
        self.emitters = []   # (centre, normal, area, linear rgb radiance)
        self.walls = []      # (a, b, z0, z1): the fronts the occlusion reads
        self.ground_z = None
        self._fine = None

    @property
    def fine(self):
        """The level's finest parts (a railing's rails, a window's glazing bars, a bench's slats, a plaque's
        rim): geometry in plain materials only, exported as a second model that is fetched and drawn only near
        the camera and never on a phone (hero.js "fine"). Lit by the same lights (the bake reads the level's)."""
        if self._fine is None:
            self._fine = Geo()
            self._fine.emitters, self._fine.walls = self.emitters, self.walls
        return self._fine

    def part(self, mat):
        if mat not in self.parts:
            self.parts[mat] = {"p": [], "n": [], "uv": [], "ao": [], "tri": []}
        return self.parts[mat]

    def quad(self, mat, a, b, c, d, uv=None, n=None, ao=None, sub=None, emit=None):
        """Quad a b c d (counter-clockwise seen from its front); uv per corner (metres by default, from
        the quad's own axes); sub (nu, nv) splits it into a grid for the bake; emit (rgb, k) makes it a
        lit face the bake takes as a light."""
        P = [np.asarray(q, float) for q in (a, b, c, d)]
        if n is None:
            n = unit(np.cross(P[1] - P[0], P[3] - P[0]))
        if uv is None:
            eu, ev = P[1] - P[0], P[3] - P[0]
            lu, lv = np.linalg.norm(eu), np.linalg.norm(ev)
            uv = [(0, 0), (lu, 0), (lu, lv), (0, lv)]
        nu, nv = sub or (1, 1)
        g = self.part(mat)
        base = len(g["p"])
        for j in range(nv + 1):
            t = j / nv
            for i in range(nu + 1):
                s = i / nu
                p = (1 - t) * ((1 - s) * P[0] + s * P[1]) + t * ((1 - s) * P[3] + s * P[2])
                u = (1 - t) * ((1 - s) * np.asarray(uv[0]) + s * np.asarray(uv[1])) + t * ((1 - s) * np.asarray(uv[3]) + s * np.asarray(uv[2]))
                g["p"].append(p); g["n"].append(n); g["uv"].append(u); g["ao"].append(1.0 if ao is None else ao)
        w = nu + 1
        for j in range(nv):
            for i in range(nu):
                k = base + j * w + i
                g["tri"] += [(k, k + 1, k + w + 1), (k, k + w + 1, k + w)]
        if emit is not None:
            rgb, k = emit
            area = np.linalg.norm(np.cross(P[1] - P[0], P[3] - P[0]))
            # a face as small lights about a metre apart, so a long sign lights along its length
            mu, mv = max(1, int(np.linalg.norm(P[1] - P[0]) / 1.2)), max(1, int(np.linalg.norm(P[3] - P[0]) / 1.2))
            for j in range(mv):
                for i in range(mu):
                    s, t = (i + 0.5) / mu, (j + 0.5) / mv
                    c = (1 - t) * ((1 - s) * P[0] + s * P[1]) + t * ((1 - s) * P[3] + s * P[2])
                    self.emitters.append((c + n * 0.05, n, area / (mu * mv), np.asarray(rgb, float) * k))

    def box(self, mat, c, ax, size, uvm=1.0, faces="all", emit=None, ao=None):
        """A box centred at c with axes ax = (u, v) horizontal unit vectors and size (su, sv, sz); z up from c's z."""
        u, v = unit(np.r_[ax[0][:2], 0]), unit(np.r_[ax[1][:2], 0])
        w = np.array([0, 0, 1.0])
        c = np.asarray(c, float)
        hu, hv, hz = size[0] / 2, size[1] / 2, size[2]
        def P(a, b, z): return c + u * a * hu + v * b * hv + w * z
        F = {
            "+u": (P(1, -1, 0), P(1, 1, 0), P(1, 1, hz), P(1, -1, hz)),
            "-u": (P(-1, 1, 0), P(-1, -1, 0), P(-1, -1, hz), P(-1, 1, hz)),
            "+v": (P(1, 1, 0), P(-1, 1, 0), P(-1, 1, hz), P(1, 1, hz)),
            "-v": (P(-1, -1, 0), P(1, -1, 0), P(1, -1, hz), P(-1, -1, hz)),
            "top": (P(-1, -1, hz), P(1, -1, hz), P(1, 1, hz), P(-1, 1, hz)),
            "bot": (P(-1, 1, 0), P(1, 1, 0), P(1, -1, 0), P(-1, -1, 0)),
        }
        for k, q in F.items():
            if faces != "all" and k not in faces:
                continue
            L1, L2 = np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[3] - q[0])
            self.quad(mat, *q, uv=[(0, 0), (L1 * uvm, 0), (L1 * uvm, L2 * uvm), (0, L2 * uvm)], ao=ao,
                      emit=(emit[0], emit[1]) if (emit and k in emit[2]) else None)

    def tube(self, mat, pts, r, segs=8, ao=None):
        """A round tube through pts (a polyline), uv u round, v along (metres)."""
        pts = [np.asarray(p, float) for p in pts]
        g = self.part(mat)
        s_along = 0.0
        rings = []
        for i, p in enumerate(pts):
            t = unit((pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]))
            a = unit(np.cross(t, [0, 0, 1])) if abs(t[2]) < 0.95 else unit(np.cross(t, [1, 0, 0]))
            b = np.cross(t, a)
            if i:
                s_along += np.linalg.norm(p - pts[i - 1])
            base = len(g["p"])
            for k in range(segs + 1):
                th = 2 * math.pi * k / segs
                nn = a * math.cos(th) + b * math.sin(th)
                g["p"].append(p + nn * r); g["n"].append(nn); g["uv"].append((k / segs, s_along)); g["ao"].append(1.0 if ao is None else ao)
            rings.append(base)
        for i in range(len(rings) - 1):
            for k in range(segs):
                a0, a1, b0, b1 = rings[i] + k, rings[i] + k + 1, rings[i + 1] + k, rings[i + 1] + k + 1
                g["tri"] += [(a0, b0, b1), (a0, b1, a1)]

    def cylinder(self, mat, c, r, h, segs=12, cap=True):
        c = np.asarray(c, float)
        self.tube(mat, [c, c + [0, 0, h]], r, segs)
        if cap:
            g = self.part(mat)
            base = len(g["p"])
            top = c + [0, 0, h]
            g["p"].append(top); g["n"].append(np.array([0, 0, 1.0])); g["uv"].append((0.5, 0.5)); g["ao"].append(1.0)
            for k in range(segs):
                th = 2 * math.pi * k / segs
                g["p"].append(top + [r * math.cos(th), r * math.sin(th), 0]); g["n"].append(np.array([0, 0, 1.0]))
                g["uv"].append((0.5 + 0.5 * math.cos(th), 0.5 + 0.5 * math.sin(th))); g["ao"].append(1.0)
            for k in range(segs):
                g["tri"].append((base, base + 1 + k, base + 1 + (k + 1) % segs))

    def lathe(self, mat, c, profile, segs=12, ao=None):
        """A turned shape about the vertical through c: profile [(r, z), ...] from the bottom up (a bollard, a
        lamp's base, an urn). Smooth round, creased where the profile turns."""
        c = np.asarray(c, float)
        g = self.part(mat)
        prof = [np.asarray(q, float) for q in profile]
        for (r0, z0), (r1, z1) in zip(prof[:-1], prof[1:]):
            dr, dz = r1 - r0, z1 - z0
            ln = math.hypot(dr, dz) or 1.0
            base = len(g["p"])
            for (r, z) in ((r0, z0), (r1, z1)):
                for k in range(segs + 1):
                    th = 2 * math.pi * k / segs
                    cs, sn = math.cos(th), math.sin(th)
                    g["p"].append(c + [r * cs, r * sn, z]); g["n"].append(np.array([cs * dz / ln, sn * dz / ln, -dr / ln]))
                    g["uv"].append((k / segs, z)); g["ao"].append(1.0 if ao is None else ao)
            for k in range(segs):
                a0, a1, b0, b1 = base + k, base + k + 1, base + segs + 1 + k, base + segs + 2 + k
                g["tri"] += [(a0, a1, b1), (a0, b1, b0)]

    def mesh(self, mat, P, tri, n=None, uv=None, ao=None):
        """Triangles as given: points P, index triples tri, a normal (one for all, or per point; up by default)
        and uvs (metres from x, y by default): a ground laid on a surface, a leaf."""
        g = self.part(mat)
        base = len(g["p"])
        P = np.asarray(P, float)
        N = np.tile(np.asarray([0, 0, 1.0] if n is None else n, float), (len(P), 1)) if n is None or np.ndim(n) == 1 else np.asarray(n, float)
        U = P[:, :2] if uv is None else np.asarray(uv, float)
        for i in range(len(P)):
            g["p"].append(P[i]); g["n"].append(N[i]); g["uv"].append(U[i]); g["ao"].append(1.0 if ao is None else (ao[i] if np.ndim(ao) else ao))
        g["tri"] += [(base + a, base + b, base + c) for a, b, c in tri]

    def count(self):
        return sum(len(g["tri"]) for g in self.parts.values()), sum(len(g["p"]) for g in self.parts.values())


# ---------------------------------------------------------------- the atlas of drawn things

class Atlas:
    """One image the lit and drawn surfaces share: cells allocated in shelves, each drawn by a function
    taking (img, (x, y, w, h)). uv(key) gives the cell's corners in texture space (v up, as glTF flips)."""

    def __init__(self, size=2048, height=None):
        from PIL import Image
        self.size, self.height = size, height or size
        self.img = Image.new("RGB", (size, self.height), (0, 0, 0))
        self.cells = {}
        self.x = self.y = self.row = 0
        self.mean = {}

    def cell(self, key, w, h, draw):
        if key in self.cells:
            return self.cells[key]
        if self.x + w > self.size:
            self.x, self.y, self.row = 0, self.y + self.row + 2, 0
        if self.y + h > self.height:
            raise ValueError(f"atlas full at {key}")
        r = (self.x, self.y, w, h)
        self.x += w + 2
        self.row = max(self.row, h)
        draw(self.img, r)
        self.cells[key] = r
        a = np.asarray(self.img.crop((r[0], r[1], r[0] + w, r[1] + h)), float) / 255.0
        self.mean[key] = (a ** 2.2).reshape(-1, 3).mean(0)   # its mean linear colour: the light it throws
        return r

    def uv(self, key, flip=False):
        """Corners a b c d (bottom left, bottom right, top right, top left) of a cell, inset half a texel."""
        x, y, w, h = self.cells[key]
        S, T = float(self.size), float(self.height)
        u0, u1 = (x + 0.5) / S, (x + w - 0.5) / S
        v0, v1 = 1 - (y + h - 0.5) / T, 1 - (y + 0.5) / T
        if flip:
            u0, u1 = u1, u0
        return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]

    def sub(self, key, i, n, axis="v", flip=False):
        """Band i of n of a cell (from the top for axis v), as uv corners."""
        q = self.uv(key, flip)
        (u0, v0), (u1, _), (_, v1), _ = q
        if axis == "v":
            a, b = v1 - (v1 - v0) * (i + 1) / n, v1 - (v1 - v0) * i / n
            return [(u0, a), (u1, a), (u1, b), (u0, b)]
        a, b = u0 + (u1 - u0) * i / n, u0 + (u1 - u0) * (i + 1) / n
        return [(a, v0), (b, v0), (b, v1), (a, v1)]


# ---------------------------------------------------------------- the bake

def bake(geo, gain=1.0, near=0.35, walls_ao=True):
    """Every vertex's _BAKE: rgb the irradiance after dark from geo.emitters (each a small area light:
    cosine at the light and at the vertex, inverse square, held at `near` metres), a the occlusion of
    corners from geo.walls and the ground. Lights behind a face, or a face behind a light, give nothing."""
    E = geo.emitters
    out = {}
    if E:
        C = np.array([e[0] for e in E]); N = np.array([e[1] for e in E]); A = np.array([e[2] for e in E]); L = np.array([e[3] for e in E])
    walls = geo.walls
    for mat, g in geo.parts.items():
        P = np.asarray(g["p"], float); Nn = np.asarray(g["n"], float)
        rgb = np.zeros((len(P), 3))
        if E and len(P) and not mat.startswith(("glow", "tube", "chase")):
            for i0 in range(0, len(P), 2048):
                p, n = P[i0:i0 + 2048], Nn[i0:i0 + 2048]
                d = C[None, :, :] - p[:, None, :]                       # vertex -> light
                r2 = np.maximum((d ** 2).sum(-1), near ** 2)
                dn = d / np.sqrt(r2)[..., None]
                cr = np.clip((dn * n[:, None, :]).sum(-1), 0, 1)       # at the vertex
                ce = np.clip(-(dn * N[None, :, :]).sum(-1), 0, 1)      # at the light
                w = cr * ce * A[None, :] / (math.pi * r2)
                rgb[i0:i0 + 2048] = w @ L
        ao = np.asarray(g["ao"], float)
        if walls_ao and walls and len(P):
            occ = np.ones(len(P))
            for (a, b, z0, z1) in walls:
                a2, b2 = np.asarray(a, float)[:2], np.asarray(b, float)[:2]
                e = b2 - a2
                Ln = np.linalg.norm(e)
                if Ln < 0.1:
                    continue
                t = np.clip(((P[:, :2] - a2) @ e) / (Ln * Ln), 0, 1)
                q = a2 + t[:, None] * e
                dist = np.linalg.norm(P[:, :2] - q, axis=1)
                h = P[:, 2] - z0
                # the corner where ground meets wall: darker within half a metre of both
                k = np.exp(-dist / 0.55) * np.exp(-np.maximum(h, 0) / 0.6)
                occ = np.minimum(occ, 1 - 0.55 * k)
            ao = ao * occ
        out[mat] = np.c_[rgb * gain, np.clip(ao, 0, 1)].astype(np.float32)
    return out


# ---------------------------------------------------------------- Blender

def build_blender(geo, bakes, materials, atlas_path=None, name="hero", origin=(0.0, 0.0, 0.0), cell=None):
    """Blender meshes from geo (one object per material, or with `cell` one per material and per square of
    that many metres, so that the page draws only the squares in view and, of the fine model, only those near
    the camera), with their materials from `materials`
    ({name: spec}: color, rough, metal, tex (a TEXTURES key), maps, tint, emissive, map ('atlas'), alpha)."""
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    imgs = {}

    def image(path, colour=True):
        if path not in imgs:
            im = bpy.data.images.load(path)
            im.colorspace_settings.name = "sRGB" if colour else "Non-Color"
            imgs[path] = im
        return imgs[path]

    def make_mat(key, spec):
        m = bpy.data.materials.new(key)
        m.use_nodes = True
        nt = m.node_tree
        bs = nt.nodes["Principled BSDF"]
        col = spec.get("color", (0.8, 0.8, 0.8))
        bs.inputs["Base Color"].default_value = (*col, 1)
        bs.inputs["Roughness"].default_value = spec.get("rough", 0.6)
        bs.inputs["Metallic"].default_value = spec.get("metal", 0.0)
        if spec.get("tint"):       # (the colour factor the texture or the atlas is multiplied by: hero.js sets it from the extras)
            m["tint"] = list(spec["tint"])
        if spec.get("tex"):
            T = fetch_texture(spec["tex"])
            tc = nt.nodes.new("ShaderNodeTexImage"); tc.image = image(T["Color"])
            nt.links.new(tc.outputs["Color"], bs.inputs["Base Color"])
            maps = spec.get("maps", "cnr")   # colour always; "n" its normal map, "r" its roughness (leave out what cannot be seen: memory)
            if "r" in maps:
                tr = nt.nodes.new("ShaderNodeTexImage"); tr.image = image(T["ORM"], False)
                sp = nt.nodes.new("ShaderNodeSeparateColor")
                nt.links.new(tr.outputs["Color"], sp.inputs["Color"])
                nt.links.new(sp.outputs["Green"], bs.inputs["Roughness"]); nt.links.new(sp.outputs["Blue"], bs.inputs["Metallic"])
            if "n" in maps:
                tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = image(T["NormalGL"], False)
                nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = spec.get("bump", 1.0)
                nt.links.new(tn.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], bs.inputs["Normal"])
        if spec.get("map") == "atlas" and atlas_path:
            ta = nt.nodes.new("ShaderNodeTexImage"); ta.image = image(atlas_path)
            nt.links.new(ta.outputs["Color"], bs.inputs["Base Color"])
            if spec.get("emissive"):
                nt.links.new(ta.outputs["Color"], bs.inputs["Emission Color"])
                bs.inputs["Emission Strength"].default_value = spec.get("glow", 1.0)
        elif spec.get("emissive"):
            bs.inputs["Emission Color"].default_value = (*spec["emissive"], 1)
            bs.inputs["Emission Strength"].default_value = spec.get("glow", 1.0)
        if spec.get("alpha") is not None:
            bs.inputs["Alpha"].default_value = spec["alpha"]
            m.surface_render_method = "BLENDED"
        return m

    mats = {k: make_mat(k, materials[k]) for k in geo.parts}
    def pieces(key, g):
        """A material's triangles whole, or by the square their centre lies in (each with its own points)."""
        P = (np.asarray(g["p"], float) - np.asarray(origin, float)).astype(np.float32)
        tri = np.asarray(g["tri"], np.int32)
        if not cell:
            yield key, P, tri, np.asarray(g["uv"], np.float32), np.asarray(g["n"], np.float32), bakes[key]
            return
        c = np.floor(P[tri].mean(1)[:, :2] / cell).astype(int)
        for cx, cy in sorted(set(map(tuple, c))):
            t = tri[(c[:, 0] == cx) & (c[:, 1] == cy)]
            used, inv = np.unique(t.ravel(), return_inverse=True)
            yield (f"{key}_c{cx}_{cy}", P[used], inv.reshape(-1, 3).astype(np.int32), np.asarray(g["uv"], np.float32)[used],
                   np.asarray(g["n"], np.float32)[used], bakes[key][used])

    for key, g in geo.parts.items():
        if not g["tri"]:
            continue
        for pname, P, tri, UVs, Nn, bk in pieces(key, g):
            me = bpy.data.meshes.new(f"{name}_{pname}")
            # (relative to the level's origin, carried by the node: the meshopt filter keeps 16 bits of a
            # coordinate's range, which over a map's kilometres would be centimetres)
            me.vertices.add(len(P)); me.vertices.foreach_set("co", P.ravel())
            me.loops.add(len(tri) * 3); me.loops.foreach_set("vertex_index", tri.ravel())
            me.polygons.add(len(tri)); me.polygons.foreach_set("loop_start", np.arange(0, len(tri) * 3, 3, dtype=np.int32))
            me.update(calc_edges=True)
            uv = me.uv_layers.new(name="UVMap")
            uv.data.foreach_set("uv", UVs[tri.ravel()].ravel())
            me.normals_split_custom_set_from_vertices(Nn)
            b = me.attributes.new("_BAKE", "FLOAT_COLOR", "POINT")
            b.data.foreach_set("color", np.ascontiguousarray(bk).ravel())
            me.materials.append(mats[key])
            ob = bpy.data.objects.new(f"{name}_{pname}", me)
            ob.location = origin
            sc.collection.objects.link(ob)
    return sc


def export(path, webp_quality=82):
    import bpy
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(filepath=path, export_format="GLB", export_attributes=True, export_image_format="WEBP",
              export_image_quality=webp_quality, export_yup=True, export_apply=True, export_extras=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="NONE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
