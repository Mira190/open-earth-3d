"""Parts for Kyoto's temples and shrines built in code: the two-storey gate (楼門), the eight-legged
gate (八脚門), pagodas, the hanging stage on its lattice of pillars (懸造), torii, stone lanterns, paper
lanterns, and stone paving and steps laid along a mapped path.

Used by cities/higashiyama (Kiyomizu-dera, the Yasaka Pagoda, Sannenzaka and Ninenzaka) and
cities/fushimi-inari (the Romon, the halls and the Senbon Torii). Every part takes metres and a frame
P(u, v, z) -> (x, y, z) with u forward (out of the building's front), v to its left and z absolute;
materials are named by role (M: {"post", "wall", "roof", "soffit", "gable", "ridge", "base", "bracket",
"wood", "metal", "gold", "screen"}) so each site picks its own colours: vermilion posts at Kiyomizu's
gates and pagoda, bare cypress at its main hall and at the Yasaka Pagoda, hinoki bark or clay tiles.
"""
import math

import numpy as np

import archkit as ak
import japankit
from japankit import block, lathe_at, left_of, taper, unit


def hip_roof(roof, soffit, P, u_half, v_half, z_eave, z_top, ov, k=1.6, rings=6, ridge_frac=0.0, lift=None):
    """japankit.hip_roof, with the corners' lift (反り) given, for a hall's own curve (lift None: japankit's)."""
    if lift is None:
        return japankit.hip_roof(roof, soffit, P, u_half, v_half, z_eave, z_top, ov, k=k, rings=rings, ridge_frac=ridge_frac)
    return ak.japanese_roof(P, u_half, v_half, z_eave, z_top, ov, roof, soffit, None, soffit, gable_frac=1.0, k=k,
                            lift=lift, ridge_frac=ridge_frac, ridges=False, n=rings)["corners"]


def irimoya(roof, gable, soffit, P, u_half, v_half, z_eave, z_ridge, ov, gable_at=0.55, k=1.5, lift=None):
    """japankit.irimoya, with the corners' lift given (lift None: japankit's)."""
    if lift is None:
        return japankit.irimoya(roof, gable, soffit, P, u_half, v_half, z_eave, z_ridge, ov, gable_at=gable_at, k=k)
    return ak.japanese_roof(P, u_half, v_half, z_eave, z_ridge, ov, roof, soffit, gable, soffit, gable_frac=gable_at ** (1 / k), k=k,
                            lift=lift, ridges=False)


def frame(o, f):
    """u along the unit vector f from o, v to its left, z absolute (as numpy points)."""
    o, f = np.asarray(o, float)[:2], unit(f)[:2]
    l = left_of(f)
    return lambda u, v, z: np.array([o[0] + f[0] * u + l[0] * v, o[1] + f[1] * u + l[1] * v, float(z)])


def site(ring, toward):
    """A footprint's frame facing `toward`: (centre, forward unit vector, half depth along it, half
    width across it), from its minimum rotated rectangle's axis nearest that direction."""
    cx, cy, ax, L, W = ak.oriented(ring)
    a = math.radians(ax)
    e1, e2 = np.array([math.cos(a), math.sin(a)]), np.array([-math.sin(a), math.cos(a)])
    d = unit(np.asarray(toward, float) - (cx, cy))
    if abs(d @ e1) >= abs(d @ e2):
        return np.array([cx, cy]), e1 * np.sign(d @ e1), L / 2, W / 2
    return np.array([cx, cy]), e2 * np.sign(d @ e2), W / 2, L / 2


def plinth(K, mat, P, hu, hv, z_top, ground):
    """A stone platform down to the lowest ground under its corners (on a slope its downhill side stands
    tall, as the temples' do), up to z_top."""
    if ground is None:
        return
    low = min(ground(*P(su * hu, sv * hv, 0)[:2]) for su in (-1, 0, 1) for sv in (-1, 0, 1))
    if low < z_top - 0.2:
        block(K[mat], P, -hu, hu, -hv, hv, low - 0.6, z_top)


def post(K, mat, x, y, z0, z1, r, base=None, segs=10):
    """A round pillar on a stone base (礎石)."""
    if base:
        lathe_at(K[base], x, y, [(z0 - 0.3, r * 1.7), (z0 + 0.12, r * 1.6), (z0 + 0.18, r * 1.2)], 8)
    lathe_at(K[mat], x, y, [(z0, r), (z1, r * 0.94)], segs)


def brackets(K, M, P, hu, hv, z0, z1, out=0.8):
    """The bracket band under the eaves (組物), stepping out in three tiers: the tiers in the post colour,
    their ends picked out in the bracket colour."""
    t = (z1 - z0) / 3
    for k in range(3):
        o = out * (k + 1) / 3
        block(K[M["post"]], P, -hu - o, hu + o, -hv - o, hv + o, z0 + k * t, z0 + (k + 1) * t - 0.07)
        block(K[M["bracket"]], P, -hu - o - 0.03, hu + o + 0.03, -hv - o - 0.03, hv + o + 0.03, z0 + (k + 1) * t - 0.12, z0 + (k + 1) * t - 0.03)


def across(P):
    """The frame turned so that a roof whose ridge runs along u runs across the front instead."""
    return lambda u, v, z: P(v, u, z)


def ridge_cap(K, M, P, half, z, h=0.8, w=0.7, oni=1.3):
    """The ridge (棟) along v from -half to half at z, its end tiles (鬼瓦) standing up at each end."""
    block(K[M["ridge"]], P, -w / 2, w / 2, -half, half, z - 0.25, z + h)
    for s in (-1, 1):
        taper(K[M["ridge"]], P, 0, s * (half - 0.2), w * 1.6, 0.5, z + h * 0.6, w * 0.9, 0.35, z + h + oni)


def romon(K, M, P, z0, frontage, depth, ridge, nio=True, lattice=True, ground=None):
    """A two-storey gate (楼門): three bays across, two deep, the middle bay the passage; the guardians
    (仁王) in the outer front bays behind lattice; above the first storey's brackets a balcony with its
    railing (縁, 高欄), the upper storey's walls between posts, its brackets, and a hipped-and-gabled roof
    with its ridge across the passage. Returns the levels {top of the stone, balcony, eaves}."""
    hu, hv = depth / 2, frontage / 2
    zb = z0 + 0.35
    block(K[M["base"]], P, -hu - 1.0, hu + 1.0, -hv - 1.0, hv + 1.0, z0 - 0.8, zb)
    plinth(K, M["base"], P, hu + 1.0, hv + 1.0, zb, ground)
    z1 = z0 + ridge * 0.3                         # the first storey's head ties
    bay = frontage / 3
    vs = (-hv, -bay / 2, bay / 2, hv)
    for u in (-hu, 0.0, hu):
        for v in vs:
            x, y, _ = P(u, v, 0)
            post(K, M["post"], x, y, zb, z1, 0.36 if u == 0 else 0.3, M["base"])
    for u in (-hu, 0.0, hu):
        block(K[M["post"]], P, u - 0.2, u + 0.2, -hv - 0.3, hv + 0.3, z1 - 0.5, z1)
        block(K[M["post"]], P, u - 0.16, u + 0.16, -hv, hv, zb + 2.7, zb + 2.95)
    for v in vs:
        block(K[M["post"]], P, -hu - 0.3, hu + 0.3, v - 0.2, v + 0.2, z1 - 0.5, z1)
    for sv in (-1, 1):                              # the outer bays: a wall down the middle, lattice front and back
        v0, v1 = sorted((sv * bay / 2, sv * hv))
        block(K[M["wall"]], P, -0.12, 0.12, v0 + 0.25, v1 - 0.25, zb, z1 - 0.5)
        if nio:                                     # 阿形 and 吽形, on rocks
            vm = (v0 + v1) / 2
            taper(K[M["base"]], P, hu * 0.5, vm, 1.4, 1.2, zb, 1.2, 1.0, zb + 0.5)
            taper(K[M["nio"]], P, hu * 0.5, vm, 1.0, 0.8, zb + 0.5, 0.8, 0.6, zb + 0.5 + (z1 - zb) * 0.42)
            x, y, _ = P(hu * 0.5, vm, 0)
            zt = zb + 0.5 + (z1 - zb) * 0.42
            lathe_at(K[M["nio"]], x, y, [(zt, 0.32), (zt + 0.5, 0.34), (zt + 0.9, 0.25), (zt + 1.05, 0.0)], 10)
        if lattice:
            for su in (-1, 1):
                q = [P(su * (hu - 0.3), v0 + 0.25, zb + 0.5), P(su * (hu - 0.3), v1 - 0.25, zb + 0.5),
                     P(su * (hu - 0.3), v1 - 0.25, z1 - 0.5), P(su * (hu - 0.3), v0 + 0.25, z1 - 0.5)]
                K[M["screen"]].quad(*q)
    # the balcony on the brackets, its railing, the upper storey
    zbal = z1 + (ridge * 0.1)
    brackets(K, M, P, hu, hv, z1, zbal - 0.3, out=0.9)
    block(K[M["wood"]], P, -hu - 0.9, hu + 0.9, -hv - 0.9, hv + 0.9, zbal - 0.3, zbal)
    rail = [P(su * (hu + 0.8), sv * (hv + 0.8), zbal) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1))]
    K[M["post"]].rails(rail, 0.9, post_every=1.6, post=0.12, rail=0.09, rails=2)
    hu2, hv2 = hu - 0.3, hv - 0.6
    ze = z0 + ridge * 0.6
    zt2 = ze - (ze - zbal) * 0.3
    block(K[M["wall"]], P, -hu2 + 0.12, hu2 - 0.12, -hv2 + 0.12, hv2 - 0.12, zbal, zt2)
    for u in (-hu2, hu2):
        for v in np.linspace(-hv2, hv2, 4):
            x, y, _ = P(u, v, 0)
            post(K, M["post"], x, y, zbal, zt2, 0.28)
    for v in np.linspace(-hv2, hv2, 4):
        for u in (-hu2, hu2):
            x, y, _ = P(u, v, 0)
            post(K, M["post"], x, y, zbal, zt2, 0.28)
    for u in (-hu2, hu2):                           # the doors (板扉) of the upper storey's middle bay, front and back
        block(K[M["wood"]], P, u - 0.06, u + 0.06, -bay / 2 + 0.3, bay / 2 - 0.3, zbal + 0.3, zt2 - 0.4)
    block(K[M["post"]], P, -hu2 - 0.2, hu2 + 0.2, -hv2 - 0.2, hv2 + 0.2, zt2 - 0.45, zt2)
    brackets(K, M, P, hu2, hv2, zt2, ze - 0.25, out=1.1)
    R = irimoya(K[M["roof"]], K[M["gable"]], K[M["soffit"]], across(P), hv2 + 1.1, hu2 + 1.1, ze, z0 + ridge - 0.8,
                ov=max(2.4, depth * 0.38), gable_at=0.5, k=1.6)
    ridge_cap(K, M, P, R["Ug"] + 0.4, z0 + ridge - 1.0, h=0.7)
    return {"stone": zb, "balcony": zbal, "eave": ze}


def kirizuma(K, M, P, hu, hv, z_eave, z_ridge, ov_u, ov_v, k=1.3):
    """A gabled roof with its ridge along v (across the passage), its slopes curving down to the eaves
    front and back, barge boards at the gables, the ridge and its end tiles."""
    us = np.linspace(-(hu + ov_u), hu + ov_u, 15)
    Eu = hu + ov_u
    # the slope sags (concave): flat at the eaves, steeper toward the ridge, as a temple roof's does
    zr = lambda u: z_eave + (z_ridge - z_eave) * (1 - abs(u) / Eu) ** k
    vs = np.linspace(-(hv + ov_v), hv + ov_v, 5)
    K[M["roof"]].grid([[P(u, v, zr(u)) for v in vs] for u in us])
    for sv in (-1, 1):
        vv = sv * (hv + ov_v * 0.85)
        for a, b in zip(us, us[1:]):
            K[M["gable"]].quad(P(a, vv, zr(a) - 0.45), P(b, vv, zr(b) - 0.45), P(b, vv, zr(b)), P(a, vv, zr(a)))
            K[M["soffit"]].quad(P(a, sv * hv, z_eave - 0.3), P(b, sv * hv, z_eave - 0.3), P(b, vv, zr(b) - 0.45), P(a, vv, zr(a) - 0.45))
    for su in (-1, 1):
        K[M["soffit"]].quad(P(su * Eu, -(hv + ov_v), z_eave - 0.35), P(su * Eu, hv + ov_v, z_eave - 0.35), P(su * hu, hv, z_eave - 0.55), P(su * hu, -hv, z_eave - 0.55))
    ridge_cap(K, M, P, hv + ov_v, z_ridge - 0.1, h=0.6, w=0.8)


def hakkyaku(K, M, P, z0, frontage, depth, ridge, roof="kirizuma", ground=None):
    """An eight-legged gate (八脚門): three bays across, two deep, the main posts down the middle, the
    eight 'legs' front and back; tie beams, brackets, and a gabled (切妻) or hipped-and-gabled roof."""
    hu, hv = depth / 2, frontage / 2
    zb = z0 + 0.3
    block(K[M["base"]], P, -hu - 0.7, hu + 0.7, -hv - 0.7, hv + 0.7, z0 - 0.8, zb)
    plinth(K, M["base"], P, hu + 0.7, hv + 0.7, zb, ground)
    ze = z0 + ridge * 0.6
    zt = ze - max(1.0, ridge * 0.1)
    bay = frontage / 3
    vs = (-hv, -bay / 2, bay / 2, hv)
    for u in (-hu, 0.0, hu):
        for v in vs:
            x, y, _ = P(u, v, 0)
            post(K, M["post"], x, y, zb, zt, 0.34 if u == 0 else 0.27, M["base"])
    for u in (-hu, 0.0, hu):
        block(K[M["post"]], P, u - 0.2, u + 0.2, -hv - 0.3, hv + 0.3, zt - 0.5, zt)
        block(K[M["post"]], P, u - 0.15, u + 0.15, -hv, hv, zb + 2.4, zb + 2.65)
    for v in vs:
        block(K[M["post"]], P, -hu - 0.3, hu + 0.3, v - 0.2, v + 0.2, zt - 0.5, zt)
    for sv in (-1, 1):
        v0, v1 = sorted((sv * bay / 2, sv * hv))
        block(K[M["wall"]], P, -0.1, 0.1, v0 + 0.25, v1 - 0.25, zb, zt - 0.5)
    brackets(K, M, P, hu, hv, zt, ze - 0.2, out=0.8)
    if roof == "kirizuma":
        kirizuma(K, M, P, hu + 0.8, hv + 0.8, ze, z0 + ridge, ov_u=max(1.4, depth * 0.3), ov_v=1.2)
    else:
        R = irimoya(K[M["roof"]], K[M["gable"]], K[M["soffit"]], across(P), hv + 0.8, hu + 0.8, ze, z0 + ridge - 0.7,
                    ov=max(1.8, depth * 0.35), gable_at=0.5, k=1.6)
        ridge_cap(K, M, P, R["Ug"] + 0.3, z0 + ridge - 0.9, h=0.6)
    return {"stone": zb, "eave": ze}


def hall(K, M, P, z0, hu, hv, z_floor, eave, ridge, roof="irimoya", ov=None, posts_every=3.0, doors=True, veranda=True, ground=None,
         k=1.55, lift=None):
    """A hall raised on its floor: posts round the walls, white plaster or boarded walls with lattice
    doors in the front, a veranda (縁) round it on short legs, the bracket band and its roof:
    "irimoya" (入母屋), "yosemune" (寄棟, hipped) or "hogyo" (宝形, a pyramid). Heights absolute. k: the
    roof's sweep (archkit.japanese_roof), lift: its corners' rise (反り), for a hall's own curve."""
    ov = ov if ov is not None else max(1.8, min(hu, hv) * 0.32)
    block(K[M["base"]], P, -hu - 0.8, hu + 0.8, -hv - 0.8, hv + 0.8, z0 - 0.8, z0 + 0.25)
    plinth(K, M["base"], P, hu + 0.8, hv + 0.8, z0 + 0.25, ground)
    if veranda and z_floor > z0 + 0.5:
        for u in np.linspace(-hu - 0.9, hu + 0.9, max(2, int(2 * hu / 2.5) + 1)):
            for v in (-hv - 0.9, hv + 0.9):
                x, y, _ = P(u, v, 0)
                post(K, M["wood"], x, y, z0 + 0.2, z_floor - 0.1, 0.12)
        block(K[M["wood"]], P, -hu - 1.1, hu + 1.1, -hv - 1.1, hv + 1.1, z_floor - 0.18, z_floor)
    else:
        block(K[M["wood"]], P, -hu - 0.3, hu + 0.3, -hv - 0.3, hv + 0.3, z0 + 0.25, z_floor)
    zt = eave - max(0.9, (eave - z_floor) * 0.18)
    block(K[M["wall"]], P, -hu + 0.15, hu - 0.15, -hv + 0.15, hv - 0.15, z_floor, zt - 0.3)
    for (a, b) in (((-hu, -hv), (hu, -hv)), ((hu, -hv), (hu, hv)), ((hu, hv), (-hu, hv)), ((-hu, hv), (-hu, -hv))):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(round(L / posts_every)))
        for k in range(n):
            t = k / n
            x, y, _ = P(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0)
            post(K, M["post"], x, y, z_floor, zt, 0.24)
    block(K[M["post"]], P, -hu - 0.12, hu + 0.12, -hv - 0.12, hv + 0.12, zt - 0.4, zt)
    block(K[M["post"]], P, -hu - 0.1, hu + 0.1, -hv - 0.1, hv + 0.1, z_floor + 0.1, z_floor + 0.35)
    if doors:                                      # lattice doors (蔀戸 / 格子戸) across the front bays
        n = max(1, int(round(2 * hv / posts_every)))
        for k in range(n):
            va, vb = -hv + 2 * hv * k / n, -hv + 2 * hv * (k + 1) / n
            block(K[M["screen_wood"] if "screen_wood" in M else M["wood"]], P, hu - 0.02, hu + 0.05, va + 0.3, vb - 0.3, z_floor + 0.4, zt - 0.6)
    brackets(K, M, P, hu, hv, zt, eave - 0.15, out=min(1.2, ov * 0.4))
    Hu, Hv = hu + 0.6, hv + 0.6
    if roof == "irimoya":
        if hv >= hu:
            R = irimoya(K[M["roof"]], K[M["gable"]], K[M["soffit"]], across(P), Hv, Hu, eave, ridge - 0.7, ov=ov, gable_at=0.5, k=k, lift=lift)
            ridge_cap(K, M, P, R["Ug"] + 0.3, ridge - 0.9, h=0.75)
        else:
            R = irimoya(K[M["roof"]], K[M["gable"]], K[M["soffit"]], P, Hu, Hv, eave, ridge - 0.7, ov=ov, gable_at=0.5, k=k, lift=lift)
            ridge_cap(K, M, across(P), R["Ug"] + 0.3, ridge - 0.9, h=0.75)
    elif roof == "yosemune":
        e = hip_roof(K[M["roof"]], K[M["soffit"]], P, Hu, Hv, eave, ridge - 0.4, ov=ov, k=k, ridge_frac=0.55, lift=lift)
        if hv >= hu:
            ridge_cap(K, M, P, max(Hv - Hu, 0.5) * 0.55 + 0.5, ridge - 0.6, h=0.6)
        else:
            ridge_cap(K, M, across(P), max(Hu - Hv, 0.5) * 0.55 + 0.5, ridge - 0.6, h=0.6)
    else:   # hogyo: a pyramid with its finial (露盤, 宝珠)
        hip_roof(K[M["roof"]], K[M["soffit"]], P, Hu, Hv, eave, ridge - 1.2, ov=ov, k=k + 0.05, lift=lift)
        x, y, _ = P(0, 0, 0)
        lathe_at(K[M["metal"]], x, y, [(ridge - 1.4, 0.7), (ridge - 0.9, 0.7), (ridge - 0.8, 0.25), (ridge - 0.5, 0.35), (ridge, 0.0)], 8)


def pagoda(K, M, P, z0, storeys, height, sorin, core, podium=1.2, deep=1.0, ground=None):
    """A pagoda (三重塔 / 五重塔): its stone podium, each storey a little narrower, walls between posts,
    the bracket bands, deep eaves on hipped roofs, a railing round each upper storey, and the bronze
    finial (相輪) of its nine rings, the water flame and the jewel. core: the first storey's half width."""
    block(K[M["base"]], P, -core - 1.6, core + 1.6, -core - 1.6, core + 1.6, z0 - 0.8, z0 + podium)
    plinth(K, M["base"], P, core + 1.6, core + 1.6, z0 + podium, ground)
    zb = z0 + podium
    zt = z0 + height - sorin
    h = (zt - zb) / storeys
    shrink = 0.28 / storeys
    for s in range(storeys):
        w = core * (1 - shrink * s)
        za = zb + s * h
        zw = za + h * 0.3
        block(K[M["wall"]], P, -w + 0.12, w - 0.12, -w + 0.12, w - 0.12, za, zw)
        for t in np.linspace(-w, w, 4):
            for sgn in (-1, 1):
                for x, y, _ in (P(t, sgn * w, 0), P(sgn * w, t, 0)):
                    post(K, M["post"], x, y, za, zw, 0.2, segs=6)
        for sgn in (-1, 1):
            block(K[M["wood"]], P, sgn * w - 0.05, sgn * w + 0.05, -w / 3 + 0.15, w / 3 - 0.15, za + 0.2, zw - 0.3)
            block(K[M["wood"]], P, -w / 3 + 0.15, w / 3 - 0.15, sgn * w - 0.05, sgn * w + 0.05, za + 0.2, zw - 0.3)
        block(K[M["post"]], P, -w - 0.1, w + 0.1, -w - 0.1, w + 0.1, zw - 0.3, zw)
        brackets(K, M, P, w, w, zw, zw + h * 0.17, out=1.1 * deep)
        ze = zw + h * 0.17
        ov = (2.6 + 0.45 * core - 0.12 * s) * deep
        if s < storeys - 1:
            w2 = core * (1 - shrink * (s + 1))
            top = za + h + 0.05
            E = w + 1.0 * deep + ov
            k = 1.7
            H = (top - ze) / max(((E - w2 - 0.2) / E) ** k, 0.25)
            hip_roof(K[M["roof"]], K[M["soffit"]], P, w + 1.0 * deep, w + 1.0 * deep, ze, ze + H, ov=ov, k=k)
            block(K[M["wood"]], P, -w2 - 0.6, w2 + 0.6, -w2 - 0.6, w2 + 0.6, top - 0.05, top + 0.12)
            rail = [P(su * (w2 + 0.55), sv * (w2 + 0.55), top + 0.12) for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1))]
            K[M["post"]].rails(rail, 0.75, post_every=1.4, post=0.09, rail=0.07, rails=2)
        else:
            hip_roof(K[M["roof"]], K[M["soffit"]], P, w + 1.0 * deep, w + 1.0 * deep, ze, zt + 0.3, ov=ov, k=1.75)
    x, y, _ = P(0, 0, 0)
    tip = z0 + height
    lathe_at(K[M["metal"]], x, y, [(zt - 0.4, 1.4), (zt + 0.6, 1.2), (zt + 0.7, 0.42), (tip - 0.5, 0.16), (tip, 0.0)], 10)
    lathe_at(K[M["metal"]], x, y, [(zt + 0.7, 0.0), (zt + 0.8, 0.85), (zt + 1.5, 0.9), (zt + 1.7, 0.0)], 10)   # the bowl (伏鉢)
    for k in range(9):                              # the nine rings (九輪)
        z = zt + 2.2 + k * (sorin * 0.55) / 9
        r = 0.8 - 0.03 * k
        lathe_at(K[M["metal"]], x, y, [(z, 0.0), (z + 0.05, r), (z + 0.26, r), (z + 0.31, 0.0)], 10)
    zf = zt + 2.2 + sorin * 0.58
    for k in range(4):                              # the water flame (水煙)
        a = math.pi / 4 + k * math.pi / 2
        K[M["metal"]].quad(np.array([x, y, zf]), np.array([x + 0.85 * math.cos(a), y + 0.85 * math.sin(a), zf + 0.5]),
                           np.array([x + 0.6 * math.cos(a), y + 0.6 * math.sin(a), zf + 1.9]), np.array([x, y, zf + 1.6]))
    lathe_at(K[M["metal"]], x, y, [(tip - 1.6, 0.0), (tip - 1.3, 0.3), (tip - 1.0, 0.22), (tip - 0.7, 0.0)], 10)


def kakezukuri(K, M, P, u0, u1, v0, v1, z_floor, ground, every=3.6, levels=None, r=0.32, bays=None):
    """The lattice a hanging stage stands on (懸造): keyaki pillars on stone from the slope to the floor,
    every `every` m (or `bays`: (along u, along v), a counted grid), tied in both directions by
    through-beams (貫) every few metres, no nails, no braces. ground(x, y) gives the slope. Returns the
    pillars' feet [(x, y, z)]."""
    nu, nv = bays or (max(1, int(round((u1 - u0) / every))), max(1, int(round((v1 - v0) / every))))
    us, vs = np.linspace(u0, u1, nu + 1), np.linspace(v0, v1, nv + 1)
    feet = {}
    for u in us:
        for v in vs:
            x, y, _ = P(u, v, 0)
            g = ground(x, y)
            if g > z_floor - 1.2:
                continue
            post(K, M["pillar"], x, y, g, z_floor - 0.35, r, M["base"], segs=8)
            feet[(u, v)] = g
    if not feet:
        return []
    low = min(feet.values())
    levels = levels or list(np.arange(z_floor - 2.6, low, -2.4))
    for z in levels:
        for u in us:
            run = [v for v in vs if (u, v) in feet and feet[(u, v)] < z - 0.3]
            if len(run) > 1:
                K[M["nuki"]].box(P(u, run[0] - 0.4, z), P(u, run[-1] + 0.4, z), 0.16, 0.36)
        for v in vs:
            run = [u for u in us if (u, v) in feet and feet[(u, v)] < z - 0.3]
            if len(run) > 1:
                K[M["nuki"]].box(P(run[0] - 0.4, v, z), P(run[-1] + 0.4, v, z), 0.16, 0.36)
    # the joists under the floor
    for u in us:
        K[M["nuki"]].box(P(u, v0 - 0.3, z_floor - 0.45), P(u, v1 + 0.3, z_floor - 0.45), 0.3, 0.4)
    return [(*P(u, v, 0)[:2], g) for (u, v), g in feet.items()]


# ---------------------------------------------------------------- torii, lanterns

def torii(m_body, m_black, h, span, r=None, style="inari", text=None):
    """A torii in its own frame (x across the path, y along it, z up from the ground at 0), for props:
    two pillars leaning in a little (転び), black at the foot (根巻) and, at Inari, a ring at their heads
    (台輪); the tie beam (貫) through them, the strut (額束) between it and the double lintel above (島木
    and 笠木), whose ends sweep up (反り), black-topped. m_body: the vermilion, m_black: the black parts."""
    r = r or max(0.09, 0.055 * h)
    half = span / 2
    lean = h * 0.02
    for s in (-1, 1):
        x0, x1 = s * (half + lean), s * half
        m_body.box((x0, 0, 0.0), (x1, 0, h - 0.18 * h), 2 * r, 2 * r)
        m_black.box((x0, 0, -0.05), (x0 - s * lean * 0.1, 0, 0.09 * h), 2 * r + 0.05, 2 * r + 0.05)
        if style == "inari":
            m_black.box((x1, 0, h - 0.2 * h), (x1, 0, h - 0.17 * h), 2 * r + 0.06, 2 * r + 0.06)
    zn = h * 0.7
    m_body.box((-half - r * 2.6, 0, zn), (half + r * 2.6, 0, zn), 0.85 * r, 1.5 * r)
    m_body.box((0, 0, zn + 0.75 * r), (0, 0, h - 0.17 * h), 1.4 * r, 0.8 * r)
    zs = h - 0.16 * h
    ends = half + r * 4.5
    pts = [(x, 0, zs + 0.09 * h * (abs(x) / ends) ** 2.2) for x in np.linspace(-ends, ends, 7)]
    for a, b in zip(pts, pts[1:]):
        m_body.box(a, b, 1.3 * r, 0.06 * h)
        m_black.box((a[0], a[1], a[2] + 0.065 * h), (b[0], b[1], b[2] + 0.065 * h), 1.4 * r, 0.03 * h)


def stone_lantern(m, h=2.0):
    """A stone lantern (石灯籠, kasuga style) in its own frame: base, shaft, the platform, the fire box
    (火袋), the roof with its corners turned up, the jewel on top."""
    s = h / 2.0
    m.lathe([(0.0, 0.32 * s), (0.18 * s, 0.32 * s), (0.22 * s, 0.2 * s)], (0, 0), 6)
    m.lathe([(0.22 * s, 0.12 * s), (1.0 * s, 0.1 * s)], (0, 0), 8)
    m.lathe([(1.0 * s, 0.24 * s), (1.12 * s, 0.24 * s)], (0, 0), 6)
    m.lathe([(1.12 * s, 0.17 * s), (1.45 * s, 0.17 * s)], (0, 0), 6)
    m.lathe([(1.45 * s, 0.38 * s), (1.55 * s, 0.36 * s), (1.75 * s, 0.1 * s)], (0, 0), 6)
    m.lathe([(1.75 * s, 0.0), (1.8 * s, 0.09 * s), (1.95 * s, 0.07 * s), (2.0 * s, 0.0)], (0, 0), 8)


def lantern_light(m, h=2.0):
    """The lit window of a stone lantern's fire box, a little proud of the stone (lit after dark)."""
    s = h / 2.0
    m.lathe([(1.18 * s, 0.175 * s), (1.4 * s, 0.175 * s)], (0, 0), 6)


def chochin(m_paper, m_cap, z0, r=0.2, h=0.55):
    """A paper lantern (提灯) hung under an eave in its own frame: black caps, the ribbed paper body."""
    m_cap.lathe([(z0 + h, 0.0), (z0 + h, r * 0.8), (z0 + h - 0.06, r * 0.8)], (0, 0), 10)
    prof = [(z0 + h * t, r * (0.72 + 0.28 * math.sin(math.pi * t))) for t in np.linspace(0.08, 0.92, 7)]
    m_paper.lathe(prof, (0, 0), 12)
    m_cap.lathe([(z0 + 0.06, r * 0.8), (z0, r * 0.8), (z0, 0.0)], (0, 0), 10)


# ---------------------------------------------------------------- paving along a mapped path

def resample(pts, step):
    """A polyline resampled every `step` m: [(x, y)], with the distance along it [s]."""
    P = [np.asarray(p, float) for p in pts]
    out, ss, s = [P[0]], [0.0], 0.0
    carry = 0.0
    for a, b in zip(P, P[1:]):
        L = float(np.linalg.norm(b - a))
        t = step - carry
        while t <= L:
            out.append(a + (b - a) * t / L)
            ss.append(s + t)
            t += step
        carry = L - (t - step)
        s += L
    if np.linalg.norm(out[-1] - P[-1]) > 0.05:
        out.append(P[-1])
        ss.append(s)
    return out, ss


def paving(m, pts, width, ground, lift=0.06, step=1.0, kerb=None):
    """Stone paving (石畳) draped on the ground along a path: a ribbon `width` m wide sampled every `step`,
    `lift` above the bare earth; UVs in metres (across, along) for the setts' pattern; a low kerb of
    granite along both edges if `kerb` (a mesh) is given."""
    Q, ss = resample(pts, step)
    if len(Q) < 2:
        return
    rows, uvs = [], []
    for i, (p, s) in enumerate(zip(Q, ss)):
        a = Q[max(i - 1, 0)]
        b = Q[min(i + 1, len(Q) - 1)]
        t = unit(b - a)
        n = left_of(t)
        row, urow = [], []
        for f in (-0.5, -0.25, 0.0, 0.25, 0.5):
            q = p + n * f * width
            row.append(np.array([q[0], q[1], ground(q[0], q[1]) + lift]))
            urow.append([f * width, s])
        rows.append(row)
        uvs.append(urow)
    m.grid(rows, uvs)
    if kerb is not None:
        for side in (-0.5, 0.5):
            edge = [r[0] if side < 0 else r[-1] for r in rows]
            for a, b in zip(edge, edge[1:]):
                kerb.box(a + np.array([0, 0, 0.02]), b + np.array([0, 0, 0.02]), 0.25, 0.14)


def stairs(m, pts, width, z_from, z_to, rise=0.17, riser=None):
    """A flight of stone steps along a path from z_from to z_to (either way): treads `width` m wide, each a
    block to the ground below it, so the flight reads as built of stone, not draped."""
    Q, ss = resample(pts, 0.25)
    L = ss[-1]
    if L < 0.5:
        return []
    n = max(1, int(round(abs(z_to - z_from) / rise)))
    out = []
    for k in range(n):
        s0, s1 = L * k / n, L * (k + 1) / n
        z = z_from + (z_to - z_from) * (k + 1) / n if z_to > z_from else z_from + (z_to - z_from) * k / n
        i0 = int(np.searchsorted(ss, s0))
        i1 = max(i0 + 1, int(np.searchsorted(ss, s1)))
        a, b = Q[min(i0, len(Q) - 1)], Q[min(i1, len(Q) - 1)]
        if np.linalg.norm(b - a) < 0.05:
            continue
        t = unit(b - a)
        n_ = left_of(t)
        c = [a + n_ * width / 2, b + n_ * width / 2, b - n_ * width / 2, a - n_ * width / 2]
        zb = min(z_from, z_to) - 0.5
        P = lambda i, z: np.array([c[i][0], c[i][1], z])
        m.quad(P(0, z), P(3, z), P(2, z), P(1, z), [[0, 0], [width, 0], [width, 0.3], [0, 0.3]])
        for i in range(4):
            j = (i + 1) % 4
            m.quad(P(i, zb), P(j, zb), P(j, z), P(i, z))
        out.append(((a + b) / 2, z))
    return out


def drape(m, poly, ground, lift=0.04, cell=1.5):
    """A polygon (shapely, with holes) laid on the ground `lift` over it, as a decal: triangulated over a
    `cell` m grid inside it and its outline every `cell` m, each corner on the terrain, so that it follows
    the ground between its edges rather than spanning them (a mound in a court would poke through)."""
    import shapely
    from shapely.geometry import MultiPoint, Point
    for q in getattr(poly, "geoms", [poly]):
        if q.geom_type != "Polygon" or q.area < 1.0:
            continue
        q = q.simplify(0.2)
        pts = [c for r in [q.exterior] + list(q.interiors) for c in r.segmentize(cell).coords]
        x0, y0, x1, y1 = q.bounds
        inner = q.buffer(-0.3 * cell)
        for x in np.arange(x0 + cell / 2, x1, cell):
            for y in np.arange(y0 + cell / 2, y1, cell):
                if inner.contains(Point(x, y)):
                    pts.append((x, y))
        for t in shapely.delaunay_triangles(MultiPoint(pts)).geoms:
            if not q.buffer(0.01).contains(t.centroid):
                continue
            cs = np.asarray(t.exterior.coords)[:3]
            (ax, ay), (bx, by) = cs[1] - cs[0], cs[2] - cs[0]
            if ax * by - ay * bx < 0:
                cs = cs[::-1]
            m.tri(*[np.array([x, y, ground(x, y) + lift]) for x, y in cs], [[x, y] for x, y in cs])
