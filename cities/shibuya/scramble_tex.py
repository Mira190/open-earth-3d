"""The surfaces of the Scramble that no scanned texture had, drawn here (cities/shibuya/hero.py registers them
with the kit: hero_kit.register). Seamless, and every change of tone in them has a cause in how the thing is
made (a block, a joint, a panel's seam): AGENTS.md, "The bar".

  plaza   Hachiko Square's paving: concrete blocks 200 x 100 mm in a herringbone, red-brown, each block within a
          few percent of its neighbours (one batch, one family of tones), sanded joints 3 mm, a chamfered arris.
          The scanned set it replaces (PavingStones128) was slabs a metre long in four tones from pink to grey:
          at the square's size that read as a jumble, not as paving.
  panel   Metal cladding panels 1.2 m square with an open joint between them, for the fronts that
          are clad, not tiled: flat, even, the joint the only thing drawn.
"""
import os

import numpy as np


def _noise(rng, h, w, beta=1.6):
    """Periodic noise with a power-law spectrum (1/f^beta); zero mean, unit deviation."""
    f = np.fft.fft2(rng.normal(size=(h, w)))
    fy, fx = np.meshgrid(np.fft.fftfreq(h) * h, np.fft.fftfreq(w) * w, indexing="ij")
    k = np.sqrt(fy * fy + fx * fx)
    k[0, 0] = 1.0
    a = np.real(np.fft.ifft2(f / k ** beta))
    a -= a.mean()
    return a / (a.std() or 1.0)


def _normal(height, strength):
    """A tangent-space normal map (OpenGL: y up) from a height field in texels, periodic."""
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5 * strength
    dy = (np.roll(height, 1, 0) - np.roll(height, -1, 0)) * 0.5 * strength     # (image rows run down, v up)
    n = np.dstack([-dx, -dy, np.ones_like(dx)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return np.clip((n * 0.5 + 0.5) * 255, 0, 255).astype(np.uint8)


def _save(d, colour, height, rough, strength):
    from PIL import Image
    os.makedirs(d, exist_ok=True)
    Image.fromarray(np.clip(colour, 0, 255).astype(np.uint8), "RGB").save(os.path.join(d, "Color.png"))
    Image.fromarray(_normal(height, strength), "RGB").save(os.path.join(d, "NormalGL.png"))
    Image.fromarray(np.clip(rough * 255, 0, 255).astype(np.uint8), "L").save(os.path.join(d, "Roughness.png"))


def _hash(a, b):
    """A value in 0..1 per pair of integer ids (arrays)."""
    h = (a.astype(np.int64) * 73856093) ^ (b.astype(np.int64) * 19349663)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def plaza(d, n=1024, cells=16):
    """Herringbone at 90 degrees: `cells` half-blocks (100 mm) a side, so 1.6 m to the repeat and 1.6 mm a texel."""
    rng = np.random.default_rng(11)
    y, x = np.mgrid[0:n, 0:n]
    fx, fy = x * cells / n, (n - 1 - y) * cells / n
    i, j = np.floor(fx).astype(int), np.floor(fy).astype(int)
    k = np.mod(i - j, 4)                                 # the bond: a block lies along u where k < 2, along v otherwise
    bi = np.where(k == 1, i - 1, i)
    bj = np.where(k == 2, j - 1, j)
    horiz = k < 2
    u = fx - i + np.where(k == 1, 1.0, 0.0)
    v = fy - j + np.where(k == 2, 1.0, 0.0)
    lu, lv = np.where(horiz, 2.0, 1.0), np.where(horiz, 1.0, 2.0)
    edge = np.minimum(np.minimum(u, lu - u), np.minimum(v, lv - v)) * (n / cells)     # texels from the block's edge
    joint = np.clip(1.0 - edge / 1.3, 0, 1)             # the sanded joint, about 3 mm
    arris = np.clip(edge / 4.0, 0, 1)                    # the chamfer, about 6 mm
    tone = _hash(np.mod(bi, cells), np.mod(bj, cells) * 2 + horiz)
    grain = _noise(rng, n, n, 0.5)                       # the block's aggregate
    base = np.array([150.0, 116.0, 106.0])               # red-brown concrete block (the 2024 photographs)
    col = base[None, None, :] * (0.975 + 0.05 * tone)[..., None]       # one batch: a few percent from block to block
    col *= (1 + 0.03 * grain)[..., None]
    col *= (0.95 + 0.05 * arris)[..., None]
    col = col * (1 - joint[..., None]) + np.array([104.0, 86.0, 80.0]) * joint[..., None]
    height = arris * 2.0 - joint * 1.6 + grain * 0.18
    rough = 0.78 + 0.04 * tone + 0.14 * joint
    _save(d, col, height, rough, 1.2)


def panel(d, n=512):
    """Cladding panels 1.2 m square, four each way to the repeat (4.8 m of wall): flat faces, a dark open
    joint 12 mm wide, the faintest brushed grain along the panel. Grey: the building's colour is its tint."""
    rng = np.random.default_rng(23)
    y, x = np.mgrid[0:n, 0:n]
    fu, fv = x * 4.0 / n, (n - 1 - y) * 4.0 / n
    pu, pv = fu - np.floor(fu), fv - np.floor(fv)
    eu = np.minimum(pu, 1 - pu) * (n / 4.0)             # texels from a vertical joint
    ev = np.minimum(pv, 1 - pv) * (n / 4.0)
    joint = np.clip(1.0 - np.minimum(eu, ev) / 0.9, 0, 1)
    fold = np.clip(np.minimum(eu, ev) / 2.5, 0, 1)
    grain = _noise(rng, n, n, 0.4)
    lum = 200.0 * (1 + 0.008 * grain) * (0.97 + 0.03 * fold)
    col = np.dstack([lum, lum, lum]) * (1 - joint[..., None]) + 60.0 * joint[..., None]
    height = fold * 1.5 - joint * 3.0
    rough = 0.42 + 0.3 * joint + 0.02 * grain
    _save(d, col, height, rough, 1.6)


SETS = {"plaza": (plaza, 1.6), "clad": (panel, 4.8)}


# ---------------------------------------------------------------- rooms behind glass

def _trace(w, h, win, eye, room, boxes=()):
    """Rays from an eye on the street through each pixel of a pane into a box room: the hit point, its surface
    and its normal. win (W, H): the pane's size in metres, its lower left corner at the origin, x along it, y up,
    z into the room. eye (x, y, d): where the viewer stands, d metres in front of the glass. room (side, above,
    below, depth): how far the room runs past the pane's jambs, above its head, below its sill, and back.
    boxes [(x0, x1, y0, y1, z0, z1)]: furniture. Returns P (h, w, 3), kind (0 back wall, 1 ceiling, 2 floor,
    3 side wall, 4+i box i), N (h, w, 3) and the distance t along the ray from the glass."""
    W, H = win
    side, above, below, depth = room
    px, py = np.meshgrid((np.arange(w) + 0.5) / w * W, (h - 0.5 - np.arange(h)) / h * H)
    O = np.dstack([px, py, np.zeros_like(px)])
    Dv = O - np.array([eye[0], eye[1], -eye[2]])
    Dv /= np.linalg.norm(Dv, axis=2, keepdims=True)
    best = np.full((h, w), 1e9)
    kind = np.zeros((h, w), int)
    N = np.zeros((h, w, 3))

    def plane(axis, value, k, n):
        nonlocal best, kind
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (value - O[..., axis]) / Dv[..., axis]
        ok = (t > 1e-6) & (t < best)
        best = np.where(ok, t, best)
        kind = np.where(ok, k, kind)
        N[ok] = n
    plane(2, depth, 0, (0, 0, -1))
    plane(1, H + above, 1, (0, -1, 0))
    plane(1, -below, 2, (0, 1, 0))
    plane(0, -side, 3, (1, 0, 0))
    plane(0, W + side, 3, (-1, 0, 0))
    for i, (x0, x1, y0, y1, z0, z1) in enumerate(boxes):       # slabs
        lo, hi = np.array([x0, y0, z0]), np.array([x1, y1, z1])
        with np.errstate(divide="ignore", invalid="ignore"):
            ta, tb = (lo - O) / Dv, (hi - O) / Dv
        tn, tf = np.minimum(ta, tb), np.maximum(ta, tb)
        t0, t1 = tn.max(2), tf.min(2)
        ok = (t0 < t1) & (t0 > 1e-6) & (t0 < best)
        ax = tn.argmax(2)
        best = np.where(ok, t0, best)
        kind = np.where(ok, 4 + i, kind)
        nn = np.zeros((h, w, 3))
        for a in range(3):
            nn[..., a] = np.where(ax == a, -np.sign(Dv[..., a]), 0.0)
        N[ok] = nn[ok]
    return O + Dv * best[..., None], kind, N, best


def _lit(P, kind, N, t, win, room, lamps, colours, box_rgb=(), ambient=0.34):
    """The room's light: `lamps` [(x, z, w, d)] panels in the ceiling, bright themselves, lighting every surface
    by the cosine and the square of the distance (a handful of point samples each), a share bounced as ambient,
    and the corners a little darker where two surfaces meet. colours: back, ceiling, floor, side (0..255)."""
    W, H = win
    side, above, below, depth = room
    yc = H + above
    base = np.zeros(P.shape)
    for k, c in enumerate(colours):
        base[kind == k] = c
    for i, c in enumerate(box_rgb):
        base[kind == 4 + i] = c
    E = np.zeros(P.shape[:2])
    for (lx, lz, lw, ld) in lamps:
        L = np.array([lx, yc - 0.02, lz]) - P
        d2 = (L * L).sum(2) + 0.05
        cos_s = np.clip((L * N).sum(2) / np.sqrt(d2), 0, 1)
        cos_l = np.clip(L[..., 1] / np.sqrt(d2), 0, 1)
        E += cos_s * (0.25 + 0.75 * cos_l) / d2 * lw * ld
    E = E / (E.mean() + 1e-9) * (1 - ambient) * 0.62 + ambient
    # (the ceiling is lit by what the floor and the walls send back up: even, a little brighter round each panel)
    near = np.min([np.hypot(P[..., 0] - lx, P[..., 2] - lz) for (lx, lz, _, _) in lamps], axis=0)
    E = np.where(kind == 1, 0.66 + 0.2 * np.exp(-near / 0.7), E)
    # corners: the meeting of wall and ceiling, wall and floor, wall and wall
    edge = np.minimum.reduce([np.abs(P[..., 1] - yc) + (kind == 1) * 9, np.abs(P[..., 1] + below) + (kind == 2) * 9,
                              np.abs(P[..., 2] - depth) + (kind == 0) * 9, np.abs(P[..., 0] + side) + (kind == 3) * 9,
                              np.abs(P[..., 0] - W - side) + (kind == 3) * 9])
    E *= 0.78 + 0.22 * np.clip(edge / 0.35, 0, 1)
    img = base * E[..., None]
    on = np.zeros(P.shape[:2], bool)                      # the panels themselves
    for (lx, lz, lw, ld) in lamps:
        on |= (kind == 1) & (np.abs(P[..., 0] - lx) < lw / 2) & (np.abs(P[..., 2] - lz) < ld / 2)
    img[on] = (255, 252, 244)
    return img


def _goods(rng, P, mask, img, x0, x1, shelves, depth_y, palette, item=(0.06, 0.16), tall=(0.12, 0.26)):
    """Goods on shelf boards against a wall: each board a pale line with its shadow under it, each item a small
    upright block of its own colour, lit from above (darker toward its foot)."""
    X, Y = P[..., 0], P[..., 1]
    for sy in shelves:
        board = mask & (np.abs(Y - sy) < 0.018) & (X > x0) & (X < x1)
        img[board] = img[board] * 0.0 + np.array([214, 210, 202]) * 0.8
        under = mask & (Y < sy - 0.018) & (Y > sy - 0.07) & (X > x0) & (X < x1)
        img[under] *= 0.7
        x = x0 + 0.02
        while x < x1 - 0.05:
            wd, ht = rng.uniform(*item), rng.uniform(*tall)
            if rng.random() < 0.92:
                c = np.array(palette[int(rng.integers(len(palette)))], float) * rng.uniform(0.85, 1.05)
                m = mask & (X > x) & (X < x + wd - 0.008) & (Y > sy + 0.018) & (Y < sy + 0.018 + min(ht, depth_y - 0.05))
                k = 0.62 + 0.38 * np.clip((Y[m] - sy) / max(ht, 1e-3), 0, 1)
                img[m] = c[None, :] * k[:, None] * 0.9
            x += wd


PALE = [(238, 236, 230), (226, 222, 212), (206, 188, 150), (188, 196, 204), (212, 92, 80), (84, 122, 176), (232, 196, 92),
        (108, 160, 118), (64, 64, 70), (240, 240, 238), (222, 150, 168)]
SPINES = [(132, 60, 52), (52, 78, 112), (196, 176, 132), (232, 228, 216), (70, 96, 78), (46, 46, 52), (168, 120, 64), (214, 206, 190)]


def room(seed, lit, w=124, h=160):
    """An upstairs room through its window, seen from the street below (the eye 9 m down and 14 m out): mostly
    its ceiling and the light panels in it, the top of the back wall, a cabinet's or a shelf's head. As its light
    after dark; a dark room is the glass alone."""
    rng = np.random.default_rng(seed)
    if not lit:
        return np.full((h, w, 3), (5, 6, 8), float)
    win, rm = (1.5, 1.9), (rng.uniform(1.0, 2.6), 0.45, 0.9, rng.uniform(4.5, 8.0))
    warm = rng.random() < 0.4
    lamp = np.array((255, 232, 198) if warm else (236, 242, 252), float) / 255.0
    back = np.array(rng.choice([(226, 224, 218), (214, 208, 196), (198, 204, 210), (232, 228, 220)]), float)
    boxes, box_rgb = [], []
    for _ in range(int(rng.integers(1, 4))):                # cabinets and shelving against the back wall
        x0 = rng.uniform(-rm[0], win[0] + rm[0] - 1.0)
        boxes.append((x0, x0 + rng.uniform(0.8, 1.6), -rm[2], rng.uniform(0.9, 1.9), rm[3] - 0.45, rm[3]))
        box_rgb.append(np.array(rng.choice([(150, 152, 156), (176, 160, 136), (96, 98, 104), (206, 204, 198)]), float))
    lamps = [(x, z, 0.3, 1.2) for x in np.arange(-rm[0] + 0.6, win[0] + rm[0], 1.2) for z in np.arange(0.9, rm[3] - 0.4, 1.8)]
    P, kind, N, t = _trace(w, h, win, (0.75 + rng.uniform(-3, 3), -9.0, 14.0), rm, boxes)
    img = _lit(P, kind, N, t, win, rm, lamps, (back, (236, 236, 232), (120, 116, 108), back * 0.94), box_rgb)
    img *= lamp[None, None, :] * rng.uniform(0.72, 1.0)
    b = float(rng.choice([0.0, 0.0, 0.25, 0.5]))             # a slatted blind drawn part of the way: light through its slats
    if b:
        rows = np.arange(h)[:, None]
        slat = (rows < h * b) & (rows % 4 < 3)
        img = np.where(slat[..., None], img * 0.5 + np.array([200, 198, 190]) * 0.3 * lamp, img)
    return img


def shop(kind, w=480, h=256):
    """A shop through its glass from the pavement (the eye 1.3 m over the sill and 5 m out): a lit ceiling, the
    back wall and its trade against it, the floor running back. kind % 4: a drugstore's shelves and gondolas, a
    bookshop, a cafe's timber counter under pendant lamps, a clothes shop's rails."""
    rng = np.random.default_rng(40 + kind)
    win, rm = (5.6, 3.0), (0.6, 0.25, 0.38, (6.5, 7.5, 5.5, 6.0)[kind % 4])
    D = rm[3]
    trade = kind % 4
    wall = np.array([(238, 238, 234), (226, 214, 190), (212, 196, 170), (232, 230, 224)][trade], float)
    floor = np.array([(196, 194, 186), (150, 122, 92), (118, 92, 70), (176, 170, 160)][trade], float)
    boxes, box_rgb = [], []
    if trade == 0:                                           # gondolas running back from the glass
        for x in (1.1, 2.9, 4.7):
            boxes.append((x - 0.35, x + 0.35, -rm[2], 1.0, 1.6, D - 1.4))
            box_rgb.append(np.array((222, 220, 214), float))
    elif trade == 1:                                         # a table of books in the middle
        boxes += [(1.4, 4.2, -rm[2], 0.48, 1.8, 3.4)]
        box_rgb += [np.array((150, 112, 78), float)]
    elif trade == 2:                                         # the counter, and the back bar behind it
        boxes += [(0.4, 4.4, -rm[2], 0.72, D - 2.2, D - 1.5), (4.9, 5.9, -rm[2], 0.36, 1.2, 2.0), (2.6, 3.6, -rm[2], 0.36, 1.0, 1.8)]
        box_rgb += [np.array((124, 86, 56), float), np.array((70, 56, 46), float), np.array((70, 56, 46), float)]
    else:                                                    # a low display plinth
        boxes += [(0.6, 2.4, -rm[2], 0.1, 1.0, 2.6), (3.6, 5.2, -rm[2], 0.5, 2.4, 3.6)]
        box_rgb += [np.array((228, 226, 220), float), np.array((206, 198, 184), float)]
    nx = 4 if trade != 2 else 3
    lamps = [(x, z, 1.1, 0.3) if trade != 2 else (x, z, 0.3, 0.3) for x in np.linspace(0.6, 5.0, nx) for z in np.arange(0.9, D - 0.3, 1.6)]
    P, kind_, N, t = _trace(w, h, win, (2.8, 1.3, 5.0), rm, boxes)
    img = _lit(P, kind_, N, t, win, rm, lamps, (wall, (244, 243, 238), floor, wall * 0.96), box_rgb,
               ambient=0.3 if trade != 2 else 0.22)
    backm = kind_ == 0
    Y0 = -rm[2]
    if trade == 0:
        _goods(rng, P, backm, img, -0.5, win[0] + 0.5, [Y0 + 0.25 + 0.36 * i for i in range(6)], 0.36, PALE)
        for i in range(3):                                   # the gondolas' faces: shelves seen side on
            m = (kind_ == 4 + i) & (np.abs(N[..., 0]) > 0.5)
            Pz = np.dstack([P[..., 2], P[..., 1], P[..., 0]])
            _goods(rng, Pz, m, img, 1.6, D - 1.4, [Y0 + 0.12 + 0.3 * j for j in range(4)], 0.3, PALE, item=(0.08, 0.2), tall=(0.1, 0.2))
    elif trade == 1:
        _goods(rng, P, backm, img, -0.5, win[0] + 0.5, [Y0 + 0.2 + 0.3 * i for i in range(8)], 0.3, SPINES, item=(0.025, 0.06), tall=(0.2, 0.27))
    elif trade == 2:
        X, Y = P[..., 0], P[..., 1]
        board = backm & (Y > Y0 + 1.9) & (Y < Y0 + 2.7) & (X > 0.6) & (X < 4.2)        # the menu board over the back bar
        img[board] = np.array((34, 32, 30)) * 1.0
        for r in range(5):                                   # its lines of chalk
            ln = board & (np.abs(Y - (Y0 + 2.55 - r * 0.13)) < 0.012) & ((X * 3.1 + r * 0.7) % 1.0 < 0.74)
            img[ln] = (206, 202, 190)
        _goods(rng, P, backm & (Y < Y0 + 1.8), img, 0.6, 4.2, [Y0 + 1.05, Y0 + 1.4], 0.3, [(236, 232, 222), (190, 150, 96), (88, 64, 48), (212, 204, 188)],
               item=(0.07, 0.12), tall=(0.1, 0.22))
        img *= np.array([1.0, 0.93, 0.82])[None, None, :]     # warm lamps
    else:
        X, Y = P[..., 0], P[..., 1]
        rail = backm & (np.abs(Y - (Y0 + 1.75)) < 0.012)
        img[rail] = (150, 150, 154)
        x = -0.4
        while x < win[0] + 0.4:                              # garments on hangers: shoulders, then the cloth's fall
            wd, ln = rng.uniform(0.07, 0.12), rng.uniform(0.6, 1.15)
            c = np.array(rng.choice([(34, 36, 44), (226, 222, 212), (120, 104, 84), (70, 84, 110), (150, 60, 56), (190, 180, 160), (58, 70, 58)]), float)
            m = backm & (X > x) & (X < x + wd - 0.012) & (Y < Y0 + 1.72) & (Y > Y0 + 1.72 - ln)
            img[m] = c[None, :] * (0.55 + 0.4 * np.clip((Y[m] - (Y0 + 1.72 - ln)) / ln, 0, 1))[:, None]
            x += wd
    return img
