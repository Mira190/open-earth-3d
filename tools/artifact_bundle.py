"""Stage web/ for a host that caps a site's files (about 500) and its size (256 MB), such as a Claude artifact.

Code, styles, fonts and pages stay as files. The data and shared assets of the live cities and sites are packed
into chunk files (vfs/NNN.wasm, raw bytes under a type such hosts serve, about 12 MB each, grouped by folder so a city loads only its own) with an
index, and tools/artifact/vfs.js, loaded first by each page and by the visibility worker, serves them to
fetch() and <img src>. Left out: parked cities, films and videos, JSON sources that have a packed .bin, and
the JSON sources of the packed buildings, landmarks and game (and with DROP_JPEG=1 the JPEG ground tiles
that have an AVIF twin).

    python tools/artifact_bundle.py OUT_DIR
"""
import json
import re
import os
import shutil
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
CHUNK = 12_000_000
# kept as plain files: what HTML and CSS name directly, so the browser loads it before any script runs
PLAIN = ('assets/fonts/', 'assets/earth/poster.jpg')
PLAIN_DIRS = ('postcards',)   # named in innerHTML and CSS backgrounds
PACKED_JSON = {'buildings.json', 'landmarks.json', 'game.json'}   # the page reads their .bin
DROP_JPEG = os.environ.get('DROP_JPEG') == '1'   # ground tiles' JPEG fallbacks, for browsers without AVIF
SKIP_NAMES = {'trees-lineup.html', 'lineup.html', 'version.json'}
SKIP_EXT = ('.webm', '.mp4', '.md', '.blend', '.py')
PAGES = ('index.html', 'reef/index.html')
WORKERS = ('visibility-worker.js',)


def main(out):
    parked = set(json.load(open(os.path.join(ROOT, 'cities/index.json')))['parked'])
    files = []
    for root, dirs, names in os.walk(WEB):
        dirs.sort()
        rel = os.path.relpath(root, WEB).replace(os.sep, '/')
        rel = '' if rel == '.' else rel
        top = rel.split('/')
        if top[0] == 'films' or (top[0] == 'data' and len(top) > 1 and top[1] in parked):
            continue
        for n in sorted(names):
            p = f'{rel}/{n}' if rel else n
            full = os.path.join(root, n)
            if n in SKIP_NAMES or n.endswith(SKIP_EXT):
                continue
            if n in PACKED_JSON and os.path.exists(full[:-5] + '.bin'):
                continue
            if DROP_JPEG and n.endswith('.jpg') and os.path.exists(full[:-4] + '.avif'):
                continue
            files.append(p)

    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(os.path.join(out, 'vfs'))
    packed = [p for p in files if p.startswith(('data/', 'assets/')) and not p.startswith(PLAIN)
              and not any(d in p.split('/')[:-1] for d in PLAIN_DIRS)]
    plain = [p for p in files if p not in set(packed)]

    shim = open(os.path.join(ROOT, 'tools/artifact/vfs.js')).read()
    for p in plain:
        dst = os.path.join(out, p)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(os.path.join(WEB, p), dst)
    open(os.path.join(out, 'vfs.js'), 'w').write(shim)
    for page in PAGES:
        f = os.path.join(out, page)
        html = open(f).read()
        src = '../vfs.js' if '/' in page else 'vfs.js'
        tag = f'<script src="{src}"></script>\n'
        i = html.index('<meta charset')
        html = html[:i] + tag + html[i:]
        open(f, 'w').write(html)
    # no analytics key in this build: the host's content policy blocks the collector anyway, and with no
    # endpoint telemetry.js sends nothing (it says so in its header)
    f = os.path.join(out, 'telemetry.js')
    js = open(f).read()
    js2 = re.sub(r"endpoint: '[^']*'", "endpoint: ''", js, count=1)
    js2 = re.sub(r"key: 'phc_[A-Za-z0-9]+'", "key: ''", js2, count=1)
    assert js2 != js and 'phc_' not in js2, 'telemetry.js CONFIG not found'
    open(f, 'w').write(js2)
    for w in WORKERS:
        f = os.path.join(out, w)
        code = open(f).read()
        open(f, 'w').write("importScripts('vfs.js');\n" + code)
    stamp = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    ver = open(os.path.join(ROOT, 'VERSION')).read().strip()
    json.dump({'version': f'{ver}.artifact', 'commit': os.popen(f'git -C {ROOT} rev-parse HEAD').read().strip(), 'built': stamp},
              open(os.path.join(out, 'version.json'), 'w'))

    # chunks: files in folder order, a new chunk at each top-level folder (data/<id>, assets/<kind>) and at CHUNK bytes
    index, n, size, cur, group = {}, 0, 0, None, None
    def close():
        if cur:
            cur.close()
    for p in packed:
        g = '/'.join(p.split('/')[:2])
        s = os.path.getsize(os.path.join(WEB, p))
        if cur is None or g != group or (size and size + s > CHUNK):
            close()
            n += 1 if cur else 0
            cur = open(os.path.join(out, 'vfs', f'{n:03d}.wasm'), 'wb')
            size, group = 0, g
        index[p] = [n, size, s]
        cur.write(open(os.path.join(WEB, p), 'rb').read())
        size += s
    close()
    json.dump(index, open(os.path.join(out, 'vfs/index.json'), 'w'), separators=(',', ':'))

    count = sum(len(f) for _, _, f in os.walk(out))
    total = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(out) for f in fs)
    print(f'{len(packed)} files packed into {n + 1} chunks; {count} files, {total / 1e6:.1f} MB staged in {out}')


if __name__ == '__main__':
    main(sys.argv[1])
