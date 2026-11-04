"""Hachiko: the bronze Akita on Hachiko Square, sculpted (pipeline/sculptkit.py), and his pedestal.

The statue is Ando Takeshi's 1948 recast of his father Ando Teru's 1934 statue (the first went for
metal in 1944). He sits up on his haunches, forelegs straight and close together, chest out, head up
and turned a little, ears pricked; a collar round his neck; his tail curled up on his rump. From
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
CELL = 0.018                                 # the sculpt's grid (1.4 cm)


def akita():
    """The dog as a signed distance field in the statue's frame."""
    L = sk.mirror_v   # (a pair, mirrored across his spine)
    paws = L(sk.ellipsoid((0.28, 0.09, 0.034), (0.08, 0.055, 0.036)))
    forelegs = L(sk.capsule((0.26, 0.09, 0.05), (0.205, 0.10, 0.40), 0.047, 0.058))
    upper_arms = L(sk.capsule((0.205, 0.10, 0.40), (0.13, 0.115, 0.56), 0.064, 0.08))
    shoulders = L(sk.ellipsoid((0.09, 0.105, 0.56), (0.11, 0.075, 0.14)))
    brisket = sk.ellipsoid((0.15, 0.0, 0.54), (0.13, 0.165, 0.175))
    torso = sk.capsule((0.08, 0.0, 0.52), (-0.13, 0.0, 0.24), 0.162, 0.17)
    rump = sk.ellipsoid((-0.15, 0.0, 0.13), (0.15, 0.15, 0.13))
    thighs = L(sk.ellipsoid((-0.08, 0.125, 0.16), (0.215, 0.085, 0.155)))
    hocks = L(sk.capsule((-0.19, 0.15, 0.055), (0.07, 0.16, 0.03), 0.038, 0.032))
    hind_feet = L(sk.ellipsoid((0.10, 0.16, 0.03), (0.095, 0.045, 0.033)))
    neck = sk.capsule((0.10, 0.0, 0.60), (0.155, 0.0, 0.78), 0.125, 0.105)
    skull = sk.ellipsoid((0.165, 0.0, 0.835), (0.118, 0.112, 0.098))
    cheeks = L(sk.ellipsoid((0.195, 0.055, 0.80), (0.085, 0.065, 0.062)))
    muzzle = sk.capsule((0.24, 0.0, 0.80), (0.298, 0.0, 0.79), 0.06, 0.047)
    jaw = sk.ellipsoid((0.255, 0.0, 0.765), (0.06, 0.038, 0.026))
    nose = sk.ellipsoid((0.334, 0.0, 0.80), (0.018, 0.026, 0.018))
    brow = L(sk.ellipsoid((0.235, 0.036, 0.858), (0.038, 0.034, 0.024)))
    ears = L(sk.capsule((0.14, 0.072, 0.895), (0.142, 0.092, 0.975), 0.044, 0.01))
    tail = sk.path([(-0.24, 0.0, 0.26), (-0.30, 0.03, 0.37), (-0.26, 0.085, 0.46), (-0.16, 0.10, 0.44), (-0.135, 0.075, 0.35)],
                   [0.048, 0.050, 0.044, 0.036, 0.026])
    body = sk.smooth_union(0.045, torso, brisket, shoulders, rump, thighs, neck)
    legs = sk.smooth_union(0.03, forelegs, upper_arms, paws, hocks, hind_feet)
    head = sk.smooth_union(0.03, skull, cheeks, muzzle, jaw, brow, nose)
    dog = sk.smooth_union(0.035, body, legs)
    dog = sk.smooth_union(0.04, dog, head)
    dog = sk.smooth_union(0.018, dog, ears)
    dog = sk.smooth_union(0.03, dog, tail)
    collar = sk.torus((0.128, 0.0, 0.665), (0.62, 0.0, 1.0), 0.098, 0.015)
    dog = sk.smooth_union(0.008, dog, collar)
    # the eyes: small hollows under the brow
    for s in (-1, 1):
        dog = sk.subtract(0.006, dog, sk.sphere((0.262, s * 0.054, 0.838), 0.014))
    return sk.roughen(dog, 0.0035, 0.018, seed=1948)


def sculpt():
    """(vertices, triangles, worn): the statue's mesh in its frame, and which triangles are rubbed bright
    (his forelegs and paws, where people touch him)."""
    v, t = sk.mesh(akita(), (-0.36, -0.24, -0.02), (0.38, 0.24, 1.04), CELL)
    v = sk.relax(v, t, 0.4, 1)
    c = v[t].mean(1)
    worn = (c[:, 0] > 0.17) & (c[:, 2] < 0.43)
    return v, t, worn
