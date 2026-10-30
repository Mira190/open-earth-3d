// The game's own HUD layer, over hud.js and in its style (the same glass, edge and type): a dialogue panel
// with numbered answers (keys 1-4, or tap), a journal, a travel map and the time of day as centred panels, four
// buttons (Globe, Journal J, Map T, Time K), the objective line under the compass with a marker on the compass strip,
// toasts for quest steps, and a fade for skip-the-trip transfers. Plain DOM; game.js decides what goes in.
const CSS = `
.rg { position: fixed; inset: 0; pointer-events: none; z-index: 6; font: 400 13px/1.45 "Inter Tight", "Public Sans", system-ui, -apple-system, 'Segoe UI', sans-serif; color: #ece8e1;
  -webkit-font-smoothing: antialiased; --glass: rgba(6,10,18,.7); --panel: rgba(6,10,18,.84); --solid: rgba(8,12,20,.94); --edge: rgba(236,232,225,.14); --edge2: rgba(236,232,225,.3);
  --warn: #ffb066; --good: #63d39a; --accent: #ffb066; --wash: rgba(255,176,102,.1); --ink2: #c3c6cc; --muted: #8a93a3; --faint: #5b6472; --blur: blur(22px) saturate(1.15);
  --mono: "JetBrains Mono", ui-monospace, Menlo, monospace; --display: "Zalando Sans Expanded", "Michroma", system-ui, sans-serif; }
.rg * { box-sizing: border-box; }
.rg kbd { display: inline-block; min-width: 1.6em; padding: 2px 5px; border-radius: 2px; background: rgba(236,232,225,.05); color: #ece8e1; border: 1px solid var(--edge2); text-align: center;
  font: 400 9.5px/1 var(--mono); letter-spacing: .04em; }
.rg a { color: var(--accent); text-underline-offset: 3px; text-decoration-thickness: 1px; }
.rg ::-webkit-scrollbar { width: 8px; } .rg ::-webkit-scrollbar-thumb { background: rgba(236,232,225,.12); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
/* the buttons, as the cities' chips: mono capitals on glass, amber when on */
.rg-btns { position: absolute; top: 108px; right: 16px; display: flex; gap: 6px; pointer-events: auto; }
.rg-btns button { display: inline-flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 2px; background: var(--glass); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur);
  border: 1px solid var(--edge); color: var(--ink2); font: 400 9.5px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; cursor: pointer; white-space: nowrap; transition: color .3s, border-color .3s, background .3s; }
.rg-btns button:hover { color: #ece8e1; border-color: var(--edge2); }
.rg-btns button.on { color: var(--accent); border-color: rgba(255,176,102,.55); background: rgba(40,26,12,.6); }
.rg-btns button kbd { font-size: 9px; padding: 1px 4px; min-width: 0; color: var(--muted); }
.rg-btns .bg { min-height: 32px; }
.rg-btns button b { min-width: 16px; height: 16px; padding: 0 4px; border-radius: 2px; background: var(--accent); color: #1a0f04; font: 400 9px/16px var(--mono); display: none; }
.rg-btns button b.on { display: inline-block; }
/* the objective, as the cities' quest card */
.rg-obj { position: absolute; top: 16px; left: 16px; width: min(42vw, 300px); padding: 11px 14px 12px; border-radius: 2px; background: var(--glass); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur);
  border: 1px solid var(--edge); opacity: 0; transition: opacity .3s, top .3s; }
.rg-obj.on { opacity: 1; } .rg-obj small { display: block; margin-bottom: 4px; font: 400 9.5px/1.3 var(--mono); letter-spacing: .18em; text-transform: uppercase; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rg-obj span { display: block; font: 500 13.5px/1.35 "Inter Tight", system-ui, sans-serif; color: #fff; } .rg-obj em { display: block; margin-top: 4px; font: 400 10px/1.3 var(--mono); font-style: normal; letter-spacing: .06em; color: var(--muted); }
.rg-mark { position: absolute; top: 18px; left: 0; width: 14px; height: 26px; margin-left: -7px; display: none; color: var(--accent); font: 400 13px/26px var(--mono); text-align: center; text-shadow: 0 0 6px rgba(255,176,102,.6); }
.rg-mark.on { display: block; }
/* the conversation, with the speaker's name set like the cities' */
.rg-dlg { position: absolute; left: 16px; bottom: 64px; transform: translateY(8px); width: min(44vw, 520px); max-height: calc(100vh - 150px); overflow: auto; padding: 16px 20px 12px; border-radius: 2px;
  background: rgba(6,10,18,.82); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur); border: 1px solid var(--edge); border-top: 2px solid var(--accent); box-shadow: 0 12px 40px rgba(0,0,0,.35);
  pointer-events: auto; opacity: 0; visibility: hidden; transition: opacity .25s, transform .25s, visibility 0s .25s; }
.rg-dlg.on { opacity: 1; visibility: visible; transform: none; transition: opacity .25s, transform .25s; }
.rg-dlg .who { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; flex-wrap: wrap; }
.rg-dlg .who b { font: 300 15px/1.1 var(--display); letter-spacing: .14em; text-transform: uppercase; color: #f4f1ea; }
.rg-dlg .who small { font: 400 9px/1 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
.rg-dlg .who em { margin-left: auto; font: 400 9px/1 var(--mono); font-style: normal; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.rg-dlg .who .x { width: 26px; height: 24px; margin: -4px -8px 0 2px; border: 0; border-radius: 2px; background: none; color: var(--muted); font: 400 13px/1 var(--mono); cursor: pointer; }
.rg-dlg .who .x:hover { color: #ece8e1; }
.rg-dlg .txt { font-size: 15.5px; line-height: 1.6; }
.rg-dlg .src { margin-top: 8px; font: 400 9px/1.6 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); } .rg-dlg .src:empty { display: none; }
.rg-dlg .src span + span::before { content: ' · '; }
.rg-dlg .ch { display: grid; gap: 6px; margin-top: 10px; } .rg-dlg .ch:empty { display: none; }
.rg-dlg .ch button { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 36px; padding: 9px 12px; border-radius: 2px; border: 1px solid var(--edge); background: rgba(236,232,225,.03);
  color: #ece8e1; font: 500 13.5px/1.35 "Inter Tight", system-ui, sans-serif; text-align: left; cursor: pointer; transition: border-color .3s, background .3s; }
@media (pointer: coarse) { .rg-dlg .ch button { min-height: 44px; } }
.rg-dlg .ch button:hover, .rg-dlg .ch button:focus-visible { background: var(--wash); outline: none; border-color: rgba(255,176,102,.6); }
.rg-dlg .more { margin-top: 8px; font: 400 8.5px/1 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--faint); text-align: right; } .rg-dlg .more:empty { display: none; }
/* the journal, the map and the time of day, as the cities' panels */
.rg-panel { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(94vw, 680px); max-height: min(90vh, 760px); display: none; flex-direction: column; border-radius: 2px;
  background: var(--solid); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); border: 1px solid var(--edge); box-shadow: 0 12px 40px rgba(0,0,0,.45); pointer-events: auto; }
.rg-panel::before, .rg-panel::after { content: ""; position: absolute; width: 10px; height: 10px; border: 0 solid var(--accent); pointer-events: none; }
.rg-panel::before { left: -1px; top: -1px; border-width: 1px 0 0 1px; } .rg-panel::after { right: -1px; bottom: -1px; border-width: 0 1px 1px 0; }
.rg-panel.on { display: flex; }
.rg.panel-on .rg-obj, .rg.panel-on .rg-mark { visibility: hidden; }
.rg-panel header { display: flex; align-items: baseline; gap: 14px; margin: 0 22px; padding: 20px 0 14px; border-bottom: 1px solid var(--edge); }
.rg-panel header h2 { margin: 0; font: 300 18px/1.1 var(--display); letter-spacing: .18em; text-transform: uppercase; color: #fff; }
.rg-panel header small { font: 400 9px/1.3 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.rg-panel header button { margin-left: auto; min-width: 32px; height: 28px; border: 0; border-radius: 2px; background: none; color: var(--muted); cursor: pointer; font: 400 15px/1 var(--mono); }
.rg-panel header button:hover { color: #ece8e1; }
.rg-panel .body { overflow: auto; padding: 6px 22px 22px; }
.rg-panel h3 { margin: 16px 0 8px; font: 400 9px/1.2 var(--mono); letter-spacing: .2em; text-transform: uppercase; color: var(--muted); }
.rg-panel ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.rg-panel li { padding: 9px 12px; border-radius: 2px; background: rgba(236,232,225,.02); border: 1px solid var(--edge); }
.rg-panel li.track { border-color: rgba(255,176,102,.6); background: var(--wash); } .rg-panel li.done { opacity: .7; } .rg-panel li.off { opacity: .5; }
.rg-panel li b { font: 500 13.5px/1.35 "Inter Tight", system-ui, sans-serif; color: #fff; } .rg-panel li .st { font: 400 9px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
.rg-panel li.done .st { color: var(--good); }
.rg-panel li p { margin: 4px 0 0; color: var(--ink2); } .rg-panel li small { color: var(--muted); display: block; margin-top: 3px; font: 400 10px/1.4 var(--mono); letter-spacing: .04em; }
.rg-panel li .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rg-panel li .row > :last-child { margin-left: auto; }
.rg-panel .act { min-height: 30px; padding: 8px 12px; border-radius: 2px; border: 1px solid var(--accent); background: var(--accent); color: #1a0f04; cursor: pointer;
  font: 400 9.5px/1.2 var(--display); letter-spacing: .16em; text-transform: uppercase; transition: background .3s, border-color .3s; }
.rg-panel .act:hover { background: #ffc48c; border-color: #ffc48c; }
@media (pointer: coarse) { .rg-panel .act { min-height: 40px; } }
.rg-panel .act[disabled] { border-color: var(--edge); background: none; color: var(--muted); cursor: default; }
.rg-panel .tag { font: 400 9px/1 var(--mono); letter-spacing: .12em; text-transform: uppercase; padding: 4px 7px; border-radius: 2px; border: 1px solid var(--edge); color: var(--ink2); }
.rg-panel .tag.here { border-color: rgba(99,211,154,.6); color: var(--good); }
.rg-panel .note { font-size: 13px; color: var(--ink2); } .rg-panel .cite { font: 400 9.5px/1.6 var(--mono); letter-spacing: .04em; color: var(--muted); }
.rg-panel .empty { color: var(--muted); padding: 6px 2px; }
.rg-panel .foot { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--edge); display: flex; gap: 8px; align-items: center; font: 400 9px/1.5 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.rg-panel .foot button { margin-left: auto; flex: none; white-space: nowrap; }
.rg-map { display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 16px; align-items: start; }
.rg-map canvas { display: block; width: 100%; height: auto; aspect-ratio: 1;   /* index.html sizes every canvas to the viewport */
  border-radius: 2px; border: 1px solid var(--edge); background: #0a1722; }
.rg-near li { padding: 6px 10px; } .rg-near li span:first-child { font-size: 12.5px; }
.rg-map .legend { display: block; margin-top: 6px; font: 400 9px/1.6 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); } .rg-map .legend i { font-style: normal; margin: 0 2px 0 8px; }
.rg-map .legend i:first-child { margin-left: 0; } .rg-map .me, .rg-map .tg { color: var(--accent); } .rg-map .np { color: #ece8e1; } .rg-map .sg { color: #d9cfae; }
@media (max-width: 640px) { .rg-map { grid-template-columns: 1fr; } .rg-map canvas { max-width: 300px; margin: 0 auto; } }
.rg-time .now { display: flex; align-items: baseline; gap: 12px; margin-top: 12px; } .rg-time .now b { font: 200 30px/1 var(--display); letter-spacing: .04em; color: #fff; font-variant-numeric: tabular-nums; }
.rg-time .now small { font: 400 9.5px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.rg-time .pre { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 6px; }
.rg-time .pre button { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 9px 11px; border-radius: 2px; border: 1px solid var(--edge); background: rgba(236,232,225,.02);
  color: #ece8e1; font: 500 13px/1.25 "Inter Tight", system-ui, sans-serif; text-align: left; cursor: pointer; transition: border-color .3s, background .3s; }
.rg-time .pre button small { font: 400 9.5px/1 var(--mono); letter-spacing: .06em; color: var(--muted); font-variant-numeric: tabular-nums; }
.rg-time .pre button:hover, .rg-time .pre button:focus-visible { background: var(--wash); border-color: rgba(255,176,102,.6); outline: none; }
.rg-time .pre button.on { border-color: var(--accent); color: var(--accent); }
@media (pointer: coarse) { .rg-time .pre button { min-height: 44px; } }
.rg-time input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 18px; margin: 8px 0 0; background: none; cursor: pointer; }
.rg-time input[type=range]::-webkit-slider-runnable-track { height: 1px; background: var(--edge2); }
.rg-time input[type=range]::-moz-range-track { height: 1px; background: var(--edge2); }
.rg-time input[type=range]::-moz-range-progress { height: 1px; background: var(--accent); }
.rg-time input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 11px; height: 11px; margin-top: -5px; border: 0; border-radius: 50%; background: var(--accent);
  box-shadow: 0 0 0 4px rgba(255,176,102,.16), 0 0 12px rgba(255,176,102,.55); }
.rg-time input[type=range]::-moz-range-thumb { width: 11px; height: 11px; border: 0; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 4px rgba(255,176,102,.16), 0 0 12px rgba(255,176,102,.55); }
.rg-time .ticks { display: flex; justify-content: space-between; font: 400 9px/1 var(--mono); letter-spacing: .06em; color: var(--muted); font-variant-numeric: tabular-nums; }
.rg-time .day { position: relative; height: 2px; margin-top: 4px; background: rgba(236,232,225,.1); }
.rg-time .day i { position: absolute; top: 0; bottom: 0; background: linear-gradient(90deg, rgba(255,176,102,.5), #ffc48c 50%, rgba(255,176,102,.5)); }
/* a quest step done: the cities' stamp */
.rg-toast { position: absolute; top: 96px; left: 50%; transform: translateX(-50%) translateY(-6px); padding: 12px 20px; border-radius: 2px; background: rgba(8,12,20,.9); -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur);
  border: 1px solid rgba(99,211,154,.55); font-size: 13px; line-height: 1.45; text-align: center; opacity: 0; transition: opacity .5s, transform .5s; max-width: min(90vw, 460px); }
.rg-toast.on { opacity: 1; transform: translateX(-50%); }
.rg-toast small { display: block; margin-bottom: 4px; font: 300 15px/1.2 var(--display); letter-spacing: .12em; text-transform: uppercase; color: var(--good); }
.rg-toast.warn { border-color: rgba(255,176,102,.6); } .rg-toast.warn small { color: var(--accent); }
/* skipping the trip: the title's dark, the place set large */
.rg-fade { position: absolute; inset: 0; background: radial-gradient(90% 70% at 50% 42%, #0b111b 0%, #04060b 70%); opacity: 0; transition: opacity .55s; display: grid; place-content: center; text-align: center; padding: 20px; visibility: hidden; }
.rg-fade.on { opacity: 1; visibility: visible; }
.rg-fade b { display: block; font: 200 clamp(22px, 3vw, 36px)/1.15 var(--display); letter-spacing: .26em; margin-right: -.26em; text-transform: uppercase; color: #f4f1ea; }
.rg-fade small { display: block; margin-top: 14px; font: 400 9.5px/1.5 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
@media (max-width: 760px), (max-aspect-ratio: 1/1) { .rg-dlg { left: 50%; transform: translateX(-50%) translateY(8px); width: min(94vw, 560px); } .rg-dlg.on { transform: translateX(-50%); } }
@media (max-width: 940px) { .rg-obj { top: 70px; } .rg-toast { top: 166px; } }
@media (max-width: 640px) { .rg-dlg { bottom: 176px; padding: 12px 14px 10px; max-height: calc(100vh - 290px); } .rg-dlg .txt { font-size: 14px; } .rg-btns { top: 70px; flex-direction: column; align-items: flex-end; } .rg-btns .bg { order: 1; } .rg-obj { width: min(calc(100vw - 154px), 320px); } .rg-toast { top: 190px; }
  .rg-panel { width: 96vw; max-height: 80vh; top: 46%; } .rg-panel header { margin: 0 16px; } .rg-panel .body { padding: 6px 16px 16px; } }
@media (prefers-reduced-motion: reduce) { .rg-obj, .rg-dlg, .rg-toast, .rg-fade, .rg-btns button { transition: none; } }
`;

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createUI(on) {
  if (!document.getElementById('rg-css')) { const s = document.createElement('style'); s.id = 'rg-css'; s.textContent = CSS; document.head.appendChild(s); }
  const el = document.createElement('div');
  el.className = 'rg';
  el.innerHTML = `
  <div class="rg-btns"><button class="bg" title="Back to the globe, every city in Open Earth 3D">← Globe</button><button class="bj" title="Journal (J)"><kbd>J</kbd>Journal<b></b></button><button class="bm" title="Reef sites (T)"><kbd>T</kbd>Map</button><button class="bk" title="Time of day (K)"><kbd>K</kbd>Time</button></div>
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
  $('.bg').addEventListener('click', () => on.globe());
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
    // keep the tracker clear of hud.js's dive gauge (top left while diving); null leaves it where the CSS puts it
    objectiveTop(px) { const v = px === null ? '' : px + 'px'; if (obj.style.top !== v) obj.style.top = v; },
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
