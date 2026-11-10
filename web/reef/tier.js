// The reef and alpine viewers' picture tiers: web/quality.js's tier (the device's own, measured, or the visitor's choice
// in the globe's About panel) in this viewer's terms, as the cities take it in theirs (OEQuality.city()).
//   high    desktop GPUs: every plant to its full radius, the turf, the lake's mirror at half resolution with the lupins
//           in it, bloom, 4x MSAA, a canvas of up to 2x pixels with the scene within 2560 x 1440's
//   medium  tablets and weaker laptops: 70% of the plants within 84% of the radii, a thinner turf, the mirror at a third
//           without plants, bloom, no MSAA, pixels within the tier's budget
//   low     phones and software renderers: 40% of the plants within 63% of the radii and simpler forms (lupins with
//           fewer florets and leaves, tussock of 40 blades), no turf, no mirror, no bloom, a coarser far land, the
//           terrain's finer levels nearer the eye
// ?quality=high|medium|low overrides it for one visit; ?flora=0, ?mirror=0|1 and ?bloom=0 still switch those parts.
const TIERS = {
  high: { flora: 1, simple: false, turf: 1, mirror: 0.5, mirrorFlora: true, bloom: true, antialias: true, terrain: 1, farSmall: false },
  medium: { flora: 0.7, simple: false, turf: 0.6, mirror: 0.34, mirrorFlora: false, bloom: true, antialias: false, terrain: 0.8, farSmall: false },
  low: { flora: 0.4, simple: true, turf: 0, mirror: 0, mirrorFlora: false, bloom: false, antialias: false, terrain: 0.6, farSmall: true },
};
const CANVAS_PX = 3840 * 2160, SCENE_PX = 2560 * 1440, START_PX = { high: 1920 * 1080, medium: 1600 * 900, low: 1e6 };
export function reefTier(q) {
  const Q = window.OEQuality;
  let name = q.get('quality') || (Q ? Q.tier().name : 'high');
  if (!TIERS[name]) name = name === 'still' ? 'low' : 'high';
  const t = Object.assign({ name }, TIERS[name]);
  const small = Math.min(innerWidth, innerHeight) < 700;
  if (small) t.farSmall = true;
  if (q.get('flora') === '0') t.flora = 0;
  if (q.get('mirror') === '0') t.mirror = 0; else if (q.get('mirror') === '1' && !t.mirror) t.mirror = small ? 0.3 : 0.5;
  if (q.get('bloom') === '0') t.bloom = false;
  // pixels: a desktop's canvas keeps up to 2x, within a 4K display's pixels (the interface and the last pass stay sharp);
  // the others within their tier's budget of device pixels (quality.js)
  t.pixelRatio = (w, h) => (name === 'high' || !Q ? Math.min(devicePixelRatio || 1, 2, Math.sqrt(CANVAS_PX / Math.max(1, w * h))) : Q.pixelRatio(Q.TIERS[name], w, h));
  // the scene inside the canvas (w, h: its device pixels): the most of it the scene may be drawn at, the frame-time
  // governor's ceiling (quality.js governor, issue 382), and where a device that has not been here before starts.
  // It starts low and is granted more as its frames allow: a laptop's integrated GPU has every feature the high tier
  // asks for and a fifth of the speed, and a start at the ceiling was its first ten seconds at 5 frames a second
  const budget = name === 'high' || !Q ? SCENE_PX : Q.TIERS[name].budget;
  t.sceneScale = (w, h) => Math.min(1, Math.sqrt(budget / Math.max(1, w * h)));
  t.startScale = (w, h) => Math.min(t.sceneScale(w, h), Math.sqrt(Math.min(budget, START_PX[name]) / Math.max(1, w * h)));
  return t;
}
