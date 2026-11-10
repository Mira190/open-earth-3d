"""Hachiko: the bronze Akita on Hachiko Square, sculpted (pipeline/sculptkit.py), and his pedestal.

The statue is Ando Takeshi's 1948 recast of his father Ando Teru's 1934 statue (the first went for
metal in 1944). He sits up on his haunches, forelegs long and straight, a broad chest with a strap collar
round it, his heavy head raised and turned a little to his left, a short blunt muzzle, small thick
ears set wide, the left one bent forward; his thighs thick at his sides and his tail curled over his
back; all of it on a rough bronze slab cast with him. From
photographs (Wikimedia Commons, July 2025, front and three-quarter views; see docs/cities/shibuya.md):
the bronze is dark brown with a green bloom in its hollows, and his forelegs and paws are rubbed to
gold by the hands that touch them. He sits on a speckled grey granite plinth with a bronze plate,
忠犬ハチ公 set vertically, on a darker granite step clad in small square tiles.

Sizes: the 1934 statue was published as 162 cm on a 180 cm pedestal; the pedestal was lowered in 1989.
Today's are estimates from the photographs, scaled from the plinth: the plinth about 0.95 x 0.95 m and
1.15 m high on a 0.38 m step, the dog about 0.95 m from his paws to his ears.

Frame: u forward (the way he looks), v to his left, z up from the top of the plinth; metres.
"""
import numpy as np

import sculptkit as sk

STEP = {"w": 1.55, "d": 1.55, "h": 0.38}     # the dark granite step
PLINTH = {"w": 0.95, "d": 0.95, "h": 1.15}   # the speckled granite plinth
CELL = 0.017                                 # the sculpt's grid (1.7 cm)
BASE = 0.07                                  # the bronze slab he sits on, cast with him: its thickness


def posed(f, origin, yaw_deg, pitch_deg):
    """A shape built in its own frame (x forward, y left, z up, origin at `origin`) turned by yaw (to his left)
    and pitch (nose up): the head, raised and turned as he looks out for the train."""
    o = np.asarray(origin, float)
    cy, sy = np.cos(np.radians(yaw_deg)), np.sin(np.radians(yaw_deg))
    cp, sp = np.cos(np.radians(pitch_deg)), np.sin(np.radians(pitch_deg))

    def g(u, v, z):
        x, y, w = u - o[0], v - o[1], z - o[2]
        x, y = x * cy + y * sy, -x * sy + y * cy        # (undo the yaw)
        x, w = x * cp + w * sp, -x * sp + w * cp        # (undo the pitch)
        return f(x, y, w)
    return g


def ear(base, tip, face, r0=0.05, thick=0.016):
    """An Akita's ear: a thick triangle from a broad base to a rounded tip, flat across `face` (the way it faces)."""
    cone = sk.capsule(base, tip, r0, 0.009)
    b, n = np.asarray(base, float), np.asarray(face, float) / np.linalg.norm(face)
    slab = lambda u, v, z: np.abs((u - b[0]) * n[0] + (v - b[1]) * n[1] + (z - b[2]) * n[2]) - thick
    return lambda u, v, z: np.maximum(cone(u, v, z), slab(u, v, z))


def strap(c, axis, R, width, thick):
    """A flat strap round a circle of radius R about `axis` through c: a collar, `width` tall and `thick` deep."""
    c, n = np.asarray(c, float), np.asarray(axis, float) / np.linalg.norm(axis)

    def f(u, v, z):
        px, py, pz = u - c[0], v - c[1], z - c[2]
        h = px * n[0] + py * n[1] + pz * n[2]
        q = np.sqrt(np.maximum((px - n[0] * h) ** 2 + (py - n[1] * h) ** 2 + (pz - n[2] * h) ** 2, 0.0))
        dx, dy = np.abs(q - R) - thick / 2, np.abs(h) - width / 2
        return np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dy, 0) ** 2) + np.minimum(np.maximum(dx, dy), 0.0) - 0.004
    return f


def head():
    """His head in its own frame, at the middle of the skull: broad and heavy, a short blunt muzzle, small
    thick ears set wide on the corners of the skull, the right one up and the left one bent forward (as his
    was in life and is on the statue)."""
    L = sk.mirror_v
    skull = sk.ellipsoid((-0.01, 0.0, 0.0), (0.11, 0.136, 0.1))
    crown = sk.ellipsoid((-0.03, 0.0, 0.045), (0.085, 0.11, 0.065))
    cheeks = L(sk.ellipsoid((0.03, 0.07, -0.035), (0.07, 0.065, 0.062)))
    muzzle = sk.capsule((0.08, 0.0, -0.045), (0.19, 0.0, -0.052), 0.058, 0.05)
    bridge = sk.capsule((0.08, 0.0, -0.01), (0.19, 0.0, -0.03), 0.03, 0.026)
    lips = L(sk.ellipsoid((0.14, 0.028, -0.078), (0.06, 0.032, 0.028)))
    jaw = sk.ellipsoid((0.10, 0.0, -0.1), (0.075, 0.048, 0.028))
    nose = sk.ellipsoid((0.238, 0.0, -0.035), (0.022, 0.032, 0.024))
    brows = L(sk.ellipsoid((0.07, 0.046, 0.028), (0.038, 0.04, 0.03)))
    ear_r = ear((-0.04, -0.1, 0.07), (-0.025, -0.145, 0.195), (0.95, -0.2, 0.2), 0.06, 0.02)
    ear_l = ear((-0.035, 0.1, 0.068), (0.06, 0.185, 0.14), (0.5, 0.3, 0.8), 0.06, 0.02)
    h = sk.smooth_union(0.035, skull, crown, cheeks, brows)
    h = sk.smooth_union(0.026, h, muzzle, bridge, lips, jaw)
    h = sk.smooth_union(0.012, h, nose)
    h = sk.smooth_union(0.022, h, ear_r, ear_l)
    for s in (-1, 1):   # the eyes, small and deep under the brow, and the line of the mouth
        h = sk.subtract(0.006, h, sk.ellipsoid((0.088, s * 0.056, 0.01), (0.012, 0.018, 0.011)))
    h = sk.subtract(0.004, h, sk.capsule((0.225, 0.0, -0.075), (0.12, 0.0, -0.086), 0.006))
    return h


def akita():
    """The dog, and the bronze slab under him, as a signed distance field in the statue's frame (z up from the
    slab's top). Proportions from the photographs: paws to ear tips about 1.09 m, the forelegs' outer edges
    0.44 m apart, the chest and the skull each about 0.3 m across, the collar 0.57 m up."""
    L = sk.mirror_v
    paws = L(sk.ellipsoid((0.215, 0.12, 0.034), (0.075, 0.056, 0.036)))
    forelegs = L(sk.capsule((0.20, 0.125, 0.05), (0.175, 0.12, 0.46), 0.046, 0.054))
    elbows = L(sk.capsule((0.175, 0.12, 0.44), (0.20, 0.13, 0.60), 0.062, 0.078))
    brisket = sk.ellipsoid((0.17, 0.0, 0.56), (0.125, 0.175, 0.16))
    shoulders = L(sk.ellipsoid((0.07, 0.11, 0.66), (0.11, 0.085, 0.14)))
    torso = sk.capsule((0.08, 0.0, 0.62), (-0.15, 0.0, 0.26), 0.17, 0.185)
    rump = sk.ellipsoid((-0.17, 0.0, 0.17), (0.17, 0.165, 0.16))
    thighs = L(sk.ellipsoid((-0.08, 0.15, 0.19), (0.22, 0.095, 0.175)))
    hocks = L(sk.capsule((-0.19, 0.18, 0.055), (0.06, 0.19, 0.035), 0.042, 0.034))
    hind_feet = L(sk.ellipsoid((0.11, 0.19, 0.032), (0.085, 0.05, 0.034)))
    neck = sk.capsule((0.11, 0.0, 0.60), (0.15, 0.0, 0.86), 0.14, 0.12)
    scruff = sk.ellipsoid((0.04, 0.0, 0.80), (0.10, 0.12, 0.10))
    tail = sk.path([(-0.30, 0.0, 0.26), (-0.34, -0.04, 0.36), (-0.31, -0.11, 0.43), (-0.24, -0.16, 0.42), (-0.20, -0.17, 0.34), (-0.22, -0.15, 0.27)],
                   [0.058, 0.062, 0.06, 0.054, 0.046, 0.034])
    hd = posed(head(), (0.16, 0.0, 0.93), 6.0, 13.0)
    body = sk.smooth_union(0.05, torso, brisket, shoulders, rump, thighs, neck, scruff)
    legs = sk.smooth_union(0.03, forelegs, elbows, paws, hocks, hind_feet)
    dog = sk.smooth_union(0.035, body, legs)
    dog = sk.smooth_union(0.05, dog, hd)
    dog = sk.smooth_union(0.03, dog, tail)
    # the collar: a broad strap round his neck, low on his chest in front, and its buckle's tab
    collar = strap((0.13, 0.0, 0.70), (0.7, 0.0, 1.0), 0.18, 0.05, 0.022)
    tab = sk.box((0.292, 0.0, 0.53), (0.01, 0.026, 0.06), 0.006)
    dog = sk.smooth_union(0.008, dog, collar, tab)
    dog = sk.roughen(dog, 0.005, 0.028, seed=1948)
    # the slab he sits on, cast with him: rough, its edges uneven
    slab = sk.roughen(sk.box((0.0, 0.0, -BASE / 2 - 0.005), (0.40, 0.30, BASE / 2 + 0.005), 0.025), 0.007, 0.05, seed=7)
    return sk.smooth_union(0.02, dog, slab)


def sculpt():
    """(vertices, triangles, worn): the statue's mesh in its frame (z up from the plinth's top), and which
    triangles are rubbed bright (his forelegs and paws, where people touch him)."""
    v, t = sk.mesh(akita(), (-0.44, -0.34, -BASE - 0.03), (0.44, 0.34, 1.13), CELL)
    v = sk.relax(v, t, 0.4, 1)
    v[:, 2] += BASE + 0.005
    c = v[t].mean(1)
    z = c[:, 2] - BASE
    # the rubbed bronze: his forelegs and paws (the front of the legs, below the elbow), not the slab
    nrm = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
    # (the faces turned towards the people in front of him, and the tops of the paws, rubbed most)
    worn = (c[:, 0] > 0.14) & (z > 0.005) & (z < 0.42) & (np.abs(c[:, 1]) < 0.18) & ((nrm[:, 0] > 0.35) | (z < 0.07))
    return v, t, worn
