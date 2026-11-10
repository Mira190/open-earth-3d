// The visibility sweep against exact rays (issue 358, B1), in Node, no browser: from random eye points of
// a city, sweep (web/visibility-sweep.js over data/<city>/vis.bin and the game's terrain), then cast exact
// rays from eyes moved anywhere within the sweep's margin (and lower) to random points, over the raster as
// baked (not shrunk by the margin) and the bare terrain. Whatever a ray reaches must be reported seen.
// Also prints how much a sweep hides and how long it takes.
//   node tools/vis_unit.js [city ...]      (default: every live city with a vis.bin)   EYES=40 RAYS=400
const fs = require('fs'), zlib = require('zlib'), path = require('path'), { execSync } = require('child_process');
const V = require('../web/visibility-sweep.js');
const root = path.join(__dirname, '..');
const cities = process.argv.slice(2).length ? process.argv.slice(2) : execSync(`bash ${root}/tools/live_cities.sh`).toString().split(/\s+/).filter(Boolean);
let rnd = 12345; const R = () => (rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296;
let bad = 0;
for (const city of cities) {
  const file = `${root}/web/data/${city}/vis.bin`;
  if (!fs.existsSync(file)) { console.log(`${city}: no vis.bin`); continue; }
  const u = zlib.gunzipSync(fs.readFileSync(file)), n = u.readUInt32LE(4), head = JSON.parse(u.subarray(8, 8 + n).toString());
  if (head.empty) { console.log(`ok   vis    ${city}: no raster (occluders on ${(100 * head.solid).toFixed(1)}% of the frame)`); continue; }
  const start = 8 + n + ((8 - ((8 + n) % 8)) % 8), raster = new Uint8Array(u.buffer, u.byteOffset + start, head.w * head.h);
  const G = JSON.parse(fs.readFileSync(`${root}/web/data/${city}/game.json`, 'utf8')), S = JSON.parse(fs.readFileSync(`${root}/web/data/${city}/scene.json`, 'utf8'));
  const t = G.terrain, raw = Buffer.from(t.data, 'base64'), tz = new Float32Array(t.nx * t.ny);
  for (let i = 0; i < tz.length; i++) tz[i] = raw.readInt16LE(2 * i) * t.scale;
  const terrain = { data: tz, nx: t.nx, ny: t.ny, cell: t.cell, x0: S.frame.x[0], y1: S.frame.y[1] };
  const ground = (x, y) => { // the game's own bilinear terrain (nav.js)
    const c = Math.max(0, Math.min(t.nx - 1.001, (x - terrain.x0) / t.cell)), r = Math.max(0, Math.min(t.ny - 1.001, (terrain.y1 - y) / t.cell)), ci = Math.floor(c), ri = Math.floor(r), fc = c - ci, fr = r - ri;
    const a = tz[ri * t.nx + ci], b = tz[ri * t.nx + ci + 1], d = tz[(ri + 1) * t.nx + ci], e = tz[(ri + 1) * t.nx + ci + 1];
    return fc + fr <= 1 ? a + fc * (b - a) + fr * (d - a) : e + (1 - fc) * (d - e) + (1 - fr) * (b - e);
  };
  const M = V.model(head, raster, terrain), { w, h, px, x0, y0, z0, q } = M, g = M.grid;
  const indoors = (x, y) => top(x, y) > -Infinity; // (the page gives no answer to a camera inside a building: here, on an occluder)
  const top = (x, y) => { const i = Math.floor((x - x0) / px), j = Math.floor((y - y0) / px); if (i < 0 || j < 0 || i >= w || j >= h) return -Infinity; const v = raster[j * w + i]; return v ? z0 + (v - 1) * q : -Infinity; };
  const EYES = +(process.env.EYES || 40), RAYS = +(process.env.RAYS || 400);
  let rays = 0, reach = 0, miss = 0, ms = 0, sweeps = 0, hidWalk = 0, hid12 = 0, cells = 0, inside = 0;
  for (let k = 0; k < EYES; k++) {
    const eps = [1, 2, 4, 8][k % 4], T = V.tier(M, eps);
    let x, y, tries = 0;
    do { x = x0 + R() * w * px; y = y0 + R() * h * px; } while (indoors(x, y) && ++tries < 50);
    const z = ground(x, y) + 1 + R() * 6, t0 = process.hrtime.bigint();
    const A = V.sweep(M, T, x, y, z, { beams: 720 });
    ms += Number(process.hrtime.bigint() - t0) / 1e6; sweeps++;
    if (!A) { inside++; continue; }
    // how much is hidden within 450 m (the crowd's reach): a walker, a 12 m roof
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const cx = g.x0 + (i + 0.5) * g.cell, cy = g.y0 + (j + 0.5) * g.cell;
      if (Math.hypot(cx - x, cy - y) > 450 || cx < x0 || cy < y0 || cx >= x0 + w * px || cy >= y0 + h * px) continue;
      const gz = ground(cx, cy); cells++;
      if (A[j * g.nx + i] > gz + 2.2) hidWalk++;
      if (A[j * g.nx + i] > gz + 12) hid12++;
    }
    for (let r = 0; r < RAYS; r++) {
      // an eye within eps of the sweep's, no higher; a point up to 1.5 km off
      const ea = R() * 2 * Math.PI, ed = Math.sqrt(R()) * T.eps, ex = x + Math.cos(ea) * ed, ey = y + Math.sin(ea) * ed, ez = z - R() * Math.min(3, z - ground(ex, ey) - 0.3);
      if (indoors(ex, ey) || ground(ex, ey) > ez) continue;
      const a = R() * 2 * Math.PI, d = 3 + R() * R() * 1500, tx = ex + Math.cos(a) * d, ty = ey + Math.sin(a) * d;
      if (tx < x0 || ty < y0 || tx >= x0 + w * px || ty >= y0 + h * px) continue;
      const tzz = ground(tx, ty) + [0.2, 1.7, 2.2, 6, 12, 30, 55][Math.floor(R() * 7)];
      rays++;
      let clear = true;
      const steps = Math.max(2, Math.ceil(d / 0.2));
      for (let s = 1; s < steps && clear; s++) { const f = s / steps, X = ex + (tx - ex) * f, Y = ey + (ty - ey) * f, Z = ez + (tzz - ez) * f; if (top(X, Y) >= Z || ground(X, Y) - 0.01 >= Z) clear = false; }
      if (!clear) continue;
      reach++;
      const i = Math.floor((tx - g.x0) / g.cell), j = Math.floor((ty - g.y0) / g.cell);
      if (A[j * g.nx + i] > tzz) { miss++; if (miss <= 5) console.log(`  MISS ${city}: eye (${ex.toFixed(1)}, ${ey.toFixed(1)}, ${ez.toFixed(1)}) [sweep at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) eps ${T.eps}] sees (${tx.toFixed(1)}, ${ty.toFixed(1)}, ${tzz.toFixed(1)}) at ${d.toFixed(0)} m, reported hidden under ${A[j * g.nx + i].toFixed(1)}`); }
    }
  }
  bad += miss;
  console.log(`${miss ? 'FAIL' : 'ok  '} vis    ${city}: ${sweeps} sweeps (${inside} inside an occluder), ${(ms / sweeps).toFixed(1)} ms each; ${rays} exact rays, ${reach} reach their point, ${miss} of those reported hidden; within 450 m a walker is hidden in ${(100 * hidWalk / Math.max(1, cells)).toFixed(0)}% of the cells, a 12 m roof in ${(100 * hid12 / Math.max(1, cells)).toFixed(0)}%`);
}
process.exit(bad ? 1 : 0);
