"""Reference photographs from Wikimedia Commons: search, and fetch a thumbnail with its licence.

    python tools/commons.py search "Eikando Zenrinji" [--n 20]
    python tools/commons.py get "File:Eikan-do Amidado.jpg" OUT_DIR [--w 1280]

Commons rate-limits a shared address (HTTP 429), so this makes one request at a time, with the
project's User-Agent, waits a second between requests and backs off on 429 and 5xx. Searches go
through the API; images come from upload.wikimedia.org thumbnails. `get` writes the image and a
.json beside it with the source page, author and licence, to be recorded in the docs.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://commons.wikimedia.org/w/api.php"
UA = {"User-Agent": "open-earth-3d (https://github.com/Mira190/open-earth-3d)"}


def fetch(url, raw=False, tries=7):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = r.read()
            time.sleep(1)
            return data if raw else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or k == tries - 1:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 5 * 2 ** k
            print(f"  {e.code}: waiting {wait} s", file=sys.stderr)
            time.sleep(wait)
        except urllib.error.URLError:
            if k == tries - 1:
                raise
            time.sleep(5 * 2 ** k)


def search(q, n=20):
    d = fetch(API + "?" + urllib.parse.urlencode({"action": "query", "list": "search", "srnamespace": 6, "srsearch": q,
                                                  "srlimit": n, "format": "json"}))
    return [x["title"] for x in d.get("query", {}).get("search", [])]


def info(title, w=1280):
    d = fetch(API + "?" + urllib.parse.urlencode({"action": "query", "titles": title, "prop": "imageinfo", "iiprop": "url|extmetadata|size",
                                                  "iiurlwidth": w, "format": "json"}))
    page = next(iter(d["query"]["pages"].values()))
    ii = page["imageinfo"][0]
    md = ii.get("extmetadata", {})

    def m(k):
        return re.sub(r"<[^>]+>", "", md.get(k, {}).get("value", "")).strip()

    return {"title": title, "page": ii.get("descriptionurl"), "thumb": ii.get("thumburl") or ii["url"], "author": m("Artist"),
            "licence": m("LicenseShortName"), "licence_url": m("LicenseUrl"), "date": m("DateTimeOriginal") or m("DateTime"),
            "description": m("ImageDescription")[:300], "size": [ii.get("width"), ii.get("height")]}


def get(title, out, w=1280):
    os.makedirs(out, exist_ok=True)
    meta = info(title, w)
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", title.split(":", 1)[-1])
    base = os.path.splitext(name)[0]
    ext = os.path.splitext(urllib.parse.urlparse(meta["thumb"]).path)[1] or ".jpg"
    with open(os.path.join(out, base + ext), "wb") as f:
        f.write(fetch(meta["thumb"], raw=True))
    json.dump(meta, open(os.path.join(out, base + ".json"), "w"), ensure_ascii=False, indent=1)
    return os.path.join(out, base + ext), meta


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search")
    s.add_argument("q")
    s.add_argument("--n", type=int, default=20)
    g = sub.add_parser("get")
    g.add_argument("title")
    g.add_argument("out")
    g.add_argument("--w", type=int, default=1280)
    a = ap.parse_args()
    if a.cmd == "search":
        print("\n".join(search(a.q, a.n)))
    else:
        path, meta = get(a.title, a.out, a.w)
        print(path, "|", meta["licence"], "|", meta["author"], "|", meta["page"])


if __name__ == "__main__":
    main()
