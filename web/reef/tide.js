// The tide, from the harmonic constituents fitted to Maritime Safety Queensland's predictions for the site's
// gauge (pipeline/fetch_tide.py; web/data/<id>/tide.json). Heights are metres about mean sea level, the
// terrain's datum. A year outside the fitted ones uses the nearest fitted year (about a centimetre of error
// per year away, from the 18.6-year nodal cycle).
const RAD = Math.PI / 180;

export async function loadTide(base) {
  let T;
  try { const r = await fetch(base + 'tide.json'); if (!r.ok) return null; T = await r.json(); } catch (e) { return null; }
  const years = Object.entries(T.years).map(([y, f]) => ({ y: Number(y), t0: Date.parse(f.t0), c: f.constituents, check: f.check }));
  const pick = ms => years.reduce((b, f) => Math.abs(ms - f.t0 - 1.58e10) < Math.abs(ms - b.t0 - 1.58e10) ? f : b);   // nearest year by its middle
  const at = ms => {
    const f = pick(ms), h = (ms - f.t0) / 3.6e6;
    let z = 0;
    for (const [, w, a, g] of f.c) z += a * Math.cos((w * h - g) * RAD);
    return z;
  };
  // the next high and low waters after `ms`, by stepping and refining the turning points
  function turns(ms, n = 4) {
    const out = [], step = 6 * 60e3;
    let t = ms, prev = at(t), slope = at(t + step) - prev;
    for (let i = 0; i < 24 * 10 * 3 && out.length < n; i++) {
      const z = at(t + step), s = z - prev;
      if (s * slope < 0) {
        let a = t - step, b = t + step;
        for (let k = 0; k < 30; k++) { const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3; ((at(m1) < at(m2)) === (slope > 0)) ? (a = m1) : (b = m2); }
        const tm = (a + b) / 2; out.push({ t: tm, z: at(tm), high: slope > 0 });
      }
      if (s !== 0) slope = s;
      prev = z; t += step;
    }
    return out;
  }
  return { at, turns, rising: ms => at(ms + 6e5) > at(ms), gauge: T.gauge, note: T.note, source: T.source, years: years.map(f => f.y), check: years.map(f => f.check) };
}
