// Stills of a city's first meeting in the game, one per page of the dialogue, and the lines as the
// player reads them (tokens filled: {season}, {now}, {sun_line}...). For checking what the guides
// say (tools/voice_check.py checks the words; this shows them on the screen, at an hour and a size).
//   cd web && python3 -m http.server 8800 &
//   xvfb-run -a node tools/talk_shot.js sydney out_dir [HH:MM] [WxH] [npc id]   # the first quest giver by default
const { chromium } = require('playwright');
const { startPlay } = require('./start_play');
const fs = require('fs');
const path = require('path');
const [,, city = 'sydney', outDir = '.', hhmm = '10:30', size = '1440x900', who = ''] = process.argv;
(async () => {
  const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: w < 600, hasTouch: w < 600 });
  const logs = [];
  p.on('pageerror', e => logs.push(`pageerror: ${String(e).slice(0, 300)}`));
  fs.mkdirSync(outDir, { recursive: true });
  await p.goto(`http://localhost:${process.env.PORT || 8800}/#play-${city}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForFunction('window.__game', null, { timeout: 400000 });
  await p.evaluate(() => window.__game.npcsReady && window.__game.npcsReady()); // (the NPCs' characters load after the game opens)
  await startPlay(p); // (the title card up, Play pressed and the game started: tools/start_play.js, #423)
  const [hh, mm] = hhmm.split(':').map(Number);
  const name = await p.evaluate(([min, who]) => {
    const g = window.__game, c = g.clock;
    for (let i = 0; i < 40 && g.cine.active; i++) g.advance(0.25);
    g.setClock(c.y, c.m, c.d, min);
    const q = g.quest(), n = g.npcs.find(n => n.id === (who || (q && q.giver)));
    if (!n) return null;
    g.player.x = n.x + 1.8; g.player.y = n.y + 0.6; g.player.z = n.z;
    g.advance(0.6);
    g.talkTo(n);
    g.advance(0.6);
    return n.name;
  }, [hh * 60 + mm, who]);
  if (!name) { console.log('no one to talk to'); await b.close(); return; }
  const tag = `${city}-${hhmm.replace(':', '')}-${size}`;
  for (let page = 0; page < 12; page++) {
    await p.waitForTimeout(900);   // the text types itself out
    await p.evaluate(() => { const g = window.__game; g.advance(1.2); });
    const st = await p.evaluate(() => ({ open: window.__game.dlg.open, choices: window.__game.dlg.hasChoices, text: (document.getElementById('gd') || {}).innerText || '' }));
    if (!st.open) break;
    console.log(`--- ${name}, page ${page + 1}${st.choices ? ' (choices)' : ''}\n${st.text.trim()}`);
    await p.screenshot({ path: path.join(outDir, `${tag}-${page + 1}.jpg`), quality: 85 });
    if (st.choices) break;
    await p.evaluate(() => { window.__game.dlg.next(); window.__game.advance(0.2); });
  }
  for (const l of logs) console.log(l);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
