"""Queenstown's heritage landmarks, modelled from their Heritage New Zealand listings, photographs
and LINZ's 2021 LiDAR (city.py landmark_meshes draws them in place of their mapped blocks).

Each stands in its own frame (archkit.Frame: u along its main front, v across, z up from its ground),
placed and sized from the LiDAR surface model (DSM minus DEM, 1 m): the walls where the roofs end,
the eaves and ridges at their measured heights. What the laser cannot see (the windows, the mouldings,
the colours) is from the listings and from photographs (docs/cities/queenstown.md, section 3).

  Eichardt's Private Hotel  Heritage NZ List 7439. F. W. Burwell's Victorian Free Classical hotel of
                            1871-86 on the corner of Marine Parade and Ballarat Street: two storeys of
                            white plaster, rusticated quoin pilasters, string courses, a bracketed
                            cornice and a balustraded parapet with urns, the pediment with its shell
                            over the lake front, cast-iron balconies, dark green joinery. The 1929
                            stepped parapet is gone: the restoration after the 1999 flood brought the
                            balustrade back (photographs from 2010 on). The 1929 Moorish (horseshoe)
                            arch is kept over the Ballarat Street door and its balcony door above.
  St Peter's Anglican Church  List 2341. J. McDowall Smith, 1932: an English parish church in Gothic
                            dress, greywacke rubble from the lake edge with pale freestone dressings,
                            a steep slate roof, paired lancets between buttresses, a square
                            crenellated tower with louvred belfry lancets under an octagonal slate
                            spire, a west porch, a vestry, and the timber lych-gate on the path.
  Williams Cottage          List 2336. 1864, its lean-to 1866, and a small stone store room to the side: painted weatherboards, a very high
                            gabled roof of corrugated iron, a stone chimney between the main roof and
                            the lean-to, a verandah to the lake, 12-pane sashes, and the later rear
                            room with its own stone chimney.
  Steamer Wharf             The waterfront pavilions by the Earnslaw's berth: two-storey weatherboard
                            gables facing the lake in green, oxblood and cream, grey corrugated roofs,
                            and orange-red balconies and stairs on the lake front.
"""
import math

import numpy as np

import archkit as ak

# Frames from the LiDAR: centre (x, y) in the city's frame, the bearing of u (degrees from east,
# anticlockwise), and the solids of the built city each draws instead (scene hidden_solids).
EICHARDTS = {"at": (-109.2, -197.6), "axis": -44.9, "solids": [1698]}
ST_PETERS = {"at": (38.2, -182.8), "axis": 30.6, "solids": [1736]}
WILLIAMS = {"at": (-12.5, -272.5), "axis": 44.2, "solids": [1770]}
WHARF = {"solids": [275, 430], "axis": -55.9}  # u along the ridges, towards the lake (the gables face it)

MATERIALS = {
    # Eichardt's: white plaster, the trim a shade warmer, dark green joinery and ironwork; lit from below after dark
    "eich_plaster": {"color": "#ecebe4", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffe6c4", "glow": 0.32, "flood": [0.0, 10.0, 0.4, 0.55]},
    "eich_trim": {"color": "#f4f1e8", "roughness": 0.7, "metalness": 0.0, "emissive": "#ffe6c4", "glow": 0.36, "flood": [0.0, 10.0, 0.4, 0.55]},
    "eich_green": {"color": "#26372d", "roughness": 0.5, "metalness": 0.35},
    "eich_iron": {"color": "#2a3a30", "roughness": 0.5, "metalness": 0.5, "pattern": "railing", "bar_m": 0.12, "rails_m": [0.08, 0.95]},
    "eich_roof": {"color": "#6d7174", "roughness": 0.55, "metalness": 0.45, "pattern": "roof_tiles", "bay_m": 0.076, "course_m": 2.4},
    "eich_window": {"color": "#141a1c", "roughness": 0.1, "metalness": 0.3, "emissive": "#ffc98a", "glow": 0.32},
    # St Peter's: greywacke rubble, freestone dressings, slate; the lancets' leaded glass glows after dark
    "stp_greywacke": {"color": "#68706f", "roughness": 0.92, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.24, "block_m": 0.5,
                      "emissive": "#ffe2bc", "glow": 0.22, "flood": [0.0, 9.0, 0.35, 0.5]},
    "stp_freestone": {"color": "#c9bb98", "roughness": 0.85, "metalness": 0.0, "emissive": "#ffe2bc", "glow": 0.26, "flood": [0.0, 9.0, 0.35, 0.5]},
    "stp_slate": {"color": "#4a5056", "roughness": 0.65, "metalness": 0.05, "pattern": "ashlar", "course_m": 0.22, "block_m": 0.3},
    "stp_timber": {"color": "#5a3b27", "roughness": 0.7, "metalness": 0.0},
    "stp_lancet": {"color": "#1c2024", "roughness": 0.15, "metalness": 0.2, "emissive": "#ffcf8a", "glow": 0.4},
    "stp_lead": {"color": "#8f9497", "roughness": 0.4, "metalness": 0.7},
    # Williams Cottage: cream weatherboards, oxblood joinery, a red iron roof, schist chimneys topped in brick
    "will_board": {"color": "#d9c98c", "roughness": 0.8, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.17, "block_m": 7.0},
    "will_oxblood": {"color": "#6a2c24", "roughness": 0.6, "metalness": 0.0},
    "will_roof": {"color": "#8b3b2c", "roughness": 0.6, "metalness": 0.35, "pattern": "roof_tiles", "bay_m": 0.076, "course_m": 2.4},
    "will_stone": {"color": "#b4a37f", "roughness": 0.95, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.22, "block_m": 0.38},
    "will_brick": {"color": "#8a4a3a", "roughness": 0.9, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.085, "block_m": 0.23},
    "will_window": {"color": "#16191a", "roughness": 0.1, "metalness": 0.3, "emissive": "#ffc98a", "glow": 0.5},
    # Steamer Wharf: weatherboards in three colours, white trim, grey iron roofs, orange-red balconies
    "wharf_green": {"color": "#2f5a45", "roughness": 0.75, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.18, "block_m": 8.0},
    "wharf_oxblood": {"color": "#5e2c25", "roughness": 0.75, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.18, "block_m": 8.0},
    "wharf_cream": {"color": "#e7dfcb", "roughness": 0.75, "metalness": 0.0, "pattern": "ashlar", "course_m": 0.18, "block_m": 8.0},
    "wharf_trim": {"color": "#f1efe9", "roughness": 0.6, "metalness": 0.0},
    "wharf_roof": {"color": "#6a6e71", "roughness": 0.55, "metalness": 0.45, "pattern": "roof_tiles", "bay_m": 0.076, "course_m": 2.4},
    "wharf_red": {"color": "#c0482c", "roughness": 0.6, "metalness": 0.1},
    "wharf_rail": {"color": "#c0482c", "roughness": 0.6, "metalness": 0.1, "pattern": "railing", "bar_m": 0.12, "rails_m": [0.08, 0.95]},
    "wharf_window": {"color": "#15191b", "roughness": 0.1, "metalness": 0.3, "emissive": "#ffc98a", "glow": 0.7},
}


# ---------------------------------------------------------------- shared parts

def gable(K, P, u0, u1, v0, v1, z_eave, z_ridge, roof, wall, over=0.35, along_u=True, fascia=None, ends=(True, True)):
    """A gabled roof over u0..u1 x v0..v1 (its ridge along u, or along v), the gable ends filled in
    `wall` up to the roof, the roof `over` m past the walls on every side. UVs: metres along the
    eaves and up the slope."""
    if not along_u:  # swap the axes through a frame that turns u into v
        Q = lambda u, v, z: P(v, u, z)
        return gable(K, Q, v0, v1, u0, u1, z_eave, z_ridge, roof, wall, over, True, fascia, ends)
    vm, half = (v0 + v1) / 2, (v1 - v0) / 2
    k = (z_ridge - z_eave) / half
    ze = z_eave - over * k
    a0, a1 = u0 - over, u1 + over
    L = a1 - a0
    s = math.hypot(half + over, z_ridge - ze)
    m = K[roof]
    m.quad(P(a0, v0 - over, ze), P(a1, v0 - over, ze), P(a1, vm, z_ridge), P(a0, vm, z_ridge), [[0, 0], [L, 0], [L, s], [0, s]])
    m.quad(P(a1, v1 + over, ze), P(a0, v1 + over, ze), P(a0, vm, z_ridge), P(a1, vm, z_ridge), [[0, 0], [L, 0], [L, s], [0, s]])
    w = K[wall]
    for u, end in zip((u0, u1), ends):   # (an end drawn by its own wall, opened for a door, is left out)
        if end:
            w.tri(P(u, v0, z_eave), P(u, v1, z_eave), P(u, vm, z_ridge), [[v0, z_eave], [v1, z_eave], [vm, z_ridge]])
    if fascia:  # barge boards along the gables' slopes and the eaves' fascia
        f = K[fascia]
        for u in (a0, a1):
            f.box(P(u, v0 - over, ze), P(u, vm, z_ridge + 0.05), 0.06, 0.22)
            f.box(P(u, v1 + over, ze), P(u, vm, z_ridge + 0.05), 0.06, 0.22)
        for v in (v0 - over, v1 + over):
            f.box(P(a0, v, ze - 0.08), P(a1, v, ze - 0.08), 0.05, 0.18)


def skillion(K, P, u0, u1, v0, v1, z_high, z_low, roof, over=0.3):
    """A lean-to roof falling from z_high at v0 to z_low at v1."""
    k = (z_high - z_low) / (v1 - v0)
    a, b = v0 - over * (1 if v1 > v0 else -1), v1 + over * (1 if v1 > v0 else -1)
    za, zb = z_high + over * k, z_low - over * k
    L, s = u1 - u0 + 2 * over, math.hypot(b - a, za - zb)
    K[roof].quad(P(u0 - over, b, zb), P(u1 + over, b, zb), P(u1 + over, a, za), P(u0 - over, a, za), [[0, 0], [L, 0], [L, s], [0, s]])


def window(K, P, a, b, centre, z0, w, h, glass, frame, panes=(2, 3), arch=False, surround=None, depth=0.08):
    """A sash window on the wall a -> b (outside on the right): the glass recessed, its frame, the
    glazing bars (panes across, up each sash), and a raised surround."""
    ak.opening(K[glass], P, a, b, z0, w, h, arch=arch, depth=0.02, centre=centre)
    a2, b2 = np.asarray(a, float), np.asarray(b, float)
    t = (b2 - a2) / np.linalg.norm(b2 - a2)
    n = np.array([t[1], -t[0]])
    c = a2 + t * centre
    Q = lambda s, z, d=depth: P(*(c + t * s + n * d), z)
    f = K[frame]
    top = z0 + h - (w / 2 if arch else 0)
    for s in (-w / 2, w / 2):
        f.box(Q(s, z0), Q(s, top), 0.07, 0.07)
    f.box(Q(-w / 2, z0), Q(w / 2, z0), 0.07, 0.09)
    f.box(Q(-w / 2, top), Q(w / 2, top), 0.07, 0.07)
    if surround:
        ak.frame_quad(K[surround], P, a, b, centre, z0, w, h, t=0.18, depth=0.1)
    nx, ny = panes
    for i in range(1, nx):
        s = -w / 2 + w * i / nx
        f.box(Q(s, z0), Q(s, top), 0.025, 0.03)
    if panes == (1, 1):
        return
    mid = z0 + (top - z0) / 2
    f.box(Q(-w / 2, mid), Q(w / 2, mid), 0.06, 0.06)  # the meeting rail of the two sashes
    for half0 in (z0, mid):
        for j in range(1, ny):
            z = half0 + (top - z0) / 2 * j / ny
            f.box(Q(-w / 2, z), Q(w / 2, z), 0.025, 0.03)


def railing(K, P, path, z, h, rail_mat, post_mat, every=1.2, finial=False):
    """An iron railing: a cut-out panel of bars on the path, a top rail and posts."""
    pts = [np.asarray(p, float) for p in path]
    K[rail_mat].panel([P(*q, z) for q in pts], h)
    m = K[post_mat]
    for a, b in zip(pts[:-1], pts[1:]):
        m.box(P(*a, z + h), P(*b, z + h), 0.07, 0.06)
        L = float(np.linalg.norm(b - a))
        for s in np.linspace(0, L, max(2, int(L / every) + 1)):
            q = a + (b - a) * s / L
            m.box(P(*q, z), P(*q, z + h + 0.04), 0.07, 0.07)
            if finial:
                m.box(P(*q, z + h + 0.04), P(*q, z + h + 0.2), 0.11, 0.11)


def urn(m, x, y, z, s=1.0):
    """A parapet urn: a turned profile on a square foot."""
    m.lathe([(z, 0.0), (z, 0.16 * s), (z + 0.12 * s, 0.16 * s), (z + 0.18 * s, 0.09 * s), (z + 0.32 * s, 0.2 * s), (z + 0.48 * s, 0.22 * s),
             (z + 0.58 * s, 0.14 * s), (z + 0.66 * s, 0.07 * s), (z + 0.8 * s, 0.03 * s), (z + 0.86 * s, 0.0)], (x, y), segs=12)


def ccw(ring):
    return ring if ak.ring_area(ring) > 0 else ring[::-1]


def edges(ring):
    r = ccw(ring)
    return [(r[k], r[(k + 1) % len(r)]) for k in range(len(r))]


# ---------------------------------------------------------------- Eichardt's

def eichardts(K, ground):
    cx, cy = EICHARDTS["at"]
    g = ground(cx, cy)
    P = ak.Frame(cx, cy, EICHARDTS["axis"], g)
    U0, U1, V0, V1 = -15.5, 15.5, -11.6, 10.4      # the walls, from the LiDAR's roof edges
    Z_GF, Z_FRIEZE, Z_CORN, Z_PAR = 4.3, 7.2, 7.65, 8.3  # the string course, the frieze, the cornice, the parapet
    ring = ak.rect(U0, U1, V0, V1)
    plaster, trim, green, win = "eich_plaster", "eich_trim", "eich_green", "eich_window"
    ak.prism(K[plaster], P, ring, -0.3, Z_PAR, top=False)
    ak.band(K[trim], P, ring, -0.3, out=0.18, h=0.85)                        # the plinth
    ak.band(K[trim], P, ring, Z_GF, out=0.16, h=0.32)                        # the string courses
    ak.band(K[trim], P, ring, 5.0, out=0.08, h=0.12)                         # the first floor's sill course
    ak.band(K[trim], P, ring, Z_FRIEZE, out=0.06, h=0.45)                    # the frieze
    ak.cornice(K[trim], P, ring, Z_CORN, ((0.0, 0.0), (0.2, 0.12), (0.42, 0.3), (0.62, 0.45), (0.62, 0.62), (0.0, 0.62)))
    # the cornice's brackets (modillions) under the corona, every 0.6 m
    for a, b in edges(ring):
        a, b = np.asarray(a, float), np.asarray(b, float)
        t = (b - a) / np.linalg.norm(b - a)
        n = np.array([t[1], -t[0]])
        for s in np.arange(0.4, np.linalg.norm(b - a) - 0.2, 0.6):
            q = a + t * s
            K[trim].box(P(*(q + n * 0.02), Z_CORN + 0.12), P(*(q + n * 0.38), Z_CORN + 0.12), 0.12, 0.16)
    # the parapet: a balustrade on a plinth all round, with piers and urns
    par = ak.rect(U0 + 0.1, U1 - 0.1, V0 + 0.1, V1 - 0.1)
    ak.prism(K[trim], P, par, Z_PAR, Z_PAR + 0.22, top=False)
    K["eich_bal"].panel([P(u, v, Z_PAR + 0.22) for u, v in par + [par[0]]], 0.62)
    ak.cornice(K[trim], P, par, Z_PAR + 0.84, ((0.0, 0.0), (0.08, 0.0), (0.08, 0.16), (0.0, 0.16)))
    piers = [(U0, V0), (U1, V0), (U1, V1), (U0, V1), (-1.08, V0), (5.64, V0), (-9.2, V0), (10.4, V0), (U0, -0.6)]
    for u, v in piers:
        ak.block(K[trim], P, u - 0.32, u + 0.32, v - 0.32, v + 0.32, Z_PAR, Z_PAR + 1.05)
        if (u, v) not in ((-1.08, V0), (5.64, V0)):
            urn(K[trim], *P(u, v, 0)[:2], g + Z_PAR + 1.05, 0.9)
    # rusticated quoins: the corners and the pediment's bay
    for (u, v), (du, dv) in (((U0, V0), (1, 1)), ((U1, V0), (-1, 1)), ((U1, V1), (-1, -1)), ((U0, V1), (1, -1))):
        for k, z in enumerate(np.arange(0.55, Z_FRIEZE - 0.2, 0.45)):
            w = 0.9 if k % 2 else 0.6
            ak.block(K[trim], P, min(u, u + du * w), max(u, u + du * w), min(v, v - dv * 0.08), max(v, v - dv * 0.08), z, z + 0.4, top=False)
            ak.block(K[trim], P, min(u, u + du * 0.08) - (0.08 if du > 0 else 0), max(u, u - du * 0.08), min(v, v + dv * (1.5 - w)), max(v, v + dv * (1.5 - w)), z, z + 0.4, top=False)
    for u in (-1.08, 5.64):  # between the windows either side of the middle bay
        for z in np.arange(0.55, Z_FRIEZE - 0.2, 0.45):
            ak.block(K[trim], P, u - 0.4, u + 0.4, V0 - 0.14, V0, z, z + 0.4, top=False)
    # the pediment over the lake front's middle bay, its shell in an arched attic panel, scrolls either side
    pu0, pu1 = -1.5, 6.06
    pm = (pu0 + pu1) / 2
    ak.block(K[trim], P, pu0 + 0.5, pu1 - 0.5, V0 - 0.2, V0 + 0.4, Z_PAR, Z_PAR + 1.35)
    ak.pediment(K[trim], P, pu0, pu1, V0 - 0.35, V0 + 0.4, Z_PAR + 1.35, 1.25)
    ak.cornice(K[trim], P, ak.rect(pu0 + 0.3, pu1 - 0.3, V0 - 0.2, V0 + 0.4), Z_PAR + 1.2, ((0.0, 0.0), (0.18, 0.08), (0.18, 0.18), (0.0, 0.18)))
    urn(K[trim], *P(pm, V0, 0)[:2], g + Z_PAR + 2.6, 0.75)
    m = K[trim]
    sc, r = (pm, V0 - 0.22), 0.95  # the shell: ribs fanning up from its hinge
    for j in range(9):
        a0, a1 = math.pi * j / 9, math.pi * (j + 1) / 9
        rr = r * (0.94 if j % 2 else 1.0)
        m.tri(P(sc[0], sc[1] - 0.06, Z_PAR + 0.1), P(sc[0] + rr * math.cos(a0), sc[1] - 0.02, Z_PAR + 0.1 + rr * math.sin(a0)),
              P(sc[0] + rr * math.cos(a1), sc[1] - 0.02, Z_PAR + 0.1 + rr * math.sin(a1)))
    K[green].tri(P(sc[0], sc[1] + 0.01, Z_PAR + 0.1), P(sc[0] + 1.08, sc[1] + 0.01, Z_PAR + 0.1), P(sc[0], sc[1] + 0.01, Z_PAR + 1.18))
    K[green].tri(P(sc[0], sc[1] + 0.01, Z_PAR + 0.1), P(sc[0], sc[1] + 0.01, Z_PAR + 1.18), P(sc[0] - 1.08, sc[1] + 0.01, Z_PAR + 0.1))
    for s in (-1, 1):  # the Baroque scrolls at the attic's feet
        u = pm + s * 2.9
        m.box(P(u, V0 - 0.1, Z_PAR + 0.25), P(u + s * 0.6, V0 - 0.1, Z_PAR + 0.25), 0.3, 0.5)
        m.tube([P(u + s * 0.6 + s * 0.25 * math.cos(a), V0 - 0.1, Z_PAR + 0.45 + 0.25 * math.sin(a)) for a in np.linspace(-1.5, 3.2, 9)], 0.08, sides=6)
    # the windows: thirteen bays on the lake front, eight on Ballarat Street, plainer behind
    fronts = {"sw": ((U0, V0), (U1, V0), [2.1 + 2.24 * k for k in range(13)]),  # metres along each front from its first corner
              "nw": ((U0, V1), (U0, V0), [1.2 + 2.6 * k for k in range(8)]),
              "ne": ((U1, V1), (U0, V1), [2.0 + 2.6 * k for k in range(11)]),
              "se": ((U1, V0), (U1, V1), [2.6 + 2.8 * k for k in range(7)])}
    door_nw = 11.0  # the Ballarat Street door, under its Moorish arch, at the front's middle
    for side, (a, b, cs) in fronts.items():
        L = math.dist(a, b)
        for c in cs:
            if c < 0.8 or c > L - 0.8:
                continue
            if side == "sw" and abs((a[0] + c) - pm) < 1.0:  # the pediment's bay: a door below, a pair above
                window(K, P, a, b, c, 0.1, 1.5, 3.2, win, green, panes=(2, 4), surround=trim)
                window(K, P, a, b, c, 5.15, 1.1, 2.15, win, green, panes=(2, 2), surround=trim)
                continue
            if side == "nw" and abs(c - door_nw) < 1.3:
                continue
            gf_w = 1.15 if side in ("sw", "nw") else 1.0
            window(K, P, a, b, c, 0.95, gf_w, 2.45, win, green, panes=(2, 3), surround=trim if side in ("sw", "nw") else None)
            window(K, P, a, b, c, 5.15, 1.0, 2.15, win, green, panes=(2, 2), surround=trim if side in ("sw", "nw") else None)
            if side in ("sw", "nw"):  # the ground floor's Gibbs surrounds: blocks either side, a keystone over the head
                a2, b2 = np.asarray(a, float), np.asarray(b, float)
                t = (b2 - a2) / L
                n = np.array([t[1], -t[0]])
                for z in (1.1, 1.75, 2.4):
                    for s in (-1, 1):
                        q = a2 + t * (c + s * (gf_w / 2 + 0.22)) + n * 0.12
                        K[trim].box(P(*q, z), P(*q, z + 0.36), 0.32, 0.12)
                q = a2 + t * c + n * 0.14
                K[trim].box(P(*q, 3.3), P(*q, 3.75), 0.32, 0.14)
    # the Moorish door: a horseshoe arch, and its echo on the balcony door above
    a, b = fronts["nw"][0], fronts["nw"][1]
    for z0, w, h in ((0.05, 1.6, 3.3), (4.65, 1.2, 2.6)):
        horseshoe(K, P, a, b, door_nw, z0, w, h, win, trim, green)
    # balconies: cast iron in dark green on curved brackets, over the lake front and the Ballarat door
    for (bu0, bu1) in ((-11.3, -5.0), (9.6, 14.2)):
        balcony(K, P, bu0, bu1, V0, -1, Z_GF + 0.3, 1.15)
    balcony(K, P, V1 - door_nw - 1.6, V1 - door_nw + 1.6, U0, -1, Z_GF + 0.3, 1.0, side_u=True)
    # the roof: two parallel hips of grey iron behind the parapet (the LiDAR's two ridges)
    for v0, v1 in ((V0 + 0.4, -0.7), (-0.7, V1 - 0.4)):
        hip(K["eich_roof"], P, U0 + 0.4, U1 - 0.4, v0, v1, Z_PAR - 0.3, Z_PAR + 0.75)
    for u, v in ((-12.0, 2.0), (-2.0, 8.5), (8.0, 2.0)):  # chimney stacks
        ak.block(K[plaster], P, u - 0.45, u + 0.45, v - 0.3, v + 0.3, Z_PAR - 0.3, Z_PAR + 1.9)
        ak.band(K[trim], P, ak.rect(u - 0.45, u + 0.45, v - 0.3, v + 0.3), Z_PAR + 1.6, out=0.08, h=0.18)


def horseshoe(K, P, a, b, centre, z0, w, h, glass, trim, green):
    """A door or window under a horseshoe arch (the arch swells past a semicircle): the opening, its
    moulded surround, a keystone and the door's leaves."""
    a2, b2 = np.asarray(a, float), np.asarray(b, float)
    t = (b2 - a2) / np.linalg.norm(b2 - a2)
    n = np.array([t[1], -t[0]])
    c = a2 + t * centre
    Q = lambda s, z, d: P(*(c + t * s + n * d), z)
    r = w / 2 * 1.12
    zc = z0 + h - r
    pts = [(-w / 2, z0), (-w / 2, zc - 0.3)] + [(r * math.cos(x), zc + r * math.sin(x)) for x in np.linspace(math.pi + 0.35, -0.35, 15)] + [(w / 2, zc - 0.3), (w / 2, z0)]
    g = K[glass]
    for (s0, z0_), (s1, z1_) in zip(pts[:-1], pts[1:]):
        g.tri(Q(0, zc - 0.3, 0.02), Q(s0, z0_, 0.02), Q(s1, z1_, 0.02))
    g.quad(Q(-w / 2, z0, 0.02), Q(w / 2, z0, 0.02), Q(w / 2, zc - 0.3, 0.02), Q(-w / 2, zc - 0.3, 0.02))
    m = K[trim]
    ring = [(r + 0.2) * np.array([math.cos(x), math.sin(x)]) for x in np.linspace(math.pi + 0.35, -0.35, 15)]
    for p, q in zip(ring[:-1], ring[1:]):
        m.box(Q(p[0], zc + p[1], 0.1), Q(q[0], zc + q[1], 0.1), 0.2, 0.22)
    for s in (-1, 1):
        m.box(Q(s * (w / 2 + 0.15), z0, 0.1), Q(s * (w / 2 + 0.15), zc - 0.1, 0.1), 0.24, 0.22)
    m.box(Q(0, zc + r + 0.05, 0.14), Q(0, zc + r + 0.5, 0.14), 0.3, 0.2)
    d = K[green]  # the two leaves, to the springing
    for s in (-w / 4, w / 4):
        d.box(Q(s, z0 + 0.1, 0.05), Q(s, zc - 0.4, 0.05), w / 2 - 0.08, 0.05)


def balcony(K, P, a0, a1, at, sgn, z, depth, side_u=False):
    """A cast-iron balcony from a0 to a1 along a front (v = at, or u = at with side_u), standing out
    `depth` m (sgn: the outward direction of the front), on curved brackets."""
    Q = (lambda s, d, h: P(at + sgn * d, s, h)) if side_u else (lambda s, d, h: P(s, at + sgn * d, h))
    m = K["eich_green"]
    m.quad(Q(a0, 0, z), Q(a1, 0, z), Q(a1, depth, z), Q(a0, depth, z))
    m.quad(Q(a0, depth, z - 0.12), Q(a1, depth, z - 0.12), Q(a1, 0, z - 0.12), Q(a0, 0, z - 0.12))
    m.box(Q(a0, depth, z - 0.06), Q(a1, depth, z - 0.06), 0.14, 0.14)
    for s in np.linspace(a0 + 0.2, a1 - 0.2, max(2, int((a1 - a0) / 2.2) + 1)):
        pts = [Q(s, depth * (1 - math.cos(x)) * 0.92, z - 0.12 - 0.85 * (1 - math.sin(x))) for x in np.linspace(0, math.pi / 2, 7)]
        m.tube(pts, 0.05, sides=6)
        m.box(Q(s, 0.02, z - 0.95), Q(s, 0.02, z - 0.12), 0.1, 0.06)
    path = [(a0, 0.02), (a0, depth), (a1, depth), (a1, 0.02)]
    railing(K, Q, path, z, 1.0, "eich_iron", "eich_green", every=1.4, finial=True)


def hip(m, P, u0, u1, v0, v1, z_eave, z_ridge):
    """A hipped roof (a ridge along u)."""
    vm, half = (v0 + v1) / 2, (v1 - v0) / 2
    rise = z_ridge - z_eave
    r0, r1 = u0 + half, u1 - half
    if r1 < r0:
        r0 = r1 = (u0 + u1) / 2
    L = u1 - u0
    s = math.hypot(half, rise)
    m.quad(P(u0, v0, z_eave), P(u1, v0, z_eave), P(r1, vm, z_ridge), P(r0, vm, z_ridge), [[0, 0], [L, 0], [L - half, s], [half, s]])
    m.quad(P(u1, v1, z_eave), P(u0, v1, z_eave), P(r0, vm, z_ridge), P(r1, vm, z_ridge), [[0, 0], [L, 0], [L - half, s], [half, s]])
    m.tri(P(u0, v1, z_eave), P(u0, v0, z_eave), P(r0, vm, z_ridge), [[0, 0], [2 * half, 0], [half, s]])
    m.tri(P(u1, v0, z_eave), P(u1, v1, z_eave), P(r1, vm, z_ridge), [[0, 0], [2 * half, 0], [half, s]])


# ---------------------------------------------------------------- St Peter's

def lancet(K, P, a, b, centre, z0, w, h, pair=False, louvre=False, glass=True):
    """A Gothic lancet (or a pair under one hood) in a freestone surround, leaded lights or a belfry's
    louvres; without glass, the surround of an open doorway."""
    a2, b2 = np.asarray(a, float), np.asarray(b, float)
    t = (b2 - a2) / np.linalg.norm(b2 - a2)
    n = np.array([t[1], -t[0]])
    c0 = a2 + t * centre
    lights = [-(w / 2 + 0.09), w / 2 + 0.09] if pair else [0.0]
    for off in lights:
        c = c0 + t * off
        Q = lambda s, z, d: P(*(c + t * s + n * d), z)
        zs = z0 + h - w * 0.85  # the springing: a pointed (equilateral-ish) head above it
        right = [(w / 2 * math.cos(x * math.pi / 2) ** 0.7, zs + (z0 + h - zs) * math.sin(x * math.pi / 2)) for x in np.linspace(0, 1, 6)]
        poly = [(-w / 2, z0), (w / 2, z0)] + right + [(-p[0], p[1]) for p in right[::-1]]
        g = K["stp_lancet"]
        cz = (z0 + zs) / 2
        for (s0, za), (s1, zb) in zip(poly, poly[1:] + poly[:1]):
            if glass:
                g.tri(Q(0, cz, 0.02), Q(s0, za, 0.02), Q(s1, zb, 0.02))
        f = K["stp_freestone"]
        for (s0, za), (s1, zb) in zip(poly[1:], poly[2:] + poly[:1]):
            f.box(Q(s0, za, 0.08), Q(s1, zb, 0.08), 0.16, 0.16)
        if not glass:
            pass
        elif louvre:
            for z in np.arange(z0 + 0.15, zs, 0.18):
                K["stp_timber"].box(Q(-w / 2, z, 0.06), Q(w / 2, z, 0.06), 0.03, 0.12)
        else:  # the leaded lights' cames
            l = K["stp_lead"]
            l.box(Q(0, z0, 0.035), Q(0, zs + (z0 + h - zs) * 0.8, 0.035), 0.02, 0.02)
            for z in np.arange(z0 + 0.35, zs, 0.35):
                l.box(Q(-w / 2, z, 0.035), Q(w / 2, z, 0.035), 0.015, 0.015)
    # the hood mould and the sill
    f = K["stp_freestone"]
    span = (w + 0.18) * (2 if pair else 1) / 2 + 0.12
    Q = lambda s, z, d: P(*(c0 + t * s + n * d), z)
    f.box(Q(-span, z0 - 0.1, 0.1), Q(span, z0 - 0.1, 0.1), 0.18, 0.24)


def buttress(K, P, u, v, out_u, out_v, z0, h, mat="stp_greywacke", cap="stp_freestone"):
    """A stepped buttress against a wall at (u, v), standing out along (out_u, out_v)."""
    w, d = 0.55, 0.75
    e = np.array([out_u, out_v], float)
    f = np.array([-out_v, out_u], float)
    for k, (zz0, zz1, dd) in enumerate(((z0, z0 + h * 0.55, d), (z0 + h * 0.55, z0 + h, d * 0.62))):
        c = np.array([u, v]) + e * dd / 2
        corners = [c - f * w / 2 - e * dd / 2, c + f * w / 2 - e * dd / 2, c + f * w / 2 + e * dd / 2, c - f * w / 2 + e * dd / 2]
        ak.prism(K[mat], P, [tuple(q) for q in corners], zz0, zz1)
        tip = c + e * dd / 2
        K[cap].quad(P(*(tip - f * w / 2), zz1), P(*(tip + f * w / 2), zz1), P(*(tip + f * w / 2 - e * 0.3), zz1 + 0.3), P(*(tip - f * w / 2 - e * 0.3), zz1 + 0.3))


def st_peters(K, ground):
    cx, cy = ST_PETERS["at"]
    P0 = ak.Frame(cx, cy, ST_PETERS["axis"], 0.0)
    gs = [ground(*P0(u, v, 0)[:2]) for u in (-10.5, 0, 10) for v in (-4.4, 4.4)]
    g = min(gs)
    P = ak.Frame(cx, cy, ST_PETERS["axis"], g)
    stone, free, slate, timber = "stp_greywacke", "stp_freestone", "stp_slate", "stp_timber"
    rise = max(gs) - g
    # the nave (west, u < 1.5) and the chancel, lower and narrower, to the east
    NU0, NU1, NV = -10.5, 1.5, 4.4
    CU1, CV = 9.8, 3.4
    E_N, R_N, E_C, R_C = 4.8 + rise, 8.5 + rise * 0.5, 4.5 + rise, 7.7 + rise * 0.5
    # the walls, opened where the inside is walked into (interiors.py): the porch's doorway into the nave on the
    # north, the chancel arch between the nave and the chancel (whose west face the nave's east wall is)
    D = _interiors().stp_dims(rise)
    F = D["F"]
    s = 0.0
    for a, b, holes in (((NU0, -NV), (NU1, -NV), []), ((NU1, -NV), (NU1, NV), [(NV, 3.6, F, F + 4.7, True)]),
                        ((NU1, NV), (NU0, NV), [(NU1 - D["porch_u"], D["inner_w"], F, F + D["inner_h"], True)]), ((NU0, NV), (NU0, -NV), [])):
        ak.holed_wall(K[stone], P, a, b, -0.4, E_N, holes, s0=s)
        s += math.dist(a, b)
    for a, b in (((NU1, -CV), (CU1, -CV)), ((CU1, -CV), (CU1, CV)), ((CU1, CV), (NU1, CV))):
        s += ak.wall(K[stone], P, a[0], a[1], b[0], b[1], -0.4, E_C, s)
    gable(K, P, NU0, NU1, -NV, NV, E_N, R_N, slate, stone, over=0.3)
    gable(K, P, NU1, CU1, -CV, CV, E_C, R_C, slate, stone, over=0.3, ends=(False, True))   # (its west end is the nave's wall, open in the chancel arch)
    for (u0, u1, v) in ((NU0, NU1, NV), (NU1, CU1, CV)):  # the plinth course and the eaves' corbel table
        for s in (-1, 1):
            K[free].box(P(u0 - 0.05, s * (v + 0.08), 0.5), P(u1 + 0.05, s * (v + 0.08), 0.5), 0.16, 0.18)
    for u0, u1, e, ridge, v in ((NU0, NU1, E_N, R_N, NV), (NU1, CU1, E_C, R_C, CV)):  # the gables' freestone copings and their crosses
        for u in (u0, u1):
            if u == NU1:
                continue
            for s in (-1, 1):
                K[free].box(P(u, s * (v + 0.1), e), P(u, 0, ridge + 0.12), 0.32, 0.2)
            K[free].box(P(u, 0, ridge + 0.1), P(u, 0, ridge + 0.85), 0.12, 0.12)
            K[free].box(P(u, -0.25, ridge + 0.6), P(u, 0.25, ridge + 0.6), 0.12, 0.12)
    # the windows: paired lancets in the nave's bays between buttresses, a triple light at each end
    for s, ring_edge in ((-1, ((NU0, -NV), (NU1, -NV))), (1, ((NU1, NV), (NU0, NV)))):
        a, b = ring_edge
        for c in (2.0, 6.0, 10.0):
            if s > 0 and 9.0 < c < 11.0:
                continue  # the west porch
            lancet(K, P, a, b, c, 1.6, 0.48, 2.2, pair=True)
        for u in (NU0 + 0.3, -6.5, -2.5, NU1 - 0.3):
            if s > 0 and u < -6:
                continue
            buttress(K, P, u, s * NV, 0, s, -0.3, 3.4)
    for s, (a, b) in ((-1, ((NU1, -CV), (CU1, -CV))), (1, ((CU1, CV), (NU1, CV)))):
        for c in (2.2, 5.6):
            if s < 0 and c > 3:
                continue  # the vestry
            if s > 0 and c < 3:
                continue  # the tower
            lancet(K, P, a, b, c, 1.7, 0.42, 2.0, pair=False)
    for c in (-1.1, 0.0, 1.1):  # the east window over the altar (the Call of St Peter) and the west window
        lancet(K, P, (CU1, -CV), (CU1, CV), CV + c, 1.9 - abs(c) * 0.4, 0.55, 3.0 - abs(c) * 0.7)
        lancet(K, P, (NU0, NV), (NU0, -NV), NV + c, 2.0 - abs(c) * 0.4, 0.6, 3.4 - abs(c) * 0.8)
    for u, v in ((NU0, -NV), (NU0, NV), (CU1, -CV), (CU1, CV)):  # angle buttresses at the corners
        su = -1 if u == NU0 else 1
        buttress(K, P, u + su * 0.1, v, su, 0, -0.3, 3.0)
    # the tower: square, beside the nave's east end on the north side; belfry lancets, battlements,
    # the octagonal slate spire and its cross
    tc, tw = np.array([2.8, 7.0]), 2.2
    ring = ak.rect(tc[0] - tw, tc[0] + tw, tc[1] - tw, tc[1] + tw)
    Z_BELL, Z_PAR = 6.2 + rise, 9.0 + rise
    ak.prism(K[stone], P, ring, -0.4, Z_PAR, top=False)
    ak.band(K[free], P, ring, Z_BELL, out=0.14, h=0.25)
    ak.band(K[free], P, ring, Z_PAR - 0.35, out=0.12, h=0.2)
    for (a, b) in edges(ring):
        if math.dist(a, b) < 1:
            continue
        lancet(K, P, a, b, tw, Z_BELL + 0.45, 0.42, 1.75, pair=True, louvre=True)
        if b[1] > tc[1] + tw - 0.1 or a[1] > tc[1] + tw - 0.1 or a[0] < tc[0] - tw + 0.1:
            lancet(K, P, a, b, tw, 2.4, 0.5, 1.5)
        # the battlements: merlons and crenels along the parapet, the coping on top
        a2, b2 = np.asarray(a, float), np.asarray(b, float)
        t = (b2 - a2) / np.linalg.norm(b2 - a2)
        for k in range(5):
            q0, q1 = a2 + t * (0.15 + k * 0.92), a2 + t * (0.15 + k * 0.92 + 0.55)
            ak.prism(K[stone], P, [tuple(q0), tuple(q1), tuple(q1 + np.array([t[1], -t[0]]) * -0.35), tuple(q0 + np.array([t[1], -t[0]]) * -0.35)], Z_PAR, Z_PAR + 0.55)
            K[free].quad(P(*q0, Z_PAR + 0.56), P(*q1, Z_PAR + 0.56), P(*(q1 - np.array([t[1], -t[0]]) * 0.35), Z_PAR + 0.56), P(*(q0 - np.array([t[1], -t[0]]) * 0.35), Z_PAR + 0.56))
    for u, v in ((tc[0] - tw, tc[1] + tw), (tc[0] + tw, tc[1] + tw)):  # quoins up the corners
        for k, z in enumerate(np.arange(0.2, Z_PAR - 0.4, 0.5)):
            w = 0.3 if k % 2 else 0.2
            K[free].box(P(u, v, z), P(u, v, z + 0.26), w, w)
    # the tip, checked against LINZ's 2021 1 m surface model (issue 269): 15.2 m over the bare earth in the cell at
    # the tower's centre, the parapet's plateau at 9.4 m; a 1 m posting misses a slender tip by up to a metre
    spire_top = 16.0 + rise
    x, y, _ = P(*tc, 0)
    m = K[slate]
    oct_r = [(Z_PAR - 0.2, 1.55), (Z_PAR + 0.7, 1.35), (spire_top - 0.3, 0.08), (spire_top, 0.0)]
    m.lathe([(g + z, r) for z, r in oct_r], (x, y), segs=8)
    K[free].lathe([(g + spire_top - 0.15, 0.09), (g + spire_top + 0.1, 0.09), (g + spire_top + 0.1, 0.0)], (x, y), segs=8)
    K["stp_lead"].box((x, y, g + spire_top), (x, y, g + spire_top + 1.0), 0.07, 0.07)
    K["stp_lead"].box(P(tc[0] - 0.28, tc[1], spire_top + 0.7), P(tc[0] + 0.28, tc[1], spire_top + 0.7), 0.06, 0.06)
    # the west porch on the north side, stone with a slate gable, its pointed doorway facing north (its oak door and
    # the steps up to it are the inside's, interiors.py)
    pu0, pu1, pv1 = D["pu0"], D["pu1"], D["pv1"]
    dr = D["door"]
    half = (pu1 - pu0) / 2
    north_top = lambda s: 2.6 + (4.3 - 2.6) * (1 - abs(s - half) / half)   # the north face up into its gable
    for a, b, holes, top in (((pu1, NV), (pu1, pv1), [], 2.6), ((pu1, pv1), (pu0, pv1), [(pu1 - dr["c"], dr["w"], F, F + dr["h"], True)], north_top),
                             ((pu0, pv1), (pu0, NV), [], 2.6)):
        ak.holed_wall(K[stone], P, a, b, -0.4, top, holes)
    gable(K, P, pu0, pu1, NV, pv1, 2.6, 4.3, slate, stone, over=0.25, along_u=False, ends=(True, False))
    lancet(K, P, (pu1, pv1), (pu0, pv1), pu1 - dr["c"], F, dr["w"], dr["h"], glass=False)
    # the vestry on the south side of the chancel, under its own gable
    vu0, vu1, vv0 = 4.2, 8.2, -CV - 3.0
    ak.block(K[stone], P, vu0, vu1, vv0, -CV, -0.4, 3.2 + rise, top=False)
    gable(K, P, vu0, vu1, vv0, -CV, 3.2 + rise, 4.9 + rise, slate, stone, over=0.25, along_u=False)
    lancet(K, P, (vu0, vv0), (vu1, vv0), 2.0, 1.4, 0.5, 1.5, pair=True)
    # the lych-gate on the path beside the tower: oak posts on a stone sill, a steep slate gable
    lc = np.array([3.0, 11.6])
    lu, lv = 1.3, 1.0
    for su in (-1, 1):
        for sv in (-1, 1):
            q = lc + np.array([su * lu, sv * lv])
            K[timber].box(P(*q, -0.1), P(*q, 2.3), 0.2, 0.2)
        K[free].box(P(lc[0] + su * lu, lc[1] - lv - 0.15, 0.05), P(lc[0] + su * lu, lc[1] + lv + 0.15, 0.05), 0.35, 0.3)
        K[timber].box(P(lc[0] + su * lu, lc[1] - lv, 2.3), P(lc[0] + su * lu, lc[1] + lv, 2.3), 0.22, 0.24)  # the plates
        for sv in (-1, 1):  # the arched braces
            K[timber].tube([P(lc[0] + su * lu, lc[1] + sv * (lv - 0.6 * (1 - math.cos(x))), 2.3 - 0.6 * math.sin(x)) for x in np.linspace(0, math.pi / 2, 6)], 0.06, sides=5)
    for v in (-lv, lv):
        K[timber].box(P(lc[0] - lu, lc[1] + v, 2.3), P(lc[0] + lu, lc[1] + v, 2.3), 0.18, 0.2)
    ridge = 4.1
    for su in (-1, 1):  # the gable trusses
        K[timber].box(P(lc[0] + su * lu, lc[1] - lv, 2.4), P(lc[0] + su * lu, lc[1], ridge), 0.16, 0.16)
        K[timber].box(P(lc[0] + su * lu, lc[1] + lv, 2.4), P(lc[0] + su * lu, lc[1], ridge), 0.16, 0.16)
        K[timber].box(P(lc[0] + su * lu, lc[1], 2.4), P(lc[0] + su * lu, lc[1], ridge), 0.12, 0.12)
    gable(K, lambda u, v, z: P(lc[0] + u, lc[1] + v, z), -lu, lu, -lv, lv, 2.4, ridge, slate, timber, over=0.35, along_u=True)
    K[timber].box(P(lc[0] - lu - 0.35, lc[1], ridge + 0.05), P(lc[0] + lu + 0.35, lc[1], ridge + 0.05), 0.14, 0.16)


# ---------------------------------------------------------------- Williams Cottage

def williams(K, ground):
    cx, cy = WILLIAMS["at"]
    g = ground(cx, cy)
    P = ak.Frame(cx, cy, WILLIAMS["axis"], g)
    board, ox, roof, stone, brick, win = "will_board", "will_oxblood", "will_roof", "will_stone", "will_brick", "will_window"
    # the cottage: a very high gable (ridge along v), a lean-to behind, the later rear room
    U0, U1, V0, V1 = -6.8, -0.8, -4.8, 2.4
    # the walls, opened at the front door and the doorway through to the lean-to (interiors.py walks them)
    D = _interiors().will_dims()
    F, dr = D["F"], D["door"]
    s = 0.0
    for a, b, holes in (((U0, V0), (U1, V0), []), ((U1, V0), (U1, V1), [(D["inner_v"] - V0, D["inner_clear"], F, F + 2.0, False)]), ((U1, V1), (U0, V1), []),
                        ((U0, V1), (U0, V0), [(V1 - dr["v"], dr["clear"], F, F + dr["h"], False)])):
        ak.holed_wall(K[board], P, a, b, -0.6, 2.7, holes, s0=s)
        s += math.dist(a, b)
    # the doorways' last few centimetres of wall, drawn but open to walkers (interiors.py will_dims)
    for a, b, c, w, wc, h in (((U0, V1), (U0, V0), V1 - dr["v"], dr["w"], dr["clear"], dr["h"]), ((U1, V0), (U1, V1), D["inner_v"] - V0, D["inner_w"], D["inner_clear"], 2.0)):
        A, B = np.asarray(a, float), np.asarray(b, float)
        t = (B - A) / np.linalg.norm(B - A)
        for s0, s1 in ((c - wc / 2, c - w / 2), (c + w / 2, c + wc / 2)):
            p0, p1 = A + t * s0, A + t * s1
            K["will_board_soft"].quad(P(*p0, F), P(*p1, F), P(*p1, F + h), P(*p0, F + h), [[s0, F], [s1, F], [s1, F + h], [s0, F + h]])
    gable(K, P, U0, U1, V0, V1, 2.7, 5.9, roof, board, over=0.3, along_u=False, fascia=ox)
    for a, b in (((U1, V0), (4.5, V0)), ((4.5, V0), (4.5, V1)), ((4.5, V1), (U1, V1))):   # the lean-to (its west wall is the cottage's)
        ak.wall(K[board], P, a[0], a[1], b[0], b[1], -0.6, 2.35)
    for v in (V0, V1):  # the lean-to's end walls up to its roof
        K[board].tri(P(U1, v, 2.35), P(4.5, v, 2.35), P(U1, v, 3.2))
    skillion(K, lambda u, v, z: P(v, u, z), V0, V1, U1, 4.5, 3.2, 2.35, roof)
    ak.block(K[board], P, 4.5, 7.3, -2.5, V1, -0.6, 2.9, top=False)
    skillion(K, lambda u, v, z: P(v, u, z), -2.5, V1, 4.5, 7.3, 3.1, 2.85, roof, over=0.2)
    # the small stone store room to the side (HNZ List 2336: "a small stone store room is situated to the side"),
    # where the mapped footprint stands out 3 m from the lean-to's north-east wall: schist rubble under an iron
    # skillion falling away from the cottage, a plank door in its end wall
    su0, su1, sv1 = 1.5, 4.1, V1 + 3.0
    ak.block(K[stone], P, su0, su1, V1, sv1, -0.6, 2.15, top=False)
    K[stone].tri(P(su0, V1, 2.15), P(su0, sv1, 2.15), P(su0, V1, 2.6))  # its end walls up to the roof
    K[stone].tri(P(su1, sv1, 2.15), P(su1, V1, 2.15), P(su1, V1, 2.6))
    skillion(K, lambda u, v, z: P(u, v, z), su0, su1, V1, sv1, 2.6, 2.1, roof, over=0.15)
    ak.opening(K[ox], P, (su1, V1), (su1, sv1), 0.05, 0.8, 1.75, depth=0.03, centre=1.6)
    ak.band(K[ox], P, ak.rect(U0, 7.3, V0, V1), -0.6, out=0.04, h=0.75)   # the flood wall's painted face
    # chimneys: schist rubble, the main one between the roof and the lean-to, the rear room's; brick tops
    for (cu, cv, z1, w, d) in ((-0.8, -3.0, 5.9, 1.3, 1.0), (7.3, 1.6, 4.5, 1.1, 1.4)):
        ak.block(K[stone], P, cu - w / 2, cu + w / 2, cv - d / 2, cv + d / 2, -0.6, z1 - 0.6)
        ak.block(K[brick], P, cu - w / 2 + 0.15, cu + w / 2 - 0.15, cv - d / 2 + 0.1, cv + d / 2 - 0.1, z1 - 0.6, z1 + 0.35)
    x, y, _ = P(7.3, 1.6, 0)
    K["will_flue"].tube([(x, y, g + 4.7), (x, y, g + 6.3)], 0.13, sides=8)  # the rear chimney's tall black flue
    # the verandah to the lake: a skillion of iron on slender posts, a boarded floor
    skillion(K, lambda u, v, z: P(v, u, z), V0, V1, U0, U0 - 1.9, 2.55, 2.2, roof, over=0.15)
    for v in np.linspace(V0 + 0.1, V1 - 0.1, 4):
        K[ox].box(P(U0 - 1.8, v, 0.15), P(U0 - 1.8, v, 2.25), 0.1, 0.1)
    K[ox].box(P(U0 - 1.8, V0, 2.2), P(U0 - 1.8, V1, 2.2), 0.08, 0.16)
    ak.block(K[ox], P, U0 - 1.9, U0, V0, V1, -0.1, 0.15)
    # the front door and four-paned windows under the verandah, six-paned to the sides, 12-pane sashes
    front = ((U0, V1), (U0, V0))
    window(K, P, *front, 1.6, 0.6, 1.0, 1.4, win, ox, panes=(2, 2))
    window(K, P, *front, 5.6, 0.6, 1.0, 1.4, win, ox, panes=(2, 2))
    hw = dr["w"] / 2
    for s0, s1, z0, z1 in ((-hw - 0.1, -hw, F, F + dr["h"] + 0.1), (hw, hw + 0.1, F, F + dr["h"] + 0.1), (-hw - 0.1, hw + 0.1, F + dr["h"], F + dr["h"] + 0.12)):   # the architrave
        ak.block(K["will_oxblood_soft"], P, U0 - 0.05, U0, dr["v"] + s0, dr["v"] + s1, z0, z1)   # (drawn, not a wall to walkers)
    for (a, b), cs in ((((U0, V0), (U1, V0)), (1.8, 4.2)), (((U1, V1), (U0, V1)), (3.0,)), (((4.5, -2.5), (7.3, -2.5)), (1.4,))):
        for c in cs:
            window(K, P, a, b, c, 0.75, 0.85, 1.35, win, ox, panes=(3, 2))
    ak.opening(K[ox], P, (U1, V0), (4.5, V0), 0.05, 0.85, 2.0, depth=0.03, centre=3.4)


# ---------------------------------------------------------------- Steamer Wharf

def gabled_piece(K, ring, frame, half_w, vc, z0, eave, ridge, wall, roof, trim):
    """A pavilion on an irregular outline (world coordinates): walls from z0 to its roof, a gable
    roof whose ridge runs along the frame's u through v = vc, `half_w` m to each eave."""
    from shapely.geometry import LineString, Polygon
    from shapely.ops import split
    k = (ridge - eave) / half_w
    loc = [frame.local(x, y) for x, y in ring]
    z_at = lambda v: eave + max(0.0, half_w - abs(v - vc)) * k
    # the walls: densify each edge at the ridge's crossing, so the gables come to a point
    pts = []
    for a, b in zip(loc, loc[1:] + loc[:1]):
        pts.append(a)
        if (a[1] - vc) * (b[1] - vc) < 0:
            f = (vc - a[1]) / (b[1] - a[1])
            pts.append((a[0] + (b[0] - a[0]) * f, vc))
    W = lambda u, v, z: frame(u, v, z - frame.g)
    s = 0.0
    m = K[wall]
    for a, b in zip(pts, pts[1:] + pts[:1]):
        L = math.dist(a, b)
        za, zb = z_at(a[1]), z_at(b[1])
        m.quad(W(*a, z0), W(*b, z0), W(*b, zb), W(*a, za), [[s, z0], [s + L, z0], [s + L, zb], [s, za]])
        s += L
    # the roof, a little past the walls: the outline split at the ridge, each half a plane
    poly = Polygon(loc).buffer(0.35, join_style=2)
    us = [p[0] for p in loc]
    cut = LineString([(min(us) - 50, vc), (max(us) + 50, vc)])
    parts = split(poly, cut).geoms if poly.intersects(cut) else [poly]
    for part in parts:
        ring2 = list(part.exterior.coords)[:-1]
        if ak.ring_area(ring2) < 0:
            ring2 = ring2[::-1]
        for a, b, c in ak.ear_clip(ring2):
            K[roof].tri(W(*a, z_at(a[1])), W(*b, z_at(b[1])), W(*c, z_at(c[1])),
                        [[a[0], abs(a[1] - vc)], [b[0], abs(b[1] - vc)], [c[0], abs(c[1] - vc)]])
    for a, b in zip(pts, pts[1:] + pts[:1]):  # the fascia and the barge boards
        K[trim].box(W(*a, z_at(a[1]) - 0.1), W(*b, z_at(b[1]) - 0.1), 0.08, 0.22)
    return pts


def steamer_wharf(K, ground, solids):
    from shapely.geometry import Point, Polygon, box
    F = ak.Frame(0, 0, WHARF["axis"], 0.0)
    colours = ["wharf_green", "wharf_oxblood", "wharf_cream", "wharf_green", "wharf_cream", "wharf_oxblood", "wharf_cream"]
    k = 0
    for si in WHARF["solids"]:
        s = solids[si]
        ring = ak.simplify(s["ring"], 0.3)
        loc = Polygon([F.local(x, y) for x, y in ring]).buffer(0)
        u0, v0, u1, v1 = loc.bounds
        n = max(2, int(round((v1 - v0) / 7.0)))
        dv = (v1 - v0) / n
        for j in range(n):
            strip = loc.intersection(box(u0 - 1, v0 + j * dv + 0.05, u1 + 1, v0 + (j + 1) * dv - 0.05))
            for piece in getattr(strip, "geoms", [strip]):
                if piece.area < 25:
                    continue
                piece = piece.simplify(0.3)
                pr = [F(u, v, 0)[:2] for u, v in list(piece.exterior.coords)[:-1]]
                cx, cy = piece.centroid.coords[0]
                g = min(ground(*F(u, v, 0)[:2]) for u, v in list(piece.exterior.coords)[:-1])
                G = ak.Frame(0, 0, WHARF["axis"], g)
                wall = colours[k % len(colours)]
                k += 1
                vc = v0 + (j + 0.5) * dv
                pts = gabled_piece(K, pr, G, dv / 2, vc, g - 0.3, g + 5.6, g + 7.7, wall, "wharf_roof", "wharf_trim")
                # windows on both storeys of each face, white-framed; a balcony and stair on the lake end
                Wf = lambda u, v, z: G(u, v, z)
                outline = loc.exterior
                for a, b in edges(pts):
                    L = math.dist(a, b)
                    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                    if L < 3.0 or outline.distance(Point(mid)) > 0.4:
                        continue  # a party wall between two pavilions
                    for c in np.arange(1.6, L - 1.2, 2.4):
                        window(K, Wf, a, b, c, 1.0, 1.1, 1.7, "wharf_window", "wharf_trim", panes=(1, 1))
                        window(K, Wf, a, b, c, 3.6, 1.0, 1.5, "wharf_window", "wharf_trim", panes=(1, 1))
                umax = max(p[0] for p in pts)
                lake = [p for p in pts if p[0] > umax - 0.6]
                if len(lake) >= 2:  # the lake end (the largest u): a first-floor balcony in orange-red
                    vs = sorted(p[1] for p in lake)
                    va, vb = vs[0] + 0.4, vs[-1] - 0.4
                    if vb - va > 2.0:
                        ue = umax
                        K["wharf_red"].quad(G(ue, va, 3.2), G(ue + 1.4, va, 3.2), G(ue + 1.4, vb, 3.2), G(ue, vb, 3.2))
                        K["wharf_red"].quad(G(ue, vb, 3.05), G(ue + 1.4, vb, 3.05), G(ue + 1.4, va, 3.05), G(ue, va, 3.05))
                        for v in (va, vb):
                            K["wharf_red"].box(G(ue + 1.3, v, 0.0), G(ue + 1.3, v, 3.2), 0.18, 0.18)
                        railing(K, G, [(ue, va), (ue + 1.4, va), (ue + 1.4, vb), (ue, vb)], 3.2, 1.0, "wharf_rail", "wharf_red", every=1.5)
                        if j % 2 == 0:  # the stair down from it
                            K["wharf_red"].box(G(ue + 1.9, vb - 3.0, 0.1), G(ue + 1.9, vb - 0.1, 3.1), 0.9, 0.12)


def _interiors():
    """interiors.py beside this module (the city's own modules are not on the path)."""
    import importlib.util
    import os
    import sys
    key = "queenstown_interiors"
    if key not in sys.modules:
        spec = importlib.util.spec_from_file_location(key, os.path.join(os.path.dirname(os.path.abspath(__file__)), "interiors.py"))
        sys.modules[key] = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(sys.modules[key])
    return sys.modules[key]


def meshes(ground):
    """The heritage landmarks' meshes, and the solids they replace."""
    solids = ak.load_solids("queenstown")
    K = ak.Kit("qt_heritage", floodlit=["eich_plaster", "eich_trim", "eich_window", "stp_greywacke", "stp_freestone", "stp_lancet",
                                        "will_window", "wharf_window"],
               uv=["eich_plaster", "eich_roof", "eich_bal", "eich_iron", "stp_greywacke", "stp_slate", "will_board", "will_board_soft", "will_roof", "will_stone",
                   "will_brick", "wharf_green", "wharf_oxblood", "wharf_cream", "wharf_roof", "wharf_rail"])
    eichardts(K, ground)
    st_peters(K, ground)
    williams(K, ground)
    steamer_wharf(K, ground, solids)
    hidden = EICHARDTS["solids"] + ST_PETERS["solids"] + WILLIAMS["solids"] + WHARF["solids"]
    return K.out(), hidden


MATERIALS["will_board_soft"] = dict(MATERIALS["will_board"], solid=False)
MATERIALS["will_oxblood_soft"] = dict(MATERIALS["will_oxblood"], solid=False)   # (a doorway's margin: drawn, not a wall to walkers)
MATERIALS["will_flue"] = {"color": "#1d1f20", "roughness": 0.5, "metalness": 0.6}
MATERIALS["eich_bal"] = {"color": "#f1eee6", "roughness": 0.7, "metalness": 0.0, "pattern": "railing", "bar_m": 0.2, "rails_m": [0.06, 0.94]}
