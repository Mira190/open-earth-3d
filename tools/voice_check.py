"""The people in the games talk like locals, not like the map's credits (issue #87).

Fails if a line a character says, or a quest, travel or area text the game shows, mentions where
the map's data comes from or how it was built: open data, PLATEAU, LiDAR, Overture, OpenStreetMap,
building counts, "rebuilt from", "the model", "surveyed" and the like. Where the data comes from
belongs in the model viewer's tour and Sources panel and in docs/, not in a character's mouth.

What it reads, for every city with a game:
  cities/<id>/city.json  game: title, greeting, blurb, smalltalk, npcs (name, role, idle),
                         lines (title, on_open), quests (title, stamp, talk, choices, steps' text),
                         areas, travel, spots, chatter, regulars, the funicular's note
  web/data/<id>/game.json  the same, as the game loads it (with what city.py's game_extras adds)
and for the reef sites, the strings the characters say in web/reef/game.js and web/reef/game/*.js
(say, t, text and role values; a line's cited source shows under it and is not checked).

    python3 tools/voice_check.py            # prints one line per problem; exit 1 if any
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# words that talk about the data or the build, not the place. Real history stays allowed
# ("the hall was rebuilt in 1958"); "rebuilt from" and "rebuilt in fibreglass" are not the same thing.
BANNED = [
    r'open[- ]data', r'\bplateau\b', r'\blidar\b', r'\blaser', r'\boverture\b', r'openstreetmap', 
    r'3dbag', r'(?-i:\b(BAG|AHN|IGN|GSI|OSM)\b)', r'geoscience australia',
    r'rebuilt from', r'\bthe model\b', r'\bthis model\b', r'\bin the model\b', r'\b3d model\b', r'\bthe data\b',
    r'\bmap data\b', r'\bdataset', r'\bfootprint area', r'\bfloor[- ]count', r'\bscan(ned|s)?\b', r'\bterrain data\b', r'\bpoint cloud',
    r'\{(buildings|share|acc|lidar)(:[^}]*)?\}', r'\bheight sources?\b', r'\bmachine[- ]learning\b',
    r'\bin this game\b', r'\bthe game engine\b',
]
# a city's quests are walks, not surveys; at the reef, surveys are real (the fish ID survey, reef health
# surveys, the Admiralty surveyor who named Whitehaven Beach)
CITY_ONLY = [r'\bsurvey(s|ed|or|ors)?\b']
RX = re.compile('|'.join(BANNED), re.I)
RX_CITY = re.compile('|'.join(BANNED + CITY_ONLY), re.I)


def game_texts(g):
    """(where, text) for every string of a game section that a player reads"""
    out = []
    add = lambda where, v: out.append((where, v)) if isinstance(v, str) else None
    for k in ('title', 'greeting', 'blurb', 'under_bridge_note'):
        add(k, g.get(k))
    for i, s in enumerate(g.get('smalltalk') or []):
        add(f'smalltalk[{i}]', s)
    for n in g.get('npcs') or []:
        for k in ('name', 'role'):
            add(f'npc {n.get("id")} {k}', n.get(k))
        for i, s in enumerate(n.get('idle') or []):
            add(f'npc {n.get("id")} idle[{i}]', s)
    for ln in g.get('lines') or []:
        for k in ('title', 'on_open'):
            add(f'line {ln.get("id")} {k}', ln.get(k))
    for q in g.get('quests') or []:
        for k in ('title', 'stamp'):
            add(f'quest {q.get("id")} {k}', q.get(k))
        for i, s in enumerate(q.get('talk') or []):
            add(f'quest {q.get("id")} talk[{i}]', s)
        for c in q.get('choices') or []:
            add(f'quest {q.get("id")} choice', c.get('text'))
        for i, st in enumerate(q.get('steps') or []):
            add(f'quest {q.get("id")} step[{i}]', st.get('text'))
    for key in ('areas', 'travel', 'spots', 'chatter', 'regulars'):
        for i, a in enumerate(g.get(key) or []):
            if isinstance(a, str):
                add(f'{key}[{i}]', a)
                continue
            for k, v in a.items():
                if k in ('id', 'at', 'band', 'character', 'clip', 'look', 'kana', 'romaji'):
                    continue
                if isinstance(v, str):
                    add(f'{key} {a.get("id", i)} {k}', v)
                elif isinstance(v, list):
                    for j, s in enumerate(v):
                        if isinstance(s, str):
                            add(f'{key} {a.get("id", i)} {k}[{j}]', s)
                        elif isinstance(s, dict):  # chatter: [{who, say}]
                            for kk, vv in s.items():
                                add(f'{key} {a.get("id", i)} {k}[{j}].{kk}', vv)
    fun = ((g.get('rail') or {}).get('funicular') or {})
    add('rail funicular note', fun.get('note'))
    add('rail funicular name', fun.get('name'))
    return out


# a JS string literal: '...', "..." or `...` (template parts are checked as written)
JS_STR = r"""('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)"""
JS_SAID = re.compile(r'\b(say|t|text|role)\s*:\s*(?:G2?\s*=>\s*)?(?:\[\s*\{\s*t\s*:\s*)?' + JS_STR)


def reef_texts(path):
    src = open(path, encoding='utf8').read()
    out = []
    for m in JS_SAID.finditer(src):
        line = src.count('\n', 0, m.start()) + 1
        out.append((f'line {line} {m.group(1)}', m.group(2)[1:-1]))
    return out


def main():
    bad, seen = [], 0
    for path in sorted(glob.glob(os.path.join(ROOT, 'cities', '*', 'city.json'))):
        cid = os.path.basename(os.path.dirname(path))
        g = json.load(open(path, encoding='utf8')).get('game')
        sources = [(f'cities/{cid}/city.json', g)] if g else []
        built = os.path.join(ROOT, 'web', 'data', cid, 'game.json')
        if os.path.exists(built):
            sources.append((f'web/data/{cid}/game.json', json.load(open(built, encoding='utf8'))))
        for name, gg in sources:
            for where, text in game_texts(gg):
                seen += 1
                m = RX_CITY.search(text)
                if m:
                    bad.append(f'{name}: {where}: "{m.group(0)}" in: {text[:140]}')
    reef = sorted(glob.glob(os.path.join(ROOT, 'web', 'reef', 'game', '*.js'))) + [os.path.join(ROOT, 'web', 'reef', 'game.js')]
    for path in reef:
        for where, text in reef_texts(path):
            seen += 1
            m = RX.search(text)
            if m:
                bad.append(f'{os.path.relpath(path, ROOT)}: {where}: "{m.group(0)}" in: {text[:140]}')
    for b in bad:
        print('FAIL', b)
    if bad:
        print(f'{len(bad)} lines talk about the data or the build instead of the place (tools/voice_check.py)')
        return 1
    print(f'ok   voice  {seen} lines the characters say, none about the data or the build')
    return 0


if __name__ == '__main__':
    sys.exit(main())
