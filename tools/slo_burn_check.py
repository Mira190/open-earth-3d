#!/usr/bin/env python3
"""The burn-rate alerts of tools/slo_report.py on made-up logs, with no browser (run by tools/telemetry_check.js).

    python3 tools/slo_burn_check.py

A healthy week must fire nothing; a bad deploy whose loads fail for the last hour must page; a slower
leak of failures over six hours must open a ticket but not page; a burst that ended an hour ago must not
fire (the short window has cleared); one bad load in a quiet hour must not fire (too few samples); and
the 7-day judgement, the stages and the release table must still come out. Exits 1 on a failure.
"""
import os
import random
import subprocess
import sys
import tempfile
import json
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
NOW = datetime(2026, 11, 7, 12, 0, tzinfo=timezone.utc)
fails = []


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:%S.000Z')


def page(t, sid, app='0.1.40', ok=True, ms=6000, fps=55, err=False, device='desktop'):
    """One page load that opens a model: its view, its load (with stages), a piece of play time."""
    base = {'v': 3, 'sid': sid, 'device': device, 'tier': 'high', 'app': app, 'view': 'city', 'city': 'sydney'}
    evs = [{'event': 'view', 'props': dict(base)},
           {'event': 'load', 'props': dict(base, ok=ok, ms=ms, **({'fetch_ms': ms * 0.5, 'decode_ms': ms * 0.6, 'frame_ms': ms * 0.9} if ok else {'why': 'error'}))}]
    if ok:
        evs.append({'event': 'time', 'props': dict(base, s=60, fps=fps, slow=0.01, frames=3000, inp=80)})
    if err:
        evs.append({'event': 'error', 'props': dict(base, kind='script', msg='x')})
    return [dict(e, vid=f'v{sid}', got=iso(t), ts=iso(t)) for e in evs]


def week(bad=lambda t: False, app=lambda t: '0.1.40'):
    rnd = random.Random(7)
    out, t, i = [], NOW - timedelta(days=7), 0
    while t < NOW:
        out += page(t, f's{i}', app=app(t), ok=not bad(t), ms=rnd.uniform(3000, 9000))
        t += timedelta(minutes=2)
        i += 1
    return out


def run(events, label):
    with tempfile.NamedTemporaryFile('w', suffix='.jsonl', delete=False) as f:
        for e in events:
            f.write(json.dumps(e) + '\n')
    p = subprocess.run([sys.executable, os.path.join(HERE, 'slo_report.py'), f.name, '--json', '--now', iso(NOW)], capture_output=True, text=True)
    os.unlink(f.name)
    try:
        return json.loads(p.stdout), p.returncode
    except ValueError:
        fails.append(label)
        print(f'FAIL {label}: no report ({p.stderr[-300:]})')
        return None, p.returncode


def must(ok, what, got=''):
    print(f"{'ok  ' if ok else 'FAIL'} {what}{f' ({got})' if got != '' else ''}")
    if not ok:
        fails.append(what)


def sev(r, sid='load_success'):
    return sorted({a['severity'] for a in r['alerts'] if a['id'] == sid})


r, code = run(week(), 'healthy')
must(r and not r['alerts'] and code == 0, 'a healthy week fires nothing', r and r['alerts'])
must(r and r['load_stages'].get('city desktop', {}).get('decoded') is not None, 'the load stages come out', r and r['load_stages'])

# a bad deploy: every load fails from 40 minutes ago, on the new release
dep = NOW - timedelta(minutes=40)
r, code = run(week(bad=lambda t: t >= dep, app=lambda t: '0.1.41' if t >= dep else '0.1.40'), 'deploy')
must(r and 'page' in sev(r) and code == 1, 'a bad deploy pages within the hour', r and sev(r))
rel = r and r['releases']
must(rel and list(rel)[0] == '0.1.41' and rel['0.1.41']['loads'] == 0 and rel['0.1.40']['load_p75_s'], 'the release table puts the new release first', rel and list(rel)[:2])

# a slow leak: one load in eight fails for the last six hours (6x the 2% budget... 12.5% / 1% = 12.5x)
leak = NOW - timedelta(hours=6)
r, code = run(week(bad=lambda t: t >= leak and int(t.timestamp() / 120) % 8 == 0), 'leak')
must(r and sev(r) == ['ticket'], 'a slow leak opens a ticket, not a page', r and sev(r))

# a burst that ended: every load failed from 3 h to 2 h ago; the short windows are clean now
r, code = run(week(bad=lambda t: NOW - timedelta(hours=3) <= t < NOW - timedelta(hours=2)), 'ended')
must(r and 'page' not in sev(r), 'a burst that has ended does not page', r and sev(r))

# one bad load in a quiet hour: too few samples
quiet = [e for e in week() if e['got'] < iso(NOW - timedelta(hours=7))] + page(NOW - timedelta(minutes=3), 'q1', ok=False)
r, code = run(quiet, 'quiet')
must(r and not sev(r), 'one bad load in a quiet hour fires nothing', r and sev(r))
must(r and all(s['budget_spent'] is not None for s in r['slo'] if s['n']), 'each level says how much of its budget is spent')

print(f"burn check: {'all passed' if not fails else f'{len(fails)} failed'}")
sys.exit(1 if fails else 0)
