// What a fish looks like (docs/FISHING.md, "The fish itself"). Fetched with fishing.js the first time you come
// within reach of a spot; nothing here runs until then.
//
// One description of a fish, a `spec`, makes both of its pictures: the side-on portrait in the log (SVG, no
// texture, crisp at any size, a black silhouette until the fish is caught) and the 3D fish you hold up on the
// line (a lofted body with an eye, a gill cover, rayed fins and scale rows in its vertex colours, about 1,200
// triangles). So the picture in the log is the fish you caught.
//
// A spec is in units of the fish's length: x runs from the nose (0) to the tip of the tail (1), y is up, the
// body's half width is `wk` of its half depth. `top` and `bot` are the outline of the back and the belly as
// points; the fins are rays from the body's edge. The yellowfin bream is drawn in full (a field guide's
// drawing: SPECS below). Every other fish gets a plain spindle from its `look` colours until it has a spec of
// its own: to draw another, add one to SPECS, nothing else changes.
'use strict';
window.OEFishArt = (function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mix = (a, b, k) => a + (b - a) * k;

  // ------------------------------------------------------------ the fish, drawn: the yellowfin bream
  // (Acanthopagrus australis: a deep, flat-sided silver fish with a steep forehead, a small mouth set low, an eye
  // high and near the front, eleven dorsal spines and the yellow pelvic and anal fins it is named for)
  const BREAM = {
    id: 'yellowfin-bream', wk: 0.5,
    top: [[0, 0.012], [0.03, 0.045], [0.08, 0.098], [0.15, 0.152], [0.24, 0.19], [0.34, 0.205], [0.44, 0.2], [0.55, 0.166], [0.66, 0.11], [0.75, 0.07], [0.83, 0.052]],
    bot: [[0, -0.006], [0.03, -0.028], [0.08, -0.072], [0.16, -0.118], [0.26, -0.148], [0.36, -0.16], [0.46, -0.146], [0.56, -0.11], [0.66, -0.08], [0.75, -0.06], [0.83, -0.05]],
    eye: { x: 0.092, y: 0.07, r: 0.0255 }, mouth: { x: 0, y: -0.012, len: 0.034 }, gill: 0.205, lateral: 0.7, rows: 11,
    palette: { back: '#575940', upper: '#9a9c84', flank: '#d0d3c3', belly: '#f2eedb', sheen: '#dcc56a', iris: '#c9a63e', gillEdge: '#4d4936', line: '#6f6e5a' },
    // each fin: rays from the body's edge. [base x, height out of the edge, lean back per unit height]
    fins: {
      dorsal: { color: '#7c7a62', edge: '#37342a', side: 1, rays: [...span(11, 0.27, 0.47, 0.052, 0.074, 0.25), ...span(11, 0.485, 0.65, 0.1, 0.05, 0.55)] },
      anal: { color: '#e2b933', edge: '#9b7a1d', side: -1, rays: [...span(3, 0.555, 0.585, 0.04, 0.062, 0.15), ...span(8, 0.6, 0.69, 0.085, 0.05, 0.6)] },
      pelvic: { color: '#e6c13a', edge: '#a8821f', side: -1, paired: 1, rays: span(7, 0.285, 0.345, 0.07, 0.105, 0.9), flare: 1.7 },
      pectoral: { color: '#ecdc94', edge: '#b3a560', paired: 1, at: [0.232, 0.012], len: 0.15, spread: 0.05, n: 11, translucent: 1, flare: 1.9 },
      caudal: { color: '#8d8668', edge: '#34301f', root: [0.822, 0.05], tip: 1, lobe: 0.14, notch: 0.93, n: 15 },
    },
    // what to look for, as a field guide puts it
    guide: 'A deep, flat-sided silver fish with a steep forehead and a small mouth set low. The pelvic and anal fins are yellow; the dorsal fin has eleven stout spines.',
  };
  function span(n, x0, x1, h0, h1, lean) { const a = []; for (let i = 0; i < n; i++) { const k = n === 1 ? 0 : i / (n - 1); a.push([mix(x0, x1, k), mix(h0, h1, k), lean]); } return a; }
  const SPECS = { 'yellowfin-bream': BREAM };

  // a plain fish from a species' `look` colours (and its depth, its stripe, bars, spots) until it has a spec
  const generic = s => {
    const L = s.look || {}, d = L.deep || 0.27, bk = L.back || '#56666a', fl = L.flank || '#b9c2c0', bl = L.belly || '#eeeeea', fn = L.fin || bk;
    const T = x => Math.sin(Math.PI * Math.pow(clamp(x / 0.84, 0, 1), 0.78)) * 0.56 + (x < 0.05 ? 0.012 : 0), B = x => Math.sin(Math.PI * Math.pow(clamp(x / 0.84, 0, 1), 0.78)) * 0.44;
    const xs = [0, 0.03, 0.08, 0.16, 0.26, 0.38, 0.5, 0.62, 0.72, 0.8, 0.84];
    return {
      id: s.id, generic: 1, wk: L.flat ? 1.7 : 0.55,
      top: xs.map(x => [x, Math.max(0.012, T(x) * d * 0.55)]), bot: xs.map(x => [x, -Math.max(0.006, B(x) * d * 0.55)]),
      eye: { x: 0.08, y: d * 0.1, r: 0.02 }, mouth: { x: 0, y: -0.004, len: 0.03 }, gill: 0.19, lateral: 0.65, rows: 9,
      palette: { back: bk, upper: mixHex(bk, fl, 0.5), flank: fl, belly: bl, sheen: fl, iris: '#c8b36a', gillEdge: mixHex(bk, '#000000', 0.3), line: mixHex(bk, fl, 0.4), stripe: L.stripe, bars: L.bars, spots: L.spots },
      fins: {
        dorsal: { color: fn, edge: mixHex(fn, '#000000', 0.45), side: 1, rays: [...span(8, 0.3, 0.46, d * 0.2, d * 0.24, 0.3), ...span(8, 0.48, 0.64, d * 0.26, d * 0.14, 0.5)] },
        anal: { color: fn, edge: mixHex(fn, '#000000', 0.45), side: -1, rays: span(9, 0.56, 0.7, d * 0.2, d * 0.12, 0.5) },
        pelvic: { color: fn, edge: mixHex(fn, '#000000', 0.45), side: -1, paired: 1, rays: span(5, 0.3, 0.34, d * 0.2, d * 0.26, 0.9), flare: 1.6 },
        pectoral: { color: mixHex(fn, fl, 0.5), edge: mixHex(fn, '#000000', 0.3), paired: 1, at: [0.22, 0], len: 0.14, spread: d * 0.2, n: 9, translucent: 1, flare: 1.8 },
        caudal: { color: fn, edge: mixHex(fn, '#000000', 0.5), root: [0.82, 0.05], tip: 1, lobe: d * 0.45, notch: 0.93, n: 13 },
      },
    };
  };
  function mixHex(a, b, k) { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(mix(v, B[i], k)).toString(16).padStart(2, '0')).join(''); }
  const cache = {};
  const specOf = s => SPECS[s.id] || cache[s.id] || (cache[s.id] = generic(s));

  // ------------------------------------------------------------ curves and fins, shared by both pictures
  // y at x along a list of [x, y] points: a cubic through them (Catmull-Rom slopes)
  function curve(pts) {
    const n = pts.length, m = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; return (b[1] - a[1]) / Math.max(1e-6, b[0] - a[0]); });
    return x => {
      x = clamp(x, pts[0][0], pts[n - 1][0]);
      let i = 0; while (i < n - 2 && x > pts[i + 1][0]) i++;
      const p0 = pts[i], p1 = pts[i + 1], h = p1[0] - p0[0], t = (x - p0[0]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * p0[1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p1[1] + (t3 - t2) * h * m[i + 1];
    };
  }
  const built = new WeakMap();
  // the spec with its outline functions and every fin as rays: { b: [x, y] on the body, t: [x, y] the tip }
  function prep(spec) {
    if (built.has(spec)) return built.get(spec);
    const top = curve(spec.top), bot = curve(spec.bot), x1 = spec.top[spec.top.length - 1][0], F = spec.fins, fins = [];
    for (const [name, f] of Object.entries(F)) {
      const rays = [];
      if (f.rays) for (const [x, h, lean] of f.rays) { const e = f.side > 0 ? top(x) : bot(x); rays.push({ b: [x, e - f.side * 0.012], t: [x + lean * h, e + f.side * h] }); }
      else if (f.at) for (let i = 0; i < f.n; i++) { const u = i / (f.n - 1) * 2 - 1, bx = f.at[0] + 0.01 * (1 - Math.abs(u)); rays.push({ b: [bx, f.at[1] + u * 0.016], t: [bx + f.len * (1 - 0.3 * Math.abs(u)), f.at[1] + u * f.spread - 0.05 * f.len / 0.17] }); }
      else for (let i = 0; i < f.n; i++) { const u = i / (f.n - 1) * 2 - 1, a = Math.abs(u); rays.push({ b: [f.root[0] - 0.008 * (1 - a), u * f.root[1] * 0.9], t: [f.notch + (f.tip - f.notch) * Math.pow(a, 0.8), u * f.lobe] }); }
      fins.push({ name, f, rays });
    }
    const out = { spec, top, bot, x1, fins, ry: x => (top(x) - bot(x)) / 2, cy: x => (top(x) + bot(x)) / 2 };
    built.set(spec, out);
    return out;
  }

  // ------------------------------------------------------------ the portrait: SVG, side on, nose to the left
  let uid = 0;
  const fx = v => ((v + 0.03) * 1000).toFixed(1), fy = v => ((0.3 - v) * 1000).toFixed(1);
  function smoothPath(pts) { // a closed-looking open path through points, as quadratic midpoints
    let d = `M${fx(pts[0][0])} ${fy(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) { const m = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]; d += `Q${fx(pts[i][0])} ${fy(pts[i][1])} ${fx(m[0])} ${fy(m[1])}`; }
    const l = pts[pts.length - 1]; return d + `L${fx(l[0])} ${fy(l[1])}`;
  }
  // silhouette: a flat dark fish, for a kind not caught yet
  function portrait(species, opts = {}) {
    const spec = specOf(species), P = prep(spec), pal = spec.palette, id = `fa${++uid}`, sil = !!opts.silhouette;
    const N = 40, ts = [], bs = [];
    for (let i = 0; i <= N; i++) { const x = P.x1 * i / N; ts.push([x, P.top(x)]); bs.push([x, P.bot(x)]); }
    const body = smoothPath(ts) + 'L' + bs.slice().reverse().map(p => `${fx(p[0])} ${fy(p[1])}`).join('L') + 'Z';
    const fill = sil ? 'rgba(236,232,225,0.07)' : null, parts = [];
    const finSvg = ({ name, f, rays }) => {
      const tip = rays.map(r => r.t), base = rays.map(r => r.b);
      const poly = `M${base.map(p => `${fx(p[0])} ${fy(p[1])}`).join('L')}L${tip.slice().reverse().map(p => `${fx(p[0])} ${fy(p[1])}`).join('L')}Z`;
      const g = `<linearGradient id="${id}${name}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${f.color}"/><stop offset="0.75" stop-color="${f.color}"/><stop offset="1" stop-color="${f.edge}"/></linearGradient>`;
      const lines = sil ? '' : rays.map((r, i) => (i % (name === 'caudal' ? 1 : 1) === 0 ? `<path d="M${fx(r.b[0])} ${fy(r.b[1])}L${fx(r.t[0])} ${fy(r.t[1])}" stroke="${f.edge}" stroke-opacity="${name === 'dorsal' ? 0.5 : 0.32}" stroke-width="1.4" fill="none"/>` : '')).join('');
      return { poly, defs: sil ? '' : g, svg: `<path d="${poly}" fill="${sil ? fill : `url(#${id}${name})`}" fill-opacity="${f.translucent && !sil ? 0.82 : 1}" stroke="${sil ? 'rgba(236,232,225,0.22)' : f.edge}" stroke-opacity="${sil ? 1 : 0.55}" stroke-width="1.6" stroke-linejoin="round"/>${lines}` };
    };
    const fins = {}; for (const f of P.fins) fins[f.name] = finSvg(f);
    const rowLines = [];
    if (!sil) for (let r = 1; r < spec.rows; r++) {
      const v = r / spec.rows, pts = []; for (let i = 3; i <= N - 3; i++) { const x = P.x1 * i / N; if (x < spec.gill + 0.01) continue; pts.push([x, mix(P.bot(x), P.top(x), v)]); }
      rowLines.push(`<path d="${smoothPath(pts)}" fill="none" stroke="#2c2a1d" stroke-opacity="${v > 0.45 ? 0.1 : 0.06}" stroke-width="1.4"/>`);
    }
    const lat = []; for (let i = 0; i <= N; i++) { const x = spec.gill + 0.005 + (P.x1 - 0.06 - spec.gill) * i / N; lat.push([x, mix(P.bot(x), P.top(x), spec.lateral)]); }
    const e = spec.eye, gx = spec.gill, gt = P.top(gx) * 0.78, gb = P.bot(gx) * 0.9;
    const stripeSvg = !sil && pal.stripe ? `<path d="${smoothPath(lat.map(p => [p[0], mix(P.bot(p[0]), P.top(p[0]), 0.5)]))}" fill="none" stroke="${pal.stripe}" stroke-opacity="0.7" stroke-width="${(0.05 * 1000 * Math.min(1, P.ry(0.4) * 5)).toFixed(0)}" stroke-linecap="round"/>` : '';
    const detail = sil ? '' : `<g clip-path="url(#${id}c)">
        <rect x="0" y="0" width="1100" height="700" fill="url(#${id}v)"/>${stripeSvg}${rowLines.join('')}
        <path d="${smoothPath(ts.map(p => [p[0], mix(P.bot(p[0]), P.top(p[0]), 0.58) ]))}" fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="${(P.ry(0.4) * 1000 * 0.22).toFixed(0)}" stroke-linecap="round"/>
        <rect x="0" y="0" width="${fx(gx + 0.01)}" height="700" fill="url(#${id}g)"/>
        <rect x="0" y="0" width="1100" height="700" fill="url(#${id}h)"/>
      </g>
      <path d="${smoothPath(lat)}" fill="none" stroke="${pal.line}" stroke-opacity="0.55" stroke-width="1.6" stroke-dasharray="1 4" stroke-linecap="round"/>
      <path d="M${fx(gx - 0.012)} ${fy(gt)}C${fx(gx + 0.012)} ${fy(gt * 0.5)} ${fx(gx + 0.016)} ${fy(gb * 0.5)} ${fx(gx - 0.02)} ${fy(gb)}" fill="none" stroke="${pal.gillEdge}" stroke-opacity="0.75" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M${fx(gx - 0.044)} ${fy(gt * 0.92)}C${fx(gx - 0.02)} ${fy(gt * 0.5)} ${fx(gx - 0.02)} ${fy(gb * 0.5)} ${fx(gx - 0.05)} ${fy(gb * 0.9)}" fill="none" stroke="${pal.gillEdge}" stroke-opacity="0.22" stroke-width="2"/>
      <circle cx="${fx(e.x + 0.004)}" cy="${fy(e.y)}" r="${(e.r * 1000 * 1.32).toFixed(1)}" fill="#2a2818" fill-opacity="0.28"/>
      <circle cx="${fx(e.x)}" cy="${fy(e.y)}" r="${(e.r * 1000).toFixed(1)}" fill="${pal.iris}" stroke="#2a2818" stroke-width="1.6"/>
      <circle cx="${fx(e.x + 0.002)}" cy="${fy(e.y)}" r="${(e.r * 1000 * 0.62).toFixed(1)}" fill="#0b0b08"/>
      <circle cx="${fx(e.x - 0.006)}" cy="${fy(e.y + 0.008)}" r="${(e.r * 1000 * 0.2).toFixed(1)}" fill="#fff" fill-opacity="0.85"/>
      <path d="M${fx(spec.mouth.x + 0.002)} ${fy(spec.mouth.y)}Q${fx(spec.mouth.x + spec.mouth.len * 0.6)} ${fy(spec.mouth.y - 0.004)} ${fx(spec.mouth.x + spec.mouth.len)} ${fy(spec.mouth.y + 0.004)}" fill="none" stroke="#2a2218" stroke-opacity="0.8" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="${fx(e.x - 0.036)}" cy="${fy(e.y - 0.012)}" r="2.4" fill="#2a2818" fill-opacity="0.6"/>`;
    const defs = sil ? `<clipPath id="${id}c"><path d="${body}"/></clipPath>` : `<clipPath id="${id}c"><path d="${body}"/></clipPath>
      <linearGradient id="${id}v" x1="0" y1="${fy(0.215)}" x2="0" y2="${fy(-0.17)}" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="${pal.back}"/><stop offset="0.2" stop-color="${pal.back}"/><stop offset="0.44" stop-color="${pal.upper}"/><stop offset="0.62" stop-color="${pal.flank}"/><stop offset="0.8" stop-color="${mixHex(pal.flank, pal.sheen, 0.45)}"/><stop offset="0.9" stop-color="${pal.belly}"/><stop offset="1" stop-color="${pal.belly}"/></linearGradient>
       <linearGradient id="${id}g" x1="${fx(gx - 0.12)}" y1="0" x2="${fx(gx + 0.01)}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1a1a10" stop-opacity="0.26"/><stop offset="0.7" stop-color="#1a1a10" stop-opacity="0.14"/><stop offset="1" stop-color="#1a1a10" stop-opacity="0"/></linearGradient>
      <linearGradient id="${id}h" x1="0" y1="${fy(0.215)}" x2="0" y2="${fy(-0.17)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity="0.22"/><stop offset="0.25" stop-color="#000" stop-opacity="0"/><stop offset="0.8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.2"/></linearGradient>${Object.values(fins).map(f => f.defs).join('')}`;
    let ymax = -9, ymin = 9, xmax = P.x1; // the picture's frame: the whole fish, its fins too
    for (let i = 0; i <= N; i++) { const x = P.x1 * i / N; ymax = Math.max(ymax, P.top(x)); ymin = Math.min(ymin, P.bot(x)); }
    for (const { rays } of P.fins) for (const r of rays) { ymax = Math.max(ymax, r.t[1]); ymin = Math.min(ymin, r.t[1]); xmax = Math.max(xmax, r.t[0]); }
    const order = ['pelvic', 'anal', 'dorsal', 'caudal'];
    if (sil) { // one pale shape at low strength, as a whole (so the fins that overlap the body do not show through it)
      const lo = ts.map(p => p[0]), shapes = [...order.map(n => fins[n] && `<path d="${fins[n].poly}"/>`), `<path d="${body}"/>`, fins.pectoral && `<path d="${fins.pectoral.poly}"/>`].filter(Boolean).join('');
      return `<svg class="fa-portrait" xmlns="http://www.w3.org/2000/svg" viewBox="VIEW" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g fill="#ece8e1" opacity="0.11">${shapes}</g></svg>`.replace('VIEW', `${((-0.012 + 0.03) * 1000).toFixed(0)} ${((0.3 - ymax - 0.012) * 1000).toFixed(0)} ${((xmax + 0.024) * 1000).toFixed(0)} ${((ymax - ymin + 0.024) * 1000).toFixed(0)}`);
    }
    const bodyEl = `<path d="${body}" fill="${sil ? fill : pal.flank}" stroke="${sil ? 'rgba(236,232,225,0.22)' : '#27261a'}" stroke-opacity="${sil ? 1 : 0.6}" stroke-width="2" stroke-linejoin="round"/>`;
    const vx = (-0.012 + 0.03) * 1000, vy = (0.3 - ymax - 0.012) * 1000, w = (xmax + 0.012 + 0.012) * 1000, h = (ymax - ymin + 0.024) * 1000, label = opts.label ? ` role="img" aria-label="${opts.label}"` : ' aria-hidden="true"';
    return `<svg class="fa-portrait" xmlns="http://www.w3.org/2000/svg" viewBox="${vx.toFixed(0)} ${vy.toFixed(0)} ${w.toFixed(0)} ${h.toFixed(0)}" preserveAspectRatio="xMidYMid meet"${label}><defs>${defs}</defs>`
      + order.map(n => fins[n] && fins[n].svg).join('') + bodyEl + detail + (fins.pectoral ? fins.pectoral.svg : '') + '</svg>';
  }

  // ------------------------------------------------------------ the fish in the world
  // A fish built once per kind: nose +y, the back +z, across x, a length of 1 (scale it by the fish's length),
  // centred on its middle. `low` is the low tier's coarser body.
  function geometry(THREE, species, low) {
    const spec = specOf(species), P = prep(spec), pal = spec.palette, NS = low ? 20 : 30, NA = low ? 10 : 14;
    const pos = [], col = [], idx = [];
    const c = new THREE.Color(), lin = h => new THREE.Color(h).convertSRGBToLinear();
    const k = { back: lin(pal.back), upper: lin(pal.upper), flank: lin(pal.flank), belly: lin(pal.belly), sheen: lin(pal.sheen), edge: lin(pal.gillEdge) };
    const stripe = pal.stripe ? lin(pal.stripe) : null, spots = pal.spots ? lin(pal.spots) : null;
    const put = (x, y, z, r, g, b) => { pos.push(z, 0.5 - x, y); col.push(r, g, b); return pos.length / 3 - 1; };   // spec (x, y, z) to the mesh's axes (across, nose up, back up)
    // the body: NS stations from the nose to the tail's wrist, NA points round each
    const xe = P.x1;
    for (let i = 0; i <= NS; i++) {
      const u = i / NS, x = xe * (u < 0.5 ? 0.5 * Math.pow(2 * u, 1.35) : 1 - 0.5 * Math.pow(2 - 2 * u, 1.0)), ry = Math.max(0.0035, P.ry(x)), cy = P.cy(x), hw = Math.max(0.003, ry * spec.wk * (x < 0.18 ? 1.08 : 1));
      for (let a = 0; a < NA; a++) {
        const ang = a / NA * Math.PI * 2, s = Math.sin(ang), cz = Math.cos(ang), v = (1 + s) / 2;
        // the belly, flank and back, by how high on the side; the gold along the lower flank; scale rows; the head darker; the gill's edge
        if (v > 0.8) c.copy(k.back); else if (v > 0.58) c.copy(k.upper).lerp(k.back, (v - 0.58) / 0.22); else if (v > 0.4) c.copy(k.flank).lerp(k.upper, (v - 0.4) / 0.18); else c.copy(k.belly).lerp(k.flank, clamp((v - 0.12) / 0.28, 0, 1));
        if (v > 0.3 && v < 0.5) c.lerp(k.sheen, 0.32 * (1 - Math.abs(v - 0.4) / 0.1));
        if (stripe && v > 0.35 && v < 0.65 && x > 0.12) c.lerp(stripe, 0.7);
        if (pal.bars && v > 0.4 && Math.sin(x * pal.bars * Math.PI * 1.2) > 0.4) c.multiplyScalar(0.62);
        if (spots && v > 0.35 && ((i * 73856093 ^ a * 19349663) >>> 0) % 9 === 0) c.lerp(spots, 0.7);
        if (v > 0.35) c.multiplyScalar(0.955 + 0.045 * Math.cos(v * spec.rows * Math.PI * 2));
        if (x < spec.gill - 0.02) c.multiplyScalar(0.9); else if (x < spec.gill + 0.012) c.lerp(k.edge, 0.55);
        if (x < 0.035) c.lerp(k.edge, 0.4);
        put(x, cy + ry * s, hw * cz, c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < NS; i++) for (let a = 0; a < NA; a++) { const a2 = (a + 1) % NA, p = i * NA, q = (i + 1) * NA; idx.push(p + a, q + a, q + a2, p + a, q + a2, p + a2); }
    // the nose and the tail's wrist are closed
    const cap = (i, x) => { const m = put(x, P.cy(x), 0, k.flank.r, k.flank.g, k.flank.b); for (let a = 0; a < NA; a++) idx.push(i * NA + a, i * NA + (a + 1) % NA, m); };
    cap(0, 0); cap(NS, xe);
    // the eyes, a gold ring round a black pupil, standing a little out of the head; and the mouth's line
    const ball = (x, y, z, r, hex, sx) => { const n0 = pos.length / 3, g = lin(hex), SU = low ? 6 : 8, SV = low ? 4 : 6; for (let j = 0; j <= SV; j++) for (let i = 0; i < SU; i++) { const th = j / SV * Math.PI, ph = i / SU * Math.PI * 2; put(x + r * Math.cos(th) * 0.7, y + r * Math.sin(th) * Math.sin(ph), sx * (z + r * Math.sin(th) * Math.cos(ph) * 0.8), g.r, g.g, g.b); } for (let j = 0; j < SV; j++) for (let i = 0; i < SU; i++) { const a = n0 + j * SU + i, b = n0 + j * SU + (i + 1) % SU, cc = n0 + (j + 1) * SU + i, d = n0 + (j + 1) * SU + (i + 1) % SU; idx.push(a, cc, d, a, d, b); } };
    const e = spec.eye, ex = e.x, ey = e.y, ez = Math.max(0.01, P.ry(ex) * spec.wk * 1.05 * Math.sqrt(Math.max(0.1, 1 - ((ey - P.cy(ex)) / Math.max(1e-3, P.ry(ex))) ** 2)));
    for (const sx of [1, -1]) { ball(ex, ey, ez - e.r * 0.3, e.r, pal.iris, sx); ball(ex + 0.002, ey, ez + e.r * 0.15, e.r * 0.62, '#0b0b08', sx); }
    // the fins: a membrane between rays, each ray a little darker than the membrane, the edge darker still
    for (const { f, rays } of P.fins) {
      const base = lin(f.color), edge = lin(f.edge), n = rays.length, sides = f.paired ? [1, -1] : [0];
      for (const sd of sides) {
        const zOf = (x, y, tip) => { if (!sd) return 0; const hw = Math.max(0.01, P.ry(x) * spec.wk); return sd * hw * (tip ? (f.flare || 1.5) : 0.9); };
        const first = pos.length / 3;
        for (let i = 0; i < n; i++) {
          const r = rays[i], ray = 0.9 + 0.1 * (i % 2), e0 = f.translucent ? 0.55 : 0.8;
          put(r.b[0], r.b[1], zOf(r.b[0], r.b[1], 0), base.r * ray, base.g * ray, base.b * ray);
          put(r.t[0], r.t[1], zOf(r.b[0], r.b[1], 1), mix(base.r, edge.r, e0) * ray, mix(base.g, edge.g, e0) * ray, mix(base.b, edge.b, e0) * ray);
        }
        for (let i = 0; i < n - 1; i++) { const b0 = first + i * 2, t0 = b0 + 1, b1 = b0 + 2, t1 = b0 + 3; idx.push(b0, t0, t1, b0, t1, b1); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.translate(0, 0, 0);
    return g;
  }
  // a body that swims: the tail end swings across by `wag`, in the vertex shader (one uniform each, no rebuilding)
  function material(THREE) {
    const wag = { value: 0 }, ph = { value: 0 };
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.16, side: THREE.DoubleSide });
    m.onBeforeCompile = sh => {
      sh.uniforms.uWag = wag; sh.uniforms.uPh = ph;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWag; uniform float uPh;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  { float s = clamp(0.5 - position.y, 0.0, 1.0); transformed.x += uWag * s * s * sin(uPh - s * 3.2); }');
    };
    return { material: m, wag, ph };
  }
  // the pictures' common size for a body of length `cm`: the scale of a mesh made with geometry()
  const SPEC_IDS = () => Object.keys(SPECS);
  return { portrait, geometry, material, specOf, SPECS, SPEC_IDS, prep };
})();
