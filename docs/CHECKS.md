# The checks, in two tiers

`tools/check.sh` is the one command that decides whether work may land. It used to play every live
city's game for any change to the shared code, on the machine of whoever was landing: about two
hours, and main had usually moved by the end, so the round started again. This page is how that wait
was taken apart, what runs where now, and what was measured on the way.

## Where the two hours went

The wait was a product of four things, and each had its own cause.

| Factor | What it was | Why |
|---|---|---|
| What a change selects | Any file under `web/game/`, `web/assets/` or `web/*.js` selected every live city (ten) | Chosen by path, and almost every branch touches `web/game/game.js` (37 commits in one week) |
| What one check costs | A city's game, clip, memory and tour checks one after the other: 7 minutes for a small map, 15 for Sydney, up to 35 for Shibuya | The game check is some 260 steps of one long scenario in a real browser on a software renderer |
| How many run at once | Three, on the four cores of the landing session's machine | The cities are independent, but they shared one machine |
| How often it is run again | Often more than once | Landing only fast-forwards main, and main moved within two hours; and the traffic steps are unsteady, so a round could fail on a step that passes the next time |

The last row matters as much as the others. Three runs of Sydney's game check on the same tree failed
on three different steps (a level crossing, a car backing out of a one-way street, a junction's
standing traffic). A two-hour round that fails on a step unrelated to the change costs another round.

## What runs where now

**Before landing: the fast tier (about ten minutes).** Plain `tools/check.sh`:

- the static checks, which open no browser (packs, voice, daily life, fishing data, visibility,
  solids, compressed models, signs): a minute;
- every city and reef site whose own files changed (`cities/<id>/`, `web/data/<id>/`), in full;
- for a change to the shared code, the smoke cities instead of every live city (`CHECK_SMOKE`,
  default `sydney:game,tour shibuya:mem`): of the live maps, Sydney plays the whole game check
  and its guided tour (a quarter of an hour), and Shibuya, the heaviest map on a phone, is measured
  against the memory budget; Shibuya's and Tokyo's game checks, half an hour each, play on main after landing;
- the title screen, the loader's hand-over and the telemetry when their files changed, as before.

**After landing: the full tier, on main, in GitHub Actions** (`.github/workflows/checks.yml`). Each
push to main runs `CHECK_TIER=full tools/check.sh --plan` against the commit of the last run that
passed and gives every target it prints its own runner: `sydney:game`, `sydney:clip,mem,tour`, each
reef site, `title`, `loader`, `telemetry`, `static`. Thirty-two runners start together when the
shared code changed. Nobody waits for it.

- One run at a time. Pushes that arrive while it goes wait as one: the next run covers all of them,
  because it compares with the last pass, not with the push before.
- A failure opens an issue labelled `main-red` (or comments on the open one) with the shards that
  failed, links to their logs and stills, and the commits since the last pass. The next pass closes
  it. Until then every run checks everything changed since the last pass, so a fix is confirmed by
  the run its own push starts.
- Reproduce a shard with its name: `tools/check.sh shibuya:game`.

Main can therefore be red for half an hour where it could not before. That is the trade: the cost of
finding a break moved from every landing (two hours, always) to the landings that break something
(an issue, sometimes).

## Unsteady steps

A change that breaks something breaks the same step every time. So when a city's game or clip check
fails, it is run a second time, and the run fails only on a step that failed both times, or on a run
that ended without naming a step (a crash, a timeout). Two runs with no failed step in common print
`FLAKY` and pass. On main, each `FLAKY` line is added to the issue labelled `check-flaky`: a step
that is named there often is the one to make steady (the lockstep work, issue 243, is the cure;
this is the bookkeeping).

Since #420 the game check plays the same game in every run (docs/GAME.md, "the test"): the traffic's trips,
the dispatch's tie-breaks and the talk draw from seeded runs, the date is pinned (the weather is a hash of it),
Play is pressed once the title card is up whatever the load took (#423), and nothing a held frame does steps the
world. A failed step therefore fails the second run too, and the second run is there for what the simulation
doesn't decide: a renderer that crashed, a timeout. A `FLAKY` line now means something still lets the machine
into the run: `DIGEST=2` writes a digest after every step of the world, and the first one two runs disagree on
names the step. `tools/game_soak.sh` runs every live city's check a few times, three at a time, and says per
city whether every run played the same game.

## The command

```
tools/check.sh                      # the fast tier, for what this branch changed
tools/check.sh --plan               # the targets that would run, one a line
tools/check.sh sydney:game          # one kind of one city's checks (game, clip, mem, tour)
tools/check.sh sydney:clip,mem      # two kinds
tools/check.sh static               # the checks that open no browser
CHECK_TIER=full tools/check.sh      # every live city for a shared change, as it was
CHECK_BASE=<commit> tools/check.sh  # what changed since that commit
CHECK_STATIC=0 tools/check.sh ...   # without the static checks (a runner's shard)
```

A change to one of the checks' own scripts selects only its kind: `tools/tour_check.js` the tours,
`tools/mem_check.js` the memory, `tools/game_check.js` and the `tools/*_step.js` it loads the game.

## Measured

On GitHub's runners (four cores, Mesa's llvmpipe under Xvfb, one shard a runner), the first full run
of every target, 13 November 2026:

| Shard | Time, with a minute and a half of setup |
|---|---|
| A reef site | 1.5 min |
| `static` | 1.5 min |
| `clip,mem,tour` of a city | 4 to 14 min |
| `loader`, `telemetry`, `title` | 4 to 7.5 min |
| `game` of a small map (Tetsugaku, Kamakura) | 5 to 6.5 min |
| `game` of a large one (Kyoto, Shibuya, Queenstown) | 13 to 15 min |
| `game` that failed once and ran again | 11 to 34 min |
| The whole run, every target | 29 and 34 min |

In both runs the game check failed its first pass in about half of the ten cities, on steps of the
traffic, and the code was main's. Run again, most of them passed or failed on another step. In the
second run two steps failed twice in a row: cars backing out of a one-way street to the junction
behind (Sydney), and a ride that had not arrived (Fushimi Inari).

On a session's machine, the game check alone: Tetsugaku 7 minutes with another city beside it,
Sydney 9 alone and 15 with one beside it.

Two things were measured and found not to be the cost, so nothing was built for them:

- **Drawing.** The frames the page draws while the check holds the world do not slow the simulation:
  `advance(30)` took 2.0 s in Tetsugaku and 4.4 s in Sydney with the frames drawn and with them
  stopped. Skipping the draw would save nothing.
- **One slow step.** Sydney's 529 s are spread over 256 lines; the longest gap is 61 s (the NPCs'
  characters loading) and only seven are over 20 s. There is no step to remove that would halve it.

## What is next

- The logic the game check asserts through a browser (junction cycles, queues, routes, the daily
  life's ranks) run without one: `web/game/junctions.js`, `cars.js`, `nav.js` and `route.js` touch
  `window` and `document` in a handful of places each, and the world already steps a thirtieth of a
  second at a time under a harness. Those steps then cost milliseconds and can run in the fast tier
  for every city.
- `web/game/game.js` (6,300 lines, some 200 names on `window.__game`) split by responsibility, so
  that a change to the trains selects the maps with a railway and two branches stop meeting in one
  file.

## What was adopted

The shape is the common one for a repository with expensive end-to-end tests: a short presubmit and
a full postsubmit that reports rather than blocks (Google's TAP and Chromium's commit queue are the
published descriptions), with the postsubmit split by target across machines (a GitHub Actions
matrix). No code was taken from either.
