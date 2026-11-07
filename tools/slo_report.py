#!/usr/bin/env python3
"""Visitors, play time and the service levels, from the telemetry log (tools/telemetry_server.py).

    python3 tools/slo_report.py telemetry.jsonl            # a report on the terminal
    python3 tools/slo_report.py telemetry.jsonl --days 7   # the last week only
    python3 tools/slo_report.py telemetry.jsonl --json     # the same numbers as JSON
    POSTHOG_PERSONAL_API_KEY=phx_... python3 tools/slo_report.py --posthog --days 7   # the events from PostHog

The service levels and their targets are defined in docs/OBSERVABILITY.md; SLOS below is the same
table. Exits 1 when a level with enough data misses its target, so it can run on a schedule.
"""
import argparse
import json
import os
import sys
import time
from collections import Counter, defaultdict

LOADING = ('city', 'game', 'reef')
ABANDON_S = 20          # leaving a loader before this is a change of mind, not a failure
MIN_N = 20              # fewer samples than this: shown, not judged

SLOS = [
    # id, what, target, how it reads
    ('load_success', 'Views whose 3D scene loads', 0.99, 'ge'),
    ('load_p75_desktop', 'Load time p75, desktop (s)', 10.0, 'le'),
    ('load_p75_mobile', 'Load time p75, phone and tablet (s)', 20.0, 'le'),
    ('smooth', 'Play time at 30 fps or better', 0.90, 'ge'),
    ('slow_frames', 'Frames slower than 50 ms', 0.05, 'le'),
    ('error_free', 'Page loads without a script error', 0.99, 'ge'),
    ('gl_kept', 'Page loads without a lost WebGL context', 0.995, 'ge'),
    ('crash_free', 'Page loads that did not die on screen', 0.995, 'ge'),
    ('inp_p75', 'Slowest interaction per page load, p75 (ms)', 200.0, 'le'),
]
LEFT_SOON_S = 60        # a page that ends this soon after the tour's end card: the visitor watched the tour and went
def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    lo = int(k)
    return xs[lo] + (xs[min(lo + 1, len(xs) - 1)] - xs[lo]) * (k - lo)


def read_posthog(days):
    """The site's events of the last days from PostHog (HogQL), in the collector's form."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from posthog_dashboard import API, OURS
    key = os.environ.get('POSTHOG_PERSONAL_API_KEY')
    if not key:
        sys.exit('POSTHOG_PERSONAL_API_KEY is not set')
    api = API(key)
    pid = os.environ.get('POSTHOG_PROJECT') or api.call('GET', '/api/projects/@current/')['id']
    # keyset pagination on the timestamp (PostHog refuses OFFSET with a personal key); events that share the
    # last timestamp of a page come again on the next, and are kept once by their uuid
    out, seen, page, last = [], set(), 20000, None
    while True:
        after = f"AND timestamp >= toDateTime64('{last}', 6, 'UTC') " if last else ''
        q = (f"SELECT uuid, event, timestamp, distinct_id, properties FROM events WHERE {OURS} "
             f"AND timestamp > now() - INTERVAL {int(float(days or 7) * 86400)} SECOND {after}ORDER BY timestamp LIMIT {page}")
        res = api.call('POST', f'/api/projects/{pid}/query/', {'query': {'kind': 'HogQLQuery', 'query': q}}).get('results') or []
        fresh = 0
        for uid, ev, ts, vid, props in res:
            if uid in seen:
                continue
            seen.add(uid)
            fresh += 1
            if isinstance(props, str):
                try:
                    props = json.loads(props)
                except ValueError:
                    props = {}
            t = ts if isinstance(ts, str) else str(ts)
            out.append({'event': ev, 'got': t, 'ts': t, 'vid': vid, 'props': props or {}})
        if len(res) < page or not fresh:
            return out
        last = str(res[-1][2]).replace('T', ' ').replace('Z', '').split('+')[0]


def read(path, days):
    since = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - days * 86400)) if days else ''
    out = []
    with open(path) as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if since and (e.get('got') or '') < since:
                continue
            e['props'] = e.get('props') or {}
            out.append(e)
    return out


def report(events):
    r = {}
    visitors = {e['vid'] for e in events if e['vid']}
    sessions = {e['props'].get('sid') for e in events if e['props'].get('sid')}
    by_day = defaultdict(set)
    for e in events:
        by_day[(e.get('got') or '')[:10]].add(e['vid'])
    views = [e for e in events if e['event'] == 'view']
    r['visitors'] = len(visitors)
    r['new_visitors'] = len({e['vid'] for e in views if e['props'].get('new_visitor')})
    r['page_loads'] = len(sessions)
    r['views'] = len(views)
    r['visitors_by_day'] = {d: len(v) for d, v in sorted(by_day.items())}
    r['views_by_kind'] = dict(Counter(e['props'].get('view', '') for e in views))
    r['views_by_city'] = dict(Counter(e['props'].get('city') for e in views if e['props'].get('city')).most_common())
    r['devices'] = dict(Counter(e['props'].get('device', '') for e in views))
    r['tiers'] = dict(Counter(e['props'].get('tier', '') for e in views))
    r['referrers'] = dict(Counter(e['props'].get('ref') for e in views if e['props'].get('ref')).most_common(10))

    # time on screen, by view; play time is the game's and the reef sites'
    times = [e for e in events if e['event'] == 'time']
    secs = defaultdict(float)
    play_by_vid = defaultdict(float)
    play_by_city = defaultdict(float)
    for e in times:
        s = float(e['props'].get('s') or 0)
        k = e['props'].get('view', '')
        secs[k] += s
        if k in ('game', 'reef'):
            play_by_vid[e['vid']] += s
            play_by_city[e['props'].get('city', '')] += s
    r['seconds_by_view'] = {k: round(v) for k, v in secs.items()}
    r['play_hours'] = round(sum(play_by_vid.values()) / 3600, 2)
    r['players'] = len(play_by_vid)
    r['play_minutes_median'] = round((pct(list(play_by_vid.values()), 0.5) or 0) / 60, 1)
    r['play_minutes_p90'] = round((pct(list(play_by_vid.values()), 0.9) or 0) / 60, 1)
    r['play_minutes_by_city'] = {k: round(v / 60, 1) for k, v in sorted(play_by_city.items(), key=lambda x: -x[1])}

    # the service levels
    loads = [e for e in events if e['event'] == 'load' and e['props'].get('view') in LOADING]
    ok = [e for e in loads if e['props'].get('ok')]
    bad = [e for e in loads if not e['props'].get('ok') and (e['props'].get('why') == 'error' or (e['props'].get('ms') or 0) >= ABANDON_S * 1000)]
    lv = {}
    lv['load_success'] = (len(ok) / (len(ok) + len(bad)) if ok or bad else None, len(ok) + len(bad))
    desk = [e['props']['ms'] / 1000 for e in ok if e['props'].get('device') == 'desktop' and e['props'].get('ms') is not None]
    mob = [e['props']['ms'] / 1000 for e in ok if e['props'].get('device') in ('phone', 'tablet') and e['props'].get('ms') is not None]
    lv['load_p75_desktop'] = (pct(desk, 0.75), len(desk))
    lv['load_p75_mobile'] = (pct(mob, 0.75), len(mob))
    timed = [e for e in times if e['props'].get('fps') is not None and e['props'].get('view') in LOADING]
    tot = sum(float(e['props'].get('s') or 0) for e in timed)
    good = sum(float(e['props'].get('s') or 0) for e in timed if e['props']['fps'] >= 30)
    nfr = sum(e['props'].get('frames') or 0 for e in timed)
    slow = sum((e['props'].get('slow') or 0) * (e['props'].get('frames') or 0) for e in timed)
    lv['smooth'] = (good / tot if tot else None, len(timed))
    lv['slow_frames'] = (slow / nfr if nfr else None, len(timed))
    errs = {e['props'].get('sid') for e in events if e['event'] == 'error' and e['props'].get('kind') in ('script', 'promise')}
    lost = {e['props'].get('sid') for e in events if e['event'] == 'gl_lost'}
    n = len(sessions)
    lv['error_free'] = (1 - len(errs & sessions) / n if n else None, n)
    lv['gl_kept'] = (1 - len(lost & sessions) / n if n else None, n)
    # a page that ended on screen (reported by the next page load) and how fast the page answers input
    crashes = [e for e in events if e['event'] == 'crash']
    lv['crash_free'] = (1 - len(crashes) / n if n else None, n)
    worst = defaultdict(float)
    for e in times:
        worst[e['props'].get('sid')] = max(worst[e['props'].get('sid')], float(e['props'].get('inp') or 0))
    lv['inp_p75'] = (pct(list(worst.values()), 0.75), len(worst))
    r.update(behaviour(events))
    r['crashes'] = dict(Counter(f"{e['props'].get('prev_view')}:{e['props'].get('prev_city') or ''} {e['props'].get('prev_spot') or ''}".strip() for e in crashes).most_common(10))
    r['load_failures'] = dict(Counter(' '.join(str(x) for x in (e['props'].get('why'), e['props'].get('view'), e['props'].get('city')) if x) for e in bad).most_common(10))
    r['top_errors'] = dict(Counter(f"{e['props'].get('msg')} @ {e['props'].get('src')}" for e in events if e['event'] == 'error').most_common(10))
    r['slo'] = []
    for sid, what, target, how in SLOS:
        val, cnt = lv[sid]
        met = None if val is None or cnt < MIN_N else (val >= target if how == 'ge' else val <= target)
        r['slo'].append({'id': sid, 'what': what, 'target': target, 'op': '>=' if how == 'ge' else '<=', 'value': val, 'n': cnt, 'met': met})
    r['load_stages'] = stage_report(events)
    r['releases'] = releases(events)
    return r


def stage_report(events):
    """Where a load's time goes: p75 of each stage (s) by view and device, from the v3 load events."""
    G = defaultdict(lambda: defaultdict(list))
    for e in events:
        p = e['props']
        if e['event'] != 'load' or not p.get('ok') or p.get('ms') is None:
            continue
        k = f"{p.get('view')} {'desktop' if p.get('device') == 'desktop' else 'phone/tablet'}"
        G[k]['ready'].append(p['ms'] / 1000)
        for st, f in (('fetched', 'fetch_ms'), ('decoded', 'decode_ms'), ('built', 'build_ms'), ('frame', 'frame_ms')):
            if p.get(f) is not None:
                G[k][st].append(p[f] / 1000)
    return {k: {'n': len(v['ready']), **{st: round(pct(xs, 0.75), 2) for st, xs in v.items() if xs}} for k, v in sorted(G.items())}


def vkey(v):
    try:
        return tuple(int(x) for x in str(v).split('.'))
    except ValueError:
        return (-1, str(v))


def releases(events):
    """The levels by deployed version (the "app" property): a regression points to the release that brought it."""
    R = defaultdict(lambda: {'sids': set(), 'err': set(), 'lost': set(), 'crash': 0, 'loads': [], 'fps': [], 'frames': 0, 'slow': 0.0})
    for e in events:
        p = e['props']
        r = R[p.get('app') or '?']
        if p.get('sid') and e['event'] != 'crash':
            r['sids'].add(p['sid'])
        if e['event'] == 'error' and p.get('kind') in ('script', 'promise'):
            r['err'].add(p.get('sid'))
        elif e['event'] == 'gl_lost':
            r['lost'].add(p.get('sid'))
        elif e['event'] == 'crash':
            r['crash'] += 1
        elif e['event'] == 'load' and p.get('ok') and p.get('view') in LOADING and p.get('ms') is not None:
            r['loads'].append(p['ms'] / 1000)
        elif e['event'] == 'time' and p.get('view') in LOADING and p.get('fps') is not None:
            r['fps'].append(p['fps'])
            r['frames'] += p.get('frames') or 0
            r['slow'] += (p.get('slow') or 0) * (p.get('frames') or 0)
    out = {}
    for v in sorted(R, key=vkey, reverse=True):
        r, n = R[v], len(R[v]['sids'])
        out[v] = {'page_loads': n, 'loads': len(r['loads']), 'load_p75_s': round(pct(r['loads'], 0.75), 2) if r['loads'] else None,
                  'crash_rate': round(r['crash'] / n, 4) if n else None, 'error_rate': round(len(r['err'] & r['sids']) / n, 4) if n else None,
                  'gl_lost_rate': round(len(r['lost'] & r['sids']) / n, 4) if n else None,
                  'fps_median': pct(r['fps'], 0.5), 'slow_frames': round(r['slow'] / r['frames'], 4) if r['frames'] else None}
    return out


def place(p):
    return f"{p.get('view', '')}{':' + p['city'] if p.get('city') else ''}"


def behaviour(events):
    """Where visitors stay, where they leave, and what the tour and the game's first minutes do to that."""
    r = {}
    # time by spot: the dwell events (seconds since the last "time", by spot and mode)
    dwell = defaultdict(float)
    eng = [0.0, 0.0]
    for e in events:
        p = e['props']
        if e['event'] == 'dwell':
            dwell[f"{place(p)} · {p.get('spot')} ({p.get('mode')})"] += float(p.get('s') or 0)
        elif e['event'] == 'time' and p.get('view') in LOADING and p.get('eng_s') is not None:
            eng[0] += float(p.get('eng_s') or 0)
            eng[1] += float(p.get('s') or 0)
    r['minutes_by_spot'] = {k: round(v / 60, 1) for k, v in sorted(dwell.items(), key=lambda x: -x[1])[:20]}
    r['engaged_share'] = round(eng[0] / eng[1], 3) if eng[1] else None

    # each page load in order: its last event says where the visitor left
    pages = defaultdict(list)
    for i, e in enumerate(events):
        if e['props'].get('sid') and e['event'] != 'crash':
            pages[e['props']['sid']].append((e.get('ts') or e.get('got') or '', i, e))
    exits, how, after_tour = Counter(), Counter(), Counter()
    tour = {'model_views': 0, 'started': 0, 'ended': 0, 'reached': Counter()}
    games = {'ready': 0, 'started': 0, 'first_mode': Counter()}
    for sid, evs in pages.items():
        evs.sort(key=lambda x: (x[0], x[1]))
        last = evs[-1][2]['props']
        exits[f"{place(last)} · {last.get('tour') and 'tour ' + last['tour'] or last.get('spot') or '-'}"] += 1
        ex = next((x[2]['props'] for x in evs if x[2]['event'] == 'exit'), None)
        how[('closed' if ex else 'put away or killed') + (', idle' if ex and (ex.get('idle_s') or 0) > 120 else '')] += 1
        # the tour of each model view, and what came after its end
        seq = [x[2] for x in evs]
        for k, e in enumerate(seq):
            p = e['props']
            if e['event'] == 'view' and p.get('view') == 'city':
                tour['model_views'] += 1
                rest = seq[k + 1:]
                stop = next((j for j, x in enumerate(rest) if x['event'] == 'view'), len(rest))
                mine = rest[:stop]
                stops = [x['props'].get('stop') or 0 for x in mine if x['event'] == 'tour' and x['props'].get('action') == 'stop']
                if stops:
                    tour['started'] += 1
                    tour['reached'][max(stops)] += 1
                end = next((x for x in mine if x['event'] == 'tour' and x['props'].get('action') == 'end'), None)
                if end:
                    tour['ended'] += 1
                    nxt = rest[stop] if stop < len(rest) else None
                    if nxt:
                        after_tour['went to ' + nxt['props'].get('view', '?')] += 1
                    else:
                        tail = [x for x in mine if (x.get('ts') or '') >= (end.get('ts') or '')]
                        spent = sum(float(x['props'].get('s') or 0) for x in tail if x['event'] == 'time')
                        after_tour['left within a minute' if spent < LEFT_SOON_S else 'stayed to look, then left'] += 1
            if e['event'] == 'load' and p.get('view') == 'game' and p.get('ok'):
                games['ready'] += 1
            if e['event'] == 'mode' and p.get('view') == 'game' and p.get('start'):
                games['started'] += 1
            if e['event'] == 'mode' and p.get('view') == 'game' and not p.get('start') and p.get('from') == 'foot':
                games['first_mode'][p.get('to')] += 1
    r['exits'] = dict(exits.most_common(15))
    r['page_ends'] = dict(how)
    tour['reached'] = dict(sorted(tour['reached'].items()))
    r['tour'] = tour
    r['after_tour'] = dict(after_tour)
    games['first_mode'] = dict(games['first_mode'])
    r['game'] = games
    views = [e for e in events if e['event'] == 'view']
    r['returning_visitors'] = len({e['vid'] for e in views if (e['props'].get('visit_n') or 1) > 1})
    r['flows'] = dict(Counter(f"{e['props']['from']} -> {place(e['props'])}" for e in views if e['props'].get('from')).most_common(10))
    return r


def show(r):
    print(f"Visitors {r['visitors']} ({r['new_visitors']} new) · page loads {r['page_loads']} · views {r['views']}")
    print(f"Players {r['players']} · play time {r['play_hours']} h · per player median {r['play_minutes_median']} min, p90 {r['play_minutes_p90']} min")
    print('By day:   ' + ', '.join(f'{d} {n}' for d, n in r['visitors_by_day'].items()))
    print('Views:    ' + ', '.join(f'{k} {n}' for k, n in r['views_by_kind'].items()))
    print('Cities:   ' + ', '.join(f'{k} {n}' for k, n in r['views_by_city'].items()))
    print('Play min: ' + ', '.join(f'{k} {n}' for k, n in r['play_minutes_by_city'].items()))
    print('Devices:  ' + ', '.join(f'{k} {n}' for k, n in r['devices'].items()) + ' · tiers ' + ', '.join(f'{k} {n}' for k, n in r['tiers'].items()))
    if r['referrers']:
        print('From:     ' + ', '.join(f'{k} {n}' for k, n in r['referrers'].items()))
    print('\nService levels')
    for s in r['slo']:
        v = s['value']
        val = '—' if v is None else (f'{v:.1f} s' if 'Load time' in s['what'] else f'{v:.0f} ms' if '(ms)' in s['what'] else f'{v * 100:.2f}%')
        tgt = f"{s['target']:.0f} s" if 'Load time' in s['what'] else f"{s['target']:.0f} ms" if '(ms)' in s['what'] else f"{s['target'] * 100:g}%"
        mark = {True: 'MET ', False: 'MISS', None: '  ··'}[s['met']]
        print(f"  {mark}  {s['what']:<44} {val:>9}  target {s['op']} {tgt:<6} (n={s['n']})")
    if r.get('load_stages'):
        print('\nLoad stages, p75 (s from the view\'s start): fetched · decoded · built · first frame · ready')
        for k, v in r['load_stages'].items():
            print(f"  {k:<22} {' · '.join(str(v.get(st, '—')) for st in ('fetched', 'decoded', 'built', 'frame', 'ready'))}  (n={v['n']})")
    if r.get('releases'):
        print('\nBy release: page loads · load p75 · crashes · script errors · lost GL · median fps · slow frames')
        for v, x in list(r['releases'].items())[:8]:
            f = lambda q: '—' if q is None else f'{q * 100:.1f}%'
            print(f"  {v:<10} {x['page_loads']:>5} · {'—' if x['load_p75_s'] is None else str(x['load_p75_s']) + ' s':>7} · {f(x['crash_rate'])} · {f(x['error_rate'])} · {f(x['gl_lost_rate'])} · {x['fps_median'] or '—'} · {f(x['slow_frames'])}")
    print('\nWhere visitors stay (minutes by spot)')
    for k, v in r['minutes_by_spot'].items():
        print(f'  {v:>7}  {k}')
    if r['engaged_share'] is not None:
        print(f"Engaged: {r['engaged_share'] * 100:.0f}% of the time in 3D views had input in the last minute or a tour playing")
    print('\nWhere page loads ended (the last event)')
    for k, v in r['exits'].items():
        print(f'  {v:>5}  {k}')
    print('Ended by: ' + ', '.join(f'{k} {n}' for k, n in r['page_ends'].items()))
    t = r['tour']
    print(f"\nTour: {t['model_views']} model views, {t['started']} started, {t['ended']} ended; furthest stop " + ', '.join(f'{k}: {n}' for k, n in t['reached'].items()))
    if r['after_tour']:
        print('After the tour: ' + ', '.join(f'{k} {n}' for k, n in r['after_tour'].items()))
    g = r['game']
    print(f"Game: {g['ready']} loaded, {g['started']} left the title screen; first ride from on foot " + ', '.join(f'{k} {n}' for k, n in g['first_mode'].items()))
    print(f"Returning visitors {r['returning_visitors']} · flows " + ', '.join(f'{k} {n}' for k, n in r['flows'].items()))
    if r['crashes']:
        print('Pages that died on screen: ' + '; '.join(f'{k} ×{n}' for k, n in r['crashes'].items()))
    if r['load_failures']:
        print('\nLoad failures: ' + '; '.join(f'{k} ×{n}' for k, n in r['load_failures'].items()))
    if r['top_errors']:
        print('Errors: ' + '; '.join(f'{k} ×{n}' for k, n in r['top_errors'].items()))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('log', nargs='?', help='the collector\'s JSON lines (tools/telemetry_server.py)')
    ap.add_argument('--posthog', action='store_true', help='read the events from PostHog instead (POSTHOG_PERSONAL_API_KEY)')
    ap.add_argument('--days', type=float, default=0)
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    if not a.log and not a.posthog:
        ap.error('give a log file or --posthog')
    events = read_posthog(a.days or 7) if a.posthog else read(a.log, a.days)
    r = report(events)
    if a.json:
        print(json.dumps(r, indent=1, default=str))
    else:
        show(r)
    sys.exit(1 if any(s['met'] is False for s in r['slo']) else 0)


if __name__ == '__main__':
    main()
