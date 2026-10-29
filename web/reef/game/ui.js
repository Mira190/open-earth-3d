// The game's own HUD layer, over hud.js and in its style (the same glass, edge and type): a dialogue panel
// with numbered answers (keys 1-4, or tap), a journal, a travel map and the time of day as centred panels, three
// buttons for touch (Journal J, Map T, Time K), the objective line under the compass with a marker on the compass strip,
// toasts for quest steps, and a fade for skip-the-trip transfers. Plain DOM; game.js decides what goes in.
const CSS = `
.rg { position: fixed; inset: 0; pointer-events: none; z-index: 6; font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #e8f4f6;
  --glass: rgba(4,32,44,.62); --panel: rgba(4,30,42,.92); --solid: rgba(3,24,34,.97); --edge: rgba(180,230,240,.22); --warn: #ffb347; --good: #7be0b0; --accent: #6fd3e6; --ink2: rgba(232,244,246,.72); }
.rg * { box-sizing: border-box; }
.rg kbd { display: inline-block; min-width: 1.5em; padding: 0 5px; border-radius: 5px; background: #082633; color: #fff; border: 1px solid rgba(255,255,255,.25); text-align: center; font: 600 11px/1.6 system-ui, sans-serif; }
.rg a { color: var(--accent); }
.rg-btns { position: absolute; top: 108px; right: 12px; display: flex; gap: 6px; pointer-events: auto; }
.rg-btns button { display: flex; align-items: center; gap: 6px; padding: 5px 10px 5px 8px; border-radius: 999px; background: var(--glass); border: 1px solid var(--edge); color: inherit; font: 600 12px system-ui, sans-serif; cursor: pointer; }
.rg-btns button:hover, .rg-btns button.on { background: rgba(20,70,90,.85); }
.rg-btns button b { min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--warn); color: #082633; font-size: 10px; line-height: 16px; display: none; }
.rg-btns button b.on { display: inline-block; }
.rg-obj { position: absolute; top: 10px; left: 12px; width: min(42vw, 280px); padding: 6px 10px 7px; border-radius: 12px; background: var(--glass); border: 1px solid var(--edge);
  opacity: 0; transition: opacity .3s, top .3s; }
.rg-obj.on { opacity: 1; } .rg-obj small { display: block; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--warn); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rg-obj span { display: block; font-size: 12.5px; line-height: 1.3; } .rg-obj em { display: block; font-style: normal; font-size: 11px; color: var(--ink2); margin-top: 1px; }
.rg-mark { position: absolute; top: 12px; left: 0; width: 14px; height: 26px; margin-left: -7px; display: none; color: var(--warn); font: 700 15px/26px system-ui; text-align: center; text-shadow: 0 0 4px #000; }
.rg-mark.on { display: block; }
.rg-dlg { position: absolute; left: 16px; bottom: 64px; transform: translateY(8px); width: min(44vw, 500px); max-height: calc(100vh - 150px); overflow: auto; padding: 11px 14px; border-radius: 14px; background: var(--panel);
  border: 1px solid var(--edge); box-shadow: 0 8px 30px rgba(0,0,0,.35); pointer-events: auto; opacity: 0; visibility: hidden; transition: opacity .2s, transform .2s, visibility 0s .2s; }
.rg-dlg.on { opacity: 1; visibility: visible; transform: none; transition: opacity .2s, transform .2s; }
.rg-dlg .who { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; } .rg-dlg .who b { font-size: 14px; color: var(--accent); } .rg-dlg .who small { color: var(--ink2); }
.rg-dlg .who em { margin-left: auto; font-style: normal; font-size: 11px; color: var(--ink2); }
.rg-dlg .who .x { width: 26px; height: 24px; margin: -3px -6px 0 2px; border: 0; border-radius: 7px; background: none; color: var(--ink2); font: 600 12px system-ui; cursor: pointer; }
.rg-dlg .who .x:hover { background: rgba(255,255,255,.1); color: inherit; }
.rg-dlg .txt { font-size: 14.5px; line-height: 1.45; }
.rg-dlg .src { margin-top: 6px; font-size: 11px; color: var(--ink2); } .rg-dlg .src:empty { display: none; }
.rg-dlg .src span + span::before { content: ' · '; }
.rg-dlg .ch { display: grid; gap: 5px; margin-top: 9px; } .rg-dlg .ch:empty { display: none; }
.rg-dlg .ch button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 5px 10px; border-radius: 9px; border: 1px solid var(--edge); background: rgba(255,255,255,.06);
  color: inherit; font: 500 13.5px system-ui, sans-serif; text-align: left; cursor: pointer; }
@media (pointer: coarse) { .rg-dlg .ch button { min-height: 42px; } }
.rg-dlg .ch button:hover, .rg-dlg .ch button:focus-visible { background: rgba(111,211,230,.18); outline: none; border-color: var(--accent); }
.rg-dlg .more { margin-top: 6px; font-size: 11px; color: var(--ink2); text-align: right; } .rg-dlg .more:empty { display: none; }
.rg-panel { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(94vw, 680px); max-height: min(90vh, 760px); display: none; flex-direction: column; border-radius: 16px;
  background: var(--solid); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); border: 1px solid var(--edge); box-shadow: 0 12px 40px rgba(0,0,0,.45); pointer-events: auto; }
.rg-panel.on { display: flex; }
.rg.panel-on .rg-obj, .rg.panel-on .rg-mark { visibility: hidden; }
.rg-panel header { display: flex; align-items: center; gap: 10px; padding: 9px 14px 8px; border-bottom: 1px solid var(--edge); }
.rg-panel header h2 { margin: 0; font-size: 16px; } .rg-panel header small { color: var(--ink2); }
.rg-panel header button { margin-left: auto; min-width: 36px; height: 32px; border-radius: 8px; border: 1px solid var(--edge); background: rgba(255,255,255,.06); color: inherit; cursor: pointer; font: 600 13px system-ui; }
.rg-panel .body { overflow: auto; padding: 4px 14px 14px; }
.rg-panel h3 { margin: 12px 0 5px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink2); font-weight: 600; }
.rg-panel ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.rg-panel li { padding: 6px 10px; border-radius: 9px; background: rgba(255,255,255,.05); border: 1px solid transparent; }
.rg-panel li.track { border-color: var(--warn); } .rg-panel li.done { opacity: .7; } .rg-panel li.off { opacity: .5; }
.rg-panel li b { font-size: 13.5px; } .rg-panel li .st { color: var(--warn); } .rg-panel li.done .st { color: var(--good); }
.rg-panel li p { margin: 2px 0 0; } .rg-panel li small { color: var(--ink2); display: block; margin-top: 1px; font-size: 11px; }
.rg-panel li .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rg-panel li .row > :last-child { margin-left: auto; }
.rg-panel .act { min-height: 28px; padding: 2px 10px; border-radius: 8px; border: 1px solid var(--accent); background: rgba(111,211,230,.14); color: inherit; font: 600 13px system-ui; cursor: pointer; }
@media (pointer: coarse) { .rg-panel .act { min-height: 38px; } }
.rg-panel .act[disabled] { border-color: var(--edge); background: none; opacity: .6; cursor: default; }
.rg-panel .tag { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--edge); color: var(--ink2); }
.rg-panel .tag.here { border-color: var(--good); color: var(--good); }
.rg-panel .note { font-size: 13px; } .rg-panel .cite { font-size: 11px; color: var(--ink2); }
.rg-panel .empty { color: var(--ink2); padding: 6px 2px; }
.rg-panel .foot { margin-top: 14px; display: flex; gap: 8px; align-items: center; color: var(--ink2); font-size: 11px; }
.rg-panel .foot button { margin-left: auto; }
.rg-map { display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 14px; align-items: start; }
.rg-map canvas { display: block; width: 100%; height: auto; aspect-ratio: 1;   /* index.html sizes every canvas to the viewport */
  border-radius: 10px; border: 1px solid var(--edge); background: #0a2f4a; }
.rg-near li { padding: 4px 10px; } .rg-near li span:first-child { font-size: 12.5px; }
.rg-map .legend { display: block; margin-top: 4px; font-size: 11px; color: var(--ink2); } .rg-map .legend i { font-style: normal; margin: 0 2px 0 8px; }
.rg-map .legend i:first-child { margin-left: 0; } .rg-map .me, .rg-map .tg { color: var(--warn); } .rg-map .np { color: var(--accent); } .rg-map .sg { color: #d9cfae; }
@media (max-width: 640px) { .rg-map { grid-template-columns: 1fr; } .rg-map canvas { max-width: 300px; margin: 0 auto; } }
.rg-time .now { display: flex; align-items: baseline; gap: 10px; margin-top: 10px; } .rg-time .now b { font-size: 26px; font-variant-numeric: tabular-nums; }
.rg-time .now small { color: var(--ink2); }
.rg-time .pre { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px; }
.rg-time .pre button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 6px 10px; border-radius: 9px; border: 1px solid var(--edge); background: rgba(255,255,255,.06);
  color: inherit; font: 600 13px system-ui, sans-serif; text-align: left; cursor: pointer; }
.rg-time .pre button small { font-weight: 400; font-size: 11px; color: var(--ink2); font-variant-numeric: tabular-nums; }
.rg-time .pre button:hover, .rg-time .pre button:focus-visible { background: rgba(111,211,230,.18); border-color: var(--accent); outline: none; }
.rg-time .pre button.on { border-color: var(--warn); }
@media (pointer: coarse) { .rg-time .pre button { min-height: 44px; } }
.rg-time input[type=range] { width: 100%; margin: 6px 0 0; accent-color: var(--accent); }
.rg-time .ticks { display: flex; justify-content: space-between; font-size: 10px; color: var(--ink2); font-variant-numeric: tabular-nums; }
.rg-time .day { position: relative; height: 6px; margin-top: 2px; border-radius: 3px; background: rgba(255,255,255,.08); }
.rg-time .day i { position: absolute; top: 0; bottom: 0; border-radius: 3px; background: linear-gradient(90deg, #f0a92a, #f5c868 50%, #f0a92a); opacity: .7; }
.rg-toast { position: absolute; top: 92px; left: 50%; transform: translateX(-50%) translateY(-6px); padding: 7px 14px; border-radius: 12px; background: var(--panel); border: 1px solid var(--good);
  font-size: 13px; text-align: center; opacity: 0; transition: opacity .35s, transform .35s; max-width: min(90vw, 460px); }
.rg-toast.on { opacity: 1; transform: translateX(-50%); } .rg-toast small { display: block; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--good); }
.rg-toast.warn { border-color: var(--warn); } .rg-toast.warn small { color: var(--warn); }
.rg-fade { position: absolute; inset: 0; background: #021018; opacity: 0; transition: opacity .55s; display: grid; place-content: center; text-align: center; padding: 20px; font-size: 15px; visibility: hidden; }
.rg-fade.on { opacity: 1; visibility: visible; } .rg-fade small { display: block; margin-top: 6px; color: var(--ink2); font-size: 12px; }
@media (max-width: 760px), (max-aspect-ratio: 1/1) { .rg-dlg { left: 50%; transform: translateX(-50%) translateY(8px); width: min(94vw, 560px); } .rg-dlg.on { transform: translateX(-50%); } }
@media (max-width: 640px) { .rg-dlg { bottom: 176px; padding: 10px 12px; max-height: calc(100vh - 290px); } .rg-dlg .txt { font-size: 14px; } .rg-btns { top: 56px; } .rg-obj { width: 52vw; } .rg-toast { top: 108px; }
  .rg-panel { width: 96vw; max-height: 80vh; top: 46%; } }
`;

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createUI(on) {
  if (!document.getElementById('rg-css')) { const s = document.createElement('style'); s.id = 'rg-css'; s.textContent = CSS; document.head.appendChild(s); }
  const el = document.createElement('div');
  el.className = 'rg';
  el.innerHTML = `
  <div class="rg-btns"><button class="bj" title="Journal (J)"><kbd>J</kbd>Journal<b></b></button><button class="bm" title="Reef sites (T)"><kbd>T</kbd>Map</button><button class="bk" title="Time of day (K)"><kbd>K</kbd>Time</button></div>
  <div class="rg-obj"></div><div class="rg-mark">◆</div><div class="rg-toast"></div>
  <div class="rg-dlg" role="dialog" aria-live="polite"><div class="who"><b></b><small></small><em></em><button class="x" aria-label="Close (Esc)">✕</button></div><div class="txt"></div><div class="src"></div><div class="ch"></div><div class="more"></div></div>
  <div class="rg-panel" role="dialog"><header><h2></h2><small></small><button aria-label="Close">✕</button></header><div class="body"></div></div>
  <div class="rg-fade"><div><b></b><small></small></div></div>`;
  document.body.appendChild(el);
  const $ = s => el.querySelector(s);
  const dlg = $('.rg-dlg'), panel = $('.rg-panel'), obj = $('.rg-obj'), mark = $('.rg-mark'), toastEl = $('.rg-toast'), fadeEl = $('.rg-fade');
  $('.bj').addEventListener('click', e => { e.currentTarget.blur(); on.journal(); });
  $('.bm').addEventListener('click', e => { e.currentTarget.blur(); on.map(); });
  $('.bk').addEventListener('click', e => { e.currentTarget.blur(); on.time(); });
  panel.querySelector('header button').addEventListener('click', () => on.closePanel());
  panel.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) on.panelAct(b.dataset.act, b.dataset.arg, b); });
  // tapping the dialogue (not an answer) moves it on, like E
  dlg.addEventListener('click', e => { if (e.target.closest('.x')) return on.closeDialog(); const b = e.target.closest('button[data-k]'); if (b) on.choose(+b.dataset.k); else if (!e.target.closest('a')) on.advance(); });

  let toastT = null, objText = '', markX = -1, markOn = false, markCh = '';
  const ui = {
    el,
    // the dialogue panel: { name, role, aside, text, src: [{ label, url }], choices: [text], more }
    dialog(o) {
      if (!o) { dlg.classList.remove('on'); return; }
      $('.who b').textContent = o.name || ''; $('.who small').textContent = o.role || ''; $('.who em').textContent = o.aside || '';
      $('.txt').textContent = o.text || '';
      $('.src').innerHTML = (o.src || []).map(s => `<span>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>` : esc(s.label)}</span>`).join('');
      $('.ch').innerHTML = (o.choices || []).map((c, i) => `<button data-k="${i}"><kbd>${i + 1}</kbd><span>${esc(c)}</span></button>`).join('');
      $('.more').textContent = o.more || '';
      dlg.classList.add('on');
    },
    get dialogOpen() { return dlg.classList.contains('on'); },
    // a centred panel: the journal, the map or the time of day
    panel(kind, title, sub, html) {
      if (!kind) { panel.classList.remove('on'); el.classList.remove('panel-on'); panel.dataset.kind = ''; for (const b of ['.bj', '.bm', '.bk']) $(b).classList.remove('on'); return; }
      el.classList.add('panel-on');
      panel.dataset.kind = kind; panel.querySelector('h2').textContent = title; panel.querySelector('header small').textContent = sub || '';
      const body = panel.querySelector('.body'), keep = panel.classList.contains('on') ? body.scrollTop : 0;
      body.innerHTML = html; body.scrollTop = keep;
      panel.classList.add('on'); $('.bj').classList.toggle('on', kind === 'journal'); $('.bm').classList.toggle('on', kind === 'map'); $('.bk').classList.toggle('on', kind === 'time');
    },
    get panelKind() { return panel.classList.contains('on') ? panel.dataset.kind : ''; },
    // keep the tracker clear of hud.js's dive gauge (top left while diving)
    objectiveTop(px) { const v = px + 'px'; if (obj.style.top !== v) obj.style.top = v; },
    // objective line under the compass; `rel` = bearing minus heading in degrees (null hides the marker); compass span is 120 deg
    objective(text, rel) {
      if (text !== objText) { objText = text; obj.innerHTML = text; obj.classList.toggle('on', !!text); }
      const show = !!text && rel !== null && rel !== undefined;
      let x = -1, ch = '◆';
      if (show) {
        const W = Math.min(innerWidth * 0.46, 340), lim = 56;
        const d = Math.max(-lim, Math.min(lim, rel));
        x = Math.round(innerWidth / 2 + d / 120 * W);
        ch = rel < -lim ? '◀' : rel > lim ? '▶' : '◆';
      }
      if (show !== markOn) { markOn = show; mark.classList.toggle('on', show); }
      if (show && x !== markX) { markX = x; mark.style.left = x + 'px'; }
      if (show && ch !== markCh) { markCh = ch; mark.textContent = ch; }
    },
    badge(n) { const b = $('.bj b'); b.textContent = n ? String(n) : ''; b.classList.toggle('on', !!n); },
    toast(title, text, kind = '') {
      toastEl.className = 'rg-toast on ' + kind; toastEl.innerHTML = `<small>${esc(title)}</small>${esc(text)}`;
      clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 4200);
    },
    // fade to dark with a caption, run `mid` (the teleport), fade back
    async fade(title, sub, mid, ms = 650) {
      fadeEl.querySelector('b').textContent = title || ''; fadeEl.querySelector('small').textContent = sub || '';
      fadeEl.classList.add('on');
      await new Promise(r => setTimeout(r, ms));
      try { await mid(); } finally { setTimeout(() => fadeEl.classList.remove('on'), ms * 0.6); }
    },
    destroy() { el.remove(); }
  };
  return ui;
}
