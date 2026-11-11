"""A map's daily life: cities/<id>/life.json -> web/data/<id>/life.json.

life.json is written by hand: the people you get to know (bonds, five ranks each), the hours they
and the shops keep, the jobs, the calendar's events on their real dates. This step checks it and
turns every place it names into the map's own metres, so the writer never measures a coordinate:

    "at": [x, y]                       the local frame, as everywhere else
    "at": {"npc": "aoi"}               where that person stands ("d": [dx, dy] metres aside)
    "at": {"spot": "hachiko"}          a spot of the game (game.json "spots")
    "at": {"travel": "t-sancha"}       a travel point
    "at": {"label": "QFRONT"}          a landmark's label (scene.json "labels"; the start of the name will do)
    "at": {"wharf": "circular-quay"}   a wharf
    "at": {"viewpoint": "observatory-hill"}   a trig station
    "at": {"station": "koshigoe"}      a railway station (game.json rail.train, or trains for a main line)
    "at": {"lonlat": [139.7005, 35.6590]}   anywhere real, by its longitude and latitude

A person may keep other places at other hours: bonds[].places, each {"slots"/"weekdays"/"hours"/"weather",
"at", "where", "face"}; the first that is on is where they stand (web/game/bonds.js), else their own place.

The game then stands each on the nearest firm ground. What is checked: every person named is one
of the map's NPCs and has five ranks; skills, job types, slots and dates are real ones; every place
resolves and lies inside the map; and nothing a character says talks about the data or the build
(tools/voice_check.py's list).

    python pipeline/life.py                 # every live city that has a life.json
    python pipeline/life.py --city shibuya
    python pipeline/life.py --check         # fail if a web/data/<id>/life.json is stale
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from voice_check import RX_CITY  # noqa: E402

SKILLS = {'eye', 'bearings', 'light', 'lines', 'taste'}
SLOTS = {'morning', 'daytime', 'evening', 'night'}
JOBS = {'deliver', 'fare', 'point', 'photo', 'train'}
REQUESTS = {'visit', 'spot', 'guess', 'survey', 'photo', 'ride', 'dish', 'job', 'event', 'skill', 'stamp', 'shop'}
GIVES = {'fare', 'tip', 'travel', 'job', 'xp', 'forecast', 'filter', 'helm', 'key'}
RANKS = 5


class Bad(Exception):
    pass


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def build(city):
    src = os.path.join(ROOT, 'cities', city, 'life.json')
    life = load(src)
    game = load(os.path.join(ROOT, 'web', 'data', city, 'game.json'))
    scene = load(os.path.join(ROOT, 'web', 'data', city, 'scene.json'))
    fr = scene['frame']
    npcs = {n['id']: n for n in game.get('npcs', [])}
    errs = []
    proj = None

    def stations():  # a railway's stations: rail.js's line (game.json rail.train) or trains.js's main line (game.json trains)
        return ((game.get('rail') or {}).get('train') or {}).get('stations', []) + (game.get('trains') or {}).get('stations', [])

    def place(v, where):
        nonlocal proj
        if isinstance(v, list):
            p = v
        elif 'npc' in v:
            if v['npc'] not in npcs:
                raise Bad(f'{where}: no NPC "{v["npc"]}"')
            p = list(npcs[v['npc']]['at'])
        elif 'spot' in v:
            s = [s for s in game.get('spots', []) if s['id'] == v['spot']]
            if not s:
                raise Bad(f'{where}: no spot "{v["spot"]}"')
            p = list(s[0]['at'])
        elif 'travel' in v:
            s = [s for s in game.get('travel', []) if s.get('id') == v['travel']]
            if not s:
                raise Bad(f'{where}: no travel point "{v["travel"]}"')
            p = list(s[0]['at'])
        elif 'label' in v:
            s = [p for k, p in scene.get('labels', {}).items() if k == v['label'] or k.startswith(v['label'])]
            if not s:
                raise Bad(f'{where}: no label "{v["label"]}"')
            p = list(s[0])[:2]  # (a label floats over the roof: the place is the ground under it)
        elif 'wharf' in v:
            s = [w for w in game.get('wharves', []) if w['id'] == v['wharf']]
            if not s:
                raise Bad(f'{where}: no wharf "{v["wharf"]}"')
            p = list(s[0].get('landing') or s[0]['terminal'])[:2]  # (the landing is worked out in the browser; the terminal is beside it)
        elif 'viewpoint' in v:
            s = [w for w in game.get('viewpoints', []) if v['viewpoint'] in (w.get('id'), w.get('name'))]
            if not s:
                raise Bad(f'{where}: no trig station "{v["viewpoint"]}"')
            p = [s[0]['x'], s[0]['y']] if 'x' in s[0] else list(s[0]['at'])[:2]
        elif 'station' in v:
            s = [w for w in stations() if w['id'] == v['station']]
            if not s:
                raise Bad(f'{where}: no railway station "{v["station"]}"')
            p = list(s[0]['at'])[:2]
        elif 'lonlat' in v:
            if proj is None:
                from pyproj import Transformer
                proj = Transformer.from_crs('EPSG:4326', fr['proj'], always_xy=True)
            p = list(proj.transform(*v['lonlat']))
        else:
            raise Bad(f'{where}: a place is [x, y] or one of npc, spot, travel, label, wharf, viewpoint, station, lonlat')
        if isinstance(v, dict) and 'd' in v:
            p[0] += v['d'][0]
            p[1] += v['d'][1]
        if isinstance(v, dict) and 'z' in v:
            p = [p[0], p[1], v['z']]
        if not (fr['x'][0] <= p[0] <= fr['x'][1] and fr['y'][0] <= p[1] <= fr['y'][1]):
            raise Bad(f'{where}: [{p[0]:.0f}, {p[1]:.0f}] is outside the map')
        return [round(c, 1) for c in p]

    def at(o, key, where, need=True):
        if key not in o:
            if need:
                errs.append(f'{where}: needs "{key}"')
            return
        try:
            o[key] = place(o[key], f'{where}.{key}')
        except Bad as e:
            errs.append(str(e))

    def when(o, where):
        if not o:
            return
        for s in o.get('slots', []):
            if s not in SLOTS:
                errs.append(f'{where}: no slot "{s}"')
        for d in o.get('weekdays', []):
            if d not in range(7):
                errs.append(f'{where}: weekdays are 0 (Monday) to 6')
        if o.get('weather') not in (None, 'rain', 'dry'):
            errs.append(f'{where}: weather is "rain" or "dry"')
        for k in ('dates', 'days'):
            for md in o.get(k, []):
                if not (1 <= md[0] <= 12 and 1 <= md[1] <= 31):
                    errs.append(f'{where}: {k} are [month, day]')

    said = []  # (where, text): what a person says or the player reads as theirs

    for b in life.get('bonds', []):
        w = f'bond {b.get("npc")}'
        if b.get('npc') not in npcs:
            errs.append(f'{w}: not one of the map\'s NPCs')
        when(b.get('hours'), w)
        for i, p in enumerate(b.get('places', [])):  # where they are at other hours (bonds.js): the first on now
            at(p, 'at', f'{w} place {i}')
            when(p, f'{w} place {i}')
            if not p.get('where'):
                errs.append(f'{w} place {i}: needs a "where" (the diary says it)')
            if not any(k in p for k in ('slots', 'weekdays', 'hours', 'weather', 'dates', 'days')):
                errs.append(f'{w} place {i}: needs its hours (slots, weekdays, hours or weather)')
        said.append((w, b.get('busy', '')))
        if len(b.get('ranks', [])) != RANKS:
            errs.append(f'{w}: needs {RANKS} ranks, has {len(b.get("ranks", []))}')
        for i, r in enumerate(b.get('ranks', [])):
            wr = f'{w} rank {i + 1}'
            if not r.get('talk'):
                errs.append(f'{wr}: needs "talk"')
            said += [(wr, t) for t in r.get('talk', [])] + [(wr, r.get('invite', ''))]
            if not r.get('fact'):
                errs.append(f'{wr}: needs a "fact" (one true thing about the place, for the diary)')
            if 'ask' in r:
                said.append((wr, r['ask']['q']))
                if not any(o.get('good') for o in r['ask']['options']):
                    errs.append(f'{wr}: no good answer to its question')
                said += [(wr, o.get('reply', '')) for o in r['ask']['options']]
            if 'needs' in r and r['needs'].get('skill') not in SKILLS:
                errs.append(f'{wr}: needs an unknown skill')
            if 'gives' in r:
                g = r['gives']
                if g.get('id') not in GIVES or not g.get('name') or not g.get('text'):
                    errs.append(f'{wr}: "gives" needs an id of {sorted(GIVES)}, a name and a text')
                if g.get('id') == 'travel':
                    at(g, 'at', wr)
            q = r.get('request')
            if q:
                said += [(wr, q.get('text', '')), (wr, q.get('ask', ''))]
                if q.get('type') not in REQUESTS or not q.get('text'):
                    errs.append(f'{wr}: a request needs a type of {sorted(REQUESTS)} and a text')
                if q.get('type') == 'visit':
                    at(q, 'at', wr)
                    when(q.get('when'), wr)
                if q.get('type') == 'photo' and 'near' in q:
                    at(q, 'near', wr)
                if q.get('type') == 'skill' and q.get('skill') not in SKILLS:
                    errs.append(f'{wr}: request for an unknown skill')
    job_ids = set()
    for j in life.get('jobs', []):
        w = f'job {j.get("id")}'
        job_ids.add(j.get('id'))
        if j.get('type') not in JOBS:
            errs.append(f'{w}: type is one of {sorted(JOBS)}')
        if not j.get('title') or not j.get('pay'):
            errs.append(f'{w}: needs a title and a pay')
        at(j, 'at', w)
        when(j.get('when'), w)
        if j.get('type') in ('deliver', 'fare', 'train'):
            at(j, 'to', w)
            if not j.get('time_s') or not j.get('to_name'):
                errs.append(f'{w}: needs time_s and to_name')
        if j.get('type') == 'train':  # from a station to another by rail: "from" and "to_station" are their ids
            sts = {x['id'] for x in stations()}
            if j.get('from') not in sts or j.get('to_station') not in sts:
                errs.append(f'{w}: a train job needs "from" and "to_station", two of the railway\'s stations ({sorted(sts) or "none on this map"})')
        for i, t in enumerate(j.get('targets', [])):
            at(t, 'at', f'{w} target {i}')
        for i, t in enumerate(j.get('subjects', [])):
            at(t, 'at', f'{w} subject {i}')
        if j.get('type') == 'point' and not j.get('targets'):
            errs.append(f'{w}: needs targets')
        if j.get('type') == 'photo' and not j.get('subjects'):
            errs.append(f'{w}: needs subjects')
        if j.get('skill') and j['skill'] not in SKILLS:
            errs.append(f'{w}: unknown skill')
        said += [(w, j.get(k, '')) for k in ('text', 'blurb', 'done', 'who', 'title')]
    for s in life.get('shops', []):
        w = f'shop {s.get("id")}'
        at(s, 'at', w)
        when(s, w)
        if not s.get('menu'):
            errs.append(f'{w}: needs a menu')
        said += [(w, m.get('text', '')) for m in s.get('menu', [])] + [(w, s.get('hello', ''))]
    for e in life.get('events', []):
        w = f'event {e.get("id")}'
        when(e, w)
        if not (e.get('dates') or e.get('days')):
            errs.append(f'{w}: needs dates [[m, d], [m, d]] or days [[m, d], ...]')
        if not e.get('source'):
            errs.append(f'{w}: needs a "source" for its dates')
        at(e, 'at', w, need=False)
        at(e, 'fx_at', w, need=False)  # where its fireworks burst, when not over the event itself
        if e.get('fx') not in (None, 'fireworks'):
            errs.append(f'{w}: fx is "fireworks"')
        if e.get('skill') and e['skill'] not in SKILLS:
            errs.append(f'{w}: unknown skill')
        said += [(w, t) for t in e.get('lines', [])] + [(w, e.get('text', ''))]
    for b in life.get('bonds', []):
        for r in b.get('ranks', []):
            g, q = r.get('gives') or {}, r.get('request') or {}
            for ref in (g.get('job') if g.get('id') == 'job' else None, q.get('id') if q.get('type') == 'job' else None):
                if ref and ref not in job_ids:
                    errs.append(f'bond {b.get("npc")}: no job "{ref}"')
    for where, t in said:
        m = RX_CITY.search(t or '')
        if m:
            errs.append(f'{where}: "{m.group(0)}" talks about the data, not the place: {t[:70]}')
    if errs:
        raise Bad('\n'.join(f'  {city}: {e}' for e in errs))
    life.pop('note', None)
    return json.dumps(life, ensure_ascii=False, separators=(',', ':'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--city')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    if a.city:
        cities = [a.city]
    else:
        live = subprocess.run([os.path.join(ROOT, 'tools', 'live_cities.sh')], capture_output=True, text=True).stdout.split()
        cities = [c for c in live if os.path.exists(os.path.join(ROOT, 'cities', c, 'life.json'))]
    bad = 0
    for c in cities:
        out = os.path.join(ROOT, 'web', 'data', c, 'life.json')
        try:
            text = build(c)
        except Bad as e:
            print(f'FAIL life {c}\n{e}')
            bad += 1
            continue
        old = open(out, encoding='utf-8').read() if os.path.exists(out) else None
        if a.check:
            if old != text:
                print(f'FAIL life {c}: web/data/{c}/life.json is stale (python pipeline/life.py --city {c})')
                bad += 1
        elif old != text:
            with open(out, 'w', encoding='utf-8') as f:
                f.write(text)
            print(f'life {c}: {len(text) / 1024:.1f} kB')
    # which maps have one: the game asks for a map's life.json only if it is listed (web/data/life.json)
    idx = os.path.join(ROOT, 'web', 'data', 'life.json')
    have = sorted(c for c in os.listdir(os.path.join(ROOT, 'web', 'data')) if os.path.exists(os.path.join(ROOT, 'web', 'data', c, 'life.json')))
    text = json.dumps({'maps': have})
    old = open(idx).read() if os.path.exists(idx) else None
    if old != text:
        if a.check:
            print('FAIL life: web/data/life.json is stale (python pipeline/life.py)')
            bad += 1
        else:
            open(idx, 'w').write(text)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
