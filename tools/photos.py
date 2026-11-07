"""Reference photographs from Openverse, when Wikimedia Commons is rate-limiting (tools/commons.py).

    python tools/photos.py search "Skyline Gondola Queenstown" [--n 20] [--source flickr]
    python tools/photos.py get <openverse id> OUT_DIR

Openverse (WordPress, api.openverse.org) indexes openly licensed images from Flickr, Wikimedia
Commons, museum and government collections, and answers anonymously (no key; a few requests a
minute). This asks only for images under an open licence: CC BY, CC BY-SA, CC0 and the public
domain mark (no NC or ND). `get` writes the image and a .json beside it with the source page,
author, licence and the date it was fetched, to be recorded in the docs. The photographs are for
checking a model against, never textures.
"""
import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.openverse.org/v1/images/"
UA = {"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"}
OPEN = "by,by-sa,cc0,pdm"


def fetch(url, raw=False, tries=6):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = r.read()
            time.sleep(1)
            return data if raw else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or k == tries - 1:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 10 * 2 ** k
            print(f"  {e.code}: waiting {wait} s", file=sys.stderr)
            time.sleep(wait)
        except urllib.error.URLError:
            if k == tries - 1:
                raise
            time.sleep(5 * 2 ** k)


def search(q, n=20, source=None):
    p = {"q": q, "page_size": min(n, 20), "license": OPEN}
    if source:
        p["source"] = source
    return fetch(API + "?" + urllib.parse.urlencode(p)).get("results", [])


def get(oid, out):
    if not re.fullmatch(r"[0-9a-f-]{36}", oid):
        raise SystemExit("an Openverse id is a UUID")
    os.makedirs(out, exist_ok=True)
    r = fetch(API + oid + "/")
    if r.get("license") not in OPEN.split(","):
        raise SystemExit(f"{oid}: licence {r.get('license')} is not an open one")
    meta = {"id": oid, "title": r.get("title"), "page": r.get("foreign_landing_url"), "author": r.get("creator"),
            "author_url": r.get("creator_url"), "licence": f"CC {r.get('license', '').upper()} {r.get('license_version') or ''}".strip(),
            "licence_url": r.get("license_url"), "source": r.get("source"), "attribution": r.get("attribution"),
            "size": [r.get("width"), r.get("height")], "fetched": datetime.date.today().isoformat()}
    ext = os.path.splitext(urllib.parse.urlparse(r["url"]).path)[1].lower()
    ext = ext if ext in (".jpg", ".jpeg", ".png", ".webp") else ".jpg"
    path = os.path.join(out, oid + ext)
    with open(path, "wb") as f:
        f.write(fetch(r["url"], raw=True))
    json.dump(meta, open(os.path.join(out, oid + ".json"), "w"), ensure_ascii=False, indent=1)
    return path, meta


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search")
    s.add_argument("q")
    s.add_argument("--n", type=int, default=20)
    s.add_argument("--source", help="flickr, wikimedia, ... (Openverse's source names)")
    g = sub.add_parser("get")
    g.add_argument("id")
    g.add_argument("out")
    a = ap.parse_args()
    if a.cmd == "search":
        for r in search(a.q, a.n, a.source):
            print(f"{r['id']} | {r.get('license')} {r.get('license_version') or ''} | {r.get('source')} | {(r.get('title') or '')[:60]} | {r.get('foreign_landing_url')}")
    else:
        path, meta = get(a.id, a.out)
        print(path, "|", meta["licence"], "|", meta["author"], "|", meta["page"])


if __name__ == "__main__":
    main()
