// The site map in the Map panel, drawn from the model when the panel opens: the survey depths and heights at the
// current tide (sea shaded by depth, the waterline, sand, hill-shaded land), the people you can talk to, the signs,
// the aircraft, the tracked objective and you. The window fits what matters (you, the people, the target), at
// least 3 km across. No tiles and no stored imagery: it is the same terrain grid the 3D view stands on.
const DEEP = [10, 47, 74], SHALLOW = [70, 182, 198], SAND = [233, 226, 204], LAND = [86, 112, 70], HIGH = [150, 150, 120];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function drawSiteMap(canvas, G, marks, me) {
  const W = canvas.width, H = canvas.height, g = canvas.getContext('2d'), tide = G.tideNow();
  // the window: a square around everything marked, padded, 3 km at least, inside the model
  let x0 = me.x, x1 = me.x, n0 = me.north, n1 = me.north;
  for (const m of marks) if (m.fit !== false) { x0 = Math.min(x0, m.x); x1 = Math.max(x1, m.x); n0 = Math.min(n0, m.north); n1 = Math.max(n1, m.north); }
  const ext = G.S.extent_m || [x0 - 5000, x1 + 5000, n0 - 5000, n1 + 5000];
  let span = Math.max(3000, (x1 - x0) * 1.25 + 600, (n1 - n0) * 1.25 + 600);
  span = Math.min(span, ext[1] - ext[0], ext[3] - ext[2]);
  let cx = (x0 + x1) / 2, cn = (n0 + n1) / 2;
  cx = Math.min(Math.max(cx, ext[0] + span / 2), ext[1] - span / 2); cn = Math.min(Math.max(cn, ext[2] + span / 2), ext[3] - span / 2);
  const mpp = span / W, X = x => (x - cx) / mpp + W / 2, Y = n => H / 2 - (n - cn) / mpp;
  // the ground, one height lookup per pixel plus two for the hill shade
  const img = g.createImageData(W, H), d = img.data, e = mpp;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = cx + (i - W / 2) * mpp, n = cn - (j - H / 2) * mpp, h = G.height(x, n);
    let c;
    if (h < tide) c = mix(DEEP, SHALLOW, Math.exp(-(tide - h) / 7));
    else {
      const sx = G.height(x + e, n) - h, sn = G.height(x, n + e) - h, shade = Math.max(0.55, Math.min(1.25, 1 + (sx - sn) / e * 0.9));   // lit from the north-west: normal . (-1, 1, 1)
      c = h - tide < 2.2 ? SAND : mix(LAND, HIGH, Math.min(1, (h - tide) / 400));
      c = [c[0] * shade, c[1] * shade, c[2] * shade];
    }
    const k = 4 * (j * W + i); d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // marks
  g.font = '600 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const m of marks) {
    const px = X(m.x), py = Y(m.north); if (px < -20 || py < -20 || px > W + 20 || py > H + 20) continue;
    g.lineWidth = 2; g.strokeStyle = '#082633';
    if (m.kind === 'target') { g.fillStyle = '#ffb347'; g.beginPath(); g.moveTo(px, py - 8); g.lineTo(px + 8, py); g.lineTo(px, py + 8); g.lineTo(px - 8, py); g.closePath(); g.fill(); g.stroke(); }
    else if (m.kind === 'sign') { g.fillStyle = m.done ? '#7be0b0' : '#d9cfae'; g.fillRect(px - 4, py - 4, 8, 8); g.strokeRect(px - 4, py - 4, 8, 8); }
    else { g.fillStyle = m.color || '#6fd3e6'; g.beginPath(); g.arc(px, py, 8, 0, 6.283); g.fill(); g.stroke(); g.fillStyle = '#082633'; g.fillText(m.glyph || (m.label || '?')[0], px, py + 0.5); }
    if (m.label) { g.textAlign = 'left'; g.lineWidth = 3; g.strokeStyle = 'rgba(2,16,24,.85)'; g.fillStyle = '#e8f4f6'; g.strokeText(m.label, px + 11, py); g.fillText(m.label, px + 11, py); g.textAlign = 'center'; }
  }
  // you: an arrow along your heading
  const px = X(me.x), py = Y(me.north), a = me.heading * Math.PI / 180;
  g.save(); g.translate(px, py); g.rotate(a); g.fillStyle = '#ffb347'; g.strokeStyle = '#082633'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8); g.closePath(); g.fill(); g.stroke(); g.restore();
  // scale bar and north
  const bar = [500, 1000, 2000, 5000].find(b => b / mpp > W * 0.18) || 5000, bl = bar / mpp;
  g.fillStyle = 'rgba(2,16,24,.7)'; g.fillRect(8, H - 26, bl + 16, 18); g.fillStyle = '#e8f4f6'; g.fillRect(16, H - 18, bl, 3);
  g.textAlign = 'left'; g.font = '600 10px system-ui, sans-serif'; g.fillText(bar >= 1000 ? `${bar / 1000} km` : `${bar} m`, 18, H - 22 + 0);
  g.textAlign = 'center'; g.font = '700 12px system-ui, sans-serif'; g.fillStyle = 'rgba(2,16,24,.7)'; g.beginPath(); g.arc(W - 16, 16, 10, 0, 6.283); g.fill(); g.fillStyle = '#e8f4f6'; g.fillText('N', W - 16, 16.5);
  return { cx, cn, span };
}
