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
3. **One primary action.** "Japan · start here": an amber **Play Shibuya** button
   (`#play-shibuya`), and Shinjuku (`#play-shinjuku`), Marunouchi & Ginza (`#play-tokyo`) and
   Higashiyama (`#play-higashiyama`) as chips beside it. **P** with nothing chosen presses it. On a
   phone it sits above the strip of places, in the thumb's reach, and steps aside while a card is
   open. The Tokyo hero-level sessions were told these hashes; a level that wants another start
   gives an `@<travel id>`.
4. **Labels that both read.** Tokyo and Kyoto are 370 km apart, close on a globe; a label that
   would overlap one already placed now tries the other side of its point before it loses its
   text, so both names show.

`tools/title_pick_check.js` checks the landing on a desktop and a phone: the first two places are
Tokyo and Kyoto, both are named on the globe, and the primary button is in view, a thumb's size,
and goes to `#play-shibuya`.

## What we looked at

Ideas only; nothing taken from their look, code or assets.

- **Game title screens** (Ghost of Tsushima, Death Stranding, most console games): the first item
  is the one that plays, *Continue* or *Start*, set apart from the rest. The landing here had a
  list of equal names and no such item. Adopted: one amber primary, the rest as secondary chips.
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
