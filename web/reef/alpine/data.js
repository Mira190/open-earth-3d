// Loading an alpine site (scene.json kind "alpine", pipeline/build_alpine.py): the height grid, the ground
// colour in strips, the land cover and the lake ids. Returns the same shape as world.js loadScene (heights,
// waterHeights, habitat), so the reef viewer's modules (player, boats, game) read an alpine site as they read a
// reef: x east, north, heights in metres above the main lake's surface, which is the water level 0.

async function inflate(res, onBytes, want) {
  let buf;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader(), parts = [];
    let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onBytes(got, want); }
    buf = new Uint8Array(await new Blob(parts).arrayBuffer());
  } else buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {           // gzip, unless the server already sent it with Content-Encoding
    const out = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
    buf = new Uint8Array(await out.arrayBuffer());
  }
  return buf;
}

// the plane-residual coding of build_alpine.py encode_heights(): low bytes, then high bytes, of each cell's
// difference from left + up - up-left
export function decodeHeights(bytes, W, H) {
  const n = W * H, q = new Int32Array(n);
  for (let i = 0; i < n; i++) q[i] = ((bytes[i] | (bytes[n + i] << 8)) << 16) >> 16;
  for (let i = 1; i < W; i++) q[i] += q[i - 1];
  for (let j = 1; j < H; j++) {
    const r = j * W;
    q[r] += q[r - W];
    for (let i = 1; i < W; i++) q[r + i] += q[r + i - 1] + q[r + i - W] - q[r + i - W - 1];
  }
  return q;
}

const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('could not load ' + src)); im.src = src; });

function bytesOf(img) {
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, img.width, img.height).data, out = new Uint8Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4];
  return out;
}

export async function loadAlpine(base, scene, onBytes = () => {}) {
  const t = scene.terrain, W = t.w, H = t.h;
  const [bytes, strips, coverImg, lakeImg, snowImg] = await Promise.all([
    fetch(base + t.file).then(r => { if (!r.ok) throw new Error(`terrain: HTTP ${r.status}`); return inflate(r, onBytes, t.bytes || W * H * 2); }),
    Promise.all(scene.ground.strips.map(s => loadImg(base + s.file))),
    loadImg(base + scene.cover.file),
    loadImg(base + scene.lake_ids),
    scene.snow ? loadImg(base + scene.snow.file).catch(() => null) : Promise.resolve(null)   // the season's snow (alpine_snow.py)
  ]);
  try { performance.mark('oe:fetched'); } catch (e) { /* no User Timing */ }   // the load's stages (telemetry.js)
  const q = decodeHeights(bytes, W, H);
  const heights = new Float32Array(W * H);
  for (let i = 0; i < heights.length; i++) heights[i] = q[i] * t.units_m;
  const lakeIds = bytesOf(lakeImg);
  // the water the viewer's sea code sees is the main lake (id 1) only: everywhere else the bed is held above the
  // water level, so the land below the lake's surface (the Pukaki flats past the dam, the West Coast's valleys)
  // stays dry. The other lakes have their own surfaces (lakes.js).
  const LIM = 2.6, waterHeights = Float32Array.from(heights);
  for (let i = 0; i < waterHeights.length; i++) if (lakeIds[i] !== 1 && waterHeights[i] < LIM) waterHeights[i] = LIM;
  const habitat = bytesOf(coverImg);
  return { scene, heights, waterHeights, img: null, strips, habitat, lakeIds, snowImg, alpine: true, base };
}
