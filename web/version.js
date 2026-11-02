// The deployed build's version, written to version.json by the Pages workflow
// (.github/workflows/pages.yml): the base in VERSION plus the deploy's run number, and its commit.
// A local checkout has no version.json, so the footer stays empty and About says "Local build".
(function () {
  const REPO = 'https://github.com/Mira190/open-earth-3d';
  // served from this machine there is none to ask for (and a 404 would read as a page error to the checks)
  if (/^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(location.hostname)) return;
  fetch('version.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(v => {
    if (!v || !v.version) return;
    window.OE_VERSION = v;
    const sha = (v.commit || '').slice(0, 7);
    const date = (v.built || '').slice(0, 10);
    const foot = document.getElementById('ts-ver');
    if (foot) {
      foot.textContent = `v${v.version}${sha ? ' · ' + sha : ''}`;
      if (sha) foot.href = `${REPO}/commit/${v.commit}`; else foot.removeAttribute('href');
      foot.title = date ? `Built ${date}` : '';
      foot.hidden = false;
    }
    const about = document.getElementById('ts-ver-about');
    if (about) about.textContent = `v${v.version}${sha ? ' · commit ' + sha : ''}${date ? ' · built ' + date : ''}`;
  }).catch(() => {});
})();
