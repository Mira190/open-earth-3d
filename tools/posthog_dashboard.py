#!/usr/bin/env python3
"""Build (or bring up to date) the site's PostHog dashboard: visitors, play time and the service levels.

    POSTHOG_PERSONAL_API_KEY=phx_... python3 tools/posthog_dashboard.py            # create or update
    POSTHOG_PERSONAL_API_KEY=phx_... python3 tools/posthog_dashboard.py --check    # run each query, change nothing
    POSTHOG_PERSONAL_API_KEY=phx_... python3 tools/posthog_dashboard.py --alerts   # and the alerts (ALERTS) on their insights

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


def releases(days):
    """The levels by deployed version (every event carries "app"): a regression points to the release that brought it."""
    w = f'timestamp > now() - INTERVAL {days} DAY'
    ok3 = f"event = 'load' AND toString(properties.ok) = 'true' AND {D3}"
    q75 = lambda f, extra='': f"round(quantileIf(0.75)(toFloat(properties.{f}), {ok3}{extra}) / 1000, 1)"
    return ("SELECT app, page_loads, loads_3d, load_p75_desktop_s, load_p75_mobile_s, fetched_s, decoded_s, built_s, first_frame_s, "
            "round(100 * crashes / page_loads, 2) AS crash_pct, round(100 * err_pages / page_loads, 2) AS script_error_pct, "
            "round(100 * lost_pages / page_loads, 2) AS gl_lost_pct, fps_median, slow_frames_pct, first_seen FROM ("
            "SELECT coalesce(nullIf(toString(properties.app), ''), '?') AS app, count(DISTINCT if(event != 'crash', properties.sid, NULL)) AS page_loads, "
            f"countIf({ok3}) AS loads_3d, {q75('ms', " AND properties.device = 'desktop'")} AS load_p75_desktop_s, "
            f"{q75('ms', " AND properties.device IN ('phone', 'tablet')")} AS load_p75_mobile_s, "
            f"{q75('fetch_ms')} AS fetched_s, {q75('decode_ms')} AS decoded_s, {q75('build_ms')} AS built_s, {q75('frame_ms')} AS first_frame_s, "
            "countIf(event = 'crash') AS crashes, count(DISTINCT if(event = 'error' AND properties.kind IN ('script', 'promise'), properties.sid, NULL)) AS err_pages, "
            "count(DISTINCT if(event = 'gl_lost', properties.sid, NULL)) AS lost_pages, "
            f"quantileIf(0.5)(toFloat(properties.fps), event = 'time' AND properties.fps IS NOT NULL AND {D3}) AS fps_median, "
            f"round(100 * sumIf(toFloat(properties.slow) * toFloat(properties.frames), event = 'time' AND properties.frames IS NOT NULL AND {D3}) "
            f"/ nullIf(sumIf(toFloat(properties.frames), event = 'time' AND properties.frames IS NOT NULL AND {D3}), 0), 2) AS slow_frames_pct, "
            f"min(timestamp) AS first_seen FROM events WHERE {OURS} AND {w} GROUP BY app) WHERE page_loads > 0 ORDER BY first_seen DESC LIMIT 30")


def stages(days):
    """Where a load's time goes: p75 of each stage (s from the view's start) by view and device (telemetry v3)."""
    w = f'timestamp > now() - INTERVAL {days} DAY'
    q = lambda f: f"round(quantile(0.75)(toFloat(properties.{f})) / 1000, 1)"
    return (f"SELECT properties.view AS view, if(properties.device = 'desktop', 'desktop', 'phone/tablet') AS device, count() AS loads, "
            f"{q('fetch_ms')} AS fetched_s, {q('decode_ms')} AS decoded_s, {q('build_ms')} AS built_s, {q('frame_ms')} AS first_frame_s, {q('ms')} AS ready_s "
            f"FROM events WHERE event = 'load' AND toString(properties.ok) = 'true' AND toInt(properties.v) >= 3 AND {w} "
            "GROUP BY view, device ORDER BY view, device")


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


OK = [{'key': 'ok', 'value': ['true'], 'operator': 'exact', 'type': 'event'}]
DESK = [{'key': 'device', 'value': ['desktop'], 'operator': 'exact', 'type': 'event'}]
MOB = [{'key': 'device', 'value': ['phone', 'tablet'], 'operator': 'exact', 'type': 'event'}]
SCRIPT = [{'key': 'kind', 'value': ['script', 'promise'], 'operator': 'exact', 'type': 'event'}]
V3 = [{'key': 'v', 'value': 3, 'operator': 'gte', 'type': 'event'}]

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
    # release comparison (issue 298): every event carries the deployed version as "app"
    ('Release comparison, last 30 days', 'By deployed version (newest first): page loads, load p75 by device and each load stage (s), pages that died, '
     'page loads with a script error or a lost WebGL context (%), median fps and slow frames (%).', sql(releases(30))),
    ('Load stages p75 by view and device, last 7 days', 'Seconds from the view\'s start to its data fetched, decoded, scene built, first frame and the loader gone '
     '(the title screen: textures in, decoded, first frame, opening drawn).', sql(stages(7))),
    ('Load time p75 by release (s)', 'Model, game and reef loads that became ready, by the deployed version.',
     trends([ev('load', 'p75', 'ms', OK + THREE_D, 'Load ms')], breakdown='app', formula='A / 1000')),
    ('Load stages p75 (s)', 'Model, game and reef loads: data fetched, decoded, scene built, first frame, ready.',
     trends([ev('load', 'p75', f, OK + THREE_D + V3, n) for f, n in (('fetch_ms', 'Fetched'), ('decode_ms', 'Decoded'), ('build_ms', 'Built'), ('frame_ms', 'First frame'), ('ms', 'Ready'))],
            formula=None)),
    ('Frame rate (median fps) by release', 'The median frame rate of play pieces in the 3D views, by deployed version.',
     trends([ev('time', 'median', 'fps', THREE_D, 'fps')], breakdown='app')),
    ('Script errors per 100 page loads by release', 'Script errors and unhandled rejections ÷ page loads (one "page" event each), by deployed version.',
     trends([ev('error', props=SCRIPT, name='Errors'), ev('page', name='Page loads')], breakdown='app', formula='100 * A / B')),
    ('Pages that died per 100 page loads by release', 'Crash reports ÷ page loads, by the version of the page that reported them.',
     trends([ev('crash', name='Died'), ev('page', name='Page loads')], breakdown='app', formula='100 * A / B')),
    # the insights the alerts watch (ALERTS): no breakdown, one series, the SLO's line as the bound
    ('Alert: load time p75, desktop (s)', 'Watched by an alert: over 10 s on a day (the SLO line; judged on any number of loads).',
     trends([ev('load', 'p75', 'ms', OK + THREE_D + DESK, 'Load ms')], formula='A / 1000', date_from='-14d')),
    ('Alert: load time p75, phone and tablet (s)', 'Watched by an alert: over 20 s on a day.',
     trends([ev('load', 'p75', 'ms', OK + THREE_D + MOB, 'Load ms')], formula='A / 1000', date_from='-14d')),
    ('Alert: loader errors per hour', 'Watched by an alert: any model, game or reef loader showing its error.',
     trends([ev('load', props=[{'key': 'ok', 'value': ['false'], 'operator': 'exact', 'type': 'event'},
                               {'key': 'why', 'value': ['error'], 'operator': 'exact', 'type': 'event'}] + THREE_D, name='Loader errors')],
            date_from='-48h', interval='hour')),
    ('Alert: pages that died on screen per day', 'Watched by an alert: two or more a day (a tab crash or an out-of-memory kill, reported by the next page load).',
     trends([ev('crash', name='Died')], date_from='-14d')),
    ('Alert: script errors per hour', 'Watched by an alert: more than five script errors or unhandled rejections in an hour.',
     trends([ev('error', props=SCRIPT, name='Errors')], date_from='-48h', interval='hour')),
    ('Alert: play time under 30 fps (%), daily', 'Watched by an alert: over 10% of a day\'s play time in the 3D views below 30 fps '
     '(the smoothness SLO\'s line; an upper bound, so a day without visitors, which reads 0, does not fire).',
     trends([ev('time', 'sum', 's', THREE_D + [{'key': 'fps', 'value': 30, 'operator': 'lt', 'type': 'event'}], 'Seconds under 30 fps'),
             ev('time', 'sum', 's', THREE_D + [{'key': 'fps', 'operator': 'is_set', 'value': 'is_set', 'type': 'event'}], 'Seconds')],
            formula='100 * A / B', date_from='-14d')),
]

# PostHog alerts (on trends insights only; the HogQL scorecard cannot carry one): the insight, the interval it
# is checked at, and the bounds outside which it fires. The key's owner is subscribed (email and in-app).
# The free plan allows five alerts, so these are the five fast signals; the play time under 30 fps keeps its
# insight, and every level, smoothness included, is watched by the burn-rate job (.github/workflows/slo.yml).
ALERTS = [
    ('Load time p75, desktop over 10 s', 'Alert: load time p75, desktop (s)', 'daily', None, 10),
    ('Load time p75, phone and tablet over 20 s', 'Alert: load time p75, phone and tablet (s)', 'daily', None, 20),
    ('A loader showed its error', 'Alert: loader errors per hour', 'hourly', None, 0),
    ('Two or more pages died on screen in a day', 'Alert: pages that died on screen per day', 'daily', None, 1),
    ('More than five script errors in an hour', 'Alert: script errors per hour', 'hourly', None, 5),
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
    ap.add_argument('--alerts', action='store_true', help='also create or update the alerts (ALERTS) on their insights')
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
    ids = {}
    for name, desc, q in INSIGHTS:
        body = {'name': name, 'description': desc, 'query': q, 'saved': True}
        if name in have:
            on = set(have[name].get('dashboards') or []) | {dash['id']}
            api.call('PATCH', f"/api/projects/{pid}/insights/{have[name]['id']}/", dict(body, dashboards=sorted(on)))
            ids[name] = have[name]['id']
            print(f'updated  {name}')
        else:
            ids[name] = api.call('POST', f'/api/projects/{pid}/insights/', dict(body, dashboards=[dash['id']]))['id']
            print(f'made     {name}')
    print(f"{HOST}/project/{pid}/dashboard/{dash['id']}")
    if a.alerts:
        alerts(api, pid, ids)


def alerts(api, pid, ids):
    """Create or update each alert of ALERTS (found by name), subscribing the owner of the key."""
    me = api.call('GET', '/api/users/@me/')['id']
    have = {x['name']: x for x in api.all(f'/api/projects/{pid}/alerts/?limit=100')}
    for name, insight, every, lower, upper in ALERTS:
        bounds = {k: v for k, v in (('lower', lower), ('upper', upper)) if v is not None}
        body = {'name': name, 'insight': ids[insight], 'enabled': True, 'calculation_interval': every,
                'condition': {'type': 'absolute_value'}, 'threshold': {'configuration': {'type': 'absolute', 'bounds': bounds}},
                'config': {'type': 'TrendsAlertConfig', 'series_index': 0, 'check_ongoing_interval': upper is not None}}
        if name in have:
            subs = sorted({u['id'] if isinstance(u, dict) else u for u in have[name].get('subscribed_users') or []} | {me})
            api.call('PATCH', f"/api/projects/{pid}/alerts/{have[name]['id']}/", dict(body, subscribed_users=subs))
            print(f'updated  alert {name}')
        else:
            api.call('POST', f'/api/projects/{pid}/alerts/', dict(body, subscribed_users=[me]))
            print(f'made     alert {name}')
    for name in sorted(set(have) - {a[0] for a in ALERTS}):
        print(f'note     alert {name} is in PostHog but not in ALERTS (left as it is)')


if __name__ == '__main__':
    main()
