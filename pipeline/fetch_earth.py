"""The title screen's Earth and sky: NASA's imagery of the whole planet, baked into
web textures, and the bright stars where they really are.

- Day: Blue Marble Next Generation (NASA Earth Observatory, public domain), one
  cloud-free composite for each month of 2004 with its snow and its vegetation,
  topography and bathymetry shaded in. The globe shows the month it is.
- Night: Black Marble 2016 (NASA Earth Observatory, public domain), the Earth's
  lights seen by Suomi NPP's VIIRS day/night band, cloud-free.
- Clouds: Blue Marble's cloud composite (public domain).
- Relief: GEBCO_08 elevation as Blue Marble ships it (public domain), for the
  light raking across the mountains near the terminator.
- Water: Natural Earth land and lakes (public domain), from web/data/world.json.
- Sky: the Milky Way panorama by ESO/S. Brunier (CC BY 4.0), in galactic
  coordinates, and the Yale Bright Star Catalogue (5th edition, 9,110 stars to
  magnitude 6.5).

    python pipeline/fetch_earth.py      # -> web/assets/earth/

Writes day-01.jpg .. day-12.jpg (RGB), surface.jpg (R: night lights, G: water,
B: relief), lights.jpg (the lights at 8192 x 4096), clouds.jpg (grey), milkyway.jpg
(RGB, galactic) and stars.json.
"""
import json
import math
import os
import struct

import numpy as np
import requests
from PIL import Image, ImageDraw, ImageFilter

from cityctx import ROOT

Image.MAX_IMAGE_PIXELS = None
RAW = os.path.join(ROOT, "data", "raw", "earth")
OUT = os.path.join(ROOT, "web", "assets", "earth")
W, H = 4096, 2048
EO = "https://eoimages.gsfc.nasa.gov/images/imagerecords/"
# Blue Marble Next Generation with topography and bathymetry, one record per month of 2004
MONTHS = [73580, 73605, 73630, 73655, 73701, 73726, 73751, 73776, 73801, 73826, 73884, 73909]
SOURCES = {
    "night": EO + "144000/144898/BlackMarble_2016_3km.jpg",
    "clouds": EO + "57000/57747/cloud_combined_8192.tif",
    "relief": EO + "73000/73934/gebco_08_rev_elev_21600x10800.png",
    "milkyway": "https://cdn.eso.org/images/large/eso0932a.jpg",
    "stars": "http://tdc-www.harvard.edu/catalogs/BSC5",
}


def fetch(url, name=None):
    path = os.path.join(RAW, name or url.rsplit("/", 1)[-1])
    if not os.path.exists(path):
        print(f"downloading {url}")
        with requests.get(url, stream=True, timeout=600) as r:
            r.raise_for_status()
            with open(path + ".part", "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        os.replace(path + ".part", path)
    return path


def save(img, name, quality=86):
    path = os.path.join(OUT, name)
    extra = {"subsampling": 0} if img.mode == "RGB" else {}  # full-resolution colour: the channels of surface.jpg are separate maps
    img.save(path, quality=quality, optimize=True, progressive=True, **extra)
    print(f"{name}: {img.size[0]}x{img.size[1]}, {os.path.getsize(path) / 1e6:.2f} MB")


def day():
    for m, rec in enumerate(MONTHS, 1):
        src = fetch(f"{EO}{rec // 1000 * 1000}/{rec}/world.topo.bathy.2004{m:02d}.3x5400x2700.jpg")
        save(Image.open(src).convert("RGB").resize((W, H), Image.LANCZOS), f"day-{m:02d}.jpg", 84)


def water():
    """Natural Earth's oceans and lakes as a mask, drawn at twice the size and averaged down."""
    world = json.load(open(os.path.join(ROOT, "web", "data", "world.json")))
    q, S = world["q"], 2
    img = Image.new("L", (W * S, H * S), 255)
    d = ImageDraw.Draw(img)
    px = lambda flat: [((flat[k] * q + 180) / 360 * W * S, (90 - flat[k + 1] * q) / 180 * H * S) for k in range(0, len(flat), 2)]
    for poly in world["land"]:
        d.polygon(px(poly[0]), fill=0)
        for hole in poly[1:]:
            d.polygon(px(hole), fill=255)
    for poly in world["lakes"]:
        d.polygon(px(poly[0]), fill=255)
        for isle in poly[1:]:
            d.polygon(px(isle), fill=0)
    return img.resize((W, H), Image.BOX)


def night(w=W):
    """The lights alone: Black Marble's land is moonlit and blue (red about half its blue), its
    lights are warm and their cores white, so the lights are the red above half the blue."""
    a = np.asarray(Image.open(fetch(SOURCES["night"])).convert("RGB").resize((w, w // 2), Image.LANCZOS), dtype=np.float32) / 255
    lights = np.clip((a[..., 0] - 0.55 * a[..., 2]) / 0.5 - 0.03, 0, 1) ** 0.9
    return Image.fromarray((lights * 255 + 0.5).astype(np.uint8))


def lights():
    """The lights again at twice the size (5 km a pixel from Black Marble's 3 km), for the low
    pass over the night side on large screens."""
    save(night(2 * W), "lights.jpg", 88)


def relief():
    """GEBCO_08 land elevation as Blue Marble ships it (0 at sea level and over the oceans,
    brighter higher), on a square-root scale so lowland relief still reads."""
    a = np.asarray(Image.open(fetch(SOURCES["relief"])).convert("L").resize((W, H), Image.LANCZOS), dtype=np.float32) / 255
    return Image.fromarray((np.sqrt(a) * 255 + 0.5).astype(np.uint8))


def surface():
    r, g, b = night(), water(), relief()
    save(Image.merge("RGB", (r, g, b)), "surface.jpg", 92)


def clouds():
    img = Image.open(fetch(SOURCES["clouds"])).convert("L").resize((W, H), Image.LANCZOS)
    save(img, "clouds.jpg", 80)


def milkyway():
    """The Milky Way's glow and dust without its stars: an opening (a minimum then a maximum
    filter) takes out the points, which the catalogue draws sharp instead."""
    img = Image.open(fetch(SOURCES["milkyway"])).convert("RGB").resize((W, H), Image.LANCZOS)
    img = img.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5)).resize((W // 2, H // 2), Image.LANCZOS)
    save(img, "milkyway.jpg", 84)


def stars():
    """The Yale Bright Star Catalogue (BSC5, J2000) as [RA, Dec, magnitude, colour] rows:
    RA and Dec in hundredths of a degree, V magnitude in hundredths, and the spectral class
    as an index into OBAFGKM (the colour of the star)."""
    buf = open(fetch(SOURCES["stars"], "BSC5"), "rb").read()
    star0, star1, starn, stnum, mprop, nmag, nbent = struct.unpack("<7i", buf[:28])
    n, rows = abs(starn), []
    for i in range(n):
        xno, ra, dec, sp, mag, pmra, pmdec = struct.unpack("<fdd2shff", buf[28 + i * nbent: 28 + (i + 1) * nbent])
        if mag == 0 and ra == 0:
            continue  # the catalogue's few non-stellar entries
        cls = "OBAFGKM".find(chr(sp[0]).upper())
        rows += [round(math.degrees(ra) * 100), round(math.degrees(dec) * 100), mag, max(cls, 0)]
    doc = {"source": "Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren 1991), J2000",
           "fields": ["ra_cdeg", "dec_cdeg", "vmag_x100", "class_OBAFGKM"], "stars": rows}
    path = os.path.join(OUT, "stars.json")
    json.dump(doc, open(path, "w"), separators=(",", ":"))
    print(f"stars.json: {len(rows) // 4} stars, {os.path.getsize(path) / 1e3:.0f} kB")


def main():
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    stars()
    clouds()
    surface()
    lights()
    milkyway()
    day()


if __name__ == "__main__":
    main()
