// Render every still a reef or alpine site lists in its city.json "shots" ({id, x, y, z, yaw, pitch, fov, time?, month?}),
// on a desktop (1440 x 900) and a phone (390 x 844), into a folder.
//   cd web && python3 -m http.server 8800 &
//   NODE_PATH=$(npm root -g) node tools/site_shots.js lake-tekapo out/ [shotId ...]
// z is metres above the site's datum (the lake's surface on an alpine site), not above the ground: an eye-level shot
// on ground 9 m up the shore is z 10.5.
// month: renders at that month's 5th at the shot's local time of day (for a season, e.g. lupins in December).
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const [,, site, outDir = 'shots', ...only] = process.argv;
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cities', site, 'city.json'), 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
for (const s of cfg.shots || []) {
  if (only.length && !only.includes(s.id)) continue;
  let time = s.time;
  if (s.month && time) { const t = new Date(time); t.setUTCMonth(s.month - 1); time = t.toISOString(); }
  const q = ['still=1', 'gl=1', 'freeze=5', `city=${site}`, `x=${s.x}`, `y=${s.y}`, `z=${s.z}`, `yaw=${s.yaw ?? 0}`, `pitch=${s.pitch ?? 0}`, `fov=${s.fov ?? 60}`,
    time ? `time=${time}` : '', `mods=${s.mods ?? 'alpine/flora,alpine/landmarks'}`].filter(Boolean).join('&');
  for (const [tag, env] of [['desktop', { W: 1440, H: 900 }], ['phone', { W: 390, H: 844, MOBILE: 1 }]]) {
    const out = path.join(outDir, `${s.id}-${tag}.png`);
    const r = execFileSync('node', [path.join(__dirname, 'reef_shot.js'), q, out, '15000', '0'], { env: Object.assign({}, process.env, env) }).toString();
    console.log(`${s.id} ${tag}: ${out} ${r.split('\n')[0]}`);
  }
}
