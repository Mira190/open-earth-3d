"""Read single files out of a huge remote zip with HTTP range requests, so a
city's few mesh files come down instead of the whole country's archive.

    z = zipfile.ZipFile(RangeFile(url))
    data = z.read(name)

Reads go through a block cache (a zip reader asks for a few KB at a time).
"""
import io
import time

import requests

BLOCK = 4 << 20


class RangeFile(io.RawIOBase):
    def __init__(self, url):
        self.url, self.pos, self.blocks = url, 0, {}
        r = requests.head(url, allow_redirects=True, timeout=60)
        r.raise_for_status()
        self.size = int(r.headers["content-length"])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = {0: offset, 1: self.pos + offset, 2: self.size + offset}[whence]
        return self.pos

    def _block(self, i):
        if i not in self.blocks:
            if len(self.blocks) > 8:
                self.blocks.pop(next(iter(self.blocks)))
            a, b = i * BLOCK, min((i + 1) * BLOCK, self.size) - 1
            for attempt in range(5):
                try:
                    r = requests.get(self.url, headers={"Range": f"bytes={a}-{b}"}, timeout=180)
                    if r.status_code == 206:
                        self.blocks[i] = r.content
                        break
                except requests.RequestException:
                    pass
                time.sleep(2 ** attempt)
            else:
                raise IOError(f"range request failed: {self.url} {a}-{b}")
        return self.blocks[i]

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        end, out = min(self.pos + n, self.size), []
        while self.pos < end:
            i = self.pos // BLOCK
            blk = self._block(i)
            lo = self.pos - i * BLOCK
            take = blk[lo:lo + (end - self.pos)]
            out.append(take)
            self.pos += len(take)
        return b"".join(out)

    def readinto(self, b):
        d = self.read(len(b))
        b[:len(d)] = d
        return len(d)
