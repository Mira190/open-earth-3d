"""Great Barrier Reef 30 m bathymetry (AusSeabed / Geoscience Australia, 2020) for one city.

The release is one 3.5 GB zip of four COG grids, each deflated as a single stream, so a
window cannot be read without inflating up to it. This streams the one grid that covers
the city's bbox (the zip's directory is read with HTTP range requests), inflates it to
data/raw/<id>/gbr_grid.tif, and crops it to the city bbox as data/raw/<id>/bathy.tif.

    python pipeline/fetch_gbr_bathy.py whitsundays
"""
import io
import os
import struct
import sys
import zipfile
import zlib

import requests

from cityctx import City

URL = "https://files.ausseabed.gov.au/survey/Great%20Barrier%20Reef%20Bathymetry%202020%2030m.zip"
# grid extents (lat0, lat1, lon0, lon1) from the release record; they overlap, so the
# first grid that contains the whole bbox wins
GRIDS = {"A": (-17, -10, 143, 147), "B": (-23, -16, 144, 149), "C": (-24, -18, 148, 154), "D": (-29, -23, 150, 156)}


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


def main(cid):
    c = City(cid)
    city, out = c.cfg, c.raw
    os.makedirs(out, exist_ok=True)
    grid = os.path.join(out, "gbr_grid.tif")
    if not os.path.exists(grid):
        w, s_, e, n = city["bbox"]
        letter = next(k for k, (a, b, c, d) in GRIDS.items() if a <= s_ and n <= b and c <= w and e <= d)
        rf = RangeFile(URL)
        z = zipfile.ZipFile(io.BufferedReader(rf, buffer_size=1 << 16))
        info = next(i for i in z.infolist() if f"_{letter}_" in i.filename)
        rf.seek(info.header_offset)
        h = rf.read(30)
        start = info.header_offset + 30 + struct.unpack("<HH", h[26:30])[0] + struct.unpack("<HH", h[26:30])[1]
        print("streaming", info.filename, info.compress_size, "bytes")
        d, got = zlib.decompressobj(-15), 0
        with open(grid + ".part", "wb") as f, requests.get(
                URL, headers={"Range": f"bytes={start}-{start + info.compress_size - 1}"}, stream=True, timeout=120) as r:
            r.raise_for_status()
            for chunk in r.iter_content(1 << 20):
                f.write(d.decompress(chunk))
                got += len(chunk)
            f.write(d.flush())
        os.replace(grid + ".part", grid)
    import rasterio
    from rasterio.windows import from_bounds
    w, s, e, n = city["bbox"]
    with rasterio.open(grid) as src:
        win = from_bounds(w, s, e, n, src.transform)
        arr = src.read(1, window=win)
        prof = src.profile
        prof.update(driver="GTiff", height=arr.shape[0], width=arr.shape[1],
                    transform=src.window_transform(win), compress="deflate", tiled=False)
        prof.pop("blockxsize", None); prof.pop("blockysize", None)
    with rasterio.open(os.path.join(out, "bathy.tif"), "w", **prof) as dst:
        dst.write(arr, 1)
    print("bathy.tif", arr.shape, float(arr.min()), float(arr.max()))


if __name__ == "__main__":
    main(sys.argv[1])
