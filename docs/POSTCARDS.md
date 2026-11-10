# Postcards from the road

While you are away, the plush friends keep travelling, one in each map. When you come back, the title
screen has a small pile of postcards: a photograph from a real spot in one of the live cities, the
friend held up in front of the view the way travellers photograph their own soft toys, where and when it
was taken, the sun there at that minute, and a line of its diary. **Go there** on a card dives to that
city and starts the game on the photographer's spot, in the photograph's light.

![A postcard from the Senbon Torii](images/title/postcard.jpg)

| The pile on the menu | On a phone |
|---|---|
| ![](images/title/postcards-menu.jpg) | ![](images/title/postcards-phone.jpg) |

That is all of it. There is no second game inside the game: no food to pack, no currency, no timers,
no notifications. The postcards are the part of the game that happens while you are not playing, and
each one is a door back into the part that happens while you are.

## Why it is built this way

The idea comes from *Tabikaeru* (Travel Frog, Hit-Point, 2017): a traveller you do not control, who
goes away on their own and sends photographs home. What makes it work is absence. The pleasure is in
coming back and finding that something happened without you.

This game's pleasure is the opposite one: being there, on foot, under the real sun. Two cores side by
side dilute each other, so only the absence is taken, and it is made to serve the presence:

| From Travel Frog | Here |
|---|---|
| The traveller leaves when it likes; you only find out | A plush friend in each map travels on real time; nothing to manage |
| The frog is in its own photographs | The friend is held up in the corner of each one, the place sharp enough behind it to know |
| Photographs arrive while you are away | A postcard every six hours away, three at most at a visit |
| An album | The album strip under the card, and a page in each map's passport |
| Packing food and charms, clover as currency, a lottery | Left out: a second loop to tend would be a second game |
| Rare photographs as a collection to complete | Left out: no rarity, no gacha; the next card is from wherever the journey is |
| The frog's world is drawn, and you cannot go there | Every postcard is a place in the model, and one button takes you to it |

Other games this borrows a thought from, without their look: *Animal Crossing*'s letters (the world
writes to you; a visit is short and finite), *Wordle* (a small ration a day, never a backlog to work
off), *Alba* and *Pokémon Snap* (a photograph as the way a place is noticed), and *Microsoft Flight
Simulator*'s world map (the menu is the world; a picture of a place is a way into it).

What only this project can do: the postcard is true. A card dated 17:42 in Kyoto shows Kyoto in the
light the real sun gave it at 17:42 that day, by the same NOAA equations the cities use, and the place
in the picture is the place you land in.

## Who is in the picture

At first nobody was: the photographs were the ones the other surveyor took. But a passer-by near the
lens at the edge of a still read as the surveyor, a figure that took the picture away from the place
without being anyone you knew. Reasoned from what the card is for:

- **Why anyone at all.** Travel Frog works because someone you care about went, and the photograph is
  their proof (players share the frog's snapshots, not the views: Culture Trip, The Next Web, below). A
  bare view is a stock photograph, or a screenshot of the game; it does not say who went.
- **Why a toy and not a person.** A doll held up against a view (*nuidori*, ぬい撮り) is how people take
  this kind of picture now; it is personal without a face, it never poses awkwardly, and a soft toy in
  the foreground, sharp, with the place soft behind it, is the one composition that makes a still of a
  real-time world read as a photograph. A different friend in each map makes the album a set of
  characters as well as places.
- **How big.** In *nuidori* the doll is the subject and fills half the frame; here the place is
  ("Go there" takes you into it), so the toy is the supporting subject: in the lower corner of one side
  third, its head about a quarter of the frame's height, 0.65 m from the lens, focused on, the view
  behind through an f/5.6 blur (6 px on a 640 px card) that keeps a landmark recognisable. Plush
  photography guides agree on the rest: the rule of thirds, the toy's eye level or a little below, soft
  light rather than hard sun (Otakumode, Super Cute Kawaii, Canon Snapshot, below).

The cast, original designs (`tools/plush.js`, in each map's `postcards.json` `plush`):

| Map | Friend |
|---|---|
| Fushimi Inari | Kon, a white Inari fox with red markings and a red bib (the shrine's fox messengers) |
| Higashiyama | Pon, a tanuki |
| Kyoto | Mochi, a white rabbit in a red scarf |
| Philosopher's Path | Tetsu, a grey tabby (the path is known for its cats) |
| Shichirigahama | Poppo, a dove in a sailor collar |
| Sydney | Gumnut, a koala |
| Queenstown | Merri, a sheep with a bell |
| Shibuya | Hachi, an akita |
| Shinjuku | Mike, a calico cat |
| Tokyo | Rinrin, a panda |

What makes a toy read as plush rather than plastic is its pile: an outline broken by fibres, light caught
along them at a grazing angle, roots in their own shade, and the colour of what is around it thrown back
on it. So every fleece part has 18 fur shells (Lengyel, Praun, Finkelstein and Hoppe, *Real-time fur over
arbitrary surfaces*, 2001, the way games draw short fur): copies pushed out along the normal, 3 mm of pile
(4.5 for the koala, 4 for the wool), tapered strands about a millimetre apart, darker at the roots. The
face is embroidered on a panel of the head (a canvas texture: eyes with a glint, nose, mouth, markings).
In a still the toy takes a bounce of the frame's own mean colour over its albedo (red in the torii, blue
by the harbour), and after dark a little light of its own.

`node tools/plush_shot.js out.png [kinds]` shows the cast side by side in a studio light.

Sources: [Culture Trip on Travel Frog](https://theculturetrip.com/asia/china/articles/china-obsessed-game-traveling-frog/),
[The Next Web](https://thenextweb.com/news/this-tiny-buddhist-frog-is-haunting-me),
[Otakumode, plushie photos](https://otakumode.com/news/6992b8d70acfe9001efcfdee/Level-Up-Your-Plushie-Photos-PART-ONE),
[Super Cute Kawaii, tiny plush photography](https://www.supercutekawaii.com/2021/08/tiny-plush-photography-tips),
[Canon Snapshot, nuidori](https://snapshot.asia.canon/en/article/tell-a-tale-with-your-beloved-soft-toy-a-basic-guide-to-getting-cute-nuidori-photos).

## What the player sees

- **The pile** on the title's menu: up to three cards fanned, "From the road", how many are new and
  where the newest is from. Bottom left on a desktop, under the logo on a phone.
- **The card**: the photograph on a paper edge with a postmark (the map, the date, the minute), the
  map and the spot's name (in its own script too), the local date and time with the sun's height, one
  line of the diary, who sent it, and **Go there**. Arrows, the album strip, or ← → change the card; Esc closes.
- **Go there**: the title's dive to that city, then the game's own title card over that spot, with
  "As on the postcard" chosen as the time to start at. Play starts you where the photographer stood.
- **The passport** of each map lists the postcards that came from it.

## How a journey is worked out

`web/postcards.js`, with no server. The state is one entry in `localStorage` (`oe3d-postcards`): a
seed, the time of the last visit, where the traveller is, and the album.

- A visit brings `floor(hours away / 6)` cards, three at most. The first visit ever brings one, so a
  new player meets the idea at once. A visit sooner than six hours after the last brings none.
- The newest card is dated within the last hour and a half; the others about six hours apart before
  it, none before the last visit. A card that would be dated in the small hours (00:30 to 05:00 local)
  is from the evening before instead.
- The traveller stays two or three cards in one map and then moves to another: not either of the last
  two, and one the album has fewest cards from, so the journey gets round every live map. Within a
  map, a spot the album does not have yet.
- The light of a card is the sun's over that city at that minute: `day` above 8°, `night` below -5°,
  between them `dawn` while it is rising and `dusk` while it is setting.
- The album keeps the newest 48.

Telemetry (through `web/telemetry.js`, which sends nothing from automated browsers or with Do Not
Track): `postcards_shown` (how many new, unseen and in the album), `postcard_open` and `postcard_go`
(city, spot, light). The two numbers to watch are the return rate of visitors who were shown a pile,
and the share of opened cards that go on to **Go there**.

## The stills

A city names its spots in `cities/<id>/postcards.json`:

```json
{"id": "steps", "name": "The Opera House forecourt", "at": [293.9, 391.3], "look": [330, 520], "lookUp": 22,
 "lines": {"any": ["..."], "dusk": ["..."]}}
```

`at` is where the photographer stands (local metres, x east, y north), with `z` for a deck or a roof
rather than the street; `look` is what the camera looks at, `lookUp` metres over the ground the
photographer stands on; `up` raises the eye from 1.65 m, `fov` widens the lens from 46°; `native` is the
name in the place's own script. `lines` gives the diary: `any`, or a list for one light.

```
tools/postcards.sh sydney kyoto        # the stills of these maps, packed, and the index
python pipeline/postcards.py index     # the index alone, after a change to names or lines
```

`tools/postcards.sh` runs `tools/game_shot.js` on the views `pipeline/postcards.py views` writes: each
spot at four lights (25 minutes after sunrise, 11:00, 8 minutes after sunset, 100 minutes after sunset) on the day it is
run, through the game's own sky, haze and post stack at the desktop tier, in photo mode from the
photographer's eye, once nobody in the crowd is within 10 m of the lens, with the map's friend held up
in it (a spot's `"plush": {"side": -1, "x", "y", "tilt", "fstop", "dist"}` moves it; `false` leaves it out;
by default it alternates sides from spot to spot). `pipeline/postcards.py pack`
crops each to 3:2 and writes `web/data/<id>/postcards/<spot>-<light>.webp` (960 × 640, about 50 kB), and
`index` writes `web/data/postcards.json`, which the pages read. A spot without all four stills is left
out of the index.

While composing, `python pipeline/postcards.py views <city> --draft` gives the day view alone, and a
spot's `"clear": <metres>` lets `tools/game_shot.js` move the stand to the clearest view of `look`
within that far (the trees and buildings near the frame's middle count against a place); it prints the
place it took, to write back as `at`.

The stills are taken on the day's date, so they show that season's trees: rendered in November, the
maples are red and the jacarandas are out all year round. Rendering them again in another season is
one command; choosing among several seasons by the card's date is not built.

## Checks

`tools/postcards_check.js` (in `tools/check.sh` with the title screen):

- the data: every live city with a game has at least five spots, every spot a line for every light and
  its four stills, no still is left from a spot that was taken out, and the index matches the cities'
  spot files;
- the journey, in Node: a player who comes back at odd intervals for six weeks gets one card for six
  hours away and never sooner, three at most, each dated inside the absence and not in the small hours,
  in the sun's light, two or three to a map, from every map in the end;
- the pages, on a desktop and a phone: the pile is on the menu over nothing else, the card opens with
  its picture loaded, the arrows and the album work while the title's own keys stand down, Esc closes,
  and **Go there** dives with `#play-<city>@pc-<spot>.<light>`; on the desktop the game then stands on
  the spot at the postcard's light, and its passport lists the card.

`tools/postcards_shot.js` takes stills of the pile and the viewer for a player with an album.

## Not built yet

- The friend sitting on things (a railing, a step, a bench) rather than held up, and more than one pose.
- Seasons: one set of stills, from the day they were rendered.
- The reef sites, which have their own game and journal, and parked cities.
- Sending a card: sharing a postcard as a link that opens on that spot for someone else. The link
  form exists (`#play-<city>@pc-<spot>.<light>`); a share button and a picture for the link do not.
