"""Pack a city's JSON files into the compact binary form the browser loads (issues 148, 201, 259):
buildings.json into buildings.bin, and landmarks.json, game.json, terrain.json, places.json and
scene.json into landmarks.bin, game.bin, terrain.bin, places.bin and scene.bin.

    python pipeline/pack.py                 # every pack that is missing or stale
    python pipeline/pack.py shibuya osaka   # these cities' (packed again even when up to date)
    python pipeline/pack.py --check         # exit 1 if any pack is missing or stale

buildings.bin is made for every city; the others for the live cities (cities/index.json
less "parked") and for any city that already has one. The JSON stays the pipeline's source: every step
reads and writes it. Each pack is derived from it and decodes (web/pack.js) to the very same object, so
nothing downstream changes, except that
  - the roof meshes' base64 strings (buildings.json "r" columns 6 and 7) arrive as bytes (Uint8Array);
  - the landmark meshes' vertex lists (landmarks.json meshes[].position, .index, .uv) arrive as typed
    arrays (Float64Array or Int32Array) that a Worker hands over without copying (web/pack-worker.js);
  - the terrain grid (terrain.json "data", base64 int16) arrives as its bytes (Uint8Array).

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
                                           "e" (element type, "<i2") and "c" (int column) the elements
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
import struct
import sys
import zlib

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "web", "data")
BYTES = {"buildings.json": {("r", 6): "<i2", ("r", 7): None},  # base64 columns shipped as bytes: (table, position): element type
         # (and in game.json the height grids and the water mask, which decode back to base64 text, "s64")
         "game.json": {("terrain", "data"): "<i2", ("patches", "data"): "<i2", ("upper", "data"): "<i2", ("water", "bits"): None},
         "terrain.json": {("data",): "<i2"}}
# bytes columns that arrive as bytes (Uint8Array) in a deep pack; the others decode back to base64 text ("s64")
RAW = {"terrain.json": {("data",)}}
# numeric lists decoded as typed arrays (list columns flagged "ta"): (list, key) in a list of objects
TYPED = {"landmarks.json": {("meshes", "position"), ("meshes", "index"), ("meshes", "uv")}}
NAMES = ("buildings.json", "landmarks.json", "game.json", "terrain.json", "places.json", "scene.json")
SMALL = 4096  # a value whose JSON is shorter than this stays JSON
MAGIC = b"OEPK"


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
            if path in self.bytes_cols:
                raw = [base64.b64decode(v) for v in vals]
                lens, cat, dt = self.ints([len(r) for r in raw]), b"".join(raw), self.bytes_cols[path]
                s64 = {"s64": 1} if self.deep and path not in self.raw else {}  # (decoded back to base64 text: nothing that reads it changes)
                if dt:  # an array of numbers: as integers, so that they can be delta-coded and shuffled
                    return {"t": "b", "len": lens, "e": dt, "c": self.ints(np.frombuffer(cat, dt).tolist()), **s64}
                return {"t": "b", "len": lens, "o": self.put(cat), "n": len(vals), **s64}
            tab, idx = {}, []
            for v in vals:
                idx.append(tab.setdefault(v, len(tab)))
            return {"t": "s", "tab": list(tab), "c": self.ints(idx)}
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


def encode(obj, bytes_cols=(), typed=(), deep=False, raw=()):
    """deep: objects and lists of objects packed by key too (landmarks.json, game.json); buildings.json
    keeps the layout of its first packs, its top-level lists as columns and the rest as JSON."""
    w = Writer()
    w.bytes_cols, w.typed, w.deep, w.raw = dict(bytes_cols), set(typed), deep, set(raw)
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


def pack_file(src, dst, name="buildings.json"):
    raw = open(src, "rb").read()
    obj = json.loads(raw)
    w, keys = encode(obj, BYTES.get(name, ()), TYPED.get(name, ()), deep=name != "buildings.json",
                     raw=RAW.get(name, ()))
    head = json.dumps({"format": "oe-pack", "v": 1, "source": name, "sha256": hashlib.sha256(raw).hexdigest(),
                       "keys": keys}, separators=(",", ":"), ensure_ascii=False).encode()
    pre = MAGIC + struct.pack("<I", len(head)) + head
    pre += b"\0" * ((-len(pre)) % 8)
    body = pre + b"".join(w.parts)
    out = gzip.compress(body, 9, mtime=0)
    _, back = decode(out)
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


def main(argv):
    check = "--check" in argv
    named = [a for a in argv if not a.startswith("--")]
    for c in named:
        if c not in cities():
            raise SystemExit(f"no buildings.json for {c}")
    every = [(c, n) for c in (named or cities()) for n in packs(c)]
    if check:
        bad = [(c, n, s) for c, n in every if (s := stale(c, n))]
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
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
