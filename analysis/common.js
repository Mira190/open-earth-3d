// Shared loading for the Node analyses: a city's scene files, terrain, config.
//
//   node analysis/<script>.js --city sydney
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const S = require(path.join(ROOT, 'web', 'sun.js'));

function cityArg() {
  const i = process.argv.indexOf('--city');
  return i > 0 ? process.argv[i + 1] : 'sydney';
}
// positional numeric argument (e.g. number of Monte Carlo draws), ignoring --city <id>
function numArg(def) {
  const a = process.argv.slice(2).filter((v, i, all) => v !== '--city' && all[i - 1] !== '--city');
  return a.length ? +a[0] : def;
}

function load(id = cityArg()) {
  const D = path.join(ROOT, 'web', 'data', id);
  const read = f => JSON.parse(fs.readFileSync(path.join(D, f)));
  const scene = read('scene.json'), B = read('buildings.json'), P = read('places.json');
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'cities', id, 'city.json')));
  const tb = Buffer.from(read('terrain.json').data, 'base64');
  const T = { data: Float32Array.from(new Int16Array(tb.buffer, tb.byteOffset, tb.length / 2), v => v * scene.terrain.scale),
    nx: scene.terrain.nx, ny: scene.terrain.ny, cell: scene.terrain.cell, x0: scene.frame.x[0], y1: scene.frame.y[1] };
  const frame = { x0: scene.frame.x[0], x1: scene.frame.x[1], y0: scene.frame.y[0], y1: scene.frame.y[1] };
  S.site({ lat: scene.city.lat, lon: scene.city.lon, tz: scene.city.timezone, locale: scene.city.locale });
  const out = path.join(ROOT, 'cities', id, 'analysis');
  fs.mkdirSync(out, { recursive: true });
  return { id, scene, cfg, B, P, T, frame, dataDir: D, outDir: out, year: scene.city.year || new Date().getFullYear() };
}

// the dates of a list that fall in a place's protected period; when none do (a rule that
// names single days, such as 22 June), the days the period itself names
function datesFor(place, dates) {
  const inside = dates.filter(([m, d]) => S.inPeriod(place.period || 'all', m, d));
  if (inside.length || !place.period || place.period === 'all') return inside;
  return place.period.split(',').map(part => part.split('..')[0].trim().split('-').map(Number));
}

// protected instants of a place on some dates: [{m, d, t, sun}] (local clock time)
function instants(place, dates, step = 15, year = 2026) {
  const out = [];
  const from = S.hm(place.from || '10:00'), to = S.hm(place.to || '14:00');
  for (const [m, d] of datesFor(place, dates)) {
    for (let t = from; t <= to + 1e-9; t += step) {
      const sun = S.position(S.localToUtc(year, m, d, t));
      if (sun.altitude > 0) out.push({ m, d, t, sun });
    }
  }
  return out;
}

// places worth analysing in depth: those with a protected window, protected places
// small enough to be shaded by buildings, and (optionally) unprotected ones for comparison
function analysedPlaces(P, { unprotected = false } = {}) {
  return P.places.filter(p => p.period || (p.lep && p.area_m2 < 50000) || (unprotected && !p.lep));
}

const MONTH_21 = Array.from({ length: 12 }, (_, i) => [i + 1, 21]);
const KEY_DATES = [[3, 21], [6, 21], [9, 22], [12, 21]];

module.exports = { S, ROOT, load, instants, datesFor, analysedPlaces, cityArg, numArg, MONTH_21, KEY_DATES };
