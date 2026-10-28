// Travel between the Queensland reef sites. The list is data: every entry of web/data/cities.json whose
// `viewer` is this reef viewer, and a site counts as ready when its web/data/<id>/scene.json answers, so a
// new site (Hardy Reef, Green Island, Lady Elliot Island ...) appears as soon as the pipeline writes it.
// Travelling reloads the viewer with ?city=<id>, keeping the settings in the query (renderer, exposure,
// sound, look) and dropping the ones that place you or script a test.
const VIEWER = 'reef/index.html';
// query keys that only make sense for the site you are leaving (positions, cameras, one-off test hooks)
const DROP = ['city', 'x', 'y', 'z', 'yaw', 'pitch', 'player', 'cam', 'view', 'settle', 'hold', 'dive', 'still', 'freeze', 'demo', 'n',
  'boatcam', 'bd', 'baz', 'bel', 'bh', 'bsail', 'bspeed', 'under', 'warm', 'autotest', 'gametest', 'gameshot', 'gamereset'];
const R = 6371;
const rad = d => d * Math.PI / 180;

export function distanceKm(a, b) {
  const dl = rad(b.lat - a.lat), dn = rad(b.lon - a.lon);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
// initial great-circle bearing from a to b, degrees from north
export function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// the URL that opens site `id` in this viewer, from the current location
export function siteHref(id, loc = location) {
  const p = new URLSearchParams(loc.search);
  for (const k of DROP) p.delete(k);
  const keep = p.toString();
  return `${loc.pathname}?city=${encodeURIComponent(id)}${keep ? '&' + keep : ''}`;
}

export function createTravel(ctx) {
  const here = ctx.site;
  let list = null, loading = null;
  const origin = ctx.S.origin ? { lon: ctx.S.origin[0], lat: ctx.S.origin[1] } : null;
  // cities.json entries -> [{ id, name, lat, lon, summary, ready, current, km, bearing }]
  async function build(entries, probe = id => fetch(new URL(`../../data/${id}/scene.json`, import.meta.url), { method: 'HEAD' }).then(r => r.ok, () => false)) {
    const reef = entries.filter(c => c && c.viewer === VIEWER);
    const out = await Promise.all(reef.map(async c => {
      const current = c.id === here;
      const ready = current || await probe(c.id);
      const o = { id: c.id, name: c.name, lat: c.lat, lon: c.lon, summary: c.summary || '', status: c.status || '', ready, current, km: null, bearing: null };
      if (origin && Number.isFinite(c.lat) && Number.isFinite(c.lon)) { o.km = distanceKm(origin, c); o.bearing = bearingDeg(origin, c); }
      return o;
    }));
    out.sort((a, b) => (b.current - a.current) || ((a.km ?? 1e9) - (b.km ?? 1e9)));
    return out;
  }
  async function load(force) {
    if (list && !force) return list;
    if (!loading || force) loading = fetch(new URL('../../data/cities.json', import.meta.url)).then(r => r.json()).then(j => build(Array.isArray(j) ? j : j.cities || [])).catch(e => { console.warn('travel: no site list', e); return []; });
    list = await loading; return list;
  }
  // the nearest other ready site, preferring ones ahead of `headingDeg` (the way you are flying)
  function nearest(headingDeg) {
    if (!list) return null;
    const others = list.filter(s => !s.current && s.ready && s.km !== null);
    const ahead = headingDeg === undefined ? others : others.filter(s => Math.cos(rad(s.bearing - headingDeg)) > 0);
    return (ahead.length ? ahead : others)[0] || null;
  }
  return { load, build, nearest, href: siteHref, get list() { return list; } };
}
