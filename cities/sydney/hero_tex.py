"""The surfaces of Circular Quay West that no scanned texture had, drawn here (cities/sydney/hero.py registers
them with blender/hero_kit.py): each a colour, a normal and a roughness image that repeat without a seam.

  herring     the promenade's unit pavers, 200 x 100 mm in a herringbone, buff-grey in close tones of one family
              (photographs: docs/HERO.md); 1.6 m to a repeat, so a texel is 1.6 mm, a pixel's width on the
              ground two metres from a walker's eye at 1440 px
  header      the same pavers as a soldier course: the darker bands across the promenade
  sandstone   Maroubra sandstone as the museum is faced with it: sawn ashlar in 380 mm courses, the joints a
              hairline, each block its own tone with the bed's faint banding; 3.04 m to a repeat
  seawall     the quay's concrete face: board marks, pour lines, wet below high water; 8 m along by 4 m
  concrete    precast concrete, even: the Mordant Wing's panels, the seat wall, the kerb

Every change of tone has a cause in how the thing is made (a paver, a course, a joint, a pour, the tide): nothing
is aged, stained or clouded (AGENTS.md, "The bar").

Nothing here is taken from a photograph: every image is noise, shaped.
"""
import os

import numpy as np


def _noise(rng, h, w, beta=1.6, aniso=(1.0, 1.0)):
    """Periodic noise with a power-law spectrum (1/f^beta), stretched by aniso (y, x); zero mean, unit deviation."""
    f = np.fft.fft2(rng.normal(size=(h, w)))
    fy, fx = np.meshgrid(np.fft.fftfreq(h) * h * aniso[0], np.fft.fftfreq(w) * w * aniso[1], indexing="ij")
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


def _hash(*ids):
    """A value in 0..1 per integer id tuple (arrays)."""
    h = np.zeros_like(ids[0], dtype=np.uint64)
    for k, a in enumerate(ids):
        h = (h * np.uint64(1000003)) ^ (a.astype(np.int64).astype(np.uint64) * np.uint64(2654435761 + 97 * k))
        h ^= h >> np.uint64(15)
    h = (h * np.uint64(2246822519)) & np.uint64(0xFFFFFFFF)
    return (h ^ (h >> np.uint64(13))).astype(np.float64) % 9973 / 9973.0


def _pavers(d, n, cells, brick, seed):
    """Unit pavers on a grid of `cells` half-bricks a side. brick(i, j) -> (id_i, id_j, u0, u1, v0, v1): the
    paver a cell belongs to and the cell's place in it (in cells)."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n]
    fx, fy = x * cells / n, (n - 1 - y) * cells / n
    i, j = np.floor(fx).astype(int), np.floor(fy).astype(int)
    bi, bj, du, dv, lu, lv = brick(i, j)
    u, v = fx - i + du, fy - j + dv                      # place in the paver, in cells
    edge = np.minimum(np.minimum(u, lu - u), np.minimum(v, lv - v)) * (n / cells)     # texels from the paver's edge
    joint = np.clip(1.0 - edge / 1.6, 0, 1)             # the sanded joint, about 3 mm
    chamfer = np.clip(edge / 4.5, 0, 1)                  # the arris, about 7 mm
    idm = (np.mod(bi, cells), np.mod(bj, cells))
    tone = _hash(*idm)
    hue = _hash(idm[1], idm[0] + 7)
    base = np.array([138.0, 130.0, 119.0])
    col = base[None, None, :] * (0.965 + 0.07 * tone)[..., None]      # each paver its own fired tone, close: one family
    grain = _noise(rng, n, n, 0.6)                        # the aggregate
    col *= (1 + 0.04 * grain)[..., None]
    col *= (0.94 + 0.06 * chamfer)[..., None]
    col = col * (1 - joint[..., None]) + np.array([92.0, 86.0, 77.0]) * joint[..., None] * (1 + 0.1 * grain[..., None])
    height = chamfer * 2.2 - joint * 2.0 + grain * 0.22 + (tone - 0.5) * 0.5
    rough = 0.74 + 0.06 * tone + 0.2 * joint
    _save(d, col, height, rough, 1.3)


def herring(d, n=1024):
    def brick(i, j):
        k = np.mod(i - j, 4)
        bi = np.where(k == 1, i - 1, i)
        bj = np.where(k == 2, j - 1, j)
        horiz = k < 2
        du = np.where(k == 1, 1.0, 0.0)
        dv = np.where(k == 2, 1.0, 0.0)
        return bi * 2 + horiz, bj, du, dv, np.where(horiz, 2.0, 1.0), np.where(horiz, 1.0, 2.0)
    _pavers(d, n, 16, brick, 5)


def header(d, n=512):
    """Soldier course: pavers 100 mm along u, 200 mm across (two rows to the repeat's 0.8 m by 0.8 m: 8 cells)."""
    def brick(i, j):
        return i, j // 2, np.zeros(i.shape), np.where(np.mod(j, 2) == 1, 1.0, 0.0), np.ones(i.shape), np.full(i.shape, 2.0)
    _pavers(d, n, 8, brick, 6)
    from PIL import Image
    p = os.path.join(d, "Color.png")           # darker: a charcoal paver
    a = np.asarray(Image.open(p), float)
    Image.fromarray(np.clip(a * np.array([0.52, 0.52, 0.55]), 0, 255).astype(np.uint8), "RGB").save(p)


def _ashlar(rng, h, w, courses, mean_len):
    """Block ids and distance to the joints for coursed ashlar with broken bond; periodic."""
    ch = h / courses
    y, x = np.mgrid[0:h, 0:w]
    c = np.minimum((y / ch).astype(int), courses - 1)
    bid = np.zeros((h, w), int)
    edge = np.full((h, w), 1e9)
    for k in range(courses):
        nb = max(2, int(round(w / mean_len + rng.integers(-1, 2))))
        cuts = np.sort((np.arange(nb) + rng.uniform(0.2, 0.8, nb)) * w / nb + rng.uniform(0, w))
        rows = c == k
        xr = x[rows]
        cs = np.sort(np.mod(cuts, w))
        idx = np.searchsorted(cs, xr)
        left = np.where(idx == 0, cs[-1] - w, cs[np.maximum(idx - 1, 0)])
        right = np.where(idx == len(cs), cs[0] + w, cs[np.minimum(idx, len(cs) - 1)])
        bid[rows] = k * 64 + np.mod(idx, len(cs))
        yy = y[rows] - k * ch
        edge[rows] = np.minimum(np.minimum(xr - left, right - xr), np.minimum(yy, ch - yy))
    return bid, edge


def _sandstone(rng, h, w, courses, mean_len):
    bid, edge = _ashlar(rng, h, w, courses, mean_len)
    tone = _hash(bid, bid * 0 + 3)
    warm = _hash(bid, bid * 0 + 11)
    base = np.array([196.0, 158.0, 116.0])
    col = base[None, None, :] * (0.975 + 0.05 * tone)[..., None]
    col[..., 0] *= 1 + 0.03 * (warm - 0.5)
    col[..., 2] *= 1 - 0.06 * (warm - 0.5)
    bed = _noise(rng, h, w, 1.5, aniso=(1.0, 0.12))       # the bed's banding, along the course
    pit = _noise(rng, h, w, 0.4)
    col *= (1 + 0.04 * bed + 0.02 * pit)[..., None]
    joint = np.clip(1.0 - edge / 1.1, 0, 1)
    col = col * (1 - 0.3 * joint[..., None])
    height = -joint * 1.4 + pit * 0.18 + bed * 0.12
    rough = 0.86 + 0.05 * tone + 0.06 * joint
    return col, height, rough


def sandstone(d, n=1024):
    col, height, rough = _sandstone(np.random.default_rng(21), n, n, 8, n / 2.6)
    _save(d, col, height, rough, 1.0)


def seawall(d, w=1024, h=512):
    """Cast concrete, 8 m by 4 m, laid once from the kerb down: the boards' grain and the pour lines a metre apart,
    and below high water the wall wet and darker, as a tidal wall is. Clean: no runs, no weed."""
    rng = np.random.default_rng(23)
    y = np.linspace(0, 1, h)[:, None]                     # 0 at the kerb, 1 under the water
    boards = _noise(rng, h, w, 1.2, aniso=(1.0, 0.05))
    pit = _noise(rng, h, w, 0.3)
    g = 150 + 5 * boards + 3 * pit
    col = np.dstack([g * 1.0, g * 0.985, g * 0.95])
    lifts = np.clip(1 - np.abs(((y * 4.0) % 1.0) - 0.5) * h / 4.0 / 1.5, 0, 1) * np.ones((1, w))     # pour joints, a metre apart
    col *= (1 - 0.22 * lifts)[..., None]
    tide = np.clip((y - 0.55) / 0.03, 0, 1) * np.ones((1, w))        # wet below high water
    col = col * (1 - 0.42 * tide[..., None])
    height = boards * 0.5 + pit * 0.3 - lifts * 1.2
    rough = 0.82 - 0.45 * tide
    _save(d, col, height, rough, 1.0)


def concrete(d, n=512):
    """Precast concrete, off-form: a faint cloud and pinholes. Near white, so that its tint is its colour."""
    rng = np.random.default_rng(24)
    pit = _noise(rng, n, n, 0.3)
    g = 232 + 2.0 * pit - 10 * (pit > 2.8)
    _save(d, np.dstack([g, g, g * 0.995]), pit * 0.12 - 1.0 * (pit > 2.8), np.full((n, n), 0.62), 1.0)


SETS = {
    "syd_herring": (herring, 1.6),
    "syd_header": (header, 0.8),
    "syd_sandstone": (sandstone, 3.04),
    "syd_seawall": (seawall, 8.0),
    "syd_concrete": (concrete, 2.4),
}

if __name__ == "__main__":      # python cities/sydney/hero_tex.py out_dir: the images, to look at
    import sys
    for key, (make, _) in SETS.items():
        make(os.path.join(sys.argv[1], key))
