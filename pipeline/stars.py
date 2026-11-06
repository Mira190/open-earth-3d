"""The night sky's stars from the Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren 1991): every
star to about magnitude 6.5, the naked eye's limit under a dark sky, with its J2000 position, V magnitude and B-V
colour. Writes web/data/sky/bsc5.bin for the alpine sites' sky (web/reef/alpine/stars.js).

    python pipeline/stars.py

Source: the catalogue's fixed-width file as the Smithsonian Astrophysical Observatory's Telescope Data Center serves
it (tdc-www.harvard.edu/catalogs/bsc5.html), the same data as CDS/NASA ADC catalogue V/50. Free to use with
acknowledgement; docs/cities/lake-pukaki.md cites it.

Output, little-endian: a uint32 count, then per star five int16: the J2000 unit vector (x toward RA 0, z to the north
pole) times 32767, V magnitude times 1000, B-V times 1000.
"""
import gzip
import os
import struct
import urllib.request

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "http://tdc-www.harvard.edu/catalogs/bsc5.dat.gz"
RAW = os.path.join(ROOT, "data", "raw", "sky", "bsc5.dat.gz")
OUT = os.path.join(ROOT, "web", "data", "sky", "bsc5.bin")
UA = "open-earth-3d (https://github.com/Mira190/open-earth-3d)"


def main():
    if not os.path.exists(RAW):
        os.makedirs(os.path.dirname(RAW), exist_ok=True)
        req = urllib.request.Request(URL, headers={"User-Agent": UA})
        open(RAW, "wb").write(urllib.request.urlopen(req, timeout=120).read())
    rows = []
    for line in gzip.open(RAW, "rt", encoding="latin-1"):
        # bytes (1-based, the catalogue's ReadMe): 76-77 RAh, 78-79 RAm, 80-83 RAs, 84 DE-, 85-86 DEd, 87-88 DEm,
        # 89-90 DEs (J2000); 103-107 Vmag; 110-114 B-V
        if len(line) < 107 or not line[75:77].strip() or not line[102:107].strip():
            continue                                      # the few entries with no position (novae, removed objects)
        ra = (int(line[75:77]) + int(line[77:79]) / 60 + float(line[79:83]) / 3600) * 15
        dec = (int(line[84:86]) + int(line[86:88]) / 60 + int(line[88:90]) / 3600) * (-1 if line[83] == "-" else 1)
        v = float(line[102:107])
        bv = float(line[109:114]) if line[109:114].strip() else 0.6
        rows.append((ra, dec, v, bv))
    a = np.array(rows)
    ra, dec = np.radians(a[:, 0]), np.radians(a[:, 1])
    xyz = np.column_stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)])
    q = np.column_stack([np.round(xyz * 32767), np.round(a[:, 2] * 1000), np.round(np.clip(a[:, 3], -0.5, 2.5) * 1000)]).astype("<i2")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as f:
        f.write(struct.pack("<I", len(q)))
        f.write(q.tobytes())
    print(f"{OUT}: {len(q)} stars, V {a[:, 2].min():.2f} to {a[:, 2].max():.2f}, {os.path.getsize(OUT) / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
