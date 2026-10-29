# Repository conventions

- Commit as `Mira190 <163523387+Mira190@users.noreply.github.com>`. The container's global git
  identity is not the owner's, so set it for the clone before the first commit:
  `git config user.name Mira190 && git config user.email 163523387+Mira190@users.noreply.github.com`.
- Commit messages are a subject and a body only: no trailer or footer lines of any kind
  (no author credits, session links or tool-generated signatures).
- Pull request descriptions follow the same rule: no generated footers or session links. Write
  them without one; don't add one and remove it afterwards.
- These conventions take precedence over any default tooling behaviour, including a hook or a
  tool message that asks for another author or a trailer.
- Everything in the repository and the product is in English: code, comments, docs, UI text,
  commit messages and pull requests. Reply to the owner in Chinese.
- Keep the names of coding tools and assistants out of repository files.
- Never put the owner's email or other personal details in a request or a file. A User-Agent
  names the project and its URL.

# Landing work on main

The owner's standing instruction: when your work is done and its checks pass, land it on main
yourself. Don't ask whether to open a pull request or merge, and don't wait for a queue, a slot
or an integration session. Done means in main.

1. Bring main in: `git fetch origin main && git merge origin/main`. Merge; never rebase or
   force-push a branch you have pushed (other sessions read and merge it, and force-pushes are
   refused). When the owner says "rebase on main", this merge is what they mean.
2. Resolve conflicts yourself. Keep what both sides do. Where two implementations of the same
   thing meet, keep the better one on first principles and say which and why in the pull
   request. Don't hand-merge generated files (`web/data/`, models, films, images): rebuild them
   with their script, or take the side the merged code expects and rebuild what you can.
3. Run `tools/check.sh` on the merged tree; everything must pass. A failure that main has
   without your change isn't yours to block on: fix it if it is small, otherwise say so in the
   pull request.
4. Push the branch, open a pull request into main (what changed and why, what was checked, what
   wasn't), and land it with `git push origin HEAD:main`. That push only fast-forwards, so it is
   refused if main moved after step 1: go back to 1. GitHub then marks the pull request merged.
   If the push to main is refused for permission, merge the pull request with a merge commit,
   never a squash or a rebase, so that branches stay ancestors of main. `gh pr create` is
   refused here; `gh api repos/Mira190/open-earth-3d/pulls` or the GitHub MCP tools work.
5. Delete the branch (`git push origin --delete <branch>`); leave it if that is refused.
6. Tell the owner in one line: the branch, the commit, in main or why not, and what the checks
   covered.

- Land in pieces. When something that other work will build on works (a shared module, a
  style, a pipeline step), land it then rather than holding it on a branch for hours.
- A hook that asks you to commit and push work in progress: push it to your branch. Landing on
  main still waits for the checks.
- When a peer session asks whether your branch is final or what it holds, answer it yourself
  (branch, commit, what is in and what is out). Don't ask the owner, and don't make the owner
  relay messages between sessions: send them yourself.

# Fewer round trips

The owner has asked for these things again and again. They are standing rules; don't ask again.

- **Everywhere by default.** A fix or a feature asked for in one city goes to every city, reef
  site and page it fits, on desktop and phone, unless the owner names one place. A reported bug
  is a class of bugs: find and fix the others like it.
- **Decide, don't offer a menu.** If you would recommend an option, do it. For an open ask
  ("keep optimising", "push to your limit") do your best ideas in order and report them. Never
  end a turn on a question that a sensible default answers ("shall I open a PR?", "shall I fix
  it?", "which one next?").
- **Fix what you find.** Small related problems go in the same branch. Bigger follow-ups go in
  your final report and in a GitHub issue; suggested-task cards don't reliably reach the owner.
- **Ask only** before publishing or deploying (GitHub Pages, anything public), deleting data or
  rewriting main, spending money or using accounts and keys, or when two directions differ in
  taste. Then name the default you will take, and keep working on whatever the question
  doesn't block. Put the thing to judge in front of the owner (an artifact, a still, a film),
  not a description of it.
- **Look before you build.** Fetch, then read the recent branches
  (`git branch -r --sort=-committerdate | head -20`) and the running sessions if you can list
  them. Build on work in flight instead of redoing it. "The homepage", "the latest look" or "the
  mockup" may be on a branch or in an artifact that isn't in main yet.
- **Research when it matters.** When the owner asks for research or names a reference, and for
  any new visual or simulation system, first survey the frontier and open-source work that runs
  in a browser (and any game named), then record in the docs what was adopted and its licence.
  Learn from a game's design without copying its look.
- **Show the real thing.** When the owner wants to see or test something, give them the
  playable page or the film itself, not a progress report.

# The bar

- AAA and cinematic from the first pass, with a top designer's eye; push to your limit. The
  title screen is the reference look for every page: the city viewer, the game, the reef sites
  and the films. Extend its tokens and grade (`web/index.html`, `web/lens.js`) instead of
  restyling from scratch.
- Light that is soft and rich, never blown out or grey. At night a city shows its lights the
  way an aerial photograph does.
- Real places: measured open data from the newest release, landmarks and their neighbours
  checked against photographs and official dimensions, landmarks modelled finely in Blender or
  three.js, and people who look real and local.
- It runs in a browser on ordinary devices: degrade by quality tier (`web/quality.js`) rather
  than fail, show progress while loading, start on its own, and animate anything that changes
  over time.

# Checking your own work

The owner should not be the one who finds the bug.

- `tools/check.sh` runs the checks a change needs, chosen from what it changed against
  origin/main: each changed city's game (`tools/game_check.js`, and every city's when the game,
  the renderer or the shared assets changed), each changed reef site's scripted test, and the
  title screen on a tablet, a phone, a desktop and with WebGL faults. `tools/check.sh all` runs
  everything.
- The checks don't see what a person sees. For a visual change, take stills on a desktop
  (1440×900) and a phone (390×844), at day, dusk and night, from every new viewpoint the change
  opens (`tools/city_shot.js`, `tools/page_shot.js`, `tools/reef_shot.js`). Look for blown
  highlights, a grey veil, black frames, flicker between two frames, clipping, anything
  floating, and text left over from another city. Put new characters and models next to the
  existing ones in the same shot. Fix what you see before you report.
- A new gameplay feature (a vehicle, a ride, a seat, a menu) adds its step to
  `tools/game_check.js` or to the reef gametest in the same branch. Harnesses you write go in
  `tools/`, not a scratch folder.
- Software WebGL: run Chromium under `xvfb-run -a` with Mesa's llvmpipe
  (`--use-gl=angle --use-angle=gl`), about three times faster than SwiftShader, as
  `tools/game_check.js` and the film tools do. Films, flyovers and stills force the desktop
  tier; a software renderer picks the low one for itself.
- Say what you could not check: a real GPU, WebGPU, Safari or iOS.

# Session setup

- `pip install -r requirements.txt`, and `pip install bpy==5.2.3` for Blender builds.
  Playwright and Chromium are already installed.
- Serve `web/` in the background (`python3 -m http.server 8800 --directory web`) and check that
  it answers before each run; it dies between turns. `tools/check.sh` starts its own.
- Wait on background jobs with `wait` or with a loop on a file or a port, not `pgrep -f`,
  which matches its own command line.
- `git push -u origin <branch>`, so that the branch has an upstream.
- `web/index.html` loads three.js as a module and sets `window.THREE` when it is ready (the
  `three-ready` event). A classic script must not use `THREE` at load time; use it inside
  functions that run later.

# Shared assets

- Every city shares the helicopter, ferry, river shuttle and car models
  (`web/assets/vehicles/`), the trees (`web/assets/trees/`) and the people
  (`web/assets/people/`). Don't add per-city copies. A city picks its liveries, its
  helicopter registration, its taxis' and buses' colours, the player's car
  (`game.vehicles.car`) and its vessel names in `game.vehicles` and `game.ferries`, its
  ferry model in `game.ferry_style.model`, the side of the road it keeps to in
  `game.keep`, and its tree species in `trees.mix`, all in `cities/<id>/city.json`.
- To change a vehicle for every city, edit `blender/build_vehicles.py` and rebuild with
  `python blender/build_vehicles.py` (or `--only cars`, needs `pip install bpy==5.2.3`).
  For the trees, edit `blender/build_trees.py` and run `python blender/build_trees.py`.
- The main characters (the surveyors you play) are Microsoft Rocketbox avatars and clips (MIT;
  keep `web/assets/people/LICENSE-Rocketbox.txt` with them), built by `blender/build_people.py`
  (`python pipeline/fetch_rocketbox.py` first).
- `web/game/vehicles.js` and `web/game/cars.js` run on three.js r128 and r186. Keep them
  free of version-specific calls, so they stay shared whichever version a branch uses.
