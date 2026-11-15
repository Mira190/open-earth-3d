# The checks

`tools/check.sh` is the one command that decides whether work may land. The project is one story on
one map (Blue Hour, at the Shibuya Scramble; [STORY.md](STORY.md)), so there is one page to check and
the script is short: a set of checks that open no browser, and a handful that open the page.

## The targets

| Target | What it does | Tool |
|---|---|---|
| `static` | Everything that needs no browser, a minute or two together (below) | several |
| `story` | Plays the episode frame by frame to its last card: the street runs, the Stop comes, the afterimage speaks, the photograph is taken (a frame spent only with the lens on the subject), the world runs on, the last card with its two ways on. A still at each beat | `tools/story_play.js` |
| `mem` | Opens the page as an iPhone on the low tier and fails it over the memory budget (peak GPU memory, settled JS heap), so that a phone's tab is not killed | `tools/mem_check.js` |
| `clip` | Measures what passes through what in the free game (`?walk=1`): street furniture in the roads, cars in each other and in posts, people in cars and walls | `tools/clip_check.js` |
| `gl` | Opens the map as an ordinary device does, with the governor's extras shed and multisampling on, and asks every WebGL call for its error; then as a GPU with sixteen texture units, where every material must still be drawn | `tools/gl_error_probe.js`, `tools/sampler_probe.js` |
| `touch` | Plays the free game by touch on a phone's page, where no key can be pressed | `tools/touch_check.js` |
| `astc` | The device-side ASTC encoder (`web/astc.js`) against a real decoder | `tools/astc_check.js` |
| `game` | The free game's long scenario: walk, talk, the helicopter, your car, a taxi, the trains | `tools/game_check.js` |

The static checks:

- what the characters and the story say (`tools/voice_check.py`): locals, not the map's credits;
- the map's lines and quests played to the last stamp without a browser (`tools/goals_check.js`);
- the packs (`buildings.bin`, `landmarks.bin`, `game.bin`, terrain, places, scene, `vis.bin`,
  `skyvis.webp` and the phone's district under `d/`) made from their JSON as it is now, and decoded
  by the browser's decoder to the same values (`pipeline/pack.py --check`, `tools/pack_check.js`);
- the visibility sweep against exact rays (`tools/vis_unit.js`);
- the frame-time governor on modelled devices (`tools/governor_unit.js`);
- the building solids valid on their decimetre grid (`pipeline/solid_rings.py --check`);
- no landmark hanging in the air (`tools/float_check.py`), no sign or screen behind another landmark
  (`tools/sign_clear.py`), no sign that reads mirrored (`tools/sign_check.py`);
- the far crowd's copy of every cast member (`pipeline/crowd_cast.py --check`);
- every shared model meshopt-compressed, and the parts the page loads before and after playable
  as their model splits now (`pipeline/meshopt_glb.mjs --check`, `pipeline/meshopt.py split`).

They need `numpy`, `shapely`, `pyproj`, `pillow` and Node; the browser checks need Playwright's
Chromium (`NODE_PATH` set to where `playwright` is installed, if it is not global).

## What runs when

**Before landing: the fast tier.** Plain `tools/check.sh` looks at what the branch changed against
`origin/main` (after a pass, at what changed since that pass):

- a change to the page or the map (`web/`, `cities/`) runs `static`, `story` and `mem`;
- a change to one of the checks' own tools runs that check;
- a change to the build or the plumbing (`pipeline/`, `blender/`, `tools/`, `.github/`) runs `static`;
- a change to the docs alone runs nothing.

**After landing: the full tier, on main, in GitHub Actions** (`.github/workflows/checks.yml`). Each
push to main runs `CHECK_TIER=full tools/check.sh --plan` against the commit of the last run that
passed, which adds `clip`, `gl` and `touch` for a change to the page, and gives every target it
prints its own runner. Nobody waits for it.

- One run at a time. Pushes that arrive while it goes wait as one: the next run covers all of them,
  because it compares with the last pass, not with the push before.
- A failure opens an issue labelled `main-red` (or comments on the open one) with the shards that
  failed, links to their logs and stills, and the commits since the last pass. The next pass closes it.
- Reproduce a shard with its name: `tools/check.sh clip`.

**By name only: `game`.** `tools/game_check.js` was written for the game before the story: some 260
steps of one scenario, half an hour on a software renderer. Its steps for what was removed (fishing,
the daily life) are gone and it opens the free game, but it has not been run since the cut-back and
steps that expect the old game's fares, phone or ferries may fail. It is in neither tier until it has
been run and trimmed: `tools/check.sh game`.

## The command

```
tools/check.sh                      # the fast tier, for what this branch changed
tools/check.sh --plan               # the targets that would run, one a line
tools/check.sh static               # the checks that open no browser
tools/check.sh story                # one target; several: tools/check.sh story mem
tools/check.sh all                  # static story mem clip gl touch astc
CHECK_TIER=full tools/check.sh      # as main runs it
CHECK_BASE=<commit> tools/check.sh  # what changed since that commit
CHECK_FULL=1 tools/check.sh         # the whole branch, not only what changed since the last pass
CHECK_STATIC=0 tools/check.sh ...   # without the static checks (a runner's shard)
```

Logs and stills go to `$CHECK_OUT` (default `/tmp/oe-check`). The free game's clock is pinned
(`GAME_TIME`, default `2026-11-02T10:00` in Tokyo's time, `tools/pin_clock.js`), so a run does not
depend on the hour it is started at. Under `xvfb-run` (when it is installed) Chromium draws with
Mesa's llvmpipe; without it, headless with SwiftShader. Where `timeout` is missing (macOS) a check
runs for as long as it takes.

## Unsteady steps

A change that breaks something breaks the same step every time. So when the clip or the game check
fails, it is run a second time, and the run fails only on a step that failed both times, or on a run
that ended without naming a step (a crash, a timeout). Two runs with no failed step in common print
`FLAKY` and pass. On main, each `FLAKY` line is added to the issue labelled `check-flaky`: a step
that is named there often is the one to make steady.

The free game plays the same game in every run: the traffic's trips, the dispatch's tie-breaks and
the talk draw from seeded runs, the date is pinned (the weather is a hash of it), and nothing a held
frame does steps the world. `DIGEST=2` writes a digest after every step of the world, and the first
one two runs disagree on names the step (`tools/game_soak.sh`).

## What is not checked

- The story past its first episode: `tools/story_play.js` plays episode one. A new episode adds its
  beats there.
- A real GPU, WebGPU, Safari and iOS: the checks run Chromium on a software renderer.
- What a person sees. For a visual change take stills (`tools/game_shot.js`, `tools/story_play.js`,
  `tools/scramble_shot.js`) on a desktop and a phone, at day, dusk and night, and look at them.

## How it came to this

Until November 2026 the project built some twenty-five maps, and the check played every live one's
game for any change to the shared code: two hours on the landing session's machine. It was split
into a fast tier before landing and a full tier on main afterwards, one runner a target, reporting
rather than blocking (the common shape for a repository with expensive end-to-end tests; Google's
TAP and Chromium's commit queue are the published descriptions, and no code was taken from
either). The two tiers and the `main-red` issue remain; the maps, the smoke cities and the
per-city shards went with the cut-back to one story on one map (the tag `archive/world-2026-11`
has them).
