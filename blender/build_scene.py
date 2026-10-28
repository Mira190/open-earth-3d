"""Rebuild a city's web scene in Blender, headless, from the same data files, and
render it with Cycles: no hand modelling, no stock assets, one command. The
buildings (walls, pitched roofs, facades, rooftops) are built by buildings.py
from the same buildings.json the browser reads.

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
        loop = [Vector((p[0], p[1], 2.2)) for p in r]
        base = len(pv)
        pv += [tuple(p) for p in loop]
        pf += [tuple(base + i for i in tri) for tri in tessellate_polygon([loop])]
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
        mat = principled(m["name"], mt["color"], mt["roughness"], mt["metalness"])
        mesh_object(m["name"], [tuple(v) for v in p], [tuple(f) for f in idx], mat, smooth=m["smooth"])
        counts["objects"] += 1
        counts["triangles"] += len(idx)

    # sea level: the ground mesh sits above it on land, so one plane is all the water
    bpy.ops.mesh.primitive_plane_add(size=200000, location=(0, 0, 0))
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
    json.dump(log, open(os.path.join(out, "render_log.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
