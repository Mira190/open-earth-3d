"""Great Barrier Reef 30 m bathymetry (AusSeabed / Geoscience Australia, 2020) for one city.

The release is one 3.8 GB zip of four COG grids (A-D), each deflated as a single stream, so a
window cannot be read without inflating up to it. The grids are compressed inside as well, so
each inflates to about its zipped size (0.8-1.1 GB). This downloads the one grid that covers
the city's bbox (the zip's directory is read with HTTP range requests; the download resumes
after a dropped connection), inflates it once to a cache shared by every site on that grid,
data/raw/_gbr/<letter>.tif, and crops it to the city bbox as data/raw/<id>/bathy.tif (tagged
with the grid letter).

    python pipeline/fetch_gbr_bathy.py whitsundays [--grid C]

GRIDS are the georeferencing of the COGs themselves (read from each file's TIFF header, not
from the release record, whose grid A starts a degree too far east). Neighbouring grids
overlap; the first grid that contains the whole bbox with a margin wins, and a crop that is
mostly no-data stops the run rather than shipping a hole.
"""
import argparse
import io
import os
import struct
import zipfile
import zlib

import numpy as np
import requests

from cityctx import ROOT, City

URL = "https://files.ausseabed.gov.au/survey/Great%20Barrier%20Reef%20Bathymetry%202020%2030m.zip"
# (lat0, lat1, lon0, lon1) of each COG, from its GeoTIFF header (0.0003 deg pixels, EPSG:4326)
GRIDS = {"A": (-17.0, -10.0, 142.0, 147.0), "B": (-23.0, -16.0, 144.0, 149.0),
         "C": (-24.0, -18.0, 148.0, 154.0), "D": (-29.0, -23.0, 150.0, 156.0)}
CACHE = os.path.join(ROOT, "data", "raw", "_gbr")


class RangeFile(io.RawIOBase):
    def __init__(self, url):
        self.url, self.pos = url, 0
        self.size = int(requests.head(url, allow_redirects=True, timeout=60).headers["content-length"])

    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def readinto(self, b):
        r = requests.get(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + len(b) - 1}"}, timeout=120)
        r.raise_for_status()
        b[:len(r.content)] = r.content
        self.pos += len(r.content)
        return len(r.content)


def pick(bbox, margin=0.01):
    """The first grid that holds the bbox with `margin` degrees to spare (grid edges can be no-data)."""
    w, s, e, n = bbox
    for k, (a, b, c, d) in GRIDS.items():
        if a + margin <= s and n <= b - margin and c + margin <= w and e <= d - margin:
            return k
    raise SystemExit(f"no GBR grid contains bbox {bbox}; grids: {GRIDS}")


def fetch_grid(letter):
    """Download grid `letter`'s deflate stream (resumable), inflate it to the shared cache."""
    os.makedirs(CACHE, exist_ok=True)
    tif = os.path.join(CACHE, f"{letter}.tif")
    if os.path.exists(tif):
        return tif
    rf = RangeFile(URL)
    z = zipfile.ZipFile(io.BufferedReader(rf, buffer_size=1 << 16))
    info = next(i for i in z.infolist() if f"_{letter}_" in i.filename)
    rf.seek(info.header_offset)
    h = rf.read(30)
    n_name, n_extra = struct.unpack("<HH", h[26:30])
    start = info.header_offset + 30 + n_name + n_extra
    raw = os.path.join(CACHE, f"{letter}.deflate")
    print("downloading", info.filename, info.compress_size, "bytes", flush=True)
    for attempt in range(30):
        have = os.path.getsize(raw) if os.path.exists(raw) else 0
        if have >= info.compress_size:
            break
        try:
            with open(raw, "ab") as f, requests.get(URL, stream=True, timeout=120, headers={
                    "Range": f"bytes={start + have}-{start + info.compress_size - 1}"}) as r:
                r.raise_for_status()
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        except (requests.RequestException, OSError) as e:
            print(f"  resume after {e.__class__.__name__} at {have} bytes", flush=True)
    d = zlib.decompressobj(-15)
    with open(raw, "rb") as fi, open(tif + ".part", "wb") as fo:
        while chunk := fi.read(1 << 24):
            fo.write(d.decompress(chunk))
        fo.write(d.flush())
    if os.path.getsize(tif + ".part") != info.file_size:
        raise SystemExit(f"inflated {os.path.getsize(tif + '.part')} bytes, expected {info.file_size}")
    os.replace(tif + ".part", tif)
    os.remove(raw)
    return tif


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("city")
    ap.add_argument("--grid", choices=sorted(GRIDS), help="force a grid letter")
    a = ap.parse_args()
    c = City(a.city)
    os.makedirs(c.raw, exist_ok=True)
    w, s, e, n = c.cfg["bbox"]
    legacy = os.path.join(c.raw, "gbr_grid.tif")  # older runs inflated the grid per city
    letter = a.grid or pick(c.cfg["bbox"])
    grid = legacy if os.path.exists(legacy) and not a.grid else fetch_grid(letter)
    import rasterio
    from rasterio.windows import from_bounds
    with rasterio.open(grid) as src:
        win = from_bounds(w, s, e, n, src.transform)
        arr = src.read(1, window=win)
        prof = src.profile
        prof.update(driver="GTiff", height=arr.shape[0], width=arr.shape[1],
                    transform=src.window_transform(win), compress="deflate", tiled=False)
        prof.pop("blockxsize", None); prof.pop("blockysize", None)
        nodata = src.nodata
    hole = float(np.mean(arr == nodata)) if nodata is not None else 0.0
    if hole > 0.02:
        raise SystemExit(f"grid {letter}: {hole:.1%} of the bbox is no-data; try another --grid")
    with rasterio.open(os.path.join(c.raw, "bathy.tif"), "w", **prof) as dst:
        dst.write(arr, 1)
        dst.update_tags(GBR_GRID=letter, SOURCE=URL)
    print("bathy.tif grid", letter, arr.shape, float(arr.min()), float(arr.max()), "no-data share", round(hole, 4))


if __name__ == "__main__":
    main()
