"""Rebuild a city's web scene in Blender, headless, from the same data files, and
render it with Cycles: no hand modelling, no stock assets, one command. The
buildings (walls, pitched roofs, facades, rooftops) are built by buildings.py
from the same buildings.json the browser reads. If the city has a game, the
helicopter and ferries it shares with every city are placed where the game puts
them (--no-vehicles leaves them out).

    pip install bpy==5.2.3        # Blender as a Python module (Python 3.13)
    python blender/build_scene.py --city sydney --samples 48
    python blender/build_scene.py --city sydney --views opera --res 2400x1350

The views (camera, target, local date and time) are the "renders" list in
cities/<city>/city.json; the sun comes from the same NOAA equations as
web/sun.js and the city's IANA time zone. Writes docs/images/<city>/<view>.jpg
plus render_log.json (timings, object and triangle counts) and, with --blend,
the .blend file.
"""
import argparse
import base64
import datetime as dt
import json
import math
import os
import sys
import time
from zoneinfo import ZoneInfo

import bpy
import numpy as np
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

from buildings import add_buildings, set_lighting

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ------------------------------------------------------------ sun (same NOAA equations as web/sun.js)

def local_to_utc(tz, y, m, d, hhmm):
    """Clock time in the city's time zone -> an aware UTC datetime."""
    h, mi = map(int, hhmm.split(":"))
    return dt.datetime(y, m, d, h, mi, tzinfo=ZoneInfo(tz)).astimezone(dt.timezone.utc)


def sun_position(when, lat, lon):
    jd = when.timestamp() / 86400 + 2440587.5
    T = (jd - 2451545) / 36525
    L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360
    M = 357.52911 + T * (35999.05029 - 0.0001537 * T)
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T)
    r = math.radians
    C = math.sin(r(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + math.sin(r(2 * M)) * (0.019993 - 0.000101 * T) + math.sin(r(3 * M)) * 0.000289
    om = 125.04 - 1934.136 * T
    lam = L0 + C - 0.00569 - 0.00478 * math.sin(r(om))
    eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * math.cos(r(om))
    decl = math.asin(math.sin(r(eps)) * math.sin(r(lam)))
    yv = math.tan(r(eps) / 2) ** 2
    eqt = 4 * math.degrees(yv * math.sin(2 * r(L0)) - 2 * e * math.sin(r(M)) + 4 * e * yv * math.sin(r(M)) * math.cos(2 * r(L0))
                           - 0.5 * yv * yv * math.sin(4 * r(L0)) - 1.25 * e * e * math.sin(2 * r(M)))
    utc_min = when.hour * 60 + when.minute + when.second / 60
    tst = (utc_min + eqt + 4 * lon) % 1440
    ha = r(tst / 4 - 180)
    phi = r(lat)
    zen = math.acos(max(-1, min(1, math.sin(phi) * math.sin(decl) + math.cos(phi) * math.cos(decl) * math.cos(ha))))
    az = (math.degrees(math.atan2(math.sin(ha), math.cos(ha) * math.sin(phi) - math.tan(decl) * math.cos(phi))) + 180) % 360
    return 90 - math.degrees(zen), az


# ------------------------------------------------------------ helpers

def srgb_to_linear(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def principled(name, color=None, rough=0.6, metal=0.0, emission=None, image=None, vcol=None, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if color:
        bsdf.inputs["Base Color"].default_value = (*srgb_to_linear(color), 1)
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(image)
        tex.extension = "EXTEND"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if vcol:
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = vcol
        nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
    return mat


def landmark_material(name, mt, image, floodlit):
    """A landmark's material as the viewer draws it: its colour, or the image its city drew
    (landmarks.json "map"), and after dark the glow of a floodlit mesh (in the image's own
    colours with "emissive_map"), switched by the "lm_night" value that set_landmark_night sets."""
    mat = principled(name, None if image else mt["color"], mt["roughness"], mt["metalness"], image=image)
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
    if tex is not None and mt.get("cutout"):
        nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    if mt.get("opacity", 1.0) < 1.0:  # glass and nets
        bsdf.inputs["Alpha"].default_value = mt["opacity"]
    if floodlit:
        night = nt.nodes.new("ShaderNodeValue")
        night.name = "lm_night"
        night.outputs[0].default_value = 0.0
        glow = nt.nodes.new("ShaderNodeMath")
        glow.operation = "MULTIPLY"
        glow.inputs[1].default_value = 4.0 * mt.get("glow", 0.32)
        nt.links.new(night.outputs[0], glow.inputs[0])
        if tex is not None and mt.get("emissive_map"):
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        else:
            bsdf.inputs["Emission Color"].default_value = (*srgb_to_linear(mt.get("emissive", "#ffe2b8")), 1)
        nt.links.new(glow.outputs[0], bsdf.inputs["Emission Strength"])
    return mat


def set_landmark_night(night):
    for mat in bpy.data.materials:
        n = mat.node_tree.nodes.get("lm_night") if mat.node_tree else None
        if n is not None:
            n.outputs[0].default_value = 1.0 if night else 0.0


def mesh_object(name, verts, faces, mat, uvs=None, colors=None, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    if uvs is not None:
        uv = me.uv_layers.new(name="UV")
        loop_vi = np.zeros(len(me.loops), dtype=np.int32)
        me.loops.foreach_get("vertex_index", loop_vi)
        uv.data.foreach_set("uv", np.asarray(uvs, dtype=np.float32)[loop_vi].ravel())
    if colors is not None:
        attr = me.color_attributes.new("col", "FLOAT_COLOR", "CORNER")
        loop_vi = np.zeros(len(me.loops), dtype=np.int32)
        me.loops.foreach_get("vertex_index", loop_vi)
        attr.data.foreach_set("color", np.asarray(colors, dtype=np.float32)[loop_vi].ravel())
    if smooth:
        me.shade_smooth()
    me.validate()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(mat)
    bpy.context.collection.objects.link(ob)
    return ob


# ------------------------------------------------------------ scene

def build(data):
    scene = json.load(open(os.path.join(data, "scene.json")))
    B = json.load(open(os.path.join(data, "buildings.json")))
    LM = json.load(open(os.path.join(data, "landmarks.json")))
    P = json.load(open(os.path.join(data, "places.json")))
    tinfo = scene["terrain"]
    raw = base64.b64decode(json.load(open(os.path.join(data, "terrain.json")))["data"])
    terr = np.frombuffer(raw, dtype="<i2").astype(np.float32).reshape(tinfo["ny"], tinfo["nx"]) * tinfo["scale"]
    x0, y1, cell = scene["frame"]["x"][0], scene["frame"]["y"][1], tinfo["cell"]

    def h_at(x, y):
        c = min(max((x - x0) / cell, 0), tinfo["nx"] - 1.001)
        r = min(max((y1 - y) / cell, 0), tinfo["ny"] - 1.001)
        c0, r0 = int(c), int(r)
        fc, fr = c - c0, r - r0
        return ((terr[r0, c0] * (1 - fc) + terr[r0, c0 + 1] * fc) * (1 - fr) + (terr[r0 + 1, c0] * (1 - fc) + terr[r0 + 1, c0 + 1] * fc) * fr)

    counts = {"objects": 0, "triangles": 0}

    # ground tiles with the aerial imagery
    for t in scene["ground"]:
        nx, ny = int((t["x1"] - t["x0"]) / cell) + 1, int((t["y1"] - t["y0"]) / cell) + 1
        xs, ys = np.linspace(t["x0"], t["x1"], nx), np.linspace(t["y0"], t["y1"], ny)
        verts, uvs, faces = [], [], []
        for j, y in enumerate(ys):
            for i, x in enumerate(xs):
                verts.append((x, y, float(h_at(x, y))))
                uvs.append((i / (nx - 1), j / (ny - 1)))
        for j in range(ny - 1):
            for i in range(nx - 1):
                a = j * nx + i
                faces.append((a, a + 1, a + nx + 1, a + nx))
        mat = principled(f"ground_{t['file']}", rough=0.95, image=os.path.join(data, t["file"]))
        mesh_object(t["file"], verts, faces, mat, uvs=uvs)
        counts["objects"] += 1
        counts["triangles"] += 2 * len(faces)

    def up_tris(loops):  # tessellate a footprint with every triangle facing up
        flat = [p for loop in loops for p in loop]
        out = []
        for tri in tessellate_polygon(loops):
            a, b, c = (flat[i] for i in tri)
            ccw = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0
            out.append(tri if ccw else (tri[0], tri[2], tri[1]))
        return flat, out

    # buildings: walls with the facade grid, LOD2 roofs, parapets, awnings and rooftop plant (buildings.py)
    bc = add_buildings(B, scene)
    counts["objects"] += 4
    counts["triangles"] += 2 * bc["wall_faces"] + bc["roof_faces"] + 2 * bc["trim_faces"] + 10 * bc["plant_boxes"]
    counts["buildings"] = len(B["b"])
    counts["roofs"] = len(B.get("r", []))

    # piers
    pv, pf = [], []
    for r in P.get("piers", []):
        r = np.asarray(r, float).reshape(-1, 2) / 10
        base = len(pv)
        loop, tris = up_tris([[Vector((p[0], p[1], 2.2)) for p in r]])
        pv += [tuple(p) for p in loop]
        pf += [tuple(base + i for i in tri) for tri in tris]
    if pf:
        mesh_object("piers", pv, pf, principled("pier", "#a7a59d", 0.9))

    # OSM trees: one merged mesh of low-poly crowns (heights are not mapped; 7-14 m spread)
    tr = np.asarray(P.get("trees", []), float).reshape(-1, 4) / 10
    if len(tr):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1)
        ico = bpy.context.active_object
        iv = np.array([v.co[:] for v in ico.data.vertices])
        ifc = [tuple(p.vertices) for p in ico.data.polygons]
        bpy.data.objects.remove(ico)
        tv, tf, tc = [], [], []
        greens = [srgb_to_linear(c) + [1] for c in ("#3f5f2e", "#4d6b34", "#56743a", "#38552b", "#5f7a3f")]
        for k, (x, y, z, h) in enumerate(tr):
            r = h * 0.32
            base = len(tv)
            tv += [tuple(v) for v in iv * [r, r, r * 1.1] + [x, y, z + h - r]]
            tf += [tuple(base + i for i in f) for f in ifc]
            tc += [greens[int(h * 70) % 5]] * len(iv)
        mesh_object("trees", tv, tf, principled("trees", rough=0.9, vcol="col"), colors=tc)
        counts["objects"] += 1
        counts["triangles"] += len(tf)
        counts["trees"] = len(tr)

    # landmarks from the shared parametric meshes
    for m in LM["meshes"]:
        mt = LM["materials"][m["material"]]
        p = np.asarray(m["position"], float).reshape(-1, 3)
        idx = np.asarray(m["index"], int).reshape(-1, 3)
        image = os.path.join(data, mt["map"]) if mt.get("map") else None
        mat = landmark_material(m["name"], mt, image, m.get("floodlit", False))
        uvs = np.asarray(m["uv"], float).reshape(-1, 2) if image and "uv" in m else None
        mesh_object(m["name"], [tuple(v) for v in p], [tuple(f) for f in idx], mat, uvs=uvs, smooth=m["smooth"])
        counts["objects"] += 1
        counts["triangles"] += len(idx)

    # sea level: the ground mesh sits above it on land, so one plane is all the water. It is
    # 10 cm up so that it covers the shore cells the terrain puts at exactly 0 m, which would
    # be coplanar with it, and Cycles shades coplanar faces black.
    bpy.ops.mesh.primitive_plane_add(size=200000, location=(0, 0, 0.1))
    water = bpy.context.active_object
    water.name = "water"
    wmat = principled("water", "#16303f", 0.07, 0.0)
    nt = wmat.node_tree
    coord, noise, bump = nt.nodes.new("ShaderNodeTexCoord"), nt.nodes.new("ShaderNodeTexNoise"), nt.nodes.new("ShaderNodeBump")
    noise.inputs["Scale"].default_value = 0.12  # object space is metres here: ripples about 8 m across
    noise.inputs["Detail"].default_value = 6
    bump.inputs["Strength"].default_value = 0.15
    nt.links.new(coord.outputs["Object"], noise.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], nt.nodes["Principled BSDF"].inputs["Normal"])
    water.data.materials.append(wmat)
    return scene, counts


def add_vehicles(data, counts):
    """The game's helicopter and ferries, which every city shares (web/assets/vehicles,
    from blender/build_vehicles.py), in the city's livery: the helicopter on the first
    helipad, and a ferry a third of the way along the first leg of each route."""
    vdir = os.path.join(ROOT, "web", "assets", "vehicles")
    gpath = os.path.join(data, "game.json")
    if not (os.path.exists(gpath) and os.path.exists(os.path.join(vdir, "vehicles.json"))):
        return
    G = json.load(open(gpath, encoding="utf8"))
    info = json.load(open(os.path.join(vdir, "vehicles.json")))

    def livery(kind):
        I, spec = info[kind], (G.get("vehicles") or {}).get(kind, {}).get("livery")
        base = I["liveries"][I["default_livery"]]
        style = G.get("ferry_style") or {}
        if kind == "ferry" and spec is None and style.get("hull"):  # as the game does: the colours of the city's ferry_style
            spec = {"hull": style["hull"], "band": style.get("trim"), "cabin": style.get("upper"), "trim": style.get("upper"), "flag": style.get("flag")}
            spec = {k: v for k, v in spec.items() if v}
        if isinstance(spec, str):
            return I["liveries"].get(spec, base)
        return dict(base, **(spec or {}))

    def place(kind, x, y, z, heading):
        before = set(o.name for o in bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(vdir, info[kind]["file"]))
        new = [o for o in bpy.data.objects if o.name not in before]
        root = bpy.data.objects.new(kind, None)
        bpy.context.collection.objects.link(root)
        colours, paint = livery(kind), info[kind]["paint"]
        for o in new:
            if o.name.startswith("Body_LOD1"):
                bpy.data.objects.remove(o)
                continue
            if o.parent is None:
                o.parent = root
            for m in (o.data.materials if o.type == "MESH" else []):
                b = m.node_tree.nodes.get("Principled BSDF") if m.node_tree else None
                key = m.name.split(".")[0]
                if b is None:
                    continue
                if key in paint and paint[key] in colours:
                    b.inputs["Base Color"].default_value = (*srgb_to_linear(colours[paint[key]]), 1)
                if key.startswith("Decal_"):     # names are drawn by the game
                    b.inputs["Alpha"].default_value = 0
            if o.type == "MESH":
                counts["objects"] += 1
                counts["triangles"] += sum(len(p.vertices) - 2 for p in o.data.polygons)
        # model forward is -y; a heading is clockwise from north
        root.location = (x, y, z)
        root.rotation_euler = (0, 0, math.pi - heading)

    if G.get("helipads"):
        hx, hy, hz = G["helipads"][0]["at"]
        place("helicopter", hx, hy, hz, 0.6)
    for r in G.get("ferries", []):
        p = r["legs"][0]["path"]
        cum = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(np.asarray(p, float), axis=0).T))])
        s = cum[-1] / 3
        i = int(np.searchsorted(cum, s))
        (ax, ay), (bx, by) = p[i - 1], p[i]
        t = (s - cum[i - 1]) / max(1e-6, cum[i] - cum[i - 1])
        place("ferry", ax + (bx - ax) * t, ay + (by - ay) * t, 0, math.atan2(bx - ax, by - ay))


def set_sky(alt, az, night):
    world = bpy.data.worlds.new("sky")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    sky = nt.nodes.new("ShaderNodeTexSky")
    for kind in ("MULTIPLE_SCATTERING", "SINGLE_SCATTERING", "NISHITA", "HOSEK_WILKIE"):
        try:
            sky.sky_type = kind
            break
        except TypeError:
            continue
    if hasattr(sky, "sun_elevation"):
        sky.sun_elevation = math.radians(max(alt, -5))
        sky.sun_rotation = math.radians(90 - az)  # Blender measures from +x, counter-clockwise
    if hasattr(sky, "sun_disc"):
        sky.sun_disc = False  # the sun lamp provides the direct light
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.18 if not night else 0.02
    return sky.sky_type


def add_sun(alt, az):
    data = bpy.data.lights.new("sun", "SUN")
    data.energy = 3.2 * max(0.0, min(1.0, (alt + 1) / 10))
    data.angle = math.radians(0.53)
    warm = max(0.0, min(1.0, (alt - 2) / 28))
    data.color = (1.0, 0.72 + 0.24 * warm, 0.5 + 0.42 * warm)
    ob = bpy.data.objects.new("sun", data)
    d = Vector((math.sin(math.radians(az)) * math.cos(math.radians(alt)), math.cos(math.radians(az)) * math.cos(math.radians(alt)),
                math.sin(math.radians(alt))))
    ob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    bpy.context.collection.objects.link(ob)
    return ob


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", default="sydney")
    ap.add_argument("--views", nargs="+", help="names from city.json renders (default: all)")
    ap.add_argument("--samples", type=int, default=48)
    ap.add_argument("--res", default="1600x900")
    ap.add_argument("--blend", action="store_true")
    ap.add_argument("--out", help="output folder (default docs/images/<city>)")
    ap.add_argument("--no-vehicles", action="store_true", help="leave out the game's helicopter and ferries")
    a = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    cfg = json.load(open(os.path.join(ROOT, "cities", a.city, "city.json"), encoding="utf8"))
    lon, lat = cfg["origin"]
    views = {v["name"]: v for v in cfg.get("renders", [])}
    if not views:
        raise SystemExit(f"{a.city}: no renders in city.json")
    data, out = os.path.join(ROOT, "web", "data", a.city), a.out or os.path.join(ROOT, "docs", "images", a.city)
    os.makedirs(out, exist_ok=True)
    log = {"city": a.city, "blender": bpy.app.version_string, "views": {}}
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene, counts = build(data)
    if not a.no_vehicles:
        add_vehicles(data, counts)
    log["build_s"] = round(time.time() - t0, 1)
    log.update(counts)
    print(f"scene built in {log['build_s']} s: {counts}")

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = a.samples
    sc.cycles.use_denoising = True
    w, h = map(int, a.res.split("x"))
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.image_settings.file_format = "JPEG"
    sc.render.image_settings.quality = 88
    sc.view_settings.view_transform = "AgX" if "AgX" in [v.identifier for v in type(sc.view_settings).bl_rna.properties["view_transform"].enum_items] else "Filmic"
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 35
    cam_data.clip_start, cam_data.clip_end = 2, 150000
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, f"{a.city}.blend"))
    for name in a.views or list(views):
        v = views[name]
        alt, az = sun_position(local_to_utc(cfg["timezone"], *v["date"], v["time"]), lat, lon)
        for ob in [o for o in bpy.data.objects if o.type == "LIGHT"]:
            bpy.data.objects.remove(ob)
        add_sun(alt, az)
        sky = set_sky(alt, az, alt < -4)
        hh, mm = map(int, v["time"].split(":"))
        set_lighting(hh + mm / 60, alt < -4)
        set_landmark_night(alt < -4)
        p, t = v["cam"], v["tgt"]
        cam.location = p
        cam.rotation_euler = (Vector(t) - Vector(p)).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(out, f"{name}.jpg")
        t1 = time.time()
        bpy.ops.render.render(write_still=True)
        log["views"][name] = {"date": "-".join(map(str, v["date"])), "time": v["time"], "sun_altitude": round(alt, 2),
                              "sun_azimuth": round(az, 2), "sky": sky, "samples": a.samples, "resolution": a.res,
                              "render_s": round(time.time() - t1, 1)}
        print(name, log["views"][name])
    log["total_s"] = round(time.time() - t0, 1)
    path = os.path.join(out, "render_log.json")
    if a.views and os.path.exists(path):  # a subset of views: keep the others' entries
        log["views"] = {**json.load(open(path)).get("views", {}), **log["views"]}
    json.dump(log, open(path, "w"), indent=1)


if __name__ == "__main__":
    main()
