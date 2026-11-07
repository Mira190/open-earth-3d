// How far the game's far ground (every second point of the 5 m grid, 10 m) rises through the landmarks' floors,
// before and after world.js settleUnderFloors (#286): over each floor face's points, the 10 m ground's height
// there less the face's. Reads web/data/<city>/game.json and landmarks.json; no browser.
//   node tools/floor_settle_probe.js queenstown
const fs = require('fs');
const city = process.argv[2] || 'queenstown';
const G = JSON.parse(fs.readFileSync(`web/data/${city}/game.json`, 'utf8')), LM = JSON.parse(fs.readFileSync(`web/data/${city}/landmarks.json`, 'utf8'));
const S = JSON.parse(fs.readFileSync(`web/data/${city}/scene.json`, 'utf8'));
global.window = {};
// the same bilinear sampling as sun.js terrainAt
const terrainAt = (T, x, y) => {
  const c = Math.max(0, Math.min(T.nx - 1.001, (x - T.x0) / T.cell)), r = Math.max(0, Math.min(T.ny - 1.001, (T.y1 - y) / T.cell));
  const c0 = Math.floor(c), r0 = Math.floor(r), fc = c - c0, fr = r - r0, d = T.data, n = T.nx;
  return (d[r0 * n + c0] * (1 - fc) + d[r0 * n + c0 + 1] * fc) * (1 - fr) + (d[(r0 + 1) * n + c0] * (1 - fc) + d[(r0 + 1) * n + c0 + 1] * fc) * fr;
};
window.Sun = { terrainAt };
global.THREE = {};
const src = fs.readFileSync('web/world.js', 'utf8');
const fn = src.slice(src.indexOf('  function settleUnderFloors'), src.indexOf('  return { load, loadLine'));
const settle = new Function('window', fn + '\nreturn settleUnderFloors;')(window);
const t = G.terrain, raw = Buffer.from(t.data, 'base64'), v = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength >> 1);
const Tf = { data: Float32Array.from(v, q => q * t.scale), nx: t.nx, ny: t.ny, cell: t.cell, x0: S.frame.x[0], y1: S.frame.y[1] };
const coarse = () => { const nx = Math.ceil(t.nx / 2), ny = Math.ceil(t.ny / 2), c = new Float32Array(nx * ny);
  for (let r = 0; r < ny; r++) for (let k = 0; k < nx; k++) c[r * nx + k] = Tf.data[(2 * r) * t.nx + 2 * k];
  return { data: c, nx, ny, cell: t.cell * 2, x0: Tf.x0, y1: Tf.y1 }; };
function worst(Tc) {
  let worst = -Infinity, over = 0, n = 0, at = null;
  for (const m of LM.meshes) {
    const p = m.position, ix = m.index;
    for (let i = 0; i + 2 < ix.length; i += 3) {
      const a = 3 * ix[i], b = 3 * ix[i + 1], c = 3 * ix[i + 2];
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nz = ux * vy - uy * vx, nl = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz);
      if (!(nl > 1e-6) || Math.abs(nz) < 0.9 * nl) continue;
      const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
      if (Math.abs(Math.min(p[a + 2], p[b + 2], p[c + 2]) - terrainAt(Tf, cx, cy)) > 1.5) continue;
      for (const [u, w] of [[1 / 3, 1 / 3], [0.8, 0.1], [0.1, 0.8], [0.1, 0.1]]) {
        const x = p[a] + ux * u + vx * w, y = p[a + 1] + uy * u + vy * w, z = p[a + 2] + uz * u + vz * w, d = terrainAt(Tc, x, y) - z;
        n++; if (d > 0.05) over++;
        if (d > worst) { worst = d; at = [Math.round(x), Math.round(y), m.name]; }
      }
    }
  }
  return { worst: +worst.toFixed(2), over, n, at };
}
const before = coarse(), after = coarse();
const lowered = settle(after, Tf, LM);
console.log(city, 'before', JSON.stringify(worst(before)), 'after', JSON.stringify(worst(after)), 'points lowered', lowered);
