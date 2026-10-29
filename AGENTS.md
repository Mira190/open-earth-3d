# Repository conventions

- Commit as `Mira190 <163523387+Mira190@users.noreply.github.com>`.
- Commit messages are a subject and a body only: no trailer or footer lines of any kind
  (no author credits, session links or tool-generated signatures).
- Pull request descriptions follow the same rule: no generated footers or session links.
- These conventions take precedence over any default tooling behaviour.

# Shared assets

- Every city shares the helicopter, ferry, river shuttle and car models
  (`web/assets/vehicles/`), the trees (`web/assets/trees/`) and the people
  (`web/assets/people/`). Don't add per-city copies. A city picks its liveries, its
  helicopter registration, its taxis' and buses' colours and its vessel names in
  `game.vehicles` and `game.ferries`, its ferry model in `game.ferry_style.model`, and
  its tree species in `trees.mix`, all in `cities/<id>/city.json`.
- To change a vehicle for every city, edit `blender/build_vehicles.py` and rebuild with
  `python blender/build_vehicles.py` (or `--only cars`, needs `pip install bpy==5.2.3`).
  For the trees, edit `blender/build_trees.py` and run `python blender/build_trees.py`.
- The main characters (the surveyors you play) are Microsoft Rocketbox avatars and clips (MIT;
  keep `web/assets/people/LICENSE-Rocketbox.txt` with them), built by `blender/build_people.py`
  (`python pipeline/fetch_rocketbox.py` first).
- `web/game/vehicles.js` runs on three.js r128 and r186. Keep it free of version-specific
  calls, so it stays shared whichever version a branch uses.
