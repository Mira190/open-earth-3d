// Pins a page's clock to a wall time in a city's own time zone, so that a game that starts at the
// live hour ("time": "live") plays the same light and traffic on every run of a check.
//   GAME_TIME=22:40 or GAME_TIME=2026-11-02T22:40 (unset or "live": the real clock)
// await pinClock(page, city) before page.goto; Date.now() and new Date() then run on from that
// instant at the real rate.
const fs = require('fs');
const path = require('path');

// the UTC time (ms) at which it is `spec` (HH:MM or YYYY-MM-DDTHH:MM) on the wall clocks of time zone tz
function wallToUtc(spec, tz) {
  const m = /^(?:(\d{4})-(\d\d)-(\d\d)T)?(\d\d?):(\d\d)$/.exec(spec || '');
  if (!m) throw new Error(`GAME_TIME: HH:MM or YYYY-MM-DDTHH:MM, not ${spec}`);
  const now = new Date(), y = m[1] ? +m[1] : now.getUTCFullYear(), mo = m[1] ? +m[2] : now.getUTCMonth() + 1, d = m[1] ? +m[3] : now.getUTCDate();
  const wall = Date.UTC(y, mo - 1, d, +m[4], +m[5]);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const off = t => { const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value])); return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t; };
  let t = wall - off(wall);
  t = wall - off(t); // (a second pass settles a day the offset changes on)
  return t;
}

function cityZone(city) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cities', city, 'city.json'), 'utf8')).timezone || 'UTC'; } catch (e) { return 'UTC'; }
}

async function pinClock(page, city, spec = process.env.GAME_TIME) {
  if (!spec || spec === 'live') return null;
  const tz = cityZone(city), t0 = wallToUtc(spec, tz);
  await page.addInitScript(t0 => {
    const R = Date, off = t0 - R.now();
    class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } }
    window.Date = D;
  }, t0);
  return { spec, tz, utc: new Date(t0).toISOString() };
}

module.exports = { pinClock, wallToUtc, cityZone };
