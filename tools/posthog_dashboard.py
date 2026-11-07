#!/usr/bin/env python3
"""Build (or bring up to date) the site's PostHog dashboard: visitors, play time and the service levels.

    POSTHOG_PERSONAL_API_KEY=phx_... python3 tools/posthog_dashboard.py            # create or update
    POSTHOG_PERSONAL_API_KEY=phx_... python3 tools/posthog_dashboard.py --check    # run each query, change nothing

The dashboard and each insight are found by name, so running it again updates them in place. The SLOs
and their targets are those of docs/OBSERVABILITY.md and tools/slo_report.py. The events come from
web/telemetry.js. A personal API key needs insight and dashboard write access and project read access.
Standard library only.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

HOST = os.environ.get('POSTHOG_HOST', 'https://eu.posthog.com')
DASHBOARD = 'Open Earth 3D: visitors and service levels'
OURS = "event IN ('view', 'load', 'time', 'page', 'error', 'gl_lost', 'dwell', 'tour', 'mode', 'quest', 'exit', 'crash') AND coalesce(toString(properties.view), '') != 'test'"
D3 = "properties.view IN ('city', 'game', 'reef')"
NOT_TEST = [{'key': 'view', 'value': ['test'], 'operator': 'is_not', 'type': 'event'}]
PLAY = [{'key': 'view', 'value': ['game', 'reef'], 'operator': 'exact', 'type': 'event'}]
THREE_D = [{'key': 'view', 'value': ['city', 'game', 'reef'], 'operator': 'exact', 'type': 'event'}]


ORD = iter(range(1, 100))


def slo_row(name, target, value, met, unit):
    """One row of the scorecard: value and n from a subquery, judged once n reaches 20."""
    return (f"SELECT {next(ORD)} AS ord, '{name}' AS slo, '{target}' AS target, if(v IS NULL, '—', concat(toString(round(v, 2)), '{unit}')) AS value, n AS samples, "
            f"multiIf(n < 20, 'not enough data', {met}, 'MET', 'MISS') AS status FROM ({value})")


def scorecard(days):
    w = f'timestamp > now() - INTERVAL {days} DAY'
    rows = [
        slo_row('Load success', '>= 99%',
                f"SELECT 100 * ok / nullIf(ok + bad, 0) AS v, ok + bad AS n FROM (SELECT countIf(toString(properties.ok) = 'true') AS ok, "
                f"countIf(toString(properties.ok) = 'false' AND (toString(properties.why) = 'error' OR toFloat(properties.ms) >= 20000)) AS bad "
                f"FROM events WHERE event = 'load' AND {D3} AND {w})", 'v >= 99', '%'),
        slo_row('Load time p75, desktop', '<= 10 s',
                f"SELECT quantile(0.75)(toFloat(properties.ms)) / 1000 AS v, count() AS n FROM events WHERE event = 'load' "
                f"AND toString(properties.ok) = 'true' AND properties.device = 'desktop' AND {D3} AND {w}", 'v <= 10', ' s'),
        slo_row('Load time p75, phone and tablet', '<= 20 s',
                f"SELECT quantile(0.75)(toFloat(properties.ms)) / 1000 AS v, count() AS n FROM events WHERE event = 'load' "
                f"AND toString(properties.ok) = 'true' AND properties.device IN ('phone', 'tablet') AND {D3} AND {w}", 'v <= 20', ' s'),
        slo_row('Play time at 30 fps or better', '>= 90%',
                f"SELECT 100 * sumIf(toFloat(properties.s), toFloat(properties.fps) >= 30) / nullIf(sum(toFloat(properties.s)), 0) AS v, count() AS n "
                f"FROM events WHERE event = 'time' AND properties.fps IS NOT NULL AND {D3} AND {w}", 'v >= 90', '%'),
        slo_row('Frames slower than 50 ms', '<= 5%',
                f"SELECT 100 * sum(toFloat(properties.slow) * toFloat(properties.frames)) / nullIf(sum(toFloat(properties.frames)), 0) AS v, count() AS n "
                f"FROM events WHERE event = 'time' AND properties.frames IS NOT NULL AND {D3} AND {w}", 'v <= 5', '%'),
        slo_row('Page loads without a script error', '>= 99%',
                f"SELECT 100 * (1 - count(DISTINCT if(event = 'error' AND properties.kind IN ('script', 'promise'), properties.sid, NULL)) / nullIf(count(DISTINCT properties.sid), 0)) AS v, "
                f"count(DISTINCT properties.sid) AS n FROM events WHERE {OURS} AND {w}", 'v >= 99', '%'),
        slo_row('Page loads without a lost WebGL context', '>= 99.5%',
                f"SELECT 100 * (1 - count(DISTINCT if(event = 'gl_lost', properties.sid, NULL)) / nullIf(count(DISTINCT properties.sid), 0)) AS v, "
                f"count(DISTINCT properties.sid) AS n FROM events WHERE {OURS} AND {w}", 'v >= 99.5', '%'),
        slo_row('Page loads that did not die on screen', '>= 99.5%',
                f"SELECT 100 * (1 - countIf(event = 'crash') / nullIf(count(DISTINCT properties.sid), 0)) AS v, count(DISTINCT properties.sid) AS n "
                f"FROM events WHERE {OURS} AND {w}", 'v >= 99.5', '%'),
        slo_row('Slowest interaction per page load, p75', '<= 200 ms',
                f"SELECT quantile(0.75)(m) AS v, count() AS n FROM (SELECT properties.sid AS sid, max(coalesce(toFloat(properties.inp), 0)) AS m "
                f"FROM events WHERE event = 'time' AND toInt(properties.v) >= 2 AND {w} GROUP BY sid)", 'v <= 200', ' ms'),
    ]
    return 'SELECT slo, target, value, samples, status FROM (\n' + '\nUNION ALL\n'.join(rows) + '\n) ORDER BY ord'


def engagement(days):
    w = f'timestamp > now() - INTERVAL {days} DAY'
    return (
        "SELECT a.visitors AS visitors, a.new_visitors AS new_visitors, a.page_loads AS page_loads, a.views AS views, "
        "b.players AS players, round(b.hours, 1) AS play_hours, round(b.med / 60, 1) AS play_min_median, round(b.p90 / 60, 1) AS play_min_p90 FROM "
        f"(SELECT 1 AS k, count(DISTINCT distinct_id) AS visitors, count(DISTINCT if(event = 'view' AND toString(properties.new_visitor) = 'true', distinct_id, NULL)) AS new_visitors, "
        f"count(DISTINCT properties.sid) AS page_loads, countIf(event = 'view') AS views FROM events WHERE {OURS} AND {w}) AS a "
        "JOIN "
        "(SELECT 1 AS k, count() AS players, sum(t) / 3600 AS hours, quantile(0.5)(t) AS med, quantile(0.9)(t) AS p90 FROM "
        f"(SELECT distinct_id, sum(toFloat(properties.s)) AS t FROM events WHERE event = 'time' AND properties.view IN ('game', 'reef') AND {w} GROUP BY distinct_id)) AS b "
        "ON a.k = b.k")


def dwell(days):
    w = f'timestamp > now() - INTERVAL {days} DAY'
    return ("SELECT properties.city AS city, properties.view AS view, properties.spot AS spot, properties.mode AS mode, "
            "round(sum(toFloat(properties.s)) / 60, 1) AS minutes, round(100 * sum(toFloat(properties.eng_s)) / nullIf(sum(toFloat(properties.s)), 0)) AS engaged_pct, "
            f"count(DISTINCT distinct_id) AS visitors FROM events WHERE event = 'dwell' AND {w} GROUP BY city, view, spot, mode ORDER BY minutes DESC LIMIT 60")


def exits(days):
    # the last event of each page load is where the visitor left; how it ended comes from the exit event, if any
    w = f'timestamp > now() - INTERVAL {days} DAY'
    return ("SELECT view, city, where_left, count() AS page_loads, round(median(page_s)) AS median_page_s, countIf(closed) AS closed_tab, countIf(idle_s > 120) AS idle_2min FROM ("
            "SELECT properties.sid AS sid, argMax(toString(properties.view), timestamp) AS view, argMax(toString(properties.city), timestamp) AS city, "
            "argMax(if(properties.tour IS NOT NULL AND properties.view = 'city', concat('tour ', toString(properties.tour)), coalesce(toString(properties.spot), '-')), timestamp) AS where_left, "
            "max(if(event = 'exit', toFloat(properties.page_s), NULL)) AS page_s, max(if(event = 'exit', toFloat(properties.idle_s), NULL)) AS idle_s, countIf(event = 'exit') > 0 AS closed "
            f"FROM events WHERE {OURS} AND event != 'crash' AND toInt(properties.v) >= 2 AND {w} GROUP BY sid) "
            "GROUP BY view, city, where_left ORDER BY page_loads DESC LIMIT 40")


def tour_funnel(days):
    # per page load and city: the furthest stop, whether the end card came up, and what happened next
    w = f'timestamp > now() - INTERVAL {days} DAY'
    return ("SELECT city, count() AS model_views, countIf(furthest > 0) AS started, round(avg(if(furthest > 0, furthest / stops, NULL)) * 100) AS avg_pct_seen, "
            "countIf(is_ended) AS ended, countIf(is_ended AND is_played) AS then_played, countIf(is_ended AND NOT is_played AND after_s < 60) AS left_within_1min FROM ("
            "SELECT properties.sid AS sid, properties.city AS city, "
            "maxIf(toFloat(properties.stop), event = 'tour' AND properties.action = 'stop') AS furthest, max(toFloat(properties.stops)) AS stops, "
            "countIf(event = 'tour' AND properties.action = 'end') > 0 AS is_ended, "
            "countIf(event = 'view' AND properties.from = concat('city:', toString(properties.city)) AND properties.view = 'game') > 0 AS is_played, "
            "sumIf(toFloat(properties.s), event = 'time' AND properties.view = 'city' AND properties.tour = 'done') AS after_s "
            f"FROM events WHERE event IN ('view', 'tour', 'time') AND toInt(properties.v) >= 2 AND {w} GROUP BY sid, city) "
            "WHERE city != '' AND (furthest > 0 OR is_played) GROUP BY city ORDER BY model_views DESC")


def first_minutes(days):
    w = f'timestamp > now() - INTERVAL {days} DAY'
    return ("SELECT properties.city AS city, countIf(event = 'load' AND toString(properties.ok) = 'true') AS loaded, "
            "countIf(event = 'mode' AND toString(properties.start) = 'true') AS started, "
            "countIf(event = 'mode' AND properties.from = 'foot' AND properties.to = 'car') AS took_car, "
            "countIf(event = 'mode' AND properties.to = 'heli') AS flew, countIf(event = 'mode' AND properties.to IN ('ferry', 'rail', 'ride')) AS rode, "
            "countIf(event = 'quest' AND properties.action = 'step') AS quest_steps, countIf(event = 'quest' AND properties.action = 'done') AS quests_done "
            f"FROM events WHERE event IN ('load', 'mode', 'quest') AND properties.view = 'game' AND {w} GROUP BY city ORDER BY loaded DESC")


def trends(series, display='ActionsLineGraph', breakdown=None, date_from='-30d', interval='day', formula=None, props=None):
    src = {'kind': 'TrendsQuery', 'series': series, 'interval': interval, 'dateRange': {'date_from': date_from},
           'properties': props if props is not None else NOT_TEST, 'filterTestAccounts': False,
           'trendsFilter': {'display': display}}
    if formula:
        src['trendsFilter']['formula'] = formula
    if breakdown:
        src['breakdownFilter'] = {'breakdown': breakdown, 'breakdown_type': 'event', 'breakdown_limit': 25}
    return {'kind': 'InsightVizNode', 'source': src}


def ev(event, math='total', prop=None, props=None, name=None):
    e = {'kind': 'EventsNode', 'event': event, 'name': name or event, 'math': math}
    if prop:
        e['math_property'] = prop
    if props:
        e['properties'] = props
    return e


def sql(q):
    return {'kind': 'DataTableNode', 'source': {'kind': 'HogQLQuery', 'query': q}}


INSIGHTS = [
    ('SLO scorecard, last 7 days', 'The nine service levels of docs/OBSERVABILITY.md: value, samples, met or missed (judged from 20 samples).', sql(scorecard(7))),
    ('Visitors and play time, last 30 days', 'Unique visitors, new visitors, page loads, views; players, play hours, minutes per player (median, p90).', sql(engagement(30))),
    ('Where visitors stay, last 30 days', 'Minutes by city, view, spot (tour stop, neighbourhood or nearest landmark) and mode (on foot, car, heli, ferry...), with the share engaged.', sql(dwell(30))),
    ('Where page loads end, last 30 days', 'The last event of each page load: the view, the city and the spot or tour stop; median page time and how many closed the tab or had been idle 2 min.', sql(exits(30))),
    ('Tour funnel by city, last 30 days', 'Model views whose tour started, the share of stops seen, the end card reached, then played the game or left within a minute.', sql(tour_funnel(30))),
    ('The game\'s first minutes by city, last 30 days', 'Games loaded, title screen left, first car, helicopter and ride, quest steps and quests done.', sql(first_minutes(30))),
    ('Unique visitors per day', 'Distinct visitor ids (a random id in localStorage) that opened any view.', trends([ev('view', 'dau', name='Visitors')])),
    ('Play time per day (hours)', 'Seconds on screen and ready in the game and reef views, summed.',
     trends([ev('time', 'sum', 's', PLAY, 'Play seconds')], formula='A / 3600')),
    ('Play time by city (hours, 30 days)', 'Where the play time goes.',
     trends([ev('time', 'sum', 's', PLAY, 'Play seconds')], 'ActionsBarValue', 'city', formula='A / 3600')),
    ('Views by city (30 days)', 'Models, games and reef sites opened.', trends([ev('view', props=THREE_D, name='Views')], 'ActionsBarValue', 'city')),
    ('Views by kind', 'The globe, a model, a game, a reef site.', trends([ev('view', name='Views')], 'ActionsAreaGraph', 'view')),
    ('Load time p75 by device (s)', 'Time from opening a view to its loader fading, for views that loaded.',
     trends([ev('load', 'p75', 'ms', [{'key': 'ok', 'value': ['true'], 'operator': 'exact', 'type': 'event'}] + THREE_D, 'Load ms')], breakdown='device', formula='A / 1000')),
    ('Load success (%)', 'Views that loaded ÷ (loaded + loader errors + visitors who waited 20 s and left).',
     trends([ev('load', props=[{'key': 'ok', 'value': ['true'], 'operator': 'exact', 'type': 'event'}] + THREE_D, name='Loaded'),
             ev('load', props=[{'key': 'ok', 'value': ['false'], 'operator': 'exact', 'type': 'event'},
                               {'key': 'ms', 'value': 20000, 'operator': 'gte', 'type': 'event'}] + THREE_D, name='Failed or abandoned')],
            formula='100 * A / (A + B)')),
    ('Frame rate (median fps) by tier', 'The median frame rate of play pieces, by quality tier.',
     trends([ev('time', 'median', 'fps', THREE_D, 'fps')], breakdown='tier')),
    ('Devices (30 days)', 'Phone, tablet or desktop.', trends([ev('view', 'dau', name='Visitors')], 'ActionsPie', 'device')),
    ('Referrers (30 days)', 'Sites visitors came from.', trends([ev('view', 'dau', props=[{'key': 'ref', 'value': [''], 'operator': 'is_not', 'type': 'event'}], name='Visitors')], 'ActionsBarValue', 'ref')),
    ('Errors by message (7 days)', 'Script errors, unhandled rejections and failed resources.',
     trends([ev('error', name='Errors')], 'ActionsTable', 'msg', date_from='-7d')),
    ('Lost WebGL contexts per day', 'Contexts lost while a view was showing.', trends([ev('gl_lost', name='Lost')])),
    ('Pages that died on screen per day', 'Reported by the next page load: a tab crash or an out-of-memory kill while the page was visible, by the view it died in.',
     trends([ev('crash', name='Died')], breakdown='prev_view')),
    ('Returning visitors per day', 'Visitors whose browser had opened the site before (visit_n > 1).',
     trends([ev('view', 'dau', props=[{'key': 'visit_n', 'value': 1, 'operator': 'gt', 'type': 'event'}], name='Returning')])),
    ('Engaged play (%) by view', 'Share of time on screen with input in the last minute or a tour or camera move playing (not a tab left open).',
     trends([ev('time', 'sum', 'eng_s', THREE_D, 'Engaged s'), ev('time', 'sum', 's', THREE_D + [{'key': 'eng_s', 'operator': 'is_set', 'value': 'is_set', 'type': 'event'}], 'Seconds')],
            breakdown='view', formula='100 * A / B')),
]


class API:
    def __init__(self, key):
        self.key = key
        self.project = None

    def call(self, method, path, body=None):
        req = urllib.request.Request(HOST + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Authorization': f'Bearer {self.key}', 'Content-Type': 'application/json',
                                              'User-Agent': 'open-earth-3d dashboard (https://github.com/Mira190/open-earth-3d)'})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read() or b'null')
        except urllib.error.HTTPError as e:
            raise SystemExit(f'{method} {path}: HTTP {e.code} {e.read()[:400].decode(errors="replace")}')

    def all(self, path):
        out, url = [], path
        while url:
            d = self.call('GET', url)
            out += d.get('results', [])
            url = d.get('next') and d['next'].replace(HOST, '')
        return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--check', action='store_true', help='run each query and print its first rows; change nothing')
    a = ap.parse_args()
    key = os.environ.get('POSTHOG_PERSONAL_API_KEY')
    if not key:
        sys.exit('POSTHOG_PERSONAL_API_KEY is not set')
    api = API(key)
    pid = api.call('GET', '/api/projects/@current/')['id']
    if a.check:
        for name, _, q in INSIGHTS:
            src = q['source']
            r = api.call('POST', f'/api/projects/{pid}/query/', {'query': src})
            res = r.get('results')
            print(f"ok   {name}: {json.dumps(res[:3] if isinstance(res, list) else res, default=str)[:220]}")
        return
    dash = next((d for d in api.all(f'/api/projects/{pid}/dashboards/?limit=200') if d.get('name') == DASHBOARD and not d.get('deleted')), None)
    if not dash:
        dash = api.call('POST', f'/api/projects/{pid}/dashboards/', {'name': DASHBOARD, 'description': 'Visitors, play time, where they stay and leave, and the nine service levels of web/telemetry.js (docs/OBSERVABILITY.md). Built by tools/posthog_dashboard.py.', 'pinned': True})
        print(f"made dashboard {dash['id']}")
    have = {i['name']: i for i in api.all(f'/api/projects/{pid}/insights/?limit=200&saved=true') if i.get('name') and not i.get('deleted')}
    for name, desc, q in INSIGHTS:
        body = {'name': name, 'description': desc, 'query': q, 'saved': True}
        if name in have:
            ids = set(have[name].get('dashboards') or []) | {dash['id']}
            api.call('PATCH', f"/api/projects/{pid}/insights/{have[name]['id']}/", dict(body, dashboards=sorted(ids)))
            print(f'updated  {name}')
        else:
            api.call('POST', f'/api/projects/{pid}/insights/', dict(body, dashboards=[dash['id']]))
            print(f'made     {name}')
    print(f"{HOST}/project/{pid}/dashboard/{dash['id']}")


if __name__ == '__main__':
    main()
