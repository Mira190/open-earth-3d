# Observability: visitors, play time and service levels

The site is static (GitHub Pages), so it has no server logs. Every page loads `web/telemetry.js` first. The
script watches the page from outside and sends a few small events in batches. The game and renderer
code does not change for it: what the visitor is doing inside a view is read from the handles each view
already exposes (`window.__city`, `window.__game`, `window.__reef`).

## What is measured

| Event | When | Main fields |
|---|---|---|
| `view` | the page opens, or the hash changes to the globe, a city's model (`#<id>`), its game (`#play-<id>`), or a reef site (`reef/?city=<id>`) | `view`, `city`, `first`, `new_visitor`, `visit_n` (page loads in this browser), `days_since` (since the last), `from` / `from_s` (the view before, and its seconds) |
| `load` | the view's loader fades (`ok: true`), shows its error (`why: "error"`), or the visitor leaves first (`why: "left"` / `"closed"`, with what the loader said); the title screen, which has no loader, when the first frame of its opening or menu is drawn | `ok`, `ms` (from the hash change; the page's first view counts from the navigation itself), and the stages (below): `fetch_ms`, `decode_ms`, `build_ms`, `frame_ms` |
| `time` | the tab is put away, the view changes, the page closes, and every 5 minutes | `s` (seconds on screen and ready since the last one), `eng_s` (of those, engaged), `fps` (median), `slow` (share of frames over 50 ms), `frames`, `inp` (the slowest tap or key, ms, if over 40), `heap_mb` (Chromium) |
| `dwell` | with each `time` | `spot`, `mode`, `s`, `eng_s`: the same seconds split by where the visitor was and how they moved |
| `tour` | the model's tour reaches a stop, ends, or is taken over | `action` (`stop` / `end` / `leave`), `stop`, `stops` |
| `mode` | the game leaves its title screen (`start: true`), or the player changes how they move (on foot, car, ride, heli, ferry, rail, photo; at a reef: walk, swim, snorkel, scuba, boat) | `from`, `to` |
| `quest` | the game's tracked quest moves a step, or a quest is done | `action` (`step` / `done`), `from`, `stamps` |
| `exit` | the page closes (`pagehide`) | `page_s`, `view_s`, `views`, `idle_s` (since the last input), `ready`, `tour_max`, `hidden` |
| `crash` | a page load finds that an earlier one of this browser died while on screen | `prev_view`, `prev_city`, `prev_spot`, `prev_mode`, `prev_ready`, `prev_up_s`, `ago_s` |
| `page` | once per page load | `ttfb`, `fcp`, `dom` (ms) |
| `error` | a script error, an unhandled rejection or a resource that failed (5 per page at most) | `kind`, `msg`, `src` |
| `gl_lost` | a WebGL context is lost, except in the seconds after a view stops and gives its context up | |

Every event carries a random visitor id (`oe3d-vid` in localStorage), a page-load id (`sid`), the device
class (phone / tablet / desktop from the pointer and screen size), the quality tier (`web/quality.js`),
WebGL 2 and software-renderer flags, WebGPU support, the viewport, the language, the referring site and
the deployed version.

Every event also carries where the visitor is in the view, once the view is ready: `spot`, `mode`, and in
the model viewer `tour` (`3/8` while stop 3 of 8 plays, `left 3/8` once the visitor took the view over
there, `done` after the end card) and in the game `quest`. So the last event of a page load says where the
visitor left, even when a phone kills the tab without an `exit`.

**Play time** is the sum of `time.s` in the game and reef views. The time is sent in pieces, so a phone
that kills a tab without a `pagehide` loses at most the last piece.

### Load stages

`load.ms` alone does not say where a slow load spends its time, so each `load` (since telemetry version 3)
also carries the time from the same start to each stage the page reached:

| Field | Mark | Model and game (`web/world.js`, `web/city.js`, `web/game/game.js`) | Reef sites (`web/reef/`) | Title screen (`web/title.js`, `web/earth.js`) |
|---|---|---|---|---|
| `fetch_ms` | `oe:fetched` | every data file downloaded | the terrain downloaded | the Earth's textures downloaded |
| `decode_ms` | `oe:decoded` | the packs decoded and the JSON parsed | the terrain and imagery decoded | the textures decoded and sent to the GPU |
| `build_ms` | `oe:built` | the scene built, before its shaders compile | the scene and its modules built | — |
| `frame_ms` | `oe:frame` | the first frame drawn | the first frame drawn | the first frame (the stars, while the Earth loads) |
| `ms` | (the loader) | the loader goes | the loader goes | `oe:ready`: the first frame of the opening or the menu |

The pages set the marks with `performance.mark('oe:<stage>', { detail: { view, city } })`, so they work
without the telemetry and show in a browser's performance panel; `web/telemetry.js` reads the last mark of
each stage since the view started (a mark naming another view, one left while it loaded, does not count).
The stages add fields to the one `load` event and no events of their own. A failed or abandoned load
carries the stages it reached, which says where it stuck.

The first measurements (software WebGL on the check machine) put almost all of a model's or game's load
between `decode_ms` and `frame_ms` (fetched and decoded in under a second, the first frame at 18 to 26 s): building
the scene and compiling its shaders, not the download. Real devices will tell the same or not in the
**Load stages** insights of the PostHog dashboard.

## Where visitors stay and where they leave

The sampler reads the view once a second while it is ready and on screen:

| View | `spot` | `mode` |
|---|---|---|
| Model (`__city`) | `tour <n>: <stop title>` while the tour plays; else the named place nearest the point the camera looks at (within 400 m), or `free look` | `tour`, `free`, `orbit` (plus `panel`, the open tab) |
| Game (`__game`) | `title screen`; else the neighbourhood (`game.json` `areas`), else the nearest landmark, travel point, wharf or trig within 300 m, else `streets` | the player's mode: `foot`, `car`, `ride`, `heli`, `ferry`, `rail`, or `photo`; `menu` on the title |
| Reef (`__reef`) | the nearest point of interest within 150 m, else `open water` or `shore` | `walk`, `swim`, `snorkel`, `scuba`, `boat` (plus `depth`) |

**Engaged** time is time with a tap, click, key or wheel in the last minute, or with a tour, arrival or
camera move playing. A tab left open on a game counts in `s` but not in `eng_s`.

**A page that died on screen.** While the page is visible it keeps a small note in localStorage
(`oe3d-alive-<sid>`, refreshed every 5 s) and removes it when the tab is put away or the page closes. A
note older than 30 s that is still there when the site next opens means the page ended without closing:
the browser or its GPU process crashed, or the system killed it for memory. The next page load sends a
`crash` with where it was. A tab killed in the background is normal and is not counted.

The report and the dashboard answer:

- **Where do visitors stay?** Minutes by city, spot and mode, with the share engaged.
- **Where do they leave?** The last event of each page load, grouped by view, city and spot or tour stop;
  and how the page ended (closed, closed after 2 minutes idle, or put away and never back).
- **Do they watch the tour and go?** Per city: model views, tours started, the share of stops seen, end
  cards reached, and after the end card whether the visitor opened the game, stayed to look, or left
  within a minute (`LEFT_SOON_S`).
- **Do they play?** Games loaded, title screens left, the first car, helicopter and ride, quest steps and
  quests done; and the flows between views (globe → model → game).
- **Do they come back?** Returning visitors (`visit_n` > 1).

## Service levels

`tools/slo_report.py` computes these values. A level with fewer than 20 samples is shown but not judged.

| SLO | Target | Definition |
|---|---|---|
| Load success | ≥ 99% | city, game and reef views that become ready ÷ (ready + loader errors + visitors who waited 20 s or more and left) |
| Load time, desktop | p75 ≤ 10 s | `load.ms` of ready views on desktop |
| Load time, phone and tablet | p75 ≤ 20 s | the same on touch devices |
| Smoothness | ≥ 90% | share of play time in pieces whose median frame rate is 30 fps or better |
| Slow frames | ≤ 5% | frames over 50 ms ÷ all frames, in the 3D views |
| Error-free page loads | ≥ 99% | page loads with no script error or unhandled rejection |
| WebGL kept | ≥ 99.5% | page loads with no lost WebGL context |
| No crash on screen | ≥ 99.5% | 1 − `crash` reports ÷ page loads |
| Interaction latency | p75 ≤ 200 ms | per page load, the slowest tap or key (Event Timing; none over 40 ms counts as 0); the INP "good" line |

The report also lists unique visitors (in total and by day), new visitors, views by kind and city, play
time (in total, the median and p90 per player, and by city), devices, tiers, referrers, the main load
failures and the main errors, the load stages (p75 of each by view and device) and the levels by release
(`app`). It reads the collector's log, or with `--posthog` the last `--days` (7) of events from PostHog
(`POSTHOG_PERSONAL_API_KEY`, a key with query read access). It exits 1 when a judged level misses its
target or an error budget burns too fast, so it can run on a schedule.

### Error budgets and burn rate

Each level is judged over the whole window (7 days). Its **error budget** is what the target lets go wrong:
1 − target for a share that must be high (1% of loads for load success), the target itself for one that
must be low (5% of frames), and a quarter of the samples for a p75 (a p75 under 10 s means at most a quarter
of the loads over 10 s). The report gives the share of each budget spent (over 100% is a miss).

A 7-day judgement notices a bad deploy days late, so the report also watches how fast each budget burns,
with the multiwindow, multi-burn-rate alerts of the *Site Reliability Workbook* (chapter 5, "Alerting on
SLOs"). The burn rate is the share that went wrong in a window over the budget: 1 spends the budget exactly
over the judged window, 14.4 spends it 14.4 times as fast.

| Severity | Long window | Short window | Burn rate | Spends of the week's budget |
|---|---|---|---|---|
| page | 1 h | 5 min | ≥ 14.4 | 9% in an hour |
| ticket | 6 h | 30 min | ≥ 6 | 21% in six hours |

Both windows must be over the rate: the long one says the burn matters, the short one that it is still
going on, so an alert stops soon after the fix. A long window with fewer than 10 samples (`MIN_BURN_N`) does
not fire, so one bad load in a quiet hour is not an alert. The rates are the Workbook's; against a 7-day
window rather than its 30 days they fire on a smaller share of the budget, which suits a site whose
traffic comes in bursts. `tools/slo_burn_check.py` tests the rules on made-up logs: a healthy week fires
nothing, a bad deploy pages within the hour, a slow leak opens a ticket and does not page, a burst that has
ended does not page, and one bad load in a quiet hour does not fire.

### Alerting

Two routes, because PostHog's alerts watch a single trend against a fixed bound and cannot express a burn rate:

- **PostHog alerts** (live): five alerts on the dashboard's *Alert:* insights, checked by PostHog and sent
  by email and in the app to the owner of the key that made them (`tools/posthog_dashboard.py --alerts`,
  `ALERTS`). The free plan allows five, so they are the fast signals:

  | Alert | Insight | Checked | Fires when |
  |---|---|---|---|
  | Load time p75, desktop over 10 s | Alert: load time p75, desktop (s) | daily | over 10 s |
  | Load time p75, phone and tablet over 20 s | Alert: load time p75, phone and tablet (s) | daily | over 20 s |
  | A loader showed its error | Alert: loader errors per hour | hourly | any |
  | Two or more pages died on screen in a day | Alert: pages that died on screen per day | daily | 2 or more |
  | More than five script errors in an hour | Alert: script errors per hour | hourly | more than 5 |

  They judge any number of samples (PostHog has no minimum), so with little traffic one slow visit can fire
  the load alerts. The *Alert: play time under 30 fps (%), daily* insight has no alert (the plan's limit);
  smoothness is watched by the scheduled job. Each bound is an upper one, so a day without visitors, which
  reads 0, does not fire.
- **The SLO watch** (`.github/workflows/slo.yml`, off until turned on): every 15 minutes it runs
  `tools/slo_report.py --posthog --days 7`, and when a level misses over the week or a burn-rate rule
  fires it opens an issue labelled `slo` (titled `SLO page:` for a page) with the report, or comments on
  the open one when what fires has changed. It closes nothing. To turn it on, store a PostHog personal API
  key with query and project read access as the repository secret `POSTHOG_PERSONAL_API_KEY`, and set the
  repository variable `SLO_ALERTS` to `on`. The 5-minute window of the page rule is only as fresh as the
  15-minute schedule (and GitHub delays scheduled runs at busy times), so a page can come up to about 20
  minutes after the burn starts.

## Privacy

- The script sets no cookies and does no fingerprinting. Its only stored value is the random visitor
  id. The JSONL collector does not log IP addresses.
- The script sends nothing when Do Not Track or Global Privacy Control is on, when `?telemetry=off` is
  in the URL, or when the browser is automated (the checks in `tools/`).
- `CONFIG` in `web/telemetry.js` sends the events to the project's PostHog EU Cloud project. The `phc_`
  key there is PostHog's public capture key: it can write events but cannot read them. To stop sending
  events, empty `CONFIG.endpoint`.

## Where the events go

`CONFIG` at the top of `web/telemetry.js` chooses the destination:

- **PostHog** (`format: 'posthog'`, `endpoint: 'https://eu.i.posthog.com/batch/'`, `key: 'phc_…'`): the
  hosted option, and the one in use (EU Cloud). The free tier covers 1M events a month, and the project key is public by design.
  Events go through the `/batch/` capture API with `$process_person_profile: false`, so they stay
  anonymous. PostHog's insights show unique users, sums of `s` and percentiles of `ms` and `fps`.
- **Self-hosted** (`format: 'jsonl'`, `endpoint: 'https://<your host>/e'`): run
  `python3 tools/telemetry_server.py --port 8890 --out telemetry.jsonl` behind HTTPS. It uses only the
  standard library, writes one JSON line per event and keeps no IP. Then run
  `python3 tools/slo_report.py telemetry.jsonl --days 7` (`--json` gives the same numbers as JSON).

Beacons use `navigator.sendBeacon` with a `text/plain` body, so no CORS preflight is needed. When
sendBeacon is unavailable or refuses the batch, the script falls back to `fetch` with `keepalive`.

## The PostHog dashboard

`tools/posthog_dashboard.py` builds the dashboard *Open Earth 3D: visitors and service levels* in the
project and keeps it up to date. It finds the dashboard and each insight by name, so you can run it again
after changing a query. Run it with `POSTHOG_PERSONAL_API_KEY` set to a personal key that has insight and
dashboard write access; `--check` runs each query and changes nothing. The dashboard has:

- **SLO scorecard** (the last 7 days): each of the nine levels with its value, number of samples and
  MET / MISS. A level is judged once it has 20 samples.
- **Visitors and play time** (the last 30 days): visitors, new visitors, page loads, views, players,
  play hours, and play minutes per player (median and p90).
- **Where visitors stay**, **Where page loads end**, **Tour funnel by city** and **The game's first
  minutes by city** (the last 30 days): the tables of the section above.
- Trends:
  - unique visitors per day;
  - play time per day, and by city;
  - views by city, and by kind;
  - load time p75 by device;
  - load success;
  - median fps by tier;
  - devices;
  - referrers;
  - errors by message;
  - lost WebGL contexts;
  - pages that died on screen, by view;
  - returning visitors;
  - engaged play, by view.

- **Release comparison** (issue 298): every event carries the deployed version (`app`, `web/version.json`),
  so a regression points to the release that brought it:
  - *Release comparison, last 30 days*: a table by version, newest first: page loads, load p75 on desktop
    and on phones and tablets, p75 of each load stage, pages that died, page loads with a script error or a
    lost WebGL context (%), median fps and slow frames (%);
  - *Load time p75 by release (s)*, *Frame rate (median fps) by release*, *Script errors per 100 page loads
    by release* and *Pages that died per 100 page loads by release*: the same as trends, a line a version;
  - *Load stages p75 by view and device, last 7 days* (a table) and *Load stages p75 (s)* (a trend of the
    five stages).
- **Alert insights** (*Alert: …*): one series each, for the PostHog alerts (see Alerting, above).

Every insight filters out events with `view = test`, which the setup checks send.

To recreate all of it in a new project: `POSTHOG_PERSONAL_API_KEY=phx_… python3 tools/posthog_dashboard.py
--alerts` (a personal key with insight, dashboard and alert write access and project read access;
`POSTHOG_HOST` for another region). The script finds the dashboard, the insights and the alerts by name and
updates them in place. In the project in use (EU Cloud, project 337415) the dashboard is
*Open Earth 3D: visitors and service levels*.

## Testing

- `?telemetry=debug` logs each batch to the console.
- On localhost, `?telemetry=<url>` sends JSONL to that collector, even from an automated browser.
- `tools/telemetry_check.js` (run by `tools/check.sh` when the telemetry, the router or the game
  changes, or with `tools/check.sh telemetry`) checks the following on Sydney:
  - an automated browser sends nothing by default;
  - the globe, model and game views arrive, and both loads arrive ready with their times;
  - play time and frame rate are counted, and the page timings arrive;
  - every event has its session, device and tier;
  - the report can be built from the log;
  - the game saves where the player stands when the page closes;
  - the model's tour reports each stop and its end, and later events say it was watched to the end;
  - the game reports leaving its title screen, its spot and mode on every play event, time on foot by
    spot, and engaged time;
  - the page's `exit`, the view each view came from, and a dead page left by an earlier visit reported
    once as a `crash`;
  - the load stages: the title screen's load (once, with its textures and first frame before ready), and the
    model's, the game's and a reef site's (Hardy Reef) with data fetched, decoded, built and first frame, in
    order and within `ms`;
  - the report's stages, burn rates and releases, and `tools/slo_burn_check.py` (the burn-rate rules on
    made-up logs).

## Prior art

- [PostHog](https://posthog.com/docs/api/capture) capture API (the hosted destination; MIT-licensed
  open source).
- [GoatCounter](https://www.goatcounter.com/) and [Plausible](https://plausible.io/) (cookieless page
  counting) shaped the privacy defaults. They count pages, not values such as load time or frame rate,
  so they cannot carry the SLOs.
- The SLO style follows Google's *Site Reliability Workbook*: a ratio of good events to all events,
  with a target and a window; the error budgets and the multiwindow, multi-burn-rate alerts follow its
  chapter 5, "Alerting on SLOs" (sre.google/workbook/alerting-on-slos), with its 14.4 and 6 rates.
- The load stages use the W3C [User Timing](https://www.w3.org/TR/user-timing/) marks (Level 3 for
  `detail`), as the web-vitals library and Lighthouse's user timings read them; the release table follows
  Sentry's release health, which compares crash-free sessions and timings by release.
- [PostHog alerts](https://posthog.com/docs/alerts) watch the alert insights (an absolute bound on a trend,
  checked hourly or daily).
- The behaviour events follow the *design events* of game analytics (GameAnalytics, Unity Analytics):
  progression steps and where in the world time goes, with a heat map's idea reduced to named spots so
  no position leaves the browser.
- The dead-page report follows Sentry's and Firebase Crashlytics' release health, where a session that
  never ends cleanly counts as crashed or abnormal; a browser cannot report its own crash, so the next
  page load does.
- Interaction latency uses the [Event Timing API](https://www.w3.org/TR/event-timing/) that INP is built
  on (Chromium and Firefox; Safari 18.2 and later).
- The frame-time measure follows the Web Vitals idea of measuring what the visitor sees. A frame over
  50 ms is the long-frame threshold of the Long Animation Frames API.
