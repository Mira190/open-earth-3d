# Fishing from the shore

A pilot, in two waters: **Sydney Harbour** (Beulah Street Wharf in Kirribilli, east of the
bridge, and Blues Point Reserve, west of it) and **Lake Wakatipu** (Queenstown Bay beach and
the Queenstown Gardens shore). Walk to the water's edge at a spot marked `≈` and press
<kbd>E</kbd>.

It follows the rule the rest of the game keeps: the place is real. The fish are the ones that
water holds, measured against the legal lengths its anglers have to know, biting by the month,
the light, the rain and where the lure lands. What a guide would tell you on the wharf is what
the log teaches as it fills. Every fish goes back. You keep a log, not a bag.

| Keys | What they do |
|---|---|
| <kbd>E</kbd> at a `≈` spot | Walk down to the edge and take the rod out · pack up · wind in a cast · let a fish go |
| <kbd>Space</kbd> (the **Jump** button on a phone, relabelled **Cast** and **Reel**) | Hold and let go to cast: the bar swings up and back, and how full it is sets how far · press when the float goes right under · hold to wind, let go when the fish runs |
| <kbd>A</kbd> <kbd>D</kbd> or the stick | Aim the cast, 43° either side |
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> or the **Rig** button | Change the rig, once the log has opened it |
| <kbd>J</kbd> or the **Log** button | The log: what you have caught, your best of each, and what it has taught you |

## A cast, start to finish

1. **Read the water.** Rings rise where the fish are holding (each spot has three or four
   places, fixed, within a cast). A cast that lands near one is taken sooner, by a slightly
   bigger fish, and more often by the scarcer ones.
2. **Cast.** One hold and release. The rig sets which part of the range the bar covers: a float
   fishes close to the wall, a metal lure goes long. Far out is where the tailor and kingfish
   are; close in, the bream, luderick and leatherjacket.
3. **Wait.** Between 3.5 and 20 seconds, shorter when more fish are feeding. Some fish nibble
   first (a leatherjacket two or three times): strike at a nibble and it is gone.
4. **Strike** when the float goes right under (or, on a lure, when the rod tip pulls down): one
   press inside about a second.
5. **Fight.** Hold to wind while the fish rests; let go when it runs, or the tension passes the
   end of the bar and the line parts after 0.7 s. A run takes line whatever you do, so a strong
   fish can also empty the spool. Tension held in the green band tires it more than twice as
   fast. A call, a ring on the water and the hint line say a run is coming 0.45 s before it
   does. Fights last 8 to 30 seconds and end by themselves at 40.
6. **The catch.** The fish comes up on the line with its card: species, length and weight,
   whether it would be legal to keep, your best, and one thing worth knowing about it.
   <kbd>E</kbd> lets it go.

## What we took from other games, and where this is different

A survey of fishing in games came first. Ideas only: no code or assets were taken from any of
them.

| Game or source | What we took | What this does differently |
|---|---|---|
| **A taxonomy of fishing mini-games** (Davide Aversa, 2018) | The three phases (approach, bite, catch) and the three feelings to serve: calm, surprise, excitement. Each phase here serves one of them. | |
| **Animal Crossing** | Fish you can see before you cast (their shadows; here, rises), so a cast is aimed. Nibbles before the real bite, and striking at one loses the fish. | Its fish are placed for the collection. Here what rises is what that water holds in that month. |
| **Stardew Valley** | A fight with tension to manage rather than a single timed press, and tackle that changes what you catch. Its author's own regret was the start: "it starts out too hard". | The curve runs the other way here. The first cast bites in 3.5 s with a double window, the commonest fish cannot break the line, and two fish lost in a row make the next one gentler (`core.learn`): the training rod, without having to know to buy it. |
| **Dredge** | Its team's aim that the minigame "not be frustrating", "never too hard or twitchy": skill makes it quicker rather than deciding pass or fail. | Here the green band does that: staying in it tires the fish twice as fast, and missing it costs time, not the fish. |
| **Sea of Stars**, **Ocarina of Time**, **Red Dead Redemption 2** | Tension as something you see in the rod and the line, not only on a bar: the rod bends with it, the line goes from slack to straight. | RDR2's fights were found to hurt: stick pulling and mashing for minutes ("Why are all the fishing mini-games trying to kill me?", AV Club). Here it is one button held about 70% of the time, never mashed, and no fight passes 40 s. |
| **Webfishing** | The log as the goal: a page per water, your best of each fish, no shop. Fishing as somewhere to stand for a while. | Its fish are jokes and treasure. Here the log's notes are true of the species, and the second catch of each adds when and where it bites. |
| **Fisch** (Roblox) | A warning. Luck stats, 200 mutations and "1 in X" odds turn the loop into a slot machine that pays for being left running. | No luck stat, no currency, no rarity colours. A scarce fish is scarce because of the season, the hour and where you cast, and the log tells you which. |
| **Final Fantasy XV**, **Breath of Fire IV** | Fishing that is worth doing because it is part of the world and pays back into it. | The reward here is knowing the place: why nothing caught west of the bridge is eaten, why a 75 cm flathead goes back. |

Sources are at the end.

## The fish, and what is real

`cities/<id>/city.json`, `game.fishing`, holds a water's species, rigs, rules and spots.

**From the fisheries agencies, as published:**

- Sydney Harbour: the legal lengths and daily bag limits (bream 25 cm, luderick 27 cm, tailor
  and silver trevally 30 cm, dusky flathead 36 to 70 cm, kingfish 65 cm); that no fish caught
  west of the Harbour Bridge should be eaten and catches there are to be released; that east
  of it the advice is 150 g a month; that commercial fishing in the harbour has been closed
  since 2006 (NSW Department of Primary Industries).
- Lake Wakatipu: brown trout, rainbow trout and landlocked Chinook salmon; about 70% of the
  catch is brown trout; about 1 kg on average; salmon close to shore in spring and deep in
  summer; cicada patterns under overhanging trees in summer; a licence to be carried and a
  daily limit of two trout and four salmon (Otago Fish & Game).
- The two Sydney spots and what is caught from them (a published list of the city's spots).

**Chosen for the game, not measured:** the weights by month and by light (anglers' lore: luderick
in winter, tailor at dusk, kingfish in summer at dawn), each species' share, the usual and
largest lengths, the weight from the length (a cube law with a coefficient per body shape), how
hard each fights, and the colours. The two Queenstown spots are places on the town's shore that
fit Fish & Game's description of the fishing there; it does not name them.

What a spot draws from that: `web/data/<id>/fishing.json`, written by `pipeline/fishing.py`.

## How it is built: nothing until you need it

The request was for a pilot that costs a device as little as it can. The budget, and how it is
kept:

| Stage | When | What is loaded or drawn |
|---|---|---|
| 0 | Every city, always | Nothing. A city without `game.fishing` has no fishing code in the page: `fishing.js` is not in `index.html`. A city with it carries its spots' places in `game.json` (about 200 bytes), a label each, and one distance check a second. |
| 1 | On foot within 160 m of a spot | `game/fishing.js` (37 KB, 11 KB gzipped) and `data/<id>/fishing.json` (4 to 8 KB), fetched once. If they fail (offline), they are asked for again after 30 s. |
| 2 | Within 70 m | Rises on the water: one instanced mesh of 8 rings (5 on the low tier), one draw call, drawn only while a ring is live. |
| 3 | The first cast | The rod, the line, the float and the fish: four meshes, about 900 triangles together, vertex colours only. **No textures**, so no GPU texture memory. The panel's DOM and its style sheet are made now. |
| 4 | 220 m from every spot | Their geometries and materials are disposed. The code stays (it is small); the next visit builds them again. |

With a line out that is **five draw calls** at most (`tools/game_check.js` fails on a sixth)
in a frame that draws 450 to 850, and under a thousand triangles in one that draws three to
five million.

Inside the frame:

- **No allocation per step.** The session is one object reused for every cast; the plan of a
  cast and the fight are two more. Vectors are scratch objects made once. The line is twelve
  points in one buffer, written in place. The fish is one geometry, recoloured and rescaled for
  each catch, never rebuilt.
- **The fight runs in fixed 1/30 s steps**, so it plays the same at 20 frames a second as at
  120, and `tools/game_check.js` can play it without drawing.
- **The panel is written only when a value changes**: the bar is a `transform: scaleX`, so it
  never lays the page out; text nodes change with the state, not every frame.
- **The rod's bend is in the vertex shader** (a parabola along the blank, one uniform), not a
  rebuilt mesh.
- **The rules are apart from the drawing** (`OEFishing.core`: no three.js, no DOM), so
  `tools/fishing_sim.js` plays twenty thousand fights in Node in a second.
- **What is remembered** is about 1 KB in `localStorage` (`oe3d-fishing`): the log, the rig, and
  how much help you are getting.

The character's right hand goes to the rod by the same two-bone reach the umbrellas use
(`people.js` `rig.hold`).

## Balance

`node tools/fishing_sim.js` plays every species as three players: **new** (lets go half a second
after a run starts, with a wide spread), **steady** (0.3 s) and **keen** (acts on the warning and
watches the bar). It fails if a beginner cannot land the easiest fish nine times in ten, if the
hardest is not a fight for the keen player or is out of reach of a helped beginner, if a slower
player ever does better than a quicker one, if a fight passes the cap, or if any species is never
5% of the takes. Fish of the usual length, 2,000 fights a cell:

| | New | Steady | Keen | New, the largest of the kind | New, after two losses |
|---|---|---|---|---|---|
| Yellowtail scad, leatherjacket | 100% · 8 s | 100% | 100% | 100% | 100% |
| Yellowfin bream | 96% · 14 s | 100% | 100% | 76% | 100% |
| Luderick | 89% · 14 s | 100% | 100% | 64% | 100% |
| Dusky flathead | 79% · 14 s | 100% | 100% | 54% | 100% |
| Silver trevally | 68% · 18 s | 100% | 100% | 39% | 99% |
| Tailor | 61% · 18 s | 100% | 100% | 24% | 99% |
| Yellowtail kingfish | 3% · 28 s when landed | 96% | 99% | 0% | 79% |
| Chinook salmon | 99% · 16 s | 100% | 100% | 76% | 100% |
| Brown trout | 93% · 17 s | 100% | 100% | 63% | 100% |
| Rainbow trout | 62% · 22 s | 100% | 100% | 26% | 99% |

The button is held 65% to 84% of a fight.

## Adding a water

1. Add `fishing` to the city's `game` block: `water`, `rules` (the licence, and a `zones` entry
   for each stretch with its own advice), `rigs`, `species` and `spots`. A spot's `at` is where
   people stand, to within a few tens of metres, with a `source` for people fishing there.
2. `python pipeline/fishing.py <id>` moves each spot to the nearest edge with 30 m of open water
   in front, finds its heading and places its schools, writes `fishing.json` and the pointer in
   `game.json`. Then `python pipeline/pack.py <id>`. `pipeline/game_data.py` and
   `pipeline/game_text.py` run the same step, so a rebuilt `game.json` keeps its fishing.
3. `node tools/fishing_sim.js <id>` for the balance, `tools/check.sh <id>` to fish each spot, and
   `tools/fishing_shot.js <id> out` for stills.

## Limitations

- A pilot: four spots in two waters. Kyoto's Kamo River, Tokyo Bay and the reef sites have none.
- The player's left hand is not on the rod, and the reel's handle does not turn.
- The float sits on a flat water level with a bob of its own; it does not ride the drawn waves.
- A fish is one lofted shape recoloured per species: a flathead is the same shape made wide and
  flat. There are no fish under the water before the catch, only the rises.
- No tide: a harbour angler fishes the tide's turn, and the game does not compute Sydney's tide.
- Sound is the game's existing beeps at different pitches (the reel's clicks, the bite). A reel's
  drag and a splash want sounds of their own.
- Not checked on a real GPU, on Safari or on a phone's touch screen: the stills and the scripted
  catches are from a software renderer in Chromium.

## Sources

- Davide Aversa, [Game Design: Taxonomy of Fishing Mini-games](https://davideaversa.it/blog/game-design-taxonomy-fishing-mini-games/) (2018)
- Phi Nguyen, [What Makes a Fishing Mechanic Feel Good?](https://practiceflip.substack.com/p/exploring-fish-catching-mechanics) (2025): the catch mechanics in use, and Sea of Stars' tension reel
- PC Gamer, [Eric Barone on Stardew Valley's fishing minigame](https://www.pcgamer.com/games/life-sim/a-lot-of-people-hate-it-but-i-think-its-fun-eric-barone-backs-stardew-valleys-fishing-minigame-but-does-admit-that-it-starts-too-hard): "it starts out too hard"
- premortem.games, [Dredge by Black Salt Games](https://premortem.games/2023/03/30/unique-blend-of-genres-in-haunting-fishing-adventure-dredge-by-black-salt-games): the minigame "not frustrating", never "too hard or twitchy"
- AV Club, [Why Are All the Fishing Mini-Games Trying to Kill Me?](https://www.avclub.com/why-are-all-the-fishing-mini-games-trying-to-kill): strain from stick pulling and mashing in long fights
- Kotaku, [why so many games have fishing minigames](https://kotaku.com/stardew-valley-destiny-2-fishing-minigames-2000723185): tension in a calm game; fun over simulation
- PC Gamer, [Webfishing](https://www.pcgamer.com/games/heres-an-adorable-cozy-little-multiplayer-chatroom-fishing-game/), and the [Fisch wiki on rods](https://fisch.fandom.com/wiki/Fishing_Rods) (its luck stat)
- NSW Department of Primary Industries, [Fishing in Sydney Harbour](https://www.dpi.nsw.gov.au/fishing/recreational/fishing-skills/fishing-in-sydney-harbour) and [Saltwater bag and size limits](https://www.dpi.nsw.gov.au/fishing/recreational/fishing-rules-and-regs/saltwater-bag-and-size-limits)
- Otago Fish & Game, [Lake Wakatipu](https://fishandgame.org.nz/freshwater-fishing-in-new-zealand/where-to-fish/regional-info/otago/lake-wakatipu) and the [weekly report of 18 December 2025](https://www.fishandgame.org.nz/freshwater-fishing-in-new-zealand/follow-the-fish/regional-fishing-reports/otago-weekly-fishing-report-18-december-2025/)
- Man of Many, [Best fishing spots in Sydney](https://manofmany.com/culture/travel/best-fishing-spots-sydney): Beulah Street Wharf and Blues Point Reserve
