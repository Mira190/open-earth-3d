# The homepage: Japan first

The title screen ([TITLE.md](TITLE.md)) is the homepage. This note works out what that page is for,
from who lands on it, and records what changed in November 2026 when Japan became the front of
the project.

## Who lands, and what they need

**Who.** Most visitors arrive from a link someone shared, on a phone, with no idea what Open Earth
is. A smaller group comes back on a desktop to play a map they already know.

**The first three seconds** have to say two things: this is the real Earth, live, and you can go
down and stand in a Japanese street. The Earth already says the first; nothing said the second.

**The one action** is to play: drop into the best Japanese level. Everything else (the other
places, the 3D model viewer, the films) is for the second visit. The postcards are not on the home page
at all: they are in each map's passport ([POSTCARDS.md](POSTCARDS.md)).

## What the page made them do (before)

Measured with `tools/home_shot.js` at 1440 × 900 (high tier) and 390 × 844 (phone, low tier), the
menu at noon, dusk and night in Japan (03:00, 07:40 and 12:00 UTC):

| | Before | After |
|---|---|---|
| First in the list | Mackenzie (sorted by the sun, east to west) | Tokyo, then Kyoto, then Kamakura |
| Japan in the list | places 6 to 8 of 8; on a phone off the end of the swipe strip | places 1 to 3 |
| Globe framed on | the Pacific between Australia and New Zealand | Honshu |
| Japan on screen, desktop | no: Tokyo and Kyoto behind the limb | yes, both named |
| Japan on screen, phone | Kamakura's label at the limb; Tokyo and Kyoto muted | Tokyo and Kyoto both named |
| A primary action above the fold | none: a list of names, the first press opens a card | **Play Shibuya**, the amber button, with Shinjuku, Marunouchi & Ginza and Higashiyama beside it |
| Presses from landing to playing Shibuya, phone | skip, swipe the strip to Tokyo, Tokyo, its subway map, Shibuya, Play: 5 presses and a swipe | skip, Play Shibuya: 2 (1 if the opening runs out) |
| Presses from landing to playing Shibuya, desktop | skip, Tokyo, Tokyo again (full map), Shibuya, Play: 5 | skip, Play Shibuya (or **P**): 2 |
| Kyoto (Higashiyama), phone | skip, swipe, Kyoto, Higashiyama, Play: 4 and a swipe | skip, Higashiyama: 2 |

Time to the Earth's first frame and to the menu is unchanged: the change adds no texture, no
model and no request, only a few buttons of markup (the phone-memory work in flight must not get
more load on the title). In headless software WebGL (SwiftShader, so far slower than a phone's
GPU) the menu was interactive 1.6 to 3.3 s after navigation on the phone tier and 2.8 to 4.7 s on
the desktop tier, before and after alike; `tools/home_shot.js` prints both and the page's own
`oe:frame` and `oe:ready` marks. A first visit plays the 14-second opening first unless a press
skips it.

## What was changed

1. **Japan first.** Tokyo and Kyoto lead every list (the menu, the phone's strip, the keyboard's
   order), the rest of Japan follows, and the other places come after in the order the sun reaches
   them (`title.js`, `LEAD`).
2. **The globe opens on Japan.** The orbit's home is the point between Tokyo and Kyoto, with the
   camera dropped 7° (desktop) or 9° (phone) south over the Pacific so the globe is seen at a
   slight tilt with its air above Japan, and a little closer than the whole-globe framing. The
   opening's pull-back ends there, and Esc returns there. Idle, the globe sways a few degrees
   either side of Japan instead of drifting off it; a drag or a zoom frees it. The time of day is
   the real one, so a visitor sees Japan at noon, at dusk with the terminator across Honshu, or
   lit at night.
3. **One list, one start.** The menu is a single hierarchy, city then district. A city of several
   playable maps (Tokyo) names them on a line under its row: Shibuya (`#play-shibuya`) and
   Marunouchi & Ginza (`#play-tokyo`), each one press into its game. The line shows under the
   leading city until another place is chosen, and under a chosen city. Shibuya carries a small
   outlined **Play** mark, the page's only amber accent, and **P** with nothing chosen presses it.
   On a phone, where the list is a strip of names, the same start sits on a slim line over the
   strip and steps aside while a card is open. (The first version was a filled amber banner with
   the other districts as boxes beside it, above the list: three sets of navigation for one
   question, Tokyo named four times, and a block heavier than the Earth. Review, November 2026.)
   A level that wants another start gives an `@<travel id>`.
4. **Labels that both read.** Tokyo and Kyoto are 370 km apart, close on a globe; a label that
   would overlap one already placed now tries the other side of its point before it loses its
   text, so both names show.

5. **The list is read against the dark, not the globe.** The menu column is narrower, the shade
   behind it deeper, and a label on the globe that would lie on the list or on the foot's lines
   loses its text (a planned place's is not drawn at all).

6. **A low orbit, not a disc.** On a wide screen the home view is the Earth as the station sees it: the
   camera stands over the Philippine Sea, 1.6 radii up, and looks north to the limb, so the curve of
   the Earth and its air cross the top of the frame, Japan sits on the right third and Asia runs off
   under the list; the horizon leans five degrees (`title.js` `HOME`, `orbitPose`'s pitch and roll).
   The whole disc at night was a small patch of lights with the black Pacific over two fifths of the
   picture. A drag, a zoom or a chosen place eases back to the plain orbit. A phone keeps the disc
   over its strip of places.
7. **The place behind its card.** Choosing a place turns the globe to it and then brings up a still of
   the map as it is played now, full bleed, on a slow push in: the Scramble for Shibuya, Tokyo
   Station for Marunouchi, the Museum of Contemporary Art's sandstone for Sydney, each at the hour it
   is there by the real sun (day, dusk or night). Over the picture a card is type on the picture,
   not a panel (Tokyo's subway map keeps its glass), and the film is a line to press. The stills are
   `web/plates/<map>-<time>.webp` (1920x1080, about 200 kB, fetched when a place is chosen), listed in
   `web/plates/index.json` and shot by `tools/plates.sh` from the views in `tools/views/plates/`; run
   it again when a hero level changes. The films were tried first and are older renders that do not
   hold up full screen. The reef and alpine sites have no plate yet and keep the globe behind a
   glass card.
8. **Continue.** A browser that holds a saved game starts there: the amber mark says **Continue** on the
   map last played (the save's `at`), with its stamps for a city of one map, and **P** presses it.
9. **Named once.** The places to come are in the foot's line only, not marked on the globe as well.
10. **The night side.** The airglow's thin green line over the dark limb (an emitting shell near 95 km in
   the air's shader, `earth.js`), and a little more of the moon's light on the night's land, sea and
   clouds, so the night Earth is a body and not a hole in the stars.

`tools/title_pick_check.js` checks the landing on a desktop and a phone: the list leads with
Tokyo, named on the globe, and the start is in view (a thumb's size on a phone), goes to
`#play-shibuya`, no filled amber block is in the menu, and with two saved games the start says
Continue and goes to the later one. `tools/home_shot.js --pick=N` shoots a chosen place with its still.

## What we looked at

Ideas only; nothing taken from their look, code or assets.

- **Game title screens** (Ghost of Tsushima, Death Stranding, most console games): the first item
  is the one that plays, *Continue* or *Start*, set apart from the rest. The landing here had a
  list of equal names and no such item. Adopted: one item that plays, marked in amber, inside the list rather than over it.
- **Microsoft Flight Simulator's world map**: the globe is the menu, but it opens on featured
  places, not on wherever the last session was. Adopted: the globe's home is the featured
  country.
- **Google Earth on the web**: opens on a globe and offers one obvious next step (search, or
  "I'm feeling lucky") rather than a catalogue. Adopted: one step, not a catalogue.
- **Apple Maps Flyover**: a city's tour is one tap from its card. Adopted: one press from landing
  to standing in the street, skipping the card and the subway map that the second visit keeps.

## Not done yet

- The opening still runs about 14 seconds before the menu on a first visit. A visitor from a
  shared link may not know a tap skips it. Worth measuring on real phones (the telemetry's
  `oe:ready` mark) before cutting it.
- Not checked on a real GPU, WebGPU, Safari or iOS.
