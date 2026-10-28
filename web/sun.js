// Sun position, local clock time (any IANA time zone) and shadow analysis on a surface model.
// Works in the browser (window.Sun) and in Node (require('./sun.js')).
//
// Solar position: NOAA Solar Calculator equations (Meeus), good to about
// 0.01 degrees for current dates, which at 100 m of building height is ~2 cm
// of shadow length at noon. Refraction is ignored (it matters only within a
// few degrees of the horizon).
//
// Shadows: a 2 m digital surface model (terrain + buildings) rasterised from
// the same footprints the 3D view extrudes. A ground point is in sun when the
// ray towards the sun clears every cell of the model.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sun = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RAD = Math.PI / 180;
  // the city being viewed or analysed; set with site({ lat, lon, tz, locale })
  let SITE = { lat: -33.862, lon: 151.2115, tz: 'Australia/Sydney', locale: 'en-AU' };
  function site(s) { if (s) SITE = Object.assign({}, SITE, s); return SITE; }

  // ------------------------------------------------------------ time
  // Local clock time for any IANA time zone, daylight saving included, from the
  // platform's time zone database (Intl), so no city needs hand-written DST rules.
  const fmts = {};
  const fmt = (tz, opts, locale = 'en-US') => fmts[locale + tz + JSON.stringify(opts)] ||
    (fmts[locale + tz + JSON.stringify(opts)] = new Intl.DateTimeFormat(locale, Object.assign({ timeZone: tz }, opts)));
  const NUM = { hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' };
  // hours ahead of UTC at this instant
  function offsetHours(utcMs, tz = SITE.tz) {
    const t = Math.floor(utcMs / 1000) * 1000;
    const p = {};
    for (const x of fmt(tz, NUM).formatToParts(new Date(t))) p[x.type] = +x.value;
    return (Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - t) / 3600e3;
  }
  // the zone's standard (non-daylight-saving) offset in a given year
  function standardOffset(year, tz = SITE.tz) {
    return Math.min(offsetHours(Date.UTC(year, 0, 1, 12), tz), offsetHours(Date.UTC(year, 6, 1, 12), tz));
  }
  // local clock time -> UTC ms (minutes since local midnight)
  function localToUtc(y, m, d, minutes, tz = SITE.tz) {
    const wall = Date.UTC(y, m - 1, d) + minutes * 60e3;
    let t = wall - offsetHours(wall, tz) * 3600e3;
    t = wall - offsetHours(t, tz) * 3600e3; // second pass settles days when the offset changes
    return t;
  }
  function utcToLocal(utcMs, tz = SITE.tz) {
    const off = offsetHours(utcMs, tz), d = new Date(utcMs + off * 3600e3);
    const zp = fmt(tz, { timeZoneName: 'short' }, SITE.locale).formatToParts(new Date(utcMs)).find(x => x.type === 'timeZoneName');
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
      minutes: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60, offset: off, zone: zp ? zp.value : `UTC${off >= 0 ? '+' : ''}${off}` };
  }

  // ------------------------------------------------------------ solar position

  function position(utcMs, lat = SITE.lat, lon = SITE.lon) {
    const jd = utcMs / 86400000 + 2440587.5;
    const T = (jd - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
      Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
    const trueLong = L0 + C;
    const omega = 125.04 - 1934.136 * T;
    const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
    const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD));
    const y = Math.tan(eps * RAD / 2) ** 2;
    const eqTime = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD)); // minutes
    const utcMin = ((utcMs / 60000) % 1440 + 1440) % 1440;
    const tst = (utcMin + eqTime + 4 * lon + 1440) % 1440;
    const ha = (tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180) * RAD;
    const phi = lat * RAD;
    const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
    const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
    let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180;
    az = (az + 360) % 360; // degrees clockwise from north
    return { altitude: 90 - zen / RAD, azimuth: az, declination: decl / RAD, eqTime };
  }

  // the point on Earth with the sun straight overhead (for the globe's day and night)
  function subsolar(utcMs) {
    const p = position(utcMs, 0, 0), utcMin = ((utcMs / 60000) % 1440 + 1440) % 1440;
    return { lat: p.declination, lon: ((720 - utcMin - p.eqTime) / 4 + 540) % 360 - 180 };
  }

  // sunrise / sunset in local minutes by bisection on altitude = -0.833 deg
  function dayLimits(y, m, d) {
    const alt = t => position(localToUtc(y, m, d, t)).altitude + 0.833;
    const find = (a, b) => { for (let i = 0; i < 40; i++) { const c = (a + b) / 2; (alt(a) < 0) === (alt(c) < 0) ? a = c : b = c; } return (a + b) / 2; };
    let noon = 720, best = -99;
    for (let t = 600; t <= 840; t += 2) { const a = alt(t); if (a > best) { best = a; noon = t; } }
    return { sunrise: find(180, noon), noon, sunset: find(noon, 1320), noonAltitude: best - 0.833 };
  }

  // ------------------------------------------------------------ surface model

  // terrain: {data: Float32Array metres row-major from the north-west, nx, ny, cell, x0, y1}
  function terrainAt(T, x, y) {
    const c = Math.max(0, Math.min(T.nx - 1.001, (x - T.x0) / T.cell));
    const r = Math.max(0, Math.min(T.ny - 1.001, (T.y1 - y) / T.cell));
    const c0 = c | 0, r0 = r | 0, fc = c - c0, fr = r - r0, i = r0 * T.nx + c0;
    const D = T.data;
    return (D[i] * (1 - fc) + D[i + 1] * fc) * (1 - fr) + (D[i + T.nx] * (1 - fc) + D[i + T.nx + 1] * fc) * fr;
  }

  // even-odd scanline fill of one polygon (rings of flat x,y arrays, metres) with max();
  // with an id raster, the cell also records which building is on top
  function fillMax(G, rings, z, id) {
    const { nx, ny, cell, x0, y1, data, ids } = G;
    let ymin = Infinity, ymax = -Infinity;
    for (const r of rings) for (let k = 1; k < r.length; k += 2) { if (r[k] < ymin) ymin = r[k]; if (r[k] > ymax) ymax = r[k]; }
    const rTop = Math.max(0, Math.ceil((y1 - ymax) / cell - 0.5)), rBot = Math.min(ny - 1, Math.floor((y1 - ymin) / cell - 0.5));
    const xs = [];
    for (let row = rTop; row <= rBot; row++) {
      const yc = y1 - (row + 0.5) * cell;
      xs.length = 0;
      for (const r of rings) {
        const n = r.length / 2;
        for (let a = 0, b = n - 1; a < n; b = a++) {
          const ya = r[2 * a + 1], yb = r[2 * b + 1];
          if ((ya > yc) !== (yb > yc)) xs.push(r[2 * a] + (yc - ya) / (yb - ya) * (r[2 * b] - r[2 * a]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)), c1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
        const base = row * nx;
        for (let c = c0; c <= c1; c++) if (data[base + c] < z) { data[base + c] = z; if (ids) ids[base + c] = id; }
      }
    }
  }

  // solids: [building, base_dm, min_dm, top_dm, ring_dm, ...holes_dm]
  // opt.ids keeps a raster of the building on top of each cell (-1 = ground)
  function buildDSM(terrain, solids, opt = {}) {
    const cell = opt.cell || 2, x0 = opt.x0, x1 = opt.x1, y0 = opt.y0, y1 = opt.y1;
    const nx = Math.round((x1 - x0) / cell), ny = Math.round((y1 - y0) / cell);
    const data = new Float32Array(nx * ny);
    const G = { nx, ny, cell, x0, y1, data, max: 0, ids: opt.ids ? new Int32Array(nx * ny).fill(-1) : null };
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++)
      data[r * nx + c] = Math.max(0, terrainAt(terrain, x0 + (c + 0.5) * cell, y1 - (r + 0.5) * cell)); // water surface at 0
    for (const s of solids) {
      const z = (s[1] + s[3]) / 10;
      fillMax(G, s.slice(4).map(r => r.map(v => v / 10)), z, s[0]);
    }
    G.ground = (x, y) => Math.max(0, terrainAt(terrain, x, y));
    return pyramid(G);
  }

  // per-block maxima (BLOCK x BLOCK cells) so rays can skip whole blocks they clear
  const BLOCK = 8;
  function pyramid(G) {
    const { nx, ny, data } = G, bx = Math.ceil(nx / BLOCK), by = Math.ceil(ny / BLOCK);
    const M = new Float32Array(bx * by);
    let max = 0;
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      const v = data[r * nx + c], k = ((r / BLOCK) | 0) * bx + ((c / BLOCK) | 0);
      if (v > M[k]) M[k] = v;
      if (v > max) max = v;
    }
    return Object.assign(G, { M, bx, by, max });
  }

  function cloneDSM(G) {
    return Object.assign({}, G, { data: new Float32Array(G.data), M: new Float32Array(G.M), ids: G.ids ? new Int32Array(G.ids) : null });
  }

  // raise a polygon (metres) to absolute height z and refresh the block maxima
  function addSolid(G, rings, z, id = -3) { fillMax(G, rings, z, id); return pyramid(G); }

  // march from (x, y, z) towards the sun: -1 if it gets out, else the index of the
  // first cell that blocks it (-2 when the sun is below the horizon)
  function castRay(G, x, y, z, sun) {
    if (sun.altitude <= 0) return -2;
    const { nx, ny, cell, x0, y1, data, M, bx } = G;
    const dx = Math.sin(sun.azimuth * RAD), dy = Math.cos(sun.azimuth * RAD), tanA = Math.tan(sun.altitude * RAD);
    const dmax = (G.max - z) / tanA, step = cell * 0.75, bs = BLOCK * cell;
    let d = step;
    while (d <= dmax) {
      const px = x + dx * d, py = y + dy * d;
      const c = Math.floor((px - x0) / cell), r = Math.floor((y1 - py) / cell);
      if (c < 0 || r < 0 || c >= nx || r >= ny) return -1;
      const zr = z + d * tanA, bc = (c / BLOCK) | 0, br = (r / BLOCK) | 0;
      if (zr > M[br * bx + bc]) { // the ray clears this whole block: jump to where it leaves it
        const bxl = x0 + bc * bs, byt = y1 - br * bs;
        const tx = dx > 1e-9 ? (bxl + bs - px) / dx : dx < -1e-9 ? (bxl - px) / dx : Infinity;
        const ty = dy > 1e-9 ? (byt - py) / dy : dy < -1e-9 ? (byt - bs - py) / dy : Infinity;
        d += Math.max(Math.min(tx, ty), 0) + 0.01;
        continue;
      }
      if (data[r * nx + c] > zr) return r * nx + c;
      d += step;
    }
    return -1;
  }

  // is (x, y, z) in direct sun? sun from position(): azimuth / altitude in degrees
  function sunlit(G, x, y, z, sun) { return castRay(G, x, y, z, sun) === -1; }

  // which building blocks the sun at (x, y, z): -1 none (in sun), -2 terrain or night, else
  // the building index (needs a DSM built with ids)
  function blocker(G, x, y, z, sun) {
    const k = castRay(G, x, y, z, sun);
    if (k === -1) return -1;
    return k < 0 || !G.ids || G.ids[k] < 0 ? -2 : G.ids[k];
  }

  // sample points on a regular grid inside polygons ([[ring_dm, hole_dm...], ...])
  function samplePlace(G, polygons, spacing = 3) {
    const pts = [];
    for (const poly of polygons) {
      const rings = poly.map(r => r.map(v => v / 10));
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      for (let k = 0; k < rings[0].length; k += 2) {
        xmin = Math.min(xmin, rings[0][k]); xmax = Math.max(xmax, rings[0][k]);
        ymin = Math.min(ymin, rings[0][k + 1]); ymax = Math.max(ymax, rings[0][k + 1]);
      }
      for (let y = ymin + spacing / 2; y < ymax; y += spacing) for (let x = xmin + spacing / 2; x < xmax; x += spacing) {
        let inside = false;
        for (const r of rings) {
          const n = r.length / 2;
          for (let a = 0, b = n - 1; a < n; b = a++) {
            const ya = r[2 * a + 1], yb = r[2 * b + 1];
            if ((ya > y) !== (yb > y) && x < r[2 * a] + (y - ya) / (yb - ya) * (r[2 * b] - r[2 * a])) inside = !inside;
          }
        }
        if (inside) {
          const c = Math.floor((x - G.x0) / G.cell), rr = Math.floor((G.y1 - y) / G.cell);
          if (c < 0 || rr < 0 || c >= G.nx || rr >= G.ny) continue;
          pts.push(x, y, G.ground ? G.ground(x, y) : 0);
        }
      }
    }
    return { pts: new Float32Array(pts), spacing };
  }

  // fraction of the sample points in sun at one instant; covered points (under a
  // canopy or roof in the model) count as shaded
  function fractionSunlit(G, sample, sun) {
    const p = sample.pts, n = p.length / 3;
    if (!n) return 0;
    let lit = 0;
    for (let i = 0; i < n; i++) if (sunlit(G, p[3 * i], p[3 * i + 1], p[3 * i + 2] + 0.5, sun)) lit++;
    return lit / n;
  }

  // per-point lit flags, to compare two models point by point
  function litMask(G, sample, sun) {
    const p = sample.pts, n = p.length / 3, out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = sunlit(G, p[3 * i], p[3 * i + 1], p[3 * i + 2] + 0.5, sun) ? 1 : 0;
    return out;
  }

  // "1 Sep..31 May" style periods; period = "all" or "MM-DD..MM-DD"
  // period: 'all', a range 'MM-DD..MM-DD' (may wrap the new year), a single date
  // 'MM-DD', or a comma-separated list of those
  function inPeriod(period, m, d) {
    if (!period || period === 'all') return true;
    const v = m * 100 + d;
    return period.split(',').some(part => {
      const [a, b] = (part.includes('..') ? part.split('..') : [part, part]).map(s => s.trim().split('-').map(Number));
      const va = a[0] * 100 + a[1], vb = b[0] * 100 + b[1];
      return va <= vb ? (v >= va && v <= vb) : (v >= va || v <= vb);
    });
  }
  const hm = s => { const [h, mm] = s.split(':').map(Number); return h * 60 + mm; };

  return { RAD, site, position, subsolar, dayLimits, offsetHours, standardOffset, localToUtc, utcToLocal, terrainAt, buildDSM, cloneDSM, fillMax, addSolid, pyramid,
    castRay, sunlit, blocker, samplePlace, fractionSunlit, litMask, inPeriod, hm };
});
