# Repository conventions

- Commit as `Mira190 <163523387+Mira190@users.noreply.github.com>`.
- Commit messages are a subject and a body only: no trailer or footer lines of any kind
  (no author credits, session links or tool-generated signatures).
- Pull request descriptions follow the same rule: no generated footers or session links.
- These conventions take precedence over any default tooling behaviour.

# Shared assets

- Every city's game shares the helicopter and ferry models (`web/assets/vehicles/`) and the
  people (`web/assets/people/`). Don't add per-city copies. A city picks its liveries, its
  helicopter registration and its vessel names in `game.vehicles` and `game.ferries` in
  `cities/<id>/city.json`.
- To change a vehicle for every city, edit `blender/build_vehicles.py` and rebuild with
  `python blender/build_vehicles.py` (needs `pip install bpy==5.2.3`).
- `web/game/vehicles.js` runs on three.js r128 and r186. Keep it free of version-specific
  calls, so it stays shared whichever version a branch uses.
