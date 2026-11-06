# Observability: visitors, play time and service levels

The site is static (GitHub Pages), so it has no server logs. Every page loads `web/telemetry.js` first. The
script watches the page from outside and sends a few small events in batches. The game and renderer
code does not change for it.

## What is measured

| Event | When | Main fields |
|---|---|---|
| `view` | the page opens, or the hash changes to the globe, a city's model (`#<id>`), its game (`#play-<id>`), or a reef site (`reef/?city=<id>`) | `view`, `city`, `first`, `new_visitor` |
| `load` | the view's loader fades (`ok: true`), shows its error (`why: "error"`), or the visitor leaves first (`why: "left"` / `"closed"`) | `ok`, `ms` (from the hash change; the page's first view counts from the navigation itself) |
| `time` | the tab is put away, the view changes, the page closes, and every 5 minutes | `s` (seconds on screen and ready since the last one), `fps` (median), `slow` (share of frames over 50 ms), `frames` |
| `page` | once per page load | `ttfb`, `fcp`, `dom` (ms) |
| `error` | a script error, an unhandled rejection or a resource that failed (5 per page at most) | `kind`, `msg`, `src` |
| `gl_lost` | a WebGL context is lost, except in the seconds after a view stops and gives its context up | |

Every event carries a random visitor id (`oe3d-vid` in localStorage), a page-load id (`sid`), the device
class (phone / tablet / desktop from the pointer and screen size), the quality tier (`web/quality.js`),
WebGL 2 and software-renderer flags, WebGPU support, the viewport, the language, the referring site and
the deployed version.

**Play time** is the sum of `time.s` in the game and reef views. The time is sent in pieces, so a phone
that kills a tab without a `pagehide` loses at most the last piece.

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

The report also lists unique visitors (in total and by day), new visitors, views by kind and city, play
time (in total, the median and p90 per player, and by city), devices, tiers, referrers, the main load
failures and the main errors. It exits 1 when a judged level misses its target, so it can run on a
schedule.

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

- **SLO scorecard** (the last 7 days): each of the seven levels with its value, number of samples and
  MET / MISS. A level is judged once it has 20 samples.
- **Visitors and play time** (the last 30 days): visitors, new visitors, page loads, views, players,
  play hours, and play minutes per player (median and p90).
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
  - lost WebGL contexts.

Every insight filters out events with `view = test`, which the setup checks send.

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
  - the game saves where the player stands when the page closes.

## Prior art

- [PostHog](https://posthog.com/docs/api/capture) capture API (the hosted destination; MIT-licensed
  open source).
- [GoatCounter](https://www.goatcounter.com/) and [Plausible](https://plausible.io/) (cookieless page
  counting) shaped the privacy defaults. They count pages, not values such as load time or frame rate,
  so they cannot carry the SLOs.
- The SLO style follows Google's *Site Reliability Workbook*: a ratio of good events to all events,
  with a target and a window.
- The frame-time measure follows the Web Vitals idea of measuring what the visitor sees. A frame over
  50 ms is the long-frame threshold of the Long Animation Frames API.
