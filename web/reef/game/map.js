// The Map panel: one map at two scales, as an open-world game's map is.
//   "This site": the model's own terrain at the current tide (sea shaded by depth, the waterline, sand, hill-shaded
//     land; no tiles, the same grid the 3D view stands on) with every named place as a travel point, the people, the
//     signs, the aircraft, the tracked objective and you.
//   "All sites": every site of this viewer on a chart of the coast (Natural Earth, web/data/world.json), grouped by
//     region; sites too close to tell apart at the zoom are one counted pin that opens the region.
// Both work the same way, and the way the cities' big map does: pick a pin or a row of the list, a card names it
// and offers Travel; a double-click (or Enter) goes at once. The wheel or a pinch zooms, a drag pans.
// Drawn at night like a chart table, as the cities' maps are: you a white arrow, the objective amber.
import { esc } from './ui.js';

const DEEP = [7, 16, 26], SHALLOW = [26, 84, 98], FLAT = [44, 116, 122], SAND = [158, 147, 118], LAND = [32, 45, 38], HIGH = [92, 96, 84], COAST = [196, 188, 160];
const INK = '#ece8e1', AMBER = '#ffb066', NIGHT = '#04060b', MUTED = '#8a93a3', GOOD = '#63d39a', MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
const SEA_CHART = '#081421', LAND_CHART = '#1d2a26', LAKE_CHART = '#12303c';
const KINDS = { beach: 'Beach', bay: 'Bay', inlet: 'Inlet', lookout: 'Lookout', island: 'Island', peak: 'Peak', marina: 'Marina', reef: 'Reef', pontoon: 'Pontoon', town: 'Town', cultural: 'Cultural site', dive: 'Dive site' };
const RE = 6371, RAD = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// Web Mercator in kilometres at the equator: conformal, so a region keeps its shape wherever the chart is centred
const mx = lon => lon * RAD * RE, my = lat => Math.log(Math.tan(Math.PI / 4 + clamp(lat, -85, 85) * RAD / 2)) * RE;
const latOf = y => (2 * Math.atan(Math.exp(y / RE)) - Math.PI / 2) / RAD;

// the coast for the chart, fetched the first time "All sites" opens: [{ box, rings: [Float32Array x,y,...] }]
let coast = null;
function loadCoast() {
  if (!coast) coast = fetch(new URL('../../data/world.json', import.meta.url)).then(r => r.json()).then(w => {
    const q = w.q || 0.02;
    const ring = a => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i += 2) { o[i] = mx(a[i] * q); o[i + 1] = my(a[i + 1] * q); } return o; };
    const poly = p => { const rings = p.map(ring); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; const r = rings[0]; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); } return { rings, box: [x0, x1, y0, y1] }; };
    return { land: (w.land || []).map(poly), lakes: (w.lakes || []).map(poly), borders: (w.borders || []).map(l => poly([l])) };
  }).catch(e => { console.warn('map: no coast', e); return { land: [], lakes: [], borders: [] }; });
  return coast;
}

// o: { host, G, travel, site: { id, name }, places(): [{ id, name, kind, x, north }], marks(): [...], me(): { x, north, heading },
//      go(placeId) -> true when it took you there, travelTo(siteId), touch }
export function createMapView(o) {
  const { host, G, travel, site } = o;
  const ext = G.S.extent_m || null;
  host.innerHTML = `<div class="rg-map">
    <div class="rg-tabs" role="tablist"><button role="tab" data-scale="local"><b>${esc(site.name)}</b><small></small></button><button role="tab" data-scale="world"><b>All sites</b><small></small></button></div>
    <div class="rg-mapwrap"><canvas aria-label="Map"></canvas>
      <div class="rg-zoom"><button data-z="in" aria-label="Zoom in">+</button><button data-z="out" aria-label="Zoom out">−</button><button data-z="fit" aria-label="Show everything" title="Show everything">⤢</button></div>
      <div class="rg-pop" role="dialog" aria-label="Travel" hidden><b></b><small></small><p></p><div class="acts"><button class="act go"></button><button class="act ghost alt" hidden></button></div></div>
      <small class="rg-hint"></small></div>
    <div class="rg-side"><div class="in"><div class="rg-list"></div>
      <div class="foot"><span>Fly the seaplane or the helicopter off the edge of the model to reach the nearest site.</span><button class="act ghost" data-act="globe">Back to the globe</button></div></div></div>
    <small class="legend"></small></div>`;
  const $ = s => host.querySelector(s), root = $('.rg-map'), cv = $('canvas'), g = cv.getContext('2d'), pop = $('.rg-pop'), listEl = $('.rg-list'), hintEl = $('.rg-hint');
  const tabs = [...host.querySelectorAll('.rg-tabs button')];
  let scale = 'local', W = 300, H = 300, dpr = 1, dead = false;
  let sel = null, hover = null, hits = [], raf = 0, anim = null, sites = travel.list || null, land = null;
  const views = { local: null, world: null };
  const me = () => o.me(), places = () => o.places();
  const here = () => (sites || []).find(s => s.current) || null;
  const sp = s => ({ x: mx(s.lon), y: my(s.lat) });
  const groupOf = s => s.group || 'Other sites';
  const groups = () => {                                    // this site's region first, then the nearest
    const m = new Map(); for (const s of sites || []) { if (!Number.isFinite(s.lat)) continue; const k = groupOf(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s); }
    const cur = here() && groupOf(here());
    return [...m.entries()].sort((a, b) => (b[0] === cur) - (a[0] === cur) || Math.min(...a[1].map(s => s.km ?? 1e9)) - Math.min(...b[1].map(s => s.km ?? 1e9)));
  };

  // ------------------------------------------------------------ the two views: centre and units per CSS pixel
  // (metres on the site map, Mercator kilometres on the chart), fitted to points and eased from one to the next
  const lim = () => scale === 'local' ? [1.2, ext ? Math.max((ext[1] - ext[0]) / W, (ext[3] - ext[2]) / H) : 60] : [0.03, 14];
  function bound(v) {
    const [a, b] = lim(); v.upp = clamp(v.upp, a, b);
    if (scale === 'local' && ext) { v.cx = clamp(v.cx, ext[0], ext[1]); v.cy = clamp(v.cy, ext[2], ext[3]); }
    return v;
  }
  // `card` keeps the bottom of the map clear for the card of what is picked
  function fit(pts, pad = 64, minSpan = 0, card = 0) {
    let x0 = 1e12, x1 = -1e12, y0 = 1e12, y1 = -1e12; for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    const w = Math.max(40, W - 2 * pad), h = Math.max(40, H - 2 * pad - card), upp = clamp(Math.max((x1 - x0) / w, (y1 - y0) / h, minSpan / Math.min(W, H)), ...lim());
    return bound({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 - card / 2 * upp, upp });
  }
  const lp = p => ({ x: p.x, y: p.north });
  // the site map opens on what matters now: you, the people and the objective, 3 km across at least
  const localHome = () => fit([lp(me()), ...o.marks().filter(m => m.fit !== false).map(lp)], 56, 3000);
  const localAll = () => ext ? fit([{ x: ext[0], y: ext[2] }, { x: ext[1], y: ext[3] }], 0) : fit([lp(me()), ...places().map(lp)], 56, 3000);
  const groupFit = (k, card = 0) => { const l = (sites || []).filter(s => groupOf(s) === k && Number.isFinite(s.lat)).map(sp); return l.length ? fit(l, 90, 60, card) : null; };
  const worldHome = () => { const h = here(); return (h && groupFit(groupOf(h))) || worldAll(); };
  const worldAll = () => { const l = (sites || []).filter(s => Number.isFinite(s.lat)).map(sp); return l.length ? fit(l, 90, 60) : { cx: mx(150), cy: my(-25), upp: 6 }; };
  const view = () => views[scale] || (views[scale] = scale === 'local' ? localHome() : worldHome());
  function to(v, ms = 320) {
    if (!v) return; bound(v);
    const a = { ...view() };
    if (scale === 'local') { views.local = v; clearTimeout(baseT); renderBase(); views.local = a; }   // the ground where the move ends, so that nothing is bare on the way
    anim = { a, b: v, t0: performance.now(), ms }; request();
  }
  const X = x => (x - view().cx) / view().upp + W / 2, Y = y => H / 2 - (y - view().cy) / view().upp;
  const covered = p => X(p.x) < Math.min(390, W) && Y(p.y) > H - Math.min(190, H * 0.45) - 16;   // under the card
  const inView = (p, m = 30) => { const x = X(p.x), y = Y(p.y); return x > m && y > m && x < W - m && y < H - m; };

  // ------------------------------------------------------------ the site's ground, one height per device pixel,
  // kept until the view changes (while it is changing, the last one is drawn stretched and a new one follows)
  let base = null, baseView = null, baseT = 0, hs = null;
  function renderBase() {
    const v = view(), bw = Math.round(W * dpr), bh = Math.round(H * dpr), e = v.upp / dpr, tide = G.tideNow();
    if (!base) base = document.createElement('canvas');
    if (base.width !== bw || base.height !== bh) { base.width = bw; base.height = bh; }
    if (!hs || hs.length !== (bw + 1) * (bh + 1)) hs = new Float32Array((bw + 1) * (bh + 1));
    for (let j = 0, k = 0; j <= bh; j++) { const n = v.cy - (j - bh / 2) * e; for (let i = 0; i <= bw; i++, k++) hs[k] = G.height(v.cx + (i - bw / 2) * e, n); }
    const bg = base.getContext('2d'), img = bg.createImageData(bw, bh), d = img.data, row = bw + 1;
    for (let j = 0, q = 0; j < bh; j++) for (let i = 0; i < bw; i++, q += 4) {
      if (ext) { const x = v.cx + (i - bw / 2) * e, n = v.cy - (j - bh / 2) * e; if (x < ext[0] || x > ext[1] || n < ext[2] || n > ext[3]) { d[q] = 5; d[q + 1] = 9; d[q + 2] = 15; d[q + 3] = 255; continue; } }   // past the survey's edge
      const k = j * row + i, h = hs[k], hx = hs[k + 1], hS = hs[k + row], wet = h < tide;
      let r, gg, b;
      if (wet) {
        const dep = tide - h, t = Math.exp(-dep / 7), f = dep < 2 ? 1 - dep / 2 : 0;      // the reef flat and the shallows read lighter
        r = DEEP[0] + (SHALLOW[0] - DEEP[0]) * t; gg = DEEP[1] + (SHALLOW[1] - DEEP[1]) * t; b = DEEP[2] + (SHALLOW[2] - DEEP[2]) * t;
        r += (FLAT[0] - r) * f * 0.7; gg += (FLAT[1] - gg) * f * 0.7; b += (FLAT[2] - b) * f * 0.7;
      } else {
        const up = h - tide, shade = clamp(1 + ((hx - h) + (hS - h)) / e * 0.9, 0.5, 1.35);   // lit from the north-west
        if (up < 2.2) { r = SAND[0]; gg = SAND[1]; b = SAND[2]; }
        else { const t = Math.min(1, up / 420); r = LAND[0] + (HIGH[0] - LAND[0]) * t; gg = LAND[1] + (HIGH[1] - LAND[1]) * t; b = LAND[2] + (HIGH[2] - LAND[2]) * t; }
        r *= shade; gg *= shade; b *= shade;
      }
      if (wet !== (hx < tide) || wet !== (hS < tide)) { r += (COAST[0] - r) * 0.55; gg += (COAST[1] - gg) * 0.55; b += (COAST[2] - b) * 0.55; }   // the waterline
      d[q] = r; d[q + 1] = gg; d[q + 2] = b; d[q + 3] = 255;
    }
    bg.putImageData(img, 0, 0); baseView = { ...v, W, H };
  }
  function drawBase() {
    const v = view(), fresh = baseView && baseView.cx === v.cx && baseView.cy === v.cy && baseView.upp === v.upp && baseView.W === W && baseView.H === H;
    if (!fresh && !anim && !drag) { clearTimeout(baseT); if (!baseView) renderBase(); else baseT = setTimeout(() => { if (!dead && scale === 'local') { renderBase(); request(); } }, 90); }
    g.fillStyle = `rgb(${DEEP})`; g.fillRect(0, 0, W, H);
    if (!baseView) return;
    const s = baseView.upp / v.upp, w = baseView.W * s, h = baseView.H * s;
    g.imageSmoothingEnabled = true; g.drawImage(base, X(baseView.cx) - w / 2, Y(baseView.cy) - h / 2, w, h);
  }

  // ------------------------------------------------------------ pins and labels
  let boxes = [];
  const hitsBox = (a) => boxes.some(b => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]);
  // a name beside its pin, on the first side that is free; `force` draws it whatever it covers (the picked one)
  function label(text, x, y, r = 9, opt = {}) {
    if (!text) return false;
    g.font = `${opt.bold ? 500 : 400} ${opt.size || 10.5}px ${MONO}`; const w = g.measureText(text).width, hh = 7;
    const cand = [[x + r + 4, y], [x - r - 4 - w, y], [x - w / 2, y + r + 9], [x - w / 2, y - r - 9]];
    let at = null;
    for (const c of cand) { const b = [c[0] - 2, c[1] - hh, c[0] + w + 2, c[1] + hh]; if (b[0] < 2 || b[2] > W - 2 || b[1] < 2 || b[3] > H - 2) continue; if (!hitsBox(b)) { at = c; break; } }
    if (!at) { if (!opt.force) return false; at = [clamp(x + r + 4, 4, W - w - 4), y]; }
    boxes.push([at[0] - 2, at[1] - hh, at[0] + w + 2, at[1] + hh]);
    g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineWidth = 3.5; g.lineJoin = 'round'; g.strokeStyle = 'rgba(4,6,11,.9)'; g.strokeText(text, at[0], at[1]);
    g.fillStyle = opt.color || INK; g.fillText(text, at[0], at[1]);
    return true;
  }
  // a travel point: a ring with a dot, amber and larger when picked
  function pin(x, y, state, n) {
    const on = state === 'sel', hot = state === 'hover', r = n ? 11 : on ? 8 : 6;
    if (on) { g.beginPath(); g.arc(x, y, r + 6, 0, 6.283); g.fillStyle = 'rgba(255,176,102,.18)'; g.fill(); g.lineWidth = 1; g.strokeStyle = 'rgba(255,176,102,.7)'; g.stroke(); }
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fillStyle = on ? AMBER : 'rgba(6,10,18,.9)'; g.fill(); g.lineWidth = on || hot ? 2 : 1.5; g.strokeStyle = on ? NIGHT : hot ? '#fff' : AMBER; g.stroke();
    if (n) { g.font = `500 10.5px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = on ? NIGHT : AMBER; g.fillText(String(n), x, y + 0.5); }
    else { g.beginPath(); g.arc(x, y, on ? 2.6 : 2, 0, 6.283); g.fillStyle = on ? NIGHT : hot ? '#fff' : AMBER; g.fill(); }
    return r;
  }
  function arrow(x, y, deg) {
    g.save(); g.translate(x, y); g.rotate(deg * RAD); g.fillStyle = '#fff'; g.strokeStyle = NIGHT; g.lineWidth = 2; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke(); g.restore();
  }
  function furniture(kmPerPx) {
    // the scale bar (bottom right) and north (top left): the map is always north up
    const want = W * 0.2 * kmPerPx, steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000], bar = steps.find(s => s >= want) || 2000, bl = bar / kmPerPx, x = W - bl - 18, y = H - 14;
    g.fillStyle = 'rgba(4,6,11,.72)'; g.fillRect(x - 8, y - 14, bl + 16, 22); g.fillStyle = INK; g.fillRect(x, y, bl, 1); g.fillRect(x, y - 3, 1, 4); g.fillRect(x + bl - 1, y - 3, 1, 4);
    g.font = `400 9px ${MONO}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(bar >= 1 ? `${bar} KM` : `${bar * 1000} M`, x, y - 7);
    g.fillStyle = 'rgba(4,6,11,.72)'; g.beginPath(); g.arc(20, 20, 11, 0, 6.283); g.fill(); g.fillStyle = AMBER; g.font = `400 10px ${MONO}`; g.textAlign = 'center'; g.fillText('N', 20, 23.5);
    g.beginPath(); g.moveTo(20, 10); g.lineTo(23, 15); g.lineTo(17, 15); g.closePath(); g.fill();
  }
  const is = (kind, id) => (sel && sel.kind === kind && sel.id === id) ? 'sel' : (hover && hover.kind === kind && hover.id === id) ? 'hover' : '';

  function drawLocal() {
    drawBase();
    const a = me(), ax = X(a.x), ay = Y(a.north);
    boxes = [[ax - 10, ay - 12, ax + 10, ay + 10]]; hits = [];
    const marks = o.marks(), off = (x, y) => x < -20 || y < -20 || x > W + 20 || y > H + 20;
    g.font = `400 10px ${MONO}`;
    for (const m of marks) {                                 // signs and aircraft under everything else
      const x = X(m.x), y = Y(m.north); if (off(x, y) || (m.kind !== 'sign' && !m.craft)) continue;
      g.lineWidth = 1.5; g.strokeStyle = NIGHT;
      if (m.kind === 'sign') { g.fillStyle = m.done ? GOOD : '#d9cfae'; g.fillRect(x - 3.5, y - 3.5, 7, 7); g.strokeRect(x - 3.5, y - 3.5, 7, 7); }
      else { g.fillStyle = '#d9cfae'; g.beginPath(); g.arc(x, y, 7, 0, 6.283); g.fill(); g.stroke(); g.fillStyle = NIGHT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `400 9px ${MONO}`; g.fillText(m.glyph, x, y + 0.5); }
    }
    const pl = places().map(p => ({ p, x: X(p.x), y: Y(p.north), d: Math.hypot(p.x - a.x, p.north - a.north) })).filter(q => !off(q.x, q.y));
    for (const q of pl) { const st = is('place', q.p.id); q.r = pin(q.x, q.y, st); q.st = st; hits.push({ x: q.x, y: q.y, r: 15, ref: { kind: 'place', id: q.p.id } }); boxes.push([q.x - 7, q.y - 7, q.x + 7, q.y + 7]); }
    const people = marks.filter(m => !m.kind && !m.craft).map(m => ({ m, x: X(m.x), y: Y(m.north) })).filter(q => !off(q.x, q.y));
    for (const q of people) {
      g.fillStyle = '#e6e2da'; g.strokeStyle = NIGHT; g.lineWidth = 2; g.beginPath(); g.arc(q.x, q.y, 8, 0, 6.283); g.fill(); g.stroke();
      g.fillStyle = NIGHT; g.font = `500 10px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(q.m.glyph || '?', q.x, q.y + 0.5); boxes.push([q.x - 9, q.y - 9, q.x + 9, q.y + 9]);
    }
    const tg = marks.find(m => m.kind === 'target'), tx = tg && X(tg.x), ty = tg && Y(tg.north);
    if (tg && !off(tx, ty)) { g.fillStyle = AMBER; g.strokeStyle = NIGHT; g.lineWidth = 2; g.beginPath(); g.moveTo(tx, ty - 9); g.lineTo(tx + 9, ty); g.lineTo(tx, ty + 9); g.lineTo(tx - 9, ty); g.closePath(); g.fill(); g.stroke(); boxes.push([tx - 9, ty - 9, tx + 9, ty + 9]); }
    arrow(ax, ay, a.heading || 0);
    // names: the picked place, the objective, the people, then the places nearest you while there is room
    const first = pl.filter(q => q.st).sort((u, v) => (v.st === 'sel') - (u.st === 'sel'));
    for (const q of first) label(q.p.name, q.x, q.y, q.r + 4, { force: true, bold: true, color: q.st === 'sel' ? AMBER : '#fff' });
    if (tg && !off(tx, ty)) label(tg.label, tx, ty, 10, { color: AMBER });
    for (const q of people) label(q.m.label, q.x, q.y, 9);
    for (const q of pl.filter(q => !q.st && !(tg && tg.label === q.p.name && Math.hypot(q.x - tx, q.y - ty) < 40)).sort((u, v) => u.d - v.d)) label(q.p.name, q.x, q.y, 7, { color: '#cfd2d6' });
    furniture(view().upp / 1000);
  }

  function drawWorld() {
    const v = view();
    g.fillStyle = SEA_CHART; g.fillRect(0, 0, W, H);
    const x0 = v.cx - W / 2 * v.upp, x1 = v.cx + W / 2 * v.upp, y0 = v.cy - H / 2 * v.upp, y1 = v.cy + H / 2 * v.upp;
    const seen = p => p.box[1] >= x0 && p.box[0] <= x1 && p.box[3] >= y0 && p.box[2] <= y1;
    const path = p => { g.beginPath(); for (const r of p.rings) { g.moveTo(X(r[0]), Y(r[1])); for (let i = 2; i < r.length; i += 2) g.lineTo(X(r[i]), Y(r[i + 1])); } };
    if (land) {
      g.fillStyle = LAND_CHART; g.strokeStyle = 'rgba(196,188,160,.42)'; g.lineWidth = 1; g.lineJoin = 'round';
      for (const p of land.land) if (seen(p)) { path(p); g.fill('evenodd'); g.stroke(); }
      g.fillStyle = LAKE_CHART; g.strokeStyle = 'rgba(196,188,160,.25)'; for (const p of land.lakes) if (seen(p)) { path(p); g.fill('evenodd'); g.stroke(); }
      g.strokeStyle = 'rgba(236,232,225,.1)'; g.setLineDash([3, 4]); for (const p of land.borders) if (seen(p)) { path(p); g.stroke(); } g.setLineDash([]);
    }
    boxes = []; hits = [];
    const h = here(), todo = [];
    for (const [name, list] of groups()) {
      const pts = list.map(s => ({ s, x: X(mx(s.lon)), y: Y(my(s.lat)) }));
      const bx = Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)), by = Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y));
      if (pts.length > 1 && Math.hypot(bx, by) < 34) {         // too close to tell apart: one counted pin that opens the region
        const x = pts.reduce((t, p) => t + p.x, 0) / pts.length, y = pts.reduce((t, p) => t + p.y, 0) / pts.length, mine = list.includes(h);
        todo.push({ x, y, n: pts.length, name: `${name} · ${pts.length} sites`, ref: { kind: 'group', id: name }, mine, st: is('group', name) || (sel && sel.kind === 'site' && list.some(s => s.id === sel.id) ? 'sel' : '') });
      } else for (const p of pts) todo.push({ x: p.x, y: p.y, s: p.s, name: p.s.name, ref: { kind: 'site', id: p.s.id }, mine: p.s === h, st: is('site', p.s.id) });
    }
    // each site's own footprint once it is large enough to see
    g.strokeStyle = 'rgba(255,176,102,.4)'; g.lineWidth = 1;
    for (const t of todo) if (t.s && t.s.extent_km) { const k = Math.cos(t.s.lat * RAD), w = t.s.extent_km[0] / k / v.upp, hh = t.s.extent_km[1] / k / v.upp; if (w > 26 || hh > 26) g.strokeRect(t.x - w / 2, t.y - hh / 2, w, hh); }
    for (const t of todo) {
      if (t.x < -20 || t.y < -20 || t.x > W + 20 || t.y > H + 20) continue;
      if (t.mine && !t.n) { arrow(t.x, t.y, 0); t.r = 10; } else t.r = pin(t.x, t.y, t.st, t.n);
      if (t.mine && t.n) { g.beginPath(); g.arc(t.x, t.y, 15, 0, 6.283); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); }
      hits.push({ x: t.x, y: t.y, r: 17, ref: t.ref }); boxes.push([t.x - t.r, t.y - t.r, t.x + t.r, t.y + t.r]);
    }
    const order = t => t.st === 'sel' ? 0 : t.st === 'hover' ? 1 : t.mine ? 2 : 3;
    for (const t of todo.slice().sort((a, b) => order(a) - order(b))) {
      if (t.x < -20 || t.y < -20 || t.x > W + 20 || t.y > H + 20) continue;
      label(t.mine && !t.n ? `${t.name} · you are here` : t.name, t.x, t.y, t.r + 2, { force: order(t) < 3, bold: order(t) < 2, size: 11, color: t.st === 'sel' ? AMBER : t.mine || t.st ? '#fff' : '#cfd2d6' });
    }
    furniture(v.upp * Math.cos(latOf(v.cy) * RAD));
  }

  function draw() {
    raf = 0; if (dead) return;
    if (anim) {
      const t = clamp((performance.now() - anim.t0) / anim.ms, 0, 1), e = t * t * (3 - 2 * t), a = anim.a, b = anim.b;
      views[scale] = { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, upp: Math.exp(Math.log(a.upp) + (Math.log(b.upp) - Math.log(a.upp)) * e) };
      if (t >= 1) { views[scale] = { ...b }; anim = null; } else request();
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { if (scale === 'local') drawLocal(); else drawWorld(); } catch (e) { console.warn('game: map', e); }
  }
  function request() { if (!raf && !dead) raf = requestAnimationFrame(draw); }

  // ------------------------------------------------------------ the list beside the map, and the card on it
  const dir = (m, deg) => `${G.km(m)} ${G.dirShort(deg)}`;
  function fillList() {
    const a = me();
    if (scale === 'local') {
      const pl = places().map(p => ({ p, d: Math.hypot(p.x - a.x, p.north - a.north) })).sort((u, v) => u.d - v.d);
      const others = (sites || []).filter(s => !s.current).length;
      listEl.innerHTML = `<h3>Travel in ${esc(site.name)}</h3><ul>${pl.map(({ p, d }) => `<li><button data-kind="place" data-id="${esc(p.id)}"><span>${esc(p.name)}<small>${esc(KINDS[p.kind] || p.kind)}</small></span><span class="num">${d < 60 ? 'Here' : esc(dir(d, G.bearing(a, p)))}</span></button></li>`).join('') || '<li class="empty">No named places on this site.</li>'}</ul>
        ${others ? `<h3>Somewhere else</h3><ul><li><button class="more" data-scale="world"><span>All sites<small>${others} other ${others === 1 ? 'site' : 'sites'} to travel to</small></span><span class="num">›</span></button></li></ul>` : ''}`;
    } else if (!sites) listEl.innerHTML = '<ul><li class="empty">Loading the list of sites…</li></ul>';
    else listEl.innerHTML = groups().map(([name, list]) => `<h3>${esc(name)}${list[0].country ? ` · ${esc(list[0].country)}` : ''}</h3><ul>${list.map(s => `<li><button data-kind="site" data-id="${esc(s.id)}"${s.current ? ' class="here"' : ''}><span>${esc(s.name)}<small>${esc(s.tagline || s.summary || '')}</small></span><span class="num${s.current ? ' ok' : ''}">${s.current ? 'You are here' : !s.ready ? 'Being built' : s.km !== null ? `${Math.round(s.km)} km ${G.dirShort(s.bearing)}` : ''}</span></button></li>`).join('')}</ul>`).join('') || '<ul><li class="empty">No sites listed.</li></ul>';
    markList();
  }
  function markList() { for (const b of listEl.querySelectorAll('button[data-kind]')) b.classList.toggle('on', !!sel && b.dataset.kind === sel.kind && b.dataset.id === sel.id); }
  function chrome() {
    root.dataset.view = scale;
    for (const t of tabs) { const on = t.dataset.scale === scale; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); }
    const n = places().length, ns = (sites || []).length, ng = groups().length;
    tabs[0].querySelector('small').textContent = `This site · ${n} ${n === 1 ? 'place' : 'places'}`;
    tabs[1].querySelector('small').textContent = sites ? `${ns} ${ns === 1 ? 'site' : 'sites'} · ${ng} ${ng === 1 ? 'region' : 'regions'}` : 'Loading…';
    $('.legend').innerHTML = scale === 'local'
      ? '<span><i class="me">▲</i> you</span><span><i class="tp">◉</i> travel point</span><span><i class="np">●</i> people</span><span><i class="sg">■</i> signs</span><span><i class="tg">◆</i> objective</span>'
      : '<span><i class="me">▲</i> you are here</span><span><i class="tp">◉</i> site</span><span><i class="tp">②</i> several sites: pick to open the region</span>';
    hintEl.textContent = o.touch ? 'Tap a pin or a name, then Travel' : 'Pick a pin or a name, then Travel · double-click goes at once · scroll to zoom, drag to pan';
  }
  function card() {
    const t = target(); pop.hidden = !t; hintEl.hidden = !!t; if (!t) return;
    const go = pop.querySelector('.go'), alt = pop.querySelector('.alt'), a = me();
    pop.querySelector('b').textContent = t.name; alt.hidden = true; go.disabled = false;
    if (sel.kind === 'place') {
      const d = Math.hypot(t.x - a.x, t.north - a.north), near = d < 60;
      pop.querySelector('small').textContent = `${KINDS[t.kind] || t.kind} · ${near ? 'you are here' : dir(d, G.bearing(a, t)) + ' of you'}`;
      pop.querySelector('p').textContent = near ? '' : /^(reef|dive|pontoon)$/.test(t.kind) ? 'A short boat run puts you in the water over it.' : 'A short boat run puts you ashore beside it.';
      go.textContent = near ? 'You are here' : 'Travel here'; go.disabled = near;
    } else {
      pop.querySelector('small').textContent = `${groupOf(t)}${t.country ? ', ' + t.country : ''}${t.current ? ' · you are here' : t.km !== null ? ` · ${Math.round(t.km)} km ${G.dirShort(t.bearing)} of here` : ''}`;
      pop.querySelector('p').textContent = t.summary || t.tagline || '';
      go.textContent = t.current ? 'Open this site\'s map' : t.ready ? `Travel to ${t.name}` : 'Being built'; go.disabled = !t.current && !t.ready;
    }
    pop.querySelector('p').hidden = !pop.querySelector('p').textContent;
  }
  const target = () => !sel ? null : sel.kind === 'place' ? places().find(p => p.id === sel.id) || null : sel.kind === 'site' ? (sites || []).find(s => s.id === sel.id) || null : null;

  // ------------------------------------------------------------ picking, confirming, switching scale
  function select(ref, from) {
    if (ref && ref.kind === 'group') { sel = null; to(groupFit(ref.id)); card(); markList(); return; }   // a counted pin opens its region
    sel = ref && { kind: ref.kind, id: ref.id }; const t = target(); if (!t) sel = null;
    card(); markList();
    const CARD = Math.min(190, H * 0.45);                    // the card's share of the map, bottom left
    if (t && from === 'list') {
      if (sel.kind === 'place') { if (!inView(lp(t), 44) || covered(lp(t)) || covered(lp(me()))) to(fit([lp(me()), lp(t)], 70, 1500, CARD)); }
      else if (!inView(sp(t), 44) || covered(sp(t)) || !hits.some(h => h.ref.kind === 'site' && h.ref.id === t.id)) {   // out of sight, under the card, or folded into a counted pin: open its region
        const h = here(), same = h && groupOf(h) === groupOf(t);
        to(fit([...(same ? [sp(h)] : []), ...(sites || []).filter(s => groupOf(s) === groupOf(t) && Number.isFinite(s.lat)).map(sp)], 90, 60, CARD));
      }
      if (getComputedStyle(root).gridTemplateColumns.split(' ').length < 2) host.scrollTop = 0;   // one column (a phone): bring the map and its card back up
    } else if (t && from === 'map') {
      const b = listEl.querySelector('button.on'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' });
      const p = sel.kind === 'place' ? lp(t) : sp(t); if (covered(p)) { const v = { ...view() }; v.cy -= (Y(p.y) - (H - CARD - 40)) * v.upp; to(v, 260); }   // slide it out from under the card
    }
    request();
  }
  function confirm() {
    const t = target(); if (!t) return false;
    if (sel.kind === 'place') { if (Math.hypot(t.x - me().x, t.north - me().north) < 60) return false; return !!o.go(t.id); }
    if (t.current) { setScale('local'); return true; }
    if (!t.ready) return false;
    o.travelTo(t.id); return true;
  }
  function setScale(s) {
    if (s === scale) return; scale = s; sel = null; hover = null; anim = null; cv.style.cursor = '';
    if (s === 'world' && !land) loadCoast().then(c => { land = c; request(); });
    chrome(); fillList(); card(); request();
  }
  const pick = (x, y) => { let best = null, bd = 1e9; for (const h of hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < h.r && d < bd) { bd = d; best = h.ref; } } return best; };
  function zoomAt(f, x = W / 2, y = H / 2, ms = 0) {
    const v = { ...(anim ? anim.b : view()) }, wx = v.cx + (x - W / 2) * v.upp, wy = v.cy - (y - H / 2) * v.upp;
    v.upp = clamp(v.upp * f, ...lim()); v.cx = wx - (x - W / 2) * v.upp; v.cy = wy + (y - H / 2) * v.upp;
    if (ms) to(v, ms); else { anim = null; views[scale] = bound(v); request(); }
  }

  // pointers: one drags (a still press is a pick), two pinch
  const pts = new Map(); let drag = null, lastPick = { t: 0, key: '' };
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', e => {
    if (e.button > 0) return; const p = pos(e); pts.set(e.pointerId, p); try { cv.setPointerCapture(e.pointerId); } catch (_) {}
    anim = null;
    if (pts.size === 1) drag = { x: p.x, y: p.y, v: { ...view() }, moved: false };
    else if (pts.size === 2) { const [a, b] = [...pts.values()]; drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), moved: true }; }
  });
  cv.addEventListener('pointermove', e => {
    const p = pos(e);
    if (!pts.has(e.pointerId)) { const h = pick(p.x, p.y), k = h ? h.kind + h.id : ''; if (k !== (hover ? hover.kind + hover.id : '')) { hover = h; cv.style.cursor = h ? 'pointer' : ''; request(); } return; }
    pts.set(e.pointerId, p);
    if (!drag) return;
    if (drag.pinch) { const [a, b] = [...pts.values()]; if (!b) return; const d = Math.hypot(a.x - b.x, a.y - b.y); if (d > 0) { zoomAt(drag.pinch / d, (a.x + b.x) / 2, (a.y + b.y) / 2); drag.pinch = d; } return; }
    const dx = p.x - drag.x, dy = p.y - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    drag.moved = true; cv.style.cursor = 'grabbing';
    views[scale] = bound({ cx: drag.v.cx - dx * drag.v.upp, cy: drag.v.cy + dy * drag.v.upp, upp: drag.v.upp }); request();
  });
  const up = e => {
    const had = pts.has(e.pointerId), p = had ? pos(e) : null; pts.delete(e.pointerId);
    const d = drag; if (pts.size === 0) drag = null; else if (pts.size === 1) { const q = [...pts.values()][0]; drag = { x: q.x, y: q.y, v: { ...view() }, moved: true }; }
    cv.style.cursor = hover ? 'pointer' : '';
    if (!had || !d || d.moved || e.type === 'pointercancel') { request(); return; }
    const h = pick(p.x, p.y), k = h ? h.kind + h.id : '', now = performance.now();
    if (h && h.kind !== 'group' && k === lastPick.key && now - lastPick.t < 420) { select(h, 'map'); confirm(); lastPick = { t: 0, key: '' }; return; }
    lastPick = { t: now, key: k }; select(h, 'map');
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { if (hover) { hover = null; request(); } });
  cv.addEventListener('wheel', e => { e.preventDefault(); const p = pos(e); zoomAt(Math.exp(clamp(e.deltaY, -120, 120) * 0.0022), p.x, p.y); }, { passive: false });
  root.addEventListener('click', e => {
    const z = e.target.closest('[data-z]'), s = e.target.closest('button[data-scale]'), b = e.target.closest('.rg-list button[data-kind]');
    if (z) { if (z.dataset.z === 'fit') to(scale === 'local' ? localAll() : worldAll()); else zoomAt(z.dataset.z === 'in' ? 1 / 1.6 : 1.6, W / 2, H / 2, 220); z.blur(); }
    else if (s) { setScale(s.dataset.scale); s.blur(); }
    else if (b) { select({ kind: b.dataset.kind, id: b.dataset.id }, 'list'); b.blur(); }
    else if (e.target.closest('.rg-pop .go')) confirm();
  });
  root.addEventListener('dblclick', e => { const b = e.target.closest('.rg-list button[data-kind]'); if (b) { select({ kind: b.dataset.kind, id: b.dataset.id }, 'list'); confirm(); } });

  function size() {
    const r = cv.getBoundingClientRect(), w = Math.max(120, Math.round(r.width || 300)), h = Math.max(120, Math.round(r.height || 300));
    const d = Math.min(devicePixelRatio || 1, 1.5);
    if (w === W && h === H && d === dpr && cv.width === Math.round(w * d)) return;
    W = w; H = h; dpr = d; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); request();
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(size) : null; if (ro) ro.observe(cv);
  size(); chrome(); fillList(); card(); draw();
  travel.load().then(l => { if (dead) return; sites = l; views.world = null; chrome(); fillList(); card(); request(); });

  return {
    get scale() { return scale; }, get selected() { return sel; }, get view() { return { ...view(), W, H }; }, get hits() { return hits; },
    setScale, select: (kind, id) => select({ kind, id }, 'list'), confirm, zoomAt, redraw: () => { draw(); },
    destroy() { dead = true; if (ro) ro.disconnect(); cancelAnimationFrame(raf); clearTimeout(baseT); }
  };
}
