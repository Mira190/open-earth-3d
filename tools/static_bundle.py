#!/usr/bin/env python3
"""Bundle web/ for a static host that is stricter than a plain web server.

Some hosts serve only standard web media types (no .glb or .bin), cap a file at 16 MB and a
whole site at a few hundred files and megabytes. web/ is bigger than that, so this writes a copy
that fits and runs unchanged:

  - Every .json, .glb and .bin file is gzipped and packed with its neighbours (one pack per city,
    reef site or asset folder), cut into chunks of about 4 MB and written as base64 text under
    pk/. A small fetch shim at the top of each page serves the original paths from the packs: it
    fetches only the chunks a request needs, inflates the file with the browser's own
    DecompressionStream and hands back a normal Response, so the app's fetch() and three.js
    loaders never know. Images, video, scripts, styles and fonts stay as they are.
  - web/index.html becomes app.html, and index.html is a stub that forwards to it with the query
    and hash (the host wraps its front page in a skeleton of its own; app.html is served as is).
  - The city films (films/*.mp4) can live elsewhere: --video-urls names a JSON file that maps
    each film's path to the URL that serves it, and the films' cue sheets are rewritten to match.
    Without it the films are copied like any other video. --no-films leaves them out.
  - The recorded loading flyovers (data/<city>/flyover.*) are left out: the loader draws the
    city's survey plate instead (web/plate.js), and data/cities.json stops naming them.

  python tools/static_bundle.py OUT_DIR [--video-urls urls.json | --no-films]

Prints the file count and total size, and fails if a file is over the limits.
"""
import argparse
import base64
import gzip
import json
import os
import shutil
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')
PACKED = ('.json', '.glb', '.bin')
CHUNK = 4_000_000          # gzip bytes per chunk, before base64
TEXT_MAX = 16_000_000      # the host's cap on a text file
BIN_MAX = 15_000_000       # and on a binary file
SHIMMED = ('index.html', 'game/lineup.html', 'reef/index.html', 'reef/lineup.html')


def group_of(rel):
    """The pack a file goes in: its city or reef site, its asset folder, or its top folder."""
    parts = rel.split('/')
    if parts[0] in ('data', 'assets') and len(parts) > 2:
        return f'{parts[0]}-{parts[1]}'
    return parts[0] if len(parts) > 1 else 'root'


def shim(manifest, root_up):
    """The fetch shim, with the manifest inline so it is ready before the page's first fetch."""
    data = json.dumps(manifest, separators=(',', ':'))
    return f"""<script>
// Published copy only (tools/static_bundle.py). The host serves neither .glb nor .bin files and
// caps a file's size, so .json, .glb and .bin files are gzipped into packs of base64 chunks under
// pk/. This serves the original paths from them, so the app's own fetches work unchanged.
(() => {{
  const M = {data};
  const ROOT = new URL('{root_up}', location.href).href, get = window.fetch.bind(window), chunks = new Map();
  const b64 = t => {{
    if (Uint8Array.fromBase64) return Uint8Array.fromBase64(t.trim());
    const s = atob(t.trim()), a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }};
  const chunk = name => {{
    if (!chunks.has(name)) chunks.set(name, get(ROOT + 'pk/' + name).then(r => {{
      if (!r.ok) throw new Error(`pk/${{name}}: HTTP ${{r.status}}`);
      return r.text();
    }}).then(b64).catch(e => {{ chunks.delete(name); throw e; }}));
    return chunks.get(name);
  }};
  // the bytes of one file: its gzip member spans [off, off + len) of the pack's chunks laid end to end
  async function inflate(e) {{
    const [pack, off, len] = e, names = M.packs[pack], size = M.chunk;
    const first = Math.floor(off / size), last = Math.floor((off + len - 1) / size);
    const parts = await Promise.all(names.slice(first, last + 1).map(chunk));
    const gz = new Uint8Array(len);
    let at = 0;
    parts.forEach((p, i) => {{
      const s = i === 0 ? off - first * size : 0, n = Math.min(p.length - s, len - at);
      gz.set(p.subarray(s, s + n), at); at += n;
    }});
    return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }}
  const TYPES = {{ json: 'application/json', glb: 'model/gltf-binary', bin: 'application/octet-stream' }};
  window.fetch = function (input, init) {{
    let url;
    try {{ url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href); }} catch (e) {{ return get(input, init); }}
    const path = url.href.startsWith(ROOT) ? decodeURIComponent(url.pathname.slice(new URL(ROOT).pathname.length)) : null;
    const e = path !== null && M.files[path];
    if (!e) return get(input, init);
    return inflate(e).then(buf => new Response(buf, {{ status: 200, headers: {{
      'Content-Type': TYPES[path.split('.').pop()] || 'application/octet-stream', 'Content-Length': String(buf.byteLength) }} }}));
  }};
}})();
</script>
"""


def stub(title, description):
    """The front page: forwards to app.html, keeping the query and the hash (deep links)."""
    return f"""<title>{title}</title>
<meta name="description" content="{description}">
<style>
:root {{ --bg: #05070d; --ink: #e8ecf2; --muted: #8b95a5; color-scheme: dark; }}
:root[data-theme="light"] {{ --bg: #05070d; --ink: #e8ecf2; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg: #05070d; --ink: #e8ecf2; }} }}
:root[data-theme="dark"] {{ --bg: #05070d; --ink: #e8ecf2; }}
html, body {{ background: var(--bg); color: var(--ink); margin: 0; min-height: 100vh; }}
body {{ display: grid; place-items: center; font: 500 15px/1.5 system-ui, sans-serif; padding: 0 16px; }}
a {{ color: var(--ink); }}
p {{ color: var(--muted); }}
</style>
<p id="go">Opening Open Earth 3D… <a href="app.html">open it</a></p>
<script>location.replace('app.html' + location.search + location.hash);</script>
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('out')
    ap.add_argument('--video-urls', help='JSON: {"films/sydney.mp4": "https://...", ...}')
    ap.add_argument('--no-films', action='store_true', help='leave the city films out')
    args = ap.parse_args()
    out = os.path.abspath(args.out)
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(out)
    urls = json.load(open(args.video_urls)) if args.video_urls else {}

    files = []
    for d, _, names in os.walk(ROOT):
        for n in names:
            files.append(os.path.relpath(os.path.join(d, n), ROOT).replace(os.sep, '/'))
    files.sort()

    def read(rel):
        """A file's bytes, with the rewrites the bundle needs."""
        raw = open(os.path.join(ROOT, rel), 'rb').read()
        if rel == 'data/cities.json':
            cities = json.loads(raw)
            for c in (cities if isinstance(cities, list) else cities.get('cities', [])):
                c.pop('flyover', None)
            raw = json.dumps(cities, ensure_ascii=False).encode()
        elif rel.startswith('films/') and rel.endswith('.json') and urls:
            j = json.loads(raw)
            if isinstance(j.get('video'), str) and j['video'] in urls:
                j['video'] = urls[j['video']]
            raw = json.dumps(j, ensure_ascii=False).encode()
        return raw

    packs, manifest = {}, {'chunk': CHUNK, 'packs': {}, 'files': {}}
    plain, skipped = [], []
    for rel in files:
        if rel.endswith('.webm') or rel == 'index.html' or rel in SHIMMED or os.path.basename(rel).startswith('flyover.'):
            continue
        if rel.startswith('films/') and rel.endswith('.mp4'):
            if args.no_films or rel in urls:
                skipped.append(rel)
                continue
        if args.no_films and rel.startswith('films/'):
            continue
        if rel.endswith(PACKED):
            packs.setdefault(group_of(rel), []).append(rel)
        else:
            plain.append(rel)

    total = count = 0
    too_big = []

    def emit(rel, data, limit):
        nonlocal total, count
        path = os.path.join(out, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(data)
        total += len(data)
        count += 1
        if len(data) > limit:
            too_big.append(f'{rel} ({len(data) / 1e6:.1f} MB)')

    for rel in plain:
        emit(rel, read(rel), BIN_MAX if not rel.endswith(('.js', '.css', '.html', '.txt', '.svg')) else TEXT_MAX)

    for name, rels in sorted(packs.items()):
        blob = bytearray()
        for rel in rels:
            gz = gzip.compress(read(rel), compresslevel=9, mtime=0)
            manifest['files'][rel] = [name, len(blob), len(gz)]
            blob += gz
        chunk_names = []
        for i in range(0, len(blob), CHUNK):
            cn = f'{name}.{i // CHUNK}.txt'
            emit('pk/' + cn, base64.b64encode(bytes(blob[i:i + CHUNK])), TEXT_MAX)
            chunk_names.append(cn)
        manifest['packs'][name] = chunk_names

    for rel in SHIMMED:
        src = os.path.join(ROOT, rel)
        if not os.path.exists(src):
            continue
        html = open(src, encoding='utf-8').read()
        up = '../' * rel.count('/') or './'
        s = shim(manifest, up)
        head = html.find('<head>')
        html = html[:head + 6] + '\n' + s + html[head + 6:] if head >= 0 else s + html
        emit('app.html' if rel == 'index.html' else rel, html.encode(), TEXT_MAX)

    emit('index.html', stub('Open Earth 3D', 'The Earth in 3D, city by city, from open data and the real sun.').encode(), TEXT_MAX)

    print(f'{count} files, {total / 1e6:.1f} MB, {len(manifest["files"])} files in '
          f'{sum(len(v) for v in manifest["packs"].values())} chunks of {len(manifest["packs"])} packs')
    if skipped:
        print(f'left out (served elsewhere or --no-films): {len(skipped)} films')
    if too_big:
        print('over the limit: ' + ', '.join(too_big))
        sys.exit(1)


if __name__ == '__main__':
    main()
