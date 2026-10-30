// The player's heads-up display: plain DOM over the canvas. Depth, air, no-deco time, ascent rate,
// safety stop, breath, a compass, the local time and water temperature, a context prompt line
// ("E: put on mask") and a message line. The mask vignette is a CSS overlay shown while snorkelling
// or diving. hud.say(text) and hud.prompt(text) are for the game module.
const CSS = `
.rh { position: fixed; inset: 0; pointer-events: none; z-index: 5; font: 400 13px/1.45 "Inter Tight", "Public Sans", system-ui, -apple-system, 'Segoe UI', sans-serif; color: #ece8e1;
  -webkit-font-smoothing: antialiased; --glass: rgba(6,10,18,.7); --edge: rgba(236,232,225,.14); --edge2: rgba(236,232,225,.3); --muted: #8a93a3; --faint: #5b6472;
  --warn: #ffb066; --bad: #ff6f61; --good: #63d39a; --blur: blur(22px) saturate(1.15);
  --mono: "JetBrains Mono", ui-monospace, Menlo, monospace; --display: "Zalando Sans Expanded", "Michroma", system-ui, sans-serif; }
.rh * { box-sizing: border-box; }
.rh-mask { position: absolute; inset: 0; opacity: 0; transition: opacity .5s; background:
  radial-gradient(ellipse 64% 58% at 50% 50%, transparent 58%, rgba(2,4,8,.55) 80%, rgba(0,2,4,.9) 100%); }
.rh-mask::after { content: ''; position: absolute; inset: 7% 9%; border-radius: 38% / 46%; box-shadow: 0 0 0 2px rgba(20,24,28,.22), inset 0 0 40px rgba(0,0,0,.25); }
.rh-mask.on { opacity: 1; }
/* glass and hairlines, as on the title and in the cities */
.rh-compass, .rh-tr, .rh-gauge, .rh-say { background: var(--glass); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur); border: 1px solid var(--edge); border-radius: 2px; }
.rh-compass { position: absolute; top: 16px; left: 50%; width: min(46vw, 340px); height: 30px; transform: translateX(-50%); overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent); mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent); }
.rh-compass i { position: absolute; top: 0; bottom: 0; width: 0; font-style: normal; text-align: center; }
.rh-compass i b { position: absolute; left: -12px; width: 24px; top: 6px; font: 400 9.5px/1 var(--mono); letter-spacing: .1em; color: #ece8e1; }
.rh-compass i.t { border-left: 1px solid rgba(236,232,225,.3); top: 21px; height: 8px; }
.rh-compass .mid { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--warn); box-shadow: 0 0 6px rgba(255,176,102,.6); }
.rh-hdg { position: absolute; top: 54px; left: 50%; transform: translateX(-50%); font: 400 9.5px/1 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--muted);
  text-shadow: 0 1px 3px rgba(0,0,0,.8); }
.rh-tr { position: absolute; top: 16px; right: 16px; display: flex; gap: 10px; align-items: baseline; padding: 8px 12px; }
.rh-tr .clock { font: 300 17px/1 var(--display); letter-spacing: .06em; color: #fff; font-variant-numeric: tabular-nums; }
.rh-tr small { font: 400 9.5px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.rh-gauge { position: absolute; left: 16px; top: 16px; display: none; gap: 10px 22px; padding: 13px 16px 14px; grid-template-columns: auto auto; }
.rh-gauge.on { display: grid; }
.rh-gauge .big { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 8px; font: 200 36px/1 var(--display); letter-spacing: .02em; color: #fff; font-variant-numeric: tabular-nums; }
.rh-gauge .big small { font: 400 9.5px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.rh-gauge .cell { display: flex; flex-direction: column; gap: 6px; }
.rh-gauge .cell > small { font: 400 8.5px/1.2 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.rh-gauge .cell > span { font: 300 15px/1.1 var(--display); letter-spacing: .04em; color: #fff; font-variant-numeric: tabular-nums; }
.rh-gauge .bar { grid-column: 1 / -1; height: 2px; background: rgba(236,232,225,.14); overflow: hidden; }
.rh-gauge .bar > b { display: block; height: 100%; background: #ece8e1; width: 50%; transition: width .2s, background .3s; }
.rh-gauge .w, .rh-gauge .cell > .w { color: var(--warn); } .rh-gauge .b, .rh-gauge .cell > .b { color: var(--bad); } .rh-gauge .g, .rh-gauge .cell > .g { color: var(--good); }
.rh-bot { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); width: min(92vw, 560px); display: flex; flex-direction: column; align-items: center; gap: 10px; }
.rh-say { max-width: 100%; padding: 10px 16px; text-align: center; font-size: 13px; line-height: 1.45; opacity: 0; transform: translateY(6px); transition: opacity .4s, transform .4s; }
.rh-say.on { opacity: 1; transform: none; } .rh-say.warn { border-color: rgba(255,176,102,.6); } .rh-say.bad { border-color: rgba(255,111,97,.7); } .rh-say.good { border-color: rgba(99,211,154,.6); }
.rh-prompt { display: flex; gap: 10px; align-items: center; padding: 6px 15px 6px 6px; border-radius: 2px; background: var(--glass); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur);
  border: 1px solid var(--edge); color: #fff; font: 500 13px/1.2 "Inter Tight", system-ui, sans-serif; opacity: 0; transition: opacity .25s; }
.rh-prompt.on { opacity: 1; }
.rh-prompt kbd { display: inline-grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 2px; background: var(--warn); color: #1a0f04; font: 400 11px/1 var(--mono); letter-spacing: .04em; }
.rh-hint { font-size: 12px; color: #c3c6cc; text-shadow: 0 1px 3px rgba(0,0,0,.8); text-align: center; }
.rh-help { position: absolute; right: 16px; bottom: 16px; font: 400 9px/1.8 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: rgba(236,232,225,.8); text-align: right;
  text-shadow: 0 1px 2px rgba(0,0,0,.9), 0 0 10px rgba(0,0,0,.55); max-width: 46ch; }
.rh-help.hide > div { display: none; }
.rh-flash { position: absolute; inset: 0; box-shadow: inset 0 0 90px 10px rgba(255,90,70,0); transition: box-shadow .4s; }
.rh-flash.on { box-shadow: inset 0 0 90px 10px rgba(255,90,70,.35); }
.rh-touch { position: absolute; inset: 0; display: none; }
.rh-touch.on { display: block; }
.rh-stick { position: absolute; left: 22px; bottom: 26px; width: 118px; height: 118px; border-radius: 50%; background: rgba(6,10,18,.4); border: 1px solid var(--edge2); pointer-events: auto; touch-action: none; }
.rh-stick b { position: absolute; width: 50px; height: 50px; left: 34px; top: 34px; border-radius: 50%; background: rgba(236,232,225,.3); }
.rh-btns { position: absolute; right: 16px; bottom: 26px; display: grid; grid-template-columns: repeat(2, 58px); gap: 10px; pointer-events: auto; }
.rh-btns button { height: 58px; border-radius: 50%; border: 1px solid var(--edge2); background: rgba(6,10,18,.55); color: #ece8e1; font: 400 9px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; touch-action: none; }
.rh-btns button:active, .rh-btns button.d { background: rgba(255,176,102,.3); border-color: var(--warn); }
@media (max-width: 940px) { .rh-gauge { top: 70px; } }
@media (max-width: 940px) and (max-height: 500px) { .rh-gauge { grid-template-columns: repeat(4, auto); } }
@media (pointer: coarse) { .rh-help { display: none; } }
@media (max-width: 640px) { .rh { font-size: 12px; } .rh-gauge .big { font-size: 26px; } .rh-help { display: none; } .rh-tr { padding: 6px 9px; } .rh-gauge { padding: 8px 10px; } .rh-bot { bottom: 170px; } }
`;

const CARD = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const pad2 = n => String(n).padStart(2, '0');

export function createHud(root = document.body, opts = {}) {
  if (!document.getElementById('rh-css')) { const s = document.createElement('style'); s.id = 'rh-css'; s.textContent = CSS; document.head.appendChild(s); }
  const el = document.createElement('div');
  el.className = 'rh';
  el.innerHTML = `
  <div class="rh-mask"></div><div class="rh-flash"></div>
  <div class="rh-compass"><div class="mid"></div></div><div class="rh-hdg"></div>
  <div class="rh-tr"><div class="clock"></div><small class="temp"></small></div>
  <div class="rh-gauge">
    <div class="big"><span class="depth">0.0</span><small>m</small></div>
    <div class="bar"><b></b></div>
  </div>
  <div class="rh-bot"><div class="rh-say"></div><div class="rh-hint"></div><div class="rh-prompt"></div></div>
  <div class="rh-help"><div>WASD move · Shift run/fast · Space jump/up · Ctrl dive/down<br>E use · V view · F/G BCD in/out · Q equalise · B blow · H help</div></div>
  <div class="rh-touch"><div class="rh-stick"><b></b></div><div class="rh-btns"><button data-k="Space">Up</button><button data-k="ControlLeft">Dive</button><button data-k="KeyE">Use</button><button data-k="KeyV">View</button></div></div>`;
  root.appendChild(el);
  const $ = s => el.querySelector(s);
  const cmp = $('.rh-compass'), hdg = $('.rh-hdg'), say = $('.rh-say'), prm = $('.rh-prompt'), hint = $('.rh-hint'), gauge = $('.rh-gauge');
  // compass strip: a label every 45 degrees, a tick every 15
  const tickEls = [];
  for (let a = 0; a < 360; a += 15) {
    const i = document.createElement('i'); if (a % 45 === 0) i.innerHTML = `<b>${CARD[a / 45]}</b>`; else i.className = 't'; i.dataset.a = a; cmp.appendChild(i); tickEls.push(i);
  }
  let sayT = 0, manual = '', auto = '', hintT = 0;
  const showPrompt = () => {
    const t = manual || auto;
    prm.classList.toggle('on', !!t);
    if (t) { const m = /^([A-Za-z0-9\/ +]{1,10}):\s*(.*)$/.exec(t); prm.innerHTML = m ? `<kbd>${m[1]}</kbd>${m[2]}` : t; }
  };
  const hud = {
    el,
    // a message line that fades after `secs`
    say(text, o = {}) {
      const secs = typeof o === 'number' ? o : o.secs ?? 4.5, kind = typeof o === 'string' ? o : o.kind || '';
      say.textContent = text; say.className = 'rh-say on ' + kind; sayT = secs;
      if (kind === 'bad') { $('.rh-flash').classList.add('on'); setTimeout(() => $('.rh-flash').classList.remove('on'), 700); }
    },
    // the game's prompt line, kept until cleared with prompt('') or prompt(null)
    prompt(text) { manual = text || ''; showPrompt(); },
    // the player's own prompt (nearby interaction); the game's prompt wins
    promptAuto(text) { if (auto !== (text || '')) { auto = text || ''; showPrompt(); } },
    hint(text, secs = 8) { hint.textContent = text || ''; hintT = text ? secs : 0; },
    mask(on) { $('.rh-mask').classList.toggle('on', !!on); },
    // per frame: s = { heading, clockMs, tz, temp, tempAt, gauge: null | { depth, air?, ndl?, rate?, stop?, breath?, ... } }
    update(dt, s) {
      sayT -= dt; if (sayT <= 0) say.classList.remove('on');
      hintT -= dt; if (hintT <= 0 && hint.textContent) hint.textContent = '';
      const h = ((s.heading % 360) + 360) % 360, W = cmp.clientWidth || 300, span = 120;   // degrees across the strip
      for (const i of tickEls) { let d = ((+i.dataset.a - h + 540) % 360) - 180; i.style.left = (W / 2 + d / span * W) + 'px'; i.style.display = Math.abs(d) < span / 2 + 8 ? '' : 'none'; }
      hdg.textContent = `${pad2(Math.round(h) % 360).padStart(3, '0')}° ${CARD[Math.round(h / 45) % 8]}`;
      if (s.clockMs !== undefined) {
        const f = new Intl.DateTimeFormat('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: s.tz || 'Australia/Brisbane' });
        $('.clock').textContent = f.format(new Date(s.clockMs));
      }
      $('.temp').textContent = s.temp !== undefined ? `Sea ${s.temp.toFixed(0)} °C` : '';
      const g = s.gauge;
      gauge.classList.toggle('on', !!g);
      if (g) {
        $('.depth').textContent = g.depth.toFixed(1);
        $('.big small').textContent = 'm' + (g.label ? ' · ' + g.label : '');
        // up to four readouts: [{ k: 'Air', v: '210 bar', c: 'w' }]
        const cells = g.cells || [], key = cells.map(c => c.k).join('|');
        if (gauge.dataset.key !== key) {
          gauge.dataset.key = key;
          gauge.querySelectorAll('.cell').forEach(n => n.remove());
          for (const c of cells) { const d = document.createElement('div'); d.className = 'cell'; d.innerHTML = `<small>${c.k}</small><span></span>`; gauge.insertBefore(d, $('.bar')); }
        }
        gauge.querySelectorAll('.cell').forEach((n, i) => { const sp = n.querySelector('span'); sp.textContent = cells[i].v; sp.className = cells[i].c || ''; });
        const bar = $('.bar b'); $('.bar').style.display = g.bar === undefined ? 'none' : '';
        if (g.bar !== undefined) { bar.style.width = (Math.min(1, Math.max(0, g.bar)) * 100).toFixed(0) + '%'; bar.style.background = g.barWarn ? '#ff6f61' : '#ece8e1'; }
      }
    },
    help(on) { $('.rh-help').classList.toggle('hide', on === false || (on === undefined && !$('.rh-help').classList.contains('hide'))); },
    touch(on) { $('.rh-touch').classList.toggle('on', !!on); },
    parts: { stick: $('.rh-stick'), knob: $('.rh-stick b'), btns: el.querySelectorAll('.rh-btns button') },
    destroy() { el.remove(); }
  };
  return hud;
}
