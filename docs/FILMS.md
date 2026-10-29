# City films: each city's highlights, filmed from its own model

Choose a city on the title screen and its card plays a film: about 36 seconds of
the city's highlights, cut like a trailer. Nothing in it is stock footage or a
render from another program. It is the city's own model and game (the same
buildings, crowds, ferries, traffic, sky and lights you walk through) under the
real sun for the date and hour of each shot, seen through the title screen's
lens. The titles are set over the picture as type, from a cue sheet, so they
stay sharp at any size and can be read by a screen reader.

| | |
|---|---|
| Source | `cities/<id>/film.json`: the shot list |
| Tool | `tools/city_film.js` (with `tools/film/`: the virtual clock, the director, the score) |
| Output | `web/films/<id>.mp4`, `<id>.jpg` (poster), `<id>.json` (cue sheet), `web/films/index.json` |
| Player | `web/film.js`, `web/film.css`: the reel in the destination card and the theatre |
| Lens | `web/lens.js`: the title screen's tone curve, grade, flare, grain and vignette as a pass |

## The film

One idea per city, told in six or seven shots and one day:

| Act | Time | Picture | Type |
|---|---|---|---|
| Cold open | 0–5 s | First light. The city's signature against the sunrise, low, on a long lens, fading up from space black. | A caption, as on the title: coordinates, the place and the local time of the sunrise, decoding in |
| Title | 5–10 s | A rising move that shows the whole city, in low morning sun. | The city's name, letters out of the blur, the tracking closing; the country; one line of figures |
| Highlights | 10–24 s | Three landmarks, each one shot. Vary the scale: a wide, a tracking shot on something that moves (a ferry, a tram), a long lens on a detail. Late morning to golden hour. | A lower third per shot: an eyebrow (where), a head (what), one sentence (a fact from the model or its sources) |
| Life | 24–29 s | At eye level, among the crowd: the people of the game walking past the lens. | A lower third about walking it, playing it |
| Night | 29–36 s | Blue hour into night, a time-lapse: the lights coming on. The finale of the score lands as they do. | The city's name again, small; then the end card |

The score is synthesised in the title screen's voice (the same drone, riser and
hit), with a city's own key, chords, motif, tempo and timbre in `score`; a note of
the motif lands on each cut.

## Direction

- **Light is the subject.** Use the low sun: dawn, golden hour, blue hour, night.
  Avoid the flat light of midday, and avoid shooting with the sun behind the
  camera at noon. Backlight and silhouettes read as cinematic even on simple
  geometry; a midday aerial reads as a map.
- **Long lenses, low cameras.** `fov` 22–30 for landmarks: compression makes
  a skyline stack up. Keep the camera near the water or the street (5–40 m) for
  most shots. Use one high, wide shot only, for the title.
- **Constant motion, hard cuts.** Every shot moves, slowly, at a constant speed
  (the default ease, `glide`). Cut on motion; no dissolves. 4–6 s a shot; the
  night shot can run 7.
- **Never show the edge of the world.** The model stops a few kilometres out.
  Point wide shots inward, across the model, or keep the horizon low and let the
  sky fill the frame. Check every shot's stills for a hard grey band at the
  horizon.
- **People and movement.** The life shot puts the crowd a few paces out and
  keeps the camera at eye level or a little above (`agl: true`, z 1.7–2.5) with
  `hand: 1`. The crowd's figures are simple, so keep them at 8 m and more
  (`crowd_clear`) and set how many (`crowd_n`, 30–80) for the street's width: a
  narrow bridge with the whole crowd of 300 on it reads as a crush. Anchor
  `people` 20–40 m ahead of the camera, where it looks. Ferries are cast onto a
  leg of their route (`ferry`).
- **Words.** Plain, factual, one sentence. Prefer a figure from the model or its
  cited sources (heights, spans, dates, counts) to an adjective. The title
  screen's voice: no exclamation marks, no "iconic", "stunning" or "vibrant".
- **The grade.** The lens is the same for every city. Per shot you may trim the
  exposure (`ev`), warm or cool the white balance (`tint`, e.g. `[1.06, 1, 0.92]`
  at dawn) and the saturation (`sat`). Keep it subtle.

## A shot

```json
{ "id": "bridge", "chapter": "The Bridge", "dur": 4.5, "type": "move",
  "from": [430, 1010, 12], "to": [330, 1000, 14], "look": [-260, 1050, 60], "fov": 30,
  "time": ["19:02", "19:06"],
  "title": { "kind": "lower", "at": 0.5, "until": 4.2, "eyebrow": "Dawes Point to Milsons Point",
             "head": "Sydney Harbour Bridge", "text": "An arch of 503 m, its crown 134 m above the sea." } }
```

Positions are the city's local metres `[x east, y north, z up]` (the frame of
`web/data/<id>/scene.json`; the landmarks' positions are in its `labels`). Heights
are above the datum unless the shot says `"agl": true`.

| Field | |
|---|---|
| `type` | `move` (`from`, `to`, and `look` or `lookFrom`/`lookTo`); `orbit` (`at`, `az` compass bearings of the camera from it, `dist`, `h`); `track` (`ferry: {route, from, to, s, speed}`, `az` relative to its course, `dist`, `h`) |
| `dur`, `fov` | seconds; vertical field of view in degrees (a number, or `[from, to]` for a zoom) |
| `date`, `time` | `[month, day]` (else the film's `date`); `["HH:MM"]` or `["HH:MM", "HH:MM"]` for a time-lapse over the shot, `timeEase` |
| `people`, `crowd_r`, `crowd_n`, `crowd_clear` | put `crowd_n` people (default all) on the footways within `crowd_r` metres of `[x, y]`, none within `crowd_clear` metres of the camera (default 8) |
| `hand` | a hand-held float, 0–1 |
| `ease` | `glide` (default), `linear`, `inOut`, `out`, `in`, `smooth` |
| `fadeIn`, `fadeOut` | seconds, from and to space black |
| `ev`, `tint`, `sat`, `flare` | exposure in stops, white balance, saturation, flare strength |
| `chapter` | starts a chapter in the theatre's timeline |
| `title` | `caption` (`lines`), `main` (`name`, `native`, `sub`, `figures`), `lower` (`eyebrow`, `head`, `text`), `end` (`name`, `line`); `at` and `until` in seconds from the shot's start |

The film's own fields: `name`, `date`, `year`, `exposure`, `poster` (the second
the poster is taken at), `teaser` (`[from, to]`, the loop the card plays; default
35–80 % of the film), and `score` (`root` MIDI note, `scale`, `chords` as scale
degrees, `motif`, `tempo`, `voice` `bell`/`pluck`/`koto`, `air`
`harbour`/`city`/`wind`, `title_shot`/`title_at`, `finale_shot`/`finale_at`).

## Making one

```bash
cd web && python3 -m http.server 8800 &
export NODE_PATH=$(npm root -g)
xvfb-run -a node tools/city_film.js tokyo --plan --size 960x402      # the plan: every camera path from above
xvfb-run -a node tools/city_film.js tokyo --stills --k 0.5           # a still from the middle of each shot
xvfb-run -a node tools/city_film.js tokyo --stills --shots night --k 0.1,0.9
xvfb-run -a node tools/city_film.js tokyo                             # the film: frames, score, encode
```

- **The plan** (`plan.jpg` in the frames folder) draws the city from straight
  above with each shot's camera path, where it looks, and its name, and prints
  each shot's lowest clearance over the buildings and whether a roof stands in
  its line of sight. Fix every shot whose clearance is negative or whose sight
  is blocked before rendering anything else.
- **The stills** are drawn exactly as the film's frames are. Review them as a
  contact sheet before the full render.
- **The film**: frames go to a folder in the system's temp directory and are
  kept, so an interrupted render resumes; `--part 1/2` and `--part 2/2` split the
  shots between two processes and `--encode` assembles the result.

Under `xvfb-run` Chromium draws through Mesa's llvmpipe, about four times faster
than SwiftShader on the same cores (2–3 s a frame at 1920 × 804 on four cores,
so a film takes about 40 minutes); without a display the tool falls back to
SwiftShader. Frames are taken from the WebGL canvas, so the game's HUD never
shows. Each film is about 8–10 MB at 1920 × 804 (H.264, CRF 27 with adaptive quantisation, which
holds the dark water and the night sky; at 100 % it is indistinguishable from the frames).

Python's `http.server` does not answer range requests, so locally a film plays
from the start but cannot be scrubbed, and Safari will not play it at all. Any
static host does (GitHub Pages, `npx http-server`); so does the site in
production.

## How it works

- **A virtual clock.** `tools/film/clock.js` replaces `performance.now` and
  `requestAnimationFrame` before the page loads. The city loads in real time;
  then the clock stops, and each frame runs the game's own loop exactly 1/24 s
  after the last, however long it takes to draw.
- **The game is the stage.** The director (`tools/film/director.js`) hides the
  title and the player, puts the whole crowd and traffic out, and drives the
  game's own cine director with the shot's pose, the clock with the shot's time,
  and the lens with its exposure and flare. The game simulates everything else.
- **The lens.** The game's post stack ends on the title screen's lens instead
  of its own tone mapping and grade: Khronos PBR Neutral with a long shoulder, a
  little contrast, cool shadows and warm light, the anamorphic flare when the
  sun is in shot and not behind a building (ray cast through the city's surface
  model), and a vignette. Grain is added by the player, not baked into the video,
  which keeps the files small.

## The reef

The five Great Barrier Reef sites share one film, `great-barrier-reef`, which the
group's card on the title screen plays. Its shot list is `cities/whitsundays/film.json`
with `"id": "great-barrier-reef"` (the name the files are written under) and
`"engine": "reef"`: the sites run in the reef viewer (`web/reef/`, three.js r186),
not the city game, so the tool takes another path.

- **One page per site.** Each shot names its `site`. The tool opens
  `reef/index.html?city=<site>&mods=life,boats` (the sea, its life and its boats; no
  player, game or HUD) once for each run of consecutive shots on a site, with
  `sites.<id>` in the film adding query keys to that site's page.
- **The director** (`tools/film/reef-director.js`) drives the viewer through
  `window.__reef.ctx`: it takes the camera as `ctx.controller`, sets the model clock
  with `ctx.setClock` for each frame's local time (so the sun, moon, tide and lamps
  follow, and a time-lapse works as it does in a city), and the exposure through the
  renderer's own tone mapping. The viewer's `setAnimationLoop` asks for frames through
  `requestAnimationFrame`, so `tools/film/clock.js` drives it unchanged.
- **Positions** are the site's local metres `[x east, y north, z up about mean sea
  level]` (`web/data/<site>/scene.json` and its `pois`); `z < 0` is under water.
  Shots are `move` and `orbit` as in a city, and `track` beside a boat or an animal:
  `boat: {vessel, from, to, speed, sails}` takes one of the site's boats off its route
  and sails it along the line (its wake is built up for a few seconds first);
  `animal: {species, near}` follows the nearest animal of a species (or of any in a
  list) that `life.js` is simulating near the camera. `under: true` keeps the lens below
  the surface, otherwise it stays `clear` (1.2 m) above the waves.
- **The look is the reef's own**: its post (bloom, light shafts, the night's Purkinje
  shift) and ACES. The title lens is not used. White balance (`tint`), saturation
  (`sat`), a light vignette and the fades are applied as the frame is taken from the
  canvas, on a 2D canvas the size of the film.
- **The tide is the real one** for the film's day, so the date is chosen for it: on
  26 November 2026 the water at Whitehaven is 1.4 m below mean sea level at 06:00, and
  Hill Inlet's sand banks are out for the title. That evening, the moon the viewer draws
  rises at sunset, for the finale.
- `--plan` is for cities only; check a reef film with `--stills`.

Under water, avoid a level camera: the far edge of the surface draws a thin white line
across the frame at the horizon. Look down at the floor or up at the surface.

![The Great Barrier Reef film's contact sheet](images/films/great-barrier-reef.jpg)
