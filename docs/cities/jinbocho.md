# Jinbocho

A map of Tokyo ([Tokyo as maps](tokyo-maps.md)): Jinbocho's book town and Kanda, from Kudanshita to
Ochanomizu and from Suidobashi to Kanda Nishikicho. Frame: 1.8 × 1.5 km round 139.758 E, 35.696 N.
It shares its east edge with the Akihabara map, and Nikolai-do with it.

## Data

Overture Maps 2026-10-21.0 footprints, Project PLATEAU LOD2 heights (CC BY 4.0, via indigo-lab's
vector tiles), GSI DEM5A terrain and GSI aerial photographs. 89% of the footprint area stands at a
PLATEAU-surveyed height.

## Dressing and landmarks (`cities/jinbocho/city.py`)

- **The book town.** Shops and unclassed buildings within 22 m of Yasukuni-dori's south side (from
  the Jinbocho crossing to Surugadai-shita) and of Suzuran-dori behind it get boards and blade signs:
  old books, foreign books, art books, film, maps and prints, and the curry shops and coffee houses
  between them. Typical trades, no real shop's sign.
- **The carts of cheap books** (均一本): two or three wooden carts on castors before every other
  shop front that faces north, each with two tiers of spines. The shops on Yasukuni-dori face north,
  so the sun never fades the books in their windows.
- **Names on roofs.** Sanseido and Tokyo-do, their own words in an open mincho.
- **The Catholic Kanda Church** (Max Hinder, 1928; registered tangible cultural property): a
  three-aisled basilica, its nave over lower aisles under red tiles, round-arched windows, an apse
  and a front with an arched portal, a rose window and a cross. OpenStreetMap does not name it, so it
  is placed on the long basilica's footprint of block 1-1, Nishi-Kanda (the church's address is
  Nishi-Kanda 1-1-12); its orientation is a guess from the nearest main road.
- **Nikolai-do** by the Akihabara map's code (`cities/akihabara/city.py`, loaded here).

## Game

Jinbocho on Foot starts at the Jinbocho crossing. An antiquarian bookseller sends you to the carts and
round to Suzuran-dori for curry; the waitress sends you to a Meiji University student, who sends you
up to Nikolai-do. A church volunteer shows you the Kanda church. Station signs for Jinbocho,
Ochanomizu, Kudanshita and Suidobashi.

## Not checked

- The church's footprint and which way its front faces, against a survey or photographs from the
  street.
- The carts are on every other north-facing front; the real carts are where each shop puts them.
