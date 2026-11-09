"""Pack a city's JSON files into the compact binary form the browser loads (issues 148, 201, 259):
buildings.json into buildings.bin, and landmarks.json, game.json, terrain.json, places.json and
scene.json into landmarks.bin, game.bin, terrain.bin, places.bin and scene.bin.

    python pipeline/pack.py                 # every pack that is missing or stale
    python pipeline/pack.py shibuya osaka   # these cities' (packed again even when up to date)
    python pipeline/pack.py --check         # exit 1 if any pack is missing or stale

It also keeps each live city's vis.bin (the occluder raster of pipeline/visibility.py, which the page's
visibility sweep reads) in step with its buildings.json: made when missing or stale, and checked by --check.

buildings.bin is made for every city; the others for the live cities (cities/index.json
less "parked") and for any city that already has one. The JSON stays the pipeline's source: every step
reads and writes it. Each pack is derived from it and decodes (web/pack.js) to the very same object, so
nothing downstream changes, except that
  - the roof meshes' base64 strings (buildings.json "r" columns 6 and 7) arrive as bytes (Uint8Array), and
    a roof triangle may start at another of its corners (meshoptimizer's index codec; wound the same way);
  - the landmark meshes' vertex lists (landmarks.json meshes[].position, .index, .uv) arrive as typed
    arrays (Float64Array or Int32Array) that a Worker hands over without copying (web/pack-worker.js);
  - the terrain grids (terrain.json "data"; game.json terrain, patches and upper "data", base64 int16)
    and the game's water mask (game.json water "bits") arrive as their bytes (Uint8Array).

The format is a generic, lossless columnar encoding of a JSON tree, gzip-wrapped (the browser inflates
it with DecompressionStream; GitHub Pages does not gzip unknown binary types):

    gzip( "OEPK" | u32 header length | header JSON (utf8) | pad to 8 | blob )

The header maps each top-level key to a column descriptor: {"j": value} for small values kept as JSON,
else a column in the blob. A column of N values is one of
    {"t": "i", "n", "o", "w", "d", "z"}   integers: width w bytes (1, 2, 4), delta with stride d (0: none),
                                           zigzag when delta-coded, byte planes shuffled when z, at offset o
    {"t": "q", "k", "c": int column}      decimals with at most k places: value * 10^k as integers
    {"t": "f", "n", "o"}                  float64
    {"t": "s", "tab": [...], "c": int}    strings: a table of the distinct ones and an index column
    {"t": "b", "len": int col, "o", "n"}  base64 strings as their bytes (decoded to Uint8Array), or with
                                           "e" (element type, "<i2") and "c" (int column) the elements, or
                                           with "m" the roof meshes through meshoptimizer's codecs (issue 335):
                                           "v" the vertices, "i" the triangles ("vl": the vertices' "len"),
                                           "n" elements in "nb" bytes at "o" (Writer.meshopt_column)
    {"t": "p", "tab", "c", "v": int cols}  ids like "w310627517": a table of prefixes, an index, the numbers
                                           (-1: none)
    {"t": "x", "c": int col, "p"?: int col} "#rrggbb" colours as integers, or (p) a palette and indices
    {"t": "l", "len": int col, "c": col}  lists of one scalar type, flattened
    {"t": "r", "len": int col, "c": [col for each position]}   rows (lists of mixed types), by position
    {"t": "d", "n", "k": {key: {"has": int col (absent: every row has it), "c": col}}}
                                          a list of objects, by key: each key's values in the rows that have it
    {"t": "one", "c": col}                a single value (a long base64 string) as a column of one
    {"t": "j", "v": [...]}                anything else, as JSON
A top-level value is {"j": value} when small, else a column, or {"t": "o", "k": {key: descriptor}} for an
object, each of its values described in the same way.
Every pack is decoded again here and compared with the source before it is written.
"""
import base64
import gzip
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import zlib

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "web", "data")
BYTES = {"buildings.json": {("r", 6): "<i2", ("r", 7): None},  # base64 columns shipped as bytes: (table, position): element type
         # (and in game.json the height grids and the water mask)
         "game.json": {("terrain", "data"): "<i2", ("patches", "data"): "<i2", ("upper", "data"): "<i2", ("water", "bits"): None},
         "terrain.json": {("data",): "<i2"}}
# bytes columns that arrive as bytes (Uint8Array) in a deep pack; the others decode back to base64 text ("s64")
RAW = {"terrain.json": {("data",)},
       "game.json": {("terrain", "data"), ("patches", "data"), ("upper", "data"), ("water", "bits")}}
# numeric lists decoded as typed arrays (list columns flagged "ta"): (list, key) in a list of objects
# bytes columns sent through meshoptimizer's codecs (issue 335): (table, position): the roof vertices
# (int16 x, y, z, padded to four for the codec) and their triangles (indices into the vertices of the row's
# column "vertex", uint8 below 256 vertices else uint16), encoded across all the rows at once
MESHOPT = {"buildings.json": {("r", 6): "vertex", ("r", 7): "index"}}
# string columns that may go as numbers (issue 335): ids like "w310627517" as a prefix and an integer,
# "#rrggbb" colours as 24-bit integers (or a palette of them and an index, whichever is smaller)
FINE_STRINGS = {"buildings.json"}
TYPED = {"landmarks.json": {("meshes", "position"), ("meshes", "index"), ("meshes", "uv")}}
NAMES = ("buildings.json", "landmarks.json", "game.json", "terrain.json", "places.json", "scene.json")
SMALL = 4096  # a value whose JSON is shorter than this stays JSON
MAGIC = b"OEPK"
ID = re.compile(r"^([^0-9]*)([1-9][0-9]{0,9}|0|)$")  # a prefix and a number (int32: checked), or none
HEX = re.compile(r"^#[0-9a-f]{6}$")
MJS = os.path.join(ROOT, "pipeline", "meshopt_pack.mjs")


def meshopt(mode, data, count, stride=4):
    """meshoptimizer's codecs (pipeline/meshopt_pack.mjs, Node)."""
    return subprocess.run(["node", MJS, mode, str(count), str(stride)], input=data, stdout=subprocess.PIPE, check=True).stdout


def _is_int(v):
    return type(v) is int


def _is_num(v):
    return type(v) in (int, float)


def _places(v):
    """The fewest decimal places (up to 6) that give v back exactly, or None."""
    if type(v) is int:
        return 0
    for k in range(7):
        s = 10 ** k
        if round(v * s) / s == v and abs(v * s) < 2 ** 31:
            return k
    return None


class Writer:
    def __init__(self):
        self.parts, self.size = [], 0

    def put(self, b):
        pad = (-self.size) % 8
        if pad:
            self.parts.append(b"\0" * pad)
            self.size += pad
        off = self.size
        self.parts.append(b)
        self.size += len(b)
        return off

    def ints(self, vals):
        a = np.asarray(vals, dtype=np.int64)
        best = None
        for d in (0, 1, 2, 3):
            if d and len(a) <= d:
                continue
            if d:
                x = a.copy()
                x[d:] = a[d:] - a[:-d]
                x = np.where(x >= 0, 2 * x, -2 * x - 1)  # zigzag: small magnitudes either way stay small
            else:
                x = a
            lo, hi = (int(x.min()), int(x.max())) if len(x) else (0, 0)
            for w, t in ((1, np.int8 if lo < 0 else np.uint8), (2, np.int16 if lo < 0 else np.uint16), (4, np.uint32 if d else np.int32)):  # the browser reads 32-bit words as int32 (zigzag: mod 2^32)
                info = np.iinfo(t)
                if info.min <= lo and hi <= info.max:
                    break
            else:
                continue  # out of 32-bit range this way
            raw = x.astype(t).tobytes()
            for z in ((0, 1) if w > 1 else (0,)):
                b = np.frombuffer(raw, np.uint8).reshape(-1, w).T.tobytes() if z else raw
                cost = len(zlib.compress(b, 6))
                if best is None or cost < best[0]:
                    best = (cost, b, {"t": "i", "n": len(a), "w": w, "s": bool(t(0).dtype.kind == "i"), "d": d, "z": z})
        if best is None:
            raise ValueError("integers out of 32-bit range")
        _, b, desc = best
        desc["o"] = self.put(b)
        return desc

    def strings(self, vals):
        tab, idx = {}, []
        for v in vals:
            idx.append(tab.setdefault(v, len(tab)))
        return {"t": "s", "tab": list(tab), "c": self.ints(idx)}

    def fine_strings(self, vals):
        """The smallest of: a table of the strings and an index (as before); for ids made of a prefix and a
        number ("w310627517", "r51", ""), a table of prefixes, an index and the numbers; for "#rrggbb"
        colours, the colours as integers, or a palette of them (sorted) and an index."""
        ways = [lambda w: w.strings(vals)]
        m = [ID.match(v) for v in vals]
        if all(m) and len(vals) >= 64 and all(not x.group(2) or int(x.group(2)) < 2 ** 31 for x in m):
            def ids(w):
                tab, pre, num = {}, [], []
                for x in m:
                    pre.append(tab.setdefault(x.group(1), len(tab)))
                    num.append(int(x.group(2)) if x.group(2) else -1)
                return {"t": "p", "tab": list(tab), "c": w.ints(pre), "v": w.ints(num)}
            ways.append(ids)
        if all(HEX.match(v) for v in vals) and len(vals) >= 64:
            rgb = [int(v[1:], 16) for v in vals]
            ways.append(lambda w: {"t": "x", "c": w.ints(rgb)})
            pal = sorted(set(rgb))
            at = {c: i for i, c in enumerate(pal)}
            ways.append(lambda w: {"t": "x", "p": w.ints(pal), "c": w.ints([at[c] for c in rgb])})
        if len(ways) == 1:
            return ways[0](self)

        def cost(way):
            w = Writer()
            w.__dict__.update({k: v for k, v in self.__dict__.items() if k not in ("parts", "size")})
            d = way(w)
            return len(zlib.compress(json.dumps(d, separators=(",", ":")).encode() + b"".join(w.parts), 9))
        return min(ways, key=cost)(self)

    def meshopt_column(self, vals, path):
        """Base64 roof meshes through meshoptimizer's codecs (pipeline/meshopt_pack.mjs), all the rows as
        one buffer: the vertices (int16 x, y, z) padded to four int16, then the triangles as one list of
        uint32 indices into all the vertices. The index codec may start a triangle at another of its
        corners (the same triangle, wound the same way); nothing that draws or rasterises a roof minds."""
        raw = [base64.b64decode(v) for v in vals]
        lens = self.ints([len(r) for r in raw])
        if self.meshopt[path] == "vertex":
            q = np.frombuffer(b"".join(raw), "<i2").reshape(-1, 3)
            v4 = np.zeros((len(q), 4), "<i2")
            v4[:, :3] = q
            enc = meshopt("encode-vertex", v4.tobytes(), len(q), 8)
            self.vertex_lens = (lens, [len(r) // 6 for r in raw])
            return {"t": "b", "m": "v", "len": lens, "n": len(q), "o": self.put(enc), "nb": len(enc)}
        vlens, counts = self.vertex_lens
        idx, base = [], 0
        for r, nv in zip(raw, counts):
            idx.append(np.frombuffer(r, "u1" if nv <= 255 else "<u2").astype("<u4") + base)
            base += nv
        idx = np.concatenate(idx) if idx else np.zeros(0, "<u4")
        enc = meshopt("encode-index", idx.tobytes(), len(idx))
        return {"t": "b", "m": "i", "len": lens, "vl": vlens, "n": len(idx), "o": self.put(enc), "nb": len(enc)}

    def column(self, vals, path=()):
        """A column for these values; path (table, position) picks out the base64 columns."""
        if all(_is_int(v) for v in vals):
            return self.ints(vals)
        if all(_is_num(v) for v in vals):
            ks = [_places(v) for v in vals]
            if None not in ks:
                k = max(ks)
                return {"t": "q", "k": k, "c": self.ints([int(round(v * 10 ** k)) for v in vals])}
            return {"t": "f", "n": len(vals), "o": self.put(np.asarray(vals, dtype="<f8").tobytes())}
        if all(type(v) is str for v in vals):
            if path in self.meshopt:
                return self.meshopt_column(vals, path)
            if path in self.bytes_cols:
                raw = [base64.b64decode(v) for v in vals]
                lens, cat, dt = self.ints([len(r) for r in raw]), b"".join(raw), self.bytes_cols[path]
                s64 = {"s64": 1} if self.deep and path not in self.raw else {}  # (decoded back to base64 text: nothing that reads it changes)
                if dt:  # an array of numbers: as integers, so that they can be delta-coded and shuffled
                    return {"t": "b", "len": lens, "e": dt, "c": self.ints(np.frombuffer(cat, dt).tolist()), **s64}
                return {"t": "b", "len": lens, "o": self.put(cat), "n": len(vals), **s64}
            if self.fine:
                return self.fine_strings(vals)
            return self.strings(vals)
        if vals and all(type(v) is list for v in vals):
            flat = [x for v in vals for x in v]
            lens = self.ints([len(v) for v in vals])
            if flat and (all(_is_num(x) for x in flat) or all(type(x) is str for x in flat)):
                return {"t": "l", "len": lens, "c": self.column(flat)}
            if flat and all(_is_num(x) for x in flat) and path in self.typed:
                return {"t": "l", "len": lens, "c": self.column(flat), "ta": 1}
            width = max(len(v) for v in vals)
            if width <= 64:
                cols = [self.column([v[j] for v in vals if len(v) > j], (path[0] if path else None, j)) for j in range(width)]
                return {"t": "r", "len": lens, "c": cols}
        if self.deep and vals and all(type(v) is dict for v in vals):
            keys = {}
            for v in vals:
                for k in v:
                    keys.setdefault(k, None)
            out = {}
            for k in keys:
                has = [k in v for v in vals]
                sub = [v[k] for v in vals if k in v]
                d = {"c": self.column(sub, (path[-1] if path else None, k))}
                if not all(has):
                    d["has"] = self.ints([int(h) for h in has])
                out[k] = d
            return {"t": "d", "n": len(vals), "k": out}
        return {"t": "j", "v": vals}

    def value(self, v, path):
        """A top-level value, or one inside an object: JSON when small, else a column or an object."""
        if len(json.dumps(v, separators=(",", ":"))) < SMALL:
            return {"j": v}
        if type(v) is str and path[-2:] in self.bytes_cols:  # one base64 string: a column of one
            return {"t": "one", "c": self.column([v], path[-2:])}
        if type(v) is dict:
            return {"t": "o", "k": {k: self.value(x, path + (k,)) for k, x in v.items()}}
        if type(v) is list and len(v) >= 2:
            return self.column(v, path)
        return {"j": v}


def encode(obj, bytes_cols=(), typed=(), deep=False, raw=(), meshopt_cols=(), fine=False):
    """deep: objects and lists of objects packed by key too (landmarks.json, game.json); buildings.json
    keeps the layout of its first packs, its top-level lists as columns and the rest as JSON."""
    w = Writer()
    w.bytes_cols, w.typed, w.deep, w.raw = dict(bytes_cols), set(typed), deep, set(raw)
    w.meshopt, w.fine = dict(meshopt_cols), fine
    keys = {}
    for k, v in obj.items():
        if deep:
            keys[k] = w.value(v, (k,))
        elif type(v) is list and len(v) >= 64:
            keys[k] = w.column(v, (k,))
        else:
            keys[k] = {"j": v}
    return w, keys


# --- decoding (the same as web/pack.js), to prove each pack before it is written


def _dec_ints(d, blob):
    n, w, o = d["n"], d["w"], d["o"]
    raw = blob[o:o + n * w]
    if d["z"]:
        raw = np.frombuffer(raw, np.uint8).reshape(w, n).T.tobytes()
    t = {1: "i1" if d["s"] else "u1", 2: "<i2" if d["s"] else "<u2", 4: "<i4" if d["s"] else "<u4"}[w]
    x = np.frombuffer(raw, t).astype(np.int64)
    if d["d"]:
        x = np.where(x & 1, -((x + 1) >> 1), x >> 1)
        for s in range(d["d"]):
            x[s::d["d"]] = np.cumsum(x[s::d["d"]])
    return x.tolist()


def _dec(d, blob):
    t = d["t"]
    if t == "i":
        return _dec_ints(d, blob)
    if t == "q":
        s = 10 ** d["k"]
        return [v / s if s > 1 else v for v in _dec_ints(d["c"], blob)]
    if t == "f":
        return np.frombuffer(blob[d["o"]:d["o"] + 8 * d["n"]], "<f8").tolist()
    if t == "s":
        return [d["tab"][i] for i in _dec_ints(d["c"], blob)]
    if t == "p":
        return [d["tab"][p] + (str(v) if v >= 0 else "") for p, v in zip(_dec_ints(d["c"], blob), _dec_ints(d["v"], blob))]
    if t == "x":
        c = _dec_ints(d["c"], blob)
        if "p" in d:
            pal = _dec_ints(d["p"], blob)
            c = [pal[i] for i in c]
        return ["#%06x" % v for v in c]
    if t == "b" and "m" in d:
        enc = blob[d["o"]:d["o"] + d["nb"]]
        lens = _dec_ints(d["len"], blob)
        if d["m"] == "v":
            cat = np.frombuffer(meshopt("decode-vertex", enc, d["n"], 8), "<i2").reshape(-1, 4)[:, :3].tobytes()
        else:
            idx = np.frombuffer(meshopt("decode-index", enc, d["n"]), "<u4")
            parts, base, o = [], 0, 0
            for n, vl in zip(lens, _dec_ints(d["vl"], blob)):
                nv = vl // 6
                dt = "u1" if nv <= 255 else "<u2"
                k = n // np.dtype(dt).itemsize
                parts.append((idx[o:o + k] - base).astype(dt).tobytes())
                o += k
                base += nv
            cat = b"".join(parts)
        out, o = [], 0
        for n in lens:
            out.append(base64.b64encode(cat[o:o + n]).decode())
            o += n
        return out
    if t == "b":
        if "e" in d:
            cat, o = np.asarray(_dec_ints(d["c"], blob), dtype=d["e"]).tobytes(), 0
        else:
            cat, o = blob, d["o"]
        out = []
        for n in _dec_ints(d["len"], blob):
            out.append(base64.b64encode(cat[o:o + n]).decode())
            o += n
        return out
    if t == "l":
        flat, out, o = _dec(d["c"], blob), [], 0
        for n in _dec_ints(d["len"], blob):
            out.append(flat[o:o + n])
            o += n
        return out
    if t == "r":
        lens = _dec_ints(d["len"], blob)
        cols = [iter(_dec(c, blob)) for c in d["c"]]
        return [[next(cols[j]) for j in range(n)] for n in lens]
    if t == "d":
        out = [{} for _ in range(d["n"])]
        for k, kd in d["k"].items():
            vals = iter(_dec(kd["c"], blob))
            rows = range(d["n"]) if "has" not in kd else [i for i, h in enumerate(_dec_ints(kd["has"], blob)) if h]
            for i in rows:
                out[i][k] = next(vals)
        return out
    if t == "o":
        return {k: _val(x, blob) for k, x in d["k"].items()}
    if t == "one":
        return _dec(d["c"], blob)[0]
    if t == "j":
        return d["v"]
    raise ValueError(t)


def _val(d, blob):
    return d["j"] if "j" in d else _dec(d, blob)


def decode(data):
    data = gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data
    assert data[:4] == MAGIC
    (hl,) = struct.unpack("<I", data[4:8])
    head = json.loads(data[8:8 + hl])
    start = 8 + hl + (-(8 + hl)) % 8
    blob = data[start:]
    return head, {k: _val(d, blob) for k, d in head["keys"].items()}


def same_corners(obj):
    """buildings.json with each roof triangle as the smallest of its rotations (winding kept): the index codec
    may start a triangle at another corner, so a pack is compared with its source this way."""
    if not obj.get("r"):
        return obj
    rows = []
    for r in obj["r"]:
        nv = len(base64.b64decode(r[6])) // 6
        t = np.frombuffer(base64.b64decode(r[7]), "u1" if nv <= 255 else "<u2").reshape(-1, 3)
        if len(t):  # the smallest of its three rotations (a degenerate triangle repeats its smallest index)
            rot = np.stack([np.roll(t, -j, axis=1) for j in range(3)])
            key = (rot[:, :, 0].astype(np.int64) << 32) + (rot[:, :, 1].astype(np.int64) << 16) + rot[:, :, 2]
            t = rot[np.argmin(key, axis=0), np.arange(len(t))]
        rows.append(r[:7] + [base64.b64encode(t.tobytes()).decode()] + r[8:])
    return {**obj, "r": rows}


def pack_file(src, dst, name="buildings.json"):
    raw = open(src, "rb").read()
    obj = json.loads(raw)
    w, keys = encode(obj, BYTES.get(name, ()), TYPED.get(name, ()), deep=name != "buildings.json",
                     raw=RAW.get(name, ()), meshopt_cols=MESHOPT.get(name, ()), fine=name in FINE_STRINGS)
    head = json.dumps({"format": "oe-pack", "v": 1, "source": name, "sha256": hashlib.sha256(raw).hexdigest(),
                       "keys": keys}, separators=(",", ":"), ensure_ascii=False).encode()
    pre = MAGIC + struct.pack("<I", len(head)) + head
    pre += b"\0" * ((-len(pre)) % 8)
    body = pre + b"".join(w.parts)
    out = gzip.compress(body, 9, mtime=0)
    _, back = decode(out)
    if name in MESHOPT:
        back, obj = same_corners(back), same_corners(obj)
    if back != obj:
        bad = [k for k in obj if back.get(k) != obj[k]]
        raise SystemExit(f"{src}: the pack does not decode to the source ({', '.join(bad)})")
    tmp = dst + ".tmp"
    open(tmp, "wb").write(out)
    os.replace(tmp, dst)
    return len(raw), len(gzip.compress(raw, 6, mtime=0)), len(out)


def stale(city, name="buildings.json"):
    src = os.path.join(DATA, city, name)
    dst = src[:-len(".json")] + ".bin"
    if not os.path.exists(dst):
        return "missing"
    try:
        with gzip.open(dst) as f:
            pre = f.read(8)
            head = json.loads(f.read(struct.unpack("<I", pre[4:8])[0]))
    except (OSError, ValueError, struct.error):
        return "unreadable"
    if head.get("sha256") != hashlib.sha256(open(src, "rb").read()).hexdigest():
        return "stale"
    return None


def cities():
    return sorted(c for c in os.listdir(DATA) if os.path.exists(os.path.join(DATA, c, "buildings.json")))


def parked():
    return set(json.load(open(os.path.join(ROOT, "cities", "index.json"), encoding="utf8")).get("parked", []))


def packs(city):
    """The files of a city that are packed: buildings.json always; the others (landmarks, game, terrain,
    places, scene) for a live city, or where a pack of them is already there (kept up to date)."""
    out = []
    for name in NAMES:
        src = os.path.join(DATA, city, name)
        if not os.path.exists(src):
            continue
        if name == "buildings.json" or city not in parked() or os.path.exists(src[:-5] + ".bin"):
            out.append(name)
    return out


def update_index(ids):
    """cities.json load_bytes: what the loader downloads, now with buildings.bin (build_scene.write_index)."""
    sys.path.insert(0, os.path.join(ROOT, "pipeline"))
    from build_scene import write_index
    write_index()


def vis_cities(named):
    """The cities whose occluder raster (vis.bin, pipeline/visibility.py: what the page's visibility sweep
    reads, issue 358) is kept with their packs: the live cities with a game."""
    live = [c for c in cities() if c not in parked() and os.path.exists(os.path.join(DATA, c, "game.json"))]
    return [c for c in live if not named or c in named]


def main(argv):
    check = "--check" in argv
    named = [a for a in argv if not a.startswith("--")]
    for c in named:
        if c not in cities():
            raise SystemExit(f"no buildings.json for {c}")
    every = [(c, n) for c in (named or cities()) for n in packs(c)]
    sys.path.insert(0, os.path.join(ROOT, "pipeline"))
    import visibility
    if check:
        bad = [(c, n, s) for c, n in every if (s := stale(c, n))]
        bad += [(c, "vis.json", s) for c in vis_cities(named) if (s := visibility.stale(c))]
        for c, n, s in bad:
            print(f"FAIL pack   {c}: {n[:-5]}.bin {s}; run python pipeline/pack.py {c}")
        if not bad:
            print(f"ok   pack   {len(every)} packs in {len(named or cities())} cities match their JSON")
        return 1 if bad else 0
    todo = every if named else [(c, n) for c, n in every if stale(c, n)]
    for c, n in todo:
        src = os.path.join(DATA, c, n)
        raw, gz, out = pack_file(src, src[:-5] + ".bin", n)
        print(f"{c}: {n} {raw / 1e6:.2f} MB ({gz / 1e6:.2f} MB gzipped) -> {n[:-5]}.bin {out / 1e6:.2f} MB")
    if todo:
        update_index([c for c, _ in todo])
    # the occluder raster of each live city, from its buildings (a minute or two for a large city)
    vis = [c for c in vis_cities(named) if named or visibility.stale(c)]
    if vis:
        visibility.main(vis)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
