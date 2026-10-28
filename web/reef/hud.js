// The player's heads-up display: plain DOM over the canvas. Depth, air, no-deco time, ascent rate,
// safety stop, breath, a compass, the local time and water temperature, a context prompt line
// ("E: put on mask") and a message line. The mask vignette is a CSS overlay shown while snorkelling
// or diving. hud.say(text) and hud.prompt(text) are for the game module.
const CSS = `
.rh { position: fixed; inset: 0; pointer-events: none; font: 13px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #e8f4f6; z-index: 5; --glass: rgba(4,32,44,.62); --edge: rgba(180,230,240,.22); --warn: #ffb347; --bad: #ff6b5e; --good: #7be0b0; }
.rh * { box-sizing: border-box; }
.rh-mask { position: absolute; inset: 0; opacity: 0; transition: opacity .5s; background:
  radial-gradient(ellipse 64% 58% at 50% 50%, transparent 58%, rgba(2,10,16,.55) 80%, rgba(0,4,8,.9) 100%); }
.rh-mask::after { content: ''; position: absolute; inset: 7% 9%; border-radius: 38% / 46%; box-shadow: 0 0 0 2px rgba(20,24,28,.22), inset 0 0 40px rgba(0,0,0,.25); }
.rh-mask.on { opacity: 1; }
.rh-compass { position: absolute; top: 10px; left: 50%; width: min(46vw, 340px); height: 30px; transform: translateX(-50%); overflow: hidden; border-radius: 15px; background: var(--glass); border: 1px solid var(--edge);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent); mask-image: linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent); }
.rh-compass i { position: absolute; top: 0; bottom: 0; width: 0; font-style: normal; text-align: center; }
.rh-compass i b { position: absolute; left: -12px; width: 24px; top: 5px; font-weight: 600; font-size: 12px; }
.rh-compass i.t { border-left: 1px solid rgba(232,244,246,.35); top: 20px; height: 10px; }
.rh-compass .mid { position: absolute; left: 50%; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #ffb347; opacity: .9; }
.rh-hdg { position: absolute; top: 44px; left: 50%; transform: translateX(-50%); font-size: 11px; opacity: .8; letter-spacing: .05em; text-shadow: 0 1px 3px #000; }
.rh-tr { position: absolute; top: 10px; right: 12px; text-align: right; padding: 6px 10px; border-radius: 10px; background: var(--glass); border: 1px solid var(--edge); font-variant-numeric: tabular-nums; }
.rh-tr small { opacity: .7; }
.rh-gauge { position: absolute; left: 12px; top: 10px; display: none; gap: 6px 14px; padding: 8px 12px; border-radius: 12px; background: var(--glass); border: 1px solid var(--edge); grid-template-columns: auto auto; font-variant-numeric: tabular-nums; }
.rh-gauge.on { display: grid; }
.rh-gauge .big { grid-column: 1 / -1; font-size: 30px; font-weight: 700; line-height: 1; }
.rh-gauge .big small { font-size: 13px; font-weight: 500; opacity: .75; margin-left: 4px; }
.rh-gauge div > small { display: block; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; opacity: .65; }
.rh-gauge div > span { font-size: 17px; font-weight: 600; }
.rh-gauge .bar { grid-column: 1 / -1; height: 6px; border-radius: 3px; background: rgba(255,255,255,.14); overflow: hidden; }
.rh-gauge .bar > b { display: block; height: 100%; background: #6fd3e6; width: 50%; transition: width .2s, background .3s; }
.rh-gauge .w { color: var(--warn); } .rh-gauge .b { color: var(--bad); } .rh-gauge .g { color: var(--good); }
.rh-bot { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); width: min(92vw, 560px); display: flex; flex-direction: column; align-items: center; gap: 8px; }
.rh-say { max-width: 100%; padding: 8px 14px; border-radius: 12px; background: var(--glass); border: 1px solid var(--edge); text-align: center; opacity: 0; transform: translateY(6px); transition: opacity .3s, transform .3s; }
.rh-say.on { opacity: 1; transform: none; } .rh-say.warn { border-color: var(--warn); } .rh-say.bad { border-color: var(--bad); } .rh-say.good { border-color: var(--good); }
.rh-prompt { padding: 6px 14px; border-radius: 999px; background: rgba(250,250,245,.92); color: #082633; font-weight: 600; opacity: 0; transition: opacity .2s; }
.rh-prompt.on { opacity: 1; }
.rh-prompt kbd { display: inline-block; min-width: 1.4em; padding: 0 5px; margin-right: 6px; border-radius: 5px; background: #082633; color: #fff; text-align: center; font: inherit; font-size: 12px; }
.rh-hint { font-size: 12px; opacity: .85; text-shadow: 0 1px 3px #000; text-align: center; }
.rh-help { position: absolute; right: 12px; bottom: 12px; font-size: 11px; opacity: .75; text-align: right; text-shadow: 0 1px 3px #000; max-width: 34ch; }
.rh-help.hide > div { display: none; }
.rh-flash { position: absolute; inset: 0; box-shadow: inset 0 0 90px 10px rgba(255,90,70,0); transition: box-shadow .4s; }
.rh-flash.on { box-shadow: inset 0 0 90px 10px rgba(255,90,70,.35); }
.rh-touch { position: absolute; inset: 0; display: none; }
.rh-touch.on { display: block; }
.rh-stick { position: absolute; left: 22px; bottom: 26px; width: 118px; height: 118px; border-radius: 50%; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.3); pointer-events: auto; touch-action: none; }
.rh-stick b { position: absolute; width: 50px; height: 50px; left: 34px; top: 34px; border-radius: 50%; background: rgba(255,255,255,.35); }
.rh-btns { position: absolute; right: 16px; bottom: 26px; display: grid; grid-template-columns: repeat(2, 58px); gap: 10px; pointer-events: auto; }
.rh-btns button { height: 58px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: rgba(8,38,51,.55); color: #fff; font: 600 13px system-ui; touch-action: none; }
.rh-btns button:active, .rh-btns button.d { background: rgba(255,255,255,.35); }
@media (max-width: 640px) { .rh { font-size: 12px; } .rh-gauge .big { font-size: 24px; } .rh-help { display: none; } .rh-tr { padding: 4px 8px; } .rh-gauge { padding: 6px 9px; top: 46px; } .rh-bot { bottom: 170px; } }
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
        if (g.bar !== undefined) { bar.style.width = (Math.min(1, Math.max(0, g.bar)) * 100).toFixed(0) + '%'; bar.style.background = g.barWarn ? '#ff8a65' : '#6fd3e6'; }
      }
    },
    help(on) { $('.rh-help').classList.toggle('hide', on === false || (on === undefined && !$('.rh-help').classList.contains('hide'))); },
    touch(on) { $('.rh-touch').classList.toggle('on', !!on); },
    parts: { stick: $('.rh-stick'), knob: $('.rh-stick b'), btns: el.querySelectorAll('.rh-btns button') },
    destroy() { el.remove(); }
  };
  return hud;
}
